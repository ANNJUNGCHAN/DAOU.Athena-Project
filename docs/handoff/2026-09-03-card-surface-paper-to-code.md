# 인계 — 카드 표면 Paper→코드 (2026-09-03)

> **이 문서의 용도.** 원본 대화의 주간 사용량이 바닥나면(사용자 기준 3% 남을 때) 다른 컴퓨터·다른 계정·새 대화가
> 이 문서만으로 같은 자리에서 이어받는다. 바로 붙여 넣을 블록은 [CARD_SURFACE_PROMPT.md](./CARD_SURFACE_PROMPT.md)에 있다.
> 이 문서는 마일스톤마다 갱신된다 — 맨 아래 §11 "갱신 이력"의 마지막 줄이 이 문서가 아는 가장 최근 상태다.

---

## 0. 30초 요약

- **하는 일.** Paper 디자인 파일의 카드 페이지 보드 96장을 **그대로**(픽셀 동일) Electron 앱의 대화 캔버스에 띄운다.
  캔버스는 브라우저처럼 **탭 스트립 + 카드 1장 뷰포트**이고, 카드는 컨테이너 폭 5단(XL/L/M/S/XS)으로 반응형이며 값·문구는 어느 단계에서도 바뀌지 않는다.
- **어디까지 왔나.** Paper 쪽은 끝났다(키움 REST 299 op · 가시 필드 3,532 전부 표현). 코드 쪽은 추출 96/96 · 백엔드 로더/계약 · 프론트 탭/마운트/반응형 CSS까지 붙었고,
  슬롯 저작(보드의 텍스트 자리 ↔ API 필드 바인딩)이 로더 기준 **≈95.6%**(미도달 155 occurrence)다.
- **지금 돌고 있는 것.** 웨이브 3(로더 격리·밀도 계수 정정·크롬 제거·3차 저작 8레인·실보드 캡처 게이트). 원본 대화가 끊기면 §5의 절차로 이어 돌린다.
- **git에 아무것도 커밋되지 않았다.** 수정 19 + 미추적 65 파일. 다른 컴퓨터로 가려면 §1의 WIP 커밋이 먼저다.

---

## 1. 저장소 상태 (2026-09-03 09:5x 실측)

| 항목 | 값 |
|---|---|
| 브랜치 | `main` (로컬). `origin/main`보다 **60커밋 뒤** — 다른 트랙(키우미·플러그인 기조)이 origin에 먼저 올라갔다 |
| 미커밋 | 수정 19 · 미추적 65 (아래 §3 지도의 파일 전부) |
| 워크트리 | 카드 트랙은 메인 체크아웃에서만 작업. 에이전트/플러그인 트랙은 별도 워크트리(`DAOU.Athena-plugin` 등)라 여기와 섞이지 않는다 |
| 테스트 기준선 | app 단위 **2,033 / 0 fail** · backend 카드표면 4파일 **142 passed** · scripts **235 passed** · `verify:integrated-cards` missing 0 / unresolved 0 |
| 알려진 RED | `backend/tests/api/test_task_canvas_envelope.py` 1건 — `_view_instance_id`에 `operation_ref`가 없는 **기존 WIP**. 이 트랙과 무관, 고치지 말 것 |

**다른 컴퓨터로 옮길 때는 반드시 브랜치에 WIP 커밋을 먼저 남긴다** (origin/main 뒤에 있으므로 `main`에 바로 올리지 않는다):

```bash
git checkout -b feat/card-surface-paper-to-code && git add -A && git commit -m "wip(card-surface): Paper→코드 카드 표면 웨이브 3 진행 중 (인계용 스냅샷)" && git push -u origin feat/card-surface-paper-to-code
```

`.gitattributes`가 `* -text`라 병합 시 `-X ignore-cr-at-eol`을 붙인다([README §5](./README.md)). pre-push 훅이 app 단위 전체를 돌린다 — 빨간 테스트가 있으면 push가 막힌다.

---

## 2. 사용자가 확정한 것 (다시 묻지 말 것)

1. **"카드는 오직 paper design에 있는 카드만 써야하며, 디자인은 완전 동일해야해."** 범용 렌더러·새 프리미티브·"비슷하게 재구성" 전부 금지. 앱은 Paper `get_jsx` 추출물을 그대로 그린다.
2. **캔버스 = 탭 브라우저.** 카드 1장만 뷰포트에, 여러 카드는 탭. 모든 카드 크기 동일(뷰포트 100%). 창을 2분할·4분할·원본·최소로 바꿔도 반응형. 축소(zoom) 금지.
3. **집약 불인정.** 필드는 직접·병기·펼침 3층 중 하나로 **값이 보여야** 표현이다. 비노출은 명문 계정 173개뿐(전송·내부 171 + 예비 슬롯 2).
4. **밀도 규칙 H1~H4 승인**(영값 묶음 "0원 N항목 ▸", 값 우선, 병기 2값, 행 리듬 13/32px) — "응 진행해봐".
5. **검수 방식.** 마일스톤마다 전 보드 스크린샷/PDF를 보내 사용자 검수를 받는다. 검수 문구 3원칙: 설명문 금지·한국어 단위·내부용어 금지.

**사용자 결정 대기(보류 중, 임의로 정하지 말 것):** 호가단위 100원 전환 · 마이너스 기호 표준 · Paper 화면 페이지 그리드 규약 · 화면 페이지 기록 보드 "55 · 캔버스 탭 스트립"(3ZPB-0) 승인.

---

## 3. 지도 — 정본 문서·원장·코드

| 무엇 | 경로 | 비고 |
|---|---|---|
| **헌장(디자인 표준)** | `docs/ui/paper-card-surface-charter.md` | 15 신념·표현 3층·밀도 예산·문법 A~G·H1~H4·비노출 계정 |
| 구현 계획 | `docs/architecture/card-surface-implementation-plan.md` | D1~D7 (D3 폭은 아래 문서로 대체) |
| 탭·반응형 계획 | `docs/architecture/canvas-tabs-responsive-plan.md` | 5단 컨테이너 쿼리, 저장 형식, 파리티 P1~P5 |
| op 원장 (299) | `PAPER_CARD_COVERAGE.json` / `.md`, `scripts/paper_card_coverage.py` | 299/299 표현 |
| 필드 원장 (3,534행) | `PAPER_FIELD_COVERAGE.json` | 행마다 cls·layer·board·where. 3,532 표현 + 2 비노출 |
| 클레임 병합기 | `scripts/merge_field_claims.py` | 클레임 JSONL → 원장 |
| 현황판 | `scripts/surface_dashboard.py` → http://127.0.0.1:8765 | `.claude/launch.json` "surface-dashboard" |
| **Paper 원문 저장소** | `backend/ref/card-surface-templates/<board>/` | `meta.json`·`paper.jsx`·`paper.tree.txt`·`regions.json`(사람이 저장) → `board.html`·`slots.json`(생성). `index.json` 96장 |
| 저작 팩 | `backend/ref/card-surface-authoring/packs/<board>.pack.json` (+`.fields.json`) | 보드 몫 필드 목록. **2026-09-03에 세션 임시 폴더에서 저장소로 옮김** |
| 추출기 | `scripts/paper_board_extract.py` | JSX→HTML, 영역 클래스 `bs-*`, 슬롯 골격, `--apply-columns`·`--no-index`·`--check` |
| 슬롯 검증기 | `scripts/validate_board_slots.py` | 보드별 a~g 검사. 팩 경로 기본값 = 위 packs, `ATHENA_PACK_DIR`/`--pack-dir`로 덮어씀 |
| 커버리지 판 | `scripts/card_surface_coverage.py` → `CARD_SURFACE_COVERAGE.md` | W3 D3가 로더 기준으로 정본화 중 |
| 레지스트리 빌더 | `scripts/build_board_registry.py` → `app/lib/board-templates.index.generated.js` + `board-templates.CC-0n.generated.js` | 카드별 지연 로드 청크 |
| 백엔드 로더 | `backend/athena_api/card_surface_templates.py` | `get_registry()`(lru) / `load_registry()`; 밀도 예산·중복 규칙·alt_mappings·f_pattern |
| 백엔드 계약 | `backend/athena_api/card_surface_contract.py` | `build_surface_contract` → 봉투 `surface_contract{slot_values…}` (REST·MCP 공용) |
| 배선 | `backend/athena_api/api/canvas_push.py`(+`/api/v1/internal/canvas/board-hydrate`), `backend/athena_mcp/canvas_data.py` | |
| 프론트 | `app/lib/canvas-tabs.js`·`board-mount.js`·`board-format.js`·`board-template-registry.js`·`main/board-hydrate.js`, `app/styles/board-surface.css`·`canvas-tabs.css`, `app/canvas.js`(renderBoardSurfaceCard) | |
| 검증 스크립트 | `app/verify-integrated-cards.js` → `app/captures/integrated-cards/` | 창 4종 1920·960·640·480 |
| 워크플로 스크립트 사본 | `docs/handoff/card-surface/workflows/*.js` | W1·W2a·W2b·W2c·W3. 절대경로(`C:\Projects\DAOU.Athena`, venv, fnm) 포함 — 다른 PC에선 고쳐 쓴다 |
| 진행 로그 사본 | `docs/handoff/card-surface/progress.txt`, `prd.json` | 정본은 `.omc/`(git 무시) |

---

## 4. 수치 — 웨이브 2-C 게이트(2026-09-03) 기준

| 항목 | 값 |
|---|---|
| 보드 | 96 (카드 6 · 증명 페이지 17F8-2 제외) |
| 추출 | 96/96, `--check` 드리프트 0 |
| 슬롯 검증 잔여 | 40건(b2 e38) / 22장 — 전부 아직 저작 안 붙인 필드 |
| 로더 strict 미도달 | 155 occurrence / 3,531 → **≈95.6% 도달** (정본) |
| 보드 없는 op | 4 — `detail:kt00005:margin_order_capacity`, `kt00011:account_funding`, `kt00013:d2_funding_capacity`, `kt00013:margin_order_capacity` |
| 로더 로드 차단 | 밀도 17(레일 블록 계수 오류가 몸통) · 진짜/가짜 중복 11 · 상태 1(2QFO-2 자기부모) |
| 커버리지 스크립트 | 67.8% — alt_mappings·indexed를 모르는 옛 계산. **로더 수치가 정본**(W3 D3가 맞춤) |

`get_registry()`는 전부-아니면-전무라 위 차단이 남아 있는 동안 `surface_contract`가 None이다 → 앱은 보드 카드를 아직 실데이터로 못 띄운다. W3 B4가 보드별 격리로 푼다.

---

## 5. 진행 중 — 웨이브 3 (원본 대화 task `we5uj8uzd`, run `wf_622eeae9-f84`)

3단계: **정비**(A5 추출기 밀도 계수 ∥ B4 로더 격리·coverage API ∥ C5 보드 카드 크롬 제거·실보드 6장 캡처 ∥ D3 커버리지 정본화) → **3차 저작 8레인**(account-a/b, quote-flow, rank-a/b, watch-answer, orderbook, uncovered-sweep; 보드 소유 겹침 없음) → **게이트**(get_registry 정식 경로, validate 전 보드, 커버리지, 빌드+앱 테스트, 백엔드 전수, 실보드 6장×4단계 캡처).

**원본 대화에서 끊겼을 때(같은 PC):** `Workflow({scriptPath: "<세션>/workflows/scripts/card-surface-w3-wf_622eeae9-f84.js", resumeFromRunId: "wf_622eeae9-f84"})`. 완료 레인은 캐시로 즉시 돌아온다. 결과가 비면 `<세션>/subagents/workflows/wf_622eeae9-f84/journal.jsonl`을 먼저 읽는다.

**다른 대화·다른 PC에서:** 캐시가 없으므로 상태를 실측한 뒤 필요한 단계만 다시 돌린다.

1. `git status --short`로 W3가 어디까지 파일을 만졌는지 본다(A5 → `scripts/paper_board_extract.py`, B4 → `card_surface_templates.py`, C5 → `app/canvas.js`·`integrated-card-surface.js`, D3 → `card_surface_coverage.py`).
2. §7의 검증 명령을 돌려 §4 수치와 비교한다. 로더가 격리 로드(`excluded_boards`)를 지원하면 정비는 끝난 것이다.
3. 남은 것만 `docs/handoff/card-surface/workflows/card-surface-w3-*.js`를 복사·경로 수정해서 돌리거나, 레인 프롬프트를 그대로 서브에이전트에 준다.

**게이트가 끝나면 사용자에게 보여줄 것:** 실보드 6장(2SKU-1·2R3M-1·13BC-2·2QFO-2·13K0-2·135M-2)의 4단계 캡처를 Paper 스크린샷과 나란히 놓고 차이를 보고한다. Paper 스크린샷은 `get_screenshot`(아트보드가 마운트돼 있어야 함 — 빈 샷은 렌더러 오류가 아니다).

---

## 6. 남은 일 (순서대로)

1. W3 게이트 읽기 → 로드 보드 수/제외 보드·커버리지·캡처. 제외 보드가 남으면 사유별로 해소(진짜 중복 3장 2Z49-0·3LGC-0·3NVG-0는 저작 수정, 밀도는 계수 정정으로 해소돼야 정상).
2. 슬롯 바인딩 100%: 미도달 occurrence 0 · 보드 없는 op 0 · 상태 컨트롤 9건 `meta.state.control_text` · CC-05 탭 보드 부모(2QFO-2는 레일 주인, 자기참조 금지) · 바인딩 슬롯 `row_index` 좌표.
3. 실앱 QA: 실키움(모의) 봉투로 보드 카드 실데이터 표시 1회 · 4단계 창 캡처 vs Paper 시각 대조 · 헌장 게이트(밀도 하드 0, 문구 3원칙) · 사용자 검수 PDF.
4. 17F8-2(증명 페이지)에만 귀속된 105 필드 재귀속 — 로더 미도달 목록과 같은 뿌리. 몸통은 금현물(kt50020·kt50030·kt50031·kt50032·kt50075)과 계좌 증거금·인출(kt00001·kt00005·kt00010·kt00011·kt00012·kt00013).
5. 커밋. 사용자가 요청한 적 없다 — 인계 시점의 WIP 커밋(§1)만 예외.

---

## 7. 검증 명령·환경 함정

```bash
export PATH="/c/Users/ajc22/AppData/Local/fnm_multishells/9988_1786672622598:$PATH"
```

`node`가 PATH에 없으면 fnm 환경이다 — 위 multishell 경로는 원본 PC 값이니 새 PC에서는 `fnm env`로 대체. **백엔드 pytest도 node가 필요하다**(`evaluate_selector_ablations.py`).

| 무엇 | 명령 | 기준선 |
|---|---|---|
| 추출 전수·드리프트 | `backend/.venv/Scripts/python.exe scripts/paper_board_extract.py` / `... --check` | 96/96, 드리프트 0 |
| 슬롯 검증 | `backend/.venv/Scripts/python.exe scripts/validate_board_slots.py [board…]` | 합계 문제 40 → 목표 0 |
| 로더 격리 로드 | `cd backend && uv run python -c "from athena_api.card_surface_templates import get_registry; r=get_registry(); print(len(r.boards))"` | 96 (W3 이후) |
| 커버리지 판 | `PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py` | `CARD_SURFACE_COVERAGE.md` |
| 레지스트리 빌드 | `python scripts/build_board_registry.py` | 청크 6 + index |
| app 단위 | `cd app && npm run test:unit` | 2,033 / 0 |
| backend 카드표면 | `cd backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q` | 142 |
| backend 전수 | `cd backend && uv run pytest tests -q` (≈25분) | 기존 WIP RED 1건 외 0 |
| scripts | `backend/.venv/Scripts/python.exe -m pytest scripts/tests -q` | 235 |
| 4단계 캡처 | `cd app && npm run verify:integrated-cards` | missing 0 · `app/captures/integrated-cards/` |

함정: 한글 출력은 `PYTHONIOENCODING=utf-8` · `python`(시스템)과 `backend/.venv/Scripts/python.exe`를 구분(추출·검증은 venv) · Workflow 스크립트는 LF만(CRLF는 "control characters"로 거부), 템플릿 프롬프트 안 백틱 금지 · `.omc/`는 git 무시.

---

## 8. Paper 파일

- fileId `01M0VGPX92K1TER4ZV9PWGQJJZ`, 페이지 3장: 화면 `1-0` · **카드 `5-1`**(보드 96장) · 증명 `F-1`(17F8-2). 페이지 전환은 `open_file`.
- 카드 6장 × 레일: CC-01 계좌 · CC-02 주문 · CC-03 종목·상품 · CC-04 호가 · CC-05 수급 · CC-06 탐색. 보드 id = Paper 노드 id(예 `2SKU-1`).
- MCP 함정: `update_styles`는 픽셀 높이만(`fit-content`는 높이 0으로 붕괴) · `get_tree_summary`는 depth 10에서 "… N children"으로 잘림(`get_children`으로 보강) · `export_combined_pdf` 동시 호출은 파일 번호가 뒤섞이고 계좌 보드는 빈 페이지를 낸다(글자 20 미만 페이지 제거) · `<br>` 같은 void 태그는 트리 정렬에서 건너뛴다.
- 정본 데이터셋(모든 보드 공통): 삼성전자 150,850 · +1,850 · +1.24% · 1,420만주 · 2.14조 · 시가 149,200 · 고가 152,400 · 저가 148,100 · PER 21.2 · 체결강도 108.4 / KODEX 200 48,360 · NAV 48,318 / SK하이닉스 198,400 +2.05% / 현대차 232,500 / NAVER 214,000 / 카카오 41,850 / 기아 99,400 · 전일 100,100 / 한미반도체 197,400 +4.18% / 이수페타시스 64,500 +29.9% / 업종 반도체 3,184.52 / 거래일 09-01→08-31→08-28→08-27→08-26(주말 금지) / 장중 09:42대.

---

## 9. 원본 PC에만 있는 것 (없는 게 정상)

- 세션 스크래치 124MB: 클레임 JSONL(`cc01…cc06`, `claims/`, `gate/`) — 이미 원장에 병합됨 · 필드 감사 JSONL(`fieldaudit-*.jsonl`) · 검수 PDF 7장(`카드-전보드-표현100-최종.pdf`, `카드-전보드-필드100-최종.pdf`, `카드-밀도개선-18장.pdf` 등) — Paper에서 다시 export 가능 · 통합 카드 캡처 PNG.
- `.omc/progress.txt`·`prd.json` 원본 (사본은 `docs/handoff/card-surface/`).
- 원본 대화의 Workflow 캐시(`~/.claude/projects/C--Projects-DAOU-Athena/<세션>/subagents/workflows/`).

---

## 10. 다시 조사하지 말 것

- 커버리지 67.8%는 계산기 문제다(§4). 로더 strict가 정본.
- 호가 보드 rail_blocks 13은 계수 오류다 — Paper 레일 블록은 2~5개. 보드를 재설계하지 말고 계수를 고친다(W3 A5).
- `rows_max` 하드 예산은 20(표 본문) + 합계 2. 예전 ≤6 규칙은 폐기됐다.
- 레거시 `card-kind-*.js` 16개는 CC 카드의 본문(호가 사다리·AITS 차트)이다. 삭제 금지 — 보드의 `primary.renderer`가 참조한다.
- 인라인 width가 컨테이너 쿼리를 이기므로 반응형은 `--bs-*` 변수로 hoist해서 푼다. `!important` 0.
- 통합 카드 크롬(제목 줄·요약 칩·"전체 원본 필드 ▸")은 보드 카드에서 헌장 위반이라 제거 대상(W3 C5).

---

## 11. 갱신 이력

- 2026-09-03 09:5x — 최초 작성. W2-C 게이트 수치 반영, W3 실행 중(정비 4레인 시작, 완료 0). 저작 팩·워크플로 스크립트·진행 로그를 저장소로 복사. `validate_board_slots.py` 팩 경로 기본값을 저장소 상대 경로로 변경.
