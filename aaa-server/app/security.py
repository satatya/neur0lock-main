"""Small crypto helpers: tokens, codes, TOTP, password hashing for LDAP, secret sealing."""
import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import pyotp
from cryptography.fernet import Fernet, InvalidToken

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso() -> str:
    return iso(now())


def in_minutes(minutes: int) -> str:
    return iso(now() + timedelta(minutes=minutes))


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def random_code(length: int) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


# --- Passwords -------------------------------------------------------------

def ssha_hash(password: str) -> str:
    """Salted SHA-1 in the {SSHA} format OpenLDAP verifies natively."""
    salt = os.urandom(8)
    digest = hashlib.sha1(password.encode("utf-8") + salt).digest()
    return "{SSHA}" + base64.b64encode(digest + salt).decode("ascii")


def ssha_check(password: str, stored: str | bytes) -> bool:
    if isinstance(stored, bytes):
        stored = stored.decode("utf-8", "ignore")
    if not stored.upper().startswith("{SSHA}"):
        return constant_time_equal(password, stored)
    raw = base64.b64decode(stored[6:])
    digest, salt = raw[:20], raw[20:]
    return hmac.compare_digest(hashlib.sha1(password.encode("utf-8") + salt).digest(), digest)


def password_problem(password: str) -> str | None:
    """Password policy: 8-128 characters with at least one letter and one digit."""
    if len(password or "") < 8 or len(password) > 128:
        return "Password must be between 8 and 128 characters"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must contain at least one letter and one number"
    return None


# --- TOTP (RFC 6238) ----------------------------------------------------------

def new_totp_secret() -> str:
    return pyotp.random_base32(32)


def verify_totp(secret: str, code: str) -> bool:
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def otpauth_url(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name="NeuroLock")


# --- Secret sealing -----------------------------------------------------------

class Sealer:
    def __init__(self, key: str):
        self._fernet = Fernet(key.encode("ascii") if isinstance(key, str) else key)

    def seal(self, value: str) -> bytes:
        return self._fernet.encrypt(value.encode("utf-8"))

    def open(self, sealed: bytes) -> str:
        try:
            return self._fernet.decrypt(sealed).decode("utf-8")
        except InvalidToken as exc:  # pragma: no cover - indicates a wrong AAA_SECRET_KEY
            raise RuntimeError("Cannot decrypt stored secret (wrong AAA_SECRET_KEY?)") from exc
