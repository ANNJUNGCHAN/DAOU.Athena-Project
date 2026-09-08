# WS active 단일 종목 실행 준비안

- 작성 기준: `main`/감사 기준 HEAD `ac8452f5b62a338d74826ac27cf65da12d99320b`
- 대상: REAL `0B` 주식체결 한 종목의 `REG → REAL 관찰 → exact REMOVE`
- 최초 문서 작성과 구현/mock 회귀 단계의 네트워크 호출은 **0**이었다.
- 독립 검토 승인 뒤 2026-09-07 14:28 KST에 최초 active probe를 실행했고, parser 수정과 재검토 뒤 14:46 KST에 bounded 재검사를 1회 실행했다. 이 문서 갱신 과정에서는 추가 네트워크 호출을 하지 않았다.
- 2026-09-07 13:12 KST 정적 확인: loopback `127.0.0.1:8010` listener는 존재했고 `python.exe` PID 30248이 소유했다. 이는 readiness/auth/account/WebSocket 준비 증거가 아니다.

## 최소 대상과 fresh 입력

대표 대상은 `0B`와 삼성전자 코드 후보 `005930` 한 개다. `0B`는 장중 체결 이벤트가 비교적 자주 발생하고, request/response 양쪽에 종목 식별자와 체결시각 FID가 있어 등록 ACK뿐 아니라 이벤트 identity/freshness까지 검사할 수 있다.

`005930`은 과거 fixture 상수만으로 사용하지 않는다. 실행 직전에 동일 account runtime으로 다음 typed read를 1회 수행해 당일 실행 입력을 새로 확인한다.

- `POST http://127.0.0.1:8010/api/v1/tr/stockinfo/ka10001/detail/identity_and_capital`
- body: `{"stk_cd":"005930"}`
- 통과 조건: HTTP 2xx, business-error response가 아니며 응답 `stk_cd`가 정확히 `005930`, `stk_nm`이 non-empty.
- 정상 detail 응답은 projection model의 필드만 남기므로 `return_code`가 없다(`backend/athena_api/generated/runtime.py:99-105`). 이 경우 `NOT_EXPOSED_BY_DETAIL_PROJECTION`으로 기록하며 0을 만들어내지 않는다.
- upstream business result는 detail projection 전에 HTTP 200 원문 envelope로 반환된다(`backend/athena_api/generated/runtime.py:56-64,96-97`). `return_code`가 실제로 노출되면 normalized 0만 허용하고 nonzero는 `NONZERO_EXPOSED`와 `BLOCKED_FRESH_STOCK_IDENTITY_BUSINESS_ERROR`로 REG 전에 차단한다.
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
- owned ledger는 정확히 `{tr_id:"0B", grp_no, item:"005930", type:"0B"}` 한 행만 가진다. REG transport dispatch 직전에 `reg_may_have_reached_upstream=true`로 전환한다. HTTP 2xx와 normalized `return_code == "0"`은 별도 `CONTROL_ACK`로 기록한다.
- REG dispatch 뒤에는 응답 유실·timeout·business rejection을 포함한 모든 경로에서 `finally`가 ledger의 같은 한 행을 REMOVE한다. group 전체 제거, 빈 item REMOVE, 다른 TR/item 제거, 재시도용 새 group 생성은 금지한다.
- 공개 lease inventory/owner namespace가 없으므로 random group도 충돌 부재를 증명하지 못한다. 결과에는 `ISOLATION_BEST_EFFORT_RANDOM_GROUP`을 유지하고 전수 안전성으로 확대하지 않는다.

Client의 lease key가 TR, group, canonical item/type 조합이고 REMOVE가 같은 TR/group에서 요청 item만 제거한다는 근거는 `backend/athena_api/kiwoom/ws_client.py:337-394,445-469`다.

## 이벤트 identity와 시각 판정

downstream socket은 REG 전에 열고 2초 baseline을 먼저 센다. REG 성공 뒤 최대 20초 동안 다음을 모두 만족하는 첫 row만 probe event로 인정한다.

- envelope가 object이고 `trnm === "REAL"`.
- `data`가 array이고 row `type === "0B"` 대소문자 exact match.
- 정규화된 row `item === "005930"` exact match. type만 같고 item이 다른 이벤트는 기존 lease의 이벤트일 수 있으므로 관찰 성공에 포함하지 않는다.
- row의 `values` object 안 FID `20`이 문자열 6자리 `HHmmss`이고 실제 KST 시각으로 파싱 가능.
- 수신 wall-clock KST와 FID `20`의 절대 차가 120초 이하. 정규장이라는 실행 전제에서 날짜는 수신일 KST로 결합한다.

판정 축은 분리한다.

- `CONTROL_ACK`: REG HTTP 2xx + normalized return code 0.
- `EVENT_IDENTITY_MATCH`: exact type+item row 1개 이상.
- `EVENT_TIME_SHAPE_VALID`: matching row의 FID `20` 파싱 성공.
- `EVENT_FRESH`: 수신시각과 FID 차이 ≤120초.
- 20초 내 유효 matching row가 없으면 `BLOCKED_NO_LIVE_EVENT`로 끝낸다. REG ACK만으로 실시간 기능 통과를 선언하지 않는다.

원시 frame, FID 값, 가격, 거래량, 이름, account alias, bearer는 저장하지 않는다. artifact에는 count, boolean 축, 수신 후 경과 ms, freshness 최대차 bucket(`<=5s`, `<=30s`, `<=120s`, `>120s`)만 남긴다. FID 구조 진단도 `values` object 여부, nested `20` 존재 여부, 값 type/길이/digit/range와 top-level `20` key 존재 횟수만 센다.

backend fan-out은 REAL row의 item suffix만 정규화하고 row 구조는 flatten하지 않는다(`backend/athena_api/kiwoom/ws_client.py:274-276,493-502`). 실제 제품 회귀 fixture도 `{"type":"0B","item":"005930","values":{"10":...,"12":...,"228":...}}` 구조를 사용한다(`backend/tests/unit/test_routines_scheduler.py:151-165`). 따라서 FID `20`의 런타임 위치는 `row.values["20"]`이며, generated model의 top-level alias 설명만으로 `row["20"]`을 읽으면 안 된다.

## 14:28 실제 실행과 parser 진단

artifact `artifacts/market-session-audit/2026-09-07/ws-active-stock-20260907T052815-996Z.json`에 다음 사실이 기록됐다.

- REG 1회 `CONTROL_ACK`; exact REMOVE 1회 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`; upstream REMOVE ACK는 미검증.
- probe 소유 downstream socket 종료 완료.
- REAL envelope 159개, wrong type 0, wrong item 0, 기존 parser 기준 invalid time 288, valid 0.
- 기존 verdict `BLOCKED_NO_LIVE_EVENT`는 실제 무이벤트를 뜻하지 않는다. exact type/item row는 도착했지만 harness가 `row["20"]`을 읽어 nested `row.values["20"]`을 놓친 parser 오류였다.

수정 후에는 exact type/item row 수를 `matching_row`로 별도 기록한다. matching row가 있지만 strict FID shape/freshness를 통과하지 못하면 `BLOCKED_LIVE_EVENT_TIME_INVALID_OR_STALE`, matching row 자체가 0일 때만 `BLOCKED_NO_LIVE_EVENT`다. 과거 artifact는 덮어쓰거나 PASS로 재작성하지 않는다.

## 14:46 bounded 재검사

parser 수정의 독립 재검토 승인 뒤 `artifacts/market-session-audit/2026-09-07/ws-active-stock-20260907T054609-218Z.json`을 생성했다. SHA-256은 `787EBF412E934E8DEB8D94AF06A371D81A3065974098FE3CD3669FCF713CEB4B`다.

- 실행 직전 preflight 시각: `2026-09-07T05:46:08.232Z`.
- 실행 backend PID 41172, parent PID 39728, backend process creation `2026-09-07T05:23:43.551737Z`.
- 감사 probe source revision은 `ac8452f5b62a338d74826ac27cf65da12d99320b`. 원본 runtime의 별도 canvas/card 변경은 실행 전 독립 provenance 검토를 거쳤다.
- REG 1회 `CONTROL_ACK`; exact REMOVE 1회 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`; upstream REMOVE ACK는 계속 미검증.
- probe 소유 downstream socket 종료 완료.
- REAL envelope 23개. REG 전 baseline exact matching row 42개가 있었고, REG 뒤 exact matching row 1개가 nested FID `20` 형식과 freshness를 통과했다. freshness bucket은 `<=5s`, invalid time 0, stale 0이다.
- verdict는 `PASS_WITH_CLEANUP_UNVERIFIED`다.

이 결과가 증명하는 범위는 동일 종목·타입의 fresh 실시간 데이터 관찰, probe의 REG control ACK, exact REMOVE API 0 응답, owned socket cleanup이다. REG 전에 이미 42개 matching row가 들어왔으므로 REG 뒤 fresh row가 이번 REG 때문에 발생했다고 단정할 수 없고, 같은 identity의 기존 lease나 다른 subscriber가 없었다고도 증명하지 않는다. 또한 cleanup 응답 provenance가 없어 upstream REMOVE ACK도 증명하지 않는다. 이 단일 `0B` 결과를 나머지 22개 WebSocket source의 통과로 확대하지 않는다.

## 시간·요청 cap

- 전체 hard deadline: 45초. 이 안에서 REMOVE 5초와 owned socket close 3초, 합계 8초를 REG/관찰 전에 선예약한다.
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

## 구현된 실행 경로

신규 `scripts/market-session-audit/ws-active-stock.mjs`가 위 계약을 구현한다. 기본 모드는 `DRY_RUN`이며 `--execute`가 있어야 safe GET, identity read, REG, 관찰, REMOVE를 수행한다.

- source inventory는 기존 `ws-passive.mjs`의 `reconcileWebsocketSources`를 재사용해 23개 exact-set 일치를 먼저 확인한다.
- control 요청은 외부 기준 REG 1회와 REMOVE 1회만 허용하며, reconnect를 시도하지 않는다.
- REG dispatch 이후 모든 종료 경로에서 `finally`가 같은 `{0B, group, 005930}` lease만 REMOVE하고 probe가 만든 downstream socket과 dispatcher만 닫는다. close ACK 대기와 dispatcher destroy는 합산 3초의 같은 절대 deadline을 공유한다.
- credential은 `ATHENA_LOCAL_BEARER_TOKEN` 프로세스 환경변수를 우선 사용한다. 이 값이 없을 때만 현재 worktree의 `backend/.env`를 읽는다. token과 account alias는 artifact에 기록하지 않는다.
- `scripts/market-session-audit/ws-active-stock.test.mjs`는 redirect, projected detail 성공(code 미노출), HTTP 200 business error, fresh identity 불일치, auth 1008, reconnect 금지, 무이벤트, wrong type/item, nested `values["20"]`, strict time-shape category, invalid/stale time, API 0 cleanup 모호성, REMOVE transport 실패, REG 응답 유실, operation deadline 소진, owned socket teardown, exact REG/REMOVE body를 mock transport로 검사한다.

검토 전 안전 검증 명령은 다음과 같다. 첫 명령은 네트워크를 사용하지 않는다. 두 번째 명령도 mock transport만 사용한다.

```powershell
node --check scripts/market-session-audit/ws-active-stock.mjs
node --test scripts/market-session-audit/ws-active-stock.test.mjs
```

실제 실행 adapter는 credential 파일을 새 worktree에 만들지 않고, 기존 승인 저장소에서 현재 child process에만 환경변수를 주입한 뒤 다음 command를 호출해야 한다.

```powershell
$env:ATHENA_LOCAL_BEARER_TOKEN = <authorized-process-secret>
node scripts/market-session-audit/ws-active-stock.mjs --execute
Remove-Item Env:ATHENA_LOCAL_BEARER_TOKEN
```

두 번째 줄의 live command는 독립 검토 전 실행하지 않는다. 프로브 artifact에는 token, alias, 원시 frame, FID 원문, 가격, 이름이 남지 않는다.

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

판정은 **BOUNDED_0B_PROBE_PASS_WITH_LIMITATIONS**다.

- 가능 근거: 감사 branch/HEAD `ac8452f5b62a338d74826ac27cf65da12d99320b`의 격리 worktree에서 wrapper와 mock 회귀를 구현했다. backend Python과 app `undici` 설치 경로, route/model/client 계약도 단일 `0B` probe에 충분하다.
- 2026-09-07 parser 수정 후 회귀: `node --check` 통과, `node --test scripts/market-session-audit/ws-active-stock.test.mjs` 20/20 통과.
- 14:46 실행에서 `/ready`, `/ready/accounts`, fresh identity가 통과했고, exact REG/관찰/REMOVE와 owned socket cleanup이 위 제한 안에서 완료됐다.
- 추가 재실행은 이 단일 성공을 반복하는 것만으로 새로운 source 범위를 닫지 못하므로 현재 결과에 포함하지 않는다.
- lease inventory 부재와 cleanup ACK provenance 부재는 실행을 전면 금지하는 blocker는 아니지만 각각 `ISOLATION_BEST_EFFORT_RANDOM_GROUP`, `UPSTREAM_REMOVE_ACK_UNVERIFIED`로 남는다.
