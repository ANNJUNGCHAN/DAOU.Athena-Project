"""Deterministic, explainable lexical ranking over the generated catalog."""

from __future__ import annotations

from dataclasses import dataclass

from .catalog import OperationCatalog, OperationDocument
from .lexicon import synonym_only_tokens
from .normalization import identity_tokens, normalize_text, tokenize
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
            ReasonCode.TR_ID_TOKEN_MATCH,
        }
        return sum(
            contribution.points
            for contribution in self.contributions
            if contribution.reason_code not in identity_reasons
        )


_ZONE_RULES = {
    "title": (ReasonCode.TITLE_TOKEN_MATCH, 150, 750),
    # Titles absorbed from a family's projections. Same token weight as the TR's
    # own title - this vocabulary is how an English question reaches a
    # Korean-named TR - but deliberately outside the phrase-bonus zone: slice
    # titles such as "계좌 정보" / "Account information" are boilerplate that
    # several unrelated families reuse, so a 1,400 point phrase bonus there would
    # decide family selection on a naming coincidence.
    "family_projection": (ReasonCode.PROJECTION_TITLE_MATCH, 150, 750),
    "domain": (ReasonCode.DOMAIN_MATCH, 80, 400),
    "request_alias": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "request_description": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "response_alias": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
    "response_description": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
}

# Full marks for a document that matches every distinct token of the question.
_COVERAGE_POINTS = 600


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
    matched_direct: set[str] = set()

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
    # A TR id cited inside a longer question ("ka10001 가치평가 지표만") is an
    # identity signal, not a lexical one. Matched case-sensitively on identity
    # boundaries so 0G/0g stay distinct and ka100010 never matches ka10001.
    if stripped != document.tr_id and document.tr_id in identity_tokens(query):
        contributions.append(
            _contribution(ReasonCode.TR_ID_TOKEN_MATCH, 3_000, {document.tr_id}, "identity")
        )

    for title in document.searchable_zones.get("title", ()):
        normalized_title = normalize_text(title)
        # A phrase is more than one word. Single-token titles such as "totals"
        # are generic enough to appear inside unrelated questions, and the 1,400
        # point phrase bonus would let them outrank the correct TR family.
        # They still earn TITLE_TOKEN_MATCH below.
        if len(tokenize(title)) >= 2 and normalized_title in normalized_query:
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
            matched_direct.update(direct_matches)
            points = min(cap, len(direct_matches) * points_per_token)
            contributions.append(_contribution(reason, points, direct_matches, zone))
        synonym_matches = synonym_tokens.intersection(zone_tokens).difference(direct_matches)
        if synonym_matches:
            points = min(cap, len(synonym_matches) * points_per_token * 3 // 4)
            contributions.append(
                _contribution(ReasonCode.SYNONYM_MATCH, points, synonym_matches, zone)
            )

    # Coordination factor: reward covering more of what was actually asked.
    # Without it a document can win by accumulating points for one common word
    # across several zones while a rival matches strictly more of the question.
    if direct_tokens and matched_direct:
        coverage = len(matched_direct) / len(direct_tokens)
        contributions.append(
            _contribution(
                ReasonCode.QUERY_COVERAGE,
                round(_COVERAGE_POINTS * coverage),
                matched_direct,
                "query",
            )
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


def searchable_surface(
    catalog: OperationCatalog, request: SearchRequest
) -> tuple[OperationDocument, ...]:
    """Base families, plus one detail when the query *is* that detail's identity.

    Detail projections are not ranked against their siblings, but an exact
    canonical identity must always stay addressable.
    """
    surface = catalog.visible_for(request.intent)
    exact = catalog.find_exact(request.query.strip())
    if exact is not None and exact.group_id is not None and exact not in surface:
        return (*surface, exact)
    return surface


def search_catalog(catalog: OperationCatalog, request: SearchRequest) -> SearchResponse:
    ranked = rank_documents(request.query, searchable_surface(catalog, request))
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
