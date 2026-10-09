const pad = (value: number) => String(value).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function localDate(date = new Date()): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local time as HH:MM. */
export function localTime(date = new Date()): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Combines a local date (YYYY-MM-DD) and time (HH:MM) into an ISO timestamp, or null if invalid. */
export function localToIso(date: string, time: string): string | null {
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const value = new Date(y, m - 1, d, hh, mm);
    return Number.isNaN(value.getTime()) || value.getMonth() !== m - 1 ? null : value.toISOString();
}

export function isValidDateString(value: string): boolean {
    if (!DATE_RE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = DATE_RE.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${localTime(date)}`;
}

export function formatTime(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : localTime(date);
}

export function relativeTime(value: string | null | undefined): string {
    if (!value) return 'Never';
    const diff = Date.now() - new Date(value).getTime();
    if (Number.isNaN(diff)) return value;
    const future = diff < 0;
    const minutes = Math.round(Math.abs(diff) / 60_000);
    const text =
        minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`;
    if (text === 'just now') return text;
    return future ? `in ${text}` : `${text} ago`;
}

export function titleCase(value: string | null | undefined): string {
    if (!value) return '';
    return value
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(' ');
}

export const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('');

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export function priorityVariant(priority: string | null | undefined): BadgeVariant {
    if (priority === 'high') return 'destructive';
    if (priority === 'medium') return 'warning';
    return 'secondary';
}

export function statusVariant(status: string | null | undefined): BadgeVariant {
    switch (status) {
        case 'active':
        case 'completed':
        case 'approved':
        case 'given':
        case 'success':
            return 'success';
        case 'critical':
        case 'cancelled':
        case 'discontinued':
        case 'rejected':
        case 'locked':
        case 'refused':
        case 'denied':
        case 'failure':
            return 'destructive';
        case 'pending':
        case 'on_hold':
        case 'held':
        case 'no_show':
            return 'warning';
        case 'scheduled':
            return 'default';
        default:
            return 'secondary';
    }
}

export function severityVariant(severity: string): BadgeVariant {
    if (severity === 'critical' || severity === 'high') return 'destructive';
    if (severity === 'medium') return 'warning';
    return 'secondary';
}
