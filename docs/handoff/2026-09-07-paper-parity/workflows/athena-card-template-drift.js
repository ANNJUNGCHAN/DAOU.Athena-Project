export const meta = {
  name: 'athena-card-template-drift',
  description: 'For all 96 card boards with app templates, diff the live Paper board (JSX inline-styles + tree) against the stored extraction in backend/ref/card-surface-templates to find drift since the template was saved',
  phases: [{ title: 'Drift', detail: 'live Paper JSX/tree vs stored paper.jsx/paper.tree.txt per board' }],
}

const REPO = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const FILE = '01M0VGPX92K1TER4ZV9PWGQJJZ'

const SCHEMA = {
  type: 'object',
  properties: {
    board_id: { type: 'string' },
    board_name: { type: 'string' },
    saved_at: { type: 'string' },
    jsx_identical: { type: 'boolean' },
    tree_identical: { type: 'boolean' },
    jsx_diff_lines: { type: 'integer' },
    tree_diff_lines: { type: 'integer' },
    changed_texts: { type: 'array', items: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' }, node: { type: 'string' } }, required: ['before', 'after'] } },
    structural_changes: { type: 'string', description: '노드 추가/삭제/이동/치수 변경 요약 (없으면 "없음")' },
    style_only_changes: { type: 'string', description: '문구·구조는 같고 스타일 값만 다른 경우 요약 (없으면 "없음")' },
    error: { type: 'string' },
  },
  required: ['board_id', 'jsx_identical', 'tree_identical', 'jsx_diff_lines', 'tree_diff_lines', 'changed_texts', 'structural_changes', 'style_only_changes'],
}

const ids = Array.isArray(args) ? args : []
log(`카드 템플릿 드리프트 검사: ${ids.length}개 보드`)

const results = await pipeline(
  ids,
  (id) => agent(`당신은 기계적 대조 작업자다. Paper 보드 하나의 현재 원문을 앱 템플릿 추출본과 diff한다. 파일 수정 금지(스크래치 디렉터리 제외).

보드 ID: ${id}
Paper 파일 ID: ${FILE} (페이지 전환 금지 — open_file·get_screenshot 호출 금지. 노드 도구는 페이지를 열지 않아도 읽힌다.)
저장된 추출본: ${REPO}/backend/ref/card-surface-templates/${id}/paper.jsx (get_jsx format="inline-styles" 원문), paper.tree.txt (get_tree_summary depth=10 원문), meta.json (board_id·name·saved_at).

절차:
1. ToolSearch("select:mcp__paper__get_jsx,mcp__paper__get_tree_summary")로 도구를 로드한다.
2. mcp__paper__get_jsx(fileId="${FILE}", nodeId="${id}", format="inline-styles") 결과의 JSX 문자열을 Write 도구로 ${SP}/drift/${id}.live.jsx 에 그대로 저장한다(앞뒤 설명 없이 원문만). 결과가 JSON으로 감싸져 있으면 jsx 필드 값만 저장.
3. mcp__paper__get_tree_summary(fileId="${FILE}", nodeId="${id}", depth=10) 결과의 summary 문자열을 ${SP}/drift/${id}.live.tree.txt 에 저장한다.
4. Bash(Git Bash)로 diff한다. 공백·줄바꿈 차이는 무시한다:
   norm() { tr -d '\\r' | sed -e 's/[[:space:]]\\+/ /g' -e 's/^ //' -e 's/ $//' | grep -v '^$'; }
   diff <(norm < "${REPO}/backend/ref/card-surface-templates/${id}/paper.jsx") <(norm < "${SP}/drift/${id}.live.jsx") > "${SP}/drift/${id}.jsx.diff"; echo jsx_diff_lines=$(grep -c '^[<>]' "${SP}/drift/${id}.jsx.diff")
   diff <(norm < "${REPO}/backend/ref/card-surface-templates/${id}/paper.tree.txt") <(norm < "${SP}/drift/${id}.live.tree.txt") > "${SP}/drift/${id}.tree.diff"; echo tree_diff_lines=$(grep -c '^[<>]' "${SP}/drift/${id}.tree.diff")
   저장본의 첫 줄이 "(" 로 시작하는 등 래핑 차이만 있으면 그것은 차이로 세지 마라(래핑을 벗겨 다시 비교).
5. diff가 있으면 diff 파일을 읽고 분류하라: (a) 텍스트 노드 문구가 바뀐 것(before→after, 노드 ID), (b) 노드 추가/삭제/이동/치수 변경(구조), (c) 스타일 값만 바뀐 것. tree diff의 각 줄은 'Text "..." (ID) WxH "..."' 형태라 문구·치수 변화를 읽기 쉽다.
6. meta.json의 saved_at와 name을 함께 보고하라.
결과는 스키마대로만. 도구 오류가 나면 error 필드에 적고 identical=false, diff_lines=-1로 보고하라.`, { label: `drift:${id}`, phase: 'Drift', schema: SCHEMA, effort: 'low' }),
)

const valid = results.filter(Boolean)
const drifted = valid.filter((r) => !(r.jsx_identical && r.tree_identical))
const errored = valid.filter((r) => r.error)
log(`완료: ${valid.length}/${ids.length} 보드, 드리프트 ${drifted.length}건, 오류 ${errored.length}건`)
return {
  total: ids.length,
  checked: valid.length,
  identical: valid.filter((r) => r.jsx_identical && r.tree_identical).map((r) => r.board_id),
  drifted: drifted.map((r) => ({ board_id: r.board_id, board_name: r.board_name, saved_at: r.saved_at, jsx_diff_lines: r.jsx_diff_lines, tree_diff_lines: r.tree_diff_lines, changed_texts: r.changed_texts, structural_changes: r.structural_changes, style_only_changes: r.style_only_changes, error: r.error || '' })),
  missing: ids.filter((id) => !valid.find((r) => r.board_id === id)),
}