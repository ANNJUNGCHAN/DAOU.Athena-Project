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

`app/probe-card-buttons.js`가 96장을 실앱 셸에 마운트하고 **진짜 마우스 입력**
(`sendInputEvent`)으로 후보를 하나씩 누른다. 판정 네 갈래: `responds` ·
`hit_blocked`(핸들러는 있는데 그 자리 hit test가 남으로 간다) · `inert`(동작 없음) ·
`offscreen`. 게이트는 **state-control이 전부 반응하는가** 하나만 빨갛게 만든다 —
`pill`·`affordance`는 아직 동작이 없는 것이 많아 세기만 한다.

산출물 `app/captures/paper-gates/CARD-BUTTONS.json`. 샤딩
`ATHENA_VERIFY_BOARD_IDS=137X-2,2X5N-0`, 리포트 경로 `ATHENA_CARD_BUTTONS_REPORT`.

프로브가 배운 것 셋(같은 함정을 다시 밟지 않도록):
- 표 행마다 반복되는 버튼은 라벨당 2개만 누른다 — 전수는 보드 하나에 160개까지 부푼다.
- 창 밖 후보는 `scrollIntoView` 뒤에 누른다. 안 하면 hit test가 아무것도 못 집어 결함처럼 읽힌다.
- 보드 전환·하이드레이션은 비동기라 **멎을 때까지 기다린 지문**으로 비교해야 한다. 고정
  250ms로는 앞 클릭의 결과가 다음 후보의 창에서 도착해 엉뚱한 잎이 「눌린다」로 잡혔다.

## 5. 남은 것

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

### 5-2. 조회 조작 (가장 큰 덩어리)

`정렬`·`필터`·`세션`·`KOSPI`·`등락 전체`·`시가총액 전체`·`유동성 정상`·`시간외 단일가`·
`더보기`. 정렬 8종은 이미 상태 보드로 그려져 있어 눌린다(2X5N-0 실측) — 안 눌리는 것은
**Paper에 그 상태의 보드가 없는** 것들이다. 헌장 §12(상태 전개 관례)대로라면 조작마다
전개 보드를 그려야 하고, 그리기 전에는 구현할 표면이 없다.

### 5-3. 주문 조작

`주문 확인`·`정정 확인`·`취소 확인`·`수정`(CC-02). 「정정」·「취소」는 이미 상태 보드로
눌린다. 남은 「주문 확인」은 **실제 주문 집행**(`athena:order-execute`)이라 사람의 명시
승인 없이 배선하지 않았다 — 배선 전에 사용자 확정이 필요하다.
