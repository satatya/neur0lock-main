/**
 * Permission codes understood by the API. What each ROLE is granted is NOT defined here:
 * it is loaded from the server after login (/auth/me) and can be changed by administrators
 * at runtime from the Admin dashboard's Roles tab.
 */
export const P = {
    PATIENTS_READ: 'patients:read',
    PATIENTS_READ_ALL: 'patients:read_all',
    PATIENTS_READ_SENSITIVE: 'patients:read_sensitive',
    PATIENTS_CREATE: 'patients:create',
    PATIENTS_UPDATE: 'patients:update',
    PATIENTS_DELETE: 'patients:delete',
    NOTES_READ: 'notes:read',
    NOTES_CREATE: 'notes:create',
    NOTES_UPDATE: 'notes:update',
    NOTES_DELETE: 'notes:delete',
    NOTES_EMERGENCY: 'notes:emergency_access',
    ASSESSMENTS_READ: 'assessments:read',
    ASSESSMENTS_CREATE: 'assessments:create',
    ASSESSMENTS_UPDATE: 'assessments:update',
    ASSESSMENTS_DELETE: 'assessments:delete',
    MEDICATIONS_READ: 'medications:read',
    MEDICATIONS_PRESCRIBE: 'medications:prescribe',
    MEDICATIONS_UPDATE: 'medications:update',
    MEDICATIONS_ADMINISTER: 'medications:administer',
    APPOINTMENTS_READ: 'appointments:read',
    APPOINTMENTS_CREATE: 'appointments:create',
    APPOINTMENTS_UPDATE: 'appointments:update',
    SESSIONS_READ: 'sessions:read',
    SESSIONS_WRITE: 'sessions:write',
    VITALS_READ: 'vitals:read',
    VITALS_RECORD: 'vitals:record',
    ALERTS_READ: 'alerts:read',
    ALERTS_MANAGE: 'alerts:manage',
    REPORTS_READ: 'reports:read',
    REPORTS_GENERATE: 'reports:generate',
    STAFF_READ: 'staff:read',
    STAFF_MANAGE: 'staff:manage',
    ROLES_MANAGE: 'roles:manage',
    AUDIT_READ: 'audit:read',
    SECURITY_READ: 'security:read',
    PORTAL_ACCESS: 'portal:access',
    PORTAL_BOOK: 'portal:book',
    ADMIN_ACT_AS: 'admin:act_as',
} as const;

/** Labels for showing a user's own access (the admin editor loads the catalog from the API). */
export const PERMISSION_LABELS: Record<string, { category: string; label: string }> = {
    'patients:read': { category: 'Patients', label: 'View patients (own care team)' },
    'patients:read_all': { category: 'Patients', label: 'View all patients' },
    'patients:read_sensitive': { category: 'Patients', label: 'View sensitive details' },
    'patients:create': { category: 'Patients', label: 'Register patients' },
    'patients:update': { category: 'Patients', label: 'Edit patients' },
    'patients:delete': { category: 'Patients', label: 'Delete patients' },
    'notes:read': { category: 'Therapy notes', label: 'Read therapy notes' },
    'notes:create': { category: 'Therapy notes', label: 'Write therapy notes' },
    'notes:update': { category: 'Therapy notes', label: 'Edit own notes' },
    'notes:delete': { category: 'Therapy notes', label: 'Delete notes' },
    'notes:emergency_access': { category: 'Therapy notes', label: 'Emergency access' },
    'assessments:read': { category: 'Assessments', label: 'View assessments' },
    'assessments:create': { category: 'Assessments', label: 'Schedule assessments' },
    'assessments:update': { category: 'Assessments', label: 'Update assessments' },
    'assessments:delete': { category: 'Assessments', label: 'Delete assessments' },
    'medications:read': { category: 'Medications', label: 'View medications' },
    'medications:prescribe': { category: 'Medications', label: 'Prescribe' },
    'medications:update': { category: 'Medications', label: 'Change prescriptions' },
    'medications:administer': { category: 'Medications', label: 'Administer' },
    'appointments:read': { category: 'Appointments', label: 'View appointments' },
    'appointments:create': { category: 'Appointments', label: 'Schedule appointments' },
    'appointments:update': { category: 'Appointments', label: 'Manage appointments' },
    'sessions:read': { category: 'Therapy sessions', label: 'View session logs' },
    'sessions:write': { category: 'Therapy sessions', label: 'Log sessions' },
    'vitals:read': { category: 'Vitals', label: 'View vitals' },
    'vitals:record': { category: 'Vitals', label: 'Record vitals' },
    'alerts:read': { category: 'Patient alerts', label: 'View patient alerts' },
    'alerts:manage': { category: 'Patient alerts', label: 'Manage patient alerts' },
    'reports:read': { category: 'Reports', label: 'View reports' },
    'reports:generate': { category: 'Reports', label: 'Generate reports' },
    'staff:read': { category: 'Administration', label: 'View staff' },
    'staff:manage': { category: 'Administration', label: 'Manage staff' },
    'roles:manage': { category: 'Administration', label: 'Manage roles & permissions' },
    'audit:read': { category: 'Administration', label: 'View audit log' },
    'security:read': { category: 'Administration', label: 'View security alerts' },
    'admin:act_as': { category: 'Administration', label: 'Switch role view' },
    'portal:access': { category: 'Patient portal', label: 'View own records' },
    'portal:book': { category: 'Patient portal', label: 'Book own appointments' },
};

export interface RoleTheme {
    title: string;
    icon: string;
    colors: [string, string];
    screen: string;
}

const ROLE_THEMES: Record<string, RoleTheme> = {
    psychiatrist: { title: 'Psychiatrist Dashboard', icon: '🩺', colors: ['#2563eb', '#1d4ed8'], screen: 'PsychiatristDashboardNew' },
    psychologist: { title: 'Psychologist Dashboard', icon: '🧠', colors: ['#7c3aed', '#6d28d9'], screen: 'PsychologistDashboardNew' },
    therapist: { title: 'Therapist Dashboard', icon: '💬', colors: ['#0d9488', '#0f766e'], screen: 'TherapistDashboardNew' },
    nurse: { title: 'Nurse Dashboard', icon: '🏥', colors: ['#db2777', '#be185d'], screen: 'NurseDashboardNew' },
    admin: { title: 'Admin Dashboard', icon: '🔐', colors: ['#334155', '#1e293b'], screen: 'AdminDashboardNew' },
    patient: { title: 'My Health', icon: '🌿', colors: ['#059669', '#047857'], screen: 'PatientDashboardNew' },
};

/** Custom roles created by administrators use the generic staff dashboard. */
export function roleTheme(role: string | null | undefined, roleName?: string | null): RoleTheme {
    return (role && ROLE_THEMES[role]) || { title: `${roleName ?? 'Staff'} Dashboard`, icon: '🏥', colors: ['#0369a1', '#075985'], screen: 'StaffDashboardNew' };
}
