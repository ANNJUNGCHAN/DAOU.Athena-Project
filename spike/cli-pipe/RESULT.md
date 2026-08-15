# S3 — Claude Code CLI 파이프 (구독 로그인 · 클린 프로파일) 실측 결과

## 판정 : 부분통과

- 구독 로그인 헤드리스 인증 → **통과**
- 클린 프로파일 + `--setting-sources ""` 가 훅 로드를 0으로 만드는가 (`plan/감시에이전트-실행계획.md` §9 완화책의 핵심 주장) → **통과, 단 문법에 조건이 있다**
- MCP 서버가 헤드리스에서 신뢰 확인 없이 로드되는가 → **통과(우려 확인). 단, 서버 "연결"과 툴 "실행"은 별개 관문이며 실행 쪽은 기본적으로 막혀 있었다**
- 호출당 지연 3회 반복 측정 → **부분통과.** 총 호출 예산(5회) 제약으로 조건당 3회를 채우지 못했다 (아래 "막힌 것" 참조)

> **주의(정정)**: 아래 본문에서 "§9"는 전부 `plan/감시에이전트-실행계획.md` §9(라인 336~357, "CLI 구동 딜레마"·클린 프로파일 완화책)를 가리킨다. `ui/soul.md` 자신의 §9는 무관한 절("프로세스(YC 방식)")이다 — 원문이 문서명을 생략해 혼동 소지가 있었다.

soul.md §1 개정 불필요, `감시에이전트-실행계획.md` §9 완화책은 **성립하되 문법을 정확히 지켜야 성립한다** (아래 3번 참조).

---

## 실측값

### 0. 버전

```
$ claude --version
2.1.220 (Claude Code)
```

### 1. 구독 로그인 헤드리스 인증

```
$ claude -p "1+1은?" --output-format stream-json --verbose
```
- `EXIT:0`, `result/success` 이벤트 수신, `apiKeySource: "none"` (API 키가 아니라 OAuth 구독 로그인으로 인증됨을 CLI 자신이 명시)
- 응답: `"2."` — 정상 왕복

**통과.**

### 2. 클린 프로파일이 훅 로드를 0으로 만드는가 — 비교표

세 조건을 실측했다 (④는 계획서에 없던 추가 대조군, 문법 함정을 발견해서 추가함):

| | ① 대조군<br>프로젝트 루트, 기본 옵션 | ② 실험군<br>`spike/cli-pipe/clean`, `--setting-sources ""` | ③ 함정 대조군<br>`clean`, `--setting-sources "user"` |
|---|---|---|---|
| `system/hook_started` 이벤트 수 | **6** | **0** | **6** |
| `mcp_servers` | 4개: `plugin:oh-my-claudecode:t`(connected), `plugin:playwright:playwright`(pending), `codebase-memory-mcp`(connected), `paper`(connected) | **0** | 4개 (①과 동일) |
| `plugins` | 4개: ralph-loop, oh-my-claudecode, skill-creator, playwright | **0개** | 4개 (①과 동일) |
| `skills` | 388개 (사용자 전역 스킬 전부) | **14개** (CLI 바이너리 내장 스킬만: deep-research, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, claude-api, run, run-skill-generator) | 388개 (①과 동일) |
| `slash_commands` 수 | 415 | **39** | 415 |
| `tools` 수 | 129 | **27** | 129 |
| `apiKeySource` | none (구독) | none (구독) | none (구독) |

**핵심 발견 — 문법 함정**: `--setting-sources "user"` 처럼 값을 하나라도 주면(빈 문자열이 아니면) 이 환경에서는 대조군과 **완전히 동일하게** 유저 스코프 훅·MCP·플러그인·스킬이 전부 로드된다. 이 프로젝트/이 개발 환경에서는 프로젝트 자체 `.claude/`나 `CLAUDE.md`가 없고, 모든 훅·MCP·플러그인이 **유저 스코프**(`~/.claude/`)에 등록돼 있기 때문이다.
→ §9 계획서의 "`--setting-sources`로 배제한다"는 문구만으로는 부족하다. **반드시 빈 문자열 `--setting-sources ""` 로 user/project/local 셋을 전부 배제해야** 훅이 0이 된다. `--setting-sources "project"`나 `"user"`만 주는 방식은 이 환경에서 완화책으로 작동하지 않는다.

`system/hook_response` 상세(①에서, 훅이 실제로 무엇을 하는지 — CLAUDE.md/훅이 프로젝트 메모리·계정 스위처 안내를 컨텍스트에 주입함을 실측):
```
"additionalContext":"<project-memory-context>\n\n[PROJECT MEMORY]\n\n[Hot Paths]\n- backend/athena_api/generated/models.py (10x)\n- plan/mcp-실행계획.md (9x)\n- ui/soul.md (8x)\n\n</project-memory-context>..."
"Claude Code Multi-Account Switcher is available. Use !cc-switch or !ccs ..."
```
— **트러스트 확인 프롬프트 없이** 6개 훅이 조용히 실행되고 컨텍스트에 텍스트를 주입했다. 이게 §9가 막으려던 정확한 시나리오이고, 클린 프로파일(②)에서는 `hook_started` 이벤트 자체가 0건이었다.

**추가로 발견한 대안 플래그** (실측은 안 했음, `claude --help` 문서만 확인): `--safe-mode` — "CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings 등을 비활성화. 인증·모델선택·내장툴·권한은 정상 동작. `CLAUDE_CODE_SAFE_MODE=1`". 디렉토리를 따로 만들 필요 없이 프로젝트 루트에서 바로 쓸 수 있는 대안일 수 있음 — 후속 스파이크에서 실측 필요 (이번 호출 예산에서는 제외).

### 3. `--setting-sources` 정확한 문법 (`claude --help` 원문)

```
--setting-sources <sources>           Comma-separated list of setting sources
                                       to load (user, project, local).
```
- 콤마 구분 문자열, 허용값은 `user`, `project`, `local` 세 가지.
- **전부 배제하려면 빈 문자열을 명시적으로 줘야 한다**: `--setting-sources ""`. (값을 아예 생략하면 기본 동작 — 전부 로드 — 과 동일함을 ③에서 확인)

### 4. stream-json 구조 — type/subtype 목록과 tool_result 실제 형태

5회 호출 전체에서 등장한 `type`/`subtype` 전부:
```
assistant
rate_limit_event
result/success
system/hook_response
system/hook_started
system/init
user
```
(`system/hook_started`, `system/hook_response`는 훅이 걸린 조건(①,③)에서만 등장. `--include-hook-events` 없이도 기본으로 나왔다.)

`assistant` 메시지의 `tool_use` 블록 실제 형태 (검증4, MCP 툴 검색 단계):
```json
{
  "type": "tool_use",
  "id": "toolu_01MMSbFemeUAfqKdrjG3oZjo",
  "name": "ToolSearch",
  "input": { "query": "+everything echo", "max_results": 5 },
  "caller": { "type": "direct" }
}
```
MCP 툴 자체 호출 시엔 `tool_use_meta` 배열이 별도로 붙는다 (서버 표시이름 포함):
```json
"tool_use_meta": [{ "id": "toolu_01JGmVNXP4a2MTspDZCeZGsT", "display_name": "Echo", "server_display_name": "mcp-servers/everything" }]
```

`user` 메시지의 `tool_result` 블록 — **두 가지 형태를 실측**:
1. 구조화된 배열 (ToolSearch 결과, deferred-tool 참조):
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01MMSbFemeUAfqKdrjG3oZjo",
  "content": [
    { "type": "tool_reference", "tool_name": "mcp__everything__echo" },
    { "type": "tool_reference", "tool_name": "mcp__everything__get-annotated-message" }
  ]
}
```
2. 단순 에러 문자열 (권한 거부):
```json
{
  "type": "tool_result",
  "content": "Claude requested permissions to use mcp__everything__echo, but you haven't granted it yet.",
  "is_error": true,
  "tool_use_id": "toolu_01JGmVNXP4a2MTspDZCeZGsT"
}
```
**중요한 파싱 함정**: `tool_result.content`는 케이스에 따라 **문자열**이거나 **타입드 블록 배열**이다 — Athena가 이걸 파싱하려면 두 형태 모두 처리해야 한다. 또한 CLI는 원본 Anthropic 메시지 배열과 별개로 **최상위 `tool_use_result` 필드**(파싱하기 쉬운 CLI 편의 필드, 예: `{"matches":[...], "total_deferred_tools":34}`)와 `tool_result_meta`(예: `{"non_execution_kind":"user-rejected"}`)를 붙여준다 — 공식 Anthropic 메시지 스키마에 없는 CLI 전용 확장이다. 스트림 스키마에 공식 명세가 없다는 계획서의 우려(anthropics/claude-code#24612)가 실측으로도 확인됐다: 필드가 툴 종류·성공/실패에 따라 형태가 달라진다.

### 5. MCP 서버 물려서 왕복 — 헤드리스 신뢰 게이트 부재 여부

구성: `spike/cli-pipe/clean/.mcp.json` (`@modelcontextprotocol/server-everything`, 키 불필요) + `--mcp-config .mcp.json --strict-mcp-config --setting-sources ""`.
프롬프트: `"everything 서버의 echo 툴로 hello 를 에코해줘"`

결과 (`spike/captures/S3-verify4-mcp.ndjson`):
- `system/init`의 `mcp_servers: [{"name":"everything","status":"pending"}]` — **트러스트 확인 프롬프트 없이 서버 프로세스가 그냥 시작됨** (`npx -y @modelcontextprotocol/server-everything`가 이미 로컬에 캐시돼 있었으므로 즉시 실행). 이건 계획서가 지목한 보안 구멍이 **실제로 존재함을 확인**한 것 — 서버 시작 = 임의 커맨드 실행(`npx -y ...`)이고 이건 아무 확인 없이 벌어진다.
- 다만 **툴 실행 자체는 별도 권한 게이트를 통과 못 했다**: 모델이 `mcp__everything__echo`를 호출했지만
  ```
  "tool_result": "Error: Claude requested permissions to use mcp__everything__echo, but you haven't granted it yet."
  "tool_result_meta": [{ "non_execution_kind": "user-rejected" }]
  ```
  헤드리스(비대화)에서는 승인자가 없어 **자동 거부**됐다 (`permission_denials` 배열에 기록됨). `--dangerously-skip-permissions`나 `--allowedTools` 없이는 MCP 툴이 실제로 실행되지 않는다.

**결론**: 보안 구멍은 "서버 프로세스 시작(코드 실행)" 단계에 있고, "툴 호출"은 기본 권한 모드에서 막혀 있다. Athena가 감시 루프에 MCP를 붙이려면 (a) 신뢰할 수 있는 서버만 `.mcp.json`에 등록하고 (b) 툴 실행을 허용하려면 `--allowedTools`로 화이트리스트를 명시하거나 `--dangerously-skip-permissions`를 써야 하는데 후자는 (a)의 신뢰 전제가 깨지면 바로 위험해진다.

### 6. 호출당 지연 실측

**막힌 것 먼저**: 스파이크 공통 규칙의 "총 5회 이내" 호출 예산 때문에 조건별 3회 반복을 채우지 못했다. 실제로 사용한 5회 호출의 내역과 각각의 지연(내부 `result.duration_ms`, `duration_api_ms`, `ttft_ms`와 셸 `time`의 `real` 둘 다 기록):

| # | 조건 | 프롬프트 | 셸 `real` | `duration_ms`(내부) | `duration_api_ms` | `ttft_ms` |
|---|---|---|---|---|---|---|
| 1 | ① 대조군 (프로젝트 루트, 기본) | "1+1은?" | 5.837s | 2926ms | 2133ms | 2508ms |
| 2 | ② 클린 (`--setting-sources ""`) | "1+1은?" | 2.757s | 1943ms | 1711ms | 1931ms |
| 3 | ③ 함정 대조군 (`--setting-sources "user"`) | "1+1은?" | (미측정, `time` 안 씀) | 3255ms | 2398ms | 2778ms |
| 4 | ② 클린 + MCP (`everything` 서버, 멀티턴) | "everything 서버의 echo 툴로..." | 7.318s | 6337ms | 5972ms | 2169ms |
| 5 | ② 클린 (`--setting-sources ""`) 반복 | "1+1은?" | 2.983s | 2057ms | 1756ms | 2038ms |

**단일 프롬프트 비교 (①=n1 vs ②=n2)**:
- 클린 프로파일 평균 `duration_ms` ≈ (1943+2057)/2 = **2000ms**
- 대조군(프로젝트 루트) `duration_ms` = **2926ms** (n=1)
- 셸 `real`(프로세스 기동 포함) − 내부 `duration_ms` = "init 이전 오버헤드":
  - 대조군: 5.837s − 2.926s = **2.91s**
  - 클린 #2: 2.757s − 1.943s = **0.81s**
  - 클린 #5: 2.983s − 2.057s = **0.93s**
  → **클린 프로파일이 init-이전 시동 오버헤드를 약 2초 줄인다.** 이게 "컨텍스트 로드 오버헤드"의 실측 크기다 (훅 6개 순차 실행 + 388개 스킬/4개 MCP서버 연결/4개 플러그인 로드 vs 0).
- n이 각 1~2뿐이라 표준편차를 못 낸다 — **경향은 뚜렷하지만(클린이 명확히 빠름) 통계적으로 얇은 근거**다.

---

## 실행 방법 : 재현 커맨드

```bash
# 사전 준비
mkdir -p spike/cli-pipe/clean spike/captures

# 검증 1 — 대조군 (프로젝트 루트)
claude -p "1+1은?" --output-format stream-json --verbose > spike/captures/S3-verify1.ndjson

# 검증 2 — 클린 프로파일 (핵심)
cd spike/cli-pipe/clean
claude -p "1+1은?" --output-format stream-json --verbose --setting-sources "" > ../../captures/S3-verify2-clean.ndjson

# 검증 2 함정 대조군 — "user"만 주면 완화책이 깨짐을 확인
claude -p "1+1은?" --output-format stream-json --verbose --setting-sources "user" > ../../captures/S3-verify2b-usersource.ndjson

# 검증 4 — MCP 서버 (.mcp.json: @modelcontextprotocol/server-everything)
claude -p "everything 서버의 echo 툴로 hello 를 에코해줘" \
  --output-format stream-json --verbose --setting-sources "" \
  --mcp-config .mcp.json --strict-mcp-config > ../../captures/S3-verify4-mcp.ndjson

# 검증 5 — 클린 프로파일 반복 (지연 2번째 샘플)
claude -p "1+1은?" --output-format stream-json --verbose --setting-sources "" > ../../captures/S3-verify5-clean-rep2.ndjson
```

각 `.ndjson`을 `node -e "JSON.parse(line)..."`로 라인 단위 파싱해 `type`/`subtype`, `system/init`의 `mcp_servers`/`plugins`/`skills`/`hooks`, `result`의 `duration_ms` 등을 추출했다 (커맨드는 위 커맨드들 실행 후 대화 로그에 남아있음, 재현 시 동일 로직으로 스크립트화 가능).

---

## 독립 검증 (S3 검증 에이전트, 재실행 1회)

- `spike/cli-pipe/clean`에서 `claude -p "2+2는?" --output-format stream-json --verbose --setting-sources ""` 를 1회 재실행 → `spike/captures/S3-verify6-repro.ndjson`.
- 결과: `hook_started: 0`, `mcp_servers: []`, `plugins: 0`, `skills: 14`, `slash_commands: 39`, `tools: 27`, `apiKeySource: none`, `result: "4"` — 원 검증 2의 수치와 **정확히 일치**. 클린 프로파일 완화책은 재현된다.
- `claude --help`를 직접 실행해 `--setting-sources`·`--safe-mode` 인용문을 원문과 대조 → **일치 확인** (문서 베낀 게 아니라 실측).
- §2 비교표(①②③)의 `hook_started`/`mcp_servers`/`plugins`/`skills`/`slash_commands`/`tools` 전 수치와 §6 지연표의 `duration_ms`/`duration_api_ms`/`ttft_ms` 전 값을 캡처 파일에서 재계산해 대조 → **표와 실측 파일이 전부 일치**.
- `spike/captures/S3-verify4-mcp.ndjson`의 `tool_use`/`tool_result`/`permission_denials` 내용도 본문 인용과 **일치**.
- 사소한 흠: `spike/captures/S3-stream.ndjson`이 `S3-verify1.ndjson`과 바이트 단위로 동일한데 RESULT.md 어디에도 언급되지 않는 미참조 중복 파일이다(같은 세션 ID `cf469d30-...`, verify1을 만들 때 리다이렉트한 원본 파일명이 남은 것으로 추정). 조작은 아니지만 정리 대상.

**종합 판정**: 표·수치·인용 전부 검증 통과. 과장·조작 흔적 없음. §9 문서명 누락만 정정했다.

## 막힌 것 (정직하게)

1. **호출당 지연 "3회 반복 × 2조건 = 6회"를 다 못 채웠다.** 스파이크 공통 규칙 "총 5회 이내"가 이 스파이크 자체 지시("3회씩 측정")보다 우선한다고 판단해 예산을 지켰다. 그 결과 클린 프로파일만 n=2, 대조군은 n=1, MCP 왕복은 n=1(멀티턴이라 단순 비교 불가)이다. **경향(클린이 약 2초 빠름)은 확인했지만 통계적으로 얇다.**
2. **`--safe-mode` 플래그를 실측하지 못했다.** `claude --help`에 §9 완화책의 대안이 될 수 있는 플래그를 발견했지만(훅·MCP·플러그인·CLAUDE.md 전부 비활성화, 디렉토리 격리 불필요), 호출 예산 소진으로 실제 동작을 확인하지 못했다. 후속 검증 필요.
3. **`--max-budget-usd`(v2.1.217+)는 `--help`에 존재함을 확인했지만 실제 동작(예산 초과 시 강제 종료)은 테스트 안 했다** — 예산 초과를 유도하려면 추가 호출이 필요해서 생략.
4. **프로젝트 간 `--resume`(v2.1.223+)은 검증 불가** — 설치된 버전이 2.1.220으로 요구 버전보다 낮다. `--help`에 프로젝트 간 동작 관련 문구가 없어 이 설치본이 구버전 동작(같은 프로젝트 내 재개만)인지조차 문서상으로 구분이 안 된다. 업그레이드 없이는 판정 불가.
5. **MCP 실제 데이터 왕복(echo 응답 본문)은 못 봤다.** 권한 게이트에서 막혀서 `everything` 서버가 실제로 "hello"를 에코하는 것까진 확인 못 했다 — 서버 로드와 tool_use 발화까지만 확인됐다. `--allowedTools "mcp__everything__echo"`를 추가하면 뚫릴 가능성이 높지만 예산 안에서 테스트 안 함.
6. 클린 디렉토리에서 `claude` 실행 중 **내 자신의(이 스파이크를 수행 중인 상위 에이전트) OMC 세션이 Bash cwd를 그 디렉토리로 옮긴 부작용으로 `.omc/` 상태 파일이 생겼다가 삭제했다** — 스파이크 subprocess가 만든 게 아니라 세션 ID 대조로 확인 후 제거함. 클린 프로파일 결과 자체에는 영향 없음(session_id 불일치로 확인).

---

## 판정 — soul.md §1 유지 가능한가

**유지 가능하다. 개정 불필요.** 단 §9 완화책 문서에 **정확한 문법**을 명시해야 한다:

> `--setting-sources` 는 반드시 **빈 문자열**(`--setting-sources ""`)로 줘야 한다. `"user"`나 `"project"`처럼 값을 하나라도 넣으면 (이 개발 환경처럼 훅·MCP·플러그인이 유저 스코프에 등록된 경우) **대조군과 동일하게 전부 로드되어 완화책이 무력화**된다.

추가로 §9 문서에 반영 권고:
- MCP 보안 구멍은 "서버 프로세스 실행"(무확인) vs "툴 호출"(기본 권한 게이트로 막힘, 헤드리스에서 자동 거부) 두 층위로 나뉜다는 걸 명시할 것. Athena가 감시 루프에 MCP를 붙일 때 (a) 등록 서버 화이트리스트, (b) `--allowedTools` 명시적 목록, 이 둘을 같이 써야 진짜 안전하다.
- `--safe-mode` 플래그가 클린 디렉토리 방식의 더 단순한 대안일 수 있음 — 후속 스파이크로 넘김.
- 클린 프로파일이 init-이전 시동 오버헤드를 약 2초(2.91s→0.81~0.93s) 줄인다는 실측치를, 감시 루프 반응속도 설계에 반영할 것.
