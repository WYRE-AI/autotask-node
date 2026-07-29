# Autotask Node SDK

A TypeScript/Node.js SDK for the Kaseya Autotask PSA REST API with business logic validation, performance optimization, and production monitoring.

[![GitHub package version](https://img.shields.io/github/package-json/v/wyre-technology/autotask-node?label=version)](https://github.com/wyre-technology/autotask-node/packages)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![API Coverage](https://img.shields.io/badge/API%20Coverage-100%25-brightgreen)](./docs/ENTITIES.md)

## Features

- **215+ Autotask Entities**: Full CRUD operations across the entire Autotask API
- **Business Logic Engine**: Validation, workflow automation, and relationship management
- **Security & Compliance**: XSS/SQL injection protection, GDPR/SOX/PCI compliance validation
- **Performance**: Request queuing, caching, circuit breakers, and retry strategies
- **Type-Safe**: Complete TypeScript coverage with auto-completion support

## Quick Start

### Installation

This package is published to GitHub Packages. Configure npm to use GitHub's registry for this package:

```bash
# Configure npm to use GitHub Packages for @wyre-technology scope
echo "@wyre-technology:registry=https://npm.pkg.github.com" >> .npmrc

# Install the package
npm install @wyre-technology/autotask-node
```

**Note**: You may need to authenticate with GitHub Packages. See [GitHub's documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) for details.

### Basic Usage

```typescript
import { AutotaskClient } from '@wyre-technology/autotask-node';

// Automatic zone detection - no configuration needed
const client = await AutotaskClient.create({
  username: 'your-api-user@domain.com',
  integrationCode: 'YOUR_INTEGRATION_CODE',
  secret: 'YOUR_SECRET',
  // impersonationResourceId: 12345 // impersonate a resource
});

// Create a ticket
const ticket = await client.tickets.create({
  title: 'Network connectivity issue',
  description: 'User cannot access shared drives',
  companyId: 123,
  status: 1, // New
  priority: 2, // High
});

// Advanced querying with the powerful query builder
const urgentTickets = await client.tickets
  .query()
  .where('priority', 'lte', 2) // High or Critical priority
  .where('status', 'in', [1, 5, 8]) // New, In Progress, Waiting Customer
  .where('dueDateTime', 'gte', new Date().toISOString())
  .include('Company', ['companyName'])
  .include('AssignedResource', ['firstName', 'lastName'])
  .orderBy('dueDateTime', 'asc')
  .execute();
```

### Advanced Usage with Business Logic

```typescript
import {
  AutotaskClient,
  BusinessLogicEngine,
  QueueManager,
} from 'autotask-node';

// Initialize enterprise client with all systems enabled
const client = await AutotaskClient.create({
  username: process.env.AUTOTASK_USERNAME!,
  integrationCode: process.env.AUTOTASK_INTEGRATION_CODE!,
  secret: process.env.AUTOTASK_SECRET!,

  // Enable enterprise features
  enableBusinessLogic: true,
  enableValidation: true,
  enableCompliance: true,
  enablePerformanceMonitoring: true,

  // Advanced queue configuration
  queueConfig: {
    backend: 'redis',
    connectionString: 'redis://localhost:6379',
    persistence: true,
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 30000,
    },
  },
});

// Business-aware ticket creation with validation
const businessEngine = client.getBusinessEngine();
const ticketResult = await businessEngine.tickets.createTicket(
  {
    title: 'Critical Infrastructure Issue',
    companyId: 123,
    priority: 1, // Critical
    description: 'Database server experiencing high memory usage',
  },
  {
    user: { id: 456, roles: ['technician'] },
    validateSLA: true,
    enforceBusinessRules: true,
  }
);

if (ticketResult.isValid) {
  // Automatic SLA calculation, resource assignment, and workflow triggers
  console.log('SLA Due Date:', ticketResult.processedTicket.dueDateTime);
  console.log(
    'Auto-assigned to:',
    ticketResult.processedTicket.assignedResourceName
  );
} else {
  // Detailed validation errors with business context
  ticketResult.validationResult.errors.forEach(error => {
    console.log(`❌ ${error.field}: ${error.message}`);
    console.log(`💡 Suggestion: ${error.suggestedFix}`);
  });
}

// Performance monitoring and health checks
const health = await client.getSystemHealth();
console.log('System Status:', health.overall);
console.log('Queue Health:', health.components.queue);
console.log('Cache Hit Ratio:', health.components.cache.hitRatio);
```

## Feature Details

### API Coverage

- **215+ Autotask Entities**: Full CRUD operations
- **Automatic Zone Detection**: No manual region configuration needed
- **Query Builder**: 14 operators, logical grouping, includes, and pagination
- **Type-Safe**: Complete TypeScript coverage

### Business Logic

- **Validation Engine**: Schema, business rules, and security validation
- **Workflow Automation**: Tickets, contracts, time tracking, and projects
- **Entity Relationships**: Referential integrity and cascade operations

### Security

- **Data Sanitization**: XSS, SQL injection protection
- **Compliance**: GDPR, SOX, PCI-DSS validation
- **Audit Logging**: Comprehensive security trails

### Performance

- **Queue Manager**: Redis, SQLite, or Memory backends
- **Circuit Breakers**: Failure isolation and recovery
- **Caching**: Multi-tier with intelligent invalidation
- **Retry Strategies**: Exponential backoff with jitter

## Supported Entities

The SDK provides access to all major Autotask entity categories:

| Category                 | Count | Key Entities                                                            |
| ------------------------ | ----- | ----------------------------------------------------------------------- |
| **Core Business**        | 7     | Companies, Contacts, Tickets, Projects, Tasks, Resources, Opportunities |
| **Contract Management**  | 24    | Contracts, ContractServices, ContractRates, ContractBillingRules        |
| **Financial**            | 19    | Invoices, Quotes, PurchaseOrders, BillingItems, TimeEntries             |
| **Configuration**        | 9     | ConfigurationItems, ConfigurationItemTypes, ConfigurationItemCategories |
| **Time Tracking**        | 11    | TimeEntries, Appointments, Holidays, TimeOffRequests                    |
| **Inventory**            | 12    | Products, InventoryItems, InventoryLocations, ProductVendors            |
| **Knowledge Base**       | 19    | Documents, Articles, KnowledgeBaseArticles                              |
| **+ 10 more categories** | 77    | Attachments, Notes, Service Calls, Surveys, Tags, and more              |

[View complete entity reference →](docs/ENTITIES.md)

## Authentication & Setup

### Authentication Method

The SDK uses Autotask's header-based authentication with three required headers:

- `ApiIntegrationCode`: Your Autotask API integration code
- `UserName`: Your API username (email address)
- `Secret`: Your API secret/password
- `ImpersonationResourceId` : This header is only set if the `impersonationResourceId` configuration option is included

**Note:** This SDK does NOT use Basic Authentication. All credentials are sent as separate headers as required by the Autotask REST API.

### Environment Variables (Recommended)

```bash
# Set these environment variables
export AUTOTASK_USERNAME="your-api-user@domain.com"
export AUTOTASK_INTEGRATION_CODE="YOUR_INTEGRATION_CODE"
export AUTOTASK_SECRET="YOUR_SECRET"
# Optional to enable impersonation
export AUTOTASK_IMPERSONATION_RESOURCE_ID="12345"
```

Or create a `.env` file:

```bash
AUTOTASK_USERNAME=your-api-user@domain.com
AUTOTASK_INTEGRATION_CODE=YOUR_INTEGRATION_CODE
AUTOTASK_SECRET=YOUR_SECRET
```

### Direct Configuration

```typescript
const client = await AutotaskClient.create({
  username: 'your-api-user@domain.com',
  integrationCode: 'YOUR_INTEGRATION_CODE',
  secret: 'YOUR_SECRET',
  performanceConfig: {
    timeout: 30000,
    retries: 3,
    rateLimitThreshold: 80,
  },
});
```

### Zone Detection

The SDK automatically detects your Autotask API zone - no manual configuration required:

```typescript
// Zone detection happens automatically during client creation
const client = await AutotaskClient.create({
  username: process.env.AUTOTASK_USERNAME!,
  integrationCode: process.env.AUTOTASK_INTEGRATION_CODE!,
  secret: process.env.AUTOTASK_SECRET!,
  // apiUrl is automatically detected and set
});
```

## Usage Examples

### Business-Aware CRUD Operations

```typescript
// Enterprise ticket creation with business intelligence
const businessEngine = client.getBusinessEngine();

const ticketResult = await businessEngine.tickets.createTicket(
  {
    title: 'Server Performance Issue',
    companyId: 123,
    priority: 2, // High priority
    description: 'Database queries taking >5 seconds',
  },
  {
    user: { id: 456, roles: ['senior-technician'] },
    relatedEntities: {
      Company: await client.companies.findById(123),
      Contact: await client.contacts.findById(789),
    },
    validateSLA: true,
    autoAssign: true,
    triggerWorkflows: true,
  }
);

if (ticketResult.isValid) {
  // Business logic automatically calculated SLA, assigned resource, triggered workflows
  console.log('✅ Ticket created with business intelligence');
  console.log('📅 SLA Due:', ticketResult.processedTicket.dueDateTime);
  console.log(
    '👤 Assigned to:',
    ticketResult.processedTicket.assignedResourceName
  );
  console.log('🔄 Workflows triggered:', ticketResult.triggeredWorkflows);
} else {
  console.log(
    '❌ Business validation failed:',
    ticketResult.validationResult.errors
  );
}

// Contract management with business rules
const contractResult = await businessEngine.contracts.createContract(
  {
    companyId: 123,
    contractName: 'Managed Services Agreement',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    contractValue: 120000,
  },
  {
    services: [
      { name: 'Monitoring', type: 'recurring', monthlyRate: 5000 },
      { name: 'Support', type: 'hourly', hourlyRate: 150 },
    ],
    validateServices: true,
    calculateBilling: true,
  }
);

// Time entry with billing calculation and approval routing
const timeResult = await businessEngine.timeEntries.createTimeEntry(
  {
    dateWorked: '2025-08-31',
    hoursWorked: 8.5,
    resourceId: 456,
    ticketId: 789,
    workTypeId: 1,
  },
  {
    billingRates: { 456: 175 }, // $175/hour for this resource
    contractInfo: { hasHourlyRate: true, rate: 150 },
    approvalWorkflow: true,
  }
);

console.log('💰 Billing Amount:', timeResult.billingCalculation.amount);
console.log('📋 Approval Required:', timeResult.approvalRequired);
```

### Advanced Querying

```typescript
// Complex filtering with logical grouping
const criticalTickets = await client.tickets
  .query()
  .where('companyId', 'eq', 123)
  .and(builder => {
    builder
      .where('priority', 'in', [1, 2]) // Critical or High
      .or(subBuilder => {
        subBuilder
          .where('status', 'eq', 1) // New tickets
          .where('estimatedHours', 'gt', 10); // Large tickets
      });
  })
  .include('Company', ['companyName'])
  .include('AssignedResource', ['firstName', 'lastName'])
  .orderBy('priority', 'asc')
  .orderBy('dueDateTime', 'asc')
  .execute();

// Performance-optimized queries
const lightweightTickets = await client.tickets
  .query()
  .select('id', 'title', 'status', 'priority') // Only needed fields
  .where('createDate', 'gte', '2024-01-01')
  .limit(100)
  .execute();
```

### Enterprise Security & Compliance

```typescript
import {
  ValidationEngine,
  SecurityValidator,
  ComplianceValidator,
} from 'autotask-node';

// Data sanitization and threat detection
const sanitizedData = await SecurityValidator.sanitizeInput({
  companyName: 'Acme Corp <script>alert("xss")</script>',
  description: "Company info'; DROP TABLE companies; --",
});

// GDPR compliance validation for EU customers
const complianceResult = await ComplianceValidator.checkCompliance(
  {
    firstName: 'John',
    lastName: 'Doe',
    emailAddress: 'john.doe@example.com',
    phone: '+49-123-456-7890',
  },
  {
    jurisdiction: 'EU',
    processingPurpose: ['service_delivery'],
    consentStatus: 'granted',
  }
);

if (!complianceResult.compliant) {
  console.log('GDPR violations detected:', complianceResult.violations);
}

// Business rule validation with detailed error context
const validationResult = await ValidationEngine.validateEntity(ticketData, {
  operation: 'create',
  entityType: 'Tickets',
  securityContext: { userId: '123', roles: ['technician'] },
  businessContext: { company: companyData, slaLevel: 'premium' },
});

if (!validationResult.isValid) {
  validationResult.errors.forEach(error => {
    console.log(`❌ ${error.field}: ${error.message}`);
    console.log(`💡 Fix: ${error.suggestedFix}`);
    console.log(`📊 Context: ${error.businessContext}`);
  });
}
```

### Performance Monitoring & Analytics

```typescript
// Real-time performance monitoring
const performanceMonitor = client.getPerformanceMonitor();

performanceMonitor.on('alert', alert => {
  if (alert.type === 'high_latency') {
    console.log(`⚠️ High latency detected: ${alert.value}ms`);
  } else if (alert.type === 'error_rate_spike') {
    console.log(`🚨 Error rate spike: ${alert.value}%`);
  }
});

// Get comprehensive metrics
const metrics = await performanceMonitor.getMetrics();
console.log('📊 Performance Overview:');
console.log(`  Request throughput: ${metrics.throughput.toFixed(2)} req/s`);
console.log(`  Average response time: ${metrics.avgResponseTime}ms`);
console.log(`  Error rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
console.log(`  Cache hit ratio: ${(metrics.cacheHitRatio * 100).toFixed(1)}%`);
console.log(`  Memory usage: ${(metrics.memoryUsage * 100).toFixed(1)}%`);

// Queue health and status
const queueHealth = await client.getQueueHealth();
console.log('📋 Queue Status:');
console.log(`  Pending requests: ${queueHealth.pendingRequests}`);
console.log(`  Processing rate: ${queueHealth.processingRate} req/min`);
console.log(`  Circuit breaker status: ${queueHealth.circuitBreakerStatus}`);

// Business intelligence insights
const businessMetrics = await businessEngine.getBusinessMetrics();
console.log('🧠 Business Intelligence:');
console.log(`  SLA compliance: ${businessMetrics.slaCompliance}%`);
console.log(`  Ticket resolution time: ${businessMetrics.avgResolutionTime}h`);
console.log(`  Resource utilization: ${businessMetrics.resourceUtilization}%`);
```

## Command Line Interface

The SDK includes a full-featured CLI for quick operations:

```bash
# List open tickets
npx autotask-node tickets list '{"status": 1}'

# Create a new company
npx autotask-node companies create '{
  "companyName": "New Customer",
  "companyType": 1,
  "isActive": true
}'

# Update ticket with complex filter
npx autotask-node tickets update 12345 '{
  "status": 5,
  "assignedResourceId": 456
}'

# Get detailed entity information
npx autotask-node tickets get 12345 --include Company,AssignedResource
```

## Documentation

| Document                                           | Description                                           |
| -------------------------------------------------- | ----------------------------------------------------- |
| [API Reference](docs/API.md)                       | Complete API documentation with all methods and types |
| [Entity Reference](docs/ENTITIES.md)               | Detailed guide to all 215+ supported entities         |
| [Business Logic Guide](src/business/README.md)     | Enterprise business logic, workflows, and validation  |
| [Validation Framework](src/validation/README.md)   | Security, compliance, and data quality systems        |
| [Query Builder Guide](docs/QUERY_BUILDER.md)       | Advanced querying techniques and examples             |
| [Migration Framework](docs/MIGRATION.md)           | Complete PSA migration system documentation           |
| [Relationship System](docs/RELATIONSHIP_SYSTEM.md) | Entity relationships and referential integrity        |
| [Usage Examples](docs/EXAMPLES.md)                 | Real-world scenarios and integration patterns         |

## API Reference

### Core Client Architecture

```typescript
// Primary client with all enterprise systems
class AutotaskClient {
  // Core entity access
  companies: CompanyClient;
  contacts: ContactClient;
  tickets: TicketClient;
  projects: ProjectClient;
  contracts: ContractClient;
  timeEntries: TimeEntryClient;

  // Enterprise systems access
  getBusinessEngine(): BusinessLogicEngine;
  getValidationEngine(): ValidationEngine;
  getQueueManager(): QueueManager;
  getPerformanceMonitor(): PerformanceMonitor;
  getSecurityValidator(): SecurityValidator;
  getComplianceValidator(): ComplianceValidator;

  // System health and monitoring
  getSystemHealth(): Promise<SystemHealth>;
  getMetrics(): Promise<EnterpriseMetrics>;

  // Advanced operations
  executeBatch(operations: BatchOperation[]): Promise<BatchResult>;
  migrateFromPSA(config: MigrationConfig): Promise<MigrationResult>;
}
```

### Business Logic Engine

```typescript
// Entity-specific business logic with intelligence
class BusinessLogicEngine {
  tickets: TicketBusinessLogic;
  timeEntries: TimeEntryBusinessLogic;
  contracts: ContractBusinessLogic;
  projects: ProjectBusinessLogic;
  companies: CompanyBusinessLogic;
  contacts: ContactBusinessLogic;

  // Analytics and insights
  generateBusinessMetrics(): Promise<BusinessMetrics>;
  analyzeEntityRelationships(entityType: string): RelationshipAnalysis;
  validateWorkflow(
    workflowId: string,
    context: WorkflowContext
  ): WorkflowValidationResult;
}
```

### Advanced Queue System

```typescript
// Enterprise queue manager with multiple backends
class QueueManager {
  // Queue operations
  enqueue(request: QueueRequest): Promise<QueuedRequest>;
  enqueueBatch(requests: QueueRequest[]): Promise<QueuedRequest[]>;

  // Monitoring and health
  getHealth(): Promise<QueueHealth>;
  getMetrics(): Promise<QueueMetrics>;

  // Configuration and control
  configureCircuitBreaker(zone: string, config: CircuitBreakerConfig): void;
  pauseProcessing(): Promise<void>;
  resumeProcessing(): Promise<void>;
  gracefulShutdown(): Promise<void>;
}
```

## Query Builder

### Operators

| Operator                             | Description          | Example                                                         |
| ------------------------------------ | -------------------- | --------------------------------------------------------------- |
| `eq`, `ne`                           | Equals, Not equals   | `.where('status', 'eq', 1)`                                     |
| `gt`, `gte`, `lt`, `lte`             | Comparison operators | `.where('priority', 'lte', 2)`                                  |
| `contains`, `startsWith`, `endsWith` | String matching      | `.where('title', 'contains', 'urgent')`                         |
| `in`, `notIn`                        | Array membership     | `.where('status', 'in', [1, 5, 8])`                             |
| `isNull`, `isNotNull`                | Null checking        | `.where('assignedResourceId', 'isNull')`                        |
| `between`                            | Range queries        | `.where('createDate', 'between', ['2024-01-01', '2024-12-31'])` |

## Configuration

### Full Configuration Example

```typescript
const client = await AutotaskClient.create({
  username: process.env.AUTOTASK_USERNAME!,
  integrationCode: process.env.AUTOTASK_INTEGRATION_CODE!,
  secret: process.env.AUTOTASK_SECRET!,

  // Business Logic Engine Configuration
  businessLogicConfig: {
    enableWorkflows: true,
    strictValidation: true,
    enableBusinessRules: true,
    enableRelationshipValidation: true,
    workflowTimeout: 300000,
  },

  // Security & Compliance Configuration
  securityConfig: {
    enableXSSProtection: true,
    enableSQLInjectionProtection: true,
    enablePIIDetection: true,
    enableAuditTrails: true,
    complianceMode: 'gdpr', // 'gdpr', 'sox', 'pci', 'hipaa'
    encryptionKey: process.env.ENCRYPTION_KEY,
  },

  // Advanced Queue Configuration
  queueConfig: {
    backend: 'redis', // 'memory', 'sqlite', 'redis'
    connectionString: process.env.REDIS_URL,
    persistence: true,
    batchProcessing: {
      enabled: true,
      maxBatchSize: 50,
      batchTimeout: 5000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 30000,
      monitoringPeriod: 60000,
    },
    retryStrategy: {
      maxRetries: 5,
      exponentialBackoff: true,
      jitter: true,
      maxDelay: 30000,
    },
  },

  // Performance Monitoring Configuration
  performanceConfig: {
    enableMonitoring: true,
    metricsCollectionInterval: 30000,
    alertingEnabled: true,
    alertThresholds: {
      responseTime: 5000,
      errorRate: 0.05,
      memoryUsage: 0.8,
      queueDepth: 1000,
    },
    caching: {
      enabled: true,
      strategy: 'intelligent', // 'lru', 'ttl', 'intelligent'
      ttl: 300000,
      maxSize: 1000,
    },
  },

  // Logging Configuration
  loggingConfig: {
    level: 'info',
    enableAuditLogs: true,
    enablePerformanceLogs: true,
    enableSecurityLogs: true,
    logFile: './logs/autotask-sdk.log',
  },
});
```

### Environment Variables

All supported environment variables:

```bash
# Core Authentication
AUTOTASK_USERNAME=your-api-user@domain.com
AUTOTASK_INTEGRATION_CODE=YOUR_INTEGRATION_CODE
AUTOTASK_SECRET=YOUR_SECRET

# Security & Encryption
ENCRYPTION_KEY=your-256-bit-encryption-key
SECURITY_AUDIT_ENABLED=true
COMPLIANCE_MODE=gdpr

# Queue System Configuration
QUEUE_BACKEND=redis
REDIS_URL=redis://localhost:6379
QUEUE_PERSISTENCE=true
QUEUE_BATCH_SIZE=50

# Performance Configuration
PERFORMANCE_MONITORING=true
CACHE_STRATEGY=intelligent
CACHE_TTL=300000
ALERT_THRESHOLDS_ERROR_RATE=0.05

# Business Logic Configuration
BUSINESS_LOGIC_ENABLED=true
WORKFLOWS_ENABLED=true
STRICT_VALIDATION=true
RELATIONSHIP_VALIDATION=true

# Logging Configuration
LOG_LEVEL=info
AUDIT_LOGS_ENABLED=true
PERFORMANCE_LOGS_ENABLED=true
SECURITY_LOGS_ENABLED=true

# Impersonation
AUTOTASK_IMPERSONATION_RESOURCE_ID=RESOURCE_ID
```

### Logging and Debugging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'autotask.log' }),
  ],
});

const client = await AutotaskClient.create({
  // ... credentials
  logger,
});
```

## API Rate Limits & Concurrency

Autotask enforces two hard limits documented in their [API Rate Limiting guide](https://autotask.net/help/DeveloperHelp/Content/AdminSetup/2ExtensionsIntegrations/APIs/REST/API_Rate_Limiting.htm):

| Limit                           | Value      | Scope                        |
| ------------------------------- | ---------- | ---------------------------- |
| Concurrent threads per endpoint | **3**      | Per API tracking identifier  |
| Total requests per hour         | **10,000** | Per Autotask tenant database |

The SDK automatically respects the 3-thread limit. When more than 3 requests target the same endpoint simultaneously, additional requests are queued and released as slots free up — no 429 errors for concurrency violations.

### Multi-User / Team Deployments

The 3-thread limit applies **per API tracking identifier** (your `integrationCode`). If multiple users or services share the same credentials, they collectively compete for 3 concurrent slots on each endpoint.

**Recommendation**: Create a separate Autotask API user per team or integration. Each user gets their own `integrationCode` with an independent thread budget:

```
Team A → integrationCode: TEAM_A_CODE → 3 threads per endpoint
Team B → integrationCode: TEAM_B_CODE → 3 threads per endpoint (independent)
```

To create a dedicated API user:

1. **Admin > Resources (Users) > Resources/Users** → Add Resource
2. Set Security Level to **API User**
3. Note the generated credentials (username, secret, integration code)

## Performance

The SDK includes batching, caching, and query optimization:

```typescript
// Optimized batch query
const tickets = await client.tickets
  .query()
  .where('id', 'between', [1, 1000])
  .batchSize(50)
  .execute();
```

## Testing

```bash
npm test                    # All tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:coverage       # Coverage report
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Run `npm test` to verify
5. Submit a pull request

```bash
git clone https://github.com/wyre-technology/autotask-node.git
cd autotask-node
npm install
cp .env.example .env
npm test
```

## Requirements

- **Node.js**: 18.0.0 or higher
- **TypeScript**: 5.0+ (for development)
- **Autotask API**: Valid integration credentials

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/wyre-technology/autotask-node/issues)
- **Documentation**: [docs/](docs/)
- **Examples**: [docs/EXAMPLES.md](docs/EXAMPLES.md)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

---

_This SDK is not officially affiliated with Kaseya or Autotask._
