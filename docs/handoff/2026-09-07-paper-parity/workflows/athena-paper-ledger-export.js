export const meta = {
  name: 'athena-paper-ledger-export',
  description: 'Export every Paper board (10 pages, ~444 boards) as a JSON ledger of text nodes and frame structure, so an app-side gate can verify all of Paper is implemented',
  phases: [{ title: 'Export', detail: 'one agent per page chunk: tree summary per board → JSON' }],
}

const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const FILE = '01M0VGPX92K1TER4ZV9PWGQJJZ'
const CHUNKS = Array.isArray(args) ? args : []

const SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'string' }, chunk: { type: 'string' },
    exported: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'object', properties: { board_id: { type: 'string' }, error: { type: 'string' } }, required: ['board_id', 'error'] } },
    text_counts: { type: 'array', items: { type: 'object', properties: { board_id: { type: 'string' }, texts: { type: 'integer' }, frames: { type: 'integer' } }, required: ['board_id', 'texts', 'frames'] } },
    notes: { type: 'string' },
  },
  required: ['page', 'chunk', 'exported', 'failed', 'text_counts', 'notes'],
}

const results = await pipeline(
  CHUNKS,
  (c) => agent(`당신은 Paper 원장 추출 작업자다. 파일을 수정하는 곳은 ${SP}/paper-ledger/ 아래뿐이다(저장소 C:/Projects/DAOU.Athena* 는 건드리지 마라).

Paper 파일 ID ${FILE}, 페이지 ${c.name}(pageId ${c.page}), 청크 ${c.chunk}. 보드 목록: ${c.ids.join(', ')}
${c.ids[0] === '__ENUMERATE__' ? `보드 목록은 직접 얻어라: mcp__paper__get_children(fileId, nodeId="root_node_${c.page}")는 100개에서 잘린다. 잘린 나머지는 get_children 결과의 worldX/worldY 격자(360×420 보드, x -500부터 440 간격, y 20부터 560 간격 등)를 근거로 template/*·mini/* 이름 규칙을 쓰는 find_nodes(fileId, nodeId="root_node_${c.page}", textValue="*")… 가 아니라, get_tree_summary(fileId, nodeId="root_node_${c.page}", depth=1)로 페이지 직계 자식 전부(203장 예상)를 한 번에 얻어라(depth 1은 자식 이름·ID·치수를 전부 돌려준다). 그 전체를 대상으로 한다.` : ''}

절차:
1. ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_node_info,mcp__paper__get_children")로 도구를 로드한다. 모든 호출에 fileId="${FILE}". open_file·get_screenshot·get_jsx 금지(get_jsx는 너무 크다; 다른 작업과 페이지 전환 충돌 금지).
2. 보드마다 get_tree_summary(nodeId=<보드ID>, depth=10)를 부른다. 결과 summary 문자열의 각 줄은 '  들여쓰기 + Component "name" (ID) WxH ["text"]' 형태다. 파이썬으로 파싱해 다음 JSON을 만든다:
   { "board_id", "page": "${c.page}", "page_name": "${c.name}", "name": <보드 이름>, "width", "height",
     "texts": [ { "id", "text", "path": [상위 프레임 이름들] } ... ]  // Text 노드의 실제 문구(따옴표 안 마지막 문자열). 잘린 문구(…)가 의심되면 get_node_info(nodeId)로 textContent 원문을 받아 대체한다 — Text 노드 전부에 대해 하라(수백 개면 배치로).
     "frames": [ { "id", "name", "component", "w", "h", "depth" } ... ],  // Text 외 노드
     "text_multiset": { <text>: count },
     "exported_at": "2026-09-05",
     "tree_summary_sha256": <summary 원문 해시> }
   저장: ${SP}/paper-ledger/${c.page}/<board_id>.json (UTF-8, ensure_ascii=False, indent 1). get_tree_summary 원문도 ${SP}/paper-ledger/${c.page}/<board_id>.tree.txt 로 저장한다.
3. depth=10으로도 "... N children" 절단이 남는 노드가 있으면 그 노드 ID로 get_tree_summary를 다시 불러 합친다(절단 0이 될 때까지).
4. 보드마다 texts 수·frames 수를 text_counts에 적고, 실패한 보드는 failed에 오류와 함께 적는다. 문구를 지어내거나 요약하지 마라 — 원문 그대로.
반환은 스키마대로.`, { label: `ledger:${c.name}-${c.chunk}`, phase: 'Export', schema: SCHEMA, effort: 'low' }),
)

const valid = results.filter(Boolean)
const exported = valid.reduce((n, r) => n + r.exported.length, 0)
const failed = valid.flatMap((r) => r.failed)
log(`원장 추출 완료: ${exported}장 성공, ${failed.length}장 실패`)
return { exported, failed, chunks: valid.map((r) => ({ page: r.page, chunk: r.chunk, exported: r.exported.length, failed: r.failed.length, notes: r.notes })), text_counts: valid.flatMap((r) => r.text_counts) }