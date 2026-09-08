# 재부팅 복구 독립 검증

검증 시각: 2026-09-07 12:31~12:37 KST  
검증 범위: 재부팅 전후 관찰 연속성, 복구 프로세스 신원, 복구 직후 관찰, 기존 고정 커버리지 수치  
판정: **PARTIAL**

이 문서는 재부팅 뒤 현재 런타임이 다시 관찰 가능한 상태로 돌아왔는지를 검증한다. 하루 전체 기능 전수 검사 완료나 제품 전체 정상 판정은 검증 대상도, 결론도 아니다.

## 기준 revision과 작업 트리

- 현재 branch는 `codex/market-session-audit-20260907`이다.
- `HEAD`, `main`, `origin/main`은 모두 `ac8452f5b62a338d74826ac27cf65da12d99320b`로 일치한다.
- tracked diff는 0이다. `docs/audits/`, `scripts/market-session-audit/` 두 감사 경로만 untracked로 보인다.

## 재부팅과 관찰 공백

- Windows `LastBootUpTime`은 `2026-09-07T12:18:09.9572770+09:00`이다.
- 이전 관찰기 `watch-20260907T004839-875Z.json`은 84개 관찰 뒤 `2026-09-07T11:11:40.477+09:00`에서 끝났다. `finished_at`과 `finish_reason`이 모두 null이므로 정상 종료 증거가 없다.
- 새 관찰기의 첫 관찰은 `2026-09-07T12:29:36.185+09:00`이다. 두 관찰 사이의 **관찰 공백은 4,675.708초(1시간 17분 55.708초)**다.
- 이 공백은 연속 정상으로 셀 수 없다. 호스트 재부팅은 확인되지만, 공백 전 구간 전체의 제품 장애 시작 시각이나 제품 자체 crash 원인은 증명되지 않았다.
- `host-recovery-20260907T122547KST.json`은 이전 PID 49728/44124/32552가 사라졌고 PID 25412가 12:23 생성 `cmd.exe`로 재사용됐음을 기록한다. 현재도 PID 25412는 해당 `cmd.exe`이며 검증 과정에서 건드리지 않았다.

## 복구 프로세스 신원

WMI 실행 파일 경로와 생성 시각, TCP listener를 독립적으로 대조했다.

| 역할 | PID | 생성 시각 KST | 검증 결과 |
| --- | ---: | --- | --- |
| backend parent | 30112 | 12:27:26.9515507 | repo의 `backend/.venv/Scripts/python.exe`, uvicorn `127.0.0.1:8010` |
| backend listener | 30248 | 12:27:27.010 | PID 30112의 자식이며 현재 `127.0.0.1:8010` listener 소유 |
| Electron root | 16660 | 12:29:36.012075 | repo의 `app/node_modules/electron/dist/electron.exe`, `live-ui.cjs` 실행 |
| watcher | 27844 | 12:29:36.035973 | `C:/Program Files/nodejs/node.exe`, `watch.mjs --root-pid 16660` |

현재 repo Electron 실행 파일과 일치하는 프로세스는 5개이고 모두 PID 16660 트리 안에 있다. 이는 복구 런타임의 소유권 증거이며, Electron 전체 기능 정상 증거는 아니다.

## 복구 직후 실제 관찰

- 첫 샘플 `observer-20260907T032936-185Z.json`은 root PID 16660을 발견하고 실행 파일 신원을 검증했다. `/health`, `/ready`는 HTTP 200이었으나 `/ready/accounts`, `/openapi.json`은 각각 약 2초 뒤 timeout이었다.
- `observer-20260907T033136-203Z.json`에서는 같은 root 신원이 유지됐고 `/health`, `/ready`, `/ready/accounts`, `/openapi.json` 네 점검이 모두 HTTP 200이었다. 첫 샘플부터 이 회복까지 120.018초가 걸렸다.
- 새 watcher는 12:36:36까지 8개 샘플을 기록했고 8개 모두 root PID 16660 신원이 유효했다. `/health`와 `/ready`는 8/8 HTTP 200, `/ready/accounts`와 `/openapi.json`은 첫 timeout을 보존한 채 이후 7/7 HTTP 200이다. watcher의 `observation_count`/`metadata_write_count` 실패 카운터가 0인 것은 수집기 실행·기록 실패가 없다는 뜻이며 첫 HTTP timeout을 상쇄하지 않는다.
- 새 watcher artifact는 이 검증 시점에 진행 중이며 `finished_at`/`finish_reason`이 null이다. 그러므로 16:30까지의 연속 관찰 완료를 아직 판정할 수 없다.
- 새 UI artifact `live-ui-2026-09-07T03-29-36-409Z-16660.json`은 12:30:06에 끝났고 전체 결과는 `FAIL`이다. 설정 4개 이동과 복원은 성공했지만, 설정의 backend read는 모두 `BACKEND_READ_NOT_VERIFIED`, 모드 이동은 `BLOCKED_NAV_CREATES_HISTORY`, live route 90/card 96/mini 10은 이 runner에서 차단됐다. readiness는 `degraded`; `alarm-bootstrap`과 `routine-feed`가 `BOOT_TASK_FAILED`였다.

따라서 “프로세스와 기본 HTTP 관찰이 복구됐다”는 주장은 12:31:36 샘플 범위에서 PASS다. “앱 전체가 재부팅 후 정상이다”와 “관찰 공백 동안 장애가 없었다”는 주장은 FAIL이 아니라 **증거 부족/PARTIAL**이다.

## 고정 커버리지 교차 검증

- `inventory.json`의 item ID는 1,394개이며 모두 고유하다.
- `COVERAGE.md` 데이터 행도 1,394개/고유 ID 1,394개이며 inventory 대비 missing 0, extra 0, duplicate 0이다.
- 이 1,394개는 source reconciliation row 수다. 고유 사용자 기능 수나 live PASS 수가 아니다. 모든 coverage 행에 remaining gap이 남아 있고, 문서는 fixture/static과 live 증거를 분리한다.
- Kiwoom read 실제 실행 artifact 세 개를 operationRef로 합집합 계산하면 252개가 REGULAR에서 실제 시도됐다. 264개 중 12개는 한 번도 시도되지 않았다. 이전 248개 실행 중 23개는 장전에도 실행됐으며, 장중 재시도 23개와 추가 4개를 합쳐 장중 고유 252개가 된다.
- 10:53 chain까지는 초기 실제 27개와 chain 실제 13개가 서로 겹치지 않아 고유 40개였다. 해당 chain은 target 20개 중 13개 시도, `PASS_HTTP_SCHEMA_ONLY` 11개, 전체 `BLOCKED` 9개, business request 21개였다.
- 복구 후 12:34 chain `custom-read-chain-live-20260907T033434-309Z.json`은 target 20개 중 14개를 시도했고, 14개 모두 `PASS_HTTP_SCHEMA_ONLY`, 6개는 `BLOCKED`였다. business request는 22개, metadata request는 1개다.
- 12:34 실제 target 14개 중 13개는 10:53 target과 같고, 새로 실제 시도된 것은 `custom-api:GET:/api/v1/projects/{project_id}/file` 1개다. 초기 27개와 겹치지 않으므로 최신 고유 custom actual은 **41개**다. requests 수를 새 기능 수로 세지 않는다.
- project file은 10:53 artifact에서 source HTTP status 때문에 target 미시도/BLOCKED였고, 12:34 artifact에서는 viable project와 tree의 Python entry를 앞선 안전 GET에서 선택해 HTTP 200과 JSON 구조 fingerprint를 남겼다. 이 변화는 입력 선택 복구 증거이며 파일 내용의 의미 정확성이나 전체 project 기능 PASS는 아니다.
- `PASS_HTTP_SCHEMA_ONLY`는 artifact가 보존하는 raw verdict label이다. 구현은 OpenAPI 응답 schema validator를 실행하지 않는다. OpenAPI preflight는 route/operationId/request body/필수 parameter/stream 여부를 확인하고, 실제 응답은 HTTP 2xx, JSON content-type, 제한 크기 내 JSON parse를 통과하면 top-level type/count와 재귀 구조 digest를 기록한다. 따라서 이 label은 OpenAPI 응답 계약, 필드 의미, 데이터 정확성, UI 표시, 장중 freshness 또는 제품 전체 정상 증거가 아니다.
- 최종 coverage에는 custom actual 41개가 모두 존재하고 증거 artifact가 연결된다. 10:53과 12:34에 모두 실제 시도된 13개는 두 시각과 두 artifact를 모두 보존한다. 최신 custom 분류는 raw `LIVE_HTTP_SCHEMA_PASS` 38, `LIVE_BLOCKED` 6, `LIVE_BLOCKED_SAFE_CONFIG` 3, runner `NOT_APPLICABLE` 77이며 합계 124다.
- 새 UI artifact는 mode 5개와 setting 4개, 정확히 9개 inventory ID에 연결된다. mode는 click 미실행/이력 생성 차단, setting은 backend read 미검증이라는 제한이 각 행에 남아 있다.

## 검증 경계

- 현재 source classification 변경과 project/conversation selection probe는 별도 검토/실행 중이므로 이 문서에서 승인하거나 커버리지에 포함하지 않는다.
- `post-metadata-probe-20260907T033732-339Z.json`은 초기 unit fixture가 기본 artifact 위치에 남긴 실패 marker이며 live probe가 아니다. 현재 `COVERAGE.md`는 이 파일을 참조하거나 live 수치에 포함하지 않는다. 이 검증 lane은 해당 post 모듈을 import하거나 테스트/CLI 실행하지 않았다.
- 재부팅 전 109-test snapshot은 과거 고정 증거일 뿐 현재 수정 후보의 통과 증거가 아니다.
- 장후 15:30~16:30 구간, 주문/정정/취소, OAuth 재발급, 실제 WS 이벤트, live route/card/mini 전수, mode 변경의 사용자 상태 안전성은 이 복구 검증으로 닫히지 않는다.

## inventory 확장 독립 검증

- 원본 `inventory.json`은 SHA-256 `15DDBADFAC522C4F97C4982FA6586F3A57481C1D62D3EB3F9D0C4F10E0521943`와 1,394개 고유 ID를 그대로 유지한다.
- `inventory-expanded-20260907.json`은 SHA-256 `83182AE5D543F0A5DA1BFFDAFB94DBEB53C8EFE5B563DBEAEE94B2304A519C29`, 1,396개 고유 ID다. 공통 1,394개 item을 JSON 구조로 대조한 결과 변경된 item은 0개이고 삭제된 ID도 0개다.
- 추가된 ID는 정확히 `mcp-tool:athena__render_canvas`, `mcp-tool:athena__save_canvas` 두 개다. 둘 다 `backend/athena_mcp/server.py`의 `_builtin_tool_defs()`에 `types.Tool`로 등록된 상수와 일치한다.
- 확장 inventory 집계는 MCP tool 12개, MCP action 58개다.
- 현재 `COVERAGE.md`는 확장 inventory와 1,396/1,396개 고유 ID가 일치하며 missing 0, extra 0, duplicate 0이다.
- 새 두 coverage 행은 `SOURCE_DECLARED`, `LIVE_NOT_RUN`, `NOT_OBSERVED@NOT_OBSERVED`, evidence path `none`으로 기록됐다. safe input도 `UNASSIGNED`다. 따라서 정적 등록 확인 외에 실제 MCP `tools/list` 또는 call 증거는 없다.
- 기존 공통 1,394개 inventory item은 확장 artifact에서 변경되지 않았고, coverage의 Kiwoom read 252개/미시도 12개 및 custom actual 41개 집계도 유지됐다. 새 두 ID가 기존 live 수치에 편입되거나 PASS로 승격되지 않았다.
- 기존 이력 연결도 다시 대조했다. 실제 Kiwoom read 합집합 252개와 custom actual 합집합 41개는 모두 현재 coverage 행과 해당 실행 artifact를 가진다. 최신 UI의 mode/setting 9개도 모두 현재 UI artifact에 연결되고, passive WS artifact에 연결된 23개 행은 모두 이벤트 `NOT_OBSERVED` 제한을 유지한다.
- 확장 뒤 전체 판정도 **PARTIAL**이다.

## 재현 가능한 증거 해시

- `host-recovery-20260907T122547KST.json`: `C3842F3588D8010DE98F69039171B0334E37C574376CF415515925C4579F3E0B`
- `observer-20260907T032936-185Z.json`: `15EB23F29FC102581CC99815263E8019D7438D77757D20227C5816AF1451EB59`
- `observer-20260907T033136-203Z.json`: `1D9566BA1DC4126EA66066F976F44764DB22F0B4998C0A50D9E84F637C7E05A1`
- `live-ui-2026-09-07T03-29-36-409Z-16660.json`: `616C7B3B00B28D7EB13576B5739F18A1D00B1FCB13AAB557FECCCA9CE76CF9EA`
- `custom-read-chain-live-20260907T033434-309Z.json`: `0776F50C618A9ACC49A04FAF6F5F05E004B8A143D32ED6D0E8BC0FD9E32A8864`
- `inventory.json`: `15DDBADFAC522C4F97C4982FA6586F3A57481C1D62D3EB3F9D0C4F10E0521943`
- 최종 교차 검증한 `coverage.mjs`: `4A5ACA012081301925C12829FFDAB29C98FE1A03736B3C97E4A3B7F474D7F051`
- `coverage.test.mjs`: `92D9CF5A858CE52FEC243224138EF3A9D689066CF82D277E29EA391710C170D9`
- 1,394-row 확장 전 `COVERAGE.md`: `881134B2539FA89EB479F4DCA156739DFFDB74E54B1B997696B410D0D1D5C7A8`
- 확장 후 `inventory-expanded-20260907.json`: `83182AE5D543F0A5DA1BFFDAFB94DBEB53C8EFE5B563DBEAEE94B2304A519C29`
- 확장 후 `coverage.mjs`: `7A347619BF324B84136A0362301936C69188804ADFCADE8B8D28AED20DB8FBA8`
- 확장 후 `coverage.test.mjs`: `3256FBE47435FB148686A99DD728960646197F246B5AF7783158E824DD7EE0B8`
- 확장 후 `COVERAGE.md`: `F716154169E3523105698724EDBF9DF8D7B8B71C5B284D02CEEE06F3E813D36A`

## 격리 worktree coverage 통합 검증

검증 위치는 `C:\Projects\DAOU.Athena-market-audit-20260907`이다. 원본 `C:\Projects\DAOU.Athena`의 앱·backend·watcher와 원본 artifact에는 쓰거나 호출하지 않았다. 격리 worktree의 310개 artifact는 복사 시점의 역사 snapshot이며, 이 경로의 watch 파일을 현재 live feed로 간주하지 않는다. artifact 내부의 원본 절대 경로는 실측 당시 위치를 나타내는 역사 값이다.

- 첫 통합 snapshot의 SHA-256은 `coverage.mjs=A2A01CBA541D6CE6E02EE1A0ADA0636A362676F25355E81ADA0B3C071CBAE1F6`, `coverage.test.mjs=1EBF255DA91CBAA4DFB12E8E676C9740C3E07E46E109E4E6A3046FCA7308604F`, `COVERAGE.md=0B7B37D23AFBD012DC591BEC019B69714BCB58164A308AD5A54B933A882A9403`로 요청된 값과 일치했다.
- 확장 inventory 1,396개 고유 ID와 coverage 1,396개 고유 행이 정확히 일치한다. missing/extra/duplicate는 모두 0이다.
- 기존 read sweep 3개와 `read-input-chain-20260907T131253KST.json`의 실제 관찰 286건을 ID+시각+artifact 경로로 대조했다. 고유 read operation은 259/264개이며 모든 실제 관찰이 해당 coverage 행의 phase/history와 evidence path에 존재한다. 미시도 5개는 `base:ka10088`, `base:ka30003`, `detail:kt00010`의 세 capacity detail이다.
- Dynamic chain은 source 4개와 target 7개, 총 11개를 한 페이지씩 실행했다. coverage는 이전 BLOCKED/NOT_OBSERVED 이력과 새 시각을 함께 보존하고 `pagination=NOT_VERIFIED_SINGLE_PAGE`, `freshness=NOT_VERIFIED`를 명시한다. 최신 PASS는 HTTP/JSON/business code와 선언 root 또는 메모리 source 값 관찰이며 전체 schema, end-to-end, 전체 페이지, 현재성 검증이 아니다.
- GET custom artifact 3개와 실제 POST artifact의 관찰 56건을 ID+시각+artifact 경로로 대조했다. 고유 custom actual은 43개이며 GET 41개+POST 2개다. 모든 실제 관찰이 coverage에 연결된다.
- 실제 POST `post-metadata-probe-20260907T040802-456Z.json`은 search/describe 두 ID를 13:08 KST에 각각 한 번 관찰했다. 두 행 모두 `PASS_HTTP_JSON_SHAPE_ONLY`, HTTP 200이며 coverage는 metadata-only HTTP/JSON shape 관찰로 제한하고 완전한 schema·필드 의미·데이터 정확성·하위 기능·UI 검증이 아니라고 명시한다.
- 초기 fixture marker `post-metadata-probe-20260907T033732-339Z.json`과 OpenAPI launch 실패 `custom-read-chain-live-20260907T014622-124Z.json`은 coverage evidence path에서 0회 참조된다. fixture의 injected credential adapter 1회와 business request 0, launch의 business request 0은 live custom actual 또는 request 합계에 포함되지 않았다.
- 현재 집계는 read `actual_unique=259`, `never_attempted_input_blocked=5`; custom `actual_unique=43`, 즉 initial GET 27+chain GET target 고유 14+실제 metadata POST 2다. 전체 제품 PASS나 전체 모델/freshness PASS 주장은 없다.

### 보고서 표시 결함과 수정 검증

- 첫 통합 snapshot에서는 기존 `read_display` 248개 행이 `pagination=[object Object]; freshness=[object Object]`로 렌더링됐다. ID, 시각, verdict, artifact 경로 이력은 보존됐지만 상태가 사람이 읽을 수 없었다.
- 수정 후 동결본은 `coverage.mjs=17320D0C759014554D0FF9CD6C39915C1F1F54C411CA1531633925AC6825E7E8`, `coverage.test.mjs=D191339AA81ABFCDD6D314B16F37C3103ED99D397F0DE1EE8DBEF51F1AFCBB30`, `COVERAGE.md=EEE09DD1190C4225E000E71E16A903060191CD4B2A59848F6149839EEA2B4921`이다.
- 수정본 1,396개 행에서 `[object Object]`는 0개다. 기존 read 행은 예를 들어 `pagination=state=COMPLETE, pages=1/5`와 `freshness=state=NOT_VERIFIED_NO_DECLARED_TIME_CONTRACT, basis=not_declared` 또는 예상 날짜 relation을 구조화해 표시한다.
- 수정 후에도 inventory/coverage 1,396/1,396, read 고유 259개, custom 고유 43개, 모든 ID+시각+artifact mapping gap 0, fixture/launch 참조 0이 유지된다. 따라서 표시 결함의 수정과 통합 coverage 정합성은 PASS다.

## 외부 runtime 어댑터와 14:29 이후 변동 독립 검증

- `watch-external-runtime.mjs` SHA-256은 `C65785C71C7BD1A3D3C6B84A108E9E707728D4316D0B84B6D3EBFAF0E9BBA141`이다. 어댑터는 관찰 대상 `repoRoot`를 원래 폴더 `C:/Projects/DAOU.Athena`로 전달하고, watch와 observer의 `outputRoot`를 새 감사 worktree 아래로 강제한다. PID는 양의 안전 정수만 허용한다.
- `watch-20260907T051750-814Z.json`의 첫 관찰 `observer-20260907T051750-816Z.json`은 14:17:50.816 KST에 PID6104를 `root_found/root_validated=true`로 확인하고 HTTP 4/4=200을 기록했다. 관찰 파일 경로도 새 worktree 아래다. 이 표본 범위에서 어댑터 적용은 PASS다.
- 같은 watcher에서 14:25:50~14:28:50 KST에는 PID6104 신원이 계속 유효하고 HTTP 4/4=200이었다. 14:29:50부터 이 독립 검증 시점의 14:39:51까지는 `root_found/root_validated=false`, `process_count=0`이지만 HTTP 4/4=200이 계속됐다. 따라서 최초 성공을 현재 앱 정상이나 PID6104 지속으로 확대하지 않는다. endpoint 준비성과 앱 root 신원은 별도 상태다.
- `watch-20260907T053631-114Z.json`의 단일 관찰은 target PID34040을 찾지 못해 `root_found/root_validated=false`다. HTTP 4/4=200이어도 올바른 앱 감시 시작 증거가 아니며, 해당 watcher의 `finished_at`/`finish_reason`도 null인 원본을 유지한다.
- 후속 `watch-20260907T054153-539Z.json`의 첫 관찰 `observer-20260907T054153-546Z.json`은 14:41:53.546 KST에 PID30288을 found/validated true로 확인했고 HTTP 4/4=200과 새 worktree 출력 경로를 남겼다. 새 handoff의 첫 표본은 PASS다. 다만 14:44:53~14:47:53 네 표본은 `process_probe_failed`이고 raw JSON에 `root_found`/`root_validated` key가 없으며 `process_count:null`이다. HTTP 4/4=200만 유지됐다. 14:48:53에는 root30288 검증이 다시 true가 됐다. 이 네 표본을 앱 신원 실패나 연속 신원 PASS로 바꾸지 않는다.
- `runtime-handoff-first-final5-context-20260907T142208KST.json`은 `createdAt=14:22:08.938 KST` 뒤의 14:22 재시도와 14:28 active WS 정보까지 포함하는 후첨 가능한 context 집계 파일이다. 파일명이나 `createdAt`을 전체 내용의 동결 시각으로 사용하지 않고 각 section의 `observedAt`/`preflightAt`을 사용한다. 제품 프로세스를 감사가 제어하지 않았다는 값은 context receipt의 선언이며, observation JSON만으로 행위 부재 전체를 독립 증명하지 않는다.
- 기존 watcher 마지막 11:11:40.477과 복구 watcher 첫 관찰 12:29:36.185 사이 계산값은 4,675,708ms, 즉 77분55.708초다. 이후 사용자 요청 재시작과 watcher 인계 이력은 이 과거 관찰 공백을 채우지 않으며 자발적 제품 crash의 증거도 아니다.

## 14:39 coverage 동결본 독립 검증

- SHA-256은 `coverage.mjs=93A5927D1C677B8AA4AE5214D8B0E1658D1BB990112BD8310D8173368E1C715B`, `coverage.test.mjs=0085A56B1B38E886F651972A42787A6D31DF1B3243A1F5C51682909EAA1F9791`, `COVERAGE.md=2573BD09770C2E94D8CAFE6AF404F81D620D3FCA855F5BF253F6B947F0B4DBCF`다. 독립 `node --test scripts/market-session-audit/coverage.test.mjs` 결과는 23/23 통과, fail/cancel/skip/todo 0이다.
- case-sensitive ID로 재계산해 inventory 1,396개/고유 1,396개와 coverage 1,396행/고유 1,396행이 정확히 일치했다. missing/extra/duplicate는 0이다. `operation:base:0G`/`0g`, `0U`/`0u`는 서로 다른 ID다.
- read artifact 6개의 실제 시도 `operationRef` 합집합은 263/264이며 미시도는 `base:ka10088` 하나다. `kt00010` detail 3개는 REGULAR에서 실제 시도됐지만 HTTP200/code20 `BLOCKED`이고, `ka10088`은 미체결 주문 부재로 미시도다. 따라서 263은 PASS 수가 아니다.
- 첫 final-input artifact의 실제 SHA-256은 `49EA9078196E1732BD732B7F5DB75C1F9D6A40F17B6B84B606FFF3AB38AEA437`이고 `revision:null` 원본을 유지한다. coverage loader는 이 외부 경로 파일을 해당 SHA-256으로 고정하고, 호출별 시각 부재와 당시 `INVALID` 하네스 분류를 별도 제한으로 보존한다. 전체 backend baseline 동일성 증거가 아니다.
- custom REST 실제 ID 합집합은 43개이며 GET41+POST2다. active WS는 이 수에 합치지 않고 custom WebSocket 실제 1개로 따로 센다.
- active WS 0B 행은 REG1/REMOVE1, REAL envelope159, invalid-time event record288, valid/fresh0, upstream REMOVE ACK=false, owned socket close를 그대로 기록한다. 0B 한 source의 transport 관찰이며 다른22개 WS source 실행이나 유효 최신 이벤트 PASS가 아니다.
- MCP는 tools12/actions58의 격리 protocol metadata 일치만 기록하며 call0이다. 사용자 실행 gateway, provider 연결, 도구/action 기능 실행 PASS로 승격하지 않는다.

## 14:46 active WS 및 최신 coverage 독립 검증

- 새 실제 artifact `ws-active-stock-20260907T054609-218Z.json`의 SHA-256은 `787EBF412E934E8DEB8D94AF06A371D81A3065974098FE3CD3669FCF713CEB4B`다. REGULAR/ac8452f/EXECUTE이며 target은 `0B`/`005930`, WebSocket inventory 23개 exact set reconciliation은 true다.
- 결과는 REAL envelope23, REG 전 baseline matching42, REG 뒤 matching row1, valid/fresh1, freshness `<=5s`, invalid-time/stale0이다. verdict `PASS_WITH_CLEANUP_UNVERIFIED`는 matching fresh data 관찰을 뜻한다. baseline matching42가 이미 있었으므로 감사 REG가 이벤트를 발생시켰다는 인과관계는 증명되지 않았다.
- REG1은 `CONTROL_ACK`, REMOVE1은 `CLEANUP_API_ZERO_ACK_OR_SYNTHETIC`, socket은 `OWNED_SOCKET_CLOSED`다. upstream REMOVE ACK는 false이며 다른22개 WS source의 실제 실행은 0이다. 주문·조건·계좌 mutation과 raw message 저장도 false다.
- coverage 최신 SHA-256은 `coverage.mjs=6F05381ECB92E36A83D9F3B42DA56361D45F9F452F6A02BC80BDE190A4AFD8E1`, `coverage.test.mjs=4B6E3F1338ECDCAAA26649FD4BB9478D09B6F7C1478050C56538D94E72722C8B`, `COVERAGE.md=BEC8E865966F0BB3C85CD73315AA56DC5F04977F5019C420F6EC4A8F9A8966ED`다.
- 최신 coverage도 case-sensitive inventory/row 1,396/1,396, missing/extra/duplicate0, read actual263/264, custom REST43, custom WebSocket actual1을 유지한다. `operation:base:0B`와 custom stream 행은 14:28 `BLOCKED_NO_LIVE_EVENT`와 14:46 `PASS_WITH_CLEANUP_UNVERIFIED` 두 이력을 모두 보존한다.
- 독립 focused 실행은 coverage 23/23과 active WS mock 20/20 통과, fail/cancel/skip/todo0이다. 실제 WebSocket 네트워크 호출을 다시 수행하지 않았다.
- context receipt는 `createdAt`을 최초 집계 시각으로, `lastUpdatedAt`을 후첨 종료 시각으로 구분한다. process probe failure 네 raw observer에는 `root_found`/`root_validated` key가 없고 `process_count:null`이다. receipt는 이를 `rootFound/rootValidated:null`, `rootFoundFieldPresent/rootValidatedFieldPresent:false`, `NORMALIZED_UNKNOWN_FROM_ABSENT_RAW_FIELDS`로 보존한다.
- custom compute12 route는 mock10/review pending/actual0이다. source나 테스트 존재를 실제 실행으로 계산하지 않는다. 전체 장중·장후 판정은 계속 PARTIAL이다.

## timing-sensitive 테스트 두 건 독립 검토

- 검토 대상 SHA-256은 `observer.test.mjs=A9B17E6BA13DD15F05AB2F57C4AED30C84F75AECA02C940742D4229F99444261`, `custom-read-chain.test.mjs=677350458DC4B5EFE1679F62378EB8F6D3331D2EF15408334572F0016B030B6B`다.
- observer의 live PID 테스트는 현재 Node test process PID를 사용한다. 정상 probe 응답이면 `root_found=true`, `root_validated=false`, `process_count=0`만 허용한다. bounded probe 오류이면 정확히 `process_probe_failed`와 `process_count:null`만 허용하며, 두 경로 모두 `root_validated=true` 또는 양수 process count를 실패시킨다. probe 불확실성을 Athena 소유 성공으로 바꾸지 않는다.
- Windows 이외에서만 플랫폼 skip 조건이 있으나 이 검증은 Windows에서 실행돼 skip0이었다. production `probeProcesses`의 PowerShell timeout은 4,000ms 그대로다.
- custom duration 테스트는 전역 `setTimeout`을 test-context mock으로 즉시 microtask abort시키고 fetch mock이 전달받은 실제 `AbortSignal`의 abort event에서만 `AbortError`를 반환한다. 따라서 production의 `AbortController`, deadline 비교, `durationLimited`, `DURATION_LIMIT_REACHED` 분기와 attempted source observation을 실제로 통과한다.
- duration 테스트는 `DURATION_LIMIT_REACHED` source observation 존재와 각 `observed_at`을 검사한다. wall-clock 1초 미만을 요구하거나 production timeout을 완화하지 않는다. `t.mock.method`는 test 종료 때 복원되며 바로 뒤 테스트를 포함한 전체 파일 실행이 통과했다.
- 독립 `node --test scripts/market-session-audit/observer.test.mjs scripts/market-session-audit/custom-read-chain.test.mjs` 결과는 25/25 통과, fail/cancel/skip/todo0, 8.902초다. 제품 provider/API 호출이나 제품 프로세스 제어는 없다.
- `harness-regression-20260907T145826KST.json`의 두 aggregate 187/188 실패 기록과 `NOT_ALL_PASS`는 보존한다. 서로 다른 timing-sensitive 실패와 host contention은 원인 확정이 아니며, 이 focused 통과만으로 전체17파일 suite 또는 제품 전체 PASS를 주장하지 않는다.

## 15:13 compute·15:20~16:00 checkpoint 및 최종 coverage 독립 검증

- `custom-compute-probe-20260907151307KST.json`의 SHA-256은 `67B94493CA2E18746AABD9BE086E8056B7A87A0E368FE179638DEF40800AC4D1`이다. artifact는 target12/attempted12/pass12/blocked0, business12/metadata1을 기록한다. 모두 repo test/preset에서 만든 순수 fixture를 사용한 loopback HTTP/JSON 의미 계약 관찰이며 market data, provider, optimizer 실행, persistence, UI 또는 장중 시장 동작의 전체 PASS가 아니다.
- 최종 coverage 동결 해시는 `coverage.mjs=05DDFB0EDD79F0CEEF95B96D45CF34F413653A58072AB5C70EA9A9024EEB88E1`, `coverage.test.mjs=1824A9CA002FB652CB826055E2E271E26F00B5B0DE957DB843A1590ACF1938AF`, `COVERAGE.md=DC49B5FC59791DAC620A6C9B67B6B252CA59461FDF972C13AE5EA76861100DCE`다. 독립 focused 실행은 24/24 통과, fail/cancel/skip/todo0이다.
- 이 동결본은 case-sensitive source inventory 1,396개를 coverage 1,396개 행으로 정확히 대조하며 missing/extra/duplicate0을 유지한다. read 실제 실행 합집합은263/264이고 이는 PASS 수가 아니다. custom REST 실제 고유 범위는55개(GET41+POST14)이며 custom WebSocket stream1은 별도다.
- WebSocket stream 행의 이전 고정 문구 `custom REST 43개 집계와 별도`는 `custom REST execution 집계와 별도`로 교정됐다. 현재 script/test/report에서 고정 숫자43 문구는0회이며 test가 이 중립 문구와 WS 이력·cleanup·REG 인과관계 제한을 확인한다.
- `harness-regression-20260907T154446KST.json`의 SHA-256은 `790D1B06BF9DA3E92C6FAD0942BA0D928DA285A8690601CC27461F71531A9E05`다. 기록된17파일 회귀는15:44:29.692~15:44:46.980 KST,203/203, fail/cancel/skip/todo0,17,085.5596ms다. 이전187/188 두 실행과201/202 phase-clock 실패를 보존하며 WS catalog와 Python MCP suite를 포함하지 않는다. 이 전체 실행은 위 coverage 문구/test 변경 전 snapshot이므로 최신 파일 전체 재실행으로 해석하지 않고, 변경 후 증거는 focused coverage24/24다.
- 15:20/15:30/15:40 checkpoint receipt SHA-256은 각각 `F52EC5B487110337D510B3A67B9B3D6AEF79B74735AE63377963C89A1B4CBF27`, `20EE3B672BC028D07B619D7597C74C71E92C9324E381C92D94A1F021E77907CD`, `2112275D630DE1B2ABF1BF239AA25A7E69DA497B2AF140D0C6D31342C73DCC49`다. 15:20은 PID30288 true/true와 HTTP4/4=200, 15:30·15:40은 이전 PID30288 false/false와 HTTP4/4=200을 기록한다. 사용자 replacement 앱이 별도로 존재했으므로 뒤 두 표본은 전체 앱 outage가 아니며 이전 PID의 부재만 증명한다.
- `runtime-handoff-20260907T154519KST.json`의 SHA-256은 `1FD1FDAB9BA02EF89E057B2776BD49AE9858DFE89C67A251BFE16D0FD6CAD88C`다. 새 watcher 첫 표본은 `process_probe_failed`로 root 필드가 없고 process_count null이어서 신원 UNKNOWN이다. 다음15:43:48 표본에서 app34680 true/true, process_count73, HTTP4/4=200을 확인한 뒤에만 이전 소유 watcher44784를 종료했다. 첫 불확실성을 연속 성공으로 바꾸지 않는다.
- `runtime-handoff-20260907T155321KST.json`의 SHA-256은 `2C78AC454B4292CF2198C7447512323CEA9118EBBFDA0D032691BCDCC8EB1AD8`다. 15:50:48 표본은 이전 app34680 false/false, health/ready200, accounts/OpenAPI timeout과 status null이고,15:51:48에는 HTTP4/4=200으로 회복했다. app36856의 새 watcher 첫15:51:51 표본은 true/true, process_count73, HTTP4/4=200이며 이후 이전 소유 watcher46776을 종료했다. runtime 교체와 timeout의 인과관계, 정확한 지속시간, 전체 앱 건강은 증명되지 않는다. backend34264는 command에 port8010이 포함된 후보일 뿐 TCP listener table과 독립 결합되지 않았고 loaded module hash도 없다.
- 동결된 `STATUS.md`, `NEXT.md`, `WORKTREE-ISOLATION.md`, `DEFECTS.md` SHA-256은 각각 `6FCE7F5BD79C8241033DD3B0CF5E875859EFB1C061B2BB6B1612386A82885C3D`, `8C765DC1EA6BA7F1D3128188D2DFA4C0B8E80BE61242C1771479FD4B70A1FA50`, `4FDC30F24626C8FE6FC0E04FD7DFB5E5461048BBD0DBDE75DA5C4BA6E6BDD82E`, `D0686A705244501B1F2E97587931CFED57BEDA5229437FEEEAFCD9CCBADF1CFC`로 전달된 값과 일치한다. 네 문서는 전체 판정 PARTIAL, REST55/WS1/read263, 203/203의 역사 범위, WS 다른22종 미실행, cleanup·인과관계·TCP 신원 제한과16:30 미관측을 유지한다.
- 별도 16:00 receipt `checkpoint-20260907T160000KST.json`의 SHA-256은 `43B407FBA6B8DA46B368978DE827ADA6A2198D586B96DB8496DD89080C05E519`다. immutable observer `observer-20260907T070052-083Z.json`은16:00:52.083 KST에 PID36856 found/validated true, process_count73, HTTP4/4=200을 기록했으며 예정 시각 뒤52.083초로60초 허용 범위 안이다. 이 표본은 앱 신원과 네 endpoint 상태만 증명하며 전체 기능·데이터 정확성·연속 건강을 닫지 않는다.16:30 종료 표본은 아직 PENDING이다.

이 범위의 증거·문서 정합성 판정은 **PASS**다. 사용자가 요청한 장전30분·장중·마감후1시간 전수 검사 전체 판정은 관찰 공백, 미실행·차단 기능, 제품 의미 검증 및16:30 종료 표본이 남아 **PARTIAL**이다.

## 16:30 종료 및 15:30~16:30 관찰 범위 독립 검증

- 종료 watcher `watch-20260907T071218-597Z.json`의 SHA-256은 `08EE2BD9AA6586351820B4A016DBE6C60F799CE81E29BAC027142E5E156CF2D8`이다. `started_at=2026-09-07T07:12:18.597Z`, `finished_at=2026-09-07T07:30:01.009Z`, `finish_reason=planned_cutoff_reached`, observation19이며 watcher가 기록한 observation/metadata write failure는0이다.
- 마지막 `observer-20260907T073000-002Z.json`의 SHA-256은 `C210AE9E9E86D2A10B6933B3A7D29D5FB07384CFCFB8B798A69D61F85D41FCE8`이다. 실제 시각은16:30:00.002 KST, schedule phase는 `AFTER_AUDIT_WINDOW`, target PID47980은 found/validated true, process_count21, HTTP4/4=200이다. 이 phase는 로컬 KST 시간표 분류이며 provider나 거래소가 보낸 장 상태 확인이 아니다.
- 15:30:00~16:30:00.999 KST 범위에서 관련 watcher4개의 observation reference를 합치면67건이고, 모두 서로 다른 observer artifact다. KST `YYYY-MM-DDTHH:mm`으로 묶으면61개 분 bucket 전부에 관찰이 있으며 handoff 중 병렬 watcher가 만든 추가 표본은6건/6개 분이다.
- 분 단위 중복 제거 규칙은 같은 분에 여러 표본이 있으면 `watch.started_at`이 가장 최신인 watcher의 표본을 선택하는 것이다. 이는 retiring watcher가 이전 PID를 계속 확인한 표본보다 새 handoff watcher를 우선하되 원본67건을 삭제하거나 판정을 바꾸지 않는다.
- 이 규칙의 deduplicated61 표본은 root found/validated36, 명시적 false/false·process_count0인 이전 target 부재20, `process_probe_failed`·process_count null인 신원 UNKNOWN5다. 대상별 선택 표본은 PID30288 12,34680 9,36856 21,47980 19다. 이전 target 부재20은 해당 target PID가 없다는 증거이며, 다른 사용자 앱까지 모두 없었다는 전역 앱 outage 증거가 아니다.
- HTTP는 deduplicated61 중57개 표본이4/4 OK다. 비정상은4개 분/12 endpoint result다.15:49와16:06은 각각4개 endpoint가 `request_failed`여서 합계8건,15:50과16:07은 accounts/OpenAPI가 각각 timeout이어서 합계4건이다. endpoint 비정상 분은 병렬 watcher 중복 분과 겹치지 않아 raw67과 deduplicated61의 비정상 집계가 같다.
- deduplicated 표본의 최대 실제 시각 간격은15:50:48.270→15:51:51.994의63.724초다. 병렬 표본을 모두 유지한67개 artifact union의 최대 간격은15:50:48.270→15:51:48.292의60.022초다. 첫15:30 분 표본은15:30:53.987, 마지막은16:30:00.002다.61/61 분 bucket 존재를 그 사이 연속 정상으로 해석하지 않는다.
- root가 별도 read-only CIM으로 기록한07:32:55.492Z watcher PID34120 부재는 command-context 증거다. 이 검증 lane은 프로세스 조회를 다시 실행하지 않았고, immutable observer/watch artifact가 아니므로 마지막 watcher 파일의 계획 종료 증거와 구분한다.
- 16:30 종료 표본과 분 단위 coverage는 시간 구간 관찰 완료 증거로 **PASS**다. 그러나 endpoint 비정상4분, 신원 UNKNOWN5분, 이전77분55.708초 관찰 공백, 미실행·차단 기능 및 제품 의미 검증 공백이 남으므로 전체 전수 감사 판정은 계속 **PARTIAL**이다.
- 최종 보고 문서 `POSTCLOSE-RESULT.md` SHA-256은 `C24D44D7C70F363BCD5A661E1596EE13EB941609996B4B78EB2634D933830477`, `PHASE-CHECKPOINTS.md`는 `CBC45654963B5697D5F894BEEDD2F4D75E1C4E1B26DB7EAD65483562DB2A485F`, 16:30 receipt `checkpoint-20260907T163000KST.json`은 `BDB823CF8175002CF645B34F69E82E9FE21A8E9DEF32D9ADD34387F77ACA636B`다. 세 파일은 원본 `AFTER_AUDIT_WINDOW`, 계획 종료,67 raw/61 deduplicated 집계, PARTIAL 한계와 command-context CIM 경계를 일치하게 보존한다. `PHASE-CHECKPOINTS.md`의 이전 `현재 관찰 기록` 문구는 `15:53 당시` 역사 시점으로 교정돼 최종 watcher와 충돌하지 않는다. 이 최종 문서 검토 판정은 **PASS**다.
