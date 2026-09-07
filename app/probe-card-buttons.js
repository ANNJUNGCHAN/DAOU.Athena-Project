'use strict';

// 카드 표면 버튼 감사 프로브 — 「카드의 버튼을 하나하나 눌러 봤을 때 무엇이
// 반응하는가」를 실앱 셸에서 실제 마우스 입력으로 잰다.
//
// 세 갈래로 판정한다.
//   responds     — 진짜 마우스 입력(sendInputEvent)으로 눌렀을 때 보드가 갈리거나
//                  카드 DOM이 바뀐다.
//   hit_blocked  — 핸들러는 붙어 있는데(el.click()은 먹는다) 그 자리의 hit test가
//                  다른 요소로 간다 = 위에 뭔가 덮여 있다.
//   inert        — 두 경로 다 아무 일도 없다 = 동작이 아예 없다.
//
// 후보는 두 종류.
//   state-control — Paper 계약이 상태 보드로 가는 문이라고 말한 잎(`data-state-control`).
//   pill          — 버튼처럼 생긴 잎(둥근 모서리 + 배경/테두리 + 좌우 패딩).
//
// 보드는 하나씩 세우고, 클릭이 보드를 갈아탔으면 다음 후보 전에 다시 세운다.
// 산출물: app/captures/paper-gates/CARD-BUTTONS.json
//
// 샤딩: ATHENA_VERIFY_BOARD_IDS=137X-2,2R3M-1

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { publicPolicies } = require('./lib/main/integrated-card-realtime');
const {
  activateBoardTab,
  loadRealBoardContract,
  sendBoardEnvelope,
  settleBoardLayout,
} = require('./lib/board-probe');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'backend', 'ref', 'card-surface-templates');
const CARD_INDEX = path.join(TEMPLATE_ROOT, 'index.json');
const REPORT_PATH = path.join(APP, 'captures', 'paper-gates', 'CARD-BUTTONS.json');

// 프로필은 실행마다 새 이름으로 만든다 — 고정 이름을 rmSync하면 앞선 실행이 남긴
// 자식 프로세스 잠금에 EPERM으로 죽는다. `-profile` 접미는 app/.gitignore 규약이다.
const PROFILE = path.join(APP, `.probe-card-buttons-${process.pid}-profile`);
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();

const CARD_BOARDS = JSON.parse(fs.readFileSync(CARD_INDEX, 'utf8')).boards;

function registerShellIpc() {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1]?.split(']);')[0];
  if (!block) throw new Error('preload.js에서 INVOKE_CHANNELS 블록을 못 찾았다');
  for (const channel of [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    ipcMain.handle(channel, async () => {
      if (channel === 'athena:integrated-card-realtime-policy') return publicPolicies();
      if (channel.startsWith('athena:integrated-card-realtime-')) {
        return { ok: true, status: 'active', bindings: [], generation: 1, connectionGeneration: 1 };
      }
      if (channel === 'athena:boot-readiness:get') {
        return {
          runId: 'card-buttons', revision: 1, phase: 'ready',
          tasks: [{
            id: 'probe-readiness', label: '버튼 감사 준비', kind: 'gate',
            state: 'succeeded', attempt: 1, retryable: false, detail: '완료',
          }],
        };
      }
      if (channel === 'athena:onboarding-state') return { needed: false, step: 3 };
      if (channel.endsWith('-list') || channel.endsWith('conversations-list')) return [];
      if (channel.includes('prefs:get')) return {};
      return null;
    });
  }
}

async function bootShell() {
  const win = new BrowserWindow({
    width: 1800,
    height: 1200,
    show: true,
    backgroundColor: '#EEF1F6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(APP, 'preload.js'),
      backgroundThrottling: true,
    },
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  await win.loadFile(path.join(APP, 'shell.html'));
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const boot = document.getElementById('boot');
      const shell = document.getElementById('shell');
      if (boot.dataset.phase === 'complete' && boot.hidden && !shell.hidden
        && !shell.classList.contains('is-onboarding-hidden')) return resolve(true);
      if (Date.now() - started > 20000) return reject(new Error('셸 부팅이 complete에 못 닿았다'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  return win;
}

const CARD_SELECTOR = (instanceId) => `#grid .card[data-integrated-instance-key="view:${instanceId}"]`;

// 후보를 세면서 표시(`data-probe-candidate`)를 남긴다 — 클릭이 보드를 갈아치워도
// 같은 후보를 인덱스로 되짚을 수 있어야 한다. 세는 규칙과 표시하는 규칙이 갈리면
// 인덱스가 어긋나므로 한 함수에서 둘을 함께 한다.
//
// 후보는 셋 중 하나에 걸리는 잎이다.
//   state-control — Paper 계약이 상태 보드로 가는 문이라고 말한 잎.
//   affordance    — 조작 묶음(액션·툴바·탭·칩·정렬·필터) 안에 든 잎. 활성이 아닌
//                   주기 버튼(일·주·월)은 배경도 테두리도 없어 모양으로는 못 잡는다.
//   pill          — 버튼처럼 생긴 잎(둥근 모서리 + 배경/테두리 + 좌우 패딩).
// 「Quote and Valuation Strip」처럼 값을 읽어 주는 묶음은 뺀다 — 조작이 아니라
// 읽을 것이고, 그 잎까지 세면 보드 하나가 40개 넘는 후보로 부풀어 판정이 묻힌다.
const CANDIDATE_GROUP = String.raw`Action|Button|버튼|Tab|탭|Chip|칩|Toolbar|툴바|Control|Nav|Mode|모드|Filter|필터|Sort|정렬|Range|주기|Period|Preset`;

function collectCandidates(instanceId) {
  return `(() => {
    const root = document.querySelector('${CARD_SELECTOR(instanceId)}');
    const surface = root && root.querySelector('.board-surface');
    if (!surface) return { error: 'board surface not mounted' };
    const GROUP = /${CANDIDATE_GROUP}/i;
    const seen = new Set();
    const out = [];
    const push = (el, why, text) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      el.dataset.probeCandidate = String(out.length);
      out.push({
        why,
        text: String(text || el.textContent || '').trim().slice(0, 24),
        node: el.dataset ? (el.dataset.node || '') : '',
        group: (() => {
          for (let p = el.parentElement; p && p !== surface; p = p.parentElement) {
            const name = p.dataset && p.dataset.name;
            if (name && GROUP.test(name)) return name;
          }
          return '';
        })(),
        state_board: el.dataset ? (el.dataset.stateBoard || '') : '',
        wired: Boolean(el.__athenaStateWired),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      });
    };
    for (const node of surface.querySelectorAll('[data-state-control]')) {
      const owner = node.closest('button, [role="button"], [role="tab"]') || node;
      push(owner, 'state-control', node.dataset.stateControl);
    }
    const inGroup = (el) => {
      for (let p = el.parentElement; p && p !== surface; p = p.parentElement) {
        const name = p.dataset && p.dataset.name;
        if (name && GROUP.test(name)) return true;
      }
      return false;
    };
    for (const el of surface.querySelectorAll('*')) {
      if (el.childElementCount > 1) continue;
      if (el.closest('.bs-paired')) continue;
      const text = String(el.textContent || '').trim();
      if (!text || text.length > 18) continue;
      const cs = getComputedStyle(el);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = cs.backgroundColor;
      const hasBg = Boolean(bg) && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const bordered = (parseFloat(cs.borderTopWidth) || 0) > 0;
      const padded = (parseFloat(cs.paddingLeft) || 0) >= 6;
      if (radius >= 6 && (hasBg || bordered) && padded) push(el, 'pill', text);
      else if (el.childElementCount === 0
        && (inGroup(el) || el.closest('.bs-strip, nav, [role="tablist"]'))) {
        push(el, 'affordance', text);
      }
    }
    return { mounted_board: String(root.querySelector('.board-surface-host').__bsBoardId || ''), candidates: out };
  })()`;
}

// 클릭 전후 지문 — 보드 신원과 카드 DOM 텍스트/구조.
function fingerprintProbe(instanceId) {
  return `(() => {
    const root = document.querySelector('${CARD_SELECTOR(instanceId)}');
    if (!root) return { error: 'card gone' };
    const host = root.querySelector('.board-surface-host');
    return {
      board: (host && host.__bsBoardId) || '',
      html_length: root.innerHTML.length,
      text: root.textContent.replace(/\\s+/g, ' ').trim().slice(0, 4000),
      loading: Boolean(root.querySelector('.board-surface-load-state')),
    };
  })()`;
}

function changed(before, after) {
  if (!before || !after) return false;
  if (before.board !== after.board) return true;
  if (before.loading !== after.loading) return true;
  return before.text !== after.text;
}

async function idle(win, ms) {
  await win.webContents.executeJavaScript(
    `new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(true)), ${ms}))`,
  );
}

async function realClick(win, rect) {
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({
    type: 'mouseDown', x, y, button: 'left', clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp', x, y, button: 'left', clickCount: 1,
  });
}

async function hitTest(win, instanceId, index, rect) {
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('${CARD_SELECTOR(instanceId)}');
    const surface = root && root.querySelector('.board-surface');
    if (!surface) return { error: 'surface gone' };
    const hit = document.elementFromPoint(${x}, ${y});
    if (!hit) return { blocked: true, hit: 'none', hit_class: '', hit_text: '' };
    const inSurface = surface.contains(hit);
    return {
      blocked: !inSurface,
      hit: hit.tagName.toLowerCase(),
      hit_class: String(hit.className || '').slice(0, 80),
      hit_node: hit.dataset ? (hit.dataset.node || '') : '',
      hit_text: String(hit.textContent || '').trim().slice(0, 24),
      index: ${index},
    };
  })()`);
}

async function syntheticClick(win, instanceId, index) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('${CARD_SELECTOR(instanceId)}');
    const surface = root && root.querySelector('.board-surface');
    if (!surface) return { error: 'surface gone' };
    const marks = [...surface.querySelectorAll('[data-probe-candidate="${index}"]')];
    if (!marks.length) return { error: 'candidate mark gone' };
    marks[0].click();
    return { ok: true };
  })()`);
}

async function mountBoard(win, boardId, ordinal) {
  const surface = loadRealBoardContract(boardId, ordinal, TEMPLATE_ROOT);
  await sendBoardEnvelope(win, surface);
  await activateBoardTab(win, surface.instanceId);
  await settleBoardLayout(win, surface.instanceId);
  const listing = await win.webContents.executeJavaScript(collectCandidates(surface.instanceId));
  if (listing.error) throw new Error(`${boardId}: ${listing.error}`);
  return { surface, listing };
}

async function auditBoard(win, boardId, ordinal) {
  let { surface, listing } = await mountBoard(win, boardId, ordinal);
  const results = [];
  for (const [index, candidate] of listing.candidates.entries()) {
    // 이전 클릭이 보드를 갈아탔으면 기준 보드로 되돌린다.
    const current = await win.webContents.executeJavaScript(fingerprintProbe(surface.instanceId));
    if (current.error || current.board !== boardId) {
      await win.webContents.executeJavaScript('window.AthenaShell.clearCanvases()');
      ({ surface } = await mountBoard(win, boardId, ordinal));
    }
    // 자리는 다시 잰다 — 재마운트·레이아웃으로 바뀔 수 있다.
    const spot = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('${CARD_SELECTOR(surface.instanceId)}');
      const el = root && root.querySelector('[data-probe-candidate="${index}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    if (!spot || spot.w < 2 || spot.h < 2) {
      results.push({ ...candidate, verdict: 'gone' });
      continue;
    }
    const hit = await hitTest(win, surface.instanceId, index, spot);
    const before = await win.webContents.executeJavaScript(fingerprintProbe(surface.instanceId));
    await realClick(win, spot);
    await idle(win, 250);
    const afterReal = await win.webContents.executeJavaScript(fingerprintProbe(surface.instanceId));
    let verdict = changed(before, afterReal) ? 'responds' : null;
    let synthetic = null;
    if (!verdict) {
      synthetic = await syntheticClick(win, surface.instanceId, index);
      await idle(win, 250);
      const afterSynth = await win.webContents.executeJavaScript(
        fingerprintProbe(surface.instanceId),
      );
      verdict = changed(afterReal, afterSynth) ? 'hit_blocked' : 'inert';
    }
    results.push({
      ...candidate,
      rect: spot,
      hit,
      verdict,
      synthetic_error: synthetic && synthetic.error ? synthetic.error : undefined,
    });
  }
  await win.webContents.executeJavaScript('window.AthenaShell.clearCanvases()');
  return results;
}

function summarize(boards) {
  const totals = { responds: 0, hit_blocked: 0, inert: 0, gone: 0 };
  const byLabel = new Map();
  for (const board of boards) {
    for (const control of board.controls || []) {
      totals[control.verdict] = (totals[control.verdict] || 0) + 1;
      const key = `${control.why}·${control.text}`;
      const entry = byLabel.get(key) || { why: control.why, text: control.text, verdicts: {} };
      entry.verdicts[control.verdict] = (entry.verdicts[control.verdict] || 0) + 1;
      byLabel.set(key, entry);
    }
  }
  return { totals, labels: [...byLabel.values()] };
}

// 게이트 판정. Paper 계약이 「여기를 누르면 저 보드로 간다」라고 말한 잎
// (`state-control`)은 전부 반응해야 한다 — 하나라도 안 반응하면 그 카드의 길이
// 끊긴 것이고, 2026-09-07의 회귀(showBoardLoading insertBefore)가 바로 그 모양이었다.
// `affordance`·`pill`은 아직 동작이 없는 것이 많아 세기만 하고 판정하지 않는다.
function gateFindings(boards) {
  const findings = [];
  for (const board of boards) {
    if (board.error) {
      findings.push({ board_id: board.board_id, reason: `board_audit_failed — ${board.error}` });
      continue;
    }
    for (const control of board.controls || []) {
      if (control.why !== 'state-control' || control.verdict === 'responds') continue;
      findings.push({
        board_id: board.board_id,
        reason: `state_control_${control.verdict}`,
        control: control.text,
        node: control.node,
        state_board: control.state_board,
      });
    }
  }
  return findings;
}

async function main() {
  const startedAt = Date.now();
  const requested = String(process.env.ATHENA_VERIFY_BOARD_IDS || '').trim();
  const all = CARD_BOARDS.map((board) => board.board_id);
  const boardIds = requested ? requested.split(',').map((id) => id.trim()).filter(Boolean) : all;

  await app.whenReady();
  registerShellIpc();
  const win = await bootShell();

  const boards = [];
  for (const [index, boardId] of boardIds.entries()) {
    process.stdout.write(`[card-buttons] ${boardId} (${index + 1}/${boardIds.length})\n`);
    try {
      const controls = await auditBoard(win, boardId, (index % 6) + 1);
      const counts = controls.reduce((acc, control) => {
        acc[control.verdict] = (acc[control.verdict] || 0) + 1;
        return acc;
      }, {});
      boards.push({ board_id: boardId, counts, controls });
      process.stdout.write(`           ${JSON.stringify(counts)}\n`);
    } catch (error) {
      boards.push({ board_id: boardId, error: String(error.message || error) });
      process.stdout.write(`           ERROR ${String(error.message || error)}\n`);
    }
  }

  const findings = gateFindings(boards);
  const report = {
    gate: 'probe:card-buttons',
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    boards_audited: boards.length,
    ...summarize(boards),
    findings,
    boards,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const target = path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/');
  if (findings.length) {
    for (const finding of findings) console.error(`[card-buttons] ${JSON.stringify(finding)}`);
    console.error(`[card-buttons] ${JSON.stringify(report.totals)} → ${target}`);
    console.error(`card buttons verification failed — 상태 보드 링크 ${findings.length}건이 안 눌린다`);
    app.exit(1);
    return;
  }
  console.log(`[card-buttons] ${JSON.stringify(report.totals)} → ${target}`);
  console.log('card buttons verification passed');
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
