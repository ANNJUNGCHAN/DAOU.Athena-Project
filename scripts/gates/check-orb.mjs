/**
 * leaf-1.3.1 게이트 — 알림 오브 창이 계약대로 존재하는지 소스를 직접 파싱해 잰다.
 *
 * 이 게이트의 절반은 **없어야 하는 것**을 잰다. 오브의 위험은 기능이 모자란 것이
 * 아니라 **넘치는 것**이다: 실행 버튼 하나, 입력창 하나가 확정 결정 3(주문은 사람이
 * 낸다)과 단일 입력 원칙을 동시에 깬다. 그래서 존재 검사보다 부재 검사를 더 촘촘히
 * 건다 — 부재 검사는 양성 대조군 없이는 믿을 수 없으므로(빈 파일도 통과한다) 존재
 * 검사와 짝지어 둘 다 성립할 때만 초록을 준다.
 *
 * 실행: node scripts/gates/check-orb.mjs
 * 성공 표지: orb contract verification passed
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "app");
const failures = [];

function read(rel) {
  const p = join(APP, rel);
  if (!existsSync(p)) {
    failures.push(`${rel}: 파일이 없다`);
    return null;
  }
  return readFileSync(p, "utf8");
}

/** 주석을 걷어낸 소스. 이력 주석에 남은 옛 이름까지 결함으로 세지 않는다. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
/** HTML 주석 제거 — 주석 안의 설명 문구가 금지어 검사에 걸리지 않게. */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

function must(cond, message) {
  if (!cond) failures.push(message);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. orb-window.js — 창 옵션과 기하(순수 함수)
// ─────────────────────────────────────────────────────────────────────────
const owRaw = read("lib/main/orb-window.js");
if (owRaw) {
  const ow = stripComments(owRaw);
  for (const name of [
    "ORB_SIZE",
    "computeOrbPlacement",
    "computeExpandedBounds",
    "buildOrbWindowOptions",
  ]) {
    must(new RegExp(`\\b${name}\\b`).test(ow), `orb-window.js: ${name}을 내보내야 한다`);
  }
  // 76px은 GLOSSARY §1이 못박은 수치다 — 값이 흔들리면 정의가 흔들린다.
  must(/ORB_SIZE\s*=\s*76\b/.test(ow), "orb-window.js: ORB_SIZE는 76이어야 한다(GLOSSARY §1)");

  for (const [re, why] of [
    [/alwaysOnTop:\s*true/, "오브는 alwaysOnTop이다(GLOSSARY §1)"],
    [/frame:\s*false/, "오브도 frame:false다"],
    [/transparent:\s*true/, "원형 창이려면 투명창이어야 한다 — 사각 배경이 남으면 원형이 아니다"],
    [/skipTaskbar:\s*true/, "상시 표시 오브는 작업 표시줄을 차지하지 않는다"],
    [/resizable:\s*false/, "오브 크기는 접힘/펼침 두 상태뿐이다 — 사용자 리사이즈 대상이 아니다"],
    [/nodeIntegration:\s*false/, "렌더러 격리(nodeIntegration:false)"],
    [/contextIsolation:\s*true/, "렌더러 격리(contextIsolation:true)"],
    [/sandbox:\s*true/, "렌더러 격리(sandbox:true)"],
  ]) {
    must(re.test(ow), `orb-window.js: ${why}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. orb.html — 넘치면 안 되는 것
// ─────────────────────────────────────────────────────────────────────────
const htmlRaw = read("orb.html");
if (htmlRaw) {
  const html = stripHtmlComments(htmlRaw);

  // (a) 미니 입력창 없음 — 입력 지점은 셸 창 커맨드바 하나뿐이다.
  must(!/<input\b/i.test(html), "orb.html: 입력창이 있다 — 입력 지점은 셸 창 하나뿐이다");
  must(!/<textarea\b/i.test(html), "orb.html: textarea가 있다 — 입력 지점은 셸 창 하나뿐이다");
  must(!/contenteditable/i.test(html), "orb.html: contenteditable이 있다 — 사실상 입력창이다");

  // (b) 실행 버튼 없음 — 확정 결정 3. 버튼 id를 화이트리스트로 잠근다.
  const ALLOWED_BUTTON_IDS = new Set(["orbToggle", "orbMore", "orbClose"]);
  const buttonIds = [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/gi)].map((m) => m[1]);
  const anonymousButtons = (html.match(/<button\b(?![^>]*\bid=)/gi) || []).length;
  must(anonymousButtons === 0, `orb.html: id 없는 <button>이 ${anonymousButtons}개 — 모든 액션은 이름이 있어야 검사할 수 있다`);
  for (const id of buttonIds) {
    must(ALLOWED_BUTTON_IDS.has(id),
      `orb.html: 허용되지 않은 버튼 #${id} — 오브의 액션은 펼침·더보기·닫기까지다(확정 결정 3)`);
  }
  must(buttonIds.length > 0, "orb.html: 버튼이 하나도 없다 — 더보기 경로가 있어야 셸로 넘어간다");
  must(buttonIds.includes("orbMore"), "orb.html: #orbMore(더보기)가 없다 — 오브에서 셸로 가는 유일한 경로다");

  // (c) 텍스트 대조군 — 버튼 id를 우회해 실행 어포던스를 심는 것도 막는다.
  for (const word of ["매수", "매도", "주문 실행", "즉시 실행", "지금 실행"]) {
    must(!html.includes(word), `orb.html: 실행을 암시하는 문구 "${word}"가 있다(확정 결정 3)`);
  }

  // (d) 존재 검사 — 부재 검사만으로는 빈 파일도 통과한다.
  for (const needle of [
    "styles/tokens.css",
    "styles/access.css",
    "orb.css",
    "orb.js",
    "lib/routine-turn.js",
  ]) {
    must(html.includes(needle), `orb.html: ${needle}을 링크/로드해야 한다`);
  }
  must(/id="orb"/.test(html), "orb.html: #orb(접힘 상태의 원형)가 있어야 한다");
}

// ─────────────────────────────────────────────────────────────────────────
// 3. orb.css — 원형 76px
// ─────────────────────────────────────────────────────────────────────────
const cssRaw = read("orb.css");
if (cssRaw) {
  const orbRule = /#orb\s*\{[^}]*\}/.exec(cssRaw);
  if (!orbRule) {
    failures.push("orb.css: #orb 규칙이 없다");
  } else {
    must(/border-radius:\s*50%/.test(orbRule[0]), "orb.css: #orb은 border-radius:50%인 원형이어야 한다");
    must(/width:\s*76px/.test(orbRule[0]), "orb.css: #orb 폭은 76px여야 한다(GLOSSARY §1)");
    must(/height:\s*76px/.test(orbRule[0]), "orb.css: #orb 높이는 76px여야 한다(GLOSSARY §1)");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. orb.js — 오브가 할 수 없어야 하는 IPC
// ─────────────────────────────────────────────────────────────────────────
const orbJsRaw = read("orb.js");
if (orbJsRaw) {
  const orbJs = stripComments(orbJsRaw);
  for (const [channel, why] of [
    ["athena__render_canvas", "오브는 질의를 시작하지 않는다 — 입력 지점은 셸 하나뿐이다"],
    ["athena:order-execute", "확정 결정 3 — 주문 집행은 오브에 없다"],
    ["athena:routine-confirm", "감시 승인도 오브의 액션이 아니다(설계서: 액션은 더보기까지)"],
    ["athena:routine-cancel", "감시 취소도 오브의 액션이 아니다"],
  ]) {
    must(!orbJs.includes(channel), `orb.js: '${channel}' 호출이 있다 — ${why}`);
  }
  // 정직성 계약 — 본문은 결정론 템플릿을 그대로 쓴다(지어낼 수 없다).
  // **두 조건을 모두** 건다: 진짜 모듈을 바인딩할 것 + 그 함수를 실제로 부를 것.
  // 하나만 걸면 스텁 객체로 이름만 맞춰도 통과한다 — 양성 대조군 ⑤가 실제로
  // 그렇게 뚫었고(2026-08-24), 그래서 검사를 여기서 조였다.
  must(/window\.AthenaLib\.RoutineTurn/.test(orbJs),
    "orb.js: window.AthenaLib.RoutineTurn을 바인딩해야 한다(결정론 템플릿의 진짜 출처)");
  must(/\bbuildTurnModel\s*\(/.test(orbJs),
    "orb.js: buildTurnModel()을 실제로 호출해야 한다(LLM 0, 시점 정직성 — 문장을 짓지 않는다)");
  must(orbJs.includes("athena:routine-event"),
    "orb.js: 능동 턴 이벤트를 구독해야 한다 — 오브가 받는 유일한 발생원이다");
}

// ─────────────────────────────────────────────────────────────────────────
// 5. main.js / preload.js — 배선
// ─────────────────────────────────────────────────────────────────────────
const mainRaw = read("main.js");
if (mainRaw) {
  const main = stripComments(mainRaw);
  must(/\borbWin\b/.test(main), "main.js: orbWin이 없다");
  must(/getWins:\s*\(\)\s*=>\s*\(\{\s*shellWin,\s*orbWin\s*\}\)/.test(main),
    "main.js: getWins()는 { shellWin, orbWin }을 돌려줘야 한다 — verify.js가 이 모양에 의존한다");
  must(/orbWin\.webContents\.send\('athena:routine-event'/.test(main),
    "main.js: RoutineFeed 이벤트를 오브에도 보내야 한다");
  // 셸은 alwaysOnTop이 아니다 — 2026-08-17 결정("다른 앱 위에 영구히 떠서 창을
  // 내릴 수 없다"는 실사용 문제). 오브만 예외다. 옵션이 commonWinOpts로 새면 잡는다.
  const common = /function commonWinOpts\([\s\S]*?\n\}/.exec(main);
  must(common && !/alwaysOnTop:\s*true/.test(common[0]),
    "main.js: commonWinOpts에 alwaysOnTop이 샜다 — 셸 창은 항상 위가 아니다(2026-08-17 결정)");
}

const preloadRaw = read("preload.js");
if (preloadRaw) {
  const preload = stripComments(preloadRaw);
  for (const ch of ["athena:orb-toggle", "athena:orb-open-shell"]) {
    must(preload.includes(`'${ch}'`), `preload.js: 오브 채널 '${ch}'이 없다`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("오브 계약 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("오브 76px 원형 · alwaysOnTop · 실행 버튼 0 · 입력창 0 · 결정론 본문 통과");
console.log("orb contract verification passed");
