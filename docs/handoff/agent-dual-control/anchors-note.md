# 앵커 재측정 노트 — feat/agent-dual-control @ 85aee35(origin/main tip) + 55ab631(헌장 커밋) (2026-09-03)

이름이 계약이고 줄 번호는 이 tip에서의 실측값이다. 계획 본문에는 숫자를 되쓰지 않는다.

## 이동 9파일 + 신규 파일

| 파일 | 이름 | 줄 |
|---|---|---|
| `app/main.js` | `function maybeForwardNudgeGuardProposal` | 2300 |
| `app/main.js` | `function maybeForwardGraphChatAction` | 2331 |
| `app/main.js` | `function maybeForwardBacktestChatAction` | 2381 |
| `app/main.js` | `function extractToolResultText` | 2445 |
| `app/main.js` | `async function routineHttp` | 1192 |
| `app/main.js` | `ipcMain.handle('athena:nudge-guard-set'` | 1303 |
| `app/main.js` | `ipcMain.handle('athena:routine-missed-confirm'` | 818 |
| `app/main.js` | `ipcMain.handle('athena:routine-ack'` | 1266 |
| `app/main.js` | `maybeForwardNudgeGuardProposal(step, block)` | 2505 |
| `app/main.js` | `require('./lib/backtest-spec')` | 29 |
| `app/chat.js` | `function renderGuardConfirmCard` | 3064 |
| `app/chat.js` | `const onNudgeGuardProposed` | 1223 |
| `app/chat.js` | `canvasMode:` | 1315 |
| `app/chat.js` | `function renderApprovalCard(` | 2960 |
| `app/chat.js` | `const preview = _btn('미리보기 실행'` | 3016 |
| `app/chat.js` | `const activate = _btn('바로 활성화'` | 3020 |
| `app/chat.js` | `SOURCES 카탈로그` | 2949 |
| `app/chat.js` | `invoke('athena:routine-confirm'` | 3025 |
| `app/chat.js` | `window.AthenaCanvasMode.state.view` | 1315 |
| `app/chat.js` | `routine-approval-actions` | 2700,2828,3010,3100,3268,3487,3755 |
| `app/canvas.js` | `createAgentCanvas({` | 2952 |
| `app/canvas.js` | `seedChatInput` | 2121,2129,2130,2966,2968,2969,2993,2994,3004,3009,3010,3015,3017,3018,3121 |
| `app/canvas.js` | `fetchRuns:` | 3022 |
| `app/canvas.js` | `fetchAvgDuration:` | 3029 |
| `app/canvas.js` | `fetchEngagement:` | 3035 |
| `app/canvas.js` | `onOpenGraph:` | 3051 |
| `app/canvas.js` | `pauseRoutine` | 2974 |
| `app/canvas.js` | `resumeRoutine` | 2979 |
| `app/lib/sidebar.js` | `markAllRead:` | 1109 |
| `app/lib/sidebar.js` | `function handleRoutineEvent` | 807 |
| `app/lib/sidebar.js` | `async function hydrateNotifyRooms` | 863 |
| `app/lib/sidebar.js` | `'athena:routine-engagement'` | 854 |
| `app/lib/sidebar.js` | `async function startNewConversation` | 901 |
| `app/lib/main/conversations.js` | `viewToMode(row.mode)` | 88 |
| `app/lib/main/conversations.js` | `function touch(` | 198 |
| `app/lib/main/conversations.js` | `state.conversations.push({` | 213 |
| `app/lib/main/conversations.js` | `state.activeMode = conversation.mode` | 237 |
| `app/lib/main/conversations.js` | `function viewToMode` | **NOT FOUND** |
| `app/preload.js` | `'athena:routine-runs'` | Binary file app/preload.js matches |
| `app/preload.js` | `'athena:nudge-guard-proposed'` | Binary file app/preload.js matches |
| `app/preload.js` | `INVOKE_CHANNELS` | Binary file app/preload.js matches |
| `app/preload.js` | `ON_CHANNELS` | Binary file app/preload.js matches |
| `app/lib/main/backend-launcher.js` | `const HEALTH_URL` | 11 |
| `app/lib/main/backend-launcher.js` | `function buildBackendEnv` | 28 |
| `app/lib/main/backend-launcher.js` | `function decideAction` | 62 |
| `backend/athena_mcp/server.py` | `routine_tools` | 41,386,389,391,411,418,758,759,769,772 |
| `backend/athena_mcp/server.py` | `draft` | 758 |
| `PAPER_APP_PARITY.md` | `에이전트` | 15,62,63,64,65,66,296,298,299,300,303,311,312,313,314,315,382 |
| `PAPER_APP_PARITY.md` | `동선 규칙` | 321,333,359,364,375 |
| `PAPER_APP_PARITY.md` | `34/34` | 371 |
| `PAPER_APP_PARITY.md` | `verify:agent-paper-parity` | 371 |
| `PAPER_APP_PARITY.md` | `rAF` | 383 |
| `app/lib/sidebar-project-menu.js` | `const MODE_CHOICES` | 18 |

## 차이 0 파일 실측(참고 — 계획의 확정 좌표 대조용)

| 파일 | 이름 | 줄 |
|---|---|---|
| `app/lib/agent-canvas.js` | `보기 전용` | 300,508,1021 |
| `app/lib/agent-canvas.js` | `동선 규칙` | 25,300,359,501,504,513,987,1444 |
| `app/lib/agent-canvas.js` | `historySettingsFields` | 997,1026 |
| `app/lib/agent-canvas.js` | `function openHistory` | 1063 |
| `app/lib/agent-canvas.js` | `function closeHistory` | 1094 |
| `app/lib/agent-canvas.js` | `body.hidden` | 1076,1104,1631 |
| `app/lib/agent-canvas.js` | `function renderDetail` | 1422 |
| `app/lib/agent-canvas.js` | `kind === 'watch'` | 1448,1533 |
| `app/lib/agent-canvas.js` | `ROUTE_RULES` | 506,515 |
| `app/lib/agent-canvas.js` | `이 화면에서는 값을 바꾸지 않습니다` | 1039 |
| `app/lib/agent-canvas.js` | `설정 — 보기 전용` | 1021 |
| `app/lib/agent-canvas.js` | `onNewTaskClick` | 153,360,365 |
| `app/lib/agent-canvas.js` | `markAllAlertsRead` | 155,275 |
| `app/probe-agent-paper-parity.js` | `보기 전용` | 15,153,264 |
| `app/probe-agent-paper-parity.js` | `동선 규칙` | 12,126,148,150,157,269 |
| `app/probe-agent-paper-parity.js` | `inputCount` | 253,269 |
| `app/probe-agent-paper-parity.js` | `ATHENA_NO_AUTOSTART` | 17 |
| `app/probe-agent-paper-parity.js` | `ATHENA_CANVAS_SOURCE` | 18 |
| `backend/athena_api/api/routines.py` | `def _view` | 108 |
| `backend/athena_api/api/routines.py` | `activation_blocker` | 131 |
| `backend/athena_api/api/routines.py` | `"missed"` | 140 |
| `backend/athena_api/api/routines.py` | `briefing-budget` | 186 |
| `backend/athena_api/api/routines.py` | `"/draft"` | 145 |
| `backend/athena_api/api/routines.py` | `/confirm` | 211 |
| `backend/athena_api/api/routines.py` | `catchup-fire` | 138,277 |
| `backend/athena_api/api/routines.py` | `/ack` | 448 |
| `backend/athena_api/api/routines.py` | `read_marks` | 118,452,461 |
| `backend/athena_api/api/routines.py` | `def _next_fire_at` | 19 |
| `backend/athena_api/api/routines.py` | `def _is_missed` | 75 |
| `backend/athena_mcp/routine_tools.py` | `_ALLOWED_ACTIONS` | 31,41,126 |
| `backend/athena_mcp/routine_tools.py` | `def dispatch` | 121 |
| `backend/athena_mcp/routine_tools.py` | `사람 클릭` | 7 |
| `backend/athena_mcp/nudge_guard_tools.py` | `_ALLOWED_ACTIONS` | 39,49,104 |
| `backend/athena_api/routines/models.py` | `SOURCES` | 42,55,109,110,111 |
| `backend/athena_api/routines/models.py` | `LEGACY_DISABLED_SOURCES` | 55,111 |
| `backend/athena_api/routines/models.py` | `def source_spec` | 107 |
| `backend/athena_api/routines/models.py` | `def derive_mode` | 101 |
| `backend/athena_api/routines/models.py` | `def human_summary` | 168 |
| `backend/athena_api/routines/models.py` | `def to_dict` | 85,181 |
| `backend/athena_api/routines/models.py` | `MIN_COOLDOWN_S` | 229 |
| `backend/athena_api/routines/models.py` | `MAX_COOLDOWN_S` | 230 |
| `backend/athena_api/routines/rules.py` | `_ALLOWED_CONDITION_KEYS` | 32,54 |
| `backend/athena_api/routines/rules.py` | `_MAX_CONSECUTIVE_TICKS` | 37,98,99 |
| `backend/athena_api/routines/rules.py` | `_SYMBOL_RE` | 33,116 |
| `backend/athena_api/routines/rules.py` | `transport != "ws"` | 100 |
| `backend/athena_api/routines/rules.py` | `def validate_draft` | 108 |
| `backend/athena_api/routines/rules.py` | `def validate_condition` | 50 |
| `backend/athena_api/routines/rules.py` | `human_summary()` | 169 |
| `backend/athena_api/routines/rules.py` | `expires_days` | 126,127,128,129,130,162 |
| `backend/athena_api/routines/runtime.py` | `def can_activate` | 71 |
| `backend/athena_api/routines/runtime.py` | `ensure_realtime_subscription` | 48,213 |
| `backend/athena_api/routines/runtime.py` | `release` | 58,174,179,190 |
| `backend/athena_api/routines/triggers.py` | `class TriggerState` | 65 |
| `backend/athena_api/routines/triggers.py` | `setdefault` | 82 |
| `backend/athena_api/routines/scheduler.py` | `list_active()` | 240,267,303 |
| `backend/athena_api/routines/guard_settings.py` | `max_daily_briefings` | 53,61,75,110,111,112,113,115,123 |
| `backend/athena_api/routines/guard_settings.py` | `max_daily_nudges` | 49,57,68,84,85,86,87,89,119 |
| `backend/athena_api/routines/guard_settings.py` | `class QuietHours` | 40 |
| `backend/athena_api/routines/guard_settings.py` | `class GuardSettings` | 35,46,128 |
| `backend/athena_api/api/nudge_guard.py` | `validate_guard_settings` | 14,26 |
| `backend/athena_api/api/nudge_guard.py` | `replace` | 25,27 |

## 파일 줄 수(차이 0 7파일)
- app/lib/agent-canvas.js: 1715줄
- app/lib/agent-canvas.test.js: 1760줄
- app/probe-agent-paper-parity.js: 309줄
- app/lib/guard-confirm.js: 79줄
- backend/athena_mcp/routine_tools.py: 172줄
- backend/athena_api/api/routines.py: 462줄
- backend/tests/mcp/test_routine_tools.py: 107줄
- probe check( 출현 수: 35 (정의부 1 포함 → 호출 34 기대)
- shell.html lib/main/* script 태그: 0건 · lib/ script 태그: 83건

## 0f Paper 사전확인 (2026-09-03 실측)
- 파일 Athena(01M0VGPX92K1TER4ZV9PWGQJJZ). 활성 페이지(기록 시점): 에이전트 A-2 → Step 5.2 복귀 대상 A-2
- 6보드: 01 56X-0 · 02 ARM-0 · 03 B57-0 · 04 BIM-0 · 05 BV0-0 · 06 2IJN-2, 전부 1680×900
- 폰트: System Sans-Serif · Daki · Daki B · Daki Title · Geist Mono (get_font_family_info는 Step 2 첫 타이포 작업 전 1회 호출)
- 토큰 실재: --color-k-faint #626B76 ✓ · --color-k-dim #5B6270 ✓ → Step 2 규율은 토큰명만 사용(hex 예외 불필요)

## baseline (Step 1) — 실측 2026-09-03 (worktree @85aee35 + 55ab631, 코드 무변경)

| 게이트 | 결과 | 비고 |
|---|---|---|
| `cd app && npm test` | **2,291 pass / 0 fail / 0 skip** (2,291 tests) | 기준선 = pass 2,291. 첫 실행(uv sync·pytest와 동시 실행)은 2,247 중 2,242 pass / 5 fail로 흔들렸다 — 단독 재실행에서 전건 통과. 동시 실행 시 플레이키 가능성 기록 |
| `npm run verify:agent-paper-parity` | **단언 실패 0건 · 최종 판정 true · 렌더러 콘솔 에러 0** | 단언 수는 소스 `check(` 호출 34(정의부 제외) — 계획 기대값과 일치. V2 게이트 = 34 + 신규 증분 |
| `cd backend && uv run pytest -q` | **3,137 passed / 32 failed / 6 skipped** (851s) | ⚠ **32건 실패는 알려진 PATH 아티팩트** — `docs/handoff/README.md` §1 경고 그대로("backend가 32건 무더기로 깨지면 코드 문제가 아니라 PATH 문제다 — `evaluate_selector_ablations.py`는 `node`를 부른다"). 이 실행은 fnm PATH 없이 백그라운드로 돌았다(예: `tests/unit/test_selector_autonomous_eval.py::test_all_critical_semantic_groups_are_green`). **기준선으로 쓰기 전에 `export PATH=<fnm multishell>:$PATH` 후 재측정해 0 failed를 확인할 것.** 전체 출력은 `docs/handoff/agent-dual-control/baseline-pytest.txt` |

- 앵커 미발견 1건 `function viewToMode`는 계획 지정 이름이 아니라 검증자가 추가한 항목 — 정의는 `app/lib/session-snapshot.js:29`, `conversations.js:13`이 import. **계획이 지정한 이름은 전부 발견.**


## baseline 재측정 (2026-09-03, 이 컴퓨터 · node v22 PATH 있음)

| 게이트 | 결과 |
|---|---|
| `cd backend && uv run pytest -q` | **3,169 passed / 0 failed / 6 skipped** (1,536s). 이전 32 failed는 node PATH 아티팩트로 확정 → 기준선 = 3,169 pass, 0 fail |
| `cd app && npm test` (Step 6-A 후) | 2,295 pass / 0 fail (기준선 2,291 + agent-session.test.js 4) |
