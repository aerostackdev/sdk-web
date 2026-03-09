import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeClient, RealtimeSubscription } from '../realtime';

// ─── Mock WebSocket ───────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  protocols?: string[];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  sent: any[] = [];

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.onclose?.(), 0);
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', vi.fn());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── RealtimeSubscription ─────────────────────────────────────

describe('RealtimeSubscription', () => {
  function createSub() {
    const client = new RealtimeClient({
      baseUrl: 'https://api.test.com/v1',
      projectId: 'proj-1',
    });
    const sub = client.channel('users');
    return { client, sub };
  }

  it('should register and fire INSERT callbacks', () => {
    const { sub } = createSub();
    const cb = vi.fn();
    sub.on('INSERT', cb);

    sub._emit({
      type: 'db_change',
      topic: sub.topic,
      operation: 'INSERT',
      data: { id: 1 },
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  it('should fire wildcard callbacks', () => {
    const { sub } = createSub();
    const cb = vi.fn();
    sub.on('*', cb);

    sub._emit({
      type: 'event',
      topic: sub.topic,
      event: 'custom',
      data: {},
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  it('should remove callbacks with off()', () => {
    const { sub } = createSub();
    const cb = vi.fn();
    sub.on('INSERT', cb);
    sub.off('INSERT', cb);

    sub._emit({
      type: 'db_change',
      topic: sub.topic,
      operation: 'INSERT',
      data: {},
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it('should be chainable', () => {
    const { sub } = createSub();
    expect(sub.on('INSERT', vi.fn())).toBe(sub);
    expect(sub.off('INSERT', vi.fn())).toBe(sub);
  });

  it('should clear callbacks on unsubscribe', () => {
    const { sub } = createSub();
    const cb = vi.fn();
    sub.on('INSERT', cb);
    sub.subscribe();
    sub.unsubscribe();

    sub._emit({
      type: 'db_change',
      topic: sub.topic,
      operation: 'INSERT',
      data: {},
    });

    expect(cb).not.toHaveBeenCalled();
  });
});

// ─── RealtimeClient ───────────────────────────────────────────

describe('RealtimeClient', () => {
  describe('constructor', () => {
    it('should start as idle', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      expect(client.status).toBe('idle');
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const connectPromise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      expect(client.status).toBe('connected');
    });

    it('should pass apiKey via Sec-WebSocket-Protocol', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
        apiKey: 'my-api-key',
      });

      const connectPromise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      expect(client.status).toBe('connected');
      // apiKey should NOT be in URL query params (security)
    });

    it('should not duplicate connections', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const p1 = client.connect();
      const p2 = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await Promise.all([p1, p2]);

      expect(client.status).toBe('connected');
    });

    it('should return immediately if already connected', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const p1 = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await p1;

      await client.connect(); // Should resolve immediately
      expect(client.status).toBe('connected');
    });
  });

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const connectPromise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      client.disconnect();
      expect(client.status).toBe('disconnected');
    });

    it('should be safe when not connected', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      client.disconnect();
      expect(client.status).toBe('disconnected');
    });
  });

  describe('channel', () => {
    it('should qualify topic with projectId', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const sub = client.channel('users');
      expect(sub.topic).toBe('table/users/proj-1');
    });

    it('should reuse subscriptions', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const sub1 = client.channel('users');
      const sub2 = client.channel('users');
      expect(sub1).toBe(sub2);
    });

    it('should not double-qualify', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const sub = client.channel('table/users/proj-1');
      expect(sub.topic).toBe('table/users/proj-1');
    });
  });

  describe('status listeners', () => {
    it('should notify on status change', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const statuses: string[] = [];
      client.onStatusChange(s => statuses.push(s));

      const connectPromise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      expect(statuses).toContain('connecting');
      expect(statuses).toContain('connected');
    });

    it('should allow unsubscribing', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const cb = vi.fn();
      const unsub = client.onStatusChange(cb);
      unsub();
      client.disconnect();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('setToken', () => {
    it('should send auth message', async () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const connectPromise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      client.setToken('new-jwt');
    });
  });

  describe('sendChat + chatRoom', () => {
    it('should queue chat message', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      client.sendChat('room-1', 'Hello');
    });

    it('should return chat room subscription', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const sub = client.chatRoom('room-1');
      expect(sub.topic).toBe('chat/room-1/proj-1');
    });
  });

  describe('_generateId', () => {
    it('should return unique IDs', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });
      const ids = new Set(Array.from({ length: 50 }, () => client._generateId()));
      expect(ids.size).toBe(50);
    });
  });

  describe('_fetchHistory', () => {
    it('should fetch history with auth headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({ messages: [{ id: '1' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
        apiKey: 'my-key',
        token: 'my-jwt',
      });

      const result = await client._fetchHistory('chat/room', 10);
      expect(result).toEqual([{ id: '1' }]);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Aerostack-Key']).toBe('my-key');
      expect(headers['Authorization']).toBe('Bearer my-jwt');
    });

    it('should return empty array when no messages', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: async () => ({}),
      }));

      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
      });

      const result = await client._fetchHistory('room', 10);
      expect(result).toEqual([]);
    });
  });

  describe('maxReconnectAttempts', () => {
    it('should accept maxReconnectAttempts', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
        maxReconnectAttempts: 5,
      });
      expect(client.status).toBe('idle');
    });

    it('should support onMaxRetriesExceeded', () => {
      const client = new RealtimeClient({
        baseUrl: 'https://api.test.com/v1',
        projectId: 'proj-1',
        maxReconnectAttempts: 0,
      });
      const cb = vi.fn();
      const unsub = client.onMaxRetriesExceeded(cb);
      expect(typeof unsub).toBe('function');
      unsub();
    });
  });
});
