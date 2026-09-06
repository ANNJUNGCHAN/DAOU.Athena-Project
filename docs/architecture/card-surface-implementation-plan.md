# 카드 표면 구현 계획 — Paper 보드 원본 추출 방식 (v1, 2026-09-02)

> 사용자 제약: **카드는 Paper 디자인에 있는 카드만, 디자인은 완전 동일.** 이 문서는 아키텍트 설계(읽기 전용 에이전트 산출)를 보존하고, 「확정 결정」을 상위 규칙으로 둔다. 폭 문제(D3)의 5단 컨테이너 기하 계약은 구현됐지만 glyph 가독성 계약은 W3 육안 gate 실패로 보강 대기다.

## 확정 결정

| # | 결정 |
|---|---|
| D1 | 템플릿 = Paper `get_jsx`(inline-styles, 토큰 바인딩) 추출 정적 HTML(불변, `html_sha256` 고정) + 별도 `slots.json`. 런타임 레이아웃 재조립·신규 레이아웃 프리미티브 없음. 예외 = `slots.json`의 `primary.renderer`가 선언된 자리 한 곳(`mount_slot` 또는 `.bs-primary`). 그 자리의 Paper 목업 자식은 숨기고(삭제 금지, 원래 display 보관) 앱 렌더러를 얹는다. 마운트 실패 시 목업을 되돌리고 오류를 표시한다. `primary.renderer`가 null인 보드는 예외가 없다 — 라우팅이 그 보드를 피하지 않는다. |
| D2 | 보드↔op N:M(보드 1장 최대 29 op, op 1개 최대 6 보드) → 봉투를 **보드 단위 fetch-set**(`operation_refs` 복수)으로 승격. 일부 op 실패 시 해당 슬롯만 `미제공`. |
| D3 | **폭 — 기하 계약 확정, glyph 계약 보강 대기.** Paper 원문 기하는 XL에서 유지하고 L/M/S/XS는 `.board-surface` 컨테이너 쿼리와 `--bs-width`, `--bs-height`, `--bs-flex-*` hoist로 열 접힘·KPI 재배치·rail 이동을 수행한다. `zoom` 축소는 사용하지 않는다. surface overflow와 element-box 겹침 하드 검증은 구현됐지만 5보드의 문자 분절·text-range 충돌을 놓쳤으므로 explicit responsive role·atomic/paired row 및 glyph hard gate 승인 전에는 D3 전체 완료로 보지 않는다. |
| D4 | 병기(`paired_with`) 슬롯은 주값과 같은 프레임에 갱신. |
| D5 | 순위 27장·펼침 X 보드·탭 상태 = 각각 독립 템플릿. 앱 조작(칩/탭/▸) = 템플릿 교체. |
| D6 | `layer`는 원장 백필이 아니라 **추출 시 DOM에서 판정**: X 보드 슬롯 = 펼침, 2줄 셀 둘째 줄(11px·k-dim/k-faint) = 병기, 그 외 = 직접. 판정 결과로 원장 역갱신. |
| D7 | 추출은 에이전트가 Paper MCP(`get_jsx` + `get_tree_summary` depth 10)로 원문을 저장하고, `scripts/paper_board_extract.py`가 JSX→HTML 변환·슬롯 스켈레톤(문서 순서 텍스트 노드 ↔ 트리 이름 `raw|<tr>|body|<field>`/`mapping|<id>` 앵커)·검증(밀도 예산·해시)을 맡는다. |

## 원칙 0

앱은 Paper 디자인에 있는 보드 외의 어떤 카드 외형도 키움 데이터에 대해 그리지 않는다. 기존 `paperCardRoute`의 `blocked` 게이트(`app/lib/paper-card-routing.js:29-42`)가 이 원칙의 기존 구현이며, `'generic'` 경로는 키움 봉투에 대해 영구 제거한다.

## 1. 설계를 규정하는 사실

- **F1 보드↔op N:M.** `2SKU-1`은 29개 mapping, `17F8-2`는 28개에서 값을 받고, `base:ka10085`·`base:04`는 6개 보드에 걸친다(299 op 중 125개가 2개 이상 보드). 봉투는 `_integrated_card_contract(operation_ref)` 1개 기준(`canvas_push.py:716`, `canvas_data.py:60`). 훅은 이미 있음: `operation_refs`(`canvas_push.py:138`), `verifiedOperationRefsFor`(`integrated-card-surface.js:80-85`).
- **F2 원장/visible universe.** semantic authority 후보는 3,534개다. 카드 표면 visible universe는 예비 `base:04` FID 924·951을 제외한 3,532개이며 hidden authority는 불변이다. 초기 감사에서 1,839행에 `layer`가 없었고 D6으로 해소했다.
- **F3 `where`는 산문.** 기계 앵커는 Paper 노드 이름 규약(`raw|<tr>|body|<field>` / `mapping|<id>`, 핸드오프 §9)뿐.
- **F4 보드.** 최초 원장 distinct board 93장이었고, 현재 상태 보드를 포함한 runtime registry는 96장이다. 공유 보드는 `2RJ7-1`(CC-03/05), `2QM7-2`(CC-05/06)다.
- **F5 캔버스 실폭 ≈ 788px.** `app/main.js:170` shellW 1520, `app/shell.css:79` 268, `:2713` 400, `:2731` 패딩 12. `column-fold.js:11`의 `DEFAULT_CANVAS_WIDTH_PX=1560`은 실측과 어긋남.
- **F6 상태 링크의 정본은 생성물 색인이다.** `scripts/paper_board_extract.py`의 `mark_state_controls`가 부모 `board.html`의 잎에 `data-state-control`·`data-state-board`를 찍고(2026-09-05 실측: 해소 83 · 미해소 0), `scripts/build_board_registry.py`가 그것을 `STATE_GRAPH`로 투사한다. 프론트는 봉투가 아니라 `app/lib/board-template-registry.js`의 `stateLinksFor()`를 정본으로 쓴다 — 봉투는 마운트한 그 보드의 **직계 자식만** 나르므로(`card_surface_contract.py`의 `_state_boards`) 상태 보드로 갈아탄 뒤에는 형제 탭도 되돌아갈 길도 목록에 없어 레일이 통째로 죽는다. 색인은 제 자식 + 부모 레일 전부를 주고, 되돌아가는 칩은 부모 레일에 부모 자신을 여는 표식이 있을 때만 나온다(레일 주인이 없는 보드에 칩을 지어내지 않는다). 색인이 모르는 보드(픽스처 계약)에서만 봉투가 실어온 목록을 그대로 쓴다.

## 2. 표면 템플릿 스키마

```
backend/ref/card-surface-templates/
  index.json                 # 보드↔op↔카드↔상태 링크
  <board>/board.html         # get_jsx 추출물 — 편집 금지
  <board>/slots.json         # 슬롯 바인딩 표(편집 대상)
```

`slots.json` 골자: `board_id`·`card_id`·`paper_source{file,page,jsx_sha256}`·`html_sha256`·`width_px`·`height_px`·`operation_refs[]`·`state{kind: default|tab|sort|expand, parent_board, control}`·`density{table_columns≤8 · rows_max≤22(표 본문 20+합계 2) · height_px≤1,120 = 하드; kpi_cells≤6 · rail_blocks≤5 · rail_rows_max≤6 = 소프트 경고}` (2026-09-03 정정 — 로더 `DENSITY_BUDGET`이 정본)·`slots[]{slot_id, node_path, mapping_id, f, kor, layer, region, format{unit, sign, precision, tone}, paired_with, collapse_group{group_id, rollup_slot, rule}, expanded_board, paper_text}`·`primary{renderer|null, mount_slot, module, props_from}`·`column_priority[]`·`section_titles_ko{}`. 전문 렌더러는 `primary{renderer, mount_slot, module, props_from}`로 선언한다. `mount_slot`은 `board.html`의 `data-node` id이며 생략하면 `.bs-primary`가 기본이다. 이 블록은 `scripts/build_board_registry.py`가 프론트 청크·색인으로 투사하고 `app/lib/board-template-registry.js`의 `contractFor()`·`primaryRendererFor()`가 돌려준다. **투사되지 않으면 프론트는 `primary`의 존재 자체를 모른다** — 2026-09-05 시점의 결함이었다. 밀도 하드 위반·중복·상태 참조 오류는 로더가 **그 보드만 제외**(`registry.excluded_boards`, 2026-09-03 보드별 격리)하고 `load_registry(strict=True)`(CI)만 예외를 던진다. `extra_fields`는 일부 JSON에 저작돼 있으나 loader, validator coverage, snapshot contract, realtime renderer가 소비하는 승인 계약이 아니다. additive composition으로 승격하려면 per-part format/order/template/prefix/optional·missing/row/aspect/realtime 정책 승인과 migration이 먼저 필요하며, 그 전에는 coverage로 세지 않는다.

## 3. 백엔드 계약

- 로더 `backend/athena_api/card_surface_templates.py`(`lru_cache`, `index.json`+96 `slots.json`).
- `_integrated_card_contract`(`canvas_push.py:716`) 메타데이터에 `surface_contract{board_id, state_boards[], slot_values[], unbound_slots[], column_priority, section_titles_ko}` 추가. 값 바인딩은 `_bind_semantic_values`(`:599`)의 JSONPath 경로 재사용, `slot_id`로 색인. `_SECTION_TITLES_KO`(`:497`)는 슬롯 표로 이관.
- **MCP parity**: `canvas_data.py:60`과 REST 계약 파생을 공유 헬퍼로 통합(신뢰 게이트 불변 — 핸드오프 §3 회귀 금지).
- **최종 acceptance target:** 3,532 가시 occurrence를 exact semantic/unit/runtime 계약으로 표현한다. 현재는 3,382/3,532이며 exact leaf/schema가 없는 항목은 승인 전 fail-closed blocker로 유지한다. 그 밖의 fail-closed 게이트는 비노출 슬롯 금지 / 299 op 라우팅 / `html_sha256` 일치 / 밀도 예산 / 상태 보드 참조 무결성이다.
- 테스트: `test_card_surface_templates.py`·`test_card_surface_coverage.py`·`test_canvas_push.py` 확장·`test_canvas_data_parity.py`·`test_canvas_card_registry.py` 확장.

## 4. 프론트 렌더러

신규 3모듈만: `app/lib/board-template-registry.js`(96 HTML 문자열 색인, `<script src>`) · `app/lib/board-mount.js`(`<template>` 1회 파싱→`cloneNode`, `textContent`로만 슬롯 치환) · `app/lib/board-format.js`(한국어 단위·부호+색·정밀도, `facts-card.js` 포맷터 재사용). 기존 자산: `card-primitives.js`는 전문 렌더러 내부 전용, `semantic-workspace.js`는 task-canvas 전용, `column-fold.js`는 보드 경로 미사용, `ranking-axis.js`는 순위 상태 control, `card-kind-호가.js`·AITS 차트는 `primary.renderer`.
통합: `canvas.js:612 renderPrimaryEnvelope`에서 `surface_contract`가 있으면 `boardMount.render(envelope)`; `mountOrUpdate`(`integrated-card-surface.js:289`) 무변경; 실시간 tick은 `realtime_binding_id→slot_id`로 텍스트 노드만 갱신(`applyRealtimeTick` 패턴). CSS는 `.board-surface`의 container query와 `--bs-width`, `--bs-height`, `--bs-flex-*` hoist를 사용해 XL 원문 기하를 복원하고 L/M/S/XS에서 재배치한다. zoom 축소는 사용하지 않는다.

## 5. 파리티 검증

P1 텍스트 노드 다중집합 상등(`app/lib/board-parity.test.js`, 96 케이스) · P2 구조 해시 · P3 `verify-integrated-cards` 캡처 · P4 `scripts/card_surface_coverage.py` → `CARD_SURFACE_COVERAGE.md`(현황판 연동).

## 6. 웨이브

- **W0 착수 게이트(당시 기준)**: 보드 93 확정 · 노드 앵커 커버리지 실측(`get_tree_summary`) · D3 폭 결정.
- **W1 기반+저작(병렬)**: A 추출기(선행) → E1~E6 카드별 저작(공유 2장은 CC-05 단독) ∥ B 백엔드 로더·fail-closed·테스트 ∥ C 프론트 3모듈+단위 테스트 ∥ D 현황판. 현재 완료물: 96 `board.html`+`slots.json`, 로더 통과, 보드 단위 테스트 0 실패.
- **W2 배선(순차)**: `surface_contract` 봉투 탑재 + MCP 통합 + `renderPrimaryEnvelope` 분기 + 상태 보드 전환 + 실시간 슬롯. 현재 P1 96/96 · P2 · backend/app 무회귀.
- **W3 저작·실앱 QA**: 정비 A5/B4/C5/D3 및 저작 Tasks 1–8 실행·리뷰·canonical 재생성 완료. 현재 honest gap 150, validator 59건이다. nonvisual gate와 자동 geometry는 통과했지만 24장 육안 감사에서 5보드의 문자 분절/행 충돌이 발견돼 시각 gate는 FAIL이다. explicit responsive role·atomic text·paired row 계약과 glyph hard gate, composite schema/Paper leaf 결정, 재캡처, 실키움 1회, 헌장 gate, milestone PDF 승인이 남았다.

## 6.1 D1 예외의 소멸 조건

2026-09-04까지 `app/lib/paper-card-routing.js`의 `preservesAppPrimary`는 recipe 3종(instrument-chart·live-orderbook·order-safe-ticket)을 통째로 보드에서 빼는 방식으로 D1 예외를 구현했다. 그 판정 축은 틀렸다 — recipe는 제품 화면 종류이고, `detail:ka10001:current_trading`처럼 recipe를 빌려 쓰는 op까지 함께 빠졌다(`backend/athena_api/view_recipe_registry.py`의 `OPERATION_RECIPE_OVERRIDES`). 새 축은 **봉투가 필요한 앱 렌더러와 그 보드가 얹을 줄 아는 렌더러의 짝**이다: 차트는 manifest `presentation.renderer_id`(`aits-chart-v1`, 19 op), 호가·주문은 capability 배정 원장이 정본이고, 보드 쪽 사실은 `primary.renderer`를 색인이 동기로 답한다.

예외는 보드가 그 자리를 채울 수 있게 되는 순간 하나씩 사라진다.

- **AITS 차트** — 137X-2·32S7-0(`athena-chart`). 2026-09-06 소멸.
- **호가 사다리** — 13BC-2·1JPU-0(`orderbook-ladder`). 2026-09-06 소멸. 나머지 호가 보드(2QRP-1 시간외 5단·2QX1-1 금현물 5단·3N4O-0·3JT4-0 단계별 낱값)는 Paper가 앱 사다리와 **다른 그림**을 저작했으므로 마운트 지점을 두지 않고 Paper 원문 그대로 그린다 — 그 자리에 앱 10단 사다리를 얹는 것이 오히려 D1 위반이다. 대신 그 네 보드는 0D 호가잔량 실시간을 받지 않는다(그 리스는 사다리 마운트만 잡는다).
- **주문 티켓** — 아직 남아 있다. 주문 보드 12장(135M-2·2TAG-1 등)의 `primary.renderer`가 전부 null이라 가로채면 누를 수 없는 목업 주문 폼이 뜬다. 그 자리가 저작되고 canvas가 얹을 줄 알게 되면 `APP_PRIMARY_ORDER_OPS`를 지운다. 그 시점에 `preservesAppPrimary`는 차트 한 축만 남는다.

## 7. 리스크

R1 앵커 커버리지 미달 → 수작업 매핑 비용 · R2 폭(D3) · R3 `column-fold` 1560 가정 격리 · R4 추출 HTML 인라인 스타일과 앱 CSS 충돌(보드 1장으로 조기 실증) · R5 Paper MCP는 오프라인/CI 불가 → 추출물 정적 커밋 + 해시 드리프트 검사.
