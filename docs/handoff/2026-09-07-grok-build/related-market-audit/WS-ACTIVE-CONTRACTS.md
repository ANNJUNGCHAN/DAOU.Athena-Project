# WebSocket active 전수 검사 계약

- 작성 시각: 2026-09-07 11:05 KST
- 기준 HEAD: `ac8452f5b62a338d74826ac27cf65da12d99320b`
- 범위: 국내 WebSocket 23개 원천 기능(REAL 19, 조건검색 4)의 실제 등록·응답·이벤트·정리 계약 조사와 후속 active probe 설계
- 이번 작업에서 수행한 네트워크 변경: 없음. REG, REMOVE, 조건검색, 주문, OAuth, provider 시작을 호출하지 않았다.

## 현재 관찰 기준

프로세스 메타데이터만 다시 확인했다. Electron PID 49728은 저장소의 Electron 실행 파일이고, backend 부모 PID 32552와 자식 PID 25412가 존재하며, 연속 watcher PID 44124도 존재한다. 명령행과 자격증명은 읽거나 기록하지 않았다.

09:41:08 KST의 수동 관찰 artifact `artifacts/market-session-audit/2026-09-07/ws-passive-20260907T004108-394Z.json`은 downstream 연결 성공, 15초 동안 메시지 0개, `registration_sent=false`를 기록한다. 이는 기존 upstream 구독의 fanout을 보지 못했다는 증거이며, 23개 기능 실패나 upstream 미연결의 증거가 아니다.

현재 backend의 upstream WebSocket 상수는 `wss://mockapi.kiwoom.com:10000/api/dostk/websocket`이다(`backend/athena_api/kiwoom/ws_client.py:16`). 따라서 오늘 이 프로세스로 얻는 결과는 mockapi 환경의 실제 런타임 결과로 분류해야 한다. 실계좌·운영 provider 결과로 확장해서 해석하면 안 된다.

## 원천 집합 대조

`backend/ref/kiwoom-screen-definitions.json`의 `category=websocket`, `backend/ref/kiwoom-common-screen-manifest.json`의 `classification.category=websocket`, `WEBSOCKET_TR_IDS`를 대소문자 그대로 비교했다.

- definitions: 23, unique 23
- common manifest: 23, unique 23
- generated registry: 23
- definitions ↔ manifest 양방향 차집합: 0
- 정렬 ID digest: `sha256:f9b1e9873a371e6731160dda0cca3dacdce07d2b2bdd1c96fd474c22da25088b`
- `0G`와 `0g`는 서로 다른 ID다. runtime도 `data.type`의 대소문자 일치를 강제한다(`backend/athena_api/generated/runtime.py:133-138`).

| ID | 기능 | 종류 |
| --- | --- | --- |
| 00 | 주문체결 | REAL |
| 04 | 잔고 | REAL |
| 0A | 주식기세 | REAL |
| 0B | 주식체결 | REAL |
| 0C | 주식우선호가 | REAL |
| 0D | 주식호가잔량 | REAL |
| 0E | 주식시간외호가 | REAL |
| 0F | 주식당일거래원 | REAL |
| 0G | ETF NAV | REAL |
| 0H | 주식예상체결 | REAL |
| 0I | 국제금환산가격 | REAL |
| 0J | 업종지수 | REAL |
| 0U | 업종등락 | REAL |
| 0g | 주식종목정보 | REAL |
| 0m | ELW 이론가 | REAL |
| 0s | 장시작시간 | REAL |
| 0u | ELW 지표 | REAL |
| 0w | 종목프로그램매매 | REAL |
| 1h | VI발동/해제 | REAL |
| ka10171 | 조건검색 목록조회 | 조건 one-shot |
| ka10172 | 조건검색 요청 일반 | 조건 one-shot |
| ka10173 | 조건검색 요청 실시간 | 조건 lease 생성 |
| ka10174 | 조건검색 실시간 해제 | 조건 lease 해제 |

## 계정과 downstream 연결 계약

한 계정은 token manager, REST client, order client, rate limiter, upstream WebSocket client를 공유하는 독립 runtime이다(`backend/athena_api/accounts.py:31-50`). 제어 POST는 `X-Athena-Account`, downstream WebSocket은 `?account=<alias>`로 같은 runtime을 선택한다(`backend/athena_api/dependencies.py:49-63,84-99,161-181`). 계정을 생략하면 backend default account를 사용한다.

Active probe는 `/ready/accounts` 응답에서 default alias와 그 계정의 `ready`, `websocket` 상태를 메모리에서만 읽어야 한다. alias, 계좌번호, 계정별 상태 원문은 artifact에 저장하지 않는다. 제어 POST와 downstream stream 모두 동일한 default alias를 명시해 서로 다른 계정 runtime이 선택되는 것을 막는다.

Downstream `/api/v1/ws/stream`은 연결을 accept한 뒤 local bearer가 설정돼 있으면 Authorization 헤더 또는 첫 JSON auth frame을 요구한다. auth ACK는 보내지 않는다(`backend/athena_api/api/ws_auth.py:29-58`). 인증 뒤에는 선택된 account runtime의 큐를 구독하고, 연결이 끝나면 그 큐만 제거한다(`backend/athena_api/api/stream.py:18-29`). Downstream 연결 종료는 upstream REG lease를 제거하지 않는다.

따라서 인증 판정은 다음처럼 제한한다.

- close 1008: `AUTH_REJECTED`
- 첫 auth frame 전송 후 연결 유지, REAL 없음: `AUTH_NOT_REJECTED_NO_ACK`
- 선택한 stream에서 REAL 수신: `AUTHENTICATED_STREAM_EVIDENCE`
- 연결 성공만으로 `AUTH_VERIFIED` 또는 23개 기능 PASS를 선언하지 않는다.

## 19개 REAL 제어 계약

각 경로는 `POST /api/v1/websocket/{TR}`이며 payload는 `trnm`, `grp_no`, `refresh`, `data`를 사용한다. runtime은 REG/REMOVE만 허용하고, `data.type`과 경로 TR을 대소문자까지 일치시키며, backend client의 `register`/`remove`로 전달한다(`backend/athena_api/generated/runtime.py:123-153`).

Backend client는 모든 제어 요청을 account runtime 단위 `_control_lock`으로 직렬화한다. 응답에 정규화 가능한 `return_code`가 반드시 있어야 하고 `0`만 성공이다(`backend/athena_api/kiwoom/ws_client.py:102-149`). REAL은 `trnm=REAL`일 때 모든 downstream subscriber 큐로 fanout된다(`backend/athena_api/kiwoom/ws_client.py:259-279,421-425`). REAL frame에는 probe가 지정한 `grp_no`가 보장되지 않으므로 동일 type 이벤트를 특정 probe REG의 인과 결과로 단정할 수 없다.

일반 lease key는 TR, `grp_no`, 정렬된 data item/type 조합이다(`backend/athena_api/kiwoom/ws_client.py:445-469`). `refresh=1`은 기존 그룹을 일괄 교체하지 않는다. `refresh=0`은 같은 그룹의 기존 lease를 먼저 제거하므로 검사에서는 금지한다(`backend/athena_api/kiwoom/ws_client.py:337-355`). REMOVE는 같은 TR·그룹·항목만 로컬 lease에서 제거하며 일부 항목 제거도 보존한다(`backend/athena_api/kiwoom/ws_client.py:361-394`).

### 검사 입력 후보

저장소의 기존 `backend/scripts/live_websocket_sweep.py:26-46`에는 다음 후보가 있다.

- item 없음: 00, 04
- 삼성전자 `005930`: 0A, 0B, 0C, 0D, 0E, 0F, 0H, 0g, 0w, 1h
- ETF `069500`: 0G
- 국제금 `MGD`: 0I
- 업종 `001`: 0J, 0U
- 장 상태 빈 item: 0s
- ELW `57K123`: 0m, 0u

이 표는 2026-08-31 harness 후보이며 오늘의 입력 유효성 증거가 아니다. 특히 ELW 코드는 만기될 수 있으므로 오늘 safe read/catalog에서 현재 유효 코드를 먼저 해결하지 못하면 0m·0u는 `BLOCKED_INPUT`, 임의 종목으로 대체하지 않는다. 00·04는 등록 ACK를 검사할 수 있지만 실제 주문·잔고 변화가 없으면 REAL 무관찰이 정상일 수 있다. 주문 API는 호출하지 않는다.

`0I` response model은 `extra='allow'`이지만 선언 필드에 `return_code`가 없다(`backend/athena_api/generated/models.py:742-748`). Runtime은 upstream result에서 return_code를 먼저 검사하므로 제어 성공 자체는 검증하지만, 후속 probe는 HTTP response 직렬화에서 이 필드가 실제 유지되는지도 별도 계약으로 기록해야 한다.

## 조건검색 4개 계약

조건 4개는 일반 REG/REMOVE 변환을 거치지 않고 payload 전체가 `client.execute`로 전달된다(`backend/athena_api/generated/runtime.py:25,123-127`).

| ID | 요청 계약 | 상태 효과 | 완료 증거 |
| --- | --- | --- | --- |
| ka10171 | `trnm=CNSRLST` | 없음 | HTTP 2xx, normalized return_code 0, 목록 shape; 이름·seq 원문 미저장 |
| ka10172 | `trnm=CNSRREQ`, 유효 seq, `search_type=0`, `stex_tp=K`; continuation 선택 | persistent lease 없음 | HTTP 2xx, return_code 0, 결과 count/continuation shape |
| ka10173 | `trnm=CNSRREQ`, 유효 seq, `search_type=1`, `stex_tp=K` | `condition:<seq>` lease 생성 및 reconnect 복원 | HTTP 2xx, return_code 0; 이후 동일 seq 이벤트는 별도 관찰 |
| ka10174 | `trnm=CNSRCLR`, ka10173에서 probe가 소유한 동일 seq | `condition:<seq>` lease 제거 | HTTP 2xx, return_code 0; 정리 결과 |

요청 상수와 필수 필드는 `backend/athena_api/generated/models.py:4306-4416`에 정의돼 있다. Client는 성공한 ka10173 `search_type=1`을 `condition:<seq>` 하나로 기억하고 ka10174에서 같은 키를 삭제한다(`backend/athena_api/kiwoom/ws_client.py:355-359,445-448`).

## 소유권과 충돌 판정

### 확인된 것

- account alias는 account별 upstream socket namespace를 제공한다.
- REAL lease는 TR·group·items 조합으로 로컬에서 구분된다.
- 조건 실시간 lease는 account 안에서 `condition:<seq>`만으로 구분된다.
- 기존 harness의 80~98 그룹은 과거 코드와 artifact에서 사용됐지만, 현재 비어 있다는 증거는 아니다.
- 현재 app의 차트 REAL 경로는 group `1`을 사용한다(`app/lib/main/chart-realtime.js:99-111`).

### 공개 API로 확인할 수 없는 것

현재 backend에는 account runtime의 `_subscriptions`, 점유 그룹, condition seq lease, lease owner를 읽는 공개 endpoint가 없다. downstream 연결도 별도 upstream connection을 만들지 않고 선택 계정의 같은 client에 subscriber만 추가한다. 따라서 다음은 실행 전 객관적으로 증명할 수 없다.

- 후보 그룹 80~98이 다른 호출자에게 미점유인지
- 동일 TR·group·item lease가 이미 존재하는지
- 선택한 condition seq가 기존 실시간 조건 구독 중인지
- HTTP REMOVE 0이 실제 upstream REMOVE ACK인지. Client는 연결 실패 두 번 뒤, 재연결로 REG가 복원되지 않은 경우 synthetic success를 반환할 수 있다(`backend/athena_api/kiwoom/ws_client.py:174-193`).

이는 사용자 권한 부족 문제가 아니라 runtime 소유권 관측 기능 부재다.

### 실행 가능 판정

- REAL 19: `refresh=1`, run 전용 그룹, exact reverse REMOVE를 사용하면 기존 lease에 대한 영향 가능성을 크게 줄일 수 있다. 다만 그룹 점유를 증명할 API가 없어 `ISOLATION_BEST_EFFORT`로만 분류한다.
- ka10171·ka10172: persistent lease를 만들지 않으므로 default account 준비와 유효 seq가 확인되면 실행 가능하다.
- ka10173·ka10174: 동일 seq의 기존 lease를 구분할 owner namespace가 없어 현재는 `BLOCKED_OWNERSHIP_DISCOVERY`다. 전수 검사를 안전하게 닫으려면 전용 idle account runtime, 또는 읽기 전용 lease inventory와 owner token 중 하나가 필요하다.

## 최소 active probe 설계

기존 `backend/scripts/live_websocket_sweep.py`의 구조는 재사용할 수 있지만 그대로 실행하면 안 된다. 현재 파일은 account alias, target, group을 artifact에 저장하고 조건 4개를 다루지 않으며, cleanup의 synthetic success를 upstream ACK와 구분하지 않는다.

1. **고정 전제 검사**
   - loopback `127.0.0.1:8010`만 허용하고 redirect를 거부한다.
   - definitions, common manifest, generated registry의 23개 ID를 대소문자 그대로 재대조한다.
   - `/ready`와 `/ready/accounts`를 safe GET으로 확인하고 default account alias는 메모리에서만 사용한다.
   - default account의 data readiness와 websocket readiness가 아니면 전 기능 `BLOCKED_PREREQUISITE`로 종료한다.

2. **downstream 관찰 연결**
   - 같은 default account를 query로 선택하고 local bearer를 첫 frame으로 전송한다.
   - connect 5초, baseline 2초, active observation 45초, close 3초로 제한한다.
   - raw frame, values, item, account alias, 조건 이름·seq를 저장하지 않는다. ID별 message count와 envelope/schema 판정만 저장한다.

3. **REAL 19 등록**
   - `refresh=1`만 사용한다.
   - 현재 점유를 확인할 수 없다는 플래그와 함께 run 전용 숫자 그룹을 사용한다. 80~98은 과거 수용 실적은 있지만 현재 점유 증거가 없으므로 고정 재사용하지 않는다.
   - 매 요청 직후 HTTP status와 normalized return_code 존재/0 여부만 기록한다.
   - REG 성공 항목은 즉시 owned ledger에 넣는다. 예외·취소가 발생해도 finally cleanup 대상에서 빠지지 않게 한다.
   - REAL은 정확한 case-sensitive type별로 집계한다. REG ACK와 REAL 관찰을 별도 verdict로 유지한다.

4. **조건 one-shot**
   - ka10171로 목록 shape를 확인하고 유효 후보 수만 기록한다.
   - 메모리에서 선택한 한 seq로 ka10172 `search_type=0`을 호출하고 결과 count/continuation만 기록한다.
   - ka10173/74는 condition lease 소유권이 객관적으로 확보된 경우에만 한 쌍으로 실행한다. 확보되지 않으면 두 항목 모두 `BLOCKED_OWNERSHIP_DISCOVERY`로 남긴다.

5. **정리**
   - 성공한 REAL REG를 역순으로 exact TR·group·item REMOVE한다.
   - owned ka10173이 있으면 같은 seq의 ka10174를 먼저 호출한다.
   - 각 REMOVE는 bounded HTTP 결과, API ACK, synthetic 가능성, post-remove 이벤트 count를 따로 기록한다.
   - post-remove REAL은 in-flight frame일 수 있고 frame에 group이 없으므로 0이 아니라고 즉시 cleanup 실패로 단정하지 않는다. 반대로 0이어도 upstream lease 제거가 증명되지는 않는다.
   - cleanup 미완료나 ownership 불명은 전체 verdict를 PASS로 만들지 않는다.

## ID별 완료 판정

각 ID는 하나의 통합 PASS 대신 아래 축을 독립 기록한다.

- `SOURCE_PRESENT`: 세 원천 exact-set 통과
- `REQUEST_VALIDATED`: local generated model 검증 통과
- `CONTROL_ACK`: HTTP 성공과 normalized return_code 0
- `EVENT_OBSERVED`: 해당 case-sensitive REAL 또는 조건 이벤트 1개 이상
- `EVENT_NOT_OBSERVED`: 관찰 창 내 0개. 조용한 시장·계정 활동 부재와 구분 불가
- `CLEANUP_REQUESTED`: exact owned cleanup 시도
- `CLEANUP_ACK_API`: backend API가 0 반환
- `CLEANUP_UPSTREAM_UNVERIFIED`: synthetic success 가능성 또는 group 없는 in-flight event 때문에 upstream 제거 미증명
- `BLOCKED_INPUT`, `BLOCKED_PREREQUISITE`, `BLOCKED_OWNERSHIP_DISCOVERY`

23개 모두에 source와 request 계약을 대조하고, 실행 가능한 항목은 control/event/cleanup 축을 채운다. REAL 무관찰, 계정 활동이 필요한 00·04의 무관찰, 조건 lease 소유권 부재를 기능 실패로 자동 변환하지 않는다.

