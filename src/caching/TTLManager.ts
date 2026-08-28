/**
 * TTL (Time-To-Live) Management System
 * 
 * Manages intelligent TTL calculation based on entity types, request patterns,
 * and adaptive algorithms that adjust TTL based on data volatility.
 */

import { EntityCacheConfig, CacheStrategy } from './types';

/**
 * TTL calculation strategies
 */
export enum TTLStrategy {
  /** Fixed TTL based on entity configuration */
  FIXED = 'fixed',
  /** Adaptive TTL based on update frequency */
  ADAPTIVE = 'adaptive',
  /** TTL based on time of day patterns */
  TIME_AWARE = 'time_aware',
  /** TTL based on content volatility */
  VOLATILITY_BASED = 'volatility_based',
  /** TTL based on business rules */
  BUSINESS_RULES = 'business_rules'
}

/**
 * Entity volatility levels affecting TTL
 */
export enum VolatilityLevel {
  VERY_LOW = 'very_low',    // Companies, configuration items
  LOW = 'low',              // Contracts, projects
  MEDIUM = 'medium',        // Resources, contacts
  HIGH = 'high',            // Tasks, opportunities
  VERY_HIGH = 'very_high'   // Tickets, time entries
}

/**
 * TTL calculation context
 */
export interface TTLContext {
  /** Entity type */
  entityType: string;
  /** HTTP method */
  method: string;
  /** Response data for analysis */
  responseData?: any;
  /** Request parameters */
  requestParams?: Record<string, any>;
  /** Current time */
  timestamp: number;
  /** User/session context */
  userContext?: string;
  /** Historical update frequency data */
  updateFrequency?: UpdateFrequencyData;
}

/**
 * Update frequency tracking data
 */
export interface UpdateFrequencyData {
  /** Entity type */
  entityType: string;
  /** Last update timestamp */
  lastUpdate: number;
  /** Average time between updates (ms) */
  avgUpdateInterval: number;
  /** Standard deviation of update intervals */
  updateVariance: number;
  /** Number of updates in tracking window */
  updateCount: number;
  /** Tracking window start */
  windowStart: number;
}

/**
 * TTL calculation result
 */
export interface TTLResult {
  /** Calculated TTL in milliseconds */
  ttl: number;
  /** Strategy used for calculation */
  strategy: TTLStrategy;
  /** Confidence level in the TTL (0-1) */
  confidence: number;
  /** Reasoning for the TTL value */
  reason: string;
  /** Minimum TTL applied */
  minTtl: number;
  /** Maximum TTL applied */
  maxTtl: number;
}

/**
 * Business hours configuration
 */
export interface BusinessHoursConfig {
  /** Start hour (24-hour format) */
  startHour: number;
  /** End hour (24-hour format) */
  endHour: number;
  /** Working days (0 = Sunday, 6 = Saturday) */
  workingDays: number[];
  /** Timezone */
  timezone: string;
}

/**
 * TTL Manager for intelligent time-to-live calculations
 */
export class TTLManager {
  private readonly entityConfigs: Map<string, EntityCacheConfig>;
  private readonly volatilityMap: Map<string, VolatilityLevel>;
  private readonly updateFrequencyMap: Map<string, UpdateFrequencyData> = new Map();
  private readonly businessHours: BusinessHoursConfig;
  
  // Default TTL values in milliseconds
  private readonly DEFAULT_TTLS = {
    [VolatilityLevel.VERY_LOW]: 24 * 60 * 60 * 1000,  // 24 hours
    [VolatilityLevel.LOW]: 8 * 60 * 60 * 1000,        // 8 hours
    [VolatilityLevel.MEDIUM]: 2 * 60 * 60 * 1000,     // 2 hours
    [VolatilityLevel.HIGH]: 30 * 60 * 1000,           // 30 minutes
    [VolatilityLevel.VERY_HIGH]: 5 * 60 * 1000        // 5 minutes
  };

  constructor(
    entityConfigs: Map<string, EntityCacheConfig>,
    businessHours: BusinessHoursConfig = {
      startHour: 8,
      endHour: 18,
      workingDays: [1, 2, 3, 4, 5], // Monday to Friday
      timezone: 'UTC'
    }
  ) {
    this.entityConfigs = entityConfigs;
    this.businessHours = businessHours;
    this.volatilityMap = this.initializeVolatilityMap();
  }

  /**
   * Calculate TTL for a cache entry
   */
  calculateTTL(context: TTLContext, strategy: TTLStrategy = TTLStrategy.ADAPTIVE): TTLResult {
    const entityConfig = this.entityConfigs.get(context.entityType);
    const volatility = this.volatilityMap.get(context.entityType) || VolatilityLevel.MEDIUM;
    
    let ttl: number;
    let confidence: number = 0.8;
    let reason: string;

    switch (strategy) {
      case TTLStrategy.FIXED:
        ({ ttl, reason } = this.calculateFixedTTL(entityConfig, volatility));
        break;
        
      case TTLStrategy.ADAPTIVE:
        ({ ttl, confidence, reason } = this.calculateAdaptiveTTL(context, entityConfig, volatility));
        break;
        
      case TTLStrategy.TIME_AWARE:
        ({ ttl, confidence, reason } = this.calculateTimeAwareTTL(context, entityConfig, volatility));
        break;
        
      case TTLStrategy.VOLATILITY_BASED:
        ({ ttl, reason } = this.calculateVolatilityBasedTTL(context, volatility));
        break;
        
      case TTLStrategy.BUSINESS_RULES:
        ({ ttl, confidence, reason } = this.calculateBusinessRulesTTL(context, entityConfig, volatility));
        break;
        
      default:
        ({ ttl, confidence, reason } = this.calculateAdaptiveTTL(context, entityConfig, volatility));
    }

    // Apply min/max constraints
    const minTtl = entityConfig?.minTtl || 60 * 1000; // 1 minute minimum
    const maxTtl = entityConfig?.maxTtl || 24 * 60 * 60 * 1000; // 24 hours maximum
    
    ttl = Math.max(minTtl, Math.min(maxTtl, ttl));

    return {
      ttl,
      strategy,
      confidence,
      reason,
      minTtl,
      maxTtl
    };
  }

  /**
   * Update frequency tracking for adaptive TTL
   */
  trackUpdate(entityType: string, timestamp: number = Date.now()): void {
    const existing = this.updateFrequencyMap.get(entityType);
    
    if (!existing) {
      this.updateFrequencyMap.set(entityType, {
        entityType,
        lastUpdate: timestamp,
        avgUpdateInterval: this.DEFAULT_TTLS[this.volatilityMap.get(entityType) || VolatilityLevel.MEDIUM],
        updateVariance: 0,
        updateCount: 1,
        windowStart: timestamp
      });
      return;
    }

    const interval = timestamp - existing.lastUpdate;
    const newCount = existing.updateCount + 1;
    const newAvg = ((existing.avgUpdateInterval * existing.updateCount) + interval) / newCount;
    
    // Calculate variance (simplified)
    const variance = Math.abs(interval - newAvg);
    const newVariance = ((existing.updateVariance * existing.updateCount) + variance) / newCount;

    // Reset window if too old (1 week)
    const windowAge = timestamp - existing.windowStart;
    const isWindowOld = windowAge > 7 * 24 * 60 * 60 * 1000;

    this.updateFrequencyMap.set(entityType, {
      entityType,
      lastUpdate: timestamp,
      avgUpdateInterval: newAvg,
      updateVariance: newVariance,
      updateCount: isWindowOld ? 1 : newCount,
      windowStart: isWindowOld ? timestamp : existing.windowStart
    });
  }

  /**
   * Get update frequency data for an entity
   */
  getUpdateFrequency(entityType: string): UpdateFrequencyData | undefined {
    return this.updateFrequencyMap.get(entityType);
  }

  /**
   * Clear update frequency data
   */
  clearUpdateFrequency(entityType?: string): void {
    if (entityType) {
      this.updateFrequencyMap.delete(entityType);
    } else {
      this.updateFrequencyMap.clear();
    }
  }

  /**
   * Calculate fixed TTL based on configuration
   */
  private calculateFixedTTL(
    entityConfig?: EntityCacheConfig,
    volatility: VolatilityLevel = VolatilityLevel.MEDIUM
  ): { ttl: number; reason: string } {
    const ttl = entityConfig?.defaultTtl || this.DEFAULT_TTLS[volatility];
    const reason = `Fixed TTL based on ${entityConfig ? 'entity configuration' : 'volatility level'}`;
    
    return { ttl, reason };
  }

  /**
   * Calculate adaptive TTL based on update patterns
   */
  private calculateAdaptiveTTL(
    context: TTLContext,
    entityConfig?: EntityCacheConfig,
    volatility: VolatilityLevel = VolatilityLevel.MEDIUM
  ): { ttl: number; confidence: number; reason: string } {
    const updateFreq = context.updateFrequency || this.updateFrequencyMap.get(context.entityType);
    const baseTtl = entityConfig?.defaultTtl || this.DEFAULT_TTLS[volatility];

    if (!updateFreq || updateFreq.updateCount < 3) {
      return {
        ttl: baseTtl,
        confidence: 0.5,
        reason: 'Insufficient update history, using base TTL'
      };
    }

    // Use update frequency to adjust TTL
    // If updates are frequent, reduce TTL
    // If updates are infrequent, increase TTL (up to limits)
    const avgInterval = updateFreq.avgUpdateInterval;
    const variance = updateFreq.updateVariance;
    
    // Calculate confidence based on variance (lower variance = higher confidence)
    const maxVariance = avgInterval * 0.5; // 50% of average
    const confidence = Math.max(0.3, 1 - (variance / maxVariance));

    // Adjust TTL based on update patterns
    let adaptedTtl = avgInterval * 0.4; // Cache for 40% of average update interval
    
    // Apply variance penalty - higher variance means shorter TTL
    const varianceFactor = Math.min(1, variance / avgInterval);
    adaptedTtl *= (1 - varianceFactor * 0.3);

    // Ensure reasonable bounds
    adaptedTtl = Math.max(baseTtl * 0.1, Math.min(baseTtl * 5, adaptedTtl));

    const reason = `Adaptive TTL based on ${updateFreq.updateCount} updates, avg interval ${Math.round(avgInterval/1000)}s`;

    return {
      ttl: adaptedTtl,
      confidence,
      reason
    };
  }

  /**
   * Calculate time-aware TTL based on business hours
   */
  private calculateTimeAwareTTL(
    context: TTLContext,
    entityConfig?: EntityCacheConfig,
    volatility: VolatilityLevel = VolatilityLevel.MEDIUM
  ): { ttl: number; confidence: number; reason: string } {
    const baseTtl = entityConfig?.defaultTtl || this.DEFAULT_TTLS[volatility];
    const now = new Date(context.timestamp);
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    const isBusinessHours = this.businessHours.workingDays.includes(dayOfWeek) &&
                           hour >= this.businessHours.startHour &&
                           hour < this.businessHours.endHour;

    let ttlMultiplier: number;
    let confidence = 0.7;
    let reason: string;

    if (isBusinessHours) {
      // During business hours, data changes more frequently
      ttlMultiplier = 0.5;
      reason = 'Reduced TTL during business hours';
    } else {
      // Outside business hours, data is more stable
      ttlMultiplier = 2;
      confidence = 0.8;
      reason = 'Extended TTL outside business hours';
    }

    // Weekend adjustments
    if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
      ttlMultiplier *= 1.5;
      reason += ' with weekend extension';
    }

    return {
      ttl: baseTtl * ttlMultiplier,
      confidence,
      reason
    };
  }

  /**
   * Calculate TTL based purely on volatility
   */
  private calculateVolatilityBasedTTL(
    context: TTLContext,
    volatility: VolatilityLevel
  ): { ttl: number; reason: string } {
    let ttl = this.DEFAULT_TTLS[volatility];
    
    // Adjust based on operation type
    if (context.method === 'GET') {
      if (context.requestParams?.id) {
        // Single entity fetch - can cache longer
        ttl *= 1.5;
      } else if (context.requestParams?.filter || context.requestParams?.search) {
        // Filtered/searched results - shorter TTL
        ttl *= 0.7;
      }
    }

    const reason = `Volatility-based TTL for ${volatility} entity with ${context.method} operation`;

    return { ttl, reason };
  }

  /**
   * Calculate TTL based on business rules
   */
  private calculateBusinessRulesTTL(
    context: TTLContext,
    entityConfig?: EntityCacheConfig,
    volatility: VolatilityLevel = VolatilityLevel.MEDIUM
  ): { ttl: number; confidence: number; reason: string } {
    const baseTtl = entityConfig?.defaultTtl || this.DEFAULT_TTLS[volatility];
    let ttl = baseTtl;
    const confidence = 0.8;
    const adjustments: string[] = [];

    // Business rules based on entity type
    switch (context.entityType.toLowerCase()) {
      case 'companies':
      case 'contacts':
        // Master data changes infrequently
        ttl *= 3;
        adjustments.push('master data extension');
        break;

      case 'tickets':
        // Active tickets change frequently
        if (context.responseData?.status === 'Open' || context.responseData?.status === 'In Progress') {
          ttl *= 0.3;
          adjustments.push('active ticket reduction');
        } else {
          ttl *= 1.5;
          adjustments.push('closed ticket extension');
        }
        break;

      case 'projects':
        // Project data volatility based on status
        if (context.responseData?.status === 'Active') {
          ttl *= 0.8;
          adjustments.push('active project reduction');
        } else {
          ttl *= 2;
          adjustments.push('inactive project extension');
        }
        break;

      case 'timeentries':
        // Time entries are frequently added/modified
        ttl *= 0.5;
        adjustments.push('time entry reduction');
        break;

      case 'contracts':
        // Contracts are relatively stable
        ttl *= 2;
        adjustments.push('contract stability extension');
        break;
    }

    // Adjust based on cache strategy
    if (entityConfig?.strategy === CacheStrategy.REFRESH_AHEAD) {
      ttl *= 0.8; // Shorter TTL for refresh-ahead
      adjustments.push('refresh-ahead reduction');
    }

    // List operations vs single entity
    if (context.method === 'GET' && !context.requestParams?.id) {
      ttl *= 0.8; // List operations have shorter TTL
      adjustments.push('list operation reduction');
    }

    const reason = adjustments.length > 0 
      ? `Business rules: ${adjustments.join(', ')}`
      : 'Standard business rules applied';

    return { ttl, confidence, reason };
  }

  /**
   * Initialize volatility mapping for different entity types
   */
  private initializeVolatilityMap(): Map<string, VolatilityLevel> {
    const volatilityMap = new Map<string, VolatilityLevel>();

    // Very low volatility - rarely changes
    ['companies', 'contacts', 'resources', 'roles', 'departments'].forEach(entity => {
      volatilityMap.set(entity, VolatilityLevel.VERY_LOW);
    });

    // Low volatility - changes occasionally
    ['contracts', 'projects', 'configurationitems', 'products'].forEach(entity => {
      volatilityMap.set(entity, VolatilityLevel.LOW);
    });

    // Medium volatility - regular changes
    ['opportunities', 'quotes', 'invoices'].forEach(entity => {
      volatilityMap.set(entity, VolatilityLevel.MEDIUM);
    });

    // High volatility - frequent changes
    ['tasks', 'appointments', 'servicecalls'].forEach(entity => {
      volatilityMap.set(entity, VolatilityLevel.HIGH);
    });

    // Very high volatility - constantly changing
    ['tickets', 'timeentries', 'ticketnotes', 'tasknotes'].forEach(entity => {
      volatilityMap.set(entity, VolatilityLevel.VERY_HIGH);
    });

    return volatilityMap;
  }

  /**
   * Get volatility level for an entity type
   */
  getVolatilityLevel(entityType: string): VolatilityLevel {
    return this.volatilityMap.get(entityType.toLowerCase()) || VolatilityLevel.MEDIUM;
  }

  /**
   * Update volatility level for an entity type
   */
  setVolatilityLevel(entityType: string, level: VolatilityLevel): void {
    this.volatilityMap.set(entityType.toLowerCase(), level);
  }

  /**
   * Get all volatility mappings
   */
  getVolatilityMappings(): Map<string, VolatilityLevel> {
    return new Map(this.volatilityMap);
  }
}