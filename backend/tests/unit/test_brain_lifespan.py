"""Wiring tests for the investment-brain graph projection inside build_lifespan().

ADR: plan/investment-brain-architecture.md §4.2 — process lock -> DB open -> schema
check -> fts load -> readiness. The single-writer queue itself is GraphStore's existing
one-worker ThreadPoolExecutor (store.py); this file only tests the FastAPI seam around it.
"""

import os
from pathlib import Path

import pytest
from fastapi import FastAPI

from athena_api.brain import GraphStore
from athena_api.config import Settings
from athena_api.lifespan import _open_brain, build_lifespan
from athena_api.process_lock import BrainProcessLock


def _test_only_windows_dll_dir() -> Path | None:
    configured = os.getenv("ATHENA_LADYBUG_DLL_DIR")
    if configured:
        return Path(configured)
    # Test harness fallback only, mirrors test_brain_graph_store.py. Production code
    # never discovers this path.
    local_test_runtime = Path(r"C:\Program Files\Git\mingw64\bin")
    if os.name == "nt" and local_test_runtime.is_dir():
        return local_test_runtime
    return None


@pytest.fixture
def ladybug_dll_dir(monkeypatch: pytest.MonkeyPatch) -> Path | None:
    runtime_dir = _test_only_windows_dll_dir()
    if runtime_dir is not None:
        monkeypatch.setenv("ATHENA_LADYBUG_DLL_DIR", str(runtime_dir))
    return runtime_dir


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.lbug",
        **overrides,
    )


# --- disabled by default -------------------------------------------------------------


async def test_brain_disabled_by_default_never_touches_app_state_or_disk() -> None:
    app = FastAPI()
    settings = Settings(_env_file=None)
    assert settings.brain_enabled is False
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is False
        assert app.state.brain_store is None
        assert app.state.brain_last_error is None
    # A disabled brain must never create a file under the real default path.
    assert not settings.brain_db_path.exists()


# --- happy path: real ladybug runtime available on this machine ----------------------


async def test_brain_opens_and_closes_symmetrically_with_the_app_lifespan(
    tmp_path: Path, ladybug_dll_dir: Path | None
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is True
        assert app.state.brain_last_error is None
        store: GraphStore = app.state.brain_store
        assert store.is_open
        assert await store.schema_version() == 1
    assert app.state.brain_ready is False
    assert app.state.brain_store is None
    assert not store.is_open


async def test_second_backend_is_rejected_while_first_holds_an_open_brain(
    tmp_path: Path, ladybug_dll_dir: Path | None
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    app_one = FastAPI()
    app_two = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app_one):
        assert app_one.state.brain_ready is True
        with pytest.raises(RuntimeError, match="owns the investment-brain graph"):
            async with build_lifespan(settings)(app_two):
                pass
        # The rejected second attempt must not have disturbed the first process.
        assert app_one.state.brain_ready is True
        assert app_one.state.brain_store.is_open


async def test_fts_load_failure_is_recorded_but_does_not_fail_the_brain_open(
    tmp_path: Path, ladybug_dll_dir: Path | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")

    async def _boom(self: GraphStore) -> None:
        raise RuntimeError("no bundled fts artifact and no network")

    monkeypatch.setattr(GraphStore, "load_fts_extension", _boom)
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is True
        assert app.state.brain_fts_ready is False
        assert app.state.brain_fts_last_error is not None


# --- degraded path: GraphStore.open() fails (e.g. no native runtime configured) ------
#
# A real end-to-end "no ATHENA_LADYBUG_DLL_DIR" probe was run by hand (not as an
# automated test): once ladybug's native library has been loaded into a process by any
# earlier successful open, Windows keeps it resident and later opens in the *same*
# process succeed even without the DLL directory — so a same-process test toggling the
# env var is order-dependent on whatever ran before it, not a reliable regression guard.
# These tests instead pin the *contract* — GraphStore.open() failing for any reason must
# degrade the brain, not the app — by making that failure deterministic via monkeypatch.


async def test_open_failure_does_not_crash_the_app(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(self: GraphStore) -> None:
        raise RuntimeError("LadybugDB could not start; no native runtime configured")

    monkeypatch.setattr(GraphStore, "open", _boom)
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is False
        assert app.state.brain_store is None
        assert app.state.brain_last_error is not None
        # Kiwoom is unaffected by a brain that failed to open.
        assert app.state.kiwoom_ready is False


async def test_open_failure_releases_the_process_lock_for_a_later_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed open holds nothing: a second attempt at the same path must not be blocked."""

    async def _boom(self: GraphStore) -> None:
        raise RuntimeError("no native runtime configured")

    monkeypatch.setattr(GraphStore, "open", _boom)
    settings = _brain_settings(tmp_path)
    first = await _open_brain(settings)
    assert first.ready is False
    second = await _open_brain(settings)
    assert second.ready is False


# --- lock contention is fail-fast, independent of the native runtime -----------------


async def test_open_brain_raises_immediately_when_the_lock_is_already_held(
    tmp_path: Path,
) -> None:
    settings = _brain_settings(tmp_path)
    contender = BrainProcessLock.for_db_path(settings.brain_db_path)
    contender.acquire()
    try:
        with pytest.raises(RuntimeError, match="owns the investment-brain graph"):
            await _open_brain(settings)
    finally:
        contender.release()
