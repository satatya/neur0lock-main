"""Permission catalog and default role definitions.

The catalog says which permission codes exist and what they mean. Which ROLE holds which
permission is stored in the directory (LDAP) and is edited at runtime by administrators;
DEFAULT_ROLES is only used to create the built-in roles the first time the directory is empty.
"""

PERMISSIONS = [
    # code, category, label, description
    ("patients:read", "Patients", "View patients", "View patients on your care team (attending, therapist or care-team member)"),
    ("patients:read_all", "Patients", "View all patients", "See every patient in the clinic, not only those on your care team"),
    ("patients:read_sensitive", "Patients", "View sensitive details", "Reveal date of birth, contact details, emergency contact and insurance"),
    ("patients:create", "Patients", "Register patients", "Create new patient records"),
    ("patients:update", "Patients", "Edit patients", "Edit patient demographics, diagnosis and care team"),
    ("patients:delete", "Patients", "Delete patients", "Permanently delete patient records"),
    ("notes:read", "Therapy notes", "Read therapy notes", "Decrypt and read therapy notes (requires re-authentication)"),
    ("notes:create", "Therapy notes", "Write therapy notes", "Create encrypted therapy notes"),
    ("notes:update", "Therapy notes", "Edit own notes", "Edit therapy notes you authored (versioned)"),
    ("notes:delete", "Therapy notes", "Delete notes", "Delete therapy notes"),
    ("notes:emergency_access", "Therapy notes", "Emergency access", "Break-glass access to a patient's notes for 60 minutes (flagged for review)"),
    ("assessments:read", "Assessments", "View assessments", "View psychological assessments"),
    ("assessments:create", "Assessments", "Schedule assessments", "Schedule new assessments"),
    ("assessments:update", "Assessments", "Update assessments", "Record results and change assessment status"),
    ("assessments:delete", "Assessments", "Delete assessments", "Delete assessments"),
    ("medications:read", "Medications", "View medications", "View prescriptions and the medication schedule"),
    ("medications:prescribe", "Medications", "Prescribe", "Prescribe new medication"),
    ("medications:update", "Medications", "Change prescriptions", "Change, hold or discontinue prescriptions"),
    ("medications:administer", "Medications", "Administer", "Record medication administration"),
    ("appointments:read", "Appointments", "View appointments", "View appointments"),
    ("appointments:create", "Appointments", "Schedule appointments", "Schedule appointments"),
    ("appointments:update", "Appointments", "Manage appointments", "Reschedule, complete or cancel appointments"),
    ("sessions:read", "Therapy sessions", "View session logs", "View therapy session logs and progress"),
    ("sessions:write", "Therapy sessions", "Log sessions", "Log therapy sessions and update client progress"),
    ("vitals:read", "Vitals", "View vitals", "View vital signs"),
    ("vitals:record", "Vitals", "Record vitals", "Record vital signs"),
    ("alerts:read", "Patient alerts", "View patient alerts", "View patient care alerts"),
    ("alerts:manage", "Patient alerts", "Manage patient alerts", "Raise and acknowledge patient care alerts"),
    ("reports:read", "Reports", "View reports", "View generated clinical reports"),
    ("reports:generate", "Reports", "Generate reports", "Generate clinical reports"),
    ("portal:access", "Patient portal", "View own records", "Patients see their own profile, appointments, medications and assessment results"),
    ("portal:book", "Patient portal", "Book appointments", "Patients book and cancel their own appointments"),
    ("staff:read", "Administration", "View staff", "View the staff directory and account status"),
    ("staff:manage", "Administration", "Manage staff", "Create, approve, edit, lock, unlock and deactivate accounts"),
    ("roles:manage", "Administration", "Manage roles & permissions", "Create roles and change which permissions each role has"),
    ("audit:read", "Administration", "View audit log", "View the system audit log"),
    ("security:read", "Administration", "View security alerts", "View security alerts, sessions and device requests"),
    ("admin:act_as", "Administration", "Switch role view", "Open the app as any role for testing (audited)"),
]

PERMISSION_CODES = [code for code, *_ in PERMISSIONS]
PERMISSION_INFO = {code: {"category": cat, "label": label, "description": desc} for code, cat, label, desc in PERMISSIONS}

# Permissions that keep the system administrable; changes that would leave no active holder are refused.
ADMIN_CRITICAL = ["roles:manage", "staff:manage"]

# Role flags (stored as LDAP businessCategory values on the role group)
FLAG_SYSTEM = "system"  # built-in, cannot be deleted
FLAG_SIGNUP = "signup"  # offered on the public sign-up form
FLAG_APPROVAL = "approval"  # self sign-ups need administrator approval
FLAG_PATIENT = "patient"  # accounts in this role are patients (linked to a patient record)

DEFAULT_ROLES = {
    "admin": {
        "display_name": "Administrator",
        "description": "Staff management, role permissions, audit and security oversight",
        "flags": [FLAG_SYSTEM],
        "permissions": [
            "patients:read", "patients:read_all", "patients:create", "patients:update", "patients:delete",
            "appointments:read", "reports:read",
            "staff:read", "staff:manage", "roles:manage", "audit:read", "security:read", "admin:act_as",
        ],
    },
    "psychiatrist": {
        "display_name": "Psychiatrist (Doctor)",
        "description": "Full clinical access including prescriptions and therapy notes",
        "flags": [FLAG_SYSTEM, FLAG_SIGNUP, FLAG_APPROVAL],
        "permissions": [
            "patients:read", "patients:read_sensitive", "patients:create", "patients:update",
            "notes:read", "notes:create", "notes:update", "notes:emergency_access",
            "assessments:read", "assessments:create", "assessments:update",
            "medications:read", "medications:prescribe", "medications:update",
            "appointments:read", "appointments:create", "appointments:update",
            "sessions:read", "sessions:write", "vitals:read",
            "alerts:read", "alerts:manage", "reports:read", "reports:generate",
        ],
    },
    "psychologist": {
        "display_name": "Psychologist",
        "description": "Therapy notes and psychological assessments (no prescriptions)",
        "flags": [FLAG_SYSTEM, FLAG_SIGNUP, FLAG_APPROVAL],
        "permissions": [
            "patients:read", "patients:read_sensitive", "patients:create", "patients:update",
            "notes:read", "notes:create", "notes:update",
            "assessments:read", "assessments:create", "assessments:update", "assessments:delete",
            "appointments:read", "appointments:create", "appointments:update",
            "sessions:read", "sessions:write", "alerts:read", "reports:read", "reports:generate",
        ],
    },
    "therapist": {
        "display_name": "Therapist",
        "description": "Session logs, progress tracking and therapy notes for clients",
        "flags": [FLAG_SYSTEM, FLAG_SIGNUP, FLAG_APPROVAL],
        "permissions": [
            "patients:read", "notes:read", "notes:create", "notes:update",
            "assessments:read", "appointments:read", "appointments:create", "appointments:update",
            "sessions:read", "sessions:write", "alerts:read",
        ],
    },
    "nurse": {
        "display_name": "Nurse",
        "description": "Medication administration, vitals and patient alerts",
        "flags": [FLAG_SYSTEM, FLAG_SIGNUP, FLAG_APPROVAL],
        "permissions": [
            "patients:read", "patients:read_sensitive", "medications:read", "medications:administer",
            "vitals:read", "vitals:record", "alerts:read", "alerts:manage",
            "appointments:read", "notes:emergency_access",
        ],
    },
    "patient": {
        "display_name": "Patient",
        "description": "Book appointments and view your own records",
        "flags": [FLAG_SYSTEM, FLAG_SIGNUP, FLAG_PATIENT],
        "permissions": ["portal:access", "portal:book"],
    },
}

# Demo accounts created on first start (one per role). Password: Config.DEMO_PASSWORD
DEMO_USERS = [
    {"uid": "admin", "name": "Admin User", "email": "admin@neurolock.com", "role": "admin", "phone": "+91-90000-00001"},
    {"uid": "psychiatrist", "name": "Dr. Jane Smith", "email": "psychiatrist@neurolock.com", "role": "psychiatrist", "phone": "+91-90000-00002"},
    {"uid": "psychologist", "name": "Dr. Priya Rao", "email": "psychologist@neurolock.com", "role": "psychologist", "phone": "+91-90000-00003"},
    {"uid": "therapist", "name": "John Therapist", "email": "therapist@neurolock.com", "role": "therapist", "phone": "+91-90000-00004"},
    {"uid": "nurse", "name": "Sarah Nurse", "email": "nurse@neurolock.com", "role": "nurse", "phone": "+91-90000-00005"},
    {"uid": "patient", "name": "Riya Jain", "email": "patient@neurolock.com", "role": "patient", "phone": "+91-90000-11111"},
]
