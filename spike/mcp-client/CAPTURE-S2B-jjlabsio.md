# S2B — `jjlabsio/korea-stock-mcp` DART+KRX 키 실호출

## 판정 : 부분통과

DART 키 계열 툴(`get_corp_code`, `get_disclosure_list`, `get_disclosure`, `get_financial_statement`, `get_market_type`)은 **전부 실데이터로 성공**했다. **리더 캔버스의 유일한 근거인 `get_disclosure`도 소용량·대용량 각각 캡처 성공**했다 — 단, 사전 조사가 가정한 "TOC + `section_id` 페이지네이션" 구조는 **이 서버에서 재현되지 않았다** (아래 참조, 사전 조사 가정과 다른 실측 결과). KRX 키 계열 툴(`get_stock_base_info`, `get_stock_trade_info`)은 **둘 다 거부**되었고, 원인은 DART 원시 API를 직접 호출해 "승인 대기"임을 명확히 확인했다.

---

## 캡처한 것 : 툴명 → 캡처 파일 → 응답 형상 요약

| 툴 | 캡처 파일 | 결과 | 형상 요약 |
|---|---|---|---|
| `get_today_date` | `S2B-jjlabsio-today.json` | 성공 | `{"todayKST":"20260815","todayUTC":"20260814"}` — 스칼라 |
| `get_corp_code` | `S2B-jjlabsio-corp-code.json` | 성공 | `[{"corp_code":126380,"corp_name":"삼성전자",...}]` — **`corp_code`가 8자리 zero-pad 문자열이 아니라 JSON 숫자로 와서 선행 0이 소실됨(126380, 원래 00126380)**. 하위 호출 전엔 `str(x).zfill(8)`로 정규화 필요 |
| `get_disclosure_list` | `S2B-jjlabsio-disclosure-list.json` | 성공 | `{"status":"000","message":"정상","page_no":1,"page_count":20,"total_count":866,"total_page":44,"list":[{corp_code, corp_name, stock_code, corp_cls, report_nm, rcept_no, flr_nm, rcept_dt, rm}, ...]}` |
| `get_disclosure` (소용량, 5KB 원본 zip) | `S2B-jjlabsio-disclosure-SMALL.json` | 성공 | JSON 텍스트 4,517자 |
| `get_disclosure` (대용량 3종, 474KB~780KB 원본 zip) | `S2B-jjlabsio-disclosure-{LARGE-annual,SEMI-annual,Q1}.json` | 성공 | JSON 텍스트 585,353~1,042,014자, **단일 응답으로 전문 전체 반환** |
| `get_disclosure` + `section_id` 파라미터 시도 | `S2B-jjlabsio-disclosure-LARGE-section-guess-1.json` | 성공(그러나 무의미) | `section_id`를 추가로 보내도 **에러 없이 무시되고 동일한 전체 응답(1,042,014자)이 그대로 옴** — 이 서버는 페이지네이션을 구현하지 않음 |
| `get_disclosure` (소용량이지만 문서저장소 미보관 유형) | `S2B-jjlabsio-disclosure-OWNERSHIP-fail.json`, `S2B-jjlabsio-disclosure-2026081400xxxx.json` (8건) | **실패** | `"ADM-ZIP: Invalid or unsupported zip format. No END header found"` — 원인 규명(아래 "막힌 것" 참조) |
| `get_financial_statement` | `S2B-jjlabsio-financial-statement.json` | 성공 | `{"status":"000","message":"정상","list":[{rcept_no, reprt_code, bsns_year, corp_code, sj_div, sj_nm, account_id, account_nm, account_detail, thstrm_nm, thstrm_amount, frmtrm_nm, frmtrm_amount, bfefrmtrm_nm, bfefrmtrm_amount, ord, currency}, ...]}` — **평평한 레코드 배열, 신규④ 공통 테이블에 그대로 착지 가능한 가장 깨끗한 형상** |
| `get_market_type` | `S2B-jjlabsio-market-type.json` | 성공 | `{"market":"Y"}` — 스칼라 |
| `get_stock_base_info` | `S2B-jjlabsio-stock-base-info.json` | **실패** | `"KRX request error"` (일반화된 에러 문자열, 상세 없음) |
| `get_stock_trade_info` | `S2B-jjlabsio-stock-trade-info.json` | **실패** | `"KRX request error"` (동일) |

보조 캡처: `S2B-jjlabsio-disclosure-list-extracted.json`(정규식 아닌 파싱 결과), `S2B-jjlabsio-disclosure-survey.json`(8건 실패 조사), `S2B-jjlabsio-SUMMARY.json`/`S2B-jjlabsio-disclosure2-SUMMARY.json`(전체 실행 로그), `S2B-CHECK-*.json`(인코딩·형상 정밀 검증용 부속 캡처).

---

## `get_disclosure` 응답의 정확한 구조 — 리더 캔버스가 렌더해야 할 대상

**사전 조사가 가정한 "대용량(>1MB)은 TOC + `section_id` 페이지네이션"은 이 서버(`@iflow-mcp/jjlabsio-korea-stock-mcp@1.1.5`)에서 재현되지 않았다.** `get_disclosure`의 `inputSchema`는 `rcept_no` 하나만 선언하고 `additionalProperties: false`다. 실측 결과:

- 소용량(원본 zip 5KB, 주요사항보고서) → 텍스트 4,517자, 대용량(원본 zip 780KB, 사업보고서) → 텍스트 1,042,014자. **양쪽 다 `content[0].text` 문자열화 JSON 하나로 전문 전체가 한 번에 온다.** `section_id`를 추가로 보내도 스키마 위반 에러 없이 조용히 무시되고 응답이 바뀌지 않았다(`S2B-jjlabsio-disclosure-LARGE-section-guess-1.json`이 원본과 동일 1,042,014자).
- **형상은 DART 원본 XML을 그대로 JSON으로 transliteration한 것**이다. 마크다운도 순수 HTML도 아니다:
  ```json
  {"?xml":"", "DOCUMENT":{"DOCUMENT-NAME":"...","COMPANY-NAME":"삼성전자",
    "BODY":{"LIBRARY":{"SECTION-1":{"TITLE":"...","TABLE":{...}}},
    "SECTION-1":{"TITLE":"자기주식 처분 결정","P":[...]}}}}
  ```
- **표 표현**: `TABLE` → `COLGROUP.COL[]` + `TBODY.TR[].TD[]`(때로 `TE`) 형태로 대체로 잘 파싱되지만, **일관되지 않는다** — 일부 깊게 중첩된 셀 내용은 파싱되지 않고 원본 XML 태그 문자열(`<TE ALIGN="RIGHT" ACODE="TOT_OSTK_END" ...>81,003,271</TE>`)이 어떤 필드 값 안에 원문 그대로 박혀 있다. 즉 **리더 캔버스는 두 갈래를 다 처리해야 한다**: (1) 잘 파싱된 `TABLE`/`TR`/`TD` JSON 트리, (2) 필드 값 내부에 섞여 나오는 원시 XML 태그 문자열. 순수 JSON 트리 렌더러만 만들면 후자에서 깨진다.
- `structuredContent`는 **항상 `null`**(이 서버의 다른 툴들과 동일 — output schema 미부착). 게이트웨이는 항상 `content[0].text`를 `json.loads()` 해야 한다.
- 1MB급 응답을 **청크 없이 한 번의 `call_tool` 응답으로** 받는다 — 클라이언트(MCP stdio 전송) 쪽 크기 제한은 이번 캡처 범위에서 문제 되지 않았다. 다만 **리더 캔버스가 "TOC 우선 로드 후 필요한 절만 지연 로드"하려는 설계였다면 이 서버는 그 설계를 지원하지 않는다** — 프론트에서 1MB짜리 JSON을 통째로 받아 클라이언트 사이드에서 목차/섹션을 분할해야 한다.

## `get_disclosure`가 실패하는 경우 — 별개의 실제 결함(정직하게 기록)

당일(2026-08-14) 접수된 8건(`get_disclosure_list`가 반환한 최신 목록, 임원·주요주주 소유상황보고서/반기보고서 등)은 **전부** `"ADM-ZIP: Invalid or unsupported zip format. No END header found"`로 실패했다. 원인을 DART 원본 API(`opendart.fss.or.kr/api/document.xml`)를 직접 curl로 호출해 규명했다:
- 실패한 `rcept_no=20260814003699`(반기보고서, 당일 접수) → DART가 `{"status":"014","message":"파일이 존재하지 않습니다."}`를 반환(진짜 zip이 아니라 XML 에러). 즉 **이 서버 버그가 아니라 DART 쪽에 해당 문서의 원문 파일이 아직 색인되지 않은 상태**(당일 접수 문서는 처리 지연 가능성) 또는 이 보고서 유형이애초에 `document.xml`이 커버하지 않는 유형이다. jjlabsio 서버는 이 XML 에러를 그대로 zip으로 unzip 시도하다 `adm-zip` 라이브러리가 깨진 zip으로 인식해 예외를 던진다 — **에러 핸들링 결함**(DART 응답이 실제 zip인지 먼저 검증하지 않음).
- 과거 접수 문서(`rcept_no=20260310002820` 사업보고서, `20250814003156` 반기보고서, `20250515001922` 분기보고서)는 DART 원본 API가 실제 zip(474KB~780KB)을 정상 반환했고, `get_disclosure` 툴 호출도 전부 성공했다.
- **결론**: `get_disclosure`는 "대용량 vs 소용량"이 아니라 **"DART 문서저장소에 원문 zip이 존재하는지"**가 성패를 가른다. 리더 캔버스는 이 실패 유형(문서 미존재/처리 지연)을 별도 에러 상태로 구분해 표시해야 한다.

---

## `get_disclosure_list` → 스트림 캔버스 필드 매핑

| 스트림 필드 | `get_disclosure_list` 소스 | 비고 |
|---|---|---|
| `ts` | `rcept_dt`(YYYYMMDD, 시각 없음) | 초 단위 타임스탬프 없음 — 날짜만 제공, 정렬은 `rcept_no`(접수번호, 사실상 시퀀스) 보조 필요 |
| `source` | 고정값 `"DART"` (서버가 명시 안 함, 게이트웨이가 부여) | |
| `title` | `report_nm` | `[기재정정]` 등 접두사가 섞여 옴, 원문 그대로 |
| `url` | 없음 — 게이트웨이가 `https://dart.fss.or.kr/dsaf001/main.do?rcept_no={rcept_no}` 조합 필요 | 서버가 URL을 안 줌 |
| 선택 `summary` | 없음 (목록 API는 요약 없음, `get_disclosure` 본문에서 파생해야 함) | |
| 선택 `tickers[]` | `stock_code` | 단일 종목코드 하나만 |
| 선택 `kind` | `corp_cls`(Y/K/N/E) 또는 `report_nm` 접두사 패턴 매칭 | 명시적 분류 필드 없음, 파싱 필요 |

---

## `structuredContent` 채워지는가?

**아니다. 이 서버의 8개 툴 전부 `structuredContent: null`이다** (`get_today_date`, `get_corp_code`, `get_disclosure_list`, `get_disclosure`, `get_financial_statement`, `get_market_type` 전부 확인, `get_stock_base_info`/`get_stock_trade_info`는 에러라 해당 없음). 항상 `content[0].text`가 문자열화 JSON이다 — 게이트웨이는 반드시 `json.loads(content[0].text)` 경로를 타야 한다. 이전 스파이크(RESULT.md)의 pykrx-mcp와 같은 패턴이며, `@drfirst/korea-stock-mcp`(structuredContent 채워짐)와는 다르다.

---

## 한글 인코딩 : 정상

**모든 캡처 파일에서 `U+FFFD` 0건 확인.** `get_corp_code`의 `"삼성전자"`, `get_disclosure`의 `"COMPANY-NAME":"삼성전자주식회사"`, `get_financial_statement`의 `"account_nm":"자산총계"` 등 전부 코드포인트 레벨로 직접 검증(`text.count('�')`, `hex(ord(c))` 확인 — `S2B-CHECK-encoding-analysis.json` 참조)했고 모두 0건/정상 코드포인트였다.

⚠️ **함정 재확인**: 이번 조사 중 `python -c "print(text[...])"`를 Bash 콘솔(cp949)로 직접 출력했을 때 `"COMPANY-NAME":"�Ｚ�����ֽ�ȸ��"`처럼 깨져 보이는 순간이 있었다. 이는 **RESULT.md가 이미 경고한 "print()+콘솔 리다이렉션 아티팩트"가 그대로 재현된 것**이며, 파일에 저장된 실제 UTF-8 바이트/코드포인트는 정상이었다(직접 코드포인트 덤프로 재확인). **콘솔 출력만 보고 손상이라 판단하면 안 된다** — 이번 작업에서도 이 함정에 빠질 뻔했다가 파일 직접 검증으로 정정했다.

---

## 데이터 형상 → 캔버스 착지

| 캡처한 응답 | 형상 | 착지 캔버스 |
|---|---|---|
| `get_disclosure_list` | 시간순 공시 목록(날짜만, 시각 없음) | 신규① 스트림 (필드 매핑은 위 표 참조, `url`/`ts`-시각/`summary`는 게이트웨이 파생 필요) |
| `get_disclosure` (소/대용량 공통) | DART XML→JSON transliteration, 단일 전문, TOC 없음 | 신규② 리더 — **원문은 확보했으나 형상이 계획 가정과 다름**: TOC 기반 지연 로드가 아니라 "1MB급 JSON 트리 통째 렌더 + 내부에 섞인 원시 XML 태그 문자열 처리"가 실제 요구사항 |
| `get_financial_statement` | 평평한 계정과목 레코드 배열(`sj_nm`/`account_nm`/`thstrm_amount` 등) | 신규④ 공통 테이블 — **이번 캡처 중 가장 깨끗하게 테이블 착지되는 응답** |
| `get_corp_code` | 단일/복수 룩업(회사명→고유번호) | 기존 #5 스칼라 카드 |
| `get_market_type` | 단일 스칼라(`{"market":"Y"}`) | 기존 #5 스칼라 카드 |
| `get_today_date` | 스칼라 2개 | 기존 #5 (의미 없음, 형상만) |
| `get_stock_base_info`/`get_stock_trade_info` | 미확보(KRX 키 거부) | 계획대로면 기존 #1/#2(가격 시계열)·#5 — **미검증 상태로 남음** |

---

## 막힌 것 — 정직하게

1. **KRX 키 2종 툴(`get_stock_base_info`, `get_stock_trade_info`) 둘 다 승인 대기로 확정됐다.** jjlabsio 서버는 `"KRX request error"`라는 일반화된 메시지만 주지만, KRX 원본 API(`https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd.json`, `.../sto/stk_isu_base_info.json`)를 이 `.env`의 `KRX_API_KEY`로 직접 curl 호출해 **`HTTP 401 {"respMsg":"Unauthorized API Call","respCode":"401"}`**을 원문 그대로 확인했다. 과제 지시대로 "승인 대기 추정"으로 보고한다 — `openapi.krx.co.kr`은 API별 개별 이용신청이 필요하고 영업일 오전 9시 일괄 승인 방식이라, 이 두 API(주식기본정보·주식매매정보)에 대한 신청이 아직 승인되지 않은 것으로 보인다. (신청 자체가 안 됐는지, 신청했지만 미승인인지는 이 스파이크 범위에서 구분 불가 — 대시보드 확인 필요.)
2. **`get_disclosure`의 TOC + `section_id` 페이지네이션은 이번 서버에서 확인되지 않았다.** 과제 지시가 인용한 "사전 조사"는 이 정확한 서버(`@iflow-mcp/jjlabsio-korea-stock-mcp@1.1.5`)와 다른 소스(다른 버전, 혹은 다른 DART 래퍼)를 근거로 했을 가능성이 있다 — **이 서버는 문서 크기와 무관하게 항상 전문을 한 번에 반환**하며 `section_id` 파라미터는 스키마에도 없고 보내도 무시된다. 리더 캔버스 설계는 "서버가 TOC를 준다"는 가정을 버리고 "클라이언트가 1MB급 JSON을 받아 스스로 목차/섹션을 나눈다"는 가정으로 재검토해야 한다.
3. **당일 접수 공시 8건 전부 `get_disclosure`가 실패**했다(`ADM-ZIP` 에러). DART 원본 API 직접 호출로 "문서 미존재"(status 014)임을 확인했지만, 이게 **처리 지연**(당일 접수분이라 아직 색인 안 됨) 때문인지 **이 보고서 유형(소유상황보고서 등)이 애초에 `document.xml`로 커버되지 않는 유형**이기 때문인지는 이 스파이크에서 완전히 구분하지 못했다. 실무에서는 최소 1영업일 지난 공시로 재시도하거나, 보고서 유형별로 `document.xml` 커버리지를 DART 공식 문서에서 확인해야 한다.
4. **`get_corp_code`가 `corp_code`를 8자리 zero-pad 문자열이 아니라 숫자로 반환**하는 버그성 동작을 발견했다(`126380` vs 정상 `"00126380"`). 이후 모든 DART 계열 호출(`get_disclosure_list`, `get_financial_statement`, `get_market_type`)의 `corp_code` 파라미터는 `minLength:8, maxLength:8` 문자열을 요구하므로, **호출측(게이트웨이)이 반드시 `str(x).zfill(8)`로 정규화해야 한다** — 이걸 안 하면 `"MCP error -32602: Input validation error: Expected string, received number"`로 즉시 실패한다(첫 시도에서 실제로 재현됨, `S2B-jjlabsio-disclosure-list.json`의 이전 시도 로그 참조 불필요, 본 파일은 정규화 후 성공 버전만 보존).

---

## 실행 방법 (재현 커맨드)

```bash
cd spike/mcp-client
.venv/Scripts/python.exe step_s2b_disclosure.py    # corp_code→disclosure_list→disclosure(당일분 8건 실패)→financial_statement→market_type→KRX 2종(실패)
.venv/Scripts/python.exe step_s2b_disclosure2.py   # 과거 접수 대용량 3건(성공) + section_id 무시 확인 + 당일분 재확인
.venv/Scripts/python.exe step_s2b_disclosure3.py   # 소용량(5KB 원본 zip) 단건 성공 캡처
```

키는 `.env`에서 직접 읽어 자식 프로세스 env로 주입(`DART_API_KEY`, `KRX_API_KEY`), 스크립트에 하드코딩하지 않음. 산출물은 전부 `Path.write_text(json.dumps(..., ensure_ascii=False, indent=2), encoding="utf-8")`로 저장.
