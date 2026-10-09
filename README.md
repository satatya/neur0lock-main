# NeuroLock

Secure patient-records system for a mental-health clinic:

* an **Expo (React Native) app** for Android, iOS and the web,
* a **REST API** (Node/Express) over **MySQL** for clinical records,
* a separate **AAA server** (Python/Flask) that does all **A**uthentication, **A**uthorization and
  **A**ccounting against an **OpenLDAP** directory and an **rsyslog** audit-log server,
* all of it in **Docker**, with TLS between every hop.

```
 Website / app ──HTTPS 443──▶ REST API (Express) ──3306──▶ MySQL (patient records)
                                   │
                                   └──HTTPS 443, mutual TLS──▶ AAA server (Python / Flask)
                                                                 ├──LDAP 389 + StartTLS──▶ OpenLDAP (users, roles, permissions)
                                                                 └──syslog over TLS 6514──▶ rsyslog (audit log)
```

| Part | Folder | Stack |
|------|--------|-------|
| App / website | `frontend/` | Expo SDK 57, React Native 0.86; the web build is served by nginx over HTTPS |
| REST API | `neurolock-staff-backend/` | Node 20, Express, TypeScript, mysql2 |
| AAA server | `aaa-server/` | Python 3.12, Flask + gunicorn, ldap3, pyotp |
| Directory | `docker-compose.yml` → `openldap` | OpenLDAP (osixia/openldap 1.5) |
| Log server | `infra/rsyslog/` | rsyslog + GnuTLS |
| Database | `backend/sql-dbms-bundle/sql-dbms/` | MySQL 8 schema, demo data, Python demo client |
| Certificates | `infra/certs/` | private development CA + one certificate per service (generated on first start) |

---

## Setup after cloning

### 1. Install the prerequisites

| Tool | Needed for | Get it |
|------|-----------|--------|
| **Git** | cloning | https://git-scm.com/downloads |
| **Docker Desktop** (Windows/macOS) or Docker Engine + Compose plugin (Linux) | running the whole system | https://www.docker.com/products/docker-desktop/ |
| **Node.js LTS** (22 or newer recommended) | the secrets script and the mobile app | https://nodejs.org |
| **Expo Go** on your phone (latest version, SDK 57) | optional – running the app on a phone | Play Store / App Store |

On Windows, open a **new** terminal after installing Docker Desktop and make sure it is running
(whale icon in the system tray) before continuing. Check with `docker version`.

### 2. Clone the repository

```bash
git clone https://github.com/satatya/neur0lock-main.git
cd neur0lock-main
```

### 3. Create your secrets

```bash
node scripts/setup-env.mjs
```

This copies `.env.example` to `.env` and fills in fresh random passwords and keys (MySQL, LDAP admin,
the AAA server's encryption key and the therapy-note key `KEK_HEX`). `.env` is git-ignored – never
commit it. **Back up `KEK_HEX`**: encrypted therapy notes cannot be read without it.

<details>
<summary>Prefer to fill it in by hand?</summary>

Copy `.env.example` to `.env` and set every value. The two keys must have a specific format:

```bash
# AAA_SECRET_KEY (Fernet key)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# KEK_HEX (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
</details>

### 4. Start everything

```bash
docker compose up -d --build
```

The first start takes a few minutes (it builds the images, generates the certificates, sets up LDAP
and loads the demo data). Check progress with:

```bash
docker compose ps
```

All services should show `running`/`healthy` (`certgen` runs once and exits – that is expected).

> **Windows shortcut:** `start.bat` (or `./start.sh` on macOS/Linux/Git Bash) does steps 3–4 and then
> starts the mobile app, from a small menu.

### 5. Open the website

Go to **https://localhost** and sign in with a [demo account](#demo-accounts), e.g. `admin` /
`Demo@1234`.

The certificate comes from the project's private development CA, so the browser warns the first time
(*Advanced → Continue*). To make the warning go away, export the CA and trust it:

```bash
docker compose cp web:/certs/ca.crt ./neurolock-ca.crt
```

* **Windows:** double-click `neurolock-ca.crt` → *Install Certificate* → *Current User* → *Place all
  certificates in the following store* → *Trusted Root Certification Authorities*, then restart the
  browser (Firefox has its own certificate store).
* **macOS:** `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain neurolock-ca.crt`

### 6. Run the app on your phone (Expo Go)

```bash
cd frontend
npm install
npm start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). The phone must be on the **same
Wi-Fi** as the computer. The app automatically talks to the API on port 4311 of the computer running
Expo – no IP address to configure.

If the phone cannot connect, allow port 4311 through the firewall. On Windows, in an
**administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "NeuroLock API" -Direction Inbound -Protocol TCP -LocalPort 4311 -Action Allow
```

Press `w` in the Expo terminal to open the app in a browser instead.

---

## Placeholders you fill in

Nothing in this repository is tied to a particular computer. These are the values each person sets
for their own machine:

| What | Where | Placeholder in the repo | How to fill it |
|------|-------|-------------------------|----------------|
| Passwords and keys | `.env` (from `.env.example`) | `change-me-…` / empty | `node scripts/setup-env.mjs` |
| Your computer's Wi-Fi (LAN) IP – **only for building an APK** | `frontend/eas.json` → `EXPO_PUBLIC_API_URL` | `YOUR_PC_LAN_IP` | Windows: `ipconfig` (IPv4 Address of the Wi-Fi adapter) · macOS: `ipconfig getifaddr en0` · Linux: `hostname -I` |
| A fixed API address (optional – e.g. a deployed server) | `frontend/.env` (from `frontend/.env.example`) | commented out | `EXPO_PUBLIC_API_URL=https://your-server/api` |
| Demo account password | `.env` → `DEMO_PASSWORD` | `Demo@1234` | change it before exposing the system to anyone else |
| Settings for running without Docker | `neurolock-staff-backend/.env`, `backend/sql-dbms-bundle/sql-dbms/app/.env` | `.env.example` in each folder | `node scripts/setup-env.mjs --dev` |

---

## Build an Android APK

In Expo Go the app finds the API through the Expo server. An installed APK has no Expo server, so the
API address is built into the APK.

1. Put your computer's LAN IP into `frontend/eas.json`, replacing `YOUR_PC_LAN_IP`
   (see the table above). The Docker stack must be running on that computer when you use the APK.
2. Create a free account at https://expo.dev.
3. Build in Expo's cloud (no Android Studio needed):

   ```bash
   cd frontend
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```

   On the first build answer **Yes** to creating an EAS project and to generating an Android
   keystore. If EAS complains about uncommitted changes (your `eas.json` edit), set
   `EAS_NO_VCS=1` first (PowerShell: `$env:EAS_NO_VCS = "1"`, bash: `export EAS_NO_VCS=1`) so it
   uploads the folder as it is on disk.
4. After 10–20 minutes EAS prints a link and QR code. Open it on the phone, download the `.apk` and
   allow *Install unknown apps* when Android asks.

The `preview` profile builds an installable `.apk`; `production` builds a Play Store `.aab`. If the
computer's IP changes, edit `eas.json` and build again. The APK uses plain HTTP to the API on your
local network, which is fine for a demo; a real deployment should put the API behind HTTPS with a
proper certificate.

**Without an Expo account** (needs Android Studio with the Android SDK and JDK 17): set the IP as
`EXPO_PUBLIC_API_URL` in `frontend/.env`, then

```bash
cd frontend
npx expo prebuild -p android
cd android
./gradlew assembleRelease        # Windows: .\gradlew assembleRelease
```

The APK is written to `frontend/android/app/build/outputs/apk/release/` (signed with a debug key,
fine for testing).

---

## Demo accounts

Password **`Demo@1234`** for all of them (set by `DEMO_PASSWORD` in `.env`). Sign in with the
username.

| Username | Lands on |
|----------|----------|
| `admin` | role chooser (any role, or the Admin dashboard) |
| `psychiatrist` | Psychiatrist (Doctor) dashboard |
| `psychologist` | Psychologist dashboard |
| `therapist` | Therapist dashboard |
| `nurse` | Nurse dashboard |
| `patient` | Patient portal (MRN001) |

You can also **create an account** from the welcome screen. Patients are active immediately; staff
accounts wait until an administrator approves them (Admin → Staff → *Sign-up approvals*).

### Synthetic demo data (optional)

To make the clinic look busy, top it up with randomised but clinically consistent data:

```bash
docker compose exec api node dist/tools/seed-synthetic.js
```

It fills every role up to 6 active accounts (created in OpenLDAP through the AAA server, password
`Demo@1234`) and the clinic up to 48 patients, each with weeks of history: appointments, therapy
sessions with progress, assessments, vitals, medication rounds, care alerts and encrypted therapy
notes. It also signs a few people in through the real API so today's audit trail, security alerts,
pending sign-ups, password-reset and device requests look realistic. Options: `--per-role N`,
`--patients N`, `--no-activity`. Running it again only tops up; it never duplicates. Without Docker:
`cd neurolock-staff-backend && npm run seed:synthetic`.

---

## Everyday commands

Run these from the repository folder.

| Task | Command |
|------|---------|
| Status of every service | `docker compose ps` |
| Check every service and sign in with every demo account (Windows) | `powershell -ExecutionPolicy Bypass -File .\check_status.ps1` |
| AAA server log (sign-ins, decisions) | `docker compose logs -f aaa` |
| OpenLDAP log | `docker compose logs -f openldap` |
| Audit log received by rsyslog | `docker compose exec rsyslog tail -f /var/log/neurolock/audit.log` |
| REST API log | `docker compose logs -f api` |
| Everything at once | `docker compose logs -f` |
| Stop (keeps data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Rebuild after changing code | `docker compose up -d --build` |
| **Delete all data** and start fresh | `docker compose down -v` |

Look inside the LDAP directory (Git Bash/macOS/Linux):

```bash
export $(grep LDAP_ADMIN_PASSWORD .env)
docker compose exec openldap ldapsearch -x -ZZ -H ldap://localhost -D cn=admin,dc=neurolock,dc=local -w "$LDAP_ADMIN_PASSWORD" -b dc=neurolock,dc=local
```

Open the MySQL database: it listens on `127.0.0.1:3307` (this computer only), user `app` and the
`MYSQL_PASSWORD` from `.env`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `docker` is not recognised | Start Docker Desktop and open a new terminal. |
| `port is already allocated` for 80/443 | Another web server is using it. Stop it, or change `"443:443"`/`"80:80"` under `web` in `docker-compose.yml` (e.g. `"8443:443"`, then use https://localhost:8443). |
| `set MYSQL_ROOT_PASSWORD in .env` | `.env` is missing or empty – run `node scripts/setup-env.mjs`. |
| Changed `.env` after the first start and now MySQL/LDAP refuse to connect | The databases keep the passwords they were created with. Put the old values back, or `docker compose down -v` to start fresh (deletes all data). |
| Phone app shows "network error" | Same Wi-Fi as the computer, firewall allows port 4311, stack is running (`docker compose ps`). |
| Expo Go says the project is incompatible | Update Expo Go from the store (the project uses SDK 57). |
| `RATE_LIMITED` after many sign-in attempts | Wait 15 minutes, or `docker compose restart aaa api`. |
| `curl` on Windows fails with a revocation error against https://localhost | Add `--ssl-no-revoke` (Windows curl cannot check revocation for the private CA). |
| Services unhealthy after a reboot | `docker compose up -d`; check `docker compose logs aaa api`. |

---

## Run it without Docker (development)

1. **MySQL 8** on port 3307 with user `app` / `app123` (any local install), or only the database in
   Docker: `cd backend/sql-dbms-bundle/sql-dbms && docker compose up -d`.
2. **Settings:** `node scripts/setup-env.mjs --dev` creates `neurolock-staff-backend/.env` (and the
   Python client's `.env`) with a shared `KEK_HEX`.
3. **Certificates + AAA server** (Python 3.11+):
   ```bash
   python -m venv aaa-server/.venv
   aaa-server/.venv/Scripts/pip install -r aaa-server/requirements.txt   # macOS/Linux: aaa-server/.venv/bin/pip
   aaa-server/.venv/Scripts/python infra/certs/generate_certs.py infra/certs/dev
   cd aaa-server && .venv/Scripts/python dev_server.py --certs ../infra/certs/dev
   ```
   Without `LDAP_URL` the dev server uses an **in-memory directory** that is re-created with the
   demo accounts on every start (accounts created by sign-up disappear on restart). Point
   `LDAP_URL`/`LDAP_BIND_PASSWORD` at a real OpenLDAP to keep them.
4. **API:** `cd neurolock-staff-backend && npm install && npm run db:setup && npm run dev`.
5. **App:** `cd frontend && npm install && npm start`.

`start.bat` / `start.sh` (option 2) run these from a menu.

---

## How it works

### The three A's

* **Authentication** – the app sends username (or email) + password to the API; the API asks the
  AAA server, which binds to OpenLDAP *as that user* to check the password, applies lockout and
  TOTP MFA, and issues a session. Every later request is validated by the AAA server, so logout,
  deactivation and lockout take effect immediately.
* **Authorization** – on each request the API sends the session to the AAA server, which reads the
  user's role from LDAP and returns that role's permission set; the API enforces it. Roles are
  LDAP groups and each permission is an LDAP group whose members are roles, so administrators
  change access at runtime from **Admin → Roles**.
* **Accounting** – every sign-in, denial, record view and change is sent to the AAA server, which
  stores it (searchable in Admin → Audit) and forwards it to rsyslog
  (`/var/log/neurolock/audit.log`). The API never writes audit records itself.

Services only reach what the diagram allows (separate Docker networks): the website talks only to
the API, the API to MySQL and the AAA server, and only the AAA server to LDAP and rsyslog. The AAA
server accepts nothing but the API's client certificate, and rsyslog only the AAA server's.

### Sign-up and roles

* **Create an account** on the welcome screen: pick a role (Patient, Psychiatrist (Doctor),
  Psychologist, Therapist, Nurse – whatever roles an admin has offered for sign-up), enter your
  details and a password. *Administrator is never offered.*
* **Patients** are active immediately. A new patient record is created, or an existing one is
  linked if they enter their MRN with the matching date of birth.
* **Clinical staff** must give a licence/registration number and wait for an administrator to
  approve them (the admin may approve with a different role or reject).
* After that, signing in (username/password, or the saved session unlocked with fingerprint/face)
  goes **straight to the dashboard of the role assigned to the account**.
* **Administrators** are the exception: after signing in they choose which role to use – any role,
  including *Administrator* (admin dashboard). The 🔀 button switches role at any time. The server
  enforces exactly the chosen role's permissions and every switch is audited. The *Patient* option
  previews the portal with the demo patient's record.

### Who sees which patients (care teams)

Clinicians only see patients on their **care team**: patients they attend (doctor), treat
(assigned therapist/psychologist), or have been added to as a care-team member (any role, e.g. a ward
nurse). This applies to every screen and API: patient list, profiles, notes, assessments, medications
and the nurse medication round, appointments, session logs, vitals, alerts and reports. Opening anyone
else is refused (`403 NOT_ON_CARE_TEAM`) and audited.

* Registering a patient puts you on their care team, and the form lets you pick the doctor,
  therapist/psychologist and any other staff from the roster.
* Scheduling an appointment for a clinician, or a patient booking one in the portal, adds that
  clinician to the care team.
* `patients:read_all` ("View all patients") lifts the restriction; only Administrators have it by
  default, and admins can grant it to any role in Admin → Roles.
* Break-glass emergency access opens one patient for 60 minutes (critical alert, audited).
* An admin previewing a clinical role sees the caseload of that role's demo account.

Patients get **My Health**: own profile, upcoming/past appointments (book with a clinician, cancel up
to 2 hours before), current medications and assessment results. They can never see therapy notes,
other patients or staff data.

### Default role permissions (editable at runtime)

| Capability | Psychiatrist | Psychologist | Therapist | Nurse | Admin | Patient |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View patients (own care team) | ✓ | ✓ | ✓ | ✓ | ✓ | own record |
| View **all** patients | – | – | – | – | ✓ | – |
| Sensitive details (DOB, contacts, insurance) | ✓ | ✓ | – | ✓ | – | own |
| Register / edit patients | ✓ | ✓ | – | – | ✓ | – |
| Read / write encrypted therapy notes | ✓ | ✓ | ✓ | – | – | – |
| Break-glass emergency note access | ✓ | – | – | ✓ | – | – |
| Assessments: view / schedule / record | ✓ ✓ ✓ | ✓ ✓ ✓ (+delete) | view | – | – | own results |
| Medications: view / prescribe / change | ✓ ✓ ✓ | – | – | view | – | own current |
| Administer medication, record vitals | view vitals | – | – | ✓ | – | – |
| Appointments, session logs, progress | ✓ | ✓ | ✓ | view appts | view appts | book / cancel own |
| Reports (view / generate) | ✓ ✓ | ✓ ✓ | – | – | view | – |
| Staff, sign-up approvals, roles, audit, security | – | – | – | – | ✓ | – |
| Switch role view | – | – | – | – | ✓ | – |

### Security features

**Authentication** – LDAP-verified passwords (SSHA), lockout for 15 min after 5 failures (admins
can unlock; locked users can request it), optional TOTP MFA with 10 single-use backup codes (secrets
encrypted at rest), step-up re-authentication (10 min) before reading notes, editing roles,
issuing resets or registering devices, admin-issued one-time password-reset codes, biometric
unlock of the saved session on the device, automatic sign-out after inactivity.

**Authorization** – LDAP-backed dynamic RBAC as above; denied requests return 403 and are audited;
sensitive patient fields masked unless permitted; therapy notes encrypted per note (AES-256-GCM,
key wrapped by the KEK, bound to the patient); versioned edits; break-glass access with written
reason, 60-minute window and a critical alert. The system refuses changes that would leave nobody
able to manage staff or roles.

**Accounting** – every event in the AAA audit store and rsyslog: who, role (including "viewing
as"), action, resource, patient, outcome, severity, IP and device. Admin Audit tab with filters and
CSV export; Security centre with alert review, active sessions, password-reset and device requests.

**Transport** – HTTPS for the website (nginx), mutual TLS between API and AAA server, StartTLS
enforced on LDAP, TLS with client certificates to rsyslog.

---

## Tests

```bash
cd aaa-server && python -m pytest          # AAA server: logins, lockout, MFA, sign-up/approval,
                                           # act-as, dynamic permissions, accounting (in-memory LDAP)
cd neurolock-staff-backend
npm test                                   # API unit tests (encryption, validation, proxy trust, permissions)
npm run smoke                              # end-to-end against the running stack (206 checks)
npm run typecheck
cd ../frontend && npx tsc --noEmit
```

Run the smoke test against fresh demo data; it creates accounts, records and sign-ups.

## Project layout

```
aaa-server/app        service (authn/authz), admin (accounts, sign-ups, roles, security), directory (LDAP),
                      accounting (store + syslog), routes (/v1 API for the REST API only), bootstrap
neurolock-staff-backend/src
  infra/aaa-client    mutual-TLS client for the AAA server
  middlewares/        authenticate (AAA authorize), requirePermission, step-up, rate limiting
  routes/             auth/staff/roles/audit/security/devices (relayed to AAA), clinical routes, portal
  services/           audit (→ AAA accounting), directory mirror, care-team scope, demo seed
  tools/              synthetic demo-data generator
frontend/
  App.tsx             navigation per auth state (signed out / MFA / biometric / choose role / signed in)
  components/         Signup, RoleSelection (admin chooser), PatientDashboard (portal), MyAccess, dashboards…
  eas.json            APK / app-bundle build profiles
backend/sql-dbms-bundle/sql-dbms
  db/init/            MySQL schema and demo data (loaded on the first start)
infra/                certificate generator, rsyslog image
scripts/setup-env.mjs creates .env files with random secrets
docker-compose.yml    certgen, mysql, openldap, rsyslog, aaa, api, web
```

## Not included

* SMS/email one-time codes and hardware security keys (WebAuthn) need a gateway/server; they show as
  unavailable in the app.
* The certificates come from a private development CA. Use your organisation's PKI, strong secrets,
  a changed `DEMO_PASSWORD` (or `SEED_DEMO=false`) and a restricted `CORS_ORIGINS` for any real
  deployment.

Older setup notes from before this rebuild are in `docs/archive/` and are out of date.
