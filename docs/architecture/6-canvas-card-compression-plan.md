# Athena 6개 Canvas 통합 카드 압축 계획

- 상태: **6-card registry 구현·테스트 및 Paper 기준안 완료 · Runtime bridge/semantic coverage 진행 중**
- 대상: Kiwoom 비-OAuth operation 299개, 19개 backend Capability, Athena Canvas
- 관련 문서: [19개 Capability 전환 계획](./19-capability-window-plan.md), [Paper 6개 통합 카드 내역](../ui/paper-6-integrated-card-inventory.md)

## 1. 결론

최종 Canvas가 호출하는 카드 종류는 **6개**다. 299개 operation을 299개 카드로 만들지 않고, backend에서 19개 Capability로 해석한 뒤 관련 Capability를 다시 6개 루트 카드에 투영한다. Canonical `card_id`는 `CC-01`~`CC-06`이며, 의미 이름은 별도 `card_kind`인 `account`, `order`, `instrument`, `orderbook`, `flow`, `explorer`로 표현한다.

```text
사용자 질문
  → 19개 backend Capability 중 하나로 해석
  → deterministic operation resolver가 299개 중 필요한 operation 선택
  → 6개 Canvas card_id 중 하나를 마운트하거나 기존 instance 갱신
  → 같은 루트 카드의 mode·section에 snapshot/live 데이터 합성
```

핵심 규칙은 **한 호출 = 루트 카드 하나**다. 루트 카드 안의 KPI, 표, 차트, 탭, 호가 행, 주문 단계는 별도 카드가 아니다. 같은 대상에 대한 후속 데이터는 새 카드를 추가하지 않고 같은 card instance의 section을 갱신한다.

## 2. 상태와 증거

| 구분 | 현재 상태 | 판정 |
|---|---|---|
| 299 operation → 19 Capability 귀속 | assigned 299, unassigned 0, duplicated 0 | 검증됨 |
| OAuth 2개 제외 | 299 집계에 포함하지 않음 | 검증됨 |
| 19 Capability → 6 Canvas 카드 합계 | 76 + 12 + 88 + 31 + 50 + 42 = 299 | 검증됨 |
| 6-card registry·resolver | `canvas_card_registry.py`가 `CC-01`~`CC-06` 소유권과 deterministic resolve를 고정 | 구현·테스트 완료 |
| Selector → Canvas 6-card Runtime bridge | 실제 plan payload, mount, same-instance section update 연결 | 미구현 |
| response field occurrence 보존 | raw 3,705 / unique `(mapping_id, json_path)` 3,703 | 검증됨 |
| 모든 semantic field 렌더 | alias `951`, `924`, `1279`의 공식 의미 미확정 | 미완료·release blocker |
| Paper 6-card 실물 | Athena Paper file `01M0VGPX92K1TER4ZV9PWGQJJZ`, page `7-2` `통합 카드`에 overview + 6 artboard | 반영 완료 |

`검증됨`은 현재 assignment·registry·coverage fixture와 Paper 산출물이 증명하는 범위만 뜻한다. Paper에 6개 기준 카드가 존재하고 registry가 식별자를 해석하더라도 Selector와 실제 Canvas renderer가 6-card payload로 연결됐다는 의미는 아니다.

## 3. 단위 정의

| 단위 | 수량 | 역할 | 사용자에게 보이는가 |
|---|---:|---|---|
| operation | 299 | Kiwoom REST, Detail projection, WebSocket control, 주문 호출의 내부 adapter | 아니오 |
| Capability | 19 | Selector와 backend resolver가 사용하는 의도·데이터 계약 | 직접 노출하지 않음 |
| Canvas root card | 6 | Canvas가 마운트하는 최종 시각 단위 | 예 |
| mode | 가변 | 같은 카드의 용도·데이터셋 전환 | 카드 내부 탭·세그먼트 |
| section | 가변 | snapshot/live 결과가 들어가는 고정 영역 | 카드 내부 band·표·차트 |

KPI 세 개를 나란히 표시해도 카드 수는 세 개가 아니다. `CC-03` (`instrument`) 카드의 `valuation` section 하나다. 매도 1호가와 매수 1호가도 두 카드가 아니라 `CC-04` (`orderbook`) 카드의 `best-quote` band와 depth ladder 일부다.

## 4. 6개 카드 정본

| `card_id` | `card_kind` | 카드 | 포함 Capability | operation | 주요 mode | 고정 section | 실시간 정책 |
|---|---|---|---|---:|---|---|---|
| `CC-01` | `account` | 계좌 | `account` | 76 | `overview`, `holdings`, `cash`, `pnl`, `executions`, `margin`, `gold` | identity, total-assets, allocation, holdings-table, cash, pnl, executions, margin | 지원 mode 진입 시 체결 `00`·잔고 `04` 자동 등록 |
| `CC-02` | `order` | 주문 | `order` | 12 | `cash`, `credit`, `gold`; `buy`, `sell`, `amend`, `cancel` | instrument, order-entry, preview, confirmation, receipt, execution-status | 체결·잔고 구독은 자동, 실제 주문 실행은 자동 금지 |
| `CC-03` | `instrument` | 종목·상품 | `chart`, `etf`, `elw`, `stock-info`, `quote`, `gold` | 88 | `quote`, `chart`, `profile`, `etf`, `elw`, `gold` | identity, quote-strip, visualization, metrics, fundamentals, product-detail, history-table | 주식·업종·ETF·ELW 등 mode 조건 충족 시 해당 feed 자동 등록; 미지원 영역은 snapshot |
| `CC-04` | `orderbook` | 호가 | `orderbook` | 31 | `regular`, `after-hours`, `gold`; `depth-5`, `depth-10` | market-header, best-quote, depth-ladder, trade-tape, imbalance, status | 카드 마운트와 target 확정 후 mode에 맞는 호가 feed 자동 등록 |
| `CC-05` | `flow` | 수급·포지션 | `program-trading`, `investor-flow`, `broker`, `credit-lending-short` | 50 | `program`, `investor`, `broker`, `credit`, `lending`, `short` | net-summary, participant-breakdown, trend, ranking-table, period-compare, risk-note | 지원되는 현재 종목·헤더 feed만 자동 등록; 잔고성 데이터는 snapshot |
| `CC-06` | `explorer` | 탐색·목록 | `sector`, `discovery`, `watchlist`, `theme`, `market-status`, `condition-search` | 42 | `sector`, `ranking`, `watchlist`, `theme`, `market-status`, `condition-search` | query-controls, market-state, result-table, compare, selection-detail, subscription-status | 화면 표시 행과 활성 조건만 상한 내 자동 등록; 비가시 행은 해제 |
|  |  | **합계** | **19 Capability** | **299** |  |  |  |

## 5. 19 Capability → 6 카드 매핑

| # | `capability_id` | operation | `card_id` | `card_kind` |
|---:|---|---:|---|---|
| 1 | `account` | 76 | `CC-01` | `account` |
| 2 | `order` | 12 | `CC-02` | `order` |
| 3 | `chart` | 21 | `CC-03` | `instrument` |
| 4 | `orderbook` | 31 | `CC-04` | `orderbook` |
| 5 | `program-trading` | 9 | `CC-05` | `flow` |
| 6 | `etf` | 10 | `CC-03` | `instrument` |
| 7 | `elw` | 22 | `CC-03` | `instrument` |
| 8 | `sector` | 16 | `CC-06` | `explorer` |
| 9 | `investor-flow` | 16 | `CC-05` | `flow` |
| 10 | `broker` | 16 | `CC-05` | `flow` |
| 11 | `discovery` | 10 | `CC-06` | `explorer` |
| 12 | `credit-lending-short` | 9 | `CC-05` | `flow` |
| 13 | `stock-info` | 21 | `CC-03` | `instrument` |
| 14 | `watchlist` | 8 | `CC-06` | `explorer` |
| 15 | `quote` | 9 | `CC-03` | `instrument` |
| 16 | `gold` | 5 | `CC-03` | `instrument` |
| 17 | `theme` | 2 | `CC-06` | `explorer` |
| 18 | `market-status` | 2 | `CC-06` | `explorer` |
| 19 | `condition-search` | 4 | `CC-06` | `explorer` |
|  | **합계** | **299** | **6 cards** | **6 kinds** |

## 6. 호출·갱신 계약

Selector는 299 operation이나 시각 컴포넌트를 직접 고르지 않는다. 최소 출력은 다음 논리 필드다.

| 필드 | 설명 |
|---|---|
| `capability_id` | 19개 backend Capability 중 하나 |
| `card_id` | Capability에서 결정적으로 도출한 canonical ID `CC-01`~`CC-06` 중 하나 |
| `card_kind` | 사람이 읽는 semantic slug; `account`, `order`, `instrument`, `orderbook`, `flow`, `explorer` 중 하나 |
| `target` | 종목, 계좌, 시장, 조건식 등 정규화된 대상 |
| `mode` | 카드 내부 데이터셋·업무 모드 |
| `section` | 최초로 포커스하거나 갱신할 내부 영역 |
| `parameters` | 기간, 주기, 정렬, 시장 구분 등 입력 |

Card instance는 최소한 `conversation_id + card_id + normalized target identity`로 식별한다. 동일 identity에 대한 후속 호출은 다음 순서를 따른다.

1. 기존 instance가 없으면 루트 카드 하나를 마운트한다.
2. snapshot을 section별로 채운다.
3. mode가 실시간 조건을 만족하면 서버가 subscription lease를 자동 생성한다.
4. live event는 operation별 새 카드를 만들지 않고 같은 section의 row·cell·series를 갱신한다.
5. target이 달라지면 기존 lease를 해제하거나 refcount를 조정하고 새 identity를 연결한다.

한 질문이 서로 다른 루트 업무를 명시적으로 요구할 때만 복수 카드가 허용된다. 예를 들어 “삼성전자 차트와 내 계좌 잔고를 같이 보여줘”는 `CC-03` (`instrument`)와 `CC-01` (`account`) 두 카드다. 한 Capability가 여러 operation을 사용한다는 이유로 카드 수를 늘리면 안 된다.

## 7. 실시간 불변식

- 실시간 지원 여부는 LLM 판단이 아니라 Capability mode 계약이 결정한다.
- `CC-04` (`orderbook`)는 target과 mode가 확정되면 해당 호가 feed를 자동 등록한다.
- `CC-01` (`account`), `CC-03` (`instrument`), `CC-05` (`flow`), `CC-06` (`explorer`)는 필요한 section과 가시 범위가 활성화될 때 자동 등록한다.
- 동일 physical subscription은 여러 카드·section이 공유할 수 있으며 refcount로 관리한다.
- snapshot이 실패하면 무조건 신규 구독을 만들지 않는다. 마지막 정상 snapshot과 section 오류 상태를 분리한다.
- 연결 중, stale, 재연결, 부분 실패 상태를 루트 카드 status band에 표시한다.

## 8. 주문 안전 경계

`CC-02` (`order`) 카드는 다른 카드와 동일하게 한 루트 표면을 사용하지만 mutation 경계는 합치지 않는다.

```text
draft 작성
  → 주문 preview를 같은 CC-02 카드에 렌더
  → 사용자 명시적 confirmation
  → Idempotency-Key 검증
  → 12개 주문 operation 중 하나 실행
  → receipt/status section 갱신
```

- 카드 마운트나 실시간 자동 등록은 주문 실행 권한이 아니다.
- confirmation 전에는 broker mutation을 호출하지 않는다.
- 재시도는 같은 idempotency key를 사용한다.
- 결과가 불명확하면 성공으로 추정하지 않고 `in_doubt` 상태를 유지한다.

## 9. 데이터 무손실 기준과 coverage guard

6개 카드가 299개 operation을 소유한다는 사실과 모든 field가 의미 있게 렌더된다는 사실은 별도 검증 대상이다.

### Operation coverage

- card count = 6
- capability count = 19
- assigned operation = 299
- unassigned operation = 0
- duplicated operation = 0
- 각 Capability는 정확히 하나의 `card_id`에만 속한다.
- 각 operation은 정확히 하나의 Capability에만 속한다.

### Field occurrence coverage

- raw response field occurrence = 3,705
- unique `(mapping_id, json_path)` = 3,703
- `base:ka10173`의 `$.trnm`, `$.data` 중복 occurrence는 ordinal로 보존한다.
- field registry가 unique path만 key로 사용해 두 occurrence를 덮어쓰면 실패한다.

### Semantic render coverage

각 semantic field는 `card_id + mode + section + component/column/detail-sheet`에 도달해야 한다. 현재 `951`, `924`, `1279`는 공식 의미가 확인되지 않아 임의의 UI label을 붙이지 않는다. 따라서 현재 상태는 operation coverage 완료, semantic render coverage 미완료이며 field coverage의 `release_ready=false`를 유지한다.

Release gate는 다음 조건을 모두 만족할 때만 열린다.

```text
6/6 cards
19/19 capabilities
299/299 operations
3,705/3,705 field occurrences preserved
unresolved semantic alias 0
semantic rendered / semantic total 100%
```

## 10. 구현 순서

1. **완료:** 19 Capability ledger 위에 `capability_id → card_id` 6-card registry projection을 추가하고 테스트한다.
2. **완료:** Athena Paper page `7-2` `통합 카드`에 overview와 6개 기준 artboard를 반영한다.
3. canonical mode·section allowlist를 카드별로 고정하고 잘못된 조합을 fail closed 처리한다.
4. Selector plan과 Canvas mount key·same-instance section update를 연결한다.
5. `CC-04` (`orderbook`)와 `CC-03` (`instrument`)를 canary로 전환해 카드 분절 방지와 live update를 검증한다.
6. `CC-01` (`account`), `CC-05` (`flow`), `CC-06` (`explorer`)를 전환한다.
7. `CC-02` (`order`)를 draft·confirmation·idempotency 회귀 테스트와 함께 전환한다.
8. field registry를 6-card destination까지 연결하고 alias blocker를 해소한다.
9. Paper 6개 기준 artboard와 실제 Runtime capture를 비교한다.

## 11. 완료 정의

- Selector가 299 operation이나 내부 KPI 컴포넌트를 카드로 직접 노출하지 않는다.
- 19 Capability가 정확히 6개 카드에 귀속되고 합계가 299다.
- 한 호출은 루트 카드 하나를 만들거나 같은 instance의 section 하나 이상을 갱신한다.
- 호가, 밸류에이션, 수급 지표가 nested mini-card로 분절되지 않는다.
- 지원 mode의 실시간이 별도 사용자 명령 없이 자동 등록되고 수명주기가 정리된다.
- 주문은 draft → confirmation → idempotent execution 경계를 유지한다.
- response field occurrence와 semantic render coverage가 release gate를 통과한다.
- Paper artboard와 실제 Canvas capture가 카드별 기본·loading·error·live·stale 상태에서 일치한다.
