#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';

/**
 * AutotaskClient Generator
 * Generates comprehensive client with all entities from autotask-complete-entities.json
 */

interface EntityMetadata {
  name: string;
  pluralName: string;
  apiEndpoint: string;
  supportedOperations: string[];
  description: string;
  category: string;
  fileName: string;
}

interface EntitiesData {
  metadata: {
    lastUpdated: string;
    totalEntitiesFound: number;
    source: string;
    documentation_url: string;
    notes: string;
  };
  categories: Record<
    string,
    {
      description: string;
      entities: string[];
    }
  >;
  entities: EntityMetadata[];
}

class ClientGenerator {
  private readonly projectRoot: string;
  private readonly clientFile: string;
  private readonly dataFile: string;

  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
    this.clientFile = path.join(
      this.projectRoot,
      'src',
      'client',
      'AutotaskClient.ts'
    );
    this.dataFile = path.join(
      this.projectRoot,
      'src',
      'data',
      'autotask-complete-entities.json'
    );
  }

  /**
   * Load entity metadata from JSON file
   */
  private loadEntityData(): EntitiesData {
    try {
      const data = fs.readFileSync(this.dataFile, 'utf8');
      return JSON.parse(data) as EntitiesData;
    } catch (error) {
      throw new Error(`Failed to load entity data: ${error}`, { cause: error });
    }
  }

  /**
   * Convert entity name to camelCase for property names
   */
  private toCamelCase(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Convert entity name to PascalCase for class names
   */
  private toPascalCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Generate imports for all entities
   */
  private generateImports(entities: EntityMetadata[]): string {
    const imports = entities
      .map(entity => entity.pluralName)
      .sort()
      .map(pluralName => `  ${this.toPascalCase(pluralName)},`)
      .join('\n');

    return `import {
${imports}
} from '../entities';`;
  }

  /**
   * Generate property declarations grouped by category
   */
  private generatePropertyDeclarations(entitiesData: EntitiesData): string {
    const declarations: string[] = [];

    for (const [categoryKey, category] of Object.entries(
      entitiesData.categories
    )) {
      declarations.push(`  // ${category.description}`);

      for (const entityName of category.entities) {
        const entity = entitiesData.entities.find(e => e.name === entityName);
        if (entity) {
          const propertyName = this.toCamelCase(entity.pluralName);
          const className = this.toPascalCase(entity.pluralName);
          const description = entity.description;

          declarations.push(
            `  /** ${entity.pluralName} entity - ${description} */`
          );
          declarations.push(`  public ${propertyName}: ${className};`);
        }
      }
      declarations.push(''); // Add empty line between categories
    }

    return declarations.join('\n');
  }

  /**
   * Generate entity initializations grouped by category
   */
  private generateEntityInitializations(entitiesData: EntitiesData): string {
    const initializations: string[] = [];

    for (const [categoryKey, category] of Object.entries(
      entitiesData.categories
    )) {
      initializations.push(`    // ${category.description}`);

      for (const entityName of category.entities) {
        const entity = entitiesData.entities.find(e => e.name === entityName);
        if (entity) {
          const propertyName = this.toCamelCase(entity.pluralName);
          const className = this.toPascalCase(entity.pluralName);

          initializations.push(
            `    this.${propertyName} = new ${className}(this.axios, this.logger);`
          );
        }
      }
      initializations.push(''); // Add empty line between categories
    }

    return initializations.join('\n');
  }

  /**
   * Generate the complete AutotaskClient with all entities
   */
  generateClient(): void {
    const entitiesData = this.loadEntityData();
    const imports = this.generateImports(entitiesData.entities);
    const propertyDeclarations =
      this.generatePropertyDeclarations(entitiesData);
    const entityInitializations =
      this.generateEntityInitializations(entitiesData);

    const clientCode = `import { AxiosInstance } from 'axios';
import axios from 'axios';
import winston from 'winston';
import { RequestHandler } from '../utils/requestHandler';
import { AutotaskAuth, PerformanceConfig, ConfigurationError } from '../types';
${imports}
import * as http from 'http';
import * as https from 'https';

/**
 * Rate limiter to prevent overwhelming the API
 */
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number = 1000; // 1 second

  constructor(requestsPerSecond: number) {
    this.maxRequests = requestsPerSecond;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Remove requests older than 1 second
    this.requests = this.requests.filter(time => now - time < this.timeWindow);

    if (this.requests.length >= this.maxRequests) {
      // Wait until the oldest request is more than 1 second old
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.waitForSlot(); // Recursive call to check again
      }
    }

    this.requests.push(now);
  }
}

/**
 * AutotaskClient - Main client for interacting with the Autotask REST API
 * 
 * This client provides access to all ${entitiesData.entities.length}+ Autotask API entities through a unified interface.
 * It includes built-in rate limiting, performance optimizations, connection pooling,
 * and comprehensive error handling.
 * 
 * @example
 * \`\`\`typescript
 * const client = await AutotaskClient.create({
 *   username: 'your_username',
 *   integrationCode: 'your_integration_code', 
 *   secret: 'your_secret'
 * });
 * 
 * // Access any entity
 * const tickets = await client.tickets.list({ filter: 'status eq Open' });
 * const companies = await client.companies.list();
 * \`\`\`
 */
export class AutotaskClient {
  private axios: AxiosInstance;
  private requestHandler: RequestHandler;
  private rateLimiter: RateLimiter;
  private performanceConfig: Required<PerformanceConfig>;
  private logger: winston.Logger;

${propertyDeclarations}

  private constructor(
    private config: AutotaskAuth,
    axiosInstance: AxiosInstance,
    performanceConfig?: PerformanceConfig
  ) {
    // Set default performance configuration
    this.performanceConfig = {
      timeout: 30000,
      maxConcurrentRequests: 10,
      enableConnectionPooling: true,
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 10 * 1024 * 1024, // 10MB
      enableCompression: true,
      requestsPerSecond: 5,
      keepAliveTimeout: 30000,
      ...performanceConfig,
    };

    this.rateLimiter = new RateLimiter(
      this.performanceConfig.requestsPerSecond
    );

    this.logger = winston.createLogger({
      level: 'info',
      transports: [new winston.transports.Console()],
    });
    this.axios = axiosInstance;
    this.requestHandler = new RequestHandler(this.axios, this.logger, {
      timeout: this.performanceConfig.timeout,
      retries: 3,
      baseDelay: 1000,
    });

    // Setup rate limiting interceptor
    this.setupRateLimitingInterceptor();

    // Initialize all entities with proper dependency injection
${entityInitializations}  }

  /**
   * Setup rate limiting interceptor to prevent overwhelming the API
   */
  private setupRateLimitingInterceptor(): void {
    this.axios.interceptors.request.use(async config => {
      // Wait for rate limiter slot before making request
      await this.rateLimiter.waitForSlot();
      return config;
    });
  }

  /**
   * Creates a new AutotaskClient instance with comprehensive entity coverage.
   * 
   * This factory method handles:
   * - Automatic zone detection via Autotask API
   * - Environment variable loading from .env files
   * - Performance optimization configuration
   * - Rate limiting and connection pooling setup
   * - Complete initialization of all ${entitiesData.entities.length}+ API entities
   * 
   * @param config - Authentication configuration. If not provided, will use environment variables
   * @param performanceConfig - Optional performance and optimization settings
   * @returns Promise<AutotaskClient> - Fully configured client instance
   * 
   * @example
   * \`\`\`typescript
   * // Using explicit configuration
   * const client = await AutotaskClient.create({
   *   username: 'your_username',
   *   integrationCode: 'your_integration_code',
   *   secret: 'your_secret',
   *   apiUrl: 'https://webservices12.autotask.net/ATServicesRest/v1.0/' // optional
   * });
   * 
   * // Using environment variables
   * const client = await AutotaskClient.create();
   * 
   * // With performance configuration
   * const client = await AutotaskClient.create(config, {
   *   timeout: 60000,
   *   maxConcurrentRequests: 20,
   *   requestsPerSecond: 10
   * });
   * \`\`\`
   */
  static async create(
    config?: AutotaskAuth,
    performanceConfig?: PerformanceConfig
  ): Promise<AutotaskClient> {
    // Create a logger for this static method
    const logger = winston.createLogger({
      level: process.env.NODE_ENV === 'test' ? 'error' : 'info',
      format: winston.format.simple(),
      transports: [new winston.transports.Console()],
      silent:
        process.env.NODE_ENV === 'test' &&
        !process.env.DEBUG_TESTS &&
        !process.env.DEBUG_INTEGRATION_TESTS,
    });

    // If no config is provided, try to use environment variables
    if (!config) {
      config = {
        username: process.env.AUTOTASK_USERNAME!,
        integrationCode: process.env.AUTOTASK_INTEGRATION_CODE!,
        secret: process.env.AUTOTASK_SECRET!,
        apiUrl: process.env.AUTOTASK_API_URL,
      };

      if (!config.username || !config.integrationCode || !config.secret) {
        throw new ConfigurationError(
          'Missing required environment variables: AUTOTASK_USERNAME, AUTOTASK_INTEGRATION_CODE, AUTOTASK_SECRET'
        );
      }
    } else {
      // Validate provided config
      if (!config.username || config.username.trim() === '') {
        throw new ConfigurationError(
          'Username is required and cannot be empty',
          'username'
        );
      }
      if (!config.integrationCode || config.integrationCode.trim() === '') {
        throw new ConfigurationError(
          'Integration code is required and cannot be empty',
          'integrationCode'
        );
      }
      if (!config.secret || config.secret.trim() === '') {
        throw new ConfigurationError(
          'Secret is required and cannot be empty',
          'secret'
        );
      }
    }

    // If API URL is not provided, detect it using the zone endpoint
    if (!config.apiUrl) {
      try {
        logger.info('Detecting Autotask zone for API URL...');
        const zoneResponse = await axios.get(
          \`https://webservices.autotask.net/ATServicesRest/V1.0/zoneInformation?user=\${encodeURIComponent(
            config.username
          )}\`
        );
        const zoneUrl = zoneResponse.data.url + 'v1.0/';
        config.apiUrl = zoneUrl;
        logger.info(\`Auto-detected API URL: \${zoneUrl}\`);
      } catch (error) {
        throw new ConfigurationError(
          'Failed to auto-detect API URL. Please provide apiUrl in config.',
          'apiUrl',
          error as Error
        );
      }
    }

    // Set default performance configuration
    const defaultPerformanceConfig: Required<PerformanceConfig> = {
      timeout: 30000,
      maxConcurrentRequests: 10,
      enableConnectionPooling: true,
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 10 * 1024 * 1024, // 10MB
      enableCompression: true,
      requestsPerSecond: 5,
      keepAliveTimeout: 30000,
      ...performanceConfig,
    };

    // Setup connection pooling for better performance
    const httpAgent = new http.Agent({
      keepAlive: defaultPerformanceConfig.enableConnectionPooling,
      keepAliveMsecs: defaultPerformanceConfig.keepAliveTimeout,
      maxSockets: defaultPerformanceConfig.maxConcurrentRequests,
    });

    const httpsAgent = new https.Agent({
      keepAlive: defaultPerformanceConfig.enableConnectionPooling,
      keepAliveMsecs: defaultPerformanceConfig.keepAliveTimeout,
      maxSockets: defaultPerformanceConfig.maxConcurrentRequests,
    });

    // Create axios instance with authentication and performance settings
    const axiosInstance = axios.create({
      baseURL: config.apiUrl,
      timeout: defaultPerformanceConfig.timeout,
      maxContentLength: defaultPerformanceConfig.maxContentLength,
      maxBodyLength: defaultPerformanceConfig.maxBodyLength,
      decompress: defaultPerformanceConfig.enableCompression,
      httpAgent,
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'ApiIntegrationCode': config.integrationCode,
        'UserName': config.username,
        'Secret': config.secret,
      },
      transformRequest: [
        (data, headers) => {
          if (defaultPerformanceConfig.enableCompression && data) {
            headers['Content-Encoding'] = 'gzip';
          }
          return JSON.stringify(data);
        },
      ],
    });

    // Test the connection with a simple request
    try {
      logger.info('Testing API connection...');
      await axiosInstance.get('/CompanyCategories');
      logger.info('API connection successful');
    } catch (error) {
      throw new ConfigurationError(
        'Failed to connect to Autotask API. Please check your credentials and API URL.',
        'connection',
        error as Error
      );
    }

    return new AutotaskClient(config, axiosInstance, performanceConfig);
  }

  /**
   * Test the API connection
   * @returns Promise<boolean> - true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.axios.get('/CompanyCategories');
      return true;
    } catch (error) {
      this.logger.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AutotaskAuth> {
    return { ...this.config };
  }

  /**
   * Get performance metrics and configuration
   */
  getPerformanceConfig(): Readonly<Required<PerformanceConfig>> {
    return { ...this.performanceConfig };
  }
}
`;

    // Write the generated client to file
    fs.writeFileSync(this.clientFile, clientCode, 'utf8');
    console.log(
      `✅ Generated comprehensive AutotaskClient with ${entitiesData.entities.length} entities at ${this.clientFile}`
    );
  }
}

/**
 * CLI Interface
 */
async function main(): Promise<void> {
  try {
    const generator = new ClientGenerator();
    generator.generateClient();
    console.log('🎉 AutotaskClient generation completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { ClientGenerator };
