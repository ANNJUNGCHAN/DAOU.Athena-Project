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
