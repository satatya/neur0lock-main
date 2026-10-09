"""HTTP interface of the AAA server (called by the REST API only, over mutual TLS).

The REST API forwards the end user's bearer token, optional X-Step-Up-Token, and the client's
address/user agent in X-Client-IP / X-Client-User-Agent for accounting.
"""
import threading
import time

from flask import Blueprint, current_app, jsonify, request

from .errors import AAAError, bad_request

api = Blueprint("aaa", __name__)


# ---------------------------------------------------------------------------- helpers
def svc():
    return current_app.extensions["aaa"]["service"]


def adm():
    return current_app.extensions["aaa"]["admin"]


def client() -> dict:
    return {"ip": request.headers.get("X-Client-IP") or request.remote_addr, "user_agent": request.headers.get("X-Client-User-Agent")}


def bearer() -> str | None:
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.startswith("Bearer ") else None


def ctx():
    return svc().context(bearer(), request.headers.get("X-Step-Up-Token"))


def body() -> dict:
    data = request.get_json(silent=True)
    if data is None and request.data:
        raise bad_request("Request body is not valid JSON")
    return data if isinstance(data, dict) else {}


def text(data: dict, key: str, max_len: int = 255, required: bool = False, label: str | None = None) -> str | None:
    value = data.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise bad_request(f"{label or key} is required", key)
        return None
    if not isinstance(value, (str, int)):
        raise bad_request(f"{label or key} must be text", key)
    value = str(value).strip()
    if len(value) > max_len:
        raise bad_request(f"{label or key} must be at most {max_len} characters", key)
    return value


def ok(data=None, meta: dict | None = None, status: int = 200):
    payload = {"data": data}
    if meta:
        payload["meta"] = meta
    return jsonify(payload), status


_bucket_lock = threading.Lock()


def rate_limit(name: str, max_hits: int, window_seconds: int) -> None:
    """Per end-user address (forwarded by the REST API); account lockout is enforced separately."""
    buckets: dict[str, list[float]] = current_app.extensions["aaa"]["buckets"]
    key = f"{name}:{client()['ip']}"
    now = time.time()
    with _bucket_lock:
        hits = [t for t in buckets.get(key, []) if t > now - window_seconds]
        if len(hits) >= max_hits:
            retry = int(hits[0] + window_seconds - now) + 1
            raise AAAError(429, "RATE_LIMITED", f"Too many attempts. Try again in {max(1, retry // 60)} minute(s).")
        hits.append(now)
        buckets[key] = hits


# ---------------------------------------------------------------------------- health
@api.get("/health")
def health():
    service = svc()
    directory_ok = service.directory.ping()
    forwarder = service.accounting.forwarder
    status = 200 if directory_ok else 503
    return jsonify({
        "status": "healthy" if directory_ok else "degraded",
        "directory": "connected" if directory_ok else "unavailable",
        "log_server": "connected" if forwarder.connected else ("disabled" if not forwarder.enabled else "reconnecting"),
    }), status


# ---------------------------------------------------------------------------- authentication
@api.post("/auth/login")
def login():
    rate_limit("login", 30, 900)
    data = body()
    identifier = text(data, "identifier", 120, True, "Username or email") or ""
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    if not password:
        raise bad_request("Password is required", "password")
    result = svc().login(identifier, password, client())
    return ok(result, {"message": "Verification code required" if result.get("mfa_required") else "Login successful"})


@api.post("/auth/mfa/verify")
def mfa_verify():
    rate_limit("login", 30, 900)
    data = body()
    return ok(svc().verify_mfa(text(data, "mfa_token", 200, True) or "", text(data, "code", 12), text(data, "backup_code", 20), client()), {"message": "Login successful"})


@api.post("/auth/logout")
def logout():
    svc().logout(bearer(), client())
    return ok(None, {"message": "Logout successful"})


@api.get("/auth/me")
def me():
    return ok(svc().me(ctx()))


@api.post("/auth/step-up")
def step_up():
    rate_limit("login", 30, 900)
    data = body()
    password = data.get("password") if isinstance(data.get("password"), str) else None
    return ok(svc().step_up(ctx(), password, text(data, "code", 12), client()))


@api.post("/auth/change-password")
def change_password():
    data = body()
    current = data.get("current_password") or ""
    new = data.get("new_password") or ""
    if not current or not new:
        raise bad_request("Current and new password are required")
    svc().change_password(ctx(), current, new, client())
    return ok(None, {"message": "Password changed. Other sessions have been signed out."})


@api.post("/auth/mfa/setup")
def mfa_setup():
    return ok(svc().mfa_setup(ctx(), client()))


@api.post("/auth/mfa/enable")
def mfa_enable():
    return ok(svc().mfa_enable(ctx(), text(body(), "code", 12, True, "Code") or "", client()), {"message": "Authenticator app verification enabled"})


@api.post("/auth/mfa/disable")
def mfa_disable():
    svc().mfa_disable(ctx(), body().get("password"), client())
    return ok(None, {"message": "Authenticator app verification disabled"})


@api.post("/auth/mfa/backup-codes")
def backup_codes():
    return ok(svc().regenerate_backup_codes(ctx(), body().get("password"), client()))


@api.put("/auth/settings")
def settings():
    return ok(svc().save_settings(ctx(), body()), {"message": "Settings saved"})


@api.post("/auth/password-reset/request")
def reset_request():
    rate_limit("reset", 10, 900)
    svc().request_password_reset(text(body(), "identifier", 120, True, "Username or email") or "", client())
    return ok(None, {"message": "If an active account exists, a reset request has been recorded. Your administrator will issue a one-time reset code."})


@api.post("/auth/password-reset/confirm")
def reset_confirm():
    rate_limit("reset", 10, 900)
    data = body()
    svc().confirm_password_reset(
        text(data, "identifier", 120, True, "Username or email") or "",
        text(data, "code", 20, True, "Reset code") or "",
        data.get("new_password") or "",
        client(),
    )
    return ok(None, {"message": "Password updated. You can now sign in."})


@api.post("/auth/unlock-request")
def unlock_request():
    rate_limit("reset", 10, 900)
    data = body()
    identifier = text(data, "identifier", 120, True, "Username or email") or ""
    user = svc().directory.find_user(identifier)
    message = text(data, "message", 300)
    svc().audit(client(), {
        "actor": identifier, "actor_uid": user["uid"] if user else None, "action": "unlock_requested", "resource": "auth",
        "resource_id": user["uid"] if user else None, "outcome": "success" if user else "failure", "severity": "medium",
        "details": {"message": message} if message else None,
    })
    return ok(None, {"message": "Your request has been sent to the administrators."})


# ---------------------------------------------------------------------------- sign-up
@api.get("/signup/roles")
def signup_roles():
    return ok(svc().signup_roles())


@api.post("/signup")
def signup():
    rate_limit("signup", 10, 900)
    data = body()
    return ok(svc().signup(data, client()), {"message": "Account created"}, 201)


@api.delete("/signup/<uid>")
def cancel_signup(uid: str):
    svc().cancel_signup(uid, client())
    return ok(None, {"message": "Sign-up cancelled"})


# ---------------------------------------------------------------------------- authorization
@api.post("/authorize")
def authorize():
    data = body()
    required = data.get("permissions") or []
    if not isinstance(required, list):
        raise bad_request("permissions must be a list")
    mode = "any" if data.get("mode") == "any" else "all"
    request_info = data.get("request") if isinstance(data.get("request"), dict) else None
    return ok(svc().authorize(bearer(), request.headers.get("X-Step-Up-Token"), [str(c) for c in required], mode, client(), request_info))


@api.get("/act-as/roles")
def act_as_roles():
    return ok(svc().act_as_roles(ctx()))


@api.post("/auth/act-as")
def act_as():
    role = body().get("role")
    return ok(svc().act_as(ctx(), role if isinstance(role, str) else None, client()))


# ---------------------------------------------------------------------------- accounting
@api.post("/accounting")
def accounting():
    data = body()
    events = data.get("events") if isinstance(data.get("events"), list) else [data]
    caller = None
    if bearer():
        try:
            caller = svc().context(bearer(), touch=False)
        except AAAError:
            caller = None
    for event in events[:50]:
        if not isinstance(event, dict) or not event.get("action"):
            continue
        keys = ("action", "resource", "resource_id", "patient_id", "patient_name", "outcome", "severity", "details")
        if not caller:  # with a valid session, the session identity is authoritative
            keys += ("actor", "actor_uid", "actor_name", "actor_role", "ip", "user_agent")
        clean = {k: event[k] for k in keys if event.get(k) is not None}
        svc().audit(client(), clean, caller)
    return ok(None, None, 202)


@api.get("/audit")
def audit_list():
    rows, total = adm().audit_query(ctx(), request.args.to_dict())
    return ok(rows, {"count": len(rows), "total": total, "limit": int(request.args.get("limit") or 100), "offset": int(request.args.get("offset") or 0)})


@api.get("/audit/stats")
def audit_stats():
    return ok(adm().audit_stats(ctx()))


# ---------------------------------------------------------------------------- accounts
@api.get("/directory")
def directory_list():
    ctx()  # any signed-in user
    return ok(adm().directory_list())


@api.get("/users")
def users():
    data = adm().list_users(ctx(), request.args.get("kind"))
    return ok(data, {"count": len(data)})


@api.post("/users")
def create_user():
    return ok(adm().create_user(ctx(), body(), client()), {"message": "Account created"}, 201)


@api.get("/users/<uid>")
def get_user(uid: str):
    return ok(adm().get_user(ctx(), uid))


@api.put("/users/<uid>")
def update_user(uid: str):
    return ok(adm().update_user(ctx(), uid, body(), client()), {"message": "Account updated"})


@api.post("/users/<uid>/unlock")
def unlock_user(uid: str):
    return ok(adm().unlock(ctx(), uid, client()), {"message": "Account unlocked"})


@api.post("/users/<uid>/reset-password")
def reset_user_password(uid: str):
    return ok(adm().reset_password(ctx(), uid, client()), {"message": "Reset code issued"})


@api.post("/users/<uid>/revoke-sessions")
def revoke_user_sessions(uid: str):
    revoked = adm().revoke_user_sessions(ctx(), uid, client())
    return ok(None, {"message": f"{revoked} session(s) signed out", "revoked": revoked})


@api.delete("/users/<uid>")
def deactivate_user(uid: str):
    adm().deactivate(ctx(), uid, client())
    return ok(None, {"message": "Account deactivated"})


@api.get("/signups")
def signups():
    data = adm().list_signups(ctx(), request.args.get("status") or "pending")
    return ok(data, {"count": len(data)})


@api.post("/signups/<int:signup_id>/approve")
def approve_signup(signup_id: int):
    data = body()
    return ok(adm().review_signup(ctx(), signup_id, True, text(data, "role", 40), text(data, "note", 500), client()), {"message": "Sign-up approved"})


@api.post("/signups/<int:signup_id>/reject")
def reject_signup(signup_id: int):
    return ok(adm().review_signup(ctx(), signup_id, False, None, text(body(), "note", 500), client()), {"message": "Sign-up rejected"})


# ---------------------------------------------------------------------------- roles & permissions
@api.get("/roles")
def roles():
    data = adm().list_roles(ctx())
    return ok(data, {"count": len(data)})


@api.get("/permissions")
def permissions():
    data = adm().permission_catalog(ctx())
    return ok(data, {"count": len(data)})


@api.post("/roles")
def create_role():
    return ok(adm().create_role(ctx(), body(), client()), {"message": "Role created"}, 201)


@api.put("/roles/<name>")
def update_role(name: str):
    result = adm().update_role(ctx(), name, body(), client())
    changes = result.pop("changes", {})
    return ok(result, {"message": "Role updated", **changes})


@api.put("/roles/<name>/permissions/<path:code>")
def set_role_permission(name: str, code: str):
    granted = body().get("granted")
    if not isinstance(granted, bool):
        raise bad_request("granted (true/false) is required", "granted")
    result = adm().set_permission(ctx(), name, code, granted, client())
    changes = result.pop("changes", {})
    return ok(result, {"message": "Permission granted" if granted else "Permission revoked", **changes})


@api.delete("/roles/<name>")
def delete_role(name: str):
    adm().delete_role(ctx(), name, client())
    return ok(None, {"message": "Role deleted"})


# ---------------------------------------------------------------------------- security centre
@api.get("/security/overview")
def security_overview():
    return ok(adm().security_overview(ctx()))


@api.get("/security/alerts")
def security_alerts():
    data = adm().security_alerts(ctx(), request.args.get("status") or "all", request.args.get("severity"))
    return ok(data, {"count": len(data)})


@api.post("/security/alerts/<int:audit_id>/review")
def review_alert(audit_id: int):
    data = body()
    adm().review_alert(ctx(), audit_id, text(data, "resolution", 40) or "resolved", text(data, "notes", 500), client())
    return ok(None, {"message": "Alert marked as reviewed"})


@api.get("/security/sessions")
def security_sessions():
    data = adm().active_sessions(ctx())
    return ok(data, {"count": len(data)})


@api.post("/security/sessions/<session_id>/revoke")
def revoke_session(session_id: str):
    adm().revoke_session(ctx(), session_id, client())
    return ok(None, {"message": "Session signed out"})


@api.get("/security/password-resets")
def password_resets():
    data = adm().password_resets(ctx())
    return ok(data, {"count": len(data)})


@api.post("/security/password-resets/<int:reset_id>/issue")
def issue_reset(reset_id: int):
    return ok(adm().issue_reset(ctx(), reset_id, client()))


@api.post("/security/password-resets/<int:reset_id>/reject")
def reject_reset(reset_id: int):
    adm().reject_reset(ctx(), reset_id, client())
    return ok(None, {"message": "Reset request rejected"})


# ---------------------------------------------------------------------------- devices
@api.get("/devices/mine")
def my_devices():
    data = adm().my_devices(ctx())
    return ok(data, {"count": len(data)})


@api.post("/devices")
def register_device():
    return ok(adm().register_device(ctx(), body(), client()), {"message": "Device submitted for administrator approval"}, 201)


@api.put("/devices/mine/<int:device_id>")
def trust_device(device_id: int):
    trusted = body().get("trusted")
    if not isinstance(trusted, bool):
        raise bad_request("trusted (true/false) is required", "trusted")
    return ok(adm().set_device_trust(ctx(), device_id, trusted, client()))


@api.delete("/devices/mine/<int:device_id>")
def remove_device(device_id: int):
    adm().remove_device(ctx(), device_id, client())
    return ok(None, {"message": "Device removed"})


@api.get("/devices")
def all_devices():
    data = adm().all_devices(ctx(), request.args.get("status"))
    return ok(data, {"count": len(data)})


@api.post("/devices/<int:device_id>/approve")
def approve_device(device_id: int):
    return ok(adm().review_device(ctx(), device_id, True, client()), {"message": "Device approved"})


@api.post("/devices/<int:device_id>/reject")
def reject_device(device_id: int):
    return ok(adm().review_device(ctx(), device_id, False, client()), {"message": "Device rejected"})
