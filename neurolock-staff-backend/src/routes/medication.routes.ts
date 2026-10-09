import { Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import {
    createMedication,
    findMedication,
    listAdministrations,
    listAdministrationsForDate,
    listMedications,
    recordAdministration,
    updateMedication,
} from '../repositories/clinical.repository';
import { patientExists } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, scopeFor } from '../services/care-scope';
import { asyncHandler, badRequest, conflict, notFound, parseId } from '../utils/http';
import { dateStr, isValidDate, nullableStr, oneOf, requiredStr, str } from '../utils/validate';

const router = Router();
router.use(authenticate);

const STATUSES = ['active', 'on_hold', 'discontinued'] as const;
const ADMIN_STATUSES = ['given', 'refused', 'held', 'missed'] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseTimes(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const times = String(value)
        .split(',')
        .map((time) => time.trim())
        .filter(Boolean);
    const invalid = times.filter((time) => !TIME_RE.test(time));
    if (invalid.length) throw badRequest('Scheduled times must be HH:MM (24h), comma-separated', { field: 'scheduled_times' });
    return [...new Set(times)].sort().join(',');
}

router.get(
    '/',
    requirePermission(P.MEDICATIONS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        const status = oneOf(req.query as Record<string, unknown>, 'status', STATUSES);
        await assertPatientAccess(req, patientId);
        const medications = await listMedications({ patientId, status }, scopeFor(req));
        res.json({ data: medications, meta: { count: medications.length } });
    }),
);

/**
 * Administration schedule for one ward-local day: every dose slot of every active prescription,
 * with the administration record if the dose was already charted.
 */
router.get(
    '/schedule',
    requirePermission(P.MEDICATIONS_READ),
    asyncHandler(async (req, res) => {
        const date = typeof req.query.date === 'string' && isValidDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
        // Only the caller's patients' doses
        const medications: any[] = await listMedications({ status: 'active' }, scopeFor(req));
        const administrations: any[] = await listAdministrationsForDate(date);
        const slots = medications.flatMap((med) => {
            const times: string[] = med.scheduled_times ? String(med.scheduled_times).split(',') : [];
            return times.map((time) => {
                const given = administrations.find((a) => a.medication_id === med.id && a.scheduled_time === time);
                return {
                    medication_id: med.id,
                    patient_id: med.patient_id,
                    patient_name: med.patient_name,
                    patient_mrn: med.patient_mrn,
                    ward: med.ward,
                    room: med.room,
                    name: med.name,
                    dose: med.dose,
                    route: med.route,
                    instructions: med.instructions,
                    scheduled_time: time,
                    administration: given
                        ? { id: given.id, status: given.status, administered_at: given.administered_at, administered_by_name: given.administered_by_name, notes: given.notes }
                        : null,
                };
            });
        });
        slots.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time) || a.patient_name.localeCompare(b.patient_name));
        res.json({ data: slots, meta: { date, count: slots.length } });
    }),
);

router.get(
    '/:id/administrations',
    requirePermission(P.MEDICATIONS_READ),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const medication: any = await findMedication(id);
        if (!medication) throw notFound('Medication');
        await assertPatientAccess(req, medication.patient_id);
        res.json({ data: await listAdministrations(id) });
    }),
);

router.post(
    '/',
    requirePermission(P.MEDICATIONS_PRESCRIBE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const id = await createMedication(
            {
                patient_id: patientId,
                name: requiredStr(req.body, 'name', { max: 200, label: 'Medication name' }),
                dose: requiredStr(req.body, 'dose', { max: 100, label: 'Dose' }),
                frequency: requiredStr(req.body, 'frequency', { max: 100, label: 'Frequency' }),
                route: str(req.body, 'route', { max: 50 }) ?? 'Oral',
                scheduled_times: parseTimes(req.body?.scheduled_times),
                instructions: str(req.body, 'instructions', { max: 255 }),
                start_date: dateStr(req.body, 'start_date', { label: 'Start date' }),
                end_date: dateStr(req.body, 'end_date', { label: 'End date' }),
            },
            req.user!.id,
        );
        await audit(req, { action: 'prescribe', resource: 'medication', resourceId: id, patientId });
        res.status(201).json({ data: await findMedication(id), meta: { message: 'Medication prescribed' } });
    }),
);

router.put(
    '/:id',
    requirePermission(P.MEDICATIONS_UPDATE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const existing: any = await findMedication(id);
        if (!existing) throw notFound('Medication');
        await assertPatientAccess(req, existing.patient_id);
        const updates = {
            name: str(req.body, 'name', { max: 200 }),
            dose: str(req.body, 'dose', { max: 100 }),
            frequency: str(req.body, 'frequency', { max: 100 }),
            route: str(req.body, 'route', { max: 50 }),
            scheduled_times: parseTimes(req.body?.scheduled_times),
            instructions: nullableStr(req.body, 'instructions', { max: 255 }),
            end_date: dateStr(req.body, 'end_date', { label: 'End date' }),
            status: oneOf(req.body, 'status', STATUSES),
        };
        if (Object.values(updates).every((value) => value === undefined)) throw badRequest('No changes supplied');
        await updateMedication(id, updates);
        await audit(req, { action: 'update', resource: 'medication', resourceId: id, patientId: existing.patient_id, details: { status: updates.status } });
        res.json({ data: await findMedication(id), meta: { message: 'Prescription updated' } });
    }),
);

router.post(
    '/:id/administer',
    requirePermission(P.MEDICATIONS_ADMINISTER),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const medication: any = await findMedication(id);
        if (!medication) throw notFound('Medication');
        await assertPatientAccess(req, medication.patient_id);
        if (medication.status !== 'active') throw conflict('This prescription is not active');
        const scheduledTime = str(req.body, 'scheduled_time', { max: 5 }) ?? null;
        if (scheduledTime && !TIME_RE.test(scheduledTime)) throw badRequest('scheduled_time must be HH:MM', { field: 'scheduled_time' });
        const scheduleDate = dateStr(req.body, 'schedule_date') ?? new Date().toISOString().slice(0, 10);
        const status = oneOf(req.body, 'status', ADMIN_STATUSES) ?? 'given';
        const adminId = await recordAdministration({
            medicationId: id,
            patientId: medication.patient_id,
            scheduleDate,
            scheduledTime,
            status,
            notes: str(req.body, 'notes', { max: 255 }) ?? null,
            administeredBy: req.user!.id,
        });
        await audit(req, {
            action: 'administer',
            resource: 'medication',
            resourceId: id,
            patientId: medication.patient_id,
            severity: status === 'given' ? 'info' : 'low',
            details: { status, scheduled_time: scheduledTime },
        });
        res.status(201).json({ data: { id: adminId, status }, meta: { message: `Dose recorded as ${status}` } });
    }),
);

export const medicationRoutes = router;
