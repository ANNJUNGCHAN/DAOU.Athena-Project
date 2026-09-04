# 플러그인 모드 기조 정렬 — 합의 계획 (RALPLAN-DR)

| 항목 | 값 |
|---|---|
| 제목 | 플러그인 모드 "모드가 대화의 경계" 기조 정렬 — Paper + 실앱 + 게이트웨이 |
| 날짜 | 2026-09-03 |
| 원천 명세 | `.omc/specs/deep-interview-athena-plugin-doctrine.md` (di-athena-doctrine-plugin-20260903, 모호도 18%) |
| 상태 | **approved for execution** — 합의 도달(반복 7, Critic APPROVE 7/7 게이트) · 사용자 지시 2026-09-03 "합의 정제 후 ralph 실행" · 실행 위치 워크트리 `C:\Projects\DAOU.Athena-plugin` 브랜치 `feat/plugin-mode-doctrine` |
| RALPLAN-DR 모드 | **deliberate** |
| 반복 | 7 (Critic 최종 게이트 필수 1건 반영 — §10.6 변경 이력) |

---

## 1. 요구 요약

**목표.** 플러그인은 `mode='plugin'`인 대화 창이다. 그 창의 채팅이 **설치 · 기능 허용/철회 · 켜기/끄기 · 삭제 · 스니펫 등록** 5동작을 **제안 턴**으로 내고, 플러그인 캔버스가 **승인 카드**로 확정한다. 제안은 게이트웨이 built-in 툴로 **모델**이 내고, 실행은 **사람 클릭 전용 IPC**만 한다. 허브·관리의 GUI 버튼은 유지하되 같은 게이트로 합류한다(두 입구, 한 게이트).

**3요소 토폴로지(활성).**

| 컴포넌트 | 범위 | 수락 기준 |
|---|---|---|
| `plugin-paper` | Paper `플러그인` 페이지(`B-2`) 6장 정정 + 07~09 신설 | ① |
| `plugin-ui` | `plugin-canvas.js` · `plugin-canvas.css` · `chat.js` · `main.js` 반영 | ② |
| `plugin-chat-control` | 게이트웨이 제안 툴 → 승인 카드 → 사람 클릭 IPC | ③ + ②의 chat/main 항목 |

**명시적 비목표(미룸).** ⑴ Athena 전 표면 기조 정본화 ⑵ 플러그인 외 Paper 페이지 수정 ⑶ 카드→실앱 파리티 트랙 ⑷ **모드 귀속 대화 창 인프라 구현**(`mode` 필드·다중 창·스냅샷 복원 — §6이 계약만 고정) ⑸ 플러그인 창 안의 도구 **호출(실행)** UX(`@멘션`·키우미 그대로) ⑹ 외부 마켓플레이스 확장. **제약 "타 모드 불간섭"의 승인된 예외(사용자 결정 2026-09-03 — 아래 줄)(O-9 · RC-4).** W3-6이 `#chatModeHead`를 그래프 전용에서 그래프+플러그인으로 넓히며 `shell.html:296-299`의 하드코딩 문구를 controller 주입으로 바꾼다 — **그래프 모드 표면을 실제로 만진다.** 이것이 ①-03의 채팅 헤더 "아테나 · 플러그인 대화"를 만족시키는 가장 짧은 이음매이며, 사용자가 2026-09-03에 예외를 **승인**했다(결정은 종결 — 검수 안건이 아니다). 방어는 A10 3종 회귀 단언 + `verify-graph-mode.js`(§7-3b)로 건다.

**【사용자 결정 2026-09-03: 그래프 헤더 예외 **승인** — `#chatModeHead`를 모드별 문구를 가지는 공용 모드 헤더로 일반화한다. 그래프 모드 문구·동작은 회귀 단언 3종(`verify-graph-mode.js` 포함)으로 불변 고정. `#pluginChatHead` 폴백은 채택하지 않는다】**

**롤백 전용 기록(결정은 승인으로 종결 — 이 문단은 실행하지 않는다. 훗날 되돌릴 일이 생기면 이 문단대로만 되돌린다).** ⑴ `app/shell.html:296-299`(`#chatModeHead` 하드코딩 2줄)와 `app/lib/graph-mode/controller.js:302`(`elements.chatHead.hidden = !graphView`)를 **한 글자도 건드리지 않는다** — W3-6을 통째로 철회한다. ⑵ ①-03의 채팅 헤더 "아테나 · 플러그인 대화"는 **플러그인이 소유한 별도 요소**가 그린다: `canvas.js`가 `#chatModeHead`의 **형제**로 `#pluginChatHead`(제목 `아테나 · 플러그인 대화` · 부제 `설치와 권한을 여기서 정합니다`)를 삽입하고, `window.AthenaCanvasMode = graphMode` 노출 지점(작업 트리 `app/canvas.js:2466`, 워크트리는 심볼 `AthenaCanvasMode`로 재탐색)에서 `setView`를 감싸 호출 뒤 어댑터 `currentMode()`를 읽어 `hidden = currentMode() !== 'plugin'`으로 토글한다. 삽입·토글 코드가 전부 `canvas.js`의 플러그인 구역에 있으므로 **그래프 코드는 0줄 바뀐다.** ⑶ 이 폴백에서도 ①-03은 만족된다 — 헤더 문구가 화면에 뜨는 것이 요구이고, 그 요소의 소유자가 누구인지는 요구가 아니다. ⑷ **회귀 단언(폴백 채택 시 A10을 이 3종으로 교체한다):** 플러그인 모드에서 `#pluginChatHead`가 보이고 제목이 `아테나 · 플러그인 대화`다 · 같은 순간 `#chatModeHead`는 `hidden === true`다 · 그래프 모드에서 `#chatModeHead`의 제목 `그래프에게 묻기`·부제 `답이 캔버스를 바꿉니다`가 그대로이고 `#pluginChatHead`는 `hidden === true`다. 그 밖의 어떤 모드 표면도 건드리지 않는다.

---

## 2. RALPLAN-DR

### 2.1 원칙 (4)

1. **모델 툴은 레지스트리·consent·배포를 변이시키지 않는다.** ("실행 없음"이 아니다 — `athena_backtest`는 `run`·`optimize`로 **실제 연산을 돌린다**(`backtest_tools.py:36-52`, 13액션). 불변량은 *어떤 상태를 바꾸느냐*다.) 선례 4종: `nudge_guard_tools.py:39` `("propose","get")` (설정 저장 없음) · `routine_tools.py:31` `("draft","list")` (활성화 없음) · `brain_tools.py:44` (그래프 쓰기 없음) · `backtest_tools.py:36-52` (backfill·activate·deploy 없음 — 연산은 하되 배포는 못 한다). **플러그인 제안 툴은 이 축에서 가장 엄격한 자리에 선다: 읽기만 하고 아무것도 안 바꾼다.**
2. **선례를 복제하되 새 기전을 만들지 않는다.** 제안→카드→사람 클릭 왕복은 `athena_nudge_guard`가 끝까지 구현돼 있다(`nudge_guard_tools.py:99-149` → `main.js:2172-2187` → `chat.js:1184-1188` → `chat.js:2638-2712` → `main.js:1272-1300`). 새 채널·새 저장소를 발명하지 않고 이 5단 배선을 그대로 복제한다.
3. **제안은 아무것도 바꾸지 않는다.** **파일 이름 확정(이 계획에서 `registry.json`은 별칭이다).** 레지스트리 실제 경로는 **`~/.athena/mcp_servers.json`**(`backend/athena_mcp/registry.py:185-189 default_registry_path()` · `app/lib/main/mcp-cli.js:24-25 registryPath()`)이고 `ATHENA_MCP_REGISTRY_PATH`로 오버라이드된다. consent는 **같은 디렉터리의 `consent.json`**(`mcp-cli.js:28-33 stateDir()`/`consentPath()`)이다. 아래 어디서든 `registry.json`이라 쓰면 이 두 파일을 가리킨다 — **불변 단언을 stat하는 테스트는 반드시 이 실제 경로를 쓴다**(선례: `app/verify-plugins.js:18-19`가 `mkdtempSync` 후 `process.env.ATHENA_MCP_REGISTRY_PATH`를 세팅한다). 두 소비자 파일(payload 생성은 `registry.py:224-230 _payload()`, `"revision"` 키는 `:227`; consent는 `consent.py:178-186`)은 제안만으로 1바이트도 변하지 않는다. 이것을 테스트가 고정한다(`test_nudge_guard_tools.py:50-69`의 `calls == ["GET"]` 증명 패턴).
4. **화면은 정직하다.** 가짜 행 금지 · **제안의 출처를 숨기지 않는다**(모델 제안과 GUI 버튼 합성 제안은 봉투의 `source` 필드와 카드 라벨로 구분된다 — §2.3 축 2). 낙관적 토글 제거는 이 원칙이 아니라 **수락 기준 ①-04("낙관적 토글 없음")** 하나에 근거한다 — 현행 `plugin-canvas.js:452-453`이 낙관적으로 칠하고 `:464-470`이 실패 시 되돌리므로 오늘 코드가 정직성을 위반하고 있는 것은 아니다.

### 2.2 결정 동인 (상위 3)

| # | 동인 | 근거 |
|---|---|---|
| D1 | **보안 게이트 불변** — consent·probe·감사 구조를 건드리지 않는다 | `server.py:421-424` 호출별 재확인 · `consent.py:361-369` 감사 4필드(인자 본문 제외). 이 구조를 바꾸면 게이트웨이 테스트 330건(`backend/tests/mcp/`)이 전부 재검증 대상이 된다 |
| D2 | **선행 인프라 부재를 우회** — `mode` 필드가 없다 | `lib/main/conversations.js:63-69`·`:177-183` 레코드에 `mode` 없음, `chat-history-store.js:7-24`에도 없음. `shellWin`은 단일 창(`main.js:196`·`:356`). 어댑터 없이는 착수 불가 |
| D3 | **왕복 지연·결정성** — GUI 버튼 클릭은 즉시 반응해야 한다 | 기존 사람 클릭 경로는 전부 "LLM 재스폰 없이 렌더러가 직접 호출"(`chat.js:2489-2490`, `:2632-2633`). 버튼에 LLM 왕복을 끼우면 수 초 지연 + 실패 가능 경로가 새로 생긴다 |

### 2.3 선택지

#### 축 1 — 제안 봉투를 어떻게 나르는가

**(A) 새 게이트웨이 built-in 툴 + tool_result 스크레이핑** ← **채택**

`backend/athena_mcp/plugin_tools.py` 신설(`nudge_guard_tools.py` 149줄 형판), `server.py:401-407` 옆에 dispatch 분기 1개 + `server.py:761`(`*backtest_tools.builtin_tool_defs(),`) 뒤에 등록 1줄 — 형제 등록 순서를 지킨다(W1-3과 같은 값). `main.js:2172-2187` 형판으로 `tool_result`에서 뽑아 렌더러로 push.

- 장점: 선례 5단 배선이 통째로 존재 · 백엔드 HTTP/WS 불필요(게이트웨이가 레지스트리·consent를 직접 읽음, `registry.py:264-266 snapshot()`·`consent.py:225 snapshot()`) · **비영속**이라 제안이 디스크를 오염시킬 수 없다 · 신규 테스트가 `test_nudge_guard_tools.py`(103줄, 7건)의 1:1 사본 · `GATEWAY_ALLOWED_TOOLS = 'mcp__athena,Task,Read,Glob'`(`lib/main/claude-tool-policy.js:15`)가 서버 단위 허용이라 툴 정책 변경 0.
- 단점: 제안이 **턴 수명**에 묶인다(`chat.js:1185`의 `myToken !== abortToken` 가드) → "제안 대기" 카드를 창 복원까지 살리려면 누군가 보관해야 한다(→ D로 보완). 새 모듈 1개(~180줄) 추가.

**(B) 기존 캔버스 사이드채널 재사용 (`athena__render_canvas` + `plugin_proposal` canvas_type)** ← 기각

- 장점: 캔버스 push 경로가 이미 카드를 캔버스에 직접 띄운다(`canvas_data.py:364` `POST /api/v1/canvas/push` → `canvas_push.py:838-930` → WS → `main.js:1141-1167`).
- **기각 사유(2):** ⑴ 그 경로는 `plan_token`(키움 sealed plan) 전용이다 — `server.py:344-361` 게이트가 `plan_token` 또는 `data`를 요구하고, `canvas_data.py:267-288`은 **manifest가 canvas_type을 이긴다**고 못박았다. 플러그인 제안에는 manifest도 operation_ref도 없다. ⑵ 백엔드 HTTP+WS가 살아 있어야 제안이 뜬다. 플러그인 관리를 키움 백엔드 가용성에 종속시키는 것은 결합도 역행이다. *(통합 카드 422 게이트는 기각 사유가 아니다 — `canvas_push.py:892`의 교집합이 비면 `:893` 블록을 통째로 건너뛴다.)*

**(D) 봉투를 메인 프로세스가 소유 (`lib/main/plugin-proposal-registry.js`), 렌더러는 구독** ← **A와 함께 채택 (종합안)**

A의 전달 기전은 그대로 두되 **봉투의 생애를 메인이 진다** — 턴 수명·1회용 소비·`revision` 대조·복원이 한 자리에 모인다. 장점: A의 유일한 단점(턴 수명)이 사라지고 PM-2·PM-3·H6이 **같은 모듈 하나**에서 닫히며, 렌더러는 상태를 소유하지 않고 그리기만 한다(`plugin-canvas.js:599-601`의 "가짜 행 금지" 주석과 같은 자세 — 대상 함수 `approveInstall`은 `:602`). GUI 경로(C1)도 같은 레지스트리를 지나 두 입구가 물리적으로 합류한다. 단점: 메인에 상태 보유자 1개, 앱 종료 시 미해결 제안 소실(PM-2 완화 참조).

**(E) 기존 `athena_routine` draft 채널 확장** ← 기각

신규 툴 0이라는 장점이 있으나, `routine_tools.py:31`의 draft는 **백엔드에 영속**한다(`chat.js:2496 refreshRoutineDrafts()`가 폴링으로 발견). 플러그인 제안은 비영속이어야 하고(원칙 3), 루틴(예약 발화)과 플러그인을 한 `_ALLOWED_ACTIONS`에 섞으면 원칙 1의 "가장 엄격한 자리" 보증이 깨진다.

**축 1 결론:** **A + D**. 전달은 A, 소유는 D. B는 표면 유사성만 같고 게이트·의존성이 다르며, E는 영속성·도메인 경계가 어긋난다.

#### 축 2 — GUI 버튼 클릭이 제안을 어떻게 만드는가

**(C1) 렌더러가 같은 제안 봉투를 로컬 합성** ← **채택**
**(C2) 클릭이 모델에게 제안을 요청**

| | C1 | C2 |
|---|---|---|
| 지연 | 0ms (동기 합성) | LLM 왕복 (수 초) |
| 결정성 | 봉투 빌더가 순수 함수 → 단위 테스트 가능 | 모델이 대상·기능을 틀릴 수 있다 |
| 실패 경로 | 없음 | 백엔드/세션 다운, 툴 미호출, 오제안 |
| 선례 부합 | `chat.js:2489-2490` "LLM 재스폰 없이" 원칙 그대로 | 선례 없음 |

**축 2 결론:** C1. 봉투 빌더는 DOM 없는 `app/lib/plugin-proposal.js`에 두어 모델 경로(A)와 GUI 경로(C1)가 **같은 함수**로 봉투를 만든다 — `lib/guard-confirm.js`가 diff·병합 로직을 DOM 밖에 둔 것과 같은 자리. 이로써 "두 입구, 한 게이트"가 코드 수준에서 강제된다(봉투 스키마 검증기 1개).

**출처 표시는 필수다(원칙 4).** 봉투는 `source: "model" | "gui"`를 **필수 필드**로 갖는다. GUI 버튼이 합성한 제안을 모델이 낸 것처럼 그리면 사용자가 "아테나가 제안했다"고 오독한다 — 정직성 위반이다.

| | `source: "model"` | `source: "gui"` |
|---|---|---|
| 채팅 턴 머리 | `제안` 필(외곽선, `.routine-draft-pill`) | 채팅 턴을 만들지 않는다 |
| 캔버스 카드 라벨 | `아테나 제안` | `내 요청` |
| 근거 줄 | 모델이 넘긴 `reason` 문자열 | `허브에서 [설치]를 눌렀습니다` 류 고정 문구(동작별 5종) |

GUI 경로가 채팅 턴을 만들지 않는 이유: 사용자가 방금 누른 버튼을 채팅이 "아테나가 제안합니다"로 되읊는 것은 잡음이며, 문구 3원칙의 설명문 금지에 걸린다. 사용자 R4의 "제안 턴을 거쳐 같은 승인 카드로 합류"는 **같은 승인 카드·같은 게이트**로 충족된다.

**렌더 시점과 권위 경계 결정문(ralph는 이 두 줄 밖을 고르지 않는다).**
1. **GUI 클릭은 공유 빌더로 봉투를 동기 합성해 그 자리에서 카드를 그린다.** 메인에 먼저 등록하고 `athena:plugin-proposed`가 되돌아오길 기다리지 않는다 — 그러면 C1을 고른 근거(D3 지연·결정성)가 무너진다. 클릭 시점의 상태 변경은 0이다. **GUI 봉투의 `revision` 출처(R-4):** PM-3 배선 1로 `mcp-cli.js list()`가 `revision`을 함께 돌려주게 되므로(현행 `:106-137`은 `:136`에서 `{ servers }`만 반환 — 실측), `canvas.js`가 가장 최근 `pluginRefresh()`(`:2581-2599`, `athena:mcp-list` 호출은 `:2583`)에서 받은 값을 모듈 변수에 보관해 `buildProposal(..., revision)`에 넘긴다. **아직 못 얻었으면 `null`을 싣는다** — `validateProposal`은 `revision` 키의 존재를 요구하되 `null`을 허용하고, `isProposalStale`은 `null`이면 **만료로 판정하지 않으며**, 승인 직전 메인이 현재 값으로 채운다(W2-4 ⑶). 이 한 줄이 없으면 자율 실행자는 GUI 봉투를 `revision` 없이 만들어 `validateProposal`이 전량 거부하거나(GUI 입구가 죽는다), 필수에서 빼서 stale 방어가 GUI 경로에서만 무력화된다.
2. **메인의 권위는 승인 시점에만 요구된다.** `athena:plugin-approve`는 `proposal_id`가 아니라 **봉투 전체**를 인자로 받아 "미등록이면 등록하고 즉시 소비, 이미 소비됐으면 거부"를 **원자적으로** 수행한다. 사전 등록 왕복이 없으므로 "메인에 없는 `proposal_id`를 참조해 거부됨" 경합이 소멸하고, PM-2의 1회용 보증은 소비 맵이 그대로 진다.

**C2 무효화 근거:** D3(지연·결정성)에 정면 충돌하고, 실패 시 사용자에게 "버튼을 눌렀는데 아무 일도 안 일어남"이 남는다. 현행 GUI 버튼은 즉시 시트를 연다(`plugin-canvas.js:310-317`) — 이 반응성을 잃는 것은 기능 후퇴다.

### 2.4 프리모템 — 5가지 구체적 실패 시나리오

**PM-1. 모델이 Kiwoom/brain 별칭 또는 카탈로그 밖 서버를 제안한다.**
정보구조 결정상 Kiwoom 시세·주문·계좌와 brain은 내장 API이며 플러그인이 아니다(`PAPER_DESIGN_AUDIT.md:65`). 모델이 "brain 켜줘"를 제안하면 사용자에게 존재하지 않는 플러그인의 승인 카드가 뜬다.
- 탐지: 제안 툴 dispatch가 대상 별칭을 `registry.snapshot()`(`registry.py:264-266`)의 서버 목록과 `CATALOG`(`lib/plugin-catalog.js`, 5종)에 대조. 어느 쪽에도 없으면 `_blocked`.
- 완화(**권위 검증은 두 곳: 백엔드 제안 게이트 + 메인 승인 게이트**. 렌더러 검증은 UX용 선반영일 뿐 권위가 아니다 — R-6): **⑴ 백엔드(`plugin_tools.py`).** `_BLOCKED_ALIASES`(kiwoom·brain 계열) 상수 + 액션별 멤버십 게이트 — `install` → `lib/plugin-catalog` `CATALOG` 멤버십 필수 · `allow_tools`·`revoke_tools`·`set_enabled`·`remove`(4종) → 레지스트리 멤버십 필수. **⑵ `stage_snippet`의 게이트를 따로 정한다(C-7 — 위 두 게이트 어느 쪽도 적용 불가).** 스니펫이 정의하는 별칭은 등록 전이라 카탈로그에도 레지스트리에도 없다. `{"mcpServers":{"brain":{...}}}`는 두 멤버십을 모두 통과하고, 반대로 레지스트리 멤버십을 요구하면 `stage_snippet`이 **항상** 차단돼 확정 9의 5번째 동작이 통째로 죽는다. **결정:** ⑴ 봉투의 `target`은 **`null`**이고 `snippet` 문자열만 싣는다 — 백엔드는 스니펫을 파싱해 별칭을 뽑되 그것을 `target`에 쓰지 않는다(카드 제목은 07번 5열대로 `직접 등록`). ⑵ 게이트는 **파싱 후 `mcpServers`의 모든 키에 대해 `_BLOCKED_ALIASES` 검사**를 돌린다 — 하나라도 걸리면 `_blocked`. ⑶ **파싱 불가 · 별칭 0개 · 2개 이상은 전부 거부**한다(`_blocked`, 사유 문구 3종). 한 카드 = 한 서버가 07번 5열과 05번 카드 필드의 전제다. **⑶ 메인 재검증 — 게이트의 거처를 하나로 확정한다(RC-3).** 위 ⑴·⑵의 복제본을 **`lib/main/plugin-proposal-registry.js`(순수 모듈)가 소유**하고 — `CATALOG`와 executor의 `list`를 주입받아 판정한다 — `main.js`의 `athena:plugin-approve` 핸들러는 그것을 **호출만** 한다(W2-4 ⑴). 게이트를 핸들러 본문에 두지 않는 이유: `verify-plugins.js`는 Electron 진입점인 `main.js`를 require할 수 없어 레지스트리 모듈에 executor를 **직접 주입**하는 하네스이므로(`verify-plugins.js:23-24`), 게이트가 핸들러에만 있으면 ⑴ 차단 별칭 봉투가 그 하네스에서 게이트를 우회해 실제 CLI를 태우고 ⑵ 아래 테스트 줄이 요구하는 `plugin-proposal-registry.test.js` 단언이 원리적으로 통과할 수 없다. **없으면 안 되는 이유:** 확정 10이 승인 인자를 `proposal_id`가 아니라 **봉투 전체**로 정한 순간 메인은 봉투의 출처를 확인할 수단이 없다 — `source` 필드는 봉투 안에 있으니 자기 신고이고, W1-1이 강제하는 `source="model"`은 게이트웨이 경로에만 걸린다. 오늘은 `canvas.js:2692-2694`가 `pluginCatalog.findEntry`로 카탈로그 멤버십을 검사하고 IPC가 8개 고정 채널(`main.js:4202-4209`)로 좁혀져 있는데, 새 설계는 그것을 "임의 액션 배열을 받는 단일 채널"로 넓힌다. 백엔드 게이트만으로는 부족하다 — `mcpCli.register`/`approve`는 별칭이 무엇이든 실행한다. 메인 재검증이 없으면 "Kiwoom·brain은 플러그인이 아니다"가 관례일 뿐 구조가 아니다. **⑷** 렌더러도 카드 렌더 직전 2차 검증(`plugin-proposal.js`의 `validateProposal`) — **UX용 선반영**이다.
- 테스트: `test_plugin_tools.py::test_builtin_and_unknown_aliases_are_blocked` — `@pytest.mark.parametrize("alias", ["brain","kiwoom","kiwoom-selector","없는서버"])`, 핸들러에 `raise AssertionError`를 심어 HTTP·파일 접근이 새지 않았음을 증명(`test_backtest_tools.py:38-48` 패턴). **추가 2건:** `test_snippet_declaring_brain_is_blocked`(`{"mcpServers":{"brain":{...}}}` 스니펫 제안이 차단된다 — C-7) · `plugin-proposal-registry.test.js`의 "차단 별칭 봉투는 executor를 한 번도 부르지 않는다"(R-6).

**PM-2. 승인 카드가 두 번 실행된다 / `mcp_security_mutation` 재기동과 경합한다.**
사용자가 승인을 두 번 누르거나, 첫 승인이 유발한 재기동(`main.js:2507-2523`) 도중 두 번째 카드가 승인된다. 결과: `DuplicateAliasError`(`registry.py:41`)로 실패 배너가 뜨거나, 최악의 경우 revoke→approve가 뒤집혀 끝난다.
- 탐지: ⑴ 레지스트리 `revision` 불일치(아래 PM-3 배선). ⑵ `runMcpMutation`(`main.js:2529-2566`)의 직렬 실행자(`mcp-runtime-coordinator.js:20 createSerialExecutor`)가 두 번째를 큐잉하므로 순서는 보장되나 **결과는 뒤집힐 수 있다**. — *(검토 반영)* 게이트웨이 에폭 만료(`server.py:340-341`)는 **탐지 신호가 아니다**: 그것은 모델의 **툴 호출 경로**에만 뜨고 승인 클릭이 타는 `ipcMain` 경로에는 관여하지 않는다. 다만 재기동 중 모델이 `athena_plugin`을 부르면 이 메시지가 뜨므로, **제안 툴 호출 경로**의 관측 신호로만 좁혀 쓴다.
- 완화: ⑴ 제안 봉투에 `proposal_id`(nonce) — 메인의 `plugin-proposal-registry.js`(옵션 D)가 **1회용 소비 맵**에 등록하고 두 번째 승인은 `{ok:false, error:'이미 처리된 제안입니다'}`로 즉시 반환. ⑵ 카드 버튼은 클릭 즉시 양쪽 비활성(`chat.js:2681-2683` 형판) + 시트의 `sheet.busy` 가드 유지(`plugin-canvas.js:241-243`). ⑶ 승인 실행 전 **executor의 `list`**(W2-3의 8종 중 하나 — `mcpCli.list()`)로 대상 상태 재확인. 이미 원하는 상태면 실행 없이 결과 턴만 낸다(멱등). 이 능력이 executor 집합에 있어야 `verify-plugins.js` 하네스도 같은 판정을 잴 수 있다.
- **소비 맵의 수명 한계와 완화:** 맵은 **프로세스 수명**이다. 승인 실행 도중 앱이 죽으면 그 `proposal_id`의 소비 기록이 사라진다. 완화: 재기동 후 미해결 제안을 복원하지 않는다(제안은 비영속이 원칙이다 — H6 복원은 **같은 프로세스 안의 모드 이탈·재진입**만 대상). 앱 재시작 시 모든 제안은 사라지고 사용자는 캔버스에서 실제 상태를 다시 본다. 이 경계를 09번 보드에 문장으로 못박는다.
- 테스트: `lib/main/plugin-proposal-registry.test.js` — 같은 `proposal_id` 2회 소비 시 두 번째가 거부되고 `mcpCli`가 1회만 불렸음을 스파이로 증명.

**PM-3. 창 복원이 레지스트리 변경 후의 낡은 "제안 대기" 카드를 재생한다.**
09번 보드 계약대로 제안 대기 카드를 복원했는데, 그 사이 사용자가 설정 카드(`settings-cards.js:997` 직접 삭제 경로)나 키우미 경로에서 그 플러그인을 지웠다. 카드를 승인하면 존재하지 않는 별칭에 대해 실행이 돈다.
- **배선 2줄(둘 다 신규 작업이다 — 오늘 코드에 없다):**
  1. **`app/lib/main/mcp-cli.js:106-136 list()`에 `revision`을 추가한다.** 현행 `list()`(`:106-137`)는 `{ servers }`만 돌려주고 revision을 **버린다**(`:136`). `readRegistry()`(`:44-46`)가 registry.json 전체를 읽고 그 payload에 `revision`이 최상위 키로 들어 있으므로(파일 payload를 만드는 곳은 `registry.py:224-230 _payload()`이고 `"revision"` 키는 `:227`, 디스크에서 되읽는 곳은 `:222 int(raw.get("revision", 0))`이다 — `RegistrySnapshot`(`:178-182`)은 **메모리 스냅샷**이지 파일 payload가 아니다), `return { servers, revision: registry.revision ?? null }` 한 줄이면 된다.
  2. **`plugin_tools.dispatch`는 revision을 찍기 직전 `registry.reload()`(`registry.py:258-262`)를 부른다.** 게이트웨이의 `ServerRegistry`(`server.py:232`)는 `_load()` 캐시라 **CLI 프로세스가 낸 변경을 볼 수 없다** — reload 없이 찍은 revision은 게이트웨이 기동 시점의 낡은 값이고, 그러면 stale 판정이 항상 거짓 음성이 된다. 공개 접근자는 `registry.py:251-252`의 `revision` 프로퍼티다(`@property`는 `:250`).
- 완화: `revision` 불일치면 승인 버튼을 비활성화하고 카드를 **`만료됨`** 상태로 렌더 + `다시 제안받기` 칩. 절대 자동 재실행하지 않는다.
- 테스트: `lib/plugin-canvas.test.js`에 "복원된 제안이 낡은 revision이면 승인 버튼이 비활성이다" 1건 + `plugin-proposal.test.js`의 `isProposalStale(proposal, currentRevision)` 순수 함수 테스트 + `test_plugin_tools.py::test_revision_is_stamped_after_reload`.

**PM-4. 권한 초안이 consent와 발산한다.**
사용자가 권한 화면에서 도구 3개를 켠 초안(H4)을 남기고 모드를 떠난다. 그 사이 모델 제안이 승인돼 같은 서버의 도구 허용이 바뀐다. 돌아와 초안을 저장하면 **그 사이의 변경을 조용히 덮어쓴다** — 사용자는 자기가 무엇을 되돌렸는지 모른다.
- 탐지: H4 복원 시점에 초안 스냅샷(`featureRowsFor` 결과, `plugin-canvas.js:203-231`)을 현재 consent 값과 필드 단위로 비교.
- 완화: 발산이 있으면 저장 버튼 위에 발산 항목을 나열한다 — `그 사이 바뀐 기능: 시세 조회 · 종목 검색`. 사용자는 `초안대로 저장` 또는 `현재 값으로 초기화`를 고른다. 조용한 덮어쓰기는 없다.
- 테스트: `plugin-canvas.test.js` — 초안과 다른 `features`로 `setData()` 후 발산 목록이 렌더되고 저장 버튼이 두 갈래를 제공한다.

**PM-5. 모드 밖 제안이 채팅을 소음으로 채운다(O-A5·O-C9).**
`athena_plugin`은 상주 세션 전역에 노출되므로(`lib/main/claude-tool-policy.js:15`가 서버 단위 허용) 모델이 **대화 모드에서** 같은 제안을 반복해 부를 수 있다. 그때마다 W0 결정문의 폐기 경로가 한 줄 결과 턴을 남기면 채팅이 같은 문장으로 도배된다.
- 완화: **같은 봉투 서명(`action`+`target`, 스니펫은 `action`+스니펫 해시)에 대해 한 턴에 한 번만 알린다.** 두 번째부터는 조용히 버린다(카드도 pending도 없다 — RC-A2와 정합).
- 테스트: `chat.js` 순수 렌더 함수 단위 — 같은 서명 봉투 2회 주입 시 결과 턴 노드가 1건.

### 2.5 확장 테스트 계획

| 층 | 대상 | 파일 / 명령 |
|---|---|---|
| **단위(백엔드)** | 액션 enum 6종만(§8 확정 2) · enum 밖 `gateway-blocked` · **제안 후 두 파일 불변**(`ATHENA_MCP_REGISTRY_PATH`로 잡은 임시 `mcp_servers.json`·`consent.json` — §2.1 원칙 3) · 별칭 게이트(`stage_snippet` 포함 — §2.4 PM-1) · `server._builtin_tool_defs()` 등록 | 신규 `backend/tests/mcp/test_plugin_tools.py` (형판: `test_nudge_guard_tools.py` 103줄/7건, 특히 `:50-69` 무기록 증명과 `:98-103` 등록 회귀 가드). `cd backend && uv run pytest tests/mcp/test_plugin_tools.py -q` |
| **단위(앱·순수)** | 봉투 빌드·검증·stale 판정·`source` 분기 문구 | 신규 `app/lib/plugin-proposal.js` + `.test.js` (형판: `lib/guard-confirm.js` + `.test.js`). `node --test lib/plugin-proposal.test.js` |
| **계약(교차 언어)** | **봉투 스키마가 백엔드와 앱에서 같다** — 백엔드가 낸 실제 봉투를 앱 검증기가 통과시킨다 | 백엔드 테스트가 픽스처 JSON을 `backend/tests/fixtures/plugin-proposal/*.json`에 기록(선례 디렉터리 `backend/tests/fixtures/card-surface/`), `app/lib/plugin-proposal.test.js`가 **그 파일을 읽어** `validateProposal`에 넣는다. **픽스처는 봉투와 *툴 입력 예시*를 함께 기록한다**(C-8) — `{envelope, tool_input}` 두 키를 담아, 앱 쪽 `maybeForwardPluginProposal` 판정부 테스트가 같은 파일의 `tool_input`으로 `step.input.actions[]` 경로를 잰다. 한쪽만 바꾸면 반대편이 깨진다. **읽는 경로(O-C8):** 앱 테스트는 상대 경로를 쓰지 않고 `path.join(__dirname, '..', '..', 'backend', 'tests', 'fixtures', 'plugin-proposal')`로 잡는다 — §0-1의 "모든 상대 경로는 워크트리 루트 기준"과 달리 `node --test`의 cwd는 `app/`이므로(`§7`의 `( cd app && … )`), `__dirname` 기준이 두 셸에서 모두 성립하는 유일한 형태다 |
| **단위(앱·렌더)** | 승인 카드 렌더 · 제안 대기/거부됨/만료됨 3상태 · 직접 IPC 호출 부재 · GUI 버튼이 봉투를 만든다 · **모드 게이트 음성 단언(O-A2·O-C5)**: `currentMode()`가 `'plugin'`이 아닐 때 `athena:plugin-proposed`가 도착하면 카드가 **0건**이고 `athena:plugin-noted`도 보내지 않는다(pending에 안 들어간다 — RC-A2) · **부활 방지 1건(RC-1 ⑷)**: "모드 밖에서 폐기된 모델 제안은 이후 `athena:plugin-pending` 조회에 나타나지 않는다" — 모델 경로도 `athena:plugin-noted` 하나로만 등록되므로(RC-1) 모드 게이트가 두 경로를 똑같이 막는다. 이 단언과 W5-2 신설 ⑺가 "정직성 회귀" 커버리지의 두 짝이다 · **승인·거부 버튼 접근성 1건(O-A3·O-C6)**: 두 버튼이 키보드로 도달 가능하고 클릭 영역이 32px 이상 | `app/lib/plugin-canvas.test.js` 확장 (현재 23건, `node:test` + 수제 DOM 스텁 `:12-32`, `beforeEach` `:60-66`) |
| **단위(앱·렌더 — 결과 턴)** | **08번 보드의 채팅 결과 턴 4종**(W3-4 ⑶이 모듈 스코프 `_mountTurn`으로 보내는 것들): ⑴ 성공 3줄 ⑵ 거부 1줄 ⑶ 실패 + `다시 시도` 칩 ⑷ 재시작(기본 빌드 = `다음 실행부터 반영됩니다` — C-10). W3-4 검증 칸의 “렌더 단위 테스트”를 여기서 한 행으로 못박는다 | ⑴ **문구 4종**은 `app/lib/plugin-proposal.test.js` 확장으로 잰다 — W3-1이 이미 “카드 본문/근거 문구 조합”을 이 순수 모듈에 뒀다. ⑵ **배선 1건**은 `app/lib/plugin-proposal-boundary.test.js`(A3 ⑶의 소스 텍스트 형판)가 `fs.readFileSync(path.join(__dirname,'..','chat.js'),'utf8')`로 읽어 **`athena:plugin-result` 구독이 모듈 스코프에서 `_mountTurn`(`app/chat.js:2162-2171`)을 부르고 턴 스코프 가드(`myToken !== abortToken`) 안에 없다**를 단언한다 — `chat.js`도 `canvas.js`와 같은 최상위 스크립트라 `require` 불가(RC-7과 같은 이유). `node --test lib/plugin-proposal.test.js lib/plugin-proposal-boundary.test.js` |
| **단위(앱·메인)** | `tool_result`에서 제안 추출 · 비-propose 무시 · `proposal_id` 1회용 · 재기동 상태가 결과에 실림 · **pending 왕복 1건**(RC-A1 ⑸): `등록 → athena:plugin-pending 조회에 뜸 → 승인 → pending에서 사라짐` · **묶음 승인 1건 = `runMcpMutation` 호출 1회**(`actions` 길이 N에 대해 스파이 호출 횟수 `=== 1` — §6 R3의 재기동 합치기를 재는 유일한 테스트) | 신규 `app/lib/main/plugin-proposal-forward.test.js` (형판: `main.js:2172-2187`을 순수 함수로 뽑아 테스트 — `stream-json-parser.test.js`와 같은 자리) |
| **통합** | 게이트웨이 왕복: 제안 툴이 `list_tools`에 노출되고 dispatch가 감사 1줄을 남기며 소비자 파일이 안 변한다 | `backend/tests/mcp/test_server.py` 확장 (`make_gateway` 픽스처 `tests/mcp/conftest.py:34-57`) |
| **e2e(실왕복)** | 5동작 실제 등록→승인→probe→허용→철회→삭제 | `cd app && npm run verify:plugins` (현행 29 call-site → 실행 116 단언, 리포트 `app/captures/VERIFY-PLUGINS-REPORT.json`) — **주의: DOM 없는 메인 프로세스 하네스다**(§7 R4) |
| **e2e(렌더 계약)** | 플러그인 캔버스 신규 보드 픽셀·문구 계약 | `(cd app && npm run verify)` 의 플러그인 블록 **`app/verify.js:1942-2137`** 확장(블록 끝은 `pluginProbeFailure.emptyCopy` 단언) |
| **관측성** | 감사 로그가 제안 1건당 4필드 1줄만 남기고 인자 본문이 없다 | `backend/tests/mcp/test_consent.py:324-347` 형판을 `plugin` 별칭에 대해 1건 추가. 실측: `~/.athena/audit/plugin.jsonl` |

---

## 3. 수락 기준

### 3.1 명세 승계 (사용자 승인분 — 원문 그대로)

**① Paper 플러그인 페이지**
- [ ] `03 · 허브·설치`: "채팅은 유지되고 캔버스만 허브로 바뀝니다" 문구·구조를 제거하고, 사이드바 모드 5구역(35번)에서 열린 **플러그인 모드 창** 셸로 정정 — 채팅 헤더 "아테나 · 플러그인 대화", 캔버스 = 설치·권한·MCP.
- [ ] `05 · 설치 승인`: GUI 설치 버튼이 여는 모달에서 **채팅 제안 턴이 띄운 승인 카드**(플러그인 캔버스 안, 제공·용도·요청 기능·실행 명령·설치 위치·거부/승인)로 정정. GUI 설치 버튼 클릭도 같은 카드로 합류함을 보드에 명시.
- [ ] `01 · 기능 허용`: 도구 체크 목록은 **권한 초안**(42번 스냅샷 R4)이며 승인 카드로 확정됨을 표현. 채팅 "시세 조회만 허용" 제안 경로 병기.
- [ ] `04 · 관리`: 켜기/끄기·삭제가 제안→승인을 경유함을 표현(낙관적 토글 없음, 06 state-3 유지).
- [ ] `02 · 설정 직접 등록`: 유지. 채팅 스니펫 등록 제안이 같은 게이트로 들어온다는 각주.
- [ ] `06 · 상태 모음`: 기존 4상태(빈 허브·probe 실패·토글 실패·재시작) + **제안 대기 · 거부됨** 2상태 추가.
- [ ] 신규 `07 · 플러그인 대화 — 제안 턴 5동작`: 설치·허용/철회·켜기끄기·삭제·스니펫 각각의 제안 턴 + 승인 카드.
- [ ] 신규 `08 · 플러그인 대화 — 결과 턴`: 승인 후 결과(등록→probe→도구 N개)·거부·실패/재시도·재시작 반영.
- [ ] 신규 `09 · 플러그인 창 복원`: 권한 초안·미전송 입력·제안 대기 카드가 창 복원 시 그대로(40·41·42 계약).
- [ ] 게이트: 문구 3원칙 위반 0 · 하드코딩 hex 0(허용 알파 틴트 제외) · 상태 색 규칙 준수 · 겹침·잘림 0 · 클릭 영역 32px.
- [ ] 전 보드 PDF 발송 → 사용자 검수 승인.

**② 실앱**
- [ ] `app/lib/plugin-canvas.js`: 승인 카드 컴포넌트(제안 payload 렌더, 승인/거부), 제안 대기·거부됨 상태, 허브 설치·관리 토글/삭제·기능 허용 저장이 **제안 경유**로 바뀜(직접 IPC 호출 제거).
- [ ] `app/styles/plugin-canvas.css`: Paper 신규 보드와 픽셀 동일(토큰 사용).
- [ ] `app/chat.js` 플러그인 모드: 제안 툴 결과 → 제안 턴 렌더(어떤 동작·대상·요청 기능), 승인/거부/실패/재시작 결과 턴 렌더.
- [ ] `app/main.js`: 제안 수신 → 플러그인 캔버스 카드 발행 → 승인 시에만 `athena:mcp-*` 실행, 거부 시 레지스트리·consent 불변, 실행 후 `mcp_security_mutation` 재기동 상태를 결과 턴에 반영.
- [ ] `app/lib/settings-cards.js` 플러그인 카드: 변경 없음 또는 채팅 경로 각주만.
- [ ] `npm run verify:plugins` 재통과 + 신규 assertion: 5동작 제안→승인→실행 성공, 거부 시 불변, GUI 버튼 클릭이 제안 카드로 합류.
- [ ] `cd app && npm run test:unit` 전부 통과.
- [ ] `PAPER_APP_PARITY.md` 플러그인 섹션: 정정 6장 + 신규 보드 전수 `적용`.

**③ 백엔드**
- [ ] `backend/athena_mcp`에 플러그인 제안 built-in 툴 신설 — `action` enum 5종(install · allow_tools/revoke_tools · enable/disable · remove · stage_snippet), 대상 별칭·요청 기능·근거 필드, **실행 없음**.
- [ ] 테스트: enum 외 action 거부, 제안만으로 `registry.json`·`consent.json` 불변(**실경로 `~/.athena/mcp_servers.json`·`~/.athena/consent.json` — §2.1 원칙 3의 이름 확정. 테스트는 `ATHENA_MCP_REGISTRY_PATH`로 임시 디렉터리를 잡는다**), 감사 로그 기록(인자 본문 제외), Kiwoom·brain 별칭 제안 거부.
- [ ] `uv run pytest` 전수 통과.

> **③의 "실행 없음"을 계획은 이렇게 읽는다(원칙 1).** 명세 원문을 고치지 않되, 구현 불변량은 **"레지스트리·consent·배포를 변이시키지 않는다"**이다. 형제 툴 `athena_backtest`는 `run`·`optimize`로 실제 연산을 돌리면서도(`backtest_tools.py:36-52`) 배포는 못 한다. 플러그인 제안 툴은 그보다 엄격해 **읽기만 한다** — 연산도 없다. 테스트가 고정하는 것은 "두 파일 불변"이지 "코드 미실행"이 아니다.

### 3.2 파생 기준 (계획이 추가로 고정하는 검증 가능 항목)

| # | 기준 | 측정 방법 |
|---|---|---|
| A1 | 툴 이름은 `athena_plugin`(단일 밑줄) — 형제 5종과 같은 규약 | `test_plugin_tools.py` 가 `server._builtin_tool_defs()` 이름 집합에 `"athena_plugin"` 포함을 단언. 근거: `athena__` 이중 밑줄은 canvas 2종 전용이고 `registry.py:17 QUALIFIED_NAME_SEPARATOR="__"`와 형태 충돌 |
| A2 | `plugin_tools.dispatch`가 **소비자 두 파일에 대해** 쓰기를 0회 한다 | `~/.athena/mcp_servers.json`·`~/.athena/consent.json`(테스트는 `ATHENA_MCP_REGISTRY_PATH`로 임시 경로)의 `mtime`+바이트+`revision`을 제안 전후 비교. **"쓰기 0회"를 두 파일로 좁히는 이유(O-12)**: `reload()`는 읽기만 하지만 `exclusive_state_lock(lock_path)`가 `.mcp_servers.json.lock`을 만든다(`registry.py:259-261`) — 락 파일은 소비자 파일이 아니므로 단언 대상에서 뺀다 |
| A3 | 봉투 빌더가 모델 경로와 GUI 경로에서 **같은 함수**이고, GUI 진입점이 IPC를 직접 부르지 않는다 | ⑴ `plugin-proposal.test.js`가 두 입력에서 동일 스키마 산출을 단언. ⑵ **grep 게이트는 쓰지 않는다** — `plugin-canvas.js`에는 `window.athena` 호출이 애초에 0건이고 `athena:mcp-` 문자열 3건은 전부 정당한 주석이다(`:6`·`:235`·`:966`). ⑶ **`canvas.js`의 배선은 소스 텍스트 단언으로 잰다(RC-7).** `canvas.js`는 최상단에서 `window.AthenaLib.*`를 구조분해하고(작업 트리 `canvas.js:1-17`) 즉시 실행되는 최상위 스크립트라 node에서 `require`할 수 없고, `app/package.json:10`의 `test:unit` 글롭(`lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js`)에도 `canvas.js` 테스트가 없다 — `node --test lib/plugin-canvas.test.js`로는 `canvas.js`의 배선을 **원리적으로 잴 수 없다.** 신규 **`app/lib/plugin-proposal-boundary.test.js`**가 `fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8')`로 소스를 읽어 GUI 진입 6종(`onApproveInstall`·`onTogglePlugin`·`onRemovePlugin`·`onSavePermissions`·`onStageSnippet`·`onApproveServer`)의 본문에 `pluginInstallCatalogEntry`·`pluginSetEnabled`·`pluginRemove`·`pluginSaveTools`·`pluginStageSnippet`·`pluginApproveStaged` 호출이 **없고** 전부 `onPropose`로 간다를 단언한다. **형판은 `app/lib/raw-ui-boundary.test.js`**(첫 테스트 `production canvas never mounts raw detail diagnostics…`, `fs.readFileSync(path.join(__dirname,'..','canvas.js'))`는 작업 트리 `:9`. 파일이 카드 트랙 미커밋 대상이므로 워크트리에서는 심볼로 재탐색) — 같은 방식으로 `canvas.js` 소스를 읽어 경계를 잰다. 이 파일은 `lib/*.test.js` 글롭에 걸리므로 `test:unit`이 자동으로 집는다. ⑷ **`lib/plugin-canvas.test.js`의 몫은 별개다** — 스파이 `deps`에서 클릭이 `deps.onPropose`를 부르고 6종 콜백을 부르지 않는다(모듈 자체의 행동)만 잰다 |
| A4 | 낙관적 토글 제거 | `plugin-canvas.test.js`에 "토글 클릭은 즉시 상태를 바꾸지 않는다" 1건 (현행 `plugin-canvas.js:452-453` 반전) |
| A5 | 승인 카드는 캔버스에, 제안 턴은 채팅에 — 서로 다른 표면 | **(가)안으로 확정한다(C-9).** `verify.js`는 **분리 단언만** 잰다: 승인 카드 노드가 `#pluginCanvas` 하위에 있고(양성) **`#history` 하위에는 제안 턴 노드가 0건**(음성 — GUI 클릭 경로). **양성 제안-턴 렌더는 `verify.js`로 잴 수 없다** — W3-4 ⑴이 채택한 턴 스코프 형판은 `chat.js:1184-1188` 실측상 살아 있는 턴 함수 안에서만 `window.athena.on(...)`을 등록하고 클로저의 `myToken`·`text`에 의존하는데, `verify.js`는 LLM 턴을 돌릴 수 없어 주입 이벤트(`win.webContents.send(...)` 선례 `verify.js:833`)에 리스너가 없다. 따라서 양성 렌더는 **`chat.js`의 순수 렌더 함수를 뽑아 `node --test`로** 잰다(형판: 기존 렌더 단위 테스트). 구독 구조는 바꾸지 않는다 — 바꾸면 PM-3·H6과 충돌한다 |
| A6 | 제안 1건당 감사 1줄, 필드 4개 | `~/.athena/audit/plugin.jsonl` 파싱 단언 (`consent.py:361-369` 스키마) |
| A7 | `test:unit`: **브랜치 생성 시점 baseline 대비 신규 실패 0**, 총건수는 baseline 이상 | 절대 수치를 쓰지 않는다 — 병렬 카드 트랙이 테스트를 계속 늘린다(같은 날 백엔드 수집이 2722→**2746**으로 이동했다). §0-4의 **기존** baseline(`.omc/state/baseline-app-test-unit.txt` · `.omc/state/baseline.json` — 같은 커밋 f880d79에서 뜬 `# tests 1946 / # pass 1946 / # fail 0`)과 대조한다. 새로 뜨지 않는다 |
| A8 | `pytest`: **baseline 대비 신규 실패 0**, 총건수는 baseline 이상 | 동일. 대조 대상은 `.omc/state/baseline-backend-pytest-tail.txt`(`2638 passed, 5 skipped` — 실패 목록이 없다는 것이 실패 0의 증거. 한계는 §0-4b) |
| A9 | 봉투에 `source` 필드가 필수이고 두 값에서 카드 라벨이 다르다 | `plugin-proposal.test.js` — `source` 누락 시 `validateProposal` 거부, `"model"`/`"gui"`에서 라벨 문자열이 다름 |
| A10 | **타 모드 불간섭** — 모드 헤더 회귀 **3종** | **3종을 여기서 전부 적는다 — §1·W3-6·W5-2 ⑹·§7-3b가 “A10 3종”으로 참조하는 실체다.** ⑴ **그래프 모드 불변**: `#chatModeHead`가 보이고 제목 `'그래프에게 묻기'`·부제 `'답이 캔버스를 바꿉니다'`(`shell.html:297-298` 현행값)가 **한 글자도 바뀌지 않는다** — 측정은 `app/verify-graph-mode.js`(§7-3b: `:222` chatHeadVisible). ⑵ **플러그인 모드 신규 2문자열**: 같은 요소에 제목 `'아테나 · 플러그인 대화'`·부제 `'설치와 권한을 여기서 정합니다'`가 뜬다 — 측정은 `app/verify.js` 플러그인 블록(`:1942-2137`)을 확장한 W5-2 신설 ⑹. ⑶ **그 밖의 모드는 헤더가 없다**: 대화 모드(그리고 에이전트·백테스트)에서 `#chatModeHead.hidden === true` — 측정은 같은 W5-2 신설 ⑹이고, `verify-graph-mode.js`의 대화 모드 복귀 단언(§7-3b: `:599`·`:602` chatHeadHidden)이 그래프→대화 전환 쪽을 같은 내용으로 거든다 |

---

## 0. 실행 규율 — ralph 착수 전 필수

합의 직후 **`ralph`**가 이 계획을 실행한다(사용자 선택). ralph는 도중에 질문할 수 없으므로 아래 규율과 §8의 결정이 유일한 지침이다.

**브랜치.** 코드는 `main`(`f880d79`)에서 딴 **새 브랜치 `feat/plugin-mode-doctrine`** 위에만 올린다. `main` 직접 커밋 금지.

**금지 명령 (예외 없음).** `git stash` · `git reset` · `git checkout -- <file>` · `git restore <file>` · `git clean`. 작업 트리에는 병렬 카드 트랙의 미커밋 변경 1,784줄이 살아 있고, 위 명령은 그것을 **되돌릴 수 없게** 지운다. 스테이징은 비중첩 파일에 대한 명시적 `git add <path>`만 쓴다 — `git add -A` · `git add .` · `git commit -a` 금지.

### 변형 (P) 별도 워크트리 — **주 경로 (사용자 확정 2026-09-03)**

워크트리 절대 경로: **`C:\Projects\DAOU.Athena-plugin`** (본 저장소 `C:\Projects\DAOU.Athena`의 형제 디렉터리).

**§0-0. 이 절은 전부 멱등이다 — 워크트리는 이미 있다(실측 2026-09-03).** `git worktree list`가 `C:/Projects/DAOU.Athena-plugin  f880d79 [feat/plugin-mode-doctrine]`를 보고하고, 브랜치 `feat/plugin-mode-doctrine`·`app/node_modules/electron/dist`·`backend/.venv`·`core.hooksPath=scripts/hooks`·`.omc/specs/deep-interview-athena-plugin-doctrine.md`가 **모두 이미 존재한다.** 비어 있는 것은 **`.omc/plans/` 하나뿐이다.** 따라서 아래 모든 명령을 "없을 때만" 조건으로 감싼다 — 무조건 실행하면 첫 명령이 `fatal: '../DAOU.Athena-plugin' already exists`로 죽고 **ralph는 도중에 질문할 수 없다.**

**§0-0b. 셸(O-14).** 아래 블록은 **Bash 도구**에서 돈다(POSIX `sh`). 이 환경의 기본 셸은 PowerShell이므로 PowerShell 창에 그대로 붙여넣지 않는다 — `mkdir -p`·`cp`·`export`·`[ -d ]`는 PowerShell에서 파서 오류다. PowerShell로 돌려야 하면 `New-Item -ItemType Directory -Force` / `Copy-Item` / `$env:PATH=` / `Test-Path`로 옮긴다.

```bash
# (1) 워크트리 — 목록에 없을 때만 만든다
git worktree list | grep -q 'DAOU.Athena-plugin' \
  || git worktree add ../DAOU.Athena-plugin -b feat/plugin-mode-doctrine main

# (2) 이후 모든 명령의 기준은 워크트리 루트다
cd C:/Projects/DAOU.Athena-plugin

# (3) 설치 3종 — 산출물이 없을 때만
[ -d app/node_modules/electron/dist ] \
  || ( cd app && npm install && node node_modules/electron/install.js )   # docs/handoff/README.md:47
[ -d backend/.venv ] || ( cd backend && uv sync --extra dev )             # docs/handoff/README.md:55
[ "$(git config core.hooksPath)" = "scripts/hooks" ] \
  || git config core.hooksPath scripts/hooks                              # docs/handoff/README.md:59
```

`node node_modules/electron/install.js`는 형식적 단계가 **아니다** — 이 저장소에서 `npm install`이 electron 바이너리를 조용히 빠뜨리는 일이 반복 재현됐다(`docs/handoff/README.md:50-53`). 다만 위 조건문 덕에 이미 설치된 워크트리에서는 건너뛴다.

**§0-1. 세션 cwd와 경로 규약.** ralph 착수 전에 cwd를 워크트리 루트로 옮긴다. **이 계획의 모든 상대 경로(`app/…`, `backend/…`, `.omc/…`)는 워크트리 루트 기준으로 읽는다.** 본 저장소를 가리켜야 하는 곳은 절대 경로로만 쓴다.

**§0-2. 계획 파일 복사 (첫 작업 · 유일하게 무조건 실행한다).** 워크트리의 `.omc/`는 본 저장소와 **별개**이며 워크트리를 지우면 함께 사라진다(전역 CLAUDE.md `worktree_paths`). 명세는 이미 복사돼 있으나(§0-0) **계획은 개정될 때마다 다시 덮어써야** 하므로 조건을 걸지 않는다:

```bash
mkdir -p C:/Projects/DAOU.Athena-plugin/.omc/specs C:/Projects/DAOU.Athena-plugin/.omc/plans
cp C:/Projects/DAOU.Athena/.omc/specs/deep-interview-athena-plugin-doctrine.md \
   C:/Projects/DAOU.Athena-plugin/.omc/specs/
cp C:/Projects/DAOU.Athena/.omc/plans/athena-plugin-doctrine-consensus.md \
   C:/Projects/DAOU.Athena-plugin/.omc/plans/
```

**정본은 본 저장소의 계획 파일이다.** 워크트리 사본을 고치지 않는다 — 계획이 개정되면 다시 복사한다.

**§0-3. node PATH 함정 (실측).** 이 머신에서는 셸에 따라 `node`·`npm`이 PATH에 없다(`npm: command not found` / `'npm'은 cmdlet이 아닙니다` 둘 다 재현). fnm multishell 설치본을 앞에 붙인다:

```bash
export PATH="/c/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"
```

(Windows 경로: `C:\Users\USER\AppData\Roaming\fnm\node-versions\v22.14.0\installation`.) `npm run test:unit`이 실행되지 않으면 스크립트 본문을 직접 부른다 — `node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js` (`app/package.json:10`과 동일). **backend 전수 실행 시에도 node가 PATH에 있어야 한다** — 없으면 `test_selector_autonomous_eval.py` 등이 실패한다(`.omc/state/baseline.json`의 `note` 실측).

**§0-4. baseline은 이미 있다 — 재수집하지 않고 재사용한다 (A7/A8의 근거).** 워크트리 `.omc/state/`에 같은 커밋(`f880d79`)에서 뜬 baseline 3종이 이미 있다(실측):

| 파일 | 내용 |
|---|---|
| `.omc/state/baseline.json` | `app_test_unit`: tests 1946 / pass 1946 / fail 0 · `backend_pytest`: 2638 passed / 5 skipped / failed 0 · `duration_s` **1419** · `base_commit` f880d79 |
| `.omc/state/baseline-app-test-unit.txt` | `node --test` 전체 출력(428KB) — `# tests 1946` · `# pass 1946` · `# fail 0` 포함 |
| `.omc/state/baseline-backend-pytest-tail.txt` | `uv run pytest -q`의 **tail만**(1.2KB). 마지막 줄 `2638 passed, 5 skipped, 1 warning in 1419.00s (0:23:39)` |

**재수집 금지.** backend 전수는 **23분 39초**가 걸리고, 같은 커밋의 baseline이 이미 있으므로 다시 도는 것은 순손실이다. 코드를 고치기 전에 baseline을 새로 뜨지 않는다. **§7의 판정 명령은 위 두 파일명을 그대로 가리킨다** — `.omc/state/plugin-branch-baseline/` 디렉터리는 만들지 않는다(변형 (F)의 소스 스냅샷 용도로만 남는다).

**§0-4b. backend baseline의 한계(정직하게 적는다).** `baseline-backend-pytest-tail.txt`는 **tail만** 보관돼 있어 `^(FAILED|ERROR)` 목록이 통째로 없다. 현재 실패가 0건이므로 §7-4의 `diff`는 "baseline 쪽 빈 목록 vs 현재 목록"이 되어 **신규 실패를 정확히 드러낸다** — 다만 근거가 전수 출력이 아니라 요약 줄임을 알고 쓴다. baseline의 `2638 passed, 5 skipped, 0 failed`가 그 빈 목록의 유일한 증거다.

**§0-4c. baseline 수치가 명세와 다르다(O-13).** baseline 실측은 app **1946** · backend **2638 passed / 5 skipped**인데, 명세 §②는 `(기준 2,015)`, §③은 `(기준 2,714 passed / 5 skipped)`라 적는다. 두 수치는 §3.1의 인용에서 **의도적으로 뺐고** A7/A8의 "baseline 대비 신규 실패 0"으로 대체했다 — 병렬 카드 트랙이 테스트 수를 계속 움직이기 때문이다. 이 각주가 그 대체를 명시하는 자리다(원문을 조용히 지운 것이 아니다).


**§0-5. 행 번호는 본 저장소 작업 트리 기준이다(실측 2026-09-03) — 워크트리에서는 어긋난다.** 이 계획의 모든 `파일:행` 인용은 `C:\Projects\DAOU.Athena`의 **미커밋 작업 트리**를 열어 확인한 값이다. 워크트리는 `main` f880d79의 깨끗한 체크아웃이므로 미커밋 4파일에서 다음만큼 밀린다: `app/canvas.js` **−311**(`createPluginCanvas`가 작업 트리 `:2519` → main `:2208`) · `app/main.js` **−21**(`:2012` 이후 전부) · `app/shell.html` **−2**(`:15` 이후) · `app/preload.js` **−2**(`:65` 이후). `app/verify.js`·`app/lib/plugin-canvas.js`·`backend/**`는 차이 0이다. **ralph는 워크트리에서 심볼 이름으로 재탐색해 앵커를 잡는다**(예: `grep -n "createPluginCanvas" app/canvas.js`) — 행 번호를 그대로 믿고 편집하지 않는다.

두 파일의 요약 줄(`# pass` / `# fail`, `N passed`)이 완료 판정의 기준선이다. **절대 수치를 계획에 박지 않는다** — 같은 날 백엔드 수집이 2722→2746으로 움직였다. 판정은 "baseline 대비 신규 실패 0".

**(P)의 이점.** 워크트리는 `main` f880d79의 깨끗한 체크아웃이므로 본 저장소의 미커밋 1,784줄이 **따라오지 않는다.** 중첩 파일 문제가 구조적으로 사라지고, 커밋은 평범한 `git add <path>`로 끝난다. 병렬 카드 트랙 세션과 물리적으로 격리된다.

### 변형 (F) 같은 워크트리 — 폴백 (사용하지 않음)

(P)가 불가능할 때만(디스크·재설치 제약) `git switch -c feat/plugin-mode-doctrine`으로 미커밋 변경을 들고 간다. 그 경우 중첩 6파일 — `PAPER_APP_PARITY.md`(+65) · `app/canvas.js`(+315) · `app/main.js`(+21) · `app/preload.js`(+2) · `app/shell.html`(+11) · `backend/athena_mcp/canvas_data.py`(+5), `git diff --stat` 실측 2026-09-03 — 을 브랜치 생성 직후 `.omc/state/plugin-branch-baseline/<path>`로 스냅샷하고, 커밋 시 `diff -u --label "a/<path>" --label "b/<path>" baseline/<path> <path>`로 플러그인 전용 패치를 만들어 `git apply --cached --recount`로 **인덱스에만** 적용한다(인덱스=HEAD 기준). 중첩 파일에 `git add <path>`를 절대 쓰지 않는다 — 카드 트랙 헝크가 함께 커밋된다. apply가 실패하면 그 파일을 미커밋인 채 두고 헝크 목록을 `.omc/state/plugin-branch-commit-delegation.md`에 적어 사용자에게 넘긴다. 강제하지 않는다.

**커밋 메시지.** 저장소 관례(한국어 · `type(scope): 평서형 한 문장`)를 따르고 트레일러를 붙인다:
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

## 4. 구현 단계

병렬 가능: **W1 ∥ W4**(백엔드와 Paper는 서로 무관), **W0 ∥ W4**. W2는 W0+W1 완료 후, W3은 W2 후, W5는 W3+W4 후.

**순서 규칙(O1).** W4(Paper)는 W3-5(CSS)보다 **먼저** 끝낸다. CSS는 Paper 보드의 픽셀·문구를 베끼는 작업이므로, 보드가 확정되지 않은 채 CSS를 쓰면 두 번 쓴다. W3-1~W3-4·W3-6(로직·문구)은 W4와 병렬해도 무방하다.

### W0 — 인터페이스 계약 + 어댑터 (선행, 반나절)

**어댑터는 1훅으로 줄인다(O-A1·O-C10 → 반복 6에서 H4마저 뺀다).** §5의 H1·H3·H5·H7은 이 계획의 수락 기준이 요구하지 않는다(H1·H3·H7은 인프라 트랙 소유, H5 미전송 입력은 ①-09 보드가 *그린다*는 요구일 뿐 앱 구현이 ②에 없다). 어댑터가 실제로 구현하는 훅은 **H2(모드 인지) 하나뿐이다.** **H6(제안 보관)과 H4(권한 초안 보존)는 어댑터 인터페이스에 두지 않는다** — H6은 RC-A1로 pending 소유가 온전히 메인(`plugin-proposal-registry.js`)으로 확정됐고, **H4의 실제 구현은 W0-3의 `app/lib/plugin-canvas.js`(`getState`/`setData` 확장)에 있어 어댑터는 '선언'만 지게 된다.** 선언만 있고 구현이 없는 훅은 CLAUDE.md §2(단일 사용처 추상화 금지)에 걸리는 사변적 표면이라는 O-A1의 논거가 H4에도 그대로 적용된다. H4·H6은 §5 표에 **계약으로만** 남는다(인프라 트랙이 실물을 내놓을 때 무엇을 대체하는지가 그 표의 역할이다).

> **인프라 트랙 없이 오늘 셸에서 전 수락 기준을 만족한다.** 근거: 플러그인 뷰 상수가 이미 있고(`lib/graph-mode/graph-mode-store.js:18 VIEW_PLUGIN`), `applyVisibility()`가 표면을 실제로 전환하며(`lib/graph-mode/controller.js:271-303`), 사이드바가 진입점을 갖는다(`lib/sidebar.js:58-62 setView('hub')`). 모드 귀속 *창*이 없어도 모드 귀속 *표면*은 오늘 동작한다.

| 단계 | 파일 | 변경 | 검증 |
|---|---|---|---|
| W0-1 | 신규 `app/lib/plugin-mode-adapter.js` (+`.test.js`) · **`app/shell.html` 스크립트 블록** | **훅 1종(H2)**만 인터페이스로 선언하고 **오늘의 코드로 구현한 폴백**을 제공. H4·H6은 선언하지 않는다(H4=`plugin-canvas.js` 소유 · H6=메인 소유 — O-A1). **로드 등록(RC-6 ⑴⑵):** 이 모듈은 저장소 관례대로 `shell.html`의 명시 `<script src>`로 로드한다 — 작업 트리 기준 스크립트 블록은 `shell.html:394-486`(워크트리 −2)이고, `<script src="lib/plugin-mode-adapter.js"></script>`를 **`lib/plugin-catalog.js`(`:471`)·`lib/plugin-canvas.js`(`:472`) 인접 자리**, 반드시 **`canvas.js`(`:485`)·`chat.js`(`:486`)보다 앞**에 넣는다. 노출 이름은 **`window.AthenaLib.PluginModeAdapter`**이고, 이중 내보내기 형판은 `app/lib/guard-confirm.js` 말미(`const __exports = {...}` → `module.exports` 아니면 `window.AthenaLib.GuardConfirm`)와 `app/lib/plugin-catalog.js` 말미를 그대로 따른다 | **`app/lib/plugin-mode-adapter.test.js`**: ⑴ H2가 폴백으로 계약을 만족 ⑵ **로드 등록 봉인(RC-6)** — 같은 파일이 `fs.readFileSync(path.join(__dirname,'..','shell.html'), 'utf8')`로 `app/shell.html`을 읽어 ㉮ `<script src="lib/plugin-mode-adapter.js">`와 `<script src="lib/plugin-proposal.js">`가 **둘 다 존재**하고 ㉯ 두 태그의 `indexOf`가 `<script src="canvas.js">`·`<script src="chat.js">`의 `indexOf`보다 **작다**를 단언한다(형판 `app/lib/raw-ui-boundary.test.js`) |
| W0-2 | `app/chat.js` (신규 이벤트 없음) | **`athena:canvas-mode-changed` 신설을 철회한다.** 모드는 **동기 읽기**로 얻는다 — `applyVisibility()`가 이미 `canvasRegion.dataset.mode`에 모드 라벨을 쓴다(`lib/graph-mode/controller.js:299`; 값은 `:295` `modeLabel`로 `plugin`·`graph`·`chat`·`agent`·`backtest`). 어댑터의 `currentMode()`는 `document.getElementById('canvasRegion').dataset.mode` 한 줄이다. **폴백 값(O-6):** `applyVisibility()` 최초 실행 전에는 이 값이 `undefined`다 — **`undefined`는 플러그인 모드가 아니다**(제안을 폐기하고 채팅에 한 줄 결과 턴만 낸다). 새 이벤트·새 계약이 0개다 | `plugin-mode-adapter.test.js`: dataset 값별로 `currentMode()` 반환 확인 |
| W0-3 | `app/lib/plugin-canvas.js:952-957`, `:1000-1010`, `:983-995` | `setView()`가 `activeSheet`를 무조건 버리는 문제(사이드바가 진입마다 `setView('hub')` — `lib/sidebar.js:58-62`) 해결: 권한 초안을 `getState()`에 **토글 상태까지** 포함하도록 확장하고 `setData()`의 시트 재조립 경로에 복원 훅 + PM-4 발산 비교를 붙인다 | `plugin-canvas.test.js`: 모드 이탈·재진입 후 초안 토글 보존 + 발산 표시 |

**신규 렌더러 모듈의 로드 등록은 선택이 아니다(RC-6 — W0-1·W3-1 공통).** 이 저장소의 렌더러 모듈은 예외 없이 `shell.html`의 명시 `<script src>`로 로드된다(`lib/plugin-catalog.js:471` · `lib/plugin-canvas.js:472` · `lib/guard-confirm.js:455` 등 90여 줄). `node --test`는 파일을 직접 `require`하므로 태그를 빠뜨려도 **단위 테스트는 전부 통과하고**, 결함은 `npm run verify`나 실앱 기동에서야 드러난다. 더 나쁜 것은 **순서**다 — `app/canvas.js:1-17`이 모듈 최상단에서 `window.AthenaLib.*`를 구조분해하므로, 태그가 없거나 `canvas.js`(`:485`) 뒤에 있으면 플러그인 모드가 아니라 **렌더러 전체가 첫 페인트에서 죽는다.** 두 모듈의 노출 이름은 `window.AthenaLib.PluginModeAdapter`·`window.AthenaLib.PluginProposal`로 **여기서 확정한다** — ralph가 규약을 스스로 고르면 `canvas.js`·`chat.js`의 참조와 어긋난다.

**모드 밖에서 제안이 도착하면(H2 결정).** `athena_plugin`은 상주 세션 전역에 노출되므로(`GATEWAY_ALLOWED_TOOLS`는 서버 단위 허용, `claude-tool-policy.js:15`) 사용자가 대화 모드에 있을 때도 모델이 부를 수 있다. **게이트웨이는 모드를 알 수 없다** — `list_tools`(`server.py:770-783`)에는 세션의 UI 모드가 전달되지 않고, 그런 채널이 존재하지 않는다. 따라서 게이트웨이 단 필터링은 불가능하고, **판단은 렌더러가 한다.**

**메인은 모드를 보지 않는다.** `main.js`의 `maybeForwardPluginProposal`은 모드를 조회하지 않고 **항상** `shellWin`으로 push한다 — 선례 `maybeForwardNudgeGuardProposal`(`main.js:2172-2187`)도 모드를 보지 않고 무조건 push한다. 메인 프로세스에는 DOM이 없어 `canvasRegion.dataset.mode`를 읽을 수 없고, 모드 조회 채널을 새로 발명하는 것은 §10 C5가 이미 철회한 발명이다. 폐기 판단은 **렌더러가** 내린다.

**결정: 보관하지 않고 폐기하되, 침묵하지 않는다. 폐기 주체는 `canvas.js`다(RC-A2·RC-2).** 카드를 실제로 만드는 것은 `canvas.js`의 **모듈 스코프 구독**이므로(W3-4 ⑴), 게이트도 거기 있어야 한다: `canvas.js`의 핸들러가 `pluginCanvas.setProposals(...)`를 부르기 **전에** 어댑터의 `currentMode()`를 확인해 `'plugin'`이 아니면 봉투를 **버리고**(pending에도 넣지 않는다 — `athena:plugin-noted`를 보내지 않는다) 아무것도 그리지 않는다. `chat.js`의 몫은 **한 줄 결과 턴 하나뿐**이다 — 같은 조건에서 `플러그인 모드에서 다시 요청합니다`를 낸다(같은 봉투 서명은 한 턴 1회 — PM-5). **문구가 "승인할 수 있습니다"가 아닌 이유(RC-A3·RC-4):** 결정은 폐기이므로 나중에 모드로 들어가도 그 카드는 없다 — "승인할 수 있습니다"는 §2.1 원칙 4(화면은 정직하다)를 정면으로 어긴다. 이 문자열은 사용자에게 보이는 신규 제품 문구이므로 W4 08번 보드에 한 칸으로 그리고 W5-4 검수 안건 ⑸로 승인을 받는다. 근거: ⑴ 보류 후 나중에 띄우면 사용자가 맥락을 잊은 카드를 만나고 PM-3의 stale 위험이 커진다 ⑵ 타 모드 불간섭 제약상 대화·그래프 모드 캔버스에 플러그인 카드를 띄울 수 없다 ⑶ 제안은 비영속이 원칙(원칙 3)이다. 가장 단순하고 세 제약을 모두 지킨다.

**W0 완료 정의:** H2 1훅이 폴백으로 동작하고 `shell.html`에 `canvas.js`보다 앞선 자리로 등록돼 있으며, W0-3이 H4 계약(권한 초안 보존)을 `plugin-canvas.js` 안에서 만족하고, 인프라 트랙이 실제 `mode='plugin'` 창을 내놓으면 어댑터 내부만 교체하면 되는 상태.

### W1 — 게이트웨이 제안 툴 (W0과 병렬)

| 단계 | 파일 | 변경 | 검증 |
|---|---|---|---|
| W1-1 | 신규 `backend/athena_mcp/plugin_tools.py` (~180줄) | `PLUGIN_TOOL = "athena_plugin"`, `_ALLOWED_ACTIONS`(§8 확정 2의 6종), `_INPUT_SCHEMA`, `_DESCRIPTION`, `builtin_tool_defs()`, `dispatch()`. 형판 `nudge_guard_tools.py:37-149`. 상세는 아래 **W1-1 규격** | `test_plugin_tools.py` |
| W1-2 | `backend/athena_mcp/server.py:414` 뒤(backtest 분기 다음 — 형제 등록 순서 유지) | dispatch 분기 7줄 추가(형판 `:401-407` nudge_guard / `:408-414` backtest) + 감사 `self._audit_log("plugin").record("plugin", plugin_tools.PLUGIN_TOOL, success=not result.isError)` | `test_server.py` 확장 |
| W1-3 | `backend/athena_mcp/server.py:761` 뒤(`*backtest_tools.builtin_tool_defs(),` 다음) | `*plugin_tools.builtin_tool_defs(),` 1줄 + `:35-41` import 1줄 | `test_plugin_tools.py::test_the_tool_is_registered_in_the_builtin_set` |
| W1-4 | 신규 `backend/tests/mcp/test_plugin_tools.py` (~140줄) | §2.5 단위(백엔드) 5항목 + PM-1 파라미터화 | `uv run pytest tests/mcp/test_plugin_tools.py -q` |

**W1-1 규격 (ralph가 그대로 구현한다).**

- **dispatch 시그니처는 형제들과 다르다.** `nudge_guard_tools.dispatch(arguments, http_client)`는 HTTP 프록시라 클라이언트를 받지만, 플러그인 제안은 로컬 상태만 읽는다 → **`dispatch(arguments, registry, consent_store)`**. `server.py`가 `self.registry`(`:232`)·`self.consent_store`(`:233`)를 그대로 넘긴다. HTTP 클라이언트를 받지 않는다.
- **`_INPUT_SCHEMA` — 툴 *입력* 스키마를 봉투 스키마와 별도로 못박는다(C-8).** 확정 3은 *봉투*가 `actions` 배열을 갖는다고 정하는데, W2-1은 *툴 호출 입력*을 `step.input.actions[].action`으로 판정한다. **둘을 같게 한다:** 툴 입력도 `{actions: [{action, target, features?, enabled?, snippet?}], reason}`이고 `required`는 `["actions"]`, `actions`의 `minItems`는 **1**이다. **경고 — 형제 형판을 그대로 베끼면 어긋난다:** `nudge_guard_tools`의 스키마는 `action`이 **단수**다(`:39 _ALLOWED_ACTIONS = ("propose","get")`). 단수로 쓰면 W2-1의 `step.input.actions[]`가 항상 `undefined`가 되어 **제안이 한 건도 렌더러에 도달하지 않는다 — 게다가 조용히 실패한다**(에러도 로그도 없다). `maybeForwardPluginProposal`의 유일한 판정 기준이 `step.input`이기 때문이다(선례 `maybeForwardNudgeGuardProposal`의 `main.js:2176` `step.input.action !== 'propose'`와 같은 자리 — 이름 검사는 `:2174-2175`). ralph는 도중에 질문할 수 없으므로 이 줄이 유일한 방어다.
- **`stage_snippet`의 입력·봉투 모양(C-7 연동).** 입력은 `{action:'stage_snippet', snippet:'<JSON 문자열>'}`이고 `target`을 **보내지 않는다**. 백엔드가 스니펫을 파싱해 별칭을 뽑아 차단 검사만 하고, 봉투의 `target`은 **`null`**로 둔다(카드 제목은 `직접 등록`). 파싱 불가·별칭 0개·2개 이상은 거부한다.
- **`current` 조립.** `ConsentStore`는 `get(alias)`(`consent.py:340`) 외에 `snapshot()`(`:225`)·`is_server_approved(alias)`(`:307`)·`is_tool_allowed(alias, tool)`(`:311`)를 공개한다. `current`는 **`registry.reload()` 1회**(`registry.py:258-262` — `reload()`가 `_load()` 후 이미 `snapshot()`을 돌려주므로 `snapshot()`을 따로 부르지 않는다. 락을 두 번 잡지 않는 이점도 있다) + `consent_store.snapshot()`(`consent.py:225`)로 만든다. 별칭별 루프에서 `get()`을 반복 호출하지 않는다(두 스냅샷이 일관된 시점을 준다).
- **`revision` 스탬프.** 같은 `reload()` 반환값의 `revision`(공개 접근자는 `registry.py:250-252`)을 봉투에 싣는다. reload 없이 찍으면 게이트웨이 캐시의 낡은 값이다(PM-3).
- **락 경합 한 줄.** `reload()`는 `exclusive_state_lock`을 잡는다(`registry.py:259-261`). 쓰기가 아니라 원칙 3(제안 불변)은 지켜지지만, 동시에 도는 `runMcpMutation`의 CLI 쓰기와 경합해 제안 툴이 잠깐 블록될 수 있다. 형제 툴의 타임아웃 값은 15초다(`nudge_guard_tools.py:41 _TIMEOUT_SECONDS = 15.0`) — 락 대기는 그보다 훨씬 짧으므로 별도 타임아웃을 두지 않는다.
- **`source: "model"`을 서버가 강제한다.** 이 툴이 만든 봉투는 언제나 `source="model"`이다. 모델이 인자로 `source`를 보내도 무시한다 — 그러지 않으면 모델이 자기 제안을 `"gui"`로 위장할 수 있다.
- **`stage_snippet` 액션 이름은 형제 IPC와 겹치지만 유지한다.** 액션 enum 이름공간과 IPC 채널 이름공간은 다르며, 사용자 명세가 이 동작을 그 이름으로 부른다. 대신 모듈 독스트링과 액션 설명에 못박는다: **"제안 툴은 `athena:mcp-stage-snippet`을 절대 호출하지 않는다 — 그 IPC는 승인 클릭 시 `main.js`만 부른다."** 이름이 같다고 경로가 같지 않다.
- **built-in은 consent 게이트를 우회한다.** `server.py:344-414`가 `:421-424` 앞에서 반환하므로 이 툴은 항상 노출·호출된다. 제안 툴은 아무 상태도 안 바꾸므로 안전하나, 향후 누가 변이 액션을 추가하면 게이트 없이 통과한다 → 독스트링 경고 + `_ALLOWED_ACTIONS` 길이를 테스트가 고정한다.
- **묶음 승인의 감사 정보를 잃지 않는다(O-7).** `plugin-batch` 한 줄로만 감사하면 `consent.py:361-369`의 4필드(`ts`·`alias`·`tool`·`success`)에서 "무엇을 승인했는가"가 사라진다. 스키마를 바꾸지 않고 되살린다 — 승인 실행 쪽에서 **액션마다 1줄** `_audit_log("plugin").record(alias, f"plugin:{action}", success)`를 남긴다. A6의 "제안 1건당 감사 1줄"은 **제안 툴** 쪽이고 이건 **승인 실행** 쪽이라 충돌하지 않는다.

### W2 — main.js: 제안 수신 · 승인 실행 · 재기동 상태

| 단계 | 파일 | 변경 | 검증 |
|---|---|---|---|
| W2-1 | `app/main.js:2163-2187` 옆 | `PLUGIN_TOOL_NAME = 'athena_plugin'` + `maybeForwardPluginProposal(step, resultBlock)` — `step.input.actions[].action`이 enum 6종 안이면(**이 경로가 성립하려면 `_INPUT_SCHEMA`가 `actions` 배열이어야 한다 — W1-1의 C-8 경고**) `tool_result` 텍스트를 파싱해 `shellWin`으로 push. **push 직전에 pending 등록을 하지 않는다(RC-1 ⑴ — 반복 5의 "모델 경로의 유일한 등록 시점" 문장을 삭제했다).** 모델 경로도 렌더러의 모드 게이트를 통과한 뒤 `canvas.js`가 카드를 그리고 나서 보내는 **`athena:plugin-noted`로만** 등록된다 — GUI 경로와 **같은 한 지점**이다. 근거: 여기서 등록하면 W3-4 ⑴의 "모드 밖 폐기"가 GUI 경로만 막아, 폐기했다고 알린 제안이 W3-4 ⑷ 복원으로 부활한다(§2.1 원칙 4 위반). 확정 10이 승인 인자를 봉투 전체로 정했으므로 pending은 **복원 전용**이고, 등록을 늦춰도 승인 정확성 손실이 0이다. `main.js:2251`의 tracker 훅에 1줄 추가. 순수 판정부는 `lib/main/`으로 분리해 테스트 가능하게 | `plugin-proposal-forward.test.js` |
| W2-2 | `app/preload.js` — ON은 `:249`(`athena:nudge-guard-proposed` 형제 선례) 옆, INVOKE는 `:36`(`athena:mcp-remove`) 옆, **SEND는 `:130`의 `SEND_CHANNELS` 집합 안**(세 집합이 별개 화이트리스트다 — 브릿지 검사는 INVOKE `:273` · SEND `:279` · ON `:288`) | ON 채널 `athena:plugin-proposed` 1줄 · **SEND 채널 `athena:plugin-noted` 1줄**(렌더러→메인 **단방향** `ipcRenderer.send`, 응답을 기다리지 않는다 — **두 경로 공통의 pending 등록 지점이다**, RC-1 ⑶) · INVOKE 채널 **3줄** — `athena:plugin-approve` · `athena:plugin-reject` · **`athena:plugin-pending`**(미해결 제안 목록 + 현재 `revision` 조회). 세 번째가 없으면 H6(창 복원)과 모드 재진입 복원이 불가능하다 — 옵션 D가 봉투를 메인에 둔 이상 렌더러에는 "지금 대기 중인 제안"을 물을 수단이 없다 | 채널 화이트리스트 테스트 |
| **W2-2b** | `app/lib/main/mcp-runtime-coordinator.js:3-11` | `MUTATION_KINDS`에 **`'plugin-batch'` 1줄 추가**. 현행 집합은 `register`·`approve`·`revoke`·`allow`·`disallow`·`remove`·`secret-update` 7종뿐이고 `:237`이 그 밖의 kind를 `Promise.reject(TypeError)`로 **즉시 거부**한다 — 묶음용 kind가 없으면 승인이 첫 호출에서 죽는다 | `mcp-runtime-coordinator` 단위 테스트: `mutate({kind:'plugin-batch', apply})`가 reject되지 않는다 |
| W2-3 | 신규 `app/lib/main/plugin-proposal-registry.js` (+`.test.js`) | **Electron·`main.js` 비의존 순수 모듈이다.** 소유하는 것은 ⑴ `proposal_id` 1회용 소비 맵(PM-2) ⑵ `actions` 배열의 실행 순서 계산 ⑶ **pending 맵 — `proposal_id → {봉투, 도착 시각}`**(RC-A1 ⑴. `register(envelope)`로 넣고, approve·reject가 제거하며, `pending()`이 `[미해결 봉투 배열, 현재 revision]`을 돌려준다. 이 맵이 없으면 `athena:plugin-pending` 채널과 W3-4 ⑷ 복원이 **영원히 빈 배열만 도는 죽은 경로**가 된다) ⑷ **별칭 게이트 4종**(RC-3 — `_BLOCKED_ALIASES` 거부 · `install`→주입받은 `CATALOG` 멤버십 · `allow_tools`/`revoke_tools`/`set_enabled`/`remove`→executor `list()` 멤버십 · `stage_snippet`→§2.4 PM-1의 스니펫 파싱 규칙)이며, **실제 실행은 주입받은 executor로 부른다** — **8종: `{ register, approve, allowTool, revoke, remove, stageSnippet, probe, list }`**(R-2). `probe`가 없으면 08번 성공 3줄(`등록했습니다 → 연결을 확인했습니다 → 기능 6개를 찾았습니다`)과 ①-06의 배지 `기능 6`을 만들 수 없다 — 오늘도 `canvas.js:2683`이 승인 뒤 서버마다 `pluginProbe(alias)`를 돈다. `list`가 없으면 PM-2 완화 ⑶(승인 직전 상태 재확인)과 PM-3의 `revision` 대조를 하네스가 잴 수 없다. **호출 형태(실측):** `probe`는 `mcpCli.probe(alias, mcpEnv.buildEnvOverrides(alias))` **2인자**다(`main.js:4186-4190`, 호출 `:4189`). **`probe`는 `apply` 밖에서, 승인 반환 뒤에 부른다** — 런타임이 켜진 경우 `apply()`는 `fenceAndStop` 직후(`mcp-runtime-coordinator.js:162-178`) 도는 구간이라 그 안에서 upstream 서버를 spawn하면 펜스가 오염된다. 프로덕션에서는 `main.js`가 `mcpCli`를 주입하고, `verify-plugins.js`는 같은 `mcpCli`를 직접 주입한다(W5-1). **`handleMcp*`를 재사용하지 않는다**(근거는 §6 R3) | 중복 승인 거부 · executor 스파이 호출 순서 · `probe`가 `apply` 밖에서 불린다 · **차단 별칭 봉투는 executor를 한 번도 부르지 않는다**(R-6·RC-3 — 게이트가 이 모듈에 있으므로 이 단언이 성립한다) · **pending 왕복: `register` → `pending()`에 뜸 → `approve` → `pending()`에서 사라짐**(RC-A1 ⑸) · `main.js`를 require하지 않음 |
| W2-4 | `app/main.js:4209` 뒤 | `ipcMain.handle` 3개 — `athena:plugin-approve` · `athena:plugin-reject` · `athena:plugin-pending` — **+ `ipcMain.on('athena:plugin-noted')` 1개**(**모델·GUI 두 경로 공통의** pending 등록. 본문은 `pluginProposalRegistry.register(envelope)` 한 줄이고 아무것도 반환하지 않는다 — RC-1 ⑶). **approve의 순서는 ⑴게이트 → ⑵원자 등록·소비 → ⑶`revision` 대조 → ⑷실행 → ⑸probe다.** ⑴ **별칭 게이트를 메인이 다시 검증한다 — 다만 게이트 자체는 `plugin-proposal-registry.js`가 소유하고 이 핸들러는 그것을 호출만 한다(권위 검증의 자리는 메인 경로이되 코드의 거처는 순수 모듈이다 — R-6 · RC-3).** 게이트 4종: `_BLOCKED_ALIASES`(kiwoom·brain 계열) 거부 · `action==='install'`이면 `lib/plugin-catalog`의 `CATALOG` 멤버십 필수(`require('./lib/plugin-catalog')`는 node에서 가능하다 — `verify-plugins.js:24`가 이미 그렇게 한다. `main.js`가 그 `CATALOG`를 모듈에 주입한다) · `allow_tools`·`revoke_tools`·`set_enabled`·`remove`는 executor `list()` 멤버십 필수 · `stage_snippet`은 §2.4 PM-1이 정한 스니펫 파싱 후 전 별칭 차단 검사. 하나라도 실패하면 **실행 없이 `{ok:false}`**를 돌려준다. ⑵ 봉투 전체를 인자로 받아(§2.3 축 2 결정문 ⑵ · §8 확정 10) "미등록이면 등록하고 즉시 소비, 이미 소비됐으면 거부"를 원자적으로 수행. ⑶ 봉투 `revision`이 `null`이면 현재 값으로 채우고 만료 판정을 건너뛴다(§2.3 축 2 ⑴). ⑷ **`providerRuntimeEnabled` 분기**(§6 R3): 꺼져 있으면 `apply` 시퀀스를 직접 실행, 켜져 있으면 `runMcpMutation('plugin-batch', apply)`를 **정확히 한 번**. 어느 쪽이든 `mcpCli.*`를 직접 이어 붙인다 — `stageSnippet`도 여기서 `mcpCli.stageSnippet`으로 부른다(W2-5). ⑸ `probe`는 ⑷ 반환 뒤에 부른다(W2-3). **approve·reject는 어느 쪽이든 그 봉투를 pending 맵에서 제거한다**(RC-A1 ⑷). reject는 **아무 CLI도 부르지 않고** 소비 표시 + pending 제거만 하고, pending은 `[미해결 봉투 배열, 현재 revision]`을 돌려준다 | 단위 테스트 + `verify:plugins` |
| **W2-5** | 같은 핸들러 안 (주의 항목) | **`athena:mcp-stage-snippet` 핸들러는 어느 빌드에서도 `runMcpMutation`을 타지 않는다** — `handleMcpStageSnippet`(`main.js:4167-4169`)은 `mcpCli.stageSnippet(snippet)`을 그대로 반환하고(분기 자체가 없다), 등록은 `:4203`이다. *형제 5종(`:4171-4200`)은 런타임이 켜졌을 때만 탄다 — 기본 빌드에서는 **아무 핸들러도** 타지 않는다(§6 R3 실측).* 그런데 그 CLI는 실제로 `register --snippet-file`을 돌려 `registry.add()` + `request_consent()`까지 수행한다(`app/lib/main/mcp-cli.js:139-150` 주석, 함수는 `:152 async function stageSnippet`) — **승인 시 `~/.athena/mcp_servers.json`이 변한다.** 기존 핸들러를 그대로 부르면 런타임이 켜진 빌드에서 그 변경만 재기동 밖에 남아 R3의 "묶음 뒤 재기동 1회" 약속이 조용히 깨지고 게이트웨이 `_load()` 캐시와 디스크가 벌어진다. 따라서 묶음 시퀀스 안에서 `mcpCli.stageSnippet`을 **직접** 부른다 | `verify:plugins`에서 스니펫 승인 후 레지스트리 파일이 실제로 변함을 단언 |

### W3 — 렌더러: 캔버스 · 채팅 · CSS

| 단계 | 파일 | 변경 | 검증 |
|---|---|---|---|
| W3-1 | 신규 `app/lib/plugin-proposal.js` (+`.test.js`) · **`app/shell.html` 스크립트 블록** | **로드 등록(RC-6 ⑴⑵ — W0-1과 같은 규칙):** `<script src="lib/plugin-proposal.js"></script>`를 `shell.html`의 스크립트 블록(작업 트리 `:394-486`, 워크트리 −2) 안 `lib/plugin-canvas.js`(`:472`) 인접 자리, **`canvas.js`(`:485`)·`chat.js`(`:486`)보다 앞**에 넣는다. 노출 이름은 **`window.AthenaLib.PluginProposal`**, 이중 내보내기 형판은 `lib/guard-confirm.js`·`lib/plugin-catalog.js` 말미. DOM 없는 순수 모듈: **`buildProposal(action, target, features, reason, revision)`**(R-4 — `revision` 인자가 시그니처에 있다) · `validateProposal` · `isProposalStale(p, currentRevision)` · 카드 본문/근거 문구 조합. **`revision`의 출처를 못박는다:** 모델 경로는 `plugin_tools.dispatch`가 `registry.reload()` 뒤 찍고(W1-1), **GUI 경로(C1)는 `canvas.js`가 가장 최근 `pluginRefresh()`(`canvas.js:2581-2599`)에서 받은 값을 넘긴다** — PM-3 배선 1로 `mcp-cli.js list()`가 `revision`을 함께 돌려주게 되므로(현행 `:106-137`은 `:136`에서 `{ servers }`만 반환) `pluginRefresh`가 그것을 모듈 변수에 보관하고 `buildProposal`에 전달한다. **아직 못 얻은 경우(첫 진입 등)는 `null`을 싣는다** — `validateProposal`은 `revision` 키의 **존재**를 요구하되 `null`을 허용하고, `isProposalStale`은 `null`이면 **만료로 판정하지 않는다**(승인 직전 메인이 현재 값으로 채운다 — W2-4 ⑶) | `node --test lib/plugin-proposal.test.js` |
| W3-2 | `app/lib/plugin-canvas.js` | ⑴ 승인 카드 컴포넌트 신설(제공·용도·요청 기능·실행 명령·설치 위치·거부/승인 — 현행 설치 시트 본문 `:785-833` 재사용) ⑵ `제안 대기`·`거부됨`·`만료됨` 3상태 ⑶ **공개 API 확장**: 현행 반환값은 `:1011`의 `{ mount, setView, setSearch, setData, getState }`뿐이다 — 호스트가 봉투를 넣을 함수가 없다. **`setProposals(list, { revision })`를 추가한다 — 이것 하나로 확정한다(O-C1).** `setData({proposals, revision})` 확장 대안은 폐기한다: §9 ADR Consequences ⑵가 공개 API +1을 `setProposals`로 이미 못박았고, §8의 "유일한 답" 원칙상 ralph에게 양자택일을 남기지 않는다. 이 모듈은 IPC를 전혀 모른다(`window.athena` 호출 0건) — 호스트 deps와 setter로만 산다. ⑷ **직접 IPC 제거**: `approveInstall`(`:602-618`)·`confirmRemove`(`:620-631`)·`savePermissions`(`:635-655`)·`toggleButton`(`:433-471`)·**스니펫 경로 `onStageSnippet`(`:271-272`)·`onApproveServer`(`:290-291`)**가 `deps.onPropose(envelope)`를 부르도록 전환, 낙관적 토글(`:452-453`)과 그 롤백(`:464-470`)을 함께 제거 — 승인 전에는 행이 움직이지 않는다. `onDiscardStaged`(`:304-305`)는 상태를 안 바꾸므로 그대로 둔다 | `plugin-canvas.test.js` (기존 23건 + 신규 ~10건) |
| W3-3 | `app/canvas.js:2519-2535` (main 기준 `:2208-2224` — §0-5) **+ `:2537`(`window.AthenaPluginCanvas = pluginCanvas`, 워크트리는 심볼로 재탐색 — W3-4 ⑷ 복원 훅의 거처, RC-2)** | `createPluginCanvas` deps를 `onPropose` 중심으로 재배선. **GUI 진입 6종 전부**(`onApproveInstall`·`onTogglePlugin`·`onRemovePlugin`·`onSavePermissions`·`onStageSnippet`·`onApproveServer`)가 `onPropose`로 간다. `pluginSaveTools`(`:2626`)·`pluginStageSnippet`(`:2653`)·`pluginApproveStaged`(`:2663`)·`pluginInstallCatalogEntry`(`:2692`)·`pluginSetEnabled`(`:2723`)·`pluginRemove`(`:2752`)는 **승인 실행 경로로만** 남는다(GUI 진입점에서 직접 호출하지 않음). 이 파일이 `athena:mcp-` 14건을 쥔 실제 직접-IPC 소유자다 — A3 게이트의 측정 대상이 여기다. **추가 1줄(R-4):** `pluginRefresh()`(`:2581-2599`)가 `list()`가 돌려준 `revision`을 모듈 변수에 보관하고, 모든 `onPropose` 합성이 `buildProposal(..., revision)`으로 그것을 싣는다(못 얻었으면 `null`) | `verify.js` 플러그인 블록 + A3 단위 단언 |
| W3-4 | `app/chat.js` · `app/canvas.js` | ⑴ **구독은 두 곳으로 나뉜다.** 캔버스 카드는 `canvas.js`가 `athena:plugin-proposed`를 **모듈 스코프**로 구독해 `pluginCanvas.setProposals(...)`를 부른다 — 턴 스코프 형판(`chat.js:1184-1188`의 `myToken !== abortToken` 가드)을 여기 복제하면 턴 종료 직후 카드가 사라져 PM-3·H6과 정면 충돌한다. `chat.js`의 **턴 스코프 구독은 채팅 제안 턴 렌더에만** 쓴다(`:1184-1188` 형판 그대로). **모드 게이트는 이 모듈 스코프 핸들러 안에 있다(RC-A2·RC-2):** `setProposals(...)`를 부르기 **전에** 어댑터 `currentMode()`를 읽어 `'plugin'`이 아니면 봉투를 버리고 — pending에도 넣지 않는다(`athena:plugin-noted`를 보내지 않는다) — 아무것도 그리지 않고 반환한다. 모드일 때만 카드를 그린 **뒤** `athena:plugin-noted`를 단방향 send로 보내 pending에 등록한다. **이 send가 모델·GUI 두 경로의 유일한 pending 등록 지점이다(RC-1 ⑴ — 메인은 push 직전에 등록하지 않는다).** 응답을 기다리지 않으므로 확정 10의 0ms 렌더가 유지된다(D3 근거 보존) ⑵ **캔버스 카드의 상태 표시**(승인 대기 → 처리 중 → 승인됨/거부됨/실패/만료됨)를 카드 안 `span.agent-mode`에 기록한다(형판 `chat.js:2687`/`:2694`/`:2703` — `athena:nudge-guard` 승인 카드의 결과 문구 3종. 워크트리는 `guardConfirm` 심볼로 재탐색). **이것은 카드 상태이지 채팅 결과 턴이 아니다(RC-3)** — 08번 보드가 요구하는 결과 턴은 ⑶의 새 경로가 만든다 ⑶ **채팅 결과 턴의 거처를 지목한다(RC-3).** 모드 **안**에서 승인/거부/실패/재시작이 끝나면 `chat.js`가 결과 턴을 마운트한다 — 경로는 **모듈 스코프 `_mountTurn`**(작업 트리 `app/chat.js:2162`, 선례 `renderAgentTurn` `:2171`. 워크트리는 `function _mountTurn` 심볼로 재탐색)이고, **턴 스코프 구독(`chat.js:1184-1188`의 `myToken !== abortToken` 가드)으로는 원리적으로 불가능하다** — 승인 클릭은 살아 있는 LLM 턴 **밖**에서 일어나 그 클로저가 이미 죽어 있다. `canvas.js`→`chat.js` 전달은 **새 IPC 채널을 발명하지 않고** 렌더러 내부 `CustomEvent` 선례를 복제한다(`app/canvas.js:2595`의 `window.dispatchEvent(new CustomEvent('athena:plugins-changed', …))` — 같은 자리에 `athena:plugin-result`를 하나 더 낸다). 08번 보드의 결과 턴 4종(성공 3줄 · 거부 1줄 · 실패+`다시 시도` 칩 · 재시작)이 모두 이 경로로 그려진다. **모드 밖에서는** `chat.js`의 몫이 **한 줄 결과 턴 하나뿐**이다: 같은 `currentMode()`로 플러그인 모드가 아니면 `플러그인 모드에서 다시 요청합니다`를 한 번 낸다(같은 봉투 서명은 한 턴 1회 — PM-5). 카드를 만들지 않는 주체는 `chat.js`가 아니라 ⑴의 `canvas.js`다 — **판단은 렌더러가 하고 메인은 무조건 push한다**(W0 결정문) ⑷ **복원 훅의 거처를 못박는다(RC-2).** `app/canvas.js`의 `window.AthenaPluginCanvas = pluginCanvas`(작업 트리 `:2537`, 워크트리는 `AthenaPluginCanvas` 심볼로 재탐색) 지점에서 **노출 객체의 `setView`를 감싸** 그 안에서 `athena:plugin-pending`을 invoke해 미해결 제안 + 현재 `revision`으로 카드를 복원한다. **`app/lib/sidebar.js`는 수정하지 않는다** — 실측상 `sidebar.js:54`의 `onSelect`는 `view === 'plugin'`에서 `window.AthenaPluginCanvas.setView('hub')`만 부르고(`:58-62`) refresh 훅이 없으며(바로 아래 `view === 'backtest'` 가지 `:63-67`은 `AthenaBacktestCanvas.refresh()`를 부른다), `canvas.js`의 `pluginRefresh()`도 진입마다 돌지 않는다(`void pluginRefresh()` `:2781` 1회 + 변이 후에만). 래퍼를 쓰면 사이드바를 건드리지 않고 "진입마다"가 성립한다. **`app/lib/plugin-canvas.js`는 IPC 무지를 유지한다**(`window.athena` 호출 0건) — invoke는 래퍼가 하고 결과만 `setProposals`로 넣는다 | 렌더 단위 테스트 |
| **W3-6** | `app/shell.html:296-299` · `app/lib/graph-mode/controller.js:302` — **주의(RC-6 ⑶): 여기서 만지는 `shell.html`은 `:296-299`의 `#chatModeHead` 구역이고, W0-1·W3-1이 만지는 곳은 `:394-486`의 스크립트 블록이다. 같은 파일의 별개 구역이므로 한쪽 편집이 다른 쪽을 대신하지 않는다.** **선행 조건: 없음 — §1의 사용자 결정(2026-09-03 승인)으로 종결됐으므로 무조건 실행한다. §1의 롤백 문단은 실행 대상이 아니다** | **①-03의 채팅 헤더 "아테나 · 플러그인 대화"를 만족시키는 유일한 이음매다.** 오늘 `#chatModeHead`(`shell.html:296`)는 제목 `그래프에게 묻기`(`:297`)·부제 `답이 캔버스를 바꿉니다`(`:298`)가 **하드코딩**이고, `controller.js:302`가 `elements.chatHead.hidden = !graphView` 한 줄로 **그래프 모드에만** 보인다. 변경: ⑴ 두 `<span>`을 빈 채로 두고 controller가 모드별 문구를 주입(그래프=현행 2문장, 플러그인=`아테나 · 플러그인 대화` + 부제 `설치와 권한을 여기서 정합니다`) ⑵ `:302`의 가시성 조건을 `graphView \|\| pluginView`로 넓힌다. **대화·에이전트·백테스트 모드에서는 헤더가 계속 없다**(보드 37) | A10 회귀 단언: 그래프 모드에서 제목·부제 문자열이 **한 글자도 바뀌지 않는다** + 플러그인 모드에서 새 두 문자열이 뜬다 + 대화 모드에서 `hidden===true` |
| W3-5 | `app/styles/plugin-canvas.css` (728줄) | 승인 카드·3상태 스타일. 토큰만 사용(`styles/tokens.css`), 하드코딩 hex 0. 채팅 쪽 제안 턴은 기존 `.routine-approval`(`chat.css:1596`)·`.routine-approval-actions`(`:1729`)·`.routine-btn`(`:1734`)·`.routine-draft-pill`(`:1749`) 재사용 — 새 시각 언어를 만들지 않는다. **O1: W4(Paper)를 먼저 확정하고 이 단계를 그 픽셀에 맞춘다** | hex grep 단언 + PDF 대조 |

### W4 — Paper 보드 (W0~W3-4와 병렬 · **W3-5보다 먼저**)

**Paper 호출 순서(보드 1장마다, 예외 없음).** `get_guide({topic:"paper-mcp-instructions"})` → `get_basic_info` → `get_font_family_info` → 편집(정정 보드: `find_nodes`로 대상 텍스트 노드 확보 후 `set_text_content`·`update_styles` / 신설 보드: `create_artboard` → `write_html`) → `get_screenshot`(육안 확인) → `finish_working_on_nodes`. 앞 세 개는 세션당 1회로 족하고, 편집~finish는 보드마다 반복한다.

**배치.** 기존 격자는 4열이다 — `01 FT6-0`(x=0,y=0) · `02 15J-0`(2000,0) · `03 CU0-0`(4000,0) · `04 CVY-0`(6000,0) · `05 2NW8-2`(0,1140) · `06 2NXS-2`(2000,1140). 신규는 그 줄을 잇는다: **07 → (4000,1140) · 08 → (6000,1140) · 09 → (0,2280)**. 세 장 모두 **1680×986 픽셀 고정**(01과 동일). `height:"fit-content"`를 쓰지 않는다 — 이 저장소에서 높이 0 붕괴로 검은 스크린샷이 재현됐다.

**정정 2장의 치수도 비워 두지 않는다(fit-content 금지는 여기에도 적용된다).**
- **06번(4칸 → 6칸).** `get_basic_info`로 현재 폭·높이를 실측하고, 6칸이 현재 격자에 들어가지 않으면 **픽셀 높이를 명시적으로 늘린다**(2행 3열이면 높이를 늘리고, 1행 6열이면 폭을 늘린다). 늘린 값은 W5-3의 파리티 문서에 기록한다. 어떤 경우에도 `height:"fit-content"`로 도망가지 않는다.
- **05번(560px 모달 시트 → 캔버스 내부 카드).** 아트보드는 **01과 같은 1680×986 셸**로 맞추고, 그 위 플러그인 캔버스 영역 안에 승인 카드를 폭 **560px 유지**로 얹는다(모달 딤·중앙 부유만 제거하고 카드 폭은 그대로 쓴다 — 필드 6줄이 이미 그 폭에 맞춰져 있다).

**기존 6장은 삭제하지 않는다.** 아래 "지울 문구"는 노드 삭제가 아니라 **문자열 교체**다(빈 자리는 새 문구가 채운다).

| 보드 | id | 대상 노드 / 구역 | 지울 문구 (정확) | 넣을 문구 (정확) |
|---|---|---|---|---|
| 01 기능 허용 | `FT6-0` | 도구 체크 목록 상단 라벨 · 하단 경계 문구 위 | 체크 목록이 곧 확정이라는 인상을 주는 목록 제목 | 목록 제목 → `권한 초안` · 그 아래 보조 1줄 `승인 카드로 확정합니다` · 목록 우측 진입 표시 `채팅: 시세 조회만 허용` (배지 `설치됨 · 기능 6 · 허용 4 · 연결 확인됨`과 하단 내장 API 경계 문구는 **그대로 둔다**) |
| 02 설정 직접 등록 | `15J-0` | 시트 하단 여백 | (없음) | 각주 1줄 `채팅에서 등록을 제안해도 같은 승인 카드로 들어옵니다` |
| 03 허브·설치 | `CU0-0` | 보드 캡션 구역 · 채팅 패널 머리 | **`채팅은 유지되고 캔버스만 허브로 바뀝니다`** · `네 번째 모드` · `캔버스만 교체` · `채팅 상시` | 캡션 `플러그인 모드 창입니다` · 그 아래 `설치 · 권한 · 플러그인` · 채팅 패널 머리 2줄 `아테나 · 플러그인 대화` / `설치와 권한을 여기서 정합니다` (허브 본문 `설치됨`/`추천`, `+ 서버 추가`, 설명 `플러그인은 설치 후 기능별로 허용합니다. Kiwoom·brain은 Athena 내장 API라 이 목록에 표시하지 않습니다.`는 그대로) |
| 04 관리 | `CVY-0` | 행별 스위치 옆 상태 텍스트 | 스위치가 곧 반영이라는 표현 | 스위치 옆 `승인 후 반영됩니다` · 삭제 버튼 옆 `승인 후 지웁니다` · 집계 `플러그인 · 기능 · 마켓플레이스` 유지 |
| 05 설치 승인 | `2NW8-2` | 560px 시트 프레임 전체 | 모달 프레임(딤 처리·화면 중앙 부유)과 `GUI 설치 버튼이 여는 모달`이라는 위치 규정 | **플러그인 캔버스 안에 놓인 승인 카드**로 재배치. **카드 제목(확정)은 `웹 문서 읽기 설치`** — 기존 모달 제목 문자열을 그대로 카드 제목으로 옮긴다(W5-2의 신설 단언이 이 문자열을 그대로 쓴다). 필드는 순서대로 `플러그인 정보` / `제공: …` / `용도: …` / `요청 기능` / `실행 명령: uvx mcp-server-fetch` / `설치 위치 · 플러그인 모드 > 웹 문서 읽기` / 배지 `권한 1개 요청`·`설치형 플러그인` / 버튼 `거부`·`승인`. 카드 머리에 출처 라벨 `아테나 제안`, 하단 각주 `허브의 설치 버튼도 이 카드로 들어옵니다` |
| 06 상태 모음 | `2NXS-2` | 4상태 격자 | (4상태 유지) | 5·6번째 칸 추가 — `제안 대기`(승인·거부 버튼 살아 있음) · `거부됨`(버튼 비활성, 한 줄 `그대로 뒀습니다`). 총 6칸 |

**07 · 플러그인 대화 — 제안 턴 5동작** (형식 결정: **1장 안 5열**, §8-5)

머리 `제안 턴 5동작` / 보조 `채팅이 제안하고 캔버스가 승인합니다`. 5열은 좌→우로 설치 · 기능 허용 · 켜기·끄기 · 삭제 · 스니펫 등록. 각 열은 위에 **채팅 제안 턴**(출처 필 `제안` + 문장), 아래에 **승인 카드**(제목 + 필드 2~3줄 + `거부`·`승인`)를 세로로 쌓는다.

| 열 | 제안 턴 문장 | 승인 카드 제목 | 카드 필드 |
|---|---|---|---|
| 설치 | `한국 주식 시세를 설치할까요` | `한국 주식 시세 설치` | `제공: athena-official` · `실행 명령: npx -y @drfirst/korea-stock-mcp` · `권한 6개 요청` |
| 기능 허용 | `시세 조회만 허용할까요` | `한국 주식 시세 · 기능 허용` | `허용 4 / 6` · 켤 기능 이름 목록 · 끌 기능 이름 목록 |
| 켜기·끄기 | `웹 문서 읽기를 끌까요` | `웹 문서 읽기 끄기` | `승인 철회` · `기능 1개가 함께 멈춥니다` |
| 삭제 | `시간·시간대를 지울까요` | `시간·시간대 삭제` | `등록과 승인 기록을 함께 지웁니다` · `되돌리려면 다시 설치합니다` |
| 스니펫 등록 | `이 서버를 등록할까요` | `직접 등록` | `실행 명령: …` · `등록만으로는 실행되지 않습니다` |

**08 · 플러그인 대화 — 결과 턴**

머리 `결과 턴` / 보조 `승인한 뒤 무엇이 일어났는지 남깁니다`. **5열**(다섯 번째는 RC-A3·RC-4로 신설한 "모드 밖 폐기" 칸 — 07번과 같은 5열 격자라 밀도 예산 안에서 처리된다).

| 열 | 내용 |
|---|---|
| 성공 | 결과 턴 3줄 — `등록했습니다` → `연결을 확인했습니다` → `기능 6개를 찾았습니다`. 옆 캔버스 행은 배지 `설치됨 · 기능 6 · 허용 0 · 연결 확인됨` |
| 거부 | 카드가 `거부됨`으로 잠기고 결과 턴 1줄 `그대로 뒀습니다`. 레지스트리 행은 **변화 없음**을 같은 화면에 병기 |
| 실패·재시도 | 결과 턴 `연결 실패 — <사유>` + 칩 `다시 시도` (기존 06번 probe 실패 배너와 같은 색 역할: amber) |
| 재시작 반영 | **이 열은 런타임이 켜진 경우(`ATHENA_PROVIDER_RUNTIME`)에만 뜨는 결과 턴이다**(C-10 · §6 R3). 그때 문구는 결과 턴 `플러그인이 바뀌어 대화를 다시 시작했습니다` + 보조 한 줄 `방금 승인한 내용은 반영됐습니다`이고, **한 번의 승인이 여러 동작을 담았으면 재시작은 그 묶음 뒤 한 번만 표시한다**(§6 R3 결정). **기본 빌드(런타임 꺼짐)에서는 `방금 승인한 내용은 반영됐습니다`를 쓰지 않는다** — 게이트웨이가 낡은 레지스트리를 쥔 채이므로 거짓이다. 보드는 이 칸을 두 변형으로 그린다: 켜짐 = 위 두 줄 · 꺼짐 = 06번 기존 "재시작" 상태와 같은 계열의 `다음 실행부터 반영됩니다`(오늘 `canvas.js:2591 restartRequired`가 이미 정직하게 처리하는 것) |
| **모드 밖 폐기**(신설 — RC-A3·RC-4) | 대화 모드 채팅에 결과 턴 **한 줄**만 — `플러그인 모드에서 다시 요청합니다`. 캔버스에는 **아무 카드도 없다**(같은 화면에 "카드 0건"을 병기해 폐기가 보관이 아님을 보인다). W0 결정문의 폐기 계약이 사용자에게 보이는 유일한 자리이고, 이 문자열의 검수 승인 안건이 W5-4 ⑸다 |

**09 · 플러그인 창 복원**

머리 `창을 다시 열었을 때` / 보조 `작업하던 것이 그대로 남습니다`. 3열 + 하단 경계 문구 1줄.

| 열 | 내용 |
|---|---|
| 권한 초안 | 토글 3개가 켜진 채로 복원 · 라벨 `권한 초안` · 저장 버튼 위 발산 알림 예시 `그 사이 바뀐 기능: 시세 조회 · 종목 검색`와 두 버튼 `초안대로 저장`·`현재 값으로 초기화`(PM-4) |
| 미전송 입력 | 채팅 입력줄에 쓰다 만 문장이 그대로 남아 있는 모습 |
| 제안 대기 카드 | `제안 대기` 카드가 그대로 · 그 옆에 낡아진 경우의 `만료됨` 카드(버튼 비활성 + 칩 `다시 제안받기`) |

하단 경계 문구(정확): `앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다`. — PM-2의 프로세스 수명 경계를 사용자에게 정직하게 알리는 유일한 자리다.

**게이트:** 문구 3원칙 위반 0(설명문 금지 · 한국어 단위 · 내부용어 금지 — 보드 문구에 `MCP 서버`·`consent`·`IPC`·`봉투` 같은 내부어를 쓰지 않는다) · 하드코딩 hex 0(허용 알파 틴트 제외) · blue=현재 선택/amber=검토 필요/pink=주요 동작 1곳 · 겹침·잘림 0 · 클릭 영역 32px · 재질 유지(외곽 `#FFFFFFDB`·16px, 중앙 `#FFFFFFEB`·12px).

### W5 — 검증 · 파리티 문서 · 검수 게이트

| 단계 | 파일 | 변경 |
|---|---|---|
| W5-1 | `app/verify-plugins.js` | **여기서 5동작 사슬 전체를 잰다.** 이 하네스는 DOM이 없고 `lib/main/mcp-cli`와 `lib/plugin-catalog`만 require하며(`verify-plugins.js:23-24`), 매 실행 임시 레지스트리를 쓴다(`:1-12`, `:18-19`). 그래서 **UI 없이도** 사슬을 끝까지 잴 수 있다: `buildProposal(동작)` → `pluginProposalRegistry.consume(envelope)`(확정 10의 "봉투 전체를 받아 원자적으로 등록·소비"와 같은 시그니처다 — 하네스만 `proposal_id`를 넘기는 두 갈래를 만들지 않는다. O-C2) → **주입한 executor 8종**(= `mcpCli`의 `register`/`approve`/`allowTool`/`revoke`/`remove`/`stageSnippet`/`probe`/`list` — W2-3) → 레지스트리·consent 실제 변화. **주입 계약이 이 검증을 가능하게 하는 유일한 이유다**(W2-3): 이 하네스는 `main.js`를 require할 수 없고(Electron 진입점) `handleMcp*`를 부를 수도 없으므로, 레지스트리 모듈이 executor를 주입받지 않으면 명세 ②의 핵심 단언이 통째로 검증 불가가 된다. 5동작 각각에 대해 ⑴ 승인 시 원하는 상태로 바뀐다 ⑵ **거부 시 두 파일이 바이트 단위로 불변**(`ATHENA_MCP_REGISTRY_PATH`가 가리키는 임시 `mcp_servers.json`과 같은 디렉터리의 `consent.json` — §2.1 원칙 3) ⑶ 같은 `proposal_id` 재사용은 거부되고 CLI가 두 번 불리지 않는다 ⑷ **install 실패 시 레지스트리에 미승인 행이 남지 않는다**(§6 R3의 install 서브사슬 보상 — `approve` 실패 후 `remove`가 불려 `list()`에 그 별칭이 없다) ⑸ **차단 별칭 봉투는 executor를 한 번도 부르지 않는다**(RC-3 — 게이트가 이 모듈 안에 있으므로 `main.js` 없이도 이 사슬이 게이트를 지난다. 게이트를 핸들러 본문에 뒀다면 이 하네스가 게이트를 통째로 우회했을 자리다). 신규 모듈 2개(`lib/plugin-proposal.js`·`lib/main/plugin-proposal-registry.js`)를 require 목록에 추가한다 — 둘 다 DOM을 안 쓴다(W3-1·W2-3의 설계 제약) |
| W5-2 | **`app/verify.js:1942-2137`** (플러그인 블록 전체 — 끝은 `pluginProbeFailure.emptyCopy` 단언 `:2137`) | **신규가 아니라 개정이다.** 현행 `pluginInstallModal` 단언 묶음(`verify.js:2101-2116`, 단언 15개)이 05번 보드를 *모달*로 못박고 있어, 시트가 카드가 되면 **반드시 깨진다.** 개정 목록 — **폐기 7**: `dialogCount === 1` · `panelInert === true` · `focusedInitially` · `wrappedBackward` · `wrappedForward` · `focusRestored`(카드는 포커스 트랩이 없다) · **`subtitle === '설치할 플러그인과 요청 권한을 확인하고 한 번에 하나씩 승인합니다'`(`:2104`)** — 묶음 승인(§6 R3)이 "한 번에 하나씩"을 무효화하므로 되살리지 않고 폐기한다. **유지 7**: `title === '웹 문서 읽기 설치'`(W4 05행에서 카드 제목으로 확정 — 문자열이 같으므로 단언도 그대로 산다) · `confirmLabel === '승인'` · `cancelLabel === '거부'` · `/^제공: /` · `command === '실행 명령: uvx mcp-server-fetch'` · `location === '설치 위치 · 플러그인 모드 > 웹 문서 읽기'` · `badges === ['권한 1개 요청','설치형 플러그인']`. **경계 1**: `closed === true`(거부 시 카드가 사라진다)는 유지하되 "모달이 닫힌다"가 아니라 "카드가 제거된다"로 판정식을 바꾼다. **신설 8**(A5를 (가)안으로 확정한 결과 — C-9 · 접근성 1건은 O-A3·O-C6): ⑴ 카드가 `#pluginCanvas` 하위에 있다 ⑵ **같은 순간 `#history` 하위에 제안 턴 노드가 0건**(A5 음성 절반 + §2.3 축 2 "GUI 클릭은 채팅 턴을 만들지 않는다") ⑶ 출처 라벨이 `아테나 제안`/`내 요청` 두 값 ⑷ `제안 대기`·`거부됨`·`만료됨` 3상태 ⑸ GUI `설치` 클릭이 같은 카드를 띄운다 ⑹ W3-6의 채팅 헤더 3종 단언(A10) ⑺ **기본 빌드에서 승인 후 결과 턴이 `반영됐습니다`를 주장하지 않는다**(C-10 회귀 고정 — `다음 실행부터 반영됩니다` 계열만 허용). **"정직성 회귀" 커버리지의 나머지 절반은 §2.5 단위(앱·렌더)의 부활 방지 단언이다(RC-1 ⑷ — 모드 밖에서 폐기된 모델 제안이 이후 `athena:plugin-pending` 조회에 나타나지 않는다). 두 단언이 함께 §2.1 원칙 4를 잰다 — 앞은 "거짓을 말하지 않는다", 뒤는 "폐기했다고 말한 것이 되살아나지 않는다". 후자는 DOM이 필요 없으므로 `verify.js`가 아니라 `node --test`에 둔다** ⑻ **접근성 최소 1건**: 승인·거부 버튼이 **키보드로 도달 가능**하고 클릭 영역이 **32px 이상**이다 — 폐기 7이 `dialogCount`·`panelInert`·`focusedInitially`·`wrappedBackward`·`wrappedForward`·`focusRestored`를 통째로 지워 승인 표면의 접근성 커버리지가 0이 되는데, 카드에는 **파괴적 동작(승인)**이 붙어 있고 ①의 "클릭 영역 32px" 게이트는 오늘 Paper 보드에만 걸려 있고 앱 단언에는 없다(O-A3·O-C6). **양성 제안-턴 렌더 단언은 여기 넣지 않는다** — `verify.js`가 LLM 턴을 못 돌려 리스너가 없다(A5 참조). 폐기 7 + 유지 7 + 경계 1 = 15로 현행 단언 수와 맞고, 신설 8은 그 위에 더한다 |
| W5-3 | `PAPER_APP_PARITY.md:96-121` | 표를 6행 → 9행으로 확장(07·08·09 추가), 03·05 소유 표면 문구 갱신, 제목 `6/6` → `9/9`, 06번의 늘린 아트보드 치수 기록(W4). **09번 "미전송 입력" 열이 파리티 `적용`인 근거를 한 줄 적는다**: 오늘 입력줄은 제출 시에만 비워지므로(`app/chat.js:1747 $input.value = ''`) 모드 이탈·재진입에서 문장이 그대로 남는다 — H5가 미구현이어도 이 열은 실앱과 일치한다 |
| W5-4 | 검수 | 전 보드 `export_combined_pdf`(필요 시 분할 병합) → 사용자 발송 → 승인. **명시 안건 4건(⑴⑵⑶⑸)을 함께 올려 사용자 판단을 받는다**(§7 grep이 못 잡는 항목): ⑴ 09번 하단 경계 문구 `앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다`가 문구 3원칙의 설명문 금지와 마찰한다 — 정직성을 위해 남길지 ⑵ 명세 R4 원문은 "GUI 버튼을 누르면 **채팅 제안 턴을 거쳐** 합류"인데 이 계획은 "GUI 경로는 채팅 턴을 만들지 않는다"로 좁혔다(§2.3 축 2). 수락 기준 ②·①-05는 "카드로 합류"만 요구하므로 계약 위반은 아니나, 사용자 답변 문구와 다른 제품 결정이다 ⑶ **(O-8)** `verify.js:2104`의 subtitle `설치할 플러그인과 요청 권한을 확인하고 한 번에 하나씩 승인합니다`를 폐기하는 것(W5-2)은 **이미 검수를 통과한 제품 문구를 묶음 승인 때문에 뒤집는 일**이다 — 안건 ⑴·⑵와 성질이 같으므로 함께 올려 판단을 받는다 ⑷ **(해소)** 그래프 헤더 예외(W3-6)는 2026-09-03 사용자 승인으로 **종결** — 검수 안건이 아니다. W3-6은 무조건 실행한다(§1 결정 줄). 실제 안건은 ⑴⑵⑶⑸ 4건이다 ⑸ **(RC-A3·RC-4)** 모드 밖 폐기의 한 줄 문구 **`플러그인 모드에서 다시 요청합니다`**(08번 5열) — 사용자에게 보이는 신규 제품 문구이므로 문구 3원칙 게이트와 PDF 검수를 통과시킨다. 폐기된 옛 문구 `플러그인 모드에서 승인할 수 있습니다`는 제안이 살아 있다고 약속해 §2.1 원칙 4를 어겼음을 함께 기록한다 |

**명세 ② 충족 논거.** ②는 "`npm run verify:plugins` 재통과 + 신규 assertion: 5동작 제안→승인→실행 성공, 거부 시 불변, GUI 버튼 클릭이 제안 카드로 합류"를 요구한다. W5-1이 앞의 둘(**5동작 사슬 성공 · 거부 시 불변**)을 `verify:plugins` 안에서 실제 왕복으로 만족시키고, 마지막 하나(**GUI 버튼이 카드로 합류**)만 DOM이 필요하므로 W5-2가 `npm run verify`에서 만족시킨다. 두 명령 모두 §7의 완료 조건이므로 ②는 분할 없이 전부 검증된다.

---

## 5. 모드 귀속 창 인터페이스 계약 (별도 트랙 소유 · 이 계획은 전제만 한다)

| # | 훅 | 플러그인 모드가 기대하는 것 | **오늘 코드의 폴백** |
|---|---|---|---|
| **H2** | 채팅 패널 바인딩 | 그 창 전용 채팅 | 채팅·상주 세션 모두 전역 1개. 폴백: `canvasRegion.dataset.mode`(`controller.js:299`) 동기 읽기로 **플러그인 모드에서만** 제안 턴을 렌더 (W0-2) |
| **H4** | 스냅샷 — 권한 초안 | 모드 전용 폼 값 보존 | 없음. `plugin-canvas.js:952 setView()`가 `activeSheet`를 버리고 `lib/sidebar.js:58-62`가 진입마다 호출하며 `getState()`(`:1000`)는 `activeSheet.kind`만 반환한다. **W0-3이 이 이음매를 넓힌다.** **H4도 어댑터 인터페이스에는 없다 — 계약으로만 여기 남는다(반복 6).** 실제 구현이 `app/lib/plugin-canvas.js`(`getState`/`setData` 확장) 안에 있으므로 어댑터가 이 훅을 지면 O-A1이 H6을 뺀 것과 같은 "선언만 있고 구현이 없는 훅"이 된다. 인프라 트랙이 실물 스냅샷을 내놓으면 교체 대상은 어댑터가 아니라 `plugin-canvas.js`의 이 두 함수다 |
| **H6** | 스냅샷 — 제안 대기 카드 | 미해결 제안 보존 | 없음. 카드는 DOM 전용. 옵션 D의 `plugin-proposal-registry.js`(메인, 프로세스 수명)가 이를 진다. **H6은 어댑터 인터페이스에 없다 — 선언도 구현도 메인이 소유한다(O-10 → O-A1·O-C10으로 반복 5에서 선언마저 뺐다).** RC-A1로 pending 맵(`proposal_id → 봉투`)의 등록·조회·제거가 전부 `plugin-proposal-registry.js`에 확정됐으므로, 어댑터에 남길 것이 없다. **반복 6에서 H4도 같은 이유로 빠져 어댑터가 다루는 훅은 H2 하나다** — 인프라 트랙이 교체할 자리는 훅마다 다르다(H2=어댑터 · H4=`plugin-canvas.js` · H6=`plugin-proposal-registry.js`). 렌더러 영속 선례는 `athena.canvas.tabs`(sessionStorage, `lib/canvas-tabs.js:12`)뿐 |
| H1·H3·H5·H7 | 창 생성 · 캔버스 마운트 · 미전송 입력 · 레코드 `mode` 필드 | 인프라 트랙 소유 | 이 계획의 수락 기준이 요구하지 않는다. 오늘 폴백: 단일 `shellWin`(`main.js:196`,`:356`) + `VIEW_PLUGIN`(`graph-mode-store.js:18`) + `applyVisibility()`(`controller.js:271-303`) + 싱글턴 `#pluginCanvas`(`canvas.js:2396`). 대화 레코드는 `{id,title,createdAt,updatedAt,projectId}`뿐이며(`lib/main/conversations.js:63-69`) `mode` 추가 시 `STATE_VERSION`(`:12`) 승격이 필요하다 |

**어댑터 전략.** W0-1의 `plugin-mode-adapter.js`가 **H2 하나만** 인터페이스로 선언하고 위 폴백(`canvasRegion.dataset.mode` 동기 읽기)으로 구현한다 — H6은 메인(`plugin-proposal-registry.js`), H4는 렌더러(`plugin-canvas.js`)가 소유하므로 어댑터에 두지 않는다(O-A1의 논거를 반복 6에서 H4까지 넓혔다). 인프라 트랙이 실물을 내놓으면 **모드 인지는 어댑터 내부만**, **권한 초안은 `plugin-canvas.js`의 `getState`/`setData`만** 교체한다 — 호출부(`canvas.js`·`chat.js`·`main.js`)는 어느 쪽도 재작업이 없다.

---

## 6. 위험과 완화 (프리모템 외)

| # | 위험 | 완화 |
|---|---|---|
| R1 | **동시 진행 중인 에이전트 단 트랙이 기조 보드 35~43을 공유한다**(명세 Metadata: `di-athena-doctrine-alignment-20260903`이 공용 상태 파일을 씀) | Paper 작업 범위를 `B-2` 페이지로 엄격히 한정. 35~43은 **읽기만** 한다. 착수 전 `list_comment_threads`로 그 보드들의 변경 여부를 확인하고, 인용한 문구가 바뀌었으면 계획을 갱신 |
| R2 | **Paper 스크린샷 캡처 제약** — export는 Paper 창 포그라운드를 요구 | `export_combined_pdf`로 일괄 내보내고, 용량 초과 시 분할 후 병합. 아트보드 높이는 픽셀 고정(fit-content 붕괴 = 검은 샷, 기존 실측) |
| R3 | **상주 세션 재기동 UX** — 승인 1건마다 대화가 끊긴다 | 아래 **R3 결정** 참조 |
| R4 | **`verify:plugins`로는 *렌더* 계약을 못 잰다** | 실측: `verify-plugins.js:23-24`가 `mcp-cli`·`plugin-catalog`만 require하고 DOM·`plugin-canvas.js`를 전혀 안 쓴다. 다만 5동작 사슬 자체는 DOM 없이 잴 수 있다(W5-1). **분할은 "제안→승인 사슬"과 "화면 렌더"의 경계에서 일어나며, 명세 ② 3항목은 모두 검증된다**(W5 하단 논거) — 미해결 사항 아님 |
| R5 | **built-in은 consent 게이트를 우회한다** | `server.py:344-414`가 `:421-424` 앞에서 반환하므로 제안 툴은 항상 노출·호출 가능. 실행이 없어 안전하나, 향후 누가 실행 액션을 추가하면 게이트 없이 통과한다 → 모듈 독스트링 경고 + `test_plugin_tools.py`가 액션 enum을 6개로 **고정**(추가 시 테스트 실패) |
| R6 | **문서 드리프트** | `PAPER_DESIGN_AUDIT.md:59`는 "네 번째 모드"라 쓰지만 코드 뷰는 5종(`graph-mode-store.js:19` `backtest`, `shell.html:131-134`). `PAPER_APP_PARITY.md:96`(`## 플러그인 페이지 — 6/6`)과 `:98`("05·06 두 장을 추가해 6장이 됐다")이 6장 기준이다(`:100`은 런타임 연동 문단이라 장수와 무관). W5-3에서 함께 정정 |
| R7 | **단위 테스트 플레이키** | 실측: 같은 커밋에서 1회차 2031/2032 pass(1 fail), 2회차 2032/2032 pass. 어느 테스트인지 미확정 → W5 검증은 **2회 연속 통과**를 조건으로 한다 |
| R8 | **설정 카드의 직접 삭제 경로가 남는다** | `settings-cards.js:997`이 `athena:mcp-remove`를 직접 부른다. 명세는 설정 카드를 "변경 없음"으로 두므로 이 경로는 유지 — 다만 PM-3의 stale 카드 원인이 된다. `revision` 대조로 방어 |

**R3 결정 — 묶음 승인 + 재시작 합치기.**

- **묶음.** 승인 카드 1장이 **여러 동작을 담을 수 있다.** 봉투의 `actions`는 배열이다(`[{action, target, features}]`, 길이 1이 기본). 근거는 **빌드별로 갈라진다(RC-5 — 바로 아래 실측이 이 문장을 반증하기 때문에 여기서 미리 좁힌다).**
  - **런타임을 켠 빌드(`ATHENA_PROVIDER_RUNTIME`)에서만** "설치 승인 → 재시작 → 허용 승인 → 재시작으로 대화가 두 번 끊긴다"가 참이다. 묶으면 재기동이 한 번으로 합쳐진다 — 이것이 재기동 합치기 이득이다.
  - **기본 빌드(런타임 꺼짐 — 오늘 프로덕션)에는 그 재기동이 없다.** 아래 실측대로 `runMcpMutation` 호출자가 0이라 승인이 상주 세션을 끊지 않는다. 이 빌드에서 묶음의 근거는 **UX 하나뿐이다 — "한국 주식 시세 설치하고 시세 조회만 허용해줘"는 한 문장이니 사람이 한 번 읽고 한 번 누른다.** 그때 재기동 필요는 `canvas.js:2591 restartRequired` 플래그로만 표현되고(문구 `다음 실행부터 반영됩니다`), 실제 프로세스 재기동은 일어나지 않는다.
  - **이 구분을 적는 이유(정직성).** 계획 최대 부피(`plugin-batch` kind · 묶음 실패 계약 2종 · `providerRuntimeEnabled` 분기 · W2-5 · 검수 통과 subtitle 폐기)를 지탱하는 근거가 기본 빌드에서 거짓이면 실행 중 이 부피를 재검토할 판단 근거가 왜곡된다. **부피는 유지한다**(런타임 빌드에서 실재하고 `plugin-batch` kind는 두 빌드 모두 필요하다) — 다만 근거의 적용 범위를 여기서 정확히 적는다.
- **실측 먼저 — 기본 빌드에서 `runMcpMutation`은 죽은 경로다.** `app/main.js:100 PROVIDER_RUNTIME_DEFAULT = false`이고 `:101`이 `ATHENA_PROVIDER_RUNTIME`으로만 켠다. `runMcpMutation`(정의 `:2529`)의 호출자는 `:4173`·`:4178`·`:4183`·`:4194`·`:4199` 다섯 곳뿐이고 **전부 앞줄에서 `if (!providerRuntimeEnabled) return mcpCli.*`로 빠진다**(`:4172`·`:4177`·`:4182`·`:4193`·`:4198`). 즉 오늘 프로덕션에서 이 함수는 **호출자가 0개**다.
- **합치기(구현 형태를 못박는다 — `providerRuntimeEnabled` 분기).** `athena:plugin-approve`는 **형제 핸들러와 같은 모양**을 쓴다 — `if (!providerRuntimeEnabled) { /* apply 시퀀스를 직접 실행하고 results[]를 조립 */ } else { return runMcpMutation('plugin-batch', apply); }`. 분기는 **`main.js` 한 곳에만** 둔다. `plugin-proposal-registry.js`는 executor 주입만 아는 순수 모듈로 남는다(W2-3).
  - **왜 무조건 `runMcpMutation`을 부르면 안 되는가(치명).** 기본 빌드에서 그러면 승인이 `runMcpMutation`의 cold 분기(`main.js:2531-2554`)를 타고 `mcp-runtime-coordinator.js:96-134 runColdMutation`으로 들어간다. 그 경로는 ⑴ `coldRuntime.interruptAndTerminate`(`:100`) = `terminateColdLegacyRuntime`(`main.js:3540-3545`) → `abortConversationWork`(`:3521-3538`)로 **`activeLiveQuery.kill()`(`:3531`)을 부른다 — 플러그인을 승인할 때마다 사용자의 진행 중 대화가 죽는다.** 오늘 `handleMcpApprove`는 `mcpCli.approve`를 직접 부르므로 그런 일이 없다. ⑵ `apply()` 성공 뒤 `readSnapshot()`(`main.js:2537-2541` = `getLiveMcpConfig()` + `JSON.parse(fs.readFileSync(configPath))`)을 부르고, 그 파일이 없거나 깨지면 `persisted=true`인데도 `ok:false`를 돌려준다 — **설치가 실제로 끝났는데 화면에는 실패 배너가 뜬다**(원칙 4 정면 위반). 둘 다 오늘 없는 실패 경로의 신규 도입이자 기능 후퇴다.
  - **아래 두 항목은 런타임이 켜진 경우(`ATHENA_PROVIDER_RUNTIME`)에 한해 적용된다.** 기본 빌드에서는 `runMcpMutation`을 아예 타지 않으므로 무관하다.
    - **`handleMcpRegister`/`Approve`/`Revoke`/`AllowTool`/`Remove`를 `apply` 안에서 재사용하지 않는다.** 그 함수들 자신이 `runMcpMutation`을 부르므로(`main.js:4171-4200`), 런타임이 켜진 경우 바깥 mutate가 미해결인 채 안쪽 mutate가 `createSerialExecutor`(`mcp-runtime-coordinator.js:20-26`, `tail.then(task, task)`)의 같은 tail에 체인되면 **영구 교착**한다. **결론(`handleMcp*` 재사용 금지)은 두 빌드 모두에서 유지한다** — 기본 빌드에서도 그 함수들은 IPC 이벤트 인자(`e`)를 받는 모양이라 묶음 시퀀스에 부적합하다.
    - 인터럽트·중단·재기동(`main.js:2507-2523`의 `blockNewTurns` → `interruptAndDrain` → `fenceAndStop` → `startGeneration` → `unblockTurns`)이 **묶음 전체에 대해 한 번만** 돈다.
  - **`'plugin-batch'` kind는 두 빌드 모두에서 필요하다**(W2-2b). `mcp-runtime-coordinator.js:237`의 kind 검사는 `mutate()` 진입 첫 줄이라 **mode와 무관**하고(`:236-242`), `MUTATION_KINDS`(`:3-11`, 현행 7종)에 없으면 `Promise.reject(TypeError)`다. 런타임을 켠 빌드에서 이 1줄이 없으면 첫 승인이 `TypeError`로 죽는다.
  - **`stage_snippet`은 `mcpCli.stageSnippet`으로 직접 부른다**(W2-5) — 기존 IPC 핸들러(`main.js:4167-4169`)는 `runMcpMutation`을 **어느 빌드에서도** 타지 않아 런타임이 켜졌을 때 재기동이 어긋난다.
- **파일 영향.** `app/main.js:4209` 뒤 신규 `athena:plugin-approve` 핸들러(`providerRuntimeEnabled` 분기 + 배열 순회 + 별칭 게이트 — W2-4), `app/lib/main/mcp-runtime-coordinator.js:3-11`(kind 1줄), `app/lib/main/plugin-proposal-registry.js`(묶음 단위로 `proposal_id` 1회 소비 — 부분 소비 없음, executor 주입), `app/lib/plugin-proposal.js`(`actions` 배열 스키마·검증), `app/lib/plugin-canvas.js`(카드가 동작 N줄을 렌더).
- **실패 시 — 두 빌드의 계약을 따로 적는다.**
  - **기본 빌드(런타임 꺼짐, 상시 경로).** `apply` 반환 규약이 없다 — 시퀀스를 직접 돌며 `results:[{action, ok, error}]`를 조립하고, 첫 실패에서 멈춘 뒤 그대로 렌더러에 돌려준다. 예외를 밖으로 던지지 않는다.
  - **런타임 켜진 빌드.** 개별 동작 실패를 **예외나 `{ok:false}`로 올리지 않는다.** 시퀀스는 그 자리에서 멈추되 `apply`는 **`{ok:true, results:[{action, ok, error}]}`**를 돌려주고, 결과 턴이 그 배열을 읽어 `등록했습니다` / `허용은 실패했습니다 — <사유>` + `다시 시도` 칩을 적는다.
    - **왜 예외를 올리면 안 되는가.** `mcp-runtime-coordinator.js:178`의 `await apply()`는 `fenceAndStop`(`:162-166`) **뒤에** 돈다. `runMcpMutation`(`main.js:2558-2562`, cold 분기는 `:2546-2549`)은 `applyResult.ok !== true`이면 `throw`하므로 `:223` catch로 빠지고 `startGeneration`(`:187`)·`unblockTurns`(`:214`)가 **실행되지 않는다** — 상주 세션이 정지·차단된 채 남는다. 그러면 R3이 약속한 "성공한 것까지 결과 턴에 적고 `다시 시도` 칩"은 **죽은 채팅 위에서** 성립하지 않는다. 묶음은 실패 확률을 동작 수만큼 곱하므로 이 경로는 예외가 아니라 상시 경로다.
  - **롤백 없음은 `actions[]` 원소 *사이*에만 적용된다(R-2 반영).** 성공한 앞 동작을 뒤 실패 때문에 되돌리지 않는다 — 되돌리기도 레지스트리 변이라 또 한 번의 승인이 필요하기 때문이다. **예외 하나: install 서브사슬.** `stageSnippet → register → approve`는 오늘도 한 동작의 내부 단계이며, `approve`에서 실패하면 오늘처럼 `mcpCli.remove(alias)`로 보상한다(현행 `canvas.js:2714-2716`이 `pluginDiscardStaged(staged.staged)`를 부르고 그 함수 `:2768-2779`가 `athena:mcp-remove`를 돈다 — `:2771`). 보상을 빼면 **등록됐지만 승인되지 않은 행**이 캔버스에 남는다 — 사용자가 만든 적 없는 플러그인이 목록에 보이는 것이므로 `plugin-canvas.js:599-601`이 못박은 "가짜 행 금지"와 오늘 동작 대비 명백한 후퇴다.
- **08번 보드 표현 — "재시작 반영" 열은 런타임이 켜진 경우에만 뜬다(C-10).** 그 열이 뜰 때는 **묶음 뒤 한 번만** 뜨고(§W4 08열 4), 문구는 `플러그인이 바뀌어 대화를 다시 시작했습니다` + `방금 승인한 내용은 반영됐습니다`이다. 동작이 3개였어도 이 두 줄은 한 번이다. **기본 빌드에서는 이 두 줄을 쓰지 않는다** — `terminateColdLegacyRuntime`은 상주 세션(`liveChatSession`, `main.js:2096-2113`)을 재생성하지 않으므로 승인 뒤에도 게이트웨이는 낡은 레지스트리를 쥔다. 그 상태에서 `방금 승인한 내용은 반영됐습니다`를 그리면 **화면이 거짓을 말한다**(원칙 4 위반). 기본 빌드의 정직한 신호는 오늘 코드가 이미 가진 `canvas.js:2579 pluginRegistryChangedThisSession` → `:2591 restartRequired`이고 그 의미는 `:2576-2578` 주석 그대로 **"다음 실행부터 대화에 반영된다"**이다 — 06번 기존 "재시작" 상태와 같은 계열의 문구 `다음 실행부터 반영됩니다`를 쓴다.

---

## 7. 검증 절차 (정확한 명령)

**§7은 `bash`로 돈다 — POSIX `sh`가 아니다.** §0-0b는 §0 블록에 대해 "Bash 도구(POSIX `sh`)"라고 선언했지만, 아래 4b의 `diff <(grep …) <(grep …)`는 **프로세스 치환**이라 `bash` 전용 문법이다(`/tmp/…` 리다이렉트도 함께 쓴다). `sh`로 돌리면 `syntax error near unexpected token '('`로 죽는다. `bash`가 없는 셸에서 판정해야 하면 임시 파일 2개로 풀어 쓴다 — `grep -E "^(FAILED|ERROR)" baseline… | sort > /tmp/base-fails.txt` · `grep … now… | sort > /tmp/now-fails.txt` · `diff /tmp/base-fails.txt /tmp/now-fails.txt`. **또한 모든 명령을 서브셸 `( … )`로 감싼다.** `cd app && …`를 연달아 적으면 두 번째 줄이 이미 `app/` 안이라 실패하고 조용히 건너뛴다 — R7이 요구한 "2회 연속 통과"와 §7-4의 부분 실행이 그대로 무력화된다.

```bash
# 1) 앱 단위 — 판정은 §0-4의 baseline 대비 "신규 실패 0". 절대 건수 금지.
#    플레이키(R7) 대비 2회 연속 통과를 조건으로 한다. 실행 결과를 반드시 캡처한다.
( cd app && npm run test:unit ) > /tmp/app-unit-1.txt 2>&1
( cd app && npm run test:unit ) > /tmp/app-unit-2.txt 2>&1

#    A7 판정: baseline과 현재의 실패 목록·건수를 실제로 대조한다.
for f in .omc/state/baseline-app-test-unit.txt /tmp/app-unit-1.txt /tmp/app-unit-2.txt; do
  echo "== $f"; grep -E "^# (pass|fail)" "$f"; grep -E "^not ok" "$f" | sed 's/[0-9]\+//' | sort
done
#    → 두 실행 모두 baseline에 없던 `not ok` 줄이 0개(신규 실패 0), `# pass`는 baseline 이상.
#      두 실행의 `not ok` 집합이 다르면 그것이 R7의 플레이키다 — 이름을 §10에 적는다.

# 2) 플러그인 실왕복 (외부 npx/uvx 다운로드 발생, 네트워크 필요)
( cd app && npm run verify:plugins )
#    → app/captures/VERIFY-PLUGINS-REPORT.json 의 failures === 0
#    판정 주의: 이 명령은 npx/uvx로 upstream 서버를 실제로 내려받아 spawn하므로 **네트워크가 필요하다.**
#    오프라인이면 다운로드 단계에서 실패한다 — 그것은 코드 결함이 아니다. 네트워크가 되는
#    환경에서 다시 돌려 판정하고, 실패를 A7/A8의 "신규 실패"로 계상하지 않는다.

# 3) 렌더 계약 (Electron 필요)
( cd app && npm run verify )
#    → verify.js 플러그인 블록(1942-2137) 전 항목 통과

# 3b) 그래프 모드 회귀 (A10의 세 번째 하네스 — W3-6이 #chatModeHead를 넓히므로 함께 본다)
( cd app && node verify-graph-mode.js )
#    → :222 chatHeadVisible(그래프 모드) · :599·:602 chatHeadHidden(대화 모드 복귀) 둘 다 통과.
#      가시성 조건을 graphView || pluginView 로 넓혀도 두 단언은 살아남는다(실측).

# 4) 백엔드 — **순서를 지킨다(O-A4·O-C7): 먼저 좁혀 돌고, 전수는 W5 마지막에 딱 1회.**
#    4a) 좁힌 실행 — W1~W2 동안 반복하는 것은 이 줄뿐이다(수 초).
( cd backend && uv run pytest tests/mcp/test_plugin_tools.py tests/mcp/test_server.py -q )

#    4b) 전수 — W5의 마지막 단계에서 **한 번만** 돈다(1419초). 판정은 baseline 대비 "신규 실패 0".
( cd backend && uv run pytest -q ) > /tmp/backend-now.txt 2>&1
diff <(grep -E "^(FAILED|ERROR)" .omc/state/baseline-backend-pytest-tail.txt | sort) \
     <(grep -E "^(FAILED|ERROR)" /tmp/backend-now.txt | sort)
#    → diff에 `>` 줄(신규 실패)이 0개여야 한다. `N passed` 값은 baseline(2638) 이상.
#    주의 ①: baseline 파일은 tail만 보관돼 실패 목록이 비어 있다(§0-4b) — 판정은 성립하되 근거는 요약 줄이다.
#    주의 ②: 이 명령은 23분 39초가 걸린다(baseline 실측 1419초, O-11). 타임아웃을 넉넉히 잡고,
#            ralph 시간 예산을 위해 4a를 먼저 통과시킨 뒤에만 돈다.

# 5) 하드코딩 hex 게이트
( cd app && grep -nE "#[0-9a-fA-F]{6}" styles/plugin-canvas.css )   # 알파 틴트 외 0건

# 6) 직접 IPC 부재 게이트 (A3) — grep이 아니라 **두 개의 별개 단위 테스트**다(RC-7). grep을 안
#    쓰는 이유: lib/plugin-canvas.js는 window.athena 0건이고 athena:mcp- 3건(:6·:235·:966)은
#    전부 정당한 주석이라 게이트가 아무것도 재지 못한다.
#    6a) canvas.js의 **배선**은 소스 텍스트 단언으로 잰다 — canvas.js는 최상단에서
#        window.AthenaLib.*를 구조분해하는(:1-17) 최상위 스크립트라 require 불가이고
#        package.json:10 글롭에도 canvas.js 테스트가 없다. 즉 6b로는 잴 수 없다.
( cd app && node --test lib/plugin-proposal-boundary.test.js )
#    → fs.readFileSync(path.join(__dirname,'..','canvas.js'))로 소스를 읽어, GUI 진입 deps 6종
#      (onApproveInstall·onTogglePlugin·onRemovePlugin·onSavePermissions·onStageSnippet·
#      onApproveServer) 본문에 pluginInstallCatalogEntry·pluginSetEnabled·pluginRemove·
#      pluginSaveTools·pluginStageSnippet·pluginApproveStaged 호출이 없고 전부 onPropose로
#      간다를 단언. 형판 lib/raw-ui-boundary.test.js. lib/*.test.js 글롭이라 test:unit이 집는다.
#    6b) plugin-canvas.js **모듈 자체의 행동**은 스파이 deps로 잰다(6a를 대신하지 못한다).
( cd app && node --test lib/plugin-canvas.test.js )
#    → 클릭이 deps.onPropose를 부르고 6종 콜백을 부르지 않는다.

# 7) 앱 문구 3원칙 게이트 (O2) — 사용자에게 보이는 문자열에 내부용어가 새지 않는다
( cd app && grep -nE "(MCP|consent|IPC|proposal|registry|envelope|봉투)" \
  lib/plugin-proposal.js lib/plugin-canvas.js styles/plugin-canvas.css )
#    → 히트는 주석·클래스명·변수명만 허용. 화면에 그려지는 문자열 리터럴에 있으면 실패.
#    (설명문 금지·한국어 단위 위반은 grep으로 못 잡는다 → W5-4 PDF 검수에서 육안 확인)

# 7b) 모드 밖 폐기 문구 고정 (RC-A3·RC-4) — 폐기 사실과 맞는 문구만 남는다
( cd app && grep -rn "플러그인 모드에서 승인할 수 있습니다" chat.js canvas.js lib/ )   # 0건이어야 한다
( cd app && grep -rn "플러그인 모드에서 다시 요청합니다" chat.js lib/ )                # 1건 이상
#    → 08번 보드 5열·W5-4 검수 안건 ⑸와 같은 문자열인지 육안 대조.
```

**7-1. PDF 검수 게이트.** `B-2` 페이지 9장 전체를 `export_combined_pdf`로 내보내(용량 초과 시 분할 후 병합) 사용자에게 발송 → 검수 승인 회신을 받는다. 승인 없이는 ① 미완이다.

**7-2. 파리티 문서 확인.** `PAPER_APP_PARITY.md` 플러그인 섹션이 9행이고 전 행이 `적용`이며, 03·05 행의 소유 표면 문구가 정정 후 실앱과 일치하는지 육안 대조.

---

## 8. 확정 결정 (ralph는 질문할 수 없다 — 여기가 유일한 답이다)

**확정 1. 툴 이름은 `athena_plugin`이다.** 명세가 예시로 든 `athena__plugin_propose`를 쓰지 않는다. 형제 built-in 5종이 전부 단일 밑줄(`athena_routine`·`athena_brain`·`athena_nudge_guard`·`athena_backtest`·`athena_search`)이고, 이중 밑줄은 canvas 2종 전용이며(`server.py:70-71`), `__`는 `registry.py:17 QUALIFIED_NAME_SEPARATOR`의 별칭 구분자와 형태가 겹친다. 명세의 예시는 `예:`로 열려 있어 이 결정이 명세를 넓히지 않는다.

**확정 2. 액션 enum은 6종이다.** `install` · `allow_tools` · `revoke_tools` · `set_enabled` · `remove` · `stage_snippet`. 명세의 "5동작"은 **사람이 보는 동작 수**(설치 · 기능 허용/철회 · 켜기/끄기 · 삭제 · 스니펫 등록)이고, 허용과 철회는 반대 방향이라 한 액션에 불리언으로 접으면 감사 로그에서 구분이 사라진다. 켜기/끄기는 같은 축의 값이므로 `set_enabled(enabled: bool)` 하나로 접는다. `test_plugin_tools.py`가 이 **6**을 고정한다(추가 시 실패). **`stage_snippet`만 예외 규칙을 갖는다**(§2.4 PM-1 완화 2 · C-7): 봉투 `target`은 `null`, 게이트는 스니펫 파싱 후 전 별칭 차단 검사, 파싱 불가·별칭 0개·2개 이상은 거부.

**확정 3. 봉투는 `actions` 배열을 갖는다.** 길이 1이 기본이고, 한 카드가 여러 동작을 담을 수 있다(§6 R3 결정 — 재기동 합치기). 각 원소는 `{action, target, features?, enabled?, snippet?}`. **툴 *입력* 스키마도 같은 모양이다**(`{actions:[...], reason}`, `actions` `minItems` 1 — C-8 · W1-1). 봉투는 여기에 `proposal_id` · `source` · `revision`(`null` 허용 — R-4)을 더한다.

**확정 4. 명세 ② 검증은 W5-1 + W5-2로 나눠 만족시킨다.** `verify:plugins`가 5동작 사슬과 거부 시 불변을, `verify`가 GUI 합류 렌더를 잰다. 두 명령 모두 완료 조건이므로 명세를 좁히지 않는다(근거는 §4 W5 하단).

**확정 5. 07번 보드는 1장 안 5열이다.** 동작마다 1장이면 페이지가 13장이 되어 검수 부담과 밀도 예산을 함께 깬다. 명세가 두 형식을 모두 허용한다(`상태 전개 보드 관례: 동작마다 1장 또는 1장 안 5열`).

**확정 6. 보드 44와 35·38은 공존한다.** 44의 "채팅은 절대 접히지 않는다 · 모드는 캔버스만 바꾼다"는 **한 창 안의 규칙**이고, 35·38의 "모드가 대화의 경계"는 **창을 나누는 규칙**이다. 정합 문장: *창은 모드별로 나뉘고, 창 안에서 채팅은 접히지 않으며 모드 전환은 그 창의 캔버스만 바꾼다.* 이 계획은 44를 고치지 않는다 — `chat.js:1578-1581`의 인용도 그대로 둔다. 03번 보드에서 지우는 것은 44의 원칙이 아니라 "플러그인은 **채팅을 유지한 채 캔버스만 바뀌는 네 번째 모드**"라는 **위치 규정**뿐이다.

**확정 7. 확인하지 못한 것과 ralph의 대처.** ⑴ Paper 보드 6장의 실제 노드 구조·현재 문구를 직접 보지 못했다(계획 단계에서 Paper 호출 금지) — 보드 id·치수는 명세 Technical Context 인용이다. **대처: W4 첫 호출인 `get_basic_info`로 6장의 id와 치수를 대조하고, 어긋나면 계획의 좌표·id를 그 실측으로 교체한 뒤 진행한다**(중단하지 않는다). §W4의 "지울 문구"가 보드에 없으면 `find_nodes`로 가장 가까운 문자열을 찾아 교체하고, 없으면 새 문구만 넣는다. ⑵ R7 플레이키 테스트의 정체는 미확정 — 2회 연속 통과 조건으로 흡수한다. 다만 §0-4의 기존 baseline은 app 1946/1946 **fail 0**으로 떴으므로 그 커밋에서는 재현되지 않았다. ⑶ 41·43 보드는 인프라 트랙 소유라 읽지 않았다 — 09번 보드는 §5 H4~H6의 폴백 계약만 그린다.

**확정 8. 승인 실행은 `providerRuntimeEnabled`로 분기하고, 런타임 경로의 mutation kind는 `'plugin-batch'`다.** ⑴ **분기(형제와 같은 모양 — R-1):** `if (!providerRuntimeEnabled) { apply 시퀀스를 직접 실행 } else { runMcpMutation('plugin-batch', apply) }`. `app/main.js:100 PROVIDER_RUNTIME_DEFAULT = false`이므로 **기본 빌드는 앞 가지를 탄다** — 무조건 `runMcpMutation`을 부르면 `runColdMutation`(`mcp-runtime-coordinator.js:96-134`)이 `activeLiveQuery.kill()`(`main.js:3531`)로 진행 중 대화를 죽이고, `readSnapshot()` 실패 시 설치가 끝났는데도 실패 배너를 띄운다(근거 전문은 §6 R3). 분기는 `main.js` 한 곳에만 두고 `plugin-proposal-registry.js`는 순수 모듈로 남는다. ⑵ **kind:** `app/lib/main/mcp-runtime-coordinator.js:3-11`의 `MUTATION_KINDS`에 `'plugin-batch'` 1줄을 추가한다(W2-2b) — `:237`의 kind 검사는 `mutate()` 진입 첫 줄이라 mode와 무관하다. 기존 7종 중 어느 것도 재사용하지 않는다(감사·로그가 묶음을 단일 동작으로 오독한다). ⑶ 어느 가지든 `mcpCli.*`를 직접 이어 붙이고 `handleMcp*`를 재사용하지 않는다. ⑷ `probe`는 시퀀스 **밖에서**, 승인 반환 뒤에 부른다(W2-3).

**확정 9. 스니펫 경로도 이번 범위에 포함한다.** 허브의 `+ 서버 추가` 시트(`plugin-canvas.js:271-272 onStageSnippet` · `:290-291 onApproveServer`)도 `onPropose`로 전환한다. 배제하지 않는 이유: 확정 2의 6번째 액션이 `stage_snippet`이고 07번 보드 5번째 열이 `스니펫 등록`이므로, 배제하면 명세 ②의 "GUI 버튼 클릭이 제안 카드로 합류"가 5동작 중 4동작에서만 참이 된다. `onDiscardStaged`(`:304-305`)는 상태를 안 바꾸므로 전환 대상이 아니다. 설정 카드(`settings-cards.js:997`)는 명세가 "변경 없음"으로 두므로 그대로 남는다(R8).

**확정 10. 승인은 봉투 전체를 받아 원자적으로 등록·소비한다.** `athena:plugin-approve`의 인자는 `proposal_id`가 아니라 봉투 전체다(§2.3 축 2 결정문). GUI 클릭은 사전 등록 왕복 없이 카드를 즉시 그리고, 메인은 승인 시점에 "미등록이면 등록하고 즉시 소비, 이미 소비됐으면 거부"를 한 번에 처리한다. **pending 등록은 이와 별개의 비차단 경로이고, 등록 시점은 `athena:plugin-noted` 하나로 일원화한다(RC-1).** **모델 경로도 GUI 경로도** `canvas.js`가 **렌더러의 모드 게이트를 통과한 뒤 카드를 그리고 나서** 보내는 단방향 `athena:plugin-noted`로만 등록된다 — 메인은 push 직전에 등록하지 않는다(반복 5의 "모델 경로는 push 직전" 문장을 폐기했다). **그렇게 해야 W3-4 ⑴의 "모드 밖 폐기"가 두 경로를 똑같이 막는다** — 메인이 먼저 등록하면 폐기했다고 알린 제안이 W3-4 ⑷ 복원으로 부활해 08번 보드 5열의 "캔버스에 아무 카드도 없다"와 확정 문구 `플러그인 모드에서 다시 요청합니다`가 동시에 거짓이 된다(§2.1 원칙 4 위반). 승인 인자가 봉투 전체이므로 pending은 **복원 전용**이고, 등록을 늦춰도 승인 정확성 손실은 0이다. send는 응답을 기다리지 않아 렌더를 게이트하지 않으므로 0ms 반응(D3)이 그대로 살고, approve·reject가 pending에서 제거하며 `athena:plugin-pending`이 `[미해결 봉투, 현재 revision]`을 돌려준다. **이 등록 시점이 없으면 `athena:plugin-pending`과 W3-4 ⑷ 복원이 영원히 빈 배열만 도는 죽은 경로가 되고 ①-09의 "제안 대기 카드가 창 복원 시 그대로"가 거짓이 된다.** **그 대가로 메인 경로가 별칭 게이트를 복제하되, 게이트 코드의 거처는 `lib/main/plugin-proposal-registry.js` 하나다**(§2.4 PM-1 완화 3 · W2-4 ⑴ · RC-3 — 봉투 전체를 받는 순간 `source`는 자기 신고가 되므로 권위 검증이 승인 경로에 있어야 하고, `verify-plugins.js`가 그 경로를 그대로 재현하려면 게이트가 `main.js` 밖 순수 모듈에 있어야 한다).

---

## 9. ADR — 플러그인 제안 봉투의 소유와 전달

**Decision.** 플러그인 제안을 새 게이트웨이 built-in 툴 **`athena_plugin`**(비영속·읽기 전용)이 내고, 그 결과를 `tool_result` 스크레이핑으로 메인 프로세스가 받아 **`app/lib/main/plugin-proposal-registry.js`가 봉투의 생애를 소유**하며 — 1회용 소비 맵 · 실행 순서 · **pending 맵**(등록·조회·제거) · **별칭 게이트 4종**의 네 가지가 이 모듈 하나에 있다(RC-A1·RC-3) — 렌더러는 구독해서 승인 카드를 그리기만 한다. GUI 버튼은 같은 순수 빌더(`app/lib/plugin-proposal.js`)로 봉투를 **로컬 합성**해 카드를 즉시 그린다. **두 경로 모두 카드를 그린 뒤 비차단 `athena:plugin-noted` 한 지점으로만** 같은 레지스트리의 pending 맵에 들어간다(RC-1 — 메인은 push 직전에 등록하지 않는다). → **A + D + C1**.

**Drivers.** D1 보안 게이트 불변(`server.py:421-424` 호출별 재확인 · `consent.py:361-369` 감사 4필드) · D2 `mode` 인프라 부재 우회(`lib/main/conversations.js:63-69`에 `mode` 없음) · D3 GUI 버튼의 지연·결정성(`chat.js:2489-2490` "LLM 재스폰 없이").

**Alternatives considered.**

| 안 | 요지 | 장점 | 단점 / 판정 |
|---|---|---|---|
| **A** 새 built-in 툴 + `tool_result` 스크레이핑 | `nudge_guard_tools.py` 5단 배선 복제 | 선례가 완결돼 있음 · 백엔드 HTTP/WS 불필요 · 비영속 · 툴 정책 변경 0 | 봉투가 턴 수명에 묶인다(`chat.js:1185` abortToken 가드) → **D로 보완해 채택** |
| **B** 캔버스 사이드채널(`athena__render_canvas` + `plugin_proposal` canvas_type) | 캔버스 push 경로 재사용 | 카드를 캔버스에 직접 띄우는 배관이 이미 있음 | **기각 ⑴** 그 경로는 `plan_token`/`data` 게이트 전용이고(`server.py:344-361`) manifest가 canvas_type을 이긴다(`canvas_data.py:267-288`) — 플러그인 제안엔 manifest도 operation_ref도 없다. **⑵** 키움 백엔드 HTTP+WS 가용성에 종속된다. *(통합 카드 422 게이트는 기각 사유가 아니다 — `canvas_push.py:892`의 교집합이 비면 블록 전체를 건너뛴다.)* |
| **C1** GUI 클릭이 봉투를 로컬 합성 | 순수 빌더 재사용 | 지연 0 · 결정적 · 단위 테스트 가능 · 선례 부합 | 봉투 스키마를 앱·백엔드 양쪽이 지켜야 함 → **채택**(A8 계약 테스트로 봉인) |
| **C2** GUI 클릭이 모델에게 제안을 요청 | 입구가 문자 그대로 하나 | 개념적 단순함 | **기각** — D3 정면 충돌(수 초 지연·오제안·백엔드 다운 시 무반응). 현행 버튼은 즉시 시트를 연다(`plugin-canvas.js:310-317`) |
| **D** 봉투를 메인 프로세스가 소유, 렌더러는 구독 | `plugin-proposal-registry.js` | A의 턴 수명 문제 소멸 · PM-2(중복 실행)·PM-3(stale)·H6(보관, **pending 맵 — 등록 시점이 RC-A1로 명문화돼 실제로 이 모듈에 산다**)·PM-1(별칭 게이트, RC-3)이 한 모듈에 모임 · 두 입구가 물리적으로 한 곳에서 합류 | 메인에 상태 보유자 1개 추가 · 앱 종료 시 미해결 제안 소실 → **A와 함께 채택** |
| **E** 기존 `athena_routine` draft 채널 확장 | 신규 툴 0 | 카드 문법 재사용 | **기각** — draft는 백엔드에 **영속**하고(`chat.js:2496 refreshRoutineDrafts()`) 제안은 비영속이어야 한다(원칙 3). 루틴·플러그인 두 도메인이 한 `_ALLOWED_ACTIONS`를 겸하면 원칙 1의 "가장 엄격한 자리" 보증이 깨진다 |

**Why chosen.** A는 선례를 그대로 복제할 수 있는 유일한 전달 경로이고(원칙 2), D는 A의 유일한 약점인 턴 수명을 없애면서 세 개의 프리모템(PM-2·PM-3·H6)을 **한 모듈**로 닫는다. C1은 "두 입구, 한 게이트"를 코드 수준에서 강제한다 — 두 경로가 같은 빌더·같은 검증기·**같은 승인 소비점**(`athena:plugin-approve`의 원자 등록·소비, 확정 10)을 지나므로 합류가 관례가 아니라 구조다. 사전 등록 왕복을 요구하지 않기에 GUI 클릭의 0ms 반응(D3)도 함께 지킨다. B·E는 표면 유사성만 같고 게이트·의존성·영속성이 어긋난다.

**Consequences.** ⑴ 백엔드 +1 모듈(`plugin_tools.py` ~180줄), 배선 2줄. ⑵ 앱 +2 순수 모듈(`plugin-proposal.js`·`plugin-proposal-registry.js` — 후자는 executor **8종** 주입식이라 `main.js`·Electron에 의존하지 않는다), IPC 채널 **+5**(ON 1 `plugin-proposed` + SEND 1 `plugin-noted`(**두 경로 공통**의 pending 등록, 비차단 — RC-1) + INVOKE 3: approve·reject·pending), `MUTATION_KINDS` +1(`'plugin-batch'`), `plugin-canvas.js` 공개 API +1(`setProposals`), **`shell.html` 스크립트 태그 +2**(`lib/plugin-mode-adapter.js`·`lib/plugin-proposal.js` — 반드시 `canvas.js`(`:485`)보다 앞, RC-6). ⑶ 제안은 **프로세스 수명**이다 — 앱을 껐다 켜면 사라지고, 그 경계를 09번 보드가 문장으로 알린다. ⑷ built-in이 consent 게이트를 우회하는 성질(`server.py:344-414`)은 남는다 → 독스트링 경고 + enum 6종 고정 테스트로 봉인. ⑸ 승인 1건이 여러 동작을 담으면 재기동이 한 번으로 합쳐진다(§6 R3 결정). ⑹ `#chatModeHead`가 모드 2종(그래프·플러그인)을 섬기게 되어, 그래프 문구는 회귀 단언으로 고정된다(A10) — 제약 "타 모드 불간섭"의 **승인된 예외**(사용자 결정 2026-09-03, §1 · RC-4). 롤백이 필요해지면 §1의 롤백 문단(플러그인 소유 `#pluginChatHead`)대로만 되돌린다. ⑺ **승인 실행이 `providerRuntimeEnabled`로 갈린다**(확정 8) — 기본 빌드는 `mcpCli.*`를 직접 잇는 오늘과 같은 경로이고, 런타임을 켠 빌드만 `runMcpMutation('plugin-batch')`를 탄다. 그 결과 08번 보드 "재시작 반영" 열도 런타임이 켜진 경우에만 뜨며, 기본 빌드는 오늘의 `restartRequired`(`canvas.js:2591`) 계열 문구를 쓴다. ⑻ **승인 경로가 별칭 게이트를 복제하고, 그 코드는 `plugin-proposal-registry.js` 한 곳에 산다**(확정 10 · RC-3) — `lib/plugin-catalog`의 `CATALOG`를 `main.js`가 그 모듈에 주입하고(`verify-plugins.js:24` 선례로 node require 가능), 하네스는 같은 모듈에 직접 주입해 **같은 게이트를 지난다**. 남는 중복은 **백엔드 제안 게이트 ↔ 앱 승인 게이트 두 곳**이며(세 곳이 아니다), 그 중복이 "봉투 전체를 인자로 받는다"의 대가다. ⑼ executor 계약이 **8종**(+`probe`·`list`)이 되어 `verify-plugins.js` 하네스가 5동작 사슬을 끝까지 잰다.

**Follow-ups.** ⑴ 인프라 트랙이 `mode='plugin'` 창을 내놓으면 `plugin-mode-adapter.js` 내부만 교체(H1·H3·H5·H7). ⑵ `settings-cards.js:997`의 직접 삭제 경로를 승인 게이트로 합칠지는 별도 판단(명세는 설정 카드를 "변경 없음"으로 둔다). ⑶ 앱 종료를 넘겨 제안을 살릴 필요가 생기면 그때 영속 저장소를 도입한다 — 지금은 도입하지 않는다.

---

## 10. 변경 이력

### 10.1 반복 1 검토 → 반복 2 (요약)

C1 §0 실행 규율(워크트리 (P) 주 경로·설치 3단계·`.omc` 이관·baseline·금지 명령·fnm PATH·(F) 폴백) 신설 · C2 절대 테스트 건수를 A7/A8의 baseline 대비로 전환하고 §7의 두 수치 제거 · C3 "실행 없음"을 변이 불변량으로 재정의(원칙 1 + §3.1 ③ 각주 + R5) · C4 W3-6 신설(`shell.html:296-299`·`controller.js:302` + A10 3종 회귀 단언) · C5 모드 이벤트 발명 철회(`canvasRegion.dataset.mode` 동기 읽기, 모드 밖 제안은 폐기 + 한 줄 결과 턴) · C6 PM-3 배선 2줄을 실측 행 번호로 확정 · C7 `source` 필수 필드와 카드 라벨 2종 · C8 W5-1을 5동작 × 3단언으로 재작성 + 명세 ② 충족 논거 · C9 W5-2를 "신규가 아니라 개정"으로 재작성 · C10 §8을 확정 7개로 재작성(질문형 0) · C11 W4 전면 재작성(호출 순서·격자 좌표·정확 문구) · C12 §6 R3 결정 신설(묶음 승인 + 재기동 합치기) · A2 액션 이름 유지 + IPC 비호출 못박음 · A4 §9 ADR 전면 재작성(옵션 D·E 추가) · A9 W0 3훅 축소 · A8·A10 교차 언어 픽스처 계약과 `dispatch` 시그니처 · A11·A12 PM-2 에폭 신호 축소 + PM-4 신설 · A6·A7·A13 근거·행 번호 교정 · O1·O2·O3 순서 규칙·문구 grep·에폭 축소.

### 10.2 반복 2 검토 → 반복 3 (요약)

RC-1 §6 R3 "합치기" 재작성(`runMcpMutation('plugin-batch', apply)` 1회 + `mcpCli.*` 직접, `handleMcp*` 재사용 금지) + **W2-2b 신설**(`MUTATION_KINDS`에 `'plugin-batch'`) · RC-2 실패 계약을 `{ok:true, results:[]}`로 고정 · RC-3 `setProposals(list,{revision})` 공개 API + 캔버스는 모듈 스코프 구독 + `athena:plugin-pending` 채널 · RC-4 죽은 grep 게이트 폐기 → `canvas.js` deps 6종 단위 단언 · RC-5 스니펫 경로 포함(확정 9) · RC-6 W2-5 신설(`stage_snippet`의 재기동 이탈) · RC-7 모드 판단 주체 = 렌더러 · RC-8 인용 5건 교정(`registry.py:224-230`·`PAPER_APP_PARITY.md:96`·`verify.js:1942-2137`·`plugin-canvas.js:599-601`) · RC-9 레지스트리 모듈 executor 주입 계약 · RC-10 §7 전체 서브셸화 + baseline 대조 명령 · RC-11 15번째 단언(`subtitle`) 폐기 사유 · RC-12 정정 보드 치수 명시 · RC-13 렌더 시점·권위 경계 결정문 + 확정 10 · Optional 17건(OI-1~OI-10) 전부 반영 · **계획이 추가 발견**: §0-5 행 번호 표류(워크트리 오프셋 4파일).

### 10.3 반복 3 검토 → 반복 4

| 항목 | 처리 |
|---|---|
| **인용 5건** (A) | **⚠ 읽는 법 — 이 칸의 화살표 왼쪽 값은 전부 「옛 값 — 본문에 없음」이다.** 반복 3에서 교정돼 계획 본문 어디에도 남아 있지 않으므로, 독립 검증이 이 칸의 왼쪽 값을 본문 오류로 계상하면 오탐이다(반복 4·5·6에서 같은 오탐이 반복됐다 — grep으로 재확인 가능). **반영** — ⑴ `nudge_guard_tools.py:40`(옛 값 — 본문에 없음) → **`:41`**(`_TIMEOUT_SECONDS = 15.0`; W1-1·O-1) ⑵ `plugin-canvas.js:203-234`(옛 값 — 본문에 없음) → **`:203-231`**(PM-4·O-2) ⑶ `mcp-cli.js:139-151`/함수 `:153`(둘 다 옛 값 — 본문에 없음) → **주석 `:139-150` · 함수 `:152`**(W2-5·O-3) ⑷ **정정 후 값(반복 5에서 교체 — RC-A4·RC-5. 옛 값 `plugin-canvas.js:598-600`·`registry.py:178-185`·`verify.js:1942-2110`은 전부 틀렸고 **본문에 없다**):** `plugin-canvas.js:599-601`(“가짜 행 금지” 주석; `:598`은 빈 줄이고 대상 함수 `approveInstall`은 `:602`) · `registry.py:178-182`(`RegistrySnapshot` — `:178` 데코레이터 · `:179` class · `:180-182` 필드) / `:185-189`(별개 함수 `default_registry_path()`) / `:224-230`(`_payload`, `"revision"` 키는 `:227`) · `verify.js:1942-2137`(`:2110`은 `badges` 단언 한가운데이고 블록의 끝은 `:2137` `pluginProbeFailure.emptyCopy`) ⑸ §2.3 축 1 (A)의 `server.py:757`(옛 값 — 본문에 없음) → **`:761`**(W1-3과 일치 · O-4) ⑹ `main.js:2508-2524`(옛 값 — 본문에 없음) → **`:2507-2523`**, `controller.js:271-305`(옛 값 — 본문에 없음) → **`:271-303`**(O-5) |
| **R-1** (A·C 공통) `providerRuntimeEnabled` 분기 | **반영** — §6 R3에 실측 문단 신설(`main.js:100-101` · `runMcpMutation` 정의 `:2529` · 호출자 5곳 `:4173`·`:4178`·`:4183`·`:4194`·`:4199`가 전부 `:4172`·`:4177`·`:4182`·`:4193`·`:4198`에서 조기 반환 = **기본 빌드 호출자 0**). 승인 핸들러를 형제와 같은 `if (!providerRuntimeEnabled) {직접 실행} else {runMcpMutation('plugin-batch', apply)}`로 못박고, 무조건 호출의 두 피해(`runColdMutation` `:96-134` → `terminateColdLegacyRuntime` `main.js:3540-3545` → `abortConversationWork` `:3521-3538` → `activeLiveQuery.kill()` `:3531`로 **진행 중 대화가 죽는다** / `readSnapshot()` `main.js:2537-2541` 실패 시 **설치 성공인데 실패 배너**)를 근거로 기록. W2-5의 "stage-snippet 핸들러만"을 "기본 빌드에서는 아무 핸들러도"로 교정. 교착·실패 계약 근거는 "런타임이 켜진 경우에 한해"로 한정하되 `handleMcp*` 재사용 금지 결론은 유지. W2-2b는 kind 검사가 mode 무관(`:236-242`)이므로 그대로. §8 확정 8 재작성 |
| **R-2** (A·C 공통) executor 계약·보상 | **반영** — W2-3의 executor를 **8종**으로 확장(`+probe`·`+list`). `probe` 호출 형태 `mcpCli.probe(alias, mcpEnv.buildEnvOverrides(alias))` 2인자 실측(`main.js:4186-4190`), **`apply` 밖·승인 반환 뒤** 호출(펜스 오염 방지, `mcp-runtime-coordinator.js:162-178`). `list`는 PM-2 완화 ⑶·PM-3 대조가 요구. "롤백 없음"을 **`actions[]` 원소 사이로만** 좁히고 **install 서브사슬 보상**을 명문화(`canvas.js:2714-2716` → `pluginDiscardStaged` `:2768-2779`, IPC `:2771`). W5-1에 단언 ⑷ "install 실패 시 미승인 행이 남지 않는다" 추가 |
| **R-3** (A·C 공통) §0 멱등 · baseline 재사용 | **반영** — §0-0 신설(실측: 워크트리·브랜치·`node_modules/electron/dist`·`.venv`·`core.hooksPath`·명세 모두 **이미 존재**, 빈 것은 `.omc/plans/` 하나). `git worktree add`·`npm install`·`node install.js`·`uv sync`·`git config`를 전부 조건부로 전환, §0-2의 계획 복사만 무조건. §0-4는 기존 baseline(`baseline.json` app 1946/1946 · backend 2638 passed/5 skipped · **1419초**) **재사용**으로 재작성하고 재수집 금지. §7-1·§7-4의 판정 경로를 실제 파일명 `.omc/state/baseline-app-test-unit.txt`·`baseline-backend-pytest-tail.txt`로 교체. §0-4b에 backend baseline이 **tail만**이라 실패 목록이 없다는 한계 명시 |
| **R-4** (A·C 공통) GUI 봉투의 `revision` | **반영** — §2.3 축 2 결정문 ⑴에 출처 한 줄(`pluginRefresh()` `canvas.js:2581-2599`가 `list()`의 `revision`을 보관 → `buildProposal`에 전달). W3-1 시그니처를 **`buildProposal(action, target, features, reason, revision)`**로 교정. `null`일 때의 규약(=`validateProposal` 통과, `isProposalStale` 판정 안 함, 승인 직전 메인이 채움) 확정. W3-3에 보관 1줄 |
| **R-5** (A·C 공통) `registry.json` 별칭 | **반영** — §2.1 원칙 3에 실경로 확정 문단 신설(`~/.athena/mcp_servers.json` — `registry.py:185-189` · `mcp-cli.js:24-25`; consent는 `mcp-cli.js:28-33`; `ATHENA_MCP_REGISTRY_PATH` 오버라이드). A2·§3.1 ③·§2.5 단위(백엔드)·W5-1 ⑵가 그 경로와 환경변수(선례 `verify-plugins.js:18-19`)를 쓰도록 교정. **O-12도 함께** — A2 헤드라인을 "소비자 두 파일에 대해 쓰기 0회"로 좁힘(락 파일 `.mcp_servers.json.lock` 제외) |
| **R-6** (A·C 공통) 메인 승인 게이트 | **반영** — §2.4 PM-1 완화를 4항 구조로 재작성하고 **"권위 검증은 메인, 렌더러는 UX용 선반영"**으로 문구 교체. W2-4에 게이트 4종(차단 별칭 · `install`→`CATALOG` · 4동작→`mcpCli.list()` · `stage_snippet`→C-7 규칙)과 실패 시 **실행 없이 `{ok:false}`**를 명시. `lib/plugin-catalog`가 node에서 require 가능함을 `verify-plugins.js:24`로 근거. 테스트 1건 추가(차단 별칭 봉투는 executor 0회) |
| **C-7** (C) `stage_snippet` 게이트·`target` | **반영** — PM-1 완화 2로 결정: 봉투 `target`은 **`null`** + `snippet`만, 카드 제목은 `직접 등록`, 게이트는 **파싱 후 전 별칭 차단 검사**, 파싱 불가·별칭 0개·2개 이상은 **거부**. `test_plugin_tools.py`에 `brain` 선언 스니펫 차단 1건 추가. §8 확정 2에도 예외 규칙 한 줄 |
| **C-8** (C) `_INPUT_SCHEMA` | **반영** — W1-1에 툴 입력 스키마 항목 신설: 입력도 `{actions:[{action,target,features?,enabled?,snippet?}], reason}`, `required:["actions"]`, `minItems: 1`. 형제 `nudge_guard_tools`가 `action` **단수**라 형판을 그대로 베끼면 `step.input.actions[]`가 `undefined`가 되어 **조용히 전 기능이 죽는다**는 경고와 근거(`main.js:2176`)를 병기. §2.5 계약 층 픽스처를 `{envelope, tool_input}` 두 키로 확장. W2-1에 상호 참조 |
| **C-9** (C) A5 검증 가능성 | **반영((가)안)** — A5를 **분리 단언**으로 좁힘: `verify.js`는 `#pluginCanvas` 하위 카드(양성)와 `#history` 제안 턴 0건(음성)만 잰다. **양성 제안-턴 렌더는 `chat.js` 순수 렌더 함수의 `node --test`로 이관**(근거: `chat.js:1184-1188`이 살아 있는 턴 클로저 안에서만 구독하므로 `verify.js:833` 주입에 리스너가 없다). 구독 구조는 바꾸지 않는다(PM-3·H6 보호). W5-2의 "신설 6"을 **"신설 7"**로 다시 적음 |
| **C-10** (C) 08번 "재시작 반영" 문구 | **반영** — W4 08번 4열을 두 변형으로 재작성: 런타임 켜짐 = 기존 두 줄 · **기본 빌드 = `다음 실행부터 반영됩니다`**(오늘 `canvas.js:2576-2578` 주석 · `:2579 pluginRegistryChangedThisSession` → `:2591 restartRequired`의 정직한 의미). §6 R3 마지막 문단에 같은 조건 명시. W5-2 신설 단언 ⑺로 회귀 고정("기본 빌드에서 결과 턴이 `반영됐습니다`를 주장하지 않는다") |
| **Optional 14건 (O-1~O-14) — 전부 반영** | O-1~O-5 인용 정정(위 "인용 5건" 행) · **O-6** W0-2에 `currentMode()` 폴백(`undefined`는 플러그인 모드가 아니다) · **O-7** 승인 실행 쪽 감사를 **액션마다 1줄** `_audit_log("plugin").record(alias, f"plugin:{action}", success)`(W1-1) · **O-8** W5-4 검수 안건 ⑶ 신설(`verify.js:2104` subtitle 폐기를 사용자 판단으로) · **O-9** §1에 "타 모드 불간섭의 유일한 승인된 예외 = W3-6" 선언 + ADR Consequences ⑹ · **O-10** §5 H6에 "어댑터는 선언만, 구현은 메인"(실질 2훅) · **O-11** §7-4에 소요 1419초(23분 39초) 주석 · **O-12** A2를 "소비자 두 파일" 범위로 정밀화 · **O-13** §0-4c에 명세 수치 `(기준 2,015)`·`(기준 2,714 passed / 5 skipped)`를 A7/A8로 대체했음을 각주로 명시 · **O-14** §0-0b에 "§0 블록은 Bash 도구에서 돈다"는 셸 전제 + PowerShell 대응 |

**반복 4 — 반박(contested) 없음.** 반복 3의 REQUIRED 11건(Architect 6 · Critic 8, 중복 3건 병합)과 Optional 14건을 모두 반영했다. 인용 5건도 파일을 열어 재확인했고, 그중 3건(`plugin-canvas.js:599-601` · `registry.py:224-230` · `verify.js:1942-2137`)은 검토자 지적대로 **이미 §10.2에서 정정된 값이 맞아** 추가 변경이 없었다.

**반복 4에서 검증하지 못한 것.** ⑴ Paper 보드 6장의 실제 노드 구조·현재 문구·아트보드 치수 — 계획 단계에서 Paper MCP 호출이 금지돼 있다(확정 7의 대처와 RC-12의 `get_basic_info` 실측 절차로 넘긴다). ⑵ R7 플레이키 테스트의 정체 — 기존 baseline은 fail 0이므로 그 커밋에서는 재현되지 않았다(§7-1의 두 실행 대조가 이름을 드러내게 했다).

### 10.4 반복 4 검토 → 반복 5

**⚠ 읽는 법(§10.3과 동일) — 이 표의 화살표 왼쪽 값과 「옛 값」으로 표기된 인용은 전부 「옛 값 — 본문에 없음」이다.** 해당 반복에서 교정돼 계획 본문 어디에도 남아 있지 않으므로, 독립 검증이 이 표의 옛 행 번호를 본문 오류로 계상하면 오탐이다(grep으로 재확인 가능).

| 항목 | 처리 |
|---|---|
| **RC-A1 · RC-1** pending 등록 시점 | **반영** — 계획 전체에 등록 시점이 없어 `athena:plugin-pending`과 W3-4 ⑷ 복원이 죽은 경로였다. ⑴ W2-3 소유 항목에 **pending 맵(`proposal_id → {봉투, 도착 시각}`)**을 추가 ⑵ W2-1에 "push **직전** 등록"(모델 경로) ⑶ W3-4 ⑴에 "카드를 그린 **뒤** 비차단 `athena:plugin-noted` send"(GUI 경로 — 렌더를 게이트하지 않아 확정 10의 0ms·D3 근거 유지) + W2-2에 SEND 채널 1줄 + W2-4에 `ipcMain.on` 1개 ⑷ approve·reject가 pending에서 제거하고 `athena:plugin-pending`은 `[미해결 봉투, 현재 revision]` 반환 ⑸ §2.5 단위(앱·메인)와 W2-3 검증 칸에 왕복 테스트 1건(`등록 → 조회 → 승인 → 사라짐`). §8 확정 10 · §9 ADR Decision·D행·Consequences ⑵(IPC **+5**)도 함께 갱신 |
| **RC-A2 · RC-2** 카드 억제 주체 | **반영** — 카드를 만드는 것은 `canvas.js`의 모듈 스코프 구독이므로 게이트도 거기로 확정했다. W3-4 ⑴에 "`setProposals` 호출 **전** `currentMode()` 확인 → `'plugin'`이 아니면 봉투 폐기, pending에도 넣지 않음(`plugin-noted` 미전송)" 한 줄, W0 결정문의 "`chat.js`가 … 승인 카드를 만들지 않고"를 같은 문장으로 교체, `chat.js`의 몫은 **한 줄 결과 턴**만으로 좁힘(W3-4 ⑶). 음성 단언은 §2.5 단위(앱·렌더)에 추가(O-A2·O-C5 동시 처리) |
| **RC-A3 · RC-4** 모드 밖 폐기 문구 | **반영** — `플러그인 모드에서 승인할 수 있습니다` → **`플러그인 모드에서 다시 요청합니다`**(폐기 결정과 일치. 옛 문구는 §2.1 원칙 4 위반이자 C-10에서 스스로 금지한 거짓 약속과 같은 종류였다). W4 08번 보드를 4열 → **5열**로 늘려 "모드 밖 폐기" 칸 신설, W5-4 검수 안건 **⑸**로 문구 승인 상정, §7에 **7b 문구 고정 게이트**(옛 문자열 0건 · 새 문자열 1건 이상) 추가 |
| **RC-A4 · RC-5** §10.3 ⑷ 인용 이력 | **반영** — "RC-8이 이미 정정한 값이 맞음(변경 없음)"을 **정정 후 값**으로 교체: `plugin-canvas.js:599-601`(`:598`은 빈 줄, `approveInstall`은 `:602`) · `registry.py:178-182`/`:185-189`/`:224-230` · `verify.js:1942-2137`. 세 값 모두 파일을 열어 재실측했다. 같은 절 614행과의 자기모순이 사라졌다 |
| **RC-3** 별칭 게이트의 거처 | **반영(권장안 채택)** — 게이트를 **`lib/main/plugin-proposal-registry.js`(순수 모듈, `CATALOG`와 executor `list` 주입)**가 소유하고 `main.js`의 `athena:plugin-approve`는 호출만 한다. W2-3 소유 항목 ⑷ · W2-4 ⑴ 문구 · §2.4 PM-1 완화 ⑶ · W5-1 단언 **⑸**(차단 별칭 봉투는 executor 0회) · §8 확정 10 · §9 Consequences ⑻("백엔드·메인 두 곳")을 모두 이 안에 맞췄다. 근거: `verify-plugins.js:23-24`가 `main.js`를 require할 수 없는 주입식 하네스라, 게이트가 핸들러 본문에 있으면 하네스가 게이트를 통째로 우회하고 PM-1이 요구한 모듈 단위 테스트가 원리적으로 통과할 수 없다 |
| **Optional 16건 — 전부 반영** | **O-A1·O-C10** 어댑터를 **2훅(H2·H4)**으로 축소, H6은 §5 표에만(W0 머리글·W0-1·W0 완료 정의·§5 H6행·어댑터 전략) · **O-A2·O-C5** 모드 밖 카드 0건 음성 단언(§2.5 단위(앱·렌더)) · **O-A3·O-C6** W5-2 신설을 **8**로 늘려 접근성 1건(승인·거부 버튼 키보드 도달 + 32px) 추가 · **O-A4·O-C7** §7-4를 **4a 좁힌 실행 → 4b 전수 1회**로 순서 명시 · **O-A5·O-C9** 프리모템 **PM-5(제안 소음 루프)** 신설 — 같은 봉투 서명은 한 턴 1회 · **O-A6·O-C8** 픽스처를 `path.join(__dirname,'..','..','backend','tests','fixtures','plugin-proposal')`로 못박음 · **O-C1** W3-2 ⑶의 `setData` 대안 삭제(`setProposals` 단일 확정) · **O-C2** 하네스 표기를 `consume(envelope)`로 통일 · **O-C3** 확정 7을 6과 8 사이 제자리로 이동(번호 재부여 없음 — 기존 "확정 N" 참조가 그대로 산다) · **O-C4** W5-4 검수 안건 **⑷**로 그래프 모드 예외(O-9) 승인 상정 |

**반복 5 — 반박(contested) 없음.** REQUIRED 9건(Architect 4 · Critic 5, 중복 4건 병합)과 Optional 16건을 모두 반영했다. 검토자가 지적한 인용 6건 중 5건은 이미 계획 본문이 옳은 값을 쓰고 있었고 §10.3 이력표만 틀렸으므로 그 표를 고쳤다. 나머지 1건(`controller.js:271-305`)은 **현행 파일에서 재현되지 않는다** — 계획 297행·435행 모두 `:271-303`이고 `271-305`는 §10.3 ⑹의 *교정 이력*에만 남아 있다(조치 불필요, 검토자 두 명 모두 같은 판단).

**반복 5에서 검증하지 못한 것.** ⑴ Paper 보드 6장의 실제 노드 구조·문구·치수(계획 단계 Paper 호출 금지 — 확정 7의 대처로 넘긴다). ⑵ R7 플레이키 테스트의 정체. 그 밖에 이번 반복이 새로 쓴 코드 인용 — `plugin-canvas.js:599-601`/`:602` · `registry.py:178-182`/`:185-189`/`:224-230` · `verify.js:2110`/`:2137` · `mcp-cli.js:139-150`/`:152` · `controller.js:299`/`:302`/`:303` · `verify-plugins.js:23-24` · `lib/main/claude-tool-policy.js:15` — 은 모두 파일을 열어 확인했다.

### 10.5 반복 5 검토 → 반복 6 (이번 반복)

**반복 6: Critic RC-1~7 + 선택 7건 적용, Architect RC-1~5 동일 항목 해소**

**⚠ 읽는 법(§10.3과 동일) — 이 표의 화살표 왼쪽 값과 「옛 값」으로 표기된 인용은 전부 「옛 값 — 본문에 없음」이다.** 해당 반복에서 교정돼 계획 본문 어디에도 남아 있지 않으므로, 독립 검증이 이 표의 옛 행 번호를 본문 오류로 계상하면 오탐이다(grep으로 재확인 가능).

| 항목 | 처리 |
|---|---|
| **RC-1** (A·C 공통) pending 등록 시점 일원화 | **반영** — W2-1에서 "push 직전에 pending 맵에 등록(모델 경로의 유일한 등록 시점)"을 **삭제**하고, 모델 경로도 모드 게이트 통과 뒤 `canvas.js`가 보내는 `athena:plugin-noted` **한 지점**으로만 등록되게 했다. ⑶ W2-2·W2-4의 "GUI 경로의 pending 등록 전용"을 **"두 경로 공통의 pending 등록"**으로 함께 고쳐 자기모순을 없앴다. ⑵ §8 확정 10의 "모델 경로는 push 직전" 문장도 교체. ⑷ §2.5 단위(앱·렌더)에 부활 방지 단언 1건 추가(모드 밖 폐기 제안은 `athena:plugin-pending`에 나타나지 않는다). §9 ADR Decision·Consequences ⑵도 정합화 |
| **RC-2** (A·C 공통) 복원 훅의 거처 | **반영** — W3-4 ⑷의 "사이드바가 진입마다 부르는 `setView('hub')` 뒤"를 **`app/canvas.js:2537`(`window.AthenaPluginCanvas = pluginCanvas`)에서 노출 객체의 `setView`를 감싸 `athena:plugin-pending`을 invoke**로 못박고, `app/lib/sidebar.js`는 수정하지 않으며 `app/lib/plugin-canvas.js`는 IPC 무지를 유지한다는 두 줄을 병기했다. 근거 실측 재확인: `sidebar.js:54 onSelect`의 plugin 가지(`:58-62`)는 `setView('hub')`만 부르고 refresh 훅이 없다(backtest 가지 `:63-67`은 `refresh()`를 부른다) · `canvas.js:2781 void pluginRefresh()`는 1회 + 변이 후에만 돈다. W3-3 파일 칸에 `:2537` 추가 |
| **RC-3** (A·C 공통) 승인 후 채팅 결과 턴의 마운트 경로 | **반영** — W3-4 ⑵를 **캔버스 카드 상태 표시**로 한정하고(형판 `chat.js:2687`/`:2694`/`:2703` 실측 확인), 08번 보드가 요구하는 결과 턴 4종을 ⑶의 새 경로로 분리했다: **모듈 스코프 `_mountTurn`(`app/chat.js:2162`, 선례 `renderAgentTurn` `:2171`)** + `canvas.js`→`chat.js` 전달은 렌더러 내부 `CustomEvent` 선례(`app/canvas.js:2595 athena:plugins-changed`) 복제. 턴 스코프 경로(`chat.js:1184-1188`)로는 승인 클릭이 살아 있는 턴 밖이라 **원리적으로 마운트 불가**임을 명시. W3-4 ⑶의 "`chat.js`의 몫은 한 줄뿐"은 **"모드 밖에서는"**으로 범위를 좁혀 ⑴과의 문면 충돌을 제거(Architect 선택 2번 동시 해소) |
| **RC-4** (A·C 공통) §1 "승인된 예외" 자기모순 | **반영** — "**유일한 승인된 예외**"를 **"승인 상정 예외 — 사용자 판단 대기(이 계획 확정 시 결정 기록)"**로 바꾸고, 채워 넣을 한 줄 **`【사용자 결정 2026-09-03: 그래프 헤더 예외 **승인** — `#chatModeHead`를 모드별 문구를 가지는 공용 모드 헤더로 일반화한다. 그래프 모드 문구·동작은 회귀 단언 3종(`verify-graph-mode.js` 포함)으로 불변 고정. `#pluginChatHead` 폴백은 채택하지 않는다】`**를 §1에 넣었다. **거부 시 폴백을 구체화**: `app/shell.html:296-299`와 `app/lib/graph-mode/controller.js:302`를 손대지 않고, `canvas.js`가 `#chatModeHead`의 형제로 **`#pluginChatHead`**를 삽입해 `window.AthenaCanvasMode = graphMode`(`canvas.js:2466`) 노출 지점의 `setView` 래퍼에서 `currentMode() !== 'plugin'`으로 `hidden`을 토글한다 — 그래프 코드 0줄. 대응 회귀 단언 3종도 명시(플러그인 모드에서 `#pluginChatHead` 가시·제목 일치 · 같은 순간 `#chatModeHead` hidden · 그래프 모드 문구 불변 + `#pluginChatHead` hidden). W3-6 선행 조건과 W5-4 ⑷·§9 Consequences ⑹도 같은 표현으로 맞췄다 |
| **RC-5** (A·C 공통) §6 R3 묶음 근거의 빌드 분리 | **반영** — "오늘 구조로는 설치 승인 → 재시작 → 허용 승인 → 재시작으로 대화가 두 번 끊긴다"를 **런타임을 켠 빌드(`ATHENA_PROVIDER_RUNTIME`) 한정**으로 좁히고, **기본 빌드의 묶음 근거는 UX 하나뿐**(사람이 한 번 읽고 한 번 누른다)이며 그때 재기동은 `canvas.js:2591 restartRequired` 플래그로만 표현된다고 적었다. 같은 절의 실측(`main.js:100 PROVIDER_RUNTIME_DEFAULT=false` + 핸들러 5종 조기 반환 = `runMcpMutation` 호출자 0)이 자기 근거를 반증하던 자기모순이 사라졌다. 부피 유지 결정과 그 이유도 함께 기록 |
| **RC-6** (C 단독) 신규 렌더러 모듈의 로드 등록 | **반영** — W0-1·W3-1의 파일 칸에 **`app/shell.html` 스크립트 블록**을 추가했다: 작업 트리 `:394-486`(워크트리 −2)의 `lib/plugin-catalog.js`(`:471`)·`lib/plugin-canvas.js`(`:472`) 인접 자리, **`canvas.js`(`:485`)·`chat.js`(`:486`)보다 앞**. 노출 이름을 **`window.AthenaLib.PluginModeAdapter`·`window.AthenaLib.PluginProposal`**로 확정하고 이중 내보내기 형판을 `lib/guard-confirm.js`·`lib/plugin-catalog.js` 말미로 지정. W0 절에 **순서 오류가 플러그인 모드가 아니라 렌더러 전체를 첫 페인트에서 죽인다**는 근거 문단 신설(`canvas.js:1-17`이 최상단에서 `window.AthenaLib.*`를 구조분해). W3-6 파일 칸에 "같은 `shell.html`의 별개 구역"임을 명시 |
| **RC-7** (C 단독) A3 측정 방법 | **반영** — A3의 ⑵를 **소스 텍스트 단언**으로 교체했다: 신규 `app/lib/plugin-proposal-boundary.test.js`가 `fs.readFileSync(path.join(__dirname,'..','canvas.js'))`로 소스를 읽어 GUI 진입 6종의 본문에 6개 IPC 함수 호출이 없고 전부 `onPropose`로 감을 단언한다(형판 `app/lib/raw-ui-boundary.test.js` — 같은 방식으로 `canvas.js` 소스를 읽는다. 실측 확인). `lib/plugin-canvas.test.js`의 몫은 "스파이 deps에서 클릭이 `deps.onPropose`를 부른다"로 분리. §7-6을 **6a(소스 단언) · 6b(모듈 행동)** 두 명령으로 나눠 다시 썼고, `canvas.js`가 최상위 스크립트라 require 불가하고 `app/package.json:10` 글롭에도 없다는 근거를 병기 |
| **선택 7건 — 전부 반영** | **⑴** §2.4 제목 `4가지` → **`5가지`**(PM-5 포함) · **⑵** W2-2에 SEND 앵커 **`preload.js:130 SEND_CHANNELS`** 명시(ON `:249` · INVOKE `:36`과 **별개 화이트리스트**임을 브릿지 검사 `:273`/`:279`/`:288`로 병기) · **⑶** §7 머리에 **"§7은 `bash`로 돈다"** 한 줄(4b의 `diff <(…) <(…)`는 프로세스 치환 = bash 전용, §0-0b의 `sh` 선언과 다르다) + `sh` 대체 형태(임시 파일 2개) · **⑷** W0 어댑터를 **H2 1훅**으로 축소(H4는 구현이 W0-3의 `plugin-canvas.js`에 있어 어댑터가 선언만 지게 되므로 O-A1 논거를 그대로 적용) — §5 표에는 H4를 **계약으로** 남기고 교체 대상이 어댑터가 아님을 명시 · **⑸** RC-1 부활 방지 단언을 **W5-2 신설 ⑺ 옆에 교차 참조**로 묶어 "정직성 회귀" 커버리지를 한 자리에서 읽게 함(단언 자체는 DOM이 필요 없어 `verify.js`가 아니라 `node --test`에 둔다는 이유도 명시 — 신설 개수는 8 그대로) · **⑹** §7 판정 블록 2에 **`npm run verify:plugins`의 네트워크 전제**를 판정 절차로 옮겨 적고 "오프라인 실패는 코드 결함이 아니다 · A7/A8의 신규 실패로 계상하지 않는다"를 명문화 · **⑺** §10.3 이력표에 **"⚠ 화살표 왼쪽 값은 전부 「옛 값 — 본문에 없음」"** 머리말 + 옛 값 6종 각각에 인라인 표기 — 반복 4·5·6에서 반복된 오탐 7건의 재발을 막는다 |

**반복 6 — 반박(contested) 없음.** Critic REQUIRED 7건과 선택 7건, Architect REQUIRED 5건(Critic RC-1~5와 동일 항목이라 Critic의 더 완전한 문면으로 처리)과 Architect 선택 5건(전부 Critic 선택과 중복이거나 RC-3에 흡수 — 특히 선택 2번 W3-4 ⑶ 범위 명시)을 모두 반영했다. **반복 6에서 새로 실측한 코드 인용(전부 본 저장소 작업 트리에서 파일을 열어 확인).** `app/shell.html:394-486`(스크립트 블록) / `:471`(plugin-catalog) / `:472`(plugin-canvas) / `:455`(guard-confirm) / `:485`(canvas.js) / `:486`(chat.js) / `:296-299`(`#chatModeHead`) · `app/canvas.js:1-17`(`window.AthenaLib.*` 구조분해) / `:2409`(`chatHead` 조회) / `:2466`(`window.AthenaCanvasMode = graphMode`) / `:2537`(`window.AthenaPluginCanvas = pluginCanvas`) / `:2595`(`athena:plugins-changed` dispatchEvent) / `:2781`(`void pluginRefresh()`) · `app/chat.js:2162`(모듈 스코프 `_mountTurn`) / `:2171`(`renderAgentTurn`) / `:2687`·`:2694`·`:2703`(`span.agent-mode` 결과 문구 3종) · `app/lib/sidebar.js:54`(`onSelect`) / `:58-62`(plugin 가지) / `:63-67`(backtest 가지) · `app/preload.js:36`(INVOKE 앵커) / `:130`(`SEND_CHANNELS`) / `:249`(ON 앵커) / `:273`·`:279`·`:288`(브릿지 3검사) · `app/lib/graph-mode/controller.js:302` · `app/package.json:10`(`test:unit` 글롭) · `app/lib/raw-ui-boundary.test.js`(첫 테스트의 `fs.readFileSync(path.join(__dirname,'..','canvas.js'))`) · `app/lib/guard-confirm.js`·`app/lib/plugin-catalog.js` 말미(이중 내보내기 형판). **행 번호는 본 저장소 작업 트리 기준이므로 워크트리에서는 §0-5대로 심볼로 재탐색한다** — 특히 `canvas.js`(−311) · `shell.html`(−2) · `preload.js`(−2)와 카드 트랙이 건드린 `lib/raw-ui-boundary.test.js`.

**반복 6에서 검증하지 못한 것.** ⑴ Paper 보드 6장의 실제 노드 구조·문구·치수(계획 단계 Paper 호출 금지 — 확정 7의 대처로 넘긴다). ⑵ R7 플레이키 테스트의 정체(2회 연속 통과 조건으로 흡수). ⑶ **§1의 「사용자 결정: 그래프 헤더 예외」** — 사용자가 직접 채운다. 비어 있는 채로 ralph에 넘기지 않는다.

### 10.6 반복 7 변경 이력 (2026-09-03)

| 항목 | 처리 |
|---|---|
| **Critic 최종 필수 1** 그래프 헤더 결정 "종결" 통일 | **반영** — §1 26행 "승인 상정 → 승인된 예외(사용자 결정 2026-09-03)", 같은 문단의 "아직 승인 기록이 없으므로 W5-4 ⑷" 삭제 · §1 30행 폴백 문단을 "롤백 전용 기록(실행하지 않음)"으로 재라벨 · W3-6 선행 조건을 "없음 — 무조건 실행"으로 · W5-4 ⑷를 "(해소)"로 바꾸고 안건 5건 → 4건 · §9 Consequences ⑹를 "승인된 예외"로 고정하고 "거부되면…" 분기 삭제 |
| **Critic 최종 선택 1** A10 “3종”과 정의 1종의 불일치 | **반영** — §3.2 A10 행이 단언 1건만 정의해 §1·W3-6·W5-2 ⑹·§7-3b의 “A10 3종”과 수가 안 맞았다. 세 단언(⑴ 그래프 문구 불변 ⑵ 플러그인 신규 2문자열 ⑶ 대화·에이전트·백테스트에서 `hidden === true`)을 A10 행에 전부 적고 측정 위치를 각각 명시했다 — ⑴은 `app/verify-graph-mode.js`(§7-3b `:222`), ⑵⑶은 `app/verify.js` 플러그인 블록(`:1942-2137`)을 확장한 W5-2 신설 ⑹. 그래프 헤더 결정 자체는 건드리지 않았다(승인 유지) |
| **Critic 최종 선택 2** 결과 턴 4종의 §2.5 테스트 행 부재 | **반영** — W3-4 ⑶이 보내는 08번 보드 결과 턴 4종(성공 3줄·거부 1줄·실패+재시도·재시작)이 §2.5에 한 칸도 없었다. **단위(앱·렌더 — 결과 턴)** 행을 신설해 W3-4 검증 칸의 “렌더 단위 테스트”를 실체화했다: 문구 4종은 `app/lib/plugin-proposal.test.js` 확장, `_mountTurn`(`app/chat.js:2162-2171`) 구독 배선은 `app/lib/plugin-proposal-boundary.test.js`의 소스 텍스트 단언(RC-7 형판 — `chat.js`도 `require` 불가), 명령까지 적었다 |
| **Critic 최종 선택 3** W0-1 검증 칸의 측정 파일 미지정 | **반영** — “`shell.html`에 태그가 있고 `canvas.js`보다 앞이다”가 재는 주체를 안 적어 RC-6이 테스트로 봉인되지 않았다. **`app/lib/plugin-mode-adapter.test.js`**가 `fs.readFileSync(path.join(__dirname,'..','shell.html'))`로 셸을 읽어 ㉮ `lib/plugin-mode-adapter.js`·`lib/plugin-proposal.js` 두 태그의 존재 ㉯ 두 태그의 `indexOf` < `canvas.js`·`chat.js`의 `indexOf`를 단언한다고 명시했다(형판 `app/lib/raw-ui-boundary.test.js`) |
| **Critic 최종 선택 4** §10.4·§10.5 이력표의 오탐 유발 | **반영** — §10.3이 반복 4·5·6에서 같은 오탐을 반복해서 맞고 머리말을 달았던 것처럼, §10.4·§10.5에도 같은 한 줄 머리말(「옛 값 — 본문에 없음」)을 표 앞에 붙였다. 이후 인용 검증자가 이 이력표의 옛 행 번호를 본문 오류로 잡지 않는다 |
