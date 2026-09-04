# 작업 계획 — 키우미 미니 카드 전수 (대화 모드의 축소판)

> **실행 개정(2026-09-03).** 사용자가 후속으로 **360×420**을 확정하고 실제 코드 반영을
> 승인했다. 이 rev 6 계획은 최초 360×640 Paper 저작안의 역사적 근거로만 보존한다.
> `pending approval`, 640px 게이트, 앱 코드 동결, 옛 브랜치 생성 절차는 다시 실행하지
> 않는다. 현재 구현·검증·다른 컴퓨터 인계의 정본은 `codex/kiumi-mini-cards-runtime`
> 브랜치와 `backend/ref/kiumi/kiumi-ledger.jsonl`이다.

```yaml
plan_id: kiumi-mini-cards-20260903
revision: 6                       # rev 5 draft + 최종 Architect/Critic 패스 반영 (§9 Changelog)
status: pending approval          # 사용자 승인 전까지 실행 금지
execution: ralph (pre-authorized by user 2026-09-03)
consensus_reached: false          # Critic 이 반복 상한 안에서 승인하지 않았다 — §0 참조
mode: RALPLAN-DR / SHORT (consensus --direct)
source_spec: .omc/specs/deep-interview-kiumi-mini-cards.md   # ambiguity 19.5%, PASSED
branch: kiumi/mini-cards          # main 에서 새로 딴다. 모든 저장소 변경은 이 브랜치에서만 (Step 0)
target_boards: 96                 # D1 확정 (A 계열 4장 포함). W3 전 확정, Paper 쓰기 후 비가역
excluded_boards: enumerated       # D1-a — 수("8장") 사용 금지. Step 0c 프로브의 열거만 정본
scope_lock: 스펙 ①②③ only — Non-Goals(L49-55) 밖으로 넓히지 않는다

paper_file: Athena (01M0VGPX92K1TER4ZV9PWGQJJZ)
paper_pages:
  cards: "5-1 (읽기 전용 — 무결성 계측 대상)"
  kiumi: "C-2 (유일한 쓰기 대상)"
  screen: "1-0 (무관)"
  proof:  "F-1 (무관)"

immutable:
  - backend/ref/card-surface-templates/**/board.html
  - backend/ref/card-surface-templates/index.json
  - paper.jsx
  - "Paper 카드 페이지 5-1 전체 (2SCE-1 포함 — 읽기만)"
  - "Paper 키우미 보드 05 (5EU-0)"
  - "Paper 키우미 보드 01~08 (frozen_boards)"
  - "app/lib/orb-mini-card.js — LIMITS(:22-29) 및 렌더 동작 전부 (D3)"
  - "scripts/validate_board_slots.py · scripts/paper_board_extract.py · scripts/build_board_registry.py (import 만, 수정 금지)"

baseline_validation_problems:
  load_registry: { problem_keys: 225, problem_boards: 62, subset_of_targets: true }
  load_registry_breakdown: { occurrence: 205, density.rail_blocks: 12, density.rows_max: 3,
                             state.parent_board: 3, density.kpi_cells: 2 }
  validate_board_slots: { exit: 1, problems: 1615, problem_boards: 85,
                          tally: { b: 360, c: 20, d: 67, e: 1158, f: 9, g: 1 },
                          note: "85 에는 대상 밖 fixture-quote 포함 (index.json 미등록)" }
  production_effect: "get_registry() 가 예외를 삼키고 빈 레지스트리를 돌려준다 — 현재 보드 표면 없이 동작 (FU-3)"
```

---

## 0. 이 문서의 상태 — 합의 미달 (consensus_reached: false)

이 계획은 RALPLAN-DR 합의 절차의 **Critic 승인을 받지 못한 채** 최선본으로 확정된 것이다. 네 번의 반복에서 Architect·Critic 모두 매번 `REVISE` 를 냈고, 반복 상한에 도달했다.

**정직한 요약**: 네 리비전 동안 발견된 결함의 대부분은 **산출물의 결함이 아니라 게이트 자신의 결함**이었다 — "처음 실행되는 날 구성상 통과할 수 없는 차단 게이트". rev 5 가 §3.1 게이트 2계층화로 그 계통을 구조적으로 막았고, rev 6(이 문서)이 마지막 패스의 지적 **전부**를 반영했다. 그럼에도 이 문서는 다섯 번째 검토를 받지 않았으므로, **실행 시작 전 사용자 승인이 필수**이며 아래 두 가지를 특히 확인해야 한다.

1. **G11-6(23장 PDF 사용자 승인)** 은 헌장 §6.2(전 보드 PDF)로부터의 **의도적 이탈**이다 — 별도 동의 문장 2개를 요구한다(§6 G11-6).
2. **W3 는 비가역이다** — 96장 Paper 쓰기 후에는 범위 축소가 불가능하다(D1). CP-1 세 조건과 배치 경계 4회 검사가 그 전에 놓인 마지막 방어선이다.

**남은 미검증 사항**: Paper 측 사실(보드 09 `2LFW-2` · 보드 05 `5EU-0` 의 노드 id)은 계획 단계 규칙상 Paper 도구를 쓸 수 없어 `.omc/state/deep-interview-state.kiumi-mini-cards-20260903.json:201,236` 을 통한 **간접 확인**이다. Step 0d 가 실행 시점에 직접 확인한다.

---

## 1. Requirements Summary

스펙 `.omc/specs/deep-interview-kiumi-mini-cards.md` 를 요구 정본으로 삼는다.

| 출처 | 내용 | 계획 반영 |
|---|---|---|
| Goal (L33-34) | 키우미는 **오직 대화 모드의 축소판**. 확정 카드마다 "미리 정의·고정한 표시 부분"을 미니 문법 10종 중 하나로 그려 Paper 키우미 페이지에 1:1 배치하고, 그 정의를 Paper 주석 + `slots.json` `kiumi` 두 곳에 기록 | 3개 산출 레인 (Paper 미니 / kiumi 필드 / 대응 보드) |
| Constraints (L36-47) | 360×640 고정·스크롤 없음 · 문법 10종 안에서만 · 새 렌더러 0 · 640 기준 상한 재정의 · 공통 규칙 5개 유지 · 고정 리드 · 원본 이름 그대로 · 문구 3원칙 · 값 출처는 원본 보드 | §3 AC, §4 Step 0~6 |
| **L41 (핵심)** | "카드별로 다른 것은 **표시 부분(리드 내용)만**이다" | **디자인 품질을 보드 96장이 아니라 문법 10종 템플릿에서 산다** — W2g 디자이너 레인 |
| Non-Goals (L49-55) | 타 모드 연동 · 키우미 전용 호출 경로 · 가변 리드 · 보드 05 규칙 변경 · **오브 렌더러가 kiumi 를 읽게 하는 앱 코드 변경** · 확정 카드 자체 수정 | §4.0 Guardrails, D3, FU-2 |
| AC-1~AC-16 (L57-78) | ① 전수(1~9) ② 표시 부분 정의(10~13) ③ 대응 보드(14~16) | §3 에서 전부 계승 + 기계검증 가능한 형태로 재기술 |
| 남은 가정 (L95-98) | (a) 1:1 대상 범위 (b) 대응 보드 예시 카드 (c) 상한 기록 위치 | §4.1 D1·D2·D3 **전부 확정** |
| Technical Context (L100-107) | Paper 파일/페이지, 오브 창, 연동 경로, 캔버스 피드, 확정 카드 템플릿, 표준 문서, 토큰 | §4 파일 참조 |

### 1.1 스펙 검증 중 발견한 사실 정정 (계획에 반영됨)

| 항목 | 스펙 L96 기술 | 실측 | 근거 |
|---|---|---|---|
| 템플릿 등록 보드 수 | 96 | **96** ✅ | `backend/ref/card-surface-templates/index.json` `boards` 길이 96 |
| CC 계열 | "92장 (CC-01 14·02 6·03 31·04 6·05 14·06 21)" | **`card_id` 기준 96장** = CC-01 14 · CC-02 6 · CC-03 31 · CC-04 **9** · CC-05 **15** · CC-06 21 | index.json `card_id` 집계 |
| 차이의 정체 | "비CC 12장에는 slots.json 이 없다" | **A 계열 4장이 CC card_id 로 등록되어 있다** — `1JPU-0`(A04, CC-04) · `1JZW-0`(A02×A04, CC-04) · `1WOB-1`(A05, CC-05) · `3N4O-0`(A04-X, CC-04) | index.json `name`/`card_id` 대조 |
| slots.json 결손 | — | **0건**. 등록 96보드 전부 보유 | 디렉터리 97개 = 96보드 + `fixture-quote`(비등록) |
| 상태 분포 | 언급 없음 | default 13 · tab 31 · sort 32 · expand 20 | index.json `state.kind` 집계 |
| CC-03 내부 분포 | 언급 없음 | **default 3 · tab 8 · sort 15 · expand 5** | W2c=11 · W2d=20 의 근거 |
| 템플릿 트리 git 상태 | 언급 없음 | **전체 untracked** | `git status --porcelain backend/ref/card-surface-templates/` → 1행 |

→ 스펙의 "92"는 **이름 접두사** 기준, 레지스트리의 "96"은 **`card_id`** 기준이다. 둘의 차이는 정확히 위 A 계열 4장이며 **D1 이 이것을 96 으로 확정**한다(D1-b 가 스펙 L96 의 가정을 명시적으로 무효화한다).

---

## 2. RALPLAN-DR Summary

### 2.1 Principles (5)

1. **정의가 먼저, 그림은 그 다음.** 표시 부분은 "그림에서 읽어낸 것"이 아니라 "기록에서 그린 것"이어야 한다. AC-10·AC-11(Paper 주석 ≡ `kiumi` 필드)은 **대조로 맞추는 것이 아니라 단일 출처로 만들어 성립시킨다**.

2. **크래프트는 96장이 아니라 10종에서 산다.** 스펙 L41 이 "카드별로 다른 것은 표시 부분만"이라고 못박았으므로 사람의 디자인 노동은 **문법 10종 템플릿**에 집중하고 96장은 승인된 템플릿을 찍는다. 단 **"층에서 산 크래프트가 96장에 전파됐다"는 가정이지 사실이 아니므로**, 승인 **전**에 표본 12장을 실제로 렌더해 전제를 실증하고(G11-6b), W3 를 24장×4배치로 쪼개 96장 전부를 컨택트시트로 관찰한다(G11-6c).

3. **값은 지어내지 않는다.** 공통 규칙 1(`app/lib/orb-mini-card.js:15`). 미니에 적히는 모든 값은 **원본 슬롯 하나에 귀속**되며, 이것은 취향이 아니라 기계로 검증되는 **슬롯 정체성**이다(AC-K5). 문자열 포함 검사가 아니다.
   > **값의 정본**: 이 계획은 스펙 AC-4(L62)의 "원본 보드에 존재하는 값"을 **추출 트리의 `slots[].paper_text`** 로 읽는다. **라이브 Paper 아트보드와의 전수 동일성은 이번 범위에서 증명하지 않는다** — 96장 중 62장이 자기 검증기에 실패 중인 상태이므로 이 간극은 실재한다(§5 R-11). Step 3′b-3 이 `2SCE-1` 한 장으로 그 간극에 처음으로 수치를 붙인다.

4. **결정론 우선, 재량은 명시적으로.** 문법 배정은 규칙이 제안하고 사람이 비준한다. 규칙과 다른 배정은 반드시 `override_reason` 을 남긴다 — 96장을 눈대중으로 고르면 감사할 수 없다.

5. **기존 표면을 건드리지 않고, 건드리지 않았음을 차등·귀속으로 증명한다.** 확정 카드 보드·`board.html`·`paper.jsx`·보드 05·오브 렌더러 동작은 범위 밖(스펙 L54-55)이며 추가는 **덧붙이기(additive)** 로만 한다. 트리는 이번 작업과 무관한 사유로 이미 검증 실패 상태이므로, 게이트는 "통과하는가"가 아니라 **"대상 보드에 귀속되는 새 문제가 0인가"** 다.
   > **분해능 한계 (실측)**: (a) 레지스트리 신호로는 외부 변경을 분리할 수 없다 — 225 문제 세그먼트 **전부**가 board_id 를 달고 있고 문제 보드 62장은 대상 96장의 **진부분집합**이다(`problem_boards − targets == ∅`). AC-K2 의 `--foreign` 분리는 공집합이고, 외부 편집 탐지의 실질은 **AC-K3 파일 해시**가 진다. (b) 저장소 측 노출은 작다 — 동시 레인 워크트리 `C:/Projects/DAOU.Athena-plugin` 에 `backend/ref/card-surface-templates/` 가 **존재하지 않는다**. (c) 반면 **Paper 파일은 워크트리와 무관하게 공유**되어 완전 노출이다 — §5 R-5 가 그대로 남는 이유다.

### 2.2 Decision Drivers (top 3)

| # | Driver | 왜 이것이 결정을 가르는가 | 근거 |
|---|---|---|---|
| **DD-1** | **주석↔필드 동일성을 어떻게 보증하는가** | AC-10·AC-11 은 "Paper 주석과 `kiumi` 내용이 같다"를 요구한다. 두 곳에 각각 저작하면 96×2 = 192개 저작물의 수동 대조가 되고 드리프트가 필연이다. 한 출처에서 둘 다 **생성**하면 동일성이 구성상 참이 된다 | 스펙 L70-71 |
| **DD-2** | **96장의 문법 배정을 무엇이 정하는가** | 스펙은 "동일 호출 로직"(L38)을 상수로 못박았다. 배정 근거가 디자이너 재량이면 이 제약과 충돌하고 재현·감사가 불가능하다. 단 조사 결과 **단일 신호로는 불충분**함이 확인됐다(§4.3) | 스펙 L38, L44 |
| **DD-3** | **640 상한 재정의가 앱 코드를 건드리는가** | AC-8 은 상한 재정의를 요구하고(L66), Non-Goal 은 오브 렌더러 앱 코드 변경을 금한다(L54). `app/lib/orb-mini-card.js:21` 주석이 "숫자를 바꾸면 보드 09의 상한표도 같이 바꿔야 한다"고 **양방향 동기화를 계약으로 선언**한다. **사용자 결정: 코드 동결, 보드 09만 갱신, 괴리는 명시적 이월**(D3) | `app/lib/orb-mini-card.js:21-29`, 스펙 L54·L66 |

### 2.3 Viable Options

#### Option A — Paper 우선 저작 (per-board 디자이너 웨이브 → 사후 필드 기록)
96장을 문법 템플릿 10종으로 `write_html` 하며 보드 단위로 저작하고, 완료 후 스크립트가 Paper 주석을 파싱해 `kiumi` 필드를 채운다.
- **Pros**: 2026-09-02 카드 캠페인에서 검증된 작업 방식 그대로 · 보드별 판단 여지가 커 품질 상한이 높다 · Paper 결과가 즉시 눈에 보인다.
- **Cons**: DD-1 을 정면으로 놓친다(저작 표면 96×2) · 96장 저작 후에야 필드가 생겨 백엔드 레인이 끝까지 블록된다 · 병렬 Paper 세션이 다수 필요해 R-5 **동시성** 노출이 최대.

#### Option B — 완전 스크립트 생성 (slots.json → kiumi + Paper 아트보드 자동 생성)
디자이너 패스 없이 구조 규칙만으로 문법·요소를 도출해 96장을 찍는다.
- **Pros**: DD-1 완전 해결 · 재생성 멱등 · 가장 빠르고 값싸다 · 감사 100%.
- **Cons**: **DD-2 에서 좌초한다** — 순수 구조 규칙은 compound 50 / table 28 / facts 12 로 쏠리며 chart 를 한 장도 만들지 못한다(실측) · 문구 3원칙과 리드→그룹→게이트 계층은 기계가 판정할 수 없다 · **헌장 §6.3 6번(마일스톤 PDF 사용자 승인, `docs/ui/paper-card-surface-charter.md:172`)을 통과할 근거가 없다** — 사람이 그림을 한 번도 보지 않는다.

#### Option C — 대장(ledger) 선행 · 템플릿 층에서 디자인 · 양쪽 생성 ✅ **채택**
1. **(C1) 대장 저작** — 스크립트가 96보드의 문법·요소·접은 개수를 제안해 리뷰 가능한 대장(`backend/ref/kiumi/kiumi-ledger.jsonl`)을 만들고, 6 병렬 리뷰어가 **대장만** 비준·수정한다(그림 아님, 표).
2. **(C1′) 템플릿 디자인** — C1 과 **병렬로**, 디자이너가 문법 10종 템플릿 + 대표 보드 1장 + 표본 12장을 그리고, **23장 PDF 가 헌장 §6.3 6번 사용자 승인 게이트**를 통과해야 다음 단계로 간다.
3. **(C2) 양쪽 생성** — 비준된 대장 + 승인된 템플릿에서 `slots.json.kiumi` 와 Paper 아트보드 + 출처 주석을 **둘 다 생성**한다. 96장은 **24장 × 4배치**로 쓰고 배치 경계마다 재스냅샷 + 컨택트시트.
4. **(C3) 게이트** — 카드 게이트를 미니에 적용, 실패분은 대장으로 되돌려 고친다.

- **Pros**: DD-1 이 **구성상 참** · DD-2 를 규칙 제안 + 사람 비준 + `override_reason` 으로 해소 · 디자인 품질 게이트가 살아 있다 · 백엔드 레인이 C1 직후 시작 가능 · 재생성 멱등.
- **Cons**: 중간 산출물(대장 스키마 + 생성기 + 템플릿 11장)의 선행 비용 · 템플릿 승인이 W3 의 하드 블로커가 되어 일정이 사용자 응답에 묶인다(단 이것이 헌장이 요구하는 형태다).

### 2.4 Recommendation & Invalidation

**Option C 를 채택한다.**

**A 무효화 사유 (rev 6 재앵커 — Critic 개선).**
1. **[주 논거] 저작 표면이 96×2 로 늘어난다.** A는 주석 96개와 필드 96개를 **각각** 저작한다. 구조화 주석은 *파싱*을 쉽게 만들 뿐 *두 저작물이 같다*는 것을 보장하지 않는다 — AC-10·AC-11 은 여전히 96회 대조로 남는다. C는 두 산출물을 **한 레코드에서 렌더**하므로 동일성이 파싱 성공 여부와 무관하게 구성상 참이다. §2.4 표의 세 가지 측정된 이점이 이 논거를 뒷받침한다.
2. **[부분 논거 — 정직하게 부분이다] R-5 노출.** A는 병렬 Paper 세션이 다수 필요하고 Paper 파일은 워크트리와 무관하게 공유되므로 브랜치가 보호하지 못한다. C는 쓰기를 단일 직렬 레인(W2g → W3 → W4)으로 좁혀 **동시성** 노출을 최소화한다. **그러나 이것은 절반의 논거다** — 레인을 하나로 좁히는 것은 동시 쓰기를 없애지만 **쓰기 구간의 길이는 오히려 늘린다**. C 는 그 대가를 CP-1(비가역 구간 진입 전 탐지) + 4배치(탐지 지연을 96장 뒤에서 24장 뒤로)로 치른다. 옵션 선택 자체는 논거 1 로 결정된다.

*(A의 장점인 per-board 크래프트는 C1′ 템플릿 층 + G11-6b 표본 12장 + G11-6c 배치 컨택트시트 + C3 카드 게이트로 보존된다.)*

**B 무효화 사유**: 두 겹으로 반증됐다. (1) DD-2 — 자동 도출만으로는 `137X-2` 를 chart 로 배정하지 못하고 10종 중 5종만 쓰인다. (2) **헌장 §6.3 6번 위반** — 사람이 그림을 보는 단계가 아예 없다. B는 C1 의 **제안 단계**로 흡수된다.

**반론 1 (Skeptic): "대장 없이 `kiumi` 필드만 저작하면 되지 않는가."** 타당하며 **부분 채택**한다 — 그것이 정확히 C 가 하는 일이고, 차이는 **저장 위치 하나**뿐이다. 대장을 별도 파일로 두는 이유는 세 가지 **측정된** 이점에 한정된다.

| 이유 | 근거 |
|---|---|
| 비준이 96파일 diff 가 아니라 96행 diff 가 된다 | `slots.json` 은 보드당 **21~24개 최상위 키**(21키 27장 · 22키 57장 · 23키 9장 · 24키 3장)에 **최대 417 슬롯**(`2VIN-0`; 최소 71 `32S7-0`)까지 담는다 |
| 재생성이 멱등이고 트리를 오염시키지 않는다 | 대장 → (필드, 주석) 단방향. 실패 시 트리를 되돌리지 않고 대장만 고쳐 다시 찍는다 |
| 트리가 untracked 라 대장이 **유일한 커밋되는 정본**이다 | `backend/ref/card-surface-templates/` 전체 untracked. `backend/ref/kiumi/**` 는 새 경로라 커밋된다 |

**반론 2 (Architect 안티테제): "게이트 격자가 자기 무게로 무너진다 — C 를 3분의 1로 줄여라."** 관찰(발견된 결함의 대부분이 게이트 자신의 결함이었다)은 **옳고 채택**한다. 처방(삭제)은 **절반만** 채택한다 — AC-K6 을 지우면 사용자에게 **거짓 개수**를 표시하는 경로가 다시 열리고(스펙 L63), AC-7 면제 부기를 지우면 원본 문구 22건 충돌이 무언의 예외로 돌아간다. 두 요구는 스펙에서 온 것이라 계획이 지울 권한이 없다. **채택한 형태는 삭제가 아니라 §3.1 의 2계층화**다 — 진실 게이트는 상시 차단, 부기 게이트는 W3 구간 보고 전용 후 Step 6 차단 승격. 반론의 나머지 절반(컨택트시트에 실질 권한)은 G11-6c 가 채택했다.

---

## 3. Acceptance Criteria

AC-1~AC-16 을 계승하고 각각에 **명령 + 통과 조건**을 붙인다. `N` = 96 (D1 확정).
모든 명령은 저장소 루트에서 실행하며 `PY = backend/.venv/Scripts/python.exe`(검증됨: Python 3.12.10), `EV = backend/ref/kiumi/evidence`.

### 3.0 Paper → Python 인계 산출물

AC-1·AC-2·AC-6·AC-9·AC-9b·AC-15 는 Paper MCP 읽기 결과를 Python 검사기에 넘긴다. 그 중간 산출물의 경로·스키마·생산 시점을 여기서 정본화한다.

- **경로**: `$EV/paper-snapshot.json`(최종 전량) · **`$EV/paper-snapshot-b{1..4}.json`(배치별 부분 스냅샷)**.
- **생산 주체 — 2단** *(rev 6 신설, Critic 블로킹)*:
  - **배치 경계 4회 (Step 4b)**: 그 배치 24장에 대한 **부분 스냅샷**을 채집해 AC-2·AC-9·AC-9b 를 **배치 단위로** 돌린다. rev 5 는 스냅샷 생산을 Step 5c(모든 쓰기 후) 하나로 두면서 §3.1 은 AC-2/9/9b 를 W3 구간 **상시 차단**으로 선언했다 — 96장 비가역 쓰기가 끝나기 전에는 그 게이트를 실행할 **입력이 존재하지 않아** Step 4 Acceptance 가 구성상 만족될 수 없었다(계획이 §3.1 에서 "구조로 막았다"고 선언한 계통의 재발).
  - **Step 5c (전량)**: 모든 Paper 쓰기 종료 후 전량 재채집. 이 파일이 G8·G8b·G9·G10 의 최종 입력이며, 이후 검사는 Paper 없이 재실행된다.
- **스키마** (JSON, 최상위 `{schema_version, captured_at, page_id, batch, nodes[]}`):

```jsonc
{ "node_id": "2SCE-1-K",
  "name": "mini/CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중",
  "role": "mini",                  // name.split("/", 1) — mini|template|probe|correspondence|note
                                   //   (기존 보드 01~09 는 role 이 없는 pre_existing)
  "width": 360, "height": 640,     // get_node_info 실측 정수 px
  "clipping": false,               // overflow:hidden 조상 존재 여부
  "text_nodes": ["보유종목", "평가금액", "..."],
  "annotation_ref": "note/CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중",  // 짝이 되는 note 아트보드 이름
  "annotation_texts": ["원본 보드: …", "가져온 요소: …", "문법: …", "접은 개수: …"],
  "px_height_measured": 640,       // get_computed_styles 실측 아트보드 높이 (붕괴 탐지)
  "content_bbox_height": 612,      // 후손 bbox 합집합 높이 (넘침 탐지)
  "directional_colors": [
    { "source_slot_id": "s041", "sign": "+", "color_raw": "#D92B2B", "color_token": "--color-up" }
  ] }
```

- **요소↔슬롯 귀속 규약** *(rev 6 신설, Critic 블로킹)*: Paper 노드는 슬롯 id 를 갖지 않으므로 **생성기가 방향값 텍스트 노드의 이름을 `v:<source_slot_id>` 로 준다.** 스냅샷은 그 이름에서 `source_slot_id` 를 되읽는다. **노드 이름 규약은 아트보드 role 접두사 규약과 별개이며**(role 은 아트보드에만 적용), AC-1(c) role 파싱 대상이 아니다.
- **주석 블록 귀속 규약** *(rev 6 신설, Critic 블로킹)*: AC-6 이 주석을 아트보드 **밖**에 두라고 요구하므로 주석 블록은 별도 아트보드가 된다. 이름은 **`note/<index.json name>`** 이고 role 표에 96장으로 계상된다. 이것이 없으면 Step 0d 의 페이지 전체 `(node_id, name)` 기준선 대조에서 96건의 "설명되지 않는 증감"이 나와 G8 과 배치 경계 검사가 **구성상 실패**했다.
- **소비 주체**: `scripts/validate_kiumi_field.py --paper …` 전 플래그. 검사기는 Paper MCP 를 직접 호출하지 않는다 — **스냅샷 파일만 읽는다**(재현 가능·오프라인 재실행 가능).
- **`px_variance` 는 스키마에 없다.** 지정 인터프리터에 **Pillow 가 없고**(실측: `find_spec('PIL')` → `None`, numpy 만 존재) 디코더를 추가하면 AC-K8 허용 경로를 벗어난다. 대체 신호는 전부 `get_computed_styles` 로 이미 얻는다 — `px_height_measured` · `len(text_nodes)` · `content_bbox_height`. **신규 의존성 0.**
- **색 토큰 해석 (AC-9b 의 입력)** *(rev 6 신설, Architect 블로킹 6)*: Step 0d 가 `get_tokens()` 를 **1회** 호출해 `$EV/paper-tokens.json` 에 토큰→실효값 표를 동결한다. `color_token` 은 그 표에 대한 **정규화 완전 일치**로 정한다 — 정규화 규칙: 소문자화 · `#rgb` → `#rrggbb` 확장 · `rgb(r,g,b)`/`rgba(r,g,b,1)` → `#rrggbb`. **`--color-up`/`--color-down` 어느 값과도 일치하지 않으면 `color_token: null` 로 기록하고 이를 위반으로 판정한다**(무의미한 초록 방지).
- **측정 정의는 한 곳에만 둔다**: 임계는 전부 `scripts/kiumi_limits.py` 의 `KIUMI_RENDER_THRESHOLDS`(`{artboard_h: 640, min_text_nodes: 3, content_h_min: 1}`) 한 상수에서만 읽는다 — AC-9·G8·Step 3′b 가 같은 상수를 참조한다.

### 3.1 게이트 보호 계층 — 진실 게이트와 부기 게이트

세 번의 리뷰에서 발견된 결함의 대부분이 **게이트 자신의 결함**(처음 실행되는 날 통과할 수 없는 차단 게이트)이었다. 답은 게이트를 **지우는 것이 아니라 계층을 나누는 것**이다. 어떤 불변 보장도 약해지지 않는다.

| 계층 | 대상 | W2g·W3 구간 | Step 6 |
|---|---|---|---|
| **진실 게이트** — 틀리면 되돌릴 수 없는 것 | AC-K3 (b1) 내용 동일성 · (b2) 가산성 · (d) 도구 해시 · **AC-K5 슬롯 귀속 + 행 밴드 라벨 앵커** · AC-16 보드 05 해시 · AC-2 / AC-9 형상 · AC-9b 색 의미 · CP-1 3조건 · 배치 경계 스냅샷(**카드 페이지 포함**) | **차단** | 차단 |
| **부기 게이트** — 틀려도 대장을 고쳐 다시 찍으면 되는 것 | AC-K6 고지 차원 산술 · AC-7 면제 부기 · AC-8(d) 승인 템플릿 해시 · AC-10 라벨 부기 | **보고 전용**(붉어도 다음 배치로 간다, 보고서에 남는다) | **차단으로 승격** |

**근거**: 부기 게이트가 붉다는 것은 **대장의 숫자가 틀렸다**는 뜻이고, 대장은 Step 6 에서 고쳐 같은 Paper 아트보드를 재생성할 수 있다. 진실 게이트가 붉다는 것은 **원본 트리·원본 값·사용자 소유 표면**이 이미 훼손됐다는 뜻이라 재생성으로 복구되지 않는다.

> **이 계층은 §6 게이트 표의 *모든* 행에 표기한다** *(rev 6 — Critic 신규: rev 5 는 6개 행에만 표기하고 G0·G1·G2·G3·G4·G5·G9·G10·G11·G12 10개 행을 비워 두었다. G9·G10·G5 는 진실/부기 판정이 실행 시 실제로 필요한 행이다.)*

### 3.2 `source_table()` — 표 선택 정본

AC-K6(B)의 표 관련 값과 §4.5 Step 2 규칙 4 의 행 밴드는 **이 함수가 고른 표 하나**에서만 계산한다.

```python
def source_table(board: dict, slots: list[dict]) -> dict | None:
    """본문 value 셀이 가장 많은 표. 동수면 body_rows 가 많은 쪽, 그것도 동수면 node_id 오름차순."""
    ts = board.get("tables") or []
    if not ts:
        return None
    def body_cells(t):
        nid = t.get("node_id")
        return sum(1 for s in slots
                   if s.get("kind") == "value"
                   and isinstance(s.get("table"), dict)
                   and s["table"].get("table") == nid
                   and s["table"].get("row") != "head")
    return sorted(ts, key=lambda t: (-body_cells(t),
                                     -len(t.get("body_rows") or []),
                                     str(t.get("node_id"))))[0]
```

대장 레코드는 결과를 **`source_table_node_id`** 로 남긴다.

> **rev 6 정렬 키 교체 — 측정으로 정당화한다** *(Architect 개선 8 / Critic 개선 4)*. rev 5 는 `body_rows` 최대였다. 새 키(`body_value_cells` 우선)로 96보드를 재실행한 결과 **선택이 바뀌는 보드는 정확히 2장**이다: **`15P5-2`**(구 `3CCM-0` 32셀 → 신 `3D17-0` **52셀**) · **`2TRW-1`**(구 `2TU5-1` 39셀 → 신 `2TS8-1` **40셀**). 나머지 65장은 동일하다. **버려지는 본문 셀이 545 → 524 로 줄어든다.**
> ⚠️ **Architect 가 든 근거(`3UTA-0`)는 이 변경을 이끌지 않는다** — 실측상 `3UTA-0` 의 네 표는 `3V3D-0`(9행/9셀) · `3V4K-0`(8/8) · `3V5P-0`(6/6) · `3V6K-0`(4/4) 로 행 수와 셀 수의 순서가 같아 **두 키가 같은 표를 고른다**. `3UTA-0` 이 18셀을 버리는 문제는 정렬 키가 아니라 **다중 표 회계(AC-K6 `tables_dropped`)** 가 푼다. 근거를 정확히 옮겨 적는다.
> ⚠️ **`3UTA-0` 의 `column_priority` 는 부재가 아니라 빈 리스트 `[]` 다** *(rev 6 — Critic 신규, 실측 확인: 키는 존재하고 값이 `[]`)*. 판정식을 **`not board.get("column_priority")`** 로 못박는다 — `"column_priority" not in board` 로 구현하면 분기가 죽는다.

실측: `tables[]` 원소는 96보드 전체에서 `node_id`·`node_name`·`columns`·`header_row`·`body_rows`·`source`·`column_labels` **7키를 예외 없이** 갖고 `body_rows` 결손은 0건이므로 이 정렬은 전역(total)이다. 표 개수 히스토그램 **`{0: 29, 1: 48, 2: 17, 3: 1, 4: 1}`** — **2개 이상 19장(20%)**, 최대 `3UTA-0` 4개.

### ① 미니 카드 전수

| ID | 계승 | 명령 | 통과 조건 |
|---|---|---|---|
| **AC-1** | 1:1 · 이름 동일 | `$PY scripts/validate_kiumi_field.py --paper` | **분할(partition) 검사** *(rev 6 재기술 — `note` role 편입)*. 키우미 페이지 아트보드를 먼저 **`pre_existing` / `new`** 로 가른다(`pre_existing` = Step 0d 가 기록한 `paper-baseline.json` 의 `(node_id, name)` 집합 = 기존 보드 01~09, **role 접두사 없음**). 그 다음 `new` 를 role 로 분할해: **(a)** `role=="mini"` 의 접두사 제거 `name` 집합 == index.json `name` 집합, **양방향 차집합 0** · **(b) role 개수가 정확히** `mini 96 · template 11 · probe ≤10 · correspondence 1 · note 96`, 목록 밖 role **0건** · **(c)** `new` 집합 안에서 role 파싱 실패 **0건** · **(d)** `pre_existing` 집합이 Step 0d 열거와 **완전 일치**(개수·이름). **role 파싱은 첫 번째 `/` 기준 1회 분리**(`name.split("/", 1)`) — index.json 이름 자체가 ` / ` 를 포함하므로 greedy 분리는 이름을 훼손한다. 출력 `mini↔index diff: +0 / -0`, exit 0 |
| **AC-2** | 360×640 고정 | `--paper --geometry` (입력: 배치 스냅샷 또는 전량 스냅샷) | `role=="mini"` 96장 전부 `width==360 and height==640`(정수 px) **and** `px_height_measured == 640`. `clipping==true` 0건. *(`fit-content` 금지는 §4.0 저작 규칙 — 스냅샷에 스타일 문자열 필드가 없어 검사 입력이 없다)* |
| **AC-3** | 문법 정확히 1종 | `--schema` | 모든 레코드 `grammar` ∈ 10종 enum, enum 밖 0건, 미기재 0건 |
| **AC-4** | 값 출처 | **AC-K5 로 대체 검증** | 아래 |
| **AC-5** | 접힘 고지 | `--foldnote` | **`kiumi_fold_note` 오라클 일치**. 96 레코드 전부 `fold_note == kiumi_fold_note(grammar, fold_counts.notice)`, 불일치 0. `fold_note is null` ⟺ 오라클이 `null` ⟺ Paper 고지 노드 0건. **오라클 입력은 `fold_counts.notice`(고지 차원)이지 `fold_counts.slots`(슬롯 차원)가 아니다.** `notice` 는 **7필드** — `{columns, rows, items, scalars, records_shown, records_total, chars_total}`. 뒤 3필드는 **건수·글자수 차원**이며 `slots.total/shown` 에서 파생 **금지**(파생하면 `최근 3건 · 149건 중` 같은 거짓 개수가 나와 스펙 L63 위반). 계약은 §4.3b |
| **AC-6** | 출처 주석 4항목 | `--paper --annotations` | *(rev 6 강화 — 반증 가능한 게이트로)* 각 `role=="mini"` 에 짝이 되는 `note/<같은 이름>` 아트보드가 존재하고 `annotation_texts` 가 **4항목 전부** 보유(원본 보드 이름 · 가져온 요소 · 문법 · **접은 개수**). ⚠️ **문자열 동일성만 보지 않는다** — rev 5 의 "주석 == 대장 렌더 결과"는 단일 출처의 부작용으로 **정의상 항상 참**이었다. `--annotations` 는 `--fold-math` 가 **원본 `slots.json` 에서 독립 재계산**한 값과 주석의 숫자를 대조한다. **주석의 "접은 개수" 정의**: `fold_counts.slots.folded_slots`, 그리고 `tables_dropped > 0` 이면 **`· 표 {tables_dropped}개 전체 제외`** 를 잇는다 |
| **AC-7** | 문구 3원칙 | `--copy` | **출처 인지형(provenance-scoped) 스캔**. 스캔 대상은 **이 계획이 저작한 문자열뿐**: 접힘 고지 · 출처 주석 4항목 · label fallback 라벨 · `kiumi_reformat` 이 만든 값. 금칙 정규식 히트 0: `[0-9]\s*[MKB]\b` · `TR\s?\d` · `(^\|\s)축(\s\|$)` · `1호가` · 설명문 어미 `(입니다\|합니다)`. **AC-K5(2)가 `value == s.paper_text` 로 원본 동일성을 증명한 값은 `copy_exempt` 면제** — 화이트리스트가 아니라 **`source_slot_id` 열거**이며 오늘 기준 정확히 **22 슬롯**. 접힘 고지 예외는 `kiumi_limits.py` 가 10종 템플릿의 숫자 자리를 `\d+` 로 치환해 **기계 생성** |
| **AC-8** | 640 상한표 | `--limits` | **(a)** 보드 09(`2LFW-2`)에 10행 상한표 존재 · **(b)** 96 레코드 전부 자기 문법 상한 이하, 초과 0건 · **(c)** 상한표 값 == 생성기 상수(`kiumi_limits.py::KIUMI_LIMITS_640`), 차집합 0 · **(d)** `realized: true` 인 행은 `derived_from == "approved-template"` **and** `approved_template_sha == approved-templates.json[grammar].sha`. **시각 비교를 쓰지 않는다** — 상한 도출(Step 3′b)이 승인 **이전**이라 시각 조건은 영원히 거짓이었다. 해시는 "승인 뒤에 쟀다"가 아니라 **"승인된 바로 그 템플릿에서 나왔다"** 를 증명한다. 보드 0장 문법은 `realized: false` · `derived_from == "probe"` 로 충분. **`app/lib/orb-mini-card.js` 의 `LIMITS` 는 이 등식에 포함하지 않는다**(D3, FU-1 이월) |
| **AC-9** | 스크린샷 비어있지 않음 · 넘침 없음 | `--render` | `role=="mini"` 96장 전부 **`px_height_measured == 640`** and **`len(text_nodes) >= 3`** and **`0 < content_bbox_height <= 640`**. 세 신호 전부 `get_computed_styles` 에서 나온다(신규 의존성 0). `content_bbox_height <= 640` 이 **헌장 게이트 5의 "잘림·겹침 0"** 을 실제로 검사한다 — `clipping==false` + 640 고정만으로는 `overflow:hidden` 조상이 없을 때 넘쳐도 초록이었다 |
| **AC-9b** | 헌장 게이트 5의 **색 의미** | `--tone` (입력: `directional_colors` + `$EV/paper-tokens.json`) | **방향값 요소 전부 색이 부호와 일치**: `color_token == "--color-up"` ⟺ `sign == "+"`, `"--color-down"` ⟺ `sign == "−"`. **`color_token is null` 은 위반이다.** 불일치 0. **범위(측정으로 좁혔다)**: 출처 슬롯이 `format.tone == "change"` **and** `format.sign == true` **and** `paper_text` 가 `+`/`−`/`-` 로 시작 — 실측 **2,081개 / 88보드**. **검사 범위 밖 방향값 수를 함께 보고한다**(범위 축소가 커버리지를 조용히 갉아먹지 않게). ⚠️ **증거 정정**: 두 리뷰는 `format.tone` 이 `{up, down}` 을 담는다고 전제했으나 실측 분포는 **`neutral` 8,588 · `change` 3,106 · 없음 31** 이다 — `tone` 은 방향을 말하지 않고 `format.sign` 도 "부호를 표기하는가" 불리언이다. 방향의 유일한 기계 출처는 `paper_text` 의 선행 부호이며, `tone=='change'` 중 선행 부호가 없는 것이 **1,025개**다(rev 6 재측정 — rev 5 의 1,020 은 오기). 넓히면 다시 "통과할 수 없는 기준"이 된다. 나머지 절반(`상태 표기에 색+문구`)은 미니가 **리드 1층만** 쓰고 상태 배지를 그리지 않으므로 **의도적 이탈** + **FU-6** |

### ② 표시 부분 정의

| ID | 계승 | 명령 | 통과 조건 |
|---|---|---|---|
| **AC-10** | 주석 요소 == 원본 요소 이름 | `--provenance --annotations` | *(rev 6 강화 — Architect 블로킹 4)*. **행 밴드**: AC-K5(3-row) 라벨 앵커 검사 통과(`label_source ∈ {kor, head_label}`). **스칼라 밴드**: `label_source == "kor"` **이거나** 그 보드가 `$EV/scalar-label-fallback-boards.json` 에 열거되어 있고 **`label_review` 가 채워져 있음**. rev 5 의 "`label_source` 기록만"은 96장 전부를 무검사로 두었다 — 값은 지키면서 라벨은 지어지는 구멍이고 스펙 L70 에 대한 정합 실패다. **and** 주석 "가져온 요소 목록" == 대장 `elements[].label` 렌더 결과 |
| **AC-11** | `slots.json` `kiumi` 기록 · 주석과 동일 | `$PY scripts/validate_kiumi_field.py` | `96/96 boards have a well-formed kiumi field` · exit 0 · Paper 주석 텍스트 == 대장 렌더 문자열 |
| **AC-12** | 템플릿 테스트 통과 | `cd backend && ../$PY -m pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/unit/test_kiumi_field.py -q` | 3개 파일 전부 green, 실패 0 |
| **AC-13** | 질문 무관 고정 규칙 명시 | `grep -c` 2곳 + 레코드 검사 | **`backend/ref/kiumi/README.md`** · **보드 09(`2LFW-2`)** 두 곳에 "질문과 무관하게 항상 같은 표시 부분" 취지 문장 존재(2/2) **and** 96 레코드 전부 `fixed: true`. **스펙(`.omc/…`)은 정본에서 뺀다** — `.gitignore:9` 가 `.omc/` 를 부정 규칙 없이 무시하므로 `git clean -xdf` 한 번으로 정본 하나가 사라진다 |

### ③ 대응 보드

| ID | 계승 | 명령 | 통과 조건 |
|---|---|---|---|
| **AC-14** | 대응 보드 1장 | `--correspondence` | `role=="correspondence"` 아트보드 **정확히 1장**, 좌 1440 클론(`2SCE-1`) · 우 360×640 미니를 자식으로 보유 |
| **AC-15** | 양쪽 값 동일 | `--correspondence` | 우측 미니의 모든 값 문자열이 좌측 카드 `text_nodes` 집합에 존재, 차집합 0. **각주**: 좌측은 `2SCE-1` 의 **클론**이므로 이 검사는 추출 트리 기준이며 라이브 Paper 카드와의 동일성을 증명하지 않는다(원칙 3, R-11) |
| **AC-16** | 규칙 3문장 · 보드 05 불변 | `get_jsx(5EU-0)` 해시 대조 + grep | 3문장(한 세션 · 동일 호출 로직 · 미리 정의된 표시 부분) 존재 **and** 보드 05(`5EU-0`) `sha256(get_jsx)` 가 G0 기록과 동일 |

### 신규 기계 검증 AC (K 계열)

| ID | 명령 | 통과 조건 |
|---|---|---|
| **AC-K1** | `$PY scripts/validate_kiumi_field.py` | `96/96 boards have a well-formed kiumi field`, exit 0, `provisional: true` 레코드 0건 |
| **AC-K2** | `$PY scripts/kiumi_baseline.py --compare $EV/kiumi-baseline.json` | **귀속 차등 게이트**: 문제를 `(board_id, problem)` 키 집합으로 비교. **대상 96보드 귀속 새 키 0건**이면 통과. 대상 밖 증감은 `--foreign` 분리 보고, 게이트 불차단. 기준선 **225키 / 62보드**. ⚠️ 이 신호의 foreign 분리는 **현재 공집합**이므로 외부 편집 탐지는 **AC-K3 가 진다** |
| **AC-K3** | `$PY scripts/kiumi_tree_manifest.py --compare $EV/kiumi-tree-manifest.json` | **다섯 항 전부**: **(a)** 96 `board.html` sha256 == G0 (확정 카드 미수정 증명, 스펙 L55) · **(b1) 내용 동일성** — `kiumi` 최상위 키 제거 후 `json.dumps(payload, ensure_ascii=False, sort_keys=True)` 재직렬화한 각 `slots.json` sha256 == G0 · **(b2) 가산성** — 새 최상위 키가 정확히 `kiumi` 1개 **and** 나머지 키 상대 순서 보존 · **(c)** `index.json` sha256 == G0 · **(d) 도구 3종 sha256 == G0** — `scripts/paper_board_extract.py`(직렬화 정본) · `scripts/validate_board_slots.py`(G0/G4 기준선 생산자) · `scripts/build_board_registry.py`. **(b1)/(b2)를 나누는 이유**: 순서 보존 직렬화는 정의상 canonical 이 아니어서 "내용 동일 + 키 순서만 변경"과 "내용 변경"을 구별하지 못한다. 실측 근거 — 96 `slots.json` 의 최상위 키 튜플은 **순서 포함 8종 / 정렬 후 7종**으로 갈린다(집합이 같고 순서만 다른 보드가 실재한다). **(d)의 이유**: `git ls-files scripts/` 는 **13 파일**을 돌려주고 그 안에 셋 다 **없다**(전부 untracked) — 계약의 형식을 정의하는 도구가 AC-K8 의 시야 밖이라, 다른 세션이 `dump_json` 을 고치면 96 파일의 바이트 형식이 조용히 이동해도 어떤 게이트도 붉지 않았다 |
| **AC-K4** | `--audit` | **세 항 전부**: **(a)** `grammar == kiumi_grammar_rule(board)` 이거나 `override_reason` 비어있지 않음 — 둘 다 아닌 레코드 0건 · **(b)** `chart_capable == true` 인 레코드는 `grammar == "chart"` 이거나 `override_reason` 비어있지 않음(파생 필드 `chart_capable = any(resolve_render_plan_kind(ref) == "chart" for ref in board.operation_refs)` 를 **규칙이 채운다**; 실측 3장 `137X-2`·`2RJ7-1`·`32S7-0`) · **(c)** `structure_missing == true` 인 레코드는 `override_reason` 비어있지 않음. 배정 분포 · override 목록 · `chart_capable` 목록 · `structure_missing` 목록을 증거로 출력 |
| **AC-K5** | `--provenance` | **슬롯 정체성 검사.** 각 요소 `e` 에 대해 (1)(2)(3) 전부 — 아래 상세. 어긋난 요소 0건. **문자열 포함(substring/multiset) 검사는 쓰지 않는다** |
| **AC-K6** | `--fold-math` | `fold_counts` 는 **두 차원**을 갖고 둘을 같은 등식에 넣지 않는다 — 아래 상세 |
| **AC-K7** | `$PY scripts/kiumi_slots_diff.py --compare $EV/slots-baseline.json` | **귀속 차등 형태**. **대상 96보드 귀속 새 `(board_id, tally_letter)` 문제 0건.** 대상 밖 보드 증감은 `foreign:` 분리 보고, 게이트 불차단. 참고 기준선: exit **1** · 합계 **1615**(b360 c20 d67 e1158 f9 g1) · 문제 보드 **85**(대상 밖 `fixture-quote` 포함). ⚠️ `scripts/validate_board_slots.py` 의 argparse(`:312-318`)는 `boards`(positional) + `--pack-dir` **둘뿐이고 `--attribute` 가 없다**(실측) — 그래서 `kiumi_slots_diff.py` 가 그 스크립트를 **수정하지 않고 import 만** 한다(`check_board`:142 · `tally`:261 · `visible_fields`:46 · `hidden_fields`:58 · `board_dirs`:302 · `TALLY_KEYS`:250 · `TEMPLATE_ROOT`:34 · `DEFAULT_PACK_DIR`:37, 전부 실측 확인). **stdout 파싱이 아니라 반환값 사용** |
| **AC-K8** | `git status --porcelain` on branch `kiumi/mini-cards` | 커밋된 변경이 허용 경로에만 존재: `backend/ref/kiumi/**`(대장·README·**evidence/**) · **`scripts/kiumi_*.py`** · `scripts/validate_kiumi_field.py` · `backend/tests/unit/test_kiumi_field.py`. 그 밖의 tracked 파일 수정 0건. **`.omc/**` 는 허용 목록에 없다** — `.gitignore:9` 가 `.omc/` 전체를 무시하므로 애초에 커밋될 수 없다. **저작 스크립트 이름은 전부 `kiumi_*` 글롭 안에 둔다**(`kiumi_apply_field.py` · `kiumi_build_ledger.py` — 옛 이름 `apply_kiumi_field.py`·`build_kiumi_ledger.py` 는 글롭 밖이라 커밋 순간 이 게이트가 붉었다) |
| **AC-K9** *(rev 6 신설)* | `git diff --quiet -- backend/ref/kiumi/evidence/*baseline*.json backend/ref/kiumi/evidence/kiumi-tree-manifest.json` | **기준선 파일 자신의 무결성.** AC-K3·AC-K7 의 신뢰는 `kiumi-tree-manifest.json`·`slots-baseline.json`·`kiumi-baseline.json` 이 Step 0 이후 불변이라는 데 걸려 있는데, 이 경로는 AC-K8 **허용 목록 안**이라 재실행·덮어쓰기가 어떤 게이트도 붉히지 않았다 — 게이트가 스스로를 무효화할 수 있었다. **Step 0 종료 직후 이 파일들을 커밋하고**, G2b·G4 통과 조건에 위 명령을 추가한다. 정당한 재기록은 §5 R-9 판정 절차를 거친 뒤 **별도 커밋**으로 한다 |

#### AC-K5 상세 — 슬롯 정체성

**(1) 귀속**: `e.source_slot_id` 가 그 보드 `slots[]` 에 존재 → 슬롯 `s`.

**(2) 값 보존**: `e.value == s.paper_text` **또는** `e.value == kiumi_reformat(s.paper_text, s.format)` 이고 `e.value_format == "from_slot_format"`. `kiumi_reformat` 은 **임의 함수가 아니라 값 보존 불변식**이다 *(rev 6 — 전역 함수로 재정의, Architect 블로킹 2)*:

| 분류 | 슬롯 수 (실측) | 규칙 |
|---|---:|---|
| 수치형 unit(`krw_ko` 1,879 · `percent` 1,924 · `shares` 1,511 · `count` 252) **이면서 숫자 토큰이 정확히 1개** | **4,718** | `parse_number(out) == parse_number(paper_text)` — **선언된 단위 배율만** 허용 |
| 수치형 unit 이면서 **숫자 토큰이 1개가 아닌 것** | **848** (2개 755 · 3개 64 · 4개 13 · 5개 9 · 6개 4 · 7개 2 · 0개 1) | **항등 전용**(`out == paper_text`). `$EV/identity-only-values.json` 에 **열거하고 W3 전 동결** |
| 비수치형(`text` 5,197 · `date` 529 · `time` 402) 및 `unit` 키 없는 4종 shape(31) | **6,159** | **항등만 허용** |

> **왜 이 분기가 필요했나**: rev 5 는 수치형 전체에 `parse_number` 동일성을 요구했는데, 848 슬롯에서는 `parse_number` 가 **무엇을 가리키는지 미정**이었다(예 `133H-2 s043` = `전일 149,000 · +1.24%` 토큰 2개, `2SRV-1 s124` 토큰 3개, `1JZW-0 s014` = `%` 토큰 0개). 구현자가 "첫 숫자"를 고르면 **두 번째 숫자를 잃은 재포맷이 통과**하고, 예외를 던지면 848건이 G6 를 붉혀 W3 가 멈춘다. `format` shape 은 `{unit,sign,precision,tone}` **11,694** + 다른 4종 shape **31**(`{derived,kind}` 21 · `{kind}` 6 · `{derived,kind,precision}` 3 · `{count,join,kind}` 1), 조합 **50종**뿐이다.
> **`kiumi_reformat` 의 존재 이유**: **선언된 단위 배율의 재적용**을 허용하기 위함이지 **축약을 위한 것이 아니다** — 값 보존 불변식이 `text`·`date`·`time` 6,128 슬롯을 항등 전용으로 만든 순간 축약은 구조적으로 금지됐다. 데이터 정합: `len(paper_text) > 12` 인 슬롯은 **1,372개(11.7%)** 뿐이라 **항등이 기본, 재포맷이 예외**인 구조가 실데이터와 맞는다.

**(3) 라벨 앵커 — 밴드마다 다르다**:

- **(3-row) `band == "row"`**: `label_source ∈ {"kor", "head_label"}` 로 **한정**. `kor` 이 있으면 `label == s.kor`; 없으면 그 셀과 **같은 표·같은 열의 머리 라벨 슬롯**(`(s.table.table, s.table.col)` 좌표에서 `row == "head"` and `kind == "label"`)의 `paper_text`. 둘 다 없는 셀은 **선택 금지**하고 `$EV/unlabelable-row-cells.json` 에 열거해 접힘으로 넘긴다(`candidate_count` 에는 남으므로 슬롯 산술 무영향). 실측 **정확히 2개**: `2QRP-1 s039`·`s058`(둘 다 `table 2QT1-1 · col 4`, 값 `+100`/`−200` — 선언된 열이 4개인데 머리 라벨 없는 5번째 열).
- **(3-scalar) `band == "scalar"`** *(rev 6 강화 — Architect 블로킹 4)*: **선택이 `kor` 보유 슬롯을 우선한다**(실측 5,307 중 3,749 보유). 상한을 `kor` 보유분으로 채울 수 없는 보드만 fallback 을 허용하고 그 보드를 **`$EV/scalar-label-fallback-boards.json` 에 열거해 W3 전 동결**한다. fallback 라벨은 같은 보드 `kind=="label"` 슬롯의 `paper_text` 이며 `label_source == "board_label_fallback"` 로 명시 기록한다. **열거된 보드는 Step 3 비준의 명시 판정 대상**이며 `label_review` 기록을 요구한다(AC-10).
  - 실측 근거: 스칼라 value **5,307** / `kor` 결손 **1,558(29.4%)**. `kor` 스칼라가 **0개인 보드 4장** — `2TJ6-1`(24슬롯) · `2TNJ-1`(24) · `2ZHC-0`(33) · `2ZZ7-0`(38) — 이 4장의 미니는 라벨 전부가 fallback 이다. **5개 미만 13장**: 위 4장 + `135M-2`·`15J9-2`·`2T63-1`·`2TAG-1`·`2TET-1`·`2YXS-0`·`31OF-0`·`31UD-0`·`3UTA-0`.
  - **`paired_with` 는 앵커가 될 수 없다** *(rev 6 실측)*: 전 슬롯 중 `paired_with` 보유는 2,431개지만, **스칼라 `kor` 결손 1,558건 중 `paired_with` 를 가진 것은 54건이고 그 중 라벨 슬롯을 가리키는 것은 0건**이다. §7 의 후보 하나가 측정으로 죽었다.
- **왜 행 밴드만 완전히 조이는가**: 행 밴드 value **6,418개 중 1,700개(26.5%)** 가 `kor` 결손이고 행 밴드는 `table` + `compound` = **78/96 보드의 본문**이다. 머리 라벨 슬롯이 그 1,700 중 **1,696개**를 덮고, 표 보유 67보드의 선택 표 전부가 머리 라벨 슬롯을 갖는다(머리 라벨 0개인 표 0장).
- ⚠️ **`column_priority` 를 라벨 앵커에서 제외한다 — 리뷰 처방과 의도적으로 다르다**. 커버리지는 `column_priority[table.col]` 이 1,698 로 머리 라벨 1,696 보다 **높다**. 그러나 `column_priority` 는 **보드당 1개**인데 표는 여럿이라 **인덱스 공간이 표와 어긋난다**. 실측: 두 앵커가 모두 존재하는 1,696개 중 **196개(11.5%)에서 값이 다르고**(다중 표 134 · 단일 표 62), `column_priority` 만 커버하는 2개는 **`2QX1-1 s045`·`s064` 로 `column_priority[4] == '시각'` 인데 값이 `+50`/`−250`** 이다 — 시각이라는 라벨이 등락 값에 붙는다. 즉 그 앵커를 받으면 **처방이 막으려던 사건(무관한 라벨)** 을 규칙이 승인한다. 머리 라벨은 `(표 노드, 열)` 좌표라 구성상 그 열의 실제 헤더다. `column_priority` 는 라벨이 아니라 **열 순서**에만 쓰고, 그때도 인덱스가 아니라 **이름 조회**로 쓴다.

**실측 각주**: `kind=="value"` 슬롯 **11,725개 전부(100%)** 가 non-null `format` 을 갖는다 — (2)의 입력은 언제나 존재한다.

#### AC-K6 상세 — 접힘 산술 (두 차원)

**(A) 슬롯 차원** `fold_counts.slots = {total, shown, folded_slots}`: `total == candidate_count`(= 그 보드 `kind=="value"` 슬롯 **전체 수**) · `shown == len(elements)` · **`folded_slots == total − shown`** · 전부 비음수.

**(B) 고지 차원** `fold_counts.notice = {columns, rows, items, scalars, records_shown, records_total, chars_total}`: 각 값이 원본 **구조**와 일치할 것. **모든 표 관련 값은 §3.2 의 `source_table()` 하나에 대해서만 계산한다** — `columns == len(anchored_cols(source_table)) − (보인 열 수)` · `rows == len(source_table.body_rows) − (보인 행 수)` · `scalars == (스칼라 후보 수) − (보인 스칼라 수)` · `items == (그 문법의 항목 후보 수) − (보인 항목 수)` · `records_shown`/`records_total` = **건수** · `chars_total` = **글자수** · 전부 비음수.

**(C) 문법별 필드 배타성**: `facts`·`chart`·`order_ticket`·`order_confirm`·`auth` → **`items` 만** · `table` → `columns`·`rows` · `compound` → `scalars`·`rows` · `event`·`stream` → `records_shown`·`records_total` · `reader` → `chars_total`. 그 문법이 쓰지 않는 필드는 **0 이어야 한다**.

**(D) 다중 표 회계** *(rev 6 신설 — Architect 블로킹 3)*: 대장 레코드에 **`tables_total`**(= `len(board.tables)`) 과 **`tables_dropped`** 를 넣고 **`tables_dropped == max(tables_total − 1, 0)`** 을 단언한다.
> **왜 필요한가**: `source_table()` 단일 표 규칙은 선택 표 **밖**의 본문 셀을 통째로 버리는데, 화면 고지에는 그 사실이 어디에도 나타나지 않는다. 실측 — 표 2개 이상 **19장**, 선택 표 밖 본문 value 셀 **524개**(rev 6 정렬 키 적용 후; 이전 키로는 545). 상위: `1JPU-0` in 85 / out 80 · `1JZW-0` 85/80 · `13BC-2` 60/40 · `15P5-2` 52/32 · `2TRW-1` 40/39 · `2Z49-0` 56/36 · `2QX1-1` 40/33. 사용자는 `행 N개를 접었습니다` 를 보지만 실제로는 표 한두 개가 통째로 사라진다 — 계획이 스스로 기각한 "거짓 개수"(스펙 L63)와 같은 결과다.
> **처리**: 화면 고지 문구는 JS 정합을 위해 그대로 두되, **출처 주석의 "접은 개수"를 `fold_counts.slots.folded_slots` + `· 표 {tables_dropped}개 전체 제외` 로 못박아**(AC-6) 사용자가 보는 어느 표면에도 과소 개수만 남지 않게 한다. 보드 09 각주에 "미니의 화면 고지는 **선택된 표 하나**에 대한 수이며, 전체 접힘은 주석과 캔버스에서 확인한다"를 명시한다.

**두 차원 사이에 등식을 두지 않는다.** rev 3 은 `folded == columns+rows+items+scalars` **와** `folded == candidate_count − len(elements)` 를 동시에 요구했는데, 앞은 **열·행 개수**(JS `foldNote` 의 의미, `:134`·`:142`)이고 뒤는 **셀·슬롯 개수**라 차원이 다르다 — 실측 `2SCE-1`(compound): value 149 · 표 7열×8행 · kpi 5 이므로 (i)는 `(5−3)+(8−2)=8`, (ii)는 `149 − shown ≈ 130대`로 **우연히도 같아질 수 없다**. `table` 28 + `compound` 50 = **78/96 보드**가 이 조항 아래 있었다. 봉합안(`columns/rows` 에 셀 수 넣기)은 `스칼라 130개…` 같은 **거짓 개수**를 표시해 스펙 L63 을 어기므로 채택하지 않는다.

### AC-7 `copy_exempt` — 원본 승인 문구 열거 면제

전 슬롯 `paper_text` 스캔 실측(96보드, 18,045 슬롯):

| 금칙 | 히트 | 슬롯 (전부 `kind=="value"`) |
|---|---:|---|
| `[0-9]\s*[MKB]\b` | **10** | `2QX1-1 s001`(header, `금 99.99K 통합 호가`) · `2RJ7-1 s001`(header) · `2TNJ-1 s038`(other) · `2VIN-0 s052`·`s086`(table, `KRX2B`) · `3ODO-0 s038`(primary)·`s125`(rail) · `3OIM-0 s042`·`s055`·`s069`(primary) |
| `1호가` | **12** | CC-02 **6보드 전부**의 `s035`(primary) + `s045`(other) — `135M-2`·`2T63-1`·`2TAG-1`·`2TET-1`·`2TJ6-1`·`2TNJ-1`, 문자열 `현재 매수 1호가` |
| `TR\s?\d` · `(^\|\s)축(\s\|$)` · `(입니다\|합니다)` | **0** | 히트 없음 |
| **`kind=="label"` 슬롯 히트** | **0** | 22건 전부 `kind=="value"` — **fallback 라벨 경로가 오늘 깨끗하다**는 사실을 감사 가능하게 남긴다 |

`header`·`primary` 는 Step 2 선택 순서 최상단이므로 이 값들이 미니에 실릴 것은 사실상 확정이다. 값을 그대로 실으면 G7 이 붉고, G7 을 통과시키려면 값을 바꿔야 하는데 그러면 AC-K5·스펙 L47("값 그대로, 지은 값 0")을 어긴다.

**해소**: 위 **22개 `source_slot_id` 를 `backend/ref/kiumi/copy-exempt.json` 에 열거**하고 AC-7 스캔에서 면제한다. 화이트리스트(패턴 면제)가 아니라 **감사 가능한 목록**(슬롯 면제)이다 — 목록 밖에서 같은 문자열이 나오면 여전히 붉다. Step 0e 가 생성하고 **W3 전 동결**한다. 근본 충돌은 **FU-5 / §7 Open Question** 으로 사용자 판단에 올린다.

**개수**: AC **26개**(AC-1~16 16개 + AC-9b + AC-K1~K9 9개) 중 **25개**가 명령 + 통과 조건으로 기술됨(**96%**). 나머지 1개(AC-4)는 AC-K5 로의 명시적 위임이다.

---

## 4. Implementation Steps

### 4.0 Guardrails

**Must Have**

- **브랜치**: 모든 저장소 변경은 `main` 에서 새로 딴 **`kiumi/mini-cards`** 브랜치에서만 한다(사용자 지시). `main` 에 직접 쓰지 않는다. **Paper 편집은 git 추적 대상이 아니므로 브랜치가 보호하지 못한다** — Paper 측 보호는 R-5 절차와 AC-16·AC-K3 해시 대조가 담당한다.
- 추가는 **덧붙이기(additive)만** · `kiumi` 는 `slots.json` 최상위 키 1개 · 다른 키 순서·내용 보존. **이 가드레일의 게이트는 AC-K3(b1)+(b2)** 다.
- **직렬화는 추출기와 바이트 동일하게 맞춘다.** 정본은 `scripts/paper_board_extract.py:1818-1819` 의 `dump_json` = **`json.dumps(payload, ensure_ascii=False, indent=2) + "\n"`**(실측). **마지막 개행을 빠뜨리면 96 파일이 매 재추출마다 diff 를 낸다.**
- **추출기 계약이 가산성을 뒷받침한다**: `scripts/paper_board_extract.py:1460` 의 `GENERATED_TOP_KEYS` 에 `kiumi` 가 **없으므로**, `merge_authored`(`:1780-1784`)가 재추출 때 `kiumi` 를 `unbound_fields`·`unbound_reason` 과 같은 등급의 저작 필드로 그대로 옮겨 담는다(실측 확인). 동시에 새 리스크 — `merge_authored` 는 옮겨 담은 키를 payload **끝에 재배치**하므로 재추출 한 번으로 최상위 키 순서가 바뀌고 AC-K3(b2)가 외부 편집으로 오탐한다. 판정 절차는 §5 R-9.
- **모든 Paper 쓰기는 키우미 페이지(`C-2`) 안에서만.**
- **모든 `write_html` 직전에 `get_basic_info` 로 활성 페이지가 `C-2` 임을 단언한다** *(rev 6 신설 — Architect 블로킹 1)*. 단언이 실패하면 쓰지 않고 `open_file(C-2)` 후 재확인한다.
- 미니 아트보드는 **픽셀 높이 640 명시**(`fit-content` 금지).
- **Paper 쓰기 레인은 언제나 정확히 1개.** 순서: W2g → W3 → W4 → (필요 시) W6. W2a~W2f(대장 비준 6 병렬)는 **Paper 를 전혀 건드리지 않는다.**
- **그 불변식에 기전과 경계 검사를 붙인다**:
  - **(a) 도구 차단** — W2a~W2f 리뷰어 에이전트는 **Paper MCP 도구 없이 기동**한다(에이전트 스펙에 `mcp__paper__*` 전체를 도구 거부 목록으로 명시). 선언이 아니라 기동 조건이다.
  - **(b) W2→W3 경계 체크포인트 (CP-1)** — 아래 3조건.
- **비가역 구간의 재개·중단 규칙** — CP-1 · W3 배치 경계 · W6 배치 경계에 공통으로 적용한다:
  - **(a) 우리 role 노드의 이름 변경으로 설명되면** → 기준선을 **재기록**하고 진행한다. 이미 쓴 배치는 재검증하지 않는다.
  - **(b) 대상 밖 아트보드의 추가·변경이면** → `$EV/foreign-paper-nodes.json` 에 기록하고 **사용자에게 통보한 뒤 진행**한다.
  - **(c) `mini/*` · `note/*` · `template/*` 노드의 변경이면** → **중단(halt)**. 해당 배치를 대장에서 **재생성**하고, `template/*` 이 바뀐 경우에는 AC-8(d)의 `approved_template_sha` 가 깨지므로 **G11-6 재승인**부터 다시 한다.
  - **(d) 표본 재생성으로 설명되면** *(rev 6 신설)* → CP-1(3) 불일치로 삭제·재생성한 표본의 노드 증감은 **설명되는 증감**으로 받는다.
  - **(e) 카드 페이지 `5-1` 의 변경이면** *(rev 6 신설 — Architect 블로킹 1)* → 대상 밖 보드의 변경은 (b)로, **`2SCE-1` 의 변경은 (c)와 같은 중단**으로 판정한다(D2 대응 보드의 좌측이자 AC-15 의 기준이기 때문).
- **아트보드 이름 role 접두사 규약.** **이번 작업이 새로 만드는** 아트보드는 이름이 `<role>/` 로 시작한다. **기존 보드 01~09 는 개명하지 않으므로 규약 밖의 `pre_existing` 집합**이며(실측: 기존 이름에 접두사가 없다 — `2LFW-2` "09 · 미니 카드 10종" · `5EU-0` "05 · 셸 숨김·표시"), Step 0d 의 `paper-baseline.json` 열거가 그 집합의 정본이다. **role 파싱은 첫 번째 `/` 기준 1회 분리**(`name.split("/", 1)`).

| role | 대상 | 개수 | 이름 형식 |
|---|---|---:|---|
| `mini` | 96 미니 카드 | 96 | `mini/<index.json 의 name 그대로>` |
| **`note`** *(rev 6 신설)* | 96 출처 주석 블록 (아트보드 **밖**, AC-6) | **96** | `note/<index.json 의 name 그대로>` |
| `template` | 문법 10종 템플릿 + 대표 보드 (W2g) | **11** | `template/<grammar>` 10 + `template/2SCE-1` 1 |
| `probe` | 640 상한 도출 프로브 (W2g) | ≤10 | `probe/<grammar>` |
| `correspondence` | 대응 보드 (W4) | 1 | `correspondence/2SCE-1` |
| *(role 아님)* `pre_existing` | 기존 보드 01~09 | 9 | **개명하지 않는다.** AC-1 분할에서 제외 |

> **`note` role 이 없으면 게이트가 구성상 실패했다** *(rev 6 — Critic 블로킹)*: AC-6 이 주석을 아트보드 **밖**에 두라고 요구하므로 96개 주석 블록이 페이지에 생기는데, Step 0d 기준선이 **페이지 전체**의 `(node_id, name)` 이라 G8 과 배치 경계 검사의 "증감이 우리가 추가한 role 노드로 전부 설명됨"이 **96건의 설명되지 않는 증감**으로 붉었다.
>
> **노드 이름 규약은 아트보드에만 적용된다.** 아트보드 **안**의 텍스트 노드 이름(`v:<slot_id>`, §3.0)은 role 파싱 대상이 아니다.

**Must NOT Have**

- `board.html` · `paper.jsx` · 확정 카드 보드(카드 페이지 `5-1`) 수정 금지. **카드 페이지를 부모로 삼는 `duplicate_nodes` 금지** — 대응 보드 클론은 `get_jsx(2SCE-1)` **읽기** → `C-2` 안 `write_html` 로만 만든다 *(rev 6 — Architect 블로킹 1)*.
- `app/lib/orb-mini-card.js` 수정 금지 — **`LIMITS`(`:22-29`) 포함, 렌더 동작 포함**(D3 확정).
- 보드 05(`5EU-0`) 수정 금지. 보드 01~08 수정 금지.
- `scripts/validate_board_slots.py` · `scripts/paper_board_extract.py` · `scripts/build_board_registry.py` 수정 금지 — **import 만** 한다(해시로 감시, AC-K3(d)).
- 새 문법·새 렌더러 0.
- **`.omc/` 전체를 정본 저장소로 쓰지 않는다.** `.gitignore:9` 가 `.omc/` 를 부정 규칙 없이 무시한다(실측). 대장·기준선·해시 매니페스트·Paper 스냅샷·게이트 증거는 **전부 `backend/ref/kiumi/`** 아래에 둔다.

### 4.1 확정된 결정 3건 + 범위 확정 2항

| ID | 결정 | 확정 내용 | 근거 / 되돌리는 비용 |
|---|---|---|---|
| **D1** | 1:1 대상 범위 | **index.json 등록 96보드 전부** — A 계열 4장(`1JPU-0`·`1JZW-0`·`1WOB-1`·`3N4O-0`) 포함 | 이 4장은 CC `card_id` 로 등록되어 `slots.json` 을 갖는다(§1.1). 96 을 대상으로 하면 "등록 보드 전부에 `kiumi` 가 있다"가 예외 없는 불변식이 되어 AC-K1 이 깔끔해진다. **확정 시점: W3 시작 전.** ⚠️ **Paper 쓰기 후에는 되돌릴 수 없다** — 이미 쓴 아트보드 삭제는 R-5 아래 최고 위험 작업이므로 범위 축소는 W3 이전에만 가능하다. **제외 대상은 수가 아니라 열거로 확정한다**(D1-a) |
| **D2** | 대응 보드 예시 카드 | **`2SCE-1` — "CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중"** | `counts.tables == 1` · `density.kpi_cells == 5` · `table_columns == 7` · `rows_max == 8` · `values == 149` · `slots == 213` · `artboard_px == [1440, 1092]` 로 **`compound` 적격**이고, `state == {kind: "tab", parent_board: "133H-2", control: "보유종목"}` 이라 스펙 L97 의 "내 계좌" 계보를 유지한다. 표 노드 `375G-0` **1개**(→ `source_table` 선택이 자명) · `body_rows` **8행** · **`column_priority == ['종목','평가액','손익','현재가','수량','평단','오늘 매매']` 7항목이 열 이름의 원천**이다. ⚠️ `column_labels` 는 길이만 7이고 **`['종목','','','','','','']` 로 6개가 빈 문자열**이다. 차점 후보 `2SKU-1`(tables **2**)은 대응 보드가 `source_table` 선택까지 실증해야 하므로 표 1개인 `2SCE-1` 이 낫다. rev 1 의 `133H-2` 는 `tables == 0`·`kpi == 5` 라 규칙상 `facts`(114값 중 5개)가 되어 접힘·복합 대조를 실증하지 못한다 |
| **D3** | 640 상한 기록 위치 + `LIMITS` 결합 | **보드 09(`2LFW-2`)만 갱신. `app/lib/orb-mini-card.js` 의 `LIMITS`(`:22-29`)는 건드리지 않는다.** 보드 09 에 "**코드 반영은 후속 작업**" 각주를 남긴다 | 사용자 결정. `orb-mini-card.js:21` 이 "숫자를 바꾸면 보드 09의 상한표도 같이 바꿔야 한다"고 동기화를 선언하지만 Non-Goal(L54)이 오브 앱 코드 변경을 배제하므로 **동기화를 의도적으로 유예**한다. 따라서 **AC-8 등식에서 `LIMITS` 를 제거**하고(등식은 `상한표 값 == 생성기 상수` 2항) 괴리를 **FU-1 로 이월**한다. 부수 사실: `LIMITS.tableRows`(`:23`)는 **역참조되는 곳이 없다** — 삼중 등식은 애초에 코드 안에서도 성립하지 않았다(증거 명령: `grep -n 'LIMITS\.' app/lib/orb-mini-card.js` → `:52 :57 :58 :64 :79 :82 :84`, `tableRows` 부재) |

**현행 `LIMITS` 값 (FU-1 대조 기준, `app/lib/orb-mini-card.js:22-29`)**: `tableRows 3` · `factsRows 5` · `compoundScalars 3` · `compoundRows 2` · `logRecords 2` · `readerChars 140`. **`LIMITS` 는 "보드 09 상한표"이며(주석 `:21`) 어떤 화면 크기에서 도출됐는지는 파일이 말하지 않는다** — 정확한 진술은 **"640 기준으로 재도출됐다는 기록이 파일에 없다"** 이고 FU-1 의 필요성은 이 진술로 성립한다. 10종 중 6종만 파라미터화되어 있어 640 상한표(10행)와 1:1 대응하지 않는다.

#### D1-a — 제외 목록은 열거로 확정한다

rev 2 는 "`slots.json` 이 없는 Paper 전용 **8장**(S00·S01·C01~C07·D01)은 제외"라고 적었는데 **열거는 2 + 7 + 1 = 10항목**이다. 두 수는 서로 다른 전제에서 왔다("8" = 스펙 L96 의 104 − 96, 열거 = 비CC 목록 − A 계열). 스펙 L96 자체도 정합하지 않는다 — **13개 이름을 열거하면서 "12장"이라고 부른다.** 범위는 D1 이 **비가역**으로 선언한 것이므로 합이 맞지 않는 정의로 비가역 구간에 들어갈 수 없다.

**결정: "8장"이라는 수를 삭제한다.**

```
제외 집합 = (카드 페이지 5-1 의 아트보드 name 집합) - (index.json 의 name 집합)
```

Step 0c 프로브가 계산해 `$EV/excluded-boards.json` 에 **열거**로 기록하고 **W3 시작 전 동결**한다. 사용자가 나중에 포함을 원하면 그 보드는 **주석 전용**으로 처리하고 AC-11 을 면제하며, 그때 대상 수는 이 열거에서 읽고 추정하지 않는다.

#### D1-b — D1 은 스펙 L96 의 가정을 무효화한다

스펙 L96 은 A02/A04/A05 호가 보드를 **의미적** 근거로 제외한다("카드가 아니라 상태·변형·**검증** 보드"). D1 은 같은 4장을 **기계적** 근거(`card_id` 등록)로 포함하므로, **D1 은 스펙 L96 의 가정을 명시적으로 무효화하는 사용자 결정**이다.

포함 근거: **4장 중 3장**은 `operation_refs` 로 실제 TR 에 묶여 런타임 도달 가능하다(`1JPU-0` **9** · `1WOB-1` **7** · `3N4O-0` **5**). 그러나 **`1JZW-0` 의 `operation_refs` 는 빈 배열 `[]`** 이다(96보드 중 유일). `1JZW-0` 의 포함 근거는 다르게 세운다 — **CC-04 `card_id` 등록 + `slots.json` 존재 + "등록 보드 전부에 `kiumi`"라는 예외 없는 불변식**. 이 보드는 R4 fallback 조차 탈 수 없고 R1(CC-04 → `table`)로만 문법이 정해지며, 값 출처는 슬롯 기반이라 영향받지 않는다. 반대로 이 4장을 빼면 AC-K1 이 `96/96` 이 아니라 `92/96 + 예외 목록`이 되어 예외가 조용히 늘어난다.

### 4.2 Wave 구조

대상을 **부모 보드 계보**로 묶는다(상태 변형은 부모의 문법을 상속하는 것이 자연스럽고 대장 검토량을 줄인다).

| Wave | 대상 | 보드 수 | 병렬 | Paper 쓰기 | 산출 |
|---|---|---|---|---|---|
| **W0** | 브랜치·기준선·스키마·규칙·스크립트 저작 | — | 직렬 | 읽기만 (0c·0d) | 브랜치, G0 증거 9종, `kiumi` 스키마, 배정 규칙, 검사기·기준선 스크립트 |
| **W1** | 대장 제안 생성 | 96 | 스크립트 1회 | 없음 | `kiumi-ledger.jsonl` 제안본 |
| **W2a** | CC-01 account | 14 | 에이전트 A | **없음** | 대장 비준 |
| **W2b** | CC-02 order + CC-04 orderbook | 15 | 에이전트 B | **없음** | 대장 비준 |
| **W2c** | CC-03 instrument (default+tab) | **11** | 에이전트 C | **없음** | 대장 비준 |
| **W2d** | CC-03 instrument (sort+expand) | **20** | 에이전트 D | **없음** | 대장 비준 |
| **W2e** | CC-05 flow | 15 | 에이전트 E | **없음** | 대장 비준 |
| **W2f** | CC-06 explorer | 21 | 에이전트 F | **없음** | 대장 비준 |
| **W2g** | **디자이너 템플릿 레인 + 640 상한 도출 + 표본 12장 + 라이브 대조 1장** | 11 + 프로브 + 12 | **단독 Paper 레인** (W2a~f 와 병렬) | **예** | 템플릿 11 · `KIUMI_LIMITS_640` · 표본 12 · `approved-templates.json` · `sample-provenance.json` · `live-paper-spotcheck.json` |
| **G11-6** | **마일스톤 PDF 사용자 승인 (23장)** | 23 | 사용자 | — | **W3 하드 블로커** |
| **CP-1** | **W2→W3 경계 체크포인트 (3조건)** | — | 직렬 | 읽기만 | `paper-checkpoint-w2w3.json` |
| **W3** | 생성 — `kiumi` 필드 + Paper 미니 + `note` 주석. **24장 × 4배치**, 배치 경계마다 (a) 키우미 페이지 + **카드 페이지** 재스냅샷 (b) **부분 Paper 스냅샷 → AC-2/9/9b 실행** (c) 컨택트시트 PDF 통보 | 96 | Paper 쓰기 **단일 직렬 레인** | 예 | 산출물 |
| **W4** | 대응 보드 + 보드 09 갱신 | 2 | 직렬 | 예 | 산출물 |
| **W5** | Paper 전량 스냅샷 + 게이트·검증 | — | 직렬 | 읽기만 | `paper-snapshot.json`, 통과 증거 |
| **W6** *(rev 6 신설)* | **Step 6 재작업** — 부기 게이트가 Step 6 에서 차단으로 승격되므로 **일부 보드의 Paper 재생성은 예외가 아니라 설계된 기대**다 | ≤96 | **Paper 쓰기 단일 직렬 레인** | 예 | 재생성분 |

**W6 규율** *(rev 6 — Architect 개선 11)*: rev 5 는 Step 6 재작업 구간에 레인 선언도, 배치 경계 재스냅샷도, 재개·중단 규칙 적용도 없었다. W6 는 W3 과 **같은 규율** 아래 둔다 — Paper 쓰기 단일 직렬 레인 · 재생성 대상이 **12장을 넘으면 배치로 쪼갠다** · 각 경계에서 키우미 페이지 + 카드 페이지 `(node_id, name)` 재스냅샷 · §4.0 재개·중단 규칙 (a)~(e) 적용.

**레인 수 정정.** 실측 `index.json` 의 CC-03 31장 `state.kind` 분포는 **`default 3 · tab 8 · sort 15 · expand 5`** 다. 따라서 W2c(default+tab)는 **11**, W2d(sort+expand)는 **20** 이다. 레인 합계 14+15+11+20+15+21 = **96** 으로 변하지 않으나, 이 수에 걸려 있던 **Step 4b 배치 규칙**은 `{14,15,11,20,15,21}` 의 어떤 부분집합도 24 가 아니고 계열 묶음 `{14,6,31,9,15,21}` 도 마찬가지여서(CC-03 만으로 31) **실행 가능한 해가 없는 지시**였다 — Step 4b 가 절단 규칙을 명시적으로 다시 쓴다.

**Paper 동시성 불변식**: 어느 시점에도 Paper 쓰기 레인은 최대 1개다. W2 구간에서 그 1개는 W2g 이며 W2a~W2f 6 병렬은 텍스트(대장)만 다룬다. 이것이 R-5 의 1차 방어이고, **기전은 도구 차단(§4.0 (a))이며 경계 검사는 CP-1** 이다.

**W3 를 4배치로 쪼갠 이유.** (a) 외부 편집 탐지가 96장 뒤가 아니라 **24장 뒤**로 당겨진다. (b) 헌장 `docs/ui/paper-card-surface-charter.md:163` 의 **10% 단위 전 보드 검수 규칙**이 통보 형태로 **축소 복원**되어 G11-6 이 전제한 "96장은 승인된 템플릿의 기계적 전개"가 가정이 아니라 **배치마다 관찰**된다. (c) **부분 스냅샷으로 AC-2/9/9b 를 배치 단위로 실행**할 수 있게 되어, §3.1 이 그 셋을 W3 구간 상시 차단으로 선언한 것이 처음으로 실행 가능해진다.

**640 상한 도출을 W2g 에 두는 이유.** 행 높이·chrome 높이·고지 줄바꿈은 전부 *승인 대상 템플릿*의 속성이므로 승인되지 않은 프로브 마크업에서 잰 값은 96장 **비가역** 쓰기의 근거가 될 수 없다. §4.4 전체가 W2g 안에서 실행되고, 상한은 **승인 대상 템플릿 자체를 넘칠 때까지 채워** 도출한다.

### 4.3 문법 배정 규칙 (DD-2 해소) — 결정론적 제안 규칙

**enum 10종** (정본은 스펙 L41 과 보드 09):
`table` · `chart` · `facts` · `compound` · `order_ticket` · `order_confirm` · `event` · `auth` · `reader` · `stream`

> 주의: `app/lib/orb-mini-card.js:6-7` 은 **캔버스 9종**을 "미니 10종으로 받는다"고만 적고 미니 10종의 이름을 열거하지 않는다. enum 문자열의 정본은 코드가 아니라 스펙 L41 · 보드 09 이며, 이 계획이 `scripts/kiumi_limits.py` 에 10개 문자열을 상수로 고정해 AC-3 의 검사 대상을 만든다.

**측정으로 확인한 것**

- 권위 있는 "동일 호출 로직" 출처는 `resolve_screen_render_contract(operation_ref)` 다(`backend/athena_api/canvas_transform.py:395`). **카드 봉투 경로의** 소비처는 `backend/athena_api/api/canvas_push.py:1356-1358` 의 `_screen_contract()` 래퍼이고 유일한 호출 지점은 `canvas_push.py:1754` 다. 단 `resolve_screen_render_contract` 자체는 카드 경로 밖에서도 호출된다 — **프로덕션 5곳**(`canvas_push.py:1357` · `api/chart_page.py:76` · `api/series_page.py:93` · `canvas_transform.py:527`(**chart 분기**) · `:674`) **+ 테스트 1곳**(`backend/tests/unit/test_canvas_transform.py:432`).
- 도달 가능한 canvas kind 는 `facts` / `table` / `compound` / `chart` **4종뿐**이다. 앵커는 **`_RENDER_PLAN_LAYOUTS`(`canvas_transform.py:319` = `frozenset({"facts","table","compound"})`) + `resolve_render_plan_kind`(`:789`)의 chart 분기(`:807-808`)** 다. 실측 확인(`:806-814`): `:806` renderer_id 읽기 · `:807-808` chart · `:809-810` non-null → `None` · `:811-813` layout · **`:814` layout 밖 `return None`**. `event`·`auth`·`reader`·`stream` 은 카드 op 가 아니라 별도 봉투 경로에서 나온다(`canvas_push.py:845` action · `:853` event/status · `:1580` · `:1648`).
- **이름 부분문자열 규칙(rev 1 의 R2)은 삭제한다** — 조용히 오배정하고 AC-K4 는 그것을 "규칙 일치"로 통과시켜 감사를 무력화한다. 대신 **`chart` 를 override 전용으로 내린다.**

**제안 규칙 = 우선순위 사슬** (앞이 이기며, 각 단계는 근거 필드 `rule` 을 함께 기록)

```
R1  family override
    card_id == CC-02  -> state.kind=='default' ? order_ticket : order_confirm
    card_id == CC-04  -> table                       # 호가 사다리는 표
R2  (삭제됨 - 이름 부분문자열 규칙은 조용한 오배정을 만든다)
R3  structure
    counts.tables>0 and density.kpi_cells>0 -> compound
    counts.tables>0                          -> table
    density.kpi_cells>0                      -> facts
R4  fallback  lead_canvas_kind(operation_refs) or "facts"   # 아래 정본 정의
R5  chart / event / auth / reader / stream 은 자동 배정하지 않는다
    - 대장 override 로만 부여하며 override_reason 필수
R6  구조 가드
    사슬이 grammar=='table' 을 냈는데 counts.tables == 0 이면
    배정하지 않는다: grammar=None, structure_missing=True 를 대장에 남기고
    W2 비준의 명시 판정 대상으로 올린다 (chart override 와 같은 취급).
    AC-K4(c) 가 structure_missing 레코드에 override_reason 을 강제한다.
```

**R4 정본 정의** — 다른 읽기를 불가능하게 만든다.

```python
# scripts/kiumi_grammar_rule.py — 이 함수 그대로가 R4 의 정의다.
def lead_canvas_kind(operation_refs: list[str]) -> str | None:
    """operation_refs 를 순서대로 훑어 resolve_render_plan_kind 가
    None 이 아닌 첫 값을 돌려준다. 전부 None 이면 None."""
    for ref in operation_refs:
        kind = resolve_render_plan_kind(ref)
        if kind is not None:
            return kind
    return None

# R4:  grammar = lead_canvas_kind(board.operation_refs) or "facts"
```

⚠️ **`resolve_render_plan_kind(operation_refs[0])` 로 구현하면 안 된다.** 두 읽기가 서로 다른 분포를 내는데 Step 1 의 Acceptance 가 분포표와의 일치이므로, 문자 그대로 읽으면 **자기 게이트를 스스로 실패시키고 진단 경로가 없다**.

| 읽기 | table | facts | compound | order_confirm | order_ticket | 단계 분포 |
|---|---:|---:|---:|---:|---:|---|
| `operation_refs[0]` (문자 그대로) | **26** | **14** | 50 | 5 | 1 | R1 15 · R3a 50 · R3b 9 · R3c 10 · R4 12 |
| **첫 non-None** ✅ 정본 | **28** | **12** | 50 | 5 | 1 | R1 15 · R3a 50 · R3b 9 · R3c 10 · R4 12 |

단계 분포는 **두 읽기가 동일**하므로 차이는 오직 문법 총계에서만 드러난다 — 실행자가 단계 수만 대조하면 오류를 못 잡는다.

**분기점이 되는 두 보드 (worked example)**

| board_id | 이름 | `operation_refs` | `[0]` 의 kind | 첫 non-None | 문자 그대로 → | 정본 → |
|---|---|---|---|---|---|---|
| `3BQB-0` | CC-06 / R04-T1-X · 업종 — 업종 목록 펼침 | `['base:0J', 'base:ka10101']` | `None` | `table` | `facts` ❌ | **`table`** ✅ |
| `1WOB-1` | A05 · 목록 펼침 검증 — 외국인 기간별 매매 상위 | `['base:0F', 'base:ka10034', … 7개]` | `None` | `table` | `facts` ❌ | **`table`** ✅ |

Step 1 Acceptance 는 이 두 행을 **명시 단위 테스트**로 요구한다(`test_r4_lead_is_first_non_none`).

**R1+R3+R4 실행 결과 — ⚠️ `R6` 적용 *전* 분포 (96보드 실측, 정본 읽기)**

| 문법 | 보드 수 | 규칙 단계 | 보드 수 |
|---|---:|---|---:|
| `compound` | 50 | R1 (CC-02 6 + CC-04 9) | 15 |
| `table` | 28 | R3a (tables>0 & kpi>0) | 50 |
| `facts` | 12 | R3b (tables>0) | 9 |
| `order_confirm` | 5 | R3c (kpi>0) | 10 |
| `order_ticket` | 1 | R4 (fallback) | 12 |
| **합계** | **96** | | **96** |

**R6 적용 *후* 분포 — Step 1·Step 2 Acceptance 의 판정 대상**

| 문법 | 보드 수 |
|---|---:|
| `compound` | 50 |
| `table` | **17** |
| `facts` | 12 |
| `order_confirm` | 5 |
| `order_ticket` | 1 |
| **`grammar is None`** (`structure_missing: true`) | **11** |
| **합계** | **96** |

**왜 두 표가 필요한가.** R6 대상 11장은 "R6 전" 표의 `table` 28장의 **부분집합**이므로, Acceptance 가 `table 28` 과 `structure_missing 11` 을 동시에 요구하면 한 스크립트가 두 조항을 만족할 수 없다 — 네 번째 리비전 연속의 "구성상 통과 불가능한 Acceptance"였다. **`grammar is null` 0건은 Step 3(비준) Acceptance 에서만 요구한다.**

- R1/CC-02 검증: `135M-2`(default) → `order_ticket` 1장, `2T63-1`·`2TAG-1`·`2TET-1`·`2TJ6-1`·`2TNJ-1`(tab) → `order_confirm` 5장.
- R4 내역: lead=`table` 10장(`2XG6-0`·`2XKO-0`·`2XP6-0`·`2XTO-0`·`2YA8-0`·`2YEQ-0`·`2YJ8-0`·`2YNQ-0`·`3BQB-0`·`1WOB-1`) + lead=`None` 2장(`15L8-2`, `15R0-2` → `facts`).

**`chart` override — 손 목록이 아니라 규칙이 만든 파생 필드**

대장 레코드에 **`chart_capable = any(resolve_render_plan_kind(ref) == "chart" for ref in board.operation_refs)`** 를 **규칙이 채우고**, AC-K4(b)가 "`chart_capable` 레코드는 `grammar == "chart"` 이거나 `override_reason` 비어있지 않음"을 강제한다. 배정을 강제하지 않으므로 양가 보드의 판단권은 사람이 유지하되 **목록 밖 chart 보드가 조용히 다른 문법으로 확정되는 경로가 닫힌다**.

| board_id | 이름 | 규칙 제안 | `chart_capable` | 비준 판단 |
|---|---|---|---|---|
| `137X-2` | CC-03 / R01 · 삼성전자 3개월 차트 | `facts` (R3c) | ✅ | chart override 유력 |
| `2RJ7-1` | CC-03 / R01-T3 · 금현물 — KRX 금시장 차트·시세 | `compound` (R3a) | ✅ | 진짜 양가 보드 — 사람이 결정 |
| `32S7-0` | CC-03 / R01-T7 · 차트 — 업종 지수 | `facts` (R3c) | ✅ | chart override 유력 |
| ~~`2TZN-1`~~ | ~~CC-06 / R04-T1 · 업종~~ | `table` (R3b) | ❌ **후보에서 내린다** | 16개 ref 의 kind 가 전부 `facts`/`table`/`None` — chart 가능 ref **0개** |

**구조 가드 대상 (R6)** — 규칙이 `table` 을 냈는데 표 구조가 **아예 없는** 보드가 실측 **11장**이다(`counts.tables == 0` and `density.table_columns == 0` and `density.rows_max == 0`): `1WOB-1`(values 227) · `2XG6-0`(90) · `2XKO-0`(89) · `2XP6-0`(90) · `2XTO-0`(95) · `2YA8-0`(91) · `2YEQ-0`(90) · `2YJ8-0`(91) · `2YNQ-0`(90) · `3BQB-0`(36) · `3N4O-0`(148). 여기에는 **R4 worked example 2장이 모두** 들어 있고 D1-b 가 포함 근거를 세운 A 계열 2장도 들어 있다. `template/table` 은 '행'을 슬롯 구조로 확정하는데 이 11장에는 **행의 원천도, 접은 열/행 수의 원천도 없다**. 단계 내역: `3N4O-0` R1, 나머지 10장 R4.

**핵심**: 이 규칙은 **제안만** 한다. 대장에 기록된 값이 계약이며 규칙과 다르면 `override_reason` 이 필수다. R5·R6 때문에 10종 중 일부가 0장일 수 있고 이는 결함이 아니다 — AC-3 은 "각 미니가 10종 중 하나"를 요구할 뿐 10종 전부의 사용을 요구하지 않는다.

### 4.3b 접힘 고지 계약 (AC-5 의 오라클)

**문제.** `app/lib/orb-mini-card.js` 의 `foldNote`(함수 범위 **`:130-153`**)는 kind ∈ {`table`, `facts`, `compound`, `log`, `reader`} **5종만** 분기하고 나머지는 무조건 `null` 을 돌려준다(**`:152`**, 실측 확인). §4.3 enum 은 10종이므로 `chart`·`order_ticket`·`order_confirm`·`auth` 는 분기가 없고 `event`·`stream` 은 코드 kind 이름이 `log` 다.

**Critic 처방을 측정이 반증한 지점.** "고지 문구 없는 4종은 `folded == 0` 을 구성상 강제(후보 전량 적재 또는 문법 재배정)" — **후보 전량 적재는 불가능하다**: CC-02 6장의 `kind=="value"` 슬롯 수는 23·23·26·25·24·24 로 360×640 에 스크롤 없이 담을 수 없다(스펙 L40). 문법 재배정도 답이 아니다 — 주문 티켓/주문 확인은 스펙 L41 이 못박은 **그 카드에 맞는 바로 그 문법**이다.

**해결: 오라클을 계획이 소유하되 JS 와의 정합을 테스트로 못박는다.** `scripts/kiumi_limits.py` 의 `kiumi_fold_note(grammar, notice) -> str | None` 가 AC-5 의 **유일한** 판정 함수다.

| 문법 | foldNote kind 사상 | 고지 문구 | 채우는 `notice` 필드 → JS `counts` 키 | 출처 |
|---|---|---|---|---|
| `table` | `table` | `열 {columns}개 · 행 {rows}개를 접었습니다 — 전체는 캔버스에서` | `columns → columns` · `rows → rows` | JS **`:134`** (가드 `:133`) |
| `facts` | `facts` | `항목 {items}개를 접었습니다 — 전체는 캔버스에서` | `items → items` | JS **`:138`** (가드 `:137`) |
| `compound` | `compound` | `스칼라 {scalars}개 · 행 {rows}개를 접었습니다 — 전체는 캔버스에서` | `scalars → scalars` · `rows → rows` | JS **`:142`** (가드 `:141`) |
| `event` | **`log`** | `최근 {records_shown}건 · {records_total}건 중 — 전체는 캔버스에서` | `records_shown → shown` · `records_total → total` | JS **`:146`** (가드 `:145`) † |
| `stream` | **`log`** | `최근 {records_shown}건 · {records_total}건 중 — 전체는 캔버스에서` | `records_shown → shown` · `records_total → total` | JS **`:146`** (가드 `:145`) † |
| `reader` | `reader` | `첫 문단만 · 전문 {chars_total}자는 캔버스에서` | `chars_total → total` | JS **`:150`** (가드 `:149`) |
| `chart` | — (JS 분기 없음) | `계열 {items}개를 접었습니다 — 전체는 캔버스에서` | `items → —` | **본 계획 신설 → FU-4** |
| `order_ticket` | — (JS 분기 없음) | `항목 {items}개를 접었습니다 — 전체는 캔버스에서` | `items → —` | **본 계획 신설 → FU-4** |
| `order_confirm` | — (JS 분기 없음) | `항목 {items}개를 접었습니다 — 전체는 캔버스에서` | `items → —` | **본 계획 신설 → FU-4** |
| `auth` | — (JS 분기 없음) | `항목 {items}개를 접었습니다 — 전체는 캔버스에서` | `items → —` | **본 계획 신설 → FU-4** |
| *(주석 총계 — 화면 아님)* | — | `{folded_slots}개` **+** `· 표 {tables_dropped}개 전체 제외` | `slots.folded_slots` · `tables_dropped` | **AC-6 / AC-K6(D)** |

> † **`event` 와 `stream` 은 JS `:146` 한 줄을 공유한다** *(rev 6 각주 — Architect 개선 14b)*. 두 문법이 같은 `log` 분기를 쓰므로 실행자는 **두 행을 별개 구현으로 만들지 않는다.**
>
> ⚠️ **`compound` 고지 문구에는 열 항이 아예 없다**(JS `:142` = `스칼라 N개 · 행 M개`) *(rev 6 각주 — Critic 신규)*. 따라서 `compound` **50장에서는 접힌 열이 화면 어느 곳에도 고지되지 않으며**, 위 표 마지막 행의 **주석 총계가 그것을 밝히는 유일한 정직 표면**이다 — AC-K6(D)와 AC-6 이 실일을 하는 지점이다.
>
> **`notice` 가 7필드인 이유**: rev 4 는 4필드(`columns, rows, items, scalars`)만 정의하면서 `event`/`stream` 문구에 `{shown}`·`{total}` 을, `reader` 문구에 `{total}` 을 남겼다 — **오라클이 세 문법에서 입력을 찾을 수 없었고** `test_fold_note_matches_js` 가 구현 불가여서 Step 1 Acceptance 가 초록이 될 수 없었다. 파일이 이를 확정한다: `app/lib/orb-mini-card.js:131` 은 `const { columns = 0, rows = 0, items = 0, scalars = 0, total = 0, shown = 0 } = counts;` 로 **6키**를 분해한다(실측). 계획 쪽 이름을 나눠 둔 이유는 **`reader` 의 `total` 이 글자수라 의미가 다르기 때문**이다 — 같은 이름을 쓰면 세 문법이 한 필드를 공유해 다시 중의적이 된다.

**두 개의 강제 조항** (`test_kiumi_field.py` 가 고정):

1. **JS 정합** — 위 표 앞 6행에 대해 `kiumi_fold_note(grammar, c)` 의 출력은 `foldNote(mapped_kind, c)` 출력과 **문자열 완전 일치**해야 한다. 테스트가 JS 파일에서 문구 템플릿을 **정규식으로 추출**해 대조하므로 **행 번호를 고정 근거로 삼지 않는다**(위 행 번호는 독자용 앵커다). 누군가 JS 를 고치면 테스트가 붉어진다(D3 가 파일을 동결하므로 회귀 탐지 전용).
2. **0-조건 보존 + 0-부분 억제** — JS 의 "실제로 접었을 때만 문자열을 낸다"(보드 09 규칙 2, `:16` 실측)를 신설 4종도 지킨다: 해당 카운트가 0 이하면 `None`. **여기에 더해 0 인 부분을 문구에서 뺀다** — JS `table` 분기는 `columns <= 0 && rows <= 0` 일 때**만** null 이므로(`:133`) `columns == 0, rows == 5` 면 `열 0개 · 행 5개를 접었습니다` 를 내는데, 이는 보드 09 규칙 2("0개 고지 금지")에 어긋나면서 AC-7 화이트리스트(숫자 자리를 `\d+` 로 치환)를 그대로 통과한다. 오라클은 0 인 쪽을 제거하고 남은 부분만으로 문구를 만든다(예 `행 5개를 접었습니다 — 전체는 캔버스에서`). **JS 와의 이 괴리는 `test_fold_note_matches_js` 가 두 부분 모두 양수인 케이스만 대조하고, 0-부분 케이스는 `test_fold_note_zero_part_suppressed` 가 계획 정의를 고정한다.** 해소는 **FU-4** 로 이월한다.

### 4.4 640 상한 재도출 방법 (AC-8) — **실행 위치: W2g / Step 3′b**

1. **측정 대상은 W2g 가 저작 중인 문법 10종 템플릿 그 자체다.** 별도 프로브 마크업을 만들지 않는다 — 템플릿을 복제해(`probe/<grammar>`) 행·항목·글자를 1단위씩 올리며 **넘칠 때까지 채운다.**
2. 각 단계에서 `get_computed_styles` 로 콘텐츠 실측 높이를 읽는다 (**스크린샷 눈대중 금지** — Paper MCP 지침 및 메모리 `paper-mcp-screenshot-viewport`).
3. **chrome 정의**: `chrome` = **박스 안** 요소만 = 제목 행 실측 높이 + **그 문법에서 나올 수 있는 최장 고지 문자열을 360px 폭에서 실측한 높이**.
   - **출처 주석 4항목은 chrome 에서 제외한다** — AC-6(스펙 L64)이 "**보드 아래** 출처 주석"이라 규정하므로 640 아트보드 밖(`note/*`)에 놓이고 640 예산을 잡아먹지 않는다.
   - **"최악값: 고지 있음" 만으로는 부족하다** — §4.3b 의 실제 문구는 길이가 크게 다르고 360px 에서 표·복합 문구는 2줄로 감길 가능성이 높다. 문법마다 자기 문구에 **자릿수 최대치**를 넣어 실측한 높이를 쓴다. 근거: `kind=="value"` 슬롯 수 최댓값은 **`2VIN-0` 304**(상위 304 · 276 `2ZHC-0` · 266 `2YXS-0` · 257 `30C1-0` · 256 `2Y47-0`, 전부 CC-03) → **3자리**.
   - **값 문자열 길이도 본문 예산에 반영한다.** 각 문법의 채우기에 **그 문법이 실제로 받게 될 최장 값 문자열**을 넣어 실측한다. **"대장 후보 집합"의 정의를 못박는다** *(rev 6 — Architect 개선 9)*: **(a) 그 문법으로 배정된 보드들의 `kind=="value"` 슬롯 전체**(Step 2 규칙 1 의 `candidate_count` 모집단)이며, **`elements[]`(선택 결과)가 아니다** — 후자로 읽으면 선택이 상한에 의존하므로 **순환이 되어 W2g 가 멈춘다**. Step 3′b Acceptance 는 문법별 최장 값 문자열 길이의 **실측값을 기록**한다.
     - 참고 실측(전역 최장 4개): **75자** `3LGC-0 s109`(unit `count`) · 67자 `137X-2 s138`(`percent`) · 53자 `3DI2-0 s220`(`date` → 값 보존 불변식상 **항등 전용**이라 360px 에서 3줄 이상으로 감긴다) · 50자 `2SRV-1 s124`(`percent`). **이 수치를 미리 적어 두면 상한이 예상보다 낮게 나오는 것이 놀람이 아니라 예측이 된다.**
   - **후보 집합이 확정되지 않은 채로 재지 않는다.** 도출 시점의 `(board_id → grammar)` 사상을 **`$EV/limits-input-assignment.json` 에 기록**하고 CP-1(2)가 최종 대장과 대조한다. W2 비준이 **최대 14보드**(`chart_capable` 3 + `structure_missing` 11)의 배정을 바꿀 수 있고, 한 장이 옮겨가면 그 보드의 최장 값 문자열이 다른 문법의 후보 집합으로 이동한다.
4. `측정높이 <= 640 − chrome` 을 만족하는 최대 N 을 채택하되 **1행 여유**를 남긴다.
5. 산출: 문법 × (rows/items/chars, 그 상한에서의 실측 높이, `content_bbox_height`, `realized`, `derived_from`, `approved_template_sha`) **10행** 표. 값은 `kiumi_limits.py::KIUMI_LIMITS_640` 과 보드 09 두 곳에 동일하게 기록(AC-8(c)).
   - **`realized` 는 최종 대장에 그 문법의 보드가 1장이라도 있는가**로 정해지며 **W2 비준 종료 후 CP-1 에서 확정한다**. R6 후 기준 확정 예상: `compound` 50 · `table` 17 · `facts` 12 · `order_confirm` 5 · `order_ticket` 1 + W2 가 확정하는 `chart`(≤3) 및 `structure_missing` 11장의 귀착 문법.
   - `realized: true` 행은 `derived_from == "approved-template"` **and** `approved_template_sha` 를 요구한다 — **시각이 아니라 해시다**(AC-8(d)).
6. `probe/*` 아트보드는 상한표 확정 후 삭제하지 않고 보드 09 옆에 근거로 남긴다. role 접두사 덕분에 AC-1 의 role 개수 검사에서 `probe` 로 계상되어 AC-1 을 깨지 않는다. **단 이 ≤10장은 G11-6 승인 PDF(23장)에 포함되지 않으므로** "**프로브는 상한 도출의 근거 보관용이며 승인 대상이 아니다**"를 **보드 09 각주와 G11-6 동의 문장 2번**에 명시한다.
7. 재도출 값이 현행 `LIMITS`(§4.1)와 다르면 **코드는 고치지 않고** FU-1 티켓에 차이를 표로 기록하고 보드 09 각주에 "코드 반영은 후속 작업"을 남긴다(D3).
8. **템플릿 변경 *또는 배정 변경* 시 재도출은 필수다.**
   - **(i)** G11-6 에서 어떤 문법 템플릿이 반려·수정되면 그 문법의 상한을 다시 도출하고 `approved_template_sha` 를 갱신한다.
   - **(ii)** CP-1(2)에서 최종 대장 배정이 `limits-input-assignment.json` 과 다르면 **후보 집합이 바뀐 문법만** 다시 도출한다(옮겨간 보드의 이전 문법과 새 문법 두 행만 영향).
   - **(iii)** *(rev 6 신설 — Architect 개선 10 + Critic 보강)* **전이가 `realized: false → true` 이면 상한 재도출만으로 부족하고 그 문법 템플릿의 G11-6 재승인이 필요하다.** 근거: Step 3′a 는 보드 0장인 4종(`event`·`auth`·`reader`·`stream`)에 대해 **헌장 수준 디자인과 사용자 승인을 면제**하는데, `structure_missing` 11장의 귀착 문법을 W2 가 정하므로 그 중 한 장이 이 4종으로 가면 **사용자가 "보드 0장"이라 듣고 승인 면제한 템플릿으로 실제 보드가 찍힌다**. **판정 시점을 CP-1 로 당긴다** — AC-8(d)는 부기 게이트라 Step 6 에서야 차단되고, 거기서 걸리면 재승인 + 재도출 + 해당 보드 재생성(W6)이 한꺼번에 필요해진다.
   - 어느 경우든 갱신되지 않은 값으로 W3 에 들어가지 않는다.

### 4.5 Steps

#### Step 0 — 브랜치 · 기준선 고정 (W0 전반)

- **0-0. 브랜치 생성** — `git checkout -b kiumi/mini-cards` (from `main`).
  ⚠️ **stash 하지 않는다** — `backend/ref/card-surface-templates/` 는 전체 untracked 이므로 워킹 트리를 그대로 데려가야 한다(§1.1, R-9). 현재 `main` 은 워킹 트리가 dirty 하고 `kiumi/*` 브랜치는 존재하지 않는다(실측). *(origin 대비 뒤쳐진 커밋 수는 측정 시점마다 변하는 값이므로 가드레일의 근거로 쓰지 않는다 — rev 6 인용 정정.)*
- **0a. 기준선 스크립트 3개를 저작한다.** rev 2 는 Step 0 이 이들을 *사용*한다고만 적고 어느 Step 도 저작하지 않았다(실측: `scripts/` 에 `kiumi_*` 파일 **0개**, `validate_kiumi_field.py` 부재).
  - `scripts/kiumi_baseline.py` — `load_registry(TEMPLATE_ROOT)` 예외 문자열을 `;` 로 분해하고 각 세그먼트에서 `board '<id>'` 패턴으로 board_id 를 뽑아 `(board_id, problem)` 키 집합을 만든다. `--write` / `--compare` / `--foreign`. 파싱 근거(실측): 225 세그먼트 전부가 그 형태이고 board_id 없는 세그먼트는 **0건**이다.
  - `scripts/kiumi_tree_manifest.py` — `backend/ref/card-surface-templates/**` 전 파일 sha256 + **`kiumi` 키 제거 canonical-JSON sha256**(AC-K3(b1)) + **최상위 키 순서열**(b2) + `index.json` 해시(c) + **도구 3종 sha256**(d). `--write` / `--compare` / `--html-only`.
  - `scripts/kiumi_slots_diff.py` — `scripts/validate_board_slots.py` 를 **수정하지 않고 import** 해(`check_board`:142 · `tally`:261 · `visible_fields`:46 · `hidden_fields`:58 · `board_dirs`:302 · `TALLY_KEYS`:250 · `TEMPLATE_ROOT`:34 · `DEFAULT_PACK_DIR`:37, 전부 실측 확인) `{board_id: {tally_letter: count}}` 를 직접 만든다. `--write $EV/slots-baseline.json`(G0) / `--compare`(G4). **stdout 을 파싱하지 않는다** — `print_report`(`:278`)의 출력 포맷 변경에 취약해지지 않기 위함이다.
- **0b. 기준선 기록** — 산출 경로는 **`backend/ref/kiumi/evidence/`**(`.omc/` 는 `.gitignore:9` 로 무시되어 정본이 될 수 없다):
  - `$EV/kiumi-baseline.json` · `$EV/kiumi-tree-manifest.json` · `$EV/slots-baseline.json`.
- **0c. 제외 보드 열거 + 카드 페이지 기준선** *(rev 6 확장 — Architect 블로킹 1)*. `open_file(카드 페이지 5-1)` → `find_nodes` 로 아트보드를 뽑아:
  - **이름 집합** − `index.json` `name` 집합 = 제외 집합 → `$EV/excluded-boards.json` 에 **열거**로 기록(D1-a). 수("8장")를 쓰지 않는다.
  - **`(node_id, name)` 전량**을 `$EV/paper-baseline.json` 의 **`card_page_nodes`** 에 기록하고, **`2SCE-1` 은 `sha256(get_jsx)` 도 함께 남긴다**.
  - **읽기 후 즉시 `open_file(C-2)` 로 복귀**한다(§4.0 활성 페이지 단언과 R-5(5)를 함께 지키기 위함).
  > **왜 필요한가**: rev 5 는 "동시 세션이 카드 페이지 원본 아트보드를 건드리면 어떤 게이트도 붉어지지 않는다"고 진단해 놓고 다음 세 항목에서 카드 페이지를 뺐다. 계획은 카드 페이지를 Step 0c·Step 3′b-3 에서 두 번 열고 Step 5a 에서 `2SCE-1` 을 클론하므로, 기준선·사후 대조·활성 페이지 단언이 전부 없으면 스펙 L55(확정 카드 미수정)와 원칙 5("건드리지 않았음을 증명한다")에 대한 **탐지 경로가 0** 이다.
- **0d. Paper 불변 기준 스냅샷 + 토큰 표**. 키우미 페이지에 대해:
  - 보드 05(`5EU-0`) `sha256(get_jsx)` — AC-16.
  - **키우미 페이지 `C-2` 전체의 `(node_id, name)` 집합** — CP-1/배치 경계/G8/G10 의 대조 기준. 이 열거가 `pre_existing` 집합의 정본이며 AC-1(c)(d)의 범위를 정한다.
  - **보드 해시 2분할**: **(i) `frozen_boards` = 보드 01~08** 각각의 `sha256(get_jsx)`(전 구간 불변) · **(ii) `board09_pre` = 보드 09(`2LFW-2`)**(Step 5b 가 **의도적으로 갱신**하므로 불변 집합에 둘 수 없다). 보드 09 는 2단 검사한다: **(1) Step 5b 직전 == `board09_pre`** · **(2) Step 5b 직후 해시를 `board09_post` 로 기록**.
  - **`get_tokens()` 1회 호출 → `$EV/paper-tokens.json`** *(rev 6 신설 — Architect 블로킹 6)*: 토큰→실효값 표를 동결한다. AC-9b 의 `color_token` 은 이 표에 대한 **정규화 완전 일치**로 정의되고, 어느 값과도 일치하지 않으면 `null` 로 기록해 **위반으로 판정**한다.
  - 산출: `$EV/paper-baseline.json`.
- **0e. AC-7 면제 목록 생성**. 96보드 전 슬롯 `paper_text` 를 AC-7 금칙 정규식으로 스캔해 히트한 슬롯을 **`backend/ref/kiumi/copy-exempt.json`** 에 `{board_id, slot_id, paper_text, pattern}` 으로 열거하고 **W3 전 동결**한다. 기대값: **22 슬롯**(`[0-9]\s*[MKB]\b` 10 + `1호가` 12; 나머지 3개 금칙은 0건), **전 항목 `kind=="value"`**.
- **0f. 라벨 불가 행 셀 열거**. 행 밴드 value 슬롯 중 `kor` 도 없고 `(table.table, table.col)` 좌표에 머리 라벨 슬롯도 없는 셀을 **`$EV/unlabelable-row-cells.json`** 에 열거하고 W3 전 동결한다. 이 셀들은 요소로 **선택 금지**이며 `candidate_count` 에는 남는다. 기대값: **정확히 2개** — `2QRP-1 s039`(`table 2QT1-1 · row 0 · col 4`, `+100`) · `2QRP-1 s058`(`row 1 · col 4`, `−200`).
- **0g. 스칼라 라벨 fallback 보드 열거** *(rev 6 신설 — Architect 블로킹 4)*. 스칼라 밴드에서 `kor` 보유 슬롯만으로 그 문법의 상한을 채울 수 없는 보드를 **`$EV/scalar-label-fallback-boards.json`** 에 열거하고 W3 전 동결한다. 기대 후보: `kor` 스칼라 5개 미만 **13장**(0개인 **4장** `2TJ6-1`·`2TNJ-1`·`2ZHC-0`·`2ZZ7-0` 포함). 최종 목록은 확정된 상한(W2g)에 따라 달라지므로 **CP-1 에서 재확정**한다.
- **0h. 항등 전용 값 열거** *(rev 6 신설 — Architect 블로킹 2)*. 수치형 unit 이면서 숫자 토큰이 정확히 1개가 **아닌** 슬롯을 **`$EV/identity-only-values.json`** 에 열거하고 W3 전 동결한다. 기대값: **848개**(토큰 2개 755 · 3개 64 · 4개 13 · 5개 9 · 6개 4 · 7개 2 · 0개 1). 이 슬롯들의 값은 `kiumi_reformat` 이 **항등만** 허용한다.
- **0i. 기준선 커밋** *(rev 6 신설 — Architect 개선 12)*. Step 0 종료 직후 `$EV/*baseline*.json` · `$EV/kiumi-tree-manifest.json` 을 **커밋한다.** 이후 G2b·G4 가 `git diff --quiet` 로 이 파일들의 불변을 확인한다(AC-K9) — 그러지 않으면 기준선이 AC-K8 허용 경로 안이라 재실행·덮어쓰기가 어떤 게이트도 붉히지 않아 **게이트가 스스로를 무효화할 수 있다**.

**Acceptance**: 브랜치 존재 · 스크립트 3개 실행 가능 · 증거 파일 **10개**(`kiumi-baseline.json` · `kiumi-tree-manifest.json` · `slots-baseline.json` · `excluded-boards.json` · `paper-baseline.json`(카드 페이지 노드 + `2SCE-1` 해시 + `frozen_boards` + `board09_pre` 포함) · `paper-tokens.json` · `copy-exempt.json` · `unlabelable-row-cells.json` · `scalar-label-fallback-boards.json` · `identity-only-values.json`) 존재 · `excluded-boards.json` 이 **열거 목록**을 담고 개수를 자기 길이로 보고 · `copy-exempt.json` **22행**(전 항목 `kind=="value"`) · `unlabelable-row-cells.json` **2행** · `identity-only-values.json` **848행** · `kiumi-tree-manifest.json` 이 **도구 3종 해시** 포함 · **0i 커밋 완료** · 기준선 값이 §10 측정표와 일치.

#### Step 1 — 스키마 · 규칙 · 검사기 저작 (W0 후반)

**`kiumi` 레코드 스키마**:
`board_id` · `source_board`(원본 이름) · `grammar`(string|null) · `elements[]`(`{label, value, source_slot_id, value_format, label_source, band}`) · `candidate_count`(int = 그 보드 `kind=="value"` 슬롯 **전체 수**) · `source_table_node_id`(string|null) · **`tables_total`**(int) · **`tables_dropped`**(int) · `fold_counts` · `fold_note`(string|null) · `rule` · `chart_capable`(bool, 규칙이 채움) · `structure_missing`(bool, R6 이 채움) · `override_reason`(string|null) · **`label_review`**(string|null, `scalar-label-fallback-boards` 소속 보드에 필수) · `reviewed_by`(string) · `fixed: true`.

- **`fold_counts` 는 두 차원이다**:
  - `fold_counts.slots = {total, shown, folded_slots}` — 슬롯 개수 차원. `total == candidate_count`, `shown == len(elements)`, `folded_slots == total − shown`.
  - `fold_counts.notice = {columns, rows, items, scalars, records_shown, records_total, chars_total}` — 고지 개수 차원. `kiumi_fold_note` 가 소비하는 유일한 입력이며 각 값은 원본 구조에서 도출된다. **JS `foldNote` 의 `counts` 6키로의 사상은 §4.3b 표 4열이 정본**이며 이름을 그대로 맞추지 않는다.
  - ⚠️ `records_shown`·`records_total`·`chars_total` 을 `fold_counts.slots` 에서 **파생 금지**(거짓 개수 방지, 스펙 L63).
  - 문법마다 채우는 필드가 정해져 있고 **나머지는 0**(AC-K6(C)).
  - **두 차원 사이에 등식을 두지 않는다.**
- 스키마 설명을 `backend/ref/kiumi/README.md` 에 쓴다(AC-13 정본 1곳).

**저작 항목**:

| 산출물 | 역할 | 소비하는 AC/게이트 |
|---|---|---|
| `scripts/kiumi_grammar_rule.py` | §4.3 배정 규칙 (R1+R3+R4+R6, R4 는 정본 정의 그대로) | AC-K4, Step 2 |
| `scripts/kiumi_limits.py` | `KIUMI_LIMITS_640` 상수(W2g 가 채움) + `KIUMI_RENDER_THRESHOLDS` + **`kiumi_fold_note()` 오라클** + AC-7 정규식 생성기 + 10종 enum 상수 | AC-3, AC-5, AC-7, AC-8, AC-9 |
| `scripts/kiumi_reformat.py` | `kiumi_reformat(paper_text, format)` — **AC-K5 의 값 보존 불변식 그대로** 구현(토큰 1개 수치형만 `parse_number` 동일성, 그 밖 전부 항등). 임의 함수가 아니므로 G6 가 자기 참조가 되지 않는다 | AC-K5, G6 |
| `scripts/validate_kiumi_field.py` | 전 플래그(`--schema --foldnote --copy --limits --audit --provenance --fold-math --paper --geometry --annotations --render --tone --correspondence`). §3.0 스냅샷 파일만 읽고 Paper MCP 를 직접 부르지 않는다 | AC-1·2·3·5·6·7·8·9·9b·10·11·15, AC-K1·K4·K5·K6, G1·G6·G7·G7b·G8·G8b·G9·G10 |
| `backend/tests/unit/test_kiumi_field.py` | R-7 완화책이자 AC-12·G3 의 대상 | AC-12, G3 |

**`test_kiumi_field.py` 의 필수 케이스 — 열거된 것 *전부* 가 필수다** *(rev 5 는 8개를 열거하고 "위 5개"라 적어 실행자가 3개를 건너뛸 수 있었다)*:

1. `test_r4_lead_is_first_non_none` — worked example 2행(`3BQB-0`·`1WOB-1`)이 `table` 로 배정되는지. 문자 그대로 읽기면 실패한다.
2. `test_fold_note_matches_js` — §4.3b 조항 1(JS 5 kind 문구 정합, **정규식 추출** 대조). 두 부분 모두 양수인 케이스만.
3. `test_fold_note_zero_condition` — 신설 4종도 카운트 0 이면 `None`.
4. `test_fold_note_zero_part_suppressed` — `columns == 0, rows == 5` 에서 `열 0개 …` 를 내지 않는다.
5. `test_fold_note_notice_dimensions` — `notice` 7필드 중 그 문법이 쓰는 필드만 0 이 아니고, `event`/`stream`/`reader` 가 §4.3b 표대로 JS `total`/`shown` 에 사상되어 문자열이 완성된다.
6. `test_reformat_value_preserved_all_50_format_combos` — `format` **조합 50종 × 숫자 토큰 수 {0, 1, 2, 3+}** 축으로 값 보존 불변식을 잠근다 *(rev 6 축 추가 — Architect 블로킹 2)*. 토큰 1개 수치형만 `parse_number` 동일성, 나머지 전부 항등.
7. `test_grammar_rule_structure_guard` — R6: `counts.tables == 0` 인 보드에 `table` 을 배정하지 않고 `structure_missing: true` 를 남긴다(실측 11장 전부).
8. `test_chart_capable_matches_render_plan_kind` — `chart_capable` 이 정확히 `137X-2`·`2RJ7-1`·`32S7-0` 3장에서만 참이다.
9. `test_source_table_selection_is_total` — 표 2개 이상 **19장 전부**에서 `source_table()` 이 단일 값을 내고 `source_table_node_id` 와 일치한다. **`3UTA-0` 을 명시 케이스로 포함하고 `column_priority == []`(빈 리스트, 키는 존재)를 그대로 넣는다** — 판정식은 `not board.get("column_priority")` 이며 `"column_priority" not in board` 로 구현하면 분기가 죽는다 *(rev 6 — Critic 신규, 실측 확인)*. `15P5-2`·`2TRW-1` 을 **정렬 키 교체가 바꾸는 유일한 2장**으로 명시 포함한다.
10. `test_row_band_label_anchor` — 행 밴드 요소는 `label_source ∈ {"kor","head_label"}` 이고 `head_label` 라벨이 `(source_slot.table.table, .col)` 좌표 머리 라벨 슬롯 `paper_text` 와 **완전 일치**. **`2QX1-1 s045`·`s064` 를 반례 케이스**로 넣어 `column_priority` 앵커가 부활하면 붉어지게 한다.
11. `test_scalar_band_prefers_kor` *(rev 6 신설)* — 스칼라 밴드 선택이 `kor` 보유 슬롯을 우선하고, fallback 이 쓰인 보드가 전부 `scalar-label-fallback-boards.json` 안에 있다.
12. `test_tone_gate_resolves_tokens` *(rev 6 신설 — Architect 블로킹 6)* — 픽스처 3색(up · down · 중립)으로 색 환원 함수를 잠그고, 표에 없는 색이 `color_token: null` → **위반**이 되는지 확인한다.
13. `test_fixture_boards_unaffected_by_kiumi` — 픽스처 3보드(`backend/tests/fixtures/card-surface/`)에 `kiumi` 를 넣어도 로드·계약 불변(R-7).

⚠️ **640 상한표 도출은 여기서 하지 않는다.** `KIUMI_LIMITS_640` 은 Step 1 에서 **빈 자리로 선언만** 하고(`derived_from: null`), 값은 **W2g / Step 3′b 가 승인 템플릿에서 실측해 채운다**. AC-8(d)가 `approved_template_sha` 를 요구하므로 잠정값으로는 게이트를 통과할 수 없다.

**Acceptance**: `backend/ref/kiumi/README.md` 존재 · 위 5개 산출물 존재 및 `--help` 실행 가능 · `$PY scripts/kiumi_grammar_rule.py --all` 출력이 **§4.3 "R6 적용 *후*" 표와 일치**(`compound 50 · table 17 · facts 12 · order_confirm 5 · order_ticket 1 · grammar=None 11`, 합 96) · 단계 분포는 **R6 전** 기준 일치(R1 15 · R3a 50 · R3b 9 · R3c 10 · R4 12) · `chart_capable == true` 정확히 3장 · `structure_missing == true` 정확히 11장 · **위 필수 케이스 13개 전부 green**.
  - ⚠️ **"96보드에 예외 없이 문법 1개씩"을 요구하지 않는다** — R6 이 11장을 의도적으로 `grammar=None` 으로 남긴다. `grammar is null` 0건은 **Step 3 Acceptance** 에서만 요구한다.

#### Step 2 — 대장 제안 생성 (W1)

**`scripts/kiumi_build_ledger.py`** 가 `index.json` + 각 `slots.json`(`regions`·`counts`·`density`·`slots`·`tables`) + 배정 규칙에서 **`backend/ref/kiumi/kiumi-ledger.jsonl`** 제안본을 만든다.
> **경로 근거**: `backend/ref/` 는 git 추적 경로다(`git ls-files backend/ref/` → 20 파일). `.omc/` 는 `.gitignore:9` 로 전체 무시되어 정본이 될 수 없다.
> **이름 근거**: `scripts/kiumi_*.py` 글롭이 AC-K8 허용 목록이므로 옛 이름 `build_kiumi_ledger.py` 는 커밋 순간 G12 를 붉혔다.

##### 후보 선택 규칙 — 문법 의존 이중 밴드

rev 3 의 한 줄("리전 우선순위 header → kpi → primary → rail → footer")은 **표·복합 미니가 그려야 할 바로 그 내용을 후보에서 배제했다.** 실측: value 슬롯 **11,725개** 중 그 5개 리전에 드는 것은 6,448개뿐이고 **5,277개(45.0%)** 가 순위 밖이다(`table` 4,918 · `other` 294 · `strip` 33 · `workspace` 32). `table` 28 + `compound` 50 = **78/96 보드**가 행을 뽑을 원천을 잃고 있었다.

**핵심 정정: 행의 원천은 리전이 아니라 슬롯의 `table` 필드다.**

| 측정 | 값 |
|---|---|
| `slot.table` 이 있고 `row != "head"` 인 value 슬롯(= 표 본문 셀) | **6,418개** |
| 그 셀들이 실제로 앉아 있는 리전 | `table` 4,871 · **`primary` 1,221** · `other` 206 · `rail` 120 — **리전 이름으로는 표를 식별할 수 없다**(예: `2SCE-1` 의 표 `375G-0` 은 리전 `primary` 안) |
| `counts.tables > 0` 인 보드 | **67장**, 그 **전부**가 본문 셀 보유 |
| 반대 방향 불일치(`tables == 0` 인데 본문 셀 존재) | **0건** — `counts.tables > 0` ⟺ 표 본문 셀 존재 |
| `kind=="value"` 이면서 표 **머리** 셀인 슬롯 | **0개** (머리는 전부 `kind=="label"`) |
| 표 본문 셀을 뺀 **스칼라** value 슬롯 | **5,307개** (`primary` 2,712 · `rail` 1,587 · `kpi` 529 · `header` 205 · `other` 88 · `footer` 74 · `table` 47 · `strip` 33 · `workspace` 32). **스칼라 0개 보드 0장** |

**규칙 (결정론적, 전체 순서)**

1. **`candidate_count` = 그 보드의 `kind=="value"` 슬롯 전체 수** — 리전·구조와 무관한 **전량**이다. AC-K6 슬롯 산술이 45% 결손 위에서 계산되지 않게 못박는다.
2. **밴드 분리** — 판정식을 코드로 못박는다:

   ```python
   is_row_band = isinstance(s.get("table"), dict) and s["table"].get("row") != "head"
   ```

   요소마다 `band: "row" | "scalar"` 를 기록한다. ⚠️ **필드 경로가 중요하다**: 실측상 슬롯의 **최상위 `row` 는 18,045개 전부에서 `None`** 이고 실제 행 정보는 **`slot.table.row`** 안에 있다(`'head'` 541건). 산문("`slot.table` 이 비어있지 않고 `row != "head"`")을 문자 그대로 구현하면 머리 제외 조항이 **no-op** 이 된다. 오늘은 무해하다(올바른 경로로 재측정한 `kind=="value" and table.row=="head"` 가 **0개**) — 그러나 근거 측정 자체가 같은 no-op 표현으로 산출됐다면 순환 논증이므로 판정식과 측정 경로를 함께 고정한다.
3. **스칼라 밴드 순서** — 리전 **전체 순서**(9종 전부 배치):
   `header → kpi → primary → rail → footer → table → other → strip → workspace`, 같은 리전 안에서는 `slot_id` 오름차순. **순위 밖 리전이 존재하지 않는다.**
   - **`kor` 보유 슬롯을 우선한다** *(rev 6 신설 — Architect 블로킹 4)*: 같은 리전 안에서 `kor` 보유가 먼저, 그 다음 `kor` 결손. 상한을 `kor` 보유분으로 채울 수 있으면 fallback 라벨이 발생하지 않는다(실측 5,307 중 3,749 보유).
4. **행 밴드 순서**. 먼저 **표를 고른다**: `source_table(board, slots)`(§3.2)이 정본이고 `source_table_node_id`·`tables_total`·`tables_dropped` 를 대장에 남긴다. **행 밴드는 그 표 하나에서만 뽑는다.**
   - **열 후보 = 앵커된 열만** — 그 표의 `row=="head"` and `kind=="label"` 슬롯이 존재하는 `col` 집합(`anchored_cols`). 실측: 표 보유 67보드의 선택 표 전부가 머리 라벨 슬롯을 갖는다(머리 라벨 0개인 선택 표 **0장**).
   - **열 순서 = 이름 기준 우선순위** — 각 열의 머리 라벨 `paper_text` 가 `column_priority` **리스트에서 차지하는 위치**로 정렬하고, 목록에 없는 이름은 뒤로 보내 `col` 오름차순으로 잇는다. **인덱스로 색인하지 않는다** — `column_priority` 는 보드당 1개인데 표는 여럿이라 `column_priority[table.col]` 은 인덱스 공간이 어긋난다(예 `2SKU-1` 선택 표 5열 vs `column_priority` 12항목). 이름 기준 조회는 이 문제가 없다 — 실측상 선택 표 머리 라벨 **440개 중 412개(93.6%)** 가 `column_priority` 안에 있고 전부 있는 보드가 **59/67** 이다.
   - **`column_priority` 가 비어 있는 보드**(실측 `3UTA-0` 1장, **값이 `[]` 이고 키는 존재**)는 곧바로 `col` 오름차순. 판정식은 **`not board.get("column_priority")`**. `column_labels` fallback 은 **쓰지 않는다** — 그 필드는 빈 문자열을 담는다(실측 `2SCE-1` 은 7항목 중 **6개가 빈 문자열**).
   - **행 순서** = `source_table.body_rows` 배열 순. 상한(`KIUMI_LIMITS_640`)만큼 앞에서 취한다.
   - `unlabelable-row-cells.json`(Step 0f, 2개)에 든 셀은 **선택하지 않는다**.
5. **문법별 소비**: `facts`·`order_ticket`·`order_confirm`·`auth`·`event`·`stream`·`reader` 는 스칼라 밴드만 · `table` 은 행 밴드 · `compound` 는 스칼라 밴드 상한 + 행 밴드 상한 · `chart` 는 override 시 사람이 지정.
6. 각 요소에 `source_slot_id` 를 반드시 채운다(AC-K5 의 검사 대상). **라벨은 밴드별 앵커 규칙(AC-K5(3-row)/(3-scalar))으로만 채우고 `label_source` 를 반드시 기록한다** — 행 밴드는 `kor` → 머리 라벨 슬롯 두 단계뿐이며 **`column_priority` 를 라벨 출처로 쓰지 않는다**(그것은 열 *순서* 에만 쓴다).

**Acceptance**: 96행 생성 · 스키마 통과(AC-K1) · 산술 일치(AC-K6 슬롯 차원 + 고지 차원 + `tables_dropped`) · 모든 요소가 슬롯 귀속 검사 통과(AC-K5, 행 밴드 라벨 앵커 포함) · **배정 분포가 §4.3 "R6 적용 *후*" 표와 일치** · 표 보유 보드 전부 `source_table_node_id`·`tables_total`·`tables_dropped` 채워짐 · **(a) 96보드 전수에서 순위 밖 리전 0종**(`set(s.region for value slots) ⊆ SCALAR_REGION_ORDER`, 명령 `--check-region-coverage`) · **(b) 배정 문법의 구조 전제가 충족되지 않은 보드 0장**(`grammar ∈ {table, compound}` 인 레코드는 전부 `counts.tables > 0`) · **(c) `candidate_count == len([s for s in slots if s.kind=="value"])` 가 96/96 참** · **(d) fallback 라벨이 쓰인 보드가 전부 `scalar-label-fallback-boards.json` 안에 있음**.

#### Step 3 — 대장 비준 (W2a~W2f, 6 병렬 · Paper 무접촉)

- **기동 조건**: 6 에이전트는 **Paper MCP 도구 없이 기동한다**(`mcp__paper__*` 전체를 도구 거부 목록에 명시). 선언이 아니라 기동 조건이다.
- 각 에이전트가 자기 계열의 대장 행만 검토: 문법이 그 카드의 성격에 맞는가, 리드 요소가 "그 카드에서 키우미에 보여줄 부분"인가, 문구 3원칙 위반이 없는가.
- **명시 판정 대상 3종**:
  - **(a) `chart_capable == true` 3장**(`137X-2` · `2RJ7-1` · `32S7-0`) — chart 로 갈지 결정하고 후자면 `override_reason` 을 남긴다.
  - **(b) `structure_missing == true` 11장** — 표 구조가 없으므로 어떤 문법으로 그릴지 결정하고 `override_reason` 을 남긴다. ⚠️ **`event`·`auth`·`reader`·`stream` 으로 귀착시키면 §4.4-8(iii)에 따라 그 문법 템플릿의 G11-6 재승인이 필요하다** — 판정 시 이 비용을 명시적으로 인지한다.
  - **(c) `scalar-label-fallback-boards.json` 소속 보드**(기대 ≤13장) *(rev 6 신설)* — fallback 라벨이 그 값에 맞는지 사람이 확인하고 **`label_review`** 를 기록한다. AC-10 이 이 필드를 통과 조건으로 삼는다.
- 변경 시 `override_reason` 필수.
- **Acceptance**: 96행 전부 `reviewed_by` · 규칙 이탈 행 100% `override_reason`(AC-K4(a)) · `chart_capable` 3장 판정 완료(AC-K4(b)) · `structure_missing` 11장 판정 완료 및 `grammar` 확정(AC-K4(c)) · **`grammar is null` 레코드 0건** · fallback 보드 전부 `label_review` 보유 · 계획 저작 문자열 금칙 스캔 0건(AC-7, 면제 목록 적용).

#### Step 3′ — 문법 10종 템플릿 디자인 (W2g, 단독 Paper 레인)

- **3′a. 템플릿 저작.** 디자이너가 키우미 페이지에 **11장**을 그린다. **헌장 수준 디자인 + G11-6 승인 대상은 실현 문법으로 한정한다**:
  - **실현 문법(`realized: true`, 헌장 수준 + 승인 대상)** — `template/compound`(보드 50) · `template/table`(17) · `template/facts`(12) · `template/order_confirm`(5) · `template/order_ticket`(1) · `template/chart`(override ≤3). **6장.**
  - **미실현 문법(`realized: false`, 상한 도출용 최소 구현)** — `template/event` · `template/auth` · `template/reader` · `template/stream`. 실측상 이 4종은 카드 op 경로에서 나오지 않아 **보드가 0장**이다. 상한표 10행(AC-8(a))은 유지해야 하므로 템플릿과 `probe/*` 는 만들되 **헌장 수준 디자인과 사용자 승인은 요구하지 않는다.** **4장.** ⚠️ W2 비준이 `structure_missing` 보드를 이 4종으로 보내면 §4.4-8(iii)에 따라 **재승인이 필요하다.**
  - 전부 360×640 픽셀 고정. 이름은 §4.0 role 접두사 규약을 따른다.
  - 대표 보드 1장 — `template/2SCE-1`, D2 의 실제 값으로 채운 `compound` 미니.
- 적용 표준: 카드 표면 헌장의 표현 3층·밀도 예산(`docs/ui/paper-card-surface-charter.md:65` §2.3)·리드→그룹→게이트, 문구 3원칙. 단 미니는 **리드 1층만** 쓴다.
- 각 템플릿은 대장 레코드를 입력으로 받는 **슬롯 구조**를 확정한다 — W3 생성기가 이 구조를 그대로 찍는다.
- **3′b. 640 상한 도출.** §4.4 전체를 여기서 실행한다. 템플릿을 `probe/<grammar>` 로 복제해 넘칠 때까지 채워 `KIUMI_LIMITS_640` 을 실측하고, 실현 문법 행에 `realized: true` · `derived_from: "approved-template"` · `approved_template_sha`(3′d 가 채운다)를, 미실현 4종 행에 `realized: false` · `derived_from: "probe"` 를 기록한다. 각 상한에서의 **`content_bbox_height`** 도 기록한다. 임계는 `kiumi_limits.py::KIUMI_RENDER_THRESHOLDS` **한 곳**에서만 읽는다.
- **3′b-2. 상한 도출 입력 배정 기록.** 도출 시점의 `(board_id → grammar)` 사상 전량을 **`$EV/limits-input-assignment.json`** 에 쓴다. CP-1(2)가 최종 대장과 대조하며 불일치 시 §4.4-8(ii)로 **영향받은 문법만** 재도출한다.
- **3′b-3. 라이브 Paper 대조 1장 — 판정 규칙 포함** *(rev 6 규칙 신설 — Critic 블로킹)*. W2g 는 이미 단독 Paper 레인이 열려 있으므로 그 안에서 **`2SCE-1` 카드 보드 1장을 라이브로 읽어**(`open_file(5-1)` → `get_node_info`/텍스트 추출, **읽기 직후 `open_file(C-2)` 복귀**) 추출 트리의 `slots[].paper_text` 집합과 대조한다. 산출 `$EV/live-paper-spotcheck.json`.
  - **판정 규칙(이분)**: **미니가 실을 요소의 값 문자열 집합에 대해 불일치가 1건이라도 있으면 W3 를 시작하지 않고** §4.0 재개·중단 규칙으로 판정한다. 그 밖의 값 불일치는 **비율만 기록**하고 R-11 셀에 반영한다. rev 5 의 "불일치율이 크면 재고 사유"는 임계도 주체도 결과도 없는 재량 문구였다 — 계획이 다른 모든 자리에서 지킨 기준(명령 + 통과 조건)과 어긋난다.
  - **왜 이 한 장인가**: `2SCE-1` 은 D2 가 확정한 대응 보드의 좌측이고 **AC-15 가 의존하는 바로 그 보드**다. 추출 트리가 96보드 중 62보드에서 자기 검증기에 실패 중인 상태(R-0)에서 96장 비가역 쓰기 전에 알 값어치가 있는 단 하나의 사실이다. **보드 1장 · 읽기 1회 · 새 레인 0.**
- **3′c. 표본 12장 — 승인 *전*에 그린다.** 계열별 무작위 2장씩 총 12장을 승인 후보 템플릿으로 실제 생성해 `mini/…` 로 놓는다(짝이 되는 `note/…` 도 함께).
  - **왜 승인 전인가**: G11-6 이 96장을 재승인 대상에서 빼는 근거는 "96장은 승인된 템플릿의 **기계적 전개**"인데, 그것이야말로 육안 검수만이 확인할 수 있는 명제다. 표본을 승인 뒤에 그리면 전제를 **가정한 채** 비가역 구간에 들어간다.
  - **3′c-2. 표본 출처 해시 기록** *(rev 6 신설 — Architect 블로킹 5)*: 표본·대표 보드를 그릴 때 각 아트보드의 **`source_template_sha`**(그린 시점 `sha256(get_jsx)` of `template/<grammar>`)를 **`$EV/sample-provenance.json`** 에 기록한다. **CP-1(3)이 이것을 `approved-templates.json[grammar].sha` 와 대조한다.** 없으면 **반려·수정된 템플릿에서 나온 미니가 최대 13장 최종 96장에 남으면서 AC-1·AC-8(d)·CP-1 이 전부 초록**인 경로가 열린다(CP-1 은 `(node_id, name)` 만 보므로 내용 변경을 못 본다).
- **3′d. 승인 템플릿 해시 기록.** G11-6 PDF 를 `export_combined_pdf` 로 만드는 **그 시점에** 각 `template/<grammar>` 와 `template/2SCE-1` 의 `sha256(get_jsx)` 를 **`$EV/approved-templates.json`** 에 기록한다. AC-8(d)의 `approved_template_sha` 가 이 파일을 참조하며, 이것이 "승인된 바로 그 템플릿에서 상한이 나왔다"의 증명 수단이다. 재승인 시 갱신된다.
- **Acceptance**: 템플릿 **11장** + 표본 12장(+ `note` 12장) 존재 · 전부 360×640 픽셀 고정 · `px_height_measured == 640` and `0 < content_bbox_height <= 640` · 밀도 예산 위반 0 · `KIUMI_LIMITS_640` **10행** 완성 · **문법별 최장 값 문자열 길이 실측값 기록** · `limits-input-assignment.json` · `approved-templates.json` · `sample-provenance.json` · **`live-paper-spotcheck.json` 기록되고 판정 규칙 통과** · **G11-6 사용자 승인 통과**.

#### G11-6 — 마일스톤 PDF 사용자 승인 (W3 하드 블로커)

헌장 §6.3 6번(`docs/ui/paper-card-surface-charter.md:172` "**검수** — 마일스톤 PDF 사용자 승인")을 복원한다.

> ⚠️ **이것은 헌장 §6.2 의 사상(mapping)이 아니라 의도적 이탈(deliberate deviation)이다.** 실측: `docs/ui/paper-card-surface-charter.md:163` 의 승인된 사용자 규칙은 "**60 · 70 · 80 · 90 · 100%** 통과 시점마다 **전 보드 PDF** 를 발송하고 승인 후 다음 배치로 간다"이다. G11-6 은 이를 **23장**(템플릿 11 + 표본 12)으로 치환하고 96장을 재승인 대상에서 **제외**한다. 규모상 합리적인 축소일 수 있으나 **등가가 아니다.**

- **적용 대상**: W2g 의 **23장**. **96장 전부가 아니다.** **`probe/*` ≤10장은 PDF 에 포함되지 않는다.** 미실현 4종 템플릿은 PDF 에 포함하되 "보드 0장 · 상한 도출용"으로 표시하고 헌장 수준 판정을 요구하지 않는다.
- **방법**: `export_combined_pdf` 로 23장 PDF 발송 → 사용자 승인. 발송과 **같은 시점에** 3′d 가 `approved-templates.json` 을 기록한다.
- **PDF 에 명시할 동의 문장 2개**:
  1. "이 승인은 96장 전 보드 PDF 검수를 대체합니다."
  2. "상한 도출 프로브 N장이 키우미 페이지에 근거로 영구히 남습니다." — `N` 은 실제 프로브 수를 채운다. 1번은 *승인 범위*를 고지하지만, *사용자 소유 디자인 페이지에 승인받지 않은 아트보드가 영구 잔류하는 것*에 대한 동의는 별개다.
- **차단 규칙**: 승인 전에는 W3 의 Paper 쓰기를 **시작하지 않는다.** 승인 전에는 `approved-templates.json` 이 **존재하지 않으므로** `approved_template_sha` 가 채워질 수 없고 AC-8(d)도 함께 막힌다. **시각 조건을 쓰지 않는 이유**: 상한 도출이 승인 **이전**(W2g)에 일어나므로 템플릿이 그대로 승인되면 "승인 시각 이후" 조건은 **영원히 거짓**이었다.
- **재승인**: 승인 후 템플릿 구조를 바꾸면 그 문법에 대해 다시 승인받고 §4.4-8 에 따라 상한을 **재도출**한다. `realized: false → true` 전이도 재승인 대상이다(§4.4-8(iii)).

#### Step 4 — 생성: `kiumi` 필드 + Paper 미니 96장 + 주석 96장 (W3)

- **4-0. 진입 조건: CP-1 체크포인트 — 세 조건 전부.**
  - **(1) Paper 노드**: 첫 배치 직전에 **키우미 페이지 + 카드 페이지** `(node_id, name)` 을 재스냅샷해 Step 0c·0d 기준선 + W2g 추가분(`template/*` **11** · `probe/*` ≤10 · `mini/*` 12 · `note/*` 12)으로 **전부 설명되는지** 확인한다. `2SCE-1` 의 `sha256(get_jsx)` 도 대조한다.
  - **(2) 배정 일치**: 최종 대장의 `(board_id → grammar)` 사상 == `$EV/limits-input-assignment.json`. 불일치하면 §4.4-8(ii)(필요 시 (iii))로 재도출·재승인한 뒤 다시 CP-1 을 돈다.
  - **(3) 표본 출처 일치** *(rev 6 신설)*: 표본 12장 + 대표 보드의 `source_template_sha` == `approved-templates.json[grammar].sha`. **불일치한 표본은 W3 첫 배치에서 삭제·재생성**하며, 그 노드 증감은 §4.0 재개 규칙 **(d)** 로 설명되는 증감으로 받는다.
  - **(4) fallback 보드 재확정**: 확정된 상한으로 `scalar-label-fallback-boards.json` 을 재계산해 Step 0g 목록과 대조하고, 늘어난 보드는 Step 3 로 되돌려 `label_review` 를 받는다.
  - 어느 조건이든 설명되지 않는 위반이 1건이라도 있으면 W3 를 시작하지 않고 §4.0 재개·중단 규칙 (a)~(e)로 판정한다.
  - 산출: `$EV/paper-checkpoint-w2w3.json`.
- **4a. `scripts/kiumi_apply_field.py`** 가 대장에서 각 `backend/ref/card-surface-templates/<board_id>/slots.json` 에 최상위 `kiumi` 를 쓴다. **다른 키는 건드리지 않는다.** 직렬화는 추출기와 **바이트 동일**하게 — `json.dumps(payload, ensure_ascii=False, indent=2) + "\n"`(정본 `scripts/paper_board_extract.py:1818-1819`). AC-K3(b1)+(b2)가 게이트한다.
  - ⚠️ **G11-6 승인 전 실행분은 잠정(provisional)이다.** 4a 가 쓰는 `elements[]`·`fold_counts` 는 승인된 템플릿의 수용량에 의존하므로, 선행 실행분은 `provisional: true` 를 달고 **G11-6 통과 직후 무조건 재생성 + G1 재실행**을 필수 절차로 못박는다. AC-K1 이 `provisional` 0건을 요구한다.
- **4b. Paper 미니 96장 + 주석 96장 생성.** 같은 대장 + **승인된 템플릿**으로 `write_html`. 이름은 `mini/<index.json name>` · `note/<index.json name>`. 폭 360 · **높이 640 픽셀 명시**(`fit-content` 금지).
  - **재사용 규칙 — 중의성 제거** *(rev 6, Critic 블로킹)*: **재사용 대상은 `mini/*` 표본 12장(+ 짝 `note/*` 12장)뿐이다.** 대표 보드 **`template/2SCE-1` 은 `template` role 로 남고**(role 개수 11 을 유지), **`mini/…2SCE-1` 은 W3 에서 새로 쓴다.** 개명해 재사용하면 `template/*` 이 10 이 되어 CP-1 기대 개수가 깨지고 §4.0 재개·중단 규칙 (c)에 걸린다.
  - **실제 쓰기 수**: 미니 **84장 신규 + 12장 재사용** · 주석 **84장 신규 + 12장 재사용**. 아래 배치의 "24장"은 **대장 행 수**이며 그 중 일부는 재사용이다.
  - **배치 구조: 24행 × 4배치 — 절단 규칙.** 대장을 **계열 순서(W2a → W2b → W2c → W2d → W2e → W2f), 계열 안에서는 `board_id` 오름차순**으로 정렬한 뒤 **앞에서 24행씩 자른다. 계열이 배치 경계를 넘을 수 있다.** 레인 크기 `14 · 15 · 11 · 20 · 15 · 21`(누적 14 · 29 · 40 · 60 · 75 · 96):

    | 배치 | 구성 | 대장 행 |
    |---|---|---:|
    | b1 | W2a 14 + W2b 10 | 24 |
    | b2 | W2b 5 + W2c 11 + W2d 8 | 24 |
    | b3 | W2d 12 + W2e 12 | 24 |
    | b4 | W2e 3 + W2f 21 | 24 |

    ⚠️ "배치는 계열 묶음을 따라 나눈다"는 **실행 가능한 해가 없었다** — 레인 크기의 어떤 부분집합도 24 가 아니고 계열 묶음 `{14,6,31,9,15,21}` 도 마찬가지다(CC-03 만으로 31). 24 를 고른 이유는 **탐지 지연을 균일하게 24행으로 묶기 위함**이므로 계열 정렬은 유지하되 경계를 넘게 한다.
  - **각 배치 경계에서**:
    - **(i)** 키우미 페이지 + **카드 페이지** `(node_id, name)` **재스냅샷 + 기준선 대조** — 설명되지 않는 증감이 있으면 다음 배치를 시작하지 않고 §4.0 재개·중단 규칙 (a)~(e)로 판정한다. 산출 `$EV/paper-checkpoint-w3-b{1..4}.json`.
    - **(ii) 부분 Paper 스냅샷 채집** → `$EV/paper-snapshot-b{1..4}.json`(§3.0 스키마 동일) → **그 24장에 대해 AC-2 · AC-9 · AC-9b 를 실행**한다 *(rev 6 신설)*. 이것이 §3.1 이 그 셋을 W3 상시 차단으로 선언한 것을 처음으로 **실행 가능**하게 만든다.
    - **(iii) 컨택트시트 PDF 를 `export_combined_pdf` 로 발송**한다.
  - **컨택트시트의 권한**:
    - **기본**: 무응답은 진행이다(R-10 정지 시간 불변). **그러나 배치 N 에서 실행자 또는 사용자가 결함을 확인하면 배치 N+1 은 대장 또는 템플릿을 재도출한 뒤에만 시작한다.**
    - **지목된 보드는 긍정 확인을 요구한다** *(rev 6 신설 — Architect 개선 13)*: `$EV/judgment-boards.json` 에 **`kor` 스칼라 5개 미만 13장 + 표 2개 이상 19장 + `structure_missing` 11장**(중복 제거 후 약 35~40장)을 동결하고, **이 집합에 속한 보드가 든 배치는 컨택트시트에 대한 명시적 무결함 확인이 있어야 다음 배치로 간다.** 나머지 보드만 든 배치는 무응답=진행을 유지한다. 이렇게 하면 G11-6 축소의 전제("96장은 기계적 전개")가 판단이 필요한 보드에 한해 **가정이 아니라 관찰**이 되고, 인프라가 이미 있으므로 추가 비용은 ≈0 이다.
  - **부기 게이트는 이 구간에서 보고 전용이다**(§3.1). 진실 게이트(AC-K3 · AC-K5 · AC-2/9/9b · CP-1 · 배치 경계 스냅샷)는 이 구간에서도 차단이다.
- **4c. 출처 주석 생성.** 같은 대장에서 각 미니에 짝이 되는 `note/<이름>` 아트보드에 4항목을 렌더한다 — 주석 문자열은 **필드에서 렌더**되므로 AC-11 이 구성상 참이고, **숫자는 `--fold-math` 의 독립 재계산과 대조**되므로 AC-6 이 반증 가능하다.
- **Acceptance**: AC-K1(96/96, `provisional` 0건) · AC-K2 · AC-K3(a)(b1)(b2)(c)(d) · AC-K9 · **배치별로 AC-2 · AC-9 · AC-9b 전부 통과** · AC-6(4항목, 숫자 독립 재계산 일치) · AC-K8 · **배치 경계 4회 전부 키우미·카드 페이지 `(node_id, name)` 설명 가능**.

#### Step 5 — 대응 보드 + 보드 09 (W4)

- **5a. 대응 보드 1장** (`correspondence/2SCE-1`): 좌 = `2SCE-1` 1440×1092 클론(D2), 우 = 그 보드의 360×640 미니, 규칙 3문장(한 세션 · 동일 호출 로직 · 미리 정의된 표시 부분).
  - **클론 방법을 못박는다** *(rev 6 — Architect 블로킹 1)*: `get_jsx(2SCE-1)` **읽기** → **`C-2` 안에서 `write_html`**. **카드 페이지를 부모로 삼는 `duplicate_nodes` 금지.** 읽기 전후로 활성 페이지 단언을 수행한다.
- **5b. 보드 09(`2LFW-2`) 갱신** — 보드 09 를 의도적으로 바꾸는 **유일한** 지점이다:
  - **직전**: 보드 09 `sha256(get_jsx)` 를 읽어 `board09_pre` 와 **일치 확인**(그때까지 외부 미변경 증명). 불일치면 갱신하지 않고 조사한다.
  - **갱신 내용**: 640 상한표 **10행**(`realized` 열 포함) + **D3 각주("코드 반영은 후속 작업 — FU-1")** + **§4.3b 신설 고지 4종 + 0-부분 억제 각주("JS 반영은 후속 작업 — FU-4")** + **프로브 각주("`probe/*` 는 근거 보관용이며 승인 대상이 아니다")** + **다중 표 각주("미니의 화면 고지는 선택된 표 하나에 대한 수이며, 전체 접힘은 주석과 캔버스에서 확인한다")** + AC-13 고정 리드 문장.
  - **직후**: 새 `sha256(get_jsx)` 를 `board09_post` 로 `paper-baseline.json` 에 기록한다. 이후 구간의 불변 기준은 `board09_post` 다.
- **5c. Paper 전량 스냅샷 채집.** 모든 Paper 쓰기가 끝난 뒤 `open_file(C-2)` → `find_nodes` → 배치 `get_node_info` · `get_computed_styles` · `get_screenshot` 으로 **`$EV/paper-snapshot.json`** 을 만든다. 이 파일이 G8·G8b·G9·G10 의 최종 입력이며 이후 검사는 Paper 없이 재실행된다.
- **불변**: 보드 05(`5EU-0`)는 읽기만 한다. **보드 01~08** 과 키우미 페이지 `(node_id, name)` 집합, **카드 페이지 `(node_id, name)` 집합 + `2SCE-1` 해시**는 기준선과 대조한다. **보드 09 는 불변 집합이 아니다.**
- **Acceptance**: AC-14 · AC-15(값 차집합 0) · AC-16(3문장 + 보드 05 해시 불변) · AC-8(d 포함) · `paper-snapshot.json` 존재 및 §3.0 스키마 통과 · **보드 01~08 해시 == `frozen_boards`** · **보드 09 2단 검사 통과** · **카드 페이지 노드 집합 + `2SCE-1` 해시 == Step 0c 기준선** · 키우미 페이지 노드 증감이 우리가 추가한 role 노드로 전부 설명됨.

#### Step 6 — 게이트 · 검증 (W5) · 재작업 (W6)

§6 전량 실행. **여기서 부기 게이트(AC-K6 고지 산술 · AC-7 면제 부기 · AC-8(d) · AC-10 라벨 부기)가 보고 전용에서 차단으로 승격된다**(§3.1). 실패분만 Step 3(대장) 또는 Step 3′(템플릿)로 되돌려 고친다 — **개별 그림을 직접 손보지 않는다**(단일 출처 원칙).

**재작업(W6)은 W3 과 같은 규율 아래 둔다** — Paper 쓰기 단일 직렬 레인 · 재생성 대상 12장 초과 시 배치 분할 · 각 경계에서 키우미 + 카드 페이지 재스냅샷 + 부분 스냅샷 · §4.0 재개·중단 규칙 (a)~(e).

통과 후 브랜치에서 커밋(AC-K8 경로 준수).

- **Acceptance**: §6 게이트 G0~G12 전부 통과(부기 게이트 포함) · `git status --porcelain` 이 허용 경로 밖 tracked 수정 0건 · 브랜치 `kiumi/mini-cards`.

---

## 5. Risks and Mitigations

| ID | 리스크 | 실태 | 완화 |
|---|---|---|---|
| **R-0** | **선재 조건 — 템플릿 트리가 이미 검증 실패 상태** | `load_registry(TEMPLATE_ROOT)` 가 **225 문제 / 62 보드**로 예외를 던진다(occurrence 205 · rail_blocks 12 · rows_max 3 · parent_board 3 · kpi_cells 2). `get_registry()`(`card_surface_templates.py:1017`)가 예외를 삼키고 빈 레지스트리를 반환하므로 **현재 프로덕션은 보드 표면 없이 동작한다** | **이번 범위 밖**(다른 레인의 미완 작업, 트리 untracked). AC-12 를 "`load_registry` 가 통과한다"로 쓸 수 **없다** — 그래서 **AC-K2 귀속 차등 게이트**로 설계했다. **FU-3** 으로 별건 이월 |
| **R-1** | 검증기가 미지의 `kiumi` 키를 거부 | **해소됨 — 실험으로 반증.** `_parse_board`(`card_surface_templates.py:738`)는 `_REQUIRED_BOARD_KEYS`(`:66`, required-only 5개)만 확인하고 최상위 키 allowlist 가 없다. 트리를 임시 디렉터리로 복사해 **97개 `slots.json` 전부에 `kiumi` 를 주입**한 뒤 `(board_id, problem)` 키 집합 비교 → **225 → 225, added 0 / removed 0, identical True** | 그래도 **AC-K2** 를 상시 게이트로 둔다. 미래에 strict key 검사가 추가되면 즉시 붉게 뜬다 |
| **R-1b** | `kiumi` 가 **무기력한 필드**가 된다 | `BoardTemplate` dataclass 14필드에 `kiumi` 가 **없다** — 파서는 통과시키되 읽지 않는다. 스펙 Non-Goal(L54)이 렌더러 반영을 후속으로 미뤘으므로 정상이지만, 아무도 읽지 않는 필드는 조용히 썩는다 | **`scripts/validate_kiumi_field.py` 를 필드의 소비자로 세운다** — 스키마·상한·슬롯 귀속·2차원 산술을 검사(AC-K1·K5·K6). 필드가 계약이 되고 드리프트가 게이트에서 잡힌다. `BoardTemplate` 확장은 **FU-2** |
| **R-2** | Paper `fit-content` 높이 0 붕괴 → 검은 스크린샷 | 스펙 L101 + 메모리 `paper-artboard-fit-content-trap` 의 기지 함정 | 미니 아트보드는 **항상 픽셀 640 명시**, `fit-content` 금지. AC-2 + AC-9 를 보드마다 강제 |
| **R-3** | 비활성 페이지 스크린샷이 비어 나옴 | 스펙 L101 + 메모리 `paper-mcp-screenshot-viewport` | 검수 전 반드시 `open_file(C-2)`. **모든 `write_html` 직전 활성 페이지 단언**(§4.0). 스크린샷 검사는 페이지 전환 후 배치로만 |
| **R-4** | 값 조작(지은 값) | 공통 규칙 1(`app/lib/orb-mini-card.js:15`) 위반은 제품 신뢰 붕괴 | **AC-K5 슬롯 정체성 게이트** + **값 보존 불변식**(항등이 기본, 토큰 1개 수치형만 배율 재적용) + **라벨 앵커**(행 밴드는 머리 라벨 좌표, 스칼라 밴드는 `kor` 우선 + 열거 예외 + `label_review`). 눈 검수에 의존하지 않는다 |
| **R-5** | **동시 Paper/저장소 세션** | **실증됨**: `git worktree list` → `C:/Projects/DAOU.Athena-plugin` 이 `feat/plugin-mode-doctrine` 로 체크아웃. **Paper 파일은 워크트리와 무관하게 공유되므로 브랜치가 보호하지 못한다** | (1) **Paper 쓰기 레인 정확히 1개** — W2g → W3 → W4 → W6. **W2a~f 는 Paper MCP 도구 없이 기동**. (2) **CP-1 3조건** — 비가역 구간 진입 **전** 탐지. (3) **W3 배치 경계 4회 재스냅샷**(키우미 + **카드 페이지**) — 탐지 지연을 96장 뒤에서 **24행 뒤**로. (4) 키우미 페이지 밖 노드에 `finish_working_on_nodes` 금지. (5) `open_file` 전환은 배치 시작·끝에서만이며, 3′b-3·0c 처럼 중간에 카드 페이지를 읽으면 **읽기 직후 `C-2` 복귀**. (6) 보드 05 · 01~08 · 09 2단 · `board.html` · **카드 페이지 노드 집합 + `2SCE-1` 해시** 대조. (7) 저장소 변경은 `kiumi/mini-cards` 에서만 |
| **R-6** | 밀도 초과 | 헌장 §2.3 예산(`docs/ui/paper-card-surface-charter.md:65`), 640 상한표 | 생성기가 상한을 **강제**하므로 초과가 구조적으로 불가. AC-8 이 재확인. W2g 템플릿이 밀도 예산 안에서 설계되므로 96장에 전파 |
| **R-7** | 기존 테스트가 새 필드를 전혀 덮지 않음 | `test_card_surface_templates.py:30` · `test_card_surface_contract.py:29` 는 **FIXTURE_ROOT**(보드 3장 `2SKU-1`·`2SKU-1-T1`·`2SKU-1-X1`)만 로드한다. 실 트리 96장을 로드하는 테스트가 없어 `kiumi` 를 추가해도 기존 테스트는 **자동으로 그린**이고 그 그린은 아무것도 증명하지 않는다 | AC-12 를 "기존 테스트 그린"만으로 만족시키지 않는다. **신규 `test_kiumi_field.py`** 필수 케이스 13개가 (a) 픽스처 불변, (b) 실 트리 96보드의 스키마·상한·슬롯 귀속·2차원 산술을 검사 |
| **R-8** | D3 괴리 — 보드 09 상한표와 코드 `LIMITS` 가 갈라진다 | `orb-mini-card.js:21` 이 보드 09 와의 동기화를 계약으로 선언 | **의도된 유예**(D3, 사용자 결정). 보드 09 각주 + **FU-1** 이월. AC-8 등식에서 `LIMITS` 제거로 계획 내부 모순 제거. 부수 완화: `LIMITS.tableRows` 는 이미 소비처가 없어 괴리의 실제 영향면이 5개 상수로 줄어든다 |
| **R-9** | **템플릿 트리가 git 밖이라 브랜치가 보호하지 못한다** | `backend/ref/card-surface-templates/` 전체 untracked. **노출은 추정보다 작다** — 동시 레인 워크트리에는 이 디렉터리가 **존재하지 않는다**. 잔여 노출은 **같은 디렉터리에서 도는 다른 세션**뿐 | **AC-K3 파일 해시 매니페스트가 방어**(경로 `backend/ref/kiumi/evidence/` — `.omc/` 밖이라 `git clean -xdf` 에 소실되지 않는다). **+ AC-K9 가 매니페스트 자신의 무결성을 지킨다**(Step 0i 커밋 + `git diff --quiet`). **추출기 재실행 오탐 판정 절차**: `merge_authored`(`:1780-1784`)가 옮겨 담은 키를 payload **끝에 재배치**하므로 재추출 한 번으로 최상위 키 순서가 바뀐다 → **(b2) 실패 + (b1) 통과 = "내용 동일 + 순서 변경"** 이므로 추출기 재실행을 의심하고, git·mtime·다른 세션 로그로 확인한 뒤 매니페스트를 **재기록하고 진행**한다(별도 커밋). **(b1)까지 실패하면 실제 외부 편집이므로 정지한다** |
| **R-10** | **템플릿 승인 대기로 W3 가 정지한다** | G11-6 이 사용자 응답에 의존하는 하드 블로커 | W2a~W2f 대장 비준을 W2g 와 **완전 병렬**로 돌려 대기 시간을 흡수한다. 승인 대기 중 Step 4a 선행은 **잠정(provisional)으로만** 허용하고 G11-6 통과 직후 **무조건 재생성 + G1 재실행**을 필수로 못박는다. 4b/4c 는 승인 후에만. 배치 컨택트시트는 **비차단**이며 `judgment-boards` 가 든 배치만 긍정 확인을 요구한다 |
| **R-11** | **값의 정본이 라이브 Paper 가 아니라 추출 트리다** | 스펙 AC-4(L62)는 "원본 보드에 존재하는 값"을 요구하는데 이 계획은 그것을 **추출 트리의 `slots[].paper_text`** 로 읽는다. AC-K5 는 추출 트리만 보고 AC-15 의 대응 보드도 `2SCE-1` 의 **클론**을 좌측에 놓으므로 사슬 어디에도 라이브 대조가 없다. 트리는 untracked·캠페인 중이며 96장 중 **62장이 검증 실패 상태**라 stale 일 수 있다 | **전부 해소하지 못하지만 공시만 하지도 않는다.** (1) **Step 3′b-3: `2SCE-1` 한 장 라이브 대조 + 이분 판정 규칙** — 미니가 실을 값 문자열에 불일치가 1건이라도 있으면 **W3 를 시작하지 않는다**; 그 밖의 불일치는 비율만 기록해 이 셀에 기입한다(실행 시 채움). (2) 원칙 3 각주 + AC-K5·AC-15 각주에 "정본은 추출 트리이며 96장 전체의 라이브 동일성은 증명하지 않는다"를 유지. (3) 전수 라이브 대조는 **FU-3** 과 함께 다룬다 |
| **R-12** *(rev 6 신설)* | **표본 12장이 반려된 템플릿에서 살아남는다** | Step 3′c 는 승인 **전** 후보 템플릿으로 12장을 그리고, Step 4b 는 재사용을 지시하며, CP-1 의 `(node_id, name)` 검사는 **내용 변경을 보지 못한다** — 반려·수정된 템플릿에서 나온 미니가 최대 13장 최종 96장에 남으면서 AC-1·AC-8(d)·CP-1 이 전부 초록일 수 있었다 | **`$EV/sample-provenance.json` 에 `source_template_sha` 기록**(Step 3′c-2) + **CP-1(3) 대조**. 불일치 표본은 W3 첫 배치에서 **삭제·재생성**하고 그 노드 증감을 §4.0 재개 규칙 **(d)** 로 받는다 |
| **R-13** *(rev 6 신설)* | **다중 표 보드에서 사용자가 과소 개수를 본다** | `source_table()` 단일 표 규칙이 선택 표 밖 본문 셀을 통째로 버리는데 화면 고지에는 나타나지 않는다. 실측 표 2개 이상 **19장**, 버려지는 본문 value 셀 **524개**. `compound` 고지 문구에는 **열 항 자체가 없어** 50장에서 접힌 열도 화면에 안 나온다 | **AC-K6(D) `tables_total`/`tables_dropped` + AC-6 주석 총계**(`folded_slots` + `표 N개 전체 제외`)가 **어느 표면에도 과소 개수만 남지 않게** 한다. 보드 09 각주가 "화면 고지는 선택된 표 하나에 대한 수"임을 명시한다. 화면 문구 자체의 개선은 **FU-4** |

---

## 6. Verification Steps

실행 순서대로. 각 게이트는 **증거 문자열**을 **`$EV`** 에 남긴다. `PY = backend/.venv/Scripts/python.exe`, `EV = backend/ref/kiumi/evidence`.
**계층 표기**: 〔진실〕 = 상시 차단 · 〔부기〕 = W3 구간 보고 전용 → Step 6 차단 승격 · 〔절차〕 = 준비·위생 게이트(차단이되 재실행으로 해소).

| Gate | 계층 | 명령 | 통과 조건 |
|---|---|---|---|
| **G0 기준선** (Step 0, 1회) | 〔절차〕 | `$PY scripts/kiumi_baseline.py --write $EV/kiumi-baseline.json` · `$PY scripts/kiumi_tree_manifest.py --write $EV/kiumi-tree-manifest.json` · `$PY scripts/kiumi_slots_diff.py --write $EV/slots-baseline.json` · Paper 배치 → `$EV/paper-baseline.json`·`paper-tokens.json` · 카드 페이지 프로브 → `$EV/excluded-boards.json` · 스캔 → `copy-exempt.json`·`unlabelable-row-cells.json`·`scalar-label-fallback-boards.json`·`identity-only-values.json` · **Step 0i 커밋** | 문제 키 **225** / 보드 **62**(전부 대상 96 안) · 매니페스트 97 디렉터리 + 96 canonical slots 해시 + 키 순서열 + `index.json` 해시 + **도구 3종 해시** · `slots-baseline.json` 합계 **1615** · 보드 **85** · 보드 05 해시 + `frozen_boards`(01~08) + `board09_pre` + 키우미 페이지 `(node_id, name)` + **카드 페이지 `(node_id, name)` + `2SCE-1` 해시** 기록됨 · `paper-tokens.json` 기록됨 · 제외 보드 **열거** 기록됨 · `copy-exempt.json` **22행**(전 항목 `kind=="value"`) · `unlabelable-row-cells.json` **2행** · `identity-only-values.json` **848행** · **기준선 커밋 완료** |
| **G1 필드 전수** | 〔진실〕 | `$PY scripts/validate_kiumi_field.py` | `96/96 boards have a well-formed kiumi field`, exit 0, `provisional: true` **0건** (AC-K1) |
| **G2 귀속 차등** | 〔진실〕 | `$PY scripts/kiumi_baseline.py --compare $EV/kiumi-baseline.json` | **대상 96보드 귀속 새 키 0건** (AC-K2). 대상 밖 증감은 `foreign:` 분리 보고, 불차단. ⚠️ 이 신호의 foreign 집합은 현재 **공집합**이므로 외부 편집 탐지는 G2b 가 진다 |
| **G2b 트리 매니페스트** | 〔진실〕 | `$PY scripts/kiumi_tree_manifest.py --compare $EV/kiumi-tree-manifest.json` **and** `git diff --quiet -- backend/ref/kiumi/evidence/*baseline*.json backend/ref/kiumi/evidence/kiumi-tree-manifest.json` | (a) 96 `board.html` sha256 == G0 · **(b1)** `kiumi` 제거 후 `sort_keys=True` 재직렬화 sha256 96개 == G0(내용 동일성) · **(b2)** 새 최상위 키가 정확히 `kiumi` 1개 + 나머지 키 상대 순서 보존(가산성) · (c) `index.json` sha256 == G0 · **(d) 도구 3종 sha256 == G0** · (e) 그 밖의 변경은 `foreign-change:` 열거 · **(f) 기준선 파일 자신이 커밋 이후 미변경**(AC-K9). **(b2)만 실패하고 (b1) 통과 = "내용 동일 + 순서 변경"** → R-9 판정 절차 |
| **G3 테스트** | 〔진실〕 | `cd backend && ../$PY -m pytest tests/unit/test_card_surface_templates.py tests/unit/test_card_surface_contract.py tests/unit/test_kiumi_field.py -q` | 전부 green (AC-12). **AC-K7 은 여기 소관이 아니다** — `validate_board_slots` 게이트이므로 G4 |
| **G4 슬롯 검사 회귀** | 〔진실〕 | `$PY scripts/kiumi_slots_diff.py --compare $EV/slots-baseline.json` **and** 위 `git diff --quiet` | **대상 96보드 귀속 새 `(board_id, letter)` 문제 0건** (AC-K7). 대상 밖 증감은 `foreign:` 분리 보고, **불차단**. 참고 기준선: exit 1 · 1615 · 85 |
| **G5 해시 불변** | 〔진실〕 | `$PY scripts/kiumi_tree_manifest.py --html-only --compare $EV/kiumi-tree-manifest.json` | 96 `board.html` sha256 전부 G0 과 동일, 불일치 0 (AC-K3(a)) |
| **G6 값 출처** | 〔진실〕 | `$PY scripts/validate_kiumi_field.py --provenance` | **슬롯 정체성 위반 0건** (AC-K5). 3항: `source_slot_id` 존재 · **값 보존 불변식**(`identity-only-values.json` 848 슬롯은 항등 전용) · **라벨 앵커** — `band=="row"` 는 `label_source ∈ {kor, head_label}` 이고 `head_label` 라벨이 `(table.table, .col)` 머리 라벨 슬롯 `paper_text` 와 완전 일치. **`column_priority` 를 라벨 출처로 받지 않는다**. `band=="scalar"` 는 `kor` 우선 선택 결과이거나 열거된 보드의 `board_label_fallback`. `unlabelable-row-cells.json` 의 2셀이 요소로 등장하면 **위반**. **fallback 사용률을 밴드별로 보고**한다 |
| **G7 문구 3원칙** | 〔부기〕 | `$PY scripts/validate_kiumi_field.py --copy` | **계획이 저작한 문자열**(접힘 고지 · 주석 4항목 · fallback 라벨 · 재포맷 값)에 위반 0 (AC-7), 대장 + Paper 주석 양쪽 스캔. **AC-K5 가 원본 동일성을 증명한 값은 `copy-exempt.json` 열거로 면제**(22 슬롯) — 목록 밖에서 같은 문자열이 나오면 여전히 붉다 |
| **G7b 대장 산술·부기** | 〔부기〕 | `$PY scripts/validate_kiumi_field.py --fold-math --limits` | **AC-K6**(슬롯 차원 등식 + 고지 차원 구조 일치 + 문법별 미사용 필드 0 + **`tables_dropped` 단언**) **and AC-8**(a)(b)(c)(d) |
| **G8 Paper 형상** | 〔진실〕 | 배치 스냅샷(W3) 또는 `$EV/paper-snapshot.json`(Step 5c) → `$PY scripts/validate_kiumi_field.py --geometry --render` | `role=="mini"` 96장 전부 `width==360 and height==640` · `px_height_measured==640` and `len(text_nodes)>=3` and `0 < content_bbox_height <= 640`(임계 출처는 `KIUMI_RENDER_THRESHOLDS` 한 곳) · `clipping` 0 (AC-2·AC-9). 추가: 키우미 페이지 `(node_id, name)` 증감이 우리 role 노드로 **전부 설명됨** · **보드 01~08 == `frozen_boards`** · **보드 09 == `board09_post`**(5b 가 의도적으로 갱신했으므로 `board09_pre` 와 같을 수 없다) · **카드 페이지 노드 집합 + `2SCE-1` 해시 == Step 0c 기준선** |
| **G8b 색 의미** | 〔진실〕 | 같은 스냅샷 → `$PY scripts/validate_kiumi_field.py --tone` | 방향값 요소(실측 **2,081개 / 88보드**)의 `color_token` 이 부호와 일치, 불일치 0, **`color_token is null` 은 위반** (AC-9b). **검사 범위 밖 방향값 수를 함께 보고**한다. 헌장 게이트 5의 "상승 빨강/하락 파랑"을 닫는다 |
| **G9 1:1 분할** | 〔진실〕 | `$PY scripts/validate_kiumi_field.py --paper` | `pre_existing`(Step 0d 열거) 제외 후: `role=="mini"` ↔ index 이름 **양방향 차집합 0** · **role 개수 정확히** `mini 96 · note 96 · template 11 · probe ≤10 · correspondence 1` · `new` 안에서 role 파싱 실패 **0건**(파싱 `name.split("/", 1)`) · `pre_existing` 집합 완전 일치 (AC-1) |
| **G10 대응 보드** | 〔진실〕 | `--correspondence` + 3문장 grep + 보드 05 `get_jsx` 해시 대조 | AC-14 · AC-15 · AC-16. `role=="correspondence"` 아트보드 정확히 1장 |
| **G11 카드 게이트(미니 적용)** | 혼합 (아래 행별) | 헌장 §6.3(`docs/ui/paper-card-surface-charter.md:165-172`)을 미니에 사상 | 아래 6항 + 6b · 6c 전부 통과 |
| **G12 브랜치 위생** | 〔절차〕 | `git status --porcelain` · `git branch --show-current` | 브랜치 == `kiumi/mini-cards` · 수정된 tracked 파일이 AC-K8 허용 경로 밖 0건. 허용 경로: `backend/ref/kiumi/**` · **`scripts/kiumi_*.py`** · `scripts/validate_kiumi_field.py` · `backend/tests/unit/test_kiumi_field.py`. **`.omc/**` 는 허용 목록에 없다** |

### G11 — 카드 게이트를 미니에 적용하는 방법

2026-09-02 캠페인에서 승인된 헌장 게이트 6항을 미니 규격으로 사상한다. 원본이 1440/1120 기준이므로 **판정 기준만 360/640 으로 치환**하고 게이트의 성격은 보존한다.

| 미니 게이트 | 계층 | 원본 (`paper-card-surface-charter.md`) | 판정 |
|---|---|---|---|
| **1. 원장** | 〔진실〕 | `:167` 필드 원장 fail-closed 재집계 | 대장 96행 전부 `reviewed_by` + 규칙 이탈 100% `override_reason` (AC-K4) |
| **2. 문구** | 〔부기〕 | `:168` 설명문 0 · 영문 단위 0 · 내부어 0 | G7 |
| **3. 정본** | 〔진실〕 | `:169` canon 데이터셋 정합 | G6 (슬롯 정체성 + 값 보존 + 라벨 앵커) |
| **4. 밀도** | 〔부기〕 | `:170` §2.3 예산 위반 0 | 640 상한표 준수 (AC-8) + 미니는 **리드 1층만** — 그룹/게이트 중첩 0 |
| **5. 렌더** | 〔진실〕 | `:171` **잘림·겹침 0, 상승 빨강/하락 파랑, 상태 표기에 색+문구** (원문 전문) | **세 항 전부를 사상한다.** **(가) 잘림·겹침** → G8(붕괴 `px_height_measured==640` · 클리핑 `clipping==false` · 넘침 `content_bbox_height<=640`). **(나) 상승 빨강/하락 파랑** → **G8b / AC-9b**(방향값 2,081개 · 88보드). **(다) 상태 표기에 색+문구** → **의도적 이탈**: 미니는 리드 1층만 쓰고 상태 배지를 그리지 않으므로 검사 대상이 없다. **FU-6** 으로 이월. ⚠️ 증거 정정: 두 리뷰어는 `format.tone` 이 `{up,down}` 을 담는다고 전제했으나 실측은 `neutral` 8,588 · `change` 3,106 · 없음 31 이라 **방향이 `tone` 에 없다** — 방향의 기계 출처는 `paper_text` 선행 부호이며 `change` 중 **1,025개**가 무부호다 |
| **6. 검수** | 〔절차〕 | `:172` 마일스톤 PDF 사용자 승인 (원 규칙은 `:163` 전 보드 PDF) | **G11-6 — W2g 의 23장 PDF 를 `export_combined_pdf` 로 발송하고 사용자 승인. W3 하드 블로커.** ⚠️ **헌장 §6.2 로부터의 의도적 이탈**로 기록하며 **동의 문장 2개**(96장 대체 · 프로브 영구 잔류)를 PDF 에 명시하고 사용자가 그것을 포함해 승인해야 통과다 |
| **6b. 표본 12장 (승인 *전*)** | 〔절차〕 | — | 계열별 무작위 각 2장(총 12장)을 **G11-6 승인 이전에 실제로 렌더**해 PDF 에 포함한다. 추가로 `get_jsx` 추출 후 대장 레코드와 텍스트 완전 일치 — 불일치 0. **`source_template_sha` 를 `sample-provenance.json` 에 기록**하고 CP-1(3)이 대조한다 |
| **6c. W3 배치 컨택트시트 (조건부 정지)** | 〔절차〕 | `:163` 10% 단위 전 보드 PDF 의 **축소 복원** | W3 를 24행×4배치로 나누고 각 배치 종료 시 그 배치 PDF 를 발송한다. **무응답은 진행이다**(R-10 정지 시간 불변). **그러나** (i) 배치 N 에서 결함을 확인하면 배치 N+1 은 대장·템플릿 재도출 후에만 시작하며, (ii) **`judgment-boards.json`**(`kor` 스칼라 <5 13장 + 표 ≥2 19장 + `structure_missing` 11장, 중복 제거 ≈35~40장)에 속한 보드가 든 배치는 **명시적 무결함 확인이 있어야** 다음 배치로 간다 |

---

## 7. Open Questions (승인 시 `.omc/plans/open-questions.md` 로 이관)

**이전 리비전에서 닫힌 항목** — D1(96 확정) · D2(`2SCE-1`) · D3(코드 동결 + 보드 09 각주) · 제외 보드 범위(열거로 확정, D1-a) · 행 밴드 라벨 앵커(머리 라벨 슬롯으로 조임) · 배치 컨택트시트 권한 · R-11 의 크기(1장 라이브 대조 + 이분 판정) · "표본 12장이 충분한가"(4배치 컨택트시트로 96장 전체가 관찰됨).

**rev 6 에서 닫힌 항목** — **스칼라 밴드 라벨 앵커의 절반**: `paired_with` 후보가 측정으로 죽었고(`kor` 결손 스칼라 1,558 중 `paired_with` 보유 54, 그 중 **라벨 슬롯을 가리키는 것 0건**), 대신 **선택 제약(`kor` 우선) + 예외 열거 + `label_review`** 로 AC-10 을 83/96 보드에서 기계 성립시켰다.

남은 열린 질문은 여덟이다 — 그 중 **FU-5(문구 충돌 22건)** 와 **`structure_missing` 11장의 귀착 문법** 둘은 W2 비준 전에 답이 필요하고, 나머지는 실행과 병행하거나 후속으로 미룰 수 있다.

- [ ] **FU-3 / R-0 — 템플릿 트리의 선재 검증 실패 225건(62보드)을 별건으로 처리하는 것이 맞는가.** 현재 프로덕션은 `get_registry()` 폴백으로 **보드 표면 없이** 동작 중이고 이번 계획은 이 상태를 바꾸지 않는다. *영향: 이번 작업의 게이트를 차등으로 만들 수밖에 없는 근본 원인이며, R-11(값의 정본이 stale 일 수 있음)의 근원이기도 하다.*
- [ ] **FU-2 / R-1b — `BoardTemplate` 에 `kiumi` 를 노출하는 스키마 확장을 이번에 할 것인가.** 스펙 L54 는 **렌더러 반영만** 제외하며 파서 노출은 명시하지 않는다. *현 계획의 기본 경로: 미룬다.*
- [ ] **FU-1 시점 — 640 재도출 상한을 `orb-mini-card.js` 의 `LIMITS` 에 반영하는 후속 작업을 언제 여는가.** 이번 작업 직후 별도 플랜인가, 렌더러 반영(FU-2)과 묶는가. *괴리가 존재하는 동안 `orb-mini-card.js:21` 의 동기화 선언은 위반 상태로 남는다.*
- [ ] **W2g 템플릿 승인 재시도 정책** — G11-6 에서 사용자가 **일부 문법 템플릿만** 반려할 경우, 승인된 문법부터 W3 를 부분 착수할 것인가 전량 재승인까지 대기할 것인가. *영향: R-10 정지 시간. 부분 착수를 택하면 CP-1(3) 표본 출처 대조가 문법별로 쪼개져야 한다.*
- [ ] **FU-5 — 승인된 카드 보드 문구가 문구 3원칙과 충돌한다.** 원본 슬롯 `paper_text` 에 AC-7 금칙이 **22건** 있다(`금 99.99K` 계열 10 · `현재 매수 1호가` 12). 이 계획은 값을 바꿀 권한이 없으므로(스펙 L47) 열거 면제로 **비켜 갔을 뿐 해결하지 않았다**. 판단이 필요한 질문: **(a)** 승인된 카드 보드 문구가 3원칙을 어기고 있는 것인가, **(b)** `1호가`·`99.99K` 가 이 합성어·상품명 안에서는 정당한 제품 문구이고 금칙 정규식이 과하게 넓은 것인가. *영향: (a)면 카드 페이지 문구 정정이 별건으로 필요하고, (b)면 AC-7 정규식을 좁혀야 한다.*
- [ ] **`structure_missing` 11장을 어떤 문법으로 그릴 것인가.** 규칙이 `table` 을 냈지만 표 구조가 없는 11장은 W2 비준에서 사람이 결정한다. *현 계획의 기본 경로: 규칙은 배정하지 않고 `structure_missing: true` 만 남긴다. 대안으로 `table` 템플릿에 "표 구조 없음" 변형(리스트형 행)을 정의하고 `notice.columns` 를 0 으로 고정하는 길도 있으나, 그러면 §4.3b 0-부분 억제와 함께 설계해야 하므로 W2 판정 결과를 보고 정한다. ⚠️ `event`·`auth`·`reader`·`stream` 으로 귀착시키면 §4.4-8(iii) 재승인 비용이 발생한다.*
- [ ] **스칼라 밴드 fallback 라벨의 최종 판단 (AC-K5(3-scalar) 잔여).** rev 6 이 선택 제약과 열거로 범위를 좁혔지만, **`kor` 스칼라가 0개인 4장**(`2TJ6-1` 24슬롯 · `2TNJ-1` 24 · `2ZHC-0` 33 · `2ZZ7-0` 38)은 라벨 **전부**가 fallback 이다. 이 4장의 미니가 읽을 만한지는 W2 비준의 `label_review` 에서 사람이 판단한다. *현 계획의 기본 경로: 열거 + `label_review` 로 감사 가능하게 두고 규칙을 더 조이지 않는다 — 스칼라 밴드에는 행 밴드의 `(표, 열)` 같은 구조적 좌표가 없다.*
- [ ] **`feat/plugin-mode-doctrine` 레인이 템플릿 트리를 실제로 건드리는가** *(부분 해소)*. 그 워크트리에는 `backend/ref/card-surface-templates/` 가 **없으므로 도달 불가**다. 잔여 질문은 *같은 디렉터리에서 도는 다른 세션*이며 실행 시점에만 확인 가능하다. *영향: G2b `foreign-change:` 행의 예상 빈도.*

### Follow-up Register (이번 범위 밖으로 명시 이월)

| ID | 내용 | 이월 사유 |
|---|---|---|
| **FU-1** | **640 상한표를 `app/lib/orb-mini-card.js` 의 `LIMITS`(`:22-29`)에 반영한다.** 현행 값 `tableRows 3` · `factsRows 5` · `compoundScalars 3` · `compoundRows 2` · `logRecords 2` · `readerChars 140` 과 W2g 도출값의 차이를 표로 남긴다 | **D3 사용자 결정 — 이번엔 코드 동결.** `orb-mini-card.js:21` 이 보드 09 와의 양방향 동기화를 계약으로 선언하므로 괴리가 존재하는 동안 그 선언은 위반 상태다. 보드 09 각주가 이 티켓을 가리킨다 |
| **FU-2** | **`BoardTemplate` 에 `kiumi` 노출 + 오브 렌더러(`orb-mini-card.js`)가 실제로 그 필드를 읽어 그리게 한다.** 오늘 `kiumi` 는 파서가 통과시키되 읽지 않는 필드다 | 스펙 Non-Goal L54("오브 렌더러가 kiumi 를 읽어 그리도록 바꾸는 앱 코드 변경"). 이번 범위는 **디자인 + 백엔드 템플릿 기록까지**다 |
| **FU-3** | **템플릿 트리 선재 검증 실패 225건(62보드) 해소.** `load_registry` 가 통과하게 만들어 `get_registry()` 폴백을 제거하고, 그 위에서 **96장 라이브 Paper 전수 대조**(R-11 완전 해소)를 수행한다 | 다른 레인의 미완 작업이고 트리가 untracked 다. 이번 계획의 게이트가 **정확 등식이 아니라 귀속 차등**일 수밖에 없는 근본 원인 |
| **FU-4** | `app/lib/orb-mini-card.js` 의 `foldNote`(`:130-153`)에 **(i) 신설 4종 분기 추가**(`chart`·`order_ticket`·`order_confirm`·`auth`) + **(ii) 5종 기존 문구를 640 기준으로 갱신** + **(iii) 0-부분 억제**(`columns==0, rows==5` 일 때 `열 0개 · 행 5개…` 를 내지 않게) + **(iv) `compound` 문구에 열 항 추가**(오늘은 50장에서 접힌 열이 화면에 안 나온다) | D3 가 파일을 동결한다. FU-1 은 `LIMITS` 만 덮고 `foldNote` 의 kind·문자열 괴리는 덮지 않으므로 별도 항목이다. 이번 범위에서는 `kiumi_fold_note` 오라클이 계약을 소유하고 `test_fold_note_matches_js` 가 회귀만 탐지한다 |
| **FU-5** | 승인된 카드 보드 문구와 문구 3원칙의 충돌 **22건** 판정(§7 Open Question) | 계획이 값을 바꿀 권한이 없다(스펙 L47 "값 그대로, 지은 값 0"). 사용자 판단 필요 |
| **FU-6** | 헌장 게이트 5의 "**상태 표기에 색+문구**" 항을 미니에 도입 | 도입하려면 미니 문법에 상태 층을 더해야 하는데 스펙 L41 이 "새 문법 0"을 못박는다. G11-6 과 같은 형식의 **의도적 이탈**로 기록하고 이월 |

---

## 8. ADR — Architecture Decision Record

### Decision

**Option C(대장 선행 · 템플릿 층에서 디자인 · 양쪽 생성)로 96장의 키우미 미니 카드를 만든다.** 구체적으로:

1. 저작의 단일 출처는 **`backend/ref/kiumi/kiumi-ledger.jsonl`** 이고, `slots.json.kiumi` 필드와 Paper 출처 주석은 **둘 다 그 레코드에서 렌더된 파생물**이다.
2. 사람의 디자인 노동은 **문법 10종 템플릿 + 대표 보드 1장**(총 11장)에 집중하고, 96장은 **승인된 템플릿을 찍는다.** 전파 전제는 가정하지 않고 **표본 12장(승인 전) + 배치 컨택트시트 4회**로 실증한다.
3. 문법 배정은 **결정론적 규칙이 제안하고 사람이 비준**하며, 규칙 이탈은 `override_reason` 을 남긴다.
4. **Paper 쓰기 레인은 언제나 정확히 1개**(W2g → W3 → W4 → W6)이고, 비준 리뷰어 6 병렬은 **Paper MCP 도구 없이 기동**한다.
5. 게이트는 **진실/부기 2계층**으로 나눈다 — 진실 게이트는 상시 차단, 부기 게이트는 비가역 구간(W3)에서 보고 전용이었다가 Step 6 에서 차단으로 승격된다.
6. 저장소 변경은 `main` 에서 새로 딴 **`kiumi/mini-cards`** 브랜치에서만 하고, 허용 경로는 `backend/ref/kiumi/**` · `scripts/kiumi_*.py` · `scripts/validate_kiumi_field.py` · `backend/tests/unit/test_kiumi_field.py` 뿐이다.
7. 640 상한 재정의는 **보드 09 에만** 기록하고 `app/lib/orb-mini-card.js` 의 `LIMITS` 는 동결한다.

### Drivers

| # | Driver | 결정에 미친 영향 |
|---|---|---|
| **DD-1** | 주석↔필드 동일성을 어떻게 보증하는가 (스펙 L70-71) | **단일 출처 생성**을 채택한 이유. 두 곳에 각각 저작하면 AC-10·AC-11 이 96회 수동 대조가 되고 드리프트가 필연이다. C 는 동일성을 **구성상 참**으로 만든다 |
| **DD-2** | 96장의 문법 배정을 무엇이 정하는가 (스펙 L38 "동일 호출 로직", L44) | **규칙 제안 + 사람 비준 + `override_reason`** 을 채택한 이유. 순수 자동 도출(B)은 chart 를 한 장도 만들지 못하고, 순수 재량(A)은 감사 불가능하다 |
| **DD-3** | 640 상한 재정의가 앱 코드를 건드리는가 (스펙 L54 vs L66) | **코드 동결 + 보드 09 갱신 + FU-1 이월**(D3, 사용자 결정)을 채택한 이유. `orb-mini-card.js:21` 이 양방향 동기화를 계약으로 선언하므로 유예는 **명시적으로 기록**되어야 한다 |

### Alternatives considered

| 대안 | 무엇이었나 | 왜 채택하지 않았나 |
|---|---|---|
| **Option A — Paper 우선 저작** | 96장을 보드 단위로 `write_html` 하고 사후에 주석을 파싱해 `kiumi` 를 채운다 | **주 논거**: 저작 표면이 96×2 로 늘어나 AC-10·AC-11 이 96회 대조로 남는다 — 구조화 주석은 파싱을 쉽게 할 뿐 두 저작물의 동일성을 보장하지 않는다. **부분 논거**: 병렬 Paper 세션이 다수 필요해 R-5 **동시성** 노출이 최대다(단 C 는 쓰기 구간의 *길이*를 늘리므로 이 논거는 절반이며, CP-1 + 4배치가 그 대가를 치른다). A 의 장점(per-board 크래프트)은 템플릿 층 + 표본 12장 + 배치 컨택트시트 + 카드 게이트로 보존했다 |
| **Option B — 완전 스크립트 생성** | 구조 규칙만으로 문법·요소를 도출해 디자이너 패스 없이 96장을 찍는다 | 두 겹으로 반증됐다. (1) **DD-2 좌초** — 실측상 규칙만으로는 `137X-2` 를 chart 로 배정하지 못하고 10종 중 5종만 쓰인다. (2) **헌장 §6.3 6번 위반**(`docs/ui/paper-card-surface-charter.md:172`) — 사람이 그림을 한 번도 보지 않는다. B 는 삭제되지 않고 **C1 의 제안 단계로 흡수**됐다 |
| **Skeptic 반론 — "대장 없이 `kiumi` 필드만 저작"** | 저장 위치를 96개 `slots.json` 으로 두고 주석만 렌더한다 | **부분 채택**했다 — 그것이 정확히 C 가 하는 일이고 차이는 저장 위치뿐이다. 별도 파일을 유지하는 이유는 세 가지 **측정된** 이점에 한정된다: 비준이 96파일 diff 가 아니라 96행 diff(보드당 21~24 최상위 키 · 최대 417 슬롯) · 재생성 멱등 · **트리가 untracked 라 대장이 유일한 커밋되는 정본** |
| **Architect 안티테제 — "C 를 3분의 1로 줄여라"** | AC-K6 고지 산술 · 50종 전수 재포맷 테스트 · 22슬롯 면제 부기를 삭제하고 진짜 기계 게이트 둘 + 컨택트시트로 채운다 | **관찰은 채택, 처방은 절반만.** 삭제하면 사용자에게 **거짓 개수**를 표시하는 경로(스펙 L63)와 원본 문구 22건 충돌의 무언의 예외가 되살아난다 — 두 요구는 스펙에서 왔으므로 계획이 지울 권한이 없다. 대신 **§3.1 게이트 2계층화**를 채택해 부기 결함이 비가역 구간을 정지시키지 못하게 했다. 반론의 나머지 절반(컨택트시트에 실질 권한)은 G11-6c 가 채택했다 |
| **헌장 §6.2 전 보드 PDF 승인 유지** | 60·70·80·90·100% 시점마다 96장 전 보드 PDF 를 발송하고 승인 후 다음 배치 | **의도적으로 축소**했다(23장 1회). 등가가 아니므로 사상이 아니라 **이탈**로 기록하고 **동의 문장 2개**로 사용자 동의를 별도로 받으며, 축소의 전제("96장은 기계적 전개")를 표본 12장(승인 전) + 4배치 컨택트시트로 실증한다 |
| **`column_priority` 를 라벨 앵커로 사용** | 리뷰 처방대로 `label ∈ {kor, column_priority[col], head_label}` | **측정으로 기각.** 커버리지는 높지만(1,698 vs 1,696) `column_priority` 는 보드당 1개인데 표는 여럿이라 인덱스 공간이 어긋난다 — 두 앵커가 모두 있는 1,696건 중 **196건(11.5%)에서 값이 다르고**, `column_priority` 만 커버하는 2건은 `column_priority[4]=='시각'` 인데 값이 `+50`/`−250` 이다. 처방이 막으려던 사건(무관한 라벨)을 규칙이 승인하게 된다 |
| **픽셀 분산으로 스크린샷 붕괴 탐지** | `px_variance > 임계` | **실행 경로가 없어 기각.** 지정 인터프리터에 Pillow 가 없고(`find_spec('PIL')` → `None`), 디코더 추가는 AC-K8 허용 경로를 벗어난다. `px_height_measured` + `len(text_nodes)` + `content_bbox_height` 로 대체했고 **넘침 검사를 새로 얻었다**(신규 의존성 0) |

### Why chosen

1. **DD-1 이 구성상 해결된다.** 주석과 필드가 같은 레코드에서 렌더되므로 AC-10·AC-11 의 동일성이 검사 결과가 아니라 **구조적 사실**이 된다. 이것이 나머지 두 옵션과 갈리는 결정적 지점이다.
2. **DD-2 가 감사 가능해진다.** 규칙이 96장 중 85장을 결정론적으로 배정하고(R6 후), 판단이 필요한 14장(`chart_capable` 3 + `structure_missing` 11)은 **규칙이 스스로 지목해** 사람 판정 + `override_reason` 을 강제한다 — "손 목록"이 사라지고 조용한 오배정 경로가 닫힌다.
3. **디자인 품질 게이트가 살아 있다.** 헌장 §6.3 6번이 요구하는 "사람이 그림을 본다"가 G11-6(23장 승인) + G11-6b(승인 전 표본) + G11-6c(4배치 컨택트시트, 지목 보드는 긍정 확인)로 3중으로 보존된다.
4. **비가역 구간이 4등분된다.** 96장 Paper 쓰기는 되돌릴 수 없으므로, CP-1(3조건) → 24행 배치 → 배치별 부분 스냅샷으로 탐지 지연을 96장 뒤에서 24행 뒤로 당겼다.
5. **게이트가 자기 무게로 무너지지 않는다.** 네 리비전에서 반복된 실패 계통("처음 실행되는 날 통과할 수 없는 차단 게이트")을 §3.1 2계층화가 구조적으로 막는다 — 어떤 AC 도 삭제하지 않으면서.

### Consequences

**긍정**
- `kiumi` 필드 96개와 Paper 주석 96개의 동일성이 검사 없이 참이다.
- 96장 재생성이 멱등이다 — 실패 시 트리를 되돌리지 않고 대장만 고쳐 다시 찍는다.
- 트리가 untracked 인 상태에서도 **대장·기준선·증거가 전부 커밋되는 경로**(`backend/ref/kiumi/**`)에 남는다.
- 확정 카드 표면(`board.html` · `index.json` · 카드 페이지 · 보드 05)의 불변이 **해시로 증명**된다 — 선언이 아니라 게이트다.
- 640 상한이 **사람이 승인한 템플릿 위에서** 도출되고 그 사실이 해시로 증명된다.

**부정 / 감수하는 비용**
- **선행 비용**: 대장 스키마 + 생성기 6종 + 검사기 + 테스트 13케이스 + 템플릿 11장이 96장을 찍기 전에 필요하다.
- **일정이 사용자 응답에 묶인다**: G11-6 이 하드 블로커다(R-10). W2a~f 병렬로 흡수하지만 완전히 없앨 수는 없다 — 이것이 헌장이 요구하는 형태다.
- **헌장 §6.2 로부터의 의도적 이탈**: 96장 전 보드 PDF 승인이 23장 1회 + 비차단 통보로 축소된다. 별도 동의 문장으로 사용자에게 이 사실을 명시한다.
- **승인받지 않은 아트보드 ≤10장(`probe/*`)이 사용자 디자인 페이지에 영구히 남는다.** 동의 문장 2번이 이것에 대한 동의를 받는다.
- **`kiumi` 는 당분간 아무도 읽지 않는 필드다**(R-1b) — `validate_kiumi_field.py` 가 유일한 소비자이며 실제 렌더는 FU-2 다.
- **값의 정본이 라이브 Paper 가 아니라 추출 트리다**(R-11). `2SCE-1` 1장의 라이브 대조로 간극에 수치를 붙이지만 96장 전수 동일성은 증명하지 않는다.
- **다중 표 19장에서 화면 고지는 선택된 표 하나에 대한 수다.** 전체 접힘은 주석 총계와 보드 09 각주로만 정직해진다. 화면 문구 자체의 개선은 FU-4 다.
- **`compound` 50장에서 접힌 열은 화면에 나오지 않는다**(JS 문구에 열 항이 없다). 주석 총계가 유일한 정직 표면이다.
- **합의 미달**: 이 계획은 Critic 승인을 받지 못한 최선본이다(§0).

### Follow-ups

| ID | 내용 | 성격 |
|---|---|---|
| **FU-1** | **640 상한표를 `orb-mini-card.js` 의 `LIMITS` 에 반영** — D3 가 코드를 동결했으므로 보드 09 상한표와 코드 상수가 갈라진 채로 남는다 | **이번 결정이 만든 부채** (DD-3) |
| **FU-2** | **`BoardTemplate` 에 `kiumi` 노출 + 오브 렌더러가 실제로 읽어 그리게 하기** — 이번 범위는 디자인 + 템플릿 기록까지다 | 스펙 Non-Goal L54 |
| **FU-3** | **템플릿 트리 선재 검증 실패 225건(62보드) 해소** — 현재 프로덕션은 `get_registry()` 폴백으로 보드 표면 없이 동작한다. 해소 후 96장 라이브 Paper 전수 대조로 R-11 을 닫는다 | **선재 조건, 다른 레인 소관** |
| **FU-4** | `foldNote` 에 신설 4종 분기 + 640 문구 갱신 + 0-부분 억제 + `compound` 열 항 추가 | 이번 결정이 만든 부채 (D3 동결) |
| **FU-5** | 승인된 카드 보드 문구와 3원칙의 충돌 22건 판정 | **사용자 판단 필요** |
| **FU-6** | 헌장 게이트 5의 "상태 표기에 색+문구"를 미니에 도입 | 의도적 이탈 (스펙 L41 "새 문법 0") |

---

## 9. Changelog

### 9.1 rev 6 — 최종 Architect / Critic 패스 반영 (이 문서)

rev 5 초안(`.omc/drafts/kiumi-mini-cards-plan.draft.md`)의 **§1~§8 구조와 RALPLAN-DR 요약(원칙 5 · 드라이버 3 · 옵션 3 + 무효화 + 반론 2)은 그대로 유지**했고, D1/D2/D3 · 웨이브 골격 · Option C 의 DD-1 구성상 보증 · G11-6 사람 승인 게이트도 건드리지 않았다. **구조 교체 0 — 모든 변경은 §3·§4·§6·§7 의 국소 수정 + §8 ADR 신설이다.**

#### A. 블로킹 해소 (Architect 최종 패스 6건)

| # | 지적 | 적용 내용 | 반영 위치 |
|---|---|---|---|
| **A1** | 카드 페이지 `5-1` 무결성 계측이 없다 — 계획은 카드 페이지를 두 번 열고 `2SCE-1` 을 클론하는데 기준선·사후 대조·활성 페이지 단언이 전부 없다 | Step 0c 가 **`card_page_nodes`(`(node_id, name)` 전량) + `2SCE-1` `sha256(get_jsx)`** 기록 · CP-1·배치 경계 4회·G8 에서 재대조 · **모든 `write_html` 직전 활성 페이지 `C-2` 단언** · Step 3′b-3·0c 읽기 직후 `open_file(C-2)` 복귀 · **Step 5a 클론을 `get_jsx` 읽기 → `write_html` 로 못박고 카드 페이지 부모 `duplicate_nodes` 금지** · 재개 규칙 **(e)** 신설 | §4.5 Step 0c·3′b-3·5a · §4.0 Must-Have/Must-NOT · §6 G0·G8 · §5 R-5 |
| **A2** | AC-K5(2) 수치형 분기가 **848 슬롯에서 정의되지 않는다** | **항등을 기본으로 두고 `parse_number` 분기를 숫자 토큰 정확히 1개인 4,718 슬롯에만 적용.** 나머지 **848** 은 항등 전용으로 `$EV/identity-only-values.json` 에 열거·W3 전 동결. 테스트에 **"토큰 수 0/1/2/3+" 축** 추가 | §3 AC-K5(2) · §4.5 Step 0h · Step 1 케이스 6 · §6 G6 |
| **A3** | `source_table()` 단일 표 규칙이 고지를 구조적으로 거짓으로 만든다(스펙 L63) | 대장에 **`tables_total`·`tables_dropped`** 추가, AC-K6(D)가 `tables_dropped == max(tables_total−1, 0)` 단언 · **주석의 "접은 개수"를 `folded_slots` + `표 N개 전체 제외` 로 못박음** · 보드 09 각주 신설 · **R-13 신설** | §3 AC-K6(D)·AC-6 · §4.3b 표 마지막 행 · §4.5 Step 1·2·5b · §5 R-13 |
| **A4** | 스칼라 밴드 라벨이 앵커되지 않아 AC-10 이 96장 전부 무검사 | **(a) 선택이 `kor` 보유 슬롯 우선** · **(b) 채울 수 없는 보드만 `$EV/scalar-label-fallback-boards.json` 열거·동결** · **(c) 그 보드는 Step 3 명시 판정 대상 + `label_review` 필수** · **(d) AC-10 통과 조건을 `label_source=='kor'` 또는 열거 + `label_review` 로 교체** | §3 AC-K5(3-scalar)·AC-10 · §4.5 Step 0g·2 규칙 3·Step 3(c) · §6 G6 · §7 |
| **A5** | 승인 전에 그린 표본 12장이 반려된 템플릿에서 살아남는 경로 | Step 3′c-2 가 **`source_template_sha` 를 `$EV/sample-provenance.json` 에 기록** · **CP-1 세 번째 통과 조건** 신설 · 불일치 표본은 W3 b1 에서 삭제·재생성하고 재개 규칙 **(d)** 로 설명 · **R-12 신설** | §4.5 Step 3′c-2 · Step 4-0 CP-1(3) · §4.0 재개 규칙 (d) · §5 R-12 |
| **A6** | AC-9b/G8b 의 입력(색 실효값 출처·불일치 판정)이 정의되지 않음 | **Step 0d 가 `get_tokens()` 1회 → `$EV/paper-tokens.json` 동결** · `color_token` 을 **정규화 완전 일치**로 정의(소문자 · `#rgb`→`#rrggbb` · `rgb()`→hex) · **어느 값과도 불일치면 `null` 이며 위반** · `test_tone_gate_resolves_tokens` 필수 케이스 · **검사 범위 밖 방향값 수 보고** | §3.0 · §3 AC-9b · §4.5 Step 0d·Step 1 케이스 12 · §6 G8b |

#### B. 비블로킹 개선 반영 (Architect 7~14 + Critic 중복분 dedupe)

| # | 지적 (Architect / Critic) | 적용 내용 | 반영 위치 |
|---|---|---|---|
| **B1** | A7 / C3 — AC-6 이 **정의상 항상 참**(단일 출처의 부작용) | 주석의 "접은 개수"를 `folded_slots`(+ `tables_dropped`)로 못박아 §4.3b 표에 한 행으로 남기고, **`--annotations` 가 `--fold-math` 의 원본 `slots.json` 독립 재계산과 숫자를 대조**하게 했다 | §3 AC-6 · §4.3b 표 · §4.5 Step 4c · §6 G7b |
| **B2** | A8 / C4 — `source_table()` 선택 키 | 정렬 키를 **`(-body_value_cells, -len(body_rows), node_id)`** 로 교체. **실측으로 정당화**: 96보드 재실행 결과 선택이 바뀌는 보드는 **정확히 2장**(`15P5-2` 32→52셀 · `2TRW-1` 39→40셀), 버려지는 본문 셀 **545 → 524**. ⚠️ **Architect 가 든 근거 `3UTA-0` 은 이 변경을 이끌지 않는다** — 네 표(9/8/6/4행, 셀 수 동일 순서)라 두 키가 같은 표를 고른다. 근거를 정확히 옮겨 적었고 `3UTA-0` 의 18셀 손실은 A3 회계가 푼다 | §3.2 · §4.5 Step 1 케이스 9 · Step 2 규칙 4 |
| **B3** | A9 / C5 — §4.4-3 "대장 후보 집합"이 두 가지로 읽힌다(하나는 순환) | **(a) 그 문법 보드들의 `kind=="value"` 슬롯 전체**로 못박고 `elements[]` 읽기를 명시 금지. Step 3′b Acceptance 가 문법별 최장 값 문자열 길이 **실측값 기록**을 요구. 전역 최장 4개(**75자 `3LGC-0 s109`** · 67 `137X-2 s138` · 53 `3DI2-0 s220` · 50 `2SRV-1 s124`)를 미리 적어 상한이 낮게 나오는 것이 예측이 되게 했다 | §4.4-3 · §4.5 Step 3′ Acceptance |
| **B4** | A10 / C6 — `realized: false → true` 전이에 재승인 없음 | §4.4-8 에 **(iii)** 신설: 전이 시 **상한 재도출만으로 부족하고 G11-6 재승인 필요**. **Critic 보강 채택** — AC-8(d)는 부기 게이트라 Step 6 에서야 걸리므로 **판정 시점을 CP-1 로 당겼다**. Step 3(b) 판정 시 이 비용을 명시 인지 | §4.4-8(iii) · §4.5 Step 3(b) · Step 3′a · CP-1 |
| **B5** | A11 / C7 — Step 6 재작업에 규율이 없다 | **W6 를 §4.2 웨이브 표에 추가**하고 "Paper 단일 직렬 레인 · 12장 초과 시 배치 분할 · 경계마다 키우미 + 카드 페이지 재스냅샷 · 재개·중단 규칙 (a)~(e)" 명시 | §4.2 W6 행 · §4.5 Step 6 |
| **B6** | A12 / C8 — 기준선 파일 자신이 무방비(허용 경로 안이라 덮어써도 안 붉다) | **AC-K9 신설** + **Step 0i 기준선 커밋** + G2b·G4 통과 조건에 `git diff --quiet -- …baseline….json …manifest.json` 추가. 정당한 재기록은 R-9 판정 후 별도 커밋 | §3 AC-K9 · §4.5 Step 0i · §6 G2b·G4 · §5 R-9 |
| **B7** | A13 / C9 — 컨택트시트가 관찰만 하고 지목 권한이 없다 | **`$EV/judgment-boards.json`** 신설(`kor` 스칼라 <5 **13장** + 표 ≥2 **19장** + `structure_missing` **11장**, 중복 제거 ≈35~40장). **이 집합이 든 배치는 명시적 무결함 확인이 있어야 다음 배치로 간다**; 나머지는 무응답=진행 유지. 인프라가 이미 있으므로 추가 비용 ≈0 | §6 G11-6c · §4.5 Step 4b |
| **B8** | A14 / C10 — 표기 정정 2건 | (a) tracked 스크립트 목록의 `hooks/pre-push` → **`scripts/hooks/pre-push`**(실측 재확인, 13파일 목록 자체는 정확) · (b) §4.3b 표에 **`event`/`stream` 이 JS `:146` 한 줄을 공유한다는 각주** 신설 | §10 측정표 · §4.3b 표 각주 † |

#### C. Critic 단독 신규 지적 4건

| # | 지적 | 적용 내용 | 반영 위치 |
|---|---|---|---|
| **C1** | §3.1 이 "각 행에 표기한다"고 선언했으나 실제 표기는 6개 행뿐 — G0·G1·G2·G3·G4·G5·G9·G10·G11·G12 **10개 행이 비어 있었다** | §6 게이트 표에 **계층 열을 신설**하고 G0~G12 **전 행**에 〔진실〕/〔부기〕/〔절차〕를 채웠다. G11 은 6항 각각에 표기 | §3.1 · §6 게이트 표 · G11 표 |
| **C2** | `3UTA-0` 의 `column_priority` 는 **부재가 아니라 빈 리스트 `[]`** 다 — 구현이 `"column_priority" not in board` 로 번역하면 분기가 죽는다 | **실측 확인**(키 존재, 값 `[]`). 판정식을 **`not board.get("column_priority")`** 로 못박고 `test_source_table_selection_is_total` 의 `3UTA-0` 케이스에 빈 리스트를 명시 | §3.2 · §4.5 Step 1 케이스 9 · Step 2 규칙 4 |
| **C3** | Option A 무효화 논거 2("R-5 노출 최대")가 계획 자신의 각주에서 반쯤 철회됐다 | 무효화를 **논거 1(저작 표면 96×2) + §2.4 표의 세 측정 이점**에 재앵커하고, 논거 2 를 "동시성 노출은 줄지만 노출 구간 길이는 늘어난다(CP-1·4배치로 완화)"는 **부분 논거**로 명시. 옵션 선택은 바뀌지 않는다 | §2.4 · §8 ADR Alternatives |
| **C4** | `compound` 문구에 열 항이 없어(JS `:142`) **50장에서 접힌 열이 어느 화면에도 안 나온다** | §4.3b 표 각주로 명시하고, **B1/A3 의 주석 총계가 그것을 밝히는 유일한 정직 표면**임을 기록. FU-4 에 **(iv) `compound` 문구에 열 항 추가**를 신설 | §4.3b 각주 · §7 FU-4 |

#### D. 인용 정정 (verifier 실패 2건 + 자체 재측정 2건)

| # | 정정 | 근거 |
|---|---|---|
| **D1** | **`tone=='change'` 중 선행 부호 없는 것: 1,020 → `1,025`** | 이번 세션 재측정: `change` **3,106** = 선행 부호 보유 **2,081**(`+` 1,450 · `-` 411 · `−`(U+2212) 220) + 무부호 **1,025**. AC-9b 의 실제 범위(2,081 / 88보드)와 `sign is not True` **510** 은 재현 일치하므로 **어떤 통과 조건도 바뀌지 않는다** |
| **D2** | **origin 대비 "55 behind" 라는 수치를 삭제한다** | 측정 시점마다 변한다(리뷰 1차 55 → 2차 57 → 이번 세션 **60**). 가드레일이 실제로 의존하는 두 사실 — **워킹 트리 dirty**(→ Step 0 "stash 금지") · **`kiumi/*` 브랜치 부재** — 는 둘 다 여전히 참이다(재확인) |
| **D3** | tracked 스크립트 목록의 `hooks/pre-push` → **`scripts/hooks/pre-push`** | `git ls-files scripts/` 재실행 — 13파일, 경로는 `scripts/hooks/pre-push` |
| **D4** | 수치형 unit 이면서 숫자 토큰 ≠1 인 슬롯: 849 → **848** | 재측정 히스토그램 `{0:1, 1:4718, 2:755, 3:64, 4:13, 5:9, 6:4, 7:2}` → 1 아닌 것 **848**(= 755 + 92 + 1). Architect 본문의 849 는 산술 오기 |

#### E. 이전 패스에서 확인됐으나 rev 5 가 닫지 않은 블로킹 4건 (rev 6 에서 닫음)

| # | 지적 | 적용 내용 | 반영 위치 |
|---|---|---|---|
| **E1** | **§3.0 스냅샷 생산 시점이 W3 뒤**인데 §3.1 은 AC-2·AC-9·AC-9b 를 W3 상시 차단으로 선언 — 96장 비가역 쓰기가 끝나기 전에는 **실행할 입력이 없어** Step 4 Acceptance 가 구성상 만족 불가 | **배치별 부분 스냅샷 `$EV/paper-snapshot-b{1..4}.json` 신설** — 각 배치 경계에서 그 24장에 대해 AC-2/9/9b 를 돌리고 Step 5c 는 전량 재채집 | §3.0 생산 주체 2단 · §4.5 Step 4b(ii) · §4.2 W3 행 |
| **E2** | **`annotation_texts`·`directional_colors` 에 생산 계약이 없다** — Paper 노드는 슬롯 id 를 갖지 않고, 96개 주석 블록이 아트보드 밖이면서 role 이 없어 G8·배치 경계 검사가 **96건의 설명되지 않는 증감**으로 구성상 실패 | **`note/<index.json name>` role 신설(96장)** — role 표·CP-1 기대 개수·AC-1 분할·`artboard_role_counts` 에 반영. **요소↔슬롯 귀속은 방향값 텍스트 노드 이름 `v:<source_slot_id>`** 로 하고, 노드 이름 규약이 아트보드 role 규약과 별개임을 명시 | §3.0 두 규약 · §4.0 role 표 · §3 AC-1(b) · §6 G9 · §4.5 Step 4b·4c |
| **E3** | **Step 4b 의 "대표 보드와 표본 12장 재사용"이 role 회계와 충돌** — 대표 보드는 `template` 11장에 계상되는데 AC-1 은 `mini` 96장을 요구한다. 개명하면 CP-1 이 깨지고, 개명 안 하면 중복 생성 금지와 충돌 | **"재사용 대상은 `mini/*` 표본 12장(+ 짝 `note/*`)뿐이며 `template/2SCE-1` 은 template 로 남고 `mini/…2SCE-1` 은 W3 에서 새로 쓴다"** 를 한 줄로 못박고, 배치 표에 **실제 쓰기(84) / 재사용(12)** 을 분리 표기 | §4.5 Step 4b 재사용 규칙 |
| **E4** | **R-11 축소의 유일한 실증(Step 3′b-3)에 판정 규칙이 없다** — "불일치율이 크면 재고 사유"는 임계도 주체도 결과도 없는 재량 문구 | **이분 규칙**: 미니가 실을 요소의 값 문자열 집합에 **불일치가 1건이라도 있으면 W3 를 시작하지 않고** §4.0 재개·중단 규칙으로 판정한다. 그 밖의 불일치는 **비율만 기록**해 R-11 셀에 반영 | §4.5 Step 3′b-3 · §5 R-11 |

### 9.2 이전 리비전 요약

| rev | 판정 계기 | 주요 변경 |
|---|---|---|
| **rev 2** | Architect REVISE + 사용자 결정 | 헌장 §6.3 6번 게이트(G11-6) 복원 · **W2g 디자이너 템플릿 레인 신설** · AC-8 삼중 등식 → 2항(LIMITS 를 FU-1 로) · 대장 경로 `.omc/` → `backend/ref/kiumi/` · AC-K5 를 **슬롯 정체성**으로 재정의 · AC-K2 를 **귀속 차등**으로 · R2(이름 부분문자열) 삭제 + chart 를 override 전용으로 · **D1/D2/D3 확정** · 브랜치 가드레일 신설 · 인용 정정 6건 |
| **rev 3** | Critic REVISE (B1~B9) + Architect P-V1~V5 | AC-1 을 **분할 검사**로(role 접두사 규약) · **§4.3b 접힘 고지 계약** 신설 · **R4 정본 정의** 코드 블록 · §4.4 를 W0 → **W2g** 로 이동 · 증거 경로를 `.omc/` 밖으로 · AC-K3 3항 확장 · **D1-a 열거** · **§3.0 Paper→Python 인계 산출물** 신설 · AC-K7/G4 를 귀속 차등으로 · **R-11** 신설 |
| **rev 4** | Critic REVISE (A1~A7 · C1~C3) + Architect Synthesis | Step 2 를 **문법 의존 이중 밴드**로 전면 재작성 · AC-7 을 **출처 인지형 + 22슬롯 열거 면제**로 · 보드 09 해시 **2단 분리** · **`chart_capable` 파생 필드** · **`kiumi_reformat` 값 보존 불변식** · **CP-1 체크포인트** + W2a~f 도구 차단 · `px_variance` 삭제 → `content_bbox_height` · **`fold_counts` 2차원 분리** · AC-1(c) 를 `new` 집합으로 · **R6 구조 가드** · W3 를 24장×4배치로 |
| **rev 5** | Critic REVISE (블로킹 10) + Architect (P1~P6 · 개선 1~14 · S1~S3) | `notice` **7필드** 확장 + JS 키 사상표 · **`kiumi_slots_diff.py`** 저작 · AC-8(d)를 **해시 증명**으로 · **`limits-input-assignment.json`** + CP-1(2) · **행 밴드 라벨 앵커**(머리 라벨) · **AC-9b/G8b 색 게이트** 신설 · **`source_table()`** 정본 · R6 전/후 **분포표 2개** · 스크립트 개명(`kiumi_*` 글롭) · 레인 수 정정 + **배치 절단 규칙** · **§3.1 게이트 2계층화** · AC-K3(d) 도구 해시 · 재개·중단 규칙 (a)(b)(c) · **`live-paper-spotcheck`** |
| **rev 6** | Architect REVISE(블로킹 6 + 개선 8) + Critic REVISE(블로킹 10 + 개선 14) — **합의 미달, 최선본 확정** | 위 §9.1 |

---

## 10. Measurement Ledger — 이번 세션에서 파일을 직접 읽어 재현한 것

| 주장 | 확인 방법 | 결과 |
|---|---|---|
| **`.gitignore:9` = `.omc/`, 부정 규칙 없음** | `sed -n '7,11p' .gitignore` | `:7` `.claude/` · `:8` `.codex/` · **`:9` `.omc/`** · `:10` `.omx/` · `:11` `.unlazy/` ✅ |
| **tracked 스크립트 13파일, 도구 3종 전부 부재** | `git ls-files scripts/` | 13 — `beta/*` 5 · `gates/*` 4 · **`scripts/hooks/pre-push`** · `run-orb-probes.sh` · `verify-brain-ready-seed.py` · `verify-brain-ready.mjs`. `paper_board_extract.py`·`validate_board_slots.py`·`build_board_registry.py` **전부 없음** ✅ AC-K3(d) |
| **브랜치 상태** | `git status -sb` · `git branch --show-current` · `git branch --list 'kiumi*'` | `main`, 워킹 트리 dirty, `kiumi/*` **없음**. origin 대비 뒤쳐짐은 **측정 시점마다 변한다**(이번 세션 60) → 수치를 가드레일 근거로 쓰지 않는다 ✅ 인용 정정 |
| **공통 규칙 5개 · `LIMITS` 위치** | `sed -n '14,30p' app/lib/orb-mini-card.js` | 규칙 `:14-19`(1 `:15` "값을 짓지 않는다" · 2 `:16` "0개 고지 금지") · 동기화 주석 **`:21`** · `LIMITS` **`:22-29`** 6키(`tableRows 3`·`factsRows 5`·`compoundScalars 3`·`compoundRows 2`·`logRecords 2`·`readerChars 140`) ✅ |
| **`foldNote` 구조** | `sed -n '128,155p' app/lib/orb-mini-card.js` | `:130` def · **`:131` `{columns, rows, items, scalars, total, shown}` 6키 분해** · 문구 `:134`·`:138`·`:142`·`:146`·`:150` · 가드 `:133`·`:137`·`:141`·`:145`·`:149` · **`:152` 무조건 `return null`** · 함수 `:130-153`. **`event`/`stream` 은 `:146` 한 줄 공유** ✅ |
| **헌장 게이트 6항 원문** | `sed -n '160,175p' docs/ui/paper-card-surface-charter.md` | **`:163`** "60·70·80·90·100% … **전 보드 PDF**" · `:165` §6.3 · `:167` 원장 · `:168` 문구 · `:169` 정본 · `:170` 밀도 · **`:171` "렌더 — 잘림·겹침 0, 상승 빨강/하락 파랑, 상태 표기에 색+문구"** · **`:172` 검수 — 마일스톤 PDF 사용자 승인** ✅ |
| **헌장 §2.3 밀도 예산** | `sed -n '63,67p' …charter.md` | **`:65`** "### 2.3 한눈에 — 메인 표면 밀도 예산" ✅ |
| **`validate_board_slots.py` argparse 에 `--attribute` 없음** | `sed -n '305,325p' scripts/validate_board_slots.py` | `:312` `main` · `:313` ArgumentParser · `:314` `boards`(positional) · `:315-317` `--pack-dir` — **둘뿐** ✅ AC-K7 |
| **`validate_board_slots.py` 공개 심볼(import 계약)** | `grep -n "^def \|^TALLY_KEYS\|^TEMPLATE_ROOT\|^DEFAULT_PACK_DIR"` | `TEMPLATE_ROOT:34` · `DEFAULT_PACK_DIR:37` · `visible_fields:46` · `hidden_fields:58` · `check_board:142` · `TALLY_KEYS:250` · `tally:261` · `print_report:278` · `board_dirs:302` · `main:312` ✅ |
| **`card_surface_templates.py` 앵커** | `grep -n` | `HEIGHT_BUDGET_PX:52`(1120) · `_REQUIRED_BOARD_KEYS:66`(5키) · `_parse_table_cell:679` · **`_parse_board:738`** · `get_registry:1017` ✅ |
| **`canvas_transform.py` 앵커 + 분기** | `grep -n` · `sed -n '804,816p'` | `_RENDER_PLAN_LAYOUTS:319`(`{"facts","table","compound"}`) · `resolve_screen_render_contract:395` · `resolve_render_plan_kind:789` · `:806` renderer_id · **`:807-808` chart** · `:809-810` non-null→None · `:811-813` layout · **`:814` return None** ✅ |
| **추출기 계약** | `grep -n` + 본문 | **`GENERATED_TOP_KEYS:1460`** — 17키 열거, **`kiumi` 부재** ✅ · **`merge_authored:1780`**(`:1782-1784` = `for key … if key not in GENERATED_TOP_KEYS: payload[key] = value`) · **`dump_json:1818-1819`** = `json.dumps(payload, ensure_ascii=False, indent=2) + "\n"` ✅ |
| **`tone` 은 방향을 담지 않는다** | value 슬롯 11,725 `format.tone` 집계 | **`neutral` 8,588 · `change` 3,106 · 없음 31**. `up`/`down` **0** — 양 리뷰어의 전제가 틀렸다 ✅ AC-9b |
| **색 게이트의 실제 범위 (정정)** | `tone=='change'` 선행 부호 집계 | 선행 부호 보유 **2,081**(`+` 1,450 · `-` 411 · `−` 220) / **무부호 1,025**(rev 5 의 1,020 은 오기) · `sign is not True` **510** · 대상 보드 **88** ✅ **인용 정정 D1** |
| **수치형 숫자 토큰 분포** | 수치형 unit 5,566 슬롯 토큰 집계 | `{0:1, 1:4718, 2:755, 3:64, 4:13, 5:9, 6:4, 7:2}` → **토큰 1개 4,718 / 그 밖 848**. 예: `133H-2 s043` = `전일 149,000 · +1.24%`(2개) ✅ **A2** |
| **unit 분포** | value 슬롯 11,725 | `text` 5,197 · `percent` 1,924 · `krw_ko` 1,879 · `shares` 1,511 · `date` 529 · `time` 402 · `count` 252 · **unit 없음 31** ✅ |
| **표 개수 히스토그램 · 다중 표** | 96보드 `tables` 길이 | `{0:29, 1:48, 2:17, 3:1, 4:1}` — **2개 이상 19장**, 최대 **`3UTA-0` 4개** ✅ |
| **`3UTA-0` 의 `column_priority` 는 빈 리스트** | `slots.json` 직접 확인 | **키 존재, 값 `[]`** — "부재"가 아니다. 네 표 `3V3D-0`(9행/9셀) · `3V4K-0`(8/8) · `3V5P-0`(6/6) · `3V6K-0`(4/4), `column_labels` 는 넷 다 `['항목','금액','기준']` ✅ **C2** |
| **`source_table` 정렬 키 교체 영향** | 두 키로 67보드 재실행 | 선택이 바뀌는 보드 **정확히 2장** — `15P5-2`(32→**52**셀) · `2TRW-1`(39→**40**셀). **`3UTA-0` 은 불변**(두 키가 같은 표). 버려지는 본문 셀 **545 → 524** ✅ **B2** |
| **선택 표 밖 본문 셀** | 67보드 집계 | **545**(구 키) / **524**(신 키). 상위 `1JPU-0` 85/80 · `1JZW-0` 85/80 · `13BC-2` 60/40 · `15P5-2` · `2TRW-1` · `2Z49-0` 56/36 · `2QX1-1` 40/33 ✅ **A3** |
| **스칼라 밴드 라벨 부하** | 96보드 스칼라 value 집계 | 스칼라 **5,307** / `kor` 결손 **1,558(29.4%)**. **`kor` 스칼라 0개 보드 4장** — `2TJ6-1`(24) · `2TNJ-1`(24) · `2ZHC-0`(33) · `2ZZ7-0`(38). **5개 미만 13장** ✅ **A4** |
| **`paired_with` 는 앵커가 될 수 없다** | 전 슬롯 + 스칼라 결손 교차 | `paired_with` 보유 슬롯 **2,431** · 스칼라 `kor` 결손 중 보유 **54** · **그 중 라벨 슬롯을 가리키는 것 0건** ✅ §7 후보 기각 |
| **최장 값 문자열** | value 슬롯 전수 | **75자 `3LGC-0 s109`**(`count`) · 67 `137X-2 s138`(`percent`) · 53 `3DI2-0 s220`(`date`) · 50 `2SRV-1 s124`(`percent`) ✅ **B3** |
| **레지스트리 기준선** | `index.json` 집계 | 등록 **96** · CC-01 14 / CC-02 6 / CC-03 31 / CC-04 9 / CC-05 15 / CC-06 21 · state `default 13 / tab 31 / sort 32 / expand 20` · **CC-03 내부 `default 3 / tab 8 / sort 15 / expand 5`** → W2c **11** · W2d **20** ✅ |
| **앱 색 토큰 존재** | `grep -rn -- "--color-up" app/styles/*.css` | `card-kind-hoga.css:3` = `var(--color-up, #d92b2b)`(상승=빨강 확인) 외 다수 ✅ AC-9b 배경 |

### 이전 리비전에서 측정되어 이 문서가 계승하는 값

`load_registry` 문제 **225키 / 62보드**(board_id 없는 세그먼트 0, `problem_boards − targets == ∅`) · `validate_board_slots` **exit 1 / 1615 / 85**(대상 밖 `fixture-quote` 포함) · 매니페스트 **97 디렉터리**(96 등록 + `fixture-quote`), `board.html` 결손 0 · `slots.json` 최상위 키 **순서 포함 8종 / 정렬 후 7종**, 키 개수 21~24(21:27 · 22:57 · 23:9 · 24:3) · 슬롯 최대 **`2VIN-0` 417**(value 304), 최소 `32S7-0` 71 · value 슬롯 **11,725**(전부 non-null `format`, `kor` 보유 8,467 / 결손 3,258) · 밴드 분해 **행 6,418 / 스칼라 5,307** · 행 밴드 `kor` 결손 **1,700**, 머리 라벨 커버 **1,696**, `column_priority` 커버 1,698, **두 앵커 불일치 196**, 앵커 없음 **2**(`2QRP-1 s039`·`s058`) · 리전 분포 `table` 4,918 · `primary` 3,933 · `rail` 1,707 · `kpi` 529 · `other` 294 · `header` 205 · `footer` 74 · `strip` 33 · `workspace` 32 · `format` shape `{unit,sign,precision,tone}` 11,694 + 4종 31, 조합 **50종** · AC-7 금칙 히트 **22 슬롯 전부 `kind=="value"`**(label 히트 0) · `chart_capable` **3장** · `structure_missing` **11장** · **Pillow 부재**(`find_spec('PIL')` → `None`) · 최상위 `row` 는 18,045 슬롯 전부 `None`, `table.row=='head'` 541, `kind=="value" and table.row=="head"` **0** · 선택 표 머리 라벨 440 중 412(93.6%)가 `column_priority` 안, 전부 있는 보드 59/67, 머리 라벨 0개인 선택 표 **0장** · `1JZW-0` `operation_refs` **빈 배열**(96보드 중 유일).

**Paper 측 미검증** — 보드 09 `2LFW-2` · 보드 05 `5EU-0` 의 노드 id 는 계획 단계 규칙상 Paper 도구를 쓸 수 없어 `.omc/state/deep-interview-state.kiumi-mini-cards-20260903.json:201,236` 을 통한 **간접 확인**이다. **Step 0d 가 실행 시점에 직접 확인한다.**
