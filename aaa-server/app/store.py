"""SQLite store for the AAA server's operational state.

Identity, role membership and permissions live in LDAP. This store keeps what LDAP has no
natural place for: account status and lockout counters, MFA secrets, sessions, sign-up
approvals, password-reset codes, device registrations and the queryable copy of the audit log
(the system of record for audit events is rsyslog).
"""
import json
import os
import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    uid TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'staff',
    status TEXT NOT NULL DEFAULT 'active',          -- active | pending | locked | inactive | rejected
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    lock_reason TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret BLOB,
    mfa_pending BLOB,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    last_login_ip TEXT,
    password_changed_at TEXT
);
CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    requested_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected
    licence_number TEXT,
    justification TEXT,
    created_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    uid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    ip TEXT,
    user_agent TEXT,
    acting_role TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
CREATE TABLE IF NOT EXISTS step_ups (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mfa_challenges (
    token_hash TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS backup_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',        -- requested | issued | used | rejected | expired
    code_hash TEXT,
    requested_at TEXT NOT NULL,
    requested_ip TEXT,
    issued_by TEXT,
    issued_at TEXT,
    expires_at TEXT,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    platform TEXT,
    justification TEXT,
    status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | revoked
    trusted INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT,
    reviewed_at TEXT,
    last_used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT,
    actor_uid TEXT,
    actor_name TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    patient_id INTEGER,
    patient_name TEXT,
    outcome TEXT NOT NULL DEFAULT 'success',
    severity TEXT NOT NULL DEFAULT 'info',
    ip TEXT,
    user_agent TEXT,
    details TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity, ts);
CREATE TABLE IF NOT EXISTS security_reviews (
    audit_id INTEGER PRIMARY KEY,
    reviewed_by TEXT,
    reviewed_by_name TEXT,
    resolution TEXT NOT NULL,
    notes TEXT,
    reviewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()
        directory = os.path.dirname(path)
        if directory and path != ":memory:":
            os.makedirs(directory, exist_ok=True)
        self._shared = None
        if path == ":memory:":
            # Single shared connection for tests
            self._shared = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
            self._shared.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            conn = self.conn
            conn.executescript(SCHEMA)

    @property
    def conn(self) -> sqlite3.Connection:
        if self._shared is not None:
            return self._shared
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=15, isolation_level=None, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    def execute(self, sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.conn.execute(sql, params)

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        row = self.execute(sql, params).fetchone()
        return dict(row) if row else None

    def all(self, sql: str, params: tuple | list = ()) -> list[dict]:
        return [dict(row) for row in self.execute(sql, params).fetchall()]

    def transaction(self):
        return _Transaction(self)

    # --- meta / cache invalidation ------------------------------------------
    def get_meta(self, key: str, default: str = "") -> str:
        row = self.one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else default

    def bump(self, key: str) -> None:
        self.execute(
            "INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
            (key,),
        )

    # --- accounts -----------------------------------------------------------
    def account(self, uid: str) -> dict | None:
        row = self.one("SELECT * FROM accounts WHERE uid = ?", (uid,))
        if row:
            row["settings"] = json.loads(row.get("settings") or "{}")
        return row


class _Transaction:
    def __init__(self, store: Store):
        self.store = store

    def __enter__(self):
        self.store._lock.acquire()
        self.store.conn.execute("BEGIN IMMEDIATE")
        return self.store

    def __exit__(self, exc_type, exc, tb):
        try:
            self.store.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.store._lock.release()
        return False
