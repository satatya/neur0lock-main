import pyotp
import pytest
from cryptography.fernet import Fernet

from app import create_app
from app.config import Config

PASSWORD = "Demo@1234"


@pytest.fixture()
def app():
    config = Config(LDAP_URL="mock://", DB_PATH=":memory:", SECRET_KEY=Fernet.generate_key().decode(), SYSLOG_HOST="", SEED_DEMO=True)
    return create_app(config, run_bootstrap=True)


@pytest.fixture()
def client(app):
    return app.test_client()


def login(client, identifier, password=PASSWORD):
    return client.post("/v1/auth/login", json={"identifier": identifier, "password": password})


def token_for(client, identifier):
    response = login(client, identifier)
    assert response.status_code == 200, response.get_json()
    return response.get_json()["data"]["token"]


def auth(token, step_up=None):
    headers = {"Authorization": f"Bearer {token}"}
    if step_up:
        headers["X-Step-Up-Token"] = step_up
    return headers


def step_up(client, token):
    response = client.post("/v1/auth/step-up", json={"password": PASSWORD}, headers=auth(token))
    assert response.status_code == 200, response.get_json()
    return response.get_json()["data"]["step_up_token"]


def permissions(client, token):
    response = client.post("/v1/authorize", json={}, headers=auth(token))
    assert response.status_code == 200, response.get_json()
    return set(response.get_json()["data"]["permissions"])


@pytest.mark.parametrize("uid,role", [("admin", "admin"), ("psychiatrist", "psychiatrist"), ("psychologist", "psychologist"), ("therapist", "therapist"), ("nurse", "nurse"), ("patient", "patient")])
def test_every_demo_account_logs_in_with_its_role(client, uid, role):
    for identifier in (uid, f"{uid}@neurolock.com"):
        data = login(client, identifier).get_json()["data"]
        assert data["user"]["role"] == role
        assert data["permissions"]


def test_wrong_password_and_lockout(client):
    first = login(client, "therapist", "wrong-pass-1")
    assert first.status_code == 401
    assert first.get_json()["error"]["details"]["attempts_remaining"] == 4
    for _ in range(4):
        last = login(client, "therapist", "wrong-pass-1")
    assert last.status_code == 423
    assert login(client, "therapist").status_code == 423  # correct password refused while locked


def test_empty_password_never_authenticates(client):
    assert login(client, "admin", "").status_code == 400


def test_roles_differ_and_come_from_the_directory(client):
    therapist = permissions(client, token_for(client, "therapist"))
    psychologist = permissions(client, token_for(client, "psychologist"))
    patient = permissions(client, token_for(client, "patient"))
    assert "assessments:create" not in therapist and "assessments:create" in psychologist
    assert "medications:prescribe" not in psychologist
    assert patient == {"portal:access", "portal:book"}


def test_authorize_reports_missing_permissions_and_audits_denial(client, app):
    token = token_for(client, "therapist")
    response = client.post("/v1/authorize", json={"permissions": ["assessments:create"]}, headers=auth(token))
    data = response.get_json()["data"]
    assert data["allowed"] is False and data["missing"] == ["assessments:create"]
    store = app.extensions["aaa"]["service"].store
    assert store.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_denied'")["n"] == 1


def test_admin_permission_change_applies_immediately(client):
    admin = token_for(client, "admin")
    therapist = token_for(client, "therapist")
    url = "/v1/roles/therapist/permissions/assessments:create"
    assert client.put(url, json={"granted": True}, headers=auth(admin)).status_code == 401  # step-up required
    stepped = step_up(client, admin)
    assert client.put(url, json={"granted": True}, headers=auth(admin, stepped)).status_code == 200
    assert "assessments:create" in permissions(client, therapist)
    client.put(url, json={"granted": False}, headers=auth(admin, stepped))
    assert "assessments:create" not in permissions(client, therapist)


def test_last_admin_cannot_be_removed(client):
    admin = token_for(client, "admin")
    stepped = step_up(client, admin)
    response = client.put("/v1/roles/admin/permissions/roles:manage", json={"granted": False}, headers=auth(admin, stepped))
    assert response.status_code == 409 and response.get_json()["error"]["code"] == "LOCKOUT_PREVENTED"


def test_patient_signup_is_active_immediately(client):
    roles = {r["name"]: r for r in client.get("/v1/signup/roles").get_json()["data"]}
    assert "admin" not in roles and roles["patient"]["requires_approval"] is False and roles["therapist"]["requires_approval"] is True
    response = client.post("/v1/signup", json={"username": "x1.patient", "email": "x1@example.org", "name": "X One", "password": "Secret123", "role": "patient"})
    assert response.status_code == 201 and response.get_json()["data"]["status"] == "active"
    data = login(client, "x1.patient", "Secret123").get_json()["data"]
    assert data["user"]["role"] == "patient" and data["user"]["portal_uid"] == "x1.patient"


def test_staff_signup_requires_approval_then_logs_into_role(client):
    response = client.post("/v1/signup", json={"username": "x1.therapist", "email": "x1@clinic.org", "name": "X One", "password": "Secret123", "role": "therapist", "licence_number": "RCI-1234"})
    assert response.get_json()["data"]["status"] == "pending"
    pending = login(client, "x1.therapist", "Secret123")
    assert pending.status_code == 403 and pending.get_json()["error"]["code"] == "ACCOUNT_PENDING"
    assert login(client, "x1.therapist", "wrong-pass-9").status_code == 401  # wrong password still counted

    admin = token_for(client, "admin")
    signups = client.get("/v1/signups", headers=auth(admin)).get_json()["data"]
    assert signups[0]["uid"] == "x1.therapist" and signups[0]["requested_role"] == "therapist"
    assert client.post(f"/v1/signups/{signups[0]['id']}/approve", json={}, headers=auth(admin)).status_code == 200

    data = login(client, "x1.therapist", "Secret123").get_json()["data"]
    assert data["user"]["role"] == "therapist" and data["user"]["can_act_as"] is False


def test_signup_validation(client):
    base = {"username": "dup", "email": "dup@example.org", "name": "Dup User", "password": "Secret123", "role": "patient"}
    assert client.post("/v1/signup", json={**base, "role": "admin"}).status_code == 400
    assert client.post("/v1/signup", json={**base, "password": "short"}).status_code == 400
    assert client.post("/v1/signup", json={**base, "username": "admin"}).status_code == 409
    assert client.post("/v1/signup", json={**base, "role": "nurse"}).status_code == 400  # licence required


def test_admin_can_act_as_any_role_others_cannot(client):
    admin = token_for(client, "admin")
    roles = [r["name"] for r in client.get("/v1/act-as/roles", headers=auth(admin)).get_json()["data"]]
    assert {"admin", "therapist", "patient"} <= set(roles)
    me = client.post("/v1/auth/act-as", json={"role": "therapist"}, headers=auth(admin)).get_json()["data"]
    assert me["user"]["role"] == "therapist" and me["user"]["acting_role"] == "therapist"
    assert permissions(client, admin) == permissions(client, token_for(client, "therapist"))
    patient_view = client.post("/v1/auth/act-as", json={"role": "patient"}, headers=auth(admin)).get_json()["data"]
    assert patient_view["user"]["portal_uid"] == "patient"
    back = client.post("/v1/auth/act-as", json={"role": None}, headers=auth(admin)).get_json()["data"]
    assert back["user"]["role"] == "admin" and "roles:manage" in back["permissions"]

    nurse = token_for(client, "nurse")
    assert client.post("/v1/auth/act-as", json={"role": "admin"}, headers=auth(nurse)).status_code == 403


def test_totp_mfa_and_backup_codes(client):
    token = token_for(client, "nurse")
    secret = client.post("/v1/auth/mfa/setup", headers=auth(token)).get_json()["data"]["secret"]
    codes = client.post("/v1/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=auth(token)).get_json()["data"]["backup_codes"]
    assert len(codes) == 10
    challenge = login(client, "nurse").get_json()["data"]
    assert challenge["mfa_required"] is True
    assert client.post("/v1/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": "000000"}).status_code == 401
    ok = client.post("/v1/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert ok.status_code == 200 and ok.get_json()["data"]["token"]
    second = login(client, "nurse").get_json()["data"]
    assert client.post("/v1/auth/mfa/verify", json={"mfa_token": second["mfa_token"], "backup_code": codes[0]}).status_code == 200
    third = login(client, "nurse").get_json()["data"]
    assert client.post("/v1/auth/mfa/verify", json={"mfa_token": third["mfa_token"], "backup_code": codes[0]}).status_code == 401


def test_logout_and_deactivation_end_sessions(client):
    admin = token_for(client, "admin")
    token = token_for(client, "nurse")
    assert client.post("/v1/auth/logout", headers=auth(token)).status_code == 200
    assert client.get("/v1/auth/me", headers=auth(token)).status_code == 401
    token = token_for(client, "nurse")
    assert client.delete("/v1/users/nurse", headers=auth(admin)).status_code == 200
    assert client.get("/v1/auth/me", headers=auth(token)).status_code == 401
    assert login(client, "nurse").status_code == 403


def test_password_reset_flow(client):
    client.post("/v1/auth/password-reset/request", json={"identifier": "therapist"})
    admin = token_for(client, "admin")
    resets = client.get("/v1/security/password-resets", headers=auth(admin)).get_json()["data"]
    stepped = step_up(client, admin)
    code = client.post(f"/v1/security/password-resets/{resets[0]['id']}/issue", headers=auth(admin, stepped)).get_json()["data"]["code"]
    assert client.post("/v1/auth/password-reset/confirm", json={"identifier": "therapist", "code": code, "new_password": "NewPass123"}).status_code == 200
    assert login(client, "therapist", "NewPass123").status_code == 200


def test_accounting_records_api_events_with_session_actor(client, app):
    token = token_for(client, "psychiatrist")
    client.post("/v1/accounting", json={"events": [{"action": "read", "resource": "therapy_note", "resource_id": 5, "patient_id": 1}]}, headers=auth(token))
    row = app.extensions["aaa"]["service"].store.one("SELECT * FROM audit_log WHERE action = 'read'")
    assert row["actor_uid"] == "psychiatrist" and row["actor_role"] == "psychiatrist"


def test_only_admin_sees_all_patients_by_default(client):
    assert "patients:read_all" in permissions(client, token_for(client, "admin"))
    for uid in ("psychiatrist", "psychologist", "therapist", "nurse"):
        perms = permissions(client, token_for(client, uid))
        assert "patients:read" in perms and "patients:read_all" not in perms


def test_admin_role_preview_uses_the_demo_caseload(client):
    admin = token_for(client, "admin")
    user = client.post("/v1/auth/act-as", json={"role": "psychologist"}, headers=auth(admin)).get_json()["data"]["user"]
    assert user["view_as"] == {"uid": "psychologist", "name": "Dr. Priya Rao"}
    assert client.post("/v1/auth/act-as", json={"role": None}, headers=auth(admin)).get_json()["data"]["user"]["view_as"] is None
    assert login(client, "therapist").get_json()["data"]["user"]["view_as"] is None
