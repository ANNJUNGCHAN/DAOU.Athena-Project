# S4 — `claude -p` ↔ Athena 게이트웨이 실왕복

기준 시점: 2026-08-17 · `main` · `claude` CLI **2.1.220**

`plan/plan.md` §5 **액션 3**이다. 게이트웨이는 이미 MCP 클라이언트로 물어 28툴 노출·5건 호출까지
검증돼 있었고(`backend/athena_mcp/README.md` "실제 이식"), 남은 건 **`claude` 자체로 왕복하는 것**
뿐이었다. 이 문서가 그 실행 기록이다.

## 판정 : **통과**

`athena__render_canvas`가 `claude -p` → `athena-mcp serve` → 게이트웨이 경로로 **실제 실행됐다.**
`EXIT:0`, `result/success`, `duration_ms: 43865`.

원문: [`spike/captures/S4-gateway-cli-roundtrip.ndjson`](../../captures/S4-gateway-cli-roundtrip.ndjson) (42 이벤트).
**불변 증거다. 편집하지 마라.**

---

## 1. 실제로 쓴 커맨드

cwd = `spike/cli-pipe/gateway/` (이 디렉토리의 [`.mcp.json`](.mcp.json)을 쓴다).

```bash
claude -p "athena__render_canvas 툴을 canvas_type=\"table\" 로 호출해서 ... 툴을 반드시 실제로 호출해라." \
  --output-format stream-json --verbose \
  --mcp-config .mcp.json --strict-mcp-config \
  --setting-sources "" \
  --allowedTools "mcp__athena__athena__render_canvas" \
  > roundtrip.ndjson 2>roundtrip.err
```

`.mcp.json`은 `spike/gateway-graft/mcp.json.example`의 (b) 방식 — venv python + `-m athena_mcp serve`.
console script(`athena-mcp`)는 PATH에 없어도 되므로 이쪽이 이식성이 높다.

> `stderr`에 `Warning: no stdin data received in 3s...`가 찍힌다. 무해하다 —
> `-p`가 stdin을 기다리다 포기하고 진행한 것이고 `EXIT:0`이다. Electron에서
> spawn할 때는 **stdin을 명시적으로 닫아라**(`stdio[0]`를 `'ignore'`), 3초를 그냥 버린다.

## 2. 툴 이름이 두 번 겹친다 — `mcp__athena__athena__render_canvas`

`--allowedTools`에 줄 문자열이다. `mcp__` + 서버 별칭(`.mcp.json`의 키 = `athena`) +
`__` + **툴 자체 이름**(`athena__render_canvas`, `server.py`의 `RENDER_CANVAS_TOOL`)이라
`athena__`가 두 번 나온다. 헷갈리기 쉬우니 하드코딩할 때 주의한다.

`--allowedTools`에 이 문자열을 주면 **툴이 실제로 집행된다.** S3가 기록한
"`--allowedTools` 없이는 자동 거부"의 반대 증명이다. 이번 실행에서 거부된 건
`--allowedTools`에 없던 내장 `Grep` 하나뿐이었다:

```json
"permission_denials": [{"tool_name": "Grep", ...}]
```

## 3. `system/init` — S3와 같은 그림

```json
"mcp_servers": [{"name": "athena", "status": "pending"}]
```

- 트러스트 확인 프롬프트 **없이** 게이트웨이 프로세스가 시작된다. S3가 기록한 보안 구멍
  그대로다(`athena_mcp/consent.py`가 막는 건 upstream 서버 spawn이지 게이트웨이 자신이 아니다).
- `tools` 총 27개 — 클린 프로파일 기준선(S3 ②)과 같다. **이 시점의 `tools` 배열에 MCP 툴은
  아직 없다**(`status: pending`). MCP 툴 목록을 `init`에서 읽으려 하면 빈손이다.
  실제 이름은 `tool_reference` 블록이나 `tool_use.name`에서 나온다.

## 4. ★ `tool_result.content`의 두 형상 — 재확인

S3가 기록한 두 형상이 이번에도 그대로 나왔다. **파서는 둘 다 받아야 한다.**

**(a) 문자열** — 캔버스 페이로드가 오는 주경로다:
```json
{"type":"tool_result","tool_use_id":"toolu_013ACzUQ8JFkF5CG1WvSocDm",
 "content":"{\"canvas_type\":\"table\",\"fell_back\":false,...}"}
```
`content`가 **JSON 문자열**이다. `json.loads`(JS는 `JSON.parse`)를 **한 번 더** 해야 페이로드가 나온다.

**(b) 블록 배열**:
```json
{"type":"tool_result","tool_use_id":"toolu_0174FaEUDGE5ZSw56DP8erbz",
 "content":[{"type":"tool_reference","tool_name":"mcp__athena__athena__render_canvas"},
            {"type":"tool_reference","tool_name":"mcp__athena__athena__save_canvas"}]}
```

`is_error`는 **`None`·`false`·`true` 세 값**이 다 나온다. 없다고 성공이 아니다.
거부된 호출은 `is_error: true` + `tool_result_meta[].non_execution_kind == "user-rejected"`.

## 5. ★ 캔버스 봉투 실측 — `fell_back`이 실제로 관측된다

성공 응답의 실제 형상:
```json
{"canvas_type":"table","fell_back":false,"fallback_reason":null,
 "caption":"종목 현재가","data":{...}}
```

**3회 호출 중 2회가 `free`로 폴백했다.** 폴백은 이론이 아니라 기본 동작이다:
```json
{"canvas_type":"free","fell_back":true,
 "fallback_reason":"table 스키마 불일치: ['SK하이닉스', '195,000원'] is not of type 'object'", ...}
```

> 파서는 `canvas_type`을 **요청값이 아니라 응답값**으로 읽어야 한다. 요청은 `table`이었지만
> 응답은 `free`다. 요청을 믿으면 렌더러가 없는 형상을 그리려 한다.

## 6. ★ 발견 — `table` 스키마가 툴 설명만으로는 도달 불가능하다

모델이 **세 번 시도해서야** 맞췄다. 실패 두 번은 전부 `data` 스키마 추측이었다:

| 시도 | 보낸 `data` | 결과 |
|---|---|---|
| 1 | `rows`가 배열의 배열 | `['SK하이닉스', ...] is not of type 'object'` → free |
| 2 | `columns`가 문자열 배열, `rows`가 그 문자열을 키로 쓰는 객체 | `'현재가' is not of type 'object'` → free |
| 3 | `columns`가 `{key,label}` 객체 배열, `rows`가 `key`로 매긴 객체 | **성공** (`fell_back:false`) |

정답 형상:
```json
{"columns":[{"key":"name","label":"종목명"},{"key":"price","label":"현재가"}],
 "rows":[{"name":"삼성전자","price":"71,000원"},{"name":"SK하이닉스","price":"195,000원"}]}
```

**이건 게이트웨이의 결함이다.** `_RENDER_CANVAS_INPUT_SCHEMA`가 `data`를 `{"type":"object"}`로만
선언해서 **캔버스별 실제 스키마가 모델에게 전달되지 않는다.** 실패 메시지는 정확했지만
(그래서 결국 도달했지만) 왕복 3회 = 지연 3배 + 토큰 3배다. 프로덕션에서 이 비용을 매번 낸다.
→ `plan/plan.md`에 후속으로 올렸다. 이번 작업 범위에서는 **고치지 않았다.**

## 7. 재현

```bash
cd spike/cli-pipe/gateway
claude -p "<프롬프트>" --output-format stream-json --verbose \
  --mcp-config .mcp.json --strict-mcp-config --setting-sources "" \
  --allowedTools "mcp__athena__athena__render_canvas"
```

`.mcp.json`의 경로는 이 저장소(`C:\Projects\DAOU.Athena`) 절대경로로 박혀 있다. 다른 위치에
클론했으면 고쳐야 한다.

**쿼터를 쓴다.** 이번 실행 1회에 `duration_ms: 43865`. 함부로 반복하지 마라.
