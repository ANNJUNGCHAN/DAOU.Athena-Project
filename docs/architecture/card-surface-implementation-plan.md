# 카드 표면 구현 계획 — Paper 보드 원본 추출 방식 (v1, 2026-09-02)

> 사용자 제약: **카드는 Paper 디자인에 있는 카드만, 디자인은 완전 동일.** 이 문서는 아키텍트 설계(읽기 전용 에이전트 산출)를 보존하고, 「확정 결정」을 상위 규칙으로 둔다. 폭 문제(D3)는 사용자 결정 대기.

## 확정 결정

| # | 결정 |
|---|---|
| D1 | 템플릿 = Paper `get_jsx`(inline-styles, 토큰 바인딩) 추출 정적 HTML(불변, `html_sha256` 고정) + 별도 `slots.json`. 런타임 레이아웃 재조립·신규 레이아웃 프리미티브 없음. 예외 = 호가 사다리·AITS 차트(Paper 보드가 앱 렌더러를 담은 자리, 삭제 금지). |
| D2 | 보드↔op N:M(보드 1장 최대 29 op, op 1개 최대 6 보드) → 봉투를 **보드 단위 fetch-set**(`operation_refs` 복수)으로 승격. 일부 op 실패 시 해당 슬롯만 `미제공`. |
| D3 | **폭 — 사용자 결정 대기.** 캔버스 실폭 ≈ 788px(창 1520 기준: 패딩 20+gap 20+이력 268+채팅 400+그리드 패딩 24) vs 보드 1440px. 후보: (A) 1440 그대로 + `zoom=clamp(w/1440, 0.8, 1)` + 보드 포커스 시 이력 사이드바 44px 레일로 접기 / (B) 캔버스 폭 압축 보드를 Paper에서 새로 디자인 / (C) A 선구현 후 B 후속. |
| D4 | 병기(`paired_with`) 슬롯은 주값과 같은 프레임에 갱신. |
| D5 | 순위 27장·펼침 X 보드·탭 상태 = 각각 독립 템플릿. 앱 조작(칩/탭/▸) = 템플릿 교체. |
| D6 | `layer`는 원장 백필이 아니라 **추출 시 DOM에서 판정**: X 보드 슬롯 = 펼침, 2줄 셀 둘째 줄(11px·k-dim/k-faint) = 병기, 그 외 = 직접. 판정 결과로 원장 역갱신. |
| D7 | 추출은 에이전트가 Paper MCP(`get_jsx` + `get_tree_summary` depth 10)로 원문을 저장하고, `scripts/paper_board_extract.py`가 JSX→HTML 변환·슬롯 스켈레톤(문서 순서 텍스트 노드 ↔ 트리 이름 `raw|<tr>|body|<field>`/`mapping|<id>` 앵커)·검증(밀도 예산·해시)을 맡는다. |

## 원칙 0

앱은 Paper 디자인에 있는 보드 외의 어떤 카드 외형도 키움 데이터에 대해 그리지 않는다. 기존 `paperCardRoute`의 `blocked` 게이트(`app/lib/paper-card-routing.js:29-42`)가 이 원칙의 기존 구현이며, `'generic'` 경로는 키움 봉투에 대해 영구 제거한다.

## 1. 설계를 규정하는 사실

- **F1 보드↔op N:M.** `2SKU-1`은 29개 mapping, `17F8-2`는 28개에서 값을 받고, `base:ka10085`·`base:04`는 6개 보드에 걸친다(299 op 중 125개가 2개 이상 보드). 봉투는 `_integrated_card_contract(operation_ref)` 1개 기준(`canvas_push.py:716`, `canvas_data.py:60`). 훅은 이미 있음: `operation_refs`(`canvas_push.py:138`), `verifiedOperationRefsFor`(`integrated-card-surface.js:80-85`).
- **F2 원장 `layer` 결손.** 3,534행 중 1,839행에 `layer` 없음(초기 감사분). → D6으로 해소.
- **F3 `where`는 산문.** 기계 앵커는 Paper 노드 이름 규약(`raw|<tr>|body|<field>` / `mapping|<id>`, 핸드오프 §9)뿐.
- **F4 보드 93장.** 원장 distinct board 93 + 공유 2장(`2RJ7-1` CC-03/05, `2QM7-2` CC-05/06).
- **F5 캔버스 실폭 ≈ 788px.** `app/main.js:170` shellW 1520, `app/shell.css:79` 268, `:2713` 400, `:2731` 패딩 12. `column-fold.js:11`의 `DEFAULT_CANVAS_WIDTH_PX=1560`은 실측과 어긋남.

## 2. 표면 템플릿 스키마

```
backend/ref/card-surface-templates/
  index.json                 # 보드↔op↔카드↔상태 링크
  <board>/board.html         # get_jsx 추출물 — 편집 금지
  <board>/slots.json         # 슬롯 바인딩 표(편집 대상)
```

`slots.json` 골자: `board_id`·`card_id`·`paper_source{file,page,jsx_sha256}`·`html_sha256`·`width_px`·`height_px`·`operation_refs[]`·`state{kind: default|tab|sort|expand, parent_board, control}`·`density{table_columns≤8, kpi_cells≤6, rail_blocks≤5, rail_rows_max≤6, rows_max≤6}`·`slots[]{slot_id, node_path, mapping_id, f, kor, layer, region, format{unit, sign, precision, tone}, paired_with, collapse_group{group_id, rollup_slot, rule}, expanded_board, paper_text}`·`primary{renderer|null, mount_slot, module, props_from}`·`column_priority[]`·`section_titles_ko{}`. 전문 렌더러는 `primary`로 참조만. 밀도 예산 위반은 로더 예외.

## 3. 백엔드 계약

- 로더 `backend/athena_api/card_surface_templates.py`(신규, `lru_cache`, `index.json`+93 `slots.json`).
- `_integrated_card_contract`(`canvas_push.py:716`) 메타데이터에 `surface_contract{board_id, state_boards[], slot_values[], unbound_slots[], column_priority, section_titles_ko}` 추가. 값 바인딩은 `_bind_semantic_values`(`:599`)의 JSONPath 경로 재사용, `slot_id`로 색인. `_SECTION_TITLES_KO`(`:497`)는 슬롯 표로 이관.
- **MCP parity**: `canvas_data.py:60`과 REST 계약 파생을 공유 헬퍼로 통합(신뢰 게이트 불변 — 핸드오프 §3 회귀 금지).
- fail-closed 6종: 3,532 가시 필드 정확히 1회 바인딩 / 비노출 173 슬롯 금지 / 299 op 전부 어떤 보드의 `operation_refs`에 존재 / `html_sha256` 일치 / 밀도 예산 / 상태 보드 참조 무결성. `coverage_receipt.lossless` op의 semantic occurrence는 어떤 슬롯에 도달해야 함.
- 테스트: `test_card_surface_templates.py`·`test_card_surface_coverage.py`·`test_canvas_push.py` 확장·`test_canvas_data_parity.py`·`test_canvas_card_registry.py` 확장.

## 4. 프론트 렌더러

신규 3모듈만: `app/lib/board-template-registry.js`(93 HTML 문자열 색인, `<script src>`) · `app/lib/board-mount.js`(`<template>` 1회 파싱→`cloneNode`, `textContent`로만 슬롯 치환) · `app/lib/board-format.js`(한국어 단위·부호+색·정밀도, `facts-card.js` 포맷터 재사용). 기존 자산: `card-primitives.js`는 전문 렌더러 내부 전용, `semantic-workspace.js`는 task-canvas 전용, `column-fold.js`는 보드 경로 미사용, `ranking-axis.js`는 순위 상태 control, `card-kind-호가.js`·AITS 차트는 `primary.renderer`.
통합: `canvas.js:612 renderPrimaryEnvelope`에서 `surface_contract`가 있으면 `boardMount.render(envelope)`; `mountOrUpdate`(`integrated-card-surface.js:289`) 무변경; 실시간 tick은 `realtime_binding_id→slot_id`로 텍스트 노드만 갱신(`applyRealtimeTick` 패턴). CSS는 `.board-surface{width:1440px; zoom: var(--board-zoom)}` 컨테이너 규칙 한 묶음.

## 5. 파리티 검증

P1 텍스트 노드 다중집합 상등(`app/lib/board-parity.test.js`, 93 케이스) · P2 구조 해시 · P3 `verify-integrated-cards` 93샷 확장 · P4 `scripts/card_surface_coverage.py` → `CARD_SURFACE_COVERAGE.md`(현황판 연동).

## 6. 웨이브

- **W0 착수 게이트**: 보드 93 확정 · 노드 앵커 커버리지 실측(`get_tree_summary`) · D3 폭 결정.
- **W1 기반+저작(병렬)**: A 추출기(선행) → E1~E6 카드별 저작(공유 2장은 CC-05 단독) ∥ B 백엔드 로더·fail-closed·테스트 ∥ C 프론트 3모듈+단위 테스트 ∥ D 현황판. 완료: 93 `board.html`+`slots.json`, 로더 통과, `node --test app/lib/board-*.test.js` 0 실패.
- **W2 배선(순차)**: `surface_contract` 봉투 탑재 + MCP 통합 + `renderPrimaryEnvelope` 분기 + 상태 보드 전환 + 실시간 슬롯. 완료: P1 93/93 · P2 · backend 전수 무회귀(기준 2,638 passed/5 skipped) · app 전수 무회귀(1,702).
- **W3 실앱 QA**: 93샷 · 실키움 1회 · 헌장 게이트 · 마일스톤 PDF 승인.

## 7. 리스크

R1 앵커 커버리지 미달 → 수작업 매핑 비용 · R2 폭(D3) · R3 `column-fold` 1560 가정 격리 · R4 추출 HTML 인라인 스타일과 앱 CSS 충돌(보드 1장으로 조기 실증) · R5 Paper MCP는 오프라인/CI 불가 → 추출물 정적 커밋 + 해시 드리프트 검사.
