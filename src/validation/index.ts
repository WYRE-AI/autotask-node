/**
 * Comprehensive validation and sanitization layer for Autotask SDK
 * Main entry point for all validation functionality
 */

// Core validation engine and registry
export { ValidationEngine } from './core/ValidationEngine';
export { SchemaRegistry } from './core/SchemaRegistry';

// Sanitization system
export { InputSanitizer } from './sanitization/InputSanitizer';

// Security validation
export { SecurityValidator } from './security/SecurityValidator';

// Compliance validation
export { ComplianceValidator } from './compliance/ComplianceValidator';

// Quality assurance
export { QualityAssurance } from './quality/QualityAssurance';

// Types and interfaces
export * from './types/ValidationTypes';

// Factory and configuration
import winston from 'winston';
import { ValidationEngine } from './core/ValidationEngine';
import { SchemaRegistry } from './core/SchemaRegistry';
import { InputSanitizer } from './sanitization/InputSanitizer';
import { SecurityValidator } from './security/SecurityValidator';
import { ComplianceValidator } from './compliance/ComplianceValidator';
import { QualityAssurance } from './quality/QualityAssurance';
import {
  ValidationConfig,
  SanitizationConfig,
  ValidationContext,
  ValidationResult,
  EntitySchema,
  SecurityRule,
  ComplianceRule,
  QualityRule,
} from './types/ValidationTypes';

/**
 * Factory for creating a fully configured validation engine
 */
export class ValidationFactory {
  private static instance: ValidationEngine | null = null;

  /**
   * Create a new validation engine with default configuration
   */
  public static create(logger?: winston.Logger): ValidationEngine {
    const effectiveLogger = logger || this.createDefaultLogger();

    // Create default configuration
    const config: ValidationConfig = {
      strictMode: false,
      enableBusinessRules: true,
      enableSecurityValidation: true,
      enableComplianceChecks: true,
      enableQualityAssurance: true,
      enableSanitization: true,
      enablePerformanceMonitoring: true,
      maxValidationTime: 5000, // 5 seconds
      cacheValidationResults: true,
      auditAllValidations: true,
      customValidators: [],
    };

    const sanitizationConfig: SanitizationConfig = {
      enableXSSProtection: true,
      enableSQLInjectionProtection: true,
      enableScriptInjectionProtection: true,
      enableHTMLSanitization: true,
      enablePIIDetection: true,
      customSanitizers: [],
      whitelistedTags: [
        'b',
        'i',
        'em',
        'strong',
        'u',
        'p',
        'br',
        'span',
        'div',
      ],
      whitelistedAttributes: ['class', 'id'],
    };

    // Create components
    const schemaRegistry = new SchemaRegistry(effectiveLogger);
    const sanitizer = new InputSanitizer(sanitizationConfig, effectiveLogger);
    const securityValidator = new SecurityValidator(effectiveLogger);
    const complianceValidator = new ComplianceValidator(effectiveLogger);
    const qualityAssurance = new QualityAssurance(effectiveLogger);

    // Create validation engine
    const engine = new ValidationEngine(
      schemaRegistry,
      sanitizer,
      securityValidator,
      complianceValidator,
      qualityAssurance,
      effectiveLogger,
      config
    );

    return engine;
  }

  /**
   * Create validation engine with custom configuration
   */
  public static createWithConfig(
    config: Partial<ValidationConfig>,
    sanitizationConfig?: Partial<SanitizationConfig>,
    logger?: winston.Logger
  ): ValidationEngine {
    const effectiveLogger = logger || this.createDefaultLogger();

    // Merge with defaults
    const fullConfig: ValidationConfig = {
      strictMode: false,
      enableBusinessRules: true,
      enableSecurityValidation: true,
      enableComplianceChecks: true,
      enableQualityAssurance: true,
      enableSanitization: true,
      enablePerformanceMonitoring: true,
      maxValidationTime: 5000,
      cacheValidationResults: true,
      auditAllValidations: true,
      customValidators: [],
      ...config,
    };

    const fullSanitizationConfig: SanitizationConfig = {
      enableXSSProtection: true,
      enableSQLInjectionProtection: true,
      enableScriptInjectionProtection: true,
      enableHTMLSanitization: true,
      enablePIIDetection: true,
      customSanitizers: [],
      whitelistedTags: [
        'b',
        'i',
        'em',
        'strong',
        'u',
        'p',
        'br',
        'span',
        'div',
      ],
      whitelistedAttributes: ['class', 'id'],
      ...sanitizationConfig,
    };

    // Create components
    const schemaRegistry = new SchemaRegistry(effectiveLogger);
    const sanitizer = new InputSanitizer(
      fullSanitizationConfig,
      effectiveLogger
    );
    const securityValidator = new SecurityValidator(effectiveLogger);
    const complianceValidator = new ComplianceValidator(effectiveLogger);
    const qualityAssurance = new QualityAssurance(effectiveLogger);

    // Create validation engine
    const engine = new ValidationEngine(
      schemaRegistry,
      sanitizer,
      securityValidator,
      complianceValidator,
      qualityAssurance,
      effectiveLogger,
      fullConfig
    );

    return engine;
  }

  /**
   * Get singleton instance (creates if doesn't exist)
   */
  public static getInstance(logger?: winston.Logger): ValidationEngine {
    if (!this.instance) {
      this.instance = this.create(logger);
    }
    return this.instance;
  }

  /**
   * Reset singleton instance
   */
  public static resetInstance(): void {
    this.instance = null;
  }

  /**
   * Create default logger
   */
  private static createDefaultLogger(): winston.Logger {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'autotask-validation' },
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
}

/**
 * Utility functions for common validation scenarios
 */
export class ValidationUtils {
  /**
   * Quick validation for a single entity with default settings
   */
  public static async validateEntity(
    entity: any,
    entityType: string,
    operation: 'create' | 'update' | 'delete' | 'read' = 'create',
    userId?: string
  ): Promise<ValidationResult> {
    const engine = ValidationFactory.getInstance();

    const context: ValidationContext = {
      operation,
      entityType,
      userId,
      requestId: this.generateRequestId(),
    };

    return engine.validateEntity(entity, context);
  }

  /**
   * Validate multiple entities in batch
   */
  public static async validateBatch(
    entities: Array<{
      entity: any;
      entityType: string;
      operation?: 'create' | 'update' | 'delete' | 'read';
    }>,
    userId?: string
  ): Promise<ValidationResult[]> {
    const engine = ValidationFactory.getInstance();

    const contexts = entities.map(({ entity, entityType, operation }) => ({
      entity,
      context: {
        operation: operation || 'create',
        entityType,
        userId,
        requestId: this.generateRequestId(),
      } as ValidationContext,
    }));

    return engine.validateBatch(contexts);
  }

  /**
   * Quick sanitization for untrusted input
   */
  public static async sanitizeInput(
    data: any,
    entityType: string = 'unknown'
  ): Promise<any> {
    const engine = ValidationFactory.getInstance();

    // Access the sanitizer directly (simplified approach)
    const logger = winston.createLogger({ silent: true });
    const sanitizationConfig: SanitizationConfig = {
      enableXSSProtection: true,
      enableSQLInjectionProtection: true,
      enableScriptInjectionProtection: true,
      enableHTMLSanitization: true,
      enablePIIDetection: true,
      customSanitizers: [],
      whitelistedTags: ['b', 'i', 'em', 'strong', 'u', 'p', 'br'],
      whitelistedAttributes: ['class'],
    };

    const sanitizer = new InputSanitizer(sanitizationConfig, logger);
    return sanitizer.sanitize(data, entityType);
  }

  /**
   * Check if data meets quality thresholds
   */
  public static async checkQuality(
    entity: any,
    entityType: string,
    minOverallScore: number = 80
  ): Promise<{ passed: boolean; score: number; issues: string[] }> {
    const context: ValidationContext = {
      operation: 'read',
      entityType,
      requestId: this.generateRequestId(),
    };

    const result = await ValidationUtils.validateEntity(
      entity,
      entityType,
      'read'
    );

    // Extract quality-related warnings
    const qualityIssues = result.warnings
      .filter(w => w.code.includes('QUALITY'))
      .map(w => w.message);

    // Simplified quality score calculation
    const qualityScore = Math.max(
      0,
      100 - result.errors.length * 20 - result.warnings.length * 5
    );

    return {
      passed: qualityScore >= minOverallScore && result.isValid,
      score: qualityScore,
      issues: [...result.errors.map(e => e.message), ...qualityIssues],
    };
  }

  /**
   * Detect potential security threats in data
   */
  public static async detectThreats(
    data: any
  ): Promise<
    Array<{
      type: string;
      severity: string;
      description: string;
      field?: string;
    }>
  > {
    const logger = winston.createLogger({ silent: true });
    const securityValidator = new SecurityValidator(logger);

    const context: ValidationContext = {
      operation: 'create',
      entityType: 'unknown',
      requestId: this.generateRequestId(),
      securityContext: {
        userId: 'system',
        roles: [],
        permissions: [],
      },
    };

    const result = await securityValidator.validate(data, context);

    return result.errors
      .filter(e => e.category === 'security')
      .map(e => ({
        type: e.code,
        severity: e.severity,
        description: e.message,
        field: e.field,
      }));
  }

  /**
   * Check compliance for specific regulations
   */
  public static async checkCompliance(
    entity: any,
    entityType: string,
    jurisdiction: string = 'global',
    processingPurpose: string[] = ['business']
  ): Promise<{
    compliant: boolean;
    violations: Array<{ regulation: string; issue: string; severity: string }>;
  }> {
    const context: ValidationContext = {
      operation: 'create',
      entityType,
      requestId: this.generateRequestId(),
      complianceContext: {
        jurisdiction,
        processingPurpose,
        consentStatus: 'granted',
      },
    };

    const engine = ValidationFactory.getInstance();
    const result = await engine.validateEntity(entity, context);

    const violations = result.errors
      .filter(e => e.category === 'compliance')
      .map(e => ({
        regulation: 'GDPR', // Simplified
        issue: e.message,
        severity: e.severity,
      }));

    return {
      compliant: violations.length === 0,
      violations,
    };
  }

  /**
   * Generate unique request ID
   */
  private static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Validation decorators for easy integration
 */
export class ValidationDecorators {
  /**
   * Method decorator for automatic validation
   */
  public static validate(
    entityType: string,
    operation: 'create' | 'update' | 'delete' | 'read' = 'create'
  ) {
    return function (
      target: any,
      propertyName: string,
      descriptor: PropertyDescriptor
    ) {
      const method = descriptor.value;

      descriptor.value = async function (...args: any[]) {
        // Assume first argument is the entity data
        const entity = args[0];

        if (entity && typeof entity === 'object') {
          try {
            const result = await ValidationUtils.validateEntity(
              entity,
              entityType,
              operation
            );

            if (!result.isValid) {
              const errorMessage = result.errors.map(e => e.message).join('; ');
              throw new Error(`Validation failed: ${errorMessage}`);
            }

            // Replace entity with sanitized version if available
            if (result.sanitizedData) {
              args[0] = result.sanitizedData;
            }
          } catch (error) {
            throw new Error(
              `Validation error: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error }
            );
          }
        }

        return method.apply(this, args);
      };

      return descriptor;
    };
  }

  /**
   * Class decorator for automatic validation of all methods
   */
  public static validateClass(entityType: string) {
    return function <T extends { new (...args: any[]): object }>(
      constructor: T
    ) {
      return class extends constructor {
        // Add validation to all methods automatically
        // Implementation would introspect methods and add validation
      };
    };
  }
}

/**
 * Express middleware for request validation
 */
export function validationMiddleware(options: {
  entityType: string;
  operation?: 'create' | 'update' | 'delete' | 'read';
  bodyField?: string;
  strict?: boolean;
}) {
  return async (req: any, res: any, next: any) => {
    try {
      const entity = options.bodyField ? req.body[options.bodyField] : req.body;

      if (!entity) {
        return next();
      }

      const result = await ValidationUtils.validateEntity(
        entity,
        options.entityType,
        options.operation || 'create',
        req.user?.id
      );

      if (!result.isValid && options.strict) {
        return res.status(400).json({
          error: 'Validation failed',
          details: result.errors.map(e => ({
            field: e.field,
            message: e.message,
            code: e.code,
          })),
        });
      }

      // Attach validation result to request
      req.validationResult = result;

      // Replace body with sanitized data if available
      if (result.sanitizedData) {
        if (options.bodyField) {
          req.body[options.bodyField] = result.sanitizedData;
        } else {
          req.body = result.sanitizedData;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Export default instance for convenience
export const defaultValidationEngine = ValidationFactory.getInstance();
