export const meta = {
  name: 'athena-paper-implement-a',
  description: 'Paper 화면 보드 96장 라우트 저작·앱 보정, 계약 보드 12장 문서화, 후속 2건을 게이트 워크트리에서 묶음별로 구현→검토→푸시한다',
  phases: [
    { title: 'Implement', detail: '묶음별 라우트 저작 + 필요한 앱 보정 + 래칫 잠금 + 커밋' },
    { title: 'Review', detail: '독립 검토자가 공허 통과·가짜 구현·Paper 이탈을 잡는다; 수정 ≤2회' },
    { title: 'Push', detail: 'origin/main 병합 후 HEAD:main 푸시, 주 체크아웃 동기화' },
  ],
}

const WT = 'C:/Projects/DAOU.Athena-parity'
const MAIN = 'C:/Projects/DAOU.Athena'
const SP = 'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
const BATCHES = Array.isArray(args) ? args : []

const COMMON = `
## 공통 환경·규칙
- 작업 저장소(워크트리): ${WT} (브랜치 fix/paper-parity-2026-09-05, origin/main과 같은 선). 모든 파일 경로·git 명령은 이 워크트리 기준 절대경로로 쓴다. ${MAIN}(주 체크아웃)과 C:/Projects/DAOU.Athena-gates(다른 구현 트랙이 동시에 쓰는 워크트리)는 절대 수정·커밋하지 마라.
- 다른 트랙이 origin/main 에 계속 푸시한다. 작업 시작 전에 반드시 git -C ${WT} fetch origin && git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main 으로 최신을 받는다(충돌 나면 강제 해결하지 말고 blocked 에 적는다).
- Node: Git Bash에서 export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH". 단위 전체: cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js. 개별: node --test lib/<파일>.test.js. Electron 게이트: cd ${WT}/app && npm run <verify:...> (node_modules는 정션, 백엔드 127.0.0.1:8010 떠 있음, 실주문 /api/v1/order/* 절대 금지, mockapi 하드락 유지). 저장소 게이트: cd ${WT} && node scripts/gates/check-{orb,glass-ladder,window-model,harness-freshness,paper-routes}.mjs (반드시 저장소 루트에서).
- Paper 전수 게이트(설계서 ${SP}/plan-paper-gates.md §4): 화면 보드는 app/lib/paper-screen-routes.js 의 ROUTES 에 도달 절차(reach)·root·phrases(3~7, 원장 texts 에 실재, E1~E7 하드 제외 규칙 통과)·structure(count/order/absent) 를 적어야 통과한다. 파일 머리 주석(가시 텍스트 판정·fixture 결정론·phrases 규칙·structure 세 종류)이 저작 규칙의 정본이니 반드시 먼저 읽어라. 러너는 app/probe-paper-screens.js, 판정·리포트는 app/lib/paper-screens-report.js, 정적 린트는 scripts/gates/check-paper-routes.mjs 와 app/lib/paper-screen-routes.test.js. 실행: cd ${WT}/app && npm run verify:paper-screens -- --only <id1>,<id2> (한 묶음), npm run verify:paper-screens -- --bless (전수 12초, 통과 집합을 app/lib/paper-screens-ratchet.json 에 잠근다; 집합이 줄면 exit 1 — 절대 --allow-shrink 로 넘기지 말고 줄어든 원인을 고쳐라). 리포트: app/captures/paper-gates/PAPER-SCREENS.json (ignore 대상, 커밋 금지).
- 보드 원장: backend/ref/paper-ledger/<page>/<board>.json (texts·frames·text_multiset) + <board>.tree.txt (Paper 트리). 문구 후보: app/lib/paper-screen-phrases.generated.js (PHRASES[board].phrases). 매니페스트: backend/ref/paper-ledger/manifest.json. Paper 원문이 더 필요하면 ToolSearch("select:mcp__paper__get_tree_summary,mcp__paper__get_node_info,mcp__paper__get_jsx,mcp__paper__find_nodes")로 로드하고 fileId="01M0VGPX92K1TER4ZV9PWGQJJZ" 를 넘겨라(open_file·get_screenshot 금지 — 서버가 안 붙으면 원장으로만 작업).
- 사용자 지시: "모든 Paper 보드가 전부 구현되어야 한다" 그리고 "Paper와 동일하게" — Paper 가 정본이다. 앱이 Paper 와 다르면(문구·요소·상태) 잠긴 계약을 빼고 앱을 Paper 쪽으로 고친다. 라우트를 앱에 맞춰 느슨하게 적어 초록을 만드는 것은 거짓말이다(파일 머리 주석 「Paper와 앱이 실제로 어긋나는 자리에는 아무 것도 적지 않았다」).
- 잠긴 계약(Paper 보다 우선): 키우미 얼굴 1종, 에이전트 #chatModeHead 숨김, body에 word-break keep-all 금지, 설정 nav 라벨 「성향・이력」 유지, verify.js emptyHistory 부팅 계약, 실주문 금지, pre-push 60초 예산.
- 코드 규칙(CLAUDE.md): 단순성 우선(요청 밖 기능·추상화·설정 금지), 수술적 변경(무관한 줄 건드리지 않기), 기존 스타일 유지. TODO/스텁/test.skip/.only 금지. 가짜 값·가짜 카운트·문구만 박아 넣은 빈 껍데기 화면 금지. 제품 문구 3원칙: 설명문 금지, 한국어 단위, 내부용어(recipe·AITS·fixture·TR id 등) 사용자 노출 금지.
- 커밋 형식(저장소 관례): 제목 "type(scope): 한국어 한 문장" (fix/feat/test/chore/docs), 빈 줄, 본문 2~5줄(무엇을 왜, 검증 수치), 빈 줄, 트레일러 "Constraint: …" "Rejected: …"(있으면) "Confidence: high|medium|low" "Scope-risk: narrow|moderate|broad", 빈 줄, "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>". git commit -F <파일> 로 쓰고, git add <경로> 로 변경한 것만 스테이징한다(app/captures 산출물·정션·스크래치 금지). 절대 push 하지 마라(푸시는 별도 단계가 한다).
`

const IMPL = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    base_sha: { type: 'string' },
    head_sha: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    tests: { type: 'string', description: '돌린 테스트·게이트와 결과 수치' },
    blessed: { type: 'boolean', description: '전수 --bless 로 래칫을 갱신해 커밋했는가' },
    ratchet_count: { type: 'integer', description: '래칫 passing_count (갱신 후)' },
    boards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          board: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'gap', 'fail'] },
          detail: { type: 'string', description: 'pass: 라우트 요지와 앱 보정 유무 / gap: 앱에 없는 것 / fail: 왜 못 맞췄나' },
          gap_files: { type: 'array', items: { type: 'string' } },
          gap_size: { type: 'string', enum: ['S', 'M', 'L', ''] },
        },
        required: ['board', 'status', 'detail', 'gap_files', 'gap_size'],
      },
    },
    blocked: { type: 'string' },
    decisions: { type: 'string' },
  },
  required: ['committed', 'base_sha', 'head_sha', 'commits', 'summary', 'tests', 'blessed', 'ratchet_count', 'boards', 'blocked', 'decisions'],
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

function batchBlock(b) {
  if (b.kind === 'followup') {
    return `## 작업 ${b.key} — ${b.title}
명세: ${b.spec}
주로 건드릴 파일: ${(b.files || []).join(', ')}
반드시 돌릴 게이트: ${(b.gates || []).join(', ')}`
  }
  if (b.kind === 'contract') {
    return `## 작업 ${b.key} — ${b.title}
대상 계약 보드(F-1 페이지, role=contract) ${b.boards.length}장: ${b.boards.map((x) => `${x.id}(${x.name})`).join(' · ')}
판정 방식(설계서 §4.6, app/lib/paper-screens-report.js contractRecord): 원장 texts 에서 계약 문장(contractSentences)을 뽑아 docs/ui/paper-card-surface-charter.md 와 docs/architecture/*.md 에 그 문장이 그대로 있는지 문자열로 잰다. contract_undocumented = 문장이 문서에 없다, contract_no_sentence = 뽑힌 문장이 0개.
할 일: (1) 리포트 PAPER-SCREENS.json 의 F-1 항목에서 보드별 미문서 문장을 읽는다. (2) 각 보드가 어떤 카드·계약(CC-0X, DV-N, RX-1)을 규정하는지 원장·Paper 트리로 이해하고, docs/architecture 아래 적절한 문서(있으면 기존 카드 계약 문서, 없으면 docs/architecture/paper-contracts.md 신설)에 보드별 절을 두어 계약 문장을 **그대로**(한 글자도 바꾸지 않고) 옮기고, 그 문장이 코드 어디에 어떻게 구현돼 있는지(파일:줄) 혹은 아직 구현되지 않았는지를 사실대로 적는다 — 구현 안 된 계약을 구현됐다고 쓰지 마라. (3) contract_no_sentence 2장(1XA2-0, 2DZE-0)은 원장 texts 를 보고 왜 문장이 안 뽑혔는지(추출 규칙 E1~E7 이 계약 문장을 걸렀는지, 보드에 문장형 텍스트가 정말 없는지) 밝힌다. 규칙이 잘못 걸렀다면 scripts/paper-phrases.mjs / contractSentences 규칙을 고치고 단위 테스트를 갱신한다; 정말 문장이 없다면 보드 role 이 contract 가 맞는지(reference 가 맞다면 manifest 의 role 을 why 와 함께 바꾼다) 판단하되 판정 코드를 완화하지 마라. (4) 문서 안의 계약이 코드와 어긋나는 것을 발견하면 그 자리에서 고치지 말고 boards[].detail 에 적어라(카드 계약은 다른 트랙이 손보는 중이다). (5) npm run verify:paper-screens -- --only <12개 id> 로 통과를 확인하고 전수 --bless 로 래칫에 잠근다.`
  }
  if (b.kind === 'feature' || b.kind === 'reclass' || b.kind === 'cards') {
    return `## 작업 ${b.key} — ${b.title}
대상 보드 ${b.boards.length}장: ${b.boards.map((x) => `${x.id}(${x.name})`).join(' · ')}
${b.spec}
이전 회차 실측 기록(이 보드를 gap 으로 남긴 구현자의 기록 — 먼저 읽어라): ${SP}/gaps-screens-annotated.json 과 ${SP}/gaps-cards.json 의 해당 board 항목.
주로 건드릴 파일: ${(b.files || []).join(', ')}
반드시 돌릴 게이트: ${(b.gates || []).join(', ')}`
  }
  return `## 작업 ${b.key} — ${b.title}
대상 화면 보드(${b.page} 페이지) ${b.boards.length}장: ${b.boards.map((x) => `${x.id}(${x.name})`).join(' · ')}
현재 판정: 전부 route_missing(라우트표에 없음). 목표: 각 보드가 npm run verify:paper-screens -- --only <id> 에서 pass 가 되게 라우트를 저작하고, Paper 와 앱이 어긋난 곳은 앱을 Paper 쪽으로 고친다.
${b.note ? '묶음 메모: ' + b.note : ''}`
}

function implPrompt(b) {
  const featureProc = `당신은 이 작업의 구현자다. 사용자 지시는 「Paper 에 있는 것은 전부 구현되어야 한다」이고, 이 보드는 이전 회차에 「앱에 화면·기능이 없다」로 남겨진 것이다. 이번에는 스텁이 아니라 실제 기능을 구현한다. 절차:
1. 최신 병합 후 git -C ${WT} status --short 가 비어 있는지 확인, base_sha 기록. 이전 기록(gap detail)·원장 texts·frames·Paper 트리(.tree.txt)를 읽어 Paper 가 그린 화면의 요소·상태·문구·동작을 목록으로 뽑는다. Paper MCP 가 붙으면 get_jsx 로 원문 레이아웃을 본다.
2. 앱의 기존 구조(같은 모드의 캔버스·렌더러·IPC·백엔드 라우터)를 실측하고, 그 구조 위에 Paper 화면을 세운다 — 백엔드 엔드포인트·상태·저장이 필요하면 backend/athena_api 에 만들고 pytest 를 붙인다(cd ${WT}/backend && .venv/Scripts/python -m pytest <파일> -q -p no:randomly). 값은 실데이터·fixture 경로에서만 오게 하고 가짜 값·가짜 카운트를 그리지 않는다(값이 없으면 빈 상태를 정직하게). 제품 문구 3원칙·잠긴 계약·실주문 금지·mock 하드락 유지. 기존 프로브(verify*.js)의 단언이 깨지면 새 계약에 맞춰 갱신하되 완화하지 않는다.
3. 단위 테스트(순수 함수·상태 머신)를 먼저 쓰고 구현한다. 구현이 서면 app/lib/paper-screen-routes.js 에 라우트를 저작해(reach 결정론·phrases 3~7·structure) npm run verify:paper-screens -- --only <id> 로 pass 를 확인하고, 관련 Electron 게이트(그 표면의 verify:*)와 단위 전체를 돌린다. 마지막에 npm run verify:paper-screens -- --bless 로 래칫을 올려 커밋에 포함한다(줄면 원인을 고친다).
4. Paper 가 그린 것 중 이번 구현으로도 못 세운 조각이 있으면 라우트에 적지 말고 boards[].detail 에 정확히 남긴다. 명세 일부가 Paper 대 Paper 충돌·잠긴 계약 충돌이면 그 부분만 gap 으로 남기고 근거를 적는다.
5. 커밋은 백엔드/프론트/라우트·래칫 단위로 나눈다. git status 가 비어 있어야 한다. boards[] 에 pass/gap/fail 과 detail.`
  const procedure = b.kind === 'feature' || b.kind === 'reclass' || b.kind === 'cards' ? featureProc : b.kind === 'followup'
    ? `당신은 이 작업의 구현자다. 절차: (1) 최신 병합 후 git -C ${WT} status --short 가 비어 있는지 확인, base_sha 기록. (2) 명세대로 원인을 실측하고 고친다(단위 테스트 먼저). (3) 명세 게이트를 실제로 돌려 초록을 확인한다. (4) 커밋(형식 준수), status 비어 있어야 한다. boards 는 빈 배열, blessed=false, ratchet_count 는 현재 래칫 값을 적는다.`
    : b.kind === 'contract'
      ? `당신은 이 작업의 구현자다. 절차: (1) 최신 병합 후 git -C ${WT} status --short 가 비어 있는지 확인, base_sha 기록. (2) 위 「할 일」을 수행한다. (3) 단위 전체 + node scripts/gates/check-paper-routes.mjs + npm run verify:paper-screens -- --bless 를 돌려 초록·래칫 증가를 확인하고 래칫 파일을 같이 커밋한다. (4) 커밋(형식 준수, 문서와 코드 변경이 있으면 커밋을 나눈다), status 비어 있어야 한다. boards[] 에 12장 각각 pass/gap/fail 을 적는다.`
      : `당신은 이 작업의 구현자다. 절차:
1. 최신 병합(위 규칙) 후 git -C ${WT} status --short 가 비어 있는지 확인하고 base_sha = git rev-parse HEAD. app/lib/paper-screen-routes.js 머리 주석과 기존 라우트 8장, app/probe-paper-screens.js 의 reach 실행부, scripts/gates/check-paper-routes.mjs, app/lib/paper-screen-routes.test.js 를 읽어 저작 규칙과 린트를 정확히 안다.
2. 보드마다: 원장 JSON 의 texts·frames 와 PHRASES 후보를 읽고, 그 보드가 그리는 화면·상태가 앱 어디에 있는지 찾는다(문구 리터럴 grep: app/shell.html, app/orb.html, app/*.js, app/lib/**). 그 상태를 결정론적으로 만드는 reach(모드 클릭·설정/시트 열기·ipc-fixture·envelope·command-bar·wait·settle, 마지막 수단 eval+why)를 적고, root·phrases(원장에 실재하는 사용자 노출 라벨·제목·버튼·안내문 3~7개, 데이터 값 금지)·structure(그 보드의 탭·행·버튼 개수나 차례, Paper 가 그린 그대로)를 적는다. 
3. 앱이 Paper 와 다를 때: (a) 문구가 다르다 → 앱 문구를 Paper 로 고친다(제품 문구 3원칙·잠긴 계약 안에서; 그 문구를 단언하는 기존 프로브·테스트도 같이 갱신). (b) 요소·상태가 없거나 도달이 결정론적이지 않다 → 작게 구현하거나 fixture 통로를 만든다(예: 부팅 단계 보드는 부팅 시퀀스를 특정 단계에 멈추는 검사용 훅이 필요할 수 있다 — 검사 전용 통로는 ATHENA_* 환경변수나 IPC fixture 처럼 기존 프로브 관례를 따르고 제품 표면엔 드러내지 않는다). (c) 화면·기능 자체가 앱에 없어 ~300줄을 넘는 새 구현이 필요하다 → 스텁·껍데기로 초록을 만들지 말고 status=gap 으로 남긴다: detail 에 Paper 가 그린 것(텍스트·프레임 요지)과 앱에 없는 것, gap_files 에 손대야 할 파일, gap_size 에 S/M/L. gap 보드는 라우트를 넣지 않는다(존재하지 않는 셀렉터·문구는 린트가 거절한다).
4. 원장 texts 에 허용 문구가 3개 미만인 보드(예: 부팅 단계 보드는 'ATHENA' 와 '|' 뿐)는 paper-screen-routes.test.js 의 3개 하한을 그 보드에 한해 사유와 함께 예외 처리하되, 그 라우트는 structure 를 2개 이상 실어 공허 통과를 막는다. 상한 7과 중복 금지는 그대로.
5. 묶음 전체를 npm run verify:paper-screens -- --only <id,...> 로 돌려 pass 를 확인하고, 단위 전체·node scripts/gates/check-paper-routes.mjs·앱을 고쳤다면 그 표면의 기존 Electron 게이트(예: 설정이면 verify:settings-cards, 오브면 verify:kiumi, 에이전트면 verify:agent-paper-parity, 그래프면 verify:graph-mode, 셸이면 verify)를 돌려 회귀가 없음을 확인한다. 마지막으로 npm run verify:paper-screens -- --bless 를 돌려 래칫이 늘어난 것을 확인하고(줄면 원인을 고친다) app/lib/paper-screens-ratchet.json 을 커밋에 포함한다.
6. 커밋은 자연스러운 단위로 나눈다(라우트 저작 / 앱 보정 / 래칫). git -C ${WT} status --short 가 비어 있어야 한다. boards[] 에 보드마다 pass/gap/fail 과 detail 을 적는다.`
  return COMMON + `
${batchBlock(b)}

${procedure}
반환은 스키마대로.`
}

function reviewPrompt(b, impl) {
  return COMMON + `
${batchBlock(b)}

당신은 독립 검토자다. 구현자가 남긴 커밋(${impl.base_sha}..${impl.head_sha}, 커밋 ${impl.commits.join(', ')})을 검토하라.
구현자 요약: ${impl.summary}
구현자 판단: ${impl.decisions}
구현자 테스트: ${impl.tests}
보드별 결과: ${JSON.stringify(impl.boards)}
구현자가 못 한 것: ${impl.blocked || '없음'}

절차: git -C ${WT} show --stat ${impl.base_sha}..${impl.head_sha} 와 git -C ${WT} diff ${impl.base_sha} ${impl.head_sha} 로 변경 전체를 읽는다. 검사 항목: (1) 공허 통과 — 라우트의 phrases 가 reach 없이도 늘 DOM 에 보이는 정적 문구뿐이거나, structure 가 없거나 Paper 와 무관한가(각 라우트에 대해 reach 를 뺐을 때도 통과할지 판단하라). (2) 라우트가 앱에 맞춰 Paper 를 배신했는가 — 원장 texts/frames 와 대조해 Paper 가 그린 요소·문구가 앱에 없는데도 라우트가 그것을 비켜 갔는지. (3) 앱 보정이 Paper 정본·제품 문구 3원칙·잠긴 계약을 지키는가, 스텁·가짜 값·검사용 통로의 제품 노출이 없는가. (4) gap 판정이 타당한가 — 실제로는 작은 보정으로 통과시킬 수 있는데 gap 으로 미뤘는지, 또는 억지로 통과시켰는지. (5) CLAUDE.md 규칙(단순성·수술적 변경) 위반, 기존 프로브·테스트 회귀. (6) 커밋 메시지 형식, 래칫 파일이 커밋에 포함됐고 passing 집합이 줄지 않았는가. 직접 재실행: 단위 전체, node scripts/gates/check-paper-routes.mjs, npm run verify:paper-screens -- --only <이 묶음 id들> (계약 묶음이면 --only 12개), 앱을 고친 표면의 Electron 게이트 중 60초 내 것. blocker/major 가 하나라도 있으면 approved=false. 파일을 수정하지 마라.`
}

function fixPrompt(b, impl, review) {
  return COMMON + `
${batchBlock(b)}

당신은 구현자다. 검토자가 승인하지 않았다. 아래 지적을 고치고 새 커밋(형식 준수)으로 남겨라. 지적이 틀렸다고 판단되면 고치지 말고 decisions 에 근거를 적어라.
검토 메모: ${review.notes}
지적:
${review.issues.map((i) => `- [${i.severity}] ${i.file}${i.line ? ':' + i.line : ''} — ${i.detail}`).join('\n')}
이전 구현 요약: ${impl.summary}
이전 보드별 결과: ${JSON.stringify(impl.boards)}
절차: base_sha = 현재 HEAD(${impl.head_sha}). 고친 뒤 단위 전체·check-paper-routes·해당 --only·전수 --bless 를 다시 돌리고 커밋한다. 마지막에 status 가 비어 있어야 한다. 반환 스키마대로(head_sha 는 새 HEAD, boards 는 갱신된 전체).`
}

function pushPrompt(b, impl) {
  return `당신은 푸시 담당이다. 파일을 수정하지 마라. Node PATH: export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH" (pre-push 훅이 node 를 쓴다).
워크트리 ${WT}(브랜치 fix/paper-parity-2026-09-05)의 HEAD(${impl.head_sha}, 작업 ${b.key})를 origin/main 에 올린다.
절차: (1) git -C ${WT} status --short 가 비어 있는지 확인(비어 있지 않으면 pushed=false 로 보고). (2) git -C ${WT} fetch origin. (3) origin/main 이 HEAD 의 조상이 아니면 git -C ${WT} merge -X ignore-cr-at-eol --no-edit origin/main 으로 합치고(충돌이 난 파일이 app/lib/paper-screens-ratchet.json 하나뿐이면 예외로 이렇게 푼다: git -C ${WT} checkout --theirs app/lib/paper-screens-ratchet.json && cd ${WT}/app && npm run verify:paper-screens -- --bless 로 실제 통과 집합을 다시 잠근 뒤 git add 하고 병합 커밋을 마무리한다 — 이 파일은 실제 라우트에서 재계산되는 파생물이라 안전하다. 그 밖의 파일이 충돌하면 pushed=false 와 충돌 파일을 보고하고 절대 강제 해결하지 마라) cd ${WT}/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js 로 초록을 확인한다. (4) git -C ${WT} push origin HEAD:main — pre-push 훅(게이트 + 단위)이 돈다. 거부되면 원인(훅 실패 로그)을 detail 에 그대로 적는다. (5) 성공하면 git -C ${MAIN} pull --ff-only 로 주 체크아웃을 동기화한다(실패해도 pushed 는 true, main_synced=false 로 보고). 반환 스키마대로.`
}

const results = []
for (const b of BATCHES) {
  log(`▶ ${b.key} — ${b.title}`)
  let impl = await agent(implPrompt(b), { label: `impl:${b.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
  if (!impl) { results.push({ key: b.key, status: 'impl-failed' }); log(`✖ ${b.key}: 구현 에이전트 실패`); continue }
  if (!impl.committed) { results.push({ key: b.key, status: 'not-committed', blocked: impl.blocked, summary: impl.summary, boards: impl.boards }); log(`✖ ${b.key}: 커밋 없음 — ${impl.blocked}`); continue }
  let review = null
  for (let round = 0; round < 3; round++) {
    review = await agent(reviewPrompt(b, impl), { label: `review:${b.key}`, phase: 'Review', schema: REVIEW, effort: 'high' })
    if (!review) break
    if (review.approved) break
    log(`↺ ${b.key}: 검토 미승인 (${review.issues.length}건) — 수정 라운드 ${round + 1}`)
    if (round === 2) break
    const fixed = await agent(fixPrompt(b, impl, review), { label: `fix:${b.key}`, phase: 'Implement', schema: IMPL, effort: 'high' })
    if (!fixed) break
    impl = { ...fixed, base_sha: impl.base_sha, commits: [...impl.commits, ...fixed.commits], summary: fixed.summary || impl.summary }
  }
  const approved = !!(review && review.approved)
  const push = await agent(pushPrompt(b, impl), { label: `push:${b.key}`, phase: 'Push', schema: PUSH, effort: 'low' })
  const passed = (impl.boards || []).filter((x) => x.status === 'pass').length
  const gaps = (impl.boards || []).filter((x) => x.status === 'gap')
  results.push({ key: b.key, status: push && push.pushed ? (approved ? 'pushed' : 'pushed-with-open-issues') : 'push-failed', approved, commits: impl.commits, head: impl.head_sha, summary: impl.summary, ratchet_count: impl.ratchet_count, boards: impl.boards, blocked: impl.blocked, issues: review ? review.issues : [], push: push ? push.detail : 'push agent failed' })
  log(`${push && push.pushed ? '✔' : '✖'} ${b.key}: ${approved ? '승인' : '미승인'} · 통과 ${passed}/${(impl.boards || []).length} · 공백 ${gaps.length} · 래칫 ${impl.ratchet_count}`)
}
const allBoards = results.flatMap((r) => r.boards || [])
return {
  done: results.filter((r) => r.status.startsWith('pushed')).length,
  total: BATCHES.length,
  boards_pass: allBoards.filter((x) => x.status === 'pass').length,
  boards_gap: allBoards.filter((x) => x.status === 'gap'),
  boards_fail: allBoards.filter((x) => x.status === 'fail'),
  results,
}