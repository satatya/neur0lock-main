"""Administration: accounts, sign-up approvals, roles/permissions (LDAP), security centre,
devices and audit queries. Every method receives the caller's validated Context and checks
its permissions itself."""
import json

from . import catalog
from .errors import AAAError, bad_request, conflict, forbidden, not_found
from .security import now_iso
from .service import AAAService, Context

ALERT_TITLES = {
    "account_locked": "Account locked after failed attempts",
    "login_failed": "Failed login attempt",
    "mfa_failed": "Failed verification code",
    "step_up_failed": "Failed re-authentication",
    "login_blocked": "Login attempt on locked/deactivated account",
    "emergency_access": "Emergency (break-glass) access to therapy notes",
    "read_emergency": "Therapy note read under emergency access",
    "role_permissions_changed": "Role permissions changed",
    "role_created": "Role created",
    "role_deleted": "Role deleted",
    "role_updated": "Role settings changed",
    "staff_created": "Account created by administrator",
    "staff_updated": "Account changed",
    "staff_deactivated": "Account deactivated",
    "staff_unlocked": "Account unlocked",
    "signup": "New account sign-up",
    "signup_approved": "Sign-up approved",
    "signup_rejected": "Sign-up rejected",
    "unlock_requested": "Unlock requested by locked-out user",
    "password_reset_requested": "Password reset requested",
    "password_reset_issued": "Password reset code issued",
    "password_reset_failed": "Invalid password reset code used",
    "password_reset_completed": "Password reset completed",
    "mfa_disabled": "MFA disabled",
    "device_registration_requested": "New device registration request",
    "sessions_revoked": "Sessions revoked",
    "session_revoked": "Session revoked",
    "access_denied": "Access denied by role permissions",
    "act_as": "Administrator switched role view",
    "delete": "Record deleted",
}

SEVERITIES = ["info", "low", "medium", "high", "critical"]


def require(ctx: Context, *codes: str, any_of: bool = False) -> None:
    ok = any(c in ctx.permissions for c in codes) if any_of else all(c in ctx.permissions for c in codes)
    if not ok:
        raise forbidden(details={"missing": [c for c in codes if c not in ctx.permissions]})


def require_step_up(ctx: Context, message: str = "Please re-enter your password to continue with this sensitive action.") -> None:
    if not ctx.step_up:
        raise AAAError(401, "STEP_UP_REQUIRED", message)


class AdminService:
    def __init__(self, core: AAAService):
        self.core = core
        self.store = core.store
        self.directory = core.directory

    # ------------------------------------------------------------------ helpers
    def _critical_role_names(self) -> set[str]:
        role_perms, _ = self.core.rbac()
        return {role for role, perms in role_perms.items() if any(code in perms for code in catalog.ADMIN_CRITICAL)}

    def _assert_administrable(self) -> None:
        """Refuses a state where nobody active can manage roles or staff."""
        role_perms, roles = self.core.rbac()
        active = {row["uid"] for row in self.store.all("SELECT uid FROM accounts WHERE status = 'active'")}
        for code in catalog.ADMIN_CRITICAL:
            holders = [name for name, perms in role_perms.items() if code in perms]
            if not any(uid in active for name in holders for uid in roles.get(name, {}).get("member_uids", [])):
                raise conflict(f'This change would leave no active account with the "{code}" permission.', "LOCKOUT_PREVENTED")

    def _user_or_404(self, uid: str) -> dict:
        user = self.directory.get_user(uid)
        if not user:
            raise not_found("Account")
        self.core.ensure_account(user)
        return user

    # ------------------------------------------------------------------ accounts
    def list_users(self, ctx: Context, kind: str | None = None) -> list[dict]:
        require(ctx, "staff:read")
        _, roles = self.core.rbac()
        role_of = {uid: name for name, info in roles.items() for uid in info.get("member_uids", [])}
        users = []
        for user in self.directory.list_users():
            account = self.core.ensure_account(user)
            role = role_of.get(user["uid"])
            public = self.core.public_user(user, account, [role] if role else [])
            if kind and public["kind"] != kind:
                continue
            users.append(public)
        order = {"pending": 0, "locked": 1, "active": 2, "inactive": 3, "rejected": 4}
        return sorted(users, key=lambda u: (order.get(u["status"], 9), (u["name"] or "").lower()))

    def directory_list(self) -> list[dict]:
        """Active staff for pickers (no security details). `bookable` marks clinicians patients can
        book with: roles that manage appointments."""
        role_perms, roles = self.core.rbac()
        active = {row["uid"] for row in self.store.all("SELECT uid FROM accounts WHERE status = 'active' AND kind = 'staff'")}
        result = []
        for name, info in roles.items():
            if catalog.FLAG_PATIENT in info.get("flags", []):
                continue
            bookable = "appointments:update" in role_perms.get(name, set())
            for uid in info.get("member_uids", []):
                if uid not in active:
                    continue
                user = self.directory.get_user(uid)
                if user:
                    result.append({"uid": uid, "name": user["name"], "email": user["email"], "role": name, "role_name": info["display_name"], "bookable": bookable})
        return sorted(result, key=lambda u: u["name"].lower())

    def get_user(self, ctx: Context, uid: str) -> dict:
        require(ctx, "staff:read")
        return self.core.public_user(self._user_or_404(uid))

    def create_user(self, ctx: Context, data: dict, client: dict) -> dict:
        require(ctx, "staff:manage")
        _, roles = self.core.rbac()
        role = (data.get("role") or "").strip().lower()
        if role not in roles:
            raise bad_request("Choose a role", "role")
        if role in self._critical_role_names():
            require_step_up(ctx, "Creating an administrator requires you to re-enter your password.")
        username = data.get("username") or (data.get("email") or "").split("@")[0].lower().replace("+", ".")
        username, email, name = self.core.validate_new_user(username, data.get("email"), data.get("name"), data.get("password") or "")
        info = roles[role]
        licence = (data.get("licence_number") or "").strip()[:40] or None
        self.directory.create_user(username, name, email, data["password"], phone=(data.get("phone") or None), title=info["display_name"], licence_number=licence)
        kind = "patient" if catalog.FLAG_PATIENT in info.get("flags", []) else "staff"
        self.store.execute(
            "INSERT INTO accounts (uid, kind, status, created_at, password_changed_at) VALUES (?, ?, 'active', ?, ?)",
            (username, kind, now_iso(), now_iso()),
        )
        self.directory.set_user_role(username, role)
        self.core.bump_rbac()
        self.core.audit(client, {"action": "staff_created", "resource": "account", "resource_id": username, "severity": "medium", "details": {"email": email, "role": role}}, ctx)
        return self.core.public_user(self.directory.get_user(username))

    def update_user(self, ctx: Context, uid: str, data: dict, client: dict) -> dict:
        require(ctx, "staff:manage")
        user = self._user_or_404(uid)
        account = self.store.account(uid)
        current_roles = self.core.user_roles(uid)
        current_role = current_roles[0] if current_roles else None
        _, roles = self.core.rbac()

        role = (data.get("role") or "").strip().lower() or None
        if role and role not in roles:
            raise bad_request("Unknown role", "role")
        status = data.get("status")
        if status is not None and status not in ("active", "locked", "inactive"):
            raise bad_request("Status must be active, locked or inactive", "status")
        role_changed = bool(role and role != current_role)
        status_changed = bool(status and status != account["status"])
        if uid == ctx.uid and (role_changed or (status_changed and status != "active")):
            raise forbidden("You cannot change your own role or deactivate your own account")
        if role_changed:
            critical = self._critical_role_names()
            if current_role in critical or role in critical:
                require_step_up(ctx, "Changing administrator access requires you to re-enter your password.")
        email = (data.get("email") or "").strip().lower() or None
        if email and email != user["email"] and self.directory.email_taken(email, except_uid=uid):
            raise conflict("Email already in use by another account")

        self.directory.update_user(uid, name=(data.get("name") or "").strip() or None, email=email, phone=data.get("phone") if "phone" in data else None)
        if role_changed:
            self.directory.set_user_role(uid, role)
            self.core.bump_rbac()
        if status_changed:
            self.store.execute(
                "UPDATE accounts SET status = ?, lock_reason = ?, failed_attempts = 0, locked_until = NULL WHERE uid = ?",
                (status, "admin-lock" if status == "locked" else None, uid),
            )
        try:
            self._assert_administrable()
        except AAAError:
            if role_changed and current_role:
                self.directory.set_user_role(uid, current_role)
                self.core.bump_rbac()
            if status_changed:
                self.store.execute("UPDATE accounts SET status = ?, lock_reason = ? WHERE uid = ?", (account["status"], account.get("lock_reason"), uid))
            raise
        if status_changed and status != "active":
            self.core.revoke_sessions(uid)
        details = {}
        if role_changed:
            details["role"] = {"from": current_role, "to": role}
        if status_changed:
            details["status"] = {"from": account["status"], "to": status}
        self.core.audit(client, {"action": "staff_updated", "resource": "account", "resource_id": uid, "severity": "medium" if details else "low", "details": details or None}, ctx)
        return self.core.public_user(self.directory.get_user(uid))

    def unlock(self, ctx: Context, uid: str, client: dict) -> dict:
        require(ctx, "staff:manage")
        user = self._user_or_404(uid)
        self.store.execute(
            "UPDATE accounts SET failed_attempts = 0, locked_until = NULL, lock_reason = NULL, status = CASE WHEN status = 'locked' THEN 'active' ELSE status END WHERE uid = ?",
            (uid,),
        )
        self.core.audit(client, {"action": "staff_unlocked", "resource": "account", "resource_id": uid, "severity": "medium"}, ctx)
        return self.core.public_user(user)

    def reset_password(self, ctx: Context, uid: str, client: dict) -> dict:
        require(ctx, "staff:manage")
        require_step_up(ctx)
        user = self._user_or_404(uid)
        if self.store.account(uid)["status"] in ("inactive", "rejected"):
            raise conflict("Reactivate this account before resetting its password")
        issued = self.core.issue_reset_code(uid, ctx.uid)
        self.core.audit(client, {"action": "password_reset_issued", "resource": "account", "resource_id": uid, "severity": "medium"}, ctx)
        return {"code": issued["code"], "expires_at": issued["expires_at"], "email": user["email"], "username": uid}

    def revoke_user_sessions(self, ctx: Context, uid: str, client: dict) -> int:
        require(ctx, "staff:manage")
        self._user_or_404(uid)
        revoked = self.core.revoke_sessions(uid, ctx.session["id"] if uid == ctx.uid else None)
        self.core.audit(client, {"action": "sessions_revoked", "resource": "account", "resource_id": uid, "severity": "medium", "details": {"revoked": revoked}}, ctx)
        return revoked

    def deactivate(self, ctx: Context, uid: str, client: dict) -> None:
        require(ctx, "staff:manage")
        if uid == ctx.uid:
            raise forbidden("You cannot deactivate your own account")
        user = self._user_or_404(uid)
        previous = self.store.account(uid)["status"]
        self.store.execute("UPDATE accounts SET status = 'inactive', lock_reason = NULL WHERE uid = ?", (uid,))
        try:
            self._assert_administrable()
        except AAAError:
            self.store.execute("UPDATE accounts SET status = ? WHERE uid = ?", (previous, uid))
            raise
        self.core.revoke_sessions(uid)
        self.core.audit(client, {"action": "staff_deactivated", "resource": "account", "resource_id": uid, "severity": "medium", "details": {"email": user["email"]}}, ctx)

    # ------------------------------------------------------------------ sign-up approvals
    def list_signups(self, ctx: Context, status: str = "pending") -> list[dict]:
        require(ctx, "staff:manage")
        rows = self.store.all(
            "SELECT * FROM signups WHERE (? = 'all' OR status = ?) ORDER BY status = 'pending' DESC, created_at DESC",
            (status, status),
        )
        _, roles = self.core.rbac()
        for row in rows:
            user = self.directory.get_user(row["uid"]) or {}
            row.update({"name": user.get("name"), "email": user.get("email"), "phone": user.get("phone"), "requested_role_name": roles.get(row["requested_role"], {}).get("display_name", row["requested_role"])})
        return rows

    def review_signup(self, ctx: Context, signup_id: int, approve: bool, role: str | None, note: str | None, client: dict) -> dict:
        require(ctx, "staff:manage")
        signup = self.store.one("SELECT * FROM signups WHERE id = ?", (signup_id,))
        if not signup or signup["status"] != "pending":
            raise not_found("Pending sign-up")
        _, roles = self.core.rbac()
        final_role = (role or signup["requested_role"]).lower()
        if approve:
            if final_role not in roles:
                raise bad_request("Unknown role", "role")
            if final_role in self._critical_role_names():
                require_step_up(ctx, "Approving an account with administrator access requires re-authentication.")
            self.directory.set_user_role(signup["uid"], final_role)
            self.core.bump_rbac()
            self.store.execute("UPDATE accounts SET status = 'active' WHERE uid = ?", (signup["uid"],))
        else:
            self.store.execute("UPDATE accounts SET status = 'rejected' WHERE uid = ?", (signup["uid"],))
        self.store.execute(
            "UPDATE signups SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?",
            ("approved" if approve else "rejected", ctx.uid, now_iso(), (note or "")[:500] or None, signup_id),
        )
        self.core.audit(
            client,
            {"action": "signup_approved" if approve else "signup_rejected", "resource": "account", "resource_id": signup["uid"], "severity": "medium", "details": {"role": final_role if approve else signup["requested_role"]}},
            ctx,
        )
        return self.core.public_user(self.directory.get_user(signup["uid"]))

    # ------------------------------------------------------------------ roles & permissions
    def permission_catalog(self, ctx: Context) -> list[dict]:
        require(ctx, "roles:manage", "staff:read", "staff:manage", any_of=True)
        return [
            {"code": code, "category": cat, "label": label, "description": desc, "sort_order": (i + 1) * 10}
            for i, (code, cat, label, desc) in enumerate(catalog.PERMISSIONS)
        ]

    def list_roles(self, ctx: Context | None = None) -> list[dict]:
        if ctx is not None:
            require(ctx, "roles:manage", "staff:read", "staff:manage", any_of=True)
        role_perms, roles = self.core.rbac()
        active = {row["uid"] for row in self.store.all("SELECT uid FROM accounts WHERE status = 'active'")}
        result = []
        for name, info in roles.items():
            flags = info.get("flags", [])
            result.append(
                {
                    "name": name,
                    "display_name": info["display_name"],
                    "description": info.get("description"),
                    "is_system": catalog.FLAG_SYSTEM in flags,
                    "signup": catalog.FLAG_SIGNUP in flags,
                    "requires_approval": catalog.FLAG_APPROVAL in flags,
                    "is_patient": catalog.FLAG_PATIENT in flags,
                    "staff_count": sum(1 for uid in info.get("member_uids", []) if uid in active),
                    "permissions": sorted(role_perms.get(name, set())),
                }
            )
        order = list(catalog.DEFAULT_ROLES)
        return sorted(result, key=lambda r: (order.index(r["name"]) if r["name"] in order else 99, r["display_name"]))

    def _role_view(self, name: str) -> dict:
        return next(r for r in self.list_roles() if r["name"] == name)

    def _apply_permissions(self, ctx: Context, name: str, target: set, client: dict) -> dict:
        role_perms, _ = self.core.rbac()
        current = role_perms.get(name, set())
        added = sorted(target - current)
        removed = sorted(current - target)
        for code in added:
            self.directory.grant(name, code)
        for code in removed:
            self.directory.revoke(name, code)
        self.core.bump_rbac()
        try:
            self._assert_administrable()
        except AAAError:
            for code in added:
                self.directory.revoke(name, code)
            for code in removed:
                self.directory.grant(name, code)
            self.core.bump_rbac()
            raise
        if added or removed:
            critical = any(code in catalog.ADMIN_CRITICAL for code in added + removed)
            self.core.audit(client, {"action": "role_permissions_changed", "resource": "role", "resource_id": name, "severity": "high" if critical else "medium", "details": {"role": name, "added": added, "removed": removed}}, ctx)
        return {"added": added, "removed": removed}

    @staticmethod
    def _parse_codes(value) -> set:
        if not isinstance(value, list):
            raise bad_request("permissions must be a list of permission codes", "permissions")
        codes = {str(code).strip() for code in value}
        unknown = sorted(codes - set(catalog.PERMISSION_CODES))
        if unknown:
            raise bad_request(f"Unknown permission(s): {', '.join(unknown)}", "permissions")
        return codes

    @staticmethod
    def _flags(base: list[str], signup: bool | None, approval: bool | None) -> list[str]:
        flags = set(base)
        for flag, value in ((catalog.FLAG_SIGNUP, signup), (catalog.FLAG_APPROVAL, approval)):
            if value is True:
                flags.add(flag)
            elif value is False:
                flags.discard(flag)
        return sorted(flags)

    def create_role(self, ctx: Context, data: dict, client: dict) -> dict:
        require(ctx, "roles:manage")
        require_step_up(ctx)
        display_name = (data.get("display_name") or "").strip()
        if not display_name or len(display_name) > 80:
            raise bad_request("Role name is required", "display_name")
        name = (data.get("name") or display_name).strip().lower()
        name = "".join(ch if ch.isalnum() else "_" for ch in name).strip("_")
        if not name or not name[0].isalpha():
            raise bad_request("Role name must start with a letter", "name")
        _, roles = self.core.rbac()
        if name in roles:
            raise conflict("A role with this name already exists")
        codes = self._parse_codes(data.get("permissions", []))
        flags = self._flags([], data.get("signup"), data.get("requires_approval"))
        if catalog.FLAG_SIGNUP in flags and catalog.FLAG_PATIENT not in flags:
            flags = sorted(set(flags) | {catalog.FLAG_APPROVAL})  # staff sign-ups always need approval
        self.directory.create_role(name, display_name, (data.get("description") or "").strip()[:255] or None, flags)
        for code in codes:
            self.directory.grant(name, code)
        self.core.bump_rbac()
        self.core.audit(client, {"action": "role_created", "resource": "role", "resource_id": name, "severity": "medium", "details": {"role": name, "permissions": sorted(codes)}}, ctx)
        return self._role_view(name)

    def update_role(self, ctx: Context, name: str, data: dict, client: dict) -> dict:
        require(ctx, "roles:manage")
        require_step_up(ctx)
        _, roles = self.core.rbac()
        role = roles.get(name)
        if not role:
            raise not_found("Role")
        flags = None
        if "signup" in data or "requires_approval" in data:
            if catalog.FLAG_PATIENT in role["flags"] and data.get("requires_approval") is True:
                raise bad_request("Patient sign-ups cannot require approval", "requires_approval")
            flags = self._flags(role["flags"], data.get("signup"), data.get("requires_approval"))
            if catalog.FLAG_SIGNUP in flags and catalog.FLAG_PATIENT not in flags and catalog.FLAG_APPROVAL not in flags:
                raise bad_request("Staff roles offered at sign-up must require administrator approval", "requires_approval")
            if name in self._critical_role_names() and catalog.FLAG_SIGNUP in flags:
                raise bad_request("Roles that can manage staff or roles cannot be offered at sign-up", "signup")
        self.directory.update_role(
            name,
            display_name=(data.get("display_name") or "").strip() or None,
            description=data.get("description").strip() if isinstance(data.get("description"), str) else None,
            flags=flags,
        )
        self.core.bump_rbac()
        changes = {}
        if "permissions" in data:
            changes = self._apply_permissions(ctx, name, self._parse_codes(data["permissions"]), client)
        if flags is not None:
            self.core.audit(client, {"action": "role_updated", "resource": "role", "resource_id": name, "severity": "medium", "details": {"flags": flags}}, ctx)
        return {**self._role_view(name), "changes": changes}

    def set_permission(self, ctx: Context, name: str, code: str, granted: bool, client: dict) -> dict:
        require(ctx, "roles:manage")
        require_step_up(ctx, "Changing role permissions requires you to re-enter your password.")
        if code not in catalog.PERMISSION_INFO:
            raise bad_request(f"Unknown permission: {code}")
        role_perms, roles = self.core.rbac()
        if name not in roles:
            raise not_found("Role")
        if granted and code in catalog.ADMIN_CRITICAL and catalog.FLAG_SIGNUP in roles[name]["flags"]:
            raise bad_request("Roles offered at sign-up cannot be given staff or role management", "code")
        current = set(role_perms.get(name, set()))
        target = current | {code} if granted else current - {code}
        changes = self._apply_permissions(ctx, name, target, client)
        return {**self._role_view(name), "changes": changes}

    def delete_role(self, ctx: Context, name: str, client: dict) -> None:
        require(ctx, "roles:manage")
        require_step_up(ctx)
        _, roles = self.core.rbac()
        role = roles.get(name)
        if not role:
            raise not_found("Role")
        if catalog.FLAG_SYSTEM in role["flags"]:
            raise conflict("Built-in roles cannot be deleted")
        if role.get("member_uids"):
            raise conflict("Move the accounts in this role to another role before deleting it")
        self.directory.delete_role(name)
        self.core.bump_rbac()
        self.core.audit(client, {"action": "role_deleted", "resource": "role", "resource_id": name, "severity": "medium"}, ctx)

    # ------------------------------------------------------------------ audit
    def _audit_rows(self, rows: list[dict]) -> list[dict]:
        for row in rows:
            row["details"] = json.loads(row["details"]) if row.get("details") else None
        return rows

    def audit_query(self, ctx: Context, params: dict) -> tuple[list[dict], int]:
        require(ctx, "audit:read")
        where, values = [], []
        if params.get("q"):
            where.append("(actor LIKE ? OR actor_name LIKE ? OR action LIKE ? OR resource LIKE ?)")
            values += [f"%{params['q']}%"] * 4
        for key in ("actor_uid", "action", "resource"):
            if params.get(key):
                where.append(f"{key} = ?")
                values.append(params[key])
        if params.get("patient_id"):
            where.append("patient_id = ?")
            values.append(int(params["patient_id"]))
        if params.get("outcome") in ("success", "denied", "failure"):
            where.append("outcome = ?")
            values.append(params["outcome"])
        if params.get("min_severity") in SEVERITIES:
            allowed = SEVERITIES[SEVERITIES.index(params["min_severity"]):]
            where.append(f"severity IN ({', '.join('?' for _ in allowed)})")
            values += allowed
        if params.get("from"):
            where.append("ts >= ?")
            values.append(params["from"])
        if params.get("to"):
            where.append("ts < ?")
            values.append(params["to"])
        limit = max(1, min(int(params.get("limit") or 100), 500))
        offset = max(0, int(params.get("offset") or 0))
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self.store.all(f"SELECT * FROM audit_log {clause} ORDER BY id DESC LIMIT ? OFFSET ?", values + [limit, offset])
        total = self.store.one(f"SELECT COUNT(*) AS n FROM audit_log {clause}", values)["n"]
        return self._audit_rows(rows), total

    def audit_stats(self, ctx: Context) -> dict:
        require(ctx, "audit:read")
        today = now_iso()[:10]
        day_ago = _hours_ago(24)
        base = self.store.one("SELECT COUNT(*) AS total, COUNT(DISTINCT actor_uid) AS users FROM audit_log WHERE ts >= ?", (f"{today}T00:00:00Z",))
        window = self.store.one(
            """SELECT
                SUM(action IN ('login_failed','mfa_failed','step_up_failed')) AS failed_logins,
                SUM(outcome = 'denied') AS denied,
                SUM(action IN ('view','view_sensitive','read','read_emergency')) AS views,
                SUM(action IN ('update','staff_updated','role_permissions_changed','administer','update_progress')) AS changes,
                SUM(action IN ('create','prescribe','record','generate','staff_created','signup')) AS creates,
                SUM(severity IN ('medium','high','critical')) AS alerts
               FROM audit_log WHERE ts >= ?""",
            (day_ago,),
        )
        top = self.store.all("SELECT action, COUNT(*) AS total FROM audit_log WHERE ts >= ? GROUP BY action ORDER BY total DESC LIMIT 8", (day_ago,))
        return {
            "actions_today": base["total"] or 0,
            "active_users_today": base["users"] or 0,
            "failed_logins_24h": window["failed_logins"] or 0,
            "denied_24h": window["denied"] or 0,
            "record_views_24h": window["views"] or 0,
            "modifications_24h": window["changes"] or 0,
            "creations_24h": window["creates"] or 0,
            "security_events_24h": window["alerts"] or 0,
            "top_actions_24h": top,
        }

    # ------------------------------------------------------------------ security centre
    def security_overview(self, ctx: Context) -> dict:
        require(ctx, "security:read")
        day_ago, week_ago, now = _hours_ago(24), _hours_ago(24 * 7), now_iso()
        one = lambda sql, params=(): self.store.one(sql, params)["n"] or 0  # noqa: E731
        return {
            "failed_logins_24h": one("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('login_failed','mfa_failed','step_up_failed') AND ts >= ?", (day_ago,)),
            "denied_24h": one("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'denied' AND ts >= ?", (day_ago,)),
            "emergency_access_7d": one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'emergency_access' AND ts >= ?", (week_ago,)),
            "locked_accounts": one("SELECT COUNT(*) AS n FROM accounts WHERE status = 'locked' OR (locked_until IS NOT NULL AND locked_until > ?)", (now,)),
            "pending_signups": one("SELECT COUNT(*) AS n FROM signups WHERE status = 'pending'"),
            "active_sessions": one("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?", (now,)),
            "pending_devices": one("SELECT COUNT(*) AS n FROM devices WHERE status = 'pending'"),
            "pending_resets": one("SELECT COUNT(*) AS n FROM password_resets WHERE status = 'requested'"),
            "mfa_enabled": one("SELECT COUNT(*) AS n FROM accounts WHERE status = 'active' AND mfa_enabled = 1"),
            "active_staff": one("SELECT COUNT(*) AS n FROM accounts WHERE status = 'active'"),
            "unreviewed_alerts": one(
                "SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN security_reviews r ON r.audit_id = a.id WHERE a.severity IN ('medium','high','critical') AND r.audit_id IS NULL"
            ),
            "directory": "connected" if self.directory.ping() else "unavailable",
            "log_server": "connected" if self.core.accounting.forwarder.connected else ("disabled" if not self.core.accounting.forwarder.enabled else "reconnecting"),
            "encryption": "AES-256-GCM (envelope) · TLS between services",
        }

    def security_alerts(self, ctx: Context, status: str = "all", severity: str | None = None) -> list[dict]:
        require(ctx, "security:read")
        where = ["a.severity IN ('medium','high','critical')"]
        values: list = []
        if severity in ("medium", "high", "critical"):
            where.append("a.severity = ?")
            values.append(severity)
        if status == "unreviewed":
            where.append("r.audit_id IS NULL")
        elif status == "reviewed":
            where.append("r.audit_id IS NOT NULL")
        rows = self.store.all(
            f"""SELECT a.*, r.resolution, r.notes AS review_notes, r.reviewed_by_name, r.reviewed_at
                FROM audit_log a LEFT JOIN security_reviews r ON r.audit_id = a.id
                WHERE {' AND '.join(where)} ORDER BY a.id DESC LIMIT 200""",
            values,
        )
        for row in self._audit_rows(rows):
            row["title"] = ALERT_TITLES.get(row["action"], row["action"].replace("_", " "))
            row["status"] = "reviewed" if row.get("resolution") else "unreviewed"
        return rows

    def review_alert(self, ctx: Context, audit_id: int, resolution: str, notes: str | None, client: dict) -> None:
        require(ctx, "security:read")
        if not self.store.one("SELECT id FROM audit_log WHERE id = ?", (audit_id,)):
            raise not_found("Security alert")
        if resolution not in ("resolved", "false_positive", "escalated"):
            resolution = "resolved"
        self.store.execute(
            """INSERT INTO security_reviews (audit_id, reviewed_by, reviewed_by_name, resolution, notes, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(audit_id) DO UPDATE SET reviewed_by = excluded.reviewed_by, reviewed_by_name = excluded.reviewed_by_name,
               resolution = excluded.resolution, notes = excluded.notes, reviewed_at = excluded.reviewed_at""",
            (audit_id, ctx.uid, ctx.user["name"], resolution, (notes or "")[:500] or None, now_iso()),
        )
        self.core.audit(client, {"action": "security_alert_reviewed", "resource": "audit", "resource_id": audit_id, "details": {"resolution": resolution}}, ctx)

    def active_sessions(self, ctx: Context) -> list[dict]:
        require(ctx, "security:read")
        rows = self.store.all("SELECT id, uid, created_at, last_seen_at, expires_at, ip, user_agent, acting_role FROM sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC", (now_iso(),))
        _, roles = self.core.rbac()
        role_of = {uid: info["display_name"] for info in roles.values() for uid in info.get("member_uids", [])}
        for row in rows:
            user = self.directory.get_user(row["uid"]) or {}
            row.update({"staff_name": user.get("name", row["uid"]), "staff_email": user.get("email"), "role_name": role_of.get(row["uid"], "—")})
        return rows

    def revoke_session(self, ctx: Context, session_id: str, client: dict) -> None:
        require(ctx, "staff:manage")
        session = self.store.one("SELECT uid FROM sessions WHERE id = ?", (session_id,))
        if not session:
            raise not_found("Session")
        self.store.execute("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (now_iso(), session_id))
        self.core.audit(client, {"action": "session_revoked", "resource": "session", "resource_id": session["uid"], "severity": "medium"}, ctx)

    def password_resets(self, ctx: Context) -> list[dict]:
        require(ctx, "staff:manage")
        rows = self.store.all(
            "SELECT * FROM password_resets WHERE status = 'requested' OR (status = 'issued' AND expires_at > ?) ORDER BY requested_at DESC",
            (now_iso(),),
        )
        for row in rows:
            user = self.directory.get_user(row["uid"]) or {}
            row.update({"staff_name": user.get("name", row["uid"]), "staff_email": user.get("email")})
            row.pop("code_hash", None)
        return rows

    def issue_reset(self, ctx: Context, reset_id: int, client: dict) -> dict:
        require(ctx, "staff:manage")
        require_step_up(ctx, "Issuing a password reset code requires re-authentication.")
        reset = self.store.one("SELECT * FROM password_resets WHERE id = ? AND status IN ('requested','issued')", (reset_id,))
        if not reset:
            raise not_found("Reset request")
        issued = self.core.issue_reset_code(reset["uid"], ctx.uid, reset_id)
        user = self.directory.get_user(reset["uid"]) or {}
        self.core.audit(client, {"action": "password_reset_issued", "resource": "account", "resource_id": reset["uid"], "severity": "medium"}, ctx)
        return {"code": issued["code"], "expires_at": issued["expires_at"], "email": user.get("email"), "username": reset["uid"]}

    def reject_reset(self, ctx: Context, reset_id: int, client: dict) -> None:
        require(ctx, "staff:manage")
        cursor = self.store.execute("UPDATE password_resets SET status = 'rejected' WHERE id = ? AND status IN ('requested','issued')", (reset_id,))
        if cursor.rowcount == 0:
            raise not_found("Reset request")
        self.core.audit(client, {"action": "password_reset_rejected", "resource": "auth", "resource_id": reset_id, "severity": "low"}, ctx)

    # ------------------------------------------------------------------ devices
    def _device(self, device_id: int) -> dict | None:
        row = self.store.one("SELECT * FROM devices WHERE id = ?", (device_id,))
        if row:
            user = self.directory.get_user(row["uid"]) or {}
            reviewer = self.directory.get_user(row["reviewed_by"]) if row.get("reviewed_by") else None
            row.update({"staff_name": user.get("name", row["uid"]), "staff_email": user.get("email"), "reviewed_by_name": reviewer.get("name") if reviewer else None})
        return row

    def my_devices(self, ctx: Context) -> list[dict]:
        rows = self.store.all("SELECT id FROM devices WHERE uid = ? AND status <> 'revoked' ORDER BY created_at DESC", (ctx.uid,))
        return [self._device(row["id"]) for row in rows]

    def register_device(self, ctx: Context, data: dict, client: dict) -> dict:
        require_step_up(ctx)
        name = (data.get("device_name") or "").strip()
        device_type = data.get("device_type")
        justification = (data.get("justification") or "").strip()
        if not name or len(name) > 100:
            raise bad_request("Device name is required", "device_name")
        if device_type not in ("Smartphone", "Tablet", "Desktop/Laptop", "Workstation"):
            raise bad_request("Choose a device type", "device_type")
        if len(justification) < 10:
            raise bad_request("Justification must be at least 10 characters", "justification")
        pending = self.store.one("SELECT COUNT(*) AS n FROM devices WHERE uid = ? AND status = 'pending'", (ctx.uid,))["n"]
        if pending >= 3:
            raise conflict("You already have 3 pending device requests")
        device_id = self.store.execute(
            "INSERT INTO devices (uid, device_name, device_type, platform, justification, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
            (ctx.uid, name, device_type, (data.get("platform") or "")[:40] or None, justification[:255], now_iso()),
        ).lastrowid
        self.core.audit(client, {"action": "device_registration_requested", "resource": "device", "resource_id": device_id, "severity": "medium", "details": {"device_type": device_type}}, ctx)
        return self._device(device_id)

    def set_device_trust(self, ctx: Context, device_id: int, trusted: bool, client: dict) -> dict:
        device = self.store.one("SELECT * FROM devices WHERE id = ? AND uid = ?", (device_id, ctx.uid))
        if not device:
            raise not_found("Device")
        if trusted and device["status"] != "approved":
            raise conflict("Only approved devices can be trusted")
        if trusted and self.store.one("SELECT COUNT(*) AS n FROM devices WHERE uid = ? AND trusted = 1", (ctx.uid,))["n"] >= 5:
            raise conflict("You can trust at most 5 devices")
        self.store.execute("UPDATE devices SET trusted = ? WHERE id = ?", (1 if trusted else 0, device_id))
        self.core.audit(client, {"action": "device_trusted" if trusted else "device_untrusted", "resource": "device", "resource_id": device_id, "severity": "low"}, ctx)
        return self._device(device_id)

    def remove_device(self, ctx: Context, device_id: int, client: dict) -> None:
        cursor = self.store.execute("UPDATE devices SET status = 'revoked', trusted = 0 WHERE id = ? AND uid = ?", (device_id, ctx.uid))
        if cursor.rowcount == 0:
            raise not_found("Device")
        self.core.audit(client, {"action": "device_removed", "resource": "device", "resource_id": device_id, "severity": "low"}, ctx)

    def all_devices(self, ctx: Context, status: str | None) -> list[dict]:
        require(ctx, "security:read")
        rows = self.store.all(
            "SELECT id FROM devices WHERE (? IS NULL OR status = ?) ORDER BY status = 'pending' DESC, created_at DESC",
            (status, status),
        )
        return [self._device(row["id"]) for row in rows]

    def review_device(self, ctx: Context, device_id: int, approve: bool, client: dict) -> dict:
        require(ctx, "staff:manage")
        status = "approved" if approve else "rejected"
        cursor = self.store.execute(
            "UPDATE devices SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
            (status, ctx.uid, now_iso(), device_id),
        )
        if cursor.rowcount == 0:
            raise not_found("Pending device request")
        self.core.audit(client, {"action": f"device_{status}", "resource": "device", "resource_id": device_id, "severity": "low"}, ctx)
        return self._device(device_id)


def _hours_ago(hours: int) -> str:
    from datetime import timedelta

    from .security import iso, now

    return iso(now() - timedelta(hours=hours))
