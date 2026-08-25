'use strict';

const AITS_CHART_RENDERER_ID = 'aits-chart-v1';
const UI_TO_PERIOD = Object.freeze({ D: 'day', W: 'week', M: 'month', Y: 'year', MIN: 'min', TICK: 'tick' });

function kstToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function createChartReloadAuthority(options) {
  const today = options && typeof options.today === 'function' ? options.today : kstToday;
  const maxAuthorities = options && Number.isInteger(Number(options.maxAuthorities))
    ? Number(options.maxAuthorities) : 6;
  if (maxAuthorities < 1 || maxAuthorities > 6) throw new RangeError('AITS chart reload 권위는 1..6개만 허용한다');
  const panels = new Map();

  function registerPaint(paint, authority) {
    if (!paint || paint.renderState !== 'data' || paint.rendererId !== AITS_CHART_RENDERER_ID || !paint.panelId
      || !Number.isInteger(Number(paint.generation)) || Number(paint.generation) < 1) return false;
    const source = authority && typeof authority === 'object' ? authority : {};
    const meta = source.chartMeta && typeof source.chartMeta === 'object' ? source.chartMeta : {};
    const chart = source.chartBody && typeof source.chartBody === 'object' ? source.chartBody : {};
    if (!source.correlation || !source.operationRef || !source.operationArgs
      || !chart.period || !chart.target || !chart.trId
      || !meta.series_scope || !meta.reload_group || !meta.reload_targets) return false;
    const reloadTargets = {};
    for (const [period, target] of Object.entries(meta.reload_targets)) {
      if (!target || typeof target !== 'object' || !/^base:(?:ka|kt)\d+$/i.test(String(target.operation_ref || ''))
        || !Array.isArray(target.request_fields) || !target.request_fields.length) return false;
      reloadTargets[period] = {
        operationRef: String(target.operation_ref),
        requestFields: target.request_fields.map(String),
      };
    }
    const currentTarget = reloadTargets[String(chart.period)];
    if (!currentTarget || currentTarget.operationRef !== String(source.operationRef)
      || String(chart.trId) !== String(source.operationRef).replace(/^base:/, '')) return false;
    if (!panels.has(paint.panelId) && panels.size >= maxAuthorities) {
      panels.delete(panels.keys().next().value);
    }
    panels.set(paint.panelId, {
      panelId: paint.panelId,
      generation: Number(paint.generation),
      seriesScope: String(meta.series_scope),
      reloadGroup: String(meta.reload_group),
      reloadTargets,
      correlation: Object.assign({}, source.correlation),
      operationRef: String(source.operationRef),
      operationArgs: Object.assign({}, source.operationArgs),
    });
    return true;
  }

  function buildDataset(request) {
    const input = request && typeof request === 'object' ? request : {};
    const authority = panels.get(String(input.panelId || ''));
    if (!authority) throw new Error('AITS chart reload 권위가 없는 패널이다');
    if (!Number.isInteger(Number(input.generation)) || Number(input.generation) !== authority.generation) {
      throw new Error('AITS chart reload generation이 현재 세션과 다르다');
    }
    const period = UI_TO_PERIOD[String(input.period || '')];
    if (!period) throw new Error(`지원하지 않는 AITS chart period다: ${String(input.period)}`);
    const target = authority.reloadTargets[period];
    if (!target) throw new Error(`AITS chart reload 계약이 없다: ${authority.reloadGroup}:${period}`);
    const allowedFields = new Set(target.requestFields);
    const args = Object.fromEntries(
      Object.entries(authority.operationArgs).filter(([key]) => allowedFields.has(key)),
    );
    if (allowedFields.has('upd_stkpc_tp')) args.upd_stkpc_tp = input.adjusted === false ? '0' : '1';
    if (allowedFields.has('tic_scope')) args.tic_scope = String(Number(input.interval) || 1);
    if (allowedFields.has('base_dt') && !args.base_dt) args.base_dt = today();
    const correlation = authority.correlation;
    return {
      datasetId: String(correlation.dataset_id),
      question: `AITS chart reload ${target.operationRef}`,
      items: [{
        itemId: String(correlation.item_id),
        ordinal: Number(correlation.ordinal),
        operationRef: target.operationRef,
        args,
        caption: null,
      }],
      expected: {
        panelId: authority.panelId,
        generation: authority.generation + 1,
        period,
        operationRef: target.operationRef,
        reloadGroup: authority.reloadGroup,
        seriesScope: authority.seriesScope,
      },
    };
  }

  // 과거 페이지 조회 — 같은 계약·같은 인자에 base_dt만 커서로 바꾼다.
  //
  // 왜 cont_yn/next_key가 아닌가: next_key는 응답 헤더에만 있고 render-plan 뒤에서
  // 소비돼 앱까지 오지 않는다. 게다가 커서는 수명이 있어 재조회·주기전환마다 끊긴다.
  // 차트 TR은 base_dt가 "이 날짜까지"를 뜻하므로, 가진 것 중 가장 오래된 봉의
  // 날짜를 다시 base_dt로 주면 그 이전 구간이 온다(2026-08-25 실서버 확인:
  // 20260825→20240307, 20240307→20210930). 커서를 들고 다닐 필요가 없다.
  //
  // generation을 올리지 않는다 — 이건 화면 교체가 아니라 앞쪽에 덧붙이는 조회다.
  function buildHistoryDataset(request) {
    const input = request && typeof request === 'object' ? request : {};
    const cursor = String(input.beforeDate || '');
    if (!/^\d{8}$/.test(cursor)) throw new Error(`AITS chart history 커서가 YYYYMMDD가 아니다: ${cursor}`);
    const dataset = buildDataset(input);
    const item = dataset.items[0];
    if (!Object.prototype.hasOwnProperty.call(item.args, 'base_dt')) {
      // 분·틱(ka10079)처럼 base_dt가 계약에 없는 주기는 이 방식으로 과거를 못 끊는다.
      // 조용히 같은 구간을 다시 주지 않고 거부한다 — 안 되는 걸 되는 척하지 않는다.
      throw new Error('이 주기는 base_dt 과거 조회를 지원하지 않는다');
    }
    item.args.base_dt = cursor;
    return Object.assign(dataset, {
      question: `AITS chart history ${item.operationRef} ~${cursor}`,
      expected: Object.assign({}, dataset.expected, { generation: authorityGeneration(input) }),
    });
  }

  function authorityGeneration(input) {
    const authority = panels.get(String(input.panelId || ''));
    return authority ? authority.generation : 1;
  }

  function acceptResult(request, result) {
    const expected = request && request.expected;
    const canvas = result && Array.isArray(result.canvases) ? result.canvases[0] : null;
    if (!result || !result.ok || !expected || !canvas) throw new Error('AITS chart reload가 데이터 카드로 완료되지 않았다');
    const envelope = canvas.envelope && typeof canvas.envelope === 'object' ? canvas.envelope : {};
    const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
    const chart = data.chart && typeof data.chart === 'object' ? data.chart : {};
    const meta = data.chart_meta && typeof data.chart_meta === 'object' ? data.chart_meta : {};
    const periodTarget = meta.reload_targets && meta.reload_targets[expected.period];
    if (canvas.renderState !== 'data' || canvas.isDataCanvas !== true
      || canvas.rendererId !== AITS_CHART_RENDERER_ID || envelope.renderer_id !== AITS_CHART_RENDERER_ID
      || canvas.panelId !== expected.panelId || canvas.generation !== expected.generation
      || canvas.operationRef !== expected.operationRef || chart.period !== expected.period
      || chart.trId !== expected.operationRef.replace(/^base:/, '')
      || meta.reload_group !== expected.reloadGroup || meta.series_scope !== expected.seriesScope
      || !periodTarget || periodTarget.operation_ref !== expected.operationRef) {
      throw new Error('AITS chart reload 결과의 renderer/panel/generation/operation 계약이 다르다');
    }
    return { ok: true, panelId: canvas.panelId, generation: canvas.generation };
  }

  function unregister(panelId) {
    return panels.delete(String(panelId || ''));
  }

  function clear() {
    panels.clear();
  }

  return {
    registerPaint,
    buildDataset,
    buildHistoryDataset,
    acceptResult,
    unregister,
    clear,
    has: (panelId) => panels.has(panelId),
    size: () => panels.size,
  };
}

module.exports = { AITS_CHART_RENDERER_ID, createChartReloadAuthority };
