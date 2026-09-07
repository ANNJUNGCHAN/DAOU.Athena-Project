# Paper 전수 정합 게이트 설계 — 「Paper에 있는 것이 전부 구현됐는가」를 기계가 판정한다

작성 2026-09-06 · 읽기 전용 설계(코드 수정 없음) · main HEAD `ab8aeb1` 기준
대상 저장소 `C:\Projects\DAOU.Athena`

---

## 0. 30초 요약

Paper 파일 「Athena」 10페이지 444보드 중 **구현 대상 417장**이 실제 앱에 있는지를 세 게이트가 나눠 잰다.

    444 = 417 대상 + 27 제외
    417 = 카드 96 + 화면계 106 + 카드미니 203(견본 11 + 실카드 192) + 증명 12
     27 = 카드 규격 8 + 구현 현황 기록 17 + 백테스트 폐기 2
    (화면계 106에서 지도·색인 성격의 `reference` 보드가 더 빠질 수 있다 — 2.2절 매니페스트가 확정한다)

가장 중요한 설계 결정 하나: **세 게이트는 각각 「정적 층」과 「런타임 층」으로 쪼갠다.**

| 층 | 무엇을 재나 | 러너 | 실측 소요 | pre-push |
|---|---|---|---|---|
| 정적 | 원장 ↔ 저장소 산출물 ↔ 레지스트리 3자 대조, 상태 링크 폐포, 라우트표 신선도 | plain node | **< 3초** (실측 근거 §1.4) | **들어간다** |
| 런타임 | 실제 셸에서 마운트·기하·도달 절차 | electron | 3~14분 | **못 들어간다** |

정적 층만으로 이미 "Paper가 바뀌었는데 코드가 안 따라왔다"의 대부분을 잡는다. 런타임 층은
"코드가 실제로 그린다"만 남긴다. 이 분리를 안 하면 96장 × 4폭 electron 루프 하나가
게이트 전체가 되어 아무도 안 돌린다.

---

## 1. 전제 — 지금 있는 것을 정확히 적는다

### 1.1 현재 electron 게이트가 재는 범위 (= 구멍의 크기)

| 게이트 | 재는 보드 수 | 근거 |
|---|---|---|
| `verify:integrated-cards` 반응형 | **6장** | `app/lib/board-glyph-geometry.js:3-6` `DEFAULT_READABILITY_BOARD_IDS = ['2SKU-1','2R3M-1','13BC-2','2QFO-2','13K0-2','135M-2']` → `app/verify-integrated-cards.js:1437` `DEFAULT_REAL_BOARDS` |
| `verify:agent-paper-parity` | 에이전트 페이지 **일부**(보드 02~06·09~12를 문구 단언으로) | `app/probe-agent-paper-parity.js:14-25` 머리 주석이 재는 7항목을 명시 |
| `verify:kiumi-cards` | 카드미니 **96장**(원장 기준, Paper 기준 아님) | `app/probe-orb-kiumi-96.js:13,160` |
| `verify` `paperScreenCases` | Paper **AT-CV-005 승인 템플릿 13종**(F1·F2·T1~T4·C1·C2·E1~E3·A1·S1) — 보드가 아니라 캔버스 문법 | `app/verify.js:3695-3789` |
| `verify:settings` / `verify:plugins` / `verify:semantic-workspaces` | 기능 왕복(보드 대조 아님) | `app/verify-settings.js`, `app/verify-plugins.js` |

즉 **444보드 중 보드 단위로 잰 것은 6 + 96 = 102장, 그것도 카드/카드미니 쪽뿐**이고
화면·그래프·플러그인·백테스트·증명 페이지는 보드 단위 판정이 0이다.

### 1.2 카드 트랙은 이미 절반이 만들어져 있다 (재사용 자산)

`backend/ref/card-surface-templates/<board_id>/`에 보드마다 6개 파일이 있다
(실측 `137X-2`: `board.html` 58KB · `paper.jsx` 62KB · `paper.tree.txt` 17KB · `slots.json` 116KB ·
`regions.json` · `meta.json`).

`slots.json`이 이미 들고 있는 것:

- `text_multiset` — Paper 트리 텍스트 다중집합 (`scripts/paper_board_extract.py:2310`이 생성)
- `paper_source.jsx_sha256`, `html_sha256` — 드리프트 해시
- `state_controls.marks[].boards[]` — 자식 상태 보드 링크
- `slots[].paper_text` — 슬롯별 Paper 원문
- `kiumi` — 카드미니 계약 투영본 (`scripts/build_kiumi_registry.py`가 씀)

`backend/ref/card-surface-templates/index.json` — 96보드 색인 +
`state_controls: {resolved: 83, unresolved_count: 0, unresolved: []}`.

**즉 새 게이트가 처음부터 만들 것은 「화면계」와 「Paper 최신 상태」 두 축뿐이다.**

### 1.3 실측으로 확인한 사실 (설계가 기대는 근거)

직접 재서 확인했다:

```
96보드 slots.json 전량 읽기 = 186 ms · 13.5 MB · 슬롯 18,048개
슬롯 전량이 paper_text를 갖는 보드 = 96 / 96  (부분 바인딩 0장)
state_controls 링크 83개 → 색인 밖 대상 0개 (정적 폐포 이미 닫혀 있다)
2SKU-1: slots.json.text_multiset distinct 154 · total 199 · slots 199
2SKU-1: 실앱 리포트 distinct_text_count 154 · slot_count 199 · bound_slot_count 199
생성 색인 app/lib/board-templates.index.generated.js = 97 (= 96 + fixture-quote)
```

마지막 두 줄이 핵심이다 — **실앱 DOM 텍스트 distinct와 `slots.json.text_multiset` distinct가
이미 정확히 일치한다.** 보드는 `paper_text`를 그대로 값으로 받아 마운트되므로
(`app/verify-integrated-cards.js:1474-1479`) 포매터가 다중집합을 바꾸지 않는다.

→ **결론: 슬롯 치환 값 제외 규칙은 필요 없다.** `paper_text`를 그대로 fixture로 쓰면
DOM 텍스트 다중집합 == Paper 텍스트 다중집합이 **정확 상등**으로 성립한다.
(사용자 질문 "슬롯 치환 값 제외하거나 fixture 값으로 치환"에 대한 답: **fixture = paper_text,
제외 규칙 없음.** 지금 코드가 이미 그렇게 한다.)

### 1.4 pre-push 예산 실측 근거

`scripts/hooks/pre-push:1-18` — `git config core.hooksPath=scripts/hooks`.
현재 훅은 게이트 4종(`scripts/gates/*.mjs`) + `app` 단위 테스트 전량이고
머리 주석이 **"push당 지연 예산 60초 · backend pytest는 의도적 제외 · 사후에 추가하지 말 것"**
을 못 박아 뒀다.

정적 층 3개(§6.3)를 합쳐도 원장 I/O가 지배적이고 그게 186 ms다. **2~3초 안에 끝난다.**
이 훅의 취지(결정론층 강제)와 정확히 같은 부류라 넣을 수 있다.

---

## 2. 공통 기반 — Paper 원장을 저장소 정본으로 만든다

### 2.1 원장 위치와 형식

다른 워크플로가 지금 뽑고 있는
`scratchpad/paper-ledger/<pageId>/<board_id>.json` + `.tree.txt`를
**`backend/ref/paper-ledger/<pageId>/<board_id>.json` (+ `.tree.txt`)** 로 커밋한다.

현재 추출 진행 상태(실측): `1-0` 23파일 · `8-1` 16 · `A-2` 3 · `F-1` 0 — **아직 진행 중이다.**

JSON 형식(추출기 `parse.py`/`build.py` 실측):

```json
{ "board_id","page","page_name","name","width","height",
  "texts":[{"id","text","path":[프레임 이름들]}],
  "frames":[{"id","name","component","w","h","depth"}],
  "text_multiset":{"텍스트":개수},
  "exported_at","tree_summary_sha256" }
```

### 2.2 원장에 반드시 추가해야 할 것 — 매니페스트

**지금 추출기의 결함 하나를 먼저 고쳐야 한다.** `build.py`/`parse.py`는 `page`·`page_name`을
**스크립트 상수로 하드코딩**한다(`build.py`의 `BASE=.../8-1`, `"page": "8-1"`). 실측으로
`8-1/` 폴더 안에 `3Z8U-1` "09 · **그래프** — 채팅이 화면을 몬다",
`3ZAA-1` "10 · **그래프** …", `3ZC2-1` "11 · **그래프** …" 세 장이 들어 있다.
페이지 귀속이 틀렸거나, 폴더 배치가 틀렸다. **어느 쪽이든 게이트가 `page` 필드를 믿으면 안 된다.**

→ `backend/ref/paper-ledger/manifest.json` 하나를 손으로 확정해 커밋하고, 게이트는 이것만 믿는다.

```json
{
  "schema_version": 1,
  "paper_file_id": "01M0VGPX92K1TER4ZV9PWGQJJZ",
  "exported_at": "2026-09-06",
  "pages": [
    { "id": "1-0", "name": "화면",      "boards": 45 },
    { "id": "D-2", "name": "그래프",     "boards": 7 },
    { "id": "A-2", "name": "에이전트",   "boards": 12 },
    { "id": "B-2", "name": "플러그인",   "boards": 9 },
    { "id": "C-2", "name": "키우미",     "boards": 9 },
    { "id": "5-1", "name": "카드",       "boards": 104 },
    { "id": "F-1", "name": "증명",       "boards": 12 },
    { "id": "H-1", "name": "카드미니",   "boards": 203 },
    { "id": "8-1", "name": "백테스트",   "boards": 26 },
    { "id": "G-1", "name": "구현 현황",  "boards": 17 }
  ],
  "boards": [
    { "id": "1I0-0", "page": "1-0", "name": "19 · 인증 — OAuth 토큰 ready", "role": "screen" },
    { "id": "137X-2", "page": "5-1", "name": "CC-03 / R01 · 삼성전자 3개월 차트", "role": "card_template" },
    { "id": "2GZM-2", "page": "8-1", "name": "15 · …", "role": "retired", "why": "사용자 폐기 지정 2026-09-05" }
  ]
}
```

**`role` 어휘(폐쇄집합) — 이것이 "폐기·참고·기록 보드 제외 규칙"의 기계 표현이다.**

| role | 뜻 | 게이트 | 예상 수 |
|---|---|---|---|
| `screen` | 화면·그래프·에이전트·플러그인·키우미·백테스트의 구현 대상 | **게이트 2** | 106 |
| `card_template` | 카드 96장 (= `card-surface-templates/index.json`과 1:1) | **게이트 1** | 96 |
| `card_spec` | 카드 페이지의 규격 보드 8장 (템플릿 아님) | 제외 | 8 |
| `mini_template` | 카드미니 문법 견본 11장 | **게이트 3** | 11 |
| `mini_card` | 카드미니 실카드 192장 | **게이트 3** | 192 |
| `contract` | 증명 페이지 12장 (계약 문서) | 게이트 2의 **문서 대조 모드** | 12 |
| `record` | 구현 현황 페이지 17장 (기록물) | 제외 | 17 |
| `reference` | 지도·정본 색인 보드 (예 `164F-2` "01 · 화면 정본 — 최신 흐름과 상태 지도") | 제외 | 화면 페이지 내 소수 |
| `retired` | 폐기 (8-1의 15·16) | 제외 — `why` 필수 | 2 |

매니페스트가 지켜야 할 불변식(정적 테스트로 잠근다):

1. `sum(pages[].boards) == 444`, `boards[]` 길이 == 444
2. 페이지별 `boards[]` 실개수 == `pages[].boards`
3. `role=="card_template"` 집합 == `card-surface-templates/index.json`의 96 board_id 집합 (정확 상등)
4. `role=="retired"`는 `why` 필수 — 사유 없는 제외 금지
5. 모든 `boards[].id`에 대해 `backend/ref/paper-ledger/<page>/<id>.json`이 실재

**이 5개가 세 게이트 전부의 전제조건**이다. 매니페스트가 깨지면 나머지는 안 돈다(fail-closed).

### 2.3 원장이 뜻하는 것 — 3자 대조 사슬

```
Paper (지금)  ──ledger──▶  backend/ref/paper-ledger/*.json
                                    │  (A) 정적: Paper 드리프트
                                    ▼
                     backend/ref/card-surface-templates/<b>/slots.json
                                    │  (B) 정적: 레지스트리 드리프트
                                    ▼
                      app/lib/board-templates.*.generated.js
                                    │  (C) 런타임: 마운트 충실도
                                    ▼
                              실앱 DOM
```

A·B가 정적(node/python, 밀리초), C만 electron이다. **A ∧ B ∧ C ⇒ Paper == 앱.**
직접 `ledger ↔ DOM`을 비교하지 않는 이유는 두 가지다 — (1) 실패가 났을 때 어느 구간이
깨졌는지 못 가른다, (2) 값싼 A·B를 매 push마다 돌릴 수 있는 기회를 버린다.

---

## 3. 게이트 1 — `verify:paper-cards-all` (카드 템플릿 96장 전수)

### 3.1 두 층으로 쪼갠다

| 스크립트 | 층 | 재는 것 | 러너 | 예상 소요 |
|---|---|---|---|---|
| `verify:paper-cards-static` | 정적 | (b) 텍스트 다중집합 3자 대조, (c) 상태 링크 폐포, (e) 해시 드리프트 | node | **< 3초** |
| `verify:paper-cards-mount` | 런타임 | (a) 마운트 성공, (d) 4단 폭 overflow 0, (c') DOM `data-state-board` 실재 | electron | 3.5절 |
| `verify:paper-cards-all` | 묶음 | 위 둘을 순차 실행 | node | 합 |

사용자가 준 (a)~(e)를 층에 배정한 근거:

- (b) 텍스트 다중집합 — **정적으로 완결된다.** DOM은 `paper_text`를 그대로 그리고(1.3절),
  값 포매팅이 다중집합을 안 바꾸는 것은 6보드에서 이미 실측됐다. 96장을 electron으로
  돌려 이걸 또 확인하는 것은 같은 사실을 10분 들여 다시 사는 것이다.
  정적은 `ledger.text_multiset == slots.json.text_multiset` (구간 A),
  런타임은 그 부산물로 `dom_text == slots.json.text_multiset` (구간 C)만 확인.
- (c) 상태 링크 — 정적으로 **이미 0 미해소**(실측 83/0). 런타임에서 볼 것은 DOM에
  `data-state-board` 속성이 실제로 찍혔는가뿐이다(`app/canvas.js:900-901`).
- (e) 해시 드리프트 — **electron이 전혀 필요 없다.** 이미 있는 `--check` 3개를 부른다.

### 3.2 정적 스크립트 — `app/scripts/paper-cards-static.mjs` (신규)

```
입력  backend/ref/paper-ledger/manifest.json
      backend/ref/paper-ledger/5-1/<board>.json            (role=card_template 96장)
      backend/ref/card-surface-templates/<board>/slots.json
      app/lib/board-templates.index.generated.js
출력  app/captures/paper-gates/PAPER-CARDS-STATIC.json
종료  실패 1건이라도 있으면 exit 1
```

검사 6종:

| # | 이름 | 판정 |
|---|---|---|
| S1 | 매니페스트 불변식 | 2.2절의 5개 |
| S2 | 원장 vs slots 텍스트 다중집합 | `ledger.text_multiset` == `slots.text_multiset` (키·값 완전 상등). 다르면 `added`/`removed`/`count_changed` 3분류로 남긴다 |
| S3 | 원장 vs slots 트리 해시 | 아래 「S3의 함정」 참조 |
| S4 | 상태 링크 폐포 | 모든 `slots.state_controls.marks[].boards[]` 대상이 96 색인 안에 있는가(현재 83/0) + 원장 쪽 마크 수와 일치하는가 |
| S5 | 레지스트리 드리프트 | `python scripts/build_board_registry.py --check` (`scripts/build_board_registry.py:205,214`) 와 `python scripts/paper_board_extract.py --check` 를 spawn해 exit 0 확인 |
| S6 | 색인 대칭 | 생성 색인 97 == 96 + `fixture-quote` 정확히 (지금 그렇다) |

**S3의 함정 — 그대로 구현하면 96장 전부 항상 실패한다.**
`slots.json.paper_source.jsx_sha256`는 `paper.jsx`의 해시고, 원장의 `tree_summary_sha256`는
`get_tree_summary` 원문의 해시다. **둘은 절대 같아질 수 없다.** 반드시 같은 종류끼리 비교한다.

- `ledger.tree_summary_sha256` vs `sha256(normalize(card-surface-templates/<b>/paper.tree.txt))`
- `jsx_sha256`는 Paper `get_jsx` 재추출이 있을 때만 (원장은 jsx를 안 뽑는다)

정규화 규칙(양쪽 동일): CRLF를 LF로, 후행 개행 제거, 줄 후행 공백 제거.
그래도 안 맞으면 `paper.tree.txt`가 depth 10으로 뽑힌 것과 원장 depth가 다를 수 있다.
**원장 추출기를 depth 10으로 고정하는 것이 S3의 전제다.**

### 3.3 런타임 프로브 — `app/probe-paper-cards-mount.js` (신규)

**기존 코드에서 그대로 가져오는 것** (복붙이 아니라 공용 모듈로 추출한다 — 3.6절):

| 가져올 것 | 원본 위치 | 하는 일 |
|---|---|---|
| `loadRealBoardContract(boardId, ordinal)` | `app/verify-integrated-cards.js:1459-1492` | slots.json 을 surface_contract 봉투 계약으로 (paper_text 를 값으로) |
| `boardInstanceId(boardId)` | `:690-692` | board-소문자보드id |
| `sendBoardEnvelope(win, surface)` | `:694-746` | `athena:add-rest-canvas` 발신 + `athena:rest-canvas-painted` 영수증 대기(15초) |
| `activateBoardTab(win, instanceId)` | `:748-771` | 탭 클릭 + `.board-surface` 마운트 대기(10초) |
| `settleBoardLayout(win, instanceId)` | `:776-802` | `waitForStableLayout` 4샘플 안정 (`app/lib/board-glyph-geometry.js:341`) |
| `boardStepProbe(instanceId)` | `:815-1340` | DOM 텍스트 다중집합 · 슬롯 도달 · overflow · 기하 |
| `assertSurfaceGeometry` | `:536-577` | overflow_x 1px 초과 하드 실패 |
| `inspectBoardChrome` | `:1664-1706` | 카드 크롬 0 · board-surface 1 |
| `BOARD_WINDOW_PRESETS` | `:522-528` | 1920x1080 · 960x1080 · 640x540 · 480x420 |
| `CARD_KIND` | `:680-684` | CC-01..06 을 account/order/… 로 (틀리면 보드가 안 선다) |
| 프로필 격리 | `app/probe-agent-paper-parity.js:26-38` | `ATHENA_NO_AUTOSTART=1`, `ATHENA_CANVAS_SOURCE=fixture`, 전용 userData |
| 창 부팅 | `app/probe-agent-paper-parity.js:105-118` | `require("./main.js").createWindows()` 뒤 `#app` hidden=false 대기 |

**가져오지 않는 것 (이게 96장을 감당 가능하게 만드는 절반이다):**

- `assertReadability` 와 `assertReadabilityMatrix` (글리프 겹침·원자 줄바꿈) — 6장 정본 검수의 몫.
  96장에 걸면 G5a에서 확정한 6장 기준선이 흔들리고, 판정이 「Paper에 있는 것이 구현됐나」가
  아니라 「가독성이 좋은가」로 미끄러진다.
- `capturePage` 와 PNG 저장 — **전면 제거.** 96 x 4 = 384 PNG는 검수 자산이 아니라 쓰레기다.
  `app/lib/integrated-card-capture-hygiene.js` 의 캡처 위생 계약도 딸려오지 않는다.
- `BOARD_BREAKPOINT_PROBE_PRESETS`(XL·M 프로브, `:531-534`) 와 `assertBreakpointContract`
  — 5단 계약 증명은 6장 정본의 몫.
- `exerciseBoardRealtime`, 파이썬 fixture factory(`:52-62`, `:64-81`)
  — 실시간 이음매는 `fixture-quote` 1장이 계속 맡는다.

**「스크린샷 없이 기하 측정만으로 줄이는 법」의 답이 위 두 번째 항목이다.**
`boardStepProbe` 가 돌려주는 `overflow_x` · `overflow_nodes` · `dom_text` · `slot_multiset` 은
전부 DOM 측정값이고, **어떤 단언도 PNG를 읽지 않는다** — `app/verify-integrated-cards.js:1508-1513`
이 찍고 `:1516` 이후 단언은 probe만 본다.

### 3.4 루프 반전 — 96x4를 4x96으로 뒤집는다

현재 `captureBoardSteps`(`:1494-1560`)는 **보드마다 창을 4번 리사이즈**한다.

```
for board in 96:  for preset in 4:  setContentSize -> settleBoardLayout -> probe
```

`settleBoardLayout` 이 비싼 이유는 창 리사이즈가 비동기라 4샘플 안정을 기다리기 때문이다
(`:772-775` 주석: 같은 단계가 실행마다 377/537px로 흔들렸다). 96장이면 **384회 리사이즈**다.

새 프로브는 뒤집는다.

```
for preset in 4:                       # 창 리사이즈 4회
    setContentSize(preset)
    for board in 청크:                  # 탭 활성화
        (첫 preset에서만) sendBoardEnvelope(board)
        activateBoardTab(board)
        settleBoardLayout(board)       # 창 크기가 안 변했으니 훨씬 빨리 수렴
        probe = boardStepProbe(board)
        assertSurfaceGeometry(...)
```

주의점 둘.

- 96장을 동시에 마운트하면 DOM 노드가 약 30,000개(보드당 평균 300요소 x 96)가 된다.
  **카드 청크 단위로 끊는다** — 실측 분포 CC-01 14 · CC-02 6 · CC-03 31 · CC-04 9 · CC-05 15 · CC-06 21.
  청크당 최대 31장, 약 9,000노드로 지금(6장)의 5배 수준이라 감당된다.
  `app/lib/board-template-registry.js` 의 `loadChunk(cardId)` 가 청크를 1회만 주입하므로
  카드별로 묶으면 청크 주입도 6회로 끝난다.
- 청크 사이에는 `window.AthenaShell.clearCanvases()` 로 비운다(`app/verify.js:3745` 패턴).

### 3.5 소요 — 정직한 추정과 측정 방법

**추정 근거.** 지금 `verify:integrated-cards` 는 예산 180초 안에
(6보드 x 6측정 + 24 PNG) + (통합카드 6장 x 2 PNG) + 파이썬 fixture factory 2회 + 실시간 이음매를
전부 끝낸다(`app/lib/live-full-catalog.js:72`). 보드 6장 몫만 떼면 대략 45~70초,
즉 **보드당 8~11초**. 분해하면 리사이즈+settle 0.3~0.6초 · probe 0.05~0.12초 ·
capturePage+PNG 0.3초, 이것이 측정 6회.

| 구성 | 96장 예상 | 산식 |
|---|---|---|
| 지금 구조 그대로 (PNG 포함) | **13~18분** | 8~11초 x 96 |
| PNG·글리프·breakpoint 제거 | **6~9분** | 측정 4회 x (settle+probe), 약 4~6초/보드 |
| 루프 반전(3.4절) 추가 | **3~5분** | 리사이즈 4회로 settle 비용 급감 |
| 카드 6청크 3-way 병렬 | **1.5~2.5분** wall | 샤딩 |

**이 숫자는 추정이다. 구현자는 반드시 파일럿으로 먼저 잰다** (코드 변경 0).

```bash
cd app
ATHENA_VERIFY_BOARD_IDS=2SKU-1,2SCE-1,2T63-1,2TAG-1,137X-2,2R3M-1,13BC-2,2QRP-1,2QFO-2,2QM7-2,13K0-2,2TZN-1 \
  npx electron verify-integrated-cards.js
```

`ATHENA_VERIFY_BOARD_IDS` 는 이미 있다 — `app/verify-integrated-cards.js:37`,
`app/lib/integrated-card-capture-hygiene.js:19-32` `resolveBoardSelection`.
비정본 실행이라 캡처는 `captures/integrated-cards/diagnostic/` 로 격리된다.
파일럿 wall time 나누기 12 곱하기 96 이 「지금 구조 그대로」 값이다. 여기에 위 감축률을 적용한다.

**샤딩은 1차 구현에서 넣지 마라.** 순차 5분이면 충분하고, 병렬은 electron 좀비 문제를
다시 연다 — `app/scripts/run-verify-suite.js:33-36` 주석이 Windows에서 cmd, npm, electron
3단 트리를 `terminateTree` 로 죽여야 한다고 적어 뒀고 최근 커밋 `9e99667`, `0ae19bc` 가
바로 그 문제를 고쳤다. 나중에 넣을 때는 `--shard <cardId>` + 샤드별 userData
(`app/verify-integrated-cards.js:48` 패턴) + 전용 러너 `app/scripts/run-paper-cards-shards.mjs`.

### 3.6 리팩터 — 공용 모듈 추출

`verify-integrated-cards.js` 2,253줄에서 보드 부분을
**`app/lib/board-probe.js` (신규, main 프로세스 전용)** 로 옮긴다.

```js
module.exports = {
  BOARD_WINDOW_PRESETS,   // <- :522-528
  CARD_KIND,              // <- :680-684
  boardInstanceId,        // <- :690-692
  loadRealBoardContract,  // <- :1459-1492  (인자에 templateRoot 추가)
  sendBoardEnvelope,      // <- :694-746
  activateBoardTab,       // <- :748-771
  settleBoardLayout,      // <- :776-802
  boardStepProbe,         // <- :815-1340
  assertSurfaceGeometry,  // <- :536-577
  inspectBoardChrome,     // <- :1664-1706
};
```

`verify-integrated-cards.js` 는 이 모듈을 require하도록 고친다.
**기존 6장 게이트의 리포트 형상·단언·PNG 24장은 1바이트도 바뀌면 안 된다.**
회귀 감지선은 `app/captures/integrated-cards/VERIFY-INTEGRATED-CARDS.json` 의 세 블록이다.

- `readability_gate` = `{boards:6, screenshots:24, probes:12, measurements:36}`
- `capture_hygiene` = `{files:24, hashes:24, dimensions:24}`
- `totals` = `{cards:6, operations:299, fields:3705, unique_paths:3703, missing:0, unresolved:0}`

리팩터 전후로 `verify:integrated-cards` 를 돌려 이 3블록이 동일한지 확인한다.

### 3.7 리포트 형식 — `app/captures/paper-gates/PAPER-CARDS.json`

```json
{
  "schema_version": 1,
  "gate": "verify:paper-cards-all",
  "generated_at": "2026-09-06T00:00:00.000Z",
  "manifest_sha256": "...",
  "totals": { "boards": 96, "pass": 71, "fail": 25, "static_fail": 4, "mount_fail": 21 },
  "static": {
    "S1_manifest":       { "ok": true },
    "S2_text_multiset":  { "ok": false, "failed_boards": ["2QM7-2", "3JT4-0"] },
    "S3_tree_hash":      { "ok": true },
    "S4_state_links":    { "ok": true, "marks": 83, "unresolved": 0 },
    "S5_registry_drift": { "ok": true },
    "S6_index_symmetry": { "ok": true }
  },
  "boards": [
    { "board_id": "2QM7-2", "card_id": "CC-05", "name": "...", "status": "fail",
      "failures": [
        { "code": "text_multiset_drift", "layer": "static",
          "added":   [{ "text": "체결강도", "count": 1 }],
          "removed": [{ "text": "체결 강도", "count": 1 }],
          "count_changed": [] },
        { "code": "overflow_x", "layer": "mount", "preset": "최소", "overflow_x": 14,
          "nodes": [{ "node": "3F2A-1", "name": "flow-table", "over": 14,
                      "width": "720px", "min_width": "720px", "flex_shrink": "1" }] }
      ] },
    { "board_id": "137X-2", "card_id": "CC-03", "status": "pass",
      "mount": { "distinct_text_count": 124, "slot_count": 138,
                 "reachable_slot_count": 138, "max_overflow_x": 0,
                 "state_boards_in_dom": 6 } }
  ]
}
```

**실패 코드 폐쇄집합** — 6.4절 변환기가 읽는 유일한 어휘다.

`manifest_broken` · `ledger_missing` · `text_multiset_drift` · `paper_tree_drift` ·
`registry_stale` · `mount_failed` · `overflow_x` · `state_board_missing_in_dom` ·
`slot_unreachable` · `text_multiset_dom_mismatch`

---

## 4. 게이트 2 — `verify:paper-screens` (화면계 106장)

가장 어렵고 가장 값어치가 크다. **「도달 절차가 없는 보드는 미구현으로 실패한다」가
설계의 핵심**이고, 그래서 게이트가 구현을 강제한다.

### 4.1 라우트표 — `app/lib/paper-screen-routes.js` (신규)

```js
'use strict';
// Paper 화면계 보드를 실앱 도달 절차 + 대조 계약으로 잇는다.
// 매니페스트 role==="screen" 보드 전량이 여기 있어야 한다. 없는 보드는 미구현 실패다.
// 셀렉터와 DOM id는 scripts/gates/check-paper-routes.mjs 가 shell.html/orb.html 과 정적 대조한다.

const ROUTES = Object.freeze([
  {
    board: '1I0-0',                        // 19 · 인증 — OAuth 토큰 ready
    window: 'shell',                       // shell | orb
    // 도달 절차 — 선언적 스텝만. 임의 JS는 eval 스텝 하나로 제한하고 사유를 적는다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:auth-status',
        data: { state: 'ready', expiresAt: '+5h42m' } },
      { do: 'mode', view: 'summary' },
      { do: 'command-bar', text: '설정' },   // app/verify.js:111-119 재사용
      { do: 'click', selector: '.settings-nav .nav-item[data-key="accounts"]' },
      { do: 'settle' },
    ],
    // 대조 계약 — 원장에서 고른 대표 문구와 구조 셈
    root: '#settings',
    phrases: [
      '재발급까지 남은 시간',
      '토큰 준비됨',
      '지금 재발급',
      '연결 해제',
      'Athena는 토큰을 저장하지 않습니다. 만료 전에 자동으로 다시 받습니다.',
    ],
    structure: [
      { what: 'count', selector: '.auth-status-rows .uk-lrow', equals: 3 },
      { what: 'count', selector: '.auth-btn-group button', equals: 3 },
    ],
  },
]);
module.exports = { ROUTES };
```

**`reach` 스텝 어휘(폐쇄집합)** — 임의 코드를 라우트표에 심으면 표가 곧 프로브가 되어
유지가 안 된다. 다음만 허용한다.

| `do` | 인자 | 구현 근거 |
|---|---|---|
| `click` | `selector` | `app/verify.js:1959` 패턴 |
| `mode` | `view` (summary/graph/agent/plugin/backtest) | `app/lib/live-full-catalog.js:3-9` `MODES` 의 `navId` 클릭 |
| `command-bar` | `text` | `app/verify.js:111-119` `openSettingsViaCommandBar` |
| `ipc-fixture` | `channel`, `data` | `app/probe-agent-paper-parity.js:126-140` 의 `ipcMain.removeHandler` 후 `handle` 패턴 |
| `envelope` | 캔버스 봉투 | `app/verify.js:3745-3754` `liveEnvelope` 패턴 |
| `wait` | `ms` | |
| `settle` | 없음 | `app/verify.js:1568-1570` `responsiveSettle` (rAF 2회) |
| `eval` | `js`, **`why` 필수** | 탈출구. why 없으면 라우트표 린트가 거절 |

### 4.2 「대표 문구」 선정 규칙 — 원장에서 기계로 뽑고 사람이 지운다

원장 `texts[]` 는 `{id, text, path:[프레임 이름들]}` 이다. 실측 예 (`1-0/1I0-0.json`).

```
{"text":"재발급까지 남은 시간", "path":["19 · 인증 …","Shell 창 · 온보딩 (#onboard)","onb-col (800px)","onb-body · onb-auth-body","auth-timer-card"]}
{"text":"05:42:18",           "path":[…,"auth-timer-row"]}
{"text":"2026-08-25 21:12:04 만료", "path":[…,"auth-timer-card"]}
{"text":"3 / 3",              "path":[…,"onb-head"]}
```

**Paper 프레임 이름이 이미 CSS 클래스와 DOM id를 품고 있다** — `#onboard`, `onb-head`,
`auth-timer-card`, `uk-btn-ghost`, `nav-item is-selected`. 이것이 라우트표 저작을
손노동에서 반자동으로 바꾼다.

**후보 자동 생성기 `app/scripts/paper-phrases.mjs --board <id>` 의 제외 규칙(순서대로):**

| # | 제외 | 조건 |
|---|---|---|
| E1 | 순수 수치·통화·증감 | `^[+\-−▲▼]?[\d,.]+(원|주|%|배|건|개|종목|억원|만주)?$` |
| E2 | 시각·기간·날짜 | `^\d{1,2}:\d{2}(:\d{2})?$`, `^\d{4}-\d{2}-\d{2}`, `^\d{2}/\d{2}`, `^\d{8}$` |
| E3 | 종목코드·계좌·해시 | `^\d{6}$`, `^[0-9]{8,}$`, `^v?[0-9a-f]{6,}$` |
| E4 | 진행 카운터 | `^\d+\s*/\s*\d+$` (3 / 3) |
| E5 | 복합 데이터 줄 | 문자열 안에 E1 토큰이 2개 이상 (+1,850 · +1.24%) |
| E6 | 종목명·계좌 별칭 | `slots.json` 또는 원장 어디서든 `kind:"value"` 슬롯 텍스트로 등장하는 문자열 |
| E7 | 1글자 기호 | `^[●◆◐○▸·—↗×]$` |
| E8 | 데이터 접미 라벨 | E1 토큰 + 한국어 접미 결합형(수익률 +4.96%, 출금가능 28,940,000원) — 라벨 부분만 남길지는 사람이 판정 |

**포함 가점(자동 후보 우선순위):** `path` 마지막 프레임 이름이
`*-title` `*-head` `*-kicker` `*-sub` `*-hint` `*-label` `*-tab` `nav-item*` `uk-btn-*`
`*-caption` `*-empty*` 중 하나면 우선 후보.

**최종은 사람이 확정한다.** 생성기는 `paper-screen-routes.js` 에 붙일 `phrases` 초안을
콘솔에 뿌리고 저작자가 **보드당 3~7개**로 줄인다. 3개 미만이면 게이트가 공허 통과하고
7개를 넘으면 문구 수정마다 게이트가 깨진다.

**미결(15번 작업 전에 정할 것) — 후보가 3개 미만인 보드.** 부팅 보드 2장
(`16OD-2` 02 · 부팅 — READY, `16OX-2` 05 · 부팅 — COMPLETE)은 원장 라벨이
`ATHENA`·`|` 둘뿐이라 규칙을 어떻게 바꿔도 3개가 안 된다. 전수 저작 전에
「문구 3개 미만 보드는 `structure` 만으로 잰다」 같은 예외를 여기에 먼저 확정하고,
`paper-screen-routes.test.js` 의 3~7개 단언에 그 예외를 함께 넣어야 한다.
지금 표(초기 8장)에는 해당 보드가 없어 시드 게이트에는 영향이 없다.

**절대 넣지 않는 것:** 숫자·시각·종목명·계좌번호·금액, 즉 fixture가 바뀌면 바뀌는 것 전부.
**넣는 것:** 제목·부제·버튼 라벨·탭 라벨·섹션 제목·안내문·빈 상태 문구.

### 4.3 구조 대조 — 원장 `frames[]` 에서 셈을 뽑는다

`structure` 는 세 종류만 허용한다. 더 늘리면 Paper 픽셀 복제 게이트가 된다.

| `what` | 뜻 | 원장에서 뽑는 법 |
|---|---|---|
| `count` | `selector` 개수 == `equals` | 같은 부모 아래 같은 `name` 을 가진 `frames[]` 형제 수 (탭 3개·행 3개·칩 4개) |
| `order` | `selector` 들의 textContent 순서 == 배열 | 같은 부모의 자식 `texts[]` 를 `id` 순서로 |
| `absent` | `selector` 가 0개 | 없어야 하는 것. Paper에 입력 필드가 없는데 앱에 있으면 실패 — `app/probe-agent-paper-parity.js:336` 의 `inputCount === 0` 선례 |

### 4.4 라우트표 신선도 게이트 (정적) — 표가 썩는 것을 막는다

`scripts/gates/check-paper-routes.mjs` (신규).
**`scripts/gates/check-harness-freshness.mjs:1-25` 의 오라클을 그대로 복제한다.**
그 게이트가 존재하는 이유가 정확히 이 문제다 — 머리 주석이 이렇게 적어 뒀다.
「설계가 바뀌면 하네스가 사라진 요소를 계속 참조하면서 항상 실패 또는 공허 통과로
조용히 거짓말한다」.

검사 6종.

1. `ROUTES[].reach[].selector` / `root` / `structure[].selector` 의 **DOM id 리터럴**이
   `app/shell.html` 또는 `app/orb.html` 에 실재 (원본 게이트의 규칙 1과 동일)
2. `reach[].channel` 이 `preload.js` 허용 Set 또는 `main.js` 등록에 실재 (규칙 2와 동일)
3. `ROUTES[].board` 가 매니페스트 `role=="screen"` 집합의 부분집합이고 중복 없음
4. `phrases[]` 가 해당 보드 원장 `texts[]` 의 텍스트에 **실재** — 오타 방지.
   이게 없으면 저작자가 잘못 친 문구 때문에 영원히 빨간 보드가 생긴다
5. `phrases[]` 가 E1~E7에 걸리지 않는다 — 데이터 값을 문구로 넣는 실수 차단
6. `eval` 스텝에 `why` 가 있다

순수 정적·밀리초라 **pre-push에 들어간다.** 선례는 `app/lib/live-full-catalog.test.js:20-27`
이 `MODES` 의 `navId`/`canvasId`/`data-view` 를 `shell.html` 과 대조하는 것 — 완전히 같은 형식이다.

### 4.5 래칫 — main 푸시를 막지 않으면서 회귀만 막는다

`app/paper-gates/paper-screens-ratchet.json` (커밋)

```json
{
  "schema_version": 1,
  "gate": "verify:paper-screens",
  "blessed_at": "2026-09-06T00:00:00Z",
  "blessed_by": "verify:paper-screens --bless",
  "target_boards": 106,
  "passing": ["1I0-0", "1KK-0", "ARM-0", "B57-0"],
  "passing_count": 4,
  "shrink_log": []
}
```

**판정 규칙.**

| 상황 | 종료 코드 | 이유 |
|---|---|---|
| `passing` 에 있던 보드가 이번에 실패 | **1** | 회귀 — 막는다 |
| `passing` 밖 보드가 실패 (라우트 없음 포함) | 0 | 아직 미구현 — 안 막는다 |
| `passing` 밖 보드가 통과 | 0 + 경고 `[ratchet] 새로 통과: <ids> — --bless로 잠그시오` | |
| 라우트표 신선도(4.4절) 실패 | **1** | 표가 썩었다 — 늘 막는다 |
| 매니페스트 불변식 실패 | **1** | 전제가 깨졌다 |

`--bless` 는 `passing` 을 **키우기만** 한다. 줄이려면
`--bless --allow-shrink --why "<사유>"` 가 필요하고 `shrink_log[]` 에
`{at, removed[], why}` 가 남는다. 사유 없는 축소는 거절.

**래칫을 `passing_count` 숫자가 아니라 보드 id 집합으로 잡는 이유:** 개수만 잡으면
A가 깨지고 B가 새로 붙어 총계가 유지될 때 회귀를 놓친다.

### 4.6 증명 페이지(F-1 12장)는 다르게 잰다

`role=="contract"` 12장은 화면이 아니라 **계약 문서**라 DOM 대조가 불가능하다.
대신 `verify:paper-screens --contracts` 가 이렇게 한다.

- 각 계약 보드의 원장 `texts[]` 에서 계약 문장을 뽑아
- `docs/ui/paper-card-surface-charter.md` 와 `docs/architecture/*.md` 안에 그 문장이 실재하는지 문자열 대조

Paper에만 있고 문서에 없으면 `contract_undocumented` 실패다. 즉 「Paper가 새 계약을 그렸는데
아무도 문서에 안 옮겼다」를 잡는다. 래칫에 포함하되 별도 코드로 분류한다.

### 4.7 소요

라우트 하나당 도달 절차 3~8스텝, 약 0.5~2초. 106장이면 **2~4분**.
창을 여러 폭으로 안 바꾸므로 카드 게이트보다 안정적이다
(`app/probe-agent-paper-parity.js:3-9` 주석이 적은 `verify.js` responsiveSettle 행업 위험을 피한다).
다만 `ipc-fixture` 가 많은 라우트는 핸들러 교체 비용이 붙는다.

---

## 5. 게이트 3 — `verify:paper-mini` (카드미니 203장)

### 5.1 지금 있는 것

- 앱 정본 `backend/ref/kiumi/kiumi-ledger.jsonl` **96행** (실측)
- Paper H-1 **203보드** = `mini_template` 11 + `mini_card` 192
- 프로브 `app/probe-orb-kiumi-96.js` — 96행을 오브 대화로 흘려 96장이 그려지는지,
  높이 420 고정, overflow 0, 잘린 텍스트 0, 주문 티켓 버튼 존재를 잰다(`:232-283`)
- 문법 10종 `scripts/build_kiumi_registry.py:20-31` `GRAMMARS`
  (table chart facts compound order_ticket order_confirm event auth reader stream),
  런타임 배정은 `app/probe-orb-kiumi-96.js:34-45` `canvasType`
- 실현 분포(인계 문서 실측) chart 2 · compound 50 · facts 21 · order_confirm 5 · order_ticket 1 · table 17
  → **auth · event · reader · stream 4종은 96장 중 0장이다.** 이것이 template 11장이 필요한 이유다.

### 5.2 정본 결정 규칙 — 이 계획에서 가장 위험한 곳

`backend/ref/kiumi/README.md` 가 2026-09-04 실측으로 이미 적어 놨다.

> 96장 전수 대조 결과 **일치 10 · 어긋남 84 · 매핑 확인불가 2**, 근거 없는 행 227개, 누락 element 190개.
> 성격은 편차가 아니라 **다른 보드의 값이 섞여 들어온 것**. …
> **대장 쪽은 자체 일관성이 있다**(484 element 전수에서 부호 대 tone 불일치 0). 반대로 Paper는 보드 간 값이 섞였다.
> 그래서 **대장이 옳고 Paper가 틀렸을 가능성이 높다.**

증거 파일 `backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json` 의 counts는
`{compared:96, match:10, divergent:84, unresolved:2, unbacked_rows:227, missing_elements:190}` 이고
`known_mapping_errors` 에 `46S1-0` 은 `2QRP-1` 이고 `48EL-0` 은 `3JT4-0` 이라는 매핑 오류 2건도 있다.

**사용자 지시는 「Paper가 정본」이다. 이 지시와 위 실측은 정면으로 충돌한다.**
설계는 지시를 따르되 충돌이 게이트 안에서 드러나게 만든다.

```
정본 = Paper.  단, 게이트는 "Paper를 따라 대장을 고쳐라"고 말하지 않는다.
게이트는 어긋남을 세어 보고하고, 각 어긋남을 세 부류로 가른다.
```

| 부류 | 판정 | 기계 판정 근거 |
|---|---|---|
| `paper_cross_board` | **Paper 결함으로 보고** — 대장 수정 금지 | Paper 값이 해당 보드 `slots.json` 에 없고 **다른 보드** `slots.json` 에 있다 (원장 전량 역색인) |
| `paper_form_deviation` | 보고만 | 같은 데이터의 표기 차 (8 대 8종목, 라벨 위치 이동) — 증거 파일이 SOFT로 표시한 부류 |
| `ledger_stale` | **대장 수정 대상** | Paper 값이 해당 보드 `slots.json` 에 실재하는데 대장이 다른 슬롯을 고르고 있다 |

**`paper_cross_board` 가 0이 되기 전에는 「Paper 정본」을 대장에 반영하지 않는다.**
README가 이미 옳은 순서를 적어 놨고 그대로 따른다.
(1) 대장에서 카드미니 마크업을 렌더하는 생성기를 커밋 → (2) Paper 스냅샷 대 대장 `--check` 를 붙임
→ (3) 그 다음에 재생성. **게이트 3은 그중 (2)를 구현하는 것이다.**

### 5.3 세 갈래

| 스크립트 | 대상 | 층 | 재는 것 |
|---|---|---|---|
| `verify:paper-mini-static` | 192 `mini_card` | 정적 node | Paper 원장 대 `kiumi-ledger.jsonl` 대 `slots.json.kiumi` 3자 대조 |
| `verify:paper-mini-template` | 11 `mini_template` | electron | 문법 10종이 `orb-mini-card.js` 로 실제 렌더되는가 |
| `verify:paper-mini` | 묶음 | | 위 둘 |

#### 5.3.1 정적 (192장)

192 = 96 x 2 로 보이지만 **미검증이다.** 원장 `H-1/*.json` 의 `name` 을 보고 `mini/` 접두
규칙과 짝 구조를 확인한 뒤 매니페스트 role을 `mini_card` 와 `mini_annotation` 으로 더 가른다.
증거 파일의 `cards[].boardIdResolved` 가
`frame name "mini/CC-01 / R10-T1 · …" contains ledger title …` 라고 적은 것이 짝 규칙의 단서다.

대조 절차 5단계.

1. Paper 보드명 `mini/<card_id> / <ref> · <title>` 에서 title을 뽑아 대장 `title` 과 매칭.
   실패 시 `mini_unmatched` (증거 파일의 `known_mapping_errors` 2건은 매니페스트에 선반영)
2. Paper 보드의 `texts[]` 행을 대장 `elements[].{label, paper_text}` 다중집합과 대조
3. Paper에만 있는 행은 그 값이 **어느 보드 `slots.json` 에 있는지 역색인**으로 찾아
   `paper_cross_board`(다른 보드) / `ledger_stale`(같은 보드) / `unbacked`(어디에도 없음) 로 분류
4. 대장에만 있는 element는 `missing_in_paper`
5. `slots.json.kiumi` 대 대장 일치는 기존 `python scripts/build_kiumi_registry.py --check` 에 위임

역색인 비용은 96보드 x 평균 188슬롯 = 18,048 텍스트로 Map 하나. **밀리초다.**

#### 5.3.2 런타임 (11 template)

`app/probe-paper-mini-template.js` (신규) — `app/probe-orb-kiumi-96.js` 를 그대로 본뜬다.

| 가져올 것 | 원본 |
|---|---|
| 가짜 claude 컴파일 (csc.exe + base64 NDJSON) | `:94-137` `findCsc` / `buildNdjson` / `compileFakeClaude` |
| 오브 부팅·chat 모드 전환·패널 펼치기 | `:162-207` |
| 카드 감사 (높이 420 · overflow · clippedText) | `:232-262` |
| 리포트 형식 | `:264-283` |

다른 점 하나. 봉투를 대장이 아니라 **template 11장 원장에서** 만든다.
문법 10종을 전부 덮어야 하므로 auth · event · reader · stream 4종은 **여기서만** 검증된다
(96장에는 0장이므로). template 11장이 문법 10종을 덮는지 먼저 정적으로 확인하고,
빠진 문법이 있으면 `grammar_uncovered` 실패다.

#### 5.3.3 리포트 — `app/captures/paper-gates/PAPER-MINI.json`

```json
{ "schema_version": 1, "gate": "verify:paper-mini",
  "canonical_decision": { "source": "paper", "note": "사용자 지시 2026-09-05",
     "conflict": "backend/ref/kiumi/README.md 2026-09-04 실측은 대장 우위로 판단" },
  "totals": { "paper_boards": 203, "ledger_rows": 96,
              "matched": 10, "paper_cross_board": 84, "form_deviation": 0,
              "ledger_stale": 0, "unbacked_rows": 227, "missing_in_paper": 190,
              "unmatched_boards": 2 },
  "grammar_coverage": { "covered": ["facts","compound","table","chart","order_ticket","order_confirm"],
                        "uncovered": ["auth","event","reader","stream"],
                        "template_boards": 11 },
  "boards": [
    { "paper_board": "46AX-0", "ledger_board": "2SCE-1", "status": "divergent",
      "rows": [ { "label": "삼성전자 / 005930", "value": "41,483,750 · +9.04%",
                  "code": "paper_cross_board", "found_in": "3UTA-0" } ] }
  ] }
```

**첫 실행의 기대값이 곧 회귀 기준선이다** — 5.3.1의 구현이 옳다면 이 게이트의 첫 출력은
증거 파일의 `84 / 227 / 190 / 2` 를 **재현해야 한다.** 재현되지 않으면 대조 구현이 틀린 것이다.

---

## 6. 운영 — 게이트가 곧 작업 목록이 되게 한다

### 6.1 npm 스크립트 (`app/package.json`)

```jsonc
"verify:paper-manifest":      "node scripts/paper-manifest-check.mjs",
"verify:paper-cards-static":  "node scripts/paper-cards-static.mjs",
"verify:paper-cards-mount":   "electron probe-paper-cards-mount.js",
"verify:paper-cards-all":     "npm run verify:paper-cards-static && npm run verify:paper-cards-mount",
"verify:paper-screens":       "electron probe-paper-screens.js",
"verify:paper-mini-static":   "node scripts/paper-mini-static.mjs",
"verify:paper-mini-template": "electron probe-paper-mini-template.js",
"verify:paper-mini":          "npm run verify:paper-mini-static && npm run verify:paper-mini-template",
"verify:paper":               "node scripts/run-verify-suite.js --suite paper"
```

### 6.2 `app/lib/live-full-catalog.js` — 스위트를 둘로 가른다

현재 `VERIFY_SUITE`(`:62-76`)는 13개 항목이고 예산 합이 약 22분이다.
여기에 5~15분짜리를 넣으면 스위트가 40분이 된다.

```js
// 기존 스위트 — 값싼 정적 게이트만 추가한다.
const VERIFY_SUITE = Object.freeze([
  { script: 'verify:paper-manifest',     budgetMs: 30000 },   // 맨 앞. 전제가 깨지면 나머지가 무의미
  { script: 'verify:paper-cards-static', budgetMs: 30000 },
  { script: 'verify:paper-mini-static',  budgetMs: 30000 },
  // ...기존 13개 그대로...
]);

// 새 스위트 — electron 전수. npm run verify:paper 가 돌린다.
const PAPER_SUITE = Object.freeze([
  { script: 'verify:paper-manifest',      budgetMs: 30000 },
  { script: 'verify:paper-cards-static',  budgetMs: 30000 },
  { script: 'verify:paper-cards-mount',   budgetMs: 900000 },  // 15분 — 3.5절 파일럿으로 재조정
  { script: 'verify:paper-screens',       budgetMs: 420000 },  // 7분
  { script: 'verify:paper-mini-static',   budgetMs: 30000 },
  { script: 'verify:paper-mini-template', budgetMs: 120000 },
]);
module.exports = { /* ... */ VERIFY_SUITE, PAPER_SUITE };
```

**같이 고쳐야 하는 곳 2개.**

- `app/lib/live-full-catalog.test.js:74-81` — 지금 `budgetMs >= 30000` 과
  `pkg.scripts[item.script]` 실재를 단언한다. `PAPER_SUITE` 에도 같은 단언을 건다.
  추가로 **`PAPER_SUITE` 의 electron 항목이 `VERIFY_SUITE` 에 없다**를 단언해
  누가 실수로 15분짜리를 기본 스위트에 넣는 것을 막는다.
- `app/scripts/run-verify-suite.js:11-17, 71-101` — `--suite <name>` 인자를 받게 확장.
  `parseOnly` 옆에 `parseSuite` 를 만들고 **`parseOnly` 와 같이 오타를 exit 2로 거절**한다
  (`:78-83` 선례 — 최근 커밋 `9e99667` 이 정확히 이 문제를 고쳤다).
  `app/scripts/run-verify-suite.test.js` 에 `parseSuite` 테스트를 추가한다.

### 6.3 pre-push 예산 60초 — 들어가는 것과 못 들어가는 것

`scripts/hooks/pre-push` 는 지금 게이트 4종 + app 단위 전량이다.

**들어간다 (실측 근거 1.4절, 합계 2초 미만).**

```sh
node scripts/gates/check-paper-routes.mjs                       # 라우트표 신선도(4.4절) — 약 0.3초
cd app && node scripts/paper-manifest-check.mjs                 # 매니페스트 불변식 5개 — 약 0.3초
cd app && node scripts/paper-cards-static.mjs --no-python       # S1~S4, S6 — 약 0.5초
```

**들어가면 안 된다.**

| 후보 | 왜 안 되나 |
|---|---|
| `verify:paper-cards-static` 전체 | S5가 파이썬 `--check` 2개를 spawn한다. backend venv 부팅 + 96 jsx 파싱이 수 초에서 수십 초. **훅에는 파이썬을 끌어들이지 않는다** — 훅 주석의 「backend 결정층은 훅 밖」 원칙과 같은 이유 |
| `verify:paper-mini-static` | 원장 I/O만이면 넣을 수 있으나, 지금 84장이 어긋나 있어 **훅이 상시 빨강**이 된다. `paper_cross_board` 가 0이 된 뒤 승격 |
| electron 게이트 전부 | 분 단위. 논외 |

훅 주석이 「사후에 이 훅에 추가하지 말 것」이라고 못 박은 점은 유의한다. 위 3줄은 그 금지가
겨냥한 대상(backend pytest 같은 분 단위 작업)이 아니라 훅이 이미 지키는 결정론층과 같은 부류이고,
합계가 훅 전체 예산의 3%를 넘지 않는다. **그래도 넣기 전에 `time` 으로 실측해 60초 총계를 확인한다.**

### 6.4 리포트를 작업 명세로 — `scripts/paper-gate-tasks.mjs` (신규)

```
node scripts/paper-gate-tasks.mjs \
  --report app/captures/paper-gates/PAPER-SCREENS.json \
  --report app/captures/paper-gates/PAPER-CARDS.json \
  --report app/captures/paper-gates/PAPER-MINI.json \
  --limit 20 --out .omc/plans/paper-tasks.json
```

**작업 1개 = 보드 1장.** 한 보드에 실패가 여럿이면 한 작업으로 합친다.

```json
{
  "key": "PAPER-1-0-1KK-0",
  "title": "화면 20 · 인증 — 토큰 4상태",
  "spec": [
    "도달 절차 미정의 — app/lib/paper-screen-routes.js 에 board 1KK-0 라우트를 추가한다.",
    "원장 대표 문구 후보: 토큰 준비됨 / 곧 만료 / 만료됨 / 연결 안 됨 / 지금 재발급",
    "원장 구조: auth-state-card 4개 (frames[] 형제 셈)",
    "판정: npm run verify:paper-screens -- --only 1KK-0 가 pass 여야 한다."
  ],
  "files": [
    "app/lib/paper-screen-routes.js",
    "app/shell.html",
    "app/lib/onboarding.js",
    "backend/ref/paper-ledger/1-0/1KK-0.json"
  ],
  "gates": [
    "cd app && npm run verify:paper-screens -- --only 1KK-0",
    "node scripts/gates/check-paper-routes.mjs",
    "cd app && npm test"
  ],
  "source": { "report": "PAPER-SCREENS.json", "code": "route_missing",
              "board": "1KK-0", "page": "1-0" }
}
```

**`files` 추론 규칙** — 손으로 안 적게 만드는 부분이다.

| 실패 코드 | files |
|---|---|
| `route_missing` | 라우트표 + 원장 + 아래 페이지-코드 지도 |
| `phrase_missing` | 라우트 `root` 셀렉터를 `app/*.js` 에서 grep한 상위 3파일 |
| `structure_mismatch` | 위와 동일 + `app/styles/*.css` |
| `text_multiset_drift` | `backend/ref/card-surface-templates/<b>/{paper.jsx,paper.tree.txt,slots.json}` + `scripts/paper_board_extract.py` |
| `registry_stale` | `app/lib/board-templates.index.generated.js` + `scripts/build_board_registry.py` |
| `overflow_x` | `app/styles/board-surface.css` + 실패 노드의 `data-name` 을 `<b>/board.html` 에서 grep |
| `paper_cross_board` | `backend/ref/kiumi/README.md` + 증거 파일 (**코드 파일 없음 — Paper 수정 작업이다**) |

페이지-코드 지도(라우트표 상단 상수).

```
1-0 화면      -> app/shell.html, app/shell.js, app/lib/onboarding.js, app/lib/settings-cards.js
D-2 그래프    -> app/lib/graph-mode/*, app/lib/canvas-layout.js
A-2 에이전트  -> app/lib/agent-canvas.js, app/lib/agent-sidebar-list.js, app/lib/watch-nodes.js
B-2 플러그인  -> app/lib/plugin-canvas.js, app/lib/plugin-proposal.js, app/lib/plugin-catalog.js
C-2 키우미    -> app/orb.js, app/lib/orb-mini-card.js
8-1 백테스트  -> app/lib/backtest-*.js
```

**우선순위(정렬 키).**
1. 같은 페이지 보드 수 내림차순 — 한 파일을 여는 김에 여러 장을 닫는다
2. 실패 코드 가중치 `route_missing` > `phrase_missing` > `structure_mismatch` > `overflow_x`
3. 원장 보드명의 선두 번호 오름차순 — Paper 저작 순서가 곧 사용자 동선 순서다

### 6.5 운영 리듬

| 시점 | 도는 것 | 시간 |
|---|---|---|
| 매 push (훅) | 라우트표 신선도 + 매니페스트 + `paper-cards-static --no-python` | 2초 미만 |
| 매 `verify:suite` | 위 + 정적 3종 전부(파이썬 포함) | +20초 |
| 마일스톤 / 야간 | `npm run verify:paper` (electron 전수) | 15~25분 |
| 마일스톤 직후 | `paper-gate-tasks.mjs --limit 20` 으로 다음 랄프 배치 | 초 |

---

## 7. 구현 순서 — 구현자가 그대로 따라갈 표

| # | 산출물 | 선행 | 검증 | 예상 |
|---|---|---|---|---|
| 1 | 원장 추출기 수정 — page 하드코딩 제거, depth 10 고정, 페이지 폴더 재배치(8-1의 그래프 3장 조사) | — | 444 JSON 파일 실재 | 0.5d |
| 2 | `backend/ref/paper-ledger/` 커밋 + `manifest.json` 저작 (444행 role 배정) | 1 | 2.2절 불변식 5개 | 1d |
| 3 | `app/scripts/paper-manifest-check.mjs` + `node --test` | 2 | 불변식 5개 통과 | 0.5d |
| 4 | `app/scripts/paper-cards-static.mjs` (S1~S6, `--no-python`) | 3 | 96장 중 S2/S3 실패 목록 산출 | 1d |
| 5 | `app/lib/board-probe.js` 추출 리팩터 | — | **리팩터 전후 VERIFY-INTEGRATED-CARDS.json 의 readability_gate·capture_hygiene·totals 동일** | 1d |
| 6 | `app/probe-paper-cards-mount.js` (루프 반전 + 청크 단위) | 4, 5 | 12장 파일럿(3.5절) 뒤 96장 | 1.5d |
| 7 | `app/scripts/paper-phrases.mjs` (E1~E8 + 가점) | 2 | 6개 보드 수동 대조 | 0.5d |
| 8 | `app/lib/paper-screen-routes.js` 초기 라우트 **8장** (에이전트 4 + 화면 4, 이미 통과할 것들) | 7 | 8장 전부 pass | 1d |
| 9 | `scripts/gates/check-paper-routes.mjs` | 8 | 일부러 오타를 넣어 exit 1 확인 | 0.5d |
| 10 | `app/probe-paper-screens.js` + 래칫(bless / allow-shrink) | 8, 9 | 래칫 8장 잠금, 1장을 일부러 깨서 exit 1 | 1.5d |
| 11 | `app/scripts/paper-mini-static.mjs` (역색인 3분류) | 2 | 증거 파일의 84/227/190/2 **재현** | 1d |
| 12 | `app/probe-paper-mini-template.js` | 11 | 문법 10종 커버 | 1d |
| 13 | `scripts/paper-gate-tasks.mjs` | 4, 10, 11 | 20개 작업 JSON 생성 | 0.5d |
| 14 | package.json · live-full-catalog.js PAPER_SUITE · run-verify-suite.js --suite · pre-push 3줄 | 전부 | `npm run verify:paper --list` | 0.5d |
| 15 | 라우트 저작 반복 (8장에서 106장으로) | 10 | 래칫이 매번 자란다 | **지속** |

합계 약 **12일 + 라우트 저작(15번)**.
라우트 저작은 보드당 20~60분이라 106장이면 4~10주 분량이다. 랄프 병렬화의 주 대상이고,
6.4절 작업 명세 변환기가 존재하는 이유가 바로 이것이다.

---

## 8. 이 설계가 틀릴 수 있는 곳 — 구현 전 확인할 것

1. **원장 추출이 아직 안 끝났다.** 실측 시점에 1-0 23/45 · 8-1 16/26 · A-2 3/12 · F-1 0/12,
   나머지 6페이지는 폴더도 없다. 매니페스트 저작(7절 2번)은 추출 완료 후에만 가능하다.
2. **8-1 폴더에 그래프 보드 3장이 섞여 있다** — `3Z8U-1`, `3ZAA-1`, `3ZC2-1` 이고 이름이
   "09/10/11 · 그래프 —" 로 시작한다. 페이지 귀속 오류인지 Paper 실제 배치인지 확인 전에는
   106/108 수치가 흔들린다.
3. **높이 0 보드가 있다** — `2GZM-2` 1680x0, `3Z8U-1` 1680x0 (실측). Paper fit-content 붕괴다.
   게이트가 원장 height 로 어떤 판정도 하면 안 된다.
4. **텍스트 다중집합 정확 상등은 6장에서만 검증됐다.** 나머지 90장에서 포매터가 다중집합을
   바꾸는 보드가 있을 수 있다(`app/lib/board-format.js` 의 단위·부호 처리).
   7절 6번 파일럿에서 12장으로 먼저 확인하고, 깨지면 (b)를 「distinct 집합 상등 + 개수 허용오차」로
   **완화하지 말고** 어느 슬롯이 왜 바뀌는지 먼저 밝혀라. 완화하면 게이트가 조용히 거짓말한다.
5. **카드미니 192 = 96 곱하기 2 가정은 미검증이다.** H-1 원장이 나온 뒤 이름 규칙으로 확정한다.
6. **template 11장이 문법 10종을 다 덮는지 미검증이다.** 11 대 10이라 여유가 1장뿐이고,
   한 장이 두 문법을 겸하거나 한 문법이 두 장일 수 있다.
7. **role 배정은 사람 판단이다.** 특히 화면 페이지 45장 중 어디까지가 screen 이고
   어디부터가 reference 인지는 기계가 못 정한다. 잘못 배정하면 게이트가 영원히 못 닫히거나
   구멍이 뚫린다. 매니페스트는 사용자 검수 대상이다.

---

## 9. 대안과 그 대가

| 선택지 | 이 설계 | 대안 | 대안의 대가 |
|---|---|---|---|
| 정적·런타임 분리 | 분리한다 | 전부 electron 한 프로브 | 구현은 단순하나 매 push 검사가 불가능해지고, 실패 시 Paper·저장소·코드 중 어디가 깨졌는지 못 가른다 |
| 카드 96장 텍스트 대조 | 정적(원장 대 slots) + 런타임(DOM 대 slots) | 런타임에서 원장 대 DOM 직접 | electron 1회로 끝나지만 96장 곱하기 4폭을 매번 돌려야 하고 진단 정보가 없다 |
| PNG | 안 찍는다 | 384장 찍는다 | 사람 검수는 가능해지나 실행이 약 40% 느려지고 디스크 약 100MB, 캡처 위생 계약까지 딸려온다 |
| 미구현 보드 | 라우트 없으면 실패(래칫으로 무해화) | 라우트 없으면 skip | 조용해서 편하지만 **게이트가 구현을 강제하지 못한다** — 사용자 요구의 핵심을 잃는다 |
| 래칫 단위 | 보드 id 집합 | 통과 개수 | 파일은 작지만 A가 깨지고 B가 붙는 경우를 못 잡는다 |
| 카드미니 정본 | Paper(지시) + 어긋남 3분류 보고, 대장 자동수정 없음 | Paper대로 대장 덮어쓰기 | 지시에 100% 충실하나 실측상 84장이 **다른 보드 값**이라 지금 잘 도는 앱을 망가뜨린다 |
| 스위트 배치 | VERIFY_SUITE엔 정적만, PAPER_SUITE 신설 | 전부 VERIFY_SUITE | 단순하나 기본 스위트가 22분에서 40분이 되어 아무도 안 돌린다 |
| 글리프 가독성 검사 | 96장에서 뺀다 | 96장 전부에 건다 | 판정이 「구현됐나」에서 「예쁜가」로 미끄러지고, G5a에서 확정한 6장 기준선이 흔들린다 |

---

## 10. 부록 — 핵심 file:line 색인

### 카드 게이트 재사용

- `app/verify-integrated-cards.js:37` — ATHENA_VERIFY_BOARD_IDS 오버라이드 (샤딩·파일럿 열쇠)
- `app/verify-integrated-cards.js:48` — 샤드별 userData 격리 패턴
- `app/verify-integrated-cards.js:522-528` — BOARD_WINDOW_PRESETS 4폭
- `app/verify-integrated-cards.js:531-534` — BOARD_BREAKPOINT_PROBE_PRESETS (전수에선 제외)
- `app/verify-integrated-cards.js:536-577` — assertSurfaceGeometry, overflow 1px 초과 하드 실패
- `app/verify-integrated-cards.js:680-684` — CARD_KIND, 틀리면 보드가 안 선다
- `app/verify-integrated-cards.js:690-692` — boardInstanceId
- `app/verify-integrated-cards.js:694-746` — sendBoardEnvelope
- `app/verify-integrated-cards.js:748-771` — activateBoardTab
- `app/verify-integrated-cards.js:776-802` — settleBoardLayout
- `app/verify-integrated-cards.js:815-1340` — boardStepProbe (827-832 domText 수집, 1273-1340 반환 형상)
- `app/verify-integrated-cards.js:1437` — DEFAULT_REAL_BOARDS
- `app/verify-integrated-cards.js:1459-1492` — loadRealBoardContract (1474-1479 paper_text 주입)
- `app/verify-integrated-cards.js:1494-1560` — captureBoardSteps (루프 반전 대상)
- `app/verify-integrated-cards.js:1602-1650` — 단계 간 다중집합 상등 단언
- `app/verify-integrated-cards.js:1664-1706` — inspectBoardChrome
- `app/verify-integrated-cards.js:1707-1735` — captureBoardResponsive
- `app/verify-integrated-cards.js:2241-2243` — 리포트 기록
- `app/lib/board-glyph-geometry.js:3-6` — 6장 정본 목록
- `app/lib/board-glyph-geometry.js:341` — waitForStableLayout
- `app/lib/integrated-card-capture-hygiene.js:19-32` — resolveBoardSelection
- `app/lib/board-template-registry.js` — loadChunk / loadBoard / boardIds / cardIdFor
- `app/lib/board-mount.js:369` — stateLinksFromMarks
- `app/canvas.js:762-765, 900-901` — data-state-board 부착

### 화면 게이트 재사용

- `app/verify.js:111-119` — openSettingsViaCommandBar
- `app/verify.js:145-172` — shot (rAF 2회 뒤 캡처)
- `app/verify.js:788-790` — assertOk
- `app/verify.js:1568-1570` — responsiveSettle
- `app/verify.js:3695-3789` — paperScreenCases. 봉투 주입 + probe + 판정 + 리포트 항목의 완성형
- `app/verify.js` 말미 — report.failures / report.exitCode / app.exit(1) 관례
- `app/probe-agent-paper-parity.js:26-38` — 프로필 격리
- `app/probe-agent-paper-parity.js:41-45` — check(label, ok)
- `app/probe-agent-paper-parity.js:105-125` — createWindows 뒤 #app 대기
- `app/probe-agent-paper-parity.js:126-140` — ipcMain.removeHandler 뒤 fixture handle
- `app/probe-agent-paper-parity.js:250-400` — 문구·구조 단언 문법 (그대로 라우트표로 옮길 원본)
- `artifacts/qa/jangjung-20260904/probe-jangjung-modes.js:28-33, 36-120` — 5모드 순회 + SNAP 스냅샷
- `app/lib/live-full-catalog.js:3-9` — MODES, 모드 클릭 스텝의 정본
- `app/lib/live-full-catalog.test.js:20-27` — 라우트표 정적 대조의 선례
- `scripts/gates/check-harness-freshness.mjs:1-25` — 신선도 오라클의 원본

### 카드미니 게이트 재사용

- `app/probe-orb-kiumi-96.js:13, 28-31` — 대장 로드, `:160` 96행 단언
- `app/probe-orb-kiumi-96.js:34-45` — canvasType, 문법에서 캔버스 타입 배정
- `app/probe-orb-kiumi-96.js:47-92` — envelopeFor
- `app/probe-orb-kiumi-96.js:94-137` — 가짜 claude 컴파일
- `app/probe-orb-kiumi-96.js:232-283` — 감사 + 리포트
- `app/lib/orb-mini-card.js:7` — CARD_SIZE 360x420, `:63-98` buildKiumiPlan
- `scripts/build_kiumi_registry.py:20-31` — GRAMMARS 10종, --write / --check
- `backend/ref/kiumi/README.md` — 「미해결」 절, 정본 충돌의 근거
- `backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json` — 84/227/190/2 실측

### 운영

- `app/package.json` — verify 스크립트 블록
- `app/lib/live-full-catalog.js:62-76` — VERIFY_SUITE
- `app/lib/live-full-catalog.test.js:74-81` — 스위트 불변식
- `app/scripts/run-verify-suite.js:11-17` parseOnly, `:24-70` runOne(예산·좀비), `:71-101` main
- `scripts/hooks/pre-push:1-18` — 60초 예산과 추가 금지 주석
- `scripts/paper_board_extract.py` — --check, `:2310` text_multiset 생성
- `scripts/build_board_registry.py:205, 214` — --check
- `scripts/validate_board_slots.py` — a~g 검사 (기존 기준선 59건 b15 e44 / 27보드)
- `backend/ref/card-surface-templates/index.json` — 96보드, state_controls.resolved=83 / unresolved=0
- `docs/handoff/2026-09-03-card-surface-paper-to-code.md` — 카드 트랙 인계 정본
- `docs/handoff/2026-09-03-kiumi-mini-cards-runtime.md` — 카드미니 인계 정본
