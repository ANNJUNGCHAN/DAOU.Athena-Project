# ruff: noqa: E501
"""Render the Kiwoom common-screen API injection appendix.

Deterministically renders `ref/kiwoom-common-screen-manifest.json` into the
Markdown injection appendix at `plan/kiwoom-common-screen-injection-map.md` for
the 화면기획서 (screen planning document): which API feeds which common screen
card. Run from any working directory with:

    python backend/scripts/render_screen_injection_map.py

Run with `--check` to verify the committed file is current without writing it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from athena_api.generated.registry import DETAIL_REGISTRY, TR_REGISTRY  # noqa: E402

REPO_ROOT = BACKEND.parent
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
OUTPUT_PATH = REPO_ROOT / "plan" / "kiwoom-common-screen-injection-map.md"


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def escape_cell(value: str) -> str:
    """Escape a value for safe embedding in a Markdown table cell."""
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def layout_categories(mappings: list[dict[str, Any]]) -> dict[str, str]:
    """Derive the layout -> category mapping from the manifest.

    This is a many-to-one function (facts/table/compound all fall under
    read_display); it is only required that each layout maps to exactly one
    category, so a card never has to serve two safety classes at once.
    """
    categories_by_layout: dict[str, set[str]] = {}
    for mapping in mappings:
        layout = mapping["presentation"]["layout"]
        categories_by_layout.setdefault(layout, set()).add(mapping["classification"]["category"])
    for layout, categories in categories_by_layout.items():
        if len(categories) != 1:
            raise ValueError(f"Layout {layout!r} maps to more than one category: {categories}")
    return {layout: next(iter(categories)) for layout, categories in categories_by_layout.items()}


def mapping_counts_by_layout(mappings: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for mapping in mappings:
        layout = mapping["presentation"]["layout"]
        counts[layout] = counts.get(layout, 0) + 1
    return counts


def tr_korean_name(tr_id: str) -> str | None:
    spec = TR_REGISTRY.get(tr_id)
    return spec.name if spec is not None else None


def mapping_display_name(mapping: dict[str, Any]) -> str:
    """Look up the Korean operation name from the generated registry.

    Never invented: base mappings use `TR_REGISTRY[tr].name`; split-derived
    mappings use the detail's `title_ko`, falling back to `title_en` then the
    group id, and also show the parent TR name. Missing names render `—`
    explicitly rather than being silently omitted.
    """
    tr_id = mapping["operation"]["tr_id"]
    parent_name = tr_korean_name(tr_id)
    if mapping["mapping_type"] == "base":
        return escape_cell(parent_name) if parent_name else "—"
    detail = DETAIL_REGISTRY.get(mapping["mapping_id"])
    if detail is None:
        return "—"
    detail_name = detail.title_ko or detail.title_en or detail.group_id
    parent = parent_name or "—"
    return f"{escape_cell(detail_name)} ({escape_cell(parent)})"


def request_field_cell(mapping: dict[str, Any]) -> str:
    request = mapping["fields"]["request"]
    count = len(request["top_level"])
    if request["data"]:
        return f"{count} (+{len(request['data'])})"
    return str(count)


def response_field_cell(mapping: dict[str, Any]) -> str:
    return str(len(mapping["fields"]["response"]["top_level"]))


def response_container_cells(mapping: dict[str, Any]) -> tuple[str, str]:
    data = mapping["fields"]["response"]["data"]
    if not data:
        return "—", "—"
    total_columns = sum(len(container["field_aliases"]) for container in data)
    return str(len(data)), str(total_columns)


def default_control_cell(mapping: dict[str, Any]) -> str:
    """"기본 제어값" 열(P2a/P2b) — `presentation.controls.default_period`.

    세 상태를 구분해서 보여준다: `controls` 자체가 없는 289개 비차트 TR은 `—`,
    분/틱 4TR(P2b, 의도적 비배선)은 `controls.default_period`가 `null`이라
    `—(비배선)`, 일/주/월/년봉 8TR(P2a)은 실제 값(`` `D` ``/`` `W` ``/`` `M` ``/`` `Y` ``).
    빈칸 하나로 뭉개면 "누락"과 "의도적 비배선"이 문서에서 구분되지 않는다
    (CLAUDE.md §4 정직 기록)."""
    controls = mapping["presentation"].get("controls")
    if controls is None:
        return "—"
    period = controls.get("default_period")
    return f"`{period}`" if period else "—(비배선)"


def mapping_row(mapping: dict[str, Any]) -> str:
    operation = mapping["operation"]
    route = mapping["route"]
    resp_containers, resp_columns = response_container_cells(mapping)
    cells = [
        f"`{mapping['mapping_id']}`",
        f"`{operation['tr_id']}`",
        mapping_display_name(mapping),
        f"`{route['method']} {escape_cell(route['path'])}`",
        f"`{route['operation_id']}`",
        request_field_cell(mapping),
        response_field_cell(mapping),
        resp_containers,
        resp_columns,
        default_control_cell(mapping),
    ]
    return "| " + " | ".join(cells) + " |"


def render_summary_table(
    mappings: list[dict[str, Any]],
    layout_category: dict[str, str],
    layout_counts: dict[str, int],
) -> list[str]:
    total = len(mappings)
    lines = [
        "| Card | Layout | Category | Mappings | Share of total |",
        "| --- | --- | --- | ---: | ---: |",
    ]
    for layout in sorted(layout_counts, key=lambda name: (-layout_counts[name], name)):
        count = layout_counts[layout]
        share = 100.0 * count / total
        lines.append(
            f"| {layout.capitalize()} | `{layout}` | `{layout_category[layout]}` | "
            f"{count} | {share:.1f}% |"
        )
    return lines


def render_layout_section(
    layout: str,
    category: str,
    mappings: list[dict[str, Any]],
) -> list[str]:
    lines = [f"## {layout.capitalize()} (`{layout}` / `{category}`)", ""]
    domains = sorted({mapping["operation"]["domain"] for mapping in mappings})
    for domain in domains:
        domain_mappings = sorted(
            (mapping for mapping in mappings if mapping["operation"]["domain"] == domain),
            key=lambda mapping: mapping["mapping_id"],
        )
        lines.append(f"### {domain}")
        lines.append("")
        lines.append(
            "| Mapping ID | TR | Name | Route | Operation ID | Req fields | Resp fields | "
            "Resp containers | Resp columns | Default control |"
        )
        lines.append("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |")
        for mapping in domain_mappings:
            lines.append(mapping_row(mapping))
        lines.append("")
    return lines


def render_exclusions_section(manifest: dict[str, Any]) -> list[str]:
    exclusions = sorted(manifest["exclusions"], key=lambda entry: entry["tr_id"])
    lines = [
        "## Excluded split originals",
        "",
        "These base operations were split into the `split_derived` detail mappings",
        "above and are not themselves routable; they are listed here so this appendix",
        f"accounts for the whole {manifest['counts']['base_operations']}-operation surface, not just the "
        f"{manifest['counts']['routable']} routable mappings.",
        "",
        "| TR | Name | Route | Reason | Replacement mapping IDs |",
        "| --- | --- | --- | --- | --- |",
    ]
    for exclusion in exclusions:
        tr_id = exclusion["tr_id"]
        name = tr_korean_name(tr_id)
        name_cell = escape_cell(name) if name else "—"
        route = exclusion["route"]
        replacements = ", ".join(f"`{mapping_id}`" for mapping_id in exclusion["replacement_mapping_ids"])
        lines.append(
            f"| `{tr_id}` | {name_cell} | `{route['method']} {escape_cell(route['path'])}` | "
            f"`{exclusion['reason']}` | {replacements} |"
        )
    return lines


def render(manifest: dict[str, Any]) -> str:
    mappings = manifest["mappings"]
    layout_category = layout_categories(mappings)
    layout_counts = mapping_counts_by_layout(mappings)
    mappings_by_layout: dict[str, list[dict[str, Any]]] = {}
    for mapping in mappings:
        mappings_by_layout.setdefault(mapping["presentation"]["layout"], []).append(mapping)

    lines = [
        "# Kiwoom common-screen API injection map",
        "",
        "This file is generated by `backend/scripts/render_screen_injection_map.py` from",
        "`backend/ref/kiwoom-common-screen-manifest.json`. Do not edit it by hand; re-run the",
        "generator and `python backend/scripts/render_screen_injection_map.py --check`.",
        "",
        "It is the API injection appendix of the 화면기획서 (screen planning document): the",
        "exhaustive table of which API feeds which common screen card.",
        "",
        "## Summary",
        "",
        *render_summary_table(mappings, layout_category, layout_counts),
        "",
    ]
    for layout in sorted(layout_counts, key=lambda name: (-layout_counts[name], name)):
        lines.extend(render_layout_section(layout, layout_category[layout], mappings_by_layout[layout]))
    lines.extend(render_exclusions_section(manifest))
    lines.append("")
    return "\n".join(lines)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest()
    content = render(manifest)
    if args.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != content:
            print(f"Generated screen injection map is stale: {OUTPUT_PATH.relative_to(REPO_ROOT)}")
            return 1
        print("Generated screen injection map is current")
        return 0
    write(OUTPUT_PATH, content)
    print(f"Generated {len(manifest['mappings'])} mapping rows to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
