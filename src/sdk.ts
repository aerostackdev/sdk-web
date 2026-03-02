import * as gen from './_generated/index.js';
import { RealtimeClient } from './realtime.js';

export interface SDKOptions {
    /** 
     * Aerostack API Key. 
     * Use a Public Key for client-side environments.
     */
    apiKey?: string;
    /** Alias for apiKey for backward compatibility */
    apiKeyAuth?: string;
    serverUrl?: string;
    /** Alias for serverUrl for backward compatibility */
    serverURL?: string;
    maxReconnectAttempts?: number;
}

/** 
 * Compatibility wrapper for Database API 
 */
class DatabaseFacade {
    constructor(private api: gen.DatabaseApi) { }

    /**
     * Run a SQL query against your project database
     */
    async dbQuery(params: {
        dbQueryRequest?: gen.DbQueryRequest,
        requestBody?: gen.DbQueryRequest,
        xSDKVersion?: string,
        xRequestID?: string
    }) {
        return this.api.dbQuery({
            dbQueryRequest: params.dbQueryRequest || params.requestBody!,
            xSDKVersion: params.xSDKVersion,
            xRequestID: params.xRequestID
        });
    }
}

/**
 * Aerostack SDK Facade for Web/Browser.
 * Provides a clean, ergonomic API for client-safe Aerostack services.
 */
export class SDK {
    public readonly auth: gen.AuthenticationApi;
    public readonly ai: gen.AIApi;
    public readonly storage: gen.StorageApi;
    public readonly realtime: RealtimeClient;
    public readonly database: DatabaseFacade;

    private config: gen.Configuration;

    constructor(options: SDKOptions = {}) {
        const serverUrl = options.serverUrl || options.serverURL || 'https://api.aerocall.ai/v1';
        const apiKey = options.apiKey || options.apiKeyAuth;

        this.config = new gen.Configuration({
            basePath: serverUrl,
            headers: apiKey ? { 'X-Aerostack-Key': apiKey } : {},
            apiKey: apiKey,
        });

        this.auth = new gen.AuthenticationApi(this.config);
        this.ai = new gen.AIApi(this.config);
        this.storage = new gen.StorageApi(this.config);
        this.database = new DatabaseFacade(new gen.DatabaseApi(this.config));

        this.realtime = new RealtimeClient({
            baseUrl: serverUrl,
            apiKey: apiKey,
            maxReconnectAttempts: options.maxReconnectAttempts
        });
    }

    /**
     * Update the API key for subsequent requests.
     */
    setApiKey(apiKey: string): void {
        this.config = new gen.Configuration({
            ...this.config,
            headers: { ...this.config.headers, 'X-Aerostack-Key': apiKey },
            apiKey,
        });
        (this as any).auth = new gen.AuthenticationApi(this.config);
        (this as any).ai = new gen.AIApi(this.config);
        (this as any).storage = new gen.StorageApi(this.config);
        (this as any).database = new DatabaseFacade(new gen.DatabaseApi(this.config));
    }
}

/** @deprecated Use SDK instead */
export const Aerostack = SDK;

// Export a default instance factory or just the class
export const createClient = (options: SDKOptions) => new SDK(options);
