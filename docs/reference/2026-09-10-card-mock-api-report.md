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
| 거절 TR 「미제공」 | 라이브 스윕 **0** (이 워크스페이스 로더 :8010) |
| 남은 런타임 「미제공」 | 3장 16칸 — `kt00010` `uv` · `ka10088` `ord_no` 미매핑 |

라이브 스윕은 이 워크스페이스 uvicorn :8010에서 돌렸다. 거절 12 TR은 호출하지 않아
그 칸은 빈 칸이다. 남은 「미제공」은 화면이 안 준 조회 인자(`uv`, `ord_no`) 때문에
물어보지 못한 자리뿐이다.

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

`ATHENA_SWEEP_CAPTURE=* npm run verify:card-api-sweep` (실제 `board-hydrate`, Paper 목업 주입 없음).
캡처 `app/captures/card-api-sweep/*.png` 101장, 2026-09-10 02:30–02:32.

```
boards=101 paper_mock_boards=0 clipped=0 overlap=0
missing_boards=3 missing_sum=16
PNG=101
```

거절 12 TR `missing_text_visible` **0**.

남은 런타임 「미제공」 3장:

| 보드 | 칸 | hydrate 이유 |
| --- | ---: | --- |
| `3GRO-0` | 9 | `detail:kt00010:*` `arguments_unmapped:uv` — 증거금율 구간마다 `uv`를 안 넣음 |
| `2SKU-1` | 5 | 같은 `kt00010` `uv` (출금가능·예수금 예상) |
| `2SYW-1` | 2 | `base:ka10088` `arguments_unmapped:ord_no` — 선택된 주문 없음 |

`uv`/`ord_no`는 식별자라 기본값을 만들지 않는다(`hydrate-argument-defaults` `NEVER_DEFAULT`).

저작 결측어(프로브가 세지 않음): `2QRP-1`/`3JT4-0` 직전대비, `2RJ7-1` 52주, `2TET-1` 가격 「해당 없음」, `2XP6-0` 「집계 전」, `3IGR-0` 대용, 풋터 「영업부 · 담당자 미제공」.

## 캡처에서 남은 이상값

거절-TR·0패딩 수량·`+88100`·평가액%·금 `005930` 헤더는 이번 캡처에서 없다.

아직 보이는 것:

1. **순매수 `--N`** — 키움 원문이 `--2860591`. 이번 캡처에는 생문자로 남는다. 포맷터는 이후 부호 반복을 숫자로 읽어 `2R3M-1` s171이 `-286만 591`이 되도록 고쳤다(`board-format.test.js`).
2. **호가 헤드라인 `269500`** — 사다리 렌더러가 포맷터를 안 탐. `13BC-2`/`2QRP-1`.
3. **순위 행 이름** — 스윕 타깃 삼성 이름이 다른 종목 행에 붙는 경우 (`2V71-0` 1위 코드 `252670_AL`).
4. **빈 금현물 잔고 `3ODO-0`** — 거절 TR 값을 뺀 결과. 「미제공」 벽이 아님.

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
# 8010이 이 워크스페이스 로더일 때 거절 TR missing=0. uv/ord_no 3장은 남는다
ATHENA_SWEEP_CAPTURE=* npm run verify:card-api-sweep
```
