/**
 * Patient visibility. A staff member sees a patient only if they are on that patient's care team:
 * the attending physician, the assigned therapist/psychologist, or an explicit care-team member
 * (any role, e.g. a ward nurse). Holders of patients:read_all (administrators by default) see
 * everyone. A live break-glass (emergency access) grant also opens that one patient for its
 * 60-minute window.
 *
 * An administrator previewing a clinical role sees the caseload of that role's demo account.
 */
import { Request } from 'express';
import { P } from '../config/permissions';
import { execute, query, queryOne } from '../infra/db/mysql-client';
import { can } from '../middlewares/auth.middleware';
import { ApiError, notFound } from '../utils/http';
import { audit } from './audit.service';

export interface ScopeSql {
    sql: string;
    params: unknown[];
}

/** Builds the caller's patient restriction for a given patient-id column (null = everyone). */
export type PatientFilter = (column: string) => ScopeSql | null;

export const scopeFor = (req: Request): PatientFilter => (column) => patientScope(req, column);

export const seesAllPatients = (req: Request) => can(req, P.PATIENTS_READ_ALL);

/** The staff id whose care teams decide visibility (the previewed demo account, or the user). */
export const careTeamOwner = (req: Request) => req.user!.careScopeId ?? req.user!.id;

/**
 * SQL condition limiting `column` (a patient id) to the caller's patients; null = everyone.
 * `emergency: false` leaves out break-glass grants (care-team membership only).
 */
export function patientScope(req: Request, column: string, options: { emergency?: boolean } = {}): ScopeSql | null {
    if (seesAllPatients(req)) return null;
    const owner = careTeamOwner(req);
    const emergency = options.emergency !== false;
    return {
        sql: `${column} IN (
            SELECT id FROM patients WHERE attending_physician_id = ? OR assigned_therapist_id = ?
            UNION SELECT patient_id FROM patient_care_team WHERE staff_id = ?${
                emergency ? '\n            UNION SELECT patient_id FROM emergency_access WHERE staff_id = ? AND expires_at > UTC_TIMESTAMP()' : ''
            })`,
        params: emergency ? [owner, owner, owner, req.user!.id] : [owner, owner, owner],
    };
}

/** On the care team (or sees everyone) — break-glass grants do not count. */
export async function isOnCareTeam(req: Request, patientId: number): Promise<boolean> {
    const scope = patientScope(req, 'p.id', { emergency: false });
    const sql = `SELECT p.id FROM patients p WHERE p.id = ?${scope ? ` AND ${scope.sql}` : ''}`;
    return Boolean(await queryOne(sql, [patientId, ...(scope?.params ?? [])]));
}

export async function canAccessPatient(req: Request, patientId: number): Promise<boolean> {
    const scope = patientScope(req, 'p.id');
    const sql = `SELECT p.id FROM patients p WHERE p.id = ?${scope ? ` AND ${scope.sql}` : ''}`;
    return Boolean(await queryOne(sql, [patientId, ...(scope?.params ?? [])]));
}

/** 404 if the patient does not exist, 403 (audited) if it is not on the caller's care team. */
export async function assertPatientAccess(req: Request, patientId: number | null | undefined): Promise<void> {
    if (patientId === null || patientId === undefined) return;
    if (await canAccessPatient(req, patientId)) return;
    if (!(await queryOne('SELECT id FROM patients WHERE id = ?', [patientId]))) throw notFound('Patient');
    await audit(req, {
        action: 'access_denied',
        resource: 'patient',
        resourceId: patientId,
        patientId,
        outcome: 'denied',
        severity: 'low',
        details: { reason: 'not_on_care_team', method: req.method, path: req.originalUrl.split('?')[0] },
    });
    throw new ApiError(403, 'NOT_ON_CARE_TEAM', 'This patient is not on your care team. Ask their clinician or an administrator to add you.');
}

/** Combines a "WHERE a AND b" clause with the caller's scope on `column`. */
export function withScope(where: { sql: string; params: unknown[] }, scope: ScopeSql | null | undefined): { sql: string; params: unknown[] } {
    if (!scope) return where;
    const body = where.sql.replace(/^WHERE\s+/i, '');
    return { sql: `WHERE ${body ? `${body} AND ` : ''}${scope.sql}`, params: [...where.params, ...scope.params] };
}

// ---------------------------------------------------------------------------
// Care-team membership
// ---------------------------------------------------------------------------

export type CareTeamReason = 'assigned' | 'created' | 'appointment' | 'booking';

export interface CareTeamMember {
    patient_id: number;
    id: number;
    uid: string;
    name: string;
    role: string | null;
    role_name: string | null;
    reason: CareTeamReason;
}

export async function addToCareTeam(patientId: number, staffId: number, reason: CareTeamReason, addedBy: number | null): Promise<void> {
    await execute('INSERT IGNORE INTO patient_care_team (patient_id, staff_id, reason, added_by) VALUES (?, ?, ?, ?)', [patientId, staffId, reason, addedBy]);
}

/** Replaces the explicit care-team members of a patient (leads are stored on the patient row). */
export async function setCareTeam(patientId: number, staffIds: number[], addedBy: number): Promise<void> {
    const unique = [...new Set(staffIds)];
    if (unique.length === 0) {
        await execute('DELETE FROM patient_care_team WHERE patient_id = ?', [patientId]);
        return;
    }
    await execute(`DELETE FROM patient_care_team WHERE patient_id = ? AND staff_id NOT IN (${unique.map(() => '?').join(',')})`, [patientId, ...unique]);
    for (const staffId of unique) await addToCareTeam(patientId, staffId, 'assigned', addedBy);
}

export async function listCareTeams(patientIds: number[]): Promise<Map<number, CareTeamMember[]>> {
    const result = new Map<number, CareTeamMember[]>();
    if (patientIds.length === 0) return result;
    const rows = await query<CareTeamMember>(
        `SELECT ct.patient_id, s.id, s.uid, s.name, s.role, s.role_name, ct.reason
         FROM patient_care_team ct JOIN staff s ON s.id = ct.staff_id
         WHERE ct.patient_id IN (${patientIds.map(() => '?').join(',')})
         ORDER BY s.name`,
        patientIds,
    );
    for (const row of rows) {
        const list = result.get(Number(row.patient_id)) ?? [];
        list.push({ ...row, id: Number(row.id), patient_id: Number(row.patient_id) });
        result.set(Number(row.patient_id), list);
    }
    return result;
}
