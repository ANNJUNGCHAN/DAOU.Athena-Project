# Athena 19개 Capability API 내역서

- 상태: Paper 실제 19개 창 반영 완료 · Runtime 구현 전 계약 기준안
- 버전: `capability-contract/1.0.0`
- 대상 operation: OAuth 제외 299개

## 1. API 표면 원칙

사용자·Selector·Canvas가 보는 API 단위는 19개 Capability다. 물리 구현은 19개 라우터 복제가 아니라 하나의 공통 Window Instance 생명주기 API와 19개 typed schema다.

```text
Public application surface
  /api/v1/capabilities
  /api/v1/window-instances/**
  /api/v1/order-drafts/**
  /api/v1/order-requests/**

Internal adapter surface
  /api/v1/tr/**
  /api/v1/websocket/**
  /api/v1/order/**
```

내부 adapter 299개는 삭제하지 않는다. Selector와 프론트엔드가 직접 호출하지 못하게 내린다.

개별 귀속 정본은 `backend/ref/kiwoom-capability-assignment.json`이다. assignment key는 case-sensitive `mapping_id`이며, `backend/tests/unit/test_capability_assignment.py`가 OAuth 제외 manifest 299개와 fixture의 exact set equality를 검증한다.

## 2. 공통 Route

| Method | Route | 역할 |
|---|---|---|
| `GET` | `/api/v1/capabilities` | 19개 Capability 메타데이터 |
| `POST` | `/api/v1/window-instances` | 창 생성, snapshot 조회, required realtime lease 자동 생성 |
| `GET` | `/api/v1/window-instances/{instance_id}` | 현재 snapshot·realtime 상태 조회 |
| `PATCH` | `/api/v1/window-instances/{instance_id}` | 종목·기간·mode 변경 |
| `DELETE` | `/api/v1/window-instances/{instance_id}` | 창 owner release, 마지막 owner이면 REMOVE |
| `PUT` | `/api/v1/window-instances/{instance_id}/lease` | 창 lease 갱신 |
| `POST` | `/api/v1/window-instances/{instance_id}/resync` | cursor gap·epoch 변경 후 snapshot reset 요청 |
| `WS` | `/api/v1/window-instances/{instance_id}/events` | 해당 창에 필요한 상태·snapshot reset·delta만 전달 |
| `POST` | `/api/v1/order-drafts` | 주문 미리보기 생성, 주문 미실행 |
| `POST` | `/api/v1/order-drafts/{draft_id}/confirmations` | 명시적 확인 후 주문 실행 |
| `GET` | `/api/v1/order-requests/{request_id}` | 주문 결과·결과 불명 상태 확인 |

## 3. Window Instance 생성 계약

```http
POST /api/v1/window-instances
Authorization: Bearer ...
X-Athena-Account: primary
Idempotency-Key: 7dfe...
```

```json
{
  "client_session_id": "app-session-uuid",
  "client_window_id": "canvas-window-uuid",
  "capability_id": "orderbook",
  "capability_version": "1.0.0",
  "target": {
    "kind": "instrument",
    "market": "KRX",
    "instrument_code": "005930"
  },
  "mode": "regular",
  "parameters": {}
}
```

계좌는 body에서 임의 지정하지 않는다. 인증된 header와 backend dependency가 결정한다.

### 생성 응답

```json
{
  "data": {
    "instance_id": "win_01...",
    "client_window_id": "canvas-window-uuid",
    "capability_id": "orderbook",
    "capability_version": "1.0.0",
    "generation": 1,
    "target": {
      "kind": "instrument",
      "market": "KRX",
      "instrument_code": "005930"
    },
    "snapshot": {
      "state": "ready",
      "as_of": "2026-08-29T12:30:10.482+09:00",
      "payload": {}
    },
    "realtime": {
      "policy": "required",
      "state": "registering",
      "desired": true,
      "stream_url": "/api/v1/window-instances/win_01.../events",
      "stream_epoch": "ws_epoch_42",
      "lease_expires_at": "2026-08-29T12:31:10.484+09:00"
    }
  },
  "meta": {
    "request_id": "req_...",
    "created": true
  }
}
```

WebSocket control ACK를 기다리느라 snapshot 응답을 지연시키지 않는다. HTTP는 `registering` 상태로 반환하고, ACK 이후 scoped event stream으로 `active`를 보낸다.

## 4. Realtime 정책 값

| 정책 | 의미 |
|---|---|
| `required` | Capability가 소유한 feed를 snapshot 성공 직후 반드시 등록 |
| `shared_required` | 다른 Capability가 소유한 공통 feed를 현재 target·visible rows 범위에서 반드시 acquire |
| `conditional_required` | mode·target·visible-row 등 명시된 조건이 성립하면 반드시 등록하고, 아니면 해당 mode·section만 `not_applicable` |
| `not_applicable` | 대응 실시간 feed가 없으며 snapshot freshness를 표시 |

클라이언트는 required 계열 정책을 `false`로 바꿀 수 없다.

## 5. 19개 Capability 내역

| # | `capability_id` | 창 | operation | TR | 주요 mode | realtime policy | 소유·공유 feed |
|---:|---|---|---:|---:|---|---|---|
| 1 | `account` | 계좌 워크스페이스 | 76 | 35 | `summary`, `positions`, `cash`, `pnl`, `fills`, `margin` | `required` | `00`, `04` |
| 2 | `order` | 통합 주문 티켓 | 12 | 12 | `cash`, `credit`, `gold`; `buy`, `sell`, `amend`, `cancel` | `shared_required` | account의 `00`, `04` |
| 3 | `chart` | 통합 차트 | 21 | 21 | target `stock`, `sector`, `gold`, `investor`; period `tick`~`year` | `conditional_required` | mode matrix에 따라 `0B`, `0J` 또는 snapshot |
| 4 | `orderbook` | 통합 호가 | 31 | 7 | `regular`, `composite`, `after_hours`, `gold`; `5-level`, `10-level` | `conditional_required` | mode matrix에 따라 `0C`, `0D`, `0E` 또는 snapshot |
| 5 | `program-trading` | 프로그램매매 | 9 | 9 | `market`, `instrument`, `intraday`, `daily` | `conditional_required` | 종목 mode의 `0w` |
| 6 | `etf` | ETF | 10 | 10 | `overview`, `nav`, `returns`, `trades`, `flows` | `conditional_required` | 종목 target의 `0G` |
| 7 | `elw` | ELW | 22 | 13 | `overview`, `greeks`, `theoretical`, `spread`, `ranking` | `conditional_required` | 종목 target의 `0m`, `0u` |
| 8 | `sector` | 업종 | 16 | 8 | `quote`, `index`, `program`, `investor-flow`, `change`, `members`, `daily` | `conditional_required` | 지수 target의 `0J`, `0U` |
| 9 | `investor-flow` | 투자자·기관 수급 | 16 | 16 | `investor`, `institution`, `foreign`, `streak`, `ranking` | `conditional_required` | 종목 target header의 `0B`; 본문은 snapshot |
| 10 | `broker` | 거래원 | 16 | 11 | `buy`, `sell`, `net`, `broker-ranking` | `conditional_required` | 현재 종목 mode의 `0F` |
| 11 | `discovery` | 종목발굴·순위 | 10 | 10 | `volume`, `change`, `price`, `orderbook`, `credit` | `conditional_required` | visible rows의 `0B`, `0H` |
| 12 | `credit-lending-short` | 신용·대차·공매도 | 9 | 9 | `credit`, `lending`, `short` | `not_applicable` | 없음 |
| 13 | `stock-info` | 종목정보 | 21 | 15 | `overview`, `range`, `trading`, `warnings`, `facts` | `required` | 소유 `0g`; 가격 header에 shared `0B` |
| 14 | `watchlist` | 관심종목·목록 | 8 | 8 | `groups`, `instruments`, `industry-members`, `brokers` | `conditional_required` | visible rows의 `0B`, `0g` |
| 15 | `quote` | 현재시세·체결 | 9 | 9 | `realtime`, `daily`, `expected` | `required` | `0A`, `0B`, `0H` |
| 16 | `gold` | 금현물 | 5 | 5 | `quote`, `trades`, `daily`, `expected`, `conversion` | `required` | `0I` |
| 17 | `theme` | 테마 | 2 | 2 | `themes`, `members` | `not_applicable` | 없음 |
| 18 | `market-status` | 시장상태·VI | 2 | 2 | `session`, `vi` | `required` | `0s`, `1h` |
| 19 | `condition-search` | 조건검색 | 4 | 4 | `conditions`, `results`, `live` | `conditional_required` | 조건 실행 후 `ka10173`, 종료 시 `ka10174` |
|  | **합계** |  | **299** | **206** |  |  |  |

### 5.1 Mode·section별 Realtime Profile

Capability의 대표 policy는 창 전체를 무조건 같은 feed에 연결하라는 뜻이 아니다. Resolver는 다음 matrix로 `required` feed를 결정한다. 조건이 성립한 mode에서는 등록이 의무이며 사용자가 끌 수 없다. 조건이 성립하지 않는 행은 해당 mode·section만 `not_applicable`이고 창의 snapshot은 정상 표시한다.

| Capability | mode·section 조건 | 자동 acquire | 조건 불성립 시 |
|---|---|---|---|
| `account` | 인증된 모든 계좌 창 | `00`, `04` | 계좌 미확정이면 창을 열지 않음 |
| `order` | 모든 주문 티켓 | account의 `00`, `04` 공유 | 주문 실행 권한과 무관 |
| `chart` | 주식 target | current candle용 `0B` 공유 |  |
| `chart` | 업종 target | current index용 `0J` 공유 |  |
| `chart` | 금 target 또는 투자자 차트 | 없음 | snapshot |
| `orderbook` | `regular`, `composite` 주식 | `0C`, `0D` |  |
| `orderbook` | `after_hours` 주식 | `0E` |  |
| `orderbook` | `gold` (`ka50101`) | 없음 | snapshot; 주식 feed 등록 금지 |
| `program-trading` | 종목 target·intraday | `0w` | 시장·일별 aggregate는 snapshot |
| `etf` | 종목 target·NAV section | `0G` | 시장 aggregate는 snapshot |
| `elw` | 종목 target·이론가/지표 section | `0m`, `0u` | ranking·목록은 snapshot |
| `sector` | 업종지수 target의 현재가·등락 section | `0J`, `0U` | 구성종목·과거 일별은 snapshot |
| `investor-flow` | 종목 target이 있는 header | `0B` 공유 | 본문·시장 aggregate는 snapshot |
| `broker` | 현재 종목 거래원 section | `0F` | 과거·시장 ranking은 snapshot |
| `discovery` | viewport의 visible instrument rows | 행별 `0B`, 필요 시 `0H` 공유 | empty·offscreen 행 owner 없음 |
| `credit-lending-short` | 모든 mode | 없음 | snapshot |
| `stock-info` | 종목 target | `0g` 소유 + `0B` 공유 | target 미확정이면 창을 열지 않음 |
| `watchlist` | viewport의 visible instrument rows | 행별 `0B`, `0g` 공유 | empty·offscreen 행 owner 없음 |
| `quote` | 현재시세·체결 | `0A`, `0B`; 예상체결 section은 `0H` | 일별 본문은 snapshot |
| `gold` | 금현물 창의 환산가격 section | `0I` | 나머지 section은 snapshot |
| `theme` | 모든 mode | 없음 | snapshot |
| `market-status` | session / VI | `0s` / `1h` | 해당 section이 없으면 acquire하지 않음 |
| `condition-search` | 조건 선택·식별자 확보 | `ka10173`; owner 종료 시 `ka10174` | 조건 미선택은 empty |

## 6. WebSocket 23개 귀속

| Capability | operation | 의미 | 자동 등록 시점 |
|---|---|---|---|
| `account` | `00` | 주문체결 | 인증된 계좌 window snapshot 후 |
| `account` | `04` | 잔고 | 인증된 계좌 window snapshot 후 |
| `quote` | `0A` | 주식기세 | 종목 snapshot 후 |
| `quote` | `0B` | 주식체결 | 종목 snapshot 후 |
| `orderbook` | `0C` | 주식우선호가 | 호가 snapshot 후 |
| `orderbook` | `0D` | 주식호가잔량 | 호가 snapshot 후 |
| `orderbook` | `0E` | 주식시간외호가 | 시간외 mode snapshot 후 |
| `broker` | `0F` | 주식당일거래원 | 거래원 snapshot 후 |
| `etf` | `0G` | ETF NAV | ETF snapshot 후 |
| `quote` | `0H` | 주식예상체결 | 예상체결 mode snapshot 후 |
| `gold` | `0I` | 국제금환산가격 | 금현물 snapshot 후 |
| `sector` | `0J` | 업종지수 | 업종 snapshot 후 |
| `sector` | `0U` | 업종등락 | 업종 snapshot 후 |
| `stock-info` | `0g` | 주식종목정보 | 종목정보 snapshot 후 |
| `elw` | `0m` | ELW 이론가 | ELW snapshot 후 |
| `market-status` | `0s` | 장시작시간 | 앱 session의 첫 시장창 생성 후 |
| `elw` | `0u` | ELW 지표 | ELW snapshot 후 |
| `program-trading` | `0w` | 종목프로그램매매 | 프로그램매매 snapshot 후 |
| `market-status` | `1h` | VI 발동·해제 | 시장상태 snapshot 후 |
| `condition-search` | `ka10171` | 조건 목록 | 창 초기 snapshot |
| `condition-search` | `ka10172` | 일반 검색 | 조건 실행 |
| `condition-search` | `ka10173` | 실시간 검색 | 조건 식별자 확보 직후 자동 등록 |
| `condition-search` | `ka10174` | 실시간 해제 | condition owner 종료 |

`0G`와 `0g`는 대소문자를 포함해 완전히 다른 operation이다.

## 7. 실시간 Event 계약

### 상태 이벤트

```json
{
  "type": "realtime-status",
  "instance_id": "win_01...",
  "generation": 1,
  "stream_epoch": "ws_epoch_42",
  "state": "active",
  "cursor": 1,
  "occurred_at": "2026-08-29T12:30:10.612+09:00"
}
```

### Delta 이벤트

```json
{
  "type": "delta",
  "instance_id": "win_01...",
  "capability_id": "orderbook",
  "generation": 1,
  "stream_epoch": "ws_epoch_42",
  "cursor": 241,
  "instrument_code": "005930",
  "as_of": "2026-08-29T12:30:11.021+09:00",
  "payload": {}
}
```

클라이언트는 `instance_id`, `generation`, `instrument_code`가 모두 현재 창과 일치할 때만 delta를 적용한다. `cursor`는 같은 `stream_epoch` 안에서 단조 증가한다. cursor가 건너뛰거나 epoch가 바뀌면 delta 적용을 멈추고 아래 resync를 요청한다.

### Resume·snapshot reset

WebSocket 연결 직후 클라이언트는 마지막으로 적용한 위치를 한 번 보낸다.

```json
{
  "type": "resume",
  "generation": 1,
  "stream_epoch": "ws_epoch_42",
  "after_cursor": 241
}
```

서버가 연속 replay를 보장할 수 없거나 cursor gap·epoch 불일치를 감지하면 다음 절차를 사용한다.

```http
POST /api/v1/window-instances/{instance_id}/resync
If-Match: "generation-1"
```

```json
{
  "stream_epoch": "ws_epoch_42",
  "after_cursor": 241,
  "reason": "cursor_gap"
}
```

서버는 `202 Accepted` 후 해당 instance의 delta 전달을 일시 중지하고 새 snapshot을 조회한 다음 아래 event를 보낸다.

```json
{
  "type": "snapshot-reset",
  "instance_id": "win_01...",
  "generation": 1,
  "stream_epoch": "ws_epoch_43",
  "cursor": 0,
  "as_of": "2026-08-29T12:31:00.000+09:00",
  "payload": {}
}
```

클라이언트가 reset payload를 원자적으로 적용한 뒤에만 새 epoch의 `cursor: 1` delta를 받는다. 오래된 generation의 resync는 `412`, 이미 만료된 instance는 `410`이다.

## 8. 종목·Mode 변경

```http
PATCH /api/v1/window-instances/{instance_id}
If-Match: "generation-1"
```

권장 순서:

1. 현재 generation 검증
2. 새 target snapshot 조회
3. 새 desired subscription acquire
4. instance를 새 generation으로 원자적 교체
5. 새 snapshot 응답
6. 이전 target owner release

새 snapshot이 실패하면 기존 generation과 구독을 유지한다. 오래된 `If-Match`는 `412 Precondition Failed`다.

## 9. Lease·멱등성

### Window create

- scope: `(account, authenticated session, client_window_id, Idempotency-Key)`
- 같은 key·같은 body: 같은 instance와 현재 상태 반환
- 같은 key·다른 body: `409 idempotency_conflict`
- timeout 후 재요청: 중복 instance와 중복 REG 금지

### Window delete

- 반복 DELETE는 `204`
- 다른 owner의 refcount에 영향 없음

### Lease

```http
PUT /api/v1/window-instances/{instance_id}/lease
If-Match: "generation-1"
```

```json
{
  "lease_token": "lease_opaque_01...",
  "ttl_seconds": 60
}
```

```json
{
  "data": {
    "instance_id": "win_01...",
    "generation": 1,
    "lease_expires_at": "2026-08-29T12:32:00.000+09:00"
  }
}
```

- TTL은 60초, heartbeat는 20초로 고정한다.
- 같은 token·generation의 재전송은 같은 만료 시각 또는 더 늦은 단일 lease를 반환한다.
- 다른 token은 `409 lease_conflict`, 오래된 generation은 `412`다.
- 정상 close는 즉시 DELETE하고 반복 DELETE는 `204`다.
- crash는 lease 만료 후 logical owner를 release한다. 마지막 owner이면 physical REMOVE를 한 번 수행한다.
- 만료 후 갱신은 `410 instance_expired`이며 기존 instance·구독을 부활시키지 않는다. 클라이언트는 새 window instance를 생성한다.

## 10. 주문 API 안전 계약

### Draft 생성

```http
POST /api/v1/order-drafts
Authorization: Bearer ...
Idempotency-Key: ...
```

Draft에 봉인할 필드:

- account
- instrument
- side
- quantity
- order type
- price
- cash / credit / gold
- amend / cancel 원주문 식별자
- 생성 시각·만료 시각
- request fingerprint

### Confirmation

```http
POST /api/v1/order-drafts/{draft_id}/confirmations
Authorization: Bearer ...
Idempotency-Key: ...
```

불변식:

- Window instance 생성은 주문을 실행하지 않는다.
- Selector plan은 operation을 증명할 뿐 주문 권한을 부여하지 않는다.
- timeout은 자동 재시도하지 않고 `in_doubt`다.
- 같은 key·다른 body는 `409`다.

## 11. 공통 오류

| HTTP | code | 의미 |
|---:|---|---|
| 400 | `invalid_request` | malformed request |
| 401 | `unauthorized` | 인증 없음·만료 |
| 403 | `account_forbidden` | 계좌 접근 불가 |
| 404 | `capability_not_found` | 알 수 없는 Capability |
| 404 | `window_instance_not_found` | 존재하지 않는 instance |
| 409 | `idempotency_conflict` | 같은 key·다른 body |
| 409 | `order_in_doubt` | 주문 결과 불명 |
| 412 | `generation_mismatch` | 오래된 창 상태로 PATCH |
| 422 | `unsupported_mode` | Capability가 지원하지 않는 mode |
| 429 | `upstream_rate_limited` | Kiwoom 호출 제한 |
| 502 | `snapshot_upstream_failed` | snapshot 원천 실패 |
| 503 | `realtime_recovering` | 신규 stream 연결 불가; 기존 snapshot 유지 가능 |

오류 응답은 공통 envelope를 사용한다.

```json
{
  "error": {
    "code": "unsupported_mode",
    "message": "The requested mode is not supported by this capability.",
    "details": [
      {"field": "mode", "code": "invalid_choice"}
    ]
  }
}
```

## 12. Detail Projection 22개 Family

115개 Detail route를 Selector에 각각 노출하지 않는다.

| TR | Detail | 통합 영역 |
|---|---:|---|
| `ka30012` | 10 | ELW 종목상세 |
| `ka10004` | 9 | 정규장 호가 |
| `ka10007` | 9 | 종합시세 |
| `ka10087` | 9 | 시간외 호가 |
| `kt00013` | 9 | 증거금 세부 |
| `kt00001` | 8 | 예수금 상세 |
| `ka10001` | 7 | 종목 기본정보 |
| `kt00005` | 6 | 체결 잔고 |
| `ka20001` | 5 | 업종 현재가 |
| `ka20009` | 5 | 업종 일별 |
| `kt00016` | 5 | 일별 계좌수익률 |
| `ka10040` | 4 | 당일 주요 거래원 |
| `kt00004` | 4 | 계좌 평가현황 |
| `kt00011` | 4 | 증거금율별 주문가능 |
| `ka10002` | 3 | 거래원 매도·매수 |
| `kt00010` | 3 | 주문·인출 가능금액 |
| `kt00012` | 3 | 신용보증금율별 주문가능 |
| `kt00017` | 3 | 당일 계좌현황 |
| `kt00018` | 3 | 평가 잔고내역 |
| `kt00009` | 2 | 주문체결 현황 |
| `kt50020` | 2 | 금현물 잔고 |
| `kt50032` | 2 | 금현물 거래내역 |
| **합계** | **115** | **22개 family** |

## 13. Capability별 내부 TR ID

아래 목록은 operation의 case-sensitive TR ID 기준이다. Detail route 여러 개가 같은 TR ID에 속할 수 있어 TR 수와 operation 수는 다르다.

### `account` — 76 operation / 35 TR

`00`, `04`, `ka00001`, `ka01690`, `ka10072`, `ka10073`, `ka10074`, `ka10075`, `ka10076`, `ka10077`, `ka10085`, `ka10088`, `ka10170`, `kt00001`, `kt00002`, `kt00003`, `kt00004`, `kt00005`, `kt00007`, `kt00008`, `kt00009`, `kt00010`, `kt00011`, `kt00012`, `kt00013`, `kt00015`, `kt00016`, `kt00017`, `kt00018`, `kt50020`, `kt50021`, `kt50030`, `kt50031`, `kt50032`, `kt50075`

### `order` — 12 operation / 12 TR

`kt10000`, `kt10001`, `kt10002`, `kt10003`, `kt10006`, `kt10007`, `kt10008`, `kt10009`, `kt50000`, `kt50001`, `kt50002`, `kt50003`

### `chart` — 21 operation / 21 TR

`ka10060`, `ka10064`, `ka10079`, `ka10080`, `ka10081`, `ka10082`, `ka10083`, `ka10094`, `ka20004`, `ka20005`, `ka20006`, `ka20007`, `ka20008`, `ka20019`, `ka50079`, `ka50080`, `ka50081`, `ka50082`, `ka50083`, `ka50091`, `ka50092`

### `orderbook` — 31 operation / 7 TR

`0C`, `0D`, `0E`, `ka10004`, `ka10007`, `ka10087`, `ka50101`

### `program-trading` — 9 operation / 9 TR

`0w`, `ka90003`, `ka90004`, `ka90005`, `ka90006`, `ka90007`, `ka90008`, `ka90010`, `ka90013`

### `etf` — 10 operation / 10 TR

`0G`, `ka40001`, `ka40002`, `ka40003`, `ka40004`, `ka40006`, `ka40007`, `ka40008`, `ka40009`, `ka40010`

### `elw` — 22 operation / 13 TR

`0m`, `0u`, `ka10048`, `ka10050`, `ka30001`, `ka30002`, `ka30003`, `ka30004`, `ka30005`, `ka30009`, `ka30010`, `ka30011`, `ka30012`

### `sector` — 16 operation / 8 TR

`0J`, `0U`, `ka10010`, `ka10051`, `ka20001`, `ka20002`, `ka20003`, `ka20009`

### `investor-flow` — 16 operation / 16 TR

`ka10008`, `ka10034`, `ka10035`, `ka10036`, `ka10037`, `ka10044`, `ka10045`, `ka10058`, `ka10059`, `ka10061`, `ka10063`, `ka10065`, `ka10066`, `ka10131`, `ka52301`, `ka90009`

### `broker` — 16 operation / 11 TR

`0F`, `ka10002`, `ka10038`, `ka10039`, `ka10040`, `ka10042`, `ka10043`, `ka10052`, `ka10053`, `ka10062`, `ka10078`

### `discovery` — 10 operation / 10 TR

`ka10020`, `ka10021`, `ka10022`, `ka10023`, `ka10027`, `ka10029`, `ka10030`, `ka10031`, `ka10032`, `ka10098`

### `credit-lending-short` — 9 operation / 9 TR

`ka10013`, `ka10014`, `ka10033`, `ka10068`, `ka10069`, `ka20068`, `ka90012`, `kt20016`, `kt20017`

### `stock-info` — 21 operation / 15 TR

`0g`, `ka10001`, `ka10003`, `ka10015`, `ka10016`, `ka10017`, `ka10018`, `ka10019`, `ka10024`, `ka10025`, `ka10026`, `ka10028`, `ka10054`, `ka10055`, `ka10084`

### `watchlist` — 8 operation / 8 TR

`ka00198`, `ka01300`, `ka01301`, `ka10095`, `ka10099`, `ka10100`, `ka10101`, `ka10102`

### `quote` — 9 operation / 9 TR

`0A`, `0B`, `0H`, `ka10005`, `ka10006`, `ka10011`, `ka10046`, `ka10047`, `ka10086`

### `gold` — 5 operation / 5 TR

`0I`, `ka50010`, `ka50012`, `ka50087`, `ka50100`

### `theme` — 2 operation / 2 TR

`ka90001`, `ka90002`

### `market-status` — 2 operation / 2 TR

`0s`, `1h`

### `condition-search` — 4 operation / 4 TR

`ka10171`, `ka10172`, `ka10173`, `ka10174`

## 14. OpenAPI 표기

- `GET /api/v1/capabilities` 응답에는 19개 definition을 discriminated union으로 노출한다.
- `POST /api/v1/window-instances` 요청은 `capability_id`를 discriminator로 사용한다.
- 내부 299 route는 `x-athena-internal: true`를 유지·추가한다.
- Detail route는 `x-athena-llm-exposed: false`를 유지한다.
- 주문 mutation은 Window Instance schema에 섞지 않는다.

## 15. 응답 필드 커버리지 계약

19개 Capability는 299개 operation을 사용자 의도 단위로 묶는 API 표면이다. 이것만으로 모든 응답 필드가 자동으로 표현된다고 간주하지 않는다. 필드 단위 정본과 검증 기준은 다음과 같다.

- canonical source: `backend/ref/kiwoom-common-screen-manifest.json`
- generated model source: `backend/athena_api/generated/models.py`
- OAuth 제외 operation: 299개
- response field occurrence: 3,705개
- 고유 response alias: 1,877종

필드 레지스트리는 최소한 아래 속성을 가진다.

```text
operation_ref, json_path, alias, label_ko, description, unit_or_format,
sensitivity, field_class, capability_id, mode, section_id, tier,
component_id, visibility_condition, realtime_merge_key,
fallback_section_id, fixture_id
```

`field_class`는 `semantic`, `transport`, `internal` 중 하나다. 사용자 의미가 있는 필드는 `primary`, `secondary`, `detail` tier 중 하나 또는 사용자용 `SemanticDetailSheet`로 반드시 접근 가능해야 한다. raw JSON이나 내부 alias를 그대로 노출하는 것은 fallback으로 인정하지 않는다.

transport/internal 필드는 카드 본문에 그대로 그리지 않는다. 대신 `return_code`, `return_msg`, `trnm`, pagination token, trace id, WebSocket REG/REMOVE envelope, raw WS value의 의미를 오류·pagination·realtime lifecycle 행동으로 검증한다.

필드 커버리지 완료 게이트:

- 299 operation assigned, unassigned 0, duplicated 0
- 모든 `(operation_ref, response json_path)` 분류, unclassified 0
- semantic rendered / semantic total 100%
- diagnostic-only semantic field 0
- compound scalar/list, pagination, REST/WebSocket merge, masking fixture 통과
- 의미 기반 상세 영역에서도 접근할 수 없는 semantic field 0

현재 `generated/models.py`에 의미가 `Extra Item`으로만 정의된 `951`, `924`, `1279` 세 필드는 공식 의미 확인 전까지 임의 분류하지 않는다. 따라서 19개 창의 operation 귀속과 Paper 정보 구조는 확정되었지만, 모든 응답 필드의 100% 표현은 이 세 blocker 해결과 필드 레지스트리 자동 검증 전에는 완료로 선언하지 않는다.
