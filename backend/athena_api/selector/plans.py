"""Short-lived HMAC execution plans; tokens never contain URLs or paths."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .catalog import OperationCatalog, OperationDocument
from .errors import ExpiredPlanError, InvalidPlanError, StalePlanError


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, TypeError) as exc:
        raise InvalidPlanError("Plan token encoding is invalid") from exc


def _canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise InvalidPlanError("Plan payload is not canonical JSON") from exc


def question_hash(question: str) -> str:
    return hashlib.sha256(question.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class VerifiedPlan:
    operation_ref: str
    arguments: dict[str, Any]
    cont_yn: str
    next_key: str | None
    question_hash: str
    expires_at: datetime
    account: str
    # Exposed so a caller (SelectorService) can enforce single-use without re-parsing
    # the token; PlanSigner itself stays stateless and never tracks which nonces were
    # already spent.
    nonce: str


class PlanSigner:
    def __init__(
        self,
        secret: bytes,
        *,
        ttl_seconds: int = 120,
        clock: Callable[[], float] = time.time,
        nonce_factory: Callable[[], str] = lambda: secrets.token_hex(16),
    ) -> None:
        if not secret:
            raise ValueError("Plan signing secret must not be empty")
        if not 1 <= ttl_seconds <= 600:
            raise ValueError("Plan TTL must be between 1 and 600 seconds")
        self._secret = secret
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._nonce_factory = nonce_factory

    def now(self) -> int:
        """This signer's own clock, truncated to the second it signs and verifies against.

        Exposed so a caller that tracks single-use nonces (SelectorService) can prune its
        cache against the same time reference PlanSigner uses for expiry, instead of a
        wall clock that would disagree with an injected test clock.
        """
        return int(self._clock())

    def issue(
        self,
        *,
        catalog: OperationCatalog,
        document: OperationDocument,
        arguments: dict[str, Any],
        question: str | None = None,
        question_digest: str | None = None,
        cont_yn: str = "N",
        next_key: str | None = None,
        account: str = "",
    ) -> tuple[str, datetime]:
        now = int(self._clock())
        digest = question_digest or question_hash(question or "")
        payload = {
            "v": 1,
            "iat": now,
            "exp": now + self.ttl_seconds,
            "nonce": self._nonce_factory(),
            "catalog_version": catalog.version,
            "operation_ref": document.operation_ref,
            "arguments": arguments,
            "cont_yn": cont_yn,
            "next_key": next_key,
            "request_schema_hash": document.request_schema_hash,
            "response_schema_hash": document.response_schema_hash,
            "question_hash": digest,
            # Kiwoom's wire protocol carries no account field, so nothing downstream would
            # notice a plan resolved for one account being replayed against another.
            "account": account,
        }
        encoded_payload = _b64encode(_canonical_json(payload))
        signing_input = f"v1.{encoded_payload}".encode("ascii")
        signature = _b64encode(hmac.digest(self._secret, signing_input, "sha256"))
        return (
            f"v1.{encoded_payload}.{signature}",
            datetime.fromtimestamp(payload["exp"], tz=UTC),
        )

    def verify(
        self, token: str, catalog: OperationCatalog, *, expected_account: str = ""
    ) -> VerifiedPlan:
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != "v1":
            raise InvalidPlanError("Plan token format is invalid")
        signing_input = f"v1.{parts[1]}".encode("ascii")
        expected = hmac.digest(self._secret, signing_input, "sha256")
        supplied = _b64decode(parts[2])
        if not hmac.compare_digest(expected, supplied):
            raise InvalidPlanError("Plan token signature is invalid")
        try:
            payload = json.loads(_b64decode(parts[1]))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise InvalidPlanError("Plan payload is invalid") from exc
        required_keys = {
            "v",
            "iat",
            "exp",
            "nonce",
            "catalog_version",
            "operation_ref",
            "arguments",
            "cont_yn",
            "next_key",
            "request_schema_hash",
            "response_schema_hash",
            "question_hash",
            "account",
        }
        if not isinstance(payload, dict) or set(payload) != required_keys or payload.get("v") != 1:
            raise InvalidPlanError("Plan payload contract is invalid")
        if not isinstance(payload["account"], str) or payload["account"] != expected_account:
            raise InvalidPlanError("Plan was issued for a different account")
        if not isinstance(payload["exp"], int) or payload["exp"] <= int(self._clock()):
            raise ExpiredPlanError("Plan token has expired")
        if payload["catalog_version"] != catalog.version:
            raise StalePlanError("Plan catalog version is stale")
        operation_ref = payload["operation_ref"]
        document = catalog.find_exact(operation_ref) if isinstance(operation_ref, str) else None
        if document is None:
            raise StalePlanError("Plan operation no longer exists")
        if (
            payload["request_schema_hash"] != document.request_schema_hash
            or payload["response_schema_hash"] != document.response_schema_hash
        ):
            raise StalePlanError("Plan schema is stale")
        if not document.generic_callable:
            raise InvalidPlanError("Plan operation is not generic-callable")
        arguments = payload["arguments"]
        if not isinstance(arguments, dict):
            raise InvalidPlanError("Plan arguments are invalid")
        if payload["cont_yn"] not in {"N", "Y"}:
            raise InvalidPlanError("Plan continuation flag is invalid")
        if not isinstance(payload["question_hash"], str) or len(payload["question_hash"]) != 64:
            raise InvalidPlanError("Plan question hash is invalid")
        if not isinstance(payload["nonce"], str) or not payload["nonce"]:
            raise InvalidPlanError("Plan nonce is invalid")
        return VerifiedPlan(
            operation_ref=operation_ref,
            arguments=arguments,
            cont_yn=payload["cont_yn"],
            next_key=payload["next_key"],
            question_hash=payload["question_hash"],
            expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
            account=payload["account"],
            nonce=payload["nonce"],
        )

    def refresh(
        self,
        plan: VerifiedPlan,
        *,
        catalog: OperationCatalog,
        document: OperationDocument,
        cont_yn: str,
        next_key: str | None,
    ) -> tuple[str, datetime]:
        return self.issue(
            catalog=catalog,
            document=document,
            arguments=plan.arguments,
            question_digest=plan.question_hash,
            cont_yn=cont_yn,
            next_key=next_key,
            # A continuation stays on the account that opened it; never re-target it.
            account=plan.account,
        )
