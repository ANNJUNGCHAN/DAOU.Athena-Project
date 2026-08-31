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
    """
    resolved = resolve_params(spec, overrides)

    frame = df[list(_RAW_COLUMNS)].copy()
    for ind_spec in resolved.strategy.indicators:
        registry_spec = indicators.get(ind_spec.id)
        # 레지스트리가 모르는 키(예: KIS 원본이 남긴 `source: close`)는 조용히 무시한다 —
        # 여기서 계산 함수가 받는 파라미터는 등록된 것만이다(§6.3, 지표별 계약).
        known_params = {k: v for k, v in ind_spec.params.items() if k in registry_spec.params}
        result = registry_spec.fn(df, **known_params)
        for column, series in _indicator_columns(ind_spec, result).items():
            frame[column] = series

    entry = rules.evaluate_group(frame, resolved.strategy.entry)
    exit_ = rules.evaluate_group(frame, resolved.strategy.exit)
    return pd.DataFrame({"entry": entry, "exit": exit_}, index=df.index)


__all__ = ["compile_signals"]
