'use strict';

// 보조지표 순수 계산 — plan/chart-card-control-spec.md §3 (1판 구현 5종 중 계산형 4종).
// 전부 결정적 순수 함수. 값이 정의되지 않는 워밍업 구간은 null로 둔다(정보 정직성 —
// 0이나 근사값으로 채우지 않는다).

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

module.exports = { sma, ema, bollinger, rsi, macd };
