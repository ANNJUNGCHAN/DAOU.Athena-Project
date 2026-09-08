# Side-effect-free custom compute POST probe

기준 revision: `ac8452f5b62a338d74826ac27cf65da12d99320b`

`scripts/market-session-audit/custom-compute-probe.mjs`는 custom NONGET 중 저장, 실행 이력, optimizer 실행, provider, 주문, 차트 또는 Canvas를 호출하지 않는 계산 POST만 검사한다. 기본은 dry-run이며 실제 `--execute`는 독립 검토와 runtime preflight를 통과한 경우에만 사용한다.

## 포함 대상

| ID | exact route | fixture 입력 | 성공 의미 | 부작용 근거 |
| --- | --- | --- | --- | --- |
| `backtest_validate` | `POST /api/v1/backtest/validate` | repository preset에서 축약한 유효 SMA YAML | `ok=true`, errors 없음 | YAML parse와 계약 검사만 수행([handler](../../../backend/athena_api/api/backtest.py#L205)) |
| `backtest_flow` | `POST /api/v1/backtest/flow` | 기존 technique/API 테스트 계열의 유효 `signals` Python | AST flow node와 param 반환 | `flow_mod.build_flow`만 호출([handler](../../../backend/athena_api/api/backtest.py#L583)) |
| `backtest_map` | `POST /api/v1/backtest/map` | 같은 YAML, `run_id` 생략 | spec map과 일치하는 code map 반환 | `run_id`가 있을 때만 store read; probe는 전달하지 않음([handler](../../../backend/athena_api/api/backtest.py#L593)) |
| `backtest_codegen` | `POST /api/v1/backtest/codegen` | 같은 YAML | `signals` source와 양의 line count | source를 반환하며 저장하지 않음([handler](../../../backend/athena_api/api/backtest.py#L635)) |
| `backtest_diagnose` | `POST /api/v1/backtest/diagnose` | 기존 API 회귀와 같은 NaN 오류 모양 및 명시 Python | line, why, candidate source 반환 | 수정안을 계산하지만 적용·저장하지 않음([handler](../../../backend/athena_api/api/backtest.py#L650)) |
| `backtest_optimize_plan` | `POST /api/v1/backtest/optimize/plan` | fast/slow 5..20 step 5, ascending | 조합 6개, over-limit false | 조합 수만 계산하고 optimizer를 실행하지 않음([handler](../../../backend/athena_api/api/backtest.py#L1091)) |
| `technique_nodes` | `POST /api/v1/backtest/technique/nodes` | 명시 Python | AST nodes, error 없음 | technique source를 실행하지 않고 node로 변환([handler](../../../backend/athena_api/api/backtest_technique.py#L93)) |
| `visual_from_spec` | `POST /api/v1/backtest/visual/from-spec` | 같은 YAML | graph v1과 64자리 canonical graph hash 반환 | 결정적 graph 변환만 수행([handler](../../../backend/athena_api/api/backtest_visual.py#L182)) |
| `visual_validate` | `POST /api/v1/backtest/visual/validate` | 앞 단계 graph | valid graph와 동일 graph hash, diagnostics 반환 | graph 검증과 미저장 preview 계산만 가능([handler](../../../backend/athena_api/api/backtest_visual.py#L84)) |
| `visual_compile` | `POST /api/v1/backtest/visual/compile` | 앞 단계 graph | 동일 graph hash, executable true, saved false, authoritative source map | spec/source를 계산하며 저장하지 않음([handler](../../../backend/athena_api/api/backtest_visual.py#L117)) |
| `visual_question` | `POST /api/v1/backtest/visual/question` | 같은 valid graph | blocking question 없음 | diagnostics에서 질문만 계산([handler](../../../backend/athena_api/api/backtest_visual.py#L150)) |
| `visual_patch` | `POST /api/v1/backtest/visual/patch` | graph hash와 allowlisted `set_param` intent | applied false, 비어 있지 않은 patch ID와 JSON patch | patch/diff만 만들며 적용·저장하지 않음([handler](../../../backend/athena_api/api/backtest_visual.py#L158)) |

visual handler 파일은 runner, store, Kiwoom client를 import하지 않는다. technique `nodes`도 `technique_check`의 cached-bar 및 signals 실행 경로를 호출하지 않는다. 포함된 12개는 모두 현재 handler 구현과 기존 API 단위 테스트에서 부작용 부재가 고정된 경로다.

## 명시적 제외

- `/api/v1/backtest/runs`, `/optimize`, `/data/backfill`: 실행, 저장 또는 데이터 작업을 시작한다.
- strategy/version/deployment POST: product record나 활성 상태를 변경한다.
- `/api/v1/backtest/technique/check`: 저장은 하지 않지만 cached bars로 user `signals`를 실제 실행할 수 있어 이번 compute-only 범위에서 제외한다.
- order, provider, chart, Canvas, OAuth 경로: 이번 probe의 route allowlist에 없다.

## 실행 및 증거 경계

- base URL은 정확히 `http://127.0.0.1:8010`만 허용한다.
- `/openapi.json`에서 각 exact path에 POST 하나만 존재하는지, operation ID와 generic object body schema가 고정값과 일치하는지 먼저 검사한다.
- OpenAPI가 일치한 뒤에만 child environment의 local bearer를 읽는다.
- business 요청은 순차 실행하며 최대 16회, 각 5초, 전체 60초다. 현재 정상 chain은 12회다.
- HTTP 401/403은 본문 JSON/크기 검사보다 먼저 인증 실패로 판정하고 남은 business 요청을 모두 중단한다.
- 각 결과에는 UTC 요청 시각, KST market phase, HTTP status와 operation별 최소 semantic 판정만 저장한다.
- YAML, Python, graph, generated source, candidate fix, hash 외 원문 응답, token, 계좌, 가격, 로그는 artifact에 저장하지 않는다.
- fixture hash는 입력 재현성을 나타내고, runtime PASS는 실제 endpoint의 HTTP 및 semantic 응답만 나타낸다. fixture 유효성과 실제 runtime 증거를 서로 대체하지 않는다.
- PASS는 해당 bounded payload의 계산 계약만 증명한다. 전체 백테스트 실행, optimizer 결과, provider 연결, 사용자 UI, 장중 전체 기능 정상으로 확대하지 않는다.

## 검증 및 실제 관찰

`scripts/market-session-audit/custom-compute-probe.test.mjs`는 fake fetch와 audit-owned 임시 디렉터리만 사용한다. exact scope, OpenAPI drift, dry-run 0-network, 12-route semantic success, `run_id` 부재, unapplied patch, redaction, JSON이 아니거나 oversized인 401/403의 즉시 auth stop, visual graph hash 연결, 빈 patch ID 차단, unsafe URL 및 CLI revision을 검사한다.

작성본은 독립 검토를 통과했고, probe script SHA-256 `E319DCCCCF62EC59007FEED58F90E241ED3C5B3E29D59B0DC8129EBBBB614E64`를 유지한 상태에서 2026-09-07 15:13 KST에 실제 실행을 한 번 수행했다. 이전 preflight 시도들은 검토되지 않은 source 또는 이전 listener PID를 발견한 단계에서 중단됐으며 business network 요청은 0회였다.

실행 직전 `2026-09-07T06:13:05.713Z` preflight에서 다음 provenance를 확인했다.

- Git HEAD: `ac8452f5b62a338d74826ac27cf65da12d99320b`
- listener PID `44724`, 생성 시각 `2026-09-07T05:58:02.068393Z`
- parent PID `12380`, 생성 시각 `2026-09-07T05:58:02.008301Z`
- parent process가 원본 프로젝트의 기존 virtual environment 경로를 사용한 사실
- 기준 revision 대비 source 변경은 canvas 계열 3개, generated runtime 1개, selector service 1개였다. 독립 검토에서 이번 pure compute 경로의 handler 3개와 호출 delegate는 해당 변경과 무관하며 blob이 그대로임을 확인했다. 따라서 이 provenance는 12개 대상의 현재 실행 근거이며, 사용자가 실행 중인 backend 전체가 고정 baseline이었다는 뜻은 아니다.

실제 증거는 [custom-compute-probe-20260907151307KST.json](../../../artifacts/market-session-audit/2026-09-07/custom-compute-probe-20260907151307KST.json)이며 SHA-256은 `67B94493CA2E18746AABD9BE086E8056B7A87A0E368FE179638DEF40800AC4D1`이다.

- 관찰 시작: `2026-09-07T06:13:05.829Z` (`REGULAR`)
- business 요청: 12회, metadata 요청: 1회
- 결과: 12 attempted, 12 `PASS_HTTP_JSON_SEMANTIC_CONTRACT`, 0 blocked
- 모든 business 응답: HTTP 200
- 개별 호출 시각: `2026-09-07T06:13:06.051Z`부터 `2026-09-07T06:13:07.887Z`까지, 모두 `REGULAR`
- 실행 중 provider 호출, store 저장, optimizer 실행은 하지 않았다.

이 결과는 repository test와 preset에서 만든 명시적 안전 fixture가 12개 계산 handler의 bounded HTTP/JSON/semantic 계약을 통과했다는 증거다. fixture 자체에는 시장 데이터가 없으므로 전략 수익률, 실제 매매 성과, provider 정상성 또는 다른 입력에 대한 일반적 정확성을 증명하지 않는다.
