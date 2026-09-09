# 모의투자가 지원하지 않는 조회 — 실측 목록과 근거 (2026-09-09)

로컬 백엔드(`127.0.0.1:8010`)를 통해 키움 **모의투자** 서버
`https://mockapi.kiwoom.com`로 조회 op를 하나씩 실제로 불러 적었다. 요청 본문은
화면 기본값표(`backend/ref/hydrate-argument-defaults.json`)가 채운 것이고, 조회
대상은 종류별 표(`backend/ref/probe-instrument-targets.json`)가 고른 것이다 —
이번 실행은 {"stock": "005930", "elw": "52M504", "etf": "153270_AL", "gold": "M04020000"}.

**주문 op와 websocket op는 부르지 않았다.** 모의 계좌라도 주문을 내지 않는다 —
검사기가 주문을 만들면 그 계좌의 잔고와 미체결이 바뀌어 다른 검사의 전제가 흔들린다.

판정별 수: `mock_unsupported` 27, `needs_arguments` 4, `supported` 233.
재현: `python scripts/card-api-sweep/probe_mock_support.py`
(산출물 `app/captures/card-api-sweep/MOCK-SUPPORT.json`).

## 1. 모의투자 미지원 — 응답이 그렇게 말한 조회

이 자리는 코드로 닫을 수 없다. 실계좌 자격으로 같은 검사기를 돌리면 그때 판정 대상이 된다.

| TR | 이름 | 요청 본문(입력) | 응답 본문(출력) | 쓰는 카드 보드 |
|---|---|---|---|---|
| `base:ka01690` | 일별잔고수익률 | `{"qry_dt": "20260909"}` | `{"return_code": 2, "return_msg": "입력 값 오류입니다[8104:모의투자에서 지원하지 않는 API 입니다.]"}` | 133H-2, 2SCE-1, 2SKU-1, 2SRV-1, 2SYW-1, 3GRO-0, 3IGR-0, 3K7K-0, 3LGC-0, 3MTJ-0, 3NVG-0, 3UTA-0 |
| `base:kt00002` | 일별추정예탁자산현황요청 | `{"start_dt": "20260810", "end_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 2SRV-1, 3K7K-0, 3UTA-0 |
| `base:kt00015` | 위탁종합거래내역요청 | `{"strt_dt": "20260810", "end_dt": "20260909", "tp": "0", "gds_tp": "0", "dmst_stex_tp": "KRX", "stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SCE-1, 2SKU-1, 2SRV-1, 3LGC-0, 3MTJ-0, 3UTA-0 |
| `base:kt20016` | 신용융자 가능종목요청 | `{"mrkt_deal_tp": "%", "stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2S4E-1, 31OF-0 |
| `base:kt20017` | 신용융자 가능문의 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 31OF-0 |
| `base:kt50021` | 금현물 예수금 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 2SYW-1, 3K7K-0, 3NVG-0, 3UTA-0 |
| `detail:kt00005:cash_and_capacity` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SCE-1, 2SKU-1, 2SRV-1, 2SYW-1, 3GRO-0, 3IGR-0, 3K7K-0, 3LGC-0, 3MTJ-0, 3NVG-0, 3UTA-0 |
| `detail:kt00005:credit_and_collateral` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3UTA-0 |
| `detail:kt00005:margin_order_capacity` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | — |
| `detail:kt00005:portfolio_summary` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 133H-2, 2SCE-1 |
| `detail:kt00005:receivables_and_margin` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 3K7K-0, 3UTA-0 |
| `detail:kt00005:settled_positions` | 체결잔고요청 | `{"dmst_stex_tp": "KRX"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SCE-1 |
| `detail:kt00012:account_and_receivable_capacity` | 신용보증금율별주문가능수량조회요청 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 3GRO-0 |
| `detail:kt00012:guarantee_order_capacity` | 신용보증금율별주문가능수량조회요청 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3GRO-0 |
| `detail:kt00012:guarantee_rate` | 신용보증금율별주문가능수량조회요청 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1 |
| `detail:kt00016:account_manager` | 일별계좌수익률상세현황요청 | `{"fr_dt": "20260810", "to_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 133H-2, 2SRV-1, 3K7K-0 |
| `detail:kt00016:asset_balance_change` | 일별계좌수익률상세현황요청 | `{"fr_dt": "20260810", "to_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3K7K-0 |
| `detail:kt00016:liability_balance_change` | 일별계좌수익률상세현황요청 | `{"fr_dt": "20260810", "to_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3K7K-0 |
| `detail:kt00016:performance_summary` | 일별계좌수익률상세현황요청 | `{"fr_dt": "20260810", "to_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SCE-1, 2SRV-1, 3K7K-0 |
| `detail:kt00016:period_flows` | 일별계좌수익률상세현황요청 | `{"fr_dt": "20260810", "to_dt": "20260909"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 2SRV-1, 3K7K-0 |
| `detail:kt00017:d2_account_position` | 계좌별당일현황요청 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 3MTJ-0 |
| `detail:kt00017:daily_cash_and_trading_flows` | 계좌별당일현황요청 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 2SRV-1, 3MTJ-0, 3NVG-0 |
| `detail:kt00017:other_assets_and_income` | 계좌별당일현황요청 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 2SKU-1, 3K7K-0, 3UTA-0 |
| `detail:kt50020:gold_account_summary` | 금현물 잔고확인 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3ODO-0 |
| `detail:kt50020:gold_holdings` | 금현물 잔고확인 | `{}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3ODO-0 |
| `detail:kt50032:account_identity` | 금현물 거래내역조회 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3ODO-0 |
| `detail:kt50032:gold_trade_history` | 금현물 거래내역조회 | `{"stk_cd": "005930"}` | `{"return_code": 20, "return_msg": "[2000](RC9000:모의투자에서는 해당업무가 제공되지 않습니다.)"}` | 3ODO-0 |

## 2. 업무 오류 — 모의투자 한계가 아닌 거부

인자가 이 계좌·이 종목에 맞지 않아 상류가 거부한 자리다. 인자를 고치면 닫힌다.

| TR | 이름 | 요청 본문 | 응답 문면 |
|---|---|---|---|
| — | 없다 | — | 이번 실행에서 모의투자 한계가 아닌 업무 거부는 없었다 |

## 3. 부르지 못한 조회 — 필수 인자를 못 채웠다

화면이 주지 않은 조회 대상(주문번호 등)이 필요한 자리다. 값을 지어내지 않으므로 부르지 않는다.

| TR | 이름 | 모자란 인자 |
|---|---|---|
| `base:ka10088` | 미체결 분할주문 상세 | `[{"type": "missing", "loc": ["body", "ord_no"], "msg": "Field required", "input": {}}]` |
| `detail:kt00010:cash_and_withdrawal_capacity` | 주문인출가능금액요청 | `[{"type": "missing", "loc": ["body", "uv"], "msg": "Field required", "input": {"trde_tp": "1", "stk_cd": "005930"}}]` |
| `detail:kt00010:margin_order_capacity` | 주문인출가능금액요청 | `[{"type": "missing", "loc": ["body", "uv"], "msg": "Field required", "input": {"trde_tp": "1", "stk_cd": "005930"}}]` |
| `detail:kt00010:purchase_settlement` | 주문인출가능금액요청 | `[{"type": "missing", "loc": ["body", "uv"], "msg": "Field required", "input": {"trde_tp": "1", "stk_cd": "005930"}}]` |
