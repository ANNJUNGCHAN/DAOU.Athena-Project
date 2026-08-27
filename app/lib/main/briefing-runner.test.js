'use strict';

// briefing-runner.js — 4단계 검증 목록(계획 Rev.3) 전체:
// 감시형 no-op / 멱등성 / 사용자 busy 대기열(coalesce) / 예산 소진 시 미호출 /
// 성공 payload 정확성 / 실패→예산 재확인→재시도 or 생략 / abort 시 무재시도 /
// briefingBusy 독립성(사용자 카운터 무오염) / kill·report 레이스 계약.

const test = require('node:test');
const assert = require('node:assert/strict');

const runner = require('./briefing-runner');

const FIRED_AT = '2026-08-27T07:30:00+09:00';

function baseEvent(over = {}) {
  return {
    type: 'routine-fired',
    mode: 'scheduled',
    routine_id: 'r1',
    symbol: '005930',
    source: 'schedule.daily',
    observed: '07:30',
    threshold: 'ALL@07:30',
    note: '아침 브리핑',
    fired_at: FIRED_AT,
    briefing_model: null,
    briefing_effort: null,
    ...over,
  };
}

// 전 의존성 주입 하네스 — timers 배열로 대기열 드레인을 수동 구동한다
// (routine-feed.test.js의 setTimeoutImpl 오버라이드 패턴과 동형).
function harness(over = {}) {
  const calls = { claude: [], report: [], deltas: [], states: [], budget: 0 };
  const timers = [];
  const userBusy = { depth: 0 }; // 사용자 카운터 — 러너가 절대 증감하면 안 된다
  const briefingBusy = {
    depth: 0,
    maxDepth: 0,
    increment() { this.depth += 1; this.maxDepth = Math.max(this.maxDepth, this.depth); },
    decrement() { this.depth -= 1; },
  };
  const deps = {
    event: baseEvent(),
    isUserBusy: () => userBusy.depth > 0,
    briefingBusy,
    fetchBudget: async () => { calls.budget += 1; return { remaining: 5 }; },
    reportResult: async (p) => { calls.report.push(p); },
    ipc: {
      sendTextDelta: (t) => calls.deltas.push(t),
      sendQueryState: (s) => calls.states.push(s),
    },
    claudeRunner: {
      runClaudeQuery: async (opts) => {
        calls.claude.push(opts);
        if (opts.onSpawn) opts.onSpawn({ pid: 1, kill() {} });
        if (opts.onTextDelta) opts.onTextDelta('본문');
        return { ok: true, finalResult: { session_id: 'session-should-not-leak' } };
      },
    },
    nowImpl: () => 1000,
    setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; },
    retryDelayMs: 0,
    ...over,
  };
  return { deps, calls, timers, userBusy, briefingBusy };
}

test('감시형(mode!==scheduled) 발화는 no-op이다', async () => {
  runner._resetForTest();
  const h = harness();
  h.deps.event = baseEvent({ mode: 'realtime-ws' });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.ran, false);
  assert.equal(out.reason, 'not-scheduled');
  assert.equal(h.calls.claude.length, 0);
  assert.equal(h.calls.report.length, 0);
});

test('같은 (routine_id, fired_at) 발화는 한 번만 실행된다(멱등성)', async () => {
  runner._resetForTest();
  const h = harness();
  await runner.runBriefingTurn(h.deps);
  const dup = await runner.runBriefingTurn({ ...h.deps, event: baseEvent() });
  assert.equal(dup.reason, 'duplicate');
  assert.equal(h.calls.claude.length, 1);
});

test('사용자 busy면 대기열에 들어가고, 한가해진 뒤 타이머 드레인으로 실행된다', async () => {
  runner._resetForTest();
  const h = harness();
  h.userBusy.depth = 1;
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.reason, 'queued');
  assert.equal(h.calls.claude.length, 0);
  assert.equal(h.timers.length, 1);
  h.userBusy.depth = 0;
  await h.timers.shift()();
  assert.equal(h.calls.claude.length, 1);
  assert.equal(h.calls.report.length, 1);
});

test('busy 중 새 발화가 오면 이전 대기분을 대체한다(coalesce, 최대 1건)', async () => {
  runner._resetForTest();
  const h = harness();
  h.userBusy.depth = 1;
  await runner.runBriefingTurn(h.deps);
  await runner.runBriefingTurn({
    ...h.deps,
    event: baseEvent({ routine_id: 'r2', note: '두 번째 브리핑', fired_at: '2026-08-27T07:31:00+09:00' }),
  });
  h.userBusy.depth = 0;
  while (h.timers.length) await h.timers.shift()();
  assert.equal(h.calls.claude.length, 1); // 대기열은 1건 — 첫 발화는 대체됐다
  assert.match(h.calls.claude[0].prompt, /두 번째 브리핑/);
});

test('예산 소진이면 claude를 부르지 않고 보고도 없다(능동 턴 카드가 폴백)', async () => {
  runner._resetForTest();
  const h = harness({ fetchBudget: async () => ({ remaining: 0 }) });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.reason, 'budget-exhausted');
  assert.equal(h.calls.claude.length, 0);
  assert.equal(h.calls.report.length, 0);
});

test('성공 시 reportResult payload — title/content/destination/모델 설정 전부 정확', async () => {
  runner._resetForTest();
  const h = harness();
  h.deps.event = baseEvent({ briefing_model: 'claude-sonnet-5', briefing_effort: 'low' });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.ok, true);
  assert.equal(h.calls.report.length, 1);
  assert.deepEqual(h.calls.report[0], {
    fired_at: FIRED_AT,
    status: 'ok',
    duration_ms: 0, // nowImpl 고정 — 시계 미경과
    destination: 'chat',
    title: '아침 브리핑',
    content: '본문',
    model: 'claude-sonnet-5',
    effort: 'low',
  });
  // 모델 설정이 claude 호출 인자에도 그대로 전달됐고, 세션 재개는 없다.
  assert.equal(h.calls.claude[0].model, 'claude-sonnet-5');
  assert.equal(h.calls.claude[0].effort, 'low');
  assert.equal(h.calls.claude[0].resumeSessionId, undefined);
  assert.deepEqual(h.calls.deltas, ['본문']);
});

test('onCanvasResult가 1회 이상 오면 destination은 canvas다', async () => {
  runner._resetForTest();
  const h = harness({
    claudeRunner: {
      runClaudeQuery: async (opts) => {
        opts.onCanvasResult({ status: 'success', envelope: { canvas_type: 'facts' } });
        return { ok: true };
      },
    },
  });
  await runner.runBriefingTurn(h.deps);
  assert.equal(h.calls.report[0].destination, 'canvas');
});

test('실패하면 예산을 재확인하고 남아 있으면 정확히 1회 재시도한다', async () => {
  runner._resetForTest();
  let attempt = 0;
  const h = harness({
    claudeRunner: {
      runClaudeQuery: async (opts) => {
        attempt += 1;
        if (attempt === 1) return { ok: false, error: 'boom' };
        if (opts.onTextDelta) opts.onTextDelta('재시도 본문');
        return { ok: true };
      },
    },
  });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.ok, true);
  assert.equal(attempt, 2);
  assert.equal(h.calls.budget, 2); // 최초 1회 + 재시도 직전 재확인 1회
  assert.equal(h.calls.report[0].status, 'ok');
  assert.equal(h.calls.report[0].content, '재시도 본문');
});

test('실패 후 재확인 예산이 소진이면 재시도 없이 즉시 실패 보고한다(P3)', async () => {
  runner._resetForTest();
  let budgetCall = 0;
  let attempt = 0;
  const h = harness({
    fetchBudget: async () => {
      budgetCall += 1;
      return { remaining: budgetCall === 1 ? 1 : 0 };
    },
    claudeRunner: {
      runClaudeQuery: async () => { attempt += 1; return { ok: false, error: 'boom' }; },
    },
  });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.ok, false);
  assert.equal(attempt, 1); // 재시도 생략 — 실제 호출 횟수가 상한을 넘지 않는다
  assert.equal(h.calls.report.length, 1);
  assert.equal(h.calls.report[0].status, 'failed');
  assert.equal('content' in h.calls.report[0], false); // 실패 보고에 본문 없음(3단계 계약)
});

test('재시도까지 실패하면 failed로 보고한다', async () => {
  runner._resetForTest();
  let attempt = 0;
  const h = harness({
    claudeRunner: { runClaudeQuery: async () => { attempt += 1; return { ok: false, error: 'boom' }; } },
  });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.ok, false);
  assert.equal(attempt, 2);
  assert.equal(h.calls.report[0].status, 'failed');
});

test('사용자 선점으로 죽은(aborted) 브리핑은 재시도하지 않는다', async () => {
  runner._resetForTest();
  let attempt = 0;
  const h = harness({
    claudeRunner: { runClaudeQuery: async () => { attempt += 1; return { ok: false, aborted: true }; } },
  });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.aborted, true);
  assert.equal(attempt, 1); // 사용자가 이겼다 — 되살리지 않는다
  assert.equal(h.calls.report[0].status, 'failed');
});

test('briefingBusy만 증감하고 사용자 카운터는 절대 건드리지 않는다(카운터 분리)', async () => {
  runner._resetForTest();
  const h = harness();
  let depthDuringRun = null;
  h.deps.claudeRunner = {
    runClaudeQuery: async () => {
      depthDuringRun = h.briefingBusy.depth;
      return { ok: true };
    },
  };
  await runner.runBriefingTurn(h.deps);
  assert.equal(depthDuringRun, 1); // 실행 중에는 1
  assert.equal(h.briefingBusy.depth, 0); // 종료 후 0
  assert.equal(h.userBusy.depth, 0); // 사용자 카운터 무오염 — 별개 변수임을 단언
});

test('진행 중 killInProgressBriefing()은 kill하고 true, 이후 재호출은 no-op false', async () => {
  runner._resetForTest();
  let killed = false;
  let spawnResolve;
  const spawned = new Promise((r) => { spawnResolve = r; });
  const h = harness({
    claudeRunner: {
      runClaudeQuery: (opts) => new Promise((resolve) => {
        opts.onSpawn({ pid: 1, kill: () => { killed = true; resolve({ ok: false, aborted: true }); } });
        spawnResolve();
      }),
    },
  });
  const runPromise = runner.runBriefingTurn(h.deps);
  await spawned; // 예산 조회(await)를 지나 실제 spawn까지 도달한 시점을 기다린다
  assert.equal(runner.killInProgressBriefing(), true);
  assert.equal(killed, true);
  assert.equal(runner.killInProgressBriefing(), false); // 핸들은 즉시 비워졌다
  const out = await runPromise;
  assert.equal(out.aborted, true);
});

test('정상 종료는 핸들을 먼저 비운 뒤 보고한다 — 보고 중 kill은 no-op(레이스 계약)', async () => {
  runner._resetForTest();
  let killCalled = false;
  let releaseReport;
  const reportGate = new Promise((resolve) => { releaseReport = resolve; });
  let killDuringReport = null;
  const h = harness({
    claudeRunner: {
      runClaudeQuery: async (opts) => {
        opts.onSpawn({ pid: 1, kill: () => { killCalled = true; } });
        return { ok: true };
      },
    },
    reportResult: async () => {
      killDuringReport = runner.killInProgressBriefing(); // 보고 중 — 이미 kill 대상이 아니다
      await reportGate;
    },
  });
  const runPromise = runner.runBriefingTurn(h.deps);
  releaseReport();
  await runPromise;
  assert.equal(killDuringReport, false);
  assert.equal(killCalled, false); // 정상 종료된 child를 뒤늦게 죽이지 않는다
});

test('예산 왕복 중 사용자가 들어오면 스폰 없이 대기열로 양보한다(선점 창 1)', async () => {
  runner._resetForTest();
  const h = harness();
  h.deps.fetchBudget = async () => {
    h.userBusy.depth = 1; // 예산 조회가 도는 사이 사용자 질의 진입을 흉내낸다
    return { remaining: 5 };
  };
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(out.reason, 'yielded-to-user');
  assert.equal(h.calls.claude.length, 0); // 스폰 자체가 없다
  assert.equal(h.calls.report.length, 0);
  assert.equal(h.timers.length, 1);
  h.userBusy.depth = 0;
  h.deps.fetchBudget = async () => ({ remaining: 5 });
  await h.timers.shift()();
  assert.equal(h.calls.claude.length, 1); // 사용자 턴이 끝난 뒤에야 실행
});

test('재시도 창(핸들 없음)에서 선점되면 재시도를 버리고 중단으로 보고한다(선점 창 2)', async () => {
  runner._resetForTest();
  let attempt = 0;
  let budgetCall = 0;
  const h = harness({
    claudeRunner: {
      runClaudeQuery: async (opts) => {
        attempt += 1;
        opts.onSpawn({ pid: 1, kill() {} });
        return { ok: false, error: 'boom' };
      },
    },
    fetchBudget: async () => {
      budgetCall += 1;
      if (budgetCall === 2) {
        // 재시도 직전 예산 재확인 왕복 중 사용자 질의 진입 — 이 창에서는
        // 핸들이 이미 null이라 kill은 false지만 선점 표시는 남아야 한다.
        assert.equal(runner.killInProgressBriefing(), false);
      }
      return { remaining: 5 };
    },
  });
  const out = await runner.runBriefingTurn(h.deps);
  assert.equal(attempt, 1); // 재시도 없음 — 사용자가 이겼다
  assert.equal(out.aborted, true);
  assert.equal(h.calls.report[0].status, 'failed');
});

test('배지 신호는 결과를 명시한다 — 성공 {ok:true}, 선점 {ok:false, aborted:true}', async () => {
  runner._resetForTest();
  const h = harness();
  await runner.runBriefingTurn(h.deps);
  assert.deepEqual(h.calls.states, [
    { busy: true },
    { busy: false, ok: true },
  ]);

  runner._resetForTest();
  const h2 = harness({
    claudeRunner: { runClaudeQuery: async () => ({ ok: false, aborted: true }) },
  });
  await runner.runBriefingTurn(h2.deps);
  assert.deepEqual(h2.calls.states, [
    { busy: true },
    { busy: false, ok: false, aborted: true },
  ]);
});

test('브리핑 실행 중 도착한 발화는 대기열로 밀리고 종료 후 드레인된다(직렬화)', async () => {
  runner._resetForTest();
  let resolveFirst;
  let spawnResolve;
  const spawned = new Promise((r) => { spawnResolve = r; });
  const h = harness({
    claudeRunner: {
      runClaudeQuery: () => new Promise((resolve) => { resolveFirst = resolve; spawnResolve(); }),
    },
  });
  const first = runner.runBriefingTurn(h.deps);
  const second = await runner.runBriefingTurn({
    ...h.deps,
    event: baseEvent({ routine_id: 'r2', fired_at: '2026-08-27T07:31:00+09:00' }),
    claudeRunner: { runClaudeQuery: async () => ({ ok: true }) },
  });
  assert.equal(second.reason, 'queued'); // running 가드 — 병렬 실행 없음
  await spawned; // 첫 브리핑이 실제 실행 지점까지 도달한 뒤에 종료시킨다
  resolveFirst({ ok: true });
  await first;
  assert.equal(h.timers.length, 1); // 종료 finally가 드레인을 예약했다
  await h.timers.shift()();
  assert.equal(h.calls.report.length, 2); // 두 브리핑 모두 완결
});
