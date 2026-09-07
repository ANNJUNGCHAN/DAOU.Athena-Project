# 커스텀 GET 기존 레코드 체인 검사 계획

> 판정 용어 정정: raw `PASS_HTTP_SCHEMA_ONLY`는 HTTP 2xx, JSON 파싱, 구조 fingerprint 관찰만 뜻한다. OpenAPI 응답 스키마 validator 통과, 필드 의미·데이터 정확성·사용자 흐름 검증을 뜻하지 않는다. 원본 raw label은 이력 보존을 위해 유지한다.


## 12:34 유효 프로젝트 선택 후 실제 재검사

- 실제 artifact: `custom-read-chain-live-20260907T033434-309Z.json`, SHA-256 `0776f50c618a9acc49a04faf6f5f05e004b8a143d32ed6d0e8bc0fd9e32a8864`. source revision ac8452f, REGULAR, mockapi 연결 환경.
- 대상20개 중14개 실제 호출,14개 HTTP/schema만 확인,6개 선행조건 차단. Business22회에는 선행 GET8회가 포함되며 metadata1회는 별도다. 초기27개와 고유 GET 합집합은41개다.
- 이전10:53 첫 stale프로젝트의 tree/env404는 원본에 유지한다. 이번에는 source 계약으로 실제 디렉터리가 있는 기존 프로젝트를 선택했고 tree/env/file3개가 HTTP200을 반환했다. 프로젝트 생성·기존 자료 수정은 없었다. 제품 코드 수정으로 보고하지 않는다.
- 남은6개는 안전한 job 목록 부재3, 첫 전략의 diff용 version부족1, 비활성루틴 선행503으로 인한미시도2다. 실제값·파일/환경본문·credential은 저장하지 않았다. 이결과는 사용자 흐름 전체 정상 또는 모든 장중 기능 통과를 뜻하지 않는다.

| Exact target ID | 실제 호출 | KST | HTTP | 판정 범위 | 사유 |
|---|---|---|---|---|---|
| `custom-api:GET:/api/v1/backtest/data/coverage` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/backtest/jobs/{job_id}` | false | — | — | BLOCKED | NO_SAFE_EXISTING_LIST_SOURCE |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}/trades` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions/{version_id}` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/diff` | false | — | — | BLOCKED | BLOCKED_NO_EXISTING_RECORD |
| `custom-api:GET:/api/v1/backtest/deployments/{deployment_id}/signals` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id}` | false | — | — | BLOCKED | NO_SAFE_EXISTING_LIST_SOURCE |
| `custom-api:GET:/api/v1/brain/chats` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/brain/analysis/entity-timeline` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/brain/analysis/entity-detail` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/internal/canvas/realtime-bindings/{operation_id}` | true | 12:34:34 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/catalog/{operation_ref}` | true | 12:34:35 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/projects/{project_id}/tree` | true | 12:34:35 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/projects/{project_id}/file` | true | 12:34:35 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/projects/{project_id}/env` | true | 12:34:35 | 200 | PASS_HTTP_SCHEMA_ONLY | HTTP_RESPONSE_SANITIZED |
| `custom-api:GET:/api/v1/routines/{routine_id}` | false | — | — | BLOCKED | SOURCE_HTTP_STATUS |
| `custom-api:GET:/api/v1/routines/{routine_id}/runs` | false | — | — | BLOCKED | SOURCE_HTTP_STATUS |
| `custom-api:GET:/api/v1/backtest/source/map/{job_id}` | false | — | — | BLOCKED | NO_SAFE_EXISTING_LIST_SOURCE |


## 목적과 범위

커스텀 API 실제 검사에서 필수 입력이 없어 차단된 GET 20개만 대상으로 한다. 새 job, run, strategy, conversation, project, routine을 만들지 않는다. 선행 목록 GET이 반환한 기존 식별자를 프로세스 메모리에서만 골라 후속 GET에 전달한다. 주문, OAuth 발급, WebSocket REG/REMOVE, DELETE/PUT/POST, 계좌 변경은 호출하지 않는다.

기준은 `ac8452f5b62a338d74826ac27cf65da12d99320b`의 정적 124개 custom API 인벤토리와 `runtime-discovery-20260907T000357-672Z.json`의 동결 operationId다. 기존 `custom-read-sweep.mjs`의 124개 exact membership, GET 소스 SHA-256, 같은 HEAD의 121개 HTTP runtime identity 검증을 먼저 통과해야 한다.

## 소스 계약으로 준비된 체인

| 선행 GET | 메모리에서만 선택 | 후속 대상 | 수량 |
| --- | --- | --- | ---: |
| `/api/v1/backtest/runs` | `runs[].run_id` 사전식 최소값 | run 상세, trades | 2 |
| `/api/v1/backtest/strategies` | `strategies[].id` | versions | 1 |
| versions GET | `versions[].id` 한 개 | version 상세 | 1 |
| versions GET | 같은 strategy의 서로 다른 `versions[].id` 두 개 | diff의 `base`, `head` | 1 |
| `/api/v1/backtest/deployments` | `deployments[].id` | signals | 1 |
| 동일 deployment 행 | `stk_cd`, `period`, `adjusted` | data coverage | 1 |
| `/api/v1/brain/conversations` | `conversations[].conversation_id` | chats | 1 |
| `/api/v1/brain/analysis/god-nodes` | `nodes[].entity_id` | entity timeline, detail | 2 |
| `/api/v1/catalog` | `operations[].operation_ref` | catalog metadata | 1 |
| 동일 catalog 중 `kind=websocket` | `tr_id` | realtime binding contract | 1 |
| `/api/v1/projects` | `projects[].id` | tree, env | 2 |
| tree GET | `py=true`인 `entries[].path` | Python file read | 1 |
| `/api/v1/routines` | `routines[].id` | routine 상세, runs | 2 |
| 합계 | | | 17 |

선행 목록이 비었거나 스키마가 다르면 ID를 만들지 않고 `BLOCKED_NO_EXISTING_RECORD` 또는 `BLOCKED_SOURCE_CONTRACT_MISMATCH`로 끝낸다. 루틴은 현재 안전 설정에서 목록 자체가 503이므로 `BLOCKED`가 예상된다.

## 소스 계약 부족으로 계속 차단되는 3개

- `custom-api:GET:/api/v1/backtest/jobs/{job_id}`
- `custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id}`
- `custom-api:GET:/api/v1/backtest/source/map/{job_id}`

세 항목 모두 기존 job ID를 반환하는 안전한 목록 GET이 없다. 새 job을 만드는 POST는 이번 권한 밖이므로 `NO_SAFE_EXISTING_LIST_SOURCE`로 유지한다.

## 안전 및 증거 계약

- 기본 모드는 네트워크를 사용하지 않는 드라이런이다. CLI의 `--execute`는 의도적으로 거부하며, 실제 실행은 검토를 마친 호출자가 같은 HEAD의 OpenAPI를 메모리로 전달하는 방식만 허용한다.
- 정확한 `http://127.0.0.1:8010` 계열 origin만 허용하며 URL 검증 후에만 로컬 bearer를 읽는다. 모든 요청은 GET, `redirect:error`, `credentials:omit`이다.
- 메모리로 전달된 현재 OpenAPI에 대해 20개 대상과 실제 사용 선행 GET 전체의 route, GET method, 동결 operationId, request body 부재, SSE 부재, 필수 parameter와 고정 allowlist를 일괄 preflight한다. 한 건이라도 다르면 credential을 읽거나 business GET을 호출하기 전에 `request_count=0`으로 차단한다.
- 기본 credential 파일을 읽지 못하거나 bearer가 비어 있으면 `AUTH_UNAVAILABLE / request_count=0`이다. 첫 401/403은 `AUTH_REJECTED`로 기록하고 이후 요청을 중단한다. 명시적 `bearer:null`은 테스트의 무인증 계약 검증에만 사용한다.
- business 응답은 1 MB까지만 메모리에서 읽는다. 목록에서 선택한 값, raw body, 채팅·파일·env 내용, credential, 서버 메시지와 오류 원문은 artifact나 stderr에 기록하지 않는다.
- artifact에는 각 소스/대상의 exact ID, 시도 시각·장 구간, HTTP 상태, 지연, 값 없는 구조 해시, 해당 단일 응답에서 관찰한 후보 개수와 선택 여부만 기록한다.
- 선택은 선행 GET의 단일 응답에서 관찰된 후보 중 사전식 최소값 한 건으로 제한한다. 이는 목록 전체나 pagination을 완주했다는 뜻이 아니다. pagination 계약이 추가로 필요한 응답은 별도 검토 전 전체 목록으로 판정하지 않는다.
- 후속 파라미터 이름은 대상별 고정 allowlist와 현재 OpenAPI의 path/query 정의가 모두 일치해야 한다. 선행 응답은 URL이나 경로를 지정할 수 없고 값만 제공하며, 고정된 route template에 `encodeURIComponent` 또는 `URLSearchParams`로 삽입된다.
- 요청 최대 32회(하드 상한 40), 요청당 5초, 전체 60초다. 한 소스 응답은 실행 중 메모리 cache에서만 재사용한다.
- 각 요청 timeout은 `min(요청 timeout, 전체 제한의 남은 시간)`이다. 전체 제한으로 abort되면 `DURATION_LIMIT_REACHED`를 보존한다.
- HTTP 500, timeout, transport 오류와 response URL 변경도 네트워크가 시작됐으면 `attempted=true`, 실제 시각과 장 구간, 값 없는 parameter 이름을 남긴다. 네트워크 전 차단만 `attempted=false`다.
- 20개 대상 결과는 각각 `PASS_HTTP_SCHEMA_ONLY`, `BLOCKED`, `NOT_RUN` 중 하나다. 이 결과로 데이터 현재성, UI 반영, 루틴 활성 상태 또는 전체 제품 PASS를 주장하지 않는다.

## 검토 후 실행 절차

1. `node --test scripts/market-session-audit/custom-read-chain.test.mjs`
2. `node scripts/market-session-audit/custom-read-chain.mjs`로 17 `NOT_RUN` + 3 `BLOCKED` 드라이런과 20개 exact ID를 확인한다.
3. 독립 검토자가 소스 selector, operationId, 비저장, 요청 상한을 승인한다.
4. 승인 후 `node scripts/market-session-audit/custom-read-chain-live.mjs --execute`를 1회 실행한다. 다른 CLI 인수와 가짜 관측 시각은 허용하지 않는다.

live entrypoint는 origin과 명시적 실행 인수를 검증한 뒤 네트워크 전에 고정 output directory를 만들고 고유 artifact 경로를 `wx`로 예약한다. 이 준비가 실패하면 credential을 읽거나 metadata/business 요청을 시작하지 않는다. 이후 bearer를 확인하고 `/openapi.json`만 본문 소비를 포함한 전체 5초·8 MiB 제한으로 한 번 읽는다. `redirect:error`, `credentials:omit`, exact response URL, JSON content type을 확인하고 같은 메모리 bearer와 OpenAPI 객체로 core를 한 번 호출한다. 성공 report는 예약한 handle에 기록하고, 이후 실패에는 고정 reason과 metadata/business 요청 수만 담은 sanitized failure marker를 같은 파일에 남긴다. artifact에는 metadata 요청 수와 business 요청 수를 분리해 기록하며 stdout에는 artifact 경로, mode, summary, 요청 수만 출력한다.

첫 승인 실행 artifact `custom-read-chain-live-20260907T014622-124Z.json`은 metadata 1회, business 0회에서 `OPENAPI_RESPONSE_TOO_LARGE`로 종료됐다. 같은 안전 경계의 추가 metadata HEADERS 측정 1회에서 현재 `/openapi.json`의 `Content-Length`는 1,082,634 bytes였고 본문은 즉시 취소했다. 이전 동결 `runtime-discovery-20260907T000357-672Z.json`은 119,538-byte의 압축된 발견 artifact라 raw OpenAPI 크기 상한의 직접 기준으로 사용할 수 없다. 현재 실측보다 약 7.7배 큰 고정 8 MiB를 OpenAPI 전용 상한으로 정했으며 business 1 MB 한도는 변경하지 않았다.

## 10:53 KST 실제 체인 결과 addendum

독립 승인 후 root가 `2026-09-07 10:53:46 KST / REGULAR`에 frozen revision `ac8452f5b62a338d74826ac27cf65da12d99320b`로 1회 재실행했다. 최종 artifact는 `custom-read-chain-live-20260907T015345-885Z.json`이며 metadata 1회와 business 21회가 발생했다. 20개 대상 중 실제 target GET은 13개, HTTP 200과 구조 검증을 통과한 항목은 11개, 차단은 9개다. `PASS_HTTP_SCHEMA_ONLY`는 응답 내용의 정확성·현재성·UI 반영 또는 전체 제품 정상 작동을 뜻하지 않는다.

| exact target ID | 시도 / 장 구간 | HTTP / 판정 | 선행조건 및 고정 reason |
| --- | --- | --- | --- |
| `custom-api:GET:/api/v1/backtest/data/coverage` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | deployments GET의 기존 행 61개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/jobs/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 job 목록 GET 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | runs GET의 기존 행 217개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}/trades` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 같은 기존 run 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | strategies GET의 기존 행 278개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions/{version_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 선택한 strategy의 기존 version 1개 사용; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/diff` | 미시도 / REGULAR 실행 | — / BLOCKED | diff에는 서로 다른 version 2개가 필요하나 관찰값 1개; `BLOCKED_NO_EXISTING_RECORD` |
| `custom-api:GET:/api/v1/backtest/deployments/{deployment_id}/signals` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | deployments GET의 기존 행 61개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 ingestion job 목록 GET 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |
| `custom-api:GET:/api/v1/brain/chats` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | conversations GET의 기존 행 14개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/analysis/entity-timeline` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | god-nodes GET의 기존 행 10개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/analysis/entity-detail` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 같은 기존 entity 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/internal/canvas/realtime-bindings/{operation_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | catalog의 websocket 후보 23개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/catalog/{operation_ref}` | 10:53:47 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | catalog의 operation 후보 301개 중 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/projects/{project_id}/tree` | 10:53:47 / REGULAR | 404 / BLOCKED | projects GET의 기존 행 2개 중 선택 후 target 404; `SOURCE_HTTP_STATUS`, 원인 미확인 |
| `custom-api:GET:/api/v1/projects/{project_id}/file` | 미시도 / REGULAR 실행 | — / BLOCKED | 선행 tree GET이 404여서 안전한 file path를 얻지 못함; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/projects/{project_id}/env` | 10:53:47 / REGULAR | 404 / BLOCKED | projects GET의 기존 행 2개 중 선택 후 target 404; `SOURCE_HTTP_STATUS`, 원인 미확인 |
| `custom-api:GET:/api/v1/routines/{routine_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전 설정에서 선행 routines GET 503; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/routines/{routine_id}/runs` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전 설정에서 선행 routines GET 503; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/backtest/source/map/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 source-map job 목록 GET 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |

차단 9개는 안전한 목록 소스 부재 3개, version 수 부족 1개, project target 404 두 개, tree 404 때문에 파생 입력을 얻지 못한 file 1개, 의도적으로 비활성화된 routines 선행 GET 503에 따른 2개다. project tree/env의 404는 실제 관찰값이지만 원인을 확인하지 않았으므로 product defect로 확정하지 않는다.

초기 sweep의 실제 HTTP endpoint 27개와 이번 chain business HTTP endpoint 21개의 교집합은 선행 목록 8개이며 합집합은 exact ID 기준 40개다. 즉 21회 중 8회는 기존 endpoint 재관찰이고, 13회가 기존 차단 대상에 대한 새 target 시도다. 이는 124개 custom route 전체의 기능·내용·UI를 모두 테스트했다는 뜻이 아니다. 두 artifact 모두 raw body, 선택된 identifier, chat/file/env 값과 credential을 저장하지 않는다.

10:46 KST의 이전 metadata 1 MB preflight 실패는 metadata 1회, business 0회에서 끝난 harness 한도 문제다. 서비스 장애나 product defect로 분류하지 않으며, 실측 후 OpenAPI 전용 8 MiB 상한으로 교정한 뒤 위 결과를 얻었다.

## 준비 검증 및 동결

- core 테스트: `node --test scripts/market-session-audit/custom-read-chain.test.mjs` → 12/12 PASS
- live entrypoint 테스트: `node --test scripts/market-session-audit/custom-read-chain-live.test.mjs` → 8/8 PASS. 1 MB 초과 정상 metadata 허용, 8 MiB 초과 차단, 헤더 후 OpenAPI body stall, 네트워크 전 artifact 준비 실패, 최종 write 실패 marker를 포함한다.
- 구문: `node --check scripts/market-session-audit/custom-read-chain.mjs` → PASS
- 드라이런: `artifacts/market-session-audit/2026-09-07/custom-read-chain-20260907T014214-995Z.json` → 20개 exact ID, 17 `NOT_RUN`, 3 `BLOCKED`, 실제 요청 0
- 실제 차단 artifact의 20개 ID와 코드의 20개 target ID exact set 일치
- `custom-read-chain.mjs` SHA-256: `1B25DAA75B03FE815DDDA0358C2EF1EC1FED3692DEC7456271507893D42160F9`
- `custom-read-chain.test.mjs` SHA-256: `D5CA7D78E2138DE82433B8AE26966A7C7BEE0BC98CF4167630DB2BF847AC44A4`
- `custom-read-chain-live.mjs` SHA-256: `3B965D8D564196783920A8E0AD95BB8EBF0CB72E3A641D92A4B8DE054BEB4A60`
- `custom-read-chain-live.test.mjs` SHA-256: `CF0BA3771CC12374ADE5838FC87936CB651EE2F4BDC15710E02DCCA37BAB9AD8`
- 첫 live 차단 artifact SHA-256: `FABB3C5376D49CA497F123D36F069A59FB9DA8E64FEB7BCB7678970EEC76FE60`
- 10:53 KST live 결과 artifact SHA-256: `DE3D6611735366DCAED86299E8BAD58FB52643C449A7E3ABC39EDF810EBD36D1`
- 드라이런 artifact SHA-256: `FEE4C8F8BAD8962B90E1988B075777C898F6D9E90DCC0A459D32D77878723E1D`
- operationId 동결 기준 SHA-256: `99DCCB301070AE06170850CFCB6272E4B841B3510512931ABF6B6BE59F772002`

독립 reviewer는 `buildCustomReadChainPlan()`으로 20개 집합과 17+3 분류를 확인하고 live entrypoint의 OpenAPI 경계 및 artifact 비저장을 승인한다. 반환 report만 artifact로 저장하며 함수 내부의 OpenAPI, source body와 선택 값은 저장하거나 출력하지 않는다.
