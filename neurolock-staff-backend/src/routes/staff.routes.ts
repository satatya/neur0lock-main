/**
 * Account administration. Accounts live in the AAA server's directory (OpenLDAP); these endpoints
 * relay to it and the AAA server enforces staff:read / staff:manage and step-up re-authentication.
 * Accounts are addressed by their directory username (uid).
 */
import { Router } from 'express';
import { bearerOf } from '../infra/aaa-client';
import { authenticate } from '../middlewares/auth.middleware';
import { activeStaffDirectory, invalidateDirectoryCache, mirrorUser } from '../services/directory.service';
import { AaaUser } from '../types/auth';
import { asyncHandler } from '../utils/http';
import { param, proxy } from './aaa-proxy';

const router = Router();

const syncAccount = async (data: AaaUser) => {
    invalidateDirectoryCache(data?.uid);
    if (data?.uid) await mirrorUser(data).catch(() => undefined);
    return data;
};
const syncList = async (data: AaaUser[]) => {
    invalidateDirectoryCache();
    for (const account of data ?? []) await mirrorUser(account).catch(() => undefined);
    return data;
};
const invalidate = (data: unknown) => {
    invalidateDirectoryCache();
    return data;
};

/** Active staff for pickers (appointments, care team), with the ids clinical records use. */
router.get(
    '/directory',
    authenticate,
    asyncHandler(async (req, res) => {
        const directory = await activeStaffDirectory(bearerOf(req));
        res.json({ data: directory, meta: { count: directory.length } });
    }),
);

router.get('/', proxy('GET', '/users', { after: syncList }));
router.post('/', proxy('POST', '/users', { after: syncAccount }));

/** Self-service sign-ups waiting for approval (?status=pending|approved|rejected|all). */
router.get('/signups', proxy('GET', '/signups'));
router.post('/signups/:id/approve', proxy('POST', (req) => `/signups/${param(req, 'id')}/approve`, { after: syncAccount }));
router.post('/signups/:id/reject', proxy('POST', (req) => `/signups/${param(req, 'id')}/reject`, { after: invalidate }));

router.get('/:uid', proxy('GET', (req) => `/users/${param(req, 'uid')}`));
router.put('/:uid', proxy('PUT', (req) => `/users/${param(req, 'uid')}`, { after: syncAccount }));
router.post('/:uid/unlock', proxy('POST', (req) => `/users/${param(req, 'uid')}/unlock`));
router.post('/:uid/reset-password', proxy('POST', (req) => `/users/${param(req, 'uid')}/reset-password`));
router.post('/:uid/revoke-sessions', proxy('POST', (req) => `/users/${param(req, 'uid')}/revoke-sessions`));
router.delete('/:uid', proxy('DELETE', (req) => `/users/${param(req, 'uid')}`, { after: invalidate }));

export const staffRoutes = router;
