# 장 운영 전수 검사 상태

## 현재 요약 — 2026-09-07 13:16 KST

- **전체 판정: 진행 중 / PARTIAL.** 장전 불량과 공백이 있었고 장중 실측 중이며, 15:30~16:30 장후 구간은 아직 도래하지 않았다.
- 최신 main `ac8452f`에서 `codex/market-session-audit-20260907`를 생성했다. 제품 추적 파일 변경0, 이번 감사 docs/scripts만 추가. main 병합/원격 push 없음.
- **12:24 실제 heartbeat 재개에서 관찰 중단을 발견하고 복구했다.** 현재 app16660(12:29:36), backend30112→30248, watcher27844(root16660)이다. Windows 마지막 부팅은12:18:09이며 과거 PID25412는cmd.exe로재사용되어건드리지않았다. 직전11:11:40부터새첫관찰12:29:36까지 **77분55.708초의 관찰 간격**이 있다. 정확한 중단 시각은 미관측이며 연속 정상으로판정하지않는다. 첫복구샘플은HTTP2/4,12:30:36에4/4=200을확인했다.
- 현재 원천 대장은 `inventory-expanded-20260907.json`의 **1396행**이다. 원본1394행을 보존하고 소스에서 누락됐던 MCP canvas render/save 두 표면만 추가했다. MCP 도구12개/action58개이며 신규 두 행은 SOURCE_DECLARED/LIVE_NOT_RUN이다. 고유 제품 기능 수와는 다르다. fixture/static/live/미검증을 분리한 `COVERAGE.md`를 기준으로 추적한다.
- 13:08 도구 metadata POST search/describe 두 개를 실제 실행했다. 두 응답 모두 HTTP200이며 검색의 적격 query 후보와 describe의 동일 ref/kind를 확인했다. **PASS_HTTP_JSON_SHAPE_ONLY**는 전체 응답 모델·데이터 정확성·사용자 기능 전체 통과를 뜻하지 않는다. 실제 mode=loopback_live, metadata1/business2/수신3이다. 자체API 실제 호출 누적은 GET41+POST2=고유43개이며, coverage 반영 시에도 원본 GET 러너의 범위밖77 분류와 당시 NOT_RUN 기록을 보존한다.
- 조회 264개 중 **259개**를 정규장에서 실제 호출했다. 10:22 추가4개 이후13:12에 실제 선행 응답으로 입력을 해소한7개를 추가 실행했다. 최신 체인은 source4+target7=11회 모두 HTTP200/returnCode0이며 선언된 응답 root 존재만 확인했다. 한 페이지만 검사했고 pagination/freshness는 NOT_VERIFIED다. 나머지5개는 입력 의미·출처를 추가 확인 중이다. 설정된 Kiwoom mockapi 환경의 응답이며 실계좌·화면 표시의 정상 증거와는 구분한다.
- 자체API124개 중 고유 GET41개를 실제 호출했다. 최초27개 이후10:53 체인13개,12:34 유효프로젝트 선택 보강 후 체인14개를 실행해 누적 범위를 넓혔다. 최신 GET체인20대상은14개 HTTP2xx·JSON파싱·구조관찰과6개 선행조건 차단이며22business요청에는선행GET8개가포함된다. 원본 `PASS_HTTP_SCHEMA_ONLY`는 OpenAPI응답스키마validator/필드의미/데이터정확성검증을뜻하지않는다. 최초GET러너범위밖77개 중 POST2개를13:08에 실행했으며 나머지75개는별도검증이필요하다. 최초루틴503 3개는비활성설정결과다.
- 13:16:36 최신 관찰은 health/ready/accounts/OpenAPI4개 모두 HTTP200(4.0~17.3ms), 소유 앱16660 신원 일치다. 현재 watcher48개 표본과 실제실행 실패0은 관찰 도구 상태이며, 과거77분55.708초 공백이나 첫복구HTTP2/4 결과를 없애지 않는다.
- app unit3320통과, backend전체3763통과/6skip. skip5개 신규평가코퍼스 공백과1개Windows 환경 제한을 별도 기록했다. 카드95/96·화면89/90 fixture통과 및 미니/계약 불일치는 `DEFECTS.md`에 유지한다.
- 수동 WS 수신은 연결 및 정상종료를 확인했으나 15초 동안 이벤트 0이며 등록을 시도하지 않았다. UI 재검사에서 5개 mode 컨트롤·현재 캔버스와 설정 4개 탐색·복원을 확인했다. backend read 및 mode 클릭은 미검증이다.
- BOOT-003: 09:49 종목 인덱스 준비 실패 후 동일 앱이 09:57:55에 3,525개 적재를 회복했다. 소스에 늦은 성공을 부팅 task로 전달하는 경로가 없어 상태 전파 결함으로 기록했다. 회복 뒤 readiness 재캡처와 종목 사용자 흐름은 미검증이다.
- 프로젝트 선택·관찰 이력 보강까지 반영한 감사 도구12개 파일은113/113(4.713초,fail/skip/todo0)을통과했다. 별도작성중인POST메타데이터/동적입력체인 테스트는이숫자에포함하지않는다. custom GET 체인은초기20/20·프로젝트보강23/23독립검토를거쳤고, 최초OpenAPI크기실패는business0으로종료후metadata전용8MiB상한을보강했다. 최신4개조회·modefixture·두차례custom체인/실제UI증거를COVERAGE에명시적으로연결했다.
- 추가 fixture: backtest 5/5, session restore 42/42, 독립 graph 140/140, agent Paper parity 실패 0. 전체 fixture 화면 검사는 단언 5개가 실패했으며 제품·환경·기대값·timing 후보를 `MODE-FIXTURE-DETAILS.md`와 `DEFECTS.md`에 분리 기록했다.
- AUTH-OBS-001의 expired/ready는 서로 다른 원장 계약으로 설명됐다. 별도로 활성 계좌 선택이 direct REST의 backend 계좌 선택에 전달되지 않는 AUTH-002를 소스에서 확인했다. 실제 계좌 전환 결과와 자격증명 동일성은 미검증이다.
- 프로젝트 tree/env404는러너가 `exists:false`인 첫 등록항목을선택한검사입력문제였다. 유효한기존디렉터리선택조건과회귀를보강하고독립23/23검토후12:34에tree/env/file3개HTTP200을확인했다. 기존자료수정·프로젝트생성·제품코드수정은없다. 원본404를보존하며상세는 `PROJECT-READ-GAPS.md`, `CUSTOM-READ-CHAIN.md`에기록했다.
- 12:30 새UI실측에서도설정4개탐색·복원을확인했다. stock-index는succeeded이며rawFAIL은검사에서비활성화한alarm/routine gate2개다. 이는이전BOOT-003의늦은복구상태전파결함을수정한증거가아니다. 새5mode클릭·전체route/card·설정backend내용검증은여전히남는다.

## 시작 기록

08:22 main/clean 확인 후 감사 브랜치를 생성했다. 첫 관찰 시 앱/backend는 미실행이었다. 아래는 당시 시각별 원본 경과이며 최신 상태는 위 요약과 마지막 실측을 기준으로 한다.

## 장전 관찰

- 08:27:19: Electron PID 24500 기동. 주문 API 및 기존 루틴 scheduler는 명시적으로 비활성화한 감사 실행이다. 관련 기능의 live 실행은 제한 상태로 기록하고 격리 테스트를 별도로 수행한다.
- 08:27:20: 앱 launcher가 backend를 spawn.
- 08:27:32: 12초 준비 대기 실패. 08:27:52: boot gate degraded.
- 08:28:20: 60초 hard deadline 초과로 launcher가 자신이 시작한 backend를 종료. 08:30 이후에도 `/health` 연결 실패(`000`). DEFECT `BOOT-001`로 진단 중.
- `automation-2` 생성 성공, ACTIVE, 5분 간격. 아직 실제 예약 wake 결과는 확인 전이다.

당시 `정상 작동` 판정 불가: backend 기동 실패가 live 검사 선행조건을 차단했다. 독립 원인 진단과 전수 대장/검사 하네스 작성, baseline 회귀검사를 병렬 진행했다.

## 구조·격리 회귀 검사

- app Node unit: 3,320 / 3,320 통과, fail/skip/todo 0. Node 실행 20.18초, wall 21.41초.
- backend capability/manifest 및 인증·주문 guard 9개 파일: 125 / 125 통과. 고유 임시 HOME/USERPROFILE 격리, pytest 38.19초. 외부 주문/broker/LLM 호출 없음.
- 위 결과는 unit/fixture baseline이며 실제 장중 데이터·화면 전수 통과를 뜻하지 않는다. Paper/UI fixture 전수 검사는 이어서 실행한다.

- 독립 계획 검토: `audit_plan_review` 최종 OKAY. 전수 원천·미니 10종·비Kiwoom API/MCP/IPC·안전/예약/수정 분기 조건 승인. 이는 실행 결과의 승인이 아니다.
- 08:33:53 실제 observer: PREOPEN, health/ready/accounts/OpenAPI 모두 연결 실패 0/4. 첫 artifact의 프로세스 수 69는 일반 Node/Python 후보가 섞인 수이므로 Athena 자원 사용량으로 해석하지 않는다. 해당 하네스 scope 보정 중.
- read-sweep dry-run: read 264개 = 입력 준비 후보 248개 + BLOCKED_INPUT 16개, 실제 호출 0. 단위검사 6/6, 별도 코드리뷰 진행. 후보 수는 live 성공 수가 아니다.
- Paper 카드 fixture runtime: 96장 실행, 95 통과/1 실패(`137X-2`). `CARD-001` 기록. 실제 live 데이터 검사는 아니다.
- `npm run verify:paper`는 Electron 런처 파일 부재로 일부 프로브를 시작하지 못하여 direct electron.exe로 검사 중. `ENV-001` 기록.

- 08:40:24 실제 체크포인트: health/ready/accounts/OpenAPI 연결 실패 0/4 유지. 증거 `observer-20260906T234024-890Z.json`. 예정 08:40 대비 실제 관찰 지연 24초를 그대로 기록한다.
- 위 시점 repo 전체 프로세스 지표는 병렬 fixture/단위 검사 자식도 포함하므로 실제 사용 앱의 성능 수치로 판정하지 않는다. 앱 소유 PID 트리를 분리하는 observer 보완 중이다.

## 08:44 이후 임시 복구 및 지속 관찰

- BOOT-001 진단: 실제 3,525개 종목명 정규식 준비가 39.282초(격리 lifespan 42.175초의 약 93%). 초기 provider worker 기동과 경합하며 최초 launcher 60.011초 제한에 걸렸다. 제품 코드는 미수정. 근거 `boot-diagnosis.md`.
- 08:44:14 manual backend PID 32552를 동일 코드/안전 환경으로 8010에 기동. 08:45:23 `/health`, `/ready` 200. **기존 launcher 실패의 수동 우회이며 정상 기동 경로 수정 완료가 아니다.**
- ENV-001 복구: 감사 소유 앱 PID 24500 트리만 종료한 후 `npm ci --no-audit --no-fund`(125 packages, 11초)와 현재 고정 Electron 43.4.0의 `node node_modules/electron/install.js` 실행. `.bin/electron.cmd`, `electron/cli.js`, 100/200 percent pak 파일 복구 확인. dependency/lock 변경 없음.
- 08:46:57 새 Electron PID **44960** 기동. 기존 사용자 프로세스는 건드리지 않았다. 수동 backend는 앱 프로세스 트리 밖의 PID 32552이므로 종료 시 별도 소유 확인이 필요하다.
- 같은 시각 watcher PID **43972** 시작: `node scripts/market-session-audit/watch.mjs --root-pid 44960`. 60초 간격, 오늘 16:30 종료, 순차 관찰. `watch-20260906T234657-199Z.json` 실제 실행 증거, stderr 0 byte 확인.
- 첫 연속 관찰 `observer-20260906T234657-221Z.json`: health/ready 200, accounts/OpenAPI는 최초 2초 timeout. 앱 PID 신원 검증 true. 해당 샘플만으로 전체 데이터 준비 완료를 주장하지 않는다.
- 하네스 보안/판정 리뷰: observer/watch 16개 테스트 통과와 읽기 전용 연속 관찰 승인. read-sweep는 freshness·pagination·untrusted text 저장 경계를 보완했으며 별도 재리뷰 전 live 호출 금지.
- **현재 소유 프로세스 요약:** app 44960, manual backend 32552, watcher 43972. 재시작하면 PID와 watcher root를 함께 갱신하고 신원을 재확인한다.

- 08:47 이후 지속 샘플에서 HTTP4/4, 계정 ready2/2·WS ready2/2, OpenAPI paths408 확인. backend parent32552/리스너25412는 유지되고 있다.
- 앱 재기동의 manifest1.5초 검사 timeout이 정상 backend를 중복 스폰한 BOOT-002도 재현 확정했다. 중복 자식만 credential lock/code3로 종료되었으며 기존 backend는 유지된다. boot gate degraded의 별도 원인은 미확정이다.
- 08:56:28 삼성전자 `base:ka10003` 실제 read 1회: HTTP200, return_code0, 데이터 배열1행. source는 설정된 Kiwoom mockapi. 원문/가격/계좌 미저장, 현재성·UI 표시 검증 전이라 전체 PASS가 아니다. `read-smoke-20260907T085628KST.json`.
- 최신 전수 원천 대장: 1,394행(고유 제품 기능 수 아님), 참고/폐기42 N/A, 동적발견4 BLOCKED. 자체 API121+service3, MCP10도구/58action, IPC122+미해결2도 포함. 실제 runtime 목록 대조와 상태 적용성은 별도 진행한다.

## 조회 전수 실측 실행

- read-sweep 최종 08:59 코드: 주문/OAuth/redirect/민감 원문/무한 페이지네이션 경계 리뷰 및 15개 회귀 통과. 현재성 기대 정책이 원천에 없으면 성공 응답도 NOT_VERIFIED/BLOCKED로 유지한다. sweep만으로 전체 정상/현재 가격 정확성을 주장하지 않는다.
- 실행 시작: `node scripts/market-session-audit/read-sweep.mjs --execute --base-url http://127.0.0.1:8010 --rate-ms 1000 --timeout-ms 15000 --max-pages 5`.
- 현재 exec session **39924**가 진행 중이다. 같은 sweep를 중복 실행하지 말고 완료 결과를 수집한다. 후보248/입력차단16, 각 operation/page에 실제 observedAt/marketPhase를 별도 기록한다.
- 오늘 장전 구간은 첫 backend 불량과 복구로 관찰 공백/미검증 항목이 있다. 개장 후 성공으로 그 장전 항목을 소급 PASS 처리하지 않는다.

## 개장 후

- 09:00:57 실제 첫 정규장 관찰: phase REGULAR, HTTP4/4 정상. 09:01:57에도 유지. 예정 09:00 대비 실제 57.290초 지연을 기록한다.
- runtime API 대조 완료: 09:03:57 OpenAPI operation422 = generated301 + custom121, 정적 대비 양방향 차집합0/0. MCP tools/list와 실제 기능 실행 결과는 별도 미검증이다.
- 검사 도구 통합 회귀: 실제 Node.js로 5개 테스트 파일 **40/40** 통과. 독립 검토 내역은 `HARNESS-REVIEW.md`.
- 진행 중 backend 전체 격리 회귀는 no-xdist 단일 프로세스로 실행되며, app/sweep/watch와 다른 임시 HOME/cwd의 in-process 검사다. 종료 결과를 수집하기 전 전체 backend suite 통과로 표시하지 않는다.

## 09:10 검사 진행 및 관찰기 교체

- 09:07:19 read sweep 완료: 전체 read 264개 중 248개 호출, 입력 차단 16개. 원시 판정 FAIL 59 / BLOCKED 205 / PASS 0. 빈 응답이 정상인 기능도 있으므로 FAIL을 제품 불량 59개로 단정하지 않는다. `READ-DETAILS.md`에서 항목별 원인을 대조한다. 시작 시각의 PRE_OPEN phase와 각 operation/page의 실제 phase를 구분한다.
- 09:10:40.335 KST 관찰기만 제어된 교체: Node executable과 command line으로 소유를 확인한 PID 43972를 종료하고 PID **21452**를 시작했다. 앱 44960 및 backend 32552/25412는 계속 유지했다. 새 코드는 관찰/메타데이터 실패를 명시적으로 종료 기록하고 과거 체크포인트를 소급 성공 처리하지 않는다.
- 이전 관찰기 artifact와 `watch-checkpoint-correction.json`은 보존한다. 구 관찰기의 finished_at 부재는 이번 계획된 교체이며 제품 실패가 아니다. 신규 관찰기의 MISSED_BEFORE_START는 신규 실행 기준이므로 기존 09:00 실제 관찰 증거를 무효화하지 않는다.
- 관찰기 교체와 함께 실제 Node.js로 5개 파일 통합 회귀 **42/42 통과**, fail/skip/todo 0, 1.692초. 새 실행 로그는 `watch-v2-stdout.log` / `watch-v2-stderr.log`.
- 독립 검증: branch/main/origin 기준 동일, tracked diff0, 소유 PID 유지, 연속 artifact 및 42개 회귀 확인. 초기 설정·실측 준비 PASS, 전체 장중 검사 판정은 PARTIAL이다.
- 조회 상세 대장 `READ-DETAILS.md` 완료: 264개 ID 누락0/중복0. 실제 장전23/장중225/미실행16, HTTP200 248개. 원시 실패는 빈 데이터32 + business code27이며 아직 제품 불량 확정 수가 아니다. 현재 연결은 설정된 Kiwoom mockapi 환경이다.
- ENV-001 표준 명령 복구 확인: `npm run verify:paper-manifest` exit0, `.bin/electron.cmd --version` v43.4.0 exit0, Electron Node-mode probe syntax check exit0. 증거 `baseline-tests/electron-launcher-recovery-20260907-085357-46924.log`. 원래 제품 boot 불량과 별개의 설치 환경 복구이다.
- 09:17:40.507 실제 연속 샘플: HTTP4/4 모두200, 지연4.1~17.6ms, 계정/WS ready각2/2. 신규 watcher8회 관찰·observation/metadata 실패0. 이 수치는 HTTP 준비 상태이며 live 사용자 흐름의 전수 성공은 아니다.

## 09:30 backend 전체 격리 회귀 완료

- 실제 완료 로그: **3,763 passed / 6 skipped / 1 warning**, pytest 1,916.65초(31분56초), exit0. 수집3,769개. 고유 임시 HOME/cwd, child env의 live credentials 제거, dotenv 없는 cwd, no-xdist 단일 프로세스에서 실행했다.
- 증거: `baseline-tests/backend-full-isolated-nodotenv-20260907-085650-16072.log`. 6개 skip = Windows symlink 생성 권한 부족1 + selector v5 봉인 신규100문항 코퍼스 미작성으로 명시 차단된5개. 후자5개는 필요한 검증 공백이며 `QA-EVAL-001`로 기록한다. warning은 Starlette/httpx2 deprecation이다.
- 3,169번째 `test_selector_autonomous_eval.py::test_python_resolver_passes_shared_app_conformance_vector`가 약17분 고CPU 후 통과했다. 전체 suite의 긴 무출력 구간은 이 테스트로 좁혀졌으며, 실제 사용자 요청 지연과 같은 수치로 해석하지 않는다.
- 별도의 app unit3,320/3,320, backend focused125/125, 카드·화면 fixture 실패, live 조회의 차단/미확정 판정은 각각 유지한다. backend unit 통과로 UI/live 전수 검증을 대신하지 않는다.
- 독립 test lane이 사용자 brain/backtest/routines/projects 파일 metadata(length/mtime)의 전후 동일함을 확인했다. 전체 검사에 live upstream/broker/LLM 호출은 없고 mock/stub/loopback 경로였다.

## 09:34 자체 API 및 09:37 정규장 조회 보완

- 독립 operationId/안전 검토 후 자체 GET 검사 완료(`custom-read-sweep-20260907T003436-339Z.json`). 원천124개 중 실제27개 호출: HTTP/JSON schema 단계24통과, 루틴503응답3개. 안전 입력 미확정20개, 해당GET러너 범위 밖77개. 전체 제품 기능 PASS가 아니다.
- 루틴503 세 건(`/routines`, `/routines/briefing-budget`, `/routines/source-catalog`)은 검사 backend의 `ATHENA_ROUTINES_ENABLED=false` 및 route guard와 일치한다. 원시FAIL은 보존하고 `EXPECTED_DISABLED/BLOCKED_SAFE_CONFIG`로 판정했다. 이를 제품 불량3개로 세지 않는다. 상세124개는 `CUSTOM-API-DETAILS.md`.
- 장전에서만 실행됐던23개를 실제 정규장에서 다시 호출했다. `read-sweep-20260907T093755KST.json`: 선택23/실행23, 원시FAIL2/BLOCKED21, 모두REGULAR. 이전225개 장중 실행과 합쳐 **입력 준비된248개 read가 정규장에서 모두 최소1회 실제 호출됨**. 나머지16개 입력차단과 현재성·내용 검증 공백은 유지한다.
- 이전 장전23개 중 rawFAIL8이 정규장 재검사에서2로 바뀌었다. 제품 코드를 수정한 결과가 아니며 시장 단계·데이터 상태 변화와 구분해야 한다. 두 시점 비교를 `READ-DETAILS.md`에 추가한다.

## 09:41 WS 수신 및 09:43 UI 관찰 전환

- `ws-passive-20260907T004108-394Z.json`: 실제 fixed loopback WS 연결, auth first frame 전송,15초 수신창 유지, close1000 및 전용 dispatcher 정리 완료. 기본 backend 계정 범위이며 계좌별2종 전수 증거가 아니다.
- REAL 이벤트0, 인증은 명시 ACK가 없어 `NOT_REJECTED_NO_ACK`, 결과 `NOT_OBSERVED`. REG/REMOVE/조건 등록을 하지 않았으므로 이벤트 미수신을 제품 실패로 단정하지 않는다. 23개 원천에는19개 실시간 유형과4개 조건검색 operation이 함께 포함되며 조건검색4개를 passive 수신으로 실행 검증했다고 주장하지 않는다.
- 09:43:52 앱 executable/원래 생성시각, watcher command, backend listener25412를 검증하고 감사 소유 앱44960 트리와 관찰기21452만 종료했다.09:43:53 앱35880을 검토된 `live-ui.cjs`로, 관찰기48060을 새root로 시작했다. backend32552/25412는 계속 유지했다.
- 전환 증거 `app-transition-20260907T094352KST.json`. 제품 코드 수정 없음. 기존 phase 기록은 보존하며 이 계획된 앱 재시작 공백을 연속무중단으로 표시하지 않는다.
- 첫 UI 실측 artifact `live-ui-2026-09-07T00-43-53-375Z-35880.json`:23.456초 후 실제handoff, shell/orb2창,현재summary캔버스와5mode버튼geometry확인. boot의failed task는alarm-bootstrap/routine-feed로, 검사에서루틴을비활성화한조건과일치한다. backend/stock-index/brain/graph/canvas-feed는succeeded. 이번재시작의기존backend재사용은119ms/중복spawn0이었다.
- UI settings첫조회에서감사러너의renderer JS가정의하지않은`key`를참조해AUDIT_FAILED. 복원은mode/settings/selection모두true이며제품화면실패로단정하지않는다. HARNESS-UI-001로기록하고러너만최소수정/실제JS회귀후재실행한다.
- 읽기전용계좌집계는앱2개/active1/expired2,backend준비집계는ready2/2였다. 앱local tokenExpiresAt와backendcredential cache의계좌동일성/신선도를아직대조하지않았으므로인증전체정상또는제품불량으로단정하지않는다. MCP14등록/13승인/승인toolCount합93은registry metadata이며실제tools/list실측이아니다.

## 09:49 UI 재검사 완료와 후속 관찰

- 감사러너의renderer key누락을수정하고VM회귀/독립재리뷰후소유앱35880/관찰기48060을계획재시작했다. 현재app49728/watch44124,backend32552/25412유지. 전환artifact `app-transition-20260907T094838KST.json`. taskkill exit128이었지만원래root및직접자식0을후속확인했다. 사전전체descendant PID목록을보존하지않아모든고아자식0이라고단정하지않는다.
- 최종UIartifact `live-ui-2026-09-07T00-48-39-849Z-49728.json`:09:49:03.268handoff,09:49:03.726완료,error없음.5mode버튼존재/활성/geometry와현재summary캔버스확인,설정screen/accounts/model/history4개모두탐색·패널render/effective/구조settled확인,원래mode/settings/선택복원모두true. HARNESS-UI-001은이제수정후실측까지확인됐다.
- 설정의실제backendread결과는`BACKEND_READ_NOT_VERIFIED`,5mode버튼클릭은새대화생성부작용으로이러너에서BLOCKED.90route/96card/10mini전체livePASS를주장하지않는다.
- boot rawFAIL에는기존루틴비활성화2개외**stock-index**가추가됐다. 첫09:43기동에서는succeeded였으므로변동원인을BOOT-003에서별도조사한다. 이로인해전체UIartifact rawstatusFAIL을보존한다.
- 09:58:39.980 관찰:HTTP4/4=200(5.2~21.3ms),root49728신원검증true,신규watcher11회·관찰/metadata실패0.기본HTTP정상으로stock-index초기실패를소급통과시키지않는다.
- 감사도구10개테스트파일통합회귀 **78/78pass**,fail/skip/todo0,1.890초.제품회귀와별개의검사도구검증이다.
