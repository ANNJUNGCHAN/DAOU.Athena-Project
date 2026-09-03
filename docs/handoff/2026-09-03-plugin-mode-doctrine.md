# 인계 — 플러그인 모드 기조 정렬 (2026-09-03, Phase A 마감)

**한 줄 상태.** 플러그인 모드를 Paper 화면 35·38·40·42번의 기조("모드가 대화의 경계")에 맞추는 작업이 **합의 계획(반복 7, Critic APPROVE)** 아래 `feat/plugin-mode-doctrine` 브랜치에서 진행 중이다. **Phase A(백엔드 제안 툴 · 렌더러 순수 모듈 · Paper 9장)는 검증 통과 후 커밋됐고(`55c3333`), Phase B(메인 프로세스)부터 남았다.** 사용자 지시(2026-09-03)로 여기서 멈추고 다른 세션에 넘긴다.

> 이어받는 사람은 §2로 환경을 맞추고, §5의 남은 스토리를 §10의 프롬프트로 ralph에 넣으면 된다. 질문할 수 없는 자율 실행이므로 §6의 편차와 §7의 결정을 먼저 읽는다.

---

## 1. 무엇을 만드는가 (요지)

플러그인 = `mode='plugin'`인 대화 창. 그 창의 채팅이 **설치 · 기능 허용/철회 · 켜기/끄기 · 삭제 · 스니펫 등록** 5동작을 **제안 턴**으로 내고, 플러그인 캔버스의 **승인 카드**가 확정한다. 제안은 게이트웨이 built-in 툴 `athena_plugin`으로 **모델**이 내고(읽기 전용, 레지스트리·consent 불변), 실행은 **사람 클릭 전용 IPC**만 한다. 허브·관리의 GUI 버튼은 유지하되 같은 승인 게이트로 합류한다(두 입구, 한 게이트). Paper 플러그인 페이지(B-2)를 이 흐름으로 재설계하고 실앱에 동일 적용한다.

정본 문서(이 폴더에 회수됨 — 워크트리 `.omc/`는 gitignore라 다른 컴퓨터로 가지 않는다):

| 파일 | 내용 |
|---|---|
| [plugin-mode-doctrine/plan.md](./plugin-mode-doctrine/plan.md) | 합의 계획 반복 7 — §0 실행 규율 · §2 RALPLAN-DR(원칙·선택지·프리모템·테스트 계획) · §3 수락 기준 · §4 W0~W5 구현 단계 · §5 인터페이스 계약 · §6 위험 · §7 검증 명령 · §8 확정 결정 10 · §9 ADR |
| [plugin-mode-doctrine/spec.md](./plugin-mode-doctrine/spec.md) | deep-interview 명세(모호도 18%) — 사용자가 승인한 수락 기준 ①②③ 원문 |
| [plugin-mode-doctrine/prd.json](./plugin-mode-doctrine/prd.json) | ralph PRD **9스토리** — 통과 4(US-000·001·002·005) · 남음 5(US-003·004·009·006·007·008 순) |
| [plugin-mode-doctrine/baseline.json](./plugin-mode-doctrine/baseline.json) | 테스트 baseline(main f880d79): app 1946/1946 · backend 2638 passed/5 skipped · node 경로 |
| [plugin-mode-doctrine/progress.txt](./plugin-mode-doctrine/progress.txt) | ralph 진행 기록(학습 포함) |
| [plugin-mode-doctrine/reviews-iter5.json](./plugin-mode-doctrine/reviews-iter5.json) | 합의 5차 Architect/Critic 원문(참고) |

---

## 2. 어디서 이어받나

| 항목 | 값 |
|---|---|
| 브랜치 | **`feat/plugin-mode-doctrine`** (main `f880d79`에서 분기) |
| 워크트리(이 컴퓨터) | **`C:\Projects\DAOU.Athena-plugin`** — 본 저장소 `C:\Projects\DAOU.Athena`의 형제. 본 저장소는 카드 트랙 미커밋 변경 1,784줄과 다른 세션이 쓰고 있으니 **거기서 작업하지 않는다** |
| 최신 커밋 | `55c3333 feat(plugin): 게이트웨이 제안 툴과 렌더러 순수 모듈로 플러그인 모드 기조 정렬을 시작한다` (+ 이 인계 문서 커밋) |
| 원격 | **아직 push하지 않았다.** 다른 컴퓨터로 가려면 먼저 `git push -u origin feat/plugin-mode-doctrine` |

**같은 컴퓨터에서 이어받기.** 워크트리에 `app/node_modules`(electron 포함)·`backend/.venv`·`core.hooksPath`가 이미 있다. Claude Code를 `C:\Projects\DAOU.Athena-plugin`에서 열고 §10 프롬프트를 붙여넣는다. `.omc/`도 그대로 있다(계획·명세·PRD·baseline).

**다른 컴퓨터에서 이어받기.** 전제: git · **Node 22+** · **uv** · Python 3.12 · 네트워크(npm·uv·`verify:plugins`의 npx/uvx 다운로드). Paper(디자인 도구)는 남은 코드 작업에 필요 없고, 검수 문구 반영 때만 필요하다 — Paper 파일은 `https://app.paper.design/file/01M0VGPX92K1TER4ZV9PWGQJJZ` 페이지 **B-2(플러그인)**, Paper MCP 연결이 있어야 편집할 수 있다. **보내는 컴퓨터에서 먼저 `git push -u origin feat/plugin-mode-doctrine`** — 아직 push되지 않았다.

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git && cd DAOU.Athena
git switch feat/plugin-mode-doctrine
cd app && npm install && node node_modules/electron/install.js && cd ..
cd backend && uv sync --extra dev && cd ..
git config core.hooksPath scripts/hooks
mkdir -p .omc/plans .omc/specs .omc/state
cp docs/handoff/plugin-mode-doctrine/plan.md .omc/plans/athena-plugin-doctrine-consensus.md
cp docs/handoff/plugin-mode-doctrine/spec.md .omc/specs/deep-interview-athena-plugin-doctrine.md
cp docs/handoff/plugin-mode-doctrine/prd.json .omc/prd.json
cp docs/handoff/plugin-mode-doctrine/baseline.json .omc/state/baseline.json
cp docs/handoff/plugin-mode-doctrine/progress.txt .omc/progress.txt
```

`node node_modules/electron/install.js`는 형식적 단계가 아니다(README §2). baseline은 **같은 커밋에서 다시 뜨지 않는다** — `baseline.json`의 수치를 그대로 쓴다(계획 §0-4). 다만 새 컴퓨터에서는 `.omc/state/baseline-app-test-unit.txt`(428KB)와 `baseline-backend-pytest-tail.txt`가 없으므로 §7-1의 `not ok` 대조는 `baseline.json`의 "fail 0"을 빈 목록으로 간주한다.

**node PATH 함정(이 컴퓨터).** Bash에는 `node`·`npm`이 없다. `export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"` 후 실행한다. PowerShell은 `& $fnm env --use-on-cd --shell power-shell | Out-String | Invoke-Expression`. **backend 전수 pytest도 node가 PATH에 있어야 한다**(없으면 `test_selector_autonomous_eval.py` 실패).

---

## 3. 완료된 것 — Phase A (전부 검증자 PASS, 수정 루프 0회)

| 스토리 | 산출물 | 증거 |
|---|---|---|
| **US-001** 게이트웨이 제안 툴 | `backend/athena_mcp/plugin_tools.py`(`athena_plugin`, 6액션 enum, `dispatch(arguments, registry, consent_store)`, `registry.reload()` 1회, `source="model"` 강제, 별칭 게이트 4종 + 스니펫 파싱 규칙), `server.py` 배선(dispatch 분기·감사·등록), `tests/mcp/test_plugin_tools.py`(14함수/50케이스), `test_server.py` +2, `test_consent.py` +1, `tests/fixtures/plugin-proposal/*.json` 6종 | `uv run pytest tests/mcp -q` → **427 passed**(약 2분); ruff 통과; 두 소비자 파일 쓰기 0건 |
| **US-002** 렌더러 순수 모듈 | `app/lib/plugin-mode-adapter.js`(H2 `currentMode()`), `app/lib/plugin-proposal.js`(빌더·검증기·stale·문구), 테스트 2파일(38건), `app/shell.html` 태그 2줄 | `npm run test:unit` → **1984/1984**(+38, 신규 실패 0); 교차 언어 계약 테스트가 백엔드 픽스처 6종을 읽어 통과 |
| **US-005** Paper 플러그인 페이지 | B-2 페이지 9장: 01~06 정정 + **07 `3ZJD-0` · 08 `3ZLW-0` · 09 `3ZNO-0`** 신설(각 1680×986, (4000,1140)/(6000,1140)/(0,2280)) | 정확 문구 35종 `find_nodes` 확인 · 03 옛 문구 0건 · 내부어 0건 · fit-content 0 · PDF `C:\Users\ajc22\Downloads\Combined (27).pdf`(3.67MB, 저장소 밖 — 채팅으로도 발송됨) **사용자 발송 완료, 검수 회신 대기**. 수락 기준 ①은 계획 §7-1대로 **검수 승인 전까지 미완**이다 — PRD의 `passes:true`는 디자인 작업 완료를 뜻한다 |

---

## 4. 완료 판정 방식 (ralph 구조)

`prd.json`의 스토리마다 실행 에이전트 → **검증 에이전트가 신선한 증거(직접 테스트 실행·파일 대조)로 수락 기준 전부 확인** → 불합격 시 수정 루프(최대 2회). 전 스토리 통과 후 아키텍트 검토 → deslop → 회귀 재검증 → `/oh-my-claudecode:cancel`. 계획 §7의 명령이 최종 게이트다.

---

## 5. 남은 것 — Phase B~E (순서 고정)

| 순서 | 스토리 | 계획 절 | 의존 |
|---|---|---|---|
| **B** | **US-003** 메인 프로세스 — `mcp-cli.js list()`에 `revision`, `mcp-runtime-coordinator.js`에 `'plugin-batch'`, `lib/main/plugin-proposal-registry.js`(순수: 1회용 소비 맵·실행 순서·pending 맵·별칭 게이트 4종·executor 8종 주입·probe는 apply 밖·install 서브사슬 보상·`consume(envelope)`), `lib/main/plugin-proposal-forward.js`(tool_result 판정), `main.js`(`maybeForwardPluginProposal`·tracker 훅·`athena:plugin-approve/reject/pending` handle·`athena:plugin-noted` on·`providerRuntimeEnabled` 분기·액션별 감사·`stageSnippet` 직접), `preload.js` 채널 5종 | §4 W2 표 전체, §6 R3 결정, §2.4 PM-1·PM-2·PM-3, §8 확정 8·10 | US-001·002 완료(○) |
| **C** | **US-004** 렌더러 — `plugin-canvas.js`(승인 카드·3상태·`setProposals`·GUI 6종→`onPropose`·낙관적 토글 제거·권한 초안 보존+발산·접근성), `canvas.js`(재배선·revision 보관·모듈 스코프 구독+모드 게이트·`plugin-noted`·`setView` 래퍼 복원·`athena:plugin-result` CustomEvent), `chat.js`(제안 턴·결과 턴 4종 `_mountTurn`·모드 밖 한 줄), **W3-6** `shell.html` `#chatModeHead` + `controller.js` 모드별 문구(사용자 승인된 예외), `plugin-proposal-boundary.test.js` | §4 W0-3·W3-2·W3-3·W3-4·W3-6, §3.2 A3·A4·A5·A10 | US-003 |
| **C+** | **US-009** 설정의 플러그인 탭을 플러그인 모드로 흡수(**사용자 지시 2026-09-03**, 명세 "설정 02 카드 유지"·계획 확정 9·R8을 **대체**) — `settings-cards.js` 플러그인 카드·nav 항목·직접 삭제 경로 제거, 감사 로그 섹션을 `plugin-canvas.js` 관리 뷰로, 직접 등록은 허브 `+ 서버 추가` 시트 재사용; Paper B-2 02 보드를 관리 뷰 셸로 재구성, 화면 13 nav 항목 제거·31 보드 폐기 각주; 파리티·감사 문서 갱신 | `prd.json` US-009 수락 기준(정본) | US-004 |
| **D** | **US-006** CSS(`plugin-canvas.css`, 토큰만, Paper 픽셀 대조) ∥ **US-007** 하네스(`verify-plugins.js` 5동작 사슬 ⑴~⑸, `verify.js` 플러그인 블록 개정 폐기 7·유지 7·경계 1·신설 8, `verify-graph-mode.js`, `PAPER_APP_PARITY.md` 9행) | §4 W3-5·W5-1·W5-2·W5-3 | US-004 (CSS는 Paper 확정 후 — 이미 확정) |
| **E** | **US-008** §7 게이트 전부(test:unit 2회·backend 전수 1회·hex·경계 테스트·문구 게이트·옛 문구 0) + 명시 `git add` 커밋 | §7, §0 | 전부 |
| 외부 | **W5-4 PDF 검수** — 사용자 회신 대기. 안건 4건(§7 참조) | §4 W5-4 | 사용자 |

수락 기준 원문은 `prd.json`의 각 `acceptanceCriteria`가 정본이고, 계획 §3.1(①②③)과 §3.2(A1~A10)가 그 근거다.

---

## 6. 이어받는 사람이 반드시 알아야 할 편차 (계획 문면과 다른 실측)

1. **`buildProposal` 시그니처.** 계획 W3-1은 `buildProposal(action, target, features, reason, revision)`이라 썼지만 구현은 **`buildProposal(spec, reason, revision, source)`**(spec = `{action, target, features?, enabled?, snippet?}`)이고 `buildBatchProposal(actions, reason, revision, source)`가 따로 있다. 계획 문면대로 부르면 `validateProposal`이 거부한다(조용히 실패하지 않는다). US-003·004는 이 시그니처로 쓴다.
2. **`resultTurnCopy(kind, ctx)`는 `{lines, chip}`를 돌려준다**(배열이 아님). `failed`의 `chip`이 `'다시 시도'`, 그 외 `null`. chat.js 결과 턴 렌더가 이 모양을 읽는다.
3. **`plugin-proposal.js`는 IIFE 시점에 `window.AthenaLib.PluginCatalog`를 구조분해한다** — `shell.html`에서 `lib/plugin-catalog.js` 태그가 앞에 있어야 한다(현재 460 → 461·462 → canvas.js 476 → chat.js 477). 순서 봉인 단언은 canvas.js/chat.js 기준만 있으므로 US-004에서 `plugin-catalog.js` 기준 `indexOf` 단언 1줄을 `plugin-mode-adapter.test.js`에 추가하는 것을 권한다.
4. **백엔드 `dispatch`는 sync다**(형제 4종은 async). `registry.reload()`의 락 경합이 이벤트 루프를 잠깐 막을 수 있다. 문제가 보이면 `async def` + `asyncio.to_thread(reload)`.
5. **`_CATALOG_IDS`는 `app/lib/plugin-catalog.js`의 수동 복제**(fetch·time·sequential-thinking·memory·korea-stock). 카탈로그가 늘면 백엔드도 늘려야 한다. 동기화 테스트는 없다.
6. **픽스처는 재생성만 한다.** `test_plugin_tools.py`의 픽스처 테스트가 `backend/tests/fixtures/plugin-proposal/*.json`을 쓴다 — 봉투 스키마 드리프트는 **JS 쪽 계약 테스트**(`plugin-proposal.test.js`)가 잡는다. `proposal_id`는 액션 이름에서 유도한 고정 hex이고 내용이 같으면 다시 쓰지 않으므로(인계 직전 수정) 테스트를 돌려도 작업 트리가 더러워지지 않는다. 그래도 `git status`에 이 6파일이 `M`으로 뜨면 봉투 모양이 바뀐 것이다 — 그때는 JS 계약 테스트와 함께 커밋한다.
7. **Paper 05번 카드 제목.** 원래 모달 제목은 `한국 주식 시세 설치`였으나 계획 W4 표·W5-2 유지 단언대로 **`웹 문서 읽기 설치`**로 재구성했다(`uvx mcp-server-fetch`, `권한 1개 요청`). `한국 주식 시세를 설치할까요`는 07번 보드 1열에 있다.
8. **Paper 06번 아트보드는 1680×830**(6칸 3행×2열). W5-3 파리티 문서에 이 치수를 기록해야 한다. 05번은 fit-content(높이 0)였던 것을 1680×986으로 고정했다.
9. **`create_artboard`는 `left`/`top`을 무시한다** — 신설 후 `update_styles`로 재배치했다. 빈 스크린샷은 뷰포트 미마운트이지 렌더 오류가 아니다(get_jsx/find_nodes로 확인).
10. **워크트리 행 번호 오프셋.** 계획의 `파일:행`은 본 저장소 작업 트리 기준이다. 워크트리에서는 `app/canvas.js` −311, `app/main.js` −21, `app/preload.js` −2, `app/shell.html`은 구역에 따라 다르다(`#chatModeHead` 구역 −2, 스크립트 블록은 Phase A 태그 삽입 후 −9). 다른 컴퓨터의 클론은 워크트리와 같다. **행 번호를 믿지 말고 심볼로 재탐색**한다.

---

## 7. 사용자 결정 기록 (되묻지 않는다)

| 결정 | 내용 |
|---|---|
| 범위 | 플러그인 Paper + 플러그인 로직만. 모드 귀속 창 인프라(`mode` 필드·다중 창·스냅샷)는 별도 트랙(에이전트 단 / 공통 셸). 타 모드 캔버스·채팅 불간섭 |
| 흐름 | 채팅이 제안, 캔버스가 승인. GUI 변경 버튼 유지(같은 게이트 합류). 제어 동작 5종(도구 **호출**은 범위 밖). 제안 주체는 모델(built-in 툴, `_ALLOWED_ACTIONS` 선례) |
| 그래프 헤더 예외 | **승인** — `#chatModeHead`를 모드별 문구를 가지는 공용 헤더로 일반화. 그래프 문구·동작은 회귀 단언 3종(A10)으로 고정. `#pluginChatHead` 폴백은 채택하지 않음 |
| 브랜치 | 별도 워크트리 `C:\Projects\DAOU.Athena-plugin` |
| **설정 플러그인 탭 폐지** (2026-09-03 추가 지시) | 설정 오버레이의 플러그인 탭(스니펫 등록·감사 로그·직접 삭제)을 **플러그인 모드로 흡수**한다. 명세의 "설정 02 카드 유지", 계획 §8 확정 9의 "설정 카드는 그대로", §6 R8은 이 결정으로 **대체**된다. 구현은 US-009(prd.json) — 화면 페이지에서는 13(설정 nav)·31(설정 플러그인) 두 보드만 만진다 |
| 실행 | 합의 정제 → ralph 실행(승인됨). 금지 git 명령: stash·reset·checkout --·restore·clean·add -A·commit -a |
| 검수 안건(PDF와 함께 발송, **회신 대기**) | ⑴ 09번 경계 문구 `앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다` 유지 여부 ⑵ GUI 경로는 채팅 제안 턴을 만들지 않음(카드로만 합류) ⑶ 05번 부제 `…한 번에 하나씩 승인합니다` 폐기(묶음 승인) ⑸ 모드 밖 폐기 문구 `플러그인 모드에서 다시 요청합니다` |

---

## 8. 병렬 트랙 주의

- **에이전트 단 트랙**이 같은 기조 보드(화면 35~43)를 공유하며 자기 워크트리(`feat/agent-dual-control`)에서 진행 중이다. 화면 페이지 보드는 **읽기만** 한다.
- **카드 트랙**의 미커밋 변경이 본 저장소 작업 트리에 살아 있다(`app/canvas.js` +315 등). 그래서 이 트랙은 워크트리를 쓴다.
- 본 저장소 `.omc/state/deep-interview-state.json`은 병렬 세션이 덮어쓴다 — 이 트랙의 인터뷰 정본은 `.omc/state/deep-interview-state.athena-doctrine-plugin.json`이다.
- 두 트랙이 `app/shell.html`·`app/chat.js`·`lib/graph-mode/controller.js`를 모두 만질 수 있다 — main 병합 시 충돌 후보.

---

## 9. 검증 명령 (계획 §7 요약)

```bash
export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"
( cd app && npm run test:unit )                    # baseline 1946 대비 신규 not ok 0, 2회 연속
( cd backend && uv run pytest tests/mcp/test_plugin_tools.py tests/mcp/test_server.py -q )   # W1~W2 반복 중 좁힌 실행(약 30초)
( cd backend && uv run pytest tests/mcp -q )      # 게이트웨이 전체(약 2분, 427)
( cd backend && uv run pytest -q )                # W5 마지막에 1회(약 24분), passed ≥ 2638
( cd app && npm run verify:plugins )              # 네트워크 필요(npx/uvx 다운로드)
( cd app && npm run verify )                      # Electron 필요, verify.js 플러그인 블록
( cd app && node verify-graph-mode.js )           # A10 그래프 회귀
( cd app && grep -nE "#[0-9a-fA-F]{6}" styles/plugin-canvas.css )   # 알파 틴트 외 0
( cd app && grep -rn "플러그인 모드에서 승인할 수 있습니다" chat.js canvas.js lib/ )   # 0건
```

---

## 10. 이어받기 프롬프트 (Claude Code에 그대로 붙여넣기 — cwd는 워크트리 루트)

```
ralph — .omc/plans/athena-plugin-doctrine-consensus.md (합의 계획 반복 7, Critic APPROVE)를 이 워크트리(브랜치 feat/plugin-mode-doctrine)에서 §0 실행 규율대로 끝까지 구현한다.
PRD는 .omc/prd.json이고 US-000·001·002·005는 이미 passes:true(커밋 55c3333). US-003(W2 메인) → US-004(W3 렌더러) → US-006(CSS) ∥ US-007(하네스·파리티 문서) → US-008(§7 게이트·커밋) 순서로 진행한다.
반드시 먼저 docs/handoff/2026-09-03-plugin-mode-doctrine.md §6(편차)과 §7(결정)을 읽는다. 특히 buildProposal(spec, reason, revision, source) 객체 시그니처, resultTurnCopy → {lines, chip}, 워크트리 행 번호 오프셋(심볼 재탐색).
baseline은 .omc/state/baseline.json(app 1946/1946 · backend 2638/5 skipped)이며 재수집하지 않는다. 판정은 "baseline 대비 신규 실패 0".
금지: git stash/reset/checkout --/restore/clean/add -A/commit -a. 스테이징은 명시 git add <path>. 커밋은 한국어 type(scope) 평서형 + Co-Authored-By 트레일러.
W5-4 PDF 검수(사용자 회신)는 외부 의존이다 — 회신이 없으면 그 항목만 "대기"로 두고 나머지를 끝낸다.
```

---

## 11. 미결·리스크

| # | 항목 | 다음 행동 |
|---|---|---|
| 1 | **PDF 검수 회신 없음** (안건 4건) | 사용자가 회신하면 문구를 Paper·앱에 반영(문구는 계획 W4·W5-4에 정확히 있음). 거부되는 문구가 있으면 그 문자열만 교체 |
| 2 | 브랜치 미push | 다른 컴퓨터로 가려면 `git push -u origin feat/plugin-mode-doctrine` (사용자 판단) |
| 3 | `verify:plugins`는 네트워크 필요 | 오프라인 실패는 코드 결함으로 계상하지 않는다(계획 §7) |
| 4 | R7 플레이키 테스트 정체 미확정 | `test:unit` 2회 연속 통과로 흡수 |
| 5 | backend `dispatch` sync·카탈로그 수동 복제·픽스처 재생성(§6 4~6) | 비차단. 문제 시 §6의 권고대로 |
| 6 | 본 저장소 `.omc/state/ralplan-state.json`은 `active:false`(인계) — ralph 모드는 이 세션에서 cancel로 종료 | 새 세션은 새로 ralph를 시작한다 |
