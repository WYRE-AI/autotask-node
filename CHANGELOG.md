# Autotask Node SDK Release Notes

## [Unreleased]

### Added

- **API impersonation support** - new `impersonationResourceId` config option (or `AUTOTASK_IMPERSONATION_RESOURCE_ID` env var) adds the `ImpersonationResourceId` header to API requests, allowing impersonation of a specific resource.

### Changed

- Repository hygiene: stopped tracking the generated `dist/` build tree in git (`.gitignore` already excludes it).
- Set `package.json` `author` to `Wyre Technology` (was a placeholder).
- Added `*.tgz` to `.gitignore` to keep build tarballs out of the working tree.

### Removed

- Deleted stray artifacts from the working tree: `autotask-node-2.0.0.tgz`, `npm-debug-403.log`, and the empty `logs/` directory.

### Security

- `npm audit fix` cleared 2 of 4 moderate advisories. The remaining 2 (`brace-expansion`, `ip-address`) live in the bundled `npm` CLI pulled in transitively and require a breaking `--force` change to resolve.

## [2.2.1] - 2026-04-28

### Security

- **Resolved 28 dependabot/npm audit vulnerabilities** (1 critical, 15 high, 9 moderate, 3 low) — `npm audit` now reports 0 vulnerabilities.
  - Direct deps bumped: `sqlite3` ^5.1.7 → ^6.0.1, `uuid` ^11.1.0 → ^14.0.0, `jest-junit` ^16 → ^17
  - Overrides added: `@isaacs/brace-expansion ^5.0.1` (patches bundled `npm` via semantic-release), `uuid ^14.0.0` (forces patched uuid through `bull` / `exceljs` / `jest-junit`)
  - Notable advisories cleared: handlebars (critical, 8 advisories), tar (high, 6), undici (high, 11), minimatch (high, 12), lodash, picomatch, path-to-regexp, dompurify (moderate, 8)

### Internal

- Added `test/__mocks__/uuid.js` CJS shim wired via Jest `moduleNameMapper`. uuid v14 ships native ESM that Jest's CJS runtime can't load; runtime continues to use the real patched uuid via the override.

## [2.2.0] - 2026-03-15

### Added

- **Regular Time entry support** (`TimeTrackingClient.createRegularTimeEntry()`) — create non-ticket time entries for meetings, admin work, training, etc. with `timeEntryType=5` (Activity) set automatically
- **`TimeEntries.createDirect()`** — POST to `/TimeEntries` without parent scope, enabling Regular Time workflows
- **`CoreClient.searchResources()` / `resolveResourceByName()`** — search and resolve resources/technicians by full name with first/last split logic
- **`FinancialClient.getInternalBillingCodes()` / `resolveInternalBillingCodeByName()`** — fetch and resolve BillingCodes with `useType=3` (internal allocation codes: Internal Meeting, Training, PTO, etc.)

### Fixed

- **Better 500/5xx error messages** — `ServerError` now includes details from the `errors` array in Autotask API responses, making it much easier to debug server-side validation failures
- **Proper gzip compression** — requests with `enableCompression: true` now actually compress the body with gzip (previously the `Content-Encoding: gzip` header was set but the body was uncompressed, causing 500 errors on child entity endpoints)

### Notes (Autotask API discoveries)

- Regular Time entries require `internalBillingCodeID` (NOT `billingCodeID`)
- Only BillingCodes with `useType=3` are valid for Regular Time categories
- The API returns `{itemId: N}` for creates (not `{id: N}`) — handled automatically in `createRegularTimeEntry()`
- The Autotask error message references "InternallAllocationCodeID" (with typo) but the actual REST API field is `internalBillingCodeID`

## [2.1.1] - 2026-02-26

### Fixed

- **QuoteItems endpoint** — `create()` and `delete()` now use the correct parent-child URL `/Quotes/{id}/Items` instead of the top-level `/QuoteItems` endpoint

## [2.1.0] - 2026-02-10

### Changed

- **BREAKING**: `TicketNotes.create()` now requires `ticketId` as first parameter and POSTs to `/Tickets/{ticketId}/Notes`
- **BREAKING**: `ProjectNotes.create()` now requires `projectId` as first parameter and POSTs to `/Projects/{projectId}/Notes`
- **BREAKING**: `CompanyNotes.create()` now requires `companyId` as first parameter and POSTs to `/Companies/{companyId}/Notes`
- **BREAKING**: `TimeEntries.create()` now requires `ticketId` as first parameter and POSTs to `/Tickets/{ticketId}/TimeEntries`

### Fixed

- Child entity create endpoints now use correct parent-child URL patterns required by the Autotask REST API
- Updated metadata endpoints to reflect correct parent-child URLs

## [2.0.3] - 2026-01-23

### Fixed

- Removed `dotenv.config()` calls from library client classes (`AutotaskClient`, `EnhancedAutotaskClient`, and generated clients). Libraries should not load `.env` files — that is the consuming application's responsibility. This caused stdout pollution with dotenv v17+, breaking MCP servers and other stdio-based protocols.

## [Unreleased]

### Security

- **BREAKING**: Replaced `xlsx` (SheetJS) with `exceljs` for Excel file parsing
  - xlsx had unfixed HIGH severity vulnerabilities (prototype pollution, ReDoS)
  - exceljs provides equivalent functionality with better security
- Fixed `qs` DoS vulnerability via arrayLimit bypass
- Updated dev dependencies: semantic-release, jest, typescript-eslint, prettier, ts-jest, winston, express

### Changed

- Package renamed to `@asachs01/autotask-node` (scoped)
- Package now published to GitHub Packages instead of npm
- Install with: `npm install @asachs01/autotask-node --registry=https://npm.pkg.github.com`

### Known Issues

- Remaining vulnerabilities are in dev/build tooling only (tar, diff) and do not affect the published package

## 2.0.0 - Production Ready Release

**August 26, 2025** — Major release marking production readiness with complete API coverage, enterprise features, and comprehensive testing.

### BREAKING CHANGES

- Refactored `AutotaskClient` from monolithic structure to modular sub-client architecture
- Entity interfaces now use "I" prefix convention (e.g., `ITicket` instead of `Ticket`)
- Some entity names changed to match official Autotask API (e.g., `accounts` → `companies`)

### NEW FEATURES

**Complete API Coverage (215 Entities):**

- Increased from ~27 to 215 entities (800% expansion)
- 100% Autotask REST API coverage
- Full CRUD operations for all supported entities
- Convenience methods for common operations on all sub-clients

**Enterprise Architecture:**

- Category-based sub-clients (Core, Financial, Contracts, Configuration, etc.)
- Lazy initialization for optimal performance
- Connection pooling and rate limiting
- Comprehensive error handling with retry logic

**Production Features:**

- Business logic validation layer
- Entity relationship mapping and cascade operations
- Data validation and sanitization
- Security features (XSS prevention, input sanitization)
- Compliance support (GDPR, SOX, PCI-DSS)
- Offline queue system with multiple backends (Redis, SQLite, Memory)

**Advanced Capabilities:**

- Webhook processing and event handling system
- PSA migration framework (ConnectWise, ServiceNow, Kaseya VSA)
- Performance monitoring and optimization
- Real-time data synchronization
- Comprehensive audit logging

### QUALITY METRICS

- **Test Coverage**: 97.8% (1,491 of 1,524 tests passing)
- **TypeScript Build**: Zero errors (fixed 200+ compilation errors)
- **Linting**: Zero errors (fixed 710+ linting issues)
- **Performance**: Sub-50ms average response time

### TECHNICAL IMPROVEMENTS

- Fixed all TypeScript compilation errors
- Implemented missing delete methods for entities
- Added comprehensive convenience methods to all sub-clients
- Created mock Autotask API server for integration testing

### DOCUMENTATION

- Comprehensive API documentation (`docs/API.md`)
- Complete entity reference (`docs/ENTITIES.md`)
- Real-world examples (`docs/EXAMPLES.md`)
- Migration guides for various PSA systems

### BUG FIXES (Post-Release)

- Added missing Memory modules (MemoryBackend, MemoryCacheStore, MemoryTracker, MemoryBenchmark)
- Fixed `.gitignore` rules that were incorrectly ignoring source files
- Fixed type mismatch between `MemorySnapshot` and `MemoryMetrics` in PerformanceMonitor
- Fixed TypeScript compilation errors in validation framework
- Fixed authentication headers to use correct Autotask API format
- Fixed test suite mock objects to include axios interceptors
- Fixed SDK client to properly read credentials from environment

### SECURITY IMPROVEMENTS (Post-Release)

- Enhanced credential management: All test files now use environment variables exclusively
- SDK supports both `AUTOTASK_*` and `AUTOTASK_API_*` environment variable naming conventions
- Ensured no credentials are hardcoded in any project files

### BUILD & CI IMPROVEMENTS (Post-Release)

- Updated dependencies (joi, ioredis, dompurify, validator)
- Added missing type definitions (@types/bull, @types/ioredis, @types/joi)
- Updated release workflow to support npm trusted publishing with OIDC
- Added provenance attestation support for npm packages
- Fixed release workflow memory issues by increasing Node.js heap size

---

## 1.2.0 - PSA Migration Framework Release

**August 26, 2025** — PSA migration framework for data migration from various PSA systems to Autotask.

### NEW MAJOR FEATURES

**Complete PSA Migration Framework:**

- **Universal Migration Engine**: Single framework supporting multiple PSA source systems
- **Multi-PSA Connectors**: Full support for ConnectWise Manage, ServiceNow, Kaseya VSA, FreshService, ServiceDesk Plus, and CSV/Excel imports
- **Intelligent Data Mapping**: AI-assisted field mapping with transformation rules and validation
- **Enterprise-Grade Scaling**: Parallel processing, checkpoints, rollback capabilities, and progress tracking
- **Comprehensive Validation**: Pre/post-migration validation with data quality scoring and integrity checks
- **CLI Tools & Wizards**: Interactive setup wizards and command-line utilities for streamlined migrations

**Migration Capabilities:**

- **Data Transformation Engine**: Advanced field mapping with custom transformation rules and business logic
- **Quality Assessment**: Automated data quality scoring with recommendations for improvement
- **Progress Monitoring**: Real-time progress tracking with detailed reporting and metrics
- **Error Handling**: Sophisticated error recovery with configurable retry policies and checkpoint resume
- **Validation Suite**: Comprehensive pre/post-migration validation ensuring data integrity

**Developer Experience:**

- **Simple API**: Easy-to-use APIs for quick migration setup and execution
- **Configuration Builder**: Fluent configuration API for complex migration scenarios
- **Default Mappings**: Pre-built field mappings for common PSA systems
- **Extensive Documentation**: Complete migration guide with examples and best practices

### DOCUMENTATION

- **Migration Guide**: Complete documentation for PSA migration framework (`docs/MIGRATION.md`)
- **API Examples**: Practical examples for all supported PSA systems
- **Configuration Samples**: Ready-to-use configuration templates
- **CLI Reference**: Comprehensive command-line tool documentation

### TECHNICAL ADDITIONS

- New `src/migration/` module with complete migration framework
- Enhanced CLI with migration commands
- Added dependencies: `commander`, `chalk`, `ora`, `csv-parse`, `xlsx`
- TypeScript interfaces for all migration types and configurations

## 1.1.0 - Documentation Release

**August 25, 2025** — Comprehensive documentation update with professional SDK documentation suite.

### NEW FEATURES

**Complete Documentation Suite:**

- **API Reference**: Complete documentation for all 178 entities with TypeScript interfaces, usage examples, and query patterns
- **Entity Reference**: Detailed guide to all supported entities organized by category with descriptions and relationships
- **Advanced Examples**: Real-world scenarios including customer onboarding, ticket escalation, reporting, and integration patterns
- **Professional README**: Enhanced with comprehensive feature overview, usage examples, and getting started guide

**Enhanced Developer Experience:**

- **Entity Categorization**: Logical organization of all 178 entities into 17 functional categories
- **Usage Patterns**: Common operation patterns and best practices for each entity type
- **Error Handling Guide**: Comprehensive error handling examples with recovery strategies
- **Performance Optimization**: Memory management and query optimization techniques
- **Integration Examples**: Webhook handling, batch processing, and enterprise patterns

**Updated Branding:**

- **Renamed to "Autotask Node SDK"**: More professional and descriptive branding
- **Enhanced Feature Descriptions**: Clear articulation of enterprise capabilities
- **Professional Documentation Structure**: Industry-standard documentation format

### DOCUMENTATION IMPROVEMENTS

**API Documentation (docs/API.md):**

- Complete method signatures for all client operations
- TypeScript interface definitions for core entities
- Query builder operator reference with 14 comparison operators
- Authentication and configuration examples
- Error handling patterns and recovery strategies
- Performance configuration options

**Entity Documentation (docs/ENTITIES.md):**

- Comprehensive reference for all 178 supported entities
- Organized by 17 functional categories (Core Business, Contract Management, Financial, etc.)
- Entity relationship descriptions and common usage patterns
- CRUD operation availability matrix
- Query examples for each major entity category

**Usage Examples (docs/EXAMPLES.md):**

- Real-world integration scenarios and workflows
- Advanced query patterns with complex filtering
- Batch processing and performance optimization techniques
- Error handling with specific error types and recovery
- CLI usage examples and shell scripting patterns
- Enterprise integration patterns (webhooks, queues, caching)

**Query Builder Documentation (docs/QUERY_BUILDER.md):**

- Enhanced with additional examples and use cases
- Performance considerations and optimization tips
- Memory management for large datasets
- Advanced filtering techniques

### IMPROVEMENTS

**README Enhancements:**

- Professional presentation with badges and feature highlights
- Comprehensive feature matrix showing 178 entity support
- Clear authentication setup with multiple configuration options
- Advanced usage examples with real-world scenarios
- Performance configuration options and monitoring
- Community support information and contribution guidelines

**Professional Presentation:**

- Consistent documentation formatting and styling
- Clear navigation between different documentation sections
- Enterprise-focused feature descriptions and capabilities
- Professional code examples with proper error handling
- Comprehensive table of contents and cross-references

## 1.0.0 - Initial Release

**June 9, 2025** — First stable release of the Autotask API Wrapper, a TypeScript/Node.js client library for the Autotask REST API.

**IMPORTANT:**

- This is a major release that establishes the foundational API and behavior patterns. Future releases will maintain backward compatibility within the 1.x series.
- The `region` parameter has been removed from configuration. The client now automatically detects the correct API zone using Autotask's zone detection endpoint.
- All entity operations support the Query Builder system for filtering and data retrieval.

**NEW FEATURES:**

**Autotask API Integration:**

- **Automatic Zone Detection**: Client automatically discovers the correct API endpoint using provided credentials, eliminating manual region configuration.
- **Entity Support**: CRUD operations for major Autotask entities including Tickets, Accounts, Contacts, Projects, Tasks, Time Entries, Contracts, Invoices, Quotes, Purchase Orders, and others.
- **Request Handling**: Built-in retry logic with exponential backoff, rate limiting, and error handling.
- **TypeScript Support**: Type definitions for entities, API responses, and query operations with IntelliSense support.

**Query Builder System:**

- **Type-Safe Fluent API**: Build queries with TypeScript validation and compile-time error checking.
- **Comparison Operators**: Support for `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `in`, `notIn`, `isNull`, `isNotNull`, and `between`.
- **Logical Grouping**: AND/OR operations with nesting capabilities for complex query construction.
- **Sorting**: Multi-field sorting with ascending/descending directions and chainable sort operations.
- **Field Selection**: Selective field retrieval using `select()` operations for performance optimization.
- **Related Entity Includes**: Fetch related data in single queries with field specification using `include()` operations.
- **Pagination**: Both offset-based and cursor-based pagination support with automatic page traversal.
- **Query Execution Methods**: Multiple execution patterns including `execute()`, `first()`, `count()`, and `exists()`.
- **Query Utilities**: Utilities including `clone()`, `reset()`, and `toQuerySpec()` for debugging.

**Enhanced Entity System:**

- **QueryableEntity Base Class**: Base class allowing entities to inherit query capabilities.
- **Enhanced Tickets Entity**: Integrated query builder with specialized query methods for common ticket operations.
- **Standardized CRUD Operations**: Consistent interface patterns across entity types with error handling.

**Command Line Interface:**

- **CLI Tool**: Command-line interface supporting entities with CRUD operations.
- **Interactive Mode**: Prompts for creating and updating entities with input validation.
- **Output Options**: Support for JSON output and formatted table display of results.
- **Environment Integration**: Integration with environment variables and configuration files.

**IMPROVEMENTS:**

**Developer Experience:**

- **Testing**: 460 unit tests with 100% pass rate, including 46 query builder tests and optimized integration test suite (11 tests).
- **Integration Test Infrastructure**: Test framework for validating against real Autotask API endpoints, optimized to respect API rate limits.
- **Custom Jest Matchers**: Test assertions for Autotask entity validation and API response testing.
- **Performance Monitoring**: Built-in performance tracking with metrics and optimization utilities.
- **Memory Management**: Pagination handling and memory optimization for large dataset operations.

**API Robustness:**

- **Error Handling**: Error types and recovery strategies for API scenarios including rate limiting, authentication failures, and network issues.
- **Rate Limiting**: Throttling and backoff strategies that respect Autotask API rate limits.
- **Connection Resilience**: Automatic retry mechanisms with exponential backoff for transient failures.
- **Request Optimization**: Batching and caching strategies for improved performance.

**Documentation and Tooling:**

- **API Documentation**: Guides with examples for features and entity operations.
- **Query Builder Guide**: Documentation with usage patterns and best practices for the query system.
- **Integration Setup**: Guides for integrating with development environments and CI/CD systems.
- **TypeScript Definitions**: Type coverage enabling IDE support and compile-time validation.

**SECURITY:**

- **Secure Authentication**: Credential handling with support for environment variables and secure configuration storage.
- **Token Management**: Automatic token refresh and secure storage of authentication credentials.
- **Request Validation**: Input validation and sanitization for API operations to prevent injection attacks.
- **Error Information Protection**: Handling of sensitive information in error messages and logs.

**FIXES:**

**Build and Configuration:**

- **Jest Configuration**: Resolved TypeScript compilation issues and module resolution problems in test environments.
- **Winston Logger Setup**: Fixed console noise in test environments with proper logger configuration.
- **Type System Compatibility**: Resolved TypeScript compilation errors across entity classes and utility functions.
- **Module Dependencies**: Fixed import/export issues and circular dependency problems.

**Test Infrastructure:**

- **Unit Test Timeouts**: Resolved timeout issues caused by retry logic in RequestHandler during test execution.
- **Mock System Integration**: Fixed Jest mock compatibility issues with TypeScript and Winston logger.
- **Integration Test Stability**: Improved test reliability with better error handling and API limitation detection.
- **Test Coverage Reporting**: Fixed coverage calculation and reporting for both unit and integration tests.

**Query System:**

- **Type Inference**: Resolved TypeScript type inference issues in complex query chains and method chaining.
- **Runtime Validation**: Fixed validation of query parameters and operator combinations.
- **Error Handling**: Improved error messages for invalid query construction and execution failures.

---

_For more information about the Autotask Node SDK, visit our [GitHub repository](https://github.com/asachs01/autotask-node) or read our [documentation](./docs/)._

_To report issues or request features, please [open an issue](https://github.com/asachs01/autotask-node/issues) on GitHub._
