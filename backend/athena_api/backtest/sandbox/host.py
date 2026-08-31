"""부모 프로세스 쪽 — 전략 코드를 별도 프로세스로 기동하고 결과를 회수한다 (§7.2).

**진짜 경계는 이 파일이 쥔 넷이다**: 자격증명 미전달(env 화이트리스트) · DB 미접근(자식은
DB 핸들을 아예 받지 않는다 — 여기서 열지 않는다) · 별도 프로세스(파이썬 in-process가 아니라
OS 프로세스 경계) · 타임아웃(무한루프 강제 종료). `guard.py`의 import 차단은 사고 방지용
보조선일 뿐 이 넷을 대신하지 않는다.

엔진은 여기 없다. 이 모듈은 jobdir에 입력 3종(spec.json/bars.csv/strategy.py)을 쓰고
자식을 띄운 뒤 출력(signals.csv 또는 error.json, stdout.txt)을 그대로 회수하기만 한다.
체결·비용·성과 계산·DB 쓰기는 engine.py(부모 프로세스, 이 모듈 밖)의 몫이다.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Final

import pandas as pd

DEFAULT_TIMEOUT_SECONDS: Final[float] = 30.0
DEFAULT_STDOUT_CAP_BYTES: Final[int] = 64 * 1024

# 자식에 넘길 env 화이트리스트(§7.2 표 그대로). 이 밖은 원본 os.environ에 뭐가 있든
# 전부 버려진다 — KIWOOM_*·베어러 토큰이 새어 들어갈 길이 구조적으로 없다.
_ENV_ALLOWLIST: Final[tuple[str, ...]] = (
    ("PATH", "PYTHONPATH", "ATHENA_BT_JOB", "SYSTEMROOT")
    if sys.platform == "win32"
    else ("PATH", "PYTHONPATH", "ATHENA_BT_JOB")
)

# backend/ 패키지 루트. `-I` 격리 모드는 사용자 site-packages·PYTHONPATH를 무시하는 게
# 관례적 기대이지만(실측: 이 인터프리터는 venv 자체의 site-packages는 유지하고
# PYTHONPATH도 그대로 반영한다 — editable install이 없는 배포판에서는 이 값이 없으면
# `import athena_api`가 끊길 수 있으므로 방어적으로 항상 채워 넣는다), §7.2 표가 명시한
# 값이라 그대로 따른다.
_PACKAGE_ROOT: Final[Path] = Path(__file__).resolve().parents[3]


def _child_env(jobdir: Path, base_env: dict[str, str] | None = None) -> dict[str, str]:
    """자식에 넘길 env를 화이트리스트로만 구성한다.

    `base_env`를 지정하면 그 값을 원본으로 쓴다 — 테스트가 가짜 os.environ(예: KIWOOM_API_KEY
    포함)을 주입해 화이트리스트가 실제로 걸러내는지 확인하는 용도다. 기본은 실제 프로세스의
    `os.environ`.
    """
    source = os.environ if base_env is None else base_env
    env = {name: source[name] for name in _ENV_ALLOWLIST if name in source}
    env["PYTHONPATH"] = str(_PACKAGE_ROOT)
    env["ATHENA_BT_JOB"] = str(jobdir)
    return env


def _kill_process_tree(pid: int) -> None:
    """자식(및 자식이 낳았을 손자 프로세스까지) 강제 종료.

    psutil을 새 의존으로 들이지 않는다(계획서 10.2 — 새 의존은 최소로). 윈도우는
    `taskkill /T /F`가 프로세스 트리를 재귀적으로 정리해준다. 그 외 OS는 직계 프로세스만
    죽인다 — 배포 타깃이 윈도우라 여기서는 그것으로 충분하다(§11 위험은 이미 알려진 것들이고
    OS 분기 미비는 그 목록에 없다).
    """
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    import signal

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _read_text_if_exists(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def run_strategy(
    jobdir: Path,
    strategy_source: str,
    bars: pd.DataFrame,
    params: dict[str, int | float],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    stdout_cap_bytes: int = DEFAULT_STDOUT_CAP_BYTES,
) -> dict[str, Any]:
    """전략 코드를 별도 프로세스에서 돌리고 결과를 회수한다 (§7.2 다이어그램).

    jobdir에 spec.json(현재 파라미터 값 + stdout 상한) · bars.csv(OHLCV) · strategy.py
    (사용자 코드)를 쓰고, `python -I -B -m athena_api.backtest.sandbox <jobdir>`를 띄운다.

    반환: `{ok, signals_df, stdout, error, elapsed}`.
    - `ok=True`  → `signals_df`에 결과, `error`는 None.
    - `ok=False` → `signals_df`는 None, `error`에 `{type, message, traceback}`.
    타임아웃이면 프로세스(트리)를 강제 종료하고 `error.type == "TimeoutError"`로 보고한다.
    """
    jobdir.mkdir(parents=True, exist_ok=True)
    spec_payload = {"params": params, "stdout_cap_bytes": stdout_cap_bytes}
    (jobdir / "spec.json").write_text(
        json.dumps(spec_payload, ensure_ascii=False), encoding="utf-8"
    )
    bars.to_csv(jobdir / "bars.csv", index=True, index_label="date")
    (jobdir / "strategy.py").write_text(strategy_source, encoding="utf-8")

    env = _child_env(jobdir)
    cmd = [sys.executable, "-I", "-B", "-m", "athena_api.backtest.sandbox", str(jobdir)]

    start = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        cwd=str(jobdir),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    timed_out = False
    stderr_tail = b""
    try:
        _, stderr_tail = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_process_tree(proc.pid)
        _, stderr_tail = proc.communicate()
    elapsed = time.monotonic() - start

    stdout_text = _read_text_if_exists(jobdir / "stdout.txt")

    if timed_out:
        error = {
            "type": "TimeoutError",
            "message": f"{timeout}초 안에 끝나지 않아 강제 종료됨",
            "traceback": "",
        }
        return {
            "ok": False,
            "signals_df": None,
            "stdout": stdout_text,
            "error": error,
            "elapsed": elapsed,
        }

    error_path = jobdir / "error.json"
    if error_path.exists():
        error = json.loads(error_path.read_text(encoding="utf-8"))
        return {
            "ok": False,
            "signals_df": None,
            "stdout": stdout_text,
            "error": error,
            "elapsed": elapsed,
        }

    signals_path = jobdir / "signals.csv"
    if not signals_path.exists():
        detail = (stderr_tail or b"").decode("utf-8", errors="replace")[-2000:]
        error = {
            "type": "SandboxProtocolError",
            "message": f"signals.csv도 error.json도 없이 종료됨(returncode={proc.returncode})",
            "traceback": detail,
        }
        return {
            "ok": False,
            "signals_df": None,
            "stdout": stdout_text,
            "error": error,
            "elapsed": elapsed,
        }

    signals_df = pd.read_csv(signals_path, index_col=0, parse_dates=True)
    return {
        "ok": True,
        "signals_df": signals_df,
        "stdout": stdout_text,
        "error": None,
        "elapsed": elapsed,
    }
