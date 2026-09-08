# Kiwoom read 16개 입력 계약 검토

## 범위와 판정 원칙

- 대상은 [INPUT-RESOLUTION.md](./INPUT-RESOLUTION.md)의 Kiwoom read `BLOCKED_INPUT` 16개와 정확히 일치한다.
- 원천은 `backend/ref/kiwoom-tr-inventory.json`의 요청·응답 필드 계약과 `backend/ref/kiwoom-screen-definitions.json`의 `read_display` operation 및 응답 경로다. 테스트 fixture나 과거 응답값을 허용값의 근거로 사용하지 않았다.
- 명시된 enum, 입력 단위와 길이 안의 최소 양수처럼 부작용 없는 조회 조건만 고정 후보로 인정한다.
- 그룹·회원사·테마·ETF 지수 식별자는 선언된 선행 조회 응답 경로에서 이번 세션에 실제 값이 관측된 뒤에만 사용한다. 이 문서에는 실제 식별자 값이 없다.
- 주문번호와 계좌 매수가격은 권한·주문·계좌 의미가 붙은 값이다. 예시나 시세를 대신 넣지 않는다. 주문·발급·등록·수정 호출은 후속안에서도 제외한다.

## 결론

| 분류 | operation 수 | 처리 |
|---|---:|---|
| 계약으로 즉시 해소 가능 | 4 | `tm=1`, `tm_tp=1`, `prpscnt=1`을 각 필드 의미에 맞게 사용 가능 |
| 실제 선행 read 결과 필요 | 7 | 그룹 1, 회원사 4, ETF 지수 1, 테마 1 |
| 원천 응답 경로 없음 | 1 | ELW 기초자산 코드는 대상 operation의 빈 설명을 다른 operation 예시로 대체하지 않음 |
| 권한·주문·계좌 의미 확인 필요 | 4 | 주문번호 1, 매수가격 `uv` 3 |

즉시 해소 가능한 4개를 적용하면 안전 입력 적격 read는 248개에서 252개로 늘어날 수 있다. 나머지 12개는 실제 값 또는 별도 권한·의미 확인 전까지 `BLOCKED_NO_SAFE_INPUT`을 유지한다.

## 실행 준비 및 결과 상태

- `read-sweep.mjs`에 네 operation 전용 규칙을 구현했다. 전역 필드 fallback은 추가하지 않았으며 operation ID, 필드명, 필수 여부, 길이, 설명이 아래 원천 계약과 모두 일치할 때만 값이 생성된다.
- provenance는 `ka10019_contract_one_minute`, `ka10021_contract_one_minute`, `ka10022_contract_one_minute`, `ka10025_contract_minimum_positive_count`로 구분된다.
- authoritative registry preflight 결과는 source 264, 안전 입력 적격 252, 차단 12다. 동적 ID 7개, `ord_no` 1개, `uv` 3개, ELW 기초자산 1개는 계속 차단된다.
- 독립 안전 검토 후 네 operation만 선택 실행했다. 아티팩트는 `artifacts/market-session-audit/2026-09-07/read-sweep-20260907T102242KST.json`이며, source 264, selected 4, attempted 4로 기록됐다.
- 네 operation은 모두 실제 `REGULAR` 단계에서 HTTP 200, business code 0을 받았다. `ka10019`와 `ka10021`은 pagination 미완주, `ka10022`는 현재성 미확인, `ka10025`는 `DATA_ABSENT`로 판정됐다. `DATA_ABSENT`는 현재 mock API와 조회 조건에서 정상 empty일 수 있어 제품 불량으로 확정하지 않는다.
- 이 실행으로 실제 정규장 read 고유 범위는 252개가 됐다. 입력 차단 12개는 그대로 남는다.

## 16개 operation별 계약

| # | operation_ref | 누락 필드 | 원천 계약과 허용값 증거 | 분류 | 후속 실행안 |
|---:|---|---|---|---|---|
| 1 | [`base:ka01301`](../../../backend/ref/kiwoom-screen-definitions.json#L4515) | `arn_grp_id` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L43764)은 `ka01300` 응답의 `gcod`를 요구한다. 선행 [`base:ka01300`](../../../backend/ref/kiwoom-screen-definitions.json#L4309)은 입력이 없고, 선언 응답 경로는 [`$.nofi[*].gcod`](../../../backend/ref/kiwoom-screen-definitions.json#L4199)다. 실제 `gcod`는 아직 확보하지 않았다. | 실제 선행 read 필요 | `base:ka01300`을 읽기 전용으로 실행해 non-empty `gcod`가 관측될 때만 그 값을 `arn_grp_id`로 전달한다. 결과가 비면 계속 차단한다. |
| 2 | [`base:ka10019`](../../../backend/ref/kiwoom-screen-definitions.json#L9662) | `tm` | [`tm` 요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L5275)은 길이 2의 분 또는 일 입력이며, 같은 요청의 [`tm_tp` 계약](../../../backend/ref/kiwoom-tr-inventory.json#L5266)은 `1:분전, 2:일전`이다. `tm_tp=1`, `tm=1`은 계약상 1분 전이라는 최소 양수 조회 조건이다. | 즉시 해소 가능 | source-backed 입력 규칙에 `tm_tp=1`, `tm=1`을 함께 고정하고 이 operation만 dry-run으로 payload 근거를 확인한 뒤 선택 read로 실행한다. |
| 3 | [`base:ka10021`](../../../backend/ref/kiwoom-screen-definitions.json#L10271) | `tm_tp` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L5660)은 길이 2의 `분 입력`이다. 값 `1`은 가장 작은 양수 분 조건이며 읽기 범위만 줄인다. | 즉시 해소 가능 | `tm_tp=1`을 계약 기반 고정 입력으로 추가하고 dry-run에서 해당 필드의 source evidence를 확인한 뒤 선택 read로 실행한다. |
| 4 | [`base:ka10022`](../../../backend/ref/kiwoom-screen-definitions.json#L10575) | `tm_tp` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L5830)은 길이 2의 `분 입력`이다. 값 `1`은 가장 작은 양수 분 조건이며 읽기 범위만 줄인다. | 즉시 해소 가능 | `tm_tp=1`을 계약 기반 고정 입력으로 추가하고 dry-run에서 해당 필드의 source evidence를 확인한 뒤 선택 read로 실행한다. |
| 5 | [`base:ka10025`](../../../backend/ref/kiwoom-screen-definitions.json#L11503) | `prpscnt` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L6349)은 길이 2의 숫자 입력이다. 값 `1`은 최소 양수 매물대 수로서 결과 범위를 가장 작게 제한한다. | 즉시 해소 가능 | `prpscnt=1`을 계약 기반 고정 입력으로 추가하고 dry-run에서 근거를 확인한 뒤 선택 read로 실행한다. |
| 6 | [`base:ka10039`](../../../backend/ref/kiwoom-screen-definitions.json#L16183) | `mmcm_cd` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L8873)은 회원사 코드를 `ka10102`에서 조회하도록 명시한다. 선행 [`base:ka10102`](../../../backend/ref/kiwoom-screen-definitions.json#L33705)의 선언 경로는 [`$.list[*].code`](../../../backend/ref/kiwoom-screen-definitions.json#L33598)다. 실제 code는 아직 없다. | 실제 선행 read 필요 | 입력 없는 `base:ka10102`를 먼저 조회하고 관측된 non-empty code 하나를 사용한다. 임의 증권사 코드는 금지한다. |
| 7 | [`base:ka10043`](../../../backend/ref/kiwoom-screen-definitions.json#L16675) | `mmcm_cd` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L9734)은 `ka10102` 회원사 코드를 요구한다. 허용값의 선언 경로는 [`$.list[*].code`](../../../backend/ref/kiwoom-screen-definitions.json#L33598)이며 실제 값은 아직 없다. | 실제 선행 read 필요 | `base:ka10102`의 실제 non-empty code를 받은 뒤 기존 안전한 종목·기간 조건과 함께 전달한다. |
| 8 | [`base:ka10052`](../../../backend/ref/kiwoom-screen-definitions.json#L19330) | `mmcm_cd` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L10923)은 `ka10102` 조회값을 요구한다. 허용값의 선언 경로는 [`$.list[*].code`](../../../backend/ref/kiwoom-screen-definitions.json#L33598)이며 실제 값은 아직 없다. | 실제 선행 read 필요 | `base:ka10102`에서 관측한 code만 전달한다. 선행 결과가 empty 또는 현재성 미확인이면 종속 호출을 차단한다. |
| 9 | [`base:ka10078`](../../../backend/ref/kiwoom-screen-definitions.json#L27077) | `mmcm_cd` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L14907)은 `ka10102` 조회값을 요구한다. 허용값의 선언 경로는 [`$.list[*].code`](../../../backend/ref/kiwoom-screen-definitions.json#L33598)이며 실제 값은 아직 없다. | 실제 선행 read 필요 | `base:ka10102`에서 관측한 code를 기존 안전 종목·기간 입력과 결합한다. 값을 문서나 로그에 원문으로 남기지 않는다. |
| 10 | [`base:ka10088`](../../../backend/ref/kiwoom-screen-definitions.json#L30743) | `ord_no` | [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L16841)은 실제 7자리 주문번호를 요구한다. 고정 enum이나 안전한 예시가 아니며, 주문 생성·계좌 주문 흐름은 이번 read 감사의 권한 밖이다. | 권한·주문 의미 확인 필요 | 기존 미체결 주문번호를 사용할 별도 권한과 데이터 보존 정책이 승인될 때만 재검토한다. 주문을 새로 만들거나 번호를 추측하지 않는다. |
| 11 | [`base:ka30003`](../../../backend/ref/kiwoom-screen-definitions.json#L39259) | `bsis_aset_cd` | 대상 [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L21556)의 설명은 비어 있다. 관련 `ka30001` 요청에는 [KOSPI200 `201` 등의 예시](../../../backend/ref/kiwoom-tr-inventory.json#L21252)가 있지만, 저장소의 read 정의에는 `bsis_aset_cd` 응답 경로가 없다. 다른 operation의 요청 예시를 이 operation의 허용값으로 전이하지 않는다. | 원천 응답 경로 없음 | `ka30003` 자체 또는 공통 ELW 기초자산 코드 계약이 명시될 때까지 차단한다. 실제 read 응답 경로가 추가되면 관측값만 사용한다. |
| 12 | [`base:ka40001`](../../../backend/ref/kiwoom-screen-definitions.json#L41528) | `etfobjt_idex_cd` | 대상 [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L23358)은 코드 설명이 비어 있다. 선행 [`base:ka40007`](../../../backend/ref/kiwoom-screen-definitions.json#L43313)은 [길이 6의 ETF 종목코드](../../../backend/ref/kiwoom-tr-inventory.json#L24118)로 조회하며 선언 응답 경로는 [`$.etfobjt_idex_cd`](../../../backend/ref/kiwoom-screen-definitions.json#L43214)다. 실제 지수 코드는 아직 없다. | 실제 선행 read 필요 | 감사의 명시 seed `069500`으로 `base:ka40007`을 조회해 non-empty 지수 코드가 관측될 때만 같은 ETF의 `ka40001` 입력으로 전달한다. |
| 13 | [`base:ka90002`](../../../backend/ref/kiwoom-screen-definitions.json#L49433) | `thema_grp_cd` | 대상 [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L26610)은 실제 테마그룹코드 번호를 요구한다. 선행 [`base:ka90001`](../../../backend/ref/kiwoom-screen-definitions.json#L49067)의 안전 입력은 [`qry_tp=0`](../../../backend/ref/kiwoom-tr-inventory.json#L26440), [`date_tp=1`](../../../backend/ref/kiwoom-tr-inventory.json#L26458), [`flu_pl_amt_tp=1`](../../../backend/ref/kiwoom-tr-inventory.json#L26476), [`stex_tp=1`](../../../backend/ref/kiwoom-tr-inventory.json#L26485)로 계약에 명시돼 있고, 응답 경로는 [`$.thema_grp[*].thema_grp_cd`](../../../backend/ref/kiwoom-screen-definitions.json#L48869)다. 실제 코드는 아직 없다. | 실제 선행 read 필요 | 위 명시 계약값으로 `ka90001`을 조회하고 관측된 non-empty 테마 코드만 전달한다. |
| 14 | [`detail:kt00010:margin_order_capacity`](../../../backend/ref/kiwoom-screen-definitions.json#L82063) | `uv` | 공통 `kt00010` [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L31154)은 단위가 원인 `매수가격`을 요구한다. 단순 종목 시세와 동일하다는 계약이 없고 계좌의 주문가능금액 의미에 영향을 준다. | 권한·계좌 의미 확인 필요 | 계좌 감사 권한, 매매구분, 가격 기준 정책이 승인되고 검증된 매수가격이 있을 때만 실행한다. 현재가를 임의 대입하지 않는다. |
| 15 | [`detail:kt00010:cash_and_withdrawal_capacity`](../../../backend/ref/kiwoom-screen-definitions.json#L82339) | `uv` | 공통 `kt00010` [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L31154)의 `uv`는 원 단위 매수가격이다. 출금가능금액 표시에 직접 영향을 주므로 일반 quote를 의미 검증 없이 사용할 수 없다. | 권한·계좌 의미 확인 필요 | 계좌 소유자의 조회 권한과 가격 기준을 확인하고 승인된 값만 사용한다. 값이 없으면 차단 상태를 유지한다. |
| 16 | [`detail:kt00010:purchase_settlement`](../../../backend/ref/kiwoom-screen-definitions.json#L82555) | `uv` | 공통 `kt00010` [요청 계약](../../../backend/ref/kiwoom-tr-inventory.json#L31154)의 `uv`는 원 단위 매수가격이다. 매입·정산 계산의 의미 필드이며 안전한 고정 enum이 아니다. | 권한·계좌 의미 확인 필요 | 정산 의미와 가격 기준이 승인된 계좌 문맥에서만 조회한다. 임의값·0·현재가 대체를 금지한다. |

## 후속 실행 순서

1. 즉시 해소 가능한 4개는 source-backed resolver에만 반영하고 dry-run에서 필드, 값, 근거 출처를 검증한다.
2. 실제 선행 read가 필요한 7개는 `ka01300`, `ka10102`, `ka40007`, `ka90001`을 먼저 실행한다. 각 선언 경로에서 non-empty 값이 관측된 같은 감사 세션에서만 종속 operation을 실행한다.
3. 선행 결과의 empty, business error, pagination 미완주, 현재성 미확인은 종속 입력 확보로 취급하지 않는다.
4. `ka30003`, `ka10088`, `kt00010` 세 detail은 계약 또는 권한이 추가되기 전까지 실행 대상에서 제외한다.
5. 후속 실행도 `read_display`의 loopback `/api/v1/tr/**` 조회만 허용한다. 주문·발급·등록·수정·OAuth·WebSocket 제어는 호출하지 않는다.
