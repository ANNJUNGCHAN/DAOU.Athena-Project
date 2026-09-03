# 인계 — 키우미 카드미니 360×420 런타임 (2026-09-03)

## 현재 상태

사용자가 Paper `Athena` 파일의 `H-1` 카드미니 디자인을 **360×420**으로 최종
승인했고, 같은 디자인을 실제 키우미 대화 경로에 반영했다. 작업 브랜치는
`codex/kiumi-mini-cards-runtime`이다. 옛 360×640 계획과 `kiumi/mini-cards` 실행
프롬프트는 역사 기록이며 다시 실행하지 않는다.

이 브랜치는 카드 표면 레인의 `4e4a800` 내용을 cherry-pick한 `58cf1af`을 검증
기준점으로 쓴다. `feat/card-surface-paper-to-code`는 그 뒤에도 별도로 진행 중이므로
향후 통합할 때는 그 브랜치의 최신 변경을 먼저 검토하고 일반 merge로 합친다.

96개 카드의 고정 표시 정의는
`backend/ref/kiumi/kiumi-ledger.jsonl`이 단일 정본이다. 생성기는 이 대장을 읽어
각 `backend/ref/card-surface-templates/<board>/slots.json.kiumi`에 같은 계약을
투영한다. 원본 슬롯에서 표시 부위를 다시 추론하지 않으므로 질문이나 원본 순서가
바뀌어도 승인된 선택이 저절로 바뀌지 않는다.

## 구현 계약

- 키우미는 기존 대화 모드가 받은 동일한 캔버스 봉투를 사용한다. 별도 데이터 호출은 없다.
- 실제 값은 `surface_contract.slot_values`에서 읽는다. Paper 예시값은 런타임에 쓰지 않는다.
- 모든 카드는 높이 420px 고정, 내부 스크롤 없음, 긴 제목·라벨·값은 줄바꿈한다.
- 현재 96장의 실현 문법 분포는 `chart 2`, `compound 50`, `facts 21`,
  `order_confirm 5`, `order_ticket 1`, `table 17`이다.
- 표 구조가 없는 11장은 승인된 `facts` override를 사용한다.
- 주문 티켓은 기존 계좌 게이트·실행 IPC·멱등키·실패/IN_DOUBT 상태기를 그대로 쓴다.
- REST 직결, Selector, 콜드 Claude, 상주 Claude, pushed 카드 모두 오브 기원 턴의
  동일 봉투를 카드미니로 전달한다.

## 검증 결과

- 백엔드 전수: `2769 passed, 5 skipped, 0 failed` (25분 47초)
- 앱 전수 단위: `2073 passed, 0 failed`
- 생성·추출 스크립트: `254 passed`
- pre-push 결정론 게이트 4종 + 앱 단위: 통과
- 96장 Electron 실화면: `rendered=96`, 높이 오류 0, 내부 overflow 0,
  잘린 텍스트 0, 주문 실행 버튼 존재
- 실제 Kiwoom mock REST 대화: 삼성전자 현재가 → `137X-2` chart 카드,
  420px, 내부 스크롤 0, 셸 이력 복귀 포함 `8/8`
- 주문 기능: 실행·실패 재시도·취소·API 차단·IN_DOUBT 재전송 차단 `21/21`
- 콜드 세션 재시도 origin 보존: `8/8`
- `build_kiumi_registry.py --check`, `paper_board_extract.py --check`,
  `build_board_registry.py --check`: 모두 exit 0
- 기존 `validate_board_slots.py`의 `59 (b15 e44) / 27보드`는 카드 표면 레인의
  승인된 기준선과 동일하며 카드미니 추가로 늘지 않았다.

## 다른 컴퓨터에서 이어받기

```bash
git fetch origin
git switch codex/kiumi-mini-cards-runtime
```

의존성은 저장소 README 방식으로 설치한 뒤 다음 최소 검사를 실행한다.

```bash
python scripts/build_kiumi_registry.py --check
python scripts/paper_board_extract.py --check
python scripts/build_board_registry.py --check
cd app && npm test
```

카드 표시 선택을 바꾸려면 먼저 Paper 승인을 받고 대장 한 곳만 편집한 다음
`python scripts/build_kiumi_registry.py --write`로 96개 슬롯 계약을 재생성한다.
