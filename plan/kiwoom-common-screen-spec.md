# 키움 공통화면 화면기획서

기준일: 2026-08-16 · 대상 브랜치: `main`

이 문서는 키움 REST 301개 라우팅 매핑 전체를 렌더링하는 공통화면 카드 체계의 설계 계약이다.
[`plan/kiwoom-optimal-screen-selection-rendering-plan.md`](kiwoom-optimal-screen-selection-rendering-plan.md) G002~G006이 구현할 대상이고, [`plan/kiwoom-common-screen-brief.md`](kiwoom-common-screen-brief.md)의 제품 요구사항을 만족해야 한다. [`plan/kiwoom-common-screen-handoff.md`](kiwoom-common-screen-handoff.md)는 현재 구현 상태(G001만 완료)의 인수인계다.

권위 원본: [`backend/ref/kiwoom-common-screen-manifest.json`](../backend/ref/kiwoom-common-screen-manifest.json)(G001, 검증됨). 이 문서의 모든 수치는 거기서 실측했다. 새 수치를 쓸 경우 출처를 명시한다.

---

## 1. 요약

키움 301개 라우팅 매핑 전체는 카드 6종으로 나머지 없이 덮인다. manifest가 이미 301개 매핑 전부에 `presentation.layout`을 부여했고, 여섯 레이아웃이 정확히 분할되며 각각 `classification.category` 하나에만 대응한다. 그래서 이 커버리지는 주장이 아니라 manifest 검증으로 증명된다.

| 카드 | layout | category | 매핑 수 | 근거 |
|---|---|---|---:|---|
| FactsCard | `facts` | `read_display` | 114 | 스칼라 응답 |
| TableCard | `table` | `read_display` | 121 | 리스트 1개 |
| CompoundCard | `compound` | `read_display` | 29 | 스칼라 + 리스트 1개 |
| EventCard | `event` | `websocket` | 23 | 구독 · 실시간 틱 |
| ActionCard | `action` | `order` | 12 | 보호된 주문 |
| StatusCard | `status` | `oauth` | 2 | 자격 상태 |
| **합계** | | | **301** | |

264(114+121+29)가 read/display, 23+12+2=37이 guarded workflow다. `plan/kiwoom-common-screen-handoff.md` §2의 301=264+23+12+2 불변식과 일치한다.

---

## 2. 권위 원본과 검증 방법

원본 파일:

- [`backend/ref/kiwoom-common-screen-manifest.json`](../backend/ref/kiwoom-common-screen-manifest.json) — 301개 mapping + 22개 exclusion 원장
- [`backend/scripts/generate_api.py`](../backend/scripts/generate_api.py) — manifest를 결정적으로 생성/검증하는 생성기

검증 명령:

```bash
cd backend && .venv/Scripts/python scripts/render_screen_injection_map.py --check
cd backend && .venv/Scripts/python scripts/render_screen_card_facts.py --check
cd backend && .venv/Scripts/python -m pytest tests/test_screen_injection_map.py tests/test_screen_card_facts.py tests/test_common_screen_manifest.py -q
```

이 게이트들이 보장하는 것:

- 301개 매핑 전수가 [`plan/kiwoom-common-screen-injection-map.md`](kiwoom-common-screen-injection-map.md)(생성 문서, 직접 수정 금지)에 나타난다.
- layout과 category가 함수 관계다 — 매핑 하나가 두 카드에 걸치거나 어느 카드에도 속하지 않는 경우가 없다.
- 부록(injection map)이 manifest와 항상 동기화된다(`--check`가 drift를 검출).
- **Paper 아트보드가 인쇄하는 수치가 manifest에서 재계산된다.** 카드별 매핑 수 · 도메인 분포 ·
  형상 분포(min/중앙/p90/max) · 대표 매핑(mapping ID · route · operation ID · alias)이 전부
  [`backend/ref/kiwoom-common-screen-card-facts.json`](../backend/ref/kiwoom-common-screen-card-facts.json)
  (생성물, `backend/scripts/render_screen_card_facts.py`)에서 나온다. 손으로 타이핑한 숫자가 설계
  파일에 들어가면 검증할 방법이 없기 때문에 생긴 파일이다.
- 대표 매핑은 큐레이션이 아니라 **구동 차원 기준 최대·중앙·최소** 세 점이다(동점은 mapping ID로
  결정적 처리). 유리한 예시만 고르는 것을 구조로 막는다.
- StatusCard 계열 필드에 `token`/`secret`/`appkey` 문자열이 0건이다 — 생성 파일이 커밋되고 설계
  도구로 흘러가므로 문서 결함이 아니라 누출 경로가 된다.
- 22개 제외 split-original(`ka10001`, `ka10002`, `ka10004`, `ka10007`, `ka10040`, `ka10087`, `ka20001`, `ka20009`, `ka30012`, `kt00001`, `kt00004`, `kt00005`, `kt00009`, `kt00010`, `kt00011`, `kt00012`, `kt00013`, `kt00016`, `kt00017`, `kt00018`, `kt50020`, `kt50032`)가 화면 대상에서 계속 빠져 있는다.

이 문서 자체는 카드의 목적·치수·상태·안전 제약을 설명하는 상위 계층이며, 어떤 API가 어떤 카드로 가는지의 전수 표는 injection map이 원본이다. 두 문서가 다르면 injection map이 이긴다.

---

## 3. 카드 6종

### 3.1 FactsCard

- **목적**: 스칼라 값 중심 응답을 key/value로 표시한다.
- **대상 매핑 수**: 114
- **실측 치수**: 응답 top-level 필드 1~20, 중앙값 6, p90 15. 최대는 `detail:ka10007:bid_prices`. 리스트 컨테이너 0개. 요청 필드 0~8, 중앙값 1.
- **구조(영역 분해)**: key/value grid 1개 영역. 컨테이너가 없으므로 페이지네이션이 없다.
- **상태**: `loading`, `empty`, `error`, `unavailable`, `auth_required`. `stale`은 연속조회가 없어 해당 없음. `permission_denied`는 order scope 전용이라 해당 없음.
- **안전 제약**: 읽기 전용. side effect 없음.
- **주입되는 API**: [`plan/kiwoom-common-screen-injection-map.md`](kiwoom-common-screen-injection-map.md) `Facts` 절. 도메인 7종 — account 50 · quotes 29 · stockinfo 12 · elw 10 · sector 9 · ranking 3 · etf 1. 대표 3개(응답 필드 수 최대·중앙·최소) — `detail:ka10040:sell_brokers`(20), `detail:kt00016:performance_summary`(6), `base:ka00001`(1). 아트보드 `27`.

  > 이전 판은 여기에 `base:ka10085`와 `detail:kt00018:holdings`를 FactsCard 예로 적었는데, 둘 다
  > injection map의 `Table` 절에 있는 table 레이아웃이다. 대표 예를 손으로 고른 결과였고, 그래서
  > 지금은 생성기가 뽑는다(§2).

### 3.2 TableCard

- **목적**: 컨테이너 1개짜리 리스트 응답을 표로 표시한다.
- **대상 매핑 수**: 121
- **실측 치수**: 응답 top-level은 **항상 1**(`{data:[...]}`) — 구조가 전부 컨테이너 안에 있다. 컨테이너 정확히 1개. 컬럼 3~63, 중앙값 12, p90 22. 최대는 `base:ka10095`의 `atn_stk_infr` 63컬럼. 요청 필드 0~13, 중앙값 3, p90 8 → 필터 입력 영역이 최대 13개 필요.
- **구조(영역 분해)**: 필터/입력 영역(최대 13개 control) + sticky header 표 1개 + 연속조회 영역.
- **상태**: `loading`, `empty`, `error`, `unavailable`, `auth_required`, `stale`(연속조회 잔여). `permission_denied` 해당 없음.
- **안전 제약**: 읽기 전용.
- **주입되는 API**: injection map `Table` 절. 도메인 12종 — stockinfo 25 · ranking 22 · account 19 · quotes 19 · charts 9 · elw 9 · etf 5 · sector 5 · investor 3 · lending 3 · shortsale 1 · theme 1. 대표 3개(컬럼 수 최대·중앙·최소) — `base:ka10095`(63), `base:ka10029`(12), `base:ka10042`(3). 요청 필드 최대는 `base:ka10054`(13). 아트보드 `28`.

### 3.3 CompoundCard

- **목적**: facts 헤더와 표 하나를 함께 보여준다. 이름과 달리 **다중 표가 아니다.**
- **대상 매핑 수**: 29
- **실측 치수**: 컨테이너가 **항상 정확히 1개**. facts 헤더 2~9 필드 + 표 2~15 컬럼. 29개 전체가 이 형태.
- **구조(영역 분해)**: 상단 facts 헤더 1개 + 하단 표 1개. 헤더가 표의 컨텍스트(종목/계좌/기준일)를 담는다.
- **상태**: `loading`, `empty`, `error`, `unavailable`, `auth_required`, `stale`.
- **안전 제약**: 읽기 전용.
- **주입되는 API**: injection map `Compound` 절. 도메인 10종 — charts 12 · account 5 · etf 3 · stockinfo 2 · watchlist 2 · elw 1 · lending 1 · quotes 1 · ranking 1 · theme 1. 대표 3개(컬럼 수 최대·중앙·최소) — `base:kt00008`(15), `base:ka10080`(8), `base:ka01300`(2). charts가 최다인 이유는 봉차트 계열이 정확히 이 형상(종목코드 헤더 + 봉 배열)이기 때문이다. 아트보드 `29`.

### 3.4 EventCard

- **목적**: WebSocket 구독의 실시간 틱 스트림을 표시한다.
- **대상 매핑 수**: 23
- **실측 치수**: 요청 top-level 1~6, 23개 중 19개가 중첩 `data` 컨테이너(구독 페이로드)를 쓴다 — 요청에 중첩 컨테이너를 쓰는 유일한 레이아웃. 응답 top-level 3~4는 **ack 봉투**(`return_code`/`return_msg`/`trnm`/`data`)이고 화면이 그리는 실제 FID는 컨테이너 안에 있다. FID 수 0~167, 중앙값 약 16, 최대는 `base:0D` 호가잔량 167개.
- **구조(영역 분해)**: 구독 상태 배지 + append-only 이벤트 로그(bounded) + FID 필드 표시 영역(0~167개, 밀도가 매핑마다 크게 다르므로 접이식/스크롤 설계 필요).
- **상태**: 7종 공통 상태에 더해 `connecting`/`open`/`reconnecting`/`dropped`/`stopped` lifecycle이 `status` 영역에 얹힌다(§5, §6 참조). `empty`는 "아직 이벤트 없음", `stale`은 event 레이아웃에서는 원칙적으로 발생하지 않는다(연속조회가 아니라 구독이므로) — 발생 시 lifecycle 이상으로 취급한다.
- **안전 제약**: 명시적 start/stop. 이벤트는 스트림 엔드포인트로만 온다(§6).
- **주입되는 API**: injection map `Event` 절. 도메인은 websocket 하나뿐이고 23개 채널 전수가 아트보드 `30`에 나열돼 있다. 대표 3개(FID 수 최대·중앙·최소) — `base:0D`(167), `base:0m`(14), `base:ka10174`(0).
- **변형 후보**: `ka10173`/`ka10174`는 이 패턴에서 벗어난다(§11 미해결 3).

### 3.5 ActionCard

- **목적**: 주문 draft/review/confirm/receipt를 표시한다. 표 없음.
- **대상 매핑 수**: 12
- **실측 치수**: 요청 3~8, 응답 1~4(주문번호·상태 ack).
- **구조(영역 분해)**: draft 입력 영역 → review 요약 → confirm 버튼(브랜드 마젠타 지점) → receipt(불변 기록).
- **상태**: `loading`, `error`, `unavailable`, `auth_required`, `permission_denied`(order scope), `action_required`(draft/review/confirm 단계). `empty`/`stale` 해당 없음.
- **안전 제약**: §6.2 참조. `autoExecute=false`, one-shot action token, live order 금지.
- **주입되는 API**: injection map `Action` 절. 12개뿐이라 전수 나열이 가능하다 — `kt10000`~`kt10003`(주식 매수·매도·정정·취소), `kt10006`~`kt10009`(신용), `kt50000`~`kt50003`(금현물). 대표 3개(요청 필드 수 최대·중앙·최소) — `base:kt10007`(8), `base:kt10000`(6), `base:kt50003`(3). 아트보드 `31`.

### 3.6 StatusCard

- **목적**: OAuth 자격 상태를 표시한다.
- **대상 매핑 수**: 2
- **실측 치수**: 요청 필드 0, 응답 3.
- **구조(영역 분해)**: 단일 상태 배지 영역. 요청 필드가 0이므로 입력 영역 자체가 없을 가능성이 높다(§11 미해결 4 — 결정 아님).
- **상태**: `loading`, `error`, `unavailable`, `auth_required`. §6.3의 `authorizing`/`ready`/`expired` lifecycle이 `status` 영역에 얹힌다.
- **안전 제약**: credential 입력값·token value를 renderer에 노출하지 않는다.
- **주입되는 API**: injection map `Status` 절. 전수 2개 — `base:au10001`(접근토큰 발급, `POST /api/v1/internal/oauth/au10001`), `base:au10002`(접근토큰폐기, `POST /api/v1/internal/oauth/au10002`). 응답 3필드는 두 매핑 모두 `configured` / `ready` / `expires_at`이고 **토큰 값이 없다**. 라우트 접두사가 `/api/v1/internal/`이라 다른 다섯 카드와 다르다. 아트보드 `32`.

---

## 4. 셀 프리미티브 5종

operation마다 renderer를 만들지 않는다. manifest의 20개 최다빈도 응답 alias는 다섯 계열로 수렴한다.

빈도(응답 alias, 상위 10개): `cur_prc` 89, `pred_pre` 85, `stk_cd` 83, `stk_nm` 80, `trde_qty` 63, `flu_rt` 60, `pred_pre_sig` 49, `dt` 41, `high_pric`/`low_pric` 33, `open_pric` 32.

| 셀 | 필드 | 비고 |
|---|---|---|
| 가격 | `cur_prc`, `high_pric`, `low_pric`, `open_pric` | `tabular-nums` 필수(§8) |
| 등락 | `pred_pre`, `pred_pre_sig`, `flu_rt` | 상승/하락 의미색(§8) |
| 수량 | `trde_qty`, `acc_trde_qty` | |
| 종목 | `stk_cd`, `stk_nm` | |
| 일시 | `dt` | |

이 다섯 셀이 상위 10개 alias 전부를 덮는다. 카드 6종은 이 다섯 셀을 조합해 만들고, 필드별 개별 렌더러를 새로 만들지 않는다.

---

## 5. 상태 7종

공통 상태 7종을 모든 카드가 동일한 이름으로 갖는다. 카드별로 다른 이름을 쓰지 않는다 — [`plan/kiwoom-common-screen-brief.md`](kiwoom-common-screen-brief.md)가 구현과 문서의 state 명칭 일치를 완료 기준으로 못박았다.

| 상태 | 발생 조건 | 표시 규칙 |
|---|---|---|
| `loading` | 실행 또는 구독 시작 중 | skeleton/progress, 중복 실행 방지 |
| `empty` | 정상 응답이나 표시 데이터 없음 | 빈 상태 설명 + 안전한 재시도 |
| `error` | 실행/정규화 실패 중 복구 가능한 경우 | 복구 가능 메시지, 민감정보 없는 진단 ID |
| `unavailable` | 503 또는 화면 미준비/미지원 screenId | 대체 경로 또는 설명 |
| `auth_required` | 인증/권한 필요(401/403 포함) | credential 값 노출 없이 인증 상태 안내 |
| `permission_denied` | order scope 등 권한 범위 밖 | 어떤 권한이 부족한지 설명, 재시도로 안 풀림을 명시 |
| `stale` | 연속조회 잔여(더 볼 데이터 있음) | "더 보기" 또는 자동 이어받기 표시 |

각 카드가 실제로 도달 가능한 상태 부분집합은 §3의 카드별 절에 명시했다. `stale`에 도달하지 않는 것은
**FactsCard**(컨테이너 0개라 연속조회 대상이 아니다), **ActionCard**(표가 없다), **StatusCard**,
그리고 **EventCard**(구독이라 연속조회가 아니다 — 발생하면 lifecycle 이상으로 취급한다)다.
CompoundCard는 컨테이너가 항상 정확히 1개이므로 TableCard와 마찬가지로 `stale`에 도달한다.

> 이전 판의 이 문단은 CompoundCard도 `stale`에 도달하지 않는다고 적어 §3.3과 충돌했다. 실측
> (컨테이너 항상 1개)에 따라 §3.3 쪽으로 정정했다. 경위는 §11 미해결 8.

전수 행렬은 아트보드 `33 · AT-CV-005 상태 7종`에 있다.

---

## 6. 보호 워크플로

### 6.1 WebSocket 23개

- 명시적 `start`/`stop`이 있어야 한다.
- lifecycle: `connecting`, `open`, `reconnecting`, `dropped`, `stopped`, `error`.
- 이벤트는 스트림 엔드포인트로만 온다. renderer가 REST를 직접 폴링해 이벤트를 흉내내지 않는다.
- protocol 상수는 user control이 아니라 injected constant다.
- 화면에서는 EventCard의 상태 배지가 lifecycle을 보여주고, 이벤트 로그는 append/bounded로 유지한다(무제한 누적 금지).

### 6.2 Order 12개

주문은 다음 상태 머신을 벗어나지 않는다.

```text
draft → review → explicit confirm → committed → receipt
```

- 화면 open/refresh/retry는 주문을 실행하지 않는다.
- `autoExecute=false`.
- action token은 one-shot, short-lived, screen/account/input-bound다.
- 로컬 bearer, 확인 헤더, idempotency 검증은 backend/main 경계에서 수행하고 renderer에 노출하지 않는다.
- 테스트·검증에서 live order는 0건이어야 한다.
- 화면에서는 ActionCard의 draft/review/confirm 세 단계가 시각적으로 구분되어야 하고, confirm 버튼만 브랜드 마젠타(§8)를 쓴다 — 화면당 정확히 한 곳이라는 제약과 "confirm이 유일한 현재 입력 지점"이라는 워크플로 요구가 여기서 일치한다.

### 6.3 OAuth 2개

- credential 입력값과 token value를 renderer document에 넣지 않는다.
- renderer에는 `auth_required`, `authorizing`, `ready`, `expired`, `error` 상태만 보낸다.
- token refresh와 저장은 backend/main이 소유한다.
- 인증 실패를 빈 데이터(`empty`)로 표현하지 않는다 — 반드시 `auth_required`/`error`로 구분한다.

세 워크플로 모두 안전 경계가 화면에 보이는 방식은 같다: **renderer는 transport/token/credential을 모르고, 상태 이름과 명시적 사용자 행동(confirm, start, stop)만 안다.**

---

## 7. API 주입 매핑

전수 표는 [`plan/kiwoom-common-screen-injection-map.md`](kiwoom-common-screen-injection-map.md)에 있다(생성 문서, `backend/scripts/render_screen_injection_map.py`가 manifest에서 생성). 이 문서는 요약표만 인라인한다.

| Card | Layout | Category | Mappings | 비중 |
| --- | --- | --- | ---: | ---: |
| Table | `table` | `read_display` | 121 | 40.2% |
| Facts | `facts` | `read_display` | 114 | 37.9% |
| Compound | `compound` | `read_display` | 29 | 9.6% |
| Event | `event` | `websocket` | 23 | 7.6% |
| Action | `action` | `order` | 12 | 4.0% |
| Status | `status` | `oauth` | 2 | 0.7% |

injection map은 도메인별(`account`, `charts`, `elw`, `etf` 등) 절로 나뉘어 있고, 각 행이 Mapping ID/TR/Name/Route/Operation ID/Req fields/Resp fields/Resp containers/Resp columns를 갖는다. 이 문서와 injection map이 어긋나면 injection map을 재생성(`--check`)해 동기화한다.

---

## 8. 시각 계약

토큰·규칙 출처: [`ui/palette.md`](../ui/palette.md), [`ui/DESIGN-SOUL.md`](../ui/DESIGN-SOUL.md), [`ui/liquid-glass.md`](../ui/liquid-glass.md), [`ui/effects.md`](../ui/effects.md).

- **토큰 43개만 쓴다.** 표면 `--color-k-bg`/`--color-k-panel`/`--color-k-panel2`/`--color-k-panel3`, 선 `--color-k-line`/`--color-k-line-soft`, 글자 `--color-k-text`/`--color-k-dim`/`--color-k-faint`.
- **가격 의미색**: 상승 `--color-up #ff5c5c`(6.4:1), 하락 `--color-down #4d9fff`(6.9:1), 보합 `--color-flat`. 국내 관례다. `ui/palette.md`가 실측 대비를 확인했으므로 임의 조정 금지.
- **오류는 `--color-warn` `#ff9838`(주황)이다.** `--color-bad`는 `--color-up`과 값이 같아(`#ff5c5c`) 충돌하므로 쓰지 않는다 — 오류를 빨강으로 칠하면 "상승"과 같은 색이 되어 오독을 만든다는 것이 `ui/palette.md`가 명시한 결정이다. `--color-info`도 `--color-down`과 같은 값(`#4d9fff`)이라 마찬가지로 피한다.
- **브랜드 마젠타 `--color-brand #ee137b`는 화면당 정확히 한 곳**, 현재 입력 지점(예: ActionCard의 confirm)에만 쓴다. 유리 상태(유휴/포커스) 표현은 색이 아니라 빛(굴절 강도·광량)으로 한다.
- **숫자는 `tabular-nums` 필수.** 정렬이 생명인 숫자(호가 사다리, 랭킹 테이블, 타임스탬프, TR 코드)는 `Geist Mono`를 쓴다 — 다키체(Daki) 3개 패밀리는 tabular figures 지원이 미검증이라 그 전까지는 등폭 사용처를 줄이지 않는다.
- **간격**: 8pt 스케일 `4/8/12/16/24`. **radius**: `2/4/6/999`(유리 창만 예외로 `18~21`).
- **셰이더는 데이터 위에 절대 올리지 않는다.** `ui/effects.md`: "차트/숫자 위에 셰이더를 얹지 않는다 — 셰이더는 데이터가 없는 곳에서만 산다(배경, 테두리, 로딩, 온보딩)." 6카드 어느 것도 배경/테두리/로딩이 아닌 데이터 표시 영역에 셰이더를 두지 않는다.
- **렌더링은 `textContent`/DOM 노드만.** 문자열 삽입(`innerHTML`) 금지 — `app/canvas.js` 등 기존 renderer가 이미 지키는 관례를 카드에도 그대로 적용한다.

---

## 9. canvas-taxonomy.md와의 관계

[`plan/canvas-taxonomy.md`](canvas-taxonomy.md)는 **데이터 형상** 기준 12캔버스(시계열·랭킹·호가사다리·히트맵 등)를 제안하고 커버율을 70~75% [추정]으로 적었다. 그 문서는 스스로 "(초안)"이고 "구현 스펙이 아니다"라고 밝혔으며, 총계를 220개 [추정]으로 잡아 실제 208 base / 301 routable과 맞지 않는다.

두 체계는 경쟁 관계가 아니라 층위가 다르다.

- 이 기획서의 6카드 = **완전성 계층**. 301/301을 덮고 기계적으로(§2 검증 명령) 검증된다.
- 12캔버스 = **표현 계층**. 호가 사다리를 일반 표로 그리면 정보가 죽는다는 canvas-taxonomy.md의 판단은 여전히 옳다. 예를 들어 EventCard가 덮는 `base:0D`(호가잔량, 167 FID)를 그냥 이벤트 로그로만 보여주면 캔버스 4(호가창)가 주는 양방향 막대 정보를 잃는다.
- 따라서 12캔버스는 6카드 위에 **선택적으로 얹는 전문 표현**이다. 6카드가 먼저 전수 커버리지를 보장하고, 특정 카드가 특정 매핑에 대해 자주 열리거나 정보 손실이 크다고 판단되면 그 자리에 12캔버스 중 해당 형상을 렌더러로 얹는다.

12캔버스를 확정된 것으로 취급하지 않는다. canvas-taxonomy.md 자체가 미해결로 남긴 "캔버스 3개가 한 창에 동시에 있을 때의 배치 규칙"(§11 미해결 7)도 이 문서에서 풀지 않는다.

---

## 10. Paper 아트보드 사양

Paper 파일: `Athena — 화면설계서` (<https://app.paper.design/file/01M002A3JJ5SNHH8Z5AVB9KSQQ/1-0>).

이 문서의 이전 판은 아트보드 `12`~`15`를 대상으로 적었다. 그 골격은 파일이 다시 번호를 매기면서
사라졌다(현재 12~15는 `AT-CH-001 답변 3상태` · `AT-ST-001~003`이다). 이 문서의 대상 장표는
아래 10장(25~34)이다.

**2026-08-17 재정렬 실측.** 이전 판이 적은 *"`23 · End of Document`는 `35`로 옮겼다"*는
기록만 있고 파일에는 반영돼 있지 않았다 — 실측에서 24~27번 장표가 옛 부록·End와 **같은
좌표에 겹쳐** 있었다(충돌 4쌍). 이번에 실제로 재정렬했다: 부록 A1·A2·B1·B2 → `36~39`,
End of Document → `40`. 신규 장표 2장이 들어왔다 — `23 · AT-CH-004 설정 모드`(구현 실측),
`35 · AT-CV-001 캔버스 창 기본`(현행 카드 6슬롯 실측). 둘 다 이 기획서(공통 API 카드)의
범위 밖이고, **25~34 번호와 이 문서의 참조는 바뀌지 않았다.**

| 아트보드 | 레지스터 | 들어간 내용 |
|---|---|---|
| `25 · 공통 API 화면 원칙` | 문서(흰 페이지) | 301/301 커버리지 배너, 카드 6종 요약표(§1)와 카드별 실측 형상, layout→category 함수 관계 6행, 셀 프리미티브 5종(§4)을 alias 빈도 막대로 증명 |
| `26 · API 주입 원장 · 도메인 × 카드` | 문서 | 도메인 16종 × 카드 6종 행렬(행·열·총합이 모두 301로 닫힌다), §2 검증 명령과 게이트 4종, 제외된 22개 split original |
| `27 · AT-CV-005 FactsCard` | 목업(다크) | `detail:kt00016:performance_summary` 목업 + 주입 API 114개(도메인 분포 7종 + 대표 3개) |
| `28 · AT-CV-005 TableCard` | 목업 | `base:ka10029` 12컬럼 표 목업 + 주입 API 121개(도메인 12종) + 연속조회 영역(미구현 표시) |
| `29 · AT-CV-005 CompoundCard` | 목업 | `base:kt00008` facts 헤더 + 표 목업 + 주입 API 29개(도메인 10종) |
| `30 · AT-CV-005 EventCard` | 목업 | `base:0D` 목업(ack 봉투 · FID 167 중 8개 · bounded 로그) + 구독 채널 23개 전수 |
| `31 · AT-CV-005 ActionCard` | 목업 | draft→review→confirm→receipt 4단 + 주문 12개 전수 + 브랜드 마젠타 단일 사용 지점 |
| `32 · AT-CV-005 StatusCard` | 목업 | lifecycle 4상태 + "renderer가 받는 것 / 절대 받지 않는 것" 계약 + oauth 2개 전수 |
| `33 · AT-CV-005 상태 7종` | 목업 | 상태 7종 정의(§5), 카드 6종 × 상태 7종 도달 가능 행렬, 오류=주황 / 상승=빨강 병치 증명 |
| `34 · AT-CV-005 보호 워크플로 3종` | 목업 | WebSocket lifecycle(§6.1) · order 상태 머신(§6.2) · OAuth lifecycle(§6.3) 3열 병치 + 공통 경계 |

두 레지스터의 규범:

- **문서 레지스터** — 흰 배경, `#DCDCDC` 헤더바 h44, 본문 `px 56 / pt 36`, 표 헤더 `#F0F0F0`에
  상단 `1.5px #666`, 행 하단 `1px #DDD`, 합계행 `#F7F7F7`. 우하단 페이지 번호.
- **목업 레지스터** — `1508` Mockup Area + `412` Spec Panel. Spec Panel은 `doc-ink` 타이틀바 h44 →
  Meta 3행(화면 ID / 화면 명 / 위치) → `Description` 번호 목록 → 미해결 블록 → 페이지 번호.
- 카드는 전부 `--font-mono`(Geist Mono) + `tabular-nums`로 숫자를 그린다(§8).

제약: **Paper는 `backdrop-filter`를 렌더하지 않는다.** 유리는 손으로 그렸다 — 실제로 쓴 값은
`linear-gradient(in oklab 45deg, …)` + `#FFFFFF7A 0 1.5px 0 inset` + `#000000A8 0 26px 60px` +
`1px solid #FFFFFF42`이고, 이는 아트보드 `24 · AT-CV-MCP-001`이 이미 쓰던 방식을 그대로 이어받은
것이다. 이 제약은 유리 범위 미해결(§11-1)이 어느 쪽으로 풀리든 적용된다.

`AT-CV-005` 식별자 자체의 출처는 저장소에 없다(§11 미해결 5). 이 문서가 새로 만든 것이 아니라
이전 판의 아트보드 14·15가 쓰던 이름을 이어받았을 뿐이고, 10장 전체가 이 하나의 화면 ID를
공유한다(카드 6종은 상태가 아니라 레이아웃 변형이지만, 아트보드 `06 · 화면 목록 · ID 체계`가
"동일 화면의 다른 상태는 같은 ID를 공유한다"고만 정해 두어 변형에 대한 규칙이 없다).

---

## 11. 미해결

1. **유리의 범위가 문서끼리 모순이다.** [`ui/round-1/ranking.md`](../ui/round-1/ranking.md)는 "유리는 커맨드바 한정, 캔버스는 불투명"으로 끝났고(174행), [`ui/round-1R/ranking.md`](../ui/round-1R/ranking.md)는 전면 유리로 다시 열었다(32~36행, A안 "인터랙티브 창 전체가 하나의 유리 패널"). 어느 쪽도 상대를 폐기한다고 쓰지 않았다. round-1R이 시간상 나중이다. 카드 배경을 유리로 할지 불투명으로 할지는 이 모순이 풀려야 정해진다.
2. **연속조회가 현재 클라이언트에 도달하지 않는다.** `athena_api/generated/runtime.py`의 `apply_continuation_headers()`가 정의만 되어 있고 호출부가 0건이다. 요청 측(`cont-yn`/`next-key` 헤더)은 301개 전 라우트에 균일하게 있다. 응답 측이 연결되기 전에는 TableCard의 `stale`/"더 보기"를 표시할 근거가 없다. 이건 G004의 선결 조건이다.
3. **`ka10173`/`ka10174`가 event 패턴에서 벗어난다.** 나머지 21개는 틱 페이로드인데, `ka10173`은 top-level 15필드에 컨테이너 2개(하나는 비어 있음), `ka10174`는 컨테이너 0개인 순수 제어 응답이다. EventCard 변형이 필요한지 별도 판정이 필요하다.
4. **oauth 요청 필드가 0이다.** StatusCard(§3.6)에 입력 영역이 필요한지 확인이 필요하다.
5. **`AT-CV-005` 식별자의 출처가 저장소 어디에도 없다.** 이전 판의 Paper 아트보드 14·15가 이 이름을 썼는데 정의가 없고 형제 식별자도 없다. 현재는 아트보드 25~34가 이 이름을 일관되게 쓰고 있지만, 그건 사용처가 늘어난 것이지 출처가 생긴 게 아니다. 덧붙여 아트보드 `06 · 화면 목록 · ID 체계`는 `AT-CV-001~004`를 2차 범위(캔버스 창 기본·시계열·호가·관측)로 예약해 두었고 **레이아웃 변형에 대한 ID 규칙이 없다** — 카드 6종이 하나의 ID를 공유하는 현재 방식이 그 체계와 맞는지 판정되지 않았다. (2026-08-17: `AT-CV-001`은 예약된 이름 그대로 캔버스 창 기본 실측 장표(35)에 사용되기 시작했다. `002~004`는 여전히 2차 예약이다.)
6. **loading/empty/error 선례가 코드에 없다.** `app/canvas.js`의 stream/reader/table 세 렌더러 모두 mock을 동기로 읽어 실패 경로를 실행하지 않는다. 이 기획서가 그 패턴을 새로 세우는 것이지 기존 것을 잇는 게 아니다.
7. **캔버스 3개가 한 창에 동시에 있을 때의 배치 규칙이 미정이다**([`plan/canvas-taxonomy.md`](canvas-taxonomy.md) 미해결 항목, 라운드 2 미완).
8. **이 문서가 스스로와 충돌했던 지점 — CompoundCard의 `stale`.** §3.3은 CompoundCard의 상태 목록에 `stale`을 넣었고 §5 말미는 CompoundCard가 `stale`에 도달하지 않는다고 적었다. 실측은 §3.3 쪽이다(29개 전체가 컨테이너 정확히 1개 = 연속조회 대상). §5를 정정하고 아트보드 33의 행렬도 그렇게 그렸다. 다만 §11-2가 풀리기 전에는 어느 카드에서도 `stale`이 실제로 발화하지 않는다 — 지금 이 구분은 UI 계약이지 관측된 동작이 아니다.
9. **§3.1의 "최대는 `detail:ka10007:bid_prices`"는 동점 중 하나다.** 응답 top-level 20개짜리가 여럿 있고, 생성기(`render_screen_card_facts.py`)는 동점을 mapping ID로 결정적으로 깨서 `detail:ka10040:sell_brokers`를 최대로 고른다. 둘 다 20이므로 어느 쪽도 틀리지 않았지만, 아트보드와 이 문서가 서로 다른 이름을 부르는 이유가 여기 있다.
