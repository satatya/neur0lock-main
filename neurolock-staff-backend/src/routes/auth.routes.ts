/**
 * Authentication endpoints. The website/app talks only to this REST API; every identity decision
 * (password check against the directory, lockout, MFA, sessions, sign-up, role switching) is made
 * by the AAA server, which this API calls over mutual TLS.
 */
import { NextFunction, Request, Response, Router } from 'express';
import { aaa } from '../infra/aaa-client';
import { withTransaction } from '../infra/db/mysql-client';
import { rateLimit } from '../middlewares/rate-limit';
import { createPatient, findPatientByMrn, nextMrn } from '../repositories/patient.repository';
import { audit } from '../services/audit.service';
import { invalidateDirectoryCache, mirrorAccount, mirrorUser } from '../services/directory.service';
import { AaaUser } from '../types/auth';
import { asyncHandler, badRequest } from '../utils/http';
import { dateStr, oneOf, str } from '../utils/validate';
import { proxy } from './aaa-proxy';

const router = Router();

const loginLimiter = rateLimit({ name: 'login', windowMs: 15 * 60_000, max: 30 });
const resetLimiter = rateLimit({ name: 'reset', windowMs: 15 * 60_000, max: 10 });
const signupLimiter = rateLimit({ name: 'signup', windowMs: 15 * 60_000, max: 10 });

/** Older clients send `email`; the AAA server accepts a username or an email as `identifier`. */
const identifierFromEmail = (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && req.body.identifier === undefined && req.body.email !== undefined) {
        req.body = { ...req.body, identifier: req.body.email };
    }
    next();
};

/**
 * Keeps the MySQL directory mirror current for the signed-in account and adds its clinical-record
 * id (`user.id`), which the app uses to recognise its own notes, appointments, etc.
 */
const withRecordId = async (data: any) => {
    if (!data?.user?.uid || data.mfa_required) return data;
    const id = await mirrorUser(data.user as AaaUser).catch(() => undefined);
    return { ...data, user: { ...data.user, id } };
};

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------
router.post('/login', loginLimiter, identifierFromEmail, proxy('POST', '/auth/login', { after: withRecordId }));
router.post('/mfa/verify', loginLimiter, proxy('POST', '/auth/mfa/verify', { after: withRecordId }));
router.post('/password-reset/request', resetLimiter, identifierFromEmail, proxy('POST', '/auth/password-reset/request'));
router.post('/password-reset/confirm', resetLimiter, identifierFromEmail, proxy('POST', '/auth/password-reset/confirm'));
router.post('/unlock-request', resetLimiter, identifierFromEmail, proxy('POST', '/auth/unlock-request'));

/** Roles offered on the sign-up form (administrator is never offered). */
router.get('/signup-roles', proxy('GET', '/signup/roles'));

interface SignupRole {
    name: string;
    display_name: string;
    requires_approval: boolean;
    is_patient: boolean;
}

interface SignupResult {
    uid: string;
    status: 'active' | 'pending';
    role: string;
    role_name: string;
    kind: 'staff' | 'patient';
    email: string;
    name: string;
}

/**
 * Self-service sign-up. The account is created in the directory by the AAA server:
 *  - patients are active immediately and get (or link to) a patient record here;
 *  - clinical staff stay pending until an administrator approves them.
 */
router.post(
    '/signup',
    signupLimiter,
    asyncHandler(async (req, res) => {
        const roleName = String(req.body?.role ?? '').trim().toLowerCase();
        const { data: roles } = await aaa<SignupRole[]>('GET', '/signup/roles');
        const role = roles.find((r) => r.name === roleName);
        if (!role) throw badRequest('Choose one of the available roles', { field: 'role' });

        let linkPatientId: number | null = null;
        let dob: string | null | undefined;
        let gender: string | undefined;
        if (role.is_patient) {
            dob = dateStr(req.body, 'dob', { required: true, label: 'Date of birth' });
            if (dob && dob > new Date().toISOString().slice(0, 10)) throw badRequest('Date of birth cannot be in the future', { field: 'dob' });
            gender = oneOf(req.body, 'gender', ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'] as const);
            const mrn = str(req.body, 'mrn', { max: 32, label: 'MRN' });
            if (mrn) {
                // Linking to an existing record needs the MRN and the matching date of birth.
                const existing = await findPatientByMrn(mrn.toUpperCase());
                const recordDob = existing?.dob ? new Date(existing.dob as any).toISOString().slice(0, 10) : null;
                if (!existing || recordDob !== dob || existing.account_uid) {
                    throw badRequest('We could not match that MRN and date of birth to a patient record without an account. Leave the MRN empty to register as a new patient.', { field: 'mrn' });
                }
                linkPatientId = existing.id;
            }
        }

        const { data: account } = await aaa<SignupResult>('POST', '/signup', {
            req,
            token: null,
            body: {
                role: role.name,
                username: req.body?.username,
                email: req.body?.email,
                name: req.body?.name,
                phone: req.body?.phone,
                password: req.body?.password,
                licence_number: req.body?.licence_number,
                justification: req.body?.justification,
            },
        });

        let patientId: number | null = null;
        if (role.is_patient) {
            try {
                patientId = await withTransaction(async (connection) => {
                    if (linkPatientId) {
                        const [result]: any = await connection.execute('UPDATE patients SET account_uid = ? WHERE id = ? AND account_uid IS NULL', [account.uid, linkPatientId]);
                        if (result.affectedRows !== 1) throw badRequest('That patient record is already linked to an account', { field: 'mrn' });
                        return linkPatientId;
                    }
                    return null;
                });
                if (!patientId) {
                    patientId = await createPatient(
                        { mrn: await nextMrn(), full_name: account.name, email: account.email, phone: str(req.body, 'phone', { max: 30 }) ?? null, dob, gender: gender ?? null, status: 'active', priority: 'low', account_uid: account.uid },
                        null,
                    );
                }
            } catch (error) {
                // Undo the directory account so the person can simply try again.
                await aaa('DELETE', `/signup/${encodeURIComponent(account.uid)}`, { req, token: null }).catch(() => undefined);
                throw error;
            }
            await mirrorAccount({ uid: account.uid, name: account.name, email: account.email, role: account.role, role_name: account.role_name, kind: 'patient' });
            await audit(req, {
                actor: account.email,
                actorUid: account.uid,
                actorRole: account.role,
                action: linkPatientId ? 'patient_account_linked' : 'patient_self_registered',
                resource: 'patient',
                resourceId: patientId,
                patientId,
                severity: linkPatientId ? 'medium' : 'low',
            });
        } else {
            invalidateDirectoryCache();
        }

        res.status(201).json({
            data: { ...account, patient_id: patientId },
            meta: {
                message:
                    account.status === 'pending'
                        ? 'Account created. An administrator must approve your access before you can sign in.'
                        : 'Account created. You can sign in now.',
            },
        });
    }),
);

// ---------------------------------------------------------------------------
// Authenticated endpoints (the AAA server validates the session)
// ---------------------------------------------------------------------------
router.post('/logout', proxy('POST', '/auth/logout'));
router.get('/me', proxy('GET', '/auth/me', { after: withRecordId }));
router.post('/step-up', loginLimiter, proxy('POST', '/auth/step-up'));
router.post('/change-password', proxy('POST', '/auth/change-password'));
router.post('/mfa/setup', proxy('POST', '/auth/mfa/setup'));
router.post('/mfa/enable', proxy('POST', '/auth/mfa/enable'));
router.post('/mfa/disable', proxy('POST', '/auth/mfa/disable'));
router.post('/mfa/backup-codes', proxy('POST', '/auth/mfa/backup-codes'));
router.put('/settings', proxy('PUT', '/auth/settings'));

/** Administrators only: roles they can switch their view to (including Administrator). */
router.get('/act-as/roles', proxy('GET', '/act-as/roles'));
/** Administrators only: view the app as another role ({ role: null } returns to the own role). */
router.post('/act-as', proxy('POST', '/auth/act-as', { after: withRecordId }));

export const authRoutes = router;
