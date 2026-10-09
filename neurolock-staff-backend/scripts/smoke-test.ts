/**
 * End-to-end check against a running API (npm run dev) and a freshly set-up database.
 *
 *   npm run smoke                       (API_URL defaults to http://localhost:4311/api)
 *
 * Needs the whole stack: MySQL, the AAA server (OpenLDAP + rsyslog behind it) and the API.
 *
 * Verifies: every demo login (identity from the directory), the permission matrix per role, sign-up
 * (patients active immediately, staff pending until approved, then auto-login into their role),
 * administrator role switching, the patient portal, dynamic permission changes, step-up
 * re-authentication, encrypted notes, break-glass access, lockout/unlock, TOTP MFA and accounting.
 */
import crypto from 'crypto';

const API = process.env.API_URL || 'http://localhost:4311/api';
const PASSWORD = 'Demo@1234';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the MFA checks. */
function totp(secretBase32: string, at = Date.now()): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
    const hmac = crypto.createHmac('sha1', key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, extra?: unknown) {
    if (condition) {
        passed += 1;
        console.log(`  ✓ ${name}`);
    } else {
        failed += 1;
        console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
    }
}

interface Result {
    status: number;
    body: any;
}

async function call(method: string, path: string, options: { token?: string; stepUp?: string; body?: unknown } = {}): Promise<Result> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.stepUp) headers['X-Step-Up-Token'] = options.stepUp;
    const response = await fetch(`${API}${path}`, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    let body: any = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { status: response.status, body };
}

async function login(identifier: string, password = PASSWORD) {
    return call('POST', '/auth/login', { body: { identifier, password } });
}

async function stepUp(token: string, password = PASSWORD) {
    const result = await call('POST', '/auth/step-up', { token, body: { password } });
    return result.body?.data?.step_up_token as string;
}

/** Endpoint probes: [label, method, path, permission that should decide access] */
const PROBES: [string, string, string, string][] = [
    ['list patients', 'GET', '/patients', 'patients:read'],
    ['list therapy notes', 'GET', '/therapy-notes', 'notes:read'],
    ['list assessments', 'GET', '/assessments', 'assessments:read'],
    ['list medications', 'GET', '/medications', 'medications:read'],
    ['medication schedule', 'GET', '/medications/schedule', 'medications:read'],
    ['list appointments', 'GET', '/appointments', 'appointments:read'],
    ['session logs', 'GET', '/sessions', 'sessions:read'],
    ['vitals', 'GET', '/vitals', 'vitals:read'],
    ['patient alerts', 'GET', '/alerts', 'alerts:read'],
    ['reports', 'GET', '/reports', 'reports:read'],
    ['staff list', 'GET', '/staff', 'staff:read'],
    ['audit log', 'GET', '/audit', 'audit:read'],
    ['security overview', 'GET', '/security/overview', 'security:read'],
];

async function main() {
    console.log(`Smoke test against ${API}\n`);
    const health = await call('GET', '/health');
    check('API health: database and AAA server connected', health.status === 200 && health.body?.database === 'connected' && health.body?.aaa === 'connected', health.body);
    check('AAA reports the directory (LDAP) connected', health.body?.directory === 'connected', health.body);
    check('AAA reports the log server state', ['connected', 'disabled'].includes(health.body?.log_server), health.body);

    // ---------------------------------------------------------------- logins
    console.log('\nLogins and permission matrix');
    const tokens: Record<string, string> = {};
    const permissions: Record<string, string[]> = {};
    for (const role of ['admin', 'psychiatrist', 'psychologist', 'therapist', 'nurse']) {
        const result = await login(role);
        const data = result.body?.data;
        check(`${role} logs in by username straight into the "${role}" role`, result.status === 200 && Boolean(data?.token) && data?.user?.role === role, result.body);
        tokens[role] = data?.token;
        const me = await call('GET', '/auth/me', { token: tokens[role] });
        permissions[role] = me.body?.data?.permissions ?? [];
        check(`${role} /auth/me returns permissions`, me.status === 200 && permissions[role].length > 0);

        for (const [label, method, path, permission] of PROBES) {
            const response = await call(method, path, { token: tokens[role] });
            const expected = permissions[role].includes(permission) ? 200 : 403;
            check(`${role}: ${label} -> ${expected}`, response.status === expected, { got: response.status });
        }
    }

    check('therapist cannot schedule assessments but psychologist can', !permissions.therapist.includes('assessments:create') && permissions.psychologist.includes('assessments:create'));
    check('psychologist cannot prescribe but psychiatrist can', !permissions.psychologist.includes('medications:prescribe') && permissions.psychiatrist.includes('medications:prescribe'));
    check('nurse cannot read therapy notes', !permissions.nurse.includes('notes:read'));

    const byEmail = await login('therapist@neurolock.com');
    check('login by email also works', byEmail.status === 200 && byEmail.body?.data?.user?.uid === 'therapist');
    const wrong = await login('therapist', 'wrong-password-1');
    check('wrong password is rejected with 401', wrong.status === 401 && wrong.body?.error?.code === 'INVALID_CREDENTIALS');
    const noAuth = await call('GET', '/patients');
    check('requests without a token are rejected', noAuth.status === 401);
    const signupRoles = (await call('GET', '/auth/signup-roles')).body?.data ?? [];
    check('sign-up offers patient and clinical roles but never admin', signupRoles.some((r: any) => r.name === 'patient') && signupRoles.some((r: any) => r.name === 'therapist') && !signupRoles.some((r: any) => r.name === 'admin'));
    const adminSignup = await call('POST', '/auth/signup', { body: { username: 'sneaky.admin', email: 'sneaky@example.org', name: 'Sneaky', password: 'Abcdefg12', role: 'admin' } });
    check('signing up as admin is refused (400)', adminSignup.status === 400);

    // ------------------------------------------------ write-level permissions
    console.log('\nWrite permissions');
    const patients = (await call('GET', '/patients', { token: tokens.psychiatrist })).body.data;
    const riya = patients.find((p: any) => p.mrn === 'MRN001');
    check('patient list masks sensitive fields by default', riya && riya.dob === null && riya.sensitive_masked === true);

    const assessmentBody = { patient_id: riya.id, assessment_type: 'PHQ-9', scheduled_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) };
    const therapistAssessment = await call('POST', '/assessments', { token: tokens.therapist, body: assessmentBody });
    check('therapist is denied scheduling an assessment (403)', therapistAssessment.status === 403);
    const psychologistAssessment = await call('POST', '/assessments', { token: tokens.psychologist, body: assessmentBody });
    check('psychologist can schedule an assessment (201)', psychologistAssessment.status === 201);

    const rx = { patient_id: riya.id, name: 'Melatonin', dose: '3mg', frequency: 'At night', scheduled_times: '22:00' };
    check('psychologist is denied prescribing (403)', (await call('POST', '/medications', { token: tokens.psychologist, body: rx })).status === 403);
    const prescribed = await call('POST', '/medications', { token: tokens.psychiatrist, body: rx });
    check('psychiatrist can prescribe (201)', prescribed.status === 201);
    const administer = await call('POST', `/medications/${prescribed.body?.data?.id}/administer`, { token: tokens.nurse, body: { scheduled_time: '22:00', status: 'given' } });
    check('nurse can record a dose (201)', administer.status === 201);
    check('psychiatrist cannot record a dose (403)', (await call('POST', `/medications/${prescribed.body?.data?.id}/administer`, { token: tokens.psychiatrist, body: { scheduled_time: '22:00' } })).status === 403);
    await call('PUT', `/medications/${prescribed.body?.data?.id}`, { token: tokens.psychiatrist, body: { status: 'discontinued' } });

    const vitals = await call('POST', '/vitals', { token: tokens.nurse, body: { patient_id: riya.id, heart_rate: 74, bp_systolic: 121, bp_diastolic: 79 } });
    check('nurse can record vitals (201)', vitals.status === 201);
    check('therapist cannot record vitals (403)', (await call('POST', '/vitals', { token: tokens.therapist, body: { patient_id: riya.id, heart_rate: 70 } })).status === 403);

    const session = await call('POST', '/sessions', { token: tokens.therapist, body: { patient_id: riya.id, session_type: 'Individual', duration_min: 50, summary: 'Smoke test session', progress_score: 72 } });
    check('therapist can log a session with progress (201)', session.status === 201);

    const appt = await call('POST', '/appointments', {
        token: tokens.therapist,
        body: { patient_id: riya.id, scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), appointment_type: 'Therapy session', reason: 'Smoke test' },
    });
    check('therapist can schedule an appointment (201)', appt.status === 201);
    check('nurse cannot schedule an appointment (403)', (await call('POST', '/appointments', { token: tokens.nurse, body: { patient_id: riya.id, scheduled_at: new Date(Date.now() + 86_400_000).toISOString() } })).status === 403);

    const report = await call('POST', '/reports', { token: tokens.psychiatrist, body: { patient_id: riya.id, report_type: 'clinical-summary' } });
    check('psychiatrist can generate a report (201)', report.status === 201 && report.body?.data?.content?.patient?.mrn === 'MRN001');

    // ------------------------------------------------ encrypted notes + step-up
    console.log('\nTherapy notes, step-up and break-glass');
    const created = await call('POST', '/therapy-notes', {
        token: tokens.psychiatrist,
        body: { patient_id: riya.id, note_type: 'Consultation', content: { mood: 'Stable', notes: 'Smoke-test note content' } },
    });
    check('psychiatrist creates an encrypted note (201)', created.status === 201);
    const noteId = created.body?.data?.id;
    const withoutStepUp = await call('GET', `/therapy-notes/${noteId}`, { token: tokens.psychiatrist });
    check('reading a note without re-authentication is refused (STEP_UP_REQUIRED)', withoutStepUp.status === 401 && withoutStepUp.body?.error?.code === 'STEP_UP_REQUIRED');
    const psychStepUp = await stepUp(tokens.psychiatrist);
    check('step-up with the correct password succeeds', Boolean(psychStepUp));
    const readNote = await call('GET', `/therapy-notes/${noteId}`, { token: tokens.psychiatrist, stepUp: psychStepUp });
    check('note decrypts after step-up', readNote.status === 200 && readNote.body?.data?.content?.notes === 'Smoke-test note content');
    const badStepUp = await call('POST', '/auth/step-up', { token: tokens.psychologist, body: { password: 'nope-12345' } });
    check('step-up with a wrong password fails', badStepUp.status === 401);

    const nurseStepUp = await stepUp(tokens.nurse);
    const nurseRead = await call('GET', `/therapy-notes/${noteId}`, { token: tokens.nurse, stepUp: nurseStepUp });
    check('nurse cannot read the note without emergency access (403)', nurseRead.status === 403);
    const shortReason = await call('POST', '/therapy-notes/emergency-access', { token: tokens.nurse, stepUp: nurseStepUp, body: { patient_id: riya.id, reason: 'urgent' } });
    check('emergency access requires a proper justification (400)', shortReason.status === 400);
    const grant = await call('POST', '/therapy-notes/emergency-access', {
        token: tokens.nurse,
        stepUp: nurseStepUp,
        body: { patient_id: riya.id, reason: 'Patient acutely agitated; need recent therapy context for safe handover.' },
    });
    check('nurse obtains break-glass access (201)', grant.status === 201);
    const emergencyRead = await call('GET', `/therapy-notes/${noteId}`, { token: tokens.nurse, stepUp: nurseStepUp });
    check('nurse can read the note under emergency access', emergencyRead.status === 200);
    const adminNotes = await call('GET', '/therapy-notes', { token: tokens.admin });
    check('admin cannot list therapy notes (403)', adminNotes.status === 403);

    // ------------------------------------------------ dynamic permissions
    console.log('\nDynamic role permissions (admin edits take effect immediately)');
    const roles = (await call('GET', '/roles', { token: tokens.admin })).body?.data ?? [];
    check('roles are read from the directory', roles.some((r: any) => r.name === 'therapist') && roles.some((r: any) => r.name === 'patient'));
    const noStepUpToggle = await call('PUT', `/roles/therapist/permissions/assessments:create`, { token: tokens.admin, body: { granted: true } });
    check('editing role permissions requires re-authentication', noStepUpToggle.status === 401 && noStepUpToggle.body?.error?.code === 'STEP_UP_REQUIRED');
    const adminStepUp = await stepUp(tokens.admin);
    const grantToggle = await call('PUT', `/roles/therapist/permissions/assessments:create`, { token: tokens.admin, stepUp: adminStepUp, body: { granted: true } });
    check('admin grants assessments:create to therapist', grantToggle.status === 200 && grantToggle.body?.data?.permissions?.includes('assessments:create'));
    const nowAllowed = await call('POST', '/assessments', { token: tokens.therapist, body: assessmentBody });
    check('therapist can now schedule an assessment without re-login (201)', nowAllowed.status === 201);
    await call('PUT', `/roles/therapist/permissions/assessments:create`, { token: tokens.admin, stepUp: adminStepUp, body: { granted: false } });
    const deniedAgain = await call('POST', '/assessments', { token: tokens.therapist, body: assessmentBody });
    check('after revoking, therapist is denied again (403)', deniedAgain.status === 403);
    const lockoutGuard = await call('PUT', `/roles/admin/permissions/roles:manage`, { token: tokens.admin, stepUp: adminStepUp, body: { granted: false } });
    check('removing the last roles:manage holder is prevented (409)', lockoutGuard.status === 409 && lockoutGuard.body?.error?.code === 'LOCKOUT_PREVENTED');
    const nonAdminEdit = await call('PUT', `/roles/therapist/permissions/notes:delete`, { token: tokens.psychiatrist, body: { granted: true } });
    check('non-admins cannot edit roles (403)', nonAdminEdit.status === 403);

    // ------------------------------------------------ staff management, lockout, MFA
    console.log('\nStaff management, lockout and MFA');
    const stamp = Date.now().toString(36);
    const tempEmail = `smoke.${stamp}@neurolock.com`;
    const createdStaff = await call('POST', '/staff', { token: tokens.admin, body: { username: `smoke.${stamp}`, name: 'Smoke Tester', email: tempEmail, password: 'Temp@12345', role: 'therapist' } });
    check('admin creates a staff account (201)', createdStaff.status === 201, createdStaff.body);
    const tempId = createdStaff.body?.data?.uid;
    check('non-admin cannot create staff (403)', (await call('POST', '/staff', { token: tokens.nurse, body: { username: 'xx.nurse', name: 'X', email: 'x@neurolock.com', password: 'Temp@12345', role: 'nurse' } })).status === 403);

    let last: Result = { status: 0, body: null };
    for (let i = 0; i < 5; i += 1) last = await login(tempEmail, 'Wrong@1234');
    check('5 wrong passwords lock the account (423)', last.status === 423 && last.body?.error?.code === 'ACCOUNT_LOCKED', last.body);
    const lockedLogin = await login(tempEmail, 'Temp@12345');
    check('correct password is refused while locked (423)', lockedLogin.status === 423);
    const unlock = await call('POST', `/staff/${tempId}/unlock`, { token: tokens.admin });
    check('admin unlocks the account', unlock.status === 200);
    const tempLogin = await login(tempEmail, 'Temp@12345');
    check('login works after unlock', tempLogin.status === 200);
    const tempToken = tempLogin.body?.data?.token;

    const setup = await call('POST', '/auth/mfa/setup', { token: tempToken });
    const secret = setup.body?.data?.secret;
    check('MFA setup returns a TOTP secret', Boolean(secret) && setup.body?.data?.otpauth_url?.startsWith('otpauth://'));
    const enable = await call('POST', '/auth/mfa/enable', { token: tempToken, body: { code: totp(secret) } });
    const backupCodes: string[] = enable.body?.data?.backup_codes ?? [];
    check('MFA enable returns 10 backup codes', enable.status === 200 && backupCodes.length === 10);
    const mfaLogin = await login(tempEmail, 'Temp@12345');
    check('password login now requires a second factor', mfaLogin.status === 200 && mfaLogin.body?.data?.mfa_required === true);
    const badCode = await call('POST', '/auth/mfa/verify', { body: { mfa_token: mfaLogin.body?.data?.mfa_token, code: '000000' } });
    check('wrong TOTP code is rejected', badCode.status === 401);
    const goodCode = await call('POST', '/auth/mfa/verify', { body: { mfa_token: mfaLogin.body?.data?.mfa_token, code: totp(secret) } });
    check('correct TOTP code completes login', goodCode.status === 200 && Boolean(goodCode.body?.data?.token));
    const backupLogin = await login(tempEmail, 'Temp@12345');
    const viaBackup = await call('POST', '/auth/mfa/verify', { body: { mfa_token: backupLogin.body?.data?.mfa_token, backup_code: backupCodes[0] } });
    check('a backup code completes login', viaBackup.status === 200);
    const reuse = await login(tempEmail, 'Temp@12345');
    const reused = await call('POST', '/auth/mfa/verify', { body: { mfa_token: reuse.body?.data?.mfa_token, backup_code: backupCodes[0] } });
    check('a backup code cannot be reused', reused.status === 401);

    const logout = await call('POST', '/auth/logout', { token: tempToken });
    check('logout succeeds', logout.status === 200);
    check('token is unusable after logout', (await call('GET', '/auth/me', { token: tempToken })).status === 401);

    const deactivate = await call('DELETE', `/staff/${tempId}`, { token: tokens.admin });
    check('admin deactivates the account', deactivate.status === 200);
    check('deactivated account cannot log in (403)', (await login(tempEmail, 'Temp@12345')).status === 403);

    // ------------------------------------------------ sign-up and approval
    console.log('\nSign-up, approval and automatic role login');
    const patientUser = `pat.${stamp}`;
    const patientSignup = await call('POST', '/auth/signup', {
        body: { role: 'patient', username: patientUser, name: 'Smoke Patient', email: `${patientUser}@example.org`, password: 'Patient123', dob: '1990-04-02', gender: 'Female' },
    });
    check('patient sign-up is active immediately and creates a patient record', patientSignup.status === 201 && patientSignup.body?.data?.status === 'active' && Boolean(patientSignup.body?.data?.patient_id), patientSignup.body);
    const patientLogin = await login(patientUser, 'Patient123');
    check('new patient logs straight into the Patient role', patientLogin.status === 200 && patientLogin.body?.data?.user?.role === 'patient');
    const newPatientToken = patientLogin.body?.data?.token;
    const ownRecord = await call('GET', '/portal/me', { token: newPatientToken });
    check('new patient sees their own (new) record in the portal', ownRecord.status === 200 && ownRecord.body?.data?.patient?.full_name === 'Smoke Patient');
    const linkWrongDob = await call('POST', '/auth/signup', {
        body: { role: 'patient', username: `link.${stamp}`, name: 'Arjun Mehta', email: `link.${stamp}@example.org`, password: 'Patient123', dob: '2000-01-01', mrn: 'MRN002' },
    });
    check('linking an existing record needs the matching date of birth (400)', linkWrongDob.status === 400);

    const staffUser = `ther.${stamp}`;
    const noLicence = await call('POST', '/auth/signup', { body: { role: 'therapist', username: staffUser, name: 'New Therapist', email: `${staffUser}@clinic.org`, password: 'Therapist123' } });
    check('clinical sign-up requires a licence number (400)', noLicence.status === 400);
    const staffSignup = await call('POST', '/auth/signup', {
        body: { role: 'therapist', username: staffUser, name: 'New Therapist', email: `${staffUser}@clinic.org`, password: 'Therapist123', licence_number: 'RCI-SMOKE-1', justification: 'Joining the outpatient team' },
    });
    check('therapist sign-up is pending approval', staffSignup.status === 201 && staffSignup.body?.data?.status === 'pending', staffSignup.body);
    const pendingLogin = await login(staffUser, 'Therapist123');
    check('pending account cannot sign in (ACCOUNT_PENDING)', pendingLogin.status === 403 && pendingLogin.body?.error?.code === 'ACCOUNT_PENDING');
    const signups = (await call('GET', '/staff/signups', { token: tokens.admin })).body?.data ?? [];
    const pending = signups.find((row: any) => row.uid === staffUser);
    check('admin sees the pending sign-up with the requested role', pending?.requested_role === 'therapist');
    check('non-admins cannot approve sign-ups (403)', (await call('POST', `/staff/signups/${pending?.id}/approve`, { token: tokens.psychiatrist })).status === 403);
    const approve = await call('POST', `/staff/signups/${pending?.id}/approve`, { token: tokens.admin, body: {} });
    check('admin approves the sign-up', approve.status === 200);
    const approvedLogin = await login(staffUser, 'Therapist123');
    check('approved therapist logs straight into the Therapist role (no role picker)', approvedLogin.status === 200 && approvedLogin.body?.data?.user?.role === 'therapist' && approvedLogin.body?.data?.user?.can_act_as === false);
    const newTherapistToken = approvedLogin.body?.data?.token;
    const newTherapistPatients = await call('GET', '/patients', { token: newTherapistToken });
    check('new therapist sees no patients until assigned (care-team scoping)', newTherapistPatients.status === 200 && newTherapistPatients.body?.data?.length === 0 && newTherapistPatients.body?.meta?.scope === 'care_team', newTherapistPatients.body?.data?.map((p: any) => p.mrn));
    check('new therapist cannot schedule assessments (403)', (await call('POST', '/assessments', { token: newTherapistToken, body: assessmentBody })).status === 403);
    const directory = (await call('GET', '/staff/directory', { token: tokens.psychiatrist })).body?.data ?? [];
    check('approved therapist appears in the clinician directory', directory.some((d: any) => d.uid === staffUser && d.bookable));

    // ------------------------------------------------ administrator role switching
    console.log('\nAdministrator role switching');
    const actRoles = (await call('GET', '/auth/act-as/roles', { token: tokens.admin })).body?.data ?? [];
    check('admin can choose any role including Administrator', ['admin', 'psychiatrist', 'therapist', 'nurse', 'patient'].every((name) => actRoles.some((r: any) => r.name === name)));
    check('non-admins cannot switch roles (403)', (await call('GET', '/auth/act-as/roles', { token: tokens.therapist })).status === 403);
    const asTherapist = await call('POST', '/auth/act-as', { token: tokens.admin, body: { role: 'therapist' } });
    check('admin switches to the Therapist view', asTherapist.status === 200 && asTherapist.body?.data?.user?.role === 'therapist');
    check('as therapist the admin gets therapist permissions (notes list 200)', (await call('GET', '/therapy-notes', { token: tokens.admin })).status === 200);
    check('as therapist the admin loses admin permissions (staff list 403)', (await call('GET', '/staff', { token: tokens.admin })).status === 403);
    const asPatient = await call('POST', '/auth/act-as', { token: tokens.admin, body: { role: 'patient' } });
    check('admin switches to the Patient view (demo patient)', asPatient.status === 200 && asPatient.body?.data?.user?.portal_uid === 'patient');
    const preview = await call('GET', '/portal/me', { token: tokens.admin });
    check('patient view shows the demo patient record', preview.status === 200 && preview.body?.data?.patient?.mrn === 'MRN001' && preview.body?.data?.preview === true);
    const backToAdmin = await call('POST', '/auth/act-as', { token: tokens.admin, body: { role: null } });
    check('admin returns to the Administrator role', backToAdmin.status === 200 && backToAdmin.body?.data?.user?.role === 'admin' && (backToAdmin.body?.data?.permissions ?? []).includes('roles:manage'));
    check('admin permissions are back (staff list 200)', (await call('GET', '/staff', { token: tokens.admin })).status === 200);

    // ------------------------------------------------ patient portal
    console.log('\nPatient portal');
    const patientDemo = await login('patient');
    const patientToken = patientDemo.body?.data?.token;
    check('demo patient logs into the Patient role', patientDemo.status === 200 && patientDemo.body?.data?.user?.role === 'patient');
    const me = await call('GET', '/portal/me', { token: patientToken });
    check('patient sees their own profile (Riya Jain, MRN001)', me.status === 200 && me.body?.data?.patient?.mrn === 'MRN001');
    check('patient profile has no diagnosis or ward data', me.body?.data?.patient && !('primary_diagnosis' in me.body.data.patient) && !('ward' in me.body.data.patient));
    const meds = await call('GET', '/portal/medications', { token: patientToken });
    check('patient sees current medications', meds.status === 200 && meds.body?.data?.some((m: any) => m.name === 'Sertraline'));
    const results = await call('GET', '/portal/assessments', { token: patientToken });
    check('patient sees assessment results without clinician notes', results.status === 200 && results.body?.data?.some((a: any) => a.score === '24') && results.body.data.every((a: any) => !('notes' in a)));
    for (const [label, path] of [['patient list', '/patients'], ['therapy notes', '/therapy-notes'], ['all appointments', '/appointments'], ['audit log', '/audit']]) {
        check(`patient is denied ${label} (403)`, (await call('GET', path, { token: patientToken })).status === 403);
    }
    check('staff cannot use the patient portal (403)', (await call('GET', '/portal/me', { token: tokens.nurse })).status === 403);
    const clinicians = (await call('GET', '/portal/clinicians', { token: patientToken })).body?.data ?? [];
    const bookWith = clinicians.find((c: any) => c.role === 'therapist');
    check('bookable clinicians exclude nurses and administrators', Boolean(bookWith) && !clinicians.some((c: any) => c.role === 'nurse' || c.role === 'admin'));
    const slot = new Date(Date.now() + 9 * 86_400_000);
    slot.setUTCHours(10, 0, 0, 0);
    const booked = await call('POST', '/portal/appointments', { token: patientToken, body: { staff_id: bookWith?.id, scheduled_at: slot.toISOString(), appointment_type: 'Therapy session', reason: 'Smoke booking' } });
    check('patient books an appointment (201)', booked.status === 201 && booked.body?.data?.can_cancel === true, booked.body);
    const clash = await call('POST', '/portal/appointments', { token: newPatientToken, body: { staff_id: bookWith?.id, scheduled_at: new Date(slot.getTime() + 20 * 60_000).toISOString() } });
    check('overlapping booking with the same clinician is refused (409)', clash.status === 409);
    const past = await call('POST', '/portal/appointments', { token: patientToken, body: { staff_id: bookWith?.id, scheduled_at: new Date(Date.now() - 86_400_000).toISOString() } });
    check('booking in the past is refused (400)', past.status === 400);
    const othersAppt = await call('POST', `/portal/appointments/${booked.body?.data?.id}/cancel`, { token: newPatientToken });
    check("a patient cannot cancel someone else's appointment (404)", othersAppt.status === 404);
    const cancelled = await call('POST', `/portal/appointments/${booked.body?.data?.id}/cancel`, { token: patientToken });
    check('patient cancels their own appointment', cancelled.status === 200 && cancelled.body?.data?.status === 'cancelled');

    // ------------------------------------------------ care-team scoping
    console.log('\nCare-team patient visibility');
    const mrnsOf = async (token: string) => ((await call('GET', '/patients', { token })).body?.data ?? []).map((p: any) => p.mrn as string);
    const allPatients = (await call('GET', '/patients', { token: tokens.admin })).body?.data ?? [];
    const byMrn = (mrn: string) => allPatients.find((p: any) => p.mrn === mrn);
    check('admin sees every patient (patients:read_all)', ['MRN001', 'MRN002', 'MRN003', 'MRN004', 'MRN005', 'MRN006'].every((m) => allPatients.some((p: any) => p.mrn === m)));
    const therapistMrns = await mrnsOf(tokens.therapist);
    check('therapist sees only their clients (MRN001, MRN003, MRN006)', ['MRN001', 'MRN003', 'MRN006'].every((m) => therapistMrns.includes(m)) && !['MRN002', 'MRN004', 'MRN005'].some((m) => therapistMrns.includes(m)), therapistMrns);
    const nurseMrns = await mrnsOf(tokens.nurse);
    check('nurse sees only the ward patients on her care team', ['MRN001', 'MRN002', 'MRN004', 'MRN006'].every((m) => nurseMrns.includes(m)) && !['MRN003', 'MRN005'].some((m) => nurseMrns.includes(m)), nurseMrns);
    const psychologistMrns = await mrnsOf(tokens.psychologist);
    check('psychologist sees only MRN001 (care team) and MRN005 (assigned)', ['MRN001', 'MRN005'].every((m) => psychologistMrns.includes(m)) && !['MRN002', 'MRN003', 'MRN004', 'MRN006'].some((m) => psychologistMrns.includes(m)), psychologistMrns);

    const meera = byMrn('MRN005');
    const outside = await call('GET', `/patients/${meera?.id}`, { token: tokens.therapist });
    check('opening a patient outside the care team is refused (403 NOT_ON_CARE_TEAM)', outside.status === 403 && outside.body?.error?.code === 'NOT_ON_CARE_TEAM');
    for (const [label, path] of [
        ['overview', `/patients/${meera?.id}/overview`],
        ['therapy notes', `/therapy-notes?patient_id=${meera?.id}`],
        ['assessments', `/assessments?patient_id=${meera?.id}`],
        ['sessions', `/sessions?patient_id=${meera?.id}`],
        ['appointments', `/appointments?patient_id=${meera?.id}`],
    ]) {
        check(`therapist is refused another clinician's patient: ${label} (403)`, (await call('GET', path, { token: tokens.therapist })).status === 403);
    }
    const therapistSessions = (await call('GET', '/sessions', { token: tokens.therapist })).body?.data ?? [];
    check('session logs only list the caller\'s patients', therapistSessions.length > 0 && !therapistSessions.some((row: any) => row.patient_mrn === 'MRN005'));
    const nurseSchedule = (await call('GET', '/medications/schedule', { token: tokens.nurse })).body?.data ?? [];
    check('nurse medication round only lists her patients', nurseSchedule.length > 0 && !nurseSchedule.some((slot: any) => ['MRN003', 'MRN005'].includes(slot.patient_mrn)));
    const writeOutside = await call('POST', '/sessions', { token: tokens.therapist, body: { patient_id: meera?.id, summary: 'should be refused' } });
    check('writing to another clinician\'s patient is refused (403)', writeOutside.status === 403);

    const roster = (await call('GET', '/staff/directory', { token: tokens.psychologist })).body?.data ?? [];
    const johnId = roster.find((d: any) => d.uid === 'therapist')?.id;
    const nurseId = roster.find((d: any) => d.uid === 'nurse')?.id;
    const created2 = await call('POST', '/patients', {
        token: tokens.psychologist,
        body: { full_name: `Care Team ${stamp}`, gender: 'Male', primary_diagnosis: 'Adjustment disorder', assigned_therapist_id: johnId, care_team_ids: [nurseId] },
    });
    const newPatient = created2.body?.data;
    check('psychologist registers a patient and assigns a therapist + nurse from the roster (201)', created2.status === 201 && newPatient?.assigned_therapist_id === johnId && newPatient?.care_team?.some((m: any) => m.id === nurseId), created2.body);
    check('the registering psychologist is on the care team automatically', newPatient?.care_team?.some((m: any) => m.uid === 'psychologist'));
    check('psychologist sees the new patient', (await mrnsOf(tokens.psychologist)).includes(newPatient?.mrn));
    check('the assigned therapist sees the new patient', (await mrnsOf(tokens.therapist)).includes(newPatient?.mrn));
    check('the nurse on the care team sees the new patient', (await mrnsOf(tokens.nurse)).includes(newPatient?.mrn));
    check('a clinician not on the care team does not (psychiatrist)', !(await mrnsOf(tokens.psychiatrist)).includes(newPatient?.mrn));
    const selfRemoval = await call('PUT', `/patients/${newPatient?.id}`, { token: tokens.psychologist, body: { care_team_ids: [nurseId] } });
    check('a clinician cannot remove themselves from the care team (409)', selfRemoval.status === 409);
    const addPsychiatrist = await call('PUT', `/patients/${newPatient?.id}`, {
        token: tokens.psychologist,
        body: { care_team_ids: [nurseId, roster.find((d: any) => d.uid === 'psychologist')?.id, roster.find((d: any) => d.uid === 'psychiatrist')?.id] },
    });
    check('adding the psychiatrist to the care team gives them access', addPsychiatrist.status === 200 && (await mrnsOf(tokens.psychiatrist)).includes(newPatient?.mrn));

    await call('POST', '/auth/act-as', { token: tokens.admin, body: { role: 'psychologist' } });
    const previewMrns = await mrnsOf(tokens.admin);
    check('admin previewing Psychologist sees the demo psychologist\'s caseload', previewMrns.includes('MRN005') && previewMrns.includes(newPatient?.mrn) && !previewMrns.includes('MRN004'), previewMrns);
    await call('POST', '/auth/act-as', { token: tokens.admin, body: { role: null } });

    // ------------------------------------------------ accounting
    console.log('\nAudit trail');
    const auditLog = await call('GET', '/audit?limit=200', { token: tokens.admin });
    const actions = new Set((auditLog.body?.data ?? []).map((row: any) => row.action));
    for (const action of ['login_success', 'login_failed', 'access_denied', 'emergency_access', 'role_permissions_changed', 'account_locked', 'read', 'signup', 'signup_approved', 'act_as', 'portal_book']) {
        check(`audit log contains "${action}"`, actions.has(action));
    }
    const alerts = await call('GET', '/security/alerts?status=unreviewed', { token: tokens.admin });
    check('security alerts include the break-glass event', (alerts.body?.data ?? []).some((a: any) => a.action === 'emergency_access'));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
