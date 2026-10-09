"""AAA server configuration (environment variables)."""
import os


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, ""))
    except ValueError:
        return default


class Config:
    def __init__(self, **overrides):
        # Directory (OpenLDAP). "mock://" runs an in-memory directory for tests and local development.
        self.LDAP_URL = os.getenv("LDAP_URL", "ldap://openldap:389")
        self.LDAP_BASE_DN = os.getenv("LDAP_BASE_DN", "dc=neurolock,dc=local")
        self.LDAP_BIND_DN = os.getenv("LDAP_BIND_DN", "cn=admin,dc=neurolock,dc=local")
        self.LDAP_BIND_PASSWORD = os.getenv("LDAP_BIND_PASSWORD", "")
        self.LDAP_START_TLS = _bool("LDAP_START_TLS", True)
        self.LDAP_CA_FILE = os.getenv("LDAP_CA_FILE", "/certs/ca.crt")

        # Operational state (sessions, lockout, MFA, audit index)
        self.DB_PATH = os.getenv("AAA_DB_PATH", "/data/aaa.sqlite3")
        # Fernet key (urlsafe base64, 32 bytes) used to encrypt TOTP secrets at rest
        self.SECRET_KEY = os.getenv("AAA_SECRET_KEY", "")

        self.SESSION_TTL_MINUTES = _int("SESSION_TTL_MINUTES", 8 * 60)
        self.STEP_UP_TTL_MINUTES = _int("STEP_UP_TTL_MINUTES", 10)
        self.MFA_CHALLENGE_TTL_MINUTES = 5
        self.RESET_CODE_TTL_MINUTES = 30
        self.LOCKOUT_MAX_ATTEMPTS = _int("LOCKOUT_MAX_ATTEMPTS", 5)
        self.LOCKOUT_MINUTES = _int("LOCKOUT_MINUTES", 15)

        # Accounting: RFC 5424 over TLS (RFC 5425) to rsyslog. Empty host disables forwarding.
        self.SYSLOG_HOST = os.getenv("SYSLOG_HOST", "")
        self.SYSLOG_PORT = _int("SYSLOG_PORT", 6514)
        self.SYSLOG_CA_FILE = os.getenv("SYSLOG_CA_FILE", "/certs/ca.crt")
        self.SYSLOG_CERT_FILE = os.getenv("SYSLOG_CERT_FILE", "/certs/aaa.crt")
        self.SYSLOG_KEY_FILE = os.getenv("SYSLOG_KEY_FILE", "/certs/aaa.key")

        # Demo data
        self.SEED_DEMO = _bool("SEED_DEMO", True)
        self.DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@1234")
        # Patient account an administrator previews when switching to the Patient role
        self.DEMO_PATIENT_UID = os.getenv("DEMO_PATIENT_UID", "patient")
        self.DEV_SHOW_RESET_CODES = _bool("DEV_SHOW_RESET_CODES", False)

        for key, value in overrides.items():
            setattr(self, key, value)

    def validate(self) -> None:
        if not self.LDAP_URL.startswith("mock://") and not self.LDAP_BIND_PASSWORD:
            raise RuntimeError("LDAP_BIND_PASSWORD is required")
        if not self.SECRET_KEY:
            raise RuntimeError("AAA_SECRET_KEY is required (generate: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")")
