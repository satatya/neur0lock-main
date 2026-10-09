import { Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import { createSession, listSessions, progressHistory, progressOverview, recordProgress } from '../repositories/clinical.repository';
import { patientExists } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, scopeFor } from '../services/care-scope';
import { asyncHandler, notFound, parseId } from '../utils/http';
import { dateStr, int, oneOf, str } from '../utils/validate';

/** Therapy session logs and client progress tracking. */
const router = Router();
router.use(authenticate);

const TYPES = ['Individual', 'Group', 'Family', 'Couples', 'Assessment'] as const;

router.get(
    '/',
    requirePermission(P.SESSIONS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        const clinicianId = req.query.mine === '1' || req.query.mine === 'true' ? req.user!.id : undefined;
        await assertPatientAccess(req, patientId);
        const sessions = await listSessions({ patientId, clinicianId }, scopeFor(req));
        res.json({ data: sessions, meta: { count: sessions.length } });
    }),
);

router.get(
    '/progress',
    requirePermission(P.SESSIONS_READ),
    asyncHandler(async (req, res) => {
        const clinicianId = req.query.mine === '1' || req.query.mine === 'true' ? req.user!.id : undefined;
        const overview = await progressOverview(clinicianId, scopeFor(req));
        res.json({ data: overview, meta: { count: overview.length } });
    }),
);

router.get(
    '/progress/:patientId',
    requirePermission(P.SESSIONS_READ),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.params.patientId, 'patientId');
        await assertPatientAccess(req, patientId);
        res.json({ data: await progressHistory(patientId) });
    }),
);

router.post(
    '/',
    requirePermission(P.SESSIONS_WRITE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const progressScore = int(req.body, 'progress_score', { min: 0, max: 100, label: 'Progress' });
        const summary = str(req.body, 'summary', { max: 500, label: 'Summary' });
        const id = await createSession(
            {
                patient_id: patientId,
                session_date: dateStr(req.body, 'session_date', { label: 'Session date' }) ?? new Date().toISOString().slice(0, 10),
                duration_min: int(req.body, 'duration_min', { min: 5, max: 480, label: 'Duration' }) ?? 50,
                session_type: oneOf(req.body, 'session_type', TYPES) ?? 'Individual',
                summary,
                progress_score: progressScore ?? null,
            },
            req.user!.id,
        );
        if (progressScore !== undefined) await recordProgress(patientId, progressScore, summary ?? null, req.user!.id);
        await audit(req, { action: 'create', resource: 'therapy_session', resourceId: id, patientId });
        res.status(201).json({ data: { id }, meta: { message: 'Session logged' } });
    }),
);

router.post(
    '/progress',
    requirePermission(P.SESSIONS_WRITE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const score = int(req.body, 'score', { required: true, min: 0, max: 100, label: 'Progress' }) as number;
        const id = await recordProgress(patientId, score, str(req.body, 'note', { max: 255 }) ?? null, req.user!.id);
        await audit(req, { action: 'update_progress', resource: 'progress', resourceId: id, patientId, details: { score } });
        res.status(201).json({ data: { id, score }, meta: { message: 'Progress updated' } });
    }),
);

export const sessionRoutes = router;
