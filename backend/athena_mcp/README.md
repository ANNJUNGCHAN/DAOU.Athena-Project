# `athena_mcp` — Athena MCP 게이트웨이

`backend/athena_api/`(키움)와 형제 패키지다. Athena를 **MCP 클라이언트 겸 서버**로
만든다: 사용자가 등록한 upstream MCP 서버 N개에 클라이언트로 붙고, 집계한 툴을
`별칭__툴명`으로 재노출하는 단일 MCP 서버가 된다.

```
Claude Code CLI  ->  Athena Gateway (athena_mcp)  ->  등록된 MCP 서버 N개
                          |
                          +-> athena__render_canvas / athena__save_canvas
```

아키텍처 근거·W0 스파이크 실측·서버 선택 확정은 `plan/mcp-실행계획.md`
(특히 §2 결정 B, §8 W0 실측, §9 캔버스 근거, §10 서버 선택)를 따른다.
**키움 TR 노출은 v1 범위 밖**(결정 4) — 이 패키지는 만들지 않았다.

## 만든 것 (모듈별)

| 파일 | 역할 |
|---|---|
| `registry.py` | 서버 `{command,args,env}` CRUD, `~/.athena/mcp_servers.json` 영속, 클로드 데스크탑 스니펫 파서, 별칭 64자 규칙 역산(28자 상한) |
| `client.py` | upstream stdio 클라이언트. spawn(승인 게이트 통과 시에만) → initialize → list_tools → call_tool, 헬스체크·크래시 감지·지수 백오프 재시작·서버별 로그 파일 |
| `result.py` | `CallToolResult` 4단계 우선순위 파싱(`isError` → `structuredContent` → `content[0].text` json.loads → 순수 텍스트). 미지원 콘텐츠 블록은 명시적 에러 |
| `aggregator.py` | `별칭__툴명` 네임스페이스. 노출 이름과 upstream 원본 ID 분리(리네임 후에도 in-flight 호출 안 깨짐), 64자 2차 방어, 갱신 실패 시 이전 캐시 유지, 진행토큰/취소 리맵 훅 |
| `consent.py` | 동의 게이트 — 서버 승인 없이는 spawn 불가, 위험 패턴 경고, 툴별 allowlist, 인자/응답 본문 없는 감사 로그 |
| `quirks.py` | `corp_code` zfill(8), 인코딩 스모크 테스트(U+FFFD 탐지), `korean-dart-mcp` truncate_at 상향 제안 |
| `stream.py` | `spike/stream-adapter/adapter.py` 승격 — 뉴스/공시 정규화 어댑터, sanitize 순서, dedupe 3단계 |
| `canvas.py` | 신규 4종 캔버스(stream/reader/timeline/table) JSON Schema + `free` 폴백 판정 |
| `server.py` | 위 전부를 `mcp.server.lowlevel.Server`에 연결 — `list_tools`/`call_tool` 핸들러, `athena__render_canvas`/`athena__save_canvas`, 별칭 rename 결선 |
| `onboarding.py` | **이식 절차** — 별칭 정규화(임의 이름 → MCP 규칙), 등록/승인 분리, `probe`(1회 연결로 툴 목록·인코딩·64자 위반 확인) |
| `runner.py` | **프로세스로 띄우기** — 승인된 서버 연결(실패는 서버 단위 격리), `stdio_server()` + `Server.run()`, `tools/list_changed` 전송 |
| `__main__.py` | `athena-mcp` CLI — register/list/show/approve/probe/allow/rename/remove/doctor/serve |

## 설계 결정 중 문서화가 필요한 것

- **레지스트리 저장 위치는 `~/.athena/mcp_servers.json`** (프로젝트 상대경로 아님).
  이유는 `registry.py` 모듈 docstring에 근거와 함께 적었다 — 요약하면 (1) 여러
  프로젝트 체크아웃을 오가도 유지돼야 하는 "이 컴퓨터 사용자"의 상태이고, (2)
  `env`에 실제 API 키가 들어가므로 git 추적 대상 밖에 둬야 한다.
- **별칭 64자 상한은 28자로 역산했다.** `spike/captures/*tools*.json` 서버
  7개·툴 76개 전수조사에서 관측된 최장 실제 툴 이름이 34자
  (`naver-search-mcp`의 `datalab_shopping_keyword_by_device`)였고,
  `64 - len("__") - 34 = 28`. 이건 등록 시점의 1차 방어선일 뿐이고, 실제 툴
  이름을 아는 시점(`aggregator.py`)에서 진짜 64자 규칙으로 2차 방어한다 —
  92자 위반 재현(`spike/mcp-client/RESULT.md` L67, `user-registered-...
  __get_market_fundamental_by_date`)을 두 층 모두에서 테스트로 고정했다.

## 실행법

```powershell
cd backend
uv sync --extra dev          # mcp==1.28.x, jsonschema 포함해서 동기화
.venv\Scripts\python -m pytest tests\mcp -v
.venv\Scripts\python -m ruff check athena_mcp tests\mcp
```

`backend/.venv`를 재사용한다(새 venv를 만들지 않았다). `pyproject.toml`에
`mcp==1.28.*`(W0 스파이크가 검증한 정확히 그 버전대, `2.0.0` 아님)와
`jsonschema>=4.23,<5`를 추가했고 `uv sync`로 `uv.lock`을 갱신했다.

## 실제 이식 — 외부 MCP 서버를 붙여서 왕복시켰다 (2026-08-15)

W1 시점에는 **자체 제작 FastMCP 픽스처 서버로만** 검증했고 실제 npm/PyPI 패키지를
이 게이트웨이로 띄운 적이 없었다. 이번에 그걸 했다.

### 절차 (`athena-mcp` CLI)

```powershell
# 1. 등록 — 클로드 데스크탑 스니펫을 그대로 붙여넣는다
athena-mcp register --snippet-file claude_desktop_config.json

# 2. 승인 — 실행 명령 전문과 위험 경고를 보고 명시 승인. 이 전엔 spawn 금지
athena-mcp approve <alias>

# 3. probe — 1회 연결해 툴 목록·protocolVersion·인코딩 손상·64자 위반 확인
athena-mcp probe <alias> --allow-all
athena-mcp probe <alias> --tool get_stock_price_by_code --tool-args '{"code":"005930"}'

# 4. 서빙 — .mcp.json이 이걸 부른다
athena-mcp serve
```

`.mcp.json` 쪽 설정은 `spike/gateway-graft/mcp.json.example` 참고.

### 실측 결과

스니펫 4개 등록 → 별칭 정규화가 전부 동작했다:

| 스니펫 이름 | 유도된 별칭 | 규칙 |
|---|---|---|
| `@modelcontextprotocol/server-everything` (키 `server-everything`) | `server-everything` | 그대로 |
| `@drfirst/korea-stock-mcp` | `drfirst-korea-stock-mcp` | `@`·`/` 제거 |
| `네이버 검색` | `isnow890-naver-search-mcp` | 비ASCII 전멸 → **패키지명에서 유도** |
| `user-registered-...-market-data` (60자) | `user-registered-very--1f1e99` | 28자 절단 + 원본 해시 6자 |

연결 결과 (`athena-mcp doctor`):

```
OK   server-everything: 툴 13개
FAIL isnow890-naver-search-mcp: McpError: Connection closed
OK   drfirst-korea-stock-mcp: 툴 6개
FAIL user-registered-very--1f1e99: McpError: Connection closed
OK   pykrx: 툴 8개
```

**두 실패는 전부 upstream 문제이고 원인이 서버별 로그에 그대로 남았다.**

1. `naver-search-mcp` — API 키(`NCP_APIGW_API_KEY_ID` 등) 없음. 이 저장소에 `.env`가 없다.
2. `uvx pykrx-mcp` — `ModuleNotFoundError: No module named 'mcp.server.fastmcp'`.
   `pykrx-mcp`가 `mcp`를 느슨하게 핀해서 2.x가 딸려오는데 거기서 `fastmcp` 경로가
   사라졌다. **상류 버그다.** `uvx --with "mcp==1.28.*" pykrx-mcp`로 등록하면 붙는다
   (위 `pykrx` 항목이 그것).

### 게이트웨이를 진짜 MCP 클라이언트로 물어봤다

`spike/gateway-graft/verify_graft.py`가 `claude -p`와 정확히 같은 일을 한다 —
`athena-mcp serve`를 stdio 자식 프로세스로 spawn → initialize → tools/list →
tools/call. 산출물은 `spike/captures/GRAFT-verify.json`.

```
protocolVersion=2025-11-25 serverInfo=athena
28 tools: {'server-everything': 12, 'drfirst-korea-stock-mcp': 6, 'pykrx': 8, 'athena': 2}
```

`server-everything`이 13개가 아니라 12개인 건 `get-env`를 allowlist에서 뺐기 때문이다
— 툴별 allowlist가 실제 프로토콜 경로에서 동작함을 그 자리에서 보여준다.

호출 5건 전부 의도대로 나왔다:

| 호출 | 결과 |
|---|---|
| `server-everything__echo` (Node) | `Echo: 삼성전자` — 2단 중첩을 지나도 한글 무손상 |
| `pykrx__get_market_ticker_name` (Python/FastMCP) | `structuredContent` **없음**, `content[0].text`가 JSON — §9-① 실측 재확인 |
| `athena__render_canvas` (table) | `fell_back=false` |
| `athena__render_canvas` (`canvas_type="streem"`) | `fell_back=true`, `canvas_type="free"` |
| `server-everything__get-env` (미승인) | `isError=true` — 게이트웨이가 거부 |

### 실측이 재확인한 W0/W1 관측 3건

- **`serverInfo.version`을 믿으면 안 된다** — `pykrx-mcp`가 자기 버전이 아니라
  `1.28.1`(mcp SDK 버전)을 보고했다. 스파이크 관측 그대로 재현.
- **`serverInfo.name`이 겹친다** — `@drfirst/korea-stock-mcp`가 `korea-stock-mcp`로
  자칭한다. 별칭을 네임스페이스 키로 쓰는 설계가 옳았다.
- **`structuredContent`는 예외지 규칙이 아니다** — FastMCP 서버(`pykrx`)는 항상 null,
  Node 서버(`@drfirst`)는 채운다. 폴백 경로가 주경로다.

### 인코딩 스모크 테스트 — 능동 probe로 실증

```
$ athena-mcp probe drfirst-korea-stock-mcp --tool get_stock_price_by_code --tool-args '{"code":"005930"}'
  능동 probe: get_stock_price_by_code
    structuredContent 사용: True
    응답 인코딩 손상: True          <- U+FFFD 탐지

$ athena-mcp probe pykrx --tool get_market_ticker_name --tool-args '{"ticker":"005930"}'   # 대조군
    structuredContent 사용: False
    응답 인코딩 손상: False
```

레지스트리에 경고가 영속되고 `athena-mcp list`에 `[인코딩 손상 경고]`로 뜬다.

## 이번에 고친 결함 (전부 실제로 터진 것)

| # | 결함 | 증상 | 회귀 테스트 |
|---|---|---|---|
| 1 | 프로세스 엔트리포인트 없음 | `claude -p`가 게이트웨이를 볼 방법 자체가 없었다 | `runner.py` + 실호출 |
| 2 | anyio 취소 스코프 위반 | 서버 3개 붙였다 끊으면 `CancelledError`로 죽었다. 핸들마다 태스크를 줘서 해결 | `test_disconnect_in_any_order_does_not_raise` |
| 3 | `initialize()`/`list_tools()` 타임아웃 없음 | upstream이 응답만 안 주면 게이트웨이 영구 정지 | `ServerStartupTimeoutError` |
| 4 | `registry.rename()`이 aggregator·consent를 안 옮김 | **rename하면 승인한 서버가 조용히 미승인으로 돌아갔다** | `test_rename_moves_approval_*` |
| 5 | `rename_alias()`의 `KeyError` | connect 전 rename이 터졌다 | `test_rename_before_connect_does_not_raise_keyerror` |
| 6 | `connect()`가 `UpdateResult`를 버림 | 64자 스킵이 아무 데도 안 남았다 | `test_connect_returns_update_result_with_violations` |
| 7 | `canvas_type` enum이 free 폴백을 가림 | SDK 입력 검증이 게이트웨이 도달 전에 거부 → 설계된 폴백이 죽은 가지 | `test_unknown_canvas_type_falls_back_through_real_protocol_handler` |
| 8 | CLI가 cp949 콘솔에서 죽음 | 첫 출력에서 `UnicodeEncodeError` | `_force_utf8_console()` |
| 9 | 중첩 `ExceptionGroup`이 원인을 가림 | `ExceptionGroup(...[ExceptionGroup(...[McpError])])` | `test_describe_exception_flattens_*` |
| 10 | 종료 시 `list_changed` 전송 시도 | `ClosedResourceError` 노이즈 | `_shutting_down` 플래그 |

### 적대적 리뷰가 추가로 잡은 6건 (전부 재현 후 수정)

구현 직후 4차원(async 수명주기·범용성·보안 회귀·프로토콜 정합성) 리뷰를 돌렸고,
6건이 확인·수정됐다. 기각 0건.

| # | 결함 | 증상 | 회귀 테스트 |
|---|---|---|---|
| 11 | `errlog` 열기와 `StdioServerParameters` 생성이 `try` **밖** | 여기서 예외가 나면 `finally`의 `_ready.set()`을 건너뛰어 `start()`가 **영원히** 멈춘다 | `test_start_does_not_hang_when_log_file_cannot_be_opened` |
| 12 | 등록 정보의 `args`/`env`에 문자열 아닌 값 | 스니펫에 `"DEBUG": true`가 섞이면 pydantic이 위 자리에서 터져 `serve` 기동 전체가 영구 정지 | `test_non_string_env_is_rejected_at_registration_not_at_spawn` |
| 13 | `start()` 재호출이 이전 태스크를 유기 | `_stop` Event가 새 것으로 덮여 옛 태스크·자식 프로세스·로그 핸들이 회수 불가 | `test_double_start_does_not_leak_the_previous_task` |
| 14 | 크래시 후 `_session`이 남아 `is_running`이 True | 죽은 세션으로 계속 재디스패치, 빠르게 실패하지 않음 | `test_crashed_session_fails_fast_instead_of_redispatching` |
| 15 | **`probe --tool`이 allowlist·감사로그를 우회** | 서버 승인만 받으면 부작용 있는 툴을 흔적 없이 호출 가능 | `test_probe_active_tool_requires_allowlist_or_explicit_force` |
| 16 | 연결을 다 끝낸 뒤에야 stdio를 염 + 순차 연결 | npx 콜드 스타트 동안 stdin을 안 읽어 클라이언트가 먼저 포기. 서버 N개면 N×60초 | `test_connect_approved_runs_concurrently_not_sequentially` |

**12는 등록 시점에서 막는다** — `registry.validate_server_spec()`이 spawn까지
살아가기 전에 이유를 붙여 거부한다(값 자체는 표시하지 않는다).

**15는 발견 단계와 통제를 둘 다 살리는 쪽으로 풀었다.** probe의 능동 호출은
allowlist에 있거나 `--force-tool`을 명시해야 하고, **어느 쪽이든 감사 로그에
`probe:<툴>`로 남는다.** 수동적 스캔(툴 이름·설명의 U+FFFD 탐지)은 호출을
하지 않으므로 게이트 없이 계속 동작한다.

**16을 고치면서 회귀를 하나 만들었다가 다시 잡았다.** 서빙을 먼저 열도록
바꿨더니 초기 `tools/list`가 upstream 연결 전에 응답해 **캔버스 툴 2개만**
돌아왔다(28 → 2, 실측). MCP 클라이언트는 initialize 직후 목록을 한 번 받아가므로
그 한 번이 비면 모델은 한동안 upstream 툴이 없다고 믿는다. `tools/list`
요청만 초기 연결을 상한(기본 30초) 안에서 기다리게 해서 둘 다 만족시켰다 —
상한을 넘기면 붙은 것만 주고 나머지는 `tools/list_changed`가 따라온다.

## 테스트

```
$ .venv\Scripts\python -m pytest tests\mcp -q
167 passed

$ .venv\Scripts\python -m pytest -q          # athena_api 포함 전체
470 passed, 1 warning

$ .venv\Scripts\python -m ruff check athena_api athena_mcp tests
All checks passed!
```

`tests/mcp` 126 → 167 (+41: `test_onboarding.py` 20, `test_runner.py` 21).
전체 스위트에 **실패 0건**이다 — 이 README의 이전 판이 적어둔 "22 failed"는
셀렉터 base/detail 라우팅 재설계로 해소됐다(`plan/plan.md` §3). 그 절은 삭제했다.

`test_client.py`는 기존 `backend/tests/unit/test_client.py`와 모듈 이름이 충돌해
`test_mcp_client.py`로 이름을 바꿨다(pytest rootdir prepend import 모드 제약 —
`__init__.py`가 없는 두 디렉토리에 동명 파일이 있으면 수집 단계에서 에러가 난다).
같은 이유로 `tests/mcp/test_onboarding.py`는 `test_server.py`에서 import하지 않고
픽스처 경로를 자기가 만든다.

### 프로토콜 왕복은 실제로 subprocess를 spawn해서 검증한다

`tests/mcp/fixtures/fake_server.py`는 `mcp.server.fastmcp.FastMCP`로 만든 진짜
stdio MCP 서버다. 크래시/재시작 테스트는 `flaky` 툴이 실제로 `os._exit(1)`로
죽는 걸 재현하고, `client.py`가 그걸 `ServerCrashedError`로 잡아 `restart()`로
복구하는 것까지 진짜 프로세스 수준에서 확인한다.
`datalab_shopping_keyword_by_device_and_gender_breakdown`(56자) 툴은 64자 규칙
2차 방어선을 실제 서버 응답으로 재현하려고 추가했다.

### `result.py`/`quirks.py`는 지어낸 JSON이 아니라 실제 캡처를 픽스처로 쓴다

`spike/captures/*.json`을 그대로 로드한다 — `S2B-jjlabsio-corp-code.json`의
`corp_code: 126380`(정수, 정상값 `"00126380"`), `S2-drfirst-response.json`의
실제 U+FFFD 손상, `S2-pykrx-response.json`의 `structuredContent: null`.

## 미구현 / 의도적으로 남겨둔 것 (조용히 넘기지 않고 명시한다)

- **`notifications/cancelled` 리맵은 아직 훅뿐이다.** `tools/list_changed`는
  `runner.py`가 실제 세션에 연결했지만, `aggregator.register_progress_token()`
  /`resolve_progress_token()`은 여전히 호출자가 없다. 다운스트림 취소를
  upstream 세션으로 되돌리려면 `Server`가 `notifications/cancelled`를 받는
  자리에서 이 표를 조회해야 하는데, `mcp==1.28`의 lowlevel `Server`가 그
  알림을 핸들러로 노출하지 않는다 — SDK 쪽 경로를 먼저 확인해야 한다.
- **`quirks.suggested_truncate_at()`은 `dispatch_call()`에 자동으로 안 물려
  있다.** `corp_code` 정규화(`quirks.normalize_known_args`)는 인자 딕셔너리
  전체에 일반 규칙으로 적용되지만, `truncate_at`은 서버마다 파라미터 이름이
  다를 수 있어(실측 확인된 건 `korean-dart-mcp` 하나뿐) 자동 주입은 보류했다.
  `korean-dart-mcp`는 DART 키가 없어 이번에도 실제로 붙여보지 못했다.
- **`stream.py`(뉴스/공시 정규화)는 여전히 프로덕션 호출자가 없다.** 게이트웨이
  어디도 `normalize_news_item()`/`dedupe()`를 부르지 않는다. 이건 결선 누락이
  아니라 **순서 문제**다 — 정규화의 소비자는 캔버스 어댑터(W3)이고, W3는
  아직 착수하지 않았다. `canvas.py`의 스트림 스키마가 `stream.py`가 만드는
  레코드 형상과 이미 같은 계약이라 붙는 자리는 정해져 있다.
- **백그라운드 헬스체크 스케줄러는 없다.** `healthcheck()`/`restart()`는
  호출 가능한 메서드로만 존재하고, 주기적으로 자동 호출하는 루프는 없다.
  `runner.py`가 서빙 중 upstream 크래시를 감지해 되살리는 건 다음 일감이다
  (지금은 크래시한 서버의 툴 호출이 `isError`로 떨어진다).
- **`claude -p`에 실제로 물려 왕복시키지는 않았다.** 게이트웨이가 stdio MCP
  서버로 정상 동작하는 건 `spike/gateway-graft/verify_graft.py`가 **진짜 MCP
  클라이언트로** 검증했지만(프로토콜은 동일하다), `claude` CLI를 띄우는 건
  구독 쿼터를 소모해서 이번 범위에 넣지 않았다. `.mcp.json` 예시는
  `spike/gateway-graft/mcp.json.example`에 있다.
- **원격(Streamable HTTP + OAuth) 서버 미지원.** stdio 전용이다
  (`plan/mcp-실행계획.md` §2 — 1단계는 stdio만, 원격은 2단계).
- **키움 TR 노출 없음**(결정 4, 의도된 범위 제외 — 버그 아님).

## 보안 — 미해결 2건은 그대로다

`SECURITY.md` 참고. 이번 작업으로 바뀐 것 없다:

- **[HIGH] 프롬프트 인젝션** — upstream 툴 `description`과 응답 본문이 가공
  없이 LLM에 간다. 이번에 실제 서버를 붙이면서 **공격면이 가설에서 실물이
  됐다** — `athena-mcp list`가 노출하는 26개 upstream 툴 설명이 전부 남이 쓴
  텍스트다. 대응은 여전히 CLI 통합 시점 과제다.
- **[MEDIUM] 응답 크기 상한 없음** — `client.py`에 바이트 상한이 없다.
  `startup`/`list_tools` 타임아웃은 이번에 넣었지만 그건 시간 축이지 크기 축이
  아니다.

## 알려진 제약 그대로 남긴 것

- `client.py`의 크래시 감지는 "호출이 예외를 던지느냐"에만 의존한다.
  프로세스가 살아있지만 응답만 무한정 늦는 경우는 `call_timeout_seconds`
  타임아웃으로만 걸러진다(크래시로 집계하지 않는다 — 설계 의도, 모듈
  docstring 참고).
- `registry.py`의 별칭 28자 상한은 **관측치 기반 근사치**다. 34자보다 긴 툴
  이름을 가진 새 서버가 나오면 등록은 통과하되 `aggregator.py`의 2차 방어에서
  해당 툴만 스킵된다(전체 서버 등록이 막히지는 않는다) — 이 동작은
  `test_64_char_violation_skipped_not_silently_truncated`로 고정돼 있다.
