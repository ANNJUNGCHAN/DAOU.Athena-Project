/**
 * leaf-1.3.1 게이트 — 알림 오브 창이 계약대로 존재하는지 소스를 직접 파싱해 잰다.
 *
 * 이 게이트의 절반은 **없어야 하는 것**을 잰다. 오브의 위험은 기능이 모자란 것이
 * 아니라 **넘치는 것**이다: 실행 버튼 하나가 확정 결정 3(주문은 사람이 낸다)을
 * 깬다. 그래서 존재 검사보다 부재 검사를 더 촘촘히 건다 — 부재 검사는 양성
 * 대조군 없이는 믿을 수 없으므로(빈 파일도 통과한다) 존재 검사와 짝지어 둘 다
 * 성립할 때만 초록을 준다.
 *
 * 2026-09-07 — 키우미는 셸 표시 여부와 무관하게 #orbInput에서 질문을 받는다.
 * 질의는 셸과 같은 runLiveQuery로 이어지고(athena:orb-chat-submit), 진행 중인
 * 질의는 두 창의 공유 잠금으로 보호한다. 입력·알림 전환의 실제 동작은
 * app/probe-orb-conversation.js가 검증하고, 이 게이트는 입력 표면과 IPC 배선을 잰다.
 *
 * 실행: node scripts/gates/check-orb.mjs
 * 성공 표지: orb contract verification passed
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

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
  // 줄 주석을 먼저 벗긴다(2026-08-27 병합 점검) — 블록을 먼저 벗기면 줄 주석 안의
  // "lib/*.js" 같은 글롭이 블록 열림으로 잡혀 다음 */까지 코드가 통째로 삼켜진다
  // (실측: orb.js 1151→1342 191줄이 사라져 그 구간의 존재·금지 검사가 다 눈멀었다).
  // https:// 류 URL은 앞의 :가 지켜준다(기존 규칙 유지).
  return src
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
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

  // (a) 키우미의 입력창은 #orbInput 하나까지만 허용한다.
  // 그 밖의 input·모든 textarea·contenteditable은 여전히
  // 금지다(둘 이상의 입력창이나 이름 없는 입력창은 게이트로 못 잰다).
  const inputIds = [...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)].map((m) => m[1]);
  const anonymousInputs = (html.match(/<input\b(?![^>]*\bid=)/gi) || []).length;
  must(anonymousInputs === 0, `orb.html: id 없는 <input>이 ${anonymousInputs}개 — 모든 입력창은 이름이 있어야 검사할 수 있다`);
  for (const id of inputIds) {
    must(id === "orbInput", `orb.html: 허용되지 않은 입력창 #${id} — board-33이 연 것은 #orbInput 하나뿐이다`);
  }
  must(!/<textarea\b/i.test(html), "orb.html: textarea가 있다 — 대화 입력은 한 줄(#orbInput)까지다");
  must(!/contenteditable/i.test(html), "orb.html: contenteditable이 있다 — 사실상 입력창이다");

  // (b) 실행 버튼 없음 — 확정 결정 3. 버튼 id를 화이트리스트로 잠근다.
  // orbEsc(답변 중단) · orbChatGo(대화창으로 가기)는 board-33이 추가한 대화 모드
  // 부품이다 — 둘 다 주문·감시를 건드리지 않는다(집행 0, 승인 0).
  // orbTicketExec/orbTicketCancel(2026-08-27 CP2 사용자 승인, board-33⑤ 캡션
  // 50G-0/50H-0) — 미니 주문 티켓의 실행/취소뿐이다. 감시 승인/취소 버튼은
  // 이 화이트리스트에 없다 — 그건 승인 대상이 아니다(CP2는 주문집행 절반만).
  const ALLOWED_BUTTON_IDS = new Set([
    "orbToggle", "orbMore", "orbClose", "orbEsc", "orbChatGo",
    "orbTicketExec", "orbTicketCancel",
  ]);
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
  // 구매·판매는 셸 주문 티켓이 Paper 보드 22로 옮겨 간 어휘다 — 대조군이 옛 어휘만
  // 보면 새 말로 쓴 실행 어포던스가 그냥 통과한다(verify.js의 같은 목적 정규식과 맞춘다).
  for (const word of ["매수", "매도", "구매", "판매", "주문 실행", "즉시 실행", "지금 실행"]) {
    must(!html.includes(word), `orb.html: 실행을 암시하는 문구 "${word}"가 있다(확정 결정 3)`);
  }

  // (d) 존재 검사 — 부재 검사만으로는 빈 파일도 통과한다.
  for (const needle of [
    "styles/tokens.css",
    "styles/access.css",
    "orb.css",
    "orb.js",
    "lib/routine-turn.js",
    // 2026-08-27 병합 점검 — 아래 둘이 빠져도 게이트가 통과를 찍었다(실측):
    // card-primitives가 빠지면 미니 차트가 TypeError, market-hours가 빠지면
    // drowsy가 조용히 죽는다(orb.js가 undefined 폴백). 존재+바인딩+호출 3중
    // 검사(routine-turn과 같은 틀)로 조인다 — 바인딩·호출 검사는 §4에 있다.
    "lib/market-hours.js",
    "lib/card-primitives.js",
  ]) {
    must(html.includes(needle), `orb.html: ${needle}을 링크/로드해야 한다`);
  }
  must(/id="orb"/.test(html), "orb.html: #orb(접힘 상태의 원형)가 있어야 한다");

  // (e) 미니 주문 티켓 존재 검사(2026-08-27 CP2 승인, board-33⑤ · Paper 51D-0
  // 실측) — #orbTicket 컨테이너가 생기는 Step 10b부터 켜진다. Step 10a(이
  // 커밋) 시점에는 컨테이너 자체가 없어 아래 블록 전체를 건너뛴다 — 존재
  // 검사가 아직 짓지 않은 UI를 요구해 게이트를 막으면 단계적 롤아웃이 안 된다.
  if (html.includes('id="orbTicket"')) {
    must(buttonIds.includes("orbTicketExec"), "orb.html: #orbTicketExec(실행)이 없다 — 티켓엔 실행 버튼이 있어야 한다(board-33⑤)");
    must(buttonIds.includes("orbTicketCancel"), "orb.html: #orbTicketCancel(취소)이 없다");
    for (const label of ["종목", "구분", "수량", "예상 체결금액"]) {
      must(html.includes(label), `orb.html: 티켓 라벨 "${label}"이 없다(Paper 51D-0 실측)`);
    }
    must(html.includes("1회 확인"),
      'orb.html: "1회 확인" 라벨이 없다(board-33⑤ 캡션 50G-0 — 방어 장치 없이 셸과 동일한 1회 확인)');
  }
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
  // 2026-08-27 CP2 사용자 승인(board-33⑤ 캡션 50G-0/50H-0 원문: "⑤ 미니 주문
  // 티켓 — 오브에서 집행한다" / "확정 결정 3의 다른 절반도 폐기된다. 방어
  // 장치 없이 셸과 동일하게 1회 확인 — alwaysOnTop 창에 실행 버튼이 상주한다는
  // 뜻이다") — athena:order-execute 금지만 풀렸다. 질의 시작(render_canvas)과
  // 감시 승인/취소는 승인 대상이 아니라 여전히 금지다.
  for (const [channel, why] of [
    ["athena__render_canvas", "오브는 질의를 시작하지 않는다 — 입력 지점은 셸 하나뿐이다"],
    ["athena:routine-confirm", "감시 승인도 오브의 액션이 아니다(설계서: 액션은 더보기까지)"],
    ["athena:routine-cancel", "감시 취소도 오브의 액션이 아니다"],
  ]) {
    must(!orbJs.includes(channel), `orb.js: '${channel}' 호출이 있다 — ${why}`);
  }
  // 반대 방향 존재 검사 — 금지가 풀렸다고 실제 호출이 없으면 이 완화는 죽은
  // 코드다. #orbTicketExec를 참조하는 순간부터(Step 10c) 실제 호출을 요구한다
  // — 10a/10b 시점에는 orb.js가 그 id를 아직 몰라 이 블록을 건너뛴다.
  if (/orbTicketExec/.test(orbJs)) {
    must(orbJs.includes("athena:order-execute"),
      "orb.js: 티켓 실행 버튼은 참조하는데 'athena:order-execute' 호출이 없다 — CP2 승인 대상 자체가 빠졌다");
  }

  // 문구 대조군(orb.js 판) — 위 (c)는 orb.html만 본다. 구분(매수/매도) 값은
  // "없는 필드 행 미생성" 계약상 정적 HTML에 못 박을 수 없어 renderOrbTicket()이
  // 런타임에 조립한다 — 그 조립부 **밖**에서 같은 문구가 보이면 CP2 승인 범위
  // (티켓 하나)를 넘어선 것이라 여전히 결함이다. 함수가 아직 없는 10a/10b는
  // 건너뛴다.
  const ticketFnMatch = /function\s+renderOrbTicket\s*\([^)]*\)\s*\{/.exec(orbJs);
  if (ticketFnMatch) {
    let depth = 1;
    let i = ticketFnMatch.index + ticketFnMatch[0].length;
    for (; i < orbJs.length && depth > 0; i++) {
      if (orbJs[i] === "{") depth++;
      else if (orbJs[i] === "}") depth--;
    }
    const outsideTicketFn = orbJs.slice(0, ticketFnMatch.index) + orbJs.slice(i);
    for (const word of ["매수", "매도", "구매", "판매", "주문 실행", "즉시 실행", "지금 실행"]) {
      must(!outsideTicketFn.includes(word),
        `orb.js: renderOrbTicket() 밖에서 실행을 암시하는 문구 "${word}"가 있다(CP2는 티켓 하나만 승인했다)`);
    }
  }
  // 정직성 계약 — 본문은 결정론 템플릿을 그대로 쓴다(지어낼 수 없다).
  // **두 조건을 모두** 건다: 진짜 모듈을 바인딩할 것 + 그 함수를 실제로 부를 것.
  // 하나만 걸면 스텁 객체로 이름만 맞춰도 통과한다 — 양성 대조군 ⑤가 실제로
  // 그렇게 뚫었고(2026-08-24), 그래서 검사를 여기서 조였다.
  must(/window\.AthenaLib\.RoutineTurn/.test(orbJs),
    "orb.js: window.AthenaLib.RoutineTurn을 바인딩해야 한다(결정론 템플릿의 진짜 출처)");
  must(/\bbuildTurnModel\s*\(/.test(orbJs),
    "orb.js: buildTurnModel()을 실제로 호출해야 한다(LLM 0, 시점 정직성 — 문장을 짓지 않는다)");
  // market-hours·card-primitives도 같은 2중 검사(2026-08-27 병합 점검) — §2 (d)의
  // 존재 검사와 짝이다. 하나만 걸면 스텁으로 뚫린다는 교훈(양성 대조군 ⑤)도 같다.
  must(/window\.AthenaLib\.MarketHours/.test(orbJs),
    "orb.js: window.AthenaLib.MarketHours를 바인딩해야 한다(장 마감 drowsy 판정의 진짜 출처)");
  must(/\bisMarketOpen\s*\(/.test(orbJs),
    "orb.js: isMarketOpen()을 실제로 호출해야 한다(board-30⑫ — 로컬 시계 판정의 단일 구현)");
  must(/window\.AthenaLib\.CardPrimitives/.test(orbJs),
    "orb.js: window.AthenaLib.CardPrimitives를 바인딩해야 한다(미니 차트 폴리라인의 진짜 출처)");
  must(/\bchartLinePoints\s*\(/.test(orbJs),
    "orb.js: chartLinePoints()를 실제로 호출해야 한다(board-33④ 미니 차트 축약)");
  must(orbJs.includes("athena:routine-event"),
    "orb.js: 능동 턴 이벤트를 구독해야 한다 — 오브가 받는 유일한 발생원이다");

  // 셸 표시 신호로 기본 표면을 동기화하고, 알림에서도 사용자가 대화를 시작한다.
  // 질의는 셸과 같은 runLiveQuery로 이어지는 전용 채널 하나로만 나가야 한다.
  must(orbJs.includes("athena:shell-visibility"),
    "orb.js: athena:shell-visibility를 구독해야 한다 — 셸과 키우미의 기본 표면을 동기화한다");
  must(orbJs.includes("athena:orb-chat-submit"),
    "orb.js: athena:orb-chat-submit을 불러야 한다 — 오브가 자기 질의 파이프라인을 새로 만들면 안 된다");
}

// ─────────────────────────────────────────────────────────────────────────
// 5. main.js / preload.js — 배선
// ─────────────────────────────────────────────────────────────────────────
const mainRaw = read("main.js");
if (mainRaw) {
  const main = stripComments(mainRaw);
  must(/\borbWin\b/.test(main), "main.js: orbWin이 없다");
  must(/getWins:\s*\(\)\s*=>\s*\(\{\s*bootWin,\s*shellWin,\s*orbWin\s*\}\)/.test(main),
    "main.js: getWins()는 { bootWin, shellWin, orbWin }을 돌려줘야 한다 — verify.js가 handoff와 오브를 검사한다");
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
// 6. Glau — approved SVG, ten expressions, existing motion and alert state.
// ─────────────────────────────────────────────────────────────────────────
const glauRaw = read("lib/glau-mascot.js");
const glauCssRaw = read("styles/glau-mascot.css");
if (htmlRaw && cssRaw && orbJsRaw && glauRaw && glauCssRaw) {
  const html = stripHtmlComments(htmlRaw);
  const orbJs = stripComments(orbJsRaw);
  const css = stripComments(cssRaw);
  const glauCss = stripComments(glauCssRaw);

  for (const [src, name] of [[html, "orb.html"], [css, "orb.css"], [glauRaw, "glau-mascot.js"], [glauCss, "glau-mascot.css"]]) {
    must(!/<img\b|\.png|\.jpe?g|\.webp|data:image\//i.test(src), name + ": Glau must remain native SVG, without raster assets");
  }
  must(/id="orbVisor"/.test(html), "orb.html: #orbVisor SVG host is missing");
  for (const asset of ["lib/glau-mascot.js", "styles/glau-mascot.css"]) {
    must(html.includes(asset), "orb.html: shared Glau asset is missing: " + asset);
  }
  must(html.indexOf('src="lib/glau-mascot.js"') < html.indexOf('src="orb.js"'),
    "orb.html: shared Glau renderer must load before orb.js");
  must(/#orbVisor\s*\{/.test(css), "orb.css: #orbVisor layout is missing");
  const orbRule = /#orb\s*\{[^}]*\}/.exec(css);
  must(orbRule && /background:\s*transparent\s*;/.test(orbRule[0]),
    "orb.css: Glau host background must be transparent");
  must(/window\.AthenaLib\.GlauMascot/.test(orbJs), "orb.js: bind the shared Glau renderer");
  must(/glauMascot\.render\(glauHost,\s*face\)/.test(orbJs), "orb.js: render the initial Glau state");
  must(/glauMascot\.render\(glauHost,\s*next\)/.test(orbJs), "orb.js: render each changed Glau state");

  for (const variable of ["--orb-gx", "--orb-gy", "--orb-lid"]) {
    must(glauCss.includes(variable) && orbJs.includes(variable), "Glau gaze/blink variable is not wired: " + variable);
  }
  must(/\.glau-gaze\s*\{[^}]*transform:\s*translate\(/.test(glauCss), "Glau gaze must translate the eyes geometrically");
  must(/\.glau-lid\s*\{[^}]*transform:\s*scaleY\(/.test(glauCss), "Glau blink must scale the independent lid layer");
  must(glauCss.includes("prefers-reduced-motion") && /\.glau-lid\s*\{\s*transform:\s*none/.test(glauCss),
    "Glau reduced-motion must keep the resting eyes visible");
  must(/animation:\s*orb-breathe/.test(css) && /@keyframes orb-breathe/.test(css), "Glau breathing loop is missing");
  must(/function renderPresence\s*\(/.test(orbJs) && /dataset\.alert/.test(orbJs) && /data-alert/.test(css),
    "orb.js/orb.css: preserve existing alert/badge state ownership");
  must(/dataset\.face/.test(orbJs), "orb.js: preserve the existing face signal state");

  try {
    const glau = createRequire(import.meta.url)(join(APP, "lib/glau-mascot.js"));
    const palette = { body: "#BF9B81", face: "#FFF3E2", eye: "#27251F", beak: "#ECAA43", wing: "#354D70", olive: "#687048", tear: "#7EA6BD" };
    for (const [key, value] of Object.entries(palette)) must(glau.PALETTE[key] === value, "Glau palette mismatch: " + key);
    const states = { idle: "neutral", listen: "neutral", watch: "neutral", think: "thinking", done: "happy", wink: "wink", glad: "joy", fired: "surprised", surprise: "surprised", frown: "error", crying: "cry", mopey: "sad", sleep: "sleepy", drowsy: "sleepy" };
    must(new Set(glau.EXPRESSIONS).size === 10, "Glau must expose ten approved expressions");
    for (const [state, expression] of Object.entries(states)) {
      must(glau.expressionForState(state) === expression, "Glau signal mapping mismatch: " + state);
      const markup = glau.svg(state);
      must(markup.includes('data-expression="' + expression + '"'), "Glau SVG expression mismatch: " + state);
      must(/<circle class="glau-body" cx="64" cy="70" r="49" fill="#BF9B81"/.test(markup),
        "Glau body geometry/palette must match the approved round silhouette: " + state);
      must(/class="glau-cream-face"[^>]*fill="#FFF3E2"/.test(markup)
        && /class="glau-wings" fill="#354D70"/.test(markup), "Glau rendered face/wing palette mismatch: " + state);
      for (const part of ["glau-body", "glau-cream-face", "glau-gaze", "glau-lid", "glau-wings", "glau-olive-leaves"]) {
        must(markup.includes('class="' + part + '"'), "Glau SVG part missing: " + state + " / " + part);
      }
    }
    for (const state of ["idle", "fired"]) {
      const eyes = (glau.svg(state).match(/class="glau-eye"/g) || []).length;
      must(eyes === 2, "Glau eyes must remain a pair: " + state);
      must((glau.svg(state).match(/class="glau-eye"[^>]*fill="#27251F"/g) || []).length === 2,
        "Glau rendered eyes palette mismatch: " + state);
    }
    const host = { dataset: {}, innerHTML: "" };
    glau.render(host, "idle");
    must(host.innerHTML === glau.svg("idle"), "Glau render must mount the initial SVG");
    glau.render(host, "fired");
    must(host.innerHTML === glau.svg("fired"), "Glau render must update on an alert");
  } catch (error) {
    failures.push("Glau renderer cannot be verified: " + error.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("오브 계약 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("오브 76px 원형 · alwaysOnTop · 글라우 입력창 1 · 공유 질의 IPC · 결정론 본문 통과");
console.log("orb contract verification passed");
