"""핵심 지표 25종 — 프리셋 10종이 쓰는 것들(P3, §6.3).

나머지 55종은 P6에서 pandas-ta 위임을 먼저 평가한다. 여기 25종은 채택 여부와 무관하게
직접 구현으로 고정한다 — 손계산 골든 픽스처로 값을 대조하는 기준선이기 때문이다.

공통 규칙:
- 워밍업 구간(지표를 계산할 만큼 과거 봉이 없는 구간)은 NaN. 0이나 첫값으로 채우지 않는다
  — "아직 모른다"와 "계산해보니 0이다"는 다른 사실이다.
- Wilder 평활(RSI/ATR/ADX)과 단순 EMA는 다른 가중치 방식이다. 어느 쪽을 썼는지 함수마다 명시한다.
- 파이썬 for 루프는 재귀적으로 정의돼 벡터화가 근본적으로 불가능한 곳(SAR, Wilder 평활)에만 쓴다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .registry import ParamSpec, register


def _true_range(df: pd.DataFrame) -> pd.Series:
    """TR = max(고가-저가, |고가-전일종가|, |저가-전일종가|). ATR/ADX가 공유하는 원재료.
    첫 봉은 전일종가가 없어 NaN — high-low만으로 대신하지 않는다(다른 정의를 섞지 않는다)."""
    prev_close = df.close.shift(1)
    return pd.concat(
        [df.high - df.low, (df.high - prev_close).abs(), (df.low - prev_close).abs()],
        axis=1,
    ).max(axis=1, skipna=False)


def _wilder_smooth(values: pd.Series, period: int) -> pd.Series:
    """Wilder 평활(1978, 『New Concepts in Technical Trading Systems』) — RSI/ATR/ADX가 공유한다.

    첫 값은 유효한 첫 `period`개의 단순평균으로 시드하고, 그 뒤로는
    prev*(period-1)/period + new/period 로 재귀 갱신한다. 이는 EMA(alpha=1/period)와
    다르다 — EMA는 첫 원시값을 그대로 시드로 쓰지만 Wilder는 SMA로 시드한다.
    시드 이후가 이전 평활값에 의존하는 순수 재귀라 벡터화할 수 없어 루프를 쓴다.
    """
    out = pd.Series(np.nan, index=values.index, dtype=float)
    valid = values.dropna()
    if len(valid) < period:
        return out
    arr = valid.to_numpy(dtype=float)
    idx = valid.index
    seed = float(arr[:period].mean())
    out.loc[idx[period - 1]] = seed
    prev = seed
    for i in range(period, len(arr)):
        prev = (prev * (period - 1) + arr[i]) / period
        out.loc[idx[i]] = prev
    return out


def _ema(series: pd.Series, period: int) -> pd.Series:
    """단순 EMA(alpha=2/(period+1)). 관례상 첫 `period`개는 SMA로 시드하고 그 뒤부터
    재귀식을 적용한다 — Wilder 평활과 달리 가중치가 2/(period+1)이다.

    구현: 선행 NaN을 걷어낸 유효구간 기준으로 첫 period개를 SMA 시드로 바꿔치기한 뒤
    ewm(adjust=False)에 맡긴다. pandas ewm은 선행 NaN을 만나면 그 뒤 첫 유효값을 시작점(y0)으로
    삼아 재귀를 이어가므로, 이 트릭으로 파이썬 루프 없이 "SMA 시드 + 재귀"를 재현한다.
    유효구간 기준으로 계산하는 이유: DEMA/TEMA/MACD 신호선처럼 이미 워밍업 NaN이 있는
    시리즈를 다시 감쌀 때(EMA의 EMA), 절대 위치가 아니라 "실제로 값이 있는 곳"부터
    period개를 세야 시드가 맞다.
    """
    out = pd.Series(np.nan, index=series.index, dtype=float)
    valid = series.dropna()
    if len(valid) < period:
        return out
    seed = valid.iloc[:period].mean()
    seeded = valid.copy()
    seeded.iloc[: period - 1] = np.nan
    seeded.iloc[period - 1] = seed
    ema_valid = seeded.ewm(span=period, adjust=False).mean()
    out.loc[ema_valid.index] = ema_valid
    return out


# ── 이동평균 계열 ─────────────────────────────────────────────────────────


def _sma(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """단순이동평균. period=20은 추세 추종 지표의 관례적 기본값(일봉 기준 한 달 거래일)."""
    return df.close.rolling(period).mean()


def _ema_fn(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """지수이동평균. period=20은 SMA와 같은 자리에서 흔히 대체로 쓰이는 관례값."""
    return _ema(df.close, period)


def _wma(df: pd.DataFrame, period: int = 10) -> pd.Series:
    """가중이동평균. 최근 봉일수록 선형으로 큰 가중치(1..period)를 준다. period=10 관례값."""
    weights = np.arange(1, period + 1, dtype=float)

    def _weighted(x: np.ndarray) -> float:
        return float(np.dot(x, weights) / weights.sum())

    return df.close.rolling(period).apply(_weighted, raw=True)


def _dema(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """이중지수이동평균(Mulloy, 1994). DEMA = 2*EMA1 - EMA(EMA1) — 단순 EMA보다 지연이 짧다."""
    ema1 = _ema(df.close, period)
    ema2 = _ema(ema1, period)
    return 2 * ema1 - ema2


def _tema(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """삼중지수이동평균(Mulloy, 1994). TEMA = 3*EMA1 - 3*EMA2 + EMA3."""
    ema1 = _ema(df.close, period)
    ema2 = _ema(ema1, period)
    ema3 = _ema(ema2, period)
    return 3 * ema1 - 3 * ema2 + ema3


def _vwma(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """거래량가중이동평균. VWMA = Σ(종가*거래량) / Σ거래량, 창 period."""
    pv = df.close * df.volume
    return pv.rolling(period).sum() / df.volume.rolling(period).sum()


# ── 모멘텀/오실레이터 계열 ────────────────────────────────────────────────


def _rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """상대강도지수(Wilder, 1978). period=14는 원 논문 관례.
    상승분/하락분을 Wilder 평활한 뒤 100 - 100/(1+RS)."""
    delta = df.close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = _wilder_smooth(gain, period)
    avg_loss = _wilder_smooth(loss, period)
    rs = avg_gain / avg_loss
    rsi = 100 - 100 / (1 + rs)
    # 하락분이 아예 없던 구간(avg_loss=0)은 RS가 무한대 → RSI=100이 맞다(과매수 극단).
    rsi = rsi.where(avg_loss != 0, 100.0)
    rsi = rsi.where(avg_gain.notna())
    return rsi


def _macd(
    df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9
) -> pd.DataFrame:
    """MACD(Appel, 1970년대). 관례값 12/26/9. macd = EMA_fast - EMA_slow,
    signal = EMA(macd, signal), hist = macd - signal. 전부 단순 EMA(Wilder 아님)."""
    ema_fast = _ema(df.close, fast)
    ema_slow = _ema(df.close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = _ema(macd_line, signal)
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def _stochastic(
    df: pd.DataFrame, k_period: int = 14, d_period: int = 3
) -> pd.DataFrame:
    """스토캐스틱(Lane, 1950년대). %K=14, %D=3(신호선 SMA)이 관례값.
    %K = 100*(종가-최근 k_period 최저저가)/(최근 k_period 최고고가-최저저가)."""
    lowest_low = df.low.rolling(k_period).min()
    highest_high = df.high.rolling(k_period).max()
    k = 100 * (df.close - lowest_low) / (highest_high - lowest_low)
    d = k.rolling(d_period).mean()
    return pd.DataFrame({"k": k, "d": d})


def _cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """상품채널지수(Lambert, 1980). period=20, 상수 0.015는 값의 약 70~80%가
    ±100 안에 들도록 Lambert가 고른 관례 상수. CCI = (TP-SMA(TP))/(0.015*평균절대편차)."""
    tp = (df.high + df.low + df.close) / 3
    sma_tp = tp.rolling(period).mean()
    mean_abs_dev = tp.rolling(period).apply(
        lambda x: float(np.mean(np.abs(x - x.mean()))), raw=True
    )
    return (tp - sma_tp) / (0.015 * mean_abs_dev)


def _willr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Williams %R(Williams, 1973). period=14 관례값. -100(과매도)~0(과매수) 범위."""
    highest_high = df.high.rolling(period).max()
    lowest_low = df.low.rolling(period).min()
    return -100 * (highest_high - df.close) / (highest_high - lowest_low)


def _roc(df: pd.DataFrame, period: int = 12) -> pd.Series:
    """변화율(Rate of Change). period=12 관례값. 100*(종가-N봉전종가)/N봉전종가(%)."""
    shifted = df.close.shift(period)
    return 100 * (df.close - shifted) / shifted


def _momentum(df: pd.DataFrame, period: int = 10) -> pd.Series:
    """모멘텀. period=10 관례값. 단순 차분(종가-N봉전종가), ROC와 달리 %가 아니다."""
    return df.close - df.close.shift(period)


def _mfi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """자금흐름지수(Money Flow Index). period=14는 RSI와 같은 관례값(RSI의 거래량 가중판).
    첫 봉은 전일 TP가 없어 방향을 정할 수 없으므로 자금흐름을 0(중립)으로 둔다."""
    tp = (df.high + df.low + df.close) / 3
    money_flow = tp * df.volume
    tp_delta = tp.diff()
    pos_flow = money_flow.where(tp_delta > 0, 0.0)
    neg_flow = money_flow.where(tp_delta < 0, 0.0)
    pos_sum = pos_flow.rolling(period).sum()
    neg_sum = neg_flow.rolling(period).sum()
    mfr = pos_sum / neg_sum
    mfi = 100 - 100 / (1 + mfr)
    return mfi.where(neg_sum != 0, 100.0)


# ── 추세/변동성 계열 ──────────────────────────────────────────────────────


def _adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """평균방향지수(Wilder, 1978). period=14 원 논문 관례. +DM/-DM을 Wilder 평활해 +DI/-DI를
    만들고, 그 괴리(DX)를 다시 Wilder 평활한 것이 ADX — 추세의 "방향"이 아니라 "세기"를 잰다."""
    up_move = df.high.diff()
    down_move = -df.low.diff()
    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index
    )
    tr = _true_range(df)
    atr = _wilder_smooth(tr, period)
    plus_di = 100 * _wilder_smooth(plus_dm, period) / atr
    minus_di = 100 * _wilder_smooth(minus_dm, period) / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
    adx = _wilder_smooth(dx, period)
    return pd.DataFrame({"adx": adx, "plus_di": plus_di, "minus_di": minus_di})


def _aroon(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """아룬(Chande, 1995). period=14 원 저자 관례.
    up/down = 100*(period - 최고/최저 이후 경과봉)/period.
    창 크기가 period+1인 이유: "현재 봉을 포함해 period봉 전까지" 되돌아봐야 경과봉수가 맞다."""
    window = period + 1

    def _since_argmax(x: np.ndarray) -> float:
        return float((len(x) - 1 - np.argmax(x)) / period * 100)

    def _since_argmin(x: np.ndarray) -> float:
        return float((len(x) - 1 - np.argmin(x)) / period * 100)

    up = df.high.rolling(window).apply(_since_argmax, raw=True)
    down = df.low.rolling(window).apply(_since_argmin, raw=True)
    return pd.DataFrame({"up": up, "down": down})


def _sar(df: pd.DataFrame, af_step: float = 0.02, af_max: float = 0.2) -> pd.Series:
    """파라볼릭 SAR(Wilder, 1978). af_step=0.02/af_max=0.2 원 논문 관례.
    다음 SAR이 "이전 SAR + 가속계수*(극값-이전 SAR)"로 정의되는 순수 재귀 지표라
    벡터화가 근본적으로 불가능하다 — 계획서가 명시적으로 허용한 루프 예외.
    """
    high = df.high.to_numpy(dtype=float)
    low = df.low.to_numpy(dtype=float)
    n = len(high)
    out = np.full(n, np.nan)
    if n < 2:
        return pd.Series(out, index=df.index)

    # 초기 추세는 관례적 판단이 없어 2봉째의 고+저 합을 1봉째와 비교해 정한다.
    trend_up = (high[1] + low[1]) >= (high[0] + low[0])
    af = af_step
    if trend_up:
        sar_val = low[0]
        ep = high[1]
    else:
        sar_val = high[0]
        ep = low[1]
    out[1] = sar_val

    for i in range(2, n):
        prev_sar = sar_val
        sar_val = prev_sar + af * (ep - prev_sar)
        if trend_up:
            sar_val = min(sar_val, low[i - 1], low[i - 2])
            if high[i] > ep:
                ep = high[i]
                af = min(af + af_step, af_max)
            if low[i] < sar_val:
                trend_up = False
                sar_val = ep
                ep = low[i]
                af = af_step
        else:
            sar_val = max(sar_val, high[i - 1], high[i - 2])
            if low[i] < ep:
                ep = low[i]
                af = min(af + af_step, af_max)
            if high[i] > sar_val:
                trend_up = True
                sar_val = ep
                ep = high[i]
                af = af_step
        out[i] = sar_val
    return pd.Series(out, index=df.index)


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """평균실질변동폭(Wilder, 1978). period=14 원 논문 관례. TR을 Wilder 평활한다."""
    return _wilder_smooth(_true_range(df), period)


def _natr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """정규화 ATR = 100*ATR/종가. 종목 간·기간 간 변동폭을 %로 비교하기 위한 ATR 파생."""
    return 100 * _atr(df, period) / df.close


def _bollinger(df: pd.DataFrame, period: int = 20, k: float = 2.0) -> pd.DataFrame:
    """볼린저밴드(Bollinger, 1980년대). period=20/k=2 원 저자 관례.
    표준편차는 표본표준편차(ddof=1, pandas 기본)를 쓴다 — 모표준편차(ddof=0)를 쓰는
    구현도 있으나 우리는 pandas 관례를 따르기로 정하고 여기 명시한다."""
    mid = df.close.rolling(period).mean()
    std = df.close.rolling(period).std()
    return pd.DataFrame({"mid": mid, "upper": mid + k * std, "lower": mid - k * std})


def _keltner(
    df: pd.DataFrame, period: int = 20, atr_period: int = 10, mult: float = 2.0
) -> pd.DataFrame:
    """켈트너채널(Keltner, 1960 원안 → Chester Keltner 이후 ATR판이 표준화).
    중심선은 EMA(period=20), 폭은 ATR(atr_period=10)*mult(2.0) — 이 조합이 현재 관례."""
    mid = _ema(df.close, period)
    band = mult * _atr(df, atr_period)
    return pd.DataFrame({"mid": mid, "upper": mid + band, "lower": mid - band})


def _donchian(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    """돈치안채널(Donchian, 1960년대 터틀 트레이딩). period=20 관례값(4주 채널).
    upper/lower는 미래 정보 없이 "현재 봉을 포함한" 최근 period봉의 최고/최저."""
    upper = df.high.rolling(period).max()
    lower = df.low.rolling(period).min()
    return pd.DataFrame({"upper": upper, "lower": lower, "mid": (upper + lower) / 2})


def _std(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """이동표준편차. period=20 관례값(볼린저밴드와 같은 창). 표본표준편차(ddof=1) 사용."""
    return df.close.rolling(period).std()


def _obv(df: pd.DataFrame) -> pd.Series:
    """온밸런스거래량(Granville, 1963). 파라미터 없음.
    상승봉이면 +거래량, 하락봉이면 -거래량을 누적한다. 첫 봉은 전일종가가 없어
    방향을 정할 수 없으므로 기여분 0으로 시작한다 — 이는 "워밍업 NaN"이 아니라
    OBV가 애초에 누적 시작점이 필요한 지표라는 정의상 특성이다(NaN으로 두지 않는다)."""
    direction = np.sign(df.close.diff()).fillna(0.0)
    return (direction * df.volume).cumsum()


def _cmf(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """차이킨자금흐름(Chaikin). period=20 관례값. 자금흐름승수(MFM)*거래량을 합산 비율로.
    고가=저가(변동폭 0)인 봉은 MFM이 정의되지 않으므로 0(중립)으로 둔다."""
    hl_range = df.high - df.low
    mfm = ((df.close - df.low) - (df.high - df.close)) / hl_range
    mfm = mfm.where(hl_range != 0, 0.0)
    mfv = mfm * df.volume
    return mfv.rolling(period).sum() / df.volume.rolling(period).sum()


# ── 등록 ──────────────────────────────────────────────────────────────────

register(
    "SMA",
    params={"period": ParamSpec(type="int", default=20, min=2, max=240, step=1)},
    source="close",
    fn=_sma,
    outputs=("sma",),
)
register(
    "EMA",
    params={"period": ParamSpec(type="int", default=20, min=2, max=240, step=1)},
    source="close",
    fn=_ema_fn,
    outputs=("ema",),
)
register(
    "WMA",
    params={"period": ParamSpec(type="int", default=10, min=2, max=240, step=1)},
    source="close",
    fn=_wma,
    outputs=("wma",),
)
register(
    "DEMA",
    params={"period": ParamSpec(type="int", default=20, min=2, max=240, step=1)},
    source="close",
    fn=_dema,
    outputs=("dema",),
)
register(
    "TEMA",
    params={"period": ParamSpec(type="int", default=20, min=2, max=240, step=1)},
    source="close",
    fn=_tema,
    outputs=("tema",),
)
register(
    "RSI",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="close",
    fn=_rsi,
    outputs=("rsi",),
)
register(
    "MACD",
    params={
        "fast": ParamSpec(type="int", default=12, min=2, max=100, step=1),
        "slow": ParamSpec(type="int", default=26, min=3, max=200, step=1),
        "signal": ParamSpec(type="int", default=9, min=2, max=100, step=1),
    },
    source="close",
    fn=_macd,
    outputs=("macd", "signal", "hist"),
)
register(
    "STOCH",
    params={
        "k_period": ParamSpec(type="int", default=14, min=2, max=100, step=1),
        "d_period": ParamSpec(type="int", default=3, min=2, max=50, step=1),
    },
    source="hlc",
    fn=_stochastic,
    outputs=("k", "d"),
)
register(
    "CCI",
    params={"period": ParamSpec(type="int", default=20, min=2, max=200, step=1)},
    source="hlc",
    fn=_cci,
    outputs=("cci",),
)
register(
    "WILLR",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="hlc",
    fn=_willr,
    outputs=("willr",),
)
register(
    "ROC",
    params={"period": ParamSpec(type="int", default=12, min=1, max=200, step=1)},
    source="close",
    fn=_roc,
    outputs=("roc",),
)
register(
    "MOM",
    params={"period": ParamSpec(type="int", default=10, min=1, max=200, step=1)},
    source="close",
    fn=_momentum,
    outputs=("mom",),
)
register(
    "ADX",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="hlc",
    fn=_adx,
    outputs=("adx", "plus_di", "minus_di"),
)
register(
    "AROON",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="hlc",
    fn=_aroon,
    outputs=("up", "down"),
)
register(
    "SAR",
    params={
        "af_step": ParamSpec(type="float", default=0.02, min=0.01, max=0.5, step=0.01),
        "af_max": ParamSpec(type="float", default=0.2, min=0.05, max=1.0, step=0.05),
    },
    source="hlc",
    fn=_sar,
    outputs=("sar",),
)
register(
    "ATR",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="hlc",
    fn=_atr,
    outputs=("atr",),
)
register(
    "NATR",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="hlc",
    fn=_natr,
    outputs=("natr",),
)
register(
    "BBANDS",
    params={
        "period": ParamSpec(type="int", default=20, min=2, max=200, step=1),
        "k": ParamSpec(type="float", default=2.0, min=0.5, max=5.0, step=0.1),
    },
    source="close",
    fn=_bollinger,
    outputs=("mid", "upper", "lower"),
)
register(
    "KC",
    params={
        "period": ParamSpec(type="int", default=20, min=2, max=200, step=1),
        "atr_period": ParamSpec(type="int", default=10, min=2, max=100, step=1),
        "mult": ParamSpec(type="float", default=2.0, min=0.5, max=5.0, step=0.1),
    },
    source="hlc",
    fn=_keltner,
    outputs=("mid", "upper", "lower"),
)
register(
    "DONCHIAN",
    params={"period": ParamSpec(type="int", default=20, min=2, max=240, step=1)},
    source="hlc",
    fn=_donchian,
    outputs=("upper", "lower", "mid"),
)
register(
    "STD",
    params={"period": ParamSpec(type="int", default=20, min=2, max=200, step=1)},
    source="close",
    fn=_std,
    outputs=("std",),
)
register(
    "OBV",
    params={},
    source="ohlcv",
    fn=_obv,
    outputs=("obv",),
)
register(
    "MFI",
    params={"period": ParamSpec(type="int", default=14, min=2, max=100, step=1)},
    source="ohlcv",
    fn=_mfi,
    outputs=("mfi",),
)
register(
    "VWMA",
    params={"period": ParamSpec(type="int", default=20, min=2, max=200, step=1)},
    source="ohlcv",
    fn=_vwma,
    outputs=("vwma",),
)
register(
    "CMF",
    params={"period": ParamSpec(type="int", default=20, min=2, max=200, step=1)},
    source="ohlcv",
    fn=_cmf,
    outputs=("cmf",),
)
