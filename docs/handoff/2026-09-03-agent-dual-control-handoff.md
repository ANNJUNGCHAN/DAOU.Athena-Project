# 인계 — 에이전트 모드 "두 입구, 한 게이트" (feat/agent-dual-control, 2026-09-03)

이 문서는 **에이전트 모드 이중 제어 트랙**을 다른 세션·다른 컴퓨터에서 이어받기 위한 단일 진입점이다.
브랜치 `feat/agent-dual-control`은 `origin/main` tip(`85aee35`)에서 딴 **worktree 전용 브랜치**이며 병합하지 않는다(사용자 확정).

> **바로 이어서 돌리려면** [agent-dual-control/RALPH_PROMPT.md](./agent-dual-control/RALPH_PROMPT.md)의 블록을 통째로 복사해 Claude Code에 붙여넣는다.

---

## 1. 무엇을 하는 트랙인가 (한 문단)

에이전트 모드를 두 기조에 맞춘다. **D1** — 화면 35·38번 보드의 "모드가 대화의 경계다": 에이전트는 `mode='agent'` 대화 창이고 **관제 창 하나 = 대화 하나**(루틴·알람·제안·실행이 한 방으로 흐른다), 01번 "알림 파생 방"은 오브 진입 예외 창. **D2** — "대화로 에이전트의 모든 요소를 제어한다"를 **이중 완전 제어**로: 제어 인벤토리 A(작업 생명주기)·B(알람)·C(제안·가드)·D(뷰 상태)·E(실행)의 **모든 동작이 대화로도 GUI로도** 된다. 게이트는 하나 — 대화 경로는 `athena_routine` 제안 툴 → `main.js` 릴레이 → `chat.js` 제안 턴 카드 → **사람 칩 클릭** → 기존 `athena:routine-*` IPC, GUI 경로는 `agent-canvas.js` 시트·폼·버튼 → **같은 IPC**.

## 2. 정본 문서 (읽는 순서)

| 순서 | 문서 | 역할 |
|---|---|---|
| 1 | [agent-dual-control/athena-agent-doctrine-plan.md](./agent-dual-control/athena-agent-doctrine-plan.md) | **실행 계획 정본** (RALPLAN-DR 합의 6차 APPROVE, Step 0~9, AC ①②③, 리스크 R1~R33, ADR). `.omc/plans/`의 사본. 앵커는 **이름이 계약**, 줄 번호는 참고 |
| 2 | [agent-dual-control/deep-interview-athena-agent-doctrine.md](./agent-dual-control/deep-interview-athena-agent-doctrine.md) | 범위 권위(스펙, 모호도 17%). 계획이 이 스펙을 넓히거나 좁히지 않는다 |
| 3 | [agent-dual-control/open-questions.md](./agent-dual-control/open-questions.md) | 미결 항목 — U-1~U-6은 Step 5 PDF 검수 때 사용자에게 묻는다 |
| 4 | [agent-dual-control/anchors-note.md](./agent-dual-control/anchors-note.md) | Step 0e 앵커 실측표 + 0f Paper 사전확인 + Step 1 베이스라인 |
| 5 | [agent-dual-control/prd.json](./agent-dual-control/prd.json) · [progress.txt](./agent-dual-control/progress.txt) | ralph PRD(US-000~US-010, Step 1:1) · 진행 기록 |
| 참고 | `.omc/specs/deep-interview-athena-plugin-doctrine.md` (메인 체크아웃, 비커밋) | 병렬 플러그인 트랙 스펙 — "두 입구, 한 게이트" 어휘 공유 |

`.omc/`는 gitignore라 **worktree마다 존재하지 않는다.** 위 `docs/handoff/agent-dual-control/` 사본이 저장소에 실리는 정본이고, 새 환경에서는 §5의 절차로 `.omc/`에 되돌려 놓는다.

## 3. 어디까지 왔나 (2026-09-03)

| Step | 상태 | 증거 |
|---|---|---|
| 인터뷰 → 스펙 | ✅ | 7라운드, 모호도 17%, 스펙 PASSED |
| 합의 계획 | ✅ | Planner/Architect/Critic 6차 APPROVE(수락 기준 30/30 구체), Status `approved for execution — ralph` |
| 0a worktree | ✅ | `.claude/worktrees/agent-dual-control` @ `85aee35`, 브랜치 `feat/agent-dual-control`, status 빈 출력 |
| 0b `.omc` 이관 | ✅ | plans/specs 복사(비커밋) |
| 0c 헌장 커밋 | ✅ | `55ab631 docs(ui): 카드 표면 헌장을 …` |
| 0c-2 EnterWorktree | ✅ | 세션 cwd = worktree |
| 0d 의존성 | ✅ | `npm ci`, `uv sync --extra dev`(pytest는 `dev` extra에 있다 — `uv sync`만으로는 `pytest` 없음) |
| 0e 앵커 재측정 | ✅ | `anchors-note.md` — 계획이 지정한 이름 전부 발견(`viewToMode`는 `session-snapshot.js:29`에서 import, 정정 아님) |
| 0f Paper 사전확인 | ✅(부분) | A-2 활성·6보드 대조·토큰 2종 실재. `get_font_family_info`는 Step 2 첫 타이포 전 1회 남음 |
| 1 베이스라인 | ⚠ | §4 참조 — **app 단위 5건이 origin/main tip에서 이미 실패** |
| 2~4 Paper | ⏳ 미착수 | 다음 세션 시작점 |
| 6-A 백엔드·IPC | ⏳ | Paper 4 뒤, Step 5 앞 |
| 5 🛑 PDF 검수 | ⏳ | 사람 정지점 ① |
| 6-B·7·8 | ⏳ | 검수 승인 후 |
| 9 🛑 라이브 시연 | ⏳ | 사람 정지점 ② |

## 4. 베이스라인 (Step 1, worktree @85aee35)

| 게이트 | 결과 | 비고 |
|---|---|---|
| `cd app && npm test` | **2,291 / 2,291 pass, 0 fail** | 기준선 pass 2,291. (uv sync·pytest와 동시에 돌린 첫 실행은 2,242/2,247로 흔들렸다 — 단독 실행에서 전건 통과. 동시 실행 금지) |
| `npm run verify:agent-paper-parity` | **34 단언, 실패 0, 콘솔 에러 0, 최종 판정 true** | V2 게이트 = 34 + 신규 증분 |
| `cd backend && uv run pytest -q` | **3,137 passed / 32 failed / 6 skipped** | ⚠ 32건은 **알려진 PATH 아티팩트**(README §1: `evaluate_selector_ablations.py`가 `node`를 부른다) — fnm PATH 없이 돌았다. **새 세션은 PATH를 얹고 재측정해 0 failed를 기준선으로 확정**한다. `uv sync --extra dev` 선행 |

## 5. 다른 환경에서 이어받는 절차

```bash
# 1) 저장소 clone 후 브랜치 worktree로 (메인 체크아웃은 건드리지 않는다)
git fetch origin
git worktree add .claude/worktrees/agent-dual-control feat/agent-dual-control   # 원격에 브랜치가 있을 때
#   없으면: 이 브랜치를 먼저 push한 컴퓨터에서 `git push -u origin feat/agent-dual-control`

# 2) .omc/ 복원 (gitignore) — 저장소 사본을 되돌려 놓는다
WT=.claude/worktrees/agent-dual-control
mkdir -p $WT/.omc/plans $WT/.omc/specs $WT/.omc/state/sessions/handoff
cp docs/handoff/agent-dual-control/athena-agent-doctrine-plan.md $WT/.omc/plans/
cp docs/handoff/agent-dual-control/open-questions.md             $WT/.omc/plans/
cp docs/handoff/agent-dual-control/anchors-note.md               $WT/.omc/plans/
cp docs/handoff/agent-dual-control/deep-interview-athena-agent-doctrine.md $WT/.omc/specs/
cp docs/handoff/agent-dual-control/prd.json docs/handoff/agent-dual-control/progress.txt $WT/.omc/state/sessions/handoff/

# 3) Claude Code 세션에서 EnterWorktree { path: ".claude/worktrees/agent-dual-control" }
# 4) 의존성
export PATH="/c/Users/<you>/AppData/Local/fnm_multishells/$(ls -t /c/Users/<you>/AppData/Local/fnm_multishells | head -1):$PATH"   # Git Bash
cd $WT/app && npm ci
cd $WT/backend && uv sync --extra dev
```

그 다음 [RALPH_PROMPT.md](./agent-dual-control/RALPH_PROMPT.md)를 붙여넣는다. ralph는 PRD의 `US-002`(Step 2 Paper 01~04)부터 시작한다.

## 6. 반드시 지킬 것 (계획이 정한 것 + 이 세션의 학습)

- **worktree 밖 파일은 만지지 않는다.** 메인 체크아웃에는 카드 표면 트랙 미커밋 19파일이 있다. 병합·stash·커밋 금지.
- **사람 정지점 2개**: Step 5(PDF 검수 + U-1~U-6 답) · Step 9(라이브 시연). 여기서 ralph는 멈추고 보고한다. 시연하지 않은 행을 통과로 적지 않는다.
- **실행 순서**: `0 → 1 → 2 → 3 → 4 → 6-A → 5(🛑) → 6-B → 7 → 8 → 9(🛑)`. 6-A는 번호와 달리 Step 5 앞이다.
- **Paper**: `get_guide` 선행 · `open_file(A-2)`로 활성화(빈 스크린샷 = 미마운트) · 아트보드 `fit-content` 금지(검은 스크린샷 = 높이 붕괴) · `write_html` 소단위 · 토큰만(`--color-k-faint`·`--color-k-dim` 실재) · 작업 후 활성 페이지 복귀 + `finish_working_on_nodes`. Paper 파일 `01M0VGPX92K1TER4ZV9PWGQJJZ`, 페이지 A-2, 보드 `01 56X-0 · 02 ARM-0 · 03 B57-0 · 04 BIM-0 · 05 BV0-0 · 06 2IJN-2`.
- **문구 3원칙**: 설명문 금지(상태 표기만) · 한국어 단위 · 내부어 금지. 이중 제어 규칙 3줄은 계획 Step 3의 확정 문구가 단일 원본이다.
- **환경**: Git Bash에서 node는 fnm multishell PATH 필요. Git Bash의 python은 stdin을 cp949로 읽는다 → 한국어 heredoc은 `export PYTHONUTF8=1` 선행(또는 파일로 쓴다). worktree 세션은 git을 포함한 복합 셸 명령을 거부한다 → 스크립트 파일로 만들어 `bash <file>`.
- **OMC 상태 서버**가 이 환경에서 연결되지 않았다 → PRD/progress는 `.omc/state/sessions/<sid>/`에 수동 관리(`state_write` 없음). 메인 체크아웃의 `.omc/prd.json`·`ralplan-state.json`은 **다른 트랙 소유**(카드 커버리지·키우미) — 건드리지 않는다.
- **앵커**: 계획의 줄 번호는 참고값. 편집 전 `anchors-note.md`의 실측 줄 또는 이름 grep으로 다시 찾는다.

## 7. 이 세션이 남긴 산출물 위치

| 산출물 | 경로 | 커밋 여부 |
|---|---|---|
| 헌장 문서 | `docs/ui/paper-card-surface-charter.md` | ✅ `55ab631` |
| 인계 문서·사본 | `docs/handoff/2026-09-03-agent-dual-control-handoff.md`, `docs/handoff/agent-dual-control/*` | ✅ 이 커밋 |
| 계획·스펙·PRD 원본 | `<worktree>/.omc/plans/*`, `.omc/specs/*`, `.omc/state/sessions/99345b72-…/` | ✗ gitignore (사본이 위) |
| 앵커 스크립트 | `<worktree>/.omc/anchors.sh` | ✗ (사본 `docs/handoff/agent-dual-control/anchors.sh`) |
| 베이스라인 TAP | `<worktree>/.omc/baseline-npm-test.tap` | ✗ (요약은 anchors-note.md) |
| 메인 체크아웃 인터뷰 상태 | `C:/Projects/DAOU.Athena/.omc/state/deep-interview-state.json` | ✗ |

원격 push는 이 세션이 하지 않았다 — 다른 컴퓨터로 넘기려면 `git push -u origin feat/agent-dual-control`.
