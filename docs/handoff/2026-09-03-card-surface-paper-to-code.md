# 인계 — 카드 표면 Paper→코드 (2026-09-03)

> **이 문서의 용도.** 원본 대화가 끊기면(사용량 소진·PC 교체·계정 교체) 다른 대화가 이 문서만으로 같은 자리에서 이어받는다.
> 바로 붙여 넣을 블록은 [CARD_SURFACE_PROMPT.md](./CARD_SURFACE_PROMPT.md). 이 문서는 마일스톤마다 갱신되고 브랜치 `feat/card-surface-paper-to-code`에 계속 커밋·푸시된다 — §11 "갱신 이력"의 마지막 줄이 이 문서가 아는 가장 최근 상태다.
> **모든 명령은 Git Bash 문법이다.** PowerShell에 그대로 붙이면 첫 줄부터 깨진다.

---

## 0. 30초 요약

- **하는 일.** Paper 디자인 파일의 카드 페이지 보드 96장을 **그대로**(픽셀 동일) Electron 앱의 대화 캔버스에 띄운다. 캔버스는 브라우저처럼 **탭 스트립 + 카드 1장 뷰포트**, 카드는 컨테이너 폭 5단(XL/L/M/S/XS) 반응형, 값·문구는 어느 단계에서도 불변.
- **어디까지 왔나.** Paper 쪽은 끝났다(키움 REST 299 op · 카드 표면 가시 필드 3,532 전부 표현). 코드 쪽은 추출 96/96 · 백엔드 로더가 96장 전부 로드(제외 0) · 봉투 `surface_contract` · 프론트 탭/마운트/반응형 CSS · 보드 카드의 통합 카드 크롬 제거까지 붙었다. 슬롯 저작(보드 텍스트 자리 ↔ API 필드)은 로더 기준 **3,382/3,532 occurrence = 95.8%**다. semantic authority 후보 3,534개 중 예비 `base:04` FID `924`·`951`만 카드 표면 visible universe에서 제외한다.
- **정확한 중단점.** 웨이브 3 정비 4레인(A5/B4/C5/D3)과 저작 Tasks 1–8은 모두 실행·리뷰·수정됐다. 현재 미도달 150, validator 59건(`b15 e44`)/27장, 보드 없는 op 2이며, 남은 항목은 거짓 alt로 닫지 않은 exact-leaf/composite/aspect/join/realtime blocker다. `extra_fields` end-to-end 합성은 현재 스키마로 lossless하지 않아 `STOP_NO_CHANGES`이며 사용자 설계 승인 대기다. 적응형 가독성 **G1–G4는 완료·푸시**(G4 커밋 `d612cb5`). **G5 육안 Paper 승인은 FAIL**로 확정·보존된 뒤 G5a(결함 수정+검출기 확장, in_progress)와 G5b(육안 재승인, pending)로 대체됐다. G5a 코드 — 13K0-2·2R3M-1 반응형 주석, 2QFO-2 금액+단위 atomic, 2R3M-1 `3CRW-0` paired-table, glyph/legacy-pair 검출기 확장, probe 스코핑(undeclared value-atomic 스킵 · 비-opt-in `.bs-table`/primary 예탁 캡션 자동토큰 제외 · strip/header·금액 토큰만 auto-atomic) — 은 **진단+정본 Electron 캡처까지 초록**이다(2026-09-04 07:47/07:49 KST, 36측정 atomic/overlap/paired 0, overflow 0, 13BC-2 대조군 유지). **G5b 육안 Paper 재승인은 2026-09-04 실행 결과 승인되지 않았다** — 결함 A·C는 Paper 대조로 해소 확인, 결함 B의 금액 토큰도 붙었지만 같은 보드 `2QFO-2` 960px에서 표 상위 3행의 값이 헤더 열과 어긋나는 새 Paper 불일치가 남았다(§4·§6).
- **커밋.** 2026-09-03부터 브랜치 `feat/card-surface-paper-to-code`에 지속 커밋·푸시한다(사용자 지시). `main`은 origin보다 60커밋 뒤라 직접 올리지 않는다.

---

## 1. 저장소 상태

| 항목 | 값 (2026-09-04 G5a 자동 게이트 닫힘 · G5b 대기) |
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
3. **집약 불인정.** 필드는 직접·병기·펼침 3층 중 하나로 **값이 보여야** 표현이다. semantic authority 후보는 3,534행이며 카드 표면 visible universe는 예비 `base:04` FID 924·951만 제외한 3,532개다. 두 예비 occurrence는 semantic authority에서 삭제하지 않되 카드 표면 미도달로 세지 않으며, 별도 transport/internal hidden authority 171개도 불변이다(§10).
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
| 저작 팩 | `backend/ref/card-surface-authoring/packs/<board>.pack.json` | 보드 몫 필드 목록(96장 전부). `.fields.json`은 선택(93장; `17F8-2.fields.json`은 모수 밖 증명 페이지의 역사적 잔재). 2026-09-03 세션 임시 폴더에서 저장소로 옮김 |
| 추출기 | `scripts/paper_board_extract.py` | JSX→HTML, 영역 클래스 `bs-*`, 슬롯 골격, `--apply-columns`·`--no-index`·`--check` |
| 슬롯 검증기 | `scripts/validate_board_slots.py` | 보드별 a~g 검사. 팩 경로 기본값 = 위 packs, `ATHENA_PACK_DIR`/`--pack-dir`로 덮어씀. 팩 폴더가 없으면 즉시 실패 |
| 커버리지 판 | `scripts/card_surface_coverage.py` → `CARD_SURFACE_COVERAGE.md` | 바인딩 판정은 로더에 위임(스크립트가 세지 않는다) |
| 레지스트리 빌더 | `scripts/build_board_registry.py` → `app/lib/board-templates.index.generated.js` + `board-templates.CC-0n.generated.js` | 카드별 지연 로드 청크. **97장**(fixture-quote 포함)이 정상. 템플릿을 고치면 재빌드해야 한다 — `--check`가 드리프트를 잡는다(§7) |
| 백엔드 로더 | `backend/athena_api/card_surface_templates.py` | `get_registry()`(lru, 보드별 격리 → `registry.excluded_boards`, `registry.coverage()`) / `load_registry(strict=True)`(CI, 예외). 밀도 하드 = 표 열 ≤8 · 행 ≤22 · 높이 ≤1,120; 레일 블록·KPI는 소프트 |
| 백엔드 계약 | `backend/athena_api/card_surface_contract.py` | `build_surface_contract` → 봉투 `surface_contract{slot_values…}` (REST·MCP 공용) |
| 배선 | `backend/athena_api/api/canvas_push.py`(+`/api/v1/internal/canvas/board-hydrate`), `backend/athena_mcp/canvas_data.py` | |
| 프론트 | `app/lib/canvas-tabs.js`·`board-mount.js`·`board-format.js`·`board-template-registry.js`·`main/board-hydrate.js`, `app/styles/board-surface.css`·`canvas-tabs.css`, `app/canvas.js`(renderBoardSurfaceCard — 보드 카드는 통합 카드 크롬을 그리지 않는다) | |
| 검증 스크립트 | `app/verify-integrated-cards.js` → `app/captures/integrated-cards/` | 창 4종 1920·960·640·480 |
| 워크플로 스크립트 사본 | `docs/handoff/card-surface/workflows/*.js` | W1·W2a·W2b·W2c·W3의 **역사적 provenance 전용 사본**. 현재 Tasks 1–8이 별도 실행·리뷰됐으므로 `ROOT`·`PY`를 고치거나 레인 프롬프트를 다시 배포하지 않는다. `resumeFromRunId`도 금지(§5) |
| 진행 로그 사본 | `docs/handoff/card-surface/progress.txt`, `prd.json` | 정본은 `.omc/`(git 무시) |

---

## 4. 수치 (G5a 정본 2026-09-04 07:49 KST Electron · 진단 07:47 KST)

| 항목 | 값 |
|---|---|
| 보드 | 96 (카드 6 · 증명 페이지 17F8-2와 fixture-quote는 모수 밖 — 해소 대상 아님) |
| 추출 | 96/96, `--check` 드리프트 0 |
| **로더** | `get_registry()` 보드 96 · `excluded_boards` 비어 있음 · `complete=False`는 부분 로드 경로라 정상 |
| **커버리지(정본 = 로더 `coverage()`)** | occurrence 도달 **3,382 / 3,532 (95.8%)** · op 커버 297/299 |
| 미도달 | **150 occurrence**. Tasks 1–8에서 semantic/unit/row/runtime를 대조했으며, 독립 Paper leaf 부재·합성/aspect·join·realtime 계약 부재를 거짓 alt로 닫지 않은 결과 |
| 보드 없는 op | 2 — `detail:kt00005:margin_order_capacity`, `detail:kt00013:margin_order_capacity`. `3GRO-0`에는 6구간 `…주` 잎만 있고 금액 잎이 없어 12 occurrence를 정직하게 미도달로 유지 |
| 슬롯 검증기 잔여 | **59건 (`b15 e44`) / 27장**. coverage와 validator 문제 수는 일대일 지표가 아니며, 남은 항목은 task 보고서의 명시적 blocker |
| 밀도 | 하드 위반 0 · 소프트 경고 22(레일 행 7~11) · 재표시 경고 127 · 중복 바인딩 0 |
| 상태 컨트롤 미해소 | **0** — account/gold/watch/orderbook의 canonical child meta → parent marker → runtime click 경로 검증 |
| C5 반응형 자동 검증 | 실보드 6장 × 4단계 PNG **24장** + 보드별 XL 1,360px·M 851px 기하 프로브 **12회**, P5·단계 간 텍스트 상등, surface overflow 최대 0px, L/M/S/XS 세로 내용 넘침·형제 box 겹침 0. XL 원문 `2R3M-1/36Q0-0`의 2px 세로 넘침 1건은 기록·제외. 캡처 폴더는 정본 24장만 남았다(과거 표본 `15P5-2`·`2QX1-1`·`3DZ1-0` 각 4장 = 12장은 검증기가 정리하고 sha256과 함께 증거 폴더로 격리). `capture_hygiene`이 24 파일·24 해시·24 치수를 정본 실행에서 검증한다 |
| 가독성 하드 게이트 | **G5a 정본(2026-09-04 07:49 KST):** `assertReadability(..., {enforce: true})`가 24 캡처 + 12 probe = **36 측정** 전부에서 `atomic_wrap_total`·`text_overlap_total`·`paired_semantics_total` **0**, `max_overflow_x` **0**. 진단(07:47 KST, `ATHENA_VERIFY_BOARD_IDS` 6장)도 동일 0. 선언 atomic/flow/paired-table(13K0-2·2R3M-1·2QFO-2) + compact auto-token(strip/header·금액) + opt-in legacy_pair가 함께 동작한다. 비-opt-in `.bs-table`·primary 예탁 캡션은 자동토큰에서 제외해 2SKU-1/13BC-2 거짓양성을 막는다. **G5b 육안 Paper 재승인은 미실행** — 자동 0을 육안 PASS로 쓰지 말 것 |
| G5b Paper 육안 재승인 | **승인되지 않음(loop-back)** — Paper Desktop `Athena`/`카드`(fileId `01M0VGPX92K1TER4ZV9PWGQJJZ`) MCP 읽기 대조, 2026-09-04. 보드×폭 11칸 중 **10 PASS · 1 FAIL**. 해소 확인: 13K0-2 480·640·960의 `실시간 갱신`·`100개 결과`·`세션`·`정규장`·`시간외 단일가` 전부 한 줄(글자 분절 대신 그룹 줄이동), 2R3M-1 480의 `삼성전자`·`정규장`·`실시간` 온전, 2R3M-1 960의 `3CRW-0` 접힌 값이 `구분 매수체결`·`구분 KRX`·`체결강도 108.4%`로 **Paper 헤더 라벨을 달고** 나와 무라벨 연결 `150,850매수체결KRX118.1%` 소멸, 13BC-2 대조군 480·960 무변화. **미해소: `2QFO-2` 960px `투자자별 순매수` 표** — Paper 원본은 6열이 한 줄인데(외국인 매도 2,366억원·매수 4,208억원·순매수 +1,842억원·비중 44.0%·5일 누적 +3,214억원) 앱은 상위 3행에서 매도 칸이 비고 값이 한 레인씩 밀리며 `44.0%`·`+3,214억원`이 라벨 없이 셋째 줄로 내려간다. 하위 행(은행 이하)과 1920 XL은 정상 정렬이다. 세 하드 판정은 **열-헤더 대응을 보지 않으므로** 이 결함을 원리적으로 못 잡는다. 증거·다음 착수점은 §6 3번 |
| 테스트 | **G5a(2026-09-04):** `board-parity`+`board-glyph-geometry` **54/54 pass**(실측). 진단 리포트 완결(07:47:24 KST) · 정본 리포트 완결(07:49:35 KST, 36측정 0). 전체 app/scripts/backend 스위트는 이 세션에서 전수 재실행하지 않았고 pre-push 훅이 확인한다. G4 기준선: scripts 264·app 2,101·backend 카드표면 158·backend 전수 2,762 pass / 1 fail(문서화 RED envelope) / 5 skip |

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

**역사적 원본 workflow 상태:** 3차 저작 8레인(account-a/b, quote-flow, rank-a/b, watch-answer, orderbook, uncovered-sweep)은 각각 탐색 명령 12~19회를 실행했지만 주간 한도 오류로 끝났고, **게이트는 tool call 0회로 즉시 종료**했다. Claude 워크플로 JSON의 최상위 `status: completed`는 단계 상태를 대표하지 않는다. **이후 현재 shared worktree에서 Tasks 1–8을 모두 독립 실행하고 리뷰 수정을 반영했으므로 원본 저작 레인을 재개하거나 다시 실행하지 않는다.** 각 결과와 honest blocker는 `.superpowers/sdd/card-surface-w3-authoring/task-{1..8}-report.md`가 정본이다.

**Task 1 account-a 역사 및 잔존 blocker:** `account-a`는 커밋 `6cbb2b7` 후 독립 리뷰에서 금액→shares 오매핑 12건과 의미가 다른 account 필드 2건을 발견했다. 수정 `c52a446`에서 오매핑을 제거하고 `repl_amt`·`uncla`를 `2SKU-1`의 정확한 슬롯으로 옮겼다. 결과는 안전한 순증가 9건, 담당 validator 3장 문제 0. 금액 잎이 없는 12건은 Paper 정본에 이름 있는 `krw_ko` 잎을 만들기 전에는 닫지 않는다. 이는 Task 1의 결과이며 Tasks 2–8도 이후 실행·리뷰됐다.

**원본 증거:** `C:\Users\ajc22\.claude\projects\C--Projects-DAOU-Athena\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\workflows\wf_622eeae9-f84.json`. 원본 workflow JSON과 journal은 최초 실패의 역사적 증거로만 보존한다. 현재 상태 복구에 `resumeFromRunId`를 사용하지 않는다.

**다른 대화·다른 PC:** 캐시가 없다. §7 표의 읽기전용 명령으로 위 완료 신호와 §4 수치를 실측하고 Tasks 1–8 보고서를 읽는다. **저작 8레인은 재실행하지 않는다.** 다음 작업은 §6의 설계/Paper 결정과 final gate다.

**게이트가 끝나면 사용자에게 보여줄 것:** 실보드 6장(2SKU-1·2R3M-1·13BC-2·2QFO-2·13K0-2·135M-2) 4단계 캡처를 Paper 스크린샷과 나란히 놓고 차이를 보고. Paper 대조는 로그인된 Paper Desktop을 computer-use로 보거나 Paper MCP를 쓴다(§8) — 둘 다 없으면 그 단계만 원본 계정 보유자에게 넘긴다.

---

## 6. 남은 일 (순서대로) — 🔒 = 사람·외부 의존

1. **G5a 가독성 결함 수정 — Electron 자동 게이트 완료 · G5b 육안 대기.** G5 육안 전수 FAIL은 역사로 보존한다. 전역 `nowrap`·`overflow:hidden`·zoom·보드 id CSS·글자 축소·내용 삭제로 숨기지 않는다. **들어간 코드:** 13K0-2 `2WGY-0`/`2WHL-0` flow + trailing atomic; 2R3M-1 `2R8O-1` flow + atomics + `3CRW-0` paired-table; 2QFO-2 금액 flow/atomic; `compactAtomicTokenSpans`+`legacy_pair`(opt-in paired-table만); probe 스코핑(explicit `.bs-r-atomic`만 surface fallback, 비-opt-in `.bs-table` 및 non-chrome/non-money auto-token 제외). **실측(2026-09-04):** 진단 07:47:24 KST 리포트 완결 · 정본 07:49:35 KST 리포트 완결 · 6보드×(4 step+2 probe)=36측정 전부 atomic/overlap/paired 0 · overflow 0 · 13BC-2 6측정 동일 0(JSON에 findings 필드는 없음). **남은 것 = G5b** Paper 육안 재승인(대상 3결함 해소 확인). 아래 노드 목록은 G5 실패 근거로 그대로 둔다.

   **결함 A — 미선언 한국어 컨트롤·제목의 글자 단위 분해.** 13K0-2 480에서 `실/시/간`·`1 0 0/개/결`, 640에서 `정규/장`·`시간외 단/일가`; 2R3M-1 480에서 `삼성전/자`·`정규/장`·`실시/간`. 원인은 atomic nowrap이 `:is(.bs-r-flow, .bs-r-scroll)` 소유자 아래로만 걸리는데(`app/styles/board-surface.css:193`) 해당 노드들이 선언된 스크롤 소유자의 **뒤따르는 형제**라는 것이다.
   - 13K0-2: 정렬 행 `2WGY-0` → `flow`, 후행 `2WHJ-0`(실시간 갱신)·`2WHK-0`(100개 결과) → `atomic`. 필터 행 `2WHL-0` → `flow`, 후행 `2WHY-0`(세션)·`2WI0-0`(정규장)·`2WI2-0`(시간외 단일가) → `atomic`. `2WHW-0`은 이미 선언된 `2WHV-0` 아래라 불필요
   - 2R3M-1: 헤더 행 `2R8O-1` → `flow`, `2R8S-1`(삼성전자)·`358O-0`(정규장)·`358Q-0`(실시간) → `atomic`

   **결함 B — 좁은 flex 셀 안 금액의 단위 분리.** 2QFO-2 960에서 `+3,214억원` → `+3,214억 / 원`. 이 보드에는 감지된 표가 없다(`data-row="head"` 0건). 누적 금액 잎 `375E-0`·`376R-0`·`378K-0`의 부모는 `3751-0`·`376G-0`·`3789-0`, 조부모는 `2QHG-2`.

   **결함 C — 접힌 열이 라벨 없이 붙는 텍스트 충돌.** 2R3M-1 `체결 흐름`에서 `150,850매수체결KRX118.1%`, 헤더 `체결가구분체결강도`. 표 루트 `3CRW-0`, 헤더 행 `3CS8-0`, 6열 10행. 살아남는 셀 `3CSA-0`(체결가)에 4열 `3CSD-0`(구분)·5열 `3CSE-0`(체결강도)이 무라벨 `.bs-paired` 사본으로 붙는다. `3CRW-0`을 `paired-table`로 선언하면 추출기 `_collapse`가 `.bs-paired-label` + `.bs-paired-value[data-paired-source]` 경로를 탄다(선언이 없으면 무라벨 경로). CSS도 `.bs-r-paired-table [data-bs-value-atomic="true"]` nowrap이 필요하다(현재는 `[data-paired-source]`만).

2. **게이트 확장 — G5a Electron 실측 완료.** compact auto-token(strip/header·금액)과 opt-in paired-table legacy_pair가 `enforce: true`에 연결돼 있다. 전역 `.bs-paired` 스캔은 하지 않는다. **정본·진단 모두 13BC-2 6측정 atomic/overlap/paired 0 · overflow 0**을 확인했다. 아래 항목은 여전히 유효한 제약이다.
   - `atomic_wrap_nodes`를 선언 소유자 밖 텍스트 잎까지 확대: 공백 없는 단일 토큰이 2줄 이상으로 그려지면 결함. 긴 토큰(URL 등) 오탐 방지용 길이 상한 필요
   - `paired_semantics_violations`에 "보이는 `.bs-paired`에 `.bs-paired-label` 형제 없음"을 추가
   - **켜기 전 필수 측정**: `13BC-2`는 무변경 대조군인데 `bs-paired` 58건·라벨 0건이다. 위 규칙을 켜면 대조군이 RED가 될 수 있다. 4폭에서 그 사본들이 실제로 보이는지 측정으로 확인하고, 눈으로 본 상단 영역만으로 단정하지 않는다
   - 캡처는 `probe.card_rect`를 창 높이로 자르므로 **아래 영역은 이미지에 나오지 않는다**. 육안 전수만으로 하단 결함을 판정할 수 없다
   - 수정 후 24장과 12 probe를 다시 만들고 확장된 판정까지 0인지 확인한다. `3,532/3,532`, validator 0을 달성했다고 쓰지 않는다

   **범위 밖으로 기록**: 나머지 66장의 무라벨 `.bs-paired` 접기. 육안 감사 24장에 없어 아직 시각 실패로 확정된 바 없다. 별도 결정 대상이며 이번 웨이브(5보드 + 2표)에서 임의로 확대하지 않는다.
3. **G5b 블로커 — `2QFO-2` 960px 표 열 정렬.** Paper `2QH0-2`(`투자자별 순매수`)는 6열이 한 행에 한 줄이다. 앱 960에서 상위 3행(외국인·연기금 등·기타법인)만 `매도` 칸이 비고 매도값이 매수 레인, 매수값이 비중 레인 쪽, 순매수값이 5일 누적 레인에 그려지며 비중 `44.0%`와 5일 누적 `+3,214억원`이 라벨 없이 셋째 줄로 내려간다. `은행` 이하 행과 1920 XL은 Paper와 동일하게 정렬되므로 XL 파리티는 유지된다. 이 표는 감지된 표가 아니고(`data-row="head"` 0건) opt-in paired 대상도 아니라 접힌 값에 라벨이 붙지 않는다. **추정 원인(미검증):** 결함 B 수정으로 `5일 누적` 금액이 nowrap이 되어 그 열의 최소 폭이 커지면서 `매도` 열이 접혔다. **선택지:** (a) 이 표를 명시적 `paired-table`로 선언해 접힌 값에 라벨을 붙인다 (b) `scroll-table`로 6열을 유지하고 가로 스크롤한다 (c) 5일 누적 열의 최소 폭 요구를 낮춘다 — (c)는 결함 B를 되돌릴 위험이 있다. **`paper.jsx`는 바꾸지 않는다.** 함께 **열-헤더 대응 판정**(본문 셀의 가로 중심이 헤더 셀 레인을 벗어나면 실패)을 게이트에 추가한다. 증거: `.omx/artifacts/card-surface-adaptive-readability/20260903T100241Z/36-g5b-paper-visual-audit.md`, `35-g5b-visual-evidence/`.

   **범위 밖 관찰(차단 아님):** `13K0-2 / 33Z2-0`(`지금 많이 보는 종목`) 960에서 `기준가`가 `종목` 칸으로 접힌다. 헤더 칸도 같은 순서로 쌓여 대응은 되고 `기준 대비`·`직전 대비`는 Paper 원문이 이미 가진 라벨이다. 비-opt-in 표의 기존 접힘이며 문서화된 범위 밖 항목이다.

4. **Tasks 1–8 honest blocker 고정.** 현재 150 uncovered와 validator 59건을 각 task report와 대조한다. exact leaf가 없는 항목, 서로 다른 의미·단위의 same-op 필드, composite/aspect/join/realtime gap은 alt mapping으로 닫지 않는다.
5. **🔒 composite schema 결정.** systemic audit는 `STOP_NO_CHANGES`다. 감사 당시 실제 영향을 받는 uncovered는 38 unique occurrences/19 boards였고, 현재 metadata만으로 lossless한 subset 19개는 이미 다른 primary/alt에서 covered여서 순증가가 0이었다. 구현 전 per-part `format`, order/template/prefix, optional·missing policy, row selection/inheritance, aspect/sign, realtime recomposition/fail-closed 규칙과 대표 JSON migration을 승인한다.
6. **🔒 Paper leaf·라우팅 결정.** `3GRO-0`의 6구간 금액 12건·2 op 등 독립 leaf 부재 항목은 Paper 저작 또는 명시적 예외 승인 전에는 닫지 않는다. `1JZW-0`은 정본 계획상 direct-board 전용 예외로, canonical operation/state 결정 전에는 정상 라우팅을 추측하지 않는다.
7. **실앱 QA.** 4단계 창 캡처 vs Paper 시각 대조 🔒(로그인된 Paper Desktop/computer-use 또는 Paper MCP) · 헌장 게이트(밀도 하드 0, 문구 3원칙) · 사용자 검수 PDF 🔒(승인) · 실키움(모의) 봉투로 보드 카드 실데이터 표시 1회 🔒(모의투자 자격증명·장중).
8. 보류 결정 4건 🔒 — 사용자에게 한 번에 물어 닫는다.

승인 없이 가능한 것은 현재 상태의 읽기전용 재측정·기존 회귀 테스트·인계 문서 최신화·현재 체크포인트 커밋/푸시다. 시각 동작 변경, composite schema, Paper leaf 추가, 라우팅/예외 처리에는 각각의 명시적 승인이 필요하다.

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
| 슬롯 검증 | `backend/.venv/Scripts/python.exe scripts/validate_board_slots.py [board…]` | 읽기 | 현재 정직한 기준선 `합계 문제 59 (b15 e44)`/27장 · exit 1. exact leaf/schema 승인 없이 0으로 만들지 않음 |
| 게이트 읽기 | `cd backend && uv run python -c "from athena_api.card_surface_templates import get_registry; r=get_registry(); c=r.coverage(); print(len(r.boards), r.excluded_boards, {k:(v if not isinstance(v,list) else len(v)) for k,v in c.items()})" 2>/dev/null` | 읽기 | `96 [] {...}` — stderr의 소프트 예산 경고는 정상 |
| 커버리지 판 | `python scripts/card_surface_coverage.py` | **쓰기**(`CARD_SURFACE_COVERAGE.md`) | 총괄 = 게이트 읽기 수치 |
| 청크 드리프트 | `python scripts/build_board_registry.py --check` | 읽기 | `최신 — 보드 97장, 청크 6개` · exit 0. 붉으면 아래 빌드 |
| 레지스트리 빌드 | `python scripts/build_board_registry.py` | **쓰기**(청크 7파일) | `보드 97장` |
| scripts 테스트 | `backend/.venv/Scripts/python.exe -m pytest scripts/tests -q` | 읽기 | 실패 0 (G5a 체크포인트 실측 **265**) |
| app 단위 | `cd app && npm run test:unit` | 읽기 | 실패 0 (G4 실측 2,101 · G5a Codex 마지막 실측 **2,105** · 이 문서 갱신 시 전체 스위트 미재실행, glyph/parity 54/54) |
| backend 카드표면 | `cd backend && uv run pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/api/test_canvas_push.py tests/unit/test_canvas_data_parity.py -q` | 읽기 | 실패 0 (16:11 측정 158) |
| backend 전수 | `cd backend && uv run pytest tests -q` (≈25분) | 읽기 | 16:1x 측정 2,762 pass · 기존 WIP RED 1 · skip 5 |
| 4단계 캡처 + 5단 기하 | `cd app && npm run verify:integrated-cards` | **쓰기**(`app/captures/integrated-cards/`) | **G5a 정본 리포트**(2026-09-04 07:49:35 KST, `generated_at` 2026-09-03T22:49:35.105Z): `readability_gate` enforced·canonical, 6보드·24 PNG·12 probe·36 측정 전부 `atomic_wrap_total`/`text_overlap_total`/`paired_semantics_total` 0, `max_overflow_x` 0, `capture_hygiene` 24/24/24, `totals.missing` 0. PNG LastWriteTime ~07:50 KST. 13BC-2 6측정 동일 0. 진단(07:47:24 KST, canonical false)도 6보드 36측정 0. **08:19 KST 정본 재실행도 exit 0**(24캡처·36측정 0·위생 24/24/24)이지만 같은 24장에 §6 3번 `2QFO-2` 960 열 밀림이 그대로 있다 — 자동 0을 육안 PASS로 쓰지 말 것. **부하 민감**: Paper Desktop이 카드 페이지(31k 노드)를 렌더 중이거나 이전 실행 electron.exe 좀비가 남으면 rAF 기아로 `paint ack wall-clock timeout`/`layout did not stabilize`가 난다(08:0x 5회 재현, 부하 제거만으로 초록). 실행 전 `taskkill //F //IM electron.exe` + Paper를 증명 페이지 `F-1`로 전환. `backgroundThrottling: false` 추가는 A/B 실측에서 오히려 악화 — 금지. `ATHENA_VERIFY_BOARD_IDS`를 주면 진단 모드로 `captures/integrated-cards/diagnostic/`에만 쓰고 정본 파일을 건드리지 않는다 |

인터프리터: 추출·검증·scripts 테스트는 `backend/.venv/Scripts/python.exe`, 백엔드 코드는 `uv run`, 커버리지·빌더는 시스템 `python`(의존성 없음). `.omc/`는 git 무시. 저장된 Workflow 스크립트의 LF·프롬프트 제약은 최초 실행의 역사적 기록일 뿐이며 현재 워크플로를 재실행하는 지침이 아니다.

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

- 커버리지 판은 로더에 위임한다(예전 67.8%는 alt_mappings·indexed를 모르던 계산이었고 D3에서 고쳤다). semantic authority 후보는 3,534개로 보존하며, 카드 표면 coverage의 유일한 분모는 `coverage().visible_total`=3,532다. 예비 `base:04|$.data[].924|1`·`951|1`만 visible universe에서 제외하고 hidden authority와 `base:1h/1279` 등은 불변이다.
- 레일 블록 계수는 A5에서 고쳤다(호가 보드 13→2~4). 남은 것은 소프트 경고(레일 행 7~11, 19장)뿐이며 보드 재설계 대상이 아니다.
- `rows_max` 하드 예산은 22(표 본문 20 + 합계 2), 레일 블록·KPI는 소프트. 구현 계획 문서의 밀도 줄은 2026-09-03에 로더 값으로 정정했다.
- 레거시 `card-kind-*.js` 16개는 `app/shell.html`이 로드하는 **기존 CC 카드 경로**(호가 사다리·AITS 차트)다. 보드 표면과는 별개(보드 96장 중 `primary.renderer` 비-null은 32S7-0의 `athena-chart` 하나). 기존 카드 회귀를 막기 위해 삭제 금지.
- 인라인 width가 컨테이너 쿼리를 이기므로 반응형은 `--bs-*` 변수로 hoist해서 푼다. `!important` 0.
- 보드 카드의 통합 카드 크롬(제목 줄·요약 칩·"전체 원본 필드 ▸")은 **제거 완료**(C5). 회귀 감시 대상.
- "제외 보드"는 두 뜻이다: 로더 `excluded_boards`(현재 0, 해소 대상)와 커버리지 판의 모수 밖 2장(17F8-2·fixture-quote, 영구).

---

## 11. 갱신 이력
- 2026-09-04 08:0x KST — G5a 문서 정합. README 🟠·PROMPT 블록 B·§7 캡처 행이 아직 G5a WIP/미실행으로 남아 있어, 측정된 정본 리포트(`00666f5` 직후 `generated_at` 2026-09-03T22:49:35.105Z = 07:49:35 KST)와 맞췄다. G5a 자동 게이트 닫힘. G5b 육안 pending. 자동 0을 육안 PASS로 쓰지 말 것.
- 2026-09-04 07:52 KST — G5a 코드 마감 `00666f5`. probe 스코핑으로 2SKU-1 예탁/표 거짓양성 제거. 진단 리포트 07:47:24 KST·정본 리포트 07:49:35 KST 완결, 36측정 atomic/overlap/paired 0·overflow 0·13BC-2 대조군 깨끗. glyph/parity 54/54. G5b 육안 Paper 재승인 pending. 동시 세션의 2SKU atomic 확대·scroll-table cell `min-width:max-content` 시도는 되돌림(overflow/atomic 거짓실패).

- 2026-09-03 09:5x — 최초 작성(W2-C 게이트 수치). 저작 팩·워크플로 스크립트·진행 로그를 저장소로 복사. `validate_board_slots.py` 팩 경로 저장소 상대화 + 팩 폴더 부재 시 즉시 실패.
- 2026-09-03 10:3x — 구현 계획 밀도 줄 정정. 청크 드리프트 검사는 빌더 `--check`로 이미 존재(§7 등록). 브랜치는 키우미 대화가 먼저 만들어 origin에 올렸고, 이 대화의 스냅샷 e267c32가 그 위에 얹힘(푸시는 C5 레인의 일시 RED 1건이 풀리면).
- 2026-09-03 10:2x — 검증 워크플로(경로·수치·반증·새 세션 시뮬레이션 4레인) 반영: W3 정비 4레인 완료 상태로 정정(로더 96/제외 0, 커버리지 3,379/3,534, 크롬 제거 완료), 분모 3,534 통일, §6에 🔒 표기, §7에 쓰기 여부·게이트 읽기 스니펫, §8 Paper 전제·fileId 경고. 미커밋 `git status --short`: M 19 · ?? 50. 사용자 지시로 지속 커밋·푸시 시작(브랜치 `feat/card-surface-paper-to-code`).
- 2026-09-03 11:15 — Claude Desktop 이력과 `wf_622eeae9-f84.json` 직접 대조. 최상위 `completed`와 달리 정비 A5/B4/C5/D3만 완료, 저작 8레인과 게이트는 주간 한도 오류(게이트 tool call 0). C5의 실보드 캡처 24장·P5 통과·최대 overflow 25px 확인, 앱 단위 2,035/0 재검증. 실행 중 표기를 제거하고 재개 순서를 저작→게이트로 정정.
- 2026-09-03 11:45 — 별도 C5 리뷰에서 전역 KPI 160px 바닥·미측정 XL/M·surface overflow 미판정 발견. 실패 재현 후 최소폭을 값 있는 탄력 KPI에만 한정, `Chart Context Actions` absolute left+폭만 좁은 단계에서 양쪽 inset으로 전환(툴팁·차트 핸들 제외), surface overflow를 하드 실패로 변경. 기본 6장 24캡처+12 프로브 및 위험 표본 3장(8/6 KPI) 모두 overflow 0·P5 통과, 앱 2,039/0. 저작 레인은 12~19개 탐색 명령 후 오류·순변경 0으로 표현 정정.
- 2026-09-03 12:07 — C5 독립 재리뷰의 잔여 2건을 1차 보강. 반응형 단계에서 고정 높이 hoist의 세로 내용 넘침·형제 겹침을 하드 실패로 만들고, XL/M 프로브가 접힘·KPI 행/열·primary/rail 상대 위치를 계약과 대조하도록 보강. 빈·중복·미등록 `ATHENA_VERIFY_BOARD_IDS`도 main 진입 시 즉시 실패. 기본 6장 24캡처+12 프로브 재생성 결과 surface overflow 0, P5·텍스트 상등 통과; KPI 행 계측의 false-negative는 12:17 재리뷰에서 발견·교정.
- 2026-09-03 12:17 — 재리뷰가 높이가 다른 KPI 셀을 `top` 동일성으로 세어 3+2를 1+2+2로 오판하는 false-negative를 발견. 세로 구간 겹침 기반 순수 행 계산기와 4열 음성 테스트를 추가해 `2R3M-1` M 결과가 `[[3,2]]`·최대 3열로 교정됨. 기본 6장 24캡처+12 프로브 재통과, 앱 2,042/0. 문서의 세로 0 범위를 L/M/S/XS로 명시하고 XL Paper 원문 2px는 기록·게이트 제외로 정정.
- 2026-09-03 12:52 — 재개 저작 `account-a` 리뷰·수정 완료. 최초 21건 감소 중 금액→shares 오매핑 12건과 의미 불일치 2건을 독립 리뷰가 발견. `c52a446`에서 거짓 매핑을 제거하고 account 필드 2건을 정확한 `2SKU-1` 슬롯으로 이동해 안전한 순증가 9건(coverage 3,388/3,534, 미도달 146, op 297/299), validator 37건/21장. `3GRO-0`에 6구간 금액 잎이 없어 12건·2 op는 Paper 표면 저작 전까지 명시적 blocker.
- 2026-09-03 15:29 — W3 Tasks 1–8 독립 실행·리뷰 수정 완료. 예비 `base:04` 924/951만 card-surface universe에서 제외해 모수 3,534→3,532. 공유 트리 실측 coverage 3,382/3,532, 미도달 150, op 297/299, validator 59건(`b15 e44`)/27장. exact-leaf/composite/aspect/join/realtime gap은 거짓 alt로 닫지 않았다. systemic `extra_fields` audit는 스키마 불충분으로 `STOP_NO_CHANGES`; 사용자 schema 승인 및 대표 JSON migration 대기. final W3 gate 미실행.
- 2026-09-03 16:11 — 추출기의 authored `kind` 덮어쓰기와 merge 전 count 계산을 RED→GREEN 회귀로 수정하고 96장 canonical 재생성. authored 의미 손실 0, 추출 `--check` 멱등, validator 59·coverage 3,382/3,532 유지, 청크 97장/6개 최신. scripts 241·backend 카드표면 158·app 2,042 통과, backend 전수는 기존 WIP 1건 외 2,762 통과. 통합 자동 수치는 6장/24 PNG/12 probe·overflow 0이지만 육안 전수에서 5보드의 문자 분절·행 텍스트 충돌을 발견해 final W3 시각 gate FAIL. explicit responsive role/atomic/paired 계약과 glyph hard gate 설계 승인 대기.
- 2026-09-03 19:0x~23:5x — 적응형 가독성 웨이브 G1–G3 실행·독립 리뷰·푸시. `4e4a800` 비행동 responsive manifest + report-only glyph 검출기(5보드 RED, 13BC-2 무소견), `9c11c05` manifest 기반 atomic/flow/scroll/progress 동작과 스크롤 소유자 접근성, `9c07c1b` 대상 표 2개(`2SKU-1/39SW-0`·`13K0-2/33WD-0`)의 opt-in 처리. G3 접근성 리뷰가 두 표를 paired-table에서 **scroll-table**로 바꿨고(14:56Z 스티어링에 기록) 그 결과 생산에 paired 미러가 하나도 남지 않았다.
- 2026-09-04 — G4 정본 자동 게이트 완주. 하드 가독성 어서션을 `enforce: true`로 켜고 캡처 위생 모듈을 붙였다: 정본 실행이 과거 표본 12장(`15P5-2`·`2QX1-1`·`3DZ1-0`)을 정확히 정리하고 24 파일/해시/치수를 검증하며, `ATHENA_VERIFY_BOARD_IDS`를 주면 진단 모드가 정본 파일을 건드리지 않는다. 게이트 결과: 추출 96/96 드리프트 0·멱등, validator `59 (b15 e44)`/27, strict 3,382/3,532·미도달 150·op 297/299, 청크 97장/6개, scripts 264, app 2,101, backend 카드표면 158, 정본 캡처 exit 0(36 측정 전부 0), `git diff --check` 0, zoom·전역 nowrap·placeholder·skip 위반 0. **그러나 같은 24장 육안 전수는 여전히 FAIL이다** — 13K0-2(480·640·960)와 2R3M-1(480·960). 96장 전수 실측으로 게이트 사각지대도 확인했다: `bs-paired` 68장·`bs-paired-label` 0장·`data-paired-source` 0장이므로 `paired_semantics_violations`는 생산에서 **공허 참**이고, `atomic_wrap_nodes`는 선언된 소유자만 measure한다. 잔여 결함 3종과 수정 대상 노드는 §6 1–2번에 확정 기록. 나머지 66장의 무라벨 접기는 범위 밖 blocker로 기록. 백엔드 커버리지·composite `STOP_NO_CHANGES`는 무변경. backend 전수 재실행도 2,762 pass / 1 fail / 5 skip으로 기준선과 일치하며, 그 1건은 문서화된 기존 RED `test_view_identity_canonicalizes_signed_scope_task_target_query_and_account` 하나뿐이라 신규 실패는 0이다.
- 2026-09-04 07:2x KST — G5a 가독성 수정 WIP 체크포인트. G5 육안 FAIL을 보존한 채 대상 3결함 주석·3CRW-0 paired-table·glyph/legacy-pair 검출기를 커밋한다. 비-Electron 실측 scripts 265 pass, glyph/parity 54/54. 전체 app 단위는 Codex 마지막 실측 2,105(이 문서 갱신 시 전체 스위트 미재실행, pre-push가 돈다). 정본 Electron 캡처·육안 대조·G5b는 남음. 13BC-2 대조군과 나머지 66장 무라벨 접기는 범위 밖 유지. coverage/validator/`STOP_NO_CHANGES` 무변경.
- 2026-09-04 G5b — Paper 육안 재승인 실행, **승인하지 않음(loop-back)**. Paper Desktop `Athena`/`카드`(fileId `01M0VGPX92K1TER4ZV9PWGQJJZ`)를 MCP 읽기 전용으로 대조했다(`paper.jsx` 무변경). 보드×폭 11칸 중 10 PASS·1 FAIL. **해소 확인:** 결함 A — 13K0-2 480/640/960에서 `● 실시간 갱신`·`100개 결과`·`세션`·`정규장`·`시간외 단일가`가 모두 한 줄이고 폭이 모자라면 글자를 쪼개는 대신 후행 그룹이 다음 줄로 이동한다; 2R3M-1 480에서 `삼성전자`·`정규장`·`실시간` 온전. 결함 C — 2R3M-1 960의 `3CRW-0`이 접힌 값을 `구분 매수체결`·`구분 KRX`·`체결강도 108.4%`로 Paper 헤더 라벨과 함께 내보내 무라벨 연결 `150,850매수체결KRX118.1%`와 헤더 뭉침 `체결가구분체결강도`가 사라졌다. 대조군 13BC-2는 480·960 무변화. **미해소(블로커):** 결함 B의 금액 토큰 `+3,214억원`은 붙었으나, 같은 보드 `2QFO-2` 960px의 `투자자별 순매수` 표에서 상위 3행의 값이 헤더 열과 어긋난다 — Paper는 6열 한 줄인데 앱은 매도 칸이 비고 값이 한 레인씩 밀리며 `44.0%`·`+3,214억원`이 라벨 없이 셋째 줄로 내려간다. `은행` 이하 행과 1920 XL은 정상이라 XL 파리티는 유지된다. 세 하드 판정은 글자 분절·박스 겹침·opt-in 미러 라벨만 보므로 **열-헤더 대응 위반을 원리적으로 못 잡는다**. 다음 착수점(선택지 3개와 새 열-헤더 판정)은 §6 3번, 증거는 `.omx/artifacts/card-surface-adaptive-readability/20260903T100241Z/36-g5b-paper-visual-audit.md`와 `35-g5b-visual-evidence/`. 코드 변경 없음 — 이번 커밋은 감사 기록만이다. 백엔드 커버리지·validator·`STOP_NO_CHANGES`는 무변경.
- 2026-09-04 08:4x KST — G5b loop-back 독립 재검증(별도 세션). 정본 24장을 08:19 KST에 재생성(exit 0, 36측정 0, 위생 24/24/24)하고 Paper Desktop 직결 HTTP(127.0.0.1:29979)로 뽑은 정본 6장과 전수 육안 대조했다. 결함 A(13K0-2 480/640·2R3M-1 480 분절 소멸)·C(2R3M-1 960 라벨 사본) 해소와 13BC-2 4폭 무결은 위 감사와 일치. **`2QFO-2` 960 상위 3행 열 밀림은 08:19 정본 Electron 캡처에서도 재현** — 외국인 행의 `2,366억원`이 매수 레인, `4,208억원`이 순매수 레인에 그려지고 `44.0%`·`+3,214억원`이 무라벨 둘째 줄로 내려간다. 위 감사의 추정 원인(결함 B nowrap이 5일 누적 열 최소 폭을 키움)과 정합. 이 세션은 처음에 라벨 접기로 오독해 PASS로 기록했다가 열-헤더 대응 기준으로 철회했다(로컬 커밋 폐기, 원격 이력 무영향). 검증 실행의 부하 민감성(§7 캡처 행)도 이 세션 실측이다. 코드 변경 0, 문서만 갱신. G5b는 loop-back 유지 — 다음 착수는 §6 3번.
