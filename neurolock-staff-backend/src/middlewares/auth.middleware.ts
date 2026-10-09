import { NextFunction, Request, Response } from 'express';
import '../types/auth';
import { aaa, bearerOf } from '../infra/aaa-client';
import { audit } from '../services/audit.service';
import { mirrorIdForUid, mirrorUser } from '../services/directory.service';
import { AaaUser } from '../types/auth';
import { ApiError, asyncHandler } from '../utils/http';

interface AuthorizeResult {
    allowed: boolean;
    missing: string[];
    user: AaaUser;
    permissions: string[];
    step_up: boolean;
    session: { id: string; expires_at: string };
}

/**
 * Authentication + authorization context, decided by the AAA server on every request:
 * the bearer token is validated there (so logout, deactivation, lockout and session revocation
 * take effect immediately) and the AAA server returns the permission set of the user's role,
 * read from the directory at that moment.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!bearerOf(req)) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const { data } = await aaa<AuthorizeResult>('POST', '/authorize', {
        req,
        body: { permissions: [], request: { method: req.method, path: req.originalUrl.split('?')[0] } },
    });
    const account = data.user;
    const id = await mirrorUser(account);
    const careScopeId = account.view_as ? await mirrorIdForUid(account.view_as.uid) : null;
    req.user = {
        id,
        uid: account.uid,
        email: account.email,
        name: account.name,
        role: account.role,
        roleName: account.role_name,
        baseRole: account.base_role,
        actingRole: account.acting_role,
        kind: account.kind,
        portalUid: account.portal_uid,
        careScopeId,
        permissions: new Set(data.permissions),
        sessionId: data.session.id,
        stepUp: Boolean(data.step_up),
        mfaEnabled: Boolean(account.mfa_enabled),
        account,
    };
    next();
});

export const can = (req: Request, permission: string): boolean => Boolean(req.user?.permissions.has(permission));

async function deny(req: Request, missing: string[]): Promise<never> {
    await audit(req, {
        action: 'access_denied',
        resource: 'permission',
        outcome: 'denied',
        severity: 'low',
        details: { method: req.method, path: req.originalUrl.split('?')[0], missing },
    });
    throw new ApiError(403, 'FORBIDDEN', 'Your role does not have permission to perform this action', { missing });
}

/** Authorization: the AAA-issued permission set must contain ALL listed permissions. */
export const requirePermission = (...codes: string[]) =>
    asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
        const missing = codes.filter((code) => !req.user!.permissions.has(code));
        if (missing.length > 0) await deny(req, missing);
        next();
    });

/** Authorization: the AAA-issued permission set must contain AT LEAST ONE of the listed permissions. */
export const requireAnyPermission = (...codes: string[]) =>
    asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
        if (!codes.some((code) => req.user!.permissions.has(code))) await deny(req, codes);
        next();
    });

export const STEP_UP_HEADER = 'x-step-up-token';

/** True when the request carries a valid, recent re-authentication token for this session (verified by the AAA server). */
export function hasValidStepUp(req: Request): boolean {
    return Boolean(req.user?.stepUp);
}

export function assertStepUp(req: Request): void {
    if (!hasValidStepUp(req)) {
        throw new ApiError(401, 'STEP_UP_REQUIRED', 'Please re-enter your password to continue with this sensitive action.');
    }
}

/** Sensitive actions require the user to have re-authenticated within the last few minutes. */
export const requireStepUp = (req: Request, _res: Response, next: NextFunction) => {
    try {
        assertStepUp(req);
        next();
    } catch (error) {
        next(error);
    }
};
