# 카드 표면 템플릿 — occurrence 바인딩·저작 현황

생성: 2026-09-03T16:11+09:00 · 템플릿 `backend/ref/card-surface-templates` · 재생성 `PYTHONIOENCODING=utf-8 python scripts/card_surface_coverage.py`

바인딩 판정은 이 스크립트가 하지 않는다 — `athena_api.card_surface_templates` 로더에 위임한다. 대체 바인딩(`alt_mappings`)·지시 열(`indexed`)·되풀이 행 반복 면제를 로더만 알기 때문이다. 판정 단위도 로더와 같은 **occurrence**(`wire_occurrence_id`)이고, 원장의 `(mapping_id, f)` 행이 아니다.

로드 경로 `load_registry(strict=False)` · 도달 집합 `registry.coverage()` · 보드 96장 로드(색인 96 · 디렉터리 97) · `complete` 미선언(부분 로드)

## 총괄 — occurrence 도달 **3,382/3,532 (95.8%)** · op 커버 **297/299**

| 항목 | 값 | 판정 근거 |
| --- | ---: | --- |
| 가시 occurrence 도달 | 3,382/3,532 | 로더 `coverage()` (대체 바인딩 포함) |
| 미도달 occurrence | 150 | 어느 보드도 그리지 않는 자리 |
| 보드 없는 op | 2 | `by_operation`에 없는 op |
| 밀도 하드 위반 | 0 | 로더 `DENSITY_BUDGET`·`HEIGHT_BUDGET_PX` |
| 밀도 소프트 경고 | 22 | 로더 `SOFT_DENSITY_BUDGET` |
| 중복 바인딩 | 0 | 로더 `_duplicate_is_declared` 미면제분 |
| 그 밖의 보드 문제 | 0 | 해시·상태 참조·지시 열 패턴 |
| 재표시 경고 | 127 | 주값 없는 재표시 무리(로드는 통과) |
| 문제 없는 보드 | 96/96 | 보드 지역 규칙 전부 통과 |
| 제외 보드 | 2 | 디렉터리·색인·원장 대조 |

## 1. occurrence 도달 — 카드별

| 카드 | 가시 occurrence | 도달 | 도달률 |
| --- | ---: | ---: | ---: |
| CC-01 계좌 | 899 | 801 | 89.1% |
| CC-02 주문 | 30 | 30 | 100.0% |
| CC-03 종목·상품 | 1,012 | 1,006 | 99.4% |
| CC-04 호가 | 425 | 421 | 99.1% |
| CC-05 수급 | 691 | 666 | 96.4% |
| CC-06 탐색 | 475 | 458 | 96.4% |
| **합계** | **3,532** | **3,382** | **95.8%** |

## 2. occurrence 도달 — 층별

층은 그것을 그리는 슬롯이 선언한 값이다(`슬롯 판정 층`). 미도달이라 슬롯이 없으면 원장 `layer`, 그것도 없으면 미상.

| 층 | 가시 occurrence | 도달 | 도달률 | 슬롯 판정 층 |
| --- | ---: | ---: | ---: | ---: |
| 직접 | 2,588 | 2,573 | 99.4% | 2,573 |
| 병기 | 253 | 232 | 91.7% | 232 |
| 펼침 | 577 | 577 | 100.0% | 577 |
| 미상 | 114 | 0 | 0.0% | 0 |

## 3. 미도달 occurrence (150)

어느 보드에도 자리가 없는 가시 occurrence 전량이다. 로더 strict 검증이 `visible occurrences reach no board`로 막는 바로 그 집합.

이 중 **68건**은 원장이 트리 밖 보드(`17F8-2` 68)에만 귀속한 자리다 — 원장의 `board`를 카드 보드로 재귀속해야 슬롯이 생긴다. 트리 밖 보드에 귀속된 원장 행 전부가 아니라 **미도달인 것만** 센다.

| occurrence | op | f | 한글 | 카드 | 층 | 원장 귀속 보드 |
| --- | --- | --- | --- | --- | --- | --- |
| `base:00\|$.data[].2135\|1` | `base:00` | `2135` | 거래소구분명 | CC-01 | 병기 | `2SYW-1` |
| `base:00\|$.data[].901\|1` | `base:00` | `901` | 주문가격 | CC-01 | 미상 | `2SYW-1` |
| `base:00\|$.data[].907\|1` | `base:00` | `907` | 매도수구분 | CC-01 | 미상 | `2SYW-1` |
| `base:00\|$.data[].912\|1` | `base:00` | `912` | 주문업무분류 | CC-01 | 병기 | `2SYW-1` |
| `base:00\|$.data[].913\|1` | `base:00` | `913` | 주문상태 | CC-01 | 미상 | `2SYW-1` |
| `base:00\|$.data[].915\|1` | `base:00` | `915` | 단위체결량 | CC-01 | 병기 | `2SYW-1` |
| `base:00\|$.data[].922\|1` | `base:00` | `922` | 신용구분 | CC-01 | 병기 | `2SYW-1` |
| `base:04\|$.data[].946\|1` | `base:04` | `946` | 매도/매수구분 | CC-01 | 미상 | `2SYW-1` |
| `base:0D\|$.data[].6111\|1` | `base:0D` | `6111` | KRX중간가대비 기호 | CC-04 | 직접 | `3JZ3-0` |
| `base:0D\|$.data[].6114\|1` | `base:0D` | `6114` | NXT중간가대비 기호 | CC-04 | 직접 | `3JZ3-0` |
| `base:0w\|$.data[].11\|1` | `base:0w` | `11` | 전일대비 | CC-05 | 미상 | `2QM7-2` |
| `base:1h\|$.data[].9075\|1` | `base:1h` | `9075` | 장전구분 | CC-06 | 병기 | `2UHM-1` |
| `base:ka01690\|$.day_bal_rt[].buy_wght\|1` | `base:ka01690` | `buy_wght` | 현금비중 | CC-01 | 병기 | `2SCE-1` |
| `base:ka10006\|$.cntr_str\|1` | `base:ka10006` | `cntr_str` | 체결강도 | CC-03 | 미상 | `2R3M-1` |
| `base:ka10008\|$.stk_frgnr[].trde_qty\|1` | `base:ka10008` | `trde_qty` | 거래량 | CC-05 | 직접 | `2ZTA-0` |
| `base:ka10011\|$.newstk_recvrht_mrpr[].high_pric\|1` | `base:ka10011` | `high_pric` | 고가 | CC-03 | 직접 | `32XM-0` |
| `base:ka10011\|$.newstk_recvrht_mrpr[].low_pric\|1` | `base:ka10011` | `low_pric` | 저가 | CC-03 | 직접 | `32XM-0` |
| `base:ka10021\|$.bid_req_sdnin[].now\|1` | `base:ka10021` | `now` | 현재 | CC-06 | 병기 | `2YA8-0` |
| `base:ka10022\|$.req_rt_sdnin[].now_rt\|1` | `base:ka10022` | `now_rt` | 현재비율 | CC-06 | 병기 | `2YEQ-0` |
| `base:ka10023\|$.trde_qty_sdnin[].now_trde_qty\|1` | `base:ka10023` | `now_trde_qty` | 현재거래량 | CC-06 | 병기 | `2YJ8-0` |
| `base:ka10025\|$.prps_cnctr[].pred_pre_sig\|1` | `base:ka10025` | `pred_pre_sig` | 전일대비기호 | CC-03 | 미상 | `30O1-0` |
| `base:ka10027\|$.pred_pre_flu_rt_upper[].cnt\|1` | `base:ka10027` | `cnt` | 횟수 | CC-06 | 미상 | `2XKO-0` |
| `base:ka10029\|$.exp_cntr_flu_rt_upper[].pred_pre_sig\|1` | `base:ka10029` | `pred_pre_sig` | 전일대비기호 | CC-06 | 미상 | `2XP6-0` |
| `base:ka10034\|$.for_dt_trde_upper[].gain_pos_stkcnt\|1` | `base:ka10034` | `gain_pos_stkcnt` | 취득가능주식수 | CC-05 | 미상 | `2ZTA-0` |
| `base:ka10035\|$.for_cont_nettrde_upper[].stk_nm\|1` | `base:ka10035` | `stk_nm` | 종목명 | CC-05 | 미상 | `1WOB-1` |
| `base:ka10036\|$.for_limit_exh_rt_incrs_upper[].pred_pre_sig\|1` | `base:ka10036` | `pred_pre_sig` | 전일대비기호 | CC-05 | 미상 | `2ZTA-0` |
| `base:ka10039\|$.sec_trde_upper\|1` | `base:ka10039` | `sec_trde_upper` | 증권사별매매상위 | CC-05 | 미상 | `30TY-0` |
| `base:ka10043\|$.trde_ori_prps_anly[].trde_qty_sum\|1` | `base:ka10043` | `trde_qty_sum` | 거래량합 | CC-05 | 직접 | `2QM7-2` |
| `base:ka10046\|$.cntr_str_tm[].trde_qty\|1` | `base:ka10046` | `trde_qty` | 거래량 | CC-03 | 미상 | `2R3M-1` |
| `base:ka10051\|$.inds_netprps[].orgn_netprps\|1` | `base:ka10051` | `orgn_netprps` | 기관계순매수 | CC-06 | 미상 | `2TZN-1` |
| `base:ka10052\|$.trde_ori_mont_trde_qty[].pred_pre\|1` | `base:ka10052` | `pred_pre` | 전일대비 | CC-05 | 미상 | `2QM7-2` |
| `base:ka10058\|$.invsr_daly_trde_stk[].pre_rt\|1` | `base:ka10058` | `pre_rt` | 대비율 | CC-05 | 병기 | `3063-0` |
| `base:ka10058\|$.invsr_daly_trde_stk[].pre_sig\|1` | `base:ka10058` | `pre_sig` | 대비기호 | CC-05 | 미상 | `3063-0` |
| `base:ka10062\|$.eql_nettrde_rank[].flu_rt\|1` | `base:ka10062` | `flu_rt` | 등락율 | CC-05 | 미상 | `31CL-0` |
| `base:ka10062\|$.eql_nettrde_rank[].pre_sig\|1` | `base:ka10062` | `pre_sig` | 대비기호 | CC-05 | 미상 | `31CL-0` |
| `base:ka10063\|$.opmr_invsr_trde[].flu_rt\|1` | `base:ka10063` | `flu_rt` | 등락율 | CC-05 | 미상 | `3063-0` |
| `base:ka10063\|$.opmr_invsr_trde[].pre_sig\|1` | `base:ka10063` | `pre_sig` | 대비기호 | CC-05 | 미상 | `3063-0` |
| `base:ka10075\|$.oso[].cntr_pric\|1` | `base:ka10075` | `cntr_pric` | 체결가 | CC-01 | 미상 | `2SYW-1` |
| `base:ka10075\|$.oso[].cntr_qty\|1` | `base:ka10075` | `cntr_qty` | 체결량 | CC-01 | 미상 | `2SYW-1` |
| `base:ka10075\|$.oso[].stex_tp_txt\|1` | `base:ka10075` | `stex_tp_txt` | 거래소구분텍스트 | CC-01 | 병기 | `2SYW-1` |
| `base:ka10075\|$.oso[].trde_tp\|1` | `base:ka10075` | `trde_tp` | 매매구분 | CC-01 | 미상 | `2SYW-1` |
| `base:ka10075\|$.oso[].unit_cntr_qty\|1` | `base:ka10075` | `unit_cntr_qty` | 단위체결량 | CC-01 | 병기 | `2SYW-1` |
| `base:ka10076\|$.cntr[].sor_yn\|1` | `base:ka10076` | `sor_yn` | SOR 여부값 | CC-01 | 직접 | `2SYW-1` |
| `base:ka10076\|$.cntr[].stex_tp_txt\|1` | `base:ka10076` | `stex_tp_txt` | 거래소구분텍스트 | CC-01 | 병기 | `2SYW-1` |
| `base:ka10076\|$.cntr[].trde_tp\|1` | `base:ka10076` | `trde_tp` | 매매구분 | CC-01 | 미상 | `2SYW-1` |
| `base:ka10078\|$.sec_stk_trde_trend[].pre_sig\|1` | `base:ka10078` | `pre_sig` | 대비기호 | CC-05 | 미상 | `30TY-0` |
| `base:ka10084\|$.tdy_pred_cntr[].cntr_trde_qty\|1` | `base:ka10084` | `cntr_trde_qty` | 체결거래량 | CC-03 | 직접 | `2R3M-1` |
| `base:ka10088\|$.osop[].sell_tp\|1` | `base:ka10088` | `sell_tp` | 매도/수 구분 | CC-01 | 미상 | `2SYW-1` |
| `base:ka10088\|$.osop[].stex_tp_txt\|1` | `base:ka10088` | `stex_tp_txt` | 거래소구분텍스트 | CC-01 | 병기 | `2SYW-1` |
| `base:ka10098\|$.ovt_sigpric_flu_rt_rank[].pred_pre_sig\|1` | `base:ka10098` | `pred_pre_sig` | 전일대비기호 | CC-06 | 미상 | `2YNQ-0` |
| `base:ka10098\|$.ovt_sigpric_flu_rt_rank[].tdy_close_pric_flu_rt\|1` | `base:ka10098` | `tdy_close_pric_flu_rt` | 당일종가등락률 | CC-06 | 미상 | `2YNQ-0` |
| `base:ka10099\|$.list[].nxtEnable\|1` | `base:ka10099` | `nxtEnable` | NXT가능여부 | CC-06 | 직접 | `13K0-2` |
| `base:ka10100\|$.nxtEnable\|1` | `base:ka10100` | `nxtEnable` | NXT가능여부 | CC-06 | 직접 | `13K0-2` |
| `base:ka10172\|$.data[].25\|1` | `base:ka10172` | `25` | 전일대비기호 | CC-06 | 미상 | `15L8-2` |
| `base:ka20002\|$.inds_stkpc[].flu_rt\|1` | `base:ka20002` | `flu_rt` | 등락률 | CC-06 | 미상 | `15J9-2` |
| `base:ka20002\|$.inds_stkpc[].low_pric\|1` | `base:ka20002` | `low_pric` | 저가 | CC-06 | 직접 | `15J9-2` |
| `base:ka20002\|$.inds_stkpc[].pred_pre_sig\|1` | `base:ka20002` | `pred_pre_sig` | 전일대비기호 | CC-06 | 미상 | `15J9-2` |
| `base:ka52301\|$.inve_trad_stat[].all_dfrt_trst_netprps_qty\|1` | `base:ka52301` | `all_dfrt_trst_netprps_qty` | 투자자별 순매수 수량(천) | CC-05 | 미상 | `2RJ7-1` |
| `base:ka90001\|$.thema_grp[].flu_sig\|1` | `base:ka90001` | `flu_sig` | 등락기호 | CC-06 | 미상 | `2UBO-1` |
| `base:ka90002\|$.thema_comp_stk[].flu_sig\|1` | `base:ka90002` | `flu_sig` | 등락기호 | CC-06 | 미상 | `2UBO-1` |
| `base:ka90005\|$.prm_trde_trnsn[].all_buy\|1` | `base:ka90005` | `all_buy` | 전체매수 | CC-05 | 직접 | `2ROJ-1` |
| `base:ka90005\|$.prm_trde_trnsn[].all_netprps\|1` | `base:ka90005` | `all_netprps` | 전체순매수 | CC-05 | 미상 | `2ROJ-1` |
| `base:ka90005\|$.prm_trde_trnsn[].all_sel\|1` | `base:ka90005` | `all_sel` | 전체매도 | CC-05 | 직접 | `2ROJ-1` |
| `base:ka90007\|$.prm_trde_acc_trnsn[].all_acc\|1` | `base:ka90007` | `all_acc` | 전체누적 | CC-05 | 미상 | `2ROJ-1` |
| `base:ka90008\|$.stk_tm_prm_trde_trnsn[].prm_netprps_amt_irds\|1` | `base:ka90008` | `prm_netprps_amt_irds` | 프로그램순매수금액증감 | CC-05 | 직접 | `2ROJ-1` |
| `base:ka90009\|$.frgnr_orgn_trde_upper[].for_netprps_stk_cd\|1` | `base:ka90009` | `for_netprps_stk_cd` | 외인순매수종목코드 | CC-05 | 미상 | `30HY-0` |
| `base:ka90009\|$.frgnr_orgn_trde_upper[].orgn_netprps_stk_cd\|1` | `base:ka90009` | `orgn_netprps_stk_cd` | 기관순매수종목코드 | CC-05 | 미상 | `30HY-0` |
| `base:kt00007\|$.acnt_ord_cntr_prps_dtl[].cntr_qty\|1` | `base:kt00007` | `cntr_qty` | 체결수량 | CC-01 | 미상 | `2SYW-1` |
| `base:kt00007\|$.acnt_ord_cntr_prps_dtl[].crd_tp\|1` | `base:kt00007` | `crd_tp` | 신용구분 | CC-01 | 병기 | `2SYW-1` |
| `base:kt50021\|$.entra\|1` | `base:kt50021` | `entra` | 예수금 | CC-01 | 미상 | `17F8-2` |
| `base:kt50021\|$.prsm_entra\|1` | `base:kt50021` | `prsm_entra` | 추정예수금 | CC-01 | 미상 | `17F8-2` |
| `base:kt50030\|$.acnt_ord_cntr_prst[].dcd_tp_nm\|1` | `base:kt50030` | `dcd_tp_nm` | 결제구분 | CC-01 | 미상 | `17F8-2` |
| `base:kt50030\|$.acnt_ord_cntr_prst[].mrkt_deal_tp\|1` | `base:kt50030` | `mrkt_deal_tp` | 시장구분 | CC-01 | 미상 | `17F8-2` |
| `base:kt50031\|$.acnt_ord_cntr_prps_dtl[].rsrv_tp\|1` | `base:kt50031` | `rsrv_tp` | 반대여부 | CC-01 | 병기 | `3OIM-0` |
| `base:kt50075\|$.acnt_ord_oso_prst[].dcd_tp_nm\|1` | `base:kt50075` | `dcd_tp_nm` | 결제구분 | CC-01 | 미상 | `17F8-2` |
| `base:kt50075\|$.acnt_ord_oso_prst[].mrkt_deal_tp\|1` | `base:kt50075` | `mrkt_deal_tp` | 시장구분 | CC-01 | 미상 | `17F8-2` |
| `detail:ka10002:market_snapshot\|$.pred_pre\|1` | `detail:ka10002:market_snapshot` | `pred_pre` | 전일대비 | CC-05 | 미상 | `2QM7-2` |
| `detail:ka10004:after_hours_totals\|$.ovt_buy_req\|1` | `detail:ka10004:after_hours_totals` | `ovt_buy_req` | 시간외매수잔량 | CC-04 | 미상 | `13BC-2` |
| `detail:ka10040:broker_departures\|$.tdy_main_trde_ori[].qry_dt\|1` | `detail:ka10040:broker_departures` | `qry_dt` | 조회일자 | CC-05 | 미상 | `1WOB-1` |
| `detail:ka10087:aggregate_totals\|$.ovt_buy_bid_tot_req\|1` | `detail:ka10087:aggregate_totals` | `ovt_buy_bid_tot_req` | 시간외매수호가총잔량 | CC-04 | 미상 | `13BC-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.100stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `100stk_ord_alow_amt` | 100%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.20stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `20stk_ord_alow_amt` | 20%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.30stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `30stk_ord_alow_amt` | 30%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.40stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `40stk_ord_alow_amt` | 40%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.50stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `50stk_ord_alow_amt` | 50%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00001:withdrawal_and_order_capacity\|$.60stk_ord_alow_amt\|1` | `detail:kt00001:withdrawal_and_order_capacity` | `60stk_ord_alow_amt` | 60%종목주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:cash_and_capacity\|$.ord_alowa\|1` | `detail:kt00005:cash_and_capacity` | `ord_alowa` | 주문가능현금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.100ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `100ord_alow_amt` | 100%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.20ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `20ord_alow_amt` | 20%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.30ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `30ord_alow_amt` | 30%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.40ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `40ord_alow_amt` | 40%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.50ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `50ord_alow_amt` | 50%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00005:margin_order_capacity\|$.60ord_alow_amt\|1` | `detail:kt00005:margin_order_capacity` | `60ord_alow_amt` | 60%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].cntr_qty\|1` | `detail:kt00009:order_execution_status` | `cntr_qty` | 체결수량 | CC-01 | 병기 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].dmst_stex_tp\|1` | `detail:kt00009:order_execution_status` | `dmst_stex_tp` | 국내거래소구분 | CC-01 | 병기 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].io_tp_nm\|1` | `detail:kt00009:order_execution_status` | `io_tp_nm` | 주문유형구분 | CC-01 | 병기 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].ord_qty\|1` | `detail:kt00009:order_execution_status` | `ord_qty` | 주문수량 | CC-01 | 미상 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].setl_tp\|1` | `detail:kt00009:order_execution_status` | `setl_tp` | 결제구분 | CC-01 | 병기 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].stk_bond_tp\|1` | `detail:kt00009:order_execution_status` | `stk_bond_tp` | 주식채권구분 | CC-01 | 병기 | `2SYW-1` |
| `detail:kt00009:order_execution_status\|$.acnt_ord_cntr_prst_array[].trde_tp\|1` | `detail:kt00009:order_execution_status` | `trde_tp` | 매매구분 | CC-01 | 미상 | `2SYW-1` |
| `detail:kt00010:cash_and_withdrawal_capacity\|$.entr\|1` | `detail:kt00010:cash_and_withdrawal_capacity` | `entr` | 예수금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:cash_and_withdrawal_capacity\|$.ord_pos_repl\|1` | `detail:kt00010:cash_and_withdrawal_capacity` | `ord_pos_repl` | 주문가능대용 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:cash_and_withdrawal_capacity\|$.pred_reu_alowa\|1` | `detail:kt00010:cash_and_withdrawal_capacity` | `pred_reu_alowa` | 전일재사용가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:cash_and_withdrawal_capacity\|$.repl_amt\|1` | `detail:kt00010:cash_and_withdrawal_capacity` | `repl_amt` | 대용금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_100ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_100ord_alow_amt` | 증거금100%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_20ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_20ord_alow_amt` | 증거금20%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_30ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_30ord_alow_amt` | 증거금30%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_40ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_40ord_alow_amt` | 증거금40%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_50ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_50ord_alow_amt` | 증거금50%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00010:margin_order_capacity\|$.profa_60ord_alow_amt\|1` | `detail:kt00010:margin_order_capacity` | `profa_60ord_alow_amt` | 증거금60%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_20_to_50\|$.profa_20ord_alow_amt\|1` | `detail:kt00011:margin_capacity_20_to_50` | `profa_20ord_alow_amt` | 증거금20%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_20_to_50\|$.profa_30ord_alow_amt\|1` | `detail:kt00011:margin_capacity_20_to_50` | `profa_30ord_alow_amt` | 증거금30%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_20_to_50\|$.profa_40ord_alow_amt\|1` | `detail:kt00011:margin_capacity_20_to_50` | `profa_40ord_alow_amt` | 증거금40%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_20_to_50\|$.profa_50ord_alow_amt\|1` | `detail:kt00011:margin_capacity_20_to_50` | `profa_50ord_alow_amt` | 증거금50%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_60_to_cash_only\|$.profa_100ord_alow_amt\|1` | `detail:kt00011:margin_capacity_60_to_cash_only` | `profa_100ord_alow_amt` | 증거금100%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00011:margin_capacity_60_to_cash_only\|$.profa_60ord_alow_amt\|1` | `detail:kt00011:margin_capacity_60_to_cash_only` | `profa_60ord_alow_amt` | 증거금60%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.entr\|1` | `detail:kt00012:account_and_receivable_capacity` | `entr` | 예수금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.ord_alowa\|1` | `detail:kt00012:account_and_receivable_capacity` | `ord_alowa` | 주문가능현금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.ord_pos_repl\|1` | `detail:kt00012:account_and_receivable_capacity` | `ord_pos_repl` | 주문가능대용 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.out_alowa\|1` | `detail:kt00012:account_and_receivable_capacity` | `out_alowa` | 미수가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.repl_amt\|1` | `detail:kt00012:account_and_receivable_capacity` | `repl_amt` | 대용금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:account_and_receivable_capacity\|$.uncla\|1` | `detail:kt00012:account_and_receivable_capacity` | `uncla` | 미수금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:guarantee_order_capacity\|$.assr_50ord_alow_amt\|1` | `detail:kt00012:guarantee_order_capacity` | `assr_50ord_alow_amt` | 보증금50%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00012:guarantee_order_capacity\|$.assr_60ord_alow_amt\|1` | `detail:kt00012:guarantee_order_capacity` | `assr_60ord_alow_amt` | 보증금60%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:cash_resources\|$.use_pos_ch\|1` | `detail:kt00013:cash_resources` | `use_pos_ch` | 사용가능현금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:credit_and_lending_collateral\|$.uncla\|1` | `detail:kt00013:credit_and_lending_collateral` | `uncla` | 미수금 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.100ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `100ord_alow_amt` | 100%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.20ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `20ord_alow_amt` | 20%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.30ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `30ord_alow_amt` | 30%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.40ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `40ord_alow_amt` | 40%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.50ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `50ord_alow_amt` | 50%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:margin_order_capacity\|$.60ord_alow_amt\|1` | `detail:kt00013:margin_order_capacity` | `60ord_alow_amt` | 60%주문가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:previous_day_reuse\|$.pred_reu_alowa\|1` | `detail:kt00013:previous_day_reuse` | `pred_reu_alowa` | 전일재사용가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:substitute_resources\|$.repl_amt_amt\|1` | `detail:kt00013:substitute_resources` | `repl_amt_amt` | 대용금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:substitute_resources\|$.repl_use_lmtt_amt\|1` | `detail:kt00013:substitute_resources` | `repl_use_lmtt_amt` | 대용사용제한금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:substitute_resources\|$.use_pos_repl\|1` | `detail:kt00013:substitute_resources` | `use_pos_repl` | 사용가능대용 | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:substitute_valuation_and_limits\|$.evlt_repl_amt_spg_use_skip\|1` | `detail:kt00013:substitute_valuation_and_limits` | `evlt_repl_amt_spg_use_skip` | 평가대용금(현물사용제외) | CC-01 | 미상 | `17F8-2` |
| `detail:kt00013:today_reuse\|$.tdy_reu_alowa\|1` | `detail:kt00013:today_reuse` | `tdy_reu_alowa` | 금일재사용가능금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].able_qty\|1` | `detail:kt50020:gold_holdings` | `able_qty` | 가능수량 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].buy_qty\|1` | `detail:kt50020:gold_holdings` | `buy_qty` | 매수수량 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].cmsn\|1` | `detail:kt50020:gold_holdings` | `cmsn` | 수수료 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].cur_prc\|1` | `detail:kt50020:gold_holdings` | `cur_prc` | 현재가 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].est_amt\|1` | `detail:kt50020:gold_holdings` | `est_amt` | 평가금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst[].vlad_tax\|1` | `detail:kt50020:gold_holdings` | `vlad_tax` | 부가가치세 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50020:gold_holdings\|$.gold_acnt_evlt_prst\|1` | `detail:kt50020:gold_holdings` | `gold_acnt_evlt_prst` | 금현물계좌평가현황 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50032:gold_trade_history\|$.gold_trde_hist[].deal_amt\|1` | `detail:kt50032:gold_trade_history` | `deal_amt` | 거래금액 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50032:gold_trade_history\|$.gold_trde_hist[].deal_dt\|1` | `detail:kt50032:gold_trade_history` | `deal_dt` | 거래일자 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50032:gold_trade_history\|$.gold_trde_hist[].gold_spot_vat\|1` | `detail:kt50032:gold_trade_history` | `gold_spot_vat` | 금현물부가가치세 | CC-01 | 미상 | `17F8-2` |
| `detail:kt50032:gold_trade_history\|$.gold_trde_hist[].proc_brch_nm\|1` | `detail:kt50032:gold_trade_history` | `proc_brch_nm` | 처리점 | CC-01 | 직접 | `3ODO-0` |
| `detail:kt50032:gold_trade_history\|$.gold_trde_hist[].spot_remn\|1` | `detail:kt50032:gold_trade_history` | `spot_remn` | 현물잔고 | CC-01 | 미상 | `17F8-2` |

## 4. 보드 없는 op (2)

op 299종 중 어느 보드도 `operation_refs`에 적지 않은 것. 로더 strict가 `operations have no board`로 막는다.

| op | 카드 | 가시 occurrence |
| --- | --- | ---: |
| `detail:kt00005:margin_order_capacity` | CC-01 | 6 |
| `detail:kt00013:margin_order_capacity` | CC-01 | 6 |

## 5. 제외 보드·사유 (2)

보드 모수는 로더가 실제로 세운 보드다. 아래는 그 밖으로 밀린 자리와 사유.

| 보드 | 사유 | 원장 가시 행 |
| --- | --- | ---: |
| `fixture-quote` | 테스트 픽스처·작업 디렉터리 — index.json 밖 | — |
| `17F8-2` | 증명 페이지 — 카드 보드가 아니라 트리 밖 | 105 |

## 6. 밀도 예산 — 하드 위반 (0)

로더 `DENSITY_BUDGET` + `HEIGHT_BUDGET_PX`. 위반은 strict 로드를 막는다.

없음.

## 7. 밀도 예산 — 소프트 경고 (22)

로더 `SOFT_DENSITY_BUDGET`. 넘어도 로드는 통과한다.

| 보드 | 경고 |
| --- | --- |
| `137X-2` | board '137X-2' density rail_rows_max=7 exceeds soft budget 6 |
| `13BC-2` | board '13BC-2' density rail_rows_max=11 exceeds soft budget 6 |
| `15P5-2` | board '15P5-2' density kpi_cells=8 exceeds soft budget 6 |
| `2QX1-1` | board '2QX1-1' density rail_rows_max=11 exceeds soft budget 6 |
| `2R3M-1` | board '2R3M-1' density rail_rows_max=7 exceeds soft budget 6 |
| `2SKU-1` | board '2SKU-1' density rail_rows_max=7 exceeds soft budget 6 |
| `2TRW-1` | board '2TRW-1' density rail_rows_max=11 exceeds soft budget 6 |
| `2TZN-1` | board '2TZN-1' density rail_rows_max=7 exceeds soft budget 6 |
| `2VO0-0` | board '2VO0-0' density rail_rows_max=7 exceeds soft budget 6 |
| `2XA5-0` | board '2XA5-0' density rail_rows_max=7 exceeds soft budget 6 |
| `2XY6-0` | board '2XY6-0' density rail_rows_max=7 exceeds soft budget 6 |
| `2Y47-0` | board '2Y47-0' density rail_rows_max=7 exceeds soft budget 6 |
| `2Z49-0` | board '2Z49-0' density rail_rows_max=7 exceeds soft budget 6 |
| `2ZBB-0` | board '2ZBB-0' density rail_rows_max=7 exceeds soft budget 6 |
| `30HY-0` | board '30HY-0' density rail_rows_max=7 exceeds soft budget 6 |
| `30TY-0` | board '30TY-0' density rail_rows_max=8 exceeds soft budget 6 |
| `31CL-0` | board '31CL-0' density rail_rows_max=7 exceeds soft budget 6 |
| `31OF-0` | board '31OF-0' density rail_rows_max=7 exceeds soft budget 6 |
| `3DZ1-0` | board '3DZ1-0' density kpi_cells=8 exceeds soft budget 6 |
| `3ODO-0` | board '3ODO-0' density rail_rows_max=7 exceeds soft budget 6 |
| `3OIM-0` | board '3OIM-0' density rail_rows_max=7 exceeds soft budget 6 |
| `3TOM-0` | board '3TOM-0' density rail_rows_max=7 exceeds soft budget 6 |

## 8. 중복 바인딩 (0)

한 보드가 같은 occurrence를 여러 자리에 넣은 것 중 **로더가 면제하지 않은** 것만이다. 행 반복(표 한 열·되풀이 블록)·D4 병기(`paired_with`)·선언된 재표시(`display_dup`)는 면제라 여기 없다.

없음.

## 9. 그 밖의 보드 문제 (0)

해시 대조 · 상태 참조 · 지시 열 패턴 등 로더의 보드 지역 규칙.

없음.

## 10. 보드별 저작 상태 (96장)

| 보드 | 카드 | 상태 | 원문 | 추출 | 바인딩 슬롯 | 도달 occurrence | 문제 |
| --- | --- | --- | :-: | :-: | ---: | ---: | ---: |
| `133H-2` | CC-01 | default | ● | ● | 130 | 60 | 0 |
| `135M-2` | CC-02 | default | ● | ● | 3 | 3 | 0 |
| `137X-2` | CC-03 | default | ● | ● | 63 | 150 | 0 |
| `13BC-2` | CC-04 | default | ● | ● | 114 | 112 | 0 |
| `13K0-2` | CC-06 | default | ● | ● | 94 | 53 | 0 |
| `15J9-2` | CC-06 | default | ● | ● | 28 | 10 | 0 |
| `15L8-2` | CC-06 | default | ● | ● | 73 | 10 | 0 |
| `15N5-2` | CC-03 | default | ● | ● | 93 | 97 | 0 |
| `15P5-2` | CC-03 | default | ● | ● | 147 | 155 | 0 |
| `15R0-2` | CC-06 | default | ● | ● | 53 | 27 | 0 |
| `1JPU-0` | CC-04 | default | ● | ● | 213 | 121 | 0 |
| `1JZW-0` | CC-04 | default | ● | ● | 214 | 99 | 0 |
| `1WOB-1` | CC-05 | default | ● | ● | 234 | 15 | 0 |
| `2QFO-2` | CC-05 | tab | ● | ● | 96 | 53 | 0 |
| `2QM7-2` | CC-05 | tab | ● | ● | 135 | 189 | 0 |
| `2QRP-1` | CC-04 | tab | ● | ● | 44 | 53 | 0 |
| `2QX1-1` | CC-04 | tab | ● | ● | 79 | 16 | 0 |
| `2R3M-1` | CC-03 | tab | ● | ● | 172 | 152 | 0 |
| `2RBO-1` | CC-03 | tab | ● | ● | 48 | 48 | 0 |
| `2RJ7-1` | CC-03 | tab | ● | ● | 113 | 138 | 0 |
| `2ROJ-1` | CC-05 | tab | ● | ● | 103 | 98 | 0 |
| `2RWK-1` | CC-05 | tab | ● | ● | 97 | 40 | 0 |
| `2S4E-1` | CC-05 | tab | ● | ● | 106 | 73 | 0 |
| `2SCE-1` | CC-01 | tab | ● | ● | 157 | 118 | 0 |
| `2SKU-1` | CC-01 | tab | ● | ● | 134 | 123 | 0 |
| `2SRV-1` | CC-01 | tab | ● | ● | 121 | 103 | 0 |
| `2SYW-1` | CC-01 | tab | ● | ● | 131 | 126 | 0 |
| `2T63-1` | CC-02 | tab | ● | ● | 3 | 3 | 0 |
| `2TAG-1` | CC-02 | tab | ● | ● | 5 | 12 | 0 |
| `2TET-1` | CC-02 | tab | ● | ● | 4 | 10 | 0 |
| `2TJ6-1` | CC-02 | tab | ● | ● | 3 | 5 | 0 |
| `2TNJ-1` | CC-02 | tab | ● | ● | 2 | 5 | 0 |
| `2TRW-1` | CC-04 | tab | ● | ● | 101 | 49 | 0 |
| `2TZN-1` | CC-06 | tab | ● | ● | 154 | 144 | 0 |
| `2U5L-1` | CC-06 | tab | ● | ● | 142 | 29 | 0 |
| `2UBO-1` | CC-06 | tab | ● | ● | 88 | 23 | 0 |
| `2UHM-1` | CC-06 | tab | ● | ● | 58 | 19 | 0 |
| `2UN6-1` | CC-06 | tab | ● | ● | 71 | 16 | 0 |
| `2V71-0` | CC-05 | tab | ● | ● | 137 | 64 | 0 |
| `2VDA-0` | CC-03 | tab | ● | ● | 154 | 13 | 0 |
| `2VIN-0` | CC-03 | tab | ● | ● | 298 | 20 | 0 |
| `2VO0-0` | CC-03 | tab | ● | ● | 271 | 16 | 0 |
| `2WZK-0` | CC-03 | sort | ● | ● | 185 | 9 | 0 |
| `2X5N-0` | CC-06 | sort | ● | ● | 66 | 23 | 0 |
| `2XA5-0` | CC-03 | sort | ● | ● | 274 | 17 | 0 |
| `2XG6-0` | CC-06 | sort | ● | ● | 65 | 16 | 0 |
| `2XKO-0` | CC-06 | sort | ● | ● | 103 | 12 | 0 |
| `2XP6-0` | CC-06 | sort | ● | ● | 106 | 12 | 0 |
| `2XTO-0` | CC-06 | sort | ● | ● | 103 | 11 | 0 |
| `2XY6-0` | CC-03 | sort | ● | ● | 252 | 14 | 0 |
| `2Y47-0` | CC-03 | sort | ● | ● | 274 | 18 | 0 |
| `2YA8-0` | CC-06 | sort | ● | ● | 86 | 22 | 0 |
| `2YEQ-0` | CC-06 | sort | ● | ● | 86 | 22 | 0 |
| `2YJ8-0` | CC-06 | sort | ● | ● | 101 | 23 | 0 |
| `2YNQ-0` | CC-06 | sort | ● | ● | 105 | 12 | 0 |
| `2YS8-0` | CC-05 | sort | ● | ● | 121 | 23 | 0 |
| `2YXS-0` | CC-03 | sort | ● | ● | 224 | 15 | 0 |
| `2Z49-0` | CC-03 | sort | ● | ● | 121 | 9 | 0 |
| `2ZBB-0` | CC-05 | sort | ● | ● | 129 | 25 | 0 |
| `2ZHC-0` | CC-03 | sort | ● | ● | 203 | 12 | 0 |
| `2ZN9-0` | CC-03 | sort | ● | ● | 130 | 23 | 0 |
| `2ZTA-0` | CC-05 | sort | ● | ● | 118 | 17 | 0 |
| `2ZZ7-0` | CC-03 | sort | ● | ● | 152 | 12 | 0 |
| `3063-0` | CC-05 | sort | ● | ● | 157 | 36 | 0 |
| `30C1-0` | CC-03 | sort | ● | ● | 183 | 11 | 0 |
| `30HY-0` | CC-05 | sort | ● | ● | 111 | 27 | 0 |
| `30O1-0` | CC-03 | sort | ● | ● | 179 | 11 | 0 |
| `30TY-0` | CC-05 | sort | ● | ● | 130 | 34 | 0 |
| `30ZW-0` | CC-03 | sort | ● | ● | 197 | 12 | 0 |
| `316O-0` | CC-03 | sort | ● | ● | 206 | 12 | 0 |
| `31CL-0` | CC-05 | sort | ● | ● | 136 | 15 | 0 |
| `31II-0` | CC-03 | sort | ● | ● | 83 | 15 | 0 |
| `31OF-0` | CC-05 | sort | ● | ● | 70 | 11 | 0 |
| `31UD-0` | CC-03 | sort | ● | ● | 116 | 9 | 0 |
| `32S7-0` | CC-03 | tab | ● | ● | 21 | 57 | 0 |
| `32XM-0` | CC-03 | tab | ● | ● | 141 | 11 | 0 |
| `3BQB-0` | CC-06 | expand | ● | ● | 55 | 5 | 0 |
| `3D4I-0` | CC-06 | expand | ● | ● | 44 | 42 | 0 |
| `3DI2-0` | CC-03 | expand | ● | ● | 116 | 26 | 0 |
| `3DZ1-0` | CC-03 | expand | ● | ● | 33 | 28 | 0 |
| `3EWN-0` | CC-06 | expand | ● | ● | 57 | 42 | 0 |
| `3FR6-0` | CC-03 | expand | ● | ● | 139 | 18 | 0 |
| `3GRO-0` | CC-01 | expand | ● | ● | 60 | 60 | 0 |
| `3IGR-0` | CC-01 | expand | ● | ● | 58 | 63 | 0 |
| `3JT4-0` | CC-04 | expand | ● | ● | 56 | 48 | 0 |
| `3JZ3-0` | CC-04 | expand | ● | ● | 170 | 158 | 0 |
| `3K7K-0` | CC-01 | expand | ● | ● | 52 | 61 | 0 |
| `3LGC-0` | CC-01 | expand | ● | ● | 116 | 59 | 0 |
| `3MTJ-0` | CC-01 | expand | ● | ● | 57 | 36 | 0 |
| `3N4O-0` | CC-04 | expand | ● | ● | 117 | 132 | 0 |
| `3NVG-0` | CC-01 | expand | ● | ● | 44 | 40 | 0 |
| `3ODO-0` | CC-01 | expand | ● | ● | 71 | 39 | 0 |
| `3OIM-0` | CC-01 | expand | ● | ● | 61 | 56 | 0 |
| `3TCO-0` | CC-03 | expand | ● | ● | 152 | 15 | 0 |
| `3TOM-0` | CC-03 | expand | ● | ● | 125 | 9 | 0 |
| `3UTA-0` | CC-01 | expand | ● | ● | 35 | 37 | 0 |
