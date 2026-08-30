'use strict';

// 상주 채팅 세션 vs 매 턴 콜드 스폰 — 턴 오버헤드 실측 (US-004, 2026-08-30).
//
// 무엇을 재나: "제출 → 첫 스트림 이벤트 ms". 모델 생각 시간이 시작되기 전에
// 앱이 얹는 고정비(CLI 기동 + MCP 게이트웨이 스폰·핸드셰이크 + --resume 포크 +
// 프롬프트 전송)가 이 구간에 전부 들어간다. 상주 세션은 이 비용을 앱 기동
// 시점(예열)으로 옮기므로, 턴에서는 거의 0이어야 한다.
//
// 격리: ATHENA_MCP_REGISTRY_PATH를 빈 임시 경로로 돌려 upstream 서버·비밀값
// 없이 athena 게이트웨이(캔버스 툴만)로 돈다 — 재는 대상은 우리 고정비지
// upstream 설치 시간이 아니다. 실제 claude CLI와 구독 계정을 쓴다(작은 턴
// 몇 개 — selector 풀 warmup과 같은 수준의 비용).
//
// 사용법: node scripts/benchmark-persistent-chat.js [--model haiku] [--cold 2] [--warm 3]

const fs = require('fs');
const os = require('os');
const path = require('path');

// 반드시 lib 모듈 require보다 먼저 — 사용자 실레지스트리(~/.athena)를 건드리지
// 않게 격리한다(mcp-env.buildEnvOverrides가 빈 레지스트리에서 {}를 돌려준다).
const isolatedRegistry = path.join(os.tmpdir(), `athena-bench-registry-${process.pid}.json`);
process.env.ATHENA_MCP_REGISTRY_PATH = isolatedRegistry;

const { runClaudeQuery } = require('../lib/main/claude-runner');
const { createClaudeChatSession } = require('../lib/main/claude-chat-session');
const { ensureMcpConfig } = require('../lib/main/mcp-config');
const { buildLivePrompt, buildLiveSystemPrompt, buildLiveTurnPrompt } = require('../lib/main/live-prompt');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MODEL = arg('model', 'haiku');
const COLD_TURNS = Number(arg('cold', '2'));
const WARM_TURNS = Number(arg('warm', '3'));
const QUESTION = '다른 일은 하지 말고 "OK"라고만 답하라.';
const TIMEOUT_MS = 180_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fmt(ms) {
  return ms == null ? '-' : `${Math.round(ms)}ms`;
}

async function coldTurn({ dir, configFile, resumeSessionId }) {
  const startedAt = Date.now();
  let firstEventMs = null;
  const result = await runClaudeQuery({
    prompt: buildLivePrompt(QUESTION),
    cwd: dir,
    configFile,
    model: MODEL,
    resumeSessionId,
    timeoutMs: TIMEOUT_MS,
    onEvent: () => { if (firstEventMs === null) firstEventMs = Date.now() - startedAt; },
  });
  return {
    ok: result.ok,
    error: result.error,
    firstEventMs,
    totalMs: Date.now() - startedAt,
    sessionId: result.finalResult && result.finalResult.session_id,
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-bench-'));
  const { dir, configFile } = ensureMcpConfig(tmp);
  console.log(`[셋업] mcp-config: ${dir} / model: ${MODEL} / 격리 레지스트리: ${isolatedRegistry}`);

  // -- 기준선: 매 턴 콜드 스폰(기존 경로 그대로 — buildLivePrompt + --resume 체인)
  const cold = [];
  let chain = null;
  for (let i = 0; i < COLD_TURNS; i += 1) {
    const r = await coldTurn({ dir, configFile, resumeSessionId: chain });
    if (!r.ok) {
      console.error(`[콜드 ${i + 1}] 실패 — ${r.error}`);
      process.exitCode = 1;
      return;
    }
    chain = r.sessionId || chain;
    cold.push(r);
    console.log(`[콜드 ${i + 1}] 첫 이벤트 ${fmt(r.firstEventMs)} / 총 ${fmt(r.totalMs)}${i > 0 ? ' (--resume 포함)' : ''}`);
  }

  // -- 상주 세션: 예열 1회 후 턴 반복(턴 페이로드는 질문만)
  const session = createClaudeChatSession({
    cwd: dir,
    configFile,
    appendSystemPrompt: buildLiveSystemPrompt(),
    envOverridesFn: () => ({}),
    timeoutMs: TIMEOUT_MS,
  });
  // 실측(probe-chat-idle-init, 2026-08-30): CLI는 첫 입력 전에는 아무 이벤트도
  // 안 내보내지만 MCP 게이트웨이는 스폰 ~3초 내에 eager로 미리 뜬다 — init
  // 이벤트를 기다리면 영원히 안 온다. 고정 10초만 쉬어 예열 창을 준다(실제
  // 앱에서는 사용자가 첫 질문을 치기까지의 시간이 이 창이다).
  const warmStartedAt = Date.now();
  session.warm({ model: MODEL });
  await delay(10_000);
  console.log(`[예열] 스폰 후 ${fmt(Date.now() - warmStartedAt)} 대기 (앱 기동 시 1회 — 턴 비용 아님)`);

  const warm = [];
  for (let i = 0; i < WARM_TURNS; i += 1) {
    const startedAt = Date.now();
    const r = await session.run({ prompt: buildLiveTurnPrompt(QUESTION), model: MODEL });
    if (!r.ok) {
      console.error(`[상주 ${i + 1}] 실패 — ${r.error}`);
      session.stop();
      process.exitCode = 1;
      return;
    }
    warm.push({ firstEventMs: r.firstEventMs, totalMs: Date.now() - startedAt });
    console.log(`[상주 ${i + 1}] 첫 이벤트 ${fmt(r.firstEventMs)} / 총 ${fmt(warm[i].totalMs)} (프로세스 ${r.spawnedFresh ? '신규' : '재사용'})`);
  }
  session.stop();

  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const coldFirst = avg(cold.map((r) => r.firstEventMs));
  const warmFirst = avg(warm.map((r) => r.firstEventMs));
  console.log('');
  console.log('== 요약 (제출 → 첫 스트림 이벤트, 평균) ==');
  console.log(`콜드 스폰(기존): ${fmt(coldFirst)}  |  상주 세션(신규): ${fmt(warmFirst)}  |  절감 ${fmt(coldFirst - warmFirst)} (${Math.round((1 - warmFirst / coldFirst) * 100)}%)`);
  console.log(`콜드 총소요(평균): ${fmt(avg(cold.map((r) => r.totalMs)))}  |  상주 총소요(평균): ${fmt(avg(warm.map((r) => r.totalMs)))}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
