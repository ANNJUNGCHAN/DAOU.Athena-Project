# 카드 표면 Paper→코드 — 붙여 넣기 블록

정본은 [2026-09-03-card-surface-paper-to-code.md](./2026-09-03-card-surface-paper-to-code.md). 여기는 그 문서를 "바로 시작"으로 옮긴 것이다.

**공통 전제조건 2가지** — 하나라도 없으면 그 자리에서 멈추고 사용자에게 말한다.
1. 브랜치 `feat/card-surface-paper-to-code`가 origin에 있어야 한다(원본 PC가 지속 푸시한다). 확인: `git ls-remote --heads origin feat/card-surface-paper-to-code`
2. 모든 명령은 **Git Bash**에서 돌린다. PowerShell 아님.

Paper 대조·검수 PDF 단계만 **로그인된 Paper Desktop(computer-use) 또는 Paper MCP + 팀 접근 권한**이 필요하다(정본 §8). 둘 다 없으면 그 단계만 원본 계정 보유자에게 넘기고 나머지는 진행한다.

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

확인 3줄 — validator는 아래의 **정직한 기준선**, 두 테스트는 **실패 0**이어야 이어받을 자리가 맞다:

```bash
backend/.venv/Scripts/python.exe scripts/validate_board_slots.py 2SKU-1 13BC-2
```

```bash
backend/.venv/Scripts/python.exe -m pytest scripts/tests -q
```

```bash
cd app && npm run test:unit
```

첫 명령은 `2SKU-1` 문제 0, `13BC-2` 문제 3(`e3`)과 exit 1이 현재 정상이다. 세 건은 합성 leaf를 부분값으로 채우지 않기 위한 honest blocker다. 이 수치가 다르거나 scripts/app 테스트가 붉으면 정본 §7의 전체 기준선과 팩 폴더·venv·PATH(fnm)를 대조한다.

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

현재 정확한 중단점은 W3 정비 A5/B4/C5/D3와 저작 Tasks 1–8의 실행·리뷰 수정, canonical 재생성까지 완료된 shared worktree다. 2026-09-03 16:11 실측은 registry 96/excluded 0, coverage 3,382/3,532, uncovered 150, op 297/299, validator 59건(`b15 e44`)/27장이다. 저작 Tasks 1–8 또는 원본 Claude workflow를 재실행하지 말고 각 `task-{1..8}-report.md`의 honest blocker를 보존한다. `extra_fields` systemic audit는 `STOP_NO_CHANGES`이며 composite schema 승인 전 구현 금지다. 이후 적응형 가독성 웨이브 G1–G4를 실행·리뷰·푸시했다(`4e4a800`·`9c11c05`·`9c07c1b` + G4). 하드 glyph 어서션이 `enforce: true`로 켜져 있고 정본 캡처는 exit 0(24장·12 probe·36 측정 전부 0)이며 캡처 폴더는 정본 24장만 남았다(과거 12장 정리·격리). scripts 264·app 2,101·backend 카드표면 158·backend 전수 2,762 통과(기존 RED 1건 외 신규 실패 0), 추출 96/96 드리프트 0, validator·coverage 기준선 무변경. **그러나 같은 24장 육안 전수는 여전히 FAIL이다** — 13K0-2(480·640·960)·2R3M-1(480·960). 게이트 사각지대도 실측으로 확인했다: 96장 중 `bs-paired` 68장·`bs-paired-label` 0장·`data-paired-source` 0장이므로 `paired_semantics_violations`는 공허 참이고 `atomic_wrap_nodes`는 선언된 소유자만 측정한다. 다음 단계는 인계 문서 §6 1–2번에 노드까지 확정된 결함 A(미선언 한글 컨트롤·제목 분절)·B(좁은 flex 셀 금액 단위 분리)·C(무라벨 접힌 열 충돌) 수정과 게이트 확장(먼저 report-only, 13BC-2 대조군 영향 측정 후 enforce)이며, zoom/전역 nowrap/overflow 숨김으로 덮지 않고 나머지 66장의 무라벨 접기는 범위 밖 blocker로 유지한다.
```

## 블록 C — 원본 Claude workflow 역사 확인용, 실행 금지

원본 `wf_622eeae9-f84`에서 저작 8레인과 gate가 오류였던 것은 최초 실행의 역사적 사실이다. 이후 Tasks 1–8이 현재 shared worktree에서 별도로 실행·리뷰됐다. `resumeFromRunId`를 실행하지 말고 workflow JSON과 journal은 provenance 확인에만 사용한다.
