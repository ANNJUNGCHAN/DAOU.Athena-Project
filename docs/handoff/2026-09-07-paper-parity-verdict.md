# 인계 — Paper 「Athena」 정합 판정·전수 구현 트랙 (2026-09-07)

> **이 문서의 용도.** 2026-09-05~07 세 세션에 걸쳐 진행한 「Paper 디자인대로 모든 코딩이 되었는지 판단하고, 안 된 것은 전부 구현한다」 작업을 **다른 사람이 같은 자리에서 그대로 이어받기 위한** 문서다. 원래 대화·메모리·임시 폴더는 다음 사람에게 없다. 그래서 이 문서와 같은 폴더의 지원 묶음(`docs/handoff/2026-09-07-paper-parity/`)만으로 끝까지 갈 수 있게 썼다.
> **모든 명령은 Git Bash 문법이다.** PowerShell에 그대로 붙이면 첫 줄부터 깨진다.
> 읽는 순서: §0 → §2(사용자가 확정한 것) → §3(환경·명령) → §7(남은 7장, 여기가 할 일) → 나머지는 필요할 때.

---

## 0. 30초 요약

- **하는 일.** Paper 파일 「Athena」(fileId `01M0VGPX92K1TER4ZV9PWGQJJZ`, 10페이지 444보드)를 Electron 앱(`app/`) + FastAPI 백엔드(`backend/`)가 **그대로** 구현했는지 전수 게이트 3종으로 재고, 빨간 보드를 묶음별로 「구현 → 독립 검토 → main 푸시」로 닫는다.
- **어디까지 왔나 (main `bdb40b6`, 2026-09-07 10:35 KST).**

  | 게이트 | 1판 (09-05) | 최종 |
  |---|---|---|
  | 카드 96장 (정적 6검사 + 런타임 4폭) | 64 | **95** (남은 1: `137X-2`) |
  | 화면 95장 (라우트 실측 래칫) | 8 | **91** (남은 4: `3KM-0` `3W9B-1` `2I7Z-2` `2GZM-2`) |
  | 계약 14장 (문장이 문서에 실재) | 0 | **12** (남은 2: `1XA2-0` `2DZE-0`) |
  | 카드미니 192장 | 19 | **19** (Paper 정정 선행) |

  첫 판정(`c33ef0a`) 이후 main에 병합 제외 **221커밋**, 단위 테스트 3,345개·pre-push 게이트 6종 전부 초록.
- **정확한 중단점.** 코드로 닫을 수 있는 것은 전부 닫혔다. 남은 7장은 **사용자가 2026-09-07에 답을 주었거나(§2.3), 자료를 보고 정하겠다고 한 것**이다. 다음 사람은 §7 순서대로 진행하면 된다. Paper 파일 편집은 **§2.3에 적힌 범위만** 승인됐다.
- **보고서.** 최종 판정 4판 HTML이 `docs/handoff/2026-09-07-paper-parity/report/athena-paper-parity-verdict.html`(생성기 `build_report.py`)에 있다. 사용자 계정의 Claude 아티팩트(같은 내용)는 `https://claude.ai/code/artifact/9859288f-24d9-49c3-9b75-971710b20ca4`.

---

## 1. 이 트랙의 성격 — 왜 「게이트」인가

사용자의 요구는 「판단해줘」로 시작했지만 곧 「Paper에 있는 것은 **전부** 구현돼야 한다」·「카드는 Paper와 **동일**해야 한다」로 굳어졌다. 그래서 사람이 보드를 눈으로 대조하는 대신 **Paper 원장(ledger)을 저장소에 들이고, 앱을 실제로 띄워 원장과 대조하는 게이트**를 만들었다. 게이트가 빨간 보드 = 남은 구현 작업이다. 판정 근거는 언제나 게이트 리포트이지 사람의 인상이 아니다.

세 게이트(§4)와 리포트(`app/captures/paper-gates/PAPER-{CARDS,SCREENS,MINI}.json`, git ignore)가 이 트랙의 정본이다. 「빨간데 초록으로 만들기 위해 게이트를 느슨하게 하는 것」은 이 트랙에서 가장 금지된 행동이다(§2.2).

---

## 2. 사용자가 확정한 것 — 다시 묻지 말 것

### 2.1 지시 (원문, 시간순)

1. 「코드 검수 한번 진행해줘」 → 「paper design에서 의도한대로 모든 코딩이 잘 되었는지 판단해줘.」 (2026-09-05, 출발점)
2. 「지금 종목 카드 검수한다고 돌아가는거 있잖아. 이거 전혀 paper design에 없는거거든? **paper design과 동일하게 작도해야해. 적어도 카드는.**」 → 카드는 Paper 보드 96장을 1:1로. 앱이 자체 렌더러로 「비슷하게」 그린 카드는 전부 실패다.
3. 「**코드 바뀌면 바로바로 커밋하고 푸시해줘**」 → 작업마다 즉시 커밋·푸시. 브랜치에 쌓아 두지 않는다.
4. 「해당 브렌치들 싹다 main에 커밋시키고 다 푸시. **모든 변경사항을 main에 전부 병합하고 푸시해줘.**」 → 작업 워크트리 브랜치에서 `git push origin HEAD:main`으로 main에 직접 올린다(PR 없음).
5. 「난 이절차를 왜 하는지를 모르겠어.」 → 설명 뒤 「지금처럼 유지」 → Electron 검증 창이 뜨는 방식(실제 앱을 띄워 재는 게이트)을 유지한다.
6. 「근데 **모든 paper design에 있는 것들도 전부 구현되도록 검증창을진행해야해**」 → 게이트를 444보드 전수로 확장하고, 빨간 보드를 구현으로 닫는다. 스텁으로 초록을 만드는 것이 아니라 실제 기능을.
7. 「claude/mode-window-project-edit-ux-8c0bae 이거 병합시킨 후 이걸 포함해서 테스트 진행해줘.」 → 완료(main 반영).
8. 「이제 이 업무는 다른 사람한테 넘겨줄 거니까 … 인수인계 문서를 최대한 상세하게 md파일로 작성하여 완벽하게 이어서 진행할 수 있게 만들어줘」 (2026-09-07) → 이 문서.

### 2.2 이 트랙의 불변 규칙 (사용자 지시 + 저장소 규약에서 굳어진 것)

- **Paper가 정본이다.** 앱이 Paper와 다르면(문구·요소·상태) 앱을 Paper 쪽으로 고친다. 라우트나 슬롯을 앱에 맞춰 느슨하게 적어 초록을 만드는 것은 거짓말이다.
- **잠긴 계약은 Paper보다 우선한다** (사용자가 그 전에 명시적으로 결정한 것): 키우미 얼굴 1종(2026-09-01) · 에이전트 `#chatModeHead` 숨김 · body `word-break: keep-all` 금지 · 설정 nav 라벨 「성향・이력」 · `verify.js` emptyHistory 부팅 계약 · 실주문 금지(`/api/v1/order/*` 호출 금지, mock 브로커 하드락) · pre-push 60초 예산. Paper와 충돌하면 **사용자에게 묻는다**(§7.5가 그 두 건).
- **스텁·가짜 값·예외 목록·게이트 완화 금지.** `test.skip`/`.only`/TODO 금지. `--allow-shrink`·`--no-verify` 금지. 값은 실데이터·fixture 경로에서만.
- **제품 문구 3원칙.** 설명문 금지 · 한국어 단위(M/K/B → 천·만·억·조, 단 Paper가 「47,957」처럼 쉼표로 그린 가격은 그대로) · 내부용어 금지(recipe·AITS·fixture·TR id·환경변수 이름을 사용자에게 노출하지 않는다).
- **CLAUDE.md.** 단순성 우선, 수술적 변경, 기존 스타일 유지, 자기 변경이 만든 고아만 정리.
- **커밋 형식.** 제목 `type(scope): 한국어 한 문장`, 본문 2~5줄(무엇을 왜·검증 수치), 트레일러 `Constraint:` `Rejected:`(있으면) `Confidence: high|medium|low` `Scope-risk: narrow|moderate|broad`, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git commit -F <파일>`로 쓰고 `git add <경로>`로 바꾼 것만 스테이징(`app/captures/` 산출물·정션·스크래치 금지).
- **Paper 파일은 사용자 것이다.** 읽기(`get_tree_summary`·`get_node_info`·`get_jsx`·`find_nodes`·`get_screenshot`)는 자유, **쓰기는 §2.3에서 승인된 범위만.** 서브에이전트에게는 `open_file`(사용자 화면을 바꾼다)·`get_screenshot`(무겁다)을 금지했다.

### 2.3 2026-09-07 사용자 답변 (남은 7장에 대해)

| 질문 | 답 | 뜻 |
|---|---|---|
| 1XA2-0·2DZE-0 계약 캡션, 137X-2 신주인수권 진입 칩, 카드미니 paper_cross_board 10장 — Paper 파일을 누가 고치나 | **「내가 Paper를 고친다」**(= 담당자가 Paper MCP로 고쳐도 된다) | 이 세 범위에 한해 Paper 편집 승인. §7.1·§7.2·§7.3 |
| 백테스트 보드 10(프리셋 고르기) vs 보드 19(「프리셋이라는 구분은 없습니다」) — 어느 쪽이 정본 | **「보드 19 정본」** | 보드 10(`2GZM-2`)을 매니페스트에서 화면이 아닌 것으로 재분류. §7.4 |
| 키우미 얼굴 1종(09-01)·빈 캔버스 문구 회전(08-27) vs Paper `2I7Z-2`·`3KM-0` | **「이건 나한테 직접 보여줘. 원문과 정본을 찾아서 직접 보여줘」** | 결정 보류. Paper 원문과 앱 현재 상태를 나란히 보여 준 뒤 다시 묻는다. §7.5 |
| `3W9B-1` 동시 실행 | **「이거에 대해서 조금 더 자세하게 설명해줘」** | 결정 보류. §7.6의 설명을 전달하고 다시 묻는다 |

**아직 결정되지 않은 것(임의로 정하지 말 것):** `2I7Z-2`·`3KM-0`의 정본, `3W9B-1`의 진행 여부·범위, 카드미니 `unbacked`·`annotation_drift` 부류의 정본 방향(§7.3).

---

## 3. 저장소·환경·명령

### 3.1 저장소 상태

| 항목 | 값 |
|---|---|
| 주 체크아웃 | `C:/Projects/DAOU.Athena`, 브랜치 `main` = `origin/main` = `bdb40b6` (2026-09-07 10:35). 상태 clean |
| 작업 워크트리 A | `C:/Projects/DAOU.Athena-parity`, 브랜치 `fix/paper-parity-2026-09-05`, HEAD = main과 동일. `app/node_modules`·`backend/.venv`는 주 체크아웃으로의 **정션**(junction) |
| 작업 워크트리 B | `C:/Projects/DAOU.Athena-gates`, 브랜치 `feat/paper-gates-2026-09-06`, main보다 뒤(마지막 푸시 `3960fca`). 정션 동일. 다시 쓰려면 먼저 `git merge -X ignore-cr-at-eol --no-edit origin/main` |
| 커밋 범위 | 이 트랙 첫 판정 `c33ef0a` → `bdb40b6`: 병합 제외 221커밋 (`git log --oneline --no-merges c33ef0a..origin/main`) |
| pre-push 훅 | `scripts/hooks/pre-push` — 게이트 6종(`check-orb` `check-glass-ladder` `check-window-model` `check-harness-freshness` `check-paper-routes` + `app/scripts/paper-manifest-check.mjs`) + app 단위 전체. 60초 예산. 붉으면 push가 막힌다 — 우회하지 말고 초록을 만든다 |
| 백엔드 | `127.0.0.1:8010`가 떠 있어야 Electron 게이트가 돈다(`ATHENA_NO_AUTOSTART=1`로 프로브가 백엔드를 안 띄운다). `verify:backtest`는 `GET /ready == 200`을 전제하는데 키움 데이터 세션이 없으면 503이라 **이 환경에서는 못 돈다**(§8) |

워크트리 운영 규칙: 두 트랙이 동시에 돌 때는 **각자 자기 워크트리만** 수정·커밋한다. 시작 전과 푸시 전에 `git fetch origin && git merge -X ignore-cr-at-eol --no-edit origin/main`. 푸시는 `git push origin HEAD:main`, 성공하면 주 체크아웃에서 `git pull --ff-only`. 병합 충돌이 `app/lib/paper-screens-ratchet.json` **하나뿐**이면 `git checkout --theirs app/lib/paper-screens-ratchet.json && (cd app && npm run verify:paper-screens -- --bless)`로 실제 통과 집합을 다시 잠근 뒤 병합 커밋(이 파일은 파생물이라 안전). 다른 파일이 충돌하면 강제 해결하지 말고 사람에게.

### 3.2 명령

```bash
# Node (fnm) — 모든 셸에서 먼저
export PATH="/c/Users/ajc22/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"

# 단위 전체 (~15초, 3,345개)
cd C:/Projects/DAOU.Athena/app && node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js

# 백엔드 pytest (파일 단위로; 전체는 ~17분)
cd C:/Projects/DAOU.Athena/backend && .venv/Scripts/python -m pytest tests/<파일> -q -p no:randomly

# 저장소 게이트 (반드시 저장소 루트에서)
cd C:/Projects/DAOU.Athena && node scripts/gates/check-orb.mjs && node scripts/gates/check-glass-ladder.mjs && node scripts/gates/check-window-model.mjs && node scripts/gates/check-harness-freshness.mjs && node scripts/gates/check-paper-routes.mjs
cd C:/Projects/DAOU.Athena/app && node scripts/paper-manifest-check.mjs

# Paper 전수 게이트 3종
cd C:/Projects/DAOU.Athena/app
npm run verify:paper-manifest        # 매니페스트 불변식 (0.4초)
npm run verify:paper-cards-static    # 카드 96장 정적 S1~S6 (수 초)
npm run verify:paper-cards-mount     # 카드 96장 × 4폭 Electron 마운트 (~30초). 샤딩: ATHENA_VERIFY_BOARD_IDS=137X-2,15R0-2
npm run verify:paper-screens         # 화면 95 + 계약 14 (~12초)
npm run verify:paper-screens -- --only 3KM-0,2GZM-2   # 일부만
npm run verify:paper-screens -- --bless                # 전수 실행 뒤 통과 집합을 래칫에 잠근다 (--only와 같이 못 씀; 집합이 줄면 exit 1)
npm run verify:paper-mini            # 카드미니 정적 + 템플릿 (상시 빨강 — §7.3)
npm run verify:paper                 # 위 전수 묶음 (scripts/run-verify-suite.js --suite paper)

# 표면별 Electron 게이트 (앱을 고쳤을 때 그 표면 것을 돌린다)
npm run verify                # 셸 전반 (emptyHistory 계약 포함, 캡처 app/captures/*.png)
npm run verify:kiumi          # 키우미 (얼굴 1종 계약 포함)
npm run verify:kiumi-cards    # 키우미 미니 카드
npm run verify:integrated-cards
npm run verify:graph-mode
npm run verify:agent-paper-parity
npm run verify:backtest       # /ready 200 전제
```

리포트: `app/captures/paper-gates/PAPER-CARDS.json` · `PAPER-SCREENS.json` · `PAPER-MINI.json` (git ignore, 커밋 금지). 리포트 → 작업 명세 변환기: `node scripts/paper-gate-tasks.mjs --report app/captures/paper-gates/PAPER-SCREENS.json --report ... --limit 20 --out .omc/plans/paper-tasks.json` (작업 1개 = 보드 1장).

### 3.3 Paper MCP

- 파일 `01M0VGPX92K1TER4ZV9PWGQJJZ`. 페이지: `1-0` 화면 · `D-2` 그래프 · `5-1` 카드 · `F-1` 증명 · `A-2` 에이전트 · `B-2` 플러그인 · `H-1` 카드미니 · `C-2` 키우미 · `8-1` 백테스트 · `G-1` 백테스트 구현 현황.
- 모든 호출에 `fileId`를 넘긴다. 읽기: `get_tree_summary(nodeId, depth≤10)`(구조·텍스트, 가장 싸다) · `get_node_info`(원문 텍스트) · `get_jsx`(레이아웃 원문, 크다) · `find_nodes(textValue)` · `get_screenshot`. 쓰기: `set_text_content`(텍스트만) · `duplicate_nodes` · `write_html`(insert-children/replace) · `update_styles`. 쓰기 뒤 반드시 `finish_working_on_nodes`.
- 서버는 종종 연결 실패 상태로 시작한다(「recent failure cached, retries in 15 min」). 그럴 땐 **원장(§3.4)으로만 작업**하고 15분 뒤 다시 시도한다. 원장은 444/444 보드가 Paper에서 추출된 것이라 판정에는 충분하다.
- 폰트: Paper는 `Daki`·`Daki B`·`Daki Title`·`Geist Mono`. 이 머신에는 Daki가 없다(§8 폰트 항목).

### 3.4 Paper 원장(ledger)과 매니페스트

- `backend/ref/paper-ledger/<page>/<board>.json` — `{board_id, page, page_name, name, width, height, texts[{id,text,path}], frames[{id,name,component,w,h,depth}], text_multiset, exported_at, tree_summary_sha256}`. 같은 자리 `<board>.tree.txt`는 `get_tree_summary` 원문. 2026-09-05 추출(커밋 `63109ef`), 추출 스크립트는 지원 묶음 `workflows/athena-paper-ledger-export.js`.
- `backend/ref/paper-ledger/manifest.json` — 보드마다 `{id, page, name, role, why?}`. role ∈ `screen`(라우트 필수) · `contract`(계약 문장이 문서에 있어야) · `card_template`(카드 96) · `card_spec` · `mini_template` · `mini_card` · `record` · `reference`(명세·사양 판, 게이트 밖, why 필수) · `retired`(폐기, why 필수). 지금 집계: screen 95 · contract 14 · card_template 96 · card_spec 8 · mini_template 11 · mini_card 192 · record 17 · reference 8 · retired 3. `app/scripts/paper-manifest-check.mjs`가 불변식을 잰다.
- **보드 한 장의 원장을 다시 뽑는 법**(Paper를 고친 뒤): Paper MCP로 `get_tree_summary(nodeId=<보드>, depth=10)` 원문을 `<board>.tree.txt`로, 같은 규칙으로 파싱한 JSON을 `<board>.json`으로 덮어쓴다(파서 규칙은 `workflows/athena-paper-ledger-export.js`의 프롬프트 2단계에 그대로 적혀 있다 — 잘린 문구 `…`는 `get_node_info`로 원문을 받고, `tree_summary_sha256`는 summary 원문 해시). 가장 확실한 방법은 그 워크플로를 청크 하나(`{page, name, chunk, ids:[<보드>]}`)로 다시 돌려 산출을 복사하는 것이다. 그 뒤 `node scripts/paper-phrases.mjs`로 `app/lib/paper-screen-phrases.generated.js`를 다시 만든다(문구 후보가 원장에서 나온다).

### 3.5 카드 파이프라인 (카드 96장 = Paper 1:1)

Paper JSX → `backend/ref/card-surface-templates/<board>/{paper.jsx, paper.tree.txt, board.html, slots.json, regions.json, meta.json}` → `python scripts/build_board_registry.py` → `app/lib/board-templates.CC-0X.generated.js` + `board-templates.index.generated.js`(STATE_GRAPH) → `app/lib/board-template-registry.js` / `board-mount.js` / `integrated-card-surface.js` / `app/styles/board-surface.css`. 한 보드 재추출·검사: `python scripts/paper_board_extract.py <board> --check`. `meta.json`의 `state{kind, parent_board, control}`가 탭 레일(상태 보드) 링크를 정한다 — 부모 링크가 없으면 갈아탄 뒤 레일이 통째로 죽는다(`board-template-registry.js:176` 주석). 카드 표면 규칙 정본: `docs/ui/paper-card-surface-charter.md`, 인계 `docs/handoff/2026-09-03-card-surface-paper-to-code.md`.

---

## 4. 게이트 3종의 계약 — 무엇을 어떻게 재나

### 4.1 화면 게이트 `verify:paper-screens` (러너 `app/probe-paper-screens.js`, 판정 `app/lib/paper-screens-report.js`)

- 대상: 매니페스트 `role=screen`(95) + `contract`(14) = 109장. 리포트 `totals {boards, pass, fail, route_missing, contract, contract_fail}`.
- **라우트표 `app/lib/paper-screen-routes.js`가 저작 규칙의 정본이다.** 파일 머리 주석을 먼저 읽는다. 보드마다 `{window, reach[], root, phrases[], structure[]}`:
  - `reach` 어휘는 닫혀 있다(`STEP_KINDS`): `click` `hover` `mode` `command-bar` `type` `ipc-fixture` `envelope` `send` `resize` `ipc-hang` `wait` `settle` `eval`(why 필수). 임의 JS 금지.
  - `phrases` 3~7개: 원장 texts에 실재하는 제목·버튼·탭·안내문만(숫자·시각·종목명·금액 금지). 후보는 `app/lib/paper-screen-phrases.generated.js`. 포함 판정(앱이 더 길게 그려도 Paper 문구가 그 안에 있으면 통과). 하한 3 미만이면 공허 통과라 금지(예외: `PHRASE_FLOOR_EXCEPTIONS`에 사유와 함께, structure 2개 이상 필수).
  - `structure`는 `count`·`order`·`absent` 셋뿐. **Paper와 앱이 실제로 어긋나는 자리에는 아무것도 적지 않는다**(앱을 정본으로 삼는 거짓말이 된다).
  - 판정은 **가시 텍스트**(hidden 조상 없는 것만). placeholder·`::before`는 문구가 못 된다.
- 계약 보드: 원장 texts에서 계약 문장(`contractSentences`: 12자 이상·마침표로 끝남, E1~E7 하드 제외 `app/scripts/paper-phrases.mjs excludeReason`)을 뽑아 `docs/ui/paper-card-surface-charter.md`·`docs/architecture/*.md`에 **그대로** 있는지 문자열로 잰다. `contract_undocumented`(문장이 문서에 없다) / `contract_no_sentence`(뽑힌 문장 0개). 계약 문서: `docs/architecture/paper-contracts.md`.
- 래칫 `app/lib/paper-screens-ratchet.json` `{target_boards:109, passing:[103]}`. `--bless`는 전수 실행에서만, 집합이 줄면 exit 1.
- 정적 린트 `scripts/gates/check-paper-routes.mjs`(셀렉터·DOM id를 `shell.html`/`orb.html`과 대조) + `app/lib/paper-screen-routes.test.js`.

### 4.2 카드 게이트 `verify:paper-cards-static` + `verify:paper-cards-mount`

- 정적(`app/scripts/paper-cards-static.mjs`) S1 매니페스트 · S2 텍스트 다중집합(원장을 **카드 루트 서브트리**로 좁혀 slots.json과 대조 — `964b5b7`) · S3 상태 링크(마크 target이 색인에 있는가) · S4 Paper 트리(템플릿 `paper.tree.txt` vs 원장) · S5 레지스트리 · S6 색인 대칭.
- 마운트(`app/probe-paper-cards-mount.js`) 96장 × 4폭(원본·2분할·4분할·최소)을 실제 Electron에서 마운트해 `dom_mismatch`(가시 텍스트 ≠ slots) · `surface_geometry`(세로 넘침·겹침) · `overflow_x` · `state_board_missing_in_dom`(레일 칩 수 ≠ 상태 보드 수) · 3초 paint ack를 잰다.
- 지금 남은 1장: `137X-2` `state_board_missing_in_dom expected 7 / in_dom 6` (4폭 전부). §7.2.

### 4.3 카드미니 게이트 `verify:paper-mini` (`app/scripts/paper-mini-static.mjs` + `app/lib/paper-mini-compare.js` + `app/probe-paper-mini-template.js`)

- Paper `H-1` 페이지의 `mini/*`(96) + `note/*`(96) + `template/*`(11)를 대장 `backend/ref/kiumi/kiumi-ledger.jsonl`(승인된 96장 정본)과 대조한다. 부류: `paper_cross_board`(Paper가 **다른 보드**의 값을 들고 있다) · `paper_form_deviation`(표기 차) · `ledger_stale`(Paper 값이 자기 보드 slots에 실재하는데 대장이 다른 슬롯을 고름) · `unbacked`(어디에도 없음) · `annotation_drift`(note 4줄 불일치) · `missing_in_paper`.
- **정본 결정 규칙 §5.2**(설계서 `plans/plan-paper-gates.md:654-663`, 스크립트 머리): `paper_cross_board`가 0이 되기 전에는 Paper를 대장에 반영하지 않는다(지금 반영하면 앱이 망가진다). 이 게이트는 대장을 고치지 않고 세기만 한다. cross-board가 0이 된 뒤 `ledger_stale`은 대장 수정 대상, `form_deviation`은 보고만, `unbacked`·`annotation_drift`는 **방향이 아직 설계서에 없다**. §6.3: cross-board 0 + 60초 이내가 되면 pre-push로 승격.
- 지금: matched 19 · divergent 77 · paper_cross_board 10 · form_deviation 17 · ledger_stale 136행 · unbacked 49행 · annotation_drift 94/96.

---

## 5. 진행 이력 (회차별)

| 회차 | 기간 | 워크플로 (지원 묶음 `workflows/`) | 결과 |
|---|---|---|---|
| 판정 1판 | 09-05 | `athena-code-review`(코드 검수 110→81건 확정) · `athena-paper-parity-audit`(보드 272장 관찰) · `athena-card-template-drift`(96/96 동일) | 「Paper대로 코딩됐다고 볼 수 없다」. 시세 카드가 Paper 보드에 착지하지 않는 경로 추적 |
| 원장·게이트 | 09-05~06 | `athena-paper-ledger-export`(444/444) · `athena-paper-gates`(8작업: 원장 커밋·매니페스트·게이트 3종·변환기) | 첫 전수: 카드 64/96 · 화면 8/116 · 미니 19/192 |
| 수정 트랙 | 09-05~06 | `athena-parity-fixes`(22작업, parity 워크트리) | 카드 라우팅 축 전환·보드 하이드레이션·상태 링크·시세→`2R3M-1` 착지·`137X-2` 차트 마운트·호가 사다리 마운트·화면 1~5군·문서 정합 |
| 화면 트랙 | 09-06 | `athena-paper-screens-impl`(20묶음, gates 워크트리) + `athena-paper-screens-reauthor`(4장) | 화면 래칫 8 → 92/115, 계약 10/12, 검색 빈 결과판·Grok UI 뒷정리·오브 눈 프로브 |
| 카드 트랙 | 09-06 | `athena-paper-cards-fix`(5묶음) | 카드 64 → 93/96 (XS 표 넘침 19장 · 숫자 포맷 10장 · 세로 넘침 · 트리 드리프트) |
| 구현 3차 | 09-06 21:40 ~ 09-07 07:40 | `athena-paper-implement` args `tasks/tasks-paper-implement-a.json`(6묶음, parity) · `-b.json`(4묶음, gates) | role 재분류 8장(`fc836aa`·`9bc7210`, 분모 115→109) · `1WOB-1` · 프로젝트 추가 대화상자(`d68faf8`) · 세션 작업공간 복원(`533c83d`) · 출처→지도 5단계(`8f5441e`) · 미니 카드 도달 통로(`ac8452f`) · 제어 제안 턴 A~E(`7ef6502`) · 작업 설정 편집 폼(`2761b30`) · 고침 이력·되돌리기(`6f9324b`) · entity 응답 패널(`3960fca`). 카드 94, 화면 90/95, 계약 12/14 |
| 구현 4차 | 09-07 08:10 ~ 10:35 | `athena-paper-implement` args `tasks/tasks-paper-implement-c.json`(3묶음, parity) | `15R0-2` 폰트 metric override(`e7bbd3e`) · `2QCN-2` 지도 범례·노드 채움=확정성(`a8b65c5`·`f29b1e8`) · `2GZM-2` 오류 상태 배지·503 원인 보존(`f1da2c6`·`bdb40b6`, 프리셋 고르기 절반은 Paper 대 Paper 충돌로 gap 확정). 카드 95, 화면 91/95 |

각 묶음은 「구현자 → 독립 검토자(최대 3회, 실측 재현) → 푸시 담당」 세 에이전트가 맡았다. 검토자가 되돌린 것 2건: `32XM-0` 재배치(레일이 죽는 것을 실측해 복원, `d7c516f`) · 503을 「꺼짐」으로 단정하던 문구(원인 보존, `bdb40b6`). 워크플로 저널(에이전트별 결과 원문)은 원래 세션 폴더에만 있으므로, 보드별 결론은 `report/gaps-screens-annotated.json`·`gaps-cards.json`·`round3-boards.json`·`round4-boards.json`에 옮겨 두었다.

---

## 6. 현재 게이트 상태 (main `bdb40b6`, 로그 `gate-logs/final-gates-bdb40b6.log`)

```
paper manifest   passed — screen=95 card_template=96 card_spec=8 mini_template=11 mini_card=192 contract=14 record=17 reference=8 retired=3
paper-cards-static  보드 96장 · 통과 96 · 실패 0
paper-cards-mount   보드 96장 · 통과 95 · 실패 1   FAIL 137X-2 (CC-03) — state_board_missing_in_dom (expected 7 / in_dom 6, 4폭)
paper-screens       boards 109 · pass 103 · fail 6 — route_missing 3KM-0 3W9B-1 2I7Z-2 2GZM-2 · contract_no_sentence 1XA2-0 2DZE-0
paper-mini          matched 19 / 192 · divergent 77 · paper_cross_board 10
```

보고서 재생성: `python docs/handoff/2026-09-07-paper-parity/report/build_report.py`(주 체크아웃의 리포트 3종·래칫·매니페스트와 `report/gaps-*.json`을 읽어 `report/athena-paper-parity-verdict.html`을 쓴다). 새 회차가 보드를 닫으면 `gaps-*.json`의 해당 보드에 `round5: {status, detail, gap_files, gap_size, track}`를 넣고 `still_failing`을 내리는 식으로 이어 간다(생성기는 `round4` → `round3` 순으로 최신 기록을 고른다 — `round5`를 쓰려면 `_closed_round`와 `board_row`의 키 목록에 추가).

---

## 7. 남은 7장 — 할 일 (우선순위 순)

> 공통 절차: 워크트리에서 최신 병합 → 구현 → 단위 전체 + 해당 게이트 → 커밋(형식) → 독립 검토(가능하면 다른 세션/에이전트) → `push origin HEAD:main` → 주 체크아웃 `pull --ff-only` → `report/gaps-*.json` 갱신 → 보고서 재생성.

### 7.1 `1XA2-0` · `2DZE-0` — Paper에 계약 캡션 한 줄 (승인됨)

**왜 빨간가.** 둘 다 `role=contract`인데 원장 texts에 **마침표로 끝나는 텍스트가 0건**이라 계약 추출기가 잴 문장이 없다(`contract_no_sentence`). 같은 갈래의 형제 보드(`177W-2`·`17F8-2`·`17IH-2`·`17MB-2` / `1XGW-0`·`2E4E-0`)는 헤더에 마침표 캡션을 달아 문장이 잡힌다. 문서 `docs/architecture/paper-contracts.md:184-`(1XA2-0), `:235-`(2DZE-0)에 이 사실과 표로 적힌 계약이 이미 옮겨져 있다. 코드 쪽은 할 일이 없다.

**Paper 편집 절차.**
1. 형제 보드의 캡션 자리를 본다. 예: `177W-2`는 `Orderbook Mode Header`(177X-2) 안 `Frame`(177Y-2)에 제목 Text 「삼성전자 호가를 시장별로 보여줘」와 캡션 Text 「정규장·통합·시간외·금현물 데이터를 같은 래더 문법으로 읽습니다.」가 나란히 있다(`backend/ref/paper-ledger/F-1/177W-2.tree.txt:2-5`).
2. `1XA2-0`: 헤더 `Instrument Header`(1XEL-0) 아래 부제 Text 「주식일봉차트조회 · 공식 응답 항목과 선택 행을 한 화면에서 확인」을 `find_nodes(textValue="주식일봉차트조회 · *")`로 찾아, **문장 하나를 캡션으로 더한다**(형제와 같은 스타일이 되도록 그 부제 노드를 `duplicate_nodes`한 뒤 `set_text_content`). 문장 후보(사용자에게 확인): 「차트 카드를 펼치면 주식일봉차트조회의 공식 응답 항목 전부와 선택한 행의 상세를 한 화면에 놓습니다.」
3. `2DZE-0`: 계약을 적은 두 줄 「그룹 제목과 구분선으로 탐색 · 필드별 독립 카드 없음」·「39 / 39 공식 필드 연결」이 이미 있다. 같은 자리에 문장 후보: 「공식 필드 39개를 그룹 제목과 구분선으로만 나누고 필드별 독립 카드는 만들지 않습니다.」
4. `finish_working_on_nodes`. 바꾼 노드 id·이전/이후 텍스트를 커밋 본문에 적는다(되돌릴 수 있게).
5. 원장 재추출(§3.4) → `node scripts/paper-phrases.mjs` → 그 문장을 `docs/architecture/paper-contracts.md`의 해당 절에 **그대로** 옮기고 「계약 문장 0개」 문단을 고친다 → `npm run verify:paper-screens -- --only 1XA2-0,2DZE-0` → 전수 `--bless`(래칫 103 → 105) → 단위 → 커밋 2개(원장·문서 / 래칫) → 푸시.

### 7.2 `137X-2` — 신주인수권 보드(`32XM-0`)로 가는 문 (승인됨)

**왜 빨간가.** `137X-2`(CC-03 삼성전자 3개월 차트) 탭 레일 `14O9-2`의 칩은 현재시세·차트·기업정보·금현물·투자자 12주체·순위 여섯인데, 상태 보드는 일곱이다 — Paper가 「순위」 칩 하나에 `2VDA-0`(주식 순위)과 `32XM-0`(신주인수권 전체시세, op `ka10011`, 그 op의 유일한 보드)을 함께 매달았다. `32XM-0` 자신은 상품 레일에서 「순위」가 ACTIVE이고 범위 레일을 그리지 않는다. `2VDA-0`의 범위 레일은 주식·ETF·ELW뿐이라 신주인수권으로 가는 문이 Paper 어디에도 없다. 3차에서 `32XM-0`을 부모 없는 보드로 내려 보았으나 STATE_GRAPH에서 사라져 그 보드의 레일 7칩이 전부 죽었고, 검토자가 실측해 되돌렸다(`d7c516f`). 관련 기록 `report/round3-boards.json`의 `137X-2`.

**Paper 편집 절차(권장안 A — 범위 레일에 칩 추가).**
1. `get_tree_summary`로 `2VDA-0`·`2VIN-0`·`2VO0-0`·`32XM-0`·`137X-2`의 레일 프레임을 본다(카드 페이지 `5-1`; 원장 `backend/ref/paper-ledger/5-1/`).
2. `2VDA-0`·`2VIN-0`·`2VO0-0`의 범위 레일(주식·ETF·ELW)에 「신주인수권」 칩을 **기존 칩 `duplicate_nodes` + `set_text_content`**로 더한다. `32XM-0`에는 같은 범위 레일을 복제해 넣고 「신주인수권」을 ACTIVE 스타일로(`2VDA-0`에서 ACTIVE인 「주식」 칩의 스타일을 `get_computed_styles`로 확인해 `update_styles`).
3. 대안 B(137X-2 상품 레일에 칩 추가)는 Paper의 정보구조(순위 = 범위 레일로 우주를 고른다)와 어긋나므로 쓰지 않는다. 사용자에게 A를 보여 주고 확정.
4. `finish_working_on_nodes`.

**앱 후속.**
1. 네 보드 재추출: `python scripts/paper_board_extract.py <board> --check`가 드리프트를 보고하면 재추출(원장 `.tree.txt`·`.json`도 §3.4로 갱신).
2. `backend/ref/card-surface-templates/32XM-0/meta.json`의 `state`를 `{kind:"tab", parent_board:"2VDA-0", control:"신주인수권"}`으로, `2VIN-0`·`2VO0-0`은 이미 `parent_board: 2VDA-0`(3차에서 옮김).
3. `python scripts/build_board_registry.py` → 정적 S2·S3·S6 → `verify:paper-cards-mount`(137X-2 expected 6 / in_dom 6이 되어야 하고 다른 보드 회귀 0) → `verify:integrated-cards`.
4. **깊이 2 레일 배선(앱 공백, 같이 닫을 것).** `app/lib/board-template-registry.js stateLinksFor`가 자기+부모 한 단만 합쳐서 `2VIN-0`·`2VO0-0`(이제 `32XM-0`도)에서 Paper가 그린 상품 레일 4칩과 범위 레일 「주식」(2VDA-0으로 되돌아가기)이 눌리지 않는다. 조상 사슬을 걷도록 고치되, 깊이 2 보드 60여 장의 동작이 함께 바뀌므로 전수 마운트로 회귀 0을 증명한다(3차 기록 `round3-boards.json` 137X-2 detail 마지막 단락).

### 7.3 카드미니 — Paper `H-1`의 paper_cross_board 10건 (승인됨) → 그 뒤 대장 정합

**10건 정밀표**(리포트에는 노드 id가 없어 `backend/ref/paper-ledger/H-1/<board>.tree.txt`에서 `group` 이름으로 확정한 것; 분류 코드는 `app/lib/paper-mini-compare.js:127-140`, cross-board 판정 `:136-138`).

| # | mini 보드 | 보드명(요약) | Paper 노드 id | Paper 값 | 실제 출처 보드 | 대장(행) 정본값 |
|---|---|---|---|---|---|---|
| 1 | `46FL-0` | CC-04/R02 호가·체결 | `46FU-0` (그룹 `Rank 3`=`46FP-0`) | `총잔량` | `2U5L-1` 외 | `13BC-2` rank3 `매도호가9` = **150,930** |
| 2 | `46H8-0` | A05 외국인 매매 상위 | `46HD-0` (`Fact 5`=`46HC-0`) | `5일` | `30C1-0` 외 | `1WOB-1` 5번째 `매수호가` = **150,800** |
| 3 | `4753-0` | CC-06/R04-T1 업종 | `475J-0` (`Rank 2`=`475E-0`) | `상승` | `32XM-0` | `2TZN-1` rank2 `현재가` = **3,184.52** |
| 4 | `4762-0` | CC-06/R04-T2 관심 | `476P-0` (`Rank 1`=`476K-0`, 값셀 `476M-0`=`035420`) | `종목코드` | `135M-2` 외 7 | `2U5L-1` rank1 `종목코드` = **005930** |
| 5 | `4762-0` | 〃 | `476B-0` (`Rank 3`=`4766-0`, 값셀 `4768-0`=`+1,800 (+0.85%)`) | `전일대비` | `137X-2` 외 9 | `2U5L-1` rank3 `전일대비` = **+1,850 · +1.24%** |
| 6 | `478Z-0` | CC-06/R04-T5 조건검색 | `4798-0` (`Rank 3`=`4793-0`, 값셀 `4795-0`=`005930`) | `종목코드` | `135M-2` 외 7 | `2UN6-1` rank3 `조건검색식 일련번호` = **조건 02** |
| 7 | `47EI-0` | CC-06/R04-S2 종목찾기 | `47F5-0` (`Rank 1`=`47F0-0`, 값셀 `47F2-0`=`회전율 1.52%`) | `거래회전율` | `137X-2` 외 | `2X5N-0` rank1 `종목코드` = **005930** |
| 8 | `47EI-0` | 〃 | `47EY-0` (`Rank 2`=`47ET-0`, 값셀 `47EV-0`=`7,420억`) | `거래금액` | `3LGC-0` | `2X5N-0` rank2 `현재가` = **150,850** |
| 9 | `47EI-0` | 〃 | `47ER-0` (`Rank 3`=`47EM-0`, 값셀 `47EO-0`=`035420`) | `종목코드` | `135M-2` 외 7 | `2X5N-0` rank3 `전일대비` = **+1,850** |
| 10 | `485W-0` | CC-03/R01-T7 차트 업종지수 | `4861-0` (`Chart range`=`4860-0`, 라벨 `4862-0`=`시작`) | `현재` | `2UHM-1` | `32S7-0` 2번째 `전일대비` = **+87.96 · +2.84%** |

주의: (a) 4~9번은 **필드 이름이 값 셀에 들어간 것**이라 라벨 노드 하나만 고치면 그 행의 `missing_in_paper`가 남는다 — 같은 행의 값셀(표의 「값셀」 id)도 대장 값으로 함께 고친다. (b) 10번의 `Chart range`는 축 라벨 그룹이고 값은 `Price hero`의 `4869-0`(`+87.96 (+2.84%)`)에 있다 — 이 건은 표기 통일(`·` 구분)로 접근한다. 편집은 `set_text_content` 배치 한 번으로 끝나고, 바꾼 노드 id·이전/이후 값을 커밋 본문에 남긴다.

**그 뒤의 순서(설계서 §5.2·`backend/ref/kiumi/README.md:45-49`).**
1. 원장 `H-1` 10장 재추출 → `npm run verify:paper-mini`로 `paper_cross_board 0` 확인.
2. `unbacked`(49행)·`annotation_drift`(94/96)의 정본 방향이 설계서에 **없다**. 편집 전에 `plans/plan-paper-gates.md` §5.2 표에 두 부류의 방향을 적어야 한다(사용자 확인). 권장: unbacked는 Paper 결함으로 보고(값이 어느 보드 슬롯에도 없으므로 Paper를 고친다), annotation_drift는 대장 `annotation`을 정본으로 note 보드를 고친다(note는 대장을 설명하는 주석이다).
3. `ledger_stale` 136행: 대장 `backend/ref/kiumi/kiumi-ledger.jsonl`의 element를 Paper가 고른 슬롯(`source_slot_id`)으로 고친다(README: 대장 레코드 → 마크업 생성기 → `--check` 순서를 지킨다; `python scripts/build_kiumi_registry.py --write`가 대장을 96개 `slots.json.kiumi`에 투사). `verify:kiumi-cards`·`probe-orb-kiumi-96.js`가 앱 회귀를 잰다.
4. 전부 초록이고 스크립트가 원장 I/O만이면(`time`으로 60초 총계 확인) `verify:paper-mini-static`을 `scripts/hooks/pre-push`에 승격(§6.3).

### 7.4 `2GZM-2` — 보드 19 정본 (결정됨) → 재분류

- 근거(4차 실측): `2GZM-2`(높이 0의 명세형 보드, 「프리셋」 열 `2H0D-2` + 「상태」 열 `2H0E-2`, 셸 창 프레임 없음)의 머리 `2H3F-2` 「무엇으로 시작할까요 — 프리셋 10종」을, 같은 순간을 그린 `40EV-1`(19)이 `40EY-1` 「프리셋이라는 구분은 없습니다. 목록은 하나뿐이고…」로 이름을 대어 부정한다. 매니페스트도 `3X7M-1`·`3XE7-1`을 「보드 19~22 현행」으로 retired 처리했다.
- 이미 앱에 있는 것(4차, `f1da2c6`·`bdb40b6`): 오류 화면의 「실패」/「비활성」 배지, 503 문구 「백테스트 기능이 꺼져 있습니다 — 설정에서 백테스트를 켜야 합니다」(내부 변수 이름 노출 제거), 비활성 상태의 [다시 시도]·[설계로 돌아가기].
- 할 일: `backend/ref/paper-ledger/manifest.json`에서 `2GZM-2` role `screen` → `reference`, `why`: 「사용자 결정 2026-09-07: 보드 19(40EV-1)가 정본 — 40EY-1 「프리셋이라는 구분은 없습니다」가 이 보드의 프리셋 고르기를 부정한다. 오류 상태 절반(실패·비활성 배지)은 앱에 구현됨(f1da2c6·bdb40b6), 그 계약은 verify:backtest F10·backtest-canvas.test.js가 잰다」. 선례: `fc836aa`(8장 재분류). `paper-manifest-check` → `verify:paper-screens -- --bless`(target 109 → 108, passing 103 유지) → `app/probe-paper-screens.js:5`·`app/lib/paper-screen-routes.js:5` 머리 주석의 모집단 수 갱신 → 커밋 → 푸시. `report/gaps-screens-annotated.json`의 `2GZM-2`에 `round5`를 적는다.

### 7.5 `2I7Z-2` · `3KM-0` — 「원문과 정본을 직접 보여줘」 (사용자 결정 대기)

사용자는 Paper 원문과 지금의 제품 결정을 나란히 보고 정하겠다고 했다. 아래 자료로 대조 페이지(또는 캡처 두 쌍)를 만들어 보여 주고, 「Paper대로 되돌린다 / 결정 유지(보드를 reference로 재분류하고 why에 결정 날짜)」를 묻는다.

**A. `2I7Z-2` 「08 · 키우미 — 입력 스트립 모드별 얼굴」 (Paper `C-2`)**
- Paper가 그린 것(원장 `backend/ref/paper-ledger/C-2/2I7Z-2.json`): 「얼굴이 지금 어느 모드인지 말한다」(:11) · 「입력창 안 왼쪽의 키우미는 22px이다. 오브와 같은 규칙으로 눈 모양 하나만 바꿔 현재 모드를 표시하고, 클릭은 어느 모드에서나 빠른 실행 메뉴다 — 모드 전환은 사이드바가 한다.」(:19) · 「기본 얼굴로 떨어지면 거짓말이다」(:318) · 「다섯 모드가 각자 얼굴을 가진다. CSS가 없어 에이전트·플러그인·백테스트가 대화 얼굴로 떨어지면 화면은 “지금 대화 중”이라고 말하는 셈이다.」(:328). 다섯 얼굴(`.tree.txt:8~44`): 대화 = 세로 막대 둘(4.6초 깜빡임) · 그래프 = 별자리(점 셋 3.8초 주기) · 에이전트 = 눈 위 감시 궤도 점 셋 · 플러그인 = 소켓(구멍 둘 + 접지 막대) · 백테스트 = 되감기 화살표 둘. 22px 원, 2px 핑크 테두리, 바이저색 도형(:170).
- 지금의 결정(2026-09-01, 사용자): `app/shell.html:388-389` 「키우미 얼굴 하나 — 모드별로 얼굴을 갈아끼우지 않는다(2026-09-01 사용자 결정)…」 · `app/verify-kiumi.js:129-131` 단언 「보드 08: 다섯 모드가 같은 키우미 얼굴 하나를 쓴다 — 모드별 얼굴은 없다」 · `app/chat.css:908-910` · `app/lib/kiumi-face.test.js:24` · `PAPER_APP_PARITY.md:682`. 앱은 `#dot` 안 `svg.kiumi-face`(rect 2개, 22×22 원, `kiumi-blink 4.6s`)를 `data-mode` 다섯 값 모두에서 같은 모양으로 그린다(`app/shell.html:379-395`, `app/chat.css:892-924`).
- 캡처: Paper는 `get_screenshot(nodeId="2I7Z-2")`(다섯 얼굴 판). 앱은 `npm run verify:kiumi` → `app/captures/kiumi-01-menu.png`(입력 스트립 + 메뉴, 다섯 모드 순회 실측 포함).
- Paper대로 가기로 하면: 다섯 얼굴 SVG를 `#dot`에 `data-mode`별로(위 CSS/테스트/단언·`PAPER_APP_PARITY.md`를 새 계약으로 갱신), `verify:kiumi` 단언을 「다섯 모드가 각자 다른 얼굴」로 뒤집는다. 라우트는 그래도 못 적는다(이 보드의 나머지 텍스트는 전부 주석·placeholder라 문구 하한 3을 못 채운다) — role을 `reference`로 두고 why에 「계약은 verify:kiumi가 잰다」.

**B. `3KM-0` 「10 · 셸 — 답변 중 · Task Canvas」 (Paper `1-0`)**
- Paper가 그린 빈 캔버스·빈 채팅(원장 `1-0/3KM-0.json`): 「아직 답변 카드가 없습니다」(:188) · 「그동안 나눈 대화와 체결로 성향은 계속 쌓이고 있습니다.\n무엇이 쌓였는지 지금 볼 수 있습니다.」(:199) · 수치 행 「엔티티 312」·「테마 군집 7」·「최근 7일 +14」 · CTA 「성향 그래프 열기」(:265) · 힌트 「확인이 필요한 것 3건이 기다리고 있습니다」(:276) · 채팅 빈 상태 「새 대화」·「종목·재무·공시를 물어보면\n답이 캔버스에 카드로 쌓입니다」.
- 지금의 결정: ① 빈 캔버스 제목은 **시간대·성향 회전 문구**(보드 46 v3, 2026-08-27 검토 결정 — `app/lib/empty-canvas.js:28-38,51-54`: 기본 「무엇이든 물어보세요 / 질문하면 답변 카드가 이 자리에 쌓입니다.」, 6~9시 「장 시작 전, 궁금한 것부터」, 9~16시 「지금 시장이 움직이고 있습니다」, 16~20시 「오늘 장, 정리해볼까요?」, 20~6시 「장은 닫혔지만 준비는 지금」, 성향 「${profileTop} 쪽, 요즘 자주 보시죠?」; 45초 회전 `app/canvas.js:414-417`). ② CTA 「성향 그래프 열기」 삭제(`app/canvas.js:430-431` 「진입로는 사이드바 모드 네비가 이미 상시 제공」). ③ 수치·힌트는 그래프 모드의 성향 축적 히어로로 이사(`app/lib/graph-mode/summary-table.js:344-363 renderGrowthHero`, 값은 실측 있을 때만). ④ 채팅 빈 상태는 `#history:empty::before/::after`(`app/chat.css:406-425`)로 Paper 문구 그대로 — 단, 의사요소라 게이트의 가시 텍스트가 아니다.
- 캡처: Paper는 `get_screenshot(nodeId="3KM-0")`. 앱은 `npm run verify` → `app/captures/02-chat-only-idle.png`(부팅 직후 카드 0·채팅 0).
- Paper대로 가기로 하면: `empty-canvas.js` 풀을 「아직 답변 카드가 없습니다」 고정으로, CTA·수치·힌트를 빈 캔버스에 복원(수치는 브레인 실측이 있을 때만 — 없는 값을 0으로 지어내지 않는다), 채팅 빈 상태를 실제 텍스트 노드로(그래야 라우트 phrases가 잡힌다). `verify.js` emptyHistory 단언(`:1249-1252`)·`empty-canvas.test.js`·`paper-screen-routes.js:3512` 주석 갱신. 그 뒤 라우트 저작 → bless.

### 7.6 `3W9B-1` 「39 · 동시 실행 — 상태 4종 · 스피너」 — 사용자가 요청한 상세 설명

**(i) Paper가 그린 것**(원장 `1-0/3W9B-1.json`, `.tree.txt`). 헤더 「동시 실행 — 스피너의 의미」·「백테스트가 도는 동안 다른 창에서 대화합니다. 스피너는 지금 돌고 있다는 뜻입니다.」. 사이드바 머리 알약 「실행 중 3 · 대기 1」과 세션 행 여섯(스피너 셋: 추세추종 v3 · 변동성 돌파 · 아침 브리핑 감시 / 점 셋: 반도체 수급 · 성향 지도 · 야간 스캔). 관제판 「지금 도는 것 · 동시 3개까지」 — 실행 카드 셋(백테스트 「신호 계산 중 82% · 12:41 경과 · 백그라운드」, 백테스트 「봉 데이터 적재 중 41%」, 에이전트 「조건이 맞을 때까지 · 감시 중 · 03:02:11 경과」)과 대기 카드 「대기 1 — 반도체 수급 점검 / 앞의 실행이 끝나면 시작합니다」. 「같은 순간, 두 창」 — 왼쪽 창은 「추세추종 v3 · 계산 중 · 창을 떠나 있음」, 오른쪽 창은 「반도체 수급 점검 · 지금 보는 창」에서 대화 중. 범례 「표시 하나로 읽는 네 가지 상태」: 실행 중(「창을 닫아도 계속됩니다」) · 대기(「자리가 나면 시작합니다. 순서는 요청한 차례입니다.」) · 완료(「열면 그대로 복원됩니다」) · 실패(「이유가 세션에 남습니다. 같은 자리에서 다시 돌릴 수 있습니다.」). 규칙 셋: 창을 닫아도 실행은 계속(「실행은 창이 아니라 창과 분리된 데몬이 소유합니다 — Orca가 PTY를 데몬에 두고 창은 다시 붙기만 하는 것과 같습니다」) · 기다리는 동안 다른 창에서 대화 · 한도를 넘으면 대기열(「새치기는 없습니다」). 보드 자신의 Gap Note(json:859,869): 「지금은 상주 채팅 세션이 프로세스 전역에 하나뿐입니다. 실행 중인 질의 핸들도 하나만 유지하고, 새 턴이 오면 기존 턴을 인터럽트합니다. 스피너 셋이 동시에 도는 이 화면은 그 구조 위에 없습니다.」 「동시 실행·대기열·완료 알림은 모두 새로 만들어야 하는 것입니다. 상태 점 네 가지는 그 뒤에 붙는 표시입니다.」

**(ii) 앱의 현재 구조와 그것을 잠근 게이트.** 상주 채팅 세션은 프로세스 전역 싱글턴(`app/main.js:2376 liveChatSession`), 실행 핸들도 하나(`:2843 activeLiveQuery`, 「정확히 하나만 유지한다」), **새 질의가 기존 질의를 죽인다**(`:4030-4033`, `app/lib/main/claude-chat-session.js:230-236` 「새 질의가 이전 질의를 대체했다」). 두 번째 창(오브)은 별도 세션이 아니라 같은 실행의 뷰이고, 진행 중이면 제출 자체가 거절된다(`app/main.js:4456` 「셸 질의 진행 중」, `app/lib/live-query-lock.js:14-28`). 즉 Gap Note가 코드와 정확히 일치한다. **표시층은 이미 있다**: 사이드바 점 4종과 알약(`app/lib/sidebar.js:1018 RUN_STATE_LABELS {running:'실행 중', waiting:'대기', done:'완료', failed:'실패'}`, `:295-301`, `:1020-1046`; `app/styles/sidebar-session.css:38-85`), 상태 저장소 `session_jobs`(`app/lib/main/session-store.js:545 runStates()`, `queued|waiting|pending → waiting` 매핑 `:112-123`). 다만 `waiting`을 쓰는 생산자가 없다(`app/lib/main/session-bridge.js:68`은 `running`만). 창 모델 게이트 `scripts/gates/check-window-model.mjs`는 `getWins()`를 `[bootWin, shellWin, orbWin]`으로 고정하고(`:107-119`) `new BrowserWindow(commonWinOpts(`가 정확히 한 번이어야 한다(`:124-127` 「셸 창 1개여야 한다」). 새 IPC 채널은 `preload.js` 허용 집합에 등록해야 `check-harness-freshness`를 통과한다.

**(iii) 구현하려면 바꿔야 할 층.** ① 세션 다중화 — `liveChatSession`·`activeLiveQuery`를 세션ID → 객체 맵으로, 선점 로직 제거(`app/main.js:2376,2843,4030`, `claude-chat-session.js:230`). ② 대기열·한도 — 동시 3 + FIFO(`backend/athena_api/watch/runner.py:87`의 `BoundedSemaphore` 패턴 재사용). ③ 상태 기록 — `session-bridge.js:68`에서 `queued`를 쓰기 시작하면 「대기」 점이 바로 산다. ④ 잠금 — `liveQueryBusyDepth` 전역 게이트를 세션별로(`app/main.js:2834,4456`, `live-query-lock.js:17`). ⑤ 완료 알림 채널 신설 + `preload.js` 등록. ⑥ 창 모델 — 「두 창」을 문자 그대로 하면 `check-window-model.mjs:107-127`이 즉시 실패하므로 게이트·`docs/architecture` 창 모델 문서 재정의가 전제. ⑦ 저장소 동시성 — `session_jobs` 동시 쓰기, `reconcileSessionJobs`(`app/main.js:2921-2939`) 재작성. 크기 L.

**(iv) 위험.** 실주문 idempotency 락이 프로세스 하나 기준(`backend/athena_api/main.py:30`) — 세션 셋이 주문 경로를 타면 경합. 키움 WebSocket은 연결 하나에 `_control_lock` 직렬화(`kiwoom/ws_client.py:70,102-107`)라 동시 실행이 서로 기다린다. 레이트 리미터도 전역(`kiwoom/rate_limiter.py:30`). `process_lock.py`가 자격증명·brain DB를 단일 소유자로 못박아 「창과 분리된 데몬」 설계와 충돌. 백테스트는 캐시 부족 시 409로 거절(`api/backtest.py:384`)이라 큐에 든 작업이 뒤늦게 실패할 수 있다.

**(v) 사용자에게 제시할 선택지.**
1. **구현한다(L).** 위 ①~⑦ 전부 + 창 모델 게이트 재정의. 가장 큰 변경.
2. **세션 다중화만, 두 창은 안 하기.** 채팅 세션 N개 + 대기열, 화면은 셸 하나 유지 → 창 모델 게이트 무수정. Paper의 「같은 순간, 두 창」 구역은 reference로.
3. **채팅은 하나 유지, 긴 작업만 동시.** 백테스트·감시 job은 이미 백그라운드로 돌고 폴링·재접속 인프라가 있다(`app/lib/main/backtest-bridge.js:68,87`, `routine-feed.js:1`, `app/main.js:2921`). 그 상태를 사이드바 점·알약에 연결하면 창 모델을 건드리지 않고 보드의 절반(관제판·대기·범례)이 실현된다. 위험이 가장 낮다.
4. **보류 — gap 유지** 또는 **reference로 재분류**(보드 자신의 Gap Note를 근거로).

---

## 8. 함정·교훈 (겪은 것만)

- **Paper MCP 연결 실패.** 세션 시작 때 자주 「Skipping connection (recent failure cached, retries in 15 min)」. 원장으로 작업하고 뒤에 재시도. 서브에이전트 여럿이 동시에 Paper를 열면 페이지 전환이 충돌한다 — `open_file` 금지.
- **폰트.** 이 머신엔 Daki가 없어 `--font-body`가 Noto Sans KR(가변 폰트 1개)로 떨어진다. 한글 폴백 자폭이 9% 넓은 Malgun Gothic이 앞서면 가로 게이트가 깨지고(`f860bb0`), Noto의 줄상자(150%em)는 Paper 줄 높이 125%를 넘어 fit-content 보드가 2px 넘친다 → `app/styles/tokens.css`의 별칭 `Noto Sans KR Athena`(ascent 100%·descent 25%·line-gap 0%)로 해결(`e7bbd3e`). Daki가 있는 머신에서는 아무것도 안 바뀐다. 검토자 메모: 슬랙 0(정확히 125%)이라 앞으로 line-height/font-size 비 1.09 같은 조합이 fit-content에 오면 다시 넘칠 수 있다.
- **Paper fit-content 상자**는 높이 0으로 붕괴할 수 있다(검은 스크린샷). 픽셀 높이 + 내부 간격으로 푼다. 빈 스크린샷은 렌더러 오류가 아니라 마운트 안 된 아트보드다.
- **워크트리 정션.** 자동 워크트리엔 `node_modules`·`.venv`가 없다 — 주 체크아웃으로 정션을 만든다. 남의 워크트리 테스트를 내 venv로 돌리면 거짓 실패.
- **Electron 프로브는 `--disable-gpu`.** warmup 타임아웃은 환경 문제.
- **래칫 충돌.** 두 트랙이 동시에 bless하면 `paper-screens-ratchet.json`이 충돌한다 → §3.1 규칙. `--bless`가 `blessed_at` 한 줄만 바꾸면 커밋하지 않는다(빈 커밋 소음).
- **의미적 병합 충돌.** 한 트랙이 빈 캔버스 히어로를 옮기고(`ec8c701`) 다른 트랙의 테스트가 옛 CSS 줄을 단언해 push가 막힌 적이 있다 → 테스트를 새 구조에 맞춰 풀었다(`ce495c3`). 푸시 전 단위 전체를 반드시 돈다.
- **플래키.** 단위 스위트에서 1회 실패 후 재실행 통과가 두 번 있었다(이름 미확인, 3276개 시점). 재현되면 이름을 잡아 고친다.
- **`verify:backtest` 전제.** `GET /ready` 200(키움 데이터 세션) 없이는 00A에서 조기 종료한다. 4차의 F10 단언(실패 배지·[설계로 돌아가기])은 단위 검사(`backtest-canvas.test.js:5628~`)로만 고정돼 있다 — 백엔드가 붙는 환경에서 한 번 돌려 확인.
- **Bash 도구.** JSON 인수용 heredoc이 「unexpected EOF while looking for matching `''」로 깨질 때가 있다 → 파일로 쓰고 읽힌다. `sleep`은 차단된다.
- **검토자가 뒤집은 판정 2건.** 「보드 03·04와 충돌」(2QCN-2)은 원장 재대조로 틀린 것으로 판명 → 구현됨. 반대로 「보드 19와 다른 순간일 수 있다」(2GZM-2)는 원장이 명시적으로 부정 → gap 확정. **원장 texts를 직접 읽고 판단한다.**

**검토자가 남긴 사소한 후속(고치지 않았음):** 낡은 라우트 주석(`4330-1`, `3Z8U-1` 묶음) · `CONTROL_RESULT_KINDS.view` 죽은 갈래 · `3XL4-1` 만드는 중 헤더 탭·`_SOURCE_KIND_KO`의 `"web"` 키(실제 값은 `"html"`) · `live-map.js __exports.PALETTE` 미사용 · `map-legend.js LINE_ITEMS` 마지막 줄이 보드 03 기준(04는 「숨은 연관」까지) · `backtest-error-back` 클래스를 두 버튼이 공유 · `2QER-2` 캡션 「채움은 성향 신호 표와 같은 확정성 인코딩」을 앱이 안 그림 · 커밋 본문 길이 관례(2~5줄) 초과 1건.

---

## 9. 워크플로를 그대로 다시 돌리는 법

이 트랙은 Claude Code의 `Workflow` 도구로 「묶음 → 구현자 → 검토자(≤3회) → 푸시」를 자동화했다. 지원 묶음 `workflows/*.js`가 그 스크립트이고 `tasks/*.json`이 입력이다(경로는 이 폴더로 다시 가리켜 두었다).

```text
Workflow({ scriptPath: "C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity/workflows/athena-paper-implement.js",
           args: <tasks/tasks-paper-implement-c.json 의 배열을 JSON 값으로> })
```

- `athena-paper-implement.js`: 묶음 `kind` ∈ `feature`(앱에 없는 화면·기능을 실제로 구현) · `cards`(카드 게이트) · `reclass`(매니페스트 role) · `contract`(계약 문서화) · `followup`. `WT` 상수가 작업 워크트리(`DAOU.Athena-parity`)다 — 다른 워크트리를 쓰면 바꾼다. `COMMON` 블록이 규칙 전문이라 새 묶음을 만들 때 그대로 두면 된다.
- 묶음 JSON 형식: `{key, kind, title, boards:[{id,name}], spec, files, gates}`. `spec`에는 Paper가 그린 것·앱 현황·할 일·라우트 방침·게이트를 구체적으로 적는다(3차·4차 파일이 본보기).
- 새 묶음 후보는 게이트 리포트에서 `node scripts/paper-gate-tasks.mjs`로 뽑는다.
- 사람이 직접 할 때도 같은 3단(구현 → 다른 사람의 검토 → 푸시)을 지킨다. 검토는 「reach를 빼도 통과하는가(공허 통과)」·「라우트가 Paper를 비켜 갔는가」·「스텁·가짜 값·검사 통로의 제품 노출」·「gap 판정이 타당한가」·「래칫이 줄지 않았는가」 다섯 가지를 실측 재현으로 본다.
- Workflow 도구가 없으면 `spec`을 그대로 프롬프트로 써서 세션 셋을 순서대로 돌려도 같다.

---

## 10. 지원 묶음 색인 (`docs/handoff/2026-09-07-paper-parity/`)

| 경로 | 내용 |
|---|---|
| `workflows/athena-paper-ledger-export.js` | Paper 444보드 → 원장 JSON 추출 워크플로(파서 규칙 포함) |
| `workflows/athena-paper-gates.js` + `tasks/tasks-paper-gates.json` | 게이트 3종·매니페스트·변환기를 만든 8작업 |
| `workflows/athena-parity-fixes.js` + `tasks/tasks-parity-fixes.json` | 수정 트랙 22작업 |
| `workflows/athena-paper-screens-impl.js` + `tasks/tasks-paper-screens-batches.json` | 화면 라우트 저작 20묶음 |
| `workflows/athena-paper-screens-reauthor.js` | 늦게 올라온 표면 4장 재저작 |
| `workflows/athena-paper-cards-fix.js` + `tasks/tasks-paper-cards-batches.json` | 카드 게이트 5묶음 |
| `workflows/athena-paper-implement.js` + `tasks/tasks-paper-implement-{a,b,c}.json` | 구현 3차·4차(13묶음) — **다음 회차도 이 스크립트로** |
| `workflows/athena-code-review.js` · `athena-paper-parity-audit.js` · `athena-card-template-drift.js` | 1판 판정에 쓴 검수·감사 |
| `tasks/tasks-followup.json` | 후속 2건(Grok UI 뒷정리 · 오브 눈 프로브) — 완료 |
| `plans/plan-paper-gates.md` | 전수 게이트 3종 설계서(§4 라우트 규칙 · §5.2 정본 규칙 · §6.3 pre-push 승격) |
| `plans/plan-card-parity.md` · `plan-screen-p1.md` | 수정 트랙 설계(카드 B-2 initial_state_board, 화면 20항목 5군) |
| `report/build_report.py` + `gaps-screens-annotated.json` + `gaps-cards.json` + `round3-boards.json` + `round4-boards.json` | 판정 보고서 생성기와 보드별 실측 기록(구현자 detail 원문) |
| `report/athena-paper-parity-verdict.html` | 최종 판정 4판 |
| `report/build_ledger_manifest.py` | 원장 → 매니페스트 초기 생성기 |
| `gate-logs/final-gates-{ac8452f,bdb40b6}.log` | 3차·4차 종료 시점 전수 게이트 로그 |

관련 저장소 문서: `docs/architecture/paper-contracts.md`(계약 14장) · `docs/ui/paper-card-surface-charter.md`(카드 표면 헌장, 2026-09-02 승인) · `docs/handoff/2026-09-03-card-surface-paper-to-code.md`(카드 파이프라인 인계) · `docs/handoff/2026-09-03-kiumi-mini-cards-*.md`(카드미니) · `backend/ref/kiumi/README.md`(대장) · `PAPER_APP_PARITY.md`.

---

## 11. 갱신 이력

- 2026-09-07 11:10 KST — 최초 작성. main `bdb40b6`. 남은 7장, 사용자 답변 4건 반영, Paper 편집 승인 범위 명시. 지원 묶음 동봉.
