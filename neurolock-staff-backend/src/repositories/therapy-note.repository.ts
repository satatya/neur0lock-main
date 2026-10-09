import { config } from '../config/env';
import { execute, query, queryOne, withTransaction } from '../infra/db/mysql-client';
import { decryptNote, encryptNote, noteAad } from '../utils/encryption';
import type { PatientFilter } from '../services/care-scope';

export interface NoteContent {
    mood?: string;
    symptoms?: string;
    interventions?: string;
    treatment_plan?: string;
    notes?: string;
    next_session?: string;
}

export const NOTE_CONTENT_FIELDS: (keyof NoteContent)[] = ['mood', 'symptoms', 'interventions', 'treatment_plan', 'notes', 'next_session'];

interface EncryptedRow {
    id: number;
    patient_id: number;
    aad_bound: number;
    dek_wrapped: Buffer;
    iv: Buffer;
    ciphertext: Buffer;
}

export interface NoteRow extends EncryptedRow {
    author_id: number | null;
    author: string;
    author_name: string | null;
    note_type: string;
    session_date: string | null;
    version: number;
    created_at: Date;
    updated_at: Date;
    patient_name: string;
    patient_mrn: string;
}

const META_COLUMNS = `n.id, n.patient_id, n.author_id, n.author, COALESCE(s.name, n.author) AS author_name, n.note_type,
    n.session_date, n.version, n.created_at, n.updated_at, p.full_name AS patient_name, p.mrn AS patient_mrn`;

const FROM_NOTES = `FROM therapy_notes n JOIN patients p ON p.id = n.patient_id LEFT JOIN staff s ON s.id = n.author_id`;

/** Metadata only; content stays encrypted. */
export const listNotes = (patientId?: number, scope?: PatientFilter) => {
    const restriction = scope?.('n.patient_id');
    const where = [patientId ? 'n.patient_id = ?' : null, restriction?.sql].filter(Boolean);
    const params = [...(patientId ? [patientId] : []), ...(restriction?.params ?? [])];
    return query<Omit<NoteRow, keyof EncryptedRow>>(
        `SELECT ${META_COLUMNS} ${FROM_NOTES} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(n.session_date, DATE(n.created_at)) DESC, n.id DESC LIMIT 200`,
        params,
    );
};

export const findNote = (id: number) =>
    queryOne<NoteRow>(`SELECT ${META_COLUMNS}, n.aad_bound, n.dek_wrapped, n.iv, n.ciphertext ${FROM_NOTES} WHERE n.id = ?`, [id]);

function serialize(content: NoteContent): string {
    return JSON.stringify({ format: 'structured-v1', ...content });
}

export function decryptContent(row: EncryptedRow): NoteContent {
    const text = decryptNote(row.dek_wrapped, row.iv, row.ciphertext, row.aad_bound ? noteAad(row.patient_id) : undefined);
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const content: NoteContent = {};
            for (const field of NOTE_CONTENT_FIELDS) {
                if (typeof parsed[field] === 'string') content[field] = parsed[field];
            }
            return content;
        }
    } catch {
        // Plain-text note (e.g. written by the Python demo client)
    }
    return { notes: text };
}

export async function createNote(input: {
    patientId: number;
    authorId: number;
    author: string;
    noteType: string;
    sessionDate: string | null;
    content: NoteContent;
}): Promise<number> {
    const { dekWrapped, iv, ciphertext } = encryptNote(serialize(input.content), noteAad(input.patientId));
    const result = await execute(
        `INSERT INTO therapy_notes (patient_id, author_id, author, note_type, session_date, version, aad_bound, dek_wrapped, iv, ciphertext, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
        [input.patientId, input.authorId, input.author, input.noteType, input.sessionDate, dekWrapped, iv, ciphertext, input.authorId],
    );
    return result.insertId;
}

/** Keeps the previous ciphertext as a version, then stores the re-encrypted content. */
export async function updateNote(
    id: number,
    input: { noteType?: string; sessionDate?: string | null; content: NoteContent; editorId: number; editorName: string; changeSummary: string | null },
): Promise<number> {
    return withTransaction(async (connection) => {
        const current = await queryOne<NoteRow>('SELECT * FROM therapy_notes WHERE id = ? FOR UPDATE', [id], connection);
        if (!current) return 0;
        await execute(
            `INSERT INTO therapy_note_versions (note_id, version, aad_bound, dek_wrapped, iv, ciphertext, edited_by, edited_by_name, change_summary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, current.version, current.aad_bound, current.dek_wrapped, current.iv, current.ciphertext, input.editorId, input.editorName, input.changeSummary],
            connection,
        );
        const { dekWrapped, iv, ciphertext } = encryptNote(serialize(input.content), noteAad(current.patient_id));
        await execute(
            `UPDATE therapy_notes SET note_type = COALESCE(?, note_type), session_date = ?, version = version + 1, aad_bound = 1,
                    dek_wrapped = ?, iv = ?, ciphertext = ?, updated_by = ?
             WHERE id = ?`,
            [
                input.noteType ?? null,
                input.sessionDate === undefined ? current.session_date : input.sessionDate,
                dekWrapped,
                iv,
                ciphertext,
                input.editorId,
                id,
            ],
            connection,
        );
        return current.version + 1;
    });
}

export const listVersions = (noteId: number) =>
    query(
        `SELECT id, note_id, version, edited_by, edited_by_name, change_summary, created_at
         FROM therapy_note_versions WHERE note_id = ? ORDER BY version DESC`,
        [noteId],
    );

export async function deleteNote(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM therapy_notes WHERE id = ?', [id]);
    return result.affectedRows > 0;
}

export async function hasEmergencyGrant(staffId: number, patientId: number): Promise<boolean> {
    return Boolean(
        await queryOne(
            'SELECT id FROM emergency_access WHERE staff_id = ? AND patient_id = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1',
            [staffId, patientId],
        ),
    );
}

export async function emergencyGrantedPatientIds(staffId: number): Promise<number[]> {
    const rows = await query<{ patient_id: number }>(
        'SELECT DISTINCT patient_id FROM emergency_access WHERE staff_id = ? AND expires_at > UTC_TIMESTAMP()',
        [staffId],
    );
    return rows.map((row) => row.patient_id);
}

export async function createEmergencyGrant(staffId: number, patientId: number, reason: string): Promise<{ id: number; expires_at: string }> {
    const result = await execute(
        `INSERT INTO emergency_access (staff_id, patient_id, reason, granted_at, expires_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
        [staffId, patientId, reason, config.emergencyAccessMinutes],
    );
    return { id: result.insertId, expires_at: new Date(Date.now() + config.emergencyAccessMinutes * 60_000).toISOString() };
}
