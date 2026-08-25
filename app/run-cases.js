
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

// 케이스 로더 · audit 스냅샷/델타 · 날짜 스탬프는 run-cases-ui.js·run-cases-appmode.js와
// 공용이다 — app/lib/main/eval-harness.js 참조.
const { loadCases, auditSnapshot, auditDelta, stampDir } = require('./lib/main/eval-harness');

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

  const cases = loadCases(DATASET);
  const { runClaudeQuery } = require('./lib/main/claude-runner');
  const { ensureMcpConfig } = require('./lib/main/mcp-config');
  const { buildLivePrompt } = require('./lib/main/live-prompt');
  const { dir, configFile } = ensureMcpConfig(app.getPath('userData'));

  const runDir = path.join(REPO, 'datasets', 'eval-runs', `${stampDir(new Date())}-intraday`);
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

    const before = auditSnapshot(AUDIT_DIR);
    const startedAt = new Date();
    const canvasResults = [];

    const result = await runClaudeQuery({
      prompt: buildLivePrompt(userText),
      cwd: dir,
      configFile,
      onCanvasResult: (r) => { canvasResults.push(r); },
    });

    const delta = auditDelta(AUDIT_DIR, before);
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
