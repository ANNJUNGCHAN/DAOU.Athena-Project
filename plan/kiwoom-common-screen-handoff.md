# 키움 공통화면 Ultragoal 인수인계

기준 시점: 2026-08-15

저장소: `C:\Projects\DAOU.Athena`

브랜치: `main`
원격: `origin = https://github.com/ANNJUNGCHAN/DAOU.Athena.git`

이 문서는 새 Codex 작업에서 키움 공통화면 Ultragoal을 그대로 이어가기 위한 실행 인수인계다. 제품 전체 인수인계는 [`00-인수인계.md`](00-인수인계.md), 원래 요구사항은 [`kiwoom-common-screen-brief.md`](kiwoom-common-screen-brief.md)를 먼저 참고한다.

## 1. 가장 먼저 할 일

1. `git status --short --branch`로 `main`과 `origin/main` 상태를 확인한다.
2. 로컬 Ultragoal 상태가 남아 있으면 `.omx/ultragoal/goals.json`과 `.omx/ultragoal/ledger.jsonl`을 읽는다.
3. 런타임 상태가 없거나 새 clone이라면 이 문서와 `kiwoom-common-screen-brief.md`를 기준으로 동일한 7개 스토리를 다시 만든다.
4. G001은 완료된 것으로 취급하되 아래 검증 명령을 새 환경에서 다시 실행한다.
5. 다음 구현은 G002 `Normalized screen contracts and generated control hints`부터 시작한다.

로컬 Ultragoal의 마지막 확인 상태는 다음과 같다.

| 스토리 | 상태 | 의미 |
|---|---|---|
| G001 Canonical inventory and coverage manifest | 완료 | 301개 라우팅 매핑과 22개 제외 원본을 생성·검증함 |
| G002 Normalized screen contracts and generated control hints | 진행 중, 미구현 | 다음 시작점 |
| G003 Shared Athena canvas and reusable screen states | 대기 | 공통 캔버스와 상태 컴포넌트 |
| G004 Electron IPC, backend, and guarded workflow integration | 대기 | 안전한 preload/IPC 및 워크플로 연결 |
| G005 Exhaustive route and field coverage verification | 대기 | 301개 전수 증명 |
| G006 Paper artboards and Markdown screen-planning specification | 대기 | Paper와 최종 화면기획서 |
| G007 Runtime, visual, invariant, and independent-review closeout | 대기 | 실앱·시각·불변식·독립 리뷰 |

## 2. 범위와 확정된 숫자

권위 원본은 다음 세 파일이다.

- `backend/ref/kiwoom-tr-inventory.json`
- `backend/ref/kiwoom-output-profile.json`
- `backend/ref/response-projections.json`

G001이 생성한 단일 커버리지 원장은 `backend/ref/kiwoom-common-screen-manifest.json`이다.

| 항목 | 수량 |
|---|---:|
| 키움 원본 operation | 208 |
| 분할되지 않은 원본 | 186 |
| 분할 파생 route | 115 |
| 공통화면/워크플로 라우팅 합계 | 301 |
| 화면에서 제외하는 분할 원본 | 22 |
| read/display | 264 |
| WebSocket workflow | 23 |
| order workflow | 12 |
| OAuth workflow | 2 |

`301 = 186 + 115`이며, 301개 모두를 일반 조회 화면으로 다루면 안 된다. 실제 일반 조회·표시 대상은 264개이고, 나머지 37개는 생명주기와 안전 가드가 있는 워크플로다.

제외되는 22개 분할 원본은 다음과 같다.

`ka10001`, `ka10002`, `ka10004`, `ka10007`, `ka10040`, `ka10087`, `ka20001`, `ka20009`, `ka30012`, `kt00001`, `kt00004`, `kt00005`, `kt00009`, `kt00010`, `kt00011`, `kt00012`, `kt00013`, `kt00016`, `kt00017`, `kt00018`, `kt50020`, `kt50032`

이 22개 원본은 백엔드 호환 route로 남아 있어도 공통화면 정의에는 들어오면 안 된다. 대신 `response-projections.json`의 115개 파생 route만 화면 대상이다.

## 3. 지금까지 구현된 것

G001 구현 파일은 다음과 같다.

- `backend/scripts/generate_api.py`
  - authoritative inventory/profile/projection에서 공통화면 매니페스트를 결정적으로 생성한다.
  - 합계, 분류, 제외 집합, route identity, operation ID, alias, provenance를 검증한다.
  - `--check`에서 생성 산출물이 오래됐으면 실패한다.
- `backend/ref/kiwoom-common-screen-manifest.json`
  - 301개 mapping과 22개 exclusion을 가진 기계 판독 원장이다.
- `backend/tests/test_common_screen_manifest.py`
  - generated Pydantic alias, registry/detail route, OpenAPI method/path/operationId, 대소문자 구분 ID, 고아·중복·인프라 route 누락을 검증한다.

검증에서 확인한 핵심 불변식은 다음과 같다.

- 301개 mapping ID가 case-sensitive하게 모두 고유하다.
- `(method, path, operationId)` 301개가 모두 고유하고 실제 FastAPI OpenAPI와 연결된다.
- `base:0G`, `base:0g`, `base:0U`, `base:0u`가 서로 다른 ID로 보존된다.
- `/raw`, `/batch`, `/catalog`, `/health`, `/ready`, `/api/v1/ws/stream` 같은 인프라 route는 301개에 섞이지 않는다.
- 분할 파생 115개는 facts 105개와 table 10개로 구성된다.
- 22개 분할 원본은 `replaced_by_split_derived_detail_routes` 사유로만 제외된다.

관련 구현은 커밋 `76c8cbf4450b74bfd423b9d3b20fe5f0c8fe0940` (`feat(backend): regenerate Kiwoom API layer with screen manifest`)에 들어 있다.

## 4. 최소 공통화면 결정

Athena의 기존 두 창 구조를 유지한다. 채팅 창은 명령과 설명을 담당하고, 캔버스 창은 데이터 shape를 표시한다. operation마다 별도 화면 파일을 만들지 않는다.

최소 구성은 하나의 공통 캔버스 shell과 세 개의 재사용 가능한 구성요소다.

1. **Adaptive Record Canvas**
   - facts, table, mixed 모드
   - 264개 read/display 결과와 action receipt/status의 정적 결과를 수용
2. **Live Stream Canvas**
   - append/replace, pause/follow, reconnect, dropped-event 상태
   - WebSocket REAL 이벤트의 시간·연결 의미를 보존
3. **Schema-driven Request Sheet**
   - 조회 입력, 구독 시작/중지, 주문 draft/review/confirm, OAuth lifecycle control
   - 결과 표시와 외부 side effect 제어를 분리

기존 `ui/canvas-taxonomy.md`의 차트·호가·포트폴리오 등은 선택적 semantic lens다. 전수 커버리지 primitive가 아니며, 의미 정보가 부족한 route를 억지로 차트로 추론하지 않는다.

디자인은 `ui/soul.md`, `ui/palette.md`, `ui/liquid-glass.md`, `ui/DESIGN-SOUL.md`, `app/styles/tokens.css`, `app/styles/access.css`를 따른다. Liquid Glass는 배경 재료이며 실시간 데이터 갱신층과 분리해야 한다. reduced-transparency, increased-contrast, reduced-motion fallback은 필수다.

## 5. G002 구현 계약

G002는 다음 산출물을 구현해야 한다.

- versioned `ScreenDefinition`
  - `screenId`, source identity, mode, controls, sections, continuation, safety, provenance
- versioned `ScreenDocument`
  - `loading`, `ready`, `empty`, `error`, `unavailable`, `auth_required`, `action_required` 상태
  - facts/table/status/event_stream/order_receipt section
  - opaque cursor와 페이지 provenance
- lossless cell
  - `raw`와 `display`를 분리하고 전역 숫자 강제 변환을 하지 않는다.
- reviewed control overrides
  - schema semantics보다 우선하되 최소한으로 유지한다.
  - WebSocket protocol 상수, condition continuation, account/sensitive/order 의미만 명시한다.
- deterministic generator
  - 301개 definition을 G001 manifest에서 생성한다.
  - projection layout이 항상 일반 shape 추론보다 우선한다.

모든 request leaf는 정확히 하나로 분류되어야 한다.

- user control
- injected constant
- main-process-only secret
- 명시적 generation failure

안전 불변식은 다음과 같다.

- 주문은 화면 open/refresh/retry에서 절대 실행하지 않는다.
- 주문은 draft → review → explicit confirm → receipt 순서이며 `auto_execute=false`다.
- 테스트·검증에서는 live order를 절대 호출하지 않는다.
- OAuth 화면은 credential 입력이나 token value를 renderer에 노출하지 않는다.
- WebSocket은 명시적 start/stop과 reconnect/drop 상태를 가진다.
- 일반 HTTP continuation은 header 기반이며 `ka10172` condition continuation만 body 기반 예외다.

권장 renderer-facing API는 다음처럼 screen ID만 권한 경계로 사용한다.

```text
listDefinitions()
runRead(screenId, input)
continueRead(cursorToken)
prepareAction(screenId, input)
commitAction(actionToken)
startSubscription(screenId, input)
stopSubscription(subscriptionToken)
onScreenEvent(callback)
```

renderer가 URL, path, bearer, raw header, adapter 종류를 직접 선택하게 하면 안 된다.

## 6. Electron과 Paper의 현재 상태

현재 Electron은 `app/`의 두 창 shell과 mock 기반 `stream`, `reader`, `table` 렌더러까지 있다. 실제 키움 공통화면 runtime은 아직 연결되지 않았다.

다음 단계에서 해야 할 핵심은 다음과 같다.

- direct mock import와 `mock:true` 경로 제거
- 안전한 preload/contextBridge와 screen-ID 기반 IPC 추가
- `ScreenDocument` 공통 renderer 추가
- HTTP/WebSocket adapter와 명시적 fixture adapter 분리
- cursor, subscription token, one-shot action token을 Electron main에서 소유

Paper Desktop의 기존 파일은 `Athena — 화면설계서`다.

- 파일: <https://app.paper.design/file/01M002A3JJ5SNHH8Z5AVB9KSQQ/1-0>
- 추가한 아트보드 골격:
  - `12 · 공통 API 화면 원칙`
  - `13 · 데이터 매핑 · 검증`
  - `14 · AT-CV-005 공통 API 캔버스`
  - `15 · AT-CV-005 상태 · 안전`
- 아직 내용·상태 variant·스크린샷 비평·`finish_working_on_nodes`가 완료되지 않았다.
- G006에서 실제 구현과 숫자를 다시 대조한 뒤 완성해야 한다.

## 7. 2026-08-15 최신 검증 기준선

다음 명령은 현재 `main`에서 다시 실행했다.

```powershell
cd C:\Projects\DAOU.Athena\backend
uv run python scripts\generate_api.py --check
uv run ruff check scripts\generate_api.py tests\test_common_screen_manifest.py
uv run pytest tests\test_common_screen_manifest.py tests\test_io_docs.py -q
```

결과:

- generator check: 통과 (`Generated files are current`)
- Ruff: 통과
- G001 + IO docs: **16 passed**, Starlette/httpx deprecation warning 1개

Electron 실앱 검증:

```powershell
cd C:\Projects\DAOU.Athena\app
npm run verify
```

결과:

- exit code 0
- boot 시 canvas hidden, chat ready
- 독립 창 이동·리사이즈, 접근성 3종, Enter E2E, 수동 resize 통과
- 이번 실행의 확장 p95는 **266.9ms**, 수축 p95는 **83.4ms**였다.
- 기능 검증은 통과했지만 확장 성능은 G007의 개선·재검증 대상이다.

전체 백엔드 기준선:

```powershell
cd C:\Projects\DAOU.Athena\backend
uv run pytest -q
```

결과: **403 passed, 22 failed, 1 warning**.

22개 실패는 모두 `tests/unit/test_selector_eval.py`에 집중된다. 주요 원인은 분할 detail 질의가 제외된 base operation을 선택하는 문제, preferred detail ranking 실패, 모호한 account 질의를 거부하지 않는 문제, 한·영 detail title first-rank 불변식 실패다. G001 매니페스트 테스트 실패가 아니며, 이후 selector와 화면 definition을 연결하기 전에 반드시 해결해야 한다.

## 8. 커밋·푸시 체크포인트

현재 공통화면 관련 주요 커밋은 다음과 같다.

| SHA | 내용 |
|---|---|
| `8752378` | agent runtime·cache ignore 규칙 |
| `e9c8eab` | LLM API selector service |
| `a7cd936` | investment brain knowledge layer |
| `d877ea2` | `athena_mcp` aggregator server |
| `76c8cbf` | 키움 API 재생성 + 301개 공통화면 manifest |
| `4e4d885` | Electron Liquid Glass canvas prototype |
| `b130485` | plan·UI·spike·인수인계 자료 |
| `904940f` | 통합 인수인계·검증 기준선·KRX 캡처 마스킹 |

위 커밋들은 2026-08-15 기준 `origin/main`에 푸시됐다. 이 문서는 공통화면 작업만의 재개 지점을 분리해 설명하는 후속 인수인계 자료다.

## 9. 새 작업에서 사용할 시작 프롬프트

```text
C:\Projects\DAOU.Athena에서 plan/kiwoom-common-screen-handoff.md와
plan/kiwoom-common-screen-brief.md를 먼저 읽고 현재 git status 및
.omx/ultragoal/goals.json, ledger.jsonl을 확인해라.

G001은 backend/ref/kiwoom-common-screen-manifest.json과 관련 테스트를
새 환경에서 재검증한 뒤, G002 Normalized screen contracts and generated
control hints부터 이어서 구현해라. 22개 분할 원본은 화면에 포함하지 말고,
186개 unsplit base + 115개 split-derived = 301개만 다뤄라.
301개 중 264개만 read/display이며 23 WebSocket, 12 order, 2 OAuth는
guarded workflow다. live order는 절대 호출하지 마라.
```

## 10. 완료로 오인하면 안 되는 것

- G001만 완료됐다. 전체 Ultragoal은 완료되지 않았다.
- G002 `ScreenDefinition`/`ScreenDocument` 계약은 아직 구현되지 않았다.
- Electron은 실제 FastAPI/키움 데이터가 아니라 mock canvas를 사용한다.
- 301개 전수 DOM/IPC/field sentinel 검증은 아직 없다.
- Paper 아트보드는 골격만 있고 최종 비평·완료 처리가 남았다.
- 전체 백엔드 테스트는 22개 selector 평가 실패가 있다.
- 독립 code-reviewer `APPROVE`와 architect `CLEAR`를 받지 않았다.
- runtime, visual, safety, architecture invariant 최종 게이트를 통과하지 않았다.

이 항목이 모두 해결되고 G001~G007이 체크포인트된 뒤에만 aggregate goal을 완료 처리한다.
