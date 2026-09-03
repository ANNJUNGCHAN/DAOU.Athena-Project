export const meta = {
  name: 'card-surface-w2a',
  description: '웨이브 2-A 정비 — 추출기 보강·CC-02 디렉터리 정정·밀도 규칙 수정·보드 하이드레이션 엔드포인트·번들 청크·현황판 모수',
  phases: [{ title: '정비', detail: 'A2 추출기 ∥ B2 백엔드 ∥ C2 프론트 ∥ D2 현황판' }, { title: '게이트', detail: '재추출 전수 · 테스트' }],
}
const ROOT = 'C:\\Projects\\DAOU.Athena'
const TPL = ROOT + '\\backend\\ref\\card-surface-templates'
const FILE = '01M0VGPX92K1TER4ZV9PWGQJJZ'
const NODE = 'export PATH="/c/Users/USER/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"'
const PY = ROOT + '\\backend\\.venv\\Scripts\\python.exe'

const A2 = `너는 A2 — 추출기 정비. 대상 ${ROOT}\\scripts\\paper_board_extract.py(+ scripts/tests). 웨이브 1 게이트 실측을 반영하라:
1) CC-02 저장 디렉터리 정정: ${TPL}\\R11, R11-T1, R11-T2, R11-T3 는 보드 id 대신 이름으로 저장된 것이다. 각 meta.json/paper.tree.txt의 루트 노드 id로 실제 보드 id를 확인해(예상 R11=135M-2, R11-T1=2T63-1, R11-T2=2TAG-1, R11-T3=2TET-1) 올바른 id 디렉터리로 옮기고(이미 있으면 내용 비교 후 최신본 유지), 잘못된 디렉터리 삭제. 17F8-2는 증명 페이지 보드라 카드 템플릿 모수에서 제외(디렉터리 없음이 정상).
2) <br> 정렬: paper.tree.txt는 void 요소(<br>)를 노드로 내보내지 않는다. DFS 정렬에서 void 요소를 건너뛰어 1JPU-0·1JZW-0이 통과하게.
3) 2S4E-1 트리 재캡처: ToolSearch로 mcp__paper__get_tree_summary,mcp__paper__get_children 로드(fileId "${FILE}"). get_tree_summary는 depth 최대 10이라 더 깊은 서브트리는 "... N children"으로 잘린다 — 잘린 노드를 get_children으로 재귀 보강해 완전한 트리 텍스트(같은 들여쓰기 형식)로 paper.tree.txt를 교체. 전수 검사로 "children" 잘림 문자열이 남은 보드가 더 있으면 같은 처리.
4) 출력 보강(레인 C 계약): 보드 루트 요소에 class="board-surface" 추가 · 감지된 표의 셀에 접기 래퍼 <span class="bs-col" data-col-priority="N">…</span>(N = 열 인덱스 1부터; 첫 2열은 래퍼 없음) · 접힘 시 병기용 <span class="bs-paired" data-paired-col="N" data-node="<접힌 셀 텍스트 노드 id>">(텍스트 동일 복제, 인라인 스타일 없음)을 그 행의 두 번째 열 셀 끝에 삽입 · KPI 셀(bs-kpi 직계 자식)에 class="bs-kpi-cell". XL에서 계산값 동일해야 하므로 래퍼는 display:contents 전제(CSS는 레인 C 소유).
5) slots.json 보강: column_bindings 지원 — 표 단위 {"table_id":..., "columns":[{"col":N,"header":"열 헤더 텍스트","slot_ids":[...]}]} 자동 생성, 저작자가 열 하나에 mapping_id/f를 주면 그 열의 셀 슬롯 전부에 전파하는 --apply-columns 제공. state.parent_board/control을 meta.json 이름 규칙에서 채움(부모 = 같은 카드의 기준 보드: 이름의 R번호·T번호 매칭, control = 이름 뒷부분). anchor 규칙 확정: node_name "raw|<tr>|body|<field>"는 base:<tr>가 보드 operation_refs에 있으면 base, 아니면 detail:<tr>:* 중 f를 가진 것으로 해소(원장 PAPER_FIELD_COVERAGE.json 조회), 없으면 null 유지.
6) 전수 재추출 후 index.json 갱신, --check 멱등 확인, pytest(${PY} -m pytest scripts/tests -q) 통과. 보고(원시 데이터): 디렉터리 정정 결과, 추출 성공/실패 수(목표 96/96: 카드 페이지 보드 96, 17F8-2 제외), bs-col/bs-paired/bs-kpi-cell 삽입 수, 남은 문제.`

const B2 = `너는 B2 — 백엔드 정비. 대상 backend/athena_api/card_surface_templates.py·card_surface_contract.py·api/canvas_push.py(+tests).
1) 밀도 규칙 수정(디자인 완전 동일 제약 우선): 하드 = table_columns ≤ 8 · kpi_cells ≤ 6 · rail_blocks ≤ 5 · height_px ≤ 1,120 · rows_max ≤ 20(헌장 C 규칙 상한) / 소프트(경고, strict 실패 아님) = rail_rows_max ≤ 6. index.json.expected 가시 필드 수는 원장 파생값(default_universe())이 정본.
2) 바인딩 규칙 확정: 전역 = 가시 필드마다 어떤 보드에든 1회 이상, 보드 내 중복은 paired_with(병기) 또는 같은 값의 KPI/레일 재표시(display_dup: true)만 허용. 슬롯에 json_path 선택 필드 지원(별칭 충돌 2쌍 해소).
3) 보드 하이드레이션(D2 fetch-set): 새 internal 엔드포인트 POST /internal/canvas/board-hydrate {board_id, target: {stk_cd 등 인자}, account?} (bearer, 기존 realtime-bindings 엔드포인트와 같은 신뢰 경계) — 보드 operation_refs의 read 계열 op들을 기존 Kiwoom 호출 경로(render-plan이 쓰는 클라이언트)로 호출해 surface_contract.slot_values를 채워 반환(실패 op는 unbound로 표기, 주문 op는 절대 호출 금지). 인자 매핑은 manifest request 필드 alias 기준(종목코드 stk_cd 등), 매핑 불가 op는 unbound + 사유. 테스트: 픽스처 보드로 성공/부분 실패/주문 op 거부.
4) _view_instance_id 결손(operation_ref 미포함, tests/api/test_task_canvas_envelope.py 1건 RED)은 세션 전부터 워킹트리에 있던 WIP다 — 수정하지 말고 현상만 보고.
5) 실행 조건 문서화: docs/handoff/README.md에 "백엔드 테스트는 node가 PATH에 있는 셸에서(fnm)" 한 줄 추가.
실행: cd ${ROOT}\\backend && ${NODE} && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py -q, 이후 전수 uv run pytest tests -q(기준선 2,698 passed/5 skipped/1 failed(WIP) 무회귀). 보고(원시 데이터).`

const C2 = `너는 C2 — 프론트 정비. 대상 app/lib/board-template-registry.js·board-mount.js·canvas-tabs.js·styles/board-surface.css·scripts/build_board_registry.py·app/canvas.js(+tests). ${NODE}; cd ${ROOT}/app && npm run test:unit(기준선 1,998 무회귀).
1) 번들 청크: build_board_registry.py가 카드별 6개 파일(app/lib/board-templates.<CC-0n>.generated.js)로 분할하고, 레지스트리가 보드 id→카드 소형 색인(app/lib/board-templates.index.generated.js)으로 필요한 청크만 동적 script 주입(file:// 호환)해 Promise로 해석. shell.html에는 색인만 동기 로드.
2) 추출기 계약 소비: 루트 .board-surface(추출기가 붙임) · .bs-col[data-col-priority]/.bs-paired[data-paired-col] 접기 규칙을 단계별 임계(L: 7열 이상 접기, M: 6열 이상, S: 5열 이상, XS: 4열 이상)로 CSS 확정 · .bs-kpi-cell 폭 hoist(M 이하 3칸/2칸/1칸 흐름) · 컨테이너 textContent 금지 검증(containers[] 비어야 통과) 테스트.
3) 하이드레이션 클라이언트: 보드 마운트 시 surface_contract.unbound_slots가 있으면 app/lib/main 경유로 POST /internal/canvas/board-hydrate(레인 B2 계약 {board_id, target, account}) 호출 → slot_values 병합 → 텍스트 갱신. 기존 realtime lease IPC 관행. 엔드포인트 미구현 시 graceful(미제공 유지).
4) 탭 드래그 정렬(HTML5 drag) + 키보드 좌우 전환.
5) 상태 보드 전환: 스트립 칩·탭·▸ 클릭 → state_links로 템플릿 교체(같은 탭, 같은 slot_values 재사용 + 부족분 하이드레이션).
보고(원시 데이터): 파일·테스트 수치·남은 문제.`

const D2 = `너는 D2 — 현황판 정비. scripts/card_surface_coverage.py: BOARD_TOTAL 상수 제거 → 모수 = index.json 보드(카드 페이지) ∪ 템플릿 디렉터리(fixture-·_ 제외), 17F8-2(증명 페이지)는 모수 제외하되 "원장이 17F8-2에만 귀속한 필드 N건 → 카드 보드 재귀속 필요" 경고 표 출력. 밀도 규칙을 B2와 동일(하드 5·소프트 1)로. 층별 집계에 "슬롯 판정 층" 열 추가. surface_dashboard.py 표면 섹션도 같은 모수. 실행: PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py. 보고(원시 데이터).`

phase('정비')
const [a2, b2, c2, d2] = await parallel([
  () => agent(A2, { label: 'A2:extractor' }), () => agent(B2, { label: 'B2:backend' }),
  () => agent(C2, { label: 'C2:frontend' }), () => agent(D2, { label: 'D2:coverage' }),
])
phase('게이트')
const gate = await agent(`너는 웨이브 2-A 게이트다. ① ${TPL} 보드 디렉터리 = 카드 페이지 96장(R11류 잔재 0, 17F8-2 없음) ② cd ${ROOT} && ${PY} scripts/paper_board_extract.py 전수 → 96/96 성공, --check 멱등 ③ cd ${ROOT}\\backend && ${NODE} && uv run pytest tests -q(기준선 2,698/5/1 WIP RED 외 신규 실패 0) ④ ${NODE}; cd ${ROOT}/app && npm run test:unit(기준선 1,998 무회귀) ⑤ PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py 출력 ⑥ 앱 스모크: cd ${ROOT}/app && npm run verify:integrated-cards 실행(fixture)해 보드 표면 경로가 예외 없이 마운트되는지. 소규모 결함은 고치고 보고(원시 데이터).`, { label: 'gate:w2a' })
return { a2, b2, c2, d2, gate }