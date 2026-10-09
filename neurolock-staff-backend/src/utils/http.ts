import { NextFunction, Request, RequestHandler, Response } from 'express';

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
    }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
    new ApiError(400, 'VALIDATION_ERROR', message, details);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to perform this action', details?: Record<string, unknown>) =>
    new ApiError(403, 'FORBIDDEN', message, details);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

/** Wraps an async route so rejected promises reach the error middleware. */
export const asyncHandler =
    <Req extends Request = Request>(handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => {
        Promise.resolve(handler(req as Req, res, next)).catch(next);
    };

export function parseId(value: unknown, name = 'id'): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw badRequest(`Invalid ${name}`, { field: name });
    }
    return id;
}

export const clientIp = (req: Request): string | null => {
    const ip = req.ip || req.socket?.remoteAddress || null;
    return ip ? ip.replace(/^::ffff:/, '') : null;
};

export const userAgent = (req: Request): string | null => {
    const ua = req.headers['user-agent'];
    return ua ? String(ua).slice(0, 255) : null;
};
