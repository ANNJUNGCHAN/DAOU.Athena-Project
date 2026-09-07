export const meta = {
  name: 'athena-paper-gates',
  description: 'Serially build the Paper full-coverage gates (ledger+manifest, cards static/mount, screens probe+ratchet, mini, task generator) in the gates worktree, review each commit, push to main',
  phases: [
    { title: 'Implement', detail: 'executor implements + tests + commits in gates worktree' },
    { title: 'Review', detail: 'independent reviewer; fix loop ≤2' },
    { title: 'Push', detail: 'merge origin/main if needed, push HEAD:main' },
  ],
}

const WT = 'C:/Projects/DAOU.Athena-gates'
const MAIN = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const TASKS = Array.isArray(args) ? args : []

const COMMON = `
## 공통 환경·규칙
- 작업 저장소(워크트리): ${WT} (브랜치 feat/paper-gates-2026-09-06, origin/main 기반). 모든 파일 경로·git 명령은 이 워크트리 기준 절대경로. ${MAIN}(주 체크아웃)과 C:/Projects/DAOU.Athena-parity(다른 트랙의 워크트리)는 절대 수정·커밋하지 마라.
- Node: Git Bash에서 export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH". 단위 전체: cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js (기준선 2787+). Electron 게이트: cd ${WT}/app && npm run <verify:...> (node_modules 정션, 백엔드 127.0.0.1:8010 떠 있음, 실주문 /api/v1/order/* 절대 금지). 다른 트랙이 같은 시간에 Electron 프로브를 돌릴 수 있다 — userData가 격리돼 있으니 그대로 진행하되 싱글 인스턴스 락 오류가 나면 30초 뒤 한 번 재시도한다. python: cd ${WT} && python scripts/<...>.py (backend/.venv 정션은 backend 패키지용: cd ${WT}/backend && .venv/Scripts/python -m pytest ...).
- 설계서: ${SP}/plan-paper-gates.md (전수 게이트 3종 설계, §7 구현 순서, §10 file:line 색인). 원장 원본: ${SP}/paper-ledger/. 참고 계획: ${SP}/plan-card-parity.md.
- Paper 원문이 필요하면 ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_node_info,mcp__paper__get_children,mcp__paper__find_nodes")로 로드하고 fileId="01M0VGPX92K1TER4ZV9PWGQJJZ"를 넘겨라. open_file·get_screenshot 금지.
- 코드 규칙(CLAUDE.md): 단순성 우선, 수술적 변경, 기존 스타일. TODO/스텁/test.skip/.only 금지. 게이트를 완화해 초록을 만들지 마라(§8 4번) — 빨간 보드는 리포트에 남기는 것이 이 트랙의 목적이다. 잠긴 계약: 키우미 얼굴 1종, 에이전트 #chatModeHead 숨김, body keep-all 금지, 실주문 금지, pre-push 60초 예산.
- 커밋 형식: 제목 "type(scope): 한국어 한 문장", 본문 2~5줄, 트레일러 Constraint/Rejected(있으면)/Confidence/Scope-risk, 빈 줄, "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>". git commit -F <파일>. git add 는 변경한 경로만(app/captures 산출물·정션 금지; backend/ref/paper-ledger 데이터는 커밋 대상). 절대 push 하지 마라.
`

const IMPL = { type: 'object', properties: { committed: { type: 'boolean' }, base_sha: { type: 'string' }, head_sha: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, gates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'ok', 'detail'] } }, blocked: { type: 'string' }, decisions: { type: 'string' } }, required: ['committed', 'base_sha', 'head_sha', 'commits', 'summary', 'tests', 'gates', 'blocked', 'decisions'] }
const REVIEW = { type: 'object', properties: { approved: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, detail: { type: 'string' } }, required: ['severity', 'file', 'detail'] } }, tests: { type: 'string' }, notes: { type: 'string' } }, required: ['approved', 'issues', 'tests', 'notes'] }
const PUSH = { type: 'object', properties: { pushed: { type: 'boolean' }, head: { type: 'string' }, main_synced: { type: 'boolean' }, detail: { type: 'string' } }, required: ['pushed', 'head', 'main_synced', 'detail'] }

function taskBlock(t) {
  return `## 작업 ${t.key} — ${t.title} (크기 ${t.size})
명세: ${t.spec}
주로 건드릴 파일: ${(t.files || []).join(', ')}
반드시 돌릴 게이트: ${(t.gates || []).join(', ')}`
}
function implPrompt(t) {
  return COMMON + `
${taskBlock(t)}

당신은 이 작업의 구현자다. 절차: (1) git -C ${WT} status --short 가 비어 있는지 확인(비어 있지 않으면 그대로 두고 blocked에 적어라), base_sha = HEAD. (2) 설계서 해당 절과 §10 색인의 코드를 열어 현재 줄을 실측한다. (3) 테스트 먼저, 구현, 명세의 게이트를 실제로 돌려 초록 확인(리포트 게이트는 빨간 보드 목록이 산출되는 것이 성공이다). (4) 커밋(여러 개 가능, 형식 준수). 끝에 status 가 비어 있어야 한다. (5) 불가능·결정 필요는 가능한 부분까지 커밋하고 blocked에 정확히. 반환 스키마대로.`
}
function reviewPrompt(t, impl) {
  return COMMON + `
${taskBlock(t)}

당신은 독립 검토자다. 커밋 ${impl.base_sha}..${impl.head_sha}(${impl.commits.join(', ')})를 검토하라. 구현자 요약: ${impl.summary} / 판단: ${impl.decisions} / 테스트: ${impl.tests} / 못 한 것: ${impl.blocked || '없음'}
git -C ${WT} diff ${impl.base_sha} ${impl.head_sha} 전체를 읽고: 설계서 충족 여부, 게이트 완화(거짓 초록) 여부, 규칙 위반, 스텁·TODO·skip·항상 참 단언, 회귀 위험, 커밋 형식. 단위 전체를 직접 돌리고 60초 내 게이트(verify:integrated-cards·verify:kiumi-cards·정적 스크립트)는 재실행해 확인. blocker/major 있으면 approved=false. 파일 수정 금지.`
}
function fixPrompt(t, impl, review) {
  return COMMON + `
${taskBlock(t)}

당신은 구현자다. 검토자가 승인하지 않았다. 지적을 고치고 새 커밋으로 남겨라(틀린 지적이면 decisions에 근거). 검토 메모: ${review.notes}
지적:
${review.issues.map((i) => `- [${i.severity}] ${i.file}${i.line ? ':' + i.line : ''} — ${i.detail}`).join('\n')}
base_sha = 현재 HEAD(${impl.head_sha}). 단위 전체·명세 게이트 재실행 후 커밋. 반환 스키마대로.`
}
function pushPrompt(t, impl) {
  return `당신은 푸시 담당이다. 파일을 수정하지 마라. export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH".
워크트리 ${WT}(브랜치 feat/paper-gates-2026-09-06) HEAD(${impl.head_sha}, 작업 ${t.key})를 origin/main 에 올린다. 절차: (1) status 비었는지 확인. (2) git -C ${WT} fetch origin. (3) origin/main 이 HEAD 조상이 아니면 git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main (충돌이면 pushed=false 와 파일 보고, 강제 해결 금지) 후 단위 전체 재실행. (4) git -C ${WT} push origin HEAD:main (pre-push 훅). 거부되면 로그를 detail에. (5) 성공 시 git -C ${MAIN} pull --ff-only (실패해도 pushed=true, main_synced=false). 반환 스키마대로.`
}

const results = []
for (const t of TASKS) {
  log(`▶ ${t.key} — ${t.title}`)
  let impl = await agent(implPrompt(t), { label: `impl:${t.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
  if (!impl) { results.push({ key: t.key, status: 'impl-failed' }); log(`✖ ${t.key}: 구현 에이전트 실패`); continue }
  if (!impl.committed) { results.push({ key: t.key, status: 'not-committed', blocked: impl.blocked, summary: impl.summary }); log(`✖ ${t.key}: 커밋 없음 — ${impl.blocked}`); continue }
  let review = null
  for (let round = 0; round < 3; round++) {
    review = await agent(reviewPrompt(t, impl), { label: `review:${t.key}`, phase: 'Review', schema: REVIEW, effort: 'high' })
    if (!review || review.approved) break
    log(`↺ ${t.key}: 검토 미승인 (${review.issues.length}건) — 수정 라운드 ${round + 1}`)
    if (round === 2) break
    const fixed = await agent(fixPrompt(t, impl, review), { label: `fix:${t.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
    if (!fixed) break
    impl = { ...fixed, base_sha: impl.base_sha, commits: [...impl.commits, ...fixed.commits], summary: fixed.summary || impl.summary }
  }
  const approved = !!(review && review.approved)
  const push = await agent(pushPrompt(t, impl), { label: `push:${t.key}`, phase: 'Push', schema: PUSH, effort: 'low' })
  results.push({ key: t.key, status: push && push.pushed ? (approved ? 'pushed' : 'pushed-with-open-issues') : 'push-failed', approved, commits: impl.commits, head: impl.head_sha, summary: impl.summary, blocked: impl.blocked, issues: review ? review.issues : [], push: push ? push.detail : 'push agent failed' })
  log(`${push && push.pushed ? '✔' : '✖'} ${t.key}: ${approved ? '승인' : '미승인'} · ${push ? push.detail.slice(0, 120) : ''}`)
}
return { done: results.filter((r) => r.status.startsWith('pushed')).length, total: TASKS.length, results }