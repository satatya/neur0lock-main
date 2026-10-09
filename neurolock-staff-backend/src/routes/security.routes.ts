/**
 * Security centre: alerts, sessions, password-reset requests. Served by the AAA server (which
 * enforces security:read / staff:manage and step-up); the overview adds the clinical database status.
 */
import { Router } from 'express';
import { pingDatabase } from '../infra/db/mysql-client';
import { pendingAccountingEvents } from '../services/audit.service';
import { withPatientNames } from './audit.routes';
import { param, proxy } from './aaa-proxy';

const router = Router();

router.get(
    '/overview',
    proxy('GET', '/security/overview', {
        after: async (data) => ({
            ...data,
            database: (await pingDatabase()) ? 'healthy' : 'unavailable',
            accounting_backlog: pendingAccountingEvents(),
        }),
    }),
);
router.get('/alerts', proxy('GET', '/security/alerts', { after: withPatientNames }));
router.post('/alerts/:id/review', proxy('POST', (req) => `/security/alerts/${param(req, 'id')}/review`));
router.get('/sessions', proxy('GET', '/security/sessions'));
router.post('/sessions/:id/revoke', proxy('POST', (req) => `/security/sessions/${param(req, 'id')}/revoke`));
router.get('/password-resets', proxy('GET', '/security/password-resets'));
router.post('/password-resets/:id/issue', proxy('POST', (req) => `/security/password-resets/${param(req, 'id')}/issue`));
router.post('/password-resets/:id/reject', proxy('POST', (req) => `/security/password-resets/${param(req, 'id')}/reject`));

export const securityRoutes = router;
