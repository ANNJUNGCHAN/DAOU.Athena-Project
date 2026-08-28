'use strict';

const DEFAULT_READY_TIMEOUT_MS = 5_000;
const COMPLEX_CHART_TERMS_RE = /(?:왜|원인|이유|뉴스|공시|분석|비교|전망|예측|매수|매도|주문|분봉|주봉|월봉|연봉|년봉|시간봉|틱)/;
const CHART_TERM_RE = /(?:일봉(?:\s*차트)?|차트)/;

function normalizeQuery(query) {
  return String(query || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function isSimpleDailyChartQuery(query) {
  const text = normalizeQuery(query);
  if (!text || text.length > 80 || COMPLEX_CHART_TERMS_RE.test(text)) return false;
  const match = CHART_TERM_RE.exec(text);
  if (!match) return false;

  const entityText = text.slice(0, match.index).replace(/(?:의|주식)\s*$/u, '').trim();
  if (!entityText || !/[0-9A-Za-z가-힣]/u.test(entityText)) return false;

  const suffix = text.slice(match.index + match[0].length).trim();
  return /^(?:(?:을|를|은|는)?\s*)?(?:(?:좀|한번)\s*)?(?:(?:보여|그려|띄워)\s*(?:줘|주세요|줄래)?|(?:조회|확인)\s*(?:해)?\s*(?:줘|주세요)|해\s*(?:줘|주세요))?\s*[?!.~]*$/u.test(suffix);
}

function localResult(source, answerText, startedAt) {
  return {
    ok: true,
    source,
    error: null,
    answerText,
    canvasTypes: [],
    modelCalls: 0,
    durationMs: Math.max(0, performance.now() - startedAt),
  };
}

async function runSimpleChartFastPath({
  query,
  index,
  ensureReady,
  buildDataset,
  runDataset,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
}) {
  if (!isSimpleDailyChartQuery(query)) return { handled: false, reason: 'not-simple-daily-chart' };

  const startedAt = performance.now();
  if (index.size === 0 && !await ensureReady(readyTimeoutMs)) {
    return {
      handled: false,
      reason: 'stock-index-not-ready',
      inferenceFallback: localResult(
        'stock-index-not-ready',
        '종목 정보를 준비하고 있어요. 잠시 후 다시 차트를 요청해 주세요.',
        startedAt,
      ),
    };
  }

  const dataset = buildDataset(query, index);
  if (!dataset) {
    const entity = index && typeof index.resolveQuery === 'function' ? index.resolveQuery(query) : null;
    const hasExplicitCode = /(?:^|\D)\d{6}(?=\D|$)/.test(normalizeQuery(query));
    const shouldClarifyStock = entity ? entity.kind === 'stock' : hasExplicitCode;
    if (!shouldClarifyStock) return { handled: false, reason: 'not-a-resolved-stock-chart' };
    return {
      handled: true,
      dataset: null,
      result: localResult(
        'chart-entity-unresolved',
        '차트를 보려면 정확한 종목명이나 6자리 종목코드를 알려주세요.',
        startedAt,
      ),
    };
  }

  const result = await runDataset(dataset);
  return { handled: true, dataset, result };
}

module.exports = {
  DEFAULT_READY_TIMEOUT_MS,
  isSimpleDailyChartQuery,
  runSimpleChartFastPath,
};
