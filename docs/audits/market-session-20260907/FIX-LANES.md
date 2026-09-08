# 16:30 이후 제품 수정 병렬 작업 계획

이 문서는 2026-09-07 장 마감 후 1시간 관찰이 끝난 뒤 시작할 제품 수정 handoff다. 지금은 수정 브랜치·worktree·커밋을 만들지 않는다. 감사 기준은 `ac8452f5b62a338d74826ac27cf65da12d99320b`이며, 각 수정은 `codex/market-fix-<ID>` 브랜치와 별도 worktree에서 수행한다.

## 시작 게이트

수정은 다음 조건을 모두 만족한 뒤 시작한다.

1. 16:30 KST 이후 오늘의 watcher와 장후 점검 결과가 보존되고, 새 제품 결함이 `DEFECTS.md`에 분류돼 있다.
2. `C:\Projects\DAOU.Athena`의 다른 사용자 작업 `codex/fix-backtest-editor-form` 상태와 변경 파일을 다시 확인한다. 그 폴더의 브랜치·프로세스·파일은 수정하거나 제어하지 않는다.
3. 기준 커밋 `ac8452f`가 존재하고 현재 `main`의 위치를 기록한다. `main`을 되돌리지 않는다. 재현 전용 수정 브랜치는 정확히 `ac8452f`에서 만들고, 다른 사용자 작업이 먼저 `main`에 반영됐다면 통합 전에 그 커밋을 별도로 받아 충돌과 의미 변경을 재검증한다.
4. 각 worktree에서 `git status --short --branch`와 기존 tracked/untracked 변경을 기록한다. 같은 논리 파일이라도 격리 worktree에서 서로 다른 feature 구간의 구현·테스트는 병렬로 진행할 수 있지만, current main 및 다른 사용자 delta와의 semantic conflict 검사와 통합은 한 lane씩 직렬로 수행한다. 다른 소유자의 파일은 stage하지 않는다.
5. 수정 전 각 lane의 최소 재현 검사를 먼저 실행해 기준 실패를 남긴다. 기준 실패가 재현되지 않으면 추측으로 코드를 바꾸지 않고 조사 결과만 기록한다.

브랜치 생성 형태는 다음과 같다. 경로 이름은 예시이며 실제 생성 시 빈 경로인지 다시 확인한다.

```powershell
git worktree add -b codex/market-fix-BOOT-001 C:\Projects\DAOU.Athena-fix-BOOT-001 ac8452f
```

사용자가 요청한 16:30 이후 별도 branch/worktree 생성과 검토된 feature별 로컬 commit은 승인 범위 안이다. commit 직전에 해당 worktree의 소유권과 status를 다시 확인하고 자신의 파일만 stage한다. `main` merge와 push는 이 계획에서 수행하지 않는다.

## 우선순위와 병렬 배치

| 배치 | lane | 현재 판정 | 병렬 여부 | 시작 조건 |
|---|---|---|---|---|
| A | BOOT-001 | 실제 기동 실패 및 병목 계측 완료 | BOOT-002와 병렬 가능 | 16:30 관찰 종료 |
| A | BOOT-002 | 실행 중 backend에 대한 중복 spawn 재현 완료 | BOOT-001과 병렬 가능 | 16:30 관찰 종료 |
| B | BOOT-003 | 초기 실패와 동일 PID 인덱스 회복 실측, reconciliation 누락은 소스 분석 | 구현 병렬·통합 직렬 | 16:30 관찰 종료, commit 전 current delta 검토 |
| C | AUTH-002 | 소스 연결 누락 확인, 계좌 alias 권위 계약 미완료 | 조사·구현 병렬·통합 직렬 | 16:30부터 권위 source 조사, 없을 때만 제품 결정 blocker |
| D | CARD/SCREEN/CONTRACT/MINI | fixture/계약 불일치, 다수는 제품 원인 미확정 | 진단 병렬·통합 직렬 | 16:30 이후 current delta 대조와 전수 gate 재실행 |

BOOT-001과 BOOT-002는 파일 소유권이 분리돼 첫 배치에서 동시에 진행한다. BOOT-003과 AUTH-002도 별도 worktree에서 각자 선언한 `app/main.js` wiring 구간과 helper/tests를 병렬로 수정할 수 있다. 다만 두 branch 및 다른 사용자 `app/main.js` delta를 합치는 작업은 직렬로 수행한다. 카드·화면·미니 진단도 병렬로 시작하되, 현재 다른 사용자 작업의 card contract/template, `main.js`, `canvas.js`, `shell.css`, 백테스트 UI 변경과 동일한 해결을 중복 구현하지 않도록 commit 전과 통합 전에 current delta를 다시 대조한다.

## Lane A1 — BOOT-001 instrument identity 기동 병목

**브랜치:** `codex/market-fix-BOOT-001`

**확인된 실패:** 실제 크기 3,525개 종목의 alias regex를 eager compile하는 데 39.282초가 들었고, 전체 lifespan은 42.175초였다. Electron과 selector worker가 동시에 시작된 실제 기동에서는 60초 hard deadline을 넘겨 launcher가 자신이 만든 backend를 종료했다.

**전용 소유 파일:**

- `backend/athena_api/selector/instrument_identity.py`
- `backend/tests/unit/test_instrument_identity.py`
- 필요할 때만 `backend/tests/api/test_instrument_identity_api.py`
- 성능 영수증은 해당 worktree의 ignored artifact에 기록한다. 제품 문서는 이 lane에서 수정하지 않는다.

**구현 경계:**

- snapshot에 현재 normalized alias/code의 원자적 전체 집합을 유지한다.
- snapshot 생성 중 종목 수만큼 `_alias_pattern()`을 compile하지 않는다.
- `resolve()`에서 normalized question으로 후보 alias를 먼저 제한한 뒤, 소수 후보에만 기존 lexical boundary 검사를 적용한다.
- exact code, 한글·영문 casefold, 부분 문자열 거부, 이름 충돌과 다중 후보 fail-closed 동작을 그대로 유지한다.
- launcher timeout 연장, 일부 시장 snapshot 게시, 합성 종목명, 외부 source 대체를 이 lane에 포함하지 않는다.

**재현과 검증:**

```powershell
cd backend
.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_instrument_identity.py tests/api/test_instrument_identity_api.py -q
.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_selector_core.py tests/unit/test_selector_compatibility.py tests/unit/test_selector_typed_routing.py tests/api/test_selector_dispatch.py -q
```

같은 3,525개 입력 snapshot을 최소 3회 새 프로세스에서 측정한다. alias 원문이나 credential은 artifact에 저장하지 않고 record 수, alias 수, snapshot 시간, 첫 resolve 시간만 기록한다. 이어서 격리된 임시 HOME/DB와 비주문 설정으로 cold backend를 1회 띄우고 manifest 200 도달 시각을 측정한 뒤, 동일 격리 조건의 cold Electron self-spawn을 1회 실행한다.

**종료 기준:**

- 3,525개 snapshot을 만들 때 `_alias_pattern()` compile 횟수가 종목 수에 비례하지 않는다.
- 기존 identity/API/selector 대상 검사가 모두 통과한다.
- 3회 snapshot 측정의 최댓값이 15초 미만이고, cold backend manifest가 30초 안에 200을 반환한다. 이는 60초 제품 deadline에 최소 2배 여유를 두는 이번 수정의 성능 gate다.
- cold Electron이 수동 8010 우회 없이 backend를 한 번만 spawn하고, 60초 이후에도 그 자식이 살아 있으며 manifest가 200이다.
- 성능 수치가 환경 부하 때문에 기준을 넘으면 통과로 완화하지 않고 측정 원인과 원시 시간만 보고한다.

## Lane A2 — BOOT-002 기존 backend 오판과 중복 spawn

**브랜치:** `codex/market-fix-BOOT-002`

**확인된 실패:** 이미 정상인 backend의 첫 manifest 검사가 약 1,515ms로 한 번 timeout되자 새 backend를 spawn했다. 다음 검사는 기존 backend에서 성공했지만, 새 자식은 credential lock 충돌로 code 3 종료했다.

**전용 소유 파일:**

- `app/lib/main/backend-launcher.js`
- `app/lib/main/backend-launcher.test.js`

**구현 경계:**

- 첫 precheck timeout을 곧바로 프로세스 부재로 해석하지 않는다.
- 가벼운 liveness와 manifest readiness를 분리하거나, 동일 의미를 보존하는 짧고 제한된 재확인을 추가한다.
- 재확인 중 한 번이라도 기존 backend가 응답하면 `already-running`으로 반환하고 spawn하지 않는다.
- 새 자식을 만들었다면 기존 backend 응답과 그 자식의 readiness/exit를 같은 사실로 합치지 않는다.
- 무제한 retry, 60초 deadline 단순 연장, credential lock 무력화, 기존 8010 프로세스 종료를 포함하지 않는다.

**재현과 검증:**

먼저 테스트 seam에서 `첫 검사 1,515ms timeout → 다음 검사 200`을 재현해 기존 코드의 spawn 1회를 고정한다. 수정 후 다음 표를 모두 검증한다.

| 시나리오 | 기대 |
|---|---|
| 첫 manifest timeout, 제한된 재확인 200 | `already-running`, spawn 0 |
| 첫 두 번 timeout, 세 번째 200가 허용 retry 안 | `already-running`, spawn 0 |
| 모든 liveness/readiness 검사 실패, venv 있음 | spawn 정확히 1 |
| self-spawn 자식이 pending | 후속 ensure에서 추가 spawn 0 |
| self-spawn 자식 exit/error | 소유 상태 정리, 기존 backend로 오기록 금지 |
| 59.9초 최종 health 성공 | 자식 보존 |
| 실제 hard deadline까지 무응답 | 그 lane이 만든 자식만 정리 |

```powershell
cd app
& 'C:\Program Files\nodejs\node.exe' --test lib/main/backend-launcher.test.js
```

단위 검사 뒤 격리된 stub server로 첫 응답만 1.5초 이상 지연시키고 cold Electron을 실행한다. 실제 사용자 backend나 다른 task 프로세스에는 지연을 주입하지 않는다.

**종료 기준:**

- 위 표의 모든 테스트가 통과하고 기존 backend가 있는 지연 시나리오에서 spawn 0이다.
- backend가 실제로 없을 때는 bounded 확인 뒤 정확히 한 번 spawn한다.
- 로그가 `existing backend`, `self-spawn child`, `child exit`을 구분하며 credential/token/계좌 원문을 남기지 않는다.
- 전체 `app` unit suite에서 회귀가 없다.

## Lane B — BOOT-003 stock-index readiness 회복 전파

**브랜치:** `codex/market-fix-BOOT-003`

**관찰과 추론의 경계:** 최초 `ka10099` HTTP 502와 `stock-index` startup task failed, 같은 PID가 545.190초 후 3,525개 인덱스를 원자적으로 적재한 사실은 실제 관찰이다. 회복 후 readiness 화면을 다시 캡처하지는 않았다. background 성공에서 startup task를 succeeded로 바꾸는 reconciliation callback이 없다는 점과 실패 상태가 자동 정정되지 않는다는 판정은 소스 분석이다.

**충돌 게이트:** 16:30 이후 `ac8452f`에서 별도 branch/worktree를 즉시 만들 수 있다. 구현과 대상 테스트는 다른 lane과 병렬로 진행한다. feature commit 전과 integration 직전에 원래 작업 및 current main의 `app/main.js`와 아래 파일 delta를 읽는다. 새 동작에 이미 reconciliation 경로가 생겼으면 중복 구현하지 않고 재검증만 하며, 겹치는 hunk와 의미 통합은 한 branch씩 처리한다.

**전용 소유 파일:**

- `app/lib/main/stock-entity-index-readiness.js`
- `app/lib/main/stock-entity-index-readiness.test.js`
- `app/lib/main/startup-readiness.js` 및 `.test.js`는 실제 API 보강이 필요할 때만
- `app/main.js`의 stock-index wiring 구간만

**구현 경계:**

- 기존 0/10/8 시장 전체 성공 후 atomic replace 조건을 유지한다.
- 초기 12초 실패는 그대로 failed로 보이며 부분 snapshot을 게시하지 않는다.
- 이후 background refresh가 non-empty 전체 snapshot을 게시한 정확한 시점에 단 한 번 `startupReadiness.update('stock-index', succeeded)`를 호출한다.
- update가 revision 증가와 renderer broadcast를 거치도록 기존 readiness 경로를 사용한다.
- stop/abort 뒤의 늦은 성공, 이전 attempt의 stale completion, 부분시장 결과는 succeeded로 승격하지 않는다.

**재현과 검증:**

```powershell
cd app
& 'C:\Program Files\nodejs\node.exe' --test lib/main/stock-entity-index-readiness.test.js lib/main/startup-readiness.test.js lib/main/rest-dataset-runner.test.js
```

필수 새 회귀는 `초기 refresh 실패 → ensureReady deadline false → background 전체 refresh 성공` 순서에서 failed→succeeded 전이가 정확히 한 번 발생하고 revision/broadcast가 한 번 갱신되는 사례다. 0/10/8 중 하나가 실패하는 사례, abort/stop, 동시 ensureReady, 성공 뒤 추가 retry 없음도 유지한다.

**종료 기준:**

- 초기 502 동안 partial snapshot 0, task failed가 명시된다.
- 후속 전체 성공 시 동일 프로세스에서 task succeeded, phase 재계산, 새 revision broadcast가 확인된다.
- stale/partial/aborted 결과로는 회복하지 않는다.
- fixture Electron에서 합성 첫 실패 후 background 성공을 관찰하고, 실제 Kiwoom upstream 장애를 새로 만들거나 주문/OAuth를 실행하지 않는다.

## Lane C — AUTH-002 direct REST 계좌 선택

**브랜치:** `codex/market-fix-AUTH-002`

**현재 상태:** `activeRestAccountId()`는 로컬 재시도 권한 binding에 쓰이지만 `rest-dataset-runner.js`의 resolve/render-plan 두 요청에는 `X-Athena-Account`가 없다. 다만 로컬 account ID와 backend alias의 교집합이 0이며 동일 credential 여부도 미검증이다. 따라서 헤더에 로컬 ID를 그대로 넣는 패치는 금지한다.

**시작 조건:** 16:30 이후 별도 branch/worktree에서 계좌 선택 source archaeology와 deterministic 테스트 seam 구축을 BOOT-003과 병렬로 시작한다. 완료 계약은 (a) 로컬 계좌 설정이 검증된 backend alias를 명시적으로 저장·선택하거나, (b) backend가 권위 있게 노출한 explicit data alias를 앱이 선택·사용·표시하는 형태 중 하나다. 단순히 로컬 OAuth와 backend data account가 다르다고 UI에 설명하면서 backend default를 계속 쓰는 형태는 완료가 아니다. 저장소와 backend 어디에도 권위 alias source가 없을 때만 근거를 기록하고 제품 결정 blocker로 올린다.

**예상 소유 파일:**

- `app/main.js`의 direct REST 호출 wiring 구간
- `app/lib/main/rest-dataset-runner.js`
- `app/lib/main/rest-dataset-runner.test.js`
- 선택 mapping의 기존 저장소 모듈과 그 테스트 한 쌍만, 실제 조사 후 소유 목록에 추가

**필수 계약:**

- resolve와 render-plan이 같은 검증된 backend alias를 사용한다.
- 요청 시점에 alias가 없거나 unknown이면 첫 fetch 전에 전체 direct REST dataset을 명시적으로 차단하며 backend default로 조용히 대체하지 않는다.
- account A/B mock에서 두 요청이 각각 같은 A/B runtime으로 간다.
- local expiry와 backend readiness는 계속 다른 상태로 표시된다.
- alias, 계좌번호, token 원문을 로그·fixture·artifact에 저장하지 않는다.
- 주문, OAuth 재발급, 실제 계좌 전환은 자동 실행하지 않는다.

**대상 검사:**

```powershell
cd app
& 'C:\Program Files\nodejs\node.exe' --test lib/main/rest-dataset-runner.test.js
```

runner 단위 검사만으로 닫지 않는다. `app/main.js`의 active data-account 선택 seam에서 `runDirectRestDataset`/`runRestDataset`으로 전달되고, resolve와 render-plan 두 요청에 동일한 exact `X-Athena-Account`가 들어가는 wiring 통합 fixture를 추가한다. A/B 각각의 exact header, missing/unknown alias에서 첫 fetch 전 BLOCKED와 physical call 0, default fallback 0을 deterministic mock으로 검증한다. 추가로 backend의 없는 alias/준비되지 않은 alias 계약 검사를 실행한다. 실제 파일명은 mapping 소유 모듈을 확정한 뒤 좁혀 기록한다. 계좌 간 실제 데이터 차이를 acceptance로 쓰지 않는다.

## Lane D — 카드·화면·계약·미니 진단 후 선택 수정

이 배치는 한 번에 77개나 모든 화면을 고치는 작업이 아니다. 현재 증거 중 `CARD-001`, `SCREEN-001~005`, `CONTRACT-001~002`, `MINI-001`은 제품 코드와 fixture/추출기/대장 중 책임이 미확정이다. `SCREEN-006`은 fixture 회귀가 확정됐지만 백테스트 UI 작업과 겹친다. 먼저 현재 main에서 전수 gate를 재실행해 남는 행만 수정 대상으로 승격한다.

### D0 — 다른 사용자 변경 반영과 원인 분류

다른 사용자 작업이 현재 다음 영역을 수정 중이므로 16:30 이후 진단 branch를 즉시 만들되 feature commit 전과 통합 전에 해당 diff를 검토한다: `app/main.js`, `app/canvas.js`, `app/shell.css`, board mount/format, generated CC-03 template, backend card surface contract/templates, `137X-2` pack/slots, provider 관련 파일. 이를 복사하거나 같은 수정을 다시 만들지 않는다.

현재 main을 별도 clean worktree에서 다음 순서로 검사한다.

```powershell
cd app
npm run verify:paper-cards-all
npm run verify:paper-screens
npm run verify:paper-mini
```

결과는 board ID별로 이전 artifact와 exact 비교한다. 사라진 실패는 다른 사용자 수정으로 해결됐다고 즉시 단정하지 않고 해당 커밋과 gate 증거를 연결한다. 남은 실패는 아래 책임 분류를 통과해야 제품 lane을 만든다.

| 분류 | 대표 ID | 수정 후보 | 승격 조건 |
|---|---|---|---|
| runtime mount/contract | CARD-001 `137X-2` | board mount, generated CC-03, backend surface contract/template | 정본 7상태와 DOM 6상태의 누락 항목 및 생산 경로 책임이 일치 |
| route inventory | SCREEN-001~005 | `paper-screen-routes.js`, route tests/ratchet | 보드가 제품 지원 대상으로 확인되고 단순 검증 목록 누락이 아님 |
| backtest flow UI | SCREEN-006 `2FR9-2` | `backtest-canvas.js`, `paper-screen-routes.js` | 현재 UX 정본에도 6문구/4+4 node/3 boundary가 필요함을 확인 |
| contract extraction | CONTRACT-001~002 | 정본 계약 문장 또는 extractor | 원본 문장 부재와 parser 미검출 중 하나를 최소 fixture로 구분 |
| mini ledger parity | MINI-001 | Paper ledger, compare/report, runtime mini renderer | 212행을 source-of-truth별로 묶고 대표 1건을 시각/DOM으로 대조 |
| audit harness | HARNESS-MINI-001 | `probe-paper-mini-template.js` | fixture boot handoff만 실패하고 제품 runtime과 무관함을 확인 |

### D1 — 분기와 파일 직렬화 규칙

- `codex/market-fix-CARD-001`: `137X-2` 한 보드만. card contract/template/pack/slots는 서로 강하게 결합돼 한 lane이 모두 소유한다.
- `codex/market-fix-SCREEN-006`: `2FR9-2`만. `backtest-canvas.js`와 `paper-screen-routes.js`를 소유하며 다른 화면 lane과 동시에 수정하지 않는다.
- `codex/market-fix-SCREEN-ROUTES`: SCREEN-001~005 중 현재 제품 지원 대상으로 확인된 보드만. route 파일이 SCREEN-006과 겹치므로 SCREEN-006 뒤에 실행한다.
- `codex/market-fix-CONTRACT-001-002`: 계약 문장/추출기 책임이 같은 경우에만 묶는다. 서로 다른 원인이면 보드별로 분리한다.
- `codex/market-fix-MINI-001`: 정본이 확정된 동일 원인 묶음만 처리한다. 77개를 일괄 치환하지 않는다.
- `codex/market-fix-HARNESS-MINI-001`: 제품 branch와 분리된 감사 하네스 lane이다. 제품 정상/불량 판정을 열기 위한 수정이며 product fix 통계에 포함하지 않는다.

### D2 — acceptance

- CARD-001: `ATHENA_VERIFY_BOARD_IDS=137X-2` 단일 gate에서 expected/in_dom 7/7, 네 preset 모두 통과 후 전체96 mount 96/96. 실제 시세·차트 데이터 성공은 별도 live card 검증으로 남긴다.
- SCREEN-006: `2FR9-2` 단일 route에서 6개 문구, app/mine node 4/4, boundary 3/3이 DOM에 있고 backtest 계산 테스트가 회귀하지 않는다. 현재 UX 정본이 달라졌다면 ratchet을 몰래 낮추지 않고 정본 변경 근거를 기록한다.
- SCREEN-001~005: 각 board가 실제 route로 실행되고 해당 loading/error/disabled 상태를 렌더한다. 이름만 route 목록에 추가하거나 빈 화면을 PASS로 세지 않는다. 전체 screen gate가 95/95 실행 가능해야 한다.
- CONTRACT-001~002: 14개 정적 계약이 모두 기계 검증 가능한 문장을 제공하고, 각 문장이 실제39필드나 chart 행 계약과 일치한다. parser 예외로 board ID를 하드코딩하지 않는다.
- MINI-001: 수정 원인 묶음의 divergent row와 annotation drift가 0이 되고, 전체192보드/96 ledger를 다시 비교한다. static 통과 뒤 template runtime 11/11·문법10/10 및 대표 카드 시각 검토를 별도 수행한다.
- HARNESS-MINI-001: fixture-only `startBootReadinessForVerify()` 경로로 실제 backend autostart 없이 boot handoff가 끝나며, renderer 11/11·문법10/10 결과를 얻는다. 이 결과는 live mini 기능 전체 통과가 아니다.

## 통합 순서

1. BOOT-001과 BOOT-002를 각각 독립 검토한다. 두 branch의 대상 테스트와 전체 backend/app unit suite를 실행한다.
2. 두 branch를 임시 integration worktree에서 함께 적용해 cold Electron self-spawn을 재검증한다. BOOT-001은 기동 시간을 줄이고 BOOT-002는 기존 backend 오판을 막으므로 결합 동작을 반드시 본다.
3. BOOT-003과 AUTH-002는 격리 worktree에서 병렬로 구현·검토한다. commit 전에 각각 current main/다른 사용자 delta를 대조한다.
4. 통합 worktree에서는 BOOT-003, AUTH-002, 다른 사용자 `app/main.js` 변경을 한 branch씩 적용하고 wiring 구간의 semantic conflict를 직렬로 검증한다. AUTH-002는 권위 alias source가 없으면 구현 완료로 표시하지 않는다.
5. 카드/화면/미니 전수 gate를 최신 main에서 다시 실행하고, 여전히 남으며 원인이 확정된 lane만 순서대로 수정한다.
6. 최종 integration 후보에서 `app` 전체 unit, 관련 Paper gate, backend 전체 또는 변경 범위에 맞는 suite를 실행한다. 실패·skip·TODO를 성공으로 세지 않는다.

각 lane은 author와 별도의 reviewer/verifier가 아래를 확인해야 통합 후보가 된다.

- 변경 파일이 선언한 소유 범위 안에 있는가.
- 기준 실패를 실제로 재현했고 같은 검사로 수정 후 통과했는가.
- 비밀값, 실제 계좌 식별자, 주문/OAuth 실행, 외부 source 대체가 없는가.
- `test.skip`, `test.only`, placeholder, ratchet 완화, 하드코딩 PASS가 없는가.
- 다른 사용자 변경을 덮거나 되돌리지 않았는가.
- live 재검증이 불가능한 항목은 그 한계를 명시했는가.

## 제품 수정에서 제외할 현재 항목

- `OBSERVATION-001`: 호스트 재부팅 전후 77분55.708초 관찰 간격이다. 제품 crash가 입증되지 않아 코드 수정 lane이 아니다.
- `ENV-001`: 설치 누락은 npm ci/installer로 복구된 환경 문제다. 표준 gate 재실행은 남지만 제품 patch 대상이 아니다.
- `HARNESS-FINAL5-001`, `HARNESS-METADATA-001`, `HARNESS-PROJECT-001`, `HARNESS-UI-001`: 감사 하네스 결함이며 제품 수정 통계에서 제외한다.
- final-5의 `kt00010` code20, `ka10088` 미체결 주문 부재, WS 미실행/무이벤트: 현재 환경·데이터 부재 또는 미검증이다. 제품 결함으로 승격하지 않는다.
- `AUTH-OBS-001`: 로컬 expiry와 backend readiness는 서로 다른 원장이라는 진단과 일치했다. 동일 token 모순이 입증되지 않아 수정하지 않는다.
- `QA-EVAL-001`, `QA-PERF-001`, `FIXTURE-001~005`: 별도 평가/검증 debt다. 오늘 확인된 BOOT·계좌·화면 제품 수정과 한 branch에 섞지 않는다.

## 중단 규칙

다음 중 하나가 발생하면 해당 lane을 멈추고 증거와 blocker를 기록한다.

- 현재 main 또는 다른 사용자 branch가 같은 실패를 이미 해결해 기준 재현이 사라짐.
- 선언하지 않은 공용 파일 수정이 필요하거나, 직렬 통합과 current delta 검토 후에도 해소되지 않는 semantic conflict가 남음. 격리 worktree에서 같은 논리 파일의 서로 다른 feature 구간을 병렬 수정하는 것 자체는 중단 사유가 아니다.
- 실제 계좌 alias, OAuth, 주문, routine 활성화 또는 credential 확인 없이는 acceptance를 증명할 수 없음.
- Paper/ledger/코드 중 권위 있는 정본을 결정할 근거가 없음.
- 수정 후 대상 검사는 통과하지만 전체 관련 suite 또는 cold-start 결합 검사가 실패함.

오늘의 전체 장 운영 감사는 이 수정 계획과 별개다. 16:30까지의 관찰과 전수 검사 결과가 부분이면 수정 몇 건이 통과해도 “모든 기능 정상”으로 보고하지 않는다.
