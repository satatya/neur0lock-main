import { Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import { acknowledgeAlerts, createAlert, findAlert, latestVitals, listAlerts, listVitals, recordVitals } from '../repositories/clinical.repository';
import { patientExists } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, scopeFor } from '../services/care-scope';
import { asyncHandler, badRequest, notFound, parseId } from '../utils/http';
import { num, oneOf, requiredStr, str } from '../utils/validate';

// ---------------------------------------------------------------------------
// Vital signs
// ---------------------------------------------------------------------------
export const vitalsRoutes = Router();
vitalsRoutes.use(authenticate);

vitalsRoutes.get(
    '/',
    requirePermission(P.VITALS_READ),
    asyncHandler(async (req, res) => {
        if (req.query.patient_id) {
            const patientId = parseId(req.query.patient_id, 'patient_id');
            await assertPatientAccess(req, patientId);
            const vitals = await listVitals(patientId);
            return res.json({ data: vitals, meta: { count: vitals.length } });
        }
        const latest = await latestVitals(scopeFor(req));
        res.json({ data: latest, meta: { count: latest.length } });
    }),
);

vitalsRoutes.post(
    '/',
    requirePermission(P.VITALS_RECORD),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const reading = {
            patient_id: patientId,
            heart_rate: num(req.body, 'heart_rate', { min: 20, max: 250, label: 'Heart rate' }),
            bp_systolic: num(req.body, 'bp_systolic', { min: 50, max: 260, label: 'Systolic BP' }),
            bp_diastolic: num(req.body, 'bp_diastolic', { min: 30, max: 160, label: 'Diastolic BP' }),
            temperature_c: num(req.body, 'temperature_c', { min: 30, max: 45, label: 'Temperature (°C)' }),
            respiratory_rate: num(req.body, 'respiratory_rate', { min: 4, max: 60, label: 'Respiratory rate' }),
            spo2: num(req.body, 'spo2', { min: 50, max: 100, label: 'SpO2' }),
            notes: str(req.body, 'notes', { max: 255 }),
        };
        const measured = ['heart_rate', 'bp_systolic', 'bp_diastolic', 'temperature_c', 'respiratory_rate', 'spo2'] as const;
        if (measured.every((key) => reading[key] === undefined || reading[key] === null)) {
            throw badRequest('Enter at least one measurement');
        }
        const id = await recordVitals(reading, req.user!.id);
        await audit(req, { action: 'record', resource: 'vitals', resourceId: id, patientId });
        res.status(201).json({ data: { id }, meta: { message: 'Vitals recorded' } });
    }),
);

// ---------------------------------------------------------------------------
// Patient care alerts
// ---------------------------------------------------------------------------
export const alertRoutes = Router();
alertRoutes.use(authenticate);

const PRIORITIES = ['low', 'medium', 'high'] as const;
const CATEGORIES = ['general', 'medication', 'vitals', 'lab', 'behaviour', 'safety'] as const;

alertRoutes.get(
    '/',
    requirePermission(P.ALERTS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        const status = oneOf(req.query as Record<string, unknown>, 'status', ['open', 'acknowledged', 'all'] as const) ?? 'all';
        await assertPatientAccess(req, patientId);
        const alerts = await listAlerts({ patientId, status }, scopeFor(req));
        res.json({ data: alerts, meta: { count: alerts.length } });
    }),
);

alertRoutes.post(
    '/',
    requirePermission(P.ALERTS_MANAGE),
    asyncHandler(async (req, res) => {
        let patientId: number | null = null;
        if (req.body?.patient_id) {
            patientId = parseId(req.body.patient_id, 'patient_id');
            if (!(await patientExists(patientId))) throw notFound('Patient');
            await assertPatientAccess(req, patientId);
        }
        const id = await createAlert(
            {
                patient_id: patientId,
                message: requiredStr(req.body, 'message', { max: 255, label: 'Message' }),
                priority: oneOf(req.body, 'priority', PRIORITIES) ?? 'medium',
                category: oneOf(req.body, 'category', CATEGORIES) ?? 'general',
            },
            req.user!.id,
        );
        await audit(req, { action: 'create', resource: 'patient_alert', resourceId: id, patientId });
        res.status(201).json({ data: await findAlert(id), meta: { message: 'Alert raised' } });
    }),
);

alertRoutes.post(
    '/acknowledge-all',
    requirePermission(P.ALERTS_MANAGE),
    asyncHandler(async (req, res) => {
        const count = await acknowledgeAlerts('all', req.user!.id, scopeFor(req));
        await audit(req, { action: 'acknowledge_all', resource: 'patient_alert', details: { count } });
        res.json({ meta: { message: `${count} alert(s) acknowledged`, count } });
    }),
);

alertRoutes.post(
    '/:id/acknowledge',
    requirePermission(P.ALERTS_MANAGE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const alert: any = await findAlert(id);
        if (!alert) throw notFound('Alert');
        await assertPatientAccess(req, alert.patient_id);
        await acknowledgeAlerts([id], req.user!.id);
        await audit(req, { action: 'acknowledge', resource: 'patient_alert', resourceId: id, patientId: alert.patient_id });
        res.json({ data: await findAlert(id), meta: { message: 'Alert acknowledged' } });
    }),
);
