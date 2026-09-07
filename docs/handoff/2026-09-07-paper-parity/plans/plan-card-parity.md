# 캔버스 카드 = Paper 카드 보드 — 설계 계획서

- 대상 저장소: `C:\Projects\DAOU.Athena` (main, HEAD `c33ef0a`)
- 성격: 읽기 전용 설계. 이 문서는 구현 지시서이며 코드는 건드리지 않았다.
- 목표 문장: **「삼성전자 시세」가 범용 통합 카드가 아니라 Paper CC-03 현재시세 보드(`2R3M-1`)로 그려진다.**

---

## 0. 요약

전달받은 인과 1~7은 전부 코드에서 재확인됐고, 그 위에 **추가로 세 개의 확정 결함**을 찾았다.

| # | 새 발견 | 근거 |
|---|---|---|
| N1 | 앱 렌더러 판정의 정본 축은 recipe가 아니라 **manifest `presentation.renderer_id`(`aits-chart-v1`, 정확히 19개 op)** 이고, 이 값은 이미 봉투에 실려 온다 | `backend/athena_api/api/canvas_push.py:2032-2033`, `backend/athena_api/canvas_transform.py:306` |
| N2 | 상태 보드 전환 링크는 **`board.html` 안에 이미 `data-state-control` / `data-state-board`로 저작돼 있다** — 봉투의 `state_boards`가 없어도 자식 링크는 DOM만으로 복원된다. 없는 것은 **부모(되돌아가기)** 하나뿐이다 | `backend/ref/card-surface-templates/137X-2/board.html`, `scripts/paper_board_extract.py:1770-1772` |
| N3 | 13K0-2 하이드레이션이 항상 빈손인 이유는 **두 개**다: (a) `Authorization: Bearer` 헤더 미전송 → 401, (b) 응답 모양이 `surface_contract.slot_values`인데 프론트는 최상위 `slot_values`를 읽는다 | `app/lib/main/board-hydrate.js:71-77, 96`; `backend/athena_api/api/canvas_push.py:1075-1113`; `backend/tests/api/test_canvas_push.py:467-471, 514-517` |

핵심 판단: **A(라우팅 축 교체)와 D-1(링크 재계산)은 지금 바로 독립 커밋 가능하고, C(보드 내 라이브 렌더러 마운트)가 이 작업의 유일한 진짜 위험 구간이다.** B는 A·D가 끝나면 3줄짜리 결정이 된다.

---

## 1. 실측으로 확정한 사실

### 1.1 지금 「삼성전자 시세」가 도는 경로

```
app/lib/main/rest-dataset-runner.js:1026 buildQuoteDataset
  → operationRef 'detail:ka10001:current_trading', args {stk_cd}
backend canvas_push render-plan
  → canvas_kind 'facts'(manifest layout=facts), renderer_id 없음
  → card_contract: card_id CC-03 / card_title '종목정보'
  → surface_contract.board_id '137X-2' (base_board_for)
  → presentation_contract.recipe_id 'instrument-chart' (OVERRIDES)
app/canvas.js:713-720 paperCardRoute → 'integrated'
app/canvas.js:1009 renderIntegratedCard → 1021 renderPrimaryEnvelope
app/canvas.js:728 preservesAppPrimary(envelope) === true  ← recipe 'instrument-chart'
  → renderBoardSurfaceCard 호출 안 됨
app/canvas.js:1693 renderFactsCard → card-kind-종목정보 QuoteHeader
app/canvas.js:1706 wireQuoteRealtime(0B)
app/canvas.js:1094 semanticWorkspace.upsert → semantic-workspace 본문
```

- `backend/athena_api/view_recipe_registry.py:55-57` — `OPERATION_RECIPE_OVERRIDES = {"detail:ka10001:current_trading": "instrument-chart"}`.
- `app/lib/paper-card-routing.js:47` — `APP_PRIMARY_RECIPES = {instrument-chart, live-orderbook, order-safe-ticket}`.
- 결론: **시세 op가 차트 recipe를 빌려 쓴 것이 그대로 "앱 렌더러 보호" 판정으로 새어 들어갔다.** recipe는 *제품 화면 종류*이고 preserve 판정이 물어야 할 것은 *이 봉투를 앱 렌더러가 그리는가*다. 축이 틀렸다.

### 1.2 정규식이 삼키는 것 / 놓치는 것

`app/lib/paper-card-routing.js:56` `/^base:ka1008[1-5]$/i`

| TR | `kiwoom-tr-inventory.json` 이름 | manifest `renderer_id` | 현재 정규식 |
|---|---|---|---|
| ka10081 | 주식일봉차트조회요청 | aits-chart-v1 | 맞음 |
| ka10082 | 주식주봉차트조회요청 | aits-chart-v1 | 맞음 |
| ka10083 | 주식월봉차트조회요청 | aits-chart-v1 | 맞음 |
| **ka10084** | **당일전일체결요청** | **없음(layout=table)** | **오탐** |
| **ka10085** | **계좌수익률요청** | **없음(layout=table)** | **오탐** |
| ka10079/10080/10094 | 틱/분/년봉차트 | aits-chart-v1 | **누락** |
| ka20004~20008, ka20019 | 업종 틱/분/일/주/월/년봉 | aits-chart-v1 | **누락** |
| ka50079~50083, ka50091, ka50092 | 금현물 차트 7종 | aits-chart-v1 | **누락** |

- 정본 목록(19개, manifest `presentation.renderer_id == "aits-chart-v1"`):
  `base:ka10079 ka10080 ka10081 ka10082 ka10083 ka10094 ka20004 ka20005 ka20006 ka20007 ka20008 ka20019 ka50079 ka50080 ka50081 ka50082 ka50083 ka50091 ka50092`
- 주의: `kiwoom-tr-inventory.json`의 `subcat == "차트"`는 21개로 `ka10060`(종목별투자자기관별차트), `ka10064`(장중투자자별매매차트)를 더 센다. 이 둘은 manifest가 AITS 렌더러를 주지 않는다(표다). **인벤토리 분류가 아니라 manifest가 정본이다.**

### 1.3 보드가 라이브 렌더러를 못 품는 이유

| 보드 | `slots.json` `primary.renderer` | `regions.json` role=primary | `board.html` |
|---|---|---|---|
| `137X-2` (CC-03 기본) | `null` | `14P9-2` "Athena Chart Module Mount" | `.bs-primary` 1개 |
| `2R3M-1` (CC-03/현재시세 탭) | `null` | `2R4Y-1` "Quote Detail Mount" | `.bs-primary` 1개 |
| `13BC-2` (CC-04 기본) | `null` | `154L-2` "Ten Step Ladder" | `.bs-primary` 1개 |
| `1JPU-0` (CC-04 호가 정본) | `null` | `1JQG-0` "10단 호가 래더" | `.bs-primary` 1개 |
| `32S7-0` (CC-03/차트 탭) | **`"athena-chart"`** + `props_from` 6개 | `32TJ-0` "Athena Chart Module Mount" | `.bs-primary` 1개 |

**마운트 지점은 이미 전 보드에 있다** — `.bs-primary` 노드 하나. 없는 것은 (a) `primary.renderer` 저작값, (b) 그 값을 프론트로 나르는 길, (c) `board-mount`의 마운트 코드.

(b)가 결정적이다: `scripts/build_board_registry.py:98`의 `_MOUNT_FIELDS`가 슬롯 6개 필드만 투사하고, `app/lib/board-template-registry.js:158-161` `contractFor()`는 `{board_id, slots}`만 돌려준다. **`primary`는 프론트에 존재조차 하지 않는다.**

### 1.4 상태 링크

- `backend/athena_api/card_surface_contract.py:136-148 _state_boards` — **마운트된 그 보드의 직계 자식만** 싣는다.
- `app/canvas.js:869-877 switchStateBoard` → `mountBoardState` → `wireStateControls`가 **낡은 `state.links`를 그대로 다시 쓴다**. 2R3M-1로 갈아탄 뒤 그 보드의 탭 레일은 `state.links`(=137X-2의 자식들)로 배선을 시도하고, 2R3M-1의 자식은 `3FR6-0`(분봉 시세) 하나뿐이라 나머지는 전부 죽는다. 되돌아갈 길은 아예 없다.
- 그런데 `board.html`은 이미 답을 갖고 있다(실측):
  - `137X-2`: `현재시세→2R3M-1`, `차트→32S7-0`, `기업정보→2RBO-1`, `금현물→2RJ7-1`, `순위→2VDA-0 2VIN-0 2VO0-0 32XM-0`, `투자자 12주체→3DI2-0`
  - `2R3M-1`: `분봉 시세→3FR6-0`
  - `13BC-2`: `정규장 · 5단→2TRW-1`, `시간외→2QRP-1`, `금현물 · 5단→2QX1-1`, `단계별 낱값·거래소별→3JZ3-0`
- `app/canvas.js:879-889 findStateControl`이 이미 `[data-state-control]`를 1순위로 본다. 즉 **자식 링크는 봉투 없이 DOM만으로 복원 가능**하다.

### 1.5 배선 오류(실측 원인)

`13BC-2` 스트립 잎 텍스트: `정규장`(153K-2) / `시간외`(153M-2) / `금현물`(153O-2) / `5단`(153R-2) / `10단`(153T-2).

| 자식 보드 | 저작 `state.control` | 붙은 잎 | `how` | 결과 |
|---|---|---|---|---|
| `2QX1-1` (호가 — KRX 금현물) | `금현물 · 5단` | **`5단`** | `tail` | **「5단」을 누르면 금현물 보드가 열린다** |
| `2TRW-1` (호가 — 정규장 5단) | `정규장 · 5단` | `정규장` | `partial` | 5단 의미 소실 |
| — | — | `금현물` 잎 | 없음 | **죽음** |
| — | — | `10단` 잎 | 없음 | 죽음 |

원인은 `scripts/paper_board_extract.py:1686-1787 mark_state_controls`의 문자열 유사도 매칭(`control_tier`)이 `control_text`(손지정)가 비었을 때 tail/partial까지 허용하고, **잎 하나는 컨트롤 하나만 받는다**는 규칙 때문에 먼저 집은 쪽이 이긴다는 것이다. 같은 패턴이 `13K0-2`에도 있다: `2XTO-0`(호가잔량 상위) → 잎 `호가`(3449-0), `2YNQ-0`(시간외 등락률) → 잎 `등락률`(33WM-0), `2YA8-0`(호가잔량 급증) → 잎 `호가잔량`(2WHD-0).

`137X-2` ETF·ELW 탭이 죽은 것은 다른 원인이다 — **부모 137X-2의 자식으로 ETF/ELW 보드가 아예 저작돼 있지 않다**(자식 9장: 2R3M-1, 2RBO-1, 2RJ7-1, 2VDA-0, 2VIN-0, 2VO0-0, 32S7-0, 32XM-0, 3DI2-0). 이건 배선 버그가 아니라 저작 공백이다.

### 1.6 표 미인식

| 보드 | 이름 | `slots.json` `tables` | `board.html` `bs-table` |
|---|---|---|---|
| `2WZK-0` | CC-03/R01-T5-2 · 순위 — ETF 기간 수익률 | **0** | **0** |
| `30HY-0` | CC-05/R03-T6-6 · 순위 — 외국인·기관 상위 | **0** | **0** |
| `30C1-0` | CC-03/R01-T4-5 · 순위 — 거래량갱신 | 1 (`source: "heuristic"`) | 1 |
| `316O-0` | CC-03/R01-T4-8 · 순위 — 시가대비 등락 | 1 | 1 |

→ 지시서의 "30C1-0·2WZK-0 bs-table 0개" 중 **30C1-0은 실측상 1개**다(휴리스틱 인식 성공). 실제 0개 보드는 `2WZK-0`·`30HY-0`이다.

원인: `regions.json`에는 `table` role 자체가 없고(전 보드 실측: header/strip/kpi/workspace/primary/rail/footer만 존재), 표 인식은 두 경로뿐이다.
- 명시: `regions.json`의 `responsive[]`에 `traits`가 `paired-table`/`scroll-table`인 선언(`scripts/paper_board_extract.py:2157-2161`).
- 휴리스틱: `scripts/paper_board_extract.py:1294-1319` — 자식 4개 이상 + `_is_header_row` 통과 헤더 + **너비가 헤더와 정확히 같고 셀 3개 이상인 본문 행 3개 이상**.

`2WZK-0`은 primary 영역 이름이 `Quote Detail Mount`(2X1C-0)로 기본 보드에서 복사된 채라 결과 목록 자체가 표 모양이 아니고, `30HY-0`도 primary가 `Investor Panel`(30JC-0)이다. **저작 공백이다 — 추출기 버그가 아니다.**

### 1.7 3초 paint ack

- `app/lib/rest-canvas-paint.js:49-56` — **너비·높이 둘 다 0보다 커야** 한다. 두 프레임 연속.
- `app/canvas.js:942-967 renderBoardSurfaceCard` — 카드 껍질을 먼저 돌려주지만 `card-head`를 제거하고(`:956-957`) 본문에 빈 `.board-surface-host`만 넣는다. `app/styles/board-surface.css:285-289`에 `min-height`가 없다. **마운트 전 카드 높이가 0이 될 수 있다.**

---

## 2. 단계 A — 라우팅을 recipe 축에서 렌더러 축으로

### A.1 판정 필드 결정

| 후보 | 채택 | 이유 |
|---|---|---|
| `presentation_contract.recipe_id` | 제거 | 제품 화면 종류지 렌더러가 아니다. `OPERATION_RECIPE_OVERRIDES` 하나가 시세를 차트로 만든 것이 이번 버그의 원인이다(`view_recipe_registry.py:55`). |
| **`renderer_id`** | **1순위** | manifest가 정본이고(`canvas_transform.py:806-807`), 봉투에 이미 실려 온다(`canvas_push.py:2032-2033`). `aits-chart-v1` 하나뿐이라 판정이 닫힌다. |
| `canvas_type === 'chart'` | 유지(2순위) | 이미 있고(`paper-card-routing.js:53-54`), 백엔드 `canvas_kind == "chart"` 분기가 AITS DTO를 만든다는 사실과 1:1이다. |
| **`operation_ref` 화이트리스트** | 3순위(차트 전용) | `renderer_id`를 안 싣는 옛 봉투·픽스처 대비 안전망. 정규식이 아니라 **명시 집합**으로. |
| `card_kind` / `card_id` | 불채택 | CC-03은 차트·시세·기업정보를 전부 덮는다 — 해상도가 없다. |
| `card_title` | 라우팅용 부적합 | `호가`/`주문`은 카드종 후킹용 표시 문구다(`canvas.js:1580, 1706, 1710`). 다만 A.2의 임시 4순위로만 쓴다. |

### A.2 `app/lib/paper-card-routing.js` 변경(정확한 목록)

1. `APP_PRIMARY_RECIPES`(`:47`) 삭제.
2. 새 상수 두 개 추가:
   ```
   const APP_PRIMARY_RENDERERS = new Set(['aits-chart-v1']);
   const APP_PRIMARY_CHART_OPS = new Set([ ...19개 base:kaXXXXX... ]);   // 1.2 표
   ```
   19개는 `backend/ref/kiwoom-common-screen-manifest.json`의 `presentation.renderer_id == "aits-chart-v1"` 전집합. 주석에 **"정본은 manifest다. 이 목록이 manifest와 어긋나면 테스트가 깬다"**를 남긴다.
3. `preservesAppPrimary`(`:49-58`) 재작성 — 판정 순서:
   ```
   renderer_id ∈ APP_PRIMARY_RENDERERS               → true
   canvas_type === 'chart' && !fell_back              → true
   operation_ref ∈ APP_PRIMARY_CHART_OPS              → true
   card_title === '호가' 또는 '주문'                  → true   (C 완료 전까지만)
   그 외                                              → false
   ```
   `/^base:ka1008[1-5]$/` 정규식은 **삭제**한다(오탐 2·누락 12).
4. `__exports`(`:63`)에 `APP_PRIMARY_RENDERERS`, `APP_PRIMARY_CHART_OPS` 추가 — 검증 스크립트가 하드코딩 대신 이걸 읽게 한다.

### A.3 동기화 대상(같은 PR)

| 파일 | 줄 | 할 일 |
|---|---|---|
| `app/lib/paper-card-routing.test.js` | 65-104 | recipe 3종 루프 삭제. 대신 (a) `renderer_id: 'aits-chart-v1'` → true, (b) 19개 op 전부 true, (c) **`base:ka10084`·`base:ka10085` false**(회귀 못 박기), (d) `detail:ka10001:current_trading` + `recipe_id 'instrument-chart'` → **false**(이번 목표), (e) `recipe_id 'live-orderbook'`만 있고 렌더러 신호가 없으면 false. 실재 recipe 12종(`instrument-chart, live-orderbook, order-safe-ticket, why-move-flow, discovery-value, sector-theme, watchlist-condition, etf-product, elw-product, market-vi, account-risk, gold-market` — `backend/athena_api/view_recipe_registry.py:20-48`)으로 케이스를 쓴다. |
| `app/lib/paper-card-routing.test.js` | (신규) | `backend/ref/kiwoom-common-screen-manifest.json`을 읽어 `APP_PRIMARY_CHART_OPS`와 manifest AITS 집합이 **정확히 같은지** 대조하는 테스트 1개. 드리프트 방지. |
| `app/verify-semantic-workspaces.js` | 236 | `preserve_primary = recipe.recipe_id in {...}` → 대표 봉투의 `selected.renderer_id == 'aits-chart-v1'` 기준으로 교체. `envelope['renderer_id']`는 이미 `:239`에서 싣는다. |
| `app/verify-semantic-workspaces.js` | 738-741 | `specializedPrimaryMounted` 분기의 recipe 비교는 **그대로 둔다** — 여기는 "무엇이 그려졌나" DOM 검사라 recipe축이 맞다. `primary_expected`만 바뀐다. |
| `app/lib/canvas-tabs.test.js` | 344-345 | `canvas.js:728` 원문을 정규식으로 못 박은 검사. 728줄을 손대면 여기도 같이 고친다. |

### A.4 시세 facts 봉투가 보드로 가는 정확한 조건

A 이후 `detail:ka10001:current_trading` 봉투는:
- `renderer_id` 없음(manifest layout=facts) → 1순위 false
- `canvas_type = 'facts'` → 2순위 false
- `operation_ref`가 차트 19개에 없음 → 3순위 false
- `card_title = '종목정보'` → 4순위 false

→ `preservesAppPrimary === false` → `app/canvas.js:728`이 `renderBoardSurfaceCard(envelope)` 호출 → `surface_contract.board_id`가 있으므로 보드 카드 반환. **목표 달성.**

### A.5 그때 기존 조각들이 어떻게 되는가

| 조각 | A 이후 |
|---|---|
| `card-kind-종목정보` QuoteHeader (`canvas.js:1696-1700`) | **안 그려진다.** `renderFactsCard` 자체가 호출되지 않는다. 같은 값(현재가·등락)은 보드의 `bs-kpi-cell` 슬롯이 낸다 — `137X-2` KPI 5칸, `2R3M-1` 슬롯 259개. |
| `wireQuoteRealtime` 0B (`canvas.js:1706`) | **안 걸린다.** 대신 `syncIntegratedRealtime`(`canvas.js:1208`)이 통합 카드 리스를 잡고, `canvas.js:254-258`이 `.board-surface-host`마다 `applyBoardRealtimeTick`을 돌린다. 이 경로는 `realtime_bindings`(`canvas_push.py:700`)와 `slot_values[].observation_id`(`card_surface_contract.py:212`)를 `board-mount.js:290-315 realtimeSlotIndex`가 이어 주는 것으로 **이미 완성돼 있다**. REG 중복은 리스 단위로 dedup된다 — 새 경로를 만들지 않는다. |
| `semantic-workspace` 본문 | **여기가 유일한 누락이다.** `canvas.js:26-29`는 개발자 진단 시트만 보드에서 막고, `semanticWorkspace.upsert`는 `:982`, `:1031`, `:1094` 세 곳에서 **조건 없이** 불린다. `app/lib/semantic-workspace.js`에는 `board` 문자열이 하나도 없다(grep 0건). → **A에서 반드시 같이 고친다**: 세 호출부를 `if (semanticWorkspace && !integratedCardSurface.isBoardSurface(root)) semanticWorkspace.upsert(...)`로 감싼다. 안 그러면 Paper 보드 아래에 의미 작업대가 한 겹 더 붙어 "보드와 동일"이 깨진다. |

### A.6 커밋 경계

- 커밋 A1: `paper-card-routing.js` + 그 테스트 + manifest 대조 테스트.
- 커밋 A2: `verify-semantic-workspaces.js` `preserve_primary` 축 교체.
- 커밋 A3: `canvas.js` semantic-workspace 보드 가드 3곳 + `canvas-tabs.test.js` 동기화.

A1만 머지해도 「시세」는 보드로 간다. A3 없이 A1만 넣으면 보드 밑에 시트가 붙으므로 **A1과 A3는 같은 PR로 묶는다.**

---

## 3. 단계 B — 기준 보드 선택(137X-2 vs 2R3M-1)

`base_board_for`(`backend/athena_api/card_surface_templates.py:249-262`)는 `_STATE_RANK = {default:0, tab:1, sort:2, expand:3}`(`:684`)로 항상 default를 먼저 고른다. `detail:ka10001:current_trading`을 가진 보드는 `137X-2`(default, op 19개)와 `2R3M-1`(tab, parent 137X-2, control 현재시세, op 12개) 둘뿐이다.

### 안 B-1 — `base_board_for` 선택 규칙 변경(백엔드)

op를 **더 좁게 소유한** 보드를 먼저 고른다(예: `len(board.operation_refs)`가 작은 쪽).

- 장점: 프론트 변경 0. 봉투 하나로 끝. 마운트 1회.
- 단점:
  - **탭 레일이 죽는다.** `_state_boards`(`card_surface_contract.py:136-148`)는 마운트 보드의 자식만 싣는데 `2R3M-1`의 자식은 `3FR6-0` 하나다. D 없이 넣으면 사용자는 현재시세 보드에 갇힌다.
  - **선택 규칙이 취약하다.** op 수가 적은 보드 규칙은 `base:ka10085`(6개 보드에 걸침, 계획서 F1)에서 예측 불가능하게 뒤집힌다. `2SKU-1`을 고정한 기존 테스트(`backend/tests/unit/test_card_surface_templates.py:121, 448`)가 깨질 수 있다.
  - 회귀 반경이 넓다 — `build_surface_contract`(`:151`)와 `resolve_section_titles_ko`(`:263`)가 같은 함수를 쓴다.

### 안 B-2 — `surface_contract.initial_state_board` 추가(백엔드 1필드 + 프론트 2줄)

`_board_contract`(`card_surface_contract.py:228-242`) 반환에 필드 하나를 더한다: `initial_state_board` = op를 단독으로 설명하는 자식 tab 보드 id 또는 None.
프론트 `openBoardSurface`(`canvas.js:812-820`)가 default를 마운트한 뒤 값이 있으면 즉시 `switchStateBoard`.

- 장점:
  - **탭 레일이 산다.** default(137X-2)를 먼저 세우므로 `state.links`가 자식 6종 전부를 갖고, 그 상태에서 현재시세로 들어간다 — 사용자 클릭과 동일한 경로다.
  - `base_board_for` 계약 불변 → `test_card_surface_templates.py`의 `2SKU-1` 고정 테스트가 그대로 통과한다.
  - 되돌아가기가 default로 돌아가기로 자연히 정의된다.
- 단점:
  - **마운트 2회** — 3초 계약에 부담. 단 `mountBoardAsync`(`board-mount.js:585-596`)는 청크가 상주하면 동기다. `137X-2`와 `2R3M-1`은 **같은 CC-03 청크**에 있으므로(`board-templates.index.generated.js` 실측) 두 번째 마운트에 네트워크·스크립트 주입이 없다.
  - 값 표 재사용은 D5로 보장된다(`canvas.js:812-816`). 다만 `2R3M-1` 슬롯 259개 중 봉투가 채운 것은 `137X-2` 기준이라 **결측어가 더 많이 뜬다** → D-3 하이드레이션이 그 구멍을 메워야 한다.

### 추천: B-2

1. 탭 레일 생존이 Paper 보드와 동일의 절반이다. B-1은 그 절반을 죽인다.
2. 백엔드 선택 규칙을 안 건드리므로 96보드 × 299op 전체 회귀 위험이 없다. B-1은 `_STATE_RANK` 하나로 전 보드 기본값을 바꾼다.
3. 3초 위험이 실측상 낮다(같은 청크).

**단, B-2는 D-1(링크 재계산)이 먼저 들어가야 한다.** 순서: A → D-1 → B-2.

### B 변경 목록

| 파일 | 변경 |
|---|---|
| `backend/athena_api/card_surface_templates.py` | `CardSurfaceRegistry.initial_state_board_for(operation_ref)` 추가 — `base_board_for`가 default를 골랐고, 그 default의 자식 tab 보드 중 해당 op를 가진 보드가 **정확히 하나**일 때만 그 id. 둘 이상이면 None(지어내지 않는다). |
| `backend/athena_api/card_surface_contract.py:228-242` | `_board_contract` 반환에 `initial_state_board` 추가. `build_board_surface_contract` 경로에서는 항상 None. |
| `app/canvas.js:812-820 openBoardSurface` | 마운트 후 값이 있고 `state.links`에 있으면 `switchStateBoard`. |
| `backend/tests/unit/test_card_surface_contract.py` | `detail:ka10001:current_trading` → `2R3M-1`, 후보가 둘 이상인 op → None 케이스. |
| `backend/tests/unit/test_question_to_card_routing.py` | 시세 질의가 CC-03/137X-2 계약 + `initial_state_board == 2R3M-1`을 받는지. |

---

## 4. 단계 C — 보드 안에 라이브 렌더러 마운트 (최대 위험 구간)

### C.1 계약 복원: primary를 프론트까지 나른다

| 파일 | 변경 |
|---|---|
| `backend/ref/card-surface-templates/137X-2/slots.json` | `primary.renderer = "athena-chart"`, `mount_slot = "14P9-2"`, `props_from`에 차트 TR(`base:ka10081` 등)과 주기 control. 형식 정본은 `32S7-0/slots.json`의 `primary`. |
| `.../13BC-2/slots.json` | `primary.renderer = "athena-orderbook"`, `mount_slot = "154L-2"` (Ten Step Ladder). |
| `.../1JPU-0/slots.json` | `primary.renderer = "athena-orderbook"`, `mount_slot = "1JQG-0"`. |
| `.../2R3M-1/slots.json` | **비워 둔다**(리스크 R3) — primary 이름이 Quote Detail Mount라 차트 자리가 아닐 수 있다. Paper 검수 전까지 슬롯 텍스트만으로 완성. |
| `scripts/build_board_registry.py:118-142 collect()` | `boards[]`에 `primary` 추가. renderer가 null이면 키 자체를 안 싣는다(청크 크기 방어). |
| `scripts/build_board_registry.py:163-178 render_chunk` | 청크 엔트리에 `primary` 직렬화. |
| `app/lib/board-template-registry.js:158-161 contractFor` | `board_id`·`slots`에 더해 `primary`를 돌려준다. |
| `app/lib/board-parity.test.js` | 생성물 재생성 후 `137X-2`의 renderer/mount_slot 검사 추가. |

### C.2 board-mount.js — 마운트 지점만 노출, 렌더러는 부르지 않는다

`board-mount.js`는 DOM 텍스트 층이고 AITS·호가에 의존하면 안 된다(D1 런타임 레이아웃 재조립 없음). **마운트 지점을 찾아 돌려주기만** 한다.

- 새 함수 `primaryMountPoint(surface, contract)`: `contract.primary.mount_slot`이 있으면 `[data-node=...]`로 찾고, 없거나 못 찾으면 `.bs-primary`로 폴백. 둘 다 없으면 null.
- `mountBoard`(`:557`) 반환에 `primary: {renderer, mountPoint, propsFrom}` 추가.
- `__exports`(`:598-606`)에 `primaryMountPoint` 추가.

### C.3 canvas.js — 껍질 먼저(3초) → 뒤에서 마운트

`mountBoardState`(`canvas.js:838-848`)의 then 체인에 한 단계를 더한다. 순서는 `rememberMountedBoard` → `wireStateControls` → 정적 목업 숨김 → **await 없이** `mountBoardPrimary(...)` 던지기 → `hydrateBoardSlots`. `mountBoardPrimary`를 await하면 3초 계약을 넘긴다(`canvas.js:2049-2051`이 차트 카드에서 이미 같은 판단을 했다).

`mountBoardPrimary(host, envelope, mounted)` 규칙:
1. `mounted.primary`가 없거나 renderer가 null이면 즉시 종료.
2. renderer가 `athena-chart`인 경우:
   - 지금 봉투에 `data.chart`가 없으면 **차트 데이터를 지어내지 않는다.** `props_from[].mapping_id`(예: `base:ka10081`)로 뒤에서 한 번 조회한다 — 새 IPC를 만들지 말고 하이드레이션 채널을 넓힌다(C.6).
   - 데이터가 오면 `describeAitsChartPanel(data, envelope, 'live')`(`canvas.js:1313`)로 descriptor를 만들고 `mountAitsChartPanel(card, mounted.primary.mountPoint, descriptor)`(`canvas.js:1430`)를 **그대로 재사용**한다. 이 함수는 컨테이너를 인자로 받으므로 시그니처 변경이 필요 없다.
3. renderer가 `athena-orderbook`인 경우:
   - `CardKinds.resolve('호가')`(= `render호가`, `app/lib/card-kind-호가.js:456`)가 봉투를 받아 조각을 만든다. null이면 아무것도 안 한다(all-or-nothing 계약).
   - `mountPoint`에 조각을 넣고 `supportsLive0D(built)`(`card-kind-호가.js:520`)면 `wireOrderbookRealtime(card, built, envelope, applyLiveTick)`(`canvas.js:1554`)를 카드 root에 건다. 0D acquire/release 짝은 그 함수가 이미 대칭으로 낸다.

### C.4 패널 수명(탭 전환)

- `panelIdFor`(`app/lib/aits-chart-panel.js:120-131`)는 correlation(dataset_id·item_id·ordinal)로 id를 만든다. **보드를 갈아타도 봉투 correlation은 같으므로 panelId가 같다.**
- `openPanel`(`:224-231`)은 같은 panelId에 **다른 컨테이너**가 오면 예외를 던진다. 상태 보드 전환은 `mountBoard`의 `root.replaceChildren`(`board-mount.js:571`)로 표면을 통째로 갈므로 컨테이너가 반드시 바뀐다.
- → **전환 시 `aitsChartPanels.destroyPanel(panelId)` 선행 + `athena:chart-panel-destroyed` 송신.** `switchStateBoard`(`canvas.js:869-877`)에서 `mountBoardState` 호출 **전에** 처리한다. panelId는 `state.primaryPanelId`에 기록한다.
- **카드 파괴 정리자 누락**: `renderBoardSurfaceCard`(`canvas.js:942`)는 `cardDestroyers`에 아무것도 등록하지 않는다. 보드 primary 패널·0D 리스를 닫는 정리자를 여기서 등록해야 한다 — 안 하면 카드를 닫아도 REG가 남는다.

### C.5 정적 목업 노드 처리 규칙

Paper 원문의 차트 SVG 프리뷰는 `.bs-primary` **안**에 있다. renderer가 선언된 자리는 D1이 명시한 예외다.

1. renderer가 선언된 보드에서만 `.bs-primary` 내부를 비운다.
2. 비우기는 **삭제가 아니라 숨김** — `board-mount.js:151-157 setHidden`과 같은 패턴(원래 display를 보관하고 hidden으로 접는다).
3. 마운트 실패 시 목업을 되돌리고 그 위에 `errorNote`를 얹는다(실패를 감추지 않는다).
4. 성공 시 마운트 노드에 `data-bs-primary-mounted`를 찍는다 — 검증 스크립트와 CSS가 이걸 본다.

### C.6 보드 primary 데이터 조회 채널

새 IPC를 만들지 말고 기존 하이드레이션을 넓힌다.

- 백엔드 `board-hydrate`(`canvas_push.py:1063-1113`)는 이미 **보드의 operation_refs 전부를 호출**한다(`:1092-1102`). `137X-2`의 operation_refs에 `base:ka10081`이 들어 있다(실측).
- 지금은 슬롯 값만 돌려준다. 차트는 슬롯이 아니라 DTO가 필요하다.
- 최소 변경: 응답에 `primary_data` 추가 — `primary.props_from[].mapping_id` 중 성공한 op의 응답을 `build_aits_chart_envelope_data`(`canvas_transform.py:760`)로 변환해 싣는다.
- **주문 op는 이미 거부된다**(`canvas_push.py:1019-1021`, 테스트 `tests/api/test_canvas_push.py:563`) — 실주문 금지 요건 충족. 이 가드를 삭제하지 않는다.
- 프론트는 `board-hydrate.js`가 `primary_data`를 통과시키고 `mountBoardPrimary`가 쓴다.
- **D-3(하이드레이션 버그 수정) 이후에 넣는다** — 같은 파일이다.

### C.7 테스트 전략

| 층 | 파일 | 내용 |
|---|---|---|
| 단위 | `app/lib/board-mount.test.js` | `primaryMountPoint`가 mount_slot → data-node → `.bs-primary` 순으로 찾는지, 둘 다 없으면 null인지. 기존 스텁 DOM으로 충분(jsdom 불필요). |
| 단위 | `app/lib/board-parity.test.js` | 청크에 `137X-2` renderer/mount_slot이 실렸는지. `canvas.js` 원문에서 `mountBoardPrimary` 호출이 await 없이 던져지는지 정규식 검사 — 3초 계약 회귀 방지. 이 파일은 이미 원문을 정규식으로 못 박는 관례가 있다(`:190, 231, 261-286`). |
| 단위 | `app/lib/aits-chart-panel.test.js` | 같은 panelId를 다른 컨테이너로 열면 던지는지, `destroyPanel` 후에는 새 컨테이너로 열리는지. |
| 통합(Electron) | `app/verify-integrated-cards.js` | 기존 보드 프로브(`:640-760 sendBoardEnvelope`, `:1476-1490`) 확장 — `137X-2`에 차트 DTO를 실어 보내고 마운트 표식과 차트 본문 존재 확인. `13BC-2`는 호가 라이브 조각 존재 확인. |
| 통합 | `app/verify-semantic-workspaces.js` | preserve_primary 축 교체 후 12 recipe 대표 전부 통과. |

### C.8 3초 계약 방어(필수)

`renderBoardSurfaceCard`가 높이 0으로 돌아갈 수 있다(1.7).

- `renderBoardSurfaceCard`(`canvas.js:959-961`)에서 host에 최소 높이를 **인라인으로** 주고 `mountBoard` 성공 시 제거한다.
- 전역 CSS(`board-surface.css:285-289`)에 넣지 않는 이유: 마운트 완료된 보드의 레이아웃에 개입할 위험이 있다.

---

## 5. 단계 D — 상태 전환 링크 갱신과 배선 오류

### D-1. state.links 재계산 (독립 커밋, A 다음)

원인: `canvas.js:838-848 mountBoardState`가 `state.links`를 갱신하지 않는다. `state.links`는 `openBoardSurface`(`:812-820`)에서 봉투로 딱 한 번 채워진다.

**설계: 링크의 정본을 봉투에서 생성물 색인으로 옮긴다.**

| 파일 | 변경 |
|---|---|
| `scripts/build_board_registry.py:153-161 render_index` | `backend/ref/card-surface-templates/index.json`의 `boards[].state`를 읽어 `STATE_GRAPH`(보드 id → parent·self_control·children[{board_id,kind,control,control_text}])를 색인에 싣는다. 색인은 수 KB이고 셸이 동기로 싣는다(`board-template-registry.js:7-11` 주석). |
| `app/lib/board-template-registry.js` | `stateLinksFor(boardId)` 추가 + `__exports`. |
| `app/canvas.js:838-848 mountBoardState` | `state.links = boardTemplateRegistry.stateLinksFor(state.boardId)` 로 **매 마운트마다 재계산**. 봉투의 `state_boards`는 첫 마운트 교차 검증용으로만 남긴다(불일치 시 콘솔 경고). |
| `app/canvas.js:869-877 switchStateBoard` | 가드가 재계산된 링크를 보므로 자연히 옳아진다. |

`stateLinksFor(boardId)` 정의:

- 자기 자식 전부
- 부모가 있으면 **부모의 자식 전부**(형제) — 자식 보드의 탭 레일이 부모 레일의 복제본이라 이게 없으면 전환 후 레일이 죽는다
- 부모가 있고 부모에 `self_control`이 저작돼 있으면 되돌아가기 링크 1개

폴백: `self_control`이 없으면 되돌아가기 링크를 만들지 않는다(현 상태 유지, 악화 없음).

성립 근거: `findStateControl`(`canvas.js:879-889`)이 `[data-state-control]`을 먼저 보고 없으면 `.bs-strip, nav, [role=tablist]` 안에서 **텍스트 정확 일치**로 찾는다. 형제 링크는 자식 보드 HTML에 표식이 없으므로 텍스트 폴백을 타는데, 실측상 `2R3M-1` 레일에 `기업정보`·`금현물` 잎이 존재하므로 동작한다.

`board-mount.js:369-383 stateLinksFromMarks`는 이미 같은 모양의 변환기이고 `verify-integrated-cards.js:664, 1484`가 쓴다. **프론트 런타임도 같은 함수를 쓰게 통일**하면 `board-parity.test.js:262-265`의 기존 검사가 그대로 산다.

### D-2. 배선 오류 칩 (저작 수정, 독립 커밋)

**저작 위치는 자식 보드의 `backend/ref/card-surface-templates/<child>/slots.json` → `state.control_text`** 다. `mark_state_controls`(`scripts/paper_board_extract.py:1719-1731, 1751-1755`)가 손지정 `control_text`를 가진 자식에게 **잎 우선권**을 준다. `control`은 원장 식별자라 건드리지 않는다(`card_surface_templates.py:1097-1108 _control_text`가 control의 파이프 뒤 꼬리를 기본값으로 쓴다).

| 보드 | 지금 | 고칠 값 | 결과 |
|---|---|---|---|
| `2QX1-1` | control 금현물 · 5단, control_text 없음 → 잎 `5단` | `control_text: "금현물"` | 금현물 칩이 금현물 호가 보드를 연다 |
| `2TRW-1` | control 정규장 · 5단 → 잎 `정규장` | `control_text: "5단"` | 5단 칩이 5단 호가를 연다. 정규장 잎은 자기 자신(13BC-2) → `self_control` 필요 |
| `2XTO-0` | control 호가잔량 상위 → 잎 `호가`(3449-0) | 부모 레일 잎 실측 후 `control_text` 지정 | 오배선 해소 |
| `2YNQ-0` | control 시간외 등락률 → 잎 `등락률`(33WM-0) | `control_text` 명시 | 같은 문구 잎 2개 중 의도한 쪽 고정 |
| `2YA8-0` | control 호가잔량 급증 → 잎 `호가잔량`(2WHD-0) | `control_text` 명시 | 같음 |
| `2VO0-0`, `316O-0`, `30HY-0` | 지시서 지적 | 각 부모 레일 잎 텍스트 실측 후 지정 | 같음 |

`137X-2` ETF·ELW는 **자식 보드 자체가 없다** — control_text로 못 고친다. 두 선택지:

- (a) ETF/ELW 상태 보드를 Paper에서 추출해 저작한다(별도 트랙).
- (b) 그때까지 두 칩을 죽은 컨트롤로 표시하고 CSS로 비활성 처리 — 없는 화면을 지어내지 않는다는 원칙에 맞다.

**고치는 절차(정확한 명령):**

```
cd C:\Projects\DAOU.Athena
python scripts/paper_board_extract.py 13BC-2 13K0-2 137X-2 --check
python scripts/paper_board_extract.py 13BC-2 13K0-2 137X-2
python scripts/build_board_registry.py
python scripts/paper_board_extract.py --check
```

`--check`는 파일을 쓰지 않고 디스크와 대조한다(`scripts/paper_board_extract.py:33`). `html_sha256`이 바뀌므로 `slots.json`·`index.json`·`app/lib/board-templates.*.generated.js`가 함께 갱신된다.

### D-3. 하이드레이션 항상 빈손 (독립 커밋, 우선순위 높음)

**결함 2개, 둘 다 프론트에 있다.**

1. **401** — `app/lib/main/board-hydrate.js:71-77`이 Content-Type만 보낸다. 백엔드는 `require_local_bearer`(`canvas_push.py:1075`, `backend/athena_api/security.py:17-32`)로 Bearer를 강제한다. 401은 `UNAVAILABLE_STATUS`(`:19` — 0·404·405·501·502·503)에 없어 error가 되고, `canvas.js:928`이 조용히 넘어간다.
   → `hydrateBoard`에 token 인자 추가, `main.js:2216-2230` IPC 핸들러가 `process.env.ATHENA_LOCAL_BEARER_TOKEN`을 넘긴다(`main.js:1239`와 같은 관례).
2. **응답 모양** — 백엔드는 `board_id`·`card_id`·`operations`·`surface_contract{slot_values,unbound_slots}`를 돌려준다(`canvas_push.py:1105-1113`, 테스트 `backend/tests/api/test_canvas_push.py:514-517`). 프론트는 **최상위** `slot_values`를 읽는다(`board-hydrate.js:96`).
   → `payload.surface_contract.slot_values`를 1순위로, 최상위는 폴백으로.
3. **부산물** — 하이드레이션 응답의 slot_values에는 `observation_id`가 실려 있다. 지금 `canvas.js:930-935`는 값만 병합하고 `state.realtimeSlots`를 다시 만들지 않는다. → 하이드레이션 후 `boardMount.realtimeSlotIndex`로 **재색인**한다. 안 하면 하이드레이션으로 채워진 슬롯은 실시간 갱신을 영영 못 받는다.
4. **테스트 동시 수정** — `app/lib/main/board-hydrate.test.js:44-61`이 **틀린 계약을 고정하고 있다**(최상위 slot_values). 이 테스트가 버그를 지켜 온 원인이다. 백엔드 응답 모양 그대로의 픽스처로 바꾸고 Authorization 헤더 검사를 추가한다.

### D-4. 표 미인식 (2WZK-0, 30HY-0)

원인은 1.6 — `regions.json`에 table role이 없고, 명시 선언(`responsive[].traits`에 paired-table 또는 scroll-table)도 없고, 휴리스틱(자식 4+, 동폭 본문 행 3+)도 통과 못 한다.

처방:

- `backend/ref/card-surface-templates/2WZK-0/regions.json` — primary 항목 name을 ETF 기간 수익률 목록으로 정정(현재 Quote Detail Mount는 기본 보드 복사 흔적), `responsive[]`에 표 소유 노드 선언 추가(traits paired-table, accessible_label 지정).
- `backend/ref/card-surface-templates/30HY-0/regions.json` — 동일 패턴(Investor Panel → 외국인·기관 상위 목록).
- 이어서 `python scripts/paper_board_extract.py 2WZK-0 30HY-0` → `python scripts/build_board_registry.py`.

**단, 소유 노드 id는 `paper.tree.txt`를 열어 헤더 행과 본문 행이 형제로 놓인 프레임을 찾아 확정해야 한다.** 추측으로 넣으면 `_explicit_table_shape`(`:1042-1119`)가 `ExtractError`로 fail-closed한다 — 조용히 깨지지는 않는다.

`30C1-0`은 실측상 표를 이미 인식했다(source heuristic, 3열 3행). 지시서의 0개는 재확인이 필요하다.

---

## 6. 단계 E — 검증 명령과 예상 소요

Node 경로(Git Bash):

```
export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"
```

| 단계 | 명령 | 코딩 | 실행 |
|---|---|---|---|
| A1 | `cd app && node --test lib/paper-card-routing.test.js` | 1.5h | 1s |
| A1 | `cd app && npm run test:unit` | — | 2min |
| A3 | `cd app && node --test lib/canvas-tabs.test.js lib/board-parity.test.js` | 1h | 10s |
| A2 | `cd app && npm run verify:semantic-workspaces` (Electron) | 0.5h | 3min |
| D-3 | `cd app && node --test lib/main/board-hydrate.test.js` | 1h | 1s |
| D-3 | `cd backend && python -m pytest tests/api/test_canvas_push.py -k board_hydrate` | — | 30s |
| D-1 | `cd app && node --test lib/board-mount.test.js lib/board-parity.test.js` | 2h | 10s |
| D-2 | 추출 → 재생성 → `cd app && npm run test:unit` | 보드당 0.5h (8보드 ≈ 4h) | 3min |
| D-4 | Paper 트리 판독 + 추출 → 재생성 | 보드당 1h (2보드 ≈ 2h) | 3min |
| B | `cd backend && python -m pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/unit/test_question_to_card_routing.py` | 1.5h | 40s |
| B | `cd app && node --test lib/*.test.js` + `npm run verify:integrated-cards` | — | 5min |
| C | `cd app && node --test lib/board-mount.test.js lib/aits-chart-panel.test.js lib/board-parity.test.js` | 6~8h | 15s |
| C | `python scripts/build_board_registry.py` 후 `cd app && npm run test:unit` | — | 3min |
| C | `cd app && npm run verify:integrated-cards` (Electron) | — | 5min |
| 전체 게이트 | `cd app && npm run verify:suite` | — | 큼(마지막 1회) |
| 백엔드 전체 | `cd backend && python -m pytest tests/unit tests/api -q` | — | 3min |

**주의:** 카드 트랙 게이트는 **주 체크아웃 `C:\Projects\DAOU.Athena`에서만** 돈다 — 자동 워크트리에는 node_modules·venv가 없다. 남의 워크트리 venv로 백엔드 테스트를 돌리면 거짓 실패가 난다.

Electron 프로브 금지 지시에 따라 이 문서를 쓰는 동안 `verify:*`는 실행하지 않았다. 단위 테스트 `lib/paper-card-routing.test.js`만 현행 통과(9/9)를 확인했다.

**합계 예상:** A ≈ 0.5일, D-1+D-3 ≈ 0.5일, B ≈ 0.5일, D-2+D-4 ≈ 1일, C ≈ 1.5~2일. **총 4~4.5일.**

---

## 7. 커밋 순서(각 커밋 독립 배포 가능)

1. **A1+A3** — 라우팅 축 교체 + semantic 시트 보드 가드. *이것만으로 「삼성전자 시세」가 137X-2 보드로 그려진다.*
2. **A2** — verify-semantic-workspaces 축 동기화.
3. **D-3** — 하이드레이션 401 + 응답 모양 + 실시간 재색인. *보드 결측어가 줄어든다.*
4. **D-1** — 상태 링크 재계산(색인 기반). *탭·스트립이 전환 후에도 산다.*
5. **B** — initial_state_board. *「시세」가 2R3M-1로 착지한다. 여기서 목표 문장 완성.*
6. **D-2** — 배선 오류 칩 저작 수정(보드별로 쪼개도 됨).
7. **D-4** — 표 미인식 보드 저작.
8. **C1** — primary 계약 복원(저작 + 생성물 + contractFor).
9. **C2** — primaryMountPoint + 3초 방어.
10. **C3** — AITS 차트 보드 마운트 + 패널 수명.
11. **C4** — 호가 사다리 보드 마운트.
12. **C5** — paper-card-routing에서 card_title 임시 예외 제거. *D1 예외가 완전히 소멸하는 지점.*

---

## 8. 리스크

| # | 리스크 | 심각도 | 완화 |
|---|---|---|---|
| R1 | A만 넣고 C를 안 하면 차트·호가는 여전히 보드를 못 쓴다. `renderer_id` 축이 정확해진 만큼 이전보다 더 많은 봉투(ka10079/10080/10094/ka2xxxx/ka5xxxx 12개)가 보드를 **피하게** 된다 — 커버리지가 잠시 줄어든다. | 중 | 의도된 것이다. 정규식 오탐(ka10084/10085) 제거로 순증. C 완료 시 전부 회수. |
| R2 | **self_control 저작 공백** — 137X-2 레일에 자기 자신을 뜻하는 칩이 없다(실측 6칩: 현재시세·차트·기업정보·금현물·순위·투자자 12주체). 되돌아가기를 어디에 걸지 Paper 검수 필요. | 중 | D-1은 self_control이 없으면 되돌아가기 링크를 안 만든다(현 상태 유지). Paper 검수 후 별도 커밋. |
| R3 | **2R3M-1의 `.bs-primary`가 Quote Detail Mount** — 차트 자리가 아닐 수 있다. 여기에 AITS를 넣으면 Paper와 어긋난다. | 높 | C에서 2R3M-1의 renderer는 **비워 둔다**. 현재시세 보드는 슬롯 259개 텍스트만으로 완성된다. 차트는 137X-2·32S7-0에만. |
| R4 | **3초 paint ack** — 보드 껍질 높이 0(1.7). B-2의 2회 마운트가 악화시킬 수 있다. | 높 | C.8 인라인 최소 높이 + B-2 전에 `verify:live-full` 실측. 실패 시 B-1로 후퇴(탭 레일 희생). |
| R5 | **AITS panelId 컨테이너 충돌** — 상태 보드 전환 시 `openPanel`이 던진다(`aits-chart-panel.js:227-229`). | 높 | C.4의 명시적 destroyPanel 선행. 단위 테스트로 못 박는다. |
| R6 | **html_sha256 드리프트** — D-2/D-4는 board.html을 재생성한다. | 저 | `--check` 먼저. `_check_slot_anchors`와 `stale_outputs`(`build_board_registry.py:189`)가 fail-closed로 잡는다. |
| R7 | **OPERATION_RECIPE_OVERRIDES를 되돌리고 싶은 유혹** — A는 이 override를 건드리지 않는다. 되돌리면 REQUIRED_SECTION_KEYS·recipe 커버리지 테스트가 깨진다(`view_recipe_registry.py:20-48`). | 중 | **건드리지 마라.** recipe는 제품 화면 종류로 두고 렌더러 판정만 분리한다. 그것이 A의 전부다. |
| R8 | **실주문 금지** — C.6의 하이드레이션 확장이 op를 더 부른다. | 높 | 백엔드가 이미 order op를 거부한다(`canvas_push.py:1019-1021`). 이 가드를 삭제하지 않는다. `test_board_hydrate_never_calls_an_order_operation`(`tests/api/test_canvas_push.py:563`)이 지킨다. |
| R9 | **WS REG 중복** — 보드 카드가 리스(통합 카드)와 0D(호가)를 동시에 쓸 수 있다. | 중 | 보드 카드에는 `wireQuoteRealtime`(0B)을 **걸지 않는다** — 리스가 이미 그 피드를 나른다. 0D만 `wireOrderbookRealtime`으로 명시 acquire/release. `renderBoardSurfaceCard`에 정리자 등록 필수(C.4). |
| R10 | **2R3M-1 결측어 증가** — B-2 착지 시 봉투는 137X-2 기준으로 채워졌다. | 중 | D-3을 B보다 먼저 넣는다(커밋 순서 3번). 하이드레이션이 나머지 슬롯을 메운다. |

---

## 9. 되돌릴 설계 결정 D1 — 문서 수정 위치

**파일: `C:\Projects\DAOU.Athena\docs\architecture\card-surface-implementation-plan.md`**

### 9.1 D1 행 (9번째 줄, 확정 결정 표)

현재 문면 끝: "예외 = 호가 사다리·AITS 차트(Paper 보드가 앱 렌더러를 담은 자리, 삭제 금지)."

수정 제안:

> 예외 = `slots.json`의 `primary.renderer`가 선언된 자리 한 곳(`mount_slot` 또는 `.bs-primary`). 그 자리의 Paper 목업 자식은 숨기고(삭제 금지, 원래 display 보관) 앱 렌더러를 얹는다. 마운트 실패 시 목업을 되돌리고 오류를 표시한다. `primary.renderer`가 null인 보드는 예외가 없다 — 라우팅이 그 보드를 피하지 않는다.

### 9.2 새 절 — D1 예외의 소멸 조건 (파일 말미 또는 5절 뒤)

> **D1 예외의 소멸 조건.** 2026-09-04까지 `app/lib/paper-card-routing.js`의 `preservesAppPrimary`는 recipe 3종(instrument-chart·live-orderbook·order-safe-ticket)을 통째로 보드에서 빼는 방식으로 D1 예외를 구현했다. 그 판정 축은 틀렸다 — recipe는 제품 화면 종류이고, `detail:ka10001:current_trading`처럼 recipe를 빌려 쓰는 op까지 함께 빠졌다(`backend/athena_api/view_recipe_registry.py:55`). 새 축은 manifest `presentation.renderer_id`(= `aits-chart-v1`, 19 op)다. `primary.renderer`가 저작되고 `board-mount`가 그 자리에 앱 렌더러를 얹는 보드부터 이 예외는 하나씩 사라지며, 마지막 보드가 옮겨 가면 `preservesAppPrimary`는 `renderer_id` 한 줄만 남긴 뒤 삭제한다.

### 9.3 2절 표면 템플릿 스키마 (38번째 줄) — primary 계약 명시

현재 문장 "전문 렌더러는 `primary`로 참조만." 을 다음으로 보강:

> 전문 렌더러는 `primary{renderer, mount_slot, module, props_from}`로 선언한다. `mount_slot`은 `board.html`의 `data-node` id이며 생략하면 `.bs-primary`가 기본이다. 이 블록은 `scripts/build_board_registry.py`가 프론트 청크로 투사하고 `app/lib/board-template-registry.js`의 `contractFor()`가 돌려준다. **투사되지 않으면 프론트는 `primary`의 존재 자체를 모른다** — 2026-09-05 시점의 결함이었다.

### 9.4 1절 사실 목록 — F6 추가 제안

> - **F6 상태 링크는 이미 HTML에 있다.** `scripts/paper_board_extract.py`의 `mark_state_controls`가 부모 `board.html`의 잎에 `data-state-control`·`data-state-board`를 찍는다(2026-09-05 실측: 해소 83개, 미해소 0). 프론트의 `state.links`는 봉투가 아니라 **생성물 색인이 정본**이어야 한다 — 봉투는 마운트한 보드의 직계 자식만 나르므로(`card_surface_contract.py:136-148`) 상태 전환 후 배선이 죽는다.

---

## 10. 참고 파일 색인

| 경로 | 무엇을 보여주나 |
|---|---|
| `C:\Projects\DAOU.Athena\app\lib\paper-card-routing.js:47-58` | 잘못된 recipe 축 + 오탐 정규식 |
| `C:\Projects\DAOU.Athena\app\canvas.js:713-741` | 라우팅 분기와 preservesAppPrimary 소비 지점 |
| `C:\Projects\DAOU.Athena\app\canvas.js:812-848, 869-905, 907-940` | 보드 마운트·상태 전환·하이드레이션 |
| `C:\Projects\DAOU.Athena\app\canvas.js:942-968` | renderBoardSurfaceCard — 정리자 미등록·높이 0 위험 |
| `C:\Projects\DAOU.Athena\app\canvas.js:982, 1031, 1094` | semanticWorkspace.upsert 보드 가드 없음 |
| `C:\Projects\DAOU.Athena\app\canvas.js:1313-1345, 1430-1490, 2040-2062` | AITS descriptor·패널 마운트·껍질 먼저 |
| `C:\Projects\DAOU.Athena\app\lib\aits-chart-panel.js:120-131, 220-276` | panelIdFor·openPanel 컨테이너 충돌 |
| `C:\Projects\DAOU.Athena\app\lib\board-mount.js:369-383, 557-596` | stateLinksFromMarks·mountBoard(Async) |
| `C:\Projects\DAOU.Athena\app\lib\board-template-registry.js:158-161` | contractFor에 primary 없음 |
| `C:\Projects\DAOU.Athena\app\lib\main\board-hydrate.js:15, 71-77, 96` | Bearer 누락·응답 모양 오독 |
| `C:\Projects\DAOU.Athena\app\lib\main\board-hydrate.test.js:44-61` | 틀린 계약을 고정한 테스트 |
| `C:\Projects\DAOU.Athena\app\lib\main\rest-dataset-runner.js:1026-1041` | buildQuoteDataset |
| `C:\Projects\DAOU.Athena\app\verify-semantic-workspaces.js:236, 738-741, 777` | preserve_primary와 소비처 |
| `C:\Projects\DAOU.Athena\app\lib\canvas-tabs.test.js:344-345` | canvas.js:728 원문 고정 검사 |
| `C:\Projects\DAOU.Athena\backend\athena_api\view_recipe_registry.py:55-57` | 시세→차트 recipe override |
| `C:\Projects\DAOU.Athena\backend\athena_api\card_surface_templates.py:249-262, 684` | base_board_for·_STATE_RANK |
| `C:\Projects\DAOU.Athena\backend\athena_api\card_surface_contract.py:136-148, 228-242` | _state_boards·계약 반환 |
| `C:\Projects\DAOU.Athena\backend\athena_api\api\canvas_push.py:1019-1021, 1063-1113, 2012-2033` | 주문 거부·하이드레이션 응답·renderer_id 적재 |
| `C:\Projects\DAOU.Athena\backend\athena_api\canvas_transform.py:306, 760-815` | AITS_CHART_RENDERER_ID·차트 DTO |
| `C:\Projects\DAOU.Athena\backend\ref\kiwoom-common-screen-manifest.json` | presentation.renderer_id 19개(정본 차트 목록) |
| `C:\Projects\DAOU.Athena\backend\ref\card-surface-templates\32S7-0\slots.json` | primary.renderer 저작 정본 예시 |
| `C:\Projects\DAOU.Athena\backend\ref\card-surface-templates\137X-2\regions.json` | 14P9-2 Athena Chart Module Mount |
| `C:\Projects\DAOU.Athena\scripts\paper_board_extract.py:1042-1119, 1234-1321, 1686-1787, 2157-2162` | 표 인식·상태 컨트롤 표식 |
| `C:\Projects\DAOU.Athena\scripts\build_board_registry.py:95-142, 153-178` | 마운트 계약 투사(여기서 primary가 잘린다) |
| `C:\Projects\DAOU.Athena\docs\architecture\card-surface-implementation-plan.md:9, 38` | D1과 slots.json 스키마 — 수정 대상 |
