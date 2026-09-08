# 마지막 5개 Kiwoom read 입력 경계

기준 revision: `ac8452f5b62a338d74826ac27cf65da12d99320b`

현재 `READ-INPUT-CONTRACTS.md`의 12개 차단 항목 중 동적 선행 조회 7개를 제외한 마지막 5개를 구현·레지스트리·원천 계약까지 다시 추적했다. 기존 문서의 `별도 권한 필요`와 `새 source contract 필요` 결론은 정확하지 않았다. 사용자는 모든 read를 승인했고, 아래 source와 target은 모두 `query` 및 `read_only: true`다. 자동 resolver가 아직 없다는 사실은 입력을 안전하게 선택할 수 없다는 뜻이 아니다.

| operation_ref | 누락 입력 | 실제 의미와 source | 현재 판정 |
| --- | --- | --- | --- | --- |
| `base:ka30003` | `bsis_aset_cd` | ELW 기초자산 코드. 같은 ELW API family의 동일 필드 계약인 `ka30001`, `ka30004`, `ka30005`가 `201` KOSPI200, `150` KOSDAQ150, `005930` 삼성전자, `030200` KT를 명시한다. | `ELIGIBLE_DECLARED_CONTRACT_VALUE` |
| `base:ka10088` | `ord_no` | 같은 계좌의 실제 미체결 주문번호. `base:ka10075`의 `$.oso[*].ord_no`가 직접 source이며, 필요하면 `kt00007` 또는 `kt00009`의 실제 주문번호도 상태를 확인한 뒤 후보로 사용할 수 있다. | `ELIGIBLE_IF_EXISTING_ORDER_OBSERVED` |
| `detail:kt00010:margin_order_capacity` | `uv` | 특정 종목과 매매 방향에서 주문 가능 금액·수량을 계산하는 원 단위 가정 단가. 같은 종목의 `ka10004.sel_fpr_bid` 또는 `ka10001.cur_prc`를 read 시나리오 단가로 사용할 수 있다. | `ELIGIBLE_IF_SAME_SYMBOL_PRICE_OBSERVED` |
| `detail:kt00010:cash_and_withdrawal_capacity` | `uv` | 위 `kt00010` 요청의 동일 가정 단가이며, 이 detail은 같은 응답에서 현금·출금 관련 필드만 투영한다. | `ELIGIBLE_IF_SAME_SYMBOL_PRICE_OBSERVED` |
| `detail:kt00010:purchase_settlement` | `uv` | 위 `kt00010` 요청의 동일 가정 단가이며, 이 detail은 같은 응답에서 매입·정산 필드만 투영한다. | `ELIGIBLE_IF_SAME_SYMBOL_PRICE_OBSERVED` |

## 구현 근거

### `ka10088.ord_no`

- `Ka10088Request`는 7자리 `ord_no` 하나만 요구하고, `Ka10088Response`는 미체결 분할주문 목록을 반환한다([generated model](../../../backend/athena_api/generated/models.py#L3967)).
- `Ka10075ResponseOsoItem`은 동일한 7자리 `ord_no`, 주문상태, 미체결수량, 종목코드를 반환한다([generated model](../../../backend/athena_api/generated/models.py#L3530)). 원천 계약의 안전한 전체 조회 입력은 `all_stk_tp=0`, `trde_tp=0`, `stex_tp=0`이며 `stk_cd`는 생략할 수 있다([inventory](../../../backend/ref/kiwoom-tr-inventory.json#L14197)).
- `ka10075`와 `ka10088`은 registry에서 모두 `query/account`이며([registry](../../../backend/athena_api/generated/registry.py#L147), [registry](../../../backend/athena_api/generated/registry.py#L160)), screen input도 `read_only: true`다([ka10075 screen](../../../backend/ref/kiwoom-screen-definitions.json#L26013), [ka10088 screen](../../../backend/ref/kiwoom-screen-definitions.json#L30743)). 주문 생성·정정·취소 endpoint를 사용할 필요가 없다.
- 계좌 pool은 `X-Athena-Account`로 요청별 data client를 선택한다([dependencies](../../../backend/athena_api/dependencies.py#L48), [account runtime](../../../backend/athena_api/dependencies.py#L82)). source와 target에 같은 명시 alias를 사용하면 같은 계좌 문맥을 유지할 수 있다. alias와 주문번호는 결과 artifact에 저장하지 않는다.
- source가 empty이거나 실제 행의 `ord_no`가 7자리 형식이 아니면 `ka10088`은 데이터 부재로 차단한다. 이는 추가 권한 부족이 아니며, 주문을 새로 만들어 해소하지 않는다.

### `kt00010.uv`

- `Kt00010Request`는 종목번호, 매매구분, `uv`를 필수로 받고 `uv`를 `매수가격 — 단위: 원`으로 정의한다. `trde_qty`, 입출금액, 예상매수단가는 선택 입력이다([generated model](../../../backend/athena_api/generated/models.py#L6452), [inventory](../../../backend/ref/kiwoom-tr-inventory.json#L31107)).
- 응답은 증거금률별 주문 가능 금액·수량, 주문가능현금, 인출가능금액, 매입·정산금 등을 계산한다. 따라서 `uv`는 기존 보유분의 체결가를 증명하는 필드가 아니라 특정 가격에서의 capacity를 질의하는 시나리오 입력이다.
- `base:kt00010`과 세 detail은 registry에서 `QUERY`, account/stock, account context/instrument/side binding으로 분류되고 action은 비어 있다([base routing](../../../backend/athena_api/generated/registry.py#L591), [detail routing](../../../backend/athena_api/generated/registry.py#L700)). 세 detail screen 모두 `read_only: true`이며 같은 `kt00010` 요청을 서로 다른 응답 필드 묶음으로 투영한다([margin](../../../backend/ref/kiwoom-screen-definitions.json#L82063), [cash](../../../backend/ref/kiwoom-screen-definitions.json#L82339), [settlement](../../../backend/ref/kiwoom-screen-definitions.json#L82555)).
- 안전한 감사 시나리오는 명시 종목 하나를 선택하고, 동일 종목의 `ka10004.sel_fpr_bid`를 우선 사용하며 없으면 `ka10001.cur_prc`를 사용한다. 매수 capacity라면 `trde_tp=2`로 고정하고, 관측 가격의 부호·구분자를 제거한 양의 원 단위 정수만 길이 10 안에서 `uv`로 전달한다. source 종목, target 종목, account alias와 관측 시각이 일치해야 한다.
- 이 값은 `현재 가격에서의 가정 조회`로 기록하며 실제 주문 가능성을 일반화하지 않는다. source 가격이 empty, 0, 양의 정수로 정규화할 수 없거나 종목 binding이 다르면 세 detail을 차단한다. source에는 timestamp 계약이 없으므로 응답 수신 시각을 기록하고 현재성은 `NOT_VERIFIED_NO_SOURCE_TIMESTAMP_CONTRACT`로 남긴다. 관측값은 capacity 감사 시나리오에만 사용하며 체결가나 실제 주문 실행 가격으로 해석하지 않는다.

### `ka30003.bsis_aset_cd`

- `Ka30003Request`는 `bsis_aset_cd`와 `base_dt`만 요구하고 operation은 registry에서 `query/elw`다([generated model](../../../backend/athena_api/generated/models.py#L4812), [registry](../../../backend/athena_api/generated/registry.py#L187)). screen은 두 입력만 허용하며 `read_only: true`다([screen](../../../backend/ref/kiwoom-screen-definitions.json#L39259)).
- `ka30003` 자체 설명이 비어 있어도 동일 ELW API family의 동일 이름·길이 필드인 `ka30001`과 `ka30004`가 허용 코드를 명시한다. `ka30004` generated model에도 `전체:000000000000, KOSPI200:201, KOSDAQ150:150, 삼성전자:005930, KT:030200`가 그대로 보존되어 있다([model](../../../backend/athena_api/generated/models.py#L4839), [inventory](../../../backend/ref/kiwoom-tr-inventory.json#L21679)).
- 따라서 `005930`처럼 계약에 명시되고 기존 종목 master에서도 확인되는 기초자산 코드는 임의 ID가 아니다. `base_dt`는 실행 시점 KST 현재일을 사용한다. 결과가 empty이면 데이터 부재로 기록하며 다른 값을 반복 추측하지 않는다.

## 현재 승인 범위에서의 실행 가능성

| 대상 | 현재 승인만으로 입력 선택 가능 여부 | 실행 전 동적 조건 |
| --- | --- | --- |
| `ka30003` | 가능 | 동일 ELW family의 선언값 하나와 현재 KST 기준일을 고정하고 원천 계약 drift를 검사한다. |
| `ka10088` | 가능 | 같은 account alias의 read-only 주문 조회에서 실제 미체결 `ord_no`가 관측되어야 한다. empty이면 target을 호출하지 않는다. |
| `kt00010` 세 detail | 가능 | 같은 account alias·종목·시점의 read-only 호가/현재가에서 유효한 양의 `uv`가 관측되어야 한다. |

기존 authorization은 이 read chain을 설계·실행하기에 충분하다. 필요한 것은 별도 사용자 권한이나 주문 생성이 아니라 exact source contract, 같은 계좌·종목 binding, 값 비저장, empty fail-closed를 구현한 안전한 체인과 독립 검토다. 이 문서 수정 과정에서는 실제 네트워크 호출, credential 접근, 주문/OAuth 동작, 사용자 상태 변경을 수행하지 않았다.

## 구현된 실행 전 probe

`scripts/market-session-audit/read-final-inputs.mjs`는 위 5개 target만 닫기 위한 opt-in probe다. 기본 실행은 dry-run이며 `--execute`가 없으면 네트워크와 credential을 전혀 읽지 않는다. 실제 실행 경로도 다음 경계를 먼저 모두 통과해야 한다.

- base URL은 정확히 `http://127.0.0.1:8010`만 허용한다.
- inventory, common-screen manifest, screen definition의 query/read-only/input allowlist/응답 JSONPath를 고정값과 대조한다.
- `/openapi.json`의 exact path, operation ID, TR ID, required fields, 전체 request properties를 대조한다.
- `/ready/accounts`에서 명시 alias 또는 default alias가 ready임을 확인한 뒤에만 child process의 bearer token을 읽는다. source와 target 요청은 모두 같은 `X-Athena-Account` 값을 사용한다.
- business request는 최대 8회, 각 요청은 최대 5초, 전체는 최대 60초다. business response는 1 MiB, OpenAPI는 8 MiB를 넘으면 차단한다.
- source 또는 target 어느 단계에서든 HTTP 401/403이 관측되면 이후 business request를 모두 중단하고 남은 target은 `AUTH_FAILURE_NOT_ATTEMPTED`로 기록한다.
- `ka10075`에 실제 7자리 `ord_no`와 양의 `oso_qty`가 없으면 `ka10088`을 호출하지 않는다. 주문 생성·정정·취소로 입력을 만들지 않는다.
- `ka10004.sel_fpr_bid`를 우선 사용하고 유효값이 없을 때만 `ka10001.cur_prc`를 한 번 조회한다. 정규화한 양의 10자리 이하 원 단위 값은 메모리에서 `kt00010` 세 detail의 명시적 가정 단가로만 쓴다.
- artifact에는 account alias, 주문번호, 관측 가격, token, provider message/body/cursor를 저장하지 않는다. base target PASS는 HTTP 성공, JSON object, `return_code=0`, 선언된 root 존재까지만 뜻한다. detail projection은 성공 응답에서 `return_code`를 노출하지 않으므로 HTTP 성공, JSON object, 선언된 field 존재를 검사하고 `returnCode=NOT_EXPOSED_BY_DETAIL_PROJECTION`으로 기록한다. pagination과 가격 freshness는 검증하지 않는다.

`scripts/market-session-audit/read-final-inputs.test.mjs`는 실제 네트워크 대신 fake fetch와 임시 출력 디렉터리를 사용해 contract drift, unsafe route, OpenAPI drift, 계좌 일치, 빈 주문 이력, 가격 fallback, 인증 실패, 요청·시간·응답 크기 예산, redaction, 주문 side effect 부재를 검사한다.

## 14:04 최초 실제 실행과 판정 정정

독립 검토 승인 후 root가 2026-09-07 14:04 KST에 한 번 실행했고 기존 위치의 `artifacts/market-session-audit/read-final-inputs-20260907140429KST.json`을 생성했다. 이 artifact는 보존하며 덮어쓰거나 이동하지 않는다.

- metadata 2회와 business 4회가 실행됐다.
- `ka10075`는 HTTP 200, `return_code=0`이었지만 미체결 행이 없어 `ka10088`을 호출하지 않았다.
- `ka30003`은 HTTP 200, JSON object, `return_code=0`, 선언 root 존재를 확인해 이 실행에서 유일한 target PASS였다.
- 두 가격 detail은 HTTP 200과 선언 가격 field를 반환했지만 최초 harness가 `return_code` 부재를 오류로 분류해 세 `kt00010` target을 호출하지 않았다.
- 최초 artifact의 `revision`이 `null`이라 coverage revision guard에도 바로 사용할 수 없다.

가격 detail의 `return_code` 부재는 provider 실패 증거가 아니다. 생성 runtime은 upstream business code가 0이 아니면 원문 envelope를 HTTP 200으로 반환하고, 성공 detail이면 detail response model alias만 투영한다. 해당 detail model에는 `return_code`가 없어 성공 응답에서 제거된다([generated runtime](../../../backend/athena_api/generated/runtime.py#L89), [projection filter](../../../backend/athena_api/generated/runtime.py#L99), [business result branch](../../../backend/athena_api/generated/runtime.py#L96)). `Ka10004SellBidPricesResponse`와 `Ka10001CurrentTradingResponse`도 가격 field만 선언한다([ask projection](../../../backend/athena_api/generated/models.py#L7480), [current-price projection](../../../backend/athena_api/generated/models.py#L7411)).

수정된 harness는 이 runtime 계약을 다음과 같이 구분한다.

- 성공 detail projection: `return_code` 없음 + 선언 field 존재
- upstream business 실패 또는 projection 계약 drift: `return_code`가 노출된 detail 응답
- 빈 projection: 선언 field가 없으므로 source/target 차단
- base 응답: 기존처럼 `return_code=0` 필수

각 business 결과에는 실제 요청 시각과 KST market phase를 기록한다. CLI가 생성하는 artifact에는 현재 Git HEAD를 자동으로 기록하며, 새 기본 출력 위치는 날짜 디렉터리 `artifacts/market-session-audit/2026-09-07`이다. 최초 실행에서 유효하게 추가된 `ka30003`만 포함한 당시 read coverage는 260/264였다.

## 14:22 수정 harness 실제 재실행

독립 재검토 승인 후 root가 수정 harness를 2026-09-07 14:22 KST에 한 번 실행했다. 새 artifact는 `artifacts/market-session-audit/2026-09-07/read-final-inputs-20260907142216KST.json`이며 SHA-256은 `5E509C64944954714AD3947AC2137F0A83A8D91D1D94FB0C490475ED0BB88EA2`다.

실행 전 root가 확인한 상태는 다음과 같다.

- Git HEAD: `ac8452f5b62a338d74826ac27cf65da12d99320b`
- loopback listener PID: `13080`
- listener 생성 시각: `2026-09-07T04:56:59.507584Z`
- parent PID: `37764`
- 원본 runtime에는 `card_surface_contract.py`, `templates.py`의 production diff가 있었으나 독립 dependency 검토에서 이번 generated read와 WebSocket 경로에는 영향을 주지 않는 것으로 판정됐다.

이 preflight는 실행한 read 경로와 listener의 일치성을 위한 제한된 확인이다. 사용자 원본 runtime 전체가 깨끗한 baseline이었다는 증거로 확대하지 않는다.

### 실제 결과

| operation_ref | 시도 | 관찰 | 판정 |
| --- | ---: | --- | --- |
| `base:ka10088` | 아니오 | 같은 계좌의 `ka10075`가 HTTP 200, `return_code=0`이었으나 사용할 수 있는 기존 미체결 주문이 없었음 | `BLOCKED_NO_EXISTING_UNFILLED_ORDER` |
| `detail:kt00010:margin_order_capacity` | 예 | HTTP 200, 노출된 `return_code=20` | `BLOCKED_BUSINESS_RESULT` |
| `detail:kt00010:cash_and_withdrawal_capacity` | 예 | HTTP 200, 노출된 `return_code=20` | `BLOCKED_BUSINESS_RESULT` |
| `detail:kt00010:purchase_settlement` | 예 | HTTP 200, 노출된 `return_code=20` | `BLOCKED_BUSINESS_RESULT` |
| `base:ka30003` | 예 | HTTP 200, `return_code=0`, 선언 root 존재 | `PASS_HTTP_JSON_DECLARED_ROOT_PRESENT` |

가격 source `detail:ka10004:sell_bid_prices`는 HTTP 200, 선언 가격 field 존재, `return_code=NOT_EXPOSED_BY_DETAIL_PROJECTION`으로 정상 처리됐다. 관측 가격은 artifact에 저장하지 않았으며 같은 계좌·종목의 세 capacity 시나리오 입력으로 메모리에서만 사용했다. source timestamp 계약이 없으므로 가격 freshness는 계속 `NOT_VERIFIED_NO_SOURCE_TIMESTAMP_CONTRACT`다.

요약은 target 5개 중 4개 시도, 1개 PASS, 4개 BLOCKED다. metadata 2회와 business 6회가 실행됐으며 설정된 최대 8회를 넘지 않았다. `return_code=20`인 세 detail은 정상 projection 성공으로 간주하지 않았고 provider 메시지나 원문 body도 저장하지 않았다. pagination은 세 detail과 `ka30003` 모두 `NOT_VERIFIED_SINGLE_PAGE`다.

이 재실행으로 실제 시도된 고유 read 합집합은 **263/264**가 됐다. 이는 PASS 수가 아니라 provider까지 실제 요청한 operation ID의 합집합이다. 유일한 미시도 read는 실제 기존 미체결 주문번호가 없어 호출하지 않은 `ka10088`이며, 입력을 만들기 위한 주문 생성·정정·취소는 수행하지 않았다.
