/**
 * Audit trail (accounting). Events are stored by the AAA server and forwarded to the rsyslog log
 * server; this API relays queries (audit:read is enforced by the AAA server) and adds patient names
 * from the clinical database, which the AAA server never holds.
 */
import { Router } from 'express';
import { query } from '../infra/db/mysql-client';
import { proxy } from './aaa-proxy';

const router = Router();

export async function withPatientNames<T extends { patient_id?: number | null; patient_name?: string | null }>(rows: T[]): Promise<T[]> {
    const ids = [...new Set((rows ?? []).map((row) => Number(row.patient_id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return rows;
    const patients = await query<{ id: number; full_name: string }>(`SELECT id, full_name FROM patients WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    const names = new Map(patients.map((p) => [Number(p.id), p.full_name]));
    return rows.map((row) => ({ ...row, patient_name: row.patient_name ?? names.get(Number(row.patient_id)) ?? null }));
}

router.get('/', proxy('GET', '/audit', { after: withPatientNames }));
router.get('/stats', proxy('GET', '/audit/stats'));

export const auditRoutes = router;
