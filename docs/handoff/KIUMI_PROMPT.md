# 키우미 미니 카드 전수 — 다른 컴퓨터에서 이어받는 프롬프트 (2026-09-03)

아래 두 블록을 순서대로 쓴다. **블록 A**는 터미널에서, **블록 B**는 Claude Code 첫 메시지로 통째로 붙여 넣는다.
전제: 원래 컴퓨터에서 `kiumi/mini-cards` 브랜치가 푸시되어 있다(방법은 [2026-09-03-kiumi-mini-cards-handoff.md §4](./2026-09-03-kiumi-mini-cards-handoff.md) 와 이 문서 맨 아래 "보내는 쪽" 참고).

---

## 블록 A — 터미널 (새 컴퓨터)

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git && cd DAOU.Athena
```
```bash
git fetch origin && git switch kiumi/mini-cards
```
```bash
cd app && npm install && node node_modules/electron/install.js && cd ..
```
```bash
cd backend && uv sync --extra dev && cd ..
```
```bash
git config core.hooksPath scripts/hooks
```
`.omc/`는 git 무시 경로라 비어 있다. 인계 사본으로 정본을 복원한다.
```bash
mkdir -p .omc/specs .omc/plans .omc/state && cp docs/handoff/kiumi/deep-interview-spec.md .omc/specs/deep-interview-kiumi-mini-cards.md && cp docs/handoff/kiumi/plan.md .omc/plans/kiumi-mini-cards-plan.md
```
Claude Code를 열 때 확인할 것: **oh-my-claudecode 플러그인**(ralph 스킬)과 **Paper MCP**가 연결되어 있어야 한다. Paper 파일 `Athena`는 클라우드에 있으므로 같은 팀 계정으로 로그인하면 그대로 보인다.

---

## 블록 B — Claude Code 첫 메시지 (통째로 붙여 넣기)

```
너는 DAOU.Athena 저장소에서 "키우미 미니 카드 전수" 작업을 이어받는다. 스펙과 합의 계획은 이미 끝났고, 실행(ralph)은 아직 시작하지 않았다. 지금 컴퓨터는 원래 작업하던 컴퓨터가 아니다.

## 0. 먼저 읽을 것 (이 순서로, 전부)
1. docs/handoff/2026-09-03-kiumi-mini-cards-handoff.md — 진행 상태, 확정 설계 축, 결정 D1~D3, 저장소 상태, 이어받는 절차
2. .omc/specs/deep-interview-kiumi-mini-cards.md — 요구 정본 (AC-1~AC-16, 비목표)
3. .omc/plans/kiumi-mini-cards-plan.md — 합의 계획 rev 6. §0(합의 미달 경고)·§3(수락 기준)·§4(구현 단계)·§6(검증 게이트)·§7(열린 질문)·§8(ADR)을 빠짐없이 읽는다
4. docs/ui/paper-card-surface-charter.md — 카드 표면 헌장 (§6.2 마일스톤 승인, §6.3 6게이트)
5. app/lib/orb-mini-card.js — 미니 문법 10종·공통 규칙 5개(:14-19)·LIMITS(:21-29)·foldNote(:130-153). 이 파일은 읽기만 한다

두 .omc 파일이 없으면 docs/handoff/kiumi/ 의 사본을 위 경로로 복사한 뒤 진행한다.

## 1. 절대 바꾸지 않는 설계 축 (사용자가 인터뷰에서 확정)
- 키우미(오브)는 오직 대화 모드의 축소판이다. 그래프·에이전트·플러그인·백테스트 모드와 무관하다.
- 대화 모드가 캔버스에 카드를 부르는 로직과 키우미가 카드를 부르는 로직은 하나다. 키우미 전용 호출 경로·새 렌더러·새 문법을 만들지 않는다.
- 미니 카드는 카드 페이지 확정 보드와 1:1(index.json 등록 96장, D1), 360×640 픽셀 고정, 기존 미니 문법 10종 안에서만 그린다. 카드별로 다른 것은 "키우미에 보여줄 부분"만이고 디자인 시점에 미리 정의·고정한다(사용자 질문과 무관).
- 그 정의는 두 곳에 남긴다: Paper 미니 보드 아래 출처 주석 4항목(원본 보드·가져온 요소·문법·접은 개수) + 보드별 slots.json 최상위 kiumi 필드. 둘은 대장(backend/ref/kiumi/kiumi-ledger.jsonl) 한 레코드에서 생성한다.
- 값은 짓지 않는다. 미니의 모든 값은 원본 슬롯 하나에 귀속된다(AC-K5 슬롯 정체성). 접었으면 실제 개수만 밝힌다.
- 640 상한표는 Paper 보드 09에만 기록한다. app/lib/orb-mini-card.js 는 동결(D3, FU-1로 이월).
- 셸 숨김 규칙(셸 표시=알림 전용, 숨김=미니 채팅, Paper 보드 05)은 그대로.
- 문구 3원칙: 설명문 금지, 숫자는 한국어 단위(천·만·억·조), 내부 용어(TR id·축·1호가) 금지.

## 2. 불변 표면 (읽기만)
backend/ref/card-surface-templates/**/board.html · paper.jsx · index.json, Paper 카드 페이지 5-1 전체, Paper 키우미 보드 01~08(특히 05 = 5EU-0), app/lib/orb-mini-card.js, scripts/validate_board_slots.py · paper_board_extract.py · build_board_registry.py.
저장소 변경 허용 경로는 backend/ref/kiumi/** · scripts/kiumi_*.py · scripts/validate_kiumi_field.py · backend/tests/unit/test_kiumi_field.py · 보드별 slots.json 의 kiumi 키 추가(다른 키는 손대지 않음) 뿐이다.
Paper 쓰기는 파일 Athena(01M0VGPX92K1TER4ZV9PWGQJJZ)의 키우미 페이지 C-2 에서만, 단일 직렬 레인으로만 한다. 미니 아트보드는 height 640px 을 명시한다(fit-content 금지, 높이 0 붕괴 함정). 비활성 페이지는 스크린샷이 빈 채 나오므로 open_file(pageId) 로 전환한 뒤 검수한다.

## 3. 사전 점검 (읽기 전용, 결과를 보고한다)
- git status --short --branch 로 브랜치가 kiumi/mini-cards 인지, 작업 트리가 깨끗한지 확인한다. main 에서 작업하지 않는다.
- backend/ref/card-surface-templates/index.json 의 boards 가 96개인지 확인한다. 없으면 브랜치가 잘못 받아진 것이니 멈추고 보고한다.
- 계획 §6 G0 기준선을 기록한다: backend/.venv/Scripts/python.exe 로 load_registry 문제 집합(기대 225건·62보드), scripts/validate_board_slots.py 종료코드, 트리 파일 해시 매니페스트. 값이 기대와 다르면 원인을 보고하고 계획의 기준선을 갱신할지 사용자에게 묻는다.
- Paper MCP 로 get_basic_info 를 불러 파일·페이지(카드 5-1, 키우미 C-2)·보드 09(2LFW-2)·보드 05(5EU-0) 존재를 직접 확인한다(계획 Step 0d).

## 4. 실행 전 사용자 승인 (AskUserQuestion 으로, 하나씩)
계획은 pending approval 이고 합의 미달(consensus_reached: false)이다. 아래 두 승인을 받기 전에는 소스·백엔드·Paper 를 바꾸지 않는다.
1. G11-6: 헌장 §6.2(전 보드 PDF 승인)에서 의도적으로 이탈해, 문법 10종 템플릿 + 대표 보드 + 표본 12장 = 23장 PDF 승인으로 갈음하는 데 동의하는가. (계획 §6 G11-6 의 동의 문장 2개)
2. W3 비가역: 96장 Paper 쓰기 뒤에는 범위 축소가 불가능함(D1)을 인지하고 진행하는가.
이어서 W2 비준 전에 답이 필요한 열린 질문 2개를 묻는다(계획 §7): FU-5 카드 문구 22건(금 99.99K 계열 10·현재 매수 1호가 12)의 처리 방향, structure_missing 11장의 문법.

## 5. 승인되면
Skill("oh-my-claudecode:ralph") 를 .omc/plans/kiumi-mini-cards-plan.md 로 실행한다. 직접 구현하지 않는다. 계획의 웨이브 순서(W0 스키마·규칙·상한 → W1 대장 제안 → W2a~f 대장 비준 6병렬(Paper 도구 없이) + W2g 템플릿 디자인 → G11-6 사용자 승인 → W3 96장 생성 24장×4배치 → W4 대응 보드·보드 09 → W5 게이트)를 지키고, 각 게이트의 증거 문자열을 남긴다.

## 6. 보고 방식
- 매 웨이브 끝에 무엇을 바꿨고 어떤 게이트가 어떤 값으로 통과했는지 한 단락으로 보고한다. 실패는 숨기지 않고 값과 함께 쓴다.
- 계획과 다르게 하려면 먼저 이유를 한 문장으로 말하고 사용자에게 묻는다.
- 커밋은 kiumi/mini-cards 브랜치에만, 사용자가 시키기 전에는 push 하지 않는다.
```

---

## 보내는 쪽 (원래 컴퓨터) — 실제로 한 것 (2026-09-03)

이 컴퓨터의 로컬 `main`은 origin/main보다 55~60커밋 뒤이고 6개 파일이 원격과 충돌하므로 `main`을 그대로 푸시할 수 없다. 전송은 **브랜치**로 했다. 같은 작업 트리에서 카드 표면 Paper→코드 레인이 웨이브 3을 돌리고 있었고, 그 레인의 인계 문서([2026-09-03-card-surface-paper-to-code.md §1](./2026-09-03-card-surface-paper-to-code.md))가 브랜치 `feat/card-surface-paper-to-code` 와 WIP 커밋을 이미 정해 두었으므로 **두 인계를 한 브랜치에 이어 담았다.**

1. `feat/card-surface-paper-to-code` 브랜치를 HEAD(`f880d79`)에서 만든다. 작업 트리는 그대로다.
2. 커밋 1 = 카드 표면 레인 WIP 스냅샷(수정 19 + 미추적 전부, 템플릿 디렉터리가 전개되어 약 650개 파일. 키우미 인계 3건만 제외). `docs/handoff/README.md` 도 여기 들어간다.
3. 커밋 2 = 키우미 인계 문서 3건(이 문서·인계 문서·`kiumi/` 사본).
4. `kiumi/mini-cards` 브랜치를 같은 커밋에 만든다(포인터만, 체크아웃은 카드 표면 브랜치에 남겨 그 레인이 계속 작업할 수 있게 한다).
5. 두 브랜치를 푸시한다. pre-push 훅(`scripts/hooks/pre-push`)이 게이트 4종 + app 단위 전체를 돌린다.

받는 쪽은 `kiumi/mini-cards` 를 받으면 카드 표면 레인의 파일도 함께 온다(두 브랜치가 같은 커밋). `main` 과 origin/main 의 병합은 두 작업과 분리해 나중에 한다(`-X ignore-cr-at-eol` 필수, README §5).
