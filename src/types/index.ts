export interface AutotaskAuth {
  username: string;
  integrationCode: string;
  secret: string;
  apiUrl?: string; // Optional override
  skipConnectionTest?: boolean; // Skip the /Version connectivity check (useful in gateway/stateless mode)
  impersonationResourceId?: number; // Optional: Autotask Resource ID to impersonate (ImpersonationResourceId header)
}

/**
 * Performance and reliability configuration options
 */
export interface PerformanceConfig {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum number of concurrent requests (default: 10) */
  maxConcurrentRequests?: number;
  /** Enable connection pooling (default: true) */
  enableConnectionPooling?: boolean;
  /** Maximum content length for responses in bytes (default: 50MB) */
  maxContentLength?: number;
  /** Maximum body length for requests in bytes (default: 10MB) */
  maxBodyLength?: number;
  /** Enable request/response compression (default: true) */
  enableCompression?: boolean;
  /** Rate limiting - requests per second (default: 5) */
  requestsPerSecond?: number;
  /** Connection keep-alive timeout in milliseconds (default: 30000) */
  keepAliveTimeout?: number;
}

export interface MethodMetadata {
  operation: string;
  requiredParams: string[];
  optionalParams: string[];
  returnType: string;
  endpoint: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: any;
}

// Enhanced error handling exports
export {
  AutotaskError,
  AuthError,
  ValidationError,
  RateLimitError,
  NotFoundError,
  ServerError,
  NetworkError,
  ConfigurationError,
  createAutotaskError,
  isRetryableError,
  getRetryDelay,
} from '../utils/errors';

// Request handling exports
export {
  RequestHandler,
  RequestOptions,
  RequestContext,
} from '../utils/requestHandler';

// Query builder exports
export * from './queryBuilder';
export { QueryBuilder } from '../utils/queryBuilder';
export { QueryableEntity } from '../utils/queryableEntity';

// Export utility types
export * from '../utils/errors';
export * from '../utils/requestHandler';
export * from '../utils/memoryOptimization';
export * from '../utils/performanceMonitor';
