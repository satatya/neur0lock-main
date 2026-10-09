import { Request, Router } from 'express';
import { P } from '../config/permissions';
import { assertStepUp, authenticate, can, requireAnyPermission, requirePermission } from '../middlewares/auth.middleware';
import { patientExists } from '../repositories/patient.repository';
import {
    createEmergencyGrant,
    createNote,
    decryptContent,
    deleteNote,
    emergencyGrantedPatientIds,
    findNote,
    hasEmergencyGrant,
    listNotes,
    listVersions,
    NOTE_CONTENT_FIELDS,
    NoteContent,
    updateNote,
} from '../repositories/therapy-note.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, isOnCareTeam, scopeFor } from '../services/care-scope';
import { asyncHandler, badRequest, forbidden, notFound, parseId } from '../utils/http';
import { dateStr, requiredStr, str } from '../utils/validate';

const router = Router();
router.use(authenticate);

const NOTE_TYPES = ['Session Note', 'Individual Therapy', 'Group Therapy', 'Family Therapy', 'Assessment', 'Consultation', 'Progress Note'];

function parseContent(body: Record<string, unknown>): NoteContent {
    // Legacy clients send a single text field.
    const legacy = body.note_content ?? (typeof body.content === 'string' ? body.content : undefined);
    const source = (typeof body.content === 'object' && body.content !== null ? body.content : {}) as Record<string, unknown>;
    const content: NoteContent = {};
    for (const field of NOTE_CONTENT_FIELDS) {
        const value = str(source, field, { max: 10_000, label: field.replace('_', ' ') });
        if (value) content[field] = value;
    }
    if (typeof legacy === 'string' && legacy.trim()) {
        content.notes = str({ notes: legacy }, 'notes', { max: 10_000 });
    }
    if (Object.keys(content).length === 0) throw badRequest('Note content is required', { field: 'content' });
    return content;
}

function parseNoteType(body: Record<string, unknown>): string | undefined {
    const type = str(body, 'note_type', { max: 40, label: 'Note type' });
    if (type && !NOTE_TYPES.includes(type)) throw badRequest(`Note type must be one of: ${NOTE_TYPES.join(', ')}`, { field: 'note_type' });
    return type;
}

/** Normal access via notes:read for patients on your care team, or a live break-glass grant. */
async function canReadPatientNotes(req: Request, patientId: number): Promise<{ allowed: boolean; emergency: boolean }> {
    if (can(req, P.NOTES_READ) && (await isOnCareTeam(req, patientId))) return { allowed: true, emergency: false };
    if (can(req, P.NOTES_EMERGENCY) && (await hasEmergencyGrant(req.user!.id, patientId))) return { allowed: true, emergency: true };
    return { allowed: false, emergency: false };
}

// Metadata list (content stays encrypted)
router.get(
    '/',
    requireAnyPermission(P.NOTES_READ, P.NOTES_EMERGENCY),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        if (!can(req, P.NOTES_READ)) {
            // Emergency-access holders only see notes for patients they currently hold a grant for.
            const granted = await emergencyGrantedPatientIds(req.user!.id);
            if (!patientId || !granted.includes(patientId)) {
                throw forbidden('Therapy notes are restricted for your role. Use emergency access if clinically necessary.');
            }
        }
        else if (patientId) await assertPatientAccess(req, patientId);
        const notes = await listNotes(patientId, scopeFor(req));
        res.json({ data: notes, meta: { count: notes.length } });
    }),
);

/** Break-glass: time-limited access to one patient's notes; always audited as critical. */
router.post(
    '/emergency-access',
    requirePermission(P.NOTES_EMERGENCY),
    asyncHandler(async (req, res) => {
        assertStepUp(req);
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        const reason = requiredStr(req.body, 'reason', { min: 20, max: 1000, label: 'Emergency reason' });
        if (!(await patientExists(patientId))) throw notFound('Patient');
        const grant = await createEmergencyGrant(req.user!.id, patientId, reason);
        await audit(req, {
            action: 'emergency_access',
            resource: 'therapy_note',
            patientId,
            severity: 'critical',
            details: { grant_id: grant.id, expires_at: grant.expires_at, reason_length: reason.length },
        });
        res.status(201).json({ data: grant, meta: { message: 'Emergency access granted for 60 minutes. This has been flagged for review.' } });
    }),
);

router.get(
    '/:id',
    requireAnyPermission(P.NOTES_READ, P.NOTES_EMERGENCY),
    asyncHandler(async (req, res) => {
        assertStepUp(req);
        const id = parseId(req.params.id);
        const note = await findNote(id);
        if (!note) throw notFound('Note');
        const access = await canReadPatientNotes(req, note.patient_id);
        if (!access.allowed) {
            await assertPatientAccess(req, note.patient_id); // explains "not on your care team" when that is the reason
            throw forbidden('You do not have access to this patient\'s notes');
        }

        const content = decryptContent(note);
        await audit(req, {
            action: access.emergency ? 'read_emergency' : 'read',
            resource: 'therapy_note',
            resourceId: id,
            patientId: note.patient_id,
            severity: access.emergency ? 'high' : 'info',
        });
        const { dek_wrapped, iv, ciphertext, aad_bound, ...meta } = note;
        res.json({ data: { ...meta, content, can_edit: can(req, P.NOTES_UPDATE) && note.author_id === req.user!.id } });
    }),
);

router.get(
    '/:id/versions',
    requirePermission(P.NOTES_READ),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const note = await findNote(id);
        if (!note) throw notFound('Note');
        await assertPatientAccess(req, note.patient_id);
        const versions = await listVersions(id);
        res.json({
            data: {
                current: { version: note.version, updated_at: note.updated_at, author_name: note.author_name },
                history: versions,
            },
        });
    }),
);

router.post(
    '/',
    requirePermission(P.NOTES_CREATE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const content = parseContent(req.body ?? {});
        const noteType = parseNoteType(req.body ?? {}) ?? 'Session Note';
        const sessionDate = dateStr(req.body, 'session_date', { label: 'Session date' }) ?? new Date().toISOString().slice(0, 10);

        const id = await createNote({ patientId, authorId: req.user!.id, author: req.user!.name, noteType, sessionDate, content });
        await audit(req, { action: 'create', resource: 'therapy_note', resourceId: id, patientId, details: { note_type: noteType } });
        const note = await findNote(id);
        res.status(201).json({
            data: note && { id: note.id, patient_id: note.patient_id, note_type: note.note_type, session_date: note.session_date, version: note.version, created_at: note.created_at },
            meta: { message: 'Therapy note encrypted and saved' },
        });
    }),
);

router.put(
    '/:id',
    requirePermission(P.NOTES_UPDATE),
    asyncHandler(async (req, res) => {
        assertStepUp(req);
        const id = parseId(req.params.id);
        const note = await findNote(id);
        if (!note) throw notFound('Note');
        await assertPatientAccess(req, note.patient_id);
        if (note.author_id !== req.user!.id) throw forbidden('Only the author can edit this note');

        const version = await updateNote(id, {
            noteType: parseNoteType(req.body ?? {}),
            sessionDate: dateStr(req.body, 'session_date', { label: 'Session date' }),
            content: parseContent(req.body ?? {}),
            editorId: req.user!.id,
            editorName: req.user!.name,
            changeSummary: str(req.body, 'change_summary', { max: 255 }) ?? null,
        });
        await audit(req, { action: 'update', resource: 'therapy_note', resourceId: id, patientId: note.patient_id, details: { version } });
        res.json({ data: { id, version }, meta: { message: 'Note updated (previous version retained)' } });
    }),
);

router.delete(
    '/:id',
    requirePermission(P.NOTES_DELETE),
    asyncHandler(async (req, res) => {
        assertStepUp(req);
        const id = parseId(req.params.id);
        const note = await findNote(id);
        if (!note) throw notFound('Note');
        await assertPatientAccess(req, note.patient_id);
        await deleteNote(id);
        await audit(req, { action: 'delete', resource: 'therapy_note', resourceId: id, patientId: note.patient_id, severity: 'high' });
        res.json({ meta: { message: 'Therapy note deleted' } });
    }),
);

export const therapyNoteRoutes = router;
