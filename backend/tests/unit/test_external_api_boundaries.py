"""Architecture boundaries for optional external-provider integrations."""

import ast
import re
from pathlib import Path

from athena_api.config import Settings

CORE_ROOT = Path(__file__).parents[2] / "athena_api"
ROUTINES_ROOT = CORE_ROOT / "routines"
NETWORK_CLIENT_MODULES = frozenset({"httpx", "requests", "aiohttp", "urllib"})
URL_LITERAL = re.compile(r"https?://", re.IGNORECASE)
LEGACY_DISCLOSURE_SOURCE = "disclosure.title_keyword"


def _parsed_sources(root: Path) -> list[tuple[Path, ast.Module]]:
    return [
        (path, ast.parse(path.read_text(encoding="utf-8"), filename=str(path)))
        for path in root.rglob("*.py")
    ]


def _identifier_names(tree: ast.AST) -> list[tuple[str, int]]:
    names: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.append((node.name, node.lineno))
        elif isinstance(node, ast.Name):
            names.append((node.id, node.lineno))
        elif isinstance(node, ast.Attribute):
            names.append((node.attr, node.lineno))
        elif isinstance(node, ast.arg):
            names.append((node.arg, node.lineno))
        elif isinstance(node, ast.alias):
            names.append((node.name, node.lineno))
            if node.asname is not None:
                names.append((node.asname, node.lineno))
    return names


def test_athena_api_has_no_direct_dart_integration_identifiers() -> None:
    violations: list[str] = []
    for path, tree in _parsed_sources(CORE_ROOT):
        for name, line in _identifier_names(tree):
            normalized = name.lower().replace("_", "")
            if (
                "dart" in normalized
                or normalized == "corpcatalog"
                or "corpcode" in normalized
            ):
                violations.append(f"{path.relative_to(CORE_ROOT)}:{line}: {name}")
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            value = node.value.lower()
            if "opendart.fss.or.kr" in value or "corpcode.xml" in value:
                violations.append(
                    f"{path.relative_to(CORE_ROOT)}:{node.lineno}: direct DART literal"
                )

    assert violations == []


def test_routines_package_has_no_network_client_or_url_literals() -> None:
    violations: list[str] = []
    for path, tree in _parsed_sources(ROUTINES_ROOT):
        relative = path.relative_to(CORE_ROOT)
        for node in ast.walk(tree):
            line = getattr(node, "lineno", 0)
            imported: list[str] = []
            if isinstance(node, ast.Import):
                imported = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported = [node.module]
            for module in imported:
                if module.split(".", 1)[0] in NETWORK_CLIENT_MODULES:
                    violations.append(f"{relative}:{line}: import {module}")
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and (URL_LITERAL.search(node.value) or "corpcode.xml" in node.value.lower())
            ):
                violations.append(f"{relative}:{line}: external URL/cache literal")

    assert violations == []


def test_legacy_disclosure_source_literal_exists_only_in_disabled_catalog() -> None:
    models_path = ROUTINES_ROOT / "models.py"
    parsed = _parsed_sources(CORE_ROOT)
    models_tree = next(tree for path, tree in parsed if path == models_path)
    catalog_values: set[int] = set()
    for node in models_tree.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id != "LEGACY_DISABLED_SOURCES" or node.value is None:
            continue
        catalog_values.update(
            id(child)
            for child in ast.walk(node.value)
            if isinstance(child, ast.Constant)
            and child.value == LEGACY_DISCLOSURE_SOURCE
        )

    occurrences: list[tuple[Path, ast.Constant]] = []
    for path, tree in parsed:
        occurrences.extend(
            (path, node)
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and node.value == LEGACY_DISCLOSURE_SOURCE
        )

    assert len(catalog_values) == 1
    assert len(occurrences) == 1
    path, node = occurrences[0]
    assert path == models_path
    assert id(node) in catalog_values


def test_settings_does_not_accept_dart_credentials() -> None:
    assert "dart_api_key" not in Settings.model_fields
