// 백테스트 모드 캔버스 — Paper 백테스트 페이지 보드 01~10 전부.
//
// **P4 구현과의 차이(2026-09-01 전수 파리티 감사).** 이전 캔버스는 보드 01의 최소 입력
// 5개, 보드 03의 타일·체결 표, 보드 04의 숫자 2개만 그렸다. 감사 결과 Paper 60개 항목 중
// 41개가 화면에 없었다(docs/architecture/backtest-parity-audit.md). 이 파일은 그 41개를
// 채운다 — 설계 폼 전체·코드 편집기·플로우 지도·오류 진단·자산곡선·이력 비교·최적화·배포.
//
// **표면 구조.** 상단 모드 탭 5개(설계·결과·이력·최적화·배포)가 큰 축이고, 설계 안에서만
// 폼/코드/지도 3탭으로 다시 갈린다. 승인(보드 04)·진행·오류 진단(보드 09)은 탭이 아니라
// 그때만 뜨는 상태다 — 사용자가 탭으로 오갈 수 있는 자리가 아니기 때문이다.
//
// **왜 상태가 하나의 객체인가.** 화면이 여덟 개로 늘었지만 동시에 두 개가 뜨는 경우는
// 없다. view 하나로 배타를 강제하면 "결과를 보면서 최적화가 도는" 같은 애매한 상태가
// 구조적으로 불가능해진다(controller.js의 5모드 배타와 같은 태도).
//
// **데이터 접근은 전부 주입식.** canvas.js가 window.athena.invoke로 잇는다. 이 파일은
// fetch도 IPC도 모른다 — node --test가 DOM 스텁만으로 상태 전이를 검증할 수 있는 이유다.
//
// **폴링.** 컨테이너가 hidden(모드 이탈, controller.js applyVisibility 단일 소유)이면
// 다음 tick을 예약하지 않고, 재진입 시 refresh()가 이어 깨운다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;
const FactsCard = isNode ? require('./facts-card') : window.AthenaLib.FactsCard;
const SpecModel = isNode ? require('./backtest-spec') : window.AthenaLib.BacktestSpec;
const CodeEditor = isNode ? require('./backtest-code-editor') : window.AthenaLib.BacktestCodeEditor;
const EquityChart = isNode
  ? require('./backtest-equity-chart')
  : window.AthenaLib.BacktestEquityChart;
const Explain = isNode ? require('./backtest-explain') : window.AthenaLib.BacktestExplain;

const { formatNumeric, formatDatetime } = FactsCard;

const POLL_INTERVAL_MS = 1000;

// §6.4(체결 규칙)·§5.5(정직하게 못 하는 것) 그대로 — 접히지 않는다(보드 01·03 상시 표기).
const ASSUMPTIONS_TEXT = '신호는 종가 확정 후 판정하고 체결은 다음 봉 시가입니다 · '
  + '손절·익절은 봉 내부 저가·고가 터치로 보고, 같은 봉에서 둘 다 닿으면 손절이 먼저입니다 · '
  + '상·하한가 봉과 거래량 0 봉은 체결 불가로 다음 봉에 넘깁니다 · '
  + '상장폐지 종목은 조회할 수 없어 결과에는 생존 편향이 남습니다 · '
  + '배당 재투자·공매도·신용은 반영하지 않습니다';

const COSTS_NOTE = '세율·수수료는 시점에 따라 다릅니다 — 기본값일 뿐 사실 주장이 아닙니다';

// metrics.py Metrics 필드명 그대로(bt-engine 실측). `sub`는 보드 03의 타일 부제를 만든다 —
// 백엔드가 준 값으로만 만들고, 값이 없으면 부제를 비운다(지어내지 않는다).
const METRIC_TILES = [
  {
    key: 'total_return', label: '총수익률', kind: 'percent',
    sub: (m) => (m.buy_hold_return == null ? '' : `보유 ${formatPercentValue(m.buy_hold_return)}`),
  },
  {
    key: 'cagr', label: 'CAGR', kind: 'percent',
    sub: (m) => (m.bars ? `거래일 252일 기준 · ${formatNumeric(m.bars)}봉` : ''),
  },
  {
    key: 'sharpe', label: 'Sharpe', kind: 'ratio',
    sub: (m) => (m.warmup_bars ? `워밍업 ${formatNumeric(m.warmup_bars)}봉 제외` : ''),
  },
  {
    key: 'mdd', label: 'MDD', kind: 'percent',
    sub: (m) => (m.mdd_start ? `${m.mdd_start} · ${formatNumeric(m.mdd_bars)}봉` : ''),
  },
  {
    key: 'win_rate', label: '승률', kind: 'percent',
    sub: (m) => {
      if (m.closed_trades == null) return '';
      const open = m.open_positions == null ? '' : ` · 미청산 ${formatNumeric(m.open_positions)}`;
      return `${formatNumeric(m.closed_trades)}전 ${formatNumeric(m.winning_trades)}승${open}`;
    },
  },
  { key: 'profit_factor', label: 'Profit Factor', kind: 'ratio', sub: () => '총익 ÷ 총손' },
];

const SIDE_LABEL = { buy: '매수', sell: '매도' };
const REASON_LABEL = { signal: '신호', stop_loss: '손절', take_profit: '익절' };

const MODE_TABS = [
  ['design', '설계'],
  ['result', '결과'],
  ['history', '이력'],
  ['optimize', '최적화'],
  ['deploy', '배포'],
];

const DESIGN_TABS = [['form', '폼'], ['code', '코드'], ['flow', '흐름']];

// 배포 모드 3종 — deploy.py MODE_LABELS와 같은 문구를 쓴다.
const DEPLOY_MODES = [
  ['observe', '기록만 합니다', '주문은 내지 않습니다. 전략이 실전에서 어떻게 움직이는지만 봅니다.'],
  ['approve', '승인을 받고 주문합니다', '신호마다 주문 티켓이 뜨고, 사람이 누르면 나갑니다.'],
  ['auto', '한도 안에서 자동으로 주문합니다', '아래 한도를 미리 승인한 범위에서만 자동 집행합니다.'],
];

const SIGNAL_STAGES = [
  ['signal', '신호'], ['pending_approval', '승인'], ['ordered', '주문'], ['filled', '체결'],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

// ---------- 순수 계산 — DOM 없이 node --test로 검증 ----------

function formatPercentValue(raw) {
  const n = Number(raw);
  if (raw === null || raw === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function formatRatioValue(raw) {
  if (raw === null || raw === undefined) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—';
  return n.toFixed(2);
}

function metricTileValue(tile, metrics) {
  if (!metrics) return '—';
  // 무한대는 JSON을 건널 수 없어 백엔드가 `<이름>_infinite` 플래그로 따로 실어 보낸다
  // (runner.py `_json_safe`). 그 플래그가 없으면 null은 "모름"이고, 있으면 "무한대"다 —
  // 손실이 0인 전략의 Profit Factor를 "모름"으로 표시하면 사실과 다르다.
  if (metrics[`${tile.key}_infinite`] === true) return '∞';
  if (metrics[`${tile.key}_infinite`] === false) return '-∞';
  const raw = metrics[tile.key];
  return tile.kind === 'ratio' ? formatRatioValue(raw) : formatPercentValue(raw);
}

function metricTileSub(tile, metrics) {
  if (!metrics || !tile.sub) return '';
  try { return tile.sub(metrics) || ''; } catch { return ''; }
}

// 커버리지 막대의 채움 비율(보드 04). 필요 페이지가 0이면 100%다.
function coverageRatio(cachedRows, neededPages, rowsPerPage) {
  const per = rowsPerPage || 600;
  const cached = Number(cachedRows) || 0;
  const missing = (Number(neededPages) || 0) * per;
  const total = cached + missing;
  if (total <= 0) return 0;
  return cached / total;
}

// 히트맵 셀의 색 농도(0~1). 최고/최저가 같으면 전부 중간값으로 둔다.
function heatIntensity(sharpe, min, max) {
  if (sharpe == null || min == null || max == null) return 0;
  if (max === min) return 0.5;
  return Math.min(Math.max((sharpe - min) / (max - min), 0), 1);
}

// ---------- 캔버스 ----------

function createBacktestCanvas(options) {
  const deps = options || {};
  const container = deps.container;
  if (!container) {
    return { mount() {}, refresh() {} };
  }

  const setTimeoutImpl = deps.setTimeoutImpl
    || (typeof setTimeout !== 'undefined' ? setTimeout : null);
  const clearTimeoutImpl = deps.clearTimeoutImpl
    || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);

  let presets = [];
  let spec = null;              // 편집 중인 전략(SpecModel)
  let codeSource = '';          // 코드 탭의 파이썬 원문
  let strategyId = null;        // 저장된 전략(코드 경로에서만 만든다)
  let activeVersionId = null;
  let state = { view: 'empty', tab: 'design', designTab: 'form' };
  let pollTimer = null;
  let loadRequestId = 0;
  let mounted = false;
  let editorHandle = null;

  function setState(patch) {
    state = Object.assign({}, state, patch);
    render();
  }

  function isVisible() {
    // #backtestCanvas의 hidden 단일 소유자는 controller.js applyVisibility다(§3.3).
    return !container.hidden;
  }

  function stopPolling() {
    if (pollTimer != null && clearTimeoutImpl) clearTimeoutImpl(pollTimer);
    pollTimer = null;
  }

  function schedulePoll(tick) {
    if (setTimeoutImpl) pollTimer = setTimeoutImpl(tick, POLL_INTERVAL_MS);
  }

  function fail(err) {
    setState({ view: 'error', message: String((err && err.message) || err) });
  }

  // ---------- 데이터 흐름 ----------

  async function loadPresets() {
    const rid = ++loadRequestId;
    stopPolling();
    setState({ view: 'empty' });
    let list;
    try {
      list = deps.fetchPresets ? await deps.fetchPresets() : [];
    } catch (err) {
      if (rid !== loadRequestId) return;
      fail(err);
      return;
    }
    if (rid !== loadRequestId) return;
    presets = Array.isArray(list) ? list : [];
    if (presets.length && !spec) spec = SpecModel.presetToSpec(presets[0]);
    setState({ view: 'design', tab: 'design' });
  }

  function selectPreset(id) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    // 종목·기간은 전략을 바꿔도 유지한다 — 같은 대상에 다른 전략을 걸어보는 것이
    // 이 화면에서 가장 잦은 동작이고, 매번 다시 입력하게 하면 그 흐름이 끊긴다.
    const kept = spec
      ? { symbols: spec.symbols, fromDt: spec.fromDt, toDt: spec.toDt, period: spec.period }
      : {};
    spec = Object.assign(SpecModel.presetToSpec(preset), kept);
    setState({ formErrors: [] });
  }

  function currentYaml() {
    return SpecModel.toYaml(spec);
  }

  async function handleRun(allowPartial) {
    const errors = SpecModel.validate(spec);
    if (errors.length) { setState({ formErrors: errors }); return; }
    setState({ formErrors: [] });
    await startRun(allowPartial);
  }

  async function startRun(allowPartial) {
    setState({ view: 'running', progressText: '백테스트를 실행하는 중입니다…' });
    let res;
    try {
      const body = { yaml: currentYaml() };
      if (allowPartial) body.allow_partial = true;
      res = deps.run ? await deps.run(body) : null;
      if (!res) throw new Error('실행 연결이 없습니다');
    } catch (err) { fail(err); return; }

    if (res.blocked) {
      setState({
        view: 'approval',
        neededPages: res.needed_pages,
        estSeconds: res.est_seconds,
        cachedRows: res.cached_rows,
      });
      return;
    }
    if (!res.run_id) { fail(new Error('run_id를 받지 못했습니다')); return; }
    setState({ runId: res.run_id, partial: res.partial || null });
    pollRun();
  }

  function cancelApproval() {
    stopPolling();
    setState({ view: 'design', tab: 'design' });
  }

  async function confirmBackfill() {
    setState({ view: 'running', progressText: '데이터를 수집하는 중입니다…' });
    let res;
    try {
      res = deps.backfill
        ? await deps.backfill({
          stk_cd: spec.symbols[0],
          period: spec.period,
          adjusted: spec.adjusted,
          from_dt: spec.fromDt,
          to_dt: spec.toDt,
        })
        : null;
      if (!res || !res.job_id) throw new Error('job_id를 받지 못했습니다');
    } catch (err) { fail(err); return; }
    setState({ jobId: res.job_id });
    pollJob();
  }

  function pollJob() {
    stopPolling();
    const tick = async () => {
      pollTimer = null;
      if (!isVisible()) return;
      let job;
      try { job = deps.status ? await deps.status({ job_id: state.jobId }) : null; }
      catch (err) { fail(err); return; }
      if (!isVisible()) return;
      if (job && job.progress) {
        setState({
          progressText: `데이터를 수집하는 중입니다 · ${job.progress.page}페이지 · ${job.progress.rows}행`,
          progress: job.progress,
        });
      }
      if (job && job.status === 'done') { await startRun(false); return; }
      if (job && (job.status === 'failed' || job.status === 'cancelled')) {
        setState({ view: 'error', message: job.error || '데이터 수집에 실패했습니다' });
        return;
      }
      schedulePoll(tick);
    };
    tick();
  }

  function pollRun() {
    stopPolling();
    const tick = async () => {
      pollTimer = null;
      if (!isVisible()) return;
      let data;
      try { data = deps.result ? await deps.result({ run_id: state.runId }) : null; }
      catch (err) { fail(err); return; }
      if (!isVisible()) return;
      if (data && data.status === 'done') {
        let trades = [];
        try { trades = deps.trades ? await deps.trades({ run_id: state.runId }) : []; }
        catch { trades = []; }
        setState({
          view: 'result', tab: 'result',
          result: data, trades: Array.isArray(trades) ? trades : [],
        });
        return;
      }
      if (data && (data.status === 'failed' || data.status === 'cancelled')) {
        await handleRunFailure(data);
        return;
      }
      schedulePoll(tick);
    };
    tick();
  }

  // 실패를 error 화면으로 바로 던지지 않고 먼저 진단을 시도한다(보드 09) — 파이썬을
  // 모르는 사용자에게 역추적을 그대로 보여주는 것이 이 화면이 고치려는 문제 자체다.
  async function handleRunFailure(data) {
    const message = (data && data.error) || '백테스트 실행에 실패했습니다';
    if (!deps.diagnose || !codeSource) {
      setState({ view: 'error', message });
      return;
    }
    let diagnosis = null;
    try {
      diagnosis = await deps.diagnose({ error: message, source: codeSource });
    } catch { diagnosis = null; }
    if (!diagnosis) { setState({ view: 'error', message }); return; }
    setState({ view: 'diagnosis', diagnosis });
  }

  // 사람이 [적용]을 눌렀을 때만 불린다(§7.3 — 모델이 코드를 바꿔놓는 경로를 만들지 않는다).
  async function applyFix(newSource, alsoRun) {
    codeSource = newSource;
    if (strategyId && deps.addVersion) {
      try {
        const created = await deps.addVersion(strategyId, { source: newSource, origin: 'human' });
        if (created && created.version_id) activeVersionId = created.version_id;
      } catch (err) { fail(err); return; }
    }
    if (alsoRun) { await startRun(false); return; }
    setState({ view: 'design', tab: 'design', designTab: 'code' });
  }

  async function loadFlow() {
    if (!deps.flow || !codeSource) { setState({ flow: null }); return; }
    try { setState({ flow: await deps.flow({ source: codeSource }) }); }
    catch (err) { fail(err); }
  }

  async function loadHistory() {
    setState({ view: 'history', tab: 'history' });
    if (!deps.runs) return;
    try { setState({ runs: await deps.runs() }); }
    catch (err) { fail(err); }
  }

  // 이력 비교의 곡선 겹쳐보기(보드 05). 목록 응답에는 equity가 없어 실행별로 한 번씩
  // 더 받는다 — 목록에 곡선 400점씩을 늘 실어 보내면 이력 화면이 무거워진다.
  async function loadCompareEquity(runIds) {
    if (!deps.result) return;
    try {
      const loaded = await Promise.all(runIds.map((id) => deps.result({ run_id: id })));
      const series = loaded.map((r, i) => ({
        label: String(runIds[i]).slice(0, 8),
        equity: (r && r.equity) || [],
      }));
      setState({ compareEquity: series });
    } catch { setState({ compareEquity: null }); }
  }

  async function runOptimize() {
    const ranges = optimizeRanges();
    if (!ranges.length) { setState({ optimizeError: '훑을 파라미터가 없습니다' }); return; }
    setState({ optimizeBusy: true, optimizeError: '' });
    try {
      const res = await deps.optimize({
        yaml: currentYaml(),
        ranges,
        method: state.optimizeMethod || 'grid',
        ascending: ranges.length >= 2 ? [ranges[0].name, ranges[1].name] : undefined,
      });
      setState({ optimizeBusy: false, optimizeResult: res });
    } catch (err) {
      setState({ optimizeBusy: false, optimizeError: String((err && err.message) || err) });
    }
  }

  // 전략 파라미터를 그대로 서치 축으로 쓴다 — 사용자가 축을 새로 정의할 이유가 없다.
  function optimizeRanges() {
    if (!spec) return [];
    return Object.keys(spec.params).slice(0, 2).map((name) => {
      const p = spec.params[name];
      const step = p.step || 1;
      // 조합 상한(1000)을 넘지 않도록 축마다 12칸 안쪽으로 성긴 격자를 만든다.
      const span = p.max - p.min;
      const coarse = Math.max(step, Math.ceil(span / 11 / step) * step);
      return {
        name, start: p.min, stop: p.max, step: coarse, is_int: p.type === 'int',
      };
    });
  }

  async function applyBestParams() {
    const best = state.optimizeResult && state.optimizeResult.best;
    if (!best) return;
    Object.keys(best.params).forEach((name) => { spec = SpecModel.setParam(spec, name, best.params[name]); });
    setState({ view: 'design', tab: 'design', designTab: 'form' });
  }

  async function loadDeployments() {
    setState({ view: 'deploy', tab: 'deploy' });
    if (!deps.deployments) return;
    try { setState({ deployments: await deps.deployments() }); }
    catch (err) { fail(err); }
  }

  function resumePollingIfNeeded() {
    if (pollTimer != null) return;
    if (state.view !== 'running') return;
    if (state.jobId && !state.runId) pollJob();
    else if (state.runId) pollRun();
  }

  // ---------- 렌더 ----------

  function render() {
    if (!mounted) return;
    clear(container);
    if (state.view === 'empty') {
      container.appendChild(renderMessagePanel('', '프리셋을 불러오는 중입니다…'));
      return;
    }
    if (state.view === 'error') {
      container.appendChild(renderMessagePanel(
        'backtest-canvas-error', state.message || '알 수 없는 오류입니다',
      ));
      return;
    }
    const shell = el('div', 'backtest-shell');
    shell.appendChild(renderHeader());
    const body = el('div', 'backtest-body');
    if (state.view === 'approval') body.appendChild(renderApproval());
    else if (state.view === 'running') body.appendChild(renderRunning());
    else if (state.view === 'diagnosis') body.appendChild(renderDiagnosisPanel());
    else if (state.tab === 'design') body.appendChild(renderDesign());
    else if (state.tab === 'result') body.appendChild(renderResult());
    else if (state.tab === 'history') body.appendChild(renderHistory());
    else if (state.tab === 'optimize') body.appendChild(renderOptimize());
    else if (state.tab === 'deploy') body.appendChild(renderDeploy());
    shell.appendChild(body);
    container.appendChild(shell);
  }

  function renderMessagePanel(extraClass, sub) {
    const wrap = el('div', `backtest-canvas-empty${extraClass ? ` ${extraClass}` : ''}`);
    wrap.appendChild(el('div', 'backtest-canvas-empty-title', '백테스트'));
    wrap.appendChild(el('div', 'backtest-canvas-empty-sub', sub));
    return wrap;
  }

  // 보드 01/03 헤더 — 전략 이름·버전, 모드 탭, 실행 버튼.
  function renderHeader() {
    const head = el('div', 'backtest-head');
    const title = el('div', 'backtest-head-title');
    title.appendChild(el('span', 'backtest-head-name', '백테스트'));
    if (spec) {
      title.appendChild(el('span', 'backtest-head-strategy', spec.name));
      if (activeVersionId) title.appendChild(el('span', 'backtest-head-version', '코드 버전 활성'));
    }
    head.appendChild(title);

    const tabs = el('div', 'backtest-tabs');
    MODE_TABS.forEach(([key, label]) => {
      const isOn = state.tab === key;
      const tab = button(`backtest-tab${isOn ? ' is-on' : ''}`, label, () => {
        if (key === 'history') { void loadHistory(); return; }
        if (key === 'deploy') { void loadDeployments(); return; }
        setState({ view: key === 'result' && state.result ? 'result' : 'design', tab: key });
      });
      tab.setAttribute('aria-pressed', String(isOn));
      tabs.appendChild(tab);
    });
    head.appendChild(tabs);

    head.appendChild(button('backtest-run-button', '실행', () => { void handleRun(false); }));
    return head;
  }

  // ── 보드 01 · 설계(폼) ────────────────────────────────────────────────────

  function renderDesign() {
    const wrap = el('div', 'backtest-design');
    const subtabs = el('div', 'backtest-subtabs');
    DESIGN_TABS.forEach(([key, label]) => {
      const isOn = state.designTab === key;
      const tab = button(`backtest-subtab${isOn ? ' is-on' : ''}`, label, () => {
        setState({ designTab: key });
        if (key === 'flow') void loadFlow();
      });
      tab.setAttribute('aria-pressed', String(isOn));
      subtabs.appendChild(tab);
    });
    wrap.appendChild(subtabs);

    if (state.designTab === 'code') { wrap.appendChild(renderCodeTab()); return wrap; }
    if (state.designTab === 'flow') { wrap.appendChild(renderFlowTab()); return wrap; }

    if (!presets.length) {
      wrap.appendChild(el('div', 'backtest-design-empty', '사용 가능한 프리셋이 없습니다'));
      return wrap;
    }
    wrap.appendChild(renderPresetList());
    wrap.appendChild(renderTargetCard());
    wrap.appendChild(renderIndicatorCard());
    wrap.appendChild(renderConditionCards());
    wrap.appendChild(renderRiskCard());
    wrap.appendChild(renderFormErrors());
    wrap.appendChild(renderAssumptions());
    return wrap;
  }

  function renderPresetList() {
    const wrap = el('div', 'backtest-preset-wrap');
    wrap.appendChild(el('div', 'backtest-card-title', `무엇으로 시작할까요 — 프리셋 ${presets.length}종`));
    const list = el('div', 'backtest-preset-list');
    presets.forEach((preset) => {
      const isSelected = spec && preset.id === spec.presetId;
      const item = button(
        `backtest-preset-item${isSelected ? ' is-selected' : ''}`, null,
        () => selectPreset(preset.id),
      );
      item.setAttribute('aria-pressed', String(isSelected));
      item.appendChild(el('div', 'backtest-preset-name', preset.name));
      item.appendChild(el('div', 'backtest-preset-category', preset.category || ''));
      list.appendChild(item);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function textField(label, value, placeholder, onInput) {
    const field = el('label', 'backtest-field');
    field.appendChild(el('span', 'backtest-field-label', label));
    const input = el('input', 'backtest-field-input');
    input.type = 'text';
    input.placeholder = placeholder || '';
    input.value = value == null ? '' : String(value);
    // 매 키입력마다 render()를 부르면 포커스를 잃는다 — 모델만 갱신한다.
    input.addEventListener('input', () => onInput(input.value));
    field.appendChild(input);
    return field;
  }

  function renderTargetCard() {
    const card = el('div', 'backtest-card');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '대상 · 기간'));
    if (state.coverage) {
      head.appendChild(el(
        'div', 'backtest-card-note',
        `캐시 ${formatNumeric(state.coverage.rows)}봉 · ${state.coverage.first_dt || '없음'}`
        + ` → ${state.coverage.last_dt || '없음'}`,
      ));
    }
    card.appendChild(head);

    const chips = el('div', 'backtest-symbol-chips');
    spec.symbols.forEach((code) => {
      const chip = el('span', 'backtest-symbol-chip');
      chip.appendChild(el('span', 'backtest-symbol-code', code));
      chip.appendChild(button('backtest-symbol-remove', '×', () => {
        spec = SpecModel.removeSymbol(spec, code);
        render();
      }));
      chips.appendChild(chip);
    });
    const addInput = el('input', 'backtest-field-input backtest-symbol-add');
    addInput.type = 'text';
    addInput.placeholder = '종목코드 추가 (005930)';
    addInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      spec = SpecModel.addSymbol(spec, addInput.value);
      addInput.value = '';
      render();
    });
    chips.appendChild(addInput);
    card.appendChild(chips);

    const row = el('div', 'backtest-field-row');
    const periodGroup = el('div', 'backtest-segment');
    SpecModel.PERIODS.forEach(([value, label]) => {
      const isOn = spec.period === value;
      const seg = button(`backtest-segment-item${isOn ? ' is-on' : ''}`, label, () => {
        spec = Object.assign({}, spec, { period: value });
        render();
      });
      seg.setAttribute('aria-pressed', String(isOn));
      periodGroup.appendChild(seg);
    });
    row.appendChild(periodGroup);
    row.appendChild(textField('시작일', spec.fromDt, 'YYYYMMDD', (v) => { spec.fromDt = v; }));
    row.appendChild(textField('종료일', spec.toDt, 'YYYYMMDD', (v) => { spec.toDt = v; }));

    const adjusted = el('label', 'backtest-field backtest-field-checkbox');
    const adjInput = el('input');
    adjInput.type = 'checkbox';
    adjInput.checked = spec.adjusted;
    adjInput.addEventListener('change', () => { spec.adjusted = !!adjInput.checked; });
    adjusted.appendChild(adjInput);
    adjusted.appendChild(el('span', 'backtest-field-label', '수정주가'));
    row.appendChild(adjusted);
    card.appendChild(row);
    return card;
  }

  function renderIndicatorCard() {
    const card = el('div', 'backtest-card');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '지표'));
    head.appendChild(el(
      'div', 'backtest-card-note',
      `${spec.indicators.length}종 사용 · 별칭으로 조건에서 부릅니다`,
    ));
    card.appendChild(head);

    if (!spec.indicators.length) {
      card.appendChild(el('div', 'backtest-card-empty', '이 전략은 지표를 쓰지 않습니다'));
      return card;
    }

    spec.indicators.forEach((ind) => {
      const row = el('div', 'backtest-indicator-row');
      row.appendChild(el('span', 'backtest-indicator-id', ind.id));
      row.appendChild(el('span', 'backtest-indicator-alias', ind.alias));
      // $참조 파라미터만 슬라이더가 된다 — 리터럴은 전략이 고정한 값이라 사용자 축이 아니다.
      Object.keys(ind.params || {}).forEach((key) => {
        const raw = ind.params[key];
        if (typeof raw !== 'string' || raw[0] !== '$') {
          row.appendChild(el('span', 'backtest-indicator-fixed', `${key} ${raw}`));
          return;
        }
        const name = raw.slice(1);
        const p = spec.params[name];
        if (!p) return;
        row.appendChild(renderParamSlider(name, p));
      });
      card.appendChild(row);
    });
    return card;
  }

  function renderParamSlider(name, p) {
    const wrap = el('div', 'backtest-param');
    wrap.appendChild(el('span', 'backtest-param-name', name));
    const slider = el('input', 'backtest-param-slider');
    slider.type = 'range';
    slider.setAttribute('min', String(p.min));
    slider.setAttribute('max', String(p.max));
    slider.setAttribute('step', String(p.step));
    slider.value = String(p.default);
    slider.setAttribute('aria-label', `${name} 값`);
    const value = el('span', 'backtest-param-value', p.default);
    slider.addEventListener('input', () => {
      spec = SpecModel.setParam(spec, name, slider.value);
      value.textContent = String(spec.params[name].default);
    });
    wrap.appendChild(slider);
    wrap.appendChild(value);
    wrap.appendChild(el('span', 'backtest-param-range', `${p.min} – ${p.max}`));
    return wrap;
  }

  function renderConditionCards() {
    const row = el('div', 'backtest-condition-row');
    [['entry', '진입 조건'], ['exit', '청산 조건']].forEach(([side, label]) => {
      const card = el('div', 'backtest-card backtest-condition-card');
      const head = el('div', 'backtest-card-head');
      head.appendChild(el('div', 'backtest-card-title', label));
      const group = spec[side];
      const logicBtn = button(
        `backtest-logic-badge is-${group.logic.toLowerCase()}`,
        SpecModel.LOGIC_LABELS[group.logic],
        () => {
          spec = SpecModel.setLogic(spec, side, group.logic === 'AND' ? 'OR' : 'AND');
          render();
        },
      );
      head.appendChild(logicBtn);
      card.appendChild(head);

      group.conditions.forEach((cond, index) => {
        const line = el('div', 'backtest-condition');
        const opLabel = (SpecModel.OPERATORS.find((o) => o[0] === cond.operator) || [])[1]
          || cond.operator;
        line.appendChild(el('span', 'backtest-condition-name', cond.indicator));
        line.appendChild(el('span', 'backtest-condition-op', opLabel));
        line.appendChild(el('span', 'backtest-condition-target', cond.compare_to));
        line.appendChild(button('backtest-condition-remove', '×', () => {
          spec = SpecModel.removeCondition(spec, side, index);
          render();
        }));
        card.appendChild(line);
      });

      card.appendChild(renderConditionAdder(side));
      row.appendChild(card);
    });
    return row;
  }

  function renderConditionAdder(side) {
    const wrap = el('div', 'backtest-condition-add');
    const names = SpecModel.referenceNames(spec);
    const left = el('select', 'backtest-condition-select');
    names.forEach((n) => {
      const opt = el('option', '', n);
      opt.value = n;
      left.appendChild(opt);
    });
    const op = el('select', 'backtest-condition-select');
    SpecModel.OPERATORS.forEach(([value, label]) => {
      const opt = el('option', '', label);
      opt.value = value;
      op.appendChild(opt);
    });
    const right = el('input', 'backtest-field-input backtest-condition-target-input');
    right.type = 'text';
    right.placeholder = '이름 또는 숫자';
    left.setAttribute('aria-label', `${side} 조건 왼쪽`);
    op.setAttribute('aria-label', `${side} 조건 연산자`);
    right.setAttribute('aria-label', `${side} 조건 오른쪽`);

    wrap.appendChild(left);
    wrap.appendChild(op);
    wrap.appendChild(right);
    wrap.appendChild(button('backtest-condition-add-button', '조건 추가', () => {
      const raw = String(right.value || '').trim();
      if (!raw) return;
      spec = SpecModel.addCondition(spec, side, {
        indicator: left.value,
        operator: op.value,
        compare_to: /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw,
      });
      render();
    }));
    return wrap;
  }

  function renderRiskCard() {
    const card = el('div', 'backtest-card');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '리스크 · 비용'));
    head.appendChild(el('div', 'backtest-card-note', COSTS_NOTE));
    card.appendChild(head);

    const row = el('div', 'backtest-field-row');
    [['stop_loss', '손절'], ['take_profit', '익절']].forEach(([key, label]) => {
      const field = el('label', 'backtest-field backtest-field-checkbox');
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.checked = !!spec.risk[key].enabled;
      toggle.addEventListener('change', () => {
        spec.risk[key].enabled = !!toggle.checked;
      });
      field.appendChild(toggle);
      field.appendChild(el('span', 'backtest-field-label', label));
      const pct = el('input', 'backtest-field-input backtest-field-pct');
      pct.type = 'text';
      pct.value = String(spec.risk[key].percent);
      pct.setAttribute('aria-label', `${label} 비율(%)`);
      pct.addEventListener('input', () => {
        const n = Number(pct.value);
        if (Number.isFinite(n)) spec.risk[key].percent = n;
      });
      field.appendChild(pct);
      row.appendChild(field);
    });

    [['fee_bps', '수수료(bp)'], ['tax_bps', '매도세(bp)'], ['slippage_bps', '슬리피지(bp)']]
      .forEach(([key, label]) => {
        row.appendChild(textField(label, spec.costs[key], '', (v) => {
          const n = Number(v);
          if (Number.isFinite(n)) spec.costs[key] = n;
        }));
      });
    card.appendChild(row);
    return card;
  }

  function renderFormErrors() {
    const wrap = el('div', 'backtest-design-error');
    (state.formErrors || []).forEach((message) => {
      wrap.appendChild(el('div', 'backtest-design-error-line', message));
    });
    return wrap;
  }

  // ── 보드 02 · 설계(코드) ──────────────────────────────────────────────────

  function renderCodeTab() {
    const wrap = el('div', 'backtest-code-tab');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', 'strategy.py'));
    head.appendChild(el('div', 'backtest-card-note', 'python 3.12 · pandas · numpy · athena_bt'));
    wrap.appendChild(head);

    const host = el('div', 'backtest-code-host');
    wrap.appendChild(host);
    // 편집기는 자기 DOM을 직접 만든다 — render()가 매번 새로 만들지만, 입력은
    // textarea가 갖고 있고 값은 codeSource가 갖고 있어 상태를 잃지 않는다.
    editorHandle = CodeEditor.createCodeEditor({
      container: host,
      value: codeSource,
      onChange: (next) => { codeSource = next; },
    });
    if (state.flowRange) {
      editorHandle.highlightLines(state.flowRange.first, state.flowRange.last);
    }

    const actions = el('div', 'backtest-code-actions');
    actions.appendChild(button('backtest-code-validate', '검증', async () => {
      if (!deps.validate) return;
      try {
        const res = await deps.validate({ kind: 'python', source: codeSource });
        setState({ codeErrors: res && res.ok ? [] : (res.errors || []).map((e) => e.message) });
      } catch (err) { fail(err); }
    }));
    actions.appendChild(button('backtest-code-save', '이 코드로 저장', async () => {
      if (!deps.createStrategy) return;
      try {
        if (!strategyId) {
          const created = await deps.createStrategy({
            name: spec ? spec.name : '내 전략', kind: 'python', source: codeSource,
          });
          strategyId = created.strategy_id;
          activeVersionId = created.version_id;
        } else {
          const created = await deps.addVersion(strategyId, {
            source: codeSource, origin: 'human',
          });
          activeVersionId = created.version_id;
        }
        setState({ codeErrors: [] });
      } catch (err) { fail(err); }
    }));
    wrap.appendChild(actions);

    const errors = el('div', 'backtest-design-error');
    (state.codeErrors || []).forEach((m) => {
      errors.appendChild(el('div', 'backtest-design-error-line', m));
    });
    wrap.appendChild(errors);

    const bounds = el('div', 'backtest-code-bounds');
    bounds.appendChild(el('div', 'backtest-card-title', '이 코드가 닿을 수 있는 것'));
    bounds.appendChild(el(
      'div', 'backtest-code-bounds-ok',
      '건네받은 봉 데이터 · pandas · numpy · athena_bt',
    ));
    bounds.appendChild(el(
      'div', 'backtest-code-bounds-no',
      '키움 자격증명 · 계좌 · DB · 네트워크 — 넘기지 않습니다',
    ));
    bounds.appendChild(el(
      'div', 'backtest-code-bounds-note',
      '파이썬 샌드박스는 작정한 공격자를 막지 못합니다. 진짜 경계는 자격증명을 안 넘기는 것, '
      + 'DB에 못 닿는 것, 별도 프로세스, 시간 제한 넷입니다.',
    ));
    wrap.appendChild(bounds);
    return wrap;
  }

  // ── 보드 08 · 코드 플로우 지도 ────────────────────────────────────────────

  function renderFlowTab() {
    const wrap = el('div', 'backtest-flow-tab');
    if (!codeSource) {
      wrap.appendChild(el(
        'div', 'backtest-card-empty',
        '코드 탭에서 전략을 쓰면 흐름 지도가 여기 그려집니다',
      ));
      return wrap;
    }
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '이 코드는 이렇게 흐릅니다'));
    head.appendChild(el('div', 'backtest-card-note', '칸을 누르면 코드 탭에서 그 줄이 켜집니다'));
    wrap.appendChild(head);
    const map = el('div', 'backtest-flow-map');
    Explain.renderFlowMap(map, state.flow, {
      onSelect: (range) => { setState({ flowRange: range, designTab: 'code' }); },
    });
    wrap.appendChild(map);
    return wrap;
  }

  // ── 보드 04 · 데이터 수집 승인 ────────────────────────────────────────────

  function renderApproval() {
    const wrap = el('div', 'backtest-approval');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-approval-badge', '수집 필요'));
    head.appendChild(el('div', 'backtest-approval-title', '캐시에 없는 구간이 있습니다'));
    wrap.appendChild(head);

    const ratio = coverageRatio(state.cachedRows, state.neededPages);
    const bar = el('div', 'backtest-coverage-bar');
    const missing = el('div', 'backtest-coverage-missing');
    missing.setAttribute('style', `width:${((1 - ratio) * 100).toFixed(1)}%`);
    const held = el('div', 'backtest-coverage-held');
    held.setAttribute('style', `width:${(ratio * 100).toFixed(1)}%`);
    bar.appendChild(missing);
    bar.appendChild(held);
    wrap.appendChild(bar);

    const stats = el('div', 'backtest-approval-stats');
    stats.appendChild(el('div', 'backtest-approval-stat', `TR 호출 · ka10081 × ${formatNumeric(state.neededPages)}회`));
    stats.appendChild(el('div', 'backtest-approval-stat', `예상 소요 · ${formatNumeric(state.estSeconds)}초`));
    wrap.appendChild(stats);

    wrap.appendChild(el(
      'div', 'backtest-approval-note',
      '수정주가 기준으로 받습니다. 이어 붙일 때 최근 20봉 종가를 대조해 권리락이 감지되면 '
      + '전체를 다시 받고, 그 사실을 결과에 남깁니다.',
    ));

    const actions = el('div', 'backtest-approval-actions');
    actions.appendChild(button('backtest-approval-confirm', '수집하고 실행', () => {
      void confirmBackfill();
    }));
    // 이 버튼이 없으면 휴장일 함정(계획서 §11-9)에서 사용자가 빠져나오지 못한다.
    actions.appendChild(button('backtest-approval-partial', '보유 구간만으로 실행', () => {
      void startRun(true);
    }));
    actions.appendChild(button('backtest-approval-cancel', '취소', cancelApproval));
    wrap.appendChild(actions);
    return wrap;
  }

  function renderRunning() {
    const wrap = el('div', 'backtest-running');
    wrap.appendChild(el('div', 'backtest-running-title', '진행 중'));
    wrap.appendChild(el('div', 'backtest-running-sub', state.progressText || '처리하는 중입니다…'));
    if (state.progress) {
      const bar = el('div', 'backtest-progress-bar');
      const fill = el('div', 'backtest-progress-fill');
      const done = Number(state.progress.page) || 0;
      const total = Math.max(done, Number(state.neededPages) || done || 1);
      fill.setAttribute('style', `width:${Math.min((done / total) * 100, 100).toFixed(1)}%`);
      bar.appendChild(fill);
      wrap.appendChild(bar);
      wrap.appendChild(el(
        'div', 'backtest-progress-log',
        `ka10081 base_dt=${state.progress.oldest_dt || '—'} → ${formatNumeric(state.progress.rows)}봉`,
      ));
    }
    return wrap;
  }

  // ── 보드 09 · 오류 진단 ───────────────────────────────────────────────────

  function renderDiagnosisPanel() {
    const wrap = el('div', 'backtest-diagnosis');
    Explain.renderDiagnosis(wrap, state.diagnosis, {
      onApply: (source, alsoRun) => { void applyFix(source, alsoRun); },
      onDiscard: () => setState({ view: 'design', tab: 'design', designTab: 'code' }),
    });
    return wrap;
  }

  // ── 보드 03 · 결과 ────────────────────────────────────────────────────────

  function renderResult() {
    if (!state.result) {
      return renderMessagePanel('', '아직 실행한 백테스트가 없습니다');
    }
    const wrap = el('div', 'backtest-result');
    wrap.appendChild(renderMetricTiles());
    wrap.appendChild(renderEquity());
    wrap.appendChild(renderStdout());
    wrap.appendChild(renderTradesTable());
    wrap.appendChild(renderAssumptions());
    return wrap;
  }

  function renderMetricTiles() {
    const grid = el('div', 'backtest-metric-tiles');
    const metrics = state.result && state.result.metrics;
    METRIC_TILES.forEach((tile) => {
      const card = el('div', 'backtest-metric-tile');
      card.appendChild(el('div', 'backtest-metric-label', tile.label));
      card.appendChild(el('div', 'backtest-metric-value', metricTileValue(tile, metrics)));
      const sub = metricTileSub(tile, metrics);
      if (sub) card.appendChild(el('div', 'backtest-metric-sub', sub));
      grid.appendChild(card);
    });
    return grid;
  }

  function renderEquity() {
    const wrap = el('div', 'backtest-equity');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '자산곡선'));
    const legend = el('div', 'backtest-equity-legend');
    legend.appendChild(el('span', 'backtest-legend-strategy', '전략'));
    legend.appendChild(el('span', 'backtest-legend-benchmark', '매수보유'));
    legend.appendChild(el('span', 'backtest-legend-entry', '진입'));
    legend.appendChild(el('span', 'backtest-legend-exit', '청산'));
    head.appendChild(legend);
    wrap.appendChild(head);

    const host = el('div', 'backtest-equity-host');
    // createElementNS가 없는 환경(단위 테스트 DOM 스텁)에서는 곡선을 건너뛴다 —
    // 이 파일의 검증 대상은 상태 전이이지 SVG 그리기가 아니다(그건 equity-chart 테스트).
    if (typeof document.createElementNS === 'function') {
      EquityChart.renderEquityChart(host, {
        equity: (state.result && state.result.equity) || [],
        closes: state.closes || [],
        trades: state.trades || [],
      });
    }
    wrap.appendChild(host);
    return wrap;
  }

  function renderStdout() {
    const text = (state.result && state.result.stdout) || '';
    const wrap = el('div', 'backtest-stdout');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '코드 출력'));
    head.appendChild(el('div', 'backtest-card-note', 'print 그대로'));
    wrap.appendChild(head);
    wrap.appendChild(el('pre', 'backtest-stdout-text', text || '출력이 없습니다'));
    return wrap;
  }

  function renderTradesTable() {
    const trades = Array.isArray(state.trades) ? state.trades : [];
    const wrap = el('div', 'backtest-trades');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-trades-title', `체결 ${formatNumeric(trades.length)}건`));
    head.appendChild(el('div', 'backtest-card-note', '수수료·세금 반영 후 손익'));
    wrap.appendChild(head);
    if (!trades.length) {
      wrap.appendChild(el('div', 'backtest-trades-empty', '체결이 없습니다'));
      return wrap;
    }
    const table = el('table', 'backtest-trades-table');
    const headRow = el('tr', 'backtest-trades-row backtest-trades-head');
    ['일자', '방향', '체결가', '수량', '비용', '손익', '사유'].forEach((label) => {
      headRow.appendChild(el('th', 'backtest-trades-cell', label));
    });
    table.appendChild(headRow);
    trades.forEach((trade) => {
      const row = el('tr', 'backtest-trades-row');
      row.appendChild(el('td', 'backtest-trades-cell', formatDatetime(trade.dt)));
      row.appendChild(el('td', `backtest-trades-cell is-${trade.side}`, SIDE_LABEL[trade.side] || trade.side));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.price)));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.qty)));
      // 비용은 수수료+세금이다 — 수수료만 보여주면 매도 거래세가 사라진 것처럼 읽힌다.
      const cost = (Number(trade.fee) || 0) + (Number(trade.tax) || 0);
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(cost)));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.pnl)));
      row.appendChild(el('td', 'backtest-trades-cell', REASON_LABEL[trade.reason] || trade.reason));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderAssumptions() {
    const wrap = el('div', 'backtest-assumptions');
    wrap.appendChild(el('div', 'backtest-assumptions-title', '체결 가정'));
    wrap.appendChild(el('div', 'backtest-assumptions-text', ASSUMPTIONS_TEXT));
    const result = state.result || {};
    const flags = Array.isArray(result.flags)
      ? result.flags
      : (result.metrics && Array.isArray(result.metrics.flags) ? result.metrics.flags : []);
    if (flags.length) {
      wrap.appendChild(el('div', 'backtest-assumptions-flags', `플래그 · ${flags.join(' · ')}`));
    }
    return wrap;
  }

  // ── 보드 05 · 이력 · 비교 ─────────────────────────────────────────────────

  function renderHistory() {
    const wrap = el('div', 'backtest-history');
    const runs = Array.isArray(state.runs) ? state.runs : [];
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', `실행 이력 ${formatNumeric(runs.length)}건`));
    head.appendChild(el('div', 'backtest-card-note', '2개를 고르면 아래에서 겹쳐 봅니다'));
    wrap.appendChild(head);

    if (!runs.length) {
      wrap.appendChild(el('div', 'backtest-card-empty', '아직 실행 이력이 없습니다'));
      return wrap;
    }

    const selected = state.compare || [];
    runs.forEach((run) => {
      const isOn = selected.indexOf(run.run_id) !== -1;
      const row = button(`backtest-history-row${isOn ? ' is-on' : ''}`, null, () => {
        const next = isOn
          ? selected.filter((id) => id !== run.run_id)
          : selected.concat([run.run_id]).slice(-2);
        setState({ compare: next });
        // 두 건이 모이면 곡선을 겹치기 위해 각 실행의 equity를 받아온다(보드 05).
        if (next.length === 2) void loadCompareEquity(next);
      });
      row.setAttribute('aria-pressed', String(isOn));
      row.appendChild(el('span', 'backtest-history-check', isOn ? '■' : '□'));
      row.appendChild(el('span', 'backtest-history-id', String(run.run_id).slice(0, 8)));
      row.appendChild(el('span', `backtest-history-status is-${run.status}`, run.status));
      const total = run.metrics && run.metrics.total_return;
      row.appendChild(el(
        'span', 'backtest-history-return',
        run.status === 'done' ? formatPercentValue(total) : '—',
      ));
      wrap.appendChild(row);
    });

    if (selected.length === 2) {
      const [a, b] = selected.map((id) => runs.find((r) => r.run_id === id)).filter(Boolean);
      if (a && b) wrap.appendChild(renderCompare(a, b));
    }
    return wrap;
  }

  function renderCompare(a, b) {
    const wrap = el('div', 'backtest-compare');
    wrap.appendChild(el('div', 'backtest-card-title', '무엇이 달랐나'));
    const table = el('div', 'backtest-compare-table');
    [
      ['총수익률', 'total_return', 'percent'],
      ['Sharpe', 'sharpe', 'ratio'],
      ['MDD', 'mdd', 'percent'],
      ['승률', 'win_rate', 'percent'],
    ].forEach(([label, key, kind]) => {
      const row = el('div', 'backtest-compare-row');
      const fmt = kind === 'ratio' ? formatRatioValue : formatPercentValue;
      row.appendChild(el('span', 'backtest-compare-label', label));
      row.appendChild(el('span', 'backtest-compare-a', fmt(a.metrics && a.metrics[key])));
      row.appendChild(el('span', 'backtest-compare-b', fmt(b.metrics && b.metrics[key])));
      table.appendChild(row);
    });
    wrap.appendChild(table);

    const series = state.compareEquity;
    if (series && series.length === 2) {
      const legend = el('div', 'backtest-equity-legend');
      series.forEach((s, i) => {
        legend.appendChild(el('span', `backtest-legend-overlay is-${i}`, s.label));
      });
      wrap.appendChild(legend);
      const host = el('div', 'backtest-compare-chart');
      if (typeof document.createElementNS === 'function') {
        EquityChart.renderOverlayChart(host, { series });
      }
      wrap.appendChild(host);
    }
    return wrap;
  }

  // ── 보드 06 · 최적화 ──────────────────────────────────────────────────────

  function renderOptimize() {
    const wrap = el('div', 'backtest-optimize');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '파라미터 최적화'));
    head.appendChild(el('div', 'backtest-card-note', '캐시만 씁니다 — 추가 TR 호출 없음'));
    wrap.appendChild(head);

    const ranges = optimizeRanges();
    const setup = el('div', 'backtest-optimize-setup');
    ranges.forEach((r) => {
      setup.appendChild(el(
        'div', 'backtest-optimize-range',
        `${r.name} ${r.start} → ${r.stop} · step ${r.step}`,
      ));
    });
    if (!ranges.length) {
      setup.appendChild(el('div', 'backtest-card-empty', '이 전략에는 훑을 파라미터가 없습니다'));
    }
    wrap.appendChild(setup);

    const methods = el('div', 'backtest-segment');
    [['grid', '그리드'], ['random', '랜덤']].forEach(([value, label]) => {
      const isOn = (state.optimizeMethod || 'grid') === value;
      const seg = button(`backtest-segment-item${isOn ? ' is-on' : ''}`, label, () => {
        setState({ optimizeMethod: value });
      });
      seg.setAttribute('aria-pressed', String(isOn));
      methods.appendChild(seg);
    });
    wrap.appendChild(methods);

    wrap.appendChild(button('backtest-optimize-start', state.optimizeBusy ? '탐색 중…' : '탐색 시작', () => {
      if (!state.optimizeBusy) void runOptimize();
    }));

    if (state.optimizeError) {
      wrap.appendChild(el('div', 'backtest-design-error-line', state.optimizeError));
    }
    if (state.optimizeResult) wrap.appendChild(renderOptimizeResult(state.optimizeResult));
    return wrap;
  }

  function renderOptimizeResult(res) {
    const wrap = el('div', 'backtest-optimize-result');
    (res.warnings || []).forEach((w) => {
      const warn = el('div', `backtest-optimize-warn is-${w.kind}`);
      warn.appendChild(el('span', 'backtest-optimize-warn-badge', '과최적화 의심'));
      warn.appendChild(el('span', 'backtest-optimize-warn-text', w.message));
      wrap.appendChild(warn);
    });

    if (res.best) {
      const best = el('div', 'backtest-optimize-best');
      const pairs = Object.keys(res.best.params)
        .map((k) => `${k} ${res.best.params[k]}`).join(' · ');
      best.appendChild(el('div', 'backtest-optimize-best-title', `최고 Sharpe ${formatRatioValue(res.best.sharpe)}`));
      best.appendChild(el('div', 'backtest-optimize-best-params', pairs));
      if (res.neighbour_mean_sharpe != null) {
        best.appendChild(el(
          'div', 'backtest-optimize-neighbour',
          `이웃 평균 ${formatRatioValue(res.neighbour_mean_sharpe)}`,
        ));
      }
      best.appendChild(button('backtest-optimize-apply', '이 값을 설계에 넣기', () => {
        void applyBestParams();
      }));
      wrap.appendChild(best);
    }

    if (res.plateau) {
      const plateau = Object.keys(res.plateau)
        .map((k) => `${k} ${res.plateau[k][0]}–${res.plateau[k][1]}`).join(' · ');
      wrap.appendChild(el(
        'div', 'backtest-optimize-plateau',
        `넓은 언덕: ${plateau} → 권장은 봉우리가 아니라 언덕의 중심입니다`,
      ));
    }

    if (res.heatmap) wrap.appendChild(renderHeatmap(res.heatmap));
    return wrap;
  }

  function renderHeatmap(map) {
    const wrap = el('div', 'backtest-heatmap');
    wrap.appendChild(el(
      'div', 'backtest-card-title',
      `Sharpe 히트맵 — ${map.x_axis} × ${map.y_axis}`,
    ));
    const grid = el('div', 'backtest-heatmap-grid');
    (map.cells || []).forEach((cell) => {
      const box = el('div', 'backtest-heatmap-cell');
      const t = heatIntensity(cell.sharpe, map.min_sharpe, map.max_sharpe);
      box.setAttribute('style', `opacity:${(0.15 + t * 0.85).toFixed(2)}`);
      box.setAttribute('title', `${map.x_axis} ${cell.x} · ${map.y_axis} ${cell.y} · Sharpe ${formatRatioValue(cell.sharpe)}`);
      grid.appendChild(box);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // ── 보드 07 · 배포 ────────────────────────────────────────────────────────

  function renderDeploy() {
    const wrap = el('div', 'backtest-deploy');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '전략 배포 · 실전 적용'));
    head.appendChild(el(
      'div', 'backtest-card-note',
      '배포는 신호까지만 만듭니다 — 주문은 주문 게이트를 통과합니다',
    ));
    wrap.appendChild(head);

    const list = Array.isArray(state.deployments) ? state.deployments : [];
    if (!list.length) {
      wrap.appendChild(el('div', 'backtest-card-empty', '아직 배포한 전략이 없습니다'));
    }
    list.forEach((dep) => {
      const row = el('div', `backtest-deploy-row is-${dep.status}`);
      row.appendChild(el('span', 'backtest-deploy-symbol', dep.stk_cd));
      row.appendChild(el('span', 'backtest-deploy-mode', dep.mode_label || dep.mode));
      row.appendChild(el('span', 'backtest-deploy-status', dep.status));
      row.appendChild(button('backtest-deploy-stop', '배포 중지', async () => {
        if (!deps.stopDeployment) return;
        try { await deps.stopDeployment(dep.id); await loadDeployments(); }
        catch (err) { fail(err); }
      }));
      wrap.appendChild(row);
    });

    wrap.appendChild(renderDeployForm());
    wrap.appendChild(el(
      'div', 'backtest-deploy-note',
      '백테스트는 다음 봉 시가에 원하는 수량이 전부 체결된다고 가정하고, 실전은 그렇지 '
      + '않습니다. 실전과 백테스트의 차이는 배포 후 신호 목록에서 그대로 보여드립니다.',
    ));
    return wrap;
  }

  function renderDeployForm() {
    const card = el('div', 'backtest-card');
    card.appendChild(el('div', 'backtest-card-title', '새 배포'));
    if (!activeVersionId) {
      card.appendChild(el(
        'div', 'backtest-card-empty',
        '먼저 코드 탭에서 전략을 저장해야 배포할 수 있습니다 — 배포는 저장된 버전에 묶입니다',
      ));
      return card;
    }

    const modes = el('div', 'backtest-deploy-modes');
    DEPLOY_MODES.forEach(([value, label, detail]) => {
      const isOn = (state.deployMode || 'approve') === value;
      const item = button(`backtest-deploy-mode-item${isOn ? ' is-on' : ''}`, null, () => {
        setState({ deployMode: value });
      });
      item.setAttribute('aria-pressed', String(isOn));
      item.appendChild(el('div', 'backtest-deploy-mode-label', label));
      item.appendChild(el('div', 'backtest-deploy-mode-detail', detail));
      modes.appendChild(item);
    });
    card.appendChild(modes);

    const limits = state.deployLimits || {
      max_order_amount: 2000000, max_orders_per_day: 2,
      valid_from: SpecModel.todayYyyymmdd(), valid_to: '',
      stop_on_drawdown_pct: 15, stop_on_consecutive_losses: 3,
    };
    const row = el('div', 'backtest-field-row');
    [
      ['max_order_amount', '1회 최대 주문(원)'],
      ['max_orders_per_day', '하루 최대 주문 수'],
      ['valid_from', '유효 시작(YYYYMMDD)'],
      ['valid_to', '유효 종료(YYYYMMDD)'],
      ['stop_on_drawdown_pct', '자동 정지 낙폭(%)'],
      ['stop_on_consecutive_losses', '자동 정지 연속 손절(회)'],
    ].forEach(([key, label]) => {
      row.appendChild(textField(label, limits[key], '', (v) => { limits[key] = v; }));
    });
    card.appendChild(row);
    state.deployLimits = limits;

    card.appendChild(button('backtest-deploy-create', '이 전략을 실전에 겁니다', async () => {
      if (!deps.createDeployment) return;
      try {
        await deps.createDeployment({
          strategy_version_id: activeVersionId,
          stk_cd: spec.symbols[0],
          period: spec.period,
          adjusted: spec.adjusted,
          mode: state.deployMode || 'approve',
          params: {},
          limits: {
            max_order_amount: Number(limits.max_order_amount),
            max_orders_per_day: Number(limits.max_orders_per_day),
            valid_from: String(limits.valid_from),
            valid_to: String(limits.valid_to),
            stop_on_drawdown_pct: Number(limits.stop_on_drawdown_pct),
            stop_on_consecutive_losses: Number(limits.stop_on_consecutive_losses),
          },
        });
        await loadDeployments();
      } catch (err) { fail(err); }
    }));
    return card;
  }

  function mount() {
    mounted = true;
    void loadPresets();
  }

  function refresh() {
    if (!mounted) { mount(); return; }
    if (state.view === 'empty' || state.view === 'error') { void loadPresets(); return; }
    render();
    resumePollingIfNeeded();
  }

  return { mount, refresh };
}

const __exports = {
  createBacktestCanvas,
  // 순수 계산 — node --test 대상(card-primitives.js와 같은 노출 원칙)
  formatPercentValue,
  formatRatioValue,
  metricTileValue,
  metricTileSub,
  coverageRatio,
  heatIntensity,
  METRIC_TILES,
  MODE_TABS,
  DESIGN_TABS,
  DEPLOY_MODES,
  SIGNAL_STAGES,
  ASSUMPTIONS_TEXT,
  COSTS_NOTE,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestCanvas = __exports;
}

})();
