// Paper H-1 견본 11장(`template/*`)을 실제 오브 대화 경로로 흘려보내는 런타임 게이트.
//
// 왜 96장 프로브(`probe-orb-kiumi-96.js`)로는 모자라나:
// 대장 96행이 실제로 쓰는 문법은 chart · compound · facts · order_confirm · order_ticket ·
// table 여섯이고 **auth · event · reader · stream 넷은 0장이다.** 그 넷은 `orb-mini-card.js`가
// 문법으로 인정하는데(`scripts/build_kiumi_registry.py` GRAMMARS 10종) 아무도 그리지 않아
// 깨져도 아무 게이트가 안 운다. 견본 11장이 그 구멍을 메운다 — 문법 10종이 여기서 전부 선다.
//
// 봉투는 대장이 아니라 **견본 보드 원장에서** 만든다(설계서 §5.3.2). 값은 Paper 원문 그대로
// 넣는다 — 견본은 「문법이 그려지는가」를 재는 자리라 값을 지어내면 그리기 실패를 값 탓으로
// 오독하게 된다. 승인 예시값은 이 프로브 안에서만 살고 제품 런타임에는 들어가지 않는다.
//
// 성공 표지: paper mini template verification passed

const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const { parseTreeRecords } = require('./lib/paper-tree');
const { mergeTemplateLayer } = require('./lib/paper-mini-report');
const { MINI_GRAMMARS, templateGrammarOf, grammarCoverage, templateEnvelopeSpec } = require('./lib/paper-mini-compare');

const APP_ROOT = __dirname;
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const LEDGER_DIR = path.join(REPO_ROOT, 'backend', 'ref', 'paper-ledger');
const KIUMI_LEDGER_PATH = path.join(REPO_ROOT, 'backend', 'ref', 'kiumi', 'kiumi-ledger.jsonl');
const REPORT_PATH = path.join(APP_ROOT, 'captures', 'paper-gates', 'PAPER-MINI.json');
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

const PROFILE = path.join(APP_ROOT, '.probe-paper-mini-template-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_PERSISTENT_CHAT = '0';
process.env.ATHENA_CHAT_HISTORY_DB_PATH = path.join(PROFILE, 'athena-chat-outbox.sqlite3');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const manifest = readJson(path.join(LEDGER_DIR, 'manifest.json'));
const ledgerRecords = fs.readFileSync(KIUMI_LEDGER_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean)
  .map((line) => JSON.parse(line));
const grammarByBoardId = new Map(ledgerRecords.map((record) => [record.board_id, record.grammar]));

const TEMPLATES = manifest.boards
  .filter((board) => board.role === 'mini_template')
  .map((board) => {
    const grammar = templateGrammarOf(board.name, grammarByBoardId);
    const records = parseTreeRecords(fs.readFileSync(path.join(LEDGER_DIR, board.page, `${board.id}.tree.txt`), 'utf8'));
    return { board_id: board.id, name: board.name, grammar, records };
  });

/** `probe-orb-kiumi-96.js:34-45`와 같은 배정. 여기서 틀리면 봉투가 카드가 되지 못한다. */
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

function envelopeFor(template) {
  const spec = templateEnvelopeSpec(template);
  const slotValues = spec.kiumi.elements.map((element) => ({
    slot_id: element.source_slot_id,
    value: {
      value: element.paper_text,
      text: element.paper_text,
      tone: sampleTone(String(element.paper_text || '')),
    },
    format: element.format,
  }));
  const data = template.grammar === 'order_ticket'
    ? {
      fields: [
        { key: 'symbol', value: '005930' },
        { key: 'symbol_name', value: '삼성전자' },
        { key: 'side', value: 'buy' },
        { key: 'qty', value: 10 },
        { key: 'estimated_amount', value: 1508500 },
      ],
    }
    : template.grammar === 'chart'
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
    card_title: template.grammar === 'order_ticket' ? '주문 티켓' : spec.kiumi.title,
    caption: spec.caption,
    canvas_type: canvasType(template.grammar),
    fell_back: false,
    data,
    surface_contract: {
      surface_version: 1,
      board_id: template.board_id,
      card_id: '',
      slot_values: slotValues,
      kiumi: spec.kiumi,
    },
  };
}

const ENVELOPES = TEMPLATES.map(envelopeFor);
const ANSWER_TEXT = '카드미니 견본 11장을 확인했습니다.';

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
    const id = `mini-template-${index + 1}`;
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
    type: 'result', is_error: false, result: ANSWER_TEXT, session_id: 'FAKE-MINI-TEMPLATE',
  }));
  return `${lines.join('\n')}\n`;
}

function compileFakeClaude() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mini-template-'));
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

function writeReport(runtime) {
  const existing = fs.existsSync(REPORT_PATH) ? readJson(REPORT_PATH) : null;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(mergeTemplateLayer(existing, runtime), null, 2) + '\n');
}

async function main() {
  const startedAt = Date.now();
  if (TEMPLATES.length !== 11) throw new Error(`견본 보드 수가 11이 아니다: ${TEMPLATES.length}`);
  process.env.ATHENA_CLAUDE_BIN = compileFakeClaude();
  console.log(`[probe-paper-mini-template] envelopes=${ENVELOPES.length}`);

  // 검증 창은 file/data 리소스만 쓴다. main.js를 로드하기 전에 HTTP와 WebSocket을
  // 막아 공유 backend/provider에 닿는 경로를 fail-closed로 만든다.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(?:https?|wss?):/i.test(details.url) });
  });
  const mainModule = require('./main.js');
  require('./lib/main/history-sink').configureChatHistoryStore({
    dbPath: path.join(PROFILE, 'athena-chat-outbox.sqlite3'),
  });
  await mainModule.createWindows();
  mainModule.startBootReadinessForVerify();
  const { shellWin, orbWin } = mainModule.getWins();
  if (!shellWin || !orbWin) throw new Error('shellWin/orbWin을 찾지 못했다');
  orbWin.webContents.on('console-message', (_event, details) => {
    console.log(`[probe-paper-mini-template] renderer ${details.level}: ${details.message}`);
  });
  // 격리 검증은 실제 부팅을 시작하지 않으므로 기존 준비 경로로 창을 정리한다.
  mainModule.revealShell({ focus: true, force: true });
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
  await orbWin.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('orbInput');
    input.value = '카드미니 견본 확인';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);

  const queryAccepted = await waitFor(() => orbWin.webContents.executeJavaScript(
    "Array.from(document.querySelectorAll('#orbChatTurns .orb-turn-q')).some((node) => node.textContent === '카드미니 견본 확인')",
  ), 3000);
  if (!queryAccepted) {
    const inputState = await orbWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('orbInput');
      return { disabled: input.disabled, value: input.value };
    })()`);
    throw new Error(`오브가 견본 질의를 수락하지 않았다: ${JSON.stringify(inputState)}`);
  }

  const deadline = Date.now() + 45000;
  let rendered = 0;
  while (Date.now() < deadline) {
    rendered = await orbWin.webContents.executeJavaScript(
      "document.querySelectorAll('#orbChatTurns .orb-kiumi-card').length",
    );
    if (rendered === TEMPLATES.length) break;
    await wait(400);
  }
  console.log(`[probe-paper-mini-template] render-loop-done count=${rendered}`);

  // 감사 항목은 `probe-orb-kiumi-96.js:232-262`와 같다 — 높이 420 고정 · 넘침 0 · 잘린 글 0.
  const audit = await orbWin.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('#orbChatTurns .orb-kiumi-card'));
    return cards.map((card) => {
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
        rows: card.querySelectorAll('.orb-kiumi-row, .orb-kiumi-kpi, .orb-kiumi-chart-value').length,
        clippedText,
        hasButton: !!card.querySelector('button'),
      };
    });
  })()`);

  const drawnOf = new Map(audit.map((entry) => [entry.boardId, entry]));
  const templates = TEMPLATES.map((template) => {
    const drawn = drawnOf.get(template.board_id) || null;
    const failures = [];
    if (!template.grammar) failures.push({ code: 'grammar_uncovered', layer: 'template', reason: '보드 이름에서 문법을 못 정했다' });
    if (!drawn) failures.push({ code: 'mount_failed', layer: 'template' });
    if (drawn && drawn.grammar !== template.grammar) {
      failures.push({ code: 'grammar_mismatch', layer: 'template', drawn: drawn.grammar });
    }
    if (drawn && drawn.height !== 420) failures.push({ code: 'height_drift', layer: 'template', height: drawn.height });
    if (drawn && drawn.scrollHeight > drawn.clientHeight + 1) {
      failures.push({ code: 'overflow_y', layer: 'template', scroll_height: drawn.scrollHeight, client_height: drawn.clientHeight });
    }
    if (drawn && drawn.clippedText.length) {
      failures.push({ code: 'clipped_text', layer: 'template', nodes: drawn.clippedText });
    }
    if (template.grammar === 'order_ticket' && drawn && !drawn.hasButton) {
      failures.push({ code: 'ticket_action_missing', layer: 'template' });
    }
    return {
      paper_board: template.board_id,
      name: template.name,
      grammar: template.grammar,
      status: failures.length ? 'fail' : 'pass',
      drawn: drawn ? {
        grammar: drawn.grammar, width: drawn.width, height: drawn.height, rows: drawn.rows,
      } : null,
      failures,
    };
  });

  // 커버리지는 **그려진** 문법으로 센다 — 이름이 덮는 것과 그려지는 것은 다른 사실이고,
  // 이 게이트가 재려는 것은 뒤쪽이다.
  const coverage = grammarCoverage(templates
    .filter((template) => template.status === 'pass')
    .map((template) => ({ board_id: template.paper_board, grammar: template.drawn.grammar })));
  const gateFailures = coverage.ok
    ? []
    : [{ code: 'grammar_uncovered', layer: 'template', uncovered: coverage.uncovered }];

  const runtime = {
    gate: 'verify:paper-mini-template',
    generated_at: new Date().toISOString(),
    rendered,
    elapsed_ms: Date.now() - startedAt,
    grammar_coverage: coverage,
    gate_failures: gateFailures,
    templates,
  };
  writeReport(runtime);

  const failed = templates.filter((template) => template.status === 'fail');
  const ok = rendered === TEMPLATES.length && failed.length === 0 && coverage.ok;
  console.log(`[probe-paper-mini-template] 견본 ${templates.length}장 · 그려짐 ${rendered} · 실패 ${failed.length}`);
  console.log(`[probe-paper-mini-template] 문법 ${coverage.covered.length}/${MINI_GRAMMARS.length}${coverage.ok ? '' : ` · 못 그린 문법 ${coverage.uncovered.join(', ')}`}`);
  for (const template of failed) {
    console.log(`[probe-paper-mini-template] FAIL ${template.paper_board} ${template.name} ${JSON.stringify(template.failures)}`);
  }
  console.log(ok ? 'paper mini template verification passed' : '[probe-paper-mini-template] FAILED');
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error('[probe-paper-mini-template]', error);
  app.exit(1);
});
