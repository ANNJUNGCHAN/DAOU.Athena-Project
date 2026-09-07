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
