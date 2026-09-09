# 모의투자 카드 API 전수 — 2026-09-10

제품은 `mockapi.kiwoom.com`만 쓴다. 이 보고서는 101장 Paper 보드에 대해
(1) 모의 거절 TR 값을 카드에서 뺐는지, (2) 모의 지원 REST 조회를 보드가 100%
참조하는지, (3) 직전 실데이터 표기 결함을 고쳤는지, (4) 버튼을 전수 눌렀는지를
검수 가능한 숫자로 적는다.

## 결론

| 항목 | 결과 |
| --- | --- |
| 모의 거절 12 TR 값 바인딩 | 워크스페이스 로더 잔존 **0**. 단언 `test_loaded_boards_have_no_mock_unsupported_value_bindings` |
| 거절 TR 자리의 화면 계약 | `empty_value_slots`(빈 칸). 「미제공」이 아님 |
| 모의 지원 REST 조회 커버 | **237 / 237**. 빈 항목은 `detail:kt00013:margin_order_capacity` 하나였고 3GRO-0·3IGR-0에 넣음 |
| 0패딩·부호 가격·비중%·금 헤더 | 2026-09-10 캡처에서 해소 확인 |
| 상태 문 클릭 | **87 / 87 responds**. `hit_blocked` 0, 오배선 0 |
| 카드 액션 | 호가 열기·종목 상세·알림 설정·알림 받기·조건 수정 반응. **차트 열기**를 종목 차트 보드로 이음 |
| Paper 목업 잔여 | **0** (`paper_mock_boards=0`) |
| 잘림·겹침 | **0** |

떠 있는 백엔드(8010, 계정 `daeju` 자격 잠금)는 이 워크스페이스의 거절-TR 생략을
싣지 않는다. 그래서 라이브 스윕에는 거절 TR 칸의 「미제공」이 14장에 남는다.
워크스페이스 백엔드를 8011에 띄우면 같은 잠금으로 기동이 거절된다. 생략 자체는
로더·계약 단위 테스트가 게이트다.

## 모의 거절 12 TR

원장 `backend/ref/mock-unsupported-trs.json`:

`ka01690`, `kt00002`, `kt00005`, `kt00012`, `kt00015`, `kt00016`, `kt00017`,
`kt20016`, `kt20017`, `kt50020`, `kt50021`, `kt50032`.

슬롯에서 이 TR이 제공하는 값만 걷는다. 다른 op의 값은 남긴다. 걷힌 자리는
빈 칸이고, 그 줄·블록은 접힌다.

## 모의 지원 REST 100%

`mock_supported_query_refs()`(카탈로그 `kind=query`, 주문·websocket·거절 TR 제외)
237종이 보드 `operation_refs` 합집합에 모두 나타난다.
단언 `test_mock_supported_query_refs_are_on_some_board`.
밀도 한도로 빠진 항목은 없다.

## 표기 결함 — 캡처 대조

캡처 `app/captures/card-api-sweep/*.png` (101장, 2026-09-10 재촬영).

| 결함 | 고치기 전 | 고친 뒤 (같은 보드) |
| --- | --- | --- |
| 0패딩 원문 | `133H-2` 수량 `000000000001` | `1` · `68` · `1,040` |
| 예수금 0패딩 | `2SKU-1` `000000319683159` | `319,683,159` |
| 부호 가격 | `2SCE-1` 현재가 `+88100` | `88,100` (하락 빨강) |
| 호가 사다리 | `13BC-2` `+274500` | `274,500` |
| 보유비중=평가액% | `2SCE-1` `5,938,089.0%` | 비중 칸은 `0.2%` 또는 비움. 평가액은 `5,938,089` |
| 금현물 헤더 | `2RJ7-1` `005930` | `금 99.99K` · `04020000 · KRX 금시장` |
| 영날짜 | `2SCE-1` `00000000` | 빈 칸 |

호가 보드 큰 현재가 `269500`(천 단위 없음)은 사다리 렌더러 쪽 표기다. 표 행은
콤마가 붙는다.

## 버튼 전수

`npm run verify:card-buttons` → `app/captures/paper-gates/CARD-BUTTONS.json`.

| 판정 | 수 |
| --- | ---: |
| responds | 996 |
| hit_blocked | 0 |
| gone / offscreen | 0 |
| inert | 5517 |
| 상태 문 실패 | 0 |
| 상태 문 오배선 | 0 |

inert 대다수는 버튼이 아닌 알약 모양 라벨(종목명·코드·「실시간」·현재 탭).
핸들러가 달린 inert 105건은 **지금 열린 탭**을 다시 누른 것이다(눌러도 안 바뀌는 것이 맞다).

고친 조작: 탐색·관심 레일 **「차트 열기」** → CC-03 차트 보드 `137X-2`.
「비교에 추가」는 목적지 보드가 없어 잇지 않았다. 주문 티켓 「주문 확인」은
검사 중 주문 REST를 부르지 않는다.

## 라이브 스윕

`npm run verify:card-api-sweep` (실제 `board-hydrate`, Paper 목업 주입 없음).

```
boards=101 paper_mock_boards=0 clipped=0 overlap=0
missing_boards=14 missing_sum=199
PNG=101
```

missing 14장은 모두 거절 12 TR 또는 `kt00010` `uv` / `ka10088` `ord_no` 미매핑이다.
8010이 거절 TR을 그대로 물어 「미제공」을 낸다. 워크스페이스 로더는 그 칸을
`empty_value_slots`로 비운다.

워크스페이스 uvicorn :8011 기동 실패 원문:
`another credential-owning Athena backend is already running for account 'daeju'`.

## 커밋

- `b08b5a32` 모의 거절 TR 값을 빼고 지원 조회 100% 참조
- `7a47ef18` 키움 0패딩·가격 부호와 금현물 identity
- `ff38cf87` 실데이터 스윕은 Paper 목업을 넣지 않음
- `b9e39f0e` 차트 열기 버튼을 종목 차트 보드로 이음

## 재현

```
cd app
node --test lib/board-format.test.js lib/board-mount.test.js lib/board-card-actions.test.js
cd ../backend
uv run python -m pytest tests/unit/test_mock_unsupported_cards.py -q
cd ../app
npm run verify:card-buttons
# 8010이 이 워크스페이스 코드일 때만 missing=0을 기대한다
ATHENA_SWEEP_CAPTURE=* npm run verify:card-api-sweep
```
