import { Router } from 'express';
import { P } from '../config/permissions';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import { createAssessment, deleteById, findAssessment, listAssessments, updateAssessment } from '../repositories/clinical.repository';
import { patientExists } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, scopeFor } from '../services/care-scope';
import { asyncHandler, badRequest, notFound, parseId } from '../utils/http';
import { dateStr, nullableStr, oneOf, requiredStr, str } from '../utils/validate';

const router = Router();
router.use(authenticate);

const STATUSES = ['scheduled', 'pending', 'completed', 'cancelled'] as const;

router.get(
    '/',
    requirePermission(P.ASSESSMENTS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        const status = oneOf(req.query as Record<string, unknown>, 'status', STATUSES);
        await assertPatientAccess(req, patientId);
        const assessments = await listAssessments({ patientId, status }, scopeFor(req));
        res.json({ data: assessments, meta: { count: assessments.length } });
    }),
);

router.get(
    '/:id',
    requirePermission(P.ASSESSMENTS_READ),
    asyncHandler(async (req, res) => {
        const assessment: any = await findAssessment(parseId(req.params.id));
        if (!assessment) throw notFound('Assessment');
        await assertPatientAccess(req, assessment.patient_id);
        res.json({ data: assessment });
    }),
);

router.post(
    '/',
    requirePermission(P.ASSESSMENTS_CREATE),
    asyncHandler(async (req, res) => {
        const body = { ...req.body, assessment_type: req.body?.assessment_type ?? req.body?.type, scheduled_date: req.body?.scheduled_date ?? req.body?.date };
        const patientId = parseId(body.patient_id, 'patient_id');
        if (!(await patientExists(patientId))) throw notFound('Patient');
        await assertPatientAccess(req, patientId);
        const id = await createAssessment(
            {
                patient_id: patientId,
                assessment_type: requiredStr(body, 'assessment_type', { max: 255, label: 'Assessment type' }),
                status: oneOf(body, 'status', STATUSES) ?? 'scheduled',
                scheduled_date: dateStr(body, 'scheduled_date', { label: 'Scheduled date' }),
                notes: str(body, 'notes', { max: 5000 }) ?? str(body, 'assessment_notes', { max: 5000 }),
            },
            req.user!,
        );
        await audit(req, { action: 'create', resource: 'assessment', resourceId: id, patientId });
        res.status(201).json({ data: await findAssessment(id), meta: { message: 'Assessment scheduled' } });
    }),
);

router.put(
    '/:id',
    requirePermission(P.ASSESSMENTS_UPDATE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const existing: any = await findAssessment(id);
        if (!existing) throw notFound('Assessment');
        await assertPatientAccess(req, existing.patient_id);
        const updates = {
            assessment_type: str(req.body, 'assessment_type', { max: 255, label: 'Assessment type' }),
            status: oneOf(req.body, 'status', STATUSES),
            scheduled_date: dateStr(req.body, 'scheduled_date', { label: 'Scheduled date' }),
            score: nullableStr(req.body, 'score', { max: 50 }),
            notes: nullableStr(req.body, 'notes', { max: 5000 }),
        };
        if (Object.values(updates).every((value) => value === undefined)) throw badRequest('No changes supplied');
        await updateAssessment(id, updates);
        await audit(req, { action: 'update', resource: 'assessment', resourceId: id, patientId: existing.patient_id, details: { status: updates.status } });
        res.json({ data: await findAssessment(id), meta: { message: 'Assessment updated' } });
    }),
);

router.delete(
    '/:id',
    requirePermission(P.ASSESSMENTS_DELETE),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const existing: any = await findAssessment(id);
        if (!existing) throw notFound('Assessment');
        await assertPatientAccess(req, existing.patient_id);
        await deleteById('assessments', id);
        await audit(req, { action: 'delete', resource: 'assessment', resourceId: id, patientId: existing.patient_id, severity: 'low' });
        res.json({ meta: { message: 'Assessment deleted' } });
    }),
);

export const assessmentRoutes = router;
