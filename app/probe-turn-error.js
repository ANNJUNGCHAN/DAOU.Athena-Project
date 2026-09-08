// 실패 턴 버블 결선 확인 프로브(단계 7) — ATHENA_CLAUDE_BIN에 존재하지 않는
// 절대경로를 줘서 claude 프로세스 spawn 자체를 ENOENT로 실패시키고
// (claude-runner.js:83 claudeBin → child.on('error') 152~174행), 그 실패가
// main.js:1520~1528(runLiveQuery 반환값 조립)을 거쳐 chat.js의 실패 턴 버블
// (.turn-fail-card, renderFailureBubble)로 정확히 그려지는지 실제 사람 입력
// 경로(Enter 키다운)로 확인한다.
// spawn 자체가 ENOENT로 실패하므로 claude CLI도 127.0.0.1:8010 백엔드도 뜰
// 필요가 없다 — probe-text-stream.js/probe-orb-chat.js와 달리 이 프로브는
// 완전히 독립적으로 돈다.

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CLAUDE_BIN = require('path').join(__dirname, '.probe-turn-error-missing-claude-binary.exe');

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-turn-error-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 차트/현재가 문법에 안 걸리는 일반 질문(probe-text-stream.js와 동일 문구) —
// Kiwoom REST 직결 fast-path를 안 타야 claude 프로세스를 실제로 spawn해서
// ENOENT를 재현한다.
const QUERY = process.argv[2] || '오늘 코스피 시장 분위기를 한 문장으로 설명해줘';

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();

  for (let i = 0; i < 100; i += 1) {
    const appHidden = await shellWin.webContents.executeJavaScript(
      "document.getElementById('app') && document.getElementById('app').hidden",
    );
    if (appHidden === false) break;
    await wait(100);
  }

  await shellWin.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById('input');
      input.value = ${JSON.stringify(QUERY)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()
  `);

  // 실패 턴 버블이 뜰 때까지 폴링 — 최대 8초(스폰 실패는 보통 즉시지만 여유를 둔다).
  let card = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    card = await shellWin.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('.turn-fail-card');
        if (!el) return null;
        const line = el.closest('.turn');
        const label = el.querySelector('.turn-fail-label');
        const body = el.querySelector('.turn-fail-body');
        return {
          headLabel: label && label.textContent,
          bodyText: body && body.textContent,
          hasDot: !!el.querySelector('.turn-fail-dot'),
          hasTurnAInSameLine: !!(line && line.querySelector('.turn-a')),
        };
      })()
    `);
    if (card) break;
    await wait(200);
  }

  console.log('[probe]', JSON.stringify(card, null, 1));
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-turn-error.json'),
    JSON.stringify(card, null, 1),
  );

  const ok = !!card
    && card.headLabel === '질의 실패'
    && card.hasDot === true
    && card.hasTurnAInSameLine === false
    && typeof card.bodyText === 'string'
    && card.bodyText.length > 0
    && !card.bodyText.startsWith('실패 — ');
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
