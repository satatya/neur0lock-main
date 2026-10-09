"""Accounting: every security-relevant event is stored and shipped to the log server.

Events are written to the AAA store (so administrators can search them in the app) and
forwarded to rsyslog as RFC 5424 messages over TLS with client-certificate authentication
(RFC 5425 octet-counted framing). rsyslog's file is the durable system of record.
"""
import json
import queue
import select
import socket
import ssl
import sys
import threading
import time

from .security import now_iso

SEVERITIES = ["info", "low", "medium", "high", "critical"]
SYSLOG_SEVERITY = {"critical": 2, "high": 3, "medium": 4, "low": 5, "info": 6}
FACILITY_AUTHPRIV = 10


class SyslogForwarder:
    def __init__(self, config):
        self.config = config
        self.enabled = bool(config.SYSLOG_HOST)
        self.queue: queue.Queue = queue.Queue(maxsize=5000)
        self.connected = False
        self.last_error: str | None = None
        self._sock = None
        if self.enabled:
            threading.Thread(target=self._worker, name="syslog-forwarder", daemon=True).start()

    def _connect(self):
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=self.config.SYSLOG_CA_FILE)
        context.load_cert_chain(self.config.SYSLOG_CERT_FILE, self.config.SYSLOG_KEY_FILE)
        raw = socket.create_connection((self.config.SYSLOG_HOST, self.config.SYSLOG_PORT), timeout=10)
        self._sock = context.wrap_socket(raw, server_hostname=self.config.SYSLOG_HOST)
        self.connected = True
        self.last_error = None

    def _peer_closed(self) -> bool:
        """True when the log server closed an idle connection (a write would be silently lost)."""
        try:
            readable, _, _ = select.select([self._sock], [], [], 0)
            if not readable:
                return False
            self._sock.setblocking(False)
            try:
                return self._sock.recv(1) == b""
            finally:
                self._sock.setblocking(True)
        except (ssl.SSLWantReadError, BlockingIOError):
            return False
        except OSError:
            return True

    def _worker(self):
        pending = None
        while True:
            try:
                if self._sock is None:
                    self._connect()  # connect eagerly so health reflects the log server state
            except Exception as exc:  # noqa: BLE001
                self.connected = False
                self.last_error = str(exc)
                print(f"[syslog] {exc}", file=sys.stderr)
                time.sleep(3)
                continue
            line = pending or self.queue.get()
            pending = None
            try:
                if self._peer_closed():
                    self._sock.close()
                    self._sock = None
                    self._connect()
                data = line.encode("utf-8")
                self._sock.sendall(f"{len(data)} ".encode("ascii") + data)
            except Exception as exc:  # noqa: BLE001 - keep retrying; the store still has the event
                self.connected = False
                self.last_error = str(exc)
                print(f"[syslog] {exc}", file=sys.stderr)
                try:
                    if self._sock:
                        self._sock.close()
                finally:
                    self._sock = None
                pending = line
                time.sleep(3)

    def send(self, severity: str, msg_id: str, message: dict) -> None:
        if not self.enabled:
            return
        pri = FACILITY_AUTHPRIV * 8 + SYSLOG_SEVERITY.get(severity, 6)
        line = f"<{pri}>1 {now_iso()} aaa neurolock-aaa - {msg_id[:32]} - {json.dumps(message, separators=(',', ':'))}"
        try:
            self.queue.put_nowait(line)
        except queue.Full:
            print("[syslog] queue full, dropping forward (event kept in store)", file=sys.stderr)


class Accounting:
    def __init__(self, store, config):
        self.store = store
        self.forwarder = SyslogForwarder(config)

    def record(self, event: dict) -> int:
        """event keys: action, resource, resource_id, patient_id, patient_name, outcome, severity,
        actor, actor_uid, actor_name, actor_role, ip, user_agent, details"""
        entry = {
            "ts": now_iso(),
            "actor": event.get("actor"),
            "actor_uid": event.get("actor_uid"),
            "actor_name": event.get("actor_name"),
            "actor_role": event.get("actor_role"),
            "action": str(event.get("action") or "unknown")[:60],
            "resource": str(event.get("resource") or "unknown")[:40],
            "resource_id": None if event.get("resource_id") is None else str(event.get("resource_id"))[:64],
            "patient_id": event.get("patient_id"),
            "patient_name": event.get("patient_name"),
            "outcome": event.get("outcome") if event.get("outcome") in ("success", "denied", "failure") else "success",
            "severity": event.get("severity") if event.get("severity") in SEVERITIES else "info",
            "ip": event.get("ip"),
            "user_agent": (event.get("user_agent") or "")[:255] or None,
            "details": json.dumps(event["details"]) if event.get("details") else None,
        }
        cursor = self.store.execute(
            f"INSERT INTO audit_log ({', '.join(entry)}) VALUES ({', '.join('?' for _ in entry)})",
            list(entry.values()),
        )
        message = {k: v for k, v in entry.items() if v is not None and k != "details"}
        if event.get("details"):
            message["details"] = event["details"]
        self.forwarder.send(entry["severity"], entry["action"], message)
        return cursor.lastrowid
