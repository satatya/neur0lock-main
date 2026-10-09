# NeuroLock API

Express + TypeScript + MySQL 8. See the root `README.md` for setup. Every response is JSON:
`{ "data": …, "meta": … }` on success and `{ "error": { "code", "message", "details" } }` on failure.

## Scripts
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with auto-reload on `PORT` (default 4311) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run db:setup` | Create the schema if the DB is empty and seed encrypted demo notes (`-- --reset` drops and recreates) |
| `npm test` | Unit tests |
| `npm run smoke` | End-to-end test against a running API (`API_URL` to override) |
| `npm run typecheck` | TypeScript check incl. tests and scripts |

For local development without Docker, copy `.env.example` to `.env` (the API reads `./.env`). With Docker,
`docker compose up -d --build` in the repository root runs the API together with everything else.

## Authentication
* `Authorization: Bearer <token>` for every authenticated call. Tokens reference a server-side
  session that logout, deactivation or an admin can revoke.
* Sensitive endpoints also need `X-Step-Up-Token`, obtained from `POST /auth/step-up`. Without it
  they return `401 STEP_UP_REQUIRED`.
* Error codes clients handle: `INVALID_CREDENTIALS` (with `attempts_remaining`),
  `ACCOUNT_LOCKED` (423, with `locked_until`), `ACCOUNT_DISABLED`, `SESSION_EXPIRED`, `FORBIDDEN`
  (403, with `missing` permissions), `LOCKOUT_PREVENTED`, `RATE_LIMITED`.

## Endpoints (permission in brackets)
**Auth** `/api/auth`: `POST /login`, `POST /mfa/verify`, `POST /logout`, `GET /me`, `POST /step-up`,
`POST /change-password`, `POST /mfa/setup | /mfa/enable | /mfa/disable | /mfa/backup-codes`,
`PUT /settings`, `POST /password-reset/request | /password-reset/confirm`, `POST /unlock-request`

**Staff** `/api/staff`: `GET /directory` (any signed-in user), `GET /` [staff:read], `POST /`, `PUT /:id`,
`POST /:id/unlock`, `POST /:id/reset-password` (step-up), `POST /:id/revoke-sessions`, `DELETE /:id` [staff:manage]

**Roles** `/api/roles`: `GET /`, `GET /permissions` [roles:manage or staff:read]; `POST /`, `PUT /:id`,
`PUT /:id/permissions/:code`, `DELETE /:id` [roles:manage + step-up]

**Patients** `/api/patients`: `GET /`, `GET /:id` (`?include_sensitive=1`), `GET /:id/overview` [patients:read];
`POST /` [patients:create]; `PUT /:id` [patients:update]; `DELETE /:id` [patients:delete + step-up]

**Therapy notes** `/api/therapy-notes`: `GET /?patient_id=` [notes:read or an emergency grant];
`GET /:id` (step-up); `GET /:id/versions`; `POST /` [notes:create]; `PUT /:id` [notes:update, author only, step-up];
`DELETE /:id` [notes:delete, step-up]; `POST /emergency-access` [notes:emergency_access, step-up]

**Clinical**: `/api/assessments` [assessments:*], `/api/medications` (+ `GET /schedule`,
`POST /:id/administer`) [medications:*], `/api/appointments` [appointments:*],
`/api/sessions` (+ `/progress`) [sessions:*], `/api/vitals` [vitals:*], `/api/alerts` [alerts:*],
`/api/reports` [reports:*]

**Accounting and security**: `/api/audit` (+ `/stats`) [audit:read]; `/api/security/overview | /alerts |
/sessions | /password-resets` [security:read / staff:manage]; `/api/devices` (own devices;
approvals need [staff:manage])
