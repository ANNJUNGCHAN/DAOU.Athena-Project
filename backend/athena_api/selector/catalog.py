"""Canonical 323-operation selector catalog built from generated allowlists."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel

from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    OUTPUT_PROFILE_BY_ID,
    TR_REGISTRY,
)

from .lexicon import LEXICON_VERSION
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


@dataclass(frozen=True, slots=True)
class OperationDocument:
    operation_ref: str
    kind: Literal["query", "order", "websocket", "oauth"]
    domain: str
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
        if intent in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}:
            allowed = {"query"}
        elif intent is DiscoveryIntent.ORDER:
            allowed = {"order"}
        else:
            allowed = {"websocket"}
        return tuple(
            document
            for document in self.documents
            if document.kind in allowed and document.visibility != "hidden"
        )


def _zones_for_base(tr_id: str) -> Mapping[str, tuple[str, ...]]:
    spec = TR_REGISTRY[tr_id]
    request_aliases, request_descriptions = _field_terms(spec.request_model)
    response_aliases, response_descriptions = _field_terms(spec.response_model)
    return MappingProxyType(
        {
            "title": tuple(term for term in (spec.name, spec.overview) if term),
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
            "zones": dict(document.searchable_zones),
        }
        for document in documents
    ]
    encoded = json.dumps(
        {"lexicon_version": LEXICON_VERSION, "documents": canonical},
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
                generic_callable=spec.kind == "query",
                request_schema_hash=model_schema_hash(spec.request_model),
                response_schema_hash=model_schema_hash(spec.response_model),
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
            )
        )
    ordered = tuple(sorted(documents, key=lambda document: document.operation_ref))
    by_ref = MappingProxyType({document.operation_ref: document for document in ordered})
    return OperationCatalog(documents=ordered, by_ref=by_ref, version=_catalog_version(ordered))
