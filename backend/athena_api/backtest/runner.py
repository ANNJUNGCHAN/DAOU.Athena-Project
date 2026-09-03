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
import os
import shutil
import subprocess
import sys
import tempfile
from collections import deque
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from athena_api.backtest.compile import compile_signals_with_warmup
from athena_api.backtest.data import FetchPage
from athena_api.backtest.data import backfill as run_backfill
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.flow import params_defaults
from athena_api.backtest.metrics import compute_metrics
from athena_api.backtest.sandbox import host as sandbox_host
from athena_api.backtest.schema import StrategySpec
from athena_api.backtest.store import BacktestStore
from athena_api.backtest.store import EquityPoint as StoreEquityPoint
from athena_api.backtest.store import Trade as StoreTrade
from athena_api.projects.store import BASE_ENV_PACKAGES, venv_path, venv_python

JobKind = Literal["run", "backfill", "env"]
JobStatus = Literal["running", "done", "failed", "cancelled"]

# 코드 경로는 워밍업 봉 수를 알 수 없다 — 지표 프레임을 만든 것이 사용자 코드라 앞
# 몇 봉이 NaN이었는지 부모가 알 방법이 없다. 0으로 두되 그 사실을 결과에 남긴다(§6.5).
CODE_PATH_WARMUP_FLAG = "코드 경로 · 워밍업 미산출 — Sharpe에 초기 구간이 포함됩니다"


def _now() -> datetime:
    return datetime.now(UTC)


def _align_signals(signals: pd.DataFrame, index: pd.Index) -> pd.DataFrame:
    """자식이 돌려준 신호를 원본 봉 인덱스에 맞춘다.

    사용자 코드는 봉을 잘라내거나 인덱스를 바꿔 돌려줄 수 있다 — 그대로 engine에 넘기면
    신호와 봉이 어긋난 채 체결된다. 빠진 행은 "모름"이 아니라 "신호 없음"이라 False다.
    """
    frame = signals.reindex(index)
    aligned = pd.DataFrame(
        {
            "entry": frame["entry"].fillna(False).astype(bool),
            "exit": frame["exit"].fillna(False).astype(bool),
        },
        index=index,
    )
    if "size" in frame.columns:
        aligned["size"] = frame["size"]
    return aligned


async def _run_code_signals(
    source: str,
    df: pd.DataFrame,
    overrides: dict[str, int | float] | None,
    base_params: dict[str, int | float] | None = None,
    *,
    python_exe: str | None = None,
    allowed_imports: Sequence[str] | None = None,
) -> dict[str, Any]:
    """전략 코드를 샌드박스 자식 프로세스에서 돌리고 결과 한 장을 회수한다(§7.2).

    jobdir은 실행마다 새로 만들고 끝나면 지운다 — 사용자 코드가 쓴 파일이 다음 실행에
    남지 않는다. 프로세스 기동은 블로킹이라 `to_thread`로 옮긴다(이벤트 루프를 막으면
    같은 루프의 다른 잡 폴링이 멈춘다).

    `python_exe`/`allowed_imports`는 프로젝트 가상환경으로 돌릴 때만 채워진다 — 그 결정은
    호출자(POST /runs)가 하고 여기서는 그대로 넘기기만 한다.
    """
    # p의 우선순위: 폼(yaml)의 파라미터 기본값 < 코드의 PARAMS 기본값 < 호출자 override.
    # 폼 값을 바닥에 까는 이유(2026-09-02 실측): 모델이 짠 코드가 PARAMS를 빠뜨리거나 이름을
    # 다르게 적으면 p["period"]가 KeyError로 죽었다 — 폼 슬라이더가 이미 같은 이름의 값을
    # 갖고 있으니 그걸 넘겨 코드 경로도 폼의 파라미터를 그대로 쓰게 한다.
    params = {**(base_params or {}), **params_defaults(source), **(overrides or {})}
    jobdir = Path(tempfile.mkdtemp(prefix="athena-bt-run-"))

    def run_and_clean() -> dict[str, Any]:
        # 정리는 **스레드 안에서** 한다 — to_thread는 취소되지 않아서(새 실행·앱 teardown의
        # CancelledError는 기다리는 쪽만 푼다) 바깥 finally로 지우면 자식이 아직 jobdir을
        # cwd로 붙들고 있는 채로 지우게 된다. 윈도우에선 그 삭제가 실패하고
        # ignore_errors가 그 사실을 삼켜 임시 디렉터리가 남는다.
        try:
            return sandbox_host.run_strategy(
                jobdir, source, df, params,
                python_exe=python_exe, allowed_imports=allowed_imports,
            )
        finally:
            shutil.rmtree(jobdir, ignore_errors=True)

    return await asyncio.to_thread(run_and_clean)


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


def _benchmark_series(df: pd.DataFrame) -> list[float]:
    """매수보유 곡선 — 첫 종가 대비 배수를 봉마다 하나씩.

    **왜 값 하나가 아니라 배열인가.** `metrics.buy_hold_return`은 마지막 한 점이라 곡선을
    못 그린다 — 결과 화면(보드 03)은 전략 곡선 **옆에 겹친 선**을 그린다.

    **왜 원시 종가가 아니라 배수인가.** 화면이 `normalize`로 배수를 만드는데, 그 정의
    (`v / 첫값`, 첫값이 0이면 전부 1)를 여기서 그대로 따른다 — 정규화가 한 번 더 걸려도
    첫값이 1이라 값이 그대로여서 두 정의가 갈라질 수 없다
    (app/lib/backtest-equity-chart.js `normalize`/`buyHoldSeries`).
    """
    closes = [float(c) for c in df["close"]]
    if not closes:
        return []
    base = closes[0]
    if not base:
        return [1.0] * len(closes)
    return [c / base for c in closes]


@dataclass(frozen=True, slots=True)
class BackfillProgress:
    page: int
    rows: int
    oldest_dt: str

    def to_dict(self) -> dict[str, Any]:
        return {"page": self.page, "rows": self.rows, "oldest_dt": self.oldest_dt}


@dataclass(frozen=True, slots=True)
class EnvProgress:
    """환경 구성 잡의 진행 — 지금 어느 단계고, 방금 어떤 줄이 나왔는가.

    백필의 page/rows와 모양이 다르다. 잡마다 진행의 뜻이 달라서다 — 그래서 직렬화를
    각자 `to_dict()`로 갖고, `GET /jobs/{id}`는 그것을 그대로 싣는다.
    """

    step: str
    line: str

    def to_dict(self) -> dict[str, Any]:
        return {"step": self.step, "line": self.line}


@dataclass(slots=True)
class Job:
    """폴링용 상태 한 장. run 잡의 최종 결과(지표 등)는 여기 담지 않는다 — store가 SSoT다."""

    id: str
    kind: JobKind
    status: JobStatus = "running"
    progress: BackfillProgress | EnvProgress | None = None
    error: str | None = None
    task: asyncio.Task[Any] | None = field(default=None, repr=False)


class BacktestRunner:
    """run/backfill 잡을 asyncio.Task로 실행하고 폴링·취소 표면을 제공한다."""

    def __init__(self, store: BacktestStore) -> None:
        self._store = store
        self._jobs: dict[str, Job] = {}
        # 프로젝트 폴더(normcase) -> 그 폴더에 대해 마지막으로 띄운 환경 잡 id.
        self._env_projects: dict[str, str] = {}

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def env_job_for(self, project_path: Path) -> Job | None:
        """같은 프로젝트에 대해 **지금 도는** 환경 잡. 없으면 None(409의 유일한 근거)."""
        job_id = self._env_projects.get(os.path.normcase(str(project_path)))
        job = self._jobs.get(job_id) if job_id is not None else None
        return job if job is not None and job.status == "running" else None

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

    # ── 프로젝트 환경 구성 ───────────────────────────────────────────────────

    def start_env(self, job_id: str, *, project_path: Path, packages: Sequence[str]) -> Job:
        """프로젝트 폴더에 가상환경을 만들고 기본 패키지(+요청분)를 설치한다.

        **왜 백테스트 러너가 이 잡을 드는가.** 진행 폴링 표면을 둘로 늘리지 않기 위해서다 —
        화면과 대화는 이미 `GET /jobs/{id}` 하나만 본다. 잡 종류가 하나 더 늘 뿐이다.

        명령은 전부 argv 리스트다 — 이 메서드에 셸이 없다. 패키지 이름 검증은 라우트가
        이미 끝냈고(`is_valid_package_spec`), 여기서는 그 값을 리스트 원소로만 다룬다.
        """
        job = Job(id=job_id, kind="env")
        self._jobs[job_id] = job
        self._env_projects[os.path.normcase(str(project_path))] = job_id

        def stream(step: str, cmd: list[str]) -> None:
            """자식의 출력을 줄 단위로 받아 마지막 줄을 진행 상태에 남긴다. 실패면 예외.

            줄 전체를 쌓아두지 않는다 — 진행은 "지금 어디인가"라 한 줄이면 되고, 실패
            메시지에 붙일 꼬리만 20줄 남긴다(pip 오류는 마지막 몇 줄에 이유가 있다).

            자식 env에서 ATHENA_*는 뺀다 — `pip install`은 남이 쓴 build/setup 코드를
            그대로 돌리는 자리라, 전략 코드에 자격증명을 안 넘긴다는 규율(sandbox/host.py
            `_ENV_ALLOWLIST`)이 여기만 비어 있으면 그 규율이 아니다. 나머지는 남긴다 —
            pip은 PATH·TEMP·프록시 설정으로 산다.
            """
            job.progress = EnvProgress(step=step, line="시작")
            tail: deque[str] = deque(maxlen=20)
            child_env = {k: v for k, v in os.environ.items() if not k.startswith("ATHENA_")}
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=child_env,
            )
            with proc:
                for raw in proc.stdout:  # stdout=PIPE라 항상 있다
                    line = raw.strip()
                    if not line:
                        continue
                    job.progress = EnvProgress(step=step, line=line)
                    tail.append(line)
            if proc.returncode != 0:
                raise RuntimeError(
                    f"{step} 단계가 실패했다(returncode={proc.returncode})\n" + "\n".join(tail)
                )

        def work() -> None:
            if venv_python(project_path) is None:
                stream("venv", [sys.executable, "-m", "venv", str(venv_path(project_path))])
            python = venv_python(project_path)
            if python is None:
                raise RuntimeError("가상환경을 만들었는데 인터프리터가 보이지 않는다")
            stream(
                "install",
                [
                    str(python), "-m", "pip", "install", "--disable-pip-version-check",
                    *BASE_ENV_PACKAGES, *packages,
                ],
            )
            job.progress = EnvProgress(step="done", line="환경 구성 완료")

        async def run() -> None:
            try:
                # 프로세스 기동·설치는 블로킹이라 스레드로 옮긴다(_run_code_signals와 같은 규율).
                await asyncio.to_thread(work)
            except asyncio.CancelledError:
                job.status = "cancelled"
                raise
            except Exception as exc:  # noqa: BLE001 — 잡 실패를 상태로 옮기는 경계
                job.status = "failed"
                job.error = str(exc)
            else:
                job.status = "done"

        job.task = asyncio.create_task(run(), name=f"athena-project-env-{job_id}")
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
        source: str | None = None,
        python_exe: str | None = None,
        allowed_imports: Sequence[str] | None = None,
    ) -> Job:
        """`run_id`의 `bt_run` 행은 호출자가 이미 status="running"으로 만들어뒀다고
        전제한다(spec_hash·strategy_version_id는 API 층의 책임 — 재현성 축은 store가 쥔다).
        이 메서드는 계산과 최종 상태 반영만 한다.

        `source`가 있으면 signals를 폼(spec) 대신 그 파이썬 코드에서 만든다 — 체결·비용·
        성과는 두 경로가 정확히 같은 코드를 지난다(§6.2, 두 저작 경로가 갈라지지 않는 이유).

        `python_exe`/`allowed_imports`가 있으면 그 인터프리터(프로젝트 가상환경)로 돌고
        허용목록이 그만큼 넓어진다 — 코드 경로에서만 뜻이 있어 `source`가 없으면 무시된다.
        """
        job = Job(id=run_id, kind="run")
        self._jobs[run_id] = job

        async def run() -> None:
            stdout_text = ""
            try:
                if source is not None:
                    outcome = await _run_code_signals(
                        source, df, overrides,
                        base_params={name: p.default for name, p in spec.strategy.params.items()},
                        python_exe=python_exe,
                        allowed_imports=allowed_imports,
                    )
                    stdout_text = outcome["stdout"]
                    if not outcome["ok"]:
                        err = outcome["error"]
                        message = f"{err['type']}: {err['message']}\n{err['traceback']}".strip()
                        job.status = "failed"
                        job.error = message
                        # print 로그는 실패했을 때 가장 필요하다 — 여기서 버리지 않는다.
                        await self._store.update_run_status(
                            run_id, "failed", finished_at=_now(),
                            error=message, stdout=stdout_text,
                        )
                        return
                    signals = _align_signals(outcome["signals_df"], df.index)
                    warmup_bars = 0
                else:
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
                # 흐름 지도(mapmodel.py) 오른쪽의 "사실"이 읽는 두 값. 신호 개수는 여기
                # 말고 아무도 세지 않는다 — 지도가 세면 실행이 만든 신호가 아니라 지도가
                # 다시 계산한 신호가 되고, 그 순간 사실이 아니라 추정이 된다.
                metrics_payload["signal_counts"] = {
                    "entry": int(signals["entry"].sum()),
                    "exit": int(signals["exit"].sum()),
                }
                metrics_payload["rows"] = int(len(df))
                # 정직 표기 플래그는 결과 화면 "가정" 섹션이 그대로 노출한다(§8.3).
                # `extra_flags`는 호출자만 아는 사실(예: 보유 구간만 실행)이라 여기서
                # 지어낼 수 없어 인자로 받는다.
                flags = [f for f in (result.costs_flag, extra_flags) if f]
                if source is not None:
                    flags.append(CODE_PATH_WARMUP_FLAG)
                # 결과 화면·채팅이 "어느 경로로 나온 수치인가"를 구분해야 한다(§6.2).
                metrics_payload["run_path"] = "code" if source is not None else "form"
                if flags:
                    metrics_payload["flags"] = flags
                # 자산곡선과 같은 봉 위에 겹치는 벤치마크. 목록 응답(GET /runs)은 이 배열을
                # 떼고 나간다(api/backtest.py `_metrics_view`) — flags와 같은 규율이다.
                metrics_payload["benchmark"] = _benchmark_series(df)
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
                    stdout=stdout_text or None,
                )
            except asyncio.CancelledError:
                job.status = "cancelled"
                await self._store.update_run_status(run_id, "cancelled", finished_at=_now())
                raise
            except Exception as exc:  # noqa: BLE001 — 잡 실패를 상태로 옮기는 경계
                job.status = "failed"
                job.error = str(exc)
                # 자식이 성공한 뒤(정렬·체결·지표에서) 터진 실패도 여기로 온다 — 코드 경로에선
                # print 로그가 사용자의 유일한 창이라 위 실패 분기와 같이 남긴다.
                await self._store.update_run_status(
                    run_id, "failed", finished_at=_now(),
                    error=str(exc), stdout=stdout_text or None,
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


__all__ = [
    "CODE_PATH_WARMUP_FLAG",
    "BackfillProgress",
    "BacktestRunner",
    "EnvProgress",
    "Job",
    "JobKind",
    "JobStatus",
]
