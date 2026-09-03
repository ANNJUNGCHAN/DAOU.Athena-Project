export const meta = {
  name: 'card-surface-w2b',
  description: '웨이브 2-B — 추출기 최종 보강 → 슬롯 저작 32레인(96장) ∥ 실시간 슬롯 매핑·5단 스크린샷 → 게이트',
  phases: [
    { title: '추출기 보강', detail: '잎 앵커 · 상태 컨트롤 · 포맷 추론 · 보드 검증 CLI' },
    { title: '슬롯 저작', detail: '32 레인 병렬 ∥ C3 실시간·검증 하네스' },
    { title: '게이트', detail: 'strict 검증 · 커버리지 · 파리티 · 전수 테스트' },
  ],
}
const ROOT = 'C:\\Projects\\DAOU.Athena'
const TPL = ROOT + '\\backend\\ref\\card-surface-templates'
const PACK = 'C:\\Users\\ajc22\\AppData\\Local\\Temp\\claude\\C--Projects-DAOU-Athena\\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\\scratchpad\\authoring'
const CHARTER = ROOT + '\\docs\\ui\\paper-card-surface-charter.md'
const NODE = 'export PATH="/c/Users/ajc22/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"'
const PY = ROOT + '\\backend\\.venv\\Scripts\\python.exe'

const HEAVY = ['2QM7-2','15P5-2','2R3M-1','137X-2','2TZN-1','2SYW-1','2RJ7-1','2SCE-1']
const BOARDS = {
  'CC-01': ['133H-2','2SCE-1','2SKU-1','2SRV-1','2SYW-1','3GRO-0','3IGR-0','3LGC-0','3MTJ-0','3NVG-0','3K7K-0','3ODO-0','3OIM-0','3UTA-0'],
  'CC-02': ['135M-2','2T63-1','2TAG-1','2TET-1','2TJ6-1','2TNJ-1'],
  'CC-03': ['137X-2','2R3M-1','2RBO-1','2RJ7-1','3FR6-0','3DI2-0','32S7-0','32XM-0','15N5-2','15P5-2','3DZ1-0','2VDA-0','2YXS-0','2ZHC-0','2ZZ7-0','30C1-0','30O1-0','30ZW-0','316O-0','31II-0','3TCO-0','31UD-0','2VIN-0','2WZK-0','2VO0-0','2XA5-0','2XY6-0','2Y47-0','2Z49-0','3TOM-0','2ZN9-0'],
  'CC-04': ['13BC-2','2TRW-1','3JZ3-0','1JPU-0','3N4O-0','1JZW-0','2QRP-1','3JT4-0','2QX1-1'],
  'CC-05': ['2QFO-2','2QM7-2','2ROJ-1','2RWK-1','2S4E-1','2V71-0','2YS8-0','2ZBB-0','2ZTA-0','3063-0','30HY-0','30TY-0','31CL-0','31OF-0','1WOB-1'],
  'CC-06': ['13K0-2','2X5N-0','2XG6-0','2XKO-0','2XP6-0','2XTO-0','2YA8-0','2YEQ-0','2YJ8-0','2YNQ-0','2TZN-1','3BQB-0','2U5L-1','3D4I-0','3EWN-0','2UBO-1','2UHM-1','2UN6-1','15J9-2','15L8-2','15R0-2'],
}
const lanes = []
for (const [card, ids] of Object.entries(BOARDS)) {
  const light = ids.filter(i => !HEAVY.includes(i)); const heavy = ids.filter(i => HEAVY.includes(i))
  for (const h of heavy) lanes.push({ card, ids: [h] })
  for (let i = 0; i < light.length; i += 3) lanes.push({ card, ids: light.slice(i, i + 3) })
}

const A3 = `너는 A3 — 추출기 최종 보강(${ROOT}\\scripts\\paper_board_extract.py + scripts/tests). 웨이브 2-A 프론트 실측 반영:
1) 컨테이너 앵커 제거: 텍스트를 직접 가진 요소가 자식 요소도 가지면(345건/62장) 그 텍스트를 잎 <span data-node="<id>" data-leaf>로 감싸 슬롯 앵커가 항상 잎이 되게(스타일 상속만, 인라인 스타일 없음). 결과: 값 슬롯의 컨테이너 앵커 0.
2) 상태 컨트롤 표식: meta.state.control(예: "호가창 · 5단", "정렬 · 등락률")을 부모 보드의 스트립/탭/▸ 요소와 대조해 일치 잎에 data-state-control="<control>"과 data-state-board="<child board_id>"를 찍는다. 정확 일치 → " · " 분리 마지막 조각 일치 → 부분 포함 순으로 해소, 미해소는 index.json에 목록 기록. 펼침(expand) 컨트롤은 ▸ 잎(또는 그 행)에 표식.
3) 포맷 추론: 값 슬롯(kind=value)에 format 기본값 — paper_text 패턴으로 unit(krw_ko '원'·'억'·'만'/percent '%'/shares '주'/count '건'/date/time/text), sign(선행 +/−/▲/▼), precision(소수 자릿수), tone(change: 부호 있거나 상승·하락 색 토큰 사용 시 / neutral). 인라인 색이 var(--color-up|down)이면 tone=change.
4) 보드 단위 CLI: --no-index(index.json 미갱신) 옵션과 scripts/validate_board_slots.py <board...> — 검사: (a) 모든 mapping_id/f가 원장 가시 필드에 존재·비노출 아님 (b) 값 슬롯 중 mapping 미지정 수(라벨 제외) (c) 병기 슬롯의 paired_with가 같은 셀/행의 값 슬롯인지 (d) column_bindings 열마다 mapping 유무 (e) 팩(${PACK}\\<board>.pack.json)의 attributed_here 필드 중 미바인딩 목록 (f) display_dup 없는 보드 내 중복 (g) collapse_group의 rollup_slot·expanded_board 존재. 콘솔에 보드별 요약 + 미바인딩 필드 kor 목록 출력, 종료코드 = 문제 수 &gt; 0.
5) 전수 재추출(저작물 보존 merge_authored 확인) → --check 멱등 → pytest(${PY} -m pytest scripts/tests -q). 보고(원시 데이터): 잎 분리 수, 상태 컨트롤 해소 n/66, 포맷 추론 분포, CLI 사용법.`

const authorPrompt = (l) => `너는 슬롯 저작 레인(${l.card} · ${l.ids.join(', ')})이다. 목표: 이 보드들의 값 슬롯을 키움 응답 필드에 바인딩해 "Paper 텍스트 = 필드 값" 계약을 완성한다. Read: 헌장 ${CHARTER} §2.2(3층)·§3.1(H1)·§4(표준 열). 보드마다 Read할 것: ${TPL}\\<board>\\slots.json(스켈레톤: slots[]{slot_id,node_id,node_name,kind(label|value),paper_text,region,layer,table{table_id,row,col},mapping_id,f,format}, column_bindings[]), ${TPL}\\<board>\\meta.json, ${PACK}\\<board>.pack.json(이 보드 op들의 원장 필드: mapping_id·f·kor·layer·where·attributed_here·extra_op). board.html·paper.jsx는 크므로 필요한 부분만 Grep으로 확인.
작업(보드마다):
1) 표: column_bindings의 각 열에 header(열 헤더 텍스트)↔팩 필드 kor(또는 where의 열 설명)로 mapping_id/f를 기입. 셀 슬롯 전파는 ${PY} ${ROOT}\\scripts\\paper_board_extract.py <board> --apply-columns --no-index 로. 스택 셀(같은 셀에 두 텍스트: 예 "150,850" / "+1,850 · +1.24%")은 둘째 줄을 병기(layer 병기, paired_with = 첫 줄 슬롯 id)로 별도 필드(전일대비·등락률)에 바인딩 — 한 텍스트에 값이 2개면(“+1,850 · +1.24%”) 슬롯 하나에 mapping 2개를 줄 수 없으니 mapping은 첫 값 필드, "extra_fields":[{mapping_id,f,sep:" · "}] 로 둘째 값을 선언.
2) KPI·레일·푸터·헤더 값 슬롯: 같은 행의 라벨 슬롯(직전 형제)이나 블록 제목을 kor/where와 맞춰 mapping_id/f 기입. 시각·날짜·상태 표기도 해당 필드가 있으면 바인딩(없으면 kind:"static"으로 표시 — 고정 문구). 라벨(kind:label)은 바인딩하지 않는다.
3) 관계: 영값 묶음 행("항목명 나열 / 0원 N항목 ▸")은 rollup 슬롯에 collapse_group {group_id, members:[{mapping_id,f}...], expanded_board:"<X 보드 id>"} · 헤더 KPI 등 다른 보드와 같은 필드의 재표시는 display_dup:true · 별칭 충돌(ka01690 buy_wght, ka90002 flu_rt)은 json_path 지정.
4) column_priority(표마다 표준 열 세트 순서, 헌장 §4), section_titles_ko(영역·블록 제목 한글), state.parent_board가 null이면 채움(CC-05 탭 보드 부모 = 2QFO-2, 수급 순위 자식 부모 = 2V71-0, 종목찾기 자식 부모 = 13K0-2).
5) 팩의 suggested_extra_ops 필드가 이 보드에 그려져 있으면 바인딩하고 meta.json operation_refs에 그 op 추가(증명 페이지 17F8-2에만 귀속됐던 105 필드의 재귀속).
6) 검증: ${PY} ${ROOT}\\scripts\\validate_board_slots.py <board> — attributed_here 미바인딩 0을 목표(정말 그려지지 않은 필드는 "unbound_reason"에 사유 기록). 다른 레인의 보드는 절대 편집 금지, index.json은 건드리지 않는다(--no-index).
보고(원시 데이터): 보드별 바인딩 수/값 슬롯 수, 미바인딩 필드(kor·사유), 추가한 operation_refs, 남은 문제.`

const C3 = `너는 C3 — 실시간·검증 하네스. Read ${ROOT}\\docs\\architecture\\canvas-tabs-responsive-plan.md §5, app/canvas.js(보드 경로), app/lib/board-mount.js, app/lib/main/integrated-card-realtime.js, app/lib/semantic-workspace.js(applyRealtimeTick:1198), app/verify-integrated-cards.js. ${NODE}; cd ${ROOT}/app && npm run test:unit(기준선 2,015).
1) 실시간 슬롯 매핑: 봉투 surface_contract.slot_values의 슬롯이 realtime_bindings(observation/binding id)와 같은 occurrence를 가리키면 binding_id→slot_id 표를 만들어(백엔드 card_surface_contract가 slot_values에 occurrence_id를 이미 싣는지 확인, 없으면 프론트에서 mapping_id+f로 매칭) semantic_updates 프레임이 오면 해당 잎 텍스트만 갱신(포맷터 적용, paired 슬롯 동기). 테스트 추가.
2) verify-integrated-cards: 탭 덱 인지(각 카드 탭 활성 후 캡처), 창 크기 프리셋 4종(원본 1920×1080 · 2분할 960×1080 · 4분할 640×540 · 최소 480×420)으로 보드 캡처, 단계별 텍스트 다중집합 상등(P5: 접힘은 이동이지 삭제 아님 — DOM 텍스트 비교) 검사. fixture 모드 유지. 실행해 결과 보고.
보고(원시 데이터): 파일·테스트 수치·스크린샷 경로.`

phase('추출기 보강')
const a3 = await agent(A3, { label: 'A3:extractor' })

phase('슬롯 저작')
const [authored, c3] = await parallel([
  () => parallel(lanes.map(l => () => agent(authorPrompt(l), { label: `author:${l.card}:${l.ids[0]}`, phase: '슬롯 저작' }))),
  () => agent(C3, { label: 'C3:realtime-verify', phase: '슬롯 저작' }),
])

phase('게이트')
const gate = await agent(`너는 웨이브 2-B 게이트다. ① cd ${ROOT} && ${PY} scripts/paper_board_extract.py(전수, index 갱신) → 96/96, --check 멱등 ② ${PY} scripts/validate_board_slots.py 전 보드 → 보드별 미바인딩 수 표 ③ cd ${ROOT}\\backend && ${NODE} && uv run python -c "from athena_api.card_surface_templates import load_registry; r=load_registry(); print(r.validation_problems(strict=True)[:40])" 형태로 strict 검증 결과(가시 필드 커버리지 n/3,532, 비노출 슬롯, 중복, 상태 참조) ④ PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py 출력 ⑤ ${NODE}; cd ${ROOT}/app && npm run test:unit(기준선 2,015+, board-parity 전수 마운트 포함) ⑥ cd ${ROOT}\\backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py -q. 소규모 결함은 고치고, 보고(원시 데이터): 바인딩률(카드별·층별), 미바인딩 상위 원인, 테스트 수치, 남은 문제.`, { label: 'gate:w2b' })
return { a3, lanes: lanes.length, c3, gate }