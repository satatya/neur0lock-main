import { Request, Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, can, requirePermission, requireStepUp } from '../middlewares/auth.middleware';
import {
    listAlerts,
    listAppointments,
    listAssessments,
    listMedications,
    listSessions,
    listVitals,
    progressHistory,
} from '../repositories/clinical.repository';
import {
    createPatient,
    deletePatient,
    EDITABLE_PATIENT_FIELDS,
    findPatientById,
    findPatientByMrn,
    listPatients,
    nextMrn,
    PatientInput,
    PatientRow,
    SENSITIVE_PATIENT_FIELDS,
    updatePatient,
} from '../repositories/patient.repository';
import { hasEmergencyGrant, listNotes } from '../repositories/therapy-note.repository';
import { bearerOf } from '../infra/aaa-client';
import { audit } from '../services/audit.service';
import {
    addToCareTeam,
    assertPatientAccess,
    canAccessPatient,
    careTeamOwner,
    listCareTeams,
    scopeFor,
    seesAllPatients,
    setCareTeam,
} from '../services/care-scope';
import { isActiveStaff } from '../services/directory.service';
import { asyncHandler, badRequest, conflict, forbidden, notFound, parseId } from '../utils/http';
import { dateStr, email, nullableStr, oneOf, queryStr, str } from '../utils/validate';

const router = Router();
router.use(authenticate);

const STATUSES = ['active', 'inactive', 'critical', 'discharged'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;

function ageFrom(dob: string | null): number | null {
    if (!dob) return null;
    const birth = new Date(`${dob}T00:00:00Z`);
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const beforeBirthday =
        now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
    if (beforeBirthday) age -= 1;
    return age;
}

/** Shapes a patient row for the caller: sensitive fields are only included when permitted and requested. */
export function presentPatient(row: PatientRow, req: Request, includeSensitive = false) {
    const showSensitive = includeSensitive && can(req, P.PATIENTS_READ_SENSITIVE);
    const patient: Record<string, unknown> = {
        ...row,
        age: ageFrom(row.dob),
        next_appointment_at: row.next_appointment_at ? new Date(row.next_appointment_at).toISOString() : null,
        sensitive_masked: !showSensitive,
        can_view_sensitive: can(req, P.PATIENTS_READ_SENSITIVE),
    };
    if (!showSensitive) {
        for (const field of SENSITIVE_PATIENT_FIELDS) patient[field] = null;
    }
    if (!can(req, P.SESSIONS_READ)) {
        delete patient.last_session_date;
        delete patient.latest_progress;
    }
    if (!can(req, P.APPOINTMENTS_READ)) delete patient.next_appointment_at;
    return patient;
}

async function staffRef(value: unknown, field: string, token: string | null): Promise<number | null | undefined> {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const id = parseId(value, field);
    if (!(await isActiveStaff(id, token))) throw badRequest('Selected staff member does not exist or is inactive', { field });
    return id;
}

/** Optional `care_team_ids`: extra staff (any role) who may see this patient. */
async function parseCareTeam(body: Record<string, unknown>, token: string | null): Promise<number[] | undefined> {
    if (!('care_team_ids' in body)) return undefined;
    const value = body.care_team_ids;
    if (value === null) return [];
    if (!Array.isArray(value) || value.length > 50) throw badRequest('care_team_ids must be a list of staff ids', { field: 'care_team_ids' });
    const ids = [...new Set(value.map((item) => parseId(item, 'care_team_ids')))];
    for (const id of ids) {
        if (!(await isActiveStaff(id, token))) throw badRequest('A selected care-team member does not exist or is inactive', { field: 'care_team_ids' });
    }
    return ids;
}

async function withCareTeam(rows: Record<string, unknown>[]) {
    const teams = await listCareTeams(rows.map((row) => Number(row.id)));
    return rows.map((row) => ({ ...row, care_team: teams.get(Number(row.id)) ?? [] }));
}

async function parsePatientInput(body: Record<string, unknown>, isCreate: boolean, token: string | null): Promise<PatientInput> {
    // Accept the legacy field names used by older clients.
    const source: Record<string, unknown> = {
        ...body,
        full_name: body.full_name ?? body.name,
        dob: body.dob ?? body.date_of_birth,
        phone: body.phone ?? body.contact_number,
    };
    const input: PatientInput = {
        full_name: isCreate ? str(source, 'full_name', { required: true, max: 200, label: 'Patient name' }) : str(source, 'full_name', { max: 200, label: 'Patient name' }),
        dob: dateStr(source, 'dob', { label: 'Date of birth' }),
        gender: nullableStr(source, 'gender', { max: 20 }),
        phone: nullableStr(source, 'phone', { max: 30 }),
        email: 'email' in source ? (source.email ? email(source, 'email') : null) : undefined,
        address: nullableStr(source, 'address', { max: 255 }),
        emergency_contact_name: nullableStr(source, 'emergency_contact_name', { max: 120 }),
        emergency_contact_phone: nullableStr(source, 'emergency_contact_phone', { max: 30 }),
        insurance: nullableStr(source, 'insurance', { max: 120 }),
        allergies: nullableStr(source, 'allergies', { max: 255 }),
        primary_diagnosis:
            'primary_diagnosis' in source
                ? nullableStr(source, 'primary_diagnosis', { max: 200 })
                : nullableStr(source, 'diagnosis', { max: 200 }),
        secondary_diagnosis: nullableStr(source, 'secondary_diagnosis', { max: 200 }),
        ward: nullableStr(source, 'ward', { max: 40 }),
        room: nullableStr(source, 'room', { max: 20 }),
        status: oneOf(source, 'status', STATUSES),
        priority: oneOf(source, 'priority', PRIORITIES),
        attending_physician_id: await staffRef(source.attending_physician_id, 'attending_physician_id', token),
        assigned_therapist_id: await staffRef(source.assigned_therapist_id, 'assigned_therapist_id', token),
        admission_date: dateStr(source, 'admission_date', { label: 'Admission date' }),
    };
    if (input.dob && input.dob > new Date().toISOString().slice(0, 10)) {
        throw badRequest('Date of birth cannot be in the future', { field: 'dob' });
    }
    return input;
}

router.get(
    '/',
    requirePermission(P.PATIENTS_READ),
    asyncHandler(async (req, res) => {
        const status = oneOf(req.query as Record<string, unknown>, 'status', STATUSES);
        // Only patients on the caller's care team, unless their role may see everyone
        const rows = await listPatients({ search: queryStr(req.query.search), status }, scopeFor(req));
        const patients = rows.map((row) => presentPatient(row, req));
        res.json({ data: patients, meta: { count: patients.length, scope: seesAllPatients(req) ? 'all' : 'care_team' } });
    }),
);

router.get(
    '/mrn/:mrn',
    requirePermission(P.PATIENTS_READ),
    asyncHandler(async (req, res) => {
        const row = await findPatientByMrn(String(req.params.mrn));
        if (!row) throw notFound('Patient');
        if (!(await canAccessPatient(req, row.id))) {
            // Break-glass holders may identify a patient outside their care team to request emergency access.
            if (can(req, P.NOTES_EMERGENCY)) {
                return res.json({ data: { id: row.id, mrn: row.mrn, full_name: row.full_name, on_care_team: false } });
            }
            await assertPatientAccess(req, row.id);
        }
        res.json({ data: { ...presentPatient(row, req), on_care_team: true } });
    }),
);

router.get(
    '/:id',
    requirePermission(P.PATIENTS_READ),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        await assertPatientAccess(req, id);
        const row = await findPatientById(id);
        if (!row) throw notFound('Patient');
        const includeSensitive = req.query.include_sensitive === '1' || req.query.include_sensitive === 'true';
        if (includeSensitive && can(req, P.PATIENTS_READ_SENSITIVE)) {
            await audit(req, { action: 'view_sensitive', resource: 'patient', resourceId: id, patientId: id, severity: 'low' });
        }
        const [patient] = await withCareTeam([presentPatient(row, req, includeSensitive)]);
        res.json({ data: patient });
    }),
);

/** Everything about one patient that the caller's permissions allow, in one call. */
router.get(
    '/:id/overview',
    requirePermission(P.PATIENTS_READ),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        await assertPatientAccess(req, id);
        const row = await findPatientById(id);
        if (!row) throw notFound('Patient');

        const includeSensitive = req.query.include_sensitive === '1' || req.query.include_sensitive === 'true';
        const sections: Record<string, unknown> = {};
        const restricted: string[] = [];
        const section = async (name: string, allowed: boolean, load: () => Promise<unknown>) => {
            if (allowed) sections[name] = await load();
            else restricted.push(name);
        };

        await section('medications', can(req, P.MEDICATIONS_READ), () => listMedications({ patientId: id }));
        await section('vitals', can(req, P.VITALS_READ), async () => (await listVitals(id)).slice(0, 10));
        await section('appointments', can(req, P.APPOINTMENTS_READ), () => listAppointments({ patientId: id }));
        await section('sessions', can(req, P.SESSIONS_READ), () => listSessions({ patientId: id }));
        await section('progress', can(req, P.SESSIONS_READ), () => progressHistory(id));
        await section('assessments', can(req, P.ASSESSMENTS_READ), () => listAssessments({ patientId: id }));
        await section('alerts', can(req, P.ALERTS_READ), () => listAlerts({ patientId: id, status: 'open' }));

        const emergency = can(req, P.NOTES_EMERGENCY) ? await hasEmergencyGrant(req.user!.id, id) : false;
        await section('notes', can(req, P.NOTES_READ) || emergency, () => listNotes(id));

        await audit(req, {
            action: includeSensitive && can(req, P.PATIENTS_READ_SENSITIVE) ? 'view_sensitive' : 'view',
            resource: 'patient',
            resourceId: id,
            patientId: id,
        });
        res.json({
            data: {
                patient: (await withCareTeam([presentPatient(row, req, includeSensitive)]))[0],
                sections,
                restricted,
                emergency_access_active: emergency,
            },
        });
    }),
);

router.post(
    '/',
    requirePermission(P.PATIENTS_CREATE),
    asyncHandler(async (req, res) => {
        const input = await parsePatientInput(req.body ?? {}, true, bearerOf(req));
        const careTeam = await parseCareTeam(req.body ?? {}, bearerOf(req));
        const requestedMrn = str(req.body, 'mrn', { max: 32, label: 'MRN' });
        if (requestedMrn && (await findPatientByMrn(requestedMrn))) throw conflict('A patient with this MRN already exists');
        const mrn = requestedMrn ?? (await nextMrn());
        const id = await createPatient({ ...input, mrn, full_name: input.full_name as string }, req.user!.id);
        if (careTeam?.length) await setCareTeam(id, careTeam, req.user!.id);
        // The clinician who registers a patient keeps access to them
        if (!seesAllPatients(req)) await addToCareTeam(id, careTeamOwner(req), 'created', req.user!.id);
        await audit(req, { action: 'create', resource: 'patient', resourceId: id, patientId: id, details: { mrn, care_team: careTeam } });
        const created = await findPatientById(id);
        const [patient] = created ? await withCareTeam([presentPatient(created, req, true)]) : [null];
        res.status(201).json({ data: patient, meta: { message: 'Patient created successfully' } });
    }),
);

router.put(
    '/:id',
    requirePermission(P.PATIENTS_UPDATE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        await assertPatientAccess(req, id);
        const existing = await findPatientById(id);
        if (!existing) throw notFound('Patient');
        const input = await parsePatientInput(req.body ?? {}, false, bearerOf(req));
        const careTeam = await parseCareTeam(req.body ?? {}, bearerOf(req));
        const touchedSensitive = SENSITIVE_PATIENT_FIELDS.filter((field) => input[field] !== undefined);
        if (touchedSensitive.length > 0 && !can(req, P.PATIENTS_READ_SENSITIVE)) {
            throw forbidden('Your role cannot view or change sensitive patient details', { fields: touchedSensitive });
        }
        const changed = EDITABLE_PATIENT_FIELDS.filter((field) => input[field] !== undefined);
        if (changed.length === 0 && careTeam === undefined) throw badRequest('No changes supplied');

        if (!seesAllPatients(req)) {
            // Do not let a clinician remove their own access by accident
            const owner = careTeamOwner(req);
            const attending = input.attending_physician_id !== undefined ? input.attending_physician_id : existing.attending_physician_id;
            const therapist = input.assigned_therapist_id !== undefined ? input.assigned_therapist_id : existing.assigned_therapist_id;
            const members = careTeam ?? ((await listCareTeams([id])).get(id) ?? []).map((member) => member.id);
            if (Number(attending) !== owner && Number(therapist) !== owner && !members.includes(owner)) {
                throw conflict('This change would remove you from the patient\'s care team. Keep yourself on the team, or ask an administrator.');
            }
        }

        if (changed.length > 0) await updatePatient(id, input);
        if (careTeam !== undefined) await setCareTeam(id, careTeam, req.user!.id);
        await audit(req, { action: 'update', resource: 'patient', resourceId: id, patientId: id, details: { fields: changed, care_team: careTeam } });
        const updated = await findPatientById(id);
        const [patient] = updated ? await withCareTeam([presentPatient(updated, req, can(req, P.PATIENTS_READ_SENSITIVE))]) : [null];
        res.json({ data: patient, meta: { message: 'Patient updated successfully' } });
    }),
);

router.delete(
    '/:id',
    requirePermission(P.PATIENTS_DELETE),
    requireStepUp,
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        await assertPatientAccess(req, id);
        const existing = await findPatientById(id);
        if (!existing) throw notFound('Patient');
        await deletePatient(id);
        await audit(req, { action: 'delete', resource: 'patient', resourceId: id, patientId: id, severity: 'high', details: { mrn: existing.mrn } });
        res.json({ meta: { message: 'Patient deleted successfully' } });
    }),
);

export const patientRoutes = router;
