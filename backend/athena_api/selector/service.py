"""Transport-neutral orchestration for selector search, resolve, and execution."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from fastapi import Request, Response
from pydantic import BaseModel, ValidationError

from athena_api.errors import KiwoomNotReadyError
from athena_api.generated.registry import SPLIT_BASE_TR_IDS
from athena_api.generated.runtime import call_order_tr, call_typed_tr, call_websocket_tr
from athena_api.routing_contract import BindingRole

from .catalog import OperationCatalog, OperationDocument, realtime_item_model
from .compatibility import (
    CompatibilityConfidence,
    CompatibilityDecision,
    CompatibilityDecisionStatus,
    decide_selector_compatibility,
)
from .errors import (
    AmbiguousOperationError,
    DetailGroupRequiredError,
    InvalidArgumentsError,
    NoConfidentMatchError,
    OperationNotFoundError,
    OrderTicketRequiredError,
    PlanAlreadyUsedError,
    PreferredOperationError,
    QueryPlanRequiredError,
    ReplayStateCapacityError,
    UnknownDetailGroupError,
    UnsupportedOperationError,
)
from .instrument_identity import InstrumentIdentityIndex, TargetResolution
from .plans import PlanSigner, VerifiedPlan
from .primitive_evidence import TargetResolver
from .ranking import search_catalog
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
    SearchHit,
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

_NONCE_CACHE_LIMIT = 4096


def _public_reason_codes(decision: CompatibilityDecision) -> list[ReasonCode]:
    """Fail closed if the typed seam emits a reason absent from the public schema."""
    return [ReasonCode(code) for code in decision.reason_codes]


class SelectorService:
    def __init__(
        self,
        catalog: OperationCatalog,
        signer: PlanSigner,
        *,
        instrument_identity: InstrumentIdentityIndex | None = None,
        target_resolver: TargetResolver | None = None,
    ) -> None:
        self.catalog = catalog
        self.signer = signer
        self._instrument_identity = instrument_identity
        self._target_resolver = target_resolver
        # Nonces already spent by call(), mapped to the spending plan's own exp so a
        # swept entry is provably safe to drop: PlanSigner.verify() already refuses any
        # token past its exp before this cache is ever consulted, so a token that could
        # still replay is never pruned. Insertion order backs the FIFO size cap.
        self._consumed_nonces: OrderedDict[str, int] = OrderedDict()

    def search(self, request: SearchRequest) -> SearchResponse:
        response = search_catalog(self.catalog, request)
        target_resolution, _ = self._resolved_identity(request.query)
        decision = self._compatibility_decision(
            request.query,
            request.intent,
            target_resolution=target_resolution,
        )
        suggested_intent = self._typed_suggested_intent(
            request.query,
            request.intent,
            decision,
            target_resolution=target_resolution,
        )
        response = response.model_copy(update={"suggested_intent": suggested_intent})
        response = self._inject_selected_family(response, decision, request.limit)
        response = self._search_confidence(
            response,
            decision=decision,
            suggested_intent=suggested_intent is not None,
        )
        if (
            decision.status is not CompatibilityDecisionStatus.SELECTED
            or decision.selected_operation_ref is None
            or response.suggested_intent is not None
        ):
            return response
        document = self.catalog.by_ref[decision.selected_operation_ref]
        if document.group_id is None or not response.results:
            return response
        results = list(response.results)
        for index, hit in enumerate(results):
            candidate = self.catalog.find_exact(hit.operation_ref)
            if candidate is not None and candidate.family_ref == document.family_ref:
                results[index] = hit.model_copy(
                    update={
                        "suggested_detail_group": document.group_id,
                        "suggested_operation_ref": document.operation_ref,
                    }
                )
                break
        return response.model_copy(update={"results": results})

    def _search_confidence(
        self,
        response: SearchResponse,
        *,
        decision: CompatibilityDecision,
        suggested_intent: bool,
    ) -> SearchResponse:
        """Project shared typed confidence onto lexical diagnostic hits."""
        results = []
        for hit in response.results:
            candidate = self.catalog.find_exact(hit.operation_ref)
            selected = (
                not suggested_intent
                and decision.status is CompatibilityDecisionStatus.SELECTED
                and candidate is not None
                and candidate.family_ref == decision.selected_family_ref
            )
            label = decision.confidence.value if selected else "low"
            results.append(hit.model_copy(update={"confidence": label}))
        return response.model_copy(update={"results": results})

    def _exact_identity(
        self, question: str, intent: DiscoveryIntent
    ) -> tuple[OperationDocument | None, ReasonCode | None]:
        identity = question.strip()
        document = self.catalog.find_exact(identity)
        if document is not None:
            return document, ReasonCode.EXACT_OPERATION_REF
        document = self.catalog.find_exact(f"base:{identity}")
        if document is not None:
            return document, ReasonCode.EXACT_TR_ID
        group_matches = [
            candidate
            for candidate in self.catalog.by_ref.values()
            if candidate.group_id == identity
        ]
        if len(group_matches) == 1:
            document = group_matches[0]
            if (
                document.visibility != "hidden"
                and document.generic_callable
                and _intent_allows(document, intent)
            ):
                return document, ReasonCode.EXACT_GROUP_ID
        return None, None

    def _compatibility_decision(
        self,
        question: str,
        intent: DiscoveryIntent,
        *,
        bound_argument_roles: tuple[BindingRole, ...] = (),
        target_resolution: TargetResolution | None = None,
    ) -> CompatibilityDecision:
        explicit, identity_reason = self._exact_identity(question, intent)
        if explicit is not None and _intent_allows(explicit, intent):
            assert identity_reason is not None
            return CompatibilityDecision(
                status=CompatibilityDecisionStatus.SELECTED,
                selected_family_ref=explicit.family_ref,
                selected_operation_ref=explicit.operation_ref,
                compatible_operation_refs=(explicit.operation_ref,),
                proofs=(),
                dominance_edges=(),
                equivalence_collapses=(),
                confidence=CompatibilityConfidence.HIGH,
                reason_codes=(identity_reason.value,),
            )
        return decide_selector_compatibility(
            self.catalog,
            question,
            intent,
            bound_argument_roles=bound_argument_roles,
            target_resolution=target_resolution,
            target_resolver=self._target_resolver,
        )

    def _resolved_identity(
        self, question: str
    ) -> tuple[TargetResolution | None, str | None]:
        """Resolve once, retaining the code only inside this service instance."""
        if self._instrument_identity is None:
            return None, None
        resolved = self._instrument_identity.resolve(question)
        if resolved is None:
            return None, None
        return resolved.target, resolved.code

    def _typed_suggested_intent(
        self,
        question: str,
        requested_intent: DiscoveryIntent,
        decision: CompatibilityDecision,
        *,
        target_resolution: TargetResolution | None = None,
    ) -> DiscoveryIntent | None:
        if decision.status in {
            CompatibilityDecisionStatus.SELECTED,
            CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED,
        }:
            return None
        requested_surface = (
            DiscoveryIntent.QUERY
            if requested_intent is DiscoveryIntent.AUTO
            else requested_intent
        )
        alternatives = []
        for intent in (
            DiscoveryIntent.QUERY,
            DiscoveryIntent.ORDER,
            DiscoveryIntent.WEBSOCKET,
        ):
            if intent is requested_surface:
                continue
            alternative = self._compatibility_decision(
                question,
                intent,
                target_resolution=target_resolution,
            )
            if alternative.status in {
                CompatibilityDecisionStatus.SELECTED,
                CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED,
            }:
                alternatives.append(intent)
        return alternatives[0] if len(alternatives) == 1 else None

    def _inject_selected_family(
        self,
        response: SearchResponse,
        decision: CompatibilityDecision,
        limit: int,
    ) -> SearchResponse:
        family_ref = decision.selected_family_ref
        if family_ref is None:
            return response

        selected_hits: list[SearchHit] = []
        remaining_hits: list[SearchHit] = []
        for hit in response.results:
            document = self.catalog.find_exact(hit.operation_ref)
            if document is not None and document.family_ref == family_ref:
                selected_hits.append(hit)
            else:
                remaining_hits.append(hit)

        if selected_hits:
            selected_hit = selected_hits[0]
        else:
            selected_ref = decision.selected_operation_ref
            document = (
                self.catalog.by_ref[selected_ref]
                if selected_ref is not None
                else next(
                    item
                    for item in self.catalog.documents
                    if item.family_ref == family_ref
                )
            )
            selected_hit = SearchHit(
                operation_ref=document.operation_ref,
                kind=document.kind,  # type: ignore[arg-type]
                domain=document.domain,
                name=document.name,
                group_title=document.group_title_ko or document.group_title_en,
                score=0,
                confidence="low",
                contributions=[],
                generic_callable=document.generic_callable,
                discovery_only=document.visibility == "explicit",
            )
        return response.model_copy(
            update={"results": [selected_hit, *remaining_hits][:limit]}
        )

    def _detail_required(self, family_ref: str) -> DetailGroupRequiredError:
        tr_id = family_ref.removeprefix("base:")
        return DetailGroupRequiredError(
            "Operation family is served through its detail projections",
            details={
                "operation_ref": family_ref,
                "available_groups": [
                    detail.group_id for detail in self.catalog.details_for(tr_id)
                ],
                "reason_codes": [ReasonCode.DETAIL_GROUP_REQUIRED.value],
            },
        )

    def _asserted_detail(
        self,
        family_ref: str,
        detail_group: str,
    ) -> OperationDocument:
        tr_id = family_ref.removeprefix("base:")
        detail = self.catalog.find_exact(f"detail:{tr_id}:{detail_group}")
        if detail is None:
            raise UnknownDetailGroupError(
                "Detail group does not belong to the selected operation family",
                details={
                    "operation_ref": family_ref,
                    "detail_group": detail_group,
                    "available_groups": [
                        item.group_id for item in self.catalog.details_for(tr_id)
                    ],
                },
            )
        return detail

    def _guarded_preferred_fallback(
        self,
        preferred: OperationDocument | None,
        detail_group: str | None,
        *,
        trusted_code: str | None,
    ) -> OperationDocument | None:
        """typed compatibility가 question을 REJECTED로 거부해도, 호출자가 이미
        제시한 구조화 단언(preferred_ref [+ detail_group])이 카탈로그 소유권만으로
        완전히 검증되고, question 자체에도 독립적으로 인식된 실제 대상(종목 등)
        근거가 있으면 그 단언을 그대로 쓴다. `None`을 돌려주면 호출부가 기존
        NoConfidentMatchError를 그대로 낸다 — 이 메서드는 절대 예외를 내지 않는다
        (구제 실패는 "구제 안 함"이지 "다른 에러"가 아니다).

        `trusted_code`는 `_resolved_identity(question)`의 결과다 — 즉 question
        원문에서(전달된 arguments가 아니라) 독립적으로 인식된 종목 코드다. 이
        조건이 없으면 절대 구제하지 않는다: 그래야
        - 문장에 오퍼레이션 id/TR id가 토큰으로 끼어 있을 뿐 실제 대상 근거가
          없는 경우(예: "ka10001 가치평가 지표만 알려줘")와
        - 대상 근거가 아예 없는 일반 문구에 preferred_ref/인자만 얹은 경우
          (예: "D+1 D+2 정산 전망" + stk_cd)
        둘 다 이 구제를 못 받는다 — 회귀 테스트
        `test_embedded_operation_ids_never_gain_exact_control_plane_authority`,
        `test_preferred_detail_cannot_cure_missing_target_evidence`가 지키는
        경계 그대로다(이 게이트를 추가하기 전 첫 시도는 이 두 경계를 깼다 —
        2026-08-26 실측, `arguments.stk_cd`만으로는 절대 충분하지 않다).

        완전성 요구 — 부분 힌트는 구제하지 않는다:
        - `preferred`가 없으면(호출자가 preferred_ref를 안 줬으면) 즉시 포기한다.
          candidate_refs는 이 메서드에 아예 안 들어온다 — soft hint는 구조화
          assertion이 아니므로 완화 대상이 될 수 없다(모듈 docstring 원칙).
        - `preferred.kind`가 query가 아니면 포기한다 — order/websocket은
          typed 거부를 그대로 존중한다(주문 오발동 방지 최우선).
        - `preferred`의 오퍼레이션이 종목코드를 바인딩하지 않으면(시장 전체
          지표 등) `trusted_code` 자체가 무관한 근거이므로 포기한다.
        - `preferred`가 detail 프로젝션 자체면(`group_id is not None`) 그대로
          쓰되, `detail_group`이 같이 왔다면 반드시 일치해야 한다(불일치는 포기).
        - `preferred`가 detail 없이 바로 호출 가능한 base면(`generic_callable`)
          `detail_group`이 없어야만 그대로 쓴다 — 있는데 안 맞으면 포기.
        Split base aliases are absent from the catalog; callers must assert an actual
        detail operation ref instead.
        """
        if preferred is None or preferred.kind != "query":
            return None
        if trusted_code is None:
            return None
        if BindingRole.INSTRUMENT_CODE not in preferred.routing.bindings:
            return None
        if preferred.group_id is not None:
            if detail_group is not None and detail_group != preferred.group_id:
                return None
            return preferred
        if detail_group is not None:
            return None
        return preferred

    def describe(self, request: DescribeRequest) -> OperationDescription:
        document = self.catalog.find_exact(request.operation_ref)
        if document is None or not _intent_allows(document, request.intent):
            raise OperationNotFoundError("Operation was not found")
        if document.kind == "query":
            policy_reasons: list[ReasonCode] = []
            if document.group_id:
                execution_policy = "selector_detail"
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

    def _bind_trusted_instrument(
        self,
        document: OperationDocument,
        arguments: dict[str, Any],
        *,
        trusted_code: str | None,
        intent: DiscoveryIntent,
    ) -> dict[str, Any]:
        """Validate a trusted code, injecting it only for natural-language queries."""
        copied = dict(arguments)
        if (
            trusted_code is None
            or BindingRole.INSTRUMENT_CODE not in document.routing.bindings
            or document.kind == "websocket"
        ):
            return copied
        aliases = [
            field.alias or name
            for name, field in document.request_model.model_fields.items()
            if (field.alias or name) == "stk_cd"
        ]
        if aliases != ["stk_cd"]:
            raise InvalidArgumentsError(
                "Selected operation has no supported single-instrument binding contract"
            )
        caller_code = copied.get("stk_cd")
        if caller_code not in {None, ""} and str(caller_code) != trusted_code:
            raise InvalidArgumentsError(
                "Caller instrument code does not match the resolved question target"
            )
        if (
            caller_code in {None, ""}
            and intent in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}
            and document.kind == "query"
        ):
            copied["stk_cd"] = trusted_code
        return copied

    def resolve(self, request: ResolveRequest, *, account: str = "") -> ResolveResponse:
        target_resolution, trusted_code = self._resolved_identity(request.question)
        explicit, identity_reason = self._exact_identity(
            request.question, request.intent
        )
        removed_identity = request.question.strip().removeprefix("base:")
        if explicit is None and removed_identity in SPLIT_BASE_TR_IDS:
            raise OperationNotFoundError("Operation was not found")
        if explicit is not None and not _intent_allows(explicit, request.intent):
            # Exact operation identities are authoritative only inside the requested
            # visibility surface. Otherwise a caller could bypass the same intent gate
            # enforced for ranked, candidate, and preferred operations merely by putting
            # a WebSocket/order/TR identity in ``question``.
            raise OperationNotFoundError("Operation was not found")
        if explicit is not None and not explicit.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        for operation_ref in request.candidate_refs:
            candidate = self.catalog.find_exact(operation_ref)
            if (
                candidate is None
                or not _intent_allows(candidate, request.intent)
                or not candidate.generic_callable
            ):
                raise OperationNotFoundError("Candidate operation was not found")
        detail_group = request.detail_group
        preferred: OperationDocument | None = None
        if request.preferred_ref:
            preferred = self.catalog.find_exact(request.preferred_ref)
            if (
                preferred is None
                or not preferred.generic_callable
                or not _intent_allows(preferred, request.intent)
            ):
                raise PreferredOperationError("Preferred operation is unavailable")

        if explicit is not None:
            assert identity_reason is not None
            if preferred is not None and preferred.family_ref != explicit.family_ref:
                raise PreferredOperationError(
                    "Preferred operation does not match canonical family selection"
                )
            if (
                explicit.group_id is not None
                and preferred is not None
                and preferred.group_id is not None
                and preferred.group_id != explicit.group_id
            ):
                raise PreferredOperationError(
                    "Preferred detail conflicts with the exact detail operation"
                )
            if preferred is not None and preferred.group_id is not None:
                if detail_group is not None and detail_group != preferred.group_id:
                    raise PreferredOperationError(
                        "Preferred detail conflicts with detail_group"
                    )
                detail_group = preferred.group_id
            if explicit.group_id is not None:
                if detail_group is not None and detail_group != explicit.group_id:
                    raise UnknownDetailGroupError(
                        "Detail group conflicts with the exact detail operation",
                        details={
                            "operation_ref": explicit.operation_ref,
                            "detail_group": detail_group,
                            "available_groups": [
                                item.group_id
                                for item in self.catalog.details_for(explicit.tr_id)
                            ],
                        },
                    )
                document = explicit
                reasons = [identity_reason]
            elif detail_group is not None:
                raise UnknownDetailGroupError(
                    "Detail group can only accompany its exact detail operation"
                )
            else:
                document = explicit
                reasons = [identity_reason]
        else:
            decision = self._compatibility_decision(
                request.question,
                request.intent,
                target_resolution=target_resolution,
            )
            if decision.status is CompatibilityDecisionStatus.REJECTED:
                # W2c 완화 게이트(2026-08-26, 카드 랜딩 진단): 자유문장 question이
                # typed compatibility에서 거부돼도, 호출자가 구조화된 단언
                # (preferred_ref [+ detail_group])을 이미 제시했고 그 단언이
                # describe와 독립적으로 검증되며, question 원문에서도 독립적으로
                # 인식된 실제 대상(종목) 근거가 있으면 구제한다. candidate_refs
                # 단독으로는 절대 구제하지 않는다 — soft hint일 뿐 assertion이
                # 아니다(preferred_ref만 assertion). query kind에만 적용 —
                # order/websocket은 typed 거부를 그대로 둔다(주문 오발동 방지가
                # 최우선, 완화 대상이 아니다). `trusted_code` 요구는
                # `_guarded_preferred_fallback` docstring 참고 — 이게 없으면
                # 임베디드 id/무대상 문구 회귀 테스트를 깬다(첫 시도 실측).
                fallback_document = self._guarded_preferred_fallback(
                    preferred, detail_group, trusted_code=trusted_code
                )
                if fallback_document is None:
                    public_reasons = _public_reason_codes(decision)
                    raise NoConfidentMatchError(
                        "No operation has complete typed compatibility with the question",
                        details={
                            "reason_codes": [reason.value for reason in public_reasons]
                        },
                    )
                document = fallback_document
                reasons = [ReasonCode.PREFERRED_STRUCTURED_ASSERTION]
            elif decision.status is CompatibilityDecisionStatus.AMBIGUOUS:
                # P3 완화 게이트(2026-08-27, 호가 카드 진단): "호가"류 질문은 측정
                # 축(measure:orderbook) 하나로만 여러 무관한 스크리너/TR과 함께
                # 묶여 family 단위 AMBIGUOUS로 떨어진다 — 그 축을 dominance 비교에
                # 넣는 시도는 계좌·금·업종 등 다른 도메인에서 12건 회귀를 냈다
                # (2026-08-27 실측, active_surplus는 건드리지 않는다). 대신 REJECTED가
                # 이미 쓰는 preferred_ref 단언 통로(`_guarded_preferred_fallback`과
                # 동일한 안전 조건: query kind, trusted_code로 독립 검증된 대상 근거,
                # INSTRUMENT_CODE 바인딩)를 그대로 재사용하되, 여기서는 그 단언이
                # 이미 typed로 compatible한 후보 중 한 family에 속할 때만 구제한다
                # — 무관한 family를 게이트 밖에서 강제로 통과시키지 않는다(다른
                # 도메인의 안전 반문은 그대로 보존). 종목 바인딩이 없는 시장 전체
                # query는 trusted_code를 만들 수 없으므로, compatible family 안의
                # callable base preferred_ref만 검증된 단언으로 사용한다.
                compatible_family_refs = {
                    self.catalog.by_ref[ref].family_ref
                    for ref in decision.compatible_operation_refs
                }
                fallback_document = None
                if (
                    preferred is not None
                    and preferred.kind == "query"
                    and trusted_code is not None
                    and BindingRole.INSTRUMENT_CODE in preferred.routing.bindings
                    and preferred.family_ref in compatible_family_refs
                ):
                    if preferred.group_id is not None or preferred.generic_callable:
                        fallback_document = self._guarded_preferred_fallback(
                            preferred, detail_group, trusted_code=trusted_code
                        )
                    elif detail_group is not None:
                        try:
                            fallback_document = self._asserted_detail(
                                preferred.family_ref, detail_group
                            )
                        except UnknownDetailGroupError:
                            fallback_document = None
                    else:
                        # Same shape as the DETAIL_GROUP_REQUIRED branch below: the
                        # asserted family is real, it just still needs a projection.
                        self._validated_arguments(preferred, request.arguments)
                        raise self._detail_required(preferred.family_ref)
                elif (
                    preferred is not None
                    and preferred.kind == "query"
                    and BindingRole.INSTRUMENT_CODE not in preferred.routing.bindings
                    and preferred.family_ref in compatible_family_refs
                    and preferred.group_id is None
                    and detail_group is None
                ):
                    fallback_document = preferred
                if fallback_document is None:
                    public_reasons = _public_reason_codes(decision)
                    raise AmbiguousOperationError(
                        "Several operation profiles are compatible with the question",
                        details={
                            "candidates": list(decision.compatible_operation_refs[:3]),
                            "reason": public_reasons[0].value,
                            "reason_codes": [reason.value for reason in public_reasons],
                        },
                    )
                document = fallback_document
                reasons = [ReasonCode.PREFERRED_STRUCTURED_ASSERTION]
            else:
                canonical_family_ref = decision.selected_family_ref
                assert canonical_family_ref is not None
                if preferred is not None and preferred.family_ref != canonical_family_ref:
                    raise PreferredOperationError(
                        "Preferred operation does not match canonical family selection"
                    )
                if preferred is not None and preferred.group_id is not None:
                    if detail_group is not None and detail_group != preferred.group_id:
                        raise PreferredOperationError(
                            "Preferred detail conflicts with detail_group"
                        )
                    detail_group = preferred.group_id

                if decision.status is CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED:
                    if detail_group is None:
                        representative = next(
                            item
                            for item in self.catalog.documents
                            if item.family_ref == canonical_family_ref
                        )
                        self._validated_arguments(representative, request.arguments)
                        raise self._detail_required(canonical_family_ref)
                    document = self._asserted_detail(canonical_family_ref, detail_group)
                    reasons = [
                        *_public_reason_codes(decision),
                        ReasonCode.EXPLICIT_DETAIL_GROUP,
                    ]
                else:
                    assert decision.selected_operation_ref is not None
                    canonical_document = self.catalog.by_ref[
                        decision.selected_operation_ref
                    ]
                    if detail_group is None:
                        document = canonical_document
                        reasons = _public_reason_codes(decision)
                    else:
                        asserted = self._asserted_detail(canonical_family_ref, detail_group)
                        if (
                            canonical_document.group_id is not None
                            and asserted.operation_ref != canonical_document.operation_ref
                        ):
                            if preferred is not None and preferred.group_id is not None:
                                raise PreferredOperationError(
                                    "Preferred detail does not match typed selection"
                                )
                            raise UnknownDetailGroupError(
                                "Detail group does not match typed selection",
                                details={
                                    "operation_ref": canonical_document.operation_ref,
                                    "detail_group": detail_group,
                                },
                            )
                        document = asserted
                        reasons = [
                            *_public_reason_codes(decision),
                            ReasonCode.EXPLICIT_DETAIL_GROUP,
                        ]

        if not document.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        planned_arguments = (
            self._bind_trusted_instrument(
                document,
                request.arguments,
                trusted_code=trusted_code,
                intent=request.intent,
            )
            if explicit is None
            else dict(request.arguments)
        )
        arguments = self._validated_arguments(document, planned_arguments)
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
            kind=document.kind,  # type: ignore[arg-type]
            plan_token=token,
            expires_at=expires_at,
            selection_reasons=reasons,
            required_arguments_satisfied=True,
            response_mode=request.response_mode,
        )

    def _consume_nonce(self, plan: VerifiedPlan) -> None:
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
            # Every retained nonce is still replayable until its own plan expiry.
            # Evicting any one would reopen that signed plan, so capacity pressure
            # fails closed before dispatch and leaves all prior replay guards intact.
            raise ReplayStateCapacityError(
                "Replay protection capacity is full; wait for existing plans to expire "
                "before calling athena_call again"
            )
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
        query_only: bool = False,
        full_response_sink: Callable[[BaseModel], None] | None = None,
    ) -> CallResponse:
        plan = self.signer.verify(call.plan_token, self.catalog, expected_account=account)
        document = self.catalog.find_exact(plan.operation_ref)
        if document is None or not document.generic_callable:
            raise UnsupportedOperationError("Operation cannot be called by the generic selector")
        if query_only and document.kind == "order":
            raise OrderTicketRequiredError(
                "Order plans must be submitted through the confirmed order ticket"
            )
        if query_only and document.kind != "query":
            raise QueryPlanRequiredError("This execution surface accepts query plans only")
        self._consume_nonce(plan)
        try:
            payload = document.request_model.model_validate(plan.arguments)
        except ValidationError as exc:
            raise InvalidArgumentsError("Signed plan arguments are no longer valid") from exc
        continuation_request = _continuation_request(
            request, cont_yn=plan.cont_yn, next_key=plan.next_key
        )

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
                full_response_sink=full_response_sink,
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
        # 캔버스가 모델 제공 data에 의존하지 않도록, 검증된 signed plan의 요청
        # 모델에서 종목 식별자만 복사한다. 시장 데이터 3도메인(charts·stockinfo·
        # quotes)의 query에 한한다 — 시세류 카드의 실시간 구독(REAL 0B)이 이
        # 식별자를 쓴다(2026-08-27, charts 전용에서 확장). 계좌/주문 인자나
        # 전체 arguments는 여전히 응답 경계로 재노출하지 않는다.
        canvas_symbol = None
        if document.kind == "query" and document.domain in ("charts", "stockinfo", "quotes"):
            validated_arguments = payload.model_dump(by_alias=True)
            for alias in ("stk_cd", "inds_cd"):
                value = validated_arguments.get(alias)
                if isinstance(value, str) and 0 < len(value) <= 32:
                    canvas_symbol = value
                    break

        return CallResponse(
            operation_ref=document.operation_ref,
            data=result.model_dump(by_alias=True),
            continuation=ContinuationOutput(
                cont_yn=cont_yn,  # type: ignore[arg-type]
                next_key=next_key,
                next_plan_token=next_token,
            ),
            canvas_context={"symbol": canvas_symbol},
        )
