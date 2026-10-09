import { API_BASE_URL } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountStatus = 'active' | 'inactive' | 'locked' | 'pending' | 'rejected';

/** An account in the AAA directory (staff member or patient). Accounts are keyed by username (uid). */
export interface Account {
    uid: string;
    /** Clinical-record id of the signed-in user's own account (present on login, /auth/me and act-as). */
    id?: number;
    email: string | null;
    name: string;
    phone: string | null;
    title: string | null;
    licence_number: string | null;
    /** Effective role for this session (an administrator may be viewing the app as another role). */
    role: string | null;
    role_name: string | null;
    /** Role assigned in the directory. */
    base_role: string | null;
    base_role_name: string | null;
    acting_role: string | null;
    kind: 'staff' | 'patient';
    status: AccountStatus;
    requested_role: string | null;
    mfa_enabled: boolean;
    locked_until: string | null;
    lock_reason: string | null;
    failed_login_attempts: number;
    last_login_at: string | null;
    created_at: string | null;
    /** Set when the session shows the patient portal (own record, or the demo patient for an admin preview). */
    portal_uid: string | null;
    /** Administrator previewing a clinical role: the demo account whose patients the preview shows. */
    view_as: { uid: string; name: string } | null;
    /** Administrators can switch which role they view the app as. */
    can_act_as: boolean;
}

/** @deprecated kept for older imports; accounts are now `Account`. */
export type Staff = Account;

export interface SessionPayload {
    token: string;
    expires_at: string;
    user: Account;
    permissions: string[];
}

export interface MfaChallenge {
    mfa_required: true;
    mfa_token: string;
    methods: string[];
    user: { name: string; email: string | null };
}

export interface MeResponse {
    user: Account;
    permissions: string[];
    mfa: { enabled: boolean; backup_codes_remaining: number };
    settings: UserSettings;
    password_changed_at: string | null;
}

export interface UserSettings {
    auto_lock_minutes?: number;
    language?: string;
    timezone?: string;
    date_format?: string;
    email_notifications?: boolean;
    security_alerts?: boolean;
    session_reminders?: boolean;
    login_alerts?: boolean;
}

export interface Patient {
    id: number;
    mrn: string;
    full_name: string;
    dob: string | null;
    age: number | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    insurance: string | null;
    allergies: string | null;
    primary_diagnosis: string | null;
    secondary_diagnosis: string | null;
    ward: string | null;
    room: string | null;
    status: 'active' | 'inactive' | 'critical' | 'discharged';
    priority: 'low' | 'medium' | 'high';
    attending_physician_id: number | null;
    attending_physician_name: string | null;
    assigned_therapist_id: number | null;
    assigned_therapist_name: string | null;
    admission_date: string | null;
    next_appointment_at?: string | null;
    last_session_date?: string | null;
    latest_progress?: number | null;
    sensitive_masked: boolean;
    can_view_sensitive: boolean;
    created_at: string;
    /** Extra staff who may see this patient (besides the attending physician and assigned therapist). */
    care_team?: CareTeamMember[];
}

export interface CareTeamMember {
    id: number;
    uid: string;
    name: string;
    role: string | null;
    role_name: string | null;
    /** How they joined: assigned by a clinician/admin, registered the patient, or via an appointment/booking. */
    reason: 'assigned' | 'created' | 'appointment' | 'booking';
}

export interface PatientOverview {
    patient: Patient;
    sections: {
        medications?: Medication[];
        vitals?: Vitals[];
        appointments?: Appointment[];
        sessions?: TherapySession[];
        progress?: ProgressEntry[];
        assessments?: Assessment[];
        alerts?: PatientAlert[];
        notes?: NoteMeta[];
    };
    restricted: string[];
    emergency_access_active: boolean;
}

export interface NoteContent {
    mood?: string;
    symptoms?: string;
    interventions?: string;
    treatment_plan?: string;
    notes?: string;
    next_session?: string;
}

export interface NoteMeta {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    author_id: number | null;
    author_name: string;
    note_type: string;
    session_date: string | null;
    version: number;
    created_at: string;
    updated_at: string;
}

export interface NoteDetail extends NoteMeta {
    content: NoteContent;
    can_edit: boolean;
}

export interface Medication {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
    scheduled_times: string | null;
    instructions: string | null;
    start_date: string | null;
    end_date: string | null;
    status: 'active' | 'on_hold' | 'discontinued';
    prescribed_by_name: string | null;
    created_at: string;
}

export interface ScheduleSlot {
    medication_id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    ward: string | null;
    room: string | null;
    name: string;
    dose: string | null;
    route: string | null;
    instructions: string | null;
    scheduled_time: string;
    administration: { id: number; status: string; administered_at: string; administered_by_name: string | null; notes: string | null } | null;
}

export interface Appointment {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    staff_id: number | null;
    staff_name: string | null;
    scheduled_at: string;
    duration_min: number;
    appointment_type: string;
    reason: string | null;
    status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
}

export interface TherapySession {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    clinician_name: string | null;
    session_date: string;
    duration_min: number;
    session_type: string;
    summary: string | null;
    progress_score: number | null;
}

export interface ProgressEntry {
    id: number;
    patient_id: number;
    score: number;
    note: string | null;
    recorded_by_name: string | null;
    recorded_at: string;
}

export interface ProgressOverview {
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    session_count: number;
    last_session_date: string | null;
    next_session_at: string | null;
    progress: number | null;
}

export interface Vitals {
    id: number | null;
    patient_id: number;
    patient_name?: string;
    patient_mrn?: string;
    ward?: string | null;
    room?: string | null;
    recorded_at: string | null;
    heart_rate: number | null;
    bp_systolic: number | null;
    bp_diastolic: number | null;
    temperature_c: number | null;
    respiratory_rate: number | null;
    spo2: number | null;
    notes: string | null;
    recorded_by_name: string | null;
}

export interface PatientAlert {
    id: number;
    patient_id: number | null;
    patient_name: string | null;
    message: string;
    priority: 'low' | 'medium' | 'high';
    category: string;
    created_by_name: string | null;
    created_at: string;
    acknowledged_at: string | null;
    acknowledged_by_name: string | null;
}

export interface Assessment {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    assessment_type: string;
    status: 'scheduled' | 'pending' | 'completed' | 'cancelled';
    scheduled_date: string | null;
    score: string | null;
    notes: string | null;
    scheduled_by_name: string | null;
    created_at: string;
}

export interface ReportSummary {
    id: number;
    patient_id: number;
    patient_name: string;
    patient_mrn: string;
    report_type: string;
    generated_by_name: string | null;
    created_at: string;
    content?: Record<string, any>;
}

/** A role (LDAP group). Roles are keyed by their machine name, e.g. 'therapist'. */
export interface Role {
    name: string;
    display_name: string;
    description: string | null;
    is_system: boolean;
    /** Offered on the public sign-up form. */
    signup: boolean;
    /** Self sign-ups for this role wait for administrator approval. */
    requires_approval: boolean;
    /** Accounts in this role are patients (patient portal). */
    is_patient: boolean;
    staff_count: number;
    permissions: string[];
}

export interface SignupRole {
    name: string;
    display_name: string;
    description: string | null;
    requires_approval: boolean;
    is_patient: boolean;
}

export interface SignupResult {
    uid: string;
    status: 'active' | 'pending';
    role: string;
    role_name: string;
    kind: 'staff' | 'patient';
    email: string;
    name: string;
    patient_id: number | null;
}

/** A self-service sign-up waiting for (or reviewed by) an administrator. */
export interface Signup {
    id: number;
    uid: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    requested_role: string;
    requested_role_name: string;
    status: 'pending' | 'approved' | 'rejected';
    licence_number: string | null;
    justification: string | null;
    created_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
}

export interface ActAsRole {
    name: string;
    display_name: string;
    description: string | null;
    flags: string[];
    permission_count: number;
}

export interface DirectoryEntry {
    id: number;
    uid: string;
    name: string;
    email: string | null;
    role: string;
    role_name: string;
    bookable: boolean;
}

export interface PortalAppointment {
    id: number;
    staff_id: number | null;
    clinician_name: string | null;
    scheduled_at: string;
    duration_min: number;
    appointment_type: string;
    reason: string | null;
    status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
    can_cancel: boolean;
}

export interface PortalProfile {
    id: number;
    mrn: string;
    full_name: string;
    dob: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    insurance: string | null;
    allergies: string | null;
    attending_physician_name: string | null;
    assigned_therapist_name: string | null;
    next_appointment_at: string | null;
}

export interface PortalOverview {
    patient: PortalProfile;
    upcoming_appointments: PortalAppointment[];
    active_medications: number;
    /** True when an administrator is previewing the Patient role. */
    preview: boolean;
}

export interface PortalMedication {
    id: number;
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
    scheduled_times: string | null;
    instructions: string | null;
    start_date: string | null;
    end_date: string | null;
    status: 'active' | 'on_hold';
    prescribed_by_name: string | null;
}

export interface PortalAssessment {
    id: number;
    assessment_type: string;
    status: 'scheduled' | 'pending' | 'completed';
    scheduled_date: string | null;
    score: string | null;
    scheduled_by_name: string | null;
}

export interface Clinician {
    id: number;
    name: string;
    role: string;
    role_name: string;
}

export interface PermissionDefinition {
    code: string;
    category: string;
    label: string;
    description: string | null;
}

export interface AuditEntry {
    id: number;
    ts: string;
    actor: string | null;
    actor_uid: string | null;
    actor_name: string | null;
    actor_role: string | null;
    action: string;
    resource: string;
    resource_id: string | number | null;
    patient_id: number | null;
    patient_name: string | null;
    outcome: 'success' | 'denied' | 'failure';
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    ip: string | null;
    user_agent: string | null;
    details: Record<string, any> | null;
}

export interface SecurityAlert extends AuditEntry {
    title: string;
    status: 'reviewed' | 'unreviewed';
    resolution: string | null;
    review_notes: string | null;
    reviewed_by_name: string | null;
    reviewed_at: string | null;
}

export interface Device {
    id: number;
    uid: string;
    staff_name: string;
    staff_email: string;
    device_name: string;
    device_type: string;
    platform: string | null;
    justification: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'revoked';
    trusted: number;
    reviewed_by_name: string | null;
    reviewed_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

export interface ActiveSession {
    id: string;
    uid: string;
    acting_role: string | null;
    staff_name: string;
    staff_email: string;
    role_name: string;
    created_at: string;
    last_seen_at: string | null;
    expires_at: string;
    ip: string | null;
    user_agent: string | null;
}

export interface ApiEnvelope<T> {
    data: T;
    meta?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Request layer
// ---------------------------------------------------------------------------

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        public details?: Record<string, any>,
    ) {
        super(message);
    }
}

let authToken: string | null = null;
let stepUpToken: { token: string; expiresAt: number } | null = null;
let onSessionEnded: ((reason: string) => void) | null = null;
let onForbidden: (() => void) | null = null;

export const setAuthToken = (token: string | null) => {
    authToken = token;
    if (!token) stepUpToken = null;
};
export const getAuthToken = () => authToken;

export const setStepUpToken = (token: string, expiresAt: string) => {
    stepUpToken = { token, expiresAt: new Date(expiresAt).getTime() };
};
export const clearStepUpToken = () => {
    stepUpToken = null;
};
export const hasStepUp = () => Boolean(stepUpToken && stepUpToken.expiresAt > Date.now() + 5_000);

/** AuthContext registers these so the whole app reacts to expired sessions and permission changes. */
export function registerSessionHandlers(handlers: { onSessionEnded: (reason: string) => void; onForbidden: () => void }) {
    onSessionEnded = handlers.onSessionEnded;
    onForbidden = handlers.onForbidden;
}

const SESSION_ENDING_CODES = new Set(['SESSION_EXPIRED', 'INVALID_TOKEN', 'ACCOUNT_DISABLED', 'UNAUTHORIZED']);

type Query = Record<string, string | number | boolean | undefined | null>;

async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query; auth?: boolean } = {}): Promise<ApiEnvelope<T>> {
    const { body, query, auth = true } = options;
    const params = query
        ? Object.entries(query)
              .filter(([, value]) => value !== undefined && value !== null && value !== '')
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
              .join('&')
        : '';
    const url = `${API_BASE_URL}${path}${params ? `?${params}` : ''}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;
    if (auth && stepUpToken && stepUpToken.expiresAt > Date.now()) headers['X-Step-Up-Token'] = stepUpToken.token;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch {
        throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the NeuroLock server (${API_BASE_URL}). Check that the API is running and reachable from this device.`);
    } finally {
        clearTimeout(timeout);
    }

    let payload: any = null;
    const text = await response.text();
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = null;
        }
    }

    if (!response.ok) {
        const error = new ApiError(
            response.status,
            payload?.error?.code ?? 'REQUEST_FAILED',
            payload?.error?.message ?? `Request failed (${response.status})`,
            payload?.error?.details,
        );
        if (auth && authToken && response.status === 401 && SESSION_ENDING_CODES.has(error.code)) {
            onSessionEnded?.(error.code);
        }
        if (error.code === 'STEP_UP_REQUIRED') clearStepUpToken();
        if (response.status === 403) onForbidden?.();
        throw error;
    }
    return (payload ?? { data: null }) as ApiEnvelope<T>;
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} });
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} });
const del = <T>(path: string) => request<T>('DELETE', path);

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const authAPI = {
    /** identifier = username or email */
    login: (identifier: string, password: string) =>
        request<SessionPayload | MfaChallenge>('POST', '/auth/login', { body: { identifier, password }, auth: false }),
    verifyMfa: (mfaToken: string, code?: string, backupCode?: string) =>
        request<SessionPayload>('POST', '/auth/mfa/verify', { body: { mfa_token: mfaToken, code, backup_code: backupCode }, auth: false }),
    logout: () => post<null>('/auth/logout'),
    me: () => get<MeResponse>('/auth/me'),
    stepUp: (credentials: { password?: string; code?: string }) => post<{ step_up_token: string; expires_at: string }>('/auth/step-up', credentials),
    changePassword: (currentPassword: string, newPassword: string) =>
        post<null>('/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
    beginMfaSetup: () => post<{ secret: string; otpauth_url: string }>('/auth/mfa/setup'),
    enableMfa: (code: string) => post<{ backup_codes: string[] }>('/auth/mfa/enable', { code }),
    disableMfa: (password: string) => post<null>('/auth/mfa/disable', { password }),
    regenerateBackupCodes: (password: string) => post<{ backup_codes: string[] }>('/auth/mfa/backup-codes', { password }),
    saveSettings: (settings: UserSettings) => put<UserSettings>('/auth/settings', settings),
    requestPasswordReset: (identifier: string) => request<null>('POST', '/auth/password-reset/request', { body: { identifier }, auth: false }),
    confirmPasswordReset: (identifier: string, code: string, newPassword: string) =>
        request<null>('POST', '/auth/password-reset/confirm', { body: { identifier, code, new_password: newPassword }, auth: false }),
    requestUnlock: (identifier: string, message?: string) => request<null>('POST', '/auth/unlock-request', { body: { identifier, message }, auth: false }),
    health: () => request<null>('GET', '/health', { auth: false }),
    /** Roles offered on the sign-up form (never Administrator). */
    signupRoles: () => request<SignupRole[]>('GET', '/auth/signup-roles', { auth: false }),
    signup: (data: Record<string, unknown>) => request<SignupResult>('POST', '/auth/signup', { body: data, auth: false }),
    /** Administrators only. */
    actAsRoles: () => get<ActAsRole[]>('/auth/act-as/roles'),
    /** Administrators only: view the app as another role; null returns to the own role. */
    actAs: (role: string | null) => post<MeResponse>('/auth/act-as', { role }),
};

export const patientAPI = {
    getAll: (query?: { search?: string; status?: string }) => get<Patient[]>('/patients', query),
    getById: (id: number, includeSensitive = false) => get<Patient>(`/patients/${id}`, { include_sensitive: includeSensitive ? 1 : undefined }),
    overview: (id: number, includeSensitive = false) =>
        get<PatientOverview>(`/patients/${id}/overview`, { include_sensitive: includeSensitive ? 1 : undefined }),
    create: (patient: Record<string, unknown>) => post<Patient>('/patients', patient),
    update: (id: number, patient: Record<string, unknown>) => put<Patient>(`/patients/${id}`, patient),
    delete: (id: number) => del<null>(`/patients/${id}`),
};

export const therapyNoteAPI = {
    getAll: (patientId?: number) => get<NoteMeta[]>('/therapy-notes', { patient_id: patientId }),
    getById: (id: number) => get<NoteDetail>(`/therapy-notes/${id}`),
    versions: (id: number) => get<{ current: { version: number; updated_at: string; author_name: string }; history: any[] }>(`/therapy-notes/${id}/versions`),
    create: (data: { patient_id: number; note_type?: string; session_date?: string; content: NoteContent }) =>
        post<{ id: number }>('/therapy-notes', data),
    update: (id: number, data: { note_type?: string; session_date?: string; content: NoteContent; change_summary?: string }) =>
        put<{ id: number; version: number }>(`/therapy-notes/${id}`, data),
    delete: (id: number) => del<null>(`/therapy-notes/${id}`),
    emergencyAccess: (patientId: number, reason: string) =>
        post<{ id: number; expires_at: string }>('/therapy-notes/emergency-access', { patient_id: patientId, reason }),
};

export const assessmentAPI = {
    getAll: (query?: { patient_id?: number; status?: string }) => get<Assessment[]>('/assessments', query),
    create: (data: Record<string, unknown>) => post<Assessment>('/assessments', data),
    update: (id: number, data: Record<string, unknown>) => put<Assessment>(`/assessments/${id}`, data),
    delete: (id: number) => del<null>(`/assessments/${id}`),
};

export const medicationAPI = {
    getAll: (query?: { patient_id?: number; status?: string }) => get<Medication[]>('/medications', query),
    schedule: (date: string) => get<ScheduleSlot[]>('/medications/schedule', { date }),
    prescribe: (data: Record<string, unknown>) => post<Medication>('/medications', data),
    update: (id: number, data: Record<string, unknown>) => put<Medication>(`/medications/${id}`, data),
    administer: (id: number, data: { scheduled_time?: string; schedule_date?: string; status: string; notes?: string }) =>
        post<{ id: number }>(`/medications/${id}/administer`, data),
};

export const appointmentAPI = {
    getAll: (query?: { patient_id?: number; mine?: boolean; status?: string; from?: string; to?: string }) =>
        get<Appointment[]>('/appointments', { ...query, mine: query?.mine ? 1 : undefined }),
    create: (data: Record<string, unknown>) => post<Appointment>('/appointments', data),
    update: (id: number, data: Record<string, unknown>) => put<Appointment>(`/appointments/${id}`, data),
};

export const sessionAPI = {
    getAll: (query?: { patient_id?: number; mine?: boolean }) => get<TherapySession[]>('/sessions', { ...query, mine: query?.mine ? 1 : undefined }),
    create: (data: Record<string, unknown>) => post<{ id: number }>('/sessions', data),
    progress: (mine?: boolean) => get<ProgressOverview[]>('/sessions/progress', { mine: mine ? 1 : undefined }),
    updateProgress: (patientId: number, score: number, note?: string) => post<{ id: number }>('/sessions/progress', { patient_id: patientId, score, note }),
};

export const vitalsAPI = {
    latest: () => get<Vitals[]>('/vitals'),
    forPatient: (patientId: number) => get<Vitals[]>('/vitals', { patient_id: patientId }),
    record: (data: Record<string, unknown>) => post<{ id: number }>('/vitals', data),
};

export const alertAPI = {
    getAll: (status: 'open' | 'acknowledged' | 'all' = 'all') => get<PatientAlert[]>('/alerts', { status }),
    create: (data: Record<string, unknown>) => post<PatientAlert>('/alerts', data),
    acknowledge: (id: number) => post<PatientAlert>(`/alerts/${id}/acknowledge`),
    acknowledgeAll: () => post<null>('/alerts/acknowledge-all'),
};

export const reportAPI = {
    getAll: (patientId?: number) => get<ReportSummary[]>('/reports', { patient_id: patientId }),
    getById: (id: number) => get<ReportSummary>(`/reports/${id}`),
    generate: (patientId: number, reportType: string) => post<ReportSummary>('/reports', { patient_id: patientId, report_type: reportType }),
};

const uidPath = (uid: string) => `/staff/${encodeURIComponent(uid)}`;

/** Accounts (staff and patients) in the directory, addressed by username. */
export const staffAPI = {
    getAll: (kind?: 'staff' | 'patient') => get<Account[]>('/staff', { kind }),
    directory: () => get<DirectoryEntry[]>('/staff/directory'),
    create: (data: Record<string, unknown>) => post<Account>('/staff', data),
    update: (uid: string, data: Record<string, unknown>) => put<Account>(uidPath(uid), data),
    unlock: (uid: string) => post<Account>(`${uidPath(uid)}/unlock`),
    resetPassword: (uid: string) => post<{ code: string; expires_at: string; email: string; username: string }>(`${uidPath(uid)}/reset-password`),
    revokeSessions: (uid: string) => post<null>(`${uidPath(uid)}/revoke-sessions`),
    deactivate: (uid: string) => del<null>(uidPath(uid)),
    signups: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') => get<Signup[]>('/staff/signups', { status }),
    approveSignup: (id: number, role?: string) => post<Account>(`/staff/signups/${id}/approve`, role ? { role } : {}),
    rejectSignup: (id: number, note?: string) => post<Account>(`/staff/signups/${id}/reject`, note ? { note } : {}),
};

type RoleChanges = { display_name?: string; description?: string; permissions?: string[]; signup?: boolean; requires_approval?: boolean };

/** Roles and their permissions (stored in the directory), addressed by role name. */
export const roleAPI = {
    getAll: () => get<Role[]>('/roles'),
    permissions: () => get<PermissionDefinition[]>('/roles/permissions'),
    create: (data: RoleChanges & { display_name: string; permissions: string[] }) => post<Role>('/roles', data),
    update: (name: string, data: RoleChanges) => put<Role>(`/roles/${encodeURIComponent(name)}`, data),
    setPermission: (name: string, code: string, granted: boolean) =>
        put<Role>(`/roles/${encodeURIComponent(name)}/permissions/${encodeURIComponent(code)}`, { granted }),
    delete: (name: string) => del<null>(`/roles/${encodeURIComponent(name)}`),
};

export const auditAPI = {
    getAll: (query?: Query) => get<AuditEntry[]>('/audit', query),
    stats: () => get<Record<string, any>>('/audit/stats'),
};

export const securityAPI = {
    overview: () => get<Record<string, any>>('/security/overview'),
    alerts: (query?: { status?: string; severity?: string }) => get<SecurityAlert[]>('/security/alerts', query),
    review: (auditId: number, resolution: string, notes?: string) => post<null>(`/security/alerts/${auditId}/review`, { resolution, notes }),
    sessions: () => get<ActiveSession[]>('/security/sessions'),
    revokeSession: (id: string) => post<null>(`/security/sessions/${id}/revoke`),
    passwordResets: () => get<any[]>('/security/password-resets'),
    issueReset: (id: number) => post<{ code: string; expires_at: string; email: string; username: string }>(`/security/password-resets/${id}/issue`),
    rejectReset: (id: number) => post<null>(`/security/password-resets/${id}/reject`),
};

export const deviceAPI = {
    mine: () => get<Device[]>('/devices/mine'),
    register: (data: { device_name: string; device_type: string; platform?: string; justification: string }) => post<Device>('/devices', data),
    setTrusted: (id: number, trusted: boolean) => put<Device>(`/devices/mine/${id}`, { trusted }),
    remove: (id: number) => del<null>(`/devices/mine/${id}`),
    getAll: (status?: string) => get<Device[]>('/devices', { status }),
    approve: (id: number) => post<Device>(`/devices/${id}/approve`),
    reject: (id: number) => post<Device>(`/devices/${id}/reject`),
};

export default {
    auth: authAPI,
    patient: patientAPI,
    therapyNote: therapyNoteAPI,
    assessment: assessmentAPI,
    medication: medicationAPI,
    appointment: appointmentAPI,
    session: sessionAPI,
    vitals: vitalsAPI,
    alert: alertAPI,
    report: reportAPI,
    staff: staffAPI,
    role: roleAPI,
    audit: auditAPI,
    security: securityAPI,
    device: deviceAPI,
};

/** Patient portal: the signed-in patient's own record only. */
export const portalAPI = {
    me: () => get<PortalOverview>('/portal/me'),
    appointments: () => get<PortalAppointment[]>('/portal/appointments'),
    medications: () => get<PortalMedication[]>('/portal/medications'),
    assessments: () => get<PortalAssessment[]>('/portal/assessments'),
    clinicians: () => get<Clinician[]>('/portal/clinicians'),
    book: (data: { staff_id: number; scheduled_at: string; appointment_type?: string; reason?: string }) => post<PortalAppointment>('/portal/appointments', data),
    cancel: (id: number) => post<PortalAppointment>(`/portal/appointments/${id}/cancel`),
};
