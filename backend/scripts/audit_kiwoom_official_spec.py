from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = BACKEND / "ref" / "kiwoom-io-source-profile.json"
DEFAULT_INVENTORY = BACKEND / "ref" / "kiwoom-tr-inventory.json"
DEFAULT_ASSIGNMENT = BACKEND / "ref" / "kiwoom-capability-assignment.json"
USER_AGENT = "DAOU-Athena-Kiwoom-spec-audit/1"
RESPONSE_DIRECTION = "response"
_LEADING_DEPTH = re.compile(r"^(?P<prefix>(?:-\s*)*)(?P<field>.*)$")


@dataclass(frozen=True, order=True)
class FieldIdentity:
    protocol: str
    api_id: str
    direction: str
    path: tuple[str, ...]
    occurrence: int

    def display(self) -> str:
        suffix = f"#{self.occurrence}" if self.occurrence > 1 else ""
        return f"{self.protocol}:{self.api_id}:{self.direction}:{'/'.join(self.path)}{suffix}"


@dataclass(frozen=True)
class OperationFields:
    protocol: str
    api_id: str
    fields: tuple[FieldIdentity, ...]


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _json_bytes(path: Path) -> tuple[bytes, Any]:
    raw = path.read_bytes()
    return raw, json.loads(raw.decode("utf-8"))


def _field_depth(value: object) -> tuple[int, str]:
    match = _LEADING_DEPTH.match(str(value).strip())
    if match is None:
        raise ValueError(f"invalid field identifier: {value!r}")
    prefix = match.group("prefix")
    return prefix.count("-"), match.group("field").strip()


def _field_sequence(
    *,
    protocol: str,
    api_id: str,
    rows: Iterable[tuple[int, str, bool]],
) -> tuple[FieldIdentity, ...]:
    containers: dict[int, str] = {}
    duplicate_counts: Counter[tuple[str, ...]] = Counter()
    fields: list[FieldIdentity] = []
    for depth, field_id, is_container in rows:
        if not field_id:
            raise ValueError(f"{api_id}: response field has an empty identifier")
        for stale_depth in [item for item in containers if item >= depth]:
            del containers[stale_depth]
        path = tuple(containers[item] for item in sorted(containers) if item < depth)
        full_path = (*path, field_id)
        duplicate_counts[full_path] += 1
        fields.append(
            FieldIdentity(
                protocol=protocol,
                api_id=api_id,
                direction=RESPONSE_DIRECTION,
                path=full_path,
                occurrence=duplicate_counts[full_path],
            )
        )
        if is_container:
            containers[depth] = field_id
    return tuple(fields)


def parse_inventory(operations: Sequence[Mapping[str, Any]]) -> dict[str, OperationFields]:
    parsed: dict[str, OperationFields] = {}
    for operation in operations:
        api_id = str(operation["id"])
        protocol = "websocket" if operation.get("url") == "/api/dostk/websocket" else "http"
        rows = []
        for row in operation.get("resp_body", []):
            depth, field_id = _field_depth(row.get("element", ""))
            rows.append((depth, field_id, row.get("type") == "LIST"))
        parsed[api_id] = OperationFields(
            protocol=protocol,
            api_id=api_id,
            fields=_field_sequence(protocol=protocol, api_id=api_id, rows=rows),
        )
    return parsed


def parse_github(spec: Mapping[str, Any]) -> dict[str, OperationFields]:
    parsed: dict[str, OperationFields] = {}
    for operation in spec.get("apis", {}).values():
        meta = operation.get("meta", {})
        api_id = str(meta.get("API ID", ""))
        if not api_id:
            continue
        protocol = "websocket" if meta.get("URL") == "/api/dostk/websocket" else "http"
        rows = [
            (int(row.get("depth", 0)), str(row.get("element", "")), row.get("type") == "LIST")
            for row in operation.get("response", {}).get("body", [])
        ]
        parsed[api_id] = OperationFields(
            protocol=protocol,
            api_id=api_id,
            fields=_field_sequence(protocol=protocol, api_id=api_id, rows=rows),
        )
    return parsed


def parse_portal(payload: Mapping[str, Any]) -> dict[str, OperationFields]:
    if str(payload.get("resp_code")) != "0":
        raise ValueError(
            f"Kiwoom portal returned resp_code={payload.get('resp_code')!r}: "
            f"{payload.get('resp_msg', '')}"
        )
    parsed: dict[str, OperationFields] = {}
    for operation in payload.get("resp_data", []):
        info = operation.get("apiInfo", {})
        api_id = str(operation.get("apiId") or info.get("apiId") or "")
        if not api_id:
            continue
        protocol = "websocket" if info.get("svcTransTp") == "WEBSOCKET" else "http"
        rows = []
        for row in operation.get("apiTrIo", []):
            if row.get("inptOutputTp") != "O" or row.get("headBodyTp") != "B":
                continue
            depth, field_id = _field_depth(row.get("itemId", ""))
            rows.append((depth, field_id, row.get("itemType") == "R"))
        parsed[api_id] = OperationFields(
            protocol=protocol,
            api_id=api_id,
            fields=_field_sequence(protocol=protocol, api_id=api_id, rows=rows),
        )
    return parsed


def current_scope_source_ids(assignment: Mapping[str, Any]) -> set[str]:
    mapping_ids = [
        str(mapping_id)
        for capability in assignment.get("capabilities", [])
        for mapping_id in capability.get("mapping_ids", [])
    ]
    expected = int(assignment.get("counts", {}).get("assigned", 0))
    if len(mapping_ids) != expected or len(set(mapping_ids)) != expected:
        raise ValueError("capability assignment does not contain its declared unique mappings")
    return {mapping_id.split(":", 2)[1] for mapping_id in mapping_ids}


def _field_set(operations: Mapping[str, OperationFields], ids: Iterable[str]) -> set[FieldIdentity]:
    return {
        field
        for api_id in ids
        for field in operations.get(api_id, OperationFields("", api_id, ())).fields
    }


def _sequence_hash(fields: Sequence[FieldIdentity]) -> str:
    value = "\n".join(field.display() for field in fields).encode()
    return _sha256(value)


def compare_sources(
    *,
    inventory: Mapping[str, OperationFields],
    github: Mapping[str, OperationFields],
    portal: Mapping[str, OperationFields],
    scope_ids: set[str],
    scope_route_count: int,
    fetched_at: str,
    inventory_hash: str,
    github_hash: str,
    portal_hash: str,
    github_commit: str,
) -> dict[str, Any]:
    missing_inventory_ids = sorted(scope_ids - inventory.keys())
    if missing_inventory_ids:
        raise ValueError(
            "current Athena scope references API IDs absent from its source inventory: "
            + ", ".join(missing_inventory_ids)
        )
    baseline = _field_set(inventory, scope_ids)
    official_union = _field_set(github, scope_ids) | _field_set(portal, scope_ids)
    additions = sorted(official_union - baseline)
    removals = sorted(baseline - official_union)

    divergences = []
    for api_id in sorted(scope_ids & github.keys() & portal.keys()):
        github_fields = github[api_id].fields
        portal_fields = portal[api_id].fields
        if github_fields == portal_fields:
            continue
        github_set = set(github_fields)
        portal_set = set(portal_fields)
        divergences.append(
            {
                "api_id": api_id,
                "github_only_fields": [
                    field.display() for field in sorted(github_set - portal_set)
                ],
                "portal_only_fields": [
                    field.display() for field in sorted(portal_set - github_set)
                ],
                "order_changed": github_set == portal_set,
                "github_sequence_sha256": _sequence_hash(github_fields),
                "portal_sequence_sha256": _sequence_hash(portal_fields),
            }
        )

    github_ids = set(github)
    portal_ids = set(portal)
    return {
        "fetched_at": fetched_at,
        "hashes": {
            "athena_inventory_sha256": inventory_hash,
            "official_github_sha256": github_hash,
            "official_portal_sha256": portal_hash,
        },
        "official_github_commit": github_commit,
        "api_counts": {
            "athena_inventory": len(inventory),
            "athena_current_routes": scope_route_count,
            "athena_299_source_api_ids": len(scope_ids),
            "official_github": len(github),
            "official_portal": len(portal),
        },
        "portal_only_api_ids": sorted(portal_ids - github_ids),
        "current_299": {
            "official_field_additions": [field.display() for field in additions],
            "official_field_removals": [field.display() for field in removals],
            "has_field_drift": bool(additions or removals),
        },
        "official_source_divergences": divergences,
    }


def _raw_github_url(spec_url: str) -> str:
    prefix = "https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/"
    if not spec_url.startswith(prefix):
        raise ValueError("profile official GitHub spec URL is not a pinned repository blob URL")
    return spec_url.replace(
        prefix,
        "https://raw.githubusercontent.com/Kiwoom-Securities/Kiwoom-REST-API/",
        1,
    )


def _fetch(url: str, *, timeout: float, method: str = "GET") -> bytes:
    data = b"" if method == "POST" else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def run_audit(
    *,
    profile_path: Path,
    inventory_path: Path,
    assignment_path: Path,
    timeout: float,
) -> dict[str, Any]:
    profile_raw, profile = _json_bytes(profile_path)
    del profile_raw
    inventory_raw, inventory_json = _json_bytes(inventory_path)
    _, assignment = _json_bytes(assignment_path)
    expected_inventory_hash = profile["source_inventory"]["sha256"]
    actual_inventory_hash = _sha256(inventory_raw)
    if actual_inventory_hash != expected_inventory_hash:
        raise ValueError(
            "Athena inventory hash does not match the union recorded in the source profile"
        )

    github_audit = profile["official_github_audit"]
    portal_audit = profile["official_portal_audit"]
    github_raw = _fetch(_raw_github_url(github_audit["spec_url"]), timeout=timeout)
    portal_raw = _fetch(portal_audit["endpoint"], timeout=timeout, method="POST")
    github_hash = _sha256(github_raw)
    if github_hash != github_audit["spec_sha256"]:
        raise ValueError("pinned official GitHub spec hash does not match the source profile")
    github_json = json.loads(github_raw.decode("utf-8"))
    portal_json = json.loads(portal_raw.decode("utf-8"))
    fetched_at = datetime.now(UTC).isoformat(timespec="seconds")

    return compare_sources(
        inventory=parse_inventory(inventory_json),
        github=parse_github(github_json),
        portal=parse_portal(portal_json),
        scope_ids=current_scope_source_ids(assignment),
        scope_route_count=int(assignment["counts"]["assigned"]),
        fetched_at=fetched_at,
        inventory_hash=actual_inventory_hash,
        github_hash=github_hash,
        portal_hash=_sha256(portal_raw),
        github_commit=github_audit["commit"],
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit Athena against current official Kiwoom specs"
    )
    parser.add_argument("--check", action="store_true", help="fail when current 299 fields drift")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--assignment", type=Path, default=DEFAULT_ASSIGNMENT)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = run_audit(
            profile_path=args.profile,
            inventory_path=args.inventory,
            assignment_path=args.assignment,
            timeout=args.timeout,
        )
    except (OSError, ValueError, KeyError, json.JSONDecodeError, urllib.error.URLError) as exc:
        print(
            json.dumps(
                {"error": type(exc).__name__, "message": str(exc)},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2

    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if args.check and report["current_299"]["has_field_drift"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
