// 알림 오브 렌더러 (2026-08-24 리프 1.3.1 · 시각 재작업 1.3.2).
//
// nodeIntegration:false / contextIsolation:true / sandbox:true — preload.js의
// window.athena 다리로만 main과 통신한다. lib/routine-turn.js는 orb.html이
// <script> 태그로 미리 로드해 window.AthenaLib에 얹어둔 전역이다.
//
// **이 파일이 하지 않는 것이 계약이다.** 질의를 시작하지 않고(입력 지점은 셸 창
// 커맨드바 하나), 주문을 집행하지 않고(확정 결정 3), 감시를 승인·취소하지 않는다.
// 오브의 액션은 펼침 · 더보기 · 접기 셋뿐이다.
//
// 본문은 지어내지 않는다: 발화 배지 · 방식 표기 · 소스 라벨 · 시점 고지는 전부
// lib/routine-turn.js의 결정론 템플릿이 만든다(LLM 0). 렌더는 전부 textContent —
// innerHTML 문자열 삽입 0건(함정 ⑪ 저장형 XSS).
(() => {
  'use strict';

  const routineTurn = window.AthenaLib.RoutineTurn;

  const $root = document.getElementById('orbRoot');
  const $panel = document.getElementById('orbPanel');
  const $count = document.getElementById('orbCount');
  const $toggle = document.getElementById('orbToggle');
  const $close = document.getElementById('orbClose');
  const $more = document.getElementById('orbMore');
  const $badge = document.getElementById('orbBadge');
  const $mode = document.getElementById('orbMode');
  const $relative = document.getElementById('orbRelative');
  const $body = document.getElementById('orbBody');
  const $card = document.getElementById('orbCard');
  const $source = document.getElementById('orbSource');

  // 미확인 알림. 이 배열이 비어 있으면 오브는 무채색이고, 하나라도 있으면 얼굴이
  // 드러난다(renderPresence). 펼치면 가장 최근 것을 보여주고 전부 확인 처리한다.
  const unread = [];
  let current = null;
  let expanded = false;

  function renderPresence() {
    const n = unread.length;
    const fired = n > 0;
    $root.dataset.alert = fired ? 'fired' : 'none';
    // 0을 그리지 않는다 — 없는 알림을 있는 것처럼 보이게 하는 가장 흔한 방법이다.
    $count.textContent = fired ? String(n) : '';
    // 스크린 리더에는 색이 안 들리므로 상태를 라벨로도 말한다.
    $toggle.setAttribute(
      'aria-label',
      fired ? `읽지 않은 알림 ${n}건 펼치기` : '알림 펼치기',
    );
  }

  /** label/value 한 줄. 값은 항상 문자열로 박아 넣는다(textContent만 쓴다). */
  function row(label, value) {
    const el = document.createElement('div');
    el.className = 'orb-row';
    const l = document.createElement('span');
    l.className = 'orb-row-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'orb-row-value';
    v.textContent = value;
    el.append(l, v);
    return el;
  }

  /**
   * 대표 카드 — 이벤트 원장 행의 1:1 렌더. 없는 필드는 줄 자체를 만들지 않는다
   * (빈 값을 '-'로 채우면 "측정했는데 값이 없다"로 읽힌다).
   */
  function renderCard(event) {
    $card.replaceChildren();
    if (!event) return;
    const fields = [
      ['종목', event.symbol],
      ['관측값', event.observed],
      ['임계', event.threshold],
      ['소스', event.source],
      ['루틴', event.note || event.routine_id],
    ];
    for (const [label, value] of fields) {
      if (value === null || value === undefined || value === '') continue;
      $card.appendChild(row(label, String(value)));
    }
  }

  function renderPanel(event) {
    const model = routineTurn.buildTurnModel(event, Date.now());
    // 시점 정직성 3종 — 값이 없는 종류(만료·복원실패)에서는 칸을 비운다.
    $badge.textContent = model.badge || '';
    $badge.hidden = !model.badge;
    $mode.textContent = model.modeText || '';
    $mode.hidden = !model.modeText;
    $relative.textContent = model.relative || '';
    $relative.hidden = !model.relative;
    $body.textContent = model.body;
    $source.textContent = model.sourceLabel || '';
    // 대표 카드는 발화(fired)에만 있다 — 만료·복원실패는 원장 행에 관측값이 없다.
    renderCard(model.kind === 'fired' ? event : null);
    // 더보기는 캔버스에 쌓을 카드가 있을 때만 의미가 있다. 없으면 숨긴다 —
    // 눌러도 아무 일 없는 버튼을 남기지 않는다(soul.md §7).
    $more.hidden = model.kind !== 'fired';
  }

  function setExpanded(next) {
    if (expanded === next) return;
    expanded = next;
    // 창 크기 변경은 main이 한다(기하는 orb-window.js가 계산한다). 렌더러는
    // 요청만 하고, main이 anchor를 돌려주면 그때 상태를 반영한다.
    window.athena.send('athena:orb-toggle', { expanded: next });
  }

  // main이 창 크기를 실제로 바꾼 뒤에 온다 — 렌더러가 먼저 펼치면 창보다 큰
  // 패널이 한 프레임 잘려 보인다.
  window.athena.on('athena:orb-state', ({ expanded: isOpen, anchor } = {}) => {
    if (anchor) $root.dataset.anchor = anchor;
    $root.dataset.state = isOpen ? 'expanded' : 'collapsed';
    $panel.hidden = !isOpen;
    expanded = !!isOpen;
    if (isOpen) {
      // 펼치는 순간 전부 확인 처리한다 — 사용자가 본 것을 안 봤다고 하지 않는다.
      current = unread.length ? unread[unread.length - 1] : current;
      unread.length = 0;
      renderPresence();
      if (current) renderPanel(current);
    }
  });

  window.athena.on('athena:routine-event', (event) => {
    if (!event || typeof event !== 'object') return;
    current = event;
    if (expanded) {
      // 이미 펼쳐져 있으면 바로 갈아끼운다 — 쌓아두면 최신이 아닌 것을 보게 된다.
      renderPanel(event);
      return;
    }
    unread.push(event);
    renderPresence();
  });

  $toggle.addEventListener('click', () => setExpanded(!expanded));
  $close.addEventListener('click', () => setExpanded(false));

  // 오브의 유일한 진행 경로. 셸 창을 앞으로 가져오고 대표 카드를 중앙 캔버스에
  // 쌓는다 — main이 기존 facts 봉투로 접어 보낸다(신규 카드 타입 0개).
  $more.addEventListener('click', () => {
    if (!current) return;
    window.athena.send('athena:orb-open-shell', { event: current });
    setExpanded(false);
  });

  // Esc는 접기다. 오브에는 닫을 모드가 이것뿐이라 분기가 없다.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  });

  renderPresence();
})();
