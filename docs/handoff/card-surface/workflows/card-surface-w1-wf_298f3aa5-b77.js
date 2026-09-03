export const meta = {
  name: 'card-surface-w1',
  description: '카드 표면 구현 웨이브 1 — Paper 원문 저장(96장) ∥ 추출기·반응형 변환기 ∥ 백엔드 surface_contract ∥ 프론트 탭 뷰포트·board-mount·반응형 CSS ∥ 현황판',
  phases: [
    { title: '원문 저장 + 기반 구축', detail: '24 저장 레인 ∥ A 추출기 ∥ B 백엔드 ∥ C 프론트 ∥ D 현황판' },
    { title: '기반 게이트', detail: '저장 96장 확인 · 추출기 실행 · 테스트' },
  ],
}

const ROOT = 'C:\\Projects\\DAOU.Athena'
const TPL = ROOT + '\\backend\\ref\\card-surface-templates'
const PLAN1 = ROOT + '\\docs\\architecture\\card-surface-implementation-plan.md'
const PLAN2 = ROOT + '\\docs\\architecture\\canvas-tabs-responsive-plan.md'
const CHARTER = ROOT + '\\docs\\ui\\paper-card-surface-charter.md'
const FILE = '01M0VGPX92K1TER4ZV9PWGQJJZ'

const BOARDS = {
  'CC-01': ['133H-2','2SCE-1','2SKU-1','2SRV-1','2SYW-1','3GRO-0','3IGR-0','3LGC-0','3MTJ-0','3NVG-0','3K7K-0','3ODO-0','3OIM-0','3UTA-0'],
  'CC-02': ['135M-2','2T63-1','2TAG-1','2TET-1','2TJ6-1','2TNJ-1'],
  'CC-03': ['137X-2','2R3M-1','2RBO-1','2RJ7-1','3FR6-0','3DI2-0','32S7-0','32XM-0','15N5-2','15P5-2','3DZ1-0','2VDA-0','2YXS-0','2ZHC-0','2ZZ7-0','30C1-0','30O1-0','30ZW-0','316O-0','31II-0','3TCO-0','31UD-0','2VIN-0','2WZK-0','2VO0-0','2XA5-0','2XY6-0','2Y47-0','2Z49-0','3TOM-0','2ZN9-0'],
  'CC-04': ['13BC-2','2TRW-1','3JZ3-0','1JPU-0','3N4O-0','1JZW-0','2QRP-1','3JT4-0','2QX1-1'],
  'CC-05': ['2QFO-2','2QM7-2','2ROJ-1','2RWK-1','2S4E-1','2V71-0','2YS8-0','2ZBB-0','2ZTA-0','3063-0','30HY-0','30TY-0','31CL-0','31OF-0','1WOB-1'],
  'CC-06': ['13K0-2','2X5N-0','2XG6-0','2XKO-0','2XP6-0','2XTO-0','2YA8-0','2YEQ-0','2YJ8-0','2YNQ-0','2TZN-1','3BQB-0','2U5L-1','3D4I-0','3EWN-0','2UBO-1','2UHM-1','2UN6-1','15J9-2','15L8-2','15R0-2'],
}
const chunks = []
for (const [card, ids] of Object.entries(BOARDS)) for (let i = 0; i < ids.length; i += 4) chunks.push({ card, ids: ids.slice(i, i + 4) })

const savePrompt = (c) => `너는 Paper 원문 저장 레인(${c.card} · ${c.ids.join(', ')})이다. 읽기 전용 Paper + 파일 쓰기. Paper 파일 fileId "${FILE}", 카드 페이지 "5-1" 활성(open_file 금지). ToolSearch로 select:mcp__paper__get_node_info,mcp__paper__get_jsx,mcp__paper__get_tree_summary 로드(fileId 명시).
저장 형식(계획서 ${PLAN2} §4): 보드마다 디렉터리 ${TPL}\\<board_id>\\ 를 만들고
- paper.jsx — get_jsx({nodeId, format:"inline-styles"})의 jsx 문자열 **그대로**(가공 금지)
- paper.tree.txt — get_tree_summary({nodeId, depth:10}) 출력 그대로
- meta.json — {"board_id","name"(get_node_info name),"card_id":"${c.card}","width","height","state":{"kind":"default|tab|sort|expand","parent_board":null|"<id>","control":null|"<칩·탭·▸ 문구>"},"saved_at"}. kind 규칙: 이름에 "-X"가 있으면 expand(부모는 같은 카드의 도너 보드 — 이름의 T번호로 추정, 모르면 null), "T4-2"~"T4-10"·"T5-2"·"T6-2"~"T6-6"·"S2"~"S10"·"T6-2"~"T6-9"(수급)처럼 정렬 칩 상태면 sort(부모 = 그 계열 기준 보드, control = 보드 이름의 정렬명), "T1"~"T5"·"R11-T*"처럼 탭 상태면 tab(control = 탭명), 기준 보드(R10·R11·R01·R02·R03·R04·R05~R09·A04·A05)는 default.
- regions.json — paper.tree.txt의 최상위 2~3단 프레임에 역할을 붙인다: {"root":"<Card Surface 노드 id>","regions":[{"node_id","name","role":"header|kpi|strip|workspace|primary|rail|footer|other","depth"}]}. 판단 기준: header = 카드명·부제·상태칩이 있는 상단, kpi = 요약 스트립(4~6칸 숫자), strip = 탭/칩 줄, workspace = 본문 컨테이너, primary = 본문 좌측 주 영역(*Mount·표·차트·사다리), rail = 우측 레일(Instrument Context 등, 폭 360~540), footer = 하단 상태 바. 확신 없으면 other.
작업: 보드 4장을 순서대로 처리하고 파일은 Write로 UTF-8 저장. get_jsx 결과는 그대로 파일에 넣고 요약하지 마라. 보고(원시 데이터): 보드별 파일 4개 경로·JSX 바이트 수·트리 노드 수·state 판정·regions 수. 파일 외 산출 없음.`

const A = `너는 레인 A — Paper→코드 추출기 구현자다. 계획서 ${PLAN1}(D1·D6·D7·§2 스키마)와 ${PLAN2}(§2 반응형 5단·§3 반응형 층·§4 저장 형식)를 먼저 Read하라.
구현: ${ROOT}\\scripts\\paper_board_extract.py (표준 라이브러리만). 입력 = ${TPL}\\<board>\\{paper.jsx, paper.tree.txt, meta.json, regions.json}. 출력 = 같은 디렉터리에 board.html, slots.json, 그리고 ${TPL}\\index.json 갱신.
1) JSX→HTML: get_jsx 출력은 React 인라인 스타일 JSX다(style={{ camelCase: 'v', ... }}, 텍스트 노드, 중첩 div, SVG 포함 가능). camelCase→kebab-case, 숫자/문자 값 보존, MozOsxFontSmoothing→-moz-osx-font-smoothing 등 벤더 접두 처리, className 없음, 자기닫힘 태그 처리. 파서는 정규식이 아니라 최소 토크나이저(태그·속성·중괄호 스타일 객체·텍스트)로 작성하고 단위 테스트를 둔다.
2) 노드 정렬: paper.tree.txt(들여쓰기 트리: component·name·id)와 JSX 요소를 DFS 순서로 정렬해 각 HTML 요소에 data-node="<id>"와(이름이 있으면) data-name을 붙인다. 개수 불일치 시 어긋난 지점을 보고하고 실패(fail-closed).
3) 영역 클래스: regions.json의 node_id→role로 해당 요소에 class="bs-<role>"을 붙인다. 표는 반복 행 구조(같은 형제 프레임 3개 이상 + 헤더 행)를 감지해 class="bs-table"·행에 data-row·셀에 data-col="<index>"를 붙인다(휴리스틱, 보고에 감지 결과 기록).
4) slots.json 스켈레톤: 모든 텍스트 노드 → 슬롯 {slot_id(순번), node_id, node_name, paper_text, region(가장 가까운 bs-* 조상 role), layer(추정: meta.state.kind=="expand"→"펼침", 같은 32px 행 안의 둘째 줄이면서 fontSize 11px 이하→"병기", 그 외 "직접"), mapping_id/f(node_name이 "raw|<tr>|body|<field>" 또는 "mapping|<mapping_id>|<field>" 형식이면 채움, 아니면 null)}. 헤더의 고정 문구(카드명·탭 라벨·열 헤더)는 kind:"label"로 구분(값 슬롯이 아님 — 숫자·단위·날짜·시각·부호를 포함하지 않는 순수 라벨 텍스트).
5) 검증·해시: html_sha256, jsx_sha256, width/height, 텍스트 노드 다중집합(paper_text) 기록. index.json = 보드 목록(board_id·card_id·state·counts).
6) 개발용 표본: ${TPL}\\2SKU-1 에 원문이 아직 없으면 ToolSearch로 mcp__paper__get_jsx,mcp__paper__get_tree_summary,mcp__paper__get_node_info를 로드해 직접 저장(fileId "${FILE}", nodeId 2SKU-1; 저장 형식은 ${PLAN2} §4)하고 그것으로 추출기를 돌려 board.html을 브라우저 없이도 검증(파싱 성공·노드 수 일치·텍스트 다중집합 보존).
7) 테스트: ${ROOT}\\scripts\\tests\\test_paper_board_extract.py (pytest; JSX 변환 라운드트립·DFS 정렬·layer 추정·라벨/값 구분). 실행: cd ${ROOT} && python -m pytest scripts/tests -q.
보고(원시 데이터): 파일 목록, 2SKU-1 추출 결과 수치(요소 수·텍스트 노드 수·앵커 있는 슬롯 수/전체·bs-table 감지), 남은 문제.`

const B = `너는 레인 B — 백엔드 표면 계약 구현자다. 계획서 ${PLAN1} §2·§3과 ${PLAN2} §1·§5, 핸드오프 ${ROOT}\\docs\\handoff\\2026-09-01-paper-card-wiring.md §3(신뢰 경계 — canonical operation_ref 게이트를 넓히지 말 것)을 Read하라. 기존 코드: backend/athena_api/api/canvas_push.py(_INTEGRATED_CARD_FIELDS:131·_SECTION_TITLES_KO:497·_task_canvas_contract:502·_bind_semantic_values:599·_integrated_card_contract:716), backend/athena_mcp/canvas_data.py:60, backend/athena_api/canvas_card_registry.py, canvas_field_registry.py, screen_manifest.py, tests/unit/test_canvas_card_registry.py.
구현:
1) backend/athena_api/card_surface_templates.py — 로더(lru_cache): ${TPL}\\index.json + 각 보드 slots.json(있는 것만). API: get_registry() → {boards, by_card, by_operation(op→[board_id]), state_links}. fail-closed 검증 함수 validate(strict: bool): strict=True면 가시 필드 3,532 정확히 1회 바인딩·비노출 슬롯 0·299 op 커버·html_sha256 일치·밀도 예산·상태 참조 무결성 — 아직 템플릿이 없으므로 strict 검증은 index에 "complete": true 일 때만 강제(현재는 부분 로드 허용).
2) surface_contract 파생: 공유 헬퍼 backend/athena_api/card_surface_contract.py — build_surface_contract(operation_ref, bound_values, registry) → {board_id(기본 보드 = op의 default/tab 보드), state_boards[{board_id, kind, control}], slot_values[{slot_id, value, layer, format}], unbound_slots[], column_priority, section_titles_ko}. 값 바인딩은 canvas_push._bind_semantic_values의 JSONPath 경로를 재사용(slot의 mapping_id/f → occurrence → 값). 봉투 필드는 _INTEGRATED_CARD_FIELDS에 "surface_contract" 추가, REST(canvas_push._integrated_card_contract)와 MCP(canvas_data._integrated_card_contract) 양쪽이 같은 헬퍼로 첨부(템플릿이 없으면 None — 계약 게이트는 불변).
3) 한국어 섹션 제목: _SECTION_TITLES_KO 하드코딩을 slots.json의 section_titles_ko 우선·폴백 순으로.
4) 테스트: tests/unit/test_card_surface_templates.py(로더·부분 로드·strict 규칙 6종을 픽스처 템플릿으로), tests/unit/test_card_surface_contract.py(바인딩·unbound·state_links), test_canvas_push 확장(봉투에 surface_contract 키 존재, 게이트 불변), tests/unit/test_canvas_data_parity.py(REST/MCP 동형). 픽스처 템플릿은 tests/fixtures/card-surface/ 에 소형 보드 1장(2SKU-1 축약)으로.
실행: cd ${ROOT}\\backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/unit/test_canvas_card_registry.py -q, 그리고 전수 uv run pytest tests -q(기준선 2,638 passed/5 skipped 무회귀).
보고(원시 데이터): 변경 파일, 테스트 결과 수치, 남은 문제.`

const C = `너는 레인 C — 프론트 탭 뷰포트·보드 마운트·반응형 구현자다. 계획서 ${PLAN2} 전체와 ${PLAN1} §4, 헌장 ${CHARTER} §2.3·§3.1, 삭제 금지(핸드오프 §2: 16 card-kind·호가 사다리·AITS 차트)를 Read하라. 기존 코드: app/canvas.js(addLiveCard:602·renderPrimaryEnvelope:612·renderIntegratedCard:664), app/lib/integrated-card-surface.js(CARD_DEFINITIONS:4·instanceKeyFor:41·panelKeyFor:69·mountOrUpdate:289), app/lib/paper-card-routing.js, app/canvas.css(.grid:63·.card:923), app/shell.css(#canvasRegion:2704), app/shell.html(script 태그 관행), app/lib/card-kinds.js, app/lib/facts-card.js(포맷터), app/styles/tokens.css. node 실행: export PATH="/c/Users/USER/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"; cd ${ROOT}/app && npm run test:unit(기준선 1,702 무회귀).
구현:
1) 캔버스 탭 뷰포트: app/lib/canvas-tabs.js — 키움 보드 카드용 탭 스트립 + 단일 뷰포트. 탭 = 인스턴스 키(instanceKeyFor)당 1개, 제목 "카드명 · 대상", 닫기, 활성 전환, 순서 저장(세션). 같은 키 봉투는 탭 갱신. 비키움(task-canvas·free) 카드는 기존 .grid 경로 유지. CSS: app/styles/canvas-tabs.css(토큰만, 셸 크롬 톤: 활성 탭 = k-text 배경+흰 글자 관행은 스트립 칩과 동일).
2) 보드 마운트: app/lib/board-template-registry.js(생성 모듈 색인 — 빌드 스크립트 scripts/build_board_registry.py가 ${TPL}\\*\\board.html → app/lib/board-templates.generated.js 로 묶음; 지금은 픽스처 1장으로), app/lib/board-mount.js(mountBoard(root, boardId, slotValues): <template> 1회 파싱→cloneNode, data-node 기준으로 텍스트 노드만 textContent 치환, 병기 paired 동기 갱신, 영값 묶음/펼침 ▸ 클릭 → 상태 보드 템플릿 교체 훅), app/lib/board-format.js(한국어 단위 천·만·억·조, 부호+색 var(--color-up)/var(--color-down), 정밀도, 결측어 미제공·집계 전·해당 없음; facts-card.js 포맷터 재사용).
3) 반응형: app/styles/board-surface.css — .board-surface{container-type:inline-size; max-width:1440px; margin:0 auto} + @container 5단(≥1280 no-op / 960–1279 / 720–959 / 480–719 / <480) 규칙이 .bs-workspace(flex-wrap)·.bs-rail(폭·순서)·.bs-kpi(grid auto-fit)·.bs-table(data-col 접기 + 병기 셀 활성)·.bs-strip(가로 스크롤)에만 작용. XL에서 인라인 스타일 원문과 충돌 0(!important 금지, 컨테이너 셀렉터로만).
4) 통합: renderPrimaryEnvelope에서 envelope.surface_contract가 있으면 boardMount 경로, 없으면 기존 경로. mountOrUpdate 계약 유지.
5) 테스트(node --test): app/lib/board-format.test.js, app/lib/board-mount.test.js(jsdom 없이 — 기존 테스트가 쓰는 DOM 스텁 관행을 따르라; 없으면 순수 함수 분리해 검증), app/lib/canvas-tabs.test.js, 파리티 하네스 app/lib/board-parity.test.js(픽스처 보드의 paper_text 다중집합 == 마운트 결과 텍스트 다중집합 — 실 DOM 필요하면 verify 스크립트로 분리). card-kind-registration.test.js가 shell.html script 태그 추가에 통과하도록.
보고(원시 데이터): 변경 파일, 테스트 수치(신규/전수), 반응형 5단 규칙 요약, 남은 문제(특히 인라인 스타일과 컨테이너 쿼리 충돌 지점).`

const D = `너는 레인 D — 표면 커버리지 현황판 구현자다. ${ROOT}\\scripts\\paper_card_coverage.py·merge_field_claims.py·surface_dashboard.py 관행을 Read하고, ${PLAN2} §5 P4를 구현하라: scripts/card_surface_coverage.py — ${TPL}\\index.json과 각 slots.json을 읽어(없으면 0) ① 가시 3,532 필드(PAPER_FIELD_COVERAGE.json, cls≠비노출)의 슬롯 바인딩률(카드별·층별) ② 보드별 저작 상태(원문 저장/추출/슬롯 바인딩 완료/검증) ③ 밀도 예산 위반 ④ 미저작 보드 목록을 계산해 CARD_SURFACE_COVERAGE.md를 재생성하고 콘솔 요약을 찍는다(fail-closed: 원장 필드가 아닌 바인딩은 오류). surface_dashboard.py에 "표면 템플릿" 섹션(보드 96 중 저장/추출/바인딩 수, 필드 바인딩률 막대)을 추가하되 기존 표시는 유지. 실행 확인: PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py. 보고(원시 데이터): 파일, 출력 예시.`

phase('원문 저장 + 기반 구축')
const [saves, a, b, c, d] = await parallel([
  () => parallel(chunks.map(ch => () => agent(savePrompt(ch), { label: `save:${ch.card}:${ch.ids[0]}`, phase: '원문 저장 + 기반 구축', model: 'sonnet' }))),
  () => agent(A, { label: 'A:extractor', phase: '원문 저장 + 기반 구축' }),
  () => agent(B, { label: 'B:backend', phase: '원문 저장 + 기반 구축' }),
  () => agent(C, { label: 'C:frontend', phase: '원문 저장 + 기반 구축' }),
  () => agent(D, { label: 'D:coverage', phase: '원문 저장 + 기반 구축' }),
])

phase('기반 게이트')
const gate = await agent(`너는 웨이브 1 게이트다. 검사: ① ${TPL} 아래 보드 디렉터리 수와 각 디렉터리의 paper.jsx·paper.tree.txt·meta.json·regions.json 존재 여부(목표 96장, 누락 목록) ② cd ${ROOT} && python scripts/paper_board_extract.py --all 실행(있으면) → board.html/slots.json 생성 수, 실패 보드와 사유(DFS 정렬 불일치 등) ③ cd ${ROOT}\\backend && uv run pytest tests -q 결과 수치 ④ export PATH="/c/Users/USER/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"; cd ${ROOT}/app && npm run test:unit 결과 수치 ⑤ PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py 출력. 고칠 수 있는 소규모 결함(경로·인코딩)은 고치고 보고(원시 데이터): 저장 96/96 여부·추출 성공 수·테스트 수치·남은 문제.`, { label: 'gate:w1', phase: '기반 게이트' })
return { saves: saves.length, a, b, c, d, gate }