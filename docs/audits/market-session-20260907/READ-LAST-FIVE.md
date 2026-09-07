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
- 이 값은 `현재 가격에서의 가정 조회`로 기록하며 실제 주문 가능성을 일반화하지 않는다. source 가격이 empty, 0, 음수 해석 불가, 종목 불일치 또는 현재성 미확인이면 세 detail을 차단한다.

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
