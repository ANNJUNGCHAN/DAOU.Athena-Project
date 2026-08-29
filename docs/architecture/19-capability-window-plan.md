# Athena 19개 통합 창 전환 계획서

- 상태: Paper 실제 19개 창 반영 완료 · Runtime 전환 기준안
- 작성 기준: 2026-08-29 KST
- 대상: Kiwoom REST·WebSocket·주문을 사용하는 Athena Selector, Backend, Canvas, Paper UI

## 1. 목표

Athena가 보유한 OAuth 제외 299개 Kiwoom operation을 사용자와 Selector에 그대로 노출하지 않는다.

- 기존 299개 FastAPI route는 Kiwoom 내부 어댑터로 유지한다.
- Selector와 Canvas가 보는 논리 단위를 19개 Capability Window로 축소한다.
- 115개 Detail Projection은 22개 TR family 내부 projection으로 취급한다.
- 실시간 feed가 존재하는 창은 snapshot 성공 직후 서버가 반드시 자동 등록한다.
- 사용자는 실시간 등록 버튼을 누르지 않는다.
- 주문창의 실시간 자동 등록은 주문 자동 실행 권한을 의미하지 않는다.

## 2. 기준 수량

| 구분 | 수량 | 처리 원칙 |
|---|---:|---|
| 비-OAuth operation | 299 | 내부 adapter로 유지 |
| base operation | 184 | 일반 조회 149 + WebSocket control 23 + 주문 12; 내부 resolver가 선택 |
| Detail Projection | 115 | 22개 TR family 안으로 숨김 |
| Selector 노출 Capability | 19 | 사용자 의도 단위 |
| OAuth route | 2 | 이번 통합 대상 제외 |
| WebSocket control operation | 23 | 서버 자동 등록 정책으로 전환 |
| 주문 operation | 12 | draft → confirmation 경계 유지 |

개별 operation 귀속 정본은 `backend/ref/kiwoom-capability-assignment.json`이다. `tr_id`가 아니라 `mapping_id`를 assignment key로 사용해 115개 Detail Projection까지 정확히 한 번씩 배정한다. `backend/tests/unit/test_capability_assignment.py`가 assigned 299, unassigned 0, duplicated 0과 manifest 집합 일치를 고정한다.

### 2.1 Ordered Capability Ledger

계획·API·UI·Paper는 아래 순서와 수량을 공통 계약으로 사용한다.

| # | `capability_id` | 창 | operation |
|---:|---|---|---:|
| 1 | `account` | 계좌 워크스페이스 | 76 |
| 2 | `order` | 통합 주문 티켓 | 12 |
| 3 | `chart` | 통합 차트 | 21 |
| 4 | `orderbook` | 통합 호가 | 31 |
| 5 | `program-trading` | 프로그램매매 | 9 |
| 6 | `etf` | ETF | 10 |
| 7 | `elw` | ELW | 22 |
| 8 | `sector` | 업종 | 16 |
| 9 | `investor-flow` | 투자자·기관 수급 | 16 |
| 10 | `broker` | 거래원 | 16 |
| 11 | `discovery` | 종목발굴·순위 | 10 |
| 12 | `credit-lending-short` | 신용·대차·공매도 | 9 |
| 13 | `stock-info` | 종목정보 | 21 |
| 14 | `watchlist` | 관심종목·목록 | 8 |
| 15 | `quote` | 현재시세·체결 | 9 |
| 16 | `gold` | 금현물 | 5 |
| 17 | `theme` | 테마 | 2 |
| 18 | `market-status` | 시장상태·VI | 2 |
| 19 | `condition-search` | 조건검색 | 4 |
|  | **합계** |  | **299** |

## 3. 핵심 결정

### 3.1 19개 물리 라우터를 복제하지 않는다

19개 창마다 별도 생명주기 코드를 복사하지 않는다. 하나의 공통 `window-instance` API와 19개의 typed Capability 정의를 사용한다.

```text
사용자 질문
  → Selector: 19개 Capability 중 하나 선택
  → Window Instance 생성
  → Capability Resolver: 내부 TR·Detail·feed 결정
  → Snapshot Resolver: 필요한 원본 TR은 한 번만 호출
  → View Model 조립
  → Snapshot 즉시 렌더
  → RealtimeSubscriptionManager가 required feed 자동 등록
  → 같은 window instance에 delta 전달
```

### 3.2 299개 route는 삭제하지 않는다

기존 generated route는 다음 용도로 유지한다.

- Kiwoom transport adapter
- 세부 계약·Pydantic 모델
- 장애 진단과 운영 도구
- 회귀 테스트
- Capability Resolver 내부 호출

Selector와 일반 프론트엔드만 기존 operation ref를 직접 선택하거나 호출하지 못하게 한다.

### 3.3 실시간은 서버 정책이다

실시간 지원 Capability의 `realtime.policy`는 `required`, `shared_required`, `conditional_required` 중 하나다. `conditional_required`는 mode·target·visible-row 같은 결정적 조건이 성립하면 반드시 등록하고, 성립하지 않으면 그 mode만 `not_applicable`로 표시한다. 클라이언트 요청으로 required 계열 정책을 `false`로 바꿀 수 없다.

```text
snapshot 성공
  → desired lease 생성
  → REG 작업 즉시 enqueue
  → HTTP는 snapshot + registering 상태 반환
  → ACK 이후 active 상태 push
```

실시간 operation이 없는 Capability는 억지로 WebSocket을 만들지 않고 `not_applicable`로 선언한다.

### 3.4 주문은 별도 mutation 경계를 유지한다

주문창이 열리면 주문체결 `00`과 잔고 `04`를 자동 등록할 수 있다. 실제 주문은 반드시 다음 경계를 통과한다.

```text
order draft 생성
  → 사용자에게 미리보기 렌더
  → 명시적 confirmation
  → Idempotency-Key 검증
  → 내부 12개 주문 operation 중 하나 실행
  → 결과 불명은 in_doubt로 보존
```

## 4. 목표 구성요소

### Backend

1. `CapabilityRegistry`
   - 19개 `capability_id`
   - snapshot resolver
   - typed window model
   - capability 및 mode·section별 realtime policy와 feed template
   - 지원 mode·parameter

2. `WindowInstanceService`
   - instance 생성·조회·변경·종료
   - generation과 idempotency 관리
   - snapshot 결과 보존

3. `RealtimeSubscriptionManager`
   - logical owner lease
   - physical subscription refcount
   - case-sensitive feed key
   - reconnect reconcile
   - cursor gap과 snapshot reset

4. `CapabilityResolver`
   - Capability와 mode를 내부 operation에 매핑
   - 동일 원본 TR 중복 호출 제거
   - Detail Projection을 서버 내부에서 조립

5. `ScopedEventRouter`
   - instance·generation·instrument·cursor 검증
   - 각 창에 필요한 delta만 전달

### Selector

- 299개 operation document 대신 19개 Capability document를 검색한다.
- LLM은 `capability_id`, target, mode, parameters만 반환한다.
- operation ref와 Detail group은 deterministic resolver만 선택한다.
- 주문 확인 권한은 Selector plan이 부여하지 않는다.

### Frontend / Canvas

- `canvas_type` 중심 분기에서 `window_id` 중심 분기로 이동한다.
- 19개 WindowShell과 공통 위젯을 사용한다.
- snapshot을 먼저 렌더하고 realtime 상태를 `registering → active`로 갱신한다.
- delta는 현재 instance·generation·instrument와 모두 일치할 때만 적용한다.
- 사용자가 조작하는 subscribe/unsubscribe 버튼을 제거한다.

## 5. 실시간 소유권 불변식

### Logical owner key

```text
(account_alias,
 authenticated_principal_or_local_session,
 client_session_id,
 client_window_id,
 generation)
```

### Physical subscription key

```text
(account_alias,
 case_sensitive_feed_id,
 canonical_item,
 feed_qualifiers)
```

`0G`와 `0g`는 반드시 서로 다른 key다.

### Refcount 규칙

| 전이 | Upstream 동작 |
|---|---|
| 첫 owner `0 → 1` | `REG` 1회 |
| 추가 owner `1 → N` | 호출 없이 refcount 증가 |
| 중간 종료 `N → N-1` | upstream 호출 없음 |
| 마지막 owner `1 → 0` | `REMOVE` 1회 |
| lease 만료 | owner release 후 같은 규칙 적용 |

정상 close는 즉시 release한다. 비정상 종료는 TTL 60초, heartbeat 20초를 기준으로 회수한다. 짧은 창 전환에는 5~15초 grace 적용을 허용한다.

## 6. 구현 단계

### Phase 0 — 계약 고정

- 299개 operation이 19개 Capability에 정확히 한 번씩 배정되는 fixture를 유지한다.
- OAuth 2개가 포함되지 않는지 검증한다.
- WebSocket code를 대소문자 그대로 검증한다.
- 22개 split TR family와 115개 Detail 합계를 고정한다.
- canonical manifest의 모든 `(operation_ref, response json_path)`를 `semantic`, `transport`, `internal`로 분류한다.
- 모든 semantic field를 `capability_id`, mode, section, tier, component 또는 `SemanticDetailSheet`에 연결한다.

완료 조건:

- assigned 299
- unassigned 0
- duplicated 0
- capability 19
- unclassified response field 0
- semantic rendered / semantic total 100%
- diagnostic-only semantic field 0

응답 필드 기준 원천은 `backend/ref/kiwoom-common-screen-manifest.json`이다. 현재 확인된 규모는 response field occurrence 3,705개, 고유 alias 1,877종이다. `generated/models.py`에서 의미가 `Extra Item`으로만 남은 `951`, `924`, `1279` 세 필드는 공식 의미가 확인되기 전까지 임의 분류하지 않고 field-coverage blocker로 유지한다.

### Phase 1 — Capability Catalog 병행 추가

- 기존 operation catalog는 유지한다.
- 신규 Capability catalog를 추가한다.
- Selector shadow mode에서 operation 결과와 Capability 결과를 함께 기록한다.
- 실제 호출은 기존 경로를 사용한다.

완료 조건:

- 대표 발화 corpus에서 19개 Capability top-1을 측정한다.
- operation ref가 사용자·Canvas 응답에 노출되지 않는다.

### Phase 2 — Snapshot-only Window Instance

- `POST /api/v1/window-instances`를 추가한다.
- 19개 typed snapshot view model을 정의한다.
- 동일 TR의 Detail은 한 upstream 응답에서 projection한다.
- frontend가 고정 WindowShell을 snapshot으로 렌더한다.

완료 조건:

- 19개 창 모두 snapshot fixture 렌더 가능
- 같은 TR을 여러 Detail 때문에 중복 호출하지 않음
- 첫 카드 표시 시간이 WebSocket ACK에 의존하지 않음

### Phase 3 — Subscription Manager

- owner lease와 physical refcount를 추가한다.
- scoped event stream을 추가한다.
- reconnect 후 재등록과 snapshot reset을 결합한다.
- cursor·generation gap을 검출한다.

완료 조건:

- 동일 종목 창 3개에서 physical `REG` 1회
- 마지막 창 종료에서 `REMOVE` 1회
- reconnect 이후 stale delta 0건

### Phase 4 — 호가·차트 Canary

- 기존 실시간 배선이 있는 호가와 차트를 먼저 옮긴다.
- snapshot 표시 시간과 realtime active 시간을 별도 측정한다.
- 중복 등록, 조기 해제, 다른 종목 delta 혼입을 관찰한다.

완료 조건:

- 호가 snapshot은 즉시 표시
- 정규·종합 호가는 `0C·0D`, 시간외 호가는 `0E` 자동 등록
- 금현물 호가는 대응 depth feed가 없어 snapshot 상태 유지
- 주식 차트 current candle은 shared `0B`, 업종 차트는 `0J`로 갱신
- 금·투자자 차트는 대응 candle feed가 없어 snapshot 상태 유지
- 종목 변경 시 이전 generation delta 무시

### Phase 5 — 나머지 17개 창 이전

- Paper의 19개 Window ID와 frontend registry를 일치시킨다.
- required/shared_required feed는 snapshot 성공 직후 자동 등록한다.
- conditional_required feed는 mode·target·visible-row 조건이 성립하는 즉시 자동 등록한다.
- `not_applicable` 창·mode·section은 snapshot refresh 정책을 사용한다.

### Phase 6 — Selector 전환

- 19개 Capability catalog를 기본으로 전환한다.
- 299개 operation 직접 선택은 내부 진단 모드로 내린다.
- 실패 시 기존 operation selector로 되돌릴 수 있는 flag를 유지한다.

### Phase 7 — 주문창 전환

- order draft, confirmation, status API를 먼저 완성한다.
- 기존 주문 confirmation header와 idempotency 경계를 유지한다.
- 주문창 자동 구독이 실제 주문을 발생시키지 않는 회귀 테스트를 추가한다.

### Phase 8 — 기존 public 표면 비노출화

- `/api/v1/tr/**`, `/api/v1/websocket/**`, `/api/v1/order/**`를 삭제하지 않는다.
- UI·LLM이 직접 사용하지 못하게 문서와 catalog에서 비노출화한다.
- 운영·테스트·resolver 전용 표면으로 유지한다.

## 7. 필수 상태 모델

### Snapshot

- `loading`
- `ready`
- `error`

### Realtime

- `not_applicable`
- `registering`
- `active`
- `recovering`
- `degraded`
- `closed`

UI는 snapshot이 `ready`이면 realtime이 `registering` 또는 `recovering`이어도 창을 표시한다.

## 8. 성능 목표

| 지표 | 목표 |
|---|---:|
| Selector 후보 수 | 19 |
| WindowShell 결정 | LLM 응답 직후 |
| snapshot 이후 HTTP 응답 | WebSocket ACK 대기 없음 |
| 중복 physical REG | 0 |
| 동일 TR Detail upstream 중복 호출 | 0 |
| stale generation delta 반영 | 0 |

## 9. 필수 회귀 테스트

- 같은 창 생성 요청 2회 → instance 1개, REG 1회
- 같은 종목을 보는 탭 3개 → physical REG 1회
- 탭 1개 종료 → REMOVE 0회
- 마지막 탭 종료 → REMOVE 1회
- snapshot 실패 → REG 0회
- snapshot 성공 + WS 장애 → 창 렌더 + recovering
- 종목 변경 중 이전 tick 도착 → 새 generation에 미반영
- reconnect → snapshot reset 전 delta 차단
- queue overflow → cursor gap과 reset_required
- mode 변경 → 새 mode profile만 acquire하고 미지원 mode에는 잘못된 feed REG 0회
- orderbook gold mode → `0C·0D·0E` REG 0회
- chart gold·investor mode → `0B·0J` REG 0회
- `0G`와 `0g` 동시 등록 → 서로 다른 physical key
- 주문창 생성 → 실시간 등록, 실제 주문 0회
- confirmation 재전송 → 실제 주문 최대 1회
- 주문 timeout → 자동 재시도 0회, in_doubt

## 10. 롤백

- Capability selector는 feature flag로 기존 operation selector와 병행한다.
- Window instance facade는 기존 route를 내부 호출하므로 route rollback이 필요 없다.
- Subscription Manager canary 실패 시 frontend 기존 registrar로 되돌린다.
- 주문 전환은 조회 창 전환과 별도 flag로 관리한다.

## 11. 완료 정의

- 계획·API·UI 문서가 동일한 19개 `capability_id`를 사용한다.
- Paper `19 통합 창` 페이지에 19개 실제 1440×900 창과 realtime lifecycle이 표현된다.
- 299개 operation의 합계가 문서에서 299로 검증된다.
- 모든 semantic response field가 primary, secondary, detail 중 하나로 접근 가능하고 자동화 fixture에서 100% 렌더 검증된다.
- transport/internal field는 오류, pagination, realtime lifecycle 행동 테스트로 100% 커버된다.
- 실시간 지원 창에 수동 등록 UI가 없다.
- 실시간 미지원 창은 `not_applicable`로 명시된다.
- mode·section별 realtime matrix가 API·UI·Paper에서 일치한다.
- cursor gap은 명시적 resync 계약으로 snapshot reset 후에만 delta를 재개한다.
- 만료된 lease는 갱신으로 부활하지 않고 새 instance를 생성한다.
- 주문 확인·멱등성·결과 불명 경계가 유지된다.
