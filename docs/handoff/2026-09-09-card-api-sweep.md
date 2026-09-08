# 카드 표면 API 전수 검사 — 결측어와 글자 잘림 (2026-09-09)

브랜치 `claude/card-api-integration-ui-check-86682c`. 실제 백엔드(FastAPI 8010)와 실제
Kiwoom 모의 API로 Paper 보드 101장을 전수 마운트해, 화면에 찍힌 결측어와 잘린 글자를
세고 그 원인을 코드로 닫은 기록이다.

## 1. 무엇으로 재는가

두 도구가 새로 들어왔다. 둘 다 **실제 API를 부른다** — 픽스처가 아니다.

| 도구 | 무엇을 하는가 |
|---|---|
| `npm run verify:card-api-sweep` (`app/probe-card-api-sweep.js`) | 보드마다 `POST /api/v1/internal/canvas/board-hydrate`를 불러 실제 값을 받고, 실앱 셸에 마운트해 폭 4단계에서 **결측어 수**와 **글자 잘림**을 센다. 산출물 `app/captures/card-api-sweep/CARD-API-SWEEP.json` |
| `scripts/card-api-sweep/diagnose_slots.py` | 슬롯이 왜 안 채워졌는지 사유별로 센다(op 미호출·업스트림 오류·필드 없음·행 초과 등) |
| `scripts/card-api-sweep/hydrate_sweep.py` | 보드별 하이드레이션 채움 수만 빠르게 센다 |
| `scripts/card-api-sweep/explain_missing.py` | UI 리포트의 결측 노드를 슬롯으로 되찾아 사유별로 묶는다(남은 일감 목록) |

글자 잘림 계측은 `app/lib/board-text-clip.js`다. 텍스트 노드의 `Range` 사각형을 조상
클립 상자와 대조해 **스크롤로 닿을 수 없는** 잘림만 결함으로 센다(세로 스크롤은 계획이
허용한다).

준비: `backend/.env`(모의 API 자격)와 `app/node_modules`·`backend/.venv`. 워크트리에서는
주 체크아웃을 정션으로 잇는다. 백엔드는 `python -m uvicorn athena_api.main:app --port 8010`.

## 2. 실측 (보드 101장 · 폭 4단계)

| 항목 | 처음 | 지금 |
|---|---:|---:|
| 하이드레이션이 채운 값 슬롯 | 2,363 / 11,150 | 6,544 / 11,150 |
| 화면에 찍힌 결측어 | 4,712자리 · 85장 | **1자리 · 1장** |
| 세로 글자 잘림(스크롤로 못 닿음) | 64자리(1WOB-1) | **0** |
| 글자 겹침(`text_overlap`) | (안 재고 있었다) | **0** |
| 마운트 실패 보드 | 16장 | **0** |
| 가로 글자 잘림 | (안 재고 있었다) | 39자리 · 21장 — §5의 기존 빨감 |

가로 잘림은 이 트랙 이전부터 있던 것이다. 옛 코드(`aa696770`)로 같은 프로브를 돌려
2VDA-0 3자리·2R3M-1 2자리가 **똑같이** 잡혔다(같은 실행에서 결측어는 70 → 1, 36 → 17로
줄었다). 전부 가장 좁은 단계(창 480px · 표면 375px)에서 보드 내용이 411~487px이라
표면이 글자를 자르는 자리이며, `verify:paper-cards-mount`의 `overflow_x` 34장과 같은
뿌리다.

## 3. 닫은 결함

1. **보드가 선언하지 않은 op를 호출하지 않았다.** 슬롯이 가리키는 op가
   `board.operation_refs`에 없으면 그 슬롯은 영구 결측이었다(보드 41장 · op 139개).
   `_hydrate_operation_refs`가 슬롯이 실제로 가리키는 op를 선언 순서 뒤에 잇는다.
2. **필수 조회 인자가 없으면 op가 호출조차 안 됐다.** 각 op 요청 모델 설명문에서
   「전체」·「통합」 코드를 뽑아 화면 기본값 표를 만들었다
   (`backend/scripts/build_hydrate_argument_defaults.py` → `ref/hydrate-argument-defaults.json`,
   op 155개). 빈 자리만 채우고, 조회 대상(종목코드·주문번호)은 지어내지 않는다.
   빈 응답을 내는 기본값은 실측으로 교정한다(`calibrate_hydrate_defaults.py`).
3. **배열이 온 잎의 행 좌표를 잃고 있었다.** 표 셀은 `table.row`, 되풀이 블록은 노드
   경로가 행을 알고 있는데 계약은 `row_index`만 본다(표 셀 3,873 · 되풀이 1,390).
   `_derive_array_rows`가 두 좌표에서 행을 되찾는다. 판정 규칙은 「같은 필드 묶음이
   반복되는 깊이」이며, 확신할 수 없으면 손대지 않는다 — 틀린 행을 그리는 것은 결측어보다
   나쁘다.
4. **행 좌표 없는 배열 잎.** 한 자리에만 그려진 잎은 응답 정렬의 첫 원소를 쓴다. 같은
   배열 자리를 잎 여럿이 나눠 쓰면(행 좌표를 잃은 열) 채우지 않는다.
5. **저작이 `static`으로 못박은 값 자리 2,320개가 렌더러 계약에서 빠졌다.** 문면 자체인
   자리는 Paper 원문을, 응답에 필드가 없다고 사유까지 적힌 자리는 빈 칸을 쓴다.
6. **자료가 한 칸도 없는 되풀이 줄.** 계약이 `empty_rows`로 알리고 마운트가 그 줄만
   접는다. 표 첫 칸의 순번·구분 라벨이 값으로 세어져 접기를 막던 결함도 함께 닫았다
   (`data-bs-design-text`).
7. **실시간 전용 잎 967자리.** websocket op만 가리키는 잎은 첫 프레임 전에는 결측이
   아니라 대기다. 계약이 `realtime_pending_slots`로 알리고 마운트는 빈 칸으로 둔다.
8. **연쇄 인자.** 회원사코드·테마그룹코드·감시그룹SEQ·ETF 대상지수는 후보 목록을 API가
   직접 싣는다. 목록 op를 먼저 부르고 첫 항목을 쓴다
   (`ref/hydrate-argument-chains.json`, 요청당 1회).
9. **글자 잘림.** Paper가 레이어 이름에 「스크롤」이라 적어 둔 상자(`1WST-1`,
   "목록 본문 · 펼침 · 520px 스크롤")가 추출물에서 `overflow: clip`으로 나와 아래
   200px이 잘렸다. 이름이 선언한 대로 세로 스크롤을 켠다.

## 3.1 결측어를 쓰는 자리 — 확정 규칙 넷

「미제공」은 **물어볼 수 없었던 자리**에만 남는다. 나머지 빈 자리는 저마다 다른 처리다.

| 상황 | 화면 | 계약 |
|---|---|---|
| op가 호출되지 않았다 · 업스트림이 실패했다 | 결측어 | `unbound_slots` |
| 조회가 정상으로 답했는데 그 필드가 없다 · 값이 빈 문자열이다 | **빈 칸** | `empty_value_slots` |
| 값이 실시간 프레임으로만 온다(첫 프레임 전) | **빈 칸** | `realtime_pending_slots` |
| 자료가 한 칸도 없는 되풀이 줄 · 표의 열 | **줄·열을 접는다**(열은 머리글까지) | `empty_rows` · `empty_columns` |

셋째·넷째가 없으면 카드가 결측어 벽이 된다. 그 벽은 「제공되지 않는다」는 말을 스무 번
반복하는 것이고, 실제로는 「이 조회에는 그 값이 없다」였다.

## 4. 남은 결측어 1자리 — 정직한 실패

`2S4E-1`의 전일종가 한 칸(`base:kt20016`)이다. 그 조회가 **업무 오류**로 돌아왔다
(`upstream_business_result`). 규칙대로 결측어가 남는 자리다 — 물어봤고 실패했으므로
그 카드는 불완전하고, 렌더러가 재조회 안내와 함께 그 상태를 보여준다. 이 자리를 빈
칸으로 덮으면 실패를 감추는 것이 된다.

Paper가 **디자인으로 그려 둔** 결측어 라벨은 결함이 아니다(2YS8-0 · 2ZTA-0 · 3JT4-0 ·
2QRP-1 · 2TET-1 · 2XP6-0의 「해당 없음」·「미제공」·「집계 전」). 카드가 Paper와 1:1이라는
증거이므로 프로브는 렌더러가 찍은 것만 세고(`data-missing`) 그 자리는
`authored_missing`으로 따로 남긴다.

값 자리 50개의 저작 표시는 `scripts/card-api-sweep/author_unmapped_slots.py`에 결정과
근거가 남아 있다 — 바인딩 1 · 화면 문구 10 · 빈 칸 39. 재실행해도 같은 결과다(`--check`).

## 5. 손대지 않은 기존 빨감 — `verify:paper-cards-mount`의 `overflow_x`

같은 게이트를 **이번 변경 전 코드**(`aa696770`의 `board-mount.js`와 청크 6개)로도 돌려
대조했다. 두 판 모두 **101장 중 통과 67 · 실패 34**이고 실패 코드는 전부 `overflow_x`다.
즉 이 빨감은 이 트랙이 만든 것이 아니고, 좁은 단계(최소 29자리 · 4분할 14 · 2분할 2)의
반응형 압축 문제다. 별 트랙(통합 카드·Paper 정합)의 몫으로 남긴다.

이번 변경이 그 게이트에서 만든 빨감 하나(`text_multiset_dom_mismatch`)는 닫았다 —
`static: "blank"` 자리가 화면에서 빈 칸이 되었으므로 기대 다중집합에서도 빠져야 한다.
판정은 마운트 계약 하나에서만 읽는다(프로브가 `contractFor`를 본다).

## 6. 이어받는 법

```bash
# 1) 백엔드
cd backend && ./.venv/Scripts/python.exe -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8010

# 2) 전수 검사 (실제 API · 폭 4단계 · 약 12분)
cd app && npm run verify:card-api-sweep

# 3) 남은 결측어 사유
python scripts/card-api-sweep/explain_missing.py

# 한 보드만 · 스크린샷까지
ATHENA_VERIFY_BOARD_IDS=4AUX-1 ATHENA_SWEEP_CAPTURE=4AUX-1 npm run verify:card-api-sweep
```

게이트는 결측어가 남아 있으면 실패한다(`card api sweep failed`). 지금은 의도된 빨강이며,
그 목록이 산출물이다 — §4의 사유가 남아 있는 동안은 이 게이트를 초록으로 만들지 않는다.
