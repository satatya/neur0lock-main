import { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';
import { clientIp } from '../utils/http';

interface RateLimitOptions {
    name: string;
    windowMs: number;
    max: number;
}

const buckets = new Map<string, number[]>();

setInterval(() => {
    const cutoff = Date.now() - 60 * 60_000;
    for (const [key, hits] of buckets) {
        if (hits.length === 0 || hits[hits.length - 1] < cutoff) buckets.delete(key);
    }
}, 10 * 60_000).unref();

/** Small in-memory sliding-window limiter for brute-force-sensitive endpoints. */
export function rateLimit({ name, windowMs, max }: RateLimitOptions) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (config.isTest) return next();
        const key = `${name}:${clientIp(req) ?? 'unknown'}`;
        const now = Date.now();
        const hits = (buckets.get(key) ?? []).filter((time) => time > now - windowMs);
        if (hits.length >= max) {
            const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({
                error: { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
            });
        }
        hits.push(now);
        buckets.set(key, hits);
        next();
    };
}
