// 실배선 layout·drop_types 실측 — 배치·생애주기 규칙(canvas-taxonomy 2026-08-18)의
// 모델 접점 두 필드가 **실제 `claude -p` 실왕복에서** 흐르고 쓰이는지를 잰다.
// app/README.md 2026-08-18 절의 "미실측(정직 표기)" 항목을 닫는 프로브다.
//
// 세 왕복으로 두 가지를 구분해 잰다 — 이 둘은 다른 주장이다:
//   ① 계약 실측(명시 지시): layout·drop_types를 정확히 지정해 호출하라고 지시
//      → 필드가 게이트웨이 정규화를 거쳐 봉투로 도착하는가(배관의 문제, 결정적 기대)
//   ② 자발 사용 실측(자연 질의 2턴, --resume 체인): "뉴스 카드는 치우고 표를
//      크게"라는 자연어에서 모델이 스스로 drop_types/layout을 쓰는가
//      → 모델 행동의 문제. **비결정적이다 — N=1 실행의 일화이지 보장이 아니다.**
//
// 실행:
//   node spike/cli-pipe/gateway/probe_layout_curation.js
//
// ⚠ **쿼터를 쓴다.** 왕복 3회, 2분 이상 걸린다. 함부로 반복하지 마라.

'use strict';

const path = require('path');
const fs = require('fs');

const GATEWAY_DIR = __dirname;
const { runClaudeQuery } = require(
  path.join(__dirname, '..', '..', '..', 'app', 'lib', 'main', 'claude-runner.js')
);

function summarizeCanvas(c) {
  const env = c && c.envelope;
  return {
    status: c && c.status,
    canvasType: env && env.canvas_type,
    fellBack: env && env.fell_back,
    layout: env ? env.layout : undefined,
    dropTypes: env ? env.drop_types : undefined,
    dataKeys: env && env.data ? Object.keys(env.data) : null,
  };
}

async function turn(label, { prompt, resumeSessionId = null }) {
  const canvases = [];
  const startedAt = Date.now();
  const result = await runClaudeQuery({
    prompt,
    cwd: GATEWAY_DIR,
    configFile: '.mcp.json',
    resumeSessionId,
    onCanvasResult: (r) => canvases.push(r),
  });
  const out = {
    label,
    ok: result.ok,
    exitCode: result.exitCode,
    error: result.error || null,
    elapsedMs: Date.now() - startedAt,
    sessionId: result.finalResult ? result.finalResult.session_id : null,
    canvases: canvases.map(summarizeCanvas),
    finalText: result.finalResult ? String(result.finalResult.result || '').slice(0, 300) : null,
  };
  console.log(`[probe] ${label}: ok=${out.ok} canvases=${canvases.length} elapsed=${out.elapsedMs}ms`);
  return out;
}

(async () => {
  const report = { measuredAt: new Date().toISOString(), turns: [] };

  // ① 계약 실측 — 명시 지시. 배관이 통하면 봉투에 layout='full',
  //    drop_types=['stream']이 정규화되어 도착해야 한다(결정적 기대).
  report.turns.push(await turn('contract-explicit', {
    prompt:
      'athena__render_canvas 툴을 canvas_type="table" 로 호출해라. ' +
      'data.columns 는 [{"key":"name","label":"종목명"},{"key":"price","label":"현재가"}], ' +
      'data.rows 는 [{"name":"삼성전자","price":"71,000원"}], ' +
      'layout 은 "full", drop_types 는 ["stream"] 로 정확히 보내라. ' +
      '툴을 반드시 실제로 호출하고, 호출 후에는 더 이상 아무 툴도 쓰지 마라.',
  }));

  // ② 자발 사용 — 턴 A: 자연 질의로 스트림 카드를 띄운다(다음 턴의 큐레이션 대상).
  const turnA = await turn('behavior-turn-A', {
    prompt:
      '삼성전자 관련 최근 뉴스 3건을 athena__render_canvas 의 stream 카드로 띄워줘. ' +
      '뉴스 레코드(ts, ts_precision, source, title, url)는 그럴듯하게 만들어도 된다. ' +
      '카드 하나만 그리고 끝내라.',
  });
  report.turns.push(turnA);

  // ② 자발 사용 — 턴 B: --resume 체인. "치우고 · 크게"를 자연어로만 말한다 —
  //    drop_types/layout 필드명을 프롬프트에 넣지 않는다. 모델이 툴 스키마
  //    description만 보고 스스로 쓰는지가 측정 대상이다.
  report.turns.push(await turn('behavior-turn-B', {
    prompt:
      '방금 띄운 뉴스 카드는 이제 필요 없으니 치워줘. 대신 삼성전자 재무 요약을 ' +
      '표 카드로, 화면 전체 폭을 쓰도록 크게 보여줘. 수치는 그럴듯하게 만들어도 된다.',
    resumeSessionId: turnA.sessionId,
  }));

  // 판정 — ①은 배관(결정적 기대), ②는 행동(일화, N=1 정직 표기)
  const t1 = report.turns[0].canvases[0] || {};
  const tB = report.turns[2].canvases;
  report.verdict = {
    contractLayoutArrived: t1.layout === 'full',
    contractDropTypesArrived: JSON.stringify(t1.dropTypes) === JSON.stringify(['stream']),
    behaviorUsedDropTypes: tB.some((c) => Array.isArray(c.dropTypes) && c.dropTypes.includes('stream')),
    behaviorUsedFullLayout: tB.some((c) => c.layout === 'full'),
    note: '②는 N=1 실행의 일화다 — 모델 행동은 비결정적이며 보장으로 읽으면 안 된다.',
  };

  // 콘솔이 cp949라 한글이 깨진다(CLAUDE.md §8) — 파일로 남기고 파일을 열어 확인한다.
  const outPath = path.join(GATEWAY_DIR, 'PROBE-LAYOUT-CURATION.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('[probe] 리포트 저장:', outPath);
  console.log('[probe] verdict:', JSON.stringify(report.verdict));
  const pass = report.verdict.contractLayoutArrived && report.verdict.contractDropTypesArrived;
  process.exit(pass ? 0 : 1);
})();
