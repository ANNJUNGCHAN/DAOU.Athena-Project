/**
 * leaf-1.2.1 게이트 — 창 모델이 "짝 창 2개"에서 "셸 창 하나"로 실제로 넘어갔는지
 * 소스를 직접 파싱해 잰다. Electron 부팅 없이 도는 정적 오라클이다.
 *
 * 왜 정적으로도 재는가: `npm run verify`(G3)는 실제 부팅을 잰다. 하지만 부팅이
 * 성공해도 옛 짝 배치 코드가 죽은 채 남아 있을 수 있다 — 죽은 경로는 다음 리프가
 * 되살릴 수 있는 함정이라 "사라졌음"을 별도로 재야 한다(1.1.2에서 죽은 단계가
 * 게이트를 통과한 전례).
 *
 * 두 모드:
 *   node scripts/gates/check-window-model.mjs         → 창 모델 전환 검사
 *   node scripts/gates/check-window-model.mjs --xss   → innerHTML 문자열 싱크 검사
 *
 * 성공 표지: window model verification passed / innerHTML string-sink check passed
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

/** 주석을 걷어낸 소스. "옛 이름이 주석에만 남았다"를 통과시키기 위해서다. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function mustNotContain(rel, src, ident, why) {
  const re = new RegExp(`\\b${ident}\\b`);
  if (re.test(src)) failures.push(`${rel}: 옛 창 모델의 \`${ident}\`가 코드에 남아 있다 — ${why}`);
}

function mustContain(rel, src, needle, why) {
  const ok = needle instanceof RegExp ? needle.test(src) : src.includes(needle);
  if (!ok) failures.push(`${rel}: ${why} (찾지 못함: ${needle})`);
}

// ─────────────────────────────────────────────────────────────────────────
// --xss 모드: innerHTML 문자열 싱크 0건 (함정 ⑪ — 저장형 XSS)
// ─────────────────────────────────────────────────────────────────────────
if (process.argv.includes("--xss")) {
  const TARGETS = ["shell.js", "chat.js", "canvas.js", "orb.js", "main.js", "preload.js", "verify.js"];
  // 대입 싱크만 잡는다. `.innerHTML` 읽기는 싱크가 아니다.
  const SINK = /\.(innerHTML|outerHTML)\s*(\+)?=|\.insertAdjacentHTML\s*\(/;
  let scanned = 0;
  for (const rel of TARGETS) {
    const p = join(APP, rel);
    if (!existsSync(p)) continue; // shell.js는 이 리프가 만들기 전엔 없다
    scanned += 1;
    const lines = stripComments(readFileSync(p, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (SINK.test(line)) failures.push(`${rel}:${i + 1}: innerHTML 문자열 싱크 — ${line.trim()}`);
    });
  }
  if (scanned === 0) failures.push("검사 대상 파일을 하나도 못 읽었다 — 검사기가 아무것도 안 쟀다");
  if (failures.length > 0) {
    console.error("innerHTML 싱크 검사 실패:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`대상 ${scanned}개 파일에서 대입 싱크 0건`);
  console.log("innerHTML string-sink check passed");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. main.js — 창은 하나, 짝 배치의 잔재는 0건
// ─────────────────────────────────────────────────────────────────────────
const mainRaw = read("main.js");
if (mainRaw) {
  const main = stripComments(mainRaw);

  for (const [ident, why] of [
    ["chatWin", "셸 창 하나로 합쳐졌다"],
    ["canvasWin", "셸 창 하나로 합쳐졌다"],
    ["canvasVisible", "중앙 캔버스는 늘 떠 있다 — 가시성 상태가 없다"],
    ["expandCanvasWindow", "창 확장 연출이 사라졌다"],
    ["collapseCanvasWindow", "창 수축 연출이 사라졌다"],
    ["setChatHeight", "채팅은 고정 폭 영역이라 창 높이로 자라지 않는다"],
    ["chatBaseH", "대화 창 높이 앵커가 사라졌다"],
    ["chatMaxH", "대화 창 높이 앵커가 사라졌다"],
    ["chatBottom", "대화 창 하단 앵커가 사라졌다"],
    ["syncChatAnchor", "대화 창 앵커 동기화가 사라졌다"],
    ["computePlacement", "짝 배치가 셸 단일 배치로 대체됐다"],
  ]) {
    mustNotContain("main.js", main, ident, why);
  }

  mustContain("main.js", main, /\bshellWin\b/, "셸 창 변수 `shellWin`이 있어야 한다");
  mustContain("main.js", main, /computeShellPlacement/, "셸 단일 배치 계산을 써야 한다");
  mustContain("main.js", main, /['"]shell\.html['"]/, "셸 창이 shell.html을 로드해야 한다");
  // getWins()가 돌려주는 창 집합 = 이 앱의 OS 창 전부. 2026-08-24 리프 1.3.1에서
  // `{ shellWin }` → `{ shellWin, orbWin }`으로 늘었다. 이름을 정확히 나열해
  // **세 번째 창이 조용히 끼어드는 것**을 막는다.
  const wins = /getWins:\s*\(\)\s*=>\s*\(\{([^}]*)\}\)/.exec(main);
  if (!wins) {
    failures.push("main.js: getWins() 반환 형상을 찾지 못했다 — verify.js가 이 모양에 의존한다");
  } else {
    const names = wins[1].split(",").map((s) => s.trim()).filter(Boolean);
    const expected = ["shellWin", "orbWin"];
    if (names.join(",") !== expected.join(",")) {
      failures.push(
        `main.js: getWins()가 [${names.join(", ")}] — [${expected.join(", ")}] 이어야 한다 ` +
          `(창은 둘뿐이다, GLOSSARY §1)`
      );
    }
  }

  // 창 생성 횟수. 워밍업 창은 commonWinOpts를 안 쓰므로 이 셈에서 빠지고,
  // 오브 창도 자기 옵션 빌더(orb-window.js buildOrbWindowOptions)를 쓰므로 빠진다 —
  // alwaysOnTop이 셸 쪽으로 새지 않게 옵션을 일부러 안 공유한다.
  const created = (main.match(/new BrowserWindow\(commonWinOpts\(/g) || []).length;
  if (created !== 1) {
    failures.push(`main.js: commonWinOpts로 만드는 창이 ${created}개 — 셸 창 1개여야 한다(오브는 자기 옵션 빌더를 쓴다)`);
  }

  // 음성 대조군 — 지켜져야 하는 것이 함께 사라지지 않았는지 본다. 이게 없으면
  // "main.js를 통째로 비우면 통과"가 성립한다.
  for (const [needle, why] of [
    [/frame:\s*false/, "frame:false는 유지된다"],
    [/nodeIntegration:\s*false/, "렌더러 격리(nodeIntegration:false)는 유지된다"],
    [/contextIsolation:\s*true/, "렌더러 격리(contextIsolation:true)는 유지된다"],
    [/sandbox:\s*true/, "렌더러 격리(sandbox:true)는 유지된다"],
    [/backgroundThrottling:\s*false/, "캡처 스로틀 회귀 방지 설정은 유지된다"],
    [/startRoutineFeed\(\)/, "루틴 피드 구독은 유지된다 — 오브(1.3.1)가 이 경로를 탄다"],
    [/startCanvasFeed\(\)/, "캔버스 사이드 채널 구독은 유지된다"],
  ]) {
    mustContain("main.js", main, needle, why);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. window-placement.js — 단일 창 배치
// ─────────────────────────────────────────────────────────────────────────
const placeRaw = read("lib/main/window-placement.js");
if (placeRaw) {
  const place = stripComments(placeRaw);
  mustContain("window-placement.js", place, /function computeShellPlacement/,
    "셸 창 단일 배치 함수를 내보내야 한다");
  mustNotContain("window-placement.js", place, "computePlacement", "짝 배치는 폐기됐다");
  mustNotContain("window-placement.js", place, "chatBounds", "짝 배치 반환값은 폐기됐다");
  mustNotContain("window-placement.js", place, "canvasBounds", "짝 배치 반환값은 폐기됐다");
  mustContain("window-placement.js", place, /module\.exports\s*=\s*\{\s*computeShellPlacement\s*\}/,
    "내보내기는 computeShellPlacement 하나여야 한다");
}

// ─────────────────────────────────────────────────────────────────────────
// 3. preload.js — 죽은 채널이 다리에 남아 있으면 안 된다
// ─────────────────────────────────────────────────────────────────────────
const preloadRaw = read("preload.js");
if (preloadRaw) {
  const preload = stripComments(preloadRaw);
  for (const ch of [
    "athena:set-chat-height",
    "athena:collapse-canvas",
    "athena:window-key",
    "athena:manual-resize",
    "prime-clip",
    "run-animation",
    "primed",
    "animation-done",
  ]) {
    if (preload.includes(`'${ch}'`) || preload.includes(`"${ch}"`)) {
      failures.push(`preload.js: 죽은 채널 '${ch}'이 다리에 남아 있다 — 창 확장/자동성장 경로는 사라졌다`);
    }
  }
  // 음성 대조군 — 살아 있어야 하는 채널.
  for (const ch of ["athena__render_canvas", "athena:add-canvas", "athena:routine-event", "athena:prefs-changed"]) {
    if (!preload.includes(`'${ch}'`)) failures.push(`preload.js: 살아 있어야 할 채널 '${ch}'이 없다`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. shell.html / shell.css — 셸 창의 문서가 실제로 존재하고 영역 계약을 가진다
// ─────────────────────────────────────────────────────────────────────────
const html = read("shell.html");
if (html) {
  for (const [needle, why] of [
    ['id="canvasRegion"', "중앙 캔버스 영역"],
    ['id="chatRegion"', "우측 채팅 영역"],
    ["styles/tokens.css", "토큰(유리 사다리 SSOT)을 링크해야 한다"],
    ["styles/access.css", "접근성 3종 CSS를 링크해야 한다"],
    ["shell.js", "셸 부트스트랩 스크립트를 로드해야 한다"],
    ["chat.js", "채팅 렌더러를 로드해야 한다"],
    ["canvas.js", "캔버스 렌더러를 로드해야 한다"],
  ]) {
    mustContain("shell.html", html, needle, `${why}가 있어야 한다`);
  }
  // 이 리프는 좌측 사이드바를 만들지 않는다 — 스텁을 심으면 다음 리프가 "이미 있다"고
  // 오인한다. 빈 껍데기가 들어오면 게이트가 잡는다.
  if (/id="historyRail"|id="historySidebar"/.test(html)) {
    failures.push("shell.html: 좌측 이력 사이드바는 1.2.2의 산출물이다 — 이 리프에서 빈 스텁으로 심지 마라");
  }
}

const css = read("shell.css");
if (css) {
  const chat = /#chatRegion\s*\{[^}]*\}/.exec(css);
  if (!chat) {
    failures.push("shell.css: #chatRegion 규칙이 없다");
  } else {
    if (!/width:\s*400px/.test(chat[0])) failures.push("shell.css: #chatRegion 폭이 400px여야 한다(계약)");
    if (!/flex-shrink:\s*0/.test(chat[0])) failures.push("shell.css: #chatRegion은 어떤 상태에서도 접히지 않는다 — flex-shrink:0이어야 한다");
  }
  const canvas = /#canvasRegion\s*\{[^}]*\}/.exec(css);
  if (!canvas) {
    failures.push("shell.css: #canvasRegion 규칙이 없다");
  } else if (!/flex:\s*1/.test(canvas[0])) {
    failures.push("shell.css: #canvasRegion은 flex여야 한다(계약)");
  }
}

// ─────────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("창 모델 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("창 2개(셸+오브) · 짝 배치 잔재 0건 · 영역 계약(캔버스 flex · 채팅 400px 고정) 통과");
console.log("window model verification passed");
