// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';


// 단순이동평균. closes[i]가 null이면 결과도 null.
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// 지수이동평균 — 시드는 첫 period 구간의 SMA (관례).
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// 볼린저밴드(period=20, mult=2σ 기본) — {middle, upper, lower}[]
function bollinger(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const d = closes[j] - middle[i];
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { middle, upper, lower };
}

// RSI(14 기본) — Wilder 평활.
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// MACD(12/26/9 기본) — {macd, signal, histogram}[] (null 워밍업 구간 유지)
function macd(closes, shortP = 12, longP = 26, signalP = 9) {
  const emaS = ema(closes, shortP);
  const emaL = ema(closes, longP);
  const macdLine = closes.map((_, i) =>
    emaS[i] != null && emaL[i] != null ? emaS[i] - emaL[i] : null
  );
  // 시그널은 macd가 정의된 구간에 대해서만 EMA를 돌린다.
  const start = macdLine.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);
  if (start >= 0) {
    const defined = macdLine.slice(start);
    const sig = ema(defined, signalP);
    for (let i = 0; i < defined.length; i += 1) {
      if (sig[i] != null) {
        signal[start + i] = sig[i];
        histogram[start + i] = defined[i] - sig[i];
      }
    }
  }
  return { macd: macdLine, signal, histogram };
}

// ---------------------------------------------------------------------------
// 아래는 2026-08-25 확장분. 규약은 위 5종과 같다:
//  - 입력은 배열(closes) 또는 bars([{open,high,low,close,volume}]).
//  - 출력 길이는 입력 길이와 같고, 워밍업 구간은 null로 남긴다(자리를 당기지 않는다).
//  - 0 나눗셈은 null이 아니라 정의된 관례값으로 처리하고 주석에 근거를 남긴다.
// ---------------------------------------------------------------------------

// 내부 헬퍼 — bars에서 축을 뽑는다.
function pick(bars, key) { return bars.map((b) => b[key]); }
function typicalPrice(bars) { return bars.map((b) => (b.high + b.low + b.close) / 3); }

// Wilder 평활(RSI/ATR/DMI 공용) — EMA와 계수가 다르다(1/period).
function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  let started = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] == null) continue;
    if (started < 0) started = i;
    if (i - started < period) {
      sum += values[i];
      if (i - started === period - 1) out[i] = sum / period;
      continue;
    }
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

// ---- 상단(가격 오버레이) ----

// 엔벨로프 — SMA ± pct%
function envelope(closes, period = 20, pct = 6) {
  const middle = sma(closes, period);
  const upper = middle.map((v) => (v == null ? null : v * (1 + pct / 100)));
  const lower = middle.map((v) => (v == null ? null : v * (1 - pct / 100)));
  return { middle, upper, lower };
}

// 프라이스 채널 — 최근 period의 최고/최저(당봉 포함)
function priceChannel(bars, period = 20) {
  const upper = new Array(bars.length).fill(null);
  const lower = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

// VWAP — 누적 (typical × volume) / 누적 volume.
// anchorIndexes가 주어지면 그 지점에서 누적을 리셋한다(고정 VWAP).
function vwap(bars, anchorIndexes = null) {
  const anchors = anchorIndexes ? new Set(anchorIndexes) : null;
  const out = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  const tp = typicalPrice(bars);
  for (let i = 0; i < bars.length; i += 1) {
    if (anchors && anchors.has(i)) { pv = 0; vol = 0; }
    pv += tp[i] * bars[i].volume;
    vol += bars[i].volume;
    // 거래량 0 구간은 직전 값을 유지한다(0으로 나눠 NaN을 내지 않는다).
    out[i] = vol > 0 ? pv / vol : (i > 0 ? out[i - 1] : null);
  }
  return out;
}

// 파라볼릭 SAR — 상태 추적(추세 방향 · AF · EP).
function parabolicSar(bars, step = 0.02, max = 0.2) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  let up = bars[1].close >= bars[0].close;
  let sar = up ? bars[0].low : bars[0].high;
  let ep = up ? bars[1].high : bars[1].low;
  let af = step;
  out[1] = sar;
  for (let i = 2; i < bars.length; i += 1) {
    sar += af * (ep - sar);
    if (up) {
      // 상승 추세의 SAR는 직전 2봉 저가를 넘지 못한다.
      sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
      if (bars[i].low < sar) { up = false; sar = ep; ep = bars[i].low; af = step; }
      else if (bars[i].high > ep) { ep = bars[i].high; af = Math.min(af + step, max); }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
      if (bars[i].high > sar) { up = true; sar = ep; ep = bars[i].high; af = step; }
      else if (bars[i].low < ep) { ep = bars[i].low; af = Math.min(af + step, max); }
    }
    out[i] = sar;
  }
  return out;
}

// 슈퍼트렌드 — ATR 기반 밴드를 추세 방향으로 잠근다. {line, up}[]
function supertrend(bars, period = 10, mult = 3) {
  const atrArr = atr(bars, period);
  const line = new Array(bars.length).fill(null);
  const upTrend = new Array(bars.length).fill(null);
  let prevUpper = null;
  let prevLower = null;
  let up = true;
  for (let i = 0; i < bars.length; i += 1) {
    if (atrArr[i] == null) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    let upper = mid + mult * atrArr[i];
    let lower = mid - mult * atrArr[i];
    if (prevUpper != null && bars[i - 1].close <= prevUpper) upper = Math.min(upper, prevUpper);
    if (prevLower != null && bars[i - 1].close >= prevLower) lower = Math.max(lower, prevLower);
    if (prevUpper == null) up = bars[i].close >= mid;
    else if (bars[i].close > prevUpper) up = true;
    else if (bars[i].close < prevLower) up = false;
    line[i] = up ? lower : upper;
    upTrend[i] = up;
    prevUpper = upper;
    prevLower = lower;
  }
  return { line, up: upTrend };
}

// 일목균형표 — 전환/기준/선행1·2/후행. 선행선은 미래로 kijun만큼 민다.
// 반환 배열 길이는 bars.length + kijun (미래 구간 포함) — 렌더가 그대로 쓴다.
function ichimoku(bars, tenkanP = 9, kijunP = 26, senkouBP = 52) {
  const n = bars.length;
  const hl = (p, i) => {
    if (i - p + 1 < 0) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - p + 1; j <= i; j += 1) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    return (hi + lo) / 2;
  };
  const tenkan = new Array(n).fill(null);
  const kijun = new Array(n).fill(null);
  const senkouA = new Array(n + kijunP).fill(null);
  const senkouB = new Array(n + kijunP).fill(null);
  const chikou = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    tenkan[i] = hl(tenkanP, i);
    kijun[i] = hl(kijunP, i);
    if (tenkan[i] != null && kijun[i] != null) senkouA[i + kijunP] = (tenkan[i] + kijun[i]) / 2;
    const b = hl(senkouBP, i);
    if (b != null) senkouB[i + kijunP] = b;
    // 후행스팬은 과거로 민다 — 현재 종가를 kijun만큼 앞 자리에 적는다.
    if (i - kijunP >= 0) chikou[i - kijunP] = bars[i].close;
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// 윌리엄스 프랙탈 — 좌우 2봉보다 높은 고점 / 낮은 저점. {up, down} (bool[])
function williamsFractal(bars) {
  const up = new Array(bars.length).fill(false);
  const down = new Array(bars.length).fill(false);
  for (let i = 2; i < bars.length - 2; i += 1) {
    const h = bars[i].high;
    const l = bars[i].low;
    if (h > bars[i - 1].high && h > bars[i - 2].high && h > bars[i + 1].high && h > bars[i + 2].high) up[i] = true;
    if (l < bars[i - 1].low && l < bars[i - 2].low && l < bars[i + 1].low && l < bars[i + 2].low) down[i] = true;
  }
  return { up, down };
}

// ---- 하단(별도 패널) ----

// ATR — True Range의 Wilder 평활.
function atr(bars, period = 14) {
  const tr = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i += 1) {
    if (i === 0) { tr[i] = bars[i].high - bars[i].low; continue; }
    const pc = bars[i - 1].close;
    tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc));
  }
  return wilderSmooth(tr, period);
}

// 스토캐스틱 — Fast %K → Slow %K(=Fast %D) → Slow %D. {k, d}
function stochastic(bars, period = 14, kSmooth = 3, dSmooth = 3) {
  const rawK = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    // 고가==저가면 분모가 0 — 관례상 50(중립)으로 둔다.
    rawK[i] = hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100;
  }
  const k = smaSparse(rawK, kSmooth);
  const d = smaSparse(k, dSmooth);
  return { k, d };
}

// null을 건너뛰는 SMA — 워밍업이 있는 시리즈를 다시 평활할 때 쓴다.
function smaSparse(values, period) {
  const out = new Array(values.length).fill(null);
  const buf = [];
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] == null) continue;
    buf.push(values[i]);
    if (buf.length > period) buf.shift();
    if (buf.length === period) out[i] = buf.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

// 스토캐스틱 RSI — RSI에 스토캐스틱을 다시 씌운다.
function stochRsi(closes, rsiP = 14, stochP = 14, kSmooth = 3, dSmooth = 3) {
  const r = rsi(closes, rsiP);
  const rawK = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i += 1) {
    if (r[i] == null) continue;
    let hi = -Infinity;
    let lo = Infinity;
    let cnt = 0;
    for (let j = i; j >= 0 && cnt < stochP; j -= 1) {
      if (r[j] == null) break;
      if (r[j] > hi) hi = r[j];
      if (r[j] < lo) lo = r[j];
      cnt += 1;
    }
    if (cnt < stochP) continue;
    rawK[i] = hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
  }
  const k = smaSparse(rawK, kSmooth);
  const d = smaSparse(k, dSmooth);
  return { k, d };
}

// CCI — (TP - SMA(TP)) / (0.015 × 평균절대편차)
function cci(bars, period = 20) {
  const tp = typicalPrice(bars);
  const ma = sma(tp, period);
  const out = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let dev = 0;
    for (let j = i - period + 1; j <= i; j += 1) dev += Math.abs(tp[j] - ma[i]);
    dev /= period;
    out[i] = dev === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * dev);
  }
  return out;
}

// Williams %R — 0 ~ -100
function williamsR(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    out[i] = hi === lo ? -50 : ((hi - bars[i].close) / (hi - lo)) * -100;
  }
  return out;
}

// DMI / ADX — {plusDi, minusDi, adx}
function dmiAdx(bars, period = 14) {
  const n = bars.length;
  const plusDm = new Array(n).fill(null);
  const minusDm = new Array(n).fill(null);
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i += 1) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc));
  }
  const trS = wilderSmooth(tr, period);
  const pS = wilderSmooth(plusDm, period);
  const mS = wilderSmooth(minusDm, period);
  const plusDi = new Array(n).fill(null);
  const minusDi = new Array(n).fill(null);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    if (trS[i] == null || trS[i] === 0) continue;
    plusDi[i] = (pS[i] / trS[i]) * 100;
    minusDi[i] = (mS[i] / trS[i]) * 100;
    const sum = plusDi[i] + minusDi[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDi[i] - minusDi[i]) / sum) * 100;
  }
  return { plusDi, minusDi, adx: wilderSmooth(dx, period) };
}

// OBV — 종가 방향으로 거래량을 누적.
function obv(bars) {
  const out = new Array(bars.length).fill(null);
  let acc = 0;
  for (let i = 0; i < bars.length; i += 1) {
    if (i > 0) {
      if (bars[i].close > bars[i - 1].close) acc += bars[i].volume;
      else if (bars[i].close < bars[i - 1].close) acc -= bars[i].volume;
    }
    out[i] = acc;
  }
  return out;
}

// AD 라인 — Money Flow Multiplier × volume 누적.
function adLine(bars) {
  const out = new Array(bars.length).fill(null);
  let acc = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const range = bars[i].high - bars[i].low;
    // 고가==저가면 승수를 0으로 둔다(방향을 알 수 없다).
    const mfm = range === 0 ? 0 : ((bars[i].close - bars[i].low) - (bars[i].high - bars[i].close)) / range;
    acc += mfm * bars[i].volume;
    out[i] = acc;
  }
  return out;
}

// 체이킨 오실레이터 — AD 라인의 EMA(3) - EMA(10)
function chaikinOsc(bars, shortP = 3, longP = 10) {
  const ad = adLine(bars);
  const s = ema(ad, shortP);
  const l = ema(ad, longP);
  return ad.map((_, i) => (s[i] != null && l[i] != null ? s[i] - l[i] : null));
}

// MFI — 자금흐름지수(거래량 가중 RSI)
function mfi(bars, period = 14) {
  const tp = typicalPrice(bars);
  const out = new Array(bars.length).fill(null);
  for (let i = period; i < bars.length; i += 1) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const flow = tp[j] * bars[j].volume;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    // 음의 흐름이 0이면 100(전 구간 상승) — RSI와 같은 관례.
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

// 일중 강도 — (2×종가 - 고가 - 저가) / (고가 - 저가) × 거래량, 누적.
// 주의: 누적합으로 쓰면 AD 라인과 분자가 같아져 두 지표가 똑같은 선이 된다
// (2026-08-25 실측으로 발견 — 둘 다 229,094,947.708이 나왔다). period 구간의
// II 합을 같은 구간 거래량 합으로 나누는 정규화가 이 지표의 정의이자
// AD 라인과의 유일한 차이다.
function intradayIntensity(bars, period = 21) {
  const raw = bars.map((b) => {
    const range = b.high - b.low;
    return range === 0 ? 0 : ((2 * b.close - b.high - b.low) / range) * b.volume;
  });
  const out = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let num = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j += 1) { num += raw[j]; vol += bars[j].volume; }
    out[i] = vol === 0 ? 0 : (num / vol) * 100;
  }
  return out;
}

// 모멘텀 — 종가 - n봉 전 종가.
function momentum(closes, period = 10) {
  return closes.map((v, i) => (i >= period ? v - closes[i - period] : null));
}

// ROC — 변화율 %
function roc(closes, period = 12) {
  return closes.map((v, i) => {
    if (i < period) return null;
    const base = closes[i - period];
    return base === 0 ? null : ((v - base) / base) * 100;
  });
}

// 이격도 — 종가 / SMA × 100
function disparity(closes, period = 20) {
  const ma = sma(closes, period);
  return closes.map((v, i) => (ma[i] == null || ma[i] === 0 ? null : (v / ma[i]) * 100));
}

// TRIX — 삼중 EMA의 변화율 %
function trix(closes, period = 12) {
  const e1 = ema(closes, period);
  const e2 = ema(e1.filter((v) => v != null), period);
  const off1 = e1.findIndex((v) => v != null);
  const e2Full = new Array(closes.length).fill(null);
  for (let i = 0; i < e2.length; i += 1) if (e2[i] != null) e2Full[off1 + i] = e2[i];
  const e3 = ema(e2Full.filter((v) => v != null), period);
  const off2 = e2Full.findIndex((v) => v != null);
  const e3Full = new Array(closes.length).fill(null);
  for (let i = 0; i < e3.length; i += 1) if (e3[i] != null) e3Full[off2 + i] = e3[i];
  return e3Full.map((v, i) => {
    if (v == null || i === 0 || e3Full[i - 1] == null || e3Full[i - 1] === 0) return null;
    return ((v - e3Full[i - 1]) / e3Full[i - 1]) * 100;
  });
}

// 프라이스 오실레이터 — (단기SMA - 장기SMA) / 장기SMA × 100
function priceOsc(closes, shortP = 10, longP = 20) {
  const s = sma(closes, shortP);
  const l = sma(closes, longP);
  return closes.map((_, i) => (s[i] == null || l[i] == null || l[i] === 0 ? null : ((s[i] - l[i]) / l[i]) * 100));
}

// 볼륨 오실레이터 — 거래량 SMA의 괴리율 %
function volumeOsc(bars, shortP = 5, longP = 20) {
  const vols = pick(bars, 'volume');
  const s = sma(vols, shortP);
  const l = sma(vols, longP);
  return vols.map((_, i) => (s[i] == null || l[i] == null || l[i] === 0 ? null : ((s[i] - l[i]) / l[i]) * 100));
}

// 볼린저 %B — (종가 - 하단) / (상단 - 하단)
function bollingerPercentB(closes, period = 20, mult = 2) {
  const b = bollinger(closes, period, mult);
  return closes.map((c, i) => {
    if (b.upper[i] == null) return null;
    const w = b.upper[i] - b.lower[i];
    return w === 0 ? 0.5 : (c - b.lower[i]) / w;
  });
}

// 볼린저 밴드폭 — (상단 - 하단) / 중심 × 100
function bollingerBandwidth(closes, period = 20, mult = 2) {
  const b = bollinger(closes, period, mult);
  return closes.map((_, i) => {
    if (b.upper[i] == null || b.middle[i] === 0) return null;
    return ((b.upper[i] - b.lower[i]) / b.middle[i]) * 100;
  });
}

// 매스 인덱스 — (고저폭 EMA / 그 EMA의 EMA)의 합계.
function massIndex(bars, emaP = 9, sumP = 25) {
  const range = bars.map((b) => b.high - b.low);
  const e1 = ema(range, emaP);
  const e1d = e1.filter((v) => v != null);
  const off = e1.findIndex((v) => v != null);
  const e2 = ema(e1d, emaP);
  const ratio = new Array(bars.length).fill(null);
  for (let i = 0; i < e2.length; i += 1) {
    if (e2[i] == null || e2[i] === 0) continue;
    ratio[off + i] = e1d[i] / e2[i];
  }
  const out = new Array(bars.length).fill(null);
  const buf = [];
  for (let i = 0; i < bars.length; i += 1) {
    if (ratio[i] == null) continue;
    buf.push(ratio[i]);
    if (buf.length > sumP) buf.shift();
    if (buf.length === sumP) out[i] = buf.reduce((a, b) => a + b, 0);
  }
  return out;
}

// RMI — RSI의 변형(모멘텀 기간을 둔다). 토스에만 있는 항목.
function rmi(closes, period = 14, momentumP = 5) {
  const out = new Array(closes.length).fill(null);
  const gains = new Array(closes.length).fill(null);
  const losses = new Array(closes.length).fill(null);
  for (let i = momentumP; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - momentumP];
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const ag = wilderSmooth(gains, period);
  const al = wilderSmooth(losses, period);
  for (let i = 0; i < closes.length; i += 1) {
    if (ag[i] == null || al[i] == null) continue;
    out[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = {
  sma, ema, bollinger, rsi, macd,
  // 2026-08-25 확장
  wilderSmooth, smaSparse,
  envelope, priceChannel, vwap, parabolicSar, supertrend, ichimoku, williamsFractal,
  atr, stochastic, stochRsi, cci, williamsR, dmiAdx, obv, adLine, chaikinOsc, mfi,
  intradayIntensity, momentum, roc, disparity, trix, priceOsc, volumeOsc,
  bollingerPercentB, bollingerBandwidth, massIndex, rmi,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartIndicators = __exports;
}

})();
