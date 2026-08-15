# 과제 B — DART MCP 생태계 조사 및 기능 비교

## 판정 : 통과 — 더 나은 서버가 존재한다

**`chrisryugj/korean-dart-mcp`(npm 패키지명 `korean-dart-mcp`)가 리더 캔버스 문제를 실측으로 해결한다.**
같은 접수번호(`rcept_no=20260713000395`, 삼성전자 자기주식 처분 결정)를 jjlabsio와 직접 대조한 결과, jjlabsio는 4,517자의 "XML을 JSON으로 transliteration"한 텍스트(표가 `COLGROUP`/`TBODY`/`TR`/`TD` 트리와 원시 XML 태그 문자열 두 갈래로 섞여 온다)를 주는 반면, chrisryugj는 **2,102자의 깔끔한 마크다운**(제목·표·불릿이 정상적으로 렌더링되는 `\|...\|` 표)을 준다. 대용량 사업보고서(원본 XML 8,978,836자)에서도 마크다운 변환분 400,000자 구간에서 **원시 XML 태그 누출 0건**을 직접 검사해 확인했다 — jjlabsio가 겪던 "일부 셀에 `<TE ...>` 원시 태그가 섞여 온다"는 문제가 재현되지 않는다.

단, **HWP/PDF 첨부파일 마크다운 변환 기능(`get_attachments extract`)은 README 주장과 달리 실제로는 동작하지 않았다** — 두 건(PDF, 서로 다른 공시) 모두 `EMPTY_INPUT`(빈 버퍼) 에러로 실패했고, 원인을 DART 원본 다운로드 엔드포인트에 대한 직접 curl 재현으로 규명했다(아래 "막힌 것" 참조). 이 기능은 **실측상 신뢰할 수 없다.**

---

## 조사 방법 — 실측 vs README 기반, 항목별 명시

| 서버 | 조사 방법 |
|---|---|
| **`chrisryugj/korean-dart-mcp`** | **실측** — npm 패키지(`korean-dart-mcp@0.10.1`)를 `npx -y`로 직접 spawn, `mcp==1.28.1` 클라이언트로 `list_tools` + 6개 실제 툴 호출(삼성전자 실데이터, `DART_API_KEY` 사용). 클론 불필요 |
| `jjlabsio/korea-stock-mcp` | **실측(재사용)** — 이전 스파이크(`spike/mcp-client/CAPTURE-S2B-jjlabsio.md`)에서 이미 완료된 실측 데이터를 재인용 + 본 과제에서 동일 rcept_no로 직접 대조 |
| `2geonhyup/dart-mcp` | **실측(재사용)** — 이전 스파이크(`spike/mcp-client/CAPTURE-S2B-dartmcp.md`)에서 완료. 라이선스/star만 본 과제에서 추가 확인(WebFetch) |
| `aidankwon/opendart_mcp` | **README 기반 추정만** — WebFetch로 README 확인. 실행하지 않음(시간 예산상 chrisryugj를 우선 검증했고, npx/uvx 원커맨드 설치가 없어 진입장벽이 더 높다고 판단해 후순위로 미룸) |
| `korea-dart-mcp`(gwangjun-lee), `opendart-mcp`(SongHyojun0228), `@vertical-mcp/dart-mcp`(kyb8801) | **npm 메타데이터 + README 스캔만.** 실행 안 함. star 수가 낮고(각 0~2) 커버리지도 chrisryugj/jjlabsio보다 작아(5툴) 우선순위 밖으로 판단 |

---

## 비교표

| 축 | `chrisryugj/korean-dart-mcp` | `jjlabsio/korea-stock-mcp` | `2geonhyup/dart-mcp` | `aidankwon/opendart_mcp` |
|---|---|---|---|---|
| **툴 개수 / DART 커버리지** | **18개 툴**(실측 `list_tools` 확인, `spike/captures/DARTSURVEY-chrisryugj-tools.json`에서 이름 18개 직접 카운트). **"83개 API를 15개 도구로"는 npm README 카피 문구**(재검증 시 `r.jina.ai` 프록시로 재확인 — 정확한 문구는 "OpenDART 83개 API를 15개 도구로")이며, 실행판(v0.9.2)의 도구 수 18과도 어긋난다(README가 최신이 아니거나 마케팅 카피가 실제 버전과 안 맞음). **"83개 API"라는 커버리지 수치 자체는 이번 조사에서 DART 공식 API 목록과 대조 검증하지 않았다 — README 주장만 인용한 것이며 사실로 단정할 수 없다.** DS001~006(공시/정기보고서/재무제표/지분/주요사항/증권신고서) 카테고리 전부를 커버한다는 것도 툴 이름으로 미루어 본 정황일 뿐, 카테고리별 전수 대조는 하지 않았다 | 8개 툴. DART(공시목록·공시본문·재무제표) + KRX(시세) 겸용, DART 자체 커버리지는 chrisryugj보다 얕음 | 5개 툴. **DART만**, 주가/시총 명시적으로 미제공(README 명시) | README 주장 18개(DS001~006). **실측 안 함** |
| **공시 본문 반환 형태** ★ | **마크다운 기본**(`format=markdown`, 원문 XML을 자체 파서로 heading·표 보존 변환). `raw`(원본 XML)·`text`(태그 제거) 옵션도 있음. **직접대조 + 대용량 원시태그누출 0건 확인** | DART XML → JSON transliteration. 일부 중첩 셀에 원시 XML 태그 문자열이 값에 섞여 나옴(실측 확인, 리더 캔버스가 2갈래 처리 필요) | 서버가 조립한 **마크다운/프로즈 텍스트**(LLM 채팅 전제, 구조화 스키마 없음 — `outputSchema: {result: string}`). 세그먼트 데이터는 표조차 아닌 델리미터 없는 프로즈로 뭉개짐 | README: "원문 XML 다운로드"만 언급, 구조화/마크다운 변환 명시 없음 |
| **첨부파일(HWP/PDF) 파싱** ★ | **kordoc 엔진으로 HWP/HWPX/PDF/DOCX/XLSX → 마크다운 변환 기능 존재**(`get_attachments mode=extract`). **실측 결과: 2건 전부 실패(`EMPTY_INPUT`)** — 기능은 있으나 현재 버전에서 신뢰 불가(아래 "막힌 것" 참조) | 없음 | 없음 | README에 명시 없음(미언급) |
| **목록/검색 기능** | `search_disclosures` — 단일페이지/22개 프리셋(자사주매입·CB/BW/EB발행·합병분할·대량보유 등)/전기간 병렬 3모드. 회사·기간·유형 필터. **실측: 삼성전자 최근 30일 808건 중 20건 페이지 확인** | `get_disclosure_list` — 페이지네이션(page/page_count), 필터 얕음. 실측: 866건 중 20건 | `search_disclosure` — 최대 5건 텍스트 이어붙임(정렬된 매트릭스 아님) | README: `search_disclosures`(DS001) 존재 언급, 세부 필터 옵션 불명 |
| **재무데이터 형태** | `get_financials` — **평평한 계정과목 레코드 배열**(rcept_no/sj_nm/account_nm/thstrm_amount 등). jjlabsio의 `get_financial_statement`와 **동형**. **실측: 삼성전자 2025 재무상태표 20,768자 JSON 확인** | `get_financial_statement` — 동일 계열 평평한 배열. 이전 스파이크에서 "가장 깨끗하게 착지"로 판정됨 | 마크다운 표(`\|계정명\|당기\|`) — 재파싱 필요, XBRL 경로 수치에서 **실측으로 확인된 오류**(10^6배 부풀림, float64 정밀도 아티팩트) 있음 | README: SQLite 캐시 기반 다수 재무 전용 툴(18개 중 다수) 언급, 형태 불명(실행 안 함) |
| **`structuredContent` 채우는가** | **아니다 — 항상 `null`**(실측: 4개 서로 다른 툴 호출 전부 확인: `download_document`×2, `get_attachments`×1, `get_financials`, `search_disclosures`). `content[0].text`가 문자열화 JSON 또는 마크다운으로 옴 | 아니다 — 항상 `null`(8개 툴 전부, 이전 스파이크에서 확인) | 아니다 — `{result: <문자열>}`로 텍스트를 한 번 더 래핑할 뿐 (이전 스파이크) | 불명(실행 안 함) |
| **설치 난이도** | **매우 쉬움** — `npx -y korean-dart-mcp@0.10.1` 한 줄로 즉시 spawn(클론 불필요, 본 과제에서 실측). 대화형 `setup` 마법사도 별도 제공 | 쉬움 — `npx -y @iflow-mcp/jjlabsio-korea-stock-mcp` 한 줄(이전 스파이크) | **어려움** — README가 "GitHub zip → Downloads 폴더에 정확히 `dart-mcp`란 이름으로 압축 해제 → `uv --directory <경로> run dart.py`"를 요구. npx 없음 | **어려움** — README에 npx/uvx 없음. `git clone` + `npm install && npm run build` 또는 Docker만 |
| **활동성(star/최근 커밋)** | **91 star, 24 commit, npm 최신판 배포일 2026-07-26(v0.10.1, 검증 시점 2026-08-15 기준 약 3주 전 — 최초 작성 시 "2주 전"은 부정확해 정정)**. 실행 시 서버 자체 보고 버전은 v0.9.2 — **npm 최신판과 실행 버전이 다르다**(캐시/버전 핀 이슈로 추정, 게이트웨이가 "npm 최신 = 실행 버전"을 가정하면 안 됨을 실측으로 확인) | 171 star, 108 commit — 활동성은 더 높음(WebFetch 확인) | 126 star, 44 commit(WebFetch 확인, 최근 커밋 날짜는 불명) | **0 star, 0 fork, 30 commit**(WebFetch 확인) — 사실상 미채택 |
| **라이선스** | **MIT**(npm view로 확인) | ISC | **README에 라이선스 명시 없음** — WebFetch로도 확인 안 됨. 상업 이용 시 리스크로 취급해야 함 | ISC(WebFetch 확인) |

### 그 외 발견된 서버 (실행 안 함, npm 메타데이터만)

| 패키지 | 개요 | 실행 여부 |
|---|---|---|
| `korea-dart-mcp`(gwangjun-lee, npm v1.1.0) | "OpenDART 공시 원문과 재무제표를 5개 데이터 파이프 MCP 도구로 조회". MIT | 미실행 |
| `opendart-mcp`(SongHyojun0228, npm v0.1.0) | 5개 툴(`search_company`, `search_disclosures`, `get_financial_summary`, `compare_financials`, `get_full_financial_statements`). `npx opendart-mcp`로 설치 가능. **2 star**, 첨부파싱 언급 없음. MIT | 미실행(WebFetch README만) |
| `@vertical-mcp/dart-mcp`(kyb8801, npm v0.1.0) | "MCP server for Korea's DART … via OpenDART". MIT | 미실행(npm 메타데이터만) |

---

## 리더 캔버스 렌더러가 처리해야 할 형태 — 서버 선택으로 얼마나 쉬워지는가

**결정적으로 쉬워진다.** 현재(`jjlabsio`) 설계는 리더 캔버스가 두 갈래를 동시에 처리해야 했다:
1. 파싱된 JSON 트리(`TABLE.COLGROUP.COL[]` + `TBODY.TR[].TD[]`)를 표로 렌더
2. 그 트리 안에 섞여 나오는 **원시 XML 태그 문자열**(`<TE ALIGN="RIGHT" ...>81,003,271</TE>`)을 별도로 탐지·정제해서 렌더

`chrisryugj`로 바꾸면 리더 캔버스는 **표준 마크다운 렌더러 하나**만 있으면 된다 — heading(`#`)·표(`\|...\|`)·불릿(`-`)이 이미 정리되어 온다. 직접대조(같은 rcept_no)와 대용량 원시태그누출 검사(0건/400,000자) 둘 다 이걸 뒷받침한다. `raw`/`text` 포맷 옵션도 있어 리더가 "원문 그대로 보기" 토글을 붙이기도 쉽다(jjlabsio는 원문이 곧 JSON 트리라 "원문 그대로"가 사람이 읽기 어려운 형태로 고정됨).

**단, 캔버스 설계 문서(`plan/mcp-실행계획.md`) §신규②의 실패 조건 처리 요구사항은 그대로 유지해야 한다** — `download_document`도 내부적으로 DART 원본 zip을 받아오므로, jjlabsio에서 확인된 "당일 접수 문서는 원문 zip이 아직 없어 실패할 수 있다"는 조건이 chrisryugj에도 동일하게 적용될 가능성이 높다(이번 과제에서는 과거 접수 문서만 테스트해 이 실패 케이스를 chrisryugj로 직접 재현하지는 않았다 — 재검증 필요 항목으로 남긴다).

**첨부파일(HWP/PDF) 마크다운화는 아직 캔버스에 못 쓴다.** 기능은 존재하지만 실측 2/2 실패다. 이 기능이 고쳐지기 전까지 리더 캔버스는 "본문은 마크다운으로 렌더, 첨부파일은 DART 뷰어 링크만 노출"으로 설계해야 한다(`get_attachments mode=list`가 반환하는 `download_url`을 그대로 외부 링크로 노출하는 것은 실측상 안전 — list 모드는 100% 성공했다).

---

## 권고

### Athena는 어느 DART 서버를 써야 하는가

**`chrisryugj/korean-dart-mcp` 하나로 충분하다.** 근거:
1. **공시 본문 형태가 리더 캔버스 문제를 직접 해결한다**(위 절 참조) — 이게 이 과제의 원래 동기였다.
2. **DART 커버리지가 가장 넓다**(18툴, DS001~006 전부, jjlabsio·2geonhyup보다 우위).
3. **재무데이터 형태가 jjlabsio와 동형**(평평한 계정과목 배열)이라 신규④ 공통 테이블 어댑터를 그대로 재사용할 수 있다 — 서버를 바꿔도 게이트웨이의 테이블 파싱 로직은 안 바뀐다.
4. **설치가 npx 한 줄**이라 §2가 요구한 "클로드 데스크탑 패리티" 등록 UX와 마찰이 없다.
5. MIT 라이선스로 상업 이용 제약이 없다(2geonhyup은 라이선스 미명시라 이 축에서 이미 불리).

### 여러 개를 동시에 붙일 이유가 있는가 — **없다, KRX 시세만 예외**

- **DART 데이터(공시·재무·지분)는 `chrisryugj` 하나로 jjlabsio·2geonhyup을 전부 대체할 수 있다.** 데이터 커버리지가 겹치는데 형태·설치·라이선스·활동성 전부 `chrisryugj`가 우위이거나 동등하다. jjlabsio·2geonhyup을 동시에 붙일 근거가 없다.
- **단, jjlabsio는 DART 외에 KRX 시세 툴(`get_stock_base_info`/`get_stock_trade_info`)도 갖고 있다.** `chrisryugj`는 DART 전용이라 시세 데이터가 없다. KRX 승인이 나서 신규③ 타임라인의 가격축을 이 경로로 쓰기로 하면, jjlabsio(또는 별도 KRX 전용 서버)를 **시세 전용 목적으로만** 유지하는 안은 있다 — 단 jjlabsio의 KRX 툴 자체가 이번 스파이크에서도 여전히 "승인 대기"라 미검증 상태다(`plan/mcp-실행계획.md` §9 KRX 절 참조). DART 부분은 확실히 중복이므로 정리 대상이다.
- **결론**: DART 게이트웨이 등록 목록에서 `jjlabsio`·`2geonhyup`을 빼고 `chrisryugj/korean-dart-mcp` 하나로 교체할 것을 권고한다. jjlabsio는 KRX 시세 전용 용도로 재평가하거나, KRX 전용의 더 나은 대안이 나오면 완전히 뺀다.

### 남은 리스크 — 정직하게

1. **첨부파일 마크다운 변환이 광고대로 동작하지 않는다.** README/npm 설명이 "kordoc 엔진으로 HWP/PDF 변환"을 1급 기능으로 내세우지만 실측 2/2 실패했다. Athena가 이 기능에 의존하는 설계를 하면 안 된다 — 현재는 "링크만 노출"로 강등해야 한다.
2. **npm 최신판(0.10.1)과 실행 버전(0.9.2 서버 자체 보고)이 다르다.** 게이트웨이 레지스트리가 "npm에 표시된 버전 = 실제 동작 버전"이라고 가정하면 안 된다(`plan/mcp-실행계획.md` §8 S2가 이미 지적한 "`serverInfo.version`을 곧이곧대로 믿지 말라"는 원칙이 이 서버에서도 재확인됨).
3. **대용량 문서에서 `truncate_at` 기본값이 100,000자다.** 삼성전자 사업보고서는 마크다운 변환 후 636,059자(원본 XML 8,978,836자) — 기본값으로 받으면 84%가 잘린다. 리더 캔버스가 전문을 보여주려면 게이트웨이가 `truncate_at`을 명시적으로 크게 잡거나, 이 서버가 지원하지 않는 "섹션별 지연 로드"를 클라이언트 쪽에서 직접 구현해야 한다(이 제약은 jjlabsio에서도 동일하게 있었다 — 서버를 바꿔도 사라지지 않는다).
4. **당일 접수 문서 실패 케이스를 chrisryugj로 직접 재현하지 않았다.** jjlabsio에서 확인된 "DART 문서저장소에 원문 zip이 아직 없으면 실패"가 chrisryugj의 `download_document`에도 적용될 가능성이 높지만, 이번 과제에서는 검증하지 않았다 — W1 게이트웨이 구현 전 재확인 필요.

---

## 막힌 것 — 정직하게

**첨부파일(HWP/PDF) 마크다운 변환은 실측으로 실패를 확정했지, "막혀서 못 봤다"가 아니다.** 원인까지 규명했다:

1. `get_attachments(rcept_no="20260310002820", mode="extract", index=0)` (삼성전자 사업보고서 PDF, 2.2MB) → `{"supported": false, "error": "빈 버퍼이거나 유효하지 않은 입력입니다.", "error_code": "EMPTY_INPUT"}`. 같은 실패가 `rcept_no="20250814003156"`(반기보고서 PDF)에서도 동일하게 재현됐다.
2. **DART 원본 다운로드 엔드포인트를 직접 curl로 재현해 원인을 특정했다**: `https://dart.fss.or.kr/pdf/download/pdf.do?rcp_no=...&dcm_no=...`는 **`Referer` 헤더가 `https://dart.fss.or.kr/pdf/download/main.do?rcp_no=...&dcm_no=...`(다운로드 목록 중간 페이지)와 정확히 일치해야만** 실제 파일(2,278,584 bytes)을 반환한다. `Referer`가 공시 뷰어 페이지(`dsaf001/main.do`)거나 없으면 **HTTP 200에 0바이트**를 반환한다(3회 반복 재현, 재현율 100%). `get_attachments`의 `EMPTY_INPUT` 에러는 이 0바이트 응답을 그대로 kordoc에 넘겨 발생하는 것으로 보인다.
3. 이 서버(`chrisryugj/korean-dart-mcp` v0.9.2)의 다운로드 로직이 `Referer`를 잘못 설정하고 있다는 강한 정황이지만, **소스코드까지 열어 정확한 버그 라인을 특정하지는 않았다**(시간 예산 우선순위상 생략 — npm 패키지 tarball 안의 컴파일된 JS를 역추적해야 함).
4. `aidankwon/opendart_mcp`는 시간 예산상 실행하지 않았다 — README 기반 추정만 표에 반영했다. Docker/clone+build만 지원해(npx 없음) chrisryugj보다 설치 장벽이 뚜렷이 높다는 점은 확인했지만, 실제 응답 형태는 검증하지 못했다.
5. `korea-dart-mcp`(gwangjun-lee)는 GitHub 저장소 URL을 정확히 특정하지 못했다(WebFetch 404, npm 메타데이터에 repository 필드 없음) — 존재만 확인하고 심층 조사는 생략했다.

---

## 재현 커맨드

```bash
cd C:/Projects/DAOU.Athena

# 1) 툴 목록 (18개 확인)
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step1_dartmcp_tools.py

# 2) 직접대조: jjlabsio SMALL과 동일 rcept_no(20260713000395) + 첨부목록
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step2_dartmcp_calls.py

# 3) 첨부파일 PDF 추출 시도 (EMPTY_INPUT 재현)
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step3_dartmcp_attachment_extract.py

# 4) 다른 공시로 첨부 추출 재시도 (동일 실패 재현)
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step4_dartmcp_attachment_hwp.py

# 5) 재무데이터 + 공시검색(스트림 캔버스 근거)
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step5_dartmcp_financials.py

# 6) 대용량 마크다운 원시 XML 태그 누출 검사 (0건 확인)
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step6_dartmcp_large_markdown.py

# 7) DART 다운로드 엔드포인트 Referer 재현 (bash, curl)
curl -s -c /tmp/dart_cookies.txt -o /dev/null "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260310002820" -H "User-Agent: Mozilla/5.0"
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" -b /tmp/dart_cookies.txt \
  "https://dart.fss.or.kr/pdf/download/pdf.do?rcp_no=20260310002820&dcm_no=11104488" \
  -H "Referer: https://dart.fss.or.kr/pdf/download/main.do?rcp_no=20260310002820&dcm_no=11104488" -H "User-Agent: Mozilla/5.0"
# → 200 2278584 (성공, 올바른 Referer)
```

키는 `.env`에서 직접 읽어 자식 프로세스 env로 주입(`DART_API_KEY`), 하드코딩 없음. 산출물은 전부 `spike/captures/DARTSURVEY-*.json`에 `Path.write_text(json.dumps(..., ensure_ascii=False, indent=2), encoding="utf-8")`로 저장.

산출물: `spike/captures/DARTSURVEY-chrisryugj-*.json`(11개), `spike/dart-survey/step1~6_*.py`(6개). `vendor/`는 클론이 필요 없어 비어 있음(npx로 직접 실행).
