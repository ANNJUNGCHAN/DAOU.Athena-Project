export const meta = {
  name: 'athena-parity-fixes',
  description: 'Serially implement, review, and push to main the 22 parity/regression fix tasks in the fix worktree, one commit per task, review gate before each push',
  phases: [
    { title: 'Implement', detail: 'executor implements + tests + commits in worktree' },
    { title: 'Review', detail: 'independent reviewer checks the commit against the spec; fix loop ≤2' },
    { title: 'Push', detail: 'merge origin/main if needed, push HEAD:main, sync main checkout' },
  ],
}

const WT = 'C:/Projects/DAOU.Athena-parity'
const MAIN = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const TASKS = Array.isArray(args) ? args : []

const COMMON = `
## 공통 환경·규칙
- 작업 저장소(워크트리): ${WT} (브랜치 fix/paper-parity-2026-09-05, origin/main과 같은 선). 모든 파일 경로·git 명령은 이 워크트리 기준 절대경로로 쓴다. ${MAIN}(주 체크아웃)은 읽기 참고만 하고 절대 수정·커밋하지 마라(다른 세션이 쓴다).
- Node: Git Bash에서 export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH". 단위 전체: cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js (기준선 2787/2787). 개별: node --test lib/<파일>.test.js. Electron 게이트: cd ${WT}/app && npm run <verify:...> (node_modules는 정션, 백엔드 127.0.0.1:8010 떠 있음, 실주문 /api/v1/order/* 절대 금지, mockapi 하드락 유지). 백엔드 pytest: cd ${WT}/backend && .venv/Scripts/python -m pytest <파일> -q -p no:randomly. 저장소 게이트: cd ${WT} && node scripts/gates/check-{orb,glass-ladder,window-model,harness-freshness}.mjs.
- 설계 계획서: ${SP}/plan-card-parity.md (카드 트랙 §2~§9), ${SP}/plan-screen-p1.md (화면 항목 1~20, 군별 순서). 정합 판정 원본(보드별 Paper 원문·앱 근거): ${SP}/parity-findings.json 과 C:/Users/USER/AppData/Local/Temp/claude/C--Projects-DAOU-Athena/0d4f88d0-d946-436b-bc39-d4e63d8412f6/tasks/wjnizi90b.output (result.confirmed / result.boards, python으로 파싱해 필요한 항목만 읽어라). 코드 검수 확정 발견: tasks/w0aehvo05.output (result.confirmed, file/line/detail/evidence/fix/votes 의 correction 을 반드시 읽어라 — 검증자가 정정한 범위가 정본이다).
- Paper 원문이 필요하면 ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_node_info,mcp__paper__get_jsx,mcp__paper__find_nodes")로 로드하고 fileId="01M0VGPX92K1TER4ZV9PWGQJJZ"를 넘겨라. open_file·get_screenshot은 금지(다른 작업과 충돌).
- 코드 규칙(CLAUDE.md): 단순성 우선(요청 밖 기능·추상화·설정 금지), 수술적 변경(무관한 줄 건드리지 않기, 자기 변경이 만든 고아만 정리), 기존 스타일 유지. TODO/스텁/test.skip/.only 금지. 가짜 값·가짜 카운트 금지. 제품 문구 3원칙: 설명문 금지, 한국어 단위, 내부용어(recipe·AITS·fixture 등) 사용자 노출 금지. 잠긴 계약: 키우미 얼굴 1종, 에이전트 #chatModeHead 숨김, body에 word-break keep-all 금지, 설정 nav 라벨 「성향・이력」 유지, verify.js emptyHistory 부팅 계약, 실주문 금지.
- 사용자 지시: "카드는 Paper와 동일하게 그려야 한다" — Paper와 앱이 다를 때 문서화된 이탈이라도 Paper를 따른다(잠긴 계약 제외).
- 커밋 형식(저장소 관례): 제목 "type(scope): 한국어 한 문장" (fix/feat/test/chore/docs), 빈 줄, 본문 2~5줄(무엇을 왜, 검증 수치), 빈 줄, 트레일러 "Constraint: …" "Rejected: …"(있으면) "Confidence: high|medium|low" "Scope-risk: narrow|moderate|broad", 빈 줄, "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>". git commit -F <파일> 로 쓰고, 파일은 git add <경로> 로 변경한 것만 스테이징한다(app/captures 산출물·정션·스크래치 금지). 절대 push 하지 마라(푸시는 별도 단계가 한다).
`

const IMPL = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    base_sha: { type: 'string', description: '작업 시작 시 HEAD' },
    head_sha: { type: 'string', description: '커밋 후 HEAD' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    tests: { type: 'string', description: '돌린 테스트와 결과 수치' },
    gates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'ok', 'detail'] } },
    blocked: { type: 'string', description: '못 한 것과 이유(없으면 빈 문자열)' },
    decisions: { type: 'string', description: '구현 중 내린 판단' },
  },
  required: ['committed', 'base_sha', 'head_sha', 'commits', 'summary', 'tests', 'gates', 'blocked', 'decisions'],
}
const REVIEW = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, detail: { type: 'string' } }, required: ['severity', 'file', 'detail'] } },
    tests: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['approved', 'issues', 'tests', 'notes'],
}
const PUSH = {
  type: 'object',
  properties: { pushed: { type: 'boolean' }, head: { type: 'string' }, main_synced: { type: 'boolean' }, detail: { type: 'string' } },
  required: ['pushed', 'head', 'main_synced', 'detail'],
}

function taskBlock(t) {
  return `## 작업 ${t.key} — ${t.title} (크기 ${t.size})
명세: ${t.spec}
주로 건드릴 파일: ${(t.files || []).join(', ')}
반드시 돌릴 게이트: ${(t.gates || []).join(', ')} (unit = 단위 전체, verify:* = Electron 게이트 npm run, pytest:canvas_push = backend/tests/api/test_canvas_push.py, extract-check = python scripts/paper_board_extract.py <보드> --check + build_board_registry 재생성, none = 문서만)`
}

function implPrompt(t) {
  return COMMON + `
${taskBlock(t)}

당신은 이 작업의 구현자다. 절차:
1. git -C ${WT} status --short 가 비어 있는지 확인하고(비어 있지 않으면 그대로 두고 blocked에 적어라), base_sha = git -C ${WT} rev-parse HEAD.
2. 명세가 가리키는 계획서 절·판정 원본·검수 발견(정정 포함)을 읽고, 해당 코드를 열어 현재 줄 번호를 실측한다(계획서 줄번호는 낡았을 수 있다).
3. 구현한다. 단위 테스트를 먼저 추가/수정하고 실패를 확인한 뒤 코드를 고친다. 명세의 게이트를 실제로 돌려 초록을 확인한다(Electron 게이트는 한 번에 하나씩, 실패하면 원인을 고친다). 게이트가 환경 문제로 못 돌면 그 사실을 gates.detail 에 적는다.
4. 작업 단위가 자연스럽게 나뉘면 커밋을 여러 개로 쪼개도 된다(각각 형식 준수). 마지막에 git -C ${WT} status --short 가 비어 있어야 한다(산출물은 커밋하지 말고 git checkout/clean 하지도 마라 — app/captures 는 ignore 대상인지 git status로 확인).
5. 명세의 일부가 불가능하거나 설계 결정이 필요하면 가능한 부분까지 구현·커밋하고 나머지를 blocked 에 정확히 적는다. 스텁·가짜 구현으로 초록을 만들지 마라.
반환은 스키마대로.`
}

function reviewPrompt(t, impl) {
  return COMMON + `
${taskBlock(t)}

당신은 독립 검토자다. 구현자가 남긴 커밋(${impl.base_sha}..${impl.head_sha}, 커밋 ${impl.commits.join(', ')})을 검토하라. 구현자 요약: ${impl.summary}
구현자 판단: ${impl.decisions}
구현자 테스트: ${impl.tests}
구현자가 못 한 것: ${impl.blocked || '없음'}

절차: git -C ${WT} show --stat ${impl.base_sha}..${impl.head_sha} 와 git -C ${WT} diff ${impl.base_sha} ${impl.head_sha} 로 변경 전체를 읽는다. 검사 항목: (1) 명세·계획서·검수 정정을 충족하는가(과잉·과소 구현), (2) CLAUDE.md 규칙(단순성·수술적 변경·무관한 줄) 위반, (3) 스텁·TODO·test.skip·.only·가짜 값·항상 참인 단언, (4) 잠긴 계약 침해(키우미 얼굴 1종, 에이전트 헤더 숨김, body keep-all, nav 라벨, emptyHistory, 실주문 금지), (5) 제품 문구 3원칙, (6) 회귀 위험(호출자·다른 테스트), (7) 커밋 메시지 형식. 단위 전체를 직접 돌리고(node --test …), 명세의 Electron 게이트 중 60초 내 것(verify:semantic-workspaces·verify:hoga-live·verify:kiumi·verify:settings·verify:agent-paper-parity·verify:integrated-cards)은 직접 재실행해 초록을 확인한다(verify 메인 스위트는 구현자 결과를 믿되 로그가 있으면 읽는다). blocker/major가 하나라도 있으면 approved=false. 파일을 수정하지 마라.`
}

function fixPrompt(t, impl, review) {
  return COMMON + `
${taskBlock(t)}

당신은 구현자다. 검토자가 승인하지 않았다. 아래 지적을 고치고 새 커밋(형식 준수)으로 남겨라. 지적이 틀렸다고 판단되면 고치지 말고 decisions 에 근거를 적어라.
검토 메모: ${review.notes}
지적:
${review.issues.map((i) => `- [${i.severity}] ${i.file}${i.line ? ':' + i.line : ''} — ${i.detail}`).join('\n')}
이전 구현 요약: ${impl.summary}
절차: base_sha = 현재 HEAD(${impl.head_sha}). 고친 뒤 단위 전체와 명세 게이트를 다시 돌리고 커밋한다. 마지막에 status 가 비어 있어야 한다. 반환 스키마대로(head_sha 는 새 HEAD).`
}

function pushPrompt(t, impl) {
  return `당신은 푸시 담당이다. 파일을 수정하지 마라. Node PATH: export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH" (pre-push 훅이 node 를 쓴다).
워크트리 ${WT}(브랜치 fix/paper-parity-2026-09-05)의 HEAD(${impl.head_sha}, 작업 ${t.key})를 origin/main 에 올린다.
절차: (1) git -C ${WT} status --short 가 비어 있는지 확인(비어 있지 않으면 pushed=false 로 보고). (2) git -C ${WT} fetch origin. (3) origin/main 이 HEAD 의 조상이 아니면 git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main 으로 합치고(충돌이 나면 pushed=false 와 충돌 파일을 보고, 절대 강제 해결하지 마라) 단위 전체를 다시 돌려 초록을 확인한다. (4) git -C ${WT} push origin HEAD:main — pre-push 훅(게이트 4종 + 단위)이 돈다. 거부되면 원인(훅 실패 로그)을 detail 에 그대로 적는다. (5) 성공하면 git -C ${MAIN} pull --ff-only 로 주 체크아웃을 동기화한다(실패해도 pushed 는 true, main_synced=false 로 보고). 반환 스키마대로.`
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
    if (!review) break
    if (review.approved) break
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