# 인계 — 카드 표면 Paper→코드 (2026-09-03)

> **이 문서의 용도.** 원본 대화가 끊기면(사용량 소진·PC 교체·계정 교체) 다른 대화가 이 문서만으로 같은 자리에서 이어받는다.
> 바로 붙여 넣을 블록은 [CARD_SURFACE_PROMPT.md](./CARD_SURFACE_PROMPT.md). 이 문서는 마일스톤마다 갱신되고 브랜치 `feat/card-surface-paper-to-code`에 계속 커밋·푸시된다 — §11 "갱신 이력"의 마지막 줄이 이 문서가 아는 가장 최근 상태다.
> **모든 명령은 Git Bash 문법이다.** PowerShell에 그대로 붙이면 첫 줄부터 깨진다.

---

## 0. 30초 요약

- **하는 일.** Paper 디자인 파일의 카드 페이지 보드 96장을 **그대로**(픽셀 동일) Electron 앱의 대화 캔버스에 띄운다. 캔버스는 브라우저처럼 **탭 스트립 + 카드 1장 뷰포트**, 카드는 컨테이너 폭 5단(XL/L/M/S/XS) 반응형, 값·문구는 어느 단계에서도 불변.
- **어디까지 왔나.** Paper 쪽은 끝났다(키움 REST 299 op · 가시 필드 3,532 전부 표현). 코드 쪽은 추출 96/96 · 백엔드 로더가 96장 전부 로드(제외 0) · 봉투 `surface_contract` · 프론트 탭/마운트/반응형 CSS · 보드 카드의 통합 카드 크롬 제거까지 붙었다. 슬롯 저작(보드 텍스트 자리 ↔ API 필드)은 로더 기준 **3,379/3,534 occurrence = 95.6%**.
- **정확한 중단점.** 웨이브 3 정비 4레인(A5/B4/C5/D3)은 끝났다. 재개한 3차 저작의 `account-a`는 리뷰·수정까지 끝나 정확한 9 occurrence를 닫았고, `3GRO-0`에는 6구간 주문가능금액 잎이 없어 12 occurrence·2 op를 정직하게 미도달로 남겼다. 다음은 `account-b`이며 최종 게이트는 아직 미실행이다(§5·§6).
- **커밋.** 2026-09-03부터 브랜치 `feat/card-surface-paper-to-code`에 지속 커밋·푸시한다(사용자 지시). `main`은 origin보다 60커밋 뒤라 직접 올리지 않는다.

---

## 1. 저장소 상태

| 항목 | 값 (2026-09-03 11:15) |
|---|---|
| 브랜치 | 작업 브랜치 `feat/card-surface-paper-to-code`(origin 추적). **같은 체크아웃을 키우미 트랙 대화가 함께 쓴다** — `git status --short --branch`로 현재 브랜치를 매번 확인. 이 문서가 들어 있는 커밋을 최신 카드 트랙 체크포인트로 삼는다. 로컬 `main`은 `origin/main`보다 **60커밋 뒤**. 병합은 나중에 `-X ignore-cr-at-eol`로 |
| 미커밋 세는 법 | `git status --short \| grep -c '^ M'` / `grep -c '^??'` — 접힌 디렉터리 기준. 웨이브가 돌면 계속 변하므로 숫자는 §11에만 남긴다 |
| 워크트리 | 카드 트랙은 메인 체크아웃에서만. 에이전트/플러그인 트랙은 별도 워크트리라 섞이지 않는다 |
| 테스트 기준 | **실패 0**이 기준이다(개수는 웨이브가 테스트를 늘려 계속 증가). 참고 측정치는 §7 표 |
| 알려진 RED | `backend/tests/api/test_task_canvas_envelope.py` 1건 — `_view_instance_id`에 `operation_ref`가 없는 **기존 WIP**. 이 트랙과 무관, 고치지 말 것 |
| pre-push 훅 | `git config core.hooksPath`=`scripts/hooks`. push마다 게이트 4종 + app 단위 전체를 돈다. **붉은 테스트가 있으면 push가 막힌다** — `--no-verify`로 우회하지 말고 초록을 만든 뒤 push |

---

## 2. 사용자가 확정한 것 (다시 묻지 말 것)

1. **"카드는 오직 paper design에 있는 카드만 써야하며, 디자인은 완전 동일해야해."** 범용 렌더러·새 프리미티브·"비슷하게 재구성" 전부 금지. 앱은 Paper `get_jsx` 추출물을 그대로 그린다.
2. **캔버스 = 탭 브라우저.** 카드 1장만 뷰포트에, 여러 카드는 탭. 모든 카드 크기 동일(뷰포트 100%). 창을 2분할·4분할·원본·최소로 바꿔도 반응형. 축소(zoom) 금지.
3. **집약 불인정.** 필드는 직접·병기·펼침 3층 중 하나로 **값이 보여야** 표현이다. 비노출은 명문 계정 173뿐 = 전송·내부 171(`backend/ref/kiwoom-presentation-hidden-occurrences.json`) + 예비 슬롯 2(`base:04` 951·924, 헌장 §6). 로더의 가시 모수 3,534는 원장 3,534행 그대로라 이 예비 슬롯 2건이 아직 "미도달"로 세어진다 → §6-2.
4. **밀도 규칙 H1~H4 승인**(영값 묶음 "0원 N항목 ▸", 값 우선, 병기 2값, 행 리듬 13/32px) — "응 진행해봐".
5. **검수 방식.** 마일스톤마다 전 보드 스크린샷/PDF를 보내 사용자 검수. 문구 3원칙: 설명문 금지·한국어 단위·내부용어 금지.
6. **운영 방식(2026-09-03).** 인계 문서를 항상 최신으로 유지하고, 커밋·푸시를 지속하고, 남은 일을 순차 진행한다.

**사용자 결정 대기(보류, 임의로 정하지 말 것):** 호가단위 100원 전환 · 마이너스 기호 표준 · Paper 화면 페이지 그리드 규약 · 화면 페이지 기록 보드 "55 · 캔버스 탭 스트립"(3ZPB-0) 승인.

---

## 3. 지도 — 정본 문서·원장·코드

| 무엇 | 경로 | 비고 |
|---|---|---|
| **헌장(디자인 표준)** | `docs/ui/paper-card-surface-charter.md` | 15 신념·표현 3층·밀도 예산·문법 A~G·H1~H4·비노출 계정 |
| 구현 계획 | `docs/architecture/card-surface-implementation-plan.md` | D1~D7 (D3 폭은 탭·반응형 계획으로 대체). §2 밀도 줄은 2026-09-03 로더 값으로 정정 |
| 탭·반응형 계획 | `docs/architecture/canvas-tabs-responsive-plan.md` | 5단 컨테이너 쿼리, 저장 형식, 파리티 P1~P5 |
| op 원장 (299) | `PAPER_CARD_COVERAGE.json` / `.md`, `scripts/paper_card_coverage.py` | 299/299 표현 |
| 필드 원장 (3,534행) | `PAPER_FIELD_COVERAGE.json` | 행마다 cls·layer·board·where. 3,532 표현 + 2 비노출 |
| 클레임 병합기 | `scripts/merge_field_claims.py` | 클레임 JSONL → 원장 |
| 현황판 | `scripts/surface_dashboard.py` → http://127.0.0.1:8765 | `.claude/launch.json` "surface-dashboard" |
| **Paper 원문 저장소** | `backend/ref/card-surface-templates/<board>/` | `meta.json`·`paper.jsx`·`paper.tree.txt`·`regions.json`(사람이 저장) → `board.html`·`slots.json`(생성). `index.json` 96장. 디렉터리는 97 = 96 + `fixture-quote`(테스트 픽스처, 색인 밖) |
| 저작 팩 | `backend/ref/card-surface-authoring/packs/<board>.pack.json` | 보드 몫 필드 목록(96장 전부). `.fields.json`은 선택(93장; `17F8-2.fields.json`은 증명 페이지 잔재 → §6-4). 2026-09-03 세션 임시 폴더에서 저장소로 옮김 |
| 추출기 | `scripts/paper_board_extract.py` | JSX→HTML, 영역 클래스 `bs-*`, 슬롯 골격, `--apply-columns`·`--no-index`·`--check` |
| 슬롯 검증기 | `scripts/validate_board_slots.py` | 보드별 a~g 검사. 팩 경로 기본값 = 위 packs, `ATHENA_PACK_DIR`/`--pack-dir`로 덮어씀. 팩 폴더가 없으면 즉시 실패 |
| 커버리지 판 | `scripts/card_surface_coverage.py` → `CARD_SURFACE_COVERAGE.md` | 바인딩 판정은 로더에 위임(스크립트가 세지 않는다) |
| 레지스트리 빌더 | `scripts/build_board_registry.py` → `app/lib/board-templates.index.generated.js` + `board-templates.CC-0n.generated.js` | 카드별 지연 로드 청크. **97장**(fixture-quote 포함)이 정상. 템플릿을 고치면 재빌드해야 한다 — `--check`가 드리프트를 잡는다(§7) |
| 백엔드 로더 | `backend/athena_api/card_surface_templates.py` | `get_registry()`(lru, 보드별 격리 → `registry.excluded_boards`, `registry.coverage()`) / `load_registry(strict=True)`(CI, 예외). 밀도 하드 = 표 열 ≤8 · 행 ≤22 · 높이 ≤1,120; 레일 블록·KPI는 소프트 |
| 백엔드 계약 | `backend/athena_api/card_surface_contract.py` | `build_surface_contract` → 봉투 `surface_contract{slot_values…}` (REST·MCP 공용) |
| 배선 | `backend/athena_api/api/canvas_push.py`(+`/api/v1/internal/canvas/board-hydrate`), `backend/athena_mcp/canvas_data.py` | |
| 프론트 | `app/lib/canvas-tabs.js`·`board-mount.js`·`board-format.js`·`board-template-registry.js`·`main/board-hydrate.js`, `app/styles/board-surface.css`·`canvas-tabs.css`, `app/canvas.js`(renderBoardSurfaceCard — 보드 카드는 통합 카드 크롬을 그리지 않는다) | |
| 검증 스크립트 | `app/verify-integrated-cards.js` → `app/captures/integrated-cards/` | 창 4종 1920·960·640·480 |
| 워크플로 스크립트 사본 | `docs/handoff/card-surface/workflows/*.js` | W1·W2a·W2b·W2c·W3. W3는 `PACK`을 저장소 상대 경로로 만들고 `NODE`는 PATH 존재만 검사한다. **다른 PC에서는 `ROOT`·`PY`를 고친다.** 레인 프롬프트는 당시 가정(API 이름 등)을 담고 있으니 그대로 주기 전에 현재 시그니처를 확인 |
| 진행 로그 사본 | `docs/handoff/card-surface/progress.txt`, `prd.json` | 정본은 `.omc/`(git 무시) |

---

## 4. 수치 (측정 2026-09-03 12:52, W3 account-a 리뷰·수정 반영 후)

| 항목 | 값 |
|---|---|
| 보드 | 96 (카드 6 · 증명 페이지 17F8-2와 fixture-quote는 모수 밖 — 해소 대상 아님) |
| 추출 | 96/96, `--check` 드리프트 0 |
| **로더** | `get_registry()` 보드 96 · `excluded_boards` 비어 있음 · `complete=False`는 부분 로드 경로라 정상 |
| **커버리지(정본 = 로더 `coverage()`)** | occurrence 도달 **3,388 / 3,534 (95.9%)** · op 커버 297/299 |
| 미도달 146의 구성 | 17F8-2에만 귀속된 75 + 트리 안 보드 귀속 71(그중 예비 슬롯 2). `account-a`가 정확한 9건을 닫음 |
| 보드 없는 op | 2 — `detail:kt00005:margin_order_capacity`, `detail:kt00013:margin_order_capacity`. `3GRO-0`에는 6구간 `…주` 잎만 있고 금액 잎이 없어 거짓 shares 매핑을 제거한 상태 |
| 슬롯 검증기 잔여 | 37건(b1 e36) / 21장 — `account-a`의 `3IGR-0` b1 e2를 닫음. 나머지는 후속 저작 레인 몫 |
| 밀도 | 하드 위반 0 · 소프트 경고 22(레일 행 7~11) · 재표시 경고 128 · 중복 바인딩 0 |
| 상태 컨트롤 미해소 | 2 (3EWN-0·3ODO-0 — 부모 보드에 후보 문구 없음) |
| C5 반응형 검증 | 실보드 6장 × 4단계 PNG **24장** + 보드별 XL 1,360px·M 851px 기하 프로브 **12회**, P5·단계 간 텍스트 상등 전부 통과, **surface overflow 최대 0px**. height hoist가 작동하는 L/M/S/XS의 세로 내용 넘침·형제 겹침 0; XL은 열 접힘·KPI 줄바꿈 없이 primary/rail 병렬, M은 6열부터 접고 KPI 최대 3칸·rail 하단 이동을 하드 판정한다. XL Paper 원문 `2R3M-1/36Q0-0`의 기존 2px 세로 넘침은 원시 결과에 기록하되 hoist 검증에서 제외한다. 리뷰 위험 표본 15P5-2·3DZ1-0(8 KPI)·2QX1-1(6 KPI)도 별도 6단계 검증 0px. `app/captures/integrated-cards/VERIFY-INTEGRATED-CARDS.json` |
| 앱 단위 테스트 | **2,042 pass / 0 fail** (`npm run test:unit`, 2026-09-03 12:17 재검증) |

---

## 5. 웨이브 3 — 완료와 중단 경계

원본 대화 task `we5uj8uzd`, run `wf_622eeae9-f84`. 3단계: **정비**(A5∥B4∥C5∥D3) → **3차 저작 8레인** → **게이트**.

**정비 4레인은 끝났다.** 레인별 완료 신호(다시 확인할 때 이걸 본다):

| 레인 | 완료 신호 |
|---|---|
| A5 추출기 밀도 계수 | `slots.json`의 `density.rail_blocks` 전역 최대 5, 호가(CC-04) 2~4 |
| B4 로더 격리 | `get_registry()` 96 · `excluded_boards` 노출 · `coverage()` 존재 |
| C5 보드 카드 크롬 제거 | `app/canvas.js` renderBoardSurfaceCard가 `.card-head`·요약 칩·"전체 원본 필드"를 만들지 않음. `app/captures/integrated-cards/board-<id>-<w>x<h>.png` **24장과 검증 JSON 존재**. 5단 컨테이너 전부 측정·surface overflow 0·L/M/S/XS 세로 넘침/겹침 0·XL/M 레이아웃 계약 하드 판정, 앱 단위 2,042/0 |
| D3 커버리지 정본화 | `CARD_SURFACE_COVERAGE.md` 머리글이 "로더에 위임"이고 총괄이 로더 수치와 같음 |

**3차 저작 8레인**(account-a/b, quote-flow, rank-a/b, watch-answer, orderbook, uncovered-sweep; 보드 소유 겹침 없음)은 각각 탐색 명령 12~19회를 실행했지만 약 100초 뒤 주간 한도 오류로 끝났고, 작업 트리에 저작 순변경을 남기지 않았다. **게이트는 tool call 0회로 즉시 오류 종료**했다. Claude 워크플로 JSON의 최상위 `status: completed`는 단계 상태를 대표하지 않으므로 믿지 말고 `workflowProgress`를 본다.

**Codex 재개:** `account-a`는 커밋 `6cbb2b7` 후 독립 리뷰에서 금액→shares 오매핑 12건과 의미가 다른 account 필드 2건을 발견했다. 수정 `c52a446`에서 오매핑을 제거하고 `repl_amt`·`uncla`를 `2SKU-1`의 정확한 슬롯으로 옮겼다. 결과는 안전한 순증가 9건, 담당 validator 3장 문제 0. 금액 잎이 없는 12건은 Paper 정본에 이름 있는 `krw_ko` 잎을 만들기 전에는 닫지 않는다.

**원본 증거:** `C:\Users\USER\.claude\projects\C--Projects-DAOU-Athena\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\workflows\wf_622eeae9-f84.json`. 같은 Claude 세션에서 한도가 초기화된 뒤 재개할 때만 `resumeFromRunId: "wf_622eeae9-f84"`를 쓸 수 있다. 재개 전 `workflowProgress`를 읽어 정비 4레인을 다시 돌리지 않는지 확인한다.

**다른 대화·다른 PC:** 캐시가 없다. §7 표의 읽기전용 명령으로 위 완료 신호와 §4 수치를 실측 → 저장된 W3 스크립트에서 **3차 저작 8레인과 게이트만** 실행하거나 해당 레인 프롬프트를 서브에이전트에 준다.

**게이트가 끝나면 사용자에게 보여줄 것:** 실보드 6장(2SKU-1·2R3M-1·13BC-2·2QFO-2·13K0-2·135M-2) 4단계 캡처를 Paper 스크린샷과 나란히 놓고 차이를 보고. Paper 대조는 로그인된 Paper Desktop을 computer-use로 보거나 Paper MCP를 쓴다(§8) — 둘 다 없으면 그 단계만 원본 계정 보유자에게 넘긴다.

---

## 6. 남은 일 (순서대로) — 🔒 = 사람·외부 의존

1. **3차 슬롯 저작 남은 7레인.** 현재 미도달 146 → 0: `account-b` → `quote-flow` → `rank-a` → `rank-b` → `watch-answer` → `orderbook` → `uncovered-sweep`. (a) 트리 안 보드 귀속 71은 슬롯 저작, (b) 17F8-2 귀속 75는 카드 보드로 재귀속 — 몸통은 금현물(kt50020·kt50030·kt50031·kt50032·kt50075), (c) 예비 슬롯 2(`base:04` 951·924)는 **로더의 가시 universe에서 원장(`PAPER_FIELD_COVERAGE.json`) 비노출 행을 빼는 방식**으로 모수를 3,532로 맞춘다 — `kiwoom-presentation-hidden-occurrences.json`은 `semantic_presentation_registry.py`가 해시·개수(171)로 잠근 신뢰 게이트 원장이라 건드리지 않는다. 별도 설계 결함: `3GRO-0` 6구간 주문가능금액 12건은 Paper 금액 잎 저작 없이는 닫지 않는다. 상태 컨트롤 2건 `meta.state.control_text`. 바인딩 슬롯 `row_index` 좌표. `17F8-2.fields.json` 잔재도 재귀속과 함께 정리.
2. **W3 게이트 실행** → 추출·`--check`, 로드 96·excluded 0, 커버리지 3,532/3,532, 검증기 0, 청크 재빌드·드리프트 0, 앱/백엔드 전수, 실보드 캡처 24장 재생성 + XL/M 기하 프로브 + surface overflow 0 + 반응형 세로 넘침/겹침 0 + XL/M 레이아웃 계약. 통과 후 문서 수치 갱신·커밋·푸시.
3. **실앱 QA.** 4단계 창 캡처 vs Paper 시각 대조 🔒(로그인된 Paper Desktop/computer-use 또는 Paper MCP) · 헌장 게이트(밀도 하드 0, 문구 3원칙) · 사용자 검수 PDF 🔒(승인) · 실키움(모의) 봉투로 보드 카드 실데이터 표시 1회 🔒(모의투자 자격증명·장중).
4. ~~구현 계획 문서의 밀도 줄 정정~~ — 2026-09-03 10:3x 완료.
5. 보류 결정 4건 🔒 — 사용자에게 한 번에 물어 닫는다.

승인 없이 진행 가능한 것: 1·2와 3의 헌장 게이트.

---

## 7. 검증 명령 (Git Bash · 저장소 루트)

```bash
eval "$(fnm env)"; export PYTHONIOENCODING=utf-8
```

`fnm`을 쓰지 않으면 Node/npm이 이미 PATH에 있는지만 확인한다. **백엔드 pytest도 node가 필요하다**(`backend/scripts/evaluate_selector_ablations.py`). 파이프(`| tail`)는 exit code를 가리니 판정은 마지막 줄과 `$?`로.

| 무엇 | 명령 | 쓰기? | 기준 |
|---|---|---|---|
| 추출 드리프트 | `backend/.venv/Scripts/python.exe scripts/paper_board_extract.py --check` | 읽기 | 보드 96줄 · `드리프트:` 줄 없음 · exit 0 |
| 추출 전수(재생성) | `backend/.venv/Scripts/python.exe scripts/paper_board_extract.py` | **쓰기**(board.html·slots.json·index.json) | 템플릿 원문을 고쳤을 때만 |
| 슬롯 검증 | `backend/.venv/Scripts/python.exe scripts/validate_board_slots.py [board…]` | 읽기 | `합계 문제 0` 목표(현재 40) |
| 게이트 읽기 | `cd backend && uv run python -c "from athena_api.card_surface_templates import get_registry; r=get_registry(); c=r.coverage(); print(len(r.boards), r.excluded_boards, {k:(v if not isinstance(v,list) else len(v)) for k,v in c.items()})" 2>/dev/null` | 읽기 | `96 [] {...}` — stderr의 소프트 예산 경고는 정상 |
| 커버리지 판 | `python scripts/card_surface_coverage.py` | **쓰기**(`CARD_SURFACE_COVERAGE.md`) | 총괄 = 게이트 읽기 수치 |
| 청크 드리프트 | `python scripts/build_board_registry.py --check` | 읽기 | `최신 — 보드 97장, 청크 6개` · exit 0. 붉으면 아래 빌드 |
| 레지스트리 빌드 | `python scripts/build_board_registry.py` | **쓰기**(청크 7파일) | `보드 97장` |
| scripts 테스트 | `backend/.venv/Scripts/python.exe -m pytest scripts/tests -q` | 읽기 | 실패 0 (10:1x 측정 235) |
| app 단위 | `cd app && npm run test:unit` | 읽기 | 실패 0 (12:17 측정 2,042) |
| backend 카드표면 | `cd backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q` | 읽기 | 실패 0 (10:1x 측정 154) |
| backend 전수 | `cd backend && uv run pytest tests -q` (≈25분) | 읽기 | 기존 WIP RED 1건 외 0 |
| 4단계 캡처 + 5단 기하 | `cd app && npm run verify:integrated-cards` | **쓰기**(`app/captures/integrated-cards/`) | `missing 0`, PNG 6×4 = 24장, `breakpoint_probes` 6×2(XL 1,360px·M 851px), P5·텍스트 상등 true, `max_overflow_x` 0, L/M/S/XS 세로 넘침/겹침 0, XL/M 배치 계약 통과(XL 원문 2px는 기록·제외) |

인터프리터: 추출·검증·scripts 테스트는 `backend/.venv/Scripts/python.exe`, 백엔드 코드는 `uv run`, 커버리지·빌더는 시스템 `python`(의존성 없음). Workflow 스크립트는 LF만(CRLF는 "control characters"로 거부), 템플릿 프롬프트 안 백틱 금지. `.omc/`는 git 무시.

---

## 8. Paper 파일 🔒

- **로그인된 Paper Desktop(computer-use) 또는 Paper MCP + 팀 접근 권한이 있어야 한다.** Desktop은 화면 탐색·육안 대조에, MCP는 노드 조회·일괄 내보내기에 적합하다. 둘 다 없으면 §5 마지막 단락의 대체 경로.
- **fileId `01M0VGPX92K1TER4ZV9PWGQJJZ`를 항상 명시한다.** 같은 팀에 이름이 거의 같은 파일("Athena - duplicate")이 하나 더 있고 더 최근일 수 있다 — 그쪽을 잡으면 안 된다.
- 페이지 3장: 화면 `1-0` · **카드 `5-1`**(보드 96장) · 증명 `F-1`(17F8-2). 전환은 `open_file`. 보드 id = Paper 노드 id(예 `2SKU-1`). 카드 6장 × 레일: CC-01 계좌 · CC-02 주문 · CC-03 종목·상품 · CC-04 호가 · CC-05 수급 · CC-06 탐색.
- MCP 함정: `update_styles`는 픽셀 높이만(`fit-content`는 높이 0으로 붕괴) · `get_tree_summary`는 depth 10에서 "… N children"으로 잘림(`get_children`으로 보강) · `export_combined_pdf` 동시 호출은 파일 번호가 뒤섞이고 계좌 보드는 빈 페이지를 낸다(글자 20 미만 페이지 제거) · 빈 스크린샷은 마운트 안 된 아트보드지 렌더러 오류가 아니다 · `<br>` 같은 void 태그는 트리 정렬에서 건너뛴다.
- 정본 데이터셋(모든 보드 공통): 삼성전자 150,850 · +1,850 · +1.24% · 1,420만주 · 2.14조 · 시가 149,200 · 고가 152,400 · 저가 148,100 · PER 21.2 · 체결강도 108.4 / KODEX 200 48,360 · NAV 48,318 / SK하이닉스 198,400 +2.05% / 현대차 232,500 / NAVER 214,000 / 카카오 41,850 / 기아 99,400 · 전일 100,100 / 한미반도체 197,400 +4.18% / 이수페타시스 64,500 +29.9% / 업종 반도체 3,184.52 / 거래일 09-01→08-31→08-28→08-27→08-26(주말 금지) / 장중 09:42대.

---

## 9. 원본 PC에만 있는 것 (없는 게 정상)

- 세션 스크래치 124MB: 클레임 JSONL(`cc01…cc06`, `claims/`, `gate/`) — 원장에 병합됨 · 필드 감사 JSONL(`fieldaudit-*.jsonl`) · 검수 PDF 7장(`카드-전보드-표현100-최종.pdf`, `카드-전보드-필드100-최종.pdf`, `카드-밀도개선-18장.pdf` 등) — Paper에서 다시 export 가능 · 통합 카드 캡처 PNG.
- `.omc/progress.txt`·`prd.json` 원본(사본은 `docs/handoff/card-surface/`).
- 원본 대화의 Workflow 캐시(`~/.claude/projects/C--Projects-DAOU-Athena/<세션>/subagents/workflows/`).

---

## 10. 다시 조사하지 말 것

- 커버리지 판은 로더에 위임한다(예전 67.8%는 alt_mappings·indexed를 모르던 계산이었고 D3에서 고쳤다). 분모는 로더 `coverage().visible_total`=3,534 하나다.
- 레일 블록 계수는 A5에서 고쳤다(호가 보드 13→2~4). 남은 것은 소프트 경고(레일 행 7~11, 19장)뿐이며 보드 재설계 대상이 아니다.
- `rows_max` 하드 예산은 22(표 본문 20 + 합계 2), 레일 블록·KPI는 소프트. 구현 계획 문서의 밀도 줄은 2026-09-03에 로더 값으로 정정했다.
- 레거시 `card-kind-*.js` 16개는 `app/shell.html`이 로드하는 **기존 CC 카드 경로**(호가 사다리·AITS 차트)다. 보드 표면과는 별개(보드 96장 중 `primary.renderer` 비-null은 32S7-0의 `athena-chart` 하나). 기존 카드 회귀를 막기 위해 삭제 금지.
- 인라인 width가 컨테이너 쿼리를 이기므로 반응형은 `--bs-*` 변수로 hoist해서 푼다. `!important` 0.
- 보드 카드의 통합 카드 크롬(제목 줄·요약 칩·"전체 원본 필드 ▸")은 **제거 완료**(C5). 회귀 감시 대상.
- "제외 보드"는 두 뜻이다: 로더 `excluded_boards`(현재 0, 해소 대상)와 커버리지 판의 모수 밖 2장(17F8-2·fixture-quote, 영구).

---

## 11. 갱신 이력

- 2026-09-03 09:5x — 최초 작성(W2-C 게이트 수치). 저작 팩·워크플로 스크립트·진행 로그를 저장소로 복사. `validate_board_slots.py` 팩 경로 저장소 상대화 + 팩 폴더 부재 시 즉시 실패.
- 2026-09-03 10:3x — 구현 계획 밀도 줄 정정. 청크 드리프트 검사는 빌더 `--check`로 이미 존재(§7 등록). 브랜치는 키우미 대화가 먼저 만들어 origin에 올렸고, 이 대화의 스냅샷 e267c32가 그 위에 얹힘(푸시는 C5 레인의 일시 RED 1건이 풀리면).
- 2026-09-03 10:2x — 검증 워크플로(경로·수치·반증·새 세션 시뮬레이션 4레인) 반영: W3 정비 4레인 완료 상태로 정정(로더 96/제외 0, 커버리지 3,379/3,534, 크롬 제거 완료), 분모 3,534 통일, §6에 🔒 표기, §7에 쓰기 여부·게이트 읽기 스니펫, §8 Paper 전제·fileId 경고. 미커밋 `git status --short`: M 19 · ?? 50. 사용자 지시로 지속 커밋·푸시 시작(브랜치 `feat/card-surface-paper-to-code`).
- 2026-09-03 11:15 — Claude Desktop 이력과 `wf_622eeae9-f84.json` 직접 대조. 최상위 `completed`와 달리 정비 A5/B4/C5/D3만 완료, 저작 8레인과 게이트는 주간 한도 오류(게이트 tool call 0). C5의 실보드 캡처 24장·P5 통과·최대 overflow 25px 확인, 앱 단위 2,035/0 재검증. 실행 중 표기를 제거하고 재개 순서를 저작→게이트로 정정.
- 2026-09-03 11:45 — 별도 C5 리뷰에서 전역 KPI 160px 바닥·미측정 XL/M·surface overflow 미판정 발견. 실패 재현 후 최소폭을 값 있는 탄력 KPI에만 한정, `Chart Context Actions` absolute left+폭만 좁은 단계에서 양쪽 inset으로 전환(툴팁·차트 핸들 제외), surface overflow를 하드 실패로 변경. 기본 6장 24캡처+12 프로브 및 위험 표본 3장(8/6 KPI) 모두 overflow 0·P5 통과, 앱 2,039/0. 저작 레인은 12~19개 탐색 명령 후 오류·순변경 0으로 표현 정정.
- 2026-09-03 12:07 — C5 독립 재리뷰의 잔여 2건을 1차 보강. 반응형 단계에서 고정 높이 hoist의 세로 내용 넘침·형제 겹침을 하드 실패로 만들고, XL/M 프로브가 접힘·KPI 행/열·primary/rail 상대 위치를 계약과 대조하도록 보강. 빈·중복·미등록 `ATHENA_VERIFY_BOARD_IDS`도 main 진입 시 즉시 실패. 기본 6장 24캡처+12 프로브 재생성 결과 surface overflow 0, P5·텍스트 상등 통과; KPI 행 계측의 false-negative는 12:17 재리뷰에서 발견·교정.
- 2026-09-03 12:17 — 재리뷰가 높이가 다른 KPI 셀을 `top` 동일성으로 세어 3+2를 1+2+2로 오판하는 false-negative를 발견. 세로 구간 겹침 기반 순수 행 계산기와 4열 음성 테스트를 추가해 `2R3M-1` M 결과가 `[[3,2]]`·최대 3열로 교정됨. 기본 6장 24캡처+12 프로브 재통과, 앱 2,042/0. 문서의 세로 0 범위를 L/M/S/XS로 명시하고 XL Paper 원문 2px는 기록·게이트 제외로 정정.
- 2026-09-03 12:52 — 재개 저작 `account-a` 리뷰·수정 완료. 최초 21건 감소 중 금액→shares 오매핑 12건과 의미 불일치 2건을 독립 리뷰가 발견. `c52a446`에서 거짓 매핑을 제거하고 account 필드 2건을 정확한 `2SKU-1` 슬롯으로 이동해 안전한 순증가 9건(coverage 3,388/3,534, 미도달 146, op 297/299), validator 37건/21장. `3GRO-0`에 6구간 금액 잎이 없어 12건·2 op는 Paper 표면 저작 전까지 명시적 blocker.
