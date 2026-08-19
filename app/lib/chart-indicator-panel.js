// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';

// 보조지표 패널(CC-103) — plan/chart-card-control-spec.md §3·§4.
// ∿▾ 클릭 → 2단 패널: 좌 토글 리스트("상단 지표"/"하단 지표" 섹션, 35종 전수) /
// 우 설정(선택된 지표의 파라미터, 구현 지표만). 맨 아래 별도 행 = 매물대 토글.
// chart-toolbar.js의 openDropdown과 같은 결(클릭 밖·Escape로 닫힘, 카드 안
// 오버레이 — 새 창·새 시트 아님, 두 창 원칙). 전부 textContent/DOM 노드다
// (innerHTML 문자열 삽입 금지, CLAUDE.md §6).
//
// 이 모듈은 DOM/상호작용만 맡는다. 실제 지표 계산·시리즈 재생성은 chart-card.js가
// 콜백 안에서 한다(관심사 분리, chart-toolbar.js와 같은 패턴).

// UMD 헤드(2026-08-18 렌더러 격리) — node --test(CommonJS)면 require, <script>
// 태그 전역 로딩(nodeIntegration:false)이면 window.AthenaLib를 쓴다.
const { INDICATOR_DEFS } = (typeof module !== 'undefined' && module.exports)
  ? require('./chart-indicator-registry')
  : window.AthenaLib.ChartIndicatorRegistry;
const { bindOutsideCloseAndEscape } = (typeof module !== 'undefined' && module.exports)
  ? require('./ui-kit')
  : window.AthenaLib.UiKit;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

// 모듈 전역 싱글턴 — chart-toolbar.js의 openDropdownState와 같은 이유(한 번에
// 하나만 열린다, 다른 카드의 드롭다운/패널과도 배타적으로 닫힌다).
let openPanelState = null;
function closeAnyOpenIndicatorPanel() {
  if (!openPanelState) return;
  openPanelState.cleanup();
  openPanelState.anchorBtn.setAttribute('aria-expanded', 'false');
  if (openPanelState.panel.parentElement) openPanelState.panel.remove();
  openPanelState = null;
}

// opts.initial: { visible: Set<string>(공유 참조 — 패널이 직접 add/delete한다),
//   params: {[id]: {...}}(공유 참조 — 패널이 직접 갱신한다), volumeProfileOn: boolean }
// opts.callbacks: { onToggle(id, on), onParamChange(id, params), onVolumeProfileToggle(on) }
// 반환: { panel, open(anchorBtn), close(), destroy() }
function createIndicatorPanel(opts) {
  const o = opts || {};
  const cb = o.callbacks || {};
  const visible = (o.initial && o.initial.visible) || new Set();
  const params = (o.initial && o.initial.params) || {};
  let volumeProfileOn = !!(o.initial && o.initial.volumeProfileOn);
  let selectedId = 'ma';

  const panel = el('div', 'chart-indicator-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '보조지표 패널');

  const body = el('div', 'chart-indicator-panel-body');
  const left = el('div', 'chart-indicator-panel-left');
  const right = el('div', 'chart-indicator-panel-right');
  body.appendChild(left);
  body.appendChild(right);
  panel.appendChild(body);

  const rowById = {};

  function buildSection(title, section) {
    const items = INDICATOR_DEFS.filter((d) => d.section === section);
    if (!items.length) return;
    left.appendChild(el('div', 'chart-ind-section-title', title));
    for (const def of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chart-ind-row' + (def.implemented ? '' : ' is-unimplemented');
      row.classList.toggle('is-on', visible.has(def.id));
      row.classList.toggle('is-selected', def.id === selectedId);
      row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', String(visible.has(def.id)));
      row.appendChild(el('span', 'chart-ind-check'));
      row.appendChild(el('span', 'chart-ind-label', def.label));
      if (!def.implemented) row.appendChild(el('span', 'chart-ind-badge', '미구현'));
      row.addEventListener('click', () => {
        if (def.implemented) {
          const nowOn = !visible.has(def.id);
          if (nowOn) visible.add(def.id);
          else visible.delete(def.id);
          row.classList.toggle('is-on', nowOn);
          row.setAttribute('aria-checked', String(nowOn));
          cb.onToggle && cb.onToggle(def.id, nowOn);
        }
        selectForSettings(def.id);
      });
      left.appendChild(row);
      rowById[def.id] = row;
    }
  }
  buildSection('상단 지표', 'overlay');
  buildSection('하단 지표', 'pane');

  function selectForSettings(id) {
    selectedId = id;
    for (const rid of Object.keys(rowById)) rowById[rid].classList.toggle('is-selected', rid === id);
    renderSettings();
  }

  function renderSettings() {
    right.textContent = '';
    const def = INDICATOR_DEFS.find((d) => d.id === selectedId);
    if (!def) return;
    right.appendChild(el('div', 'chart-ind-settings-title', def.label));
    if (!def.implemented) {
      right.appendChild(el('div', 'chart-ind-settings-note', '미구현 — 후속 라운드'));
      return;
    }
    if (!params[def.id]) params[def.id] = {};
    for (const p of def.params || []) {
      const row = el('div', 'chart-ind-param-row');
      row.appendChild(el('label', 'chart-ind-param-label', p.label));
      const current = params[def.id][p.key] != null ? params[def.id][p.key] : p.default;
      const input = document.createElement('input');
      input.className = 'chart-ind-param-input';
      if (Array.isArray(current)) {
        input.type = 'text';
        input.value = current.join(',');
        input.addEventListener('change', () => {
          const nums = input.value
            .split(',')
            .map((s) => Number(String(s).trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
          if (!nums.length) return;
          params[def.id] = Object.assign({}, params[def.id], { [p.key]: nums });
          cb.onParamChange && cb.onParamChange(def.id, params[def.id]);
        });
      } else {
        input.type = 'number';
        input.step = p.step || 1;
        input.value = String(current);
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (!Number.isFinite(n)) return;
          params[def.id] = Object.assign({}, params[def.id], { [p.key]: n });
          cb.onParamChange && cb.onParamChange(def.id, params[def.id]);
        });
      }
      row.appendChild(input);
      right.appendChild(row);
    }
  }
  renderSettings();

  // ---- 매물대 — 패널 맨 아래 별도 행(spec §4, 보조지표 토글 리스트와 분리) ----
  const footer = el('div', 'chart-indicator-panel-footer');
  const vpRow = document.createElement('button');
  vpRow.type = 'button';
  vpRow.className = 'chart-ind-vp-row';
  vpRow.classList.toggle('is-on', volumeProfileOn);
  vpRow.setAttribute('role', 'checkbox');
  vpRow.setAttribute('aria-checked', String(volumeProfileOn));
  vpRow.appendChild(el('span', 'chart-ind-check'));
  vpRow.appendChild(el('span', 'chart-ind-label', '매물대'));
  vpRow.addEventListener('click', () => {
    volumeProfileOn = !volumeProfileOn;
    vpRow.classList.toggle('is-on', volumeProfileOn);
    vpRow.setAttribute('aria-checked', String(volumeProfileOn));
    cb.onVolumeProfileToggle && cb.onVolumeProfileToggle(volumeProfileOn);
  });
  footer.appendChild(vpRow);
  panel.appendChild(footer);

  function open(anchorBtn) {
    if (openPanelState && openPanelState.anchorBtn === anchorBtn) {
      closeAnyOpenIndicatorPanel();
      return;
    }
    closeAnyOpenIndicatorPanel();
    anchorBtn.parentElement.appendChild(panel);
    anchorBtn.setAttribute('aria-expanded', 'true');
    // 바깥 클릭·Escape로 닫힘 — chart-toolbar.js의 드롭다운과 동일한 배선이라
    // ui-kit.js의 bindOutsideCloseAndEscape로 공용화했다(포니테일 감사).
    const cleanup = bindOutsideCloseAndEscape(panel, anchorBtn, closeAnyOpenIndicatorPanel);
    openPanelState = { panel, anchorBtn, cleanup };
  }

  function close() {
    if (openPanelState && openPanelState.panel === panel) closeAnyOpenIndicatorPanel();
  }

  // 저작 상태 복원(CC-104) — chart-card.js가 저장된 상태를 공유 Set/params에
  // 반영한 뒤 이걸 불러 행 UI(체크 표시)와 매물대 행을 실제 상태에 맞춘다.
  // 행 DOM은 생성 시 1회 렌더라, 외부에서 Set을 바꿔도 스스로 갱신되지 않는다.
  function syncFromState(vpOn) {
    for (const id of Object.keys(rowById)) {
      const on = visible.has(id);
      rowById[id].classList.toggle('is-on', on);
      rowById[id].setAttribute('aria-checked', String(on));
    }
    volumeProfileOn = !!vpOn;
    vpRow.classList.toggle('is-on', volumeProfileOn);
    vpRow.setAttribute('aria-checked', String(volumeProfileOn));
    renderSettings(); // 파라미터 입력값도 복원된 params를 다시 읽는다
  }

  function destroy() {
    close();
  }

  return { panel, open, close, destroy, syncFromState };
}

const __exports = { createIndicatorPanel };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartIndicatorPanel = __exports;
}

})();
