export const meta = {
  name: 'card-surface-w3',
  description: '웨이브 3 — 로더 격리·밀도 계수 정정·커버리지 정본화·보드 카드 크롬 제거 → 3차 저작(잔여 155 occurrence·4 op·중복·상태) → 실보드 4단계 캡처 게이트',
  phases: [
    { title: '정비', detail: 'A5 추출기 ∥ B4 로더 ∥ C5 프론트 ∥ D3 커버리지' },
    { title: '3차 저작', detail: '잔여 필드·중복·상태 8레인' },
    { title: '게이트', detail: 'get_registry 정식 경로 · 실보드 캡처 · 전수 테스트' },
  ],
}
const ROOT = 'C:\\Projects\\DAOU.Athena'
const TPL = ROOT + '\\backend\\ref\\card-surface-templates'
const PACK = ROOT + '\backend\ref\card-surface-authoring\packs' // 원래는 세션 스크래치 경로. ATHENA_PACK_DIR 와 같은 값.
const CHARTER = ROOT + '\\docs\\ui\\paper-card-surface-charter.md'
const NODE = 'export PATH="/c/Users/ajc22/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"'
const PY = ROOT + '\\backend\\.venv\\Scripts\\python.exe'

const A5 = `너는 A5 — 추출기 밀도 계수 정정(${ROOT}\\scripts\\paper_board_extract.py, validate_board_slots.py, tests). 실측: 호가 보드(13BC-2·2TRW-1·2QX1-1·15P5-2)의 rail_blocks가 13으로 세어지는데 Paper 레일 블록은 2~5개다 — 계수 휴리스틱이 하위 프레임을 블록으로 센다. 정정: 레일 블록 = bs-rail 직계 자식 중 제목(font-strong 13px 텍스트)을 가진 프레임만, KPI 셀 = bs-kpi 직계 자식(bs-kpi-cell)만, rows_max = 표 본문 행(data-row가 head/foot이 아닌 것; 합계·소계 행은 data-row="foot"로 표기하고 제외). density를 slots.json에 다시 쓰고(재추출), 96장 실측 분포를 보고. 2QFO-2 등 CC-05 탭 보드는 부모가 없는 레일 주인(CC-05에는 default 루트 보드가 없음) — meta.state.parent_board가 자기 자신이면 null로, kind는 tab 유지하되 "rail_owner": true 표기. 상태 컨트롤 미해소 9건은 저작 몫으로 남김. pytest(${PY} -m pytest scripts/tests -q) 통과. 보고(원시 데이터).`

const B4 = `너는 B4 — 로더 격리·규칙 정합(backend/athena_api/card_surface_templates.py, card_surface_contract.py, tests). 
1) 보드별 격리: get_registry()가 전부-아니면-전무가 아니라, 문제 있는 보드만 제외(logger.warning에 보드·사유)하고 나머지를 로드해 surface_contract가 정상 보드에 대해 살아나게. load_registry(strict=True)는 CI용으로 여전히 예외. registry.excluded_boards[] 노출.
2) 밀도: 하드 = table_columns ≤ 8 · rows_max ≤ 22(표 본문 20 + 합계 2 허용, A5가 foot 행을 빼면 20) · height_px ≤ 1,120. rail_blocks·kpi_cells는 소프트(경고). 
3) 상태: rail_owner(tab이면서 parent 없음) 허용, 자기참조 금지 유지.
4) 중복: _duplicate_is_declared가 region row_index 되풀이 블록도 접는지 2SKU-1·2U5L-1로 실측하고, 진짜 중복만 남기도록. 결과 보드별 목록을 보고.
5) 커버리지 API: registry.coverage() → {visible_total, covered, uncovered_occurrences[], operations_without_board[]} 를 노출(D3가 소비).
테스트 갱신·추가. cd ${ROOT}\\backend && ${NODE} && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q. 보고(원시 데이터: 격리 후 로드 보드 수/제외 보드·사유, coverage 수치).`

const C5 = `너는 C5 — 보드 카드 크롬 제거·실보드 캡처(app/canvas.js, app/lib/integrated-card-surface.js, app/styles/*.css, app/verify-integrated-cards.js, tests). ${NODE}; cd ${ROOT}/app && npm run test:unit(기준 2,033).
1) 보드 표면 카드(surface_contract 있는 카드)는 Paper 보드가 헤더·스트립·푸터를 이미 갖고 있으므로 기존 통합 카드 크롬을 그리지 않는다: .card-head(카드 제목·기준 시각·×는 탭 스트립으로 이동), 패널 탭 칩("요약" 등), 하단 "전체 원본 필드 ▸"(헌장 신념 8 금지 UI) 전부 숨김/미생성. 카드 = 보드 그 자체. 비보드 카드는 기존 유지. raw-ui-boundary 테스트 정합.
2) 폭 hoist 실측: 실보드(2SKU-1 등)에서 컨테이너 1152px일 때 overflow_x 0이 되게 — bs-* 영역 인라인 width 외에 표 열 폭·KPI 셀·헤더 폭도 hoist 대상인지 실측 후 보강(zoom 금지).
3) verify-integrated-cards: 픽스처 보드 대신 실보드 6장(2SKU-1, 2R3M-1, 13BC-2, 2QFO-2, 13K0-2, 135M-2)을 slots.json의 paper_text를 값으로 마운트해 4단계(1920×1080·960×1080·640×540·480×420) 캡처 + P5 텍스트 다중집합 검사. 캡처 파일명 board-<id>-<w>x<h>.png. 백엔드 레지스트리 격리 전이면 프론트 픽스처 경로로 surface_contract를 직접 구성해도 됨(값 = paper_text).
보고(원시 데이터): 파일·테스트·캡처 경로·overflow 수치.`

const D3 = `너는 D3 — 커버리지 정본화(scripts/card_surface_coverage.py, surface_dashboard.py). 현재 스크립트가 alt_mappings·indexed·행 반복 면제를 모르고 67.8%·중복 1,156을 내는데 로더 strict는 미도달 155 occurrence(≈95.6%)다. 정정: 바인딩 판정을 백엔드 로더에 위임 — sys.path에 backend를 넣고 athena_api.card_surface_templates.load_registry(strict=False)(현재 시그니처; isolate 인자는 없다)와 registry.coverage()를 사용해 카드별·층별 바인딩률, 미도달 occurrence 목록(kor 병기), 보드 없는 op, 제외 보드·사유, 밀도 하드/소프트를 MD로. 17F8-2 재귀속 경고는 "미도달 occurrence 중 원장 귀속이 17F8-2인 것"으로 정확화. 대시보드 섹션 동일 갱신. 실행: PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py. 보고(원시 데이터).`

phase('정비')
const [a5, b4, c5, d3] = await parallel([
  () => agent(A5, { label: 'A5:density' }), () => agent(B4, { label: 'B4:loader' }),
  () => agent(C5, { label: 'C5:chrome-capture' }), () => agent(D3, { label: 'D3:coverage' }),
])

phase('3차 저작')
const LANES = [
  { label: 'account-a', boards: ['2SKU-1','3IGR-0','3GRO-0'], focus: '중복 바인딩(2SKU-1 57슬롯)·kt00005 margin_order_capacity/kt00011 account_funding/kt00013 d2_funding_capacity·margin_order_capacity 4 op의 필드를 그려진 자리에 바인딩(증거금·재원 표, 인출 한도)·3IGR-0 b1 e2' },
  { label: 'account-b', boards: ['3ODO-0','3OIM-0','133H-2','3NVG-0','3LGC-0'], focus: '3ODO-0 proc_brch_nm·kt50020/kt50032 재귀속·3OIM-0 kt50030/31/75 재귀속·133H-2 ▸ 컨트롤(금현물 잔고·주문 펼침은 133H-2에 ▸가 없으므로 meta.control_text로 "금현물" 탭 지정)·3NVG-0 중복(한 셀 잎 2~3개 → paired/display_dup)·3LGC-0 중복 rmrk_nm' },
  { label: 'quote-flow', boards: ['2R3M-1','2QM7-2','2ROJ-1','2TZN-1','2UBO-1','2UHM-1'], focus: '2R3M-1 b1·2QM7-2 e4(0w·11, ka10043, ka10052/ka10002 pred_pre)·2ROJ-1 e1·2TZN-1 e1·2UBO-1 flu_sig·2UHM-1 1h·9075' },
  { label: 'rank-a', boards: ['13K0-2','2XKO-0','2XP6-0','2YA8-0','2YEQ-0','2YJ8-0','2YNQ-0'], focus: 'e 잔여(NXT 가능 여부·pred_sig·now·now_rt·now_trde_qty·tdy_close_pric_flu_rt) 바인딩 — 값이 그려진 자리(칩·병기)에 alt/extra_fields 활용' },
  { label: 'rank-b', boards: ['2ZTA-0','3063-0','30HY-0','31CL-0','30TY-0','2Z49-0','1WOB-1'], focus: 'e 잔여(pre_sig·flu_rt·stk_cd·qry_dt·gain_pos_stkcnt)·30TY-0 중복·2Z49-0 flu_rt 두 열 display_dup·1WOB-1 qry_dt' },
  { label: 'watch-answer', boards: ['2U5L-1','15J9-2','15L8-2','3EWN-0','2UN6-1'], focus: '2U5L-1 중복 38슬롯(행 반복 vs 진짜 중복 판정)·15J9-2 e3·15L8-2 e1·3EWN-0 ▸ control_text·2UN6-1 중복 3' },
  { label: 'orderbook', boards: ['13BC-2','1JPU-0','1JZW-0','3JZ3-0','3N4O-0','2TRW-1','2QX1-1'], focus: 'base:00·base:0D 등 실시간 occurrence 미도달 목록(로더 coverage의 uncovered 중 CC-04 몫)을 사다리·낱값 표의 indexed 열로 바인딩, 3JZ3-0·3N4O-0 control_text' },
  { label: 'uncovered-sweep', boards: [], focus: 'B4 registry.coverage().uncovered_occurrences 전체를 카드별로 분류해 어느 보드 어느 슬롯에 붙일지 결정하고, 위 레인 소유 밖 보드(CC-02 6장·CC-03 잔여·CC-06 잔여)의 것을 직접 바인딩. 소유 겹침 방지: 위 7레인 보드는 편집 금지, 그 보드 몫은 보고에 넘김' },
]
const authored = await parallel(LANES.map(l => () => agent(`너는 3차 슬롯 저작 레인 "${l.label}"(보드: ${l.boards.join(', ') || '소유 밖 잔여'})이다. 목표: 로더 strict 미도달 occurrence 0·보드 없는 op 0·진짜 중복 0·상태 컨트롤 0. Read: ${CHARTER} §2.2·§4, 보드별 ${TPL}\\<board>\\slots.json·meta.json, ${PACK}\\<board>.pack.json. 도구: ${PY} ${ROOT}\\scripts\\validate_board_slots.py <board> · ${PY} ${ROOT}\\scripts\\paper_board_extract.py <board> --apply-columns --no-index · 로더 커버리지: cd ${ROOT}\\backend && ${NODE} && uv run python -c "from athena_api.card_surface_templates import load_registry; r=load_registry(strict=False); c=r.coverage(); print(len(c['uncovered_occurrences'])); print([o for o in c['uncovered_occurrences'] if o.startswith(('base:','detail:'))][:60])"(API 이름이 다르면 모듈을 Read해 맞춰라).
슬롯 표현력: alt_mappings(같은 자리 여러 op)·indexed(열 f_pattern {i})·extra_fields(한 텍스트 두 값)·paired_with(병기)·display_dup(재표시)·collapse_group(영값 묶음)·kind static/label/derived·meta.state.control_text(부모 화면의 실제 문구).
초점: ${l.focus}
규칙: 다른 레인 보드 편집 금지, --no-index. 종료 조건: 담당 보드 validate 문제 0 + 로더 coverage에서 담당 보드 op의 미도달 0. 보고(원시 데이터): 전→후 수치, 남은 사유.`, { label: `author3:${l.label}`, phase: '3차 저작' })))

phase('게이트')
const gate = await agent(`너는 웨이브 3 게이트다. ① cd ${ROOT} && ${PY} scripts/paper_board_extract.py(전수, index 갱신) → 96/96·--check ② cd ${ROOT}\\backend && ${NODE} && uv run python -c "from athena_api.card_surface_templates import get_registry; r=get_registry(); print(len(r.boards), getattr(r,'excluded_boards',None)); c=r.coverage(); print({k:(v if not isinstance(v,list) else len(v)) for k,v in c.items()})" — 정식 경로(get_registry)로 로드 보드 수·제외 보드·커버리지 ③ ${PY} scripts/validate_board_slots.py 전 보드 합계 ④ PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py ⑤ python scripts/build_board_registry.py && ${NODE}; cd ${ROOT}/app && npm run test:unit ⑥ cd ${ROOT}\\backend && uv run pytest tests -q(전수; 기준 WIP RED 1건 외 신규 실패 0) ⑦ cd ${ROOT}/app && npm run verify:integrated-cards → 실보드 6장 × 4단계 캡처 경로와 overflow 수치, P5 결과. 소규모 결함은 고치고 보고(원시 데이터): 로드 보드 수/제외, 커버리지(카드별), 잔여 목록, 테스트 수치, 캡처 경로.`, { label: 'gate:w3' })
return { a5, b4, c5, d3, authored: authored.length, gate }