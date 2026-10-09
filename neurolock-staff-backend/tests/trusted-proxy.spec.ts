import request from 'supertest';
import { clientIp } from '../src/utils/http';

jest.mock('../src/infra/aaa-client', () => {
    const actual = jest.requireActual('../src/infra/aaa-client');
    return { ...actual, aaaCall: jest.fn() };
});

import { config } from '../src/config/env';
import { aaaCall } from '../src/infra/aaa-client';
import { trustedProxies } from '../src/infra/trusted-proxy';
import { createServer } from '../src/server';

const LOGIN_MAX = 30; // loginLimiter in routes/auth.routes.ts

beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => undefined)); // [trust-proxy] notices
afterAll(() => jest.restoreAllMocks());

describe('trustedProxies', () => {
    it('trusts only the resolved proxy, and only as the direct peer', async () => {
        const proxies = trustedProxies(['web'], { lookup: async () => ['172.19.0.3'] });
        await proxies.refresh();
        expect(proxies.trust('172.19.0.3', 0)).toBe(true);
        expect(proxies.trust('::ffff:172.19.0.3', 0)).toBe(true);
        expect(proxies.trust('172.19.0.3', 1)).toBe(false);
        expect(proxies.trust('172.19.0.1', 0)).toBe(false);
        expect(proxies.trust('203.0.113.7', 0)).toBe(false);
    });

    it('accepts literal IPs without DNS', () => {
        const lookup = jest.fn();
        const proxies = trustedProxies(['127.0.0.1'], { lookup });
        expect(proxies.trust('::ffff:127.0.0.1', 0)).toBe(true);
        expect(proxies.trust('10.0.0.1', 0)).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('fails closed while unresolved and follows the proxy to a new address', async () => {
        let answer: string[] | null = null;
        const proxies = trustedProxies(['web'], {
            lookup: async () => {
                if (!answer) throw Object.assign(new Error('getaddrinfo ENOTFOUND web'), { code: 'ENOTFOUND' });
                return answer;
            },
        });
        await proxies.refresh();
        expect(proxies.trust('172.19.0.3', 0)).toBe(false);

        answer = ['172.19.0.3'];
        await proxies.refresh();
        expect(proxies.trust('172.19.0.3', 0)).toBe(true);

        answer = ['172.19.0.5'];
        await proxies.refresh();
        expect(proxies.trust('172.19.0.3', 0)).toBe(false);
        expect(proxies.trust('172.19.0.5', 0)).toBe(true);

        answer = null;
        await proxies.refresh();
        expect(proxies.trust('172.19.0.5', 0)).toBe(false);
    });

    it('keeps re-resolving in the background until stopped', async () => {
        jest.useFakeTimers();
        try {
            const lookup = jest.fn().mockRejectedValueOnce(new Error('ENOTFOUND')).mockResolvedValue(['172.19.0.3']);
            const proxies = trustedProxies(['web'], { lookup, retryMs: 1_000, refreshMs: 30_000 });
            await proxies.start();
            expect(proxies.trust('172.19.0.3', 0)).toBe(false);

            await jest.advanceTimersByTimeAsync(1_000);
            expect(proxies.trust('172.19.0.3', 0)).toBe(true);
            expect(lookup).toHaveBeenCalledTimes(2);

            await jest.advanceTimersByTimeAsync(30_000);
            expect(lookup).toHaveBeenCalledTimes(3);

            proxies.stop();
            await jest.advanceTimersByTimeAsync(120_000);
            expect(lookup).toHaveBeenCalledTimes(3);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('client address behind the reverse proxy', () => {
    /** Address the API would forward to the AAA server as X-Client-IP, per login attempt. */
    const forwarded: Array<string | null> = [];

    beforeAll(() => {
        // The limiters are switched off under NODE_ENV=test; this suite is about them.
        jest.replaceProperty(config, 'isTest', false);
        jest.mocked(aaaCall).mockImplementation(async (_method, _path, options) => {
            forwarded.push(options?.req ? clientIp(options.req) : null);
            return { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } } };
        });
    });

    beforeEach(() => {
        forwarded.length = 0;
    });

    const login = (app: ReturnType<typeof createServer>, forwardedFor: string, path = '/api/auth/login') =>
        request(app).post(path).set('X-Forwarded-For', forwardedFor).send({ identifier: 'nobody', password: 'wrong' });

    it('rate-limits a direct caller by its socket address, ignoring a spoofed X-Forwarded-For', async () => {
        // nginx ("web") is elsewhere; supertest connects straight to the API like a client on port 4311
        const proxies = trustedProxies(['web'], { lookup: async () => ['172.19.0.3'] });
        await proxies.refresh();
        const app = createServer({ trustProxy: proxies.trust });

        for (let i = 1; i <= LOGIN_MAX; i++) {
            const res = await login(app, `203.0.113.${i}`);
            expect(res.status).toBe(401);
        }
        const blocked = await login(app, '203.0.113.250');
        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe('RATE_LIMITED');

        expect(forwarded).toHaveLength(LOGIN_MAX);
        expect(new Set(forwarded)).toEqual(new Set(['127.0.0.1']));
    });

    it('uses X-Forwarded-For when the request comes from the trusted proxy', async () => {
        // here supertest's 127.0.0.1 plays nginx
        const app = createServer({ trustProxy: trustedProxies(['127.0.0.1']).trust });

        for (let i = 1; i <= LOGIN_MAX; i++) {
            expect((await login(app, '198.51.100.1')).status).toBe(401);
        }
        expect((await login(app, '198.51.100.1')).status).toBe(429);
        expect((await login(app, '198.51.100.2')).status).toBe(401);

        expect(forwarded.slice(0, LOGIN_MAX).every((ip) => ip === '198.51.100.1')).toBe(true);
        expect(forwarded[LOGIN_MAX]).toBe('198.51.100.2');
    });

    it('trusts no X-Forwarded-For by default', async () => {
        // separate limiter: this suite already used up the login bucket of 127.0.0.1
        const app = createServer();
        expect((await login(app, '192.0.2.10', '/api/auth/password-reset/request')).status).toBe(401);
        expect(forwarded).toEqual(['127.0.0.1']);
    });
});
