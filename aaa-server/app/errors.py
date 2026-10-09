class AAAError(Exception):
    """Error returned to the REST API as {"error": {code, message, details}} with an HTTP status."""

    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def to_json(self) -> dict:
        body = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        return {"error": body}


def bad_request(message: str, field: str | None = None) -> AAAError:
    return AAAError(400, "VALIDATION_ERROR", message, {"field": field} if field else None)


def not_found(what: str = "Resource") -> AAAError:
    return AAAError(404, "NOT_FOUND", f"{what} not found")


def forbidden(message: str = "Your role does not have permission to perform this action", details: dict | None = None) -> AAAError:
    return AAAError(403, "FORBIDDEN", message, details)


def conflict(message: str, code: str = "CONFLICT") -> AAAError:
    return AAAError(409, code, message)


def unauthorized(message: str = "Authentication required", code: str = "UNAUTHORIZED") -> AAAError:
    return AAAError(401, code, message)
