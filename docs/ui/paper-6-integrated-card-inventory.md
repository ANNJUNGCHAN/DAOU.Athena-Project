# Paper 6개 Canvas 통합 카드 UI 내역서

- 상태: **Paper overview + 6개 기준 artboard 반영 완료 · Runtime bridge/semantic coverage 검증 전**
- 대상: Athena Canvas의 최종 루트 카드 6종
- 관련 문서: [6개 Canvas 카드 압축 계획](../architecture/6-canvas-card-compression-plan.md), [기존 Paper 19개 Capability 내역](./paper-19-window-ui-inventory.md)
- Paper 기준 화면: [Athena `통합 카드` page `7-2`](https://app.paper.design/file/01M0VGPX92K1TER4ZV9PWGQJJZ/7-2)

## 1. 사용자가 보는 카드 수

최종 카드 종류는 **6개**다. 299개 operation과 19개 Capability는 카드 안에 데이터를 채우기 위한 backend 계약이며, Canvas에 299개 또는 19개의 독립 카드를 만들지 않는다.

| 구분 | 수량 | Paper에서의 표현 |
|---|---:|---|
| 내부 operation | 299 | 직접 디자인하지 않음 |
| backend Capability | 19 | 6개 카드의 mode·section으로 매핑 |
| 최종 Canvas 카드 | 6 | 카드 종류별 기준 artboard 1개 이상 |

Paper에 loading, error, live, stale, empty 같은 상태별 artboard가 추가되어도 카드 **종류**는 6개 그대로다.

## 2. 카드와 내부 요소의 경계

카드는 Canvas가 배치·닫기·포커스·갱신하는 **바깥쪽 rounded surface 하나**다. 그 안의 다음 요소는 카드가 아니다.

- KPI 숫자와 비교값
- 탭·세그먼트·필터
- 차트·호가 ladder·체결 tape
- 표의 행과 열
- 상태 band와 안내문
- divider로 나눈 section
- 주문 입력·preview·confirmation 단계

따라서 PER, PBR, ROE를 각각 흰색 rounded box로 만들지 않는다. `CC-03` (`instrument`) 카드 안의 하나의 valuation band에 열과 divider로 배치한다. 매도 1호가와 매수 1호가도 별도 box가 아니라 `CC-04` (`orderbook`) 카드의 best-quote band와 ladder에 붙인다.

## 3. 공통 시각 문법

### 루트 표면

- Canvas 배경 위에 outer rounded surface를 정확히 하나 둔다.
- 제목, target identity, freshness, live 상태를 같은 header band에 둔다.
- card 내부 계층은 배경색 변화, divider, band, table header, tab indicator로 표현한다.
- section마다 다시 radius와 shadow를 부여해 mini-card처럼 보이게 만들지 않는다.
- 숫자는 tabular figure를 사용하고 단위·부호·기준 시점을 값 가까이에 둔다.

### 정보 밀도

- 최상단: 카드 이름, 대상, 기준 시점, live/snapshot 상태
- 그 아래: mode tab 또는 업무 단계
- 본문: 현재 질문에 필요한 primary section을 가장 크게 표시
- 하단 또는 우측: supporting section과 상세 표
- footer/status band: source 상태, stale/error, 자동 구독 상태

### 상태

모든 카드에 최소 다음 상태를 설계한다.

| 상태 | 표현 |
|---|---|
| loading | 루트 골격과 section 위치를 유지한 skeleton |
| partial | 성공 section 유지, 실패 section에만 오류와 재시도 |
| live | header/status band에 연결 상태와 마지막 event 시각 |
| stale | 마지막 정상 데이터 유지, stale badge와 기준 시각 표시 |
| empty | 무엇이 비었는지와 다음 행동을 section 안에 표시 |
| error | 카드 전체를 지우지 않고 복구 가능한 경계와 원인 범주 표시 |

## 4. 6개 카드 inventory

| `card_id` | `card_kind` | 카드명 | operation | 포함 Capability |
|---|---|---|---:|---|
| `CC-01` | `account` | 계좌 통합 카드 | 76 | `account` |
| `CC-02` | `order` | 주문 통합 카드 | 12 | `order` |
| `CC-03` | `instrument` | 종목·상품 통합 카드 | 88 | `chart`, `etf`, `elw`, `stock-info`, `quote`, `gold` |
| `CC-04` | `orderbook` | 호가 통합 카드 | 31 | `orderbook` |
| `CC-05` | `flow` | 수급·포지션 통합 카드 | 50 | `program-trading`, `investor-flow`, `broker`, `credit-lending-short` |
| `CC-06` | `explorer` | 탐색·목록 통합 카드 | 42 | `sector`, `discovery`, `watchlist`, `theme`, `market-status`, `condition-search` |
|  |  | **합계** | **299** | **19 Capability** |

## 5. `CC-01` · `account` — 계좌 통합 카드

### Mode와 section

- mode: 전체, 보유종목, 예수금, 손익, 체결, 증거금, 금현물
- section: account identity, 총자산, 자산배분, 보유종목 표, 주문가능금액, 실현·평가손익, 체결 내역, 증거금

### 대표 layout

```text
┌ CC-01 · account · 계좌명 · 기준 시각 · LIVE ──────┐
│ 전체  보유종목  예수금  손익  체결  증거금           │
├ 총자산 · 주문가능금액 · 평가손익 summary band ──────┤
├ 자산배분 visualization ───┬ 보유종목 table ─────────┤
├ 체결/손익 history table ──┴ account status ─────────┤
└ subscription · stale/error status band ────────────┘
```

KPI는 한 summary band 안에서 divider로 구분한다. 보유종목마다 카드를 만들지 않는다. 체결 `00`, 잔고 `04`는 해당 mode가 활성화되면 자동 등록한다.

## 6. `CC-02` · `order` — 주문 통합 카드

### Mode와 section

- 상품 mode: 현금, 신용, 금현물
- 동작 mode: 매수, 매도, 정정, 취소
- section: 종목 identity, 주문 입력, 예상 금액, preview, confirmation, 접수 영수증, 체결 상태

### 대표 layout

```text
┌ CC-02 · order · 삼성전자 · 005930 ─────────────────┐
│ 현금  신용  금현물        매수  매도  정정  취소      │
├ 수량 · 가격 · 주문유형 input band ──────────────────┤
├ 주문 preview · 예상금액 · 수수료/가능금액 ──────────┤
├ 명시적 confirmation ───────────────────────────────┤
└ receipt · 체결/잔고 live status ────────────────────┘
```

입력, preview, confirmation을 별도 카드로 쪼개지 않는다. 모두 같은 `CC-02` (`order`) instance의 단계다. 자동 구독은 체결·잔고 표시에만 사용하며 주문 실행은 반드시 confirmation과 idempotency 검증 뒤에 수행한다.

## 7. `CC-03` · `instrument` — 종목·상품 통합 카드

### Mode와 section

- mode: 현재시세, 차트, 종목정보, ETF, ELW, 금현물
- section: identity, quote strip, chart, volume/indicator, valuation, fundamentals, product detail, history table

### 대표 layout

```text
┌ CC-03 · instrument · 삼성전자 005930 · LIVE ───────┐
│ 현재시세  차트  종목정보  ETF  ELW  금현물            │
├ 현재가 · 등락 · 거래량 quote strip ─────────────────┤
├ primary visualization / chart ──────────────────────┤
├ PER │ PBR │ ROE │ 배당수익률  valuation band ───────┤
├ fundamentals 또는 상품별 detail table ──────────────┤
└ source · snapshot/live · stale/error status ────────┘
```

PER·PBR·ROE는 각각 독립 카드가 아니다. 같은 valuation band의 열이다. ETF의 NAV·괴리율, ELW의 민감도·행사가·만기, 금현물의 환산가도 mode 전환에 따라 같은 루트 표면의 product-detail section을 교체한다.

## 8. `CC-04` · `orderbook` — 호가 통합 카드

### Mode와 section

- 시장 mode: 정규장, 시간외, 금현물
- 깊이 mode: 5단, 10단
- section: market header, best quote, depth ladder, 중앙 현재가, 체결 tape, 잔량 불균형, 연결 상태

### 대표 layout

```text
┌ CC-04 · orderbook · 삼성전자 005930 · 정규장 · LIVE ┐
│ 정규장  시간외  금현물       5단  10단               │
├ 매도1 150,850 │ spread 10 │ 매수1 150,840 ─────────┤
├ 매도 잔량/가격 ladder ──────────────────────────────┤
├ 현재가 · 체결강도 · 누적 거래량 center band ─────────┤
├ 매수 가격/잔량 ladder ─────────┬ 체결 tape ──────────┤
└ imbalance · subscription · last event status ──────┘
```

`매도 1호가 150,850`과 `매수 1호가 150,840`의 가격 관계는 정상이다. 그러나 두 값을 각각 rounded mini-card로 만들면 호가 맥락이 끊긴다. best quote는 하나의 얇은 band로 묶고, 바로 아래의 red/blue depth ladder와 시각적으로 연결한다. target과 mode가 확정되면 호가 실시간을 자동 등록하고 event마다 같은 행의 가격·잔량·강도를 갱신한다.

## 9. `CC-05` · `flow` — 수급·포지션 통합 카드

### Mode와 section

- mode: 프로그램, 투자자, 거래원, 신용, 대차, 공매도
- section: 순매수 summary, 주체별 breakdown, 기간 추이, 거래원 순위, 잔고/비중, 기간 비교, 위험 안내

### 대표 layout

```text
┌ CC-05 · flow · 삼성전자 005930 · 기간 · 기준 시각 ─┐
│ 프로그램  투자자  거래원  신용  대차  공매도          │
├ 매수 │ 매도 │ 순매수 summary band ──────────────────┤
├ participant/broker trend visualization ─────────────┤
├ 순위·기간 비교 table ───────────────────────────────┤
└ snapshot/live · 기준 기간 · risk/status band ───────┘
```

개인·외국인·기관, 매수·매도·순매수는 독립 카드가 아니라 같은 표의 열과 summary band다. 현재 종목에 실시간 feed가 있는 mode만 자동 등록하고 신용·대차·공매도 잔고성 데이터는 snapshot 기준 시점을 명시한다.

## 10. `CC-06` · `explorer` — 탐색·목록 통합 카드

### Mode와 section

- mode: 업종, 순위, 관심종목, 테마, 시장상태·VI, 조건검색
- section: query controls, market state, result table, compare, selected item detail, subscription status

### 대표 layout

```text
┌ CC-06 · explorer · 시장/조건 · 기준 시각 · LIVE ───┐
│ 업종  순위  관심종목  테마  시장상태  조건검색         │
├ 검색·필터·정렬 query band ───────────────────────────┤
├ 결과 table ─────────────────┬ 선택 항목 detail ──────┤
├ 비교/VI/조건 상태 band ─────┴────────────────────────┤
└ visible rows subscription · stale/error status ─────┘
```

종목별 결과는 카드 목록이 아니라 하나의 결과 table이다. 선택한 행의 상세만 우측 또는 하단 section에 연다. 화면에 보이는 행과 활성 조건식만 구독하고 가시 범위를 벗어나면 해제해 실시간 상한을 지킨다.

## 11. 19 Capability가 놓이는 위치

| Capability | `card_id` | `card_kind` | mode | 대표 section |
|---|---|---|---|---|
| `account` | `CC-01` | `account` | holdings/cash/pnl 등 | summary, holdings, executions |
| `order` | `CC-02` | `order` | cash/credit/gold + action | entry, preview, confirmation, receipt |
| `chart` | `CC-03` | `instrument` | chart | visualization, indicator |
| `orderbook` | `CC-04` | `orderbook` | regular/after-hours/gold | depth-ladder, tape |
| `program-trading` | `CC-05` | `flow` | program | net-summary, trend |
| `etf` | `CC-03` | `instrument` | etf | quote, product-detail |
| `elw` | `CC-03` | `instrument` | elw | quote, product-detail |
| `sector` | `CC-06` | `explorer` | sector | result-table, compare |
| `investor-flow` | `CC-05` | `flow` | investor | breakdown, trend |
| `broker` | `CC-05` | `flow` | broker | ranking-table, trend |
| `discovery` | `CC-06` | `explorer` | ranking | query-controls, result-table |
| `credit-lending-short` | `CC-05` | `flow` | credit/lending/short | balance, period-compare |
| `stock-info` | `CC-03` | `instrument` | profile | valuation, fundamentals |
| `watchlist` | `CC-06` | `explorer` | watchlist | result-table, selection-detail |
| `quote` | `CC-03` | `instrument` | quote | quote-strip, history-table |
| `gold` | `CC-03` | `instrument` | gold | quote, chart, product-detail |
| `theme` | `CC-06` | `explorer` | theme | result-table, compare |
| `market-status` | `CC-06` | `explorer` | market-status | market-state, VI detail |
| `condition-search` | `CC-06` | `explorer` | condition-search | query-controls, result-table, subscription-status |

## 12. Paper artboard inventory

Athena Paper file `01M0VGPX92K1TER4ZV9PWGQJJZ`의 page `7-2` `통합 카드`에는 overview와 다음 6개 기준 artboard가 반영되어 있다.

1. `01 · CC-01 계좌 통합 카드 — 76 operations`
2. `02 · CC-02 주문 통합 카드 — 12 operations`
3. `03 · CC-03 종목·상품 통합 카드 — 88 operations`
4. `04 · CC-04 호가 통합 카드 — 31 operations`
5. `05 · CC-05 수급 통합 카드 — 50 operations`
6. `06 · CC-06 탐색 통합 카드 — 42 operations`

각 정본은 desktop 기준 루트 표면 하나를 보여준다. 상태·반응형 artboard는 `CC-xx/state-name` 형식으로 파생하되 새로운 card ID를 만들지 않는다.

## 13. Paper anti-fragmentation 점검표

- [ ] artboard마다 outer rounded surface가 하나인가?
- [ ] KPI, 호가, 표 행, 주문 단계가 nested mini-card로 보이지 않는가?
- [ ] mode 전환이 새 카드 추가가 아니라 같은 본문의 section 교체로 보이는가?
- [ ] 한 API 응답마다 새 카드가 생기는 인상을 주지 않는가?
- [ ] 호가 best quote와 ladder가 한 시각 흐름으로 연결되는가?
- [ ] PER·PBR·ROE 같은 동급 지표가 하나의 band에서 비교되는가?
- [ ] 실시간 event가 같은 row·cell·series를 갱신하는 구조인가?
- [ ] partial error가 정상 section을 제거하지 않는가?
- [ ] 주문 confirmation과 실행 상태가 같은 카드 안에서 명확히 분리되는가?

## 14. 데이터 coverage 표시 규칙

Paper의 QA annotation에는 다음 수치를 표시할 수 있지만 일반 사용자 본문에는 내부 operation ID나 alias를 노출하지 않는다.

| 항목 | 현재 값 | 상태 |
|---|---:|---|
| 카드 종류 | 6 | registry·Paper 검증됨 |
| Capability 귀속 | 19/19 | registry 검증됨 |
| operation 귀속 | 299/299 | 검증됨 |
| unassigned / duplicated | 0 / 0 | 검증됨 |
| raw field occurrence | 3,705 | 보존 기준 검증됨 |
| unique field path | 3,703 | 보존 기준 검증됨 |
| unresolved semantic alias | 3 (`951`, `924`, `1279`) | 미완료 |

Paper 디자인과 6-card registry만으로 semantic render 100%를 선언하지 않는다. 현재 field coverage의 `release_ready`는 `false`다. 각 field가 실제 Runtime payload에서 올바른 section·column·detail view에 도달하는 자동 검증과 세 alias의 공식 의미 확인이 끝나야 한다.

## 15. 완료 기준

- Paper에서 최종 카드 종류가 6개로 한눈에 식별된다.
- 19 Capability가 각 카드의 mode·section에 빠짐없이 배치된다.
- 299 operation 합계가 `76 + 12 + 88 + 31 + 50 + 42`로 유지된다.
- 호가와 밸류에이션 예시가 하나의 루트 카드 안에서 분절 없이 표현된다.
- 실시간 자동 등록, stale, partial error, 재연결 상태가 카드별로 정의된다.
- 주문 카드가 draft·preview·confirmation·receipt 경계를 시각적으로 유지한다.
- 실제 Paper artboard screenshot과 Runtime capture를 비교해 fit, 대비, 정렬, 정보 계층을 검증한다.
- semantic alias `951`, `924`, `1279`가 해소되고 field-level release gate가 통과한다.
