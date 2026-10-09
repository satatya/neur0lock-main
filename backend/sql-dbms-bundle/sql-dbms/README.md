# NeuroLock SQL DBMS (MySQL 8 + envelope encryption)

This bundle runs MySQL 8 on **host port 3307** (container port 3306) with the NeuroLock clinical schema
and demo records, plus a small Python client that does
**per-record envelope encryption** for therapy notes (AES-256-GCM data key, wrapped with an
AES-256 key-encryption key via RFC 3394). The Node API uses exactly the same format, so notes
written by either side can be read by the other.

## 1) Start the DB
```bash
cd backend/sql-dbms-bundle/sql-dbms
docker compose up -d
# Adminer UI: http://localhost:8080  (server = mysql, user = app, password = app123, db = neurolock)
```

The SQL in `db/init/` runs automatically the **first** time the container starts (empty volume).
Then run `npm run db:setup` in `neurolock-staff-backend` once to add the encrypted demo notes.

To start over with fresh demo data:
```bash
docker compose down -v && docker compose up -d
```
or, without Docker, `npm run db:setup -- --reset` in `neurolock-staff-backend`.

## Init scripts
| File | Contents |
|------|----------|
| `00_schema.sql` | Clinical tables only: `staff` (a directory mirror: uid, name, role – no credentials), patients (with `account_uid` for patient-portal accounts), encrypted `therapy_notes` (+ versions), emergency access, medications/administrations, assessments, appointments, therapy sessions/progress, vitals, alerts, reports |
| `01_directory_mirror.sql` | Mirror rows for the demo accounts so the demo records can reference them |
| `02_demo_data.sql` | Demo patients and clinical records (dates relative to the day the DB is created); MRN001 is linked to the `patient` portal account |

Accounts, passwords, roles and permissions are **not** in MySQL: they live in OpenLDAP behind the
AAA server, and the audit trail is kept by the AAA server and rsyslog (see the root README). The
full stack (including this database) is started with `docker compose up` in the repository root;
the `docker-compose.yml` here starts MySQL alone for experiments.

## 2) Try the Python client
```bash
cd backend/sql-dbms-bundle/sql-dbms/app
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env    # set KEK_HEX to the SAME value as neurolock-staff-backend/.env
python demo_insert.py
```

You should see the decrypted note printed back. The note is also readable in the app
(psychiatrist/psychologist/therapist → Notes) because both clients share the KEK.
