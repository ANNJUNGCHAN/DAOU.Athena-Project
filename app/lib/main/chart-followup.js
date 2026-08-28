'use strict';

const CHART_OPERATION_REF = 'base:ka10081';
const FOLLOWUP_RE = /^(?:오늘(?:은)?|지금)\s*(?:주가(?:가|는)?\s*)?(떨어진|내린|하락한|올랐|오른|상승한|보합인|같은)\s*(?:거|것|건)?\s*(?:야|지|맞아|인가|니|어|어요|나요|습니까)?\s*[?!.]*$/;

function parseClose(value) {
  const normalized = typeof value === 'string' ? value.replaceAll(',', '').trim() : value;
  const close = Number(normalized);
  return Number.isFinite(close) && close > 0 ? close : null;
}

function parseTime(value) {
  const time = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(time)) return null;
  const order = Date.parse(time.replace(' ', 'T'));
  return Number.isFinite(order) ? { time, order } : null;
}

function readCandles(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const candles = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const parsedTime = parseTime(raw.time);
    const close = parseClose(raw.close);
    if (!parsedTime || close === null) return null;
    const previous = candles[candles.length - 1];
    if (previous && previous.order >= parsedTime.order) return null;
    candles.push({ ...parsedTime, close });
  }
  return candles;
}

function safeLabel(data) {
  for (const value of [data.name, data.stock_name, data.stk_nm]) {
    const label = String(value || '').trim();
    if (label && label.length <= 40 && !/[\r\n]/.test(label)) return label;
  }
  return null;
}

function safeQuestionLabel(question) {
  const text = String(question || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const match = /^(.+?)\s*(?:일봉(?:\s*차트)?|차트)(?:\s*(?:을|를))?(?:\s*(?:보여\s*줘|보여줘|봐|볼래|그려\s*줘|줘))?\s*[?!.]*$/u.exec(text);
  if (!match) return null;
  const label = match[1].replace(/(?:의|주식|주가)\s*$/u, '').trim();
  if (!label || label.length > 40 || /[\r\n]/.test(label) || /(?:말고|비교|와\s|과\s)/.test(label)) return null;
  return label;
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits }).format(value);
}

function withTopicParticle(label) {
  const last = label.codePointAt(label.length - 1);
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${label}${hasBatchim ? '은' : '는'}`;
}

function buildAnswer(context) {
  const change = context.latest.close - context.previous.close;
  const percent = (change / context.previous.close) * 100;
  const label = withTopicParticle(context.name || '해당 종목');
  if (change === 0) {
    return {
      matched: true,
      direction: 'flat',
      answerText: `${label} 최근 봉 기준 종가가 전 거래일과 같은 ${formatNumber(context.latest.close, 4)}원이에요.`,
    };
  }
  const direction = change > 0 ? 'up' : 'down';
  const verb = change > 0 ? '올랐어요' : '내렸어요';
  return {
    matched: true,
    direction,
    answerText: `${label} 최근 봉 기준 전 거래일보다 ${formatNumber(Math.abs(change), 4)}원(${formatNumber(Math.abs(percent))}%) ${verb}.`,
  };
}

function createChartFollowupTracker() {
  let latestContext = null;

  function observe(result, dataset) {
    if (!dataset || !Array.isArray(dataset.items)) return false;
    const item = dataset.items.find((candidate) => candidate
      && candidate.operationRef === CHART_OPERATION_REF
      && /^\d{6}$/.test(String(candidate.args && candidate.args.stk_cd || '')));
    const requestedCodes = dataset.items
      .map((candidate) => String(candidate && candidate.args && candidate.args.stk_cd || ''))
      .filter((code) => /^\d{6}$/.test(code));
    if (item) latestContext = null;
    else if (latestContext && requestedCodes.some((code) => code !== latestContext.code)) latestContext = null;
    if (!result || result.ok !== true || !item) return false;
    const code = String(item.args.stk_cd);
    const canvas = Array.isArray(result.canvases) && result.canvases.find((candidate) => candidate
      && candidate.operationRef === CHART_OPERATION_REF
      && candidate.isDataCanvas === true
      && candidate.envelope
      && candidate.envelope.data);
    if (!canvas) return false;
    const data = canvas.envelope.data;
    const chart = data.chart;
    if (!chart || chart.target !== 'stock' || chart.trId !== 'ka10081') return false;
    const symbol = String(data.symbol || '').trim();
    if (symbol && symbol !== code) return false;
    const candles = readCandles(chart.candles);
    if (!candles) return false;
    latestContext = {
      code,
      symbol: symbol || null,
      name: safeLabel(data) || safeQuestionLabel(dataset.question),
      previous: candles[candles.length - 2],
      latest: candles[candles.length - 1],
    };
    return true;
  }

  function answer(query) {
    if (!latestContext) return null;
    const text = String(query || '').normalize('NFKC').trim();
    if (!FOLLOWUP_RE.test(text)) return null;
    return buildAnswer(latestContext);
  }

  function clear() {
    latestContext = null;
  }

  function invalidateForQuery(query) {
    if (!latestContext) return false;
    const text = String(query || '').normalize('NFKC').trim();
    if (FOLLOWUP_RE.test(text)) return false;
    latestContext = null;
    return true;
  }

  return { observe, answer, clear, invalidateForQuery };
}

module.exports = { createChartFollowupTracker };
