"""Canonical 323-operation selector catalog built from generated allowlists."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, get_args

from pydantic import BaseModel

from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    OUTPUT_PROFILE_BY_ID,
    QUERY_FRAME_VERSION,
    ROUTING_CONTRACT_VERSION,
    ROUTING_EQUIVALENCE_GROUPS,
    ROUTING_REGISTRY,
    SPLIT_BASE_TR_IDS,
    TR_REGISTRY,
)
from athena_api.routing_contract import OperationRouting

from .lexicon import LEXICON_VERSION
from .normalization import tokenize
from .query_frame import ENTITY_MARKER_SHA256, ENTITY_MARKER_VERSION
from .schemas import DiscoveryIntent

Visibility = Literal["normal", "explicit", "hidden"]


def model_schema_hash(model: type[BaseModel]) -> str:
    encoded = json.dumps(
        model.model_json_schema(by_alias=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _field_terms(model: type[BaseModel]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    aliases: list[str] = []
    descriptions: list[str] = []
    for name, field in model.model_fields.items():
        aliases.append(field.alias or name)
        if field.description:
            descriptions.append(field.description)
    return tuple(aliases), tuple(descriptions)


def realtime_item_model(response_model: type[BaseModel]) -> type[BaseModel] | None:
    """Return the per-event model carried by a websocket envelope's ``data`` list.

    Every websocket response is the same four-field acknowledgement envelope
    (``return_code``/``return_msg``/``trnm``/``data``). The stream's actual payload -
    the FID fields a screen renders, such as ``"10": 현재가`` - lives one level down in
    ``data[*]``. Reading the envelope alone tells a caller nothing about what the
    subscription delivers, so both retrieval and ``describe`` unwrap it.
    """
    field = response_model.model_fields.get("data")
    if field is None:
        return None
    for argument in get_args(field.annotation):
        for inner in (argument, *get_args(argument)):
            if isinstance(inner, type) and issubclass(inner, BaseModel):
                return inner
    return None


def _realtime_field_terms(response_model: type[BaseModel]) -> tuple[str, ...]:
    """Name every FID a realtime type emits, dropping the unit/format notes.

    A generated FID description reads ``현재가 — 단위: 원, 부호가 포함된 숫자``. Only the
    head is content; the tail after the em dash is formatting boilerplate repeated
    across hundreds of unrelated fields, and indexing it would let "단위" or "숫자"
    contribute to retrieval.

    Only numerically keyed fields qualify. The four named ones an event also carries -
    ``type``/``name``/``item``/``values``, described as "실시간항목", "실시간 항목명",
    "실시간 등록 요소", "실시간 값 리스트" - are the delivery envelope, identical on all
    23 types. Indexed, they hand every realtime type the token 실시간 for free, which is
    the one token a realtime question always contains.
    """
    terms: list[str] = []
    for name, field in response_model.model_fields.items():
        if not (field.alias or name).isdigit():
            continue
        if field.description:
            terms.append(field.description.split("—", 1)[0].strip())
    return tuple(term for term in terms if term)


@dataclass(frozen=True, slots=True)
class OperationDocument:
    operation_ref: str
    kind: Literal["query", "order", "websocket", "oauth"]
    domain: str
    # The catalog's own name for a vocabulary cluster. Operations inside one subcategory
    # restate each other's terms in their domain, notes and field descriptions, so a score
    # comparison between two of them is mostly a comparison of shared boilerplate. Across
    # subcategories that is not true, and policy relies on the distinction.
    subcategory: str | None
    tr_id: str
    group_id: str | None
    name: str
    group_title_ko: str | None
    group_title_en: str | None
    shape: str
    layout: str | None
    ui_page_size: int | None
    request_model: type[BaseModel]
    response_model: type[BaseModel]
    searchable_zones: Mapping[str, tuple[str, ...]]
    visibility: Visibility
    generic_callable: bool
    request_schema_hash: str
    response_schema_hash: str
    routing: OperationRouting

    @property
    def family_ref(self) -> str:
        return f"base:{self.tr_id}"


@dataclass(frozen=True, slots=True)
class OperationCatalog:
    documents: tuple[OperationDocument, ...]
    by_ref: Mapping[str, OperationDocument]
    version: str

    def find_exact(self, operation_ref: str) -> OperationDocument | None:
        """Case-sensitive lookup. Hidden operations deliberately look absent."""
        document = self.by_ref.get(operation_ref)
        return None if document is None or document.visibility == "hidden" else document

    def visible_for(self, intent: DiscoveryIntent) -> tuple[OperationDocument, ...]:
        """Return the searchable surface: one document per TR family.

        Detail projections are deliberately excluded from global ranking. After
        a family is fixed, policy evaluates only its owned details and may choose
        one uniquely supported by typed compatibility and authoritative canonical
        evidence; otherwise ``ResolveRequest.detail_group`` is required. Details
        stay addressable by exact identity through :meth:`find_exact` and
        :meth:`details_for`.
        """
        if intent in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}:
            allowed = {"query"}
        elif intent is DiscoveryIntent.ORDER:
            allowed = {"order"}
        else:
            allowed = {"websocket"}
        return tuple(
            document
            for document in self.documents
            if document.kind in allowed
            and document.visibility != "hidden"
            and document.group_id is None
        )

    def details_for(self, tr_id: str) -> tuple[OperationDocument, ...]:
        """Return every detail projection of ``tr_id`` in stable identity order."""
        return tuple(
            document
            for document in self.documents
            if document.tr_id == tr_id and document.group_id is not None
        )


def _detail_titles_by_tr() -> Mapping[str, tuple[str, ...]]:
    """Group every projection's vocabulary under its base TR.

    A base document stands for its whole family in search, so it must be
    findable by the words of anything it can project. Without this, dropping
    projections from the searchable surface would silently delete the English
    group titles - base operations carry Korean TR names only.
    """
    grouped: dict[str, list[str]] = {}
    for operation_ref in sorted(DETAIL_REGISTRY):
        detail = DETAIL_REGISTRY[operation_ref]
        terms = grouped.setdefault(detail.tr_id, [])
        terms.extend(term for term in (detail.title_ko, detail.title_en, detail.group_id) if term)
    return MappingProxyType({tr_id: tuple(terms) for tr_id, terms in grouped.items()})


_DETAIL_TITLES_BY_TR = _detail_titles_by_tr()

_GENERIC_CAPABILITY_TOKENS = frozenset(
    {
        "account",
        "current",
        "data",
        "identity",
        "information",
        "market",
        "snapshot",
        "stock",
        "계좌",
        "기본",
        "시장",
        "정보",
        "종목",
        "현재",
    }
)


def _family_capability_terms(tr_id: str) -> tuple[str, ...]:
    """Return canonical detail titles that add a discriminating capability term."""
    return tuple(
        term
        for detail in DETAIL_REGISTRY.values()
        if detail.tr_id == tr_id
        for term in (detail.title_ko, detail.title_en)
        if term and set(tokenize(term, korean_bigrams=False)).difference(_GENERIC_CAPABILITY_TOKENS)
    )


def _zones_for_base(tr_id: str) -> Mapping[str, tuple[str, ...]]:
    spec = TR_REGISTRY[tr_id]
    request_aliases, request_descriptions = _field_terms(spec.request_model)
    response_aliases, response_descriptions = _field_terms(spec.response_model)
    # A websocket type's payload is one level below its acknowledgement envelope, and the
    # envelope is byte-identical across all 23 types. Without this the only content-bearing
    # vocabulary a realtime type owns is its two-word name.
    realtime_model = realtime_item_model(spec.response_model) if spec.kind == "websocket" else None
    return MappingProxyType(
        {
            # The name alone. A TR's overview is prose, and for the 23 websocket types it is
            # prose about the *subscription mechanism* - "실시간 항목 04(잔고)는 종목코드
            # 등록과 상관 없이 ... 주문 체결이 발생할 경우 ..." - which is near-identical
            # boilerplate across the surface. Scored at title weight it decided realtime
            # retrieval on how verbose a type's registration note happened to be: "실시간
            # 체결" ranked 04 잔고 and 0A 주식기세 above 0B 주식체결, whose note is one line.
            "title": (spec.name,) if spec.name else (),
            "overview": (spec.overview,) if spec.overview else (),
            "family_projection": _DETAIL_TITLES_BY_TR.get(tr_id, ()),
            "family_capability": _family_capability_terms(tr_id),
            "realtime_field": (
                _realtime_field_terms(realtime_model) if realtime_model is not None else ()
            ),
            "domain": tuple(
                term for term in (spec.domain, spec.category, spec.subcategory) if term
            ),
            "request_alias": request_aliases,
            "request_description": request_descriptions,
            "response_alias": response_aliases,
            "response_description": response_descriptions,
        }
    )


def _zones_for_detail(operation_ref: str) -> Mapping[str, tuple[str, ...]]:
    detail = DETAIL_REGISTRY[operation_ref]
    base = TR_REGISTRY[detail.tr_id]
    request_aliases, request_descriptions = _field_terms(base.request_model)
    response_aliases, response_descriptions = _field_terms(detail.response_model)
    return MappingProxyType(
        {
            "title": tuple(
                term for term in (detail.title_ko, detail.title_en, detail.group_id) if term
            ),
            "domain": tuple(
                term for term in (base.domain, base.category, base.subcategory) if term
            ),
            "request_alias": request_aliases,
            "request_description": request_descriptions,
            "response_alias": response_aliases,
            "response_description": response_descriptions,
        }
    )


def _catalog_version(documents: tuple[OperationDocument, ...]) -> str:
    canonical = [
        {
            "operation_ref": document.operation_ref,
            "kind": document.kind,
            "domain": document.domain,
            "subcategory": document.subcategory,
            "tr_id": document.tr_id,
            "group_id": document.group_id,
            "name": document.name,
            "group_title_ko": document.group_title_ko,
            "group_title_en": document.group_title_en,
            "shape": document.shape,
            "layout": document.layout,
            "ui_page_size": document.ui_page_size,
            "visibility": document.visibility,
            "generic_callable": document.generic_callable,
            "request_schema_hash": document.request_schema_hash,
            "response_schema_hash": document.response_schema_hash,
            "routing": document.routing.canonical(),
            "zones": dict(document.searchable_zones),
        }
        for document in documents
    ]
    encoded = json.dumps(
        {
            "lexicon_version": LEXICON_VERSION,
            "routing_equivalence_groups": ROUTING_EQUIVALENCE_GROUPS,
            "routing_contract_version": ROUTING_CONTRACT_VERSION,
            "query_frame_version": QUERY_FRAME_VERSION,
            "entity_marker_version": ENTITY_MARKER_VERSION,
            "entity_marker_sha256": ENTITY_MARKER_SHA256,
            "documents": canonical,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def build_operation_catalog() -> OperationCatalog:
    documents: list[OperationDocument] = []
    for tr_id in sorted(TR_REGISTRY):
        spec = TR_REGISTRY[tr_id]
        visibility: Visibility = (
            "hidden" if spec.kind == "oauth" else "normal" if spec.kind == "query" else "explicit"
        )
        documents.append(
            OperationDocument(
                operation_ref=f"base:{tr_id}",
                kind=spec.kind,  # type: ignore[arg-type]
                domain=spec.domain,
                subcategory=spec.subcategory,
                tr_id=tr_id,
                group_id=None,
                name=spec.name,
                group_title_ko=None,
                group_title_en=None,
                shape=str(OUTPUT_PROFILE_BY_ID[tr_id]["shape"]),
                layout=None,
                ui_page_size=None,
                request_model=spec.request_model,
                response_model=spec.response_model,
                searchable_zones=_zones_for_base(tr_id),
                visibility=visibility,
                # Callable does not mean reachable by a vague question. Order and websocket
                # operations keep `explicit` visibility, so a natural-language search never
                # ranks them; the model must declare the intent and then name the operation.
                # A split family is the inverse: searchable, but replaced by its projections.
                generic_callable=(
                    spec.kind in {"query", "order", "websocket"} and tr_id not in SPLIT_BASE_TR_IDS
                ),
                request_schema_hash=model_schema_hash(spec.request_model),
                response_schema_hash=model_schema_hash(spec.response_model),
                routing=ROUTING_REGISTRY[f"base:{tr_id}"],
            )
        )
    for operation_ref in sorted(DETAIL_REGISTRY):
        detail = DETAIL_REGISTRY[operation_ref]
        base = TR_REGISTRY[detail.tr_id]
        documents.append(
            OperationDocument(
                operation_ref=operation_ref,
                kind="query",
                domain=base.domain,
                subcategory=base.subcategory,
                tr_id=detail.tr_id,
                group_id=detail.group_id,
                name=base.name,
                group_title_ko=detail.title_ko,
                group_title_en=detail.title_en,
                shape=str(OUTPUT_PROFILE_BY_ID[detail.tr_id]["shape"]),
                layout=detail.layout,
                ui_page_size=detail.ui_page_size,
                request_model=base.request_model,
                response_model=detail.response_model,
                searchable_zones=_zones_for_detail(operation_ref),
                visibility="normal",
                generic_callable=True,
                request_schema_hash=model_schema_hash(base.request_model),
                response_schema_hash=model_schema_hash(detail.response_model),
                routing=ROUTING_REGISTRY[operation_ref],
            )
        )
    ordered = tuple(sorted(documents, key=lambda document: document.operation_ref))
    by_ref = MappingProxyType({document.operation_ref: document for document in ordered})
    return OperationCatalog(documents=ordered, by_ref=by_ref, version=_catalog_version(ordered))
