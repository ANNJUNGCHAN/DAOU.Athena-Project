export const meta = {
  name: 'card-surface-w2c',
  description: '웨이브 2-C — alt_mappings·인덱스 열·중복 규칙(A4/B3) ∥ 프론트 잎 앵커·포맷 어휘(C4) → 2차 슬롯 저작 23레인 → 게이트',
  phases: [
    { title: '도구 보강', detail: 'A4 추출기 ∥ B3 로더/계약 ∥ C4 프론트' },
    { title: '2차 저작', detail: '문제 5건 이상 48장, 23레인' },
    { title: '게이트', detail: 'strict · 커버리지 · 테스트 · 스크린샷' },
  ],
}
const ROOT = 'C:\\Projects\\DAOU.Athena'
const TPL = ROOT + '\\backend\\ref\\card-surface-templates'
const PACK = 'C:\\Users\\ajc22\\AppData\\Local\\Temp\\claude\\C--Projects-DAOU-Athena\\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\\scratchpad\\authoring'
const CHARTER = ROOT + '\\docs\\ui\\paper-card-surface-charter.md'
const NODE = 'export PATH="/c/Users/ajc22/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"'
const PY = ROOT + '\\backend\\.venv\\Scripts\\python.exe'

const A4 = `너는 A4 — 추출기·검증기 보강(${ROOT}\\scripts\\paper_board_extract.py, validate_board_slots.py, tests). 게이트 실측(바인딩 67.8%, 미바인딩 원인 3종)을 해소할 슬롯 표현력을 추가하라. 저작물 보존(merge_authored) 필수.
1) alt_mappings: 슬롯/열에 "alt_mappings":[{"mapping_id","f","json_path"?}] 허용 — 같은 자리를 여러 op(차트 주기 틱/분/일/주/월/년, 업종 차트 6종, 금현물 주기 등)의 같은 의미 필드가 공유한다. --apply-columns가 열의 alt_mappings도 셀에 전파. 검증기(e)는 alt_mappings로도 필드 도달로 계산.
2) 인덱스 열: column_bindings 열에 "indexed":{"f_pattern":"sel_bid_{i}","start":1,"step":1,"direction":"down|up"} 허용 — 표 본문 행 r(0부터)의 셀은 f = pattern.format(i=start+r*step)로 바인딩(호가 10단은 매도 10→1 위에서 아래이므로 direction up = start 10, step -1 지원). 거래원 1~5(sel_trde_ori_nm_{i} 등), ELW 민감도 배열도 같은 방식. 검증기는 확장된 f가 원장에 있는지 검사.
3) 중복 규칙 메타: 같은 table_id·col의 행 반복은 중복이 아니다 — slots에 이미 있는 table 좌표로 판정(검증기 f 규칙 수정). 헤더 KPI 재표시는 display_dup.
4) 상태 컨트롤 4단계: 토큰(공백·"·" 분리) 겹침 ≥1 매칭 추가, meta.state.control_text로 손지정 우선. 미해소 23건 재시도 후 index에 기록.
5) validate_board_slots: 보드별 문제를 b/d/e/c/f/g로 집계하고 e 목록은 kor·mapping_id·f로. 전수 재추출·--check 멱등·pytest(${PY} -m pytest scripts/tests -q). 보고(원시 데이터): 새 필드 사용법 요약(저작 레인에 그대로 전달할 3~6줄), 상태 컨트롤 해소 n/83.`

const B3 = `너는 B3 — 백엔드 로더/계약 보강(backend/athena_api/card_surface_templates.py, card_surface_contract.py, tests). A4의 슬롯 확장을 소비하라: alt_mappings(슬롯이 여러 (mapping_id,f)에 도달 — strict 커버리지는 alt 포함, 계약 build 시 bound_values에 있는 매핑 중 활성 op(요청 op 우선) 값을 선택), indexed 열(추출기가 셀 슬롯에 확장된 f를 써 두므로 로더는 그대로 읽되 f_pattern 원본도 보존), 중복 규칙(같은 table_id·col의 행 반복 제외 · display_dup · paired), state_links에 control_text. 밀도: 표 rows_max 20 하드 유지. board-hydrate 응답도 동일 헬퍼. 테스트 갱신·추가(픽스처 보드에 alt/indexed 케이스). 실행: cd ${ROOT}\\backend && ${NODE} && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q. 보고(원시 데이터).`

const C4 = `너는 C4 — 프론트 마감(app/lib/board-mount.js, board-format.js, board-template-registry.js, scripts/build_board_registry.py, tests). ${NODE}; cd ${ROOT}/app.
1) nodeIndex: 같은 data-node에서 [data-leaf] 잎을 우선 선택(컨테이너 앵커 0 목표). 2) 포맷 어휘: 추출기 format.unit(text/percent/krw_ko/shares/count/date/time) → formatSlot kind 매핑(krw_ko→korean, percent→percent, date/time→date, shares/count→number(단위 접미 주·건 유지), text→text) + sign/precision/tone 준수. 3) alt_mappings·indexed 슬롯 소비(마운트 시 slot_values는 slot_id 기준이라 변화 없음 — 확인). 4) python scripts/build_board_registry.py 재생성 후 npm run test:unit(기준 2,025) — board-parity 전수 마운트에서 값 슬롯 컨테이너 0 검증 통과. 5) npm run verify:integrated-cards 실행(fixture)해 보드 캡처 4단계 정상. 보고(원시 데이터).`

const HEAVY = ['2QM7-2','15P5-2','137X-2','30C1-0','2ZHC-0','2TZN-1','2RJ7-1','2SCE-1','2R3M-1','2ZZ7-0']
const REST = {
  'CC-01': ['2SYW-1','3K7K-0','3LGC-0','2SRV-1','2SKU-1','3MTJ-0','133H-2','3GRO-0','3NVG-0','3UTA-0','3OIM-0'],
  'CC-02': ['2TAG-1','135M-2','2T63-1','2TET-1'],
  'CC-03': ['15N5-2','32S7-0','2VDA-0','2YXS-0','2ZN9-0','2RBO-1','31UD-0'],
  'CC-04': ['13BC-2','1JPU-0','3N4O-0','2QRP-1'],
  'CC-05': ['2ROJ-1','2S4E-1','2V71-0','2RWK-1','2Z49-0','2QFO-2','30TY-0','2YS8-0'],
  'CC-06': ['13K0-2','2U5L-1','3D4I-0','2UN6-1'],
}
const cardOf = (id) => Object.entries(REST).find(([c, ids]) => ids.includes(id))?.[0] || ({ '2QM7-2':'CC-05','15P5-2':'CC-03','137X-2':'CC-03','30C1-0':'CC-03','2ZHC-0':'CC-03','2TZN-1':'CC-06','2RJ7-1':'CC-03','2SCE-1':'CC-01','2R3M-1':'CC-03','2ZZ7-0':'CC-03' })[id]
const lanes = HEAVY.map(h => ({ card: cardOf(h), ids: [h] }))
for (const [card, ids] of Object.entries(REST)) for (let i = 0; i < ids.length; i += 3) lanes.push({ card, ids: ids.slice(i, i + 3) })

const authorPrompt = (l, tools) => `너는 2차 슬롯 저작 레인(${l.card} · ${l.ids.join(', ')})이다. 1차 저작이 남긴 문제를 0으로 만드는 것이 목표. Read: 헌장 ${CHARTER} §2.2·§3.1·§4, 보드마다 ${TPL}\\<board>\\slots.json·meta.json, ${PACK}\\<board>.pack.json. 먼저 ${PY} ${ROOT}\\scripts\\validate_board_slots.py <board> 로 현재 문제(b 미지정 값 슬롯 / d 미매핑 열 / e 팩 미바인딩 필드 / c 병기 짝 / f 중복 / g 관계)를 본다.
◆ 새 표현력(A4 보고 요약):
${tools}
◆ 해소 규칙:
- e(팩 필드 미바인딩) 중 "차트 주기·업종·금현물 주기 op가 같은 의미 필드를 반복"하는 것 → 그 값이 그려진 슬롯/열에 alt_mappings로 전부 도달시킨다(예: 137X-2 시가·고가·저가·거래량·거래대금·전일대비(기호)·등락률 ← ka10079~ka10083·ka20004~ka20019 등 그 보드 op 전부).
- 호가 10단·거래원 1~5·ELW 민감도 배열 → 표 열 indexed 바인딩(방향·시작 주의: 매도 호가는 위가 10단).
- 표 행 반복은 중복이 아니다(f 규칙 정정됨). 헤더 KPI 재표시는 display_dup:true.
- b(미지정 값 슬롯)는 라벨 오분류면 kind:"label"로, 고정 문구면 kind:"static", 값이면 바인딩. 정말 응답에 없는 값(파생 합계 등)은 kind:"derived"에 formula 메모.
- 병기(스택 셀 둘째 줄)는 layer 병기 + paired_with(같은 셀 첫 줄) + 자기 필드; "+1,850 · +1.24%"처럼 한 텍스트에 두 값이면 mapping=첫 값, extra_fields로 둘째 값.
- state.parent_board·control_text(정확한 칩 문구) 채움. 다른 레인 보드 편집 금지, --no-index로 추출.
종료 조건: validate_board_slots <board> 문제 0(불가피한 잔여는 unbound_reason 기록). 보고(원시 데이터): 보드별 전→후 문제 수, alt/indexed 사용 수, 잔여 사유.`

phase('도구 보강')
const [a4, b3, c4] = await parallel([
  () => agent(A4, { label: 'A4:extractor' }), () => agent(B3, { label: 'B3:backend' }), () => agent(C4, { label: 'C4:frontend' }),
])
const tools = String(a4).slice(0, 1800)

phase('2차 저작')
const authored = await parallel(lanes.map(l => () => agent(authorPrompt(l, tools), { label: `author2:${l.card}:${l.ids[0]}`, phase: '2차 저작' })))

phase('게이트')
const gate = await agent(`너는 웨이브 2-C 게이트다. ① cd ${ROOT} && ${PY} scripts/paper_board_extract.py(전수, index 갱신) → 96/96·--check 멱등 ② ${PY} scripts/validate_board_slots.py 전 보드 → 문제 합계·보드별 잔여 표 ③ cd ${ROOT}\\backend && ${NODE} && uv run python -c "from athena_api.card_surface_templates import load_registry; r=load_registry(); p=r.validation_problems(strict=True); print(len(p)); print('\\n'.join(p[:30]))" ④ PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py(카드별·층별 바인딩률) ⑤ python scripts/build_board_registry.py 후 ${NODE}; cd ${ROOT}/app && npm run test:unit ⑥ cd ${ROOT}\\backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q ⑦ cd ${ROOT}/app && npm run verify:integrated-cards(fixture, 4단계 캡처). 소규모 결함은 고치고 보고(원시 데이터): 바인딩률, strict 잔여 유형별 수, 테스트 수치, 스크린샷 경로, 남은 문제.`, { label: 'gate:w2c' })
return { a4, b3, c4, lanes: lanes.length, gate }