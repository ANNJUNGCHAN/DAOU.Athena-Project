# 장 운영 전수 검사 불량 대장

확인된 제품 불량, 환경·검사 도구 불량, 원인 미확정 관찰을 분류해 기록한다. HTTP 실패나 빈 데이터만으로 제품 불량을 확정하지 않으며, 수정 후 증거가 없는 항목은 해결로 표시하지 않는다.

## 상세 기록 형식

ID, 제목, P0–P3, 분류, 기능 ID, 최초/최종 시각과 시장 단계, revision/환경, 선행조건, 재현 절차, 기대/실제 결과, 증거 경로, 빈도, 영향, 원인 근거, 관련 파일, 수정 소유자, 회귀 검사, 독립 검토, live 재검증, 남은 검증.

## HARNESS-FINAL5-001 — detail-price 성공 응답의 return_code projection 누락

- 심각도 P1(잔여 read 검증 차단), 분류 감사 하네스 결함. 최초 실제 관찰은2026-09-07 14:04:27 KST/REGULAR이다. 제품 price endpoint 실패로 확정하지 않는다.
- 최초 final-5 실행은 business4/metadata2 요청을 수행했다. `detail:ka10004:sell_bid_prices`와 `detail:ka10001:current_trading`은 HTTP200을 받았지만 성공 응답 projection에 `return_code`가 없어서 raw artifact에 `returnCode:"INVALID"`와 `HTTP_OR_RETURN_CODE_FAILURE`로 기록됐다.
- 기대: 성공 응답의 실제 `return_code`를 projection에 포함해 HTTP와 business code를 함께 판정한다. 실제: projection 누락 때문에 HTTP200 응답 두 개가 하네스 단계에서 차단됐고 이를 사용하는3개 capacity target도 `NO_OBSERVED_SCENARIO_PRICE`로 미시도됐다.
- 영향: 최초 실행에서 새 target `base:ka30003`만 HTTP200/returnCode0으로 통과했다. 당시 대상5개 중1개 통과/4개 차단이며 read 실제 합집합은260/264였다. 잘못된 `INVALID`를 제품 불량이나4개 target 실제 실패로 승격하지 않는다.
- raw 증거는 `artifacts/market-session-audit/read-final-inputs-20260907140429KST.json`, SHA-256 `49EA9078196E1732BD732B7F5DB75C1F9D6A40F17B6B84B606FFF3AB38AEA437`이다. `revision:null` 원본은 수정하지 않고 `artifacts/market-session-audit/2026-09-07/runtime-handoff-first-final5-context-20260907T142208KST.json`에 당시 audit HEAD/PID/source/delta context를 추가했다.
- 수정 상태: success projection 보강과 독립17개 mock 검토 후14:22 실제 재시도를 완료했다. best-ask source가 정상 projection돼 dependent target3개를 실제 호출했으므로 하네스 결함 수정은 live 재검증됐다. 재시도 artifact는 `artifacts/market-session-audit/2026-09-07/read-final-inputs-20260907142216KST.json`, SHA-256 `5E509C64944954714AD3947AC2137F0A83A8D91D1D94FB0C490475ED0BB88EA2`다.
- 재시도 결과: business6/metadata2, target4시도/1PASS/4BLOCKED. 주문이력은HTTP200/code0이나 미체결 주문이 없어 `ka10088`은 미시도, best-ask source는PASS, `kt00010` detail3개는HTTP200/code20 BLOCKED, `ka30003`은HTTP200/code0 PASS다. read 실행 합집합263/264는 통과 수가 아니다. 하네스 결함 완료와4개 제품 기능의 통과 여부를 분리한다.
- runtime 경계: 당시 backend37764→13080 신원과 audit HEAD `ac8452f` 대상 primitive source는 확인했다. 원래 폴더는14:04 `card_surface_contract.py`,14:17에는 `card_surface_templates.py`까지 변경돼 dependency 검토 중이다. 전체 backend baseline 동일성은 주장하지 않는다.

## HARNESS-WS-EVENT-001 — REAL envelope의 nested FID20을 읽지 못함

- 심각도 P1(WS 기능 판정 차단), 분류 감사 parser 결함 확인.2026-09-07 14:28:15 KST/REGULAR, audit `ac8452f`, 원래 폴더 backend39728→listener41172 대상이다. provider 제품 실패로 확정하지 않는다.
- 실제: 메시지159개가 모두 REAL envelope로 수신됐고 wrong_type0/wrong_item0이었다. envelope 내부 event record 집계에서 invalid_time288, valid/fresh0이었다. 일부 matched envelope는 accepted FID20 시간 값이 없거나 현재 parser의 허용 형태를 충족하지 않았다.
- 판정 경계: artifact의 `BLOCKED_NO_LIVE_EVENT`는 네트워크 트래픽0을 뜻하지 않는다. REAL 트래픽은 있었지만 시간·freshness 계약을 통과한 기능 이벤트가0이라는 뜻이다. invalid_time 수가 메시지 수보다 큰 것은 envelope 내 복수 event record 집계 가능성이 있어 source/parser 조사 전 임의로 오류 수를 메시지 수와 같게 만들지 않는다.
- 제어·정리: REG1은 `CONTROL_ACK`, REMOVE1은 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`, socket은 `OWNED_SOCKET_CLOSED`다. upstream REMOVE ACK는 false이며 cleanup API0을 upstream 해제 완료로 해석하지 않는다. 주문·조건·계좌 mutation은0이다.
- 증거: `artifacts/market-session-audit/2026-09-07/ws-active-stock-20260907T052815-996Z.json`, SHA-256 `CE5760E161B183D23DF8A0105DEC79559978A1A8A8DB9D83D516F49367D4E622`. 승인된 probe script SHA prefix는 `D8B031`이다.
- 원인: 기존 parser는 top-level `row["20"]`만 읽었지만 source와 canonical fixture의 체결시간은 nested `row.values["20"]`에 있다. 이 때문에 실제 REAL row의 시간을 받아들이지 못했다.
- 수정 상태: nested canonical 형태를 읽도록 수정했고 집중20개 mock 및 독립 검토를 통과했다.14:43 첫 재실행 preflight는 새 original production diff `api/canvas_push.py`의 dependency 독립성 확인을 위해 CLI/network 이전에 중단했다. 검토 후14:46 실제 재실행에서 nested FID20 valid/fresh row1개를 관찰해 parser 수정은 live 재검증됐다. 원본159 REAL artifact는 변경하지 않는다.
- 재실행 경계:23 REAL messages, REG 전 baseline matching42, REG 뒤 matching/valid/fresh1(`<=5s`), invalid/stale0. `PASS_WITH_CLEANUP_UNVERIFIED`는 matching fresh data 관찰을 뜻한다. baseline traffic 때문에 REG 인과관계는 미검증이고 REMOVE API0/synthetic는 upstream ACK가 아니다. 다른22 WS route의 실제 기능은 미검증이다.

## HARNESS-WATCH-ADMISSION-001 — null 생성시각 뒤 watcher를 시작함

- 심각도 P2, 분류 watcher handoff admission 결함.2026-09-07 14:36:30 KST, 후보 app34040 대상이다.
- 기대: PID·실행경로·생성시각을 모두 검증하고 어느 값이든 null이면 watcher 시작 전에 fail closed한다. 실제: null CreationDate가 nonterminating PowerShell 오류만 만들고 Start-Process가 계속돼 watcher41668이 시작됐다.
- 영향: target34040은 이미 사라져 첫 artifact `watch-20260907T053631-114Z.json`이 root_found false였다. 이를 정상 handoff나 제품 앱 실패로 기록하지 않는다.
- 정리: 엄격한 null 검사와 `ErrorActionPreference=Stop`으로 소유를 확인한 뒤 watcher41668만14:37:23.963 KST에 종료했다. 사용자 app/backend 등 제품 프로세스는 제어하지 않았다. 기존 watcher39368은 새 watcher44784의 첫 검증이 끝날 때까지 endpoint와 root6104 missing을 기록했다.
- 후속: 미래 retarget 명령은 null을 terminating error로 처리해 Start-Process 전에 중단한다. 안정된 현재 앱 신원이 확인될 때까지 후보 PID를 반복 추격하지 않는다.
- live 재검증:14:41 app30288의 non-null creation/path exact 검사를 통과한 뒤 watcher44784를 시작했고 첫 표본 root validated true/HTTP4/4=200을 확인했다. 새 watcher 검증 뒤에만 구 watcher39368을 종료했다. 이후 동일 fail-closed 절차로 watcher46776, watcher46644까지 검증 후 순차 인계했으며, 현재 동결 기준 watcher46644/app36856 첫 표본과15:55:52.043 표본은 root validated true/HTTP4/4=200이다.

## HARNESS-WATCH-PROCESS-001 — 검증된 root의 process_count 측정 공백

- 심각도 P2(관찰 품질), 분류 observer process probe 일시 실패. watcher44784/app30288,14:44:53~14:47:53 KST 네 표본이다.
- 실제: process probe failure로 root_found/root_validated가 미기록돼 신원 판정이 불가했고 process_count는 null, HTTP4/4=200이었다.14:48:53에는 root probe가 다시 정상 값을 기록했다.
- 판정: app 부재 증거가 아니며, 반대로 해당 구간의 연속 app process 건강·자원 사용량 증거도 아니다. HTTP endpoint 준비와 app process 측정을 분리한다.
- 후속: 원본 표본을 보존하고 process probe failure의 오류 분류·재시도 경계를 검토한다. 결측값을0이나 직전 값으로 채우지 않는다.

- 추가 관찰: 새 watcher46776의 첫15:42:48.192 표본도 동일하게 root 필드 미기록/process_count null/HTTP4/4였으나 다음15:43:48.201 표본에서 root34680 true/true, process_count73으로 회복했다. 첫 표본을 app 부재로 분류하지 않는다.

## HARNESS-PHASE-CLOCK-001 — wall-time 1초 단언의 실행 부하 민감성

- 심각도 P2(검사 안정성), 제품 결함 아님.15:23:25.507 실행은202개 중201pass/1fail이며 phase-clock wall-time `<1s` 단언이 실패했다. 이전188개 집계의 live-PID probe 실패2회와 구분한다.
- 수정·검토: test-only phase-clock 경계를 수정하고 집중13/13 승인을 받았다. 최신17파일 집계는15:44:29.692~15:44:46.980에203/203, fail/skip/todo0,17,085.5596ms다.
- 판정: 최신 통과는 하네스 수정 증거다. 이전 실패를 제품 성능 실패로 바꾸거나 serial16의 별도187/188을 전체 통과로 표시하지 않는다. timeout을 임의로 느슨하게 만드는 해결은 사용하지 않는다.

## WS-OWNERSHIP-001 — active catalog23종의 충돌 없는 소유권 발견 부재

- 심각도 P1(WS 전수 검증 차단), 제품 기능 실패 아님. catalog23종은 PURE로 분류됐지만 shared runtime의 기존 lease/구독과 충돌하지 않는 권위적 occupancy·ownership 발견 경로가 없다.
- 안전 판정:23종 모두 unconditional `BLOCKED_OWNERSHIP_DISCOVERY`, control request0이다. 독립 `ws_catalog_review`는4/4 exact23/block-all-network로 승인됐다. 분류 이전에 잡힌 executor 오류는 actual 전 제거됐고 live 제품 실패가 아니다.
- 기존 증거:0B 한 종의 random-group actual은 matching fresh data를 관찰했지만 verdict `PASS_WITH_CLEANUP_UNVERIFIED`이고 upstream REMOVE ACK가 없다. random group은 권위적인 collision-free ownership 증거가 아니다. 사용자 lease가 손상됐다는 증거도 없다.
- 후속: shared runtime에서 추가REG/REMOVE를 하지 않는다. 소유권 발견·충돌 방지·cleanup 검증 계약이 확정되기 전 나머지22종 actual을 실행하거나 전체 WS 정상/불량을 판정하지 않는다.

## OBSERVATION-RUNTIME-002 — 사용자 runtime 교체 중 endpoint 부분 timeout

- 심각도 P2(관찰 경계), 제품 원인 미확정.15:50:48 POSTCLOSE 표본에서 구 app34680은 root false, health/ready는HTTP200, accounts/OpenAPI는각 약2초 timeout/status null이었다.15:51:48에는 HTTP4/4=200으로 회복됐다.
- 새 user app36856은15:49:55.773470에 생성됐고15:51:51 첫 새 watcher 표본에서 root found/validated true였다. backend command 후보 parent46068→uvicorn34264도15:49:26에 생성됐다.
- 판정: runtime 교체와 두 timeout의 인과관계 및 정확한 지속시간은 입증되지 않았다. user replacement가 이미 존재했으므로 전체 앱 outage로 분류하지 않는다. backend 후보는 command에 port8010이 포함됐지만 해당 snapshot에서 TCP listener table과 독립 결합하지 않았다.
- watcher handoff:46644 첫 표본 검증 뒤에만 구 watcher46776을 종료했다. 제품 프로세스 제어0. 증거는 `observer-20260907T065048-270Z.json`, `observer-20260907T065148-292Z.json`, `observer-20260907T065151-994Z.json`, `runtime-handoff-20260907T155321KST.json`이다.

## OBSERVATION-001 — 호스트 재부팅 전후 장중 관찰 공백

- 심각도 P1(감사 증거 공백), 분류 환경/관찰 중단. 앱 제품 crash는 입증되지 않았다. 기준ac8452f, 정규장.
- 직전 watcher 마지막 실측11:11:40.477 KST,84개 관찰 후 `finished_at`/종료 사유 없이 끊겼다.12:24:14.831 실제 heartbeat 재개 후 Windows `LastBootUpTime=12:18:09.957277`을 확인했다. 정확한 이전 종료 시각·원인은 미관측이다.
- 과거 앱49728/backend32552/watch44124가 없고, 과거 listener25412는12:23에 생성된cmd.exe로 재사용됐다. 실행파일과 생성시각이 달라 종료하지 않았다.8010리스너가 없어 새로운 수동backend30112→30248을12:27:26에 기동하고12:28:43에health200을 확인했다.
- 앱16660/watch27844를12:29:36에 시작했다. 첫 실측12:29:36.185는health/ready200·accounts/OpenAPI2초timeout, 다음12:30:36.194는HTTP4/4=200이다. 이전 마지막↔새첫관찰 간격은4,675,708ms(77분55.708초)이며 정확한 PC 다운시간과 같다고 주장하지 않는다.
- 영향: 해당 구간 모든 기능의 연속 동작·리소스·이벤트 관찰은 미검증이다. 과거 기록을 재구성하거나 성공으로 채우지 않는다. 사용자 DB/프로필 삭제·제품 코드 변경·다른 프로세스 종료는 없었다.
- 증거: `host-recovery-20260907T122547KST.json`, `recovery-activation-20260907T123036KST.json`, 구/신 watcher와 각 observer. 새UI `live-ui-2026-09-07T03-29-36-409Z-16660.json`의 설정4개/복원은 성공, stock-index succeeded, 비활성루틴 gate2개로 rawFAIL은 유지한다.
- 복구 상태: 관찰 재개와 서비스 준비 확인 완료. 과거 공백은 해소할 수 없는 오늘의 검증 한계로 남긴다. 제품 수정으로 분류하지 않는다.

## HARNESS-METADATA-001 — OpenAPI metadata 상한이 실제 크기보다 작음

- 심각도 P2, 검사 도구 결함. 최초10:46:22 KST/REGULAR, 기준ac8452f의 감사 도구. live entrypoint가 현재 OpenAPI를 검증하는 단계에서 `OPENAPI_RESPONSE_TOO_LARGE`로 종료했다. metadata1회/business0이며 사용자 기능 호출 실패가 아니다.
- 실제 Content-Length1,082,634바이트가 기존1,000,000바이트 상한을 넘었다. OpenAPI 전용 상한만8MiB로 수정했고 business 응답1MB·기본32회·요청5초·전체60초 제한은 유지했다.
- author `audit_custom_api`, 독립 reviewer `audit_harness_review`. 집중20/20 회귀에서1.1MB 정상 허용/>8MiB 차단/본문 정지 timeout을 확인했다.10:53 실제 재시도에서 metadata검증과business21회를 완료해 검사도구 경계 수정은 재검증됐다. raw response와 credential은 저장하지 않았다.
- 증거: `custom-read-chain-live-20260907T014622-124Z.json`, `custom-read-chain-live-20260907T015345-885Z.json`, `CUSTOM-READ-CHAIN.md`, `HARNESS-REVIEW.md`. 개별 기능의 정상 여부는 해당20개 결과를 따로 판단한다.

## HARNESS-PROJECT-001 — 경로가 사라진 첫 등록 프로젝트를 검사 입력으로 선택

- 심각도 P2, 검사 입력 선택 결함. 최초10:53:47 KST/REGULAR, 기준ac8452f/mockapi 연결 환경. 프로젝트 목록은200이지만 첫 ID로 tree/env를 요청하면404였고, tree에서 파일 경로를 얻지 못해 file검사는 미시도였다.
- 기대: fresh 목록의 `notice`와 각 항목의 `exists`를 확인해 유효한 기존 디렉터리만 선택하고, 없으면 정확히 입력 차단으로 남긴다. 실제: 첫 등록 행의 ID 형식만 확인하고 경로 존재 상태는 검사하지 않았다.
- 소스에서 목록은 사라진 경로도 `exists:false`로 보여주며 상세 `_root`는404를 반환하도록 되어 있다. 비식별 registry metadata 집계는 등록2/디렉터리1/부재1이고 첫 행이 부재다. 관측된 두404는 이 계약과 일치한다. 제품 결함으로 확정하지 않는다.
- 영향: tree/env 두 경로의 실제 실행은 기록됐지만 유효한 프로젝트 내용·환경 흐름의 검증이 진행되지 못했고 file경로도 차단됐다. 기존 사용자 데이터 수정은 없었다.
- 소유자 `recovery_project_probe`, 관련 `scripts/market-session-audit/custom-read-chain.mjs`의 project선택. notice=null/배열/id/exists=true/허용kind를 검사하고 결정적으로 유효 후보만 선택하도록 보강했다. stale-first/전체stale/notice이상 회귀와 독립23/23 검토를 통과한 뒤12:34 실제 재검사에서 tree/env/file3개 HTTP200을 확인했다. **검사 입력 선택 결함 수정·실측 확인 완료**이며 프로젝트 제품 코드 수정은 없다. 목록 조회 뒤 경로가 사라지는 동시성 경계의 live검증까지 주장하지 않는다.
- 상세 소스 근거와 후속 범위: `PROJECT-READ-GAPS.md`. 원본10:53 artifact와 두404는 보존하며 새 결과는 `custom-read-chain-live-20260907T033434-309Z.json`, exact20행 비교는 `CUSTOM-READ-CHAIN.md`를 따른다.

## BOOT-001 — backend 기동 60초 제한 초과 후 종료

- 심각도: P1. 분류: 기동 실패 확인, 코드/설치/환경 원인 진단 중.
- 최초: 2026-09-07 08:27:32 KST. 08:28:20 hard deadline 종료, 08:30 이후 연결 실패 확인. 시장단계: 장전.
- 기준: `ac8452f`, 브랜치 `codex/market-session-audit-20260907`, Windows, 기존 설치 Node/Electron 및 backend .venv.
- 선행조건: 앱/8010 서비스가 없던 상태. `ATHENA_ENABLE_ORDER_API=false`, `ATHENA_ROUTINES_ENABLED=false`.
- 재현: app의 기존 Electron으로 `.` 실행 → backend spawn 로그 확인 → 60초 이후 `/health` 조회.
- 기대: backend가 준비되고 `/health` 및 데이터 준비상태를 반환하거나, 구체적인 복구 사유를 UI에 표시.
- 실제: 12초 준비 실패 → boot gate degraded → 60초 hard deadline에서 자신이 시작한 backend 종료(code 1). `/health` HTTP 응답 없음(`000`).
- 영향: live 시세/호가/차트/계좌/실시간/API 검사와 관련 앱 기능의 선행조건 차단.
- 증거: `app/captures/main-debug.log`의 `2026-09-06T23:27:20`~`23:28:20Z`, `artifacts/market-session-audit/2026-09-07/app-stdout.log`, `app-stderr.log`. 원본 로그에 민감정보가 있을 수 있어 보고서에는 필요한 상태만 인용한다.
- 별도 관찰: Chromium `chrome_100_percent.pak` 로드 경고 및 100/200 pak 파일 부재. backend 실패와의 인과관계는 미확인.
- 빈도: 현재 실제 기동 1회에서 발생.
- 소유자: `audit_boot_failure` 진단 lane. 관련 파일: `app/lib/main/backend-launcher.js`, backend 기동 경로(확정 전).
- 수정/회귀/독립검토/live 재검증: 아직 수행 전.

### BOOT-001 원인 확인 및 우회 기록

- 상세 근거: `artifacts/market-session-audit/2026-09-07/boot-diagnosis.md`.
- 격리 동일 lifespan 42.175초 중 instrument identity 3,525개 종목명 regex compile 39.282초. 단순 import 5.89초, dependency check 정상, 설정 계정은 존재한다.
- 최초 앱은 provider selector worker 초기화와 동시에 진행하여 60.011초 제한을 초과했다. 종료 code 1은 launcher hard-kill 후 결과이다.
- 08:44:14 backend를 별도 소유 PID 32552로 기동하고 08:45:23 health/ready 200 확인. 임시 우회로 live 검사 선행조건을 복구했으며 원래 launcher 경로는 미해결이다.
- 수정 후보: eager regex compile을 없애고 정규화 문자열로 후보를 좁힌 뒤 동일 경계 규칙을 필요한 후보에만 적용. timeout 단순 연장은 최종 수정으로 채택하지 않는다. 별도 worktree에서 성능/동일성 회귀 후 적용한다.

## ENV-001 — Electron 설치 파일 누락으로 표준 검증 명령 실행 불가

- 심각도: P1(검증 실행 차단), 분류: 설치 환경 불량 확인. 최초: 2026-09-07 08:35 KST 장전.
- 기준 revision: `ac8452f`; Node dependencies/lock 변경 없는 기존 로컬 설치.
- 재현: `app`에서 `npm run verify:paper` 실행.
- 기대: package.json의 Electron 검사 명령이 정상 시작됨.
- 실제: Electron 기반 3개 단계가 런처 부재로 시작되지 않음. `node_modules/.bin/electron`, `.cmd`, `.ps1` 및 `node_modules/electron/cli.js` 부재 확인. `chrome_100_percent.pak`, `chrome_200_percent.pak`도 부재. electron.exe 직접 실행은 가능.
- 영향: 표준 실행/검증 도구 차단, Chromium 리소스 불완전. BOOT-001의 원인이라고 단정하지 않는다.
- 증거: `artifacts/market-session-audit/2026-09-07/baseline-tests/paper-suite-20260907-083533-47124.log` 및 직접 파일 존재 확인.
- 임시 검사 경로: 기존 electron.exe 직접 호출. 제품 코드를 바꾸지 않음.
- 복구 계획: 진행 중 소유 UI 프로브 종료 후 lockfile 기준 `npm ci`, 누락 파일 확인, 표준 검증 재실행. 다른 사용자 프로세스는 종료하지 않음.
- 수정/검증: 아직 수행 전.
- 08:45–08:46 복구: lockfile 기반 npm ci 후 고정 버전 Electron installer 실행. launcher/cli/100·200 pak 복구와 새 앱 PID44960 실행 확인. 표준 npm 검증 명령 재검증은 아직 남았다.

## CARD-001 — 삼성전자 3개월 차트 카드 상태 보드 1개 미마운트

- 심각도: P2 잠정, 분류: fixture 화면/검증 불일치 재현, 제품과 하네스 중 원인 미확정.
- 최초: 2026-09-07 08:36 KST 장전. 기능: Paper `137X-2`, CC-03/R01 삼성전자 3개월 차트.
- 기준 revision: `ac8452f`; Electron fixture/임시 프로필.
- 재현: `probe-paper-cards-mount.js`를 직접 Electron으로 실행하여 96장 전체 검사.
- 기대: 해당 카드 상태 보드 7개가 모두 DOM에 있음.
- 실제: `state_board_missing_in_dom`, expected 7 / in_dom 6. 원본·2분할·4분할·최소 4개 preset 모두 동일.
- 빈도: 이번 96장 검사 중 1장, 그 카드의 4/4 preset에서 실패; 나머지 95장 통과.
- 영향: 해당 카드 상태의 표시 또는 검사 계약 누락 가능. live 차트 기능 불량으로 단정하지 않는다.
- 증거: `app/captures/paper-gates/PAPER-CARDS.json`, `artifacts/market-session-audit/2026-09-07/baseline-tests/paper-cards-mount-direct-20260907-083642-1384.log`.
- 수정 소유/원인/회귀/live 재검증: 상세 원인 조사 후 결함 lane 배정 예정.

## SCREEN-001~005 — 화면 5개의 실행 라우트 누락

공통: P2 잠정, 분류는 검증 커버리지 결함 후보다. 2026-09-07 08:37–08:42 KST, revision `ac8452f`, 격리 Paper fixture 화면 전수 검사. 기대는 정본 95개 화면 각각에 실행 경로가 있는 것이며, 실제 아래 5개는 `route_missing`으로 UI를 실행하지 못했다. 제품 화면 자체 부재 여부는 별도 확인이 필요하다. 재현은 `probe-paper-screens.js` 전체 실행. 증거는 `baseline-tests/post-20260907-084326-PAPER-SCREENS.json`이다.

| 불량 ID | 보드 | 화면 | 기대/실제 | 영향 |
|---|---|---|---|---|
| SCREEN-001 | 3KM-0 | 셸 — 답변 중 · Task Canvas | route 존재 / 없음 | 답변 진행 중 Canvas 상태 미검증 |
| SCREEN-002 | 3W9B-1 | 동시 실행 — 상태 4종 · 스피너 | route 존재 / 없음 | 동시 작업 상태·진행 표시 미검증 |
| SCREEN-003 | 2QCN-2 | 그래프 — 정직성 상태(이름·인코딩·빈 값) | route 존재 / 없음 | 잘못된 이름/인코딩/빈 값 표시 미검증 |
| SCREEN-004 | 2I7Z-2 | 키우미 — 입력 스트립 모드별 얼굴 | route 존재 / 없음 | 모드별 입력 UI 상태 미검증 |
| SCREEN-005 | 2GZM-2 | 백테스트 — 전략 고르기 · 실패·비활성 | route 존재 / 없음 | 실패/비활성 상태의 사용자 안내 미검증 |

각 항목 빈도는 이번 전수 실행 1/1, 원인·소유 파일·회귀·live 재검증은 조사 후 배정한다. 누락을 PASS나 실제 제품 실패로 임의 변환하지 않는다.

## SCREEN-006 — 백테스트 코드 플로우 지도의 문구·구조 불일치

- P1 잠정, fixture 회귀 확인. 보드 `2FR9-2`, 백테스트 코드 플로우 지도. 현재 래칫도 명시적으로 회귀 판정했다.
- 시각/환경/재현: 위 화면 전수 검사와 동일. 원천 90개 실행 라우트 중 89개 통과, 이 1개 실패.
- 기대: `#backtestCanvas`에 앱 제공·봉 데이터·조절 값·지표 변환·매수매도 순간·성과의 설명과 flow node/boundary가 나타남.
- 실제: 6개 설명 문구 모두 `phrase_missing`. `.backtest-flow-node.is-app` 기대 4/실제 0, `.backtest-flow-node.is-mine` 기대 4/실제 0, `.backtest-flow-boundary` 기대 3/실제 0.
- 영향: 코드 흐름 설명 화면 또는 fixture 라우팅이 계약을 충족하지 못함. 실제 백테스트 계산 정확성의 실패 증거는 아니다.
- 증거: `baseline-tests/post-20260907-084326-PAPER-SCREENS.json`의 `2FR9-2` 행.
- 관련 후보: `app/lib/backtest-canvas.js`, `app/lib/paper-screen-routes.js`. 원인과 책임 파일은 아직 확정 전.
- 수정/회귀/live 재검증: 미수행.

## CONTRACT-001~002 — 계약 보드 설명 문장 누락

P2 잠정. 14개 계약 문서 정적 검사 중 12 통과/2 실패이며, 실행 화면 실패와 구분한다. 재현·환경·증거는 위 화면 보고서와 동일하다.

| ID | 보드 | 대상 | 기대 | 실제 |
|---|---|---|---|---|
| CONTRACT-001 | 1XA2-0 | CC-03/R01-B 차트 전체 항목·행 상세 | 기계 검증 가능한 계약 설명 문장 | `contract_no_sentence` |
| CONTRACT-002 | 2DZE-0 | DV-2 기업·가치 프로필 공식 39개 필드 | 기계 검증 가능한 계약 설명 문장 | `contract_no_sentence` |

계약 원본 문장과 추출기 규칙 중 원인을 조사해야 하며, 39개 필드의 실제 금융 데이터 오류로 단정하지 않는다. 수정 및 재검증 미수행.

## MINI-001 — 미니 카드 정적 대조 불일치

- P2 잠정, 디자인/런타임 대장 계약 불일치. 192보드/96 ledger 전수 대조, 19 일치/77 불일치, divergent row 212, annotation drift 94.
- 문법 정적 커버리지 10/10은 존재를 증명하며 77개 대조 불일치의 통과를 뜻하지 않는다.
- 보드별 기대/실제 및 94개 drift 상세는 `MINI-DETAILS.md`에 원본 결과를 기준으로 작성한다.
- 실제 live 미니 렌더 성공/실패는 아래 runtime 검사와 별도다. 코드/대장/원본 디자인 중 원인을 확정하기 전 일괄 문구 치환하지 않는다.

## HARNESS-MINI-001 — 안전한 미니 runtime 검사에서 부팅 인계 미완료

- P1(검증 차단), 하네스 결함 후보. 2026-09-07 08:42 KST, fixture/임시 profile/`ATHENA_NO_AUTOSTART=1`.
- 재현: `probe-paper-mini-template.js` 직접 Electron 실행. 예상 envelope 11개·문법 10종.
- 실제: 32.2초 후 `부팅 창에서 셸로의 handoff가 끝나지 않았다`, 실제 렌더 0/11·문법 0/10.
- 원인 후보: probe가 `startBootReadinessForVerify()`를 호출하지 않음. 실 backend 자동기동을 허용하여 결과를 억지로 통과시키지 않았다.
- 영향: 미니 runtime 전수 판정 불가. 앱 사용 중 미니 카드 자체가 모두 불량이라는 뜻은 아니다.
- 증거: `baseline-tests/paper-mini-template-direct-20260907-084225-27468.log`.
- 수정/회귀/live 재검증: 미수행. 격리 부팅 경로를 명시하는 최소 하네스 수정 후 재실행 필요.

## BOOT-002 — 정상 backend의 일시 지연을 미기동으로 오판하여 중복 스폰

- P1, 코드 동작 재현 확인. 2026-09-07 08:46:59~08:47:15 KST, `ac8452f`, 수동 backend가 먼저 정상 기동된 상태.
- 선행조건: backend 부모 PID32552/실제 리스너 PID25412가 08:44:14부터 유지되고, health/ready가 200인 상태에서 앱 PID44960 시작.
- 재현: manifest 첫 검사만 일시적으로 1.5초 이상 지연시키고 다음 검사는 성공시키는 harness. 기존 backend가 있어도 spawn 1회로 재현.
- 기대: 일시 응답 지연과 프로세스 부재를 구분하여 정상 backend를 재사용.
- 실제: HEALTH_TIMEOUT 1500ms의 단일 검사 실패(실측 약1515ms) 직후 중복 backend 스폰. 기존 backend의 manifest가 성공하여 launcher는 준비 완료를 반환하지만 중복 자식은 약10초 후 `CredentialLockConflict`/lifespan 실패로 code3 종료.
- 배제: bearer 불일치(launcher/anonymous/auth 검사 각 성공), 기존 backend 교체, AddressInUse를 직접 원인으로 하는 실패.
- 영향: 불필요한 초기화 부하와 자격증명 잠금 충돌, 진단 혼선. 이후 boot gate degraded는 별도 원인이므로 이 결함에 귀속하지 않는다.
- 증거/명령/재현: `artifacts/market-session-audit/2026-09-07/boot-diagnosis.md` BOOT-002 절.
- 관련 파일: `app/lib/main/backend-launcher.js`. 수정/회귀/live 재검증 미수행. BOOT-001과 같은 파일의 변경이 필요하면 동일 수정 lane에서 순차 처리한다.

## QA-EVAL-001 — selector v5 봉인 신규 코퍼스 미작성으로 필수 검증 5개 차단

- P1(검증 공백), 정적 명시 skip 및 전체 격리 실행에서 확인. 2026-09-07 09:30, ac8452f.
- 기대: 회귀 입력과 독립된 봉인 v5 신규100문항 및 canonical Git blob/겹침/변형 복사/hash 검증이 실제로 실행되어야 한다.
- 실제: `tests/unit/test_selector_autonomous_eval.py`의 아래5개가 코퍼스 미작성 이유로 명시 skip된다. 전체3769개 수집과3769개 결과 marker를 정확 index로 대조했다.
  - `test_sealed_v5_requires_exactly_one_hundred_cases`
  - `test_sealed_manifest_records_verified_canonical_git_blob_entries`
  - `test_sealed_v5_rejects_overlap_with_current_regression_corpora`
  - `test_sealed_v5_rejects_suffix_copy_of_regression_question`
  - `test_sealed_v5_records_current_overlap_corpus_hashes`
- 영향: selector 정확도/회귀와 독립된 평가 완료를 주장할 수 없다. 다른3763개 통과로 이 공백을 채우지 않는다.
- 증거: `baseline-tests/backend-full-isolated-nodotenv-20260907-085650-16072.log` 및 `backend-collect-20260907-092222-18180.log`.
- 수정 조건: 실제 독립 신규 코퍼스를 구성·검토·봉인하고5개 검증을 활성화하여 실행해야 한다. 기존 회귀 문장의 재포장이나 placeholder100개로 통과시키지 않는다. 수정/실행 미수행.
- 별도 환경 제한: `test_projects_store.py::test_resolve_in_project_rejects_symlink_pointing_outside` 1건은 Windows symlink 생성 불가로 동적 skip. 제품 경로 보호 기능의 통과 증거는 아니며 환경별 재검증 필요.

## QA-PERF-001 — 공유 selector conformance 테스트 장시간 CPU 점유

- P2 잠정(검사 성능), 동일 전체 격리 실행의3169번째 `test_python_resolver_passes_shared_app_conformance_vector`가 약17분 CPU 연산 후 통과했다.
- 영향: 전체 회귀는31분56초, 긴 무출력 구간이 생겨 진행과 hang을 구분하기 어렵다. 앱의 단일 실제 요청이17분 걸린다는 증거는 아니다.
- 후속: 반복 초기화/평가 비용을 프로파일링하고 의미를 유지한 범위에서 줄인다. 성능 변경은 별도 수정 lane에서 측정 후 판단한다.

## HARNESS-UI-001 — 설정 패널 검사 JavaScript의 누락된 로컬 변수

- P1(검증 차단),2026-09-07 09:44:16 첫 live UI 감사에서 재현. 제품 코드가 아닌 추가 감사 스크립트 결함이다.
- 재현: 검토된live-ui.cjs로 실제normalboot후첫설정screen탭을누르면panelState가주입한JavaScript에서선언하지않은`key`를참조한다.
- 실제: mode메타데이터/현재summary캔버스/부팅/계좌집계까지완료,settings결과0개에서AUDIT_FAILED. 종료finally에서기존mode/settings/selection복원true.
- 기대: renderer에직렬화한설정key로4개패널을끝까지검사하고,각backendread미검증을명확히유지한다.
- 증거: `live-ui-2026-09-07T00-43-53-375Z-35880.json`, 소스 `scripts/market-session-audit/live-ui.cjs`의panelState.
- 원인: Node측key변수는executeJavaScript문자열의renderer문맥에자동전달되지않는다. 소스문자열검사만있어실제평가시ReferenceError를놓쳤다.
- 수정 확인: key를renderer문자열안에명시직렬화하고VM으로실제평가하는회귀를추가했다. 독립재검토와12개집중검사후09:49재실행에서4settings모두render/선택/복원성공,에러없음. 원시실패artifact는보존한다. 제품전체live검증완료와는별개다.

## AUTH-OBS-001 — 앱 만료 표시와 backend 준비 상태의 대응 미검증

- P2 잠정(판정 공백),동일09:44UI실측에서앱계좌2개모두expired/active1,backend는2개ready및WSready로집계됨.
- 원천: 앱 `accounts.js:tokenStatus`는local계좌원장의tokenExpiresAt를읽는다. backend는별도credentialmanager준비상태를사용한다.
- 현재는개별계좌동일성/같은token수명주기/실제사용경로의대조를하지않았으므로숫자2만으로모순이나인증오류를확정하지않는다.
- 후속: 비밀값없이계좌identity매핑및각캐시의타임스탬프/상태전파계약을대조하고,실제조회와UI표시의관계를검증한다. OAuth재발급을임의실행하지않는다.
- 진단 완료: 로컬 만료 메타데이터와 backend runtime 준비 상태는 서로 다른 원장·수명주기다. 앱은 호출마다 로컬 파일을 다시 읽고, 실제 저장된 두 만료 시각은 8월 18일이므로 9월 7일 `expired=2` 표시는 해당 계약과 일치했다. 같은 token의 ready/expired 모순이나 화면 캐시 오류로 판정하지 않는다. 비밀값은 대조·출력하지 않았으며 두 원장의 자격증명 동일성은 미검증이다.
- 별도 발견: 계좌 선택의 REST 연결 누락은 아래 AUTH-002로 분리한다. [진단과 안전 집계](../../../artifacts/market-session-audit/2026-09-07/auth-state-diagnosis.md)에 source·관찰·미검증 범위를 기록했다.

## AUTH-002 — 설정의 활성 계좌가 direct REST 계좌 선택에 전달되지 않음

- P1, 소스에서 확인한 연결 불일치. 실제 계좌 전환 및 계좌별 데이터 대조는 아직 실행하지 않았다. 기준 ac8452f.
- 기대: 설정의 활성 계좌를 데이터 계좌로 사용하는 흐름이라면 selector와 render-plan은 동일한 검증된 backend 계좌를 선택해야 한다. 로컬 OAuth 보관함만을 위한 설정이라면 그 범위를 사용자에게 명확히 알려야 한다.
- 실제 소스: `app/main.js:3016`의 `activeRestAccountId()`는 로컬 재시도 권한 binding에 쓰이지만, `app/lib/main/rest-dataset-runner.js:627`의 selector/render-plan 요청은 `X-Athena-Account`를 보내지 않는다. `backend/athena_api/dependencies.py:66`은 해당 선택자가 없으면 backend 기본 runtime을 사용한다.
- 현재 원장은 앱 로컬 임의 ID와 backend 설정 alias로 분리되어 있다. 메모리 내 ID/별칭 교집합은 0개였으나, 동일 자격증명을 다른 이름으로 보관했는지는 확인하지 않았다. 계좌번호·별칭·ID·token 원문은 기록하지 않았다.
- 영향: 사용자가 설정에서 활성화한 계좌와 direct REST의 실제 데이터 계좌가 연결되지 않는다. 계좌별 데이터가 실제로 잘못 표시됐다는 live 증거나 주문 실행 오류로 확대하지 않는다.
- 수정 경계: 검증된 backend alias를 명시적으로 연결하고 selector/render-plan 양쪽에 전달하거나, 설정의 로컬 OAuth 범위와 실제 backend 선택을 명확히 분리한다. 로컬 ID를 backend alias로 추측하거나 mapping 실패 시 기본 계좌로 조용히 대체하지 않는다. 실제 계좌 매핑이 필요한 부분은 자동으로 추정하지 않는다.
- 회귀 기준: 계좌 A/B의 선택에 따라 두 REST 경로가 같은 올바른 runtime mock을 사용함; 잘못된/없는 alias의 명시 실패; local expiry와 backend readiness의 분리 표시; 민감정보 비저장. 기존 backend 준비/잘못된 alias 계약 2개 테스트는 통과했지만 이 연결 수정의 증거는 아니다.
- 증거: [계좌 상태·선택 진단](../../../artifacts/market-session-audit/2026-09-07/auth-state-diagnosis.md). 제품 코드와 실제 선택·OAuth·주문은 변경하지 않았다.

## BOOT-003 — 종목 데이터 회복 후 부팅 실패 상태가 갱신되지 않음

- P1, 장중 실제 기동 실패와 소스 상태 전파 결함. 기준 ac8452f, 앱 PID 49728, 기존 backend 32552→25412.
- 재현: 09:48:39 정상 앱 기동 → 09:48:50.640 stock-master `ka10099` HTTP 502 → 12초 준비 대기 종료 → 09:49:02.596 `stock-index=failed`, `BOOT_TASK_FAILED`, degraded. 같은 기동의 backend 확인은 105ms로 성공했다.
- 기대: 초기 데이터 부재는 명확히 실패로 표시하되, 동일 프로세스의 종목 인덱스가 완전히 회복되면 해당 준비 상태도 갱신되어야 한다.
- 관찰: 재시작 없이 09:57:55.830 종목 3,525개 적재 성공 로그가 남았다. 최초 502 후 545.190초 만에 데이터 경로가 회복됐다. 설정 4개 UI 검사 성공 및 감사 도구 변수 결함과는 별개다.
- 원인: `app/main.js:5651`의 2초×6회 대기 실패를 `app/lib/main/startup-readiness.js:106`에서 terminal failed로 저장한다. `app/lib/main/stock-entity-index-readiness.js:86`의 백그라운드 성공은 대기자만 해제하며 startup task를 갱신하지 않는다. 정확한 소스 위치와 호출관계는 아래 진단 문서를 기준으로 한다.
- 증거의 범위: 09:49 실패는 실제 UI 캡처, 09:57 데이터 회복은 동일 PID 로그에서 확인했다. 회복 뒤 readiness를 다시 직접 캡처하지는 않았다. 실패 상태가 자동 정정되지 않는다는 판정은 성공 callback·production retry 경로 부재에 대한 소스 분석에 근거한다. 회복 후 종목 기능의 실제 사용자 흐름 성공은 미검증이다.
- 미확정: 시장 0/10/8 중 어느 요청에서 502가 발생했는지, Kiwoom upstream 내부 원인은 현재 로그로 확정할 수 없다. 루틴 비활성화에 따른 2개 gate 실패와도 구분한다.
- 영향: 종목 검색 준비가 약 9분 지연됐으며, 데이터가 회복된 뒤에도 시작 진단이 실패를 계속 보유할 수 있다. `/health` 200만으로 이 기능을 정상 판정하면 놓친다.
- 수정안: atomic 전체 인덱스 교체와 초기 실패 표시는 유지한다. 이후 완전한 인덱스 적재 성공 시 실패한 stock-index task를 succeeded로 갱신하고 readiness revision을 renderer에 전달한다. 변경은 장 관찰 후 별도 수정 브랜치에서 수행한다.
- 회귀 종료 조건: 초기 502 동안 부분 snapshot 미게시 및 명시 실패; 같은 프로세스의 후속 적재 성공 시 task·revision 갱신; backend 준비와 upstream 오류 구분; 기존 성공 경로 유지. 제품 수정은 아직 수행하지 않았다.
- 상세 증거: [BOOT-003 진단](../../../artifacts/market-session-audit/2026-09-07/boot-diagnosis.md#boot-003-일시적-stock-master-502-이후-부팅-task가-실패-상태에-고정됨), [정제된 회복 증거](../../../artifacts/market-session-audit/2026-09-07/boot-recovery-evidence.json), `live-ui-2026-09-07T00-48-39-849Z-49728.json`. 원본은 `C:\Projects\DAOU.Athena\app\captures\main-debug.log`이며 정제본에 원본 경로·추출 시각·행번호·선택 행 지문과 실제 오류/회복 시각을 보존했다. 계속 추가되는 원본 전체 지문은 이후 달라질 수 있다.

## FIXTURE-001~005 — 전체 격리 화면 검사에서 실패한 5개 단언

2026-09-07 10:19~10:22, ac8452f의 표준 `npm run verify`를 독립 profile·HOME 및 fixture에서 실행했다. 실제 사용자 credential·live backend를 사용하는 실행과 구분한다. 전체 실행 98.923초, 실패 단언은 아래 5개이며 제품 P0/P1로 일괄 판정하지 않는다.

| ID | 실패 단언/실제 결과 | 현재 판정과 후속 |
|---|---|---|
| FIXTURE-001 | degraded startup 알림이 shell/orb에 각각 전달됐으나 OS 전달이 없음 | P2 후보, Windows 실행 환경과 제품 알림 경계를 분리 확인. 실제 설치 앱에서의 전달은 미검증. |
| FIXTURE-002 | `chat region never shrinks when the window narrows` | P2 검사 기준 후보. 1360px의 canvas/chat 650/400이 1120px에서 stack 820/820으로 변경됨. 현재 반응형 규범과 구형 고정 폭 단언을 대조해야 함. |
| FIXTURE-003 | `canvas region absorbs the shrink` | FIXTURE-002와 같은 breakpoint/기대값 경계. 현재 Paper 반응형 검사는 통과해 단순 화면 회귀로 확정하지 않음. |
| FIXTURE-004 | `settingsSurface.modelPanelHasClaudeAccountRow`, 행 0개 | 격리 조건에 따른 차이. 실제 credential 접근을 차단한 임시 HOME에서 실행했으므로 연결된 계정 fixture와 미연결 빈 상태를 별도 검증해야 함. |
| FIXTURE-005 | fast boot expand 604.5ms > 내부 상한 580ms, 총 2056.5ms는 외부 허용 범위 충족 | P2 timing/부하 후보. 단일 fixture 표본이며 live 지연이나 지속 회귀로 확정하지 않음. |

- 정확한 단언 문자열, 기대/실제, 원본 receipt·로그 지문 및 격리 근거: [모드·세션 상세](MODE-FIXTURE-DETAILS.md).
- 별도 통과: backtest 5/5, session restore 42/42, 독립 graph 140/140, agent Paper parity 실패 0 및 renderer console error 0. 이 통과를 live provider/전체 기능 통과로 바꾸지 않는다.
- 하네스 실행 계약 문제도 보존한다. graph 첫 실행은 assertion 이전 STATUS_BREAKPOINT로 종료했고 런처에서 고유 user-data-dir를 적용한 1회 재실행은 통과했다. 늦은 profile 지정은 원인 후보이며 최초 출력이 없어 crash 내부 원인은 미확정이다. verify 직접 실행은 cleanup watchdog용 절대 Node 경로가 없어 실패했고, 표준 npm 실행으로 해당 진입 문제를 해소했다.
