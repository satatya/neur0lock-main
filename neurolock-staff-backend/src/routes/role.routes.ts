/**
 * Dynamic roles & permissions. Roles are LDAP groups and permissions are LDAP groups whose members
 * are roles; the AAA server edits them (roles:manage + step-up) and applies changes immediately.
 * Roles are addressed by their machine name, e.g. /api/roles/therapist.
 */
import { Router } from 'express';
import { invalidateDirectoryCache } from '../services/directory.service';
import { param, proxy } from './aaa-proxy';

const router = Router();

const invalidate = (data: unknown) => {
    invalidateDirectoryCache();
    return data;
};

router.get('/', proxy('GET', '/roles'));
router.get('/permissions', proxy('GET', '/permissions'));
router.post('/', proxy('POST', '/roles'));
router.put('/:name', proxy('PUT', (req) => `/roles/${param(req, 'name')}`, { after: invalidate }));
router.put('/:name/permissions/:code', proxy('PUT', (req) => `/roles/${param(req, 'name')}/permissions/${param(req, 'code')}`, { after: invalidate }));
router.delete('/:name', proxy('DELETE', (req) => `/roles/${param(req, 'name')}`, { after: invalidate }));

export const roleRoutes = router;
