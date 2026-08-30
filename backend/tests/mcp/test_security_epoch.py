from __future__ import annotations

import json

import pytest

from athena_mcp.aggregator import ToolAggregator
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.security_epoch import (
    CAPABILITY_TOKEN_ENV,
    EPOCH_PATH_ENV,
    EPOCH_REVISION_ENV,
    SECURITY_GENERATION_ENV,
    GatewayCapabilityGuard,
    capability_token_hash,
)
from athena_mcp.server import RENDER_CANVAS_TOOL, AthenaGateway


def _write_epoch(
    path, *, token: str = "generation-secret", generation: int = 4, revision: int = 9
) -> None:
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "revision": revision,
                "securityGeneration": generation,
                "tokenHash": capability_token_hash(token),
            }
        ),
        encoding="utf-8",
    )


def _guard(path, token: str = "generation-secret") -> GatewayCapabilityGuard:
    return GatewayCapabilityGuard.from_env(
        {
            EPOCH_PATH_ENV: str(path),
            CAPABILITY_TOKEN_ENV: token,
            SECURITY_GENERATION_ENV: "4",
            EPOCH_REVISION_ENV: "9",
        }
    )


def test_all_absent_environment_preserves_legacy_cold_gateway() -> None:
    guard = GatewayCapabilityGuard.from_env({})

    assert guard.enabled is False
    assert guard.is_current() is True


@pytest.mark.parametrize(
    "mutation",
    [
        lambda document: document.update(revision=10),
        lambda document: document.update(securityGeneration=5),
        lambda document: document.update(tokenHash=capability_token_hash("replacement")),
        lambda document: document.update(version=2),
    ],
)
def test_epoch_mismatch_revokes_old_generation(tmp_path, mutation) -> None:
    epoch_path = tmp_path / "epoch.json"
    _write_epoch(epoch_path)
    guard = _guard(epoch_path)
    assert guard.is_current() is True

    document = json.loads(epoch_path.read_text(encoding="utf-8"))
    mutation(document)
    epoch_path.write_text(json.dumps(document), encoding="utf-8")

    assert guard.is_current() is False


@pytest.mark.parametrize("contents", ["", "not-json", "[]", "{}"])
def test_missing_or_malformed_epoch_fails_closed(tmp_path, contents: str) -> None:
    epoch_path = tmp_path / "epoch.json"
    epoch_path.write_text(contents, encoding="utf-8")

    assert _guard(epoch_path).is_current() is False


def test_partial_generation_environment_fails_closed() -> None:
    guard = GatewayCapabilityGuard.from_env({EPOCH_PATH_ENV: "epoch.json"})

    assert guard.enabled is True
    assert guard.valid_configuration is False
    assert guard.is_current() is False


@pytest.mark.asyncio
async def test_gateway_checks_epoch_before_even_builtin_tool_dispatch(tmp_path) -> None:
    epoch_path = tmp_path / "epoch.json"
    _write_epoch(epoch_path, token="replacement")
    gateway = AthenaGateway(
        registry=ServerRegistry(tmp_path / "registry.json"),
        consent_store=ConsentStore(tmp_path / "consent.json"),
        aggregator=ToolAggregator(),
        capability_guard=_guard(epoch_path),
    )

    result = await gateway.dispatch_call(RENDER_CANVAS_TOOL, {})

    assert result.isError is True
    text = " ".join(getattr(block, "text", "") for block in result.content)
    assert "권한 세대" in text
