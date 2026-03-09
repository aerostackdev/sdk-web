/**
 * Web SDK E2E Tests
 *
 * Verifies SDK initialization and client-safe surface.
 */
import { describe, it, expect } from 'vitest';
import { SDK, Aerostack, createClient, RealtimeClient } from '@aerostack/sdk-web';

describe('Web SDK E2E', () => {
  describe('SDK initialization', () => {
    it('should create SDK instance with default options', () => {
      const sdk = new SDK();
      expect(sdk).toBeDefined();
      expect(sdk.auth).toBeDefined();
      expect(sdk.ai).toBeDefined();
      expect(sdk.storage).toBeDefined();
      expect(sdk.database).toBeDefined();
      expect(sdk.realtime).toBeDefined();
    });

    it('should create SDK with api key', () => {
      const sdk = new SDK({
        apiKey: 'ac_public_test_key',
        serverUrl: 'https://custom.api.com/v1',
      });
      expect(sdk).toBeDefined();
    });

    it('should not expose server-side APIs', () => {
      const sdk = new SDK() as any;
      expect(sdk.queue).toBeUndefined();
      expect(sdk.services).toBeUndefined();
      expect(sdk.gateway).toBeUndefined();
      expect(sdk.cache).toBeUndefined();
    });

    it('should export Aerostack as deprecated alias', () => {
      expect(Aerostack).toBe(SDK);
    });

    it('should export createClient factory', () => {
      const sdk = createClient({ apiKey: 'key' });
      expect(sdk).toBeInstanceOf(SDK);
    });
  });

  describe('setApiKey', () => {
    it('should update API key', () => {
      const sdk = new SDK({ apiKey: 'old-key' });
      sdk.setApiKey('new-key');
      expect(sdk.auth).toBeDefined();
    });
  });

  describe('RealtimeClient export', () => {
    it('should export RealtimeClient', () => {
      expect(RealtimeClient).toBeDefined();
      expect(typeof RealtimeClient).toBe('function');
    });

    it('should create realtime client', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      expect(client.status).toBe('idle');
    });
  });
});
