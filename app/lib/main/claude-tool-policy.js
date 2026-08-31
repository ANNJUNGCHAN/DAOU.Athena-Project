'use strict';

const RENDER_CANVAS_ALLOWED_TOOL = 'mcp__athena__athena__render_canvas';
// `mcp__<서버명>` 형태는 그 서버의 모든 툴을 허용한다(Claude Code 권한 규칙 —
// MCP 툴 이름에는 와일드카드가 안 되고 서버 단위 접두만 된다).
// Task(서브에이전트, 2026-08-27 개방) — CLI 2.1.220 실측: tool_use 이름은
// "Task"가 아니라 "Agent"(v2.1.63 리네임, Task는 별칭)로 찍힌다. 허용목록은
// 프로세스 전체에 한 벌이라 서브에이전트도 이 목록을 그대로 물려받는다 —
// mcp__athena 조회(athena_search)는 부모와 동일하게 성공했고, 허용목록에 없는
// Write는 부모와 동일하게 거부됐다(권한 경계가 부모보다 넓어지지 않는다).
// Read·Glob(2026-08-27, 키우미 파일/폴더 첨부): 첨부는 경로 텍스트를 프롬프트에
// 싣는 방식이라 이 둘이 없으면 모델이 첨부된 경로를 읽을 수단 자체가 없다
// (Read=파일, Glob=폴더 내용 파악). 명시 허용 + 아래 차단 목록 제외 — 어느
// 권한 semantics에서든 첨부가 산다(병합 결정 2026-08-27 대화→main).
const GATEWAY_ALLOWED_TOOLS = 'mcp__athena,Task,Read,Glob';

// 보안 실측(#33, 2026-08-27) — --allowedTools는 화이트리스트가 아니라 "자동
// 승인 목록"이었다. 허용목록에 없어도 기본 허용되는 빌트인 툴을 전수 확인한
// 결과: Bash·Read·Glob·Grep·Edit·NotebookEdit는 허용목록 밖인데도 그대로
// 실행됐고, Write·WebFetch·WebSearch만 정상 거부됐다(claude-runner-baseline-
// tool-enum-probe 캡처). live-prompt.js가 모델에게 "Bash·파일 접근은 자동
// 거부된다"고 알리는 문구는 그래서 절반만 사실이었다.
// `--tools`로 빌트인 표면 자체를 좁히는 방법도 재검증했지만(ENABLE_TOOL_SEARCH=0
// 고정 이후라 위 2026-08-19 철회 사유가 이제는 안 통할 수도 있다고 보고 다시
// 시도) mcp__athena 카드 렌더 파이프라인이 그대로 깨졌다 — buildLivePrompt로
// 만든 실제 질의가 canvasResults:[] 로 2연속 재현됐다(claude-runner-canvas-
// regression 캡처, --tools 없이 동일 질의는 즉시 성공). 그래서 아래
// --disallowedTools로 이름 기반 차단을 택한다 — mcp__athena/Agent는 안
// 건드리고 실행류 빌트인만 막는다. 새 빌트인 툴이 추가되면 이 목록도 재검토해야
// 한다(이름 기반 차단이라 완전한 화이트리스트가 아니다).
// 병합 결정(2026-08-27 대화→main): 실측 9종 중 Read·Glob은 키우미 첨부(B4
// 사용자 확정)의 전제라 차단하지 않는다 — 나머지 7종만 명시 차단.
const DISALLOWED_EXECUTION_TOOLS = 'Bash,Write,Edit,NotebookEdit,Grep,WebFetch,WebSearch';

// 카드 랜딩 결함(2026-08-26 실측) — 오케스트레이션 셸이 사용자 설정 env로
// ENABLE_TOOL_SEARCH=1을 내보내면, 그 셸에서 띄운 이 앱의 `claude -p` 자식
// 프로세스가 그 값을 그대로 물려받아 MCP 툴을 지연 로딩(ToolSearch 경유)으로
// 돌린다. 지연 로딩 인덱서 자체가 `athena__render_canvas` 한 툴만 못 찾는
// 결함이 있었다(별도로 고침, server.py의 inputSchema 최상위 anyOf 제거) —
// 그런데 이 앱은 athena 게이트웨이가 노출하는 툴 수가 애초에 작아서 지연
// 로딩의 이득(토큰 절약)이 없고, 인덱서 결함 하나로 카드 렌더 툴 자체가
// 안 보이는 손실만 크다. 부모 셸에 뭐가 설정돼 있든 이 앱의 대화 세션은
// 항상 즉시 로딩으로 고정한다 — 일반 사용자는 이 env를 안 갖고 있어
// 지금까지 카드가 정상 떴었다(오케스트레이션/개발 셸에서만 재현됐다).
const DISABLE_TOOL_SEARCH_ENV = { ENABLE_TOOL_SEARCH: '0' };

module.exports = {
  RENDER_CANVAS_ALLOWED_TOOL,
  GATEWAY_ALLOWED_TOOLS,
  DISALLOWED_EXECUTION_TOOLS,
  DISABLE_TOOL_SEARCH_ENV,
};
