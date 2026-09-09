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
| 6자리 가격 천단위 | `13BC-2`/`2QRP-1`/`2SCE-1` `269,500` |
| 순위 행 이름·코드 | `2V71-0` 1위 `삼성전자` / `005930_AL` (같은 목록) |
| 순매수 `--N` | `2R3M-1` `-286만 591`, `1WOB-1` `-1억 1,446만` |
| 상태 문 클릭 | 게이트 **0 실패**. `hit_blocked` 0, 오배선 0. 자기 탭(2QFO-2 「투자자별」) inert는 제외 |
| 카드 액션 | 차트 열기 **28/28** · 주문 확인 **8/8** · 비교에 추가 **30/30** responds. 호가 열기 18 · 종목 상세 30 · 알림 설정 12 |
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

호가 헤드라인도 재스윕에서 `269,500`이다.

## 버튼 전수

`npm run verify:card-buttons` → `app/captures/paper-gates/CARD-BUTTONS.json`
(2026-09-10 04:05, 101장, 1,636s).

| 판정 | 수 |
| --- | ---: |
| responds | 1066 |
| hit_blocked | 0 |
| gone / offscreen | 0 |
| inert | 5447 |
| 상태 문 게이트 실패 | 0 |
| 상태 문 오배선 | 0 |

inert 대다수는 버튼이 아닌 알약 모양 라벨(종목명·코드·「실시간」·현재 탭).
`2QFO-2` 「투자자별」 inert는 **지금 열린 탭**이다.

| 조작 | 판정 |
| --- | --- |
| 차트 열기 | **28 / 28 responds**. 레일 CTA, `stock: card` → `137X-2` |
| 호가 열기 | 18 / 18 responds → `13BC-2` |
| 종목 상세 열기 | 30 / 30 responds → `137X-2` |
| 주문 확인 · 정정 확인 · 취소 확인 | 8+2+2 responds. 미리보기 문구만 바꾸고 **주문 REST는 안 부름** |
| 비교에 추가 | **30 / 30 responds**. 같은 카드에서 「비교에 넣음」 |
| 알림 설정 · 알림 받기 · 조건 수정 | 12+2+4 responds. 에이전트 모드로 씨문장만 심음 |

## 라이브 스윕

`ATHENA_SWEEP_CAPTURE=* npm run verify:card-api-sweep` (실제 `board-hydrate`, Paper 목업 주입 없음).
캡처 `app/captures/card-api-sweep/*.png` 101장, 2026-09-10 02:57–02:58.

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

## 캡처에서 해소한 표기

거절-TR·0패딩 수량·`+88100`·평가액%·금 `005930` 헤더에 더해, 재스윕 PNG에서 확인:

| 결함 | 고치기 전 | 이번 캡처 |
| --- | --- | --- |
| 호가 헤드라인 | `13BC-2` `269500` | `269,500` (KPI·사다리 밴드·첫 매수호가) |
| 시간외 현재가 | `2QRP-1` `269500` | `269,500` |
| 보유 평단·현재가 | `2SCE-1` `268750`/`269500` | `268,750`/`269,500` |
| 순위 1위 코드 | `2V71-0` 이름 삼성전자·코드 `252670_AL` | `삼성전자` / `005930_AL` |
| 순매수 `--N` | `2R3M-1` `--2860591` | `-286만 591` |
| 외국인 순매수 | `1WOB-1` `--114468977` | `-1억 1,446만` |

`3ODO-0` 금현물 잔고가 빈 것은 거절 TR 값을 뺀 결과다. 「미제공」 벽이 아니다.

남은 런타임 「미제공」은 위 3장(`uv`/`ord_no`)뿐이다.

## 커밋

- `b08b5a32` 모의 거절 TR 값을 빼고 지원 조회 100% 참조
- `7a47ef18` 키움 0패딩·가격 부호와 금현물 identity
- `ff38cf87` 실데이터 스윕은 Paper 목업을 넣지 않음
- `b9e39f0e` 차트 열기 버튼을 종목 차트 보드로 이음
- `a6611c4d` 키움 순매수 원문 `--N` 이중 부호
- `4e47015a` 6자리 가격 천단위와 순위 행 이름·코드 정렬
- `adb3f6a8` 차트 열기 `stock:card`, 주문 확인 미리보기, 비교에 추가
- `f2c78bdc` 같은 버튼의 두 번째 잎도 미리보기 횟수로 반응
- `2aa5f0f3` 버튼 전수 재프로브 결과를 보고서에 반영

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
