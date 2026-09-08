// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드 세 번째 서브뷰 "수집·노출"(Paper 그래프 페이지 보드 05).
//
// **왜 설정 오버레이가 아니라 여기인가.** Paper 보드 05는 이 화면을 `요약 · 그래프 ·
// 수집·노출` 세 탭 중 하나로 그렸다 — 그래프를 보다가 "이건 어디서 온 값이지"를
// 물었을 때 답이 같은 화면 안에 있어야 한다는 뜻이다. 2026-09-06까지는 같은 토글이
// 설정 오버레이에도 있었지만, 그 카드가 Paper 보드 32 「성향·이력」으로 돌아가면서
// 이 탭이 **유일한 입구**가 됐다 — 저장소는 그대로 localStorage
// `athena.graphSettings.prefs`이고, 설정 nav 배지가 그 값을 읽어 켜짐/꺼짐을 적는다.
//
// **읽기·쓰기는 전부 주입받는다.** 이 디렉터리의 다른 모듈과 같은 계약이다 —
// localStorage도 IPC도 여기서 직접 잡지 않는다. canvas.js가 settings-cards.js의
// 기존 함수를 그대로 넘겨 준다(같은 규칙을 두 벌 쓰지 않는다).
//
// **조회 주기·수동 실행·실행 시각은 소스마다 있다(2026-09-08).** 예전 브레인 상태
// 카드의 「배치 주기」(설정 파일이 소유, 못 바꿈)와 「수동 실행 · 실행 시각」(제공 안
// 함) 두 행은 지웠다 — 백엔드 스케줄러(/brain/schedule)가 대화·체결내역·보유잔고를
// 각자 주기로 돌리고 마지막·다음 실행 시각을 주므로, 그 셋은 각 수집원 칸 우측에
// 작은 글씨로 붙는다. 주기 값의 주인은 여전히 localStorage다: 백엔드는 기동마다
// 설정 파일 기본값으로 돌아오고 canvas.js가 브레인 준비 뒤 저장값을 다시 밀어 넣는다.

const SOURCES = Object.freeze([
  { id: 'chat', label: '대화', intervalKey: 'chatIntervalMin' },
  { id: 'fills', label: '체결내역', intervalKey: 'fillsIntervalMin' },
  { id: 'holdings', label: '보유잔고', intervalKey: 'holdingsIntervalMin' },
]);

function el(name, className, text) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// 보드 05 토글 — 켜지면 트랙이 먹색으로 차고 흰 손잡이가 오른쪽으로 간다.
// 설정 오버레이의 `.uk-toggle`(옅은 트랙 + 핑크 테두리)과 다른 시각 언어라
// 클래스를 따로 둔다 — 같은 클래스를 쓰면 한쪽을 고칠 때 다른 쪽이 함께 변한다.
function toggle(initial, onChange, ariaLabel) {
  let on = Boolean(initial);
  const button = el('button', `graph-settings-toggle${on ? ' is-on' : ''}`);
  button.setAttribute('type', 'button');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(on));
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  button.appendChild(el('span', 'graph-settings-toggle-thumb'));
  button.addEventListener('click', () => {
    on = !on;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', String(on));
    onChange(on, button);
  });
  return button;
}

// 재생 삼각형 — 아이콘 폰트를 들이지 않는다(이 리포의 다른 아이콘과 같이 인라인 SVG).
function playIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.5 1.5v9l8-4.5z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

// ── 실행 시각 문구 ────────────────────────────────────────────────────────────
//
// 같은 날이면 "14:05", 다른 날이면 "9/7 14:05". 분 단위로 도는 값이라 초는 소음이다.
function formatClock(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay ? hhmm : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

// 백엔드 응답 `{ schedule_owner, sources: [{ source, ... }] }`에서 소스 하나를 꺼낸다.
function scheduleFor(schedule, sourceId) {
  const list = schedule && Array.isArray(schedule.sources) ? schedule.sources : [];
  return list.find((row) => row && row.source === sourceId) || null;
}

// 문구는 "그래서 지금 무엇이 참인가"를 말한다(§0 정직성) — 스케줄을 못 읽었으면
// 시각을 지어내지 않고, 자동 주기의 주인이 이 백엔드가 아니면(external) 다음 시각을
// 약속하지 않는다.
function scheduleText(schedule, sourceId, nowMs) {
  const row = scheduleFor(schedule, sourceId);
  if (!row) return '실행 시각 알 수 없음';
  if (row.running) return '실행 중…';
  const parts = [];
  const last = row.last_run_at ? formatClock(row.last_run_at, nowMs) : null;
  parts.push(`마지막 ${last || '—'}`);
  if (schedule.schedule_owner === 'external') parts.push('자동 실행 없음');
  else {
    const next = row.next_run_at ? formatClock(row.next_run_at, nowMs) : null;
    parts.push(`다음 ${next || '—'}`);
  }
  if (row.last_error) parts.push(`실패(${row.last_error})`);
  if (sourceId !== 'chat' && row.producer_wired === false) parts.push('계정 미연결');
  return parts.join(' · ');
}

// 이미 그려진 세 칸의 실행 시각·실행 버튼만 갱신한다 — 전체를 다시 그리면 열려 있던
// select가 닫히고 포커스가 날아간다.
function applySchedule(root, schedule, nowMs) {
  if (!root) return;
  for (const cell of root.querySelectorAll('.graph-settings-source')) {
    const sourceId = cell.getAttribute('data-source');
    if (!sourceId) continue;
    const meta = cell.querySelectorAll('.graph-settings-source-meta')[0];
    if (meta) meta.textContent = scheduleText(schedule, sourceId, nowMs);
    const run = cell.querySelectorAll('.graph-settings-run')[0];
    if (run && !run.__busy) {
      const row = scheduleFor(schedule, sourceId);
      run.disabled = !row || Boolean(row.running);
    }
  }
}

function sourceCell(source, settings, deps, card, collectToggle) {
  const cell = el('div', 'graph-settings-source');
  cell.setAttribute('data-source', source.id);
  // 실행 시각 줄 — 칸의 우측 아래, 작은 글씨(사용자 요청 2026-09-08).
  const meta = el('div', 'graph-settings-source-meta', scheduleText(deps.schedule, source.id));
  const row = el('div', 'graph-settings-source-row');
  row.appendChild(el('span', 'graph-settings-source-label', source.label));
  const controls = el('div', 'graph-settings-source-controls');

  controls.appendChild(el('span', 'graph-settings-interval-label', '조회 주기'));
  const select = el('select', 'graph-settings-interval-select');
  select.setAttribute('aria-label', `${source.label} 조회 주기`);
  for (const minutes of deps.intervalOptions || []) {
    const option = el('option', null, `${minutes}분`);
    option.value = String(minutes);
    if (minutes === settings[source.intervalKey]) option.selected = true;
    select.appendChild(option);
  }
  // 저장은 동기(localStorage), 백엔드 반영은 비동기 — 반영에 실패해도 저장값은 남고
  // 이유를 적는다(다음 브레인 준비 때 canvas.js가 저장값을 다시 밀어 넣는다).
  select.addEventListener('change', async () => {
    const minutes = Number(select.value);
    deps.writeSettings({ [source.intervalKey]: minutes });
    if (typeof deps.setSourceInterval !== 'function') return;
    select.disabled = true;
    try {
      const next = await deps.setSourceInterval(source.id, minutes);
      if (next) applySchedule(card, next);
    } catch (error) {
      showError(card, (error && error.message) || `${source.label} 조회 주기를 백엔드에 반영하지 못했습니다.`);
    } finally {
      select.disabled = false;
    }
  });
  controls.appendChild(select);

  const run = el('button', 'graph-settings-run');
  run.setAttribute('type', 'button');
  run.setAttribute('aria-label', `${source.label} 지금 실행`);
  run.setAttribute('title', '지금 실행');
  run.appendChild(playIcon());
  const initial = scheduleFor(deps.schedule, source.id);
  run.disabled = !initial || Boolean(initial.running) || typeof deps.runSource !== 'function';
  run.addEventListener('click', async () => {
    if (typeof deps.runSource !== 'function') return;
    run.disabled = true;
    run.__busy = true;
    run.classList.add('is-running');
    meta.textContent = '실행 중…';
    try {
      const next = await deps.runSource(source.id);
      delete run.__busy;
      applySchedule(card, next || deps.schedule);
    } catch (error) {
      delete run.__busy;
      applySchedule(card, deps.schedule);
      showError(card, (error && error.message) || `${source.label}을(를) 지금 실행하지 못했습니다.`);
    } finally {
      run.classList.remove('is-running');
    }
  });
  controls.appendChild(run);

  controls.appendChild(collectToggle);
  row.appendChild(controls);
  cell.appendChild(row);
  cell.appendChild(meta);
  return cell;
}

function renderSourcesCard(settings, deps) {
  const card = el('section', 'graph-settings-card');
  const head = el('header', 'graph-settings-card-head');
  head.appendChild(el('span', 'graph-settings-card-title', '그래프 수집과 노출'));
  head.appendChild(el('span', 'graph-settings-card-sub', '무엇을 읽고 누구에게 보일지'));
  card.appendChild(head);

  const sources = el('div', 'graph-settings-sources');

  // 대화 수집만 비동기다 — 켜고 끄는 것이 저장된 원문 삭제까지 뜻해서
  // 백엔드 왕복이 필요하다. 실패하면 토글을 원래 자리로 되돌리고 이유를 적는다
  // (조용히 켜진 척하면 사용자는 수집되고 있다고 믿는다).
  const chatToggle = toggle(settings.collectChat, async (next, button) => {
    if (typeof deps.setCollectChat !== 'function') {
      deps.writeSettings({ collectChat: next });
      return;
    }
    button.disabled = true;
    try {
      await deps.setCollectChat(next);
    } catch (error) {
      button.classList.toggle('is-on', false);
      button.setAttribute('aria-checked', 'false');
      showError(card, (error && error.message) || '대화 이력 수집 설정을 바꾸지 못했습니다.');
    } finally {
      button.disabled = false;
    }
  }, '대화 수집');
  sources.appendChild(sourceCell(SOURCES[0], settings, deps, card, chatToggle));

  sources.appendChild(sourceCell(SOURCES[1], settings, deps, card, toggle(settings.collectFills, (next) => {
    deps.writeSettings({ collectFills: next });
  }, '체결내역 수집')));

  sources.appendChild(sourceCell(SOURCES[2], settings, deps, card, toggle(settings.collectHoldings, (next) => {
    deps.writeSettings({ collectHoldings: next });
  }, '보유잔고 수집')));
  card.appendChild(sources);

  const expose = el('div', 'graph-settings-expose');
  const exposeText = el('div', 'graph-settings-expose-text');
  exposeText.appendChild(el('div', 'graph-settings-expose-label', '보유 종목·수량과 대화 원문을 모델에 전달'));
  exposeText.appendChild(el('div', 'graph-settings-expose-note', '끄면 그래프는 계속 쌓이지만 모델에게는 넘기지 않습니다.'));
  expose.appendChild(exposeText);
  expose.appendChild(toggle(settings.exposeToModel, (next) => {
    deps.writeSettings({ exposeToModel: next });
  }, '모델에 전달'));
  card.appendChild(expose);
  return card;
}

function showError(card, message) {
  let box = card.querySelectorAll('.graph-settings-error')[0];
  if (!box) {
    box = el('div', 'graph-settings-error');
    card.appendChild(box);
  }
  box.textContent = message;
}

// 상태 행(브레인 카드) — 제목 · 설명 · 우측 컨트롤.
function statusRow(title, note, aside) {
  const row = el('div', 'graph-settings-row');
  const main = el('div', 'graph-settings-row-main');
  main.appendChild(el('div', 'graph-settings-row-title', title));
  if (note) main.appendChild(note);
  row.appendChild(main);
  if (aside) row.appendChild(aside);
  return row;
}

function renderBrainCard(deps) {
  const card = el('section', 'graph-settings-card');
  const head = el('header', 'graph-settings-card-head');
  head.appendChild(el('span', 'graph-settings-card-title', '브레인 상태'));
  head.appendChild(el('span', 'graph-settings-card-sub', '이 화면이 바꿀 수 있는 값과 아닌 값'));
  const badge = el('span', `graph-settings-badge${deps.brainReady ? ' is-ready' : ''}`,
    deps.brainReady ? '브레인 준비됨' : '브레인 준비 안 됨');
  head.appendChild(badge);
  card.appendChild(head);

  const resetButton = el('button', 'graph-settings-danger', '전체 삭제');
  resetButton.setAttribute('type', 'button');
  const resetRow = statusRow(
    '전체 삭제',
    el('div', 'graph-settings-row-note', '채팅 이력과 성향 그래프를 모두 지우고 백엔드를 재기동합니다. 되돌릴 수 없습니다.'),
    resetButton);
  card.appendChild(resetRow);

  const resultBox = el('div', 'graph-settings-reset-result');
  card.appendChild(resultBox);

  // 되돌릴 수 없는 동작이라 한 번 더 묻는다 — 확인 막대가 뜨는 동안 원 버튼은
  // 잠근다(두 번 눌러 두 번 지우는 경로를 없앤다).
  resetButton.addEventListener('click', () => {
    while (resultBox.firstChild) resultBox.removeChild(resultBox.firstChild);
    resetButton.disabled = true;
    const bar = el('div', 'graph-settings-confirm');
    bar.appendChild(el('span', 'graph-settings-confirm-text', '채팅 이력과 투자 성향을 전부 삭제할까요? 되돌릴 수 없습니다.'));
    const cancel = el('button', 'graph-settings-confirm-cancel', '취소');
    cancel.setAttribute('type', 'button');
    const confirm = el('button', 'graph-settings-confirm-ok', '삭제');
    confirm.setAttribute('type', 'button');
    bar.appendChild(cancel);
    bar.appendChild(confirm);
    resultBox.appendChild(bar);

    cancel.addEventListener('click', () => {
      while (resultBox.firstChild) resultBox.removeChild(resultBox.firstChild);
      resetButton.disabled = false;
    });
    confirm.addEventListener('click', async () => {
      cancel.disabled = true;
      confirm.disabled = true;
      confirm.textContent = '삭제 중…';
      let result = null;
      try {
        result = typeof deps.resetBrain === 'function' ? await deps.resetBrain() : null;
      } catch (error) {
        result = { ok: false, error: String((error && error.message) || error) };
      }
      while (resultBox.firstChild) resultBox.removeChild(resultBox.firstChild);
      if (!result || !result.ok) {
        resultBox.appendChild(el('div', 'graph-settings-error', (result && result.error) || '삭제에 실패했습니다.'));
        resetButton.disabled = false;
        return;
      }
      resultBox.appendChild(el('div', 'graph-settings-row-note', result.selfSpawned
        ? '삭제 완료 — 브레인이 재기동 중입니다.'
        : '삭제 완료 — 이 앱이 띄운 백엔드가 아니라 자동으로 재기동하지 않습니다. 백엔드를 직접 재시작하세요.'));
    });
  });

  return card;
}

// 순수 렌더 — container를 통째로 다시 채운다(이 디렉터리의 다른 렌더러와 같다).
function renderCollectionSettings(container, deps) {
  if (!container) return null;
  const settings = deps.readSettings();
  while (container.firstChild) container.removeChild(container.firstChild);
  const wrap = el('div', 'graph-settings');
  wrap.appendChild(renderSourcesCard(settings, deps));
  wrap.appendChild(renderBrainCard(deps));
  container.appendChild(wrap);
  return wrap;
}

function describeRendered(container) {
  const wrap = container && container.querySelector('.graph-settings');
  if (!wrap) return { rendered: false, toggles: 0, cards: 0 };
  return {
    rendered: true,
    toggles: wrap.querySelectorAll('.graph-settings-toggle').length,
    cards: wrap.querySelectorAll('.graph-settings-card').length,
  };
}

const __exports = { renderCollectionSettings, describeRendered, applySchedule, scheduleText, formatClock, SOURCES };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphCollectionSettings = __exports;
}

})();
