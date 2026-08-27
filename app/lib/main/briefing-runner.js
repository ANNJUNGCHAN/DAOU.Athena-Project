'use strict';

// 예약 자동 브리핑 러너(R1, 4단계) — routine-fired 중 예약형(mode==='scheduled')에
// 한해 독립 claude 세션으로 브리핑을 생성하고, 결과를 백엔드 통합 엔드포인트
// (POST /briefing-result)로 1회 보고한다.
//
// 세 가지 격리 원칙(계획 Rev.2/Rev.3의 BLOCKER·MAJOR 2 대응):
// 1. 세션 격리 — runClaudeQuery를 resumeSessionId 없이 직접 호출한다. main.js의
//    liveSessionId 전역은 읽지도 쓰지도 않는다(멀티턴 체인 오염 금지).
// 2. 동시성 격리 — briefingBusy(주입받은 독립 카운터)만 증감한다. 사용자 턴의
//    liveQueryBusyDepth는 isUserBusy() 읽기 전용으로만 관찰한다.
// 3. 우선순위 — 사용자가 항상 이긴다. main.js의 사용자 질의 진입점이
//    killInProgressBriefing()을 불러 진행 중 브리핑을 끊는다(scheduler.py의
//    "대화가 우선 — 이번 주기 양보"와 대칭, 새 동시성 모델을 발명하지 않는다).
//
// kill/report 레이스 계약(Rev.3 MINOR): child가 정상 종료되면 먼저
// currentBriefingHandle을 null로 비우고 그 다음에 reportResult()를 부른다 —
// "child exit 후 reportResult 중인 브리핑은 kill 대상이 아니다".
// killInProgressBriefing()은 호출 시점에 핸들이 non-null일 때만 kill하고 즉시
// 비운다(main.js:1593-1595의 "내가 등록한 핸들일 때만 지운다" 패턴과 동형).

const DEFAULT_RETRY_DELAY_MS = 3000;

// 프로세스 로컬 상태 — 재시작하면 잊는다(멱등성 Set 포함, 허용된 한계로 문서화:
// 재시작 직후 같은 발화가 다시 오면 한 번 더 브리핑할 수 있다. catchup-fire의
// 409 가드가 백엔드 쪽 추가 방어선이다).
let currentBriefingHandle = null;
let running = false;
// 사용자 선점 표시 — killInProgressBriefing()이 세운다. 핸들 kill만으로는
// 프로세스가 아직 없는 창(예산 왕복 중·재시도 직전)의 선점을 표현할 수 없어
// (리뷰 확정 결함 2건), 진행 중(running) 브리핑 전체에 걸리는 플래그로 둔다.
// execute() 진입 시 초기화되고, 각 게이트(예산 통과 직후·runOnce 진입·재시도
// 직전)가 이 플래그를 확인해 양보한다.
let preemptRequested = false;
const seenFirings = new Set(); // "routine_id|fired_at"
let pending = null; // { ...runBriefingTurn 인자 } — 대기열은 최대 1건(coalesce)
let pendingTimer = null;

function briefingKey(event) {
  return `${event.routine_id}|${event.fired_at}`;
}

// 결정론 프롬프트 — 이벤트의 사실만 싣는다. 사용자가 없는 턴이므로 되묻지 않게
// 완결 지시를 명시한다.
function buildBriefingPrompt(event) {
  const note = String(event.note || '').trim();
  return [
    '[예약 브리핑] 감시 루틴이 예약 시각에 발화했다 — 사용자가 미리 승인해 둔 자동 브리핑 턴이다.',
    `종목: ${event.symbol || '(미지정)'} / 루틴: ${note || '(설명 없음)'} / 발화 시각: ${String(event.observed || '')}`,
    '이 종목의 현재 상황(시세·수급·최근 공시 등 조회 가능한 데이터)을 확인해 간결한 브리핑을 작성하라.',
    '표·수치가 유효하면 render_canvas로 카드를 만들고, 본문 답변은 핵심 요약 몇 문장으로 끝내라.',
    '사용자가 지금 대화 중이 아니므로 되묻지 말고, 조회 가능한 데이터만으로 완결하라.',
  ].join('\n');
}

function buildTitle(event) {
  const note = String(event.note || '').trim();
  if (note) return note.slice(0, 60);
  return `${String(event.symbol || '').trim()} 브리핑`.trim();
}

// args.ipc — 신규 3채널 발행자(main.js가 조립). 발행 주체가 채널마다 다르다:
// sendTextDelta는 runOnce()가 직접, sendQueryState는 execute()가 결과(ok/aborted)와
// 함께, sendToolStep은 main.js가 자신의 onEvent(툴스텝 트래커) 경로에서 발행한다 —
// 셋 다 계약의 일부이고 이 파일이 셋 모두를 직접 부르는 것은 아니다.
async function runBriefingTurn(args) {
  const { event } = args;
  // 경계 — 예약형 발화만. 감시형(realtime-ws/periodic)은 기존 알림 턴이 전부다.
  if (!event || event.type !== 'routine-fired' || event.mode !== 'scheduled') {
    return { ran: false, reason: 'not-scheduled' };
  }
  const key = briefingKey(event);
  if (seenFirings.has(key)) return { ran: false, reason: 'duplicate' };
  seenFirings.add(key);
  if (args.isUserBusy() || running) {
    // 대화가 우선 — 대기열은 최대 1건, 새 발화가 이전 대기분을 대체한다(coalesce).
    pending = args;
    scheduleDrain(args);
    return { ran: false, reason: 'queued' };
  }
  return execute(args);
}

function scheduleDrain(args) {
  if (pendingTimer) return;
  const setTimeoutImpl = args.setTimeoutImpl || setTimeout;
  const delayMs = typeof args.retryDelayMs === 'number' ? args.retryDelayMs : DEFAULT_RETRY_DELAY_MS;
  pendingTimer = setTimeoutImpl(() => {
    pendingTimer = null;
    return drainPending();
  }, delayMs);
}

async function drainPending() {
  if (!pending) return undefined;
  const args = pending;
  if (args.isUserBusy() || running) {
    scheduleDrain(args);
    return undefined;
  }
  pending = null;
  return execute(args);
}

async function execute(args) {
  const { event, briefingBusy, fetchBudget, reportResult, ipc } = args;
  const now = args.nowImpl || Date.now;

  // 재진입 가드는 첫 await보다 먼저 세운다 — 예산 조회가 마이크로태스크로
  // 넘어간 사이에 도착한 두 번째 발화가 병렬로 실행되면 안 된다(직렬화).
  running = true;
  preemptRequested = false; // 새 실행 — 이전 선점 표시는 소멸
  try {
    // 하루 예산 — 소진이면 claude 미호출. 능동 턴 카드는 routine-event 릴레이로
    // 이미 떠 있으므로 그것이 폴백이다(추가 렌더 없음). 조회 실패는 호출자(main.js)
    // 쪽 fail-open이 흡수한다 — 이벤트 자체가 백엔드발이라 백엔드가 죽어 있으면
    // 여기까지 오지도 않는다.
    const budget = await safeBudget(fetchBudget);
    if (budget !== null && budget <= 0) {
      return { ran: false, reason: 'budget-exhausted' };
    }
    if (preemptRequested || args.isUserBusy()) {
      // 예산 왕복 동안 사용자가 먼저 들어왔다(이 창에서는 죽일 프로세스가 아직
      // 없다) — 스폰하지 않고 대기열로 양보한다. 아무것도 소모하지 않았으므로
      // 보고도 없다.
      pending = args;
      scheduleDrain(args);
      return { ran: false, reason: 'yielded-to-user' };
    }

    briefingBusy.increment();
    // 배지 신호는 결과를 아는 러너가 발행한다 — busy:false에 ok/aborted를 실어
    // 렌더러가 성공·실패·선점을 추측 없이 표시한다(본문 유무로 추측하지 않는다).
    ipc.sendQueryState({ busy: true });
    const startedAt = now();
    try {
      let attempt = await runOnce(args);
      if (!attempt.ok && !attempt.aborted) {
        // 재시도 직전 예산 재확인(Rev.2 MINOR 6, P3) — "하루 최대 N회"는 실제
        // 호출 횟수 기준이다. 소진이면 재시도 없이 즉시 실패 보고로 넘어간다.
        const budget2 = await safeBudget(fetchBudget);
        if (preemptRequested || args.isUserBusy()) {
          // 재시도 창(핸들이 비어 있는 구간)에 사용자가 들어왔다 — 사용자가
          // 이긴다. 재시도 없이 중단으로 처리한다(리뷰 확정 결함 1 대응).
          attempt = { ...attempt, aborted: true };
        } else if (budget2 === null || budget2 > 0) {
          attempt = await runOnce(args);
        }
      }
      const durationMs = now() - startedAt;
      const destination = attempt.canvasCount > 0 ? 'canvas' : 'chat';
      if (attempt.ok) {
        const payload = {
          fired_at: event.fired_at,
          status: 'ok',
          duration_ms: durationMs,
          destination,
          title: buildTitle(event),
          content: attempt.content,
          model: event.briefing_model || null,
          effort: event.briefing_effort || null,
        };
        ipc.sendQueryState({ busy: false, ok: true });
        // 보고 실패가 완성된 브리핑을 되돌릴 수는 없다 — 조용히 넘긴다(본문은
        // 이미 사용자 화면에 있고, 백엔드 기록만 빠진 상태).
        try { await reportResult(payload); } catch { /* 위 주석 참고 */ }
        return { ran: true, ok: true, destination };
      }
      ipc.sendQueryState({ busy: false, ok: false, aborted: !!attempt.aborted });
      // 실패(재시도 포함) — content 없이 보고한다(3단계 계약: failed는 briefings
      // 스토어에 빈 본문을 남기지 않는다).
      try {
        await reportResult({
          fired_at: event.fired_at,
          status: 'failed',
          duration_ms: durationMs,
          destination,
        });
      } catch { /* 성공 보고와 같은 이유 */ }
      return { ran: true, ok: false, aborted: !!attempt.aborted };
    } finally {
      briefingBusy.decrement();
    }
  } finally {
    running = false;
    if (pending) scheduleDrain(pending);
  }
}

async function safeBudget(fetchBudget) {
  try {
    const b = await fetchBudget();
    return b && typeof b.remaining === 'number' ? b.remaining : null;
  } catch {
    return null; // 판정 불가 — 차단하지 않는다(모듈 머리말 참고)
  }
}

async function runOnce(args) {
  const { event, ipc, claudeRunner } = args;
  // 스폰 직전 최종 선점 확인 — 이 검사와 아래 runClaudeQuery 호출 사이에는
  // await가 없어(onSpawn은 동기 호출) 선점이 끼어들 틈이 없다.
  if (preemptRequested) {
    return { ok: false, aborted: true, content: '', canvasCount: 0 };
  }
  let content = '';
  let canvasCount = 0;
  const result = await claudeRunner.runClaudeQuery({
    prompt: buildBriefingPrompt(event),
    cwd: args.cwd,
    configFile: args.configFile,
    // resumeSessionId 없음(의도적 생략) — 독립 세션. liveSessionId 오염 금지(BLOCKER).
    model: event.briefing_model || null,
    effort: event.briefing_effort || null,
    onSpawn: (h) => { currentBriefingHandle = h; },
    onEvent: (ev) => { if (args.onEvent) args.onEvent(ev); },
    onTextDelta: (text) => {
      content += text;
      ipc.sendTextDelta(text);
    },
    onCanvasResult: (r) => {
      canvasCount += 1;
      if (args.onCanvasResult) args.onCanvasResult(r);
    },
  });
  // 순서 규정(kill/report 계약) — 핸들을 먼저 비운 뒤에야 보고 경로로 넘어간다.
  currentBriefingHandle = null;
  return {
    ok: !!(result && result.ok),
    aborted: !!(result && result.aborted),
    content,
    canvasCount,
  };
}

// 사용자 질의 진입점(main.js runLiveQueryInner)이 부른다 — 진행 중 브리핑의
// claude 프로세스를 끊고, 프로세스가 아직 없는 창(예산 왕복·재시도 직전)이라도
// 선점 표시를 남겨 이후 게이트가 양보하게 한다. 반환값은 "살아 있는 프로세스를
// 실제로 죽였는가"다 — 핸들이 이미 비었으면(정상 종료 직후·보고 중) false.
function killInProgressBriefing() {
  if (running) preemptRequested = true;
  if (!currentBriefingHandle) return false;
  const handle = currentBriefingHandle;
  currentBriefingHandle = null; // 대칭 규칙 — kill해도 즉시 비운다
  try { handle.kill(); } catch { /* 이미 종료된 프로세스 — killTree가 no-op */ }
  return true;
}

// 테스트 전용 — 모듈 로컬 상태 초기화(node --test의 케이스 격리).
function _resetForTest() {
  currentBriefingHandle = null;
  running = false;
  preemptRequested = false;
  seenFirings.clear();
  pending = null;
  if (pendingTimer) {
    try { clearTimeout(pendingTimer); } catch { /* 주입 타이머 토큰 — 무시 */ }
    pendingTimer = null;
  }
}

module.exports = {
  runBriefingTurn,
  killInProgressBriefing,
  buildBriefingPrompt,
  buildTitle,
  _resetForTest,
};
