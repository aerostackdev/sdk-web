import { describe, it, expect, vi } from 'vitest';

// Mock the generated APIs and realtime
vi.mock('../_generated/index.js', () => {
  class MockConfiguration {
    basePath: string;
    headers: Record<string, string>;
    apiKey?: string;
    constructor(opts: any = {}) {
      this.basePath = opts.basePath || '';
      this.headers = opts.headers || {};
      this.apiKey = opts.apiKey;
    }
  }
  return {
    Configuration: MockConfiguration,
    AuthenticationApi: vi.fn().mockImplementation(() => ({ auth: true })),
    AIApi: vi.fn().mockImplementation(() => ({ ai: true })),
    StorageApi: vi.fn().mockImplementation(() => ({ storage: true })),
    DatabaseApi: vi.fn().mockImplementation(() => ({
      dbQuery: vi.fn().mockResolvedValue({ results: [] }),
    })),
  };
});

vi.mock('../realtime.js', () => {
  return {
    RealtimeClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      channel: vi.fn(),
    })),
  };
});

import { SDK, Aerostack, createClient } from '../sdk';

describe('Web SDK', () => {
  describe('constructor', () => {
    it('should initialize with default options', () => {
      const sdk = new SDK();
      expect(sdk).toBeDefined();
      expect(sdk.auth).toBeDefined();
      expect(sdk.ai).toBeDefined();
      expect(sdk.storage).toBeDefined();
      expect(sdk.database).toBeDefined();
      expect(sdk.realtime).toBeDefined();
    });

    it('should accept apiKey option', () => {
      const sdk = new SDK({ apiKey: 'my-key' });
      expect(sdk).toBeDefined();
    });

    it('should accept apiKeyAuth alias', () => {
      const sdk = new SDK({ apiKeyAuth: 'my-key' });
      expect(sdk).toBeDefined();
    });

    it('should accept serverUrl option', () => {
      const sdk = new SDK({ serverUrl: 'https://custom.com/v1' });
      expect(sdk).toBeDefined();
    });

    it('should accept serverURL alias', () => {
      const sdk = new SDK({ serverURL: 'https://custom.com/v1' });
      expect(sdk).toBeDefined();
    });

    it('should not expose queue, services, gateway, cache (client-safe)', () => {
      const sdk = new SDK() as any;
      expect(sdk.queue).toBeUndefined();
      expect(sdk.services).toBeUndefined();
      expect(sdk.gateway).toBeUndefined();
      expect(sdk.cache).toBeUndefined();
    });
  });

  describe('DatabaseFacade', () => {
    it('should execute a query', async () => {
      const sdk = new SDK({ apiKey: 'key' });
      const result = await sdk.database.dbQuery({
        dbQueryRequest: { sql: 'SELECT 1', params: [] },
      });
      expect(result).toEqual({ results: [] });
    });
  });

  describe('setApiKey', () => {
    it('should recreate service instances', () => {
      const sdk = new SDK({ apiKey: 'old-key' });
      sdk.setApiKey('new-key');
      expect(sdk.auth).toBeDefined();
      expect(sdk.ai).toBeDefined();
      expect(sdk.storage).toBeDefined();
      expect(sdk.database).toBeDefined();
    });
  });

  describe('streamGateway', () => {
    it('should make POST to gateway endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: createMockStream('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const sdk = new SDK({ serverUrl: 'https://api.test.com/v1' });
      const result = await sdk.streamGateway({
        apiSlug: 'bot',
        messages: [{ role: 'user', content: 'Hello' }],
        consumerKey: 'ask_live_123',
      });

      expect(result.text).toBe('Hi');
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/api/gateway/bot/v1/chat/completions');
    });

    it('should throw on non-OK response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const sdk = new SDK({ serverUrl: 'https://api.test.com/v1' });
      await expect(sdk.streamGateway({
        apiSlug: 'bot',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Unauthorized');
    });

    it('should estimate tokens when usage not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: createMockStream('data: {"choices":[{"delta":{"content":"Hello world"}}]}\n\ndata: [DONE]\n\n'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const sdk = new SDK({ serverUrl: 'https://api.test.com/v1' });
      const result = await sdk.streamGateway({
        apiSlug: 'bot',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe('Aerostack alias', () => {
    it('should be the same as SDK', () => {
      expect(Aerostack).toBe(SDK);
    });
  });

  describe('createClient', () => {
    it('should return an SDK instance', () => {
      const client = createClient({ apiKey: 'key' });
      expect(client).toBeInstanceOf(SDK);
    });
  });
});

function createMockStream(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  let read = false;
  return {
    getReader: () => ({
      read: async () => {
        if (!read) {
          read = true;
          return { done: false, value: data };
        }
        return { done: true, value: undefined };
      },
      cancel: vi.fn(),
    }),
  };
}
