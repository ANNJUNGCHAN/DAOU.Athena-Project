# Kiwoom 동적 입력 read 체인

## 범위

- `READ-INPUT-CONTRACTS.md`에서 실제 선행 read가 필요하다고 분류한 정확히 7개 target만 다룬다.
- 선행 source는 `base:ka01300`, `base:ka10102`, `base:ka40007`, `base:ka90001`의 4개다.
- target은 `base:ka01301`, `base:ka10039`, `base:ka10043`, `base:ka10052`, `base:ka10078`, `base:ka40001`, `base:ka90002`다.
- `ord_no`, `uv`, ELW 기초자산 계약 공백은 이 체인에 포함하지 않는다.

## 원천 연결

| source | 선언 응답 경로 | target 입력 |
|---|---|---|
| `base:ka01300` | `$.nofi[*].gcod` | `base:ka01301.arn_grp_id` |
| `base:ka10102` | `$.list[*].code` | `base:ka10039/ka10043/ka10052/ka10078.mmcm_cd` |
| `base:ka40007` | `$.etfobjt_idex_cd` | `base:ka40001.etfobjt_idex_cd` |
| `base:ka90001` | `$.thema_grp[*].thema_grp_cd` | `base:ka90002.thema_grp_cd` |

source 값은 같은 실행의 메모리 안에서 첫 번째 유효값만 target에 전달한다. 값, 계좌 식별자, provider 메시지, bearer token, continuation cursor는 보고서와 표준 출력에 저장하지 않는다. source가 empty, business 실패, 인증 실패, 선언 경로 불일치 또는 target 길이 계약 불일치이면 해당 target을 차단한다.

## 실행 안전장치

- 기본 실행은 dry-run이며 네트워크와 token read가 모두 0회다. 실제 호출은 명시적인 `--execute`에서만 수행한다.
- base URL은 인증정보가 없는 `http://127.0.0.1:8010` 또는 동등한 loopback port 8010만 허용한다.
- 원천 inventory, manifest, `read_display` definition의 operation, field, 길이, 설명, route, 선언 응답 경로를 모두 검사한 뒤에만 live preflight로 넘어간다.
- live OpenAPI의 path, operationId, TR ID, required request field가 원천 계획과 일치해야 한다.
- metadata 1회와 업무 요청 최대 20회를 구분한다. 이 범위의 정상 최대 업무 요청은 source 4회와 target 7회의 11회다.
- 각 요청은 최대 5초, 전체 실행은 최대 60초다. redirect, 외부 URL, 주문·OAuth 경로는 허용하지 않는다.
- operation마다 한 페이지만 관찰한다. HTTP 200, JSON object, business code 0, 선언된 최상위 응답 root 존재는 `PASS_HTTP_JSON_DECLARED_ROOT_PRESENT`이며 pagination과 freshness는 계속 `NOT_VERIFIED`다. 이는 전체 응답 schema validator 통과를 뜻하지 않는다.
- source 값이 mock 미지원 또는 empty이면 target 성공을 만들지 않고 `BLOCKED_SOURCE_VALUE_NOT_AVAILABLE`로 남긴다.

## 판정 계약

| 판정 | 의미 |
|---|---|
| `SOURCE_VALUE_OBSERVED_IN_MEMORY` | 선언 경로에서 target 길이 계약 안의 non-empty 값을 관측했다. 값 자체는 저장하지 않는다. |
| `PASS_HTTP_JSON_DECLARED_ROOT_PRESENT` | target 한 페이지에서 HTTP/JSON/business code와 선언된 최상위 응답 root 존재를 관측했다. 전체 응답 schema, 전체 페이지, 현재성 통과를 뜻하지 않는다. |
| `BLOCKED_SOURCE_EMPTY_OR_INVALID` | source가 선언 경로에서 사용 가능한 값을 제공하지 않았다. |
| `BLOCKED_SOURCE_VALUE_NOT_AVAILABLE` | source 판정 때문에 target을 호출하지 않았다. |
| `BLOCKED_AUTH(_NOT_ATTEMPTED)` | 첫 인증 실패 이후 추가 business 호출을 중단했다. |
| `NOT_RUN` | dry-run 계획만 검증했고 네트워크 호출은 하지 않았다. |

## 검증 및 실행 상태

- 구현: `scripts/market-session-audit/read-input-chain.mjs`
- 회귀 테스트: `scripts/market-session-audit/read-input-chain.test.mjs`
- 첫 독립 검토는 경로 정규화 우회, OpenAPI 필수 필드 제거 드리프트, 전체 시간보다 긴 rate delay, 응답 판정명 과장을 발견해 변경 요청했다. 네 항목을 수정하고 회귀 테스트를 추가했으며 재검토 전에는 `--execute`를 사용하지 않는다.
- 독립 재검토는 frozen 구현 `6E827311...`, 테스트 `FA912A1F...`를 승인했고 구문 검사와 17/17 회귀 테스트를 다시 통과시켰다.

## 13:12 KST 실제 실행 addendum

- 첫 CLI 실행은 child process에 bearer 환경이 전달되지 않아 OpenAPI metadata 1회 뒤 `ATHENA_LOCAL_BEARER_TOKEN is required for --execute`로 종료됐다. business 요청은 0회였고 결과 artifact도 생성되지 않았다. 시작 시각의 정확한 timestamp는 보존되지 않아 약 13:12 KST로만 기록한다.
- 교정 실행은 기존 `backend/.env`의 bearer를 `observer.mjs`의 `parseLocalBearer`로 파싱해 해당 child process 환경에만 전달했다. host 환경을 변경하지 않았고 token 값은 명령 출력, receipt, 결과 artifact에 기록하지 않았다.
- 결과 artifact는 `artifacts/market-session-audit/2026-09-07/read-input-chain-20260907T131253KST.json`, SHA-256은 `6C1E8AF6580C722F445E9C9EA11CE47A68D5B9309E23B79611C5E62D85D7B0CE`다. revision은 `ac8452f5b62a338d74826ac27cf65da12d99320b`, 실행 시작 단계는 `REGULAR`이다.
- 실제 결과는 source 4개와 target 7개, 총 11개가 모두 attempted이며 HTTP 200과 return code 0을 관측했다. source 4개는 선언 경로의 non-empty 값을 메모리에서만 관측했고, target 7개는 `PASS_HTTP_JSON_DECLARED_ROOT_PRESENT`였다. metadata 1회, business 11회다.
- 이 결과가 새로 해소한 기존 입력 차단 target은 7개다. 정규장 read 고유 범위는 252개에서 259/264개로 늘었다. 선행 source 4개는 기존 252개에 이미 포함되어 중복 증가로 계산하지 않는다.
- target 판정은 한 페이지의 HTTP/JSON object/business code 0/선언된 최상위 root 존재만 뜻한다. 전체 응답 schema, pagination, freshness, 실제 데이터 의미, 앱 전체 기능의 정상 작동은 검증하지 않았다. 모든 결과의 pagination은 `NOT_VERIFIED_SINGLE_PAGE`, freshness는 `NOT_VERIFIED`다.
- 실행 교정 receipt는 `artifacts/market-session-audit/2026-09-07/read-input-chain-launch-correction.json`에 저장했다.
