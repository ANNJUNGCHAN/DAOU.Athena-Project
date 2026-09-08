# 검사 도구 독립 리뷰와 검증

## 15:44 최신 통합 검증

새 감사 worktree에서 명시한17개 Node 테스트 파일을 실행해 **203/203, fail/cancel/skip/todo0, exit0,17.086초**를 확인했다. 실제 실행은15:44:29.692–15:44:46.980 KST다. `harness-regression-20260907T154446KST.json`에 정확한 파일 목록과 결과를 기록했다. 이 집계에는 별도 Python MCP15개와 WS catalog4개가 포함되지 않는다. 검사 도구 회귀 통과를 제품·실서비스 전체 통과로 사용하지 않는다.

이 통합 뒤 독립 검토에서 WS 행 설명에만 남은 과거 REST43 숫자를 발견했다. 집계55는 이미 정확했고, 설명을 숫자 없는 별도 집계 문구로 고쳤다. 보고서를 재생성하고 focused coverage24/24를 통과했다. 최신 script SHA는 `05DDFB0EDD79F0CEEF95B96D45CF34F413653A58072AB5C70EA9A9024EEB88E1`, test는 `1824A9CA002FB652CB826055E2E271E26F00B5B0DE957DB843A1590ACF1938AF`, report는 `DC49B5FC59791DAC620A6C9B67B6B252CA59461FDF972C13AE5EA76861100DCE`다.203개 결과는15:44 snapshot이며 이 문구 수정 뒤 전체 suite를 다시 실행한 결과로 표시하지 않는다.

앞서14:55·14:58 통합 실행은 각각187/188 실패였고,15:23에는 실제 시계가 동시호가 시간으로 바뀌어 REGULAR를 기대하던 계산 fixture 한 개가 실패해201/202였다. 세 실패 기록을 유지한다. 이후 두 timing 테스트는 OS 조회의 명시적 측정 불가와 실제 AbortSignal 경계를 검증하도록 바꾸고, 계산 fixture는 고정 시각과 실제15:25/15:35 시장 단계 회귀를 추가했다. 제품 구현과 production timeout은 바꾸지 않았으며 각각 독립25/25 및13/13 승인을 거쳐 위203개 통합을 실행했다.

현재 coverage는 원천1396행, 실제 read263/264, custom REST55 및 별도 WS stream1을 연결한다. 계산12개는15:13 실제 HTTP/JSON 의미 계약을 좁게 통과했고,0B 한 유형의 fresh event 관찰은 정리 ACK·구독 인과성·소유권 한계를 유지한다. 새 WS catalog는 공유 구독 소유권을 증명할 수 없어 active executor를 제거한23행 분류 도구로 축소했다. 실행 요청도 credential/socket/network 전에 차단하며 실제 catalog 실행은0이다. 아래 이전 숫자와 해시는 당시 snapshot이다.

## 감사 worktree 분리 후 검증

- 실행 위치를 `C:\Projects\DAOU.Athena-market-audit-20260907`로 분리한 뒤 기존14개 Node 테스트 파일을 새 위치에서 실행했다. **148/148, fail/cancel/skip/todo0,9.171초,exit0**이다. 새 WS/MCP/마지막read5개 모듈은 이 통합 실행에서 제외했다.
- 독립 verifier가 baseline248행의 pagination/freshness 객체가 `[object Object]`로 표시되는 오류를 발견했다. generator를 실제 state/pages/basis/relation을 렌더하도록 고치고, object case가 LIVE_BLOCKED를 그대로 유지하는 회귀를 추가했다. 현재 문자열 강제변환 잔여0, read259/custom43/1396행과 history는 유지된다. 표시 수정 script SHA `17320D0C759014554D0FF9CD6C39915C1F1F54C411CA1531633925AC6825E7E8`, test `D191339AA81ABFCDD6D314B16F37C3103ED99D397F0DE1EE8DBEF51F1AFCBB30`, report `EEE09DD1190C4225E000E71E16A903060191CD4B2A59848F6149839EEA2B4921`이다. 별도 verifier가 재확인한다.
- 이 분리는 다른 작업의 `app/shell.css`와 백테스트 editor test 변경을 보호한다. 원래 runtime 프로세스와 계속 기록 중인 watcher를 새 worktree 실행으로 잘못 표기하지 않는다. `WORKTREE-ISOLATION.md`를 함께 읽는다.

## 13:16 추가 실행과 독립 승인

- inventory는 원본1394개를 변경/삭제하지 않고 MCP canvas builtin2개를 추가한 별도1396개 artifact로 확장했다. 독립 verifier가 source registration, 새두ID만추가, coverage exact1396, 기존 read252/custom41/UI9/WS23 이력 보존을 확인했다. 이는 이후 조회7개와POST2개 증거 반영 전 snapshot이다.
- POST metadata 도구는 별도 reviewer 승인 후13:08 search/describe2개를 실제 실행했다. 코드 SHA `4BF0DFB5CC1A526BA7AAFEF3C2BE34243B94A2FC49839D4D0D2675591A725FD9`, test `CA35869EC8BC30669E60A5859EA14D73597D5C63001DFD9AD4924A9145E84C54`, mock13/13 및 syntax2/2였다. 두 실제HTTP200/JSON형태·동일ref/kind만 통과했고 전체 응답 모델이나 quote 실행은 검증하지 않았다.
- 동적입력 도구의 exact path/mandatory operation ID/required dependency/time-budget 표현을 보강하고 별도 reviewer17/17 및 syntax2/2 승인 후13:12에 실행했다. 코드 SHA `6E827311CC06A16306ECF0A6623E1BAABD0644CC0998EE4F2827EBABE26FF9D2`, test `FA912A1F46D9A8DE4A3D4850A9BED56F8B54B26176967D35A83F1083A26EAB3D`를 root가 재확인했다. 첫 CLI의 token env 누락은 metadata1/business0으로 끝났고 기존 local bearer를 자식환경에만 공급한 재실행은source4+target7=11응답을 받았다. source4는 기존 대상이므로 고유조회 수는252+7=259다.
- custom nonGET 분류77행은 독립 reviewer가 최신 SHA `03AB8C15A906FA09891B27A0077F39A46FA105A85E5DC81B2AE262470A9EC8D7`에서 정확집합·순서·89source앵커와5개수정의해소를 승인했다. 이 source분류 승인은77개 실제실행 PASS가 아니다. 이후 실제metadataPOST2개의 증거는 별도 연결한다.
- 위 집중검사 숫자는 서로 다른 파일/시점의 결과다. 전체 감사 도구의 새 통합 테스트 수는 현재 변경 lane들이 동결된 후 한 번에 다시 기록한다. 제품 tracked 코드는 아직 변경하지 않았다.

## 12:34 이후 보강과 판정 범위 정정

- 기존 검사12개 파일의 최종 통합은 **113/113, fail/cancelled/skip/todo0,4.713초,exit0**이다. 이는 project선택과custom/UI history보강을포함하며별도작성중인POST/동적입력체인도구는제외했다.
- 프로젝트 선택은 `notice===null`, 배열,유효id,`exists===true`,허용kind를확인하며stale-first/전체stale/notice이상회귀와별도23/23검토후실제12:34체인을실행했다. tree/env/file3개HTTP200,20대상14시도/6미시도차단,고유customGET41개다.
- **판정 표현 정정:** raw `PASS_HTTP_SCHEMA_ONLY`는OpenAPI응답스키마validator의통과가아니다. 해당도구는HTTP2xx·JSON content-type/파싱·구조fingerprint를관찰한다. OpenAPIpreflight는route/operationId/requestBody/required입력/stream계약을검사한다. 응답필드의의미·데이터정확성·기능전체정상을추가검증한것으로해석하지않는다. 과거rawlabel은보존하되문서표시는이한계를따른다.
- `post-metadata-probe-20260907T033732-339Z.json`은실제CLI호출이아닌초기unitfixture가잘못된기본출력위치에저장한실패marker다. 주입된가짜readBearer/fetch의카운터이며실제credential읽기·네트워크송신·businessPOST는0이다. 이파일은livecoverage에사용하지않으며,후속도구는고유temp출력과`in_memory_fixture`모드를검증한다.

## 최신 실행 보강 — 2026-09-07 11:03 KST

- 조회 입력4개 보강은 source의 정확한 operation/field/required/길이/설명 계약을 검증한다. reviewer가 계약 이탈20조합을 재현해 전부 차단됨을 확인한 뒤 실제10:22 호출했다. core SHA `9C025D11D4560EC8FE7C5EB73CC67CD76AF61E017DF8D4CBD613E4E87DCC902D`, test `67ECA1D9785965494E6E0F5E2AB4F9614641989DFEEFEB66A22BD20607E2AC5C`. 집중26/26 통과. 고유 정규장 호출252이며 나머지12개는 입력 차단이다.
- custom GET 체인은 author와 별도 reviewer가 현행 OpenAPI·121개 runtime 원천 identity·허용 경로/입력·비밀 비저장·요청/응답 상한을 검증했다. core SHA `1B25DAA75B03FE815DDDA0358C2EF1EC1FED3692DEC7456271507893D42160F9`, live entry SHA `3B965D8D564196783920A8E0AD95BB8EBF0CB72E3A641D92A4B8DE054BEB4A60`, live test SHA `CF0BA3771CC12374ADE5838FC87936CB651EE2F4BDC15710E02DCCA37BAB9AD8`.
- 최초 metadata 크기 제한 실패에서는 OpenAPI 요청1회/business0으로 종료했다. 실측 Content-Length1,082,634바이트를 근거로 OpenAPI만8MiB로 보강했다. business1MB·기본32회·요청5초·전체60초는 유지했고, >8MiB 및 본문 정지 경계까지 집중20/20 회귀와 독립 재리뷰를 통과했다. 이는 제품 장애 수정이 아닌 검사 도구 보강이다.
- 승인된 재시도1회를 root가10:53에 실행했다. artifact `custom-read-chain-live-20260907T015345-885Z.json`, SHA `DE3D6611735366DCAED86299E8BAD58FB52643C449A7E3ABC39EDF810EBD36D1`:20대상/실제13/HTTP-schema만 확인11/BLOCKED9. business21에는 선행 GET이 포함되고 초기27과 교집합8·합집합40이다. 4042개와 선행조건 차단7개는 제품 불량 확정 수가 아니다.
- 크기 보강 전 감사 통합106/106은 당시 snapshot이다. 이후 coverage 통합 확장 중109개 snapshot에서 render fixture의 누락 summary 접근1개가 실패해 작성 lane에 전달했다. 작성 완료·동결 뒤 root가 실제 Node.js로12개 테스트 파일을 다시 실행해 **109/109 통과, fail/cancelled/skip/todo0,11.111초,exit0**을 확인했다. 24개 mjs/cjs 구문 검사도 통과했고 placeholder/disabled-test marker는 없었다.
- 최종 coverage SHA `A45BF95A5E6CC9C55A98053FA02495A1CEACDFAFCC02BF753BC6CAED4A3DF216`, test `FC8D932E41CD1F20983A2D655389D8CFB9BA3D7E7F948F1C045F034F36955E31`, 문서 `469B0B5BC41327D1D21CEEAA822E10C2E0211061E796A9EE5D3EE17A9C9F309A`. custom20대상은 기존 BLOCKED20과 exact case-sensitive 집합 일치 여부를 검사하며, target/source가 같은ID·시각이면 하나의 HTTP요청으로 합친다. attempted=false의 schema PASS 승격을 회귀로 차단했다.
- 현재 live 소유 PID는 app49728/watch44124/backend32552→25412다. 11:02:40 실제 관찰에서 HTTP4/4=200(6.4~27.8ms)을 확인했다. 이는 현재 연결 상태이며 장중 전체 기능 정상 판정이 아니다.

## 10:08 검증 snapshot

- 아래 09:03~09:10 기록은 당시 snapshot이다. 현재 실행 중인 앱은 PID 49728, 관찰기는 PID 44124이며, backend 32552→25412는 별도 프로세스로 유지한다.
- root가 실제 Node.js로 감사 도구의 10개 테스트 파일을 통합 실행했다: **80 tests, 80 pass, 0 fail/cancelled/skip/todo**, 1.969초. 최신 coverage의 UI/WS 판정 회귀 2개를 포함한다.
- 별도 reviewer가 live UI 도구의 renderer 변수 누락 수정과 VM 회귀를 검토했다. runner SHA-256 `420205D16FF58341DD86036AC452446A78D6336E1687C0056685CAC155E77BC3`, helper `EE6F033679774305917C544D1DF987B85AB22C5BAE4BCC544F3303AC28A6091C`. 이후 실제 09:49 실행에서 설정 4개 탐색과 복원을 확인했다. 현재 mode 관찰 외 5개 mode 클릭과 각 설정의 backend read 결과는 미검증이다.
- 별도 reviewer가 passive WS 도구의 인증 거절 우선순위와 정리 경계를 검토했다. runner SHA-256 `BA50B46FC5A63E2C32B792F97EE16D283FD7339EAB64AC10396A39A3FD7F3680`. 실제 연결·close1000·정리는 확인했으나 이벤트가 없었다. 19개 REAL 유형 수신과 4개 조건 기능 실행을 통과로 처리하지 않았다.
- custom read 도구는 현재 HEAD의 OpenAPI operation ID와 원천 집합을 검증한 후 27개 GET을 실행했다. 24개 HTTP/schema 성공과 루틴 비활성화에 따른 503 3개를 구분했다. 장전-only 조회 23개 재검사도 독립 검토 후 수행해 고유 정규장 조회 248개를 확보했다.
- coverage는 원천 1,394행을 exact ID로 대조하며 fixture/static/live를 합친 전체 PASS를 생성하지 않는다. UI 실측은 mode/설정 9개 ID에만 직접 연결하고 90개 route 전체로 확대하지 않는다.
- 이 검증은 감사 도구와 현재 증거의 범위에 한정된다. stock-index 초기화 실패, 입력 차단, 실제 실시간 이벤트·전체 화면·장후 관찰 공백은 남아 있다. 추가 입력 체인 도구는 별도 작성·검토 중이며 이 80개 결과에 포함되지 않는다.

## 초기 검토 기록

추가 진단의 독립 검증에서는 BOOT-003 원본 로그의 추출 시점 925,125바이트 prefix SHA와 정확한 오류/회복 행, 545,190ms 간격을 재현했다. AUTH-OBS-001의 원장 분리와 AUTH-002의 selector/render-plan 계좌 선택 헤더 부재도 소스에서 확인했다. `boot-recovery-evidence.json`의 `selected_source_rows_sha256`는 정규화 규칙이 없어 독립 재현하지 못했으므로 검증된 지문으로 사용하지 않는다. 대신 재현된 전체 추출 prefix와 `observations` JSON 지문 및 실제 행 대조를 근거로 삼는다.

독립 reviewer `audit_harness_review`가 2026-09-07 09:03 KST snapshot의 observer/watch 및 아래 정확한 read-only 실행 명령을 승인했다. 이는 제품 정상 판정의 승인이 아니다.

```powershell
node scripts/market-session-audit/read-sweep.mjs --execute --base-url http://127.0.0.1:8010 --rate-ms 1000 --timeout-ms 15000 --max-pages 5
```

## 검토에서 수정한 경계

- backend URL을 http/loopback/8010/origin-only로 제한하고 bearer 읽기 전에 거부. userinfo·다른 port·https·path·query·fragment 거부.
- redirect 거부와 응답 최종 URL 동일성 확인. 주문/OAuth/조건 등록 경로의 간접 호출을 막음.
- 원천 read_display 교차 검사, 중복 operation preflight 거부, 필수 입력 미정 항목 차단.
- raw 응답/에러/return_msg/next-key/계좌 식별자/토큰을 저장하지 않음. 선언된 경로의 유효한 날짜·시간만 제한적으로 보존.
- 페이지 연속 헤더 N/Y 외 또는 누락을 INVALID/BLOCKED로 처리, 반복 cursor/상한/미완료를 전체 조회 성공으로 만들지 않음.
- 원천 expected-date 정책이 없으면 source date를 관찰만 하고 NOT_VERIFIED/BLOCKED 유지. 분봉·과거·미래를 이름 정규식만으로 자동 정상/불량 판정하지 않음.
- operation/page별 실제 요청시각·시장단계 기록. 인증 실패 후 후속 호출 중단.
- watcher의 interval/max-duration/tolerance/timeout 경계와 실제 앱 PID 신원 검증. 지난 체크포인트의 소급 성공 방지.

## 증거

- 작성/리뷰 lane은 분리했다. 리뷰에서 발견한 false-PASS, false-FAIL 및 민감정보 저장 경로를 회귀 테스트로 재현한 뒤 수정했다.
- root가 09:10 보강 후 5개 테스트 파일을 실제 Node.js로 통합 실행: **42 tests, 42 pass, 0 fail/skip/todo**, 1.692초.
- runtime-discovery 실제 결과: operation422 = generated301 + custom121, static_only0/runtime_only0. 이는 API 목록 대조이며 실제 기능 실행 성공을 뜻하지 않는다.
- sweep session39924는 완료됐다. 09:03 마지막 URL/헤더 보강 전 snapshot으로 시작됐지만 정확한 http://127.0.0.1:8010과 기본 제한값을 사용하여 승인된 안전 범위다. 당시에도 현재성 기대 정책이 없으면 전체 PASS를 내지 않는다. 결과 264개와 누락 continuation 제한은 `READ-DETAILS.md`에 기록했다.

## 남은 범위

- 189개 조회는 freshness 계약이 없고 선언 계약이 있는 나머지도 기대 날짜 정책이 없으므로, 이 sweep만으로 모든 장중 기능 정상 판정을 할 수 없다. 요청별 의미·시간대·원천 데이터를 연결하는 후속 검증이 필요하다.
- 실행중 watcher21452는 09:10:40 보강 코드로 교체됐다. 구 증거에는 `watch-checkpoint-correction.json`을 적용하고 신규 실행과 합쳐 해석한다.
- observer/metadata 실패 terminal 상태 보강을 완료했다. 실패 경로 회귀를 포함한 통합42개가 통과했고 독립 verifier가 신규 관찰기의 연속 artifact와 실패 count0을 확인했다. 이후 실제 중단 여부도 watcher PID와 마지막 증거 시각으로 확인한다.
- 제품 기동, 카드, 화면, mini 불량은 이 도구 리뷰와 별도로 `DEFECTS.md`에 남긴다.
