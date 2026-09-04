# 브랜치 통합 — 완료 (2026-09-03 22:20 중단 → 23:38 재개 → 09-04 01:00 완료)

사용자 목표는 **"모든 것을 `main`으로 옮기고 브랜치를 정리한다"** 이다.
2026-09-03 22:20에 착수했다가 **중단했고**(§1~§7, 당시 기록 그대로), 사용자가 재확인한 뒤
23:38에 재개해 09-04 01:00에 끝냈다. 실제로 일어난 일은 **§8**에 있다.

## 8. 실제로 한 것 (2026-09-04)

**병합 8건** (전부 `--no-ff -X ignore-cr-at-eol`, 병합마다 EOL 노이즈 0 확인):

| # | 브랜치 | 커밋 | 충돌 |
|---|---|---|---|
| 1 | feat/plugin-mode-doctrine (16) | b617dd7 | 0 |
| 2 | feat/agent-dual-control (8, wip 스냅샷 6c1d248 포함) | 49c694b | main.js 병렬 함수 삽입 2개 → 둘 다 유지 · README 배너 2개 → 둘 다 유지 |
| 3 | codex/kiumi-mini-cards-runtime (15, kiumi/mini-cards 포함) | 73e092d | test_inventory_api 라우트 핀 404 vs 377 → **실측 408**(+1 board-hydrate, +3 routines) |
| 4 | feat/card-surface-paper-to-code (15) | a408bb6 | 15개 — 13개는 card-surface만 진화시킨 파일이라 theirs, `slots.json` 2개는 `html_sha256`을 **LF 정규화 board.html 실측 해시**로 |
| 5 | feat/agent-dual-control 후속 (Step 3·4, fac086e) | 1f07ae1 | 0 |
| 6 | ANNJUNGCHAN/main (Orca, cd0b98e) | cc7d2cc | 0 |
| 7 | feat/card-surface-paper-to-code 후속 (G4, d612cb5) | c6efc21 | 0 — **삭제 사고 후 복구해 병합** |
| 8 | feat/plugin-mode-doctrine 후속 (a18aaf4) | 6e26c6f | plugin-canvas 클래스 이름 `proposal-boundary` vs `proposals-note` → main에 먼저 들어온 이름으로 통일, CSS 합집합, 테스트 셀렉터 3곳 갱신 |

**유실 방지.** agent-dual-control 워크트리의 미커밋 1,062줄은 마지막 수정 79분 뒤 `wip` 커밋(6c1d248)으로
브랜치에 먼저 고정하고 push한 뒤 병합했다(py_compile 전부 통과, 그 테스트 113 passed).

**병합이 드러낸 회귀 4건 → 96211a0에서 수정.** `verify-semantic-workspaces`가 병합 전 PASS → 후 FAIL.
이분탐색(mid PASS · kiumi 병합 후 FAIL · kiumi tip 자체 FAIL)과 렌더러 MutationObserver 덤프로 갈랐다.
① 보드 표면이 앱 렌더러(AITS 차트·호가·주문)를 가로챔 → `paperCardRouting.preservesAppPrimary` ②
탭 덱이 DOM에서 떨어져도 캐시가 카드를 삼킴 → `isConnected` 자가복구 ③ 순위 축 칩 `title`에 원시
ref 누출 → 속성 제거, 검증기는 라벨로 판정 ④ Paper 커버리지 앵커(`data-name="raw · base:… · $.…"`)
157개 제품 DOM 누출 → 마운트 시 식별자 모양만 scrub. 넷 중 셋은 kiumi/card-surface tip에서 이미
빨갔던 것(작성 회귀), ②는 이 병합이 처음 드러냈다. 라우트 핀은 fac086e의 watch/code 1개로 다시 409.

**삭제.** `codex/kiumi-mini-cards-runtime` · `kiumi/mini-cards` · 로컬 `claude/settings-plugin-tab-absorption-6d550f`.
**사고 1건**: ancestor 검사 결과를 출력만 하고 세 이름을 한 `--delete`에 넘겨, 검사에서 "미포함"이던
`feat/card-surface-paper-to-code`(9분 전 Codex가 push한 b77da21·d612cb5)까지 지웠다. `git fetch --prune`이
원격추적 reflog도 지우므로 `git fsck --unreachable --no-reflogs`로 두 커밋을 찾아 부모 사슬로 확인한 뒤
`git push origin d612cb5:refs/heads/…`로 되살리고 main에 병합했다. 유실 0. 재발 방지 규칙은 README §1.

**남긴 것.** 원격 4개(agent-dual-control · plugin-mode-doctrine · card-surface · ANNJUNGCHAN/main)는 tip이
전부 main에 있지만 소유 세션이 그 시각에도 push 중이어서 지우지 않았다. 워크트리 4개(로컬 2 + Orca 2)도
같은 이유로 그대로다. `verify:integrated-cards`의 M 프로브 실패는 card-surface 트랙의 미완 항목이라
고치지 않았다(그 tip에서도 동일).

**환경 사고 1건**: 이분탐색용 임시 워크트리에 `app/node_modules` 정션을 걸고 `git worktree remove --force`
했더니 정션을 타고 본체 `node_modules`가 비었다(추적 파일 무사). `npm install` + `electron/install.js`로 복구.

---

> 아래 §1~§7은 2026-09-03 22:20 중단 시점의 기록이다. 재개 절차 참고용으로 그대로 둔다.

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
