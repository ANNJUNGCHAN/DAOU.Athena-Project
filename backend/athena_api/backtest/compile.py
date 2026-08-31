"""선언형 경로 — `StrategySpec` + 캔들 df → signals DataFrame(§6.2).

```
[폼 / .athena.yaml] ──compile.py──┐
                                  ├──→ signals DataFrame ──→ engine.py
[파이썬 전략 코드] ──sandbox 프로세스──┘
```

두 경로가 여기(signals 계약)로 모인다 — 지표 계산은 `indicators` 레지스트리(§6.3, 파이썬
전략 코드의 `athena_bt`와 같은 구현)에 위임하고, `$fast` 같은 파라미터 참조는
`schema.resolve_params()`가 실행 직전에 한 번 치환한다. 이 파일은 그 둘을 조립해 조건을
평가할 프레임을 만드는 일만 한다 — 지표나 파라미터 치환 로직을 다시 짜지 않는다.
"""

from __future__ import annotations

import pandas as pd

from athena_api.backtest import indicators, rules
from athena_api.backtest.schema import IndicatorSpec, StrategySpec, resolve_params

# 캔들 df가 반드시 갖는 원시 열. 조건식이 지표 별칭뿐 아니라 이 열도 직접 참조할 수 있다
# (예: 52주 신고가 돌파를 "close >= donchian_upper"로 표현하려면 close가 프레임에 있어야 한다).
_RAW_COLUMNS: tuple[str, ...] = ("open", "high", "low", "close", "volume")


def _indicator_columns(
    ind_spec: IndicatorSpec, result: pd.Series | pd.DataFrame
) -> dict[str, pd.Series]:
    """지표 결과를 프레임에 얹을 컬럼명으로 매핑한다.

    출력이 하나뿐인 지표(SMA 등)는 별칭 그대로(`ma_fast`)를 컬럼명으로 쓴다. 여러 출력을
    내는 지표(MACD·ADX·BBANDS 등)는 `별칭_출력명`(`macd1_signal`)으로 갈라 각 출력을
    조건식에서 개별적으로 참조할 수 있게 한다.
    """
    registry_spec = indicators.get(ind_spec.id)
    if len(registry_spec.outputs) == 1:
        return {ind_spec.alias: result}
    return {f"{ind_spec.alias}_{name}": result[name] for name in registry_spec.outputs}


def compile_signals_with_warmup(
    spec: StrategySpec,
    df: pd.DataFrame,
    overrides: dict[str, int | float] | None = None,
) -> tuple[pd.DataFrame, int]:
    """`compile_signals`와 같은 계산을 하되 워밍업 봉 수를 같이 돌려준다.

    **왜 워밍업을 여기서 세나.** SMA(60)은 앞 59봉이 NaN이다 — 그 구간에는 신호가 원천적으로
    나올 수 없으므로 수익률이 0으로 깔린다. metrics.py가 그 0수익일을 Sharpe 표준편차에
    넣으면 Sharpe가 부풀려진다(§6.5가 KIS 원본의 결함으로 지목한 바로 그것). 워밍업 길이는
    지표와 파라미터에 따라 달라지므로 metrics가 스스로 추정하면 두 계산이 갈라진다 —
    지표 프레임을 실제로 만든 이 함수만이 그 값을 사실로 안다.

    세는 방법: 지표 열 중 하나라도 NaN인 **선두 구간**의 길이. 중간에 뚫린 NaN은 세지 않는다
    (그건 워밍업이 아니라 데이터 결손이고, 다른 문제다).
    """
    resolved = resolve_params(spec, overrides)

    frame = df[list(_RAW_COLUMNS)].copy()
    indicator_columns: list[str] = []
    for ind_spec in resolved.strategy.indicators:
        registry_spec = indicators.get(ind_spec.id)
        known_params = {k: v for k, v in ind_spec.params.items() if k in registry_spec.params}
        result = registry_spec.fn(df, **known_params)
        for column, series in _indicator_columns(ind_spec, result).items():
            frame[column] = series
            indicator_columns.append(column)

    warmup = 0
    if indicator_columns:
        valid = frame[indicator_columns].notna().all(axis=1)
        # 첫 True의 위치가 곧 워밍업 길이다. 전부 False면 신호가 아예 못 나오므로 전체 길이.
        warmup = int(valid.values.argmax()) if bool(valid.any()) else len(frame)

    entry = rules.evaluate_group(frame, resolved.strategy.entry)
    exit_ = rules.evaluate_group(frame, resolved.strategy.exit)
    signals = pd.DataFrame({"entry": entry, "exit": exit_}, index=df.index)
    return signals, warmup


def compile_signals(
    spec: StrategySpec,
    df: pd.DataFrame,
    overrides: dict[str, int | float] | None = None,
) -> pd.DataFrame:
    """`.athena.yaml`(폼) 전략과 캔들 df로 signals(§6.2 계약)를 만든다.

    `df`는 `open,high,low,close,volume` 열과 오름차순 DatetimeIndex를 갖는다고 가정한다
    (§6.2 SSoT — 검증은 데이터 층의 책임이지 이 함수의 책임이 아니다). `overrides`는
    그리드 서치가 파라미터 조합을 바꿔 넣을 때 쓴다(`resolve_params`에 그대로 위임).

    반환값의 `size` 컬럼은 없다 — P3의 유일한 사이징(`risk.position.sizing == "all_in"`)은
    "없으면 1.0"이라는 signals 계약의 기본값과 정확히 같으므로, 엔진이 항상 이미 알고 있는
    값을 새 컬럼으로 지어내지 않는다.

    워밍업 길이도 필요하면 `compile_signals_with_warmup()`을 쓴다 — 이 함수는 그 래퍼다.
    레지스트리가 모르는 키(예: KIS 원본이 남긴 `source: close`)는 조용히 무시한다.
    """
    signals, _warmup = compile_signals_with_warmup(spec, df, overrides)
    return signals


__all__ = ["compile_signals", "compile_signals_with_warmup"]
