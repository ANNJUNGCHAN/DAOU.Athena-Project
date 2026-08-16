"""Deterministic, explainable lexical ranking over the generated catalog."""

from __future__ import annotations

from dataclasses import dataclass

from .catalog import OperationCatalog, OperationDocument
from .lexicon import synonym_only_tokens
from .normalization import identity_tokens, normalize_text, tokenize
from .schemas import (
    DiscoveryIntent,
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
    def title_score(self) -> int:
        """Points earned by the operation's own name.

        Kept separate because a name is a claim about identity and every other zone is
        corroboration. Two families that corroborate a question equally well are not
        ambiguous if the question named one of them better.
        """
        return sum(item.points for item in self.contributions if item.scope == "title")

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
    # The TR's prose note, scored well below its name. An overview explains how to use an
    # operation, so it repeats mechanism vocabulary - 등록, 수신, 실시간, 종목코드 - that
    # says nothing about which operation was asked for. It earns points because a question
    # sometimes lands only there, never enough to overturn a name.
    "overview": (ReasonCode.OVERVIEW_MATCH, 60, 300),
    # The FID fields a realtime type emits. This is the only content-bearing vocabulary a
    # websocket type has: its envelope is shared across all 23, so response_alias and
    # response_description are constant on that surface and cannot rank anything.
    "realtime_field": (ReasonCode.REALTIME_FIELD_MATCH, 90, 600),
    "domain": (ReasonCode.DOMAIN_MATCH, 80, 400),
    "request_alias": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "request_description": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "response_alias": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
    "response_description": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
}

# Full marks for a document that matches every distinct token of the question.
_COVERAGE_POINTS = 600

# What an operation is *called* is the claim; its domain, its prose note and its field
# descriptions are corroboration. Uncapped, corroboration outvotes the claim: the four
# supporting zones sum past 1,000 while a name caps at 750, so a wordy operation beats a
# correctly-named one. `ka10171 조건검색 목록조회` is the case that exposed it - it alone
# matches 목록 in its title, then loses to `ka10173` because it takes no request arguments
# and so cannot collect the 350 points its sibling earns from restating the family's own
# vocabulary in field descriptions. An operation must not rank higher for being verbose.
# `family_projection` is deliberately absent: a projection title is the family's own name in
# another language, not corroboration for it.
_CORROBORATION_ZONES = frozenset(
    {
        "overview",
        "domain",
        "realtime_field",
        "request_alias",
        "request_description",
        "response_alias",
        "response_description",
    }
)
_CORROBORATION_CAP = 750


def _contribution(
    reason: ReasonCode, points: int, terms: set[str], scope: str
) -> ScoreContribution:
    return ScoreContribution(
        reason_code=reason,
        points=points,
        matched_terms=sorted(terms)[:10],
        scope=scope,
    )


def _zone_tokens(document: OperationDocument, zone: str) -> set[str]:
    return {
        token
        for value in document.searchable_zones.get(zone, ())
        for token in tokenize(value)
    }


# A token has to be absent from at least a tenth of the surface to say anything about it.
_UNINFORMATIVE_SHARE = 0.9
# Below this many candidates a document frequency is not evidence of anything.
_MINIMUM_SURFACE = 8


def uninformative_zone_tokens(
    query: str, documents: tuple[OperationDocument, ...]
) -> frozenset[tuple[str, str]]:
    """``(zone, token)`` pairs that nearly every candidate shares, and so cannot rank.

    This is surface-relative on purpose. "실시간" is the most useful word in a question
    about streaming and the most useless one once the websocket surface is what is being
    ranked: all 23 types repeat it in their domain, their registration note, and both
    envelope descriptions. Scored, it hands every candidate an identical ~600 points and
    an identical coverage credit, so the words that were actually asked - 호가, 예상체결,
    NAV - decide nothing.

    The judgement is per zone, not per document, because the same token is constant in one
    place and decisive in another. Every realtime type carries a 체결시간 FID, so 체결 says
    nothing in ``realtime_field``; only three types are *named* 체결, so in ``title`` it is
    almost the whole answer. Suppressing the token outright collapsed 주문체결, 주식체결
    and 주식예상체결 onto one score.
    """
    if len(documents) < _MINIMUM_SURFACE:
        return frozenset()
    tokens = set(tokenize(query))
    tokens.update(synonym_only_tokens(tuple(sorted(tokens))))
    if not tokens:
        return frozenset()
    threshold = len(documents) * _UNINFORMATIVE_SHARE
    frequency: dict[tuple[str, str], int] = {}
    zones_by_token: dict[str, set[str]] = {}
    for document in documents:
        for zone in _ZONE_RULES:
            for token in tokens.intersection(_zone_tokens(document, zone)):
                key = (zone, token)
                frequency[key] = frequency.get(key, 0) + 1
                zones_by_token.setdefault(token, set()).add(zone)
    suppressed = {key for key, count in frequency.items() if count >= threshold}
    # Redundant evidence is what this removes, never the evidence itself. A word can be
    # ubiquitous in every zone at once - "주문 체결" is, across the 23 realtime types - and
    # suppressing it everywhere leaves the question with nothing to match, so search returns
    # an empty result for a question that plainly names an operation. Each token keeps the
    # single most authoritative zone it appears in; only the repetitions are dropped.
    for token, zones in zones_by_token.items():
        surviving = zones.difference(zone for zone, name in suppressed if name == token)
        if surviving:
            continue
        kept = max(zones, key=lambda zone: (_ZONE_RULES[zone][1], zone))
        suppressed.discard((kept, token))
    return frozenset(suppressed)


def rank_document(
    query: str,
    document: OperationDocument,
    uninformative: frozenset[tuple[str, str]] = frozenset(),
) -> RankedDocument:
    stripped = query.strip()
    normalized_query = normalize_text(query)
    direct_tokens = set(tokenize(query, korean_bigrams=False))
    # Bigrams let a question reach inside a Korean compound: 체결 has to find 주식체결.
    # They are evidence of a different grade from a word the user actually typed, though,
    # because a two-syllable slice of one word is a whole word of another. 실시간 yields
    # 시간, which matches 주식시간외호가 as strongly as 호가 does, and that false match
    # alone tied 0E with the correctly named 0D on a question about 호가 잔량.
    all_tokens = set(tokenize(query))
    fragment_tokens = all_tokens.difference(direct_tokens)
    # Expanded from the fragments too, because Korean agglutinates: "해지해줘" is one token
    # to the tokenizer, so the dictionary word 해지 exists only as a fragment of it. Feeding
    # the lexicon whole words alone silently disables synonym matching for most Korean
    # questions - 해지 stopped reaching `ka10174 조건검색 실시간 해제` entirely.
    synonym_tokens = set(synonym_only_tokens(tuple(sorted(all_tokens)))).difference(all_tokens)
    contributions: list[ScoreContribution] = []
    matched_direct: set[str] = set()
    matched_fragments: set[str] = set()

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
            for token in _zone_tokens(document, zone)
            if (zone, token) not in uninformative
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
        fragment_matches = (
            fragment_tokens.intersection(zone_tokens)
            .difference(direct_matches)
            .difference(synonym_matches)
        )
        if fragment_matches:
            # Half weight, and reported under the zone's own reason code because it is the
            # same kind of evidence, only weaker: it reaches into a compound rather than
            # naming it.
            matched_fragments.update(fragment_matches)
            points = min(cap, len(fragment_matches) * points_per_token // 2)
            contributions.append(_contribution(reason, points, fragment_matches, zone))

    corroboration = sum(
        item.points for item in contributions if item.scope in _CORROBORATION_ZONES
    )
    if corroboration > _CORROBORATION_CAP:
        # Scaled rather than truncated so the returned explanation still shows which zones
        # supported the match and in what proportion; only their combined weight is bounded.
        contributions = [
            item.model_copy(
                update={"points": item.points * _CORROBORATION_CAP // corroboration}
            )
            if item.scope in _CORROBORATION_ZONES
            else item
            for item in contributions
        ]

    # Coordination factor: reward covering more of what was actually asked.
    # Without it a document can win by accumulating points for one common word
    # across several zones while a rival matches strictly more of the question.
    # A word counts as covered when the document reached it at all, including through one
    # of its own fragments: coverage asks how much of the question was addressed, and
    # matching 주식체결 does address the word 체결. Only whole words are counted, so a long
    # compound cannot inflate the denominator with the fragments it happens to decompose to.
    covered = {
        token
        for token in direct_tokens
        if token in matched_direct
        or any(fragment in token for fragment in matched_fragments)
    }
    if direct_tokens and covered:
        coverage = len(covered) / len(direct_tokens)
        contributions.append(
            _contribution(
                ReasonCode.QUERY_COVERAGE,
                round(_COVERAGE_POINTS * coverage),
                covered,
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
    # Computed over the candidate set, not the whole catalog: what a token can discriminate
    # depends on what it is being asked to discriminate between.
    uninformative = uninformative_zone_tokens(query, documents)
    ranked = [rank_document(query, document, uninformative) for document in documents]
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


_WEBSOCKET_SIGNALS = (
    "실시간",
    "구독",
    "스트림",
    "realtime",
    "real time",
    "stream",
    "subscribe",
    "websocket",
)
_ORDER_SIGNALS = ("매수", "매도", "주문", "order", "buy", "sell")
# A read of past activity, not a request to act. "미체결 주문 조회" is a query TR.
_READ_MARKERS = (
    "조회",
    "내역",
    "현황",
    "추이",
    "목록",
    "리스트",
    "잔고",
    "history",
    "list",
    "inquiry",
    "status",
)


def _suggested_intent(
    request: SearchRequest, ranked: tuple[RankedDocument, ...]
) -> DiscoveryIntent | None:
    """Name the intent that would have seen what this question is asking for.

    Score cannot detect the miss: an unrelated read operation still scores in the
    hundreds on shared tokens, and the 12 order documents have titles too short to
    outscore it, so no threshold and no cross-surface comparison separates them. The
    discriminator is linguistic. "매수 주문 넣어줘" asks to act; "미체결 주문 조회" asks
    to read, and a read marker always wins because reads are what this surface serves.
    """
    if request.intent not in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}:
        return None
    text = normalize_text(request.query)
    if any(marker in text for marker in _READ_MARKERS):
        return None
    if any(signal in text for signal in _WEBSOCKET_SIGNALS):
        return DiscoveryIntent.WEBSOCKET
    if any(signal in text for signal in _ORDER_SIGNALS):
        return DiscoveryIntent.ORDER
    return None


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
        suggested_intent=_suggested_intent(request, ranked),
    )
