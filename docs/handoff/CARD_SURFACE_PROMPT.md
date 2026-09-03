# 카드 표면 Paper→코드 — 붙여 넣기 블록

정본은 [2026-09-03-card-surface-paper-to-code.md](./2026-09-03-card-surface-paper-to-code.md). 여기는 그 문서를 "바로 시작"으로 옮긴 것이다.

**전제조건 3가지** — 하나라도 없으면 그 자리에서 멈추고 사용자에게 말한다.
1. 브랜치 `feat/card-surface-paper-to-code`가 origin에 있어야 한다(원본 PC가 지속 푸시한다). 확인: `git ls-remote --heads origin feat/card-surface-paper-to-code`
2. 모든 명령은 **Git Bash**에서 돌린다. PowerShell 아님.
3. Paper 대조·검수 PDF 단계는 **로그인된 Paper Desktop(computer-use) 또는 Paper MCP + 팀 접근 권한**이 필요하다(정본 §8). 둘 다 없으면 그 단계만 원본 계정 보유자에게 넘긴다 — 나머지는 진행 가능.

## 블록 A — 터미널 (새 컴퓨터 1회, Git Bash)

```bash
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git && cd DAOU.Athena && git checkout feat/card-surface-paper-to-code
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

`node`가 PATH에 없으면 `eval "$(fnm env)"`를 먼저 통과시킨다(백엔드 pytest도 node가 필요하다). 한글 출력은 `export PYTHONIOENCODING=utf-8`.

확인 3줄 — 셋 다 **실패 0**이어야 이어받을 자리가 맞다(개수는 트랙이 테스트를 늘려 계속 커지므로 개수로 판정하지 않는다):

```bash
backend/.venv/Scripts/python.exe scripts/validate_board_slots.py 2SKU-1 13BC-2
```

```bash
backend/.venv/Scripts/python.exe -m pytest scripts/tests -q
```

```bash
cd app && npm run test:unit
```

실패가 있으면: 2SKU-1·13BC-2에 문제가 뜨거나 scripts 테스트가 붉으면 팩 폴더·venv를, app 단위가 붉으면 정본 §7의 "일시 RED" 항목과 PATH(fnm)를 먼저 의심한다.

## 블록 B — Claude Code 첫 메시지 (통째로 복사)

```
카드 표면 Paper→코드 트랙을 이어받는다. 먼저 docs/handoff/2026-09-03-card-surface-paper-to-code.md 를 전부 읽고, §11 갱신 이력의 마지막 줄이 가리키는 상태를 §7 표의 "읽기" 명령만으로 실측해서 §4 수치·§5 완료 신호와 비교해라(쓰기 명령은 아직 돌리지 마라). 실측이 문서와 다르면 문서가 아니라 실측을 믿고 차이를 먼저 보고해라.

지켜야 할 것:
- 카드는 오직 Paper 디자인에 있는 보드만 쓰고 디자인은 완전 동일해야 한다. 범용 렌더러·새 프리미티브 금지. 축소(zoom) 금지.
- 캔버스는 탭 스트립 + 카드 1장 뷰포트. 모든 카드 크기 동일, 컨테이너 폭 5단 반응형, 값·문구는 단계와 무관하게 불변.
- 표현은 직접·병기·펼침 3층만 인정(집약 불인정). 헌장 docs/ui/paper-card-surface-charter.md 를 항상 숙지한다.
- 사용자 결정 대기 항목(호가단위 100원·마이너스 기호·화면 페이지 그리드·기록 보드 3ZPB-0 승인)은 임의로 정하지 않는다. 🔒 표시 항목은 사람·외부 의존이라 승인 없이 끝낼 수 없다.
- backend/tests/api/test_task_canvas_envelope.py 의 RED 1건은 기존 WIP다. 고치지 마라.
- 인계 문서를 항상 최신으로 유지하고(§4 수치·§11 이력), 마일스톤마다 feat/card-surface-paper-to-code 브랜치에 커밋·푸시한다(사용자 지시). pre-push 훅이 막으면 --no-verify 대신 초록을 만든다.
- Paper 호출은 항상 fileId 01M0VGPX92K1TER4ZV9PWGQJJZ 를 명시한다(비슷한 이름의 duplicate 파일이 있다).

현재 정확한 중단점은 W3 정비 A5/B4/C5/D3 완료, 3차 저작 8레인은 탐색 후 한도 오류·순변경 0, 게이트는 tool call 0이다. §6을 위에서부터 진행하되 정비 4레인은 다시 돌리지 마라. docs/handoff/card-surface/workflows/card-surface-w3-wf_622eeae9-f84.js의 저작 레인 프롬프트를 현재 API와 대조해 실행한 다음 게이트를 돌린다(다른 PC에서는 ROOT·PY 수정). 각 게이트가 끝나면 실보드 6장 × 4단계 캡처와 XL/M 기하 프로브를 확인해 surface overflow와 L/M/S/XS 세로 넘침/겹침 0 및 XL/M 레이아웃 계약을 단언하고, Paper와 나란히 보고한 뒤 문서 §4·§11을 갱신하고 커밋·푸시해라.
```

## 블록 C — 원본 Claude 대화에서 한도 초기화 후 재개할 때

```
Workflow({ scriptPath: "C:\\Users\\USER\\.claude\\projects\\C--Projects-DAOU-Athena\\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\\workflows\\scripts\\card-surface-w3-wf_622eeae9-f84.js", resumeFromRunId: "wf_622eeae9-f84" })
```

주의: 워크플로 최상위 `status: completed`는 잘못된 요약이다. `C:\Users\USER\.claude\projects\C--Projects-DAOU-Athena\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\workflows\wf_622eeae9-f84.json`의 `workflowProgress`가 정본이며, 정비 4레인만 완료되고 저작 8레인과 게이트는 오류다. 재개 전 이 상태를 확인하고, 결과가 비면 같은 세션 폴더의 `subagents/workflows/wf_622eeae9-f84/journal.jsonl`을 읽는다.
