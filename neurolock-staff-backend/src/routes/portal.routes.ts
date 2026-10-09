/**
 * Patient portal: a signed-in patient sees and manages only their own record.
 *  - portal:access -> own profile, appointments, current medications, assessment results
 *  - portal:book   -> book and cancel own appointments
 * Therapy notes, other patients and clinical commentary are never exposed here.
 * An administrator previewing the Patient role sees the demo patient's record.
 */
import { Request, Router } from 'express';
import { bearerOf } from '../infra/aaa-client';
import { queryOne } from '../infra/db/mysql-client';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import { createAppointment, findAppointment, listAppointments, listAssessments, listMedications, updateAppointment } from '../repositories/clinical.repository';
import { findPatientByAccount, PatientRow } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { addToCareTeam } from '../services/care-scope';
import { activeStaffDirectory } from '../services/directory.service';
import { ApiError, asyncHandler, badRequest, conflict, notFound, parseId } from '../utils/http';
import { dateTimeStr, oneOf, str } from '../utils/validate';

const router = Router();
router.use(authenticate, requirePermission(P.PORTAL_ACCESS));

const BOOKABLE_TYPES = ['Consultation', 'Follow-up', 'Therapy session', 'Medication review', 'Assessment'] as const;
const DURATION_MIN = 50;
const MAX_UPCOMING = 5;
const MAX_DAYS_AHEAD = 90;
const MIN_NOTICE_MS = 60 * 60_000;
const CANCEL_NOTICE_MS = 2 * 60 * 60_000;

async function ownPatient(req: Request): Promise<PatientRow> {
    const uid = req.user!.portalUid;
    if (!uid) throw new ApiError(403, 'FORBIDDEN', 'This account is not a patient account');
    const patient = await findPatientByAccount(uid);
    if (!patient) throw notFound('Patient record for this account');
    return patient;
}

const profileOf = (p: PatientRow) => ({
    id: p.id,
    mrn: p.mrn,
    full_name: p.full_name,
    dob: p.dob,
    gender: p.gender,
    phone: p.phone,
    email: p.email,
    address: p.address,
    emergency_contact_name: p.emergency_contact_name,
    emergency_contact_phone: p.emergency_contact_phone,
    insurance: p.insurance,
    allergies: p.allergies,
    attending_physician_name: p.attending_physician_name,
    assigned_therapist_name: p.assigned_therapist_name,
    next_appointment_at: p.next_appointment_at ?? null,
});

const appointmentOf = (a: any) => ({
    id: a.id,
    staff_id: a.staff_id,
    clinician_name: a.staff_name,
    scheduled_at: a.scheduled_at,
    duration_min: a.duration_min,
    appointment_type: a.appointment_type,
    reason: a.reason,
    status: a.status,
    can_cancel: a.status === 'scheduled' && new Date(a.scheduled_at).getTime() - Date.now() > CANCEL_NOTICE_MS,
});

router.get(
    '/me',
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const [appointments, medications] = await Promise.all([
            listAppointments({ patientId: patient.id, status: 'scheduled', from: new Date().toISOString().slice(0, 19).replace('T', ' ') }),
            listMedications({ patientId: patient.id, status: 'active' }),
        ]);
        await audit(req, { action: 'portal_view', resource: 'patient', resourceId: patient.id, patientId: patient.id });
        res.json({
            data: {
                patient: profileOf(patient),
                upcoming_appointments: appointments.map(appointmentOf),
                active_medications: medications.length,
                preview: req.user!.actingRole !== null,
            },
        });
    }),
);

router.get(
    '/appointments',
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const rows = await listAppointments({ patientId: patient.id });
        const items = rows.map(appointmentOf).sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
        res.json({ data: items, meta: { count: items.length } });
    }),
);

router.get(
    '/medications',
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const rows = await listMedications({ patientId: patient.id });
        const items = rows
            .filter((m: any) => m.status !== 'discontinued')
            .map((m: any) => ({
                id: m.id,
                name: m.name,
                dose: m.dose,
                frequency: m.frequency,
                route: m.route,
                scheduled_times: m.scheduled_times,
                instructions: m.instructions,
                start_date: m.start_date,
                end_date: m.end_date,
                status: m.status,
                prescribed_by_name: m.prescribed_by_name,
            }));
        await audit(req, { action: 'portal_view', resource: 'medication', patientId: patient.id });
        res.json({ data: items, meta: { count: items.length } });
    }),
);

router.get(
    '/assessments',
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const rows = await listAssessments({ patientId: patient.id });
        const items = rows
            .filter((a: any) => a.status !== 'cancelled')
            .map((a: any) => ({
                id: a.id,
                assessment_type: a.assessment_type,
                status: a.status,
                scheduled_date: a.scheduled_date,
                score: a.status === 'completed' ? a.score : null,
                scheduled_by_name: a.scheduled_by_name,
            }));
        await audit(req, { action: 'portal_view', resource: 'assessment', patientId: patient.id });
        res.json({ data: items, meta: { count: items.length } });
    }),
);

/** Clinicians the patient can book with (roles that manage appointments). */
router.get(
    '/clinicians',
    requirePermission(P.PORTAL_BOOK),
    asyncHandler(async (req, res) => {
        const directory = await activeStaffDirectory(bearerOf(req));
        const clinicians = directory.filter((entry) => entry.bookable).map(({ id, name, role, role_name }) => ({ id, name, role, role_name }));
        res.json({ data: clinicians, meta: { count: clinicians.length } });
    }),
);

const toSql = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

router.post(
    '/appointments',
    requirePermission(P.PORTAL_BOOK),
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const staffId = parseId(req.body?.staff_id, 'staff_id');
        const clinician = (await activeStaffDirectory(bearerOf(req), true)).find((entry) => entry.id === staffId && entry.bookable);
        if (!clinician) throw badRequest('Choose one of the available clinicians', { field: 'staff_id' });

        const scheduledAt = dateTimeStr(req.body, 'scheduled_at', { required: true, label: 'Date and time' }) as string;
        const start = new Date(`${scheduledAt.replace(' ', 'T')}Z`);
        if (start.getTime() < Date.now() + MIN_NOTICE_MS) throw badRequest('Appointments must be booked at least 1 hour ahead', { field: 'scheduled_at' });
        if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw badRequest(`Appointments can be booked up to ${MAX_DAYS_AHEAD} days ahead`, { field: 'scheduled_at' });
        const end = new Date(start.getTime() + DURATION_MIN * 60_000);

        const upcoming = await queryOne<{ total: number }>(
            `SELECT COUNT(*) AS total FROM appointments WHERE patient_id = ? AND status = 'scheduled' AND scheduled_at >= UTC_TIMESTAMP()`,
            [patient.id],
        );
        if (Number(upcoming?.total ?? 0) >= MAX_UPCOMING) throw conflict(`You already have ${MAX_UPCOMING} upcoming appointments. Cancel one before booking another.`);

        // No double booking for the clinician or the patient.
        const overlap = await queryOne<{ staff_busy: number; patient_busy: number }>(
            `SELECT SUM(staff_id = ?) AS staff_busy, SUM(patient_id = ?) AS patient_busy
             FROM appointments
             WHERE status = 'scheduled' AND (staff_id = ? OR patient_id = ?)
               AND scheduled_at < ? AND DATE_ADD(scheduled_at, INTERVAL duration_min MINUTE) > ?`,
            [staffId, patient.id, staffId, patient.id, toSql(end), toSql(start)],
        );
        if (Number(overlap?.staff_busy ?? 0) > 0) throw conflict(`${clinician.name} is not available at that time. Please choose another slot.`);
        if (Number(overlap?.patient_busy ?? 0) > 0) throw conflict('You already have an appointment at that time.');

        const id = await createAppointment(
            {
                patient_id: patient.id,
                staff_id: staffId,
                scheduled_at: toSql(start),
                duration_min: DURATION_MIN,
                appointment_type: oneOf(req.body, 'appointment_type', BOOKABLE_TYPES) ?? 'Consultation',
                reason: str(req.body, 'reason', { max: 255 }) ?? 'Booked by patient',
            },
            req.user!.id,
        );
        // The clinician the patient booked with can now see this patient
        await addToCareTeam(patient.id, staffId, 'booking', req.user!.id);
        await audit(req, { action: 'portal_book', resource: 'appointment', resourceId: id, patientId: patient.id, details: { staff_id: staffId } });
        res.status(201).json({ data: appointmentOf(await findAppointment(id)), meta: { message: `Appointment booked with ${clinician.name}` } });
    }),
);

router.post(
    '/appointments/:id/cancel',
    requirePermission(P.PORTAL_BOOK),
    asyncHandler(async (req, res) => {
        const patient = await ownPatient(req);
        const id = parseId(req.params.id);
        const appointment: any = await findAppointment(id);
        if (!appointment || Number(appointment.patient_id) !== Number(patient.id)) throw notFound('Appointment');
        if (!appointmentOf(appointment).can_cancel) {
            throw conflict('This appointment can no longer be cancelled online (less than 2 hours away or not scheduled). Please call the clinic.');
        }
        await updateAppointment(id, { status: 'cancelled' });
        await audit(req, { action: 'portal_cancel', resource: 'appointment', resourceId: id, patientId: patient.id });
        res.json({ data: appointmentOf(await findAppointment(id)), meta: { message: 'Appointment cancelled' } });
    }),
);

export const portalRoutes = router;
