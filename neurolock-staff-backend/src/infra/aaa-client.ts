/**
 * Client for the AAA server (Authentication, Authorization, Accounting).
 *
 * Every call goes over HTTPS with mutual TLS: the API presents its own client certificate and
 * only trusts the AAA server certificate signed by the NeuroLock CA. The end user's bearer token,
 * step-up token and network details are forwarded so the AAA server can decide and account.
 */
import fs from 'fs';
import http from 'http';
import https from 'https';
import { Request } from 'express';
import { config } from '../config/env';
import { ApiError, clientIp, userAgent } from '../utils/http';

export interface AaaResponse<T = any> {
    status: number;
    body: { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> } };
}

export interface AaaCallOptions {
    body?: unknown;
    query?: Record<string, unknown>;
    /** Incoming request whose bearer token, step-up token and client details are forwarded. */
    req?: Request | null;
    /** Explicit bearer token (overrides the one on req). */
    token?: string | null;
    /** Explicit step-up (re-authentication) token, for server-side tools without an incoming request. */
    stepUp?: string | null;
}

let agent: https.Agent | http.Agent | null = null;

function getAgent(): https.Agent | http.Agent {
    if (agent) return agent;
    if (config.aaa.url.startsWith('https://')) {
        const read = (file: string, what: string) => {
            try {
                return fs.readFileSync(file);
            } catch {
                throw new Error(`Cannot read ${what} at ${file} (needed for mutual TLS with the AAA server)`);
            }
        };
        agent = new https.Agent({
            keepAlive: true,
            maxSockets: 32,
            ca: read(config.aaa.caFile, 'AAA_CA_FILE'),
            cert: read(config.aaa.certFile, 'AAA_CLIENT_CERT'),
            key: read(config.aaa.keyFile, 'AAA_CLIENT_KEY'),
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
        });
    } else {
        agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    }
    return agent;
}

export const bearerOf = (req: Request | null | undefined): string | null => {
    const header = req?.headers.authorization;
    return header && header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
};

function buildPath(path: string, query?: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null || value === '') continue;
        params.set(key, String(value));
    }
    const qs = params.toString();
    return `/v1${path}${qs ? `?${qs}` : ''}`;
}

/** Low-level call: resolves with the AAA status and JSON body; rejects only if the AAA server is unreachable. */
export function aaaCall<T = any>(method: string, path: string, options: AaaCallOptions = {}): Promise<AaaResponse<T>> {
    const url = new URL(config.aaa.url + buildPath(path, options.query));
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const token = options.token !== undefined ? options.token : bearerOf(options.req);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.stepUp) headers['X-Step-Up-Token'] = options.stepUp;
    if (options.req) {
        const stepUp = options.req.headers['x-step-up-token'];
        if (stepUp) headers['X-Step-Up-Token'] = String(stepUp);
        const ip = clientIp(options.req);
        if (ip) headers['X-Client-IP'] = ip;
        const ua = userAgent(options.req);
        if (ua) headers['X-Client-User-Agent'] = ua;
    }

    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.request(
            url,
            { method, headers, agent: getAgent(), timeout: config.aaa.timeoutMs },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let body: AaaResponse<T>['body'] = {};
                    try {
                        body = text ? JSON.parse(text) : {};
                    } catch {
                        body = { error: { code: 'AAA_BAD_RESPONSE', message: 'Unexpected response from the AAA server' } };
                    }
                    resolve({ status: response.statusCode ?? 502, body });
                });
            },
        );
        request.on('timeout', () => request.destroy(new Error('AAA request timed out')));
        request.on('error', reject);
        if (payload !== undefined) request.write(payload);
        request.end();
    });
}

export const aaaUnavailable = (cause?: unknown) => {
    if (cause) console.error(JSON.stringify({ level: 'error', msg: 'AAA server unreachable', error: (cause as Error)?.message }));
    return new ApiError(503, 'AAA_UNAVAILABLE', 'The authentication service is unavailable. Please try again shortly.');
};

/** Calls the AAA server and returns `data`, turning AAA errors into ApiErrors with the same status/code. */
export async function aaa<T = any>(method: string, path: string, options: AaaCallOptions = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
    let response: AaaResponse<T>;
    try {
        response = await aaaCall<T>(method, path, options);
    } catch (error) {
        throw aaaUnavailable(error);
    }
    if (response.status >= 400) {
        const error = response.body.error ?? { code: 'AAA_ERROR', message: 'The authentication service rejected the request' };
        const status = response.status === 503 ? 503 : response.status;
        throw new ApiError(status, error.code, error.message, error.details);
    }
    return { data: response.body.data as T, meta: response.body.meta };
}

export async function aaaHealth(): Promise<{ ok: boolean; directory?: string; log_server?: string }> {
    try {
        const response = await aaaCall<any>('GET', '/health');
        const body = response.body as any;
        return { ok: response.status === 200, directory: body.directory, log_server: body.log_server };
    } catch {
        return { ok: false };
    }
}
