import { DbExecutor, execute, query, queryOne } from '../infra/db/mysql-client';
import type { PatientFilter } from '../services/care-scope';

export interface PatientRow {
    id: number;
    mrn: string;
    /** Patient-portal account (directory uid), if the patient has one. */
    account_uid: string | null;
    full_name: string;
    dob: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    insurance: string | null;
    allergies: string | null;
    primary_diagnosis: string | null;
    secondary_diagnosis: string | null;
    ward: string | null;
    room: string | null;
    status: 'active' | 'inactive' | 'critical' | 'discharged';
    priority: 'low' | 'medium' | 'high';
    attending_physician_id: number | null;
    attending_physician_name: string | null;
    assigned_therapist_id: number | null;
    assigned_therapist_name: string | null;
    admission_date: string | null;
    created_at: Date;
    updated_at: Date;
    next_appointment_at?: Date | null;
    last_session_date?: string | null;
    latest_progress?: number | null;
}

/** Fields only returned to roles holding patients:read_sensitive. */
export const SENSITIVE_PATIENT_FIELDS = [
    'dob',
    'phone',
    'email',
    'address',
    'emergency_contact_name',
    'emergency_contact_phone',
    'insurance',
] as const;

export const EDITABLE_PATIENT_FIELDS = [
    'full_name',
    'dob',
    'gender',
    'phone',
    'email',
    'address',
    'emergency_contact_name',
    'emergency_contact_phone',
    'insurance',
    'allergies',
    'primary_diagnosis',
    'secondary_diagnosis',
    'ward',
    'room',
    'status',
    'priority',
    'attending_physician_id',
    'assigned_therapist_id',
    'admission_date',
] as const;

export type PatientInput = Partial<Record<(typeof EDITABLE_PATIENT_FIELDS)[number], unknown>> & { mrn?: string };

const SELECT_PATIENT = `
    SELECT p.*, ap.name AS attending_physician_name, at.name AS assigned_therapist_name,
      (SELECT MIN(a.scheduled_at) FROM appointments a
        WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.scheduled_at >= UTC_TIMESTAMP()) AS next_appointment_at,
      (SELECT MAX(ts.session_date) FROM therapy_sessions ts WHERE ts.patient_id = p.id) AS last_session_date,
      (SELECT pp.score FROM patient_progress pp WHERE pp.patient_id = p.id ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 1) AS latest_progress
    FROM patients p
    LEFT JOIN staff ap ON ap.id = p.attending_physician_id
    LEFT JOIN staff at ON at.id = p.assigned_therapist_id`;

export async function listPatients(filters: { search?: string; status?: string } = {}, scope?: PatientFilter): Promise<PatientRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const restriction = scope?.('p.id');
    if (restriction) {
        where.push(restriction.sql);
        params.push(...restriction.params);
    }
    if (filters.search) {
        where.push('(p.full_name LIKE ? OR p.mrn LIKE ?)');
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.status) {
        where.push('p.status = ?');
        params.push(filters.status);
    }
    return query<PatientRow>(
        `${SELECT_PATIENT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY FIELD(p.status, 'critical', 'active', 'inactive', 'discharged'), FIELD(p.priority, 'high', 'medium', 'low'), p.full_name`,
        params,
    );
}

export const findPatientById = (id: number, executor?: DbExecutor) =>
    queryOne<PatientRow>(`${SELECT_PATIENT} WHERE p.id = ?`, [id], executor);

export const findPatientByMrn = (mrn: string) => queryOne<PatientRow>(`${SELECT_PATIENT} WHERE p.mrn = ?`, [mrn]);

export const findPatientByAccount = (uid: string) => queryOne<PatientRow>(`${SELECT_PATIENT} WHERE p.account_uid = ?`, [uid]);

export const patientExists = async (id: number) =>
    Boolean(await queryOne('SELECT id FROM patients WHERE id = ?', [id]));

export async function nextMrn(): Promise<string> {
    const row = await queryOne<{ next_id: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM patients');
    const candidate = `MRN${String(row?.next_id ?? 1).padStart(3, '0')}`;
    const taken = await queryOne('SELECT id FROM patients WHERE mrn = ?', [candidate]);
    return taken ? `MRN${Date.now().toString().slice(-8)}` : candidate;
}

export async function createPatient(input: PatientInput & { mrn: string; full_name: string; account_uid?: string | null }, createdBy: number | null): Promise<number> {
    const columns = ['mrn', 'created_by', 'account_uid'];
    const values: unknown[] = [input.mrn, createdBy, input.account_uid ?? null];
    for (const field of EDITABLE_PATIENT_FIELDS) {
        if (input[field] !== undefined) {
            columns.push(field);
            values.push(input[field]);
        }
    }
    const result = await execute(
        `INSERT INTO patients (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values,
    );
    return result.insertId;
}

export async function updatePatient(id: number, input: PatientInput): Promise<boolean> {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const field of EDITABLE_PATIENT_FIELDS) {
        if (input[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(input[field]);
        }
    }
    if (fields.length === 0) return false;
    values.push(id);
    const result = await execute(`UPDATE patients SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.affectedRows > 0;
}

export async function deletePatient(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM patients WHERE id = ?', [id]);
    return result.affectedRows > 0;
}
