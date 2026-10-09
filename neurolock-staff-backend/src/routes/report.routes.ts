import { Request, Router } from 'express';
import { P } from '../config/permissions';
import { execute, parseJson, query, queryOne } from '../infra/db/mysql-client';
import { authenticate, can, requirePermission } from '../middlewares/auth.middleware';
import { latestVitals, listAlerts, listAssessments, listMedications, listSessions, progressHistory } from '../repositories/clinical.repository';
import { findPatientById } from '../repositories/patient.repository';
import { listNotes } from '../repositories/therapy-note.repository';
import { audit } from '../services/audit.service';
import { assertPatientAccess, patientScope } from '../services/care-scope';
import { asyncHandler, notFound, parseId } from '../utils/http';
import { oneOf } from '../utils/validate';

const router = Router();
router.use(authenticate);

const REPORT_TYPES = ['clinical-summary', 'diagnosis-report', 'treatment-progress', 'medication-review'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

/**
 * Builds a report only from data the requesting user is allowed to read; anything else is
 * listed under `omitted_sections`. Reports never include decrypted therapy-note content.
 */
async function buildReport(req: Request, patientId: number, type: ReportType) {
    const patient = await findPatientById(patientId);
    if (!patient) throw notFound('Patient');

    const omitted: string[] = [];
    const include = async <T>(name: string, permission: string, load: () => Promise<T>): Promise<T | undefined> => {
        if (can(req, permission)) return load();
        omitted.push(name);
        return undefined;
    };

    const content: Record<string, unknown> = {
        report_type: type,
        generated_at: new Date().toISOString(),
        patient: {
            id: patient.id,
            mrn: patient.mrn,
            name: patient.full_name,
            gender: patient.gender,
            status: patient.status,
            priority: patient.priority,
            primary_diagnosis: patient.primary_diagnosis,
            secondary_diagnosis: patient.secondary_diagnosis,
            ward: patient.ward,
            room: patient.room,
            attending_physician: patient.attending_physician_name,
            assigned_therapist: patient.assigned_therapist_name,
            admission_date: patient.admission_date,
        },
    };

    const sessions: any[] | undefined = ['clinical-summary', 'treatment-progress'].includes(type)
        ? await include('sessions', P.SESSIONS_READ, () => listSessions({ patientId }))
        : undefined;
    const progress: any[] | undefined = ['clinical-summary', 'treatment-progress'].includes(type)
        ? await include('progress', P.SESSIONS_READ, () => progressHistory(patientId))
        : undefined;
    const medications: any[] | undefined = ['clinical-summary', 'medication-review'].includes(type)
        ? await include('medications', P.MEDICATIONS_READ, () => listMedications({ patientId }))
        : undefined;
    const assessments: any[] | undefined = ['clinical-summary', 'diagnosis-report'].includes(type)
        ? await include('assessments', P.ASSESSMENTS_READ, () => listAssessments({ patientId }))
        : undefined;

    if (type === 'clinical-summary') {
        const notes = await include('notes', P.NOTES_READ, () => listNotes(patientId));
        const alerts = await include('alerts', P.ALERTS_READ, () => listAlerts({ patientId, status: 'open' }));
        const vitals: any[] | undefined = await include('vitals', P.VITALS_READ, latestVitals);
        content.summary = {
            sessions_total: sessions?.length,
            last_session_date: sessions?.[0]?.session_date ?? null,
            latest_progress: progress?.[0]?.score ?? null,
            therapy_notes_total: notes?.length,
            active_medications: medications?.filter((m) => m.status === 'active').map((m) => `${m.name} ${m.dose ?? ''}`.trim()),
            assessments: assessments?.map((a) => ({ type: a.assessment_type, status: a.status, date: a.scheduled_date, score: a.score })),
            open_alerts: (alerts as any[] | undefined)?.map((a) => ({ message: a.message, priority: a.priority })),
            latest_vitals: vitals?.find((v) => v.patient_id === patientId && v.id) ?? null,
        };
    }
    if (type === 'diagnosis-report') {
        content.diagnosis = {
            primary: patient.primary_diagnosis,
            secondary: patient.secondary_diagnosis,
            allergies: patient.allergies,
            assessments: assessments?.map((a) => ({ type: a.assessment_type, status: a.status, date: a.scheduled_date, score: a.score, notes: a.notes })),
        };
    }
    if (type === 'treatment-progress') {
        content.progress = {
            history: progress?.map((p) => ({ score: p.score, note: p.note, recorded_at: p.recorded_at, by: p.recorded_by_name })),
            sessions: sessions?.map((s) => ({ date: s.session_date, type: s.session_type, duration_min: s.duration_min, summary: s.summary, clinician: s.clinician_name })),
            trend: progress && progress.length >= 2 ? progress[0].score - progress[progress.length - 1].score : null,
        };
    }
    if (type === 'medication-review') {
        const adherence = await include('adherence', P.MEDICATIONS_READ, () =>
            query<{ status: string; total: number }>(
                `SELECT status, COUNT(*) AS total FROM medication_administrations
                 WHERE patient_id = ? AND administered_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY) GROUP BY status`,
                [patientId],
            ),
        );
        content.medications = {
            prescriptions: medications?.map((m) => ({
                name: m.name,
                dose: m.dose,
                frequency: m.frequency,
                route: m.route,
                status: m.status,
                start_date: m.start_date,
                prescribed_by: m.prescribed_by_name,
            })),
            administrations_last_14_days: adherence?.reduce((acc: Record<string, number>, row) => ({ ...acc, [row.status]: Number(row.total) }), {}),
        };
    }
    content.omitted_sections = omitted;
    return content;
}

router.get(
    '/',
    requirePermission(P.REPORTS_READ),
    asyncHandler(async (req, res) => {
        const patientId = req.query.patient_id ? parseId(req.query.patient_id, 'patient_id') : undefined;
        await assertPatientAccess(req, patientId);
        const scope = patientScope(req, 'r.patient_id');
        const where = [patientId ? 'r.patient_id = ?' : null, scope?.sql].filter(Boolean);
        const params = [...(patientId ? [patientId] : []), ...(scope?.params ?? [])];
        const rows = await query(
            `SELECT r.id, r.patient_id, p.full_name AS patient_name, p.mrn AS patient_mrn, r.report_type,
                    r.generated_by, r.generated_by_name, r.created_at
             FROM reports r JOIN patients p ON p.id = r.patient_id
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 100`,
            params,
        );
        res.json({ data: rows, meta: { count: rows.length } });
    }),
);

router.get(
    '/:id',
    requirePermission(P.REPORTS_READ),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id);
        const row: any = await queryOne(
            `SELECT r.*, p.full_name AS patient_name, p.mrn AS patient_mrn FROM reports r JOIN patients p ON p.id = r.patient_id WHERE r.id = ?`,
            [id],
        );
        if (!row) throw notFound('Report');
        await assertPatientAccess(req, row.patient_id);
        await audit(req, { action: 'view', resource: 'report', resourceId: id, patientId: row.patient_id });
        res.json({ data: { ...row, content: parseJson(row.content, {}) } });
    }),
);

router.post(
    '/',
    requirePermission(P.REPORTS_GENERATE),
    asyncHandler(async (req, res) => {
        const patientId = parseId(req.body?.patient_id, 'patient_id');
        const type = oneOf(req.body, 'report_type', REPORT_TYPES, { required: true, label: 'Report type' }) as ReportType;
        await assertPatientAccess(req, patientId);
        const content = await buildReport(req, patientId, type);
        const result = await execute(
            'INSERT INTO reports (patient_id, report_type, generated_by, generated_by_name, content) VALUES (?, ?, ?, ?, ?)',
            [patientId, type, req.user!.id, req.user!.name, JSON.stringify(content)],
        );
        await audit(req, { action: 'generate', resource: 'report', resourceId: result.insertId, patientId, details: { report_type: type } });
        res.status(201).json({
            data: { id: result.insertId, patient_id: patientId, report_type: type, generated_by_name: req.user!.name, created_at: new Date().toISOString(), content },
            meta: { message: 'Report generated' },
        });
    }),
);

export const reportRoutes = router;
