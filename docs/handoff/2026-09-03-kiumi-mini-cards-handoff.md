# 인계 — 키우미 미니 카드 전수 (2026-09-03)

> **후속 실행으로 대체됨.** 이 문서는 360×640 실행 전 상태의 역사적 인계다. 사용자가
> 이후 카드 규격을 **360×420**으로 바꾸고 코드 반영까지 승인했다. 아래의 "실행 안 함",
> `pending approval`, 옛 `kiumi/mini-cards` 시작 절차는 다시 수행하지 않는다. 현재 작업은
> `codex/kiumi-mini-cards-runtime` 브랜치와
> [새 런타임 인계](./2026-09-03-kiumi-mini-cards-runtime.md)를 기준으로 이어받는다.

> **한 줄 요약.** 키우미(오브)는 **오직 대화 모드의 축소판**이다. 카드 페이지의 확정 카드 96장을 360×640 미니 카드로 1:1 재설계해 Paper 키우미 페이지에 올리고, 카드별 "키우미에 보여줄 부분"을 Paper 주석과 `slots.json` `kiumi` 필드 두 곳에 기록한다. **딥 인터뷰(스펙)와 합의 계획(rev 6)까지 끝났고, 실행(ralph)은 시작하지 않았다.**

이 문서만 읽으면 다른 컴퓨터·다른 세션에서 그대로 이어받을 수 있게 썼다. 정본 파일은 `.omc/`(git 무시 경로)에 있으므로, **추적되는 사본**을 이 디렉터리에 함께 두었다.

> **바로 이어받으려면** [KIUMI_PROMPT.md](./KIUMI_PROMPT.md) — 블록 A(새 컴퓨터 터미널 준비 + `.omc/` 복원)와 블록 B(Claude Code 첫 메시지) 를 순서대로 붙여 넣는다. 보내는 쪽의 커밋·푸시 절차도 그 문서 끝에 있다.

| 산출물 | 정본(.omc, 무시 경로) | 추적 사본(이 저장소) |
|---|---|---|
| 딥 인터뷰 스펙 (모호도 19.5%, PASSED) | `.omc/specs/deep-interview-kiumi-mini-cards.md` | [kiumi/deep-interview-spec.md](./kiumi/deep-interview-spec.md) |
| 합의 계획 rev 6 (pending approval, consensus_reached: false) | `.omc/plans/kiumi-mini-cards-plan.md` | [kiumi/plan.md](./kiumi/plan.md) |
| 인터뷰 상태 | `.omc/state/deep-interview-state.kiumi-mini-cards-20260903.json` | — (아래 §2에 요약) |

---

## 1. 지금 어디까지 왔나

| 단계 | 상태 | 비고 |
|---|---|---|
| 딥 인터뷰 (Round 0~10) | **완료** | 임계값 20%, 최종 19.5%. 온톨로지 11개 개체, 3라운드 연속 안정 |
| 스펙 작성 | **완료** | AC-1~AC-16, 비목표, 남은 가정 3개 |
| omc-plan 합의 (Planner/Architect/Critic ×4) | **완료, 합의 미달** | Critic이 4회 모두 REVISE. rev 6가 마지막 지적 전부를 반영했지만 5번째 검토는 받지 않았다 → 계획 §0 참고 |
| 브랜치 전략 결정 | **사용자 승인** | "카드 표면 레인을 먼저 커밋하고 그 위에 `kiumi/mini-cards` 브랜치" — **미실행** |
| ralph 실행 | **시작 안 함** | 사용자 지시: "하던 일까지만 진행하고 인계 준비" |

---

## 2. 사용자가 확정한 설계 축 (인터뷰 답변 그대로)

이 다섯 문장은 사용자가 반복해 강조한 것이다. 계획을 고칠 때도 이 축은 바꾸지 않는다.

1. **키우미는 오직 대화 모드의 축소판이다.** 다른 모드(그래프·에이전트·플러그인·백테스트)와 관련 없다. 백그라운드에서 대화 모드가 그대로 돌며 캔버스에 확정 카드를 띄우고, 키우미는 같은 세션을 작은 창으로 비춘다. 비유: Claude Code 데스크톱이 computer use 때 작은 창이 되고 확대하면 같은 기능이 큰 창에 있는 것.
2. **대화 모드가 캔버스에 카드를 부르는 로직과 키우미가 카드를 부르는 로직은 동일하다.** 키우미 전용 호출 경로는 없다. (코드도 이미 그렇다: `app/main.js:3626-3657` 오브 제출 → 같은 `runLiveQuery`, `app/chat.js:2444-2465` 턴 뒤채움.)
3. **미니 카드 = 카드 페이지 보드와 1:1.** 크기 360×640 고정, 기존 미니 문법 10종 안에서만, 새 렌더러 0. 카드별로 다른 것은 "보여줄 부분"만이며 **디자인 시점에 미리 정의·고정**한다(질문과 무관).
4. **정의는 두 곳에 남긴다.** Paper 미니 보드 아래 출처 주석 4항목(원본 보드·가져온 요소·문법·접은 개수) + 보드별 `slots.json` `kiumi` 필드.
5. **동시 표시 흐름은 규칙 3문장 + 대응 보드 1장.** 한 세션·동일 호출·미리 정의된 표시 부분. 셸 숨김 규칙(셸 표시=알림 전용, 숨김=미니 채팅, Paper 보드 05)은 그대로.

완료 판정 7개(인터뷰 Round 10에서 잠금): ① 확정 카드 1장 = 미니 아트보드 1장, 원본 이름 그대로 ② 360×640, 스크롤 없음 ③ 10종 문법 중 하나, 새 문법 0 ④ 값은 원본 그대로, 지은 값 0 ⑤ 남기지 않은 요소는 접은 개수로 고지 ⑥ 출처 주석 4항목 ⑦ 같은 내용이 `slots.json` `kiumi`에 기록. 10종 상한은 640 기준으로 재정의.

### 계획 단계에서 내린 결정
- **D1** 1:1 대상 = `backend/ref/card-surface-templates/index.json` 등록 **96장** 전부(A 계열 4장 `1JPU-0`·`1JZW-0`·`1WOB-1`·`3N4O-0` 포함). Paper 쓰기(W3) 후 비가역. `slots.json` 없는 Paper 전용 보드(S00·S01·C01~C07·D01)는 제외.
- **D2** 대응 보드 예시 카드 = `2SCE-1`(CC-01 / R10-T1 보유종목). `133H-2`는 표가 없어 규칙상 facts 5/114가 되므로 부적합.
- **D3** 640 상한표는 **Paper 보드 09에만** 기록. `app/lib/orb-mini-card.js` `LIMITS`(:21-29)는 동결, 보드 09에 "코드 반영은 후속" 각주. → FU-1.
- **브랜치** 모든 저장소 변경은 `main`에서 새로 딴 `kiumi/mini-cards`에서만. 허용 경로: `backend/ref/kiumi/**` · `scripts/kiumi_*.py` · `scripts/validate_kiumi_field.py` · `backend/tests/unit/test_kiumi_field.py`.

---

## 3. 저장소 상태 (2026-09-03 09:00 확인) — 실행 전 반드시 볼 것

| 항목 | 값 |
|---|---|
| 브랜치 | 로컬 `main` 하나. **origin/main보다 55커밋 뒤**(원격은 백테스트 레인 진행 중) |
| 미커밋 | 추적 파일 수정 **19개**, 미추적 **43개 + 이 인계 3개**. 대부분 **카드 표면 레인**(템플릿 96장 `backend/ref/card-surface-templates/`, `card_surface_templates.py`, `board-*.js`, 헌장 등) |
| 원격 충돌 예상 | 로컬 수정 파일 6개가 원격에서도 바뀜: `app/main.js` · `app/shell.html` · `app/canvas.js` · `app/preload.js` · `PAPER_APP_PARITY.md` · `backend/tests/api/test_inventory_api.py` |
| 원격에 카드 표면 레인이 있는가 | **없다.** `index.json`·`card_surface_templates.py`·`board-mount.js`·헌장·`validate_board_slots.py` 모두 origin/main에 부재 |
| 동시 세션 | 같은 저장소에서 **다른 세션이 doctrine 딥 인터뷰/계획**(`.omc/plans/athena-agent-doctrine-plan.md`, `athena-plugin-doctrine-consensus.md`)을 돌리고 있었다. `.omc/state/deep-interview-state.json`은 그 세션 것 — 건드리지 말 것 |
| 템플릿 트리 검증 | `load_registry`가 **225건 문제(62보드)** 로 실패하고 `get_registry()`가 예외를 삼켜 **빈 레지스트리**를 돌려준다. 프로덕션은 지금 보드 표면 없이 동작. 이번 범위 밖(FU-3), 그래서 계획의 게이트는 "통과"가 아니라 "대상 보드에 새 문제 0"의 차등 |

**함의.** 키우미 코드는 카드 표면 레인의 미커밋 템플릿에 의존한다. 그냥 브랜치를 파면 키우미 커밋이 미커밋 파일에 기대게 된다. 그래서 사용자가 "카드 표면 레인 선커밋 → 그 위에 키우미 브랜치"를 택했다. **단, 카드 표면 레인은 다른 세션이 아직 손대고 있을 수 있으니 커밋 전에 그 세션이 끝났는지 확인하라.**

---

## 4. 이어받는 절차 (순서대로)

### 4.1 사전 확인 (읽기 전용)
```bash
git status --short --branch
```
```bash
git worktree list
```
`.omc/state/`에 다른 세션의 `ralplan-state.json`/`deep-interview-state.json`이 `active: true`이면 그 세션이 살아 있다. 카드 표면 레인 파일을 커밋하기 전에 그 세션과 조율한다.

### 4.2 카드 표면 레인 커밋 (2026-09-03 실행됨)
사용자 지시로 이 컴퓨터에서 실행했다. 브랜치 `feat/card-surface-paper-to-code`(카드 표면 레인의 인계 문서가 정한 이름)에 커밋 1 = 카드 표면 WIP 스냅샷, 커밋 2 = 키우미 인계 문서 3건. 절차 상세는 [KIUMI_PROMPT.md](./KIUMI_PROMPT.md) 맨 아래.

### 4.3 키우미 브랜치
`kiumi/mini-cards` 는 위 커밋 2를 가리키는 브랜치로 함께 푸시되어 있다. 받는 쪽에서:
```bash
git fetch origin && git switch kiumi/mini-cards
```

### 4.4 계획 승인 → ralph
계획은 `pending approval`이고 **합의 미달**이다. 실행 전 사용자가 계획 §0의 두 항목을 명시 승인해야 한다.
1. **G11-6**: 헌장 §6.2(전 보드 PDF 승인)에서 **의도적으로 이탈**해 23장(문법 10종 템플릿 + 대표 보드 + 표본 12장) PDF 승인으로 갈음한다 — 동의 문장 2개 필요(계획 §6 G11-6).
2. **W3 비가역**: 96장 Paper 쓰기 후에는 범위 축소가 불가능하다(D1). CP-1 세 조건과 배치 경계 4회 검사가 마지막 방어선.

승인되면 Claude Code에서:
```
/oh-my-claudecode:ralph .omc/plans/kiumi-mini-cards-plan.md
```
(다른 컴퓨터라면 `.omc/plans/`가 없으므로 [kiumi/plan.md](./kiumi/plan.md)를 `.omc/plans/kiumi-mini-cards-plan.md`로 복사한 뒤 실행.)

### 4.5 W2 비준 전에 답이 필요한 열린 질문 2개 (계획 §7)
- **FU-5** 승인된 카드 문구 22건(`금 99.99K` 계열 10 · `현재 매수 1호가` 12)이 문구 3원칙과 충돌한다. (a) 카드 문구를 고쳐야 하는가, (b) 상품명·합성어 안에서는 정당하니 금칙 정규식을 좁혀야 하는가.
- **`structure_missing` 11장**: 규칙이 `table`을 냈지만 표 구조가 없는 보드의 문법을 사람이 정한다.

나머지 6개(FU-1 시점, FU-2 파서 노출, FU-3 트리 검증 실패, W2g 부분 승인 정책, 스칼라 밴드 fallback 라벨 4장, 동시 세션 도달성)는 실행과 병행 가능.

---

## 5. Paper 사실 (재확인용)

| 항목 | 값 |
|---|---|
| 파일 | `Athena` (`01M0VGPX92K1TER4ZV9PWGQJJZ`) |
| 페이지 | 화면 `1-0` · 카드 `5-1`(읽기 전용) · 증명 `F-1` · 키우미 `C-2`(유일한 쓰기 대상) |
| 키우미 보드 | 01 크기 3단계(접힘 76 / 전환 / 펼침 360×400 max 640) · 05 셸 숨김·표시(`5EU-0`, 불변) · 08 입력 스트립 얼굴(커밋 f880d79 이후 옛 그림) · **09 미니 카드 10종(`2LFW-2`, 640 상한표 갱신 대상)** |
| 카드 페이지 | 아트보드 104장 = CC 계열 92(이름 기준) + 비CC 12. 레지스트리는 card_id 기준 96 |
| 함정 | 비활성 페이지는 스크린샷이 빈 채로 나온다 → `open_file(pageId)`로 전환. 일부 보드는 `height: fit-content`가 0으로 붕괴 → **640 픽셀 높이 명시** |
| 토큰 | `--color-k-*`, `--color-up/down/flat`, `--font-body/strong/display/mono`(Daki·Daki B·Daki Title·Geist Mono), `--container-orb: 400px` |

---

## 6. 코드 지도 (읽기 전용 참조)

| 무엇 | 어디 |
|---|---|
| 오브 창 크기 | `app/lib/main/orb-window.js` (76 / 360×400 / max 640) |
| 오브 미니 채팅 → 같은 파이프라인 | `app/main.js:3626-3657` (`athena:orb-chat-submit` → `runLiveQuery(query,false,'orb',historyConversationId())`) |
| 셸 채팅창 뒤채움 | `app/chat.js:2444-2465` (`athena:orb-turn-committed`) |
| 셸 숨김 중 캔버스 피드 | `app/main.js:462-464` |
| 미니 카드 렌더러(10종·공통 규칙 5개·LIMITS·foldNote) | `app/lib/orb-mini-card.js` (:14-19 규칙, :21-29 LIMITS, :130-153 foldNote) — **동결** |
| 템플릿 레지스트리·검증기 | `backend/athena_api/card_surface_templates.py` (`_REQUIRED_BOARD_KEYS` :66, `_parse_board` :738, `get_registry` :1015-1033) |
| 템플릿 트리 | `backend/ref/card-surface-templates/<board_id>/{slots.json, meta.json, board.html, paper.jsx, regions.json}` + `index.json` |
| 호출 계약 | `backend/athena_api/canvas_transform.py:395` `resolve_screen_render_contract` |
| 헌장·문구 규칙 | `docs/ui/paper-card-surface-charter.md` (§6.2 마일스톤, §6.3 6게이트 :163-172) |

---

## 7. 이번 세션이 만든/바꾼 것

| 경로 | 내용 |
|---|---|
| `.omc/specs/deep-interview-kiumi-mini-cards.md` | 스펙 (신규) |
| `.omc/drafts/kiumi-mini-cards-plan.draft.md` | 계획 초안 rev 1~5 (신규) |
| `.omc/plans/kiumi-mini-cards-plan.md` | 계획 rev 6 (신규, pending approval) |
| `.omc/state/deep-interview-state.kiumi-mini-cards-20260903.json` | 인터뷰 상태, phase=handoff |
| `.omc/state/ralplan-state.json` | active=false (합의 루프 종료, 실행 미착수) |
| `docs/handoff/kiumi/deep-interview-spec.md`, `docs/handoff/kiumi/plan.md` | 위 두 정본의 추적 사본 (신규) |
| 이 문서 | 신규 |

소스·백엔드·Paper 파일은 **하나도 바꾸지 않았다.** 계획 단계 규칙(계획 승인 전 변경 금지)을 지켰다.
