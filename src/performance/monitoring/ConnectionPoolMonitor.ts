import { EventEmitter } from 'events';
import winston from 'winston';
import { ConnectionPoolMetrics } from '../types/PerformanceTypes';

/**
 * Connection pool monitoring and optimization system
 * 
 * Monitors HTTP/HTTPS connection pools, tracks efficiency,
 * and provides insights for connection optimization.
 */
export class ConnectionPoolMonitor extends EventEmitter {
  private poolMetrics: ConnectionPoolMetrics[] = [];
  private isMonitoring = false;
  private monitoringInterval?: ReturnType<typeof setTimeout>;
  
  // Connection tracking
  private connectionEvents = new Map<string, {
    created: number;
    destroyed: number;
    totalAcquisitionTime: number;
    acquisitions: number;
  }>();

  constructor(private logger: winston.Logger) {
    super();
    this.setupConnectionTracking();
  }

  /**
   * Start connection pool monitoring
   */
  start(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    
    // Monitor connection pools periodically
    this.monitoringInterval = setInterval(() => {
      if (!this.isMonitoring) return;
      
      this.sampleConnectionPools();
    }, 5000); // Sample every 5 seconds

    this.logger.info('Connection pool monitoring started');
  }

  /**
   * Stop connection pool monitoring
   */
  stop(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.logger.info('Connection pool monitoring stopped');
  }

  /**
   * Get current connection pool metrics
   */
  getMetrics(): ConnectionPoolMetrics {
    if (this.poolMetrics.length === 0) {
      return this.getEmptyMetrics();
    }

    return this.poolMetrics[this.poolMetrics.length - 1];
  }

  /**
   * Get connection pool metrics history
   */
  getMetricsHistory(): ConnectionPoolMetrics[] {
    return [...this.poolMetrics];
  }

  /**
   * Get connection efficiency analysis
   */
  getEfficiencyAnalysis(): {
    overall: number;
    trends: {
      efficiency: Array<{ timestamp: number; value: number }>;
      acquisitionTime: Array<{ timestamp: number; value: number }>;
      poolUtilization: Array<{ timestamp: number; value: number }>;
    };
    recommendations: string[];
    alerts: Array<{
      type: string;
      message: string;
      severity: 'low' | 'medium' | 'high';
      timestamp: number;
    }>;
  } {
    const recommendations: string[] = [];
    const alerts: Array<{
      type: string;
      message: string;
      severity: 'low' | 'medium' | 'high';
      timestamp: number;
    }> = [];

    if (this.poolMetrics.length === 0) {
      return {
        overall: 0,
        trends: {
          efficiency: [],
          acquisitionTime: [],
          poolUtilization: []
        },
        recommendations,
        alerts
      };
    }

    const currentMetrics = this.getMetrics();
    const overall = currentMetrics.efficiency;

    // Generate recommendations
    if (currentMetrics.avgAcquisitionTime > 100) {
      recommendations.push('High connection acquisition time - consider increasing pool size');
    }

    if (currentMetrics.efficiency < 60) {
      recommendations.push('Low connection pool efficiency - review connection lifecycle management');
    }

    if (currentMetrics.idleConnections > currentMetrics.activeConnections * 2) {
      recommendations.push('Too many idle connections - consider reducing pool size or timeout');
    }

    // Generate alerts
    if (currentMetrics.efficiency < 50) {
      alerts.push({
        type: 'low_efficiency',
        message: `Connection pool efficiency is low (${currentMetrics.efficiency}%)`,
        severity: 'high',
        timestamp: Date.now()
      });

      this.emit('efficiency_low', currentMetrics);
    }

    if (currentMetrics.avgAcquisitionTime > 500) {
      alerts.push({
        type: 'slow_acquisition',
        message: `Slow connection acquisition (${currentMetrics.avgAcquisitionTime}ms)`,
        severity: 'medium',
        timestamp: Date.now()
      });
    }

    // Build trends
    const trends = {
      efficiency: this.poolMetrics.map((m, i) => ({
        timestamp: Date.now() - (this.poolMetrics.length - i - 1) * 5000,
        value: m.efficiency
      })),
      acquisitionTime: this.poolMetrics.map((m, i) => ({
        timestamp: Date.now() - (this.poolMetrics.length - i - 1) * 5000,
        value: m.avgAcquisitionTime
      })),
      poolUtilization: this.poolMetrics.map((m, i) => ({
        timestamp: Date.now() - (this.poolMetrics.length - i - 1) * 5000,
        value: m.totalConnections > 0 ? (m.activeConnections / m.totalConnections) * 100 : 0
      }))
    };

    return {
      overall,
      trends,
      recommendations,
      alerts
    };
  }

  /**
   * Record connection acquisition timing
   */
  recordConnectionAcquisition(poolName: string, acquisitionTime: number): void {
    const stats = this.connectionEvents.get(poolName) || {
      created: 0,
      destroyed: 0,
      totalAcquisitionTime: 0,
      acquisitions: 0
    };

    stats.acquisitions++;
    stats.totalAcquisitionTime += acquisitionTime;

    this.connectionEvents.set(poolName, stats);
  }

  /**
   * Record connection creation
   */
  recordConnectionCreated(poolName: string): void {
    const stats = this.connectionEvents.get(poolName) || {
      created: 0,
      destroyed: 0,
      totalAcquisitionTime: 0,
      acquisitions: 0
    };

    stats.created++;
    this.connectionEvents.set(poolName, stats);
  }

  /**
   * Record connection destruction
   */
  recordConnectionDestroyed(poolName: string): void {
    const stats = this.connectionEvents.get(poolName) || {
      created: 0,
      destroyed: 0,
      totalAcquisitionTime: 0,
      acquisitions: 0
    };

    stats.destroyed++;
    this.connectionEvents.set(poolName, stats);
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations(): {
    poolSize: {
      current: number;
      recommended: number;
      reason: string;
    };
    keepAlive: {
      current: boolean;
      recommended: boolean;
      reason: string;
    };
    timeout: {
      current: number;
      recommended: number;
      reason: string;
    };
  } {
    const currentMetrics = this.getMetrics();
    
    return {
      poolSize: {
        current: currentMetrics.maxPoolSize,
        recommended: this.calculateOptimalPoolSize(currentMetrics),
        reason: this.getPoolSizeRecommendationReason(currentMetrics)
      },
      keepAlive: {
        current: true, // Assume keep-alive is enabled
        recommended: true,
        reason: 'Keep-alive connections improve performance for repeated requests'
      },
      timeout: {
        current: 30000, // Default timeout
        recommended: this.calculateOptimalTimeout(currentMetrics),
        reason: this.getTimeoutRecommendationReason(currentMetrics)
      }
    };
  }

  /**
   * Reset monitoring data
   */
  reset(): void {
    this.poolMetrics = [];
    this.connectionEvents.clear();
    this.logger.info('Connection pool monitor reset');
  }

  private setupConnectionTracking(): void {
    // In a real implementation, you would hook into the HTTP agent events
    // This is a simplified version for demonstration
  }

  private sampleConnectionPools(): void {
    try {
      // Get current connection pool state
      const metrics = this.getCurrentPoolMetrics();
      
      this.poolMetrics.push(metrics);
      
      // Limit history size
      if (this.poolMetrics.length > 1000) {
        this.poolMetrics.shift();
      }

      this.emit('metrics', metrics);
    } catch (error) {
      this.logger.error('Error sampling connection pools:', error);
    }
  }

  private getCurrentPoolMetrics(): ConnectionPoolMetrics {
    // In a real implementation, this would query actual HTTP agents
    // For now, we'll simulate metrics based on recorded events
    
    let totalConnections: number;
    let activeConnections: number;
    let connectionsCreated = 0;
    let connectionsDestroyed = 0;
    let totalAcquisitionTime = 0;
    let totalAcquisitions = 0;

    for (const stats of this.connectionEvents.values()) {
      connectionsCreated += stats.created;
      connectionsDestroyed += stats.destroyed;
      totalAcquisitionTime += stats.totalAcquisitionTime;
      totalAcquisitions += stats.acquisitions;
    }

    // Simulate current connections (in reality, query from HTTP agents)
    totalConnections = Math.max(connectionsCreated - connectionsDestroyed, 0);
    activeConnections = Math.floor(totalConnections * 0.7); // Assume 70% active
    const idleConnections = totalConnections - activeConnections;
    
    const avgAcquisitionTime = totalAcquisitions > 0 
      ? totalAcquisitionTime / totalAcquisitions 
      : 0;

    const efficiency = totalConnections > 0 
      ? (activeConnections / totalConnections) * 100 
      : 100;

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      maxPoolSize: 50, // Default max pool size
      avgAcquisitionTime,
      connectionsCreated,
      connectionsDestroyed,
      efficiency: Math.round(efficiency * 100) / 100
    };
  }

  private calculateOptimalPoolSize(metrics: ConnectionPoolMetrics): number {
    // Simple algorithm: base on current usage with some headroom
    const utilizationRatio = metrics.totalConnections > 0 
      ? metrics.activeConnections / metrics.totalConnections 
      : 0;

    if (utilizationRatio > 0.8) {
      return Math.min(metrics.maxPoolSize * 1.5, 100); // Increase up to 100
    } else if (utilizationRatio < 0.3) {
      return Math.max(metrics.maxPoolSize * 0.7, 10); // Decrease but keep minimum 10
    }

    return metrics.maxPoolSize; // Current size is optimal
  }

  private getPoolSizeRecommendationReason(metrics: ConnectionPoolMetrics): string {
    const utilizationRatio = metrics.totalConnections > 0 
      ? metrics.activeConnections / metrics.totalConnections 
      : 0;

    if (utilizationRatio > 0.8) {
      return 'High connection utilization detected, increase pool size to reduce contention';
    } else if (utilizationRatio < 0.3) {
      return 'Low connection utilization, decrease pool size to save resources';
    }

    return 'Current pool size appears optimal';
  }

  private calculateOptimalTimeout(metrics: ConnectionPoolMetrics): number {
    if (metrics.avgAcquisitionTime > 200) {
      return 60000; // Increase timeout for slow connections
    } else if (metrics.avgAcquisitionTime < 50) {
      return 15000; // Decrease timeout for fast connections
    }

    return 30000; // Default timeout
  }

  private getTimeoutRecommendationReason(metrics: ConnectionPoolMetrics): string {
    if (metrics.avgAcquisitionTime > 200) {
      return 'Slow connection acquisition detected, increase timeout to prevent premature failures';
    } else if (metrics.avgAcquisitionTime < 50) {
      return 'Fast connection acquisition, timeout can be reduced to fail faster';
    }

    return 'Current timeout appears appropriate';
  }

  private getEmptyMetrics(): ConnectionPoolMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      maxPoolSize: 50,
      avgAcquisitionTime: 0,
      connectionsCreated: 0,
      connectionsDestroyed: 0,
      efficiency: 100
    };
  }
}