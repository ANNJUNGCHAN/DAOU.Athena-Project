# 장 운영 전수 검사 상태

**16:35 작업 전환 — 아래 관찰 중 표기보다 우선:** 16:30:00.002 마지막 표본에서 앱47980 신원 true/true와 HTTP4/4를 확인했고 watcher34120은16:30:01.009 예정 종료됐다.16:32:55 OS 조회에서도 종료를 확인했다. 오늘 예정 관찰은 끝났으나 전수 기능 판정은 **PARTIAL**이다. main은 다른 작업에 의해 `53055ac`로 전진했으며 되돌리지 않았다. 재현 기준 `ac8452f`의 `codex/market-fix-BOOT-001`, `BOOT-002`, `BOOT-003`, `AUTH-002` 네 별도 worktree에서 수정 전 재현·병렬 구현을 시작했다. 카드/화면 진단은 main53055ac의 `codex/market-fix-DIAGNOSTICS`에서 기존 수정과 남은 실패를 분리한다. 제품 main 병합·push는 하지 않는다. 최종 체크포인트는 `checkpoint-20260907T163000KST.json`이다.

**16:13 재개점 — 아래15시대 실행 신원보다 우선:** 사용자 앱47980(16:07:53.160918 생성), 감사 watcher34120(16:12:18.493378 생성), 현재 기록 `watch-20260907T071218-597Z.json`.16:06:52 네 endpoint 요청 실패 →16:07:52 health/ready200 및 accounts/OpenAPI timeout →16:08:52 네 곳200을 기록했다.16:12:18 새 앱 신원 true/true와 HTTP4/4를 확인한 뒤 감사 소유 구 watcher46644만16:12:58에 종료했다. 사용자 제품 프로세스 제어0. backend는 command 기준26920→25220 후보이며 TCP 결합·loaded hash는 미확인이다. 인과관계·정확한 장애 지속시간은 확정하지 않는다. `runtime-handoff-20260907T161258KST.json`에 원본 지문을 보존했고16:30 관찰은 남아 있다.

**현재 작업 위치:** `C:\Projects\DAOU.Athena-market-audit-20260907`의 `codex/market-session-audit-20260907`. 원래 폴더는 다른 사용자 작업이 사용하며 감사 문서·코드는 별도 worktree에만 쓴다. 현재 검증된 사용자 app36856은 원래 폴더 소유이고 감사 watcher46644가 새 worktree에서 이를 관찰한다. backend는 process command 기준 parent46068→uvicorn34264 후보이며 TCP listener table 결합을 독립 확인한 값은 아니다. 감사 작업은 사용자 제품 프로세스를 종료·재시작·제어하지 않는다. 세부 경계와 watcher 전환 이력은 `WORKTREE-ISOLATION.md`에 기록했다.

현재 감사17개 Node 테스트 파일의 최신 집계는 **203/203 통과**(fail/skip/todo0,17,085.5596ms)다. 분리 직후14개 파일148/148은 역사적 snapshot으로 보존한다. 현재 coverage는 REST 실제 고유55(GET41+POST14), WS stream1 별도, read 실제 실행 합집합263/264, 원천1396행을 반영한다. coverage 단일 WS 행 문구 수정·재생성은 focused24/24로 확인했으며,203/203 집계는 이 문구 수정 전에 실행됐으므로 새 전체 집계로 확대하지 않는다. 이 수치는 제품 전체 통과 수가 아니다. detail-price projection 하네스 결함은 수정·독립17개 mock 검토와 실제 재시도까지 확인했다.

## 최신 런타임·실측 인계 — 2026-09-07 15:53 KST

- **전체 판정: 진행 중 / PARTIAL.** app/backend 재시작은 사용자가 카드 버전을 다시 열도록 명시적으로 요청한 결과다. 구 app16660/backend30112→30248은 사라졌고 app6104(13:54:42.231964 KST)는14:28까지 관찰된 뒤 사라졌다. backend37764(13:56:59.496581)→listener13080(13:56:59.507584)은14:22 재시도까지 관찰됐지만14:24~14:25에는 존재하지 않았다. 감사는 이 제품 프로세스를 제어하지 않는다.
- 검토된 `watch-external-runtime.mjs` SHA-256은 `C65785C71C7BD1A3D3C6B84A108E9E707728D4316D0B84B6D3EBFAF0E9BBA141`이며 독립 검토를 통과했다. 당시 감사 watcher39368은14:17:50.696944에 새 worktree에서 시작해 app6104를 관찰했다. 첫14:17:50.816 표본은 root_found/root_validated true, health/ready/accounts/OpenAPI 4/4 HTTP200이고 출력 경로도 새 worktree다.
- 원래 watcher 기록의13:53 root false,13:55~13:57 HTTP null,13:58 혼합 복구는 사용자 재시작 구간의 증거다. 이를 자발적 제품 crash로 분류하지 않는다. 소유 확인한 구 watcher27844는14:09:09에 계획 종료했고, repoRoot 불일치로 root_found true/root_validated false였던 중간 watcher40144는 snapshot을 보존한 채 올바른 watcher 확인 후14:19:34에 종료했다.
- 14:04 최초 final-5 실제 artifact는 business4/metadata2 요청, 대상5개 중1개 `base:ka30003`만 HTTP200/returnCode0으로 새 통과했고4개는 차단됐다. raw artifact는 `artifacts/market-session-audit/read-final-inputs-20260907140429KST.json`, SHA-256 `49EA9078196E1732BD732B7F5DB75C1F9D6A40F17B6B84B606FFF3AB38AEA437`이며 수정하지 않았다.
- raw의 `revision:null`은 별도 context receipt로 보완했다. 실행 전후 audit HEAD `ac8452f`, backend37764→13080 신원과 대상 primitive source 일치를 확인했다. 당시 원래 폴더 delta는 `card_surface_contract.py`;14:17에는 `card_surface_templates.py`도 추가됐다. dependency 검토가 남아 있어 원래 backend 전체를 baseline과 같다고 주장하지 않는다.
- detail-price source 두 경로는 HTTP200이었지만 성공 projection에 `return_code`가 없어 최초 raw에서 `INVALID`로 잘못 분류됐다. 하네스 수정과 독립17개 mock 검토 후14:22 실제 재시도에서 best-ask projection과 dependent target 호출을 확인했고, 최초 raw 기록은 보존한다.
- **14:22 실제 재시도 완료:** `read-final-inputs-20260907142216KST.json`은 business6/metadata2, 대상5개 중4개 실제 시도/1개 PASS/4개 BLOCKED다. 주문이력 source는HTTP200/code0이지만 미체결 주문이 없어 `ka10088` target은 미시도했다. best-ask source projection은 PASS했고, 이를 사용한 `kt00010` detail3개는 각각HTTP200/code20으로 차단됐다. `ka30003`은HTTP200/code0 PASS다. 실행 합집합263/264는 통과 수가 아니다.
- 재시도 preflight는05:22:13.266Z에 audit `ac8452f`, backend37764→13080 신원과 대상 generated/runtime/routes/models/registry/stream/WS/auth/dependencies/kiwoom/accounts/main baseline을 확인했다. 카드 변경은 canvas/lazy registry 경계로 대상 read/WS 경로와 분리됐지만, Python의 post-start lazy import 가능성까지 부정하지 않는다.
- **14:24~14:25 역사적 변화:** backend37764/13080과8010 listener가 사라졌고 당시 app6104/watcher39368은 같은 신원으로 남아 있었다. 감사는 사용자 backend를 종료하지 않았다. WS 사전점검은 outer PowerShell null의 JSON parse 오류로 CLI·credential·health·REG 이전에 끝났고 business artifact가 없다. 따라서 WS 제품 실패가 아니다.
- **14:25~14:28 runtime 회복과 active WS 1회:** 새 backend39728(14:23:43.525671)→listener41172(14:23:43.551737)를 read-only preflight에서 확인했고14:25~14:26 watcher는HTTP4/4=200을 기록했다. app6104/watcher39368 신원은 유지됐다. 감사가 backend를 시작하거나 제어한 것은 아니다.
- `ws-active-stock-20260907T052815-996Z.json`은 REG1 `CONTROL_ACK`, REMOVE1 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`, 소유 socket `OWNED_SOCKET_CLOSED`를 기록했다. upstream REMOVE ACK는 검증되지 않았다. 주문·조건·계좌변경은 보내지 않았다.
- 이벤트 창에는 메시지159개와 REAL envelope159개가 실제 수신됐다. wrong_type0/wrong_item0이지만 event record288개가 accepted FID20 시간 계약을 충족하지 못해 invalid_time으로 집계됐고 valid/fresh0이다. 따라서 `BLOCKED_NO_LIVE_EVENT`는 무트래픽을 뜻하지 않는다. 일부 matched envelope의 시간 필드 부재/형태에 대한 parser/source 조사가 남았으며 provider 제품 실패로 확정하지 않는다.
- WS 시간 판정 원인은 하네스가 canonical nested `row.values["20"]` 대신 구형 top-level `row["20"]`만 읽은 것으로 좁혀졌다. source/canonical fixture 근거로 수정하고20개 mock과 독립 검토를 통과했다. 최초159 REAL artifact는 변경하지 않고, 수정만으로 provider 결과를 통과 처리하지 않는다.
- **14:29 이후 앱 신원 변화:** watcher39368은14:25:50~14:28:50 root6104를 검증했지만14:29:50~14:36:50에는 root_found false를 기록했다. 같은 표본의 HTTP4/4=200은 endpoint 준비 상태이며 앱 정상 증거가 아니다.14:35:58 snapshot의 후보 app34040(14:29:18.943856 생성)은14:36:30 이전 사라져 현재 PID로 승격하지 않았다.
- watcher41668은 후보34040의 creation date가 null인데도 nonterminating PowerShell 오류 뒤 시작된 admission 결함이다. `watch-20260907T053631-114Z.json` 첫 표본은 root false다. 엄격한 null/ErrorActionPreference Stop 신원검사 후 소유 watcher41668만14:37:23.963에 종료했고 제품 프로세스는 제어하지 않았다. 당시 앱 PID는 미확정이었으며 이후 아래의 app30288 handoff로 갱신됐다.
- **14:41 검증된 watcher handoff:**14:41:15 snapshot에서 원래 폴더 electron app30288(생성14:36:18.784535)을 찾고 strict null abort, exact creation/path 재검사를 통과했다. 감사 watcher44784는14:41:52.711595에 시작했고 첫14:41:53.546 표본에서 root30288 found/validated true, HTTP4/4=200, 새 worktree output을 확인했다. 그 뒤에만 구 소유 watcher39368을 신원 확인해14:42:52.143에 종료했다. 제품 프로세스 제어는0이다.
- WS nested-FID20 수정본 SHA prefix `BCB6D3`은20개 mock과 독립 검토를 통과했다. 그러나14:43 첫 재시도 preflight에서 원래 production diff에 새 `api/canvas_push.py`가 발견돼 dependency 독립성 검토를 위해 CLI/network 이전에 중단했다. 이 시점에는 새 WS actual이 없었고 기존159 REAL artifact는 그대로였다.
- **14:46 active WS 재검증:** dependency 검토는 `canvas_push.py`/card contract/templates 변경을 board hydration/cache 경계로 확인했고 primitive generated/WS/stream 대상 경로와 분리했다. Python post-start lazy import 부재까지 단정하지 않는다. preflight는 audit `ac8452f`, backend39728→listener41172 신원을 확인했다.
- `ws-active-stock-20260907T054609-218Z.json`은23 REAL messages, REG 전 baseline matching row42개, REG 뒤 matching row1개를 기록했다. post-REG row는 nested FID20 형식이 유효하고 freshness `<=5s`, invalid/stale0이었다. verdict는 `PASS_WITH_CLEANUP_UNVERIFIED`다.
- REG1 `CONTROL_ACK`, REMOVE1 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`, 소유 socket close를 확인했지만 upstream REMOVE ACK는 false다. REG 전부터 matching traffic42개가 있었으므로 우리 REG가 fresh event를 발생시켰다는 인과관계는 입증되지 않았다. matching fresh data 관찰만 통과이며 다른22개 WS route는 실제 실행0이다.
- watcher44784/app30288은 첫14:41 표본에서 검증됐다.14:44:53~14:47:53 네 표본은 process probe failure로 root_found/root_validated가 미기록돼 신원 판정이 불가하고 process_count는 null이며 HTTP4/4=200이었다. 이는 앱 부재가 아닌 신원 측정 공백이며14:48:53 root probe가 회복됐다. 해당 구간 연속 앱 건강을 주장하지 않는다.
- 수정 lane 계획은 독립 `APPROVE`, SHA-256 `70C5A001D58AFEE14DBDE95DB764C3950AB2B70952EDB661FDA189DDE005256D`다.16:30 이후 격리 브랜치 병렬 수정은 가능하되 integration은 직렬화한다. custom compute12의 당시10 mock/review 준비는 아래15:13 actual로 이어졌다.
- **15:13 custom compute12 실제 완료:** `custom-compute-probe-20260907151307KST.json`의12개 route가 모두 좁은 semantic contract를 통과했다. repo test/preset에서 만든 순수 fixture이며 market data·provider·optimizer·side effect가 없어 장중 시장 동작이나 UI 정상 증거가 아니다. REST 실제 고유 범위는 GET41+POST14=55이고 WS stream1은 별도다. read 실제 실행 합집합은263/264다.
- **15:42 watcher handoff 역사:** 당시 사용자 app34680은15:29:24.312150 생성이다. watcher46776은15:42:47.841903 시작했다. 첫15:42:48.192 표본은 process_probe_failed로 root 필드 미기록/process_count null이지만 HTTP4/4=200이고, 다음15:43:48.201은 root34680 found/validated true, process_count73, HTTP4/4=200이다. 새 검증 뒤에만 구 watcher44784를 신원 확인해15:45:19.260에 종료했다. 제품 프로세스 제어0이다.
- 구 target30288은15:30:53.987과15:40:54.058에 false였지만 사용자 replacement는15:29 이미 존재했다. 이를 전체 앱 outage로 해석하지 않는다. backend는15:13 parent12380/listener44724 신원을 마지막 확인했으며 loaded module hash는 unknown, reviewed source change는5개다.
- 최신 감사17파일 회귀는15:44:29.692~15:44:46.980, **203/203 통과**, fail/skip/todo0,17,085.5596ms다. 이전188개 실행의187pass/1 live-PID concurrency 실패2회와15:23:25의202개 중201pass/phase-clock wall-time assertion1실패를 보존한다. phase-clock 검사 수정은13/13 승인됐고 현재203 통과로 확인됐다. 과거 실패를 제품 실패로 분류하지 않는다.
- WS active catalog23종은 모두 PURE classification이지만 소유권 발견 경로가 없어 controls0, unconditional `BLOCKED_OWNERSHIP_DISCOVERY`다. 독립4/4 exact23/block-all-network 검토를 통과했다. 기존0B 실제는 좁은 fresh-data `PASS_WITH_CLEANUP_UNVERIFIED`일 뿐 random group이 충돌 없는 권위적 소유 증거가 아니다. 사용자 lease 피해 증거는 없고 shared runtime에서 추가REG/REMOVE를 하지 않는다. 기존 preexecution 실패는 executor가 제거했으며 live 제품 실패가 아니다.
- **15:49~15:53 최신 runtime handoff:** app34680은15:50:48 표본에서 false였다. 같은 표본은 health/ready HTTP200(6.5/7.2ms), accounts/OpenAPI는2초 timeout과 status null이었다.15:51:48에는 HTTP4/4=200으로 회복했고, user replacement app36856(15:49:55.773470 생성)을 strict identity로 확인했다. runtime replacement와 timeout의 인과관계 및 정확한 지속시간은 입증되지 않았다.
- watcher46644는15:51:51.737183에 app36856 대상으로 시작했다. 첫15:51:51.994 표본은 root found/validated true, process_count73, HTTP4/4=200이다. 새 검증 뒤에만 구 watcher46776을 신원 확인해15:53:21.333에 종료했다. 제품 프로세스 제어0이다. 근거 receipt는 `runtime-handoff-20260907T155321KST.json`이다.
- 동결 기준 뒤15:55:52.043 표본도 root36856 found/validated true, process_count73, HTTP4/4=200을 기록했다. 이는 watcher 연속성 확인이며 전체 앱 건강이나 이후 시점의 PID 지속을 보증하지 않는다.
- backend snapshot은 parent46068(15:49:26.116933)과 uvicorn34264(15:49:26.131246)의 process command에 port8010이 포함된 후보 신원이다. 해당 snapshot은 TCP listener table을 독립 결합하지 않았고 loaded module hash도 없다. 현재 관찰은 이 한계를 유지한다.
- 장마감/장후 checkpoint와 화면·의미·나머지 read1개 등 coverage 공백이 남아 전체 판정은 `PARTIAL`이다.16:00/16:30 관찰을 이어가고 이후 승인된 FIX-LANES를 사용한다.
- 기존11:11:40→12:29:36의 **77분55.708초 관찰 공백**은 그대로 남는다. 이후 사용자 재시작 및 watcher 인계 기록으로 그 공백을 소급 채우지 않는다.

## 이전 요약 — 2026-09-07 13:46 KST

- **전체 판정: 진행 중 / PARTIAL.** 장전 불량과 공백이 있었고 장중 실측 중이며, 15:30~16:30 장후 구간은 아직 도래하지 않았다.
- 최신 main `ac8452f`에서 `codex/market-session-audit-20260907`를 생성했다. 제품 추적 파일 변경0, 이번 감사 docs/scripts만 추가. main 병합/원격 push 없음.
- **12:24 실제 heartbeat 재개에서 관찰 중단을 발견하고 복구했다.** 현재 app16660(12:29:36), backend30112→30248, watcher27844(root16660)이다. Windows 마지막 부팅은12:18:09이며 과거 PID25412는cmd.exe로재사용되어건드리지않았다. 직전11:11:40부터새첫관찰12:29:36까지 **77분55.708초의 관찰 간격**이 있다. 정확한 중단 시각은 미관측이며 연속 정상으로판정하지않는다. 첫복구샘플은HTTP2/4,12:30:36에4/4=200을확인했다.
- 현재 원천 대장은 `inventory-expanded-20260907.json`의 **1396행**이다. 원본1394행을 보존하고 소스에서 누락됐던 MCP canvas render/save 두 표면만 추가했다. 고유 제품 기능 수와는 다르다. fixture/static/live/미검증을 분리한 `COVERAGE.md`를 기준으로 추적한다.
- **13:46 MCP 격리 protocol 실측:** 새 감사 전용 빈 registry/profile에서 서버를 실제 시작해 initialize1/list_tools1로도구12개(캔버스2개포함),action schema58개와정확name/schemafingerprint를확인했다. `PASS_PROTOCOL_METADATA_ONLY`이며call_tool0,사용자registry읽기false,provider허용0이다. SDKcontext종료는확인했으나 OSPID/하위프로세스종료를독립검증한것은아니다. 사용자실행gateway·외부provider연결·각도구실행의통과로승격하지않는다. 실제 파일은 `mcp-builtins-probe/run-20260907T134502KST/report.json`이다.
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
