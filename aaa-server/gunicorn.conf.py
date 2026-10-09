"""Gunicorn configuration: HTTPS on 443 with mandatory client certificates (mutual TLS).

Only holders of a certificate signed by the NeuroLock CA (the REST API) can call the AAA server.
"""
import os
import ssl
import time

bind = os.getenv("AAA_BIND", "0.0.0.0:443")
workers = int(os.getenv("AAA_WORKERS", "3"))
threads = 1
timeout = 30
accesslog = "-"
errorlog = "-"

certfile = os.getenv("AAA_TLS_CERT", "/certs/aaa.crt")
keyfile = os.getenv("AAA_TLS_KEY", "/certs/aaa.key")
ca_certs = os.getenv("AAA_TLS_CA", "/certs/ca.crt")
cert_reqs = ssl.CERT_REQUIRED


def on_starting(server):
    """Runs once in the master process before workers start: prepares the directory tree,
    roles, permissions and demo accounts. Waits for OpenLDAP to come up."""
    from app import create_app
    from app.directory import DirectoryError

    for attempt in range(1, 31):
        try:
            create_app(run_bootstrap=True)
            return
        except DirectoryError as error:
            server.log.warning(f"Directory not ready ({error}); retry {attempt}/30")
            time.sleep(2)
    raise SystemExit("Directory service unavailable - giving up")
