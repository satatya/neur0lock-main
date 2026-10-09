import { DbExecutor, execute, query, queryOne } from '../infra/db/mysql-client';
import type { PatientFilter } from '../services/care-scope';

/**
 * Data access for the smaller clinical record types: medications, appointments,
 * therapy sessions/progress, vitals, patient alerts and assessments.
 */

type Filters = Record<string, unknown>;

/**
 * WHERE clause from [condition, value] pairs (pairs with an empty value are skipped), optionally
 * restricted to the caller's patients via `scope` on the given patient-id column.
 */
function whereClause(conditions: [string, unknown][], scope?: PatientFilter, column?: string): { sql: string; params: unknown[] } {
    const active = conditions.filter(([, value]) => value !== undefined && value !== null && value !== '');
    const clauses = active.map(([clause]) => clause);
    const params = active.map(([, value]) => value);
    const restriction = scope && column ? scope(column) : null;
    if (restriction) {
        clauses.push(restriction.sql);
        params.push(...restriction.params);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function buildUpdate(table: string, id: number, updates: Filters, allowed: readonly string[], executor?: DbExecutor) {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length === 0) return Promise.resolve(false);
    values.push(id);
    return execute(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`, values, executor).then((r) => r.affectedRows > 0);
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

const SELECT_MEDICATION = `
    SELECT m.*, p.full_name AS patient_name, p.mrn AS patient_mrn, p.ward, p.room, s.name AS prescribed_by_name
    FROM medications m
    JOIN patients p ON p.id = m.patient_id
    LEFT JOIN staff s ON s.id = m.prescribed_by`;

export const listMedications = (filters: { patientId?: number; status?: string } = {}, scope?: PatientFilter) => {
    const { sql, params } = whereClause(
        [
            ['m.patient_id = ?', filters.patientId],
            ['m.status = ?', filters.status],
        ],
        scope,
        'm.patient_id',
    );
    return query(`${SELECT_MEDICATION} ${sql} ORDER BY m.status = 'active' DESC, m.created_at DESC`, params);
};

export const findMedication = (id: number) => queryOne(`${SELECT_MEDICATION} WHERE m.id = ?`, [id]);

export async function createMedication(input: Filters, prescribedBy: number): Promise<number> {
    const result = await execute(
        `INSERT INTO medications (patient_id, name, dose, frequency, route, scheduled_times, instructions, start_date, end_date, status, prescribed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_DATE()), ?, 'active', ?)`,
        [
            input.patient_id,
            input.name,
            input.dose ?? null,
            input.frequency ?? null,
            input.route ?? null,
            input.scheduled_times ?? null,
            input.instructions ?? null,
            input.start_date ?? null,
            input.end_date ?? null,
            prescribedBy,
        ],
    );
    return result.insertId;
}

export const updateMedication = (id: number, updates: Filters) =>
    buildUpdate('medications', id, updates, ['name', 'dose', 'frequency', 'route', 'scheduled_times', 'instructions', 'end_date', 'status']);

export const listAdministrationsForDate = (date: string) =>
    query(
        `SELECT ma.*, s.name AS administered_by_name FROM medication_administrations ma
         LEFT JOIN staff s ON s.id = ma.administered_by
         WHERE ma.schedule_date = ?`,
        [date],
    );

export const listAdministrations = (medicationId: number) =>
    query(
        `SELECT ma.*, s.name AS administered_by_name FROM medication_administrations ma
         LEFT JOIN staff s ON s.id = ma.administered_by
         WHERE ma.medication_id = ? ORDER BY ma.administered_at DESC LIMIT 100`,
        [medicationId],
    );

export async function recordAdministration(input: {
    medicationId: number;
    patientId: number;
    scheduleDate: string;
    scheduledTime: string | null;
    status: string;
    notes: string | null;
    administeredBy: number;
}): Promise<number> {
    const result = await execute(
        `INSERT INTO medication_administrations (medication_id, patient_id, schedule_date, scheduled_time, administered_by, administered_at, status, notes)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?)`,
        [input.medicationId, input.patientId, input.scheduleDate, input.scheduledTime, input.administeredBy, input.status, input.notes],
    );
    return result.insertId;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

const SELECT_APPOINTMENT = `
    SELECT a.*, p.full_name AS patient_name, p.mrn AS patient_mrn, s.name AS staff_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN staff s ON s.id = a.staff_id`;

export const listAppointments = (
    filters: { patientId?: number; staffId?: number; status?: string; from?: string; to?: string } = {},
    scope?: PatientFilter,
) => {
    const { sql, params } = whereClause(
        [
            ['a.patient_id = ?', filters.patientId],
            ['a.staff_id = ?', filters.staffId],
            ['a.status = ?', filters.status],
            ['a.scheduled_at >= ?', filters.from],
            ['a.scheduled_at < ?', filters.to],
        ],
        scope,
        'a.patient_id',
    );
    return query(`${SELECT_APPOINTMENT} ${sql} ORDER BY a.scheduled_at`, params);
};

export const findAppointment = (id: number) => queryOne(`${SELECT_APPOINTMENT} WHERE a.id = ?`, [id]);

export async function createAppointment(input: Filters, createdBy: number): Promise<number> {
    const result = await execute(
        `INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
        [input.patient_id, input.staff_id, input.scheduled_at, input.duration_min ?? 50, input.appointment_type ?? 'Consultation', input.reason ?? null, createdBy],
    );
    return result.insertId;
}

export const updateAppointment = (id: number, updates: Filters) =>
    buildUpdate('appointments', id, updates, ['scheduled_at', 'duration_min', 'appointment_type', 'reason', 'status', 'staff_id']);

// ---------------------------------------------------------------------------
// Therapy sessions and progress
// ---------------------------------------------------------------------------

export const listSessions = (filters: { patientId?: number; clinicianId?: number } = {}, scope?: PatientFilter) => {
    const { sql, params } = whereClause(
        [
            ['ts.patient_id = ?', filters.patientId],
            ['ts.clinician_id = ?', filters.clinicianId],
        ],
        scope,
        'ts.patient_id',
    );
    return query(
        `SELECT ts.*, p.full_name AS patient_name, p.mrn AS patient_mrn, s.name AS clinician_name
         FROM therapy_sessions ts JOIN patients p ON p.id = ts.patient_id LEFT JOIN staff s ON s.id = ts.clinician_id
         ${sql} ORDER BY ts.session_date DESC, ts.id DESC LIMIT 200`,
        params,
    );
};

export async function createSession(input: Filters, clinicianId: number): Promise<number> {
    const result = await execute(
        `INSERT INTO therapy_sessions (patient_id, clinician_id, session_date, duration_min, session_type, summary, progress_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.patient_id, clinicianId, input.session_date, input.duration_min ?? 50, input.session_type ?? 'Individual', input.summary ?? null, input.progress_score ?? null],
    );
    return result.insertId;
}

export async function recordProgress(patientId: number, score: number, note: string | null, recordedBy: number): Promise<number> {
    const result = await execute(
        'INSERT INTO patient_progress (patient_id, score, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
        [patientId, score, note, recordedBy],
    );
    return result.insertId;
}

/** One row per patient that has therapy activity: session count, last/next session and latest progress. */
export const progressOverview = (clinicianId?: number, scope?: PatientFilter) => {
    const restriction = scope?.('p.id');
    return query(
        `SELECT p.id AS patient_id, p.full_name AS patient_name, p.mrn AS patient_mrn,
                (SELECT COUNT(*) FROM therapy_sessions ts WHERE ts.patient_id = p.id) AS session_count,
                (SELECT MAX(ts.session_date) FROM therapy_sessions ts WHERE ts.patient_id = p.id) AS last_session_date,
                (SELECT MIN(a.scheduled_at) FROM appointments a
                   WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.scheduled_at >= UTC_TIMESTAMP()) AS next_session_at,
                (SELECT pp.score FROM patient_progress pp WHERE pp.patient_id = p.id ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 1) AS progress
         FROM patients p
         WHERE (EXISTS (SELECT 1 FROM therapy_sessions ts WHERE ts.patient_id = p.id AND (? IS NULL OR ts.clinician_id = ?))
            OR (? IS NOT NULL AND p.assigned_therapist_id = ?))
            ${restriction ? `AND ${restriction.sql}` : ''}
         ORDER BY p.full_name`,
        [clinicianId ?? null, clinicianId ?? null, clinicianId ?? null, clinicianId ?? null, ...(restriction?.params ?? [])],
    );
};

export const progressHistory = (patientId: number) =>
    query(
        `SELECT pp.*, s.name AS recorded_by_name FROM patient_progress pp LEFT JOIN staff s ON s.id = pp.recorded_by
         WHERE pp.patient_id = ? ORDER BY pp.recorded_at DESC LIMIT 50`,
        [patientId],
    );

// ---------------------------------------------------------------------------
// Vitals
// ---------------------------------------------------------------------------

export const listVitals = (patientId: number) =>
    query(
        `SELECT v.*, s.name AS recorded_by_name FROM vitals v LEFT JOIN staff s ON s.id = v.recorded_by
         WHERE v.patient_id = ? ORDER BY v.recorded_at DESC LIMIT 50`,
        [patientId],
    );

/** Latest vitals per patient (patients without readings are included with null values). */
export const latestVitals = (scope?: PatientFilter) => {
    const restriction = scope?.('p.id');
    return query(
        `SELECT p.id AS patient_id, p.full_name AS patient_name, p.mrn AS patient_mrn, p.ward, p.room, p.status AS patient_status,
                v.id, v.recorded_at, v.heart_rate, v.bp_systolic, v.bp_diastolic, v.temperature_c, v.respiratory_rate, v.spo2, v.notes,
                s.name AS recorded_by_name
         FROM patients p
         LEFT JOIN vitals v ON v.id = (SELECT v2.id FROM vitals v2 WHERE v2.patient_id = p.id ORDER BY v2.recorded_at DESC, v2.id DESC LIMIT 1)
         LEFT JOIN staff s ON s.id = v.recorded_by
         WHERE p.status <> 'discharged' ${restriction ? `AND ${restriction.sql}` : ''}
         ORDER BY p.full_name`,
        restriction?.params ?? [],
    );
};

export async function recordVitals(input: Filters, recordedBy: number): Promise<number> {
    const result = await execute(
        `INSERT INTO vitals (patient_id, recorded_by, recorded_at, heart_rate, bp_systolic, bp_diastolic, temperature_c, respiratory_rate, spo2, notes)
         VALUES (?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?)`,
        [
            input.patient_id,
            recordedBy,
            input.heart_rate ?? null,
            input.bp_systolic ?? null,
            input.bp_diastolic ?? null,
            input.temperature_c ?? null,
            input.respiratory_rate ?? null,
            input.spo2 ?? null,
            input.notes ?? null,
        ],
    );
    return result.insertId;
}

// ---------------------------------------------------------------------------
// Patient care alerts
// ---------------------------------------------------------------------------

const SELECT_ALERT = `
    SELECT al.*, p.full_name AS patient_name, p.mrn AS patient_mrn, c.name AS created_by_name, k.name AS acknowledged_by_name
    FROM patient_alerts al
    LEFT JOIN patients p ON p.id = al.patient_id
    LEFT JOIN staff c ON c.id = al.created_by
    LEFT JOIN staff k ON k.id = al.acknowledged_by`;

/** Ward-wide alerts (no patient) are visible to everyone with alerts:read; patient alerts follow the care team. */
const alertScope = (scope?: PatientFilter) => {
    const restriction = scope?.('al.patient_id');
    return restriction ? { sql: `(al.patient_id IS NULL OR ${restriction.sql})`, params: restriction.params } : null;
};

export const listAlerts = (filters: { patientId?: number; status?: 'open' | 'acknowledged' | 'all' } = {}, scope?: PatientFilter) => {
    const conditions: [string, unknown][] = [['al.patient_id = ?', filters.patientId]];
    const { sql, params } = whereClause(conditions);
    const status =
        filters.status === 'open' ? 'al.acknowledged_at IS NULL' : filters.status === 'acknowledged' ? 'al.acknowledged_at IS NOT NULL' : null;
    const restriction = alertScope(scope);
    if (restriction) params.push(...restriction.params);
    const where = [sql.replace(/^WHERE /, ''), status, restriction?.sql].filter(Boolean).join(' AND ');
    return query(
        `${SELECT_ALERT} ${where ? `WHERE ${where}` : ''}
         ORDER BY al.acknowledged_at IS NOT NULL, FIELD(al.priority, 'high', 'medium', 'low'), al.created_at DESC LIMIT 200`,
        params,
    );
};

export const findAlert = (id: number) => queryOne(`${SELECT_ALERT} WHERE al.id = ?`, [id]);

export async function createAlert(input: Filters, createdBy: number): Promise<number> {
    const result = await execute(
        'INSERT INTO patient_alerts (patient_id, message, priority, category, created_by) VALUES (?, ?, ?, ?, ?)',
        [input.patient_id ?? null, input.message, input.priority ?? 'medium', input.category ?? 'general', createdBy],
    );
    return result.insertId;
}

export async function acknowledgeAlerts(ids: number[] | 'all', staffId: number, scope?: PatientFilter): Promise<number> {
    // "All" means all alerts the caller can see: ward-wide ones plus their own patients'.
    const restriction = scope?.('patient_alerts.patient_id');
    const visible = restriction ? ` AND (patient_alerts.patient_id IS NULL OR ${restriction.sql})` : '';
    const result =
        ids === 'all'
            ? await execute(
                  `UPDATE patient_alerts SET acknowledged_by = ?, acknowledged_at = UTC_TIMESTAMP() WHERE acknowledged_at IS NULL${visible}`,
                  [staffId, ...(restriction?.params ?? [])],
              )
            : await execute(
                  'UPDATE patient_alerts SET acknowledged_by = ?, acknowledged_at = UTC_TIMESTAMP() WHERE acknowledged_at IS NULL AND id IN (?)',
                  [staffId, ids],
              );
    return result.affectedRows;
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

const SELECT_ASSESSMENT = `
    SELECT a.*, p.full_name AS patient_name, p.mrn AS patient_mrn, s.name AS scheduled_by_name
    FROM assessments a JOIN patients p ON p.id = a.patient_id LEFT JOIN staff s ON s.id = a.scheduled_by_id`;

export const listAssessments = (filters: { patientId?: number; status?: string } = {}, scope?: PatientFilter) => {
    const { sql, params } = whereClause(
        [
            ['a.patient_id = ?', filters.patientId],
            ['a.status = ?', filters.status],
        ],
        scope,
        'a.patient_id',
    );
    return query(`${SELECT_ASSESSMENT} ${sql} ORDER BY a.scheduled_date IS NULL, a.scheduled_date DESC, a.created_at DESC`, params);
};

export const findAssessment = (id: number) => queryOne(`${SELECT_ASSESSMENT} WHERE a.id = ?`, [id]);

export async function createAssessment(input: Filters, staff: { id: number; email: string | null; uid: string }): Promise<number> {
    const result = await execute(
        `INSERT INTO assessments (patient_id, assessment_type, scheduled_by, scheduled_by_id, status, scheduled_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.patient_id, input.assessment_type, staff.email ?? staff.uid, staff.id, input.status ?? 'scheduled', input.scheduled_date ?? null, input.notes ?? null],
    );
    return result.insertId;
}

export const updateAssessment = (id: number, updates: Filters) =>
    buildUpdate('assessments', id, updates, ['assessment_type', 'status', 'scheduled_date', 'score', 'notes']);

export async function deleteById(table: 'assessments' | 'appointments', id: number): Promise<boolean> {
    const result = await execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return result.affectedRows > 0;
}
