/**
 * Event store implementation for webhook events with persistence and replay capabilities
 */

import winston from 'winston';
import Redis from 'ioredis';
import { EventEmitter } from 'events';
import {
  WebhookEvent,
  WebhookHandlerResult,
  EventStore as IEventStore,
  EventStoreFilter,
} from '../types/WebhookTypes';

export interface EventStoreConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  keyPrefix: string;
  maxEventAge: number; // milliseconds
  batchSize: number;
  enableCompression: boolean;
  enableIndexing: boolean;
  persistenceMode: 'memory' | 'redis' | 'hybrid';
}

export interface StoredEvent {
  id: string;
  event: WebhookEvent;
  storedAt: Date;
  expiresAt?: Date;
  processingResults?: Array<{
    handlerId: string;
    result: WebhookHandlerResult;
    processedAt: Date;
  }>;
  metadata: {
    size: number;
    compressed: boolean;
    indexed: boolean;
  };
}

export interface EventStoreMetrics {
  totalEvents: number;
  eventsPerHour: number;
  storageSize: number;
  indexSize: number;
  compressionRatio: number;
  averageEventSize: number;
  oldestEvent?: Date;
  newestEvent?: Date;
}

export interface EventIndex {
  byEntityType: Map<string, Set<string>>;
  byAction: Map<string, Set<string>>;
  byTimestamp: Map<string, Set<string>>; // grouped by hour
  bySource: Map<string, Set<string>>;
}

export class EventStore extends EventEmitter implements IEventStore {
  private config: EventStoreConfig;
  private logger: winston.Logger;
  private redis?: Redis;
  private memoryStore: Map<string, StoredEvent> = new Map();
  private index: EventIndex;
  private metrics: EventStoreMetrics;

  constructor(config: EventStoreConfig, logger?: winston.Logger) {
    super();

    this.config = config;
    this.logger = logger || this.createDefaultLogger();
    this.index = this.initializeIndex();
    this.metrics = this.initializeMetrics();

    if (this.config.persistenceMode !== 'memory') {
      this.setupRedis();
    }

    this.setupCleanup();
  }

  private createDefaultLogger(): winston.Logger {
    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'event-store' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
      ],
    });
  }

  private initializeIndex(): EventIndex {
    return {
      byEntityType: new Map(),
      byAction: new Map(),
      byTimestamp: new Map(),
      bySource: new Map(),
    };
  }

  private initializeMetrics(): EventStoreMetrics {
    return {
      totalEvents: 0,
      eventsPerHour: 0,
      storageSize: 0,
      indexSize: 0,
      compressionRatio: 1.0,
      averageEventSize: 0,
    };
  }

  private setupRedis(): void {
    this.redis = new Redis({
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password,
      db: this.config.redis.db || 0,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', error => {
      this.logger.error('Redis connection error', { error: error.message });
      this.emit('error', error);
    });

    this.redis.on('connect', () => {
      this.logger.info('Connected to Redis for event store');
    });
  }

  private setupCleanup(): void {
    // Run cleanup every hour
    setInterval(
      () => {
        this.cleanup().catch(error => {
          this.logger.error('Event store cleanup error', {
            error: error.message,
          });
        });
      },
      60 * 60 * 1000
    );
  }

  // Core storage methods
  public async save(event: WebhookEvent): Promise<void> {
    const startTime = Date.now();

    try {
      const eventData = this.serializeEvent(event);
      const compressed = this.config.enableCompression
        ? this.compressData(eventData)
        : eventData;

      const storedEvent: StoredEvent = {
        id: event.id,
        event,
        storedAt: new Date(),
        expiresAt:
          this.config.maxEventAge > 0
            ? new Date(Date.now() + this.config.maxEventAge)
            : undefined,
        metadata: {
          size: compressed.length,
          compressed: this.config.enableCompression,
          indexed: this.config.enableIndexing,
        },
      };

      // Store based on persistence mode
      switch (this.config.persistenceMode) {
        case 'memory':
          await this.saveToMemory(storedEvent, compressed);
          break;
        case 'redis':
          await this.saveToRedis(storedEvent, compressed);
          break;
        case 'hybrid':
          await Promise.all([
            this.saveToMemory(storedEvent, compressed),
            this.saveToRedis(storedEvent, compressed),
          ]);
          break;
      }

      // Update index
      if (this.config.enableIndexing) {
        this.updateIndex(event);
      }

      // Update metrics
      this.updateMetrics(storedEvent);

      this.logger.debug('Event saved', {
        eventId: event.id,
        entityType: event.entityType,
        size: storedEvent.metadata.size,
        compressed: storedEvent.metadata.compressed,
        storageTime: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error('Error saving event', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async saveToMemory(
    storedEvent: StoredEvent,
    _data: string
  ): Promise<void> {
    this.memoryStore.set(storedEvent.id, storedEvent);
  }

  private async saveToRedis(
    storedEvent: StoredEvent,
    data: string
  ): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis not configured');
    }

    const key = this.getEventKey(storedEvent.id);
    const metaKey = this.getEventMetaKey(storedEvent.id);

    const pipeline = this.redis.pipeline();

    // Store event data
    pipeline.set(key, data);

    // Store metadata
    pipeline.hset(metaKey, {
      storedAt: storedEvent.storedAt.toISOString(),
      expiresAt: storedEvent.expiresAt?.toISOString() || '',
      size: storedEvent.metadata.size,
      compressed: storedEvent.metadata.compressed ? '1' : '0',
      indexed: storedEvent.metadata.indexed ? '1' : '0',
    });

    // Set expiration if configured
    if (storedEvent.expiresAt) {
      const ttl = Math.floor(
        (storedEvent.expiresAt.getTime() - Date.now()) / 1000
      );
      pipeline.expire(key, ttl);
      pipeline.expire(metaKey, ttl);
    }

    await pipeline.exec();
  }

  public async get(eventId: string): Promise<WebhookEvent | null> {
    try {
      // Try memory first (fastest)
      if (this.config.persistenceMode !== 'redis') {
        const storedEvent = this.memoryStore.get(eventId);
        if (storedEvent) {
          return storedEvent.event;
        }
      }

      // Try Redis if configured
      if (this.redis && this.config.persistenceMode !== 'memory') {
        const event = await this.getFromRedis(eventId);
        if (event) {
          return event;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error retrieving event', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getFromRedis(eventId: string): Promise<WebhookEvent | null> {
    if (!this.redis) {
      return null;
    }

    const key = this.getEventKey(eventId);
    const metaKey = this.getEventMetaKey(eventId);

    const [data, metadata] = await Promise.all([
      this.redis.get(key),
      this.redis.hgetall(metaKey),
    ]);

    if (!data || !metadata.storedAt) {
      return null;
    }

    const compressed = metadata.compressed === '1';
    const eventData = compressed ? this.decompressData(data) : data;

    return this.deserializeEvent(eventData);
  }

  public async getByFilter(filter: EventStoreFilter): Promise<WebhookEvent[]> {
    const startTime = Date.now();
    let eventIds: Set<string>;

    try {
      // Use index for efficient filtering if available
      if (this.config.enableIndexing) {
        eventIds = this.filterByIndex(filter);
      } else {
        // Fallback to scanning all events
        eventIds = await this.scanAllEvents(filter);
      }

      // Retrieve events
      const events: WebhookEvent[] = [];
      const idsArray = Array.from(eventIds);

      // Apply limit and offset
      const startIndex = filter.offset || 0;
      const endIndex = filter.limit
        ? startIndex + filter.limit
        : idsArray.length;
      const selectedIds = idsArray.slice(startIndex, endIndex);

      // Retrieve events in batches
      const batchSize = this.config.batchSize;
      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = selectedIds.slice(i, i + batchSize);
        const batchEvents = await Promise.all(batch.map(id => this.get(id)));

        events.push(
          ...batchEvents.filter((e): e is WebhookEvent => e !== null)
        );
      }

      this.logger.debug('Events retrieved by filter', {
        totalFound: eventIds.size,
        returned: events.length,
        queryTime: Date.now() - startTime,
      });

      return events;
    } catch (error) {
      this.logger.error('Error filtering events', {
        filter,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private filterByIndex(filter: EventStoreFilter): Set<string> {
    let candidateIds: Set<string> = new Set();
    let firstFilter = true;

    // Filter by entity type
    if (filter.entityType) {
      const entityIds =
        this.index.byEntityType.get(filter.entityType) || new Set();
      candidateIds = firstFilter
        ? entityIds
        : this.intersect(candidateIds, entityIds);
      firstFilter = false;
    }

    // Filter by action
    if (filter.action) {
      const actionIds = this.index.byAction.get(filter.action) || new Set();
      candidateIds = firstFilter
        ? actionIds
        : this.intersect(candidateIds, actionIds);
      firstFilter = false;
    }

    // Filter by date range
    if (filter.fromDate || filter.toDate) {
      const dateIds = this.getEventIdsByDateRange(
        filter.fromDate,
        filter.toDate
      );
      candidateIds = firstFilter
        ? dateIds
        : this.intersect(candidateIds, dateIds);
    }

    return candidateIds;
  }

  private async scanAllEvents(filter: EventStoreFilter): Promise<Set<string>> {
    // This is less efficient but works when indexing is disabled
    const allIds = new Set<string>();

    if (this.config.persistenceMode !== 'redis') {
      for (const [id, storedEvent] of this.memoryStore) {
        if (this.eventMatchesFilter(storedEvent.event, filter)) {
          allIds.add(id);
        }
      }
    }

    if (this.redis && this.config.persistenceMode !== 'memory') {
      const pattern = this.getEventKey('*');
      const keys = await this.redis.keys(pattern);

      for (const key of keys) {
        const eventId = this.extractEventIdFromKey(key);
        const event = await this.get(eventId);

        if (event && this.eventMatchesFilter(event, filter)) {
          allIds.add(eventId);
        }
      }
    }

    return allIds;
  }

  private eventMatchesFilter(
    event: WebhookEvent,
    filter: EventStoreFilter
  ): boolean {
    if (filter.entityType && event.entityType !== filter.entityType) {
      return false;
    }

    if (filter.action && event.action !== filter.action) {
      return false;
    }

    if (filter.fromDate && event.timestamp < filter.fromDate) {
      return false;
    }

    if (filter.toDate && event.timestamp > filter.toDate) {
      return false;
    }

    return true;
  }

  public async delete(eventId: string): Promise<void> {
    try {
      // Remove from memory
      if (this.config.persistenceMode !== 'redis') {
        const storedEvent = this.memoryStore.get(eventId);
        if (storedEvent) {
          this.memoryStore.delete(eventId);
          this.removeFromIndex(storedEvent.event);
        }
      }

      // Remove from Redis
      if (this.redis && this.config.persistenceMode !== 'memory') {
        const pipeline = this.redis.pipeline();
        pipeline.del(this.getEventKey(eventId));
        pipeline.del(this.getEventMetaKey(eventId));
        await pipeline.exec();
      }

      this.logger.debug('Event deleted', { eventId });
    } catch (error) {
      this.logger.error('Error deleting event', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async markProcessed(
    eventId: string,
    result: WebhookHandlerResult
  ): Promise<void> {
    try {
      // Update memory store
      if (this.config.persistenceMode !== 'redis') {
        const storedEvent = this.memoryStore.get(eventId);
        if (storedEvent) {
          storedEvent.processingResults = storedEvent.processingResults || [];
          storedEvent.processingResults.push({
            handlerId: '', // This should be passed as parameter
            result,
            processedAt: new Date(),
          });
        }
      }

      // Update Redis store
      if (this.redis && this.config.persistenceMode !== 'memory') {
        const key = this.getEventProcessingKey(eventId);
        const processingRecord = {
          result: JSON.stringify(result),
          processedAt: new Date().toISOString(),
        };

        await this.redis.lpush(key, JSON.stringify(processingRecord));
      }

      this.logger.debug('Event marked as processed', {
        eventId,
        success: result.success,
      });
    } catch (error) {
      this.logger.error('Error marking event as processed', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Indexing methods
  private updateIndex(event: WebhookEvent): void {
    const eventId = event.id;

    // Index by entity type
    if (!this.index.byEntityType.has(event.entityType)) {
      this.index.byEntityType.set(event.entityType, new Set());
    }
    this.index.byEntityType.get(event.entityType)!.add(eventId);

    // Index by action
    if (!this.index.byAction.has(event.action)) {
      this.index.byAction.set(event.action, new Set());
    }
    this.index.byAction.get(event.action)!.add(eventId);

    // Index by timestamp (hour buckets)
    const timestampKey = this.getTimestampKey(event.timestamp);
    if (!this.index.byTimestamp.has(timestampKey)) {
      this.index.byTimestamp.set(timestampKey, new Set());
    }
    this.index.byTimestamp.get(timestampKey)!.add(eventId);

    // Index by source
    const sourceKey = `${event.source.system}:${event.source.zone || 'unknown'}`;
    if (!this.index.bySource.has(sourceKey)) {
      this.index.bySource.set(sourceKey, new Set());
    }
    this.index.bySource.get(sourceKey)!.add(eventId);
  }

  private removeFromIndex(event: WebhookEvent): void {
    const eventId = event.id;

    // Remove from all indexes
    this.index.byEntityType.get(event.entityType)?.delete(eventId);
    this.index.byAction.get(event.action)?.delete(eventId);

    const timestampKey = this.getTimestampKey(event.timestamp);
    this.index.byTimestamp.get(timestampKey)?.delete(eventId);

    const sourceKey = `${event.source.system}:${event.source.zone || 'unknown'}`;
    this.index.bySource.get(sourceKey)?.delete(eventId);
  }

  // Utility methods
  private getEventIdsByDateRange(fromDate?: Date, toDate?: Date): Set<string> {
    const eventIds = new Set<string>();

    for (const [timestampKey, ids] of this.index.byTimestamp) {
      const bucketDate = this.parseTimestampKey(timestampKey);

      if (fromDate && bucketDate < fromDate) continue;
      if (toDate && bucketDate > toDate) continue;

      for (const id of ids) {
        eventIds.add(id);
      }
    }

    return eventIds;
  }

  private intersect<T>(set1: Set<T>, set2: Set<T>): Set<T> {
    const result = new Set<T>();
    for (const item of set1) {
      if (set2.has(item)) {
        result.add(item);
      }
    }
    return result;
  }

  private getTimestampKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }

  private parseTimestampKey(key: string): Date {
    const [year, month, day, hour] = key.split('-').map(Number);
    return new Date(year, month - 1, day, hour);
  }

  private getEventKey(eventId: string): string {
    return `${this.config.keyPrefix}:event:${eventId}`;
  }

  private getEventMetaKey(eventId: string): string {
    return `${this.config.keyPrefix}:meta:${eventId}`;
  }

  private getEventProcessingKey(eventId: string): string {
    return `${this.config.keyPrefix}:processing:${eventId}`;
  }

  private extractEventIdFromKey(key: string): string {
    return key.split(':').pop() || '';
  }

  private serializeEvent(event: WebhookEvent): string {
    return JSON.stringify(event);
  }

  private deserializeEvent(data: string): WebhookEvent {
    return JSON.parse(data);
  }

  private compressData(data: string): string {
    // Simple compression - in production you'd use a proper compression library
    return Buffer.from(data).toString('base64');
  }

  private decompressData(data: string): string {
    return Buffer.from(data, 'base64').toString();
  }

  private updateMetrics(storedEvent: StoredEvent): void {
    this.metrics.totalEvents++;
    this.metrics.storageSize += storedEvent.metadata.size;

    if (
      !this.metrics.oldestEvent ||
      storedEvent.storedAt < this.metrics.oldestEvent
    ) {
      this.metrics.oldestEvent = storedEvent.storedAt;
    }

    if (
      !this.metrics.newestEvent ||
      storedEvent.storedAt > this.metrics.newestEvent
    ) {
      this.metrics.newestEvent = storedEvent.storedAt;
    }

    // Update average event size
    const totalSize =
      this.metrics.averageEventSize * (this.metrics.totalEvents - 1) +
      storedEvent.metadata.size;
    this.metrics.averageEventSize = totalSize / this.metrics.totalEvents;
  }

  private async cleanup(): Promise<void> {
    const cutoffTime = Date.now() - this.config.maxEventAge;
    let cleanedCount = 0;

    try {
      // Clean up memory store
      if (this.config.persistenceMode !== 'redis') {
        for (const [id, storedEvent] of this.memoryStore) {
          if (
            storedEvent.expiresAt &&
            storedEvent.expiresAt.getTime() < cutoffTime
          ) {
            this.memoryStore.delete(id);
            this.removeFromIndex(storedEvent.event);
            cleanedCount++;
          }
        }
      }

      this.logger.debug('Event store cleanup completed', {
        cleanedEvents: cleanedCount,
        remainingEvents: this.metrics.totalEvents - cleanedCount,
      });
    } catch (error) {
      this.logger.error('Event store cleanup error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Public management methods
  public getMetrics(): EventStoreMetrics {
    return { ...this.metrics };
  }

  public async getStorageInfo(): Promise<{
    totalEvents: number;
    memoryEvents: number;
    redisEvents: number;
    indexSize: number;
    storageSize: number;
  }> {
    const memoryEvents = this.memoryStore.size;
    let redisEvents = 0;

    if (this.redis) {
      const pattern = this.getEventKey('*');
      const keys = await this.redis.keys(pattern);
      redisEvents = keys.length;
    }

    return {
      totalEvents: this.metrics.totalEvents,
      memoryEvents,
      redisEvents,
      indexSize: this.calculateIndexSize(),
      storageSize: this.metrics.storageSize,
    };
  }

  private calculateIndexSize(): number {
    let size = 0;
    for (const index of Object.values(this.index)) {
      for (const ids of index.values()) {
        size += ids.size;
      }
    }
    return size;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down event store');

    if (this.redis) {
      await this.redis.quit();
    }

    this.memoryStore.clear();

    this.logger.info('Event store shutdown complete');
  }
}
