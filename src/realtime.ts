/**
 * Aerostack Realtime Client for Web/Browser SDK
 */
export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeMessage {
    type: string;
    topic: string;
    [key: string]: any;
}

export interface RealtimeSubscriptionOptions {
    event?: RealtimeEvent;
    filter?: Record<string, any>;
}

export type RealtimeCallback<T = any> = (payload: RealtimePayload<T>) => void;

export interface RealtimePayload<T = any> {
    type: 'db_change' | 'chat_message';
    topic: string;
    operation: RealtimeEvent;
    data: T;
    old?: T;
    timestamp?: string;
    [key: string]: any;
}

export class RealtimeSubscription<T = any> {
    private client: RealtimeClient;
    private topic: string;
    private options: RealtimeSubscriptionOptions;
    private callbacks: Map<RealtimeEvent, Set<RealtimeCallback<T>>> = new Map();
    private _isSubscribed: boolean = false;

    constructor(client: RealtimeClient, topic: string, options: RealtimeSubscriptionOptions = {}) {
        this.client = client;
        this.topic = topic;
        this.options = options;
    }

    on(event: RealtimeEvent, callback: RealtimeCallback<T>): this {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, new Set());
        }
        this.callbacks.get(event)!.add(callback);
        return this;
    }

    subscribe(): this {
        if (this._isSubscribed) return this;
        this.client._send({
            type: 'subscribe',
            topic: this.topic,
            filter: this.options.filter
        });
        this._isSubscribed = true;
        return this;
    }

    unsubscribe(): void {
        if (!this._isSubscribed) return;
        this.client._send({
            type: 'unsubscribe',
            topic: this.topic
        });
        this._isSubscribed = false;
        this.callbacks.clear();
    }

    get isSubscribed() { return this._isSubscribed; }

    /** @internal */
    _emit(payload: RealtimePayload<T>): void {
        const event = payload.operation as RealtimeEvent;
        this.callbacks.get(event)?.forEach(cb => {
            try { cb(payload); } catch (e) { console.error('Realtime callback error:', e); }
        });
        this.callbacks.get('*')?.forEach(cb => {
            try { cb(payload); } catch (e) { console.error('Realtime callback error:', e); }
        });
    }
}

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RealtimeClientOptions {
    baseUrl: string;
    apiKey?: string;
    token?: string;
    projectId?: string;
    maxReconnectAttempts?: number;
}

export class RealtimeClient {
    private baseUrl: string;
    private apiKey?: string;
    private token?: string;
    private projectId?: string;
    private ws: WebSocket | null = null;
    private subscriptions: Map<string, RealtimeSubscription> = new Map();
    private reconnectTimer: any = null;
    private heartbeatTimer: any = null;
    private reconnectAttempts: number = 0;
    private _sendQueue: any[] = [];
    private _connectingPromise: Promise<void> | null = null;
    private _status: RealtimeStatus = 'idle';
    private _statusListeners: Set<(s: RealtimeStatus) => void> = new Set();
    private _lastPong: number = 0;
    private _maxReconnectAttempts: number;
    private _maxRetriesListeners: Set<() => void> = new Set();

    constructor(options: RealtimeClientOptions) {
        const wsBase = options.baseUrl.replace(/\/v1\/?$/, '').replace(/^http/, 'ws');
        this.baseUrl = `${wsBase}/api/realtime`;
        this.token = options.token;
        this.apiKey = options.apiKey;
        this.projectId = options.projectId; // Initialize projectId
        this._maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    }

    get status(): RealtimeStatus { return this._status; }
    get connected(): boolean { return this._status === 'connected'; }

    onStatusChange(cb: (status: RealtimeStatus) => void): () => void {
        this._statusListeners.add(cb);
        return () => this._statusListeners.delete(cb);
    }

    onMaxRetriesExceeded(cb: () => void): () => void {
        this._maxRetriesListeners.add(cb);
        return () => this._maxRetriesListeners.delete(cb);
    }

    private _setStatus(s: RealtimeStatus) {
        this._status = s;
        this._statusListeners.forEach(cb => cb(s));
    }

    setToken(newToken: string): void {
        this.token = newToken;
        this._send({ type: 'auth', token: newToken });
    }

    async connect(): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
        if (this._connectingPromise) return this._connectingPromise;
        this._connectingPromise = this._doConnect().finally(() => {
            this._connectingPromise = null;
        });
        return this._connectingPromise;
    }

    private _doConnect(): Promise<void> {
        this._setStatus('connecting');
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            // Original: if (this.token) url.searchParams.set('token', this.token);
            // The instruction implies apiKey and token should also be set as query params if not in protocol.
            // However, the original code explicitly states "NOT as a URL query param" for apiKey.
            // I will follow the instruction to add projectId to URL params, and keep token as URL param,
            // but keep apiKey only in protocol as per original comment.
            if (this.token) url.searchParams.set('token', this.token);
            if (this.projectId) url.searchParams.set('projectId', this.projectId);

            // SECURITY: Pass API key via Sec-WebSocket-Protocol header, NOT as a URL query param.
            const protocols: string[] = [];
            if (this.apiKey) {
                protocols.push(`aerostack-key.${this.apiKey}`);
            }

            this.ws = protocols.length > 0
                ? new WebSocket(url.toString(), protocols)
                : new WebSocket(url.toString());

            this.ws.onopen = () => {
                this._setStatus('connected');
                this.reconnectAttempts = 0;
                this._lastPong = Date.now();
                this.startHeartbeat();
                this._setupOfflineDetection();
                while (this._sendQueue.length > 0) {
                    this.ws!.send(JSON.stringify(this._sendQueue.shift()));
                }
                for (const sub of this.subscriptions.values()) {
                    if (sub.isSubscribed) sub.subscribe();
                }
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Realtime message parse error:', e);
                }
            };

            this.ws.onclose = () => {
                this._setStatus('reconnecting');
                this.stopHeartbeat();
                this.ws = null;
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('Realtime connection error:', err);
                this._setStatus('disconnected');
                reject(err);
            };
        });
    }

    disconnect() {
        this._setStatus('disconnected');
        this.stopReconnect();
        this.stopHeartbeat();
        this._teardownOfflineDetection();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._sendQueue = [];
    }

    channel<T = any>(topic: string, options: RealtimeSubscriptionOptions = {}): RealtimeSubscription<T> {
        let sub = this.subscriptions.get(topic);
        if (!sub) {
            sub = new RealtimeSubscription<T>(this, topic, options);
            this.subscriptions.set(topic, sub);
        }
        return sub as RealtimeSubscription<T>;
    }

    sendChat(roomId: string, text: string): void {
        this._send({ type: 'chat', roomId, text });
    }

    /** @internal */
    _send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this._sendQueue.push(data);
        }
    }

    private handleMessage(data: RealtimeMessage) {
        if (data.type === 'pong') {
            this._lastPong = Date.now();
            return;
        }
        const sub = this.subscriptions.get(data.topic);
        if (sub) sub._emit(data as any);
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this._send({ type: 'ping' });
            if (this._lastPong > 0 && Date.now() - this._lastPong > 70000) {
                console.warn('Realtime: no pong received, forcing reconnect');
                this.ws?.close();
            }
        }, 30000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private scheduleReconnect() {
        this.stopReconnect();
        if (this.reconnectAttempts >= this._maxReconnectAttempts) {
            this._setStatus('disconnected');
            this._maxRetriesListeners.forEach(cb => cb());
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        const jitter = delay * 0.3 * Math.random();
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => { });
        }, delay + jitter);
    }

    private stopReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private _handleOnline = () => {
        if (this._status !== 'connected') {
            this.reconnectAttempts = 0;
            this.connect().catch(() => { });
        }
    };

    private _handleOffline = () => {
        this.stopReconnect();
        this._setStatus('disconnected');
    };

    private _setupOfflineDetection() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', this._handleOnline);
            window.addEventListener('offline', this._handleOffline);
        }
    }

    private _teardownOfflineDetection() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this._handleOnline);
            window.removeEventListener('offline', this._handleOffline);
        }
    }
}
