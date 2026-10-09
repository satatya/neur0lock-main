"""Authentication and authorization core of the AAA server.

Authentication  - password check by binding to LDAP as the user, lockout, TOTP MFA,
                  backup codes, step-up re-authentication, password reset, sign-up.
Authorization   - sessions are validated here and the effective permission set is computed
                  from LDAP role membership (administrators may "act as" another role).
Accounting      - every decision is recorded through Accounting.
"""
import json
import re
import threading
import time
import uuid

from . import catalog
from .accounting import Accounting
from .directory import UID_RE, Directory
from .errors import AAAError, bad_request, conflict, forbidden, unauthorized
from .security import (
    Sealer,
    in_minutes,
    new_token,
    new_totp_secret,
    normalize_code,
    now,
    now_iso,
    otpauth_url,
    parse_iso,
    password_problem,
    random_code,
    sha256,
    ssha_check,
    ssha_hash,
    verify_totp,
)
from .store import Store

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
BACKUP_CODE_COUNT = 10
SETTINGS_KEYS = {
    "auto_lock_minutes": int,
    "language": str,
    "timezone": str,
    "date_format": str,
    "email_notifications": bool,
    "security_alerts": bool,
    "session_reminders": bool,
    "login_alerts": bool,
}

_DUMMY_HASH = ssha_hash(new_token())


class Context:
    """Who is calling and what they may do, for one validated session."""

    def __init__(self, session: dict, user: dict, account: dict, base_role: str | None, role_info: dict, permissions: set, base_permissions: set, acting_role: str | None, step_up: bool):
        self.session = session
        self.user = user
        self.account = account
        self.base_role = base_role
        self.role_info = role_info
        self.permissions = permissions
        self.base_permissions = base_permissions
        self.acting_role = acting_role
        self.step_up = step_up

    @property
    def uid(self) -> str:
        return self.user["uid"]

    def can(self, code: str) -> bool:
        return code in self.permissions


class AAAService:
    def __init__(self, config, directory: Directory, store: Store, accounting: Accounting):
        self.config = config
        self.directory = directory
        self.store = store
        self.accounting = accounting
        self.sealer = Sealer(config.SECRET_KEY)
        self._cache_lock = threading.Lock()
        self._rbac_cache = None  # (version, loaded_at, role_perms, roles_by_name)
        self._user_role_cache: dict[str, tuple[str, float, list[str]]] = {}

    # ================================================================== RBAC data
    def rbac(self) -> tuple[dict[str, set], dict[str, dict]]:
        """role -> permission set, and role name -> role info. Cached; invalidated across workers."""
        version = self.store.get_meta("rbac_version", "0")
        with self._cache_lock:
            cached = self._rbac_cache
            if cached and cached[0] == version and time.time() - cached[1] < 60:
                return cached[2], cached[3]
        holders = self.directory.permission_holders()
        role_perms: dict[str, set] = {}
        for code, roles in holders.items():
            if code not in catalog.PERMISSION_INFO:
                continue
            for role in roles:
                role_perms.setdefault(role, set()).add(code)
        roles = {role["name"]: role for role in self.directory.list_roles()}
        for name in roles:
            role_perms.setdefault(name, set())
        with self._cache_lock:
            self._rbac_cache = (version, time.time(), role_perms, roles)
        return role_perms, roles

    def bump_rbac(self) -> None:
        self.store.bump("rbac_version")
        with self._cache_lock:
            self._rbac_cache = None
            self._user_role_cache.clear()

    def user_roles(self, uid: str) -> list[str]:
        version = self.store.get_meta("rbac_version", "0")
        cached = self._user_role_cache.get(uid)
        if cached and cached[0] == version and time.time() - cached[1] < 30:
            return cached[2]
        roles = self.directory.user_roles(uid)
        self._user_role_cache[uid] = (version, time.time(), roles)
        return roles

    def permissions_for_roles(self, roles: list[str]) -> set:
        role_perms, _ = self.rbac()
        result: set = set()
        for role in roles:
            result |= role_perms.get(role, set())
        return result

    # ================================================================== accounts
    def ensure_account(self, user: dict, status: str = "active") -> dict:
        account = self.store.account(user["uid"])
        if account:
            return account
        _, roles = self.rbac()
        kind = "patient" if any(catalog.FLAG_PATIENT in roles.get(r, {}).get("flags", []) for r in self.user_roles(user["uid"])) else "staff"
        self.store.execute(
            "INSERT OR IGNORE INTO accounts (uid, kind, status, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)",
            (user["uid"], kind, status, now_iso(), now_iso()),
        )
        return self.store.account(user["uid"])

    @staticmethod
    def temporarily_locked(account: dict) -> bool:
        until = parse_iso(account.get("locked_until"))
        return bool(until and until > now())

    def public_user(self, user: dict, account: dict | None = None, roles: list[str] | None = None, acting_role: str | None = None) -> dict:
        account = account or self.store.account(user["uid"]) or {}
        roles = roles if roles is not None else self.user_roles(user["uid"])
        role_perms, role_info = self.rbac()
        base_role = roles[0] if roles else None
        effective_role = acting_role or base_role
        info = role_info.get(effective_role or "", {})
        base_info = role_info.get(base_role or "", {})
        locked_until = account.get("locked_until") if account and self.temporarily_locked(account) else None
        pending = None
        if account.get("status") == "pending":
            pending = self.store.one("SELECT requested_role FROM signups WHERE uid = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", (user["uid"],))
        portal_uid = None
        view_as = None
        if catalog.FLAG_PATIENT in info.get("flags", []):
            portal_uid = self.config.DEMO_PATIENT_UID if acting_role else user["uid"]
        elif acting_role:
            view_as = self._preview_account(acting_role)
        return {
            "uid": user["uid"],
            "name": user.get("name"),
            "email": user.get("email"),
            "phone": user.get("phone"),
            "title": user.get("title"),
            "licence_number": user.get("licence_number"),
            "role": effective_role,
            "role_name": info.get("display_name") or effective_role,
            "base_role": base_role,
            "base_role_name": base_info.get("display_name") or base_role,
            "acting_role": acting_role,
            "kind": account.get("kind", "staff"),
            "status": account.get("status", "active"),
            "requested_role": pending["requested_role"] if pending else None,
            "mfa_enabled": bool(account.get("mfa_enabled")),
            "locked_until": locked_until,
            "lock_reason": account.get("lock_reason") if (locked_until or account.get("status") == "locked") else None,
            "failed_login_attempts": account.get("failed_login_attempts", 0),
            "last_login_at": account.get("last_login_at"),
            "created_at": account.get("created_at"),
            "portal_uid": portal_uid,
            # Administrator previewing a clinical role: whose care team (patients) the preview shows
            "view_as": view_as,
            "can_act_as": "admin:act_as" in role_perms.get(base_role or "", set()),
        }

    def _preview_account(self, role: str) -> dict | None:
        """The demo account of `role`, used so an administrator previewing that role sees a realistic
        caseload. None for roles without a demo account (the preview then shows the admin's own)."""
        demo = next((d for d in catalog.DEMO_USERS if d["role"] == role), None)
        if not demo or role not in self.user_roles(demo["uid"]):
            return None
        account = self.directory.get_user(demo["uid"])
        return {"uid": account["uid"], "name": account["name"]} if account else None

    # ================================================================== audit helper
    def audit(self, client: dict, event: dict, ctx: Context | None = None, user: dict | None = None) -> None:
        if ctx:
            event.setdefault("actor", ctx.user.get("email"))
            event.setdefault("actor_uid", ctx.uid)
            event.setdefault("actor_name", ctx.user.get("name"))
            event.setdefault("actor_role", ctx.acting_role or ctx.base_role)
        elif user:
            event.setdefault("actor", user.get("email"))
            event.setdefault("actor_uid", user.get("uid"))
            event.setdefault("actor_name", user.get("name"))
        event.setdefault("ip", client.get("ip"))
        event.setdefault("user_agent", client.get("user_agent"))
        self.accounting.record(event)

    # ================================================================== sessions & authorization
    def _create_session(self, uid: str, client: dict) -> tuple[str, dict]:
        token = new_token()
        session_id = str(uuid.uuid4())
        self.store.execute(
            "INSERT INTO sessions (id, token_hash, uid, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, sha256(token), uid, now_iso(), in_minutes(self.config.SESSION_TTL_MINUTES), now_iso(), client.get("ip"), (client.get("user_agent") or "")[:255]),
        )
        return token, self.store.one("SELECT * FROM sessions WHERE id = ?", (session_id,))

    def revoke_sessions(self, uid: str, except_session: str | None = None) -> int:
        cursor = self.store.execute(
            "UPDATE sessions SET revoked_at = ? WHERE uid = ? AND revoked_at IS NULL AND (? IS NULL OR id <> ?)",
            (now_iso(), uid, except_session, except_session),
        )
        return cursor.rowcount

    def context(self, token: str | None, step_up_token: str | None = None, touch: bool = True) -> Context:
        if not token:
            raise unauthorized()
        session = self.store.one(
            "SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
            (sha256(token), now_iso()),
        )
        if not session:
            raise unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED")
        return self._build_context(session, step_up_token, touch)

    def _build_context(self, session: dict, step_up_token: str | None = None, touch: bool = True) -> Context:
        account = self.store.account(session["uid"])
        user = self.directory.get_user(session["uid"])
        if not account or not user or account["status"] != "active" or self.temporarily_locked(account):
            self.store.execute("UPDATE sessions SET revoked_at = ? WHERE id = ?", (now_iso(), session["id"]))
            raise unauthorized("This account is locked or deactivated. Contact your administrator.", "ACCOUNT_DISABLED")

        roles = self.user_roles(user["uid"])
        base_role = roles[0] if roles else None
        base_permissions = self.permissions_for_roles(roles)
        _, role_info = self.rbac()
        acting_role = session.get("acting_role")
        if acting_role and ("admin:act_as" not in base_permissions or acting_role not in role_info):
            acting_role = None
        permissions = self.permissions_for_roles([acting_role]) if acting_role else base_permissions

        step_up = False
        if step_up_token:
            step_up = bool(
                self.store.one(
                    "SELECT 1 FROM step_ups WHERE token_hash = ? AND session_id = ? AND expires_at > ?",
                    (sha256(step_up_token), session["id"], now_iso()),
                )
            )
        if touch:
            last_seen = parse_iso(session.get("last_seen_at"))
            if not last_seen or (now() - last_seen).total_seconds() > 60:
                self.store.execute("UPDATE sessions SET last_seen_at = ? WHERE id = ?", (now_iso(), session["id"]))
        return Context(session, user, account, base_role, role_info, permissions, base_permissions, acting_role, step_up)

    def authorize(self, token: str, step_up_token: str | None, required: list[str], mode: str, client: dict, request_info: dict | None = None) -> dict:
        ctx = self.context(token, step_up_token)
        if mode == "any":
            allowed = not required or any(code in ctx.permissions for code in required)
            missing = [] if allowed else list(required)
        else:
            missing = [code for code in required if code not in ctx.permissions]
            allowed = not missing
        if not allowed:
            self.audit(client, {"action": "access_denied", "resource": "permission", "outcome": "denied", "severity": "low", "details": {**(request_info or {}), "missing": missing}}, ctx)
        return {
            "allowed": allowed,
            "missing": missing,
            "user": self.public_user(ctx.user, ctx.account, [ctx.base_role] if ctx.base_role else [], ctx.acting_role),
            "permissions": sorted(ctx.permissions),
            "step_up": ctx.step_up,
            "session": {"id": ctx.session["id"], "expires_at": ctx.session["expires_at"]},
        }

    # ================================================================== login
    def _locked_error(self, account: dict) -> AAAError:
        if account.get("status") == "locked":
            return AAAError(423, "ACCOUNT_LOCKED", "This account has been locked by an administrator.", {"lock_reason": account.get("lock_reason") or "admin-lock", "locked_until": None})
        until = parse_iso(account.get("locked_until")) or now()
        minutes = max(1, int((until - now()).total_seconds() // 60) + 1)
        return AAAError(
            423,
            "ACCOUNT_LOCKED",
            f"Account temporarily locked after too many failed attempts. Try again in {minutes} minute(s).",
            {"lock_reason": account.get("lock_reason") or "failed-attempts", "locked_until": account.get("locked_until"), "minutes_remaining": minutes, "max_attempts": self.config.LOCKOUT_MAX_ATTEMPTS},
        )

    def _failed_attempt(self, user: dict, client: dict, stage: str) -> None:
        uid = user["uid"]
        self.store.execute("UPDATE accounts SET failed_attempts = failed_attempts + 1 WHERE uid = ?", (uid,))
        attempts = self.store.one("SELECT failed_attempts FROM accounts WHERE uid = ?", (uid,))["failed_attempts"]
        if attempts >= self.config.LOCKOUT_MAX_ATTEMPTS:
            self.store.execute(
                "UPDATE accounts SET locked_until = ?, lock_reason = 'failed-attempts', failed_attempts = 0 WHERE uid = ?",
                (in_minutes(self.config.LOCKOUT_MINUTES), uid),
            )
            self.revoke_sessions(uid)
            self.audit(client, {"action": "account_locked", "resource": "auth", "resource_id": uid, "outcome": "failure", "severity": "high", "details": {"stage": stage, "attempts": attempts, "lock_minutes": self.config.LOCKOUT_MINUTES}}, user=user)
            raise self._locked_error(self.store.account(uid))
        action = {"password": "login_failed", "mfa": "mfa_failed"}.get(stage, "step_up_failed")
        severity = "medium" if attempts >= self.config.LOCKOUT_MAX_ATTEMPTS - 2 else "low"
        self.audit(client, {"action": action, "resource": "auth", "resource_id": uid, "outcome": "failure", "severity": severity, "details": {"attempts": attempts}}, user=user)
        message = {"password": "Invalid username or password", "mfa": "Invalid verification code"}.get(stage, "Verification failed")
        raise AAAError(401, "INVALID_CREDENTIALS" if stage == "password" else "INVALID_CODE", message, {"attempts_remaining": self.config.LOCKOUT_MAX_ATTEMPTS - attempts})

    def _assert_usable(self, account: dict) -> None:
        status = account.get("status")
        if status == "pending":
            raise AAAError(403, "ACCOUNT_PENDING", "Your account is awaiting administrator approval. You will be able to sign in once it is approved.")
        if status == "rejected":
            raise AAAError(403, "ACCOUNT_REJECTED", "Your registration was not approved. Contact the clinic administrator.")
        if status == "inactive":
            raise AAAError(403, "ACCOUNT_DISABLED", "This account has been deactivated. Contact your administrator.")
        if status == "locked" or self.temporarily_locked(account):
            raise self._locked_error(account)

    def _session_payload(self, user: dict, client: dict, method: str) -> dict:
        uid = user["uid"]
        self.store.execute(
            "UPDATE accounts SET failed_attempts = 0, locked_until = NULL, lock_reason = CASE WHEN status = 'locked' THEN lock_reason ELSE NULL END, last_login_at = ?, last_login_ip = ? WHERE uid = ?",
            (now_iso(), client.get("ip"), uid),
        )
        token, session = self._create_session(uid, client)
        roles = self.user_roles(uid)
        self.audit(client, {"action": "login_success", "resource": "auth", "resource_id": uid, "details": {"method": method, "role": roles[0] if roles else None}}, user=user)
        return {
            "token": token,
            "expires_at": session["expires_at"],
            "user": self.public_user(user, self.store.account(uid), roles),
            "permissions": sorted(self.permissions_for_roles(roles)),
        }

    def login(self, identifier: str, password: str, client: dict) -> dict:
        user = self.directory.find_user(identifier)
        if not user:
            ssha_check(password or "", _DUMMY_HASH)  # equalise timing
            self.audit(client, {"actor": identifier, "action": "login_failed", "resource": "auth", "outcome": "failure", "severity": "low", "details": {"reason": "unknown_account"}})
            raise AAAError(401, "INVALID_CREDENTIALS", "Invalid username or password")
        account = self.ensure_account(user)
        if account["status"] == "locked" or self.temporarily_locked(account):
            self.audit(client, {"action": "login_blocked", "resource": "auth", "resource_id": user["uid"], "outcome": "denied", "severity": "medium", "details": {"reason": "locked"}}, user=user)
            raise self._locked_error(account)
        if not self.directory.verify_password(user["uid"], password):
            self._failed_attempt(user, client, "password")
        if account["status"] != "active":
            self.audit(client, {"action": "login_blocked", "resource": "auth", "resource_id": user["uid"], "outcome": "denied", "severity": "low", "details": {"reason": account["status"]}}, user=user)
            self._assert_usable(account)
        if not self.user_roles(user["uid"]):
            raise AAAError(403, "NO_ROLE", "No role is assigned to this account. Contact your administrator.")
        if account["mfa_enabled"]:
            token = new_token()
            self.store.execute("INSERT INTO mfa_challenges (token_hash, uid, expires_at) VALUES (?, ?, ?)", (sha256(token), user["uid"], in_minutes(self.config.MFA_CHALLENGE_TTL_MINUTES)))
            self.audit(client, {"action": "login_mfa_challenge", "resource": "auth", "resource_id": user["uid"]}, user=user)
            return {"mfa_required": True, "mfa_token": token, "methods": ["totp", "backup_code"], "user": {"name": user["name"], "email": user["email"]}}
        return self._session_payload(user, client, "password")

    def verify_mfa(self, mfa_token: str, code: str | None, backup_code: str | None, client: dict) -> dict:
        expired = AAAError(401, "MFA_EXPIRED", "Your verification step expired. Please sign in again.")
        challenge = self.store.one("SELECT * FROM mfa_challenges WHERE token_hash = ? AND used = 0 AND expires_at > ?", (sha256(mfa_token or ""), now_iso()))
        if not challenge:
            raise expired
        user = self.directory.get_user(challenge["uid"])
        account = self.store.account(challenge["uid"])
        if not user or not account or not account["mfa_enabled"] or not account["mfa_secret"]:
            raise expired
        self._assert_usable(account)
        if code:
            method, valid = "totp", verify_totp(self.sealer.open(account["mfa_secret"]), code)
        elif backup_code:
            method, valid = "backup_code", self._consume_backup_code(user["uid"], backup_code)
        else:
            raise bad_request("Enter the 6-digit code from your authenticator app or a backup code")
        if not valid:
            self._failed_attempt(user, client, "mfa")
        self.store.execute("UPDATE mfa_challenges SET used = 1 WHERE token_hash = ?", (challenge["token_hash"],))
        return self._session_payload(user, client, f"password+{method}")

    def logout(self, token: str, client: dict) -> None:
        ctx = self.context(token, touch=False)
        self.store.execute("UPDATE sessions SET revoked_at = ? WHERE id = ?", (now_iso(), ctx.session["id"]))
        self.audit(client, {"action": "logout", "resource": "auth", "resource_id": ctx.uid}, ctx)

    def me(self, ctx: Context) -> dict:
        remaining = self.store.one("SELECT COUNT(*) AS n FROM backup_codes WHERE uid = ? AND used_at IS NULL", (ctx.uid,))["n"]
        return {
            "user": self.public_user(ctx.user, ctx.account, [ctx.base_role] if ctx.base_role else [], ctx.acting_role),
            "permissions": sorted(ctx.permissions),
            "mfa": {"enabled": bool(ctx.account["mfa_enabled"]), "backup_codes_remaining": remaining},
            "settings": ctx.account.get("settings") or {},
            "password_changed_at": ctx.account.get("password_changed_at"),
        }

    # ================================================================== step-up & act-as
    def step_up(self, ctx: Context, password: str | None, code: str | None, client: dict) -> dict:
        if password:
            method, valid = "password", self.directory.verify_password(ctx.uid, password)
        elif code:
            if not ctx.account["mfa_enabled"] or not ctx.account["mfa_secret"]:
                raise bad_request("Authenticator app verification is not set up for this account")
            method, valid = "totp", verify_totp(self.sealer.open(ctx.account["mfa_secret"]), code)
        else:
            raise bad_request("Enter your password or authenticator code")
        if not valid:
            self._failed_attempt(ctx.user, client, "step_up")
        self.store.execute("UPDATE accounts SET failed_attempts = 0 WHERE uid = ?", (ctx.uid,))
        token = new_token()
        expires = in_minutes(self.config.STEP_UP_TTL_MINUTES)
        self.store.execute("INSERT INTO step_ups (token_hash, session_id, expires_at) VALUES (?, ?, ?)", (sha256(token), ctx.session["id"], expires))
        self.audit(client, {"action": "step_up_success", "resource": "auth", "resource_id": ctx.uid, "details": {"method": method}}, ctx)
        return {"step_up_token": token, "expires_at": expires}

    def act_as_roles(self, ctx: Context) -> list[dict]:
        if "admin:act_as" not in ctx.base_permissions:
            raise forbidden("Only administrators can switch role view")
        role_perms, roles = self.rbac()
        return [
            {"name": name, "display_name": info["display_name"], "description": info.get("description"), "flags": info.get("flags", []), "permission_count": len(role_perms.get(name, set()))}
            for name, info in sorted(roles.items(), key=lambda item: (item[0] != ctx.base_role, item[1]["display_name"]))
        ]

    def act_as(self, ctx: Context, role: str | None, client: dict) -> dict:
        if "admin:act_as" not in ctx.base_permissions:
            raise forbidden("Only administrators can switch role view")
        _, roles = self.rbac()
        if role in (None, "", ctx.base_role):
            role = None
        elif role not in roles:
            raise bad_request("Unknown role", "role")
        self.store.execute("UPDATE sessions SET acting_role = ? WHERE id = ?", (role, ctx.session["id"]))
        self.audit(client, {"action": "act_as", "resource": "auth", "resource_id": ctx.uid, "severity": "medium" if role else "info", "details": {"role": role or ctx.base_role}}, ctx)
        refreshed = self.store.one("SELECT * FROM sessions WHERE id = ?", (ctx.session["id"],))
        return self.me(self._build_context(refreshed, touch=False))

    # ================================================================== MFA enrolment
    def _generate_backup_codes(self, uid: str) -> list[str]:
        self.store.execute("DELETE FROM backup_codes WHERE uid = ?", (uid,))
        codes = []
        for _ in range(BACKUP_CODE_COUNT):
            raw = random_code(10)
            codes.append(f"{raw[:5]}-{raw[5:]}")
            self.store.execute("INSERT INTO backup_codes (uid, code_hash) VALUES (?, ?)", (uid, sha256(raw)))
        return codes

    def _consume_backup_code(self, uid: str, code: str) -> bool:
        normalized = normalize_code(code)
        if len(normalized) != 10:
            return False
        cursor = self.store.execute(
            "UPDATE backup_codes SET used_at = ? WHERE id = (SELECT id FROM backup_codes WHERE uid = ? AND code_hash = ? AND used_at IS NULL LIMIT 1)",
            (now_iso(), uid, sha256(normalized)),
        )
        return cursor.rowcount == 1

    def mfa_setup(self, ctx: Context, client: dict) -> dict:
        secret = new_totp_secret()
        self.store.execute("UPDATE accounts SET mfa_pending = ? WHERE uid = ?", (self.sealer.seal(secret), ctx.uid))
        self.audit(client, {"action": "mfa_setup_started", "resource": "auth", "resource_id": ctx.uid}, ctx)
        return {"secret": secret, "otpauth_url": otpauth_url(secret, ctx.user["email"] or ctx.uid)}

    def mfa_enable(self, ctx: Context, code: str, client: dict) -> dict:
        account = self.store.account(ctx.uid)
        if not account.get("mfa_pending"):
            raise bad_request("Start authenticator setup first")
        if not verify_totp(self.sealer.open(account["mfa_pending"]), code):
            self.audit(client, {"action": "mfa_setup_failed", "resource": "auth", "resource_id": ctx.uid, "outcome": "failure", "severity": "low"}, ctx)
            raise AAAError(400, "INVALID_CODE", "That code does not match. Check the time on your device and try again.")
        with self.store.transaction():
            self.store.execute("UPDATE accounts SET mfa_enabled = 1, mfa_secret = mfa_pending, mfa_pending = NULL WHERE uid = ?", (ctx.uid,))
            codes = self._generate_backup_codes(ctx.uid)
        self.audit(client, {"action": "mfa_enabled", "resource": "auth", "resource_id": ctx.uid, "severity": "low"}, ctx)
        return {"backup_codes": codes}

    def _verify_current_password(self, ctx: Context, password: str | None, client: dict) -> None:
        if not password:
            raise bad_request("Current password is required", "password")
        if not self.directory.verify_password(ctx.uid, password):
            self._failed_attempt(ctx.user, client, "step_up")

    def mfa_disable(self, ctx: Context, password: str | None, client: dict) -> None:
        self._verify_current_password(ctx, password, client)
        with self.store.transaction():
            self.store.execute("UPDATE accounts SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending = NULL WHERE uid = ?", (ctx.uid,))
            self.store.execute("DELETE FROM backup_codes WHERE uid = ?", (ctx.uid,))
        self.audit(client, {"action": "mfa_disabled", "resource": "auth", "resource_id": ctx.uid, "severity": "medium"}, ctx)

    def regenerate_backup_codes(self, ctx: Context, password: str | None, client: dict) -> dict:
        self._verify_current_password(ctx, password, client)
        if not ctx.account["mfa_enabled"]:
            raise bad_request("Enable authenticator app verification first")
        codes = self._generate_backup_codes(ctx.uid)
        self.audit(client, {"action": "backup_codes_regenerated", "resource": "auth", "resource_id": ctx.uid, "severity": "low"}, ctx)
        return {"backup_codes": codes}

    # ================================================================== passwords & settings
    def change_password(self, ctx: Context, current: str, new: str, client: dict) -> None:
        self._verify_current_password(ctx, current, client)
        problem = password_problem(new)
        if problem:
            raise bad_request(problem, "new_password")
        if current == new:
            raise bad_request("The new password must be different from the current one", "new_password")
        self.directory.set_password(ctx.uid, new)
        self.store.execute("UPDATE accounts SET password_changed_at = ? WHERE uid = ?", (now_iso(), ctx.uid))
        self.revoke_sessions(ctx.uid, ctx.session["id"])
        self.audit(client, {"action": "password_changed", "resource": "auth", "resource_id": ctx.uid, "severity": "low"}, ctx)

    def save_settings(self, ctx: Context, values: dict) -> dict:
        settings = dict(ctx.account.get("settings") or {})
        for key, kind in SETTINGS_KEYS.items():
            if key not in values:
                continue
            value = values[key]
            if kind is bool and isinstance(value, bool):
                settings[key] = value
            elif kind is int and isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 120:
                settings[key] = value
            elif kind is str and isinstance(value, str) and 0 < len(value) <= 60:
                settings[key] = value
            else:
                raise bad_request(f"Invalid value for {key}", key)
        self.store.execute("UPDATE accounts SET settings = ? WHERE uid = ?", (json.dumps(settings), ctx.uid))
        return settings

    def issue_reset_code(self, uid: str, issued_by: str | None, reset_id: int | None = None) -> dict:
        if not reset_id:
            reset_id = self.store.execute("INSERT INTO password_resets (uid, status, requested_at) VALUES (?, 'requested', ?)", (uid, now_iso())).lastrowid
        self.store.execute("UPDATE password_resets SET status = 'expired' WHERE uid = ? AND status = 'issued' AND id <> ?", (uid, reset_id))
        raw = random_code(8)
        expires = in_minutes(self.config.RESET_CODE_TTL_MINUTES)
        self.store.execute(
            "UPDATE password_resets SET status = 'issued', code_hash = ?, issued_by = ?, issued_at = ?, expires_at = ? WHERE id = ?",
            (sha256(raw), issued_by, now_iso(), expires, reset_id),
        )
        return {"code": f"{raw[:4]}-{raw[4:]}", "expires_at": expires, "reset_id": reset_id}

    def request_password_reset(self, identifier: str, client: dict) -> None:
        user = self.directory.find_user(identifier)
        account = self.store.account(user["uid"]) if user else None
        if not user or not account or account["status"] in ("inactive", "rejected"):
            self.audit(client, {"actor": identifier, "action": "password_reset_requested", "resource": "auth", "outcome": "failure", "severity": "low", "details": {"reason": "unknown_or_inactive"}})
            return
        pending = self.store.one("SELECT id FROM password_resets WHERE uid = ? AND status = 'requested' ORDER BY id DESC LIMIT 1", (user["uid"],))
        reset_id = pending["id"] if pending else self.store.execute(
            "INSERT INTO password_resets (uid, status, requested_at, requested_ip) VALUES (?, 'requested', ?, ?)", (user["uid"], now_iso(), client.get("ip"))
        ).lastrowid
        self.audit(client, {"action": "password_reset_requested", "resource": "auth", "resource_id": user["uid"], "severity": "medium"}, user=user)
        if self.config.DEV_SHOW_RESET_CODES:
            issued = self.issue_reset_code(user["uid"], None, reset_id)
            print(f"[DEV] Password reset code for {user['email']}: {issued['code']}", flush=True)

    def confirm_password_reset(self, identifier: str, code: str, new_password: str, client: dict) -> None:
        invalid = AAAError(400, "INVALID_RESET_CODE", "The reset code is invalid or has expired")
        user = self.directory.find_user(identifier)
        account = self.store.account(user["uid"]) if user else None
        if not user or not account or account["status"] in ("inactive", "rejected"):
            raise invalid
        reset = self.store.one(
            "SELECT id, code_hash FROM password_resets WHERE uid = ? AND status = 'issued' AND expires_at > ? ORDER BY id DESC LIMIT 1",
            (user["uid"], now_iso()),
        )
        normalized = normalize_code(code)
        if not reset or not normalized or sha256(normalized) != reset["code_hash"]:
            self.audit(client, {"action": "password_reset_failed", "resource": "auth", "resource_id": user["uid"], "outcome": "failure", "severity": "medium"}, user=user)
            raise invalid
        problem = password_problem(new_password)
        if problem:
            raise bad_request(problem, "new_password")
        self.directory.set_password(user["uid"], new_password)
        self.store.execute("UPDATE password_resets SET status = 'used', used_at = ? WHERE id = ?", (now_iso(), reset["id"]))
        self.store.execute(
            "UPDATE accounts SET password_changed_at = ?, failed_attempts = 0, locked_until = NULL, lock_reason = CASE WHEN status = 'locked' THEN lock_reason ELSE NULL END WHERE uid = ?",
            (now_iso(), user["uid"]),
        )
        self.revoke_sessions(user["uid"])
        self.audit(client, {"action": "password_reset_completed", "resource": "auth", "resource_id": user["uid"], "severity": "medium"}, user=user)

    # ================================================================== sign-up
    def signup_roles(self) -> list[dict]:
        _, roles = self.rbac()
        return [
            {
                "name": name,
                "display_name": info["display_name"],
                "description": info.get("description"),
                "requires_approval": catalog.FLAG_APPROVAL in info.get("flags", []),
                "is_patient": catalog.FLAG_PATIENT in info.get("flags", []),
            }
            for name, info in sorted(roles.items(), key=lambda item: (catalog.FLAG_PATIENT not in item[1].get("flags", []), item[1]["display_name"]))
            if catalog.FLAG_SIGNUP in info.get("flags", [])
        ]

    def validate_new_user(self, username: str, email: str, name: str, password: str) -> tuple[str, str, str]:
        username = (username or "").strip().lower()
        email = (email or "").strip().lower()
        name = (name or "").strip()
        if not UID_RE.match(username):
            raise bad_request("Username must be 3-32 characters: lowercase letters, numbers, dots, dashes or underscores", "username")
        if not EMAIL_RE.match(email) or len(email) > 120:
            raise bad_request("Enter a valid email address", "email")
        if len(name) < 2 or len(name) > 120:
            raise bad_request("Enter your full name", "name")
        problem = password_problem(password)
        if problem:
            raise bad_request(problem, "password")
        if self.directory.get_user(username):
            raise conflict("That username is already taken", "USERNAME_TAKEN")
        if self.directory.email_taken(email):
            raise conflict("An account with this email already exists", "EMAIL_TAKEN")
        return username, email, name

    def signup(self, data: dict, client: dict) -> dict:
        _, roles = self.rbac()
        role = (data.get("role") or "").strip().lower()
        info = roles.get(role)
        if not info or catalog.FLAG_SIGNUP not in info.get("flags", []):
            raise bad_request("Choose one of the available roles", "role")
        username, email, name = self.validate_new_user(data.get("username"), data.get("email"), data.get("name"), data.get("password") or "")
        is_patient = catalog.FLAG_PATIENT in info.get("flags", [])
        needs_approval = catalog.FLAG_APPROVAL in info.get("flags", [])
        licence = (data.get("licence_number") or "").strip()[:40] or None
        justification = (data.get("justification") or "").strip()[:500] or None
        if needs_approval and not licence:
            raise bad_request("Professional registration / licence number is required for clinical roles", "licence_number")

        phone = (data.get("phone") or "").strip()[:30] or None
        self.directory.create_user(username, name, email, data["password"], phone=phone, title=info["display_name"], licence_number=licence)
        status = "pending" if needs_approval else "active"
        self.store.execute(
            "INSERT INTO accounts (uid, kind, status, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)",
            (username, "patient" if is_patient else "staff", status, now_iso(), now_iso()),
        )
        if needs_approval:
            self.store.execute(
                "INSERT INTO signups (uid, requested_role, status, licence_number, justification, created_at) VALUES (?, ?, 'pending', ?, ?, ?)",
                (username, role, licence, justification, now_iso()),
            )
        else:
            self.directory.set_user_role(username, role)
            self.bump_rbac()
        user = self.directory.get_user(username)
        self.audit(client, {"action": "signup", "resource": "account", "resource_id": username, "severity": "medium" if needs_approval else "low", "details": {"role": role, "status": status}}, user=user)
        return {"uid": username, "status": status, "role": role, "role_name": info["display_name"], "kind": "patient" if is_patient else "staff", "email": email, "name": name}

    def cancel_signup(self, uid: str, client: dict) -> None:
        """Rollback used by the REST API if it cannot create the patient record for a new account."""
        account = self.store.account(uid)
        created = parse_iso(account["created_at"]) if account else None
        if not account or account.get("last_login_at") or not created or (now() - created).total_seconds() > 600:
            raise forbidden("This sign-up can no longer be cancelled")
        self.directory.delete_user(uid)
        self.store.execute("DELETE FROM accounts WHERE uid = ?", (uid,))
        self.store.execute("DELETE FROM signups WHERE uid = ?", (uid,))
        self.bump_rbac()
        self.audit(client, {"actor": uid, "action": "signup_rolled_back", "resource": "account", "resource_id": uid, "severity": "low"})
