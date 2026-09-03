# 플러그인 모드 트랙 — 다른 컴퓨터에서 이어받는 프롬프트

아래 순서대로 한다. ①은 **보내는 컴퓨터**, ②③은 **받는 컴퓨터**에서 한다.

## ① 보내는 컴퓨터 (한 번)

```bash
cd C:/Projects/DAOU.Athena-plugin && git push -u origin feat/plugin-mode-doctrine
```

## ② 받는 컴퓨터 — 터미널 준비 (Claude Code 열기 전)

필요한 것: git · **Node 22+**(`node -v`) · **uv**(`uv --version`) · Python 3.12 · Claude Code(+ `oh-my-claudecode` 플러그인이 있으면 ralph를 그대로 쓴다. 없어도 프롬프트가 수동 루프를 지시한다). Paper(디자인 도구)는 **필요 없다** — 디자인 작업(US-005)은 끝났다.

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git && cd DAOU.Athena
git switch feat/plugin-mode-doctrine
cd app && npm install && node node_modules/electron/install.js && cd ..
cd backend && uv sync --extra dev && cd ..
git config core.hooksPath scripts/hooks
mkdir -p .omc/plans .omc/specs .omc/state
cp docs/handoff/plugin-mode-doctrine/plan.md     .omc/plans/athena-plugin-doctrine-consensus.md
cp docs/handoff/plugin-mode-doctrine/spec.md     .omc/specs/deep-interview-athena-plugin-doctrine.md
cp docs/handoff/plugin-mode-doctrine/prd.json    .omc/prd.json
cp docs/handoff/plugin-mode-doctrine/baseline.json .omc/state/baseline.json
cp docs/handoff/plugin-mode-doctrine/progress.txt .omc/progress.txt
```

`node node_modules/electron/install.js`는 건너뛰면 앱이 안 뜬다(npm이 electron 바이너리를 조용히 빠뜨리는 일이 재현됨). 마지막으로 이 컴퓨터의 기준선을 한 번 잰다(17초):

```bash
cd app && npm run test:unit 2>&1 | tail -n 8
```

`# tests 1984 / # pass 1984 / # fail 0`이어야 한다(브랜치 헤드 기준). 다르면 코드가 아니라 node PATH 문제부터 본다.

## ③ 받는 컴퓨터 — Claude Code에 붙여넣기 (cwd = 저장소 루트)

````
ralph — 플러그인 모드 기조 정렬 트랙을 이어받아 끝까지 구현한다.

[저장소·브랜치] cwd는 저장소 루트이고 브랜치는 feat/plugin-mode-doctrine(HEAD 6e4eb03 이상)이다. main으로 전환하거나 main에 커밋하지 않는다.

[정본 — 이 순서로 먼저 읽는다]
1. docs/handoff/2026-09-03-plugin-mode-doctrine.md — 특히 §6(계획 문면과 다른 편차 10건)과 §7(사용자 결정, 되묻지 않는다)
2. .omc/plans/athena-plugin-doctrine-consensus.md — 합의 계획 반복 7(Critic APPROVE). §0 실행 규율, §4 W2~W5, §6 R3 결정, §7 검증 명령, §8 확정 결정 10개가 유일한 지침이다
3. .omc/prd.json — 스토리별 수락 기준(정본). US-000·001·002·005는 passes:true(커밋 55c3333). 남은 것은 US-003 → US-004 → US-009 → US-006 ∥ US-007 → US-008
4. .omc/specs/deep-interview-athena-plugin-doctrine.md — 사용자가 승인한 수락 기준 ①②③ 원문

[현재 상태] 백엔드 제안 툴 athena_plugin(backend/athena_mcp/plugin_tools.py, 427/427), 렌더러 순수 모듈 app/lib/plugin-mode-adapter.js·plugin-proposal.js(+테스트 38건), shell.html 태그 등록, Paper 플러그인 페이지 9장(디자인 파일)은 완료. 앱의 메인 프로세스·플러그인 캔버스·채팅·CSS·검증 하네스·파리티 문서는 미착수.

[진행 순서와 산출물]
- US-003 (계획 §4 W2): app/lib/main/mcp-cli.js list()에 revision 추가 · mcp-runtime-coordinator.js MUTATION_KINDS에 'plugin-batch' · 신규 lib/main/plugin-proposal-registry.js(순수: 1회용 소비 맵·pending 맵·별칭 게이트 4종·executor 8종 주입·probe는 apply 밖·install 서브사슬 보상·consume(envelope)) · 신규 lib/main/plugin-proposal-forward.js(tool_result 판정) · app/main.js(maybeForwardPluginProposal → shellWin.send('athena:plugin-proposed'), ipcMain.handle athena:plugin-approve/reject/pending, ipcMain.on('athena:plugin-noted'), providerRuntimeEnabled 분기, 액션별 감사, stageSnippet은 mcpCli 직접) · app/preload.js 채널 5종. 테스트: node --test lib/main/*.test.js
- US-004 (§4 W0-3·W3-2·W3-3·W3-4·W3-6): app/lib/plugin-canvas.js(승인 카드·3상태·setProposals·GUI 6종→deps.onPropose·낙관적 토글 제거·권한 초안 보존+발산·접근성) · app/canvas.js(재배선·revision 보관·모듈 스코프 구독+모드 게이트·plugin-noted·setView 래퍼 복원·CustomEvent athena:plugin-result) · app/chat.js(제안 턴·결과 턴 4종 _mountTurn·모드 밖 한 줄) · shell.html #chatModeHead + lib/graph-mode/controller.js 모드별 문구(사용자 승인된 예외) · 신규 lib/plugin-proposal-boundary.test.js
- US-009 (사용자 추가 지시 2026-09-03, prd.json 수락 기준이 정본): 설정 오버레이의 플러그인 탭(스니펫 등록·감사 로그·직접 삭제)을 플러그인 모드로 흡수한다 — settings-cards.js 플러그인 카드·nav 항목 제거, 감사 로그 섹션은 plugin-canvas.js 관리 뷰로, 직접 등록은 허브 '+ 서버 추가' 시트 재사용, verify-settings-cards.js 개정, Paper B-2 02 보드를 관리 뷰 셸로(화면 13 nav 항목 제거·31 보드 폐기 각주만), 파리티·감사 문서 갱신. 명세 "설정 02 카드 유지"·계획 확정 9·R8은 이 스토리가 대체한다.
- US-006 (§4 W3-5) ∥ US-007 (§4 W5-1·W5-2·W5-3): plugin-canvas.css(토큰만) · verify-plugins.js 5동작 사슬 · verify.js 플러그인 블록 개정(폐기 7·유지 7·경계 1·신설 8) · verify-graph-mode.js · PAPER_APP_PARITY.md 9행(06 보드 1680×830 기록)
- US-008 (§7 전부): test:unit 2회 연속(신규 실패 0) · backend 전수 1회(passed ≥ 2638, 약 24분, node PATH 필요) · hex·경계·문구 게이트 · 커밋

[반드시 지킬 것]
- 계획의 파일:행 인용은 다른 작업 트리 기준이라 이 체크아웃에서 어긋난다. 항상 심볼·grep으로 재탐색한다.
- 시그니처 편차: buildProposal(spec, reason, revision, source) 객체 기반 · buildBatchProposal(actions, reason, revision, source) · resultTurnCopy(kind, ctx) → {lines, chip}. plugin-proposal.js는 IIFE에서 window.AthenaLib.PluginCatalog를 요구하므로 shell.html 태그 순서(plugin-catalog.js → plugin-mode-adapter.js → plugin-proposal.js → … → canvas.js → chat.js)를 깨지 않는다.
- 실행은 사람 클릭 전용 IPC만. 제안 툴·모델 경로는 레지스트리·consent를 절대 변이시키지 않는다. Kiwoom·brain은 플러그인이 아니다. 슬래시 명령 진입 없음. 타 모드(대화·그래프·에이전트·백테스트) 캔버스·채팅 흐름은 건드리지 않는다 — 유일한 예외는 #chatModeHead 공용화(승인됨).
- 문구 3원칙: 사용자에게 보이는 문자열에 설명·안내문 없음, 한국어 단위, 내부어(MCP 서버·consent·IPC·봉투·registry) 없음. 옛 문구 '플러그인 모드에서 승인할 수 있습니다'는 0건, 새 문구 '플러그인 모드에서 다시 요청합니다'만 쓴다.
- git: stash·reset·checkout -- <file>·restore·clean·add -A·add .·commit -a 금지. 스토리마다 명시 git add <path>로 커밋(한국어 type(scope): 평서형 한 문장 + 트레일러 Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>). push는 사용자가 한다.
- 스토리마다: 구현 → 수락 기준 전부를 신선한 증거(실제 테스트 실행·파일 대조)로 확인 → prd.json passes:true → .omc/progress.txt 기록. 판정은 "baseline 대비 신규 실패 0"(절대 건수 금지). baseline은 .omc/state/baseline.json(app 1946/1946 · backend 2638/5 skipped)이며 재수집하지 않는다 — 이 컴퓨터의 test:unit 첫 실행값(1984/1984)을 app 기준선으로 쓴다.
- 도중에 질문할 수 없다. 모호하면 계획 §8 확정 결정과 인계 문서 §7 결정을 따른다.

[외부 의존] Paper PDF 검수 회신(안건 4건: 인계 문서 §7 표 마지막 행)은 사용자 몫이다. 회신이 없으면 그 항목만 "대기"로 두고 나머지를 끝낸다. npm run verify:plugins는 네트워크(npx/uvx 다운로드)가 필요하다 — 오프라인 실패는 코드 결함으로 계상하지 않는다.

[완료 조건] prd.json 전 스토리 passes:true · §7 게이트 전부 통과 · 아키텍트 검증 → deslop → 회귀 재검증 → /oh-my-claudecode:cancel. 끝나면 커밋 목록·테스트 수치·미결(검수 대기 등)을 한 화면으로 보고한다.

[oh-my-claudecode 플러그인이 없으면] "ralph —" 대신 위 내용을 그대로 지시로 삼아 스토리 순서대로 수동 루프를 돈다: 스토리 하나 구현 → 수락 기준 검증 → prd.json 갱신 → 커밋 → 다음 스토리. 아키텍트 검증은 마지막에 코드 리뷰로 대신한다.
````
