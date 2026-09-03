# 브랜치 통합 — 대기 중 (2026-09-03 22:20 KST)

사용자 목표는 **"모든 것을 `main`으로 옮기고 브랜치를 정리한다"** 이다.
2026-09-03 22:20에 착수했다가 **중단했다.** 지금 하면 작업이 유실되기 때문이다.
이 문서는 왜 멈췄는지와, 안전해졌을 때 무엇을 어떤 순서로 하는지를 고정한다.

## 1. 왜 멈췄나

`feat/agent-dual-control` 워크트리에 **커밋되지 않은 1,059줄**이 있고,
확인 시점 기준 **76초 전에 파일이 수정되고 있었다.**

```
22:17:45  backend/tests/unit/test_routines_core.py          ← 확인 22:19:01
22:17:14  backend/athena_api/backtest/sandbox/__main__.py
22:15:33  backend/athena_api/routines/runtime.py
22:15:03  backend/athena_api/routines/{models,rules}.py
22:11:13  docs/handoff/agent-dual-control/prd-code-alarm.json  (미추적)
```

2분 뒤 다시 재니 미커밋 항목이 **9개 → 11개**로 늘었다. 다른 세션이 코드 알람
(sandbox + routines) 작업을 **진행 중**이다.

병합은 커밋된 것만 가져온다. 이 상태에서 워크트리·브랜치를 지우면 그 1,059줄은
**복구 경로 없이 사라진다.** 사용자 규칙 "정보 유실 없어야 한다"에 정면으로 걸린다.

> 교훈: 브랜치를 지우기 전 `git log`만 보면 안 된다. **모든 워크트리의
> `git status`와 파일 mtime을 봐야** 살아 있는 작업이 보인다.

## 2. 통합 대상 (2026-09-03 22:20 스냅샷)

`origin/main` = `2ca5457` (22:16:48)

| 브랜치 | ahead | behind | 마지막 커밋 | 워크트리 미커밋 |
|---|---:|---:|---|---|
| `feat/plugin-mode-doctrine` | 16 | 22 | 16:34 | **0 — 깨끗** |
| `codex/kiumi-mini-cards-runtime` | 14 | 82 | 22:10 | 원격 전용 |
| `feat/card-surface-paper-to-code` | 14 | 82 | 21:36 | 원격 전용 |
| `feat/agent-dual-control` | 7 | 22 | 16:03 | **11개 (1,059줄) ⚠** |
| `kiumi/mini-cards` | 2 | 82 | 10:27 | 원격 전용 |

`kiumi/mini-cards`는 `codex/kiumi-mini-cards-runtime`에 **완전히 포함**된다
(`git merge-base --is-ancestor` 확인). 병합할 필요 없이 **삭제만** 하면 된다.
실질 병합 대상은 4개.

## 3. 통합 전 체크리스트 — 이게 끝나야 시작한다

각 브랜치 소유 세션이 다음을 끝내야 한다.

- [ ] `feat/agent-dual-control` — 미커밋 1,059줄을 커밋하고 push
- [ ] `codex/kiumi-mini-cards-runtime` — 작업 종료 후 push (22:10 활동)
- [ ] `feat/card-surface-paper-to-code` — 작업 종료 후 push (21:36 활동)
- [ ] `feat/plugin-mode-doctrine` — 이미 깨끗. 소유 세션이 끝났는지만 확인

착수 직전 **반드시** 다시 확인한다. 이 표는 몇 분이면 낡는다:

```bash
git fetch --prune origin
git worktree list --porcelain | grep '^worktree' | sed 's|worktree ||' | while read -r w; do
  printf "%-70s %s개\n" "$w" "$(git -C "$w" status --porcelain 2>/dev/null | wc -l)"
done
```

모든 워크트리가 0개(또는 무시해도 되는 `backend/rtk/` 뿐)여야 시작한다.

## 4. 병합 순서와 명령

behind가 작은 것부터 — 충돌 면적이 작다.

1. `feat/plugin-mode-doctrine` (behind 22)
2. `feat/agent-dual-control` (behind 22)
3. `codex/kiumi-mini-cards-runtime` (behind 82)
4. `feat/card-surface-paper-to-code` (behind 82)

각 병합마다:

```bash
git merge --no-ff -X ignore-cr-at-eol origin/<브랜치>
```

**`-X ignore-cr-at-eol`은 선택이 아니다.** `.gitattributes`가 `* -text`라 git이 줄바꿈을
정규화하지 않는다. 빼면 유령 충돌이 3배로 늘고 커밋에 수천 줄 가짜 변경이 박힌다.

병합 직후 노이즈를 대조한다 — 두 숫자가 **같아야** 한다:

```bash
git diff --shortstat HEAD~1 HEAD
git diff --shortstat --ignore-cr-at-eol HEAD~1 HEAD
```

다르면 그 차이가 노이즈 줄 수다. 커밋에 남기지 말고 바이트를 되돌린다.

## 5. 병합 후 전수 검증

병합 4건이 서로 텍스트 충돌 0이어도 **계약은 어긋난다.** 병렬 브랜치는 서로의 과거를
테스트에 굳혀 놓는다(2026-09-01 실측: 라우트 수 단언 362→376이 그렇게 깨졌다).
전수 검증이 유일한 그물이다.

```bash
node scripts/gates/check-orb.mjs && node scripts/gates/check-glass-ladder.mjs && node scripts/gates/check-window-model.mjs && node scripts/gates/check-harness-freshness.mjs
```

```bash
cd app && npm run test:unit
```

```bash
cd backend && uv run pytest -q -p no:randomly
```

기준선은 `docs/handoff/README.md` §6. 단 그 숫자는 2026-09-01 측정치이므로
**병합 전 main에서 한 번 재서 새 기준선을 잡고** 병합 후와 대조한다.

## 6. 정리 — 여기서 유실이 난다

검증이 초록인 뒤에만.

```bash
git push origin main
```

브랜치 삭제 **전에** 각 브랜치의 tip이 main에 실제로 들어갔는지 확인한다:

```bash
git merge-base --is-ancestor origin/<브랜치> main && echo "안전" || echo "중단 — main에 없는 커밋 있음"
```

`kiumi/mini-cards`는 병합 없이 이 확인만으로 삭제 가능하다.

워크트리는 `git worktree remove` 로 지운다. Windows에서 프로세스 잠금으로
`Permission denied`가 나면 파일은 지워지고 빈 디렉터리만 남는다 — 재부팅 후 사라지며
git 등록은 이미 해제되므로 문제되지 않는다.

## 7. 끝난 뒤

`docs/handoff/README.md` §1 상태표와 미병합 브랜치 표를 갱신한다.
`docs/handoff/RALPH_PROMPT.md` 맨 위 경고 배너도 함께 정리한다 —
브랜치가 다시 `main` 하나가 되면 그 배너의 전제가 해소된다.
