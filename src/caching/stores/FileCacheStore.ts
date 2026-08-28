import { toError } from '../types';
import { performance } from 'perf_hooks';
/**
 * File-based Cache Store Implementation
 * 
 * Persistent file-based cache with directory organization, compression,
 * atomic operations, and efficient cleanup for production use.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import { ICacheStore, CacheEntry, CacheResult } from '../types';
import { ErrorLogger, LogContext, defaultErrorLogger } from '../../errors/ErrorLogger';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * File cache store configuration
 */
export interface FileCacheConfig {
  /** Base directory for cache files */
  directory: string;
  /** Maximum size per cache file in bytes */
  maxFileSize: number;
  /** Maximum total directory size in bytes */
  maxDirectorySize: number;
  /** Enable compression for large entries */
  enableCompression: boolean;
  /** Compression threshold in bytes */
  compressionThreshold: number;
  /** Cleanup interval in milliseconds */
  cleanupInterval: number;
  /** Number of subdirectories for distribution */
  subdirectories: number;
  /** File extension for cache files */
  fileExtension: string;
  /** Enable atomic writes via temp files */
  atomicWrites: boolean;
  /** Directory permissions */
  dirPermissions: number;
  /** File permissions */
  filePermissions: number;
}

/**
 * Default file cache configuration
 */
export const DEFAULT_FILE_CONFIG: FileCacheConfig = {
  directory: './cache',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDirectorySize: 1000 * 1024 * 1024, // 1GB
  enableCompression: true,
  compressionThreshold: 1024, // 1KB
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  subdirectories: 256, // 2^8 for good distribution
  fileExtension: '.cache',
  atomicWrites: true,
  dirPermissions: 0o755,
  filePermissions: 0o644
};

/**
 * File cache entry with metadata
 */
interface FileCacheEntry extends CacheEntry {
  /** Whether the value is compressed */
  compressed: boolean;
  /** Original size before compression */
  originalSize?: number;
  /** File path where this entry is stored */
  filePath?: string;
  /** File system stats */
  fileStats?: {
    size: number;
    mtime: number;
    atime: number;
  };
}

/**
 * Directory statistics
 */
interface DirectoryStats {
  /** Total number of files */
  fileCount: number;
  /** Total size in bytes */
  totalSize: number;
  /** Last cleanup time */
  lastCleanup: number;
  /** Directory creation time */
  created: number;
}

/**
 * File-based cache store implementation
 */
export class FileCacheStore implements ICacheStore {
  private config: FileCacheConfig;
  private logger: ErrorLogger;
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private tagIndex: Map<string, Set<string>> = new Map();
  private keyIndex: Map<string, string> = new Map(); // key -> file path
  private initialized = false;
  private stats: DirectoryStats;

  constructor(
    config: Partial<FileCacheConfig> = {},
    logger: ErrorLogger = defaultErrorLogger
  ) {
    this.config = { ...DEFAULT_FILE_CONFIG, ...config };
    this.logger = logger;
    this.stats = {
      fileCount: 0,
      totalSize: 0,
      lastCleanup: 0,
      created: Date.now()
    };
  }

  /**
   * Initialize the file cache store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.ensureDirectoryStructure();
      await this.rebuildIndexes();
      this.startCleanupTimer();
      this.initialized = true;

      this.logger.info('File cache store initialized', {
        correlationId: 'file-cache-init',
        operation: 'initialize',
        metadata: {
          directory: this.config.directory,
          fileCount: this.stats.fileCount,
          totalSize: this.stats.totalSize
        }
      });

    } catch (error) {
      const context: LogContext = {
        correlationId: 'file-cache-init',
        operation: 'initialize'
      };
      this.logger.error('Failed to initialize file cache store', toError(error), context);
      throw error;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<CacheResult<T>> {
    const startTime = performance.now();
    const context: LogContext = {
      operation: 'file_cache_get',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const filePath = this.getFilePath(key);
      
      try {
        const stats = await fs.stat(filePath);
        const entryJson = await fs.readFile(filePath, 'utf8');
        const entry: FileCacheEntry = JSON.parse(entryJson);

        // Check expiration
        if (Date.now() >= entry.expiresAt) {
          await this.delete(key);
          return {
            success: true,
            hit: false,
            timing: performance.now() - startTime
          };
        }

        // Update access time
        entry.lastAccessed = Date.now();
        entry.hitCount++;
        entry.fileStats = {
          size: stats.size,
          mtime: stats.mtime.getTime(),
          atime: Date.now()
        };

        // Update file access time
        await fs.utimes(filePath, new Date(), new Date());

        // Decompress if needed
        let value = entry.value;
        if (entry.compressed && Buffer.isBuffer(entry.value)) {
          const buffer = Buffer.from(entry.value);
          const decompressed = await gunzipAsync(buffer);
          value = JSON.parse(decompressed.toString());
        }

        // Update entry with new stats (fire and forget)
        this.updateEntryStats(filePath, entry).catch(() => {
          // Ignore errors in stats update
        });

        return {
          success: true,
          value,
          hit: true,
          metadata: {
            ...entry,
            compressed: false,
            value
          },
          timing: performance.now() - startTime
        };

      } catch (fileError: any) {
        if (fileError.code === 'ENOENT') {
          // File doesn't exist
          return {
            success: true,
            hit: false,
            timing: performance.now() - startTime
          };
        }
        throw fileError;
      }

    } catch (error) {
      this.logger.error('File cache get error', toError(error), {
        ...context,
        metadata: { key }
      });
      return {
        success: false,
        hit: false,
        error: toError(error),
        timing: performance.now() - startTime
      };
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<boolean> {
    const context: LogContext = {
      operation: 'file_cache_set',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const now = Date.now();
      const expiresAt = ttl ? now + ttl : now + (24 * 60 * 60 * 1000); // Default 24 hours

      // Calculate size and compress if needed
      let processedValue: any = value;
      let size = this.calculateSize(value);
      let compressed = false;
      const originalSize = size;

      if (this.config.enableCompression && size > this.config.compressionThreshold) {
        try {
          const jsonString = JSON.stringify(value);
          const compressedBuffer = await gzipAsync(jsonString);
          if (compressedBuffer.length < size) {
            processedValue = compressedBuffer;
            size = compressedBuffer.length;
            compressed = true;
          }
        } catch (compressionError) {
          this.logger.warn('Compression failed, storing uncompressed', toError(compressionError), {
            ...context,
            metadata: { key, originalSize: size }
          });
        }
      }

      // Check file size limit
      if (size > this.config.maxFileSize) {
        this.logger.warn('Entry too large for file cache', undefined, {
          ...context,
          metadata: { key, size, maxSize: this.config.maxFileSize }
        });
        return false;
      }

      const filePath = this.getFilePath(key);
      const entry: FileCacheEntry = {
        value: processedValue,
        createdAt: now,
        expiresAt,
        ttl: ttl || 24 * 60 * 60 * 1000,
        tags: [...tags],
        hitCount: 0,
        lastAccessed: now,
        size,
        compressed,
        originalSize,
        filePath
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { 
        recursive: true, 
        mode: this.config.dirPermissions 
      });

      // Write file atomically if enabled
      const entryJson = JSON.stringify(entry);
      if (this.config.atomicWrites) {
        const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
        await fs.writeFile(tempPath, entryJson, { mode: this.config.filePermissions });
        await fs.rename(tempPath, filePath);
      } else {
        await fs.writeFile(filePath, entryJson, { mode: this.config.filePermissions });
      }

      // Update indexes
      this.keyIndex.set(key, filePath);
      this.updateTagIndex(key, tags);

      // Update stats
      this.stats.fileCount++;
      this.stats.totalSize += entryJson.length;

      // Check directory size limit
      if (this.stats.totalSize > this.config.maxDirectorySize) {
        this.performCleanup().catch(() => {
          // Ignore cleanup errors
        });
      }

      return true;

    } catch (error) {
      this.logger.error('File cache set error', toError(error), {
        ...context,
        metadata: { key, tagsCount: tags.length }
      });
      return false;
    }
  }

  /**
   * Delete a single key
   */
  async delete(key: string): Promise<boolean> {
    const context: LogContext = {
      operation: 'file_cache_delete',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const filePath = this.getFilePath(key);
      
      try {
        const stats = await fs.stat(filePath);
        await fs.unlink(filePath);

        // Update indexes
        this.keyIndex.delete(key);
        this.cleanupTagIndex(key);

        // Update stats
        this.stats.fileCount = Math.max(0, this.stats.fileCount - 1);
        this.stats.totalSize = Math.max(0, this.stats.totalSize - stats.size);

        return true;

      } catch (fileError: any) {
        if (fileError.code === 'ENOENT') {
          // File doesn't exist, consider it deleted
          return true;
        }
        throw fileError;
      }

    } catch (error) {
      this.logger.error('File cache delete error', toError(error), {
        ...context,
        metadata: { key }
      });
      return false;
    }
  }

  /**
   * Delete multiple keys
   */
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    let deletedCount = 0;
    
    // Process in batches to avoid overwhelming the file system
    const batchSize = 50;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const deletePromises = batch.map(key => this.delete(key));
      const results = await Promise.allSettled(deletePromises);
      
      deletedCount += results.filter(result => 
        result.status === 'fulfilled' && result.value
      ).length;
    }

    return deletedCount;
  }

  /**
   * Delete keys matching pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    const context: LogContext = {
      operation: 'file_cache_delete_pattern',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const regex = this.createPatternRegex(pattern);
      const matchingKeys: string[] = [];

      // Find all matching keys
      for (const key of this.keyIndex.keys()) {
        if (regex.test(key)) {
          matchingKeys.push(key);
        }
      }

      return await this.deleteMany(matchingKeys);

    } catch (error) {
      this.logger.error('File cache delete pattern error', toError(error), {
        ...context,
        metadata: { pattern }
      });
      return 0;
    }
  }

  /**
   * Delete keys by tags
   */
  async deleteByTags(tags: string[]): Promise<number> {
    if (tags.length === 0) {
      return 0;
    }

    const context: LogContext = {
      operation: 'file_cache_delete_by_tags',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const keysToDelete = new Set<string>();

      for (const tag of tags) {
        const taggedKeys = this.tagIndex.get(tag);
        if (taggedKeys) {
          taggedKeys.forEach(key => keysToDelete.add(key));
        }
      }

      return await this.deleteMany(Array.from(keysToDelete));

    } catch (error) {
      this.logger.error('File cache delete by tags error', toError(error), {
        ...context,
        metadata: { tags }
      });
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const filePath = this.getFilePath(key);
      
      try {
        const stats = await fs.stat(filePath);
        
        // Check if file is expired by reading the entry
        const entryJson = await fs.readFile(filePath, 'utf8');
        const entry: FileCacheEntry = JSON.parse(entryJson);
        
        return Date.now() < entry.expiresAt;

      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }

    } catch (error) {
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    const context: LogContext = {
      operation: 'file_cache_clear',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Remove all files in the cache directory
      await this.removeDirectoryContents(this.config.directory);

      // Reset indexes and stats
      this.keyIndex.clear();
      this.tagIndex.clear();
      this.stats = {
        fileCount: 0,
        totalSize: 0,
        lastCleanup: Date.now(),
        created: this.stats.created
      };

    } catch (error) {
      this.logger.error('File cache clear error', toError(error), context);
      throw error;
    }
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern?: string): Promise<string[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const allKeys = Array.from(this.keyIndex.keys());

      if (!pattern) {
        return allKeys;
      }

      const regex = this.createPatternRegex(pattern);
      return allKeys.filter(key => regex.test(key));

    } catch (error) {
      return [];
    }
  }

  /**
   * Get cache size info
   */
  async size(): Promise<{ entries: number; memoryUsage: number }> {
    return {
      entries: this.stats.fileCount,
      memoryUsage: this.stats.totalSize
    };
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    const context: LogContext = {
      operation: 'file_cache_cleanup',
      correlationId: this.generateCorrelationId()
    };

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      return await this.performCleanup();

    } catch (error) {
      this.logger.error('File cache cleanup error', toError(error), context);
      return 0;
    }
  }

  /**
   * Health check
   */
  async health(): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Test write/read/delete operations
      const testKey = '__health_check__';
      const testValue = { timestamp: Date.now() };
      
      await this.set(testKey, testValue, 1000);
      const result = await this.get(testKey);
      await this.delete(testKey);

      return result.success && result.hit;

    } catch {
      return false;
    }
  }

  /**
   * Close the file store
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // Perform final cleanup
    try {
      await this.cleanup();
    } catch (error) {
      this.logger.warn('Error during final cleanup', toError(error), {
        operation: 'file_cache_close',
        correlationId: this.generateCorrelationId()
      });
    }
  }

  /**
   * Get detailed cache statistics
   */
  getDetailedStats(): DirectoryStats & {
    averageFileSize: number;
    indexSize: number;
    compressionRatio: number;
  } {
    const averageFileSize = this.stats.fileCount > 0 ? 
      this.stats.totalSize / this.stats.fileCount : 0;
    
    const indexSize = this.keyIndex.size * 50 + // Approximate key index size
                      Array.from(this.tagIndex.values())
                        .reduce((sum, set) => sum + set.size * 30, 0);

    // Calculate compression ratio from a sample of files (this is approximate)
    const compressionRatio = 0.3; // Would need to implement actual calculation

    return {
      ...this.stats,
      averageFileSize,
      indexSize,
      compressionRatio
    };
  }

  /**
   * Ensure directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    await fs.mkdir(this.config.directory, { 
      recursive: true, 
      mode: this.config.dirPermissions 
    });

    // Create subdirectories for better file distribution
    for (let i = 0; i < this.config.subdirectories; i++) {
      const subDir = path.join(this.config.directory, i.toString(16).padStart(2, '0'));
      await fs.mkdir(subDir, { 
        recursive: true, 
        mode: this.config.dirPermissions 
      });
    }
  }

  /**
   * Rebuild indexes by scanning the directory
   */
  private async rebuildIndexes(): Promise<void> {
    this.keyIndex.clear();
    this.tagIndex.clear();
    this.stats.fileCount = 0;
    this.stats.totalSize = 0;

    await this.scanDirectory(this.config.directory);
  }

  /**
   * Scan directory and rebuild indexes
   */
  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(this.config.fileExtension)) {
          await this.processFileForIndex(fullPath);
        }
      }

    } catch (error) {
      // Directory might not exist or be accessible, skip it
    }
  }

  /**
   * Process a file for indexing
   */
  private async processFileForIndex(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const entryJson = await fs.readFile(filePath, 'utf8');
      const entry: FileCacheEntry = JSON.parse(entryJson);

      // Check if expired
      if (Date.now() >= entry.expiresAt) {
        await fs.unlink(filePath);
        return;
      }

      // Extract key from file path
      const key = this.keyFromFilePath(filePath);
      
      // Update indexes
      this.keyIndex.set(key, filePath);
      this.updateTagIndex(key, entry.tags);

      // Update stats
      this.stats.fileCount++;
      this.stats.totalSize += stats.size;

    } catch (error) {
      // File might be corrupted, delete it
      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  /**
   * Get file path for a key
   */
  private getFilePath(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    const subDir = hash.substring(0, 2);
    const fileName = `${hash}${this.config.fileExtension}`;
    return path.join(this.config.directory, subDir, fileName);
  }

  /**
   * Extract key from file path (reverse of getFilePath)
   */
  private keyFromFilePath(filePath: string): string {
    // Since we use hash for file names, we need to find the original key
    // from our index or by parsing the file content
    const hash = path.basename(filePath, this.config.fileExtension);
    
    // Find key by hash
    for (const [key, path_] of this.keyIndex.entries()) {
      if (path_ === filePath) {
        return key;
      }
    }

    // If not in index, we'd need to parse the file, but this should not happen
    // in normal operation as the index should be complete
    return hash; // Fallback to hash
  }

  /**
   * Update tag index
   */
  private updateTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }
  }

  /**
   * Clean up tag index for a key
   */
  private cleanupTagIndex(key: string): void {
    for (const taggedKeys of this.tagIndex.values()) {
      taggedKeys.delete(key);
    }

    // Remove empty tag sets
    for (const [tag, taggedKeys] of this.tagIndex.entries()) {
      if (taggedKeys.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.performCleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Perform cleanup of expired entries
   */
  private async performCleanup(): Promise<number> {
    const now = Date.now();
    let deletedCount: number;
    const expiredKeys: string[] = [];

    // Find expired keys
    for (const [key, filePath] of this.keyIndex.entries()) {
      try {
        const entryJson = await fs.readFile(filePath, 'utf8');
        const entry: FileCacheEntry = JSON.parse(entryJson);
        
        if (now >= entry.expiresAt) {
          expiredKeys.push(key);
        }

      } catch (error) {
        // File might be corrupted or missing, mark for deletion
        expiredKeys.push(key);
      }
    }

    // Delete expired keys
    deletedCount = await this.deleteMany(expiredKeys);
    this.stats.lastCleanup = now;

    if (deletedCount > 0) {
      this.logger.info('File cache cleanup completed', {
        correlationId: this.generateCorrelationId(),
        operation: 'cleanup',
        metadata: { deletedCount, totalFiles: this.stats.fileCount }
      });
    }

    return deletedCount;
  }

  /**
   * Remove all contents of a directory
   */
  private async removeDirectoryContents(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.removeDirectoryContents(fullPath);
          await fs.rmdir(fullPath);
        } else {
          await fs.unlink(fullPath);
        }
      }

    } catch (error) {
      // Directory might not exist or be accessible
    }
  }

  /**
   * Update entry statistics in file
   */
  private async updateEntryStats(filePath: string, entry: FileCacheEntry): Promise<void> {
    try {
      const entryJson = JSON.stringify(entry);
      if (this.config.atomicWrites) {
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        await fs.writeFile(tempPath, entryJson, { mode: this.config.filePermissions });
        await fs.rename(tempPath, filePath);
      } else {
        await fs.writeFile(filePath, entryJson, { mode: this.config.filePermissions });
      }
    } catch (error) {
      // Ignore stats update errors
    }
  }

  /**
   * Create regex from pattern (supports * wildcard)
   */
  private createPatternRegex(pattern: string): RegExp {
    const escapedPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escapedPattern}$`);
  }

  /**
   * Calculate size of a value
   */
  private calculateSize(value: any): number {
    const jsonString = JSON.stringify(value);
    return Buffer.byteLength(jsonString, 'utf8');
  }

  /**
   * Generate correlation ID for logging
   */
  private generateCorrelationId(): string {
    return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}