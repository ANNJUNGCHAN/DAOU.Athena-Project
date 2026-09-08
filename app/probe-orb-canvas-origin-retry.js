// origin 스레딩 회귀 프로브(2026-08-27, Step 9a/board-33③④ 선행) — main.js의
// runLiveQuery/runLiveQueryInner에 origin 인자를 실었을 때, "세션 재개 실패 →
// 1회 재시도" 재귀(return runLiveQuery(query, expand)) 지점이 origin을 안 실어
// 보내면 오브 기원 질의가 재시도를 타는 순간 origin이 기본값 'shell'로 조용히
// 리셋되는 은닉 회귀가 생긴다(합의 리뷰가 특정한 결함) — 이 프로브가 그 회귀를
// 실제로 잡는지 확인한다. claude-runner.js의 ATHENA_CLAUDE_BIN 오버라이드로
// 실제 claude를 부르지 않는다(claude-runner.stdout-cap.test.js와 같은 원칙 —
// .cmd/.bat는 Node 22 shell:false spawn을 EINVAL로 막아 후보에서 제외, csc.exe로
// 즉석 컴파일한 최소 실행 파일을 쓴다).
//
// 가짜 claude의 규약: argv에 --resume이 있으면 세션 오류로 실패(exit 1,
// result에 "session" 포함) — 없으면 render_canvas 성공(테이블 엔벌로프) +
// session_id:"FAKE-SESSION-OK"로 종료(exit 0). liveSessionId는 main.js의
// 모듈 전역이라 매 성공 이후 항상 같은 세션ID로 남고, 다음 호출은 항상
// --resume을 달고 나가 항상 한 번 실패했다가 재시도로 살아나는 순환이 된다 —
// 그래서 두 번째 질의부터는 모든 질의(오브·셸 공통)가 "실패 1회 + 재시도 성공"
// 경로를 실제로 밟는다.
//
// 검증 흐름:
//   (A) 오브 질의 1(앱 첫 질의라 재시도 없음, 바로 성공) → 오브가 캔버스
//       엔벌로프 relay 1건을 받아야 한다.
//   (B) 오브 질의 2(--resume 실패 → 재시도 성공) → origin이 재시도에서도
//       'orb'로 남아야 relay 누적이 2건이 된다(안 남으면 1건에 멈춘다 — 이게
//       합의 리뷰가 짚은 은닉 회귀 그 자체).
//   (C) 셸 질의(athena__render_canvas 직접 invoke, origin 기본값 'shell') —
//       이것도 --resume 실패→재시도를 밟지만, 재시도의 origin이 'shell'로
//       남아 오브에는 누적되지 않아야 한다(무회귀 확인). 셸 캔버스 적재
//       (athena:add-canvas-live)는 origin과 무관하게 항상 일어나야 한다
//       (A/B/C 합쳐 3건).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-orb-canvas-origin-retry-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

// startCanvasFeed(WS 사이드채널)를 끈다 — 이 프로브는 범위 밖(WS 카드 지름길)을
// 안 건드리고, 백엔드 없이도 결정론으로 돌아야 한다.
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('csc.exe(.NET Framework)를 못 찾았다 — 가짜 claude 실행 파일을 컴파일할 수 없다');
  return found;
}

// 인자에 --resume이 있으면 세션 오류로 실패, 없으면 render_canvas 성공
// 스트림을 stdout에 stream-json NDJSON으로 쏟는다. 문자열 연결 중간에 등장하는
// q(따옴표 문자)는 런타임에 조립하므로 이 C# 소스 자체에는 JSON 텍스트가
// 리터럴로 박혀있지 않다 — 이중 이스케이프 지옥을 피한다.
function compileFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-fake-claude-'));
  const csPath = path.join(dir, 'fakeclaude.cs');
  const exePath = path.join(dir, 'fakeclaude.exe');
  const src = `
using System;

class Program {
  static void Main(string[] args) {
    char q = (char)34;
    bool resume = false;
    foreach (var a in args) { if (a == "--resume") resume = true; }
    if (resume) {
      Console.WriteLine("{" + q + "type" + q + ":" + q + "result" + q + "," + q + "is_error" + q + ":true," + q + "result" + q + ":" + q + "session not found - synthetic test failure" + q + "}");
      Environment.Exit(1);
    } else {
      string envelope = "{" + q + "canvas_type" + q + ":" + q + "table" + q + "," + q + "fell_back" + q + ":false}";
      string esc = envelope.Replace("\\\\", "\\\\\\\\").Replace(q.ToString(), "\\\\" + q);
      Console.WriteLine("{" + q + "type" + q + ":" + q + "assistant" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_use" + q + "," + q + "id" + q + ":" + q + "tu1" + q + "," + q + "name" + q + ":" + q + "mcp__athena__athena__render_canvas" + q + "}]}}");
      Console.WriteLine("{" + q + "type" + q + ":" + q + "user" + q + "," + q + "message" + q + ":{" + q + "content" + q + ":[{" + q + "type" + q + ":" + q + "tool_result" + q + "," + q + "tool_use_id" + q + ":" + q + "tu1" + q + "," + q + "content" + q + ":" + q + esc + q + "}]}}");
      Console.WriteLine("{" + q + "type" + q + ":" + q + "result" + q + "," + q + "is_error" + q + ":false," + q + "result" + q + ":" + q + "ok" + q + "," + q + "session_id" + q + ":" + q + "FAKE-SESSION-OK" + q + "}");
      Environment.Exit(0);
    }
  }
}`;
  fs.writeFileSync(csPath, src, 'utf-8');
  execFileSync(findCsc(), ['/nologo', `/out:${exePath}`, csPath], { stdio: 'pipe' });
  return exePath;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-canvas-origin-retry] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function submitOrbQuery(orbWin, text) {
  const previousAnswerCount = await orbWin.webContents.executeJavaScript(`(() => {
    const answers = document.querySelectorAll('#orbChatTurns .orb-turn-a');
    const input = document.getElementById('orbInput');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return answers.length;
  })()`);
  const deadline = Date.now() + 20000;
  let lastAnswerText = null;
  while (Date.now() < deadline) {
    const state = await orbWin.webContents.executeJavaScript(`(() => {
      const answers = document.querySelectorAll('#orbChatTurns .orb-turn-a');
      return {
        count: answers.length,
        text: answers.length ? answers[answers.length - 1].textContent : null,
      };
    })()`);
    if (state.count > previousAnswerCount && state.text) {
      lastAnswerText = state.text;
      break;
    }
    await wait(250);
  }
  await wait(300); // chatBusy가 renderer 쪽에서 false로 떨어질 여유
  return lastAnswerText;
}

async function main() {
  const exePath = compileFakeClaude();
  process.env.ATHENA_CLAUDE_BIN = exePath;

  const mainMod = require('./main.js');
  // 프로덕션 자동 기동이 대화 이력 파이프라인과 창을 함께 소유하게 둔다.
  // 여기서 createWindows()를 한 번 더 부르면 두 창 세트가 전역 참조를 경쟁한다.
  let shellWin = null;
  let orbWin = null;
  const windowsDeadline = Date.now() + 10000;
  while (Date.now() < windowsDeadline) {
    ({ shellWin, orbWin } = mainMod.getWins());
    if (shellWin && orbWin
        && !shellWin.webContents.isLoadingMainFrame()
        && !orbWin.webContents.isLoadingMainFrame()) break;
    await wait(100);
  }
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin 못 찾음');
  // fixture 부팅 handoff가 끝나기 전에 닫으면, 뒤늦은 handoff가 셸을 다시
  // 표시해 닫기 검증이 흔들린다. boot 창이 사라진 뒤 사용자 동작을 시작한다.
  const handoffDeadline = Date.now() + 10000;
  while (Date.now() < handoffDeadline) {
    const { bootWin } = mainMod.getWins();
    if (!bootWin || bootWin.isDestroyed()) break;
    await wait(100);
  }
  // handoff 뒤에도 visibility 전이를 명시적으로 한 번 만들어 오브 모드를
  // 결정론적으로 동기화한다.
  shellWin.hide();
  await wait(100);
  shellWin.show();
  shellWin.focus();
  await wait(1000);

  // 오브·셸 양쪽에 캔버스 relay 카운터를 심는다 — 실제 화면 렌더러(orb.js/canvas.js)
  // 구현 여부와 무관하게 채널 도착 자체만 센다(9b/9c 렌더러는 별도 태스크).
  await orbWin.webContents.executeJavaScript(`(() => {
    window.__orbCanvasEvents = [];
    window.athena.on('athena:orb-canvas-result', (r) => window.__orbCanvasEvents.push(r));
  })()`);
  await shellWin.webContents.executeJavaScript(`(() => {
    window.__shellCanvasEvents = [];
    window.athena.on('athena:add-canvas-live', (r) => window.__shellCanvasEvents.push(r));
  })()`);

  // 셸 숨김 → 오브 대화 모드 전이 → 펼침(입력창 노출)
  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(500);
  record('00-셸 숨김', !shellWin.isVisible(), { visible: shellWin.isVisible() });
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(400);

  // ---------- (A) 오브 질의 1 — 앱 첫 질의, 재시도 없이 바로 성공 ----------
  const answerA = await submitOrbQuery(orbWin, '리트라이 프로브 질의 A');
  const orbCountA = await orbWin.webContents.executeJavaScript('window.__orbCanvasEvents.length');
  record('A-오브 질의1 응답 도착', !!answerA, { answerA });
  record('A-오브 캔버스 relay 1건', orbCountA === 1, { orbCountA });

  // ---------- (B) 오브 질의 2 — --resume 실패 → 재시도 성공(origin 유지 확인) ----------
  const answerB = await submitOrbQuery(orbWin, '리트라이 프로브 질의 B');
  const orbCountB = await orbWin.webContents.executeJavaScript('window.__orbCanvasEvents.length');
  record('B-오브 질의2 응답 도착(재시도 경로 포함)', !!answerB, { answerB });
  // 핵심 단언 — origin이 재시도 재귀에서 사라지지 않았다면 relay가 2건 누적된다.
  // 누락돼 있었다면(수정 전) 여기서 1건에 멈춰 FAIL한다.
  record('B-세션 재시도 경로에서도 origin=orb 유지(relay 2건 누적)', orbCountB === 2, { orbCountB });

  // ---------- (C) 셸 질의 — origin 기본값 'shell' 무회귀 ----------
  const shellResult = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', { query: '리트라이 프로브 질의 C', expand: false })`,
  );
  await wait(2000); // 셸 경로도 --resume 실패→재시도 1회를 밟는다(동일 세션ID 순환)
  const orbCountC = await orbWin.webContents.executeJavaScript('window.__orbCanvasEvents.length');
  const shellCount = await shellWin.webContents.executeJavaScript('window.__shellCanvasEvents.length');
  record('C-셸 기원 질의 성공(재시도 경로 포함)', !!(shellResult && shellResult.ok), { shellResult });
  record('C-셸 기원 질의는 오브로 안 샌다(origin=shell 무회귀, 오브 카운트 그대로 2)', orbCountC === 2, { orbCountA, orbCountB, orbCountC });
  record('C-셸 캔버스 적재는 origin 무관 항상 일어난다(A/B/C 합쳐 3건)', shellCount === 3, { shellCount });

  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-canvas-origin-retry-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-canvas-origin-retry] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-canvas-origin-retry] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'probe-orb-canvas-origin-retry-fatal.log'), String((err && err.stack) || err));
  app.exit(1);
});
