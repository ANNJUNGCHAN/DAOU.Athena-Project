# 카드 표면 Paper→코드 — 붙여 넣기 블록

정본은 [2026-09-03-card-surface-paper-to-code.md](./2026-09-03-card-surface-paper-to-code.md). 여기는 그 문서를 "바로 시작"으로 옮긴 것이다.

## 블록 A — 터미널 (새 컴퓨터 1회)

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

`node`가 PATH에 없으면 `fnm env`를 먼저 통과시킨다(백엔드 pytest도 node가 필요하다).

확인 3줄 — 셋 다 기준선과 같아야 이어받을 자리가 맞다:

```bash
backend/.venv/Scripts/python.exe scripts/validate_board_slots.py 2SKU-1 13BC-2
```

```bash
backend/.venv/Scripts/python.exe -m pytest scripts/tests -q
```

```bash
cd app && npm run test:unit
```

기준선: 2SKU-1·13BC-2 문제 0 / scripts 235 passed / app 2,033 pass. 다르면 코드보다 PATH·venv를 먼저 의심한다.

## 블록 B — Claude Code 첫 메시지 (통째로 복사)

```
카드 표면 Paper→코드 트랙을 이어받는다. 먼저 docs/handoff/2026-09-03-card-surface-paper-to-code.md 를 전부 읽고, §11 갱신 이력의 마지막 줄이 가리키는 상태를 §7의 검증 명령으로 실측해서 §4 수치와 비교해라. 실측이 문서와 다르면 문서가 아니라 실측을 믿고 차이를 먼저 보고해라.

지켜야 할 것:
- 카드는 오직 Paper 디자인에 있는 보드만 쓰고 디자인은 완전 동일해야 한다. 범용 렌더러·새 프리미티브 금지. 축소(zoom) 금지.
- 캔버스는 탭 스트립 + 카드 1장 뷰포트. 모든 카드 크기 동일, 컨테이너 폭 5단 반응형, 값·문구는 단계와 무관하게 불변.
- 표현은 직접·병기·펼침 3층만 인정(집약 불인정). 헌장 docs/ui/paper-card-surface-charter.md 를 항상 숙지한다.
- 사용자 결정 대기 항목(호가단위 100원·마이너스 기호·화면 페이지 그리드·기록 보드 3ZPB-0 승인)은 임의로 정하지 않는다.
- backend/tests/api/test_task_canvas_envelope.py 의 RED 1건은 기존 WIP다. 고치지 마라.
- 커밋은 사용자가 요청할 때만 한다.

그다음 §6 "남은 일"을 위에서부터 진행해라. 웨이브 3이 끝나지 않았으면 §5 절차대로 남은 단계만 다시 돌린다(docs/handoff/card-surface/workflows/card-surface-w3-*.js 를 경로만 고쳐 쓴다). 각 게이트가 끝나면 실보드 6장 × 4단계 캡처를 Paper와 나란히 놓고 보고하고, 문서 §11에 갱신 이력 한 줄을 남겨라.
```

## 블록 C — 원본 대화(같은 PC)에서 웨이브 3만 이어 돌릴 때

```
Workflow({ scriptPath: "C:\\Users\\ajc22\\.claude\\projects\\C--Projects-DAOU-Athena\\dff811ca-b4d0-4ed4-9c90-07bce304dc1a\\workflows\\scripts\\card-surface-w3-wf_622eeae9-f84.js", resumeFromRunId: "wf_622eeae9-f84" })
```

완료 레인은 캐시로 즉시 돌아온다. 결과가 비어 있으면 같은 세션 폴더의 `subagents/workflows/wf_622eeae9-f84/journal.jsonl`을 먼저 읽는다.
