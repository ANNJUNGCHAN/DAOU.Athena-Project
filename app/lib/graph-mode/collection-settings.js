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
// **브레인 상태 카드는 "못 하는 것"을 숨기지 않는다.** 배치 주기는 설정 파일이
// 소유하고, 마지막·다음 실행 시각은 상태 API가 아직 안 준다 — Paper가 그 두 줄을
// 굳이 그려 둔 이유는 화면이 조용히 없는 척하지 않게 하기 위해서다(§0 정직성).

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

function sourceCell(label, control) {
  const cell = el('div', 'graph-settings-source');
  cell.appendChild(el('span', 'graph-settings-source-label', label));
  cell.appendChild(control);
  return cell;
}

// 상태 행(브레인 카드) — 제목 · 설명 · 우측 곁말/컨트롤. 우측이 텍스트면
// "이 화면은 못 한다"는 뜻이고, 버튼이면 할 수 있다는 뜻이다.
function statusRow(title, note, aside, muted) {
  const row = el('div', `graph-settings-row${muted ? ' is-muted' : ''}`);
  const main = el('div', 'graph-settings-row-main');
  main.appendChild(el('div', 'graph-settings-row-title', title));
  if (note) main.appendChild(note);
  row.appendChild(main);
  if (aside) row.appendChild(aside);
  return row;
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
  sources.appendChild(sourceCell('대화', chatToggle));

  sources.appendChild(sourceCell('체결내역', toggle(settings.collectFills, (next) => {
    deps.writeSettings({ collectFills: next });
  }, '체결내역 수집')));

  // 보유잔고 칸만 조회 주기 선택기를 함께 문다(보드 05 실측 — 세 번째 칸에만 있다).
  const holdings = el('div', 'graph-settings-source');
  holdings.appendChild(el('span', 'graph-settings-source-label', '보유잔고'));
  const controls = el('div', 'graph-settings-source-controls');
  controls.appendChild(el('span', 'graph-settings-interval-label', '조회 주기'));
  const select = el('select', 'graph-settings-interval-select');
  select.setAttribute('aria-label', '보유잔고 조회 주기');
  for (const minutes of deps.intervalOptions || []) {
    const option = el('option', null, `${minutes}분`);
    option.value = String(minutes);
    if (minutes === settings.holdingsIntervalMin) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    deps.writeSettings({ holdingsIntervalMin: Number(select.value) });
  });
  controls.appendChild(select);
  controls.appendChild(toggle(settings.collectHoldings, (next) => {
    deps.writeSettings({ collectHoldings: next });
  }, '보유잔고 수집'));
  holdings.appendChild(controls);
  sources.appendChild(holdings);
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

function renderBrainCard(deps) {
  const card = el('section', 'graph-settings-card');
  const head = el('header', 'graph-settings-card-head');
  head.appendChild(el('span', 'graph-settings-card-title', '브레인 상태'));
  head.appendChild(el('span', 'graph-settings-card-sub', '이 화면이 바꿀 수 있는 값과 아닌 값'));
  const badge = el('span', `graph-settings-badge${deps.brainReady ? ' is-ready' : ''}`,
    deps.brainReady ? '브레인 준비됨' : '브레인 준비 안 됨');
  head.appendChild(badge);
  card.appendChild(head);

  // 배치 주기 — 값의 주인이 설정 파일이라는 사실 자체가 이 행의 내용이다.
  //
  // 사람 말을 먼저 쓴다(2026-09-03 실사용: "배치 주기를 뭔가 보유잔고처럼 정할 수
  // 있으면 좋겠고, 수동실행, 마지막 다음 실행시각은 뭔지 모르겠다"). 예전에는 환경변수
  // 이름이 문장의 첫머리였다 — 그 이름을 모르는 사람에게는 행 전체가 읽히지 않았다.
  // 이름 자체는 지우지 않는다: 값을 실제로 바꿀 수 있는 사람에게는 그것이 유일한
  // 단서다. 무엇을 하는 주기인지 → 지금 값 → 어디서 바꾸는지 순서로 바꿔 적는다.
  const intervalNote = el('div', 'graph-settings-row-note');
  intervalNote.appendChild(el('span', null,
    `대화와 체결을 모아 성향 그래프에 넣는 주기입니다 · 지금 ${deps.defaultIngestIntervalMinutes}분마다 · `));
  intervalNote.appendChild(el('span', null, '이 화면에서는 못 바꿉니다(설정 파일 '));
  intervalNote.appendChild(el('code', 'graph-settings-envvar', 'ATHENA_BRAIN_INGEST_INTERVAL_MINUTES'));
  intervalNote.appendChild(el('span', null, ').'));
  card.appendChild(statusRow('배치 주기', intervalNote, el('span', 'graph-settings-row-aside', '설정 파일')));

  // 수동 실행·실행 시각 — 상태 API가 아직 안 주는 값이라 자리만 정직하게 남긴다.
  // 문구는 "무엇이 없는가"가 아니라 "그래서 지금 무엇이 참인가"를 말한다 — 앞 문구는
  // API 사정을 아는 사람에게만 뜻이 있었다(같은 제보).
  card.appendChild(statusRow(
    '수동 실행 · 마지막·다음 실행 시각',
    el('div', 'graph-settings-row-note',
      '아직 없습니다 — 지금은 위 주기로만 자동으로 돌고, 사람이 직접 돌리거나 언제 돌았는지 볼 방법은 없습니다.'),
    el('span', 'graph-settings-row-aside', '제공 안 함'),
    true));

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

const __exports = { renderCollectionSettings, describeRendered };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphCollectionSettings = __exports;
}

})();
