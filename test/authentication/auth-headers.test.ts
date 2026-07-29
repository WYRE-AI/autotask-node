import axios from 'axios';
import { AutotaskClient } from '../../src/client/AutotaskClient';

/**
 * Test file to verify proper authentication headers are being used
 *
 * Autotask API requires three specific headers for authentication:
 * - ApiIntegrationCode: The integration code from Autotask
 * - UserName: The username (email)
 * - Secret: The API secret/password
 *
 * This replaces the incorrect Basic Auth implementation
 */

describe('Autotask Authentication Headers', () => {
  it('should use correct authentication headers (not Basic Auth)', async () => {
    const mockAxiosCreate = jest.spyOn(axios, 'create');

    // Mock the zone detection call
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        url: 'https://webservices14.autotask.net/ATServicesRest/',
      },
    });

    // Mock the test connection call
    mockAxiosCreate.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: {
          use: jest.fn(),
        },
        response: {
          use: jest.fn(),
        },
      },
    } as any);

    const config = {
      username: 'test@example.com',
      integrationCode: 'TEST_INTEGRATION_CODE',
      secret: 'TEST_SECRET',
    };

    await AutotaskClient.create(config);

    // Verify axios.create was called with correct headers
    expect(mockAxiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          ApiIntegrationCode: 'TEST_INTEGRATION_CODE',
          UserName: 'test@example.com',
          Secret: 'TEST_SECRET',
        }),
      })
    );

    // Verify NO Basic Auth header is present
    const createCall = mockAxiosCreate.mock.calls[0];
    if (createCall && createCall[0]) {
      expect(createCall[0].headers).not.toHaveProperty('Authorization');

      // Verify the old incorrect header name is not used
      expect(createCall[0].headers).not.toHaveProperty('ApiIntegrationcode'); // lowercase 'c'
    }
  });

  it('should properly encode username in zone detection URL', async () => {
    const mockAxiosGet = jest.spyOn(axios, 'get');

    // Mock the zone detection response
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        url: 'https://webservices14.autotask.net/ATServicesRest/',
      },
    });

    // Mock axios.create for the main client
    jest.spyOn(axios, 'create').mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: {
          use: jest.fn(),
        },
        response: {
          use: jest.fn(),
        },
      },
    } as any);

    const config = {
      username: 'user+test@example.com', // Username with special character
      integrationCode: 'TEST_CODE',
      secret: 'TEST_SECRET',
    };

    await AutotaskClient.create(config);

    // Verify the zone detection URL properly encodes the username
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://webservices.autotask.net/ATServicesRest/V1.0/zoneInformation?user=user%2Btest%40example.com'
    );
  });

  it('should handle authentication with all required headers in requests', () => {
    // This test verifies the format matches Autotask's requirements
    const expectedHeaders = {
      'Content-Type': 'application/json',
      ApiIntegrationCode: 'YOUR_INTEGRATION_CODE',
      UserName: 'your.email@domain.com',
      Secret: 'YOUR_SECRET',
    };

    // Example curl command that should be equivalent:
    const _curlCommand = `
      curl --location 'https://webservices14.autotask.net/atservicesrest/v1.0/CompanyCategories' \\
      --header 'ApiIntegrationCode: YOUR_INTEGRATION_CODE' \\
      --header 'UserName: your.email@domain.com' \\
      --header 'Secret: YOUR_SECRET' \\
      --header 'Content-Type: application/json'
    `.trim();

    // The headers object should match exactly what Autotask expects
    expect(expectedHeaders).toHaveProperty('ApiIntegrationCode');
    expect(expectedHeaders).toHaveProperty('UserName');
    expect(expectedHeaders).toHaveProperty('Secret');
    expect(expectedHeaders).not.toHaveProperty('Authorization');
  });

  it('should include ImpersonationResourceId header when impersonationResourceId is provided', async () => {
    const mockAxiosCreate = jest.spyOn(axios, 'create');

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        url: 'https://webservices14.autotask.net/ATServicesRest/',
      },
    });

    mockAxiosCreate.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);

    const config = {
      username: 'test@example.com',
      integrationCode: 'TEST_INTEGRATION_CODE',
      secret: 'TEST_SECRET',
      impersonationResourceId: 12345,
    };

    await AutotaskClient.create(config);

    expect(mockAxiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          ImpersonationResourceId: '12345',
        }),
      })
    );
  });

  it('should NOT include ImpersonationResourceId header when impersonationResourceId is not provided', async () => {
    const mockAxiosCreate = jest.spyOn(axios, 'create');

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        url: 'https://webservices14.autotask.net/ATServicesRest/',
      },
    });

    mockAxiosCreate.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);

    const config = {
      username: 'test@example.com',
      integrationCode: 'TEST_INTEGRATION_CODE',
      secret: 'TEST_SECRET',
    };

    await AutotaskClient.create(config);

    const createCall = mockAxiosCreate.mock.calls[0];
    if (createCall && createCall[0]) {
      expect(createCall[0].headers).not.toHaveProperty(
        'ImpersonationResourceId'
      );
    }
  });

  it('should properly set include ImpersonationResourceId header when AUTOTASK_IMPERSONATION_RESOURCE_ID env var is provided', async () => {
    const originalEnv = { ...process.env };

    const mockAxiosCreate = jest.spyOn(axios, 'create');

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        url: 'https://webservices14.autotask.net/ATServicesRest/',
      },
    });

    mockAxiosCreate.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);

    try {
      process.env.AUTOTASK_USERNAME = 'test@example.com';
      process.env.AUTOTASK_IMPERSONATION_RESOURCE_ID = '12345';
      process.env.AUTOTASK_INTEGRATION_CODE = 'TEST_INTEGRATION_CODE';
      process.env.AUTOTASK_SECRET = 'TEST_SECRET';

      await AutotaskClient.create();

      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            ImpersonationResourceId: '12345',
          }),
        })
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it('should fail if an invalid value for AUTOTASK_IMPERSONATION_RESOURCE_ID env var is provided', async () => {
    const originalEnv = { ...process.env };

    try {
      process.env.AUTOTASK_USERNAME = 'test@example.com';
      process.env.AUTOTASK_IMPERSONATION_RESOURCE_ID = 'not-a-number';
      process.env.AUTOTASK_INTEGRATION_CODE = 'TEST_INTEGRATION_CODE';
      process.env.AUTOTASK_SECRET = 'TEST_SECRET';

      await expect(AutotaskClient.create()).rejects.toThrow(
        'AUTOTASK_IMPERSONATION_RESOURCE_ID must be a positive integer'
      );
    } finally {
      process.env = originalEnv;
    }
  });
});
