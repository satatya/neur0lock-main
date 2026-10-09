import { Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import { createAppointment, findAppointment, listAppointments, updateAppointment } from '../repositories/clinical.repository';
import { patientExists } from '../repositories/patient.repository';
import { bearerOf } from '../infra/aaa-client';
import { audit } from '../services/audit.service';
import { addToCareTeam, assertPatientAccess, scopeFor } from '../services/care-scope';
import { isActiveStaff } from '../services/directory.service';
import { asyncHandler, badRequest, notFound, parseId } from '../utils/http';
import { dateTimeStr, int, nullableStr, oneOf, str, toSqlDateTime } from '../utils/validate';

const router = Router();
router.use(authenticate);

const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
const TYPES = ['Consultation', 'Follow-up', 'Therapy session', 'Medication review', 'Assessment', 'Group session'] as const;

const isoDate = (value: unknown) => {
    if (typeof value !== 'string' || !value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw badRequest('Invalid date filter');
    return toSqlDateTime(date);
};

router.get(
    '/',
    requirePermission(P.APPOINTMENTS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        const staffId = req.query.mine === '1' || req.query.mine === 'true' ? req.user!.id : req.query.staff_id ? parseId(req.query.staff_id, 'staff_id') : undefined;
        const status = oneOf(req.query as Record<string, unknown>, 'status', STATUSES);
        await assertPatientAccess(req, patientId);
        const appointments = await listAppointments({ patientId, staffId, status, from: isoDate(req.query.from), to: isoDate(req.query.to) }, scopeFor(req));
        res.json({ data: appointments, meta: { count: appointments.length } });
    }),
);

router.post(
    '/',
    requirePermission(P.APPOINTMENTS_CREATE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const scheduledAt = dateTimeStr(req.body, 'scheduled_at', { required: true, label: 'Date and time' }) as string;
        if (new Date(`${scheduledAt.replace(' ', 'T')}Z`).getTime() < Date.now() - 5 * 60_000) {
            throw badRequest('Appointments cannot be scheduled in the past', { field: 'scheduled_at' });
        }
        let staffId = req.user!.id;
        if (req.body?.staff_id) {
            staffId = parseId(req.body.staff_id, 'staff_id');
            if (!(await isActiveStaff(staffId, bearerOf(req)))) throw badRequest('Selected clinician is not active', { field: 'staff_id' });
        }
        const id = await createAppointment(
            {
                patient_id: patientId,
                staff_id: staffId,
                scheduled_at: scheduledAt,
                duration_min: int(req.body, 'duration_min', { min: 5, max: 480, label: 'Duration' }) ?? 50,
                appointment_type: oneOf(req.body, 'appointment_type', TYPES) ?? 'Consultation',
                reason: str(req.body, 'reason', { max: 255 }),
            },
            req.user!.id,
        );
        // A clinician given an appointment with the patient joins their care team
        if (staffId !== req.user!.id) await addToCareTeam(patientId, staffId, 'appointment', req.user!.id);
        await audit(req, { action: 'create', resource: 'appointment', resourceId: id, patientId });
        res.status(201).json({ data: await findAppointment(id), meta: { message: 'Appointment scheduled' } });
    }),
);

router.put(
    '/:id',
    requirePermission(P.APPOINTMENTS_UPDATE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const existing: any = await findAppointment(id);
        if (!existing) throw notFound('Appointment');
        await assertPatientAccess(req, existing.patient_id);
        const updates = {
            scheduled_at: dateTimeStr(req.body, 'scheduled_at', { label: 'Date and time' }),
            duration_min: int(req.body, 'duration_min', { min: 5, max: 480, label: 'Duration' }),
            appointment_type: oneOf(req.body, 'appointment_type', TYPES),
            reason: nullableStr(req.body, 'reason', { max: 255 }),
            status: oneOf(req.body, 'status', STATUSES),
        };
        if (Object.values(updates).every((value) => value === undefined)) throw badRequest('No changes supplied');
        await updateAppointment(id, updates);
        await audit(req, { action: 'update', resource: 'appointment', resourceId: id, patientId: existing.patient_id, details: { status: updates.status } });
        res.json({ data: await findAppointment(id), meta: { message: 'Appointment updated' } });
    }),
);

export const appointmentRoutes = router;
