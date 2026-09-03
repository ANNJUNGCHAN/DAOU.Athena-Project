"""감시 함수 실행 — 백테스트 샌드박스를 빌려 별도 프로세스에서 돌리고 마지막 행을 판정한다.

- 계약은 백테스트와 같다: `signals(df, p)` → `entry`(=발화)·`exit`(항상 False) 2열,
  **마지막 행이 판정**.
- 매 실행마다 임시 jobdir을 만들고 스레드 안 try/finally로 지운다(백테스트 runner와 같은 이유 —
  `run_strategy`는 jobdir을 지우지 않는다).
- 동시 실행은 세마포어로 묶는다. 샌드박스는 프로세스 기동 비용이 있으므로 폴링 주기 안에서
  종목 수만큼 한꺼번에 띄우지 않는다.
- `trace=True`면 최상위 함수 전부(signals 포함)를 계측 대상으로 넘겨 `node_io`를 받는다.
"""

from __future__ import annotations

import ast
import asyncio
import shutil
import tempfile
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import Executor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from athena_api.backtest.sandbox import host

DEFAULT_MAX_CONCURRENT = 2
DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class RunResult:
    observed: bool | None  # 마지막 행 entry — 실패면 None
    duration_ms: int
    node_io: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    signals_df: pd.DataFrame | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.observed is not None


def trace_names_for(source: str) -> list[str]:
    """소스의 최상위 함수 이름 전부(정의 순서, signals 포함). 파싱이 안 되면 빈 목록."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    return [node.name for node in tree.body if isinstance(node, ast.FunctionDef)]


def verdict_for_last_row(signals_df: pd.DataFrame | None) -> bool:
    """검사와 실행 루프가 함께 쓰는 단 하나의 판정 — 마지막 행 `entry`가 참인가(B-18)."""
    if signals_df is None or signals_df.empty or "entry" not in signals_df.columns:
        return False
    value = signals_df["entry"].iloc[-1]
    if pd.isna(value):
        return False
    return bool(value)


class WatchRunner:
    """감시 함수 실행기. 루틴 런타임이 주입받아 폴링 루프와 검사 라우트가 함께 쓴다."""

    def __init__(
        self,
        *,
        executor: Executor | None = None,
        max_concurrent: int = DEFAULT_MAX_CONCURRENT,
        run_strategy: Callable[..., dict[str, Any]] = host.run_strategy,
        python_exe: str | None = None,
        allowed_imports: Sequence[str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        tmp_root: Path | None = None,
    ) -> None:
        self._executor = executor
        self.max_concurrent = max(1, int(max_concurrent))
        self._run_strategy = run_strategy
        self._python_exe = python_exe
        self._allowed_imports = list(allowed_imports) if allowed_imports else None
        self._timeout = timeout
        self._tmp_root = tmp_root
        self._gate = threading.BoundedSemaphore(self.max_concurrent)
        self._active = 0
        self._active_lock = threading.Lock()
        self.peak_active = 0

    # ── 동기 실행(검사·스레드 풀 안) ─────────────────────────────────────────
    def run_once(
        self,
        source: str,
        df: pd.DataFrame,
        params: dict[str, Any] | None = None,
        *,
        trace: bool = False,
    ) -> RunResult:
        names = trace_names_for(source) if trace else None
        started = time.monotonic()
        with self._gate:
            with self._active_lock:
                self._active += 1
                self.peak_active = max(self.peak_active, self._active)
            jobdir = Path(tempfile.mkdtemp(prefix="athena-watch-", dir=self._tmp_root))
            try:
                raw = self._run_strategy(
                    jobdir,
                    source,
                    df,
                    dict(params or {}),
                    timeout=self._timeout,
                    python_exe=self._python_exe,
                    allowed_imports=self._allowed_imports,
                    trace_names=names,
                )
            finally:
                shutil.rmtree(jobdir, ignore_errors=True)
                with self._active_lock:
                    self._active -= 1
        duration_ms = int((time.monotonic() - started) * 1000)
        node_io = raw.get("node_io")
        if not raw.get("ok"):
            return RunResult(
                observed=None,
                duration_ms=duration_ms,
                node_io=node_io,
                error=raw.get("error")
                or {"type": "SandboxError", "message": "샌드박스 실패 — 원인 없음"},
            )
        signals_df = raw.get("signals_df")
        return RunResult(
            observed=verdict_for_last_row(signals_df),
            duration_ms=duration_ms,
            node_io=node_io,
            error=None,
            signals_df=signals_df,
        )

    # ── 비동기 실행(폴링 루프) ───────────────────────────────────────────────
    async def run(
        self,
        source: str,
        df: pd.DataFrame,
        params: dict[str, Any] | None = None,
        *,
        trace: bool = False,
    ) -> RunResult:
        """실시간 루프를 막지 않도록 스레드 풀로 보낸다(B-15)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor, lambda: self.run_once(source, df, params, trace=trace)
        )
