import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env';
import { aaaHealth } from './infra/aaa-client';
import { pingDatabase } from './infra/db/mysql-client';
import { TrustProxyFn } from './infra/trusted-proxy';
import { errorHandler, notFound } from './middlewares/error.middleware';
import { appointmentRoutes } from './routes/appointment.routes';
import { assessmentRoutes } from './routes/assessment.routes';
import { auditRoutes } from './routes/audit.routes';
import { authRoutes } from './routes/auth.routes';
import { alertRoutes, vitalsRoutes } from './routes/care.routes';
import { deviceRoutes } from './routes/device.routes';
import { medicationRoutes } from './routes/medication.routes';
import { patientRoutes } from './routes/patient.routes';
import { portalRoutes } from './routes/portal.routes';
import { reportRoutes } from './routes/report.routes';
import { roleRoutes } from './routes/role.routes';
import { securityRoutes } from './routes/security.routes';
import { sessionRoutes } from './routes/session.routes';
import { staffRoutes } from './routes/staff.routes';
import { therapyNoteRoutes } from './routes/therapy-note.routes';

interface ServerOptions {
    /** Which peers may set X-Forwarded-For; by default none, so every caller is its socket address. */
    trustProxy?: TrustProxyFn;
}

export const createServer = ({ trustProxy }: ServerOptions = {}) => {
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy ?? false);

    // Middleware
    app.use(helmet());
    app.use(
        cors({
            origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Step-Up-Token'],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        }),
    );
    app.use(express.json({ limit: '1mb' }));
    // API responses contain patient data: never cache them.
    app.use('/api', (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // Health check: clinical database + AAA server (which reports the directory and log server)
    app.get('/api/health', async (_req, res) => {
        const [database, aaa] = await Promise.all([pingDatabase(), aaaHealth()]);
        const healthy = database && aaa.ok;
        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'healthy' : 'degraded',
            database: database ? 'connected' : 'unavailable',
            aaa: aaa.ok ? 'connected' : 'unavailable',
            directory: aaa.directory ?? 'unknown',
            log_server: aaa.log_server ?? 'unknown',
            message: 'NeuroLock API is running',
        });
    });

    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/staff', staffRoutes);
    app.use('/api/roles', roleRoutes);
    app.use('/api/patients', patientRoutes);
    app.use('/api/portal', portalRoutes);
    app.use('/api/therapy-notes', therapyNoteRoutes);
    app.use('/api/assessments', assessmentRoutes);
    app.use('/api/medications', medicationRoutes);
    app.use('/api/appointments', appointmentRoutes);
    app.use('/api/sessions', sessionRoutes);
    app.use('/api/vitals', vitalsRoutes);
    app.use('/api/alerts', alertRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/audit', auditRoutes);
    app.use('/api/security', securityRoutes);
    app.use('/api/devices', deviceRoutes);

    // Error handling
    app.use(notFound);
    app.use(errorHandler);

    return app;
};
