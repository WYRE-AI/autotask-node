#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';

/**
 * Entity metadata structure from autotask-complete-entities.json
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
  categories: Record<string, {
    description: string;
    entities: string[];
  }>;
  entities: EntityMetadata[];
}

/**
 * TypeScript Entity Code Generator
 * Generates entity classes and test files from autotask-entities.json
 */
class EntityGenerator {
  private readonly projectRoot: string;
  private readonly entitiesDir: string;
  private readonly testsDir: string;
  private readonly dataFile: string;
  
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
    this.entitiesDir = path.join(this.projectRoot, 'src', 'entities');
    this.testsDir = path.join(this.projectRoot, 'test', 'entities');
    this.dataFile = path.join(this.projectRoot, 'src', 'data', 'autotask-complete-entities.json');
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
   * Check if entity file already exists
   */
  private entityExists(entityName: string): boolean {
    const filename = this.getEntityFileName(entityName);
    const filePath = path.join(this.entitiesDir, filename);
    return fs.existsSync(filePath);
  }

  /**
   * Get the filename for an entity (camelCase)
   */
  private getEntityFileName(entityName: string): string {
    return `${entityName.toLowerCase()}.ts`;
  }

  /**
   * Convert entity name to camelCase for use in class names
   */
  private toCamelCase(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Convert entity name to PascalCase for interfaces and classes
   */
  private toPascalCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Check if entity supports a specific operation
   */
  private supportsOperation(entity: EntityMetadata, operation: string): boolean {
    return entity.supportedOperations.includes(operation);
  }

  /**
   * Generate entity interface with I prefix to avoid naming conflicts
   */
  private generateInterface(entity: EntityMetadata): string {
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    
    return `export interface ${interfaceName} {
  id?: number;
  [key: string]: any;
}`;
  }

  /**
   * Generate query interface with I prefix to avoid naming conflicts
   */
  private generateQueryInterface(entity: EntityMetadata): string {
    const queryName = `I${this.toPascalCase(entity.name)}Query`;
    
    return `export interface ${queryName} {
  filter?: Record<string, any>;
  sort?: string;
  page?: number;
  pageSize?: number;
}`;
  }

  /**
   * Generate metadata method
   */
  private generateMetadata(entity: EntityMetadata): string {
    const className = this.toPascalCase(entity.pluralName);
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const camelName = this.toCamelCase(entity.name);
    const endpoint = `/${entity.pluralName}`;

    const operations: string[] = [];

    if (this.supportsOperation(entity, 'POST')) {
      operations.push(`      {
        operation: 'create${this.toPascalCase(entity.name)}',
        requiredParams: ['${camelName}'],
        optionalParams: [],
        returnType: '${interfaceName}',
        endpoint: '${endpoint}',
      }`);
    }

    if (this.supportsOperation(entity, 'GET')) {
      operations.push(`      {
        operation: 'get${this.toPascalCase(entity.name)}',
        requiredParams: ['id'],
        optionalParams: [],
        returnType: '${interfaceName}',
        endpoint: '${endpoint}/{id}',
      }`);
    }

    if (this.supportsOperation(entity, 'PUT')) {
      operations.push(`      {
        operation: 'update${this.toPascalCase(entity.name)}',
        requiredParams: ['id', '${camelName}'],
        optionalParams: [],
        returnType: '${interfaceName}',
        endpoint: '${endpoint}/{id}',
      }`);
    }

    if (this.supportsOperation(entity, 'DELETE')) {
      operations.push(`      {
        operation: 'delete${this.toPascalCase(entity.name)}',
        requiredParams: ['id'],
        optionalParams: [],
        returnType: 'void',
        endpoint: '${endpoint}/{id}',
      }`);
    }

    // Always add list operation
    operations.push(`      {
        operation: 'list${entity.pluralName}',
        requiredParams: [],
        optionalParams: ['filter', 'sort', 'page', 'pageSize'],
        returnType: '${interfaceName}[]',
        endpoint: '${endpoint}',
      }`);

    return `  static getMetadata(): MethodMetadata[] {
    return [
${operations.join(',\n')}
    ];
  }`;
  }

  /**
   * Generate CRUD methods
   */
  private generateMethods(entity: EntityMetadata): string {
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const camelName = this.toCamelCase(entity.name);
    const queryName = `I${this.toPascalCase(entity.name)}Query`;
    const endpoint = `/${entity.pluralName}`;

    const methods: string[] = [];

    // Create method
    if (this.supportsOperation(entity, 'POST')) {
      methods.push(`  /**
   * Create a new ${entity.name.toLowerCase()}
   * @param ${camelName} - The ${entity.name.toLowerCase()} data to create
   * @returns Promise with the created ${entity.name.toLowerCase()}
   */
  async create(${camelName}: ${interfaceName}): Promise<ApiResponse<${interfaceName}>> {
    this.logger.info('Creating ${entity.name.toLowerCase()}', { ${camelName} });
    return this.executeRequest(
      async () => this.axios.post(this.endpoint, ${camelName}),
      this.endpoint,
      'POST'
    );
  }`);
    }

    // Get method
    if (this.supportsOperation(entity, 'GET')) {
      methods.push(`  /**
   * Get a ${entity.name.toLowerCase()} by ID
   * @param id - The ${entity.name.toLowerCase()} ID
   * @returns Promise with the ${entity.name.toLowerCase()} data
   */
  async get(id: number): Promise<ApiResponse<${interfaceName}>> {
    this.logger.info('Getting ${entity.name.toLowerCase()}', { id });
    return this.executeRequest(
      async () => this.axios.get(\`\${this.endpoint}/\${id}\`),
      \`\${this.endpoint}/\${id}\`,
      'GET'
    );
  }`);
    }

    // Update method
    if (this.supportsOperation(entity, 'PUT')) {
      methods.push(`  /**
   * Update a ${entity.name.toLowerCase()}
   * @param id - The ${entity.name.toLowerCase()} ID
   * @param ${camelName} - The updated ${entity.name.toLowerCase()} data
   * @returns Promise with the updated ${entity.name.toLowerCase()}
   */
  async update(
    id: number,
    ${camelName}: Partial<${interfaceName}>
  ): Promise<ApiResponse<${interfaceName}>> {
    this.logger.info('Updating ${entity.name.toLowerCase()}', { id, ${camelName} });
    return this.executeRequest(
      async () => this.axios.put(\`\${this.endpoint}/\${id}\`, ${camelName}),
      \`\${this.endpoint}/\${id}\`,
      'PUT'
    );
  }`);
    }

    // Patch method
    if (this.supportsOperation(entity, 'PATCH')) {
      methods.push(`  /**
   * Partially update a ${entity.name.toLowerCase()}
   * @param id - The ${entity.name.toLowerCase()} ID
   * @param ${camelName} - The partial ${entity.name.toLowerCase()} data to update
   * @returns Promise with the updated ${entity.name.toLowerCase()}
   */
  async patch(
    id: number,
    ${camelName}: Partial<${interfaceName}>
  ): Promise<ApiResponse<${interfaceName}>> {
    this.logger.info('Patching ${entity.name.toLowerCase()}', { id, ${camelName} });
    return this.executeRequest(
      async () => this.axios.patch(\`\${this.endpoint}/\${id}\`, ${camelName}),
      \`\${this.endpoint}/\${id}\`,
      'PATCH'
    );
  }`);
    }

    // Delete method
    if (this.supportsOperation(entity, 'DELETE')) {
      methods.push(`  /**
   * Delete a ${entity.name.toLowerCase()}
   * @param id - The ${entity.name.toLowerCase()} ID
   * @returns Promise that resolves when deletion is complete
   */
  async delete(id: number): Promise<void> {
    this.logger.info('Deleting ${entity.name.toLowerCase()}', { id });
    await this.executeRequest(
      async () => this.axios.delete(\`\${this.endpoint}/\${id}\`),
      \`\${this.endpoint}/\${id}\`,
      'DELETE'
    );
  }`);
    }

    // List method - always available
    const hasAccountFilter = entity.name === 'Ticket'; // Special handling for tickets
    const listMethod = hasAccountFilter ? this.generateTicketListMethod(entity) : this.generateStandardListMethod(entity);
    methods.push(listMethod);

    return methods.join('\n\n');
  }

  /**
   * Generate standard list method
   */
  private generateStandardListMethod(entity: EntityMetadata): string {
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const queryName = `I${this.toPascalCase(entity.name)}Query`;

    return `  /**
   * List ${entity.pluralName.toLowerCase()} with optional filtering
   * @param query - Query parameters for filtering, sorting, and pagination
   * @returns Promise with array of ${entity.pluralName.toLowerCase()}
   */
  async list(query: ${queryName} = {}): Promise<ApiResponse<${interfaceName}[]>> {
    this.logger.info('Listing ${entity.pluralName.toLowerCase()}', { query });
    const searchBody: Record<string, any> = {};

    // Set up basic filter if none provided
    if (!query.filter || Object.keys(query.filter).length === 0) {
      searchBody.filter = [
        {
          op: 'gte',
          field: 'id',
          value: 0,
        },
      ];
    } else {
      // Convert object filter to array format
      if (!Array.isArray(query.filter)) {
        const filterArray = [];
        for (const [field, value] of Object.entries(query.filter)) {
          filterArray.push({
            op: 'eq',
            field: field,
            value: value,
          });
        }
        searchBody.filter = filterArray;
      } else {
        searchBody.filter = query.filter;
      }
    }

    if (query.sort) searchBody.sort = query.sort;
    if (query.page) searchBody.page = query.page;
    if (query.pageSize) searchBody.pageSize = query.pageSize;

    return this.executeQueryRequest(
      async () => this.axios.get(\`\${this.endpoint}/query\`, { params: searchBody }),
      \`\${this.endpoint}/query\`,
      'GET'
    );
  }`;
  }

  /**
   * Generate special ticket list method with account validation
   */
  private generateTicketListMethod(entity: EntityMetadata): string {
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const queryName = `I${this.toPascalCase(entity.name)}Query`;

    return `  /**
   * List tickets with required account filtering
   * @param query - Query parameters for filtering, sorting, and pagination
   * @returns Promise with array of tickets
   */
  async list(query: ${queryName} = {}): Promise<ApiResponse<${interfaceName}[]>> {
    this.logger.info('Listing tickets', { query });
    const searchBody: Record<string, any> = {};

    // Ensure there's a filter - Autotask API requires a filter
    if (!query.filter || Object.keys(query.filter).length === 0) {
      searchBody.filter = [
        {
          op: 'gte',
          field: 'id',
          value: 0,
        },
      ];
    } else {
      // If filter is provided as an object, convert to array format expected by API
      if (!Array.isArray(query.filter)) {
        const filterArray = [];
        for (const [field, value] of Object.entries(query.filter)) {
          filterArray.push({
            op: 'eq',
            field: field,
            value: value,
          });
        }
        searchBody.filter = filterArray;
      } else {
        searchBody.filter = query.filter;
      }
    }

    if (query.sort) searchBody.sort = query.sort;
    if (query.page) searchBody.page = query.page;
    if (query.pageSize) searchBody.pageSize = query.pageSize;

    // Validate that accountId is included in the search
    let hasAccountFilter = false;
    if (Array.isArray(searchBody.filter)) {
      hasAccountFilter = searchBody.filter.some(
        (f: any) => f.field === 'accountId' || f.field === 'companyID'
      );
    }

    if (!hasAccountFilter) {
      this.logger.warn('No accountId filter found in ticket query');
    }

    return this.executeQueryRequest(
      async () => this.axios.get(\`\${this.endpoint}/query\`, { params: searchBody }),
      \`\${this.endpoint}/query\`,
      'GET'
    );
  }`;
  }

  /**
   * Generate complete entity class
   */
  private generateEntityClass(entity: EntityMetadata): string {
    const className = this.toPascalCase(entity.pluralName);
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const queryName = `I${this.toPascalCase(entity.name)}Query`;
    const endpoint = `/${entity.pluralName}`;

    const supportedOps = entity.supportedOperations.join(', ');

    return `import { AxiosInstance } from 'axios';
import winston from 'winston';
import { MethodMetadata, ApiResponse, RequestHandler } from '../types';
import { BaseEntity } from './base';

${this.generateInterface(entity)}

${this.generateQueryInterface(entity)}

/**
 * ${entity.pluralName} entity class for Autotask API
 * 
 * ${entity.description}
 * Supported Operations: ${supportedOps}
 * Category: ${entity.category}
 * 
 * @see {@link https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/${entity.fileName}}
 */
export class ${className} extends BaseEntity {
  private readonly endpoint = '${endpoint}';

  constructor(
    axios: AxiosInstance,
    logger: winston.Logger,
    requestHandler?: RequestHandler
  ) {
    super(axios, logger, requestHandler);
  }

${this.generateMetadata(entity)}

${this.generateMethods(entity)}
}`;
  }

  /**
   * Generate test file for entity
   */
  private generateTestFile(entity: EntityMetadata): string {
    const className = this.toPascalCase(entity.pluralName);
    const interfaceName = `I${this.toPascalCase(entity.name)}`;
    const queryName = `I${this.toPascalCase(entity.name)}Query`;
    const camelName = this.toCamelCase(entity.name);
    const camelPlural = this.toCamelCase(entity.pluralName);
    const fileName = this.getEntityFileName(entity.pluralName);

    const testMethods: string[] = [];

    // List test - always present
    testMethods.push(`  describe('list', () => {
    it('should list ${entity.pluralName.toLowerCase()} successfully', async () => {
      const mockData = [
        { id: 1, name: '${entity.name} 1' },
        { id: 2, name: '${entity.name} 2' },
      ];

      mockAxios.get.mockResolvedValueOnce({
        data: { items: mockData },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await ${camelPlural}.list();

      expect(result.data).toEqual(mockData);
      expect(mockAxios.get).toHaveBeenCalledWith('/${entity.pluralName}/query', {
        params: {
          filter: [{ op: 'gte', field: 'id', value: 0 }]
        }
      });
    });

    it('should handle query parameters', async () => {
      const query: ${queryName} = {
        filter: { name: 'test' },
        sort: 'id',
        page: 1,
        pageSize: 10,
      };

      mockAxios.get.mockResolvedValueOnce({
        data: { items: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await ${camelPlural}.list(query);

      expect(mockAxios.get).toHaveBeenCalledWith('/${entity.pluralName}/query', {
        params: {
          filter: [{ op: 'eq', field: 'name', value: 'test' }],
          sort: 'id',
          page: 1,
          pageSize: 10,
        }
      });
    });
  });`);

    // Get test
    if (this.supportsOperation(entity, 'GET')) {
      testMethods.push(`  describe('get', () => {
    it('should get ${entity.name.toLowerCase()} by id', async () => {
      const mockData = { id: 1, name: 'Test ${entity.name}' };

      mockAxios.get.mockResolvedValueOnce({
        data: { item: mockData },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await ${camelPlural}.get(1);

      expect(result.data).toEqual(mockData);
      expect(mockAxios.get).toHaveBeenCalledWith('/${entity.pluralName}/1');
    });
  });`);
    }

    // Create test
    if (this.supportsOperation(entity, 'POST')) {
      testMethods.push(`  describe('create', () => {
    it('should create ${entity.name.toLowerCase()} successfully', async () => {
      const ${camelName}Data = { name: 'New ${entity.name}' };
      const mockResponse = { id: 1, ...${camelName}Data };

      mockAxios.post.mockResolvedValueOnce({
        data: { item: mockResponse },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      });

      const result = await ${camelPlural}.create(${camelName}Data);

      expect(result.data).toEqual(mockResponse);
      expect(mockAxios.post).toHaveBeenCalledWith('/${entity.pluralName}', ${camelName}Data);
    });
  });`);
    }

    // Update test
    if (this.supportsOperation(entity, 'PUT')) {
      testMethods.push(`  describe('update', () => {
    it('should update ${entity.name.toLowerCase()} successfully', async () => {
      const ${camelName}Data = { name: 'Updated ${entity.name}' };
      const mockResponse = { id: 1, ...${camelName}Data };

      mockAxios.put.mockResolvedValueOnce({
        data: { item: mockResponse },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await ${camelPlural}.update(1, ${camelName}Data);

      expect(result.data).toEqual(mockResponse);
      expect(mockAxios.put).toHaveBeenCalledWith('/${entity.pluralName}/1', ${camelName}Data);
    });
  });`);
    }

    // Patch test
    if (this.supportsOperation(entity, 'PATCH')) {
      testMethods.push(`  describe('patch', () => {
    it('should partially update ${entity.name.toLowerCase()} successfully', async () => {
      const ${camelName}Data = { name: 'Patched ${entity.name}' };
      const mockResponse = { id: 1, ...${camelName}Data };

      mockAxios.patch.mockResolvedValueOnce({
        data: { item: mockResponse },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await ${camelPlural}.patch(1, ${camelName}Data);

      expect(result.data).toEqual(mockResponse);
      expect(mockAxios.patch).toHaveBeenCalledWith('/${entity.pluralName}/1', ${camelName}Data);
    });
  });`);
    }

    // Delete test
    if (this.supportsOperation(entity, 'DELETE')) {
      testMethods.push(`  describe('delete', () => {
    it('should delete ${entity.name.toLowerCase()} successfully', async () => {
      mockAxios.delete.mockResolvedValueOnce({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await ${camelPlural}.delete(1);

      expect(mockAxios.delete).toHaveBeenCalledWith('/${entity.pluralName}/1');
    });
  });`);
    }

    return `import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import winston from 'winston';
import {
  ${className},
  ${interfaceName},
  ${queryName},
} from '../../src/entities/${fileName.replace('.ts', '')}';

describe('${className} Entity', () => {
  let ${camelPlural}: ${className};
  let mockAxios: jest.Mocked<AxiosInstance>;
  let mockLogger: winston.Logger;

  beforeEach(() => {
    mockAxios = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: {
          use: jest.fn(),
          eject: jest.fn(),
        },
        response: {
          use: jest.fn(),
          eject: jest.fn(),
        },
      },
    } as any;

    mockLogger = winston.createLogger({
      level: 'error',
      transports: [new winston.transports.Console({ silent: true })],
    });

    ${camelPlural} = new ${className}(mockAxios, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

${testMethods.join('\n\n')}
});`;
  }

  /**
   * Generate single entity
   */
  async generateEntity(entityName: string, force: boolean = false): Promise<void> {
    const entitiesData = this.loadEntityData();
    const entity = entitiesData.entities.find(e => e.name === entityName);

    if (!entity) {
      throw new Error(`Entity '${entityName}' not found in metadata`);
    }

    const entityFile = path.join(this.entitiesDir, this.getEntityFileName(entity.pluralName));
    const testFile = path.join(this.testsDir, this.getEntityFileName(entity.pluralName).replace('.ts', '.test.ts'));

    // Check if entity already exists
    if (!force && this.entityExists(entity.pluralName)) {
      console.log(`⚠️  Entity ${entity.name} already exists. Use --force to overwrite.`);
      return;
    }

    console.log(`🔨 Generating entity: ${entity.name} -> ${entity.pluralName}`);

    // Generate entity class
    const entityCode = this.generateEntityClass(entity);
    fs.writeFileSync(entityFile, entityCode, 'utf8');
    console.log(`✅ Generated entity file: ${entityFile}`);

    // Generate test file
    if (!fs.existsSync(this.testsDir)) {
      fs.mkdirSync(this.testsDir, { recursive: true });
    }
    
    const testCode = this.generateTestFile(entity);
    fs.writeFileSync(testFile, testCode, 'utf8');
    console.log(`✅ Generated test file: ${testFile}`);

    console.log(`✨ Entity ${entity.name} generated successfully!`);
  }

  /**
   * Generate all entities
   */
  async generateAllEntities(force: boolean = false): Promise<void> {
    const entitiesData = this.loadEntityData();
    const generatedEntities: string[] = [];
    const skippedEntities: string[] = [];

    for (const entity of entitiesData.entities) {
      try {
        if (!force && this.entityExists(entity.pluralName)) {
          skippedEntities.push(entity.name);
          continue;
        }

        await this.generateEntity(entity.name, force);
        generatedEntities.push(entity.name);
      } catch (error) {
        console.error(`❌ Failed to generate entity ${entity.name}:`, error);
      }
    }

    console.log(`\n📊 Generation Summary:`);
    console.log(`✅ Generated: ${generatedEntities.length} entities`);
    if (skippedEntities.length > 0) {
      console.log(`⏭️  Skipped: ${skippedEntities.length} entities (already exist)`);
    }

    if (generatedEntities.length > 0) {
      await this.updateIndexFile(generatedEntities);
    }
  }

  /**
   * Update the entities index.ts file
   */
  async updateIndexFile(newEntities?: string[]): Promise<void> {
    const indexFile = path.join(this.entitiesDir, 'index.ts');
    const entitiesData = this.loadEntityData();
    
    // Get all entities that should be exported
    const allEntities = entitiesData.entities
      .filter(entity => this.entityExists(entity.pluralName))
      .map(entity => ({
        className: this.toPascalCase(entity.pluralName),
        fileName: this.getEntityFileName(entity.pluralName).replace('.ts', '')
      }))
      .sort((a, b) => a.className.localeCompare(b.className));

    const exports = allEntities
      .map(entity => `export { ${entity.className} } from './${entity.fileName}';`)
      .join('\n');

    // Read existing file to preserve comments if they exist
    let existingContent = '';
    if (fs.existsSync(indexFile)) {
      existingContent = fs.readFileSync(indexFile, 'utf8');
    }

    // Extract any comments or groupings from existing file
    const commentLines = existingContent
      .split('\n')
      .filter(line => line.trim().startsWith('//') && !line.includes('export'))
      .join('\n');

    const newContent = commentLines ? `${commentLines}\n\n${exports}` : exports;

    fs.writeFileSync(indexFile, newContent, 'utf8');
    console.log(`✅ Updated index file: ${indexFile}`);

    if (newEntities && newEntities.length > 0) {
      console.log(`📝 Added exports for: ${newEntities.join(', ')}`);
    }
  }

  /**
   * List entities and their status
   */
  listEntities(): void {
    const entitiesData = this.loadEntityData();
    
    console.log(`\n📋 Entity Status Report:`);
    console.log(`Total entities in metadata: ${entitiesData.entities.length}\n`);

    const existing: string[] = [];
    const missing: string[] = [];

    for (const entity of entitiesData.entities) {
      const exists = this.entityExists(entity.pluralName);
      const status = exists ? '✅' : '❌';
      const operations = entity.supportedOperations.join(', ');

      console.log(`${status} ${entity.name} -> ${entity.pluralName} (${operations})`);
      
      if (exists) {
        existing.push(entity.name);
      } else {
        missing.push(entity.name);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`✅ Existing: ${existing.length}`);
    console.log(`❌ Missing: ${missing.length}`);

    if (missing.length > 0) {
      console.log(`\n🔨 To generate missing entities:`);
      console.log(`npm run generate-entities -- --entity ${missing[0]} # Generate single entity`);
      console.log(`npm run generate-entities -- --all # Generate all missing entities`);
    }
  }
}

/**
 * CLI Interface
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const generator = new EntityGenerator();

  try {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
🔧 Autotask Entity Generator

Usage:
  npm run generate-entities                    # List entity status
  npm run generate-entities -- --all          # Generate all missing entities
  npm run generate-entities -- --entity <name> # Generate specific entity
  npm run generate-entities -- --force        # Force regeneration (use with --all or --entity)
  npm run generate-entities -- --update-index # Update index.ts with existing entities

Examples:
  npm run generate-entities -- --entity Company
  npm run generate-entities -- --entity Company --force
  npm run generate-entities -- --all --force
      `);
      return;
    }

    if (args.includes('--all')) {
      const force = args.includes('--force');
      await generator.generateAllEntities(force);
      return;
    }

    if (args.includes('--update-index')) {
      await generator.updateIndexFile();
      return;
    }

    const entityIndex = args.indexOf('--entity');
    if (entityIndex !== -1 && args[entityIndex + 1]) {
      const entityName = args[entityIndex + 1];
      const force = args.includes('--force');
      await generator.generateEntity(entityName, force);
      await generator.updateIndexFile();
      return;
    }

    // Default: list entities
    generator.listEntities();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { EntityGenerator };