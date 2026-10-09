import { Request } from 'express';
import { aaaCall } from '../infra/aaa-client';
import { clientIp, userAgent } from '../utils/http';

export type AuditOutcome = 'success' | 'denied' | 'failure';
export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface AuditEntry {
    action: string;
    resource: string;
    resourceId?: number | string | null;
    patientId?: number | null;
    outcome?: AuditOutcome;
    severity?: AuditSeverity;
    /** Never put clinical content (note text, diagnoses) in details. */
    details?: Record<string, unknown>;
    /** Overrides for events without an authenticated user. */
    actor?: string | null;
    actorUid?: string | null;
    actorRole?: string | null;
}

interface QueuedEvent {
    event: Record<string, unknown>;
    attempts: number;
}

const MAX_QUEUE = 1000;
const retryQueue: QueuedEvent[] = [];

function toEvent(req: Request | null, entry: AuditEntry): Record<string, unknown> {
    return {
        action: entry.action,
        resource: entry.resource,
        resource_id: entry.resourceId ?? null,
        patient_id: entry.patientId ?? null,
        outcome: entry.outcome ?? 'success',
        severity: entry.severity ?? 'info',
        details: entry.details ?? null,
        actor: entry.actor !== undefined ? entry.actor : req?.user?.email ?? null,
        actor_uid: entry.actorUid !== undefined ? entry.actorUid : req?.user?.uid ?? null,
        actor_name: req?.user?.name ?? null,
        actor_role: entry.actorRole !== undefined ? entry.actorRole : req?.user?.role ?? null,
        ip: req ? clientIp(req) : null,
        user_agent: req ? userAgent(req) : null,
    };
}

async function deliver(events: Record<string, unknown>[], req: Request | null): Promise<boolean> {
    try {
        // Actor fields are sent explicitly; the bearer token is not needed (the API is trusted via mTLS).
        const response = await aaaCall('POST', '/accounting', { req, token: null, body: { events } });
        return response.status < 400;
    } catch {
        return false;
    }
}

/**
 * Accounting: sends who did what, to which record, from where and whether it was allowed to the
 * AAA server, which stores it and forwards it to the log server (rsyslog). Failures never break
 * the request being audited; undelivered events are retried in the background.
 */
export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
    const event = toEvent(req, entry);
    if (await deliver([event], req)) return;
    console.error(JSON.stringify({ level: 'warn', msg: 'Accounting event queued for retry (AAA unreachable)', action: entry.action }));
    if (retryQueue.length >= MAX_QUEUE) retryQueue.shift();
    retryQueue.push({ event, attempts: 1 });
}

const flushTimer = setInterval(async () => {
    if (retryQueue.length === 0) return;
    const batch = retryQueue.splice(0, 50);
    if (!(await deliver(batch.map((item) => item.event), null))) {
        retryQueue.unshift(...batch.filter((item) => ++item.attempts <= 120));
    }
}, 5_000);
flushTimer.unref();

export const pendingAccountingEvents = () => retryQueue.length;
