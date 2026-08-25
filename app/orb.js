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
    // 얼굴과 배지는 같은 사실의 두 표현이다 — 한 함수가 같이 정해야 두 곳에서
    // 따로 켜지는 사고가 안 난다(호와 얼굴의 상호 배타를 여기서 지던 것과 같은 이유).
    if (fired) setFace(FACE.FIRED);
    else if (face === FACE.FIRED) setFace(FACE.IDLE);
    // 0을 그리지 않는다 — 없는 알림을 있는 것처럼 보이게 하는 가장 흔한 방법이다.
    $count.textContent = fired ? String(n) : '';
    // 스크린 리더에는 색이 안 들리므로 상태를 라벨로도 말한다.
    $toggle.setAttribute(
      'aria-label',
      fired ? `읽지 않은 알림 ${n}건 펼치기` : '알림 펼치기',
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 표정 · 대기 루프 (2026-08-25)
  //
  // 표정은 **눈 모양 하나로만** 만든다 — 눈썹도 입도 눈동자도 붙이지 않는다.
  // 시선은 흰 도형 두 개가 바이저 안에서 통째로 옮겨 앉는 것으로 낸다.
  // 모양은 전부 orb.css의 [data-face] 규칙이 지고, 여기서는 **언제 어느 얼굴인가**만
  // 정한다.
  //
  // **얼굴은 앱에 이미 있는 신호에만 붙인다.** 지금 배선하는 것은 넷뿐이다:
  //   idle  — 기본
  //   sleep — 오래 아무 일 없음(옛 판의 '평소'가 여기로 내려왔다)
  //   fired — 미확인 알림이 있다(data-alert와 짝)
  //   sorry — 만료·복원 실패처럼 발화가 아닌 종류
  // listen/think/watch/done/glad는 CSS에 모양만 있고 배선하지 않는다 — 오브가
  // 질의를 돌리지 않으므로 그 신호가 아직 없다. 없는 신호에 얼굴을 붙이면 그건
  // 정보가 아니라 지어낸 연기다(soul.md).
  const FACE = { IDLE: 'idle', SLEEP: 'sleep', FIRED: 'fired', SORRY: 'sorry' };

  const BLINK_CLOSE = 90;          // 감는 시간
  const BLINK_OPEN = 130;          // 뜨는 시간 — 감는 쪽보다 느려야 셔터로 안 읽힌다
  const BLINK_EVERY = [4000, 7000];
  const BLINK_DOUBLE = 0.15;       // 가끔 두 번 연속 — 이 불규칙이 생물이라는 증거다
  const SACCADE_EVERY = [8000, 20000];
  const SACCADE_OUT = 260;         // 갈 때는 빠르고
  const SACCADE_BACK = 340;        // 돌아올 때는 느리다 — 사람 눈이 그렇다
  const SACCADE_HOLD = 1200;
  const SACCADE_AMP = 7;           // px
  const SLEEP_AFTER = 5 * 60 * 1000;

  const CURSOR_RADIUS = 320;       // 화면 px — 이 밖의 커서는 쳐다보지 않는다
  const CURSOR_AMP = 4;            // px — 두리번(7)보다 작아야 '곁눈질'로 읽힌다
  const CURSOR_INTEREST = 2500;    // 커서가 멈춰 있으면 이 뒤에 시선을 놓는다
  const CURSOR_LAG = 120;          // 0이면 눈이 커서에 붙어버려 기계가 된다

  // 모션을 원치 않는 사용자에게는 루프를 **아예 돌리지 않는다.** CSS로 전이만 끄면
  // 타이머는 계속 돌면서 감은 프레임에서 굳을 수 있고, 그건 없는 상태('잠듦')를
  // 만들어내는 것이다(orb.css의 같은 이유 주석과 짝).
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let face = FACE.IDLE;
  let lastSignalAt = Date.now();
  let blinkTimer = null;
  let saccadeTimer = null;
  let doneTimer = null;

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function setGaze(gx, gy, durMs) {
    $root.style.setProperty('--orb-gaze-dur', `${durMs}ms`);
    $root.style.setProperty('--orb-gx', `${gx.toFixed(2)}px`);
    $root.style.setProperty('--orb-gy', `${gy.toFixed(2)}px`);
  }

  /** 표정의 기본 시선. 지금 배선한 넷은 전부 정면이지만, 자리를 만들어 둔다. */
  function baseGaze() {
    return { gx: 0, gy: 0 };
  }

  function setFace(next) {
    if (face === next) return;
    face = next;
    $root.dataset.face = next;
    const g = baseGaze();
    setGaze(g.gx, g.gy, SACCADE_BACK);
  }

  // ── 깜빡임 ──
  function blinkOnce(then) {
    $root.style.setProperty('--orb-blink-dur', `${BLINK_CLOSE}ms`);
    $root.style.setProperty('--orb-lid', '0.06');
    setTimeout(() => {
      $root.style.setProperty('--orb-blink-dur', `${BLINK_OPEN}ms`);
      $root.style.setProperty('--orb-lid', '1');
      setTimeout(then, BLINK_OPEN);
    }, BLINK_CLOSE);
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (reduceMotion.matches) return;
    blinkTimer = setTimeout(() => {
      // 잠들었으면 눈이 이미 감겨 있다 — 그 위에 깜빡임을 얹으면 경련처럼 보인다.
      if (face === FACE.SLEEP) { scheduleBlink(); return; }
      const twice = Math.random() < BLINK_DOUBLE;
      blinkOnce(() => (twice ? blinkOnce(scheduleBlink) : scheduleBlink()));
    }, rand(BLINK_EVERY[0], BLINK_EVERY[1]));
  }

  // ── 두리번 ── 아래는 목적지에서 뺀다 — 아래를 보면 시무룩해 보인다.
  const SACCADE_DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0]];

  function scheduleSaccade() {
    clearTimeout(saccadeTimer);
    if (reduceMotion.matches) return;
    saccadeTimer = setTimeout(() => {
      // 커서를 쳐다보는 중이면 쉰다 — 둘이 같은 층을 써서 겹치면 시선이 튄다.
      if (face !== FACE.IDLE || cursorHeld) { scheduleSaccade(); return; }
      const [dx, dy] = SACCADE_DIRS[Math.floor(Math.random() * SACCADE_DIRS.length)];
      setGaze(dx * SACCADE_AMP, dy * SACCADE_AMP * 0.85, SACCADE_OUT);
      setTimeout(() => {
        if (!cursorHeld) setGaze(0, 0, SACCADE_BACK);
        scheduleSaccade();
      }, SACCADE_OUT + SACCADE_HOLD);
    }, rand(SACCADE_EVERY[0], SACCADE_EVERY[1]));
  }

  // ── 잠듦 ── 오래 아무 일 없으면 내려앉는다. 상호작용이나 발화가 깨운다.
  function touchActivity() {
    lastSignalAt = Date.now();
    if (face === FACE.SLEEP) setFace(FACE.IDLE);
  }

  setInterval(() => {
    if (face !== FACE.IDLE) return;
    if (Date.now() - lastSignalAt >= SLEEP_AFTER) setFace(FACE.SLEEP);
  }, 15000);

  // ── 커서 추적 ──
  // main이 screen.getCursorScreenPoint()를 폴링해 **오브 창 중심 기준 상대 좌표**를
  // 준다(athena:orb-cursor). 렌더러 mousemove로는 안 되는 이유는 창이 76px이라
  // 커서가 창 위에 있을 때만 이벤트가 오기 때문이다 — 정작 눈이 따라가는 게 보여야
  // 할 "떨어져 있을 때"는 좌표가 안 들어온다.
  //
  // "조금만"은 세 장치가 만든다: 반경 밖이면 안 보고, 이동량은 감쇠하고,
  // 커서가 멈춰 있으면 흥미를 잃는다.
  let cursorHeld = false;
  let lastCursorAt = 0;

  function releaseCursor() {
    if (!cursorHeld) return;
    cursorHeld = false;
    setGaze(0, 0, SACCADE_BACK);
  }

  window.athena.on('athena:orb-cursor', (p) => {
    if (reduceMotion.matches) return;
    if (!p || typeof p.dx !== 'number' || typeof p.dy !== 'number') { releaseCursor(); return; }
    lastCursorAt = Date.now();

    // 다가오면 깬다 — 잠듦은 시선을 안 쓰는 표정이라 여기서만 상태를 건드린다.
    if (face === FACE.SLEEP && p.dist <= CURSOR_RADIUS) { touchActivity(); return; }
    // 시선이 뜻을 나르는 표정에서는 커서를 보지 않는다. 정보가 장난에 밀리면 안 된다.
    if (face !== FACE.IDLE) { releaseCursor(); return; }
    if (p.dist > CURSOR_RADIUS) { releaseCursor(); return; }

    // 반경 안쪽 75%는 최대치로 따라가고 바깥 25%에서만 잦아든다. 반경 전체에
    // 감쇠를 걸면(프로토타입 첫 판) 커서가 코앞에 와야 겨우 움직여서 "따라다닌다"가
    // 성립하지 않는다 — 실측: 반경 320, 거리 267에서 0.9px뿐이었다. 감쇠의 목적은
    // 세기 조절이 아니라 경계에서 툭 켜지지 않게 하는 것이다.
    const band = CURSOR_RADIUS * 0.25;
    const t = Math.min(1, Math.max(0, (CURSOR_RADIUS - p.dist) / band));
    const amp = CURSOR_AMP * (t * t * (3 - 2 * t));
    const d = p.dist || 1;
    cursorHeld = true;
    // 세로는 0.85배 — 바이저가 세로로 짧아 같은 값이면 눈이 위아래로 새어 보인다.
    setGaze((p.dx / d) * amp, (p.dy / d) * amp * 0.85, CURSOR_LAG);
  });

  setInterval(() => {
    if (cursorHeld && Date.now() - lastCursorAt > CURSOR_INTEREST) releaseCursor();
  }, 250);

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
    // 무엇이 왔든 오브는 깬다 — 일이 생겼다는 것 자체가 신호다.
    touchActivity();
    if (expanded) {
      // 이미 펼쳐져 있으면 바로 갈아끼운다 — 쌓아두면 최신이 아닌 것을 보게 된다.
      renderPanel(event);
      return;
    }
    unread.push(event);
    renderPresence();
    // 발화가 아닌 종류(만료·복원 실패)는 활짝 여는 얼굴이 아니다. 같은 결정론
    // 템플릿의 kind를 그대로 읽어 쓴다 — 여기서 따로 판정하면 두 벌이 된다.
    if (routineTurn.buildTurnModel(event, Date.now()).kind !== 'fired') setFace(FACE.SORRY);
  });

  $toggle.addEventListener('click', () => { touchActivity(); setExpanded(!expanded); });
  $close.addEventListener('click', () => { touchActivity(); setExpanded(false); });

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
  // 초기 얼굴 — setFace()는 같은 값이면 일찍 빠지므로 속성은 여기서 직접 박는다.
  $root.dataset.face = face;
  scheduleBlink();
  scheduleSaccade();
})();
