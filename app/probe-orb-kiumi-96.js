// Paper H-1의 카드미니 96장을 실제 오브 대화 경로로 흘려보내는 시각·레이아웃 프로브.
// 승인 예시값은 화면 스트레스 테스트에만 쓰고 제품 런타임에는 들어가지 않는다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { captureRoot } = require('./lib/probe-captures');

const APP_ROOT = __dirname;
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const OUT_DIR = path.join(captureRoot(APP_ROOT), 'kiumi-96');
const LEDGER_PATH = path.join(REPO_ROOT, 'backend', 'ref', 'kiumi', 'kiumi-ledger.jsonl');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROFILE = path.join(APP_ROOT, '.probe-orb-kiumi-96-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_PERSISTENT_CHAT = '0';

const records = fs.readFileSync(LEDGER_PATH, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));

function canvasType(grammar) {
  return ({
    chart: 'chart', compound: 'compound', facts: 'facts', table: 'table',
    order_ticket: 'facts', order_confirm: 'action', event: 'event', auth: 'status',
    reader: 'reader', stream: 'stream',
  })[grammar];
}

function sampleTone(text) {
  if (/^(?:\+|▲)/.test(text)) return 'up';
  if (/^(?:-|−|▼)/.test(text)) return 'down';
  return null;
}

function envelopeFor(record) {
  const { board_id: boardId, ...kiumi } = record;
  const slotValues = record.elements.map((element) => ({
    slot_id: element.source_slot_id,
    value: {
      value: element.paper_text,
      text: element.paper_text,
      tone: sampleTone(String(element.paper_text || '')),
    },
    format: element.format,
  }));
  const data = record.grammar === 'order_ticket'
    ? {
      fields: [
        { key: 'symbol', value: '005930' },
        { key: 'symbol_name', value: '삼성전자' },
        { key: 'side', value: 'buy' },
        { key: 'qty', value: 10 },
        { key: 'estimated_amount', value: 1508500 },
      ],
    }
    : record.grammar === 'chart'
      ? {
        chart: {
          period: 'day',
          candles: [
            { time: '2026-06-01', close: 72400 },
            { time: '2026-07-01', close: 89100 },
            { time: '2026-08-01', close: 121500 },
            { time: '2026-09-01', close: 150850 },
          ],
        },
      }
      : {};
  return {
    card_title: record.grammar === 'order_ticket' ? '주문 티켓' : record.title,
    caption: '기준 09:42',
    canvas_type: canvasType(record.grammar),
    fell_back: false,
    data,
    surface_contract: {
      surface_version: 1,
      board_id: boardId,
      card_id: String(record.eyebrow || '').split(' / ')[0],
      slot_values: slotValues,
      kiumi,
    },
  };
}

const ENVELOPES = records.map(envelopeFor);
const ANSWER_TEXT = '카드미니 96장을 확인했습니다.';

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('csc.exe를 찾을 수 없다');
  return found;
}

function buildNdjson() {
  const lines = [];
  ENVELOPES.forEach((envelope, index) => {
    const id = `kiumi-${index + 1}`;
    lines.push(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name: 'mcp__athena__athena__render_canvas' }] },
    }));
    lines.push(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(envelope) }] },
    }));
  });
  lines.push(JSON.stringify({
    type: 'result', is_error: false, result: ANSWER_TEXT, session_id: 'FAKE-KIUMI-96',
  }));
  return `${lines.join('\n')}\n`;
}

function compileFakeClaude() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-kiumi-96-'));
  const sourcePath = path.join(tempDir, 'fakeclaude.cs');
  const exePath = path.join(tempDir, 'fakeclaude.exe');
  const payload = Buffer.from(buildNdjson(), 'utf8').toString('base64');
  const source = `
using System;
using System.Text;
class Program {
  static void Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.Write(Encoding.UTF8.GetString(Convert.FromBase64String("${payload}")));
    Console.Out.Flush();
  }
}`;
  fs.writeFileSync(sourcePath, source, 'utf8');
  execFileSync(findCsc(), ['/nologo', `/out:${exePath}`, sourcePath], { stdio: 'pipe' });
  return exePath;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
    } catch { /* renderer navigation 중이면 다시 확인한다 */ }
    await wait(200);
  }
  return false;
}

async function main() {
  if (records.length !== 96) throw new Error(`대장 보드 수가 96이 아니다: ${records.length}`);
  process.env.ATHENA_CLAUDE_BIN = compileFakeClaude();
  const fakeOutput = execFileSync(process.env.ATHENA_CLAUDE_BIN, [], { encoding: 'utf8' });
  console.log(`[probe-orb-kiumi-96] fake-cli lines=${fakeOutput.trim().split(/\r?\n/).length}`);

  const mainModule = require('./main.js');
  await mainModule.createWindows();
  const { shellWin, orbWin } = mainModule.getWins();
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin을 찾지 못했다');
  orbWin.webContents.on('console-message', (_event, details) => {
    console.log(`[probe-orb-kiumi-96] renderer ${details.level}: ${details.message}`);
  });
  orbWin.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[probe-orb-kiumi-96] renderer-gone ${JSON.stringify(details)}`);
  });
  console.log('[probe-orb-kiumi-96] windows-ready');
  shellWin.show();
  shellWin.focus();
  const shellReady = await waitFor(() => shellWin.webContents.executeJavaScript(
    "!!(document.getElementById('winClose') && document.getElementById('dot'))",
  ));
  if (!shellReady) throw new Error('셸 렌더러가 준비되지 않았다');
  const bootHandoffDone = await waitFor(() => mainModule.getWins().bootWin === null);
  if (!bootHandoffDone) throw new Error('부팅 창에서 셸로의 handoff가 끝나지 않았다');
  await shellWin.webContents.executeJavaScript(
    "document.getElementById('winClose') && document.getElementById('winClose').click()",
  );
  const chatReady = await waitFor(async () => {
    if (!orbWin.isVisible()) return false;
    return orbWin.webContents.executeJavaScript(
      "document.getElementById('orbRoot').dataset.orbMode === 'chat'",
    );
  });
  if (!chatReady) throw new Error('셸 숨김 뒤 오브가 chat 모드로 전환되지 않았다');
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  const panelReady = await waitFor(() => orbWin.webContents.executeJavaScript(
    "document.getElementById('orbPanel').hidden === false",
  ));
  if (!panelReady) throw new Error('오브 패널이 펼쳐지지 않았다');
  const surfaceState = await orbWin.webContents.executeJavaScript(`(() => ({
    mode: document.getElementById('orbRoot').dataset.orbMode,
    panelHidden: document.getElementById('orbPanel').hidden,
    panelDisplay: getComputedStyle(document.getElementById('orbPanel')).display,
    chatHidden: document.getElementById('orbChatBody').hidden,
  }))()`);
  console.log(`[probe-orb-kiumi-96] orb-open visible=${orbWin.isVisible()} bounds=${JSON.stringify(orbWin.getBounds())} surface=${JSON.stringify(surfaceState)}`);
  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = '카드미니 전수 확인';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  console.log('[probe-orb-kiumi-96] query-dispatched');

  const deadline = Date.now() + 45000;
  let count = 0;
  let polls = 0;
  while (Date.now() < deadline) {
    count = await orbWin.webContents.executeJavaScript(
      "document.querySelectorAll('#orbChatTurns .orb-kiumi-card').length",
    );
    if (count === 96) break;
    polls += 1;
    if (polls % 10 === 0) {
      const state = await orbWin.webContents.executeJavaScript(`(() => ({
        cards: document.querySelectorAll('#orbChatTurns .orb-kiumi-card').length,
        turns: document.querySelectorAll('#orbChatTurns .orb-turn').length,
        inputDisabled: document.getElementById('orbInput').disabled,
        mode: document.getElementById('orbRoot').dataset.orbMode,
      }))()`);
      console.log(`[probe-orb-kiumi-96] poll ${JSON.stringify(state)}`);
    }
    await wait(400);
  }
  console.log(`[probe-orb-kiumi-96] render-loop-done count=${count}`);

  console.log('[probe-orb-kiumi-96] audit-start');
  const audit = await orbWin.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-kiumi-card'));
    const inspect = (card) => {
      const rect = card.getBoundingClientRect();
      const textNodes = Array.from(card.querySelectorAll(
        '.orb-kiumi-title, .orb-kiumi-meta, .orb-kiumi-label, .orb-kiumi-value, .orb-kiumi-note',
      ));
      const clippedText = textNodes.filter((node) => (
        node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
      )).map((node) => ({ className: node.className, text: node.textContent }));
      return {
        boardId: card.dataset.boardId,
        grammar: card.dataset.kiumiGrammar,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        clientHeight: card.clientHeight,
        scrollHeight: card.scrollHeight,
        overflowY: getComputedStyle(card).overflowY,
        clippedText,
        hasButton: !!card.querySelector('button'),
      };
    };
    return cards.map(inspect);
  })()`);

  console.log(`[probe-orb-kiumi-96] audit-done entries=${audit.length}`);
  const grammarCounts = Object.fromEntries(
    [...new Set(audit.map((entry) => entry.grammar))]
      .sort()
      .map((grammar) => [grammar, audit.filter((entry) => entry.grammar === grammar).length]),
  );
  const badHeight = audit.filter((entry) => entry.height !== 420);
  const overflowing = audit.filter((entry) => entry.scrollHeight > entry.clientHeight + 1);
  const clippedText = audit.filter((entry) => entry.clippedText.length);
  const tickets = audit.filter((entry) => entry.grammar === 'order_ticket');
  const report = {
    ok: count === 96 && audit.length === 96 && badHeight.length === 0
      && overflowing.length === 0 && clippedText.length === 0
      && tickets.length === 1 && tickets[0].hasButton,
    rendered: count,
    grammarCounts,
    badHeight,
    overflowing,
    clippedText,
    orderTicket: tickets,
    captureErrors: [],
  };

  for (const grammar of Object.keys(grammarCounts)) {
    console.log(`[probe-orb-kiumi-96] capture-start grammar=${grammar}`);
    await orbWin.webContents.executeJavaScript(`(() => {
      const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-kiumi-card'));
      const card = cards.find((candidate) => candidate.dataset.kiumiGrammar === '${grammar}');
      cards.forEach((candidate) => { candidate.style.display = candidate === card ? '' : 'none'; });
      if (card) card.scrollIntoView({ block: 'center' });
    })()`);
    await wait(120);
    try {
      const image = await Promise.race([
        orbWin.webContents.capturePage(),
        wait(5000).then(() => { throw new Error('capture timeout'); }),
      ]);
      fs.writeFileSync(path.join(OUT_DIR, `${grammar}.png`), image.toPNG());
      console.log(`[probe-orb-kiumi-96] capture-done grammar=${grammar}`);
    } catch (error) {
      report.captureErrors.push({ grammar, error: String((error && error.message) || error) });
      console.log(`[probe-orb-kiumi-96] capture-failed grammar=${grammar}`);
    }
  }
  report.ok = report.ok && report.captureErrors.length === 0;
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[probe-orb-kiumi-96] ${report.ok ? 'ALL OK' : 'FAILED'} ${JSON.stringify(report)}`);
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error('[probe-orb-kiumi-96]', error);
  app.exit(1);
});
