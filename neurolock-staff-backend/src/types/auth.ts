/** Account as returned by the AAA server. */
export interface AaaUser {
    uid: string;
    name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    licence_number: string | null;
    /** Effective role for this session (the acting role when an administrator switched view). */
    role: string | null;
    role_name: string | null;
    /** Role assigned in the directory. */
    base_role: string | null;
    base_role_name: string | null;
    acting_role: string | null;
    kind: 'staff' | 'patient';
    status: string;
    mfa_enabled: boolean;
    /** Directory uid whose patient record the patient portal shows (own account, or the demo patient for an admin preview). */
    portal_uid: string | null;
    /** Administrator previewing a clinical role: the demo account whose caseload the preview shows. */
    view_as: { uid: string; name: string } | null;
    can_act_as: boolean;
    [key: string]: unknown;
}

export interface AuthUser {
    /** Numeric id of the account in the MySQL directory mirror (referenced by clinical records). */
    id: number;
    uid: string;
    email: string | null;
    name: string;
    /** Effective machine role name, e.g. 'therapist' */
    role: string | null;
    /** Human role name, e.g. 'Therapist' */
    roleName: string | null;
    baseRole: string | null;
    actingRole: string | null;
    kind: 'staff' | 'patient';
    portalUid: string | null;
    /** Staff id whose care teams decide patient visibility when an administrator previews a role. */
    careScopeId: number | null;
    /** Permission set decided by the AAA server for this session. */
    permissions: Set<string>;
    sessionId: string;
    /** True when the request carries a valid recent re-authentication token (checked by the AAA server). */
    stepUp: boolean;
    mfaEnabled: boolean;
    account: AaaUser;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

export {};
