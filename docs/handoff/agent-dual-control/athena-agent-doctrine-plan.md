# 실행 계획 — 에이전트 모드 "두 입구, 한 게이트" 정렬 (Paper + 실앱 + 라이브)

- Status: **approved for execution — ralph** (사용자 승인 2026-09-03 "합의 → ralplan → ralph", 합의 6차 APPROVE)
- Plan ID: `athena-agent-doctrine-plan`
- 근거 스펙: `.omc/specs/deep-interview-athena-agent-doctrine.md` (모호도 17%, PASSED)
- 자매 스펙(어휘 정합): `.omc/specs/deep-interview-athena-plugin-doctrine.md`
- 모드: RALPLAN-DR **SHORT**
- 실행자: ralph (순차 executor + 검증 루프)
- 작성: 2026-09-03 · 개정: 2026-09-03 (합의 **6차**, §8·§9·§10·§11·§12 변경 이력 참조)
- 작업 브랜치: `feat/agent-dual-control` (worktree `.claude/worktrees/agent-dual-control`, 기반 = `origin/main`)

> ⚠ **앵커 규율 — 이 계획은 줄 번호를 사실로 주장하지 않는다.**
> 작업 기반은 `origin/main`의 **Step 0a 시점 tip**이며, 이 문서는 그 SHA도 커밋 수도 **삽입 줄 수도** 박아두지 않는다. 이하 본문의 모든 앵커는 **`이름` (≈줄)** 형식으로 읽는다: 이름이 계약이고 줄 번호는 Step 0e에서 재측정할 기대값일 뿐이다.
>
> ⚠ **합의 4차 정정 — 규율과 본문을 처음으로 일치시켰다.** 3차 머리말은 "숫자를 박지 않는다"고 적어 놓고 바로 아래에 커밋 수(`55`)와 파일별 삽입 줄 수(`+939`·`+622`·`+436`·`+132`)를 **`실측`이라 표기**해 실행자가 기대 규모로 읽게 만들었고, 재검증 시점에 **그 다섯 값이 전부 틀렸다**(`git rev-list --count HEAD..origin/main` = **57** · `chat.js +938/-1` · `main.js +599/-34` · `canvas.js +418/-18` · `conversations.js +128/-4`). 숫자는 **전부 지운다.** Step 0e를 구동하는 실제 계약은 **"무엇이 움직였는가"(파일 목록)**이지 "얼마나 움직였는가"가 아니다. 커밋 수는 본문·R18·§8-3·§9 어디에도 쓰지 않으며, 필요할 때 **실행 시점에 직접 잰다**.
>
> - **줄 번호가 이동하는 9파일**(`git diff --numstat HEAD origin/main`이 0이 아닌 파일 중 이 계획이 인용하는 것): `app/chat.js` · `app/main.js` · `app/canvas.js` · **`app/lib/sidebar.js`** · `app/lib/main/conversations.js` · `app/preload.js` · **`app/lib/main/backend-launcher.js`**(합의 **6차 편입** — 실측 `git diff --numstat HEAD origin/main` = **`6 0`**) · `backend/athena_mcp/server.py` · `PAPER_APP_PARITY.md`. **Step 0e가 이 9파일의 앵커를 이름으로 전부 재해결한다.**
> - ⚠ **완전성 주장 정정(합의 6차).** 5차까지 이 두 목록(이동 · 차이 0)이 *"계획의 인용을 모두 덮는다"*는 주장은 **거짓이었다** — `app/lib/main/backend-launcher.js`가 **어느 목록에도 없으면서** `:11`(HEALTH_URL) · `:28-58`(`buildBackendEnv`) · `:60-64`(`decideAction`)를 `≈` 없이 **6곳**에서 인용했고(③-1 · R27 · 9a · 8e), 실행자는 *"두 목록에 없으면 검증 대상이 아니다"*로 읽는다. 하필 그 파일이 라이브 시연의 **기동 계약 전체**를 거는 자리다. 6차에 편입해 이 주장이 처음으로 참이 된다.
> - **origin에만 있는 신규 파일**(로컬 `HEAD` 부재, 그래서 "이동"이 아니라 "출현"): `app/lib/sidebar-project-menu.js` — §1.4가 이 파일의 `MODE_CHOICES`를 근거로 인용한다.
> - **줄 번호가 유효한 7파일**(`HEAD..origin/main` 차이 0, 실측): `app/lib/agent-canvas.js` · `app/lib/agent-canvas.test.js` · `app/probe-agent-paper-parity.js` · `app/lib/guard-confirm.js` · `backend/athena_mcp/routine_tools.py` · `backend/athena_api/api/routines.py` · `backend/tests/mcp/test_routine_tools.py`. 그 밖의 백엔드 파일(`routines/*.py`)도 차이 0이다.
> - **철회:** 초안 머리말의 "모든 앵커를 `f880d79`에서 실측했다"는 주장은 `app/preload.js`에서 성립하지 않았다(초안 `INVOKE_CHANNELS :44` / `ON_CHANNELS :248` → 실제 선언은 `f880d79`·origin 모두 **`:3`** / **`:224`**; `:44`·`:248`은 루틴 채널 *삽입 구역*이었다). 이 계획은 해당 행의 "찾을 이름"을 선언 상수가 아니라 **인접 채널 문자열**로 바꿔 같은 오독을 막는다(Step 0e).
> - **철회 2 (합의 3차):** 초안·2차의 `PAPER_APP_PARITY.md` 인용은 **메인 체크아웃의 미커밋 작업본**에서 읽은 것이다. 실측 — `git show origin/main:PAPER_APP_PARITY.md | wc -l` = **384**, 작업본 = **439**. 2차가 인용한 `:414`·`:425-427`·`:434-440`은 origin 파일 끝을 **넘어 존재하지 않고**, R2b·Step 0f·AC ①-12의 근거였던 `:203 open_file` 처방은 origin에 **0건**이다(`git show origin/main:PAPER_APP_PARITY.md | grep open_file` → 없음). 그 줄은 사용자 확정 1이 "손대지 않는다"고 못박은 카드 트랙 미커밋 19파일의 일부이며, worktree에는 **물리적으로 오지 않는다**. 이 계획은 (a) 좌표를 origin 기준으로 다시 잡고(Step 0e), (b) `open_file` 근거를 worktree에서도 유효한 출처(Paper MCP 서버 지침 + 세션 메모리 `paper-mcp-screenshot-viewport`)로 교체한다(R2b·Step 0f).
> - **철회 4 (합의 5차):** `app/canvas.js`의 D-그래프 근거 보기 좌표 `:3067-3074`는 **틀렸다.** `canvas.js`는 이 머리말이 스스로 "이동 8파일"로 지정한 파일인데 이 좌표만 `≈` 없이 남았고(철회 3과 같은 실패 모드가 다른 파일에서 살아남았다), 실측 위치도 다르다 — origin에서 D-그래프 근거 보기의 실체는 **`onOpenGraph:`**(`≈:3051`, 바로 위 주석 `≈:3049`)이고 `:3067-3074`는 그 뒤의 다른 블록이다. 같은 파일의 얇은 어댑터 3개도 한 줄씩 어긋나 있었다 — 실측 **`fetchRuns: ≈:3022`** · **`fetchAvgDuration: ≈:3029`** · **`fetchEngagement: ≈:3035`**(3차·4차 본문의 `≈:3023·3030·3036`은 정정). 이 계획은 네 자리를 **이름 앵커**로 바꾸고 Step 0e의 `canvas.js` 행에 편입한다.
> - **철회 5 (합의 5차):** §1.6 표 5행과 §2 제약 2번의 **"모델이 보는 조건도 `source_label` 한국어 라벨뿐이다"는 이 코드베이스에서 거짓이다.** 실측 — `backend/athena_api/routines/rules.py:168-169`가 `if not note: spec.note = spec.human_summary()`로 note 미지정 루틴(기본 경로)의 `note`를 채우고, `models.py:168-179 human_summary()`는 `f"{symbol} · {label} {op} {value} · 방식 {mode}"`를 만든다. 그 `note`는 `_view`(`routines.py:122`)가 그대로 내보내므로 **모델은 `op`와 `value`를 산문으로 이미 읽고 있다.** 결정 d-2 자체는 유효하다 — 나가지 않는 것은 **기계 판독 소스 키(`price.current`)와 연산자 집합(`("<","<=",">",">=")`, `models.py:22-25,42-51`)**이고, 그것이 "모델이 유효한 술어 패치를 조립할 수 있는가"를 가른다. 문면을 그렇게 정정한다(§1.6·§2·U-5·ADR).
> - **철회 3 (합의 4차):** `app/chat.js`의 확정 칩 좌표 2건(`:2591-2593` 미리보기 실행 비활성 · `:2595-2620` 확정 칩 무변경)은 **로컬 `HEAD` 좌표**였다. `chat.js`는 이 머리말이 스스로 "이동 8파일"로 지정한 파일인데 이 둘만 `≈` 없는 확정 좌표로 남아 3차가 `sidebar.js`에서 잡아낸 결함(로컬 좌표를 origin 좌표로 오독)이 그대로 재현됐고, 계획 자신의 미결 목록(`.omc/plans/open-questions.md`)은 같은 지점을 이미 `origin 실측 ≈:3014-3018`로 **옳게** 적어 두어 본문과 미결 목록이 서로 다른 좌표를 말했다. 실측 — origin에서 `const preview = _btn('미리보기 실행'`은 **`≈:3016`**, `preview.disabled = true`는 **`≈:3017`**, `const activate = _btn('바로 활성화'`는 **`≈:3020`**이고 둘을 감싸는 함수는 **`function renderApprovalCard(`**(`≈:2960`)다. 이 계획은 두 자리를 **이름 앵커**로 바꾸고 Step 0e의 `chat.js` 행에 편입한다.

---

## 1. RALPLAN-DR 요약

### 1.1 Principles (5)

| # | 원칙 | 근거 |
|---|---|---|
| P1 | **상태를 바꾸는 행위는 사람 클릭 전용이다.** 모델 툴은 제안만 한다. | `backend/athena_mcp/routine_tools.py:6-9` · `nudge_guard_tools.py:8-19` · `backtest_tools.py:36` · `brain_tools.py:44` |
| P2 | **두 입구, 한 게이트.** 대화 경로와 GUI 경로는 서로 다른 입구지만, 마지막 한 걸음(사람 클릭 → 같은 **채널 이름**)은 하나다. 두 렌더러 호출자는 함수를 공유하지 않는다 — 만나는 곳은 `preload.js`의 `INVOKE_CHANNELS` 허용목록(`≈:3`, 검사 `≈:326`)과 `main.js`의 단일 `ipcMain.handle`이다. 따라서 파리티는 **구조가 아니라 결합 단언**이 지킨다(Step 8a) | 스펙 Constraints:55 · 플러그인 스펙:37 · `app/preload.js` `INVOKE_CHANNELS`(`≈:3`) |
| P3 | **정직 — 죽은 버튼·지어낸 값·빈 폼 금지.** 백엔드가 못 하는 동작은 화면에 활성으로 두지 않고, **읽어올 수 없는 값을 편집 대상으로 선언하지 않으며**, 화면에 적힌 규칙이 약속한 버튼은 실제로 만들고, **그 버튼에 이르는 진입로가 실제로 있는지도 확인한다**(합의 5차 확장 — 4차는 버튼을 만들었으나 예약·초안 루틴에서 그 화면에 도달할 수 없었다, §1.8). | 카드 헌장 §1 신념 5·13 · `app/chat.js`의 `const preview = _btn('미리보기 실행'` + 바로 다음 줄 `preview.disabled = true`(`≈:3016-3017`, 이름 앵커 — Step 0e) · `PAPER_DESIGN_AUDIT.md` 결정 로그 "죽은 글자를 남기지 않는다" |
| P4 | **기존 계약을 덮지 않고 잇는다.** 기존 6보드는 삭제가 아니라 정정, 기존 IPC는 교체가 아니라 재사용. | 스펙 Constraints:59 · `app/main.js:1212-1300` |
| P5 | **문구 3원칙 · 토큰 색만.** 설명문 금지(상태 표기만) · 한국어 단위 · 내부어 금지 · 하드코딩 hex 0 · 색만으로 상태 표현 금지 · 클릭 영역 32px. | `docs/ui/paper-card-surface-charter.md` §1 신념 10·11·14 · `PAPER_DESIGN_AUDIT.md` 접근성 절 |

### 1.2 Decision Drivers (top 3)

| # | 드라이버 | 왜 이게 결정을 가르는가 |
|---|---|---|
| D-1 | **게이트웨이 신뢰 경계를 넓히지 않는다 — 쓰기도, 읽기도** | `backend/tests/mcp/test_routine_tools.py:38-50`이 `confirm·cancel·activate`의 백엔드 도달을 `AssertionError`로 못 박아 놨다. 이 단언을 푸는 설계는 회귀 방어를 잃는다. **합의 4차 확장:** 경계는 쓰기만이 아니다 — `_view()`(`routines.py:111`)가 독스트링으로 *"조건 원문 dict 대신 사람이 읽는 해석문만 노출한다"*고 **축소를 의도로 선언**해 두었고, 모델이 도달하는 유일한 읽기가 그 `GET /api/v1/routines`다. 그러므로 "모델이 무엇을 볼 수 있는가"도 이 드라이버가 가른다 — 결정 (d)가 이 축을 정면으로 다룬다. ⚠ **합의 5차 문면 정정(머리말 철회 5):** 이 드라이버가 지키는 것은 **"모델이 술어를 전혀 못 본다"가 아니다** — 자동 생성 `note`(`rules.py:168-169` + `models.py:168-179 human_summary()`)가 `현재가 >= 88000` 같은 술어를 **산문으로** 이미 모델에게 넘긴다. 지키는 축은 **기계 판독 소스 키·연산자 집합에 도달하지 않는다**(= 모델이 **유효한 술어 패치를 조립할 수 없다**)이며, 그 구분이 d-1과 d-2를 실제로 가른다 |
| D-2 | **사람 검수 게이트가 한 번만 서야 한다** | ralph는 순차 실행이다. Paper 검수는 사람이 멈추는 지점이라, 이 게이트가 몇 번 서느냐가 총 리드타임을 지배한다. (계획 전체의 사람 정지점은 **2개**이며 — 검수 1회 + 라이브 시연 1회 — 이 드라이버가 최소화하는 것은 **검수 게이트 횟수**다. 시연 정지점은 GUI 클릭이 물리적으로 필요해 생기며 작업 순서로 없앨 수 없다) |
| D-3 | **외부 세션 기반은 실재하며 이미 착륙했다 — 다만 로컬 `main`에 없다** | 스펙 Constraints:53의 `⚠ 기반 소유 트랙이 실제로 존재하는지 계획 단계에서 확인한다`를 실행한 결과다. 소유 트랙은 `docs/plans/session-persistence-spec.md`(로컬 `HEAD`에는 없고 origin에만 있다 — `git diff --stat`이 `+198`로 보고) + `ff64f93`(대화가 모드에 묶이고 세션 저장 자리 신설) → `ba63bc5`(이력 머리 5모드) → `c51dc10`(이력 행 클릭으로 실제 복원)이며 **전부 `origin/main` 조상**이다. 실측: `git show origin/main:app/lib/main/conversations.js`에 `mode: viewToMode(row.mode)`(`≈:88`) · `state.activeMode = viewToMode(mode)`(`≈:190`) · `state.activeMode = conversation.mode`(`≈:237`)가 있고, 로컬 `HEAD`의 같은 파일에는 `mode` 출현 **0회**다. 따라서 설계 전제는 "부재"가 아니라 **"origin/main 기반으로 브랜치를 딴다"**이며, 커밋 수는 이 결정과 무관하다(숫자를 박지 않는다) |

### 1.3 결정 (a) — 이중 제어 게이트 설계

**질문:** 대화 경로가 상태 변경을 어떻게 실행하는가.

| 옵션 | 내용 | Pros | Cons |
|---|---|---|---|
| **a-1 (채택)** 제안 턴 → 칩(사람 클릭) → 기존 IPC. A·B·C·E는 칩, D(뷰 상태)는 즉시 | 모델이 `athena_routine` 제안 툴을 부르면 `main.js`가 tool_result에서 payload를 뽑아 `athena:routine-proposed`로 렌더러에 보내고, `chat.js`가 제안 턴 카드를 그리고, 칩 클릭이 기존 `athena:routine-*` IPC를 부른다 | ① 기존 테스트(`test_routine_tools.py:38-50`)를 그대로 살린다 ② `main.js`에 **선례 포워더가 이미 3개** 있다(origin 실측: `maybeForwardNudgeGuardProposal ≈:2300` · `maybeForwardGraphChatAction ≈:2331` · `maybeForwardBacktestChatAction ≈:2375`) — 이 계획은 **4번째**를 같은 디스패치 지점(`≈:2494`)에 얹을 뿐이고, 그중 nudge-guard 경로는 `renderGuardConfirmCard`(`app/chat.js ≈:3064`)까지 종단으로 작동한다 ③ 두 경로가 **같은 채널 이름**으로 수렴하고, 그 이름은 `preload.js`의 단일 허용목록을 통과해야만 main에 닿는다 — 신뢰 경계가 하나다 | ① 대화 경로가 "문장 하나로 끝"이 아니라 문장+클릭 2동작이다 ② 제안 payload 스키마를 새로 정의해야 한다 ③ **파리티가 저절로 보장되지 않는다** — 두 렌더러 호출자는 각자 `window.athena.invoke`를 부르고(`app/chat.js ≈:3025` vs `app/canvas.js ≈:2975·:2980`) 공통 함수를 공유하지 않으므로, 채널명 일치를 **결합 단언으로 고정**해야 한다(Step 8a) |
| a-2 되돌릴 수 있는 동작(pause/resume/ack)은 자연어에서 즉시 실행 | MCP 툴이 직접 `POST /api/v1/routines/{id}/pause`를 부른다 | ① 대화 경로가 1동작으로 끝난다 ② D2의 문자 그대로의 독해에 가장 가깝다 | ① `routine_tools.py:6-9`의 명시 원칙과 정면 충돌 ② "모델이 일시중지해놓고 사용자는 감시 중이라 믿는" 경로가 열린다 — 스펙이 인용한 델타 검토 blocker 그 자체 ③ 같은 동작의 GUI 경로는 여전히 클릭이라 두 경로의 위험도가 비대칭이 된다 ④ 회귀 테스트 3건을 삭제해야 한다 |
| a-3 A~E 전부 칩 확인(D 포함) | 뷰 전환도 칩을 거친다 | 규칙이 단 하나다 | ① 서버 상태를 안 바꾸는 렌더러-로컬 동작(`setActiveView`, `agent-canvas.js:1620`)에 확인을 붙이는 순수 마찰 ② "탭 눌러줘" → 칩 → 탭이동은 GUI보다 느려 D2를 오히려 훼손 |

**채택: a-1.**

**칩 확인이 D2("대화로 모든 제어")를 훼손하지 않는 근거 — 계획 단계 확인 항목(스펙:110):**

초안은 이 근거를 **표면 위치**("칩은 채팅 안에 그려진다")로 댔다. 그 논증은 약하다 — 칩은 결국 `chat.js`가 그리는 DOM 버튼이므로 "채팅 표면 GUI vs 캔버스 GUI"의 대비일 뿐이고, "대화 경로"라는 이름을 스스로 정당화하지 못한다. 근거를 **신뢰 경계**로 교체한다:

1. **모델이 도달 가능한 표면에서 쓰기 경로가 0이다.** 모델은 MCP 툴 디스패치까지만 도달한다. `routine_tools.py:6-9`와 이 계획의 `propose` 분기는 `GET /api/v1/routines` 외의 method·path를 부르지 않으며, 그 사실을 **`test_propose_only_reads_list`**가 `AssertionError`로 고정한다(Step 6-A b — 4차에 `test_propose_never_writes`에서 개명·확장했다. 5차에 본문 4곳의 옛 이름을 전부 새 이름으로 통일했다). 즉 모델은 **제안 payload를 만들 수 있을 뿐 상태를 바꿀 수 없다.**
2. **쓰기는 렌더러 → preload 허용목록 → main 핸들러 경로로만 일어난다.** `app/preload.js`의 `INVOKE_CHANNELS`(`≈:3`)에 없는 채널은 검사(`≈:326`)에서 거부된다. 모델은 렌더러 컨텍스트에 코드를 실행할 통로가 없으므로 이 경로에 진입할 수단 자체가 없다.
3. **따라서 칩 클릭은 "모델의 제안"을 "사람의 승인"으로 승격시키는 단 하나의 사건이다.** 자연어 확인("응 그렇게 해줘")으로 대체하면 승인 여부를 **모델이 판정**하게 되어, 방금 (1)에서 잘라낸 신뢰 경계로 판정 권한이 되돌아간다. 칩은 그 되돌아감을 막는다.

**D2와의 정합:** D2의 판정 단위는 "동작이 대화 표면을 떠나지 않고 개시·완결되는가"다. 대화 경로는 **채팅 안에서 문장 → 카드 → 클릭**으로 닫히고(칩은 `routine-approval-actions` 행, origin 실측 7곳 중 루틴 승인 3곳), GUI 경로는 **캔버스 안에서 버튼 클릭 1회**로 닫힌다. 어느 쪽도 상대 표면을 방문하지 않는다.

> ⚠ **합의 4차 — 이 판정 단위를 계획 자신이 A 묶음에서 깨고 있었다.** 3차의 9c 1·9행은 GUI 경로를 *시트 제출 → **채팅 확정 칩***으로 적었다. 즉 GUI 경로가 마지막 한 걸음에서 상대 표면을 방문했고, a″-1이 얻어냈다고 주장한 "결정적·자기완결 GUI 경로"가 A의 마지막 걸음에서 무너졌다. 원인은 상세 패널에 `확정` 버튼이 없었던 것이며, 규칙 ③은 그 버튼을 **문자열로 이미 약속하고 있었다.** Step 3-3·7a가 버튼을 만들어 이 문장이 처음으로 참이 된다(R29). 반대로 a-2를 택하면 대화 경로만 클릭이 없어져 **같은 동작의 위험도가 입구마다 달라진다** — 이것이 "두 입구, 한 게이트"의 위반이다.

**마찰 완화(융합안):** 제안 턴 카드의 **확정 칩에 `autofocus`를 준다.** 사용자는 손을 옮기지 않고 Enter로 확정할 수 있어 "문장 + 클릭 2동작"의 체감 비용이 "문장 + Enter"로 내려간다. 승인 판정 주체는 여전히 사람이다.

**D(뷰 상태)만 즉시인 근거:** D의 5동작(탭·필터·검색·드릴인·캔버스에서 열기/채팅으로)은 서버에 아무것도 쓰지 않고 렌더러 상태만 바꾼다(`agent-canvas.js:1620 setActiveView`, `:352 searchInput`, `:1063 openHistory`). 되돌리기 비용이 0이므로 게이트의 보호 대상이 아니다. "그래프에서 근거 보기"도 링크 이동뿐이다(**`app/canvas.js`의 `onOpenGraph:` `≈:3051`** — 4차의 `:3067-3074`는 틀린 좌표였다, 머리말 철회 4). **E의 "브리핑 결과 열기"도 같은 이유로 즉시**로 분류한다 — `briefing_content`는 이미 `GET /{id}/runs` 응답 필드다(`backend/athena_api/api/routines.py:391-395`). E 중 상태를 바꾸는 것은 "지금 실행"(catchup-fire) 하나뿐이다.

**하위 결정 (a′) — MCP 제안 enum의 모양**

| 옵션 | 모양 | Pros | Cons |
|---|---|---|---|
| **a′-1 (채택)** | 최상위 `action` enum = `["draft","list","propose"]`, 제안 대상은 `propose.control` enum **12종** | ① `nudge_guard_tools.py:39`(`_ALLOWED_ACTIONS = ("propose","get")`, 실측)와 **모양이 같다** — 사내 선례 형식을 따른다 ② 기존 회귀 테스트 `test_state_changing_actions_are_gateway_blocked`가 파라미터(`"confirm","cancel","activate",None,5`)를 그대로 유지한 채 살아남는다(`backend/tests/mcp/test_routine_tools.py:37-50`은 **최상위** action만 검사하므로 중첩 enum이 이 단언을 건드리지 않는다) ③ 실행 부재가 스키마 모양만으로 읽힌다 | ① **스펙 Constraints:55 문면과 다르다** — 스펙은 "제안 액션 enum(confirm·pause·…)으로 넓히되"라 적었고 이는 최상위 확장으로도 읽힌다. 해석임을 명시해야 한다(open-questions #2) ② enum이 2층이라 모델이 `action:'confirm'`을 직접 시도할 확률이 남는다 — 차단은 되지만 실패 턴이 소모된다 ③ 툴 설명문이 길어진다(중첩 오브젝트 1개 + 12 enum 값 설명) |
| a′-2 | 최상위 `action` enum을 `["draft","list","confirm","pause",...]`로 직접 확장 | ① 스펙 Constraints:55의 문자 그대로다 ② enum이 1층이라 모델 혼동이 적다 | ① REST 동사와 이름이 같은 액션이 최상위에 놓여 "실행처럼 보이는 제안"이 된다 ② 위 회귀 테스트를 통째로 다시 써야 한다 — **게이트웨이 차단이라는 안전 속성의 회귀 방어를 잃는다**(D-1 정면 위반) |

**채택: a′-1.** 스펙 문면에 대한 해석임을 명시한다 — 검토자가 문자 그대로의 a′-2를 원하면 바뀌는 것은 `routine_tools.py`의 `_INPUT_SCHEMA` 한 곳과 `test_routine_tools.py` 단언뿐이며, 나머지 계획은 무변경이다(open-questions #2에 미결로 남아 있다).

**하위 결정 (a″) — A-생성·C-채택의 GUI 경로는 결정적이어야 하는가**

초안은 이 둘을 `seedChatInput`(채팅 입력에 문장 심기)으로 끝냈고 근거는 "최소 변경" 한 줄이었다. 그러면 **GUI 시트가 6필드를 모아 자연어 문장으로 재직렬화하고 모델이 그것을 다시 파싱**하게 되어, GUI 경로가 결정적이지 않다 — "두 입구, 한 게이트"가 아니라 "한 입구 + 우회로"가 된다. 옵션을 정면으로 놓는다.

| 옵션 | 내용 | Pros | Cons |
|---|---|---|---|
| **a″-1 (채택)** GUI 시트 제출 → 전용 IPC `athena:routine-draft` → `POST /api/v1/routines/draft` → 초안 확정 카드 | 시트가 모은 구조화 값을 그대로 REST로 보낸다. 채택(`adoptSuggestion`)도 제안 entry를 draft 스펙으로 매핑해 같은 IPC로 | ① **GUI 경로가 결정적이다** — 모델 파싱 없음, 같은 입력 → 같은 결과 ② A·C가 다른 8동작과 같은 형태(폼 → IPC)가 되어 규칙이 하나다 ③ 라이브 시연 9c 1·9행의 기대 상태(`routines[] +1`)가 GUI 경로만으로 실제 성립한다 ④ 게이트는 그대로다 — `draft`는 `status='draft'`를 만들 뿐이고 활성화는 여전히 `athena:routine-confirm` 클릭이다 ⑤ **백엔드 신규는 0** — `POST /draft`는 이미 있고(`backend/athena_api/api/routines.py:145-150`) 본문을 `validate_draft(body)`로 받는 raw dict라 시트 값을 그대로 보낼 수 있다 ⑥ 시트가 만든 것은 `status='draft'`라 사용자가 확정 칩을 누르기 전까지 아무것도 감시하지 않는다 — **게이트 무손상** | ① 신규 IPC 채널 1개(`athena:routine-draft`) + preload 허용목록 1줄이 는다 — **채택안의 단점은 이것 하나뿐이다**(합의 6차 표기 정정: 5차까지 이 열에 있던 `백엔드 신규는 0`·`게이트 무손상`은 **장점 문장**이라 Pros ⑤·⑥으로 옮겼다. 2차 §8 변경 21번이 a′ 표에 Cons 열을 신설하며 *"채택안의 단점을 적을 자리가 없었다 — 편향된 표"*라고 세운 기준의 같은 적용이며, 결정 자체는 무변경이다) |
| a″-2 시트 제출 = `seedChatInput`(초안 유지) | 폼 값을 문장으로 조립해 채팅에 심는다 | ① 신규 IPC 0 ② 기존 `canvas.js ≈:2969`의 `seedChatInput('새 작업을 만들어줘 — ')` 패턴을 그대로 잇는다 | ① **GUI 경로가 비결정적** — 모델이 문장을 다시 파싱하고, 파싱이 틀리면 사용자가 폼에 넣은 값과 다른 루틴이 생긴다(P3 정직 위반 위험) ② `seedChatInput`은 IPC가 아니어서(`app/canvas.js ≈:2129`, `window.AthenaShell` 렌더러 로컬 버스) "같은 게이트로 수렴"이 성립하지 않는다 ③ 라이브 시연에서 "GUI 경로 1회 → `routines[] +1`"을 기록하면 **실제로는 대화 경로의 결과**라 증거가 오염된다. **기각** |
| a″-3 GUI 시트를 없애고 A-생성은 대화 전용 | Paper 05의 `＋ 새 작업` 시트를 만들지 않는다 | 모호함 0 | 스펙 R3 답변("GUI도 모든 제어가 가능해야 한다", 스펙:173)과 스펙 A 인벤토리의 "생성"을 직접 위반. **기각** |

**채택: a″-1.** 대신 `＋ 새 작업` 시트 하단의 `채팅에서 쓰기` 버튼은 **유지**한다 — 그것은 우회로가 아니라 대화 경로로 건너가는 명시적 선택지다. **`holdSuggestion`(보류)만 IPC 없이 로컬로 남는다** — 백엔드에 채택/보류를 기록하는 엔드포인트가 없다는 사실이 근거이며(open-questions #4), 그 사실을 화면에 `보류함 N건`으로 정직하게 표기한다.

> 이 결정으로 ②-1의 **IPC 경유 동작이 8 → 10**이 된다(새 작업 시트·채택이 `athena:routine-draft`로 합류). **합의 4차에 A-확정의 GUI 버튼이 더해져 최종 11**이며(Step 3-3·7a), 비-IPC는 **보류 1개**만 남는다 — GUI 동작 총 **12개 = IPC 11 + 비-IPC 1**. 이하 본문·표는 이 수치를 쓴다.

**`_CONTROL_ACTIONS` 12종의 출처 — 조용한 확장이 아님을 명시한다.** 스펙 Constraints:55가 열거한 것은 **10종**(`confirm`·`pause`·`resume`·`cancel`·`ack`·`adopt`·`hold`·`guard`·`fire`·`view`)이다. 이 계획은 여기에 **2개를 더해 12종**으로 둔다. 둘 다 스펙 **인벤토리에는 있는데 Constraints 열거에서 빠진** 동작이며, 범위 확장이 아니라 스펙 내부의 누락을 메우는 것이다.

| 추가 control | 대응하는 스펙 인벤토리 항목 | 없으면 무엇이 결손되는가 |
|---|---|---|
| `ack_all` | B 인벤토리 "모두 읽음" | B 묶음의 "모두 읽음"이 대화 경로에서 사라진다 |
| **`update`** | **A 인벤토리 "설정 편집"** | **A 묶음의 "설정 편집"이 대화 경로에서 사라진다 — D2("모든 설정 편집") 정면 미달** |

**`update` 추가의 근거(합의 3차에 발견된 결함).** 2차 계획은 §2 A행에 IPC `athena:routine-update`(신설)를 적어 놓고도 `_CONTROL_ACTIONS`에 대응 control을 넣지 않았고, Step 8a 표는 그 빈자리를 `chipToIpc('confirm')`으로 메웠다. 그런데 `POST /{id}/confirm`은 실측(`backend/athena_api/api/routines.py:211-229`, origin) `runtime.can_activate` 검사 → `ensure_realtime_subscription` → `store.transition(id,'active')`이지 **패치 적용이 아니다.** 그대로 구현하면 07 보드 A열 칩 `이렇게 바꿔줘`(본문 `쿨다운 300초 → 600초`)가 루틴을 `active`로 전이시키고 쿨다운은 그대로 남는다 — **버튼이 자기 글자와 다른 일을 한다(P3 위반).** 대안은 "A-설정편집의 대화 경로를 미지원으로 선언"뿐인데 그것은 D2 위반이므로, `update`를 명문으로 추가한다.

### 1.4 결정 (b) — 외부 세션 기반 인터페이스 계약

**확인 결과 (D-3) — 스펙 Constraints:53이 요구한 확인의 답:**

| 기반 조각 | 소유 상태 | 근거 |
|---|---|---|
| 대화 레코드 `mode` 필드 | ✅ **소유·착륙 완료**(origin/main) | `git show origin/main:app/lib/main/conversations.js` 실측 — `mode: viewToMode(row.mode)`(`≈:88`) · `begin({ id, projectId, mode })`(`≈:181`) · `state.activeMode = viewToMode(mode)`(`≈:190`) · `state.activeMode = conversation.mode`(`≈:237`). 로컬 `HEAD`의 같은 파일에는 `mode` 출현 **0회** |
| 스냅샷·세션 복원 | ✅ **소유·착륙 완료**(origin/main) | `app/lib/session-snapshot.js` · `app/lib/main/session-store.js` · `app/lib/session-history-view.js` · `app/probe-session-restore.js` 전부 `origin/main`에 존재(`git ls-tree origin/main` 실측). 명세는 `docs/plans/session-persistence-spec.md` |
| 모드별 프롬프트 분기 | ✅ **소유·착륙 완료**(origin/main) | `git show origin/main:app/chat.js` **`≈:1315`**(2차의 `:1288`은 정정) — 제출 payload에 `canvasMode: (window.AthenaCanvasMode && … .state.view) \|\| 'summary'` 동봉. 로컬 `app/chat.js:1271-1274`에는 없다. **Step 7d의 모드 게이트가 이 값을 쓴다** |
| 펜 시트(화면 38) = 모드 골라 새 대화창 | ✅ **소유·착륙 완료**(origin/main) | **2차의 "미소유" 판정을 철회한다.** 근거였던 "`session-persistence-spec.md` 전문에 `펜` 없음"은 거짓이다 — 그 스펙 **`:182`**에 `- [x] sidebar.js — … 펜 = 모드 골라 새 대화창. 순수 규칙은 sidebar-project-menu.js`가 **완료 표기로** 있다. 코드도 실재한다: `git show origin/main:app/lib/sidebar-project-menu.js`의 `MODE_CHOICES`(`≈:18-24`)에 `{ mode:'agent', view:'agent', label:'에이전트' }`가 있고, `sidebar.js` `≈:333`(`펜 = 새 대화창(38번 보드)`) · `≈:349`·`≈:901 startNewConversation(projectId, view)`가 그것을 부른다 |
| 같은 모드 대화 **레코드** 여러 건 | ✅ **이미 가능**(막는 코드 없음) | `git show origin/main:app/lib/main/conversations.js` `function touch`(`≈:198`)가 `mode: requestedMode` 행을 **개수 제한 없이** `state.conversations.push`(`≈:213-221`)한다. 즉 `mode==='agent'` 대화 2건 이상은 **지금 당장 만들 수 있다** |
| 같은 모드 창 **동시 상주**(세션) | ❌ **미소유** | `session-persistence-spec.md:130` — "상주 채팅 세션은 프로세스 전역 하나이고 새 턴이 오면 기존 턴을 인터럽트한다. 데몬 분리와 세션별 실행 핸들이 필요하다". `:89-93`이 그 소유자를 미착수 **Athena 데몬**(화면 39·43)으로 지목 |

즉 스펙이 "부재 시 스텁"으로 대비한 조각 중 **펜 시트·`mode` 필드·스냅샷 복원·모드별 프롬프트는 전부 실재**하고, 남은 것은 **동시 상주 세션** 하나뿐이다(Non-Goals:67이 명시적으로 제외한 항목).

> **방법론 정정(합의 3차).** 2차는 나머지 3조각을 `git show origin/main:…`으로 **코드를 직접 열어** 확인했으면서 4번째만 **스펙 문서를 낱말로 grep**해 부재를 단정했다. R4가 경고한 실패 모드("부재를 근거로 스텁을 만들기 시작")를 계획 자신이 마지막 한 조각에서 범한 것이다. 이 표의 4개 행은 **전부 코드 실측**으로 다시 썼다.

| 옵션 | 내용 | Pros | Cons |
|---|---|---|---|
| **b-1 (채택)** `origin/main` 기반 **worktree 브랜치** + **최소 어댑터 1파일** | Step 0a에서 `origin/main`을 기반으로 `feat/agent-dual-control` worktree를 만들고 그 안에서만 작업한다. 에이전트가 필요로 하는 판정 2개를 만든다 — `getAgentConsoleSessionId()`는 `app/lib/main/agent-session.js`(main 쪽 스냅샷 판정), `isDerivedAlertRoom(roomId)`는 **`app/lib/agent-proposal.js`**(렌더러 UMD, 합의 6차 소유 확정 — 렌더러가 `lib/main/*`을 import할 수 없기 때문이다). `getSessionMode`는 **만들지 않는다** — worktree의 `conversations.js`가 이미 `viewToMode()`로 정규화한 `mode`를 준다(`≈:88`, 어댑터는 이 정규화된 값을 읽는다) | ① 이미 만들어진 것을 다시 만들지 않는다 ② 어댑터가 3함수→2함수로 줄고 스텁 표면이 최소화된다 ③ `canvasMode` 배선이 이미 있어 에이전트 모드 판별에 새 배선이 불필요하다 ④ **병합이 0회다** — worktree를 `origin/main`에서 직접 따므로 충돌이 발생할 사건 자체가 없고, 메인 체크아웃의 카드 트랙 미커밋 19파일과 물리적으로 분리된다 | ① 별도 체크아웃이라 `node_modules/`·`.venv/`를 새로 설치해야 한다(둘 다 gitignore, **`.gitignore:18-19`** 실측 — `:20-21`은 `__pycache__/`·`*.pyc`다) — Step 0d ② `.omc/`가 gitignore(`.gitignore:9`)라 계획·스펙이 worktree에 없다 — Step 0b가 복사한다 ③ 이 브랜치는 **병합하지 않는다**(사용자 확정) — 통합은 이 계획 밖의 별도 결정이다 |
| b-2 `origin/main`을 로컬 `main`에 **병합** | 초안의 동기화 게이트 | 단일 체크아웃 유지, 의존성 재설치 0 | ① 카드 트랙 미커밋 19파일과 origin이 함께 고친 파일이 겹쳐 충돌이 확정적이다 ② 충돌 해소가 사람 판단을 요구해 ralph 순차 실행의 첫 Step이 멈춘다 ③ 실패 시 카드 트랙 작업이 위험해진다. **기각(사용자 확정 1로 폐기됨)** |
| b-3 동기화 없이 로컬에서 전부 스텁 | 계획 초안의 3함수 스텁 | 브랜치 비용 0 | **이미 origin에 있는 `mode`·스냅샷을 재구현**한다 — 두 구현이 갈리고, 언젠가 통합할 때 `conversations.js`에서 정면 충돌한다. **기각** |
| b-4 이 계획이 펜 시트·다중 창까지 구현 | 데몬 없이 다중 상주 세션 | 근본 해결 | Non-Goals:67 위반 + `session-persistence-spec.md:92-93`이 데몬 선행을 요구. **기각** |

**채택: b-1.** worktree 안에서의 인터페이스 계약(2함수):

```js
// app/lib/main/agent-session.js
// 관제 창(스펙 D1 "관제 창 하나 = 대화 하나") 판정을 한 곳에 모은다.
// 세션 mode·스냅샷 복원은 이 파일이 만들지 않는다 — 공통 세션 기반
// (docs/plans/session-persistence-spec.md, 커밋 ff64f93~c51dc10)이 이미 소유하고,
// 여기서는 conversations.js가 viewToMode()로 정규화해 주는 mode를 읽기만 한다.
// (원시 row.mode가 아니라 정규화된 값을 읽을 것 — conversations.js ≈:88.)
FOUNDATION_PRESENT                   // conversations.js 레코드에 mode가 있으면 true
getAgentConsoleSessionId(snapshot)   -> string | null
  // 활성 대화(snapshot.activeId)의 mode === 'agent'이면 그 id, 아니면 null.
  // **"최신 1건"이 아니다**(합의 3차 정정) — conversations.js touch()(≈:198)가
  // mode:'agent' 행을 개수 제한 없이 push하므로(≈:213-221) "최신 1건"은
  // 사용자가 보고 있지 않은 과거 관제 대화를 고를 수 있다(P3 위반).
  // 활성 대화 기준은 상주 세션이 하나인 지금도, 데몬 이후에도 옳다.

// app/lib/agent-proposal.js  ← isDerivedAlertRoom의 소유 모듈(합의 6차 확정)
isDerivedAlertRoom(roomId)           -> boolean   // 알림 파생 방(예외 창) 판정
  // 렌더러 UMD 모듈이 소유하고, main 쪽 agent-session.js는 이것을
  // require해서 쓴다(반대 방향은 성립하지 않는다 — 아래 참조).
```

⚠ **`isDerivedAlertRoom`의 소유를 렌더러 쪽으로 확정한다(합의 6차 — 5차까지 배치 불가였다).** 5차까지 이 함수는 **main 프로세스 모듈** `app/lib/main/agent-session.js`의 계약으로 선언돼 있었고 ②-5 ⑤가 `agent-session.test.js`로 단언했는데, 정작 호출자는 **렌더러**의 `shouldRenderProposal`(7c·7d·8a-4)이었다. 실측 — 렌더러 모듈은 `app/shell.html`의 `<script src="lib/*.js">` **83줄**로만 로드되고 그 목록에 **`lib/main/*`은 0건**이다(`lib/main/*`은 main이 `require`하는 CommonJS다). 즉 **렌더러는 `agent-session.js`를 import할 수 없고**, 실행자에게 남는 선택지는 판정 함수를 **두 벌 만드는 것**뿐인데 그것은 e-1이 배격한 사본이면서 8a-2 같은 발산 단언조차 없다. 하필 이 함수는 **스펙 Constraints:54(타 모드 불간섭)를 코드로 강제하는 유일한 자리**이고 3차가 *"어댑터에 소비자가 없다"*고 고친 바로 그 계약이다. **방향을 뒤집으면 사본이 0이 된다 — 선례가 이미 있다:** `app/main.js`의 **`:29`** `const { todayYyyymmdd } = require('./lib/backtest-spec')`가 **렌더러 UMD 모듈을 main에서 require**하며, `app/lib/guard-confirm.js:72-78`의 `module.exports` 폴백이 그것을 가능하게 한다(`agent-proposal.js`도 7c가 같은 UMD 각주를 쓴다). 따라서 **`isDerivedAlertRoom`은 `agent-proposal.js`가 노출하고, `agent-session.js`가 그것을 `require('../agent-proposal')`로 가져다 쓴다.**

**"최신 1건" 전제를 폐기하는 이유(합의 3차):** 2차는 `getAgentConsoleSessionId()`를 "`mode==='agent'` 대화 중 가장 최근 1건"으로 정의하고 ②-5에 **"관제 창은 하나 전제가 유효하다"**를 단언으로 박았다. 그런데 위 표 2행이 실측으로 보인 대로 `mode==='agent'` 레코드는 **이미 여러 건 만들 수 있으므로**, 그 단언은 첫 실행에서 **거짓을 테스트로 고정**한다. 정의를 **"활성 대화가 에이전트면 그 id, 아니면 null"**로 바꾸면 데몬 이전에도 이후에도 참이고, 반증 가능한 단언(②-5)으로 고정된다.

**프로덕션 연결 지점 — 어댑터는 소비자가 있어야 존재한다.** 2차 계획은 이 어댑터를 신설(6f)하고 단위 테스트(②-5)까지 요구했으면서 **어느 Step에서도 호출하지 않았다.** 소비자 없는 모듈 + 테스트는 CLAUDE.md §2(단일 사용 코드에 추상화 금지)와 이 절의 "범위 방어"에 정면으로 반하고, 더 중요하게는 **스펙 Constraints:54(타 모드 불간섭)를 코드로 강제하는 것이 하나도 없게 만든다.** 그래서 연결 지점 2곳을 명문화한다:

1. **Step 7d** — `chat.js`의 `onRoutineProposed`가 카드를 그리기 **전에** `getAgentConsoleSessionId()`로 활성 대화를 확인하고, 에이전트 관제 대화가 아니면 **그리지 않는다**. 렌더러에는 이미 `window.AthenaCanvasMode.state.view`가 있다(origin 실측 `app/chat.js:1315` — 제출 payload에 `canvasMode`로 동봉).
2. **Step 7d** — `isDerivedAlertRoom(roomId)`가 참인 방(01번 알림 파생 방 = 예외 창)에서는 제어 제안 카드를 그리지 않고 **`관제 창으로 →` 합류 버튼만** 남긴다. Step 2의 01 보드 정정과 짝이 맞는다. 이 판정은 **`agent-proposal.js`가 소유**하므로 렌더러가 그대로 부를 수 있다(합의 6차).

**제거 조건 (명문, 3차 갱신):** 정의를 "활성 대화 기준"으로 바꿨으므로 데몬 착륙이 이 함수를 무효화하지 않는다. 대신 교체가 필요해지는 시점은 **한 사람이 관제 대화 2개를 동시에 띄워 놓고 둘 다에 제안이 흘러야 하는 요구**가 생길 때이며, 그것은 `session-persistence-spec.md:130`의 "상주 채팅 세션은 프로세스 전역 하나"가 풀리는 시점(Athena 데몬, §5·화면 39·43)이다.

**범위 방어:** 어댑터는 판정 2개만 제공한다. 창 생성·복원·스냅샷·펜 시트는 **만들지 않는다**(Non-Goals:67 · 펜 시트는 위 표대로 이미 origin이 소유한다).

### 1.5 결정 (c) — 작업 순서

| 옵션 | 순서 | Pros | Cons |
|---|---|---|---|
| **c-1 (채택)** Paper 전량 선행 → PDF → 검수 게이트 → 앱 | 01~06 정정 + 07·08 신설 → `export_combined_pdf` → 사용자 승인 → 앱 | ① **검수 게이트가 1회**만 선다(D-2) ② 앱 렌더러가 **승인된 문구**를 상대로 작성돼 재작업이 없다 ③ 프로브 단언이 확정 문구를 참조할 수 있다 | ① 검수 반려 시 Paper 재작업 — 다만 앱을 안 건드린 상태고 Step 6-B 분할로 문구 의존 코드도 아직 안 쓴 상태라 손실이 최소다 |
| c-2 제어 묶음 A~E별 인터리브 | A 보드+A 앱 → B 보드+B 앱 → … | 묶음마다 종단 검증 | ① **검수 게이트가 5회** 선다 — ralph 순차 실행에서 5회 정지 ② 05 보드의 이중 제어 규칙 3줄과 07·08 보드는 A~E를 가로질러서 묶음 단위로 쪼갤 수 없다 ③ Paper 활성 페이지 왕복이 5배 |
| c-3 앱 선행 → Paper 후행 | 앱을 먼저 만들고 Paper를 맞춘다 | 앱 피드백이 빠르다 | Paper가 SSOT라는 확정(`PAPER_DESIGN_AUDIT.md` 결정 로그 2026-09-01 "에이전트 설계의 원본은 `에이전트` 페이지 6장")을 뒤집는다 |

**채택: c-1**, 단 **문구-무관 작업을 게이트 앞으로 당겨 놓는다.** ⚠ **합의 3차 정정 — "게이트 대기 중 병행"은 ralph에게 성립하지 않는다.** ralph는 순차 executor이고 §4 머리말이 "각 Step은 검증이 통과해야 다음으로 넘어간다"로 순차성을 못 박았으므로, 6-A가 Step 5 **뒤에** 있으면 ralph는 Step 5에서 멈추고 6-A에 **도달하지 못한다.** 사람 팀에게는 의미가 있던 "병행 가능"이라는 서술이 순차 실행자에게는 아무것도 아니다 — **배치 순서가 곧 병행 여부**다. 따라서 이 계획은 6-A를 **물리적으로 Step 4와 Step 5 사이에 배치**하고, Step 5의 선행 조건에 "6-A 검증 통과"를 넣는다(번호는 교차 참조 보존을 위해 `6-A`를 유지한다 — §4 머리말의 실행 순서 표가 실제 순서의 권위다). 다만 초안의 "Step 6 전체가 문구-무관"이라는 전제는 **부정확했다**: 6a가 만드는 `propose` 응답에는 `rationale`·`notice` 같은 **사용자 노출 문자열**이 실려 07 보드 카드 본문으로 그대로 흐른다. 따라서 Step 6을 둘로 쪼갠다.

| 분할 | 내용 | 검수 게이트와의 관계 |
|---|---|---|
| **6-A (Step 5 **앞에서** 실행)** | 6a enum·`propose` 디스패치 골격 · 6b 백엔드 테스트 · 6c REST `POST /{id}/update` · 6d main.js IPC·포워더 · 6e preload 채널 · 6f `agent-session.js` 어댑터 | **문구 무관.** enum 식별자(`confirm`·`pause`·`update`·…)는 IPC 채널명과 REST 동사에서 오지 07 보드의 한국어 문구에서 오지 않는다. 검수 결과와 독립이므로 게이트 앞에 두어도 재작업이 없다 |
| **6-B (검수 승인 후)** | 6a의 `notice`/`rationale` **사용자 노출 문구** 확정 · 7c `proposalCardModel`·`resultCardModel`의 문자열 | 07·08 보드 승인 문구가 단일 원본이다. 승인 전에 쓰면 반려 시 재작업 |

렌더러 GUI(Step 7) 전체도 승인된 문구를 요구한다.

> **주의 — "게이트 1회"는 검수 게이트에 한한 이야기다.** 이 계획의 사람 정지점은 **총 2개**다(Step 5 검수 · Step 9 라이브 시연). Step 9는 작업 순서 결정 (c)와 무관하게 GUI 클릭이 필요해 생기는 정지점이며, 어느 순서를 택해도 사라지지 않는다. c-1이 줄이는 것은 **검수 게이트 횟수**(1 vs c-2의 5)다. D-2의 "한 번만"은 이 좁은 의미로 읽는다.

### 1.6 결정 (d) — 조건 원문 읽기 계약 (**합의 4차 신설 — 3차의 치명 결손**)

**질문:** 06 설정 폼과 07 A열 제안 카드는 `condition.source`/`op`/`value`/`consecutive_ticks`를 **어디서 읽는가.**

**결손의 실체(실측).** 3차는 "06 폼이 소스별로 분기한다"를 최대 정정으로 내걸고 **쓰기**(`POST /{id}/update`)만 신설했다. 그런데 그 분기가 서야 할 **읽기 계약이 존재하지 않는다.**

| 사실 | 근거(origin/main 실측) |
|---|---|
| `_view()`는 `condition`을 통째로 뺀다 — 나가는 것은 `source_label`(`"현재가"` 같은 한국어 라벨) 하나뿐 | `backend/athena_api/api/routines.py:111` 독스트링이 *"조건 원문 dict 대신 사람이 읽는 해석문만 노출한다"*고 선언하고, `:118-142` 반환 dict에 `condition` 키가 **없다** |
| 단일 루틴 GET 라우트가 없다 | 라우터 **12개** 실측: `POST /draft` · `GET ""` · `GET /briefing-budget` · `POST /{id}/confirm·pause·resume·cancel·catchup-fire·briefing-result` · `GET /{id}/runs` · `POST /{id}/engagement·ack` |
| `GET /{id}/runs`도 spec을 안 낸다 | `routines.py:374-424` — ledger 행 + `avg_duration_ms`·`opened_rate`·`replied_count`만 |
| 렌더러가 읽는 것은 목록 행뿐이다 | **`app/lib/agent-canvas.js:997-1014`**(4차의 `:996-1014`은 정정) `historySettingsFields(item)`가 `item.raw`만 읽고, **`['조건', r.note]`로 `note`를 "조건"이라 라벨한다**(`:1000`) — 실제 술어는 화면 어디에도 없다 |
| **소스 카탈로그도 앱 어디에도 없다**(합의 5차 신설 — 결정 e의 출발점) | `grep -rn "price.current\|source_spec\|value_type\|spec.ops\|SOURCES" app/lib/*.js app/canvas.js app/chat.js` → 유일한 히트가 **`app/chat.js ≈:2949`의 주석 한 줄**. 즉 술어를 받아와도 «어떤 연산자를 제시할 것인가»를 모른다 → **§1.7 결정 (e)** |
| 모델이 읽는 것도 목록뿐이다. 단 **술어를 산문으로는 이미 본다** | 6a의 `propose` 분기는 `GET /api/v1/routines`만 부른다. ⚠ **합의 5차 정정(머리말 철회 5)** — 4차가 여기 적은 *"모델이 보는 조건도 `source_label` 한국어 라벨뿐이다"*는 **거짓이다.** `rules.py:168-169`가 `if not note: spec.note = spec.human_summary()`로 note 미지정 루틴의 note를 채우고 `models.py:168-179`가 `f"{symbol} · {label} {op} {value} · 방식 {mode}"`를 만들며, `_view`(`routines.py:122`)가 그 `note`를 그대로 낸다. 모델에게 **가지 않는 것은 기계 판독 소스 키(`price.current`)와 연산자 집합**(`models.py:22-25,42-51`)이며, 그것이 "모델이 유효한 술어 패치를 조립할 수 있는가"를 가른다 |

즉 3차 명세대로 구현하면 실행자에게 남는 선택지는 **(i) 현재값을 못 채우는 빈 폼**이거나 **(ii) `"현재가"`에서 `price.current`를 역추론하는 파서 발명**뿐이고, 후자는 R20이 막으려던 실패("폼에 넣은 값과 다른 결과")의 재발이다. 둘 다 P3 위반이다. `_view`의 축소는 **의도로 선언된 계약**이므로 되돌리는 것은 6c와 동급의 결정이며, 옵션 표 없이 ralph에게 넘기지 않는다.

| 옵션 | 모양 | Pros | Cons |
|---|---|---|---|
| d-1 | `_view`에 `condition` 블록 추가 | ① 신규 라우트 0 ② 목록 한 번으로 폼이 다 채워진다 ③ 대화 경로도 조건 편집을 **제안**할 수 있게 된다(스펙 A의 "조건"이 대화 경로에도 남는다) | ① `_view`가 **모델 도달 표면**이다 — 모델에게 지금은 볼 수 없는 기계 판독 술어를 넘겨 **D-1의 정신을 줄인다** ② `_view` 독스트링이 선언한 계약을 정면으로 뒤집는다 ③ 목록 응답이 루틴 수만큼 커진다 |
| **d-2 (채택)** 신규 `GET /api/v1/routines/{routine_id}` — **렌더러 전용 상세** | **폼 프리필에 필요한 키만** 낸다(합의 5차에 응답 형태를 좁혔다 — 아래 「반환 키 목록」) + `"condition": {source, op, value, consecutive_ticks}` + **`"source_spec": {ops, value_type, transport, label}`**(결정 e). **`GET /briefing-budget`(`≈:186`) 뒤에 선언**해야 경로 충돌이 없다(FastAPI는 선언 순서로 매칭 — `/briefing-budget`이 `/{routine_id}`에 먹히지 않게) | ① **모델이 조립 가능한 표면은 동결된다** — `test_propose_only_reads_list`가 `GET /api/v1/routines` **외의 어떤 path도** `AssertionError`로 막으므로 이 라우트는 모델에게 존재하지 않는 것과 같다 ② 이름이 하는 일을 그대로 말한다 ③ 폼·프로브·테스트가 한 곳을 본다 | ① 라우트 1개 + IPC 채널 1개(`athena:routine-detail`) + preload 1줄 + main 핸들러 1개가 는다 ② 라우터 12개가 전부 `/{id}/<동사>`인데 이것만 무동사 GET이다(REST 관례로는 오히려 표준) |
| d-3 | 기존 `GET /{id}/runs` 응답에 `spec.condition` 동봉 | ① **신규 라우트 0 · 신규 IPC 0** — 드릴인이 이미 `athena:routine-runs`를 부른다(`app/canvas.js`의 `fetchRuns`·`fetchAvgDuration`·`fetchEngagement`가 같은 응답의 다른 필드를 뽑는 선례 3개, `≈:3023·3030·3036`) ② 기존 테스트는 키 접근만 하므로 키 추가가 안전하다(`test_routines_api.py:310·351-352·423`) | ① **이력 엔드포인트가 명세를 낸다** — 이름과 내용이 어긋나고, 편집 기능을 고칠 때 `/runs`를 만져야 한다 ② 드릴인 왕복 3회가 매번 spec을 중복 운반한다 ③ "설정 폼이 왜 실행 이력을 읽는가"가 코드에 설명 없이 남는다 |

**채택: d-2.** 그리고 이 결정의 진짜 값은 **경로별로 읽기를 쪼갠 것**이다:

| 경로 | 볼 수 있는 것 | 편집 제안할 수 있는 것 |
|---|---|---|
| **대화**(모델) | `GET /api/v1/routines`(`_view`) — `note`·`cooldown_s`·`briefing_model`·`briefing_effort`·`expires_at`·`source_label`·`mode`·`status`·`symbol` | **공통 5필드**: `note` · `cooldown_s` · `expires_days` · `briefing_model` · `briefing_effort` |
| **GUI**(렌더러) | 위 + 신규 `GET /{id}`의 `condition` 블록 | 공통 5필드 + **GUI 전용 3필드**: `condition.op` · `condition.value` · `condition.consecutive_ticks` |

- **`expires_days`가 공통 5필드에 있는 근거(P3 점검).** `_view`는 `expires_at`(절대 시각)만 준다. 모델은 그것을 **현재 상태로 표기**(`만료 2026-10-03`)하고 사용자가 말한 새 값만 일수로 제안한다 — 현재값을 지어내지 않으므로 P3를 만족한다. GUI 폼의 프리필 규칙은 Step 3-2에 따로 못 박는다(만료 드리프트 방지).
- **조건 술어를 대화 경로에서 뺀 대가는 숨기지 않는다.** 스펙 A 인벤토리는 설정 편집 대상을 `조건·모드·소스·쿨다운·브리핑 모델`로 열거하므로, 조건 술어를 GUI 전용으로 두는 것은 **대화 경로의 부분 축소**다. 사용자 확정 4("조용히 좁히지 않는다")에 따라 **Step 5의 U-5 확인 항목**으로 올린다. 기본안은 "대화로 조건 편집을 요청하면 `control:'view'` 결과 턴이 설정 탭을 연다"이고, 대안(d-1로 바꿔 모델에게 술어를 보여주기)의 비용도 U-5에 함께 적는다.
- **AC 재진술:** ①-7·②-1의 집합 동일성은 **경로별로** 쪼갠다 — `GUI 폼 편집 가능 필드 == 8필드 ∩ 그 소스에서 유효한 필드` / `대화 propose.proposed 허용 키 ⊆ 공통 5필드`. 진술이 약해지는 게 아니라 **경로마다 반증 가능해져 강해진다.**

**반환 키 목록 — 응답을 폼 프리필에 필요한 키로 좁힌다(합의 5차 신설).** 4차는 반환을 *"`_view(spec, runtime)` 결과 + `condition` 블록"*으로 적었다. 문자 그대로 구현하면 `_view(spec, runtime, *, latest_fired=None)`(`routines.py:108-110`)에 `latest_fired`가 주입되지 않아 **이미 발화한 루틴에도 `last_fired_at: null`·`unread: false`**가 나가고, 더 나쁘게 **예약 루틴은 `missed`가 항상 `true`**가 된다 — `_is_missed(missed_at, None)`이 `last_fired_at is None`에서 **`return True`**이기 때문이다(`routines.py:79-80`). Step 7a는 `routine.missed === true`를 `지금 실행` 버튼의 활성 조건으로 쓰므로(R7), 이 응답이 목록 행 갱신에 재사용되면 **죽은 버튼이 아니라 409를 부르는 거짓 활성 버튼**이 생긴다. 두 안 중 **(b)를 채택한다** — (a) 상세 라우트가 최신 fired 행 1건을 조회해 `latest_fired`로 주입 / **(b) 응답을 아래 키로 좁히고 `last_fired_at`·`unread`·`missed`를 애초에 내지 않는다.** (b)가 "렌더러 전용 상세"라는 이름과 정합하고 비용이 0이며, "읽어올 수 없는 값을 선언하지 않는다"(P3)를 지킨다.

```
GET /api/v1/routines/{routine_id} 반환 키 (이 목록이 계약이다 — ②-9b ①이 등호로 단언한다)
  id · symbol · status · mode · source_label · cooldown_s · expires_at · note
  briefing_model · briefing_effort · activation_blocker · experimental_source
  goal                                                          (합의 6차 편입 — 아래 사유)
  condition    = {source, op, value, consecutive_ticks}          (결정 d-2)
  source_spec  = {ops, value_type, transport, label}             (결정 e)
```
`last_fired_at`·`unread`·`missed`·`next_fire_at`·`created_at`·`approved_at`은 **내지 않는다** — 목록(`GET ""`)이 소유하고 그쪽만 `latest_fired`를 주입받는다. 같은 키 이름이 두 엔드포인트에서 다른 진실을 말하는 상태를 만들지 않는다.

⚠ **`goal`의 처리를 명시한다(합의 6차 — 5차는 이 키를 어느 쪽에도 넣지 않았다).** 실측 `git show origin/main:backend/athena_api/api/routines.py | grep -n '"goal"'` → **`:123` `"goal": spec.goal`** — `_view`는 이 키를 낸다. 그런데 5차의 반환 키 목록은 `goal`을 **포함하지도, "내지 않는다" 목록에 넣지도** 않았고, ②-9b ①이 반환 키 집합을 **등호로** 단언하므로 실행자가 임의로 정하고 테스트가 그 임의 선택을 고정했을 자리다 — "응답을 좁혔다"(R33)는 결정의 감사 가능성이 한 키만큼 비어 있었다. **`goal`은 낸다** — `to_dict()`가 `goal`을 싣으므로(`models.py:189`) `update` 왕복이 이 값을 보존하려면 폼이 그것을 읽을 수 있어야 하고, `last_fired_at` 계열과 달리 **`latest_fired` 주입 없이도 참인 값**이라 R33의 사유가 적용되지 않는다.

### 1.7 결정 (e) — 소스 카탈로그를 렌더러가 어디서 얻는가 (**합의 5차 신설 — 4차의 치명 결손**)

**질문:** 06 설정 폼·05 시트가 제시할 **비교 선택지(`ops`)·값 컨트롤(`value_type`)·`연속 틱` 노출(`transport`)**을 렌더러는 무엇을 보고 정하는가.

**결손의 실체(실측).** 4차는 결정 (d)로 *"이 루틴의 술어가 무엇인가"*(`condition`)를 가져오게 했지만, *"그 소스에서 무엇이 유효한가"*(카탈로그)는 아무 데서도 오지 않는다.

| 사실 | 근거(origin/main 실측) |
|---|---|
| 앱 전체에 소스 카탈로그가 **0건**이다 | `grep -rn "price.current\|source_spec\|value_type\|spec.ops\|SOURCES" app/lib/*.js app/canvas.js app/chat.js` → 유일한 히트는 **주석 한 줄**(`실제 draft(SOURCES 카탈로그 조건-감시형)에는`). ⚠ **앵커는 좌표가 아니라 `SOURCES 카탈로그` 문자열 자체다(합의 6차 정정).** 5차는 이 자리를 `app/chat.js:2524`로 적었는데 그것은 **로컬 `HEAD` 좌표**였다 — 실측 `git show origin/main:app/chat.js \| grep -n "SOURCES 카탈로그"` → **2949**, `git show HEAD:app/chat.js \| …` → **2524**. `chat.js`는 머리말이 스스로 "이동 9파일"로 지정한 파일인데 이 좌표만 `≈` 없이 **6곳**에 박혀 있었다 — 철회 3(`chat.js` 확정 칩)·철회 4(`canvas.js` D-그래프)와 **같은 실패 모드의 세 번째 재발**이고, 이번에는 그 두 철회를 쓴 라운드가 새로 세운 결정의 근거 표 안에서 났다. **결론(앱 카탈로그 0건)은 origin 실측으로 참이므로 결정 e-1은 유효하다 — 고친 것은 좌표뿐이다.** Step 0e의 `chat.js` 행에 이 이름을 편입했다 |
| 그런데 폼 모양 전체를 카탈로그가 결정하라고 적혀 있다 | Step 3-1 · Step 3-2 「분기 규칙」 표 · Step 7a 설정 패널 행 · AC ①-7 · ②-1 추가 단언 ① · 8c 신규 단언이 전부 `spec.ops`·`spec.value_type`·`spec.transport`를 근거로 쓴다 |
| 4차의 `GET /{id}`는 그중 아무것도 주지 않는다 | 반환이 `condition = {source, op, value, consecutive_ticks}` **4키**뿐이다(`rules.py:32 _ALLOWED_CONDITION_KEYS`와 같은 집합) |
| `mode`로 역산할 수도 없다 | `price.current`와 `vi.triggered`는 **둘 다 `mode:'realtime-ws'`**인데 `_NUM_OPS`(4종)/number vs `_EQ_OPS`(`==` 1종)/bool로 갈린다(`models.py:22-25,42-51`) — `transport`는 유도되지만 **`ops`·`value_type`은 유도 불가**다 |
| 05 `＋ 새 작업` 시트는 routine_id가 아예 없다 | 상세 라우트로도 해결되지 않는다 — Step 3-1이 시트에도 같은 분기를 요구한다 |

즉 §1.6이 `condition` 원문에 대해 세운 진단(*"실행자에게 남는 선택지는 빈 폼이거나 라벨 역추론 파서뿐이다"*)이 **한 층 위에서 글자 그대로 재현된다.** 실행자에게 남는 것은 (i) 연산자 목록을 **지어내거나**(3차가 `>=·<=·>·<·==`로 저지른 그 오류 — `_NUM_OPS`에 `==`가 없어 **422를 부르는 거짓 선택지**, P3) (ii) 백엔드 카탈로그를 JS로 **복사하면서 동기화 계약을 발명**하거나 둘뿐이다.

| 옵션 | 모양 | Pros | Cons |
|---|---|---|---|
| **e-1 (채택)** 서버가 실어 보낸다 — 상세 응답에 **`source_spec` 블록** + 시트용 **카탈로그 라우트 1개** | `GET /{routine_id}` 응답에 `"source_spec": {ops, value_type, transport, label}`. 그리고 routine_id가 없는 05 시트를 위해 **`GET /api/v1/routines/source-catalog`** 신설 — 활성 `SOURCES` 6종을 `{source: {ops, value_type, transport, label, experimental}}`로 낸다(레거시는 내지 않는다 — 신규 생성이 불가능하므로) | ① **렌더러 사본이 0이다** — 두 벌 발산이 구조적으로 불가능하다 ② 둘 다 렌더러 전용이라 모델 도달 표면 무변경(`test_propose_only_reads_list`가 두 path 모두 차단) ③ 비용은 dict 직렬화 1개 + 라우트 1개 ④ 소스가 늘거나 `ops`가 바뀌면 화면이 **자동으로** 따라온다 | ① 신규 라우트가 1개 더 는다(총 3: `/{id}/update` · `/{id}` · `/source-catalog`) ② IPC 채널 1개 추가(`athena:routine-source-catalog`) + preload 1줄 |
| e-2 | 렌더러에 사본 상수 + 8a-2와 같은 성질의 **발산 단언** | ① 라우트·IPC 0 ② 시트도 즉시 그린다(왕복 없음) | ① **두 벌 상수가 6소스 × 4속성 표면에서 갈라질 수 있다** — 8a-2가 채널명 12개에 대해 정성껏 막은 것을 훨씬 큰 표면에서 다시 감수한다 ② 발산 단언이 백엔드 `SOURCES` 덤프를 fixture로 떠야 해서 그 fixture 자체가 낡을 수 있다 ③ 실패 모드가 **런타임 422**(사용자가 저장을 누른 뒤)라 늦게 드러난다 |
| e-3 | 06 폼을 활성 6종 하드코딩으로 그리고 그 사실을 U 항목으로 올린다 | 구현이 가장 짧다 | e-2의 단점 전부 + **사실을 계획이 아니라 사용자에게 떠넘긴다.** 카탈로그는 사용자 선호가 아니라 코드 사실이라 U 항목의 성격이 아니다. **기각** |

**채택: e-1.** 근거는 이 계획이 채널명에 대해 이미 내린 판단의 반대편이다 — 채널명은 **두 렌더러가 각자 부르므로** 사본이 불가피해 단언으로 지켰고(8a-2), 카탈로그는 **서버가 유일 소유자이므로** 사본을 만들지 않는 것이 옳다. 「사본을 만들고 단언으로 지킨다」는 사본이 불가피할 때의 차선책이지 기본값이 아니다.

- **`GET /source-catalog`의 선언 위치도 계약이다** — `/{routine_id}`보다 **앞에** 선언한다(R26과 같은 이유: 뒤에 두면 `routine_id="source-catalog"`로 먹힌다). 선언 순서는 `/briefing-budget` → `/source-catalog` → `/{routine_id}`다. ②-9b ⑤가 이 회귀를 단언한다.
- **모델 차단:** 두 신규 path 모두 `test_propose_only_reads_list`의 허용 집합 `{"/api/v1/routines"}` 밖이므로 모델에게 존재하지 않는다(D-1 무변경).
- **AC 정합:** ②-1 추가 단언 ①의 테이블 구동 테스트는 카탈로그를 **주입**받아 돌지만(순수 함수 단위 테스트), 8c 프로브의 신규 단언은 **실제 폼이 카탈로그 응답에서 선택지를 그렸는지**를 본다 — 전건 통과하면서 화면이 거짓말하는 경로를 닫는다.

### 1.8 결정 (f) — GUI 설정 편집 폼이 어디에 사는가 (**합의 5차 신설 — 4차의 도달성 결손**)

**질문:** 소스별 분기 편집 폼을 드릴인 `설정` 탭에 두면 **예약·초안 루틴에서 열 수 있는가.**

**결손의 실체(실측).** 열 수 없다. 게이트가 **둘**이다:

| 사실 | 근거(origin/main 실측 — 이 파일은 "차이 0" 범주) |
|---|---|
| 설정 탭은 **드릴인 전용**이다 | `app/lib/agent-canvas.js:298-299` 주석 — *"드릴인 세그먼트 [이력][설정] … 드릴인에서만 보인다"* |
| 드릴인 진입 버튼은 **watch에서만** 그려진다 | 바깥 게이트 `if (item.kind !== 'draft')`(**`:1525`**) + 안쪽 게이트 `if (item.kind === 'watch')`(**`:1533`**) → `전체 이력 보기 →`(`:1536`, `openHistory` `:1063`) |
| 그 축소는 **파일 머리말이 계약으로 적어 뒀다** | `agent-canvas.js:59-62` — *"draft·예약(schedule)은 이 링크가 없다"* |
| 예약·초안은 kind가 다르다 | `allItems()`(`:1294-1332`)가 `mode==='scheduled'` → `kind:'schedule'`, `status==='draft'` → `kind:'draft'` |

즉 4차 명세대로 구현하면 Step 7a의 편집 폼·`fetchCondition(id)`·`saveRoutineSettings`가 **감시 루틴에서만 도달 가능**하고, **9c 2행의 GUI 다리가 실행 불가**다 — 9b가 심는 예약 루틴(`schedule.daily`)의 설정 탭을 사람이 열 수 없으므로, 3차가 *"소스별 분기가 이 충돌을 닫는다"*고 적은 그 충돌 지점에 **애초에 도달하지 못한다.** 그런데 ②-1의 테이블 구동 테스트는 폼 함수를 직접 부르므로 **전건 통과**하고 8c 프로브도 watch fixture로 **통과한다** — R29의 계열이다.

| 옵션 | 모양 | Pros | Cons |
|---|---|---|---|
| f-1 | 드릴인 링크를 `kind==='schedule'`에도 연다 | 기존 구조 유지 | ① **초안이 남는다** — 바깥 게이트 `:1525`가 draft를 먼저 걸러내므로 조건 한 줄로는 안 되고 **두 게이트를 다 손대야** 한다 ② 그러면 draft 드릴인에 *"최근 실행"* 섹션이 빈 채로 열려 `:1525` 주석이 지킨 계약(*"빈 로그를 지어내 보여주지 않는다, P3"*)을 깬다 ③ schedule 드릴인 ledger 대응은 `:1533-1535` 주석이 *"다음 스코프로 이연"*이라 적어 둔 별건이다 |
| **f-2 (채택)** 설정 폼을 드릴인이 아니라 **상세 패널(`renderDetail`)**로 옮긴다 | 상세 패널은 **세 kind 전부에서** 그려진다 — 4차가 `확정` 버튼을 넣기로 한 바로 그 자리다. 드릴인 `설정` 탭은 **읽기 전용 요약 + `설정 편집` 버튼**만 남긴다(합의 6차 동작 재정의 — 아래 부록) | ① **세 kind를 한 번에 덮는 유일한 안**이다 ② 자리 비용이 이미 지불됐다 — `확정` 버튼이 들어가는 같은 패널이고 콜백 주입 경로가 같다 ③ `agent-canvas.js:22-27`의 *"상세 패널은 draft 항목에서 읽기 전용(액션 버튼 없음)"* 계약은 **4차가 이미 번복하기로 한 것**이라 새 번복이 아니다 ④ 8c 프로브의 설정 단언이 드릴인 진입에 의존하지 않게 되어 fixture가 단순해진다 | ① Step 7a의 대상 위치가 `:1017-1051 설정 패널`에서 `renderDetail`로 바뀐다(작업량은 같고 위치만 다르다) ② 드릴인 `설정` 탭이 **요약 전용**이 되므로 그 탭의 기존 프로브 단언 문면을 함께 고쳐야 한다(8c) ③ 06 보드가 폼을 상세 패널 맥락으로 그려야 한다(Step 3-2) |
| f-3 | "GUI 설정 편집은 감시 루틴 전용"을 선언하고 **U-6**으로 올린다 | 코드 변경 0 | ① D2("GUI도 모든 제어")의 명시적 축소라 사용자가 반려할 개연성이 크고, 반려되면 f-2를 그때 하게 된다(재작업) ② 06 보드가 그리는 `schedule.daily` 폼에 **앱 대응물이 없어져** 보드 문구까지 고쳐야 한다 ③ 9c 2행이 예약 루틴에서 성립하지 않아 시연 표가 다시 어긋난다 |

**채택: f-2.** 다만 **f-3의 질문 자체는 사라지지 않는다** — f-2를 택해도 "드릴인 `설정` 탭이 요약 전용이 되는 것"은 화면 변화이므로 **Step 5의 U-6 확인 항목**으로 올린다(사용자 확정 4: 화면 계약 변경을 조용히 넘기지 않는다). 기본안은 f-2이고, 대안(f-3, 감시 전용 선언)의 비용도 U-6에 함께 적는다.

**부록 — `설정 편집` 버튼의 동작을 정의한다(합의 6차 · f-2가 만든 죽은 링크를 닫는다).** 5차는 드릴인 `설정` 탭에 **`설정 편집 ↓`(상세 패널로 스크롤)**를 남기기로 했는데, **드릴인이 열려 있는 동안 상세 패널은 화면에 존재하지 않는다.** 실측 — `detailCol`은 `panels`에 붙고(`app/lib/agent-canvas.js:498`) `panels`는 `body`에 붙는데(`:499`), **`openHistory(item)`가 `body.hidden = true`(`:1076`)로 그 트리를 통째로 숨긴다**(`closeHistory`가 `:1104`에서 되돌린다). 즉 드릴인 `설정` 탭이 보이는 동안 상세 패널은 DOM에 있으나 **렌더되지 않으며, 「상세 패널로 스크롤」은 물리적으로 불가능하다.** 그 결과 5차의 `설정 편집 ↓`는 **아무 데도 데려가지 않는 버튼**이 되고, 8c의 신규 단언은 *"요약 + 그 버튼이 있다"*만 보므로 **전건 통과한다** — R29(*"화면에 적힌 규칙이 약속한 버튼이 없는데 자동 게이트는 전건 통과한다"*)·R32(도달성 결손)와 **정확히 같은 계열**이며, 계획이 그 계열을 닫았다고 선언한(8a-5) 바로 그 라운드가 새로 만든 자리다. 도달성 부류 단언(②-1 ⑤)도 이것을 못 잡는다 — 그 단언은 진입로를 **상세 패널 쪽에서** 보므로 드릴인 쪽 링크의 사망을 관측하지 않는다.

**확정 동작(라벨에서 `↓`를 뺀다 — 아래로 스크롤이 아니다):** 드릴인 `설정` 탭의 **`설정 편집`** 버튼은 ① `closeHistory()`를 부르고 ② 그 항목을 상세 패널의 선택 상태로 둔 뒤 ③ 상세 패널 설정 폼의 첫 입력에 **포커스**한다. 8c의 신규 단언도 *"입력 0인 요약이 있다"*가 아니라 **"그 버튼을 누르면 실제로 편집 폼이 화면에 뜬다"**(`body.hidden === false` + 폼 입력 ≥1 + 포커스)로 바꾼다.

**부류 단언으로 재발을 막는다(Architect 융합 경로 채택).** 잎사귀 단언(버튼 1개·라벨 1개·채널 1개)을 늘리는 대신 **도달성 단언**을 신설한다 — `agent-canvas.test.js`가 **루틴 kind 3종(`watch`·`schedule`·`draft`) 각각에 대해 설정 편집 진입로가 존재한다**를 단언한다(②-1 추가 단언 ⑤). 이 한 줄이 이번 결손을 잡고, 다음에 같은 계열이 생겨도 잡는다.

---

## 2. Requirements Summary

스펙 Goal/Constraints/Non-Goals를 넓히지 않고 그대로 옮긴다.

**목표 (2개 기조)**
- **D1 모드가 대화의 경계다.** 에이전트 = `mode='agent'` 대화 창. **관제 창 하나 = 대화 하나** — 루틴·알람·제안·실행이 전부 그 한 방으로 흐른다. 01번 "알림 파생 방"은 오브 진입 시에만 생기는 **예외 창**이며 관제 창과 별개다.
- **D2 이중 완전 제어.** 제어 인벤토리 A~E의 모든 동작이 대화로도, GUI로도 된다. 동선 규칙 ①②③은 "채팅 경로"로 존속하고 GUI 경로가 나란히 추가된다. 상세·설정 "보기 전용"은 폐기한다.

**제어 인벤토리 A~E (전부 이중 제어)**

| 묶음 | 동작 | 게이트 | 실행 경로(확정 후) |
|---|---|---|---|
| A 작업 생명주기 | 생성 · 설정 편집 · 확정 · 일시중지 · 재개 · 취소 | 칩/버튼 | **`routine-draft`(신설, a″-1)** · **`routine-update`(신설 — 대응 control `update`도 함께 신설, §1.3 표)** · **`routine-detail`(신설 읽기 — 결정 d-2, 설정 폼이 조건 술어와 `source_spec`을 읽는 유일한 경로)** · **`routine-source-catalog`(신설 읽기 — 결정 e-1, routine_id가 없는 05 시트가 선택지를 얻는 경로)** · `athena:routine-confirm`(**대화 칩 + GUI 상세 패널 `확정` 버튼 둘 다** — 합의 4차) · `routine-pause` · `routine-resume` · `routine-cancel` |
| B 알람 | 개별 읽음 · 모두 읽음 · 알람에서 이어가기 | 칩/버튼 | `athena:routine-ack`(개별·전량 루프) · `AthenaNotify.selectRoom` |
| C 제안 | 루틴으로 채택 · 보류 · 말걸기 가드 조정 | 칩/버튼 | `athena_routine` draft → `athena:routine-confirm` · 렌더러 로컬 보류 · `athena:nudge-guard-set` |
| D 뷰 상태 | 탭 · 필터 · 검색 · 드릴인 · 캔버스↔채팅 · 그래프 근거 | **즉시(칩 없음)** | `agentCanvas.setActiveView/setActiveTab/setSearch/openDrillIn` · `AthenaCanvasMode.setView` |
| E 실행 | 지금 실행(catchup-fire) · 브리핑 결과 열기 | 지금 실행=칩/버튼 · 결과 열기=즉시 | `athena:routine-missed-confirm` · 드릴인 run 행 |

**제약 (요약)**
- 상태 변경 게이트 = "두 입구, 한 게이트". MCP는 제안만, 실행 없음.
- **모델 도달 읽기 표면 동결(결정 d-2·e-1).** 조건 원문(`condition`)과 소스 카탈로그(`source_spec`)는 신규 **렌더러 전용** `GET /api/v1/routines/{id}`·`GET /api/v1/routines/source-catalog`로만 나가고, 모델이 부르는 path는 여전히 `GET /api/v1/routines` 하나다(`test_propose_only_reads_list`가 허용 집합을 등호로 고정). ⚠ **문면 정정(합의 5차 · 머리말 철회 5):** "동결"의 뜻은 *"모델이 술어를 전혀 못 본다"*가 **아니다** — 자동 생성 `note`가 술어를 산문으로 이미 넘긴다(`rules.py:168-169` + `models.py:168-179`). 동결되는 것은 **기계 판독 소스 키와 연산자 집합**이며, 그래서 모델은 유효한 술어 패치를 조립할 수 없다. 편집 제안 가능 키는 경로별로 갈린다 — 대화 공통 5필드 / GUI 공통 5 + 조건 3필드.
- **자동 생성 `note`의 신선도(합의 5차 신설).** `note`는 목록 행 제목·설정 표기·모델이 읽는 유일한 루틴 설명이므로, 조건을 편집하면 **자동 생성분은 새 술어를 반영하고 사용자 작성분은 불변**이어야 한다(Step 6-A c의 신선도 규칙 · ②-9 11번째 케이스).
- 타 모드(대화·그래프·플러그인·백테스트) 캔버스·채팅 흐름 불간섭.
- 공통 세션 기반은 외부 소유 — **재구현하지 않고 `origin/main` 기반 worktree 브랜치에서 받아 쓴다**(결정 b, 사용자 확정 1). 미소유 조각(펜 시트·다중 창)만 "관제 창 하나" 전제로 우회.
- MCP `propose.control` **12종** = 스펙 Constraints:55의 10종 + **`ack_all`**(스펙 B 인벤토리 "모두 읽음" 대응) + **`update`**(스펙 A 인벤토리 "설정 편집" 대응). 둘 다 스펙 인벤토리에는 있는데 Constraints 열거에서 빠진 항목이며 §1.3의 표가 출처를 기록한다. 그 외 범위 확장·축소 없음.
- 기존 6보드 삭제 금지(정정), 신규는 같은 페이지 A-2에 `07~`, 아트보드 높이 픽셀 고정, 작업 후 활성 페이지 원위치.
- 디자인 기조 상속: 헌장 §1 표면 공통분 + `PAPER_DESIGN_AUDIT.md` 색 역할(blue=현재 선택, amber=검토 필요, pink=주요 동작 한 곳). 오브 "눈 모양 하나" 무변경.
- 검수: 전 보드 PDF → 사용자 승인.
- 라이브 시연: 루틴 REST/WS 백엔드를 실제 프로세스로. 키움 실연결은 범위 밖(fixture 시세).

**비목표 (건드리지 않는다)**
- Athena 전 표면 기조 정본화 문서 · 에이전트 외 Paper 페이지 · 화면 35·38·40·41·42의 "승인 대기" 해소
- 공통 세션 인프라 구현(mode 필드·다중 창·펜 시트·스냅샷 복원·동시 실행)
- 카드→실앱 파리티 트랙 · 키움 실연결 E2E · 오브(키우미) 변경
- 루틴 엔진 기능 추가 · 라이브 컬럼 진행바·"다음 24시간" 타임라인의 실데이터 배선(현재 fixture, `PAPER_DESIGN_AUDIT.md:357`)

---

## 3. Acceptance Criteria (테스트 가능 형태)

> 이 절의 모든 `cd app` · `cd backend`는 **worktree 안에서** 실행한다(Step 0a의 `EnterWorktree` 이후 cwd가 worktree다). 줄 번호 앵커는 머리말의 앵커 규율을 따른다 — 이름이 계약이다.

### ① Paper 에이전트 페이지 (A-2)

| # | 기준 | 검증 방법(명령/파일/단언) |
|---|---|---|
| ①-1 | `01 · 셸 — 알림 파생 방`에서 "메인 대화와 섞이지 않습니다"가 사라지고 예외 창 표기 + 관제 창 합류 경로가 있다 | `find_nodes` on 보드 `56X-0`: 문자열 `메인 대화와 섞이지 않습니다` **0건**, `관제 창으로` **≥1건** |
| ①-2 | `02~06` 대화 영역 헤더가 `아테나 · 에이전트 대화`로 통일 | `find_nodes`: 보드 `ARM-0`·`B57-0`·`BIM-0`·`BV0-0`·`2IJN-2` 각각에서 `아테나 · 에이전트 대화` **≥1건**. 기존 동일 fixture 대화 3장은 루틴·알람·제안 턴이 한 방으로 흐르는 히스토리로 교체 |
| ①-3 | `02` 알람: `모두 읽음으로` GUI 유지 + 대화 경로 병기, 개별 읽음·이어가기 두 경로 표기 | 보드 `ARM-0`에 `모두 읽음으로` 1건, 대화 경로 칩 표기 ≥1건, `읽음` 행 액션 ≥1건 |
| ①-4 | `03` 실행 이력: `지금 실행` GUI 버튼 신설 + 대화 경로. 캔버스에서 열기·채팅으로 유지 | 보드 `B57-0`에 `지금 실행` 1건 + **비활성 상태 표기**(놓친 예약 없음일 때) 1건. `채팅에서 열기 ↗` 유지 |
| ①-5 | `04` 프로액티브: 루틴으로/보류 GUI 유지 + 대화 채택·보류 턴, 말걸기 가드 **GUI 편집 폼** + 대화 가드 조정 카드 | 보드 `BIM-0`에 입력 요소 **정확히 5개** + `저장` 1건. 5개의 내역: `하루 최대`(숫자 1) · `조용 시간 시작`·`조용 시간 끝`(**2입력** — `guard_settings.py:40-42`의 `QuietHours.start`/`.end`가 별도 필드다) · `근거 표시`(토글) · `거절 학습`(토글). **`max_daily_briefings`는 폼에서 제외하되 왕복 보존한다** — 스펙 C 인벤토리가 4항목(하루 최대·조용 시간·근거 표시·거절 학습)만 열거하므로 폼 노출은 범위 밖이다. ⚠ **2차의 "기본값으로 동작한다"는 거짓이었다(합의 3차 정정):** `POST /api/v1/nudge-guard`는 **전체 교체**이고(`backend/athena_api/api/nudge_guard.py:24-28` — `validate_guard_settings(body)` 결과로 `store.replace`), `guard_settings.py:110`이 `max_daily_briefings = raw.get("max_daily_briefings", 10)`으로 **결측 시 10으로 되돌린다.** 사용자가 5로 낮춰 뒀다면 조용 시간만 고쳐도 10으로 되살아난다(P3 위반 — 화면에 없는 값이 몰래 바뀐다). 따라서 **저장 payload는 `athena:nudge-guard-get`으로 읽은 현재 값의 `max_daily_briefings`를 그대로 실어 보낸다**(Step 7b `saveNudgeGuard`), 그리고 ②-1이 그 사실을 단언한다 |
| ①-6 | `05` 작업: `+ 새 작업` **시트(폼)** 신설, 동선 규칙 3줄 → **이중 제어 규칙 3줄**, 상세 패널에 **확정**·일시중지·재개·취소 GUI + 대화 경로 | 보드 `BV0-0`에 시트 아트보드 요소 1건, 규칙 캡션 `이중 제어 규칙` 1건, 규칙 3줄이 §4 Step 3의 확정 문구와 **문자열 일치**, 상세 패널 버튼 **4개**(`확정`/`일시중지`/`재개`/`취소`, status별 1개만 활성). ⚠ **합의 4차 정정 — 3차의 "버튼 3개"는 규칙 ③과 모순이었다.** 규칙 ③ `확정 — 채팅 칩으로도, 버튼으로도`가 Paper·앱·테스트·프로브의 단일 원본인데(R3) 어느 Step도 그 **버튼**을 만들지 않아, 구현 후 화면이 존재하지 않는 버튼을 약속한 채 자동 게이트는 전건 통과했을 자리다(P3 — 글자는 있는데 버튼이 없다) |
| ①-7 | `06` 설정: 보기 전용 폐기 → **소스별로 분기하는 편집 폼** + `저장`, `채팅에서 고치기 ↗` 병존 | 보드 `2IJN-2`에서 `이 화면에서는 값을 바꾸지 않습니다` **0건**, `저장` 1건, `채팅에서 고치기 ↗` 1건, `종목·소스는 취소 후 새로 만들기` 안내 1건. **개수 상수를 박지 않는다 — 합집합 등호로 단언한다(합의 5차 정정).** ⚠ **4차의 "읽기 전용 상태 표기 3건(`종목`·`모드`·`소스`)"은 실측과 충돌해 올바른 구현을 반려한다:** 현 패널 `historySettingsFields`(`agent-canvas.js:997-1014`)가 내는 라벨은 **9종**이고 — `조건`(=note, `:1000`) · `모드`(`:1001`) · `소스`(`:1002`) · `종목`(`:1003`) · `쿨다운`(`:1004`) · `브리핑 모델`(`:1009`) · **`다음 실행`**(`:1011`) · `만료`(`:1012`) · **`생성`**(`:1013`) — 이 계획이 `조건`을 술어 3입력으로, `쿨다운`·`브리핑 모델`·`만료`를 입력으로 바꾸고 나면 읽기 전용으로 남는 것은 **`모드`·`소스`·`종목`·`다음 실행`·`생성` 5종**이고 여기에 Step 3-2 프리필 규칙 1이 요구하는 보조 표기 **`만료 <YYYY-MM-DD>`**가 더해져 **최소 6종**이다. "정확히 3건" 등호 앞에서 실행자에게 남는 선택지는 (i) 현재 표시 중인 `다음 실행`·`생성`을 지워 정보를 회귀시키거나(P3) (ii) 계획 자신의 보조 표기를 빼거나 (iii) AC를 실패시키는 것뿐이다 — 4차가 `종목`에서 고친 결함과 **완전히 같은 계열**이다. **새 단언(개수 상수 없음 · 합의 6차에 양변을 런타임 유도로 맞췄다):** 판정 대상은 **상세 패널의 설정 폼**이다(드릴인 요약이 아니다 — f-2가 설정 표면을 둘로 쪼갰으므로 주어를 못 박는다). 그 표면에 대해 **루틴별로** `그 루틴의 설정 폼이 낸 모든 라벨 집합` == `(편집 가능 필드 라벨)` ∪ `(읽기 전용 표기 라벨)`이고 두 집합은 **서로소**이며, 양변의 정의는 각각 **런타임에서 유도한다** — 편집 가능 변 = `6c 화이트리스트 8필드 ∩ source_spec(condition.source) 유효 필드`(이미 이렇게 정의돼 있다), **읽기 전용 변 = `Step 3-2가 지정한 라벨 6종 ∩ 그 루틴에 실제로 존재하는 필드`**(합의 6차 신설 — 빠져 있던 절반). ⚠ **6종을 상수로 고정하면 감시(watch) 루틴에서 반드시 실패한다:** `historySettingsFields`(`agent-canvas.js:997-1014`)는 라벨을 **조건부로** 낸다 — `if (r.note)`(`:1000`) · `if (r.symbol)`(`:1003`) · `if (r.cooldown_s != null)`(`:1004`) · `if (r.briefing_model)`(`:1008`) · **`if (r.next_fire_at)`(`:1011`)** · `if (r.expires_at)`(`:1012`) · `if (r.created_at)`(`:1013`) — 그리고 `_next_fire_at`(`backend/athena_api/api/routines.py:19-21`)은 **`if spec.mode != "scheduled": return None`**이다. 즉 **감시 루틴에는 `다음 실행` 라벨이 존재하지 않는데**, V16·8c가 요구하는 kind 3종 fixture에 watch가 반드시 들어간다. 4차의 「정확히 3건」이 **개수에서 집합으로 옮겨갔을 뿐** 올바른 구현을 반려하는 성질은 5차까지 살아 있었다. **비대칭을 한 문장으로 적어 둔다: 편집 가능 필드는 값이 없어도 빈 입력으로 그리므로 존재 조건이 없고, 읽기 전용 표기만 존재 조건이 있다.** 읽기 전용 지정 라벨의 **구성은 Step 7a가 확정한다**(`다음 실행`·`생성` 유지 여부 포함). **편집 가능 집합은 경로별로 쪼갠다(결정 d):** `GUI 폼이 낸 편집 가능 필드 집합` == `(Step 6-A c 화이트리스트 8필드) ∩ (해당 루틴의 condition.source에서 유효한 필드)`이고, `대화 propose.proposed 허용 키` ⊆ **공통 5필드**(`note`·`cooldown_s`·`expires_days`·`briefing_model`·`briefing_effort`). 유효성은 **`source_spec(source)`**가 정하고(활성 `SOURCES` 6종 + 읽기 전용 `LEGACY_DISABLED_SOURCES` — **`models.py:42-51`·`:55-59`·`:107-111`**, 4차의 `:43-52`·`:53-58`·`:106-116`은 정정) 그 값은 **`source_spec` 블록으로 서버가 실어 보낸다**(결정 e-1 — 렌더러 사본 0) — 컨트롤 종류는 `spec.value_type`(number/bool/string), 비교 선택지는 `spec.ops`, `연속 틱` 노출 여부는 `spec.transport === 'ws'`(**`rules.py:100-101`**이 `consecutive_ticks>1`을 ws 전용으로 422). **레거시 소스 루틴은 편집 폼이 아니라 읽기 전용 + `이 작업은 취소 후 새로 만들기` 표기로 그린다**(Step 6-A c, ②-9 10번째 케이스). 06 보드는 대표 2종(`price.current` — number/`_NUM_OPS`, `schedule.daily` — string/`_AT_OPS`)을 **나란히** 그려 분기 자체를 검수받는다. 앱 쪽 단언은 `SOURCES` **6종 전부를 파라미터로 도는 테이블 구동 테스트 1건**이다(②-1) |
| ①-8 | 신규 `07 · 에이전트 대화 — 제어 제안 턴 A~E` | 페이지 A-2에 새 아트보드 1장, 이름 `07 · 에이전트 대화 — 제어 제안 턴 A~E`, 크기 1680×900 **픽셀 고정**, A~E 5열 각 1개 제안 턴 카드 |
| ①-9 | 신규 `08 · 에이전트 대화 — 결과 턴` | 새 아트보드 1장, 이름 `08 · 에이전트 대화 — 결과 턴`, 1680×900 픽셀 고정, 성공·거부·실패/재시도·뷰 이동 **4상태** |
| ①-10 | 게이트 통과 | `get_screenshot` 8장 육안 + `get_computed_styles`로: 하드코딩 hex 0(허용 알파 틴트 제외) · 겹침·잘림 0 · 클릭 영역 ≥32px. **문구 3원칙 위반 0 — 조작적 정의:** 이 계획이 신설·수정한 문자열 전체에 대해 `find_nodes` 결과를 대상으로 ① **서술형 종결 0건**: 정규식 `(습니다\|입니다\|합니다\|됩니다)[.。]?$`에 걸리는 문자열이 0개(상태 표기는 명사구·용언 어간으로 끝낸다) ② **영문 내부어 0건**: `IPC`·`enum`·`draft`·`payload`·`API`·`REST` 중 어느 것도 등장하지 않는다 ③ **비한국어 단위 0건**: `sec`·`s`·`ms` 대신 `초`, `%` 외 영문 단위 없음. 세 검사 모두 명령이 있으므로 육안 판정이 아니다. ⚠ **합의 5차 — 게이트의 사정거리를 이번 개정이 만든 문자열까지 넓힌다.** 4차 게이트 대상은 Paper 노드와 `agent-proposal.js`·`routine_tools.py`뿐이라 아래 신규 사용자 노출 문자열이 사각에 있었다: (a) Step 7a의 `확정` 비활성 사유 — **`activation_blocker`는 신호로만 쓰고 문구는 제품이 소유한다(합의 6차 재정의).** 실측 `can_activate`(`backend/athena_api/routines/runtime.py:71-85`)의 반환값 셋은 전부 **`~없다` 종결의 완결 설명문**이고 `:78`·`:85`는 **영문 내부어 `source`**를 포함한다 — 5차처럼 원문을 그대로 그리면 「설명문 금지」와 「내부어 금지」를 동시에 어기는데, **아래 정규식이 `~없다`를 못 잡아 게이트는 전건 통과한다.** 3분기 문구를 Step 6-B가 확정한다(`이 작업은 취소 후 새로 만들기` / `실시간 감시 불가 — 키움 연결 없음` / `백엔드 실행 경로 없음`, 미지 blocker만 원문 폴백 + 노트 기록). 접두어 `지금은 켤 수 없음: `은 붙이지 않는다(4차의 중복 표기, 5차에 제거). (b) 6c의 409 detail → 상태 표기형 **`지원하지 않는 조건 — 취소 후 새로 만들기`**로 줄인다. (c) `놓친 예약 없음` · `보류함 N건` · `이 작업은 취소 후 새로 만들기` · `종목·소스는 취소 후 새로 만들기` · **`설정 편집`**(합의 6차 — `↓`를 뺐다, 결정 f-2 부록)는 형태가 맞으므로 문면은 유지하되 **게이트 대상에 넣는다**(Step 6-B 충족 기준 2 — 파일 전체 정규식이 아니라 **문자열 지정** grep이다, 합의 6차). ⚠ **정규식의 한계를 명문화한다:** `(습니다\|입니다\|합니다\|됩니다)[.。]?$`는 **`~한다`·`~없다`·`~이다` 종결을 잡지 못하므로** 백엔드 유래 문자열(파이썬 소스의 어투)에는 무력하다 — 그래서 (a)·(b)는 정규식이 아니라 **문자열 지정**으로 못 박았다 |
| ①-11 | 전 보드 PDF 발송 → 사용자 검수 승인 (**🛑 사람 정지점 ①**) | `export_combined_pdf`로 A-2 8장 단일 PDF 생성 → `SendUserFile` → **사용자 문자 승인 + Step 5의 U-1~U-6 6항목 답**을 받기 전에는 Step 6-B·Step 7 이후로 진행하지 않는다. **Step 6-A는 이 게이트 앞에서 이미 끝나 있다**(합의 3차 배치 정정 — ralph 순차 실행에서 "병행"은 성립하지 않는다, §1.5) |
| ①-12 | 활성 페이지 전환·복귀 | Step 0f에서 `get_basic_info`의 활성 페이지를 기록하고 **`open_file(A-2 pageId)`로 전환**(미마운트 빈 스크린샷 방지 — 근거는 Paper MCP 서버 지침 "`get_basic_info` first to understand artboards"와 세션 메모리 `paper-mcp-screenshot-viewport`("빈 스크린샷은 렌더러 오류가 아니라 마운트 안 된 아트보드다"). **`PAPER_APP_PARITY.md:203` 인용은 철회한다 — origin에 없다**, 머리말 철회 2), Step 5.2에서 기록한 페이지로 복귀 + `finish_working_on_nodes` 호출 |

### ② 실앱

| # | 기준 | 검증 방법 |
|---|---|---|
| ②-1 | `app/lib/agent-canvas.js`의 **12개** GUI 동작이 각각 **정확히 1회** 콜백을 부른다. 그중 **11개는 확정 IPC 경유**, 1개는 IPC를 타지 않는다(분리 표기) | `cd app && npm test` — `lib/agent-canvas.test.js`에 12동작 각각 "콜백이 정확히 1회 호출된다" 단언. **IPC 경유 11동작**: 새 작업 시트 제출·제안 채택(`athena:routine-draft`, 결정 a″-1) · **확정**(`athena:routine-confirm` — 상세 패널 `확정` 버튼, **합의 4차 신설**) · 설정 편집(`athena:routine-update`) · 일시중지(`routine-pause`) · 재개(`routine-resume`) · 취소(`routine-cancel`) · 지금 실행(`routine-missed-confirm`) · 개별 읽음(`routine-ack`) · 모두 읽음(`routine-ack` 루프) · 가드 편집(`nudge-guard-set`). **비-IPC 1동작**: 보류 → 렌더러 로컬 숨김 + `보류함 N건` 표기(백엔드에 채택/보류 기록 엔드포인트가 없다 — `routines.py:145-462`의 라우터 12개에 해당 경로 없음, open-questions #4). 이 1개는 "IPC를 부른다"가 아니라 **"로컬 상태가 바뀌고 카드가 숨는다"**로 단언한다. **추가 단언 6건:** ① **설정 폼 소스별 분기**(3차) — `SOURCES` 6종을 파라미터로 도는 테이블 구동 테스트가 각 소스에서 `폼의 편집 가능 필드 집합 == 화이트리스트 8필드 ∩ 그 소스에서 유효한 필드`를 단언한다(`vi.triggered`면 비교 선택지가 `["=="]` 1개, `schedule.daily`면 `["at"]`이고 `연속 틱`이 **없다**). 폼이 그 판정에 쓰는 `condition`**과 `source_spec`**은 **`athena:routine-detail` 응답에서 온다**(결정 d-2·e-1) — 목록 행(`item.raw`)에는 **둘 다 없다**는 것을 fixture로 고정한다. ⚠ **이 테스트만으로는 부족하다는 것을 명시한다(합의 5차):** 폼 생성 함수에 카탈로그를 주입해 부르므로 **카탈로그가 실제 응답에서 오지 않아도 전건 통과**한다 — 실제 경로는 아래 ⑥과 8c 프로브가 잡는다. ② **가드 저장 왕복 보존**(3차) — `saveNudgeGuard`가 보내는 payload에 폼에 노출되지 않은 `max_daily_briefings`가 **읽어온 원본 값 그대로** 들어 있다(①-5 사유). ③ **만료 무변경 보존(합의 4차)** — `만료(일)`을 건드리지 않고 저장하면 `saveRoutineSettings`의 patch에 **`expires_days` 키가 아예 없다**(R22 규칙 1이 만료를 보존한다). 건드리면 있다. ④ **대화 경로 허용 키(합의 4차)** — `agent-proposal.test.js`가 `propose.proposed`의 허용 키가 **공통 5필드의 부분집합**이고 `condition.*`이 **0건**임을 단언한다(결정 d). ⑤ **도달성 부류 단언(합의 5차 신설 — 결정 f)** — 루틴 kind **3종(`watch`·`schedule`·`draft`) 각각**에 대해 **설정 편집 진입로가 존재한다**를 단언한다(f-2 채택 후에는 세 kind 모두 상세 패널에 폼이 그려진다). 잎사귀 단언이 아니라 **부류 단언**이라, 다음에 같은 계열의 도달성 결손이 생겨도 잡힌다. ⑥ **카탈로그 출처 단언(합의 5차 신설 — 결정 e-1)** — 설정 폼을 열면 `athena:routine-detail` 응답의 `source_spec.ops`가 **그대로** 비교 선택지가 되고, 05 시트를 열면 `athena:routine-source-catalog`가 **정확히 1회** 호출된다. `agent-canvas.js` 안에 소스 이름·연산자 목록을 담은 **하드코딩 상수가 0개**임을 함께 단언한다(사본 금지) |
| ②-2 | 보기 전용 렌더·단언 원문 교체 | `app/lib/agent-canvas.js`에서 문자열 `설정 — 보기 전용`(현 `:1021`)·`이 화면에서는 값을 바꾸지 않습니다`(현 **`:1039`**) **0건**. `agent-canvas.test.js:1644` "값을 바꾸는 입력이 없고" 테스트가 "폼 입력이 있고 저장이 같은 IPC를 부른다"로 교체 |
| ②-3 | `app/chat.js` 에이전트 모드: 제안 턴 렌더 · 결과 턴 렌더 · 뷰 상태 명령(D) 처리 | `app/lib/agent-proposal.test.js`(신설) 순수 로직 단언 + `chat.js`가 `athena:routine-proposed` 구독 |
| ②-4 | `app/main.js`: 제안 수신 → 채팅 카드 발행 → 칩 확정 시에만 IPC 실행 | `app/lib/main/agent-session.test.js` + main.js의 `maybeForwardRoutineProposal`이 `is_error`·비-propose·파싱 실패에서 전송하지 않음(선례 `main.js:2173-2177`과 동형) |
| ②-5 | 관제 창 `mode='agent'` 계약 어댑터 — **프로덕션 소비자 포함** | `app/lib/main/agent-session.js` 존재 + `agent-session.test.js`가 ① `FOUNDATION_PRESENT === true`(worktree의 `conversations.js`가 `viewToMode()`로 정규화한 `mode`를 준다, `≈:88`) ② 활성 대화가 `mode==='agent'`이면 `getAgentConsoleSessionId(snapshot)`이 **그 id**를 돌려준다 ③ **활성 대화가 에이전트가 아니면 `null`을 돌려준다**(반증 가능한 단언 — 2차의 "관제 창은 하나 전제가 유효하다"는 `conversations.js touch()`가 `mode:'agent'` 행을 무제한 push하므로 **거짓을 고정**했다, §1.4) ④ `mode==='agent'` 대화 2건이 있어도 활성이 아닌 쪽은 고르지 않는다 ⑤ **`isDerivedAlertRoom`이 알림 방만 true — 단 이 단언은 `agent-proposal.test.js`가 소유한다**(합의 6차 소유 확정: 함수가 렌더러 UMD 모듈 `app/lib/agent-proposal.js`로 옮겨졌다. 렌더러는 `shell.html`의 `<script src="lib/*.js">`로만 모듈을 얻고 그 목록에 `lib/main/*`이 0건이라, main 모듈에 두면 유일한 호출자인 `shouldRenderProposal`이 그것을 import할 수 없다 — §1.4). `agent-session.test.js`는 그 함수를 `require`해 쓰는 쪽만 확인한다. **추가 — 소비자 단언(②-3과 짝):** `agent-proposal.test.js`가 `shouldRenderProposal({activeMode, roomId})`에 대해 (a) `activeMode!=='agent'` → `false` (b) `isDerivedAlertRoom(roomId)` → `false`(대신 합류 버튼) (c) 관제 대화 → `true`를 단언한다. **어댑터가 프로덕션 경로에서 호출되지 않으면 이 AC는 미충족이다** |
| ②-6 | `backend/athena_mcp/routine_tools.py` 제안 액션 enum 확장(실행 없음) | `cd backend && uv run pytest tests/mcp/test_routine_tools.py` — `action` enum == `["draft","list","propose"]`, `propose.control` enum **12종**(§1.3 표 — 10종 + `ack_all` + `update`), `propose` 디스패치가 `GET /api/v1/routines` **외의 경로에 절대 도달하지 않음**(핸들러가 다른 path·POST를 받으면 `AssertionError`). ⚠ **합의 4차 강화 — 이름을 `test_propose_only_reads_list`로 바꾼다:** 결정 d-2가 신규 `GET /{id}`를 만들므로 "쓰기를 안 한다"만으로는 부족하다. 단언은 **허용 path 화이트리스트가 정확히 `{"/api/v1/routines"}` 1개**이고 그 밖의 **읽기도** `AssertionError`가 되게 한다 — 모델 도달 표면 동결을 코드로 고정하는 자리다(D-1). 추가 비용 ≈ 0(단언 모양은 그대로, 비교 대상만 집합) |
| ②-7 | 상태 변경 gateway-blocked 단언 유지·강화 | `test_state_changing_actions_are_gateway_blocked` 파라미터 `["confirm","cancel","activate",None,5]` 그대로 통과 + `meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"` |
| ②-8 | `nudge_guard_tools` propose 유지 | `cd backend && uv run pytest tests/mcp/test_nudge_guard_tools.py` 전건 통과(무변경) |
| ②-9 | 설정 편집 REST 신설 | `cd backend && uv run pytest tests/api/test_routines_update.py`(신설) — 편집 가능 필드 반영 · `symbol`/`condition.source` 변경 시 422 · 존재하지 않는 id 404 · `cancelled` 상태 409 · **`active` 감시 루틴의 `condition` 편집이 실행 중인 구독 술어에 반영된다**(Step 6-A c의 술어 반영 검증 참조) · **편집 시 `TriggerState`가 초기화된다**(`triggers.py:64-70`의 `consecutive`/`near_active`가 이전 값을 이어받지 않는다) · **`expires_days`를 보내지 않으면 원래 만료가 보존된다** · **보냈을 때만 만료가 다시 계산된다**(합의 3차) · **레거시 소스 루틴은 전용 메시지로 409를 낸다**(합의 4차 — `condition.source not in SOURCES`인 저장 루틴, 아래 사유) · **`note` 신선도 2분기**(합의 5차 신설: **자동 생성 `note`는 조건 편집 후 새 술어를 반영한다** / **사용자가 직접 쓴 `note`는 조건을 바꿔도 불변이다**) = **총 11 케이스** |
| ②-9b | 단일 루틴 상세 읽기 REST + 소스 카탈로그 REST 신설 (**결정 d-2 · e-1**) | `cd backend && uv run pytest tests/api/test_routines_detail.py`(신설) — ① `GET /api/v1/routines/{id}`의 **반환 키 집합이 §1.6 「반환 키 목록」과 등호로 일치**한다(`condition` 4키 + **`source_spec` 4키** 포함). ⚠ **합의 5차 정정 — 4차의 "`_view` 필드 전부"는 폐기한다:** 그대로 구현하면 `latest_fired`가 없어 `last_fired_at: null`·`unread: false`가 나가고 **예약 루틴은 `missed`가 항상 `true`**가 된다(`routines.py:79-80`이 `last_fired_at is None`에서 `return True`) — Step 7a가 `missed === true`를 `지금 실행` 활성 조건으로 쓰므로 **409를 부르는 거짓 활성 버튼**이 생긴다. 그래서 응답을 폼 프리필 키로 좁히고 `last_fired_at`·`unread`·`missed`·`next_fire_at`을 **아예 내지 않는다**(P3 — 읽어올 수 없는 값을 선언하지 않는다) ② 없는 id는 404 ③ **`GET /api/v1/routines`(목록)의 각 행에는 `condition`·`source_spec` 키가 여전히 없다** — 모델 도달 표면이 넓어지지 않았다는 반증 가능한 단언(D-1) ④ `GET /api/v1/routines/briefing-budget`이 **여전히 예산 응답을 낸다**(경로 충돌 회귀, R26) ⑤ **`GET /api/v1/routines/source-catalog`가 활성 `SOURCES` 6종을 `{ops, value_type, transport, label, experimental}`로 내고, `LEGACY_DISABLED_SOURCES`는 내지 않는다**(결정 e-1) + 그 라우트가 `/{routine_id}`보다 **앞에** 선언돼 `routine_id="source-catalog"`로 먹히지 않는다 = **총 5 케이스** |
| ②-10 | `app/probe-agent-paper-parity.js` 단언 갱신 → 전건 통과 | `cd app && npm run verify:agent-paper-parity` — **Step 1에서 측정한 베이스라인 단언 수**(기대 34)에서 갱신 후 전건 통과 + 렌더러 콘솔 에러 0. 갱신 대상: `:148-162`(동선 규칙 → 이중 제어 규칙 3줄) · `:264-274`(보기 전용 → 편집 폼) · `:288-294`(가드 패널 → 편집 폼) |
| ②-11 | `app/lib/agent-canvas.test.js` 이중 경로 매트릭스 | A~E 각 동작 × {GUI, 대화} 2건씩. 최소 매트릭스는 §4 Step 8 표 참조 |
| ②-12 | 전체 테스트 통과 | `cd app && npm test` 0 failed · `cd backend && uv run pytest` 0 failed. **Step 1에서 측정한 베이스라인 대비 감소 0** |
| ②-13 | `PAPER_APP_PARITY.md` 에이전트 섹션 갱신 | **좌표가 아니라 이름으로 찾는다**(머리말 철회 2 — 2차가 쓴 `:363-370`·`:414`·`:425-427`은 작업본 좌표이고 origin 파일은 **384줄**뿐이라 뒤 둘은 존재하지 않는다). 찾을 이름: 에이전트 섹션 머리(`≈:296`) · 보드 판정표(`≈:309-315`, 현재 6행) · 동선 규칙 ② 인용(`≈:359`) · 검증 증거 표(`≈:370-372`). 단언: 판정표가 **8행(01~08) 전부 `적용`**, 동선 규칙 ② 인용이 **이중 제어 규칙 ②**로 교체, 검증 증거 표가 Step 9 실측값으로 교체 |

### ③ 라이브 종단 시연

| # | 기준 | 검증 방법 |
|---|---|---|
| ③-1 | 실제 백엔드 + Electron 기동 — **앱이 자기 계약대로 띄운다** | `cd <worktree>/app && npm start` **한 줄.** 수동 `uvicorn`을 **부르지 않는다.** ⚠ **합의 4차 정정 — 3차의 수동 기동은 앱을 결손 백엔드에 붙였다:** `app/lib/main/backend-launcher.js`의 `buildBackendEnv`(`:28-58`)는 기본값 **5개**(`ATHENA_BRAIN_ENABLED` · `ATHENA_ROUTINES_ENABLED` · `ATHENA_BACKTEST_ENABLED` · `ATHENA_BRAIN_INGEST_SCHEDULE_OWNER=external` · `ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION`)를 세팅하는데 3차 명령은 앞의 2개만 줬고, **`function decideAction`**(이름 앵커, origin 실측 **`≈:62`** — 5차까지 쓰던 `:60-64`는 함수 정의가 아니라 **선행 주석 `:60-61`부터 세는 범위**였다. 이 파일은 합의 6차에 Step 0e 재해결 표의 9번째 행으로 편입됐다)이 healthy면 `'already-running'`을 돌려주므로 **앱이 그 결손 백엔드에 붙는다.** 그 파일 자신의 주석이 결과를 실측으로 기록해 뒀다 — *"사이드바 다섯 번째 모드가 503(비활성)으로 죽어 있고 … 어느 프로세스가 먼저 8010을 잡느냐에 따라 켜졌다 꺼졌다 한다(2026-09-02 실측)"*. 하필 Step 9는 R24·8a-4가 코드로 강제한 **타 모드 불간섭을 사람이 눈으로 확인하는 유일한 자리**다. **기대 출력(3건 모두 확인):** ① `curl -s http://127.0.0.1:8010/api/v1/llm/manifest` 200(헬스, `backend-launcher.js:11`의 `HEALTH_URL`과 같은 경로) ② 사이드바 **백테스트 모드가 503이 아니다** ③ brain status가 `extraction_enabled=false`의 degraded가 아니다(C 묶음 시연 데이터가 비지 않게). 8010이 이미 점유돼 있으면 **그 프로세스를 먼저 내리고** `npm start`로 다시 띄운다 — 외부 백엔드에 붙은 채로 시연하지 않는다 |
| ③-2 | A~E 각 동작을 **대화 경로 1회 + GUI 경로 1회** 실행 | 아래 §4 Step 9의 **19행** 시연 표 전건 실행. 표가 **스펙 A~E 인벤토리를 전부 덮는지**가 이 AC의 조작적 정의이므로, 합의 4차에 빠져 있던 2행(**`1b` A-확정** · **`17` D-그래프 근거 보기**)에 이어 **합의 5차에 `8b` D-캔버스에서 열기**를 채웠다 — 스펙 D 인벤토리의 `캔버스에서 열기·채팅으로`는 **두 방향**인데 8행(B 이어가기)이 `채팅에서 열기 ↗` 한 방향만 덮고 있었다(4차가 D-그래프에 대해 한 정정과 같은 구조의 잔여 결손). **Step 9는 사람 정지점이다**(GUI 클릭이 필요해 ralph 무인 실행 불가) — 자동화 가능한 부분은 Step 8e의 `verify:agent-dual-control-live` 하네스가 미리 덮는다 |
| ③-3 | 실행 전후 상태 변화 캡처 — **증거 형식을 행별로 분기한다** | **서버 상태가 바뀌는 12행**(9c 1·1b·2~7·9·11·15·16행): 각 동작 전후 `GET /api/v1/routines` · `/{id}/runs` · `GET /api/v1/nudge-guard` 응답을 JSON으로 저장하고 diff 첨부. ⚠ **11행(C 가드 조정)의 기대값이 기본값과 같으면 이 규칙이 자기 발에 걸린다(합의 5차 정정)** — `GuardSettings.max_daily_nudges`의 **기본값이 2**이므로(`backend/athena_api/routines/guard_settings.py:49`, 검증 기본값도 `raw.get("max_daily_nudges", 2)` `:84`, 허용 범위 0~10 `:23-24`) 4차의 기대 상태 `→2`는 새로 띄운 백엔드에서 **빈 diff**를 낳는다. 9c 11행의 기대값을 **`2 → 1`**로 바꾼다(대화 문장도 "하루 한 번만 말 걸어"). **서버 상태가 바뀌지 않는 7행**(9c 10행 보류 · 12·13·14·17행 D 뷰·그래프 이동 · **8b행 캔버스에서 열기** · 8행 이어가기의 방 선택분): REST diff는 **빈 diff가 정상**이므로 증거로 쓰지 않는다 — 대신 `get_screenshot` 1장 + 렌더러 상태 직렬화(`agentCanvas` 반환 객체의 `activeView`/`activeTab`/`search`/`drillInId`와 `AthenaNotify.list()` 결과를 JSON으로 덤프)를 증거로 지정한다. **빈 diff를 통과 증거로 쓰지 않는 이유:** 빈 diff는 "동작하지 않았다"와 "동작했으나 서버에 안 남는다"를 구분하지 못한다(P3) |
| ③-4 | 결과 문서 | `docs/handoff/2026-09-XX-agent-dual-control-live.md` 생성 — 캡처 경로 · 상태 diff · 미통과 항목을 표로. 미통과가 있으면 **숨기지 않고 기록**(P3) |

---

## 4. Implementation Steps

> ralph 순차 실행. 각 Step은 검증이 통과해야 다음으로 넘어간다. **Step 0a·0b·0c는 메인 체크아웃 cwd에서 절대 경로로 돌고, 0c-2의 `EnterWorktree` 이후 모든 명령은 worktree 안에서 돈다.**
>
> **실행 순서(이 표가 권위다 — 절 번호가 아니라):**
>
> `0` → `1` → `2` → `3` → `4` → **`6-A`** → `5`(🛑) → `6-B` → `7` → `8` → `9`(🛑)
>
> 6-A는 번호가 6이지만 **문서와 실행 모두에서 Step 5 앞에 있다**(합의 3차 배치 정정, §1.5). 번호를 4.5로 바꾸지 않은 이유는 본문·AC·리스크·ADR에 `Step 6-A a`~`f` 교차 참조가 30곳 이상이라 renumbering이 순수 위험이기 때문이다.
>
> **🛑 사람 정지점은 정확히 2개다** — 그 외 Step은 전부 ralph 무인 실행이다.
>
> | 정지점 | Step | 왜 자동화할 수 없는가 | ralph가 여기서 할 일 |
> |---|---|---|---|
> | ① **PDF 검수 게이트** | Step 5 | 시각 판정과 문구 승인은 사람의 것이다 | PDF 발송 + **U-1~U-6 확인 항목**을 함께 묻고 정지 |
> | ② **라이브 종단 시연** | Step 9 | Electron GUI를 손으로 클릭해야 한다 | 9a·9b(기동·데이터 준비)까지 하고 정지 보고. 자동화 가능분은 Step 8e 하네스가 이미 덮었다 |
>
> 초안의 "Step 0a 병합 게이트"는 **사람 정지점이 아니다** — 사용자 확정 1로 삭제됐다.

### Step 0 — worktree 착지 + 사전 확인 (**ralph 무인 실행 가능 — 사람 정지점 아님**)

> 초안의 "0a 병합 게이트(사람 정지점)"는 **삭제**됐다. 사용자가 병합을 폐기하고 `origin/main` 기반 worktree로 확정했으므로(사용자 확정 1) 물어볼 것이 없다. 이 Step 전체가 ralph 무인 실행이며, `.claude/worktrees/agent-dual-control` **바깥의 파일은 하나도 만지지 않는다.**

> ⚠ **합의 3차 — 실행 순서와 cwd를 못 박는다.** 2차는 0a에서 `EnterWorktree`로 cwd를 worktree로 옮긴 **뒤** 0b가 `cp .omc/plans/*.md .claude/worktrees/…`를 **메인 체크아웃 기준 상대 경로**로 실행하게 적었다. 진입 후 cwd는 worktree이고 그 안에는 `.omc/`도(gitignore라 애초에 이 Step이 해결하려는 문제다) 중첩 `.claude/worktrees/`도 없으므로 **복사의 원본이 없어 첫 명령이 죽는다.** ralph 무인 실행의 첫 세 명령이 서지 않는 결함이었다. 아래는 **복사를 진입보다 먼저** 두고 전 경로를 **절대 경로**로 쓴다.
>
> | 이름 | Git Bash 절대 경로 |
> |---|---|
> | `<main>` | `/c/Projects/DAOU.Athena` |
> | `<worktree>` | `/c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control` |
>
> **진입(`EnterWorktree`)은 0c 끝에서 한 번만 일어난다.** 0a·0b·0c의 셸 명령은 전부 메인 체크아웃 cwd에서 `git -C`/절대 경로로 돌고, 0d부터는 worktree cwd다.

**0a. worktree 생성 · 검증 (아직 진입하지 않는다).**

```bash
cd /c/Projects/DAOU.Athena
git fetch origin
git worktree prune          # 관리 파일 위생 — 아래 각주 참조(잔존 디렉터리는 지우지 않는다)
git worktree add /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control     -b feat/agent-dual-control origin/main
```

- **메인 체크아웃의 카드 트랙 미커밋 19파일은 손대지 않는다.** worktree는 별도 체크아웃이므로 물리적으로 분리된다 — stash도 커밋도 하지 않는다.
- **이 브랜치는 병합하지 않는다.** 통합은 이 계획 밖의 결정이다(사용자 확정 1).
- 참고: `.claude/`는 gitignore(`.gitignore:7` 실측)이지만 `git worktree add`의 경로 제약과는 무관하다. ⚠ **2차의 "같은 자리에 다른 트랙의 worktree가 이미 있다(`.claude/worktrees/kiummi-full-audit-f99978`) — 관례가 확립된 위치다"는 사실이 아니다(합의 3차 정정).** 실측 `git worktree list`에 등록된 것은 **메인**과 **`C:/Projects/DAOU.Athena-plugin`(형제 디렉터리)** 둘뿐이고, `.claude/worktrees/kiummi-full-audit-f99978`은 git이 더 이상 추적하지 않는 **잔존 디렉터리**다. 경로는 사용자 확정 1이 지정했으므로 그대로 쓴다. ⚠ **합의 4차 각주 — 3차가 `prune`에 붙인 근거("잔존 항목이 `git worktree add`를 방해하지 않도록")는 성립하지 않는다:** `git worktree prune`은 등록이 끊긴 항목의 **관리 파일(`.git/worktrees/*`)만** 지우고 미등록 잔존 디렉터리 `.claude/worktrees/kiummi-full-audit-f99978`에는 아무 작용도 하지 않는다. 목표 경로가 달라 `add`를 방해할 일도 애초에 없다. **줄은 무해하므로 남기되(관리 파일 위생) 근거 문장을 정정한다** — 이 계획이 요구하는 것은 근거와 주장이 층을 같이하는 일이다.

**0a-2. 이탈 규정 — 이 계획은 worktree 안에서 끝난다.**
- 병합하지 않으므로(사용자 확정 1) **worktree 디렉터리 자체가 유일한 산출물 보관처**다.
- cwd 복귀가 필요하면 **`ExitWorktree {action:"keep"}`만** 쓴다. **`action:"remove"`는 부르지 않는다** — 그 계약은 worktree 디렉터리와 브랜치를 함께 삭제한다.
- 참고(과대평가 방지): 이 worktree는 `git worktree add`로 직접 만들고 `path`로 진입하므로 도구 계약상 `ExitWorktree`의 제거 대상이 아니다 — 즉 이 줄은 **문서 위생이지 유일한 방어가 아니다.** 그럼에도 명시해 두는 이유는 재개 세션이 "정리" 의도로 remove를 시도하는 일 자체를 없애기 위해서다.
- **충족 기준(3건 모두, 전부 메인 cwd에서 `git -C`로 확인):**
  1. `git worktree list`에 `.claude/worktrees/agent-dual-control` 행이 있다.
  2. `git -C /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control rev-parse --abbrev-ref HEAD` == `feat/agent-dual-control`.
  3. `git -C /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control status --short`가 **비어 있다**.
  - (초안의 `git rev-list --count HEAD..origin/main == 0`은 **쓰지 않는다** — worktree를 `origin/main`에서 따면 항상 참이라 아무것도 검증하지 않는다.)

**0b. `.omc/` 이관 — worktree에 계획·스펙이 없다.**

`.gitignore:9`가 `.omc/`를 무시하므로 새 worktree에는 이 계획도, 원천 스펙도, open-questions도 **존재하지 않는다.** ralph가 Step 1 이후를 수행할 근거를 잃으므로 첫 순서로 복사한다(커밋하지 않는다 — 여전히 ignore 대상이다).

**아직 worktree에 진입하지 않았으므로 cwd는 메인 체크아웃이고, 원본은 실재한다.** 전 경로를 절대 경로로 쓴다.

```bash
cd /c/Projects/DAOU.Athena
mkdir -p /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control/.omc/plans          /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control/.omc/specs
cp /c/Projects/DAOU.Athena/.omc/plans/*.md    /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control/.omc/plans/
cp /c/Projects/DAOU.Athena/.omc/specs/*.md    /c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control/.omc/specs/
```
- **충족 기준:** `ls <worktree>/.omc/plans/athena-agent-doctrine-plan.md <worktree>/.omc/plans/open-questions.md <worktree>/.omc/specs/deep-interview-athena-agent-doctrine.md`가 3파일 전부 존재를 보고한다.

**0c. 카드 표면 헌장 이관 + 첫 커밋.**

`docs/ui/paper-card-surface-charter.md`는 **미추적이며 origin에도 없다**(실측: `git ls-files --error-unmatch` → `did not match any file(s) known to git`, `git cat-file -e origin/main:…` → 없음). 그런데 이 계획의 P5가 이 문서의 `§1 신념 10·11·14`를 근거로 인용하므로, worktree에 없으면 문구 게이트의 근거가 사라진다.

```bash
cd /c/Projects/DAOU.Athena
WT=/c/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control
mkdir -p "$WT/docs/ui"
cp /c/Projects/DAOU.Athena/docs/ui/paper-card-surface-charter.md "$WT/docs/ui/"
git -C "$WT" add docs/ui/paper-card-surface-charter.md
git -C "$WT" commit -m "docs(ui): 카드 표면 헌장을 에이전트 이중 제어 브랜치의 근거 문서로 옮긴다"
```
- **충족 기준:** `git -C "$WT" ls-files --error-unmatch docs/ui/paper-card-surface-charter.md`가 성공하고, `git -C "$WT" log --oneline -1`이 위 커밋을 보고한다.
- 이 커밋이 브랜치의 첫 커밋이다. 소스 코드 변경은 포함하지 않는다.

**0c-2. 이제 진입한다 — 이후 모든 Step의 cwd가 worktree다.**

`cd`가 아니라 하네스 도구 호출이다:
```
EnterWorktree { path: ".claude/worktrees/agent-dual-control" }
```
- **충족 기준:** 진입 직후 `pwd`가 `<worktree>`를 가리키고, `ls .omc/plans/athena-agent-doctrine-plan.md docs/ui/paper-card-surface-charter.md`가 **상대 경로로** 두 파일을 보고한다(0b·0c가 실제로 도착했음을 진입 후 재확인).

**0d. 의존성 설치 — 베이스라인 측정의 선행 조건.**

`node_modules/`·`.venv/`는 gitignore(**`.gitignore:18-19`** 실측 — `:20-21`은 `__pycache__/`·`*.pyc`다)라 새 worktree에 없다. 설치 전에는 `npm test`·`uv run pytest`가 **실행 자체를 못 하므로** ②-12 "감소 0"의 기준선이 서지 않는다.

```bash
# Git Bash: node가 PATH에 없다 — fnm multishell 경로를 먼저 얹는다
export PATH="/c/Users/USER/AppData/Local/fnm_multishells/$(ls -t /c/Users/USER/AppData/Local/fnm_multishells | head -1):$PATH"
cd <worktree>/app && npm ci
cd <worktree>/backend && uv sync
```
- **충족 기준:** `node --version`이 v20 이상, `<worktree>/app/node_modules` 존재, `<worktree>/backend/.venv` 존재, `cd <worktree>/backend && uv run python -c "import athena_api"`가 오류 없이 끝난다.

**0e. 전 앵커 재측정 (읽기 전용) — 계획에 숫자를 박지 말고 노트에 기록한다.**

worktree tip에서 아래 **9파일**(합의 6차에 `app/lib/main/backend-launcher.js` 편입)의 앵커를 **이름으로** 다시 찾는다. 표의 "기대 줄"은 **origin/main 실측값**(합의 3차에 전건 재측정)이며 **계약이 아니다** — 이름이 계약이다.

| 파일 | 찾을 이름 (계약) | 기대 줄 (참고, origin/main 실측) |
|---|---|---|
| `app/main.js` | `function maybeForwardNudgeGuardProposal` · `function maybeForwardGraphChatAction` · `function maybeForwardBacktestChatAction` · `function extractToolResultText` · `async function routineHttp` · `ipcMain.handle('athena:nudge-guard-set'` · `ipcMain.handle('athena:routine-missed-confirm'` · `ipcMain.handle('athena:routine-ack'` | `≈2300` · `≈2331` · `≈2375` · `≈2434` · **`≈1192`** · `≈1303` · `≈818` · **`≈1266`**(2차의 `≈1248`은 로컬 HEAD 값이었다 — 정정) |
| `app/chat.js` | `function renderGuardConfirmCard` · `const onNudgeGuardProposed` · `canvasMode:`(제출 payload 동봉 지점) · **`function renderApprovalCard(`**(확정 칩을 감싸는 함수 — `athena:routine-confirm` 호출을 포함한다) · **`const preview = _btn('미리보기 실행'`**(합의 4차 편입) · **`const activate = _btn('바로 활성화'`**(합의 4차 편입) · **`SOURCES 카탈로그`**(결정 e-1의 근거 주석 — 합의 6차 편입) | `≈3064` · `≈1223` · **`≈1315`**(2차의 `:1288`은 정정) · **`≈2960`**(함수 시작) · **`≈3016`** · **`≈3020`** · **`≈2949`**(5차 본문의 `:2524`는 **로컬 HEAD 좌표**였다 — §1.7) (3차까지 본문에 남아 있던 `:2591-2593`·`:2595-2620`은 **로컬 HEAD 좌표**였다 — 머리말 철회 3) |
| `app/canvas.js` | `window.AthenaLib.AgentCanvas.createAgentCanvas({` · `window.AthenaShell.seedChatInput` · **`fetchRuns:`** · **`fetchAvgDuration:`** · **`fetchEngagement:`** · **`onOpenGraph:`**(합의 5차 편입 — 머리말 철회 4) | `≈2952` · `≈2129·2969·2994·3009` · **`≈3022`** · **`≈3029`** · **`≈3035`** · **`≈3051`**(4차 본문의 `≈:3023·3030·3036`과 `:3067-3074`는 전부 정정) |
| **`app/lib/sidebar.js`**(합의 3차 신규 — `+352/-28`이라 2차의 좌표가 전부 어긋났다) | `markAllRead:`(`window.AthenaNotify` 리터럴 내부) · `function handleRoutineEvent` · `async function hydrateNotifyRooms` · `'athena:routine-engagement'` · `async function startNewConversation` | `≈1109`(2차 `:786-791` ✗) · `≈807`(2차 `:488-510` ✗) · `≈863`(2차 `:540~` ✗) · `≈854`(2차 `:531-533` ✗) · `≈901` |
| `app/lib/main/conversations.js` | `viewToMode(row.mode)` · `function touch(` · `state.conversations.push({` · `state.activeMode = conversation.mode` | `≈88` · `≈198` · `≈213` · `≈237` |
| `app/preload.js` | **`'athena:routine-runs'`**(INVOKE 삽입 구역 기준점) · **`'athena:nudge-guard-proposed'`**(ON 삽입 구역 기준점) | `≈55` · `≈295` |
| **`app/lib/main/backend-launcher.js`**(합의 **6차 신규 편입** — 실측 `git diff --numstat HEAD origin/main` = **`6 0`**인데 5차까지 두 목록 어디에도 없으면서 `≈` 없는 확정 좌표로 6곳에서 인용됐다) | `const HEALTH_URL` · `function buildBackendEnv` · **`function decideAction`** | **`≈11`** ✓ · **`≈28`**(본문 끝 `≈57`) ✓ · **`≈62`** (5차까지 쓰던 `:60-64`는 **함수 정의가 아니라 선행 주석 `:60-61`부터 세는 범위**였다 — 이름 앵커로 교체) |
| `backend/athena_mcp/server.py` | 루틴 툴 등록 주석(`draft/list`) | origin 대비 `+14`줄 이동 |
| `PAPER_APP_PARITY.md` | **좌표 인용 전부 폐기 — 이름으로만 찾는다**(머리말 철회 2): `## …에이전트` 섹션 머리 · 보드 판정표 · 동선 규칙 ② 인용 · 검증 증거 표 · `npm run verify` rAF 행업 기록 | `≈296` · `≈309-315` · `≈359` · `≈370-372` · `≈383~` (**origin 파일은 384줄** — 2차가 쓴 `:203`·`:414`·`:425-427`·`:434-440`은 존재하지 않거나 작업본 전용) |

- **origin에만 있는 신규 파일**(로컬 HEAD 부재): `app/lib/sidebar-project-menu.js` — 찾을 이름 `const MODE_CHOICES`(`≈:18`). §1.4의 근거이므로 존재를 확인만 한다.

- **`routine-approval-actions`는 줄 번호로 앵커하지 않는다.** origin 실측 **7곳**(`≈2700·2828·3010·3100·3268·3487·3755`)이고 그중 2곳은 backtest 트랙이 얹은 `routine-approval-actions backtest-change-actions`다. 반드시 **감싸는 함수 이름**으로 찾는다 — 이 계획이 무변경으로 두는 확정 칩 블록의 감싸는 함수는 **`function renderApprovalCard(`**(`≈2960`)이고, 그 안의 `row.className = 'routine-approval-actions'`가 `≈3010`이다.
- **`INVOKE_CHANNELS`/`ON_CHANNELS`도 선언 줄로 앵커하지 않는다.** 선언은 `≈:3`·`≈:224`이고 루틴 채널 삽입 구역은 `≈:55`·`≈:295`로 멀리 떨어져 있다 — 초안이 이 둘을 혼동해 `:44`·`:248`을 적었다.
- **차이 0이라 재측정 불필요한 7파일**(실측 확인): `app/lib/agent-canvas.js` · `agent-canvas.test.js` · `probe-agent-paper-parity.js` · `guard-confirm.js` · `routine_tools.py` · `routines.py` · `test_routine_tools.py`. 그 밖의 `backend/athena_api/routines/*.py`도 차이 0이다.
- **차이 0 파일의 좌표 정정(합의 3차 — 재측정 대상이 아니라서 그대로 쓰이는 자리다):** `probe-agent-paper-parity.js`의 env 2줄은 `:19-20`이 아니라 **`:17-18`**(`ATHENA_NO_AUTOSTART`/`ATHENA_CANVAS_SOURCE`) · `triggers.py`의 `_state()` `setdefault`는 `:79-80`이 아니라 **`:81-83`**(`TriggerState` `:64-70`은 정확) · `rules.py`의 `_SYMBOL_RE` **정의는 `:33`**, 그것을 쓰는 **검사는 `:116-117`** · `guard_settings.py`의 `QuietHours.start`/`.end`는 **`:41-42`**, `GuardSettings`는 **`:45-54`**, `max_daily_briefings` 기본값 복귀는 **`:110`**.
- **차이 0 파일의 좌표 정정 2차분(합의 5차 — `≈` 없는 확정 좌표라 다른 기준을 받는다).** 전부 실측으로 다시 쟀다:
  | 인용 대상 | 4차까지의 값 | **실측 정정** | 그 좌표가 쓰이는 곳 |
  |---|---|---|---|
  | `activation_blocker` | `routines.py:136` | **`routines.py:131`** | Step 7a `확정` 버튼 활성 조건 · ①-6 · 9c 1b |
  | `expires_at`(`_view` 반환) | `routines.py:129` | **`routines.py:128`** | Step 3-2 `만료(일)` 프리필 규칙 |
  | `missed` | `routines.py:140-141`(정확) | 유지 — 단 `_is_missed`의 **`None` → `True`** 분기는 **`:79-80`** | R7 · ②-9b ① |
  | `source_spec()` | `models.py:106-116` / `:112-116` | **`models.py:107-111`**(레거시 폴백은 그 안의 마지막 줄) | ①-7 · Step 7a · R28 · §10 높음 4 |
  | `SOURCES` | `models.py:43-52` | **`models.py:42-51`** | Step 3-2 · 6c · ②-1 |
  | `LEGACY_DISABLED_SOURCES` | `models.py:53-58` | **`models.py:55-59`** | 6c 레거시 절 · R28 |
  | `_MAX_CONSECUTIVE_TICKS` | `rules.py:98` | **정의 `rules.py:37`** / 범위 검사 `:98-99` | Step 3-2 `연속 틱` 행 |
  | `consecutive_ticks` ws 전용 422 | 4차 `rules.py:100-101` → 5차가 `:99-100`으로 "정정" | **`rules.py:100-101` — 합의 6차에 되돌린다.** 실측 `git show origin/main:backend/athena_api/routines/rules.py`: `:98` `if not 1 <= ticks_raw <= _MAX_CONSECUTIVE_TICKS:` · `:99` 그 `_fail` · **`:100` `if ticks_raw > 1 and spec.transport != "ws":`** · **`:101` `_fail("연속 틱 조건은 실시간(WS) source에서만 유효하다")`**. **4차가 맞았고 5차가 틀렸다** — 같은 표의 범위 검사 `:98-99`는 옳아서 한 표 안에서 두 항목의 기준이 갈려 있었다 | ①-7 · Step 3-2 · 6c |
  | 자동 생성 `note` | (인용 없었다) | **`rules.py:168-169`** + **`models.py:168-179 human_summary()`** | 머리말 철회 5 · D-1 · 6c note 신선도 |
  | `can_activate` 사유 문자열 | (인용 없었다) | **`runtime.py:71-85`**(문자열 `:78`·`:81`·`:85`) | ①-10 P5 게이트 · Step 7a |
  | `historySettingsFields` 라벨 9종 | `agent-canvas.js:996-1014` | **`:997-1014`**(`조건 :1000` · `다음 실행 :1011` · `만료 :1012` · `생성 :1013`) | ①-7 합집합 등호 · 8c |
  | 드릴인 게이트 | (인용 없었다) | **바깥 `:1525`** / **안쪽 `:1533`** / 버튼 `:1536` / `openHistory` `:1063` / 머리말 계약 `:59-62` / 탭 주석 `:298-299` | 결정 (f) |
  | 프로브 라벨 화이트리스트 | `:265-268` | **`:266-268`**(`check(` 266, `includes(l)` 268) · `inputCount === 0`은 **`:269`** | 8c |
  - ⚠ 앞의 셋(`activation_blocker`·`source_spec`·`SOURCES`)은 **4차가 새로 도입한 두 결정(확정 버튼 · 레거시 409)의 유일한 근거 좌표**였다 — 새 결정이 어긋난 좌표 위에 서 있었다. 3차 §9 낮음 22가 세운 기준 그대로다: *"probe·triggers는 '차이 0이라 재측정 불필요' 범주라 실행자가 검증 없이 쓴다."*
  - ⚠ 반대로 **`≈` 앵커의 6~11줄 드리프트는 결함이 아니다**(`maybeForwardBacktestChatAction` 실측 `≈2381` vs 표기 `≈2375`, 디스패치 `≈2505` vs `≈2494`, `extractToolResultText` `≈2445` vs `≈2434`) — 이름이 계약이고 숫자는 참고값이라는 규율이 작동한다는 증거다. `≈`가 **없는** 좌표만 위 표의 기준을 받는다.
- **충족 기준:** 위 9파일 × 각 이름의 새 줄 번호 표가 계획 노트(`<worktree>/.omc/plans/anchors-note.md`)에 기록됐다. 계획 본문에는 숫자를 되쓰지 않는다. 표의 이름 중 **하나라도 worktree에서 찾지 못하면 Step 1로 넘어가지 않는다**(R14).

**0f. Paper 사전 확인 (읽기 전용).**
- `get_guide({topic:"paper-mcp-instructions"})` **먼저 1회**.
- `get_basic_info`로 파일·페이지 목록과 **현재 활성 페이지를 기록**(①-12 복귀용).
- **`open_file(A-2 pageId)`로 에이전트 페이지를 활성화한다.** 이것이 없으면 마운트되지 않은 아트보드가 **빈 스크린샷**으로 나온다. **근거(합의 3차 교체):** 2차는 `PAPER_APP_PARITY.md:203`을 인용했으나 그 줄은 **origin에 없고 메인 체크아웃 작업본에만 있어 worktree에 오지 않는다**(머리말 철회 2). 조치 자체는 유지하되 출처를 worktree에서도 유효한 것으로 바꾼다 — Paper MCP 서버 지침(`get_basic_info`로 아트보드·치수를 먼저 파악하라)과 세션 메모리 `paper-mcp-screenshot-viewport`("빈 스크린샷은 렌더러 오류가 아니라 마운트 안 된 아트보드다"). R2가 대비한 *검은* 스크린샷(높이 붕괴)과는 다른 실패 모드라 별도 대비가 필요하다.
- `에이전트` 페이지(A-2) 6장의 실제 node id와 크기 확인(스펙:115 기재값 `01 56X-0` · `02 ARM-0` · `03 B57-0` · `04 BIM-0` · `05 BV0-0` · `06 2IJN-2`, 1680×900과 대조).
- `get_font_family_info` 1회(첫 타이포 작업 전 필수) · `get_tokens`로 사용 가능한 토큰 목록 확보.
- **토큰 실재 확인(합의 3차 신설).** `get_tokens` 결과에 **`--color-k-faint`·`--color-k-dim`이 실재하는지** 확인해 노트에 기록한다. 있으면 Step 2의 규율에서 hex 두 값(`#626B76`·`#5B6270`)을 지우고 **토큰명만** 남긴다. 없으면 "이 두 값은 기존 결정(`PAPER_DESIGN_AUDIT.md` 접근성 절)의 계승이며 AC ①-10 `하드코딩 hex 0` 검사의 **명시 예외**"라고 노트와 Step 2에 함께 못 박는다. 이 확인이 없으면 ①-10 게이트가 계획 자신을 반려하고 ralph가 "규율을 어길 것인가 AC를 어길 것인가"를 기록 없이 스스로 결정하게 된다(P3).
- **충족 기준:** 기록된 활성 페이지명 + A-2 활성화 확인 + 6보드 id/크기 대조표 + 위 토큰 2종의 실재 여부.

### Step 1 — 베이스라인 측정 (읽기 전용, **worktree 안에서, 0d 설치 완료 후**)

문서마다 다른 수치가 적혀 있고(`PAPER_APP_PARITY.md:425` 1,722 / `docs/handoff/README.md` 1,946 / 플러그인 스펙:80 2,015 / 2,714) 브랜치 기반이 `origin/main`이라 그 수가 또 다르므로, **worktree 안에서 직접 잰다.** 메인 체크아웃의 측정값은 이 브랜치의 기준선이 아니다.

```bash
export PATH="/c/Users/USER/AppData/Local/fnm_multishells/$(ls -t /c/Users/USER/AppData/Local/fnm_multishells | head -1):$PATH"
cd <worktree>/app && npm test 2>&1 | tail -20
cd <worktree>/backend && uv run pytest -q 2>&1 | tail -5
cd <worktree>/app && npm run verify:agent-paper-parity 2>&1 | tail -5
```

- **충족 기준:** `pass/fail/skip` 3쌍과 프로브 단언 수를 계획 노트에 기록. 이후 모든 "감소 0" 판정의 기준선이 된다.
  - 프로브 단언 수의 기대값은 **34**다(`grep -c "check(" app/probe-agent-paper-parity.js` = 35이지만 그중 1건은 `function check(label, ok) {` 정의부라 호출은 34건이며, `PAPER_APP_PARITY.md:426`이 `34/34 단언 통과`로 독립 확인한다). worktree에서 다른 값이 나오면 **그 값을 기준선으로 삼고 계획 노트에 불일치를 기록한다.**
- **주의:** `npm run verify`(전체 하네스)는 rAF 스로틀로 완주하지 않는 기존 환경 의존 행업이다(`PAPER_APP_PARITY.md`의 rAF 행업 기록, Step 0e 이름 앵커 `≈:383~` — 2차의 `:434-440`은 origin 384줄을 넘어 존재하지 않는다). 이 계획은 **좁은 프로브만** 게이트로 쓴다.

### Step 2 — Paper 01~04 정정

| 보드 | 바꾸는 것 |
|---|---|
| `01 · 셸 — 알림 파생 방`(56X-0) | `set_text_content`로 "메인 대화와 섞이지 않습니다" → **`오브에서 넘어온 예외 창 — 관제 창과 별개`**. 그 아래 합류 버튼 1개 추가: **`관제 창으로 →`**(pink 1곳 규칙: 이 보드의 주요 동작은 이것 하나) |
| `02 · 알람 센터`(ARM-0) | 대화 영역 헤더를 `아테나 · 에이전트 대화`로. fixture 대화를 **알람 제안 턴 + 결과 턴**으로 교체(개별 읽음·모두 읽음 두 경로). `모두 읽음으로` 버튼은 유지 |
| `03 · 실행 이력·결과`(B57-0) | 헤더 동일 교체. 드릴인 우상단에 **`지금 실행`** 버튼 신설(놓친 예약이 있을 때만 활성 — 비활성 상태 표기 `놓친 예약 없음` 병기). 대화 경로 제안 턴 병기. `채팅에서 열기 ↗` 유지 |
| `04 · 프로액티브`(BIM-0) | 헤더 동일 교체. 말걸기 가드 패널을 **편집 폼**으로: **입력 정확히 5개** — `하루 최대`(숫자) · `조용 시간 시작`(시각) · `조용 시간 끝`(시각) · `근거 표시`(토글) · `거절 학습`(토글) — + `저장` 버튼. **조용 시간은 단일 범위 컨트롤이 아니라 시작/끝 2입력으로 그린다**(`guard_settings.py:40-42`의 `QuietHours.start`/`.end`가 별도 문자열 필드다 — 범위 컨트롤로 그리면 왕복 계약이 어긋난다). `max_daily_briefings`는 폼에 넣지 않는다(①-5 사유). 기존 `루틴으로`/`보류` 칩 유지 + 대화 채택·보류 턴 병기 |

**Paper MCP 사용 규율(전 Step 공통):**
- `write_html`은 **한 번에 시각 그룹 하나**만. 큰 보드를 한 호출로 쓰지 않는다.
- 반복 요소(가드 폼 4행, A~E 5열)는 `duplicate_nodes` + `update_styles`/`set_text_content`가 `write_html` 재작성보다 빠르고 정합적이다.
- 아이콘·후행 액션 슬롯은 **고정 폭 + `flexShrink: 0`**. `gap`만으로 열을 맞추지 않는다.
- **`height: "fit-content"`를 아트보드에 주지 않는다.** 붕괴해 높이 0(검은 스크린샷)이 되는 실측 사례가 있다 — 넘치면 픽셀 높이를 유지한 채 내부 행 padding을 조인다.
- 의미 있는 변경마다 `get_screenshot`으로 검토 체크포인트. 보드 하나 끝날 때마다 1장.
- 색은 `get_tokens`가 준 토큰만. 하드코딩 hex 금지(허용 알파 틴트 제외). 저대비 보조 텍스트는 **`--color-k-faint`**, 규칙 본문은 **`--color-k-dim`** — 기존 결정 유지(`PAPER_DESIGN_AUDIT.md` 접근성 절).
  ⚠ **합의 3차 정정 — 같은 문단의 자기모순을 없앴다.** 2차는 "하드코딩 hex 금지"라 적고 바로 다음 문장에서 `#626B76`·`#5B6270`을 **hex로** 지정해, AC ①-10의 `하드코딩 hex 0` 검사가 계획 자신을 반려하게 만들었다. **토큰명만 남긴다.** Step 0f가 `get_tokens`로 이 두 토큰의 실재를 확인하며, **없으면** 그때 노트에 "이 두 값(`#626B76`·`#5B6270`)은 기존 결정의 계승이며 ①-10 검사의 명시 예외"라고 기록하고 예외로 처리한다 — 기록 없이 넘어가지 않는다(P3).

- **검증:** `get_screenshot` 4장 + `find_nodes` 문자열 단언(①-1 ~ ①-5).
- **충족 AC:** ①-1 ①-2 ①-3 ①-4 ①-5

### Step 3 — Paper 05·06 정정 (문구 확정)

**05 `BV0-0`** — 이름을 `05 · 에이전트 — 작업`으로 `rename_nodes`(현 `05 · 에이전트 — 새 작업은 채팅에서`는 폐기된 규칙을 이름에 담고 있다).

1. **`＋ 새 작업` 시트 신설.** 기존 CTA 라벨 `＋ 새 작업 · 채팅에서` → **`＋ 새 작업`**. 클릭 시 열리는 시트(폼)를 같은 보드 안 오버레이로 그린다. 필드는 **백엔드가 실제로 받는 것만**(`backend/athena_api/routines/rules.py:108 validate_draft`, `models.py:146-162 RoutineSpec`): `종목` · `조건`(소스·비교·값) · `쿨다운(초)` · `만료(일)` · `설명` · `브리핑 모델`(선택). 하단 버튼 2개: `초안 만들기` · `채팅에서 쓰기`.

   ⚠ **`종목`은 자유 텍스트가 아니다(합의 3차 신설).** `rules.py:33 _SYMBOL_RE = re.compile(r"^\d{6}$")`, 검사 `:116-117`("symbol은 6자리 종목코드여야 한다"). 자유 텍스트로 그리면 사용자가 `삼성전자`를 넣고 **422**를 받는다 — a″-1이 얻어낸 "결정적 GUI 경로"를 첫 필드에서 잃고, R20이 막으려던 결과("폼에 넣은 값과 다른 결과")가 다른 경로로 재발한다. **종목코드 선택 컨트롤**로 그리거나, 최소한 입력 옆에 형식 표기 **`종목코드 6자리`**를 둔다. 9c 1행의 GUI 경로가 실제로 `routines[] +1`을 만들려면 이 필드가 계약을 만나야 한다.
   ⚠ **`조건`도 소스별로 갈린다** — 아래 06 보드의 소스별 분기와 **같은 규칙**을 시트에도 적용한다(비교 선택지는 `spec.ops`, 값 컨트롤은 `spec.value_type`). ⚠ **시트는 routine_id가 없다(합의 5차 — 결정 e-1).** 그래서 선택지의 출처가 상세 라우트일 수 없다 — 시트를 열 때 **`athena:routine-source-catalog`를 1회** 불러 활성 `SOURCES` 6종의 `{ops, value_type, transport, label}`을 받고 그것으로 `소스` 선택 → `비교`·`값` 컨트롤을 연쇄로 그린다. **렌더러에 소스 목록·연산자 목록을 하드코딩하지 않는다**(②-1 추가 단언 ⑥이 하드코딩 상수 0개를 단언한다).
2. **동선 규칙 → 이중 제어 규칙.** 캡션 `동선 규칙` → **`이중 제어 규칙`**. 본문 3줄을 아래 **확정 문구**로 교체(이 문자열이 Paper·앱·테스트·프로브의 단일 원본이다):

```
① 새 작업 — 채팅 문장으로도, 시트로도.
② 편집 — "이거 고쳐줘"로도, 폼으로도.
③ 확정 — 채팅 칩으로도, 버튼으로도. 어느 입구든 같은 게이트.
```

> 문구 3원칙 점검: 설명 문장이 아니라 규칙 표기다 · 단위 없음(해당 없음) · 내부어 없음(`IPC`·`enum`·`draft` 미등장).

3. **상세 패널**에 **`확정`** · `일시중지` · `재개` · `취소` 버튼 **4개**(상태에 따라 하나만 활성). 각 버튼 옆에 대화 경로 병기 라인 1줄.

   ⚠ **`확정` 버튼은 합의 4차 신설이며, 규칙 ③이 이미 약속하고 있던 것이다.** 3차는 규칙 ③ 본문에 `확정 — 채팅 칩으로도, **버튼으로도**`를 확정 문구로 못 박아 놓고(이 문자열이 Paper·앱·테스트·프로브의 단일 원본이다, R3) 상세 패널 버튼은 3개로 두었고, Step 8a 매트릭스는 A-확정 GUI 칸을 `— (채팅 카드 소유)`로 비웠으며, 9c 1·9행의 **GUI 경로가 채팅 확정 칩으로 끝났다.** 결과는 세 겹의 결함이다:
   - **P3 위반(글자는 있는데 버튼이 없다).** 규칙 문자열은 문자열 일치 단언과 프로브 3줄 원문 단언을 **전건 통과**시키므로, 자동 게이트가 이 거짓말을 잡지 못한다.
   - **§1.3이 세운 D2 판정 단위 위반.** "대화 경로는 채팅 안에서, GUI 경로는 캔버스 안에서 닫히고 **어느 쪽도 상대 표면을 방문하지 않는다"**인데, GUI 경로만 마지막 한 걸음에서 채팅으로 건너갔다 — a″-1이 얻어냈다는 "결정적·자기완결 GUI 경로"가 A 묶음에서 무너진다.
   - **스펙의 조용한 축소.** 스펙:173("GUI도 모든 제어가 가능해야 한다") · Constraints:57(규칙 ③ 문면) · Acceptance ③("A~E 각 동작을 GUI 경로 1회")가 모두 이 버튼을 요구하는데 U-1~U-4 어디에도 올라가 있지 않았다(사용자 확정 4가 금지한 바로 그것).

   **구현 비용이 작다는 것이 이 정정을 쉽게 만든다** — 백엔드 신규 0, IPC 신규 0. `athena:routine-confirm` 채널·핸들러·preload 허용목록이 **전부 이미 있고 호출자만 없었다**(`cancelRoutine`과 같은 상황). 활성 조건은 `status === 'draft'` **그리고** `activation_blocker`가 비어 있을 때이며, 비활성 사유는 **`activation_blocker`를 신호로만 읽고**(non-null = 비활성) **문구는 제품이 소유한다**(합의 6차 — Step 6-B의 3분기 매핑 표: `이 작업은 취소 후 새로 만들기` / `실시간 감시 불가 — 키움 연결 없음` / `백엔드 실행 경로 없음`, 미지 blocker만 원문 폴백). 값 자체는 **`routines.py:131`**의 `activation_blocker`가 이미 목록 응답에 있으므로 지어내지 않는다(4차의 좌표 `:136`은 5차에 정정). ⚠ **원문을 그대로 그리지 않는 이유:** `can_activate()`의 반환값 셋은 전부 `~없다` 종결 **완결 설명문**이고 둘은 영문 내부어 `source`를 포함해 P5를 어기는데, ①-10의 정규식이 그것을 못 잡는다(5차는 접두어 중복만 없앴다). 이 계획의 `missed → 놓친 예약 없음`과 **정확히 같은 취급**이다.
   **되돌리는 계약이 있다는 것도 명시한다:** `app/lib/agent-canvas.js:22-27`이 *"draft→confirm 자체는 채팅의 「작업 요약·초안」 카드 칩이 처리한다 … 그래서 상세 패널은 draft 항목에서 읽기 전용이다(액션 버튼 없음)"*를 **명시적 계약 주석으로** 적어 두었다. Step 7a가 그 주석을 **이번 결정으로 갱신**한다 — 계약을 말없이 어기지 않는다(P4).

**06 `2IJN-2`** — 이름을 `06 · 에이전트 — 작업 설정`으로 `rename_nodes`(`(보기 전용)` 제거).

1. `이 화면에서는 값을 바꾸지 않습니다` 문장 **삭제**(`delete_nodes`).
2. 보기 전용 필드 나열 → **소스별로 분기하는 편집 폼**. 초안은 `조건`을 **텍스트 1칸**으로 그렸고, 2차는 그것을 3필드로 쪼갰으나 **컨트롤 타입과 연산자 집합을 얼려** 절반만 고쳤다. 3차는 백엔드 계약대로 분기시킨다.

   **왜 분기해야 하는가 (실측).** `backend/athena_api/routines/models.py:22-25,43-52`의 `SOURCES`는 **세 갈래**다:

   | 소스 | `value_type` | `ops` | `transport` → `mode` |
   |---|---|---|---|
   | `price.current` · `price.change_rate` · `trade.strength` · `volume.prev_day_ratio` | `number` | `_NUM_OPS = ("<","<=",">",">=")` — **`==`가 없다** | `ws` → `realtime-ws` |
   | `vi.triggered` | `bool` | `_EQ_OPS = ("==",)` | `ws` → `realtime-ws` |
   | `schedule.daily` | `string`(`"ALL@07:30"`) | `_AT_OPS = ("at",)` | `clock` → `scheduled` |

   즉 2차가 적은 선택지 `>=·<=·>·<·==`는 **어떤 단일 소스와도 일치하지 않는다** — 숫자 소스에 `==`를 노출하면 그것은 죽은 선택지가 아니라 **422를 부르는 거짓 선택지**(P3 위반)다. 여기에 **`rules.py:100-101`**(5차의 `:99-100`은 합의 6차에 되돌렸다 — 4차 값이 실측과 맞다)이 `consecutive_ticks > 1`을 `transport == "ws"` 전용으로 422시킨다. 그리고 **Step 9b가 `schedule.daily` 루틴을 직접 심으므로**(과거 시각의 예약 루틴) 라이브 시연이 이 모순을 정면으로 만난다 — E-지금 실행(catchup-fire)이 `mode='scheduled'`를 요구해(`routines.py:290-306`) 그 루틴을 피해 갈 수도 없다.

   **분기 규칙 — 무엇이 무엇을 결정하는가:**

   | 폼 요소 | 결정하는 것 | 값의 출처(결정 e-1) | 근거 |
   |---|---|---|---|
   | `조건 값`의 컨트롤 종류 | `spec.value_type` — `number`→숫자, `bool`→토글, `string`→시각·요일 표기 입력 | 편집: `routine-detail`의 `source_spec` / 생성: `routine-source-catalog` | `models.py:42-51` · `:107-111` |
   | `조건 비교`의 선택지 | `spec.ops` **그대로**(숫자 4종 / `==` 1종 / `at` 1종) | 같은 곳 | 같은 곳 |
   | `연속 틱`의 노출 여부 | `spec.transport === 'ws'`일 때만 노출. 아니면 **필드 자체가 없다** | 같은 곳 | `rules.py:100-101` |
   | `모드` 상태 표기 값 | `derive_mode(condition)`가 소스에서 결정론적으로 유도 | 서버가 `mode`로 이미 준다 — 렌더러가 유도하지 않는다 | `models.py:101-104` |

   ⚠ **합의 5차 — 이 표의 `spec.*`이 어디서 오는지가 4차에는 없었다.** 앱 전체에 소스 카탈로그가 **0건**이고(유일한 히트는 `app/chat.js ≈:2949`의 주석 한 줄) 4차의 `GET /{id}`는 `condition` 4키만 줬으므로, 실행자는 연산자 목록을 지어내거나(422를 부르는 거짓 선택지) 백엔드 카탈로그를 JS로 복사해야 했다. **결정 e-1**이 서버가 실어 보내게 해 두 경로를 모두 닫는다.

   | 필드 | 컨트롤 | 성격 |
   |---|---|---|
   | `조건 비교` | 선택 — **선택지 = `spec.ops`** | 편집 가능 → `condition.op` |
   | `조건 값` | **`spec.value_type`에 따라** 숫자 / 토글 / 시각 표기 | 편집 가능 → `condition.value` |
   | `연속 틱` | 숫자(1~20, **`rules.py:37 _MAX_CONSECUTIVE_TICKS`** 정의 · 범위 검사 `:98-99`) — **ws 소스에서만 노출** | 편집 가능 → `condition.consecutive_ticks` |
   | `쿨다운(초)` | 숫자(60~86,400) | 편집 가능 → `cooldown_s` |
   | `만료(일)` | 숫자(1~`MAX_EXPIRY.days`) | 편집 가능 → `expires_days` |
   | `설명` | 텍스트(200자) | 편집 가능 → `note` |
   | `브리핑 모델` | 선택 | 편집 가능 |
   | `브리핑 노력` | 선택 | 편집 가능 |
   | `종목` | **입력 아님 — 상태 표기(6자리 종목코드)** | 편집 금지(6c가 422) · 현 패널이 이미 표시한다(`agent-canvas.js:1003`) · 프로브 라벨 화이트리스트에 있다(**`probe-agent-paper-parity.js:266-268`**) |
   | `모드` | **입력 아님 — 상태 표기(`자동` / `예약`)** | 파생값(`models.py:101 derive_mode`) |
   | `소스` | **입력 아님 — 상태 표기 `변경 불가`** | 구독 정체성 |
   | **`다음 실행`** | **입력 아님 — 상태 표기(유지)** | 현 패널이 이미 낸다(`agent-canvas.js:1011`). 예약 루틴에서 유용한 정보라 **지우지 않는다**(P3 — 정보 회귀 금지). 값은 서버 `next_fire_at`이 목록 행에 이미 있다 |
   | **`생성`** | **입력 아님 — 상태 표기(유지)** | 현 패널이 이미 낸다(`agent-canvas.js:1013`). 값은 목록 행의 `created_at` |
   | **`만료 <YYYY-MM-DD>`** | **입력 아님 — `만료(일)` 입력 옆 보조 표기** | 아래 프리필 규칙 1 |

   **읽기 전용 표기의 「지정 라벨」 = {`종목`, `모드`, `소스`, `다음 실행`, `생성`, `만료 <날짜>`} — 6종.** ⚠ **이 6종은 상수가 아니라 교집합의 한 변이다(합의 6차 정정).** 실제 읽기 전용 집합은 **`지정 라벨 6종 ∩ 그 루틴에 실제로 존재하는 필드`**이고 등호는 **루틴별로** 판정한다 — `historySettingsFields`(`agent-canvas.js:997-1014`)가 라벨을 조건부로 내고(`if (r.next_fire_at)` `:1011` 등), `_next_fire_at`(`routines.py:19-21`)이 `spec.mode != "scheduled"`면 `None`을 돌려주므로 **감시(watch) 루틴에는 `다음 실행` 라벨이 아예 없다.** 6종을 고정 집합으로 읽으면 kind 3종 fixture의 watch에서 **올바른 구현이 반려된다**(4차 「정확히 3건」이 개수에서 집합으로 옮겨갔을 뿐인 결함). 편집 가능 필드는 값이 없어도 빈 입력으로 그리므로 존재 조건이 없고, **읽기 전용 표기만 존재 조건이 있다.** 4차의 "정확히 3건"은 현 패널이 실제로 내는 `다음 실행`·`생성`(`agent-canvas.js:1011`·`:1013`)과 이 계획 자신의 `만료 <날짜>` 보조 표기를 빠뜨려, **올바른 구현을 게이트가 반려하게** 만들었다 — 4차가 `종목`에서 고친 결함과 같은 계열이다. **그리고 이 목록을 다시 개수로 박지 않는다** — ①-7과 8c는 **합집합 등호**(`그 루틴의 상세 패널 설정 폼이 낸 모든 라벨 == 편집 가능 ∪ 읽기 전용`, 두 집합은 서로소)로 **루틴별로** 단언하므로, 나중에 어느 쪽이 늘어도 한쪽이 반드시 깨진다. **등호의 주어는 「상세 패널의 설정 폼」이다**(합의 6차 — f-2가 설정 표면을 드릴인 요약과 상세 패널 폼 둘로 쪼갰으므로, 단수 「설정 표면」으로 두면 드릴인 요약을 대상으로 읽었을 때 편집 가능 변이 공집합이 되어 등호가 다른 뜻이 된다).

   ⚠ **06 보드는 이 폼을 드릴인 `설정` 탭이 아니라 「상세 패널」 맥락으로 그린다(결정 f-2).** 드릴인 `설정` 탭은 **읽기 전용 요약 + `설정 편집` 버튼** 한 줄만 남는다(합의 6차 — 그 버튼은 `closeHistory()` → 항목 선택 → 상세 패널 설정 폼 포커스다. 5차의 `설정 편집 ↓`(상세 패널로 스크롤)는 **불가능한 동작**이었다: `openHistory`가 `body.hidden = true`(`agent-canvas.js:1076`)로 상세 패널 트리를 통째로 숨기므로 드릴인 중에는 그 패널이 렌더되지 않는다 — §1.8 부록). 그렇게 하지 않으면 예약·초안 루틴에서 폼에 **도달할 수 없다**(§1.8 실측: 드릴인 진입 버튼이 `kind==='watch'`에서만 그려진다 — `agent-canvas.js:1525`·`:1533`).

   **`만료(일)` 프리필 규칙 — 명문화한다(합의 4차 신설).** `_view`도 신규 상세 읽기도 **`expires_at`(절대 시각)만** 주고 `expires_days`는 주지 않는다(**`routines.py:128`** vs `rules.py:126,162`). 규칙 없이 두면 실행자는 *매 저장마다 만료를 now 기준으로 재앵커(절삭 드리프트)* 하거나 *빈 칸으로 두어 저장 시 7일로 리셋* 하는데, 후자는 R22가 막으려던 조용한 손상 그 자체다. **채택안:**
   1. 폼은 `ceil((expires_at − now) / 1일)`로 **남은 일수를 표시**하고, 옆에 읽기 전용 보조 표기 `만료 <YYYY-MM-DD>`를 함께 둔다(사용자가 절대 시각도 본다).
   2. **사용자가 이 입력을 건드리지 않았으면 저장 payload에서 `expires_days`를 뺀다** → R22 규칙 1이 원래 `expires_at`을 그대로 보존한다. 건드렸을 때만 실어 보낸다 → R22 규칙 2가 재계산한다.
   3. 따라서 ②-9의 만료 2케이스가 **GUI 경로에서도 둘 다 도달 가능**하다(3차 명세로는 폼이 항상 값을 보내 규칙 2만 탔다). 그 사실을 ②-1 ③이 렌더러 단언으로 고정한다.

   **`만료(일)`·`설명` 2필드는 합의 3차에 추가됐다.** 2차는 Step 6-A c의 편집 허용 **8필드**와 폼 **6입력**이 "문자 그대로 일치"한다고 적었으나 실제로는 **8 대 6**이었다 — `note`·`expires_days`가 REST로는 편집 가능한데 GUI에 없었다. 그런데 05 `＋ 새 작업` 시트에는 `만료(일)`·`설명`이 **있으므로**, 생성에서는 노출되고 편집에서는 사라지는 비대칭이었고 D2("GUI도 모든 제어")의 실질 미달이었다. `validate_draft`가 `note` 200자(`rules.py:133-134`)와 `expires_days` 1~`MAX_EXPIRY.days`(`:126-130`)를 이미 검증하므로 **폼에 넣는 쪽**을 택한다.

   **입력 개수를 세지 않는다 — 집합으로 단언한다.** `폼의 편집 가능 필드 집합` == `(6c 화이트리스트 8필드) ∩ (그 소스에서 유효한 필드)`. 예: `price.current`면 8개 전부, `schedule.daily`면 `연속 틱`이 빠져 **7개**, `vi.triggered`면 8개이되 `조건 값`이 토글이고 비교는 `==` 하나뿐이다. 읽기 전용 표기(지정 라벨 `종목`·`모드`·`소스`·`다음 실행`·`생성`·`만료 <날짜>` **∩ 그 루틴에 실제로 존재하는 필드** — 합의 6차 정정)는 입력 요소로 세지 않으며, 색이 아니라 종목코드·`자동`/`예약`·`변경 불가`·시각 **글자**로 구분한다(색만으로 상태 표현 금지, 헌장 신념 14). **개수가 아니라 합집합 등호가 게이트이고, 그 등호는 상세 패널 설정 폼을 주어로 루틴별로 판정한다**(①-7·8c).

   **06 보드에는 대표 2종을 나란히 그린다** — `price.current`(숫자·4연산자·연속 틱 있음)와 `schedule.daily`(시각 표기·`at`·연속 틱 **없음**). 분기 자체를 사용자가 눈으로 승인하게 하기 위해서다.
3. **`종목`·`소스` 변경 안내를 명시적으로 넣는다**(사용자 확정 4). `소스` 행 아래 보조 텍스트 1줄: **`종목·소스는 취소 후 새로 만들기`**. 이 문구는 Step 7a 설정 패널에도 같은 문자열로 들어간다 — 조용한 축소가 아니라 화면에 적힌 계약이 되게 한다.
4. `저장` 버튼 1개(pink — 이 보드의 주요 동작 한 곳) + `채팅에서 고치기 ↗` 병존(outline).

- **검증:** `find_nodes` 문자열 단언 ①-6 ①-7 + `get_screenshot` 2장.
- **충족 AC:** ①-6 ①-7

### Step 4 — Paper 07·08 신설

`create_artboard`로 페이지 A-2에 2장 추가. **크기 1680×900 픽셀 고정**(형제 보드와 동일, `fit-content` 금지).

**07 · 에이전트 대화 — 제어 제안 턴 A~E** — 5열(묶음당 1열), 각 열에 채팅 턴 카드 1개. 카드 골격은 실앱의 `guard-confirm` 카드와 동형(태그 2개 + 본문 + 근거 + 칩 행 + 상태):

| 열 | 태그 | 본문 | 근거 | 칩 |
|---|---|---|---|---|
| A 작업 설정 | `작업 설정` · `제안` | `삼성전자 88,000원 감시 — 쿨다운 300초 → 600초` | `오늘 발화 4회 · 하루 최대 3회` | `이렇게 바꿔줘` · `그대로 둘게` |
| B 알람 | `알람` · `제안` | `읽지 않은 알람 3건 — 모두 읽음` | `가장 오래된 알람 2시간 전` | `모두 읽음` · `그대로 둘게` |
| C 제안 | `제안 채택` · `제안` | `외국인 순매수 3일 연속 — 감시로 등록` | `성향 신호 312 · 12분 전` | `루틴으로` · `보류` |
| D 뷰 이동 | `뷰 이동` · `완료` | `작업 › 일시중지` | — | **칩 없음** — 상태 표기 **`이동함`** |
| E 실행 | `지금 실행` · `제안` | `평일 아침 브리핑 — 07:30 놓침` | `마지막 발화 어제 07:30` | `지금 실행` · `건너뛰기` |

**08 · 에이전트 대화 — 결과 턴** — 4상태 4열:

| 열 | 태그 | 상태 표기 | 칩 |
|---|---|---|---|
| 성공 | `작업 설정` · `완료` | **`쿨다운 600초 반영`** | — |
| 거부 | `제안 채택` · `보류` | **`보류 — 목록 유지`** | — |
| 실패·재시도 | `지금 실행` · `실패` | **`이미 발화된 예약`** | `다시 시도` |
| 뷰 이동 | `뷰 이동` · `완료` | `작업 › 일시중지 3건` | — |

> **문구 3원칙 점검(07·08 전 문자열).** 초안의 `바로 이동했습니다` · `보류했습니다 — 목록에 남습니다` · `쿨다운 600초 — 반영됐습니다` · `이미 발화 처리된 예약입니다` 4건은 **서술형 종결의 완결 문장**이라 P5의 "설명문 금지(상태 표기만)"를 계획 자신이 위반하고 있었다. 위와 같이 명사구로 바꾼다. ①-10의 정규식 `(습니다|입니다|합니다|됩니다)[.。]?$` 검사를 07·08에도 **똑같이 적용**한다(초안은 Step 3의 이중 제어 규칙 3줄에만 이 점검을 했다).
> 실패 문구는 실제 백엔드 detail 문자열(`backend/athena_api/api/routines.py:305 "이미 발화 처리된 예약이다"`)의 사용자 어투 판이다 — 지어낸 오류가 아니다(P3).

- **번호·이름 정합:** Step 3의 rename과 합쳐, A-2 페이지의 8보드 이름이 `01 · 셸 — 알림 파생 방` / `02 · 에이전트 — 알람 센터 · 라이브 관제` / `03 · 에이전트 — 실행 이력·결과` / `04 · 에이전트 — 프로액티브` / `05 · 에이전트 — 작업` / `06 · 에이전트 — 작업 설정` / `07 · 에이전트 대화 — 제어 제안 턴 A~E` / `08 · 에이전트 대화 — 결과 턴` 순서가 되게 `rename_nodes` + `move_nodes`.
- **검증:** `get_screenshot` 2장(검은 화면이면 높이 붕괴부터 의심) + `get_computed_styles`로 하드코딩 hex·클릭 영역 32px 확인.
- **충족 AC:** ①-8 ①-9 ①-10

### Step 6-A — 백엔드 + IPC + 어댑터 (**Step 5 앞에서 실행 — 문구 무관**)

> ⚠ **합의 3차 배치 정정.** 2차는 이 Step을 Step 5 뒤에 두고 "검수 대기 중 병행 가능"이라 적었다. ralph는 순차 executor이고 §4 머리말이 "각 Step은 검증이 통과해야 다음으로 넘어간다"로 순차성을 못 박았으므로, **Step 5에서 멈추면 6-A에 도달하지 못한다** — c-1이 이득으로 내건 "게이트 대기 중 문구-무관 작업을 앞당긴다"(§1.5)가 배치 때문에 무효였다. **번호는 교차 참조 보존을 위해 `6-A`를 유지하되 물리적 위치를 Step 4와 Step 5 사이로 옮긴다.** Step 5의 선행 조건에 "6-A 검증 통과"가 들어간다.

> **분할 근거(결정 c 갱신).** enum 식별자(`confirm`·`pause`·…)는 IPC 채널명과 REST 동사에서 오지 07 보드의 한국어 문구에서 오지 않으므로 검수와 독립이다. 반면 `notice`·`rationale`처럼 **사용자에게 보이는 문자열**은 07·08 승인 문구가 원본이므로 Step 6-B로 미룬다.

**6a. `backend/athena_mcp/routine_tools.py` — 제안 액션 추가(실행 없음).**
- `_ALLOWED_ACTIONS`를 `("draft", "list", "propose")`로.
- `_CONTROL_ACTIONS = ("confirm","update","pause","resume","cancel","ack","ack_all","adopt","hold","guard","fire","view")` 신설 — **12종 = 스펙 Constraints:55의 10종 + `ack_all` + `update`**(§1.3 출처 표 참조). `update`가 없으면 A 묶음의 "설정 편집"이 대화 경로에서 결손되고, 2차처럼 그 자리를 `confirm`으로 메우면 칩이 자기 글자와 다른 일을 한다(P3).
- `_INPUT_SCHEMA`에 `propose` 오브젝트 추가: `control`(위 enum, 필수) · `routine_id`(선택) · `proposed`(선택 dict — 편집·가드 제안값) · `rationale`(문자열, 근거 1줄) · `view`(선택 dict — `tab`/`filter`/`query`/`drill_in`).
- ⚠ **`proposed`의 허용 키를 공통 5필드로 못 박는다(합의 4차 — 결정 d).** `control === 'update'`일 때 `proposed`가 받는 키는 **`note`·`cooldown_s`·`expires_days`·`briefing_model`·`briefing_effort`** 5개뿐이고, **`condition.*`은 받지 않는다**(넘어오면 `blocked`). 근거는 P3다 — 모델이 도달하는 유일한 읽기(`GET /api/v1/routines`)는 조건을 `source_label` 한국어 라벨로만 주므로, 모델이 `op`/`value`를 제안하려면 **라벨에서 역추론하거나 지어내야** 한다. 조건 편집 요청이 오면 `control:'update'`가 아니라 **`control:'view'`(설정 탭 열기)**로 답하는 것이 정직한 경로다(스펙 범위와의 관계는 **U-5**에 올렸다).
- `dispatch`의 `propose` 분기: **`GET /api/v1/routines`만 호출**해 대상 루틴의 현재 상태를 붙이고 `{control, routine_id, current, proposed, rationale, notice}`를 `_success`로 반환. **쓰기 호출 금지 · 다른 읽기 path도 금지**(②-6의 `test_propose_only_reads_list`). 신규 `GET /{id}`는 렌더러 전용이라 여기서 부르지 않는다.
- 모듈 독스트링을 갱신: "상태 변경은 사람 클릭 전용" 원칙은 **유지**되고 `propose`는 실행이 아님을 명시(`nudge_guard_tools.py:8-21`과 같은 어조; `_ALLOWED_ACTIONS` 선례는 **`nudge_guard_tools.py:39`**).
- `backend/athena_mcp/server.py`의 루틴 툴 등록 주석을 `draft/list/propose`로 갱신(등록 코드 자체는 무변경 — `builtin_tool_defs()` 그대로). **줄 번호는 Step 0e 노트에서 읽는다** — 이 파일은 origin 대비 `+14`줄 이동했다.
- ⚠ **`rationale`·`notice`의 사용자 노출 문자열 값은 여기서 확정하지 않는다** — 필드만 뚫고, 문구는 Step 6-B에서 07·08 승인본을 원본으로 채운다.

**6b. `backend/tests/mcp/test_routine_tools.py` 단언 교체.**
- `test_tool_schema_only_allows_draft_and_list` → `test_tool_schema_allows_draft_list_and_propose`: `action` enum == `["draft","list","propose"]`, `propose.control` enum == **12종**.
- `test_state_changing_actions_are_gateway_blocked` **파라미터 유지** — 최상위 `confirm`/`cancel`/`activate`가 여전히 차단됨을 고정.
- 신규 **`test_propose_only_reads_list`**(3차의 `test_propose_never_writes`를 이름·단언 모두 확장): 핸들러가 받은 `(method, path)` 집합이 **정확히 `{("GET", "/api/v1/routines")}`**여야 하고 그 밖의 method·path는 **읽기라도** `AssertionError`. `control`을 **12종 전부** 파라미터로 돌린다. 결정 d-2가 신규 GET을 만들었으므로 "쓰기 없음"만으로는 모델 표면 동결이 증명되지 않는다(D-1).
- 신규 `test_propose_rejects_unknown_control`: `control="delete_everything"` → `blocked`.
- 신규 **`test_propose_update_rejects_condition_keys`**(합의 4차): `control="update"` + `proposed={"condition": {...}}`(또는 `condition.op` 평면 키) → `blocked`. 대화 경로가 볼 수 없는 값을 제안하지 못한다는 것을 고정한다(결정 d · ②-1 ④).

**6c. 설정 편집 REST — `backend/athena_api/api/routines.py`.**

계약을 확장하는 결정이므로 옵션을 놓는다.

| 옵션 | 모양 | Pros | Cons |
|---|---|---|---|
| **6c-1 (채택)** 신규 `@router.post("/{routine_id}/update")` | 기존 `confirm`/`pause`(`:211-243`)와 같은 POST 패턴 | ① 라우터 12개가 전부 `POST /{id}/<동사>` 형태라 **파일 안에서 일관**하다(`routines.py:211·232·244·264·277·318·426·448` 실측) ② 허용 필드 화이트리스트를 한 자리에 둘 수 있다 ③ IPC 채널명 `athena:routine-update`와 1:1 | ① 엔드포인트가 1개 는다 |
| 6c-2 기존 `POST /draft` + `POST /{id}/confirm` 재사용 | 편집을 "새 초안 + 확정"으로 표현 | 신규 계약 0 | ① `draft`는 새 `id`를 만든다 — 편집이 **다른 루틴**이 되어 이력·구독이 끊긴다 ② 확정 게이트가 편집마다 다시 서서 GUI 폼 저장이 2클릭이 된다. **기각** |
| 6c-3 `PATCH /{routine_id}` | REST 관례상 부분 수정 | 의미가 가장 정확하다 | ① 이 파일의 라우터 12개 중 PATCH가 하나도 없어 관례를 깬다 ② `main.js`의 `routineHttp`가 POST/GET 전제라 메서드 분기를 추가해야 한다. **기각(일관성 우선)** |

**채택: 6c-1.**
- **편집 허용 8필드:** `note` · `cooldown_s` · `expires_days` · `briefing_model` · `briefing_effort` · `condition.op` · `condition.value` · `condition.consecutive_ticks`.
  ⚠ **합의 3차 정정 — 2차의 "(06 보드 폼 6필드와 문자 그대로 일치)"는 거짓이었다.** 두 집합이 **8 대 6**으로 달랐고(`note`·`expires_days`가 GUI에 없었다), 근거로 든 `rules.py:32 _ALLOWED_CONDITION_KEYS`는 `condition` **하위 4키**만 정의할 뿐 상위 5필드와 무관해 **근거와 주장이 층을 달리했다.** 이제 Step 3의 06 폼이 `만료(일)`·`설명`을 포함하므로 두 집합이 실제로 같고, 정합 판정은 **개수가 아니라 집합 동일성**으로 한다(①-7): `폼의 편집 가능 필드 집합 == 이 8필드 ∩ (해당 소스에서 유효한 필드)`. 소스별 유효성은 **`models.py:42-51 SOURCES`**(`ops`·`value_type`)와 **`rules.py:100-101`**(`consecutive_ticks`는 ws 전용)이 정하며, 그 값은 **`source_spec` 블록으로 서버가 렌더러에 실어 보낸다**(결정 e-1 — 4차 좌표 `:43-52`는 합의 5차에 `:42-51`로 정정했고, **ws 전용 422는 4차의 `:100-101`이 옳았으므로 합의 6차에 되돌렸다**).
- **금지:** `symbol` · `condition.source` 변경 → 422. 이유 **(합의 3차 보강 — U-1 설명의 설득력을 높인다)**: `models.py:101-104 derive_mode`가 `source → transport → mode`를 **결정론적으로 유도**하므로, `condition.source`를 바꾸는 것은 값 하나를 고치는 일이 아니라 루틴을 `realtime-ws` ↔ `scheduled` ↔ `periodic` 사이에서 **다른 종류의 루틴으로 바꾸는 일**이다. 실시간 구독 정체성도 함께 바뀌어 `ensure_realtime_subscription`/`release`(`runtime.py:48,58`) 왕복 설계가 필요해진다 — 최소 범위 밖. **이 제한은 Step 5 U-1의 사용자 확인 항목이다.**
- 상태 규칙: `cancelled`면 409. 그 외는 허용.
- **레거시 소스 루틴 처리 (합의 4차 신설 — 예상치 못한 422 경로를 닫는다).** 아래 실측이 이 경로를 만든다:
  - **`models.py:55-59`**(4차의 `:53-58`은 정정) `LEGACY_DISABLED_SOURCES`에 `disclosure.title_keyword`(periodic/string/`_STR_OPS=("contains",)`)가 있다.
  - **`models.py:107-111`**(4차의 `:112-116`은 정정) `source_spec()`는 `SOURCES` 미스 시 이 레거시 카탈로그로 **폴백**하므로, 저장된 레거시 루틴은 `_view`로 **멀쩡히 표시된다.**
  - 그런데 `rules.py:58-62` `validate_condition`은 레거시 source를 *"이 source는 앱 플러그인 전용이므로 백엔드 루틴 초안에 사용할 수 없다"*로 실패시킨다.
  - 6c의 구현 지시는 `to_dict()` 병합 → `validate_draft()` 재검증이고 `to_dict()`는 `condition`을 통째로 싣는다(`models.py:181-196`). 즉 **쿨다운만 고쳐 저장해도 손대지도 않은 `condition.source` 때문에 422가 나고, 메시지는 사용자에게 아무 의미가 없다.** 3차가 열거한 422 사유는 금지 필드·쿨다운 범위 둘뿐이라 실행자도 테스트 작성자도 이 경로를 예상하지 못한다.
  - **조치:** `update` 핸들러는 재검증 **전에** `spec.condition.source not in SOURCES`를 판정해 **409 + 전용 메시지** **`지원하지 않는 조건 — 취소 후 새로 만들기`**를 낸다. ⚠ **합의 5차 문구 정정:** 4차의 `이 작업은 더 이상 지원하지 않는 조건을 쓰고 있다 — 취소 후 새로 만들어야 한다`는 **완결 설명문**이라 P5("설명문 금지, 상태 표기만")를 계획 자신이 어겼고, ①-10의 정규식(`습니다|입니다|합니다|됩니다`)은 `~한다` 종결을 못 잡아 **게이트가 전건 통과**했을 자리다. 이 문자열은 렌더러가 그대로 사용자에게 보여주므로 Step 6-B 문구 게이트 대상에 넣는다. 06 폼·설정 패널은 그런 루틴을 **편집 폼이 아니라 읽기 전용 + `이 작업은 취소 후 새로 만들기` 표기**로 그린다(①-7). ②-9의 10번째 케이스가 이 409를 고정한다.
  - **①-7·②-1의 근거 층 정합:** 3차는 유효성 근거로 `models.py:42-51 SOURCES` 6종을 단정했는데 폼이 실제로 부르는 `source_spec()`는 **더 넓은 카탈로그**를 본다 — 3차가 `_ALLOWED_CONDITION_KEYS`에서 잡아낸 것과 같은 부류의 층 불일치다. 이제 두 AC 모두 `source_spec()`를 근거로 쓰고, 레거시 분기를 명시한다.
- **구현 (합의 3차에 만료 손상 결함을 고쳤다):** 기존 spec의 `to_dict()`에 허용 필드만 병합 → **`note` 신선도 판정(아래)** → `rules.validate_draft()`로 재검증 → 원래 `id`/`status`/`created_at`/`approved_at`/**`expires_at`**을 복원해 `store.upsert()` → **§1.6 「반환 키 목록」 형태로** 반환.

  ⚠ **`note` 신선도 규칙 — 신설(합의 5차, R30).** `to_dict()`(`models.py:181-196`)가 기존 `note`를 그대로 싣고, `rules.py:168-169`의 `if not note: spec.note = spec.human_summary()`는 **note가 빈 경우에만** 재생성한다. `human_summary()`(`models.py:168-179`)는 `f"{symbol} · {label} {op} {value} · 방식 {mode}"`다. 따라서 **note를 지정하지 않고 만든 루틴(기본 경로)의 조건을 편집하면 옛 술어 문장이 그대로 남는다.** 그 `note`는 감시·예약·초안 **모든 목록 행의 제목**(`agent-canvas.js:1285`·`:1299`·`:1313`)이고 설정 표면이 `['조건', r.note]`로 **조건이라 라벨하는 값**(`:1000`)이며, `_view`(`routines.py:122`)가 내보내므로 **모델이 읽는 유일한 루틴 설명**이다. 조건을 `88,000 → 90,000`으로 고치면 목록·설정·모델이 **모두 계속 `현재가 >= 88000`이라고 말한다** — R22(만료 리셋)·R23(가드 상한 복귀)과 같은 '조용한 손상' 계열이고, 이번에는 **이 계획의 신규 엔드포인트가 원인**이며, 하필 4차가 D-1로 지키려 한 "모델 도달 표면의 정직성"을 정면으로 훼손한다. **규칙 둘:**
  1. 병합 **전** `spec.note == spec.human_summary()`이면(= 자동 생성분이면) **`condition`이 실제로 바뀐 경우에 한해** 병합 dict의 `note`를 **비워** `validate_draft`가 새 술어로 재생성하게 한다.
  2. 그 밖의 경우(사용자가 직접 쓴 `note`, 또는 본문이 `note`를 명시적으로 보낸 경우)에는 **절대 덮지 않는다.**
  - ②-9의 11번째 케이스가 두 분기를 고정하고, 9c 2행 상태 확인에 **`note` 항목이 추가된다**(4차는 `cooldown_s`·`expires_at`만 봤다).

  ⚠ **왜 `expires_at` 복원이 필요한가 (조용한 데이터 손상).** `RoutineSpec.to_dict()`(`models.py:181-196`)는 **`expires_at`**(ISO 문자열)을 내고 **`expires_days`를 내지 않는다.** 그런데 `validate_draft`는 `expires_days = raw.get("expires_days", 7)`(`rules.py:126`) → `expires_at = now + timedelta(days=expires_days)`(`:162`)로 계산한다. 따라서 병합 dict에 `expires_days`가 없으면 **원래 만료가 버려지고 now+7일로 덮인다.** 2차의 복원 목록(`id`/`status`/`created_at`/`approved_at`)에는 `expires_at`이 없어 되돌려지지도 않았다 — 사용자가 30일 만료로 만든 감시 루틴의 **쿨다운만 고쳐도 만료가 7일로 줄고 화면은 성공으로 보고**했을 자리다. 규칙 둘로 못 박는다:
  1. 본문에 `expires_days`가 **오지 않았으면** 원래 `expires_at`을 그대로 복원한다(만료 불변).
  2. 본문에 `expires_days`가 **왔을 때만** `now + timedelta(days=expires_days)`로 다시 계산한다.

**`active` 감시 루틴의 술어 편집이 실행 중인 구독에 반영되는가 — 검증 항목(409로 막지 않는 근거).**
초안은 이 질문을 열어둔 채 `cancelled`만 409로 막았다. 실측으로 닫는다:

- `backend/athena_api/routines/scheduler.py:266-268`의 `_realtime_loop`가 **틱 메시지마다** `active = [s for s in self.store.list_active() if s.mode == "realtime-ws"]`를 다시 만든다 — 루프 밖에서 캐시하지 않는다. 따라서 `store.upsert()`한 새 `condition.op`/`value`/`consecutive_ticks`는 **다음 틱부터 그대로 반영된다.** ⇒ `active` 편집을 409로 막을 필요가 없다.
- 그러나 **`TriggerEngine._states`는 `routine_id`로 캐시되고 편집으로 초기화되지 않는다**(`triggers.py:64-70` `TriggerState(consecutive, last_fired_at, near_active)`, **`:81-83`** `_state()`의 `setdefault` — 2차의 `:79-80`은 정정). `consecutive_ticks`를 1→3으로 올려도 이전에 누적된 `state.consecutive`가 남아 **의도보다 빨리 발화**할 수 있다.
- **따라서 6c 구현에 한 줄을 더한다:** `condition`이 실제로 바뀐 경우 해당 `routine_id`의 `TriggerState`를 초기화한다(엔진에 `reset_state(routine_id)`를 노출하고 `update` 핸들러가 호출).
- **테스트(②-9):** ① `active` + `realtime-ws` 루틴의 `condition.value`를 바꾼 뒤 `store.list_active()`가 새 값을 돌려준다 ② `consecutive`가 2까지 쌓인 상태에서 `condition` 편집 후 `_state(routine_id).consecutive == 0`.

- 신규 테스트 `backend/tests/api/test_routines_update.py`: 정상 반영 · 금지 필드 422 · 잘못된 쿨다운 422(`MIN_COOLDOWN_S=60`, `MAX_COOLDOWN_S=86_400`, **`models.py:229-230`**) · 404 · 409(cancelled) · 술어 반영 2건 · **만료 보존 2건**(`expires_days` 미전송 시 `expires_at` 불변 / 전송 시에만 갱신) · **409 레거시 소스**(전용 메시지, 합의 4차) · **`note` 신선도 2분기**(자동 생성분은 새 술어 반영 / 사용자 작성분 불변, 합의 5차) = **11 케이스**.
- **소스별 계약 테이블 구동 테스트 1건 추가:** `SOURCES` **6종 전부**를 파라미터로 돌며 ① `spec.ops`에 없는 `op`는 422 ② `value_type`에 맞지 않는 `value`는 422 ③ `transport != 'ws'`인 소스에 `consecutive_ticks > 1`을 보내면 422(**`rules.py:100-101`**)를 단언한다. 이 테스트가 06 폼의 분기 계약(①-7)의 백엔드 짝이다.

**6c-2. 조건 원문 읽기 REST — 결정 d-2의 구현 (합의 4차 신설).**

`backend/athena_api/api/routines.py`에 **`@router.get("/{routine_id}")`** 신설. 3차는 쓰기만 만들고 읽기를 한 줄도 건드리지 않아 06 폼·07 A열이 **두 경로 모두에서 구현 불가**였다(§1.6이 옵션 표로 이 결정을 세운다).

- **반환: §1.6 「반환 키 목록」 그대로다.** `condition = {source, op, value, consecutive_ticks}`(4키, `rules.py:32 _ALLOWED_CONDITION_KEYS`와 같은 집합) + **`source_spec = {ops, value_type, transport, label}`**(결정 e-1). 없는 id는 404.
  ⚠ **합의 5차 정정 — 4차의 "`_view(spec, runtime)` 결과 전부"는 폐기한다.** `_view(spec, runtime, *, latest_fired=None)`(`routines.py:108-110`)의 독스트링이 밝히듯 `latest_fired`는 **`list_routines()`가 ledger를 1회 스캔해 만든 맵에서 주입**하는 값이라, 상세 라우트에서 그대로 부르면 `last_fired_at`(`:134`)·`unread`(`:135`)·`missed`(`:140-141`)가 **거짓을 낸다** — 특히 `_is_missed(missed_at, None)`이 `last_fired_at is None`에서 **`return True`**(`:79-80`)이므로 **예약 루틴은 `missed`가 항상 참**이 되고, Step 7a가 `missed === true`를 `지금 실행` 활성 조건으로 쓰므로(R7) **409를 부르는 거짓 활성 버튼**이 생긴다. 대안 (a)(최신 fired 1건을 조회해 주입) 대신 **(b) 응답을 좁힌다** — 이 라우트는 `last_fired_at`·`unread`·`missed`·`next_fire_at`·`created_at`·`approved_at`을 **내지 않는다.** 같은 키 이름이 두 엔드포인트에서 다른 진실을 말하지 않게 하는 것이 P3다.
- **`GET /api/v1/routines/source-catalog` 신설(결정 e-1).** 활성 `SOURCES` 6종(`models.py:42-51`)을 `{source: {ops, value_type, transport, label, experimental}}`로 낸다. **`LEGACY_DISABLED_SOURCES`는 내지 않는다** — `validate_condition`(`rules.py:58-62`)이 신규 생성을 이미 막으므로 선택지로 내면 죽은 선택지가 된다(P3). 이 응답이 05 `＋ 새 작업` 시트의 유일한 카탈로그 출처다(시트에는 routine_id가 없어 상세 라우트를 부를 수 없다).
- ⚠ **선언 위치가 계약이다.** FastAPI는 **선언 순서**로 매칭하므로 **무동사 GET 둘이 `/{routine_id}`보다 앞에** 와야 한다. 확정 순서: **`@router.get("/briefing-budget")`(`≈:186`) → `@router.get("/source-catalog")`(신설) → `@router.get("/{routine_id}")`(신설).** 뒤집으면 각각 `routine_id="briefing-budget"`·`"source-catalog"`로 먹혀 404가 된다. ②-9b ④·⑤가 두 회귀를 단언한다(R26).
- **`_view`는 건드리지 않는다.** 목록 응답에 `condition`을 넣는 안(d-1)을 기각한 이유가 여기 있다 — 목록은 **모델이 도달하는 유일한 읽기 표면**이고, `_view:111`의 독스트링이 그 축소를 의도로 선언해 뒀다.
- **모델 차단은 테스트가 한다:** ②-6의 `test_propose_only_reads_list`가 허용 path 집합을 `{"/api/v1/routines"}`로 못 박으므로, **두 신규 라우트 모두** 모델에게 **존재하지 않는 것과 같다.**
- 신규 테스트 `backend/tests/api/test_routines_detail.py`(②-9b **5케이스**).

**6c-3. `athena:routine-detail`·`athena:routine-source-catalog` IPC (6d·6e가 배선, 여기서는 계약만).**
- main 핸들러 2개: `routineHttp('GET', `/api/v1/routines/${id}`)` · `routineHttp('GET', '/api/v1/routines/source-catalog')` — 기존 `athena:routine-runs`와 같은 모양(body 없음).
- 렌더러: **상세 패널의 설정 폼을 열 때 1회** `routine-detail`을 호출해 폼을 프리필한다(결정 f-2로 위치가 드릴인 탭에서 상세 패널로 바뀌었다). 목록 행(`item.raw`)만으로는 조건 술어도 `source_spec`도 알 수 없으므로 이 호출이 없으면 폼이 빈 채로 그려지거나 사본 상수를 발명하게 된다(P3 · R20 · R25).
- 렌더러: **05 `＋ 새 작업` 시트를 열 때 1회** `routine-source-catalog`를 호출한다(routine_id가 없어 상세 라우트를 쓸 수 없다).
- 선례: `app/canvas.js`가 이미 같은 응답에서 필드를 뽑는 얇은 어댑터를 3개 두고 있다(`fetchRuns`·`fetchAvgDuration`·`fetchEngagement`, **origin 실측 `≈:3022·3029·3035`** — 4차의 `≈:3023·3030·3036`은 정정) — `fetchCondition(id)`·`fetchSourceCatalog()`는 그 4·5번째이고 새 패턴이 아니다(P4).

**6d. `app/main.js` — IPC 신설·확장.** (줄 번호는 Step 0e 노트에서 읽는다.)
- 신설 핸들러 `athena:routine-update` — **`routineHttp('POST', `/api/v1/routines/${id}/update`, body)`**.
- 신설 핸들러 `athena:routine-draft` — **`routineHttp('POST', '/api/v1/routines/draft', body)`**(결정 a″-1). 백엔드는 무변경(`routines.py:145-150`이 이미 raw dict를 받는다).
- 신설 핸들러 **`athena:routine-detail`** — **`routineHttp('GET', `/api/v1/routines/${id}`)`**(결정 d-2 · 6c-2). 기존 `athena:routine-runs` 핸들러와 같은 모양이며 body가 없다.
- 신설 핸들러 **`athena:routine-source-catalog`** — **`routineHttp('GET', '/api/v1/routines/source-catalog')`**(결정 e-1 · 6c-2). 인자도 body도 없다.
- ⚠ **합의 3차 철회 — 2차의 "현 `routineHttp`는 body 없음 전제이므로 `fetch` 직접 호출로 쓴다"는 사실 오인이었다.** origin 실측 `app/main.js:1192`의 시그니처는 `async function routineHttp(method, path, jsonBody, { signal } = {})`이고 `:1194-1197`이 이미 `if (jsonBody !== undefined) { opts.headers = {'Content-Type':'application/json'}; opts.body = JSON.stringify(jsonBody); }`를 한다. 실제로 `:714-722`가 `briefing-result`에 payload를 실어 호출한다. 2차가 근거로 삼은 것은 **`main.js:1289-1291`의 낡은 주석**("set은 body가 필요해 routineHttp(body 없음 전제)를 재사용하지 않는다")이며 그 주석이 코드보다 오래됐다. `fetch`를 직접 부르면 두 신규 핸들러가 각자 json 파싱·상태코드 분기를 복제해 `routineHttp`가 소유한 `{ok, status, error}` 응답 모양과 `body.detail` 오류 번역이 갈라진다 — 6c-1이 422(금지 필드)·404·409(cancelled)의 `detail`을 쓰는 만큼 그 번역이 **실제로 필요하다**(P4 "기존 계약을 덮지 않고 잇는다").
- 신설 함수 `maybeForwardRoutineProposal(step, resultBlock)` — **`main.js`에 이미 있는 포워더 3개**(`maybeForwardNudgeGuardProposal ≈:2300` · `maybeForwardGraphChatAction ≈:2331` · `maybeForwardBacktestChatAction ≈:2375`, origin 실측)와 **동형인 4번째**다: `is_error` 배제 · 툴 base 이름이 `athena_routine` · `step.input.action === 'propose'` · `extractToolResultText`(`≈:2434`) 재사용 · JSON 파싱 실패 시 무시 → `shellWin.webContents.send('athena:routine-proposed', payload)`. **orbWin에는 보내지 않는다**(선례 주석의 이유 그대로).
- 선 디스패치 지점(`≈:2494`, `maybeForwardNudgeGuardProposal(step, block)` 호출 자리)에 새 함수 호출을 나란히 추가한다.
- **`athena:routine-catchup-fire`는 만들지 않는다** — 기존 `athena:routine-missed-confirm`(`≈:818`)이 이미 catchup-fire + 브리핑 실행을 정합하게 수행한다(P4).

**6e. `app/preload.js` — 채널 허용 목록.** (**선언 줄이 아니라 삽입 구역 기준점으로 찾는다** — Step 0e.)
- `INVOKE_CHANNELS`의 루틴 채널 블록(`'athena:routine-runs'` 인접, `≈:55`)에 `'athena:routine-update'`·`'athena:routine-draft'`·**`'athena:routine-detail'`**·**`'athena:routine-source-catalog'`**(합의 5차 — 결정 e-1) 추가(**4개**).
- `ON_CHANNELS`의 제안 채널 블록(`'athena:nudge-guard-proposed'` 인접, `≈:295`)에 `'athena:routine-proposed'` 추가 + 주석(제안 payload, 비영속, 확정은 렌더러 클릭).

**6f. `app/lib/main/agent-session.js` + `.test.js` 신설.** 결정 (b) §1.4의 계약 그대로 — `FOUNDATION_PRESENT` · `getAgentConsoleSessionId(snapshot)` **2함수**. ⚠ **`isDerivedAlertRoom(roomId)`은 이 파일이 소유하지 않는다(합의 6차 확정)** — 렌더러 UMD 모듈 **`app/lib/agent-proposal.js`**(7c)가 노출하고, `agent-session.js`는 필요하면 `require('../agent-proposal')`로 가져다 쓴다. 5차까지는 소유가 미정이라 실행자가 **사본 두 벌**을 만들 수밖에 없었다.
- ⚠ **소비자를 함께 만든다(합의 3차).** 2차는 이 모듈을 신설하고 단위 테스트까지 요구했으면서 **어느 Step에서도 호출하지 않았다.** 소비자 없는 모듈은 CLAUDE.md §2 위반이자 스펙 Constraints:54(타 모드 불간섭)를 코드로 강제하는 것이 하나도 없다는 뜻이다. 이 계획에서 호출부는 **Step 7d 두 곳**이다(§1.4 "프로덕션 연결 지점"). `agent-session.js`가 main 프로세스 모듈이고 판정은 렌더러에서 필요하므로, **렌더러가 부르는 순수 판정 함수 둘(`shouldRenderProposal({activeMode, roomId})`과 `isDerivedAlertRoom(roomId)`)은 `agent-proposal.js`가 노출**하고, `agent-session.js`는 main 쪽 `conversations.js` 스냅샷 판정(`FOUNDATION_PRESENT`·`getAgentConsoleSessionId`)만 소유한다 — 두 파일 모두 DOM·IPC 없는 순수 모듈이다. ⚠ **소유가 이 방향이어야 하는 이유(합의 6차 — 5차는 여기를 절반만 정리해 `isDerivedAlertRoom`을 미정으로 남겼다):** 렌더러 모듈은 `app/shell.html`의 `<script src="lib/*.js">`(**83줄**)로만 로드되고 그 목록에 **`lib/main/*`은 0건**이므로 반대 방향(렌더러가 main 모듈을 import)은 **성립하지 않는다.** 반면 main → 렌더러 UMD 방향은 선례가 있다 — `app/main.js:29` `const { todayYyyymmdd } = require('./lib/backtest-spec')`. 이 방향을 택하면 판정 사본이 **0**이다(e-1과 같은 판단 기준).

- **검증:**
  - `cd <worktree>/backend && uv run pytest tests/mcp/test_routine_tools.py tests/mcp/test_nudge_guard_tools.py tests/api/test_routines_update.py tests/api/test_routines_detail.py -q` → 0 failed
  - `cd <worktree>/app && npm test` → 0 failed, `agent-session.test.js` 신규 통과
- **충족 AC:** ②-4 ②-5 ②-6 ②-7 ②-8 ②-9 **②-9b**

### Step 5 — PDF 발송 · 검수 게이트 — 🛑 **사람 정지점 ①(2개 중 첫째)**

> **선행 조건: Step 4 검증 통과 + Step 6-A 검증 통과.** 6-A는 문구 무관이라 이 게이트 앞에서 이미 끝나 있다(위 배치 정정).

> **ralph는 여기서 멈춘다.** 사용자 승인 문자를 받기 전에는 Step 6-B·Step 7 이후로 진행하지 않는다. **Step 6-A는 이미 끝나 있다** — 순차 실행자에게 "대기 중 병행"은 성립하지 않으므로 배치로 해결했다(§1.5).

1. `export_combined_pdf`로 A-2 8장을 단일 PDF로. 8장이 한 번에 안 되면 4+4로 나눠 export 후 병합.
2. 활성 페이지를 Step 0f에서 기록한 페이지로 되돌리고 `finish_working_on_nodes` 호출.
3. `SendUserFile`로 PDF 전달 + 변경 요약 표(보드별 1줄).
4. **사용자 확인 항목 — 승인 요청과 함께 명시적으로 묻는다**(예/아니오로 답할 수 있게 항목별로 분리):

   | # | 확인 항목 | 왜 사용자에게 묻는가 | 계획의 기본안 |
   |---|---|---|---|
   | U-1 | **`condition.source`(그리고 그로부터 유도되는 `모드`)를 설정 편집에서 제외하는 것이 "모든 설정 편집"(D2)을 만족하는가** | open-questions #3. `derive_mode`가 `source → transport → mode`를 결정론적으로 유도하므로(`models.py:101-104`) source 변경은 루틴을 **다른 종류의 루틴으로 바꾸는 일**이고 `ensure/release` 왕복 설계가 필요해 최소 범위를 넘는다 — 그러나 이는 **범위 축소**이므로 조용히 넘기지 않는다(사용자 확정 4). ⚠ **합의 4차 대상 정정:** 3차 U-1은 `종목`·`source` 둘을 물었으나, 스펙 A 인벤토리의 편집 대상 열거는 `조건·모드·소스·쿨다운·브리핑 모델`이라 **`종목`은 애초에 스펙 범위가 아니다**(제외해도 축소가 아니다 — 다만 화면에는 읽기 전용으로 남는다, ①-7). 반대로 **`모드`는 스펙 범위인데 3차 U-1이 묻지 않았다.** 이제 묻는 대상을 스펙 문면에 맞춘다 | `source` 변경은 422로 금지하고, 06 보드·설정 패널에 **`종목·소스는 취소 후 새로 만들기`** 안내를 넣는다(Step 3-3, Step 7a). `모드`는 파생값이라 직접 편집 대상이 아니고 `소스`를 통해서만 바뀐다 |
   | U-2 | MCP 제안 enum이 `propose` 중첩(a′-1)이어도 되는가, 스펙 문면대로 최상위 확장(a′-2)인가 | open-questions #2. 게이트웨이 회귀 방어가 걸려 있다 | a′-1. 되돌리는 비용은 `routine_tools.py` 1파일 + `test_routine_tools.py` 단언 |
   | U-3 | `미리보기 실행` 칩을 07 보드에도 **비활성으로 그릴지**, 칩 자체를 빼고 `바로 활성화`만 둘지 | open-questions #5. 죽은 버튼 금지(P3)는 둘 다 만족한다 | 07 보드에는 **그리지 않는다**(칩 2개 유지) |
   | U-4 | "보류"(C)가 서버에 남지 않고 앱 재시작 시 되살아나도 되는가 | open-questions #4. 백엔드에 채택/보류 기록 엔드포인트가 없다 | 렌더러 로컬 + `보류함 N건` 정직 표기 |
   | **U-5** | **조건 술어(`비교`·`값`·`연속 틱`) 편집을 GUI 전용으로 두고, 대화로 요청하면 설정 탭을 여는 것(`view` 핸드오프)이 D2를 만족하는가** (**합의 4차 신설**) | 결정 (d). 스펙 A 인벤토리는 편집 대상에 **`조건`을 명시**하므로 이것은 **대화 경로의 부분 축소**이고, 사용자 확정 4가 조용한 축소를 금지한다. 근거: 모델이 도달하는 유일한 읽기가 조건을 `source_label`(`"현재가"`) 한국어 라벨로만 주므로, 대화 경로가 술어를 제안하려면 **라벨 역추론 파서를 발명**해야 한다(P3 위반 · R20 재발) | **기본안:** 조건 술어는 GUI 전용, 대화는 공통 5필드(`쿨다운`·`설명`·`만료`·`브리핑 모델`·`브리핑 노력`)만 제안하고 조건 요청에는 `control:'view'`로 설정 탭을 연다. **대안(반려 시):** 결정 d-1로 바꿔 `_view`에 `condition`을 실어 모델도 술어를 보게 한다 — 비용은 `test_propose_only_reads_list`의 허용 집합이 넓어지고 **모델 도달 표면이 실제로 커진다는 것**(D-1)이며, 되돌리는 코드 변경 자체는 `routines.py` `_view` 1곳 + 단언 1건으로 작다. ⚠ **합의 5차 근거 정정 — 이 항목의 판단 근거가 사실과 어긋나 있었다(머리말 철회 5).** 4차 U-5는 *"모델이 조건을 `source_label` 한국어 라벨로만 본다"*를 전제로 승인을 구했는데 **거짓이다** — 자동 생성 `note`(`rules.py:168-169` + `models.py:168-179`)가 `005930 · 현재가 >= 88000 · 방식 …`을 모델에게 이미 넘긴다. 정확한 질문은 **"모델이 술어를 보는가"가 아니라 "모델이 유효한 술어 패치를 조립할 수 있게 할 것인가"**다(기계 판독 소스 키 `price.current`와 연산자 집합이 나가느냐). 사용자가 이 차이 위에서 판단하도록 문면을 고쳤다. ⚠ **반려 시 착지점이 둘이다(합의 6차 명시):** 대안 d-1은 **D-1(모델 도달 읽기 표면 동결)을 깬다** — 계획 자신이 ADR Alternatives에 그렇게 적어 뒀다. 원칙을 하나도 깨지 않는 제3안은 **「조건 술어 편집을 양 경로에서 빼고 `조건은 취소 후 새로 만들기`로 표기」**이며(ADR Alternatives 편입), 반려 시 그쪽을 먼저 검토한다 |
   | **U-6** | **GUI 설정 편집 폼을 드릴인 `설정` 탭이 아니라 「상세 패널」로 옮기고, 드릴인 `설정` 탭은 읽기 전용 요약 + **`설정 편집` 버튼**(누르면 드릴인이 닫히고 상세 패널 설정 폼으로 간다 — 합의 6차 동작 확정)만 남기는 것이 맞는가** (**합의 5차 신설 · 6차 동작 정정**) | 결정 (f). 실측으로 드릴인 진입 버튼은 **감시(watch) 항목에서만** 그려진다 — 바깥 게이트 `if (item.kind !== 'draft')`(`agent-canvas.js:1525`) + 안쪽 게이트 `if (item.kind === 'watch')`(`:1533`), 그리고 파일 머리말 `:59-62`가 *"draft·예약(schedule)은 이 링크가 없다"*를 계약으로 적어 뒀다. 4차 명세대로 두면 **예약·초안 루틴에는 GUI 설정 편집 경로가 존재하지 않아** D2가 조용히 축소되고 9c 2행의 GUI 다리가 실행 불가다. 화면 계약이 바뀌는 일이라 조용히 넘기지 않는다(사용자 확정 4) | **기본안:** f-2 — 폼을 상세 패널(`renderDetail`, 세 kind 전부에서 그려지고 `확정` 버튼이 들어가는 그 자리)로 옮긴다. **대안(반려 시):** f-3 — "GUI 설정 편집은 감시 루틴 전용"을 선언한다. 그 경우 06 보드가 그리는 `schedule.daily` 폼에 **앱 대응물이 없어져** 보드 문구를 함께 고쳐야 하고 9c 2행이 예약 루틴에서 성립하지 않는다. ⚠ **f-3을 택하면 D2("GUI도 모든 제어")의 명시적 축소가 확정된다(합의 6차 명시).** 원칙을 깨지 않는 제3안은 U-5와 같다 — **조건 술어 편집을 양 경로에서 빼는 안**(ADR Alternatives 편입)이며, 반려 시 그쪽을 먼저 검토한다 |

5. **승인 판정:** **6항목 모두** 답을 받고 PDF 승인 문자를 받으면 통과. U-1이 반려되면 Step 6-A c의 REST 편집 허용 목록과 06 보드가 함께 바뀌므로 **Step 6-A c 이후를 재작업**한다. **U-5가 반려되면** 6-A a의 `proposed` 허용 키와 6-A c-2의 읽기 계약(d-2 → d-1)이 함께 바뀌므로 역시 **6-A c 이후를 재작업**한다 — 두 항목 모두 6-A 안쪽이라 Paper 재작업은 06 보드 1장에 그친다. **U-6이 반려되면**(f-2 → f-3) 바뀌는 것은 **렌더러(Step 7a)와 06 보드 1장·8c 프로브 단언**뿐이고 백엔드·IPC는 무변경이다 — 다만 9c 2행의 시연 루틴을 감시 루틴으로 바꿔야 하므로 Step 9b 준비 데이터도 함께 고친다.
- **충족 AC:** ①-11 ①-12

### Step 6-B — 사용자 노출 문자열 확정 (**검수 승인 후 — Step 5 통과가 선행 조건**)

Step 6-A에서 필드만 뚫어 둔 자리에 승인된 문구를 채운다. **원본은 07·08 보드의 승인본이며, 같은 문자열이 세 곳에 그대로 들어간다.**

- `routine_tools.py`의 `propose` 응답 `notice` 기본 문구 — 07 보드 각 열의 상태 표기와 일치.
- `app/lib/agent-proposal.js`의 `proposalCardModel`·`resultCardModel` 문자열(Step 7c) — 07·08 표와 문자열 일치.
- **`app/lib/agent-canvas.js`가 새로 그리는 사용자 노출 문자열**(합의 5차 편입 — 4차 게이트의 사각): `놓친 예약 없음` · `보류함 N건` · `이 작업은 취소 후 새로 만들기` · `종목·소스는 취소 후 새로 만들기` · **`설정 편집`**(합의 6차 — 5차의 `설정 편집 ↓`에서 `↓`를 뺀다: 그 버튼은 아래로 스크롤하지 않고 드릴인을 닫는다, 결정 f-2 부록).
- **`확정` 버튼 비활성 표기 — `activation_blocker`는 신호로만 쓰고 문구는 제품이 소유한다(합의 6차 재정의).** 5차는 `<blocker>` **원문 그대로**를 그리기로 했는데, 실측 `can_activate`(`backend/athena_api/routines/runtime.py:71-85`)의 반환값 셋은 전부 **`~없다` 종결의 완결 설명문**이고 `:78`·`:85`는 **영문 내부어 `source`**를 포함한다(`"이 외부 데이터 source는 앱 플러그인 전용이라 백엔드에서 활성화할 수 없다"`). 그대로 그리면 P5의 「설명문 금지(상태 표기만)」와 「내부어 금지」를 **동시에** 어기는데, ①-10의 정규식은 `~없다`를 못 잡으므로 **게이트가 전건 통과하면서 화면이 규율을 어긴다.** 5차는 접두어 중복만 없앴고 설명문은 화면에 남겼다. **3분기 매핑을 문구로 확정한다:**

  | `can_activate` 분기(신호) | 화면 문구(제품 소유) |
  |---|---|
  | `condition.source in LEGACY_DISABLED_SOURCES`(`runtime.py:78`) | **`이 작업은 취소 후 새로 만들기`** — 6c·7a·①-7이 **같은 루틴**에 이미 배정한 문구다. 5차는 여기에 `<blocker>` 원문과 이 문구 **둘**을 배정해 한 상태에 두 문구가 있었다(P3) |
  | `mode == "realtime-ws"` + `ws_client is None`(`:81`) | **`실시간 감시 불가 — 키움 연결 없음`** |
  | 그 밖(`:85`, 백엔드 실행 경로 없음) | **`백엔드 실행 경로 없음`** |
  | 위 셋에 해당하지 않는 미지의 blocker | `<blocker>` **원문 폴백** + Step 0e 노트에 기록(정직 유지 — 지어내지 않는다, P3) |

  근거: 이 계획은 이미 **`missed`(백엔드 boolean) → `놓친 예약 없음`(제품 문구)**의 선례를 갖고 있으므로 새 원칙이 아니다. **e-1과도 충돌하지 않는다** — e-1이 막는 것은 *유효성을 정하는 카탈로그의 사본*이지 표시 문자열이 아니며, 표시 문자열의 단일 원본은 6-B가 이미 07·08 보드로 정해 뒀다. 접두어 `지금은 켤 수 없음: `은 여전히 쓰지 않는다.
- **`backend/athena_api/api/routines.py`의 신규 409 detail**: **`지원하지 않는 조건 — 취소 후 새로 만들기`**(6c 문구 정정분).
- ①-10의 문구 3원칙 정규식 검사를 **이 문자열들에도** 적용한다(서술형 종결 0건 · 영문 내부어 0건 · 비한국어 단위 0건). ⚠ 정규식은 `~한다`·`~없다` 종결을 못 잡으므로 **백엔드 유래 문자열은 위 문자열 지정으로 대신 못 박았다.**
- **충족 기준(합의 6차 재정의 — 5차 기준은 구조적으로 통과 불가였다):**
  1. **전체 파일 정규식 grep**은 **이 계획이 새로 만드는 파일에만** 건다: `grep -rnE "(습니다|입니다|합니다|됩니다)['\"]" <worktree>/app/lib/agent-proposal.js <worktree>/backend/athena_mcp/routine_tools.py <worktree>/backend/athena_api/api/routines.py` → **0건**.
  2. **`app/lib/agent-canvas.js`는 전체 파일이 아니라 문자열 지정으로 본다**(①-10이 이미 쓴 조작적 정의 *"이 계획이 신설·수정한 문자열 전체"* 그대로): `grep -n "놓친 예약 없음\|보류함\|이 작업은 취소 후 새로 만들기\|종목·소스는 취소 후 새로 만들기\|설정 편집\|지금은 켤 수 없음\|실시간 감시 불가 — 키움 연결 없음\|백엔드 실행 경로 없음" <worktree>/app/lib/agent-canvas.js` — 나온 줄들이 **위 문구 목록과 문자열로 일치**하고, `지금은 켤 수 없음`은 **0건**(접두어 금지)이다.
  - ⚠ **왜 파일 전체 grep을 쓰면 안 되는가(실측).** `git show origin/main:app/lib/agent-canvas.js`에 5차의 정규식을 그대로 돌리면 **11건**이 나온다 — `:207 '활성 예약이 없습니다'` · `:595 '받은 알람이 없습니다'` · `:823 '…지원하지 않습니다'` · `:913 '실행 이력이 없습니다'` · `:1160 '가드 설정을 불러오는 중입니다'` · `:1200 '아직 읽히는 성향이 없습니다'` · `:1260 '지금은 표시할 제안이 없습니다'` · `:1427 '선택된 항목이 없습니다'` · `:1471 '…이번 스코프 밖입니다'` · `:1567 '루틴 발화 — 묻지 않은 턴입니다'` · `:1595 '조건에 맞는 작업이 없습니다'`. **전부 이 계획의 범위 밖 빈 상태 문구**이고, 계획이 실제로 지우는 `:1039`는 `됩니다.'`(마침표) 때문에 **애초에 그 정규식에 걸리지도 않는다** — 즉 계획의 편집을 다 해도 결과는 여전히 11이다. 5차 기준대로면 실행자에게 남는 선택지는 (i) 게이트를 거짓으로 판정하거나 (ii) **검수받지 않은 제품 문구 11개를 임의로 고치거나**(CLAUDE.md §3 「수술적 변경」·P4 위반, 게다가 PDF 검수를 거치지 않은 사용자 노출 문자열 변경) (iii) Step 6-B에서 멈추는 것뿐이었다. **게이트와 지시의 사정거리를 맞춘다** — 8c에서 `inputCount >= 4`를 폐기하며 세운 기준의 같은 적용이되, 이번에는 반대 방향(게이트가 올바른 구현을 반려하던 자리)이다.

### Step 7 — 렌더러 GUI (**검수 승인 후**)

**7a. `app/lib/agent-canvas.js` — GUI 경로 완성.**

| 위치 | 바꾸는 것 | 새 콜백(canvas.js가 주입) |
|---|---|---|
| `:359-364` CTA | 라벨 `＋ 새 작업 · 채팅에서` → `＋ 새 작업`. 클릭 시 **시트 열기**(기존 `onNewTaskClick`은 시트 안 `채팅에서 쓰기` 버튼으로 이동) | `onSubmitNewTask(draft)` |
| `:501-520` 동선 규칙 | 캡션 `동선 규칙` → `이중 제어 규칙`, `ROUTE_RULES` 3줄을 Step 3 확정 문구로 교체. 클래스명·`data-source` 부재는 유지 | — |
| **주석 4곳(합의 6차 명시 — V9 게이트의 사정거리를 지시와 맞춘다)** | `:300`(*"…상세 패널은 보기 전용"*) · `:359`(동선 규칙①) · `:987`(동선 규칙②) · `:1444`(*"draft는 읽기 전용이다(동선 규칙③…)"*)를 **새 계약 문면으로 갱신**한다. 넷 다 **이 계획이 실제로 거짓으로 만드는 주석**이다 — f-2가 *"상세 패널은 보기 전용"*을, `확정` 버튼이 *"draft는 읽기 전용"*을 뒤집는다. ⚠ **5차까지 이 넷은 명시 편집 목록 밖이었는데 V9는 두 파일 전체에서 `보기 전용\|동선 규칙` **0건**을 요구했다** — 실측 origin에서 `agent-canvas.js`는 `:25`·`:300`·`:359`·`:501`·`:504`·`:508`·`:513`·`:987`·`:1021`·`:1444` **10곳**이고 계획이 명시한 것은 `:25`·`:501-520`·`:1021`뿐이라, **게이트가 명시 지시보다 넓어 실행자가 그 자리에서 임의 판단**을 하게 돼 있었다(8c에서 `inputCount >= 4`를 폐기하며 세운 기준의 같은 적용). 비용은 거의 0이고 범위 밖 편집을 강요하지도 않는다 | — |
| `:272-276` 모두 읽음 | `AthenaNotify.markAllRead()`만 부르던 것을 **읽지 않은 방마다 `athena:routine-ack`도 부르도록** 확장 — 서버에 읽음이 남지 않던 갭을 닫는다(`read_marks`, `routines.py:448-462`). **대상 집합을 아래 필터로 못 박는다** | `ackAllAlerts(ids)` |
| 알람 행 | 개별 `읽음` 버튼 신설 | `ackAlert(id)` |
| 상세 패널 | `취소` 버튼 신설(기존 일시중지·재개 옆) | `cancelRoutine(id)` |
| 상세 패널 (**합의 4차 신설**) | **`확정` 버튼 신설** — `status === 'draft'` **그리고** `activation_blocker`가 비어 있을 때만 활성, 아니면 disabled + **Step 6-B 3분기 매핑 표의 제품 문구**를 표기한다(합의 6차 — `activation_blocker`는 **신호로만** 쓴다: non-null = 비활성. 값은 **`routines.py:131`**이 이미 준다 — 4차의 `:136`은 정정). 매핑: 레거시 소스 → **`이 작업은 취소 후 새로 만들기`**(6c·①-7이 같은 루틴에 이미 배정한 문구 — 5차는 여기에 두 문구를 배정해 P3를 어겼다) / WS 미가용 → **`실시간 감시 불가 — 키움 연결 없음`** / 실행 경로 없음 → **`백엔드 실행 경로 없음`** / 미지 blocker → 원문 폴백 + 노트. ⚠ **원문(`<blocker>`)을 그대로 그리지 않는다(합의 6차 — ①-10 P5).** `can_activate()` 반환값 셋은 전부 `~없다` 종결 완결 설명문이고 둘은 영문 내부어 `source`를 포함하는데(`runtime.py:78·81·85`) 정규식이 `~없다`를 못 잡아 **게이트가 전건 통과하면서 화면이 규율을 어긴다.** 접두어 `지금은 켤 수 없음: `도 여전히 붙이지 않는다(5차 정정 유지). 규칙 ③ `확정 — 채팅 칩으로도, 버튼으로도`가 약속한 버튼이다(Step 3-3). ⚠ **파일 머리말 계약을 함께 갱신한다** — `agent-canvas.js:22-27`의 *"상세 패널은 draft 항목에서 읽기 전용이다(액션 버튼 없음)"* 주석이 이번 결정으로 무효가 되므로 그 문단을 새 계약("확정도 두 입구 — 채팅 칩과 상세 패널 버튼이 같은 `athena:routine-confirm`으로 수렴한다")으로 고친다. 계약을 말없이 어기지 않는다(P4) | `confirmRoutine(id)` |
| 드릴인 이력 | `지금 실행` 버튼 신설. **`routine.missed === true`일 때만 활성**, 아니면 disabled + `놓친 예약 없음` 표기(P3 — **`routines.py:140-141`**이 `"missed": spec.status == "active" and _is_missed(...)`로 이미 준다) | `fireNow(id)` |
| **상세 패널 — 설정 편집 폼**(합의 5차: 위치 이동, 결정 f-2) · 드릴인 `:1017-1051` 설정 패널은 **읽기 전용 요약 + `설정 편집` 버튼**(합의 6차: `closeHistory()` → 항목 선택 → 상세 패널 설정 폼 첫 입력 포커스. `↓` 라벨과 「스크롤」 동작은 폐기 — `openHistory`가 `body.hidden = true`(`:1076`)로 상세 패널을 숨기므로 스크롤할 대상이 화면에 없다, §1.8 부록)만 남는다 | ⚠ **4차는 이 폼을 드릴인 `설정` 탭에 두었고, 그러면 예약·초안 루틴에서 도달 불가다** — 드릴인 진입 버튼이 `kind==='watch'`에서만 그려지고(바깥 `:1525` + 안쪽 `:1533`, 파일 머리말 `:59-62`가 계약으로 명시) 설정 탭은 드릴인 전용이다(`:298-299`). `renderDetail`은 **세 kind 전부에서** 그려지므로 폼을 그리로 옮긴다 — `확정` 버튼이 들어가는 같은 패널이라 콜백 주입 경로가 같다(U-6 확인 항목). `설정 — 보기 전용`(`:1021`) → `설정`. `이 화면에서는 값을 바꾸지 않습니다`(**`:1039`**) 줄 **삭제**. 필드 나열 → **소스별로 분기하는 입력 폼**(Step 3의 06 보드 표와 1:1) + `저장`. **입력 개수를 고정하지 않는다** — 편집 가능 필드 집합 == `6c 화이트리스트 8필드`(조건 비교·조건 값·연속 틱·쿨다운·만료(일)·설명·브리핑 모델·브리핑 노력) `∩` `source_spec(condition.source)`에서 유효한 필드. 비교 선택지는 `spec.ops`, 값 컨트롤은 `spec.value_type`, `연속 틱`은 `spec.transport === 'ws'`일 때만 그린다(**`models.py:42-51` · `:107-111` · `rules.py:100-101`** — 4차 좌표 정정). ⚠ **분기 근거인 `condition`도 `source_spec`도 목록 행에 없다(결정 d-2 · e-1).** `historySettingsFields`가 읽는 `item.raw`에는 `source_label` 한국어 라벨만 있고 술어도 카탈로그도 없으므로(**`agent-canvas.js:997-1014`**, 심지어 `['조건', r.note]`로 `note`를 조건이라 라벨한다 — `:1000`), **폼을 열 때 `athena:routine-detail`을 1회 호출해 `condition` + `source_spec`으로 프리필한다.** 이 호출이 없으면 빈 폼이거나 라벨 역추론 파서이거나 사본 상수 발명이다(P3 · R20 · R25). **렌더러에 소스·연산자 하드코딩 0**(②-1 ⑥). 읽기 전용 표기의 **지정 라벨**은 `종목`(6자리 종목코드)·`모드`(`자동`/`예약`)·`소스`(`변경 불가`)에 더해 **현 패널이 이미 내는 `다음 실행`(`:1011`)·`생성`(`:1013`)을 유지**하고, `만료(일)` 입력 옆에 보조 표기 `만료 <YYYY-MM-DD>`를 둔다 — 정보를 회귀시키지 않는다(합의 5차 · ①-7 합집합 등호). ⚠ **실제로 그리는 집합은 `지정 라벨 ∩ 그 루틴에 값이 있는 필드`다(합의 6차).** `historySettingsFields`가 라벨을 조건부로 내고(`if (r.next_fire_at)` `:1011`) `_next_fire_at`(`routines.py:19-21`)이 `mode != "scheduled"`면 `None`이므로 **감시 루틴에 `다음 실행`을 억지로 그리면 값이 없는 표기를 지어내는 것**(P3)이고, 반대로 6종을 고정 집합으로 단언하면 **watch fixture에서 게이트가 올바른 구현을 반려한다.** 편집 가능 필드는 값이 없어도 빈 입력으로 그리므로 이 존재 조건이 없다 — 비대칭이 의도된 것이다. **레거시 소스 루틴**(`source_spec` 폴백으로만 잡히는 것)은 폼을 그리지 않고 읽기 전용 + `이 작업은 취소 후 새로 만들기`(Step 6-A c). **`종목·소스는 취소 후 새로 만들기` 안내 1줄을 소스 행 아래 추가**(사용자 확정 4 — 06 보드와 같은 문자열). `만료(일)`은 남은 일수 프리필 + **건드리지 않으면 patch에서 제외**(Step 3-2 프리필 규칙 · R22). `채팅에서 고치기 ↗`(`:1044`) 유지 | `saveRoutineSettings(id, patch)` · `fetchCondition(id)` |
| 가드 패널 | 읽기 전용 → **입력 정확히 5개** + `저장`. 5개 = `하루 최대`(숫자) · `조용 시간 시작` · `조용 시간 끝`(**2입력** — `guard_settings.py:41-42`의 `QuietHours.start`/`.end`가 별도 문자열 필드다) · `근거 표시`(토글) · `거절 학습`(토글). ⚠ **합의 3차 정정 — 2차의 "입력 4개"는 AC ①-5·Step 2 04보드의 "정확히 5개"와 충돌했다**(2차 §8 변경 14번이 ①-5만 고치고 이 행을 빠뜨렸다). 4개짜리 폼은 조용 시간을 범위 컨트롤로 만들어 왕복 계약이 어긋난다. **미노출 `max_daily_briefings`는 읽어온 값을 그대로 다시 실어 보낸다**(①-5) | `saveNudgeGuard(settings)` |
| 제안 카드 | `추가` 칩 → `루틴으로`(초안 생성 → 확정 카드) · `보류`(로컬 숨김 + `보류함 N건` 표기) | `adoptSuggestion(entry)` · `holdSuggestion(entry)` |
| 반환 객체 `:1702` | `setSearch` · `openDrillIn`(= `openHistory` 공개) 추가 — chat.js의 D 명령이 부른다 | — |

**`ackAllAlerts`의 대상 집합 — 필터를 명문화한다(타 모드 불간섭, 스펙 Constraints:54).**

`app/lib/sidebar.js`의 `markAllRead:`(`window.AthenaNotify` 리터럴 내부, origin **`≈:1109`** — 2차의 `:786-791`은 로컬 HEAD 좌표였다, Step 0e)는 `for (const r of notifyRooms) { if (!r.read) { r.read = true; … } }` — **notifyRooms 전체를 조건 없이** 순회한다. 확장할 때 같은 무조건 순회를 IPC로 옮기면 존재하지 않는 `routine_id`로 POST가 나가 404가 쌓일 수 있다. 따라서 대상 집합을 **두 조건의 교집합**으로 못 박는다:

1. `window.AthenaNotify.list()`가 돌려준 방 중 `read === false`인 것 — 캔버스는 `notifyRooms`를 직접 뒤지지 않는다(단일 소유자 원칙, `sidebar.js` 머리말).
2. 그 `id`가 **현재 `routines[]`에 존재**하는 것 — `agentCanvas`가 이미 보유한 루틴 목록으로 걸러낸다.

> 근거상 (1)만으로도 충분할 가능성이 높다: `notifyRooms`는 `function handleRoutineEvent`(origin **`≈:807`**, `type === 'routine-fired'`만 수용)와 `async function hydrateNotifyRooms`(origin **`≈:863`**)로만 채워지므로 모든 방이 루틴 파생이다. 그러나 **"현재는 그렇다"에 의존하지 않는다** — (2)를 필터로 넣고 (아래) 단언으로 고정하면, 나중에 비-루틴 방이 섞여도 ack가 새지 않는다.

**7b. `app/canvas.js`의 `createAgentCanvas({...})` 배선**(호출 블록 `≈:2952`, 줄 번호는 Step 0e 노트). 위 신규 콜백을 인자에 추가하고, 각각 기존 스타일대로 `window.athena.invoke(...)` 한 줄 + 실패 시 `throw`.

| 콜백 | 경로 | 근거 |
|---|---|---|
| `onSubmitNewTask(draft)` | **`athena:routine-draft`** → `POST /api/v1/routines/draft` → 응답 초안으로 확정 카드 대기 | 결정 **a″-1**. 초안의 `seedChatInput` 안은 GUI 경로를 비결정적으로 만들어 기각했다(a″-2) |
| `adoptSuggestion(entry)` | 제안 entry를 draft 스펙으로 매핑 → **`athena:routine-draft`** | 결정 a″-1. 같은 형태로 통일 |
| `holdSuggestion(entry)` | 렌더러 로컬 숨김 + `보류함 N건` | **유일한 비-IPC 동작.** 백엔드에 기록 엔드포인트가 없다(open-questions #4) |
| **`confirmRoutine(id)`** | **`athena:routine-confirm`** | **합의 4차 신설.** 핸들러·허용 채널·백엔드 전부 이미 존재하고 **캔버스 호출자만 없었다**(`cancelRoutine`과 같은 상황). 규칙 ③이 약속한 GUI 버튼이 이 콜백이다 |
| **`fetchCondition(id)`** | **`athena:routine-detail`** | 결정 **d-2** · 6c-2·6c-3. **상세 패널 설정 폼을 열 때 1회**(결정 f-2로 드릴인 탭에서 위치가 바뀌었다). `fetchRuns`·`fetchAvgDuration`·`fetchEngagement`(origin 실측 **`≈:3022·3029·3035`**)와 같은 얇은 어댑터 형태 |
| **`fetchSourceCatalog()`**(합의 5차 신설) | **`athena:routine-source-catalog`** | 결정 **e-1** · 6c-2·6c-3. **05 `＋ 새 작업` 시트를 열 때 1회** — 시트에는 routine_id가 없어 상세 라우트를 쓸 수 없다. 이 응답이 시트의 `소스`·`비교`·`값` 컨트롤의 유일한 출처다(렌더러 사본 0) |
| `cancelRoutine(id)` | `athena:routine-cancel` | 핸들러·허용 채널 이미 존재, 호출자만 없었다 |
| `ackAlert(id)` / `ackAllAlerts(ids)` | `athena:routine-ack` | 위 필터 적용 |
| `fireNow(id)` | `athena:routine-missed-confirm` | 기존 핸들러 재사용(P4) |
| `saveRoutineSettings(id, patch)` | `athena:routine-update` | Step 6-A c |
| `saveNudgeGuard(settings)` | `athena:nudge-guard-set` | 기존 채널. **payload는 전체 교체다** — `POST /api/v1/nudge-guard`가 `validate_guard_settings(body)` 결과로 통째로 갈아끼우므로(`nudge_guard.py:24-28`), 먼저 `athena:nudge-guard-get`으로 현재 값을 읽어 **폼에 없는 `max_daily_briefings`를 그대로 포함**시켜 보낸다. 빠뜨리면 `guard_settings.py:110`이 10으로 되돌린다(①-5·②-1) |

시트 하단의 `채팅에서 쓰기` 버튼은 **유지**하고 그것만 `seedChatInput`을 쓴다 — 대화 경로로 건너가는 명시적 선택지이지 우회로가 아니다.

**7c. `app/lib/agent-proposal.js` 신설 (+ `.test.js`).** DOM 없는 순수 로직만 — `guard-confirm.js`와 같은 자리·같은 UMD 각주(`guard-confirm.js:72-78`).
- `proposalCardModel(payload)` → `{tags:[동작,상태], body, rationale, chips:[{label, kind}]}`. 문구는 Step 4의 07 보드 표를 원본으로 한다.
- `resultCardModel(outcome)` → 08 보드 4상태.
- `viewCommand(payload.view)` → `{method:'setActiveView'|'setActiveTab'|'setSearch'|'openDrillIn', arg}`.
- `chipToIpc(control)` → IPC 채널 이름 맵. **`_CONTROL_ACTIONS` 12종 전부에 항목이 있어야 한다**(누락도 결함이다 — Step 8a-2의 완전성 단언이 잡는다):

  | control | 채널 | control | 채널 |
  |---|---|---|---|
  | `confirm` | `athena:routine-confirm` | `ack` | `athena:routine-ack` |
  | **`update`** | **`athena:routine-update`** | `ack_all` | `athena:routine-ack`(루프) |
  | `pause` | `athena:routine-pause` | `adopt` | `athena:routine-draft` |
  | `resume` | `athena:routine-resume` | `guard` | `athena:nudge-guard-set` |
  | `cancel` | `athena:routine-cancel` | `fire` | `athena:routine-missed-confirm` |
  | `view` | **`null`**(IPC 없음) | `hold` | **`null`**(IPC 없음) |

  IPC 매핑 **10종** + 명시적 `null` **2종** = 12종. 이 맵이 Step 8a-2 **결합 단언의 좌변**이다.
- **`isDerivedAlertRoom(roomId)` → boolean (합의 6차 — 이 파일이 소유한다).** 5차까지 `app/lib/main/agent-session.js`의 계약으로 적혀 있었으나, 렌더러는 `shell.html`의 `<script src="lib/*.js">`로만 모듈을 얻고 그 목록에 `lib/main/*`이 **0건**이라 **유일한 호출자가 import할 수 없었다**(§1.4). 여기로 옮기면 `agent-session.js`가 `require('../agent-proposal')`로 가져다 쓸 수 있고(선례 `app/main.js:29`), 판정 사본이 **0**이다.
- `shouldRenderProposal({ activeMode, roomId })` → boolean. **타 모드 불간섭(스펙 Constraints:54)을 코드로 강제하는 자리다**(§1.4 프로덕션 연결 지점): `activeMode !== 'agent'`면 `false`, **같은 파일의** `isDerivedAlertRoom(roomId)`면 `false`(대신 `관제 창으로 →` 합류 버튼), 관제 대화면 `true`.

**7d. `app/chat.js` 에이전트 모드.** (줄 번호는 Step 0e 노트.)
- `window.athena.on('athena:routine-proposed', onRoutineProposed)` 구독을 `const onNudgeGuardProposed`(`≈:1223`) 옆에 추가.
- ⚠ **`onRoutineProposed`는 카드를 그리기 전에 모드를 확인한다(합의 3차 신설 — 타 모드 불간섭).** 선례 포워더 3개는 모드를 보지 않고 `shellWin`에 무조건 send하므로(origin `main.js:2300-2314`), 동형인 4번째를 얹고 구독을 무조건 추가하면 **사용자가 백테스트·그래프 대화에 있을 때도 에이전트 제어 제안 카드가 그 방에 뜬다**(스펙 Constraints:54 위반). 게이트 비용은 한 줄이다 — 렌더러에 이미 `window.AthenaCanvasMode.state.view`가 있다(origin `chat.js:1315`).
  ```js
  const onRoutineProposed = (payload) => {
    const activeMode = (window.AthenaCanvasMode && window.AthenaCanvasMode.state && window.AthenaCanvasMode.state.view) || 'summary';
    if (!agentProposalLib.shouldRenderProposal({ activeMode, roomId: currentRoomId })) return;
    renderControlProposalCard(payload);
  };
  ```
  `shouldRenderProposal`은 `agent-proposal.js`(순수 모듈)가 소유하고 `isDerivedAlertRoom`을 부른다 — 01번 알림 파생 방(예외 창)에서는 제어 제안 카드 대신 **`관제 창으로 →` 합류 버튼만** 남긴다(Step 2의 01 보드 정정과 짝).
- `renderControlProposalCard(payload)` — `function renderGuardConfirmCard`(`≈:3064`)와 동형. 칩 클릭 → `agentProposalLib.chipToIpc(control)` → `window.athena.invoke(...)` → 성공 시 `renderControlResultCard` + `window.AthenaAgentCanvas.refresh()`.
- **확정 칩에 `autofocus`를 준다**(§1.3 융합안) — 사용자가 Enter로 확정할 수 있다.
- `control === 'view'`(D)면 칩을 그리지 않고 **즉시** `window.AthenaAgentCanvas[method](arg)` 실행 후 결과 턴(`이동함`)만 그린다.
- `control === 'hold'`면 IPC 없이 결과 턴(**`보류 — 목록 유지`**)만.
- 기존 확정 칩(**`function renderApprovalCard(`**, `≈:2960` — 그 안의 `invoke('athena:routine-confirm')`가 **`≈:3025`**, 합의 5차에 §1.3·8a-2와 값을 통일했다. 4차 본문의 `≈:3022`는 정정)은 **무변경** — A의 "확정" **대화 경로**는 이미 존재하는 그 카드다. **앵커는 감싸는 함수 이름으로 찾는다**(`routine-approval-actions`는 origin에 7곳이라 줄 번호로 못 짚는다). A-확정의 **GUI 경로**는 이 파일이 아니라 Step 7a의 상세 패널 `확정` 버튼이 소유한다(합의 4차).

- **검증:** `cd app && npm test` 0 failed.
- **충족 AC:** ②-1 ②-2 ②-3

### Step 8 — 테스트·프로브·파리티 문서

**8a. `app/lib/agent-canvas.test.js` 이중 경로 매트릭스.** A~E 각 동작에 GUI 1건 + 대화 1건. 대화 경로 단언은 `agent-proposal.test.js`의 `chipToIpc` 매핑이 짝을 이룬다.

| 묶음 | 동작 | GUI 단언(agent-canvas.test.js) | 대화 단언(agent-proposal.test.js) |
|---|---|---|---|
| A | 생성 | 시트 제출이 `onSubmitNewTask` 1회 | `chipToIpc('adopt') === 'athena:routine-draft'` |
| A | 설정 편집 | 폼 저장이 `saveRoutineSettings(id, patch)` 1회 | **`chipToIpc('update') === 'athena:routine-update'`** ⚠ 2차의 `chipToIpc('confirm')`은 **거짓이었다** — `POST /{id}/confirm`(origin `routines.py:211-229`)은 `can_activate` 검사 + `ensure_realtime_subscription` + `store.transition(id,'active')`이지 패치 적용이 아니다. 그대로 두면 07 A열 칩 `이렇게 바꿔줘`가 상태만 `active`로 바꾸고 쿨다운은 그대로 남는다(P3) |
| A | 확정 | **상세 패널 `확정` 버튼이 `confirmRoutine` 1회** + `status!=='draft'`이거나 `activation_blocker`가 있으면 **disabled**(합의 4차 — 3차의 `— (채팅 카드 소유)`는 규칙 ③이 약속한 버튼을 만들지 않아 P3를 어겼다) | `chipToIpc('confirm') === 'athena:routine-confirm'`(기존 채팅 확정 카드는 무변경, R5) |
| A | 일시중지·재개 | 버튼이 `pauseRoutine`/`resumeRoutine` 1회 | `chipToIpc('pause'/'resume')` |
| A | 취소 | 버튼이 `cancelRoutine` 1회 | `chipToIpc('cancel')` |
| B | 개별 읽음 | 행 버튼이 `ackAlert` 1회 | `chipToIpc('ack')` |
| B | 모두 읽음 | 버튼이 `markAllAlertsRead` + `ackAllAlerts` 각 1회 | `chipToIpc('ack_all')` |
| B | 이어가기 | `onOpenInChat` 1회 | `viewCommand` |
| C | 채택 | `adoptSuggestion` 1회 | `chipToIpc('adopt')` |
| C | 보류 | `holdSuggestion` 1회 + 카드 숨김 | `chipToIpc('hold') === null` |
| C | 가드 조정 | 폼 저장이 `saveNudgeGuard` 1회 | `chipToIpc('guard')` |
| D | 탭·필터·검색·드릴인 | 각 조작이 뷰 상태를 바꾼다 | `viewCommand` 4종 |
| D | **그래프에서 근거 보기**(합의 4차 편입) | 제안 뷰의 `그래프 모드에서 근거 보기 →` 링크가 `AthenaCanvasMode.setView('graph')` 1회 — 서버 호출 0(**`app/canvas.js`의 `onOpenGraph:` `≈:3051`**, 4차의 `:3067-3074`는 틀린 좌표였다 — 머리말 철회 4 · 스펙 Constraints:54 "링크 이동만") | `viewCommand`(즉시, 칩 없음) |
| D | **캔버스에서 열기**(합의 5차 편입) | 채팅 카드의 `캔버스에서 열기` 조작이 `AthenaCanvasMode.setView('agent')` 1회 — 서버 호출 0 | `viewCommand`(즉시, 칩 없음). 스펙 D 인벤토리의 `캔버스에서 열기·채팅으로`는 **두 방향**인데 4차 매트릭스는 `채팅에서 열기 ↗` 한 방향만 덮었다 |
| A | **설정 편집 진입로 — 부류 단언**(합의 5차 신설, 결정 f) | 루틴 kind **3종(`watch`·`schedule`·`draft`) 각각**에서 설정 편집 폼에 도달할 수 있다(f-2 채택 후에는 세 kind 모두 상세 패널에 폼이 그려진다) | — (GUI 전용 도달성이므로 대화 짝이 없다) |
| E | 지금 실행 | `missed===true`만 활성, 클릭이 `fireNow` 1회 | `chipToIpc('fire')` |
| E | 결과 열기 | run 행 클릭이 브리핑 본문을 연다 | `viewCommand('openDrillIn')` |

**8a-2. 결합 단언 — 파리티는 구조가 아니라 이 테스트가 지킨다.**

두 렌더러 호출자는 공통 함수를 공유하지 않는다(`app/chat.js ≈:3025` vs `app/canvas.js ≈:2975·:2980`이 각자 `window.athena.invoke`를 부른다). 만나는 곳은 `preload.js`의 허용목록과 `main.js`의 단일 핸들러뿐이다. 따라서 **채널명 일치를 문자열로 고정하는 테이블 구동 단언**을 신설한다:

**단언은 두 개다 — 서로 다른 결함을 잡는다.** 하나만으로는 부족하다는 것이 합의 3차에 드러났다.

```
// ① 발산 단언 (agent-proposal.test.js) — 두 경로의 채널명이 갈라지는 것을 잡는다
//    DUAL_PATH_TABLE의 canvasChannel은 canvas.js 콜백이 실제로 부르는 채널명을
//    그대로 적은 별도 상수다. 조회가 아니라 두 벌을 대조하는 것이 핵심이다.
for (const { control, canvasChannel } of DUAL_PATH_TABLE) {
  assert.equal(agentProposalLib.chipToIpc(control), canvasChannel);
}

// ② 완전성 단언 (agent-proposal.test.js) — 매핑 누락·유령 이름을 잡는다
//    _CONTROL_ACTIONS 12종 전부가 IPC 채널 또는 명시적 null로 덮여야 한다.
for (const control of CONTROL_ACTIONS) {              // 12종, 백엔드 enum과 같은 목록
  assert.ok(control in CHIP_TO_IPC, `미매핑 control: ${control}`);
}
assert.deepEqual(Object.keys(CHIP_TO_IPC).sort(), [...CONTROL_ACTIONS].sort());
```
- **① 발산 단언:** `agent-canvas.test.js`가 같은 `DUAL_PATH_TABLE`을 import해 GUI 콜백 스파이의 호출 인자와 대조한다 — 어느 한쪽이 채널명을 바꾸면 **두 파일 중 하나가 반드시 깨진다.** `canvas.js`가 `athena:routine-pasue`라는 오타를 내면 여기서 잡힌다.
- **② 완전성 단언:** 이번 개정이 발견한 두 결함이 **테스트가 쓰이기도 전에** 드러나게 한다 — 2차의 `DUAL_PATH_TABLE`은 `_CONTROL_ACTIONS`에 **없는 이름 `draft`**를 대상으로 삼았고(실제 매핑 대상은 `adopt`), A-설정편집에 대응하는 `update`가 **enum에 아예 없었다.** 키 집합 동일성 단언이 있으면 유령 키와 누락 키가 즉시 실패한다.
- **왜 ①을 ②로 대체하지 않는가(합의 3차 판단).** "`chipToIpc` 맵을 단일 frozen 상수로 두고 `canvas.js`가 그 맵을 조회하게 하면 파리티가 구조로 회복된다"는 안이 검토에서 제안됐다. 채택하지 않는다 — 두 렌더러가 **같은 상수를 조회하면 ①은 항상 참인 무의미한 단언**이 되고, ②는 누락만 잡을 뿐 오타로 인한 **발산은 못 잡는다.** 게다가 `agent-proposal.js`는 §7 ADR이 "DOM·IPC 없는 순수 모듈"로 규정한 **대화 경로 소유 모듈**인데 GUI 배선이 그것을 런타임 참조하면 `shell.html` 로드 순서 의존이 생겨 모듈 경계 논거가 흔들린다. **두 단언을 함께 둔다.**
- 대상: IPC 매핑 **10 control**(`confirm`·**`update`**·`pause`·`resume`·`cancel`·`ack`·`ack_all`·`adopt`·`guard`·`fire`) + 명시적 `null` **2**(`view`·`hold`) = **12종**. 2차가 적은 "A(confirm·pause·resume·cancel·**draft**) … 10 control"의 `draft`는 **존재하지 않는 control 이름**이었다(`draft`는 최상위 `action` 값이지 `propose.control` 값이 아니다).
- ⚠ **합의 4차 — `confirm` 행이 이제 실제로 두 벌이 된다.** 3차까지 `confirm`은 GUI 호출자가 없어 `DUAL_PATH_TABLE`의 `canvasChannel`이 비어 있었고, 그래서 **발산 단언이 A 묶음의 확정을 덮지 못했다.** Step 7a의 `confirmRoutine(id)` 신설로 두 벌 대조가 성립하므로 `confirm` 행을 표에 채운다 — 결합 단언의 커버리지가 11 control(IPC 매핑 10 중 `ack_all`의 루프 형태 1건 포함)로 올라간다.

**8a-3. 비-에이전트 방 ack 미발생 단언(타 모드 불간섭).**
`ackAllAlerts` 테스트에 **비-루틴 방 1건을 섞은 fixture**를 넣는다: `AthenaNotify.list()`가 `[{id:'r-1',read:false},{id:'not-a-routine',read:false}]`를 돌려주고 `routines[]`에는 `r-1`만 있는 상태. 단언 — `athena:routine-ack`가 **정확히 1회**, **`{id:'r-1'}`로만** 호출된다. `not-a-routine`에 대한 호출은 **0회**여야 한다(R8 완화의 경계).

**8a-4. 타 모드 불간섭 단언(스펙 Constraints:54) — 합의 3차 신설.**
`agent-proposal.test.js`에 `shouldRenderProposal`의 3분기를 단언한다: ① `activeMode: 'backtest'`(또는 `'graph'`·`'summary'`·`'plugin'`) → **`false`** ② `activeMode:'agent'` + `isDerivedAlertRoom(roomId) === true` → **`false`**(대신 합류 버튼) ③ `activeMode:'agent'` + 관제 대화 → **`true`**. ⚠ **`isDerivedAlertRoom` 자체의 단언도 이 파일이 소유한다**(합의 6차 — 함수가 `agent-proposal.js`로 확정됐다, §1.4·6f·7c). 이 단언이 없으면 Step 7d의 무조건 구독 + Step 6-A d의 무조건 `shellWin.send`(선례 3개와 동형)가 **백테스트·그래프 대화에도 제어 제안 카드를 띄운다.** D1("루틴·알람·제안·실행이 전부 그 한 방으로 흐른다")을 강제하는 유일한 코드다.

**8a-5. 부류 단언 2건 — 잎사귀 단언을 늘리는 대신 계열을 막는다(합의 5차 신설, Architect 융합 경로).**

3차(종목 표시) → 4차(확정 버튼) → 5차(드릴인 도달성·`note` 신선도·라벨 등호)로 **같은 계열의 결함이 라운드마다 사람 검토로만** 발견됐다. 원인은 검증 자산이 계속 **잎사귀**(버튼 1개·라벨 1개·채널 1개)에만 붙은 것이다. 두 개의 **부류 단언**을 신설한다:

1. **도달성 단언**(`agent-canvas.test.js`) — 루틴 kind **3종 전부**(`watch`·`schedule`·`draft`)에 대해 **설정 편집 진입로가 존재한다.** 없으면 그 부재가 **화면 문구로 표기돼 있어야** 한다(정직한 축소는 허용, 조용한 축소는 불허). 비용은 테스트 1건 + 프로브 check 1~2건이고, 이번 결손(§1.8)과 다음 번 같은 계열을 함께 잡는다.
2. **필드 인벤토리 합집합 등호**(`agent-canvas.test.js` + 8c 프로브) — **주어는 「상세 패널의 설정 폼」**이고(드릴인 요약이 아니다 — f-2가 표면을 둘로 쪼갰다), 판정은 **루틴별로** 한다: `그 루틴의 설정 폼이 낸 모든 라벨 == (편집 가능 필드 라벨) ∪ (읽기 전용 표기 라벨)`, 두 집합은 **서로소**. **양변을 런타임에서 유도한다(합의 6차 — 5차는 읽기 전용 변만 상수로 남겨 두었다):** 편집 가능 변 = `6c 화이트리스트 8필드 ∩ source_spec 유효 필드`, 읽기 전용 변 = **`지정 라벨 6종 ∩ 그 루틴에 실제로 존재하는 필드`**. 그래야 정보가 늘어도 줄어도 단언이 자동으로 따라오고, `다음 실행`이 없는 watch 루틴에서 **게이트가 올바른 구현을 반려하지 않는다**(`agent-canvas.js:1011`의 `if (r.next_fire_at)` + `routines.py:19-21`의 `mode != "scheduled" → None`). 어느 쪽이 늘거나 줄어도 반드시 한쪽이 깨지므로 8a-2의 발산 단언과 **같은 성질**을 필드 층에 이식한 것이고, 변량은 V16의 kind 3종 fixture가 공급한다. 개수 상수를 다시 박지 않는다(①-7).

> **왜 이 둘만으로는 부족한가(명시).** 두 부류 단언은 §1.7의 카탈로그 결손을 **통과시킨다** — 도달성 단언은 진입로만 보고, 합집합 등호는 폼이 낸 라벨만 본다. 카탈로그가 백엔드와 갈라져 `price.current`에 `==`를 제시해도 둘 다 초록이다. 그래서 결정 **e-1**이 사본 자체를 없애고, ②-1 ⑥과 8c 신규 단언이 **응답에서 왔는지**를 따로 본다.

**8b. 교체할 기존 단언** — 그대로 두면 반드시 깨진다:
- `agent-canvas.test.js:1339-1350` "동선 규칙 Paper 원문 3줄" → 이중 제어 규칙 3줄 + 캡션 `이중 제어 규칙`.
- `agent-canvas.test.js:1644` "값을 바꾸는 입력이 없고 고치는 경로는 채팅 버튼 하나다" → "폼 입력이 있고 저장이 `saveRoutineSettings`를 부른다 + `채팅에서 고치기 ↗`가 병존한다".
- `agent-canvas.test.js:554` "CTA 클릭은 시트를 열지 않는다" → "CTA 클릭이 시트를 연다".

**8c. `app/probe-agent-paper-parity.js` 갱신** (현 34 단언):
- `:148-162` 동선 규칙 3줄 원문 → 이중 제어 규칙 3줄 + 캡션. `data-source` 부재 단언(`:157`)은 **유지**(화면 자신의 계약이라는 성격은 안 바뀐다).
- `:264-274` 보기 전용 5단언 → 편집 폼 단언(`저장` 존재 · `채팅에서 고치기 ↗` 병존 · 저장이 IPC를 부른다 · **편집 가능 필드 집합이 `6c 화이트리스트 ∩ 소스별 유효 필드`와 같다**). ⚠ **2차의 `inputCount >= 4`는 폐기한다** — AC ①-7보다 느슨해 5개짜리 폼도 통과했고, 최종 게이트가 AC보다 헐거우면 **AC가 실질적으로 강제되지 않는다**(교체 대상인 origin `probe-agent-paper-parity.js:269`조차 `inputCount === 0`으로 **등호**를 썼다). 집합 동일성으로 AC와 같은 강도로 맞춘다.
- **라벨 화이트리스트 단언(실측 `:266-268` — 4차의 `:265-268`은 한 줄 밀렸다)을 함께 갱신한다(결정 d-2·①-7).** 현행은 `labels.every((l) => ['조건','모드','소스','종목','쿨다운','브리핑 모델','다음 실행','만료','생성'].includes(l))` **부분집합** 검사이고, 그 목록의 `'조건'`은 실제로 `note`를 가리킨다. ⚠ **합의 5차 정정 — 4차의 "읽기 전용 == `{'종목','모드','소스'}` 등호(정확히 3건)"는 올바른 구현을 반려한다.** 현 패널은 `다음 실행`(`agent-canvas.js:1011`)·`생성`(`:1013`)도 내고, 이 계획 자신이 `만료 <날짜>` 보조 표기를 요구한다. **새 단언은 합집합 등호 한 조각이다:** **상세 패널 설정 폼**을 주어로, **루틴별로** `그 루틴의 설정 폼이 낸 모든 라벨 집합` == `(편집 가능 입력의 라벨 집합)` ∪ `(읽기 전용 표기의 라벨 집합)`, 두 집합은 **서로소**이며 **개수 상수를 박지 않는다.** 편집 가능 쪽은 `6c 화이트리스트 8필드 ∩ 소스별 유효 필드`의 한국어 라벨과 등호, **읽기 전용 쪽은 `지정 라벨 6종 ∩ 그 루틴에 실제로 존재하는 필드`와 등호다(합의 6차 — 5차는 이 변을 6종 상수로 두어 `다음 실행`이 없는 watch fixture에서 반드시 실패했다: `if (r.next_fire_at)` `agent-canvas.js:1011` + `_next_fire_at`이 `mode != "scheduled"`면 `None` `routines.py:19-21`).** `'조건'`이라는 라벨은 술어 3필드(`조건 비교`·`조건 값`·`연속 틱`)로 대체되므로 편집 가능 집합에서 그 이름은 사라진다. (`inputCount === 0`은 실측 **`:269`**이며 이 단언 자체가 "폼 입력이 있다"로 교체된다.)
- **신규 단언(결정 d-2):** **상세 패널 설정 폼**을 열면 `athena:routine-detail`이 **정확히 1회** 호출되고, 폼의 `조건 비교` 선택지가 그 응답의 **`source_spec.ops`와 문자열 배열로 같다**. 목록 행만으로 그려지지 않는다는 것을 프로브가 직접 잡는다.
- **신규 단언(결정 e-1 · 합의 5차):** ① 05 `＋ 새 작업` 시트를 열면 `athena:routine-source-catalog`가 **정확히 1회** 호출되고 `소스` 선택지가 그 응답의 키 집합과 **같다** ② `app/lib/agent-canvas.js` 원문에 소스 이름(`price.current` 등)이나 연산자 리터럴 배열이 **0건**이다(사본 금지 — grep 단언).
- **신규 단언(결정 f-2 · 합의 5차):** ① **드릴인 `설정` 탭의 `설정 편집` 버튼을 누르면 실제로 편집 폼이 화면에 뜬다** — `body.hidden === false`(드릴인이 닫혔다) **그리고** 상세 패널 설정 폼의 입력이 **≥1**이고 포커스가 그 첫 입력에 있다. ⚠ **합의 6차 정정 — 5차의 단언(*"읽기 전용 요약 + `설정 편집 ↓`만 낸다(입력 0)"*)은 죽은 링크를 전건 통과시킨다:** 요약과 버튼의 **존재**만 보므로 그 버튼이 아무 데도 데려가지 않아도 초록이다(R29 계열). 도달성 부류 단언(②-1 ⑤)도 진입로를 상세 패널 쪽에서 보므로 이것을 관측하지 못한다 ② 루틴 kind **3종 각각**(`watch`·`schedule`·`draft`)에서 상세 패널에 편집 폼이 그려진다 — 4차 프로브는 watch fixture만 돌아 **예약·초안 도달 불가를 통과시켰다**(8a-5 도달성 단언의 프로브 짝).
- `:288-294` 가드 패널 → 편집 폼 + 저장 단언.
- **신규 단언 추가**(≥14, 합의 5차에 4건 증가): CTA가 시트를 연다 · 시트 필드 6종 · 상세 `취소` 버튼 · **상세 `확정` 버튼과 그 활성 조건**(`status==='draft'` && `activation_blocker` 없음) · **비활성 사유가 Step 6-B 3분기 매핑 표의 제품 문구와 문자열로 일치하고 접두어가 없다**(합의 6차 정정 — 5차의 *"`<blocker>` 원문 그대로"*는 P5 위반을 단언으로 고정하던 자리다. fixture는 `can_activate` 세 분기 각각의 `activation_blocker`를 넣고, 화면 문자열이 원문이 **아니라** 매핑 문구인지를 본다) · `지금 실행` 버튼과 비활성 사유 표기 · 알람 개별 `읽음` · 제안 `루틴으로`/`보류` · 결과 턴 4상태 클래스 · **상세 설정 폼이 `athena:routine-detail`을 1회 부른다** · **시트가 `athena:routine-source-catalog`를 1회 부른다** · **라벨 합집합 등호** · **kind 3종 도달성** · **소스·연산자 하드코딩 0건**.
- 파일 상단 머리말(`:11-17`)의 "재는 것" 목록을 새 계약으로 갱신.
- **주석 `:126`(*"(1)(2)(3) 작업 뷰 + 동선 규칙 + 타임라인"*)도 함께 갱신한다(합의 6차 명시).** 5차까지 이 줄은 명시 편집 목록 밖이었는데 V9는 이 파일 전체에서 `보기 전용\|동선 규칙` **0건**을 요구했다 — 실측 origin에서 `probe-agent-paper-parity.js`는 `:12`·`:15`·`:126`·`:148`·`:150`·`:153`·`:157`·`:264`·`:269` **9곳**이고 계획이 명시한 것은 `:11-17`·`:148-162`·`:264-274`뿐이라 `:126`만 지시 밖에 남았다. **게이트와 지시의 사정거리를 맞춘다**(Step 7a 주석 4곳과 같은 조치).

**8d. `PAPER_APP_PARITY.md` 에이전트 섹션** — ⚠ **좌표가 아니라 이름으로 찾는다(합의 3차).** 2차의 `:355-441`은 **메인 체크아웃 작업본** 좌표이고 origin 파일은 **384줄**뿐이다(머리말 철회 2). Step 0e 노트의 이름 앵커를 쓴다: 섹션 머리(`≈:296`) · 판정표(`≈:309-315`) · 동선 규칙 ② 인용(`≈:359`) · 검증 증거 표(`≈:370-372`).
- 판정표를 8행(01~08) 전부 `적용`으로, 보드 이름을 Step 4의 확정 이름으로(현재 6행 → 8행).
- 동선 규칙 ② 인용(`≈:359`)을 이중 제어 규칙 ②로 교체.
- 결정 로그의 "드릴인 `설정` 탭은 보기 전용"(2026-09-01) 항목 아래에 **번복 기록**을 새 줄로 추가 — 삭제하지 않는다(결정의 역사를 지우지 않는다).
- 검증 증거 표(`≈:370-372`)를 Step 9 이후 실측값으로 교체.

**8e. `app/verify-agent-dual-control-live.js` 신설 — ralph가 무인 실행할 수 있는 실백엔드 하네스.**

기존 프로브는 실백엔드 시연을 **대체하지 못한다** — `app/probe-agent-paper-parity.js` **`:17-18`**(2차의 `:19-20`은 정정 — 이 파일은 "차이 0" 범주라 재측정 대상이 아니어서 그 번호가 그대로 쓰인다)가 `process.env.ATHENA_NO_AUTOSTART = '1'`·`process.env.ATHENA_CANVAS_SOURCE = 'fixture'`를 박아 백엔드를 아예 띄우지 않는다. 그러므로 별도 하네스를 만든다.

- **환경:** `ATHENA_CANVAS_SOURCE`를 fixture로 두지 **않는다.** `ATHENA_ROUTINES_ENABLED=true`·`ATHENA_BRAIN_ENABLED=true`로 기동한 실백엔드(127.0.0.1:8010)에 붙는다.
- **덮는 범위 — GUI 클릭이 필요 없는 부분만:**
  1. **GUI 경로:** `agentCanvas`의 콜백을 코드로 직접 호출해(버튼 DOM 클릭이 아니라 콜백 호출) 실제 IPC → 실제 REST 왕복이 일어나고 서버 상태가 바뀌는 것을 확인. 대상은 **IPC 경유 11동작**(합의 4차에 `confirmRoutine` 합류).
  2. **대화 경로:** LLM 실호출이 아니라 **`athena:routine-proposed` 페이로드를 직접 주입**한다(`shellWin.webContents.send`). 모델의 문장 생성 품질은 이 계획의 검증 대상이 아니고, 검증 대상은 "제안 payload가 오면 카드가 뜨고 칩이 정확한 채널을 부른다"이기 때문이다.
  3. 각 동작 전후 `GET /api/v1/routines`·`/{id}/runs`·`/nudge-guard`를 JSON으로 저장.
- **덮지 못하는 것(명시):** 실제 사람의 버튼 클릭·실제 LLM 문장 해석·시각적 정합. **이 셋은 Step 9의 사람 시연이 소유한다.**
- `package.json`에 스크립트 `verify:agent-dual-control-live` 추가.
- **충족 기준:** **11동작 × {GUI 콜백, 주입 제안} = 22 케이스** 전건 통과 + 서버 상태 diff가 기대 전이와 일치 + 렌더러 콘솔 에러 0.
- **환경 주의(합의 4차):** 이 하네스도 **앱이 띄운 백엔드**에 붙는다 — 수동 `uvicorn`을 앞세우면 `decideAction`이 `'already-running'`을 돌려주어 `buildBackendEnv`의 기본값 5개가 빠진 백엔드에 붙게 된다(③-1 사유와 동일 — `app/lib/main/backend-launcher.js`의 **`function buildBackendEnv`**(`≈:28`)·**`function decideAction`**(`≈:62`), 이름 앵커. 이 파일은 합의 6차에 Step 0e 재해결 표 9번째 행으로 편입됐다).

- **검증:**
```bash
cd <worktree>/app && npm test                      # 0 failed, Step 1 대비 감소 0
cd <worktree>/app && npm run verify:agent-paper-parity   # 전건 통과, 콘솔 에러 0
cd <worktree>/app && npm run verify:agent-dual-control-live  # 22 케이스 전건 통과
cd <worktree>/backend && uv run pytest -q           # 0 failed, Step 1 대비 감소 0
```
- **충족 AC:** ②-10 ②-11 ②-12 ②-13

### Step 9 — 라이브 종단 시연 — 🛑 **사람 정지점 ②(2개 중 둘째)**

> **ralph는 이 Step을 무인 실행할 수 없다.** 9a가 `npm start`로 Electron GUI를 띄우고 9c가 **19행 × 2경로**를 **손으로 클릭**하도록 요구하기 때문이다. ralph는 9a·9b(기동·데이터 준비)까지 수행하고 **멈춰서 사용자에게 시연을 요청한다.** 자동화 가능한 부분은 Step 8e의 `verify:agent-dual-control-live`가 이미 덮었으므로, 이 Step이 추가로 확인하는 것은 **실제 사람 클릭 · 실제 LLM 문장 해석 · 시각적 정합** 셋이다.
>
> **가짜 완료 금지:** 시연하지 않은 행을 통과로 적지 않는다. ralph가 이 Step에 도달하면 무한 재시도하지 말고 정지 보고를 낸다(P3).

**9a. 기동 — 앱 하나로 띄운다(합의 4차 정정).**
```bash
# 8010이 이미 떠 있으면 먼저 내린다 — 외부 백엔드에 붙은 채로 시연하지 않는다.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/api/v1/llm/manifest   # 200이면 그 프로세스를 종료
# 앱이 자기 계약대로 백엔드를 띄운다(ATHENA_NO_AUTOSTART 미설정이 기본 자동 기동, app/main.js:5246)
cd <worktree>/app && npm start
# 헬스 (app/lib/main/backend-launcher.js:11의 HEALTH_URL과 같은 경로)
curl -s http://127.0.0.1:8010/api/v1/llm/manifest | head -c 200
```
⚠ **수동 `uvicorn`을 쓰지 않는 이유(③-1과 같은 근거).** `app/lib/main/backend-launcher.js`의 `buildBackendEnv`(`:28-58`)가 세팅하는 기본값은 **5개**다 — `ATHENA_BRAIN_ENABLED` · `ATHENA_ROUTINES_ENABLED` · `ATHENA_BACKTEST_ENABLED` · `ATHENA_BRAIN_INGEST_SCHEDULE_OWNER=external` · `ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION`. 3차 명령은 앞의 2개만 줬고, **`function decideAction`**(이름 앵커, `≈:62` — 5차까지의 `:60-64`는 주석부터 세는 범위였다)이 healthy면 `'already-running'`을 돌려주므로 **포트 충돌 없이 앱이 결손 백엔드에 조용히 붙는다.** 그 파일 주석이 결과를 실측으로 남겨 뒀다 — 백테스트 모드가 503으로 죽고 *"어느 프로세스가 먼저 8010을 잡느냐에 따라 켜졌다 꺼졌다 한다"*. 하필 이 Step은 **R24·8a-4가 코드로 강제한 타 모드 불간섭을 사람이 눈으로 확인하는 유일한 자리**이고, `ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION` 결손은 brain을 degraded(`extraction_enabled=false`)로 만들어 **C 묶음(제안·프로액티브) 시연 데이터가 빌 수 있다**(9c 9·11행이 그 데이터에 의존한다). 어떤 이유로든 수동 기동이 필요하면 **5개를 전부** 실어야 한다.

**기동 확인 3건(하나라도 어긋나면 시연을 시작하지 않는다):**
1. 헬스 200.
2. 사이드바 **백테스트 모드가 503이 아니다**(타 모드 불간섭을 확인할 대상이 살아 있는가).
3. brain status가 `extraction_enabled=false` degraded가 **아니다**.

키움 실연결 없음 — fixture 시세로 진행(Non-Goals:69).

**9b. 준비 데이터.** 예약 루틴 1건과 감시 루틴 1건을 `POST /api/v1/routines/draft` + `confirm`으로 심는다. **두 루틴의 조건 계약이 다르다는 점을 명시한다(합의 3차 — 2행·15행이 같은 루틴에서 충돌하던 자리):**

| 루틴 | `condition` | 파생 `mode` | 06 설정 폼이 그려야 하는 모양 |
|---|---|---|---|
| 예약(놓친 예약용, 과거 시각) | `{source:'schedule.daily', op:'at', value:'ALL@07:30'}` | `scheduled`(`clock`) | 값 = **시각 표기 입력**, 비교 = **`at` 하나**, `연속 틱` **없음** |
| 감시 | `{source:'price.current', op:'>=', value:88000, consecutive_ticks:1}` | `realtime-ws`(`ws`) | 값 = **숫자**, 비교 = **`<`·`<=`·`>`·`>=` 4종**(`==` 없음), `연속 틱` 있음 |

**두 루틴의 `note`를 어떻게 줄지 못 박는다(합의 5차 신설 — R30의 검출 여부가 여기서 갈린다).** 예약 루틴은 **`note`를 주지 않고** 심는다 → `rules.py:168-169`가 `human_summary()`로 자동 생성하므로 **9c 2행이 `note` 신선도 규칙 1을 실제로 검증**한다. 감시 루틴은 **`note`를 명시적으로 준다**(예: `삼성전자 88,000 감시`) → 조건을 고쳐도 `note`가 불변이어야 하므로 **규칙 2를 검증**한다. 둘을 같게 심으면 R30이 시연에서 드러나지 않는다.

E-지금 실행(catchup-fire)은 `mode='scheduled'`를 요구하므로(`routines.py:290-306`) 15행은 **반드시 예약 루틴**을 쓴다. 그 루틴의 설정 탭을 여는 2행이 숫자 폼을 그리면 문자열이 숫자 입력에 들어가고 `at`이 아닌 비교 선택지가 뜨며 `연속 틱` 기본값을 함께 보내면 **422**다 — Step 3의 소스별 분기가 이 충돌을 닫는다.

**9c. 19행 시연 표** — 각 행마다 `GET /api/v1/routines`(또는 `/runs`, `/nudge-guard`) before/after를 저장. **합의 4차에 2행**(`1b` A-확정 · `17` D-그래프 근거 보기), **합의 5차에 1행**(`8b` D-캔버스에서 열기 — 스펙 D 인벤토리의 `캔버스에서 열기·채팅으로` 두 방향 중 나머지 하나)이 늘었다. 기존 1~17행 번호는 교차 참조 보존을 위해 그대로 둔다:

| # | 묶음·동작 | 대화 경로 | GUI 경로 | 상태 확인 |
|---|---|---|---|---|
| 1 | A 생성 | "삼성전자 88,000원 넘으면 알려줘" → 초안 카드(대화 표면에서 끝) | `＋ 새 작업` 시트 → 제출(→ `athena:routine-draft`) | **양쪽 모두 `routines[]` +1 `status='draft'`까지.** 확정은 아래 `1b`가 소유한다 — 합의 4차에 두 동작을 분리했다(3차는 GUI 경로가 시트 제출 뒤 **채팅 확정 칩**으로 끝나 §1.3의 D2 판정 단위 *"어느 쪽도 상대 표면을 방문하지 않는다"*를 GUI 쪽이 깼다) |
| **1b** | **A 확정**(합의 4차 신설) | 초안 카드의 `바로 활성화` 칩(기존, 무변경) | **상세 패널 `확정` 버튼** | `status: draft→active`. **규칙 ③ `확정 — 채팅 칩으로도, 버튼으로도`가 화면에서 실제로 참이 되는 유일한 행이다.** `activation_blocker`가 있는 초안으로 한 번 더 눌러 **disabled + 사유 표기**도 확인한다(P3) |
| 2 | A 설정 편집 | "쿨다운 600초로 바꿔줘" → 제안 턴 → `이렇게 바꿔줘`(공통 5필드) | **상세 패널 설정 폼** → `저장`(조건 술어 포함) — 결정 f-2로 위치가 드릴인 탭에서 상세 패널로 바뀌었다. **9b가 심는 예약 루틴에서 수행한다**(4차 명세로는 예약 루틴의 설정 탭을 사람이 **열 수 없어** 이 행이 실행 불가였다, §1.8) | `cooldown_s: 300→600`. **`expires_at`이 변하지 않는지 함께 확인**(R22 — `만료(일)`을 건드리지 않았으므로 patch에 `expires_days`가 없어야 한다). **`note`도 함께 확인(합의 5차 신설, R30)** — 조건을 함께 고친 경우 예약 루틴(자동 생성 `note`)은 **새 술어를 반영**하고, 감시 루틴(사용자 작성 `note`)은 **불변**이어야 한다. GUI 경로는 폼을 열 때 `athena:routine-detail`이 1회 나가고 그 응답의 `source_spec.ops`가 그대로 선택지가 되는 것도 확인(결정 d-2·e-1) |
| 3 | A 일시중지 | "그거 잠깐 멈춰줘" → 칩 | 상세 `일시중지` | `status: active→paused` |
| 4 | A 재개 | "다시 켜줘" → 칩 | 상세 `재개` | `status: paused→active` |
| 5 | A 취소 | "그 감시 지워줘" → 칩 | 상세 `취소` | `status: →cancelled` |
| 6 | B 개별 읽음 | "그 알람 읽음 처리해줘" → 칩 | 알람 행 `읽음` | `unread: true→false` |
| 7 | B 모두 읽음 | "알람 다 읽음" → 칩 | `모두 읽음으로` | 모든 `unread=false` |
| 8 | B 이어가기 | "그 알람에서 이어가자" | 상세 `채팅에서 열기 ↗` | 방 선택은 렌더러 상태(`AthenaNotify.list()` 덤프 + 스크린샷). 부수적으로 나가는 `routine-ack`·`engagement`(`sidebar.js` `'athena:routine-engagement'`, origin **`≈:854`** — 2차의 `:531-533`은 정정)는 REST diff로 |
| **8b** | **D 캔버스에서 열기**(합의 5차 신설) | "그거 캔버스에서 보여줘" → 즉시(칩 없음) | 채팅 카드의 `캔버스에서 열기` | **REST diff 없음(정상).** 증거 = `AthenaCanvasMode.state.view === 'agent'` 덤프 + 스크린샷. 스펙 D 인벤토리의 `캔버스에서 열기·채팅으로`는 두 방향인데 8행이 `채팅에서 열기 ↗` 한 방향만 덮고 있었다 |
| 9 | C 채택 | "그 제안 루틴으로" → 초안 카드 | 제안 카드 `루틴으로`(→ `athena:routine-draft`) → **상세 패널 `확정`** | `routines[]` +1 `status='draft'` → 확정 후 `active`. **GUI 경로가 캔버스 안에서 닫힌다**(합의 4차 — 3차는 여기서도 채팅 확정 칩으로 건너갔다) |
| 10 | C 보류 | "보류할게" → 칩 | 제안 카드 `보류` | **REST diff 없음(정상).** 증거 = 렌더러 상태 덤프(카드 숨김 + `보류함 N건`) + 스크린샷 1장 |
| 11 | C 가드 조정 | **"하루 한 번만 말 걸어"** → 칩 | 가드 폼 → `저장` | **`nudge-guard.max_daily_nudges: 2 → 1`.** ⚠ **합의 5차 정정 — 4차의 기대값 `→2`는 기본값과 같아 빈 diff를 낳았다:** `GuardSettings.max_daily_nudges`의 **기본값이 2**이고(`backend/athena_api/routines/guard_settings.py:49`, 검증 기본값도 `raw.get("max_daily_nudges", 2)` `:84`, 허용 범위 0~10 `:23-24`) 새로 띄운 백엔드에서는 before/after diff가 **비어 있다.** 그런데 ③-3이 이 행을 **JSON diff로 증명해야 하는 12행 중 하나**로 지정하면서 빈 diff를 통과 증거로 쓰는 것을 **명시적으로 금지**했으므로, 계획대로 시연하면 실행자는 통과를 기록할 수 없거나 금지된 증거를 적게 된다. 기본값과 다른 값을 기대치로 둔다. **`max_daily_briefings`가 함께 변하지 않는지도 확인**(R23) |
| 12 | D 탭·필터 | "일시중지된 것만 보여줘" | 필터 탭 클릭 | **REST diff 없음(정상).** 증거 = `activeTab` 덤프 + 스크린샷 |
| 13 | D 검색 | "삼성 찾아줘" | 검색 입력 | **REST diff 없음.** 증거 = `search` 값 덤프 + 스크린샷 |
| 14 | D 드릴인 | "그거 이력 보여줘" | 행 → `전체 이력 보기 →` | **REST diff 없음.** 증거 = `drillInId` 덤프 + 스크린샷 |
| 15 | E 지금 실행 | "밀린 브리핑 지금 실행해줘" → 칩 | 드릴인 `지금 실행` | `/runs`에 `verdict='fired'` 행 +1 |
| 16 | E 결과 열기 | "그 브리핑 결과 보여줘" | run 행 클릭 | `briefing_content` 표시 |
| **17** | **D 그래프 근거 보기**(합의 4차 신설) | "그 제안 근거 그래프로 보여줘" → 즉시(칩 없음) | 제안 뷰 `그래프 모드에서 근거 보기 →` | **REST diff 없음(정상 — 스펙 Constraints:54가 "링크 이동만"으로 범위를 좁혀 놓았다).** 증거 = `AthenaCanvasMode.state.view === 'graph'` 덤프 + 스크린샷. 스펙 D 인벤토리 6동작 중 3차 시연 표에 유일하게 빠져 있던 항목이다 |

**9d. 문서화.** `docs/handoff/2026-09-XX-agent-dual-control-live.md` — §1 기동 명령·헬스 결과(**기동 확인 3건 포함**) · §2 위 **19행** 표에 `대화 경로 결과`/`GUI 경로 결과` 2열 추가 · §3 **증거 경로(행별 형식 분기)**: 서버 상태가 바뀌는 **12행**은 before/after JSON diff, 바뀌지 않는 **7행**(8·8b·10·12·13·14·17)은 렌더러 상태 덤프 + 스크린샷 — **빈 diff를 통과 증거로 쓰지 않는다**(③-3) · §4 미통과 항목(있으면 원인과 함께, 숨기지 않는다) · §5 잔여 경계(fixture 시세·라이브 컬럼 fixture 유지) · §6 Step 8e 자동 하네스가 이미 덮은 범위와 이 시연이 추가로 확인한 것의 구분.
- **충족 AC:** ③-1 ③-2 ③-3 ③-4

---

## 5. Risks and Mitigations

| # | 리스크 | 신호 | 완화 |
|---|---|---|---|
| R1 | **MCP enum 확장이 게이트웨이 신뢰 경계를 넓힌다** — `propose`가 언젠가 쓰기를 하도록 확장될 여지 | `dispatch`의 `propose` 분기에 POST가 생김 | **`test_propose_only_reads_list`**(4차 개명, 5차 이름 통일)가 허용 `(method, path)` 집합을 `{("GET","/api/v1/routines")}` **등호**로 고정해 그 밖의 method·path는 **읽기라도** `AssertionError`. **12개 control** 전부 파라미터로 돌린다(§4 Step 6-A b) |
| R2 | **Paper 아트보드 fit-content 붕괴**(**검은** 스크린샷) | `get_screenshot`이 검게 나옴 | 07·08 신규 보드에 `fit-content`를 **주지 않는다**. 1680×900 픽셀 고정. 넘치면 내부 행 padding을 12→8px로 조인다(실측 처방) |
| R2b | **아트보드 미마운트**(**빈** 스크린샷 — R2와 다른 실패 모드) | `get_screenshot`이 비어서 나옴 | Step 0f에서 **`open_file(A-2 pageId)`로 에이전트 페이지를 활성화**한다. ⚠ **근거 출처 교체(합의 3차):** 2차가 인용한 `PAPER_APP_PARITY.md:203`은 **origin에 없고 작업본 전용**이라 worktree에서 유효하지 않다(머리말 철회 2). 조치는 유지하고 출처만 Paper MCP 서버 지침 + 세션 메모리 `paper-mcp-screenshot-viewport`로 바꿨다 |
| R3 | **프로브 단언 드리프트** — 34건 중 문구를 문자열로 고정한 단언이 Paper 정정과 동시에 깨진다 | `verify:agent-paper-parity` 실패 | Step 3에서 확정한 3줄이 Paper·`agent-canvas.js`·`agent-canvas.test.js`·프로브의 **단일 원본**. Step 8c에서 4곳을 같은 커밋으로 함께 고친다 |
| R4 | **엉뚱한 기반에서 작업해 이미 있는 코드를 재구현** — 로컬 `main`에는 `mode`·스냅샷이 없다 | worktree가 아니라 메인 체크아웃에서 편집이 시작됨 / `conversations.js`에 `mode`가 없음을 근거로 스텁을 만들기 시작 | Step 0a의 **충족 기준 3건**(worktree 목록·브랜치명·`git status` 빈 상태)을 통과하지 못하면 Step 0b로 넘어가지 않는다. 이후 모든 Step의 명령이 `<worktree>` 경로를 쓴다 |
| ~~R13~~ | ~~병합 충돌 6파일~~ | — | **삭제됨.** 사용자가 병합을 폐기하고 `origin/main` 기반 worktree로 확정했으므로(사용자 확정 1) **발생하지 않는 사건**이다. 존재하지 않는 리스크를 표에 두면 완화 절차가 첫 Step에서 헛돈다 |
| R14 | **앵커 드리프트** — **9파일**(`chat.js`·`main.js`·`canvas.js`·**`sidebar.js`**·`conversations.js`·`preload.js`·**`main/backend-launcher.js`**·`server.py`·`PAPER_APP_PARITY.md`)의 줄 번호가 브랜치 기반에서 전부 이동 | Edit이 `old_string` 불일치로 실패 | Step 0e가 9파일 앵커를 **이름으로 재해결**해 노트에 기록. ⚠ **`backend-launcher.js`(+6/-0)는 5차까지 두 목록 어디에도 없으면서 `≈` 없는 확정 좌표로 6곳에서 인용됐다**(합의 6차 편입 — `sidebar.js`·`canvas.js`와 같은 실패 모드의 네 번째 파일이고, 하필 라이브 시연의 기동 계약 전체가 걸린 자리다). ⚠ **`sidebar.js`(+352/-28)는 2차의 이동 목록에도 "차이 0" 목록에도 없어 실행자가 그 좌표를 유효한 것으로 읽었을 자리다**(합의 3차 신설). `routine-approval-actions`(origin 7곳)는 **감싸는 함수명**, `INVOKE/ON_CHANNELS`는 **인접 채널 문자열**로 앵커한다. 차이 0인 7파일은 그대로 유효 |
| R16 | **worktree에 의존성이 없어 베이스라인이 서지 않는다** — `node_modules/`·`.venv/`가 gitignore(**`.gitignore:18-19`**) | `npm test`가 모듈 부재로 즉시 실패 | Step 0d의 `npm ci` + `uv sync`가 Step 1의 **선행 조건**이다. 설치 전 측정값은 기준선으로 쓰지 않는다 |
| R17 | **worktree에 계획·스펙·헌장이 없다** — `.omc/`가 gitignore(`.gitignore:9`), 헌장은 미추적이며 origin 부재 | ralph가 Step 2 이후의 근거 문서를 못 읽는다 / P5의 근거가 사라진다 | Step 0b가 `.omc/plans`·`.omc/specs`를 복사(비커밋), Step 0c가 헌장을 복사 후 **첫 커밋**. 세 파일 존재 확인이 충족 기준 |
| R18 | **origin이 계획 실행 중에도 계속 움직인다** — 개정 때마다 커밋 수가 달라졌고 backtest 트랙이 `chat.js`·`canvas.js`·`main.js`를 다시 크게 고쳤다 | 계획에 박힌 커밋 수·SHA·삽입 줄 수·줄 번호가 착수 시점에 이미 거짓 | 계획에 **숫자를 박지 않는다**(머리말 앵커 규율 — 합의 4차에 머리말의 삽입 줄 수 4건과 커밋 수를 전부 지웠다. 3차가 `실측`이라 표기한 그 다섯 값은 재검증 시점에 **전부 틀렸다**). 기반은 "Step 0a 시점 tip"이라는 변수이고, 브랜치를 딴 뒤에는 **origin 이동이 이 계획에 영향을 주지 않는다**(병합하지 않으므로) |
| R19 | **Step 9가 ralph 무인 실행 불가인데 통과했다고 보고된다**(가짜 완료) | 시연하지 않은 행이 통과로 기록됨 / GUI 클릭을 기다리며 무한 재시도 | Step 9를 🛑 **사람 정지점 ②로 명시.** 자동화 가능분은 Step 8e `verify:agent-dual-control-live`가 미리 덮고, 남은 셋(사람 클릭·LLM 해석·시각 정합)만 사람이 본다. ralph는 9b까지 하고 정지 보고 |
| R20 | **GUI 경로가 비결정적이 된다** — 시트가 폼 값을 문장으로 재직렬화하면 모델이 다시 파싱한다 | 폼에 넣은 값과 다른 루틴이 생긴다 / 라이브 시연에서 "GUI 경로 결과"가 실은 대화 경로의 결과 | 결정 **a″-1**로 `athena:routine-draft` 전용 IPC를 쓴다. `seedChatInput`은 시트의 `채팅에서 쓰기` 버튼에만 남는다 |
| R21 | **`active` 감시 루틴의 술어 편집이 실행 중 루프에 안 먹거나, 먹어도 누적 상태가 남는다** | 사용자가 저장했는데 옛 술어로 발화 / `consecutive_ticks`를 올렸는데 즉시 발화 | 술어 반영은 실측으로 확인됨(`scheduler.py:266-268`이 틱마다 `store.list_active()` 재조회). 누적 상태는 Step 6-A c가 `TriggerState` 초기화를 추가하고 ②-9가 두 건을 단언 |
| R15 | **제안이 사용자가 보고 있지 않은 관제 대화로 흐른다**(2차의 "관제 창은 하나" 전제가 이미 거짓) | `mode==='agent'` 대화가 2건 이상 있는 상태에서 "최신 1건"이 활성 대화가 아닌 쪽을 고름 | ⚠ **합의 3차 재작성.** 2차는 "펜 시트·다중 창 미소유"를 전제로 완화를 데몬 트랙에 넘겼으나 그 전제가 **실측으로 반증**됐다 — `sidebar-project-menu.js`의 `MODE_CHOICES`(`≈:18-24`)에 `{mode:'agent'}`가 있고 `conversations.js touch()`(`≈:198`, push `≈:213-221`)가 `mode:'agent'` 행을 **개수 제한 없이** 만든다. 완화는 미래가 아니라 **지금**이다: `getAgentConsoleSessionId()`를 **"활성 대화가 에이전트면 그 id, 아니면 null"**로 정의하고(§1.4), ②-5 ③이 그것을 **반증 가능한 단언**으로 고정한다. 여전히 미소유인 것은 **동시 상주 세션**뿐이다(`session-persistence-spec.md:130`) |
| R5 | **`chat.js` 비대·회귀** — 라우틴/가드/티켓 카드가 한 파일에 공존 | 기존 확정 칩·가드 카드 테스트 깨짐 | 순수 로직을 전부 `app/lib/agent-proposal.js`로 뗀다(`guard-confirm.js` 선례). `chat.js`에는 구독 1줄 + 렌더 함수 2개만 추가. **기존 확정 칩 블록은 무변경** — 앵커는 감싸는 함수 이름 **`function renderApprovalCard(`**(`≈:2960`)이다. ⚠ 3차의 `기존 :2595-2620 확정 칩은 무변경`은 **로컬 HEAD 좌표**였다(머리말 철회 3 — origin에서 그 블록은 `≈:3010-3040`). 줄 수 인용(`2,887줄`)도 이동 파일에 박은 숫자라 지웠다 |
| R6 | **테스트 수 베이스라인 불명** — 문서마다 1,722 / 1,946 / 2,015 / 2,491 / 2,638 / 2,714로 제각각 | "감소 0" 판정 불가 | Step 1에서 직접 측정해 기록. 이후 모든 비교는 그 값 기준 |
| R7 | **`지금 실행`이 죽은 버튼이 된다** — catchup-fire는 `mode='scheduled'` + `status='active'` + 놓친 예약 있음 3조건을 모두 요구(`routines.py:293-306`) | 감시 루틴 드릴인에서 클릭해도 409 | `_view`의 `missed` 필드(**`routines.py:140-141`**)로 활성/비활성을 가르고, 비활성일 땐 `놓친 예약 없음` 상태 표기. Paper 03 보드에도 같은 두 상태를 그린다(P3) |
| R8 | **`모두 읽음`이 서버에 안 남는다**(현행 갭) + **확장 시 타 방까지 ack가 샌다** | 재시작 후 읽음이 되살아남 / 존재하지 않는 `routine_id`로 404가 쌓임 | Step 7a에서 `markAllAlertsRead` + `athena:routine-ack` 루프. **대상 집합을 두 조건 교집합으로 못 박는다** — `AthenaNotify.list()`의 `read===false` ∩ `id ∈ routines[]`. `sidebar.js`의 `markAllRead:`(origin `≈:1109`)가 notifyRooms를 무조건 순회하므로 그 무조건성을 IPC로 옮기지 않는 것이 핵심. Step 8a-3이 **비-루틴 방 fixture로 "ack 0회"를 단언**한다 |
| R9 | **설정 편집이 실시간 구독을 깬다** | 편집 후 WS 구독 유실 | `symbol`·`condition.source` 변경을 422로 금지(§4 Step 6-A c). 구독 **정체성**이 바뀌지 않으므로 `ensure/release` 왕복 불필요. 구독 **술어**(op/value/consecutive_ticks)는 별건이며 R21이 소유한다 |
| R10 | **메인 체크아웃의 카드 트랙 미커밋 19파일**(강등 — 이제 낮은 위험) | 무관한 파일이 diff에 섞임 | worktree가 별도 체크아웃이라 **물리적으로 분리**된다(사용자 확정 1). stash도 커밋도 하지 않고, Step 0a 충족 기준이 worktree의 `git status --short`가 비어 있음을 확인한다. 초안에서 "사용자 지시 대기" 항목이었으나 worktree 결정으로 **자동 해소**됐다 |
| R11 | **Paper 활성 페이지 미복귀** | 다음 세션이 엉뚱한 페이지에서 시작 | Step 0f에서 활성 페이지 기록(+ `open_file(A-2)`로 전환), Step 5.2에서 복귀 + `finish_working_on_nodes` |
| R12 | **`npm run verify` 전체 하네스 행업**(기존 환경 의존) | 검증3b에서 멈춤 | 게이트로 쓰지 않는다. 좁은 프로브(`verify:agent-paper-parity`)만 사용. **근거 좌표는 Step 0e 노트의 이름 앵커**(`≈:383~`)로 읽는다 — 2차의 `:434-440`은 origin 384줄을 넘어 존재하지 않는다(머리말 철회 2) |
| **R22** | **설정 편집이 만료를 조용히 리셋한다**(합의 3차 신설) | 쿨다운만 고쳤는데 `expires_at`이 now+7일로 밀린다. 화면은 성공으로 보고한다 | `to_dict()`는 `expires_at`을 내고 `validate_draft`는 `expires_days`(기본 7)를 읽는 **비대칭**이 원인이다(`models.py:181-196` vs `rules.py:126,162`). Step 6-A c가 복원 목록에 **`expires_at`을 추가**하고, `expires_days`가 본문에 **온 경우에만** 재계산한다. ②-9의 만료 2 케이스가 고정 |
| **R23** | **가드 저장이 `max_daily_briefings`를 조용히 10으로 되돌린다**(합의 3차 신설) | 조용 시간만 고쳤는데 브리핑 상한이 5→10으로 되살아난다. 9c 11행 `nudge-guard` diff에 아무도 만지지 않은 필드가 나타나 **증거가 오염**된다 | `POST /api/v1/nudge-guard`는 **전체 교체**이고(`nudge_guard.py:24-28`) `guard_settings.py:110`이 결측 시 10으로 되돌린다. Step 7b `saveNudgeGuard`가 `nudge-guard-get`으로 읽은 원본 값을 그대로 실어 보내고, ②-1이 그 사실을 단언 |
| **R25** | **폼이 볼 수 없는 값을 편집 대상으로 그린다**(합의 4차 신설 — 3차의 치명 결손) | 06 설정 폼이 빈 채로 뜬다 / 실행자가 `source_label` 한국어 라벨(`"현재가"`)에서 소스 키를 역추론하는 파서를 발명한다 | 결정 **d-2**가 읽기 계약을 신설한다 — 렌더러 전용 `GET /api/v1/routines/{id}`가 `condition` 블록을 주고(6c-2), `athena:routine-detail`이 그것을 나른다(6c-3·7a·7b). 프로브가 "설정 탭이 그 채널을 1회 부른다"를 단언하고(8c), ②-9b ③이 **목록에는 여전히 `condition`이 없다**(모델 표면 동결)를 단언한다. 3차는 쓰기만 만들고 읽기를 손대지 않아 06 폼·07 A열이 **두 경로 모두에서 구현 불가**였다 |
| **R26** | **신규 `GET /{routine_id}`가 `/briefing-budget`을 잡아먹는다**(합의 4차 신설 — R25 완화가 만드는 새 위험) | 브리핑 예산 조회가 404가 되고, main의 러너가 실행 전 조회에서 조용히 실패한다 | FastAPI는 **선언 순서**로 매칭한다 — 신규 라우트를 `@router.get("/briefing-budget")`(`:186`) **뒤에** 선언한다(6c-2). ②-9b ④가 "예산 응답이 여전히 200"을 회귀 단언으로 고정한다 |
| **R27** | **시연 백엔드가 결손 환경으로 떠서 확인 대상 자체가 죽는다**(합의 4차 신설) | 백테스트 모드가 503으로 죽어 있다 / brain이 degraded라 C 묶음 시연 데이터가 빈다 / 8010을 누가 먼저 잡느냐에 따라 결과가 달라진다 | `buildBackendEnv`(`app/lib/main/backend-launcher.js:28-58`)의 기본값 5개를 앱이 세팅하므로 **`npm start` 하나로 띄운다**(9a·③-1). 수동 `uvicorn`은 **`function decideAction`**(이름 앵커, `≈:62`)이 `'already-running'`을 돌려주어 **앱이 결손 백엔드에 조용히 붙게** 만든다 — 3차가 그 명령을 적어 뒀다. 기동 확인 3건(헬스 200 · 백테스트 모드 비-503 · brain 비-degraded)을 통과해야 시연을 시작한다 |
| **R28** | **레거시 소스 루틴이 손대지도 않은 필드 때문에 422로 거부된다**(합의 4차 신설) | 쿨다운만 고쳐 저장했는데 *"이 source는 앱 플러그인 전용"*이라는 사용자에게 무의미한 422가 뜬다 | `source_spec()`가 `SOURCES` 미스 시 `LEGACY_DISABLED_SOURCES`로 폴백해(**`models.py:107-111`**, 4차의 `:112-116`은 정정) 저장 루틴이 화면에는 **멀쩡히 보이는데**, `validate_condition`(`rules.py:58-62`)은 그 source를 거부한다. Step 6-A c가 재검증 **전에** 판정해 **409 + 전용 메시지**를 내고, 06 폼·설정 패널은 그 루틴을 읽기 전용 + `이 작업은 취소 후 새로 만들기`로 그린다. ②-9의 10번째 케이스가 고정. ⚠ 영향 범위는 **사전 저장 데이터 한정**이다 — 신규 생성은 `validate_condition`이 이미 막고, 9b가 심는 시연 루틴 2건은 둘 다 활성 카탈로그라 라이브 시연은 영향을 받지 않는다 |
| **R29** | **화면에 적힌 규칙이 약속한 버튼이 없는데 자동 게이트는 전건 통과한다**(합의 4차 신설) | 규칙 ③ `확정 — 채팅 칩으로도, 버튼으로도`가 Paper·앱·테스트·프로브에 같은 문자열로 박히지만(R3) 그 **버튼**은 어디에도 없다. 문자열 일치 단언과 프로브 3줄 원문 단언은 **둘 다 통과**하므로 아무도 잡지 못한다 | Step 3-3·7a가 상세 패널 `확정` 버튼을 만들고(백엔드·IPC 신규 0 — 채널·핸들러가 이미 있고 캔버스 호출자만 없었다), ①-6이 **버튼 4개**를, 8a 매트릭스가 GUI 단언을, 8c가 활성 조건 단언을, 9c `1b`행이 사람 확인을 소유한다. **일반화된 교훈:** 규칙 문자열을 단일 원본으로 쓰는 이상, "그 문장이 약속하는 UI가 실제로 존재하는가"는 **문자열 단언이 아니라 동작 단언**으로만 확인된다 |
| **R24** | **에이전트 제어 제안 카드가 타 모드 대화에 뜬다**(합의 3차 신설 — 스펙 Constraints:54) | 백테스트·그래프 대화 중에 루틴 제안 카드가 그 방에 나타난다 | 선례 포워더 3개는 모드를 보지 않고 `shellWin`에 무조건 send한다(origin `main.js:2300-2314`). Step 7d의 `onRoutineProposed`가 `shouldRenderProposal({activeMode, roomId})`로 **그리기 전에** 판정하고, Step 8a-4가 3분기를 단언한다. 2차는 `agent-session.js`를 만들어 놓고 **어디서도 호출하지 않아** 이 계약이 코드로 존재하지 않았다 |
| **R30** | **설정 편집이 `note`를 옛 술어인 채로 남긴다**(합의 5차 신설 — 신규 엔드포인트가 만드는 조용한 손상) | 조건을 `88,000 → 90,000`으로 고쳤는데 목록 행 제목·설정 표기·모델이 읽는 설명이 **모두 계속 `현재가 >= 88000`**이라고 말한다 | `to_dict()`가 기존 `note`를 그대로 싣고(`models.py:181-196`) `rules.py:168-169`는 note가 **빈 경우에만** `human_summary()`로 재생성한다. Step 6-A c에 **신선도 규칙 2개**를 신설했다 — 자동 생성분(`note == human_summary()`)은 `condition` 변경 시 비워 재생성, 사용자 작성분은 절대 덮지 않는다. ②-9의 11번째 케이스가 두 분기를 고정하고, 9c 2행이 사람 확인, 9b가 두 시연 루틴의 `note`를 서로 다르게 심어 두 분기를 모두 도달시킨다. **하필 4차가 D-1로 지키려 한 "모델 도달 표면의 정직성"을 정면으로 훼손하던 자리다**(`_view`가 `note`를 내보낸다, `routines.py:122`) |
| **R31** | **폼이 제시할 선택지를 렌더러가 알 수 없다 — 연산자를 지어내거나 카탈로그를 복사한다**(합의 5차 신설 — 4차의 치명 결손) | 실행자가 `>=·<=·>·<·==`처럼 **어떤 단일 소스와도 맞지 않는** 선택지를 넣는다(숫자 소스의 `==`는 **422를 부르는 거짓 선택지**) / 백엔드 `SOURCES`를 JS 상수로 복사해 두 벌이 갈라진다 | 실측: 앱 전체에 소스 카탈로그가 **0건**(유일한 히트가 `app/chat.js ≈:2949`의 주석)이고 4차의 `GET /{id}`는 `condition` 4키만 준다. `mode`로는 `transport`만 유도되고 **`ops`·`value_type`은 유도 불가**다(`price.current`와 `vi.triggered`가 둘 다 `realtime-ws`). 결정 **e-1**이 서버가 `source_spec` 블록과 `GET /source-catalog`로 실어 보내게 해 **사본을 0으로 만든다.** ②-1 ⑥이 "하드코딩 상수 0개"를, 8c가 "응답에서 왔는가"를 단언한다. ⚠ **부류 단언(8a-5)으로는 못 잡는다** — 도달성도 라벨 등호도 통과시키므로 계약 자체를 없애는 것이 유일한 완화다 |
| **R32** | **GUI 설정 편집이 예약·초안 루틴에서 도달 불가인데 게이트는 전건 통과한다**(합의 5차 신설 — R29의 계열) | 9c 2행에서 사람이 예약 루틴의 설정 폼을 **열 수 없다** / 06 보드가 그린 `schedule.daily` 폼에 앱 대응물이 없다 | 드릴인 진입 버튼이 `kind==='watch'`에서만 그려지고(바깥 `agent-canvas.js:1525` + 안쪽 `:1533`) 설정 탭은 드릴인 전용이다(`:298-299`). 결정 **f-2**가 폼을 `renderDetail`(세 kind 전부에서 그려진다)로 옮기고, **8a-5 도달성 부류 단언**과 8c 프로브의 kind 3종 fixture가 재발을 막는다. ⚠ 4차 검증 자산이 이것을 못 잡은 이유: ②-1 테이블 구동 테스트는 폼 함수를 **직접 호출**하고 8c 프로브는 **watch fixture**로 돌아 **둘 다 전건 통과**한다 |
| **R33** | **`GET /{id}`가 읽을 수 없는 값을 단정해 거짓 활성 버튼을 만든다**(합의 5차 신설 — R25 완화가 만드는 새 위험) | 예약 루틴 상세에서 `missed: true`가 나가고, 그 값이 목록 갱신에 쓰이면 `지금 실행`이 **활성인데 409**를 부른다 | `_view(spec, runtime, *, latest_fired=None)`(`routines.py:108-110`)에 상세 라우트가 `latest_fired`를 주입하지 못해 `_is_missed(missed_at, None)`이 **`return True`**(`:79-80`)를 탄다. 6c-2가 응답을 **§1.6 「반환 키 목록」으로 좁혀** `last_fired_at`·`unread`·`missed`·`next_fire_at`을 **아예 내지 않는다**(P3). ②-9b ①이 반환 키 집합을 **등호**로 단언한다 — "필드 전부" 같은 느슨한 기준은 이 결손을 구조적으로 못 잡는다 |

---

## 6. Verification Steps

### 6.1 환경 준비 (Git Bash)

```bash
# node가 PATH에 없다 — fnm multishell 경로를 먼저 얹는다
export PATH="/c/Users/USER/AppData/Local/fnm_multishells/$(ls -t /c/Users/USER/AppData/Local/fnm_multishells | head -1):$PATH"
node --version   # 기대: v20 이상이 출력된다
```
PowerShell에서는 `fnm env --use-on-cd | Out-String | Invoke-Expression` 후 동일.

### 6.2 게이트 명령과 기대 결과

> 모든 명령은 **worktree 안에서** 돈다. `<worktree>` = `C:/Projects/DAOU.Athena/.claude/worktrees/agent-dual-control`.

| # | 명령 | 기대 결과 |
|---|---|---|
| V0 | (메인 cwd) `git worktree prune` · `git worktree list` · `git -C <worktree> rev-parse --abbrev-ref HEAD` · `git -C <worktree> status --short` | 목록에 worktree 경로 1행 · `feat/agent-dual-control` · **빈 출력**. (초안의 `git rev-list --count HEAD..origin/main == 0`은 **폐기** — `origin/main`에서 브랜치를 따면 항상 참이라 아무것도 검증하지 않는다) |
| V0b | (메인 cwd, **`EnterWorktree` 전에**) `ls <worktree>/.omc/plans/athena-agent-doctrine-plan.md <worktree>/.omc/specs/deep-interview-athena-agent-doctrine.md` · `git -C <worktree> ls-files --error-unmatch docs/ui/paper-card-surface-charter.md` | 3파일 모두 존재, 헌장은 **추적됨**(Step 0b·0c). ⚠ **복사는 진입 앞에서 일어난다** — 진입 후 상대 경로 `cp`는 원본이 없어 죽는다(Step 0a 머리말) |
| V0a2 | (진입 직후) `pwd` · `ls .omc/plans/athena-agent-doctrine-plan.md docs/ui/paper-card-surface-charter.md` | cwd == `<worktree>`, 두 파일이 **상대 경로로** 보고됨(Step 0c-2) |
| V0c | `ls <worktree>/app/node_modules` · `ls <worktree>/backend/.venv` · `cd <worktree>/backend && uv run python -c "import athena_api"` | 둘 다 존재, import 무오류(Step 0d) |
| V1 | `cd <worktree>/app && npm test` | `0 failed`. 통과 수 ≥ Step 1 베이스라인 (신규 테스트만큼 증가) |
| V2 | `cd <worktree>/app && npm run verify:agent-paper-parity` | 모든 `ok` 줄, `FAIL` 0건, 마지막 줄에 `렌더러 콘솔 에러가 없다  ok`. 단언 수 **≥ (Step 1에서 실제로 측정한 베이스라인) + 10**. ⚠ **합의 4차 정정 — 3차의 `≥ 42`는 베이스라인 34를 전제한 상수라 Step 1의 "측정값을 기준선으로 삼는다"와 어긋났다**(worktree에서 다른 값이 나오면 게이트가 거짓이 된다). 상수를 지우고 **측정값 + 신규 증분**으로 쓴다 |
| V3 | `cd <worktree>/backend && uv run pytest -q` | `0 failed`. 통과 수 ≥ Step 1 베이스라인 |
| V4 | `cd <worktree>/backend && uv run pytest tests/mcp/test_routine_tools.py -q` | 신규 **`test_propose_only_reads_list`** **12 파라미터** 전건 통과(`_CONTROL_ACTIONS` 12종 = 10 + `ack_all` + `update`) + `test_propose_rejects_unknown_control` + `test_propose_update_rejects_condition_keys`. ⚠ **합의 5차 정정 — 4차 V4는 6b가 이미 개명한 옛 이름 `test_propose_never_writes`를 게이트로 불렀다.** §6.3 완료 판정이 통과를 요구하는 게이트가 존재하지 않을 이름을 부르면 ralph가 두 테스트를 다 만들거나 게이트를 거짓으로 판정한다 — 하필 D-1(모델 도달 표면 동결)을 코드로 고정하는 **유일한 단언**의 이름이다 |
| V5 | `cd <worktree>/backend && uv run pytest tests/api/test_routines_update.py -q` | **11 케이스** 전건 통과(정상 · 422 금지필드 · 422 쿨다운 · 404 · 409 cancelled · 술어 반영 · `TriggerState` 초기화 · **만료 보존**(`expires_days` 미전송) · **만료 갱신**(전송 시에만) · **409 레거시 소스 전용 메시지** · **`note` 신선도 2분기**(합의 5차, R30)) + **소스별 계약 테이블 구동 1건**(`SOURCES` 6종 파라미터) |
| **V5b** | `cd <worktree>/backend && uv run pytest tests/api/test_routines_detail.py -q` | **5 케이스** 전건 통과 — **반환 키 집합이 §1.6 「반환 키 목록」과 등호**(`condition` 4키 + `source_spec` 4키 포함, `missed`·`unread`·`last_fired_at` **부재**, R33) · 404 · **목록에는 `condition`·`source_spec` 없음**(모델 표면 동결, D-1) · **`/briefing-budget`이 여전히 200**(경로 순서 회귀, R26) · **`/source-catalog`가 활성 6종을 내고 `/{routine_id}`보다 앞에 선언됐다**(결정 e-1) |
| V6 | Paper `get_screenshot` × 8 | **검은 화면 0장 · 빈 화면 0장**(전자는 R2, 후자는 R2b), 겹침·잘림 0 |
| V7 | Paper `export_combined_pdf` + `SendUserFile` | 사용자 승인 문자 수신 + Step 5의 **U-1~U-6 6항목 답** 수신 |
| V8 | `cd <worktree>/app && npm run verify:agent-dual-control-live` (자동) → 그 다음 §4 Step 9c **19행** (사람) | 자동: **22 케이스** 전건 통과. 사람: **12행**은 before/after diff 일치(11행은 `max_daily_nudges: 2 → 1` — 기본값 2와 다른 값이라 diff가 실제로 생긴다), **7행**(8·8b·10·12·13·14·17)은 렌더러 상태 덤프 + 스크린샷. **빈 diff를 통과로 세지 않는다** |
| V9 | `grep -rn "보기 전용\|동선 규칙" <worktree>/app/lib/agent-canvas.js <worktree>/app/probe-agent-paper-parity.js` | **0건.** ⚠ **합의 6차 — 이 게이트가 요구하는 편집을 지시 목록이 전부 명명한다.** origin 실측 히트는 `agent-canvas.js` **10곳**(`:25`·`:300`·`:359`·`:501`·`:504`·`:508`·`:513`·`:987`·`:1021`·`:1444`) · `probe` **9곳**(`:12`·`:15`·`:126`·`:148`·`:150`·`:153`·`:157`·`:264`·`:269`)이고, 5차까지 명시 지시는 `agent-canvas.js` `:25`·`:501-520`·`:1021`과 probe `:11-17`·`:148-162`·`:264-274`뿐이라 **주석 5곳**(`agent-canvas.js:300`·`:359`·`:987`·`:1444` · `probe:126`)이 지시 밖에 남아 실행자가 임의 판단을 해야 했다. 6차에 Step 7a·8c 편집 목록에 편입했다 |
| **V11** | (합의 3차 신설) `grep -n "getAgentConsoleSessionId\|shouldRenderProposal" <worktree>/app/chat.js <worktree>/app/lib/agent-proposal.js <worktree>/app/lib/main/agent-session.js` | **`chat.js`에 최소 1건** — 어댑터가 프로덕션 경로에 연결됐다는 증거. 0건이면 ②-5 미충족이며 스펙 Constraints:54가 코드로 강제되지 않는다(R24) |
| **V12** | (합의 3차 신설) `node -e` 또는 테스트로 `chipToIpc` 키 집합 == `_CONTROL_ACTIONS` 12종 | 완전성 단언 통과. 유령 키(`draft` 등)·누락 키(`update` 등) 0(Step 8a-2 ②) |
| **V13** | (합의 4차 신설) `grep -n "confirmRoutine\|routine-confirm" <worktree>/app/lib/agent-canvas.js <worktree>/app/canvas.js` | **양쪽 모두 최소 1건** — 규칙 ③이 약속한 GUI 확정 버튼이 실제로 배선됐다는 증거. 0건이면 화면이 존재하지 않는 버튼을 약속하는 상태이며 ①-6·②-1·8a A-확정 행이 미충족이다(R29) |
| **V14** | (합의 4차 신설 · 5차 확장) `grep -n "routine-detail" <worktree>/app/preload.js <worktree>/app/main.js <worktree>/app/canvas.js <worktree>/app/lib/agent-canvas.js` · `grep -n "routine-source-catalog" <worktree>/app/preload.js <worktree>/app/main.js <worktree>/app/canvas.js <worktree>/app/lib/agent-canvas.js` | **두 채널 모두 4파일 전부에서 최소 1건** — 조건 원문과 소스 카탈로그 읽기 계약이 REST부터 폼까지 실제로 이어졌다는 증거(결정 d-2·e-1 · R25·R31). 하나라도 0건이면 폼은 빈 채로 그려지거나 사본 상수를 발명한다 |
| **V15** | (합의 5차 신설) `grep -nE "price\.current\|change_rate\|trade\.strength\|vi\.triggered\|schedule\.daily\|'>='\|'<='" <worktree>/app/lib/agent-canvas.js` | **0건** — 소스 이름·연산자 리터럴이 렌더러에 사본으로 존재하지 않는다(결정 e-1 · R31). 1건이라도 있으면 두 벌 상수가 생긴 것이며 ②-1 ⑥이 미충족이다 |
| **V16** | (합의 5차 신설) `cd <worktree>/app && npm test -- agent-canvas` 출력에서 kind 3종 도달성 테스트 이름 확인 | `watch`·`schedule`·`draft` **3종 전부**에 설정 편집 진입로 단언이 있고 통과한다(결정 f-2 · 8a-5 · R32). 4차 자산(테이블 구동 테스트 + watch fixture 프로브)은 이 결손을 **전건 통과**시켰다 |
| V10 | 가짜 완료 방지 — **구현 3파일 + 신설·대폭 수정 테스트 4파일 + 하네스 1파일**:<br>`grep -rnE "TODO\|test\.skip\|test\.only\|it\.skip\|describe\.skip" <worktree>/app/lib/agent-proposal.js <worktree>/app/lib/main/agent-session.js <worktree>/app/lib/agent-canvas.js <worktree>/app/lib/agent-proposal.test.js <worktree>/app/lib/main/agent-session.test.js <worktree>/app/lib/agent-canvas.test.js <worktree>/app/verify-agent-dual-control-live.js`<br>`grep -rnE "TODO\|pytest\.mark\.skip\|pytest\.mark\.xfail" <worktree>/backend/tests/api/test_routines_update.py <worktree>/backend/tests/api/test_routines_detail.py` | 양쪽 모두 **0건**. ⚠ **합의 5차 정정 — 4차 V10은 자기 근거가 지목한 파일을 대상에서 빼고 있었다.** 근거 문장이 *"Step 8a의 A~E × 2경로 매트릭스가 분량이 커 스텁·skip이 가장 발생하기 쉬운 자리"*라 적어 두고, 그 매트릭스의 GUI 단언이 사는 **`agent-canvas.test.js`**(8b가 기존 단언 3건을 교체하고 8a가 GUI 단언 십수 건을 새로 얹는 파일)와 4차 신설 **`test_routines_detail.py`**를 대상에 넣지 않았다 — 게이트 범위가 근거보다 좁으면 "게이트는 통과하는데 스텁이 남는다"가 성립한다(8c에서 `inputCount >= 4`를 폐기하며 세운 기준의 같은 적용). **행 수 상수(`14행 × 2 = 28건`)도 지운다** — 8a 매트릭스는 4차의 D-그래프, 5차의 D-캔버스·도달성 편입으로 계속 늘고, 이 계획의 규율은 곧 낡을 숫자를 박지 않는 것이다 |

### 6.3 완료 판정

V0~V16(V0a2·V0b·V0c·V5b·**V15·V16** 포함) 전부 통과 + `docs/handoff/2026-09-XX-agent-dual-control-live.md` 존재 + `PAPER_APP_PARITY.md` 에이전트 섹션 8/8 `적용` + **2개 사람 정지점 모두 통과**(Step 5 PDF 승인 + U-1~U-6 답 · Step 9 사람 시연).

**작업물 보관:** 이 브랜치는 병합하지 않으므로(사용자 확정 1) 완료 시점의 산출물은 **worktree 안의 커밋들**이다. 정리 목적으로도 `ExitWorktree {action:"remove"}`를 부르지 않는다(Step 0a-2).

### 6.4 열린 질문

`.omc/plans/open-questions.md`에 이 계획의 미결 항목을 기록했다.
- **#1(병합 처리)은 닫혔다** — 사용자가 `origin/main` 기반 worktree + 병합 없음으로 확정했다(사용자 확정 1).
- **#2·#3·#4·#5는 Step 5 검수 게이트의 U-2·U-1·U-4·U-3 확인 항목**으로 올라가 있다 — 실행 중 답을 받는다.
- **합의 5차 신규 #10(설정 편집 폼의 위치)은 U-6으로 올라갔다** — 결정 (f)가 폼을 드릴인 `설정` 탭에서 상세 패널로 옮기고 드릴인 탭을 읽기 전용 요약으로 바꾸므로, 화면 계약이 바뀐다. 4차 명세대로 두면 예약·초안 루틴에 GUI 설정 편집 경로가 **존재하지 않아** D2가 조용히 축소된다.
- **합의 5차 신규 #11(소스 카탈로그 계약)은 U 항목이 아니다** — 결정 (e)는 사용자 선호가 아니라 **코드 사실**(앱에 카탈로그가 0건이고 `mode`로 `ops`를 유도할 수 없다)이 강제하는 것이라 옵션 표로 계획이 결정했다(e-3 "사용자에게 묻는다"를 그 이유로 기각).
- **합의 4차 신규 #9(조건 술어 편집 경로)는 U-5로 올라갔다** — 결정 (d)가 조건 술어를 GUI 전용으로 두므로 스펙 A의 "조건"에 대한 **대화 경로 부분 축소**이고, 사용자 확정 4에 따라 조용히 넘기지 않는다.
- **#6은 합의 3차에 범위가 좁아졌다** — 펜 시트와 `mode==='agent'` 대화 다건은 **origin에 이미 있다**(§1.4 실측). 이 계획 밖으로 남는 것은 **동시 상주 세션**뿐이며 그것만 데몬 선행이다(`session-persistence-spec.md:130`).

---

## 7. ADR — 에이전트 모드 이중 완전 제어

**Decision**
에이전트 모드의 제어 인벤토리 A~E를 **"두 입구, 한 게이트"**로 구현한다. 대화 경로는 `athena_routine`의 신규 `propose` 액션 → `main.js` 릴레이(**기존 포워더 3개에 이은 4번째**) → `chat.js` 제안 턴 카드 → **사람의 칩 클릭** → 기존 `athena:routine-*` IPC로 흐르고, GUI 경로는 `agent-canvas.js`의 시트·폼·버튼 → **같은 채널 이름**으로 흐른다. 두 경로가 같은 채널로 수렴한다는 사실은 **Step 8a-2의 단언 두 개가 지킨다** — 구조가 저절로 보장하지 않는다. ① **발산 단언**(두 벌의 채널명 상수를 대조 — 오타로 갈라지는 것을 잡는다) ② **완전성 단언**(`_CONTROL_ACTIONS` 12종 전부가 IPC 또는 명시적 `null`로 덮인다 — 유령 이름·누락을 잡는다). 대화 경로의 **설정 편집**은 신규 control **`update`** → `athena:routine-update`로 흐른다(합의 3차: 2차가 이 자리를 `confirm`으로 메워 칩이 자기 글자와 다른 일을 하던 결함을 고쳤다). **A의 확정도 두 입구다**(합의 4차) — 기존 채팅 초안 카드의 `바로 활성화` 칩과 **신설 상세 패널 `확정` 버튼**이 같은 `athena:routine-confirm`으로 수렴한다. 3차까지는 규칙 ③이 그 버튼을 문자열로 약속하고도 만들지 않아 GUI 경로가 마지막 한 걸음에서 채팅으로 건너갔다(P3 · D2 판정 단위 위반). **조건 원문과 소스 카탈로그 읽기는 렌더러 전용 REST 2개로만 나간다** — `GET /api/v1/routines/{id}`(결정 d-2, `condition` + `source_spec`)와 `GET /api/v1/routines/source-catalog`(결정 e-1, routine_id가 없는 05 시트용). 모델이 도달하는 읽기는 여전히 `GET /api/v1/routines` 하나이고, `test_propose_only_reads_list`가 허용 path 집합을 등호로 고정한다. 그래서 편집 제안 가능 키가 경로마다 갈린다: **대화는 공통 5필드, GUI는 공통 5 + 조건 술어 3필드.** **카탈로그는 렌더러에 사본을 두지 않는다**(결정 e-1) — 채널명은 두 렌더러가 각자 부르므로 사본이 불가피해 결합 단언으로 지켰지만, 카탈로그는 서버가 유일 소유자이므로 사본을 만들지 않는 것이 옳다. **GUI 설정 편집 폼은 드릴인 `설정` 탭이 아니라 상세 패널(`renderDetail`)에 산다**(결정 f-2) — 드릴인 진입 버튼이 `kind==='watch'`에서만 그려져(`agent-canvas.js:1525`·`:1533`) 예약·초안 루틴에서 폼에 도달할 수 없기 때문이다. **조건을 편집하면 자동 생성 `note`는 새 술어로 재생성되고 사용자 작성 `note`는 불변이다**(합의 5차 신설 — `note`는 목록 행 제목이자 모델이 읽는 유일한 루틴 설명이라, 재생성하지 않으면 화면과 모델이 함께 옛 조건을 말한다). 상태를 바꾸지 않는 뷰 상태(D)와 브리핑 결과 열기는 칩 없이 즉시 적용한다. 공통 세션 기반은 **재구현하지 않는다** — `origin/main`을 기반으로 **`feat/agent-dual-control` worktree 브랜치**를 만들어 이미 착륙한 `mode` 필드·스냅샷 복원을 그대로 쓰고(병합하지 않는다), 에이전트가 필요로 하는 판정 2개만 `app/lib/main/agent-session.js`에 모은다. 작업 순서는 Paper 전량 → **문구-무관 백엔드(6-A)** → PDF 검수 게이트 → 앱이며, 사용자 노출 문자열(6-B)만 승인 후로 미룬다(합의 3차: "게이트 대기 중 병행"은 순차 실행자에게 성립하지 않으므로 **배치로** 해결했다). 타 모드 불간섭은 서술이 아니라 코드가 강제한다 — `shouldRenderProposal({activeMode, roomId})`가 카드를 그리기 전에 판정하고 Step 8a-4가 그것을 단언한다.

**Drivers**
1. 게이트웨이 신뢰 경계를 넓히지 않는다 — **쓰기도, 읽기도.** `test_routine_tools.py:37-50`이 고정한 안전 속성을 보존하고, 합의 4차에 **모델 도달 읽기 표면 동결**을 같은 드라이버 아래로 넣었다(`_view:111`이 축소를 의도로 선언해 두었으므로 그것을 되돌리는 것도 경계 확대다). ⚠ **합의 5차 문면 정정:** "동결"은 *"모델이 술어를 전혀 못 본다"*가 아니다 — 자동 생성 `note`(`rules.py:168-169` + `models.py:168-179`)가 술어를 **산문으로** 이미 넘긴다. 동결되는 것은 **기계 판독 소스 키와 연산자 집합**이고, 그래서 모델은 **유효한 술어 패치를 조립할 수 없다.** 이 구분이 d-1과 d-2를 실제로 가르며, U-5의 승인 근거도 이 문면 위에서 다시 썼다.
2. 사람 검수 게이트가 한 번만 서야 한다 — ralph 순차 실행에서 리드타임을 지배하는 변수. (결과적으로 사람 정지점은 **2개**다: PDF 검수 + 라이브 시연. 후자는 GUI 클릭이 물리적으로 필요해 자동화가 불가능한 잔여분이며, 자동화 가능분은 Step 8e 하네스로 뗐다.)
3. 공통 세션 기반은 실재하며 이미 착륙했다 — `docs/plans/session-persistence-spec.md` + `ff64f93`/`ba63bc5`/`c51dc10`이 `origin/main` 조상이고 로컬 `main`에는 없다. 설계 전제는 "부재"가 아니라 **"origin/main 기반으로 브랜치를 딴다"**이다. **커밋 수는 이 결정과 무관하다** — 개정 때마다 값이 변했으므로 숫자를 근거로 쓰지 않는다(합의 4차: 머리말의 삽입 줄 수도 같은 이유로 지웠다).

**Alternatives considered**
- (a-2) 되돌릴 수 있는 동작의 자연어 즉시 실행 — `routine_tools.py:6-9` 원칙 위반, 위험도 비대칭, 회귀 테스트 3건 삭제 필요. **기각.**
- (a-3) D 포함 전 동작 칩 확인 — 렌더러-로컬 동작에 붙는 순수 마찰, D2 훼손. **기각.**
- (a′-2) 최상위 `action` enum 직접 확장 — 스펙 문면에 더 가까우나 REST 동사와 이름이 겹쳐 "실행처럼 보이는 제안"이 되고 회귀 테스트를 통째로 다시 써야 한다. **기각(변경 비용 1파일 + 1테스트로 되돌릴 수 있음을 명시).**
- (a″-2) GUI 시트 제출 = `seedChatInput` — GUI 경로가 모델 파싱에 의존해 **비결정적**이 되고, `seedChatInput`은 IPC가 아니라 렌더러 로컬 버스(`app/canvas.js ≈:2129`)라 "같은 게이트로 수렴"이 성립하지 않는다. 라이브 시연 증거도 오염된다. **기각.**
- (a″-3) A-생성을 대화 전용으로 — 스펙 R3 답변(스펙:173 "GUI도 모든 제어가 가능해야 한다")과 A 인벤토리 위반. **기각.**
- (b-2) `origin/main`을 로컬 `main`에 병합 — 카드 트랙 미커밋 파일과 충돌이 확정적이고, 해소가 사람 판단을 요구해 ralph 첫 Step이 멈춘다. **기각(사용자 확정 1).**
- (b-3) 브랜치 없이 로컬에서 3함수 스텁 — `origin/main`에 이미 있는 `mode`·스냅샷을 재구현하게 된다. **기각(스펙의 "부재 시 스텁" 가정이 사실 확인으로 무효화됨).**
- (b-4) 펜 시트·다중 창까지 구현 — Non-Goals:67 위반이고 `session-persistence-spec.md:92-93`이 데몬 선행을 요구한다. **기각.**
- (6c-2) 편집을 `draft`+`confirm` 재사용으로 — `draft`가 새 `id`를 만들어 편집이 다른 루틴이 된다. **기각.**
- (6c-3) `PATCH /{id}` — 파일의 라우터 12개 중 PATCH가 0개라 관례를 깨고 `routineHttp` 메서드 분기가 는다. **기각(일관성 우선).**
- (c-2) A~E 인터리브 — 사람 게이트 5회 정지, 05 보드 규칙 3줄이 묶음 단위로 분해 불가. **기각.**
- (c-3) 앱 선행 — Paper SSOT 결정(`PAPER_DESIGN_AUDIT.md` 결정 로그 2026-09-01) 번복. **기각.**
- **(d-1) `_view`에 `condition` 블록 추가**(합의 4차) — 신규 라우트 0이고 대화 경로도 조건 편집을 제안할 수 있게 되지만, `_view`는 **모델이 도달하는 유일한 읽기 표면**이고 그 독스트링(`routines.py:111`)이 축소를 의도로 선언해 뒀다. 모델에게 기계 판독 술어를 넘기면 D-1의 정신이 줄어든다. **기각(단, U-5가 반려되면 이 안으로 돌아온다 — 되돌리는 비용은 `_view` 1곳 + 단언 1건).**
- **(d-3) `GET /{id}/runs` 응답에 `spec.condition` 동봉**(합의 4차) — 신규 라우트·IPC 0으로 가장 싸고 드릴인이 이미 그 채널을 3번 부른다. 그러나 **이력 엔드포인트가 명세를 내게** 되어 이름과 내용이 어긋나고, 편집 기능을 고칠 때 `/runs`를 만져야 하며, 드릴인 왕복 3회가 매번 spec을 중복 운반한다. **기각(의미 왜곡 회피 우선).**
- **(A-확정을 GUI에서 빼고 규칙 ③ 문구를 줄이는 안)**(합의 4차) — 규칙 문면을 "확정은 채팅 칩"으로 되돌리면 버튼을 안 만들어도 정직해진다. 그러나 스펙:173("GUI도 모든 제어") · Constraints:57(규칙 ③ 문면) · Acceptance ③("A~E 각 동작을 GUI 경로 1회")를 **동시에** 좁히는 일이고, 구현 비용은 반대로 **거의 0**이다(채널·핸들러·백엔드가 이미 있고 캔버스 호출자만 없다). 비싼 쪽이 스펙 축소이므로 **기각 — 버튼을 만든다.**
- **(e-2) 소스 카탈로그를 렌더러 사본 상수로 두고 발산 단언으로 지키는 안**(합의 5차) — 라우트·IPC 0이고 시트가 왕복 없이 즉시 그려진다. 그러나 두 벌 상수 표면이 **6소스 × 4속성**으로 채널명 12개보다 훨씬 크고, 실패 모드가 **사용자가 저장을 누른 뒤의 런타임 422**라 늦게 드러나며, 발산 단언이 기대는 백엔드 덤프 fixture 자체가 낡을 수 있다. **기각 — 사본을 만들고 단언으로 지키는 것은 사본이 불가피할 때의 차선책이지 기본값이 아니다.**
- **(e-3) 06 폼을 활성 6종 하드코딩으로 그리고 U 항목으로 올리는 안**(합의 5차) — e-2의 단점 전부에 더해, **코드 사실을 사용자 결정으로 위장**한다. 카탈로그는 선호가 아니다. **기각.**
- **(f-1) 드릴인 링크를 `kind==='schedule'`에도 여는 안**(합의 5차) — 기존 구조를 유지하지만 **초안이 남는다**(바깥 게이트 `agent-canvas.js:1525`가 draft를 먼저 걸러내므로 두 게이트를 다 손대야 하고, 그러면 draft 드릴인이 빈 "최근 실행"을 열어 그 주석이 지킨 계약 *"빈 로그를 지어내 보여주지 않는다"*를 깬다). **기각.**
- **(f-3) "GUI 설정 편집은 감시 루틴 전용" 선언**(합의 5차) — 코드 변경 0이지만 D2의 명시적 축소라 반려 개연성이 크고, 반려되면 f-2를 그때 하게 되며(재작업), 06 보드의 `schedule.daily` 폼에 앱 대응물이 없어져 보드 문구까지 고쳐야 한다. **기각 — 단 U-6의 대안으로 남긴다.**
- **(조건 술어 편집을 양 경로에서 빼고 `조건은 취소 후 새로 만들기`로 표기하는 안)**(합의 6차 편입 — Architect antithesis) — 계획이 이미 `종목`·`소스`에 대해 내린 판단과 **동형**이고, 채택하면 `GET /{id}`(d-2)·`source_spec` 블록·R30 `note` 신선도·R33 응답 축소·f-2 도달성 문제의 절반이 **동시에 소멸**한다(05 시트가 강제하는 `/source-catalog` 하나만 남는다). **기각** — 스펙 A 인벤토리가 편집 대상에 **`조건`을 명시**하므로 이것은 U-5(대화 반쪽 축소)보다 **더 큰 축소**이고 자체 U 항목이 필요하며, 백엔드 한계 비용이 작다(`POST /{id}/update`는 공통 5필드 때문에 어차피 필요하고 화이트리스트는 집합 하나다). **다만 U-5·U-6 반려 시의 착지점으로 지정한다** — 현재의 두 대안(d-1 / f-3)은 각각 **D-1**과 **D2**를 깨므로, 5차까지 계획은 *"사용자가 어느 쪽을 반려하든 자기 드라이버 하나를 깨는 자리에 착지"*하도록 설계돼 있었다. 이 세 번째 안은 D-1도, §1.3이 세운 D2 판정 단위도 깨지 않는 **유일한 착지점**이다.
- **(상세 라우트에 `latest_fired`를 주입하는 안)**(합의 5차) — `GET /{id}`가 해당 routine_id의 최신 fired 행 1건을 조회해 `_view`에 주입하면 `last_fired_at`·`unread`·`missed`가 참이 된다. 그러나 **폼 프리필에 그 세 값이 필요 없고**, 이력 조회 비용이 폼 열 때마다 든다. **기각 — 대신 응답을 좁혔다**(P3: 읽어올 수 없는 값을 선언하지 않는다).
- **(`update` control을 빼고 A-설정편집을 `view` 핸드오프로 되돌리는 안)** — 검토에서 제기됐다. `POST /{id}/confirm`이 패치가 아니라 `can_activate` → `ensure_realtime_subscription` → `store.transition(id,'active')`임을 실측으로 확인했으므로(`routines.py:211-229`) 2차의 `chipToIpc('confirm')`은 실제로 P3 위반이었고, 대안인 "대화 경로 미지원 선언"은 D2 위반이다. **기각.** 다만 그 반론이 정확히 짚은 것 — *`update`만이 두 경로 모두에 조건 원문 읽기를 요구하는데 계획은 어느 쪽도 충족하지 않았다* — 는 전적으로 옳았고, **결정 (d)가 그 청구서다.**

**Why chosen**

1. **선례가 하나가 아니라 셋이다.** `app/main.js`에는 tool_result를 렌더러 카드로 릴레이하는 포워더가 이미 3개 있다 — `maybeForwardNudgeGuardProposal`(`≈:2300`) · `maybeForwardGraphChatAction`(`≈:2331`) · `maybeForwardBacktestChatAction`(`≈:2375`). 이 계획은 새 아키텍처를 도입하지 않고 **같은 디스패치 지점(`≈:2494`)에 4번째를 얹는다.** 그중 nudge-guard 경로는 `renderGuardConfirmCard`(`app/chat.js ≈:3064`) → `athena:nudge-guard-set`까지 **프로덕션에서 종단으로 작동**한다.
2. **신뢰 경계가 하나다.** 모델은 MCP 툴 디스패치까지만 도달하고 그 표면의 쓰기 경로가 0이다(**`test_propose_only_reads_list`**가 허용 path 집합 등호로 고정 — 5차에 이름 통일). 쓰기는 `preload.js`의 `INVOKE_CHANNELS` 허용목록(`≈:3`, 검사 `≈:326`)을 통과한 렌더러 호출만 가능하며, 모델은 렌더러 컨텍스트에 코드를 실행할 통로가 없다. 칩 클릭은 "모델의 제안"을 "사람의 승인"으로 승격시키는 **단 하나의 사건**이고, 자연어 확인으로 대체하면 승인 판정이 모델에게 되돌아간다.
3. **파리티는 구조가 아니라 단언이 지킨다 — 초안의 주장을 철회한다.** 초안은 "두 입구의 마지막 한 걸음이 문자 그대로 같은 함수라 파리티가 구조로 보장된다"고 적었으나 **거짓**이다: `app/chat.js`(`invoke ≈:3025`)와 `app/canvas.js`(`≈:2975`·`≈:2980`)는 각자 `window.athena.invoke`를 부르고 공통 함수를 공유하지 않는다. 만나는 곳은 preload 허용목록과 main 핸들러뿐이다. 그래서 이 계획은 **Step 8a-2의 단언 두 개**로 파리티를 명시적으로 고정한다 — ① 두 벌 상수를 대조하는 **발산 단언**(IPC 매핑 10 control 테이블 구동)과 ② `_CONTROL_ACTIONS` 12종 전부가 덮이는지 보는 **완전성 단언**. 하나만으로는 부족하다는 것이 합의 3차에 증명됐다: 2차의 테이블은 존재하지 않는 control `draft`를 대상으로 삼았고 `update`가 enum에 아예 없었는데, ①만으로는 그 유령·누락이 드러나지 않았다. "구조로 보장된다"를 믿으면 결합 테스트를 안 써서 갈라지는 회귀를 못 잡고, 조회식 단일 상수로 바꾸면 ①이 항상 참인 무의미한 단언이 된다.
4. **칩 확인은 D2의 예외가 아니라 D2의 구현이다** — 두 경로 모두 자기 표면 안에서 사람 클릭 1회로 닫히고, 어느 쪽도 상대 표면을 방문하지 않는다. 확정 칩 `autofocus`로 대화 경로의 체감 비용은 "문장 + Enter"가 된다.

**Consequences**
- (+) 게이트웨이 회귀 테스트가 그대로 살아남는다. 모델이 상태를 바꿀 경로가 계속 0이고, **읽기 표면도 `GET /api/v1/routines` 하나로 동결된다**(합의 4차 — 단언이 "쓰기 없음"에서 "허용 path 집합 등호"로 강해졌다).
- (+) 신규 REST는 **2개**다 — `POST /{id}/update`(쓰기)와 `GET /{id}`(렌더러 전용 읽기). `athena:routine-draft`가 부르는 `POST /draft`는 **이미 있는** 엔드포인트라 백엔드 추가가 0이다(`routines.py:145-150`). 나머지 A~E는 기존 엔드포인트·IPC 재사용.
- (−) **읽기 계약이 하나 늘어난 대가**(결정 d-2): IPC 채널 1개(`athena:routine-detail`) + preload 1줄 + main 핸들러 1개 + 렌더러 어댑터 1개. 그 대신 06 폼과 프로브·테스트가 **한 곳을 보고**, 모델 표면은 커지지 않는다. 새 위험(R26 — `/briefing-budget` 경로 순서)은 선언 위치 규칙 + 회귀 단언으로 닫았다.
- (+) **A-확정의 GUI 경로가 실제로 생긴다**(합의 4차). 규칙 ③이 Paper·앱·테스트·프로브에 같은 문자열로 박히는데 그 버튼이 없으면 **자동 게이트가 전건 통과하면서 화면이 거짓말을 한다**(R29). 구현 비용은 채널·핸들러가 이미 있어 호출자 1개뿐이었고, 대가로 9c 1·9행의 GUI 경로가 **캔버스 안에서 닫혀** §1.3이 세운 D2 판정 단위를 양쪽 모두 만족한다.
- (−) 그 대신 `agent-canvas.js:22-27`의 명시적 계약 주석("상세 패널은 draft 항목에서 읽기 전용")을 **번복**한다. 말없이 어기지 않고 Step 7a가 주석 자체를 새 계약으로 고친다(P4).
- (+) `agent-proposal.js`·`agent-session.js`가 DOM·IPC 없는 순수 모듈이라 `chat.js` 비대화를 막고 단위 테스트가 가능하다.
- (+) **병합이 0회다.** worktree가 `origin/main`에서 직접 갈라지므로 충돌이 발생할 사건 자체가 없고, 메인 체크아웃의 카드 트랙 미커밋 파일과 물리적으로 분리된다. 초안의 첫 사람 정지점(병합 판단)이 사라졌다.
- (−) 대신 **worktree 부팅 비용**이 생긴다: `.omc/` 이관(gitignore) · 헌장 이관·커밋(미추적·origin 부재) · `npm ci`+`uv sync`(gitignore). Step 0b·0c·0d가 이를 소유하며, 이것들이 끝나기 전에는 베이스라인이 서지 않는다.
- (−) **이 브랜치는 병합하지 않는다**(사용자 확정 1). 통합 시점·방법은 이 계획 밖의 별도 결정으로 남는다.
- (−) 대화 경로가 문장 + 클릭 2동작이다. "말 한마디로 끝"을 기대한 사용자에게는 한 걸음 더다 — 07 보드가 이 계약을 명시적으로 그리고, 확정 칩 `autofocus`가 마찰을 줄인다.
- (−) **사람 정지점이 1개가 아니라 2개다.** Step 9의 GUI 클릭은 ralph가 대신할 수 없다. Step 8e 하네스가 자동화 가능분을 미리 덮어 남은 정지 시간을 줄인다.
- (+) **`agent-session.js`의 판정이 "최신 1건"이 아니라 "활성 대화"다**(합의 3차 정정). `conversations.js touch()`가 `mode:'agent'` 행을 무제한 만들 수 있음이 실측으로 드러나 "최신 1건"은 **지금 당장 오답을 낼 수 있었다** — 사용자가 보고 있지 않은 과거 관제 대화로 제안이 흘러갔을 자리다(P3). 활성 대화 기준은 데몬 이전에도 이후에도 옳고, ②-5 ③이 **반증 가능한 단언**으로 그것을 고정한다.
- (+) **어댑터가 프로덕션 경로에 연결된다.** 2차는 `agent-session.js`를 만들고 단위 테스트까지 요구하면서 호출부를 0개 두었다 — 소비자 없는 모듈(CLAUDE.md §2 위반)이자 스펙 Constraints:54가 코드로 존재하지 않는다는 뜻이었다. Step 7d 두 지점이 소비자이고 V11이 그 존재를 grep으로 확인한다.
- (+) **조용한 데이터 손상 2건을 착수 전에 막았다** — 편집 시 만료 리셋(R22)과 가드 저장 시 브리핑 상한 복귀(R23). 둘 다 "저장은 성공했다고 보고하는데 화면에 없는 값이 바뀐다"는 같은 부류이고, 후자는 2차가 **"기본값으로 동작한다"는 틀린 사실 주장으로 위험을 스스로 봉인**하고 있었다.
- (+) 스펙의 "기반 부재 시 스텁" 가정이 사실 확인으로 무효화되어, 어댑터가 3함수에서 2함수로 줄고 재구현 위험이 사라졌다.
- (−) 검수 반려 시 Paper 재작업이 발생한다. 앱 렌더러를 아직 안 건드린 시점이라 손실은 Paper에 국한되고, Step 6-B 분할로 **문구 의존 코드도 아직 안 쓴 상태**다. 6-A(문구 무관)는 이미 끝나 있으므로 반려가 그것을 무효화하지 않는다 — 단 **U-1이 반려되면** 6-A c의 화이트리스트와 06 보드가 함께 바뀌므로 6-A c 이후를 재작업한다(Step 5-5).
- (−) **06 설정 폼이 소스별로 분기한다** — "입력 정확히 6개" 같은 셀 수 있는 AC를 잃는 대신 **집합 동일성**(폼 필드 == 화이트리스트 ∩ 소스별 유효 필드)으로 옮겼다. `SOURCES` 6종을 도는 테이블 구동 테스트라 단언은 오히려 강해지지만, 폼 구현과 보드 그리기 비용이 는다. 대가로 `schedule.daily`·`vi.triggered` 루틴이 GUI로 **편집 가능해진다** — 2차 명세로는 둘 다 422라 편집 자체가 불가능했다.
- (−) **조건 술어(`op`·`값`·`연속 틱`) 편집은 GUI 전용이다**(결정 d). 대화로 요청하면 `control:'view'`가 설정 탭을 연다. 스펙 A 인벤토리가 편집 대상에 `조건`을 명시하므로 이것은 **대화 경로의 부분 축소**이고, 조용히 두지 않는다 — **U-5 확인 항목**이며 반려 시 d-1로 되돌린다. 근거는 P3다: 모델이 도달하는 읽기가 조건을 한국어 라벨(`"현재가"`)로만 주므로, 술어를 제안하려면 라벨 역추론 파서를 발명해야 한다(R20 재발).
- (−) **`symbol`·`condition.source`는 편집할 수 없다(422)** — "모든 설정 편집"의 문자 그대로는 아니다. `derive_mode`가 `source → transport → mode`를 결정론적으로 유도하므로(`models.py:101-104`) source 변경은 루틴을 **다른 종류의 루틴으로 바꾸는 일**이고, 실시간 구독 정체성 보호를 위한 의도적 제한이며, **조용한 축소로 두지 않는다**(사용자 확정 4): Step 5의 **U-1 사용자 확인 항목**으로 올리고, 06 보드·설정 패널에 `변경 불가` 상태 표기 + **`종목·소스는 취소 후 새로 만들기`** 안내를 실제 문구로 넣는다.
- (−) `condition` 술어 편집은 실행 중 루프에 반영되지만(`scheduler.py:266-268`이 틱마다 재조회) `TriggerState`가 초기화되지 않으면 누적치가 남는다 — 6-A c가 초기화를 추가하고 ②-9가 단언한다. 이 부작용을 발견하지 못했다면 "저장은 성공했는데 발화가 이상한" 조용한 결함이 됐을 자리다.

- (+) **소스 카탈로그의 렌더러 사본이 0이다**(합의 5차 · 결정 e-1). 4차 명세는 폼 모양 전체를 `spec.ops`·`spec.value_type`·`spec.transport`로 결정하라 지시하면서 그 값이 어디서 오는지 정하지 않았고, 앱에는 카탈로그가 **0건**이었다(유일한 히트가 `app/chat.js ≈:2949`의 주석). 그대로 두면 실행자가 연산자를 지어내거나(422를 부르는 거짓 선택지) 백엔드를 JS로 복사했을 자리다. 서버가 실어 보내므로 소스가 늘거나 `ops`가 바뀌면 **화면이 자동으로 따라온다.**
- (−) 그 대가로 **신규 REST가 2개에서 3개**가 됐다(`/{id}/update` · `/{id}` · `/source-catalog`)와 IPC 채널 1개·preload 1줄이 늘었다. 그리고 무동사 GET이 둘이 되어 **선언 순서 규칙**이 `/briefing-budget` → `/source-catalog` → `/{routine_id}`로 길어졌다(R26의 표면이 커졌다 — ②-9b ④·⑤가 둘 다 회귀 단언한다).
- (+) **GUI 설정 편집이 세 kind 전부에서 도달 가능해진다**(합의 5차 · 결정 f-2). 4차 명세는 폼을 드릴인 `설정` 탭에 두었는데 그 탭은 `kind==='watch'`에서만 열려(`agent-canvas.js:1525`·`:1533`, 파일 머리말 `:59-62`가 계약으로 명시) **예약·초안 루틴의 GUI 설정 편집이 존재하지 않았다** — D2의 미신고 축소이자 9c 2행의 실행 불가였다. 상세 패널은 세 kind 모두에서 그려지고 `확정` 버튼이 들어가는 같은 자리라 추가 비용이 가장 작다.
- (−) 그 대가로 드릴인 `설정` 탭이 **읽기 전용 요약 + `설정 편집` 버튼**으로 축소되고, 그 탭에 걸린 기존 프로브 단언 문면을 함께 고쳐야 한다(8c). 화면 계약 변경이므로 **U-6 확인 항목**으로 올렸다. ⚠ **그 버튼의 동작은 「상세 패널로 스크롤」이 아니다(합의 6차 정정).** `openHistory`가 `body.hidden = true`(`agent-canvas.js:1076`)로 상세 패널 트리(`panels`→`body`, `:498-499`)를 통째로 숨기므로 드릴인 중에는 스크롤할 대상이 **화면에 없다** — 5차 문면대로 만들면 f-2가 **새 죽은 링크**를 하나 낳고 8c 단언이 그것을 전건 통과시켰을 자리다(R29·R32와 같은 계열이 그 계열을 닫은 라운드에서 재발). 확정 동작은 `closeHistory()` → 항목 선택 → 설정 폼 첫 입력 포커스이고, 8c 단언도 존재가 아니라 **동작**을 본다(§1.8 부록).
- (+) **검증 자산이 잎사귀에서 부류로 올라갔다**(합의 5차 · 8a-5). 3차(종목 표시) → 4차(확정 버튼) → 5차(도달성·`note`·라벨 등호)로 같은 계열의 결함이 **라운드당 하나씩 사람 검토로만** 발견돼 왔다. 도달성 단언(kind 3종)과 필드 합집합 등호는 개별 결함이 아니라 **계열**을 막는다. 대가는 테스트·프로브 3~4건과 06 보드가 진입로를 그려야 한다는 것이며, 라운드당 사람 검토 1건보다 싸다.
- (−) 그러나 **부류 단언만으로는 카탈로그 결손을 못 잡는다**는 것을 명시해 둔다 — 도달성은 진입로만, 합집합 등호는 라벨만 본다. 그래서 결정 e-1이 계약 자체를 없앴고 ②-1 ⑥·V15가 사본 0을 따로 단언한다.
- (+) **조용한 데이터 손상 3건째를 착수 전에 막았다** — 편집 시 만료 리셋(R22) · 가드 저장 시 브리핑 상한 복귀(R23)에 이어 **편집 후 `note`가 옛 술어로 남는 것**(R30). 셋 다 "저장은 성공했다고 보고하는데 화면(그리고 이번엔 모델)이 옛 값을 말한다"는 같은 부류이고, 이번 건은 **이 계획의 신규 엔드포인트가 원인**이었다.
- (−) **`GET /{id}` 응답이 `_view`보다 좁다**(R33). `last_fired_at`·`unread`·`missed`·`next_fire_at`을 내지 않으므로 나중에 다른 소비자가 이 응답을 목록 갱신에 재사용하면 그 필드들이 없다 — 의도한 제약이며 ②-9b ①이 키 집합 등호로 고정한다. 넓게 두면 예약 루틴에서 `missed`가 항상 참이 되어(`routines.py:79-80`) **409를 부르는 거짓 활성 버튼**이 생겼을 자리다.

**Follow-ups (이 계획 밖)**
1. **같은 모드 창 동시 상주(세션)** — 유일하게 미소유인 기반 조각. ⚠ **합의 3차 범위 축소:** 2차가 함께 묶었던 **펜 시트(화면 38)는 origin에 이미 착륙했고**(`sidebar-project-menu.js` `MODE_CHOICES` · `sidebar.js ≈:333·349·901` · `session-persistence-spec.md:182` `[x]`), `mode==='agent'` 대화 **레코드** 다건도 이미 만들어진다(`conversations.js touch()`). 남은 것은 `session-persistence-spec.md:130`의 "상주 채팅 세션은 프로세스 전역 하나"뿐이며, `:89-93`이 그 소유자를 **Athena 데몬**(화면 39·43, 미착수)으로 지목한다. 별도 계획이 필요하다.
2. `symbol`·`source` 편집(구독 재등록 포함) — 필요해지면 `runtime.ensure/release` 왕복을 설계한 뒤.
3. `미리보기 실행`(dry-run) 백엔드 엔드포인트 — 현재 `app/chat.js`의 `const preview = _btn('미리보기 실행'` 바로 다음 줄에서 `preview.disabled = true`로 정직하게 비활성(`≈:3016-3017`, 이름 앵커 — 머리말 철회 3).
4. 라이브 컬럼 진행바·"다음 24시간" 타임라인 실데이터 배선(`PAPER_DESIGN_AUDIT.md:357`).
5. `npm run verify` 전체 하네스의 rAF 대기 타임아웃(`PAPER_APP_PARITY.md`의 rAF 행업 기록, origin `≈:383~`).
6. 사이드바 대화 목록 `오늘/어제` → `프로젝트 · 최근` 전환(페이지 가로지르는 별도 패스).
7. **`feat/agent-dual-control` 브랜치의 통합** — 이 계획은 병합하지 않는다(사용자 확정 1). 카드 트랙·backtest 트랙과의 통합 순서는 별도 결정이 필요하다.
8. **채택/보류 영속** — 백엔드에 기록 엔드포인트가 없어 보류가 렌더러 로컬이다(open-questions #4). 영속이 필요하면 계약 추가가 선행돼야 한다.
9. **예약(schedule) 루틴의 드릴인 이력 배선**(합의 5차 분리) — 결정 f-2는 **설정 편집**만 상세 패널로 옮겼고, 드릴인 `전체 이력 보기 →` 자체는 여전히 감시 전용이다. `agent-canvas.js:1533-1535` 주석이 *"schedule도 3단계부터 실제 라우틴이라 ledger에 대응 행이 생길 수 있지만 … 다음 스코프로 이연"*이라 스스로 이연을 기록해 뒀다. 이 계획은 그 이연을 **바꾸지 않는다**(범위 밖) — 다만 그 결과 예약 루틴의 실행 이력이 GUI에서 안 보인다는 사실은 화면에 정직하게 남는다.
10. **레거시 소스 루틴의 마이그레이션 경로** — 현재는 편집 시 409 + `지원하지 않는 조건 — 취소 후 새로 만들기`가 유일한 출구다(R28). 사전 저장 데이터가 실제로 존재하면 일괄 취소·재생성 도구가 필요할 수 있다.

---

## 8. 변경 이력 — 합의 2차 (2026-09-03)

> ⚠ **이 절은 2차 시점의 기록이며, 아래 §9(합의 3차)가 일부 항목을 정정했다.** 특히 이 절이 인용한 좌표 중 `probe-agent-paper-parity.js:19-20`(→ `:17-18`) · `guard_settings.py:40-42`(→ `:41-42`) · `sidebar.js:786-791`(→ origin `≈:1109`) · `PAPER_APP_PARITY.md:203`(→ **origin에 없음**)은 3차에 정정됐다. **실행 지시로 읽지 말 것** — 실행 지시는 §1~§7이 소유한다.

Architect 1차 REVISE + Critic REJECT 판정을 반영한 개정이다. 뼈대 결정 **a-1 · a′-1 · b-1 · c-1은 유지**하되, 사실이 틀린 근거·폐기된 절차·검증 불가 기준을 고쳤다. 새 하위 결정 **a″-1**이 추가됐다.

### 치명 (계획이 그대로는 실행되지 않던 항목)

| # | 무엇을 | 왜 |
|---|---|---|
| 1 | **Step 0을 병합 게이트 → worktree 절차로 전면 재작성**(0a 생성·`EnterWorktree` 진입·3건 충족 기준 / 0b `.omc` 이관 / 0c 헌장 이관·첫 커밋 / 0d `npm ci`+`uv sync` / 0e 전 앵커 재측정 / 0f Paper 사전 확인) | 초안 0a는 "병합을 사용자에게 넘긴다"였다. 사용자가 이미 답한 질문(worktree, 병합 없음)이라 ralph가 첫 Step에서 헛물을 켠다 |
| 2 | **R13(병합 충돌 6파일) 삭제, R10 강등, R4 재작성** | worktree 결정으로 **발생하지 않는 사건**이 됐다. 존재하지 않는 리스크의 완화 절차는 헛돈다 |
| 3 | **커밋 수·origin SHA를 문서 전역에서 제거**(머리말·D-3·b-1·R4·ADR Drivers 3) | 실측 `git rev-list --count HEAD..origin/main` = **55**, tip = `3f35c1b`. 초안 37·Architect 39 모두 이미 낡았고 origin은 실행 중에도 움직인다. 숫자 대신 "Step 0a 시점 tip" 변수를 쓴다 |
| 4 | **`.omc/`·헌장·의존성 이관을 Step 0의 첫 순서로 신설**(R17·R16 신설) | `.gitignore:9`(`.omc/`)·`:20-21`(`node_modules/`·`.venv/`) 실측. 헌장은 미추적이며 origin에도 없다. 셋이 없으면 근거 문서 부재 + 테스트 실행 불가로 베이스라인이 안 선다 |
| 5 | **Step 9를 🛑 사람 정지점 ②로 명시 + Step 8e 자동 하네스 신설**(`verify:agent-dual-control-live`) | 9c는 GUI 16행 × 2경로를 손으로 클릭해야 하고 기존 프로브는 `ATHENA_NO_AUTOSTART=1`·`ATHENA_CANVAS_SOURCE='fixture'`(`probe-agent-paper-parity.js:19-20`)라 대체 불가. 표기 없이 두면 무한 재시도나 허위 보고가 난다(R19 신설) |

### 높음

| # | 무엇을 | 왜 |
|---|---|---|
| 6 | **하위 결정 a″ 신설** — GUI 시트 제출·채택을 `seedChatInput` → **전용 IPC `athena:routine-draft`**로 변경. 옵션 3개 표로 정당화 | `seedChatInput`은 렌더러 로컬 버스(`app/canvas.js ≈:2129`)라 IPC가 아니다. 폼 값을 문장으로 재직렬화하면 모델이 다시 파싱해 **GUI 경로가 비결정적**이 되고, 스펙:173 "GUI도 모든 제어" 실질 미달 + 라이브 증거 오염(R20 신설) |
| 7 | **ADR·§1.3의 "물리적으로 같은 함수 / 파리티가 구조로 보장" 삭제 → 결합 단언(8a-2) 신설** | 실측 반증: `chat.js ≈:3025`와 `canvas.js ≈:2975·2980`이 각자 `invoke`를 부른다. 공유는 preload 허용목록 + main 핸들러뿐. "구조로 보장"을 믿으면 결합 테스트를 안 써서 회귀를 못 잡는다 |
| 8 | **§1.3 칩 근거를 "표면 위치" → "신뢰 경계" 3단 논증으로 교체** + 확정 칩 `autofocus` 융합안 | 칩은 결국 `chat.js`가 그리는 DOM 버튼이라 위치 논증은 "채팅 GUI vs 캔버스 GUI"일 뿐이다. 검증 가능한 근거는 "모델 도달 표면의 쓰기 경로 0 + preload 허용목록" |
| 9 | **Step 0e 앵커 표 전면 재작성** — 머리말의 "전 앵커 f880d79 실측" 주장 철회, `server.py`·`conversations.js` 2파일 추가, `routine-approval-actions`는 **감싸는 함수명**, `INVOKE/ON_CHANNELS`는 **인접 채널 문자열** | 초안 preload 행 `:44`·`:248`이 선언(`:3`·`:224`)이 아니라 삽입 구역이었다. `routine-approval-actions`는 origin에 **7곳**(backtest 트랙이 2곳 추가). 누락 2파일은 `git diff --stat`이 `+14`·`+132`로 보고 |
| 10 | **Step 6을 6-A(문구 무관 병행) / 6-B(승인 후 문자열)로 분할** | 6a의 `rationale`·`notice`가 사용자 노출 문자열이라 "Step 6 전체가 문구 무관"이 틀렸다. 분할선은 *enum 식별자 vs 노출 문자열* — enum은 채널명·REST 동사에서 오지 한국어 문구에서 오지 않는다 |
| 11 | **open-questions #3을 Step 5 U-1 확인 항목으로 승격 + `종목·소스는 취소 후 새로 만들기` 안내를 06 보드·설정 패널 실제 문구로 삽입** | 사용자 확정 4. 초안은 "검수에서 함께 판단 가능하다"였을 뿐 확인 항목이 아니었고, 대안 문구는 open-questions에만 있었다 |
| 12 | **Step 9c 1·9행 기대 상태 정정**(제출 직후 `status='draft'` → 확정 후 `active`) | a″-1 채택으로 GUI 경로 단독 상태 변화가 실제로 성립한다. 초안대로 `seedChatInput`이면 `routines[] +1`은 대화 경로의 결과라 증거가 오염됐다(P3) |

### 중간

| # | 무엇을 | 왜 |
|---|---|---|
| 13 | **AC ②-1을 "11동작 전부 같은 IPC" → "IPC 경유 10 + 비-IPC 1(보류)"로 정정** | 초안은 자기 Step 7b와 모순. Architect의 "9동작", Critic의 "8동작"도 a″-1 채택 후에는 맞지 않는다 — 최종은 **10/1** |
| 14 | **AC ①-5 입력 4개 → 5개**(조용 시간 start/end 2입력), `max_daily_briefings` 제외 명시 | `guard_settings.py:40-42`의 `QuietHours.start`/`.end`가 별도 필드. 4로 두면 AC가 구조적으로 실패 |
| 15 | **AC ①-7 정합** — 편집 입력 **6개** + 읽기 전용 상태 표기 2건, `조건`을 op/value/consecutive_ticks 3필드로 분해 | 초안은 `조건`을 텍스트 1칸으로 그려 실행자가 파서를 발명하게 만들었다. `rules.py:32 _ALLOWED_CONDITION_KEYS`가 공통 원본이 되게 REST 허용 목록과 문자 그대로 맞췄다 |
| 16 | **AC ①-10 문구 3원칙에 조작적 정의 부여**(정규식 3종) | "설명 문장 0건"이 육안 판정이라 게이트가 될 수 없었다 |
| 17 | **Step 6c에 옵션 3개 표 추가 + `active` 술어 반영 검증 + `TriggerState` 초기화 신설**(R21) | 신규 REST는 계약 확장인데 대안 검토가 0이었다. 술어 반영은 실측으로 확인됐고(`scheduler.py:266-268` 틱마다 재조회) **409로 막을 필요 없음**이 밝혀졌으나, `triggers.py:64-80`의 누적 상태가 남는 별개 결함을 찾았다 |
| 18 | **R8 완화에 대상 집합 필터 명문화 + Step 8a-3 "비-루틴 방 ack 0회" 단언 신설** | `sidebar.js:786-791`의 `markAllRead`가 notifyRooms를 무조건 순회한다. 그 무조건성을 IPC로 옮기면 404 오염 또는 타 모드 침범(스펙 Constraints:54) |
| 19 | **AC ③-3 증거 형식을 행별로 분기**(서버 변화 11행 = JSON diff / 무변화 5행 = 렌더러 상태 덤프 + 스크린샷) | 빈 diff는 "동작 안 함"과 "서버에 안 남음"을 구분하지 못한다 — 증거 없는 통과 판정은 P3 위반 |
| 20 | **V10 가짜완료 grep에 신설 테스트 3파일 + 하네스 1파일 추가, 파이썬 skip/xfail 검사 추가** | Step 8a 매트릭스가 28건이라 스텁·skip이 가장 나기 쉬운 자리인데 게이트가 구현 3파일만 봤다 |
| 21 | **a′ 표에 Cons 열 신설** | `옵션/모양/판단` 3열이라 채택안의 단점을 적을 자리가 없었다 — 편향된 표 |
| 22 | **`_CONTROL_ACTIONS` 11종 = 스펙 10종 + `ack_all` 명시**(§1.3 · §2) | 미표기 상태로는 "조용한 확장"으로 읽힌다(사용자 확정 4의 범위 고정) |

### 낮음

| # | 무엇을 | 왜 |
|---|---|---|
| 23 | **07·08 보드 문구 4건을 명사구로 교체** — `바로 이동했습니다`→`이동함`, `보류했습니다 — 목록에 남습니다`→`보류 — 목록 유지`, `쿨다운 600초 — 반영됐습니다`→`쿨다운 600초 반영`, `이미 발화 처리된 예약입니다`→`이미 발화된 예약` | 계획이 직접 쓴 문구가 P5 "설명문 금지"를 위반했다. 검수에서 사용자가 잡을 항목을 계획이 미리 만들어 넣는 셈 |
| 24 | **인용 좌표 4건 정정** — `nudge_guard_tools.py:44`→**`:39`**, `models.py:230-232`→**`:229-230`**, `agent-canvas.js:1040`→**`:1039`**, `routines.py:139-140`→**`:140-141`** | 전부 실측 확인. 차이 0 파일이라 재확인 대상이 아니어서 실행 시 그대로 쓰인다 — Edit `old_string` 실패로 이어진다 |
| 25 | **R2b(빈 스크린샷 = 미마운트) 신설 + Step 0f에 `open_file(A-2 pageId)` 추가** | R2가 대비한 *검은* 화면(높이 붕괴)과 다른 실패 모드다. `PAPER_APP_PARITY.md:203`이 실측 처방을 기록해 뒀다 |
| 26 | **§6.4·§6.3 갱신, Follow-ups에 브랜치 통합·보류 영속 2건 추가** | open-questions #1이 닫혔고 #2~#5가 Step 5 U-1~U-4로 승격된 상태를 반영 |

### 반영하지 않은 지적

- **Architect F1의 "39커밋으로 갱신"** — 반영하지 않는다. 실측이 55이고 origin은 계속 움직이므로 **어떤 숫자도 박지 않는 것**이 옳은 정정이다(Critic의 disputed 1번에 동의).
- **Architect B의 6-A/6-B 분할선**(enum이 07 보드 A~E 열에서 유래하므로 검수 후로) — 경계를 달리 잡았다. enum **식별자**는 IPC 채널명·REST 동사에서 오지 한국어 문구에서 오지 않는다. 검수에 실제로 묶이는 것은 `notice`/`rationale`과 카드 모델의 노출 문자열이므로 분할선을 그쪽에 그었다(Critic의 disputed 7번과 같은 판단).
- **Critic의 "IPC 경유는 8동작"** — 수치로는 반영하지 않았다. 결함의 원인(GUI 경로의 비결정성)을 a″-1로 제거했기 때문에 최종값이 **10동작**이 됐다. 단순 수치 정정으로 끝낼 문제가 아니라는 Critic의 지적 자체는 그대로 수용했다.

---

## 9. 변경 이력 — 합의 3차 (2026-09-03)

> ⚠ **이 절은 3차 시점의 기록이며, 아래 §10(합의 4차)이 일부 항목을 정정했다.** 특히 이 절이 확정으로 적은 **커밋 수 `55`**(실행 시점마다 다르다 — 재검증 시 **57**), **사용자 노출 문자열로서의 입력 개수 서술**, `chat.js:2591-2593`·`:2595-2620`(로컬 HEAD 좌표 — 머리말 철회 3)는 4차에 정정됐다. **실행 지시로 읽지 말 것** — 실행 지시는 §1~§7이 소유한다.

Architect 2차 **REVISE** + Critic 2차 **REJECT** 판정을 반영한 개정이다. 뼈대 결정 **a-1 · a′-1 · a″-1 · b-1 · c-1은 유지**한다 — 두 검토자 모두 방향은 인용했고, 고쳐야 할 것은 뼈대가 아니라 **뼈대가 자기 검증을 통과한다고 주장하던 지점들**이었다. 이 절의 모든 정정 근거는 `origin/main`에서 직접 재확인했다(`git show origin/main:<path>`).

### 치명 — 계획이 그대로는 실행되지 않거나 조용히 데이터를 망가뜨리던 항목

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 1 | **`_CONTROL_ACTIONS`에 `update` 추가(11 → 12종)** + Step 8a 표의 A-설정편집을 `chipToIpc('confirm')` → **`chipToIpc('update') === 'athena:routine-update'`**로 정정. 출처를 §1.3 표·§2에 명문화 | 2차의 8a 표대로 구현하면 07 A열 칩 `이렇게 바꿔줘`(본문 `쿨다운 300초 → 600초`)가 `POST /{id}/confirm`을 부른다. 실측 `backend/athena_api/api/routines.py:211-229` — 그것은 `can_activate` 검사 + `ensure_realtime_subscription` + `store.transition(id,'active')`이지 **패치 적용이 아니다.** 버튼이 자기 글자와 다른 일을 한다(P3). §2 A행이 `athena:routine-update`를 "신설"로 적어 놓고도 enum에 대응 control을 넣지 않은 것이 원인 |
| 2 | **Step 8a-2를 단언 1개 → 2개로**(발산 단언 + **완전성 단언**). `DUAL_PATH_TABLE`의 유령 이름 `draft` 제거 | 2차의 테이블 대상 "A(confirm·pause·resume·cancel·**draft**) … 10 control"의 `draft`는 `_CONTROL_ACTIONS`에 **없는 이름**이다(`draft`는 최상위 `action` 값). 계획의 핵심 안전장치(ADR Why-chosen 3 "파리티는 결합 단언이 지킨다")가 **설계 시점에 이미 무효**였다. 완전성 단언(`_CONTROL_ACTIONS` 전 항목이 IPC 또는 명시적 `null`로 덮인다)이 유령·누락을 테스트 이전에 드러낸다 |
| 3 | **Step 6-A c에 `expires_at` 복원 규칙 신설**(R22). 복원 목록 + "본문에 `expires_days`가 온 경우에만 재계산" 2규칙. ②-9 7 → **9 케이스** | 조용한 데이터 손상. `RoutineSpec.to_dict()`(`models.py:181-196`)는 `expires_at`을 내고 `expires_days`를 **내지 않는데**, `validate_draft`는 `expires_days = raw.get("expires_days", 7)`(`rules.py:126`) → `expires_at = now + timedelta(days=expires_days)`(`:162`)로 계산한다. 2차 구현 지시대로면 **쿨다운만 고쳐도 만료가 now+7일로 밀리고 화면은 성공으로 보고**한다 |
| 4 | **Step 0a~0c 실행 순서·경로 전면 정정** — 복사를 `EnterWorktree` **앞으로** 옮기고 전 경로를 절대 경로로. 진입은 신설 **0c-2**에서 1회. `git worktree prune` 선행 추가 | ralph 무인 실행의 **첫 세 명령이 죽던** 자리다. 2차는 0a에서 cwd를 worktree로 옮긴 뒤 0b가 `cp .omc/plans/*.md .claude/worktrees/…`를 **메인 기준 상대 경로**로 실행하게 적었는데, worktree에는 `.omc/`도(gitignore) 중첩 `.claude/worktrees/`도 없어 **원본이 존재하지 않는다.** R17이 완화하겠다고 적은 항목의 완화 절차 자체가 실행 불가였다 |
| 5 | **06 설정 폼·05 시트·7a 패널·6c REST를 소스별 계약으로 분기.** AC ①-7을 "입력 정확히 6개" → **집합 동일성**(폼 필드 == 화이트리스트 8필드 ∩ 소스별 유효 필드)으로 교체. `SOURCES` 6종 테이블 구동 테스트 신설 | 실측 `models.py:22-25,43-52` — `SOURCES`는 세 갈래다: number/`_NUM_OPS=("<","<=",">",">=")`(**`==` 없음**) · `vi.triggered` bool/`_EQ_OPS=("==",)` · `schedule.daily` string/`_AT_OPS=("at",)`. 2차가 적은 선택지 `>=·<=·>·<·==`는 **어떤 단일 소스와도 맞지 않고**, 숫자 소스의 `==`는 죽은 선택지가 아니라 **422를 부르는 거짓 선택지**(P3)다. `rules.py:100-101`이 `consecutive_ticks>1`을 ws 전용으로 422시킨다. Step 9b가 `schedule.daily` 루틴을 심고 15행(catchup-fire)이 `mode='scheduled'`를 요구하므로(`routines.py:290-306`) **라이브 시연이 이 모순을 정면으로 만난다** |

### 높음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 6 | **§1.4 기반 조각 표 4행을 코드 실측으로 재작성** — "펜 시트 미소유"를 **철회**하고 `펜 시트: 착륙 완료` / `mode==='agent'` 대화 레코드 다건: 이미 가능 / `동시 상주 세션: 미소유` 3행으로 분리. R15·②-5·Follow-ups 1·ADR Consequences에 전파 | 2차 근거였던 "`session-persistence-spec.md` 전문에 `펜` 없음"이 **거짓**이다: 그 스펙 `:182`에 `- [x] sidebar.js — … 펜 = 모드 골라 새 대화창. 순수 규칙은 sidebar-project-menu.js`가 **완료 표기로** 있고, origin에 `app/lib/sidebar-project-menu.js`(+73/-0)가 실재하며 `MODE_CHOICES`(`≈:18-24`)에 `{mode:'agent', view:'agent'}`가 있다. **R4가 경고한 실패 모드("부재를 근거로 스텁을 만들기 시작")를 계획 자신이 마지막 한 조각에서 범했다** — 나머지 3조각은 코드를 직접 열어 확인했는데 4번째만 스펙 문서를 낱말로 grep했다 |
| 7 | **`getAgentConsoleSessionId()`를 "최신 1건" → "활성 대화가 에이전트면 그 id, 아니면 null"로 재정의.** ②-5 ③을 "관제 창은 하나 전제가 유효하다" → **"활성 대화가 에이전트가 아니면 null"**이라는 반증 가능한 단언으로 교체 | `conversations.js function touch`(origin `≈:198`)가 `mode: requestedMode` 행을 개수 제한 없이 `push`한다(`≈:213-221`). 즉 `mode==='agent'` 대화 2건 이상은 **지금 당장 만들 수 있으므로** 2차의 단언은 첫 실행에서 **거짓을 테스트로 고정**했고, "최신 1건"은 사용자가 보고 있지 않은 과거 관제 대화를 고를 수 있었다(P3) |
| 8 | **`agent-session.js`를 프로덕션 경로에 연결**(Step 7d 두 지점 + `shouldRenderProposal` 신설 + Step 8a-4 단언 + V11 grep 게이트). R24 신설 | 2차는 어댑터를 신설(6f)하고 단위 테스트(②-5)까지 요구하면서 **호출부를 0개** 두었다. 소비자 없는 모듈은 CLAUDE.md §2 위반이고, 더 중요하게 **스펙 Constraints:54(타 모드 불간섭)를 코드로 강제하는 것이 하나도 없었다** — 선례 포워더 3개는 모드를 보지 않고 `shellWin`에 무조건 send하므로(origin `main.js:2300-2314`) 동형인 4번째를 얹으면 백테스트·그래프 대화에도 제어 제안 카드가 뜬다 |
| 9 | **가드 저장의 `max_daily_briefings` 왕복 보존 명문화**(①-5·Step 7b·②-1·R23). 2차의 "기본값으로 동작한다"는 **거짓 사실 주장**으로 철회 | `POST /api/v1/nudge-guard`는 **전체 교체**다(`nudge_guard.py:24-28` — `validate_guard_settings(body)` 결과로 `store.replace`). `guard_settings.py:110`이 결측 시 `max_daily_briefings`를 **10으로 되돌린다.** 사용자가 5로 낮춰 뒀다면 조용 시간만 고쳐도 10으로 되살아나고(P3), 9c 11행 diff에 아무도 만지지 않은 필드가 나타나 **증거가 오염**된다 |
| 10 | **Step 7a 가드 패널 "입력 4개" → "입력 정확히 5개"** | AC ①-5·Step 2 04보드는 둘 다 "정확히 5개"로 확정했고 2차 §8 변경 14번이 그 정정을 기록했는데 **Step 7a만 4개로 남았다.** 4개짜리 폼은 조용 시간을 범위 컨트롤로 만들어 `QuietHours.start`/`.end`(`guard_settings.py:41-42`) 왕복 계약이 어긋난다 |
| 11 | **Step 6-A를 물리적으로 Step 5 앞으로 이동**(§4 머리말에 실행 순서 표 신설, Step 5 선행 조건에 "6-A 검증 통과"). §1.5·①-11의 "병행" 서술 정정 | ralph는 순차 executor이고 §4 머리말이 순차성을 못 박았으므로 **Step 5에서 멈추면 6-A에 도달하지 못한다.** c-1이 이득으로 내건 "게이트 대기 중 문구-무관 작업을 앞당긴다"가 배치 때문에 무효였다 — 순차 실행자에게 **배치 순서가 곧 병행 여부**다. 번호는 교차 참조 30곳 이상을 보존하려고 `6-A`로 유지했다 |
| 12 | **06 폼에 `만료(일)`·`설명` 2필드 추가.** 6c의 "(06 보드 폼 6필드와 문자 그대로 일치)" 문장 철회 | 두 집합이 **8 대 6**으로 달랐다 — `note`·`expires_days`가 REST로는 편집 가능한데 GUI에 없었고, 05 `＋ 새 작업` 시트에는 **있어서** 생성/편집 비대칭이었다(D2 실질 미달). 인용한 `rules.py:32 _ALLOWED_CONDITION_KEYS`는 `condition` 하위 4키만 정의해 **근거와 주장이 층을 달리했다.** `validate_draft`가 `note` 200자·`expires_days` 1~`MAX_EXPIRY.days`를 이미 검증하므로 폼에 넣는 쪽을 택했다. 치명 3(만료 리셋)의 원인 제공자이기도 하다 |

### 중간

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 13 | **Step 6-A d의 "`routineHttp`는 body 없음 전제 → `fetch` 직접 호출" 철회.** `athena:routine-update`·`routine-draft` 둘 다 `routineHttp('POST', path, body)` | 사실 오인이다. origin `app/main.js:1192`의 시그니처는 `async function routineHttp(method, path, jsonBody, { signal } = {})`이고 `:1194-1197`이 이미 body를 붙인다(`:714-722`가 실제로 payload를 실어 부른다). 2차가 근거로 삼은 것은 **`main.js:1289-1291`의 낡은 주석**이다. `fetch` 복제는 `{ok,status,error}` 응답 모양과 `body.detail` 번역을 갈라 6c-1의 422/404/409가 렌더러에 온전히 닿지 못하게 한다(P4) |
| 14 | **머리말 이동 파일 목록·Step 0e 앵커 표에 `app/lib/sidebar.js` 추가**(7파일 → **8파일**), 인용 4건 좌표 정정 | 실측 `+352/-28`인데 이동 목록에도 "차이 0" 목록에도 없어 **실행자가 그 좌표를 유효한 것으로 읽었다**(R14가 예측한 Edit `old_string` 실패 지점). 정정: `markAllRead` `:786-791`→**`≈1109`** · `handleRoutineEvent` `:488-510`→**`≈807`** · `hydrateNotifyRooms` `:540~`→**`≈863`** · engagement `:531-533`→**`≈854`**. 인용 **내용**은 전부 사실이었고 틀린 것은 좌표뿐이다 |
| 15 | **`PAPER_APP_PARITY.md` 인용 전면 재작성**(머리말 철회 2 · ②-13 · Step 0e · Step 8d · R2b · R12 · Step 1 주의 · Follow-ups 5) | 2차 인용은 **미커밋 작업본**에서 읽혔다. origin 파일은 **384줄**(작업본 439)이라 `:414`·`:425-427`·`:434-440`은 **존재하지 않고**, R2b·Step 0f·①-12의 유일한 근거였던 `:203 open_file` 처방은 origin에 **0건**이다. worktree는 `origin/main`에서 갈라지므로 그 문장이 **실행 시점에 없다.** 좌표는 이름 앵커로 바꾸고, `open_file` 근거는 Paper MCP 서버 지침 + 세션 메모리로 교체했다(조치는 유지) |
| 16 | **Step 8c 프로브 단언 `inputCount >= 4` 폐기 → 집합 동일성** | 최종 게이트가 AC ①-7보다 느슨하면 **AC가 실질적으로 강제되지 않는다**(5개짜리 폼도 통과). 교체 대상인 origin `probe-agent-paper-parity.js:269`조차 `inputCount === 0`으로 등호를 썼다 |
| 17 | **05 시트 `종목`을 6자리 종목코드 계약으로 명시** | `rules.py:33 _SYMBOL_RE`(6자리 숫자), 검사 `:116-117`. 자유 텍스트로 그리면 사용자가 `삼성전자`를 넣고 **422**를 받는다 — a″-1이 얻은 "결정적 GUI 경로"를 첫 필드에서 잃고 R20이 막으려던 결과가 다른 경로로 재발한다. 9c 1행 GUI 경로가 `routines[] +1`을 만들려면 이 필드가 계약을 만나야 한다 |
| 18 | **Step 9b에 예약/감시 두 루틴의 조건 계약 표 신설** | 15행(catchup-fire)이 `mode='scheduled'`를 요구하고 2행(설정 편집)이 같은 루틴의 설정 탭을 여는데, 2차 폼 명세로는 그 조합이 **반드시 422**였다. 소스별 분기(치명 5)가 닫는 충돌을 시연 데이터 준비 단계에서 미리 못 박는다 |
| 19 | **R22·R23·R24 신설, R15 재작성, R14 확장, R12 근거 교체** | 실측으로 확인된 리스크 3건(만료 리셋·가드 상한 복귀·타 모드 침범)이 2차 표에 **아예 없었다.** 계획이 R21에서 같은 부류를 "조용한 결함"이라 이름 붙여 놓고 세 건을 놓쳤다 |
| 20 | **V0a2·V11·V12 신설, V0/V0b에 순서 표기, V4 11→12 파라미터, V5 7→9 케이스** | 게이트가 새 계약(어댑터 연결·완전성 단언·만료 보존·진입 순서)을 실제로 강제하게 맞췄다 |

### 낮음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 21 | **Step 2 색 규율의 자기모순 해소** — hex `#626B76`·`#5B6270` 지정을 지우고 토큰명(`--color-k-faint`/`--color-k-dim`)만 남김. Step 0f에 `get_tokens` 실재 확인 + 예외 명문화 절차 신설 | 같은 문단이 "하드코딩 hex 금지"라 적고 바로 다음 문장에서 hex 두 개를 지정해, AC ①-10의 `하드코딩 hex 0` 검사가 **게이트가 계획 자신을 반려**하게 만들었다. ralph가 그 지점에서 "규율을 어길 것인가 AC를 어길 것인가"를 기록 없이 결정하게 된다(P3) |
| 22 | **실측 딱지가 붙은 좌표 6건 정정** — `.gitignore:20-21`→**`:18-19`**(`:20-21`은 `__pycache__/`·`*.pyc`) · `main.js` `athena:routine-ack` `≈1248`→**`≈1266`** · `chat.js` `canvasMode` `:1288`→**`≈1315`** · `triggers.py` `_state()` `setdefault` `:79-80`→**`:81-83`** · `probe-agent-paper-parity.js` env `:19-20`→**`:17-18`** · `rules.py _SYMBOL_RE` 정의 **`:33`**/검사 **`:116-117`** | 전부 "실측"이라 명시된 인용이다. 2차의 성취가 "숫자를 박지 않거나 박으면 맞게 박는다"였으므로 실측 딱지가 틀리면 나머지 실측 주장의 신뢰도가 함께 떨어진다. 특히 probe·triggers는 **"차이 0이라 재측정 불필요" 범주**라 실행자가 검증 없이 쓴다 |
| 23 | **Step 0a의 worktree 관례 근거를 사실로 정정 + `git worktree prune` 추가** | `git worktree list`에 등록된 것은 메인과 **`C:/Projects/DAOU.Athena-plugin`(형제 디렉터리)** 둘뿐이고, 2차가 "관례가 확립된 위치"의 근거로 든 `.claude/worktrees/kiummi-full-audit-f99978`은 git이 추적하지 않는 **잔존 디렉터리**다. 경로는 사용자 확정 1이 지정했으므로 유지하되, 잔존 항목이 `git worktree add`를 방해하지 않게 prune 1회를 넣었다 |
| 24 | **6c `condition.source` 422 근거 보강** — "실시간 구독 정체성" → `derive_mode`가 `source → transport → mode`를 결정론적으로 유도하므로 **루틴의 종류 자체가 바뀐다**(`models.py:101-104`) | 결함이 아니라 **U-1 승인 확률을 높이는 근거 보강**이다. 사용자 확정 4가 "조용한 축소로 두지 말라"고 한 만큼 설명의 질이 실제로 중요하다 |
| 25 | **§8(2차 이력)에 "정정됨 · 실행 지시 아님" 배너 추가** | 그 절이 인용한 좌표 4건이 3차에 정정됐는데 changelog는 삭제하지 않는 것이 원칙(결정의 역사를 지우지 않는다)이라, 실행자가 실행 지시로 오독하지 않도록 배너로 막았다 |

### 반영하지 않은 지적 · 판단이 갈린 지점

| 지적 | 판단 |
|---|---|
| **"39커밋으로 갱신하라"**(작업 지시 · Architect 1차) | **반영하지 않는다.** 실측 `git rev-list --count main..origin/main`이 **55**이고 origin은 실행 중에도 계속 움직인다(초안 37 → 39 → 55). 머리말 앵커 규율대로 **어떤 커밋 수도 박지 않는 것**이 옳은 정정이며, 기반은 "Step 0a 시점 tip"이라는 변수다. 브랜치를 딴 뒤에는 origin 이동이 이 계획에 영향을 주지 않는다(병합하지 않으므로) |
| **Architect: "`chipToIpc` 맵을 `agent-proposal.js`의 단일 frozen 상수로 두고 `canvas.js`가 조회하게 하면 파리티가 구조로 회복된다"** | **결함 지적은 채택, 처방은 미채택**(Critic의 disputed 1번과 같은 판단). 두 렌더러가 같은 상수를 **조회**하면 발산 단언 ①이 **항상 참인 무의미한 단언**이 되고, 완전성 단언 ②는 누락만 잡을 뿐 `athena:routine-pasue` 같은 **오타 발산은 통과시킨다.** 게다가 `agent-proposal.js`는 ADR이 "DOM·IPC 없는 순수 모듈"로 규정한 **대화 경로 소유 모듈**이라 GUI 배선이 런타임 참조하면 `shell.html` 로드 순서 의존이 생긴다. **두 단언을 함께 둔다** |
| **Architect: "다중 관제 대화는 이미 현재 사실이며 R15의 완화 시점이 어긋난다"** | **절반 채택.** `mode==='agent'` **레코드** 다건은 실측으로 확인했으나(치명 6·7), `session-persistence-spec.md:130`이 "상주 채팅 세션은 프로세스 전역 하나"라 **동시 상주 창은 지금도 하나**다. 그래서 조치를 "제거 조건 삭제"가 아니라 **함수 정의 교체 + 반증 가능한 단언**으로 좁혔다 |
| **Architect의 `rules.py:117 _SYMBOL_RE` 인용** | 좌표만 정정해 반영했다 — 정의는 **`:33`**, `:116-117`은 그 정규식을 쓰는 검사부다. 앵커 규율을 요구하는 검토에서 검토자 좌표도 같은 기준을 받는다 |
| **Critic: "Step 8e(신규 하네스)가 대안 검토 없이 도입됐다"** | 반영하지 않는다 — Critic 자신이 `fairAlternatives`에서 "기각 사유는 충분하므로 FAIL로 보지 않는다"고 판정했고, 근거(`probe-agent-paper-parity.js:17-18`의 env 고정)가 실측으로 성립한다 |
| **AC ①-10의 "겹침·잘림 0"이 여전히 육안** | 반영하지 않는다. `get_computed_styles`로 겹침을 기계 판정하려면 전 노드 박스 교차 계산이 필요해 비용이 조치의 가치를 넘는다. 나머지 3검사(hex·문구 정규식·32px)는 명령이 있고, 시각 판정은 **Step 5 사람 정지점의 고유 역할**이다 |

---

## 10. 변경 이력 — 합의 4차 (2026-09-03)

> ⚠ **이 절은 4차 시점의 기록이며, 아래 §11(합의 5차)이 일부 항목을 정정했다.** 특히 이 절이 `실측`으로 적은 좌표 중 **`routines.py:136`**(→ `:131`) · **`models.py:112-116`**(→ `:107-111`) · **`agent-canvas.js:265-268`류 프로브 좌표**(→ `:266-268`), 그리고 치명 1이 규정한 **"`_view` 필드 전부" 반환**(→ 반환 키 목록으로 좁힘)과 중간 5의 **"읽기 전용 3건 등호"**(→ 합집합 등호)는 5차에 정정됐다. **실행 지시로 읽지 말 것** — 실행 지시는 §1~§7이 소유한다.

Architect 3차 **REVISE** + Critic 3차 **REJECT** 판정을 반영한 개정이다. 뼈대 결정 **a-1 · a′-1 · a″-1 · b-1 · c-1은 유지**하고, **새 결정 (d)**가 추가됐다. 두 검토자가 재검증한 좌표·사실 주장 약 35건은 거의 전부 정확했으므로 이 개정이 고치는 것은 근거의 정확성이 아니라 **계획이 스스로 세운 기준을 자기가 통과하지 못하던 두 지점**이다 — 하나는 폼이 볼 수 없는 값을 편집 대상으로 선언한 것, 다른 하나는 화면 규칙이 약속한 버튼을 만들지 않은 것. 둘 다 P3다. 이 절의 모든 근거는 `origin/main`에서 직접 확인했다.

### 치명

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 1 | **결정 (d) 신설(§1.6) — 조건 원문 읽기 계약.** 옵션 3안 표(d-1 `_view` 확장 / **d-2 신규 `GET /{id}` 렌더러 전용** / d-3 `/runs` 동봉) → **d-2 채택**. Step 6-A에 **6c-2**(REST)·**6c-3**(IPC 계약) 신설, 6d·6e에 `athena:routine-detail` 배선, 7a·7b에 `fetchCondition(id)`, ②-9b(4케이스)·V5b·V14 신설, 8c 프로브에 "설정 탭이 그 채널을 1회 부른다" 단언 추가. 편집 허용 8필드를 **경로별로 쪼갬**(대화 공통 5 / GUI 공통 5 + 조건 3), ①-7·②-1을 경로별 집합 동일성으로 재진술, 6a `proposed` 허용 키 제한 + `test_propose_update_rejects_condition_keys` 신설, ②-6을 **`test_propose_only_reads_list`**(허용 path 집합 등호)로 강화 | 3차의 최대 정정(06 폼 소스별 분기)이 **읽기 계약 위에 서 있지 않았다.** `_view()`(`routines.py:111-142`)는 독스트링으로 *"조건 원문 dict 대신 사람이 읽는 해석문만 노출한다"*고 선언하며 `condition`을 통째로 빼고 `source_label`만 낸다. 단일 루틴 GET 라우트가 **없고**(라우터 12개 실측) `/runs`도 spec을 안 낸다(`:374-424`). 렌더러는 `item.raw`만 읽으며 심지어 `['조건', r.note]`로 `note`를 조건이라 라벨한다(`agent-canvas.js:996-1014`). 모델이 보는 것도 목록뿐이라 07 A열 제안 근거도 없었다. 즉 **두 경로 모두에서 구현 불가**였고, 실행자에게 남는 선택지는 빈 폼(P3)이거나 한국어 라벨 역추론 파서(R20 재발)뿐이었다 |
| 2 | **A-확정의 GUI 경로 신설.** Step 3-3 상세 패널 버튼 3 → **4개**(`확정` 추가, `status==='draft'` && `activation_blocker` 없음일 때만 활성), ①-6 "버튼 3개" → **4개**, Step 7a에 `confirmRoutine(id)` → `athena:routine-confirm` 행 + `agent-canvas.js:22-27` 계약 주석 갱신 지시, ②-1 **10 IPC → 11 IPC**(GUI 동작 11 → 12), 8a 매트릭스의 A-확정 칸을 GUI 단언으로 채움, 8a-2에 `confirm` 두 벌 대조 편입, 9c에 **`1b` 확정 전용 행** 신설 + 1·9행 GUI 경로를 캔버스에서 닫음, 8e 20 → **22 케이스**, R29 신설, V13 신설 | 계획 자신이 확정 문구로 못 박은 이중 제어 규칙 ③ `확정 — 채팅 칩으로도, **버튼으로도**`(Paper·앱·테스트·프로브의 단일 원본, R3)가 **약속한 버튼을 어느 Step도 만들지 않았다.** 그런데 그 규칙은 문자열 일치 단언과 프로브 3줄 원문 단언을 **전건 통과**시키므로 자동 게이트가 잡지 못한다 — 화면이 존재하지 않는 버튼을 약속한 채 출고됐을 자리다(P3). 게다가 9c 1·9행의 GUI 경로가 **채팅 확정 칩**으로 끝나 §1.3이 스스로 세운 D2 판정 단위(*"어느 쪽도 상대 표면을 방문하지 않는다"*)를 GUI 쪽이 깼고, 스펙:173·Constraints:57·Acceptance ③를 **조용히 축소**하면서 U-1~U-4 어디에도 올라가 있지 않았다(사용자 확정 4 위반). 구현 비용은 채널·핸들러·백엔드가 전부 이미 있어 **캔버스 호출자 1개**뿐이다 |

### 높음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 3 | **Step 9a·③-1의 백엔드 기동을 `npm start` 하나로 교체.** 수동 `uvicorn` 삭제, 기동 확인 3건(헬스 200 · 백테스트 모드 비-503 · brain 비-degraded) 신설, 인용 경로를 **`app/lib/main/backend-launcher.js`**로 명시, 8e 하네스에도 같은 주의 추가, R27 신설 | `buildBackendEnv`(`:28-58`)는 기본값 **5개**를 세팅하는데 3차 명령은 2개만 줬고, `decideAction`(`:60-64`)이 healthy면 `'already-running'`을 돌려주므로 **포트 충돌 없이 앱이 결손 백엔드에 조용히 붙는다.** 그 파일 주석이 결과를 실측으로 기록해 뒀다 — *"사이드바 다섯 번째 모드가 503(비활성)으로 죽어 있고 … 어느 프로세스가 먼저 8010을 잡느냐에 따라 켜졌다 꺼졌다 한다(2026-09-02 실측)"*. 하필 Step 9는 **R24·8a-4가 코드로 강제한 타 모드 불간섭을 눈으로 확인하는 유일한 자리**이고, `ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION` 결손은 brain을 degraded로 만들어 9c 9·11행의 C 묶음 시연 데이터를 비울 수 있다. ③-1의 기대 출력이 manifest 200뿐이라 게이트가 이 결손을 **탐지하지 못한 채 통과**시켰다 |
| 4 | **레거시 소스 루틴 처리 명문화.** Step 6-A c에 재검증 **전** 판정 → **409 + 전용 메시지**, 06 폼·설정 패널은 읽기 전용 + `이 작업은 취소 후 새로 만들기`, ②-9를 9 → **10 케이스**, ①-7·②-1의 유효성 근거를 `SOURCES` → **`source_spec()`**로 정합, R28 신설 | `source_spec()`가 `SOURCES` 미스 시 `LEGACY_DISABLED_SOURCES`로 폴백하므로(`models.py:112-116`) 저장된 레거시 루틴은 `_view`로 **멀쩡히 보이는데**, `validate_condition`(`rules.py:58-62`)은 그 source를 *"앱 플러그인 전용"*으로 거부한다. 6c의 `to_dict()` 병합 → `validate_draft()` 재검증 지시대로면 **쿨다운만 고쳐도 손대지 않은 `condition.source` 때문에 422**가 나고 메시지는 사용자에게 무의미하다. 3차가 열거한 422 사유는 금지 필드·쿨다운 범위 둘뿐이라 실행자도 테스트 작성자도 이 경로를 예상하지 못한다. 근거 층도 어긋나 있었다 — AC는 `SOURCES` 6종을 단정했는데 폼이 부르는 `source_spec`는 더 넓은 카탈로그를 본다 |

### 중간

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 5 | **①-7의 읽기 전용 표기 2건 → 3건(`종목`·`모드`·`소스`).** Step 3-2 필드 표에 `종목` 행 추가, Step 7a 설정 패널 갱신, 8c 프로브 라벨 화이트리스트 단언을 **부분집합 → 등호 2조각**으로 교체 | 6c가 `symbol` 변경을 422로 금지하고 Step 3-3·7a가 `종목·소스는 취소 후 새로 만들기`를 실제 문구로 넣으라 지시하므로 **종목은 편집 불가 필드로서 화면에 남아야** 논리가 닫힌다. 현 패널이 실제로 표시하고(`agent-canvas.js:1003`) 프로브 화이트리스트에도 `'종목'`이 있다(`:265-268`). "정확히 2건" 게이트는 올바른 구현을 반려하거나 종목 표시를 없애게 만들었다 — 3차가 Step 7a "입력 4개" vs ①-5 "5개"에서 잡아낸 것과 같은 부류의 내부 불일치 |
| 6 | **U-5 신설(조건 술어 편집 경로) + U-1의 대상을 스펙 문면에 정합.** U-1을 `종목`·`source` → **`source`(그리고 파생 `모드`)**로, 승인 판정을 4항목 → **5항목**으로, ①-11·정지점 표·V7·§6.3·§6.4 전파 | (a) 결정 (d)가 조건 술어를 GUI 전용으로 두는 것은 스펙 A 인벤토리(`조건·모드·소스·쿨다운·브리핑 모델`)에 대한 **대화 경로 부분 축소**인데 3차는 이것을 U 항목으로 올리지 않았다(사용자 확정 4). (b) 3차 U-1은 스펙 범위가 **아닌** `종목`을 승인받고 스펙 범위인 `모드`는 묻지 않았다 |
| 7 | **`만료(일)` 프리필 규칙 명문화**(Step 3-2) — 남은 일수 표시 + `만료 <날짜>` 보조 표기, **건드리지 않으면 payload에서 `expires_days` 제외**, ②-1에 렌더러 단언 ③ 추가 | `_view`도 신규 상세도 `expires_at`(절대 시각)만 주고 `expires_days`를 주지 않는다(`routines.py:129` vs `rules.py:126,162`). 3차는 12번 정정으로 `만료(일)`을 **폼에 넣었으므로** 규칙 없이 두면 GUI 저장이 **항상** R22 규칙 2를 타고(매 저장마다 now 기준 재앵커 → 절삭 드리프트) 규칙 1(보존)은 REST 직접 호출에서만 도달한다 — ②-9의 두 케이스가 REST 단위 테스트라 이 비대칭을 잡지 못했다. 빈 칸으로 두는 다른 분기는 R22가 막으려던 조용한 손상 그 자체다 |
| 8 | **`app/chat.js` 하드 좌표 2건을 이름 앵커로 교체**(P3 근거행 · Follow-ups 3 · R5) + Step 0e `chat.js` 행에 **`const preview = _btn('미리보기 실행'`·`const activate = _btn('바로 활성화'`·`function renderApprovalCard(`** 편입. 머리말 **철회 3** 신설 | `chat.js`는 머리말이 스스로 "이동 8파일"로 지정한 파일인데 이 둘만 `≈` 없는 확정 좌표로 남았고 값이 **로컬 HEAD와 정확히 일치**했다(origin은 `≈:3016`·`≈:3020`, 확정 칩 블록 `≈:3010-3040`). 계획 본문과 자기 미결 목록(`open-questions.md`가 같은 지점을 `≈:3014-3018`로 **옳게** 적었다)이 서로 다른 좌표를 말하는 상태였고, R14가 예측한 Edit `old_string` 실패 지점이다 |
| 9 | **D-그래프 근거 보기를 검증 매트릭스·시연 표에 편입.** 8a에 D 행 추가, 9c에 **17행** 신설, ③-2를 16 → **18행**, ③-3을 11/5 → **12/6행**, V8·9d 전파 | §1.3이 `그래프에서 근거 보기`를 D의 즉시 동작으로 분류하며 `app/canvas.js:3067-3074`까지 근거를 달아 놓고도 8a·9c 어디에도 넣지 않았다. ③-2가 시연 표를 "A~E 각 동작"의 조작적 정의로 삼으므로 이 결손은 **AC 문면상 통과**로 처리됐다(치명 2와 같은 부류, 영향은 작다 — 링크 이동뿐) |

### 낮음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 10 | **머리말의 삽입 줄 수 4건과 커밋 수를 전부 삭제**(머리말·R18·ADR Drivers 3·§8-3·§9 배너). 파일 **목록만** 남긴다. R5의 `2,887줄`도 삭제 | 계획 자신의 규율은 "숫자를 박지 않는다"인데 머리말은 그 수치들을 **`실측`이라 표기**해 실행자가 기대 규모로 읽게 만들었고, 재검증 시점에 **다섯 값이 전부 틀렸다**(커밋 57 · `chat.js +938/-1` · `main.js +599/-34` · `canvas.js +418/-18` · `conversations.js +128/-4`). Step 0e를 구동하는 실제 계약은 "무엇이 움직였는가"이지 "얼마나"가 아니다. `≈`가 붙은 앵커가 6~11줄 어긋난 것은 오히려 앵커 규율이 작동한다는 증거이므로 문제가 아니다 |
| 11 | **V2의 `단언 수 ≥ 42` 상수 폐기 → "Step 1 측정값 + 신규 ≥10"** | 42는 베이스라인 34를 전제한 상수라 Step 1의 "worktree에서 다른 값이 나오면 **그 값을** 기준선으로 삼는다"와 어긋났다 — 게이트가 자기 선행 Step과 모순되면 안 된다 |
| 12 | **Step 0a의 `git worktree prune` 근거 정정**(관리 파일 위생으로 격하, 줄은 유지) + **Step 0a-2 이탈 규정 신설**(`ExitWorktree {action:"keep"}`만, `remove` 금지) + §6.3에 작업물 보관 한 줄 | `prune`은 등록이 끊긴 항목의 **관리 파일만** 지우고 미등록 잔존 디렉터리에는 아무 작용도 하지 않으므로 3차가 적은 근거("잔존 항목이 `add`를 방해하지 않도록")가 성립하지 않았다 — 근거와 주장이 층을 같이해야 한다는 이 계획 자신의 기준이다. 이탈 규정은 **문서 위생**으로 적었다(도구 계약상 `path` 진입 worktree는 `ExitWorktree`의 제거 대상이 아니므로 "유일한 방어"가 아니다) |
| 13 | **R25·R26·R27·R28·R29 신설**(읽기 계약 부재 · 경로 순서 회귀 · 결손 기동 · 레거시 422 · 화면이 약속한 버튼 부재) | 앞의 셋은 3차 리스크 표에 **없던 물질적 위험**이고, R26은 이번 완화(d-2)가 **새로 만드는** 위험이라 함께 닫아야 한다. R29는 "문자열 단언이 전건 통과하는데 화면이 거짓말을 한다"는 이 개정의 일반화된 교훈이다 |

### 반영하지 않은 지적 · 판단이 갈린 지점

| 지적 | 판단 |
|---|---|
| **Architect의 antithesis: "`update` control을 빼고 A-설정편집을 `view` 핸드오프로 되돌려라"** | **기각(Architect 자신도 기각했다).** `POST /{id}/confirm`이 패치가 아니라 `can_activate` → `ensure_realtime_subscription` → `store.transition(id,'active')`임을 재확인했다(`routines.py:211-229`). 다만 그 반론이 진짜로 겨눈 것 — *`update`만이 두 경로 모두에 조건 원문 읽기를 요구하는데 계획은 어느 쪽도 충족하지 않았다* — 는 전적으로 옳고 **치명 1로 전건 채택**했다. 부분 채택은 있다: 조건 술어에 한해 대화 경로는 `view` 핸드오프이며, 그 축소를 **U-5로 승격**했다 |
| **Architect 낮음7: "`ExitWorktree remove` 금지 한 줄이 유일 산출물의 유일한 방어"** | **조치는 채택, 위험 평가는 Critic 쪽을 따랐다.** 도구 계약상 `git worktree add`로 만들고 `path`로 진입한 worktree는 `ExitWorktree`가 제거하지 않으므로 "전 작업이 사라진다"는 도달 불가 시나리오다. 한 줄은 **문서 위생 수준**으로 적었다(낮음 12) |
| **Architect 높음3의 "인용 경로 정정" 절반** | **절반만 성립한다(Critic의 disputed 2에 동의).** 3차 Step 9a는 디렉터리 없이 `backend-launcher.js:16-20`·`:11`만 썼고 그 basename의 파일은 저장소에 하나뿐이며 **두 줄 번호는 정확했다.** 정정할 것은 "틀린 경로"가 아니라 "경로 생략"이었으므로 전체 경로를 명시하는 선에서 반영했다. 이 항목의 실체는 전적으로 env 기본값 결손 쪽이며 그것은 높음 3으로 전건 채택 |
| **커밋 수를 39로 갱신하라**(작업 지시) | **반영하지 않는다** — 두 검토자가 모두 낮음 등급으로 "숫자를 지워라"라고 판정했고, 재검증 시점 실측은 **57**이며 origin은 실행 중에도 움직인다. 사용자 확정 1이 전제한 **사실**(origin/main이 로컬 main보다 앞서 있고 공통 세션 기반 `mode` 필드·스냅샷 복원이 착륙 완료)은 §1.4 표와 D-3에 **코드 실측으로** 그대로 살아 있다 — 이 계획이 버리는 것은 사실이 아니라 **곧 낡을 숫자**뿐이다 |
| **AC ①-10의 "겹침·잘림 0"이 여전히 육안** | 3차와 같은 판단으로 반영하지 않는다(Critic도 disputed에서 동의). 전 노드 박스 교차 계산은 비용이 가치를 넘고, 나머지 3검사는 명령이 있으며, 시각 판정은 Step 5 사람 정지점의 고유 역할이다 |
| **`agent-proposal.js` 순수 모듈에 GUI가 런타임 의존하게 만드는 안** | 3차와 같은 판단으로 반영하지 않는다 — 두 렌더러가 같은 상수를 **조회**하면 발산 단언이 항상 참인 무의미한 단언이 되고, 오타 발산을 못 잡는다. **두 단언을 함께 둔다**(8a-2) |

---

## 11. 변경 이력 — 합의 5차 (2026-09-03)

> ⚠ **이 절은 5차 시점의 기록이며, 아래 §12(합의 6차)가 일부 항목을 정정했다.** 특히 **중간 10**이 「전부 실측으로 다시 쟀다」며 적은 정정 8건 중 **ws 전용 422 `:100-101`→`:99-100`은 반대로 갔다**(실측 `rules.py:100` `if ticks_raw > 1 and spec.transport != "ws":` · `:101` `_fail(…)` — **4차가 맞았고 5차가 틀렸다**, 6차에 되돌렸다). 또한 **치명 1의 근거 좌표 `app/chat.js:2524`는 로컬 `HEAD` 값**이었고(origin 실측 `≈:2949`), **중간 11**의 P5 게이트 확대는 `agent-canvas.js` **전체 파일**을 대상으로 삼아 **구조적으로 통과 불가**였으며(origin에 이미 11건이 걸리고 계획의 편집은 그중 0건을 줄인다 — 6차에 문자열 지정 grep으로 교체), **치명 2가 남긴 `설정 편집 ↓`(상세 패널로 스크롤)는 불가능한 동작**이었다(`openHistory`가 `body.hidden = true`로 상세 패널을 숨긴다 — 6차에 동작 재정의). **실행 지시로는 §12를 따른다.**

Architect 4차 **REVISE** + Critic 4차 **REJECT** 판정을 반영한 개정이다. 뼈대 결정 **a-1 · a′-1 · a″-1 · b-1 · c-1 · d-2는 유지**하고, **새 결정 (e) 소스 카탈로그 계약**과 **(f) 설정 편집 폼의 위치**가 추가됐다. 두 검토자가 `origin/main`에서 재검증한 사실 주장 약 50건은 거의 전부 정확했으므로, 이 개정이 고치는 것은 4차와 마찬가지로 **계획이 스스로 세운 기준을 자기가 통과하지 못하던 지점들**이다 — 이번에는 낱개가 아니라 **부류**였다: 뼈대가 아니라 **기존 렌더러가 이미 갖고 있는 구조적 관문**(진입로 · 제목 문자열 · 필드 인벤토리)을 아무도 감사하지 않았다는 것. 이 절의 모든 근거는 `origin/main`에서 직접 확인했다.

### 치명

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 1 | **결정 (e) 신설(§1.7) — 소스 카탈로그 읽기 계약.** 옵션 3안 표(**e-1 서버가 실어 보낸다** / e-2 렌더러 사본 + 발산 단언 / e-3 하드코딩 + U 항목) → **e-1 채택**. `GET /{routine_id}` 응답에 **`source_spec` 블록** 추가, **`GET /api/v1/routines/source-catalog`** 신설(routine_id가 없는 05 시트용), IPC `athena:routine-source-catalog` + preload 1줄 + main 핸들러 + `fetchSourceCatalog()` 어댑터, ②-1 추가 단언 **⑥**(카탈로그 출처 + 하드코딩 0), ②-9b **⑤**, 8c 신규 단언 2건, **V15** 신설, R31 신설, Step 3-1·3-2 분기 규칙 표에 "값의 출처" 열 추가 | 4차의 중심 기능(소스별 분기 편집 폼)이 서야 할 **두 번째 읽기 계약이 없었다.** 실측 — `grep -rn "price.current\|source_spec\|value_type\|spec.ops\|SOURCES" app/lib/*.js app/canvas.js app/chat.js`의 유일한 히트는 **`app/chat.js ≈:2949`의 주석 한 줄**이고, 4차의 `GET /{id}`는 `condition` 4키만 준다. `mode`에서 `transport`는 유도되지만 **`ops`·`value_type`은 유도 불가**다(`price.current`와 `vi.triggered`가 둘 다 `realtime-ws`인데 `_NUM_OPS`/number vs `_EQ_OPS`/bool로 갈린다, `models.py:22-25,42-51`). 즉 §1.6이 `condition`에 대해 세운 진단이 **한 층 위에서 글자 그대로 재현**됐고, 실행자에게 남는 선택지는 연산자를 지어내거나(422를 부르는 거짓 선택지 — 3차가 저지른 그 오류) 카탈로그를 복사하는 것뿐이었다. 그런데 ②-1의 테이블 구동 테스트는 카탈로그를 **주입받아** 돌므로 전건 통과하고 8c 프로브도 fixture로 통과한다 |
| 2 | **결정 (f) 신설(§1.8) — 설정 편집 폼을 드릴인 `설정` 탭에서 「상세 패널」로 이동.** 옵션 3안 표(f-1 schedule에도 드릴인 링크 / **f-2 상세 패널로 이전** / f-3 감시 전용 선언) → **f-2 채택**, **U-6 확인 항목** 신설(승인 5항목 → **6항목**), Step 3-2·7a·7b·8c·9c 2행 전파, **8a-5 도달성 부류 단언** 신설, 8a 매트릭스에 도달성 행 추가, **V16** 신설, R32 신설 | 실측 — 드릴인 진입 버튼 `전체 이력 보기 →`(`agent-canvas.js:1536`, `openHistory` `:1063`)는 **바깥 게이트 `if (item.kind !== 'draft')`(`:1525`) + 안쪽 게이트 `if (item.kind === 'watch')`(`:1533`)** 를 모두 통과할 때만 그려지고, 설정 탭은 **드릴인 전용**이다(`:298-299` 주석). 파일 머리말 `:59-62`가 *"draft·예약(schedule)은 이 링크가 없다"*를 계약으로 적어 뒀고 `allItems()`(`:1294-1332`)가 `mode==='scheduled'`→`kind:'schedule'`, `status==='draft'`→`kind:'draft'`로 보낸다. 즉 **예약·초안 루틴에는 GUI 설정 편집 경로가 존재하지 않으며**(D2의 미신고 축소 = 사용자 확정 4 위반) **9c 2행의 GUI 다리가 실행 불가**다 — 9b가 심는 예약 루틴의 설정 탭을 사람이 열 수 없으므로 3차가 *"소스별 분기가 이 충돌을 닫는다"*고 적은 지점에 애초에 도달하지 못한다. Architect가 제시한 f-1은 **불완전하다**(바깥 게이트 때문에 초안이 남는다) — 세 kind를 한 번에 덮는 것은 f-2뿐이고, 마침 4차가 `확정` 버튼을 넣기로 한 자리라 비용이 이미 지불됐다 |

### 높음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 3 | **6c `update`에 `note` 신선도 규칙 신설**(R30). 자동 생성분(`note == human_summary()`)은 `condition` 변경 시 비워 재생성, 사용자 작성분은 절대 덮지 않는다. ②-9를 10 → **11 케이스**, V5 전파, 9c 2행 상태 확인에 `note` 추가, **Step 9b가 두 시연 루틴의 `note`를 서로 다르게 심도록** 못 박음(예약 = 자동 생성, 감시 = 명시) | `to_dict()`(`models.py:181-196`)가 기존 `note`를 그대로 싣고 `rules.py:168-169`는 **note가 빈 경우에만** `human_summary()`(`models.py:168-179`, `f"{symbol} · {label} {op} {value} · 방식 {mode}"`)로 재생성한다. 그래서 note 미지정 루틴(기본 경로)의 조건을 편집하면 **옛 술어가 그대로 남는다.** 그 `note`는 감시·예약·초안 **모든 목록 행의 제목**(`agent-canvas.js:1285`·`:1299`·`:1313`)이고 설정 표면이 `['조건', r.note]`로 **조건이라 라벨하는 값**(`:1000`)이며 `_view`(`routines.py:122`)가 내보내 **모델이 읽는 유일한 루틴 설명**이다 — 조건을 고치면 화면과 모델이 **함께 옛 조건을 말한다.** R22·R23과 같은 '조용한 손상' 계열이고 이번엔 **계획의 신규 엔드포인트가 원인**이며, 하필 D-1이 지키려 한 "모델 도달 표면의 정직성"을 훼손한다 |
| 4 | **①-7·8c의 읽기 전용 등호를 「정확히 3건」 → 「합집합 등호」로 교체.** `설정 표면의 모든 라벨 == (편집 가능) ∪ (읽기 전용)`, 두 집합은 서로소, **개수 상수 없음.** Step 3-2 필드 표에 `다음 실행`·`생성`·`만료 <날짜>` 행 신설(유지 결정), Step 7a 전파 | 실측 `historySettingsFields`(`agent-canvas.js:997-1014`)가 내는 라벨은 **9종**이고 그중 **`다음 실행`(`:1011`)·`생성`(`:1013`)**이 4차의 읽기 전용 3종에 없다. 여기에 계획 자신의 `만료 <YYYY-MM-DD>` 보조 표기(Step 3-2 프리필 규칙 1)가 더해져 최소 6종이다. 4차대로면 **최종 게이트가 올바른 구현을 반려하고**, 실행자에게는 (i) 현재 표시 중인 두 필드를 지워 정보를 회귀시키거나(P3) (ii) 자기 보조 표기를 빼거나 (iii) AC를 실패시키는 선택지만 남는다 — 4차가 `종목`에서 진단하고 고친 결함과 **완전히 같은 계열**이라, 이번엔 개수가 아니라 **집합 관계**에 게이트를 걸어 재발을 끊었다 |
| 5 | **D-1·§1.6·§2·U-5·ADR Drivers 1의 "모델은 조건을 `source_label`로만 본다" 문면 정정**(머리말 **철회 5**). "모델 도달 읽기 표면 동결" → **"모델은 술어를 산문(`note`)으로 볼 수 있으나 기계 판독 소스 키·연산자 집합에는 도달하지 않는다"** | `rules.py:168-169` + `models.py:168-179`가 자동 생성 `note`에 `op`·`value`를 실어 `_view`(`routines.py:122`)로 내보낸다 — **모델은 술어를 이미 산문으로 읽는다.** 결정 d-2 자체는 유효하지만(소스 키·연산자 집합은 여전히 안 나간다) 이 문장은 **U-5라는 사용자 결정 게이트의 유일한 근거**다. 사용자 확정 4가 조용한 축소를 막으려고 세운 방어 장치에 거짓 전제를 실어 보내면 승인/반려의 실질이 달라진다 — 그래서 Architect의 '낮음'이 아니라 Critic의 '높음' 판정을 따랐다. 결정은 바뀌지 않고 비용은 문장 몇 줄이다 |

### 중간

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 6 | **6c-2 `GET /{id}` 반환을 「`_view` 필드 전부」 → §1.6 「반환 키 목록」으로 좁힘**(R33). `last_fired_at`·`unread`·`missed`·`next_fire_at`·`created_at`·`approved_at`을 **내지 않는다.** ②-9b ①을 **키 집합 등호**로 교체, V5b 전파 | `_view(spec, runtime, *, latest_fired=None)`(`routines.py:108-110`)의 독스트링대로 `latest_fired`는 `list_routines()`가 ledger를 스캔해 주입하는 값이라 상세 라우트에는 없다. 문자 그대로 구현하면 발화한 루틴에도 `last_fired_at: null`이 나가고, 더 나쁘게 **예약 루틴은 `missed`가 항상 `true`**가 된다 — `_is_missed(missed_at, None)`이 `last_fired_at is None`에서 **`return True`**(`:79-80`)다. Step 7a가 `missed === true`를 `지금 실행` 활성 조건으로 쓰므로(R7) **죽은 버튼이 아니라 409를 부르는 거짓 활성 버튼**이 생긴다(Architect는 방향을 `false`로 적었으나 실측은 반대다 — Critic의 disputed 1에 동의). ②-9b ①이 "필드 전부"인 한 실행자는 주입 없이도 통과하고 발화 이력 없는 fixture는 차이를 드러내지 못한다 |
| 7 | **V4가 부르는 테스트 이름을 옛 이름 → `test_propose_only_reads_list`로 통일**(§1.3 칩 근거 · R1 완화 · V4 · ADR Why-chosen 2, **4곳**) | Step 6-A b가 `test_propose_never_writes`를 **개명·확장**한다고 명시했는데 옛 이름이 4곳에 남았고, 그중 **V4는 §6.3 완료 판정이 통과를 요구하는 게이트**다. 이름 불일치를 방치하면 ralph가 두 테스트를 다 만들거나 게이트를 거짓 판정한다 — 하필 D-1을 코드로 고정하는 **유일한 단언**의 이름이다. 이 계획이 3·4차에 반복해 잡아낸 유형(본문과 미결 목록이 다른 값을 말한다)이 4차 개정 자신이 만든 형태로 재발한 것이다 |
| 8 | **V10 가짜완료 grep 대상에 `app/lib/agent-canvas.test.js`·`backend/tests/api/test_routines_detail.py` 추가 + 행 수 상수(`14행 × 2 = 28건`) 삭제** | V10 자신의 근거 문장이 *"Step 8a의 A~E × 2경로 매트릭스가 분량이 커 스텁·skip이 가장 발생하기 쉬운 자리"*라 적어 두고, 그 매트릭스의 GUI 단언이 사는 `agent-canvas.test.js`(8b가 기존 단언 3건을 교체하고 8a가 GUI 단언 십수 건을 새로 얹는다)를 대상에서 뺐다. **게이트 범위가 자기 근거보다 좁으면 "게이트는 통과하는데 스텁이 남는다"가 성립한다** — 8c에서 `inputCount >= 4`를 폐기하며 세운 기준의 같은 적용이다. 행 수는 4·5차에 계속 늘어 상수로 둘 수 없다 |
| 9 | **9c 11행 기대값을 `→2` → `2 → 1`로 교체**(대화 문장도 "하루 한 번만 말 걸어"), `max_daily_briefings` 불변 확인 추가 | `GuardSettings.max_daily_nudges`의 **기본값이 2**다(`backend/athena_api/routines/guard_settings.py:49`, 검증 기본값 `raw.get("max_daily_nudges", 2)` `:84`, 범위 0~10 `:23-24`). 새로 띄운 백엔드에서 이 동작의 before/after diff는 **비어 있다.** 그런데 ③-3이 이 행을 **JSON diff로 증명해야 하는 12행 중 하나**로 지정하면서 *"빈 diff는 '동작하지 않았다'와 '동작했으나 서버에 안 남는다'를 구분하지 못한다(P3)"*며 빈 diff를 통과 증거로 쓰는 것을 **명시적으로 금지**했다 — 계획대로 시연하면 실행자는 통과를 기록할 수 없거나 금지된 증거를 적는다 |
| 10 | **`≈` 없는 확정 좌표 8건 정정 + Step 0e에 「차이 0 파일의 좌표 정정 2차분」 표 신설.** `activation_blocker` `:136`→**`:131`** · `expires_at` `:129`→**`:128`** · `source_spec()` `:112-116`→**`:107-111`** · `SOURCES` `:43-52`→**`:42-51`** · `LEGACY_DISABLED_SOURCES` `:53-58`→**`:55-59`** · `_MAX_CONSECUTIVE_TICKS` 정의 **`:37`**(`:98`은 범위 검사) · ws 전용 422 `:100-101`→**`:99-100`** · 프로브 라벨 화이트리스트 `:265-268`→**`:266-268`**(`inputCount === 0`은 `:269`) | 3차 §9 낮음 22가 이 부류를 정정하며 세운 기준 그대로다 — *"probe·triggers는 '차이 0이라 재측정 불필요' 범주라 실행자가 검증 없이 쓴다."* 특히 앞의 셋은 **4차가 새로 도입한 두 결정(확정 버튼 · 레거시 409)의 유일한 근거 좌표**여서, 새 결정이 어긋난 좌표 위에 서 있었다. 프로브 좌표는 **계획(`:265-268`)과 두 검토자(Critic `:265-267` / Architect `:266-269`)가 전부 한 줄씩 다르게 적었고** 실측은 `check(` 266 · `includes(l)` 268 · `inputCount === 0` 269였다 — 앵커 규율을 요구하는 문서에서는 검토자 좌표도 같은 기준을 받는다 |
| 11 | **①-10·Step 6-B의 P5 문구 게이트 사정거리 확대 + 문자열 2건 축약.** `확정` 비활성 표기를 `지금은 켤 수 없음: <blocker>` → **`<blocker>` 원문 그대로**, 6c 409 detail을 **`지원하지 않는 조건 — 취소 후 새로 만들기`**로. grep 대상에 `agent-canvas.js`·`routines.py` 추가, **정규식이 `~한다`·`~없다`를 못 잡는다는 사실 명문화**, 8c에 "접두어 없음" 단언 추가 | `can_activate()`가 돌려주는 값은 **완결 설명문**이다(실측 `runtime.py:78`·`:81`·`:85` — `"키움 WS 미가용 — 실시간 감시를 켤 수 없다"` 등). 접두어를 붙이면 *"지금은 켤 수 없음: 키움 WS 미가용 — 실시간 감시를 켤 수 없다"*로 **같은 말을 두 번** 한다(P5·P3). 409 detail도 완결 설명문이었다. 둘 다 4차 게이트 대상(Paper 노드 + `agent-proposal.js` + `routine_tools.py`) 밖이라 **"게이트는 전건 통과하는데 화면이 규율을 어긴다"**가 성립했고, 정규식은 백엔드 어투(`~한다`)에 애초에 무력하다 |
| 12 | **머리말 철회 4 신설 + Step 0e `canvas.js` 행 확장** — `app/canvas.js:3067-3074`(D-그래프 근거 보기)를 폐기하고 **`onOpenGraph:`(`≈:3051`)** 이름 앵커로 교체, `fetchRuns`·`fetchAvgDuration`·`fetchEngagement`를 `≈:3023·3030·3036` → **`≈:3022·3029·3035`**로 정정하고 네 이름을 재해결 목록에 편입 | `canvas.js`는 머리말이 스스로 "이동 8파일"로 지정한 파일인데 이 좌표만 `≈` 없이 남았다 — 3차가 `sidebar.js`에서, 4차가 `chat.js`에서 잡아낸 것과 **같은 실패 모드가 세 번째 파일에서 살아남은 것**이고, 게다가 Step 0e의 `canvas.js` 이름 앵커 목록에 `onOpenGraph`가 없어 **재해결되지도 않았다** |
| 13 | **9c에 `8b` D-캔버스에서 열기 행 신설**(18 → **19행**), ③-2·③-3(무변화 6 → **7행**)·V8·9d 전파 | 스펙 D 인벤토리의 `캔버스에서 열기·채팅으로`는 **두 방향**인데 8행(B 이어가기)이 `채팅에서 열기 ↗` 한 방향만 덮었다. ③-2가 시연 표를 "A~E 인벤토리 전수"의 조작적 정의로 삼으므로 이 결손은 **AC 문면상 통과**로 처리됐다 — 4차가 D-그래프에 대해 17행을 신설하며 한 정정과 정확히 같은 구조의 잔여분이다 |

### 낮음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 14 | **`chat.js` 확정 칩 invoke 좌표를 `≈:3022`/`≈:3025` 혼용 → `≈:3025`로 통일**(Step 7d를 §1.3·8a-2에 맞춤) | origin 실측이 `:3025`다. 앵커 규율을 강제하는 문서가 같은 지점을 두 값으로 말하고 있었다 |
| 15 | **§10(4차 이력)에 "정정됨 · 실행 지시 아님" 배너 추가** | §8·§9와 같은 처리다 — changelog는 삭제하지 않는 것이 원칙(결정의 역사를 지우지 않는다)이므로, 정정된 좌표·기준을 실행 지시로 오독하지 않도록 배너로 막는다 |
| 16 | **Follow-ups 9·10 신설**(예약 루틴 드릴인 이력 배선 · 레거시 소스 마이그레이션 경로) | 결정 f-2는 **설정 편집**만 상세 패널로 옮겼고 드릴인 이력 자체는 여전히 감시 전용이다(`agent-canvas.js:1533-1535` 주석이 *"다음 스코프로 이연"*이라 기록). 범위를 넓히지 않되 **무엇이 남는지는 적어 둔다**(P3) |
| 17 | **ADR Consequences에 5차분 8줄, Alternatives에 e-2·e-3·f-1·f-3·`latest_fired` 주입안 5건 추가** | 새 결정 둘과 좁힌 응답 하나가 옵션 표로 정당화됐으므로 ADR이 그것을 반영해야 한다 |

### 반영하지 않은 지적 · 판단이 갈린 지점

| 지적 | 판단 |
|---|---|
| **커밋 수를 39로 갱신하라**(작업 지시) | **반영하지 않는다** — 2·3·4차와 같은 판단이며 두 검토자도 매번 동의했다. 재검증 시점 실측은 `git rev-list --count HEAD..origin/main` = **57**이고 origin은 실행 중에도 움직인다. 사용자 확정 1이 전제한 **사실**(origin/main이 앞서 있고 `mode` 필드·스냅샷 복원이 착륙 완료)은 §1.4 표와 D-3에 **코드 실측으로** 살아 있다 — 버리는 것은 사실이 아니라 곧 낡을 숫자다. 브랜치를 딴 뒤에는 origin 이동이 이 계획에 영향을 주지 않는다(병합하지 않으므로) |
| **Architect: "부류 단언 둘(도달성 + 필드 합집합)이면 이 계열이 닫힌다"** | **채택하되 한계를 명문화했다**(Critic의 disputed 5에 동의). 두 단언은 이번 치명 1(카탈로그 계약 부재)을 **둘 다 통과시킨다** — 도달성은 진입로만, 합집합 등호는 라벨만 본다. 카탈로그가 갈라져 `price.current`에 `==`를 제시해도 초록이다. 그래서 결정 e-1로 **계약 자체를 없애고** ②-1 ⑥·V15가 사본 0을 따로 단언한다(8a-5에 이 한계를 인용해 적었다) |
| **Architect 치명 1의 옵션 (i)(`kind==='schedule'`에도 드릴인 링크)** | **불완전해서 기각**(Critic의 disputed 2에 동의). 게이트가 **둘**이라 안쪽만 넓히면 **초안이 남고**(바깥 `agent-canvas.js:1525`), 두 게이트를 다 열면 draft 드릴인이 빈 "최근 실행"을 열어 그 주석이 지킨 계약(*"빈 로그를 지어내 보여주지 않는다"*)을 깬다. 세 kind를 한 번에 덮는 것은 f-2뿐이다 |
| **Architect의 antithesis: "d-2를 폐기하고 d-1로 가라"** | **사실 지적은 전건 채택, 처방은 기각**(Architect 자신도 기각했다). `note`가 술어를 산문으로 나른다는 것은 실측으로 확인해 머리말 철회 5 · D-1 문면 정정 · U-5 근거 재작성으로 반영했다. 그러나 `note`는 **한국어 라벨**(`현재가`)을 줄 뿐 소스 키도 연산자 집합도 주지 않고, 사용자가 직접 쓸 수 있어 **누출이 우연적·불안정**하다 — 불안정한 누출을 근거로 안정적 계약을 여는 것은 방향이 거꾸로다. 다만 안티테제가 겨눈 진짜 지점(편집 후 그 누출이 **거짓으로 바뀐다**)은 살아남아 **R30 note 신선도 규칙**이 됐다 |
| **Architect 중간(`GET /{id}`의 `missed`가 `false`로 나간다)** | **지적 채택, 방향은 Critic 쪽이 옳다.** 실측하면 `missed`는 `false`가 아니라 예약 루틴에서 **항상 `true`**다(`routines.py:79-80`이 `last_fired_at is None`에서 `return True`). 즉 결손은 "없는 값을 false로 단정"이 아니라 **"놓치지 않은 예약을 놓쳤다고 단정"**이고, 위험이 죽은 버튼이 아니라 **409를 부르는 거짓 활성 버튼**이라 정반대다. 처방(응답을 좁힌다)은 그대로 채택했다 |
| **AC ①-10의 "겹침·잘림 0"이 여전히 육안** | 3·4차와 같은 판단으로 반영하지 않는다(두 검토자 모두 동의). 전 노드 박스 교차 계산은 비용이 가치를 넘고, 나머지 3검사는 명령이 있으며, 시각 판정은 Step 5 사람 정지점의 고유 역할이다 |
| **`chipToIpc`를 단일 frozen 상수 조회로 바꾸는 안** | 3·4차와 같은 판단으로 반영하지 않는다 — 두 렌더러가 같은 상수를 **조회**하면 발산 단언이 항상 참인 무의미한 단언이 되고 오타 발산을 못 잡는다. ⚠ 다만 **결정 e-1은 이것과 모순되지 않는다**: 채널명은 두 렌더러가 각자 부르므로 사본이 불가피해 단언으로 지키고, 카탈로그는 **서버가 유일 소유자**라 사본을 만들지 않는 것이 옳다 — 판단 기준은 "사본이 불가피한가"이지 "사본이 나쁜가"가 아니다 |
| **Paper 재작업 시 `finish_working_on_nodes` 재호출 지시 부재**(Critic paperWorkflow 보완) | **반영하지 않는다** — Step 5.2가 "활성 페이지 복귀 + `finish_working_on_nodes`"를 게이트 통과 절차로 이미 규정하고, 검수 반려 시 Step 3~4로 되돌아가면 그 절차를 **다시 통과해야** Step 5에 도달한다. 절차가 순환에 이미 포함돼 있어 별도 지시가 중복이다 |

---

## 12. 변경 이력 — 합의 6차 (2026-09-03)

Architect 5차 **REVISE**(9건) + Critic 5차 **REJECT**(12건) 판정을 반영한 **국소 수정 라운드**다. 두 검토자 모두 **뼈대(a-1 · a′-1 · a″-1 · b-1 · c-1 · d-2 · e-1 · f-2)를 유지 판정**했고, 21건 중 **결정을 번복하는 항목은 0건**이다. 이 개정이 고치는 것은 (i) 계획이 세운 게이트가 **통과 불가**하거나 **올바른 구현을 반려**하던 자리, (ii) 5차가 새로 만든 **죽은 링크 하나**, (iii) 프로세스 경계 때문에 **배치 불가능**했던 계약 하나, (iv) 좌표·문면 정합이다. 이 절의 모든 근거는 `origin/main`에서 직접 재측정했다.

### 치명

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 1 | **Step 6-B 「충족 기준」의 문구 grep을 파일 전체 정규식 → 문자열 지정으로 교체**(C1). `app/lib/agent-canvas.js`를 정규식 대상 파일 목록에서 빼고, ①-10이 이미 쓴 조작적 정의(*"이 계획이 신설·수정한 문자열 전체"*)대로 문자열 지정 grep으로 바꿨다. ①-10 (c)·V9 문면 전파 | 실측 — origin의 `agent-canvas.js`에 5차 정규식을 그대로 돌리면 **11건**이 나온다(`:207`·`:595`·`:823`·`:913`·`:1160`·`:1200`·`:1260`·`:1427`·`:1471`·`:1567`·`:1595`) — **전부 이 계획의 범위 밖 빈 상태 문구**이고, 계획이 실제로 지우는 `:1039`는 `됩니다.'`(마침표) 때문에 **애초에 그 정규식에 걸리지도 않는다.** 즉 계획의 편집을 다 해도 결과는 여전히 11이라 **게이트가 구조적으로 통과 불가**였고, 실행자에게 남는 선택지는 게이트를 거짓 판정하거나 **검수받지 않은 제품 문구 11개를 임의로 고치거나**(CLAUDE.md §3·P4 위반) Step 6-B에서 멈추는 것뿐이었다. 하필 §11 중간 11이 *"게이트는 전건 통과하는데 화면이 규율을 어긴다"*를 고치겠다며 이 파일을 대상에 넣은 항목이라, **반대 방향의 같은 실패**를 만들었다 |
| 2 | **드릴인 `설정` 탭의 `설정 편집 ↓`(상세 패널로 스크롤)를 동작으로 재정의**(C2). 라벨에서 `↓`를 빼고, 버튼은 **`closeHistory()` → 항목 선택 → 상세 패널 설정 폼 첫 입력 포커스**로 확정. §1.8에 「부록」 신설, Step 3-2·U-6·Step 7a·6-B 문구 목록·ADR Consequences 전파, **8c 신규 단언 ①을 존재 → 동작**(`body.hidden === false` + 입력 ≥1 + 포커스)으로 교체 | 실측 — `detailCol`은 `panels`에(`agent-canvas.js:498`), `panels`는 `body`에 붙는데(`:499`) **`openHistory(item)`가 `body.hidden = true`(`:1076`)로 그 트리를 통째로 숨긴다**(`closeHistory` `:1104`). 즉 드릴인 `설정` 탭이 보이는 동안 상세 패널은 DOM에 있으나 **렌더되지 않으며 「상세 패널로 스크롤」은 물리적으로 불가능하다.** 5차의 `설정 편집 ↓`는 **아무 데도 데려가지 않는 버튼**이 되고, 8c의 5차 단언은 *"요약 + 그 버튼이 있다"*만 보므로 **전건 통과한다** — R29·R32와 **정확히 같은 계열**이 그 계열을 닫았다고 선언한(8a-5) 바로 그 라운드에서 재발했다. 도달성 부류 단언(②-1 ⑤)도 진입로를 상세 패널 쪽에서 보므로 이것을 관측하지 못한다 |

### 높음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 3 | **합집합 등호의 읽기 전용 변을 「지정 라벨 6종 ∩ 그 루틴에 실제로 존재하는 필드」로 재정의하고 등호를 루틴별로 판정한다고 명문화**(C3 = A1). 아울러 등호의 **주어를 「상세 패널의 설정 폼」으로 못 박았다**(드릴인 요약이 아니다). ①-7 · Step 3-2(집합 문단 + 입력 개수 문단) · Step 7a · 8a-5 2 · 8c 전파 | 두 결함이 겹쳐 있었다. **(1) 조건부 렌더링:** `historySettingsFields`(`agent-canvas.js:997-1014`)는 라벨을 조건부로 낸다 — `if (r.note)`(`:1000`)·`if (r.symbol)`(`:1003`)·`if (r.cooldown_s != null)`(`:1004`)·`if (r.briefing_model)`(`:1008`)·**`if (r.next_fire_at)`(`:1011`)**·`if (r.expires_at)`(`:1012`)·`if (r.created_at)`(`:1013`) — 그리고 `_next_fire_at`(`routines.py:19-21`)은 **`if spec.mode != "scheduled": return None`**이다. 따라서 **감시(watch) 루틴에는 `다음 실행` 라벨이 존재하지 않는데** 5차는 읽기 전용을 6종 **상수**로 고정해 V16·8c가 요구하는 kind 3종 fixture의 watch에서 **반드시 실패**했다 — 4차의 「정확히 3건」이 **개수에서 집합으로 옮겨갔을 뿐** 올바른 구현을 반려하는 성질은 그대로였다. **(2) 주어 미정의:** f-2가 설정 표면을 드릴인 요약과 상세 패널 폼 둘로 쪼갰는데 ①-7·8c는 여전히 단수 「설정 표면」으로 등호를 세워, 드릴인 요약을 대상으로 읽으면 편집 가능 변이 공집합이 되어 **등호가 다른 뜻**이 됐다. 편집 가능 변은 이미 건강하게 정의돼 있었으므로 **대칭만 맞췄고**, 비대칭(편집 가능 필드는 값이 없어도 빈 입력으로 그리므로 존재 조건이 없다)을 한 문장으로 적었다 |
| 4 | **`activation_blocker`를 신호로만 쓰고 사용자 문구는 제품이 소유하게 했다**(C4 = A2). 3분기 매핑 확정 — 레거시 소스 → `이 작업은 취소 후 새로 만들기` / WS 미가용 → **`실시간 감시 불가 — 키움 연결 없음`** / 실행 경로 없음 → **`백엔드 실행 경로 없음`** / 미지 blocker만 원문 폴백 + 노트. ①-10 (a) · Step 3-3 · Step 6-B 문구 목록(매핑 표 신설) · Step 7a `확정` 행 · 8c 「접두어 없음」 단언 전파 | 실측 `can_activate`(`runtime.py:71-85`)의 반환값 셋은 **`:78`** `"이 외부 데이터 source는 앱 플러그인 전용이라 백엔드에서 활성화할 수 없다"` · **`:81`** `"키움 WS 미가용 — 실시간 감시를 켤 수 없다"` · **`:85`** `"이 source는 백엔드 실행 경로가 없어 활성화할 수 없다"`이다. 셋 전부 **`~없다` 종결 완결 설명문**이고 `:78`·`:85`는 **영문 내부어 `source`**를 포함한다 — 그대로 그리면 P5의 「설명문 금지」와 「내부어 금지」를 동시에 어기는데 ①-10의 정규식은 `~없다`를 못 잡아 **게이트가 전건 통과하면서 화면이 규율을 어긴다**(5차는 접두어 중복만 없애고 설명문은 화면에 남겼다). 부수 문제도 닫힌다 — 레거시 소스 초안은 `can_activate`가 `:78`을 돌려주는데 6c·7a는 **같은 루틴**에 `이 작업은 취소 후 새로 만들기`를 쓰기로 해 **한 상태에 두 문구**가 배정돼 있었다(P3). 이 계획은 이미 `missed` → `놓친 예약 없음`의 선례를 갖고 있어 새 원칙이 아니며, **e-1이 막는 것은 유효성을 정하는 카탈로그의 사본이지 표시 문자열이 아니다** |
| 5 | **`isDerivedAlertRoom`의 소유 모듈을 렌더러 UMD(`app/lib/agent-proposal.js`)로 확정하고 main 쪽 `agent-session.js`가 `require`하도록 명문화**(C5 = A3). §1.4 계약 블록(+ b-1 행) · ②-5 ⑤ · 6f · 7c · 8a-4 정렬 | §1.4는 이 함수를 **main 프로세스 모듈**의 계약으로 선언하고 ②-5 ⑤가 `agent-session.test.js`로 단언했는데, 7c·7d·8a-4는 **렌더러**의 `shouldRenderProposal`이 그것을 부르게 했다. 6f는 *"순수 판정 함수는 `agent-proposal.js`가 노출한다"*고 **절반만** 정리해 이 함수의 소유를 미정으로 남겼다. 실측 — 렌더러 모듈은 `app/shell.html`의 `<script src="lib/*.js">`(**83줄**)로만 로드되고 그 목록에 **`lib/main/*`은 0건**이다(CommonJS라 main이 `require`한다). 실행자에게 남는 선택지는 판정 함수를 **두 벌 만드는 것**뿐인데 그것은 e-1이 배격한 사본이면서 8a-2 같은 발산 단언조차 없다. 하필 이 함수는 **스펙 Constraints:54(타 모드 불간섭)를 코드로 강제하는 유일한 자리**이고 3차가 *"어댑터에 소비자가 없다"*고 고친 바로 그 계약이다. 값싼 해법이 선례로 있다 — `app/main.js:29` `const { todayYyyymmdd } = require('./lib/backtest-spec')`가 **렌더러 UMD 모듈을 main에서 require**하며 `guard-confirm.js:72-78`의 `module.exports` 폴백이 그것을 가능하게 한다. 이 방향이면 **사본이 0**이다 |

### 중간

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 6 | **`rules.py`의 ws 전용 422 좌표를 `:100-101`로 되돌렸다**(C6 = A6 전반부). Step 0e 정정 2차분 표 행을 「되돌림」으로 교체, ①-7 · Step 3-2(2곳) · 6c(2곳) · Step 7a 전파(총 7곳), §11에 정정 배너 | 실측 `git show origin/main:backend/athena_api/routines/rules.py` — `:98` `if not 1 <= ticks_raw <= _MAX_CONSECUTIVE_TICKS:` · `:99` 그 `_fail` · **`:100` `if ticks_raw > 1 and spec.transport != "ws":`** · **`:101` `_fail("연속 틱 조건은 실시간(WS) source에서만 유효하다")`**. 즉 **4차의 `:100-101`이 맞았고 5차가 바꾼 `:99-100`이 틀렸다.** 계획이 범위 검사로 적은 `:98-99`는 맞으므로 **같은 표 안에서 두 항목의 기준이 갈렸다.** §11 중간 10이 *"전부 실측으로 다시 쟀다"*고 선언한 표의 한 행이 반대로 간 것이라 규율의 신뢰도에 직접 영향이 있다 — 이 파일은 「차이 0이라 재측정 불필요」 범주여서 실행자가 검증 없이 쓴다(3차 §9 낮음 22의 기준 그대로) |
| 7 | **`app/lib/main/backend-launcher.js`를 머리말 「이동 파일」 목록(8 → 9파일)과 Step 0e 재해결 표의 9번째 행으로 편입**(C7 = A5). `decideAction` 좌표를 **이름 앵커 `≈:62`**로 교체(③-1 · 9a · R27 · 8e), 머리말의 **완전성 주장 정정**, R14 전파 | 실측 `git diff --numstat HEAD origin/main -- app/lib/main/backend-launcher.js` = **`6 0`**. 이 파일은 머리말의 두 목록 **어디에도 없으면서** `:11`(HEALTH_URL) · `:28-58`(`buildBackendEnv`) · `:60-64`(`decideAction`)를 `≈` 없이 **6곳**에서 인용했다. origin 기준 재측정 — `const HEALTH_URL` **`:11`** ✓ · `function buildBackendEnv` **`:28`** ✓ · **`function decideAction`은 `:62`**(선행 주석 `:60-61`)로 `:60-64`는 함수 정의가 아니라 주석부터 세는 범위였다. **열거가 불완전하다는 것 자체가 결함이다** — 3차가 `sidebar.js`(+352/-28)에서, 5차가 `canvas.js`에서 정확히 이 이유로 잡아낸 계열이고 실행자는 *"두 목록에 없으면 검증 대상이 아니다"*로 읽는다. 하필 이 파일은 ③-1·R27이 라이브 시연의 **기동 계약 전체**를 거는 자리다 |
| 8 | **결정 (e)의 근거 좌표 `app/chat.js:2524` → origin 실측 `≈:2949`로 정정하고 `SOURCES 카탈로그` 문자열을 앵커로 지정**(C8 = A4). 6곳 전부(§1.6 · §1.7 · Step 3-2 · R31 · ADR Consequences · §11 치명 1) + Step 0e `chat.js` 행에 이름 편입 | 실측 — `git show origin/main:app/chat.js` 에서 `SOURCES 카탈로그`는 **2949**, `git show HEAD:app/chat.js` 에서는 **2524**. 즉 5차가 「실측」으로 표기한 이 좌표는 **로컬 `HEAD` 값**이었다. `chat.js`는 머리말이 스스로 "이동 파일"로 지정한 파일이고(실측 `+938/-1`), 이 좌표는 `≈` 없이 확정 형태로 6곳에 박혀 있었으며 Step 0e의 재해결 이름 목록에도 없었다 — 철회 3(`chat.js` 확정 칩)·철회 4(`canvas.js` D-그래프)와 **같은 실패 모드의 세 번째 재발**이고, 이번에는 그 두 철회를 쓴 라운드가 새로 세운 결정의 근거 표 안에서 났다. **결론(앱 카탈로그 0건)은 origin 실측으로 참이므로 결정 e-1은 유효하다 — 고친 것은 좌표뿐이다** |
| 9 | **§1.6 「반환 키 목록」에 `goal`을 명시적으로 편입**(C9 = A9) + 그렇게 정한 사유를 한 문단으로 | 실측 origin `backend/athena_api/api/routines.py` **`:123` `"goal": spec.goal`** — `_view`는 이 키를 낸다. 그런데 5차의 반환 키 목록은 `goal`을 **포함하지도, 「내지 않는다」 목록에 넣지도** 않았다. ②-9b ①이 반환 키 집합을 **등호로** 단언하므로 실행자가 임의로 정하고 테스트가 그 임의 선택을 고정한다 — 「응답을 좁혔다」(R33)는 결정의 감사 가능성이 한 키만큼 비어 있었다. **내는 쪽으로 정한다** — `to_dict()`가 `goal`을 싣으므로 `update` 왕복 보존에 필요하고, `last_fired_at` 계열과 달리 **`latest_fired` 주입 없이도 참인 값**이라 R33의 사유가 적용되지 않는다 |
| 10 | **V9의 grep 대상 문자열이 남는 주석 5곳을 Step 7a·8c 편집 목록에 명시**(C10) — `agent-canvas.js:300`·`:359`·`:987`·`:1444` + `probe-agent-paper-parity.js:126`. V9 기대 결과에도 실측 히트 목록과 편입 사실을 적었다 | V9는 두 파일에서 `보기 전용`/`동선 규칙` **0건**을 요구하는데, 실측 origin은 `agent-canvas.js` **10곳** · `probe` **9곳**이고 계획이 명시 편집을 지시한 것은 `agent-canvas.js` `:25`·`:501-520`·`:1021`과 probe `:11-17`·`:148-162`·`:264-274`뿐이라 위 5곳이 지시 밖에 남았다. 다섯 곳 전부 **이 계획이 실제로 거짓으로 만드는 주석**이므로(f-2가 *"상세 패널은 보기 전용"*을, `확정` 버튼이 *"draft는 읽기 전용"*을 뒤집는다) 고치는 것이 옳고 비용도 거의 0이지만, **게이트가 명시 지시보다 넓으면 실행자가 그 자리에서 임의 판단을 한다** — 8c에서 `inputCount >= 4`를 폐기하며 계획이 스스로 세운 기준(게이트와 지시의 사정거리를 맞춘다)의 같은 적용이다 |
| 11 | **「조건 술어 편집을 양 경로에서 빼고 `조건은 취소 후 새로 만들기`로 표기」를 ADR Alternatives에 편입하고 U-5·U-6 반려 시 착지점으로 지정**(A7, 부분 채택) | 지적의 사실 관계가 옳다 — U-5 반려 시 착지점 d-1은 **D-1**을(계획 자신이 ADR Alternatives에 그렇게 적었다), U-6 반려 시 f-3은 **D2**를 깬다. 즉 5차까지 계획은 **사용자가 어느 쪽을 반려하든 자기 드라이버 하나를 깨는 자리에 착지**하도록 설계돼 있었고, 그것은 U 항목의 목적(정직한 선택지 제시)과 어긋난다. 제3안은 계획이 `종목`·`소스`에 대해 이미 내린 판단과 **동형**이며 D-1도 §1.3의 D2 판정 단위도 깨지 않는다. **채택하라는 것이 아니라 착지점을 만드는 것**이므로 결정은 무변경이고, 두 U 행에 한 문장씩만 더했다(Critic이 *"값싼 개선"*으로 동의한 범위) |

### 낮음

| # | 무엇을 | 왜 (근거) |
|---|---|---|
| 12 | **`.omc/plans/open-questions.md`를 본문과 다시 정렬**(C11 = A8) — U-1 항목의 `읽기 전용 표기 3건` 문면을 **합집합 등호 + 루틴별 교집합**으로 교체, `models.py:43-52` → **`:42-51`**. 6차 절 신설(닫힘 2 + 미결 1) | 본문 ①-7은 5차에 「정확히 3건」을 합집합 등호로 교체했는데 `open-questions.md`는 **4차 문면을 그대로 유지**했고, `models.py:43-52`는 **정정 전 좌표**였다(같은 파일의 5차 신설 항목은 `:42-51`로 옳아 전파가 **부분적**이었다). 계획이 철회 3에서 스스로 세운 기준(*"본문과 미결 목록이 서로 다른 값을 말했다"*)의 위반이고, 하필 **U-1은 Step 5에서 사용자가 읽고 예/아니오로 답할 승인 문서**다 |
| 13 | **a″-1 옵션 표의 Cons 열에 섞인 Pros 2건을 Pros 열로 이동**(C12) — `백엔드 신규는 0`·`게이트 무손상`을 ⑤·⑥으로 옮기고, Cons는 `신규 IPC 채널 1개 + preload 1줄` 하나만 남겼다 | 채택안의 Cons 열 3항목 중 실제 단점은 하나뿐이고 나머지 둘은 **장점 문장**이었다. 2차 §8 변경 21번이 a′ 표에 Cons 열을 신설하며 *"채택안의 단점을 적을 자리가 없었다 — 편향된 표"*라고 스스로 세운 기준의 같은 위반이다. **결정 자체는 옳으므로 표기만 고쳤다**(실질 위험 없음, 공정성 표기 문제) |
| 14 | **머리말 개정 표기를 5차 → 6차로, §11에 「정정됨 · 실행 지시 아님」 배너 추가** | §8·§9·§10과 같은 처리다 — changelog는 삭제하지 않는 것이 원칙이므로, 6차가 되돌린 좌표(ws 422)·교체한 게이트(6-B grep)·재정의한 동작(`설정 편집`)을 실행 지시로 오독하지 않도록 배너로 막는다 |
| 15 | **`.omc/plans/open-questions.md` 3곳을 6차 **본문**과 정합**(R6-1 · 6차 cycle 2, 3 Edit·새 결정 0). (a) `:39` U-6 기본안 `설정 편집 ↓` → **`설정 편집` 버튼 + 동작 문면**(*"드릴인이 닫히고 상세 패널 설정 폼 첫 입력으로 포커스"*, §1.8 부록 참조) (b) `:41` 결정 (e) 근거 좌표 `app/chat.js:2524` → **`≈:2949`**(앵커는 `SOURCES 카탈로그` 문자열, + 5차 값이 로컬 `HEAD`였다는 사유 한 구절) (c) `:45` R33 반환 키 열거에 **`goal`** 편입(+ `to_dict()`가 싣고 `latest_fired` 주입 없이도 참이라 R33 축소 사유가 적용되지 않는다는 §1.6과 같은 사유) | 세 자리 모두 **6차 본문 수정이 새로 만든 불일치**다(5차까지는 두 문서가 같은 값을 말했다) — 계획이 철회 3에서 규정한 「본문↔미결 목록 불일치」의 재발이고, 하필 낮음 12가 바로 그 정렬을 수행한 라운드다. 실행 차단은 아니다(§11 배너·§12가 실행 지시의 소유를 본문에 두고, 치명 1의 문자열 지정 grep이 `설정 편집 ↓`을 반려한다). 다만 **(a)는 사용자가 Step 5 PDF 검수에서 실제로 읽고 답하는 문면**이라 계획이 「물리적으로 불가능」이라 판정한 동작(상세 패널로 스크롤)을 사용자에게 그대로 제시했을 자리이고, **(c)는 닫힌 답변이 계약으로 읽히는 자리**다 — ②-9b ①이 반환 키 집합을 **등호로** 단언하므로 실행자가 `:45`를 계약으로 읽으면 `goal` 없는 집합을 테스트에 고정하고 그 등호가 §1.6과 충돌한다(중간 9가 지적한 결함의 잔여분) |

### 반영하지 않은 지적 · 판단이 갈린 지점

| 지적 | 판단 |
|---|---|
| **Architect revision 6 후반: `guard_settings.py`의 `max_daily_briefings` 기본값 복귀를 `:110` → `:109`로 고쳐라** | **반영하지 않는다 — 계획이 옳다.** 실측 origin `backend/athena_api/routines/guard_settings.py`에서 `max_daily_briefings = raw.get("max_daily_briefings", 10)`은 **`:110`**이고 **`:109`는 빈 줄**이다(`:106` `learn_from_dismissals = raw.get(...)` · `:107` isinstance 검사 · `:108` raise · `:109` 공백 · `:110` 대상 줄). 같은 파일의 `max_daily_nudges` 좌표도 계획이 옳다 — `:49`(dataclass 기본값) · `:84`(`raw.get("max_daily_nudges", 2)`) 전부 실측 일치. **앵커 규율을 요구하는 검토에서는 검토자 좌표도 같은 기준을 받는다**(§9 낮음 22 · §11 중간 10이 세운 원칙이며, 이번엔 그것이 Architect 쪽에 적용됐다). Critic도 같은 실측으로 이 항목을 반박했다 |
| **커밋 수를 갱신하라** | **2·3·4·5차와 같은 판단으로 반영하지 않는다**(두 검토자 모두 동의). 6차 재측정 `git rev-list --count HEAD..origin/main` = **60**(초안 37 → 39 → 55 → 57 → 60)으로 **다섯 번 연속 값이 달라졌고**, origin의 신규 커밋은 계획이 인용하는 파일을 하나도 건드리지 않았다 — **앵커 규율은 작동하고 있고 커밋 수는 이 계획의 어떤 결정도 가르지 않는다.** 사용자 확정 1이 전제한 **사실**(origin/main 선행 · `mode` 필드·스냅샷 복원 착륙)은 §1.4 표와 D-3에 코드 실측으로 보존돼 있다 |
| **AC ①-10의 "겹침·잘림 0"이 여전히 육안** | 3·4·5차와 같은 판단으로 반영하지 않는다(두 검토자 모두 동의). 전 노드 박스 교차 판정은 비용이 조치의 가치를 넘고, 나머지 3검사(hex 0 · 문구 정규식 · 32px)는 명령이 있으며, 시각 판정은 Step 5 사람 정지점의 고유 역할이다. ⚠ 다만 **문구 축은 정규식만으로 불충분**하므로 6차에 **문자열 지정**으로 닫았다(치명 1 · 높음 4) |
| **Architect revision 7의 처방(제3안을 옵션 표에 3안으로 세우기)** | **착지점 지정까지만 반영했다**(중간 11). 옵션 표를 3안으로 늘리는 것은 **결정을 바꾸지 않으면서**(Architect 자신도 antithesis에서 기각했다) 6차를 길게 만든다 — 두 검토자가 *"6차는 짧아야 한다"*로 일치했다. 두 U 행은 이미 대안의 비용을 사용자가 읽는 자리에 적고 있으므로(U-5 *"모델 도달 표면이 실제로 커진다(D-1)"* · U-6 *"D2가 조용히 축소되고"*), 사용자 확정 4가 금지한 **조용한** 축소에는 해당하지 않는다 |
| **U-1~U-6 6항목은 여전히 사용자 답 대기** | Step 5 PDF 검수 게이트에서 받는다. 6차는 어느 U 항목의 **기본안도 바꾸지 않았다** — U-6의 기본안 f-2는 그대로이고 바뀐 것은 그 안의 `설정 편집` 버튼 **동작 정의**뿐이다. 새 U 항목도 만들지 않았다(6차 규칙: 새 결정·새 절·새 게이트 금지) |
| **Paper 보드 6장의 실제 노드 구조·현재 문구·아트보드 치수는 미확인** | 계획 단계에서 Paper MCP 호출을 하지 않았다(5차와 같다). Step 0f의 `get_basic_info`·`get_tokens`가 실행 중 대조하며, 어긋나면 계획의 node id·좌표를 실측으로 교체한다(`--color-k-faint`/`--color-k-dim` 실재 여부 포함) |
