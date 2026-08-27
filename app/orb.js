// 알림 오브 렌더러 (2026-08-24 리프 1.3.1 · 시각 재작업 1.3.2).
//
// nodeIntegration:false / contextIsolation:true / sandbox:true — preload.js의
// window.athena 다리로만 main과 통신한다. lib/routine-turn.js는 orb.html이
// <script> 태그로 미리 로드해 window.AthenaLib에 얹어둔 전역이다.
//
// **이 파일이 하지 않는 것이 계약이다.** 주문을 집행하지 않고(확정 결정 3),
// 감시를 승인·취소하지 않는다 — 그 셋은 여전히 오브의 액션이 아니다.
//
// 2026-08-26 board-33/34 — "입력 지점은 셸 창 커맨드바 하나"는 "셸이 보이는
// 동안은 오브에 입력이 없다"로 바뀌었다(tree-34-deep.raw "상태는 둘뿐이다").
// 셸이 숨겨졌을 때만 오브가 질의를 받는다(athena:shell-visibility가 게이트) —
// 그래서 **동시에 살아있는 입력창은 여전히 최대 하나**다, 그 하나가 어느 창인지가
// 셸 표시 여부로 갈릴 뿐이다. 질의는 athena:orb-chat-submit으로 내는데, 이건
// 셸의 커맨드바가 부르는 것과 완전히 같은 runLiveQuery로 이어진다 — 오브가 자기
// 파이프라인을 새로 만들지 않는다.
//
// 본문은 지어내지 않는다: 발화 배지 · 방식 표기 · 소스 라벨 · 시점 고지는 전부
// lib/routine-turn.js의 결정론 템플릿이 만든다(LLM 0). 렌더는 전부 textContent —
// innerHTML 문자열 삽입 0건(함정 ⑪ 저장형 XSS).
//
// 2026-08-27 갭 클로징 Step 0 — CP(체크포인트) 결정 4건.
// CP0: 바이저 개방 축은 board-32 유지(2026-08-26 사용자 결정·게이트 확정 —
// check-orb.mjs가 모든 상태 바이저를 항상-블루 62×61 동일 프레임으로 강제).
// board-30의 옛 개방 축(닫힘·반쯤·열림) 캡션은 Paper에서 정합화함(2026-08-27).
// CP1: 즐거움(glad, 목표달성) 표정은 PnL/목표추적 데이터가 없어 백로그로
// 유예한다 — 데이터 없이 임의로 근사한 판정을 넣지 않는다.
// CP2: 미니 주문 티켓(board-33⑤)은 확정 결정 3(오브가 주문을 집행하지
// 않는다) 폐기가 미승인 상태라 Step 10 전체를 보류한다.
// CP3: 경계(watch, 임계 근접) 표정은 발화 전 근접 틱 데이터가 없어
// 백로그로 유예한다.
(() => {
  'use strict';

  const routineTurn = window.AthenaLib.RoutineTurn;
  const toolStepTrack = window.AthenaLib.ToolStepTrack;
  const liveQueryLock = window.AthenaLib.LiveQueryLock;
  const marketHours = window.AthenaLib.MarketHours;
  const columnFold = window.AthenaLib.ColumnFold;
  const factsCard = window.AthenaLib.FactsCard;
  const cardPrimitives = window.AthenaLib.CardPrimitives;

  const $root = document.getElementById('orbRoot');
  const $orb = document.getElementById('orb');
  const $ring = document.getElementById('orbRing');
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
  const $foot = document.getElementById('orbFoot');
  const $headerTitle = document.getElementById('orbHeaderTitle');

  // ── 대화 모드 DOM(2026-08-26 board-33) ──
  const $chatBody = document.getElementById('orbChatBody');
  const $chatEmpty = document.getElementById('orbChatEmpty');
  const $chatTurns = document.getElementById('orbChatTurns');
  const $inputStack = document.getElementById('orbInputStack');
  const $chatInput = document.getElementById('orbInput');
  const $lockHint = document.getElementById('orbLockHint');
  const $lockText = document.getElementById('orbLockText');
  const $esc = document.getElementById('orbEsc');
  const $chatDot = document.getElementById('orbChatDot');
  const $chatCli = document.getElementById('orbChatCli');
  const $chatRoutine = document.getElementById('orbChatRoutine');
  const $chatGo = document.getElementById('orbChatGo');
  // 알림 전용 표면 — 대화 모드일 때 통째로 감춘다(applyMode).
  const ALERT_ONLY_ELS = [$badge, $mode, $relative, $body, $card, $foot];

  // 미확인 알림. 이 배열이 비어 있으면 오브는 무채색이고, 하나라도 있으면 얼굴이
  // 드러난다(renderPresence). 펼치면 가장 최근 것을 보여주고 전부 확인 처리한다.
  const unread = [];
  let current = null;
  let expanded = false;
  // 접힌 채 도착한 대화 답(board-33⑥) 건수 — unread와 별도 카운터다. unread는
  // 루틴 이벤트 전용 배열이라 대화 답을 그 안에 넣으면 가짜 루틴 이벤트를
  // 위장해 넣는 꼴이 된다(정직성 위반) — renderPresence()가 아래에서 둘을
  // 합산만 하고, 내용물은 절대 안 섞는다.
  let foldedChatAnswers = 0;

  function renderPresence() {
    const n = unread.length + foldedChatAnswers;
    const fired = n > 0;
    $root.dataset.alert = fired ? 'fired' : 'none';
    // 얼굴과 배지는 같은 사실의 두 표현이다 — 한 함수가 같이 정해야 두 곳에서
    // 따로 켜지는 사고가 안 난다(호와 얼굴의 상호 배타를 여기서 지던 것과 같은 이유).
    if (fired) setFace(FACE.FIRED);
    // SURPRISE도 여기서 같이 풀어준다 — fired의 대체 표현일 뿐 별도 사건이
    // 아니라서(위 FACE 주석), 읽으면(unread 비면) fired와 똑같이 풀려야 한다.
    // mopey/crying은 다른 축(만료·복원실패, 별도 사건)이라 여기서 안 건드린다.
    else if (face === FACE.FIRED || face === FACE.SURPRISE) setFace(FACE.IDLE);
    // 0을 그리지 않는다 — 없는 알림을 있는 것처럼 보이게 하는 가장 흔한 방법이다.
    $count.textContent = fired ? String(n) : '';
    // 스크린 리더에는 색이 안 들리므로 상태를 라벨로도 말한다.
    $toggle.setAttribute(
      'aria-label',
      fired ? `읽지 않은 알림 ${n}건 펼치기` : '알림 펼치기',
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 감시 궤도 링(2026-08-27 갭 클로징 Step 1, board-30② "궤도 위성 = 감시
  // 건수") — 접힌 원 둘레에 활성 감시(루틴) 수만큼 위성 점을 놓는다. 표정과는
  // 다른 채널이라 화면당 신호 원칙을 깨지 않는다: 무채색(rgb(16 19 26/50%))
  // 이고 바이저의 눈 모양을 건드리지 않는다 — .orb-count 배지(신호가 아니라
  // 신호의 크기 표시)와 같은 격이다. 발화(fired)로 눈이 동그래질 때도 링은
  // 원 가장자리 밖(orb.css #orbRing inset:-7px)이라 바이저 안쪽 눈과 자리가
  // 겹치지 않는다.
  // ─────────────────────────────────────────────────────────────────────

  /** 위성 점 각도 배치 — 감시 건수만큼 궤도 위에 고르게 놓는다. 12시 방향에서
   * 시작해 시계 방향으로 등분한다. 순수 함수라 count만으로 결과가 정해진다. */
  function computeSatelliteDots(count) {
    const n = Math.max(0, Math.floor(Number(count)) || 0);
    const dots = [];
    for (let i = 0; i < n; i++) dots.push({ angle: (360 / n) * i });
    return dots;
  }

  /** 감시 0건이면 링 자체를 그리지 않는다 — 없는 감시를 있는 것처럼 보이면
   * 안 된다. createElement/textContent만 쓴다(innerHTML 0건, 함정 ⑪). */
  function renderSatelliteRing(count) {
    const n = Math.max(0, Math.floor(Number(count)) || 0);
    $root.dataset.watching = n > 0 ? 'true' : 'false';
    $ring.replaceChildren();
    for (const dot of computeSatelliteDots(n)) {
      const el = document.createElement('span');
      el.className = 'orb-ring-dot';
      el.style.setProperty('--dot-angle', `${dot.angle}deg`);
      $ring.appendChild(el);
    }
  }

  // 셸 대화 컨트롤 스트립(refreshChatControlStrip)과 같은 IPC를 재사용한다 —
  // 오브가 감시 목록을 새로 만들지 않는다. 상시 열린 창이라 초 단위 폴링은
  // 낭비다 — 60s 간격 + 루틴 이벤트 수신 시 갱신이면 충분하다.
  async function refreshSatelliteRing() {
    try {
      const res = await window.athena.invoke('athena:routines-list');
      const routines = res && res.ok && res.data && Array.isArray(res.data.routines) ? res.data.routines : [];
      renderSatelliteRing(routines.filter((r) => r.status === 'active').length);
    } catch { /* 표시만 못한다 — 감시 자체엔 영향 없다 */ }
  }

  refreshSatelliteRing();
  setInterval(refreshSatelliteRing, 60000);

  // ─────────────────────────────────────────────────────────────────────
  // 표정 · 대기 루프 (2026-08-25)
  //
  // 표정은 **눈 모양 하나로만** 만든다 — 눈썹도 입도 눈동자도 붙이지 않는다.
  // 시선은 흰 도형 두 개가 바이저 안에서 통째로 옮겨 앉는 것으로 낸다.
  // 모양은 전부 orb.css의 [data-face] 규칙이 지고, 여기서는 **언제 어느 얼굴인가**만
  // 정한다.
  //
  // **얼굴은 앱에 이미 있는 신호에만 붙인다.** 지금 배선하는 것은 열이다:
  //   idle   — 기본(대기)
  //   sleep  — 오래 아무 일 없음(idle > 5min. 옛 판의 '평소'가 여기로 내려왔다)
  //   drowsy — 장 마감 시간대(board-30⑫/31⑨) — 2026-08-27 갭 클로징 Step 6
  //            신규. sleep과 다른 축이다: sleep은 사용자 무활동 5분(로컬 사실),
  //            drowsy는 KST 평일 09:00~15:30 밖(세계 사실 — market-hours.js
  //            isMarketOpen). 바이저는 줄지 않는다(풀사이즈, 팀 실측) — 눈만
  //            처진다. listen/think보다 아래, sleep보다도 아래(둘 다 활성인
  //            폐장 중 5분 무활동이면 더 깊은 sleep이 이긴다 — settleAmbientFace).
  //   listen — 셸 입력줄 포커스(input:focus) — 2026-08-26 board-32 신규
  //   think  — 질의 진행 중(query running) — 2026-08-26 board-32 신규. 스피너 대신이다
  //   done   — 턴 완료(result ok) — 2026-08-26 board-32 신규. 웃고 2초 뒤 idle로 돌아간다
  //   wink   — 감시 등록 반영(athena:routine-confirm 성공 릴레이) — 2026-08-27
  //            갭 클로징 Step 3b 신규. done과 같은 구조(DONE_HOLD 뒤 settleAmbientFace
  //            복귀)지만 전용 타이머를 따로 둬서 둘이 서로 안 밟는다.
  //   frown  — 대화 질의 실패(result.ok===false) — 2026-08-27 갭 클로징 Step 4a 신규.
  //            done/wink와 같은 구조·같은 유지 시간이다. Step 4b부터는 루틴 피드
  //            연결 끊김(disconnected) 동안에도 같은 얼굴을 쓴다 — 이쪽은 타이머로
  //            안 풀리고 connected가 올 때까지 지속된다(아래 feedDown 축).
  //   fired  — 미확인 알림이 있다(data-alert와 짝)
  //   surprise — 발화 중 급변(관측값이 임계 초과폭 1.5배 이상 —
  //            routine-turn.js exceedRatio) — 2026-08-27 갭 클로징 Step 5 신규.
  //            fired를 대체한다(같은 unread 생애주기 — 읽으면 같이 풀린다,
  //            아래 renderPresence 주석 참조) — 배지·카운트는 그대로
  //            data-alert="fired"를 쓴다(board-31⑤ "변동성 급등").
  //   mopey  — 루틴 만료(routineTurn kind: expired) — 옛 '미안'의 절반
  //   crying — 감시 복원 실패(routineTurn kind: restore-failed) — 옛 '미안'의 나머지 절반
  // 2026-08-26: '미안' 하나가 만료·복원실패 둘을 뭉뚱그렸는데, routine-turn.js가
  // 이미 kind로 둘을 갈라 준다 — 같은 사실을 오브만 뭉개고 있었다(board-31).
  // watch/glad는 아직 CSS에 모양만 있고 배선하지 않는다 — 판정에 필요한 데이터가
  // 없어 백로그로 유예했다(CP1/CP3, orb.js 상단 주석). 없는 신호에 얼굴을
  // 붙이면 그건 정보가 아니라 지어낸 연기다(soul.md).
  const FACE = {
    IDLE: 'idle', SLEEP: 'sleep', DROWSY: 'drowsy', LISTEN: 'listen', THINK: 'think', DONE: 'done',
    WINK: 'wink', FROWN: 'frown', FIRED: 'fired', SURPRISE: 'surprise', MOPEY: 'mopey', CRYING: 'crying',
  };

  const BLINK_CLOSE = 90;          // 감는 시간
  const BLINK_OPEN = 130;          // 뜨는 시간 — 감는 쪽보다 느려야 셔터로 안 읽힌다
  const BLINK_EVERY = [4000, 7000];
  const BLINK_DOUBLE = 0.15;       // 가끔 두 번 연속 — 이 불규칙이 생물이라는 증거다
  // 2026-08-26 2차 — 사용자 지적("눈이 너무 왔다갔다한다, 심란함"). board-32
  // 원문도 "가끔 두리번거린다"다 — 가끔이 핵심이지 빈도가 아니다. 간격을 15~40s로
  // 늘리고 진폭도 줄인다: 대기는 거의 정지 + 아주 가끔 두리번 + 깜빡임뿐이어야 한다.
  const SACCADE_EVERY = [15000, 40000];
  const SACCADE_OUT = 260;         // 갈 때는 빠르고
  const SACCADE_BACK = 340;        // 돌아올 때는 느리다 — 사람 눈이 그렇다
  const SACCADE_HOLD = 1200;
  const SACCADE_AMP = 5;           // px — 7에서 축소, 곁눈질 정도로만
  const SLEEP_AFTER = 5 * 60 * 1000;

  const CURSOR_RADIUS = 320;       // 화면 px — 이 밖의 커서는 쳐다보지 않는다
  const CURSOR_AMP = 3;            // px — 두리번(5)보다 작아야 '곁눈질'로 읽힌다
  const CURSOR_INTEREST = 2500;    // 커서가 멈춰 있으면 이 뒤에 시선을 놓는다
  const CURSOR_LAG = 120;          // 0이면 눈이 커서에 붙어버려 기계가 된다

  const LISTEN_GAZE_Y = 6;         // px — 듣는 중 시선이 입력줄 쪽(아래)으로 내려앉는 양
  // 생각 중 시선 — "위를 훑는다"는 스피너 대신 천천히 미끄러지는 드리프트다.
  // 처음엔 520ms마다 좌우로 튀게 짜서 "왔다갔다"로 읽혔다(사용자 지적) — 간격을
  // 늘리고 전이 시간도 같이 늘려 급한 왕복이 아니라 느린 표류로 보이게 한다.
  const THINK_SWEEP_EVERY = 2600;  // ms — 생각 중 시선이 위를 훑는 주기
  const THINK_SWEEP_DUR = 1400;    // ms — 느린 전이(예전 260ms는 홱 튀는 느낌이었다)
  const THINK_SWEEP_AMP = 4;       // px — 두리번(5)보다도 작게, 미세한 표류
  const DONE_HOLD = 2000;          // ms — 완료 웃음이 유지되는 시간(board-32)
  const DRAG_THRESHOLD = 4;        // px — 이보다 적게 움직이면 클릭, 넘으면 드래그
  const DRAG_GAZE_AMP = 6;         // px — 드래그 관성 시선 진폭

  // 모션을 원치 않는 사용자에게는 루프를 **아예 돌리지 않는다.** CSS로 전이만 끄면
  // 타이머는 계속 돌면서 감은 프레임에서 굳을 수 있고, 그건 없는 상태('잠듦')를
  // 만들어내는 것이다(orb.css의 같은 이유 주석과 짝).
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let face = FACE.IDLE;
  let lastSignalAt = Date.now();
  let blinkTimer = null;
  let saccadeTimer = null;
  let doneTimer = null;
  let winkTimer = null;
  let frownTimer = null;

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function setGaze(gx, gy, durMs) {
    $root.style.setProperty('--orb-gaze-dur', `${durMs}ms`);
    $root.style.setProperty('--orb-gx', `${gx.toFixed(2)}px`);
    $root.style.setProperty('--orb-gy', `${gy.toFixed(2)}px`);
  }

  /** 표정의 기본 시선. 듣는 중만 아래(입력줄)로 내려앉는다 — 나머지는 정면이다.
   * 생각 중의 "위를 훑는다"는 정지 시선이 아니라 루프라서 startThinkSweep()이
   * 별도로 --orb-gx/gy를 몬다(여기 baseGaze는 그 루프의 출발점만 준다). */
  function baseGaze() {
    if (face === FACE.LISTEN) return { gx: 0, gy: LISTEN_GAZE_Y };
    return { gx: 0, gy: 0 };
  }

  function setFace(next) {
    if (face === next) return;
    const prev = face;
    face = next;
    $root.dataset.face = next;
    if (prev === FACE.THINK) stopThinkSweep();
    if (next === FACE.THINK) { startThinkSweep(); return; }
    const g = baseGaze();
    setGaze(g.gx, g.gy, SACCADE_BACK);
  }

  // ── 생각 중 — 스피너 대신 시선이 위를 훑는다(board-32 section C). ──
  let thinkTimer = null;

  function startThinkSweep() {
    clearInterval(thinkTimer);
    if (reduceMotion.matches) { setGaze(0, -THINK_SWEEP_AMP * 0.85, SACCADE_BACK); return; }
    let dir = -1;
    setGaze(dir * THINK_SWEEP_AMP, -THINK_SWEEP_AMP * 0.85, THINK_SWEEP_DUR);
    thinkTimer = setInterval(() => {
      dir *= -1;
      setGaze(dir * THINK_SWEEP_AMP, -THINK_SWEEP_AMP * 0.85, THINK_SWEEP_DUR);
    }, THINK_SWEEP_EVERY);
  }

  function stopThinkSweep() {
    clearInterval(thinkTimer);
    thinkTimer = null;
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
      // 잠들었거나 졸리면 눈이 이미 (거의) 감겨 있다 — drowsy 눈 높이가 sleep과
      // 같은 6.5%라 그 위에 깜빡임을 얹으면 똑같이 경련처럼 보인다.
      if (face === FACE.SLEEP || face === FACE.DROWSY) { scheduleBlink(); return; }
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
    // drowsy(장 마감)에서도 5분 무활동이 쌓이면 더 깊은 sleep으로 넘어간다 —
    // sleep이 drowsy보다 우선하는 축이라서(settleAmbientFace) idle뿐 아니라
    // drowsy에서도 승격을 허용해야 한다. 그 밖의 능동 표정(listen/think 등)은
    // 여전히 막는다.
    if (face !== FACE.IDLE && face !== FACE.DROWSY) return;
    if (Date.now() - lastSignalAt >= SLEEP_AFTER) setFace(FACE.SLEEP);
  }, 15000);

  // ── 장 마감(board-30⑫/31⑨) — KST 평일 09:00~15:30 밖이면 졸림. 세계 시각
  // 사실이라 사용자 상호작용과 무관하게 매 15초 재확인한다(위 sleep 판정과
  // 같은 주기 패턴 재사용) — settleAmbientFace가 그 값을 읽어 우선순위를 잰다.
  // 부트 호출(updateMarketClosed() 최초 실행 + setInterval)은 파일 맨 끝에
  // 있다 — resolveAmbientFace가 읽는 thinking/feedDown/listening이 아직
  // 선언 전(TDZ)이라 여기서 바로 부르면 터진다. */
  let marketClosed = false;

  function updateMarketClosed() {
    marketClosed = marketHours ? !marketHours.isMarketOpen(new Date()) : false;
    resolveAmbientFace();
  }

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

  // ── 듣는 중 · 생각 중 · 완료 — 셸 쪽 실신호(2026-08-26 board-32) ──
  // chat.js가 input:focus/blur와 질의 시작/끝을 athena:orb-signal로 보낸다.
  // main은 그대로 릴레이만 한다(routine-event와 같은 얇은 다리). 우선순위는
  // 발화·만료·복원실패(event-driven face)가 가장 세다 — 능동 알림 위에 "듣는
  // 중"을 덮어씌우면 진짜 신호가 묻힌다.
  let listening = false;
  let thinking = false;
  // 루틴 피드 연결 끊김(board-30⑩) — listening/thinking과 같은 층의 축이다.
  // 다른 둘과 달리 타이머로 안 풀리고 'connected' 신호가 와야 풀린다(연결이
  // 죽어 있는 동안 계속 사실이니까) — 그래서 이 축은 done/wink/frown 같은
  // DONE_HOLD 일시 표정이 아니라 앰비언트 판정(settleAmbientFace) 쪽에 있다.
  let feedDown = false;

  function eventFaceActive() {
    // WINK·FROWN은 DONE과 같은 격이다(셋 다 신호 하나에 반응해 DONE_HOLD만큼
    // 떴다가 스스로 꺼지는 일시 표정) — DONE을 여기 넣은 이유(듣는 중/생각
    // 중 같은 능동 표정이 유지 시간 안에 끼어들어 조기에 지우면 안 된다)가
    // 셋 모두에 그대로 적용된다. SURPRISE는 FIRED의 대체 표현이라(같은
    // unread 기반 알림) FIRED와 같은 줄에 둔다 — 이게 없으면 급변 발화 중에도
    // listen/think 같은 능동 표정이 surprise를 밀어낸다.
    return face === FACE.FIRED || face === FACE.SURPRISE || face === FACE.MOPEY || face === FACE.CRYING
      || face === FACE.DONE || face === FACE.WINK || face === FACE.FROWN;
  }

  /** 앰비언트(듣는 중/생각 중/잠듦/기본) 판정의 공통 계산 — resolveAmbientFace와
   * done·wink 타이머가 같이 쓴다(하나로 통일해야 규칙이 두 벌로 안 갈린다). */
  function settleAmbientFace() {
    if (thinking) { setFace(FACE.THINK); return; }
    // 피드가 죽어 있는 동안은 찡그림을 깔아 둔다 — 듣는 중보다는 위, 생각
    // 중보다는 아래(생각 중은 지금 실제로 진행 중인 일이라 더 급하다).
    if (feedDown) { setFace(FACE.FROWN); return; }
    if (listening) { setFace(FACE.LISTEN); return; }
    // sleep(무활동 5분)이 drowsy(장 마감)보다 우선한다 — sleep은 drowsy 위에
    // 얹힌 더 깊은 상태로만 도달한다(위 sleep 승격 타이머가 idle뿐 아니라
    // drowsy에서도 승격을 허용한다). 그래서 이미 sleep이면 유지하고, 아니면
    // marketClosed로 drowsy/idle을 가른다.
    setFace(face === FACE.SLEEP ? FACE.SLEEP : (marketClosed ? FACE.DROWSY : FACE.IDLE));
  }

  function resolveAmbientFace() {
    if (eventFaceActive()) return;
    settleAmbientFace();
  }

  window.athena.on('athena:orb-signal', ({ signal, active, status } = {}) => {
    if (signal === 'listen') {
      listening = !!active;
      if (listening) touchActivity();
      resolveAmbientFace();
    } else if (signal === 'think') {
      thinking = !!active;
      if (thinking) touchActivity();
      resolveAmbientFace();
    } else if (signal === 'done') {
      triggerDoneFace();
    } else if (signal === 'registered') {
      triggerWinkFace();
    } else if (signal === 'feed-status') {
      handleFeedStatus(status);
    }
  });

  // 루틴 피드 연결 상태(board-30⑩) — main.js RoutineFeed의 status를 그대로
  // 받는다({state: 'connected'|'disconnected'|'unsupported'}). disconnected는
  // 실제 끊김이라 지속 찡그림을 켜고, connected 복귀 시 끈다. unsupported는
  // 신호가 아니라 무시한다 — 이 런타임에 WebSocket 구현 자체가 없다는 뜻이지
  // "연결하다가 끊겼다"는 사실이 아니다(연결 시도조차 하지 않는다).
  function handleFeedStatus(status) {
    const state = status && status.state;
    if (state === 'disconnected') {
      feedDown = true;
      touchActivity();
      resolveAmbientFace();
    } else if (state === 'connected') {
      feedDown = false;
      // resolveAmbientFace가 아니라 settleAmbientFace를 직접 부른다 — face가
      // 여전히 FROWN이면(방금까지 feedDown이 그걸 골랐으니 그럴 확률이 높다)
      // eventFaceActive()가 지금 막 끄려는 그 FROWN 자신을 "아직 활성"으로
      // 오판해 되돌림을 막는다(triggerDoneFace/triggerWinkFace 주석과 같은
      // 자기참조 함정). 다만 발화·만료·복원실패처럼 정말 더 급한 사실 위는
      // 연결 복구 따위로 덮으면 안 된다.
      if (face === FACE.FIRED || face === FACE.SURPRISE || face === FACE.MOPEY || face === FACE.CRYING) return;
      settleAmbientFace();
    }
  }

  // 완료 웃음 — 셸의 'done' 실신호와 오브 자신의 대화 모드 제출(2026-08-26
  // board-33)이 공유한다. 발화·만료·복원실패 중에는 덮지 않는다 — 그쪽이 더
  // 중요한 사실이다.
  function triggerDoneFace() {
    if (face === FACE.FIRED || face === FACE.SURPRISE || face === FACE.MOPEY || face === FACE.CRYING) return;
    touchActivity();
    setFace(FACE.DONE);
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      // resolveAmbientFace가 아니라 settleAmbientFace를 직접 부른다 — 얼굴은
      // 값이 하나뿐이라 이 시점의 face는 항상 DONE과 "같다"(자기 자신이니까),
      // 그래서 resolveAmbientFace를 거치면 eventFaceActive()가 "DONE이 아직
      // 활성"이라고 스스로 오판해 절대 못 빠져나간다(자기 참조 교착 — 실측:
      // 2026-08-27 프로브가 DONE_HOLD 경과 후에도 계속 'done'을 잡아냈다,
      // wink를 얹으며 발견). 그사이 다른 이벤트가 face를 바꿔놨으면(fired 등)
      // 아래 체크로 손대지 않는다.
      if (face === FACE.DONE) settleAmbientFace();
    }, DONE_HOLD);
  }

  // 윙크 — 감시 등록 반영(main.js athena:routine-confirm 성공 릴레이, board-30⑧/
  // 31③). triggerDoneFace와 같은 구조지만 별도 타이머(winkTimer)를 쓴다 —
  // 두 표정이 겹치는 타이밍에 서로의 setTimeout을 밟지 않게 하려면(각 타이머는
  // 자기 얼굴일 때만 되돌린다) 축을 나눠야 한다.
  function triggerWinkFace() {
    if (face === FACE.FIRED || face === FACE.SURPRISE || face === FACE.MOPEY || face === FACE.CRYING) return;
    touchActivity();
    setFace(FACE.WINK);
    clearTimeout(winkTimer);
    winkTimer = setTimeout(() => {
      // settleAmbientFace 직접 호출 이유는 triggerDoneFace 주석과 같다.
      if (face === FACE.WINK) settleAmbientFace();
    }, DONE_HOLD);
  }

  // 찡그림 — 대화 질의 실패(board-30⑩). submitChatQuery가 result.ok===false를
  // 확정하는 지점에서 부른다. done/wink와 같은 구조·같은 전용 타이머 원칙.
  function triggerFrownFace() {
    if (face === FACE.FIRED || face === FACE.SURPRISE || face === FACE.MOPEY || face === FACE.CRYING) return;
    touchActivity();
    setFace(FACE.FROWN);
    clearTimeout(frownTimer);
    frownTimer = setTimeout(() => {
      if (face === FACE.FROWN) settleAmbientFace();
    }, DONE_HOLD);
  }

  // ── 드래그 — 포인터로 창을 옮긴다(2026-08-26 board-32). ──
  // app-region:drag를 안 쓰는 이유는 orb.css #orb 규칙 위 주석 참조: OS가 이동을
  // 가로채면 이동량이 렌더러에 안 들어와 "관성" 시선을 그릴 수 없다. 그래서
  // pointerdown에서 포인터를 캡처하고, pointermove의 movementX/Y(창 위치와
  // 무관한 원시 이동량)를 그대로 main에 실어 보낸다 — main이 오브 창의 현재
  // getBounds()에 더해 setPosition한다(athena:orb-drag-move).
  //
  // 클릭(펼치기)과의 구분: 문턱(4px) 전까지는 그냥 pointerdown일 뿐이고, 넘는
  // 순간부터 드래그로 확정한다. 문턱을 넘은 상호작용이면 뒤이어 오는 클릭
  // 이벤트를 한 번 삼킨다(justDragged) — 안 그러면 드래그 후 손을 뗀 자리에서
  // 펼침까지 같이 터진다.
  let dragPointerId = null;
  let dragMoved = false;
  let justDragged = false;
  let dragGazeTimer = null;

  function pushDragGaze(mx, my) {
    const mag = Math.hypot(mx, my) || 1;
    // 끌리는 방향 반대로 밀린다(관성) — board-32 "B · 시선" 사용자 항목.
    setGaze((-mx / mag) * DRAG_GAZE_AMP, (-my / mag) * DRAG_GAZE_AMP * 0.85, 70);
    clearTimeout(dragGazeTimer);
    dragGazeTimer = setTimeout(() => {
      const g = baseGaze();
      setGaze(g.gx, g.gy, SACCADE_BACK);
    }, 220);
  }

  $orb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dragPointerId !== null) return;
    dragPointerId = e.pointerId;
    dragMoved = false;
    $orb.setPointerCapture(dragPointerId);
  });

  $orb.addEventListener('pointermove', (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    // 4px 문턱 — pointerdown 이후 첫 pointermove부터 여기 온다. 프레임당
    // movementX/Y는 보통 문턱보다 작지만, 이동이 실제로 있었다는 사실 자체가
    // "누르고 안 놓은 채 움직였다"이므로 드래그로 확정해도 된다 — 진짜 클릭은
    // pointerup까지 pointermove가 거의 안 온다(사람 손 떨림 수준만 온다).
    if (!dragMoved && Math.hypot(e.movementX, e.movementY) < DRAG_THRESHOLD) return;
    dragMoved = true;
    // 들림(board-30③) — 문턱을 넘어 드래그로 확정되는 순간 커진다. endDrag가
    // 뗀다. "들린 만큼 그림자가 멀어진다"는 orb.css [data-dragging] #orb가 진다.
    $root.dataset.dragging = 'true';
    touchActivity();
    window.athena.send('athena:orb-drag-move', { dx: e.movementX, dy: e.movementY });
    if (!reduceMotion.matches) pushDragGaze(e.movementX, e.movementY);
  });

  function endDrag(e) {
    if (dragPointerId === null || (e && e.pointerId !== dragPointerId)) return;
    if ($orb.hasPointerCapture(dragPointerId)) $orb.releasePointerCapture(dragPointerId);
    dragPointerId = null;
    delete $root.dataset.dragging;
    if (dragMoved) {
      justDragged = true;
      clearTimeout(dragGazeTimer);
      const g = baseGaze();
      setGaze(g.gx, g.gy, SACCADE_BACK);
    }
    dragMoved = false;
  }

  $orb.addEventListener('pointerup', endDrag);
  $orb.addEventListener('pointercancel', endDrag);

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
    requestPanelHeight();
  }

  // ── 패널 높이 — 400 기본, 콘텐츠만큼 자라 640에서 멈춘다(board-33) ──
  // 창 크기는 여기서도 main이 정한다(orb-toggle의 기존 계약 그대로) — 렌더러는
  // "이 정도면 안 잘린다"는 값만 재서 실어 보낸다. 얼굴(#orb)은 anchor 배치라
  // 패널이 자라도 제자리다 — 새 계산이 필요 없다.
  const PANEL_HEIGHT_BASE = 400;
  const PANEL_HEIGHT_MAX = 640;

  function measureContentHeight() {
    const head = $panel.querySelector('.orb-panel-head');
    // 대화 모드(상태 A)와 알림 모드(상태 B)는 서로 다른 본문을 잰다 — 숨긴
    // 쪽의 offsetHeight는 항상 0이라 섞어 재도 안전하지만, 명시하는 편이 다음
    // 사람에게 "왜 이 부분들인가"를 남긴다.
    const parts = chatModeActive
      ? [head, $chatBody, $inputStack].filter(Boolean)
      : [head, $body, $card, $foot].filter(Boolean);
    // scrollHeight는 overflow:auto인 영역에서도 잘리지 않은 실제 콘텐츠 높이를
    // 준다 — 지금 보이는 크기가 아니라 필요한 크기를 재는 이유다.
    const content = parts.reduce((sum, el) => sum + Math.max(el.offsetHeight, el.scrollHeight), 0);
    const gaps = 8 * Math.max(0, parts.length - 1); // .orb-panel gap(orb.css)
    const padY = 28; // .orb-panel padding 14px 위아래(orb.css)
    return content + gaps + padY;
  }

  function requestPanelHeight() {
    if (!expanded) return;
    const height = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_BASE, measureContentHeight()));
    window.athena.send('athena:orb-toggle', { expanded: true, height });
  }

  function setExpanded(next) {
    if (expanded === next) return;
    expanded = next;
    // 창 크기 변경은 main이 한다(기하는 orb-window.js가 계산한다). 렌더러는
    // 요청만 하고, main이 anchor를 돌려주면 그때 상태를 반영한다.
    window.athena.send('athena:orb-toggle', { expanded: next });
  }

  // ── 대화 모드 게이트 — 셸이 숨겨졌는지 하나로 결정된다(board-33/34) ──
  let shellHidden = false;
  let chatModeActive = false;

  function applyMode() {
    const next = shellHidden;
    if (chatModeActive === next) return;
    chatModeActive = next;
    $root.dataset.orbMode = chatModeActive ? 'chat' : 'alert';
    $headerTitle.textContent = chatModeActive ? '메인 대화' : '알림';
    for (const el of ALERT_ONLY_ELS) el.classList.toggle('orb-mode-hidden', chatModeActive);
    $chatBody.hidden = !chatModeActive;
    $inputStack.hidden = !chatModeActive;
    if (chatModeActive) {
      $chatEmpty.hidden = $chatTurns.childElementCount > 0;
      refreshChatControlStrip();
    }
    if (expanded) requestPanelHeight();
  }

  window.athena.on('athena:shell-visibility', ({ hidden } = {}) => {
    shellHidden = !!hidden;
    applyMode();
  });

  // main이 창 크기를 실제로 바꾼 뒤에 온다 — 렌더러가 먼저 펼치면 창보다 큰
  // 패널이 한 프레임 잘려 보인다.
  window.athena.on('athena:orb-state', ({ expanded: isOpen, anchor } = {}) => {
    if (anchor) $root.dataset.anchor = anchor;
    $root.dataset.state = isOpen ? 'expanded' : 'collapsed';
    $panel.hidden = !isOpen;
    expanded = !!isOpen;
    applyMode();
    if (isOpen && chatModeActive) {
      // 대화 모드에서는 "펼침 = 확인 처리"가 아니다 — 알림(unread, 루틴
      // 이벤트)은 다른 방이다(board-34 "방은 알림에서만 생긴다"), 그건 그대로
      // 둔다. 하지만 접힌 채 도착한 대화 답(board-33⑥)은 다르다 — 지금
      // 펼치는 이 화면(chatModeActive)이 바로 그 턴을 보여주는 화면 자체다
      // ($chatTurns가 이미 담고 있다). "본 것을 안 봤다고 하지 않는다"가
      // 여기서는 이 순간 확인 처리하는 쪽이다.
      if (foldedChatAnswers > 0) { foldedChatAnswers = 0; renderPresence(); }
      $chatInput.focus();
      return;
    }
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
    // 루틴 상태가 바뀌었을 수 있다(만료·발화 등) — 감시 궤도 링 수를 다시 잰다.
    refreshSatelliteRing();
    if (expanded && !chatModeActive) {
      // 이미 펼쳐져 있으면 바로 갈아끼운다 — 쌓아두면 최신이 아닌 것을 보게 된다.
      // 대화 모드로 펼쳐진 동안에는(이론상 셸이 그새 열렸다가 다시 숨는 등)
      // 진행 중인 대화를 알림이 덮지 않는다 — 그냥 미확인으로 쌓아둔다.
      renderPanel(event);
      return;
    }
    unread.push(event);
    renderPresence();
    // 발화가 아닌 종류(만료·복원 실패)는 활짝 여는 얼굴이 아니다. 같은 결정론
    // 템플릿의 kind를 그대로 읽어 쓴다 — 여기서 따로 판정하면 두 벌이 된다.
    const kind = routineTurn.buildTurnModel(event, Date.now()).kind;
    if (kind === 'expired') setFace(FACE.MOPEY);
    else if (kind === 'restore-failed') setFace(FACE.CRYING);
    // 급변(board-31⑤) — renderPresence가 방금 세운 FIRED를 대체한다. "눈
    // 모양만 바꾼다"와 "fired 대신 surprise를 켠다"가 여기서는 같은 조작이다:
    // 이 파일의 표정은 눈 모양 하나로만 지어지므로(orb.js 상단 주석), face
    // 값 자체가 곧 눈 모양이다 — 별도로 "덧씌우는" 채널이 없다. 배지·카운트는
    // renderPresence가 이미 정한 data-alert="fired"를 그대로 쓴다(단일 책임 유지).
    else if (kind === 'fired' && routineTurn.exceedRatio(event.observed, event.threshold)) setFace(FACE.SURPRISE);
  });

  // 2026-08-26 실사용 회귀("오브를 어떻게 펼쳐? 안펼쳐") — 리스너를 $toggle이
  // 아니라 $orb에 건다. 원인 실측: $orb.setPointerCapture(위 pointerdown)이
  // 활성화되는 타이밍이 비결정적이라(같은 tick에 pointerup까지 오면 캡처가
  // gotpointercapture로 붙어버리고, 그 사이 pointermove가 한 번이라도 끼면
  // 안 붙는다 — Chromium 쪽 타이밍 경합), 캡처가 붙은 경우 click의 target이
  // 실제 클릭 지점(#orbToggle)이 아니라 캡처 요소(#orb)로 바뀐다. $toggle에
  // 리스너가 있으면 그 click은 $toggle까지 버블링될 조상 경로가 아니라서
  // 그냥 사라진다(계측 로그로 확인 — target:"orb"). $orb는 어느 쪽으로
  // 리타깃되든(orb 자신이거나, orb의 자손인 orbToggle이거나) 항상 버블 경로
  // 위에 있어 이 경합에 안전하다.
  $orb.addEventListener('click', () => {
    // 드래그 문턱을 넘긴 상호작용의 꼬리에 붙는 클릭 1건을 삼킨다 — 안 그러면
    // 오브를 옮기고 손을 뗀 자리에서 펼침까지 같이 터진다.
    if (justDragged) { justDragged = false; return; }
    touchActivity();
    setExpanded(!expanded);
  });
  $close.addEventListener('click', () => { touchActivity(); setExpanded(false); });

  // 알림에서 셸로 가는 경로. 셸 창을 앞으로 가져오고 대표 카드를 중앙 캔버스에
  // 쌓는다 — main이 기존 facts 봉투로 접어 보낸다(신규 카드 타입 0개).
  $more.addEventListener('click', () => {
    if (!current) return;
    window.athena.send('athena:orb-open-shell', { event: current });
    setExpanded(false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 대화 모드(2026-08-26 board-33) — 상태 A(셸 숨김)에서만 산다.
  // 질의는 athena:orb-chat-submit 하나로 나간다 — main의 runLiveQuery를
  // 그대로 부르는 것뿐, 별도 파이프라인이 아니다(orb.js 상단 주석 참고).
  // ─────────────────────────────────────────────────────────────────────
  let chatBusy = false;
  // 셸이 돌리고 있는 질의 — athena:live-query-state 브로드캐스트로 안다(2026-08-26
  // 어드버서리얼 리뷰 결함 #1). chat.js는 이미 이 이벤트를 구독해 오브가 대화
  // 중이면 셸 입력을 잠근다(chat.js remoteQueryBusy와 짝) — 반대 방향이 없어서
  // 오브가 셸의 진행 중 질의를 조용히 죽이는 사고로 이어졌다.
  let remoteQueryBusy = false;

  // 판정은 lib/live-query-lock.js(순수 함수) 하나로 통일한다 — chatBusy·
  // remoteQueryBusy가 바뀔 때마다 여기 하나만 부르면 입력 잠금·안내 문구가
  // 항상 같은 규칙으로 갱신된다.
  function syncInputLock() {
    const lock = liveQueryLock.resolveInputLock({ chatBusy, remoteQueryBusy });
    $chatInput.disabled = lock.disabled;
    $lockHint.hidden = lock.hintHidden;
    if (lock.hintText) $lockText.textContent = lock.hintText;
  }

  window.athena.on('athena:live-query-state', ({ busy } = {}) => {
    remoteQueryBusy = !!busy;
    syncInputLock();
  });

  function orbTurn(className) {
    const el = document.createElement('div');
    el.className = className;
    return el;
  }

  function renderChatQuestion(text) {
    const line = orbTurn('orb-turn');
    const q = document.createElement('div');
    q.className = 'orb-turn-q';
    q.textContent = text;
    line.appendChild(q);
    $chatTurns.appendChild(line);
    return line;
  }

  function renderProgressCard() {
    const card = orbTurn('orb-progress-card');
    const judging = document.createElement('div');
    judging.className = 'orb-progress-judging';
    judging.textContent = '판단 중';
    const steps = document.createElement('div');
    steps.className = 'orb-tool-steps';
    card.append(judging, steps);
    $chatTurns.appendChild(card);
    card._steps = steps;
    card._byId = new Map(); // DOM 엘리먼트 캐시(id별)
    card._stepStates = new Map(); // tool-step-track.applyToolStep이 드는 판정 상태(id별)
    return card;
  }

  // 판정은 lib/tool-step-track.js(순수 함수) 하나로 통일한다 — chat.js도
  // 같은 모듈을 쓴다(2026-08-26 어드버서리얼 리뷰 결함 #3, 라벨 두 벌 방지).
  function updateProgressStep(card, step) {
    if (!card || !card.isConnected) return;
    const result = toolStepTrack.applyToolStep(card._stepStates, step);
    if (!result) return;
    let el = card._byId.get(result.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'orb-tool-step';
      const icon = document.createElement('span');
      icon.className = 'orb-tool-step-icon';
      const label = document.createElement('span');
      label.className = 'orb-tool-step-label';
      const time = document.createElement('span');
      time.className = 'orb-tool-step-time';
      el.append(icon, label, time);
      card._steps.appendChild(el);
      card._byId.set(result.id, el);
    }
    el.classList.toggle('done', result.done);
    el.querySelector('.orb-tool-step-label').textContent = result.label;
    el.querySelector('.orb-tool-step-time').textContent = result.timeText;
    requestPanelHeight();
  }

  function renderChatAnswer(text) {
    const line = orbTurn('orb-turn');
    const a = document.createElement('div');
    a.className = 'orb-turn-a';
    a.textContent = text;
    line.appendChild(a);
    $chatTurns.appendChild(line);
    return { line, textEl: a };
  }

  function scrollChatToBottom() {
    $chatBody.scrollTop = $chatBody.scrollHeight;
  }

  // ---------- board-33③④ 선행 — 캔버스 엔벌로프 축약 카드 ----------
  // main.js가 athena:orb-canvas-result로 relay하는 건 origin:'orb' 질의의
  // render_canvas 결과뿐이다(9a 결정) — 셸 캔버스와 같은 종류를 오브 안에서도
  // 실시간으로 축약해 보여준다.
  const ORB_FOLD_CARD_WIDTH_PX = 360; // 패널 400 - 카드 padding(12px×2) - 여유
  const ORB_TABLE_MAX_ROWS = 3; // 보드 실측(4XV-0) — 헤더 제외 3행까지만 편다

  // 카드 제목/부제 — canvas.js의 cardTitleAndSubtitle과 같은 규칙(card_title이
  // 고정 카드명이면 타이틀, caption은 부제로 내려간다). 오브는 별도 창(스크립트
  // 스코프도 분리)이라 그대로 참조할 수 없어 3줄짜리 규칙만 그대로 복제한다 —
  // 공유 모듈을 새로 만들 만큼 크지 않다.
  function orbCardTitleAndSubtitle(envelope, fallback) {
    const fixedTitle = envelope && typeof envelope.card_title === 'string' && envelope.card_title
      ? envelope.card_title
      : null;
    const caption = envelope && envelope.caption;
    if (fixedTitle) return [fixedTitle, caption || null];
    return [caption || fallback, null];
  }

  // 표 축약 카드(board-33③, Paper 4XV-0 실측) — column-fold.js의 foldColumns를
  // 셸 캔버스(1560px)가 아니라 오브 카드 폭(360px)에 다시 적용한다. 데이터
  // 셀 최소폭(90px)+패딩(24px)=114px라 360px에서는 짧은 라벨 기준 최대 3컬럼
  // 안팎까지만 보인다(column-fold.test.js가 이 가정을 고정한다). 셸의 16종
  // CardKinds 전용 렌더러는 재사용하지 않는다 — 일반 fold 표 하나로 충분한
  // 별도의 더 단순한 렌더러다.
  function buildOrbTableCard(envelope) {
    const rawCols = (envelope.data && Array.isArray(envelope.data.columns)) ? envelope.data.columns : [];
    const rows = (envelope.data && Array.isArray(envelope.data.rows)) ? envelope.data.rows : [];
    if (!rawCols.length || !rows.length) return null;

    const { visible: cols, hidden } = columnFold.foldColumns(rawCols, ORB_FOLD_CARD_WIDTH_PX);
    const visibleRows = rows.slice(0, ORB_TABLE_MAX_ROWS);
    const hiddenRowCount = rows.length - visibleRows.length;
    const [title, subtitle] = orbCardTitleAndSubtitle(envelope, '표');

    const card = document.createElement('div');
    card.className = 'orb-fold-card';

    const head = document.createElement('div');
    head.className = 'orb-fold-card-head';
    const titleEl = document.createElement('div');
    titleEl.className = 'orb-fold-card-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    if (subtitle) {
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'orb-fold-card-subtitle';
      subtitleEl.textContent = subtitle;
      head.appendChild(subtitleEl);
    }
    card.appendChild(head);

    function buildRow(cells, isHead) {
      const row = document.createElement('div');
      row.className = isHead ? 'orb-fold-row is-head' : 'orb-fold-row';
      cells.forEach((text, i) => {
        const cell = document.createElement('div');
        cell.className = i === 0 ? 'orb-fold-cell-label' : 'orb-fold-cell-value';
        cell.textContent = text;
        row.appendChild(cell);
      });
      return row;
    }

    const table = document.createElement('div');
    table.className = 'orb-fold-table';
    table.appendChild(buildRow(cols.map((col) => (col && col.label != null ? col.label : (col && col.key) || '')), true));
    for (const r of visibleRows) {
      table.appendChild(buildRow(cols.map((col) => {
        const v = r ? r[col.key] : undefined;
        return v == null ? '—' : String(v);
      }), false));
    }
    card.appendChild(table);

    // 결정론 축약 고지(보드 원문 형식) — 실제로 뭔가 접었을 때만 낸다. 아무것도
    // 안 접혔는데 "0개를 접었습니다"를 내는 건 정직성 계약에 어긋난다.
    if (hidden.length > 0 || hiddenRowCount > 0) {
      const note = document.createElement('div');
      note.className = 'orb-fold-note';
      note.textContent = `열 ${hidden.length}개 · 행 ${hiddenRowCount}개를 접었습니다 — 전체는 캔버스에서`;
      card.appendChild(note);
    }
    return card;
  }

  const ORB_CHART_WIDTH_PX = 336; // Paper 4ZM-0 실측 "차트 판 (336×116)"
  const ORB_CHART_HEIGHT_PX = 116;
  // canvas.js PERIOD_TITLE과 같은 값 — 오브는 별도 스크립트 스코프라 그대로
  // 참조할 수 없어 복제한다(키움 API 주기 6종 고정값이라 드리프트 위험이 낮다).
  const ORB_CHART_PERIOD_LABEL = Object.freeze({
    tick: '틱', min: '분봉', day: '일봉', week: '주봉', month: '월봉', year: '년봉',
  });

  // 오브용 미니 차트(board-33④, Paper 4ZM-0 실측) — 캔버스 차트(lightweight-charts
  // 툴바·지표·드로잉·매물대)의 축소판이 아니라 완전히 별도의 렌더러다(보드 캡션
  // 원문). 구성 상한: 가격 + 등락률 + 종가 라인 1개 + 시작/끝 날짜 2개까지 — 그
  // 외(그리드선·면적 채움·끝점 마커 포함)는 넣지 않는다. SVG는 createElementNS만
  // 쓴다(innerHTML 0, 게이트 규범).
  function buildOrbChartCard(envelope) {
    const data = envelope.data || {};
    const chart = data.chart && typeof data.chart === 'object' ? data.chart : null;
    const candles = chart && Array.isArray(chart.candles) ? chart.candles : [];
    const closes = candles.map((c) => c && c.close).filter((v) => v != null);
    if (closes.length < 2) return null; // 선 하나를 그릴 최소 조건(chartLinePoints와 같은 기준)

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const changeAmount = (last.close != null && prev.close != null) ? last.close - prev.close : null;
    const changePercent = (changeAmount != null && prev.close) ? (changeAmount / prev.close) * 100 : null;
    const tone = changeAmount != null ? factsCard.changeTone(undefined, changeAmount) : 'flat';

    const [title] = orbCardTitleAndSubtitle(envelope, data.symbol || '차트');
    const periodLabel = chart.period ? ORB_CHART_PERIOD_LABEL[chart.period] : null;

    const card = document.createElement('div');
    card.className = 'orb-fold-card';

    const head = document.createElement('div');
    head.className = 'orb-fold-card-head';
    const titleEl = document.createElement('div');
    titleEl.className = 'orb-fold-card-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    if (periodLabel) {
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'orb-fold-card-subtitle';
      subtitleEl.textContent = periodLabel;
      head.appendChild(subtitleEl);
    }
    card.appendChild(head);

    // 가격 헤드라인 — 캔들 close는 이미 정규화된 순수 숫자(normalizeChartCandle의
    // finiteOrNull)라 부호 오염이 없지만, 카드 렌더러 전반의 priceMagnitude→
    // formatNumeric 관례(card-primitives.js/facts-card.js)를 그대로 따른다.
    // 등락률은 방향이 의미라 부호를 그대로 남긴다(priceMagnitude를 안 거친다 —
    // ChangeBadge와 같은 원칙, card-primitives.js 주석 참조).
    const headline = document.createElement('div');
    headline.className = 'orb-chart-headline';
    const priceEl = document.createElement('span');
    priceEl.className = 'orb-chart-price';
    priceEl.textContent = factsCard.formatNumeric(cardPrimitives.priceMagnitude(last.close));
    headline.appendChild(priceEl);
    if (changeAmount != null) {
      const changeEl = document.createElement('span');
      changeEl.className = `orb-chart-change is-${tone}`;
      const sign = changeAmount > 0 ? '+' : '';
      const pct = changePercent != null ? ` (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)` : '';
      changeEl.textContent = `${sign}${factsCard.formatNumeric(changeAmount)}${pct}`;
      headline.appendChild(changeEl);
    }
    card.appendChild(headline);

    // 차트 판 — 종가 라인 1개만. 좌표 변환은 card-primitives.js chartLinePoints
    // (순수 함수, node --test 대상)가 하고 여기서는 DOM만 짓는다.
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(ORB_CHART_WIDTH_PX));
    svg.setAttribute('height', String(ORB_CHART_HEIGHT_PX));
    svg.setAttribute('viewBox', `0 0 ${ORB_CHART_WIDTH_PX} ${ORB_CHART_HEIGHT_PX}`);
    svg.setAttribute('class', 'orb-chart-svg');
    const points = cardPrimitives.chartLinePoints(closes, { width: ORB_CHART_WIDTH_PX, height: ORB_CHART_HEIGHT_PX });
    if (points.length) {
      const path = document.createElementNS(svgNS, 'path');
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      // 토큰을 SVG 프리젠테이션 속성에 그대로 쓴다(Paper 가이드 "SVGs support
      // design tokens through CSS variables for stroke and fill attributes").
      path.setAttribute('stroke', `var(--color-${tone})`);
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
    card.appendChild(svg);

    // 시작/끝 날짜 2개 — 구성 상한의 마지막 항목.
    const firstTime = candles[0] && candles[0].time;
    const lastTime = last.time;
    if (firstTime != null && lastTime != null) {
      const dates = document.createElement('div');
      dates.className = 'orb-chart-dates';
      const startEl = document.createElement('span');
      startEl.textContent = factsCard.formatDatetime(firstTime);
      const endEl = document.createElement('span');
      endEl.textContent = factsCard.formatDatetime(lastTime);
      dates.append(startEl, endEl);
      card.appendChild(dates);
    }

    // 능력 고지(보드 원문) — 축약 여부와 무관하게 항상 낸다(지표·드로잉·매물대가
    // 구조적으로 없는 렌더러라는 사실 자체를 알린다).
    const note = document.createElement('div');
    note.className = 'orb-fold-note';
    note.textContent = '지표 · 드로잉 · 매물대는 캔버스에서';
    card.appendChild(note);

    return card;
  }

  // canvas.js의 addLiveCard와 같은 1차 게이트(성공/폴백만 카드, 나머지는 통과)를
  // 따른다 — 'pushed'는 main.js 9a 결정으로 애초에 relay되지 않는다. rejected/
  // error/unparseable/그 밖의 canvas_type은 카드 없이 기존 "전체는 대화창에서
  // 이어집니다" 안내로 넘어간다.
  function buildOrbCanvasCard(r) {
    if (!r || (r.status !== 'success' && r.status !== 'fallback')) return null;
    const envelope = r.envelope;
    if (!envelope || envelope.fell_back) return null;
    if (envelope.canvas_type === 'table') return buildOrbTableCard(envelope);
    if (envelope.canvas_type === 'chart') return buildOrbChartCard(envelope);
    return null;
  }

  async function submitChatQuery(rawText) {
    const text = String(rawText || '').trim();
    if (!text || chatBusy || remoteQueryBusy) return;
    chatBusy = true;
    $chatEmpty.hidden = true;
    $chatInput.value = '';
    syncInputLock();
    setChatDot('judging');
    renderChatQuestion(text);
    const card = renderProgressCard();
    scrollChatToBottom();
    requestPanelHeight();

    thinking = true;
    touchActivity();
    resolveAmbientFace();

    let calling = false;
    let answer = null;
    // board-33③④ 선행 — answer가 아직 없으면(텍스트 델타보다 카드가 먼저 오는
    // 경로, main.js 주석 "카드 먼저, 텍스트는 나중" 참조) 카드를 잠깐 들고
    // 있다가 answer가 생기는 순간 이어붙인다.
    const pendingCanvasCards = [];
    const handledCanvasTypes = new Set();
    const unsubCanvas = window.athena.on('athena:orb-canvas-result', (r) => {
      const el = buildOrbCanvasCard(r);
      if (!el || !r.envelope) return;
      handledCanvasTypes.add(r.envelope.canvas_type);
      if (answer) {
        answer.line.appendChild(el);
        scrollChatToBottom();
        requestPanelHeight();
      } else {
        pendingCanvasCards.push(el);
      }
    });
    const unsubStep = window.athena.on('athena:live-tool-step', (step) => {
      if (!calling) { calling = true; setChatDot('calling'); }
      updateProgressStep(card, step);
    });

    // 추론 미리보기(2026-08-26 어드버서리얼 리뷰 결함 #2) — chat.js의
    // onLiveThinkingDelta와 같은 규칙: 답변 텍스트가 나오기 전 긴 침묵 구간을
    // 채우는 미리보기 전용 줄이다. 답변 첫 조각이 오거나 턴이 끝나면 지운다 —
    // 턴 기록에는 절대 안 남는다. 빈 조각은 조용히 무시한다.
    let thinkingEl = null;
    let thinkingBody = null;
    let thinkingText = '';
    const clearThinkingPreview = () => {
      if (!thinkingEl) return;
      thinkingEl.remove();
      thinkingEl = null;
      thinkingBody = null;
      thinkingText = '';
    };
    const unsubThinking = window.athena.on('athena:live-thinking-delta', ({ text: delta } = {}) => {
      if (!delta) return;
      if (!calling) { calling = true; setChatDot('calling'); }
      if (!thinkingEl) {
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'orb-thinking-preview';
        const label = document.createElement('div');
        label.className = 'orb-thinking-label';
        label.textContent = '추론 중…';
        thinkingBody = document.createElement('div');
        thinkingBody.className = 'orb-thinking-body';
        thinkingEl.append(label, thinkingBody);
        if (card.isConnected) card.appendChild(thinkingEl);
      }
      thinkingText += delta;
      thinkingBody.textContent = thinkingText;
      scrollChatToBottom();
      requestPanelHeight();
    });

    const unsubDelta = window.athena.on('athena:live-text-delta', ({ text: delta } = {}) => {
      if (!delta) return;
      if (!calling) { calling = true; setChatDot('calling'); }
      clearThinkingPreview(); // 답변이 시작됐다 — 추론 미리보기는 자리를 비켜준다
      if (!answer) {
        if (card.isConnected) card.remove();
        answer = renderChatAnswer('');
      }
      answer.textEl.textContent += delta;
      scrollChatToBottom();
    });

    let result;
    try {
      result = await window.athena.invoke('athena:orb-chat-submit', { query: text });
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    } finally {
      unsubCanvas();
      unsubStep();
      unsubThinking();
      unsubDelta();
      clearThinkingPreview(); // 방어적 — 답변 조각 없이 턴이 끝나는 경로에서도 안 남는다
      thinking = false;
      resolveAmbientFace();
      chatBusy = false;
      syncInputLock();
      setChatDot(null);
    }

    // 최종 텍스트는 응답값이 권위다(스트리밍 누적치가 아니다) — chat.js
    // runQueryLive와 같은 원칙(조각 유실·순서 어긋남에도 이 줄이 항상 이긴다).
    const finalText = result && result.answerText
      ? result.answerText
      : (result && result.ok ? '완료 — 답변 텍스트 없음' : `실패 — ${(result && result.error) || '알 수 없는 오류'}`);
    if (answer) {
      answer.textEl.textContent = finalText;
    } else {
      if (card.isConnected) card.remove();
      answer = renderChatAnswer(finalText);
    }
    // answer가 없던 동안 도착한 카드(카드 먼저 오는 경로)를 여기서 이어붙인다.
    for (const el of pendingCanvasCards) answer.line.appendChild(el);
    // board-33③④에서 실제로 축약 카드를 그린 canvas_type은 이미 카드가 붙었다 —
    // 그 종류는 "표·차트는 여기서 다시 그리지 않는다"는 옛 안내를 반복하지
    // 않는다. 아직 오브 렌더러가 없는 나머지 canvas_type(예: reader/stream)만
    // 정직하게 "전체는 대화창에서 이어집니다"로 넘어간다.
    const canvasTypes = (result && result.canvasTypes) || [];
    const unrenderedCanvasTypes = canvasTypes.filter((t) => !handledCanvasTypes.has(t));
    if (unrenderedCanvasTypes.length) {
      const note = document.createElement('div');
      note.className = 'orb-turn-fold-note';
      note.textContent = '전체는 대화창에서 이어집니다';
      answer.line.appendChild(note);
    }
    if (expanded) {
      // 펴진 채 실시간으로 지켜본 턴 — 기존 그대로 잠깐 웃고/찡그리고 앰비언트로
      // 돌아간다(DONE_HOLD). 사용자가 이미 봤으니 지속 배지가 필요 없다.
      if (result && result.ok) triggerDoneFace();
      else if (result && result.ok === false) triggerFrownFace();
    } else {
      // 접힌 채 도착(board-33⑥, "질의해놓고 접었을 때") — 성공·실패 무관하게
      // 답이 왔다는 사실 자체가 신호다. DONE_HOLD짜리 일시 표정을 켰다가 몇 초
      // 뒤 꺼버리면 다시 접힌 동안 생긴 알림이 사라져 버린다 — 그래서 done/
      // frown 대신 기존 미확인 메커니즘(renderPresence)을 그대로 쓴다. 새 배지
      // 시스템 0개, unread 배열도 안 건드린다(그건 루틴 전용 — 정직성).
      foldedChatAnswers += 1;
      touchActivity();
      renderPresence();
    }
    scrollChatToBottom();
    requestPanelHeight();
    if (!$chatInput.disabled) $chatInput.focus();
  }

  function setChatDot(mode) {
    $chatDot.classList.remove('judging', 'calling');
    if (mode) $chatDot.classList.add(mode);
  }

  function abortChat() {
    if (!chatBusy) return;
    window.athena.send('athena:abort-live-query');
  }

  // 컨트롤 스트립 — 셸의 CLI 필·루틴 칩과 같은 어휘를 읽기 전용으로 보여준다
  // (오브에는 팝오버·전환 UI가 없다 — 진입로는 "대화창으로 가기" 하나).
  async function refreshChatControlStrip() {
    try {
      const st = await window.athena.invoke('athena:model-get');
      const c = (st && st.claude) || {};
      $chatCli.textContent = c.model ? c.model.toUpperCase() : 'CLAUDE';
    } catch { /* 표시만 못한다 — 대화 기능에는 영향 없다 */ }
    try {
      const res = await window.athena.invoke('athena:routines-list');
      const routines = res && res.ok && res.data && Array.isArray(res.data.routines) ? res.data.routines : [];
      const active = routines.filter((r) => r.status === 'active').length;
      $chatRoutine.hidden = active === 0;
      $chatRoutine.textContent = `감시 ${active}`;
    } catch {
      $chatRoutine.hidden = true;
    }
  }

  $chatInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || chatBusy || remoteQueryBusy) return;
    e.preventDefault();
    submitChatQuery($chatInput.value);
  });
  $chatInput.addEventListener('focus', () => {
    listening = true;
    touchActivity();
    resolveAmbientFace();
  });
  $chatInput.addEventListener('blur', () => {
    listening = false;
    resolveAmbientFace();
  });
  $esc.addEventListener('click', () => abortChat());
  // 대화 이어짐(board-34 A→B) — 셸을 앞으로 가져온다, 새 방을 열지 않는다.
  $chatGo.addEventListener('click', () => {
    window.athena.send('athena:orb-open-shell', {});
  });

  // Esc: 답변을 기다리는 중이면 중단, 아니면 접는다(오브에는 닫을 모드가
  // 이 둘뿐이다). "ESC 중단"이 board-33이 요구하는 잠금 해제 경로다.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !expanded) return;
    e.preventDefault();
    if (chatModeActive && chatBusy) { abortChat(); return; }
    setExpanded(false);
  });

  renderPresence();
  // 초기 얼굴 — setFace()는 같은 값이면 일찍 빠지므로 속성은 여기서 직접 박는다.
  $root.dataset.face = face;
  scheduleBlink();
  scheduleSaccade();
  // updateMarketClosed 최초 호출 — 위 선언부 주석 참조(TDZ 회피로 여기로 미룸).
  updateMarketClosed();
  setInterval(updateMarketClosed, 15000);
})();
