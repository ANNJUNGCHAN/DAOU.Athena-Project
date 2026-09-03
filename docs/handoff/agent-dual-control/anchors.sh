#!/usr/bin/env bash
# Step 0e — 앵커 재측정 (읽기 전용 grep). worktree 루트에서 실행: bash .omc/anchors.sh
N=.omc/plans/anchors-note.md
f(){ file="$1"; shift; for n in "$@"; do hits=$(grep -nF -- "$n" "$file" 2>/dev/null | cut -d: -f1 | paste -sd, -); [ -z "$hits" ] && hits="**NOT FOUND**"; echo "| \`$file\` | \`$n\` | $hits |"; done; }
{
echo "# 앵커 재측정 노트 — feat/agent-dual-control @ 85aee35(origin/main tip) + 55ab631(헌장 커밋) (2026-09-03)"
echo
echo "이름이 계약이고 줄 번호는 이 tip에서의 실측값이다. 계획 본문에는 숫자를 되쓰지 않는다."
echo
echo "## 이동 9파일 + 신규 파일"
echo
echo "| 파일 | 이름 | 줄 |"; echo "|---|---|---|"
f app/main.js "function maybeForwardNudgeGuardProposal" "function maybeForwardGraphChatAction" "function maybeForwardBacktestChatAction" "function extractToolResultText" "async function routineHttp" "ipcMain.handle('athena:nudge-guard-set'" "ipcMain.handle('athena:routine-missed-confirm'" "ipcMain.handle('athena:routine-ack'" "maybeForwardNudgeGuardProposal(step, block)" "require('./lib/backtest-spec')"
f app/chat.js "function renderGuardConfirmCard" "const onNudgeGuardProposed" "canvasMode:" "function renderApprovalCard(" "const preview = _btn('미리보기 실행'" "const activate = _btn('바로 활성화'" "SOURCES 카탈로그" "invoke('athena:routine-confirm'" "window.AthenaCanvasMode.state.view" "routine-approval-actions"
f app/canvas.js "createAgentCanvas({" "seedChatInput" "fetchRuns:" "fetchAvgDuration:" "fetchEngagement:" "onOpenGraph:" "pauseRoutine" "resumeRoutine"
f app/lib/sidebar.js "markAllRead:" "function handleRoutineEvent" "async function hydrateNotifyRooms" "'athena:routine-engagement'" "async function startNewConversation"
f app/lib/main/conversations.js "viewToMode(row.mode)" "function touch(" "state.conversations.push({" "state.activeMode = conversation.mode" "function viewToMode"
f app/preload.js "'athena:routine-runs'" "'athena:nudge-guard-proposed'" "INVOKE_CHANNELS" "ON_CHANNELS"
f app/lib/main/backend-launcher.js "const HEALTH_URL" "function buildBackendEnv" "function decideAction"
f backend/athena_mcp/server.py "routine_tools" "draft"
f PAPER_APP_PARITY.md "에이전트" "동선 규칙" "34/34" "verify:agent-paper-parity" "rAF"
f app/lib/sidebar-project-menu.js "const MODE_CHOICES"
echo
echo "## 차이 0 파일 실측(참고 — 계획의 확정 좌표 대조용)"
echo
echo "| 파일 | 이름 | 줄 |"; echo "|---|---|---|"
f app/lib/agent-canvas.js "보기 전용" "동선 규칙" "historySettingsFields" "function openHistory" "function closeHistory" "body.hidden" "function renderDetail" "kind === 'watch'" "ROUTE_RULES" "이 화면에서는 값을 바꾸지 않습니다" "설정 — 보기 전용" "onNewTaskClick" "markAllAlertsRead"
f app/probe-agent-paper-parity.js "보기 전용" "동선 규칙" "inputCount" "ATHENA_NO_AUTOSTART" "ATHENA_CANVAS_SOURCE"
f backend/athena_api/api/routines.py "def _view" "activation_blocker" "\"missed\"" "briefing-budget" "\"/draft\"" "/confirm" "catchup-fire" "/ack" "read_marks" "def _next_fire_at" "def _is_missed"
f backend/athena_mcp/routine_tools.py "_ALLOWED_ACTIONS" "def dispatch" "사람 클릭"
f backend/athena_mcp/nudge_guard_tools.py "_ALLOWED_ACTIONS"
f backend/athena_api/routines/models.py "SOURCES" "LEGACY_DISABLED_SOURCES" "def source_spec" "def derive_mode" "def human_summary" "def to_dict" "MIN_COOLDOWN_S" "MAX_COOLDOWN_S"
f backend/athena_api/routines/rules.py "_ALLOWED_CONDITION_KEYS" "_MAX_CONSECUTIVE_TICKS" "_SYMBOL_RE" "transport != \"ws\"" "def validate_draft" "def validate_condition" "human_summary()" "expires_days"
f backend/athena_api/routines/runtime.py "def can_activate" "ensure_realtime_subscription" "release"
f backend/athena_api/routines/triggers.py "class TriggerState" "setdefault"
f backend/athena_api/routines/scheduler.py "list_active()"
f backend/athena_api/routines/guard_settings.py "max_daily_briefings" "max_daily_nudges" "class QuietHours" "class GuardSettings"
f backend/athena_api/api/nudge_guard.py "validate_guard_settings" "replace"
echo
echo "## 파일 줄 수(차이 0 7파일)"
for x in app/lib/agent-canvas.js app/lib/agent-canvas.test.js app/probe-agent-paper-parity.js app/lib/guard-confirm.js backend/athena_mcp/routine_tools.py backend/athena_api/api/routines.py backend/tests/mcp/test_routine_tools.py; do echo "- $x: $(wc -l < "$x")줄"; done
echo "- probe check( 출현 수: $(grep -c 'check(' app/probe-agent-paper-parity.js) (정의부 1 포함 → 호출 34 기대)"
echo "- shell.html lib/main/* script 태그: $(grep -c 'lib/main/' app/shell.html)건 · lib/ script 태그: $(grep -c '<script src="lib/' app/shell.html)건"
echo
echo "## 0f Paper 사전확인 (2026-09-03 실측)"
echo "- 파일 Athena(01M0VGPX92K1TER4ZV9PWGQJJZ). 활성 페이지(기록 시점): 에이전트 A-2 → Step 5.2 복귀 대상 A-2"
echo "- 6보드: 01 56X-0 · 02 ARM-0 · 03 B57-0 · 04 BIM-0 · 05 BV0-0 · 06 2IJN-2, 전부 1680×900"
echo "- 폰트: System Sans-Serif · Daki · Daki B · Daki Title · Geist Mono (get_font_family_info는 Step 2 첫 타이포 작업 전 1회 호출)"
echo "- 토큰 실재: --color-k-faint #626B76 ✓ · --color-k-dim #5B6270 ✓ → Step 2 규율은 토큰명만 사용(hex 예외 불필요)"
echo
echo "## baseline (Step 1)"
echo "(아래에 기록)"
} > "$N"
echo "NOT FOUND count: $(grep -c 'NOT FOUND' "$N")"
grep 'NOT FOUND' "$N" | head -20
wc -l "$N"
