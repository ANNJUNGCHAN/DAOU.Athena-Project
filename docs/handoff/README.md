# 이어받기 — `main` 하나로 시작하는 법 (2026-09-01)

**`main`이 정본이다.** 다른 컴퓨터에서는 `main`만 받으면 이어받을 수 있다.
다만 "브랜치가 main 하나뿐"인 것은 **2026-09-01 시점의 상태**이고 지금은 아니다 — §1을 볼 것.
이 문서는 그 시작점이고, 2026-08-31~09-01에 병렬로 돌던 **대화 4개**가 어디까지 왔고
무엇이 남았는지를 §4에 모아둔다.

> **바로 이어서 돌리려면** [RALPH_PROMPT.md](./RALPH_PROMPT.md)를 열어 블록을 통째로 복사해
> Claude Code에 붙여넣는다. 이 문서(§2~§6)를 실행 가능한 루프로 옮겨둔 것이다.

> 🔌 **플러그인 모드 기조 정렬 트랙(브랜치 `feat/plugin-mode-doctrine`)은 별도 인계 문서를 따른다** —
> [2026-09-03-plugin-mode-doctrine.md](./2026-09-03-plugin-mode-doctrine.md). Phase A(게이트웨이 제안 툴 ·
> 렌더러 순수 모듈 · Paper 9장)까지 커밋됐고 US-003(메인 프로세스)부터 남았다. 계획·명세·PRD·baseline은
> [plugin-mode-doctrine/](./plugin-mode-doctrine/)에 회수돼 있다.

> 🟠 **2026-09-03 에이전트 모드 "두 입구, 한 게이트" 트랙이 브랜치 `feat/agent-dual-control`에서 시작됐다.**
> 원격 브랜치만으로 이어받을 수 있다 — 진입점·복원 절차·붙여넣을 프롬프트는
> [2026-09-03-agent-dual-control-handoff.md](./2026-09-03-agent-dual-control-handoff.md) →
> [agent-dual-control/RALPH_PROMPT.md](./agent-dual-control/RALPH_PROMPT.md). 이 브랜치는 2026-09-03 main에 병합됐다.

> 🟣 **2026-09-03 백테스트 시각 설계 ↔ 코드 왕복이 들어갔다.** 지도 탭이 편집 가능한 그래프가 되고
> 코드는 지도에서 생성된다. 계약·검증법·남은 P4는
> [2026-09-03-visual-strategy-roundtrip.md](./2026-09-03-visual-strategy-roundtrip.md)에 있다.

> 🔴 **2026-09-01 정규장에 실 키움(모의투자) 연결을 처음으로 검증했다.**
> 결과·provenance 분류·새로 찾은 결함은
> [2026-09-01-live-market-verification.md](./2026-09-01-live-market-verification.md)에 있다.
> 이 문서 §7의 "실 키움 연결은 어느 대화에서도 검증되지 않았다"는 그 문서 §1로 대체됐다 —
> **프로덕션 브로커 연결은 설계상 불가능**하고(도메인 하드락), 검증된 것은
> *mock 브로커 + live 시장 데이터*다.

> 🟢 **2026-09-03 키우미 카드미니 — 360×420 런타임 구현·전수 검증 완료.**
> 2026-09-03 main에 병합됐고 브랜치 `codex/kiumi-mini-cards-runtime`은 삭제됐다 — `main`만 받으면 된다.
> 구현 계약, 검증 수치, 이어받기 명령은
> [2026-09-03-kiumi-mini-cards-runtime.md](./2026-09-03-kiumi-mini-cards-runtime.md)에 있다.
> 옛 [360×640 계획 인계](./2026-09-03-kiumi-mini-cards-handoff.md)와
> [KIUMI_PROMPT.md](./KIUMI_PROMPT.md)는 역사 기록이며 다시 실행하지 않는다.

> 🟠 **2026-09-03 카드 표면 Paper→코드 — W3 Tasks 1–8·canonical 재생성 완료, coverage 3,382/3,532(95.8%). nonvisual gate는 통과했지만 5보드 반응형 가독성 때문에 시각 gate FAIL; explicit responsive/glyph gate 설계와 composite schema 승인 대기.**
> 이어받는 절차·수치·남은 일·사용자 확정 결정은 [2026-09-03-card-surface-paper-to-code.md](./2026-09-03-card-surface-paper-to-code.md)에 있다.
> 이 트랙은 **`feat/card-surface-paper-to-code`**에 지속 커밋·푸시한다. 위 인계 문서가 들어 있는 최신 origin 커밋을 체크포인트로 삼는다.
> 붙여 넣을 블록은 [CARD_SURFACE_PROMPT.md](./CARD_SURFACE_PROMPT.md).

---

## 1. 저장소 상태 (2026-09-04 01:05 KST 확인)

**모든 브랜치가 `main`에 들어갔다.** 2026-09-03 23:40 ~ 09-04 01:00에 브랜치 7개
(plugin-mode-doctrine 16 · agent-dual-control 8+2 · kiumi-mini-cards-runtime 15 · card-surface 15+2 ·
kiumi/mini-cards 2 · ANNJUNGCHAN/main 1 · plugin-mode-doctrine 후속 1)를 병합했다. 절차·충돌·회귀 수정은
[2026-09-03-branch-integration-pending.md](./2026-09-03-branch-integration-pending.md) §8에 있다.

| 항목 | 값 |
|---|---|
| `origin/main` | `6e26c6f` — 2026-09-04 01:00 |
| 원격 브랜치 | main + **4개**(아래) — 4개 모두 tip이 main에 포함됨 |
| 로컬 브랜치 | main · feat/agent-dual-control · feat/plugin-mode-doctrine (워크트리에 체크아웃) |
| 열린 PR | 0건 |
| 워크트리 | main + `.claude/worktrees/agent-dual-control-handoff-6f05c9` + `.claude/worktrees/settings-plugin-tab-absorption-6d550f` + Orca 2개(`orca/workspaces/DAOU.Athena/{hydra,main}`) |
| 게이트 4종 | 4/4 PASS (6e26c6f, 저장소 루트에서만 돈다) |
| app 단위 | **2,696 / 2,696** (6e26c6f) |
| backend 전수 | **3,619 passed / 6 skipped / 0 failed** (6e26c6f, 격리 HOME, 20분 25초) |
| verify | semantic-workspaces 12/12 · hoga-live · kiumi 19 · plugins 154 · agent-paper-parity PASS |
| 알려진 빨감 | `verify:integrated-cards` — `board 2SKU-1 M 프로브: container 1360px outside 720..959px`. card-surface tip에서도 동일. 그 트랙의 W3 반응형 미완(visual blocker) |

**남은 원격 브랜치 4개 — 지우지 않은 이유.** tip은 전부 main에 있지만 **소유 세션이 지금도 push 중**이다
(2026-09-04 00:29~00:46 사이 셋이 각각 커밋). 살아 있는 브랜치의 원격 ref를 지우면 그 세션의 upstream이
끊긴다. 작업이 끝났다고 확인되면 하나씩 지운다 — **삭제 직전에 fetch하고 `merge-base --is-ancestor`로
게이트해서**(`&&`), 일괄 `--delete` 금지. 2026-09-04 00:50에 이 규칙을 어겨 `feat/card-surface-paper-to-code`의
push 9분 된 커밋 2개를 지웠고 `git fsck --unreachable`로 복구했다.

| 브랜치 | 상태 |
|---|---|
| `feat/agent-dual-control` | 코드 알람 트랙, Step 4까지 main에. 워크트리 활성 |
| `feat/plugin-mode-doctrine` | 플러그인 독트린 트랙, a18aaf4까지 main에. 워크트리 활성 |
| `feat/card-surface-paper-to-code` | 카드 표면 트랙, d612cb5(G4)까지 main에. Codex가 원격 전용으로 push |
| `ANNJUNGCHAN/main` | Orca 워크스페이스의 main 미러, cd0b98e까지 main에 |

삭제 완료: `codex/kiumi-mini-cards-runtime` · `kiumi/mini-cards`(둘 다 main에 포함 확인 후) ·
로컬 `claude/settings-plugin-tab-absorption-6d550f`.

> ⚠ **새 컴퓨터에서 app 단위가 1,945/1,946이거나 backend가 32건 무더기로 깨지면
> 코드 문제가 아니라 PATH 문제다.** 원인과 조치는
> [장중 검증 문서 §5.1~5.2](./2026-09-01-live-market-verification.md)에 있다 —
> 백엔드 의존성은 `backend/.venv`에만 있고, `evaluate_selector_ablations.py`는 `node`를 부른다.

`main`에 들어간 마지막 묶음: PR 6건 스윕 → `b414e06`, Paper 카드 라우팅 + 키움 공식 스펙
감사 → `84b0ed9`, `canvas_push` 게이트 되돌리기 → `289ca65`, 키우미 인계 문서 회수 → `0ec8161`.

---

## 2. 새 컴퓨터 준비

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git && cd DAOU.Athena
```

```bash
cd app && npm install && node node_modules/electron/install.js
```

`node node_modules/electron/install.js`는 형식적인 단계가 **아니다.** 이 프로젝트에서
`npm install`이 electron 바이너리를 조용히 빠뜨리는 일이 반복 재현됐다. 빠뜨리면 앱이
안 뜨는데 npm은 성공으로 끝난다.

```bash
cd backend && uv sync --extra dev
```

```bash
git config core.hooksPath scripts/hooks
```

**이 한 줄을 빠뜨리면 안전망이 통째로 없어진다.** `.git/hooks/`는 clone으로 따라오지
않는다. 원본 PC에서는 `scripts/hooks/pre-push`를 `.git/hooks/`로 복사해 쓰고 있었을 뿐,
저장소 설정으로 걸려 있지 않다. 새 컴퓨터에서는 위 `core.hooksPath`로 거는 쪽이 맞다.

`node`가 PATH에 없으면 fnm 환경이다 (`fnm env` / 셸 재시작). 게이트는 **plain node로**
실행한다 — `cmd /c` 경유 시 rtk 훅이 명령을 훼손한 실측이 있다.

---

## 3. backend 전수 — 닫혔다 (2026-09-01)

`289ca65`(canvas_push 되돌리기) 위에서 backend 전수 pytest가 끝까지 돈 적이 없다는 것이
이 인계의 유일한 미완 항목이었다. **2026-09-01에 격리 HOME으로 완주했다.**

```
2638 passed, 5 skipped, 1 warning in 1369.25s (0:22:49)   exit 0
```

직전 `b414e06`의 2,584에서 54건 늘었다 — Paper 카드 배선이 넣은
`test_question_to_card_routing.py`(38 라우팅 + 1 커버리지)와 `test_canvas_push.py` 신뢰 경계
2건이 여기 포함된다. **이 결과 이후 `backend/`·`app/` 코드는 한 줄도 바뀌지 않았다**
(`git diff --name-only 289ca65 HEAD -- backend app` 이 비어 있다). 새 컴퓨터에서 이 숫자가
재현되지 않으면 환경 차이를 먼저 의심한다.

재실행 명령 (약 25분):

```bash
cd backend && uv run pytest -q -p no:randomly
```

**백엔드 테스트는 `node`가 PATH에 있는 셸에서 돌린다(fnm)** — `evaluate_selector_ablations.py`가 `node`를 부르므로, fnm 환경에서는 `fnm env`(또는 multishell 경로를 PATH 앞에 붙여) 먼저 통과시킨다.

0건 수집되면 `rtk proxy uv run pytest -q -p no:randomly`로 우회한다.

`test_backtest_indicators.py`가 아니라 **`test_brain_lifespan.py`가 실패하면 코드 문제가
아닐 수 있다.** 그 테스트는 hermetic하지 않아서 호스트에 `~/.athena/brain.sqlite3`가
존재하기만 해도 깨진다(앱을 한 번이라도 띄우면 생긴다). 임시 HOME으로 다시 돌려 판별한다 —
오염된 홈 1 failed / 격리 홈 16 passed가 실측된 판별 패턴이다.

---

## 4. 대화 4개 — 상태와 남은 일

| # | 대화 | 상태 | 정본 문서 |
|---|---|---|---|
| 1 | Paper 카드 디자인·배선 | 구현 완료. 남은 건 Paper 캡처·페이지 정리(둘 다 Paper UI 수동) | [2026-09-01-paper-card-wiring.md](./2026-09-01-paper-card-wiring.md) |
| 2 | 백테스터를 새 모드로 통합 | **P2 실서버 실측 완료(2026-09-01).** P1.5(패키징 실측)만 남음 | [backtest-mode-plan.md](../architecture/backtest-mode-plan.md) · [backtest-parity-audit.md](../architecture/backtest-parity-audit.md) |
| 3 | 키우미 전수 검사 | **프로브 20/20 완주(2026-09-01).** `glad 02b` 원인 규명됨 | [KIUMI_AUDIT_STATUS.md](../../KIUMI_AUDIT_STATUS.md) |
| 4 | Athena 3일 실사용 베타테스트 | 1일차 1세션만 진행, 미완 | [beta-test-3day/README.md](./beta-test-3day/README.md) |
| 5 | **장중 실연결 검증** | **§4-B 완료(2026-09-01 정규장).** 주문 0회 | [2026-09-01-live-market-verification.md](./2026-09-01-live-market-verification.md) |

### 4.1 Paper 카드 배선

가장 중요한 사실 하나: **Paper 카드(CC-01~06)는 이미 프로덕션에 배선돼 있었다.** 진짜
구멍은 키움 데이터가 레거시 범용 카드로 새는 경로였고 그걸 막았다. 레거시 16개
`card-kind-*.js`는 잔재가 아니라 CC 카드의 **본문**이다 — 삭제하면 CC-04 호가 래더와
CC-03 AITS 차트가 사라진다. 다시 조사하지 말 것.

남은 일 3가지 — Paper 캡처(`export`가 `No DOM element found` — Paper 창을 앞으로 올려
`카드` 페이지를 띄워야 함), Paper 페이지 7→3장 정리(`delete_page` 도구가 없어 UI 수동),
ELW·금현물 라우팅 지시어 의존. 근거와 판단 이유는 전부 정본 문서에 있다.
정본 문서 §7의 "1. 되돌리기 반영 backend 전수 재실행"은 **§3에서 닫혔다.**

### 4.2 백테스트 모드

P0~P6 구현 완료, 전수 파리티 완료(60/60).
`probe-backtest-mode` 5/5, 백테스트 P5·P6 라우트 14개가 라우트 수 단언에 반영됨(`8609815`).

**P2 실서버 실측은 2026-09-01 정규장에 끝났다.** 설계서 §5.2의 "600행/페이지"는 가정이었는데
`ka10081`을 19페이지 연속 조회해 **정확히 600행**임을 확인했고, §10-2의 "최대 과거 시점
미실측"도 **하한 1985-01-04**(약 10,938 거래일)로 닫혔다. 설계서 §11의 해법 ⓑ(첫 백필 응답의
가장 오래된 봉을 조회 하한으로 기록)가 실현 가능함이 확인된다 — 마지막 페이지가 600 미만
행으로 끝나므로 감지된다. 근거는
[장중 검증 문서 §3(4)](./2026-09-01-live-market-verification.md).

**남은 것은 P1.5뿐이다** — numpy/pandas의 *패키징된 앱* 실측이라 배포 빌드가 필요하고
장중과 무관하다.

> `probe-backtest-mode`는 **백엔드를 내린 상태에서** 돌려야 한다. 04번 단언이
> "백엔드 미기동 → 손쓸 수 있는 에러 문구"를 검사하므로 백엔드가 떠 있으면 반드시 실패한다.

알아둘 함정: `backtest_db_path` 기본값도 `~/.athena/backtest.sqlite3`라 §3의
brain 함정과 같은 구조다. 지금은 런처가 `ATHENA_BACKTEST_ENABLED`를 켜지 않아 파일이
생기지 않지만, "꺼져 있으면 디스크를 안 건드린다" 류 테스트를 나중에 추가하면 같은
방식으로 깨진다.

### 4.3 키우미 전수 검사

**여기가 가장 명확한 재개 지점이다.** `app/probe-orb-*.js` 20개 순차 실행이 9/20에서
끊겼다. 실행기는 `scripts/run-orb-probes.sh`로 저장소에 들어와 있다.

다음 단계는 정본 문서 §2.3에 적힌 **기준선 대조**다 — 부모 커밋 `b1d1b08`을 별도
워크트리에 꺼내 같은 배치를 돌리고 프로브별 ok/fail 집합을 대조한다. 배치 자체가
불안정하다는 직접 증거가 있으므로(단독에서 22/22였던 mini-cards가 배치에서 실패)
판정이 갈리면 단독 3회 재실행. `glad 02b` 한 건은 CSS를 건드린 커밋이라 무죄를
단정하지 않은 상태로 남겨뒀다.

### 4.4 3일 실사용 베타테스트

72시간 목표 중 **실질 세션 1회**만 진행됐다(자연어 질문 4, 성공 2, 조용한 실패 2,
캡처 14, BETA-001~008). 완료 게이트는 [PROTOCOL.md](./beta-test-3day/PROTOCOL.md)에 있고
하나도 충족되지 않았다.

이 묶음은 원래 `artifacts/`(gitignore 대상)에만 있어서 다른 컴퓨터로 넘어가지 않았다.
2026-09-01에 문서·원장·실행 스크립트를 git으로 옮겼다 — 대응표는
[beta-test-3day/README.md](./beta-test-3day/README.md) 맨 위. **캡처 PNG 14개와
runtime 로그는 넘어오지 않았다**(원본 PC에만 있음). `manifest.csv`의 SHA-256은 남아
있으니 대조는 가능하지만, 새 컴퓨터에서는 파일이 없는 게 정상이다.

> `beta-test-3day/EXECUTION_CONTRACT.md`의 "소스 코드를 수정하지 않는다"는 **베타테스트
> 작업에만** 적용되는 계약이다. 저장소 전체 규칙이 아니다. (원래 `CLAUDE.md`였는데 일반
> 개발 세션에 자동 주입되는 걸 막으려 이름을 바꿨다.)

`scripts/beta/allow-all-tools.ps1`은 등록된 MCP 서버의 노출 도구를 전부 allow한다 —
베타 하네스 편의 스크립트지 평상시 쓰는 것이 아니다.

---

## 5. 이 저장소를 다룰 때 밟는 지뢰

**병합에는 `-X ignore-cr-at-eol`을 반드시 붙인다.** `.gitattributes`가 `* -text`라 git이
줄바꿈을 정규화하지 않는다. 안 붙이면 유령 충돌이 3배로 늘고 커밋에 수천 줄짜리 가짜
변경이 박힌다. 병합 후 `git diff --shortstat`과 `git diff --shortstat --ignore-cr-at-eol`이
같은 숫자인지 확인한다 — 다르면 그 차이가 노이즈 줄 수다.

**pre-push 훅이 매 push마다 게이트 4종 + app 전체 단위 테스트를 돈다.** 브랜치 삭제
push에서도 돈다. 작업트리에 미추적 빨간 테스트가 하나라도 있으면 push 자체가 막히고,
원인이 stderr에 잘 드러나지 않는다. backend pytest는 **의도적으로 제외**돼 있다(훅에
추가하지 말 것 — push당 지연 예산 60초).

**git에 없는 것은 다른 컴퓨터로 안 간다.** `.gitignore`가 `/artifacts/`, `.omc/`,
`.claude/`를 전부 제외한다. 즉 `.omc/plans/`·`.omc/state/`의 계획서와 원장, `artifacts/`의
증거·probe 결과·live sweep JSON은 **원본 PC에만 있다.** 이어받는 데 꼭 필요한 것은
§4에서 git으로 옮겼다. 앞으로도 인계에 필요한 문서는 `docs/`에 두고, `artifacts/`는
버려도 되는 증거만 담는다.

---

## 6. 검증 명령

| 무엇 | 명령 | 기준선 |
|---|---|---|
| 게이트 4종 | `node scripts/gates/check-{orb,glass-ladder,window-model,harness-freshness}.mjs` | 4/4 PASS |
| app 단위 | `cd app && npm run test:unit` | 1,946 / 0 fail |
| backend 전수 | `cd backend && uv run pytest -q -p no:randomly` | 2,638 / 5 skipped / 0 fail |
| 플러그인 | `cd app && npm run verify:plugins` | 116 단언 / 0 |
| 키우미 | `cd app && npm run verify:kiumi` | 19 / 0 |
| 통합 카드 | `cd app && npm run verify:integrated-cards` | 6 카드 / 299 op / missing 0 |
| 의미 워크스페이스 | `cd app && npm run verify:semantic-workspaces` | 12 recipe / exit 0 |
| 호가 실시간 | `cd app && npm run verify:hoga-live` | rows 20 / card true |
| 에이전트 파리티 | `cd app && npm run verify:agent-paper-parity` | 실패 0 |
| 오브 프로브 배치 | `bash scripts/run-orb-probes.sh` | §4.3 — 9/20에서 중단됨 |
| brainReady | `node scripts/verify-brain-ready.mjs` | 리포트에 `failures`/`exitCode` 실림 |

`| tail`로 파이프하면 exit code가 가려진다. 판정은 리포트의 `failures` 필드로 한다.

---

## 7. 원본 PC에만 있는 것

다른 컴퓨터에서 **재현할 수 없고, 없는 게 정상**인 것들이다. 없다고 다시 만들려 하지 말 것.

- `artifacts/beta-test-3day/captures/**` — 캡처 PNG 14개 (13MB)
- `artifacts/beta-test-3day/runtime/**` — 백엔드·Electron 실행 로그
- `artifacts/live-probes/`, `artifacts/task-canvas/`, `artifacts/live-query-sweep-*.json` — 키움 live 응답 스윕
- `.omc/plans/`, `.omc/state/` — 계획서·원장 (`app-review-ledger.md`, `card-v3-specs.json` 등)
- `~/.athena/` — brain·backtest sqlite, MCP 서버 등록

실 키움 연결은 **어느 대화에서도 검증되지 않았다** (`live_kiwoom_connectivity_verified: false`).
모든 런타임 근거는 fixture 기반이다.
