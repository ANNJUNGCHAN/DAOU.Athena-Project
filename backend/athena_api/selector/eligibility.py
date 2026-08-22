"""Visibility-first typed eligibility for selector operations."""

from __future__ import annotations

from dataclasses import dataclass

from athena_api.routing_contract import (
    DataIntent,
    EntityKind,
    ExecutionKind,
    Measure,
    RoutingSubject,
    TemporalScope,
)

from .catalog import OperationDocument
from .query_frame import QueryFrame
from .schemas import ReasonCode, ScoreContribution


@dataclass(frozen=True, slots=True)
class EligibilityResult:
    eligible: bool
    tier: int
    contradictions: tuple[str, ...]
    contributions: tuple[ScoreContribution, ...]


_SUBJECT_ENTITIES = {
    RoutingSubject.INSTRUMENT: frozenset(
        {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
    ),
    RoutingSubject.SECTOR: frozenset({EntityKind.SECTOR_INDEX}),
    RoutingSubject.MARKET: frozenset({EntityKind.MARKET}),
    RoutingSubject.ACCOUNT: frozenset({EntityKind.ACCOUNT}),
    RoutingSubject.ORDER: frozenset({EntityKind.ORDER}),
    RoutingSubject.PARTICIPANT: frozenset({EntityKind.INVESTOR, EntityKind.BROKER}),
    RoutingSubject.COLLECTION: frozenset(
        {EntityKind.THEME, EntityKind.WATCHLIST, EntityKind.CONDITION}
    ),
    RoutingSubject.AUTHENTICATION: frozenset(),
}

_EXCLUSIVE_DATA_INTENTS = frozenset(
    {
        DataIntent.CURRENT_QUOTE,
        DataIntent.EXPECTED_QUOTE,
        DataIntent.EXPECTED_MARKET_STATE,
        DataIntent.PRICE_HISTORY,
        DataIntent.CHART,
        DataIntent.PRICE_RANGE,
        DataIntent.MARKET_SCALE,
        DataIntent.VOLUME_RANKING,
        DataIntent.ORDERBOOK_RANKING,
        DataIntent.SPIKE_RANKING,
        DataIntent.TOP_RANKING,
        DataIntent.HOLDINGS,
        DataIntent.PERFORMANCE,
        DataIntent.VALUATION_GAP,
        DataIntent.ORDER_AMEND,
        DataIntent.ORDER_CANCEL,
        DataIntent.SUBSCRIPTION,
        DataIntent.UNSUBSCRIPTION,
    }
)

_SPECIALIZED_PRODUCT_ENTITIES = frozenset(
    {
        EntityKind.STOCK,
        EntityKind.ETF,
        EntityKind.ELW,
        EntityKind.GOLD,
        EntityKind.SECTOR_INDEX,
    }
)


def _contribution(
    reason: ReasonCode,
    matched_terms: tuple[str, ...],
    *,
    points: int = 0,
) -> ScoreContribution:
    return ScoreContribution(
        reason_code=reason,
        points=points,
        matched_terms=list(matched_terms),
        scope="typed",
    )


def evaluate_eligibility(
    frame: QueryFrame,
    document: OperationDocument,
) -> EligibilityResult:
    """Reject explicit contradictions; neutral facets neither help nor hurt."""
    routing = document.routing
    contradictions: list[str] = []
    hard_matches: list[str] = []
    tier = 0

    if frame.execution is not None:
        if frame.execution == routing.execution:
            hard_matches.append(f"execution:{frame.execution.value}")
            tier += 64
        elif frame.execution is not ExecutionKind.QUERY:
            contradictions.append(f"execution:{routing.execution.value}")

    if frame.subject is not None:
        if frame.subject == routing.subject:
            hard_matches.append(f"subject:{frame.subject.value}")
            tier += 32
        elif frame.subject is not RoutingSubject.INSTRUMENT and _SUBJECT_ENTITIES[
            frame.subject
        ].intersection(routing.entity_kinds):
            hard_matches.append(f"subject_entity:{frame.subject.value}")
            tier += 32
        else:
            contradictions.append(f"subject:{routing.subject.value}")

    frame_products = set(frame.entity_kinds).intersection(_SPECIALIZED_PRODUCT_ENTITIES)
    routing_products = set(routing.entity_kinds).intersection(
        _SPECIALIZED_PRODUCT_ENTITIES
    )
    if frame_products and not frame_products.intersection(routing_products):
        contradictions.extend(
            f"entity_kind:{item.value}"
            for item in sorted(frame_products, key=lambda value: value.value)
        )

    if frame.entity_kinds:
        matched = tuple(item for item in frame.entity_kinds if item in routing.entity_kinds)
        if matched:
            hard_matches.extend(f"entity_kind:{item.value}" for item in matched)
            tier += 16
            if set(frame.entity_kinds) == set(routing.entity_kinds):
                tier += 1
            elif routing_products and routing_products.issubset(frame_products):
                tier += 1
        else:
            contradictions.extend(f"entity_kind:{item.value}" for item in routing.entity_kinds)

    if frame.data_intents:
        if (
            DataIntent.EXPECTED_MARKET_STATE in routing.data_intents
            and DataIntent.EXPECTED_QUOTE not in frame.data_intents
            and DataIntent.EXPECTED_MARKET_STATE not in frame.data_intents
        ):
            contradictions.append("data_intent:expected_market_state")
        if (
            routing.execution is ExecutionKind.WEBSOCKET
            and DataIntent.EXPECTED_QUOTE in routing.data_intents
            and DataIntent.EXPECTED_QUOTE not in frame.data_intents
        ):
            contradictions.append("data_intent:expected_quote")
        exclusive = tuple(item for item in frame.data_intents if item in _EXCLUSIVE_DATA_INTENTS)
        matched = tuple(item for item in frame.data_intents if item in routing.data_intents)
        exclusive_missing = tuple(item for item in exclusive if item not in routing.data_intents)
        if matched and not exclusive_missing:
            hard_matches.extend(f"data_intent:{item.value}" for item in matched)
            tier += 8
            routing_exclusive = frozenset(routing.data_intents).intersection(
                _EXCLUSIVE_DATA_INTENTS
            )
            if (
                exclusive
                and (frame.subject is not None or frame.entity_kinds)
                and frozenset(exclusive) == routing_exclusive
            ):
                tier += 1
        else:
            contradictions.extend(
                f"data_intent:{item.value}" for item in (exclusive_missing or frame.data_intents)
            )

    if frame.temporal_scopes:
        concrete = tuple(
            item for item in routing.temporal_scopes if item is not TemporalScope.UNSPECIFIED
        )
        matched = tuple(item for item in frame.temporal_scopes if item in concrete)
        if (
            not matched
            and DataIntent.HISTORY in frame.data_intents
            and TemporalScope.CURRENT in frame.temporal_scopes
            and TemporalScope.RANGE in concrete
        ):
            matched = (TemporalScope.CURRENT,)
        if matched:
            hard_matches.extend(f"temporal_scope:{item.value}" for item in matched)
            tier += 4
            if set(frame.temporal_scopes).issubset(concrete):
                tier += 1
        elif concrete:
            contradictions.extend(f"temporal_scope:{item.value}" for item in concrete)

    if frame.result_shapes:
        matched = tuple(item for item in frame.result_shapes if item in routing.result_shapes)
        if matched:
            hard_matches.extend(f"result_shape:{item.value}" for item in matched)
            tier += 2
        else:
            contradictions.extend(f"result_shape:{item.value}" for item in routing.result_shapes)

    if (
        frame.execution is ExecutionKind.ORDER
        and Measure.CREDIT in routing.measures
        and Measure.CREDIT not in frame.measures
    ):
        contradictions.append("measure:credit")

    if contradictions:
        return EligibilityResult(False, -1, tuple(dict.fromkeys(contradictions)), ())

    contributions: list[ScoreContribution] = []
    if hard_matches:
        contributions.append(
            _contribution(ReasonCode.TYPED_ELIGIBLE, tuple(dict.fromkeys(hard_matches)))
        )

    concrete_measures = tuple(item for item in routing.measures if item is not Measure.GENERIC)
    if (
        frame.execution is ExecutionKind.WEBSOCKET
        and frame.measures
        and concrete_measures
        and not set(frame.measures).intersection(concrete_measures)
    ):
        return EligibilityResult(
            False,
            -1,
            tuple(f"measure:{item.value}" for item in concrete_measures),
            (),
        )
    measure_matches = tuple(item for item in frame.measures if item in concrete_measures)
    if measure_matches:
        if (
            frame.execution is ExecutionKind.WEBSOCKET
            and set(frame.measures).issubset(concrete_measures)
        ):
            tier += 1
        contributions.append(
            _contribution(
                ReasonCode.TYPED_MEASURE_MATCH,
                tuple(f"measure:{item.value}" for item in measure_matches),
                points=len(measure_matches),
            )
        )

    binding_matches = tuple(item for item in frame.bindings if item in routing.bindings)
    if binding_matches:
        contributions.append(
            _contribution(
                ReasonCode.TYPED_BINDING_MATCH,
                tuple(f"binding:{item.value}" for item in binding_matches),
                points=len(binding_matches),
            )
        )

    return EligibilityResult(True, tier, (), tuple(contributions))
