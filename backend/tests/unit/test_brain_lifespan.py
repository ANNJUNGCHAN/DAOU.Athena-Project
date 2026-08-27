
import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI

from athena_api.brain import (
    SCHEMA_VERSION,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobTrigger,
    SourceKind,
)
from athena_api.config import Settings
from athena_api.lifespan import _open_brain, _teardown_brain, build_lifespan
from athena_api.process_lock import BrainProcessLock


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.sqlite3",
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
        assert app.state.brain_ingestion_ready is False
        assert app.state.brain_ingestion_last_error is None
    # A disabled brain must never create a file under the real default path.
    assert not settings.brain_db_path.exists()
    assert not settings.brain_db_path.exists()


# --- happy path -----------------------------------------------------------------------


async def test_brain_opens_and_closes_symmetrically_with_the_app_lifespan(
    tmp_path: Path
) -> None:
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is True
        assert app.state.brain_last_error is None
        assert app.state.brain_ingestion_ready is True
        assert app.state.brain_ingestion_last_error is None
        store: GraphStore = app.state.brain_store
        assert store.is_open
        assert await store.schema_version() == SCHEMA_VERSION
    assert app.state.brain_ready is False
    assert app.state.brain_store is None
    assert app.state.brain_ingestion_ready is False
    assert not store.is_open


async def test_ingestion_coordinator_starts_and_stops_symmetrically_with_the_app_lifespan(
    tmp_path: Path
) -> None:
    """ADR §4.2 step 1 ("writer queue/scheduler 시작") and step 3 ("scheduler/writer
    cancel 및 await") must bracket the app lifespan the same way DB open/close do.
    """
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ingestion_ready is True
        assert app.state.brain_ingestion_last_error is None
        assert settings.brain_db_path.exists()
    assert app.state.brain_ingestion_ready is False
    assert app.state.brain_ingestion_last_error is None


async def test_ingestion_start_failure_is_recorded_but_does_not_fail_the_brain_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ingestion is optional: a failure to open the raw-history store
    or start IngestionCoordinator degrades ingestion_ready without failing graph
    read/write, which does not depend on it (ADR §4.2 step 1, see _open_brain docstring).
    """

    async def _boom(self: HistoryStore) -> None:
        raise RuntimeError("deterministic raw-history open failure")

    monkeypatch.setattr(HistoryStore, "open", _boom)
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is True
        assert app.state.brain_ingestion_ready is False
        assert app.state.brain_ingestion_last_error is not None


async def test_second_backend_is_rejected_while_first_holds_an_open_brain(
    tmp_path: Path
) -> None:
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


# --- degraded path: GraphStore.open() fails --------------------------------------------
#
# 네이티브 런타임이 사라지면서(SQLite로 내려오면서) "DLL이 없다"는 실패 모드 자체가
# 없어졌다. 그래도 열기 실패는 여전히 가능하다 — 디스크 권한, 손상된 파일, 잠긴 경로.
# 그래서 원인이 아니라 **계약**을 고정한다: `GraphStore.open()`이 어떤 이유로든 실패하면
# 앱이 아니라 브레인만 강등된다.


async def test_open_failure_does_not_crash_the_app(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(self: GraphStore) -> None:
        raise RuntimeError("graph store could not be opened")

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


# --- extraction injection (gap b, ADR §2(b')) -----------------------------------------


async def test_extraction_is_disabled_by_default(
    tmp_path: Path
) -> None:
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_extraction_enabled is False
    assert app.state.brain_extraction_enabled is False


async def test_extraction_is_injected_into_the_coordinator_when_argv_is_configured(
    tmp_path: Path
) -> None:
    """ATHENA_BRAIN_EXTRACTION_LLM_ARGV configured -> IngestionCoordinator gets a real
    ExtractionService source_projector, not the None default (lifespan.py _open_brain).
    """
    app = FastAPI()
    settings = _brain_settings(
        tmp_path, brain_extraction_llm_argv=["python", "-c", "pass"]
    )
    async with build_lifespan(settings)(app):
        assert app.state.brain_extraction_enabled is True
        assert app.state.brain_ingestion_ready is True
    # The coordinator itself is not published on app.state; re-open directly to inspect
    # the wiring the same way the fixture above only observes through app.state.
    brain = await _open_brain(settings)
    try:
        assert brain.extraction_enabled is True
        assert brain.coordinator is not None
        # 대화는 LLM 투영기로, 체결·잔고는 결정적 투영기로 — 셋 다 배선돼야 한다.
        # `holding_projector`를 받아놓고 표에 넣지 않아 조용히 무시하던 버그가 실제로
        # 있었으므로(leaf 2), 배선을 라우팅 표에서 직접 확인한다.
        assert set(brain.coordinator._projectors) == {  # noqa: SLF001
            SourceKind.CONVERSATION,
            SourceKind.TRADE,
            SourceKind.HOLDING,
        }
    finally:
        await _teardown_brain(FastAPI(), brain)


# --- hourly self-enqueue (G005) ---------------------------------------------------------


async def test_hourly_self_enqueue_calls_coordinator_enqueue_on_a_fast_tick(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[JobTrigger] = []
    original_enqueue = IngestionCoordinator.enqueue

    async def spy_enqueue(self: IngestionCoordinator, trigger: JobTrigger):
        calls.append(trigger)
        return await original_enqueue(self, trigger)

    monkeypatch.setattr(IngestionCoordinator, "enqueue", spy_enqueue)
    settings = _brain_settings(tmp_path)
    brain = await _open_brain(settings, hourly_interval_seconds=0.02)
    try:
        for _ in range(50):
            await asyncio.sleep(0.02)
            if JobTrigger.HOURLY in calls:
                break
        assert JobTrigger.HOURLY in calls
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_hourly_task_is_cancelled_symmetrically_with_the_app_lifespan(
    tmp_path: Path
) -> None:
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        pass
    # _teardown_brain must have cancelled the hourly task before returning -- nothing
    # left running that could still call the now-stopped coordinator.
    assert app.state.brain_ingestion_ready is False


# --- WP-F F1: 군집 라벨링 전용 LLM 클라이언트 -----------------------------------------


async def test_labeling_client_is_dormant_without_extraction_argv(tmp_path: Path) -> None:
    # G-F1/G-F2 — 추출이 꺼져 있으면(argv 미설정) 라벨링도 자동 휴면한다.
    app = FastAPI()
    async with build_lifespan(_brain_settings(tmp_path))(app):
        assert app.state.brain_cluster_labeling_llm_client is None
        assert app.state.cluster_labeling_tasks == set()


async def test_labeling_client_is_a_separate_short_timeout_instance(tmp_path: Path) -> None:
    # 추출용 client(120초)와 별개 인스턴스로 20초 타임아웃이 생성 시점에 고정된다 —
    # StructuredLlmClient.complete()는 호출별 타임아웃 인자를 받지 않는다.
    app = FastAPI()
    settings = _brain_settings(tmp_path, brain_extraction_llm_argv=["llm-cli", "--json"])
    async with build_lifespan(settings)(app):
        client = app.state.brain_cluster_labeling_llm_client
        assert client is not None
        assert client._timeout_seconds == 20  # noqa: SLF001 - 생성자 고정값 확인
