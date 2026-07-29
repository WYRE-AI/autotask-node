import { AxiosInstance } from 'axios';
import axios from 'axios';
import winston from 'winston';
import { RequestHandler } from '../utils/requestHandler';
import { AutotaskAuth, PerformanceConfig, ConfigurationError } from '../types';
import * as http from 'http';
import * as https from 'https';
import {
  ErrorLogger,
  LogContext,
  defaultErrorLogger,
} from '../errors/ErrorLogger';

// Import all sub-clients
import {
  CoreClient,
  ContractClient,
  FinancialClient,
  ConfigurationClient,
  TimeTrackingClient,
  KnowledgeClient,
  InventoryClient,
  ReportsClient,
  ISubClient,
} from './sub-clients';

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
 * AutotaskClient - Production-ready client for the Autotask REST API
 *
 * This refactored client provides clean separation of concerns through category-based
 * sub-clients, each handling related business functionality:
 *
 * @example
 * ```typescript
 * const client = await AutotaskClient.create({
 *   username: 'your_username',
 *   integrationCode: 'your_integration_code',
 *   secret: 'your_secret'
 * });
 *
 * // Access organized sub-clients
 * const tickets = await client.core.tickets.list({ filter: 'status eq Open' });
 * const contracts = await client.contractsClient.contracts.list();
 * const invoices = await client.financial.invoices.list();
 *
 * // Still supports direct access for backward compatibility
 * const directTickets = await client.tickets.list();
 * ```
 */
export class AutotaskClient {
  private axios: AxiosInstance;
  private requestHandler: RequestHandler;
  private rateLimiter: RateLimiter;
  private performanceConfig: Required<PerformanceConfig>;
  private logger: winston.Logger;
  private errorLogger: ErrorLogger;
  private subClients: Map<string, ISubClient> = new Map();
  private isFullyInitialized = false;

  // Category-based sub-clients for organized access
  /** Core business entities: Companies, Contacts, Tickets, Projects, Tasks, Opportunities, Resources */
  public readonly core: CoreClient;

  /** Contract management: Contracts, Services, Billing Rules, Service Calls */
  public readonly contractsClient: ContractClient;

  /** Financial operations: Invoices, Quotes, Purchase Orders, Billing, Expenses */
  public readonly financial: FinancialClient;

  /** System configuration: Assets, Locations, Departments, Reference Data */
  public readonly configuration: ConfigurationClient;

  /** Time tracking: Time Entries, Schedules, Availability, Time Off */
  public readonly timeTracking: TimeTrackingClient;

  /** Knowledge management: Articles, Documents, Checklists, Tags */
  public readonly knowledge: KnowledgeClient;

  /** Inventory management: Products, Stock, Transfers, Subscriptions */
  public readonly inventory: InventoryClient;

  /** Reporting and analytics: Audit Logs, Surveys, Portal Users, Change Tracking */
  public readonly reports: ReportsClient;

  // Lazy-loaded backward compatibility properties (see bottom of class)
  private _directEntityCache: Map<string, any> = new Map();

  private constructor(
    private config: AutotaskAuth,
    axiosInstance: AxiosInstance,
    performanceConfig?: PerformanceConfig,
    errorLogger?: ErrorLogger
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
      transports: [
        new winston.transports.Console({
          stderrLevels: [
            'error',
            'warn',
            'info',
            'http',
            'verbose',
            'debug',
            'silly',
          ],
        }),
      ],
    });

    this.errorLogger = errorLogger || defaultErrorLogger;

    this.axios = axiosInstance;
    this.requestHandler = new RequestHandler(
      this.axios,
      this.logger,
      {
        timeout: this.performanceConfig.timeout,
        retries: 3,
        baseDelay: 1000,
      },
      this.errorLogger
    );

    // Setup rate limiting interceptor
    this.setupRateLimitingInterceptor();

    // Initialize all sub-clients
    this.core = new CoreClient(this.axios, this.logger);
    this.contractsClient = new ContractClient(this.axios, this.logger);
    this.financial = new FinancialClient(this.axios, this.logger);
    this.configuration = new ConfigurationClient(this.axios, this.logger);
    this.timeTracking = new TimeTrackingClient(this.axios, this.logger);
    this.knowledge = new KnowledgeClient(this.axios, this.logger);
    this.inventory = new InventoryClient(this.axios, this.logger);
    this.reports = new ReportsClient(this.axios, this.logger);

    // Register sub-clients for management
    this.subClients.set('core', this.core);
    this.subClients.set('contracts', this.contractsClient);
    this.subClients.set('financial', this.financial);
    this.subClients.set('configuration', this.configuration);
    this.subClients.set('timeTracking', this.timeTracking);
    this.subClients.set('knowledge', this.knowledge);
    this.subClients.set('inventory', this.inventory);
    this.subClients.set('reports', this.reports);
  }

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
   * Creates a new AutotaskClient instance with organized sub-client architecture.
   *
   * This factory method handles:
   * - Automatic zone detection via Autotask API
   * - Environment variable loading from .env files
   * - Performance optimization configuration
   * - Rate limiting and connection pooling setup
   * - Lazy initialization of sub-clients for optimal startup time
   *
   * @param config - Authentication configuration. If not provided, will use environment variables
   * @param performanceConfig - Optional performance and optimization settings
   * @returns Promise<AutotaskClient> - Fully configured client instance
   *
   * @example
   * ```typescript
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
   * ```
   */
  static async create(
    config?: AutotaskAuth,
    performanceConfig?: PerformanceConfig,
    errorLogger?: ErrorLogger
  ): Promise<AutotaskClient> {
    // Create a logger for this static method
    const logger = winston.createLogger({
      level: process.env.NODE_ENV === 'test' ? 'error' : 'info',
      format: winston.format.simple(),
      transports: [
        new winston.transports.Console({
          stderrLevels: [
            'error',
            'warn',
            'info',
            'http',
            'verbose',
            'debug',
            'silly',
          ],
        }),
      ],
      silent:
        process.env.NODE_ENV === 'test' &&
        !process.env.DEBUG_TESTS &&
        !process.env.DEBUG_INTEGRATION_TESTS,
    });

    // If no config is provided, try to use environment variables
    if (!config) {
      const rawImpersonationId = process.env.AUTOTASK_IMPERSONATION_RESOURCE_ID;
      let impersonationResourceId: number | undefined;
      if (
        rawImpersonationId !== undefined &&
        rawImpersonationId.trim() !== ''
      ) {
        impersonationResourceId = Number(rawImpersonationId);
        if (
          !Number.isInteger(impersonationResourceId) ||
          impersonationResourceId <= 0
        ) {
          throw new ConfigurationError(
            `AUTOTASK_IMPERSONATION_RESOURCE_ID must be a positive integer, got "${rawImpersonationId}"`,
            'impersonationResourceId'
          );
        }
      }

      // Support both naming conventions for environment variables
      config = {
        username:
          process.env.AUTOTASK_USERNAME || process.env.AUTOTASK_API_USERNAME!,
        integrationCode:
          process.env.AUTOTASK_INTEGRATION_CODE ||
          process.env.AUTOTASK_API_INTEGRATION_CODE!,
        secret: process.env.AUTOTASK_SECRET || process.env.AUTOTASK_API_SECRET!,
        apiUrl: process.env.AUTOTASK_API_URL,
        impersonationResourceId:
          impersonationResourceId === undefined
            ? undefined
            : impersonationResourceId,
      };

      if (!config.username || !config.integrationCode || !config.secret) {
        throw new ConfigurationError(
          'Missing required environment variables. Please set either:\n' +
            '  AUTOTASK_USERNAME, AUTOTASK_INTEGRATION_CODE, AUTOTASK_SECRET\n' +
            'or:\n' +
            '  AUTOTASK_API_USERNAME, AUTOTASK_API_INTEGRATION_CODE, AUTOTASK_API_SECRET'
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
          `https://webservices.autotask.net/ATServicesRest/V1.0/zoneInformation?user=${encodeURIComponent(
            config.username
          )}`
        );
        // Ensure proper URL formatting - zone URL already includes /ATServicesRest/
        let zoneUrl = zoneResponse.data.url;
        if (!zoneUrl.endsWith('/')) {
          zoneUrl += '/';
        }
        zoneUrl += 'v1.0';
        config.apiUrl = zoneUrl;
        logger.info(`Auto-detected API URL: ${zoneUrl}`);

        // Log successful zone detection
        const tempErrorLogger = errorLogger || defaultErrorLogger;
        const correlationId = tempErrorLogger.generateCorrelationId();
        tempErrorLogger.info(
          'Autotask zone detected successfully',
          {
            correlationId,
            operation: 'zone-detection',
            request: {
              url: `https://webservices.autotask.net/ATServicesRest/V1.0/zoneInformation?user=${encodeURIComponent(config.username)}`,
            },
          },
          { detectedUrl: zoneUrl }
        );
      } catch (error) {
        // Log zone detection failure
        const tempErrorLogger = errorLogger || defaultErrorLogger;
        const correlationId = tempErrorLogger.generateCorrelationId();
        tempErrorLogger.error(
          'Failed to detect Autotask zone',
          error as Error,
          {
            correlationId,
            operation: 'zone-detection',
            request: {
              url: `https://webservices.autotask.net/ATServicesRest/V1.0/zoneInformation?user=${encodeURIComponent(config.username)}`,
            },
          }
        );

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
    // Using Autotask's required header authentication format
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
        ApiIntegrationCode: config.integrationCode,
        UserName: config.username,
        Secret: config.secret,
        ...(config.impersonationResourceId && {
          ImpersonationResourceId: String(config.impersonationResourceId),
        }),
      },
      transformRequest: [
        (data, headers) => {
          if (!data) return JSON.stringify(data);
          const json = JSON.stringify(data);
          if (defaultPerformanceConfig.enableCompression) {
            // Actually compress the body when Content-Encoding: gzip is set
            // Requires: import { gzipSync } from 'zlib';
            const { gzipSync } = require('zlib');
            headers!['Content-Encoding'] = 'gzip';
            return gzipSync(Buffer.from(json, 'utf8'));
          }
          return json;
        },
      ],
    });

    // Test the connection with a simple request (skipped in gateway/stateless mode)
    if (config.skipConnectionTest) {
      logger.info('Skipping connection test (skipConnectionTest=true)');
    } else
      try {
        logger.info('Testing API connection...');
        const versionResponse = await axiosInstance.get('/Version');
        logger.info('API connection successful');

        // Log successful connection test
        const tempErrorLogger = errorLogger || defaultErrorLogger;
        const correlationId = tempErrorLogger.generateCorrelationId();
        tempErrorLogger.info(
          'Autotask API connection test successful',
          {
            correlationId,
            operation: 'connection-test',
            request: {
              method: 'GET',
              url: config.apiUrl + '/Version',
            },
          },
          {
            statusCode: versionResponse.status,
            apiVersion: versionResponse.data,
          }
        );
      } catch (error) {
        // Log connection test failure
        const tempErrorLogger = errorLogger || defaultErrorLogger;
        const correlationId = tempErrorLogger.generateCorrelationId();
        tempErrorLogger.error(
          'Failed to connect to Autotask API',
          error as Error,
          {
            correlationId,
            operation: 'connection-test',
            request: {
              method: 'GET',
              url: config.apiUrl + '/Version',
            },
          }
        );

        throw new ConfigurationError(
          'Failed to connect to Autotask API. Please check your credentials and API URL.',
          'connection',
          error as Error
        );
      }

    return new AutotaskClient(
      config,
      axiosInstance,
      performanceConfig,
      errorLogger
    );
  }

  /**
   * Initialize all sub-clients (lazy loading)
   */
  async initializeAllSubClients(): Promise<void> {
    if (this.isFullyInitialized) {
      return;
    }

    this.logger.info('Initializing all sub-clients...');

    const initPromises = Array.from(this.subClients.values()).map(subClient =>
      subClient.initialize()
    );

    await Promise.all(initPromises);
    this.isFullyInitialized = true;

    this.logger.info('All sub-clients initialized successfully');
  }

  /**
   * Test the API connection
   * @returns Promise<boolean> - true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.axios.get('/Version');
      return true;
    } catch (error) {
      this.logger.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Test connectivity for all sub-clients
   */
  async testAllSubClientConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, subClient] of this.subClients.entries()) {
      try {
        results[name] = await subClient.testConnection();
      } catch (error) {
        this.logger.error(`Connection test failed for ${name}:`, error);
        results[name] = false;
      }
    }

    return results;
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

  /**
   * Get the request handler instance
   * @returns RequestHandler - The internal request handler
   */
  getRequestHandler(): RequestHandler {
    return this.requestHandler;
  }

  /**
   * Get performance metrics
   * @returns Performance metrics object with detailed statistics
   */
  getPerformanceMetrics(): {
    rateLimiter: {
      requestsPerSecond: number;
    };
    connectionPooling: {
      enabled: boolean;
      maxConcurrentRequests: number;
    };
    timeouts: {
      requestTimeout: number;
      keepAliveTimeout: number;
    };
    limits: {
      maxContentLength: number;
      maxBodyLength: number;
    };
    subClients: {
      initialized: number;
      total: number;
      status: Record<string, boolean>;
    };
  } {
    const subClientStatus: Record<string, boolean> = {};
    let initializedCount = 0;

    for (const [name, subClient] of this.subClients.entries()) {
      const isInitialized = subClient.getInitializationStatus();
      subClientStatus[name] = isInitialized;
      if (isInitialized) initializedCount++;
    }

    return {
      rateLimiter: {
        requestsPerSecond: this.performanceConfig.requestsPerSecond,
      },
      connectionPooling: {
        enabled: this.performanceConfig.enableConnectionPooling,
        maxConcurrentRequests: this.performanceConfig.maxConcurrentRequests,
      },
      timeouts: {
        requestTimeout: this.performanceConfig.timeout,
        keepAliveTimeout: this.performanceConfig.keepAliveTimeout,
      },
      limits: {
        maxContentLength: this.performanceConfig.maxContentLength,
        maxBodyLength: this.performanceConfig.maxBodyLength,
      },
      subClients: {
        initialized: initializedCount,
        total: this.subClients.size,
        status: subClientStatus,
      },
    };
  }

  /**
   * Update rate limit at runtime
   * @param requestsPerSecond - New requests per second limit
   */
  updateRateLimit(requestsPerSecond: number): void {
    this.performanceConfig.requestsPerSecond = requestsPerSecond;
    this.rateLimiter = new RateLimiter(requestsPerSecond);
  }

  /**
   * Get the logger instance
   * @returns winston.Logger - The internal logger
   */
  getLogger(): winston.Logger {
    return this.logger;
  }

  /**
   * Get the error logger instance
   * @returns ErrorLogger - The structured error logger
   */
  getErrorLogger(): ErrorLogger {
    return this.errorLogger;
  }

  /**
   * Get a specific sub-client by name
   */
  getSubClient(name: string): ISubClient | undefined {
    return this.subClients.get(name);
  }

  /**
   * Get all sub-client names and initialization status
   */
  getSubClientStatus(): Record<string, { initialized: boolean; name: string }> {
    const status: Record<string, { initialized: boolean; name: string }> = {};

    for (const [key, subClient] of this.subClients.entries()) {
      status[key] = {
        initialized: subClient.getInitializationStatus(),
        name: subClient.getName(),
      };
    }

    return status;
  }

  // =============================================================================
  // BACKWARD COMPATIBILITY SECTION
  // =============================================================================
  // The following section provides backward compatibility by exposing all entities
  // directly on the client instance. These are lazy-loaded to maintain performance.

  private getEntityFromSubClient(subClientName: string, entityName: string) {
    const cacheKey = `${subClientName}.${entityName}`;

    if (this._directEntityCache.has(cacheKey)) {
      return this._directEntityCache.get(cacheKey);
    }

    const subClient = (this as any)[subClientName];
    if (subClient && subClient[entityName]) {
      this._directEntityCache.set(cacheKey, subClient[entityName]);
      return subClient[entityName];
    }

    return undefined;
  }

  // Core entities - direct access for backward compatibility
  get companies() {
    return this.getEntityFromSubClient('core', 'companies');
  }
  get contacts() {
    return this.getEntityFromSubClient('core', 'contacts');
  }
  get tickets() {
    return this.getEntityFromSubClient('core', 'tickets');
  }
  get projects() {
    return this.getEntityFromSubClient('core', 'projects');
  }
  get tasks() {
    return this.getEntityFromSubClient('core', 'tasks');
  }
  get opportunities() {
    return this.getEntityFromSubClient('core', 'opportunities');
  }
  get resources() {
    return this.getEntityFromSubClient('core', 'resources');
  }

  // Attachments
  get companyAttachments() {
    return this.getEntityFromSubClient('core', 'companyAttachments');
  }
  get ticketAttachments() {
    return this.getEntityFromSubClient('core', 'ticketAttachments');
  }
  get projectAttachments() {
    return this.getEntityFromSubClient('core', 'projectAttachments');
  }
  get taskAttachments() {
    return this.getEntityFromSubClient('core', 'taskAttachments');
  }
  get resourceAttachments() {
    return this.getEntityFromSubClient('core', 'resourceAttachments');
  }
  get opportunityAttachments() {
    return this.getEntityFromSubClient('core', 'opportunityAttachments');
  }
  get documentAttachments() {
    return this.getEntityFromSubClient('knowledge', 'documentAttachments');
  }
  get expenseItemAttachments() {
    return this.getEntityFromSubClient('financial', 'expenseItemAttachments');
  }
  get expenseReportAttachments() {
    return this.getEntityFromSubClient('financial', 'expenseReportAttachments');
  }
  get salesOrderAttachments() {
    return this.getEntityFromSubClient('financial', 'salesOrderAttachments');
  }
  get timeEntryAttachments() {
    return this.getEntityFromSubClient('timeTracking', 'timeEntryAttachments');
  }
  get attachmentInfo() {
    return this.getEntityFromSubClient('knowledge', 'attachmentInfo');
  }

  // Notes
  get companyNotes() {
    return this.getEntityFromSubClient('core', 'companyNotes');
  }
  get ticketNotes() {
    return this.getEntityFromSubClient('core', 'ticketNotes');
  }
  get projectNotes() {
    return this.getEntityFromSubClient('core', 'projectNotes');
  }
  get taskNotes() {
    return this.getEntityFromSubClient('core', 'taskNotes');
  }
  get contractNotes() {
    return this.getEntityFromSubClient('contractsClient', 'contractNotes');
  }
  get documentNotes() {
    return this.getEntityFromSubClient('knowledge', 'documentNotes');
  }
  get productNotes() {
    return this.getEntityFromSubClient('inventory', 'productNotes');
  }
  get configurationItemNotes() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemNotes'
    );
  }
  get articleNotes() {
    return this.getEntityFromSubClient('knowledge', 'articleNotes');
  }

  // Note attachments
  get companyNoteAttachments() {
    return this.getEntityFromSubClient('core', 'companyNoteAttachments');
  }
  get ticketNoteAttachments() {
    return this.getEntityFromSubClient('core', 'ticketNoteAttachments');
  }
  get projectNoteAttachments() {
    return this.getEntityFromSubClient('core', 'projectNoteAttachments');
  }
  get taskNoteAttachments() {
    return this.getEntityFromSubClient('core', 'taskNoteAttachments');
  }
  get contractNoteAttachments() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractNoteAttachments'
    );
  }
  get configurationItemNoteAttachments() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemNoteAttachments'
    );
  }

  // Contracts and services
  get contracts() {
    return this.getEntityFromSubClient('contractsClient', 'contracts');
  }
  get contractBillingRules() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractBillingRules'
    );
  }
  get contractBlocks() {
    return this.getEntityFromSubClient('contractsClient', 'contractBlocks');
  }
  get contractBlockHourFactors() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractBlockHourFactors'
    );
  }
  get contractCharges() {
    return this.getEntityFromSubClient('contractsClient', 'contractCharges');
  }
  get contractExclusionBillingCodes() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractExclusionBillingCodes'
    );
  }
  get contractExclusionRoles() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractExclusionRoles'
    );
  }
  get contractExclusionSets() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractExclusionSets'
    );
  }
  get contractExclusionSetExcludedRoles() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractExclusionSetExcludedRoles'
    );
  }
  get contractExclusionSetExcludedWorkTypes() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractExclusionSetExcludedWorkTypes'
    );
  }
  get contractMilestones() {
    return this.getEntityFromSubClient('contractsClient', 'contractMilestones');
  }
  get contractRates() {
    return this.getEntityFromSubClient('contractsClient', 'contractRates');
  }
  get contractRetainers() {
    return this.getEntityFromSubClient('contractsClient', 'contractRetainers');
  }
  get contractRoleCosts() {
    return this.getEntityFromSubClient('contractsClient', 'contractRoleCosts');
  }
  get contractServices() {
    return this.getEntityFromSubClient('contractsClient', 'contractServices');
  }
  get contractServiceAdjustments() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractServiceAdjustments'
    );
  }
  get contractServiceBundles() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractServiceBundles'
    );
  }
  get contractServiceBundleAdjustments() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractServiceBundleAdjustments'
    );
  }
  get contractServiceBundleUnits() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractServiceBundleUnits'
    );
  }
  get contractServiceUnits() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractServiceUnits'
    );
  }
  get contractTicketPurchases() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'contractTicketPurchases'
    );
  }
  get services() {
    return this.getEntityFromSubClient('contractsClient', 'services');
  }
  get serviceBundles() {
    return this.getEntityFromSubClient('contractsClient', 'serviceBundles');
  }
  get serviceBundleServices() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'serviceBundleServices'
    );
  }
  get serviceCalls() {
    return this.getEntityFromSubClient('contractsClient', 'serviceCalls');
  }
  get serviceCallTasks() {
    return this.getEntityFromSubClient('contractsClient', 'serviceCallTasks');
  }
  get serviceCallTaskResources() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'serviceCallTaskResources'
    );
  }
  get serviceCallTickets() {
    return this.getEntityFromSubClient('contractsClient', 'serviceCallTickets');
  }
  get serviceCallTicketResources() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'serviceCallTicketResources'
    );
  }
  get serviceLevelAgreementResults() {
    return this.getEntityFromSubClient(
      'contractsClient',
      'serviceLevelAgreementResults'
    );
  }

  // Configuration items
  get configurationItems() {
    return this.getEntityFromSubClient('configuration', 'configurationItems');
  }
  get configurationItemAttachments() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemAttachments'
    );
  }
  get configurationItemBillingProductAssociations() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemBillingProductAssociations'
    );
  }
  get configurationItemCategories() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemCategories'
    );
  }
  get configurationItemCategoryUdfAssociations() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemCategoryUdfAssociations'
    );
  }
  get configurationItemDnsRecords() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemDnsRecords'
    );
  }
  get configurationItemRelatedItems() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemRelatedItems'
    );
  }
  get configurationItemSslSubjectAlternativeName() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemSslSubjectAlternativeName'
    );
  }
  get configurationItemTypes() {
    return this.getEntityFromSubClient(
      'configuration',
      'configurationItemTypes'
    );
  }

  // Financial entities
  get billingCodes() {
    return this.getEntityFromSubClient('financial', 'billingCodes');
  }
  get billingItems() {
    return this.getEntityFromSubClient('financial', 'billingItems');
  }
  get billingItemApprovalLevels() {
    return this.getEntityFromSubClient(
      'financial',
      'billingItemApprovalLevels'
    );
  }
  get invoices() {
    return this.getEntityFromSubClient('financial', 'invoices');
  }
  get invoiceTemplates() {
    return this.getEntityFromSubClient('financial', 'invoiceTemplates');
  }
  get quotes() {
    return this.getEntityFromSubClient('financial', 'quotes');
  }
  get quoteItems() {
    return this.getEntityFromSubClient('financial', 'quoteItems');
  }
  get quoteLocations() {
    return this.getEntityFromSubClient('financial', 'quoteLocations');
  }
  get quoteTemplates() {
    return this.getEntityFromSubClient('financial', 'quoteTemplates');
  }
  get purchaseOrders() {
    return this.getEntityFromSubClient('financial', 'purchaseOrders');
  }
  get purchaseOrderItems() {
    return this.getEntityFromSubClient('financial', 'purchaseOrderItems');
  }
  get purchaseOrderItemReceiving() {
    return this.getEntityFromSubClient(
      'financial',
      'purchaseOrderItemReceiving'
    );
  }
  get purchaseApprovals() {
    return this.getEntityFromSubClient('financial', 'purchaseApprovals');
  }
  get changeOrderCharges() {
    return this.getEntityFromSubClient('financial', 'changeOrderCharges');
  }
  get taxes() {
    return this.getEntityFromSubClient('financial', 'taxes');
  }
  get taxCategories() {
    return this.getEntityFromSubClient('financial', 'taxCategories');
  }
  get taxRegions() {
    return this.getEntityFromSubClient('financial', 'taxRegions');
  }
  get currencies() {
    return this.getEntityFromSubClient('financial', 'currencies');
  }
  get paymentTerms() {
    return this.getEntityFromSubClient('financial', 'paymentTerms');
  }
  get salesOrders() {
    return this.getEntityFromSubClient('financial', 'salesOrders');
  }
  get expenseItems() {
    return this.getEntityFromSubClient('financial', 'expenseItems');
  }
  get expenseReports() {
    return this.getEntityFromSubClient('financial', 'expenseReports');
  }
  get additionalInvoiceFieldValues() {
    return this.getEntityFromSubClient(
      'financial',
      'additionalInvoiceFieldValues'
    );
  }

  // Pricing entities
  get priceListMaterialCodes() {
    return this.getEntityFromSubClient('financial', 'priceListMaterialCodes');
  }
  get priceListProducts() {
    return this.getEntityFromSubClient('financial', 'priceListProducts');
  }
  get priceListProductTiers() {
    return this.getEntityFromSubClient('financial', 'priceListProductTiers');
  }
  get priceListRoles() {
    return this.getEntityFromSubClient('financial', 'priceListRoles');
  }
  get priceListServices() {
    return this.getEntityFromSubClient('financial', 'priceListServices');
  }
  get priceListServiceBundles() {
    return this.getEntityFromSubClient('financial', 'priceListServiceBundles');
  }
  get priceListWorkTypeModifiers() {
    return this.getEntityFromSubClient(
      'financial',
      'priceListWorkTypeModifiers'
    );
  }

  // Inventory and product entities
  get inventoryItems() {
    return this.getEntityFromSubClient('inventory', 'inventoryItems');
  }
  get inventoryItemSerialNumbers() {
    return this.getEntityFromSubClient(
      'inventory',
      'inventoryItemSerialNumbers'
    );
  }
  get inventoryLocations() {
    return this.getEntityFromSubClient('inventory', 'inventoryLocations');
  }
  get inventoryProducts() {
    return this.getEntityFromSubClient('inventory', 'inventoryProducts');
  }
  get inventoryStockedItems() {
    return this.getEntityFromSubClient('inventory', 'inventoryStockedItems');
  }
  get inventoryStockedItemsAdd() {
    return this.getEntityFromSubClient('inventory', 'inventoryStockedItemsAdd');
  }
  get inventoryStockedItemsRemove() {
    return this.getEntityFromSubClient(
      'inventory',
      'inventoryStockedItemsRemove'
    );
  }
  get inventoryStockedItemsTransfer() {
    return this.getEntityFromSubClient(
      'inventory',
      'inventoryStockedItemsTransfer'
    );
  }
  get inventoryTransfers() {
    return this.getEntityFromSubClient('inventory', 'inventoryTransfers');
  }
  get products() {
    return this.getEntityFromSubClient('inventory', 'products');
  }
  get productTiers() {
    return this.getEntityFromSubClient('inventory', 'productTiers');
  }
  get productVendors() {
    return this.getEntityFromSubClient('inventory', 'productVendors');
  }
  get subscriptionPeriods() {
    return this.getEntityFromSubClient('inventory', 'subscriptionPeriods');
  }
  get subscriptions() {
    return this.getEntityFromSubClient('inventory', 'subscriptions');
  }

  // Time tracking entities
  get timeEntries() {
    return this.getEntityFromSubClient('timeTracking', 'timeEntries');
  }
  get appointments() {
    return this.getEntityFromSubClient('timeTracking', 'appointments');
  }
  get holidays() {
    return this.getEntityFromSubClient('timeTracking', 'holidays');
  }
  get holidaySets() {
    return this.getEntityFromSubClient('timeTracking', 'holidaySets');
  }
  get resourceDailyAvailabilities() {
    return this.getEntityFromSubClient(
      'timeTracking',
      'resourceDailyAvailabilities'
    );
  }
  get resourceTimeOffAdditional() {
    return this.getEntityFromSubClient(
      'timeTracking',
      'resourceTimeOffAdditional'
    );
  }
  get resourceTimeOffApprovers() {
    return this.getEntityFromSubClient(
      'timeTracking',
      'resourceTimeOffApprovers'
    );
  }
  get resourceTimeOffBalances() {
    return this.getEntityFromSubClient(
      'timeTracking',
      'resourceTimeOffBalances'
    );
  }
  get timeOffRequests() {
    return this.getEntityFromSubClient('timeTracking', 'timeOffRequests');
  }
  get timeOffRequestsApprove() {
    return this.getEntityFromSubClient(
      'timeTracking',
      'timeOffRequestsApprove'
    );
  }
  get timeOffRequestsReject() {
    return this.getEntityFromSubClient('timeTracking', 'timeOffRequestsReject');
  }

  // Knowledge base entities
  get knowledgeBaseArticles() {
    return this.getEntityFromSubClient('knowledge', 'knowledgeBaseArticles');
  }
  get knowledgeBaseCategories() {
    return this.getEntityFromSubClient('knowledge', 'knowledgeBaseCategories');
  }
  get documents() {
    return this.getEntityFromSubClient('knowledge', 'documents');
  }
  get documentCategories() {
    return this.getEntityFromSubClient('knowledge', 'documentCategories');
  }
  get documentChecklistItems() {
    return this.getEntityFromSubClient('knowledge', 'documentChecklistItems');
  }
  get documentChecklistLibraries() {
    return this.getEntityFromSubClient(
      'knowledge',
      'documentChecklistLibraries'
    );
  }
  get documentConfigurationItemAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'documentConfigurationItemAssociations'
    );
  }
  get documentConfigurationItemCategoryAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'documentConfigurationItemCategoryAssociations'
    );
  }
  get documentTagAssociations() {
    return this.getEntityFromSubClient('knowledge', 'documentTagAssociations');
  }
  get documentTicketAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'documentTicketAssociations'
    );
  }
  get documentToArticleAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'documentToArticleAssociations'
    );
  }
  get articleAttachments() {
    return this.getEntityFromSubClient('knowledge', 'articleAttachments');
  }
  get articleConfigurationItemCategoryAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'articleConfigurationItemCategoryAssociations'
    );
  }
  get articlePlainTextContent() {
    return this.getEntityFromSubClient('knowledge', 'articlePlainTextContent');
  }
  get articleTagAssociations() {
    return this.getEntityFromSubClient('knowledge', 'articleTagAssociations');
  }
  get articleTicketAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'articleTicketAssociations'
    );
  }
  get articleToArticleAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'articleToArticleAssociations'
    );
  }
  get articleToDocumentAssociations() {
    return this.getEntityFromSubClient(
      'knowledge',
      'articleToDocumentAssociations'
    );
  }
  get checklistLibraries() {
    return this.getEntityFromSubClient('knowledge', 'checklistLibraries');
  }
  get checklistLibraryChecklistItems() {
    return this.getEntityFromSubClient(
      'knowledge',
      'checklistLibraryChecklistItems'
    );
  }
  get tags() {
    return this.getEntityFromSubClient('knowledge', 'tags');
  }
  get tagGroups() {
    return this.getEntityFromSubClient('knowledge', 'tagGroups');
  }
  get tagAliases() {
    return this.getEntityFromSubClient('knowledge', 'tagAliases');
  }

  // Configuration and system entities
  get departments() {
    return this.getEntityFromSubClient('configuration', 'departments');
  }
  get organizationalLevel1() {
    return this.getEntityFromSubClient('configuration', 'organizationalLevel1');
  }
  get organizationalLevel2() {
    return this.getEntityFromSubClient('configuration', 'organizationalLevel2');
  }
  get organizationalLevelAssociations() {
    return this.getEntityFromSubClient(
      'configuration',
      'organizationalLevelAssociations'
    );
  }
  get organizatonalResources() {
    return this.getEntityFromSubClient(
      'configuration',
      'organizatonalResources'
    );
  }
  get internalLocations() {
    return this.getEntityFromSubClient('configuration', 'internalLocations');
  }
  get internalLocationWithBusinessHours() {
    return this.getEntityFromSubClient(
      'configuration',
      'internalLocationWithBusinessHours'
    );
  }
  get countries() {
    return this.getEntityFromSubClient('configuration', 'countries');
  }
  get roles() {
    return this.getEntityFromSubClient('configuration', 'roles');
  }
  get skills() {
    return this.getEntityFromSubClient('configuration', 'skills');
  }
  get resourceSkills() {
    return this.getEntityFromSubClient('configuration', 'resourceSkills');
  }
  get resourceRoles() {
    return this.getEntityFromSubClient('configuration', 'resourceRoles');
  }
  get resourceRoleDepartments() {
    return this.getEntityFromSubClient(
      'configuration',
      'resourceRoleDepartments'
    );
  }
  get resourceRoleQueues() {
    return this.getEntityFromSubClient('configuration', 'resourceRoleQueues');
  }
  get resourceServiceDeskRoles() {
    return this.getEntityFromSubClient(
      'configuration',
      'resourceServiceDeskRoles'
    );
  }
  get actionTypes() {
    return this.getEntityFromSubClient('configuration', 'actionTypes');
  }
  get classificationIcons() {
    return this.getEntityFromSubClient('configuration', 'classificationIcons');
  }
  get shippingTypes() {
    return this.getEntityFromSubClient('configuration', 'shippingTypes');
  }
  get modules() {
    return this.getEntityFromSubClient('configuration', 'modules');
  }
  get domainRegistrars() {
    return this.getEntityFromSubClient('configuration', 'domainRegistrars');
  }
  get workTypeModifiers() {
    return this.getEntityFromSubClient('configuration', 'workTypeModifiers');
  }
  get phases() {
    return this.getEntityFromSubClient('configuration', 'phases');
  }
  get version() {
    return this.getEntityFromSubClient('configuration', 'version');
  }
  get userDefinedFieldDefinitions() {
    return this.getEntityFromSubClient(
      'configuration',
      'userDefinedFieldDefinitions'
    );
  }
  get userDefinedFieldListItems() {
    return this.getEntityFromSubClient(
      'configuration',
      'userDefinedFieldListItems'
    );
  }

  // Extended core entities
  get companyAlerts() {
    return this.getEntityFromSubClient('core', 'companyAlerts');
  }
  get companyCategories() {
    return this.getEntityFromSubClient('core', 'companyCategories');
  }
  get companyLocations() {
    return this.getEntityFromSubClient('core', 'companyLocations');
  }
  get companySiteConfigurations() {
    return this.getEntityFromSubClient('core', 'companySiteConfigurations');
  }
  get companyTeams() {
    return this.getEntityFromSubClient('core', 'companyTeams');
  }
  get companyToDos() {
    return this.getEntityFromSubClient('core', 'companyToDos');
  }
  get contactBillingProductAssociations() {
    return this.getEntityFromSubClient(
      'core',
      'contactBillingProductAssociations'
    );
  }
  get contactGroups() {
    return this.getEntityFromSubClient('core', 'contactGroups');
  }
  get contactGroupContacts() {
    return this.getEntityFromSubClient('core', 'contactGroupContacts');
  }
  get ticketCategories() {
    return this.getEntityFromSubClient('core', 'ticketCategories');
  }
  get ticketCategoryFieldDefaults() {
    return this.getEntityFromSubClient('core', 'ticketCategoryFieldDefaults');
  }
  get ticketAdditionalConfigurationItems() {
    return this.getEntityFromSubClient(
      'core',
      'ticketAdditionalConfigurationItems'
    );
  }
  get ticketAdditionalContacts() {
    return this.getEntityFromSubClient('core', 'ticketAdditionalContacts');
  }
  get ticketChangeRequestApprovals() {
    return this.getEntityFromSubClient('core', 'ticketChangeRequestApprovals');
  }
  get ticketCharges() {
    return this.getEntityFromSubClient('core', 'ticketCharges');
  }
  get ticketChecklistItems() {
    return this.getEntityFromSubClient('core', 'ticketChecklistItems');
  }
  get ticketChecklistLibraries() {
    return this.getEntityFromSubClient('core', 'ticketChecklistLibraries');
  }
  get ticketHistory() {
    return this.getEntityFromSubClient('core', 'ticketHistory');
  }
  get ticketRmaCredits() {
    return this.getEntityFromSubClient('core', 'ticketRmaCredits');
  }
  get ticketSecondaryResources() {
    return this.getEntityFromSubClient('core', 'ticketSecondaryResources');
  }
  get ticketTagAssociations() {
    return this.getEntityFromSubClient('core', 'ticketTagAssociations');
  }
  get taskPredecessors() {
    return this.getEntityFromSubClient('core', 'taskPredecessors');
  }
  get taskSecondaryResources() {
    return this.getEntityFromSubClient('core', 'taskSecondaryResources');
  }
  get projectCharges() {
    return this.getEntityFromSubClient('core', 'projectCharges');
  }

  // Reporting entities
  get deletedTaskActivityLogs() {
    return this.getEntityFromSubClient('reports', 'deletedTaskActivityLogs');
  }
  get deletedTicketActivityLogs() {
    return this.getEntityFromSubClient('reports', 'deletedTicketActivityLogs');
  }
  get deletedTicketLogs() {
    return this.getEntityFromSubClient('reports', 'deletedTicketLogs');
  }
  get notificationHistory() {
    return this.getEntityFromSubClient('reports', 'notificationHistory');
  }
  get surveys() {
    return this.getEntityFromSubClient('reports', 'surveys');
  }
  get surveyResults() {
    return this.getEntityFromSubClient('reports', 'surveyResults');
  }
  get clientPortalUsers() {
    return this.getEntityFromSubClient('reports', 'clientPortalUsers');
  }
  get changeRequestLinks() {
    return this.getEntityFromSubClient('reports', 'changeRequestLinks');
  }
  get comanagedAssociations() {
    return this.getEntityFromSubClient('reports', 'comanagedAssociations');
  }

  // Backward compatibility aliases
  /** @deprecated Use companies instead */
  get accounts() {
    return this.companies;
  }
  /** @deprecated Use ticketNotes, companyNotes, etc. instead */
  get notes() {
    return this.ticketNotes;
  }
  /** @deprecated Use ticketAttachments, companyAttachments, etc. instead */
  get attachments() {
    return this.ticketAttachments;
  }
  /** @deprecated Use contractServiceAdjustments instead */
  get contractAdjustments() {
    return this.contractServiceAdjustments;
  }
  /** @deprecated Use contractExclusionSets instead */
  get contractExclusions() {
    return this.contractExclusionSets;
  }
  /** @deprecated Use expenseItems instead */
  get expenses() {
    return this.expenseItems;
  }
  /** @deprecated Not directly available - use specific status lookup entities */
  get ticketStatuses() {
    return this.tickets;
  }
  /** @deprecated Not directly available - use specific priority lookup entities */
  get ticketPriorities() {
    return this.tickets;
  }
  /** @deprecated Not directly available - use specific source lookup entities */
  get ticketSources() {
    return this.tickets;
  }

  /**
   * Generic entity creation method for migration purposes
   * Routes to appropriate sub-client based on entity type
   */
  async createEntity(entityType: string, data: any): Promise<any> {
    // Map entity types to their appropriate sub-clients and collections
    const entityMapping: Record<
      string,
      { client: string; collection: string }
    > = {
      Company: { client: 'core', collection: 'companies' },
      Contact: { client: 'core', collection: 'contacts' },
      Ticket: { client: 'core', collection: 'tickets' },
      Project: { client: 'core', collection: 'projects' },
      Task: { client: 'core', collection: 'tasks' },
      Opportunity: { client: 'core', collection: 'opportunities' },
      Resource: { client: 'core', collection: 'resources' },
      Contract: { client: 'contracts', collection: 'contracts' },
    };

    const mapping = entityMapping[entityType];
    if (!mapping) {
      throw new Error(`Unsupported entity type for creation: ${entityType}`);
    }

    // Get the appropriate collection
    const collection = (this as any)[mapping.collection];
    if (!collection || !collection.create) {
      throw new Error(
        `Entity collection ${mapping.collection} not available or does not support creation`
      );
    }

    return await collection.create(data);
  }
}
