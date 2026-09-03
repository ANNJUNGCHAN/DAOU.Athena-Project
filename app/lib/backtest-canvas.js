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
// 코드 탭의 프로젝트 IDE(결정 D1~D4) — 배선이 있을 때만 켜진다(ensureProjectIde 참고).
const ProjectIde = isNode ? require('./project-ide') : window.AthenaLib.ProjectIde;
// 시각 전략 편집기(US-007) — 지도 탭이 편집 가능해지는 자리. 스펙 경로(프리셋·폼)에서만
// 선다. 코드 경로·내 전략의 지도는 지금까지처럼 Explain.renderFlowMap 읽기 전용이다.
const VisualEditor = isNode
  ? require('./backtest-visual-editor')
  : window.AthenaLib.BacktestVisualEditor;

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

// 지도가 첫 표면이다(사용자 확정 2026-09-03 "코드는 최후의 보루야. 대화를 하면서 코드
// 플로우 지도를 수정해 나가는거고, 그 코드 플로우 지도 뒤에 코드가 있는거야"). 그래서
// 순서가 지도 → 폼 → 코드이고, 코드 탭의 이름 자체가 그것이 마지막 수단임을 말한다.
const DESIGN_TABS = [['flow', '지도'], ['form', '폼'], ['code', '코드 · 최후의 보루']];

// 스펙의 필드가 지도의 어느 칸에서 읽히는가 — 대화가 무엇을 바꿨는지를 칸 번호로
// 말하는 축이다(보드 14-B). 여기 없는 필드(name)는 어느 칸도 아니다.
const NODE_BY_FIELD = {
  symbols: 'target', period: 'target', adjusted: 'target',
  fromDt: 'target', toDt: 'target', costs: 'target',
  params: 'params',
  indicators: 'indicators',
  entry: 'conditions', exit: 'conditions',
  risk: 'guard',
};

// 지도가 그리는 순서 — 대상 한 줄 다음에 ①~④다(mapmodel.NUMERALS와 같은 차례).
const MAP_NODE_ORDER = ['target', 'params', 'indicators', 'conditions', 'guard'];

// 실행경로 2분기(폼/코드). 코드가 있어야만 헤더에 뜬다.
const RUN_PATHS = [['form', '폼'], ['code', '코드']];

// 시각 편집기의 서버 왕복 간격 — 매 키입력마다 검증을 보내면 서버가 타자를 따라 뛴다.
const VISUAL_DEBOUNCE_MS = 400;

// 헤더의 상태 점 문구(US-007). 'unvalidated'는 여기 없다 — 아직 아무것도 묻지 않은 것은
// 상태가 아니라 상태 없음이고, 없는 상태에 점을 찍으면 화면이 사실을 지어낸다.
const VISUAL_STATUS_TEXT = {
  validating: '검증 중',
  valid: '서버 검증 가능',
  invalid: '서버 검증 실패',
  synced: '그래프·코드 검증 완료',
};

// 유효하지 않은 그래프에서 [실행]이 서는 자리 — 실행이 아니라 검토가 다음 행동이다.
const VISUAL_RUN_BLOCKED = '오류 검토';

// 코드 초안이 지도보다 앞설 때 서랍에 적히는 한 줄. 덮어쓰지 않는다는 사실을 말한다.
const VISUAL_CODE_AHEAD = '코드가 지도보다 앞섬';

// ── US-010 · 코드 전용 분기와 버전 되열기 ───────────────────────────────────
// 코드에서 한 수정이 그래프로 표현되지 않으면 화면은 자동 왕복을 가장하지 않고 두 갈래를
// 명시한다(연구 문서 §표현 불가능한 코드 수정). 아래 문구는 그 두 버튼과, 분기한 뒤의
// 지도가 무엇인지를 말한다 — 마지막 호환 snapshot이고 지금 코드와 **동기화되지 않았다**.
const CODE_ONLY_REGRAPH = '그래프에서 다시 만들기';
const CODE_ONLY_FORK = '코드 전용으로 분기';
const CODE_ONLY_BADGE = '동기화되지 않음 · 코드 전용';
// 그 분기가 남기는 버전의 메모. 서버는 origin=code_only 버전에 bundle을 허용하지 않는다
// (그래프를 같이 저장하면 동기화됐다고 표시하는 것과 같다).
const CODE_ONLY_NOTE = '코드 전용 분기';
// 이력에서 다시 연 버전의 배지 — 편집 표면이 아니다. 편집은 한 번 더 눌러야 시작된다.
const VERSION_READONLY_BADGE = '읽기 전용 · 이력에서 연 버전';
const VERSION_EDIT_LABEL = '이 버전으로 편집';

const OPTIMIZE_METHODS = [['grid', '그리드'], ['random', '랜덤']];

// getContext()가 마지막 실행에서 뽑아 채팅에 넘기는 지표 — 나머지는 말풍선에 쓸 일이 없다.
const CONTEXT_METRIC_KEYS = [
  'total_return', 'cagr', 'sharpe', 'mdd', 'win_rate', 'profit_factor',
  'buy_hold_return', 'closed_trades', 'open_positions', 'warmup_bars', 'bars', 'run_path',
];

const CONTEXT_CODE_LIMIT = 6000;
const CONTEXT_STDOUT_LIMIT = 800;

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

// 초안 카드의 "전 → 후" 값을 사람 말로 바꾼다 — diffFields가 준 원시 값이 들어온다.
function draftValueText(key, value) {
  if (key === 'symbols') return value.length ? value.join(', ') : '없음';
  if (key === 'period') return (SpecModel.PERIODS.find(([id]) => id === value) || [])[1] || String(value);
  if (key === 'adjusted') return value ? '켬' : '끔';
  if (key === 'indicators') {
    return value.length ? value.map((i) => `${i.alias}(${i.id})`).join(', ') : '없음';
  }
  if (key === 'entry' || key === 'exit') {
    if (!value.conditions.length) return '없음';
    return value.conditions
      .map((c) => {
        const opLabel = (SpecModel.OPERATORS.find((o) => o[0] === c.operator) || [])[1] || c.operator;
        return `${c.indicator} ${opLabel} ${c.compare_to}`;
      })
      .join(` ${value.logic} `);
  }
  if (key === 'risk') {
    return [['stop_loss', '손절'], ['take_profit', '익절']]
      .map(([k, label]) => `${label} ${value[k].percent}% ${value[k].enabled ? '켬' : '끔'}`)
      .join(' · ');
  }
  if (key === 'costs') {
    return [['fee_bps', '수수료'], ['tax_bps', '매도세'], ['slippage_bps', '슬리피지']]
      .map(([k, label]) => `${label} ${value[k]}bp`)
      .join(' · ');
  }
  return value === '' || value == null ? '없음' : String(value);
}

// 초안 diff를 한 줄씩 훑는다. 파라미터만은 바뀐 이름마다 한 줄이다('파라미터 fast · 20 → 10').
// 카드 행과 지도 칸 줄이 같은 순회를 쓰게 하는 자리다 — 둘이 갈라지면 채팅 카드가 말한
// 변경과 지도의 '방금 바뀜'이 서로 다른 것을 가리킨다.
function walkDraft(before, after, emit) {
  SpecModel.diffFields(before, after).forEach(({ key, label, before: a, after: b }) => {
    if (key !== 'params') {
      emit(key, label, draftValueText(key, a), draftValueText(key, b));
      return;
    }
    Object.keys(Object.assign({}, a, b)).forEach((name) => {
      if (a[name] === b[name]) return;
      emit(key, `${label} ${name}`, draftValueText(key, a[name]), draftValueText(key, b[name]));
    });
  });
}

// 초안 카드 행 [라벨, 전, 후].
function draftRows(before, after) {
  const rows = [];
  walkDraft(before, after, (key, label, a, b) => { rows.push([label, a, b]); });
  return rows;
}

// 같은 변경을 지도의 칸으로 옮긴 줄 — 채팅 카드가 "③ 사고·파는 순간 — 청산 조건: …"으로
// 적는다(보드 14-B). 어느 칸도 아닌 필드(전략 이름)는 줄이 서지 않는다.
function draftNodeRows(before, after) {
  const rows = [];
  walkDraft(before, after, (key, label, a, b) => {
    const id = NODE_BY_FIELD[key];
    if (id) rows.push({ id, text: `${label}: ${b}` });
  });
  return rows;
}

// 바뀐 필드 이름들 → 지도 칸 id(지도 순서, 중복 없음). 순수 함수 — node --test 대상.
function changedNodeIds(diffKeys) {
  const ids = [];
  (Array.isArray(diffKeys) ? diffKeys : []).forEach((key) => {
    const id = NODE_BY_FIELD[key];
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  return MAP_NODE_ORDER.filter((id) => ids.indexOf(id) !== -1);
}

// 코드 영수증의 "몇 줄" — 빈 편집기는 1줄이 아니라 0줄이다(getContext().code.lines와 같은 규칙).
function countLines(source) {
  return source ? String(source).split('\n').length : 0;
}

// 등록 이름의 기본값 — 파일 이름에서 .py를 뗀 것. 사람이 "골든크로스.py"를 만들었으면
// 목록에도 "골든크로스"로 뜨는 것이 가장 덜 놀랍다.
function fileStem(pathText) {
  const base = String(pathText == null ? '' : pathText).split('/').pop();
  return base.replace(/\.py$/i, '') || base;
}

// 설치를 요청할 수 있는 이름인가 — 백엔드 store.py `_PACKAGE_SPEC`과 같은 규칙이다.
// 화면에서 막는 것은 설명이고(왜 안 되는지를 그 자리에서 말한다), 백엔드의 422가 보장이다.
const PACKAGE_SPEC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(==[A-Za-z0-9][A-Za-z0-9._+!-]*)?$/;

function isValidPackageSpec(text) {
  return String(text).length <= 128 && PACKAGE_SPEC_RE.test(String(text));
}

// "pandas, scipy==1.14" → ['pandas', 'scipy==1.14']. 쉼표·공백·줄바꿈 아무거나 받는다.
function parsePackageList(text) {
  return String(text == null ? '' : text).split(/[\s,]+/).filter((t) => t);
}

// 등록부가 주는 파라미터는 파일의 `PARAMS` 기본값뿐이다(백엔드 flow.params_defaults) —
// 파일에는 범위가 없다. 슬라이더를 그리려면 범위가 필요해서 기본값을 기준으로 잡되,
// 지어낸 범위라는 사실은 카드에 적어 숨기지 않는다(프리셋의 min/max는 전략이 정한 값이다).
function userParamSpec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const isInt = Number.isInteger(n);
  const span = Math.abs(n) || 1;
  return {
    default: n,
    min: n < 0 ? -span * 4 : 0,
    max: n < 0 ? 0 : span * 4,
    step: isInt ? 1 : span / 100,
    type: isInt ? 'int' : 'float',
  };
}

// ---------- 캔버스 ----------

// ── 컴파일된 spec_yaml 읽기(US-007) ─────────────────────────────────────────
//
// `/visual/compile`이 돌려주는 spec_yaml은 백엔드 `yaml.safe_dump`가 쓴 **블록 스타일**
// 이다 — 프리셋 yaml의 `{...}` 한 줄 스타일이 아니다. 그래서 SpecModel.parsePresetYaml이
// 그것을 못 읽는다(실측: `params: {fast: {default: 20 ...}}` 대신 `params:` 아래 두 단계
// 들여쓰기로 온다). 여기서 다루는 것은 그 문서가 실제로 쓰는 부분집합뿐이다: 들여쓰기 맵,
// `- ` 목록, 인라인 `{}`·`[]`, 따옴표 스칼라. 완전한 YAML 파서가 아니고 될 필요도 없다 —
// 이 입력의 생산자는 우리 백엔드 하나다.

// 인라인 흐름(`{a: 1, b: [2, 3]}`)을 쉼표로 자른다. 중첩과 따옴표 안의 쉼표는 세지 않는다.
function splitFlowItems(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  const tail = body.slice(start);
  if (tail.trim()) out.push(tail);
  return out;
}

function parseYamlFlow(text) {
  const body = text.slice(1, -1);
  if (text[0] === '[') return splitFlowItems(body).map(parseYamlScalar);
  const out = {};
  splitFlowItems(body).forEach((piece) => {
    const at = piece.indexOf(':');
    if (at === -1) return;
    out[piece.slice(0, at).trim()] = parseYamlScalar(piece.slice(at + 1));
  });
  return out;
}

function parseYamlScalar(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) {
    return text.slice(1, -1);
  }
  if (text[0] === '{' || text[0] === '[') return parseYamlFlow(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseYamlBlock(text) {
  const rows = String(text == null ? '' : text).split('\n')
    .map((line) => ({ indent: line.length - line.replace(/^ +/, '').length, text: line.trim() }))
    .filter((row) => row.text && row.text[0] !== '#' && row.text !== '---');
  let i = 0;

  function parseAt(indent) {
    if (i >= rows.length || rows[i].indent < indent) return null;
    if (rows[i].text[0] === '-') {
      const list = [];
      while (i < rows.length && rows[i].indent === indent && rows[i].text[0] === '-') {
        const rest = rows[i].text.slice(1).trim();
        if (!rest) { i += 1; list.push(parseAt(indent + 2)); continue; }
        if (rest[0] === '{' || rest[0] === '[' || rest.indexOf(':') === -1) {
          i += 1;
          list.push(parseYamlScalar(rest));
          continue;
        }
        // `- key: value` — 이 항목의 나머지 키는 한 단계 안쪽 들여쓰기로 이어진다.
        rows[i] = { indent: indent + 2, text: rest };
        list.push(parseAt(indent + 2));
      }
      return list;
    }
    const map = {};
    while (i < rows.length && rows[i].indent === indent && rows[i].text[0] !== '-') {
      const row = rows[i];
      const at = row.text.indexOf(':');
      if (at === -1) { i += 1; continue; }
      const key = row.text.slice(0, at).trim();
      const rest = row.text.slice(at + 1).trim();
      i += 1;
      if (rest) { map[key] = parseYamlScalar(rest); continue; }
      const next = rows[i];
      // 목록은 safe_dump에서 부모 키와 같은 들여쓰기에 온다 — 다음 줄의 실제 들여쓰기를
      // 보고 정한다(고정 +2로 가정하면 `indicators:` 아래 목록을 통째로 놓친다).
      const deeper = next && (next.indent > indent || (next.indent === indent && next.text[0] === '-'));
      map[key] = deeper ? parseAt(next.indent) : null;
    }
    return map;
  }

  const doc = parseAt(rows.length ? rows[0].indent : 0);
  return (doc && typeof doc === 'object' && !Array.isArray(doc)) ? doc : {};
}

// 읽은 문서를 SpecModel.createSpec의 overrides로 옮긴다. 대상(종목·기간·비용)은 여기서
// 만들지 않는다 — 그래프는 그것을 모르고, 아는 쪽(폼)의 값을 지켜야 한다.
function specOverridesFromYaml(yamlText) {
  const doc = parseYamlBlock(yamlText);
  const strategy = (doc && doc.strategy) || {};
  const params = {};
  Object.keys(strategy.params || {}).forEach((name) => {
    const p = strategy.params[name] || {};
    params[name] = {
      default: Number(p.default),
      min: Number(p.min),
      max: Number(p.max),
      step: Number(p.step) || 1,
      type: p.type === 'int' ? 'int' : 'float',
    };
  });
  const group = (raw, fallbackLogic) => ({
    logic: (raw && raw.logic) || fallbackLogic,
    conditions: ((raw && raw.conditions) || []).map((c) => ({
      indicator: c.indicator, operator: c.operator, compare_to: c.compare_to,
    })),
  });
  return {
    presetId: strategy.id || null,
    name: (doc.metadata && doc.metadata.name) || null,
    params,
    indicators: (strategy.indicators || []).map((ind) => ({
      id: ind.id, alias: ind.alias, params: ind.params || {},
    })),
    entry: group(strategy.entry, 'AND'),
    exit: group(strategy.exit, 'OR'),
    risk: doc.risk || null,
  };
}

function createBacktestCanvas(options) {
  const deps = options || {};
  const container = deps.container;
  if (!container) {
    // 컨테이너가 없어도 채팅 배선(onChatAction 채널·getContext)은 그대로 부른다 —
    // 같은 모양을 돌려주지 않으면 액션 한 번에 TypeError로 죽는다.
    return {
      mount() {}, refresh() {}, getContext() { return null; },
      onChatAction() { return null; },
      undoChatAction() { return { ok: false, reason: '백테스트 화면이 없습니다' }; },
      applyFileDraft() { return Promise.resolve({ ok: false, reason: '백테스트 화면이 없습니다' }); },
      discardFileDraft() { return { ok: false, reason: '백테스트 화면이 없습니다' }; },
      runFromChat() { return []; },
      validateFromChat() { return Promise.resolve({ ok: false, errors: [] }); },
      startOptimizeFromChat() {},
      answerVisualQuestion() { return Promise.resolve(null); },
      applyVisualPatch() { return Promise.resolve(null); },
      discardVisualPatch() { return { ok: false, reason: '백테스트 화면이 없습니다' }; },
      reviewBeforeRun() { return { ok: false, reason: '백테스트 화면이 없습니다' }; },
      openCodeFromChat() { return Promise.resolve(false); },
      retryVisualPatch() { return Promise.resolve(null); },
    };
  }

  const setTimeoutImpl = deps.setTimeoutImpl
    || (typeof setTimeout !== 'undefined' ? setTimeout : null);
  const clearTimeoutImpl = deps.clearTimeoutImpl
    || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);

  let presets = [];
  // 내 폴더의 .py를 프리셋과 같은 자리에 세운 등록부(GET /backtest/user-strategies).
  // 배선이 없으면 빈 목록이고, 그때 설계 폼은 지금까지처럼 프리셋만 보여준다.
  let userStrategies = [];
  let userStrategyId = null;    // 고른 내 전략의 등록 id — 프리셋을 고르면 풀린다
  let spec = null;              // 편집 중인 전략(SpecModel)
  let codeSource = '';          // 코드 탭의 파이썬 원문
  let strategyId = null;        // 저장된 전략(코드 경로에서만 만든다)
  let activeVersionId = null;
  // 실행이 폼(yaml)을 쓰는지 코드(python)를 쓰는지. 코드가 있어야만 고를 수 있고,
  // 채팅 코드 초안을 적용하면 자동으로 'code'가 된다.
  let runPath = 'form';
  // 마지막 실행 실패 메시지 — 채팅이 getContext()로 읽어 고친 코드를 낸다.
  let lastError = null;
  // 캐시 상태를 이미 물어본 대상의 열쇠 — 같은 대상에 요청을 반복하지 않는다.
  let coverageAsked = null;
  // mapVersion — 지도가 몇 번 고쳐졌는가. 전략을 세울 때 1이고 대화가 반영할 때마다
  // 오른다. 코드 서랍의 "지도 vN과 일치"가 이 숫자로 서므로 화면·영수증·컨텍스트가
  // 같은 자리에서 읽어야 한다.
  let state = { view: 'empty', tab: 'design', designTab: 'flow', mapVersion: 0 };
  let pollTimer = null;
  // 환경 구성 잡의 폴링은 실행·수집 폴링과 별개 타이머다 — 같은 자리를 쓰면 pip이 도는
  // 동안 실행 폴링이 끊기거나 그 반대가 된다(둘은 서로를 모른다).
  let envTimer = null;
  let loadRequestId = 0;
  let mounted = false;
  let editorHandle = null;
  // 프로젝트 IDE는 한 번 만들어 계속 들고 있다 — render()가 매번 DOM을 새로 만들어도
  // 열린 탭·저장 안 한 버퍼가 살아남아야 한다.
  let projectIde = null;
  // 지금 프로젝트의 .py 목록 — 화면에는 안 쓰고 다음 턴 컨텍스트에만 실린다. 모델이
  // 폴더 안을 모르면 없는 경로를 지어내 propose_file을 낸다.
  let projectFiles = [];
  // 폼 경로에서 [코드 열기]가 만든 코드 — 같은 폼이면 다시 만들지 않는다(§7.3: 생성은
  // 저장이 아니다. 이 캐시는 화면 것이고 백엔드에는 아무것도 남지 않는다).
  let codegenCache = null;
  // ── 시각 설계 상태(US-007/008/009) ────────────────────────────────────────
  // 편집기는 한 번 만들어 계속 들고 있다 — render()가 매번 DOM을 새로 만들어도 되돌리기
  // 이력·선택·연결 중인 포트가 살아남아야 한다(projectIde와 같은 이유).
  let visualEditor = null;
  let visualHost = null;
  let visualRegistry = null;
  let visualRegistryAsked = false;
  let visualGraph = null;
  // 이 그래프가 어느 폼 yaml에서 나왔는가 — 폼 → 그래프 왕복의 열쇠이자 루프 차단기다.
  let visualGraphYaml = null;
  // 라우트가 없는 백엔드를 한 번 만나면 다시 묻지 않는다 — 지도는 읽기 전용으로 물러난다.
  let visualUnavailable = false;
  let visualDiagnostics = [];
  let visualState = 'unvalidated';
  let visualSummary = '';
  let visualHashes = null;
  let visualCompiled = null;   // {spec_yaml, source, source_map, hashes}
  let visualPreview = null;    // {source, source_map} — 검증 실패 때의 미실행 미리보기
  let visualTimer = null;
  // 그래프 → 폼 갱신 중이라는 깃발. 이것이 없으면 폼이 바뀐 것을 보고 다시 그래프를 만든다.
  let visualSyncing = false;
  // 마지막으로 화면에 얹은 생성 코드 — 사람이 손으로 고친 초안과 구분하는 유일한 축이다.
  let lastGeneratedSource = '';
  let pendingQuestion = null;
  let pendingPatch = null;
  // ── 코드 전용 분기·버전 되열기(US-010) ────────────────────────────────────
  // 코드가 정본이 된 전략. 지도 탭은 마지막 호환 그래프 snapshot을 읽기 전용으로만
  // 그리고, 어디에서도 '동기화됨'을 말하지 않는다(그것이 이 분기의 전부다).
  let codeOnly = false;
  let codeOnlyGraph = null;
  // 이력에서 다시 연 버전 — 읽기 전용이다. [이 버전으로 편집]이 작업 초안으로 옮긴다.
  let openedVersion = null;
  // 읽기 전용 snapshot 전용 편집기. 편집용 편집기와 나누는 이유 둘: readOnly는 생성
  // 옵션이라 나중에 못 바꾸고, 같은 인스턴스를 재활용하면 되돌리기 이력이 snapshot과
  // 지금 초안 사이에서 섞인다.
  let snapshotEditor = null;
  let snapshotHost = null;
  let snapshotShown = null;
  // 서버가 본 최신 머리 — 409로 돌아온 자리에서 [다시 검토]가 다시 읽어 갈아 끼운다.
  let visualBase = null;

  function setState(patch) {
    state = Object.assign({}, state, patch);
    render();
    // 탭·하위 탭이 움직인 것은 사람이 보던 자리가 바뀐 것이다 — 세션 복원이 그 자리를
    // 돌려주려면 그때마다 조각으로 보고해야 한다(병합·저장 시점은 main이 정한다).
    if (patch && (patch.tab !== undefined || patch.designTab !== undefined)) reportWorkspace();
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
    // 전략이 서면 지도가 첫 화면이다 — 사람이 먼저 보는 것은 폼 칸이 아니라 흐름이다.
    setState({ view: 'design', tab: 'design', designTab: 'flow', mapVersion: spec ? 1 : 0 });
    if (spec) void loadMap();
    // 등록부는 부수 정보다 — 못 읽었다고 프리셋 화면까지 실패로 만들지 않는다.
    await loadUserStrategies();
  }

  // 내 전략 목록. exists·params는 저장된 값이 아니라 백엔드가 지금 디스크를 본 결과다
  // (D2 — 파일이 진실이다). 그래서 등록해두고 파일을 지우면 목록이 그 사실을 말한다.
  async function loadUserStrategies() {
    if (!deps.userStrategies) return;
    let list;
    try { list = await deps.userStrategies(); }
    catch { return; }
    userStrategies = Array.isArray(list) ? list : [];
    render();
  }

  // 캐시 상태(몇 봉이 어디까지 있는가)는 대상 하나에 붙는 사실이다 — 종목·주기·수정주가가
  // 바뀌면 앞 대상의 숫자를 그대로 보여주면 안 되므로 열쇠를 같이 들고 다니고, 열쇠가
  // 어긋나면 화면도 프롬프트도 "모름"으로 돌아간다(틀린 숫자보다 모름이 낫다).
  function coverageKey() {
    if (!spec || spec.symbols.length !== 1) return null;
    return `${spec.symbols[0]}|${spec.period}|${spec.adjusted ? '1' : '0'}`;
  }

  function currentCoverage() {
    const key = coverageKey();
    if (!key || !state.coverage || state.coverage.key !== key) return null;
    return state.coverage.value;
  }

  async function loadCoverage() {
    const key = coverageKey();
    if (!deps.coverage || !key) return;
    let data;
    try {
      data = await deps.coverage({
        stk_cd: spec.symbols[0], period: spec.period, adjusted: spec.adjusted,
      });
    } catch { return; }  // 부수 정보다 — 못 읽었다고 화면을 실패로 만들지 않는다
    if (!data) return;
    setState({
      coverage: {
        key,
        value: { rows: data.rows, first_dt: data.first_dt, last_dt: data.last_dt },
      },
    });
  }

  // 전략을 바꿔도 유지하는 것 — 같은 대상에 다른 전략을 걸어보는 것이 이 화면에서 가장
  // 잦은 동작이고, 매번 다시 입력하게 하면 그 흐름이 끊긴다.
  function keptTarget() {
    return spec
      ? { symbols: spec.symbols, fromDt: spec.fromDt, toDt: spec.toDt, period: spec.period }
      : {};
  }

  function selectPreset(id) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    spec = Object.assign(SpecModel.presetToSpec(preset), keptTarget());
    // 프리셋을 고르는 것은 새 전략을 세우는 것이다 — 앞 전략의 코드를 남기면 화면은
    // 프리셋인데 도는 것은 그 파이썬이고, 서랍의 "이 지도 뒤의 코드"도 남의 코드를
    // 가리킨다. 코드는 지도 뒤에 있으므로 지도가 새로 서면 그 뒤도 비워야 한다
    // ([지도로 되돌리기]가 하는 일과 같다).
    runPath = 'form';
    codeSource = '';
    userStrategyId = null;
    // 새 전략은 새 지도다 — 앞 전략에서 세던 버전을 이어 세면 "지도 v7"이 무엇을 센
    // 숫자인지 아무도 모르게 된다.
    setState({
      formErrors: [], codeErrors: [], codeFromMap: false, designTab: 'flow', mapVersion: 1,
      codeSpan: null, visualCodeAhead: false,
    });
    void loadMap();
  }

  // 내 전략을 고르는 것은 프리셋을 고르는 것과 같은 동작이어야 한다 — 다른 점은 신호를
  // 만드는 것이 지표·조건이 아니라 그 파일의 파이썬이라는 것뿐이다. 그래서 여기서는
  // ① 폴더와 파일을 IDE로 실제로 열고(실행이 읽을 원문이 그 파일이다, D2)
  // ② 실행경로를 코드로 돌리고 ③ 등록부가 준 PARAMS 기본값을 슬라이더로 세운다.
  async function selectUserStrategy(id) {
    const entry = userStrategies.find((s) => s.id === id);
    if (!entry) return;
    const ide = ensureProjectIde();
    if (!ide) {
      setState({ formErrors: ['이 화면에는 프로젝트 배선이 없어 내 전략을 열 수 없습니다'] });
      return;
    }
    const params = {};
    Object.keys(entry.params || {}).forEach((name) => {
      const p = userParamSpec(entry.params[name]);
      if (p) params[name] = p;
    });
    spec = Object.assign(
      SpecModel.createSpec(null, { name: entry.name, params }), keptTarget(),
    );
    userStrategyId = entry.id;
    runPath = 'code';
    setState({
      formErrors: [], codeErrors: [], designTab: 'flow', mapVersion: 1, codeSpan: null,
    });
    const opened = await ide.openAt(entry.project_id, entry.path);
    // 못 열었으면 이유는 IDE가 자기 자리에 적었다 — 폼에도 한 줄 남긴다. 폼만 보고 있는
    // 사람에게는 코드 탭의 문장이 보이지 않는다.
    if (!opened) setState({ formErrors: [`${entry.path}를 열지 못했습니다 — 코드 탭을 보세요`] });
    else render();
    // 파일을 연 뒤에 지도를 만든다 — 지도의 원문이 그 파일이다.
    void loadMap();
  }

  function currentYaml() {
    return SpecModel.toYaml(spec);
  }

  // 프로젝트 IDE는 배선이 있을 때만 만든다 — deps에 프로젝트 채널이 없으면(옛 배선·
  // 단위 테스트) 코드 탭은 지금까지처럼 단일 버퍼 편집기 하나로 돈다. 새 기능이 옛
  // 화면을 끄지 않게 하는 유일한 장치다.
  function ensureProjectIde() {
    if (projectIde) return projectIde;
    if (!deps.listProjects) return null;
    projectIde = ProjectIde.createProjectIde({
      deps: {
        listProjects: deps.listProjects,
        createProject: deps.createProject,
        openDialog: deps.openProjectDialog,
        openProject: deps.openProject,
        tree: deps.projectTree,
        readFile: deps.readProjectFile,
        writeFile: deps.writeProjectFile,
        createFile: deps.createProjectFile,
        renameFile: deps.renameProjectFile,
        deleteFile: deps.deleteProjectFile,
        // 프로젝트가 정해지면 코드 탭의 구성이 바뀐다 — 캔버스를 다시 그린다.
        // 폴더가 바뀌면 앞 폴더의 파일 목록·파일 초안은 더 이상 이 화면의 것이 아니다.
        onProjectChange: (project) => {
          projectFiles = [];
          if (project) void loadProjectFiles(project.id);
          // 앞 폴더의 환경 잡도 여기서 끊는다 — 안 끊으면 대기 중인 틱이 앞 폴더의
          // 진행 줄을 이 폴더의 패널에 적고, 끝나면 앞 폴더의 venv를 이 폴더의
          // "준비됨 · N개 패키지"로 읽는다.
          if (envTimer != null && clearTimeoutImpl) clearTimeoutImpl(envTimer);
          envTimer = null;
          setState({
            fileDraft: null, env: null, envError: null, envProgress: null, envJobId: null,
          });
          if (project) void loadProjectEnv(project.id);
        },
      },
    });
    projectIde.mount();
    return projectIde;
  }

  // 컨텍스트에 실을 .py 경로 — 트리를 한 번 더 읽는다(IDE는 자기 트리를 내주지 않는다).
  // 못 읽으면 조용히 빈 목록이다. 부수 정보라 화면을 실패로 만들지 않는다.
  async function loadProjectFiles(projectId) {
    if (!deps.projectTree || !projectId) { projectFiles = []; return; }
    let res;
    try { res = await deps.projectTree(projectId); } catch { projectFiles = []; return; }
    const out = [];
    const walk = (list) => {
      (Array.isArray(list) ? list : []).forEach((entry) => {
        if (!entry) return;
        if (entry.is_dir) walk(entry.children);
        else if (entry.py) out.push(entry.path);
      });
    };
    walk(res && res.entries);
    projectFiles = out;
  }

  // 프로젝트에서 실행할 때의 원문 — 디스크의 그 파일이다(D2). 열린 파일이 없으면
  // null을 돌려주고, 그때는 지금까지의 단일 버퍼(codeSource)가 그대로 쓰인다.
  function activeProjectFile() {
    return projectIde ? projectIde.activeFile() : null;
  }

  // 실행 직전 그 파일의 디스크 내용. 못 읽으면 편집기 버퍼로 물러난다 — 못 읽었다고
  // 실행을 막지는 않는다(백엔드가 어차피 소스를 검증한다).
  async function projectFileText(activeFile) {
    const project = projectIde ? projectIde.currentProject() : null;
    if (!project || !deps.readProjectFile) return activeFile.text;
    try {
      const res = await deps.readProjectFile(project.id, activeFile.path);
      return res && typeof res.text === 'string' ? res.text : activeFile.text;
    } catch { return activeFile.text; }
  }

  // ---------- 프로젝트 가상환경(폴더 안의 .venv 하나) ----------
  //
  // 환경을 만드는 것은 돈도 할당량도 지나지 않는 준비 작업이다(WAVE-3 계약) — 그래도
  // 버튼은 사람이 누른다. 여기서 사람 손이 필요한 이유는 승인이 아니라 시간이다: pip이
  // 수십 초를 쓰고 그 동안 이 폴더의 실행이 무엇을 쓸 수 있는지가 바뀐다.

  async function loadProjectEnv(projectId) {
    if (!deps.projectEnv || !projectId) return;
    try { setState({ env: await deps.projectEnv(projectId), envError: null }); }
    catch (err) { setState({ env: null, envError: String((err && err.message) || err) }); }
  }

  async function startProjectEnv() {
    const project = projectIde ? projectIde.currentProject() : null;
    if (!project || !deps.createProjectEnv) return;
    const packages = parsePackageList(state.envPackages);
    const bad = packages.filter((name) => !isValidPackageSpec(name));
    if (bad.length) {
      setState({ envError: `설치할 수 있는 이름이 아닙니다: ${bad.join(', ')} (예: pandas, pandas==2.2.3)` });
      return;
    }
    setState({ envError: null, envProgress: '환경을 만드는 중입니다…' });
    let res;
    try { res = await deps.createProjectEnv(project.id, packages); }
    catch (err) {
      setState({ envProgress: null, envError: String((err && err.message) || err) });
      return;
    }
    const jobId = res && res.job_id;
    if (!jobId) { setState({ envProgress: null, envError: 'job_id를 받지 못했습니다' }); return; }
    setState({ envJobId: jobId });
    pollEnvJob(project.id);
  }

  // 진행은 기존 잡 라우트를 그대로 쓴다(deps.status = athena:backtest-status) — 잡 표면을
  // 둘로 만들지 않는다. 끝나면 상태를 다시 읽어 "몇 개 패키지"가 실제 디스크와 맞게 한다.
  function pollEnvJob(projectId) {
    if (envTimer != null && clearTimeoutImpl) clearTimeoutImpl(envTimer);
    envTimer = null;
    const tick = async () => {
      envTimer = null;
      if (!isVisible()) return;
      let job;
      try { job = deps.status ? await deps.status({ job_id: state.envJobId }) : null; }
      catch (err) {
        setState({ envProgress: null, envJobId: null, envError: String((err && err.message) || err) });
        return;
      }
      if (!isVisible()) return;
      if (job && job.status === 'done') {
        setState({ envProgress: null, envJobId: null });
        await loadProjectEnv(projectId);
        return;
      }
      if (job && (job.status === 'failed' || job.status === 'cancelled')) {
        setState({
          envProgress: null, envJobId: null, envError: job.error || '환경 구성에 실패했습니다',
        });
        return;
      }
      const progress = job && job.progress;
      setState({
        envProgress: progress
          ? `${progress.step} · ${progress.line || ''}`.trim()
          : '환경을 만드는 중입니다…',
      });
      if (setTimeoutImpl) envTimer = setTimeoutImpl(tick, POLL_INTERVAL_MS);
    };
    tick();
  }

  // ---------- 내 전략 등록(사람이 누른다) ----------

  async function registerActiveStrategy() {
    const project = projectIde ? projectIde.currentProject() : null;
    const active = activeProjectFile();
    if (!project || !deps.registerUserStrategy) return;
    if (!active) {
      setState({ codeErrors: ['등록할 파일을 먼저 여세요 — 왼쪽에서 .py를 고릅니다'] });
      return;
    }
    // 저장 안 한 편집으로 등록하면 등록부가 가리키는 파일과 화면의 코드가 갈라진다
    // (실행이 저장을 요구하는 것과 같은 이유 — 진실은 디스크에 있다).
    if (active.dirty) {
      setState({ codeErrors: ['저장하고 등록하세요 — 저장하지 않은 편집이 있습니다'] });
      return;
    }
    try {
      await deps.registerUserStrategy({
        project_id: project.id, path: active.path, name: fileStem(active.path),
      });
      setState({ codeErrors: [] });
    } catch (err) {
      setState({ codeErrors: [String((err && err.message) || err)] });
      return;
    }
    await loadUserStrategies();
  }

  // 등록만 지운다 — 파일은 사용자 폴더의 것이라 우리가 지울 물건이 아니다(백엔드도 그렇다).
  async function unregisterUserStrategy(id) {
    if (!deps.unregisterUserStrategy) return;
    try { await deps.unregisterUserStrategy(id); }
    catch (err) { setState({ formErrors: [String((err && err.message) || err)] }); return; }
    if (userStrategyId === id) userStrategyId = null;
    await loadUserStrategies();
  }

  // 코드 경로는 폼의 진입·청산 조건을 검사하지 않는다 — 신호는 파이썬이 만든다.
  function runErrors() {
    const codeRuns = runPath === 'code' || !!activeProjectFile();
    return SpecModel.validate(spec, { conditions: !codeRuns });
  }

  async function handleRun(allowPartial) {
    // 저장 안 한 편집으로 실행하면 화면의 코드와 도는 코드가 갈라진다 — 디스크가
    // 진실이라는 결정(D2)이 여기서 지켜진다.
    if (projectIde && projectIde.isDirty()) {
      setState({
        designTab: 'code',
        codeErrors: ['저장하고 실행하세요 — 저장하지 않은 편집이 있습니다'],
      });
      return;
    }
    const errors = runErrors();
    if (errors.length) { setState({ formErrors: errors }); return; }
    setState({ formErrors: [] });
    await startRun(allowPartial);
  }

  // 지금 연 파일이 고른 내 전략의 그 파일인가 — 슬라이더 값을 실을지 가르는 기준이다.
  // 프리셋으로 건너가면 selectPreset이 풀지만, 트리에서 다른 .py를 고르는 길은 캔버스를
  // 거치지 않아 userStrategyId가 그대로 남는다. 그래서 실을 때마다 다시 맞춰 본다.
  function runsPickedStrategy(activeFile) {
    if (!userStrategyId || !activeFile) return false;
    const entry = userStrategies.find((s) => s.id === userStrategyId);
    if (!entry) return false;
    const project = projectIde ? projectIde.currentProject() : null;
    return !!project && project.id === entry.project_id && activeFile.path === entry.path;
  }

  async function startRun(allowPartial) {
    setState({ view: 'running', progressText: '백테스트를 실행하는 중입니다…' });
    let res;
    let codeRun = false;
    try {
      const body = { yaml: currentYaml() };
      if (allowPartial) body.allow_partial = true;
      // 코드 경로일 때만 파이썬을 싣는다 — 백엔드는 source가 있으면 코드로, 없으면 폼으로 돈다.
      // 프로젝트에서 연 파일이 있으면 그 파일이 이긴다(D2: 진실은 디스크에 있다).
      // 편집기 버퍼가 아니라 디스크를 다시 읽는 이유: 채팅이 방금 쓴 파일이 열려 있으면
      // 버퍼에는 아직 옛 내용이 남아 있다(IDE에 다시 읽는 길이 없다). 저장 안 한 편집은
      // 위 handleRun이 이미 막았으므로, 여기서 디스크를 읽어도 사람이 친 것은 안 사라진다.
      const activeFile = activeProjectFile();
      if (activeFile) {
        body.source = await projectFileText(activeFile);
        // 어느 폴더의 코드인가 — 백엔드가 그 폴더의 가상환경으로 돌린다. 안 실으면
        // 사용자가 자기 폴더에 깐 패키지를 코드가 import하지 못한다.
        const project = projectIde ? projectIde.currentProject() : null;
        if (project) body.project_id = project.id;
      } else if (runPath === 'code' && codeSource.trim()) body.source = codeSource;
      codeRun = !!body.source;
      // 내 전략의 슬라이더는 실제로 값을 바꿔야 한다 — 백엔드는 파일의 PARAMS 기본값이
      // 폼 yaml의 값을 덮으므로(runner.py `_run_code_signals`), 슬라이더 값은 그것보다
      // 센 자리인 params(override)로 실어야 화면과 실행이 같은 숫자를 쓴다. 단 지금 도는
      // 파일이 그 전략의 파일일 때만이다 — 트리에서 다른 .py를 고르면 실행은 그 파일인데
      // 슬라이더는 앞 전략의 것이라, 그대로 실으면 남의 숫자가 그 파일 위에 얹힌다.
      if (runsPickedStrategy(activeFile) && spec && Object.keys(spec.params).length) {
        const overrides = {};
        Object.keys(spec.params).forEach((name) => { overrides[name] = spec.params[name].default; });
        body.params = overrides;
      }
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
    // 백엔드는 매 실행마다 전략+버전 한 쌍을 남긴다(재현성의 축) — 그 id를 받아두면
    // 파일로 한 번 돌린 뒤 [이 코드로 저장]을 거치지 않고도 배포 탭이 열린다. 추측하면
    // 다른 행을 배포하게 되므로 백엔드가 준 값일 때만 갈아 끼운다.
    //
    // **코드로 돈 실행일 때만이다.** 폼 실행이 만든 전략은 kind="yaml"이라(api/backtest.py),
    // 거기에 [이 코드로 저장]이 파이썬 버전을 얹으면 배포는 받아주고 평가는 422로 죽는
    // 막다른 길이 된다 — 그 길을 없앤 결정을 여기서 되살리지 않는다.
    if (codeRun) {
      if (res.strategy_id) strategyId = res.strategy_id;
      if (res.version_id) activeVersionId = res.version_id;
    }
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
        lastError = null;
        setState({
          view: 'result', tab: 'result',
          result: data, trades: Array.isArray(trades) ? trades : [],
        });
        // 칸 오른쪽의 사실은 **이 실행**이 만든 값이다 — 다시 만들지 않으면 지도는 앞
        // 실행의 숫자를, 고쳐서 성공한 뒤에도 앞 실행의 빨간 칸을 계속 말한다.
        void loadMap();
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
    lastError = message;
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
    // 멈춘 사실이 칸에 붙는 자리는 여기뿐이다(보드 12) — 진단이 선 다음 지도를 다시
    // 만들어야 runErrorForMap()이 실린 요청이 나가고, 그래야 진단 제목이 "② …"로
    // 시작한다. 안 하면 그 함수는 아무도 부르지 않는 코드가 된다.
    void loadMap();
  }

  // 사람이 [적용]을 눌렀을 때만 불린다(§7.3 — 모델이 코드를 바꿔놓는 경로를 만들지 않는다).
  async function applyFix(newSource, alsoRun) {
    codeSource = newSource;
    // 고친 코드로 다시 돌린다 — 실행경로가 폼에 있으면 적용한 코드가 아니라 폼이 돈다.
    runPath = 'code';
    if (strategyId && deps.addVersion) {
      try {
        const created = await deps.addVersion(strategyId, { source: newSource, origin: 'human' });
        if (created && created.version_id) activeVersionId = created.version_id;
      } catch (err) { fail(err); return; }
    }
    if (alsoRun) { await startRun(false); return; }
    setState({ view: 'design', tab: 'design', designTab: 'code' });
  }

  // 코드 탭 [검증]과 채팅 카드 [검증]이 같은 자리를 쓴다 — 카드가 결과를 그 자리에
  // 적어야 하므로 화면 갱신과 함께 판정을 돌려준다.
  async function validateCode() {
    if (!deps.validate) return { ok: false, errors: [] };
    try {
      const res = await deps.validate({ kind: 'python', source: codeSource });
      const errors = res && res.ok ? [] : ((res && res.errors) || []).map((e) => e.message);
      setState({ codeErrors: errors });
      return { ok: !!(res && res.ok), errors };
    } catch (err) {
      fail(err);
      return { ok: false, errors: [String((err && err.message) || err)] };
    }
  }

  // 흐름 지도가 읽는 원문은 "지금 보고 있는 코드"다 — 프로젝트 파일을 열었으면 그 버퍼,
  // 아니면 단일 편집기. 실행이 디스크를 다시 읽는 것과 다른 이유: 지도는 사람이 지금
  // 화면에서 읽고 있는 코드를 설명해야 하고, 그것은 저장 전 편집분까지 포함한다.
  function currentSource() {
    const active = activeProjectFile();
    return (active && active.text) || codeSource;
  }

  // 지도가 무엇을 두고 그려지는가 — 폼이면 지금 폼, 코드면 지금 보고 있는 코드다.
  // 두 경로가 같은 라우트로 가는 것이 지도가 첫 표면인 이유다(mapmodel.py 머리말).
  function mapRequest() {
    const body = { version: state.mapVersion };
    const source = currentSource();
    if ((runPath === 'code' || activeProjectFile()) && source) body.source = source;
    else if (spec) body.yaml = currentYaml();
    else return null;
    // 칸 오른쪽의 사실은 지도가 계산한 값이 아니라 그 실행이 실제로 만든 값이다.
    if (state.runId) body.run_id = state.runId;
    const error = runErrorForMap();
    if (error) body.error = error;
    return body;
  }

  // 실행이 멈췄으면 그 사실을 칸에 붙인다(보드 12) — 붙일 칸을 못 찾으면 백엔드가 붙이지
  // 않고 문구만 돌려준다. 줄 번호는 코드 경로에서만 뜻이 있어 있을 때만 싣는다.
  function runErrorForMap() {
    if (!lastError || !state.diagnosis || !state.diagnosis.title) return null;
    const out = { message: state.diagnosis.title };
    if (state.diagnosis.line != null) out.lineno = state.diagnosis.line;
    return out;
  }

  // 지도는 백엔드 왕복이라 즉시 뜨지 않는다. 그 사이를 빈 화면으로 두면 사용자는 기능이
  // 죽은 줄 안다(사용자 지시 2026-09-02 "로딩 표시") — 그래서 진행 중임을 그린다.
  // 실패도 화면 전체를 오류로 바꾸지 않고 그 자리에 적는다: 지도를 못 그린 것이지
  // 백테스트가 망가진 것이 아니다.
  async function loadMap() {
    const body = deps.map ? mapRequest() : null;
    if (!body) {
      setState({ map: null, mapLoading: false, mapError: null });
      return;
    }
    setState({ mapLoading: true, mapError: null });
    try { setState({ map: await deps.map(body), mapLoading: false }); }
    catch (err) {
      // 앞 지도는 버린다 — 못 그린 자리에 앞 전략의 지도가 그대로 서 있으면 칸도,
      // 서랍의 "지도 vN과 일치"도 전부 남의 전략을 말한다(2026-09-03 실측: 종목을
      // 아직 안 채운 폼이 422를 받는 동안 앞 코드 경로의 지도가 계속 서 있었다).
      setState({ map: null, mapLoading: false, mapError: String((err && err.message) || err) });
    }
  }

  async function loadHistory() {
    setState({ view: 'history', tab: 'history' });
    await loadVersions();
    if (!deps.runs) return;
    try { setState({ runs: await deps.runs() }); }
    catch (err) { fail(err); }
  }

  // 실행(run)과 버전(version)은 다른 축이다 — 되열기가 버전에만 있는 이유는 그래프·
  // spec_yaml·해시가 버전에 붙어 있고 실행에는 없기 때문이다(US-010). 못 읽으면 빈
  // 목록이다: 부수 정보라 실행 이력까지 실패로 만들지 않는다.
  async function loadVersions() {
    if (!deps.versions || !strategyId) return;
    try { setState({ versions: await deps.versions(strategyId) }); }
    catch { setState({ versions: [] }); }
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
    // 환경 잡은 실행과 무관하게 돈다 — 모드를 나갔다 와도 진행 줄이 다시 흐른다.
    const project = projectIde ? projectIde.currentProject() : null;
    if (envTimer == null && state.envJobId && project) pollEnvJob(project.id);
    if (pollTimer != null) return;
    if (state.view !== 'running') return;
    if (state.jobId && !state.runId) pollJob();
    else if (state.runId) pollRun();
  }

  // ---------- 채팅 액션(설정 · 코드 · 파일 · 화면 전환 · 최적화) ----------
  //
  // main.js가 'athena:backtest-chat-action' 하나로 다섯 종류를 보낸다. 설정·코드는 검증을
  // 통과하면 화면에 바로 들어간다(사용자 결정 2026-09-02 "바로 반영 + 채팅에 변경 내역·
  // 되돌리기") — 무엇이 바뀌었는지와 [되돌리기]는 캔버스가 아니라 채팅 카드가 맡는다.
  // 실행·수집·저장·활성화·배포는 그대로 사람이 버튼을 눌러야 한다. 바뀐 것은 폼에
  // 들어가는 경로 하나뿐이다.
  //
  // 검증에 걸리는 값(빈 종목·날짜 등)이 있어도 설정은 반영한다 — 사람이 폼에서 프리셋을
  // 고를 때 종목이 비어 있어도 바뀌는 것과 같은 규칙이다(2026-09-02 실측: "이평이격으로
  // 바꿔줘"가 종목 미입력 검증에 막혀 화면이 안 바뀌었다). 오류는 실행 전 확인 사항으로
  // 폼 오류 줄·채팅 카드·다음 턴 컨텍스트(pending)에 남는다. 반영을 막는 것은 얹을
  // 스펙이 없거나 모르는 프리셋뿐이다.

  const UNDO_LIMIT = 20;
  const undoStack = [];   // {id, kind, before} — 반영 직전의 상태 스냅샷
  let changeSeq = 0;
  let lastChange = null;  // 마지막 영수증 요약 — getContext()가 채팅·프로브에 넘긴다

  function isBusyView() {
    return state.view === 'running' || state.view === 'approval';
  }

  // patch.preset이 아는 프리셋이면 selectPreset과 같은 규칙(종목·기간 유지)으로 템플릿을
  // 먼저 바꾸고, 나머지 키를 그 위에 얹는다. 얹을 스펙이 없으면(프리셋 미로드) null이다.
  function mergePatch(patch) {
    const preset = presets.find((p) => p.id === patch.preset);
    let base = spec;
    if (preset) {
      const kept = spec
        ? { symbols: spec.symbols, fromDt: spec.fromDt, toDt: spec.toDt, period: spec.period }
        : {};
      base = Object.assign(SpecModel.presetToSpec(preset), kept);
    }
    return base ? SpecModel.applyPatch(base, patch) : null;
  }

  // 반영을 막는 것만 돌려준다 — 얹을 스펙이 없거나 모르는 프리셋. 검증 오류는 막지 않는다.
  function mergeBlockers(patch, merged) {
    if (!merged) return ['프리셋이 없어 설정을 얹을 수 없습니다'];
    // 모르는 프리셋 id는 mergePatch가 조용히 흘려보내 "아무것도 안 바뀐 반영"이 된다 —
    // 사람에게도 모델에게도 알리고 반영을 막는다.
    const wanted = patch.preset;
    if (typeof wanted === 'string' && !presets.some((p) => p.id === wanted)) {
      return [`${wanted}는 없는 프리셋입니다`];
    }
    return [];
  }

  function specRows(before, after) {
    if (!before || !after) return [];
    return draftRows(before, after).map(([label, a, b]) => ({ label, before: a, after: b }));
  }

  function codeRow(before, after) {
    const stats = CodeEditor.diffStats(CodeEditor.diffLines(before, after));
    return {
      label: '코드',
      before: `${countLines(before)}줄`,
      after: `${countLines(after)}줄 · +${stats.added} −${stats.removed}`,
    };
  }

  function makeReceipt(kind, extra) {
    return Object.assign({
      id: `bc-${(changeSeq += 1)}`,
      kind,
      applied: false,
      note: null,
      rows: [],
      // 같은 변경을 지도의 칸으로 옮긴 줄과, 그 반영으로 지도가 몇 판이 됐는가(보드 14-B).
      nodes: [],
      version: null,
      errors: [],
      suggest_run: false,
      suggest_validate: false,
      tab: null,
      designTab: null,
      method: null,
      canUndo: false,
      // 파일 초안만 쓴다 — 아직 디스크에 안 쓴 초안이 서 있다는 뜻이다(채팅의 [적용]).
      canApply: false,
    }, extra || {});
  }

  // 채팅·프로브가 getContext()로 읽는 요약 — 영수증 전체를 싣지 않는다(컨텍스트가 두 배가 된다).
  // nodes는 방금 바뀐 칸의 id다: 지도의 '방금 바뀜'과 다음 턴 컨텍스트가 같은 값을 쓴다.
  function remember(receipt, nodes) {
    lastChange = {
      id: receipt.id,
      kind: receipt.kind,
      applied: receipt.applied,
      rows: receipt.rows,
      nodes: Array.isArray(nodes) ? nodes : [],
      errors: receipt.errors,
    };
    return receipt;
  }

  // 영수증의 칸 줄 — 번호·제목은 마지막으로 받아온 지도가 준 것만 쓴다. 화면이 칸 이름을
  // 지어내면 채팅 카드가 말하는 칸과 지도의 칸이 갈라진다.
  function receiptNodes(nodeRows) {
    const known = (state.map && state.map.nodes) || [];
    const out = [];
    known.forEach((node) => {
      const texts = nodeRows.filter((row) => row.id === node.id).map((row) => row.text);
      if (texts.length) {
        out.push({ numeral: node.numeral, title: node.title, text: texts.join(' · ') });
      }
    });
    return out;
  }

  // 반영 한 번이 지도 한 판이다 — 되돌리기도 한 판이다(돌아간 지도도 새 지도다).
  function bumpMapVersion() {
    const from = state.mapVersion || 0;
    return { from, to: from + 1 };
  }

  function busyReceipt(kind, note) {
    return remember(makeReceipt(kind, {
      note, errors: ['실행 중에는 바꿀 수 없습니다'],
    }));
  }

  function snapshot() {
    return {
      spec: spec ? JSON.parse(JSON.stringify(spec)) : null,
      codeSource,
      runPath,
      tab: state.tab,
      designTab: state.designTab,
    };
  }

  function pushUndo(id, kind, before) {
    undoStack.push({ id, kind, before });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function onChatAction(action) {
    if (!action || typeof action !== 'object') return null;
    if (action.kind === 'spec_draft') return applySpecAction(action);
    if (action.kind === 'code_draft') return applyCodeAction(action);
    // 파일만 비동기다 — diff의 왼쪽(지금 파일)을 디스크에서 읽어야 하기 때문이다.
    if (action.kind === 'file_draft') return applyFileAction(action);
    if (action.kind === 'navigate') return navigateAction(action);
    if (action.kind === 'optimize_request') return optimizeAction(action);
    // 시각 설계 2종(US-009) — 화면을 바꾸지 않는다. 대기 상태로 세워두고 카드만 만든다.
    if (action.kind === 'visual_question') return visualQuestionAction(action);
    if (action.kind === 'visual_patch') return visualPatchAction(action);
    return null;
  }

  function envelopeNote(envelope) {
    return typeof envelope.note === 'string' && envelope.note ? envelope.note : null;
  }

  function applySpecAction(envelope) {
    const patch = envelope.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
    const note = envelopeNote(envelope);
    const suggestRun = envelope.suggest_run === true;
    if (isBusyView()) return busyReceipt('spec_draft', note);

    const base = spec || SpecModel.createSpec(null);
    const merged = mergePatch(patch);
    const blockers = mergeBlockers(patch, merged);
    const rows = merged ? specRows(base, merged) : [];
    if (blockers.length) {
      return remember(makeReceipt('spec_draft', {
        note, rows, errors: blockers, suggest_run: suggestRun,
      }));
    }

    // 무엇이 지도의 어느 칸에서 바뀌는가 — 카드도 지도도 이 한 번의 diff에서 나온다.
    const nodeRows = draftNodeRows(base, merged);
    const changed = changedNodeIds(SpecModel.diffFields(base, merged).map((f) => f.key));
    const nodes = receiptNodes(nodeRows);
    const version = bumpMapVersion();

    // 검증 오류가 있어도 반영한다 — 오류는 폼 오류 줄과 영수증 errors("실행 전에 채울 것")로
    // 남고, 모델은 다음 턴 컨텍스트의 pending에서 같은 목록을 읽어 마저 채운다.
    const pending = SpecModel.validate(merged);
    const before = snapshot();
    spec = merged;
    // 반영된 결과를 보는 자리는 지도다 — 대화가 고치는 것이 폼 칸이 아니라 흐름이라는
    // 규칙이 여기서 화면으로 지켜진다.
    setState({
      draft: null, formErrors: pending, view: 'design', tab: 'design', designTab: 'flow',
      mapVersion: version.to,
    });
    const receipt = remember(makeReceipt('spec_draft', {
      applied: true, note, rows, nodes, version, errors: pending, suggest_run: suggestRun,
      tab: state.tab, designTab: state.designTab, canUndo: true,
    }), changed);
    pushUndo(receipt.id, 'spec_draft', before);
    void loadMap();
    return receipt;
  }

  function applyCodeAction(envelope) {
    const source = envelope.source;
    if (typeof source !== 'string' || !source) return null;
    const note = envelopeNote(envelope);
    if (isBusyView()) return busyReceipt('code_draft', note);

    const before = snapshot();
    const row = codeRow(codeSource, source);
    const version = bumpMapVersion();
    codeSource = source;
    // 코드가 들어왔는데 실행경로가 폼이면 사람이 [실행]을 눌러도 그 코드가 돌지 않는다.
    runPath = 'code';
    setState({
      codeErrors: [], view: 'design', tab: 'design', designTab: 'code',
      mapVersion: version.to,
    });
    const receipt = remember(makeReceipt('code_draft', {
      applied: true, note, rows: [row], version,
      suggest_run: envelope.suggest_run === true,
      suggest_validate: envelope.suggest_validate === true,
      tab: state.tab, designTab: state.designTab, canUndo: true,
    }));
    pushUndo(receipt.id, 'code_draft', before);
    // 코드가 바뀌면 그 코드로 다시 읽은 지도가 진실이다 — 앞 지도를 두면 서랍의
    // "지도와 일치"가 거짓말이 된다.
    void loadMap();
    return receipt;
  }

  // ── 파일 초안(결정 D4) — 채팅이 낸 파일은 diff로만 선다 ──────────────────────
  //
  // code_draft와 다른 점 하나가 전부다: 이건 **디스크의 파일**을 건드린다. 그래서 바로
  // 반영하지 않는다 — 캔버스는 지금 파일과의 diff만 띄우고, 파일이 쓰이는 순간은 사람이
  // 채팅 카드의 [적용]을 누른 그때뿐이다(결정 D2·D4). 되돌리기가 없는 이유도 같다:
  // 아직 아무것도 바뀌지 않았으므로 되돌릴 것이 없다.
  async function applyFileAction(envelope) {
    const path = typeof envelope.path === 'string' ? envelope.path.trim() : '';
    const source = envelope.source;
    if (!path || typeof source !== 'string' || !source) return null;
    const note = envelopeNote(envelope);
    const suggestRun = envelope.suggest_run === true;
    if (isBusyView()) return busyReceipt('file_draft', note);

    const ide = ensureProjectIde();
    const project = ide && ide.currentProject();
    const blockers = fileBlockers(project, envelope, path);
    if (blockers.length) {
      return remember(makeReceipt('file_draft', {
        note, rows: [fileRow(path, '', source)], errors: blockers, suggest_run: suggestRun,
      }));
    }

    const before = await readProjectText(project.id, path);
    const draft = { id: null, project_id: project.id, path, source, note, before };
    const version = bumpMapVersion();
    setState({
      fileDraft: draft, view: 'design', tab: 'design', designTab: 'code',
      mapVersion: version.to,
    });
    const receipt = remember(makeReceipt('file_draft', {
      note, rows: [fileRow(path, before, source)], version, suggest_run: suggestRun,
      canApply: true, tab: state.tab, designTab: state.designTab,
    }));
    draft.id = receipt.id;
    return receipt;
  }

  // 쓸 수 없는 이유만 돌려준다 — 여기서 막힌 초안은 화면에 서지 않는다.
  function fileBlockers(project, envelope, path) {
    if (!project) return ['코드 탭에서 프로젝트 폴더를 먼저 여세요'];
    if (typeof envelope.project_id === 'string' && envelope.project_id !== project.id) {
      return ['지금 열어둔 프로젝트의 파일이 아닙니다'];
    }
    if (!/\.py$/i.test(path)) return ['파이썬(.py) 파일만 쓸 수 있습니다'];
    if (!deps.writeProjectFile) return ['프로젝트 저장 연결이 없습니다'];
    return [];
  }

  function fileRow(path, before, after) {
    return Object.assign(codeRow(before, after), { label: path });
  }

  // diff의 왼쪽 — 없는 파일이면 빈 문자열이다(새로 만드는 경우가 그렇다).
  async function readProjectText(projectId, path) {
    if (!deps.readProjectFile) return '';
    try {
      const res = await deps.readProjectFile(projectId, path);
      return String((res && res.text) || '');
    } catch { return ''; }
  }

  // 채팅 카드의 [적용]·[적용하고 실행] — 파일이 디스크에 쓰이는 유일한 자리다.
  async function applyFileDraft(id) {
    const draft = state.fileDraft;
    if (!draft || (id && draft.id !== id)) {
      return { ok: false, reason: '적용할 파일 초안이 없습니다' };
    }
    if (isBusyView()) return { ok: false, reason: '실행 중에는 파일을 쓸 수 없습니다' };
    if (!deps.writeProjectFile) return { ok: false, reason: '프로젝트 저장 연결이 없습니다' };
    // 편집기에 저장 안 한 편집이 있는 파일에 쓰면 사람이 친 것이 조용히 사라진다.
    const open = activeProjectFile();
    if (open && open.path === draft.path && open.dirty) {
      return { ok: false, reason: '편집기에 저장하지 않은 편집이 있습니다 — 저장하거나 되돌린 뒤 적용하세요' };
    }
    try {
      await deps.writeProjectFile(draft.project_id, draft.path, draft.source);
    } catch (err) {
      const reason = String((err && err.message) || err);
      setState({ codeErrors: [reason] });
      return { ok: false, reason };
    }
    // 새 파일이면 트리에 없던 경로다 — 목록을 다시 읽어야 다음 턴 컨텍스트가 맞는다.
    await loadProjectFiles(draft.project_id);
    setState({ fileDraft: null, codeErrors: [] });
    if (projectIde) projectIde.refresh();
    return { ok: true, path: draft.path };
  }

  // 채팅 카드의 [버리기] — 아무것도 쓰지 않았으므로 초안을 지우면 끝이다.
  function discardFileDraft(id) {
    const draft = state.fileDraft;
    if (!draft || (id && draft.id !== id)) {
      return { ok: false, reason: '버릴 파일 초안이 없습니다' };
    }
    setState({ fileDraft: null });
    return { ok: true, path: draft.path };
  }

  // 헤더 탭 버튼과 같은 규칙이다 — 채팅이 여는 화면이 사람이 누르는 화면과 달라지면
  // "채팅이 옮긴 곳"과 "내가 가는 곳"이 갈라진다.
  function navigateAction(payload) {
    const tab = payload.tab;
    if (!MODE_TABS.some(([key]) => key === tab)) return null;
    if (isBusyView()) return busyReceipt('navigate', envelopeNote(payload));
    const wanted = payload.designTab;
    const designTab = DESIGN_TABS.some(([key]) => key === wanted) ? wanted : null;
    if (designTab) setState({ designTab });
    if (tab === 'history') void loadHistory();
    else if (tab === 'deploy') void loadDeployments();
    else {
      setState({ view: tab === 'result' && state.result ? 'result' : 'design', tab });
      if (designTab === 'flow') void loadMap();
    }
    return remember(makeReceipt('navigate', {
      applied: true, note: envelopeNote(payload),
      tab: state.tab, designTab: state.designTab,
    }));
  }

  // 최적화만은 여전히 켜두기다 — 탐색은 몇 분씩 돌고 TR을 쓴다(사람이 [탐색 시작]을 누른다).
  function optimizeAction(payload) {
    const note = envelopeNote(payload);
    if (isBusyView()) return busyReceipt('optimize_request', note);
    const method = payload.method;
    setState({
      view: 'design',
      tab: 'optimize',
      optimizeMethod: OPTIMIZE_METHODS.some(([m]) => m === method)
        ? method
        : state.optimizeMethod,
      // 문구가 없으면 true만 남긴다 — 화면이 기본 문장을 대신 적는다.
      optimizeSuggested: note || true,
    });
    return remember(makeReceipt('optimize_request', {
      applied: true, note, tab: state.tab, designTab: state.designTab,
      method: state.optimizeMethod || 'grid',
    }));
  }

  // 채팅 카드의 [되돌리기]. 옛 지점으로 돌아가면 그 뒤의 스냅샷은 버린다 —
  // "되돌린 것을 다시 되돌리기"는 만들지 않는다(사람이 다시 말하면 된다).
  function undoChatAction(id) {
    if (isBusyView()) return { ok: false, reason: '실행 중에는 되돌릴 수 없습니다' };
    const index = undoStack.findIndex((entry) => entry.id === id);
    if (index === -1) return { ok: false, reason: '되돌릴 내역이 남아 있지 않습니다' };
    const entry = undoStack[index];
    undoStack.length = index;
    const before = entry.before;
    const rows = entry.kind === 'code_draft'
      ? [codeRow(codeSource, before.codeSource)]
      : specRows(spec, before.spec);
    spec = before.spec ? JSON.parse(JSON.stringify(before.spec)) : null;
    codeSource = before.codeSource;
    runPath = before.runPath;
    // 되돌린 변경은 더 이상 서 있지 않다 — 남겨두면 읽는 쪽이 반영된 것으로 읽는다.
    lastChange = null;
    setState({
      view: before.tab === 'result' && state.result ? 'result' : 'design',
      tab: before.tab,
      designTab: before.designTab,
      // 되돌린 지도도 새 지도다 — 버전을 되돌리면 서랍의 "지도 vN과 일치"가 이미 사라진
      // 코드를 가리킨다.
      mapVersion: (state.mapVersion || 0) + 1,
      formErrors: [],
      // 검증 오류는 되돌리기로 사라진 코드의 것이다 — 남기면 코드 탭이 지금 편집기에
      // 없는 줄을 가리키고, getContext().code.errors도 복원된 원문과 어긋난다.
      codeErrors: [],
      draft: null,
    });
    void loadMap();
    return { ok: true, restored: { rows } };
  }

  // 채팅 카드의 [실행] — 폼 검증은 실행 버튼과 같은 자리에서 돈다. 오류를 돌려주는 것은
  // 카드가 "왜 안 돌았는지"를 그 자리에 적기 위해서다.
  function runFromChat() {
    if (!spec) return ['불러온 전략이 없습니다'];
    const errors = runErrors();
    void handleRun(false);
    return errors;
  }

  // 채팅 카드의 [검증] — 코드 탭 [검증]과 같은 코드를 쓴다.
  function validateFromChat() {
    return validateCode();
  }

  // 채팅 카드의 [탐색 시작] — 화면의 [탐색 시작]과 같은 자리.
  function startOptimizeFromChat() {
    if (state.optimizeSuggested) setState({ optimizeSuggested: null });
    if (state.optimizeBusy) return Promise.resolve();
    return runOptimize();
  }

  // 채팅 턴마다 chat.js가 읽어 main.js buildLiveTurnPrompt에 넘긴다 — 모델이 폼을 알고
  // 되묻지 않게 하기 위해서다. spec은 복사본이다(모델 경로가 폼을 만지지 못한다).
  function getContext() {
    const code = codeSource || '';
    return {
      view: state.view,
      tab: state.tab,
      designTab: state.designTab,
      runPath,
      spec: spec ? JSON.parse(JSON.stringify(spec)) : null,
      // 설정은 검증과 무관하게 바로 들어가므로 대기 초안은 없다 — 계약 키는 남긴다.
      draft: null,
      // 실행 전에 채워야 할 것(SpecModel.validate) — 모델이 다음 턴에 마저 채운다.
      pending: spec ? SpecModel.validate(spec) : [],
      presets: presets.map((p) => ({ id: p.id, name: p.name })),
      // 지도(보드 11~14) — 대화가 다루는 칸의 목록이다. 모델은 이 칸 번호와 사람 말로
      // 답하고, 코드 줄 번호는 말하지 않는다(코드는 최후의 보루다).
      map: mapContext(),
      code: {
        source: code.slice(0, CONTEXT_CODE_LIMIT),
        truncated: code.length > CONTEXT_CODE_LIMIT,
        lines: code ? code.split('\n').length : 0,
        strategyId,
        activeVersionId,
        errors: state.codeErrors || [],
      },
      // 코드는 검증 없이 바로 편집기에 들어간다 — 대기하는 코드 초안은 없다(원문은
      // code.source에 있다). 계약 키는 남긴다.
      codeDraft: null,
      lastResult: lastResultContext(),
      diagnosis: state.diagnosis
        ? {
          title: state.diagnosis.title || null,
          why: state.diagnosis.why || null,
          line: state.diagnosis.line == null ? null : state.diagnosis.line,
          hasFix: !!(state.diagnosis.suggestion && state.diagnosis.suggestion.new_source),
          summary: (state.diagnosis.suggestion && state.diagnosis.suggestion.summary) || null,
        }
        : null,
      optimize: {
        method: state.optimizeMethod || 'grid',
        result: optimizeResultContext(),
      },
      runs: (Array.isArray(state.runs) ? state.runs : []).slice(0, 10).map((r) => ({
        run_id: r.run_id,
        status: r.status,
        total_return: r.metrics ? r.metrics.total_return : null,
        sharpe: r.metrics ? r.metrics.sharpe : null,
      })),
      coverage: currentCoverage(),
      lastChange,
      project: projectContext(),
    };
  }

  // 마지막으로 받아온 지도만 싣는다 — 화면이 칸을 지어내면 모델이 없는 칸을 고치려 든다.
  // 아직 지도를 못 받았으면 칸은 빈 목록이고, 버전은 그래도 지금 값이다.
  function mapContext() {
    const nodes = (state.map && Array.isArray(state.map.nodes)) ? state.map.nodes : [];
    return {
      version: state.mapVersion || 0,
      nodes: nodes.map((node) => ({
        id: node.id,
        numeral: node.numeral,
        title: node.title,
        lines: (node.lines || []).map((line) => {
          const role = Explain.ROLE_LABELS[line.role];
          return role ? `${role}: ${line.text}` : line.text;
        }),
        status: node.status,
        note: node.note || null,
      })),
      // 시각 설계(US-007) — 대화가 다루는 것은 이제 칸 설명이 아니라 이 그래프다.
      // 아직 그래프가 없으면 null이고, 화면이 없는 노드를 지어내지 않는다.
      graph: visualGraphContext(),
      validation_state: visualState,
      // 코드 전용으로 분기했는가(US-010) — 그렇다면 그래프는 마지막 호환 snapshot일
      // 뿐이고, 모델이 "지도와 동기화됐다"고 말하면 그것은 거짓이다.
      code_only: codeOnly,
      hashes: visualHashes || null,
      diagnostics: visualDiagnostics.map((d) => ({
        code: d.code,
        node_id: d.node_id || null,
        port: d.port || null,
        message_ko: d.message_ko || null,
      })),
      pendingQuestion: pendingQuestion
        ? {
          code: pendingQuestion.code || null,
          question_ko: pendingQuestion.question_ko || null,
          choices: (pendingQuestion.choices || []).map((c) => c.id),
        }
        : null,
      pendingPatch: pendingPatch
        ? {
          patch_id: pendingPatch.patch_id || null,
          graph_compatible: !!pendingPatch.graph_compatible,
          summary_ko: pendingPatch.summary_ko || null,
        }
        : null,
    };
  }

  // 그래프는 좌표를 빼고 싣는다 — 모델이 x·y를 읽을 이유가 없고, 컨텍스트만 두 배가 된다.
  function visualGraphContext() {
    if (!visualGraph) return null;
    return {
      nodes: (visualGraph.nodes || []).map((node) => ({
        id: node.id, kind: node.kind, label: node.label || null, params: node.params || {},
      })),
      edges: (visualGraph.edges || []).map((edge) => ({
        id: edge.id, from: edge.from, to: edge.to,
      })),
    };
  }

  // 열린 폴더의 사실만 — 모델이 경로를 지어내지 않게 하고, 아직 안 쓴 파일 초안이
  // 서 있다는 것을 매 턴 다시 알린다(썼다고 말해버리는 것을 막는 유일한 장치다).
  function projectContext() {
    const project = projectIde ? projectIde.currentProject() : null;
    if (!project) return null;
    const active = projectIde.activeFile();
    const draft = state.fileDraft;
    return {
      name: project.name,
      path: project.path,
      activeFile: active ? active.path : null,
      dirty: !!(active && active.dirty),
      // IDE는 열린 탭 목록을 밖으로 내주지 않는다 — 확실히 아는 것은 활성 파일뿐이다.
      openFiles: active ? [active.path] : [],
      pyFiles: projectFiles.slice(),
      fileDraft: draft
        ? { path: draft.path, note: draft.note, lines: countLines(draft.source) }
        : null,
    };
  }

  // 실패한 실행에는 지표가 없다 — 앞 실행의 숫자를 남겨두면 모델이 그것을 이번 결과로 읽는다.
  function lastResultContext() {
    if (lastError) {
      return {
        runId: state.runId || null,
        status: 'failed',
        metrics: {},
        flags: [],
        tradesCount: 0,
        stdoutTail: '',
        error: lastError,
      };
    }
    if (!state.result) return null;
    const result = state.result;
    const metrics = result.metrics || {};
    const picked = {};
    CONTEXT_METRIC_KEYS.forEach((key) => {
      if (metrics[key] !== undefined) picked[key] = metrics[key];
    });
    const flags = Array.isArray(result.flags)
      ? result.flags
      : (Array.isArray(metrics.flags) ? metrics.flags : []);
    const stdout = String(result.stdout || '');
    return {
      runId: state.runId || null,
      status: 'done',
      metrics: picked,
      flags,
      tradesCount: Array.isArray(state.trades) ? state.trades.length : 0,
      stdoutTail: stdout ? stdout.slice(-CONTEXT_STDOUT_LIMIT) : '',
      error: null,
    };
  }

  function optimizeResultContext() {
    const res = state.optimizeResult;
    if (!res) return null;
    const best = res.best || null;
    const cells = res.heatmap && Array.isArray(res.heatmap.cells) ? res.heatmap.cells.length : 0;
    return {
      best: best
        ? {
          params: best.params,
          sharpe: best.sharpe == null ? null : best.sharpe,
          total_return: best.total_return == null ? null : best.total_return,
          mdd: best.mdd == null ? null : best.mdd,
        }
        : null,
      warnings: (res.warnings || []).map((w) => (w && w.message) || String(w)),
      cells,
    };
  }

  // ---------- 렌더 ----------

  function render() {
    if (!mounted) return;
    // 대상이 바뀐 첫 그리기에서 한 번만 캐시 상태를 묻는다 — 같은 열쇠로 두 번 묻지 않는다.
    const wantedCoverage = coverageKey();
    if (wantedCoverage && wantedCoverage !== coverageAsked) {
      coverageAsked = wantedCoverage;
      void loadCoverage();
    }
    // 스펙이 바뀌면 지도 탭의 그래프도 그 스펙의 것이어야 한다 — 열쇠(yaml)가 같으면
    // 다시 만들지 않는다. 폼 편집이 그래프로 흐르는 유일한 길이다.
    void ensureVisualGraph();
    clear(container);
    if (state.view === 'empty') {
      container.appendChild(renderMessagePanel('', '프리셋을 불러오는 중입니다…'));
      return;
    }
    if (state.view === 'error') {
      const panel = renderMessagePanel(
        'backtest-canvas-error', state.message || '알 수 없는 오류입니다',
      );
      // 막다른 길 금지(보드 10) — 오류 화면에서 설계로 돌아갈 길이 없어 사용자가 갇혔다
      // (2026-09-02 실측 "뒤로가기가 없어"). 전략이 있으면 설계 폼으로, 없으면 프리셋부터.
      panel.appendChild(button('backtest-error-back', '설계로 돌아가기', () => {
        if (spec) setState({ view: 'design', tab: 'design', designTab: 'form', message: null });
        else void loadPresets();
      }));
      // 오류에서 지도로 가는 길(보드 12) — 무엇이 멈췄는지는 줄 번호가 아니라 칸 위에서
      // 읽힌다. 전략이 있어야 그릴 지도가 있다.
      if (spec || codeSource.trim()) {
        panel.appendChild(button('backtest-error-map', '지도에서 보기', () => {
          setState({ view: 'design', tab: 'design', designTab: 'flow', message: null });
          void loadMap();
        }));
      }
      container.appendChild(panel);
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
    // 이력에서 다시 연 버전이면 무엇을 보고 있는지가 제목 옆에 선다 — 지금 편집 중인
    // 초안과 지난 버전을 화면 어디에서도 구분할 수 없으면 사람은 옛 그래프를 고치려 든다.
    if (openedVersion) {
      title.appendChild(el('span', 'backtest-head-opened', openedVersionText()));
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

    // 코드가 있을 때만 갈래가 생긴다 — 빈 편집기에 "코드로 실행"을 걸어둘 이유가 없다.
    if (codeSource.trim()) {
      const paths = el('div', 'backtest-runpath');
      RUN_PATHS.forEach(([value, label]) => {
        const isOn = runPath === value;
        const item = button(`backtest-runpath-item${isOn ? ' is-on' : ''}`, label, () => {
          runPath = value;
          render();
        });
        item.setAttribute('aria-pressed', String(isOn));
        paths.appendChild(item);
      });
      head.appendChild(paths);
    }

    // 시각 설계가 서면 실행 버튼 옆에 지금 검증 상태가 선다(US-007). 유효하지 않은
    // 그래프로는 실행이 시작되지 않고, 버튼이 다음 행동을 대신 말한다.
    if (visualActive()) {
      head.appendChild(renderVisualStatus());
      head.appendChild(button('backtest-visual-validate', '검증', () => { void runVisualValidate(); }));
      const blocked = visualState === 'invalid';
      const run = button(
        'backtest-run-button', blocked ? VISUAL_RUN_BLOCKED : '실행',
        () => { if (!blocked) void handleRun(false); },
      );
      if (blocked) { run.disabled = true; run.setAttribute('aria-disabled', 'true'); }
      head.appendChild(run);
      return head;
    }
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
        if (key === 'flow') void loadMap();
      });
      tab.setAttribute('aria-pressed', String(isOn));
      subtabs.appendChild(tab);
    });
    wrap.appendChild(subtabs);

    if (state.designTab === 'code') { wrap.appendChild(renderCodeTab()); return wrap; }
    if (state.designTab === 'flow') { wrap.appendChild(renderFlowTab()); return wrap; }

    if (!presets.length && !userStrategies.length) {
      wrap.appendChild(el('div', 'backtest-design-empty', '사용 가능한 프리셋이 없습니다'));
      return wrap;
    }
    wrap.appendChild(renderPresetList());
    wrap.appendChild(renderTargetCard());
    // 내 전략은 지표·조건을 쓰지 않는다 — 신호를 만드는 것은 그 파일의 파이썬이다.
    // 빈 조건 빌더를 세워두면 "여기를 채워야 도는가"라고 묻게 된다(실행은 이미 그
    // 칸들을 검사하지 않는다, runErrors 참고).
    if (userStrategyId) {
      wrap.appendChild(renderUserParamsCard());
    } else {
      wrap.appendChild(renderIndicatorCard());
      wrap.appendChild(renderConditionCards());
    }
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
      const isSelected = spec && !userStrategyId && preset.id === spec.presetId;
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
    if (userStrategies.length) wrap.appendChild(renderUserStrategyList());
    return wrap;
  }

  // 내 폴더의 .py를 프리셋 바로 아래 같은 모양으로 세운다 — "프리셋과 같은 자리"라는
  // 것이 이 기능의 요구 자체다. 다른 점은 둘뿐이다: 파일이 사라졌으면 그렇다고 적고,
  // 줄마다 [등록 해제]가 붙는다(등록만 지우고 파일은 건드리지 않는다).
  function renderUserStrategyList() {
    const wrap = el('div', 'backtest-user-strategy-wrap');
    wrap.appendChild(el(
      'div', 'backtest-card-title', `내 전략 ${userStrategies.length}개 — 내 폴더의 파이썬`,
    ));
    const list = el('div', 'backtest-user-strategy-list');
    userStrategies.forEach((entry) => {
      const row = el('div', 'backtest-user-strategy-row');
      const isSelected = userStrategyId === entry.id;
      const item = button(
        `backtest-user-strategy-item${isSelected ? ' is-selected' : ''}`, null,
        () => { void selectUserStrategy(entry.id); },
      );
      item.setAttribute('aria-pressed', String(isSelected));
      item.appendChild(el('div', 'backtest-user-strategy-name', entry.name));
      item.appendChild(el('div', 'backtest-user-strategy-path', entry.path));
      if (entry.exists === false) {
        item.appendChild(el('div', 'backtest-user-strategy-missing', '파일이 없습니다'));
      }
      row.appendChild(item);
      row.appendChild(button('backtest-user-strategy-remove', '등록 해제', () => {
        void unregisterUserStrategy(entry.id);
      }));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // 등록부가 주는 것은 파일의 PARAMS 기본값뿐이라 범위는 화면이 잡았다 — 그 사실을
  // 부제에 적는다(프리셋의 min/max는 전략이 정한 값이고, 이것은 아니다).
  function renderUserParamsCard() {
    const card = el('div', 'backtest-card');
    const head = el('div', 'backtest-card-head');
    head.appendChild(el('div', 'backtest-card-title', '파라미터'));
    head.appendChild(el(
      'div', 'backtest-card-note',
      '신호는 이 파일의 파이썬이 만듭니다 · 슬라이더 범위는 기본값에서 화면이 잡은 것입니다',
    ));
    card.appendChild(head);
    const names = spec ? Object.keys(spec.params) : [];
    if (!names.length) {
      card.appendChild(el('div', 'backtest-card-empty', '이 전략에는 PARAMS가 없습니다'));
      return card;
    }
    const row = el('div', 'backtest-user-param-row');
    names.forEach((name) => { row.appendChild(renderParamSlider(name, spec.params[name])); });
    card.appendChild(row);
    return card;
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
    const coverage = currentCoverage();
    if (coverage) {
      head.appendChild(el(
        'div', 'backtest-card-note',
        `캐시 ${formatNumeric(coverage.rows)}봉 · ${coverage.first_dt || '없음'}`
        + ` → ${coverage.last_dt || '없음'}`,
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
    // 손으로 고친 초안이 마지막 생성 산출물과 다르면 여기서 갈래를 묻는다(US-010) —
    // 자동 왕복은 없다. 두 버튼은 지도 서랍의 [지도로 되돌리기]와 같은 결정을 두 번
    // 두지 않기 위해 이 한 자리에만 선다(초안이 있는 곳이 여기다).
    if (codeAheadOfMap()) wrap.appendChild(renderCodeAheadChoices());
    // 지도에서 열고 들어왔으면 그 사실을 먼저 말한다(보드 14-E) — 여기서 손으로 고치면
    // 지도가 진실이라는 규칙이 깨지는 순간이 시작된다.
    if (state.codeFromMap) {
      wrap.appendChild(el(
        'div', 'backtest-code-frommap',
        '여기서 고치면 지도와 어긋날 수 있습니다 — 웬만하면 대화로',
      ));
    }
    // 프로젝트 IDE는 자기 루트 노드를 계속 들고 있다 — 여기서는 붙이기만 한다.
    const ide = ensureProjectIde();
    if (ide) wrap.appendChild(ide.element);
    // 프로젝트를 고르기 전까지는 지금까지의 단일 버퍼 편집기가 그대로 코드 탭이다.
    if (ide && ide.currentProject()) {
      wrap.appendChild(renderIdeActions());
      if (state.fileDraft) wrap.appendChild(renderFileDraft());
      wrap.appendChild(renderCodeErrors());
      wrap.appendChild(renderCodeBounds());
      return wrap;
    }

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
      onBackToNode: backToVisualNode,
    });
    if (state.flowRange) {
      editorHandle.highlightLines(state.flowRange.first, state.flowRange.last);
    }
    // 노드에서 열고 들어온 연결은 매 그리기마다 되건다 — 한 번만 걸면 다음 render()에서
    // 리본과 표식이 조용히 사라진다(편집기는 매번 새로 만들어진다).
    applyCodeSpan();

    const actions = el('div', 'backtest-code-actions');
    actions.appendChild(button('backtest-code-validate', '검증', () => { void validateCode(); }));
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
    wrap.appendChild(renderCodeErrors());
    wrap.appendChild(renderCodeBounds());
    return wrap;
  }

  // 프로젝트를 열었을 때의 코드 탭 행동줄 — 옛 편집기의 .backtest-code-actions와 같은
  // 자리다(검증·저장이 있던 곳). 여기 있는 것은 이 폴더에 붙는 둘: 환경과 등록.
  //
  // **왜 IDE 안이 아니라 캔버스가 그리는가.** IDE의 paint()는 편집기를 다시 만든다 —
  // 환경 잡 진행을 1초마다 IDE 안에서 갱신하면 pip이 도는 30초 동안 타자와 한글 조합이
  // 계속 날아간다. 캔버스가 그리면 그 갱신이 편집기에 닿지 않는다.
  function renderIdeActions() {
    const bar = el('div', 'backtest-ide-actions');
    bar.appendChild(renderVenvPanel());
    // 대상은 "지금 연 파일"이다. 그 값을 여기서 읽어 버튼의 유무를 정하지 않는 이유:
    // 파일을 여는 것은 IDE의 paint()이고 캔버스는 그때 다시 그리지 않는다 — 버튼이
    // 뒤늦게 생기는 대신, 누르는 순간 activeProjectFile()을 읽고 없으면 그렇다고 말한다.
    if (deps.registerUserStrategy) {
      bar.appendChild(button('backtest-register-strategy', '내 전략으로 등록', () => {
        void registerActiveStrategy();
      }));
    }
    return bar;
  }

  // 환경 패널 — 지금 이 폴더의 .venv가 어떤 상태인가, 그리고 만들기. 상태는 백엔드가
  // 지금 디스크를 본 결과다(캐시가 아니다).
  function renderVenvPanel() {
    const panel = el('div', 'backtest-venv-panel');
    panel.appendChild(el('span', 'backtest-venv-title', '환경'));
    const env = state.env;
    const status = env && env.exists
      ? `준비됨 · ${(env.packages || []).length}개 패키지`
      : '없음';
    panel.appendChild(el('span', 'backtest-venv-status', status));

    const box = el('input', 'backtest-venv-packages');
    box.type = 'text';
    box.placeholder = '더 깔 패키지 (예: scipy, ta==0.11.0)';
    box.value = state.envPackages == null ? '' : String(state.envPackages);
    // 매 키입력마다 다시 그리면 커서가 날아간다 — 값만 담는다(폼 입력들과 같은 규칙).
    box.addEventListener('input', () => { state.envPackages = box.value; });
    panel.appendChild(box);

    panel.appendChild(button('backtest-venv-create', '환경 만들기', () => {
      void startProjectEnv();
    }));
    if (state.envProgress) {
      panel.appendChild(el('div', 'backtest-venv-progress', state.envProgress));
    }
    if (state.envError) {
      panel.appendChild(el('div', 'backtest-venv-error', state.envError));
    }
    return panel;
  }

  // 채팅이 낸 파일 초안 — 지금 파일과의 diff만 보여준다. 누르는 자리는 채팅 카드
  // 하나뿐이다(같은 결정을 두 곳에 두면 어느 쪽이 진짜인지 알 수 없다).
  function renderFileDraft() {
    const draft = state.fileDraft;
    const wrap = el('div', 'backtest-file-draft');
    const head = el('div', 'backtest-diag-fix-head');
    head.appendChild(el('div', 'backtest-diag-section-title', draft.path));
    head.appendChild(el(
      'div', 'backtest-diag-fix-stat',
      draft.before ? '채팅의 [적용]을 눌러야 이 파일에 씁니다' : '새 파일 — 아직 만들지 않았습니다',
    ));
    wrap.appendChild(head);
    const host = el('div', 'backtest-file-draft-diff');
    CodeEditor.renderDiff(host, draft.before, draft.source, {});
    wrap.appendChild(host);
    return wrap;
  }

  function renderCodeErrors() {
    const errors = el('div', 'backtest-design-error');
    // 폼 검증 오류도 여기 적는다 — 코드 초안 카드의 [적용하고 실행]은 폼 검증을 거치는데,
    // 그 오류를 폼 탭에서만 그리면 코드 탭에 있는 사람에게는 아무 일도 안 일어난 것처럼 보인다.
    (state.formErrors || []).concat(state.codeErrors || []).forEach((m) => {
      errors.appendChild(el('div', 'backtest-design-error-line', m));
    });
    return errors;
  }

  function renderCodeBounds() {
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
    return bounds;
  }

  // ── 보드 11~14 · 흐름 지도(첫 표면) ───────────────────────────────────────
  //
  // 이 탭이 백테스트의 얼굴이다. 폼도 코드도 여기서 파생된다 — 폼은 이 지도의 입력칸이고,
  // 코드는 아래 서랍 한 줄이다(사용자 확정 2026-09-03).

  function renderFlowTab() {
    const wrap = el('div', 'backtest-flow-tab');
    if (!spec && !currentSource()) {
      wrap.appendChild(el(
        'div', 'backtest-card-empty',
        '프리셋을 고르거나 코드를 쓰면 흐름 지도가 여기 그려집니다',
      ));
      return wrap;
    }
    // 코드 전용으로 분기했거나 이력에서 버전을 다시 열었으면 지도는 **읽기 전용
    // snapshot**이다(US-010) — 편집 표면보다 먼저 걸러야 지난 그래프를 고치는 길이
    // 애초에 생기지 않는다.
    if (snapshotGraph()) { wrap.appendChild(renderSnapshotDesign()); return wrap; }
    // 스펙 경로에서는 지도가 편집 표면이다(US-007) — 대상 한 줄과 코드 서랍은 그대로
    // 편집기 위·아래에 남는다. 편집이 가능해졌다고 그 둘이 사라질 이유는 없다.
    if (visualActive()) { wrap.appendChild(renderVisualDesign()); return wrap; }
    // 코드 경로의 지도는 그래프로 되돌릴 수 없다 — 읽기 전용임을 먼저 말한다.
    if (visualWired() && !isSpecPath()) {
      wrap.appendChild(el('div', 'backtest-flow-codeonly', '코드 전용'));
    }
    if (state.visualNotice) {
      wrap.appendChild(el('div', 'backtest-flow-notice', state.visualNotice));
    }
    wrap.appendChild(renderSummaryMap(true));
    return wrap;
  }

  // 요약 지도(보드 15·16) — 칸 ①~④를 사람 말로, 오른쪽엔 지난 실행의 실제 값, 멈춘 칸엔
  // 오류. 코드 경로에서는 이것이 지도의 전부이고, 스펙 경로에서는 편집기 위에 먼저 선다:
  // 비개발자가 읽는 단위는 노드·연결이 아니라 "이 전략은 이렇게 흐릅니다"의 네 칸이다.
  // 서랍(코드 열기)은 한 번만 그린다 — withDrawer=false면 부르는 쪽이 따로 그린다.
  function renderSummaryMap(withDrawer) {
    const wrap = el('div', 'backtest-flow-summary');
    // 만드는 중이라는 사실을 그린다 — 빈 자리는 "기능이 죽었다"로 읽힌다.
    if (state.mapLoading) {
      const loading = el('div', 'backtest-flow-loading');
      loading.appendChild(el('span', 'backtest-flow-spinner', ''));
      loading.appendChild(el('span', 'backtest-flow-loading-text', '흐름 지도를 만드는 중…'));
      wrap.appendChild(loading);
    }
    if (state.mapError) {
      wrap.appendChild(el('div', 'backtest-flow-error', state.mapError));
    }
    // 만들지도 못했고 만드는 중도 아니면 왜 비었는지 적는다 — 지도가 첫 표면이라
    // 이 자리가 비면 사용자는 백테스트 전체가 비었다고 읽는다.
    if (!state.map && !state.mapLoading && !state.mapError) {
      wrap.appendChild(el(
        'div', 'backtest-card-empty',
        deps.map ? '흐름 지도를 아직 만들지 못했습니다' : '이 화면에는 흐름 지도 연결이 없습니다',
      ));
    }
    const map = el('div', 'backtest-flow-map');
    if (state.map) {
      Explain.renderFlowMap(map, state.map, {
        onSelect: selectMapNode,
        changedIds: new Set((lastChange && lastChange.nodes) || []),
        target: mapTarget(),
        // 오른쪽 사실이 어느 실행의 것인지 — 없으면 그 문장 자체를 적지 않는다.
        lastRunLabel: state.runId ? String(state.runId).slice(0, 8) : null,
        drawer: withDrawer ? {
          fileLabel: codeFileLabel(),
          matchesMap: !!(state.map.code && state.map.code.matches_map),
          aheadOfMap: runPath === 'code' && !!spec,
          onOpenCode: () => { void openCodeFromMap(); },
          onBackToMap: backToMap,
        } : null,
      });
    }
    wrap.appendChild(map);
    // 실행 전에 채울 것은 지도에서도 보여야 한다 — 대화가 폼을 채우고 사람은 지도를 본다.
    wrap.appendChild(renderFormErrors());
    // 멈춘 실행의 진단은 지도 아래에 붙는다(보드 12) — 고칠 자리가 그 칸이기 때문이다.
    // lastError를 같이 보는 이유: 진단은 마지막 실패의 것이고, 그 뒤 실행이 성공하면
    // 이미 지나간 진단이다(성공이 lastError를 지운다).
    if (state.diagnosis && lastError) wrap.appendChild(renderDiagnosisPanel());
    return wrap;
  }

  // 칸을 누르면 그 칸을 다루는 자리로 간다 — 코드 경로의 칸에는 실제 줄이 있어 편집기가
  // 그 줄을 켜고, 폼 경로의 칸은 아직 코드가 없으므로 그 값을 고치는 폼으로 간다.
  function selectMapNode(node) {
    const range = Explain.lineRange(node);
    if (range) setState({ flowRange: range, designTab: 'code' });
    else setState({ designTab: 'form' });
  }

  // 서랍에 적히는 이름 — 파일이면 그 경로, 단일 편집기면 strategy.py, 폼 경로에서는
  // 아직 파일이 아니라 지도에서 만들어지는 코드다.
  function codeFileLabel() {
    const active = activeProjectFile();
    if (active) return active.path;
    if (codeSource.trim()) return 'strategy.py';
    return '생성됨';
  }

  // [코드 열기](보드 14-E) — 폼 경로에서는 지도 뒤의 코드가 아직 없다. 그때만 백엔드에
  // 한 번 만들어 편집기에 얹는다(같은 폼이면 다시 만들지 않는다). **실행경로는 건드리지
  // 않는다** — 코드를 열어봤다는 이유로 도는 것이 바뀌면 사람이 모르는 사이에 코드가 돈다.
  // 대상 한 줄의 재료 — 코드 경로의 지도는 소스만 보고 그려져 백엔드가 종목·기간을
  // 모른다. 코드로 돌아도 대상은 폼이 정하므로 그 줄은 여기서 채운다. 종목이 아직
  // 없으면 null을 주고, 지도는 그 줄을 비운다(지어내지 않는다).
  function mapTarget() {
    if (!spec || !Array.isArray(spec.symbols) || !spec.symbols.length) return null;
    return {
      symbol: spec.symbols[0], period: spec.period, adjusted: spec.adjusted,
      from: spec.fromDt || null, to: spec.toDt || null,
    };
  }

  async function openCodeFromMap() {
    if (runPath === 'code' || activeProjectFile() || !spec || !deps.codegen) {
      setState({ designTab: 'code', codeFromMap: true });
      return;
    }
    const yaml = currentYaml();
    if (!codegenCache || codegenCache.yaml !== yaml) {
      let res;
      try { res = await deps.codegen({ yaml }); }
      catch (err) { setState({ mapError: String((err && err.message) || err) }); return; }
      codegenCache = { yaml, source: String((res && res.source) || '') };
    }
    codeSource = codegenCache.source;
    setState({ designTab: 'code', codeFromMap: true, mapError: null });
  }

  // [지도로 되돌리기](보드 14-E) — 지도가 진실이므로 앞선 코드 초안을 버리고 폼 경로로
  // 돌아간다. 코드를 남겨두면 "지도로 돌아왔다"고 말하면서 실행은 계속 그 코드가 돈다.
  function backToMap() {
    runPath = 'form';
    codeSource = '';
    setState({ designTab: 'flow', codeFromMap: false, codeErrors: [] });
    void loadMap();
  }

  // ── US-010 · P3 왕복 경계(코드 전용 분기 · 버전 되열기) ────────────────────
  //
  // 지도와 코드가 갈라지는 순간은 하나뿐이다: 사람이 생성된 코드를 손으로 고쳤을 때.
  // 그때 화면이 하면 안 되는 일이 코드→그래프 자동 왕복이다(연구 문서 §표현 불가능한
  // 코드 수정 — 지원 subset으로 증명되지 않는 수정을 그래프로 추정하면 보이는 전략과
  // 도는 전략이 갈라진다). 그래서 여기서는 갈래를 **묻기만** 한다:
  //   ① [그래프에서 다시 만들기] = backToMap — 코드 초안을 버리고 그래프를 지킨다.
  //   ② [코드 전용으로 분기]     = forkCodeOnly — 코드를 새 origin=code_only 버전으로
  //      남기고, 지도는 마지막 호환 snapshot을 읽기 전용으로만 보여준다.
  // 어느 쪽도 활성화가 아니고 실행이 아니다(그 둘은 여전히 별도의 버튼이다).

  // 코드가 지도보다 앞섰는가 — 마지막으로 화면에 얹은 **생성 코드**와 다르면 사람이
  // 손으로 고친 것이다. 이미 분기했으면 앞선 것이 아니라 그것이 정본이다.
  function codeAheadOfMap() {
    if (codeOnly || openedVersion) return false;
    if (!codeSource.trim()) return false;
    return codeSource !== lastGeneratedSource;
  }

  function renderCodeAheadChoices() {
    const wrap = el('div', 'backtest-code-ahead');
    wrap.appendChild(el('div', 'backtest-code-ahead-text', VISUAL_CODE_AHEAD));
    wrap.appendChild(el(
      'div', 'backtest-code-ahead-note',
      '이 수정을 그래프로 옮길 수는 없습니다 — 어느 쪽을 정본으로 삼을지 고르세요',
    ));
    wrap.appendChild(button('backtest-code-ahead-regraph', CODE_ONLY_REGRAPH, backToMap));
    wrap.appendChild(button('backtest-code-ahead-fork', CODE_ONLY_FORK, () => {
      void forkCodeOnly();
    }));
    if (state.codeOnlyError) {
      wrap.appendChild(el('div', 'backtest-code-ahead-error', state.codeOnlyError));
    }
    return wrap;
  }

  // 지금 초안을 origin=code_only 새 버전으로 남긴다. bundle은 싣지 않는다 — 서버가
  // 422로 거절하고(api/backtest.py `_add_inactive_version`), 거절이 옳다: 그래프를 같이
  // 저장하는 것은 동기화됐다고 서명하는 것과 같다. 활성화도 실행도 하지 않는다.
  async function forkCodeOnly() {
    const source = codeSource;
    if (!source.trim()) return null;
    if (!deps.addVersion) {
      setState({ codeOnlyError: '이 화면에는 버전 저장 배선이 없습니다' });
      return null;
    }
    let id;
    try { id = await ensureStrategyId(source); }
    catch (err) { setState({ codeOnlyError: String((err && err.message) || err) }); return null; }
    if (!id) { setState({ codeOnlyError: '전략을 먼저 저장해야 합니다' }); return null; }
    let saved;
    try {
      saved = await deps.addVersion(id, {
        source, origin: 'code_only', note: CODE_ONLY_NOTE,
      });
    } catch (err) {
      setState({ codeOnlyError: String((err && err.message) || err) });
      return null;
    }
    const from = state.mapVersion || 0;
    const generated = lastGeneratedSource;
    // 마지막 호환 그래프는 그대로 붙잡아 둔다 — 지도 탭이 그것을 읽기 전용으로 보여준다.
    // 저장된 버전은 비활성이므로 activeVersionId는 건드리지 않는다(배포가 꺼진 버전을
    // 집는 길을 만들지 않는다).
    codeOnlyGraph = visualGraph;
    codeOnly = true;
    runPath = 'code';
    lastGeneratedSource = source;
    visualCompiled = null;
    // 'synced'는 이 전략에 더는 쓸 수 없는 말이다 — 상태부터 되돌린다.
    setVisualState('unvalidated', '');
    setState({
      codeOnlyError: null, visualCodeAhead: false, designTab: 'flow',
      view: 'design', tab: 'design',
      mapVersion: (saved && saved.version != null) ? saved.version : from + 1,
    });
    return emitChatCard(remember(makeReceipt('code_only', {
      applied: true,
      note: CODE_ONLY_NOTE,
      rows: [codeRow(generated, source)],
      version: { from, to: state.mapVersion },
      version_id: (saved && saved.version_id) || null,
      tab: state.tab,
      designTab: state.designTab,
    })));
  }

  // 읽기 전용으로 그릴 그래프 — 되연 버전의 그래프가 먼저고(code_only 버전에는 그래프가
  // 없으므로 마지막 호환 snapshot으로 물러난다), 그 다음이 분기 당시의 snapshot이다.
  function snapshotGraph() {
    if (openedVersion) return openedVersion.graph || codeOnlyGraph;
    if (codeOnly) return codeOnlyGraph;
    return null;
  }

  function ensureSnapshotEditor() {
    const graph = snapshotGraph();
    if (!graph) return null;
    if (!snapshotEditor) {
      snapshotHost = el('div', 'backtest-visual-host is-snapshot');
      snapshotEditor = VisualEditor.createVisualEditor(snapshotHost, {
        registry: visualRegistry,
        graph,
        readOnly: true,
        validation: { state: 'unvalidated', summary_ko: '' },
        setTimeoutImpl,
        clearTimeoutImpl,
      });
    } else if (snapshotShown !== graph) {
      snapshotEditor.setGraph(graph);
    }
    snapshotShown = graph;
    return snapshotEditor;
  }

  // 'origin=visual · v3 · 해시 gh-1' — 무엇을 보고 있는지를 지어내지 않고 그대로 적는다.
  function openedVersionText() {
    const hash = String((openedVersion.hashes
      && (openedVersion.hashes.graph_hash || openedVersion.hashes.artifact_hash)) || '');
    const parts = [`origin=${openedVersion.origin || '알 수 없음'}`, `v${openedVersion.version}`];
    if (hash) parts.push(`해시 ${hash.slice(0, 12)}`);
    return parts.join(' · ');
  }

  function renderSnapshotDesign() {
    const wrap = el('div', 'backtest-visual is-snapshot');
    wrap.appendChild(renderVisualTarget());
    const head = el('div', 'backtest-visual-head');
    head.appendChild(el('div', 'backtest-card-title', '마지막으로 그래프와 맞았던 지도'));
    head.appendChild(el(
      'div', 'backtest-snapshot-badge',
      openedVersion && !codeOnly ? VERSION_READONLY_BADGE : CODE_ONLY_BADGE,
    ));
    wrap.appendChild(head);
    if (ensureSnapshotEditor()) wrap.appendChild(snapshotHost);
    else wrap.appendChild(el('div', 'backtest-card-empty', '이 버전에는 저장된 그래프가 없습니다'));
    if (openedVersion) {
      wrap.appendChild(button('backtest-version-edit', VERSION_EDIT_LABEL, () => {
        editOpenedVersion();
      }));
    }
    if (state.visualNotice) {
      wrap.appendChild(el('div', 'backtest-flow-notice', state.visualNotice));
    }
    return wrap;
  }

  // 이력에서 버전 하나를 다시 연다. 되열기는 **읽기 전용**이다 — 지난 그래프를 그대로
  // 편집 표면에 얹으면 지금 작업 중인 초안이 조용히 사라진다. 편집은 [이 버전으로
  // 편집]이 한 번 더 눌려야 시작된다(그때 새 지도 판이 선다).
  async function openVersion(entry) {
    if (!strategyId || !deps.versionDetail) {
      setState({ historyError: '이 화면에는 버전 되열기 배선이 없습니다' });
      return null;
    }
    let detail;
    try { detail = await deps.versionDetail(strategyId, entry.id); }
    catch (err) { setState({ historyError: String((err && err.message) || err) }); return null; }
    if (!detail) { setState({ historyError: '버전을 읽지 못했습니다' }); return null; }
    const origin = detail.origin || entry.origin || null;
    const source = String(detail.source || '');
    codeSource = source;
    // 되연 원문은 그때 생성된 것이지 사람이 방금 고친 초안이 아니다 — 앞섬으로 읽히면
    // 되열기만 해도 분기 두 갈래가 뜬다.
    lastGeneratedSource = source;
    openedVersion = {
      id: entry.id,
      version: detail.version != null ? detail.version : entry.version,
      origin,
      graph: (detail.graph && typeof detail.graph === 'object') ? detail.graph : null,
      spec_yaml: detail.spec_yaml || null,
      hashes: detail.hashes || null,
    };
    if (origin === 'code_only') {
      codeOnly = true;
      runPath = 'code';
      // code_only 버전에는 저장된 그래프가 없다(서버가 bundle을 거절한다) — 지도에
      // 세울 것은 지금 화면이 들고 있는 마지막 호환 그래프뿐이다. 없으면 없는 대로
      // 지금까지의 읽기 전용 지도로 물러난다(지어내지 않는다).
      if (!codeOnlyGraph) codeOnlyGraph = visualGraph;
    } else if (openedVersion.spec_yaml) adoptSpecYaml(openedVersion.spec_yaml);
    if (openedVersion.hashes) visualHashes = openedVersion.hashes;
    visualCompiled = null;
    setVisualState('unvalidated', '');
    setState({
      view: 'design', tab: 'design',
      designTab: origin === 'code_only' ? 'code' : 'flow',
      historyError: null, visualNotice: null, codeSpan: null, visualCodeAhead: false,
    });
    return openedVersion;
  }

  // [이 버전으로 편집] — 되연 버전을 지금 작업 초안으로 삼는다. 새 지도 판이 서는
  // 이유: 편집의 출발점이 바뀌었고, 서랍의 "지도 vN"이 이력의 번호를 계속 가리키면
  // 그 숫자가 무엇을 센 것인지 아무도 모르게 된다.
  function editOpenedVersion() {
    const opened = openedVersion;
    if (!opened) return { ok: false, reason: '다시 연 버전이 없습니다' };
    openedVersion = null;
    if (opened.graph) {
      visualSyncing = true;
      visualGraph = opened.graph;
      visualGraphYaml = currentYaml();
      if (visualEditor) visualEditor.setGraph(visualGraph);
      visualSyncing = false;
      codeOnly = false;
      runPath = 'form';
    }
    visualCompiled = null;
    setVisualState('unvalidated', '');
    setState({
      mapVersion: (state.mapVersion || 0) + 1,
      designTab: opened.graph ? 'flow' : 'code',
      view: 'design', tab: 'design',
    });
    return { ok: true, version: opened.version };
  }

  // ── US-007/008/009 · 시각 전략 편집기(지도 탭) ─────────────────────────────
  //
  // 지도가 첫 표면이라는 규칙은 그대로다. 바뀐 것은 **스펙 경로에서 그 지도가 읽기 전용이
  // 아니라는 것**이다: 프리셋·폼으로 세운 전략은 /visual/from-spec으로 그래프가 되고, 그
  // 그래프를 고치면 서버가 검증·컴파일해 폼과 코드가 따라온다. 코드 경로(내 전략·프로젝트
  // 파일)는 그래프로 되돌릴 수 없으므로 지금까지의 읽기 전용 지도에 '코드 전용' 배지만
  // 붙인다 — 편집기를 세워놓고 저장이 안 되는 화면을 만들지 않는다.
  //
  // **두 방향 동기화의 루프 차단.** 폼 → 그래프는 yaml 열쇠(visualGraphYaml)로, 그래프 →
  // 폼은 visualSyncing 깃발로 막는다. 한쪽이 다른 쪽을 갱신하는 순간 그 열쇠를 같이 옮겨
  // 두어, 되돌아온 변경이 다시 왕복을 시작하지 못하게 한다.
  //
  // **이 경로는 실행·백필·활성화·배포를 부르지 않는다.** 저장(POST versions, origin
  // visual)까지가 끝이고 is_active=false는 서버가 강제한다.

  function visualWired() {
    return !!(deps.visualFromSpec && deps.visualValidate);
  }

  // 스펙 경로인가 — 프리셋·폼으로 세운 전략만 그래프로 되돌릴 수 있다.
  function isSpecPath() {
    return !!spec && !userStrategyId && !activeProjectFile() && runPath === 'form';
  }

  function visualActive() {
    return visualWired() && !visualUnavailable && isSpecPath() && !!visualGraph;
  }

  function visualNodeById(nodeId) {
    const nodes = (visualGraph && Array.isArray(visualGraph.nodes)) ? visualGraph.nodes : [];
    return nodes.find((node) => node.id === nodeId) || null;
  }

  // 편집기의 요약 바는 네 상태만 안다 — 'validating'은 그 사이의 시간이라 '검증 전'으로
  // 넘긴다(없는 상태를 편집기에 지어내 보내지 않는다). 헤더의 점만 그 시간을 말한다.
  function setVisualState(next, summary) {
    visualState = next;
    if (summary != null) visualSummary = summary;
    if (visualEditor) {
      visualEditor.setValidation({
        state: next === 'validating' ? 'unvalidated' : next,
        summary_ko: visualSummary,
      });
    }
  }

  async function ensureVisualRegistry() {
    if (visualRegistry || visualRegistryAsked || !deps.visualRegistry) return;
    visualRegistryAsked = true;
    let payload;
    // 팔레트가 비는 것이지 편집이 막히는 것이 아니다 — 못 읽었다고 지도를 접지 않는다.
    try { payload = await deps.visualRegistry(); } catch { return; }
    visualRegistry = payload || null;
    if (visualEditor && visualRegistry) visualEditor.setRegistry(visualRegistry);
    render();
  }

  // 스펙 한 벌마다 한 번만 그래프를 받는다(yaml이 열쇠다). 라우트가 없는 백엔드(404)를
  // 만나면 여기서 한 번 접고 다시 묻지 않는다 — 지도 탭은 읽기 전용으로 물러난다.
  async function ensureVisualGraph() {
    if (!visualWired() || visualUnavailable || !isSpecPath()) return;
    const yaml = currentYaml();
    if (visualGraphYaml === yaml) return;
    visualGraphYaml = yaml;
    let res;
    try { res = await deps.visualFromSpec({ yaml }); }
    catch (err) {
      visualUnavailable = true;
      visualGraph = null;
      setState({
        visualNotice: '시각 설계를 열 수 없어 읽기 전용 지도로 돌아갑니다'
          + ` — ${String((err && err.message) || err)}`,
      });
      return;
    }
    visualGraph = (res && res.graph) || null;
    visualHashes = (res && res.hashes) || null;
    visualDiagnostics = [];
    visualCompiled = null;
    visualPreview = null;
    visualState = 'unvalidated';
    visualSummary = '';
    if (visualEditor && visualGraph) {
      visualEditor.setGraph(visualGraph);
      visualEditor.setDiagnostics([]);
    }
    void ensureVisualRegistry();
    setState({ visualNotice: null });
  }

  function ensureVisualEditor() {
    if (visualEditor) return visualEditor;
    if (!visualGraph) return null;
    visualHost = el('div', 'backtest-visual-host');
    visualEditor = VisualEditor.createVisualEditor(visualHost, {
      registry: visualRegistry,
      graph: visualGraph,
      diagnostics: visualDiagnostics,
      validation: { state: visualState === 'validating' ? 'unvalidated' : visualState, summary_ko: visualSummary },
      setTimeoutImpl,
      clearTimeoutImpl,
      onChange: onVisualChange,
      onOpenCode: (nodeId) => { void openCodeAt(nodeId); },
      onAskChat: (nodeId) => { void askVisualQuestion(nodeId); },
      onValidate: () => { void runVisualValidate(); },
      // "생성될 StrategySpec 보기"는 폼 탭이다 — 같은 값을 두 곳에서 그리지 않는다.
      onShowSpec: () => { setState({ designTab: 'form' }); },
    });
    return visualEditor;
  }

  function onVisualChange(graph) {
    if (visualSyncing) return;
    visualGraph = graph;
    // 앞선 컴파일 산출물은 이 그래프의 것이 아니다 — 두면 코드 열기가 남의 줄을 연다.
    visualCompiled = null;
    setVisualState('validating');
    if (visualTimer != null && clearTimeoutImpl) clearTimeoutImpl(visualTimer);
    visualTimer = null;
    if (!setTimeoutImpl) { void runVisualValidate(); return; }
    visualTimer = setTimeoutImpl(() => {
      visualTimer = null;
      void runVisualValidate();
    }, VISUAL_DEBOUNCE_MS);
    render();
  }

  async function runVisualValidate() {
    if (!deps.visualValidate || !visualGraph) return null;
    setVisualState('validating');
    render();
    let res;
    try { res = await deps.visualValidate({ graph: visualGraph }); }
    catch (err) {
      const message = String((err && err.message) || err);
      setVisualState('invalid', message);
      setState({ visualNotice: message });
      return null;
    }
    visualDiagnostics = (res && Array.isArray(res.diagnostics)) ? res.diagnostics : [];
    if (res && res.hashes) visualHashes = res.hashes;
    if (visualEditor) visualEditor.setDiagnostics(visualDiagnostics);
    if (res && res.valid) {
      visualPreview = null;
      setVisualState('valid');
      await runVisualCompile();
      return res;
    }
    visualPreview = (res && res.preview)
      ? { source: String(res.preview.source || ''), source_map: res.source_map || null }
      : null;
    visualCompiled = null;
    setVisualState('invalid');
    // 첫 오류는 지도 아래 "실행 전에 채울 것" 줄에도 남는다 — 폼만 보는 사람에게도 보여야
    // 한다(기존 lastError 경로는 그대로다: 그것은 실행이 멈춘 사실이고 이건 설계의 사실이다).
    const first = visualDiagnostics.find((d) => d.severity === 'error') || visualDiagnostics[0];
    setState({ formErrors: first ? [first.message_ko || first.code] : [] });
    return res;
  }

  async function runVisualCompile() {
    if (!deps.visualCompile || !visualGraph) return null;
    let res;
    try { res = await deps.visualCompile({ graph: visualGraph }); }
    catch (err) {
      setVisualState('invalid', String((err && err.message) || err));
      render();
      return null;
    }
    visualCompiled = {
      spec_yaml: String((res && res.spec_yaml) || ''),
      source: String((res && res.source) || ''),
      source_map: (res && res.source_map) || null,
      hashes: (res && res.hashes) || null,
    };
    if (visualCompiled.hashes) visualHashes = visualCompiled.hashes;
    // 폼이 지도를 따라온다 — 사람이 폼 탭으로 가면 그래프가 만든 값이 거기 있어야 한다.
    if (visualCompiled.spec_yaml) adoptSpecYaml(visualCompiled.spec_yaml);
    setVisualState('synced');
    setState({ formErrors: [], visualNotice: null });
    return visualCompiled;
  }

  // 컴파일된 spec_yaml을 폼 스펙으로 옮긴다. 대상(종목·기간·수정주가·비용)은 그래프가
  // 모르는 값이라 지금 폼의 것을 그대로 지킨다(keptTarget과 같은 규칙).
  function adoptSpecYaml(yamlText) {
    const overrides = specOverridesFromYaml(yamlText);
    if (!overrides) return;
    const kept = keptTarget();
    const next = {
      presetId: overrides.presetId || (spec ? spec.presetId : null),
      name: overrides.name || (spec ? spec.name : '시각 전략'),
      params: overrides.params,
      indicators: overrides.indicators,
      entry: overrides.entry,
      exit: overrides.exit,
    };
    if (overrides.risk) next.risk = overrides.risk;
    else if (spec) next.risk = spec.risk;
    if (spec) { next.adjusted = spec.adjusted; next.costs = spec.costs; }
    visualSyncing = true;
    spec = SpecModel.createSpec(null, Object.assign(next, kept));
    // 폼이 그래프를 따라온 것이므로 이 yaml은 이미 그 그래프의 것이다 — 열쇠를 옮겨 두지
    // 않으면 다음 render()가 같은 그래프를 다시 만들어 사람이 고친 편집을 덮는다.
    visualGraphYaml = currentYaml();
    visualSyncing = false;
  }

  // ── 보드 13 · 노드에서 코드로 ─────────────────────────────────────────────
  //
  // 무엇을 여는가는 지금 검증 상태가 정한다: valid|synced면 컴파일이 만든 authoritative
  // 산출물, 아니면 검증이 준 **미실행** preview다. 어느 쪽이든 spanIsValid()로 지금 코드가
  // 그 map에서 나온 것인지 먼저 확인한다 — 어긋나면 비슷한 줄을 추정하지 않고 그 자리에
  // 알리고 멈춘다(엉뚱한 줄을 원인이라고 말하는 것이 가장 나쁜 실패다).
  function noticeOnCode(text) {
    if (editorHandle && typeof editorHandle.showNotice === 'function') editorHandle.showNotice(text);
  }

  function refuseCodeJump(text) {
    setState({ visualNotice: text });
    noticeOnCode(text);
    return false;
  }

  async function openCodeAt(nodeId) {
    const authoritative = (visualState === 'valid' || visualState === 'synced') && !!visualCompiled;
    const kind = authoritative ? 'authoritative' : 'preview';
    const raw = authoritative
      ? visualCompiled.source_map
      : (visualPreview && visualPreview.source_map);
    if (!raw) return refuseCodeJump(CodeEditor.STALE_NOTICE_TEXT);
    const bundle = Object.assign({}, raw, { kind });
    const source = authoritative ? visualCompiled.source : String(visualPreview.source || '');

    // 사람이 손으로 고친 초안은 절대 덮지 않는다 — 그때는 코드가 지도보다 앞선 것이고,
    // 그 사실을 말하는 것이 옳다(덮으면 사람이 친 것이 조용히 사라진다).
    if (codeSource && codeSource !== lastGeneratedSource) {
      setState({ visualCodeAhead: true });
      return refuseCodeJump(CodeEditor.STALE_NOTICE_TEXT);
    }
    const check = await CodeEditor.spanIsValid(bundle, source);
    if (!check.ok) return refuseCodeJump(CodeEditor.STALE_NOTICE_TEXT);

    const entries = Array.isArray(bundle.entries) ? bundle.entries : [];
    const entry = entries.find((e) => e.node_id === nodeId) || entries[0];
    if (!entry || !entry.source_span) return refuseCodeJump(CodeEditor.STALE_NOTICE_TEXT);

    const node = visualNodeById(entry.node_id);
    const diag = visualDiagnostics.find((d) => d.node_id === entry.node_id) || null;
    codeSource = source;
    lastGeneratedSource = source;
    setState({
      view: 'design',
      tab: 'design',
      designTab: 'code',
      codeFromMap: true,
      visualCodeAhead: false,
      visualNotice: null,
      codeSpan: {
        span: entry.source_span,
        kind,
        nodeId: entry.node_id || null,
        label: (node && (node.label || node.kind)) || entry.node_id || null,
        code: diag ? diag.code : null,
        file: (entry.source_span && entry.source_span.file) || codeFileLabel(),
        reason_ko: check.reason_ko,
      },
    });
    return true;
  }

  // 열어둔 노드 연결을 편집기가 다시 만들어질 때마다 되건다 — render()가 편집기를 새로
  // 만들기 때문에, 한 번만 부르면 다음 그리기에서 리본과 표식이 조용히 사라진다.
  function applyCodeSpan() {
    const info = state.codeSpan;
    if (!info || !editorHandle) return;
    const preview = info.kind === 'preview';
    editorHandle.setFileMeta({
      name: info.file,
      generatedFromGraph: true,
      compatMode: preview,
    });
    editorHandle.setPreviewOnly(preview, preview ? { reason_ko: info.reason_ko } : null);
    editorHandle.openSpan(info.span, {
      kind: info.kind,
      node: { id: info.nodeId, label: info.label },
      code: info.code,
      file: info.file,
    });
    editorHandle.setLinkStatus({ linked: !preview });
  }

  // 코드 리본의 [시각 설계에서 보기] — 온 자리로 정확히 돌아간다.
  function backToVisualNode(nodeId) {
    const id = nodeId || (state.codeSpan && state.codeSpan.nodeId);
    setState({ designTab: 'flow', codeFromMap: false });
    if (id && visualEditor) {
      visualEditor.select(id);
      visualEditor.focusNode(id);
    }
  }

  // ── US-009 · 대화형 오류 수정(질문 → 비활성 수정안 → 적용 → 동기화) ────────
  //
  // 아래 함수들은 chat.js의 카드 버튼이 부르는 자리다. 어느 것도 실행·백필·활성화·배포를
  // 부르지 않는다 — 저장(origin visual)까지가 끝이고, 그 버전이 켜지지 않는다는 것은
  // 서버가 강제한다.
  //
  // **영수증이 채팅에 닿는 길.** 지금은 하나뿐이다: main이 보낸 액션에 onChatAction이
  // 돌려주는 값(chat.js의 'athena:backtest-chat-action' 구독). 카드 버튼에서 시작한 왕복은
  // 그 길이 없어서 문서 이벤트로 한 번 더 낸다 — chat.js가 'athena:backtest-receipt'를
  // 듣게 되면 그대로 카드가 되고, 아직 안 듣더라도 반환값 경로는 그대로 산다.
  function emitChatCard(receipt) {
    try {
      if (typeof document !== 'undefined'
        && typeof document.dispatchEvent === 'function'
        && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('athena:backtest-receipt', { detail: receipt }));
      }
    } catch { /* CustomEvent가 없는 하네스 */ }
    return receipt;
  }

  // 모델이 낸 질문·수정안은 화면을 바꾸지 않는다 — 대기 상태로 세워두고 카드만 만든다.
  function visualQuestionAction(envelope) {
    const question = envelope.question || envelope.payload || null;
    if (!question || typeof question !== 'object') return null;
    pendingQuestion = question;
    return remember(makeReceipt('visual_question', {
      note: envelopeNote(envelope), question,
    }));
  }

  function visualPatchAction(envelope) {
    const patch = envelope.patch || envelope.payload || null;
    if (!patch || typeof patch !== 'object') return null;
    pendingPatch = patch;
    return remember(makeReceipt('visual_patch', {
      note: envelopeNote(envelope), patch, version: bumpMapVersion(),
    }));
  }

  // patch가 서명할 base — 409 뒤 [다시 검토]가 서버에서 다시 읽어 갈아 끼운다(US-010).
  // visualBase가 비어 있으면 지금까지처럼 화면이 들고 있는 값이 base다.
  function visualBaseHash() {
    return String((visualBase && visualBase.graph_hash)
      || (visualHashes && visualHashes.graph_hash) || '');
  }

  function baseVersionId() {
    return String((visualBase && visualBase.version_id) || activeVersionId || '');
  }

  function baseArtifactHash() {
    return String((visualBase && visualBase.artifact_hash)
      || (visualCompiled && visualCompiled.hashes && visualCompiled.hashes.artifact_hash)
      || (visualHashes && visualHashes.artifact_hash) || '');
  }

  // 409는 "그 사이 세상이 바뀌었다"는 사실이다 — 다시 묻기 전에 서버의 머리를 다시
  // 읽지 않으면 다음 수정안도 같은 옛 base로 서명돼 같은 409를 다시 받는다(연구 문서
  // §주요 리스크와 방어선 — base version/hash optimistic concurrency).
  async function refreshVisualBase() {
    if (!strategyId || !deps.versions) return null;
    let list;
    try { list = await deps.versions(strategyId); } catch { return null; }
    const head = (Array.isArray(list) ? list : []).reduce(
      (best, v) => (best && Number(best.version) >= Number(v.version) ? best : v), null,
    );
    if (!head || !head.id) return null;
    const base = { version_id: head.id, graph_hash: null, artifact_hash: null };
    if (deps.versionDetail) {
      // 해시를 못 읽어도 버전 id는 갱신한다 — 절반이라도 새 base가 옛 base보다 낫다.
      try {
        const detail = await deps.versionDetail(strategyId, head.id);
        const hashes = (detail && detail.hashes) || null;
        if (hashes) {
          base.graph_hash = hashes.graph_hash || null;
          base.artifact_hash = hashes.artifact_hash || null;
        }
      } catch { /* 위 주석 그대로 */ }
    }
    visualBase = base;
    return base;
  }

  // 지금 그래프에서 막고 있는 오류 하나를 서버에 물어 카드로 낸다(검사기의 [대화로 수정]).
  async function askVisualQuestion() {
    if (!deps.visualQuestion || !visualGraph) return null;
    let data;
    try { data = await deps.visualQuestion({ graph: visualGraph, diagnostics: visualDiagnostics }); }
    catch (err) { setState({ visualNotice: String((err && err.message) || err) }); return null; }
    const question = data && data.question;
    if (!question) { pendingQuestion = null; return null; }
    pendingQuestion = question;
    return emitChatCard(remember(makeReceipt('visual_question', { question })));
  }

  // 카드에서 선택지를 고른 순간 — 비활성 수정안 하나를 만든다. 적용은 아직이다.
  async function answerVisualQuestion(intent) {
    const payload = intent || {};
    if (!deps.visualPatch || !visualGraph) return null;
    let data;
    try {
      data = await deps.visualPatch({
        graph: visualGraph,
        base_graph_hash: visualBaseHash(),
        base_version_id: baseVersionId() || null,
        intent: { code: payload.code, choice_id: payload.choice_id },
      });
    } catch (err) {
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: [String((err && err.message) || err)],
      })));
    }
    pendingQuestion = null;
    pendingPatch = data || null;
    return emitChatCard(remember(makeReceipt('visual_patch', {
      patch: data, version: bumpMapVersion(),
    })));
  }

  // 저장할 전략이 아직 없으면 먼저 만든다 — 코드 탭의 [이 코드로 저장]과 같은 경로다.
  async function ensureStrategyId(source) {
    if (strategyId) return strategyId;
    if (!deps.createStrategy) return null;
    const created = await deps.createStrategy({
      name: spec ? spec.name : '시각 전략', kind: 'python', source,
    });
    strategyId = created && created.strategy_id;
    if (created && created.version_id) activeVersionId = created.version_id;
    return strategyId;
  }

  // 사람이 [적용]을 누른 그 순간 — 그래프에 얹고, 검증·컴파일하고, 새 버전으로 저장한다.
  // 활성화하지 않는다. 실행하지 않는다. 그 둘은 여전히 별도의 버튼이다.
  async function applyVisualPatch(patchId) {
    const patch = pendingPatch;
    if (!patch) return null;
    if (patchId && patch.patch_id && patch.patch_id !== patchId) return null;
    const baseArtifact = baseArtifactHash();
    const from = state.mapVersion || 0;

    visualSyncing = true;
    visualGraph = patch.graph_after || visualGraph;
    if (visualEditor && visualGraph) visualEditor.setGraph(visualGraph);
    visualSyncing = false;
    visualHashes = Object.assign({}, visualHashes, { graph_hash: patch.graph_after_hash });
    visualCompiled = null;

    await runVisualValidate();
    if (visualState !== 'synced' || !visualCompiled) {
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: ['수정안을 적용한 그래프가 아직 유효하지 않습니다'],
      })));
    }
    if (!deps.visualSave) {
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: ['이 화면에는 시각 버전 저장 배선이 없습니다'],
      })));
    }
    let id;
    try { id = await ensureStrategyId(visualCompiled.source); }
    catch (err) {
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: [String((err && err.message) || err)],
      })));
    }
    if (!id) {
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: ['전략을 먼저 저장해야 합니다'],
      })));
    }
    let saved;
    try {
      saved = await deps.visualSave({
        strategy_id: id,
        origin: 'visual',
        yaml: visualCompiled.spec_yaml,
        source: visualCompiled.source,
        note: patch.summary_ko || null,
        bundle: {
          graph: visualGraph,
          spec_yaml: visualCompiled.spec_yaml,
          source_map: visualCompiled.source_map,
          hashes: visualCompiled.hashes,
          compiler_version: (visualCompiled.hashes && visualCompiled.hashes.compiler_version) || null,
        },
        apply_receipt: {
          base_version_id: String(patch.base_version_id || baseVersionId()),
          base_graph_hash: String(patch.base_graph_hash || ''),
          base_artifact_hash: baseArtifact,
          patch_id: String(patch.patch_id || ''),
          patch_hash: String(patch.patch_hash || ''),
          applied_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      // 409는 실패가 아니라 "그 사이 다른 수정이 먼저 저장됐다"는 사실이다 — 다시 검토로
      // 돌려보낸다(retryVisualPatch가 그 자리다).
      //
      // **여기서 아무것도 버리지 않는다**(US-010). 얹어둔 그래프도, 대기 중인 수정안도
      // 그대로 둔다: 저장이 거절된 것이지 사람이 검토한 수정이 틀린 것이 아니고, 버리면
      // 사용자는 같은 대화를 처음부터 다시 해야 한다. 무엇을 갈아 끼워야 하는지는 base
      // 하나뿐이고 그것은 [다시 검토]가 서버에서 다시 읽는다(refreshVisualBase).
      if (err && err.status === 409) {
        return emitChatCard(remember(makeReceipt('visual_conflict', {
          errors: [String(err.message || err)],
          patch,
          canRetry: true,
        })));
      }
      return emitChatCard(remember(makeReceipt('visual_conflict', {
        errors: [String((err && err.message) || err)],
      })));
    }
    pendingPatch = null;
    lastGeneratedSource = visualCompiled.source;
    const to = (saved && saved.version != null) ? saved.version : from + 1;
    if (saved && saved.version_id) activeVersionId = saved.version_id;
    setState({ mapVersion: to, designTab: 'flow', view: 'design', tab: 'design' });
    return emitChatCard(remember(makeReceipt('visual_synced', {
      applied: true,
      version: { from, to },
      summary_ko: patch.summary_ko || null,
      spec_diff: patch.spec_diff || null,
      tab: state.tab,
      designTab: state.designTab,
    })));
  }

  function discardVisualPatch(patchId) {
    if (patchId && pendingPatch && pendingPatch.patch_id && pendingPatch.patch_id !== patchId) {
      return { ok: false, reason: '다른 수정안입니다' };
    }
    pendingPatch = null;
    return { ok: true };
  }

  // [실행 전 검토] — 실행하지 않는다. 사람이 지도를 다시 보는 자리로 옮길 뿐이다.
  function reviewBeforeRun() {
    setState({
      view: 'design', tab: 'design', designTab: 'flow', visualNotice: '실행 전 검토',
    });
    return { ok: true };
  }

  // 방금 패치가 건드린 첫 노드. graph_patch는 RFC 6902라 node_id를 직접 싣지 않는다
  // (visual_repair._ops_to_patch는 {op, path, value}만 낸다) — path와 value에서 읽고,
  // 못 읽으면 질문이 가리킨 노드, 그것도 없으면 지금 고른 노드다. 지어내지 않는다.
  function patchedNodeId() {
    const patch = pendingPatch;
    const ops = (patch && Array.isArray(patch.graph_patch)) ? patch.graph_patch : [];
    const nodes = (visualGraph && Array.isArray(visualGraph.nodes)) ? visualGraph.nodes : [];
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i] || {};
      const value = op.value || {};
      if (value.to && value.to.node_id) return value.to.node_id;
      if (value.id && String(op.path) === '/nodes/-') return value.id;
      // '/nodes/3/params/period' → 3번 노드. 정규식 없이 자른다(경로 문법이 고정이다).
      const path = String(op.path || '');
      if (path.indexOf('/nodes/') === 0) {
        const index = Number(path.slice('/nodes/'.length).split('/')[0]);
        if (nodes[index]) return nodes[index].id;
      }
    }
    if (pendingQuestion && pendingQuestion.node_id) return pendingQuestion.node_id;
    return visualEditor ? visualEditor.getSelected() : null;
  }

  // [코드 열기] — 그 노드의 줄로 간다. 못 찾으면 map의 첫 칸이다(openCodeAt이 정한다).
  function openCodeFromChat() {
    return openCodeAt(patchedNodeId());
  }

  // [다시 검토] — **최신 base를 다시 읽고** 나서 지금 그래프를 다시 검증하고, 막고 있는
  // 오류를 다시 하나 묻는다. base를 먼저 읽는 이유는 위 refreshVisualBase 머리말 그대로다.
  async function retryVisualPatch() {
    pendingPatch = null;
    await refreshVisualBase();
    await runVisualValidate();
    return askVisualQuestion();
  }

  // ── 모드 워크스페이스(session-workspace.js) ───────────────────────────────
  // 배선이 없는 하네스에서도 죽지 않는다 — 전역이 없으면 조용히 넘어간다.
  function workspaceApi() {
    return (typeof window !== 'undefined' && window.AthenaSessionWorkspace) || null;
  }

  function registerWorkspace() {
    const ws = workspaceApi();
    if (!ws || typeof ws.register !== 'function') return;
    try { ws.register('backtest', { restore: restoreWorkspace }); }
    catch { /* 등록 실패는 복원이 없다는 뜻일 뿐, 화면은 그대로 돈다 */ }
  }

  function reportWorkspace() {
    const ws = workspaceApi();
    if (!ws || typeof ws.report !== 'function') return;
    try {
      ws.report({
        form: spec ? { yaml: currentYaml() } : null,
        designTab: state.designTab,
        tab: state.tab,
        graph: visualGraph,
      });
    } catch { /* 보고는 부수 효과다 — 실패해도 화면은 계속 돈다 */ }
  }

  function restoreWorkspace(workspace) {
    const saved = workspace || {};
    const form = saved.form || {};
    if (typeof form.yaml === 'string' && form.yaml.trim()) adoptSpecYaml(form.yaml);
    if (saved.graph && typeof saved.graph === 'object') {
      visualGraph = saved.graph;
      if (visualEditor) visualEditor.setGraph(visualGraph);
    }
    const patch = { view: 'design' };
    if (MODE_TABS.some(([key]) => key === saved.tab)) patch.tab = saved.tab;
    if (DESIGN_TABS.some(([key]) => key === saved.designTab)) patch.designTab = saved.designTab;
    setState(patch);
    return true;
  }

  // ── 시각 설계 그리기 ──────────────────────────────────────────────────────

  function renderVisualStatus() {
    const box = el('div', 'backtest-visual-status');
    const text = VISUAL_STATUS_TEXT[visualState];
    if (text) {
      box.appendChild(el('span', `backtest-visual-dot is-${visualState}`, ''));
      box.appendChild(el('span', 'backtest-visual-status-text', text));
    }
    return box;
  }

  // 대상 한 줄 — 무엇을 돌리는지는 그래프가 모른다(종목·기간은 폼이 정한다). 지도가
  // 편집 가능해져도 이 줄은 그대로 맨 위에 남는다(보드 11 상단).
  function renderVisualTarget() {
    const line = el('div', 'backtest-visual-target');
    const target = mapTarget();
    if (!target) {
      line.textContent = '대상 미정 — 폼에서 종목과 기간을 채우세요';
      return line;
    }
    const period = (SpecModel.PERIODS.find(([id]) => id === target.period) || [])[1]
      || target.period;
    const span = target.from && target.to ? ` · ${target.from} ~ ${target.to}` : '';
    line.textContent = `${target.symbol} · ${period}봉 · ${target.adjusted ? '수정주가' : '원주가'}${span}`;
    return line;
  }

  // 코드 서랍(보드 14-E) — 지도 뒤의 코드로 가는 한 줄. 지도가 편집 가능해져도 이 줄의
  // 뜻은 같다: 코드는 최후의 보루이고, 여기서 열면 그 노드의 줄로 간다.
  function renderVisualDrawer() {
    const drawer = el('div', 'backtest-visual-drawer');
    drawer.appendChild(el('span', 'backtest-visual-drawer-file', codeFileLabel()));
    if (state.visualCodeAhead) {
      drawer.appendChild(el('span', 'backtest-visual-drawer-ahead', VISUAL_CODE_AHEAD));
    } else if (visualState === 'synced') {
      drawer.appendChild(el(
        'span', 'backtest-visual-drawer-match', `지도 v${state.mapVersion || 0}와 일치`,
      ));
    }
    drawer.appendChild(button('backtest-visual-open-code', '코드 열기', () => {
      void openCodeAt(visualEditor ? visualEditor.getSelected() : null);
    }));
    return drawer;
  }

  function renderVisualDesign() {
    const wrap = el('div', 'backtest-visual');
    wrap.appendChild(renderVisualTarget());
    const head = el('div', 'backtest-visual-head');
    head.appendChild(el(
      'div', 'backtest-card-title', `이 전략은 이렇게 흐릅니다 · 지도 v${state.mapVersion || 0}`,
    ));
    head.appendChild(renderVisualStatus());
    wrap.appendChild(head);
    // 칸 ①~④가 먼저, 노드·연결 편집기는 그 아래(보드 15 위에 보드 11).
    wrap.appendChild(renderSummaryMap(false));
    if (ensureVisualEditor()) wrap.appendChild(visualHost);
    if (state.visualNotice) {
      wrap.appendChild(el('div', 'backtest-flow-notice', state.visualNotice));
    }
    wrap.appendChild(renderVisualDrawer());
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

  // 오류가 붙은 칸이 있으면 진단 제목이 그 번호로 시작한다(보드 12) — "23번째 줄에서
  // KeyError"는 무엇을 고칠지 말하지 않지만 "② 가격을 지표로 바꿉니다"는 말한다.
  function diagnosisWithNode() {
    if (!state.diagnosis) return state.diagnosis;
    const nodes = (state.map && state.map.nodes) || [];
    const hit = nodes.find((node) => node.status === 'error');
    if (!hit) return state.diagnosis;
    return Object.assign({}, state.diagnosis, {
      title: `${hit.numeral} ${hit.title} — ${state.diagnosis.title || ''}`.trim(),
    });
  }

  function renderDiagnosisPanel() {
    const wrap = el('div', 'backtest-diagnosis');
    Explain.renderDiagnosis(wrap, diagnosisWithNode(), {
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
    // 같은 폼으로 폼 경로와 코드 경로가 다른 숫자를 낼 수 있다 — 무엇이 돌았는지 남긴다.
    const runPathValue = (state.result.metrics && state.result.metrics.run_path) === 'code'
      ? '코드 경로' : '폼 경로';
    wrap.appendChild(el('div', 'backtest-result-runpath', runPathValue));
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
        // 매수보유 곡선은 실행 결과가 들고 온다(GET /runs/{id}의 top-level benchmark) —
        // 첫 종가 대비 배수라 차트가 한 번 더 정규화해도 값이 그대로다.
        closes: (state.result && state.result.benchmark) || [],
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
    // 저장된 버전은 실행과 다른 축이다 — 되열기가 있는 쪽이 여기다(US-010).
    wrap.appendChild(renderVersionList());

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

  // 저장된 버전 목록 — 한 줄을 누르면 그 버전을 **읽기 전용**으로 다시 연다(US-010).
  // origin을 그대로 적는 이유: visual과 code_only는 여는 자리가 다르고(지도·코드),
  // 그 차이를 사람이 누르기 전에 알아야 한다.
  function renderVersionList() {
    const list = Array.isArray(state.versions) ? state.versions : [];
    const wrap = el('div', 'backtest-version-list');
    wrap.appendChild(el(
      'div', 'backtest-card-title', `저장된 버전 ${formatNumeric(list.length)}개`,
    ));
    if (!list.length) {
      wrap.appendChild(el('div', 'backtest-card-empty', '아직 저장한 버전이 없습니다'));
    }
    list.forEach((entry) => {
      const isOn = !!(openedVersion && openedVersion.id === entry.id);
      const row = button(
        `backtest-version-row${isOn ? ' is-on' : ''}`, null,
        () => { void openVersion(entry); },
      );
      row.setAttribute('aria-pressed', String(isOn));
      row.appendChild(el('span', 'backtest-version-no', `v${entry.version}`));
      row.appendChild(el('span', `backtest-version-origin is-${entry.origin}`, entry.origin));
      row.appendChild(el('span', 'backtest-version-note', entry.note || ''));
      if (entry.active) row.appendChild(el('span', 'backtest-version-active', '활성'));
      wrap.appendChild(row);
    });
    if (state.historyError) {
      wrap.appendChild(el('div', 'backtest-design-error-line', state.historyError));
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
    OPTIMIZE_METHODS.forEach(([value, label]) => {
      const isOn = (state.optimizeMethod || 'grid') === value;
      const seg = button(`backtest-segment-item${isOn ? ' is-on' : ''}`, label, () => {
        setState({ optimizeMethod: value });
      });
      seg.setAttribute('aria-pressed', String(isOn));
      methods.appendChild(seg);
    });
    wrap.appendChild(methods);

    // 채팅이 제안한 설정이면 버튼을 켜두되 누르지는 않는다 — 탐색을 시작하는 것은 사람이다.
    const suggested = state.optimizeSuggested;
    wrap.appendChild(button(
      `backtest-optimize-start${suggested ? ' is-suggested' : ''}`,
      state.optimizeBusy ? '탐색 중…' : '탐색 시작',
      () => {
        if (suggested) setState({ optimizeSuggested: null });
        if (!state.optimizeBusy) void runOptimize();
      },
    ));
    if (suggested) {
      wrap.appendChild(el(
        'div', 'backtest-optimize-suggested',
        typeof suggested === 'string' ? suggested : '채팅이 이 설정으로 탐색을 제안했습니다',
      ));
    }

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
        '먼저 코드를 한 번 실행하거나 코드 탭에서 저장해야 배포할 수 있습니다 — 배포는 저장된 버전에 묶입니다',
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
    // 모드 워크스페이스는 화면이 서기 전에 등록한다 — 복원이 프리셋보다 먼저 올 수 있다.
    registerWorkspace();
    void loadPresets();
  }

  function refresh() {
    if (!mounted) { mount(); return; }
    if (state.view === 'empty' || state.view === 'error') { void loadPresets(); return; }
    // 등록부는 이 화면 밖에서도 바뀐다 — 대화가 register_strategy로 등록하면 캔버스에는
    // 아무 액션도 오지 않는다. 모드에 들어올 때마다 다시 읽지 않으면 앱을 껐다 켜기
    // 전까지 "대화로 등록 → 프리셋과 같은 자리"가 화면에 아예 나타나지 않는다.
    void loadUserStrategies();
    render();
    resumePollingIfNeeded();
  }

  return {
    mount,
    refresh,
    getContext,
    onChatAction,
    undoChatAction,
    applyFileDraft,
    discardFileDraft,
    runFromChat,
    validateFromChat,
    startOptimizeFromChat,
    // 시각 설계 카드(US-009)가 부르는 자리 — 실행·활성화·배포는 여기 없다.
    answerVisualQuestion,
    applyVisualPatch,
    discardVisualPatch,
    reviewBeforeRun,
    openCodeFromChat,
    retryVisualPatch,
  };
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
  changedNodeIds,
  parseYamlBlock,
  specOverridesFromYaml,
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
