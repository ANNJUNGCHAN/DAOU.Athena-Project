# 카드 표면 버튼 — 무엇이 눌리고 무엇이 안 눌리는가 (2026-09-07)

브랜치 `claude/card-buttons-functionality-2b13d9`. 사용자 제보: 「이런 모든 카드에서 버튼을
하나하나씩 전부 눌러서 검사했을 때 버튼이 하나도 안 눌려.」

## 1. 뿌리 원인 — 예외 하나가 전환을 통째로 끊었다

첫 마운트 뒤 `integrated-card-surface`가 보드 자리(`.board-surface-host`)를
`.integrated-card-panel` 안으로 옮긴다. 그런데 `showBoardLoading`은 여전히 **카드 본문**
(`state.loadBody`)을 기준으로 안내 줄을 끼웠다 — 두 번째 호출부터 host가 그 자식이
아니므로 `insertBefore`가 던진다.

```
Uncaught (in promise) NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

첫 렌더는 성공하니 **카드는 정상으로 보이고 버튼만 전부 죽는다.** 기준을
`host.parentElement`로 바꿨다(`canvas.js` `boardLoadAnchor`).

실측: Paper 상태 보드 링크 82개가 **0 → 82** 전부 반응.

## 2. 자식 보드 레일 별칭

추출기는 표식(`data-state-control`)을 그 링크를 **소유한** 보드에만 찍는다. 자식 보드의
레일은 부모 레일의 복제본이라 표식이 없고, 프론트는 문구로 칩을 찾는다 — 문구가 표식
이름과 다르면(「관심종목 시세 보드」의 칩은 「관심」) 영영 안 눌린다. 실측 **44장 98링크**.

색인에 `CONTROL_LABELS`(표식 → 문구)를 실어 `board-mount.findStateControlNode`가 세 갈래로
찾는다: 표식 · 같은 문구 · 별칭 문구. 별칭은 **그 문구가 보드에 하나뿐이고 다른 링크가 같은
문구를 노리지 않을 때만** 쓴다.

저작 쪽 해법도 있다 — `meta.json`의 `state.control_text`(추출기 문서 :47). 새 보드를
저작할 때는 그쪽이 정본이고, 별칭은 이미 추출된 96장을 위한 런타임 그물이다.

## 3. 카드 액션 (`app/lib/board-card-actions.js`)

Paper가 목적지를 다른 card_id로 그린 조작은 상태 보드 전환으로 표현할 수 없다.

| 문구 | 하는 일 | 실측 |
|---|---|---|
| 호가 열기 | CC-04 호가 보드(13BC-2)를 이 카드의 종목으로 새 카드 | `137X-2 → 13BC-2` |
| 종목 상세 열기 | CC-03(137X-2)을 **누른 줄**의 종목으로 새 카드 | `2X5N-0 → 137X-2` |
| 알림 설정 | 에이전트 모드 「새 알람 · 말로 설명」으로 데려간 뒤 채팅에 씨문장을 심는다(보내지 않는다) | `view=agent` · 입력창 `삼성전자 — 감시 알람 만들어 줘` |

봉투 데이터(`data.chart`·호가 조각)가 없으므로 새로 연 카드에는 실차트·실사다리가 아직
앉지 않고 슬롯만 채워진다. `operation_ref`는 합성값(`card-action:<문구>`)이다 — 목적지
보드의 실제 op를 실으면 하이드레이션 실패가 카드를 로딩 오류로 닫는다.

## 4. 회귀 그물 — `npm run verify:card-buttons`

`app/probe-card-buttons.js`가 카드 템플릿 전수(2026-09-08 원장 **101장**)를 실앱 셸에
마운트하고 **진짜 마우스 입력**(`sendInputEvent`)으로 후보를 하나씩 누른다. 판정 네
갈래: `responds` · `hit_blocked`(핸들러는 있는데 그 자리 hit test가 남으로 간다) ·
`inert`(동작 없음) · `offscreen`. 게이트는 **state-control이 전부 반응하는가** 하나만
빨갛게 만든다 — `pill`·`affordance`는 아직 동작이 없는 것이 많아 세기만 한다.

산출물 `app/captures/paper-gates/CARD-BUTTONS.json`. 샤딩
`ATHENA_VERIFY_BOARD_IDS=137X-2,2X5N-0`, 리포트 경로 `ATHENA_CARD_BUTTONS_REPORT`.

전수 (2026-09-08, `f3670cf2` 위, 경과 1,648,041ms, 부팅 화면 `summary`):
`responds=995 · hit_blocked=1 · inert=5771 · gone=0 · offscreen=0`.
유일한 게이트 실패는 `2Z49-0` 상태 링크 `3T2T-0` 「ELW 거래원별 10창구 전체」
(`hit`이 레일 `2Z5L-0`). L부터 wrap-row를 켠 뒤 샤드 `2Z49-0`:
`responds=9 · hit_blocked=0`, `3T2T-0` → 보드 `3TOM-0`. **z-index는 쓰지 않았다.**

프로브가 배운 것 셋(같은 함정을 다시 밟지 않도록):
- 표 행마다 반복되는 버튼은 라벨당 2개만 누른다 — 전수는 보드 하나에 160개까지 부푼다.
- 창 밖 후보는 `scrollIntoView` 뒤에 누른다. 안 하면 hit test가 아무것도 못 집어 결함처럼 읽힌다.
- 보드 전환·하이드레이션은 비동기라 **멎을 때까지 기다린 지문**으로 비교해야 한다. 고정
  250ms로는 앞 클릭의 결과가 다음 후보의 창에서 도착해 엉뚱한 잎이 「눌린다」로 잡혔다.

## 5. 남은 것

> **이어받는 사람은 [card-buttons/GROK_PROMPT.md](./card-buttons/GROK_PROMPT.md)를 열어 블록을
> 통째로 복사해 붙여넣는다.** 아래 §5-1~§5-3이 남고 §5-4·§5-5는 끝났다. 추출·이식·원장 도구는
> [card-buttons/tools/](./card-buttons/tools/)에 있다(새로 만들지 말 것).

### 5-1. 비교 바구니 (Paper 보드 신설 완료, 구현 미착수)

`49Y4-0` · 「CC-06 / R04-S11 · 종목찾기 — 비교 바구니」(페이지 `5-1`, worldX 41800 ·
worldY 7343). S2(당일 거래량)를 복제해 작업 영역만 갈았다: 왼쪽은 지표가 행, 담은 종목이
열인 비교 표(현재가·등락률·거래량·거래대금·체결강도·PER·PBR·시가총액), 오른쪽은 바구니
목록(빼기 칩)·추천 담기·「전부 비우기」/「추이 같이 보기」.

구현이 붙으려면 **둘**이 필요하다.
1. 추출·저작: `paper.jsx`/`paper.tree.txt`/`meta.json`/`regions.json` → `paper_board_extract` →
   `build_board_registry`. `state.parent_board`를 어디로 둘지가 판단 지점이다(행 액션은
   레일 칩이 아니라 줄마다 있으므로 `state.control_node`가 필요하다).
2. 다중 종목 하이드레이션: 지금 `boardHydrateTarget`은 `stk_cd` **하나**만 싣는다. 바구니는
   3~4종목을 한 보드에 채워야 하므로 백엔드 계약이 늘어난다. 담은 목록을 들고 있을 자리
   (클라이언트 바구니 상태)도 아직 없다.

### 5-2. 조회 조작 (Paper 보드 5장 신설 + 추출·배선 완료)

정렬 8종·「시간외 단일가」는 이미 상태 보드가 있어 눌린다(2X5N-0 실측). 안 눌린 것은
**Paper에 그 상태의 보드가 없던** 필터·페이지 조작이고, 2026-09-08에 다섯 장을 신설했다
(페이지 `5-1`, CC-06 R04 줄 worldY 7343, S2를 복제해 필터 줄만 갈았다).

| 보드 | 이름 | 문구(control) | worldX |
|---|---|---|---|
| `4A9H-1` | R04-S12 · 종목찾기 — 시장 고르기 | `KOSPI` | 43700 |
| `4AGN-1` | R04-S13 · 종목찾기 — 등락 고르기 | `등락 전체` | 45600 |
| `4ANS-1` | R04-S14 · 종목찾기 — 시가총액 고르기 | `시가총액 전체` | 47500 |
| `4AUX-1` | R04-S15 · 종목찾기 — 유동성 고르기 | `유동성 정상` | 49400 |
| `4B22-1` | R04-S16 · 종목찾기 — 전체 100개 펼침 | `더보기` | 51300 |

문법: 누른 칩은 테두리를 `--color-k-text`로 바꾸고 배경을 `--color-k-panel3`으로 채워
「열림」을 말한다. 드롭다운은 그 칩 **바로 아래**에 absolute로 앉고(칩 left − 8px,
필터 줄 아래 8px), 줄마다 값 + 오른쪽에 짧은 근거(선택됨 · 종목 수 · 빠진 수)를 둔다.
S16은 표가 7행으로 늘고 세션별 거래 블록이 빠지며 꼬리가 「전체 100개 표시 · 아래로
계속」 + 「접기」로 바뀐다 — 9행까지 넣으면 꼬리가 612px 판을 뚫는다(실측).

`정렬`·`필터`·`세션`은 줄 이름(읽는 것)이고 조작이 아니다 — 보드를 만들지 않았다.

**추출·배선(2026-09-08 완료).** 실측으로 배운 것 다섯:

1. **원문은 표면 노드에서 뽑는다.** 템플릿 `paper.jsx`/`paper.tree.txt`는 아트보드가 아니라
   카드 표면(`Explorer Card Surface`)에서 나온 것이고 `regions.json`의 `root`가 그 노드다.
   원장 `<board>.tree.txt`는 **아트보드**에서 뽑는다(정적 게이트 S4가 원장에서 표면
   서브트리를 잘라 템플릿과 대조한다).
2. **원문을 세션 컨텍스트로 옮겨 적지 마라.** Paper MCP를 로컬 HTTP(`127.0.0.1:29979/mcp`)로
   직접 불러 파일로 떨궜다(메모 `paper-mcp-direct-http`). 57KB JSX를 손으로 옮기면 한 글자
   틀려도 S4가 트리 드리프트로 잡는다.
3. **`kind: "expand"`는 `state.control_text`를 함께 적어야 한다.** 추출기는 펼침 컨트롤을
   ▸ 잎에서만 찾다가(`mark_state_controls`) 「후보 없음」으로 떨어진다. 문구를 손으로 못 박으면
   그 칩 잎을 문으로 삼는다(`how: hand`).
4. **저작 바인딩은 노드 id로 이어진다.** 복제 보드는 id가 새로 생기므로 도너(2X5N-0)의
   `mapping_id`·`f`·`kor`·`format`·`kind`·`static`·`display_dup`을 (node_path, 문구)로 맞춰
   옮겨 적었다. 늘린 표 행(06·07)은 같은 칸 자리의 저작을 그대로 받고 `display_dup`을 켠다 —
   안 켜면 검사기가 「같은 f가 여러 칸」으로 센다. 병기 짝(`paired_with`)은 **같은 행 안**을
   가리켜야 한다(문구로 옮기면 다른 행을 가리킨다).
5. **드롭다운 줄의 오른쪽 문구는 `kind: "label"`이다.** 자동 판정이 value로 보면 바인딩 없는
   값 슬롯이 되어 런타임에 「미제공」이 뜬다. 숫자를 지어내는 대신 설명 문구로 바꿨다
   (「코스닥 전체」·「오른 종목만」·「관리·경고 종목 제외」).

**함께 넓힌 것 — 칩 찾기의 자리.** 능력 내비(업종·관심·테마·시장·VI·조건검색)는 카드 머리에,
「더보기」는 표 꼬리에 있다. 스트립만 뒤지던 `findStateControlNode`가 그 문들을 자식 보드에서
전부 놓쳤다(실측 4A9H-1: 링크 19개 중 6개). 이제 좁은 자리 → 머리·꼬리 → 표면 전체로 세 단을
훑고, 넓은 단에서는 **그 문구가 보드에 하나뿐일 때만** 매단다(「등락률」처럼 정렬 칩과 표 열
이름이 같은 자리는 앞 단에서 이미 잡힌다). 별칭도 같은 순서로 넓힌다.

**증거.** `verify:paper-cards-static` 101/101 · `verify:paper-cards-mount` 5/5(4폭) ·
`paper-manifest-check` card_template=101 · `validate_board_slots` 경고 0 · app 단위 3,524건 ·
`verify:card-buttons`로 13K0-2에서 다섯 문구가 각자 보드로 갈아탐(`KOSPI→4A9H-1` …), 새 보드
4A9H-1에서 레일 17문구 반응, 「관심」은 직접 클릭으로 `4A9H-1 → 2U5L-1` 확인.

**모집단 수가 96 → 101로 늘었다.** `TOTAL_BOARDS`(paper-manifest-check.mjs)와 그 수를 박아 둔
단위 테스트 셋(`paper-cards-static.test.js`·`paper-manifest-check.test.js`)을 같이 고쳤다.
상태 링크 대상도 83 → 88이다.

**프로브 주의.** 이 계열 전수 실행은 부하에 민감하다 — 좀비 electron이 남아 있으면 보드마다
`paint ack wall-clock timeout`이 난다. 실행 전 `taskkill /F /IM electron.exe`로 정리할 것.
같은 이유로 `verify:card-buttons`가 「관심」·「테마」를 inert로 잴 때가 있으나(측정 흔들림),
실앱에서는 `data-state-board`가 찍히고 클릭이 보드를 갈아탄다.

### 5-3. 주문 조작

`주문 확인`·`정정 확인`·`취소 확인`·`수정`(CC-02). 「정정」·「취소」는 이미 상태 보드로
눌린다. 남은 「주문 확인」은 **실제 주문 집행**(`athena:order-execute`)이라 사람의 명시
승인 없이 배선하지 않았다 — 배선 전에 사용자 확정이 필요하다. 물을 것 둘: ① 확인 버튼이
곧 집행인가 확인 화면까지인가 ② 모의/실계좌 구분을 어디서 막는가.

### 5-4. 2RJ7-1 「호가 열기」 겹침 — 해결 (레이아웃, z-index 없음)

원인은 Paper 원문 자리였다. `2RJF-1` Chart Context Actions는
`position:absolute; bottom:18px; height:44px`이고, 부모 레일 `2RJE-1`의
`padding-block`은 22px뿐이라 흐름 안 `3A46-0`(「예상 체결 시간」)이 그 40px
띠를 차지했다. `markInsetAbsoluteBox`가 부모 `padding-bottom`을
`bottom+height`(62px)로 비운다. 레일은 `align-items:start`라 두 열은 내용
높이(420·401)로 서서 474px 내용 상자 안에 남는다.

프로브 `ATHENA_VERIFY_BOARD_IDS=2RJ7-1` (2026-09-08, HEAD 작업본):
`호가 열기` 잎 `2RJH-1` hit_node=`2RJH-1`, `responds`, 카드 `13BC-2`를 연다.
보드 합계 `responds=8 · hit_blocked=0 · inert=39`. **z-index는 쓰지 않았다.**

### 5-5. 전수 감사 수치 갱신 — 해결

2026-09-08 전수 101장 · 1,648s. 수치와 `2Z49-0` 한 건은 §4. 그 한 건은 wrap-row를
L부터 켜서 샤드로 닫았다. 전수 초록을 다시 찍으려면 같은 명령으로 한 번 더 돈다.
