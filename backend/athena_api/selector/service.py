"""Transport-neutral orchestration for selector search, resolve, and execution."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from typing import Any

from fastapi import Request, Response
from pydantic import ValidationError

from athena_api.errors import KiwoomNotReadyError
from athena_api.generated.registry import SPLIT_BASE_TR_IDS
from athena_api.generated.runtime import call_order_tr, call_typed_tr, call_websocket_tr

from .catalog import OperationCatalog, OperationDocument, realtime_item_model
from .errors import (
    DetailGroupRequiredError,
    InvalidArgumentsError,
    OperationNotFoundError,
    PlanAlreadyUsedError,
    PreferredOperationError,
    UnsupportedOperationError,
)
from .plans import PlanSigner, VerifiedPlan
from .policy import select_operation
from .ranking import rank_documents, search_catalog
from .schemas import (
    CallRequest,
    CallResponse,
    ContinuationOutput,
    DescribeRequest,
    DetailGroupSummary,
    DiscoveryIntent,
    FieldContract,
    OperationDescription,
    ReasonCode,
    ResolveRequest,
    ResolveResponse,
    SearchRequest,
    SearchResponse,
)


def _field_contracts(model: type, *, required: bool | None = None) -> list[FieldContract]:
    schema = model.model_json_schema(by_alias=True)
    properties = schema.get("properties", {})
    contracts = []
    for name, field in model.model_fields.items():
        is_required = field.is_required()
        if required is not None and is_required is not required:
            continue
        alias = field.alias or name
        contracts.append(
            FieldContract(
                alias=alias,
                description=field.description,
                required=is_required,
                json_schema=properties.get(alias, {}),
            )
        )
    return contracts


def _detail_group_summaries(
    catalog: OperationCatalog, document: OperationDocument
) -> list[DetailGroupSummary]:
    """List the projections a caller may pass back as ``detail_group``.

    Only a base query operation offers a choice; a projection is already one.
    """
    if document.group_id is not None or document.kind != "query":
        return []
    return [
        DetailGroupSummary(
            group_id=str(detail.group_id),
            operation_ref=detail.operation_ref,
            title_ko=detail.group_title_ko,
            title_en=detail.group_title_en,
            layout=detail.layout,  # type: ignore[arg-type]
            ui_page_size=detail.ui_page_size,
            response_field_count=len(detail.response_model.model_fields),
        )
        for detail in catalog.details_for(document.tr_id)
    ]


def _intent_allows(document: OperationDocument, intent: DiscoveryIntent) -> bool:
    if document.kind == "query":
        return intent in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}
    if document.kind == "order":
        return intent is DiscoveryIntent.ORDER
    if document.kind == "websocket":
        return intent is DiscoveryIntent.WEBSOCKET
    return False


def _continuation_request(request: Request, *, cont_yn: str, next_key: str | None) -> Request:
    scope = dict(request.scope)
    headers = [
        (name, value)
        for name, value in scope.get("headers", [])
        if name.lower() not in {b"cont-yn", b"next-key"}
    ]
    headers.append((b"cont-yn", cont_yn.encode("ascii")))
    if next_key:
        headers.append((b"next-key", next_key.encode("utf-8")))
    scope["headers"] = headers
    return Request(scope, receive=request.receive)


logger = logging.getLogger(__name__)

# Bound on the process-local single-use nonce cache. The shared limiter caps upstream
# traffic at 5 calls/second and a plan's TTL is at most 600 seconds (CLAUDE.md SS7), so
# even every plan in flight for the full allowed lifetime is on the order of 3,000
# entries; this leaves generous headroom without letting an abusive client grow the
# cache without bound.
_NONCE_CACHE_LIMIT = 4096


class SelectorService:
    def __init__(self, catalog: OperationCatalog, signer: PlanSigner) -> None:
        self.catalog = catalog
        self.signer = signer
        # Nonces already spent by call(), mapped to the spending plan's own exp so a
        # swept entry is provably safe to drop: PlanSigner.verify() already refuses any
        # token past its exp before this cache is ever consulted, so a token that could
        # still replay is never pruned. Insertion order backs the FIFO size cap.
        self._consumed_nonces: OrderedDict[str, int] = OrderedDict()

    def search(self, request: SearchRequest) -> SearchResponse:
        return search_catalog(self.catalog, request)

    def describe(self, request: DescribeRequest) -> OperationDescription:
        document = self.catalog.find_exact(request.operation_ref)
        if document is None or not _intent_allows(document, request.intent):
            raise OperationNotFoundError("Operation was not found")
        if document.kind == "query":
            policy_reasons: list[ReasonCode] = []
            if document.group_id:
                execution_policy = "selector_detail"
            elif document.tr_id in SPLIT_BASE_TR_IDS:
                # Discoverable so the model can read detail_groups, then call one of them.
                execution_policy = "selector_detail_required"
                policy_reasons = [ReasonCode.DETAIL_GROUP_REQUIRED]
            else:
                execution_policy = "selector_query"
        elif document.kind == "order":
            execution_policy = "selector_guarded_order"
            policy_reasons = [ReasonCode.GUARDED_EXECUTION]
        else:
            execution_policy = "selector_websocket_control"
            policy_reasons = [ReasonCode.WEBSOCKET_CONTROL_ONLY]
        # The envelope model's four fields (return_code, return_msg, trnm, data) are the
        # same across all 23 realtime types and tell a caller nothing about the stream;
        # the FIDs inside data are the renderable contract, so describe substitutes the
        # per-event model when one exists and only falls back to the envelope if a
        # generator regression drops the data list, since that is not a caller error.
        response_model = document.response_model
        if document.kind == "websocket":
            response_model = realtime_item_model(document.response_model) or response_model
        return OperationDescription(
            catalog_version=self.catalog.version,
            operation_ref=document.operation_ref,
            kind=document.kind,  # type: ignore[arg-type]
            domain=document.domain,
            name=document.name,
            group_id=document.group_id,
            group_title_ko=document.group_title_ko,
            group_title_en=document.group_title_en,
            layout=document.layout,  # type: ignore[arg-type]
            ui_page_size=document.ui_page_size,
            required_arguments=_field_contracts(document.request_model, required=True),
            optional_arguments=_field_contracts(document.request_model, required=False),
            response_fields=_field_contracts(response_model),
            detail_groups=_detail_group_summaries(self.catalog, document),
            generic_callable=document.generic_callable,
            execution_policy=execution_policy,  # type: ignore[arg-type]
            policy_reasons=policy_reasons,
        )

    def _validated_arguments(
        self, document: OperationDocument, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            payload = document.request_model.model_validate(arguments)
        except ValidationError as exc:
            raise InvalidArgumentsError(
                "Arguments do not satisfy the selected operation",
                details={"errors": exc.errors(include_url=False, include_input=False)},
            ) from exc
        return payload.model_dump(by_alias=True, exclude_none=True)

    def resolve(self, request: ResolveRequest, *, account: str = "") -> ResolveResponse:
        explicit = self.catalog.find_exact(request.question.strip())
        if (
            explicit is not None
            and not explicit.generic_callable
            # A split family is uncallable but not undiscoverable: let it reach the policy,
            # which either honours an explicit detail_group or names the groups on offer.
            and explicit.tr_id not in SPLIT_BASE_TR_IDS
        ):
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        documents = self.catalog.visible_for(request.intent)
        if request.candidate_refs:
            requested: list[OperationDocument] = []
            for operation_ref in request.candidate_refs:
                document = self.catalog.find_exact(operation_ref)
                # search() already applies this gate, but a candidate_ref is caller-supplied
                # and resolve ranks it again on its own surface, so a query intent paired with
                # a handpicked order or websocket ref must be refused here too, not just there.
                if (
                    document is None
                    or not document.generic_callable
                    or not _intent_allows(document, request.intent)
                ):
                    raise OperationNotFoundError("Candidate operation was not found")
                requested.append(document)
            documents = tuple(requested)
        ranked = rank_documents(request.question, documents)
        detail_group = request.detail_group

        if request.preferred_ref:
            preferred = self.catalog.find_exact(request.preferred_ref)
            # A preference names a family, and a split family is a legitimate one to name
            # even though only its projections are callable.
            if (
                preferred is None
                or not (preferred.generic_callable or preferred.tr_id in SPLIT_BASE_TR_IDS)
                or not _intent_allows(preferred, request.intent)
            ):
                raise PreferredOperationError("Preferred operation is unavailable")
            # A preference is expressed at family granularity, because that is
            # the granularity the ranker works at. Naming a projection as the
            # preference also implies its detail_group.
            if preferred.group_id is not None and detail_group is None:
                detail_group = preferred.group_id
            families: list[str] = []
            best_by_family: dict[str, int] = {}
            for item in ranked:
                family = item.document.family_ref
                if family not in best_by_family:
                    families.append(family)
                    best_by_family[family] = item.score
            if preferred.family_ref not in families[:3]:
                raise PreferredOperationError(
                    "Preferred operation is not supported by the question"
                )
            if best_by_family[preferred.family_ref] < best_by_family[families[0]] * 0.8:
                raise PreferredOperationError(
                    "Preferred operation is not supported by the question"
                )
            ranked = tuple(
                item for item in ranked if item.document.tr_id == preferred.tr_id
            )

        try:
            document, reasons = select_operation(
                self.catalog,
                request.question,
                ranked,
                request.response_mode,
                detail_group,
            )
        except DetailGroupRequiredError as exc:
            # Every projection of a family shares the family's request model, so malformed
            # arguments are reported as such instead of hiding behind the group requirement.
            self._validated_arguments(
                self.catalog.by_ref[exc.details["operation_ref"]], request.arguments
            )
            raise

        if not document.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        arguments = self._validated_arguments(document, request.arguments)
        token, expires_at = self.signer.issue(
            catalog=self.catalog,
            document=document,
            arguments=arguments,
            question=request.question,
            cont_yn=request.continuation.cont_yn,
            next_key=request.continuation.next_key,
            account=account,
        )
        return ResolveResponse(
            catalog_version=self.catalog.version,
            operation_ref=document.operation_ref,
            plan_token=token,
            expires_at=expires_at,
            selection_reasons=reasons,
            required_arguments_satisfied=True,
            response_mode=request.response_mode,
        )

    def _consume_nonce(self, plan: VerifiedPlan) -> None:
        """Mark ``plan``'s nonce spent, or refuse a replay of an already-spent one.

        Must run after signature verification succeeds and before any upstream dispatch:
        marking here, not after a successful response, means a token that fails upstream
        (timeout, rate limit) is still burned. That trade is the accepted cost of closing
        the double-spend this enforces (2026-08-18) — see docs/LLM_API_SELECTION.md.

        No lock guards the check-then-mark: both run synchronously with no ``await``
        between them, and this process runs a single uvicorn worker on one event loop
        (CLAUDE.md SS7), so no other coroutine can observe the cache between the two.
        """
        now = self.signer.now()
        expired = [nonce for nonce, exp in self._consumed_nonces.items() if exp <= now]
        for nonce in expired:
            del self._consumed_nonces[nonce]
        if plan.nonce in self._consumed_nonces:
            raise PlanAlreadyUsedError(
                "Plan token was already used; call athena_resolve again for a new "
                "plan_token before calling athena_call"
            )
        if len(self._consumed_nonces) >= _NONCE_CACHE_LIMIT:
            self._consumed_nonces.popitem(last=False)
        self._consumed_nonces[plan.nonce] = int(plan.expires_at.timestamp())

    async def call(
        self,
        call: CallRequest,
        request: Request,
        response: Response,
        client: Any,
        *,
        account: str = "",
        order_client: Any = None,
        ws_client: Any = None,
        authorization: str | None = None,
        confirmation: str | None = None,
        idempotency_key: str | None = None,
    ) -> CallResponse:
        plan = self.signer.verify(call.plan_token, self.catalog, expected_account=account)
        self._consume_nonce(plan)
        document = self.catalog.find_exact(plan.operation_ref)
        if document is None or not document.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        try:
            payload = document.request_model.model_validate(plan.arguments)
        except ValidationError as exc:
            raise InvalidArgumentsError("Signed plan arguments are no longer valid") from exc
        continuation_request = _continuation_request(
            request, cont_yn=plan.cont_yn, next_key=plan.next_key
        )

        # Upstream round-trip only (not plan verification, not response model dumping
        # below) - this is the third leg of the W1 latency breakdown (plan/plan.md):
        # audit-interval - backend_ms (selector_tools.py) - upstream_ms (here) isolates
        # gateway/backend processing from time actually spent waiting on Kiwoom. No
        # payload or token in the log line - CLAUDE.md SS6 forbids upstream bodies/keys
        # leaking into logs.
        upstream_start = time.monotonic()
        if document.kind == "order":
            if order_client is None:
                raise KiwoomNotReadyError("Kiwoom order service is not ready")
            # The plan proves which operation was agreed on; it does not authorise placing
            # it. The order route's own guards still apply, unchanged, one layer down.
            result = await call_order_tr(
                document.tr_id,
                payload,
                continuation_request,
                response,
                order_client,
                authorization or "",
                confirmation or "",
                idempotency_key or "",
                account,
            )
        elif document.kind == "websocket":
            if ws_client is None:
                raise KiwoomNotReadyError("Kiwoom WebSocket service is not ready")
            # A control frame is a one-shot call that returns an ack. The events it turns
            # on are delivered out of band through /api/v1/ws/stream, never through here.
            result = await call_websocket_tr(document.tr_id, payload, ws_client)
        else:
            if client is None:
                raise KiwoomNotReadyError("Kiwoom data service is not ready")
            result = await call_typed_tr(
                document.tr_id,
                payload,
                continuation_request,
                response,
                client,
                response_model=document.response_model if document.group_id else None,
            )
        upstream_ms = int((time.monotonic() - upstream_start) * 1000)
        logger.info("athena_call upstream tr=%s upstream_ms=%d", document.tr_id, upstream_ms)

        cont_yn = response.headers.get("cont-yn", "N")
        next_key = response.headers.get("next-key")
        next_token = None
        # Only a read continues. Refreshing a plan for an order would hand back a token
        # that places the same order again.
        if document.kind == "query" and cont_yn == "Y" and next_key:
            next_token, _ = self.signer.refresh(
                plan,
                catalog=self.catalog,
                document=document,
                cont_yn="Y",
                next_key=next_key,
            )
        return CallResponse(
            operation_ref=document.operation_ref,
            data=result.model_dump(by_alias=True),
            continuation=ContinuationOutput(
                cont_yn=cont_yn,  # type: ignore[arg-type]
                next_key=next_key,
                next_plan_token=next_token,
            ),
        )
