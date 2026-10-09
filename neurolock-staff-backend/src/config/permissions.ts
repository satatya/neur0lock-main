/**
 * Permission codes the API enforces. Which role holds which permission is NOT defined here:
 * roles and grants live in the AAA server's directory (OpenLDAP) and are edited at runtime by
 * administrators; the AAA server returns the current permission set for every request.
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

export type PermissionCode = (typeof P)[keyof typeof P];
