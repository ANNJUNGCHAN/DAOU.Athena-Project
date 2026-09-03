"""샌드박스 자식 진입점 — 별도 프로세스에서만 실행된다 (§7.2).

진입: `python -s -P -B -m athena_api.backtest.sandbox <jobdir>`. host.py가 이 명령으로만
띄운다 — 사람이 직접 부를 일이 없다(플래그를 고른 이유는 host.py `_CHILD_FLAGS`).

책임은 signals 생성까지다. 체결·비용·성과 계산·DB 쓰기는 전부 부모(engine.py)의 몫이고,
이 프로세스는 DB 핸들도 자격증명도 받지 않는다 — 전략 코드가 성과 수치를 직접 쓸 방법이
구조적으로 없다.

프로토콜: jobdir에서 spec.json(파라미터 값 + stdout 상한 + 선택적 allowed_imports) ·
bars.csv(OHLCV) · strategy.py(사용자 코드)를 읽고, jobdir에 signals.csv(성공) 또는
error.json(실패)과 stdout.txt를 쓴다. spec.json에 `trace_names`가 실려 있을 때만
node_io.json(계측 산출물)을 하나 더 쓴다 — 키가 없으면 이 파일은 생기지 않는다.
"""

from __future__ import annotations

import io
import json
import sys
import traceback
from pathlib import Path

import numpy as np
import pandas as pd

from athena_api.backtest.sandbox import api as _bt_api
from athena_api.backtest.sandbox import guard

_TRUNCATION_MARK = "\n[잘림]"

# node_io.json 유계 상한 — stdout 64KB 상한과 같은 취지다(계획서 §1(c)).
_NODE_IO_MAX_ENTRIES = 64
_NODE_IO_MAX_STR = 200
_NODE_IO_MAX_COLUMNS = 8


def _summarize(value: object) -> object:
    """계측값을 유계 스칼라(또는 마지막 행)로 줄인다.

    Series·DataFrame은 **마지막 행**만 남긴다 — 판정이 일어나는 행이 거기고, 전체를 실으면
    산출물이 봉 수만큼 커진다.
    """
    if isinstance(value, pd.DataFrame):
        if value.empty:
            return None
        row = value.iloc[-1]
        return {str(col): _summarize(row[col]) for col in value.columns[:_NODE_IO_MAX_COLUMNS]}
    if isinstance(value, pd.Series):
        if value.empty:
            return None
        return _summarize(value.iloc[-1])
    if isinstance(value, np.generic):
        return _summarize(value.item())
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return value[:_NODE_IO_MAX_STR]
    return repr(value)[:_NODE_IO_MAX_STR]


def _record(name: str, fn, state: dict) -> object:
    """`fn` 호출을 잡아 마지막 호출 1건을 `state`에 남기는 래퍼."""

    def _remember(args: tuple, kwargs: dict, returned: object, error: str | None) -> None:
        calls = state["calls"]
        if name not in calls and len(calls) >= _NODE_IO_MAX_ENTRIES:
            state["truncated"] = True
            return
        calls[name] = {
            "name": name,
            "args": [_summarize(a) for a in args],
            "kwargs": {str(k): _summarize(v) for k, v in kwargs.items()},
            "returned": returned,
            "error": error,
        }

    def wrapper(*args, **kwargs):
        try:
            returned = fn(*args, **kwargs)
        except BaseException as exc:
            # 오류 경로에서도 부분 기록을 남긴다 — 어디서 어긋났는지가 여기 보인다.
            _remember(args, kwargs, None, f"{type(exc).__name__}: {exc}"[:_NODE_IO_MAX_STR])
            raise
        _remember(args, kwargs, _summarize(returned), None)
        return returned

    return wrapper


def _write_node_io(jobdir: Path, state: dict) -> None:
    (jobdir / "node_io.json").write_text(
        json.dumps(state, ensure_ascii=False, default=str), encoding="utf-8"
    )


def _write_error(jobdir: Path, exc: BaseException) -> None:
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    payload = {
        "type": type(exc).__name__,
        "message": str(exc),
        # 트레이스백은 참고용이라 지나치게 길 필요가 없다 — 꼬리 4000자만 남긴다.
        "traceback": tb[-4000:],
    }
    (jobdir / "error.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _write_stdout(jobdir: Path, text: str, cap_bytes: int) -> None:
    data = text.encode("utf-8")
    if len(data) > cap_bytes:
        # 바이트 경계에서 자르면 마지막 UTF-8 문자가 깨질 수 있어 errors="ignore"로 흘린다
        # — 디버그용 print 로그라 한 글자 유실이 문제 되지 않는다.
        text = data[:cap_bytes].decode("utf-8", errors="ignore") + _TRUNCATION_MARK
    (jobdir / "stdout.txt").write_text(text, encoding="utf-8")



def _coerce_signals(result: object) -> object:
    """(entry, exit) 튜플·리스트나 {"entry":…, "exit":…} dict도 DataFrame으로 받아준다.

    모델이 짠 전략 코드가 시리즈 둘을 튜플로 돌려주는 일이 잦다(2026-09-02 실채팅 시나리오
    실측 — 그 한 번의 계약 위반이 오류→진단 경로로 빠졌다). 계약 문서는 DataFrame 그대로지만,
    뜻이 분명한 모양은 여기서 흡수한다. 그 밖의 값은 그대로 돌려보내 기존 TypeError가 난다.
    """
    if isinstance(result, pd.DataFrame):
        return result
    if (
        isinstance(result, (tuple, list))
        and len(result) == 2
        and all(isinstance(s, pd.Series) for s in result)
    ):
        return pd.DataFrame({"entry": result[0], "exit": result[1]})
    if (
        isinstance(result, dict)
        and {"entry", "exit"} <= set(result)
        and all(isinstance(result[k], pd.Series) for k in ("entry", "exit"))
    ):
        return pd.DataFrame({"entry": result["entry"], "exit": result["exit"]})
    return result


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m athena_api.backtest.sandbox <jobdir>", file=sys.stderr)
        return 2
    jobdir = Path(argv[1]).resolve()

    # athena_bt를 top-level 이름으로 별칭 건다 — 전략 코드의 `import athena_bt as bt`가
    # 실제 설치된 패키지 없이도 sys.modules 캐시로 바로 해석되게 하는 배선이다. guard 설치
    # 전에(=신뢰 구간에서) 해야 한다 — api.py 내부의 athena_api.backtest.indicators import가
    # 허용목록 검사에 걸리면 안 되기 때문이다.
    sys.modules["athena_bt"] = _bt_api

    cap_bytes = 64 * 1024
    trace_state: dict | None = None
    captured = io.StringIO()
    real_stdout = sys.stdout
    sys.stdout = captured
    try:
        spec = json.loads((jobdir / "spec.json").read_text(encoding="utf-8"))
        params = spec.get("params", {})
        cap_bytes = int(spec.get("stdout_cap_bytes", cap_bytes))
        bars = pd.read_csv(jobdir / "bars.csv", index_col=0, parse_dates=True)
        strategy_path = jobdir / "strategy.py"
        source = strategy_path.read_text(encoding="utf-8")

        strategy_globals: dict = {"__name__": "__athena_strategy__"}
        # 프로젝트 가상환경으로 돌 때 host가 그 환경의 패키지 이름을 실어 보낸다. 넓히는
        # 값이지만 guard의 차단목록이 그 위에 다시 적용된다 — os·subprocess는 여기로 못 들어온다.
        guard.install(strategy_globals, jobdir, allowed_imports=spec.get("allowed_imports"))

        code = compile(source, str(strategy_path), "exec")
        exec(code, strategy_globals)  # noqa: S102 — 이 프로세스의 존재 이유 자체가 이 실행이다.

        # 계측(opt-in). `signals_fn`을 집기 **전에** 갈아 끼워야 바깥 `signals` 호출도
        # 기록된다. 키가 없으면 이 구간은 통째로 건너뛰고 산출물도 안 생긴다(B-10a).
        names = spec.get("trace_names")
        if isinstance(names, list) and names:
            trace_state = {"calls": {}, "truncated": False}
            for name in names:
                fn = strategy_globals.get(name)
                # 함수만 감싼다 — 클래스·모듈·상수는 그대로 둔다.
                if callable(fn) and not isinstance(fn, type):
                    strategy_globals[name] = _record(str(name), fn, trace_state)

        signals_fn = strategy_globals.get("signals")
        if not callable(signals_fn):
            raise ValueError("전략 코드에 signals(df, p) 함수가 없다")

        result = _coerce_signals(signals_fn(bars, params))
        if not isinstance(result, pd.DataFrame):
            raise TypeError("signals()는 DataFrame을 반환해야 한다")
        missing = {"entry", "exit"} - set(result.columns)
        if missing:
            raise ValueError(f"signals() 반환에 필요한 열이 없다: {sorted(missing)}")

        result.to_csv(jobdir / "signals.csv", index=True, index_label="date")
    except BaseException as exc:
        sys.stdout = real_stdout
        _write_stdout(jobdir, captured.getvalue(), cap_bytes)
        if trace_state is not None:
            _write_node_io(jobdir, trace_state)
        _write_error(jobdir, exc)
        return 1
    else:
        sys.stdout = real_stdout
        _write_stdout(jobdir, captured.getvalue(), cap_bytes)
        if trace_state is not None:
            _write_node_io(jobdir, trace_state)
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
