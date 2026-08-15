# 과제 A — KRX: "이용신청 대기"인가 "애초에 지원 안 함"인가

## 판정: **"이용신청 미승인 대기"가 맞다. 사용자 가설("애초에 지원 안 함")은 기각한다.**

증거는 아래 결정적 실험 1·2, 조사 3에서 나온다. 조사 4(pykrx-mcp 대체 가능성)는 별도 결론.

---

## 결정적 실험 1 — 401이 무엇을 뜻하는지 가려라 (판정을 내리는 실험)

같은 엔드포인트 2개(`stk_isu_base_info`, `stk_bydd_trd`)에 **실제 키 / 가짜 키(`INVALID_TEST_KEY_12345`) / 키 없음** 세 조건으로 호출했다.

| 조건 | HTTP | `respMsg` | `respCode` |
|---|---|---|---|
| **실제 키** (`.env`의 `KRX_API_KEY`) | 401 | **`"Unauthorized API Call"`** | 401 |
| 가짜 키 | 401 | `"Unauthorized Key"` | 401 |
| 키 헤더 없음 | 401 | `"Unauthorized Key"` | 401 |

**두 엔드포인트 모두 동일한 패턴.** `stk_isu_base_info`, `stk_bydd_trd` 둘 다 실제 키에서만 `Content-Length: 52`(`"Unauthorized API Call"`), 가짜 키·키 없음에서는 `Content-Length: 47`(`"Unauthorized Key"`)로 **바이트 단위까지 다른 응답**이 왔다.

**해석**: 서버가 실제 키를 가짜 키·키 없음과 **명확히 구분해서 처리하고 있다.** 키가 검증되지 않는 상태(=엔드포인트가 죽었거나 키를 아예 안 보는 상태)라면 세 조건이 전부 같은 응답을 반환해야 하는데, 그렇지 않았다. 실제 키는 서버에 **등록된 유효 키로 인식**되지만, **이 API 호출에 대한 권한은 없다**("Unauthorized *API Call*" — 키 자체가 아니라 "이 API 호출"이 미승인이라는 문구)는 뜻으로 읽는 것이 가장 정합적이다. → **사용자 가설을 판정하는 실험 하나가 "미승인" 쪽 손을 들어준다.**

원문 근거: `spike/captures/KRX-auth-host-probe.json` (`experiment_1_auth_key_comparison`)

---

## 결정적 실험 2 — 호스트/경로가 유효한가

| 확인 | 결과 |
|---|---|
| DNS `data-dbg.krx.co.kr` | **정상 해석됨** → `23.32.56.155`, `23.32.56.160` (Akamai CDN 대역 — 실서비스 인프라 패턴) |
| 루트 경로 `http(s)://data-dbg.krx.co.kr/` | **403 Forbidden** (표준 Apache 에러 페이지) — 죽은 호스트가 아니라 "루트 직접 접근 차단"이라는 정상적인 API 게이트웨이 동작 |
| `svc/apis/sto/stk_isu_base_info` 인증 없이 호출 | **401** `{"respMsg":"Unauthorized Key","respCode":"401"}` — **404가 아니다.** 경로가 존재하고 서버가 그 경로를 정상 라우팅해서 인증 단계까지 도달했다는 뜻 |
| `openapi.krx.co.kr` 에 같은 경로(`/svc/apis/sto/stk_isu_base_info`) | **404** — 이 호스트엔 그 경로가 없다. `openapi.krx.co.kr`은 **개발자 포털**(가입·키 발급·문서), `data-dbg.krx.co.kr`은 **실제 API 실행 호스트**로 역할이 분리된 정상 아키텍처. "dbg가 죽은 스테이징이라 이관됐다"는 근거가 아니다 |
| `openapi.krx.co.kr/` 루트 | **200**, `contents/OPP/MAIN/main/index.cmd`로 리다이렉트 — 포털이 살아서 정상 동작 중 |

**결론**: 호스트도 경로도 살아 있다. "dbg 스테이징 호스트가 죽어서 401을 위장한다"는 가설을 뒷받침하는 증거가 하나도 없다.

원문 근거: `spike/captures/KRX-auth-host-probe.json` (`experiment_2_host_path_validity`)

---

## 조사 3 — openapi.krx.co.kr 서비스 카탈로그 확인

WebFetch(`r.jina.ai` 프록시 경유, 동적 렌더 콘텐츠 확보) 결과:

- **주식 카테고리 API 8개가 실제로 카탈로그에 등재되어 있다**: `stk_bydd_trd`(유가증권 일별매매정보), `ksq_bydd_trd`, `knx_bydd_trd`, `sw_bydd_trd`, `sr_bydd_trd`, **`stk_isu_base_info`(유가증권 종목기본정보)**, `ksq_isu_base_info`, `knx_isu_base_info`. **최근 수정일 2026-01-16** — 최근까지 관리되고 있는 살아있는 서비스다.
- **서비스 종료·이관 공지는 없다.** 공지사항에 있는 건 "미제공 데이터 안내"(2026-06)와 "홈페이지 작업 공지"(2026-02)뿐 — 이 두 API를 지목한 종료 공지가 아니다.
- **이용신청 절차가 2단계로 명시되어 있다** (`OPPINFO003.jsp`):
  1. Data Marketplace 회원가입 → **인증키 신청 → "관리자 승인 후 사용 가능"**
  2. **원하는 API 서비스별로 별도 활용신청 → "관리자 승인대기" → 승인 후 "대외 서비스 개시"**
  → 이건 `.env` 파일 주석("키만으로는 부족하다. 6개 API 각각 이용신청이 승인되어야 호출된다")과 **정확히 일치**하며, 실험 1의 결과와도 정합적이다. 인증키는 이미 발급됐지만(1단계 통과, 그러니 "인식은 됨"), API별 활용신청 승인(2단계)이 아직 안 된 상태로 보인다.
- **API별 상세 응답 필드 명세 페이지는 확보하지 못했다.** 목록 페이지(`OPPUSES002_S1.cmd`)까지는 8개 API명이 나왔지만, 개별 API 클릭 시 뜨는 상세 스펙(요청 파라미터·응답 필드)은 로그인 세션이 필요한 것으로 보이며 WebFetch로는 못 얻었다(막힌 것 참조).

원문 근거: `spike/captures/KRX-openapi-catalog-verify.json`. **주의**: 이 캡처는 최초 스파이크 실행 시점엔 저장되지 않았다 — 검증 패스에서 WebFetch로 재확인 후 사후 저장한 것이다. 최초 서술은 저장된 원문 없이 쓰여졌지만, 재확인 결과 8개 API명·수정일(2026/01/16)·2단계 승인 절차 서술 모두 사실과 일치했다.

---

## 조사 4 — pykrx-mcp가 실제로 대체 가능한가 (8개 툴 실측)

`spike/mcp-client/.venv`의 `pykrx-mcp`(키 불필요)를 8개 툴 전부 실제 호출했다. 삼성전자(005930)/KODEX200(069500) 기준, 두 가지 날짜 범위(2026-01, 2024-01)로 **재현 확인**.

| 툴 | 결과 | 비고 |
|---|---|---|
| `get_stock_ohlcv` | ✅ **성공** | 9일치 OHLCV+등락률 실데이터 반환 |
| `get_market_ticker_name` | ✅ **성공** | `{"ticker":"005930","name":"삼성전자"}` |
| `get_market_ticker_list` | ❌ 실패 | `"No tickers found for KOSPI on ..."` |
| `get_market_fundamental_by_date` | ❌ 실패 | `"No fundamental data found..."` |
| `get_market_cap_by_date` | ❌ 실패 | `"No market cap data found..."` |
| `get_market_trading_value_by_date` | ❌ 실패 | `"No trading value data found..."` |
| `get_etf_ohlcv_by_date` | ❌ 실패 | `"No ETF data found..."` |
| `get_etf_ticker_list` | ❌ 실패 | `KeyError: '시장'` |

**날짜와 무관하게 동일하게 재현됨**(2026-01 range, 2024-01 range 둘 다 같은 6개가 실패). 원인을 원본 스택트레이스로 추적: 실패한 6개는 전부 `pykrx.website.krx.krxio.py`에서 `data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`를 POST 호출 후 `resp.json()`이 `JSONDecodeError`를 던진다. 원문 응답을 직접 재현해보니:

```
POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
(bld=dbms/MDC/STAT/standard/MDCSTAT01501, 전종목시세 — ticker_list가 쓰는 bld)
→ HTTP 400, body: "LOGOUT"
```

이건 **KRX 오픈API(`AUTH_KEY`)와 완전히 무관한 문제**다. `data.krx.co.kr`은 KRX가 일반에 공개한 **웹사이트 스크래핑 대상**(정보데이터시스템 화면 뒷단 AJAX)이지 오픈API가 아니며, `pykrx` 라이브러리 자체의 세션/쿠키 관리 로직이 이 환경에서 "LOGOUT" 응답을 유발하는 것으로 보인다(성공한 `get_stock_ohlcv`도 같은 서버·같은 엔드포인트 패턴을 쓰는데 세션 타이밍에 따라 성공/실패가 갈리는 것으로 추정 — 근본 원인은 이 스파이크 범위를 벗어난다, 막힌 것 참조).

**실용적으로 중요한 것은 원인이 아니라 결과다**: 이번 실측에서 pykrx-mcp가 안정적으로 주는 것은 **OHLCV 시계열**과 **티커→종목명 룩업** 단 둘뿐이다.

### 필드 단위 커버리지 비교

| KRX 오픈API | 통상 포함 필드(패턴상) | pykrx-mcp 대응 여부 |
|---|---|---|
| `stk_isu_base_info`(종목기본정보) | 표준코드·단축코드·종목명·영문명·상장일·시장구분·증권구분·액면가·상장주식수 등 | **부분적, 그리고 이전 서술보다 더 약하다.** `get_market_ticker_name`은 티커↔종목명 단건 조회만 준다(성공 확인됨). `get_market_ticker_list`는 이번 실행에서 실패했고, **소스코드를 직접 추적한 결과 성공하더라도 종목명 없이 티커 코드 리스트만 반환한다** — `pykrx_mcp/tools/ticker_info.py`의 `get_market_ticker_list`는 `stock.get_market_ticker_list()`를 호출하는데, 이 함수(`pykrx/stock/stock_api.py:72`)는 내부적으로 `krx.get_market_ticker_and_name()`(ticker+name Series, `pykrx/website/krx/market/wrap.py:346`)을 호출하고도 `s.index.to_list()`로 **이름을 버리고 티커만** 반환한다. (이전 버전 이 문서는 "티커+종목명 두 컬럼 반환"이라고 썼는데, 이는 `get_market_ticker_and_name`과 혼동한 오류였다 — 그 함수는 pykrx-mcp 8개 툴 어디에도 노출되지 않는다.) 결론적으로 상장일·액면가·상장주식수·ISIN은 물론 **종목명 대량 조회조차 pykrx-mcp로는 불가능**하다(개별 티커 1건씩 `get_market_ticker_name`으로 조회하는 것만 가능) |
| `stk_bydd_trd`(일별매매정보) | 기준일·시가·고가·저가·종가·대비·등락률·거래량·거래대금·시가총액·상장주식수 등 | **부분적.** `get_stock_ohlcv`가 시가/고가/저가/종가/거래량/등락률은 준다(성공 확인). 거래대금·시가총액·상장주식수는 `get_market_cap_by_date`/`get_market_trading_value_by_date`가 담당해야 하는데 **이번 실행에서 둘 다 실패**했다 |

**결론**: 개념적으로는 pykrx-mcp가 KRX 오픈API 두 API의 핵심 데이터(가격 시계열, 종목명 룩업)를 커버할 잠재력이 있지만, ①애초에 필드 완전 일치는 아니고(정적 메타데이터인 상장일·액면가·ISIN 등은 pykrx-mcp에 없음) ②이번 환경에서는 8개 툴 중 6개가 KRX_API_KEY와 무관한 별개 버그로 실패했다. **"필요 없다"고 단정하기엔 이르다** — 다만 ③ 타임라인 캔버스가 최소한으로 필요로 하는 "가격 시계열"(OHLCV) 하나는 실측으로 확실히 확보된다.

원문 근거: `spike/captures/KRX-pykrx-coverage.json`, `spike/captures/KRX-pykrx-raw-endpoint-probe.json`

---

## Athena에게 KRX 키가 정말 필요한가 — 권고

1. **KRX 오픈API 상태는 "미승인 대기"가 맞다.** 지원 종료도, 키 미인식도 아니다. 대시보드(`openapi.krx.co.kr` 마이페이지 → 이용현황)에서 `stk_isu_base_info`/`stk_bydd_trd`(및 KOSDAQ/KONEX 변형) 활용신청이 실제로 접수되어 있는지 먼저 확인하고, 안 되어 있으면 신청하라. 신청까지 했다면 그냥 승인 대기(영업일 오전 9시 일괄 처리 — `.env` 주석 근거)이므로 **기다리면 해결될 가능성이 높다.**
2. **동시에, KRX 키를 기다리는 동안 ③ 타임라인의 가격축은 완전히 막혀 있지 않다.** pykrx-mcp의 `get_stock_ohlcv`가 키 없이 즉시 OHLCV 시계열을 준다 — **KRX 키 승인을 막연히 기다릴 필요 없이 pykrx-mcp로 타임라인 가격축 개발을 지금 시작할 수 있다.**
3. **다만 pykrx-mcp를 "완전 대체재"로 확정하지는 마라.** 이번 실측에서 8개 툴 중 6개가 실패했다(KRX_API_KEY와 무관한 별개의 pykrx 세션 버그, 원인 미규명). W1에서 이 버그를 재현·수정하거나, 실패하는 6개 툴이 필요해지는 시점(시가총액·거래대금·펀더멘털이 캔버스 요구사항에 들어올 때)에 재검토가 필요하다.
4. **권고: KRX 키는 포기하지 말고 병행하라.** ① 대시보드에서 승인 상태 확인 + 필요시 재신청(비용 거의 없음, 그냥 대기) ② 그 사이 pykrx-mcp로 개발 착수 ③ pykrx-mcp의 6개 실패 툴 버그를 별도 이슈로 추적. KRX 키가 승인되면 정적 메타데이터(상장일·액면가·ISIN 등)와 거래대금·시가총액 등 pykrx-mcp가 못 주는 필드까지 확보되므로, 완전히 포기할 이유는 없다.

---

## 재현 커맨드

```bash
cd C:\Projects\DAOU.Athena
spike/mcp-client/.venv/Scripts/python.exe spike/krx-probe/step1_auth_probe.py       # 실험 1·2
spike/mcp-client/.venv/Scripts/python.exe spike/krx-probe/step2_pykrx_coverage.py   # 조사 4 (pykrx-mcp 8툴)
spike/mcp-client/.venv/Scripts/python.exe spike/krx-probe/step3_pykrx_raw_probe.py  # pykrx 실패 원인 진단 (data.krx.co.kr 원문 응답)
```

키는 스크립트가 `C:\Projects\DAOU.Athena\.env`에서 직접 읽는다(하드코딩 없음). 산출물은 전부 `spike/captures/KRX-*.json`.

---

## 막힌 것 — 정직하게

1. **API별 상세 응답 필드 명세를 KRX 공식 문서에서 확보하지 못했다.** 서비스 카탈로그(8개 API명)까지는 확인했지만, 개별 API 클릭 시의 요청 파라미터·응답 필드 상세 페이지는 로그인 세션이 필요해 보였고 WebFetch로 못 열었다. 위 커버리지 표의 "통상 포함 필드"는 공개적으로 널리 알려진 KRX 정보데이터시스템 표준 필드명 패턴에 근거한 추정이며, 이 스파이크에서 원문으로 검증하지 못했다.
2. **"신청 자체가 안 됐는지, 신청했지만 미승인인지"는 여전히 API 응답만으로 완전히 구분되지 않는다.** 실험 1이 "키는 인식되지만 이 API는 권한 없음"까지는 확정했지만, 그게 "신청 자체를 안 함"인지 "신청했고 대기 중"인지는 서버가 같은 401을 준다 — 대시보드 확인이 유일한 확정 방법이며 이 스파이크 범위 밖이다.
3. **pykrx-mcp 6개 툴 실패의 근본 원인을 완전히 규명하지 못했다.** `data.krx.co.kr`이 세션 없는 POST에 `400 LOGOUT`을 반환하는 것까지는 재현했지만, pykrx 라이브러리 내부에서 왜 `get_stock_ohlcv`(성공)와 `get_market_ticker_list`(실패)가 같은 서버·비슷한 패턴인데 갈리는지(세션 초기화 타이밍? 요청 순서? 개별 클래스의 세션 재사용 로직 차이?)는 소스 레벨 추적이 더 필요하다. KRX_API_key 문제와는 무관하다는 것만 확인했다.
