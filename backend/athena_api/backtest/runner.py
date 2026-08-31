"""백테스트 잡 러너 — run/backfill 잡을 asyncio.Task로 돌리고 상태·진행률·취소를 추적한다
(docs/architecture/backtest-mode-plan.md §6.1 runner.py).

**왜 큐가 아니라 태스크 맵인가.** 동시 처리량 제한은 이 단계의 요구사항이 아니다 — 잡마다
자기 asyncio.Task를 하나씩 갖고, 러너는 `job_id -> 잡 상태`를 담는 인메모리 맵일 뿐이다.
`IngestionCoordinator`(brain)처럼 드레인·재시도 큐가 필요해지면 그때 넣는다 — 지금
지어내지 않는다(CLAUDE.md "Simplicity First").

**run과 backfill이 같은 맵을 쓰는 이유.** `GET /jobs/{job_id}`는 계약상 backfill 진행률
폴링용이지만, 취소(`DELETE /runs/{id}`)는 실행 중인 run 잡의 asyncio.Task를 붙잡아야 한다 —
잡 종류에 상관없이 "지금 도는 태스크를 취소한다"는 동작 하나로 통일한다.

**run 잡의 최종 데이터(지표·자산곡선)는 이 모듈이 들고 있지 않는다.** `BacktestStore`가
갖는다 — `bt_run.strategy_version_id`가 재현성의 축이라는 store.py의 계약을 그대로
따른다. 이 모듈은 그 store 쓰기를 실행하는 asyncio.Task와 취소 가능 여부만 관리한다.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

import pandas as pd

from athena_api.backtest.compile import compile_signals_with_warmup
from athena_api.backtest.data import FetchPage
from athena_api.backtest.data import backfill as run_backfill
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.metrics import compute_metrics
from athena_api.backtest.schema import StrategySpec
from athena_api.backtest.store import BacktestStore
from athena_api.backtest.store import EquityPoint as StoreEquityPoint
from athena_api.backtest.store import Trade as StoreTrade

JobKind = Literal["run", "backfill"]
JobStatus = Literal["running", "done", "failed", "cancelled"]


def _now() -> datetime:
    return datetime.now(UTC)


def _json_safe(payload: dict[str, Any]) -> dict[str, Any]:
    """무한대·NaN을 JSON이 실을 수 있는 모양으로 옮긴다.

    **왜 필요한가(2026-09-01 종단 실측).** `profit_factor`는 손실이 0이면 `inf`다 —
    metrics.py가 "손실 없는 전략을 임의의 유한값으로 낮잡아 왜곡하지 않는다"고 고른 값이다.
    그런데 `json.dumps(inf)`는 표준 JSON이 아닌 `Infinity`를 쓰고, pydantic이 응답을
    직렬화할 때 그 값을 `null`로 바꿔버린다. 결과적으로 화면에는 `∞`가 아니라 `—`가 떠서
    **"무한대"가 "모름"으로 바뀐다** — 정직하려던 선택이 전송 중에 뒤집힌 것이다.

    그래서 값은 `None`으로 두되 `<이름>_infinite` 플래그를 같이 실어, 화면이 "모름"과
    "무한대"를 구분할 수 있게 한다. NaN은 그냥 모르는 값이라 플래그 없이 None이다.
    """
    out: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, float) and math.isinf(value):
            out[key] = None
            out[f"{key}_infinite"] = value > 0
        elif isinstance(value, float) and math.isnan(value):
            out[key] = None
        else:
            out[key] = value
    return out


@dataclass(frozen=True, slots=True)
class BackfillProgress:
    page: int
    rows: int
    oldest_dt: str


@dataclass(slots=True)
class Job:
    """폴링용 상태 한 장. run 잡의 최종 결과(지표 등)는 여기 담지 않는다 — store가 SSoT다."""

    id: str
    kind: JobKind
    status: JobStatus = "running"
    progress: BackfillProgress | None = None
    error: str | None = None
    task: asyncio.Task[Any] | None = field(default=None, repr=False)


class BacktestRunner:
    """run/backfill 잡을 asyncio.Task로 실행하고 폴링·취소 표면을 제공한다."""

    def __init__(self, store: BacktestStore) -> None:
        self._store = store
        self._jobs: dict[str, Job] = {}

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        """실행 중인 잡을 취소한다. 이미 끝났거나 없으면 False."""
        job = self._jobs.get(job_id)
        if job is None or job.status != "running" or job.task is None:
            return False
        job.task.cancel()
        return True

    # ── backfill ────────────────────────────────────────────────────────────

    def start_backfill(
        self,
        job_id: str,
        *,
        fetch_page: FetchPage,
        stk_cd: str,
        period: str,
        adjusted: bool,
        base_dt: str,
        from_dt: str,
    ) -> Job:
        job = Job(id=job_id, kind="backfill")
        self._jobs[job_id] = job

        def on_progress(page: int, rows: int, oldest_dt: str) -> None:
            job.progress = BackfillProgress(page=page, rows=rows, oldest_dt=oldest_dt)

        async def run() -> None:
            try:
                await run_backfill(
                    store=self._store,
                    fetch_page=fetch_page,
                    stk_cd=stk_cd,
                    period=period,
                    adjusted=adjusted,
                    base_dt=base_dt,
                    from_dt=from_dt,
                    on_progress=on_progress,
                )
            except asyncio.CancelledError:
                job.status = "cancelled"
                raise
            except Exception as exc:  # noqa: BLE001 — 잡 실패를 상태로 옮기는 경계
                job.status = "failed"
                job.error = str(exc)
            else:
                job.status = "done"

        job.task = asyncio.create_task(run(), name=f"athena-backtest-backfill-{job_id}")
        return job

    # ── run ─────────────────────────────────────────────────────────────────

    def start_run(
        self,
        run_id: str,
        *,
        spec: StrategySpec,
        df: pd.DataFrame,
        overrides: dict[str, int | float] | None,
        initial_cash: float = DEFAULT_INITIAL_CASH,
        extra_flags: str | None = None,
    ) -> Job:
        """`run_id`의 `bt_run` 행은 호출자가 이미 status="running"으로 만들어뒀다고
        전제한다(spec_hash·strategy_version_id는 API 층의 책임 — 재현성 축은 store가 쥔다).
        이 메서드는 계산과 최종 상태 반영만 한다."""
        job = Job(id=run_id, kind="run")
        self._jobs[run_id] = job

        async def run() -> None:
            try:
                # 워밍업 봉 수를 컴파일러에게서 받아 그대로 넘긴다 — metrics가 다시
                # 추정하면 두 계산이 갈라진다(§6.5, metrics.py 머리말).
                signals, warmup_bars = compile_signals_with_warmup(spec, df, overrides)
                result = run_backtest(
                    df, signals, spec.risk, spec.costs, initial_cash=initial_cash
                )
                metrics = compute_metrics(
                    result.equity, result.trades, df,
                    initial_cash=initial_cash, warmup_bars=warmup_bars,
                )
                metrics_payload: dict[str, Any] = _json_safe(asdict(metrics))
                # 정직 표기 플래그는 결과 화면 "가정" 섹션이 그대로 노출한다(§8.3).
                # `extra_flags`는 호출자만 아는 사실(예: 보유 구간만 실행)이라 여기서
                # 지어낼 수 없어 인자로 받는다.
                flags = [f for f in (result.costs_flag, extra_flags) if f]
                if flags:
                    metrics_payload["flags"] = flags
                await self._store.save_trades(
                    run_id,
                    [
                        StoreTrade(
                            seq=i, side=t.side, dt=t.dt, price=t.price, qty=t.qty,
                            fee=t.fee, tax=t.tax, pnl=t.pnl, reason=t.reason,
                        )
                        for i, t in enumerate(result.trades)
                    ],
                )
                await self._store.save_equity(
                    run_id,
                    [
                        StoreEquityPoint(
                            dt=p.dt, equity=p.equity, cash=p.cash,
                            position_value=p.position_value, drawdown=p.drawdown,
                        )
                        for p in result.equity
                    ],
                )
                await self._store.update_run_status(
                    run_id, "done", finished_at=_now(),
                    metrics_json=json.dumps(metrics_payload, ensure_ascii=False),
                )
            except asyncio.CancelledError:
                job.status = "cancelled"
                await self._store.update_run_status(run_id, "cancelled", finished_at=_now())
                raise
            except Exception as exc:  # noqa: BLE001 — 잡 실패를 상태로 옮기는 경계
                job.status = "failed"
                job.error = str(exc)
                await self._store.update_run_status(
                    run_id, "failed", finished_at=_now(), error=str(exc)
                )
            else:
                job.status = "done"

        job.task = asyncio.create_task(run(), name=f"athena-backtest-run-{run_id}")
        return job

    async def shutdown(self) -> None:
        """살아있는 잡 태스크를 전부 취소하고 정리될 때까지 기다린다(앱 teardown 전용)."""
        tasks = [
            job.task for job in self._jobs.values() if job.task is not None and not job.task.done()
        ]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(BaseException):
                await task


__all__ = ["BackfillProgress", "BacktestRunner", "Job", "JobKind", "JobStatus"]
