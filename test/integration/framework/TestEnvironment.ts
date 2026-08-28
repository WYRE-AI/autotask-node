import { AutotaskClient } from '../../../src/client/AutotaskClient';
import { PerformanceMonitor } from '../../../src/utils/performanceMonitor';
import { BusinessLogicEngine } from '../../../src/business/core/BusinessLogicEngine';

/**
 * Test environment types
 */
export enum TestEnvironmentType {
  SANDBOX = 'sandbox',
  STAGING = 'staging',
  PRODUCTION_READONLY = 'production-readonly'
}

/**
 * Test environment configuration
 */
export interface TestEnvironmentConfig {
  type: TestEnvironmentType;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  maxConcurrentRequests: number;
  rateLimit: {
    requestsPerSecond: number;
    burstLimit: number;
  };
  timeouts: {
    default: number;
    slow: number;
  };
  retries: {
    maxAttempts: number;
    baseDelay: number;
  };
}

/**
 * Test data management
 */
export interface TestDataManager {
  createdEntities: Map<string, Set<number>>;
  rollbackActions: Array<() => Promise<void>>;
  testSession: string;
}

/**
 * Safe test environment for integration testing
 */
export class TestEnvironment {
  private client: AutotaskClient;
  private config: TestEnvironmentConfig;
  private dataManager: TestDataManager;
  private performanceMonitor: PerformanceMonitor;
  private businessLogic: BusinessLogicEngine;
  private initialized = false;

  constructor(client: AutotaskClient, environmentType: TestEnvironmentType = TestEnvironmentType.PRODUCTION_READONLY) {
    this.client = client;
    this.config = this.getEnvironmentConfig(environmentType);
    this.dataManager = {
      createdEntities: new Map(),
      rollbackActions: [],
      testSession: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    this.performanceMonitor = new PerformanceMonitor();
    this.businessLogic = new BusinessLogicEngine();
  }

  /**
   * Initialize the test environment
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize business logic engine
    this.businessLogic.initialize();

    // Validate connection
    await this.validateConnection();

    // Setup monitoring
    this.performanceMonitor.start();

    // Initialize entity tracking
    this.initializeEntityTracking();

    this.initialized = true;
  }

  /**
   * Get environment-specific configuration
   */
  private getEnvironmentConfig(type: TestEnvironmentType): TestEnvironmentConfig {
    const configs: Record<TestEnvironmentType, TestEnvironmentConfig> = {
      [TestEnvironmentType.SANDBOX]: {
        type,
        allowCreate: true,
        allowUpdate: true,
        allowDelete: true,
        maxConcurrentRequests: 10,
        rateLimit: { requestsPerSecond: 5, burstLimit: 10 },
        timeouts: { default: 15000, slow: 30000 },
        retries: { maxAttempts: 3, baseDelay: 1000 }
      },
      [TestEnvironmentType.STAGING]: {
        type,
        allowCreate: false,
        allowUpdate: false,
        allowDelete: false,
        maxConcurrentRequests: 5,
        rateLimit: { requestsPerSecond: 3, burstLimit: 5 },
        timeouts: { default: 20000, slow: 45000 },
        retries: { maxAttempts: 2, baseDelay: 2000 }
      },
      [TestEnvironmentType.PRODUCTION_READONLY]: {
        type,
        allowCreate: false,
        allowUpdate: false,
        allowDelete: false,
        maxConcurrentRequests: 3,
        rateLimit: { requestsPerSecond: 2, burstLimit: 3 },
        timeouts: { default: 30000, slow: 60000 },
        retries: { maxAttempts: 1, baseDelay: 3000 }
      }
    };

    return configs[type];
  }

  /**
   * Validate connection before running tests
   */
  private async validateConnection(): Promise<void> {
    try {
      // Test basic connectivity with a simple list operation
      await this.client.version.list({ pageSize: 1 });
    } catch (error) {
      throw new Error(`Connection validation failed: ${error}`, { cause: error });
    }
  }

  /**
   * Initialize entity tracking for cleanup
   */
  private initializeEntityTracking(): void {
    const entityTypes = ['tickets', 'accounts', 'contacts', 'projects', 'tasks', 'timeentries'];
    for (const entityType of entityTypes) {
      this.dataManager.createdEntities.set(entityType, new Set());
    }
  }

  /**
   * Check if operation is allowed in current environment
   */
  isOperationAllowed(operation: 'create' | 'update' | 'delete'): boolean {
    switch (operation) {
      case 'create': return this.config.allowCreate;
      case 'update': return this.config.allowUpdate;
      case 'delete': return this.config.allowDelete;
      default: return false;
    }
  }

  /**
   * Get client instance
   */
  getClient(): AutotaskClient {
    return this.client;
  }

  /**
   * Get environment configuration
   */
  getConfig(): TestEnvironmentConfig {
    return this.config;
  }

  /**
   * Get performance monitor
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor;
  }

  /**
   * Get business logic engine
   */
  getBusinessLogic(): BusinessLogicEngine {
    return this.businessLogic;
  }

  /**
   * Register created entity for cleanup
   */
  registerCreatedEntity(entityType: string, id: number): void {
    const entities = this.dataManager.createdEntities.get(entityType);
    if (entities) {
      entities.add(id);
    }
  }

  /**
   * Register rollback action
   */
  registerRollbackAction(action: () => Promise<void>): void {
    this.dataManager.rollbackActions.push(action);
  }

  /**
   * Execute with rate limiting
   */
  async executeWithRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    // Simple rate limiting implementation
    const delay = 1000 / this.config.rateLimit.requestsPerSecond;
    await this.wait(delay);
    return await operation();
  }

  /**
   * Execute with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = this.config.retries.maxAttempts
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) break;

        const delay = this.config.retries.baseDelay * Math.pow(2, attempt - 1);
        await this.wait(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Cleanup test data
   */
  async cleanup(): Promise<void> {
    const cleanupResults = {
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Execute rollback actions
    for (const action of this.dataManager.rollbackActions.reverse()) {
      try {
        await action();
        cleanupResults.successful++;
      } catch (error) {
        cleanupResults.failed++;
        cleanupResults.errors.push(`Rollback failed: ${error}`);
      }
    }

    // Clean up created entities (if deletion is allowed)
    if (this.config.allowDelete) {
      for (const [entityType, ids] of this.dataManager.createdEntities) {
        for (const id of ids) {
          try {
            await this.deleteEntity(entityType, id);
            cleanupResults.successful++;
          } catch (error) {
            cleanupResults.failed++;
            cleanupResults.errors.push(`Failed to delete ${entityType} ${id}: ${error}`);
          }
        }
      }
    }

    // Stop performance monitoring
    this.performanceMonitor.stop();

    // Log cleanup results
    console.log(`Cleanup completed: ${cleanupResults.successful} successful, ${cleanupResults.failed} failed`);
    if (cleanupResults.errors.length > 0) {
      console.warn('Cleanup errors:', cleanupResults.errors);
    }
  }

  /**
   * Delete entity by type and ID
   */
  private async deleteEntity(entityType: string, id: number): Promise<void> {
    const client = this.client as any;
    const entityClient = client[entityType];
    
    if (!entityClient || typeof entityClient.delete !== 'function') {
      throw new Error(`No delete method available for entity type: ${entityType}`);
    }

    await entityClient.delete(id);
  }

  /**
   * Wait for specified time
   */
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get test session ID
   */
  getTestSession(): string {
    return this.dataManager.testSession;
  }

  /**
   * Get created entities for reporting
   */
  getCreatedEntities(): Map<string, Set<number>> {
    return this.dataManager.createdEntities;
  }
}
