"""Local development runner (no Docker): HTTPS with mandatory client certificates, like production.

    python dev_server.py --certs ../infra/certs/dev [--port 8443]

Without LDAP_URL it uses the in-memory directory mock and a fresh SQLite file on every start, so
the demo accounts are re-created each time. Production runs gunicorn (see gunicorn.conf.py).
"""
import argparse
import os
import ssl
import tempfile

from cryptography.fernet import Fernet

from app import create_app
from app.config import Config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--certs", required=True, help="directory with ca.crt, aaa.crt and aaa.key")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()

    overrides = {}
    if not os.getenv("LDAP_URL"):
        db_path = os.path.join(tempfile.gettempdir(), "neurolock-aaa-dev.sqlite3")
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(db_path + suffix):
                os.remove(db_path + suffix)
        overrides = {"LDAP_URL": "mock://", "DB_PATH": db_path, "DEV_SHOW_RESET_CODES": True}
        print(f"[dev] in-memory directory, state file {db_path}")
    if not os.getenv("AAA_SECRET_KEY"):
        overrides["SECRET_KEY"] = Fernet.generate_key().decode()
    overrides.setdefault("SYSLOG_CA_FILE", os.path.join(args.certs, "ca.crt"))
    overrides.setdefault("SYSLOG_CERT_FILE", os.path.join(args.certs, "aaa.crt"))
    overrides.setdefault("SYSLOG_KEY_FILE", os.path.join(args.certs, "aaa.key"))
    overrides.setdefault("LDAP_CA_FILE", os.path.join(args.certs, "ca.crt"))

    app = create_app(Config(**overrides), run_bootstrap=True)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(os.path.join(args.certs, "aaa.crt"), os.path.join(args.certs, "aaa.key"))
    context.load_verify_locations(os.path.join(args.certs, "ca.crt"))
    context.verify_mode = ssl.CERT_REQUIRED  # mutual TLS: only the REST API's certificate is accepted
    print(f"[dev] AAA server on https://{args.host}:{args.port}/v1 (client certificate required)")
    app.run(host=args.host, port=args.port, ssl_context=context, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
