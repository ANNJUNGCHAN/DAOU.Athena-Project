
import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI

import athena_api.lifespan as lifespan_module
from athena_api.brain import (
    SCHEMA_VERSION,
    ClaudeCliStructuredLlm,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobTrigger,
    LocalCommandStructuredLlm,
    SourceKind,
)
from athena_api.config import Settings
from athena_api.lifespan import (
    _hourly_ingest_loop,
    _open_brain,
    _teardown_brain,
    build_lifespan,
)
from athena_api.process_lock import BrainProcessLock


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.sqlite3",
        **overrides,
    )


# --- disabled by default -------------------------------------------------------------


async def test_brain_disabled_by_default_never_touches_app_state_or_disk(tmp_path: Path) -> None:
    app = FastAPI()
    isolated_db = tmp_path / "disabled-brain.sqlite3"
    settings = Settings(_env_file=None, brain_db_path=isolated_db)
    assert settings.brain_enabled is False
    async with build_lifespan(settings)(app):
        assert app.state.brain_ready is False
        assert app.state.brain_store is None
        assert app.state.brain_last_error is None
        assert app.state.brain_ingestion_ready is False
        assert app.state.brain_ingestion_last_error is None
    # A disabled brain must not create even its explicitly isolated target.
    assert not isolated_db.exists()


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


def test_claude_cli_extraction_opt_in_parses_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION", "true")
    assert Settings(_env_file=None).brain_use_claude_cli_extraction is True


def test_claude_cli_extraction_is_opted_out_by_default() -> None:
    assert Settings(_env_file=None).brain_use_claude_cli_extraction is False


async def test_extraction_is_disabled_by_default(
    tmp_path: Path
) -> None:
    app = FastAPI()
    settings = _brain_settings(tmp_path)
    async with build_lifespan(settings)(app):
        assert app.state.brain_extraction_enabled is False
    assert app.state.brain_extraction_enabled is False


async def test_claude_cli_extraction_is_selected_only_when_explicitly_enabled(
    tmp_path: Path,
) -> None:
    brain = await _open_brain(
        _brain_settings(tmp_path, brain_use_claude_cli_extraction=True)
    )
    try:
        assert brain.extraction_enabled is True
        assert brain.coordinator is not None
        projector = brain.coordinator._projectors[SourceKind.CONVERSATION]  # noqa: SLF001
        assert isinstance(projector._client, ClaudeCliStructuredLlm)  # noqa: SLF001
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_custom_extraction_argv_has_priority_over_claude_cli_opt_in(
    tmp_path: Path,
) -> None:
    brain = await _open_brain(
        _brain_settings(
            tmp_path,
            brain_extraction_llm_argv=["custom-llm", "--json"],
            brain_use_claude_cli_extraction=True,
        )
    )
    try:
        assert brain.coordinator is not None
        projector = brain.coordinator._projectors[SourceKind.CONVERSATION]  # noqa: SLF001
        assert isinstance(projector._client, LocalCommandStructuredLlm)  # noqa: SLF001
    finally:
        await _teardown_brain(FastAPI(), brain)


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


def test_ingest_schedule_owner_defaults_to_backend_and_reads_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ATHENA_BRAIN_INGEST_SCHEDULE_OWNER", raising=False)
    assert Settings(_env_file=None).brain_ingest_schedule_owner == "backend"
    monkeypatch.setenv("ATHENA_BRAIN_INGEST_SCHEDULE_OWNER", "external")
    assert Settings(_env_file=None).brain_ingest_schedule_owner == "external"


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
        assert brain.hourly_task is not None
        for _ in range(50):
            await asyncio.sleep(0.02)
            if JobTrigger.HOURLY in calls:
                break
        assert JobTrigger.HOURLY in calls
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_hourly_self_enqueue_recovers_after_one_failed_tick(
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls = 0
    recovered = asyncio.Event()

    class FlakyCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            nonlocal calls
            assert trigger is JobTrigger.HOURLY
            calls += 1
            if calls == 1:
                raise RuntimeError("sensitive upstream detail must not stop the loop")
            recovered.set()

    task = asyncio.create_task(_hourly_ingest_loop(FlakyCoordinator(), 0.001))  # type: ignore[arg-type]
    try:
        await asyncio.wait_for(recovered.wait(), timeout=1)
        assert calls >= 2
        assert not task.done()
        assert "RuntimeError" in caplog.text
        assert "sensitive upstream detail" not in caplog.text
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_external_schedule_owner_does_not_start_backend_hourly_timer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[JobTrigger] = []
    original_enqueue = IngestionCoordinator.enqueue

    async def spy_enqueue(self: IngestionCoordinator, trigger: JobTrigger):
        calls.append(trigger)
        return await original_enqueue(self, trigger)

    monkeypatch.setattr(IngestionCoordinator, "enqueue", spy_enqueue)
    settings = _brain_settings(tmp_path, brain_ingest_schedule_owner="external")
    brain = await _open_brain(settings, hourly_interval_seconds=0.01)
    try:
        await asyncio.sleep(0.05)
        assert calls.count(JobTrigger.STARTUP) == 1
        assert JobTrigger.HOURLY not in calls
        assert brain.hourly_task is None
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_open_brain_enqueues_exactly_one_startup_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[JobTrigger] = []
    original_enqueue = IngestionCoordinator.enqueue

    async def spy_enqueue(self: IngestionCoordinator, trigger: JobTrigger):
        calls.append(trigger)
        return await original_enqueue(self, trigger)

    monkeypatch.setattr(IngestionCoordinator, "enqueue", spy_enqueue)
    brain = await _open_brain(_brain_settings(tmp_path), hourly_interval_seconds=60)
    try:
        assert brain.ingestion_ready is True
        assert calls.count(JobTrigger.STARTUP) == 1
        assert brain.startup_ingestion_job_id is not None
        startup_job = await brain.history.get_job(brain.startup_ingestion_job_id)
        assert startup_job is not None
        assert startup_job.trigger is JobTrigger.STARTUP
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_open_brain_does_not_wait_for_startup_ingestion_to_finish(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writer_started = asyncio.Event()
    release_writer = asyncio.Event()
    original_run_job_id = IngestionCoordinator._run_job_id  # noqa: SLF001

    async def blocked_run_job_id(self: IngestionCoordinator, job_id: str):
        writer_started.set()
        await release_writer.wait()
        return await original_run_job_id(self, job_id)

    monkeypatch.setattr(IngestionCoordinator, "_run_job_id", blocked_run_job_id)
    brain = await asyncio.wait_for(
        _open_brain(_brain_settings(tmp_path), hourly_interval_seconds=60),
        timeout=1,
    )
    try:
        await asyncio.wait_for(writer_started.wait(), timeout=1)
        assert brain.ingestion_ready is True
        assert brain.startup_ingestion_job_id is not None
    finally:
        release_writer.set()
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


async def test_faulted_hourly_task_does_not_block_brain_resource_cleanup(tmp_path: Path) -> None:
    settings = _brain_settings(tmp_path)
    brain = await _open_brain(settings, hourly_interval_seconds=60)
    assert brain.hourly_task is not None
    brain.hourly_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await brain.hourly_task

    async def faulted_task() -> None:
        raise RuntimeError("hourly task fault")

    brain.hourly_task = asyncio.create_task(faulted_task())
    await asyncio.sleep(0)

    with pytest.raises(RuntimeError, match="hourly task fault"):
        await _teardown_brain(FastAPI(), brain)

    assert not brain.history.is_open
    assert not brain.store.is_open
    assert brain.owner is not None
    assert not brain.owner.is_open
    replacement_lock = BrainProcessLock.for_db_path(
        settings.brain_db_path, label=str(settings.brain_db_path)
    )
    replacement_lock.acquire()
    replacement_lock.release()


# --- WP-F F1: 군집 라벨링 전용 LLM 클라이언트 -----------------------------------------


async def test_labeling_client_is_dormant_without_extraction_argv(tmp_path: Path) -> None:
    # G-F1/G-F2 — 추출이 꺼져 있으면(argv 미설정) 라벨링도 자동 휴면한다.
    app = FastAPI()
    async with build_lifespan(_brain_settings(tmp_path))(app):
        assert app.state.brain_cluster_labeling_llm_client is None
        assert app.state.cluster_labeling_tasks == {}


async def test_labeling_tasks_are_cancelled_before_brain_store_closes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    task_started = asyncio.Event()
    task_cancelled = asyncio.Event()
    task_holder: dict[str, asyncio.Task[None]] = {}
    original_close = GraphStore.close

    async def close_after_label_task(self: GraphStore) -> None:
        task = task_holder["task"]
        assert task.done()
        assert task.cancelled()
        await original_close(self)

    monkeypatch.setattr(GraphStore, "close", close_after_label_task)

    async def blocking_label() -> None:
        task_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            task_cancelled.set()

    app = FastAPI()
    async with build_lifespan(_brain_settings(tmp_path))(app):
        task = asyncio.create_task(blocking_label())
        task_holder["task"] = task
        app.state.cluster_labeling_tasks[("prompt", "members")] = task
        await asyncio.wait_for(task_started.wait(), timeout=1)

    assert task_cancelled.is_set()
    assert app.state.cluster_labeling_tasks == {}


async def test_early_cleanup_failure_does_not_skip_later_cleanup_phases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    original_label_cleanup = lifespan_module._teardown_cluster_labeling_tasks
    original_brain_cleanup = lifespan_module._teardown_brain
    original_routines_cleanup = lifespan_module.teardown_routines

    async def failed_accounts_cleanup(*args, **kwargs) -> None:
        calls.append("accounts")
        raise RuntimeError("account cleanup failed")

    async def label_cleanup(app: FastAPI) -> None:
        calls.append("labels")
        await original_label_cleanup(app)

    async def brain_cleanup(app: FastAPI, brain) -> None:
        calls.append("brain")
        await original_brain_cleanup(app, brain)

    async def routines_cleanup(routines) -> None:
        calls.append("routines")
        await original_routines_cleanup(routines)

    monkeypatch.setattr(lifespan_module, "_teardown", failed_accounts_cleanup)
    monkeypatch.setattr(lifespan_module, "_teardown_cluster_labeling_tasks", label_cleanup)
    monkeypatch.setattr(lifespan_module, "_teardown_brain", brain_cleanup)
    monkeypatch.setattr(lifespan_module, "teardown_routines", routines_cleanup)

    app = FastAPI()
    with pytest.raises(RuntimeError, match="account cleanup failed"):
        async with build_lifespan(_brain_settings(tmp_path))(app):
            pass

    assert calls == ["accounts", "labels", "brain", "routines"]
    assert app.state.cluster_labeling_tasks == {}
    assert app.state.brain_ready is False


async def test_startup_primary_error_survives_cleanup_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    primary_error = RuntimeError("startup primary")
    calls: list[str] = []

    async def failed_open_brain(settings, **kwargs) -> None:
        raise primary_error

    async def failed_accounts_cleanup(*args, **kwargs) -> None:
        calls.append("accounts")
        raise RuntimeError("cleanup secondary")

    async def label_cleanup(app: FastAPI) -> None:
        calls.append("labels")

    async def brain_cleanup(app: FastAPI, brain) -> None:
        calls.append("brain")

    async def routines_cleanup(routines) -> None:
        calls.append("routines")

    monkeypatch.setattr(lifespan_module, "_open_brain", failed_open_brain)
    monkeypatch.setattr(lifespan_module, "_teardown", failed_accounts_cleanup)
    monkeypatch.setattr(lifespan_module, "_teardown_cluster_labeling_tasks", label_cleanup)
    monkeypatch.setattr(lifespan_module, "_teardown_brain", brain_cleanup)
    monkeypatch.setattr(lifespan_module, "teardown_routines", routines_cleanup)

    app = FastAPI()
    with pytest.raises(RuntimeError, match="startup primary") as raised:
        async with build_lifespan(_brain_settings(tmp_path))(app):
            pass

    assert raised.value is primary_error
    assert calls == ["accounts", "labels", "brain", "routines"]


async def test_labeling_client_is_a_separate_short_timeout_instance(tmp_path: Path) -> None:
    # 추출용 client(120초)와 별개 인스턴스로 20초 타임아웃이 생성 시점에 고정된다 —
    # StructuredLlmClient.complete()는 호출별 타임아웃 인자를 받지 않는다.
    app = FastAPI()
    settings = _brain_settings(tmp_path, brain_extraction_llm_argv=["llm-cli", "--json"])
    async with build_lifespan(settings)(app):
        client = app.state.brain_cluster_labeling_llm_client
        assert client is not None
        assert client._timeout_seconds == 20  # noqa: SLF001 - 생성자 고정값 확인


async def test_claude_extraction_opt_in_also_wires_the_labeling_client(tmp_path: Path) -> None:
    app = FastAPI()
    settings = _brain_settings(tmp_path, brain_use_claude_cli_extraction=True)

    async with build_lifespan(settings)(app):
        client = app.state.brain_cluster_labeling_llm_client
        assert isinstance(client, ClaudeCliStructuredLlm)
        assert client._timeout_seconds == 20  # noqa: SLF001 - 라벨링 상한 고정 확인


async def test_custom_argv_has_priority_for_the_labeling_client(tmp_path: Path) -> None:
    app = FastAPI()
    settings = _brain_settings(
        tmp_path,
        brain_extraction_llm_argv=["custom-llm", "--json"],
        brain_use_claude_cli_extraction=True,
    )

    async with build_lifespan(settings)(app):
        client = app.state.brain_cluster_labeling_llm_client
        assert isinstance(client, LocalCommandStructuredLlm)
        assert client._argv == ("custom-llm", "--json")  # noqa: SLF001


# --- WP-H: 체결·잔고 생산자 결선 -----------------------------------------------------


class _CannedKiwoomClient:
    """오늘 날짜의 kt00007(sell_tp=2)에 체결 한 건, kt00005에 잔고 한 건을 돌려준다.

    나머지 조회(과거 영업일)는 빈 본문이다 — 백필이 창 전체를 훑는 것은 정상이고,
    여기서 재는 것은 HTTP가 아니라 **결선**(생산자가 이력에 적재하고 잡을 넣는가)이다.
    """

    def __init__(self, today: str) -> None:
        self._today = today
        self.api_ids: list[str] = []

    async def post_with_headers(self, api_id, endpoint, data=None, options=None):
        from athena_api.kiwoom.client import ResponseEnvelope

        self.api_ids.append(api_id)
        body = dict(data or {})
        if api_id == "kt00007" and body.get("ord_dt") == self._today and body.get("sell_tp") == "2":
            return ResponseEnvelope(
                body={"acnt_ord_cntr_prps_dtl": [{
                    "ord_no": "0000001",
                    "stk_cd": "A005930",
                    "cntr_qty": "0000000010",
                    "cntr_uv": "0000070000",
                    "cnfm_tm": "10:30:00",
                }]},
                cont_yn="N",
                next_key=None,
            )
        if api_id == "kt00005":
            return ResponseEnvelope(
                body={"stk_cntr_remn": [{
                    "stk_cd": "A005930",
                    "cur_qty": "000000000010",
                    "buy_uv": "000000070000",
                }]},
                cont_yn="N",
                next_key=None,
            )
        return ResponseEnvelope(body={}, cont_yn="N", next_key=None)


async def test_kiwoom_clients_wire_the_trade_and_holding_producers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """생산자가 결선되면 기동 직후 한 번 돌아 이력을 채우고 MANUAL 잡을 넣는다."""
    from athena_api.brain import BACKFILL_CURSOR, utc_now

    calls: list[JobTrigger] = []
    original_enqueue = IngestionCoordinator.enqueue

    async def spy_enqueue(self: IngestionCoordinator, trigger: JobTrigger):
        calls.append(trigger)
        return await original_enqueue(self, trigger)

    monkeypatch.setattr(IngestionCoordinator, "enqueue", spy_enqueue)
    client = _CannedKiwoomClient(utc_now().strftime("%Y%m%d"))
    settings = _brain_settings(tmp_path, brain_ingest_schedule_owner="external")
    brain = await _open_brain(settings, kiwoom_clients={"acct-A": client})  # type: ignore[dict-item]
    try:
        assert brain.producer_task is not None
        await asyncio.wait_for(brain.producer_task, timeout=30)
        # 백필 커서가 전진했다 = 체결 경로가 끝까지 돌았다.
        assert await brain.history.cursor(BACKFILL_CURSOR) > 0
        # 체결·잔고가 이력에 실제로 실렸다.
        assert await brain.history.trade_changes(0, limit=10)
        assert await brain.history.holding_changes(0, limit=10)
        # 적재 뒤 잡을 넣어 새 사실이 한 시간을 기다리지 않는다.
        assert JobTrigger.MANUAL in calls
        assert {"kt00005", "kt00007"} <= set(client.api_ids)
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_no_kiwoom_clients_means_no_producer_task(tmp_path: Path) -> None:
    """시세 자격증명 없는 기동 — 생산자 없이 예전과 똑같이 선다."""
    settings = _brain_settings(tmp_path, brain_ingest_schedule_owner="external")
    brain = await _open_brain(settings, kiwoom_clients={})
    try:
        assert brain.producer_task is None
        assert brain.ingestion_ready is True
    finally:
        await _teardown_brain(FastAPI(), brain)


async def test_hourly_tick_produces_before_it_enqueues() -> None:
    """생산이 잡보다 먼저다 — 그래야 그 잡이 방금 생긴 사실을 투영한다."""
    order: list[str] = []
    done = asyncio.Event()

    class RecordingBackfill:
        async def run(self):
            order.append("backfill")

    class RecordingHoldings:
        async def ingest(self):
            order.append("holdings")

    class RecordingCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            order.append("enqueue")
            done.set()

    task = asyncio.create_task(
        lifespan_module._hourly_ingest_loop(
            RecordingCoordinator(),  # type: ignore[arg-type]
            0.001,
            backfill=RecordingBackfill(),  # type: ignore[arg-type]
            holdings=RecordingHoldings(),  # type: ignore[arg-type]
        )
    )
    try:
        await asyncio.wait_for(done.wait(), timeout=1)
        assert order[:3] == ["backfill", "holdings", "enqueue"]
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_a_partial_holdings_cycle_does_not_stop_the_loop(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """계좌 일부 실패는 그 주기의 잔고만 건너뛴다 — 잡은 그대로 들어간다."""
    from athena_api.brain import PartialHoldingsError

    enqueued = asyncio.Event()

    class FailingHoldings:
        async def ingest(self):
            raise PartialHoldingsError("acct-B 조회 실패")

    class RecordingCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            enqueued.set()

    task = asyncio.create_task(
        lifespan_module._hourly_ingest_loop(
            RecordingCoordinator(),  # type: ignore[arg-type]
            0.001,
            holdings=FailingHoldings(),  # type: ignore[arg-type]
        )
    )
    try:
        await asyncio.wait_for(enqueued.wait(), timeout=1)
        assert "partial account failure" in caplog.text
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


# --- 소스별 스케줄러(2026-09-08) -------------------------------------------------------


async def test_scheduler_runs_only_the_due_source_and_reschedules_it() -> None:
    """주기가 다른 소스는 그 소스만 돈다 — 잡은 그 틱에 하나만 들어간다."""
    from datetime import UTC, datetime, timedelta

    from athena_api.lifespan import BrainIngestScheduler, BrainSource

    now = datetime(2026, 9, 8, 9, 0, tzinfo=UTC)
    order: list[str] = []
    ticks: list[JobTrigger] = []

    class RecordingBackfill:
        async def run(self):
            order.append("backfill")

    class RecordingHoldings:
        async def ingest(self):
            order.append("holdings")

    class RecordingCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            order.append("enqueue")
            ticks.append(trigger)

    scheduler = BrainIngestScheduler(
        RecordingCoordinator(),  # type: ignore[arg-type]
        3600,
        backfill=RecordingBackfill(),  # type: ignore[arg-type]
        holdings=RecordingHoldings(),  # type: ignore[arg-type]
        clock=lambda: now,
    )
    scheduler.set_interval(BrainSource.HOLDINGS, 1800)
    assert scheduler.schedules[BrainSource.HOLDINGS].next_run_at == now + timedelta(minutes=30)
    assert scheduler.schedules[BrainSource.FILLS].next_run_at == now + timedelta(hours=1)

    now = now + timedelta(minutes=30)
    await scheduler._run_sources(  # noqa: SLF001
        [s for s, sch in scheduler.schedules.items() if sch.next_run_at <= now],
        JobTrigger.HOURLY,
    )
    assert order == ["holdings", "enqueue"], "체결 백필은 아직 만기가 아니다"
    holdings = scheduler.schedules[BrainSource.HOLDINGS]
    assert holdings.last_run_at == now
    assert holdings.next_run_at == now + timedelta(minutes=30)
    assert holdings.running is False
    assert holdings.last_error is None
    assert scheduler.schedules[BrainSource.FILLS].last_run_at is None


async def test_scheduler_run_now_uses_manual_trigger_and_records_error_type_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from athena_api.lifespan import BrainIngestScheduler, BrainSource

    triggers: list[JobTrigger] = []

    class FailingBackfill:
        async def run(self):
            raise RuntimeError("C:/secret/path token=abc")

    class RecordingCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            triggers.append(trigger)

    scheduler = BrainIngestScheduler(
        RecordingCoordinator(),  # type: ignore[arg-type]
        3600,
        backfill=FailingBackfill(),  # type: ignore[arg-type]
    )
    schedule = await scheduler.run_now(BrainSource.FILLS)
    assert triggers == [JobTrigger.MANUAL]
    assert schedule.last_error == "RuntimeError"
    assert schedule.last_run_at is not None
    assert "token=abc" not in caplog.text
    assert scheduler.schedules[BrainSource.CHAT].producer_wired is True
    assert scheduler.schedules[BrainSource.FILLS].producer_wired is True
    assert scheduler.schedules[BrainSource.HOLDINGS].producer_wired is False


async def test_scheduler_loop_wakes_up_when_an_interval_is_shortened() -> None:
    """긴 주기로 자고 있어도 주기를 줄이면 곧 돈다 — 옛 주기의 남은 시간을 기다리지 않는다."""
    from athena_api.lifespan import BrainIngestScheduler, BrainSource

    enqueued = asyncio.Event()

    class RecordingCoordinator:
        async def enqueue(self, trigger: JobTrigger) -> None:
            enqueued.set()

    scheduler = BrainIngestScheduler(RecordingCoordinator(), 3600)  # type: ignore[arg-type]
    task = asyncio.create_task(scheduler.run_loop())
    try:
        await asyncio.sleep(0.01)
        assert not enqueued.is_set()
        scheduler.set_interval(BrainSource.CHAT, 0.001)
        await asyncio.wait_for(enqueued.wait(), timeout=1)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_open_brain_exposes_a_scheduler_even_when_the_schedule_is_external(
    tmp_path: Path,
) -> None:
    settings = _brain_settings(tmp_path, brain_ingest_schedule_owner="external")
    brain = await _open_brain(settings, hourly_interval_seconds=60)
    try:
        assert brain.hourly_task is None
        assert brain.scheduler is not None, "수동 실행·상태 조회는 주기 소유자와 무관하다"
    finally:
        await _teardown_brain(FastAPI(), brain)
