"""프리셋 10종 — `.athena.yaml v1` 문자열(§6.3, D2). KIS 파리티 10종 이름을 그대로 쓴다.

`data:`/`costs:` 블록은 일부러 뺐다 — 프리셋은 종목·기간·비용을 모르는 순수 전략
템플릿이다(§4.2와 같은 이유: `from_kis_yaml()`이 그 두 블록을 Optional로 두는 것 자체가
"채워지지 않은 채로도 로드돼야 한다"는 계약이다). 사용자가 캔버스에서 종목·기간·비용을
고르고 나서야 완전한 스펙이 된다.

각 프리셋은 이번 단계(P3)에서 구현된 핵심 25종 지표(§6.3)만 쓴다. 원본 KIS 프리셋의
정확한 재현이 아니라 **같은 이름의 전략 아이디어**를 우리 지표 카탈로그로 표현한 것이다
— 조건식 `compare_to`는 `$param` 참조를 못 받는다(그 치환은 지표 `params`에서만 일어난다,
`schema.resolve_params` 문서 참고)는 제약을 그대로 지킨다.
"""

from __future__ import annotations

_SMA_CROSSOVER = """
version: "1.0"
metadata:
  name: SMA 골든크로스
  description: 단기 이평이 장기 이평을 상향 돌파하면 진입, 하향 돌파하면 청산
  tags: [trend, ma]
strategy:
  id: sma_crossover
  category: trend
  params:
    fast: {default: 20, min: 5, max: 60, step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}
"""

_MOMENTUM = """
version: "1.0"
metadata:
  name: 모멘텀 추세추종
  description: 변화율(ROC)이 0 위로 올라오면 진입, 0 아래로 내려가면 청산
  tags: [momentum]
strategy:
  id: momentum
  category: momentum
  params:
    period: {default: 12, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: ROC, alias: roc, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: roc, operator: greater_than, compare_to: 0}
  exit:
    logic: AND
    conditions:
      - {indicator: roc, operator: less_than, compare_to: 0}
risk:
  stop_loss:   {enabled: true,  percent: 10}
  take_profit: {enabled: true,  percent: 20}
  position:    {sizing: all_in}
"""

_WEEK52_HIGH = """
version: "1.0"
metadata:
  name: 52주 신고가 돌파
  description: 종가가 기간 최고가(돈치안 상단)에 닿으면 진입, 기간 최저가(하단)에 닿으면 청산
  tags: [breakout]
strategy:
  id: week52_high
  category: breakout
  params:
    period: {default: 240, min: 20, max: 260, step: 1, type: int}
  indicators:
    - {id: DONCHIAN, alias: dc, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: close, operator: greater_equal, compare_to: dc_upper}
  exit:
    logic: AND
    conditions:
      - {indicator: close, operator: less_equal, compare_to: dc_lower}
risk:
  stop_loss:   {enabled: true,  percent: 12}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""

_CONSECUTIVE_MOVES = """
version: "1.0"
metadata:
  name: 연속 상승/하락
  description: 모멘텀(MOM)이 양전환하면 진입, 음전환하면 청산 — 연속 등락의 근사
  tags: [momentum]
strategy:
  id: consecutive_moves
  category: momentum
  params:
    period: {default: 3, min: 2, max: 10, step: 1, type: int}
  indicators:
    - {id: MOM, alias: mom, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: mom, operator: greater_than, compare_to: 0}
  exit:
    logic: AND
    conditions:
      - {indicator: mom, operator: less_than, compare_to: 0}
risk:
  stop_loss:   {enabled: true,  percent: 6}
  take_profit: {enabled: true,  percent: 12}
  position:    {sizing: all_in}
"""

_MA_DIVERGENCE = """
version: "1.0"
metadata:
  name: 이평 이격
  description: 단기 EMA가 장기 EMA보다 위에 있는 동안 보유(교차가 아니라 상태 비교)
  tags: [trend, ma]
strategy:
  id: ma_divergence
  category: trend
  params:
    fast: {default: 12, min: 3, max: 60, step: 1, type: int}
    slow: {default: 26, min: 10, max: 200, step: 1, type: int}
  indicators:
    - {id: EMA, alias: ema_fast, params: {period: "$fast"}}
    - {id: EMA, alias: ema_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ema_fast, operator: greater_than, compare_to: ema_slow}
  exit:
    logic: AND
    conditions:
      - {indicator: ema_fast, operator: less_than, compare_to: ema_slow}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""

_FALSE_BREAKOUT = """
version: "1.0"
metadata:
  name: 가짜 돌파 되돌림
  description: 종가가 볼린저 하단 아래로 빠지면 진입(과매도 되돌림), 중심선 회복 시 청산
  tags: [reversion, volatility]
strategy:
  id: false_breakout
  category: reversion
  params:
    period: {default: 20, min: 5, max: 60, step: 1, type: int}
    k: {default: 2.0, min: 0.5, max: 4.0, step: 0.1, type: float}
  indicators:
    - {id: BBANDS, alias: bb, params: {period: "$period", k: "$k"}}
  entry:
    logic: AND
    conditions:
      - {indicator: close, operator: less_than, compare_to: bb_lower}
  exit:
    logic: AND
    conditions:
      - {indicator: close, operator: greater_than, compare_to: bb_mid}
risk:
  stop_loss:   {enabled: true,  percent: 5}
  take_profit: {enabled: true,  percent: 10}
  position:    {sizing: all_in}
"""

_STRONG_CLOSE = """
version: "1.0"
metadata:
  name: 강한 종가
  description: Williams %R이 상단 근처(강한 종가)면 진입, 하단 근처(약한 종가)면 청산
  tags: [momentum]
strategy:
  id: strong_close
  category: momentum
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: WILLR, alias: willr, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: willr, operator: greater_than, compare_to: -20}
  exit:
    logic: AND
    conditions:
      - {indicator: willr, operator: less_than, compare_to: -80}
risk:
  stop_loss:   {enabled: true,  percent: 7}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""

_VOLATILITY_BREAKOUT = """
version: "1.0"
metadata:
  name: 변동성 돌파
  description: 정규화 ATR(NATR)이 임계값 위로 확장되면 진입, 수축하면 청산
  tags: [volatility, breakout]
strategy:
  id: volatility_breakout
  category: volatility
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: NATR, alias: natr, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: natr, operator: greater_than, compare_to: 2.0}
  exit:
    logic: AND
    conditions:
      - {indicator: natr, operator: less_than, compare_to: 1.0}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: true,  percent: 16}
  position:    {sizing: all_in}
"""

_SHORT_TERM_REVERSAL = """
version: "1.0"
metadata:
  name: 단기 반전
  description: RSI 과매도에서 진입, 과매수에서 청산
  tags: [reversion]
strategy:
  id: short_term_reversal
  category: reversion
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: RSI, alias: rsi, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: rsi, operator: less_than, compare_to: 30}
  exit:
    logic: AND
    conditions:
      - {indicator: rsi, operator: greater_than, compare_to: 70}
risk:
  stop_loss:   {enabled: true,  percent: 5}
  take_profit: {enabled: true,  percent: 10}
  position:    {sizing: all_in}
"""

_TREND_FILTER_SIGNAL = """
version: "1.0"
metadata:
  name: 추세 필터 신호
  description: ADX로 추세 세기를 거르고 +DI/-DI 교차 방향으로 진입·청산
  tags: [trend]
strategy:
  id: trend_filter_signal
  category: trend
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: ADX, alias: adx1, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: adx1_adx, operator: greater_than, compare_to: 25}
      - {indicator: adx1_plus_di, operator: greater_than, compare_to: adx1_minus_di}
  exit:
    logic: AND
    conditions:
      - {indicator: adx1_plus_di, operator: less_than, compare_to: adx1_minus_di}
risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""

# 등록 순서 = KIS 파리티 표(§2)에 나열된 순서.
PRESETS: dict[str, str] = {
    "sma_crossover": _SMA_CROSSOVER,
    "momentum": _MOMENTUM,
    "week52_high": _WEEK52_HIGH,
    "consecutive_moves": _CONSECUTIVE_MOVES,
    "ma_divergence": _MA_DIVERGENCE,
    "false_breakout": _FALSE_BREAKOUT,
    "strong_close": _STRONG_CLOSE,
    "volatility_breakout": _VOLATILITY_BREAKOUT,
    "short_term_reversal": _SHORT_TERM_REVERSAL,
    "trend_filter_signal": _TREND_FILTER_SIGNAL,
}


def list_presets() -> tuple[str, ...]:
    """등록 순서 그대로 프리셋 id 10개."""
    return tuple(PRESETS)


def preset_yaml(preset_id: str) -> str:
    """프리셋 id → `.athena.yaml` 원문. 없으면 KeyError — 존재하지 않는 프리셋을 조용히 넘기지
    않는다."""
    try:
        return PRESETS[preset_id]
    except KeyError:
        raise KeyError(f"unknown preset: {preset_id}") from None


__all__ = ["PRESETS", "list_presets", "preset_yaml"]
