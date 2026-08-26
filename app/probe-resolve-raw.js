// 카드 랜딩 진단 2단계 — probe-card-landing.js가 athena_resolve 4연속 실패로
// render_canvas까지 못 간다는 걸 보였다. 이 프로브는 run-cases.js 패턴(직접
// runClaudeQuery, ensureMcpConfig)으로 같은 질의를 다시 태우면서 raw NDJSON
// 이벤트 전부를 저장해 resolve tool_result의 실제 에러 텍스트를 노출한다.
// 백엔드(127.0.0.1:8010)가 이미 떠 있어야 한다.

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

const QUERY = process.argv[2] || '삼성전자 지금 추이가 어때';
const OUT_DIR = path.join(__dirname, 'captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const { runClaudeQuery } = require('./lib/main/claude-runner');
  const { ensureMcpConfig } = require('./lib/main/mcp-config');
  const { buildLivePrompt } = require('./lib/main/live-prompt');
  const { dir, configFile } = ensureMcpConfig(app.getPath('userData'));

  const rawEvents = [];
  const toolUseIndex = new Map(); // id -> {name, input}

  const result = await runClaudeQuery({
    prompt: buildLivePrompt(QUERY),
    cwd: dir,
    configFile,
    onEvent: (ev) => {
      rawEvents.push(ev);
      if (ev && ev.type === 'assistant' && Array.isArray(ev.message && ev.message.content)) {
        for (const block of ev.message.content) {
          if (block && block.type === 'tool_use' && block.id) {
            toolUseIndex.set(block.id, { name: block.name, input: block.input });
          }
        }
      }
    },
  });

  // resolve/render_canvas 관련 tool_use + tool_result만 골라 사람이 읽을 요약을 만든다.
  const toolTimeline = [];
  for (const ev of rawEvents) {
    if (ev && ev.type === 'assistant' && Array.isArray(ev.message && ev.message.content)) {
      for (const block of ev.message.content) {
        if (block && block.type === 'tool_use') {
          toolTimeline.push({ kind: 'tool_use', id: block.id, name: block.name, input: block.input });
        }
      }
    }
    if (ev && ev.type === 'user' && Array.isArray(ev.message && ev.message.content)) {
      for (const block of ev.message.content) {
        if (block && block.type === 'tool_result') {
          const meta = toolUseIndex.get(block.tool_use_id);
          toolTimeline.push({
            kind: 'tool_result',
            tool_use_id: block.tool_use_id,
            tool_name: meta && meta.name,
            is_error: block.is_error === true,
            content: block.content,
          });
        }
      }
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'probe-resolve-raw-events.jsonl'),
    rawEvents.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(OUT_DIR, 'probe-resolve-raw-timeline.json'),
    JSON.stringify(toolTimeline, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'probe-resolve-raw-result.json'), JSON.stringify({
    ok: result.ok,
    error: result.error,
    finalResult: result.finalResult,
  }, null, 1));

  console.log('[probe-resolve-raw] tool timeline:');
  for (const step of toolTimeline) {
    if (step.kind === 'tool_use') {
      console.log(`  -> ${step.name} ${JSON.stringify(step.input)}`);
    } else {
      const text = typeof step.content === 'string' ? step.content : JSON.stringify(step.content);
      console.log(`  <- ${step.tool_name} isError=${step.is_error} ${text.slice(0, 400)}`);
    }
  }
  console.log('[probe-resolve-raw] final answer:', result.finalResult && result.finalResult.result);
  app.exit(0);
});
