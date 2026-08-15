"""Transport-neutral orchestration for selector search, resolve, and execution."""

from __future__ import annotations

from typing import Any

from fastapi import Request, Response
from pydantic import ValidationError

from athena_api.generated.runtime import call_typed_tr

from .catalog import OperationCatalog, OperationDocument
from .errors import (
    InvalidArgumentsError,
    OperationNotFoundError,
    PreferredOperationError,
    UnsupportedOperationError,
)
from .plans import PlanSigner
from .policy import select_operation
from .ranking import rank_documents, search_catalog
from .schemas import (
    CallRequest,
    CallResponse,
    ContinuationOutput,
    DescribeRequest,
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


class SelectorService:
    def __init__(self, catalog: OperationCatalog, signer: PlanSigner) -> None:
        self.catalog = catalog
        self.signer = signer

    def search(self, request: SearchRequest) -> SearchResponse:
        return search_catalog(self.catalog, request)

    def describe(self, request: DescribeRequest) -> OperationDescription:
        document = self.catalog.find_exact(request.operation_ref)
        if document is None or not _intent_allows(document, request.intent):
            raise OperationNotFoundError("Operation was not found")
        if document.kind == "query":
            execution_policy = (
                "selector_detail" if document.group_id else "selector_query"
            )
            policy_reasons: list[ReasonCode] = []
        elif document.kind == "order":
            execution_policy = "direct_guarded_order_only"
            policy_reasons = [ReasonCode.DISCOVERY_ONLY]
        else:
            execution_policy = "direct_websocket_control_only"
            policy_reasons = [ReasonCode.DISCOVERY_ONLY]
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
            response_fields=_field_contracts(document.response_model),
            generic_callable=document.generic_callable,
            execution_policy=execution_policy,  # type: ignore[arg-type]
            policy_reasons=policy_reasons,
        )

    def resolve(self, request: ResolveRequest) -> ResolveResponse:
        explicit = self.catalog.find_exact(request.question.strip())
        if explicit is not None and not explicit.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        documents = self.catalog.visible_for(DiscoveryIntent.QUERY)
        if request.candidate_refs:
            requested: list[OperationDocument] = []
            for operation_ref in request.candidate_refs:
                document = self.catalog.find_exact(operation_ref)
                if document is None or not document.generic_callable:
                    raise OperationNotFoundError("Candidate operation was not found")
                requested.append(document)
            documents = tuple(requested)
        ranked = rank_documents(request.question, documents)

        if request.preferred_ref:
            preferred = self.catalog.find_exact(request.preferred_ref)
            if preferred is None or not preferred.generic_callable:
                raise PreferredOperationError("Preferred operation is unavailable")
            ranked_refs = [item.document.operation_ref for item in ranked]
            if request.preferred_ref not in ranked_refs[:3]:
                raise PreferredOperationError(
                    "Preferred operation is not supported by the question"
                )
            top_score = ranked[0].score
            preferred_score = next(
                item.score
                for item in ranked
                if item.document.operation_ref == request.preferred_ref
            )
            if preferred_score < top_score * 0.8:
                raise PreferredOperationError(
                    "Preferred operation is not supported by the question"
                )
            ranked = tuple(
                item for item in ranked if item.document.tr_id == preferred.tr_id
            )

        document, reasons = select_operation(
            self.catalog, request.question, ranked, request.response_mode
        )

        if not document.generic_callable or document.kind != "query":
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        try:
            payload = document.request_model.model_validate(request.arguments)
        except ValidationError as exc:
            raise InvalidArgumentsError(
                "Arguments do not satisfy the selected operation",
                details={"errors": exc.errors(include_url=False, include_input=False)},
            ) from exc
        arguments = payload.model_dump(by_alias=True, exclude_none=True)
        token, expires_at = self.signer.issue(
            catalog=self.catalog,
            document=document,
            arguments=arguments,
            question=request.question,
            cont_yn=request.continuation.cont_yn,
            next_key=request.continuation.next_key,
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

    async def call(
        self,
        call: CallRequest,
        request: Request,
        response: Response,
        client: Any,
    ) -> CallResponse:
        plan = self.signer.verify(call.plan_token, self.catalog)
        document = self.catalog.find_exact(plan.operation_ref)
        if document is None or not document.generic_callable or document.kind != "query":
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        try:
            payload = document.request_model.model_validate(plan.arguments)
        except ValidationError as exc:
            raise InvalidArgumentsError("Signed plan arguments are no longer valid") from exc
        continuation_request = _continuation_request(
            request, cont_yn=plan.cont_yn, next_key=plan.next_key
        )
        result = await call_typed_tr(
            document.tr_id,
            payload,
            continuation_request,
            response,
            client,
            response_model=document.response_model if document.group_id else None,
        )
        cont_yn = response.headers.get("cont-yn", "N")
        next_key = response.headers.get("next-key")
        next_token = None
        if cont_yn == "Y" and next_key:
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
