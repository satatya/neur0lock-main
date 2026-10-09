"""NeuroLock AAA server (Authentication, Authorization, Accounting).

Only the REST API talks to this service, over HTTPS with mutual TLS. End users never reach it.
"""
import sys
import traceback

from flask import Flask, jsonify

from .accounting import Accounting
from .admin import AdminService
from .config import Config
from .directory import Directory, DirectoryError
from .errors import AAAError
from .service import AAAService
from .store import Store


def create_app(config: Config | None = None, run_bootstrap: bool = False) -> Flask:
    config = config or Config()
    config.validate()
    store = Store(config.DB_PATH)
    directory = Directory(config)
    accounting = Accounting(store, config)
    service = AAAService(config, directory, store, accounting)
    admin = AdminService(service)

    if run_bootstrap:
        from .bootstrap import bootstrap

        result = bootstrap(service)
        print(f"[bootstrap] {result}", flush=True)

    app = Flask(__name__)
    app.json.sort_keys = False
    app.extensions["aaa"] = {"service": service, "admin": admin, "config": config, "buckets": {}}

    from .routes import api

    app.register_blueprint(api, url_prefix="/v1")

    @app.errorhandler(AAAError)
    def handle_aaa_error(error: AAAError):
        return jsonify(error.to_json()), error.status

    @app.errorhandler(DirectoryError)
    def handle_directory_error(error: DirectoryError):
        print(f"[directory] {error}", file=sys.stderr, flush=True)
        return jsonify({"error": {"code": "DIRECTORY_UNAVAILABLE", "message": "The directory service is unavailable"}}), 503

    @app.errorhandler(404)
    def handle_404(_):
        return jsonify({"error": {"code": "NOT_FOUND", "message": "Route not found"}}), 404

    @app.errorhandler(Exception)
    def handle_unexpected(error: Exception):
        if hasattr(error, "code") and isinstance(getattr(error, "code"), int) and error.code < 500:
            return jsonify({"error": {"code": "BAD_REQUEST", "message": str(error)}}), error.code
        traceback.print_exc()
        return jsonify({"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}}), 500

    return app
