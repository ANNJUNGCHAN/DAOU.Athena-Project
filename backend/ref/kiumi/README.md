# 키우미 카드미니 계약

`kiumi-ledger.jsonl`은 Paper 파일 `01M0VGPX92K1TER4ZV9PWGQJJZ`, 페이지 `H-1`에서
사용자가 승인한 96개 카드미니의 저장소 정본이다. 모든 카드는 360×420이고, 질문에
따라 표시 부위를 바꾸지 않는다.

각 행의 `elements[].source_slot_id`가 원본 보드의 슬롯을 고른다. `paper_text`는 승인
당시 대조 증거이며 런타임 값이 아니다. 실제 값은 기존 대화 모드와 동일한
`surface_contract.slot_values`에서 오고, 값이 없으면 `미제공`으로 표시한다.

동기화와 검사는 다음 명령 하나가 소유한다.

```powershell
python scripts/build_kiumi_registry.py --write
python scripts/build_kiumi_registry.py --check
```

`--write`는 대장을 읽어 96개 `slots.json.kiumi`에 같은 계약을 투영한다. 원본 슬롯이
바뀌어 승인 슬롯이 사라지면 쓰기 전에 실패한다. 문법 배정이나 슬롯 선택을 바꾸려면
대장을 명시적으로 편집하고 Paper 디자인도 같은 정의로 다시 검토해야 한다.

## ⚠ 미해결: Paper H-1이 이 대장과 어긋나 있다 (2026-09-04 실측)

위 문단이 요구하는 "대장 ↔ Paper 같은 정의"가 **현재 성립하지 않는다.** 96장을 전수
대조한 결과 **일치 10 · 어긋남 84 · 매핑 확인불가 2**, 근거 없는 행 **227개**, 누락된
대장 element **190개**다.

증거: [`evidence/paper-ledger-divergence-20260904.json`](evidence/paper-ledger-divergence-20260904.json)
(카드별 unbacked/missing 목록 포함)

성격은 편차가 아니라 **다른 보드의 값이 섞여 들어온 것**이다. 예: `133H-2`(내 계좌)
카드는 5행 중 1행만 자기 보드 값이고, `+4,240,900원`은 `3UTA-0`, `28.0%`는 `3MTJ-0`,
`매입 85,519,340원`은 `3UTA-0`(거기서도 라벨은 총수익률) 것이다. `2TET-1` 카드의
`변화 / 25%`는 대장 96레코드에도, `template/order_confirm`·`template/order_ticket`
어디에도 없다.

**대장 쪽은 자체 일관성이 있다** — 484 element 전수 검사에서 값 앞에 부호가 있는데
`tone`이 change가 아닌 경우가 0개다. 보드별 슬롯 선택도 해당 보드 필드로 일관된다.
반대로 Paper는 보드 간 값이 섞였다. 그래서 **대장이 옳고 Paper가 틀렸을 가능성이 높다**
(단정하지 않는다 — 생성 경로를 못 찾았다).

**코드는 영향 없다.** 코드는 대장(→`slots.json.kiumi`)을 읽으므로 앱은 올바른 값을
그리고 `probe-orb-kiumi-96.js`도 통과한다. 오염은 Paper 페이지에 한정된다.

**왜 아직 안 고쳤나.** Paper 아트보드를 만든 **커밋된 생성기가 없다**. 지금 고치면 84장을
손으로 조립하는 것이고, 이 문서가 금지하는 방향이며 끝나고 통과/실패를 판정할 게이트도
없다. 고치는 올바른 순서는 (1) 대장 레코드 → 카드미니 마크업을 렌더하는 생성기를 커밋하고
(2) Paper 스냅샷 ↔ 대장을 비교하는 `--check`를 붙이고 (3) 그 다음에 재생성하는 것이다.
`build_kiumi_registry.py --check`는 `slots.json`만 검사하고 **Paper는 검사하지 않는다.**
