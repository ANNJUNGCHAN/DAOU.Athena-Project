// 백테스트 모드 캔버스 — P4 1차 기능(backtest-mode-plan.md §8, CLAUDE.md 지시 원문).
//
// 화면 문법(디자인 근거: Paper 백테스트 보드 01/03/04): 프리셋 선택 → (캐시 부족
// 시 수집 승인 카드) → 실행 → 결과(지표 6타일 + 체결 표). 코드 편집기(보드 02)는
// P5 범위라 만들지 않는다.
//
// 상태 기계: empty(전략 미선택) → design(프리셋 목록+실행 버튼) → approval(수집
// 승인 카드) → running(진행) → result(지표 6타일·체결 표·가정 섹션) → error.
//
// **왜 design에 "설계 폼(보드 01)"이 아니라 종목코드·주기·수정주가·시작일·종료일
// 5개 입력만 있는가.** presets.py의 설계 결정(bt-api 실측, 2026-08-31): 프리셋은
// 종목·기간을 모르는 순수 전략 템플릿이고, `data:` 블록은 사용자가 캔버스에서
// 채운다. run()의 `params`는 전략 파라미터 오버라이드 전용(예: SMA의 fast/slow)
// 이라 여기 못 쓴다(넣으면 "알 수 없는 전략 파라미터"로 즉시 실패) — 대신 선택한
// 프리셋의 yaml 뒤에 `data:` 블록을 문자열로 이어붙여 POST한다(buildRunYaml).
// 조건 빌더·지표 파라미터 슬라이더 등 보드 01의 나머지는 이번 범위 밖이다.
//
// 데이터 접근은 전부 주입식(deps.fetchPresets/plan/run/status/result/trades/
// backfill/runs) — canvas.js가 window.athena.invoke로 잇는다(agentCanvas의
// fetchRoutines와 같은 모양). deps.plan/runs는 이번 상태 기계가 직접 쓰지 않지만
// (설계 폼이 최소 입력뿐이라 사전 계획 조회를 안 거친다 — approval은 run()의
// 409로 진입한다) 계약대로 IPC까지는 다 이어둔다 — P5/P6이 이어 쓴다.
//
// 폴링: run()이 성공하면 result를 1초 간격으로 재조회해 status 필드로 완료를
// 판정한다(runner.py JobStatus: running|done|failed|cancelled). 완료되면 trades를
// 추가로 받는다. backfill도 같은 리듬으로 status(job)를 폴링하다가 done이면
// 자동으로 run()을 다시 부른다(데이터가 채워졌으니 이번엔 통과해야 정상).
// 컨테이너가 hidden(모드 이탈, controller.js의 applyVisibility 단일 소유)이면
// 다음 tick을 예약하지 않는다 — sidebar.js가 재진입 시 refresh()를 부르고,
// refresh()가 진행 중이던 폴링을 이어 깨운다(재수집 상실 방지).
(function () {
'use strict';

const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { formatNumeric, formatDatetime } = FactsCard;

const POLL_INTERVAL_MS = 1000;

// §6.4(체결 규칙)·§5.5(정직하게 못 하는 것) 그대로 — 접히지 않는다(결과 화면 상시 표기).
const ASSUMPTIONS_TEXT = '신호는 종가 확정 후 판정하고 체결은 다음 봉 시가입니다 · '
  + '손절·익절은 봉 내부 저가·고가 터치로 보고, 같은 봉에서 둘 다 닿으면 손절이 먼저입니다 · '
  + '상·하한가 봉과 거래량 0 봉은 체결 불가로 다음 봉에 넘깁니다 · '
  + '상장폐지 종목은 조회할 수 없어 결과에는 생존 편향이 남습니다 · '
  + '배당 재투자·공매도·신용은 반영하지 않습니다';

// metrics.py Metrics dataclass 필드명 그대로(bt-engine 실측) — kind는 표시 서식만 정한다.
const METRIC_TILES = [
  { key: 'total_return', label: '총수익률', kind: 'percent' },
  { key: 'cagr', label: 'CAGR', kind: 'percent' },
  { key: 'sharpe', label: 'Sharpe', kind: 'ratio' },
  { key: 'mdd', label: 'MDD', kind: 'percent' },
  { key: 'win_rate', label: '승률', kind: 'percent' },
  { key: 'profit_factor', label: 'Profit Factor', kind: 'ratio' },
];

const SIDE_LABEL = { buy: '매수', sell: '매도' };
const REASON_LABEL = { signal: '신호', stop_loss: '손절', take_profit: '익절' };
const PERIOD_OPTIONS = [['day', '일'], ['week', '주'], ['month', '월']];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------- 순수 계산 — DOM 없이 node --test로 검증 ----------

function isValidStkCd(value) {
  return /^\d{6}$/.test(String(value || '').trim());
}

function isValidYyyymmdd(value) {
  return /^\d{8}$/.test(String(value || '').trim());
}

function validateForm(form) {
  if (!isValidStkCd(form && form.stkCd)) return '종목코드는 6자리 숫자여야 합니다';
  if (!isValidYyyymmdd(form && form.fromDt) || !isValidYyyymmdd(form && form.toDt)) {
    return '시작일·종료일은 YYYYMMDD 형식이어야 합니다';
  }
  if (String(form.fromDt) > String(form.toDt)) return '종료일은 시작일보다 빠를 수 없습니다';
  return null;
}

// 프리셋 yaml(순수 전략 템플릿, data: 블록 없음) 뒤에 사용자가 고른 종목·기간
// 블록을 문자열로 이어붙인다 — 머리말 "왜 design에" 판단 기록 참고.
function buildDataBlockYaml(form) {
  const stkCd = String(form.stkCd || '').trim();
  const period = String(form.period || 'day');
  const adjusted = form.adjusted !== false;
  const fromDt = String(form.fromDt || '').trim();
  const toDt = String(form.toDt || '').trim();
  return [
    'data:',
    `  symbols: ["${stkCd}"]`,
    `  period: ${period}`,
    `  adjusted: ${adjusted ? 'true' : 'false'}`,
    `  from: "${fromDt}"`,
    `  to: "${toDt}"`,
  ].join('\n');
}

function buildRunYaml(presetYaml, form) {
  const base = String(presetYaml || '').replace(/\s+$/, '');
  return `${base}\n${buildDataBlockYaml(form)}\n`;
}

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
  const raw = metrics[tile.key];
  return tile.kind === 'ratio' ? formatRatioValue(raw) : formatPercentValue(raw);
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
  let form = { stkCd: '', period: 'day', adjusted: true, fromDt: '', toDt: '' };
  let selectedPreset = null; // 승인→백필→재실행 왕복 동안 들고 있을 확정된 폼 값
  let confirmedForm = null;
  let state = { view: 'empty' };
  let pollTimer = null;
  let loadRequestId = 0; // agent-canvas.js refreshRoutines()와 같은 낡은 응답 가드
  let formErrorNode = null;
  let mounted = false;

  function setState(patch) {
    state = Object.assign({}, state, patch);
    render();
  }

  function isVisible() {
    // #backtestCanvas는 controller.js applyVisibility()가 hidden 단일 소유자다
    // (backtest-mode-plan.md §3.3) — 그 값을 그대로 읽어 폴링 중단을 판단한다.
    // sidebar-mode-nav.js/controller.js를 이 파일이 건드리지 않고도 "모드 이탈
    // 시 폴링 중단"을 지킬 수 있는 이유가 이것이다.
    return !container.hidden;
  }

  function stopPolling() {
    if (pollTimer != null && clearTimeoutImpl) clearTimeoutImpl(pollTimer);
    pollTimer = null;
  }

  function schedulePoll(tick) {
    if (setTimeoutImpl) pollTimer = setTimeoutImpl(tick, POLL_INTERVAL_MS);
  }

  function setFormError(message) {
    if (formErrorNode) formErrorNode.textContent = message || '';
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
      setState({ view: 'error', message: String((err && err.message) || err) });
      return;
    }
    if (rid !== loadRequestId) return;
    presets = Array.isArray(list) ? list : [];
    setState({ view: 'design', selectedId: presets[0] ? presets[0].id : null });
  }

  function selectPreset(id) {
    if (state.view !== 'design') return;
    setState({ selectedId: id });
  }

  async function handleRunClick() {
    const preset = presets.find((p) => p.id === state.selectedId);
    if (!preset) { setFormError('프리셋을 먼저 선택하세요'); return; }
    const invalid = validateForm(form);
    if (invalid) { setFormError(invalid); return; }
    setFormError('');
    selectedPreset = preset;
    confirmedForm = Object.assign({}, form);
    await startRun();
  }

  // 최초 실행과, 백필 완료 뒤 재실행이 이 함수 하나를 공유한다(같은 preset/폼
  // 값으로 다시 부르는 것뿐이라 갈라놓지 않는다).
  async function startRun() {
    setState({ view: 'running', progressText: '백테스트를 실행하는 중입니다…' });
    let res;
    try {
      res = deps.run
        ? await deps.run({ yaml: buildRunYaml(selectedPreset.yaml, confirmedForm) })
        : null;
      if (!res) throw new Error('실행 연결이 없습니다');
    } catch (err) {
      setState({ view: 'error', message: String((err && err.message) || err) });
      return;
    }
    if (res.blocked) {
      setState({ view: 'approval', neededPages: res.needed_pages, estSeconds: res.est_seconds });
      return;
    }
    if (!res.run_id) {
      setState({ view: 'error', message: 'run_id를 받지 못했습니다' });
      return;
    }
    setState({ runId: res.run_id });
    pollRun();
  }

  function cancelApproval() {
    stopPolling();
    setState({ view: 'design' });
  }

  async function confirmBackfill() {
    setState({ view: 'running', progressText: '데이터를 수집하는 중입니다…' });
    let res;
    try {
      res = deps.backfill
        ? await deps.backfill({
          stk_cd: confirmedForm.stkCd,
          period: confirmedForm.period,
          adjusted: confirmedForm.adjusted,
          from_dt: confirmedForm.fromDt,
          to_dt: confirmedForm.toDt,
        })
        : null;
      if (!res || !res.job_id) throw new Error('job_id를 받지 못했습니다');
    } catch (err) {
      setState({ view: 'error', message: String((err && err.message) || err) });
      return;
    }
    setState({ jobId: res.job_id });
    pollJob();
  }

  function pollJob() {
    stopPolling();
    const tick = async () => {
      pollTimer = null;
      if (!isVisible()) return;
      let job;
      try {
        job = deps.status ? await deps.status({ job_id: state.jobId }) : null;
      } catch (err) {
        setState({ view: 'error', message: String((err && err.message) || err) });
        return;
      }
      if (!isVisible()) return;
      if (job && job.progress) {
        setState({
          progressText: `데이터를 수집하는 중입니다 · ${job.progress.page}페이지 · ${job.progress.rows}행`,
        });
      }
      if (job && job.status === 'done') { await startRun(); return; }
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
      try {
        data = deps.result ? await deps.result({ run_id: state.runId }) : null;
      } catch (err) {
        setState({ view: 'error', message: String((err && err.message) || err) });
        return;
      }
      if (!isVisible()) return;
      if (data && data.status === 'done') {
        let trades = [];
        try { trades = deps.trades ? await deps.trades({ run_id: state.runId }) : []; }
        catch { trades = []; }
        setState({ view: 'result', result: data, trades: Array.isArray(trades) ? trades : [] });
        return;
      }
      if (data && (data.status === 'failed' || data.status === 'cancelled')) {
        setState({ view: 'error', message: (data && data.error) || '백테스트 실행에 실패했습니다' });
        return;
      }
      schedulePoll(tick);
    };
    tick();
  }

  // 재진입(sidebar.js가 refresh()를 부른다) 시 hidden 때문에 멈췄던 폴링을 깨운다.
  function resumePollingIfNeeded() {
    if (pollTimer != null) return; // 이미 도는 중
    if (state.view !== 'running') return;
    if (state.jobId && !state.runId) pollJob();
    else if (state.runId) pollRun();
  }

  // ---------- 렌더 ----------

  function render() {
    if (!mounted) return;
    clear(container);
    let panel;
    if (state.view === 'error') panel = renderMessagePanel('backtest-canvas-error', state.message || '알 수 없는 오류입니다');
    else if (state.view === 'design') panel = renderDesign();
    else if (state.view === 'approval') panel = renderApproval();
    else if (state.view === 'running') panel = renderRunning();
    else if (state.view === 'result') panel = renderResult();
    else panel = renderMessagePanel('', '프리셋을 불러오는 중입니다…');
    container.appendChild(panel);
  }

  // empty/error 둘 다 이 자리(P1 빈 상태)를 그대로 쓴다 — 제목+부제 톤을 맞춘다.
  function renderMessagePanel(extraClass, sub) {
    const wrap = el('div', `backtest-canvas-empty${extraClass ? ` ${extraClass}` : ''}`);
    wrap.appendChild(el('div', 'backtest-canvas-empty-title', '백테스트'));
    wrap.appendChild(el('div', 'backtest-canvas-empty-sub', sub));
    return wrap;
  }

  function renderDesign() {
    const wrap = el('div', 'backtest-design');
    wrap.appendChild(el('div', 'backtest-design-title', '백테스트 · 전략 선택'));

    if (!presets.length) {
      wrap.appendChild(el('div', 'backtest-design-empty', '사용 가능한 프리셋이 없습니다'));
      return wrap;
    }

    const list = el('div', 'backtest-preset-list');
    presets.forEach((preset) => {
      const isSelected = preset.id === state.selectedId;
      const item = el('button', `backtest-preset-item${isSelected ? ' is-selected' : ''}`);
      item.type = 'button';
      item.setAttribute('aria-pressed', String(isSelected));
      item.appendChild(el('div', 'backtest-preset-name', preset.name));
      item.appendChild(el('div', 'backtest-preset-category', preset.category || ''));
      item.addEventListener('click', () => selectPreset(preset.id));
      list.appendChild(item);
    });
    wrap.appendChild(list);

    wrap.appendChild(renderForm());

    const errorNode = el('div', 'backtest-design-error');
    formErrorNode = errorNode;
    wrap.appendChild(errorNode);

    const runButton = el('button', 'backtest-run-button', '실행');
    runButton.type = 'button';
    runButton.addEventListener('click', () => { void handleRunClick(); });
    wrap.appendChild(runButton);

    return wrap;
  }

  // 종목코드·주기·수정주가·시작일·종료일 — 프리셋의 data: 블록을 채우는 최소
  // 입력(머리말 "왜 design에" 참고). 입력 이벤트는 form을 직접 고쳐 쓸 뿐 render()를
  // 다시 부르지 않는다 — 매 키입력마다 트리를 새로 그리면 포커스를 잃는다
  // (agent-canvas.js 검색창이 searchQuery만 갱신하고 리스트만 부분 재렌더하는
  // 것과 같은 이유, 여기는 재렌더할 목록조차 없어 아예 안 부른다).
  function renderForm() {
    const formWrap = el('div', 'backtest-design-form');

    const stkCdField = el('label', 'backtest-field');
    stkCdField.appendChild(el('span', 'backtest-field-label', '종목코드'));
    const stkCdInput = el('input', 'backtest-field-input');
    stkCdInput.type = 'text';
    stkCdInput.placeholder = '005930';
    stkCdInput.value = form.stkCd;
    stkCdInput.addEventListener('input', () => { form.stkCd = stkCdInput.value; });
    stkCdField.appendChild(stkCdInput);
    formWrap.appendChild(stkCdField);

    const periodField = el('label', 'backtest-field');
    periodField.appendChild(el('span', 'backtest-field-label', '주기'));
    const periodSelect = el('select', 'backtest-field-input');
    PERIOD_OPTIONS.forEach(([value, label]) => {
      const opt = el('option', '', label);
      opt.value = value;
      if (value === form.period) opt.selected = true;
      periodSelect.appendChild(opt);
    });
    periodSelect.addEventListener('change', () => { form.period = periodSelect.value; });
    periodField.appendChild(periodSelect);
    formWrap.appendChild(periodField);

    const adjustedField = el('label', 'backtest-field backtest-field-checkbox');
    const adjustedInput = el('input');
    adjustedInput.type = 'checkbox';
    adjustedInput.checked = form.adjusted;
    adjustedInput.addEventListener('change', () => { form.adjusted = !!adjustedInput.checked; });
    adjustedField.appendChild(adjustedInput);
    adjustedField.appendChild(el('span', 'backtest-field-label', '수정주가'));
    formWrap.appendChild(adjustedField);

    const fromField = el('label', 'backtest-field');
    fromField.appendChild(el('span', 'backtest-field-label', '시작일'));
    const fromInput = el('input', 'backtest-field-input');
    fromInput.type = 'text';
    fromInput.placeholder = 'YYYYMMDD';
    fromInput.value = form.fromDt;
    fromInput.addEventListener('input', () => { form.fromDt = fromInput.value; });
    fromField.appendChild(fromInput);
    formWrap.appendChild(fromField);

    const toField = el('label', 'backtest-field');
    toField.appendChild(el('span', 'backtest-field-label', '종료일'));
    const toInput = el('input', 'backtest-field-input');
    toInput.type = 'text';
    toInput.placeholder = 'YYYYMMDD';
    toInput.value = form.toDt;
    toInput.addEventListener('input', () => { form.toDt = toInput.value; });
    toField.appendChild(toInput);
    formWrap.appendChild(toField);

    return formWrap;
  }

  function renderApproval() {
    const wrap = el('div', 'backtest-approval');
    wrap.appendChild(el('div', 'backtest-approval-title', '데이터 수집이 필요합니다'));
    const stats = el('div', 'backtest-approval-stats');
    stats.appendChild(el('div', 'backtest-approval-stat', `필요 페이지 · ${formatNumeric(state.neededPages)}`));
    stats.appendChild(el('div', 'backtest-approval-stat', `예상 소요 · ${formatNumeric(state.estSeconds)}초`));
    wrap.appendChild(stats);

    const actions = el('div', 'backtest-approval-actions');
    const cancelButton = el('button', 'backtest-approval-cancel', '취소');
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', cancelApproval);
    const confirmButton = el('button', 'backtest-approval-confirm', '수집하고 실행');
    confirmButton.type = 'button';
    confirmButton.addEventListener('click', () => { void confirmBackfill(); });
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    wrap.appendChild(actions);
    return wrap;
  }

  function renderRunning() {
    const wrap = el('div', 'backtest-running');
    wrap.appendChild(el('div', 'backtest-running-title', '진행 중'));
    wrap.appendChild(el('div', 'backtest-running-sub', state.progressText || '처리하는 중입니다…'));
    return wrap;
  }

  function renderResult() {
    const wrap = el('div', 'backtest-result');
    wrap.appendChild(el('div', 'backtest-result-title', '결과'));
    wrap.appendChild(renderMetricTiles());
    wrap.appendChild(el('div', 'backtest-equity-note', '곡선은 다음 단계'));
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
      // 승률만 미청산 건수를 별도 표기한다(§6.5 — 미청산을 승률 분모에서 뺀
      // 대신 숫자를 숨기지 않는다).
      if (tile.key === 'win_rate' && metrics && metrics.open_positions != null) {
        card.appendChild(el('div', 'backtest-metric-sub', `미청산 ${formatNumeric(metrics.open_positions)}건`));
      }
      grid.appendChild(card);
    });
    return grid;
  }

  function renderTradesTable() {
    const trades = Array.isArray(state.trades) ? state.trades : [];
    const wrap = el('div', 'backtest-trades');
    wrap.appendChild(el('div', 'backtest-trades-title', `체결 내역 · ${formatNumeric(trades.length)}건`));
    if (!trades.length) {
      wrap.appendChild(el('div', 'backtest-trades-empty', '체결이 없습니다'));
      return wrap;
    }
    const table = el('table', 'backtest-trades-table');
    const head = el('tr', 'backtest-trades-row backtest-trades-head');
    ['날짜', '방향', '가격', '수량', '수수료', '손익', '사유'].forEach((label) => {
      head.appendChild(el('th', 'backtest-trades-cell', label));
    });
    table.appendChild(head);
    trades.forEach((trade) => {
      const row = el('tr', 'backtest-trades-row');
      row.appendChild(el('td', 'backtest-trades-cell', formatDatetime(trade.dt)));
      row.appendChild(el('td', 'backtest-trades-cell', SIDE_LABEL[trade.side] || trade.side));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.price)));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.qty)));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.fee)));
      row.appendChild(el('td', 'backtest-trades-cell', formatNumeric(trade.pnl)));
      row.appendChild(el('td', 'backtest-trades-cell', REASON_LABEL[trade.reason] || trade.reason));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  // 가정 섹션 — 결과 상태에서 상시 표기(접기 토글 없음, 과업 지시 원문). flags는
  // 계약상 최상위 필드지만(§6.6) runner.py 실측상 metrics_json 안에 실릴 수도
  // 있어(비용 미설정 등) 두 자리 다 방어적으로 읽는다.
  function renderAssumptions() {
    const wrap = el('div', 'backtest-assumptions');
    wrap.appendChild(el('div', 'backtest-assumptions-title', '가정'));
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

  function mount() {
    mounted = true;
    void loadPresets();
  }

  function refresh() {
    if (!mounted) { mount(); return; }
    // 진행 중(approval/running/result)이면 새로 불러오지 않는다 — 모드를
    // 오가는 동안 진행 상황을 잃지 않는다. 그 외(empty/error/design 재진입)만
    // 프리셋을 다시 받는다(agent-canvas.js의 재진입 새로고침과 같은 태도).
    if (state.view === 'empty' || state.view === 'error' || state.view === 'design') {
      void loadPresets();
      return;
    }
    render();
    resumePollingIfNeeded();
  }

  return { mount, refresh };
}

const __exports = {
  createBacktestCanvas,
  // 순수 계산 — node --test 대상(card-primitives.js와 같은 노출 원칙)
  isValidStkCd,
  isValidYyyymmdd,
  validateForm,
  buildDataBlockYaml,
  buildRunYaml,
  formatPercentValue,
  formatRatioValue,
  metricTileValue,
  ASSUMPTIONS_TEXT,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestCanvas = __exports;
}

})();
