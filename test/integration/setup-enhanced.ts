import { TestEnvironment, TestEnvironmentType } from './framework/TestEnvironment';
import { TestReporter } from './reporting/TestReporter';
import { loadTestConfig, getConfigSummary } from './config/TestConfig';
import { AutotaskClient } from '../../src/client/AutotaskClient';

/**
 * Enhanced global setup for integration tests
 */
export default async function globalSetup(): Promise<void> {
  console.log('🚀 Starting Enhanced Autotask Integration Test Suite...');
  
  try {
    // Load configuration
    const config = loadTestConfig();
    
    if (config.skipIntegrationTests) {
      console.log('⚠️ Integration tests are disabled or credentials not available');
      console.log('To enable integration tests:');
      console.log('1. Copy .env.test.example to .env.test');
      console.log('2. Configure your Autotask API credentials');
      console.log('3. Run tests again');
      
      // Store skip flag globally
      (globalThis as any).__INTEGRATION_CONFIG__ = {
        skipIntegrationTests: true,
        config: config
      };
      
      return;
    }
    
    // Display configuration summary
    console.log('📋 Configuration Summary:');
    console.log(getConfigSummary(config));
    
    // Initialize Autotask client
    console.log('🔗 Initializing Autotask client...');
    const client = new AutotaskClient({
      username: config.autotask.username,
      integrationCode: config.autotask.integrationCode,
      secret: config.autotask.secret,
      apiUrl: config.autotask.apiUrl,
    });
    
    // Initialize test environment
    console.log('🏢 Setting up test environment...');
    const testEnvironment = new TestEnvironment(client, config.environment);
    await testEnvironment.initialize();
    
    // Initialize test reporter
    console.log('📊 Initializing test reporter...');
    const testReporter = new TestReporter(testEnvironment);
    
    // Validate connection
    console.log('✅ Validating API connection...');
    try {
      const versionInfo = await client.version.list({ pageSize: 1 });
      console.log('✅ API connection successful');
    } catch (error) {
      console.error('❌ API connection failed:', error);
      throw new Error('API connection validation failed', { cause: error });
    }
    
    // Store global instances
    (globalThis as any).__INTEGRATION_CONFIG__ = {
      skipIntegrationTests: false,
      config: config,
      client: client,
      testEnvironment: testEnvironment,
      testReporter: testReporter,
      startTime: Date.now()
    };
    
    console.log('✨ Enhanced Integration Test Suite initialized successfully!');
    console.log(`🏠 Environment: ${config.environment}`);
    console.log(`🔒 Safety Mode: ${config.safety.allowDataCreation ? 'FULL CRUD' : 'READ-ONLY'}`);
    console.log(`📊 Performance Testing: ${config.logging.enablePerformanceLogs ? 'ENABLED' : 'DISABLED'}`);
    
  } catch (error) {
    console.error('❌ Failed to initialize Enhanced Integration Test Suite:', error);
    
    // Store error state
    (globalThis as any).__INTEGRATION_CONFIG__ = {
      skipIntegrationTests: true,
      error: error,
      config: null
    };
    
    // Don't throw - allow tests to handle gracefully
  }
}
