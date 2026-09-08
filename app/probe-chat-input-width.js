'use strict';

/**
 * F-11 실측 프로브 — "잠금 중 채팅 입력창이 찌부된다"(2026-09-03 실사용 제보:
 * "채팅창 싹다 짤리는게 너무 화나").
 *
 * 무엇을 재는가: `.input-row`는 [키우미 점][입력창][잠금 힌트]가 한 줄을 나눠 쓴다.
 * 입력창은 `flex:1; min-width:0`이라 **남는 것만** 받고, 잠금 힌트는 안 줄어드는
 * 자식(경과 시간·ESC 칩)을 갖는다. 채팅 기둥이 400px 고정(pre-push 창 모델 계약)이라
 * 잠금이 걸리면 입력창 몫이 거의 사라진다 — 심어 둔 문장이 10글자쯤에서 줄바꿈됐다.
 *
 * 잠금은 setLocked()가 만드는데 그 함수는 모듈 밖으로 안 나온다. 이 프로브는 그것이
 * 하는 일을 DOM으로 그대로 재현한다(입력창 disabled + placeholder 제거 + 힌트 노출)
 * — 모델을 부르지 않고도 같은 화면이 된다.
 *
 * 함께 확인하는 것: `.lock-hint`에 `[hidden]` 규칙이 없어서(chat.css §704 주석이
 * 경고한 바로 그 함정) 유휴 상태에서도 힌트가 보이는지.
 *
 * 실행: cd app && npx electron probe-chat-input-width.js
 */

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP_DIR = __dirname;
const REPO_DIR = path.resolve(APP_DIR, '..');
const PROBE_ROOT = path.join(os.tmpdir(), 'athena-input-width-probe');
const OUT_DIR = path.join(REPO_DIR, 'artifacts', 'graph-mode');

app.disableHardwareAcceleration();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

// 잠금 중에 입력창에 실제로 들어 있던 문장 — 패널 CTA가 심는 것과 같은 길이다
// (canvas.js seedGraphChat). 짧은 문자열로 재면 찌부를 못 본다.
const SEEDED = '확인이 필요한 것 3건이 뭐야? 각각 어느 쪽이 실제에 가까운지 하나씩 물어봐줘.';

const MEASURE = `(() => {
  const input = document.getElementById('input');
  const hint = document.getElementById('lockHint');
  const row = document.querySelector('.input-row');
  const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    row: r(row),
    input: r(input),
    hint: r(hint),
    hintDisplay: getComputedStyle(hint).display,
    hintHiddenAttr: hint.hidden,
    rowWrap: getComputedStyle(row).flexWrap,
    // 입력창이 몇 줄로 접히는가 — scrollHeight/line-height. 1이면 안 접힌 것이다.
    inputLines: Math.round(input.scrollHeight / parseFloat(getComputedStyle(input).lineHeight)),
  };
})()`;

async function main() {
  fs.mkdirSync(PROBE_ROOT, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROBE_ROOT, 'athena-onboarding.json'),
    JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
    'utf8',
  );
writeProbeModelPrefs(PROBE_ROOT);

  Object.assign(process.env, {
    ATHENA_NO_AUTOSTART: '1',
    ATHENA_CANVAS_SOURCE: 'fixture',
    ATHENA_ROUTINES_ENABLED: 'false',
  });

  app.setPath('userData', PROBE_ROOT);
  await app.whenReady();
  const mainMod = require(path.join(APP_DIR, 'main.js'));
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin || shellWin.isDestroyed()) throw new Error('셸 창이 만들어지지 않았다');
  const wc = shellWin.webContents;

  await wc.executeJavaScript(`(() => {
    for (const id of ['boot', 'onboard', 'settings', 'order']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const app = document.getElementById('app');
    if (app) app.hidden = false;
    const shell = document.getElementById('shell');
    if (shell) shell.hidden = false;
    return true;
  })()`);
  await wait(1200);

  const idle = await wc.executeJavaScript(MEASURE);
  log('');
  log('=== 유휴(잠금 없음) ===');
  log(`  ${JSON.stringify(idle)}`);
  const hintLeaks = idle.hintHiddenAttr === true && idle.hintDisplay !== 'none';
  log(`  ${hintLeaks ? 'FAIL' : 'PASS'}  hidden인 잠금 힌트가 화면에서도 사라진다`
    + `${hintLeaks ? ` (display:${idle.hintDisplay} — chat.css §704가 경고한 함정)` : ''}`);

  // setLocked(true, …)가 하는 일을 그대로 재현한다(chat.js §860).
  await wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    const hint = document.getElementById('lockHint');
    input.value = ${JSON.stringify(SEEDED)};
    input.disabled = true;
    input.placeholder = '';
    hint.hidden = false;
    document.getElementById('lockText').textContent = '답변 중…';
    document.getElementById('lockTime').textContent = '3.0s';
    // chat.js가 scrollHeight로 높이를 정한다 — 같은 계산을 여기서도 해 준다.
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    return true;
  })()`);
  await wait(500);

  const locked = await wc.executeJavaScript(MEASURE);
  log('');
  log('=== 잠금 중(문장이 들어 있음) ===');
  log(`  ${JSON.stringify(locked)}`);

  // 판정 기준: 입력창이 최소한 한글 한 줄을 담을 만큼은 남아야 한다. 200px은
  // text-lg에서 대략 12~13글자다 — 그 아래로 내려가면 문장이 토막나 읽히지 않는다.
  const MIN_USABLE = 200;
  const wide = locked.input.w >= MIN_USABLE;
  log(`  ${wide ? 'PASS' : 'FAIL'}  잠금 중에도 입력창이 ${MIN_USABLE}px 이상이다 — 실제 ${locked.input.w}px`);
  log(`         (행 ${locked.row.w}px · 힌트 ${locked.hint.w}px · 입력창이 접힌 줄 수 ${locked.inputLines})`);

  // 캡처 직전에 잠금 상태를 다시 건다 — 셸이 그사이 입력창을 되돌려 놓아서(주기적
  // 렌더) 첫 판에는 유휴 화면이 찍혔다. 숫자는 맞는데 사진이 다른 상태면 증거가 못 된다.
  await wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    const hint = document.getElementById('lockHint');
    input.value = ${JSON.stringify(SEEDED)};
    input.disabled = true;
    input.placeholder = '';
    hint.hidden = false;
    document.getElementById('lockText').textContent = '답변 중…';
    document.getElementById('lockTime').textContent = '3.0s';
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    return true;
  })()`);
  await wait(250);
  const shotState = await wc.executeJavaScript(MEASURE);
  log(`  캡처 시점 상태: 입력창 ${shotState.input.w}px · 힌트 ${shotState.hint.w}px · 접힌 줄 ${shotState.inputLines}`);
  const png = await wc.capturePage();
  const shot = path.join(OUT_DIR, 'probe-chat-input-width.png');
  fs.writeFileSync(shot, png.toPNG());
  log(`  화면: ${shot}`);

  fs.writeFileSync(
    path.join(OUT_DIR, 'probe-chat-input-width.json'),
    JSON.stringify({ idle, locked, minUsable: MIN_USABLE }, null, 2),
    'utf8',
  );

  app.quit();
  process.exit(wide && !hintLeaks ? 0 : 1);
}

main().catch((err) => {
  log(`프로브 실패: ${err && err.stack ? err.stack : err}`);
  try { app.quit(); } catch { /* 이미 죽었다 */ }
  process.exit(1);
});
