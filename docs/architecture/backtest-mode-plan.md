# Athena 백테스트 모드 도입 계획서

- 상태: P0~P6 구현 완료(P1.5·P2는 실서버 실측만 남음) · 전수 파리티 완료(2026-09-01)
- 파리티 감사와 구현 결과: `docs/architecture/backtest-parity-audit.md`
- 작성 기준: 2026-08-31 KST
- 브랜치: `claude/backtester-new-mode-integration-536ff0`
- 원본 참조: `koreainvestment/open-trading-api` → `backtester/` (KIS 백테스터)
- 대상: 셸 모드 계약, `athena_api` 백엔드, `athena_mcp`, Paper 디자인

## 0. 한 줄 요약

KIS 백테스터의 **전략 스키마·지표 카탈로그·화면 문법**을 기능 파리티로 가져오고,
**엔진과 데이터 소스는 키움 축으로 다시 짓는다**.
캔버스 5번째 모드 `백테스트`가 진입로이고, 전략은 **폼(YAML)과 파이썬 코드 두 경로**로 저작한다.

---

## 1. 확정된 결정

| # | 결정 | 값 | 결과 |
|---|---|---|---|
| **D1** | 엔진 스택 | **numpy + pandas 도입** | 벡터화 엔진. `pyproject.toml`에 네이티브 휠이 처음 들어온다 → §11-1 배포 위험 |
| **D2** | 1차 범위 | **KIS 파리티 전부** | 지표 80종 · 프리셋 10종 · 그리드/랜덤 최적화 · YAML 검증 · 종목 검색 |
| **D3** | 저작 진입로 | **폼 우선 + 파이썬 코드 저작 인프라** | 채팅(LLM)이 전략 파이썬을 쓰고 고칠 수 있다. 코드 편집기·버전·샌드박스 실행이 1급 기둥 |
| **D4** | `applyVisibility()` | **정규화한다** | 함수 하나로 범위 한정, `controller.test.js`에 5×5 배타표 고정 |

### D2 해석 — 애매한 부분을 여기서 못박는다

"KIS에서 지원하는 정도까지 전부"를 **기능 파리티**로 읽는다.

- 포함: 지표 80종, 프리셋 10종, 연산자 7종, YAML 검증/템플릿, 그리드·랜덤 서치, 종목 검색, 비동기 잡.
- 종목 수는 KIS도 실행당 대상을 지정하는 구조다. 우리도 **실행당 대상 지정**을 기본으로 하되 다종목을 막지 않는다.
  대신 대량 백필은 §5.3 승인 게이트를 반드시 통과한다 — 레이트 리밋은 KIS에 없던 우리 쪽 제약이다.
- 제외(원본에도 없거나 우리 환경에 안 맞음): Lean/Docker, 별도 Next.js 프론트, 별도 MCP 서버 포트.

### D1 대가를 명시한다

`backend/pyproject.toml`은 `networkx`를 고른 이유를 주석으로 남겨뒀다 —
*"순수 파이썬이라 ladybug를 걷어낸 이유였던 네이티브 휠·DLL 경로 세금이 없다"*.
numpy/pandas는 그 세금을 다시 낸다. 대신 얻는 것:

1. 지표 80종을 손으로 다 짜지 않아도 된다(§6.3 어댑터).
2. 사용자·LLM이 쓰는 전략 코드가 pandas를 기대한다 — 이게 D3의 실질적 전제다.
3. 그리드 서치가 벡터화된다.

→ **§11-1에 배포 검증 항목을 추가**하고 P2 착수 전에 Electron 패키징에서 numpy/pandas import를 실측한다.

---

## 2. 원본(KIS 백테스터) 대조표

| 층 | 원본 | 우리 |
|---|---|---|
| 전략 SSoT | `StrategySchema` + `.kis.yaml` | `.athena.yaml v1` (KIS 구조 + `data:`/`costs:`) + **파이썬 코드** 2경로 |
| 지표 | 80종 | 80종 파리티(§6.3 단계 이식) |
| 연산자 | 7종 + AND/OR | 동일 |
| 엔진 | QuantConnect Lean (Docker) | **자체 벡터화 엔진** (pandas) — Docker 데몬을 사용자 PC에 전제할 수 없다 |
| 백엔드 | FastAPI :8002 | 기존 `athena_api`에 라우터 추가 |
| 프론트 | Next.js :3001 | 캔버스 5번째 모드 |
| MCP | :3846, 툴 8종 | 기존 `athena_mcp`에 `athena_backtest` 1툴(액션 다수) |
| 성과지표 | 6종 | 6종 + 원본이 고백한 계산 결함 3건 수정(§6.5) |
| 최적화 | Grid / Random | 동일 + 과최적화 경고 |
| 프리셋 | 10종 | 10종 |
| 코드 저작 | **없음** | **있음 — D3** |

---

## 3. 모드 자리 — 5중 배타

### 3.1 지금의 계약 (실측)

가시성의 **유일한 소유자**는 `app/lib/graph-mode/controller.js`의 `applyVisibility()` 하나다.

```
shell.html          #mosaic · #graphSummaryTable · #graphCanvas · #agentCanvas · #pluginCanvas
graph-mode-store.js VIEW_SUMMARY | VIEW_GRAPH | VIEW_AGENT | VIEW_PLUGIN
controller.js       applyVisibility() — 표면 hidden + #dot(키우미) data-mode
                                      + #canvasRegion data-mode + #chatModeHead hidden
sidebar-mode-nav.js 클릭 배선과 active 표시만 (items 키에 대해 제네릭)
sidebar.js          items{summary,graph,agent,plugin} + onSelect → AthenaCanvasMode.setView()
```

`sidebar-mode-nav.js`는 키를 순회할 뿐이라 **수정이 필요 없다**.

### 3.2 추가 항목

| 축 | 값 |
|---|---|
| 모드 라벨 | **백테스트** |
| view 키 | `backtest` |
| 캔버스 엘리먼트 | `#backtestCanvas` |
| 네비 버튼 | `#modeNavBacktest` (`data-view="backtest"`) |
| 전역 | `window.AthenaBacktestCanvas` |

손대는 파일: `shell.html` · `graph-mode-store.js` · `graph-mode/controller.js` · `sidebar.js` · `shell.css`.

### 3.3 `applyVisibility()` 정규화 (D4 확정)

지금은 이렇다.

```js
if (elements.summary) elements.summary.hidden = graphView || agentView || pluginView;
if (elements.kiumi) elements.kiumi.dataset.mode = graphView ? 'graph' : (agentView ? 'agent' : (pluginView ? 'plugin' : 'chat'));
```

5번째를 그냥 더하면 OR 4항 · 삼항 4중첩이 된다. **이 함수 안에서만** view→표면 맵으로 바꾼다.

- 범위: `applyVisibility()` 본문. 다른 함수·다른 파일 무변경.
- 계약 유지: hidden 단일 소유권(US-007) 그대로. 소유자가 늘지 않는다.
- graph만 surface 축(요약/지도)이 하나 더 있어 예외로 남는다.
- 고정: `controller.test.js`에 **5 view × 5 표면 = 25칸 배타표** 테스트.

### 3.4 부수 표면

| 표면 | 지금 | 백테스트에서 |
|---|---|---|
| `#chatModeHead` | 그래프 전용 | **필요** — "전략에게 묻기 / 답이 코드와 백테스트를 바꿉니다" (Paper 보드 38 개정 선행) |
| 키우미 얼굴 `#dot[data-mode]` | chat·graph만 CSS 존재 | 백테스트 얼굴 신규 (보드 45 개정) |
| 빈 캔버스 `#canvasRegion[data-mode]` | 보드 46 | 백테스트 빈 상태 신규 |
| 사이드바 목록 | 에이전트만 라우틴 섹션 | **전략 목록 + 최근 실행** 섹션 (`agent-sidebar-list.js`와 같은 자리) |
| 모드 배지 | 에이전트만 | 실행 중 잡 수. `setBadgeCount`가 이미 제네릭 — `badge` 주입만 추가 |

---

## 4. Paper 선행 (디자인 우선 규칙)

**디자인에 있으면 무조건 구현, 없는데 필요하면 Paper에 먼저 그린 후 구현.**
현재 화면 보드는 01~57, 모드 구역은 37~48. 백테스트 화면은 없다 → **UI 코드보다 Paper가 먼저다.**

### 4.1 신규 아트보드

| 번호(안) | 이름 | 내용 |
|---|---|---|
| 58 | 백테스트 — 설계(폼) | 종목·기간·주기, 지표 목록, 진입/청산 조건 빌더, 파라미터 슬라이더, 리스크·비용 |
| 59 | 백테스트 — 설계(코드) | **파이썬 편집기**, 실행/검증 버튼, 코드 출력(print) 패널, 파라미터 패널 |
| 60 | 백테스트 — 코드 초안 검토 | LLM이 제안한 코드의 **diff + 적용/버림** (라우틴 승인 카드와 같은 문법) |
| 61 | 백테스트 — 결과 | 자산곡선+벤치마크, 지표 타일 6종, 체결 마커, 체결 표, **가정 섹션** |
| 62 | 백테스트 — 이력·비교 | 실행 목록, 겹쳐보기, 파라미터·코드 버전 diff |
| 63 | 백테스트 — 데이터 수집 | 캔들 커버리지 막대, 필요한 호출 수·예상 소요, 사람 승인 |
| 64 | 백테스트 — 최적화 | 그리드/랜덤 설정, 히트맵/표, 과최적화 경고 |

### 4.2 개정 아트보드

| 번호 | 개정 |
|---|---|
| 44 · 모드 전환 UX | 4모드 → **5모드** 배타 |
| 45 · 키우미 | 백테스트 얼굴 |
| 46 · 빈 캔버스 | 백테스트 빈 상태 |
| 38 · 모드별 채팅 헤더 | 백테스트 헤더 문구 |

배치: 기존 모드 구역(y=12500 / 13560 두 행) 아래 새 행. 좌표는 `get_basic_info`로 실측 후 확정.

### 4.3 산출물

`PAPER_APP_PARITY.md` 7행 추가(58~64) + 4행 개정. 화면 페이지 `60/60 → 67/67`.

---

## 5. 데이터 층

### 5.1 소스

`backend/ref/aits-chart-contracts.json`이 이미 별칭 표를 갖고 있다. **복제하지 않고 읽는다.**

| 주기 | TR | 컨테이너 | 시간 |
|---|---|---|---|
| 일 | `ka10081` | `stk_dt_pole_chart_qry` | `dt` (YYYYMMDD) |
| 주 | `ka10082` | `stk_stk_pole_chart_qry` | `dt` |
| 월 | `ka10083` | `stk_mth_pole_chart_qry` | `dt` |
| 분 | `ka10080` | `stk_min_pole_chart_qry` | `cntr_tm` |

OHLCV 별칭: `open_pric / high_pric / low_pric / cur_prc / trde_qty`.

**`/api/v1/canvas/chart-page`는 쓰지 않는다.** `canvas_transform.py:568`이 `max_rows ≤ 240`으로 자른다 —
그건 *화면* 제약이지 데이터 제약이 아니다. 백테스트는 `generated.runtime.call_raw_tr`(원시 TR)을 직접
부르고 별칭만 위 계약 파일에서 읽는다. 연속조회는 `client.py`가 이미 `cont-yn` / `next-key` 헤더를 왕복한다.

### 5.2 레이트 리밋 — 지배적 제약

`kiwoom/rate_limiter.py` 실측: **전역 5 req/s, TR id 당 1 req/s**.
일봉은 전부 `ka10081` 하나이므로 **초당 1페이지가 상한**이다. 종목 병렬화로 못 깬다.

| 시나리오 | 페이지(600행 가정) | 소요 |
|---|---:|---:|
| 1종목 10년 일봉 | ~5 | ~5초 |
| 20종목 10년 | ~100 | ~1분 40초 |
| 200종목 10년 | ~1,000 | ~17분 |

→ **로컬 캔들 캐시는 전제다.** 백필은 ① 백그라운드 잡, ② 진행률, ③ **예상 호출 수를 먼저 보여주고 승인** (보드 63).

### 5.3 저장소

`brain/db.py`의 `SqliteOwner`(단일 소유자 스레드 + WAL + SAVEPOINT)를 **패턴으로 재사용**하되 파일은 분리한다 —
브레인 `reset-and-restart`가 캔들 캐시까지 날리면 안 된다.

```
bt_candle(stk_cd, period, adjusted, dt, open, high, low, close, volume)   PK(stk_cd,period,adjusted,dt)
bt_coverage(stk_cd, period, adjusted, first_dt, last_dt, fetched_at, pages)
bt_strategy(id, name, kind, created_at)                    kind = yaml | python
bt_strategy_version(id, strategy_id, version, source, note, origin, created_at, active)
                                                           origin = human | form | llm_draft
bt_run(id, strategy_version_id, params_json, spec_hash, status,
       started_at, finished_at, error, metrics_json, stdout)
bt_trade(run_id, seq, side, dt, price, qty, fee, tax, pnl, reason)
bt_equity(run_id, dt, equity, cash, position_value, drawdown)
bt_optimize(id, run_group, param_grid_json, method, status, best_run_id)
```

`bt_run.strategy_version_id`가 **재현성의 축**이다 — 결과는 항상 "어떤 코드/스펙 버전이 냈는가"로 되짚힌다.

### 5.4 수정주가 함정 (TR 문서 실측)

`ka10081`의 `upd_stkpc_tp` 설명이 명시한다:

> 권리발생일 이전 일자를 `base_dt`로 수정주가구분 1로 조회하면 그 이전 데이터에 수정주가가 적용된다.
> 권리 발생일 **이후** 일자로 조회하면 수정주가가 적용되지 않아 가격대가 어긋난다.

즉 **증분 페치로 이어붙이면 권리락 경계에서 가격이 튄다.** 규칙 셋으로 고정한다.

1. 캐시 키에 `adjusted` 포함 — 수정/무수정은 서로 다른 시계열이다.
2. 증분 페치 시 **겹치는 최근 N봉(기본 20)의 종가를 대조**한다. 하나라도 다르면 권리 이벤트로 보고 **전체 재수집**.
3. 재수집을 조용히 하지 않는다 — 실행 결과에 "권리락 감지 · 전체 재수집됨"을 남긴다.

### 5.5 정직하게 못 하는 것

- **생존 편향**: 상장폐지 종목의 과거 봉을 차트 TR로 못 받는다. 유니버스 결과는 구조적으로 낙관 편향 → 결과 화면 상시 표기.
- **종목코드 변경 이력**: 별도 확인 필요. 1차는 §5.4 대조 규칙으로만 방어.
- **분/틱**: `ka10080`은 조회 가능 기간이 짧고 페이지가 많다. 1차 비대상.
- **NXT/SOR**: `stk_cd` 접미(`_NX`/`_AL`) 미지원, KRX만.
- **공매도·신용·배당 재투자**: 미반영. 결과 화면에 명시.

---

## 6. 백엔드 설계

### 6.1 신규 패키지

```
backend/athena_api/backtest/
  __init__.py
  schema.py       StrategySpec (Pydantic) · from_kis_yaml() · 파라미터 치환($fast)
  compile.py      YAML/폼 → signals DataFrame  (선언형 경로)
  indicators/     지표 레지스트리 + 어댑터 (§6.3)
  rules.py        조건 평가 (연산자 7종 + AND/OR)
  engine.py       signals → 체결·비용·포지션 → trades/equity   ★신뢰 코드, 부모 프로세스
  metrics.py      6지표 + §6.5 수정
  costs.py        수수료·세금·슬리피지
  data.py         캔들 저장소 + 키움 백필 (call_raw_tr + cont-yn)
  store.py        SqliteOwner 기반 (athena-backtest.sqlite3)
  runner.py       잡 큐 · 상태 · 취소 · 진행률
  optimize.py     그리드/랜덤 서치 + 과최적화 경고
  presets.py      프리셋 10종
  sandbox/
    __main__.py   ★샌드박스 진입점 — 별도 프로세스에서만 실행된다
    api.py        전략 코드가 볼 수 있는 유일한 표면 (athena_bt)
    guard.py      import 허용목록 · 빌트인 제한
```

### 6.2 실행 코어 — 두 경로가 한 곳으로 모인다

```
[폼 / .athena.yaml] ──compile.py──┐
                                  ├──→ signals DataFrame ──→ engine.py ──→ trades · equity · metrics
[파이썬 전략 코드] ──sandbox 프로세스──┘
```

`signals` 계약 (양쪽 동일):

```
index   : DatetimeIndex (거래일, 오름차순)
entry   : bool    진입 신호
exit    : bool    청산 신호
size    : float   선택. 0..1, 없으면 1.0
```

**이 한 계약이 SSoT다.** 지표 계산·조건 평가는 신호를 만드는 일이고, 체결·비용·성과는 엔진의 일이다.
경로가 둘이어도 성과 계산이 갈라지지 않는 이유가 이것이다.

### 6.3 지표 80종 — 어댑터 뒤에 둔다

```python
# indicators/registry.py
register("RSI", params={"period": int}, source="close", fn=...)
```

이식은 3단계.

| 단계 | 대상 | 방식 |
|---|---|---|
| P3 | 프리셋 10종이 쓰는 **핵심 25종** | 직접 구현 + 손계산 골든 픽스처로 고정 |
| P6 | 나머지 55종 | `pandas-ta` 위임을 **먼저 평가**한다 — 우리 픽스처를 통과하면 채택, 아니면 직접 구현 |
| 상시 | 파리티 체크리스트 | `docs/architecture/backtest-indicator-parity.md`에 80행 표로 상태 추적 |

`pandas-ta`를 무조건 채택하지 않는 이유: 유지보수가 고르지 않고 numpy 버전 제약이 붙은 이력이 있다.
어댑터 뒤에 두면 교체 비용이 지표 하나 단위로 떨어진다.

핵심 25종(P3): SMA, EMA, WMA, DEMA, TEMA, RSI, MACD, Stochastic, CCI, Williams %R, ROC, Momentum,
ADX, Aroon, SAR, ATR, NATR, Bollinger, Keltner, Donchian, STD, OBV, MFI, VWMA, CMF.

### 6.4 체결 모델 — 발명하지 않고 명시한다

- 신호 판정: **종가 확정 후**. 미래 정보 없음.
- 체결: **다음 봉 시가**. 같은 봉 종가 체결은 look-ahead다.
- 손절/익절: 봉 내부 `low`/`high` 터치 시 해당 가격 체결로 가정. 같은 봉에서 둘 다 닿으면 **손절 우선**(보수적).
- 상·하한가 봉(시가=고가=저가=종가)은 체결 불가로 처리하고 다음 봉으로 이월. 거래량 0 봉도 동일.
- 이 5줄 전부 결과 화면 "가정" 섹션에 그대로 노출한다.

### 6.5 성과 지표 — 원본이 고백한 결함을 고친다

| 지표 | 원본 결함(README 자백) | 우리 |
|---|---|---|
| Sharpe | 워밍업 구간의 0수익일이 표준편차를 낮춰 부풀려진다 | **첫 신호 가능일 이후**만 수익률 계열에 넣는다 |
| CAGR | 실거래일이 아닌 달력 전체로 나눈다 | **거래일 수 / 연 거래일(252)** 기준 |
| 승률 | 미청산 포지션 제외 | 동일하되 **미청산 건수를 별도 표기** |

추가: MDD, Profit Factor, 총수익률, 그리고 **Buy&Hold 벤치마크 대비**.

### 6.6 라우트

```
GET  /api/v1/backtest/indicators                지표 목록 + 파라미터 스펙
GET  /api/v1/backtest/presets                   프리셋 10종
POST /api/v1/backtest/validate                  yaml|python → 에러 목록 (실행 안 함)
GET  /api/v1/backtest/data/coverage             ?stk_cd&period&adjusted
POST /api/v1/backtest/data/plan                 spec → 필요 호출 수 + 예상 소요 (승인 화면용)
POST /api/v1/backtest/data/backfill             승인 후 수집 (잡)
GET  /api/v1/backtest/strategies                전략 목록
POST /api/v1/backtest/strategies                생성
GET  /api/v1/backtest/strategies/{id}/versions  버전 목록(+diff용 source)
POST /api/v1/backtest/strategies/{id}/versions  새 버전 (origin=human|form|llm_draft)
POST /api/v1/backtest/strategies/{id}/activate  버전 활성화  ← 사람 클릭 전용
POST /api/v1/backtest/runs                      202 {run_id}
GET  /api/v1/backtest/runs                      목록
GET  /api/v1/backtest/runs/{id}                 상태 + 지표 + 자산곡선 + stdout
GET  /api/v1/backtest/runs/{id}/trades          체결 표
DELETE /api/v1/backtest/runs/{id}               취소/삭제
POST /api/v1/backtest/optimize                  그리드/랜덤
GET  /api/v1/backtest/optimize/{id}             결과 표
```

`api/__init__.py`에 라우터 1줄 추가.

---

## 7. 파이썬 전략 코드 인프라 (D3) — 이번 기획의 두 번째 기둥

### 7.1 전략 코드 계약

```python
# athena strategy v1
PARAMS = {
    "fast": {"default": 20, "min": 5,  "max": 60,  "step": 1},
    "slow": {"default": 60, "min": 20, "max": 240, "step": 1},
}

def signals(df, p):
    """df: DataFrame[open,high,low,close,volume], index=거래일
       p : dict — PARAMS의 현재 값
       반환: DataFrame[entry:bool, exit:bool, (size:float)]"""
    import athena_bt as bt
    fast = bt.sma(df.close, p["fast"])
    slow = bt.sma(df.close, p["slow"])
    return df.assign(
        entry=bt.cross_above(fast, slow),
        exit=bt.cross_below(fast, slow),
    )[["entry", "exit"]]
```

- `athena_bt`는 §6.3 지표 레지스트리를 그대로 노출한다 — 폼 경로와 **같은 구현**을 쓴다.
- pandas/numpy를 직접 써도 된다. 그게 D1을 고른 실질적 이유다.
- 이벤트 방식(`on_bar(ctx)`)은 **2차**다. 벡터화 계약이 KIS 선언형이 표현할 수 있는 전부를 이미 덮는다.

### 7.2 샌드박스 — 진짜 경계가 어디인지 정직하게

전략 코드는 **별도 프로세스**에서 돈다.

```
부모(athena_api)                      자식(sandbox)
  jobdir/spec.json  ──────────────▶
  jobdir/bars.csv   ──────────────▶   exec(user_code)  →  signals()
                    ◀────────────── jobdir/signals.csv
                    ◀────────────── jobdir/stdout.txt
  engine.py로 체결·비용·성과 계산
  DB 쓰기
```

프로세스 기동 조건:

| 항목 | 값 | 이유 |
|---|---|---|
| 명령 | `python -I -B -m athena_api.backtest.sandbox <jobdir>` | `-I` 격리 모드(사용자 site-packages·`PYTHONPATH` 무시) |
| env | `PATH`, `PYTHONPATH`(패키지), `ATHENA_BT_JOB`만 | **`KIWOOM_*`·베어러 토큰을 넘기지 않는다** |
| cwd | `jobdir` | 파일 접근을 잡 디렉터리로 유도 |
| 타임아웃 | 기본 30초 (설정) | 무한루프 차단 |
| stdout 상한 | 바이트 캡 | `claude-runner.stdout-cap.test.js`에 선례가 있다 |
| import | 허용목록: `pandas`, `numpy`, `math`, `statistics`, `datetime`, `athena_bt` | `os`/`sys`/`subprocess`/`socket`/`urllib`/`httpx`/`pathlib` 차단 |
| 교환 포맷 | **CSV** | 자식→부모 방향에 pickle/parquet을 쓰지 않는다 — 역직렬화 구멍을 안 만들고 `pyarrow` 의존도 피한다 |

**정직한 한계 표기.** 파이썬 in-process 샌드박스는 결정적인 공격자에게 안전하지 않다. import 차단은 사고 방지 수준이다.
진짜 경계는 **자격증명 미전달 · DB 미접근 · 별도 프로세스 · 타임아웃** 넷이고, 위협 모델은
"사용자 본인 코드와 사용자가 검토한 LLM 코드"다. 이 문장을 코드 주석과 화면 양쪽에 남긴다.

**엔진은 샌드박스에 없다.** 자식은 신호만 만든다. 체결·비용·성과·DB는 전부 부모가 한다 —
전략 코드가 성과 수치를 직접 쓸 방법이 구조적으로 없다.

### 7.3 코드 저작 흐름 (LLM 포함)

```
사람이 채팅에 말한다
  → LLM이 MCP athena_backtest.propose_code 호출
  → 버전 저장 (origin=llm_draft, active=false)      ★실행도 활성화도 안 됨
  → 캔버스(보드 60)가 현재 활성 버전과의 diff를 보여준다
  → 사람이 [적용] 클릭 → activate (사람 클릭 전용 IPC)
  → [실행] 클릭 또는 LLM의 run 호출
```

라우틴의 `draft`만 있고 `confirm`/`cancel`은 없는 규율(`routine_tools.py` 머리말)과 **같은 형태**다.
모델이 코드를 바꿔놓고 사람은 옛 코드가 도는 줄 아는 경로를 원천 차단한다.

편집기에서 사람이 직접 고치면 `origin=human` 새 버전이 즉시 활성화된다 — 사람의 편집은 사람의 클릭이다.

### 7.4 편집기

`app/lib/backtest-code-editor.js` — **CodeMirror 6**.

- 신규 프런트 의존: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-python`.
  현재 `app/package.json`에는 `lightweight-charts` 하나뿐이다 → 두 번째 런타임 의존.
- 테마는 우리 유리 토큰으로 직접 짠다(기성 테마 미사용).
- diff 뷰(보드 60)는 별도 라이브러리 없이 라인 단위 LCS로 그린다 — 전략 파일은 수백 줄 규모다.
- 대안(의존 0): `<textarea>` + 줄번호. "Code 탭처럼"이라는 요구에 못 미쳐서 채택하지 않는다.

### 7.5 재현성

`bt_run`은 `strategy_version_id` + `params_json` + `spec_hash`(데이터 구간·비용·주기 해시)를 갖는다.
같은 셋이면 같은 결과여야 한다 — **P4에 재현성 테스트**를 둔다(같은 입력 2회 실행 → 지표 완전 일치).

---

## 8. 프런트 설계

### 8.1 파일

```
app/lib/backtest-canvas.js         4표면(설계·코드·결과·이력) 렌더 + setView()
app/lib/backtest-canvas.test.js
app/lib/backtest-code-editor.js    CodeMirror 6 래퍼 + diff 뷰
app/lib/backtest-spec-form.js      조건 빌더·파라미터 슬라이더 (순수 상태)
app/lib/backtest-equity-chart.js   lightweight-charts 자산곡선 (chart-card.js를 포크하지 않는다)
app/lib/main/backtest-bridge.js    IPC 핸들러 (rest-dataset-runner.js 패턴)
app/probe-backtest-mode.js         5중 배타 + 코드 실행 + 결과 렌더 프로브
```

`canvas.js`에는 `pluginCanvas` 배선과 같은 모양으로 ~12줄만 늘어난다.

### 8.2 IPC 채널 (`preload.js` allowlist + `main.js` 핸들러)

```
athena:backtest-presets        athena:backtest-indicators
athena:backtest-validate       athena:backtest-plan
athena:backtest-run            athena:backtest-status
athena:backtest-result         athena:backtest-runs
athena:backtest-trades         athena:backtest-coverage
athena:backtest-strategies     athena:backtest-versions
athena:backtest-save-version   athena:backtest-optimize
athena:backtest-activate       ← 사람 클릭 전용
athena:backtest-backfill       ← 사람 클릭 전용
```

`check-harness-freshness.mjs`가 DOM id·채널 수를 대조한다(현재 125 id / 117 채널) — **게이트 기대값 갱신 필요**.

### 8.3 결과 화면 (보드 61)

1. **지표 타일 6종** — 총수익률·CAGR·Sharpe·MDD·승률·Profit Factor. `card-primitives.js` 재사용.
2. **자산곡선** — 전략 vs Buy&Hold.
3. **체결 마커** + **체결 표**(날짜·방향·가격·수량·수수료·손익·사유).
4. **코드 출력** — 샌드박스 stdout 그대로. `print` 디버깅이 되어야 실제로 쓸 수 있다.
5. **가정 섹션** — §6.4 체결 규칙 5줄 + §5.5 비대상 목록. **접히지 않는다.**

---

## 9. MCP — `athena_backtest`

`routine_tools.py`와 같은 HTTP 루프백 프록시. **재시도 없음.**

| 액션 | 상태 변경 | 비고 |
|---|---|---|
| `list_presets` · `list_indicators` · `list_strategies` | 없음 | |
| `read_code` | 없음 | 활성 버전 소스 |
| `validate` | 없음 | 파싱·계약 검사만 |
| `plan` | 없음 | 필요한 TR 호출 수만 계산 |
| `propose_code` | 초안 버전 생성 (**비활성**) | 사람이 diff 보고 적용 |
| `run` | 잡 생성 | **캐시가 충분할 때만** 즉시 실행 |
| `status` · `result` | 없음 | |
| `optimize` | 잡 생성 | 조합 수 상한 넘으면 `blocked` |
| `activate` | **없음(거부)** | 사람 클릭 전용 |
| `backfill` | **없음(거부)** | 쿼터를 태우는 행위 — 사람 클릭 전용 |

`run`이 캐시 부족을 만나면 실행하지 않고 `blocked` + `{needed_pages, est_seconds}`를 돌려준다.
캔버스가 그 숫자로 승인 카드(보드 63)를 띄운다.

---

## 10. 단계 계획

각 단계 끝에서 **변경 확인 → 커밋 → 푸시**.

| 단계 | 내용 | 완료 검증 |
|---|---|---|
| **P0** ✅ | Paper **전용 백테스트 페이지** BT-01~06 신규 + 화면 45/47 개정 · `PAPER_APP_PARITY.md` 갱신 | 보드 6장 스크린샷 검수 완료 (백테스트 보드는 백테스트 페이지에 둔다 — 2026-08-31 사용자 지시) |
| **P1** ✅ | 모드 골격 — `VIEW_BACKTEST`, `#backtestCanvas`, 네비, 빈 캔버스, `applyVisibility()` 정규화 | app 1342 passed(5×5 배타표 포함) · 게이트 4종 통과(DOM id 125→127) · `probe-backtest-mode.js` 5/5 |
| **P1.5** ◐ | **numpy/pandas 배포 실측** | 워크트리 venv에서 numpy 2.5.2 · pandas 2.3.3 import 실측 통과. **패키징된 앱 실측은 남았다** — 배포 스크립트가 파이썬 런타임을 어떻게 동봉하는지에 달렸다 |
| **P2** ◐ | 데이터 층 — `store.py`·`data.py`·백필·coverage·plan | unit 18+28 passed · 시드 캐시로 종단 확인. **실서버 수집 실측은 남았다**(페이지 크기 600행 가정·최대 과거 시점·모의/실서버 차이) — 자격증명 필요 |
| **P3** ✅ | 엔진 — `schema`/`indicators`(25종)/`rules`/`compile`/`engine`/`metrics`/`costs` + 프리셋 10종 | 백테스트 계열 157 passed · 손계산 골든 8종(SMA/EMA/RSI/MACD/ATR/Bollinger/Stochastic + 엔진 1왕복 26봉) · 프리셋 10종 컴파일·실행 무오류 |
| **P4** ✅ | 샌드박스 + 잡 러너 + API 10라우트 + MCP 툴 + IPC 8채널 + 결과 캔버스 | 샌드박스 6종(자격증명 미노출은 자식 `os.environ` 덤프로 실측) · api+mcp 579 passed · **실백엔드 종단 실측**: 409 정직 거부 → 시드 후 694봉 실행 → 지표·체결 7건·flags `비용 미설정` 확인 |
| **P5** ✅ | 코드 편집기 + diff + LLM `propose_code` → 사람 적용 | **CodeMirror를 쓰지 않았다**(§11-6의 두 번째 런타임 의존을 지금 치를 이유가 없다) — 투명 textarea + 색칠 pre + 줄번호 + LCS diff로 같은 요구를 채운다. `propose_code`는 툴이 `origin=llm_draft`를 못박아 저장만 되고 활성화되지 않는다 |
| **P6** ◐ | 지표 55종 파리티 + 그리드/랜덤 최적화 + 이력 비교 + 과최적화 경고 + 자산곡선 차트 | 최적화·과최적화 경고·자산곡선·이력 비교 완료. **지표는 25/80 그대로** — `pandas-ta` 채택 여부는 어댑터 뒤에서 지표 단위로 남긴다 |

P0~P4가 "쓸 수 있는 백테스트 모드"의 최소선이다. P5가 D3의 본체, P6이 D2의 파리티 마무리다.

### 10.1 검증 규율

- `npm test` — `app/lib/*.test.js` (pre-push가 강제, 게이트 4종 동반)
- `uv run pytest -m deterministic` (0건 수집되면 `rtk proxy uv run pytest`)
- `app/probe-backtest-mode.js` — Electron 실앱 프로브
- 워크트리에 `app/node_modules`가 없으면 전 테스트가 `Cannot find module 'electron'`로 죽는다 — 착수 전 `npm install`

### 10.2 새로 만들지 않는 것

- 새 게이트 — 기존 `check-harness-freshness.mjs` 기대값만 갱신한다.
- 새 창 — 캔버스 안이다.
- 새 SQLite 소유자 클래스 — `SqliteOwner`를 쓴다.
- 새 MCP 서버·포트 — `athena_mcp`에 툴 하나.

### 10.3 값이 아니라 설정인 것

수수료·거래세율은 코드 상수로 박지 않는다. `costs:` 기본값이고 화면에서 바꾼다.
세율은 시점에 따라 바뀌고, 우리가 그 시점의 정답을 안다고 주장할 근거가 없다.

---

## 11. 열린 위험

1. **numpy/pandas Electron 패키징 (D1의 대가)** — 백엔드는 `uv`로 뜨는 별도 프로세스지만, 배포판이 파이썬 런타임을 어떻게 동봉하는지에 따라 네이티브 휠이 문제를 낼 수 있다. **P1.5로 앞당겨 실측**한다. 실패하면 D1을 되짚어야 하므로 P2 착수 전에 결론을 낸다.
2. **키움 차트 TR 실제 페이지 크기·연속조회 상한 미실측** — §5.2의 "600행/페이지"는 가정이다. P2 첫 작업이 이 실측이고, 결과에 따라 대량 백필 UX가 바뀐다.
3. **`ka10081` 조회 가능 최대 과거 시점 미확인** — 10년이 안 나올 수 있다.
4. **모의투자 서버와 실서버의 차트 데이터 차이 미확인.**
5. **`pandas-ta` 채택 여부는 P6에서 결정** — 어댑터 뒤에 두어 실패해도 지표 단위로 되돌린다.
6. **CodeMirror 6 = 두 번째 프런트 런타임 의존** — 번들 크기·오프라인 설치 영향 확인 필요.
7. `graph-mode/controller.js`가 5개 모드의 가시성을 소유하는데 이름은 여전히 `graph-mode`다. 이번 범위에서 **개명하지 않는다**(변경 폭이 계획 전체보다 커진다) — 별건으로 남긴다.
8. **app 단위 스위트에 산발적 실패가 관측됐다** — 같은 커밋에서 1회차 4건 실패, 2회차 0건. 백테스트와 무관하지만 pre-push를 간헐적으로 막을 수 있다. 별건 조사 대상.
9. **휴장일을 `from`으로 주면 승인 무한 루프에 빠진다 (2026-08-31 실측, P4 종단 프로브).** `compute_plan`이 요청 `from_dt`와 `bt_coverage.first_dt`를 **달력 날짜로** 비교하는데, 키움에는 휴장일 봉이 애초에 없다. 실측: 캐시가 `20240102~20260828`로 꽉 찬 상태에서
   - `from=20240102` → `needed_pages: 0` (정상)
   - `from=20240101` → `needed_pages: 1`, `segments:[{20240101,20240101}]`
   백필을 아무리 돌려도 그 하루는 채워지지 않으므로 `POST /runs`가 영구히 409를 낸다 — 사용자는 승인 카드를 눌러도 같은 자리로 돌아온다. **거래일 달력이 없는 것이 근본 원인**이라 임시로 날짜를 보정하면 "없는 데이터를 있다고 치는" 반대편 거짓말이 된다. 후보 해법 둘: ⓐ 백필이 새 행 0건으로 끝난 구간을 `bt_coverage`에 "소진됨"으로 표시해 plan이 다시 요구하지 않게 한다, ⓑ 첫 백필 응답의 가장 오래된 봉을 그 종목의 조회 하한으로 기록한다. ⓑ가 §10-2(최대 과거 시점 미실측)와 같은 실측으로 함께 풀린다 — P2 실서버 실측 때 같이 정한다.
