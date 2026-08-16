# ruff: noqa: E501
"""Render the per-card facts that the 화면기획서 Paper artboards display.

The Paper artboards for the Kiwoom common-screen cards (`AT-CV-005`) show
counts, dimensions and representative mappings. Typing those numbers by hand
into a design file makes them unverifiable and lets them drift away from
`ref/kiwoom-common-screen-manifest.json`. This generator derives every number
the artboards show, deterministically, into
`ref/kiwoom-common-screen-card-facts.json`, so the artboard content can be
checked against the manifest instead of trusted.

    python backend/scripts/render_screen_card_facts.py

Run with `--check` to verify the committed file is current without writing it.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

from render_screen_injection_map import (  # noqa: E402
    MANIFEST_PATH,
    layout_categories,
    load_manifest,
    mapping_display_name,
)

REPO_ROOT = BACKEND.parent
OUTPUT_PATH = BACKEND / "ref" / "kiwoom-common-screen-card-facts.json"

# Card display names, keyed by manifest layout. Not invented: these are the six
# card names fixed by plan/kiwoom-common-screen-spec.md §3.
CARD_NAMES = {
    "facts": "FactsCard",
    "table": "TableCard",
    "compound": "CompoundCard",
    "event": "EventCard",
    "action": "ActionCard",
    "status": "StatusCard",
}

# The dimension that drives each card's layout, used to pick representatives
# deterministically (largest / median / smallest by this dimension).
DRIVING_DIMENSION = {
    "facts": "response_top_level",
    "table": "response_columns",
    "compound": "response_columns",
    "event": "response_columns",
    "action": "request_top_level",
    "status": "response_top_level",
}

# Screen ID carried over from plan/kiwoom-common-screen-spec.md §10. Its origin
# is unresolved (spec §11-5); this generator does not mint a new one.
SCREEN_ID = "AT-CV-005"

CARD_ORDER = ["facts", "table", "compound", "event", "action", "status"]


def request_top_level(mapping: dict[str, Any]) -> int:
    return len(mapping["fields"]["request"]["top_level"])


def request_containers(mapping: dict[str, Any]) -> int:
    return len(mapping["fields"]["request"]["data"])


def response_top_level(mapping: dict[str, Any]) -> int:
    return len(mapping["fields"]["response"]["top_level"])


def response_containers(mapping: dict[str, Any]) -> int:
    return len(mapping["fields"]["response"]["data"])


def response_columns(mapping: dict[str, Any]) -> int:
    return sum(len(container["field_aliases"]) for container in mapping["fields"]["response"]["data"])


DIMENSIONS = {
    "request_top_level": request_top_level,
    "request_containers": request_containers,
    "response_top_level": response_top_level,
    "response_containers": response_containers,
    "response_columns": response_columns,
}


def percentile(sorted_values: list[int], fraction: float) -> int:
    """Nearest-rank percentile. Deterministic and always an observed value."""
    if not sorted_values:
        raise ValueError("percentile of an empty sequence")
    rank = max(1, math.ceil(fraction * len(sorted_values)))
    return sorted_values[rank - 1]


def distribution(values: list[int]) -> dict[str, int]:
    ordered = sorted(values)
    return {
        "min": ordered[0],
        "median": percentile(ordered, 0.5),
        "p90": percentile(ordered, 0.9),
        "max": ordered[-1],
    }


def mapping_facts(mapping: dict[str, Any]) -> dict[str, Any]:
    route = mapping["route"]
    return {
        "mapping_id": mapping["mapping_id"],
        "tr_id": mapping["operation"]["tr_id"],
        "domain": mapping["operation"]["domain"],
        "name": mapping_display_name(mapping),
        "route": f"{route['method']} {route['path']}",
        "operation_id": route["operation_id"],
        "request_top_level": request_top_level(mapping),
        "request_containers": request_containers(mapping),
        "response_top_level": response_top_level(mapping),
        "response_containers": response_containers(mapping),
        "response_columns": response_columns(mapping),
    }


def sample_field_aliases(mapping: dict[str, Any], limit: int) -> dict[str, list[str]]:
    """Real alias names from the manifest, for artboard mockup content.

    Truncated to `limit` so the facts file stays readable; the truncation is
    reported so an artboard never implies it is showing the full set.
    """
    response = mapping["fields"]["response"]
    containers = response["data"]
    column_aliases = containers[0]["field_aliases"] if containers else []
    return {
        "response_top_level": response["top_level"][:limit],
        "response_top_level_truncated": len(response["top_level"]) > limit,
        "request_top_level": mapping["fields"]["request"]["top_level"][:limit],
        "request_top_level_truncated": len(mapping["fields"]["request"]["top_level"]) > limit,
        "first_container_alias": containers[0]["container_alias"] if containers else None,
        "first_container_columns": column_aliases[:limit],
        "first_container_columns_truncated": len(column_aliases) > limit,
    }


def pick_representatives(mappings: list[dict[str, Any]], dimension: str) -> list[dict[str, Any]]:
    """Largest, median and smallest mapping by the card's driving dimension.

    Deterministic: ties break on mapping_id. Three points, not a curated
    selection, so the artboard shows the real range instead of a flattering
    example.
    """
    measure = DIMENSIONS[dimension]
    ordered = sorted(mappings, key=lambda mapping: (measure(mapping), mapping["mapping_id"]))
    indices = [len(ordered) - 1, len(ordered) // 2, 0]
    roles = ["max", "median", "min"]
    picked: list[dict[str, Any]] = []
    seen: set[str] = set()
    for role, index in zip(roles, indices, strict=True):
        mapping = ordered[index]
        if mapping["mapping_id"] in seen:
            continue
        seen.add(mapping["mapping_id"])
        entry = mapping_facts(mapping)
        entry["role"] = role
        entry["driving_dimension"] = dimension
        entry["driving_value"] = measure(mapping)
        entry["sample_aliases"] = sample_field_aliases(mapping, limit=12)
        picked.append(entry)
    return picked


def domain_breakdown(mappings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for mapping in mappings:
        domain = mapping["operation"]["domain"]
        counts[domain] = counts.get(domain, 0) + 1
    return [
        {"domain": domain, "count": counts[domain]}
        for domain in sorted(counts, key=lambda name: (-counts[name], name))
    ]


def extreme(mappings: list[dict[str, Any]], dimension: str) -> dict[str, Any]:
    measure = DIMENSIONS[dimension]
    mapping = max(mappings, key=lambda entry: (measure(entry), entry["mapping_id"]))
    return {"mapping_id": mapping["mapping_id"], "value": measure(mapping)}


def card_entry(
    layout: str,
    category: str,
    mappings: list[dict[str, Any]],
    total: int,
) -> dict[str, Any]:
    count = len(mappings)
    return {
        "card": CARD_NAMES[layout],
        "screen_id": SCREEN_ID,
        "layout": layout,
        "category": category,
        "mappings": count,
        "share_pct": round(100.0 * count / total, 1),
        "domains": domain_breakdown(mappings),
        "dimensions": {name: distribution([fn(m) for m in mappings]) for name, fn in DIMENSIONS.items()},
        "extremes": {name: extreme(mappings, name) for name in DIMENSIONS},
        "representatives": pick_representatives(mappings, DRIVING_DIMENSION[layout]),
    }


def alias_frequency(mappings: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """How often each response alias occurs across mappings.

    Backs the "five cell primitives, not 301 renderers" claim in
    plan/kiwoom-common-screen-spec.md §4: an alias is counted once per mapping
    it appears in, whether at top level or inside a container.
    """
    counts: dict[str, int] = {}
    for mapping in mappings:
        response = mapping["fields"]["response"]
        aliases = set(response["top_level"])
        for container in response["data"]:
            aliases.update(container["field_aliases"])
        for alias in aliases:
            counts[alias] = counts.get(alias, 0) + 1
    ordered = sorted(counts, key=lambda alias: (-counts[alias], alias))[:limit]
    return [{"alias": alias, "mappings": counts[alias]} for alias in ordered]


def domain_matrix(mappings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Domain x card counts: which API family lands on which card."""
    per_domain: dict[str, dict[str, int]] = {}
    for mapping in mappings:
        domain = mapping["operation"]["domain"]
        layout = mapping["presentation"]["layout"]
        per_domain.setdefault(domain, {})[layout] = per_domain.setdefault(domain, {}).get(layout, 0) + 1
    rows: list[dict[str, Any]] = []
    for domain in sorted(per_domain, key=lambda name: (-sum(per_domain[name].values()), name)):
        counts = per_domain[domain]
        rows.append(
            {
                "domain": domain,
                "total": sum(counts.values()),
                "by_card": {CARD_NAMES[layout]: counts.get(layout, 0) for layout in CARD_ORDER},
            }
        )
    return rows


def build(manifest: dict[str, Any]) -> dict[str, Any]:
    mappings = manifest["mappings"]
    total = len(mappings)
    layout_category = layout_categories(mappings)
    if set(layout_category) != set(CARD_NAMES):
        raise ValueError(f"manifest layouts {sorted(layout_category)} do not match the six known cards")

    by_layout: dict[str, list[dict[str, Any]]] = {layout: [] for layout in CARD_ORDER}
    for mapping in mappings:
        by_layout[mapping["presentation"]["layout"]].append(mapping)

    cards = [
        card_entry(layout, layout_category[layout], by_layout[layout], total)
        for layout in sorted(CARD_ORDER, key=lambda name: (-len(by_layout[name]), name))
    ]
    if sum(card["mappings"] for card in cards) != total:
        raise ValueError("cards do not partition the manifest mappings")

    return {
        "version": 1,
        "description": (
            "Per-card facts for the Kiwoom common-screen artboards of the 화면기획서. "
            "Generated from ref/kiwoom-common-screen-manifest.json; do not edit by hand."
        ),
        "generator": "backend/scripts/render_screen_card_facts.py",
        "source_manifest": "backend/ref/kiwoom-common-screen-manifest.json",
        "screen_id": SCREEN_ID,
        "totals": {
            "routable": total,
            "base_operations": manifest["counts"]["base_operations"],
            "unsplit_base": manifest["counts"]["unsplit_base"],
            "split_derived": manifest["counts"]["split_derived"],
            "excluded_split_originals": manifest["counts"]["excluded_split_originals"],
            "categories": manifest["counts"]["categories"],
        },
        "cards": cards,
        "cell_primitive_evidence": alias_frequency(mappings, limit=20),
        "domain_matrix": domain_matrix(mappings),
    }


def serialize(facts: dict[str, Any]) -> str:
    return json.dumps(facts, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest()
    content = serialize(build(manifest))
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != content:
            print(f"Generated screen card facts are stale: {OUTPUT_PATH.relative_to(REPO_ROOT)}")
            return 1
        print("Generated screen card facts are current")
        return 0
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content, encoding="utf-8", newline="\n")
    print(f"Generated card facts for {len(manifest['mappings'])} mappings to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    print(f"Manifest read from {MANIFEST_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
