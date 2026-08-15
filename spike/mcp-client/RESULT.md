# S2 — Python MCP 클라이언트 왕복

## 판정 : 부분통과

- **단계 1(프로토콜 왕복, 키 불필요, "반드시 성공해야 함")** — **완전 통과.** 게이트웨이 설계(안 B)를 폐기할 이유 없음.
- **단계 2(실제 한국 투자 MCP 서버)** — **부분통과.** 키 불필요 서버 2개(`pykrx-mcp`, `@drfirst/korea-stock-mcp`)에서 실제 데이터 캡처에 성공했으나, **계획 문서에 없던 신규 리스크**를 발견했다: **`@drfirst/korea-stock-mcp`(Node/npx) 하나에서** 응답에 담긴 한글 텍스트가 `U+FFFD`(치환 문자)와 오염된 한자 혼합으로 **비가역 손상**된다(재현 확인, 2회 재실행 동일). **`pykrx-mcp`는 한글이 손상 없이 정상 캡처된다** — `env=None` 기본 실행뿐 아니라 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`를 자식 프로세스 env로 명시 주입한 조건에서도 정상이었다(공식 캡처 방식으로 재확인). 최초 초안은 pykrx도 손상되며 env 주입이 오히려 정상 응답을 깨뜨린다고 적었으나, **두 주장 모두 독립 검증에서 재현되지 않아 정정한다**(아래 §단계 2-A, §독립 검증 기록 참조 — 처음 관찰된 깨짐은 검증용 `print()` 리다이렉션이 만든 아티팩트였다). 계획 §6의 1순위 서버(`jjlabsio/korea-stock-mcp`)는 스폰·`list_tools`까지는 성공했지만 DART/KRX API 키가 없어 **모든 데이터 툴이 거부**되었다(스키마만 캡처, 실데이터는 캡처 못 함 — 정직하게 실패로 기록).
- **단계 3(네임스페이스 충돌)** — **통과.** 두 서버 동시 연결 성공, `^[A-Za-z0-9_-]{1,64}$` 위반 케이스(64자 초과) 실제로 재현, 그리고 계획 §6이 우려한 "korea-stock-mcp 이름 충돌"이 **서버 3개 모두**(`pykrx-mcp`, `drfirst`, `jjlabsio` 미러)에서 `serverInfo.name`이 `korea-stock-mcp` 계열로 겹치는 것으로 실증됨.

---

## 실측값

### 환경
- Python 3.12.10, `mcp==1.28.1` (2.0.0 아님, 핀 고정 확인됨), 별도 `.venv`(`spike/mcp-client/.venv`, backend/.venv 미사용)
- Node v22.14.0 / npm 2026.7.4
- OS: Windows 11 Pro 26200 (Git Bash), **시스템 로캘 한국어 / 콘솔 코드페이지 cp949**

### 단계 1 — `@modelcontextprotocol/server-everything` (npx, v2.0.0)
- `initialize()` 성공. **서버가 보고한 `protocolVersion` = `2025-11-25`** (계획 §5 마지막 줄이 가정한 `2025-06-18`이 아니다 — 최신 서버들은 이미 그 다음 리비전을 말한다. 이건 **새로운 사실**이며 계획의 "2025-06-18 기준으로 짓는다" 결정에 재검토가 필요할 수 있다)
- `serverInfo` = `{name: "mcp-servers/everything", title: "Everything Reference Server", version: "2.0.0"}`
- `list_tools()` — 툴 13개: `echo, get-annotated-message, get-env, get-resource-links, get-resource-reference, get-structured-content, get-sum, get-tiny-image, gzip-file-as-resource, toggle-simulated-logging, toggle-subscriber-updates, trigger-long-running-operation, simulate-research-query`
- `call_tool("echo", {message: "..."})` → `CallToolResult`:
  ```json
  { "content": [{"type": "text", "text": "Echo: hello from Athena spike S2"}], "structuredContent": null, "isError": false }
  ```
- `call_tool("get-structured-content", {"location": "New York"})` → **`content[0].text`에 문자열화 JSON과 `structuredContent`에 파싱된 객체가 동시에** 온다:
  ```json
  {
    "content": [{"type": "text", "text": "{\"temperature\":33,\"conditions\":\"Cloudy\",\"humidity\":82}"}],
    "structuredContent": {"temperature": 33, "conditions": "Cloudy", "humidity": 82},
    "isError": false
  }
  ```
- 잘못된 인자로 같은 툴 호출 → `isError: true`, `content[0].text`에 `"MCP error -32602: Input validation error: ..."` (JSON-RPC 에러가 `isError:true` + 텍스트 블록으로 온다. 프로토콜 레벨 에러가 아니라 **툴 레벨 에러**로 래핑됨)

**결론: 게이트웨이가 파싱해야 할 대상은 두 갈래다.** `structuredContent`가 있으면 그걸 신뢰하고, 없으면 `content[0].text`를 JSON으로 파싱 시도해야 한다(대개 문자열화 JSON이지만 보장 없음 — 순수 사람이 읽는 문자열일 수도 있다).

### 단계 2-A — `sharebook-kr/pykrx-mcp` (Python, PyPI, 키 불필요) — **캡처 성공, 한글 손상 없음(초안 정정)**
- 설치: `uv pip install pykrx-mcp` → `pykrx-mcp==0.1.3` (의존 `mcp==1.28.1` 유지, 충돌 없음)
- 콘솔스크립트 `pykrx-mcp.exe` (FastMCP 기반) 로 stdio spawn 성공. `protocolVersion: 2025-11-25`, `serverInfo.name: "pykrx-mcp"`, **`serverInfo.version: "1.28.1"`** (서버가 자기 버전이 아니라 **mcp SDK 버전을 잘못 노출**하고 있음 — FastMCP 기본값 버그로 보임, 사소하지만 레지스트리가 버전 표시를 곧이곧대로 믿으면 안 된다는 근거)
- `list_tools()` — 툴 8개: `get_stock_ohlcv, get_market_ticker_list, get_market_ticker_name, get_market_fundamental_by_date, get_market_cap_by_date, get_market_trading_value_by_date, get_etf_ohlcv_by_date, get_etf_ticker_list`
- **실제 호출**: `get_stock_ohlcv("005930", "20240102", "20240112", true)` → 삼성전자 9일치 OHLCV 실데이터 반환 성공. `get_market_ticker_name("005930")` 도 성공.
- **형태**: `content[0].text` = 문자열화된 JSON (`{"ticker":..., "data":[{...}, ...]}`). **`structuredContent`는 항상 `null`** — FastMCP가 `dict` 반환값을 텍스트 블록으로만 직렬화하고 output schema가 없어 structuredContent를 채우지 않는다.
- ⚠️ **[검증 과정에서 정정됨]** 최초 초안은 이 섹션에서 "한글 필드명·값이 전부 `U+FFFD`로 깨져서 온다"고 적고 `"name": "????"`/`"??": "2024-01-02..."` 식의 예시를 실었다. **독립 검증 결과 이 예시는 `spike/captures/S2-pykrx-response.json`에 실재하지 않으며, 재현되지 않는다.** 실제 캡처 파일과 `step2_pykrx.py`를 **2회 재실행**한 결과 모두 `"날짜"`, `"시가"`, `"name": "삼성전자"` 등 한글이 **손상 없이 정상 캡처됨**을 확인했다(`env=None`, 이 cp949 콘솔 환경 그대로). `pykrx` 라이브러리를 MCP 없이 직접 호출(`from pykrx import stock; stock.get_market_ticker_name('005930')`)해도 이 셸에서 **정상적으로 `'삼성전자'`가 출력됨**을 재확인했다 — 원 초안의 "직접 호출도 깨진다"는 서술 역시 재현되지 않는다.
  - **주의(검증 과정에서 발견한 함정)**: `step2b_pykrx_utf8env.py`/`step2c_pykrx_utf8env2.py`(`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`를 자식 프로세스 env로 주입하는 실험)를 `print(json.dumps(...))` 후 셸 리다이렉션(`> out.txt`)으로 캡처하면 **`"name": "�Ｚ����"`류의 깨짐이 실제로 나타난다.** 그러나 이건 **MCP 프로토콜 응답 자체의 손상이 아니라 검증 스크립트의 캡처 방식이 만든 별개의 아티팩트**임을 추가 검증으로 확인했다: 동일한 두 조건(`env=None` / `env`에 `PYTHONUTF8=1` 등 주입)을 공식 캡처 스크립트와 같은 방식(`Path.write_text(json.dumps(...), encoding="utf-8")`)으로 다시 실행하면 **두 조건 모두, `get_market_ticker_name`과 `get_stock_ohlcv` 양쪽 다 한글이 손상 없이 정상 캡처된다.** 즉 `PYTHONUTF8=1` 주입 자체는 pykrx-mcp 응답을 깨뜨리지 않는다 — 깨진 것처럼 보였던 건 부모 프로세스의 `print()`를 파일로 리다이렉트할 때 콘솔 코드페이지(cp949)를 통해 인코딩되면서 생긴 **검증 스크립트 자체의 버그**였다.
  - **숫자 필드(시가/고가/종가/거래량)는 항상 손상 없음.**
  - **결론**: pykrx-mcp는 이 환경에서 `env=None`이든 `PYTHONUTF8=1` 주입이든 **한글 손상이 재현되지 않는다.** 최초 초안의 "치명적 결함" 판정은 근거가 없었다 — **정정 완료.** 실제로 env와 무관하게 항상 손상되는 것은 `@drfirst/korea-stock-mcp`(아래 단계 2-B) 하나뿐이다.

### 단계 2-B — `@drfirst/korea-stock-mcp` (Node, npm, 키 불필요, 네이버금융 크롤링) — **캡처 성공, 동일 결함 재현**
- `npx -y @drfirst/korea-stock-mcp` spawn 성공. `protocolVersion: 2025-11-25`, `serverInfo.name: "korea-stock-mcp"`, `version: "0.1.0"` (npm 패키지 버전은 `1.0.5`인데 서버가 보고하는 버전은 다르다 — 별개 필드로 관리되고 있음, 레지스트리 UX 설계 시 주의)
- `list_tools()` — 툴 6개: `get_etfs_by_market_cap, get_themes_with_leaders, get_market_cap_stocks, get_dividend_yield_stocks, search_stock_code, get_stock_price_by_code`. 전부 `inputSchema`에 Zod 유래의 상세 `description`·`enum`·`pattern`(JSON Schema draft-07)이 붙어 있어 **문서화 품질은 pykrx보다 훨씬 좋다.**
- **실제 호출**: `get_stock_price_by_code({code:"005930"})` → 성공, `currentPrice.value: 274500` 등 실데이터. `search_stock_code({query:"삼성전자"})` → 성공.
- **형태**: `content[0].text` = 문자열화 JSON **그리고 `structuredContent`에도 동일 객체가 동시에 채워진다** (pykrx와 달리 이 서버는 output schema를 갖춘 Node SDK라 `structuredContent`가 실제로 옴 — **W3 어댑터가 `structuredContent` 우선 사용 전략을 짤 근거**).
- ⚠️ **동일한 한글 손상 재현**: `"name": "������"` (삼성전자 자리). `content[0].text`와 `structuredContent` **양쪽 다** 손상됨.
  흥미로운 점: 클라이언트→서버 방향(우리가 보낸 `query: "삼성전자"`)은 서버가 정상적으로 받아 `search.naver.com/...?query=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90`(정확한 UTF-8 percent-encoding)로 재사용했다. **손상은 서버→클라이언트 방향, 즉 서버가 자기 stdout에 쓰는 시점에서만 발생**한다. Python·Node 두 런타임 모두에서 동일 방향으로 동일 증상이 재현된 것은 이게 특정 라이브러리 버그가 아니라 **이 Windows 환경의 자식 프로세스 stdio 인코딩(콘솔 코드페이지 cp949) 문제일 가능성**을 시사한다 — 다만 원인을 완전히 규명하지는 못했다(막힌 것 참조).

### 단계 2-C — `jjlabsio/korea-stock-mcp` (npm 미러 `@iflow-mcp/jjlabsio-korea-stock-mcp@1.1.5`) — 계획 §6·§8이 지목한 "응답 스키마 문서화된 유일한 서버"
- spawn 성공. `serverInfo.name: "korea-stock-mcp"`, `version: "1.0.0"`. `list_tools()` 성공 — 툴 8개: `get_corp_code, get_disclosure_list, get_disclosure, get_financial_statement, get_market_type, get_stock_base_info, get_stock_trade_info, get_today_date`
- **키 없이 호출 가능한 것은 `get_today_date` 하나뿐**이었다(`{"todayKST":"20260814","todayUTC":"20260814"}`, 정상 ASCII, 손상 없음).
- 나머지 전부 명시적 에러로 거부됨: DART 계열(`get_corp_code`)은 `"There is no DART API KEY"`, KRX 계열(`get_stock_base_info` 등, 올바른 인자로 재시도)은 `"There is no KRX API KEY"`. **README에 없던 사실**: 이 서버는 DART 키뿐 아니라 **별도의 KRX API 키도 요구한다** — 계획 §5의 "MCP 서버 응답 스키마가 대부분 README에 없다"는 경고가 필요 환경변수 목록에도 그대로 적용됨을 실증.
- **`get_disclosure`(공시 전문 — 계획이 "리더" 캔버스의 근거로 지목한 그 툴)의 실제 응답 형태는 이번 스파이크에서 캡처하지 못했다.** 키가 없어서다. **정직하게 실패로 기록.**

### 단계 3 — 네임스페이스 충돌 실험
- `pykrx-mcp`와 `@drfirst/korea-stock-mcp`를 `asyncio.gather`로 **동시** spawn·연결 성공.
- `서버명__툴명` 조합 15건 생성, `^[A-Za-z0-9_-]{1,64}$` 검증:
  - 실제 두 서버의 14개 조합(`pykrx__get_stock_ohlcv` 22자 ~ `drfirst-korea-stock__get_dividend_yield_stocks` 46자) 전부 **통과**
  - 사용자가 등록 시 서버 이름을 길게 붙이는 극단 케이스(`user-registered-very-long-server-name-for-korean-market-data__get_market_fundamental_by_date`, 92자) → **위반 재현**. 64자 상한을 실제로 넘을 수 있음을 확인. 레지스트리 UI가 등록명 길이를 제한하거나 해시 축약해야 한다는 근거.
  - **이름 충돌 실증**: `pykrx-mcp`, `@drfirst/korea-stock-mcp`, `@iflow-mcp/jjlabsio-korea-stock-mcp` **세 서버 전부** `serverInfo.name`이 `korea-stock-mcp`류로 겹쳤다(정확히는 `pykrx-mcp` / `korea-stock-mcp` / `korea-stock-mcp`). **`serverInfo.name`을 네임스페이스 키로 쓰면 안 되고, 반드시 사용자가 등록 시 부여하는 별칭을 키로 써야 한다** — 계획 §6의 우려가 실제로 재현됨.

---

## 실행 방법 (재현 커맨드)

```bash
cd spike/mcp-client
uv venv .venv --python 3.12
uv pip install --python .venv "mcp==1.28.1"

# 단계 1
.venv/Scripts/python.exe step1_everything.py
.venv/Scripts/python.exe step1b_structured.py   # structuredContent 성공 케이스
.venv/Scripts/python.exe step1c_structured_error.py  # isError 케이스

# 단계 2
uv pip install --python .venv pykrx-mcp
.venv/Scripts/python.exe step2_pykrx.py
.venv/Scripts/python.exe step2_drfirst_call.py
.venv/Scripts/python.exe step2_jjlabsio.py
.venv/Scripts/python.exe step2_jjlabsio_allools.py
.venv/Scripts/python.exe step2_jjlabsio_stockinfo.py

# 단계 3
.venv/Scripts/python.exe step3_namespace.py
```

산출물: `spike/captures/S2-*.json` (13개 파일, 원본 그대로 보존).

---

## 막힌 것 — 정직하게

1. **`jjlabsio/korea-stock-mcp`(계획이 지목한 1순위 대상)의 실제 데이터 응답을 캡처하지 못했다.** DART API 키와 KRX API 키가 모두 필요하고 이 환경에는 없다. `get_disclosure`(리더 캔버스의 근거) 실제 응답 형태는 **미확인 상태로 남는다** — W3에서 키를 발급받아 재시도해야 한다.
2. **한글 텍스트 인코딩 손상의 근본 원인을 규명하지 못했다 — 단, 손상 범위는 최초 초안보다 좁다(정정).** 독립 검증 결과 이 손상은 `@drfirst/korea-stock-mcp`(Node/npx) **하나에서만** 재현된다. `pykrx-mcp`(Python/FastMCP)는 `env=None` 기본 실행에서도, `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`를 자식 프로세스 env로 명시 주입한 조건에서도(공식 캡처 스크립트와 동일한 `write_text(encoding="utf-8")` 방식으로 재확인) **양쪽 모두 한글 손상이 재현되지 않았다.** 최초 초안이 pykrx도 손상된다고 적은 것과, `PYTHONUTF8` 주입이 "효과 없다"(즉 여전히 깨진다)고 적은 것 둘 다 이번 독립 검증에서 재현에 실패했다 — **정정되었다.** `@drfirst/korea-stock-mcp` 쪽 손상의 근본 원인(서버의 HTTP 응답 디코드 / 서버 프로세스의 stdout 인코딩 / Windows 콘솔 코드페이지 / mcp Python SDK의 anyio 서브프로세스 처리 중 어디서 바이트가 유실되는지)은 여전히 미규명 상태로 남는다 — W1에서 이 서버 하나를 대상으로 추가 검증이 필요하다.
3. **네임스페이스 실험은 두 서버만으로 진행했다.** `jjlabsio` 미러까지 포함한 3파 동시 연결은 시도하지 않았다(툴 목록만 별도로 확인). 결론(이름 충돌 실증)에는 영향 없음.
4. Everything 서버의 `protocolVersion`(`2025-11-25`)이 계획 §5의 가정(`2025-06-18`)과 다르다는 점을 발견했지만, 이게 배포된 클라이언트 생태계 전반에 어떤 영향을 주는지는 이 스파이크 범위 밖이라 조사하지 않았다.

---

## `CallToolResult`의 실제 형태 — 게이트웨이가 파싱해야 할 대상

**둘 다 온다. 서버마다 다르다.** 게이트웨이는 아래 우선순위로 파싱해야 한다:

1. `isError`가 `true`면 — `content[0].text`가 사람이 읽는 에러 메시지다(JSON이 아닐 수 있음). 캔버스로 보내지 말고 에러로 표시.
2. `structuredContent`가 `null`이 아니면 — **이걸 신뢰한다.** (`@drfirst/korea-stock-mcp`, `server-everything`의 `get-structured-content`가 이 경로)
3. `structuredContent`가 `null`이면 — `content[0].text`를 `json.loads()` 시도. 성공하면 그 dict/list를 쓴다(pykrx의 모든 툴이 이 경로 — FastMCP가 dict 반환값을 텍스트로만 직렬화하고 output schema를 안 붙이면 structuredContent가 항상 비어 있다). 실패하면 순수 텍스트로 취급(리더 캔버스의 원문 후보).
4. `content` 배열은 여러 블록이 올 수 있다(`type: text/image/resource_link/...`). 이번 스파이크에서 캡처한 실제 서버들은 전부 `content` 배열 길이 1의 `text` 블록만 왔다 — `image`/`resource_link` 등은 미검증.

## 데이터 형상 → 캔버스 착지

| 캡처한 응답 | 형상 | 착지 캔버스 |
|---|---|---|
| `pykrx get_stock_ohlcv` (삼성전자 9일 OHLCV) | 수치 시계열 | 기존 #1/#2 (가격 시계열) → 신규③ 타임라인의 가격축 |
| `pykrx get_market_ticker_name` | 단일 룩업 | 기존 #5 일반화(스칼라 카드) |
| `drfirst get_stock_price_by_code` | 단일 룩업 + 현재가 스칼라 | 기존 #5 일반화 |
| `drfirst search_stock_code` | 종목명→코드 룩업 | 기존 #5 일반화 |
| `jjlabsio get_today_date` | 스칼라 1개 | 기존 #5 (의미는 없지만 형상은 스칼라) |
| `jjlabsio get_disclosure` (미캡처) | 계획대로면 장문 문서 | 신규② 리더 — **미확인** |
| `everything get-structured-content` | 스칼라 JSON | 기존 #5 |

이번 캡처 범위에서는 **신규④ 공통 테이블에 직접 착지하는 응답을 확보하지 못했다**(`drfirst get_market_cap_stocks`는 인자 타입 오류로 실패만 캡처됨 — `sosok`이 문자열이 아니라 숫자여야 함, 재시도하면 목록형 레코드를 얻을 수 있을 것으로 보이나 이번 스파이크에서는 하지 않았다). 신규① 스트림(뉴스/공시 시간순 리스트), 신규③ 타임라인 합성은 이번 캡처만으로는 검증되지 않는다 — 키가 필요한 뉴스/공시 서버(`naver-search-mcp`, `dart-mcp`)를 별도로 붙여야 한다.

## 설치 난이도

- **npx 서버(`server-everything`, `@drfirst/korea-stock-mcp`, jjlabsio 미러)**: `npx -y <package>` 한 줄로 즉시 동작. 일반 사용자도 Node.js만 있으면 클로드 데스크탑 설정 스니펫 그대로 붙여넣기가 실제로 통한다 — 계획 §2 "클로드 데스크탑 패리티는 사실상 공짜" 주장이 이 스파이크에서 성립함을 확인.
- **Python 서버(`pykrx-mcp`)**: `npx` 같은 원커맨드가 없다. `uv tool install pykrx-mcp` 나 `pipx install pykrx-mcp` 로 전역 설치 후 콘솔스크립트를 `command`로 등록하거나, `uvx pykrx-mcp`로 매번 임시 실행해야 한다. **일반 사용자에게는 npx보다 진입장벽이 뚜렷이 높다** — Athena 레지스트리가 "Python 서버는 `uvx <패키지>`를 command로 자동 제안"하는 등의 도움을 줘야 실사용 가능할 것으로 보인다.
- 두 경우 모두 **키 없는 서버는 등록 즉시 데이터가 나온다**(`@drfirst/korea-stock-mcp`의 한글 손상 문제 제외 — pykrx-mcp는 정정 검증 결과 문제 없음) — 계획이 기대한 "빠른 온보딩"은 실현 가능하다.

## 독립 검증 기록 (2026-08-15)

이 RESULT.md는 최초 작성 후 독립 검증을 거쳐 위 내용 중 **pykrx-mcp 한글 손상 관련 서술을 정정했다.** 정정 근거:
- `spike/captures/S2-pykrx-response.json`을 직접 열어 확인 — `�` 없음, "날짜"/"삼성전자" 등 정상.
- `spike/captures/S2-drfirst-response.json`을 직접 열어 확인 — `�`가 실재하며 `"삼성전자"` 자리에 `"�궪�꽦�쟾�옄"`처럼 손상된 한자와 교대로 나타남(실재 확인).
- `step2_pykrx.py`, `step2_drfirst_call.py`를 각 2회 재실행 — pykrx는 매번 정상, drfirst는 매번 동일하게 손상. 결과 일치.
- `mcp` 패키지가 `.venv/Lib/site-packages/mcp-1.28.1.dist-info/METADATA`에 실제로 `Version: 1.28.1`로 설치되어 있음을 확인(pip 없는 uv venv라 `pip show` 대신 dist-info 직접 확인).
- `step2b_pykrx_utf8env.py`/`step2c_pykrx_utf8env2.py`를 `print()` + 셸 리다이렉션으로 처음 재현했을 때는 깨짐이 나타났으나, 공식 캡처 방식(`Path.write_text(..., encoding="utf-8")`)으로 동일 호출을 다시 실행하자 재현되지 않았다 — 이 깨짐은 검증 스크립트의 `print()`/리다이렉션 경로에서 생긴 아티팩트였고 MCP 응답 자체의 손상이 아니었다. 재검증 산출물: `spike/captures/S2-VERIFY-pykrx-env-baseline.json`(env=None), `spike/captures/S2-VERIFY-pykrx-env-utf8forced.json`(`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8:replace`/`PYTHONLEGACYWINDOWSSTDIO=0` 주입) — 둘 다 한글 정상.
- 나머지 항목(단계 1 `CallToolResult` 구조, 네임스페이스 충돌·92자 위반, jjlabsio 키 부재 에러, `serverInfo.version` 이상값 등)은 캡처 파일과 대조·재실행하여 **원안 그대로 확인됨**(수정 없음).
