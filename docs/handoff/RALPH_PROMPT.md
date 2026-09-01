# Ralph 프롬프트 — 다른 컴퓨터에서 이어받기 (2026-09-01)

아래 블록을 통째로 복사해 새 컴퓨터의 Claude Code에 붙여넣는다.
저장소를 clone한 뒤 **저장소 루트에서** 실행한다.

---

```
/oh-my-claudecode:ralph

# 목표

Athena를 "완성됐다"고 말할 수 있는 상태까지 끌고 간 뒤, 그 판단을 전수 테스트로 증명한다.
지금은 장중이므로 장중에만 가능한 검증을 반드시 포함한다.

완성의 정의는 "남은 일이 없다"가 아니라 **"§6의 완료 게이트가 전부 실제 증거로 충족됐다"** 이다.
게이트가 하나라도 미달이면 완료로 선언하지 않고 루프를 계속한다.

# 0. 시작 전에 읽을 것 (추측으로 시작하지 않는다)

`docs/handoff/README.md` 가 단일 진입점이다. 먼저 이것을 읽고, 거기서 가리키는 정본 문서 4개를 읽는다.

- `docs/handoff/2026-09-01-paper-card-wiring.md` — Paper 카드 배선
- `docs/architecture/backtest-mode-plan.md` — 백테스트 모드
- `KIUMI_AUDIT_STATUS.md` — 키우미 전수 검사
- `docs/handoff/beta-test-3day/README.md` — 3일 실사용 베타테스트

이 문서들에 **"이미 사실로 확인된 것 / 다시 조사하지 말 것"** 으로 못박힌 항목은 다시 조사하지 않는다.
특히 다음 두 가지를 다시 뒤집으려 하지 말 것:

- 레거시 16개 `card-kind-*.js`는 잔재가 아니라 CC 카드의 **본문**이다. 삭제하면 CC-04 호가
  래더와 CC-03 AITS 차트가 사라진다.
- `canvas_push`의 카드 계약 게이트를 "operation_ref만 있으면 항상 파생"으로 넓히는 변경은
  이미 한 번 했다가 **보안 회귀로 되돌렸다.** 이유는 핸드오프 문서 §3에 있다.

# 1. 작업 규칙 — 어기지 않는다

- **브랜치를 만들지 않는다.** `main`에서만 수정한다. 작업 끝에도 브랜치는 `main` 하나여야 한다.
  - 유일한 예외: `KIUMI_AUDIT_STATUS.md` §2.3의 기준선 대조는 부모 커밋 `b1d1b08`을 별도
    체크아웃으로 꺼내야 한다. 이때만 **detached** worktree를 쓰고, 커밋하지 않고, 대조가 끝나면
    `git worktree remove` 로 즉시 지운다.
- **한 단계가 끝날 때마다: 변경 확인 → 커밋 → 즉시 push.** 쌓아두지 않는다.
  다른 컴퓨터로 넘어가지 않은 미커밋 변경이 이 프로젝트에서 실제로 두 번 발생했다.
- 커밋 메시지는 **한국어**로, 무엇을 왜 바꿨는지 쓴다. `git log --oneline -20` 으로 기존 형식을
  먼저 보고 맞춘다. 마지막 줄에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- push가 오래 걸리면 pre-push 훅이 게이트 4종 + app 단위 전체를 도는 중이다. **훅을 우회하지 않는다**
  (`--no-verify` 금지). 훅이 막으면 그건 실제로 빨간 것이다.
- 인계에 필요한 문서는 반드시 `docs/` 아래에 커밋한다. `artifacts/`·`.omc/`·`.claude/` 는
  `.gitignore` 대상이라 다른 컴퓨터로 넘어가지 않는다. 거기엔 버려도 되는 증거만 둔다.

# 2. 환경 준비 (최초 1회)

```bash
git checkout main && git pull --ff-only && git log --oneline -1
```

```bash
git config core.hooksPath scripts/hooks
```

이 줄을 빠뜨리면 pre-push 안전망이 **에러 없이 조용히 사라진다.** `.git/hooks/`는 clone으로 따라오지 않는다.

```bash
cd app && npm install && node node_modules/electron/install.js
```

`install.js`는 형식적인 단계가 아니다. `npm install`이 electron 바이너리를 조용히 빠뜨리는 일이
이 프로젝트에서 반복 재현됐다 — npm은 성공으로 끝나고 앱만 안 뜬다.

```bash
cd backend && uv sync --extra dev
```

`node`가 없으면 fnm 환경이다(`fnm env`). 게이트는 **plain node**로 실행한다 — `cmd /c` 경유 시
rtk 훅이 명령을 훼손한 실측이 있다.

# 3. 남은 일 — 이것을 닫아야 "완성"이다

`docs/handoff/README.md` §4의 표가 정본이다. 요약하면:

1. **backend 전수 pytest 재실행** — `289ca65`(canvas_push 되돌리기) 위에서 끝까지 돈 적이 없다.
   직전 `b414e06`에서는 2,584 passed / 5 skipped / 0 failed였다. 약 25~30분.
2. **키우미 오브 프로브 20개** — 9/20에서 끊겼다. `KIUMI_AUDIT_STATUS.md` §2.3의 **기준선 대조**가
   다음 단계다. 배치 자체가 불안정하다는 직접 증거가 있으므로(단독 22/22였던 mini-cards가
   배치에서 실패) 판정이 갈리면 단독 3회 재실행. `glad 02b` 한 건은 미판정으로 남아 있다.
3. **Paper 캡처 검수** — `export`가 `No DOM element found`. Paper 창을 포그라운드로 올려
   `카드` 페이지를 띄워야 한다. 헤드리스로는 못 푼다.
4. **Paper 페이지 정리** — 현재 7장 → 목표 3장(화면·카드·백테스트). `delete_page` 도구가 없어
   **사용자가 UI에서 직접** 지워야 한다. 네가 할 수 없는 일이므로 필요한 시점에 요청한다.
5. **백테스트 P1.5·P2 실서버 실측** — 구현은 P0~P6 완료. 실서버 확인만 남았다.
6. **3일 실사용 베타테스트** — 72시간 중 실질 1세션만 진행됐다. 완료 게이트는
   `docs/handoff/beta-test-3day/PROTOCOL.md`.

일감을 발견하면 여기 목록을 늘리되, **없는 일을 만들지 않는다.** 위 문서들이 "의도적으로 하지
않았다"고 적어둔 것은 그대로 둔다.

# 4. 완성 판정 후 — 전수 테스트

`§4-A`가 전부 초록이 된 뒤에만 `§4-B`로 넘어간다. 하나라도 빨가면 고치고 §3으로 되돌아간다.

## 4-A. 장 무관 — 언제든 돌아간다 (기준선 먼저)

```bash
node scripts/gates/check-orb.mjs
node scripts/gates/check-glass-ladder.mjs
node scripts/gates/check-window-model.mjs
node scripts/gates/check-harness-freshness.mjs
```

```bash
cd app && npm run test:unit
```

```bash
cd backend && uv run pytest -q -p no:randomly
```

```bash
cd app && npm run verify:plugins && npm run verify:kiumi && npm run verify:integrated-cards && npm run verify:semantic-workspaces
```

```bash
cd app && npm run verify:hoga-live && npm run verify:agent-paper-parity && npm run verify:settings && npm run verify:settings-cards && npm run verify:life003
```

```bash
node scripts/verify-brain-ready.mjs
```

```bash
bash scripts/run-orb-probes.sh
```

```bash
cd app && ./node_modules/.bin/electron probe-backtest-mode.js
```

| 항목 | 기준선 |
|---|---|
| 게이트 4종 | 4/4 PASS |
| app 단위 | 1,946 / 0 fail |
| backend 전수 | 2,584 passed / 5 skipped / 0 failed (`b414e06` 시점) |
| verify:plugins | 116 단언 / 0 |
| verify:kiumi | 19 / 0 |
| verify:integrated-cards | 6 카드 / 299 op / missing 0 / unresolved 0 |
| verify:semantic-workspaces | 12 recipe / exit 0 |
| verify:hoga-live | rows 20 / card true (합성 프레임이라 **장 무관**) |
| probe-backtest-mode | 5 / 5 |
| 오브 프로브 배치 | 20개 전부 — §3-2의 기준선 대조 포함 |

`| tail`로 파이프하면 exit code가 가려진다. 판정은 리포트의 `failures` 필드로 한다.

## 4-B. 장중에만 가능한 것 — 오늘 안에 (KST)

| 세션 | 시각 |
|---|---|
| 장 시작 동시호가 | 08:30 ~ 09:00 |
| **정규장** | **09:00 ~ 15:30** |
| 시간외 단일가 | 16:00 ~ 18:00 |

먼저 지금이 어느 세션인지 확인한다. `probe-krx-live.js`가 `market_session` 필드로 직접 알려준다.

**(1) KRX 실 API 프로브**

```bash
cd app && ./node_modules/.bin/electron probe-krx-live.js
```

`market_session`이 `정규장`인지, `key_resolved`가 true인지 확인한다. 키가 없으면 그건 결함이
아니라 **미설정**이다 — 그대로 기록하고 사용자에게 알린다.

**(2) 실 키움 WebSocket 스윕** — 백엔드가 떠 있어야 한다

```bash
cd backend && uv run python -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8010 --workers 1
```

```bash
cd backend && uv run python scripts/live_websocket_sweep.py
```

REG → 첫 REAL 프레임 → 정확한 group REMOVE → 복원창 동안 새 프레임 없음까지가 한 세트다.
리포트는 `artifacts/live-websocket-sweep/sweep-*.json`.

**(3) 실앱 실사용 — 실시간 배선이 진짜로 사는지**

`docs/handoff/beta-test-3day/RUNBOOK.md` §2~§5 절차를 그대로 따른다.
장중에만 확인 가능한 것은 이것들이다:

- 시세 카드가 **실제 틱**으로 갱신되는가 (합성 프레임이 아니라)
- 호가 래더(CC-04)가 장중 호가로 채워지는가
- 실시간 세션 참조계수가 카드 닫힘 시 REMOVE까지 가는가
- 국내 시세 조회가 성공하는가 — **8/31 세션에서 반복 실패했고 원인이 미규명이다.**
  장중에 다시 재현되는지가 이번 확인의 핵심 항목이다.
- 백테스트 P1.5·P2 실서버 실측

**(4) 주문은 절대 실행하지 않는다.** 실주문·모의주문 API 호출 금지, 주문 실행 버튼 클릭 금지,
계정/토큰/권한 변경 금지. 주문 티켓은 **초안과 확인 직전 경계까지만** 관찰한다.

# 5. 증거와 정직성

이 저장소의 모든 런타임 근거는 지금까지 **fixture 기반**이다
(`live_kiwoom_connectivity_verified: false`). **실 키움 연결은 한 번도 검증된 적이 없다.**
오늘 장중이 그 첫 기회다.

모든 관찰을 다음 중 하나로 분류해 기록한다. 이것을 섞으면 이번 작업 전체가 무의미해진다.

`live` / `mock` / `cache` / `fixture` / `UI draft` / `unknown`

- local HTTP 200이나 WebSocket 연결만으로 production broker·live market data를 입증했다고 말하지 않는다.
- 접근성 트리와 스타일 문자열만으로 시각 결과를 확정하지 않는다. 실제 screenshot을 남긴다.
- 못 돌린 항목은 **못 돌렸다고** 적는다. 누락 슬롯을 성공처럼 채우지 않는다.
- 장이 닫혀 §4-B를 못 하면 "다음 거래일로 이월"이라고 명시하고, §4-A만으로 완료 선언하지 않는다.

# 6. 완료 게이트 — 전부 충족돼야 완료

1. §3의 남은 일이 전부 닫혔거나, 못 닫는 항목마다 **이유와 다음 행동**이 문서에 적혀 있다.
2. §4-A 전항목 실행 + 실패 0. 각 항목의 실제 숫자를 기록했다.
3. §4-B를 장중에 실제로 실행했고, 결과를 provenance 분류표와 함께 기록했다.
   (장이 닫혀 못 했으면 그 사실과 이월 계획을 기록했다.)
4. 주문 실행 0회 / broker mutation 0건.
5. `git status` 깨끗, `main` == `origin/main`, **브랜치는 `main` 하나뿐**, 워크트리 0개.
6. 이어받기 문서(`docs/handoff/README.md`)를 현재 상태로 갱신하고 커밋·push했다.

# 7. 이 저장소의 함정 (전부 실측된 것)

- **병합에는 `-X ignore-cr-at-eol` 필수.** `.gitattributes`가 `* -text`라 git이 줄바꿈을
  정규화하지 않는다. 안 붙이면 유령 충돌 3배 + 커밋에 수천 줄 가짜 변경. 병합 후
  `git diff --shortstat`과 `--ignore-cr-at-eol` 버전이 같은 숫자인지 확인한다.
- **pre-push 훅은 backend pytest를 의도적으로 제외한다**(push당 60초 예산). 훅에 추가하지 말 것.
  backend는 §4-A에서 따로 돌린다.
- **`test_brain_lifespan.py` 실패는 코드 문제가 아닐 수 있다.** 호스트에 `~/.athena/brain.sqlite3`가
  있기만 해도 깨진다(앱을 한 번이라도 띄우면 생긴다). 임시 HOME으로 다시 돌려 판별한다 —
  오염된 홈 1 failed / 격리 홈 16 passed가 실측 패턴이다. `backtest.sqlite3`도 같은 구조다.
- **`uv run pytest`가 0건 수집하면** `rtk proxy uv run pytest`로 우회한다.
- **Electron 프로브는 프로필을 매번 새로 만든다.** 고정 프로필 `rmSync`가 MCP 자식 잠금에
  EPERM으로 죽어 프로브가 조용히 매달린다.
- **Paper `get_children`/`get_basic_info.artboards`는 100개에서 잘린다.** 전수 열거는
  root에 `get_tree_summary depth 1`.
- **Paper 디자인 우선 규칙**: 디자인에 있으면 구현한다. 없는데 필요하면 Paper에 먼저 그리고 구현한다.

# 8. 막히면

추측으로 진행하지 않는다. 다음 중 하나를 한다.

- 사용자만 할 수 있는 일(Paper UI 페이지 삭제, API 키 설정, 장 마감 대기)은 **요청한다.**
- 판단이 갈리는 설계 결정은 선택지를 제시하고 묻는다.
- 어느 쪽이든, 그때까지 진행한 것은 먼저 커밋·push한다.
```
