'use strict';

const MODES = Object.freeze([
  { view: 'summary', navId: 'modeNavSummary', canvasId: 'mosaic', label: '대화' },
  { view: 'graph', navId: 'modeNavGraph', canvasId: 'graphCanvas', label: '그래프' },
  { view: 'agent', navId: 'modeNavAgent', canvasId: 'agentCanvas', label: '에이전트' },
  { view: 'plugin', navId: 'modeNavPlugin', canvasId: 'pluginCanvas', label: '플러그인' },
  { view: 'backtest', navId: 'modeNavBacktest', canvasId: 'backtestCanvas', label: '백테스트' },
]);

const SETTINGS_NAV = Object.freeze([
  { key: 'screen', label: '화면' },
  { key: 'accounts', label: '계좌' },
  { key: 'model', label: '모델' },
  { key: 'history', label: '성향・이력' },
]);

const PAPER_CHROME = Object.freeze({
  summary: { headerHidden: true, emptyHistory: '새 대화' },
  graph: { headerHidden: false, title: '그래프에게 묻기', sub: '답이 캔버스를 바꿉니다' },
  agent: { headerHidden: true },
  plugin: { headerHidden: false, title: '아테나 · 플러그인 대화', sub: '설치와 권한을 여기서 정합니다' },
  backtest: {
    headerHidden: false,
    title: '기법에게 묻기',
    sub: '고른 기법을 다룹니다',
    emptyHistory: '아직 고른 기법이 없습니다',
  },
});

const LOCKED_CLICKS = Object.freeze([
  { id: 'order-submit', reason: '실주문 /api/v1/order/* 금지', match: /매수|매도|정정|취소|주문 확인|주문 전송/ },
  { id: 'kiumi-five-faces', reason: '키우미 다섯 얼굴 복원 금지', match: /kiumi-face-pack|얼굴 다섯/ },
]);

const LIVE_QUERIES = Object.freeze([
  { id: 'QA-QUOTE', question: '삼성전자 시세 보여줘', expectCard: true, expectRest: true, timeoutMs: 12000 },
  { id: 'QA-CHART', question: '삼성전자 일봉 차트 보여줘', expectCard: true, expectRest: true, timeoutMs: 12000 },
  { id: 'QA-ORDERBOOK', question: 'SK하이닉스 호가 보여줘', expectCard: true, expectRest: true, timeoutMs: 12000 },
  { id: 'QA-MULTI-SCREEN', question: '삼성전자 시세랑 호가 보여줘', expectCard: true, expectRest: true, timeoutMs: 12000 },
  { id: 'QA-FIN', question: '삼성전자 재무제표 요약해줘', expectCard: false, expectRest: false, timeoutMs: 20000 },
  { id: 'QA-NEWS', question: '삼성전자 관련 최근 뉴스 알려줘', expectCard: false, expectRest: false, timeoutMs: 20000 },
]);

const SAFE_CLICK_IDS = Object.freeze([
  'modeNavSummary',
  'modeNavGraph',
  'modeNavAgent',
  'modeNavPlugin',
  'modeNavBacktest',
  'sidebarNewChat',
  'sidebarSearchToggle',
  'sidebarCompactToggle',
]);

const VERIFY_SUITE = Object.freeze([
  { script: 'verify:live-full', budgetMs: 180000 },
  { script: 'verify', budgetMs: 180000 },
  { script: 'verify:settings', budgetMs: 90000 },
  { script: 'verify:settings-cards', budgetMs: 120000 },
  { script: 'verify:plugins', budgetMs: 90000 },
  { script: 'verify:kiumi', budgetMs: 90000 },
  { script: 'verify:agent-paper-parity', budgetMs: 90000 },
  { script: 'verify:hoga-live', budgetMs: 90000 },
  { script: 'verify:integrated-cards', budgetMs: 180000 },
  { script: 'verify:semantic-workspaces', budgetMs: 90000 },
  { script: 'verify:life003', budgetMs: 60000 },
]);

module.exports = {
  MODES,
  SETTINGS_NAV,
  PAPER_CHROME,
  LOCKED_CLICKS,
  LIVE_QUERIES,
  SAFE_CLICK_IDS,
  VERIFY_SUITE,
};
