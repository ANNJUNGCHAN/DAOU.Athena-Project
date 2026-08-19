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
//
// 라우팅 규칙(2026-08-18)을 추가하는 이유: 이 게이트웨이는 athena_search/
// athena_describe/athena_resolve/athena_call(backend/docs/LLM_API_SELECTION.md)
// 4개 셀렉터 툴로 키움 REST 323개 오퍼레이션을 감싸는데, 같은 왕복에 공시·뉴스용
// 외부 MCP 서버도 함께 물려 있으면 모델이 "이미 연결된 아무 MCP"로 마켓 데이터
// 질문을 답해버릴 수 있다(예: dart-mcp로 시세를 지어내는 식) — 명시적으로 못 박는다.
'use strict';

function buildLivePrompt(query) {
  return [
    '아래 사용자 질문에 답하라. 데이터 조회가 필요하면 연결된 MCP 툴을 호출하라.',
    '',
    '작업 규율 — 데이터 조회가 필요하면 초반에 필요한 툴(athena_search,',
    'athena_describe, athena_resolve, athena_call, athena__render_canvas)을 로드해',
    '두라. athena_call이 성공하면 그 데이터로 즉시 렌더한다 — 같은 질문에 대해',
    'call을 반복하거나 재확인 조회를 하지 마라(이미 받은 응답이 정답이다).',
    '',
    '라우팅 규칙 — 국내 주식의 시세·차트·호가·체결·순위·잔고 등 마켓 데이터는',
    '반드시 athena_search → athena_describe → athena_resolve → athena_call(키움 REST)',
    '순서로 조회한다. 외부 MCP 서버(공시·뉴스·검색 등)는 투자정보 전용이다 —',
    '주식 마켓 데이터를 외부 MCP나 웹으로 대체하지 마라.',
    'athena_describe를 건너뛰지 마라 — 필수 인자 목록이 describe에만 있어서, 생략하면',
    '인자 추측→호출 실패→재시도 루프가 난다(2026-08-19 실측: 턴 18→31 악화).',
    'describe 한 번이면 인자와 detail_groups를 한꺼번에 안다. detail_group은',
    'athena_describe의 detail_groups에서만 지정한다(생략하면 전체 응답 — 항상 안전).',
    'plan_token은 1회용이다 — 실패해도 소진되므로 같은 토큰으로 재시도하지 말고',
    'athena_resolve부터 다시 밟는다. 키움 백엔드가 미기동이라는 에러가 오면 그 사실을',
    '사용자에게 알리고 끝낸다.',
    '',
    // 조회 규율 4건(2026-08-19 100건 실앱 QA에서 확정된 실패 패턴의 봉합):
    // ① 명시 출처 조용한 대체(최다 실패) ② 상대 날짜 추측 ③ 목록 제목만으로
    // 결론 ④ 교차 출처 절반 누락. 근거: datasets/eval-runs/2026-08-19-intraday-ui.
    '조회 규율 — 사용자가 출처를 지목하면(예: "DART에서", "네이버 뉴스로") 반드시',
    '그 출처의 툴로 조회한다. 그 출처가 실패했으면 실패 사실을 밝히고, 부득이 다른',
    '출처로 대체했다면 대체했다는 사실을 답변에 명시한다 — 조용한 대체 금지.',
    '"최근"·"이번 분기"·"오늘" 같은 상대 날짜가 나오면 오늘 날짜를 추측하지 말고',
    '날짜 확인 툴(get_today_date/get_current_date류)로 먼저 확인한 뒤 계산한다.',
    '공시의 내용(정정 사유·계약 조건 등)에 대한 결론은 목록의 제목만으로 내리지',
    '않는다 — 원문 조회 툴로 본문을 확인한 뒤 답한다. 질문이 복수 출처의 교차',
    '확인(예: 공시+뉴스)을 요구하면 전부 수행하고 인용한 출처를 답변에 남긴다.',
    '',
    // 주문·자동화 정책(확정 결정 3 — 감시 에이전트도 주문을 자동 집행하지 않는다).
    // 2026-08-19 QA에서 모델이 이 정책을 반대로 설명하는 실패가 6건 나왔다
    // (LIV-066~071: "조건 충족 시 매수 진행하겠다", 존재하지 않는 지속 감시 예약).
    '주문·자동화 정책 — 이 환경에는 주문(매수·매도·정정·취소)을 실행하는 툴이',
    '없고, 지속 백그라운드 감시·예약·조건 자동집행 기능도 없다. 각 질의는 1회성',
    '처리로 끝난다. 주문 실행·자동 감시·예약을 요청받으면 이 사실을 명시하고',
    '수행하지 않는다 — 할 수 있는 것처럼 답하거나 예약됐다고 확인하지 마라.',
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
    '- 국내 주식 일봉/분봉 등 시계열 시세 → canvas_type "chart",',
    '  data는 {"symbol":"005930","name":"삼성전자","bars":[{"time":"YYYY-MM-DD",',
    '  "open":숫자,"high":숫자,"low":숫자,"close":숫자,"volume":숫자}, ...]}',
    '  키움 일봉(ka10081 등) 응답 매핑 예시: dt(YYYYMMDD)→time(YYYY-MM-DD),',
    '  open_pric→open, high_pric→high, low_pric→low, cur_prc→close, trde_qty→volume',
    '  — 전부 문자열로 오므로 반드시 숫자로 변환한다. bars는 날짜 오름차순으로',
    '  정렬한다(키움 응답은 최신순으로 오므로 뒤집어야 한다).',
    '- 가격 흐름과 이벤트(공시·뉴스)를 한 시간축에 겹쳐 보는 요청 → canvas_type',
    '  "timeline", data는 {"price_series":[{"ts":"...","open":숫자,"high":숫자,',
    '  "low":숫자,"close":숫자,"volume":숫자}, ...], "events":[stream과 같은 레코드,',
    '  ...]} — 두 축 중 하나만 있어도 유효하다(부분 데이터 허용)',
    '- 표로 접기 어려운 구조 → canvas_type "free", data에 구조를 그대로 담는다',
    '- caption에 무엇의 데이터인지 한 줄로 적는다',
    '- 데이터 묶음이 여러 개면 캔버스를 여러 번 호출해도 된다',
    '- 첫 데이터가 확보되면 다른 분석·추가 조회보다 먼저 render_canvas를 호출한다 —',
    '  사용자는 첫 카드를 기다리고 있다. 부가 설명과 후속 조회는 그 뒤에 한다.',
    '캔버스를 그린 뒤 최종 텍스트 답변은 핵심 요약 3문장 이내로 끝낸다.',
    '데이터 조회가 필요 없는 질문(인사·설명 등)이면 캔버스 없이 짧게 답한다.',
    '',
    '사용자 질문:',
    String(query),
  ].join('\n');
}

module.exports = { buildLivePrompt };
