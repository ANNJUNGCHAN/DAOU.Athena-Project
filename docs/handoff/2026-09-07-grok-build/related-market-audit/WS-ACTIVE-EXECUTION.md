# WS active 단일 종목 실행 준비안

- 작성 기준: `main`/감사 기준 HEAD `ac8452f5b62a338d74826ac27cf65da12d99320b`
- 대상: REAL `0B` 주식체결 한 종목의 `REG → REAL 관찰 → exact REMOVE`
- 이 문서 작성 중 네트워크 호출: **0**. REG, REMOVE, readiness GET, provider read를 실행하지 않았다.
- 2026-09-07 13:12 KST 정적 확인: loopback `127.0.0.1:8010` listener는 존재했고 `python.exe` PID 30248이 소유했다. 이는 readiness/auth/account/WebSocket 준비 증거가 아니다.

## 최소 대상과 fresh 입력

대표 대상은 `0B`와 삼성전자 코드 후보 `005930` 한 개다. `0B`는 장중 체결 이벤트가 비교적 자주 발생하고, request/response 양쪽에 종목 식별자와 체결시각 FID가 있어 등록 ACK뿐 아니라 이벤트 identity/freshness까지 검사할 수 있다.

`005930`은 과거 fixture 상수만으로 사용하지 않는다. 실행 직전에 동일 account runtime으로 다음 typed read를 1회 수행해 당일 실행 입력을 새로 확인한다.

- `POST http://127.0.0.1:8010/api/v1/tr/stockinfo/ka10001/detail/identity_and_capital`
- body: `{"stk_cd":"005930"}`
- 통과 조건: HTTP 2xx, business-error response가 아니며 응답 `stk_cd`가 정확히 `005930`, `stk_nm`이 non-empty.
- 실패/불일치: REG를 보내지 않고 `BLOCKED_FRESH_STOCK_IDENTITY`.
- 응답 가격·자본·이름 원문은 저장하지 않는다. artifact에는 `identity_verified=true/false`, route ID, HTTP class만 남긴다.

이는 generated detail route(`backend/athena_api/generated/routes.py:137-148`), `Ka10001Request.stk_cd`와 identity detail fields(`backend/athena_api/generated/models.py:1234-1243`, `backend/athena_api/generated/registry.py:284`)에 맞는다. ETF/업종/금/ELW까지 넓히지 않는다. 특히 ELW의 과거 코드 `57K123`은 현재 유효성이 확인되지 않았으므로 이 최소 probe 입력에서 제외한다.

## exact route와 body

1. `/ready`, `/ready/accounts`를 loopback safe GET으로 읽는다. default account의 `ready=true`, `websocket=true`를 메모리에서 확인한다. alias 원문은 저장하지 않는다.
2. downstream observer는 `ws://127.0.0.1:8010/api/v1/ws/stream?account=<url-encoded-default-alias>`로 연결하고, local bearer가 있으면 첫 frame으로만 `{"type":"auth","token":"..."}`을 보낸다.
3. control POST에는 같은 alias를 `X-Athena-Account`로 명시한다. route는 `POST /api/v1/websocket/0B`다(`backend/athena_api/generated/routes.py:97-115`).
4. REG body는 다음 exact shape다.

```json
{"trnm":"REG","grp_no":"<run-group>","refresh":"1","data":[{"item":"005930","type":"0B"}]}
```

5. REMOVE는 command만 바꾸고 TR, group, refresh, item, type을 동일하게 유지한다.

```json
{"trnm":"REMOVE","grp_no":"<same-run-group>","refresh":"1","data":[{"item":"005930","type":"0B"}]}
```

Pydantic public body는 `item`/`type` 문자열 한 쌍이다(`backend/athena_api/generated/models.py:199-211`). Runtime은 case-sensitive `type == 0B`를 검사한 뒤 item 목록으로 바꿔 client `register/remove`에 전달한다(`backend/athena_api/generated/runtime.py:123-153`). Client wire 변환은 6자리 종목을 `005930_AL`로 보내고 수신 REAL의 `_AL`/`_NX` suffix는 다시 `005930`으로 정규화한다(`backend/athena_api/kiwoom/ws_client.py:472-502`).

## 소유권과 격리

- 실행마다 CSPRNG로 4자리 숫자 group을 하나 생성한다. 허용 집합은 `1000..9999`; 앱 group `1`과 과거 sweep `80..98`을 재사용하지 않는다.
- group은 REG 전에 artifact의 owned ledger에 기록하고, `refresh="1"`만 허용한다. `refresh="0"`은 같은 group의 다른 lease를 제거할 수 있어 fail-closed 한다.
- owned ledger는 정확히 `{tr_id:"0B", grp_no, item:"005930", type:"0B"}` 한 행만 가진다. REG HTTP 2xx와 normalized `return_code == "0"`일 때만 `registered=true`로 전환한다.
- cleanup은 `finally`에서 ledger의 같은 한 행만 REMOVE한다. group 전체 제거, 빈 item REMOVE, 다른 TR/item 제거, 재시도용 새 group 생성은 금지한다.
- 공개 lease inventory/owner namespace가 없으므로 random group도 충돌 부재를 증명하지 못한다. 결과에는 `ISOLATION_BEST_EFFORT_RANDOM_GROUP`을 유지하고 전수 안전성으로 확대하지 않는다.

Client의 lease key가 TR, group, canonical item/type 조합이고 REMOVE가 같은 TR/group에서 요청 item만 제거한다는 근거는 `backend/athena_api/kiwoom/ws_client.py:337-394,445-469`다.

## 이벤트 identity와 시각 판정

downstream socket은 REG 전에 열고 2초 baseline을 먼저 센다. REG 성공 뒤 최대 20초 동안 다음을 모두 만족하는 첫 row만 probe event로 인정한다.

- envelope가 object이고 `trnm === "REAL"`.
- `data`가 array이고 row `type === "0B"` 대소문자 exact match.
- 정규화된 row `item === "005930"` exact match. type만 같고 item이 다른 이벤트는 기존 lease의 이벤트일 수 있으므로 관찰 성공에 포함하지 않는다.
- FID `20`이 6자리 `HHmmss`이고 실제 KST 시각으로 파싱 가능.
- 수신 wall-clock KST와 FID `20`의 절대 차가 120초 이하. 정규장이라는 실행 전제에서 날짜는 수신일 KST로 결합한다.

판정 축은 분리한다.

- `CONTROL_ACK`: REG HTTP 2xx + normalized return code 0.
- `EVENT_IDENTITY_MATCH`: exact type+item row 1개 이상.
- `EVENT_TIME_SHAPE_VALID`: matching row의 FID `20` 파싱 성공.
- `EVENT_FRESH`: 수신시각과 FID 차이 ≤120초.
- 20초 내 matching row가 없으면 `EVENT_NOT_OBSERVED`; 기능 실패로 자동 승격하지 않는다.

원시 frame, FID 값, 가격, 거래량, 이름, account alias, bearer는 저장하지 않는다. artifact에는 count, boolean 축, 수신 후 경과 ms, freshness 최대차 bucket(`<=5s`, `<=30s`, `<=120s`, `>120s`)만 남긴다. `0B` FID `20` 계약은 `backend/athena_api/generated/models.py:214-270`에 있다.

## 시간·요청 cap

- 전체 hard deadline: 45초.
- ready/accounts + fresh identity read: 각 5초, redirect `error`, body 1 MiB 이하.
- downstream connect: 5초; baseline: 2초; active observation: 최대 20초; close: 3초.
- REG: 1회. REMOVE: 외부 probe 기준 1회만 호출한다. Backend client 내부의 bounded retry/synthetic cleanup 경로는 별도 표기한다.
- WebSocket complete message: 1 MiB 초과 시 close 1009 및 `BLOCKED_OVERSIZE`.
- 어떤 preflight라도 실패하면 REG 0회, REMOVE 0회로 종료한다.

## cleanup ACK 모호성 규칙

REMOVE가 HTTP 2xx와 `return_code == "0"`을 돌려줘도 이를 곧바로 upstream ACK로 기록하지 않는다. Client는 exact local lease를 wire call 전에 제거하고, 두 번의 control 실패 뒤에는 연결이 폐기되어 broker lease가 소켓과 함께 사라졌다는 전제로 synthetic success를 반환할 수 있다(`backend/athena_api/kiwoom/ws_client.py:166-191`). Public response에는 실제 ACK와 synthetic success를 구분하는 provenance가 없다.

- API 0 응답: `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`.
- source invariant: `LOCAL_LEASE_DROPPED_BEFORE_REMOVE_WIRE`.
- 실제 upstream ACK: 항상 `UPSTREAM_REMOVE_ACK_UNVERIFIED`.
- REMOVE HTTP 자체가 timeout/transport error면 `CLEANUP_UNCERTAIN`; 전체 verdict는 PASS가 될 수 없다.
- post-remove 3초 동안 matching event가 와도 in-flight frame이거나 기존 동일 type/item lease일 수 있으므로 cleanup 실패로 단정하지 않는다. 0건이어도 upstream ACK를 증명하지 않는다.

## 기존 SDK 경로 판단

### Python 기존 sweep

`backend/scripts/live_websocket_sweep.py`의 `httpx + websockets` 조합은 현재 설치된 backend Python에서 사용할 수 있고, public REG/REMOVE shape도 맞다. 그러나 파일을 그대로 실행하는 것은 안전하지 않다.

- account `sangsi`, groups `80..98`, targets가 고정돼 있다.
- readiness 원문, account, target/group을 artifact에 저장한다.
- active 본문 전체 19개를 한 번에 등록한다.
- 예외가 REG 이후 발생하면 REMOVE loop에 도달하지 않는 구조이며 cleanup이 `finally`에 있지 않다.
- API 0과 synthetic cleanup을 구분하지 않는다.

따라서 Python 파일은 request-shape 참고용이고 **현재 그대로 실행 불가**다.

### Node 기존 passive probe

`scripts/market-session-audit/ws-passive.mjs`는 이미 사용 중인 app `undici` WebSocket, fixed-loopback 검증, redirect-error 확인, bearer 비저장, 1 MiB frame cap, bounded close, sanitized summary를 제공한다. 다만 현재 helper는 account query를 금지하고, REG/REMOVE controller가 없으며, event summary가 type만 세고 item/FID `20`을 검증하지 않는다.

가장 작은 안전한 구현은 새 active harness에서 다음을 재사용하는 것이다.

- `reconcileWebsocketSources`, bearer parsing, fixed-loopback/timeout/artifact `wx` 패턴.
- app에 설치된 `undici` Agent/WebSocket transport.
- Python sweep의 `control_body` shape만 계약 참고.

새 harness는 socket lifecycle 중간에 REG/REMOVE를 제어하고 exact item/time summarizer와 `finally` cleanup을 가져야 한다. 기존 passive command만으로 active 검사는 수행할 수 없다.

## 지금 실행 가능 여부

판정은 **IMPLEMENTATION_READY / EXECUTION_NOT_YET_READY**다.

- 가능 근거: 13:12 KST에 loopback listener가 있었고, backend Python과 app `undici` 설치 경로가 존재한다. route/model/client 계약도 단일 `0B` probe에 충분하다.
- 남은 실제 blocker: 현재 account readiness/WebSocket readiness/local bearer를 이번 read-only slice에서 호출해 확인하지 않았고, 위 active wrapper와 unit test가 아직 없다.
- wrapper 작성과 독립 검토가 끝나면, 이미 허용된 audit-owned reversible WS 범위 안에서 별도 허가 없이 safe GET → fresh identity read → 한 REG → 관찰 → exact REMOVE 순으로 실행할 수 있다.
- lease inventory 부재와 cleanup ACK provenance 부재는 실행을 전면 금지하는 blocker는 아니지만 각각 `ISOLATION_BEST_EFFORT_RANDOM_GROUP`, `UPSTREAM_REMOVE_ACK_UNVERIFIED`로 남는다.
