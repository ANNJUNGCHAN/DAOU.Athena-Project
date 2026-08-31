"""파라미터 최적화 — 그리드·랜덤 서치와 과최적화 경고(§6.1 optimize.py, Paper 보드 06).

**왜 조합을 실행마다 DB에 쓰지 않나.** 그리드 하나가 수백 조합이다. 조합마다 `bt_run` 행을
만들면 이력 화면(보드 05)이 사람이 고른 실행과 서치가 만든 조합을 구분하지 못한다 — 이력은
"내가 돌린 것"의 목록이어야 한다. 그래서 서치는 메모리에서 돌고, `bt_optimize` 한 행과
최고 조합의 `best_run_id` 하나만 남긴다.

**왜 캐시만 쓰나.** 서치는 같은 구간을 수백 번 재계산할 뿐 새 데이터를 필요로 하지 않는다.
호출자가 넘긴 df 하나를 모든 조합이 공유한다 — TR 호출은 0이다(보드 06 "추가 TR 호출 없음").

**과최적화 경고를 왜 여기서 내나.** "최고 조합"만 돌려주면 화면은 그 값을 신뢰할 수밖에
없다. 최고점이 이웃보다 뚝 튀어 있다는 사실은 서치 결과 안에만 있는 정보이므로, 그 사실을
아는 이 모듈이 같이 내보낸다 — 화면이 나중에 다시 추정하면 두 계산이 갈라진다(metrics.py가
`warmup_bars`를 호출자에게 받는 것과 같은 이유).
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from itertools import product
from typing import Any, Literal

import pandas as pd

from athena_api.backtest.compile import compile_signals
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.metrics import compute_metrics
from athena_api.backtest.schema import StrategySpec

Method = Literal["grid", "random"]

# 조합 상한 — 넘으면 실행하지 않고 거부한다(§9 "조합 수 상한 넘으면 blocked").
# 근거: 일봉 10년(2,500봉) 한 조합이 실측 ~7ms다. 1,000조합이면 ~7초 — 사람이 화면 앞에서
# 기다릴 수 있는 상한을 여기로 잡는다. 넘으면 step을 키우거나 랜덤 서치를 쓰라고 말한다.
MAX_COMBINATIONS: int = 1000

# 과최적화 판정 — 최고점이 이웃 평균보다 이만큼(Sharpe 절대값) 높으면 "외딴 봉우리"로 본다.
# 보드 06의 문구("최고점이 이웃보다 0.4 이상 튑니다")를 그대로 상수로 고정한다.
LONELY_PEAK_MARGIN: float = 0.4


@dataclass(frozen=True, slots=True)
class ParamRange:
    """한 파라미터가 훑을 값들. `values()`가 실제 후보 목록을 만든다."""

    name: str
    start: float
    stop: float
    step: float
    is_int: bool = True

    def values(self) -> tuple[float, ...]:
        if self.step <= 0:
            raise ValueError(f"step은 0보다 커야 한다: {self.name}")
        if self.stop < self.start:
            raise ValueError(f"stop은 start보다 작을 수 없다: {self.name}")
        out: list[float] = []
        # 부동소수 누적 오차로 마지막 값이 빠지는 것을 막으려고 정수 인덱스로 센다.
        count = int(math.floor((self.stop - self.start) / self.step)) + 1
        for i in range(count):
            v = self.start + i * self.step
            out.append(int(round(v)) if self.is_int else round(v, 10))
        return tuple(out)


@dataclass(frozen=True, slots=True)
class Trial:
    """조합 하나의 결과. `error`가 있으면 그 조합은 계산되지 않았다(지어낸 0을 넣지 않는다)."""

    params: dict[str, float]
    sharpe: float | None
    total_return: float | None
    mdd: float | None
    trades: int
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Warning_:
    """과최적화 경고 한 건. `kind`로 화면이 문구를 고른다."""

    kind: Literal["lonely_peak", "few_trades", "all_failed"]
    message: str


@dataclass(frozen=True, slots=True)
class OptimizeResult:
    method: Method
    ranges: tuple[ParamRange, ...]
    trials: tuple[Trial, ...]
    best: Trial | None
    neighbour_mean_sharpe: float | None
    plateau: dict[str, tuple[float, float]] | None
    warnings: tuple[Warning_, ...] = field(default_factory=tuple)


def _combinations(ranges: Sequence[ParamRange]) -> Iterator[dict[str, float]]:
    names = [r.name for r in ranges]
    for combo in product(*(r.values() for r in ranges)):
        yield dict(zip(names, combo, strict=True))


def count_combinations(
    ranges: Sequence[ParamRange],
    constraint: Callable[[dict[str, float]], bool] | None = None,
) -> int:
    """실행 전에 화면이 보여줄 조합 수(보드 06 "조합 276개"). 제약을 통과한 것만 센다."""
    if constraint is None:
        total = 1
        for r in ranges:
            total *= len(r.values())
        return total
    return sum(1 for combo in _combinations(ranges) if constraint(combo))


def ascending_constraint(*names: str) -> Callable[[dict[str, float]], bool]:
    """`fast < slow`처럼 "앞 파라미터가 뒤보다 작아야 한다"를 표현한다.

    이 제약이 없으면 그리드 절반이 의미 없는 조합(단기 이평이 장기보다 긴 경우)으로
    채워지고, 그 조합들의 성과가 히트맵의 색 범위를 망가뜨린다.
    """

    def check(combo: dict[str, float]) -> bool:
        return all(combo[a] < combo[b] for a, b in zip(names, names[1:], strict=False))

    return check


def _run_one(
    spec: StrategySpec,
    df: pd.DataFrame,
    params: dict[str, float],
    initial_cash: float,
) -> Trial:
    try:
        signals = compile_signals(spec, df, params)
        result = run_backtest(df, signals, spec.risk, spec.costs, initial_cash=initial_cash)
        metrics = compute_metrics(result.equity, result.trades, df, initial_cash=initial_cash)
    except Exception as exc:  # noqa: BLE001 — 조합 하나의 실패가 서치 전체를 죽이면 안 된다
        return Trial(params=params, sharpe=None, total_return=None, mdd=None,
                     trades=0, error=str(exc))
    return Trial(
        params=params,
        sharpe=metrics.sharpe,
        total_return=metrics.total_return,
        mdd=metrics.mdd,
        trades=len(result.trades),
    )


def _neighbours(best: dict[str, float], trials: Sequence[Trial],
                ranges: Sequence[ParamRange]) -> list[Trial]:
    """최고 조합에서 각 축으로 한 칸 이내인 조합들 — 봉우리가 외딴지 판단하는 근거다."""
    step_by_name = {r.name: r.step for r in ranges}
    out: list[Trial] = []
    for t in trials:
        if t.sharpe is None or t.params == best:
            continue
        # 각 축의 차이가 그 축 step의 1배 이내(부동소수 여유 1e-9)면 이웃으로 본다.
        if all(
            abs(t.params[name] - value) <= step_by_name[name] + 1e-9
            for name, value in best.items()
        ):
            out.append(t)
    return out


def _plateau(trials: Sequence[Trial], ranges: Sequence[ParamRange],
             floor: float) -> dict[str, tuple[float, float]] | None:
    """Sharpe가 `floor` 이상인 조합들이 각 축에서 차지하는 범위 — 보드 06의 "넓은 언덕".

    봉우리 하나가 아니라 구간을 권하는 이유는, 미래에도 좋을 가능성이 높은 쪽은
    "혼자 튀는 점"이 아니라 "주변까지 같이 좋은 구간"이기 때문이다.
    """
    good = [t for t in trials if t.sharpe is not None and t.sharpe >= floor]
    if len(good) < 2:
        return None
    out: dict[str, tuple[float, float]] = {}
    for r in ranges:
        values = [t.params[r.name] for t in good]
        out[r.name] = (min(values), max(values))
    return out


def optimize(
    spec: StrategySpec,
    df: pd.DataFrame,
    ranges: Sequence[ParamRange],
    *,
    method: Method = "grid",
    samples: int | None = None,
    seed: int | None = None,
    constraint: Callable[[dict[str, float]], bool] | None = None,
    initial_cash: float = DEFAULT_INITIAL_CASH,
    on_progress: Callable[[int, int], None] | None = None,
) -> OptimizeResult:
    """조합을 훑어 Sharpe 기준 최고 조합과 과최적화 경고를 낸다.

    `method="random"`이면 `samples`개를 무작위로 뽑는다 — `seed`를 주면 같은 결과가 나온다
    (재현성 축은 여기서도 지킨다: 같은 입력 → 같은 출력).
    """
    if not ranges:
        raise ValueError("최적화할 파라미터 범위가 없다")

    combos = [c for c in _combinations(ranges) if constraint is None or constraint(c)]
    if method == "random":
        n = samples if samples is not None else min(len(combos), 100)
        rng = random.Random(seed)
        combos = rng.sample(combos, min(n, len(combos)))
    if len(combos) > MAX_COMBINATIONS:
        raise ValueError(
            f"조합이 {len(combos)}개로 상한 {MAX_COMBINATIONS}개를 넘는다 — "
            "step을 키우거나 랜덤 서치를 쓰세요"
        )

    trials: list[Trial] = []
    for i, combo in enumerate(combos, start=1):
        trials.append(_run_one(spec, df, combo, initial_cash))
        if on_progress is not None:
            on_progress(i, len(combos))

    scored = [t for t in trials if t.sharpe is not None]
    warnings: list[Warning_] = []
    if not scored:
        return OptimizeResult(
            method=method, ranges=tuple(ranges), trials=tuple(trials), best=None,
            neighbour_mean_sharpe=None, plateau=None,
            warnings=(Warning_("all_failed", "모든 조합이 계산되지 않았습니다"),),
        )

    best = max(scored, key=lambda t: t.sharpe or 0.0)
    neighbours = _neighbours(best.params, scored, ranges)
    neighbour_mean = (
        sum(t.sharpe or 0.0 for t in neighbours) / len(neighbours) if neighbours else None
    )

    if neighbour_mean is not None and (best.sharpe or 0.0) - neighbour_mean >= LONELY_PEAK_MARGIN:
        warnings.append(
            Warning_(
                "lonely_peak",
                f"최고점 Sharpe {best.sharpe:.2f}가 이웃 평균 {neighbour_mean:.2f}보다 "
                f"{(best.sharpe or 0.0) - neighbour_mean:.2f} 높습니다 — 외딴 봉우리입니다",
            )
        )
    if best.trades < 10:
        warnings.append(
            Warning_(
                "few_trades",
                f"최고 조합의 체결이 {best.trades}건뿐입니다 — 표본이 적어 성과를 믿기 어렵습니다",
            )
        )

    floor = neighbour_mean if neighbour_mean is not None else (best.sharpe or 0.0) * 0.75
    return OptimizeResult(
        method=method,
        ranges=tuple(ranges),
        trials=tuple(trials),
        best=best,
        neighbour_mean_sharpe=neighbour_mean,
        plateau=_plateau(scored, ranges, floor),
        warnings=tuple(warnings),
    )


def heatmap(result: OptimizeResult, x: str, y: str) -> dict[str, Any]:
    """두 축의 Sharpe 격자 — 보드 06 히트맵이 그대로 그리는 모양.

    `cells`는 `[{x, y, sharpe}]`다. 셋 이상의 축을 최적화했다면 (x, y)가 같은 조합이
    여럿이므로 그중 최고 Sharpe만 남긴다 — 격자 한 칸에 값이 둘일 수 없다.
    """
    best_by_cell: dict[tuple[float, float], float] = {}
    for t in result.trials:
        if t.sharpe is None or x not in t.params or y not in t.params:
            continue
        key = (t.params[x], t.params[y])
        if key not in best_by_cell or t.sharpe > best_by_cell[key]:
            best_by_cell[key] = t.sharpe
    cells = [{"x": kx, "y": ky, "sharpe": s} for (kx, ky), s in sorted(best_by_cell.items())]
    return {
        "x_axis": x,
        "y_axis": y,
        "cells": cells,
        "min_sharpe": min((c["sharpe"] for c in cells), default=None),
        "max_sharpe": max((c["sharpe"] for c in cells), default=None),
    }


__all__ = [
    "LONELY_PEAK_MARGIN",
    "MAX_COMBINATIONS",
    "Method",
    "OptimizeResult",
    "ParamRange",
    "Trial",
    "Warning_",
    "ascending_constraint",
    "count_combinations",
    "heatmap",
    "optimize",
]
