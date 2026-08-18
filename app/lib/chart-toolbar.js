'use strict';

// 차트 카드 툴바(CC-102) — plan/chart-card-control-spec.md §0·§1·§2·§6·§7.
// 카드 헤더 아래 1줄, 좌 주기 탭 / 우 차트모양·보조지표 자리·구분선·수정주가·전체화면.
// 전부 textContent/DOM 노드 — innerHTML 문자열 삽입 금지(CLAUDE.md §6).
//
// 이 모듈은 DOM 뼈대와 사용자 조작 → 콜백 연결만 한다. 실제 차트 재시리즈·
// 재샘플·전체화면 그리드 전환은 chart-card.js가 콜백 안에서 한다(관심사 분리).

// 주기 탭 6개 — 고정 순서(spec §1). value는 chart-resample.js의 period 키와 맞춘다.
const PERIOD_TABS = [
  { value: 'D', label: '일' },
  { value: 'W', label: '주' },
  { value: 'M', label: '월' },
  { value: 'Y', label: '년' },
  { value: 'MIN', label: '분' },
  { value: 'TICK', label: '틱' },
];

const INTERVAL_OPTIONS = {
  MIN: [1, 3, 5, 10, 30],
  TICK: [1, 5, 10],
};

const CHART_FORM_DEFS = [
  { value: 'bar', label: '바', title: 'OHLC 바차트 — 시·고·저·종(원본 OHLC)' },
  { value: 'candle', label: '캔들', title: '캔들스틱 — 양봉 빨강·음봉 파랑(원본 OHLC)' },
  { value: 'line', label: '라인', title: '라인 — 종가만 잇는 선' },
  { value: 'area', label: '영역', title: '영역 — 종가선 아래를 채운 면적 차트' },
];

function intervalLabel(period, interval) {
  return period === 'TICK' ? `${interval}틱` : `${interval}분`;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

function iconButton(className, text, ariaLabel, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.setAttribute('aria-label', ariaLabel);
  if (title) b.title = title;
  return b;
}

// 클릭 밖 영역·Escape로 닫히는 작은 드롭다운 패널. anchorBtn 아래에 붙인다.
// items: [{value, label, title?}]. onSelect(value)를 부르고 스스로 닫는다.
function openDropdown(anchorBtn, items, onSelect, activeValue) {
  closeAnyOpenDropdown();
  const panel = el('div', 'chart-toolbar-dropdown');
  panel.setAttribute('role', 'listbox');
  for (const it of items) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = `chart-toolbar-dropdown-item${it.value === activeValue ? ' is-active' : ''}`;
    opt.textContent = it.label;
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', String(it.value === activeValue));
    if (it.title) opt.title = it.title;
    opt.addEventListener('click', () => {
      onSelect(it.value);
      closeAnyOpenDropdown();
    });
    panel.appendChild(opt);
  }
  anchorBtn.parentElement.appendChild(panel);
  anchorBtn.setAttribute('aria-expanded', 'true');

  const onOutside = (e) => {
    if (panel.contains(e.target) || anchorBtn.contains(e.target)) return;
    closeAnyOpenDropdown();
  };
  const onEscape = (e) => {
    if (e.key === 'Escape') closeAnyOpenDropdown();
  };
  // capture:true — 카드 스크롤·다른 버튼 클릭보다 먼저 판단해 즉시 닫는다.
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onEscape, true);

  openDropdownState = {
    panel,
    anchorBtn,
    cleanup: () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onEscape, true);
    },
  };
}

let openDropdownState = null;
function closeAnyOpenDropdown() {
  if (!openDropdownState) return;
  openDropdownState.cleanup();
  openDropdownState.anchorBtn.setAttribute('aria-expanded', 'false');
  openDropdownState.panel.remove();
  openDropdownState = null;
}

// opts.callbacks: { onPeriodChange(period, interval), onFormChange(form),
//   onAdjustedToggle(nextOn), onFullscreenToggle(), onIndicatorButtonClick(anchorBtn) }
// opts.initial: { period, interval, form, adjusted, fullscreen }
// 반환: { element, setFullscreenLabel(isFullscreen) } — 다른 상태는 툴바가
// 스스로 갱신한다(클릭한 사람이 곧 상태를 아는 사람이라 되돌려줄 게 없다).
function createChartToolbar(opts) {
  const o = opts || {};
  const cb = o.callbacks || {};
  const state = {
    period: (o.initial && o.initial.period) || 'D',
    interval: (o.initial && o.initial.interval) || 1,
    form: (o.initial && o.initial.form) || 'candle',
    adjusted: o.initial && o.initial.adjusted != null ? o.initial.adjusted : true,
  };

  const bar = el('div', 'chart-toolbar');

  // ---- 좌: 주기 탭 + 세분 드롭다운 ----
  const left = el('div', 'chart-toolbar-left');
  const tabsWrap = el('div', 'chart-toolbar-tabs');
  tabsWrap.setAttribute('role', 'tablist');
  tabsWrap.setAttribute('aria-label', '주기');
  const tabButtons = {};
  for (const t of PERIOD_TABS) {
    const tb = document.createElement('button');
    tb.type = 'button';
    tb.className = 'chart-toolbar-tab';
    tb.textContent = t.label;
    tb.setAttribute('role', 'tab');
    tb.addEventListener('click', () => selectPeriod(t.value));
    tabButtons[t.value] = tb;
    tabsWrap.appendChild(tb);
  }
  left.appendChild(tabsWrap);

  const intervalBtn = iconButton('chart-toolbar-btn chart-toolbar-interval', '', '세분 선택', '세분');
  intervalBtn.hidden = true;
  intervalBtn.addEventListener('click', () => {
    const opts2 = (INTERVAL_OPTIONS[state.period] || []).map((n) => ({ value: n, label: intervalLabel(state.period, n) }));
    openDropdown(intervalBtn, opts2, (n) => selectInterval(n), state.interval);
  });
  left.appendChild(intervalBtn);

  function refreshTabsUi() {
    for (const t of PERIOD_TABS) {
      tabButtons[t.value].classList.toggle('is-active', t.value === state.period);
      tabButtons[t.value].setAttribute('aria-selected', String(t.value === state.period));
    }
    const hasInterval = state.period === 'MIN' || state.period === 'TICK';
    intervalBtn.hidden = !hasInterval;
    if (hasInterval) {
      intervalBtn.textContent = `${intervalLabel(state.period, state.interval)} ▾`;
    }
  }

  function selectPeriod(period) {
    state.period = period;
    state.interval = 1;
    refreshTabsUi();
    cb.onPeriodChange && cb.onPeriodChange(state.period, state.interval);
  }
  function selectInterval(n) {
    state.interval = n;
    refreshTabsUi();
    cb.onPeriodChange && cb.onPeriodChange(state.period, state.interval);
  }
  refreshTabsUi();

  // ---- 우: 차트모양 · 보조지표 자리 · 구분선 · 수정주가 · 전체화면 ----
  const right = el('div', 'chart-toolbar-right');

  const formBtn = iconButton('chart-toolbar-btn', '▦ ▾', '차트모양 선택', '차트모양');
  formBtn.addEventListener('click', () => {
    openDropdown(formBtn, CHART_FORM_DEFS, (v) => {
      state.form = v;
      cb.onFormChange && cb.onFormChange(v);
    }, state.form);
  });
  right.appendChild(formBtn);

  // ∿ 보조지표(CC-103) — 2단 패널(토글 리스트 + 설정, spec §3·§4)을 연다.
  // 패널 자체는 chart-indicator-panel.js가 만든다 — 이 버튼은 열기 신호와
  // 자기 자신(anchorBtn)만 콜백에 넘긴다(패널 배치 기준점이 필요해서다).
  const indicatorBtn = iconButton('chart-toolbar-btn', '∿ ▾', '보조지표 패널', '보조지표 패널 — 상단/하단 지표 토글·설정, 매물대');
  indicatorBtn.setAttribute('aria-expanded', 'false');
  indicatorBtn.addEventListener('click', () => {
    cb.onIndicatorButtonClick && cb.onIndicatorButtonClick(indicatorBtn);
  });
  right.appendChild(indicatorBtn);

  right.appendChild(el('span', 'chart-toolbar-divider'));

  const adjustedBtn = document.createElement('button');
  adjustedBtn.type = 'button';
  adjustedBtn.className = 'chart-toolbar-btn chart-toolbar-adjusted';
  adjustedBtn.setAttribute('aria-pressed', String(state.adjusted));
  adjustedBtn.textContent = state.adjusted ? '수정주가' : '원주가';
  adjustedBtn.classList.toggle('is-on', state.adjusted);
  adjustedBtn.addEventListener('click', () => {
    state.adjusted = !state.adjusted;
    adjustedBtn.textContent = state.adjusted ? '수정주가' : '원주가';
    adjustedBtn.classList.toggle('is-on', state.adjusted);
    adjustedBtn.setAttribute('aria-pressed', String(state.adjusted));
    cb.onAdjustedToggle && cb.onAdjustedToggle(state.adjusted);
  });
  right.appendChild(adjustedBtn);

  const fullscreenBtn = iconButton('chart-toolbar-btn chart-toolbar-fullscreen', '⛶', '크게 보기', '크게 보기');
  fullscreenBtn.addEventListener('click', () => {
    cb.onFullscreenToggle && cb.onFullscreenToggle();
  });
  right.appendChild(fullscreenBtn);

  bar.appendChild(left);
  bar.appendChild(right);

  // 전체화면 진입/복귀는 카드 바깥(canvas.js 그리드) 판단이 섞이므로 호출자가
  // 결과를 이 함수로 되돌려 라벨을 맞춘다(⛶ ↔ ✕, spec §7).
  function setFullscreenLabel(isFullscreen) {
    fullscreenBtn.textContent = isFullscreen ? '✕' : '⛶';
    const label = isFullscreen ? '복귀' : '크게 보기';
    fullscreenBtn.title = label;
    fullscreenBtn.setAttribute('aria-label', label);
  }

  function destroy() {
    closeAnyOpenDropdown();
  }

  return { element: bar, setFullscreenLabel, destroy, state };
}

module.exports = { createChartToolbar, PERIOD_TABS, INTERVAL_OPTIONS, CHART_FORM_DEFS, intervalLabel };
