// 키우미 전수 검증 (2026-09-01) — Paper `키우미` 페이지 9장이 실앱에서 실제로
// 성립하는지 살아 있는 셸·오브 창에서 확인한다.
//
// verify.js의 검증3d(Paper 49 키우미 메뉴)가 확인하던 것을 포함하되, 그 앞
// 단계(플러그인 모드)의 사전 결함에 막히지 않도록 키우미만 따로 세운다.
// 오브 쪽 미니 카드 렌더는 probe-orb-mini-cards.js가, 얼굴 마크업·CSS 계약은
// lib/kiumi-face.test.js가 각각 맡는다 — 여기서는 **살아 있는 화면의 실측**만 본다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.verify-kiumi-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 렌더러가 아직 문서를 갈아끼우는 중(부팅 시퀀스)에는 executeJavaScript 자체가
// 거부된다 — 그건 검증 실패가 아니라 "아직"이다. 삼키고 다시 묻는다.
async function evalIn(win, js) {
  try {
    return await win.webContents.executeJavaScript(js);
  } catch {
    return null;
  }
}

/** 셸 렌더러가 모드 API와 키우미 DOM을 들고 설 때까지 기다린다. */
async function waitForShellReady(win, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evalIn(win, `(() => !!(
      window.AthenaCanvasMode
      && document.getElementById('dot')
      && document.getElementById('kiumiMenu')
    ))()`);
    if (ready === true) return true;
    await wait(300);
  }
  return false;
}

const report = { steps: [] };
let failures = 0;
function record(name, ok, data) {
  if (!ok) failures += 1;
  report.steps.push({ name, ok, data });
  console.log(`[verify-kiumi] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin 못 찾음');
  // 부팅 시퀀스를 생략하는 검증은 기존 우회 경로로 부팅 창까지 정리한다.
  // show()만 호출하면 남은 부팅 창이 뒤의 정상 revealShell() 복귀를 막는다.
  mainMod.revealShell({ focus: true, force: true });
  const bootWin = mainMod.getWins().bootWin;
  record('검증 준비: 부팅 창을 정리한 셸이 보인다',
    (!bootWin || bootWin.isDestroyed()) && shellWin.isVisible(),
    { bootPresent: !!bootWin && !bootWin.isDestroyed(), shellVisible: shellWin.isVisible() });
  const shellReady = await waitForShellReady(shellWin);
  if (!shellReady) throw new Error('셸 렌더러가 30초 안에 준비되지 않았다');
  await wait(400); // 확장 전이가 끝나 레이아웃이 굳을 여유

  // ── 보드 08 · 모드별 키우미 얼굴 ────────────────────────────────────────
  // data-mode의 유일한 소유자(applyVisibility)를 통해 다섯 모드를 실제로 돌면서
  // 그때 보이는 얼굴이 하나뿐이고 그 모드의 것인지 본다.
  const MODES = [
    { view: 'summary', mode: 'chat' },
    { view: 'graph', mode: 'graph' },
    { view: 'agent', mode: 'agent' },
    { view: 'plugin', mode: 'plugin' },
    { view: 'backtest', mode: 'backtest' },
  ];
  const faceRuns = [];
  for (const { view, mode } of MODES) {
    // setView는 비동기이고 백엔드가 없으면 거부될 수 있다 — 거부를 여기서
    // 삼킨다(모드 전환의 표면 반영은 동기 applyVisibility가 이미 끝낸다).
    // executeJavaScript는 반환된 Promise를 await하므로 그대로 두면 이 검증이
    // 백엔드 사정으로 죽는다(verify.js가 플러그인 단계에서 죽는 것과 같은 이유).
    await evalIn(shellWin, `(() => {
      try {
        const p = window.AthenaCanvasMode && window.AthenaCanvasMode.setView(${JSON.stringify(view)});
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* 표면 전환은 이미 끝났다 */ }
      return null;
    })()`);
    await wait(260);
    const seen = await evalIn(shellWin, `(() => {
      const dot = document.getElementById('dot');
      const faces = Array.from(dot.querySelectorAll('.kiumi-face'));
      const visible = faces.filter((f) => getComputedStyle(f).display !== 'none');
      const visor = dot.querySelector('.kiumi-visor');
      return {
        dataMode: dot.dataset.mode || null,
        visibleCount: visible.length,
        // SVG 요소의 className은 문자열이 아니라 SVGAnimatedString이다 — 속성으로 읽는다.
        visibleClass: visible.map((f) => (f.getAttribute('class') || '').replace('kiumi-face ', '')),
        visorColor: getComputedStyle(visor).color,
        dotSize: [Math.round(dot.getBoundingClientRect().width), Math.round(dot.getBoundingClientRect().height)],
        shapeCount: visible.length ? visible[0].querySelectorAll('rect, circle, path, line').length : 0,
      };
    })()`);
    faceRuns.push({ view, mode, seen });
  }
  await evalIn(shellWin, `(() => {
    try {
      const p = window.AthenaCanvasMode.setView('summary');
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
    return null;
  })()`);
  await wait(200);

  record('보드 08: 다섯 모드에서 data-mode가 모드 키와 같다',
    faceRuns.every((r) => r.seen.dataMode === r.mode),
    faceRuns.map((r) => ({ view: r.view, dataMode: r.seen.dataMode })));
  record('보드 08: 어느 모드에서도 보이는 얼굴은 정확히 하나다',
    faceRuns.every((r) => r.seen.visibleCount === 1),
    faceRuns.map((r) => ({ mode: r.mode, visibleCount: r.seen.visibleCount })));
  // 2026-09-01 사용자 결정 — 얼굴은 하나다. 모드마다 얼굴을 갈아끼우지 않으므로
  // 다섯 모드가 **같은** 키우미 얼굴을 보여야 한다(모드별 전용 얼굴이 남아 있으면 회귀다).
  record('보드 08: 다섯 모드가 같은 키우미 얼굴 하나를 쓴다 — 모드별 얼굴은 없다',
    faceRuns.every((r) => r.seen.visibleClass[0] === 'kiumi-face'),
    faceRuns.map((r) => ({ mode: r.mode, face: r.seen.visibleClass[0] })));
  record('보드 08: 얼굴은 도형으로 그려진다(빈 얼굴 없음)',
    faceRuns.every((r) => r.seen.shapeCount >= 2),
    faceRuns.map((r) => ({ mode: r.mode, shapes: r.seen.shapeCount })));
  record('보드 08: 22px 원 · 바이저색 #2F3BA8',
    faceRuns.every((r) => r.seen.dotSize[0] === 22 && r.seen.dotSize[1] === 22)
    && faceRuns.every((r) => r.seen.visorColor === 'rgb(47, 59, 168)'),
    { size: faceRuns[0].seen.dotSize, color: faceRuns[0].seen.visorColor });

  // ── 보드 06·07 · 키우미 메뉴 ───────────────────────────────────────────
  await evalIn(shellWin, "document.getElementById('dot').click()");
  await wait(150);
  const menu = await evalIn(shellWin, `(() => {
    const el = document.getElementById('kiumiMenu');
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const items = Array.from(el.querySelectorAll('.km-item'));
    return {
      visible: !el.hidden,
      width: rect.width,
      sections: Array.from(el.querySelectorAll('.km-section')).map((n) => n.textContent),
      titles: items.map((n) => n.querySelector('.km-title').textContent),
      descs: items.map((n) => (n.querySelector('.km-desc') || {}).textContent || ''),
      allIconsAreSvg: items.every((n) => n.querySelector('.km-ic > svg')),
      iconColors: [...new Set(items.map((n) => getComputedStyle(n.querySelector('.km-ic')).color))],
      minRowHeight: Math.min(...items.map((n) => n.getBoundingClientRect().height)),
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
      hasEmoji: /[\\u{1F300}-\\u{1FAFF}]/u.test(el.textContent),
    };
  })()`);
  await evalIn(shellWin, "document.getElementById('dot').click()");

  record('보드 07: 메뉴는 380px 굴절형이다', menu.visible === true && near(menu.width, 380, 2) && /blur\(3px\)/.test(menu.backdropFilter),
    { width: menu.width, backdropFilter: menu.backdropFilter });
  record('보드 06: 세 구역 — 추가 · 플러그인 · 설정',
    JSON.stringify(menu.sections) === JSON.stringify(['추가', '플러그인', '설정']), { sections: menu.sections });
  // 플러그인 구역은 고정 목록이 아니다. chat.js renderKiumiMenu()가 실제로
  // 등록·승인된 MCP 서버를 최대 6개까지 싣고, 하나도 없으면 "설치된 플러그인
  // 없음" 빈 상태 항목 하나를 대신 세운다. 이 머신에 무엇이 등록돼 있느냐로
  // 달라지므로 가운데를 통째로 못 박으면 검증이 아니라 환경 사진이 된다.
  // 고정된 계약은 앞 4개·뒤 2개, 그리고 가운데가 1~6개라는 것이다.
  const KIUMI_HEAD = ['파일 첨부', '폴더 첨부', '목표', '계획 모드'];
  const KIUMI_TAIL = ['모델 설정', '플러그인 관리'];
  const kiumiMiddle = menu.titles.slice(KIUMI_HEAD.length, menu.titles.length - KIUMI_TAIL.length);
  record('보드 06: 앞 4항목과 뒤 2항목이 Paper 목록과 같다',
    JSON.stringify(menu.titles.slice(0, KIUMI_HEAD.length)) === JSON.stringify(KIUMI_HEAD)
      && JSON.stringify(menu.titles.slice(-KIUMI_TAIL.length)) === JSON.stringify(KIUMI_TAIL),
    { titles: menu.titles });
  record('보드 06: 플러그인 구역은 등록된 서버 1~6개(없으면 빈 상태 1개)',
    kiumiMiddle.length >= 1 && kiumiMiddle.length <= 6, { middle: kiumiMiddle });
  record('보드 06: 아이콘은 전부 선형 SVG이고 바이저색 하나로 통일',
    menu.allIconsAreSvg === true && menu.iconColors.length === 1 && menu.iconColors[0] === 'rgb(47, 59, 168)',
    { colors: menu.iconColors });
  record('보드 06: 이모지 아이콘 0건 · 행 높이 36px 이상',
    menu.hasEmoji === false && menu.minRowHeight >= 36, { minRowHeight: menu.minRowHeight, hasEmoji: menu.hasEmoji });

  await evalIn(shellWin, "document.getElementById('dot').click()");
  await wait(120);
  const shot = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'kiumi-01-menu.png'), shot.toPNG());
  await evalIn(shellWin, "document.getElementById('dot').click()");

  // ── 보드 05 · 셸 숨김 게이트 / 보드 04 · 대화 모드 ─────────────────────
  const alertOnly = await evalIn(orbWin, `(() => {
    const root = document.getElementById('orbRoot');
    return {
      orbMode: root.dataset.orbMode || null,
      inputStackHidden: document.getElementById('orbInputStack').hidden,
      chatBodyHidden: document.getElementById('orbChatBody').hidden,
      headerTitle: document.getElementById('orbHeaderTitle').textContent,
    };
  })()`);
  record('보드 05 DISPLAY B: 알림을 먼저 보여주되 키우미 대화 입력은 열려 있다',
    alertOnly.orbMode === 'alert' && alertOnly.inputStackHidden === false
    && alertOnly.chatBodyHidden === true && alertOnly.headerTitle === '알림', alertOnly);

  await evalIn(shellWin, 
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  await wait(600);
  const chatMode = await evalIn(orbWin, `(() => {
    const root = document.getElementById('orbRoot');
    return {
      orbMode: root.dataset.orbMode || null,
      inputStackHidden: document.getElementById('orbInputStack').hidden,
      chatBodyHidden: document.getElementById('orbChatBody').hidden,
      headerTitle: document.getElementById('orbHeaderTitle').textContent,
    };
  })()`);
  record('보드 05 DISPLAY A: 셸을 숨기면 같은 패널이 미니 채팅이 된다',
    chatMode.orbMode === 'chat' && chatMode.inputStackHidden === false
    && chatMode.chatBodyHidden === false && chatMode.headerTitle === '키우미 대화', chatMode);

  // ── 보드 01 · 접힘 원의 두 채널 ────────────────────────────────────────
  await evalIn(orbWin, "document.getElementById('orbToggle').click()");
  await wait(400);
  const geometry = await evalIn(orbWin, `(() => {
    const orb = document.getElementById('orb');
    const rect = orb.getBoundingClientRect();
    const ring = document.getElementById('orbRing');
    const count = document.getElementById('orbCount');
    const root = document.getElementById('orbRoot');
    return {
      orbSize: [Math.round(rect.width), Math.round(rect.height)],
      ringDisplayWhenNoWatch: getComputedStyle(ring).display,
      watching: root.dataset.watching,
      countText: count.textContent,
      countDisplay: getComputedStyle(count).display,
      alert: root.dataset.alert,
      face: root.dataset.face || null,
    };
  })()`);
  record('보드 01: 접힘 원은 76×76이다', geometry.orbSize[0] === 76 && geometry.orbSize[1] === 76, { size: geometry.orbSize });
  record('보드 01: 감시 0건이면 궤도 링을 그리지 않는다',
    geometry.watching === 'false' && geometry.ringDisplayWhenNoWatch === 'none', geometry);
  record('보드 01: 미확인 0건이면 배지를 그리지 않는다(0을 안 그린다)',
    geometry.countText === '' && geometry.countDisplay === 'none', geometry);
  record('보드 02/03: 얼굴은 공식 상태값 하나를 들고 있다',
    typeof geometry.face === 'string' && geometry.face.length > 0, { face: geometry.face });

  // 궤도 링·배지는 값이 있을 때만 나타난다 — 실제로 값을 넣어 확인한다.
  const withSignals = await evalIn(orbWin, `(() => {
    const root = document.getElementById('orbRoot');
    const ring = document.getElementById('orbRing');
    const count = document.getElementById('orbCount');
    root.dataset.watching = 'true';
    root.dataset.alert = 'fired';
    count.textContent = '3';
    const ringStyle = getComputedStyle(ring);
    const out = {
      ringDisplay: ringStyle.display,
      ringBorderStyle: ringStyle.borderTopStyle,
      countDisplay: getComputedStyle(count).display,
      countFont: getComputedStyle(count).fontFamily,
    };
    root.dataset.watching = 'false';
    root.dataset.alert = 'none';
    count.textContent = '';
    return out;
  })()`);
  record('보드 01: 감시가 있으면 점선 궤도가 나타난다',
    withSignals.ringDisplay === 'block' && withSignals.ringBorderStyle === 'dashed', withSignals);
  record('보드 01: 미확인이 있으면 배지가 나타난다(모노 숫자)',
    withSignals.countDisplay === 'flex' && /Geist Mono/.test(withSignals.countFont), withSignals);

  const orbShot = await orbWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'kiumi-02-orb-chat.png'), orbShot.toPNG());

  // ── 보드 05 · 표시 모드는 창 가시성과 다른 값이다 ──────────────────────
  // 앞의 DISPLAY B 단언은 렌더러 DOM만 재서, 창이 통째로 숨어 있어도 통과한다
  // (5FX-0 「셸이 보이는 동안 오브는 알림 모드다」가 화면에 못 닿는 구멍).
  // 여기서 셸을 되돌린 뒤 native 창 가시성까지 함께 잰다. 알림 상태를 건드리므로
  // 보드 01 배지 검사(미확인 0건) 뒤에 둔다.
  mainMod.revealShell();
  await wait(600);
  const backToShell = await evalIn(orbWin, `(() => ({
    orbMode: document.getElementById('orbRoot').dataset.orbMode || null,
    inputStackHidden: document.getElementById('orbInputStack').hidden,
  }))()`);
  record('보드 05 DISPLAY B: 셸이 다시 보이면 창은 숨고 알림 모드 입력은 유지된다',
    orbWin.isVisible() === false && backToShell.orbMode === 'alert'
    && backToShell.inputStackHidden === false, { orbVisible: orbWin.isVisible(), ...backToShell });

  mainMod.handleRoutineFeedEvent({
    type: 'routine-fired', routine_id: 'vkiumi-alert', symbol: '005930',
    source: 'watch.price', mode: 'realtime-ws', observed: '71,900원',
    threshold: '70,000원 이상', note: '키우미 알림 모드 검증', fired_at: new Date().toISOString(),
  });
  await wait(500);
  const alertPanel = await evalIn(orbWin, `(() => ({
    orbMode: document.getElementById('orbRoot').dataset.orbMode || null,
    inputStackHidden: document.getElementById('orbInputStack').hidden,
  }))()`);
  record('보드 05 DISPLAY B: 발화가 오면 알림과 키우미 대화 입력이 함께 뜬다',
    orbWin.isVisible() === true && alertPanel.orbMode === 'alert'
    && alertPanel.inputStackHidden === false, { orbVisible: orbWin.isVisible(), ...alertPanel });

  // 5EX-0 「최소화·가려짐은 표시 모드를 바꾸지 않는다」 — 최소화해도 B에 머문다.
  shellWin.minimize();
  await wait(600);
  const minimized = await evalIn(orbWin, `(() => ({
    orbMode: document.getElementById('orbRoot').dataset.orbMode || null,
    inputStackHidden: document.getElementById('orbInputStack').hidden,
  }))()`);
  record('보드 05: 셸 최소화는 표시 모드를 바꾸지 않는다 — 알림과 입력이 유지된다',
    minimized.orbMode === 'alert' && minimized.inputStackHidden === false, minimized);
  shellWin.restore();
  await wait(300);

  report.ok = failures === 0;
  fs.writeFileSync(path.join(OUT_DIR, 'VERIFY-KIUMI.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[verify-kiumi] ${failures === 0 ? `ALL OK (${report.steps.length})` : `${failures} FAILED`}`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[verify-kiumi] 예외:', err);
  app.exit(1);
});
