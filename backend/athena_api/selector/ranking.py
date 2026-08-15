"""Deterministic, explainable lexical ranking over the generated catalog."""

from __future__ import annotations

from dataclasses import dataclass

from .catalog import OperationCatalog, OperationDocument
from .lexicon import synonym_only_tokens
from .normalization import normalize_text, tokenize
from .schemas import (
    ReasonCode,
    ScoreContribution,
    SearchHit,
    SearchRequest,
    SearchResponse,
)


@dataclass(frozen=True, slots=True)
class RankedDocument:
    document: OperationDocument
    score: int
    contributions: tuple[ScoreContribution, ...]

    @property
    def semantic_score(self) -> int:
        identity_reasons = {
            ReasonCode.EXACT_OPERATION_REF,
            ReasonCode.EXACT_TR_ID,
            ReasonCode.EXACT_GROUP_ID,
        }
        return sum(
            contribution.points
            for contribution in self.contributions
            if contribution.reason_code not in identity_reasons
        )


_ZONE_RULES = {
    "title": (ReasonCode.TITLE_TOKEN_MATCH, 150, 750),
    "domain": (ReasonCode.DOMAIN_MATCH, 80, 400),
    "request_alias": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "request_description": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "response_alias": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
    "response_description": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
}


def _contribution(
    reason: ReasonCode, points: int, terms: set[str], scope: str
) -> ScoreContribution:
    return ScoreContribution(
        reason_code=reason,
        points=points,
        matched_terms=sorted(terms)[:10],
        scope=scope,
    )


def rank_document(query: str, document: OperationDocument) -> RankedDocument:
    stripped = query.strip()
    normalized_query = normalize_text(query)
    direct_tokens = set(tokenize(query))
    synonym_tokens = set(synonym_only_tokens(tuple(sorted(direct_tokens))))
    contributions: list[ScoreContribution] = []

    if stripped == document.operation_ref:
        contributions.append(
            _contribution(
                ReasonCode.EXACT_OPERATION_REF, 10_000, {document.operation_ref}, "identity"
            )
        )
    if stripped == document.tr_id:
        contributions.append(
            _contribution(ReasonCode.EXACT_TR_ID, 5_000, {document.tr_id}, "identity")
        )
    if document.group_id is not None and stripped == document.group_id:
        contributions.append(
            _contribution(
                ReasonCode.EXACT_GROUP_ID, 4_000, {document.group_id}, "identity"
            )
        )

    for title in document.searchable_zones.get("title", ()):
        normalized_title = normalize_text(title)
        if len(normalized_title) >= 2 and normalized_title in normalized_query:
            contributions.append(
                _contribution(
                    ReasonCode.TITLE_PHRASE_MATCH, 1_400, {normalized_title}, "title"
                )
            )
            break

    for zone, (reason, points_per_token, cap) in _ZONE_RULES.items():
        zone_tokens = {
            token
            for value in document.searchable_zones.get(zone, ())
            for token in tokenize(value)
        }
        direct_matches = direct_tokens.intersection(zone_tokens)
        if direct_matches:
            points = min(cap, len(direct_matches) * points_per_token)
            contributions.append(_contribution(reason, points, direct_matches, zone))
        synonym_matches = synonym_tokens.intersection(zone_tokens).difference(direct_matches)
        if synonym_matches:
            points = min(cap, len(synonym_matches) * points_per_token * 3 // 4)
            contributions.append(
                _contribution(ReasonCode.SYNONYM_MATCH, points, synonym_matches, zone)
            )

    ordered = tuple(
        sorted(
            contributions,
            key=lambda item: (-item.points, item.reason_code.value, item.scope),
        )
    )
    return RankedDocument(document, sum(item.points for item in ordered), ordered)


def rank_documents(
    query: str, documents: tuple[OperationDocument, ...]
) -> tuple[RankedDocument, ...]:
    ranked = [rank_document(query, document) for document in documents]
    ranked = [item for item in ranked if item.score > 0]
    return tuple(
        sorted(
            ranked,
            key=lambda item: (
                -item.score,
                not item.document.generic_callable,
                item.document.kind != "query",
                item.document.operation_ref,
            ),
        )
    )


def search_catalog(catalog: OperationCatalog, request: SearchRequest) -> SearchResponse:
    ranked = rank_documents(request.query, catalog.visible_for(request.intent))
    results = []
    for item in ranked[: request.limit]:
        confidence = "high" if item.score >= 1_000 else "medium" if item.score >= 240 else "low"
        document = item.document
        results.append(
            SearchHit(
                operation_ref=document.operation_ref,
                kind=document.kind,  # type: ignore[arg-type]
                domain=document.domain,
                name=document.name,
                group_title=document.group_title_ko or document.group_title_en,
                score=item.score,
                confidence=confidence,
                contributions=list(item.contributions),
                generic_callable=document.generic_callable,
                discovery_only=document.visibility == "explicit",
            )
        )
    return SearchResponse(
        catalog_version=catalog.version,
        normalized_query=normalize_text(request.query),
        results=results,
    )
