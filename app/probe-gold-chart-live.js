'use strict';

// 금현물 보드(2RJ7-1) 실데이터 증명 프로브.
//
// 실제 /board-hydrate 조회가 돌려준 금현물 분봉을 제품과 같은 보드/AITS 렌더러에
// 넣고, 캔버스가 선 것과 Paper 차트 목업이 화면에서 접힌 것을 함께 확인한다.
// 실제 앱 프로필은 열지 않으며 주문/계좌 IPC는 호출하지 않는다.
//
// 실행:
//   ATHENA_BACKEND_URL=http://127.0.0.1:8011 electron probe-gold-chart-live.js
// 성공 표지:
//   gold chart live probe passed

process.env.ATHENA_NO_AUTOSTART = '1';

const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { publicPolicies } = require('./lib/main/integrated-card-realtime');
const {
  boardInstanceId,
  settleBoardLayout,
} = require('./lib/board-probe');
const { PENDING_MOUNT_ACK_TIMEOUT_MS } = require('./lib/rest-canvas-paint');
const { hydrateBoard } = require('./lib/main/board-hydrate');
const { readLocalBearerToken } = require('./lib/main/backend-launcher');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BOARD_ID = '2RJ7-1';
const INSTANCE_ID = boardInstanceId(BOARD_ID);
const GOLD_TARGET = Object.freeze({ stk_cd: 'M04020000' });
const BACKEND_BASE = process.env.ATHENA_BACKEND_URL
  || process.env.ATHENA_BACKEND_BASE
  || 'http://127.0.0.1:8010';
const CAPTURE_DIR = path.join(APP, 'captures', 'gold-chart-live');
const REPORT_PATH = path.join(CAPTURE_DIR, 'GOLD-CHART-LIVE.json');
const SCREENSHOT_PATH = path.join(CAPTURE_DIR, 'GOLD-CHART-LIVE.png');
const PROFILE = path.join(APP, `.probe-gold-chart-live-profile-${process.pid}`);
const TOKEN = readLocalBearerToken(path.join(ROOT, 'backend'));
let probeWin = null;
const automaticRefreshCalls = [];

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);
app.on('will-quit', () => {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best-effort probe cleanup */ }
});
app.disableHardwareAcceleration();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function classifyHydrateFailure(reply) {
  const status = clean(reply && reply.status);
  const httpStatus = Number(reply && reply.httpStatus) || null;
  const detail = clean(reply && reply.detail);
  if (httpStatus === 404 && /no surface template/i.test(detail)) return 'backend_contract';
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (status === 'unavailable') return 'network_or_backend_unavailable';
  if (status === 'error' && httpStatus && httpStatus >= 500) return 'upstream_or_backend_error';
  if (status === 'invalid') return 'request_contract';
  return 'hydrate_error';
}

async function hydrateFailureDetail() {
  const headers = { 'Content-Type': 'application/json' };
  if (clean(TOKEN)) headers.Authorization = `Bearer ${TOKEN}`;
  try {
    const response = await fetch(`${BACKEND_BASE}/api/v1/internal/canvas/board-hydrate`, {
      method: 'POST', headers, body: JSON.stringify({ board_id: BOARD_ID, target: GOLD_TARGET }),
    });
    let body = null;
    try { body = await response.json(); } catch { /* 진단 detail 없음 */ }
    return {
      httpStatus: response.status,
      detail: clean(body && body.detail).slice(0, 300),
    };
  } catch (error) {
    return { httpStatus: null, detail: clean(error.message).slice(0, 300) };
  }
}

// board-hydrate의 차트 증명 필드는 renderer 봉투와 같은 모양이다. 전환 기간의
// chart_envelope/envelope 래퍼도 읽되, 봉/renderer를 추론하거나 만들어내지는 않는다.
function chartEnvelopeFrom(reply) {
  const wrapped = reply && typeof reply.primary_envelope === 'object'
    ? reply.primary_envelope
    : (reply && typeof reply.chart_envelope === 'object'
      ? reply.chart_envelope
      : (reply && typeof reply.envelope === 'object' ? reply.envelope : reply));
  const data = wrapped && typeof wrapped.data === 'object' ? wrapped.data : null;
  const chart = data && typeof data.chart === 'object' ? data.chart : null;
  const candles = chart && Array.isArray(chart.candles) ? chart.candles : [];
  return {
    renderer_id: clean(wrapped && wrapped.renderer_id),
    operation_ref: clean(wrapped && (wrapped.operation_ref || wrapped.operationRef)),
    operation_args: (wrapped && (wrapped.operation_args || wrapped.operationArgs)) || GOLD_TARGET,
    data,
    candles,
  };
}

function candleFingerprint(candles) {
  return createHash('sha256').update(JSON.stringify(candles)).digest('hex');
}

function executePythonTransform(operationRef, rawData) {
  const python = process.env.ATHENA_PYTHON
    || path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe');
  const script = [
    'import json, sys',
    'from athena_api.canvas_transform import build_aits_chart_envelope_data',
    'request = json.load(sys.stdin)',
    'built = build_aits_chart_envelope_data(request["operation_ref"], {',
    '  "data": request["data"],',
    '  "canvas_context": {"symbol": request["symbol"]},',
    '})',
    'if isinstance(built, str):',
    '  raise RuntimeError(built)',
    'envelope, _meta = built',
    'envelope.update({',
    '  "canvas_type": "chart",',
    '  "operation_ref": request["operation_ref"],',
    '  "operation_args": request["operation_args"],',
    '})',
    'print(json.dumps(envelope, ensure_ascii=False))',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      ['-c', script],
      { cwd: path.join(ROOT, 'backend'), windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`금현물 차트 변환 실패: ${clean(stderr) || clean(error.message)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('금현물 차트 변환 결과가 JSON이 아니다'));
        }
      },
    );
    child.stdin.end(JSON.stringify({
      operation_ref: operationRef,
      operation_args: { ...GOLD_TARGET, tic_scope: '1' },
      symbol: GOLD_TARGET.stk_cd,
      data: rawData,
    }));
  });
}

// 공유 백엔드가 아직 primary_envelope 배포 전이면 같은 서버의 실제 읽기 TR을 한 번
// 호출하고, 현재 체크아웃의 정식 Python 변환기로 봉투를 만든다. 이 경로는 renderer
// 증명에는 유효하지만 endpoint 통합 배포 증명은 아니므로 report에 source를 분리한다.
async function directLiveChartEnvelope() {
  const headers = { 'Content-Type': 'application/json' };
  if (clean(TOKEN)) headers.Authorization = `Bearer ${TOKEN}`;
  let response;
  try {
    response = await fetch(`${BACKEND_BASE}/api/v1/tr/charts/ka50092`, {
      method: 'POST', headers, body: JSON.stringify({ ...GOLD_TARGET, tic_scope: '1' }),
    });
  } catch (error) {
    return { ok: false, category: 'network_or_backend_unavailable', error: clean(error.message) };
  }
  if (!response.ok) {
    return {
      ok: false,
      category: response.status === 401 || response.status === 403
        ? 'auth' : (response.status >= 500 ? 'upstream_or_backend_error' : 'raw_chart_error'),
      http_status: response.status,
    };
  }
  let raw = null;
  try { raw = await response.json(); } catch { /* 아래에서 계약 오류로 판정 */ }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, category: 'raw_chart_contract', error: 'JSON 응답이 비었다' };
  }
  try {
    return { ok: true, envelope: await executePythonTransform('base:ka50092', raw) };
  } catch (error) {
    return { ok: false, category: 'primary_transform_error', error: clean(error.message) };
  }
}

function registerShellIpc() {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1];
  const channels = block ? block.split(']);')[0] : null;
  if (!channels) throw new Error('preload.js에서 INVOKE_CHANNELS 블록을 못 찾았다');
  for (const channel of [...channels.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    ipcMain.handle(channel, async (_event, payload) => {
      if (channel === 'athena:refresh-chart-panel') {
        const reply = await hydrateBoard({
          backendBase: BACKEND_BASE, token: TOKEN, boardId: BOARD_ID, target: GOLD_TARGET,
        });
        const primary = chartEnvelopeFrom(reply);
        automaticRefreshCalls.push({
          ok: reply.ok === true && primary.candles.length > 0,
          requested_generation: Number(payload && payload.generation) || null,
          returned_candles: primary.candles.length,
          last_time: primary.candles.length
            ? primary.candles[primary.candles.length - 1].time : null,
          last_close: primary.candles.length
            ? primary.candles[primary.candles.length - 1].close : null,
        });
        if (!reply.ok || !primary.candles.length) {
          return { ok: false, error: reply.error || reply.status || '금현물 자동 조회 실패', candles: [] };
        }
        return {
          ok: true,
          candles: primary.candles,
          generation: (Number(payload && payload.generation) || 0) + 1,
          trId: primary.data.chart.trId,
        };
      }
      if (channel === 'athena:canvas-board-hydrate') {
        const request = payload && typeof payload === 'object' ? payload : {};
        return hydrateBoard({
          backendBase: BACKEND_BASE,
          token: TOKEN,
          boardId: request.boardId || BOARD_ID,
          target: GOLD_TARGET,
          slotIds: request.slotIds,
        });
      }
      if (channel === 'athena:integrated-card-realtime-policy') return publicPolicies();
      // 이 프로브는 snapshot 조회만 증명한다. 가짜 실시간 active를 반환하지 않는다.
      if (channel.startsWith('athena:integrated-card-realtime-')) {
        return {
          ok: true, status: 'inactive', bindings: [], generation: 1, connectionGeneration: 1,
        };
      }
      if (channel === 'athena:boot-readiness:get') {
        return {
          runId: 'gold-chart-live-probe', revision: 1, phase: 'ready',
          tasks: [{
            id: 'probe-readiness', label: '금현물 실차트 검사 준비', kind: 'gate',
            state: 'succeeded', attempt: 1, retryable: false, detail: '완료',
          }],
        };
      }
      if (channel === 'athena:onboarding-state') return { needed: false, step: 3 };
      if (channel.endsWith('-list') || channel.endsWith('conversations-list')) return [];
      if (channel.includes('prefs:get')) return {};
      return null;
    });
  }
}

async function bootShell() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#EEF1F6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 숨김 격리 창에서도 paint receipt의 rAF 검증을 진행한다. 창을 표시하지 않는다.
      backgroundThrottling: false,
      offscreen: true,
      preload: path.join(APP, 'preload.js'),
    },
  });
  // 렌더러가 외부 HTTP로 우회하는 것을 막는다. 백엔드 조회는 main의 hydrateBoard만 한다.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  win.__goldProbeConsole = [];
  win.webContents.on('console-message', (event) => {
    if (event.level >= 2 && win.__goldProbeConsole.length < 20) {
      win.__goldProbeConsole.push(clean(event.message).slice(0, 500));
    }
  });
  await win.loadFile(path.join(APP, 'shell.html'));
  // 제품 타이머는 사용자가 보고 있는 카드에서만 돈다(document.hidden 차단). 네이티브
  // 창은 끝까지 숨기되, 이 offscreen 검증 문서만 "보는 중"으로 만들어 같은 분기를 탄다.
  // 시장 데이터/시간/렌더 결과에는 손대지 않는다.
  await win.webContents.executeJavaScript(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    return { hidden: document.hidden, visibilityState: document.visibilityState };
  })()`);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const boot = document.getElementById('boot');
      const shell = document.getElementById('shell');
      if (boot.dataset.phase === 'complete' && boot.hidden && !shell.hidden
        && !shell.classList.contains('is-onboarding-hidden')) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('셸 부팅 실패'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  return win;
}

async function sendGoldEnvelope(win, surface, chartEnvelope) {
  const correlation = {
    dataset_id: 'probe-gold-chart-live', item_id: surface.instanceId, ordinal: 1,
  };
  setTimeout(() => {
    void win.webContents.executeJavaScript(MEASURE).then((value) => {
      win.__goldProbeDuringPaint = value;
    }).catch(() => {});
  }, 2500);
  return new Promise((resolve, reject) => {
    let timer = null;
    let pending = false;
    const arm = (ms) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
        reject(new Error('금현물 보드 paint receipt timeout'));
      }, ms);
    };
    function onPainted(_event, painted) {
      if (!painted || painted.item_id !== correlation.item_id) return;
      if (painted.pending === true || painted.render_state === 'loading') {
        if (!pending) {
          pending = true;
          arm(PENDING_MOUNT_ACK_TIMEOUT_MS);
        }
        return;
      }
      clearTimeout(timer);
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      if (painted.render_state === 'data' && painted.verified_visible === true) {
        resolve(painted);
        return;
      }
      reject(new Error(`금현물 보드가 visible data로 확정되지 않았다: ${JSON.stringify({
        render_state: painted.render_state || null,
        verified_visible: painted.verified_visible === true,
        error: painted.error || null,
      })}`));
    }
    arm(15000);
    ipcMain.on('athena:rest-canvas-painted', onPainted);
    win.webContents.send('athena:add-rest-canvas', {
      operationRef: chartEnvelope.operation_ref,
      operationArgs: { ...chartEnvelope.operation_args },
      canvasType: 'facts',
      envelope: {
        card_id: 'CC-03',
        card_kind: 'instrument',
        capability: 'quote',
        mode: 'quote',
        section: 'board-surface',
        view_instance_id: surface.instanceId,
        operation_ref: chartEnvelope.operation_ref,
        operation_args: { ...chartEnvelope.operation_args },
        canvas_type: 'facts',
        card_title: '금 99.99K',
        fell_back: false,
        correlation,
        renderer_id: chartEnvelope.renderer_id,
        data: chartEnvelope.data,
        surface_contract: surface.contract,
        realtime_bindings: [],
        operation_refs: [chartEnvelope.operation_ref],
      },
    });
  });
}

// board-probe의 탭 활성화 절차를 따르되, 보드의 부가 슬롯 재조회 상태가 남아 있어도
// primary 차트 자체가 섰는지는 잴 수 있게 chart body를 완료 조건으로 삼는다.
async function activateGoldTab(win) {
  const activated = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${INSTANCE_ID}"]');
    const panel = root && root.closest('.canvas-tab-panel');
    if (!panel) return false;
    const tab = document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    if (tab) tab.click();
    return Boolean(tab);
  })()`);
  if (!activated) throw new Error('금현물 canvas tab을 찾지 못했다');
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const root = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${INSTANCE_ID}"]');
      const panel = root && root.closest('.canvas-tab-panel');
      const surface = root && root.querySelector('.board-surface');
      const chart = surface && surface.querySelector('[data-node="2RKJ-1"] > .chart-card-body');
      const rect = chart && chart.getBoundingClientRect();
      if (panel && panel.hidden !== true && panel.classList.contains('is-active')
        && surface && surface.getClientRects().length > 0
        && chart && chart.getClientRects().length > 0
        && rect.width > 10 && rect.height > 10) return resolve(true);
      if (Date.now() - started > 15000) {
        return reject(new Error('금현물 live chart가 화면에 서지 않았다'));
      }
      requestAnimationFrame(check);
    };
    check();
  })`);
}

const MEASURE = `(() => {
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${INSTANCE_ID}"]');
  const surface = root && root.querySelector('.board-surface');
  const host = surface && surface.closest('.board-surface-host');
  const primary = surface && surface.querySelector('[data-node="2RKJ-1"]');
  const chartBody = primary && primary.querySelector(':scope > .chart-card-body');
  const pricePane = chartBody && chartBody.querySelector('.chart-price-pane');
  const shown = (node) => {
    if (!node || node.hidden || node.getClientRects().length === 0) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 10 && rect.height > 10
      && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const canvases = pricePane ? [...pricePane.querySelectorAll('canvas')] : [];
  const visibleCanvases = canvases.filter(shown);
  const visibleMockupChildren = primary ? [...primary.children].filter((node) => (
    !node.classList.contains('chart-card-body') && shown(node)
  )) : [];
  const footerStatus = surface && surface.querySelector('[data-node="3HF1-0"]');
  const footerDetail = surface && surface.querySelector('[data-node="3HF2-0"]');
  const headerPrice = surface && surface.querySelector('[data-slot-id="s004"]');
  const visibleText = surface ? surface.innerText : '';
  return {
    root_present: Boolean(root),
    surface_visible: shown(surface),
    primary_renderer: primary && primary.dataset.bsPrimaryMounted || null,
    primary_error: host && host.dataset.bsPrimaryError || null,
    render_state: root && root.dataset.renderState || null,
    chart_authority: root && root.dataset.chartAuthority || null,
    renderer_id: root && root.dataset.rendererId || null,
    chart_panel_id: root && root.dataset.chartPanelId || null,
    chart_body_visible: shown(chartBody),
    price_pane_visible: shown(pricePane),
    canvas_count: canvases.length,
    visible_canvas_count: visibleCanvases.length,
    visible_mockup_child_count: visibleMockupChildren.length,
    visible_mockup_nodes: visibleMockupChildren.slice(0, 5).map((node) => ({
      node: node.dataset.node || null, name: node.dataset.name || null,
    })),
    error_text: [...(root ? root.querySelectorAll(
      '.uk-error, .board-surface-load-state, .integrated-realtime-error',
    ) : [])]
      .filter(shown).map((node) => node.textContent.trim()).filter(Boolean),
    footer_status: footerStatus ? footerStatus.textContent.trim() : '',
    footer_detail: footerDetail ? footerDetail.textContent.trim() : '',
    header_price_text: headerPrice ? headerPrice.textContent.trim() : '',
    header_price_digits: headerPrice
      ? Number(headerPrice.textContent.replace(/[^0-9]/g, '')) || null : null,
    false_live_label_visible: /실시간\\s*갱신\\s*중/.test(visibleText),
  };
})()`;

function assertionsFor(chartEnvelope, measured) {
  return {
    backend_returned_gold_candles: chartEnvelope.candles.length > 0,
    backend_named_aits_renderer: chartEnvelope.renderer_id === 'aits-chart-v1',
    backend_named_gold_minute_operation: chartEnvelope.operation_ref === 'base:ka50092',
    board_surface_visible: measured.surface_visible === true,
    product_chart_renderer_mounted: measured.primary_renderer === 'athena-chart',
    product_render_state_is_data: measured.render_state === 'data',
    aits_chart_authority_present: measured.chart_authority === 'AITS'
      && measured.renderer_id === 'aits-chart-v1',
    chart_canvas_visible: measured.chart_body_visible === true
      && measured.price_pane_visible === true && measured.visible_canvas_count > 0,
    paper_chart_mockup_not_visible: measured.visible_mockup_child_count === 0,
    no_visible_render_error: measured.error_text.length === 0,
    refresh_label_is_honest_for_snapshot_only_probe: measured.false_live_label_visible === false,
    refresh_label_names_polling_and_timestamp:
      /15초마다 조회 · (최신 시세 확인됨|마지막 갱신 \d{2}:\d{2}:\d{2})/.test(
        measured.footer_status,
      ),
  };
}

function writeReport(report) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const startedAt = Date.now();
  await app.whenReady();
  registerShellIpc();
  const win = await bootShell();
  probeWin = win;
  const report = {
    probe: 'gold-chart-live',
    generated_at: new Date().toISOString(),
    backend_base: BACKEND_BASE,
    board_id: BOARD_ID,
    target: GOLD_TARGET,
    profile_isolated: app.getPath('userData') === PROFILE,
    window_hidden: win.isVisible() === false,
    hidden_probe_visibility_branch: 'simulated_visible_document',
    query_mode: 'read_only_snapshot',
    screenshot: SCREENSHOT_PATH,
    failures: [],
  };

  const hydrateOnce = () => hydrateBoard({
    backendBase: BACKEND_BASE, token: TOKEN, boardId: BOARD_ID, target: GOLD_TARGET,
  });
  const firstReply = await hydrateOnce();
  const secondReply = firstReply.ok ? await hydrateOnce() : null;
  report.hydrate_rounds = [firstReply, secondReply].filter(Boolean).map((reply, index) => ({
    round: index + 1,
    ok: reply.ok === true,
    status: reply.status || null,
    http_status: reply.httpStatus || null,
    filled: reply.filled || 0,
    operations: reply.operations || [],
  }));
  if (!firstReply.ok || !secondReply || !secondReply.ok) {
    const failedReply = !firstReply.ok ? firstReply : secondReply;
    const diagnostic = await hydrateFailureDetail();
    const classified = { ...failedReply, ...diagnostic };
    report.failures.push({
      stage: 'hydrate', category: classifyHydrateFailure(classified),
      status: failedReply.status || null,
      http_status: diagnostic.httpStatus || failedReply.httpStatus || null,
      detail: diagnostic.detail || null,
    });
    report.elapsed_ms = Date.now() - startedAt;
    writeReport(report);
    console.log(JSON.stringify({ passed: false, stage: 'hydrate', report: REPORT_PATH }));
    app.exit(1);
    return;
  }

  const firstChart = chartEnvelopeFrom(firstReply);
  let chartSource = 'board_hydrate_primary_envelope';
  let chartEnvelope = chartEnvelopeFrom(secondReply);
  // 구버전 공유 서버 진단용 폴백. 이 결과는 endpoint 통합 성공으로 세지 않는다.
  if (!firstChart.candles.length || !chartEnvelope.candles.length) {
    const firstDirect = await directLiveChartEnvelope();
    const secondDirect = firstDirect.ok ? await directLiveChartEnvelope() : firstDirect;
    if (!firstDirect.ok || !secondDirect.ok) {
      const direct = !firstDirect.ok ? firstDirect : secondDirect;
      report.failures.push({
        stage: 'raw_chart', category: direct.category,
        http_status: direct.http_status || null, error: direct.error || null,
      });
    } else {
      chartSource = 'direct_raw_plus_current_transform';
      Object.assign(firstChart, chartEnvelopeFrom({ primary_envelope: firstDirect.envelope }));
      chartEnvelope = chartEnvelopeFrom({ primary_envelope: secondDirect.envelope });
    }
  }
  report.live_chart = {
    source: chartSource,
    endpoint_integration_verified: chartSource === 'board_hydrate_primary_envelope',
    query_count: 2,
    renderer_id: chartEnvelope.renderer_id || null,
    operation_ref: chartEnvelope.operation_ref || null,
    candle_count: chartEnvelope.candles.length,
    first_time: chartEnvelope.candles[0] ? chartEnvelope.candles[0].time : null,
    last_time: chartEnvelope.candles.length
      ? chartEnvelope.candles[chartEnvelope.candles.length - 1].time : null,
    rounds: [firstChart, chartEnvelope].map((snapshot, index) => ({
      round: index + 1,
      candle_count: snapshot.candles.length,
      last_time: snapshot.candles.length
        ? snapshot.candles[snapshot.candles.length - 1].time : null,
      fingerprint: candleFingerprint(snapshot.candles),
    })),
  };
  if (report.failures.length || !chartEnvelope.data || !chartEnvelope.renderer_id || !chartEnvelope.operation_ref
    || chartEnvelope.candles.length === 0) {
    report.failures.push({
      stage: 'contract', category: 'live_chart_snapshot_missing',
      renderer_id: chartEnvelope.renderer_id || null,
      operation_ref: chartEnvelope.operation_ref || null,
      candle_count: chartEnvelope.candles.length,
    });
    report.elapsed_ms = Date.now() - startedAt;
    writeReport(report);
    console.log(JSON.stringify({ passed: false, stage: 'contract', report: REPORT_PATH }));
    app.exit(1);
    return;
  }

  const contract = secondReply.surface_contract && {
    ...secondReply.surface_contract,
    // preflight에서 같은 hydration을 이미 마쳤다. 미해결 슬롯을 다시 13개 TR로
    // 왕복시키면 chart paint ack의 시간 한도를 소모하므로 이 렌더 단계에서는
    // 증명 대상인 primary snapshot만 마운트한다. 값은 추가하거나 지어내지 않는다.
    hydration_slot_ids: [],
  };
  if (!contract || contract.board_id !== BOARD_ID) {
    throw new Error('금현물 surface_contract가 없거나 board_id가 다르다');
  }
  const firstReceipt = await sendGoldEnvelope(win, { instanceId: INSTANCE_ID, contract }, firstChart);
  await activateGoldTab(win);
  await settleBoardLayout(win, INSTANCE_ID);
  const firstMeasured = await win.webContents.executeJavaScript(MEASURE);
  const receipt = await sendGoldEnvelope(win, { instanceId: INSTANCE_ID, contract }, chartEnvelope);
  await activateGoldTab(win);
  await settleBoardLayout(win, INSTANCE_ID);
  await win.webContents.executeJavaScript(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
  report.paint_receipt = {
    render_state: receipt.render_state || null,
    verified_visible: receipt.verified_visible === true,
    renderer_id: receipt.renderer_id || null,
    panel_id: receipt.panel_id || null,
    generation: receipt.generation || null,
  };
  report.refresh_evidence = {
    first_generation: Number(firstReceipt.generation) || null,
    second_generation: Number(receipt.generation) || null,
    first_render_state: firstMeasured.render_state,
    second_render_state: report.measured && report.measured.render_state,
  };
  report.renderer_console = win.__goldProbeConsole;
  report.measured = await win.webContents.executeJavaScript(MEASURE);
  report.assertions = assertionsFor(chartEnvelope, report.measured);
  report.refresh_evidence.second_render_state = report.measured.render_state;
  report.assertions.two_live_queries_completed = report.live_chart.rounds.every(
    (round) => round.candle_count > 0,
  );
  report.assertions.second_snapshot_replaced_first_render =
    Number(receipt.generation) > Number(firstReceipt.generation)
    && report.measured.render_state === 'data';
  report.assertions.updated_endpoint_integration_verified =
    report.live_chart.endpoint_integration_verified === true;
  // 보드 자체의 15초 타이머를 한 번 통과시킨다. 외부 sleep 대신 renderer 상태를
  // 짧게 폴링해 refresh IPC와 footer timestamp가 모두 도착하면 즉시 끝낸다.
  // Windows는 완전 hidden 창의 product visibility gate를 닫으므로, 화면 밖 투명
  // showInactive로 문서만 활성화한다. 포커스를 뺏지 않고 사용자의 앱 창도 건드리지 않는다.
  win.setPosition(-32000, -32000, false);
  win.setOpacity(0);
  win.showInactive();
  report.refresh_visibility_probe = 'transparent_offscreen_show_inactive';
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const status = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${INSTANCE_ID}"] [data-node="3HF1-0"]');
      if (status && /마지막 갱신 \\d{2}:\\d{2}:\\d{2}/.test(status.textContent)) return resolve(true);
      if (Date.now() - started > 25000) return reject(new Error('금현물 15초 자동 조회가 실행되지 않았다'));
      setTimeout(check, 250);
    };
    check();
  })`);
  report.after_automatic_refresh = await win.webContents.executeJavaScript(MEASURE);
  win.hide();
  win.setOpacity(1);
  report.automatic_refresh_calls = automaticRefreshCalls.slice();
  const latestAutomatic = automaticRefreshCalls[automaticRefreshCalls.length - 1] || null;
  report.assertions.automatic_refresh_invoked_live_query = Boolean(
    latestAutomatic && latestAutomatic.ok && latestAutomatic.returned_candles > 0,
  );
  report.assertions.automatic_refresh_status_has_timestamp =
    /15초마다 조회 · 마지막 갱신 \d{2}:\d{2}:\d{2}/.test(
      report.after_automatic_refresh.footer_status,
    );
  report.assertions.header_price_matches_latest_refreshed_close = Boolean(
    latestAutomatic
      && Number.isFinite(Number(latestAutomatic.last_close))
      && report.after_automatic_refresh.header_price_digits === Math.abs(Number(latestAutomatic.last_close)),
  );
  for (const [name, passed] of Object.entries(report.assertions)) {
    if (!passed) report.failures.push({ stage: 'render', category: name });
  }

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(SCREENSHOT_PATH, image.toPNG());
  report.elapsed_ms = Date.now() - startedAt;
  report.passed = report.failures.length === 0;
  writeReport(report);
  console.log(JSON.stringify({
    passed: report.passed,
    candles: report.live_chart.candle_count,
    visible_canvas_count: report.measured.visible_canvas_count,
    mockup_visible: report.measured.visible_mockup_child_count,
    false_live_label: report.measured.false_live_label_visible,
    report: REPORT_PATH,
    screenshot: SCREENSHOT_PATH,
  }));
  console.log(report.passed ? 'gold chart live probe passed' : 'gold chart live probe failed');
  app.exit(report.passed ? 0 : 1);
}

main().catch(async (error) => {
  let finalMeasure = null;
  if (probeWin && !probeWin.isDestroyed()) {
    try { finalMeasure = await probeWin.webContents.executeJavaScript(MEASURE); } catch { /* 종료 진단 없음 */ }
  }
  const report = {
    probe: 'gold-chart-live', generated_at: new Date().toISOString(),
    backend_base: BACKEND_BASE, board_id: BOARD_ID, target: GOLD_TARGET,
    passed: false,
    renderer_console: (probeWin && probeWin.__goldProbeConsole) || [],
    during_paint: (probeWin && probeWin.__goldProbeDuringPaint) || null,
    automatic_refresh_calls: automaticRefreshCalls.slice(),
    final_measure: finalMeasure,
    failures: [{ stage: 'probe', category: 'unexpected_error', error: String(error.message || error) }],
  };
  writeReport(report);
  console.error(JSON.stringify({ passed: false, stage: 'probe', report: REPORT_PATH }));
  app.exit(1);
});
