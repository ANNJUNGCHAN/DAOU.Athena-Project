// 실배선 스폰 프롬프트 — 사용자 질문을 캔버스 렌더 지시로 감싼다.
//
// 왜 필요한가(2026-08-17 실측): --allowedTools가 게이트웨이 서버 전체로 넓어진
// 뒤로는 모델이 업스트림 툴(dart-mcp 등)로 조회만 하고 텍스트로 답한 채
// athena__render_canvas를 건너뛸 수 있다 — 날것 질문만 넘긴 실사용에서 캔버스
// 0건이 실제로 났다. 허용 툴이 render_canvas 하나뿐이던 시절에는 프롬프트 없이도
// 캔버스가 그려졌지만 그건 선택지가 없어서였지 지시가 있어서가 아니었다.
//
// table 스키마 힌트를 함께 넣는 이유: S4 실왕복에서 스키마 없이는 모델이 table
// 형상을 맞추는 데 3회 걸렸다(plan.md "새로 열린 것" 11번 — 지연·토큰 3배).
//
// stream/reader 힌트는 backend/athena_mcp/canvas.py의 STREAM_SCHEMA/READER_SCHEMA를
// 그대로 옮겼다(2026-08-17 실측, canvas.py L34-68) — 필드명·필수여부가 다르면
// 게이트웨이(validate_canvas_payload)가 조용히 free로 폴백시키므로, table과 같은
// 이유로 여기 명시한다.
'use strict';

function buildLivePrompt(query) {
  return [
    '아래 사용자 질문에 답하라. 데이터 조회가 필요하면 연결된 MCP 툴을 호출하라.',
    '',
    '조회한 데이터는 반드시 athena__render_canvas 툴로 캔버스에 그린다:',
    '- 같은 필드가 반복되는 목록/표 데이터 → canvas_type "table",',
    '  data는 {"columns":[{"key":"...","label":"..."}, ...], "rows":[{키:값, ...}, ...]}',
    '- 시간순 뉴스/공시 등 목록 데이터 → canvas_type "stream",',
    '  data는 {"records":[{"ts":"...","ts_precision":"second|day","source":"...",',
    '  "title":"...","url":"...","summary":"...","tickers":["..."],"kind":"..."}, ...]}',
    '  (ts/ts_precision/source/title/url은 필수, summary/tickers/kind는 선택)',
    '- 장문 문서 1건(공시 원문 등) → canvas_type "reader",',
    '  data는 {"title":"...", "body_markdown":"...", "highlights":["..."]}',
    '  (title/body_markdown은 필수, highlights는 선택 — 인용할 요약 구간)',
    '- 표로 접기 어려운 구조 → canvas_type "free", data에 구조를 그대로 담는다',
    '- caption에 무엇의 데이터인지 한 줄로 적는다',
    '- 데이터 묶음이 여러 개면 캔버스를 여러 번 호출해도 된다',
    '캔버스를 그린 뒤 최종 텍스트 답변은 핵심 요약 3문장 이내로 끝낸다.',
    '데이터 조회가 필요 없는 질문(인사·설명 등)이면 캔버스 없이 짧게 답한다.',
    '',
    '사용자 질문:',
    String(query),
  ].join('\n');
}

module.exports = { buildLivePrompt };
