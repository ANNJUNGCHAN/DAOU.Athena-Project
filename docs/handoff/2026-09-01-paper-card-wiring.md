# 핸드오프 — Paper 카드 배선 (2026-09-01)

브랜치 `wip/paper-card-routing` / 기준 커밋 `b308ac7`

## ⚠ 제일 먼저 확인할 것

커밋 `b308ac7`에는 **되돌리기 전(잘못된) `canvas_push.py`** 가 들어가 있다.
architect 리뷰가 잡아낸 보안 회귀를 되돌린 수정은 그 커밋 **뒤**에 있다.
이어받는 쪽은 되돌리기가 반영됐는지부터 확인해야 한다.

```bash
git -C <repo> log --oneline -3
git -C <repo> grep -n "_generic_push_semantic_source" -- backend/athena_api/api/canvas_push.py
```

`_generic_push_semantic_source`가 **검색되면 되돌리기가 안 된 상태**다 (아래 §3 참고).

## 1. 이 작업이 뭘 하려던 건가

Paper 디자인의 카드(CC-01~CC-06 + 12 recipe)만 캔버스에 뜨게 하고,
사용자 질문이 맞는 카드로 라우팅되게 만드는 것.

## 2. 이미 사실로 확인된 것 (다시 조사하지 말 것)

- **Paper 카드는 이미 프로덕션에 배선돼 있었다.** `card_id`(CC-01..06)는
  `canvas_card_registry.resolve_canvas_card(operation_ref)`가 capability 기준으로
  결정하고 호출자가 못 바꾼다. recipe는 `view_recipe_registry.for_operation()`.
- **디스패치 순서** (`app/canvas.js` `addLiveCard`):
  (A) `card_id` 있으면 `renderIntegratedCard` → (B) `presentation_contract` 있으면
  `renderTaskCanvasEnvelope` → (C) 그 외 generic.
- **레거시 16개 `card-kind-*.js`는 잔재가 아니다.** `resolve_fixed_card_title`을
  299개 op에 돌리면 **전부** 16 title 중 하나로 매핑된다(untitled 0).
  canvas.js는 CardKinds 성공 시 `semanticPrimary='specialized'`를 붙여
  그 결과를 CC 카드의 **primary 표면**으로 쓴다.
  → CC-04의 호가 래더, CC-03의 AITS 차트가 바로 이 렌더러들이다. **삭제 금지.**
- **selector는 LLM/임베딩이 아니다.** `selector/ranking.py`의 결정적 어휘 zone 스코어링.
- **`/api/v1/canvas/push`의 유일한 프로덕션 호출자**는
  `athena_mcp/canvas_data.py`의 `render_with_plan` 하나뿐이고(`:256` 계약 생성 → `:359` POST),
  이미 `_integrated_card_contract`를 실어 보낸다.
- `resolveQuery` 6중복은 이미 `775f2c9`에서 단일 슬롯 메모로 해결돼 있다.

## 3. 되돌린 변경 — 왜 되돌렸는지 (다시 하지 말 것)

`canvas_push`가 canonical `operation_ref`만 있으면 **항상** 카드 계약을 파생하도록
넓혔다가 되돌렸다.

- 내 전제("모델이 MCP로 미는 블록에는 카드 필드가 없다")가 **틀렸다.**
  유일한 호출자가 이미 카드 필드를 싣는다 → 기존 게이트로 충분했다.
- 넓히면 **bearer 검사가 없는** 엔드포인트에서 TR 이름 하나만 대면
  호출자 `data`가 `lossless: true` 딱지 붙은 공식 카드로 세탁된다.
  `_bind_semantic_values`가 호출자 데이터에 처음으로 적용되는 것도 이때다.
- 사용자 목표("키움 데이터는 Paper 카드로만")는 **프론트엔드 `blocked` 가드만으로 충족**된다.

되돌리기의 최종 상태: `canvas_push.py`는 세션 시작 시점과 **의미가 동일**하고,
왜 게이트가 좁아야 하는지 설명하는 주석만 추가돼 있다. `_generic_push_semantic_source`
헬퍼는 삭제됐다. `tests/api/test_canvas_push.py`에 신뢰 경계를 고정하는 테스트 2건이 있다.

## 4. 실제로 바꾼 것

**프론트엔드 (핵심 수정)**
- `app/lib/paper-card-routing.js` (신규) — 디스패치 판정을
  `integrated | workspace | blocked | generic`으로 분리. canvas.js는 shell.html에서만
  도는 렌더러라 `node --test`가 안 걸려서 판정만 떼어냈다.
- `app/lib/paper-card-routing.test.js` (신규 6건)
- `app/canvas.js` — `operation_ref`를 가진 키움 봉투가 카드 계약 없이 도달하면
  레거시 범용 카드로 떨어뜨리지 않고 `blocked` → 원인을 드러낸다.
- `app/shell.html` — 새 모듈을 `canvas.js`보다 먼저 로드
- `app/lib/integrated-card-surface.test.js` — 소스 계약 테스트를 새 구조로 갱신

**백엔드**
- `backend/athena_api/api/canvas_push.py` — 로직 변경 없음, 설명 주석만
- `backend/tests/api/test_canvas_push.py` — 신뢰 경계 고정 테스트 2건
- `backend/tests/unit/test_question_to_card_routing.py` (신규) — 38 라우팅 케이스 + 1 커버리지

## 5. 검증 결과

| 항목 | 결과 |
|---|---|
| app `npm run test:unit` | 1,702 passed / 0 failed (베이스라인 1,695) |
| backend 전수 | 2,545 passed / 5 skipped / 0 failed (베이스라인 2,504) |
| `verify-integrated-cards` | 6 카드 / 299 op / 3,705 field / missing 0 / unresolved 0 |
| `verify-semantic-workspaces` | 12 recipe, exit 0 |
| `verify-hoga-live` | exit 0 / rows 20 / card true |
| ruff | 변경 파일 clean, 리포 전체 기존 9건 그대로 |

런타임 receipt: live-orderbook `orderbook_sides {ask_rows:10, bid_rows:10}`,
instrument-chart `candle_count 6`, 둘 다 `primary_renderer_preserved: true`.

> ⚠ 위 backend 2,545는 **되돌리기 전** 코드로 돈 결과다. 되돌리기 반영 전수 실행은
> 중단됐다(79%까지 무실패). 이어받으면 `pytest -q` 한 번 다시 돌릴 것. 약 25분.

**모든 런타임 근거는 fixture 기반이다** (`fixture_only: true`,
`live_kiwoom_connectivity_verified: false`). 실 키움 연결은 검증되지 않았다.

## 6. 하지 않은 것 (의도적)

"기존 카드 전부 삭제"를 **하지 않았다.** §2의 근거대로 16 렌더러는 6개 Paper 카드의
본문이라, 삭제하면 호가 래더와 AITS 차트가 사라져 확정된 목표(AITS 차트 유지,
고밀도 호가 래더)를 깬다. 대신 "16개 독립 카드"라는 **개념**을 제거했다 —
키움 봉투는 이제 CC 카드나 semantic workspace로만 렌더되고 그 외는 차단된다.

## 7. 남은 일

1. **되돌리기 반영 backend 전수 재실행** (약 25분)
2. **Paper 캡처 불가** — `export`가 `No DOM element found`. 캔버스가 마운트되지 않은
   상태라 헤드리스로 못 푼다. Paper 창을 포그라운드로 올리고 `카드` 페이지를 띄운 뒤
   재시도해야 최종 시각 검수가 가능하다.
3. **Paper 페이지 정리** — 현재 7개(화면/그래프/카드/에이전트/플러그인/키우미/백테스트).
   목표는 화면·카드·백테스트 3개. Paper MCP에 `delete_page`가 없어 **UI에서 수동 삭제** 필요.
4. **ELW·금현물 라우팅** — 두 종류는 "이 ELW의 / 이 금현물의" 지시어가 있어야 라우팅된다
   (`IDENTITY_MARKET_KINDS`가 STOCK/ETF만 매핑). 결함은 아니다: 질문에 종목명이 없고,
   프로덕션은 search 단계의 `candidate_refs`/`preferred_ref`를 함께 넘긴다.
   확장하려면 `ka10099`의 `mrkt_tp` 3(ELW)/80(금현물)을 쓰면 되는데,
   금현물 단축코드가 기존 `\d{6}` 필터를 통과하는지 실응답으로 먼저 확인해야 한다.

## 8. 인접 변경 (이 세션이 만든 게 아님)

`semantic_presentation_registry.py`와 `tests/api/test_task_canvas_envelope.py`는
세션 시작 시점부터 dirty였던 기존 WIP다. `field_class == "unresolved"`를 숨김에서
중립 라벨 노출로 뒤집어 "unresolved는 product presentation에 안 들어간다"는 기존
보장을 바꾼다. `docs/architecture/task-adaptive-semantic-canvas.md`에 의도된 결정으로
문서화돼 있으나, 파일명으로만 리뷰 범위를 좁히면 놓치기 쉬워 여기 남긴다.

## 9. Paper 참고

- 파일 `01M0VGPX92K1TER4ZV9PWGQJJZ`, 카드 페이지 `5-1`
- 커버리지 증명 규약: 그룹 프레임 이름 `mapping|<mapping_id>` — 299/299,
  occurrence 3,534/3,534, 누락 0. 계좌 보드는 칩에 `raw|<alias>`까지 있다.
- Paper MCP의 `get_children`/`get_basic_info.artboards`는 **100개에서 잘린다.**
  전수 열거는 root에 `get_tree_summary depth 1`.
