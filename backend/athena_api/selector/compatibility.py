"""Tri-state shadow proof between query evidence and exact operation profiles."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum

from athena_api.generated.registry import ROUTING_EQUIVALENCE_GROUPS
from athena_api.routing_contract import (
    ActionKind,
    BindingRole,
    CapabilityKind,
    EntityKind,
    ExecutionKind,
    OperationRouting,
    RoutingResultShape,
)

from .catalog import OperationCatalog, OperationDocument
from .instrument_identity import TargetResolution
from .primitive_evidence import (
    Delivery,
    EntityCardinality,
    Ownership,
    QueryAnalysis,
    SpeechAct,
    TargetPresence,
    TargetResolver,
    analyze_question,
)
from .schemas import DiscoveryIntent


class CompatibilityStatus(StrEnum):
    MATCH = "match"
    CONTRADICTION = "contradiction"
    INSUFFICIENT = "insufficient"


class CompatibilityDecisionStatus(StrEnum):
    SELECTED = "selected"
    DETAIL_GROUP_REQUIRED = "detail_group_required"
    AMBIGUOUS = "ambiguous"
    REJECTED = "rejected"


class CompatibilityConfidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass(frozen=True, slots=True)
class OperationProfile:
    """Exact base or detail identity plus its authoritative routing profile."""

    operation_ref: str
    family_ref: str
    routing: OperationRouting
    generic_callable: bool
    requires_instrument_target: bool = False

    @classmethod
    def from_document(cls, document: OperationDocument) -> OperationProfile:
        required_aliases = {
            field.alias or name
            for name, field in document.request_model.model_fields.items()
            if field.is_required()
        }
        return cls(
            operation_ref=document.operation_ref,
            family_ref=document.family_ref,
            routing=document.routing,
            generic_callable=document.generic_callable,
            requires_instrument_target=(
                BindingRole.INSTRUMENT_CODE in document.routing.bindings
                and "stk_cd" in required_aliases
                and not (
                    BindingRole.ORDER_ID in document.routing.bindings
                    and set(document.routing.actions).intersection(
                        {ActionKind.AMEND, ActionKind.CANCEL}
                    )
                )
            ),
        )


@dataclass(frozen=True, slots=True)
class CompatibilityProof:
    status: CompatibilityStatus
    operation_ref: str
    matched: tuple[str, ...]
    contradictions: tuple[str, ...]
    missing: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DominanceEdge:
    dominating_operation_ref: str
    dominated_operation_ref: str


@dataclass(frozen=True, slots=True)
class EquivalenceCollapse:
    group_id: str
    canonical_operation_ref: str
    member_operation_refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CompatibilityDecision:
    """Unique exact-profile result; ambiguity and absence both abstain."""

    status: CompatibilityDecisionStatus
    selected_family_ref: str | None
    selected_operation_ref: str | None
    compatible_operation_refs: tuple[str, ...]
    proofs: tuple[CompatibilityProof, ...]
    dominance_edges: tuple[DominanceEdge, ...]
    equivalence_collapses: tuple[EquivalenceCollapse, ...]
    confidence: CompatibilityConfidence
    reason_codes: tuple[str, ...]


_PRODUCTS = frozenset(
    {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD, EntityKind.SECTOR_INDEX}
)
def _conjunctive_axis(
    axis: str,
    requested: tuple[StrEnum, ...],
    offered: tuple[StrEnum, ...],
    matched: list[str],
    contradictions: list[str],
) -> None:
    concrete = tuple(item for item in requested if item.value not in {"generic", "unspecified"})
    missing = tuple(item for item in concrete if item not in offered)
    if missing:
        contradictions.extend(f"{axis}:{item.value}" for item in missing)
    else:
        matched.extend(f"{axis}:{item.value}" for item in concrete)


def prove_compatibility(
    analysis: QueryAnalysis,
    operation: OperationDocument | OperationProfile,
) -> CompatibilityProof:
    """Prove all explicit constraints against one exact operation identity.

    This function is shadow-only: it does not rank, select, or mint a plan.
    """
    profile = (
        operation
        if isinstance(operation, OperationProfile)
        else OperationProfile.from_document(operation)
    )
    routing = profile.routing
    matched: list[str] = []
    contradictions: list[str] = []
    missing: list[str] = []

    if analysis.speech_act is SpeechAct.ADVICE:
        contradictions.append("speech_act:advice")
    if analysis.capabilities and set(analysis.entity_kinds).intersection(
        {EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
    ):
        contradictions.extend(
            f"capability:{capability.value}"
            for capability in analysis.capabilities
            if capability
            in {
                CapabilityKind.EQUITY_CORPORATE_FUNDAMENTALS,
                CapabilityKind.EQUITY_VALUATION,
            }
        )
    if analysis.ownership is Ownership.THIRD_PARTY and EntityKind.ACCOUNT in routing.entity_kinds:
        contradictions.append("ownership:third_party")
    if (
        analysis.entity_cardinality is EntityCardinality.MULTIPLE
        and BindingRole.INSTRUMENT_CODE in routing.bindings
    ):
        contradictions.append("entity_cardinality:multiple")

    if analysis.execution is not None:
        if analysis.execution is routing.execution:
            matched.append(f"execution:{analysis.execution.value}")
        else:
            contradictions.append(f"execution:{analysis.execution.value}")
    if analysis.subject is not None:
        if analysis.subject is routing.subject:
            matched.append(f"subject:{analysis.subject.value}")
        else:
            contradictions.append(f"subject:{analysis.subject.value}")

    requested_products = set(analysis.entity_kinds).intersection(_PRODUCTS)
    offered_products = set(routing.entity_kinds).intersection(_PRODUCTS)
    if requested_products:
        product_matches = requested_products.intersection(offered_products)
        product_missing = requested_products - offered_products
        matched.extend(
            f"entity_kind:{item.value}"
            for item in sorted(product_matches, key=lambda item: item.value)
        )
        contradictions.extend(
            f"entity_kind:{item.value}"
            for item in sorted(product_missing, key=lambda item: item.value)
        )
    elif set(analysis.entity_kinds).intersection(routing.entity_kinds):
        matched.append("entity_kind:role")

    _conjunctive_axis(
        "data_intent", analysis.data_intents, routing.data_intents, matched, contradictions
    )
    _conjunctive_axis(
        "temporal_scope",
        analysis.temporal_scopes,
        routing.temporal_scopes,
        matched,
        contradictions,
    )
    _conjunctive_axis(
        "measure", analysis.measures, routing.measures, matched, contradictions
    )
    _conjunctive_axis(
        "result_shape",
        analysis.result_shapes,
        routing.result_shapes,
        matched,
        contradictions,
    )

    if analysis.action_kind is not None:
        if analysis.action_kind in routing.actions:
            matched.append(f"action_kind:{analysis.action_kind.value}")
        else:
            contradictions.append(f"action_kind:{analysis.action_kind.value}")
    _conjunctive_axis(
        "financing", analysis.financing, routing.financing, matched, contradictions
    )
    _conjunctive_axis(
        "capability", analysis.capabilities, routing.capabilities, matched, contradictions
    )
    _conjunctive_axis("feed", analysis.feeds, routing.feeds, matched, contradictions)
    if analysis.delivery is Delivery.STREAM:
        if (
            routing.execution is ExecutionKind.WEBSOCKET
            and RoutingResultShape.STREAM in routing.result_shapes
        ):
            matched.append("delivery:stream")
        else:
            contradictions.append("delivery:stream")

    target_proof = analysis.target_scope_present
    capability_proof = any(
        item.startswith(
            (
                "data_intent:",
                "temporal_scope:",
                "measure:",
                "result_shape:",
                "action_kind:",
                "financing:",
                "capability:",
                "feed:",
                "delivery:",
            )
        )
        for item in matched
    )
    if not target_proof:
        missing.append("target")
    if (
        profile.requires_instrument_target
        and analysis.target_presence is not TargetPresence.PRESENT
    ):
        missing.append("target_anchor")
    if not capability_proof:
        missing.append("capability")
    status = (
        CompatibilityStatus.CONTRADICTION
        if contradictions
        else CompatibilityStatus.MATCH
        if not missing
        else CompatibilityStatus.INSUFFICIENT
    )
    return CompatibilityProof(
        status=status,
        operation_ref=profile.operation_ref,
        matched=tuple(dict.fromkeys(matched)),
        contradictions=tuple(dict.fromkeys(contradictions)),
        missing=tuple(missing),
    )


def decide_compatibility(
    analysis: QueryAnalysis,
    operations: Iterable[OperationDocument | OperationProfile],
) -> CompatibilityDecision:
    """Return one exact callable profile or abstain without lexical tie-breaking."""
    raw_profiles = tuple(
        item if isinstance(item, OperationProfile) else OperationProfile.from_document(item)
        for item in operations
    )
    profile_by_ref: dict[str, OperationProfile] = {}
    for profile in raw_profiles:
        existing = profile_by_ref.get(profile.operation_ref)
        if existing is not None and existing != profile:
            raise ValueError(
                f"conflicting operation profiles for {profile.operation_ref}"
            )
        profile_by_ref[profile.operation_ref] = profile
    profiles = tuple(profile_by_ref[ref] for ref in sorted(profile_by_ref))
    proofs = tuple(
        prove_compatibility(analysis, profile)
        for profile in profiles
        if profile.generic_callable
    )
    compatible_proofs = tuple(
        proof for proof in proofs if proof.status is CompatibilityStatus.MATCH
    )
    def active_surplus(
        proof: CompatibilityProof, *, family_stage: bool = False
    ) -> tuple[frozenset[StrEnum], ...]:
        """Compare breadth only on axes explicitly constrained by this query."""
        routing = profile_by_ref[proof.operation_ref].routing
        requested_products = tuple(
            item for item in analysis.entity_kinds if item in _PRODUCTS
        )
        offered_products = tuple(
            item for item in routing.entity_kinds if item in _PRODUCTS
        )
        requested_axes: tuple[tuple[StrEnum, ...], tuple[StrEnum, ...]] = (
            (requested_products, offered_products),
            (analysis.data_intents, routing.data_intents),
            (analysis.temporal_scopes, routing.temporal_scopes),
            (analysis.result_shapes, routing.result_shapes),
            (analysis.financing, routing.financing),
            (analysis.feeds, routing.feeds),
            (
                (analysis.action_kind,) if analysis.action_kind is not None else (),
                routing.actions,
            ),
        )
        if not family_stage:
            requested_axes = (
                *requested_axes[:3],
                requested_axes[3],
                (analysis.capabilities, routing.capabilities),
                *requested_axes[4:],
            )
        return tuple(
            frozenset(
                item for item in offered if item.value not in {"generic", "unspecified"}
            )
            - {
                item
                for item in requested
                if item.value not in {"generic", "unspecified"}
            }
            for requested, offered in requested_axes
            if any(item.value not in {"generic", "unspecified"} for item in requested)
        )

    def dominates_on_active_axes(
        left: CompatibilityProof,
        right: CompatibilityProof,
        *,
        family_stage: bool = False,
    ) -> bool:
        left_surplus = active_surplus(left, family_stage=family_stage)
        right_surplus = active_surplus(right, family_stage=family_stage)
        return bool(left_surplus) and all(
            left_axis.issubset(right_axis)
            for left_axis, right_axis in zip(left_surplus, right_surplus, strict=True)
        ) and any(
            left_axis != right_axis
            for left_axis, right_axis in zip(
                left_surplus, right_surplus, strict=True
            )
        )

    compatible_refs = {proof.operation_ref for proof in compatible_proofs}
    equivalence_collapses: list[EquivalenceCollapse] = []
    for group_id, group in sorted(ROUTING_EQUIVALENCE_GROUPS.items()):
        members = compatible_refs.intersection(group["members"])
        if len(members) < 2:
            continue
        canonical_ref = group["canonical_ref"]
        if canonical_ref not in members:
            raise ValueError(
                "compatible equivalence members do not include their canonical ref"
            )
        compatible_refs.difference_update(members)
        compatible_refs.add(canonical_ref)
        equivalence_collapses.append(
            EquivalenceCollapse(
                group_id=group_id,
                canonical_operation_ref=canonical_ref,
                member_operation_refs=tuple(sorted(members)),
            )
        )
    compatible_families = {
        profile_by_ref[operation_ref].family_ref for operation_ref in compatible_refs
    }
    # Family authority is established before exact-child specificity. A detail's
    # narrower profile may refine a family already selected, but it cannot defeat
    # another family whose own exact profile also satisfies every explicit axis.
    # Reviewed cross-family equivalence is the sole pre-family collapse above.
    family_dominance_edges: tuple[DominanceEdge, ...] = ()
    if len(compatible_families) > 1:
        proofs_by_family = {
            family_ref: tuple(
                proof
                for proof in compatible_proofs
                if proof.operation_ref in compatible_refs
                and profile_by_ref[proof.operation_ref].family_ref == family_ref
            )
            for family_ref in compatible_families
        }

        def family_frontier(
            family_proofs: tuple[CompatibilityProof, ...],
        ) -> tuple[CompatibilityProof, ...]:
            return tuple(
                proof
                for proof in family_proofs
                if not any(
                    other.operation_ref != proof.operation_ref
                    and dominates_on_active_axes(
                        other, proof, family_stage=True
                    )
                    for other in family_proofs
                )
            )

        frontiers = {
            family_ref: family_frontier(family_proofs)
            for family_ref, family_proofs in proofs_by_family.items()
        }
        winning_pairs: list[tuple[CompatibilityProof, CompatibilityProof]] = []
        for left_family, left_frontier in frontiers.items():
            for right_family, right_frontier in frontiers.items():
                if left_family == right_family:
                    continue
                covering_pairs = tuple(
                    (left, right)
                    for right in right_frontier
                    for left in left_frontier
                    if dominates_on_active_axes(left, right, family_stage=True)
                )
                if right_frontier and all(
                    any(pair[1] == right for pair in covering_pairs)
                    for right in right_frontier
                ):
                    winning_pairs.extend(covering_pairs)
        family_dominance_edges = tuple(
            sorted(
                {
                    DominanceEdge(left.operation_ref, right.operation_ref)
                    for left, right in winning_pairs
                },
                key=lambda edge: (
                    edge.dominating_operation_ref,
                    edge.dominated_operation_ref,
                ),
            )
        )
        dominated_families = {
            profile_by_ref[edge.dominated_operation_ref].family_ref
            for edge in family_dominance_edges
        }
        compatible_refs = {
            operation_ref
            for operation_ref in compatible_refs
            if profile_by_ref[operation_ref].family_ref not in dominated_families
        }
        compatible_families = {
            profile_by_ref[operation_ref].family_ref
            for operation_ref in compatible_refs
        }
    if len(compatible_families) > 1:
        return CompatibilityDecision(
            status=CompatibilityDecisionStatus.AMBIGUOUS,
            selected_family_ref=None,
            selected_operation_ref=None,
            compatible_operation_refs=tuple(sorted(compatible_refs)),
            proofs=proofs,
            dominance_edges=family_dominance_edges,
            equivalence_collapses=tuple(equivalence_collapses),
            confidence=CompatibilityConfidence.LOW,
            reason_codes=("AMBIGUOUS",),
        )

    local_proofs = tuple(
        proof for proof in compatible_proofs if proof.operation_ref in compatible_refs
    )
    local_dominance_edges = tuple(
        sorted(
            (
                DominanceEdge(other.operation_ref, proof.operation_ref)
                for proof in local_proofs
                for other in local_proofs
                if other.operation_ref != proof.operation_ref
                and dominates_on_active_axes(other, proof)
            ),
            key=lambda edge: (
                edge.dominating_operation_ref,
                edge.dominated_operation_ref,
            ),
        )
    )
    dominance_edges = (*family_dominance_edges, *local_dominance_edges)
    dominated_refs = {
        edge.dominated_operation_ref for edge in local_dominance_edges
    }
    compatible = tuple(sorted(compatible_refs - dominated_refs))
    compatible_families = {
        profile_by_ref[operation_ref].family_ref for operation_ref in compatible
    }
    if len(compatible_families) == 1 and len(compatible) == 1:
        selected_family_ref = next(iter(compatible_families))
        return CompatibilityDecision(
            status=CompatibilityDecisionStatus.SELECTED,
            selected_family_ref=selected_family_ref,
            selected_operation_ref=compatible[0],
            compatible_operation_refs=compatible,
            proofs=proofs,
            dominance_edges=dominance_edges,
            equivalence_collapses=tuple(equivalence_collapses),
            confidence=(
                CompatibilityConfidence.MEDIUM
                if dominance_edges or equivalence_collapses
                else CompatibilityConfidence.HIGH
            ),
            reason_codes=(
                (("TYPED_DOMINANCE",) if dominance_edges else ())
                + (("EQUIVALENCE_CANONICAL",) if equivalence_collapses else ())
                + ("UNIQUE_EXACT_PROFILE",)
            ),
        )
    if len(compatible_families) == 1:
        return CompatibilityDecision(
            status=CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED,
            selected_family_ref=next(iter(compatible_families)),
            selected_operation_ref=None,
            compatible_operation_refs=compatible,
            proofs=proofs,
            dominance_edges=dominance_edges,
            equivalence_collapses=tuple(equivalence_collapses),
            confidence=CompatibilityConfidence.LOW,
            reason_codes=("DETAIL_GROUP_REQUIRED",),
        )
    return CompatibilityDecision(
        status=(
            CompatibilityDecisionStatus.AMBIGUOUS
            if compatible
            else CompatibilityDecisionStatus.REJECTED
        ),
        selected_family_ref=None,
        selected_operation_ref=None,
        compatible_operation_refs=compatible,
        proofs=proofs,
        dominance_edges=dominance_edges,
        equivalence_collapses=tuple(equivalence_collapses),
        confidence=CompatibilityConfidence.LOW,
        reason_codes=("AMBIGUOUS",) if compatible else ("NO_COMPATIBLE_PROFILE",),
    )


def decide_selector_compatibility(
    catalog: OperationCatalog,
    question: str,
    intent: DiscoveryIntent,
    *,
    bound_argument_roles: tuple[BindingRole, ...] = (),
    target_resolution: TargetResolution | None = None,
    target_resolver: TargetResolver | None = None,
) -> CompatibilityDecision:
    """Apply the transport-neutral typed policy over the requested visible surface."""
    allowed_kinds = (
        {"query"}
        if intent in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}
        else {"order"}
        if intent is DiscoveryIntent.ORDER
        else {"websocket"}
    )
    operations = tuple(
        document
        for document in catalog.documents
        if document.kind in allowed_kinds and document.visibility != "hidden"
    )
    # Operation identity is authoritative only through the exact service fast path.
    # An operation-like token embedded in natural language must never fall through
    # to semantic selection, including longer-prefix/suffix near misses.
    if re.search(
        r"(?i)(?<![0-9a-z])[0-9a-z]*(?:ka|kt|au)\d+[0-9a-z]*(?![0-9a-z])",
        question,
    ):
        return decide_compatibility(analyze_question(question), ())
    return decide_compatibility(
        analyze_question(
            question,
            bound_argument_roles=bound_argument_roles,
            target_resolution=target_resolution,
            target_resolver=target_resolver,
        ),
        operations,
    )
