import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const int = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveKek = (): string => {
    const kek = (process.env.KEK_HEX || '').trim();
    if (/^[0-9a-fA-F]{64}$/.test(kek)) return kek;
    if (isTest) return '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    throw new Error('KEK_HEX must be a 64-character hex string (256-bit key). See .env.example');
};

const list = (value: string | undefined): string[] =>
    (value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

const corsOrigins = list(process.env.CORS_ORIGINS || '*');

const trustProxy = process.env.TRUST_PROXY === 'true';
const trustProxyHosts = list(process.env.TRUST_PROXY_HOSTS);
if (trustProxy && trustProxyHosts.length === 0) {
    throw new Error('TRUST_PROXY=true needs TRUST_PROXY_HOSTS: the reverse proxy hostname(s) or IP(s), e.g. web');
}

const aaaUrl = (process.env.AAA_URL || 'https://aaa:443').replace(/\/+$/, '');
if (isProd && !aaaUrl.startsWith('https://')) {
    throw new Error('AAA_URL must use https:// (mutual TLS) in production');
}

export const config = {
    env: nodeEnv,
    isProd,
    isTest,
    port: int(process.env.PORT, 4311),
    host: process.env.HOST || '0.0.0.0',
    /** Honour X-Forwarded-For, but only from these reverse proxies (see infra/trusted-proxy). */
    trustProxy,
    trustProxyHosts,
    corsOrigins,
    db: {
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: int(process.env.MYSQL_PORT, 3307),
        user: process.env.MYSQL_USER || 'app',
        password: process.env.MYSQL_PASSWORD || 'app123',
        database: process.env.MYSQL_DATABASE || 'neurolock',
    },
    kekHex: resolveKek(),
    emergencyAccessMinutes: 60,
    /** Seed encrypted demo therapy notes on startup when the notes table is empty. */
    seedDemo: process.env.SEED_DEMO !== 'false',
    /**
     * AAA server (authentication, authorization, accounting). The API authenticates to it with a
     * client certificate (mutual TLS); identities, roles and permissions live in its directory.
     */
    aaa: {
        url: aaaUrl,
        caFile: process.env.AAA_CA_FILE || '/certs/ca.crt',
        certFile: process.env.AAA_CLIENT_CERT || '/certs/api.crt',
        keyFile: process.env.AAA_CLIENT_KEY || '/certs/api.key',
        timeoutMs: int(process.env.AAA_TIMEOUT_MS, 8000),
    },
};

export type AppConfig = typeof config;
