# Ralph 프롬프트 — 에이전트 이중 제어 트랙 이어받기 (2026-09-03)

아래 블록을 통째로 복사해 Claude Code에 붙여넣는다. **worktree 안에서**(EnterWorktree 후) 실행한다.
사전 절차(worktree·`.omc/` 복원·의존성)는 [../2026-09-03-agent-dual-control-handoff.md](../2026-09-03-agent-dual-control-handoff.md) §5.

---

```
/oh-my-claudecode:ralph

# 목표

합의 승인 계획 `.omc/plans/athena-agent-doctrine-plan.md`(Status: approved for execution — ralph)를 Step 2부터 끝까지 실행한다.
에이전트 모드를 "두 입구, 한 게이트"로 만든다 — 제어 인벤토리 A~E의 모든 동작이 대화(제안 턴 → 사람 칩 → IPC)로도, GUI(시트·폼·버튼 → 같은 IPC)로도 된다.
범위 권위는 `.omc/specs/deep-interview-athena-agent-doctrine.md`다. 넓히지도 좁히지도 않는다.

# 0. 시작 전에 읽을 것 (추측으로 시작하지 않는다)

1. `docs/handoff/2026-09-03-agent-dual-control-handoff.md` — 단일 진입점. §3 진행 상태, §4 베이스라인, §6 지킬 것.
2. `.omc/plans/athena-agent-doctrine-plan.md` — 실행 계획 정본. 머리말의 앵커 규율(이름이 계약, 줄 번호는 참고)과 §4 실행 순서 표 `0 → 1 → 2 → 3 → 4 → 6-A → 5(🛑) → 6-B → 7 → 8 → 9(🛑)`.
3. `.omc/plans/anchors-note.md` — 이 tip에서 실측한 앵커 줄 번호와 Step 1 베이스라인. 편집 전 여기서 줄을 다시 찾는다.
4. `.omc/plans/open-questions.md` — U-1~U-6은 Step 5에서 사용자에게 묻는다.
5. PRD: `.omc/state/sessions/handoff/prd.json` (US-000·US-001은 완료 표시, US-002부터). progress: 같은 폴더 `progress.txt`.

Step 0·1은 완료됐다(worktree @85aee35, 헌장 커밋 55ab631, npm ci, uv sync --extra dev, 앵커 재측정, 베이스라인). 다시 하지 않는다.

# 1. 지킬 것

- 이 worktree(`feat/agent-dual-control`) 밖의 파일은 만지지 않는다. 메인 체크아웃에는 다른 트랙의 미커밋 19파일이 있다. 병합·stash 금지.
- 사람 정지점 2개에서 반드시 멈춘다: Step 5(PDF 검수 + U-1~U-6 답) · Step 9(라이브 시연 — 9a·9b까지 하고 정지 보고). 시연하지 않은 행을 통과로 적지 않는다.
- Paper: `get_guide` 먼저 · `open_file(A-2)`로 활성화 · 첫 타이포 전 `get_font_family_info` 1회 · 아트보드 `fit-content` 금지 · `write_html` 소단위 · 색은 토큰만(`--color-k-faint`·`--color-k-dim` 실재) · 보드마다 `get_screenshot` 검토 · 끝나면 활성 페이지 복귀 + `finish_working_on_nodes`.
- 문구 3원칙(설명문 금지·한국어 단위·내부어 금지). 이중 제어 규칙 3줄은 계획 Step 3의 확정 문구가 Paper·앱·테스트·프로브의 단일 원본.
- 각 Step은 계획의 「검증」·「충족 AC」가 통과해야 다음으로 간다. 베이스라인 대비 테스트 감소 0.
- 환경: node는 fnm multishell PATH(계획 §6.1). Git Bash python은 `export PYTHONUTF8=1`. worktree 세션은 git 포함 복합 셸 명령을 거부한다 → 스크립트 파일로.
- OMC 상태 서버가 없으면 PRD/progress를 `.omc/state/sessions/handoff/`에 직접 갱신한다.

# 2. 완료 게이트

계획 §6.2의 V0~V12 전건 + AC ①(Paper 12) ②(실앱 13) ③(라이브 4). 사람 정지점의 승인·시연 결과 없이는 완료로 선언하지 않는다.
```
