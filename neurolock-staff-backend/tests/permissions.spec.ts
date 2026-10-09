import { Request, Response } from 'express';
import { ApiError } from '../src/utils/http';

jest.mock('../src/services/audit.service', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/directory.service', () => ({ mirrorUser: jest.fn().mockResolvedValue(42) }));
jest.mock('../src/infra/aaa-client', () => {
    const actual = jest.requireActual('../src/infra/aaa-client');
    return { ...actual, aaa: jest.fn() };
});

import { aaa } from '../src/infra/aaa-client';
import { audit } from '../src/services/audit.service';
import { authenticate, hasValidStepUp, requireAnyPermission, requirePermission } from '../src/middlewares/auth.middleware';

const userWith = (...permissions: string[]) =>
    ({
        user: {
            id: 7,
            uid: 'therapist',
            email: 'therapist@neurolock.com',
            name: 'John Therapist',
            role: 'therapist',
            roleName: 'Therapist',
            baseRole: 'therapist',
            actingRole: null,
            kind: 'staff',
            portalUid: null,
            permissions: new Set(permissions),
            sessionId: 'session-1',
            stepUp: false,
            mfaEnabled: false,
            account: {},
        },
        method: 'POST',
        originalUrl: '/api/assessments',
        headers: {},
    }) as unknown as Request;

/** Runs an Express middleware and resolves with the error passed to next() (or undefined). */
const run = (middleware: any, req: Request) =>
    new Promise<unknown>((resolve) => {
        middleware(req, {} as Response, (error?: unknown) => resolve(error));
    });

describe('permission middleware (permission set issued by the AAA server)', () => {
    beforeEach(() => (audit as jest.Mock).mockClear());

    it('allows a request when the role grants every required permission', async () => {
        const error = await run(requirePermission('patients:read', 'notes:read'), userWith('patients:read', 'notes:read'));
        expect(error).toBeUndefined();
        expect(audit).not.toHaveBeenCalled();
    });

    it('denies and accounts when a permission is missing', async () => {
        const error = (await run(requirePermission('assessments:create'), userWith('assessments:read'))) as ApiError;
        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(403);
        expect(error.details).toEqual({ missing: ['assessments:create'] });
        expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'access_denied', outcome: 'denied' }));
    });

    it('supports "any of" checks', async () => {
        expect(await run(requireAnyPermission('notes:read', 'notes:emergency_access'), userWith('notes:emergency_access'))).toBeUndefined();
        const error = (await run(requireAnyPermission('notes:read', 'notes:emergency_access'), userWith('patients:read'))) as ApiError;
        expect(error.status).toBe(403);
    });

    it('rejects unauthenticated requests', async () => {
        const error = (await run(requirePermission('patients:read'), { headers: {} } as Request)) as ApiError;
        expect(error.status).toBe(401);
    });

    it('trusts the step-up decision made by the AAA server', () => {
        const req = userWith();
        expect(hasValidStepUp(req)).toBe(false);
        req.user!.stepUp = true;
        expect(hasValidStepUp(req)).toBe(true);
    });
});

describe('authenticate', () => {
    const authorizeResult = (overrides: Record<string, unknown> = {}) => ({
        data: {
            allowed: true,
            missing: [],
            permissions: ['portal:access', 'portal:book'],
            step_up: false,
            session: { id: 'sess-9', expires_at: '2030-01-01T00:00:00Z' },
            user: { uid: 'patient', name: 'Riya Jain', email: 'patient@neurolock.com', role: 'patient', role_name: 'Patient', base_role: 'patient', base_role_name: 'Patient', acting_role: null, kind: 'patient', portal_uid: 'patient', mfa_enabled: false },
            ...overrides,
        },
    });

    beforeEach(() => (aaa as jest.Mock).mockReset());

    it('requires a bearer token without calling the AAA server', async () => {
        const error = (await run(authenticate, { headers: {} } as Request)) as ApiError;
        expect(error.status).toBe(401);
        expect(aaa).not.toHaveBeenCalled();
    });

    it('builds the request user from the AAA authorization decision', async () => {
        (aaa as jest.Mock).mockResolvedValue(authorizeResult());
        const req = { headers: { authorization: 'Bearer abc' }, method: 'GET', originalUrl: '/api/portal/me?x=1' } as unknown as Request;
        expect(await run(authenticate, req)).toBeUndefined();
        expect(aaa).toHaveBeenCalledWith('POST', '/authorize', expect.objectContaining({ body: { permissions: [], request: { method: 'GET', path: '/api/portal/me' } } }));
        expect(req.user).toMatchObject({ id: 42, uid: 'patient', role: 'patient', kind: 'patient', portalUid: 'patient', sessionId: 'sess-9', stepUp: false });
        expect([...req.user!.permissions]).toEqual(['portal:access', 'portal:book']);
    });

    it('passes AAA session errors through unchanged', async () => {
        (aaa as jest.Mock).mockRejectedValue(new ApiError(401, 'SESSION_EXPIRED', 'Your session has ended.'));
        const error = (await run(authenticate, { headers: { authorization: 'Bearer old' }, method: 'GET', originalUrl: '/api/patients' } as unknown as Request)) as ApiError;
        expect(error.code).toBe('SESSION_EXPIRED');
    });
});
