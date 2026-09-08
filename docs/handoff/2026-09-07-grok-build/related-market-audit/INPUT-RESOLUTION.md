# 차단 입력 해소 맵

기준 artifact: `custom-read-sweep-20260907T003436-339Z.json`, `read-sweep-20260907T090719KST.json`. 원문 응답·자격증명·계좌번호는 저장하지 않는다. GET 선행 조회로 이미 존재하는 식별자만 채울 수 있으며, 쓰기/주문/백필은 검사 체인에서 제외한다.

## custom API 20건

| ID | 누락/필수 입력 | 안전한 선행 경로 | 판정 |
|---|---|---|---|
| GET backtest/data/coverage | `stk_cd, period, adjusted` | 기존 확인된 quote의 종목코드 + 정적 period/adjusted 옵션 | read chain 가능 |
| GET backtest/jobs/{job_id} | `job_id` | 기존 실행 job GET 결과가 있을 때만 | 현재 ID 없음 |
| GET backtest/runs/{run_id} | `run_id` | 기존 runs 목록의 ID | 현재 ID 없음 |
| GET backtest/runs/{run_id}/trades | `run_id` | runs 목록의 기존 ID | 현재 ID 없음 |
| GET backtest/strategies/{strategy_id}/versions | `strategy_id` | strategies 목록의 기존 ID | 현재 ID 없음 |
| GET backtest/strategies/{strategy_id}/versions/{version_id} | `strategy_id, version_id` | strategy versions 목록 | 현재 ID 없음 |
| GET backtest/strategies/{strategy_id}/diff | `strategy_id` | strategies 목록 | 현재 ID 없음 |
| GET backtest/deployments/{deployment_id}/signals | `deployment_id` | deployments 목록의 기존 ID | 현재 ID 없음 |
| GET brain/ingestion/jobs/{job_id} | `job_id` | ingestion job을 만드는 POST는 쓰기라 금지 | 기존 ID 없음/blocked |
| GET brain/chats | `conversation_id, Authorization` | 기존 conversations GET에서 conversation ID; bearer는 런타임 secret 주입만 | ID 없음, secret 비기록 |
| GET brain/analysis/entity-timeline | `entity_id, Authorization` | brain entity/detail GET에서 기존 entity ID | 현재 ID 없음 |
| GET brain/analysis/entity-detail | `entity, Authorization` | 기존 entity 목록/검색 결과에서 entity | 현재 ID 없음 |
| GET internal/canvas/realtime-bindings/{operation_id} | `operation_id` | catalog 목록의 operation_ref | read chain 가능 |
| GET catalog/{operation_ref} | `operation_ref` | catalog GET 목록의 기존 ref | read chain 가능 |
| GET projects/{project_id}/tree | `project_id` | projects 목록 GET | 현재 ID 없음 |
| GET projects/{project_id}/file | `project_id` | projects 목록 + 파일 path가 필요 | path/ID 없음 |
| GET projects/{project_id}/env | `project_id` | projects 목록 GET; env 값은 비출력 | 현재 ID 없음 |
| GET routines/{routine_id} | `routine_id` | routines 목록 GET | routines disabled/ID 없음 |
| GET routines/{routine_id}/runs | `routine_id` | routines 목록 GET | routines disabled/ID 없음 |
| GET backtest/source/map/{job_id} | `job_id` | source map job을 만드는 POST는 쓰기라 금지 | 기존 ID 없음/blocked |

## Kiwoom read 16건

| operation_ref | 누락 필드 | 선행 조회/안전 체인 | 판정 |
|---|---|---|---|
| `base:ka01301` | `arn_grp_id` | `ka01300`의 `gcod` 응답을 받아야 함 | upstream group code 없음 |
| `base:ka10019` | `tm` | 현 시각을 임의 입력하지 않고 upstream 허용 시간 옵션 확인 필요 | 계약 확인 전 blocked |
| `base:ka10021` | `tm_tp` | 동일 ranking 시간구간 옵션 | 계약 확인 전 blocked |
| `base:ka10022` | `tm_tp` | 동일 ranking 시간구간 옵션 | 계약 확인 전 blocked |
| `base:ka10025` | `prpscnt` | 순위 결과 건수 옵션 | 안전한 기존 값 없음 |
| `base:ka10039` | `mmcm_cd` | `ka10102` 회원사 코드 조회 | upstream code 없음 |
| `base:ka10043` | `mmcm_cd` | `ka10102` 회원사 코드 조회 | upstream code 없음 |
| `base:ka10052` | `mmcm_cd` | `ka10102` 회원사 코드 조회 | upstream code 없음 |
| `base:ka10078` | `mmcm_cd` | `ka10102` 회원사 코드 조회 | upstream code 없음 |
| `base:ka10088` | `ord_no` | 주문번호를 생성/조회하는 쓰기·계좌 주문 흐름은 감사 금지 | 주문 경계 blocked |
| `base:ka30003` | `bsis_aset_cd` | 기존 ELW underlying asset 결과가 있어야 함 | 현재 코드 없음 |
| `base:ka40001` | `etfobjt_idex_cd` | ETF objective index 목록 결과가 있어야 함 | 현재 코드 없음 |
| `base:ka90002` | `thema_grp_cd` | theme group 목록 조회 결과가 있어야 함 | 현재 코드 없음 |
| `detail:kt00010:margin_order_capacity` | `uv` | 유효 증거금 구간은 계좌/주문 문맥 필요 | 주문·계좌 입력 blocked |
| `detail:kt00010:cash_and_withdrawal_capacity` | `uv` | 유효 증거금 구간은 계좌/주문 문맥 필요 | 주문·계좌 입력 blocked |
| `detail:kt00010:purchase_settlement` | `uv` | 유효 증거금 구간은 계좌/주문 문맥 필요 | 주문·계좌 입력 blocked |

## stop rule

선행 GET에서 실제 ID/코드가 관측되기 전에는 placeholder를 만들지 않는다. `DATA_ABSENT`, freshness/pagination 미검증, business return code는 입력 누락과 별도로 유지한다. 주문번호·증거금 구간·계좌/회원사/테마/ETF/ELW 코드가 현재 세션에 없으면 해당 항목은 결함이 아니라 `BLOCKED_NO_SAFE_INPUT`으로 기록한다.
