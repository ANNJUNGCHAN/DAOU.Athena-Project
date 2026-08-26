// Phase 4 — 앱 전 화면 순회 캡처. 일회용이 아니라 남겨두는 스크립트(팀리드
// 지시) — probe-chart-card.js/verify.js와 같은 패턴(main.js를 라이브러리로
// 불러와 createWindows()를 직접 호출, executeJavaScript로 실제 사람 클릭
// 경로를 그대로 태운다. API 직접 호출로 화면을 열지 않는다).
//
// 전제: 백엔드가 이미 127.0.0.1:8010에 떠 있다(팀리드가 기동) — 그래서
// ATHENA_NO_AUTOSTART=1로 이 스크립트가 재기동하지 않는다.
//
// 실패 화면은 실패로 남긴다 — try/catch로 삼키고 다음으로 넘어가되, 그 사실을
// report.json과 콘솔에 그대로 적는다(우회 금지, 팀리드 지시).
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'captures', 'phase4');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(__dirname, '.phase4-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8',
);
app.setPath('userData', PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

const results = []; // { name, ok, file, note }

async function shot(win, name, note) {
  const file = path.join(OUT_DIR, name);
  try {
    // capturePage()가 아직 커밋 안 된 프레임을 돌려주는 문제(verify.js 주석 참고)
    // — rAF 2회를 기다려 최신 프레임을 강제한다.
    await win.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.toPNG());
    const exists = fs.existsSync(file) && fs.statSync(file).size > 0;
    results.push({ name, ok: exists, file, note: note || null });
    console.log(`[phase4] ${exists ? 'OK' : 'FAIL(empty)'} — ${name}`);
    return exists;
  } catch (err) {
    results.push({ name, ok: false, file: null, note: `예외: ${String((err && err.message) || err)}` });
    console.error(`[phase4] FAIL — ${name}: ${String((err && err.message) || err)}`);
    return false;
  }
}

async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    results.push({ name: label, ok: false, file: null, note: `단계 예외: ${String((err && err.message) || err)}` });
    console.error(`[phase4] 단계 실패 — ${label}: ${String((err && err.message) || err)}`);
  }
}

async function waitForShellBooted(shellWin, timeoutMs = 8000) {
  const probe = `(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    return { boot: vis('boot'), app: vis('app') };
  })()`;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const p = await shellWin.webContents.executeJavaScript(probe);
    if (!p.boot && p.app) return true;
    await wait(100);
  }
  return false;
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');

  shellWin.show();
  const booted = await waitForShellBooted(shellWin);
  if (!booted) console.error('[phase4] 부팅 완료를 못 봤다 — 이후 캡처가 부팅 화면일 수 있다');
  await wait(400);

  // ---------- (1) 셸 기본 — 이력 사이드바 + 캔버스 + 채팅 ----------
  await step('01-셸 기본(3영역)', async () => {
    const sidebarProbe = await shellWin.webContents.executeJavaScript(`(() => ({
      historyRegionPresent: !!document.getElementById('historyRegion'),
      sidebarListChildren: document.getElementById('sidebarList') ? document.getElementById('sidebarList').children.length : 0,
      accountRowVisible: !!document.getElementById('sidebarAccountRow') && !document.getElementById('sidebarAccountRow').hidden,
    }))()`);
    fs.writeFileSync(path.join(OUT_DIR, '01-sidebar-probe.json'), JSON.stringify(sidebarProbe, null, 2));
    await shot(shellWin, '01-shell-base.png', JSON.stringify(sidebarProbe));
  });

  // ---------- (2) 계정 메뉴 펼침 ----------
  await step('02-계정 메뉴 펼침', async () => {
    const clicked = await shellWin.webContents.executeJavaScript(`(() => {
      const row = document.getElementById('sidebarAccountRow');
      if (!row || row.hidden) return 'no-account';
      row.click();
      return 'clicked';
    })()`);
    await wait(500);
    await shot(shellWin, '02-account-menu.png', clicked);
    if (clicked === 'no-account') {
      results.push({ name: '02-account-menu(no-account)', ok: false, file: null, note: '등록된 활성 계좌가 없어 발치 행이 숨어 있다 — .phase4-profile은 계좌 미등록 상태' });
    }
  });

  // ---------- (3) 설정 오버레이 — 5개 탭 ----------
  const NAV_LABELS = [
    ['화면', '03a-settings-screen.png'],
    ['계좌', '03b-settings-accounts.png'],
    ['MCP 서버', '03c-settings-mcp.png'],
    ['모델', '03d-settings-model.png'],
    ['그래프', '03e-settings-graph.png'],
  ];
  await step('03-설정 열기', async () => {
    await shellWin.webContents.executeJavaScript("document.getElementById('dot').click()");
    await wait(700);
  });
  for (const [label, file] of NAV_LABELS) {
    await step(`03-설정 탭 ${label}`, async () => {
      const clicked = await shellWin.webContents.executeJavaScript(`(() => {
        const nav = document.getElementById('settingsNav');
        const items = nav ? Array.from(nav.querySelectorAll('.settings-nav-item')) : [];
        const btn = items.find((b) => { const l = b.querySelector('.settings-nav-label'); return l && l.textContent.trim() === ${JSON.stringify(label)}; });
        if (!btn) return 'NOT FOUND';
        btn.click();
        return 'clicked';
      })()`);
      await wait(label === 'MCP 서버' ? 1200 : 600); // mcp-list는 콜드 스폰이라 더 기다린다(probe-chart-card.js/verify.js 관례)
      await shot(shellWin, file, clicked);
      if (clicked !== 'clicked') {
        results.push({ name: `03-nav-${label}`, ok: false, file: null, note: `nav 항목을 못 찾음: ${clicked}` });
      }
    });
  }
  await step('03-설정 닫기(Esc)', async () => {
    await shellWin.webContents.executeJavaScript(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
    );
    await wait(500);
  });

  // ---------- (4) 그래프 모드 — 요약 뷰 · 그래프 뷰 ----------
  await step('04-그래프 모드', async () => {
    await shot(shellWin, '04a-canvas-summary.png', '토글 전 — 요약(모자이크) 뷰');
    const graphProbe = await shellWin.webContents.executeJavaScript(`(async () => {
      const pill = document.getElementById('graphPill');
      const container = document.getElementById('graphCanvas');
      const status = await window.athena.invoke('athena:brain-status').catch(() => null);
      const brainReady = Boolean(status && status.ok && status.ready);
      if (!pill) return { wired: false, reason: 'no-pill', brainReady };
      if (pill.hidden) return { wired: false, reason: 'hidden', brainReady };
      pill.click();
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (!container.hidden) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return { wired: true, opened: !container.hidden, brainReady };
    })()`);
    fs.writeFileSync(path.join(OUT_DIR, '04-graph-probe.json'), JSON.stringify(graphProbe, null, 2));
    if (graphProbe.wired && graphProbe.opened) {
      await wait(300);
      await shot(shellWin, '04b-canvas-graph.png', '그래프 뷰');
    } else {
      // 브레인 미준비/필 숨김 — 우회하지 않는다, 미준비 상태를 그대로 캡처한다.
      await shot(shellWin, '04b-canvas-graph-unavailable.png', JSON.stringify(graphProbe));
      results.push({ name: '04b-graph-view', ok: false, file: path.join(OUT_DIR, '04b-canvas-graph-unavailable.png'), note: `그래프 뷰 미도달 — ${JSON.stringify(graphProbe)}` });
    }
  });

  // ---------- (5) 캔버스 카드 — 차트 카드 ----------
  await step('05-차트 카드', async () => {
    await shellWin.webContents.executeJavaScript(`window.AthenaGraphMode && window.AthenaGraphMode.toggle && document.getElementById('graphCanvas') && !document.getElementById('graphCanvas').hidden ? window.AthenaGraphMode.toggle() : null`);
    await wait(200);
    await shellWin.webContents.executeJavaScript("window.addCard('chart')");
    await wait(1500);
    const cardProbe = await shellWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.card.chart');
      return { cardPresent: !!card, canvasCount: card ? card.querySelectorAll('canvas').length : 0 };
    })()`);
    fs.writeFileSync(path.join(OUT_DIR, '05-chart-card-probe.json'), JSON.stringify(cardProbe, null, 2));
    await shot(shellWin, '05-chart-card.png', JSON.stringify(cardProbe));
    if (!cardProbe.cardPresent) {
      results.push({ name: '05-chart-card', ok: false, file: null, note: `차트 카드 미생성 — ${JSON.stringify(cardProbe)}` });
    }
  });

  // ---------- (6) 오브 창 — 접힘 · 펼침 ----------
  await step('06-오브 창', async () => {
    if (!orbWin) {
      results.push({ name: '06-orb', ok: false, file: null, note: 'orbWin이 없다 — getWins() 반환값 확인 필요' });
      return;
    }
    await wait(300);
    await shot(orbWin, '06a-orb-collapsed.png');
    await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
    await wait(500);
    await shot(orbWin, '06b-orb-expanded.png');
    await orbWin.webContents.executeJavaScript("document.getElementById('orbClose') && document.getElementById('orbClose').click()");
    await wait(400);
    await shot(orbWin, '06c-orb-collapsed-after.png');
  });

  // ---------- 요약 보고 ----------
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const summary = { finishedAt: new Date().toISOString(), total: results.length, ok: okCount, fail: failCount, results };
  fs.writeFileSync(path.join(OUT_DIR, 'phase4-report.json'), JSON.stringify(summary, null, 2));
  console.log(`[phase4] 완료 — ok:${okCount} fail:${failCount} (report: ${path.join(OUT_DIR, 'phase4-report.json')})`);

  app.quit();
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[phase4] 치명적 실패:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'phase4-fatal-error.log'), String((err && err.stack) || err));
  app.exit(1);
}));
