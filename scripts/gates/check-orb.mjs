/**
 * leaf-1.3.1 게이트 — 알림 오브 창이 계약대로 존재하는지 소스를 직접 파싱해 잰다.
 *
 * 이 게이트의 절반은 **없어야 하는 것**을 잰다. 오브의 위험은 기능이 모자란 것이
 * 아니라 **넘치는 것**이다: 실행 버튼 하나가 확정 결정 3(주문은 사람이 낸다)을
 * 깬다. 그래서 존재 검사보다 부재 검사를 더 촘촘히 건다 — 부재 검사는 양성
 * 대조군 없이는 믿을 수 없으므로(빈 파일도 통과한다) 존재 검사와 짝지어 둘 다
 * 성립할 때만 초록을 준다.
 *
 * 2026-08-26 board-33/34 규범 개정(문서화된 결정, tree-34-deep.raw "상태는
 * 둘뿐이다") — "입력창 0개(단일 입력 원칙)"가 "셸이 보이는 동안은 오브에 입력이
 * 없다"로 좁아졌다. 오브는 셸이 숨겨졌을 때만(athena:shell-visibility로 게이트)
 * #orbInput 하나를 받고, 그 질의는 셸의 커맨드바와 완전히 같은 runLiveQuery로
 * 이어진다(athena:orb-chat-submit — athena__render_canvas를 직접 부르지 않는다).
 * **살아있는 입력창은 여전히 최대 하나**이므로 원칙 자체(단일 입력)는 안 깨졌다 —
 * 그 하나가 항상 셸이라는 전제만 깨졌다. 그래서 아래 (a)는 화이트리스트로
 * 완화하고(#orbInput 외에는 여전히 금지), 주문 집행·감시 승인/취소가 여전히
 * 오브의 액션이 아니라는 (b)의 핵심(확정 결정 3)은 그대로 조인다.
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

  // (a) 입력창은 #orbInput 하나까지만 — board-33/34가 "셸 숨김일 때만" 조건으로
  // 허용한 대화 입력줄이다. 그 밖의 input·모든 textarea·contenteditable은 여전히
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
    for (const word of ["매수", "매도", "주문 실행", "즉시 실행", "지금 실행"]) {
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
  must(orbJs.includes("athena:routine-event"),
    "orb.js: 능동 턴 이벤트를 구독해야 한다 — 오브가 받는 유일한 발생원이다");

  // board-33/34 — 대화 입력은 셸 숨김 신호로 게이트돼야 한다(추측이 아니라 실신호).
  // 질의는 셸과 같은 runLiveQuery로 이어지는 전용 채널 하나로만 나가야 한다.
  must(orbJs.includes("athena:shell-visibility"),
    "orb.js: athena:shell-visibility를 구독해야 한다 — 대화 모드는 셸 숨김 실신호로만 켜진다(board-33/34)");
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
// 6. 마스코트 상태 계약 (2026-08-24 리프 1.3.2 — ui/kiwoome.zip 참조)
//    평소 무채색 → 알림 시 딥블루 바이저. 색은 장식이 아니라 신호다.
// ─────────────────────────────────────────────────────────────────────────
if (htmlRaw && cssRaw && orbJsRaw) {
  const html = stripHtmlComments(htmlRaw);
  const orbJs = stripComments(orbJsRaw);

  // (a) PNG 에셋 0건 — CSS/SVG로 다시 그린다(질의 확정 2026-08-24).
  //     원본 렌더는 ui/에 참조로만 남고 앱에는 바이너리가 들어가지 않는다.
  must(!/<img\b/i.test(html), "orb.html: <img>가 있다 — 마스코트는 CSS/SVG로 그린다(PNG 에셋 0건)");
  for (const [src, name] of [[html, "orb.html"], [cssRaw, "orb.css"]]) {
    must(!/\.png|\.jpe?g|\.webp/i.test(src), `${name}: 래스터 이미지 참조가 있다 — 앱에 바이너리를 넣지 않는다`);
    must(!/data:image\//i.test(src), `${name}: data URI 이미지가 있다 — 같은 이유로 금지`);
  }

  // (b) 마스코트 요소가 실제로 있다 — 부재 검사만으로는 빈 껍데기도 통과한다.
  must(/id="orbVisor"/.test(html), "orb.html: #orbVisor(딥블루 바이저)가 없다");
  // 눈은 **둘**이어야 얼굴이다. class 속성 안 어디에 있어도 잡히게 단어 경계로 센다
  // (`class="orb-eye orb-eye-l"`처럼 변형 클래스가 붙는다).
  const eyes = (html.match(/class="[^"]*\borb-eye\b/g) || []).length;
  must(eyes === 2, `orb.html: .orb-eye가 ${eyes}개 — 눈은 둘이어야 얼굴로 읽힌다`);
  must(/#orbVisor\s*\{/.test(cssRaw), "orb.css: #orbVisor 규칙이 없다");

  // (c) **유리는 끝까지 무채색이다.** 바이저는 유리 위의 틴트가 아니라 유리 뒤의
  //     굴절 대상이다(soul.md §7 두 조항을 동시에 만족시키는 유일한 배치).
  //     #orb의 배경은 백색 알파만이어야 한다 — 색이 섞이면 그건 틴트다.
  const orbRule = /#orb\s*\{[^}]*\}/.exec(cssRaw);
  if (orbRule) {
    const bg = /background-color:\s*([^;]+);/.exec(orbRule[0]);
    must(!!bg && /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/.test(bg[1]),
      "orb.css: #orb의 background-color가 백색 알파가 아니다 — 유리에 틴트를 칠하면 안 된다(soul.md §7)");
  }

  // (d) 신호색은 토큰 하나로만 — 리터럴이 흩어지면 두 벌이 된다(1.1.2에서 겪은 결함).
  must(/--color-kiwoome-visor/.test(cssRaw),
    "orb.css: 바이저 색을 --color-kiwoome-visor 토큰으로 써야 한다(리터럴 산재 금지)");

  // (e) **페이드로 등장하지 않는다**(soul.md §7 — 유리는 opacity가 아니라 굴절 변조로
  //     나타난다). 바이저 전이에 opacity만 걸리면 그 금지에 걸린다.
  const visorRule = /#orbVisor\s*\{[^}]*\}/.exec(cssRaw);
  if (visorRule) {
    const tr = /transition:\s*([^;]+);/.exec(visorRule[0]);
    must(!!tr, "orb.css: #orbVisor에 전이가 없다 — 상태 변화가 뚝 끊긴다");
    if (tr) {
      must(!/^\s*opacity\b/.test(tr[1]) || /transform|filter|scale/.test(tr[1]),
        "orb.css: #orbVisor 전이에 기하 변조가 없다 — opacity 페이드가 아니라 clip-path/transform으로 드러나야 한다(soul.md §7)");
    }
  }

  // (f) 신호는 화면당 한 곳 — 얼굴이 드러나면 마젠타 호는 꺼진다.
  //     상호 배타를 한 함수가 책임져야 두 곳에서 따로 켜지는 사고가 안 난다.
  must(/function renderPresence\s*\(/.test(orbJs),
    "orb.js: renderPresence()가 없다 — 호와 얼굴의 상호 배타를 한 곳에서 정해야 한다");
  // JS는 `dataset.alert`, CSS는 `[data-alert=…]`로 같은 속성을 만진다 — 둘 다 받는다.
  must(/dataset\.alert|data-alert/.test(orbJs) && /data-alert/.test(cssRaw),
    "orb.js/orb.css: data-alert 상태 속성이 없다 — 무채색↔발화 두 상태를 구분해야 한다");
  // 2026-08-26 board-32 규범 개정(사용자 결정) — "대기 34% / 발화 75%"로
  // 바이저 폭을 상태마다 벌리던 축을 걷어냈다. Paper board 32 section C가
  // 잠듦 하나만 빼고 모든 상태의 orb-100 참조 프레임을 같은 62×61 바이저로
  // 그려서 못박았다: 발화 신호는 이제 바이저 폭이 아니라 **눈이 동그래지는
  // 것**이 진다("화면당 신호는 여기 하나" — board-32). 옛 검사는
  // [data-alert="fired"] ... #orbVisor 결합을 찾았는데 새 CSS는 그 결합을 아예
  // 안 쓴다 — 같은 사실을 눈 쪽에서 다시 잰다(quietFaceIsPresent /
  // firedIsVisiblyWider 픽셀 비교는 verify.js에서도 같은 이유로 폐기했다).
  must(/\[data-alert="fired"\][^{]*\.orb-eye|\[data-face="fired"\][^{]*\.orb-eye/.test(cssRaw),
    "orb.css: 발화 신호가 .orb-eye 모양에 안 묶여 있다 — board-32부터 신호는 눈 모양 하나다(대기/잠듦과 갈리는 유일한 축)");

  // 표정은 **눈 모양 하나로만** 만든다 — 새 기관(눈썹·입·눈동자)을 붙이면
  // 그건 키우미가 아니다. data-face 축이 실제로 배선돼 있는지 둘 다에서 본다.
  must(/dataset\.face|data-face/.test(orbJs) && /data-face/.test(cssRaw),
    "orb.js/orb.css: data-face 표정 축이 없다 — 표정은 눈 모양으로만 만든다");
}

// ─────────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("오브 계약 검사 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("오브 76px 원형 · alwaysOnTop · 실행 버튼 0 · 입력창 최대 1(셸 숨김 전용) · 결정론 본문 통과");
console.log("orb contract verification passed");
