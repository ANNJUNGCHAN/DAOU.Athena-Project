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
    acceptResult,
    unregister,
    clear,
    has: (panelId) => panels.has(panelId),
    size: () => panels.size,
  };
}

module.exports = { AITS_CHART_RENDERER_ID, UI_TO_PERIOD, createChartReloadAuthority };
