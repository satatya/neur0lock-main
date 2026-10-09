/** Device registration and trust (stored and enforced by the AAA server). */
import { Router } from 'express';
import { param, proxy } from './aaa-proxy';

const router = Router();

router.get('/mine', proxy('GET', '/devices/mine'));
router.post('/', proxy('POST', '/devices'));
router.put('/mine/:id', proxy('PUT', (req) => `/devices/mine/${param(req, 'id')}`));
router.delete('/mine/:id', proxy('DELETE', (req) => `/devices/mine/${param(req, 'id')}`));
router.get('/', proxy('GET', '/devices'));
router.post('/:id/approve', proxy('POST', (req) => `/devices/${param(req, 'id')}/approve`));
router.post('/:id/reject', proxy('POST', (req) => `/devices/${param(req, 'id')}/reject`));

export const deviceRoutes = router;
