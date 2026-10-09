import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/http';

const MYSQL_ERRORS: Record<string, { status: number; code: string; message: string }> = {
    ER_DUP_ENTRY: { status: 409, code: 'CONFLICT', message: 'A record with these details already exists' },
    ER_NO_REFERENCED_ROW_2: { status: 400, code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' },
    ER_ROW_IS_REFERENCED_2: { status: 409, code: 'IN_USE', message: 'This record is still referenced by other data' },
    ER_DATA_TOO_LONG: { status: 400, code: 'VALIDATION_ERROR', message: 'A value is too long' },
    ER_TRUNCATED_WRONG_VALUE: { status: 400, code: 'VALIDATION_ERROR', message: 'A value has the wrong format' },
    WARN_DATA_TRUNCATED: { status: 400, code: 'VALIDATION_ERROR', message: 'A value is not allowed for this field' },
    ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: { status: 400, code: 'VALIDATION_ERROR', message: 'A value has the wrong format' },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
        return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }

    // Malformed JSON bodies from express.json()
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
    }

    const mapped = err?.code ? MYSQL_ERRORS[err.code] : undefined;
    if (mapped) {
        return res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
    }

    if (err?.code === 'ECONNREFUSED' || err?.code === 'PROTOCOL_CONNECTION_LOST' || err?.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error(JSON.stringify({ level: 'error', msg: 'Database unavailable', error: err.message }));
        return res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable. Please try again shortly.' } });
    }

    console.error(JSON.stringify({ level: 'error', msg: err?.message, path: req.originalUrl, stack: err?.stack }));
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};

export const notFound = (req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
};
