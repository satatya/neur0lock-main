"""OpenLDAP directory access ("Active Directory with user details and permissions").

Layout (standard schema only):
    ou=people,<base>       inetOrgPerson users           uid, cn, sn, mail, telephoneNumber,
                                                         title, employeeNumber (licence no.)
    ou=roles,<base>        groupOfNames per role         cn = role name, ou = display name,
                                                         description, businessCategory = flags,
                                                         member = user DNs
    ou=permissions,<base>  groupOfNames per permission   cn = permission code,
                                                         member = role DNs holding it
groupOfNames requires at least one member, so every group also lists a placeholder DN.
"""
import re
import ssl
import threading
from urllib.parse import urlparse

from ldap3 import (
    BASE,
    LEVEL,
    MODIFY_ADD,
    MODIFY_DELETE,
    MODIFY_REPLACE,
    MOCK_SYNC,
    NONE,
    SYNC,
    Connection,
    Server,
    Tls,
)
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from .security import ssha_check, ssha_hash

UID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
ROLE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


class DirectoryError(Exception):
    pass


class DirectoryOperationError(DirectoryError):
    """The server rejected an operation (not a connection problem); never retried."""


def _values(attributes: dict, name: str) -> list:
    value = attributes.get(name)
    if value is None:
        # attribute names are case-insensitive
        for key, candidate in attributes.items():
            if key.lower() == name.lower():
                value = candidate
                break
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [v.decode("utf-8", "ignore") if isinstance(v, bytes) else v for v in value]
    return [value.decode("utf-8", "ignore") if isinstance(value, bytes) else value]


def _first(attributes: dict, name: str, default=None):
    values = _values(attributes, name)
    return values[0] if values else default


class Directory:
    def __init__(self, config):
        self.config = config
        self.base = config.LDAP_BASE_DN
        self.people = f"ou=people,{self.base}"
        self.roles = f"ou=roles,{self.base}"
        self.permissions = f"ou=permissions,{self.base}"
        self.placeholder = f"cn=placeholder,{self.base}"
        self.mock = config.LDAP_URL.startswith("mock://")
        self._lock = threading.RLock()
        self._conn = None
        if self.mock:
            self.server = Server("neurolock-mock", get_info=NONE)
            bind_password = config.LDAP_BIND_PASSWORD or "mock"
            self._conn = Connection(self.server, user=config.LDAP_BIND_DN, password=bind_password, client_strategy=MOCK_SYNC)
            self._conn.strategy.add_entry(self.base, {"objectClass": ["top", "dcObject", "organization"], "dc": self.base.split(",")[0][3:], "o": "NeuroLock"})
            self._conn.strategy.add_entry(config.LDAP_BIND_DN, {"objectClass": ["simpleSecurityObject", "organizationalRole"], "cn": "admin", "userPassword": bind_password})
            self._conn.bind()
        else:
            tls = Tls(ca_certs_file=config.LDAP_CA_FILE, validate=ssl.CERT_REQUIRED, version=ssl.PROTOCOL_TLS_CLIENT)
            parsed = urlparse(config.LDAP_URL)
            self.server = Server(
                parsed.hostname,
                port=parsed.port or (636 if parsed.scheme == "ldaps" else 389),
                use_ssl=parsed.scheme == "ldaps",
                tls=tls,
                get_info=NONE,
                connect_timeout=5,
            )

    # ------------------------------------------------------------------ plumbing
    def _open(self, user: str, password: str) -> Connection:
        conn = Connection(self.server, user=user, password=password, client_strategy=SYNC, raise_exceptions=False, receive_timeout=10)
        if not conn.open() and conn.closed:
            raise DirectoryError("Cannot connect to the directory server")
        if self.config.LDAP_START_TLS and not self.server.ssl and not conn.start_tls():
            raise DirectoryError(f"StartTLS failed: {conn.result}")
        return conn

    def _admin(self) -> Connection:
        if self._conn is not None and (self.mock or (not self._conn.closed and self._conn.bound)):
            return self._conn
        conn = self._open(self.config.LDAP_BIND_DN, self.config.LDAP_BIND_PASSWORD)
        if not conn.bind():
            raise DirectoryError(f"Directory service bind failed: {conn.result.get('description')}")
        self._conn = conn
        return conn

    def _run(self, operation):
        with self._lock:
            for attempt in (1, 2):
                try:
                    return operation(self._admin())
                except DirectoryOperationError:
                    raise
                except (LDAPException, OSError, DirectoryError):
                    if self.mock or attempt == 2:
                        raise
                    self._conn = None  # reconnect once

    def _search(self, base: str, query: str, attributes: list[str], scope=LEVEL) -> list[tuple[str, dict]]:
        def op(conn):
            conn.search(base, query, search_scope=scope, attributes=attributes)
            return [(entry["dn"], entry.get("attributes", {})) for entry in (conn.response or []) if entry.get("type") == "searchResEntry"]

        return self._run(op)

    def _check(self, conn: Connection, ok: bool, action: str) -> None:
        if not ok:
            raise DirectoryOperationError(f"{action} failed: {conn.result.get('description')} {conn.result.get('message') or ''}".strip())

    def _add(self, dn: str, object_class: list[str], attributes: dict) -> None:
        self._run(lambda conn: self._check(conn, conn.add(dn, object_class, attributes), f"Add {dn}"))

    def _modify(self, dn: str, changes: dict) -> None:
        self._run(lambda conn: self._check(conn, conn.modify(dn, changes), f"Modify {dn}"))

    def _delete(self, dn: str) -> None:
        self._run(lambda conn: self._check(conn, conn.delete(dn), f"Delete {dn}"))

    def _exists(self, dn: str) -> bool:
        def op(conn):
            conn.search(dn, "(objectClass=*)", search_scope=BASE, attributes=["objectClass"])
            return any(entry.get("type") == "searchResEntry" for entry in (conn.response or []))

        try:
            return self._run(op)
        except DirectoryError:
            return False

    def ping(self) -> bool:
        try:
            return self._exists(self.base)
        except Exception:  # noqa: BLE001
            return False

    # ------------------------------------------------------------------ DNs
    def user_dn(self, uid: str) -> str:
        return f"uid={uid},{self.people}"

    def role_dn(self, role: str) -> str:
        return f"cn={role},{self.roles}"

    def permission_dn(self, code: str) -> str:
        return f"cn={code},{self.permissions}"

    # ------------------------------------------------------------------ structure
    def ensure_structure(self) -> None:
        for ou in ("people", "roles", "permissions"):
            dn = f"ou={ou},{self.base}"
            if not self._exists(dn):
                self._add(dn, ["top", "organizationalUnit"], {"ou": ou})

    # ------------------------------------------------------------------ users
    USER_ATTRS = ["uid", "cn", "sn", "givenName", "mail", "telephoneNumber", "title", "employeeNumber", "departmentNumber", "createTimestamp"]

    def _user(self, dn: str, attrs: dict) -> dict:
        return {
            "uid": _first(attrs, "uid"),
            "name": _first(attrs, "cn"),
            "email": _first(attrs, "mail"),
            "phone": _first(attrs, "telephoneNumber"),
            "title": _first(attrs, "title"),
            "licence_number": _first(attrs, "employeeNumber"),
            "department": _first(attrs, "departmentNumber"),
            "dn": dn,
        }

    def find_user(self, identifier: str) -> dict | None:
        value = escape_filter_chars((identifier or "").strip().lower())
        if not value:
            return None
        results = self._search(self.people, f"(&(objectClass=inetOrgPerson)(|(uid={value})(mail={value})))", self.USER_ATTRS)
        return self._user(*results[0]) if results else None

    def get_user(self, uid: str) -> dict | None:
        results = self._search(self.people, f"(&(objectClass=inetOrgPerson)(uid={escape_filter_chars(uid)}))", self.USER_ATTRS)
        return self._user(*results[0]) if results else None

    def list_users(self) -> list[dict]:
        return [self._user(dn, attrs) for dn, attrs in self._search(self.people, "(objectClass=inetOrgPerson)", self.USER_ATTRS)]

    def email_taken(self, email: str, except_uid: str | None = None) -> bool:
        results = self._search(self.people, f"(mail={escape_filter_chars(email.lower())})", ["uid"])
        return any(_first(attrs, "uid") != except_uid for _, attrs in results)

    def create_user(self, uid: str, name: str, email: str, password: str, phone: str | None = None, title: str | None = None, licence_number: str | None = None) -> None:
        if not UID_RE.match(uid):
            raise DirectoryError("Invalid username")
        parts = name.split()
        attributes = {
            "uid": uid,
            "cn": name,
            "sn": parts[-1] if parts else uid,
            "mail": email.lower(),
            "userPassword": ssha_hash(password),
        }
        if len(parts) > 1:
            attributes["givenName"] = " ".join(parts[:-1])
        if phone:
            attributes["telephoneNumber"] = phone
        if title:
            attributes["title"] = title
        if licence_number:
            attributes["employeeNumber"] = licence_number
        self._add(self.user_dn(uid), ["top", "person", "organizationalPerson", "inetOrgPerson"], attributes)

    def update_user(self, uid: str, name: str | None = None, email: str | None = None, phone: str | None = None, title: str | None = None) -> None:
        changes = {}
        if name:
            parts = name.split()
            changes["cn"] = [(MODIFY_REPLACE, [name])]
            changes["sn"] = [(MODIFY_REPLACE, [parts[-1]])]
        if email:
            changes["mail"] = [(MODIFY_REPLACE, [email.lower()])]
        if phone is not None:
            changes["telephoneNumber"] = [(MODIFY_REPLACE, [phone] if phone else [])]
        if title:
            changes["title"] = [(MODIFY_REPLACE, [title])]
        if changes:
            self._modify(self.user_dn(uid), changes)

    def set_password(self, uid: str, password: str) -> None:
        self._modify(self.user_dn(uid), {"userPassword": [(MODIFY_REPLACE, [ssha_hash(password)])]})

    def delete_user(self, uid: str) -> None:
        for role in self.user_roles(uid):
            self._modify(self.role_dn(role), {"member": [(MODIFY_DELETE, [self.user_dn(uid)])]})
        self._delete(self.user_dn(uid))

    def verify_password(self, uid: str, password: str) -> bool:
        """Authenticates by binding to the directory as the user (empty passwords never bind)."""
        if not password:
            return False
        dn = self.user_dn(uid)
        if self.mock:
            results = self._search(self.people, f"(uid={escape_filter_chars(uid)})", ["userPassword"])
            return bool(results) and any(ssha_check(password, value) for value in _values(results[0][1], "userPassword"))
        try:
            conn = self._open(dn, password)
            ok = conn.bind()
            conn.unbind()
            return bool(ok)
        except (LDAPException, OSError):
            return False

    # ------------------------------------------------------------------ roles
    ROLE_ATTRS = ["cn", "ou", "description", "businessCategory", "member"]

    def _role(self, dn: str, attrs: dict) -> dict:
        members = [m for m in _values(attrs, "member") if m.lower() != self.placeholder.lower()]
        return {
            "name": _first(attrs, "cn"),
            "display_name": _first(attrs, "ou") or _first(attrs, "cn"),
            "description": _first(attrs, "description"),
            "flags": sorted(set(_values(attrs, "businessCategory"))),
            "member_uids": [m.split(",")[0].split("=", 1)[1] for m in members if m.lower().startswith("uid=")],
        }

    def list_roles(self) -> list[dict]:
        return [self._role(dn, attrs) for dn, attrs in self._search(self.roles, "(objectClass=groupOfNames)", self.ROLE_ATTRS)]

    def get_role(self, name: str) -> dict | None:
        results = self._search(self.roles, f"(&(objectClass=groupOfNames)(cn={escape_filter_chars(name)}))", self.ROLE_ATTRS)
        return self._role(*results[0]) if results else None

    def user_roles(self, uid: str) -> list[str]:
        dn = escape_filter_chars(self.user_dn(uid))
        return sorted(_first(attrs, "cn") for _, attrs in self._search(self.roles, f"(&(objectClass=groupOfNames)(member={dn}))", ["cn"]))

    def create_role(self, name: str, display_name: str, description: str | None, flags: list[str]) -> None:
        if not ROLE_RE.match(name):
            raise DirectoryError("Invalid role name")
        attributes = {"cn": name, "ou": display_name, "member": [self.placeholder]}
        if description:
            attributes["description"] = description
        if flags:
            attributes["businessCategory"] = flags
        self._add(self.role_dn(name), ["top", "groupOfNames"], attributes)

    def update_role(self, name: str, display_name: str | None = None, description: str | None = None, flags: list[str] | None = None) -> None:
        changes = {}
        if display_name:
            changes["ou"] = [(MODIFY_REPLACE, [display_name])]
        if description is not None:
            changes["description"] = [(MODIFY_REPLACE, [description] if description else [])]
        if flags is not None:
            changes["businessCategory"] = [(MODIFY_REPLACE, flags)]
        if changes:
            self._modify(self.role_dn(name), changes)

    def delete_role(self, name: str) -> None:
        dn = self.role_dn(name)
        for code, roles in self.permission_holders().items():
            if name in roles:
                self._modify(self.permission_dn(code), {"member": [(MODIFY_DELETE, [dn])]})
        self._delete(dn)

    def set_user_role(self, uid: str, role: str) -> None:
        """Each account has exactly one role."""
        user_dn = self.user_dn(uid)
        for current in self.user_roles(uid):
            if current != role:
                self._modify(self.role_dn(current), {"member": [(MODIFY_DELETE, [user_dn])]})
        if role not in self.user_roles(uid):
            self._modify(self.role_dn(role), {"member": [(MODIFY_ADD, [user_dn])]})

    def remove_user_roles(self, uid: str) -> None:
        for current in self.user_roles(uid):
            self._modify(self.role_dn(current), {"member": [(MODIFY_DELETE, [self.user_dn(uid)])]})

    # ------------------------------------------------------------------ permissions
    def ensure_permission(self, code: str, category: str, label: str) -> bool:
        dn = self.permission_dn(code)
        if self._exists(dn):
            return False
        self._add(dn, ["top", "groupOfNames"], {"cn": code, "ou": category, "description": label, "member": [self.placeholder]})
        return True

    def permission_holders(self) -> dict[str, set[str]]:
        """permission code -> set of role names that hold it."""
        holders: dict[str, set[str]] = {}
        for _, attrs in self._search(self.permissions, "(objectClass=groupOfNames)", ["cn", "member"]):
            code = _first(attrs, "cn")
            roles = set()
            for member in _values(attrs, "member"):
                if member.lower().endswith(self.roles.lower()) and member.lower().startswith("cn="):
                    roles.add(member.split(",")[0].split("=", 1)[1])
            holders[code] = roles
        return holders

    def grant(self, role: str, code: str) -> None:
        self._modify(self.permission_dn(code), {"member": [(MODIFY_ADD, [self.role_dn(role)])]})

    def revoke(self, role: str, code: str) -> None:
        self._modify(self.permission_dn(code), {"member": [(MODIFY_DELETE, [self.role_dn(role)])]})
