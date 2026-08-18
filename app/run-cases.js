// 검증 케이스 실행 하네스 — `datasets/앱-검증-200.jsonl`의 케이스를 실제로 왕복시킨다.
//
// 앱 커맨드바에 입력한 것과 **같은 경로**를 탄다: `buildLivePrompt`로 감싸고,
// `ensureMcpConfig`가 만든 userData의 `.mcp.json`을 쓰고, `runClaudeQuery`가
// `claude -p`를 spawn한다(env는 그 안에서 `buildEnvOverrides()`로 주입된다).
// 다른 것은 창이 없다는 것뿐이라 카드는 IPC 대신 `onCanvasResult` 콜백으로 받는다.
//
// Electron이 필요한 이유: 비밀값이 safeStorage(DPAPI)에 있어 복호화가 Electron
// 프로세스에서만 된다. `node`로 돌리면 upstream 서버가 fail-closed로 죽는다.
//
// ⚠ **쿼터를 쓴다.** 케이스 1건당 `claude -p` 왕복 1회(수십 초~수 분)다.
//
// 실행:
//   cd app && npx electron run-cases.js LIV-066 LIV-067
//   cd app && npx electron run-cases.js --file ../datasets/eval-runs/<run>/cases.txt
//
// 산출: datasets/eval-runs/<날짜>-intraday/<case-id>/ 아래
//   evidence/chat-answer.txt · evidence/audit-delta.jsonl · evidence/canvas-results.json
//   raw-result.json  (verdict.json은 별도 채점 단계에서 사람/에이전트가 쓴다)

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// probe-krx-live.js와 같은 이유 — 스크립트를 직접 실행하면 userData가 앱 본체와
// 갈려 athena-secrets.json을 못 찾는다.
app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

const REPO = path.join(__dirname, '..');
const DATASET = path.join(REPO, 'datasets', '앱-검증-200.jsonl');
const AUDIT_DIR = path.join(app.getPath('home'), '.athena', 'audit');

function loadCases() {
  const out = new Map();
  for (const line of fs.readFileSync(DATASET, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const c = JSON.parse(t);
    out.set(c.id, c);
  }
  return out;
}

// audit 로그는 append-only JSONL이다. 실행 전후 행 수를 재서 delta만 뽑는다 —
// 그 케이스가 실제로 어떤 upstream 툴을 불렀는지가 여기서만 확인된다.
function auditSnapshot() {
  const snap = {};
  if (!fs.existsSync(AUDIT_DIR)) return snap;
  for (const f of fs.readdirSync(AUDIT_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').split('\n').filter(Boolean);
    snap[f] = lines.length;
  }
  return snap;
}

function auditDelta(before) {
  const rows = [];
  if (!fs.existsSync(AUDIT_DIR)) return rows;
  for (const f of fs.readdirSync(AUDIT_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(before[f] || 0)) {
      try { rows.push(JSON.parse(l)); } catch { rows.push({ raw: l }); }
    }
  }
  return rows;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

app.whenReady().then(async () => {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let ids = argv;
  const fileFlag = process.argv.indexOf('--file');
  if (fileFlag !== -1 && process.argv[fileFlag + 1]) {
    ids = fs.readFileSync(process.argv[fileFlag + 1], 'utf8').split(/\s+/).filter(Boolean);
  }
  if (!ids.length) {
    process.stdout.write('USAGE: electron run-cases.js <CASE-ID> [CASE-ID...]\n');
    app.exit(2);
    return;
  }

  const cases = loadCases();
  const { runClaudeQuery } = require('./lib/main/claude-runner');
  const { ensureMcpConfig } = require('./lib/main/mcp-config');
  const { buildLivePrompt } = require('./lib/main/live-prompt');
  const { dir, configFile } = ensureMcpConfig(app.getPath('userData'));

  const runDir = path.join(REPO, 'datasets', 'eval-runs', `${stamp(new Date())}-intraday`);
  fs.mkdirSync(runDir, { recursive: true });

  const index = [];
  for (const id of ids) {
    const c = cases.get(id);
    if (!c) { process.stdout.write(`SKIP ${id} (데이터셋에 없음)\n`); continue; }

    // attachment가 있는 케이스는 사용자가 받은 원문을 함께 붙여넣는 상황이다
    // (평가-로드맵 §3-2). 질문 뒤에 그대로 잇는다.
    const userText = c.attachment ? `${c.question}\n\n${c.attachment}` : c.question;

    const caseDir = path.join(runDir, id);
    const evDir = path.join(caseDir, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });

    const before = auditSnapshot();
    const startedAt = new Date();
    const canvasResults = [];

    const result = await runClaudeQuery({
      prompt: buildLivePrompt(userText),
      cwd: dir,
      configFile,
      onCanvasResult: (r) => { canvasResults.push(r); },
    });

    const delta = auditDelta(before);
    const elapsed = (Date.now() - startedAt.getTime()) / 1000;

    // `runClaudeQuery`는 answerText를 직접 주지 않는다 — main.js:291이 하듯
    // finalResult.result(= claude -p의 type:"result" 이벤트)에서 뽑아야 한다.
    // 첫 실행에서 `result.answerText`를 읽어 4건 전부 빈 문자열을 저장했다.
    const answerText = result.finalResult && typeof result.finalResult.result === 'string'
      ? result.finalResult.result
      : null;

    fs.writeFileSync(path.join(evDir, 'chat-answer.txt'), String(answerText || ''), 'utf8');
    // 재분석용 원본. 텍스트 추출 방식이 틀렸을 때 쿼터를 또 쓰지 않으려면
    // 응답을 통째로 남겨야 한다(첫 실행에서 이걸 안 남겨 재실행했다).
    fs.writeFileSync(path.join(evDir, 'raw-response.json'), JSON.stringify({
      ok: result.ok,
      error: result.error || null,
      exitCode: result.exitCode,
      finalResult: result.finalResult || null,
      diagnostics: result.diagnostics || null,
    }, null, 1), 'utf8');
    fs.writeFileSync(path.join(evDir, 'audit-delta.jsonl'),
      delta.map((r) => JSON.stringify(r)).join('\n') + (delta.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(path.join(evDir, 'canvas-results.json'),
      JSON.stringify(canvasResults, null, 1), 'utf8');
    fs.writeFileSync(path.join(caseDir, 'raw-result.json'), JSON.stringify({
      case_id: id,
      tier: c.tier,
      persona: c.persona,
      question: c.question,
      attachment: c.attachment || null,
      sent_text: userText,
      ran_at: startedAt.toISOString(),
      duration_s: Number(elapsed.toFixed(1)),
      ok: result.ok,
      error: result.error || null,
      answer_chars: (answerText || '').length,
      canvas_types: canvasResults.map((r) => (r.envelope && r.envelope.canvas_type) || r.status),
      audit_calls: delta.map((r) => `${r.alias}__${r.tool}=${r.success}`),
      judge: c.judge,
    }, null, 1), 'utf8');

    index.push({ id, ok: result.ok, duration_s: Number(elapsed.toFixed(1)),
      cards: canvasResults.length, audit: delta.length });
    process.stdout.write(`DONE ${id} ok=${result.ok} ${elapsed.toFixed(1)}s cards=${canvasResults.length} audit=${delta.length}\n`);
  }

  fs.writeFileSync(path.join(runDir, 'run-index.json'), JSON.stringify({
    ran_at: new Date().toISOString(),
    cases: index,
  }, null, 1), 'utf8');
  process.stdout.write(`WROTE ${runDir}\n`);
  app.exit(0);
});
