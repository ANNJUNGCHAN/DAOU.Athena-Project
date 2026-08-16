# 02 · MCP 응답 형상 전수조사

목적: "어떠한 MCP 툴 호출과 그 결과든 담을 수 있는 카드 하나의 최소 필드 집합은 무엇인가"에 실측으로 답한다. 추측 금지 — 모든 주장에 파일 경로 또는 캡처 파일명을 붙인다.

## 조사 범위 — 전수 여부를 정직하게 밝힌다

`spike/captures/`에는 88개 파일이 있다: JSON 74개 · NDJSON 7개 · TXT 7개(로그).

**JSON 74개 전부를 열어 분류했다**(스크립트 1차 패스 + 수동 보정 2차 패스, 근거는 `spike/paper-bridge/.scratch/survey2.py`). 결과:

| 분류 | 개수 | 내용 |
|---|---|---|
| **CallToolResult를 담은 파일** | **49개** | 아래 §A의 대상 |
| `list_tools`/`initialize` 캡처 | 9개 | 툴 스키마·서버 핸드셰이크뿐, 호출 결과 아님 |
| KRX 원시 HTTP 캡처 | 5개 | MCP가 아니라 REST 직접 호출(`requests`) — 애초에 대상 밖 |
| 파생 요약/체크 메타파일 | 10개 | 여러 캡처를 집계·재확인한 2차 산출물(`S2B-CHECK-*`, `*-SUMMARY.json`, `*-survey.json`, `*-list-extracted.json`, `download_document-LARGE-markdown-leakcheck.json`) — 원본 형상 자체가 아니라 원본에 대한 측정값이므로 형상 분류에서 제외하되 수치는 인용
| 네임스페이스 실험 | 1개 | `S2-namespace-experiment.json` — 호출 결과가 아니라 이름 충돌 실험 |

**49개 파일에서 개별 툴 호출 인스턴스 약 62개를 추출했다**(일부 파일이 다중 호출을 담는다 — `GRAFT-verify.json` 5건, `S2-drfirst-response.json`/`S2-pykrx-response.json` 각 2건, `S2-jjlabsio-alltools-nokey.json` 8건). NDJSON 7개(`S3-*.ndjson`)는 `claude -p` 세션 트랜스크립트로, MCP 서버 자체의 응답이 아니라 "게이트웨이 동의 우회" 스파이크(W1-5, `client.py` 상단 docstring 인용)의 증거라 형상 분류 대상이 아니다 — 필요한 부분만 D절에서 인용한다.

**샘플링 아님.** 위 74개 전부를 열어 위 표로 분류했고, 49개 CallToolResult 파일 전부를 개별적으로 읽거나 스크립트로 파싱했다.

---

## A. 응답 형상 분류

`result.py`의 4단계(`isError` → `structuredContent` → `json.loads` → 순수 텍스트)를 뼈대로 삼되, 실측이 그 안에서 갈라지는 하위 형상까지 전부 적는다. **7개 클래스**로 100%를 덮는다.

### A1. 에러 (`isError: true`)

`content[0].text`가 사람이 읽는 에러 문장이다. 데이터가 아니다 — 캔버스로 보내면 안 된다(`result.py` L4).

- 실측 **약 17건**. 근거: `S2-everything-calltoolresult-isError.json`(잘못된 인자 → JSON-RPC 에러가 툴 레벨로 래핑), `S2-jjlabsio-nokey-error.json`, `S2-jjlabsio-stockbaseinfo-nokey.json`, `S2-jjlabsio-alltools-nokey.json`(8툴 중 6개가 `"There is no DART API KEY"`/`"There is no KRX API KEY"`), `S2B-jjlabsio-disclosure-2026081400{3549,3672,3699,3747,3844,3912,3950,3973}.json`(당일접수 공시 8건 전부 — DART 문서저장소 zip 미존재), `S2B-jjlabsio-stock-base-info.json`/`stock-trade-info.json`(KRX 키 없음), `S2B-naver-credtest-B_legacy_only.json`(레거시 자격증명 401), `GRAFT-verify.json`의 `unapproved_tool_direct`(**게이트웨이 자체가** 만든 에러 — 승인 안 된 툴 호출을 upstream에 보내지도 않고 거부. upstream 에러와 형상은 같지만 발생 지점이 다르다).
- **카드가 보여줘야 할 것**: 에러 메시지 원문(`content[0].text`), 이게 upstream 에러인지 게이트웨이 자체 거부인지 구분.

### A2. 구조화 미러(structured-echo)

`structuredContent`가 있고, `content[0].text`를 파싱한 값과 **완전히 동일한 객체**다. `result.py`의 2번 경로.

- 실측 4건: `S2-everything-calltoolresult-structured.json`(`get-structured-content`, `{temperature, conditions, humidity}`), `S2-drfirst-response.json`의 두 호출(`get_stock_price_by_code`, `search_stock_code` — Zod 기반 output schema를 가진 유일한 upstream 서버), `GRAFT-verify.json`의 `render_canvas_table`/`render_canvas_unknown_type`(이건 upstream이 아니라 **Athena 자신의 `athena__render_canvas` 툴** — 게이트웨이가 만드는 결과도 같은 4단계 파서를 통과해야 한다는 증거).
- `mcp-실행계획.md` §9-①: "서버 3개 중 2개가 전부 `null`이다 — `jjlabsio` 8툴 전부, `naver-search` 전부. `@drfirst`만 채운다." → **이 클래스는 예외지 규칙이 아니다.**

### A3. 구조화-산문 래핑(structured-wrapped-prose)

`structuredContent`가 있지만 그 값이 `{"result": "<마크다운 산문 문자열>"}` — 단일 키가 사람이 읽는 리포트 전체를 감싼다. JSON이되 표/스칼라가 아니라 **텍스트 한 덩어리**다.

- 실측 3건, 전부 `dart-mcp`(2geonhyup, `mcp-실행계획.md` §10에서 최종 탈락한 서버) 하나에서만 관측: `S2B-dartmcp-search_business_information-segment.json`, `S2B-dartmcp-search_disclosure-revenue.json`, `S2B-dartmcp-search_json_financial_data-IS.json`.
- **새로 발견된 결함(quirks.py 미반영)**: `search_disclosure-revenue.json`의 매출액 필드가 `71,915,600,999,999,995,904`로 나온다 — 정상값(약 71.9조)에 float64 정밀도 손상이 겹친 값이다. `search_json_financial_data-IS.json`(같은 서버)은 같은 계정을 `71979938000000`로 정상 출력한다 — **같은 서버가 툴에 따라 수치 부패 여부가 갈린다.** `mcp-실행계획.md` L571이 이 서버를 "XBRL 경로에 10⁶배 수치 오류 실측됨"으로 탈락시킨 것과 같은 계열의 결함이 실제로 재현된 것이다.
- **카드가 보여줘야 할 것**: `structuredContent` 유무만으로 "구조화됐다"고 믿으면 안 된다는 반례. 이 클래스는 리더(②) 후보이지 테이블 후보가 아니다.

### A4. 평평한 스칼라 객체(scalar-lookup)

`structuredContent`는 `null`, `content[0].text`가 파싱되며 키 1~수개짜리 **중첩 배열 없는** 객체다.

- 실측: `S2B-jjlabsio-today.json`(`{todayKST, todayUTC}`), `S2B-jjlabsio-market-type.json`(`{market}`), `GRAFT-verify.json`의 `pykrx_ticker_name`(`{ticker, name}`), `S2-pykrx-response.json`의 `get_market_ticker_name`, `DARTSURVEY-chrisryugj-attachment-extract-PDF.json`/`-semiannual-idx0.json`(첨부파일 변환 결과 — 단 아래 참조).
- **함정**: `attachment-extract-PDF.json`은 `isError: false`인데 페이로드 안에 `"error": "빈 버퍼이거나 유효하지 않은 입력입니다.", "error_code": "EMPTY_INPUT"`가 들어 있다 — **툴 레벨(프로토콜) 성공과 의미 레벨(도메인) 실패가 분리된다.** `mcp-실행계획.md` §3 "서버 교체로 해결됨" 절이 이 실패를 "DART가 `Referer` 헤더를 정확히 요구하는데 틀리면 HTTP 200에 0바이트"로 설명한 바로 그 사례다. **`isError` 필드 하나로는 성공/실패를 판정할 수 없다.**

### A5. 레코드-리스트 래퍼(paginated-table) — ★ 가장 흔하고 가장 깨끗한 착지점

`structuredContent`는 대개 `null`, `content[0].text`가 파싱되며 **메타데이터 필드(status/message/page_no/total_count/mode/ticker 등) + 배열 값을 가진 필드 정확히 1개**(`list`/`items`/`data`/`attachments`)로 이뤄진 객체. 배열 원소는 평평한 동형 레코드.

- 실측 **11건**: `S2B-jjlabsio-disclosure-list.json`(`list`, 20/866건), `S2B-jjlabsio-financial-statement.json`(`list` — §9가 "가장 깨끗하게 착지하는 응답"으로 명시), `S2B-naver-news-date.json`/`-sim.json`(`items`), `S2B-naver-credtest-A_hub_only.json`/`-C_both.json`의 `call_result`(`items`, 뉴스와 동일 형상), `S2-pykrx-response.json`의 `get_stock_ohlcv`(`data`, OHLCV 9일치), `S2-VERIFY-pykrx-env-baseline.json`/`-utf8forced.json`(동일), `DARTSURVEY-chrisryugj-attachments-list*.json` 3건(`attachments`), `DARTSURVEY-chrisryugj-financials-summary.json`(`items`), `DARTSURVEY-chrisryugj-search_disclosures.json`(`items`).
- `S2B-jjlabsio-corp-code.json`은 변종이다 — 객체로 감싸지 않고 **최상위가 바로 배열**(`[{"corp_code":126380,...}]`). 레코드 1개짜리 배열도 이 클래스로 본다.
- 이게 `canvas.py`의 `TABLE_SCHEMA`(§E 참조)가 정확히 노리는 형상이다: `columns`가 없으면 `rows[0]`의 키에서 유도한다는 그 설계가 이 11건 전부에 그대로 들어맞는다.

### A6. 깊게 중첩된 트리(nested-document) — 테이블로 못 접는다

`structuredContent`는 `null`, `content[0].text`가 파싱은 되지만 **깊이가 임의(2~7단 이상)이고 배열/객체가 뒤섞인 트리**다. 레코드 배열이 아니다.

- 실측 5건, 전부 `jjlabsio get_disclosure`(DART XML → JSON transliteration): `S2B-jjlabsio-disclosure-LARGE-annual.json`(1,042,014자), `-LARGE-section-guess-1.json`(동일 — `section_id` 인자가 조용히 무시됨, `mcp-실행계획.md` L144 재확인), `-Q1.json`(585,353자), `-SEMI-annual.json`(859,568자), `-SMALL.json`(4,517자). 전부 `{"?xml": "", "DOCUMENT": {...}}` 형태, `TABLE→COLGROUP→TBODY→TR→TD/TE/TU` 트리.
- **원시 XML 태그 누출 실측**: `S2B-jjlabsio-disclosure-SMALL.json` 안에 `{"TE":"81,003,271"}`처럼 가공되지 않은 태그명이 값 자리에 그대로 남는다(`mcp-실행계획.md` L161 인용과 동일 파일).
- **카드가 절대 통째로 못 담는 클래스.** §D에서 다시 다룬다.

### A7. 순수 텍스트(free-text / document-envelope)

`content[0].text`가 애초에 JSON이 아니거나(A7a), JSON이지만 "평평한 메타데이터 + 긴 문자열 필드 1개"(A7b — 필드 자체는 마크다운/원시 XML 본문).

- **A7a (진짜 순수 텍스트)**: `S2-everything-calltoolresult.json`(`"Echo: hello from Athena spike S2"`), `GRAFT-verify.json`의 `everything_echo`(`"Echo: 삼성전자"`). `json.loads` 자체가 실패한다.
- **A7b (문서 봉투)**: `DARTSURVEY-chrisryugj-download_document-SAME-AS-jjlabsio-SMALL-markdown.json`/`-raw.json` — `{rcept_no, file, format, size_bytes, raw_char_count, char_count, truncated, content: "<마크다운 또는 원시 XML 전문>"}`. **A6(jjlabsio)와 같은 문서를 봉투 방식만 다르게 담는다** — `chrisryugj`는 파싱된 트리 대신 렌더링된 텍스트 한 덩어리를 준다(`mcp-실행계획.md` "서버 교체로 해결됨" 절, `raw_xml_tag_leak_count: 0` — `download_document-LARGE-markdown-leakcheck.json`으로 400,000자 검사에서 태그 누출 0건 확인).
- **카드가 보여줄 수 있는 최대치는 "첫 N자 미리보기 + 리더로 이동" 링크뿐** — `DEFAULT_MAX_RESPONSE_CHARS = 5_000_000`(`client.py` L44)과 `KOREAN_DART_MCP_MIN_TRUNCATE_AT = 700_000`(`quirks.py` L39)이 이미 "전문을 카드에 다 못 넣는다"를 전제하고 있다.

### 요약 표

| 클래스 | 개수(실측) | `structuredContent` | `content[0].text` 파싱 | 착지 |
|---|---|---|---|---|
| A1 에러 | ~17 | 무관 | 사람이 읽는 문장 | 에러 표시, 캔버스 아님 |
| A2 구조화 미러 | 4 | 존재, text와 동일 | JSON = structuredContent | 형상 따라(스칼라/테이블) |
| A3 구조화-산문 | 3 | 존재, `{result: "산문"}` | JSON이지만 값이 산문 | 리더 |
| A4 스칼라 객체 | 5+ | null | 평평한 객체 | 스칼라 카드 |
| A5 레코드-리스트 | 11 | null(대개) | 메타 + 배열 1개 | **공통 테이블** |
| A6 중첩 트리 | 5 | null | 임의 깊이 트리 | 리더(또는 free) |
| A7 순수 텍스트/봉투 | 4 | null | 텍스트 실패 또는 봉투 | 리더 |

---

## B. 반드시 있어야 하는 것 — 불변 스파인

형상과 무관하게 **모든** 호출에 대해 의미 있는 필드다. 코드/캡처 근거를 각각 붙인다.

1. **어느 서버인가(alias)** — `aggregator.py`의 `QualifiedTool.alias`, `qualified_name(alias, upstream_tool_name)`(L37-38). 실측: `serverInfo.name`은 신뢰 불가(`pykrx-mcp`/`@drfirst/korea-stock-mcp`/`jjlabsio` 미러 **세 서버 전부**가 `korea-stock-mcp`류로 겹친다 — `S2-namespace-experiment.json`의 `collision_note`, `spike/mcp-client/RESULT.md` 단계 3). **카드는 반드시 사용자가 등록한 alias로 서버를 식별해야지 self-reported name을 쓰면 안 된다.**
2. **어느 툴인가(upstream_name)** — `aggregator.py` `QualifiedTool.upstream_name`. 모든 캡처가 `tool` 필드로 이 정보를 남긴다(예: `S2B-jjlabsio-corp-code.json` L2 `"tool": "get_corp_code"`).
3. **에러 여부(isError)** — `result.py` L27 `ParsedStatus`의 첫 갈래. 모든 CallToolResult가 이 불리언을 갖는다(예외 없음, 62개 인스턴스 전부 확인).
4. **에러이지만 `isError`로 못 잡는 실패가 있다는 사실 자체** — A4의 `EMPTY_INPUT` 사례. 카드는 `isError`뿐 아니라 페이로드 안의 `error`/`error_code`류 필드도 봐야 한다는 요구를 스파인에 새겨야 한다(필드 자체는 서버마다 달라 정규화 불가능하지만, "이 결과가 성공처럼 보여도 의미상 실패일 수 있다"는 신호 슬롯은 있어야 한다).
5. **structuredContent 유무와 그 형상** — `result.py` L88-92. A2~A3이 갈리는 지점 자체가 카드 렌더링 분기점이다(구조화 미러는 신뢰, 구조화-산문은 리더로).
6. **파싱 4단계 중 어디에 착지했는가(status: error/structured/json/text/empty)** — `result.py` L27 `ParsedStatus` 그 자체. 카드가 어떤 하위 뷰(표/스칼라/텍스트/에러)를 그릴지 결정하는 유일한 축이다.
7. **응답이 잘렸거나 상한을 넘었는가** — `client.py`의 `ResponseTooLargeError`(L51-70, 5,000,000자 상한, post-parse), `quirks.py`의 `truncate_at`/`KOREAN_DART_MCP_DEFAULT_TRUNCATE_AT`(100,000자 기본값이 636,059자 문서의 84%를 자른다는 실측, `DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json`의 `outer_truncated: true`/`outer_char_count: 636059`가 그 실제 사례). **카드는 "이게 전문인지 잘린 것인지"를 반드시 표시해야 한다** — 안 그러면 사용자가 잘린 재무제표를 전문으로 오인한다.
8. **인코딩 손상 여부** — `quirks.py`의 `contains_mojibake`/`MOJIBAKE_CHAR`(U+FFFD). 실측: 74개 JSON 캡처 전체를 U+FFFD로 grep한 결과 **`S2-drfirst-response.json` 단 1개 파일, 8회**뿐이다(다른 73개는 0건) — `mcp-실행계획.md` §9-④ "인코딩 손상은 `@drfirst` 하나에 국한된 것으로 보인다"가 정확히 이 카운트와 일치한다. 드물지만 **일어난 사실이 있는 이상 카드에 경고 슬롯이 있어야 한다.** `registry.py`의 `ServerEntry.encoding_smoke_test_warning`(L159)이 서버 단위로 이미 이 신호를 갖고 있다 — 콜 단위 카드는 그 플래그를 상속만 하면 된다.
9. **소요 시간** — 캡처 하나에서 직접 확인(`DARTSURVEY-*.json`의 `elapsed_s` 필드, 예: `search_disclosures.json` L8 `"elapsed_s": 0.18`). 전 파일에 있진 않지만(harness가 남긴 값), `client.py`의 `call_timeout_seconds=30.0`/`healthcheck_timeout_seconds=5.0`(L150-152)이 "호출엔 상한이 있고 그 상한 대비 실제 소요를 보여줘야 한다"는 설계 의도를 코드 레벨에서 뒷받침한다.
10. **어느 채널에서 값을 가져왔는가(structuredContent vs content[0].text fallback)** — B5·B6과 사실상 같은 축이지만 카드 하단 "출처" 표기용으로 별도 슬롯이 필요하다: A2(미러)는 두 채널이 같은 값이라 상관없지만, A3(산문 래핑)처럼 `structuredContent`가 있어도 그 값이 카드가 원하는 형태가 아닐 수 있다 — **"structuredContent가 있다"와 "그 값이 쓸모 있다"는 별개**라는 게 A3의 핵심 증거다.

**요약**: `alias · upstream_tool_name · isError · parse_status(error/structured/json/text/empty) · truncated여부 · encoding_warning여부 · (있다면) 소요시간` — 이 7~8개가 형상과 무관하게 항상 채워지거나, 항상 "해당 없음"으로 명시적으로 비워지는 스파인이다.

---

## C. 형상별로만 있는 것

| 필드 | 해당 클래스 | 근거 |
|---|---|---|
| `data`(파싱된 JSON 값 자체) | A2, A3, A4, A5, A6 | A1(에러)·A7a(순수 텍스트)엔 "데이터"가 없다 — `result.py`의 `data: Any`가 `status`에 따라 `None`이거나 파싱값이거나 원문이거나로 갈린다(L47) |
| `structuredContent` 원본 객체 | A2, A3 | `null`인 클래스(A4~A7)엔 아예 없는 필드 — 있고 없고 자체가 정보다 |
| 컬럼 목록(레코드 배열의 키 집합) | A5만 | `canvas.py` `TABLE_SCHEMA`의 `columns`/`rows` — A2(스칼라)·A6(트리)엔 "컬럼"이라는 개념이 성립하지 않는다 |
| 페이지네이션 메타(`page_no`/`total_count`/`total_page`) | A5의 일부(`disclosure-list`, `search_disclosures`) — pykrx OHLCV·naver 뉴스는 없음 | `S2B-jjlabsio-disclosure-list.json` vs `S2-pykrx-response.json` 대조 |
| 트리 깊이/원시 태그 누출 카운트 | A6만 | `raw_xml_tag_leak_count`(`download_document-LARGE-markdown-leakcheck.json`) — A5·A2엔 "태그 누출"이라는 축 자체가 없다 |
| `error_state`(`not_found`/`processing_delayed`) | A6·A7b(리더로 갈 클래스)만 | `canvas.py` `READER_SCHEMA` L67 — A5(테이블)엔 이 필드가 무의미하다 |
| HTML 엔티티/`<b>`태그 sanitize 필요 여부 | A5 중 뉴스(`naver-news-*`) 한정 | `mcp-실행계획.md` L132-139: "`<b>` 태그가 100/100 아이템 전부에", 엔티티 24~26% — 공시(A5 다른 서브셋)나 OHLCV(A5)에는 없는 문제 |
| `error`/`error_code`(성공 응답 안의 의미 실패) | A4의 첨부파일 추출 한정 | `DARTSURVEY-chrisryugj-attachment-extract-PDF.json`의 `EMPTY_INPUT` — 다른 A4 사례(`get_today_date`)엔 없다 |
| `annotations`(content block 메타) | 모든 클래스에 필드는 존재하지만 62개 인스턴스 전부 `null` | 존재는 하되 이번 조사에서 값이 채워진 사례가 0건 — "있을 수 있는 필드"로만 스파인 밖에 적어둔다 |

---

## D. 담을 수 없는 것 — 카드가 정직하게 포기해야 하는 지점

1. **A6(중첩 트리)을 표로 펴는 것.** `TABLE_SCHEMA`(`canvas.py` L95-109)는 "레코드 배열"을 전제한다 — `jjlabsio get_disclosure`의 `{"?xml":"", "DOCUMENT": {...깊이 7+...}}}`은 배열이 아니라 트리다. `validate_canvas_payload()`가 스키마 불일치 시 `free`로 폴백하는 정확한 조건(`canvas.py` L149-157)이 이 클래스에 그대로 걸린다 — **A6은 공통 카드가 아니라 리더(② 신규) 또는 그마저 실패하면 `free`로 가야 한다.** `mcp-실행계획.md` L151: "1MB급 JSON을 통째로 받는다. 'TOC 먼저, 절은 지연 로드' 설계는 **불가능하다**" — 카드 한 장은커녕 전용 리더조차 페이지네이션을 포기했다.
2. **A3(구조화-산문)을 구조화 데이터처럼 렌더하는 것.** `structuredContent`가 있다고 표/스칼라 카드로 밀면 `{"result": "<마크다운 5문단>"}`을 그대로 테이블 셀 하나에 욱여넣는 사고가 난다 — 이건 리더가 받아야 한다.
3. **A7a(진짜 순수 텍스트)를 JSON 스키마로 강제하는 것.** `echo` 툴처럼 "그냥 문장"인 응답에 컬럼이나 스칼라 카드를 씌우면 거짓 구조를 만든다 — `free` 또는 최소한의 텍스트 카드로 가야 한다.
4. **에러(A1)를 캔버스로 보내는 것.** `result.py` 문서 주석(L4) 자체가 "캔버스로 보내지 말 것"이라고 명시한다 — 카드가 담을 수 있는 것과 담아선 안 되는 것을 코드가 이미 갈라놨다.
5. **응답 크기 상한을 카드가 조용히 무시하는 것.** `ResponseTooLargeError`(`client.py` L51-70)는 "자르지 않고 명시 에러로 거부"가 원칙이라고 밝힌다 — 카드가 "일부만 보여주고 나머진 자연스럽게 생략"하면 이 원칙을 어긴다. 실제로 실패로 거부된 상한 초과 사례가 이번 캡처엔 없다(전부 5,000,000자 상한 이내) — **이 실패 모드는 코드로만 존재하고 캡처로 실증되지 않았다.** 정직하게 "미확인"으로 남긴다.
6. **전송 계층 크래시/타임아웃/재시작.** `client.py`의 `ServerCrashedError`/`MaxRestartsExceededError`/`ServerStartupTimeoutError`가 있지만, `spike/captures/*.json` 어디에도 "이 캡처는 크래시 후 재시작된 세션에서 나왔다"는 흔적이 없다. `exception` 필드를 남기는 캡처 파밀리(`S2B-jjlabsio-SUMMARY.json` 등, `disclosure-survey.json`)조차 전부 `"exception": null`이다(74개 파일 전수 grep, 0건). **이 클래스의 실패(=CallToolResult 자체가 없는 실패)는 카드가 표현할 대상이 아니라 카드가 뜨기도 전에 걸러지는 상위 계층 이벤트다** — 카드 스펙 밖, 게이트웨이 상태 UI의 몫.
7. **동의(consent) 거부.** `GRAFT-verify.json`의 `unapproved_tool_direct`는 A1과 형상이 같지만 **발생 지점이 다르다**(upstream이 아니라 게이트웨이). 카드가 "왜 에러인가"까지 정직하게 구분하려면 이 출처 구분이 필요한데, 현재 캡처된 에러 텍스트만으로는 카드 레벨에서 upstream 에러와 게이트웨이 거부를 문자열 파싱 없이 구분할 방법이 없다 — **이건 카드 필드가 아니라 게이트웨이가 별도 필드로 얹어줘야 하는 정보**(현재 코드엔 그 필드가 없다, 격차로 기록).

---

## E. 기존 4종(스트림/리더/타임라인/테이블)과의 관계

`canvas.py`가 이미 구현한 4종 + `free`를 기준으로, 이번 조사의 7개 응답 형상 클래스가 그것들과 **관계**를 맺는다 — 대체가 아니라.

`plan/canvas-taxonomy.md`가 세운 원칙부터 인용한다: "TR을 화면 단위가 아니라 **데이터 형상 단위**로 접는다"(L13), 그리고 자유 캔버스는 "실패가 아니라 설계된 탈출구"이되 "자주 열린다면 캔버스 체계가 틀린 것"(L48, L69)이다. `mcp-실행계획.md` §9(L187-205)는 한 걸음 더 나아가 계층을 명문화했다:

```
자유 캔버스     ← 형상 자체를 모름               (최후의 탈출구)
공통 테이블     ← 레코드인 건 알되 스키마 모름    ★ 기본값
전용 캔버스     ← 형상·스키마 다 앎 (랭킹/호가/타임라인/체결로그)
```

이 계층에 A1~A7을 꽂으면:

| 응답 클래스 | 관계 | 근거 |
|---|---|---|
| A5(레코드-리스트) | **테이블에 흡수됨(subsume)** | `TABLE_SCHEMA`(`canvas.py` L95-109)가 정확히 "메타 + 배열 1개"를 받는다. `columns`가 없으면 `rows[0]`에서 유도한다는 설계(L21-22 docstring)가 A5의 11건 전부에 그대로 들어맞는다. **공통 카드가 새로 발명할 게 없다 — 이미 있다.** |
| A6(중첩 트리) | **리더가 흡수(subsume), 카드는 아예 못 가짐** | `READER_SCHEMA`(`canvas.py` L57-68)가 "문서 크기와 무관하게 항상 전문 반환"을 전제로 이미 설계돼 있다(§D-1 참조). 이건 새 캔버스가 필요한 게 아니라 **기존 리더가 이미 답이다.** |
| A7b(문서 봉투) | **리더와 보완(complement)** | 같은 문서를 다른 봉투로 담을 뿐 — A6과 A7b는 같은 상위 문제(장문 1건)의 서로 다른 서버 구현이다. 리더 하나가 두 형상 다 받는다. |
| A1(에러) | **어느 캔버스에도 안 감(conflict가 아니라 애초에 범위 밖)** | `result.py` L4가 "캔버스로 보내지 말 것"이라 명시. 4종 중 어느 것도 에러를 위해 설계되지 않았다 — 별도 에러 표시 UI(카드 자체가 아닌 카드의 "실패 상태")가 필요하다. |
| A2(구조화 미러)·A4(스칼라 객체) | **스트림/리더/타임라인/테이블 어디에도 딱 안 맞음 — §3의 "기존 캔버스 2종 일반화"가 답** | `mcp-실행계획.md` L208: "`#5 종목 스냅샷` → **스칼라 카드 묶음** 일반화." 그런데 `04-공통카드-기존결정-대조.md` L49가 이미 지적했듯 **스칼라 카드 묶음은 `canvas.py`에 구현돼 있지 않다**(`CANVAS_SCHEMAS`엔 4종뿐) — **문서 결정과 코드 사이의 갭이고, 공통 카드가 메워야 할 진짜 빈자리는 여기다.** |
| A3(구조화-산문) | **리더와 보완, 단 테이블과는 충돌** | 산문이므로 리더가 자연스럽다. `structuredContent`가 있다고 테이블/공통카드로 보내면 A3은 **테이블 스키마와 충돌**한다(§D-2) — `validate_canvas_payload()`가 스키마 불일치 시 `free`로 떨어뜨리는 것과 동일한 안전장치가 공통 카드에도 있어야 한다. |

**결론**: 공통 카드는 스트림·리더·타임라인·테이블 4종을 대체하지 않는다. `canvas-taxonomy.md`가 이미 "형상을 알면 승격한다"(L203 인용은 `mcp-실행계획.md` 쪽)고 밝힌 대로, **공통 카드가 진짜로 새로 채우는 자리는 A2/A4(스칼라 계열 — 문서엔 있으나 코드엔 없는 "스칼라 카드 묶음")뿐이고, A5는 이미 있는 테이블에, A6·A7b는 이미 있는 리더에 얹으면 된다.** A1(에러)·A3(구조화-산문)은 어느 캔버스에도 그대로 밀어넣으면 안 되는 형상이라는 점도 코드(`result.py`)와 실측(A3 사례) 양쪽에서 확인된다.
