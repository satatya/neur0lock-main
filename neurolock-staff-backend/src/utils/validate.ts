import { badRequest } from './http';

type Body = Record<string, unknown> | undefined | null;

interface StringOptions {
    required?: boolean;
    min?: number;
    max?: number;
    label?: string;
}

const present = (value: unknown) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');

/** Returns a trimmed string, undefined when absent (and optional), or throws a 400. */
export function str(body: Body, key: string, options: StringOptions = {}): string | undefined {
    const { required = false, min = 0, max = 255, label = key } = options;
    const value = body?.[key];
    if (!present(value)) {
        if (required) throw badRequest(`${label} is required`, { field: key });
        return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw badRequest(`${label} must be text`, { field: key });
    }
    const text = String(value).trim();
    if (text.length < min) throw badRequest(`${label} must be at least ${min} characters`, { field: key });
    if (text.length > max) throw badRequest(`${label} must be at most ${max} characters`, { field: key });
    return text;
}

export function requiredStr(body: Body, key: string, options: Omit<StringOptions, 'required'> = {}): string {
    return str(body, key, { ...options, required: true }) as string;
}

/** Like str() but maps an explicit empty value to null so callers can clear a column. */
export function nullableStr(body: Body, key: string, options: Omit<StringOptions, 'required'> = {}): string | null | undefined {
    if (!body || !(key in body)) return undefined;
    const value = body[key];
    if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
    return str(body, key, options) ?? null;
}

export function int(body: Body, key: string, options: { required?: boolean; min?: number; max?: number; label?: string } = {}): number | undefined {
    const { required = false, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, label = key } = options;
    const value = body?.[key];
    if (!present(value)) {
        if (required) throw badRequest(`${label} is required`, { field: key });
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw badRequest(`${label} must be a whole number`, { field: key });
    if (parsed < min || parsed > max) throw badRequest(`${label} must be between ${min} and ${max}`, { field: key });
    return parsed;
}

export function num(body: Body, key: string, options: { min?: number; max?: number; label?: string } = {}): number | null | undefined {
    const { min = -Infinity, max = Infinity, label = key } = options;
    if (!body || !(key in body)) return undefined;
    const value = body[key];
    if (!present(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw badRequest(`${label} must be a number`, { field: key });
    if (parsed < min || parsed > max) throw badRequest(`${label} must be between ${min} and ${max}`, { field: key });
    return parsed;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
    if (!DATE_RE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** YYYY-MM-DD date, null when explicitly cleared, undefined when absent. */
export function dateStr(body: Body, key: string, options: { required?: boolean; label?: string } = {}): string | null | undefined {
    const { required = false, label = key } = options;
    if (!body || !(key in body) || !present(body[key])) {
        if (required) throw badRequest(`${label} is required`, { field: key });
        return body && key in body && body[key] !== undefined ? null : undefined;
    }
    const value = String(body[key]).trim().slice(0, 10);
    if (!isValidDate(value)) throw badRequest(`${label} must be a valid date (YYYY-MM-DD)`, { field: key });
    return value;
}

/** Accepts an ISO timestamp and returns a UTC 'YYYY-MM-DD HH:MM:SS' string for DATETIME columns. */
export function dateTimeStr(body: Body, key: string, options: { required?: boolean; label?: string } = {}): string | undefined {
    const { required = false, label = key } = options;
    const value = body?.[key];
    if (!present(value)) {
        if (required) throw badRequest(`${label} is required`, { field: key });
        return undefined;
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw badRequest(`${label} must be a valid date and time`, { field: key });
    return toSqlDateTime(date);
}

export function toSqlDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], options: { required?: boolean; label?: string } = {}): T | undefined {
    const { required = false, label = key } = options;
    const value = body?.[key];
    if (!present(value)) {
        if (required) throw badRequest(`${label} is required`, { field: key });
        return undefined;
    }
    const text = String(value).trim();
    const match = allowed.find((option) => option.toLowerCase() === text.toLowerCase());
    if (!match) throw badRequest(`${label} must be one of: ${allowed.join(', ')}`, { field: key });
    return match;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(body: Body, key = 'email', options: { required?: boolean } = {}): string | undefined {
    const value = str(body, key, { required: options.required, max: 120, label: 'Email' });
    if (value === undefined) return undefined;
    const normalized = value.toLowerCase();
    if (!EMAIL_RE.test(normalized)) throw badRequest('Email address is not valid', { field: key });
    return normalized;
}

export function bool(body: Body, key: string): boolean | undefined {
    const value = body?.[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    throw badRequest(`${key} must be true or false`, { field: key });
}

export const queryStr = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
