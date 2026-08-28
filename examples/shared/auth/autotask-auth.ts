/**
 * Autotask authentication helper for example applications
 */

import { AutotaskClient } from '../../../src/client/AutotaskClient';
import { ValidatedAutotaskClient } from '../../../src/client/ValidatedAutotaskClient';
import { AppConfig } from '../types/common';
import { createLogger } from '../utils/logger';

const logger = createLogger('autotask-auth');

export class AutotaskAuthManager {
  private client: AutotaskClient | null = null;
  private validatedClient: ValidatedAutotaskClient | null = null;
  private config: AppConfig;
  private connectionVerified: boolean = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Initialize and verify Autotask connection
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Autotask connection...');
      
      // Create the basic client
      this.client = new AutotaskClient({
        username: this.config.autotask.username,
        secret: this.config.autotask.secret,
        integrationCode: this.config.autotask.integrationCode,
        baseURL: this.config.autotask.baseURL,
      });

      // Create the validated client
      this.validatedClient = new ValidatedAutotaskClient({
        username: this.config.autotask.username,
        secret: this.config.autotask.secret,
        integrationCode: this.config.autotask.integrationCode,
        baseURL: this.config.autotask.baseURL,
      });

      // Verify connection by making a test request
      await this.verifyConnection();
      
      logger.info('Autotask connection initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Autotask connection:', error);
      throw new Error(`Autotask authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Verify the connection is working
   */
  private async verifyConnection(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      // Try to fetch a small amount of data to verify connection
      const response = await this.client.query('Companies', {
        pageSize: 1,
      });

      if (!response || !response.items) {
        throw new Error('Invalid response from Autotask API');
      }

      this.connectionVerified = true;
      logger.info(`Connection verified. Found ${response.items.length} companies in test query.`);
    } catch (error) {
      logger.error('Connection verification failed:', error);
      throw error;
    }
  }

  /**
   * Get the basic Autotask client
   */
  getClient(): AutotaskClient {
    if (!this.client || !this.connectionVerified) {
      throw new Error('Autotask client not initialized or connection not verified');
    }
    return this.client;
  }

  /**
   * Get the validated Autotask client
   */
  getValidatedClient(): ValidatedAutotaskClient {
    if (!this.validatedClient || !this.connectionVerified) {
      throw new Error('Validated Autotask client not initialized or connection not verified');
    }
    return this.validatedClient;
  }

  /**
   * Check if the connection is healthy
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string; responseTime?: number }> {
    if (!this.client || !this.connectionVerified) {
      return {
        healthy: false,
        error: 'Client not initialized',
      };
    }

    try {
      const startTime = Date.now();
      await this.client.query('Companies', { pageSize: 1 });
      const responseTime = Date.now() - startTime;

      return {
        healthy: true,
        responseTime,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { initialized: boolean; verified: boolean } {
    return {
      initialized: !!this.client && !!this.validatedClient,
      verified: this.connectionVerified,
    };
  }

  /**
   * Refresh the connection if needed
   */
  async refresh(): Promise<void> {
    logger.info('Refreshing Autotask connection...');
    this.connectionVerified = false;
    await this.verifyConnection();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Autotask connection...');
    this.client = null;
    this.validatedClient = null;
    this.connectionVerified = false;
  }
}

/**
 * Singleton instance for shared use across the application
 */
let autotaskAuthManager: AutotaskAuthManager | null = null;

/**
 * Get the global Autotask authentication manager
 */
export function getAutotaskAuthManager(config?: AppConfig): AutotaskAuthManager {
  if (!autotaskAuthManager) {
    if (!config) {
      throw new Error('Configuration required for initial setup');
    }
    autotaskAuthManager = new AutotaskAuthManager(config);
  }
  return autotaskAuthManager;
}

/**
 * Initialize the global Autotask authentication manager
 */
export async function initializeAutotaskAuth(config: AppConfig): Promise<void> {
  const authManager = getAutotaskAuthManager(config);
  await authManager.initialize();
}

/**
 * Helper function to get a configured Autotask client
 */
export function getAutotaskClient(): AutotaskClient {
  if (!autotaskAuthManager) {
    throw new Error('Autotask authentication manager not initialized');
  }
  return autotaskAuthManager.getClient();
}

/**
 * Helper function to get a configured validated Autotask client
 */
export function getValidatedAutotaskClient(): ValidatedAutotaskClient {
  if (!autotaskAuthManager) {
    throw new Error('Autotask authentication manager not initialized');
  }
  return autotaskAuthManager.getValidatedClient();
}