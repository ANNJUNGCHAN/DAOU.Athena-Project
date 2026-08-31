# Athena 백테스트 모드 도입 계획서

- 상태: 기획 초안 · 구현 미착수
- 작성 기준: 2026-08-31 KST
- 브랜치: `claude/backtester-new-mode-integration-536ff0`
- 원본 참조: `koreainvestment/open-trading-api` → `backtester/` (KIS 백테스터)
- 대상: 셸 모드 계약, `athena_api` 백엔드, `athena_mcp`, Paper 디자인

## 0. 한 줄 요약

KIS 백테스터의 **전략 스키마와 화면 문법**을 가져오고, **엔진과 데이터 소스는 우리 것으로 다시 짓는다**.
캔버스 5번째 모드 `백테스트`가 그 진입로다 — 대화 · 그래프 · 에이전트 · 플러그인과 같은 자리.

---

## 1. 원본(KIS 백테스터)에서 무엇을 가져오고 무엇을 버리는가

### 1.1 원본 구성 (실측 — README 기준)

| 층 | 원본 | 비고 |
|---|---|---|
| 전략 SSoT | `StrategySchema` (Pydantic) + `.kis.yaml` | 프리셋 · YAML · API 요청 3경로가 한 모델로 수렴 |
| 지표 | 80종 (MA 14 · 오실레이터 19 · 추세 12 · 거래량 9 · 변동성 10 · 가격 4 등) | 조건식 연산자 7종 (`cross_above`/`cross_below`/`greater_than`/…) |
| 엔진 | **QuantConnect Lean (Docker)** | 파이썬 코드 생성 → 컨테이너 실행 |
| 백엔드 | FastAPI :8002 | `/api/strategies`, `/api/backtest/run`, `/api/files/validate`, `/api/symbols/search` |
| 프론트 | Next.js :3001 | 파라미터 슬라이더 · YAML 드래그앤드롭 · 자산곡선 |
| MCP | :3846, 툴 8종 | `run_backtest`(비동기 job_id) · `get_backtest_result` · `retry_backtest` … |
| 지표(성과) | 총수익률 · CAGR · Sharpe · MDD · 승률 · Profit Factor | README가 스스로 3가지 계산 결함을 고백함(§1.3) |
| 최적화 | Grid / Random Search | min·max·step 지정 |
| 프리셋 | 10종 | SMA 교차 · 모멘텀 · 52주 신고가 · 연속패턴 · 이격도 · 실패한 돌파 · 종가베팅 · 변동성 수축확장 · 단기 과매도 · 추세필터+시그널 |

### 1.2 가져오는 것 (채택)

1. **`.kis.yaml` 전략 스키마 구조** — `metadata / strategy{params, indicators, entry, exit} / risk` 3단.
   브로커 중립적이다. 우리 `.athena.yaml v1`이 이 모양을 그대로 쓰고, `data:` 블록만 키움 축으로 덧댄다.
2. **연산자 7종과 조건 논리(AND/OR)** — 그대로.
3. **프리셋 10종의 전략 정의** — 지표 조합 자체는 공개 상식이다. 이름·파라미터 범위는 우리 말로 다시 쓴다.
4. **비동기 job + `job_id` → 결과 조회** MCP 계약 — 백테스트는 초 단위가 아니다.
5. **성과 지표 6종** — 단, §1.3의 결함은 고쳐서 구현한다.

### 1.3 버리는 것 (비채택) — 각각 근거를 단다

| 버리는 것 | 근거 |
|---|---|
| **QuantConnect Lean + Docker** | Athena는 일반 사용자에게 배포하는 Electron 데스크톱 앱이다. Docker 데몬을 전제할 수 없다. 백엔드는 이미 `uv`로 뜨는 단일 파이썬 프로세스다(`backend/pyproject.toml`). |
| **numpy / pandas** | `pyproject.toml`이 `networkx`를 고른 이유를 주석으로 남겨뒀다 — *"순수 파이썬이라 ladybug를 걷어낸 이유였던 네이티브 휠·DLL 경로 세금이 없다"*. 백테스트 엔진 하나 때문에 그 결정을 뒤집지 않는다. §5.2에서 규모를 계산해 순수 파이썬으로 충분함을 보인다. |
| **Next.js 별도 프론트(:3001)** | 화면은 캔버스 안이다. 별도 웹앱은 모드 계약(중앙 캔버스 배타)을 깬다. |
| **별도 MCP 서버(:3846)** | 이미 `athena_mcp`가 있다. 툴 하나(`athena_backtest`)를 더한다. |
| **지표 80종 1차 전량 이식** | 프리셋 10종이 실제로 쓰는 지표는 15종 미만이다. 안 쓰는 65종은 검증할 수 없는 코드다. 2차 이후 수요 기반으로 늘린다. |
| **Sharpe/CAGR 원본 계산식** | README가 스스로 고백한 결함 — 워밍업 구간의 0수익일이 표준편차를 낮춰 Sharpe를 부풀리고, CAGR이 실거래일이 아닌 달력일로 나눈다. 우리는 워밍업을 제외하고 거래일 기준으로 계산한다. |

---

## 2. 모드 자리 — 5중 배타로 확장

### 2.1 지금의 계약 (실측)

중앙 캔버스는 4중 배타다. 가시성의 **유일한 소유자**는 `app/lib/graph-mode/controller.js`의 `applyVisibility()` 하나다.

```
shell.html          #mosaic · #graphSummaryTable · #graphCanvas · #agentCanvas · #pluginCanvas
graph-mode-store.js VIEW_SUMMARY | VIEW_GRAPH | VIEW_AGENT | VIEW_PLUGIN
controller.js       applyVisibility() — 위 표면 hidden + #dot(키우미) data-mode
                                      + #canvasRegion data-mode + #chatModeHead hidden
sidebar-mode-nav.js 클릭 배선과 active 표시만 (키 목록에 대해 제네릭)
sidebar.js          items{summary,graph,agent,plugin} + onSelect → AthenaCanvasMode.setView()
```

`sidebar-mode-nav.js`는 `items`의 키를 순회할 뿐이라 **수정이 필요 없다**. 실제로 손댈 곳은 4개 파일이다.

### 2.2 추가 항목

| 축 | 값 |
|---|---|
| 모드 라벨 | **백테스트** |
| view 키 | `backtest` |
| 캔버스 엘리먼트 | `#backtestCanvas` |
| 네비 버튼 | `#modeNavBacktest` (`data-view="backtest"`) |
| 전역 | `window.AthenaBacktestCanvas` |
| 캔버스 모듈 | `app/lib/backtest-canvas.js` |

### 2.3 `applyVisibility()` 확장 — 판단 하나를 명시한다

지금 코드는 이렇게 생겼다.

```js
if (elements.summary) elements.summary.hidden = graphView || agentView || pluginView;
if (elements.kiumi) elements.kiumi.dataset.mode = graphView ? 'graph' : (agentView ? 'agent' : (pluginView ? 'plugin' : 'chat'));
```

5번째를 그냥 더하면 OR 4항 · 삼항 4중첩이 된다. **이 함수 안에서만** 정규화한다.

```js
const view = state.view;
const surfaces = {
  [store.VIEW_SUMMARY]: elements.summary,
  [store.VIEW_AGENT]: elements.agent,
  [store.VIEW_PLUGIN]: elements.plugin,
  [store.VIEW_BACKTEST]: elements.backtest,
};
// graph만 surface 축(요약/지도)이 하나 더 있어 예외로 남는다 — 나머지는 1:1이다.
```

- 범위: `applyVisibility()` 본문 한 함수. 다른 함수·다른 파일은 건드리지 않는다.
- 근거: 이 함수가 바로 5번째를 받는 지점이고, 지금 손대지 않으면 6번째에서 같은 비용을 두 배로 낸다.
- 계약 유지: hidden 단일 소유권(US-007)은 그대로다. 소유자가 늘지 않는다.
- 고정: `controller.test.js`에 **5중 배타 표** 테스트를 추가한다 — 5개 view마다 5개 표면의 hidden 기대값 25칸.

> 이 판단이 과하다고 보면 OR/삼항을 그냥 한 항 늘리는 최소 변경도 가능하다. 결정 D4(§9).

### 2.4 부수 표면

| 표면 | 지금 | 백테스트에서 |
|---|---|---|
| `#chatModeHead` (모드별 채팅 헤더) | 그래프 전용 | **필요** — "전략에게 묻기 / 답이 백테스트를 돌립니다". Paper 보드 38 개정 선행 |
| 키우미 얼굴 `#dot[data-mode]` | chat · graph만 CSS 존재, agent/plugin은 기본 폴백 | 백테스트 얼굴 신규. Paper 보드 45 개정 선행 |
| 빈 캔버스 `#canvasRegion[data-mode]` | 보드 46 | 백테스트 빈 상태 신규 |
| 사이드바 목록 | 에이전트만 라우틴 섹션 | 백테스트 모드에서 **최근 실행 이력** 섹션 (`agent-sidebar-list.js`와 같은 자리) |
| 모드 배지 | 에이전트만(미확인 알람) | 실행 중 잡이 있으면 카운트 — `setBadgeCount`가 이미 제네릭. `badge` 주입만 추가 |

---

## 3. Paper 선행 (디자인 우선 규칙)

**디자인에 있으면 무조건 구현, 없는데 필요하면 Paper에 먼저 그린 후 구현.** 백테스트 화면은 Paper에 아직 없다 —
현재 화면 보드는 01~57이고 모드 구역은 37~48이다. 그러므로 **UI 코드 한 줄보다 Paper가 먼저다.**

### 3.1 신규 아트보드

| 번호(안) | 이름 | 내용 |
|---|---|---|
| 58 | 백테스트 — 설계 | 종목·기간·주기 지정, 지표 목록, 진입/청산 조건 빌더, 파라미터 슬라이더, 리스크(손절·익절) |
| 59 | 백테스트 — 결과 | 자산곡선 + 벤치마크, 지표 타일 6종, 체결 마커, 체결 표 |
| 60 | 백테스트 — 이력·비교 | 실행 목록, 2개 이상 겹쳐보기, 파라미터 diff |
| 61 | 백테스트 — 데이터 수집 | 캔들 커버리지 막대, 백필 진행/잔여 호출 수, 사람 승인 |
| 62 | 백테스트 — 최적화 | 그리드/랜덤 설정, 결과 히트맵/표, 과최적화 경고 |

### 3.2 개정 아트보드

| 번호 | 개정 내용 |
|---|---|
| 44 · 모드 전환 UX | 4모드 → **5모드** 배타 |
| 45 · 입력 스트립 키우미 | 백테스트 얼굴 추가 |
| 46 · 빈 캔버스 | 백테스트 빈 상태 추가 |
| 38 · 모드별 채팅 헤더 | 백테스트 헤더 문구 추가 |

배치: 기존 모드 구역(y=12500 / 13560 두 행) 아래 새 행. 좌표는 작업 시 `get_basic_info`로 실측해 결정한다.

### 3.3 산출물

`PAPER_APP_PARITY.md`에 5행 추가(`58~62`) + 4행 개정. 화면 페이지 카운트 `60/60 → 65/65`.

---

## 4. 전략 표현 — `.athena.yaml v1`

### 4.1 스키마 (KIS 구조 + 키움 데이터 축)

```yaml
version: "1.0"
metadata:
  name: 20-60 골든크로스
  description: 단기 이평이 장기 이평을 상향 돌파할 때 진입
  tags: [trend, ma]

data:                          # ← 키움 축. KIS 원본에 없는 블록.
  symbols: ["005930"]          # stk_cd. KRX 기본, NXT/SOR 접미는 1차 미지원
  period: day                  # day|week|month  (min/tick은 1차 비대상 — §5.4)
  adjusted: true               # upd_stkpc_tp = 1
  from: "20200101"
  to: "20260831"

strategy:
  id: sma_crossover
  category: trend
  params:
    fast: {default: 20, min: 5,  max: 60,  step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast",  source: close}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow",  source: close}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}

risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}          # 1차: 전액 1종목. 분할은 2차.

costs:                          # ← 키움 축. 기본값이지 사실 주장이 아니다(§8.3).
  fee_bps: 1.5                  # 매수·매도 각각
  tax_bps: 18.0                 # 매도 시 (거래세, 사용자가 바꾼다)
  slippage_bps: 5.0
```

### 4.2 KIS 호환

`.kis.yaml` 파일을 그대로 떨어뜨리면 `data:`/`costs:` 없이도 로드된다 — 없으면 캔버스가 물어본다.
`schema.py`에 `from_kis_yaml()` 하나로 흡수한다. 별도 포맷을 만들지 않는다.

### 4.3 1차 지표 목록 (15종)

프리셋 10종이 실제로 요구하는 것만.

| 분류 | 지표 |
|---|---|
| 이동평균 | SMA, EMA, WMA |
| 오실레이터 | RSI, MACD, Stochastic, ROC(모멘텀), CCI |
| 추세 | ADX, Donchian(N일 신고가/신저가) |
| 변동성 | ATR, Bollinger, STD |
| 거래량 | OBV, VWMA |

가격 원천 `close/open/high/low/hl2/ohlc4`는 지표가 아니라 `source` 인자다.

---

## 5. 데이터 층 — 여기가 진짜 어려운 부분

### 5.1 소스

`backend/ref/aits-chart-contracts.json`이 이미 별칭 표를 갖고 있다. **복제하지 않고 읽는다.**

| 주기 | TR | 컨테이너 | 시간 |
|---|---|---|---|
| 일 | `ka10081` | `stk_dt_pole_chart_qry` | `dt` (YYYYMMDD) |
| 주 | `ka10082` | `stk_stk_pole_chart_qry` | `dt` |
| 월 | `ka10083` | `stk_mth_pole_chart_qry` | `dt` |
| 분 | `ka10080` | `stk_min_pole_chart_qry` | `cntr_tm` |

OHLCV 별칭: `open_pric / high_pric / low_pric / cur_prc / trde_qty`.

**`chart-page` 라우트는 쓰지 않는다.** `canvas_transform.py:568`이 `max_rows ≤ 240`으로 자른다 — 그건 *화면*
제약이지 데이터 제약이 아니다. 백테스트는 `generated.runtime.call_raw_tr`(원시 TR)을 직접 부르고, 별칭만
위 계약 파일에서 읽는다.

### 5.2 규모 계산 — 순수 파이썬으로 충분한가

- 일봉 10년 ≈ **2,450봉/종목**.
- 지표 15종 전부 계산 = 2,450 × 15 ≈ 37K 연산. CPython으로 수 ms.
- 백테스트 루프 1회 = 2,450 반복 → **1ms 미만**.
- 그리드 서치 20×20 = 400조합 × 2,450봉 ≈ **98만 반복 → 1~3초**.
- 유니버스 200종목 단일 조합 = 49만 봉 → **1초 내외**.

병목은 계산이 아니라 **네트워크**다(§5.3). numpy를 넣어도 체감이 바뀌지 않는다.

### 5.3 레이트 리밋 — 지배적 제약

`kiwoom/rate_limiter.py` 실측: **전역 5 req/s, TR id 당 1 req/s**.
일봉은 전부 `ka10081` 하나이므로 **초당 1페이지가 상한**이다. 종목을 병렬로 늘려도 소용없다.

| 시나리오 | 페이지 | 소요 |
|---|---:|---:|
| 1종목 10년 일봉 (페이지 600행 가정) | ~5 | ~5초 |
| 20종목 10년 | ~100 | ~1분 40초 |
| 200종목 10년 | ~1,000 | ~17분 |

→ **로컬 캔들 캐시는 선택이 아니라 전제다.** 그리고 백필은 반드시
① 백그라운드 잡, ② 진행률 표시, ③ 예상 호출 수를 사람에게 먼저 보여주고 승인받는 경로여야 한다(보드 61).

### 5.4 저장소

`brain/db.py`의 `SqliteOwner`(단일 소유자 스레드 + WAL + SAVEPOINT)를 **패턴으로 재사용**하되,
파일은 분리한다 — 브레인 그래프와 캔들은 수명·크기·재생성 비용이 전혀 다르고, 브레인의
`reset-and-restart`가 캔들 캐시까지 날리면 안 된다.

```
bt_candle(stk_cd, period, adjusted, dt, open, high, low, close, volume)  PK(stk_cd,period,adjusted,dt)
bt_coverage(stk_cd, period, adjusted, first_dt, last_dt, fetched_at, pages)
bt_strategy(id, name, yaml, created_at)
bt_run(id, strategy_id, spec_hash, status, started_at, finished_at, error, metrics_json)
bt_trade(run_id, seq, side, dt, price, qty, fee, tax, pnl, reason)
bt_equity(run_id, dt, equity, cash, position_value, drawdown)
```

### 5.5 수정주가 함정 (TR 문서 실측)

`ka10081`의 `upd_stkpc_tp` 설명이 명시한 것:

> 권리발생일 이전 일자를 `base_dt`에 넣고 수정주가구분 1로 조회하면 그 이전 데이터는 수정주가가 적용된다.
> 권리 발생일 **이후** 일자로 조회하면 수정주가가 적용되지 않아 가격대가 어긋난다.

즉 **증분 페치로 이어붙이면 권리락 경계에서 가격이 튄다.** 규칙 세 줄로 고정한다.

1. 캐시 키에 `adjusted`를 포함한다 — 수정/무수정은 서로 다른 시계열이다.
2. 증분 페치 시 **겹치는 최근 N봉(기본 20)의 종가를 대조**한다. 하나라도 다르면 권리 이벤트로 보고 **전체 재수집**한다.
3. 재수집은 조용히 하지 않는다 — 실행 결과에 "권리락 감지 · 전체 재수집됨"을 남긴다.

### 5.6 정직하게 못 하는 것 (1차 비대상)

- **생존 편향**: 상장폐지 종목의 과거 봉을 키움 차트 TR로 받을 수 없다. 유니버스 백테스트 결과는 구조적으로 낙관 편향이다 → 결과 화면에 상시 표기.
- **종목코드 변경/액면분할 이력**: 별도 TR 확인 필요. 1차는 §5.5의 대조 규칙으로만 방어한다.
- **분/틱 백테스트**: `ka10080`은 조회 가능 기간이 짧고 페이지가 많다. 1차 비대상.
- **NXT/SOR 시장 구분**: `stk_cd` 접미(`_NX`/`_AL`) 미지원, KRX만.
- **공매도·신용·배당 재투자**: 미반영. 결과 화면에 명시.

---

## 6. 백엔드 설계

### 6.1 신규 패키지

```
backend/athena_api/backtest/
  __init__.py
  schema.py      StrategySpec (Pydantic) · from_kis_yaml() · 파라미터 치환($fast)
  indicators.py  15종 · 순수 파이썬 · 전부 list[float|None] 반환 (워밍업은 None)
  rules.py       조건 평가 (연산자 7종 + AND/OR)
  engine.py      바 단위 루프 · 체결 모델 · 리스크(손절/익절)
  metrics.py     6지표 + §1.3 결함 수정
  costs.py       수수료·세금·슬리피지
  data.py        캔들 저장소 + 키움 백필 (call_raw_tr + cont-yn)
  store.py       SqliteOwner 기반 (athena-backtest.sqlite3)
  runner.py      잡 큐 · 상태 · 취소
  presets.py     프리셋 10종 (yaml 문자열)
  optimize.py    그리드/랜덤 (2차)
```

### 6.2 체결 모델 — 발명하지 않고 명시한다

- 신호 판정: **종가 확정 후**. 미래 정보 없음.
- 체결: **다음 봉 시가**. 같은 봉 종가 체결은 look-ahead다.
- 손절/익절: 봉 내부 `low`/`high` 터치 시 **해당 가격 체결**로 가정. 같은 봉에서 둘 다 닿으면 **손절 우선**(보수적).
- 상·하한가 봉(시가=고가=저가=종가)은 체결 불가로 처리하고 다음 봉으로 이월. 거래량 0 봉도 동일.
- 이 5줄 전부 결과 화면의 "가정" 섹션에 그대로 노출한다.

### 6.3 라우트

```
GET  /api/v1/backtest/indicators                지표 목록 + 파라미터 스펙
GET  /api/v1/backtest/presets                   프리셋 10종
POST /api/v1/backtest/validate                  yaml/json → 에러 목록 (실행 안 함)
GET  /api/v1/backtest/data/coverage             ?stk_cd&period&adjusted → 보유 구간
POST /api/v1/backtest/data/plan                 spec → 필요한 추가 호출 수 + 예상 소요 (승인 전 화면용)
POST /api/v1/backtest/data/backfill             승인 후 실제 수집 (잡)
POST /api/v1/backtest/runs                      202 {run_id}
GET  /api/v1/backtest/runs                      목록
GET  /api/v1/backtest/runs/{id}                 상태 + 지표 + 자산곡선
GET  /api/v1/backtest/runs/{id}/trades          체결 표
DELETE /api/v1/backtest/runs/{id}               취소/삭제
POST /api/v1/backtest/optimize                  2차
```

`api/__init__.py`에 라우터 1줄 추가.

### 6.4 MCP — `athena_backtest`

`routine_tools.py`와 같은 HTTP 루프백 프록시. 액션:

| 액션 | 상태 변경 | 비고 |
|---|---|---|
| `list_presets` / `list_indicators` | 없음 | |
| `validate` | 없음 | |
| `plan` | 없음 | 필요한 호출 수만 계산 |
| `run` | 잡 생성 | **캐시로 충분할 때만 즉시 실행** |
| `status` / `result` | 없음 | |
| `backfill` | **거부** | 쿼터를 태우는 행위 — 사람 클릭 전용 |

`run`이 캐시 부족을 만나면 실행하지 않고 `blocked` + `{needed_pages, est_seconds}`를 돌려준다.
캔버스가 그 숫자로 승인 카드를 띄운다. `routine_tools.py`가 `confirm`/`cancel`을 아예 갖지 않는 것과 같은 규율이다.

---

## 7. 프런트 설계

### 7.1 파일

```
app/lib/backtest-canvas.js        3표면(설계·결과·이력) 렌더 + setView()
app/lib/backtest-canvas.test.js
app/lib/backtest-equity-chart.js  lightweight-charts 자산곡선 (chart-card.js를 포크하지 않는다)
app/lib/backtest-spec-form.js     조건 빌더 · 파라미터 슬라이더 (순수 상태 → DOM은 canvas가 조립)
app/lib/main/backtest-bridge.js   IPC 핸들러 (rest-dataset-runner.js 패턴)
app/probe-backtest-mode.js        5중 배타 + 결과 렌더 프로브
```

`canvas.js`에는 `pluginCanvas` 배선과 같은 모양으로 ~10줄만 늘어난다.

### 7.2 IPC 채널 (`preload.js` allowlist + `main.js` 핸들러)

```
athena:backtest-presets      athena:backtest-indicators
athena:backtest-validate     athena:backtest-plan
athena:backtest-run          athena:backtest-status
athena:backtest-result       athena:backtest-runs
athena:backtest-trades       athena:backtest-coverage
athena:backtest-backfill     ← 사람 클릭 경로 전용
```

### 7.3 결과 화면 구성 (보드 59)

1. **지표 타일 6종** — 총수익률 · CAGR · Sharpe · MDD · 승률 · Profit Factor. `card-primitives.js` 재사용.
2. **자산곡선** — 전략 vs Buy&Hold 2선. 벤치마크는 같은 종목 매수보유(지수 TR은 2차).
3. **체결 마커** — 가격 차트 위 진입/청산.
4. **체결 표** — 날짜·방향·가격·수량·수수료·손익·사유.
5. **가정 섹션** — §6.2 체결 규칙 5줄 + §5.6 비대상 목록. **접히지 않는다.**

---

## 8. 단계 계획

각 단계 끝에서 **변경 확인 → 커밋 → 푸시**.

| 단계 | 내용 | 완료 검증 |
|---|---|---|
| **P0** | Paper 보드 58~62 신규 + 44/45/46/38 개정 · `PAPER_APP_PARITY.md` 갱신 | Paper 스크린샷 + 파리티 표 65/65 |
| **P1** | 모드 골격 — `VIEW_BACKTEST`, `#backtestCanvas`, 네비 항목, 빈 캔버스, 키우미 얼굴. 백엔드 없음 | `npm test`(controller 5×5 배타표, sidebar-mode-nav) + `probe-backtest-mode.js` 1단계 |
| **P2** | 데이터 층 — `store.py`·`data.py`·백필·coverage·plan API | `pytest -m deterministic` + **실서버 1종목 10년 수집 실측**(소요·페이지 수 기록) |
| **P3** | 엔진 — `schema/indicators/rules/engine/metrics/costs` + 프리셋 10종 | 손계산 골든 픽스처(합성 봉 30개로 SMA교차 1왕복 정확 일치) + 프리셋 10종 전부 무오류 실행 |
| **P4** | API + IPC + 결과 캔버스 | `probe-backtest-mode.js` 2단계(실행→결과 렌더) |
| **P5** | MCP `athena_backtest` + 채팅 진입 + `#chatModeHead` | MCP 툴 계약 테스트 + `backfill` 거부 테스트 |
| **P6** | 최적화(그리드/랜덤) + 이력 비교 + 과최적화 경고 | 그리드 400조합 3초 이내 실측 |

P0~P4가 "쓸 수 있는 백테스트 모드"의 최소선이다. P5·P6은 그 위의 증분이다.

### 8.1 검증 규율

- `npm test` — `app/lib/*.test.js`
- `uv run pytest -m deterministic` (0건 수집되면 `rtk proxy uv run pytest`)
- `app/probe-backtest-mode.js` — Electron 실앱 프로브
- pre-push가 app 전체 스위트를 돌린다 — WIP 빨간 테스트를 남기면 push 자체가 막힌다

### 8.2 새로 만들지 않는 것

- 새 게이트(`scripts/gates/`) — 백테스트는 유리·창 모델 계약을 건드리지 않는다.
- 새 창 — 캔버스 안이다.
- 새 SQLite 소유자 클래스 — `SqliteOwner`를 쓴다.

### 8.3 값이 아니라 설정인 것

수수료·거래세율은 **코드에 상수로 박지 않는다**. `costs:` 블록 기본값이고 화면에서 바꾼다.
세율은 시점에 따라 바뀌고, 우리가 그 시점의 정답을 안다고 주장할 근거가 없다.

---

## 9. 결정이 필요한 것

| # | 질문 | 권고 | 영향 |
|---|---|---|---|
| **D1** | 엔진: 순수 파이썬 자체 구현 / numpy·pandas 도입 / Lean 이식 | **순수 파이썬** (§1.3, §5.2) | 의존성·배포·P3 크기 |
| **D2** | 1차 범위: 단일 종목 / 소형 유니버스(≤20) / 대형 유니버스(200+) | **단일 종목 + ≤20 유니버스** (레이트 리밋, §5.3) | P2 백필 설계·P4 화면 |
| **D3** | 진입로: 캔버스 폼 우선 / 채팅 우선 / 동등 | **폼 우선, 채팅은 P5 보조** | Paper 보드 58 밀도 |
| **D4** | `applyVisibility()` 정규화(§2.3) 할 것인가 | **한다** (함수 하나로 범위 한정) | 진단 난이도 |
| **D5** | 모드 라벨 "백테스트" / "전략" | **백테스트** | Paper·문구 |

---

## 10. 열린 위험

1. **키움 차트 TR의 실제 페이지 크기·연속조회 상한을 아직 실측하지 않았다.** §5.3의 "페이지 600행"은 가정이다. **P2 첫 작업이 이 실측**이고, 결과에 따라 D2가 바뀔 수 있다.
2. **`ka10081` 조회 가능 최대 과거 시점** 미확인. 10년이 안 나올 수 있다.
3. **모의투자 서버와 실서버의 차트 데이터 차이** 미확인.
4. `graph-mode/controller.js`가 5개 모드의 가시성을 소유하는데 이름은 여전히 `graph-mode`다. 이번 범위에서 **개명하지 않는다**(변경 폭이 계획 전체보다 커진다) — 별건으로 남긴다.
