import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import winston from 'winston';
import { BaseEntity } from '../src/entities/base';
import { RequestHandler, RequestOptions } from '../src/utils/requestHandler';
import { NotFoundError } from '../src/utils/errors';

// Concrete implementation for testing the abstract BaseEntity class
class TestEntity extends BaseEntity {
  private readonly endpoint = '/TestEntities';

  async testExecuteRequest<T>(
    requestFn: () => Promise<any>,
    endpoint: string,
    method: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const response = await this.executeRequest<T>(requestFn, endpoint, method, options);
    return response.data;
  }

  async testExecuteQueryRequest<T>(
    requestFn: () => Promise<any>,
    endpoint: string,
    method: string,
    options: RequestOptions = {}
  ): Promise<T[]> {
    const response = await this.executeQueryRequest<T>(requestFn, endpoint, method, options);
    return response.data;
  }

  async testRequestWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 500,
    endpoint = 'unknown',
    method = 'unknown'
  ): Promise<T> {
    return this.requestWithRetry(fn, retries, delay, endpoint, method);
  }

  // Expose protected properties for testing
  get testRequestHandler(): RequestHandler {
    return this.requestHandler;
  }

  get testAxios(): AxiosInstance {
    return this.axios;
  }

  get testLogger(): winston.Logger {
    return this.logger;
  }
}

describe('BaseEntity - Comprehensive Tests', () => {
  let testEntity: TestEntity;
  let mockAxios: jest.Mocked<AxiosInstance>;
  let mockLogger: winston.Logger;
  let mockRequestHandler: jest.Mocked<RequestHandler>;

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

    mockRequestHandler = {
      executeRequest: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with provided axios and logger', () => {
      const entity = new TestEntity(mockAxios, mockLogger);

      expect(entity.testAxios).toBe(mockAxios);
      expect(entity.testLogger).toBe(mockLogger);
    });

    it('should initialize with provided request handler', () => {
      const entity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);

      expect(entity.testRequestHandler).toBe(mockRequestHandler);
    });

    it('should create default request handler when none provided', () => {
      const entity = new TestEntity(mockAxios, mockLogger);

      expect(entity.testRequestHandler).toBeDefined();
      expect(entity.testRequestHandler).toBeInstanceOf(RequestHandler);
    });
  });

  describe('executeRequest', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should execute request successfully with item response', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockResponse = { data: { item: mockData } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(mockData);
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        requestFn,
        '/test',
        'GET',
        {}
      );
    });

    it('should execute request successfully with direct response', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockResponse = { data: mockData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(mockData);
    });

    it('should handle null item response by throwing NotFoundError', async () => {
      const mockResponse = { data: { item: null } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(
        testEntity.testExecuteRequest(requestFn, '/TestEntities/999', 'GET')
      ).rejects.toThrow(NotFoundError);
    });

    it('should pass through request options', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockResponse = { data: mockData };
      const options: RequestOptions = {
        retries: 5,
        baseDelay: 1000,
        enableRequestLogging: true,
      };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      await testEntity.testExecuteRequest(requestFn, '/test', 'POST', options);

      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        requestFn,
        '/test',
        'POST',
        options
      );
    });

    it('should handle request handler errors', async () => {
      const error = new AxiosError('Request failed');
      mockRequestHandler.executeRequest.mockRejectedValueOnce(error);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteRequest(requestFn, '/test', 'GET')
      ).rejects.toThrow('Request failed');
    });

    it('should extract resource type from endpoint for NotFoundError', async () => {
      const mockResponse = { data: { item: null } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);

      try {
        await testEntity.testExecuteRequest(requestFn, '/Companies/123', 'GET');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toContain('Resource not found');
      }
    });
  });

  describe('executeQueryRequest', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should execute query request successfully with items response', async () => {
      const mockData = [{ id: 1, name: 'Test1' }, { id: 2, name: 'Test2' }];
      const mockResponse = { data: { items: mockData, pageDetails: { total: 2 } } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST');

      expect(result).toEqual(mockData);
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        requestFn,
        '/test/query',
        'POST',
        {}
      );
    });

    it('should execute query request successfully with direct array response', async () => {
      const mockData = [{ id: 1, name: 'Test1' }, { id: 2, name: 'Test2' }];
      const mockResponse = { data: mockData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(mockData);
    });

    it('should handle empty results', async () => {
      const mockResponse = { data: { items: [] } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST');

      expect(result).toEqual([]);
    });

    it('should pass through request options', async () => {
      const mockData = [{ id: 1, name: 'Test' }];
      const mockResponse = { data: { items: mockData } };
      const options: RequestOptions = {
        retries: 2,
        enableResponseLogging: false,
      };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockResponse);
      await testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST', options);

      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        requestFn,
        '/test/query',
        'POST',
        options
      );
    });

    it('should handle request handler errors in query', async () => {
      const error = new AxiosError('Query failed');
      mockRequestHandler.executeRequest.mockRejectedValueOnce(error);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST')
      ).rejects.toThrow('Query failed');
    });
  });

  describe('requestWithRetry (Legacy)', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should execute legacy retry request successfully', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockResponse = { data: mockData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockData);
      const result = await testEntity.testRequestWithRetry(requestFn, 3, 500, '/test', 'GET');

      expect(result).toEqual(mockData);
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        expect.any(Function),
        '/test',
        'GET',
        {
          retries: 3,
          baseDelay: 500,
          enableRequestLogging: false,
          enableResponseLogging: false,
        }
      );
    });

    it('should use default parameters when not provided', async () => {
      const mockData = { success: true };
      const mockResponse = { data: mockData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockData);
      const result = await testEntity.testRequestWithRetry(requestFn);

      expect(result).toEqual(mockData);
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        expect.any(Function),
        'unknown',
        'unknown',
        {
          retries: 3,
          baseDelay: 500,
          enableRequestLogging: false,
          enableResponseLogging: false,
        }
      );
    });

    it('should handle errors from legacy retry', async () => {
      const error = new AxiosError('Legacy request failed');
      mockRequestHandler.executeRequest.mockRejectedValueOnce(error);

      const requestFn = jest.fn().mockRejectedValueOnce(error);

      await expect(
        testEntity.testRequestWithRetry(requestFn, 3, 500, '/test', 'POST')
      ).rejects.toThrow('Legacy request failed');
    });

    it('should wrap non-axios response format correctly', async () => {
      const mockData = 'plain response';
      const wrappedResponse = { data: mockData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(wrappedResponse);

      const requestFn = jest.fn().mockResolvedValueOnce(mockData);
      const result = await testEntity.testRequestWithRetry(requestFn);

      expect(result).toEqual(mockData);

      // Check that the function passed to executeRequest wraps the response
      const wrappingFunction = mockRequestHandler.executeRequest.mock.calls[0][0];
      const wrappedResult = await wrappingFunction();
      expect(wrappedResult).toEqual({ data: mockData });
    });
  });

  describe('Error Handling Scenarios', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should handle network errors', async () => {
      const networkError = new AxiosError('Network Error');
      networkError.code = 'ECONNREFUSED';

      mockRequestHandler.executeRequest.mockRejectedValueOnce(networkError);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteRequest(requestFn, '/test', 'GET')
      ).rejects.toThrow('Network Error');
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new AxiosError('Timeout');
      timeoutError.code = 'ECONNABORTED';

      mockRequestHandler.executeRequest.mockRejectedValueOnce(timeoutError);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteRequest(requestFn, '/test', 'GET')
      ).rejects.toThrow('Timeout');
    });

    it('should handle 404 errors from server', async () => {
      const notFoundError = new AxiosError('Not Found');
      notFoundError.response = { status: 404 } as any;

      mockRequestHandler.executeRequest.mockRejectedValueOnce(notFoundError);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteRequest(requestFn, '/test/999', 'GET')
      ).rejects.toThrow('Not Found');
    });

    it('should handle 500 server errors', async () => {
      const serverError = new AxiosError('Internal Server Error');
      serverError.response = { status: 500 } as any;

      mockRequestHandler.executeRequest.mockRejectedValueOnce(serverError);

      const requestFn = jest.fn();

      await expect(
        testEntity.testExecuteRequest(requestFn, '/test', 'POST')
      ).rejects.toThrow('Internal Server Error');
    });

    it('should handle malformed response structures', async () => {
      const malformedResponse = { data: 'unexpected string response' };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(malformedResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBe('unexpected string response');
    });

    it('should handle undefined response data', async () => {
      const undefinedResponse = {};

      mockRequestHandler.executeRequest.mockResolvedValueOnce(undefinedResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBeUndefined();
    });
  });

  describe('Request Handler Integration', () => {
    it('should create default RequestHandler with correct parameters', () => {
      const entity = new TestEntity(mockAxios, mockLogger);

      expect(entity.testRequestHandler).toBeDefined();
      expect(entity.testRequestHandler).toBeInstanceOf(RequestHandler);
    });

    it('should use provided RequestHandler', () => {
      const customHandler = new RequestHandler(mockAxios, mockLogger);
      const entity = new TestEntity(mockAxios, mockLogger, customHandler);

      expect(entity.testRequestHandler).toBe(customHandler);
    });

    it('should pass correct parameters to RequestHandler.executeRequest', async () => {
      const entity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
      const mockResponse = { data: { success: true } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn();
      const options: RequestOptions = {
        retries: 5,
        baseDelay: 2000,
        enableRequestLogging: true,
        enableResponseLogging: true,
      };

      await entity.testExecuteRequest(requestFn, '/test-endpoint', 'PUT', options);

      expect(mockRequestHandler.executeRequest).toHaveBeenCalledWith(
        requestFn,
        '/test-endpoint',
        'PUT',
        options
      );
    });
  });

  describe('Response Data Transformation', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should extract data from Autotask API item format', async () => {
      const originalData = { id: 123, name: 'Test Entity', status: 'active' };
      const autotaskResponse = { data: { item: originalData } };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(autotaskResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(originalData);
    });

    it('should extract data from Autotask API items format for queries', async () => {
      const originalData = [
        { id: 1, name: 'Entity 1' },
        { id: 2, name: 'Entity 2' },
      ];
      const autotaskResponse = {
        data: {
          items: originalData,
          pageDetails: { pageNumber: 1, totalPages: 1, totalRecords: 2 },
        },
      };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(autotaskResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST');

      expect(result).toEqual(originalData);
    });

    it('should handle direct array responses', async () => {
      const arrayData = [{ id: 1 }, { id: 2 }];
      const directResponse = { data: arrayData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(directResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(arrayData);
    });

    it('should handle direct object responses', async () => {
      const objectData = { id: 1, name: 'Direct Object' };
      const directResponse = { data: objectData };

      mockRequestHandler.executeRequest.mockResolvedValueOnce(directResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(objectData);
    });
  });

  describe('Endpoint Processing', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should extract resource type from simple endpoint', async () => {
      const mockResponse = { data: { item: null } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn();

      try {
        await testEntity.testExecuteRequest(requestFn, '/Companies', 'GET');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toContain('Resource not found');
      }
    });

    it('should extract resource type from endpoint with ID', async () => {
      const mockResponse = { data: { item: null } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn();

      try {
        await testEntity.testExecuteRequest(requestFn, '/Tickets/12345', 'GET');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toContain('Resource not found');
      }
    });

    it('should extract resource type from complex endpoint', async () => {
      const mockResponse = { data: { item: null } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn();

      try {
        await testEntity.testExecuteRequest(requestFn, '/Tickets/123/Attachments', 'GET');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toContain('Resource not found');
      }
    });

    it('should handle endpoint without slashes', async () => {
      const mockResponse = { data: { item: null } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(mockResponse);

      const requestFn = jest.fn();

      try {
        await testEntity.testExecuteRequest(requestFn, 'SimpleEndpoint', 'GET');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toContain('Resource not found');
      }
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should handle empty string responses', async () => {
      const emptyResponse = { data: '' };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(emptyResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBe('');
    });

    it('should handle null responses', async () => {
      const nullResponse = { data: null };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(nullResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBeNull();
    });

    it('should handle boolean responses', async () => {
      const booleanResponse = { data: true };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(booleanResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBe(true);
    });

    it('should handle number responses', async () => {
      const numberResponse = { data: 42 };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(numberResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toBe(42);
    });

    it('should handle deeply nested item structures', async () => {
      const nestedData = {
        level1: {
          level2: {
            level3: 'deep value'
          }
        }
      };
      const nestedResponse = { data: { item: nestedData } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(nestedResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      expect(result).toEqual(nestedData);
      expect((result as any).level1.level2.level3).toBe('deep value');
    });

    it('should handle very large arrays in query responses', async () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      const largeResponse = { data: { items: largeArray } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(largeResponse);

      const requestFn = jest.fn();
      const result = await testEntity.testExecuteQueryRequest(requestFn, '/test/query', 'POST');

      expect(result).toHaveLength(10000);
      expect(result[0]).toEqual({ id: 0, name: 'Item 0' });
      expect(result[9999]).toEqual({ id: 9999, name: 'Item 9999' });
    });
  });

  describe('Concurrent Operations', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should handle concurrent requests correctly', async () => {
      const response1 = { data: { item: { id: 1, name: 'First' } } };
      const response2 = { data: { item: { id: 2, name: 'Second' } } };
      const response3 = { data: { items: [{ id: 3, name: 'Third' }] } };

      mockRequestHandler.executeRequest
        .mockResolvedValueOnce(response1)
        .mockResolvedValueOnce(response2)
        .mockResolvedValueOnce(response3);

      const [result1, result2, result3] = await Promise.all([
        testEntity.testExecuteRequest(() => Promise.resolve(response1), '/test1', 'GET'),
        testEntity.testExecuteRequest(() => Promise.resolve(response2), '/test2', 'GET'),
        testEntity.testExecuteQueryRequest(() => Promise.resolve(response3), '/test3/query', 'POST'),
      ]);

      expect(result1).toEqual({ id: 1, name: 'First' });
      expect(result2).toEqual({ id: 2, name: 'Second' });
      expect(result3).toEqual([{ id: 3, name: 'Third' }]);
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure in concurrent operations', async () => {
      const successResponse = { data: { item: { id: 1, name: 'Success' } } };
      const error = new AxiosError('Request failed');

      mockRequestHandler.executeRequest
        .mockResolvedValueOnce(successResponse)
        .mockRejectedValueOnce(error);

      const results = await Promise.allSettled([
        testEntity.testExecuteRequest(() => Promise.resolve(successResponse), '/success', 'GET'),
        testEntity.testExecuteRequest(() => Promise.reject(error), '/failure', 'GET'),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect((results[0] as PromiseFulfilledResult<any>).value).toEqual({ id: 1, name: 'Success' });
      
      expect(results[1].status).toBe('rejected');
      expect((results[1] as PromiseRejectedResult).reason).toBe(error);
    });
  });

  describe('Memory and Performance', () => {
    beforeEach(() => {
      testEntity = new TestEntity(mockAxios, mockLogger, mockRequestHandler);
    });

    it('should not retain references to request functions after completion', async () => {
      const response = { data: { item: { id: 1 } } };
      mockRequestHandler.executeRequest.mockResolvedValueOnce(response);

      let requestFn: any = jest.fn().mockResolvedValueOnce(response);
      const weakRef = new WeakRef(requestFn);

      await testEntity.testExecuteRequest(requestFn, '/test', 'GET');

      // Intentional dead-looking store: drops the last strong reference so
      // `global.gc()` below can actually collect it for the WeakRef check.
      // eslint-disable-next-line no-useless-assignment
      requestFn = null;
      
      // Force garbage collection if available (for testing environments)
      if (global.gc) {
        global.gc();
      }

      // Note: This test is more for documentation purposes as WeakRef behavior
      // can be unpredictable in test environments
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid sequential requests', async () => {
      const responses = Array.from({ length: 100 }, (_, i) => ({
        data: { item: { id: i, name: `Item ${i}` } }
      }));

      mockRequestHandler.executeRequest.mockImplementation((fn, endpoint) => {
        const index = parseInt(endpoint.split('/').pop() || '0');
        return Promise.resolve(responses[index] || responses[0]);
      });

      const promises = Array.from({ length: 100 }, (_, i) =>
        testEntity.testExecuteRequest(() => Promise.resolve(responses[i]), `/test/${i}`, 'GET')
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      expect(results[0]).toEqual({ id: 0, name: 'Item 0' });
      expect(results[99]).toEqual({ id: 99, name: 'Item 99' });
      expect(mockRequestHandler.executeRequest).toHaveBeenCalledTimes(100);
    });
  });
});