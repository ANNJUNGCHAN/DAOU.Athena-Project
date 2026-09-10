# 카드 표면 API 전수 검사 — 결측어와 글자 잘림 (2026-09-09)

> **병합 검수 정정:** 아래의 이전 UI 검사에서 기록한 「결측어 0」은 최종 화면의
> 증거로 사용할 수 없다. 검사기가 `pending/loading` 페인트 알림을 완료로 받아들여
> 숨은 보드 DOM을 계측했다. 공용 검사기를 수정해 최종 `data + verified_visible`
> 알림과 실제 활성 패널·호스트·표면 가시성을 요구한다. 수정 후 전수 검사에서는
> 101장 중 15장에 결측어 228자리가 관측됐다. 값이 없는 자리를 지우거나 지어내지
> 않으며 엄격한 결측어 0 게이트도 완화하지 않는다. 최신 판정과 환경 제약은
> [대화 정리 검수 기록](2026-09-09-main-conversation-closure.md)에 별도로 남긴다.

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
| `scripts/card-api-sweep/probe_mock_support.py` | 조회 op 264개(base·detail 전부)를 하나씩 실제로 불러 **모의투자가 지원하는지**를 요청·응답 본문과 함께 적는다. 주문 op와 websocket op는 부르지 않는다. 산출물 `docs/reference/2026-09-09-mock-unsupported-apis.md` · `app/captures/card-api-sweep/MOCK-SUPPORT.json` |
| `scripts/card-api-sweep/verify_operations.py` | 보드마다 조회를 실제로 부르고 **모든 op의 상태를 사유별로 판정**한다. 화면 결측어가 0이어도 「값이 정상으로 들어왔다」는 증명이 안 되기 때문이다 — 상류가 정상으로 빈 목록을 답한 자리는 규칙대로 빈 칸이라 화면에 흔적이 없다. 산출물 `app/captures/card-api-sweep/OPERATION-LEDGER.json` |

전수 프로브는 마운트 게이트와 **같은 기하 판정**(`assertSurfaceGeometry`)을 실데이터
경로에서 한 번 더 돌린다 — Paper 원문 픽스처로만 재면 값이 목업보다 길어질 때 처음
생기는 결함을 못 본다(§3의 13번). 그 위반은 게이트를 빨갛게 만든다.

글자 잘림 계측은 `app/lib/board-text-clip.js`다. 텍스트 노드의 `Range` 사각형을 조상
클립 상자와 대조해 **스크롤로 닿을 수 없는** 잘림만 결함으로 센다(세로 스크롤은 계획이
허용한다).

준비: `backend/.env`(모의 API 자격)와 `app/node_modules`·`backend/.venv`. 워크트리에서는
주 체크아웃을 정션으로 잇는다. 백엔드는 `python -m uvicorn athena_api.main:app --port 8010`.

## 2. 이전 검사 기록 (보드 101장 · 폭 4단계, 가시성 검증 수정 전)

| 항목 | 처음 | 지금 |
|---|---:|---:|
| 화면에 찍힌 결측어 | 4,712자리 · 85장 | **0** |
| 세로 글자 잘림(스크롤로 못 닿음) | 64자리(1WOB-1) | **0** |
| 가로 글자 잘림 | 37자리 · 20장 | **0** |
| 글자 겹침(`text_overlap`) | (안 재고 있었다) | **0** |
| 마운트 실패 보드 | 16장 | **0** |
| `verify:paper-cards-mount` | 통과 67 · 실패 34 | **통과 101 · 실패 0** |
| op 상태 결함(`verify_operations.py`) | (안 재고 있었다) | **0자리** |
| 실데이터 기하 위반(`surface_geometry`) | 10건 · 3장 | **0** |
| `verify:card-buttons` | 시간 초과(예산 900초) | **통과 101/101 · 1,607초** |

op 사유별로는 `bound` 485 · `mock_unsupported` 76 · `not_a_rest_read` 64 ·
`order_operation_refused` 14 · `arguments_unmapped` 7이다. 하이드레이션이 채운 값 슬롯
수(첫 실측 2,363 → 6,544)는 **상류 자료에 따라 실행마다 달라진다** — 순위·신고저가류
조회는 장이 닫히면 정상으로 빈 목록을 답한다(실측 ka10016 → `{"ntl_pric": [], "return_code": 0}`).
그래서 이 수를 기준으로 삼지 않고, op 상태 판정(위)을 기준으로 삼는다.

가로 잘림은 이 트랙 이전부터 있던 것이다 — 옛 코드(`aa696770`)로 같은 프로브를 돌려
2VDA-0 3자리·2R3M-1 2자리가 **똑같이** 잡혔다. 전부 가장 좁은 단계(창 480px · 표면
375px)에서 보드 내용이 391~487px이라 표면이 글자를 자르는 자리다. §3의 10번으로
닫았고, 잘렸던 보드 20장을 실제 API로 다시 재서 20장 모두 0을 확인했다(샤드 `f`·`g`,
산출물 `CARD-API-SWEEP-f.json`·`-g.json`).

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
10. **가로 글자 잘림 37자리(보드 20장).** 좁은 폭에서 안 줄어드는 가로 줄이 남는다 —
    flex item 기본 `min-width: auto`가 자식의 min-content를 지키기 때문이다. 구조만 보고
    미리 접으면 접힘이 높이를, 높이가 다시 폭 계약을 건드려 레이아웃이 정착하지 않는다
    (실측: 마운트 게이트가 카드 1종 14장에서 정착 한도에 걸렸다). 그래서 **재고 나서**만
    손댄다(`relaxOverflowRows`): 값이 실린 뒤와 폭이 바뀔 때마다 넘친 자리를 찾아, 그
    조상 사슬에서 표면에 가장 가까운 가로 줄 하나에 이미 있는 접기 계약
    (`[data-bs-wrap-row]`)을 주고 다시 잰다. 표·스크롤 소유자·세로 묶음은 건드리지
    않는다(각각 열 폭이 계약 · 스크롤로 닿는다 · 접으면 오른쪽 새 열로 간다).
    접을 줄이 없으면 **문장 라벨만** 접는다 — 원자값은 헌장대로 한 줄을 지킨다.
    잎의 상자가 표면 안에 있는데 눌린 칸에서 글자만 새는 자리가 보드 7장에 있어
    (2YS8-0 `2YWF-0` 폭 11px 안의 「장중 투자자 상위」가 3px 넘침) 자기 내용이 자기 칸보다
    넓은 가로 줄을 직접 찾는 갈래(`squeezedRow`)를 함께 둔다.
11. **접을 수 없는 표.** 남은 넘침은 전부 표·스크롤 상자 안이었다 — 열 폭이 표의
    계약이라 접기가 손대지 않는 자리다. 열을 줄이는 대신 계획이 허용하는 쪽을 쓴다:
    재고 나서, 접을 줄도 접을 라벨도 없을 때만 표면에 가장 가까운 넘친 상자 하나에
    가로 스크롤을 준다(`scrollOverflowOwner`). **폭은 건드리지 않는다** — `min-width: 0`을
    함께 주면 상자 폭이 바뀌고, 폭이 컨테이너 질의의 단계를 바꿔 다른 자리의 접힘까지
    흔든다(실측 2SYW-1 최소 폭에서 결측어 11자리가 되살아났다).
12. **금현물 보드를 주식 코드로 조회했다.** 상류가 502로 끊었고(2RJ7-1: ka50012·
    ka50079~83 여섯 자리) 그 자리는 전부 빈 칸이 되어 화면에는 흔적이 없었다. 종류별
    조회 대상 표를 ref 하나로 모으고(`backend/ref/probe-instrument-targets.json`, 앱
    프로브와 파이썬 검사기가 같은 파일을 읽는다) 금현물은 op 설명문이 적어 둔
    M04020000을 쓴다 — 2RJ7-1의 값이 0 → 67로 돌아왔다. ELW는 순위 op가 장이 닫히면
    빈 배열이라 조건검색(ka30005)으로 바꿨다.
13. **실데이터에서만 드러난 기하 결함 셋.** 앱 검수를 Paper 픽스처로만 하면 못 보는
    자리다. 전수 프로브에 마운트 게이트와 같은 기하 판정을 붙여 드러냈다.
    · **실제 종목명이 칸보다 높다** — 2XP6-0 `3FCI-0`은 55px 칸에 내용 59px로
      「1위 이수페타시스」가 목업 이름보다 길어 네 폭 단계 모두에서 칸을 뚫었다.
      높이 되돌리기는 CSS가 좁은 단계에서 이미 허용하지만 그 규칙이 닿지 않는 상자가
      남아 있었다 — 재고 나서 그 상자에만 같은 처방을 준다(`relaxOverflowHeights`).
      Paper 높이는 바닥으로 남기고 자라기만 허용한다.
    · **크기가 0인 스크롤 상자**를 「스크롤이 안 된다」고 셌다(133H-2 `14UQ-2`: 계좌
      조회가 모의투자 미지원이라 표가 비어 접혔다). 담긴 것이 없는 상자는 결함이 아니다.
    · **숨은 컨트롤**을 초점 결함으로 셌다(2SKU-1 `3GLA-0`: 그 줄에 자료가 없어 접혔다).
14. **넘침 처방이 폭 사이를 오가며 다시 돌았다.** 접기·스크롤이 스크롤바를 만들거나
    없애면 표면의 clientWidth가 두 값 사이를 오가고, 기억한 폭과 달라 처방이 다시 돈다 —
    그 사이 렌더러가 붙잡혀 프로브가 멈춘다(실측: 버튼 감사가 보드 100장을 지난 뒤
    출력 없이 33분 정지, 같은 보드 하나만 돌리면 39초에 통과). 처음 둔 표면당 8회
    제한은 이후 실제 리사이즈도 영구 중단시켜 병합 검수에서 제거했다. 관찰 기준을
    스크롤바에 흔들리는 clientWidth에서 외부 배정 폭인 border-box로 바꾸었다.
    한 번의 보정도 고정 6회에서 끊지 않고 새 줄·라벨·스크롤 표시가 더 없을 때 종료한다.
    표시는 중복 적용하지 않아 유한한 노드 수 안에서 수렴한다. 내부 폭 진동을 무시하고
    실제 폭 변경 12회를 계속 처리하는 회귀 테스트와 전수 마운트 101/101을 확인했다.

## 3.1 결측어를 쓰는 자리 — 확정 규칙 넷

「미제공」은 **물어볼 수 없었던 자리**에만 남는다. 나머지 빈 자리는 저마다 다른 처리다.

| 상황 | 화면 | 계약 |
|---|---|---|
| op가 호출되지 않았다 · 업스트림이 실패했다 | 결측어 | `unbound_slots` |
| 조회가 정상으로 답했는데 그 필드가 없다 · 값이 빈 문자열이다 | **빈 칸** | `empty_value_slots` |
| 값이 실시간 프레임으로만 온다(첫 프레임 전) | **빈 칸** | `realtime_pending_slots` |
| 자료가 한 칸도 없는 되풀이 줄 · 표의 열 | **줄·열을 접는다**(열은 머리글까지) | `empty_rows` · `empty_columns` |
| 상류가 「모의투자에서는 해당업무가 제공되지 않습니다」로 답했다 | 결측어(물어봤고 못 받았다) · 줄 전체가 비면 접힌다 | `unbound_slots` · op 원장의 `mock_unsupported` |

셋째·넷째가 없으면 카드가 결측어 벽이 된다. 그 벽은 「제공되지 않는다」는 말을 스무 번
반복하는 것이고, 실제로는 「이 조회에는 그 값이 없다」였다.

## 4. 결측어 계측과 op 응답 판정을 구분한다

이전 프로브의 결측어 **0**은 로딩 상태를 계측한 결과였으므로 폐기했다. 가시성 검증을
고친 뒤에는 결측어 **228**이 관측된다. 별개로, 상류가 정상으로 빈 목록을 답한 자리는
규칙대로 빈 칸이 되므로 화면에 흔적이 없다. 정상 빈 응답과 호출 실패를 가르는 것이
op 원장(`verify_operations.py`)이다. 최신 101장 조회에서도 분류되지 않은 결함은 0이며,
모의투자 미지원과 사용자 인자 부족은 별도 사유로 보존했다. 기본 상태는 넷이다.

  · `bound` — 조회가 `return_code 0`으로 답했다. 값 수가 0이어도 정상 응답이다
    (업무 오류는 `bound`가 되지 않는다, `canvas_push._hydrate_operation`).
  · `not_a_rest_read` — 실시간(websocket) 전용 op다.
  · `order_operation_refused` — 주문 op는 검사기가 부르지 않는다(모의 계좌라도).
  · `arguments_unmapped:*` — 화면이 주지 않은 조회 대상(주문번호 등)이 필요하다.

조회 op 264개(base·detail 전부)를 하나씩 부른 목록과 근거는
`docs/reference/2026-09-09-mock-unsupported-apis.md`에 있다 — 지원 233 · 모의투자
미지원 27 · 인자 부족 4 · 그 밖의 업무 거부 0. 요청 본문과 응답 본문을 그대로 적었다.

`mock_unsupported` 76자리는 **환경의 한계**다. 업무 오류로 온 op를 한 번 더 불러 응답
문면을 읽어 가른다 — 「모의투자에서는 해당업무가 제공되지 않습니다」(RC9000) ·
「모의투자에서 지원하지 않는 API 입니다」(8104). 계좌·금현물 계좌 조회가 거기 있고
(kt00002·kt00005·kt00015·kt00016·kt00017·ka01690·kt50020·kt50032·kt20016 등) 코드로
닫을 수 없다. 실계좌 자격으로 같은 검사기를 돌리면 그 76자리가 곧 판정 대상이 된다.

Paper가 **디자인으로 그려 둔** 결측어 라벨은 결함이 아니다(2YS8-0 · 2ZTA-0 · 3JT4-0 ·
2QRP-1 · 2TET-1 · 2XP6-0의 「해당 없음」·「미제공」·「집계 전」). 카드가 Paper와 1:1이라는
증거이므로 프로브는 렌더러가 찍은 것만 세고(`data-missing`) 그 자리는
`authored_missing`으로 따로 남긴다.

값 자리 50개의 저작 표시는 `scripts/card-api-sweep/author_unmapped_slots.py`에 결정과
근거가 남아 있다 — 바인딩 1 · 화면 문구 10 · 빈 칸 39. 재실행해도 같은 결과다(`--check`).

## 5. `verify:paper-cards-mount` — 통과 101 · 실패 0

이 게이트는 이 트랙 이전부터 빨간색이었다(`aa696770`의 `board-mount.js`와 청크 6개로
돌려도 **101장 중 통과 67 · 실패 34**, 실패 코드는 전부 `overflow_x`). §3의 10·11번으로
닫아 지금은 **통과 101 · 실패 0**이다(25~28초). 도중 실측:

| 단계 | 통과 | 남은 실패 |
|---|---:|---|
| 트랙 이전(`aa696770`) | 67 | `overflow_x` 34장 |
| 접기 처방(§3 10번) | 92 | `overflow_x` 9장 — 전부 표 안 |
| 표 가로 스크롤(§3 11번) | **101** | 없음 |

게이트 리포트의 넘친 상자에는 `display`·`flex-direction`·`flex-wrap`·접기 표시·표 안쪽
여부를 함께 적는다 — 「왜 접기가 손대지 않았나」를 리포트만 보고 알 수 있어야 다음
사람이 같은 진단을 다시 하지 않는다.

이번 변경이 그 게이트에서 만든 빨감 둘도 닫았다.
· `text_multiset_dom_mismatch` — `static: "blank"` 자리가 화면에서 빈 칸이 되었으므로
  기대 다중집합에서도 빠져야 한다(판정은 마운트 계약 하나에서만 읽는다).
· 같은 코드의 둘째 갈래 — 게이트의 기대 다중집합이 **종목 정체성 계약**을 몰라 자기
  픽스처의 종목코드를 결함으로 신고했다. 판정 조건을 마운트와 똑같이 둔다(CC-03만 ·
  값 자리만 · 라벨은 값을 무시한다).

## 6. 이어받는 법

PowerShell 터미널 1에서 백엔드를 실행하고 그대로 둔다. 이미 8010 포트에서 실행 중이면
이 단계는 생략한다.

```powershell
Set-Location C:/Projects/DAOU.Athena/backend
./.venv/Scripts/python.exe -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8010
```

별도 PowerShell 터미널 2에서 저장소 루트를 기준으로 실행한다.

```powershell
Set-Location C:/Projects/DAOU.Athena
# 전수 검사 (실제 API · 폭 4단계 · 약 12분)
npm --prefix app run verify:card-api-sweep
# op 상태 전수 판정 (실제 API · 약 6분)
./backend/.venv/Scripts/python.exe scripts/card-api-sweep/verify_operations.py
# 남은 결측어 사유
./backend/.venv/Scripts/python.exe scripts/card-api-sweep/explain_missing.py
```

한 보드와 스크린샷만 검사하려면 터미널 2에서 다음을 실행한다. 환경변수는 검사 후
원래 값으로 복원하므로 뒤의 전수 검사에 보드 선택이 남지 않는다.

```powershell
$previousBoards = $env:ATHENA_VERIFY_BOARD_IDS
$previousCapture = $env:ATHENA_SWEEP_CAPTURE
try {
    $env:ATHENA_VERIFY_BOARD_IDS = '4AUX-1'
    $env:ATHENA_SWEEP_CAPTURE = '4AUX-1'
    npm --prefix app run verify:card-api-sweep
} finally {
    $env:ATHENA_VERIFY_BOARD_IDS = $previousBoards
    $env:ATHENA_SWEEP_CAPTURE = $previousCapture
}
```

게이트는 결측어가 남아 있으면 실패한다(`card api sweep failed`). 모의투자 미지원이나
조회 인자 부족도 이 엄격한 화면 게이트를 자동 통과시키지 않는다. 이전 초록 결과는
가시성 결함 수정으로 무효화했으며 최신 실패 사유를 위 검수 기록에서 확인한다.

주의 둘.
· **백엔드 테스트는 `backend/`에서 돌린다** — `pyproject.toml`이 거기 있어 워크트리
  루트에서 돌리면 rootdir가 달라지고 하이드레이션 테스트 3건이 거짓 실패한다(실측).
· **`node`가 PATH에 있어야 한다** — 선택기 평가(`test_selector_autonomous_eval.py`)가
  `node`를 하위 프로세스로 부른다. 없으면 32건이 `FileNotFoundError`로 떨어진다.
  이 워크트리에서는 fnm 경로를 얹는다(`~/AppData/Roaming/fnm/node-versions/v22.14.0/installation`).
  얹고 돌리면 백엔드 3,863건 전부 통과한다(6 skip).

## 7. 이 트랙이 아닌 빨감 — 근거와 함께 남긴다

| 게이트 | 상태 | 이 트랙이 만든 것이 아닌 근거 |
|---|---|---|
| `verify:paper-screens` | 통과 83 · 실패 23 | §7.4 — 가장 큰 덩어리(`reach_failed` 11장)가 main의 백테스트 재작업으로 **사라진 표면**을 누른다. |
| `verify:paper-mini-static` | 어긋난 보드 171장 | 카드미니(kiumi) 트랙의 원장 어긋남이다. 게이트 자신이 「정본 결정 규칙 §5.2에 따라 대장은 고치지 않는다」고 적는다. |
| `verify` | 단언 4건 실패 | `app/verify.js`가 main과 **바이트가 같다** — 실패는 카드미니 메뉴·에이전트 캔버스 2건·부팅 타이밍이다. |
| `verify:live-full` | 질의 6건 `계좌를 찾을 수 없다` | **등록된 계좌가 있는 프로필**이 필요하다(§7.2). 온보딩 관문은 이번에 씨앗을 심어 넘겼다. |
| `verify:integrated-cards` | **통과**(카드 6종 · op 299 · 필드 3,705 · missing 0) | §7.1 — 다섯 층을 닫았다. |
| `verify:chat-v3` | **통과** | 판정식이 `2df6b103`에서 설계상 제거된 스피너를 계속 봐 `undefined`가 됐다 — 그 항을 뺐다. |
| `verify:semantic-workspaces` | 단언 1건(44px 터치 목표) | 여섯 층을 닫았고 마지막은 **트랙 간 계약 충돌**이다 — §7.3. |

### 7.1 `verify:integrated-cards` — 어디까지 닫았나

커밋 `1acaba57`(「실시간 계좌 귀속을 고정」)이 라이브러리에 **계좌 별칭**을 필수로 만들었고
이 프로브는 그 뒤로 갱신되지 않아 첫 틱에서 죽어 있었다. 제품 코드를 그대로 본떠 세 층을
닫았다.

1. **별칭 주입 자리를 제품과 같게 뒀다.** 제품은 활성 계좌에서 별칭을 주입한다
   (main.js `mountIntegratedCardRealtime`의 `withActiveRealtimeAccount`). 렌더러 payload에는
   별칭이 없으므로 검사기도 같은 자리(IPC 핸들러)에서 픽스처 계좌를 주입한다. 단위
   테스트의 가짜 관리자도 같은 방식이다(`integrated-card-realtime.test.js`).
2. **`update` 전에 `mount`를 부른다.** `update`는 이미 선 임차만 갈아 준다
   (`_mountOrUpdate(config, requireExisting: true)`). 제품도 IPC 채널이 둘로 나뉘어 있다.
3. **프로브 자신의 직접 호출에도 별칭을 준다**(`realtimeConfig`).

4. **호가 임차 기록기가 `invoke`를 못 들었다.** 렌더러는 `invoke`로 부르는데
   (canvas.js `wireOrderbookRealtime` — 응답의 `leaseToken`을 받아 쥔다) 기록기가
   `ipcMain.on`으로 듣고 있어 늘 빈 배열이었다. 프로브의 일반 핸들러를 잠시 기록기로
   갈아 끼우고 제품과 같은 모양으로 답한다 — 토큰을 줘야 해제도 나간다.
5. **짝 판정이 없는 필드를 봤다.** 해제 payload에는 종목이 없다 — 토큰만 있다
   (main.js `releaseRendererRealtimeLease`). 단언을 토큰 대조로 바꿨다.

이로써 이 게이트는 **통과**한다(카드 6종 · op 299 · 필드 3,705 · 고유 경로 3,703 ·
missing 0 · unresolved 0). 제품 계약은 손대지 않았다 — 확인만 했다
(`resolveLeaseBindings({cardId:'CC-04', mode:'regular'})`가 `0C`·`0D`를 정상으로 내준다).

### 7.4 `verify:paper-screens` — 진단

실패 23장의 코드는 `reach_failed` 11 · `structure_mismatch` 10 · `phrase_missing` 6 ·
`contract_no_sentence` 2 · `root_not_visible` 1이다. 이 트랙이 만든 것이 아니다 —
카드 프로브가 심는 모델 선택을 빼고 돌려도 **똑같이 83/23**이다(실측 대조).

가장 큰 덩어리는 **없어진 표면을 누르는 것**이다. main이 백테스트를 크게 걷어냈고
(`6d7b9f4c` 「옛 스펙 경로의 그리는 표면을 걷어낸다」 · `309c6dba` 「홈을 유일한 문으로
세우고」) 화면 게이트의 도달 절차는 그 옛 경로를 그대로 누른다.

  · 1WSI-1 — `#backtestCanvas .backtest-tab:nth-child(3)`를 누를 것이 없다
  · 2FR9-2 — `.backtest-flow-node.is-mine` 4개를 기다리다 시간 초과(실제 0)
  · 43WD-1 — `.routine-approval-actions button.routine-btn`(에이전트)

**여기서 선택자를 지어내면 안 된다** — 새 동선을 모르는 채로 고치면 게이트가 아무것도
검사하지 않으면서 초록이 된다. 백테스트·에이전트 트랙이 「새 홈 동선으로 절차를 다시
쓸지, 그 화면을 폐기할지」를 정해야 한다. 에이전트 화면은 별 워크트리 규칙도 걸린다.

### 7.3 44px 터치 목표 ↔ Paper 원문 밀도 — 두 계약의 충돌

`verify:semantic-workspaces`의 마지막 단언은 「표면 안 조작 요소는 44px 이상」이다.
390px(휴대폰) 단계에서 걸리는 것은 **카드 표면의 상태 링크** 둘이다 — 133H-2 `14T4-2`
「알림 설정」·`14T6-2`「호가 열기」가 51×16px이다. canvas.js가 그 잎에 `role=button`과
`tabindex`를 찍는 순간 조작 요소가 되지만, 크기는 Paper 원문 글줄 그대로다.

**고쳐 봤고 되돌렸다.** 좁은 단계에서 그 링크에 `min-height: 44px`을 주면 두 계약이
동시에 깨진다.
· 「컨테이너 규칙이 Paper 영역 노드의 display를 바꾸지 않는다」 — 카드 트랙의 단위
  테스트가 이것을 지킨다(`board-parity.test.js`의 5단 검사). 수직 정렬을 위해
  `display: flex`를 주면 즉시 빨개진다.
· 세로로 키우면 표면이 넘친다 — 마운트 게이트가 2XTO-0·2YA8-0에서 `surface_geometry`로
  떨어졌다(실측).

즉 이것은 「누가 틀렸나」가 아니라 **두 트랙의 계약이 만나는 자리**다. 셋 중 하나를
사람이 골라야 한다: (a) 390px에서 Paper 밀도를 늘려 44px을 허용한다, (b) 그 잎을
조작 요소로 만들지 않는다(칩·버튼으로 저작한다), (c) 44px 계약을 카드 표면에는
적용하지 않는다고 명시한다. 카드 트랙 혼자 정할 일이 아니라 그대로 남긴다.

### 7.2 `verify:live-full` — 어디까지 닫았나

이 검사기만 온보딩 씨앗을 심지 않아 셸이 온보딩에 머물고 첫 관문에서 떨어졌다. 다른
프로브 67개가 쓰는 것과 같은 씨앗을 심어 그 관문을 넘겼다. 그 뒤로는 실제로 돈다 —
모드 5/5 ok · 설정 ok · 종목 색인 준비 완료(3,524개) · 보이는 버튼 71개 · 금지된 주문
호출 0.

남은 것은 질의 6건이고 전부 상류가 **「계좌를 찾을 수 없다」**로 답한다. 이 검사기는
등록된 계좌가 있는 프로필을 요구한다 — 던져 버리는 프로필에는 계좌가 없다. 의도된
실행 방식은 `ATHENA_USERDATA_DIR`로 실제 프로필을 가리키는 것이다(main.js의 QA 하네스
주석). 자격이 없는 환경에서는 통과할 수 없다.

예산이 모자라 떨어지던 둘은 실측으로 고쳤다 — `verify:card-buttons` 900초 → 2,400초
(실측 1,607초 · 통과 101/101) · `verify:plugins` 90초 → 300초(실측 125초 · 통과).
둘 다 단독으로는 통과하므로 결함이 아니라 예산이 옛 보드 수 기준이었던 것이다.
