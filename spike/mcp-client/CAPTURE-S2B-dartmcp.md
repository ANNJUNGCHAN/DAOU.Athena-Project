# S2B — `2geonhyup/dart-mcp` (재무 분석 특화)

## 판정 : 부분통과

`list_tools()`와 삼성전자 대상 실제 데이터 호출(매출/영업이익, 세그먼트 매출, 손익계산서) 전부 성공했다. 한글 인코딩 손상도 없었다. 다만 **응답 형상이 계획이 가정한 "구조화 JSON"이 아니라 서버가 조립한 마크다운/프로즈 텍스트 한 덩어리**였고, 그 텍스트 안에서 실제 데이터 오류(뒤의 "데이터 형상" 절 참조)를 발견해 완전통과로는 못 준다.

## 캡처한 것

| 툴 | 캡처 파일 | 응답 형상 요약 |
|---|---|---|
| `list_tools()` | `spike/captures/S2B-dartmcp-tools.json` | 툴 5개: `search_disclosure`, `search_detailed_financial_data`, `search_business_information`, `get_current_date`, `search_json_financial_data`. 전부 `outputSchema.properties = {result: string}` — FastMCP가 `-> str` 반환형을 그대로 감싼 것. 구조화 스키마가 없다. |
| `search_disclosure(company_name="삼성전자", requested_items=["매출액","영업이익"], 20240101~20240401)` | `spike/captures/S2B-dartmcp-search_disclosure-revenue.json` | `content[0].text` = 마크다운 헤더+불릿 리스트 문자열. `structuredContent`에도 `{"result": "<같은 문자열>"}` 형태로 동일 텍스트가 한 번 더 옴(파싱 가능한 필드가 아니라 그냥 문자열 래핑). |
| `search_business_information(information_type="매출 및 수주상황")` | `spike/captures/S2B-dartmcp-search_business_information-segment.json` | DART 사업보고서 원문 섹션을 그대로 오려붙인 **비정형 프로즈**(줄바꿈도 제거된 채 공백으로 이어붙임). 부문별(DX/DS/SDC/Harman) 매출액 수치가 표 형태였던 원문이 델리미터 없는 연속 텍스트로 뭉개져서 옴. |
| `search_json_financial_data(company_name="삼성전자", bsns_year="2023", reprt_code="11011", fs_div="CFS", statement_type="IS")` | `spike/captures/S2B-dartmcp-search_json_financial_data-IS.json` | 마크다운 표(`\| 계정명 \| 당기 \|`) 문자열. 손익계산서 17개 계정과목, 값은 정상(예: 영업수익 258,935,494,000,000원). |

## 데이터 형상 → 캔버스 착지

**계정과목 × 회계기간 매트릭스가 아니다.** 서버가 의도적으로 "당기(현재 회계기간) 데이터만 표시"하도록 코드에 하드코딩되어 있다(`search_json_financial_data` 결과 텍스트에 "전기/전전기 데이터는 제외됨"이라고 명시). `search_disclosure`는 최대 5개 공시를 순회하며 공시별로 텍스트 블록을 이어붙이는 방식이라 시계열처럼 보이지만 실제로는 "공시 5건 각각의 단일 시점 스냅샷"이지 정렬된 매트릭스가 아니다. 계정과목×기간 매트릭스를 만들려면 게이트웨이가 이 툴을 회계기간별로 여러 번 호출해 직접 스티칭해야 한다.

- 모든 응답이 **문자열 하나**(`content[0].text` == `structuredContent.result`)로 온다. `outputSchema`가 `{result: string}`이라 이 서버는 애초에 구조화 데이터를 낼 생각이 없다 — LLM이 채팅창에서 마크다운을 렌더링해서 보여주는 걸 전제로 설계됨.
- **착지점은 사실상 신규② 리더뿐이다.** 신규④ 공통 테이블에 넣으려면 게이트웨이가 마크다운 `|계정명|당기|` 표를 정규식/마크다운 파서로 재파싱해야 한다(취약함 — 서버가 스키마를 보장하지 않으므로 텍스트 포맷이 바뀌면 파서가 깨진다). `search_business_information`(세그먼트 매출)은 표조차 아니고 원문이 공백으로 뭉개진 프로즈라 숫자 추출 자체가 불안정하다 — 계획이 근거로 든 "기업의 사업부별 매출"은 **구조화된 세그먼트 테이블이 아니라 사람이 읽는 사업보고서 발췌문**임을 확인.
- `get_current_date`는 기존 #5 스칼라 카드에 해당.
- **⚠️ 데이터 오류 발견**: `search_disclosure`가 반환한 XBRL 파싱 값이 깨져 있다. 1분기 매출액이 `"71,915,600,999,999,995,904"`(1.4교 규모 — 실제로는 약 71.9조여야 함, `search_json_financial_data`가 반환한 같은 회사 영업수익 `258,935,494,000,000`과 비교하면 자릿수가 약 10^6배 부풀려져 있고 float64 정밀도 한계(2^53)를 넘는 자리에서 `999999995904` 같은 부동소수점 아티팩트가 그대로 노출됐다). 영업이익도 `"6,606,009,000,000,000,000"`로 동일 패턴. **`search_json_financial_data`(JSON API 경로)는 같은 회사·같은 연도 손익계산서 값이 정상이었다** — 즉 이 서버 안에서도 XBRL 파싱 경로(`search_disclosure`, `search_detailed_financial_data`)와 JSON API 경로(`search_json_financial_data`)의 신뢰도가 다르다. 게이트웨이가 이 서버를 쓴다면 XBRL 경로 수치는 검증 없이 신뢰하면 안 된다.

## 한글 인코딩 : 정상

캡처 파일 4개 전부 `�` 0건 (`△`, `ㆍ`, `제ㆍ상품` 같은 특수 한자/기호 포함해서도 손상 없음). 이 서버는 Python/FastMCP stdio 서버라 이전 스파이크의 가설("한글 손상은 Node/npx `@drfirst/korea-stock-mcp` 하나에 국한된다")과 일치 — 두 번째 독립 사례(pykrx-mcp에 이어)로 그 가설을 보강한다.

주의: 캡처 스크립트(`step2b_dartmcp_calls.py`)의 진행상황 `print(..., file=sys.stderr)`를 백그라운드 셸로 리다이렉트한 로그에는 `?Ｚ????`류의 깨짐이 보였다 — 이건 RESULT.md가 이미 지적한 "콘솔 cp949 리다이렉션 아티팩트"이지 MCP 응답 자체의 손상이 아니다. 실제 판정은 `Path.write_text(..., encoding="utf-8")`로 저장한 캡처 파일로만 했다.

## 막힌 것 — 정직하게

- `search_detailed_financial_data`(재무상태표/현금흐름표 세부 + 다중 공시 비교표를 만들 것으로 기대했던 툴)는 시간 예산(30분) 안에 호출하지 못했다. `search_json_financial_data`로 손익계산서만 대체 검증했다.
- XBRL 파싱 경로의 수치 오류(위 "데이터 오류 발견") 근본 원인은 이 서버의 `parse_xbrl_financial_data`/`format_numeric_value` 내부 로직 문제로 추정만 했다 — 소스를 열어 정확한 버그 라인까지는 특정하지 않았다(시간 예산 초과 방지).
- `search_business_information`의 나머지 6개 `information_type`(사업의 개요, 원재료 등)은 캡처하지 않았다 — 첫 번째(`매출 및 수주상황`)로 형상 판단에 충분하다고 보고 중단.

## jjlabsio와 중복인가, 보완적인가

**형상이 근본적으로 다르므로 중복이 아니라 상호 대체 불가능한 관계에 가깝다.**

- **범위**: dart-mcp는 DART(공시·재무제표·사업보고서 텍스트)만 다룬다. README가 명시적으로 "주가 및 시가총액 제공 불가"라고 밝힌다. jjlabsio는 DART+KRX를 한 서버에서 합쳐 놓았다(공시/재무 + 시세/종목정보).
- **키 요구사항**: dart-mcp는 `DART_API_KEY` 하나만 있으면 **즉시 실제 데이터가 나온다**(이번 스파이크에서 검증). jjlabsio는 이전 스파이크(S2)에서 DART 키만으로는 전부 거부됐고 KRX 키도 별도로 필요했다(`"There is no KRX API KEY"`) — 이번 W3 `.env`에는 `DART_API_KEY`와 `KRX_API_KEY`가 둘 다 있으므로 jjlabsio도 이제 뚫릴 가능성이 있지만 **이번 스파이크 범위 밖이라 재검증하지 않았다.**
- **응답 형상**: (검증 통과 후 정정) 이 문서 초안 시점에는 "jjlabsio 실데이터 미캡처"라고 적었으나, 같은 스파이크 세션 안에서 별도 스크립트(`step_s2b_disclosure*.py`)가 `spike/captures/S2B-jjlabsio-*.json`으로 jjlabsio 실데이터를 이미 캡처해 두었다(예: `get_disclosure_list`, `get_financial_statement` 성공). 그 실데이터로 재확인한 결과 — **jjlabsio도 프로토콜 레벨의 `structuredContent`는 `null`이라 dart-mcp와 동일하게 `content[0].text` 하나로 온다.** 다만 그 `text` 문자열 자체가 dart-mcp처럼 마크다운/프로즈가 아니라 **파싱 가능한 JSON 문자열**이다(예: `get_disclosure_list` → `{"status":"000","message":"정상","list":[{...}]}`, `get_financial_statement` → 계정과목 배열 JSON). 즉 "jjlabsio가 구조화 JSON을 반환한다"는 이전 추측은 결과적으로 맞았지만, 근거를 "미확인 추정"이 아니라 "text 안에 JSON.parse 가능한 문자열이 온다(단, MCP `structuredContent` 필드 자체는 아니다)"로 정정한다. dart-mcp는 **의도적으로 마크다운/프로즈 텍스트만 반환**한다(`outputSchema`가 전부 `{result: string}`이고 텍스트도 마크다운). 같은 DART 데이터라도 게이트웨이 파싱 전략이 완전히 달라야 한다 — jjlabsio는 `text`를 `JSON.parse`로, dart-mcp는 마크다운 파서 또는 원문 그대로 리더 캔버스 전달로.
- **결론**: "같은 DART 키로 두 서버를 다 붙일 이유"는 **약하다.** 데이터 커버리지는 겹치는데(공시, 재무제표) dart-mcp 쪽이 텍스트로 뭉개져 있어 구조화 파이프라인(신규④ 테이블, 신규③ 타임라인)에는 jjlabsio가 우월하다(이제 실데이터로 확인됨 — `text`가 유효한 JSON이라 재파싱이 dart-mcp의 마크다운 표보다 훨씬 안정적이다). 반대로 **신규② 리더 캔버스**(장문 문서 그대로 보여주기) 용도로는 dart-mcp가 오히려 유리하다 — 이미 사람이 읽기 좋은 마크다운으로 정리해서 주기 때문에 게이트웨이 가공이 거의 필요 없다. 즉 "중복"이라기보다 **같은 원천 데이터를 다른 캔버스 두 개(테이블 vs 리더)에 각각 착지시키는 보완 관계**에 가깝다. (이 절은 검증 패스에서 `S2B-jjlabsio-*` 실데이터 대조로 확정 결론으로 승격했다 — 원래 초안의 "잠정 결론" 표현은 이 문서를 쓰던 시점에 옆에서 동시 진행 중이던 다른 캡처를 놓친 것이었다.)

## 설치 난이도

- **일반 사용자 기준: npx 서버보다 뚜렷이 어렵다.** README가 "GitHub zip 다운로드 → 압축 해제 → **반드시 Downloads 폴더에, 폴더명도 정확히 `dart-mcp`로** → Claude Desktop 설정에 `uv --directory <절대경로> run dart.py` 입력"을 요구한다. 이 폴더 위치/이름 강제는 npx 서버의 "패키지명 한 줄"보다 실패 지점이 훨씬 많다(경로 오타, OS별 사용자 폴더 표기 차이 등).
- 이번 스파이크는 그 경로 관행을 따르지 않고 `spike/mcp-client/vendor/dart-mcp`에 클론한 뒤, 공용 `.venv`의 python으로 `dart.py`를 직접 실행하는 방식으로 우회했다 — `uv`가 요구하는 `httpx`/`python-dotenv`가 이미 `.venv`에 있어서 추가 설치 없이 바로 spawn됐다(`mcp[cli]`도 이미 만족).
- **Athena 레지스트리 관점**: `uv --directory <path> run dart.py` 자체는 표준적인 command/args 패턴이라 레지스트리가 클론 경로만 알아서 채워주면 자동화 가능하다. 문제는 README가 사용자에게 그 사실을 숨기고 "Downloads에 두고 이름 바꿔라"는 수작업 지시를 준다는 점 — 레지스트리가 이 서버를 온보딩 목록에 넣는다면 README 절차를 그대로 노출하지 말고 `--directory`에 실제 클론 경로를 자동 주입해야 한다.

---

산출물: `spike/captures/S2B-dartmcp-*.json` (4개), `spike/mcp-client/vendor/dart-mcp/`(클론, `.gitignore`에 `vendor/` 추가함), `spike/mcp-client/step2b_dartmcp_tools.py`, `spike/mcp-client/step2b_dartmcp_calls.py`.
