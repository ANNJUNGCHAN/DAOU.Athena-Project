"""Public authentication types used by the application boundary."""

import secrets

from fastapi import HTTPException, Request, status

from athena_api.kiwoom.auth import KiwoomAuth, TokenManager, parse_kiwoom_datetime

__all__ = [
    "KiwoomAuth",
    "TokenManager",
    "parse_kiwoom_datetime",
    "require_local_bearer",
]


def require_local_bearer(request: Request, authorization: str) -> None:
    """Validate the local bearer credential for hand-written guarded routes.

    Generated routes carry their own copy of this check. Hand-written routes use
    this one so they do not depend on a private symbol inside generated code.
    """
    scheme, _, credential = authorization.partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer authentication required"
        )
    expected = getattr(request.app.state, "local_bearer_token", None)
    if expected is None or not secrets.compare_digest(credential.strip(), str(expected)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer credential"
        )
