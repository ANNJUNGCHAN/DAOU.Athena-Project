# 커스텀 API 장중 전수 조회 검사

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


## 판정 범위

- 기준 리비전: `ac8452f5b62a338d74826ac27cf65da12d99320b`
- 기준 인벤토리: `artifacts/market-session-audit/2026-09-07/inventory.json`
- 드라이런 증거: `artifacts/market-session-audit/2026-09-07/custom-read-sweep-20260907T002855-024Z.json`
- 실제 실행 증거: `artifacts/market-session-audit/2026-09-07/custom-read-sweep-20260907T003436-339Z.json`
- operationId 기준: `artifacts/market-session-audit/2026-09-07/runtime-discovery-20260907T000357-672Z.json`
- 실제 실행 시작: 2026-09-07 09:34:20 KST, 정규장(`REGULAR`)
- 커스텀 API 124개 모두에 ID, 소스 파일, 메서드, 경로 템플릿, 판정 및 사유가 기록되었다. 중복 ID와 누락 ID는 0개다.
- 실제 GET 호출은 27개다. 24개 PASS는 HTTP 응답과 값이 제거된 JSON 구조만 확인한 결과이며, 데이터 내용·현재성·UI 반영이나 전체 제품 PASS를 뜻하지 않는다.

## 결과

| 구분 | 수량 | 현재 판정 | 사유 |
| --- | ---: | --- | --- |
| GET 호출 성공 | 24 | `PASS_HTTP_SCHEMA_ONLY` | HTTP 성공 및 비식별 구조 확인. 내용·현재성은 미검증 |
| GET HTTP 503 | 3 | `BLOCKED_SAFE_CONFIG` | 루틴 기능을 의도적으로 끈 감사 환경. 원시 runner 판정은 `FAIL` |
| GET 필수 입력 미할당 | 20 | `BLOCKED` | 경로 식별자 16개와 실행 OpenAPI에서 추가 확인된 필수 쿼리 4개 |
| POST | 66 | `NOT_APPLICABLE` | 이번 조회 전용 검사에서 호출 권한 없음 |
| DELETE | 7 | `NOT_APPLICABLE` | 이번 조회 전용 검사에서 호출 권한 없음 |
| PUT | 1 | `NOT_APPLICABLE` | 이번 조회 전용 검사에서 호출 권한 없음 |
| WebSocket | 3 | `NOT_APPLICABLE` | 스트림 전용 검사에서 별도로 다룸 |
| 합계 | 124 | 원시: 24 `PASS`, 3 `FAIL`, 20 `BLOCKED`, 77 `NOT_APPLICABLE` | 실제 호출 27개 |

드라이런의 31개 GET 후보 중 4개는 실행 시점 OpenAPI가 필수 쿼리·인증 입력을 요구해 추가 차단되었다. 남은 27개만 호출됐다.

## HTTP 503 판정

다음 세 건은 원시 artifact의 `FAIL / HTTP_ERROR_STATUS / 503`을 그대로 보존한다.

- `custom-api:GET:/api/v1/routines` — 09:34:33.301 KST
- `custom-api:GET:/api/v1/routines/briefing-budget` — 09:34:33.810 KST
- `custom-api:GET:/api/v1/routines/source-catalog` — 09:34:34.318 KST

`backend/athena_api/api/routines.py:110-116`은 `app.state.routines_runtime`이 없거나 ready가 아니면 명시적으로 503을 반환하며, 메시지에도 `ATHENA_ROUTINES_ENABLED=true`가 필요하다고 정의한다. 현재 감사 backend는 외부 루틴 실행을 막기 위해 `ATHENA_ROUTINES_ENABLED=false`로 시작됐고 이 조건은 `STATUS.md` 및 `boot-diagnosis.md`에 기록돼 있다. 따라서 이번 세 건의 감사 판정은 `EXPECTED_DISABLED / BLOCKED_SAFE_CONFIG`다. 현재 증거로 제품 결함을 확정하지 않는다. 루틴 기능 자체의 장중 검증은 외부 실행을 일으키지 않는 격리 환경에서 루틴 runtime만 활성화한 뒤 별도로 재검사해야 한다.

## 소스별 대조

| 소스 | 전체 | GET | 실행 후보 | 입력 차단 | 조회 외 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `api/backtest.py` | 36 | 14 | 7 | 7 | 22 |
| `api/backtest_technique.py` | 2 | 0 | 0 | 0 | 2 |
| `api/backtest_visual.py` | 6 | 1 | 1 | 0 | 5 |
| `api/batch.py` | 1 | 0 | 0 | 0 | 1 |
| `api/brain.py` | 19 | 12 | 11 | 1 | 7 |
| `api/canvas_push.py` | 6 | 1 | 0 | 1 | 5 |
| `api/catalog.py` | 3 | 3 | 2 | 1 | 0 |
| `api/chart_page.py` | 1 | 0 | 0 | 0 | 1 |
| `api/llm_tools.py` | 5 | 1 | 1 | 0 | 4 |
| `api/nudge_guard.py` | 2 | 1 | 1 | 0 | 1 |
| `api/oauth_status.py` | 1 | 1 | 1 | 0 | 0 |
| `api/projects.py` | 12 | 4 | 1 | 3 | 8 |
| `api/raw.py` | 1 | 0 | 0 | 0 | 1 |
| `api/routines.py` | 18 | 5 | 3 | 2 | 13 |
| `api/routines_ws.py` | 1 | 0 | 0 | 0 | 1 |
| `api/series_page.py` | 1 | 0 | 0 | 0 | 1 |
| `api/settings.py` | 1 | 0 | 0 | 0 | 1 |
| `api/sources.py` | 4 | 1 | 0 | 1 | 3 |
| `api/stream.py` | 1 | 0 | 0 | 0 | 1 |
| `main.py` | 3 | 3 | 3 | 0 | 0 |

## 안전 계약

- 기본 실행은 네트워크를 사용하지 않는 드라이런이다. 실제 호출은 명시적 `--execute`에서만 가능하다.
- `observer.mjs`의 검증기를 재사용해 `http://127.0.0.1:8010` 계열의 정확한 루프백 origin만 허용한다. 사용자 정보가 URL에 들어간 경우도 거부한다.
- GET이라는 이유만으로 안전하다고 보지 않는다. 현재 GET 핸들러가 있는 12개 소스 파일을 읽기 동작으로 검토했고, 정확한 SHA-256과 일치할 때만 후보가 된다. 파일이 바뀌면 `SOURCE_CHANGED_REVIEW_REQUIRED`로 차단한다.
- 기대 operationId는 새 라이브 응답에서 가져오지 않는다. 같은 HEAD에서 이미 동결한 런타임 발견 증거의 121개 HTTP 경로와 정적 인벤토리의 121개 HTTP 경로가 정확히 일치하고, operationId 누락·중복이 없을 때만 기준으로 사용한다. HEAD나 전체 집합이 다르면 모든 GET을 차단한다.
- 실행 시 현재 OpenAPI에서 정확한 경로, GET 계약, 동결 기준의 operationId를 다시 확인한다. operationId가 다르면 `RUNTIME_OPERATION_ID_MISMATCH`로 실제 엔드포인트 호출 전에 차단한다. 필수 request body와 `text/event-stream`도 호출하지 않는다.
- 필수 경로·쿼리 값은 `observed_runtime_catalog`, `existing_local_record`, `owned_fixture` 중 하나로 출처가 붙은 값만 메모리에서 사용한다. 값은 결과에 저장하지 않는다.
- HTTP 리다이렉트와 자격 증명 자동 전달을 금지한다. 응답 URL이 바뀌어도 실패한다.
- 응답은 최대 1 MB까지만 읽는다. 결과에는 HTTP 상태, 지연, 콘텐츠 타입, 최상위 타입·개수, 값이 제거된 구조 해시만 기록한다. 본문, 메시지, 토큰, 계정 별칭, 경로 식별자 값은 저장하지 않는다.
- 호출별 관찰 시각과 장 구간을 별도로 기록한다. 시작 시각만으로 전체 호출의 장 구간을 추정하지 않는다.

## 실행 기록과 후속

독립 안전성 검토 후 아래 조건으로 1회 실행됐다.

```powershell
& "C:\Program Files\nodejs\node.exe" scripts/market-session-audit/custom-read-sweep.mjs --execute --base-url http://127.0.0.1:8010 --rate-ms 500 --timeout-ms 5000
```

필수 입력이 필요한 20개 GET은 계속 `BLOCKED`다. 실제로 존재하는 로컬 레코드나 런타임 카탈로그에서 관찰한 값을 별도 검증된 호출자가 `safeInputsById`로 제공할 때만 재검사할 수 있다. 값 자체는 artifact에 저장하지 않는다. 루틴 3개는 안전 설정을 유지한 현재 backend에서 반복 호출해도 같은 503이 예상되므로 추가 호출하지 않았다.

## 검증 증거

- `node --test scripts/market-session-audit/custom-read-sweep.test.mjs`: 8/8 PASS
- 실제 실행: 124/124 고유 ID 결과, 누락 0, 중복 0, 호출 27개
- 동결 기준 대조: 같은 HEAD, HTTP 경로 121/121 일치, 121개 모두 기대 operationId 기록, WebSocket 3개는 `null`
- 원시 실제 결과: 24 PASS / 3 FAIL(HTTP 503) / 20 BLOCKED / 77 NOT_APPLICABLE
- 감사 재판정: 24 `PASS_HTTP_SCHEMA_ONLY`, 3 `BLOCKED_SAFE_CONFIG`, 20 `BLOCKED_MISSING_SAFE_INPUT`, 77 runner scope 제외
- 테스트로 확인한 차단: 외부 호스트, 대체 포트, POST/DELETE/PUT, WebSocket, SSE, 필수 입력 미할당, 소스 변경, 기준 HEAD·경로 집합·라이브 operationId 불일치
- 테스트로 확인한 비저장: bearer, 응답 값, 계정·경로 식별자 값

## 124개 exact ID 실제 결과

아래 표는 실제 artifact의 124개 행과 1:1이다. `—`는 호출하지 않았다는 뜻이다. runner 원시 판정을 보존하면서 감사 해석을 별도 열에 기록했다.

| Exact ID | 소스 | 원시 결과 | 감사 판정 | 실제 시각 / 장 구간 | 후속 |
| --- | --- | --- | --- | --- | --- |
| custom-api:GET:/api/v1/backtest/presets | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:21.008 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/backtest/indicators | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:21.563 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/backtest/validate | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/data/coverage | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/backtest/data/plan | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/data/backfill | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/jobs/{job_id} | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:DELETE:/api/v1/backtest/jobs/{job_id} | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/runs | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/runs | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:22.073 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/backtest/runs/{run_id} | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/backtest/runs/{run_id}/trades | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:DELETE:/api/v1/backtest/runs/{run_id} | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/flow | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/map | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/codegen | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/diagnose | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/strategies | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:22.670 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/backtest/strategies | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions/{version_id} | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/backtest/strategies/{strategy_id}/versions | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/strategies/{strategy_id}/activate | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/diff | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/backtest/optimize/plan | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/optimize | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/deployments | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:23.184 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/backtest/deployments | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:DELETE:/api/v1/backtest/deployments/{deployment_id} | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/deployments/{deployment_id}/arm | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/deployments/{deployment_id}/signals | backend/athena_api/api/backtest.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/backtest/deployments/{deployment_id}/evaluate | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/youtube/brief | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/user-strategies | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/user-strategies | backend/athena_api/api/backtest.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:23.693 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:DELETE:/api/v1/backtest/user-strategies/{strategy_id} | backend/athena_api/api/backtest.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/technique/nodes | backend/athena_api/api/backtest_technique.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/technique/check | backend/athena_api/api/backtest_technique.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/visual/registry | backend/athena_api/api/backtest_visual.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:24.218 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/backtest/visual/validate | backend/athena_api/api/backtest_visual.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/visual/compile | backend/athena_api/api/backtest_visual.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/visual/question | backend/athena_api/api/backtest_visual.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/visual/patch | backend/athena_api/api/backtest_visual.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/visual/from-spec | backend/athena_api/api/backtest_visual.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/batch | backend/athena_api/api/batch.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/brain/chat | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/brain/status | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:24.723 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/brain/startup-ingestion/retry | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/brain/relations/manual | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/brain/relations/confirmations | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/brain/relations/retractions | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/brain/ingestion/jobs | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id} | backend/athena_api/api/brain.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/brain/chats | backend/athena_api/api/brain.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/brain/conversations | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:25.230 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/profile-summary | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:25.738 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/brain/reset-and-restart | backend/athena_api/api/brain.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/brain/analysis/god-nodes | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:26.247 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/analysis/surprising-connections | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:26.758 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/analysis/suggested-questions | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:27.268 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/analysis/diff | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:27.779 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/analysis/entity-timeline | backend/athena_api/api/brain.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/brain/analysis/cluster-map | backend/athena_api/api/brain.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:28.291 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/brain/analysis/entity-detail | backend/athena_api/api/brain.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/canvas/push | backend/athena_api/api/canvas_push.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/internal/canvas/realtime-bindings/{operation_id} | backend/athena_api/api/canvas_push.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/internal/canvas/board-hydrate | backend/athena_api/api/canvas_push.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/selector/dispatch | backend/athena_api/api/canvas_push.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/canvas/render-plan | backend/athena_api/api/canvas_push.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:WEBSOCKET:/api/v1/ws/canvas | backend/athena_api/api/canvas_push.py | NOT_APPLICABLE/STREAM_PROTOCOL_EXCLUDED | NOT_APPLICABLE_WS_RUNNER | — / sweep REGULAR | WebSocket 전용 검사 |
| custom-api:GET:/api/v1/catalog/output-profile | backend/athena_api/api/catalog.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:28.806 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/catalog | backend/athena_api/api/catalog.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:29.322 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/catalog/{operation_ref} | backend/athena_api/api/catalog.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/canvas/chart-page | backend/athena_api/api/chart_page.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/llm/manifest | backend/athena_api/api/llm_tools.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:31.228 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/llm/tools/search | backend/athena_api/api/llm_tools.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/llm/tools/describe | backend/athena_api/api/llm_tools.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/llm/tools/resolve | backend/athena_api/api/llm_tools.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/llm/tools/call | backend/athena_api/api/llm_tools.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/nudge-guard | backend/athena_api/api/nudge_guard.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:31.752 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/nudge-guard | backend/athena_api/api/nudge_guard.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/internal/oauth/status | backend/athena_api/api/oauth_status.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:32.265 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/api/v1/projects | backend/athena_api/api/projects.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:32.787 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:POST:/api/v1/projects | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/projects/open | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:DELETE:/api/v1/projects/{project_id} | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/projects/{project_id}/tree | backend/athena_api/api/projects.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:GET:/api/v1/projects/{project_id}/file | backend/athena_api/api/projects.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:PUT:/api/v1/projects/{project_id}/file | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/projects/{project_id}/file | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/projects/{project_id}/rename | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:DELETE:/api/v1/projects/{project_id}/file | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/projects/{project_id}/env | backend/athena_api/api/projects.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/projects/{project_id}/env | backend/athena_api/api/projects.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/raw/tr/{tr_id} | backend/athena_api/api/raw.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/draft | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/routines | backend/athena_api/api/routines.py | FAIL/HTTP_ERROR_STATUS/HTTP 503 | BLOCKED_SAFE_CONFIG | 09:34:33.301 KST / REGULAR | 격리 runtime 활성화 후 재검사 |
| custom-api:GET:/api/v1/routines/briefing-budget | backend/athena_api/api/routines.py | FAIL/HTTP_ERROR_STATUS/HTTP 503 | BLOCKED_SAFE_CONFIG | 09:34:33.810 KST / REGULAR | 격리 runtime 활성화 후 재검사 |
| custom-api:GET:/api/v1/routines/source-catalog | backend/athena_api/api/routines.py | FAIL/HTTP_ERROR_STATUS/HTTP 503 | BLOCKED_SAFE_CONFIG | 09:34:34.318 KST / REGULAR | 격리 runtime 활성화 후 재검사 |
| custom-api:POST:/api/v1/routines/watch/code | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/watch/check | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/routines/{routine_id} | backend/athena_api/api/routines.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/update | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/confirm | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/pause | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/resume | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/cancel | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/watch/rollback | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/catchup-fire | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/briefing-result | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/routines/{routine_id}/runs | backend/athena_api/api/routines.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/engagement | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/routines/{routine_id}/ack | backend/athena_api/api/routines.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:WEBSOCKET:/api/v1/ws/routines | backend/athena_api/api/routines_ws.py | NOT_APPLICABLE/STREAM_PROTOCOL_EXCLUDED | NOT_APPLICABLE_WS_RUNNER | — / sweep REGULAR | WebSocket 전용 검사 |
| custom-api:POST:/api/v1/canvas/series-page | backend/athena_api/api/series_page.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/settings/expose-to-model | backend/athena_api/api/settings.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/source/brief | backend/athena_api/api/sources.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:POST:/api/v1/backtest/source/map | backend/athena_api/api/sources.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:GET:/api/v1/backtest/source/map/{job_id} | backend/athena_api/api/sources.py | BLOCKED/MISSING_SAFE_OBSERVED_INPUT | BLOCKED_MISSING_SAFE_INPUT | — / sweep REGULAR | 관찰된 안전 입력 확보 후 재검사 |
| custom-api:DELETE:/api/v1/backtest/source/map/{job_id} | backend/athena_api/api/sources.py | NOT_APPLICABLE/NON_GET_NOT_AUTHORIZED | NOT_APPLICABLE_GET_RUNNER | — / sweep REGULAR | 별도 비조회 계약 검사 |
| custom-api:WEBSOCKET:/api/v1/ws/stream | backend/athena_api/api/stream.py | NOT_APPLICABLE/STREAM_PROTOCOL_EXCLUDED | NOT_APPLICABLE_WS_RUNNER | — / sweep REGULAR | WebSocket 전용 검사 |
| custom-api:GET:/health | backend/athena_api/main.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:34.823 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/ready | backend/athena_api/main.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:35.325 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |
| custom-api:GET:/ready/accounts | backend/athena_api/main.py | PASS/HTTP_RESPONSE_SANITIZED/HTTP 200 | PASS_HTTP_SCHEMA_ONLY | 09:34:35.827 KST / REGULAR | 내용·현재성·UI 반영 별도 검증 |

## 10:53 KST 기존 레코드 GET 체인 addendum

초기 표에서 입력 부족으로 차단됐던 20개 대상의 후속 결과다. 최종 artifact `custom-read-chain-live-20260907T015345-885Z.json`은 metadata 1회, business 21회이며 target은 13개만 실제 시도됐다. 11개가 HTTP 200 구조 검증을 통과했고 9개는 아래 이유로 차단됐다. 이 addendum이 초기 행의 관찰 상태를 보완하지만, 미시도 항목을 테스트한 것으로 바꾸지 않는다.

| exact target ID | 시도 / 장 구간 | HTTP / 판정 | 선행조건 및 reason |
| --- | --- | --- | --- |
| `custom-api:GET:/api/v1/backtest/data/coverage` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 deployment 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/jobs/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 목록 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 run 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/runs/{run_id}/trades` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 같은 기존 run 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 strategy 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/versions/{version_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 관찰된 기존 version 1개 사용; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/backtest/strategies/{strategy_id}/diff` | 미시도 / REGULAR 실행 | — / BLOCKED | 서로 다른 version 2개 필요, 관찰값 1개; `BLOCKED_NO_EXISTING_RECORD` |
| `custom-api:GET:/api/v1/backtest/deployments/{deployment_id}/signals` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 deployment 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/ingestion/jobs/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 목록 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |
| `custom-api:GET:/api/v1/brain/chats` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 conversation 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/analysis/entity-timeline` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 god-node entity 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/brain/analysis/entity-detail` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 같은 기존 entity 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/internal/canvas/realtime-bindings/{operation_id}` | 10:53:46 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 websocket catalog operation 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/catalog/{operation_ref}` | 10:53:47 / REGULAR | 200 / PASS_HTTP_SCHEMA_ONLY | 기존 catalog operation 선택; `HTTP_RESPONSE_SANITIZED` |
| `custom-api:GET:/api/v1/projects/{project_id}/tree` | 10:53:47 / REGULAR | 404 / BLOCKED | 기존 project 선택 후 target 404; `SOURCE_HTTP_STATUS`, 원인 미확인 |
| `custom-api:GET:/api/v1/projects/{project_id}/file` | 미시도 / REGULAR 실행 | — / BLOCKED | 선행 tree 404로 file path 미확보; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/projects/{project_id}/env` | 10:53:47 / REGULAR | 404 / BLOCKED | 기존 project 선택 후 target 404; `SOURCE_HTTP_STATUS`, 원인 미확인 |
| `custom-api:GET:/api/v1/routines/{routine_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전 설정에서 선행 routines GET 503; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/routines/{routine_id}/runs` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전 설정에서 선행 routines GET 503; `SOURCE_HTTP_STATUS` |
| `custom-api:GET:/api/v1/backtest/source/map/{job_id}` | 미시도 / REGULAR 실행 | — / BLOCKED | 안전한 기존 목록 없음; `NO_SAFE_EXISTING_LIST_SOURCE` |

초기 sweep 실제 HTTP 27개와 chain business HTTP 21개는 선행 목록 8개가 겹쳐 exact ID 합집합이 40개다. 이번에 새로 시도된 target은 13개다. project tree/env 404는 원인 미확인이므로 product defect로 확정하지 않는다. 이전 `custom-read-chain-live-20260907T014622-124Z.json`의 `OPENAPI_RESPONSE_TOO_LARGE`는 metadata 1회, business 0회에서 발생한 harness 한도 문제이며 서비스 장애로 분류하지 않는다. 두 실행 artifact에는 raw body, 실제 identifier, chat/file/env 값, credential이 없다.
