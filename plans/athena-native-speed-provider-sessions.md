# Athena 네이티브급 Codex·Claude 지속 세션 런타임 구현 청사진

- 상태: 구현 준비 완료
- 기준 저장소: `C:\Projects\DAOU.Athena`
- 기준 브랜치/커밋: `main@d5693f8`
- 작성 기준일: 2026-08-30 KST
- 적용 범위: Electron 메인 프로세스의 대화형 LLM 실행 경로
- 제외 범위: Selector worker pool, Kiwoom REST fast path, Canvas 렌더러의 의미 변경
- 목표 릴리스: 기능 플래그 기반 점진 전환 후 지속 세션 기본 활성화

> 이 문서의 “네이티브급”은 Athena가 매 턴마다 provider 프로세스와 MCP 연결을 다시 만드는 로컬 지연을 제거한다는 뜻이다. 모델 추론 시간, provider 서비스 상태, 네트워크, 실제 도구 실행 시간까지 Codex CLI 또는 Claude Code와 항상 동일하다고 보장한다는 뜻은 아니다.

## 0. 이 문서의 사용법

구현자는 아래 순서를 지킨다.

1. `1`~`14`의 계약과 불변식을 먼저 읽는다.
2. `16`의 PR 단계를 순서대로 구현한다. 병렬 가능 표기가 있는 단계만 병렬화한다.
3. 각 단계의 검증 명령과 종료 기준을 모두 충족한 뒤 다음 단계로 이동한다.
4. 설계 변경이 필요하면 `20`의 변경 프로토콜을 먼저 적용한다.
5. 최종 완료는 `21`의 Definition of Done을 모두 만족할 때만 선언한다.

기존 사용자 작업이 남아 있는 worktree에서는 먼저 아래를 실행하고, 이 문서에 적힌 파일 외의 변경을 건드리지 않는다.

```powershell
git status --short --branch
git diff --name-only
```

현재 기준 worktree에는 Canvas·semantic workspace 관련 사용자 변경이 있으므로, 구현 작업은 별도 worktree 또는 독립 브랜치에서 시작하는 것을 기본으로 한다.

## 1. 목표와 성공 기준

### 1.1 제품 목표

Athena의 일반 대화 질의를 다음 구조로 바꾼다.

- Claude: 턴마다 `claude -p`를 새로 띄우지 않고, Claude Agent SDK의 streaming input 세션을 활성 대화 동안 유지한다.
- Codex: 설정 화면에만 존재하던 Codex를 실제 질의 경로에 연결하고, 앱 수명 동안 하나의 `codex app-server --stdio` 프로세스를 유지한다.
- 공통: 대화별 provider cursor를 유지하고, 새 턴은 기존 세션에 전달한다.
- 보안: MCP 등록·승인·허용·철회·삭제·secret 변경 시 이전 runtime generation을 원자적으로 차단한다.
- 안정성: 중단, 프로세스 종료, EOF, 지연 이벤트, 출력 폭주, 재시작 폭주를 결정적으로 처리한다.

### 1.2 하드 성공 기준

다음은 릴리스 차단 조건이다.

| ID | 기준 |
|---|---|
| P-01 | warmed 대화 100턴 동안 provider 프로세스 spawn 수가 턴 수와 무관하고, 정상 턴당 spawn은 0이다. |
| P-02 | warmed 대화 100턴 동안 Athena MCP gateway 재기동 수가 정상 턴당 0이다. |
| P-03 | 같은 대화에서 동시에 실행되는 provider turn은 최대 1개다. |
| P-04 | 다음 턴은 이전 턴의 canonical terminal event와 drain/fence 경계가 끝난 뒤에만 시작한다. |
| P-05 | interrupt ACK만으로 완료 처리하지 않는다. provider의 실제 terminal event를 기다린다. |
| P-06 | 권한 철회·tool disallow·server remove가 성공을 반환한 뒤 이전 generation에서 새 tool call이 실행되는 경우가 0건이다. |
| P-07 | 이전 process·thread·query의 지연 이벤트가 새 턴 UI, Canvas, history에 도달하는 경우가 0건이다. |
| P-08 | 개행 없는 마지막 JSONL result 뒤 정상 종료해도 성공 result와 session cursor를 잃지 않는다. |
| P-09 | line, turn, generation 출력 상한이 idle·busy·result-seen 상태 모두에서 적용된다. |
| P-10 | 앱 종료 뒤 provider 또는 gateway 자식 프로세스가 남지 않는다. |
| P-11 | `ATHENA_PERSISTENT_CHAT=0`으로 앱을 재시작하면 supervisor/SDK/app-server를 만들지 않고 기존 Claude cold path로 되돌아간다. |
| P-12 | Codex와 Claude 어느 provider를 활성화해도 같은 renderer IPC·history·Canvas 계약을 사용한다. |

### 1.3 체감 속도 수용 기준

속도 게이트는 “provider 자체 시간”과 “Athena가 추가한 로컬 시간”을 분리한다.

| 측정값 | 하드 기준 |
|---|---|
| `main_ipc_to_provider_write_ms` | deterministic fake-provider 1,000턴에서 p95 ≤ 15ms |
| `provider_event_to_main_dispatch_ms` | deterministic fake-provider 1,000턴에서 p95 ≤ 10ms |
| `renderer_event_to_first_paint_ms` | deterministic Electron probe 100턴에서 p95 ≤ 32ms |
| `renderer_submit_to_first_paint_ms` | provider가 즉시 응답하는 deterministic Electron probe의 turn별 same-renderer interval p95 ≤ 50ms |
| warmed native 대비 `submit_to_first_text_ms` | 같은 계정·모델·effort·MCP·prompt로 번갈아 30회 측정 시 median 열화 ≤ max(150ms, native median의 10%), p95 열화 ≤ max(500ms, native p95의 20%) |
| warmed turn process spawn | 0 |

비교 벤치마크는 Claude와 Codex를 따로 측정한다. 외부 서비스 변동으로 live 비교가 불안정해도 deterministic local gate는 반드시 통과해야 하며, live 결과는 원시 표본·median·p95·max를 함께 남긴다.

각 하드 기준은 독립적으로 통과해야 한다. 서로 다른 구간의 p95를 더해 aggregate p95를 만들지 않는다. aggregate는 turn별 correlated end-to-end sample을 먼저 계산한 뒤 그 sample 집합의 p95를 구한다.

### 1.4 비목표

- Selector 분류기를 대화 세션과 합치지 않는다.
- 한 대화에서 여러 provider를 동시에 실행하지 않는다.
- 앱 재시작을 넘는 provider cursor 영속화와 과거 sidebar 대화 복원은 v1 범위가 아니다. v1은 현재 foreground conversation chain 하나만 유지한다.
- Codex experimental WebSocket 또는 `thread/queue/*` API를 사용하지 않는다.
- provider의 모델 추론 시간이나 외부 MCP 서버 응답 시간을 최적화하지 않는다.
- Canvas·Kiwoom·order 승인 정책을 넓히지 않는다.
- 이 성능 작업에서 기존 tool allowlist를 확장하지 않는다.

## 2. 현재 상태와 차이

| 영역 | 현재 main | 목표 |
|---|---|---|
| Claude 일반 대화 | `app/main.js`의 `runLiveQueryInner()`가 `app/lib/main/claude-runner.js`의 `runClaudeQuery()`를 호출해 매 턴 새 CLI 프로세스를 띄운다. | 앱 boot에서 warm generation을 만들고 활성 대화 동안 하나의 streaming `Query`를 유지한다. |
| Claude 멀티턴 | 성공할 때마다 `liveSessionId`를 갱신하고 다음 cold process에 `--resume`한다. | 같은 `Query`에 user input을 순차 전달하고, 재기동 때만 저장된 `session_id`로 resume한다. |
| Codex | 계정 감지와 `$CODEX_HOME/config.toml` 모델 설정만 있고 live query 결선이 없다. | 앱당 하나의 app-server와 대화별 `threadId`를 사용한다. |
| 취소 | `activeLiveQuery.kill()`로 현재 Claude process tree를 끊는다. | provider별 interrupt 요청 후 canonical terminal을 기다리고, timeout이면 generation을 fence하고 process tree를 종료한다. |
| Selector | `claude-selector-worker-pool.js`가 별도 warm worker pool을 유지한다. | 그대로 유지한다. 대화 supervisor와 공유하지 않는다. |
| MCP 변경 | 별도 Python CLI가 registry/consent 파일을 바꾸고, 실행 중 process는 자체 snapshot을 계속 쓸 수 있다. | mutation coordinator가 dispatch 차단 → active turn interrupt/drain → runtime fence → disk mutation/secret migration → 새 snapshot start/ready → atomic publish 순서를 소유한다. |
| 종료 | 여러 `before-quit`/`will-quit` 훅이 존재한다. | 기존 통합 종료 흐름에 supervisor stop을 연결하고, awaited process-tree 종료를 완료한 뒤 Electron 종료를 허용한다. |

참고용 prototype worktree의 지속 Claude 세션 코드는 아이디어와 실패 재현 테스트만 참고한다. `app/main.js`를 직접 병합하거나 cherry-pick하지 않는다. 최신 main의 shutdown, conversation, REST fast path, selector fast path, order-draft 흐름 위에 수동으로 통합한다.

## 3. 고정 설계 결정

| ID | 결정 |
|---|---|
| D-01 | `ProviderSessionSupervisor`가 대화형 provider 실행의 유일한 진입점이다. `app/main.js`가 provider process를 직접 만들지 않는다. |
| D-02 | 활성 CLI 계정의 `providerId`가 live provider를 결정한다. `cli-accounts.js`는 `async reconcileCodexRuntimeAccount()`, 기존 IPC shape를 보존하는 `async list()`, `{accountId, providerId} | null`만 반환하는 `async getActiveAccount()`를 제공한다. 뒤의 두 API는 매 호출마다 reconciliation을 await하며 그 저장 변경을 숨기지 않는다. pure selector는 reconciled snapshot 내부 구현으로만 둔다. |
| D-03 | Codex는 Electron 앱당 app-server process 하나, Athena conversation당 thread 하나를 사용한다. |
| D-04 | Claude는 현재 foreground Athena conversation에 streaming `Query` 하나를 사용한다. v1은 과거 sidebar 대화로 돌아가는 runtime 복원을 열지 않고, 현재 chain의 runtime binding `{provider:'claude',sessionId}`와 마지막 성공 durable checkpoint `{provider:'claude',sessionId,assistantMessageId,assistantMessageHash}`만 앱 메모리에 보관한다. |
| D-05 | Claude SDK target은 `@anthropic-ai/claude-agent-sdk@0.3.251`이다. CommonJS main에서는 `await import()`로 로드한다. 패키지 추가 전 명시적 dependency 승인 게이트를 통과해야 한다. |
| D-06 | Claude SDK import·native binary·initialize 실패 때만 기존 cold runner를 emergency fallback으로 쓴다. 턴별 normal fallback으로 사용하지 않는다. |
| D-07 | Selector worker pool은 별도 process·queue·tool policy를 계속 사용한다. 대화 session cursor, prompt, MCP runtime을 공유하지 않는다. |
| D-08 | product 정책은 기존과 같은 “새 질의가 이전 질의를 대체”다. transport는 host-side ordered queue를 사용하며, 새 질의는 active turn interrupt barrier 뒤 실행된다. pending replacement는 최대 1개다. |
| D-09 | history의 `conversation_id`, Athena UI conversation ID, Claude `session_id`, Codex `threadId`, provider `turnId`를 서로 대체하지 않는다. |
| D-10 | provider runtime binding과 continuation checkpoint를 분리한다. binding은 Claude `{provider:'claude',sessionId}` 또는 Codex `{provider:'codex',threadId}`다. checkpoint는 Claude `{provider:'claude',sessionId,assistantMessageId,assistantMessageHash}`의 durable transcript boundary 또는 Codex `{provider:'codex',turnId}`다. Codex `threadId`는 thread start/resume 성공 즉시 binding으로 저장하지만 checkpoint와 history assistant 완료는 성공 terminal과 persistence barrier를 통과한 뒤에만 전진시킨다. |
| D-11 | 모델·effort·system prompt·MCP·권한·secret snapshot은 runtime generation의 불변값이다. 변경 시 새 desired state를 먼저 기록하고 generation을 교체한다. |
| D-12 | 권한·registry·secret 변경은 hard security rotation이다. Codex app-server와 Claude Query를 모두 fence/stop하고 새 snapshot으로 다시 기동한다. 빈번하지 않은 설정 변경의 cold cost보다 stale capability 차단을 우선한다. |
| D-13 | Codex production transport는 stdio JSONL만 사용한다. WebSocket과 experimental queue는 사용하지 않는다. |
| D-14 | 모든 child event는 `runtimeGeneration + conversationId + turnId + sequence`를 통과해야 renderer로 전달된다. |
| D-15 | process tree 종료는 awaitable 작업이다. event generation drop은 보안 fence가 아니다. 보안 fence는 gateway가 매 call 검사하는 random capability token/epoch의 원자적 무효화이며, security mutation success와 새 runtime publish에는 old process-tree 종료 확인까지 필요하다. |
| D-16 | 기존 Claude tool policy를 의미 변경 없이 옮긴다. allowed: Athena gateway, Agent/Task, Read, Glob. disallowed: Bash, Write, Edit, NotebookEdit, Grep, WebFetch, WebSearch. `bypassPermissions`는 금지한다. |
| D-17 | 앱 창 렌더는 provider warmup을 기다리지 않는다. 첫 live turn은 supervisor readiness를 기다리며, terminal warmup failure만 사용자에게 표시한다. |
| D-18 | `ATHENA_PERSISTENT_CHAT=0`은 한 릴리스 이상 유지하는 process-start emergency kill switch다. 값 변경은 앱 재시작 뒤 적용하며 hot transition을 약속하지 않는다. |
| D-19 | Codex의 MCP inventory와 built-in capability는 별도 경계다. installed stable API로 Claude 정책과 동등한 built-in 차단을 강제·검증하지 못하면 Codex live path는 사용자 승인 없이 활성화하지 않는다. |

## 4. 목표 아키텍처

```text
Renderer / chat composer
        |
        | athena:live-query
        v
app/main.js
  - REST / selector fast paths는 기존 순서 유지
  - provider가 필요한 경우 supervisor.sendTurn()
        |
        v
ProviderSessionSupervisor
  - active provider resolution
  - desired state + runtime/security generation
  - conversation cursor map
  - single-flight + interrupt barrier
  - restart backoff / circuit breaker
  - normalized event dispatch
        |
        +-------------------------------+
        |                               |
        v                               v
ClaudeAgentSession                CodexAppServerSession
  WarmQuery -> Query                one app-server process
  AsyncInputQueue                   one threadId/conversation
  session_id cursor                 JSON-RPC request map
        |                               |
        +---------------+---------------+
                        |
                        v
                 Athena MCP gateway
          registry + consent + secret snapshot

별도 격리 경로:
ClaudeSelectorWorkerPool -> selector 전용 prompt/tool-disabled workers
```

### 4.1 구성 요소 책임

| 구성 요소 | 책임 | 금지 |
|---|---|---|
| `ProviderSessionSupervisor` | lifecycle, provider 선택, queue, generation, fencing, retry, metrics | provider wire format 직접 해석 |
| `ClaudeAgentSession` | SDK load, WarmQuery/Query, input queue, Claude event 변환 | history ID 생성, UI 직접 호출 |
| `CodexAppServerSession` | process, initialize, JSON-RPC, thread/turn lifecycle, Codex event 변환 | experimental API 사용 |
| `ProviderEventRouter` | normalized event 검증, stale event 폐기, 기존 IPC callback 호출 | provider-specific object 노출 |
| `McpRuntimeCoordinator` | mutation lock, secret migration, config snapshot, security rotation | disk mutation 성공만으로 UI success 반환 |
| `ProviderRuntimeMetrics` | monotonic timestamps, counters, histogram summary | prompt·secret·tool payload 기록 |
| `ClaudeSelectorWorkerPool` | selector 전용 warm pool | conversational Query 공유 |

## 5. 식별자와 소유권

### 5.1 식별자

| 이름 | 생성자 | 수명 | 저장 위치 |
|---|---|---|---|
| `conversationId` | Athena conversations 모듈 | Athena app session | history/UI |
| `runtimeGeneration` | supervisor | runtime 교체까지 | supervisor |
| `securityGeneration` | MCP coordinator | 보안 snapshot 변경까지 | supervisor + mutation result |
| `configGeneration` | supervisor | model/effort/prompt snapshot 변경까지 | supervisor |
| `clientSubmitId` | submit 직전 renderer의 `crypto.randomUUID()` | 한 사용자 제출/paint sample | renderer pending-sample map + active turn |
| Claude `sessionId` | Claude init/result | provider session chain | conversation cursor map |
| Codex `threadId` | `thread/start`/`thread/resume` | app-server thread | conversation cursor map |
| `turnId` | supervisor가 먼저 생성 | 한 사용자 요청 | supervisor + normalized event |
| Codex provider turn ID | `turn/start` 응답/notification | 한 Codex turn | adapter 내부 매핑 |
| `sequence` | `ProviderSessionSupervisor`가 만든 `ProviderTurnContext.emit` | turn 내 단조 증가 | normalized event |
| `providerBinding` | provider start/resume | 현재 generation runtime 주소 | supervisor |
| `continuationCheckpoint` | 성공 terminal | 다음 복구가 시작할 마지막 확정 context | supervisor |

### 5.2 불변식

- `historyActiveConversationId !== claudeSessionId`다.
- `conversationId !== codexThreadId`다.
- provider가 새 cursor를 발급해도 현재 Athena conversation은 바뀌지 않는다.
- cursor map은 provider별로 분리한다.
- Codex `thread/start/resume`가 성공하면 `threadId` binding을 즉시 저장해 interrupt·cleanup·후속 correlation에 사용한다.
- terminal success를 받기 전에는 continuation checkpoint와 assistant history completion을 교체하지 않는다.
- runtime generation이 달라지면 동일 provider cursor라도 event를 수락하지 않는다.

## 6. 공통 provider 계약

`app/lib/main/provider-session-contract.js`가 아래 shape의 정본이다. 구현은 CommonJS와 JSDoc을 사용해 현재 app 빌드 체계를 유지한다.

```js
/**
 * @typedef {'claude'|'codex'} ProviderKind
 * @typedef {'stopped'|'starting'|'ready'|'busy'|'interrupting'|
 *   'draining'|'rotating'|'backoff'|'failed'} RuntimeState
 *
 * @typedef {Object} ProviderDesiredState
 * @property {ProviderKind} provider
 * @property {string} accountId
 * @property {string} conversationId
 * @property {string} cwd
 * @property {string|null} model
 * @property {string|null} effort
 * @property {string} systemPrompt
 * @property {string} systemPromptHash
 * @property {number} configGeneration
 * @property {number} securityGeneration
 * @property {Readonly<Object>} mcpSnapshot
 * @property {Readonly<Object>} toolPolicy
 *
 * @typedef {Object} ProviderGenerationContext
 * @property {number} runtimeGeneration
 * @property {number} securityGeneration
 * @property {string} processOwnerId
 * @property {Object} spawnContext
 * @property {ProviderBinding|null} initialProviderBinding
 * @property {ContinuationCheckpoint|null} initialContinuationCheckpoint
 *
 * @typedef {Object} ProviderTurnContext
 * @property {(type:string, payload:Object, providerTurnId?:string|null)=>void} emit
 * @property {()=>void} assertCurrent
 *
 * @typedef {Object} ProviderTurnRequest
 * @property {string} clientSubmitId
 * @property {string} conversationId
 * @property {'shell'|'orb'} origin
 * @property {string} userText
 *
 * @typedef {Object} ProviderTurn
 * @property {string} clientSubmitId
 * @property {string} conversationId
 * @property {string} turnId
 * @property {'shell'|'orb'} origin
 * @property {string} userText
 * @property {AbortSignal} signal
 *
 * @typedef {Object} ProviderInternalEvent
 * @property {ProviderKind} provider
 * @property {number} runtimeGeneration
 * @property {string} clientSubmitId
 * @property {string} conversationId
 * @property {string} turnId
 * @property {number} sequence
 * @property {number} monotonicAtMs
 * @property {string} type
 * @property {Object} payload
 *
 * @typedef {Object} ProviderRendererEvent
 * @property {string} clientSubmitId
 * @property {string} turnId
 * @property {number} sequence
 * @property {'shell'|'orb'} origin
 * @property {string} type
 * @property {Object} safePayload
 *
 * @typedef {{provider:'claude',sessionId:string}|{provider:'codex',threadId:string}} ProviderBinding
 * @typedef {{provider:'claude',sessionId:string,assistantMessageId:string,assistantMessageHash:string}|{provider:'codex',turnId:string}} ContinuationCheckpoint
 * @typedef {{ok:true,provider:ProviderKind,conversationId:string,turnId:string,providerBinding:ProviderBinding,continuationCheckpoint:ContinuationCheckpoint,finalText:string,usage:Object,timings:Object}} ProviderTurnSuccess
 * @typedef {{ok:false,provider:ProviderKind,conversationId:string,turnId:string,providerBinding?:ProviderBinding,interrupted:boolean,retryable:boolean,code:string,error:string,timings:Object}} ProviderTurnFailure
 * @typedef {ProviderTurnSuccess|ProviderTurnFailure} ProviderTurnResult
 */

class ProviderSession {
  async start(desiredState, generationContext) {}
  async ready() {}
  async sendTurn(turn, turnContext) {}
  async interrupt(turnId, reason) {}
  async stop(reason) {}
  snapshot() {}
}

class ProviderSessionSupervisor {
  async start(desiredState) {}
  async ready() {}
  async sendTurn(request) {}
  async interrupt(turnId, reason) {}
  async rotate(nextDesiredState, reason) {}
  async stop(reason) {}
  snapshot() {}
}
```

supervisor method semantics는 다음으로 고정한다.

- `start(desiredState): Promise<void>`는 desired state를 먼저 저장하고 첫 generation start task를 예약한 뒤 resolve한다. adapter readiness를 기다리는 promise가 아니다.
- `ready(): Promise<{provider,runtimeGeneration}>`는 현재 published generation의 adapter `ready()`와 contract/security gate가 모두 성공했을 때만 resolve하고, terminal start failure면 safe typed error로 reject한다.
- `sendTurn(request: ProviderTurnRequest): Promise<ProviderTurnResult>`는 caller의 canonical UUID `clientSubmitId`, conversationId, origin, userText를 검증하고 supervisor가 새 `turnId`와 turn-scoped `AbortController`를 생성해 internal `ProviderTurn`과 `ProviderTurnContext`를 만든 뒤 adapter의 `sendTurn(turn, turnContext)`에 한 번 dispatch한다. caller는 `turnId`나 AbortSignal을 만들거나 전달하지 않는다. canonical terminal 하나, 성공 checkpoint/history commit, event-dispatch drain이 끝난 뒤에만 resolve한다.
- `interrupt(turnId, reason): Promise<ProviderTurnResult|null>`는 matching active turn이 없으면 null, 있으면 그 turn의 canonical interrupted/failed result와 drain이 끝난 뒤 resolve한다. timeout이면 generation fence/terminate를 수행한 실패 result를 반환한다.
- `rotate(nextDesiredState, reason): Promise<{provider,runtimeGeneration}>`는 6절의 stop→fresh-context→start/ready→publish가 끝난 뒤 resolve한다.
- `stop(reason): Promise<void>`는 retry timer, adapter, registered child/descendant 종료를 await한다. `snapshot()`은 secret/context를 제외한 immutable diagnostic view만 반환한다.

`ProviderInternalEvent`는 main-process trusted event이고 `ProviderRendererEvent`는 renderer 전송 전 별도 sanitization을 통과한 event다. raw provider event를 Claude 모양으로 위장해 기존 소비자에 전달하지 않는다.

`ProviderDesiredState`에는 active `conversationId`와 비교 가능한 설정 hash/revision만 있고 secret value나 capability token이 없다. supervisor는 generation마다 non-serializable `ProviderGenerationContext`를 만들고 adapter의 `start()`에 한 번 전달한다. generation context에는 active-turn emitter가 없다. supervisor는 desired `conversationId`로 자신의 cursor map을 조회해 `initialProviderBinding`과 `initialContinuationCheckpoint`를 넣으며, adapter는 model/MCP/security 회전 뒤 이 마지막 성공 경계만 resume한다. cursor가 없는 새 conversation은 두 값이 모두 null이다. `spawnContext`는 다음 세 기능만 제공한다.

- `buildEnv(provider)`: secret store와 current capability token을 읽어 child spawn 직전에 새 env object를 만들고, spawn 호출 뒤 참조를 폐기한다.
- `registerChild(child, metadata)`: PID, creation time, provider, generation을 test/process owner registry에 등록하고 awaitable termination handle을 반환한다.
- `assertCurrent()`: spawn/write/tool-dispatch 직전 generation이 아직 current인지 검사한다.

turn dispatch 때 supervisor는 active turn을 먼저 등록하고 non-serializable `ProviderTurnContext` 하나를 만든다. adapter가 event를 낼 수 있는 유일한 경로는 `sendTurn(turn, turnContext)`로 받은 `turnContext.emit(type, payload, providerTurnId)`이며, 이 closure만 `runtimeGeneration`, `conversationId`, `turnId`, `sequence`를 stamp하고 sequence를 증가시킨다. adapter는 별도 callback, EventEmitter, raw IPC로 event를 우회하지 않는다. 따라서 stale adapter가 임의 generation을 주장해도 renderer/internal consumer 경계를 통과할 수 없다.

rotation은 adapter method가 아니라 `ProviderSessionSupervisor.rotate(nextDesiredState, reason)`만 소유한다. 이 method는 새 desired state 저장 → dispatch 차단과 active turn interrupt/drain → old adapter `stop()` await → 새 runtime generation과 `ProviderGenerationContext` 생성 → 새 adapter instance `start(nextDesiredState, nextGenerationContext)`/`ready()` → atomic publish 순서다. security rotation은 stop 전에 gateway capability를 먼저 무효화한다. old adapter에 새 context를 주입하거나 context 없이 adapter 자체 `rotate()`를 호출하는 구현은 금지한다. `ProviderGenerationContext`, `ProviderTurnContext`, spawn env, token은 `snapshot()`, log, metric, error, renderer IPC에 직렬화하지 않는다.

### 6.1 main-internal normalized event 종류

| type | 필수 payload | terminal |
|---|---|---|
| `turn_started` | providerTurnId (`string|null`) | 아니오 |
| `text_delta` | text | 아니오 |
| `thinking_delta` | text | 아니오 |
| `tool_started` | toolUseId, parentToolUseId, canonicalToolName, providerToolName, input | 아니오 |
| `tool_progress` | toolUseId, safeStatus | 아니오 |
| `tool_completed` | toolUseId, canonicalToolName, isError, content | 아니오 |
| `canvas_result` | toolUseId, status, validated Canvas envelope/receipt | 아니오 |
| `subagent_updated` | taskId, parentToolUseId, subtype, description, status, lastCanonicalToolName, elapsedMs | 아니오 |
| `permission_denied` | safeToolLabel, reasonCode | 아니오 |
| `usage_updated` | allowlisted token/cost fields | 아니오 |
| `warning` | code, safeMessage | 아니오 |
| `turn_completed` | providerBinding, continuationCheckpoint, usage, finalText | 예 |
| `turn_interrupted` | providerBinding 또는 null, reason; continuationCheckpoint는 갱신하지 않음 | 예 |
| `turn_failed` | code, retryable, safeMessage | 예 |

`tool_started.input`과 `tool_completed.content`는 `ReplayTurnCapture`, nudge guard, Canvas correlation을 위한 main-memory 전용 trusted payload다. log, metric, history, renderer IPC에는 원문을 넣지 않는다. renderer event router는 이를 `{id, label, done, elapsedMs, error}`와 allowlisted Canvas receipt로 축소한다. secret, raw environment, raw stderr는 internal event에도 넣지 않는다. terminal event는 turn당 정확히 한 번만 방출한다.

Claude에는 provider가 발급한 turn ID가 없으므로 `turn_started.providerTurnId`는 `null`이다. Athena `turnId`가 correlation 정본이다. Codex만 stable `turn/started`의 실제 ID를 넣는다. synthetic 값을 provider ID처럼 만들지 않는다.

### 6.2 provider별 tool/Canvas 매핑

| provider source | internal event |
|---|---|
| Claude assistant `tool_use` content block | `tool_started`; block id/name/input과 parent tool id를 보존 |
| Claude user `tool_result` content block | `tool_completed`; `tool_use_id`와 result content를 상관 |
| Claude `athena__render_canvas` tool result | 기존 Canvas parser/validator를 통과한 뒤 `canvas_result` 추가 방출 |
| Claude task/subagent system event | `subagent_updated` |
| Codex generated stable MCP tool-call item start | `tool_started` |
| Codex generated stable MCP tool-call item completion/result | `tool_completed`, render tool이면 `canvas_result` |
| Codex generated stable collaboration/subagent item | `subagent_updated` |

Codex item variant와 필드명은 배포 binary의 generated stable schema에서 가져와 PR-00 fixture로 잠근다. 알 수 없는 item variant를 tool success로 추측하지 않는다. `athena_resolve` input/result의 `toolUseId + plan_token`과 `athena__render_canvas` input token이 일치할 때만 replay cache judgment를 만든다는 기존 계약을 유지한다.

### 6.3 기존 소비자 adapter와 renderer ownership

`provider-event-router.js`는 internal event를 기존 소비자별 adapter에 한 번만 분기한다. 구현 매핑은 다음과 같다.

| 소비자 | internal event 입력 | exact mapping |
|---|---|---|
| `ReplayTurnCapture` | `tool_started`, `tool_completed`, `canvas_result` | `canonicalToolName`이 `athena_resolve`면 `{toolUseId,input}` 저장, `athena__render_canvas`면 render input 저장; matching resolve `tool_completed.content`에서 성공 `plan_token` 추출; `canvas_result`의 validated `canvas_type`만 actual type에 추가 |
| nudge guard proposal | matching `tool_started` + `tool_completed` | base tool name이 `athena_nudge_guard`, input action이 `propose`, completion이 success일 때만 content를 parse해 allowlisted `{current,proposed,notice}`로 축소 |
| tool-step tracker | `tool_started`, `tool_completed` | start→`{id:toolUseId,label,done:false,elapsedMs:null}`; complete→같은 ID와 main monotonic 차이로 `{id,label,done:true,elapsedMs,error}`; duplicate completion drop |
| subagent tracker | `subagent_updated` | renderer에는 `{taskId,subtype,description,status,lastToolName,elapsedMs}`만 전달; description은 control char 제거 후 160자 제한, tool name은 기존 `toolStepLabel`로 변환 |
| Canvas renderer | `canvas_result` | 검증된 기존 result envelope에 `{turnId,sequence,origin}`을 붙여 shell의 `athena:add-canvas-live`와 orb-origin의 `athena:orb-canvas-result`로 전달 |

`ReplayTurnCapture.observeProviderEvent(event)`처럼 consumer method를 normalized contract로 바꾸고, raw Claude `event.message.content`를 재구성해 넘기지 않는다. nudge guard는 trusted main-memory content를 parse하지만 renderer에는 원문 tool result를 보내지 않는다. tool/subagent elapsed time은 provider timestamp가 아니라 main monotonic receive time으로 계산한다.

first-paint ACK는 renderer singleton module `app/provider-first-paint.js` 하나만 소유한다. 이 파일은 classic-script IIFE로 frozen `window.AthenaProviderFirstPaint` API를 한 번 설치한다. `shell.html`은 이를 `canvas.js`와 `chat.js`보다 먼저, `orb.html`은 `orb.js`보다 먼저 로드한다. 각 renderer window에 singleton 하나가 생기며 `chat.js`, `canvas.js`, `orb.js`는 preload ACK API를 직접 호출하지 않는다.

- singleton은 `claimFirstVisible({clientSubmitId, turnId, sequence, origin, owner, node, rendererReceivedAt})`를 제공하고 `turnId`별 `unclaimed | claimed | acked | invalid` 상태를 보관한다. `owner` allowlist는 shell의 `chat|canvas`, orb의 `orb`다. `rendererReceivedAt`은 해당 normalized event handler 진입 즉시 같은 renderer clock으로 찍어 DOM metadata와 함께 넘긴다.
- `origin: 'shell'`에서 `chat.js`는 첫 text/tool DOM mutation 직후, `canvas.js`는 첫 success/fallback Canvas card append 직후 node가 connected·visible·non-empty임을 확인하고 같은 singleton을 호출한다. JavaScript 한 event-loop에서 최초 유효 호출만 claim record `{sequence, owner}`를 원자적으로 설치하고 token을 받는다. 두 module 중 어느 것도 claim 전에 double-rAF를 예약하지 않는다.
- `origin: 'orb'`에서는 `orb.js`만 같은 API를 호출할 수 있다. shell이 동시에 event를 받아도 orb turn을 claim할 수 없다.
- singleton만 claim token으로 double-rAF를 예약하고 두 번째 frame에서 node visibility와 token을 재검증한 뒤 pending submit map의 `rendererSubmittedAt`을 `clientSubmitId`로 조회하고 현재 clock의 `rendererPaintedAt`을 찍는다. 이어 preload의 `ackProviderFirstPaint({clientSubmitId,turnId,sequence,rendererSubmittedAt,rendererReceivedAt,rendererPaintedAt})`를 한 번 호출해 `acked`로 전이한다. 이후 claim은 duplicate counter에만 기록한다. pending submit가 없거나 claimed node가 사라지거나 낮은 sequence가 뒤늦게 도착하면 owner를 교체하지 않고 `invalid`/timeout으로 실패시킨다.
- owner renderer가 submit 시점에 visible하지 않거나 first visible mutation을 만들지 못하면 sample을 다른 renderer ACK로 대체하지 않는다. thinking preview, loading placeholder, rejected/error notice, hidden DOM은 후보가 아니다.

submit 직전 shell/orb renderer는 `clientSubmitId = crypto.randomUUID()`와 `rendererSubmittedAt = performance.now()`를 pending submit map에 넣고 IPC payload에 `clientSubmitId`를 포함한다. main은 이를 active turn에 bind하고 모든 normalized renderer event에 되돌려준다. 모든 module은 `clientSubmitId + turnId + sequence`를 DOM node/card와 함께 보존한다. Canvas ACK는 `chat.js`의 `athena:live-canvas-added` 상태 알림으로 대신하지 않는다. terminal/navigation cleanup은 이미 acked record를 재사용하지 않고 turn registry를 정리하되, benchmark 결과가 수집되기 전 record를 지우지 않는다. submit/ACK timeout은 pending map을 invalid sample로 기록한 뒤 bounded cleanup한다.

### 6.4 결과 shape

```js
{
  ok: true,
  provider: 'claude',
  conversationId,
  turnId,
  providerBinding: {
    provider: 'claude',
    sessionId: 'session-current'
  },
  continuationCheckpoint: {
    provider: 'claude',
    sessionId: 'session-current',
    assistantMessageId: 'assistant-uuid',
    assistantMessageHash: 'sha256-hex'
  },
  finalText,
  usage,
  timings
}

{
  ok: false,
  provider: 'codex',
  conversationId,
  turnId,
  interrupted: false,
  retryable: true,
  code: 'PROVIDER_OVERLOADED',
  error: '잠시 후 다시 시도해 주세요.',
  timings
}
```

성공 internal result의 `providerBinding`과 `continuationCheckpoint`는 필수이며 같은 turn의 `turn_completed` payload와 deep-equal이어야 한다. Claude completed에는 3필드 durable checkpoint가 반드시 있고 `{sessionId}` 단독 cursor는 금지한다. Codex completed에는 current `{provider:'codex',threadId}` binding과 `{provider:'codex',turnId}` checkpoint가 함께 있다. 실패·중단 result는 진단용 current binding을 가질 수 있지만 supervisor의 stored checkpoint를 교체하지 않는다.

## 7. 상태 머신

### 7.1 supervisor 상태

| 현재 | 사건 | 다음 | 필수 동작 |
|---|---|---|---|
| stopped | `start` | starting | desired state를 먼저 저장하고 generation을 할당 |
| starting | adapter ready | ready | ready promise resolve |
| starting | retryable failure | backoff | 실패 수 기록, jittered timer 예약 |
| starting | non-retryable failure | failed | terminal failure 저장 |
| ready | `sendTurn` | busy | turn token과 timeout 생성 |
| busy | replacement submit | interrupting | active interrupt, pending replacement 1개 저장 |
| busy | terminal | draining | terminal 처리, output pump drain |
| interrupting | terminal interrupted | draining | replacement 보존 |
| interrupting | grace timeout | rotating | old generation fence/kill |
| draining | drain complete | ready | pending replacement가 있으면 즉시 busy |
| ready/busy | config/security change | rotating | 새 turn 차단, active turn interrupt/fence |
| rotating | new adapter ready | ready | generation atomic publish |
| rotating | failure | backoff 또는 failed | 이전 security generation으로 복귀 금지 |
| any | `stop` | stopped | timers 제거, queue reject, child 종료 await |

### 7.2 turn 상태

```text
queued
  -> writing
  -> streaming
  -> terminal(completed | interrupted | failed)
  -> drained
```

규칙:

- `queued` turn만 교체 가능하다.
- `writing` 이후 새 질의가 오면 active turn을 interrupt한다.
- provider interrupt 응답은 `interrupting`일 뿐 terminal이 아니다.
- terminal event 뒤 adapter parser의 carry flush와 pending callback drain이 끝나야 `drained`다.
- `drained` 전에는 다음 turn을 provider에 쓰지 않는다.

### 7.3 generation fencing

event를 받으면 다음을 모두 만족할 때만 전달한다.

```js
event.runtimeGeneration === supervisor.runtimeGeneration
  && event.conversationId === activeTurn.conversationId
  && event.turnId === activeTurn.turnId
  && event.sequence > activeTurn.lastSequence
```

하나라도 실패하면 metrics의 `stale_event_dropped`만 증가시키고 부작용 없이 폐기한다.

## 8. 공통 lifecycle 시퀀스

### 8.1 앱 boot

1. process bootstrap 첫 단계에서 18.1의 flag predicate로 `resolvedMode: 'persistent' | 'cold'`를 한 번 결정한다. 아직 supervisor/provider adapter module을 import하지 않는다.
2. Electron 기본 상태와 창을 준비한다.
3. `await mcpEnv.migratePlaintextEnv()`를 완료한다.
4. registry, consent, secret sentinel을 다시 읽어 immutable `mcpSnapshot`을 만든다.
5. active CLI provider와 model/effort를 읽어 `ProviderDesiredState`를 만든다.
6. `resolvedMode === 'persistent'`일 때만 dynamic factory가 `ProviderSessionSupervisor`와 enabled adapter module을 import/construct하고 `void supervisor.start(desiredState).catch(publishSafeReadinessFailure)`로 background start를 예약한다.
7. `resolvedMode === 'cold'`이면 supervisor symbol을 import·construct·참조하지 않는다. active Claude는 첫 turn에서 legacy cold runner를 사용하고 active Codex는 kill-switch action-needed를 반환한다.
8. shell window는 provider warmup과 무관하게 표시한다.
9. persistent 첫 live turn만 `await supervisor.ready()`를 통과한 뒤 `sendTurn()`에 쓰고, cold path에는 이 call site가 존재하지 않는다.

금지 순서:

```text
provider child spawn
  -> child env snapshot
  -> migratePlaintextEnv
```

이 순서는 sentinel secret이 child env에 반영되지 않는 race를 만든다.

### 8.2 사용자 turn

1. 기존 REST/selector fast path를 먼저 평가한다.
2. provider가 필요한 경우 supervisor가 active provider와 desired state를 확인한다.
3. active turn이 있으면 replacement 정책에 따라 interrupt barrier를 연다.
4. turn-scoped AbortController, monotonic timestamps, timeout을 만든다.
5. provider adapter에 user input을 한 번만 쓴다.
6. normalized event를 기존 `sendLive*`/Canvas/history 경로로 보낸다.
7. canonical terminal에서 busy 상태를 끝낸다.
8. success일 때만 provider cursor와 assistant history를 확정한다.
9. drain 뒤 pending replacement를 시작한다.

### 8.3 Esc 또는 새 질의

1. REST/selector/provider active 작업에 동일한 conversation abort reason을 전달한다.
2. Claude는 `await Query.interrupt()`를 호출한다.
3. Codex는 `turn/interrupt({threadId, turnId})`를 호출한다.
4. ACK를 UI 완료로 보내지 않는다.
5. canonical terminal을 `INTERRUPT_GRACE_MS` 동안 기다린다.
6. timeout이면 runtime generation을 먼저 fence하고 process tree를 종료한다.
7. drain이 끝난 뒤에만 replacement를 보낸다.

### 8.4 앱 종료

1. 통합 `before-quit` coordinator가 새 IPC·turn을 차단한다.
2. active turn에 interrupt를 보낸다.
3. canonical terminal 또는 grace timeout을 기다린다.
4. Claude Query/WarmQuery를 close한다.
5. Codex stdio를 닫고 child 종료를 기다린다.
6. 남은 process tree를 강제 종료하고 실제 exit를 확인한다.
7. selector pool과 기존 backend/realtime shutdown을 완료한다.
8. Electron 종료를 재개한다.

`will-quit`의 fire-and-forget cleanup만으로 이 계약을 구현하지 않는다.

### 8.5 대화 경계

현재 `athena:conversations-set-active`는 저장된 메시지나 provider session을 복원하지 못하고 `restorable: false`를 반환한다. 이 성능 작업에서 과거 행 클릭을 runtime resume으로 바꾸지 않는다.

`athena:conversations-new`만 v1의 새 provider 대화 경계다.

1. 현재 REST/selector/provider turn을 interrupt한다.
2. canonical terminal과 drain/fence를 기다린다.
3. Claude Query를 close하거나 Codex old thread를 unsubscribe한다.
4. old conversation binding을 retired로 표시한다.
5. 새 `historyActiveConversationId`를 만든다.
6. 새 provider cursor는 null에서 시작한다.
7. 첫 입력 시 active provider의 새 Query/thread를 준비한다.

이 흐름은 과거 sidebar 제목 아래에 새 메시지를 잘못 저장하지 않으며, provider cursor를 history ID로 재사용하지 않는다. 과거 대화 메시지와 provider transcript를 실제로 복원하는 기능은 별도 설계 없이는 열지 않는다.

### 8.6 provider·계정·모델 변경

| 변경 | 경계 |
|---|---|
| active provider 또는 account 변경 | active turn interrupt/drain → old adapter stop → config generation 증가 → 새 provider start/ready |
| Claude model/effort 변경 | active turn drain → old Query close → 같은 성공 cursor로 새 Query resume |
| Codex model/effort 변경 | active turn drain → config generation 증가 → 다음 첫 `turn/start`에 stable `model/effort` override; security snapshot이 같으면 app-server process는 유지 가능 |
| system prompt/developer instructions 변경 | active turn drain → provider별 새 session/thread lifecycle |
| MCP/permission/secret 변경 | `11`의 hard security rotation; 두 provider process와 gateway를 fence |

provider 또는 account 전환이 실패하면 기존 provider로 조용히 돌아가지 않는다. 새 desired state를 유지한 action-needed 상태에서 사용자가 로그인 또는 재시도를 수행하게 한다.

### 8.7 실패·중단 뒤 context 복구

provider runtime은 실패·중단 turn의 user input, partial response, tool activity를 이미 내부 context에 넣었을 수 있다. Athena cursor 변수만 그대로 둔 채 같은 Query/thread를 재사용하면 “checkpoint가 전진하지 않았다”는 주장이 거짓이 된다.

Claude:

1. 정상 turn에서는 root `SDKAssistantMessage`의 마지막 `uuid`를 기억한다. `result/success`는 provisional success candidate일 뿐 terminal event가 아니다. 이 시점에는 checkpoint/history를 publish하지 않고 drain을 닫지 않으며 queue도 전진시키지 않는다.
2. `getSessionMessages(sessionId, {dir: cwd})`를 25ms 간격, 최대 5초 동안 조회해 그 assistant UUID가 transcript에 나타날 때까지 persistence barrier를 기다린다. 나타나면 그 persisted `SessionMessage.message`에서 canonical content hash를 계산한다.
3. barrier를 통과한 경우에만 `{sessionId, assistantMessageId, assistantMessageHash}`를 담은 `turn_completed`를 최초이자 유일한 terminal로 emit한다. supervisor terminal handler는 checkpoint와 assistant history를 await해 commit한 뒤 drain을 완료하고 queue를 전진시킨다. timeout/mismatch면 completed를 한 번도 emit하지 않은 채 `PROVIDER_CHECKPOINT_UNAVAILABLE`의 `turn_failed` 하나만 emit하고 history completion을 쓰지 않는다.
4. 실패·중단 terminal을 받으면 현재 Query를 close하고 generation child를 fence한다.
5. 마지막 성공 checkpoint가 있으면 `forkSession(checkpoint.sessionId, {dir: cwd, upToMessageId: checkpoint.assistantMessageId})`로 실패 turn 이전 transcript만 포함한 fork를 만든다. 단순 `resume: checkpoint.sessionId`는 실패 turn도 포함할 수 있으므로 금지한다.
6. `getSessionMessages(fork.sessionId, {dir: cwd})`에서 마지막 root assistant의 content hash가 checkpoint hash와 같은지 확인하고, fork에서 새로 remap된 assistant UUID로 checkpoint binding을 교체한 뒤 새 Query를 `resume: fork.sessionId`로 시작한다. 이것은 논리 checkpoint를 전진시키는 것이 아니라 같은 성공 경계를 새 binding으로 재표현하는 작업이다.
7. 성공 checkpoint가 없으면 새 Query/session을 시작하고 checkpoint는 null로 둔다.
8. fork/read/resume 또는 hash 검증이 실패하면 `PROVIDER_CONTEXT_LOST`로 fail-closed한다. recovery ready 전 next turn을 쓰지 않는다.

Codex:

1. `threadId` binding과 실패·중단 provider turn ID를 audit에 남긴다.
2. 마지막 성공 `continuationCheckpoint.turnId`가 있으면 stable `thread/fork {threadId, lastTurnId}`로 그 turn까지 포함한 새 thread를 만든다.
3. 성공 turn이 하나도 없으면 새 thread를 시작한다.
4. old thread를 retired/unsubscribe하고 새 `threadId`를 runtime binding으로 publish한다.
5. fork/start가 실패하면 `PROVIDER_CONTEXT_LOST`로 fail-closed하고 새 대화를 조용히 만들지 않는다.

`thread/rollback`은 deprecated이므로 사용하지 않고, experimental `beforeTurnId`도 사용하지 않는다. Claude `sessionId`도 point-in-time checkpoint로 취급하지 않는다. context 복구는 이미 외부로 실행된 tool side effect를 되돌리지 않으므로, 보안 mutation과 order approval의 별도 경계는 그대로 유지한다. fault test는 다음 prompt가 실패·중단 turn에만 있던 sentinel text를 관찰하지 못함을 두 provider 모두에서 증명한다.

## 9. Claude adapter 상세

### 9.1 공식 target

- 패키지: `@anthropic-ai/claude-agent-sdk@0.3.251`
- runtime: Node.js 18 이상
- 모듈: ESM. CommonJS에서 `await import('@anthropic-ai/claude-agent-sdk')` 사용
- 권장 모드: `query({prompt: AsyncIterable<SDKUserMessage>, options})` streaming input
- warmup: `startup()`으로 subprocess와 initialize를 선행하고, 첫 turn에서 `WarmQuery.query()`를 정확히 한 번 호출

### 9.2 시작

`ClaudeAgentSession.start(desired, generationContext)`는 다음 순서를 지킨다.

1. desired state와 supervisor가 발급한 generation context를 instance에 저장하고 `generationContext.spawnContext.assertCurrent()`를 호출한다. `warm()` 또는 spawn보다 먼저 수행한다.
2. SDK를 dynamic import한다.
3. generation-scoped `AsyncInputQueue`를 만든다.
4. immutable options를 만든다.
5. `startup({options, initializeTimeoutMs: 60_000})`를 호출한다.
6. WarmQuery가 준비되면 adapter ready를 확정한다.
7. 첫 turn에서 `warmQuery.query(inputQueue)`를 한 번 호출하고 단일 output pump를 시작한다.
8. 이후 turn은 같은 queue에 `SDKUserMessage`를 넣는다.

최소 user message:

```js
{
  type: 'user',
  message: { role: 'user', content: turnPrompt },
  parent_tool_use_id: null
}
```

### 9.3 options

SDK target version의 타입과 official contract probe를 통과한 필드만 사용한다.

```js
{
  cwd: desired.cwd,
  model: desired.model || undefined,
  effort: desired.effort || undefined,
  resume: cursor.sessionId || undefined,
  includePartialMessages: true,
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    append: desired.systemPrompt
  },
  settingSources: [],
  strictMcpConfig: true,
  spawnClaudeCodeProcess: generationOwnedSpawn,
  env: {
    ENABLE_TOOL_SEARCH: '0'
  },
  mcpServers: desired.mcpSnapshot.claudeServers,
  tools: desired.toolPolicy.availableBuiltins,
  allowedTools: desired.toolPolicy.allowedTools,
  disallowedTools: desired.toolPolicy.disallowedTools,
  permissionMode: 'default',
  hooks: {
    PreToolUse: [generationScopedPreToolUse]
  },
  canUseTool: interactiveApprovalOnly
}
```

exact pin인 SDK `0.3.251`의 공식 필드명은 `effort`다. contract probe가 이 이름과 타입을 고정하며, drift가 있으면 adapter를 ready로 publish하지 않는다.

`settingSources: []`는 현재 CLI의 `--setting-sources ''` 격리 동작을 보존한다. `strictMcpConfig: true`를 함께 사용해 user/project/plugin MCP가 generation snapshot 밖에서 추가되지 않게 한다. `tools`는 model-visible built-in 가시성을 제한하고, `allowedTools`는 pre-approval, `disallowedTools`는 deny/availability 정책을 담당한다. SDK의 공식 permission 순서는 hook이 allow rule보다 먼저이고 `allowedTools`로 자동 승인된 tool은 `canUseTool`을 우회하므로, 모든 호출의 generation fence는 `PreToolUse` hook이 소유한다.

`generationScopedPreToolUse`는 callback 시작과 실제 allow 반환 직전에 generation/capability token을 다시 검사하고 다음 경우에만 allow한다.

- `Agent`/`Task`, `Read`, `Glob` 중 현재 기존 정책에 있는 tool
- immutable MCP snapshot에 exact qualified name으로 존재하고 승인·allow된 Athena gateway tool

그 밖의 built-in, 새로 추가된 provider tool, snapshot 밖 MCP tool, stale/unknown generation은 `{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'stale or unauthorized provider generation'}}`로 fail-closed한다. callback이 throw해도 deny하며 `bypassPermissions`로 우회하지 않는다. `interactiveApprovalOnly`는 pre-approved되지 않은 unmatched interactive approval 경로에서만 사용하고 generation 권한 fence로 간주하지 않는다.

`generationOwnedSpawn(options)`는 `start()`가 받은 generation context를 closure로 캡처해 공식 `spawnClaudeCodeProcess` hook을 구현한다. spawn 직전에 `generationContext.spawnContext.assertCurrent()` → `buildEnv('claude')` → `{...options.env, ...generationEnv, ENABLE_TOOL_SEARCH:'0'}` 생성 → 다시 `assertCurrent()` 순서를 실행한 뒤 `options.command/args/cwd/signal`, `shell:false`, Windows `windowsHide:true`로 `child_process.spawn`을 호출한다. 뒤에서 병합되는 `generationEnv`가 stale secret/token을 덮는다. `buildEnv()` 결과는 `PATH` 등 필요한 parent key, current gateway capability token, secret snapshot을 포함하는 완성 env이며 options 생성 시 미리 계산하거나 instance field에 보관하지 않는다. spawn 직후 `registerChild(child, {provider:'claude', runtimeGeneration, processOwnerId})`를 호출해 awaitable termination handle을 저장하고 local env 참조를 폐기한 뒤 SDK가 요구하는 `SpawnedProcess` interface를 반환한다. stdout은 counting PassThrough를 거쳐 SDK에 전달하고 stderr는 bounded ring callback으로만 수집한다. `registerChild()` 실패 시 child를 즉시 awaited terminate하고 start를 실패시킨다.

### 9.4 시스템 프롬프트

Claude Code 기본 tool guidance와 safety를 보존한다.

```js
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: ATHENA_SYSTEM_APPEND
}
```

custom string으로 전체 system prompt를 교체하지 않는다. 현재 `buildLivePrompt`는 다음으로 분리한다.

- `buildLiveSystemPrompt(snapshot)`: generation 동안 불변
- `buildLiveTurnPrompt(input)`: 사용자 입력과 turn-scoped context만 포함

정적 규칙과 MCP manifest를 매 turn 재전송하지 않는다.

### 9.5 event 매핑

| Claude message | normalized event |
|---|---|
| `system/init` | cursor 후보 저장, adapter initialized |
| root `assistant` message | turn의 마지막 `SDKAssistantMessage.uuid`와 content hash 후보 저장 |
| `stream_event content_block_delta/text_delta` | `text_delta` |
| reasoning/thinking delta | `thinking_delta` |
| tool block start | `tool_started` |
| `tool_progress` | `tool_progress` |
| tool result | `tool_completed` |
| `system/permission_denied` | `permission_denied` |
| `rate_limit_event` | `warning` 또는 retry metadata |
| `result/success` | provisional success candidate 저장; 아직 terminal 아님 |
| `result/error_*` | `turn_failed` |
| transport throw/process exit | result가 아직 없으면 `turn_failed` |

`result/success` 뒤 adapter는 output pump를 해당 turn의 provisional-success 상태로 고정하고 persistence barrier를 await한다. barrier 성공 뒤에만 `turn_completed`, timeout/mismatch면 `turn_failed`를 emit한다. 이 기간 supervisor의 drain promise는 미완료이고 replacement queue는 멈춘다. `result/error_*`, barrier 결과, result 뒤 iterator throw/process exit는 하나의 terminal arbiter를 통과하며 compare-and-set으로 turn당 terminal 하나만 선택한다. 이미 provisional success인 상태에서 iterator가 throw해도 persistence barrier 결과가 terminal을 결정하고 throw는 diagnostic counter로만 남긴다.

### 9.6 cursor

- `system/init.session_id`는 recovery 후보로 저장한다.
- 최종 `result.session_id`만으로 authoritative checkpoint를 publish하지 않는다.
- root assistant event의 마지막 UUID를 저장하고 `result/success` 뒤 `getSessionMessages(sessionId, {dir: cwd})` persistence barrier가 같은 UUID를 확인한 뒤, persisted `SessionMessage.message`의 canonical hash를 계산해 `{sessionId, assistantMessageId, assistantMessageHash}`를 publish한다.
- canonical hash는 object key를 재귀적으로 Unicode code-point 오름차순 정렬하고 array 순서를 보존한 JSON UTF-8 bytes의 SHA-256이다. live partial frame을 합쳐 hash하지 않고 양쪽 모두 `getSessionMessages()`가 돌려준 persisted message만 hash한다.
- `getSessionMessages()`가 persistent Query의 마지막 turn보다 늦을 수 있으므로 즉시 한 번 읽고 없다고 실패시키거나 user-message UUID를 fork anchor로 사용하지 않는다. bounded polling timeout 뒤에는 `PROVIDER_CHECKPOINT_UNAVAILABLE`로 fail-closed한다.
- `continue: true`는 사용하지 않는다. cwd의 최근 session을 선택해 다른 대화를 이어 붙일 수 있기 때문이다.
- 정상 config rotation의 Query 재기동은 durable checkpoint의 `sessionId`를 resume한다. 실패·중단 recovery는 반드시 `forkSession(...upToMessageId)`와 remapped assistant UUID 검증을 먼저 수행한다.

### 9.7 interrupt와 close

- turn cancel: `await queryHandle.interrupt()`
- generation stop: `queryHandle.close()` 후 output pump 종료를 기다림
- warm 상태에서 query를 시작하지 않았다면 `warmQuery.close()`
- close 뒤 늦게 도착한 message는 generation token으로 폐기
- `Query/WarmQuery` 자체는 PID를 제공하지 않으므로 `generationOwnedSpawn`이 캡처한 실제 ChildProcess만 process fence의 근거로 사용
- grace timeout 뒤 process가 남으면 캡처한 child에 awaitable process-tree terminator 사용

### 9.8 fallback

SDK import, bundled binary, initialize 중 하나가 실패하고 error가 fallback allowlist에 있을 때만 기존 `runClaudeQuery`를 한 턴 실행한다.

```text
claude -p
  --input-format stream-json
  --output-format stream-json
  --verbose
  --include-partial-messages
```

fallback은 degraded 상태와 metric을 남긴다. 인증 실패, permission denial, invalid request를 fallback으로 숨기지 않는다.

## 10. Codex adapter 상세

### 10.1 process와 transport

```text
codex app-server --stdio
stdin  = JSON-RPC JSONL
stdout = JSON-RPC response + notification JSONL
stderr = bounded diagnostic ring
```

- stdio wire envelope에서 `"jsonrpc": "2.0"` 필드를 절대 보내지 않는다. request/response/notification은 `{id?, method?, params?, result?, error?}` shape만 사용한다.
- stdout과 stderr를 섞지 않는다.
- WebSocket은 production에서 사용하지 않는다.
- process 하나가 여러 Athena conversation thread를 소유한다.
- server notification의 선택적 top-level `emittedAtMs`는 진단 metadata로만 허용한다. turn/event ordering, dedup, terminal 판정에는 request ID와 thread/turn ID 및 adapter sequence만 사용하고 wall-clock timestamp를 권위로 쓰지 않는다.

`CodexAppServerSession.start(desired, generationContext)`는 generation context를 instance에 저장하고 `generationContext.spawnContext.assertCurrent()`를 통과한 뒤에만 10.10절의 `spawnGenerationAppServer(generationContext)`를 호출한다. 반환된 registered child만 JSONL client에 연결하며 initialize/initialized와 readiness가 끝날 때까지 adapter를 publish하지 않는다. crash retry와 security/config rotation은 old context를 재사용하지 않고 supervisor가 만든 새 context로 새 adapter instance를 시작한다.

### 10.2 initialize

connection당 정확히 한 번만 실행한다.

```json
{
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "athena",
      "title": "Athena",
      "version": "<app-version>"
    },
    "capabilities": {
      "experimentalApi": false
    }
  }
}
```

성공 response 뒤 `initialized` notification을 한 번 보낸다. 그 전에는 thread 요청을 보내지 않는다.

### 10.3 thread lifecycle

- conversation cursor가 없으면 `thread/start`
- 같은 app session에서 cursor가 있으면 `thread/resume`
- stable resume payload는 정확히 `{threadId}`만 사용한다. `excludeTurns`, `initialTurnsPage`, `historyMode`는 `experimentalApi:false`의 stable schema에 없으므로 보내지 않는다.
- `thread/start` response와 `thread/started` notification 순서가 달라도 idempotent하게 같은 thread를 등록한다.
- 한 thread의 write owner는 이 supervisor 하나뿐이다.
- app-server restart 뒤 앱 메모리에 cursor가 있으면 resume한다.
- resume `-32600` ownership 오류는 duplicate app-server/process 누수를 먼저 진단하고 새 thread로 조용히 우회하지 않는다.

새 thread의 최소 stable payload는 다음과 같다.

```json
{
  "id": 10,
  "method": "thread/start",
  "params": {
    "model": "<selected-model>",
    "cwd": "<absolute-workspace-path>",
    "approvalPolicy": "never",
    "sandbox": "read-only",
    "developerInstructions": "<Athena persistent developer instructions>",
    "config": {
      "model_reasoning_effort": "<selected-effort>"
    },
    "serviceName": "athena"
  }
}
```

규칙:

- `thread/start`의 sandbox 필드명은 `sandbox`이고 값은 kebab-case string이다.
- `thread/start`에는 top-level `effort` 또는 `reasoningEffort`를 보내지 않는다.
- `config.model_reasoning_effort`는 현재 공식 integration reference가 확인한 값이지만 `config` 자체는 opaque다. installed binary contract probe가 통과할 때만 보내고, 실패하면 이 object 전체를 생략한다. 선택된 effort는 stable `turn/start.effort`로 확정한다.
- `developerInstructions`는 thread 생성 시 한 번만 넣는다. stable `turn/start`에는 같은 필드가 없다.
- Athena의 대화형 Codex thread는 기본 `approvalPolicy: "never"`, `sandbox: "read-only"`로 시작한다. 더 넓은 권한은 이 성능 계획의 범위가 아니다.

### 10.4 turn lifecycle

```text
turn/start response
  -> turn/started
  -> item/started
  -> item-specific delta 0..n
  -> item/completed
  -> turn/completed
```

- 시작 경계: `turn/started`
- text: `item/agentMessage/delta`
- reasoning: `item/reasoning/summaryTextDelta` 등 generated stable schema가 허용한 event
- usage: `thread/tokenUsage/updated`
- canonical terminal: `turn/completed`
- terminal status: `completed | interrupted | failed`
- `turn/completed`의 summary text는 item stream 누락 시 fallback일 뿐 정본이 아니다.

새 thread/resume/generation의 첫 turn은 `model`과 stable `effort`를 반드시 포함한다. app-server가 subsequent-turn override로 적용한 뒤의 일반 turn은 provider 설정을 반복하지 않는 최소 payload를 쓴다.

```json
{
  "id": 11,
  "method": "turn/start",
  "params": {
    "threadId": "<stored-thread-id>",
    "clientUserMessageId": "<Athena-turn-id>",
    "input": [
      { "type": "text", "text": "<turn prompt>" }
    ]
  }
}
```

새 thread/resume/generation의 첫 turn 또는 model/effort를 사용자가 바꾼 뒤의 첫 안전한 turn에서는 아래의 완전한 request를 보낸다. 위의 최소 payload와 아래 payload 조각을 런타임에서 합치는 식으로 구현하지 않는다. contract fixture가 이 전체 shape를 잠근다.

```json
{
  "id": 12,
  "method": "turn/start",
  "params": {
    "threadId": "<stored-thread-id>",
    "clientUserMessageId": "<Athena-turn-id>",
    "input": [
      { "type": "text", "text": "<turn prompt>" }
    ],
    "model": "<selected-model>",
    "effort": "<selected-effort>",
    "cwd": "<absolute-workspace-path>",
    "approvalPolicy": "never",
    "sandboxPolicy": {
      "type": "readOnly",
      "networkAccess": false
    }
  }
}
```

`turn/start`의 sandbox 필드명은 `sandboxPolicy`이며 tagged object다. `sandbox`, `developerInstructions`, `config`, `tools`를 turn payload에 추측해 넣지 않는다.

### 10.5 interrupt

`turn/interrupt({threadId, turnId})`의 빈 response는 요청 접수다. 완료는 `turn/completed.status === 'interrupted'`에서만 확정한다. background terminal이 남을 수 있으므로 process stop 경로에서는 tree 종료까지 확인한다.

### 10.6 overload와 retry

JSON-RPC `-32001 / Server overloaded; retry later.`만 protocol overload retry 대상으로 분류한다.

```text
delay = min(30_000, 250 * 2^attempt) * uniform(0.5, 1.5)
```

- 같은 turn body를 최대 3회 재시도한다.
- `turn/started`를 이미 받은 뒤에는 자동 재시도하지 않는다.
- retry는 conversation FIFO 자리를 유지한다.
- 다른 JSON-RPC 오류를 overload로 재분류하지 않는다.

### 10.7 schema 계약

배포할 Codex binary와 같은 version에서 생성한다.

```powershell
codex app-server generate-ts --out <temp-generated-dir>
codex app-server generate-json-schema --out <temp-generated-dir>
```

- stable schema만 사용한다.
- binary version, schema hash, 확인된 method 목록을 contract report에 저장한다.
- binary가 바뀌면 CI/local contract probe를 다시 실행한다.
- app은 CommonJS JS를 유지한다. generated TypeScript는 contract fixture로 사용하고 runtime은 검증된 stable subset만 매핑한다.
- schema drift가 있으면 app-server를 ready로 publish하지 않는다.

### 10.8 MCP 변경

`config/mcpServer/reload`의 빈 response는 현재 turn 보안 교체 완료가 아니다. 다음 active turn refresh를 예약할 뿐이고 extension profile은 thread start/resume/fork 시점에 고정된다.

v1의 보안 변경은 다음처럼 처리한다.

1. app-server 전체 generation을 fence한다.
2. active turn을 interrupt/drain한다.
3. process tree 종료를 확인한다.
4. registry/consent/secret snapshot을 갱신한다.
5. 새 app-server를 initialize한다.
6. 필요한 conversation thread를 resume하고 새 extension profile을 얻는다.
7. ready를 atomic publish한다.

### 10.9 Codex tool/MCP 격리 gate

사용자의 전역 Codex 설정에 등록된 MCP 서버를 Athena가 그대로 상속하면 Claude와 동일한 tool policy를 보장할 수 없다. Codex adapter는 ready 전에 아래를 증명해야 한다.

1. app-server child는 Athena 전용 `CODEX_HOME`으로 기동한다.
2. 전용 `config.toml`에는 Athena gateway 하나만 등록한다.
3. 인증은 같은 전용 `CODEX_HOME`을 지정한 공식 `codex login` 흐름으로 만들며, 사용자의 global auth 파일을 복사하지 않는다.
4. initialize 뒤 `config/read {cwd, includeLayers: true}`로 effective layer와 provenance를 기록한다.
5. thread start 뒤, 첫 turn 전에 `mcpServerStatus/list {threadId, detail: "full", cursor, limit}`를 끝까지 pagination한다.
6. 반환된 server 이름, tool, resource, resource template, runtime/auth/server info를 Athena snapshot과 정확히 비교한다. generated stable schema에 `pluginId`가 있으면 configured Athena gateway는 `null`/absent여야 하고 예상 밖 plugin source는 실패시킨다. 해당 field가 없는 binary에서 별도 provenance API를 추측하지 않는다.
7. 필요한 gateway의 runtime status가 connected/ready임을 확인한다.
8. thread의 sandbox와 approval policy가 `read-only + never`다.
9. experimental dynamic tools와 extension capability가 꺼져 있다.
10. generated stable schema와 installed binary version이 contract report와 일치한다.
11. generated schema와 live negative probe가 model-visible built-in capability를 열거하고, Bash/shell execution, write/edit, web/network가 정책대로 차단됨을 증명한다.

`threadId` 없는 global MCP status는 증거로 쓰지 않는다. `runtimeStatus: null`은 허용이 아니라 unknown으로 처리한다. `config/read`는 provenance audit이며 MCP exposure의 단독 증거가 아니다. `thread/start.config` 또는 CLI `-c mcp_servers={}`만으로 global MCP를 가렸다고 가정하지 않는다.

`mcpServerStatus/list`는 built-in shell/read/web capability를 증명하지 못한다. `read-only + never`도 built-in tool의 “노출 자체”를 제거했다는 증거가 아니다. 따라서 contract probe는 MCP exact-match와 built-in negative execution test를 별도 결과로 기록한다.

contract probe가 위 항목을 증명하지 못하면 첫 `turn/start` 전에 process를 폐기하고 Codex live provider를 `PROVIDER_NOT_READY`로 fail-closed 비활성화한다. stable API가 동일 built-in 정책을 강제할 수 없다면 “read-only Codex built-ins를 별도 허용할지”를 사용자 보안 결정으로 승격하며, 승인 전에는 default-on gate를 통과할 수 없다. 사용자의 전역 config를 덮어쓰거나 Claude로 조용히 우회하지 않는다. reload, process restart, thread resume 뒤에도 같은 inventory/capability gate를 다시 통과해야 한다.

### 10.10 Athena 전용 Codex runtime home

production runtime home은 `path.join(app.getPath('userData'), 'codex-runtime')` 하나로 고정하고 `codex-runtime-home.js`만 이 경로를 소유한다. 이 모듈은 Electron을 직접 import하지 않고 `resolveCodexRuntimeHome(userDataPath)`와 injectable `createCodexRuntime({runtimeHome,codexExecutable,spawnImpl})`를 제공하며 main이 `app.getPath('userData')`를 주입한다. 반환 instance는 이름과 권한이 다른 두 API만 노출한다.

```js
spawnPrivateHomeCommand(argv, {timeoutMs, stdio})
spawnGenerationAppServer(generationContext)
```

`spawnPrivateHomeCommand()`는 login `['login']`, installed contract가 확인한 logout argv, status `['login','status']`처럼 generation 밖의 짧은 account command 전용이다. 이 helper는 `spawn(resolvedCodexExecutable, argv, {shell:false, windowsHide:true, env:{...process.env, CODEX_HOME:runtimeHome}})`를 사용하고 generation context나 gateway secret/token을 받지 않는다. status stdout/stderr 문구는 account identity로 parse하지 않고 bounded timeout과 exit code만 사용한다.

`spawnGenerationAppServer(generationContext)`만 production `['app-server','--stdio']`를 띄운다. spawn 직전에 `generationContext.spawnContext.assertCurrent()` → `generationEnv = buildEnv('codex')` → `{...generationEnv, CODEX_HOME:runtimeHome}` 생성 → 다시 `assertCurrent()` 순서를 실행하며 `shell:false`, `windowsHide:true`로 spawn한다. 기존 `CODEX_HOME`은 새 값으로 덮고 `HOME`/`USERPROFILE`은 재정의하지 않는다. 직후 `registerChild(child, {provider:'codex', runtimeGeneration, processOwnerId})`를 호출해 awaitable termination handle을 저장하고 env 참조를 폐기한다. registration 실패 시 child tree를 awaited terminate하고 start를 실패시킨다. app-server crash retry는 이 helper를 직접 재호출하지 않고 supervisor rotation으로 fresh generation context를 받는다.

production child, login, logout, account status probe는 같은 runtime-home instance를 쓰지만 두 spawn API를 서로 바꾸어 호출할 수 없다. contract test는 명시적 temp `runtimeHome`을 주입하고, live app-server probe에는 test-owned generation context/registrar를 함께 주입한다. 이 owner와 temp-home fixture는 PR-00에서 먼저 구현하며 Codex GO probe는 두 helper를 우회할 수 없다.

`cli-accounts.js`의 executable API는 다음으로 고정한다.

```js
async function reconcileCodexRuntimeAccount() {} // Promise<CliAccountSnapshot>
async function list() {}                         // Promise<{providers:CliProviderView[]}>
async function getActiveAccount() {}             // Promise<{accountId, providerId}|null>
```

여기서 `CliProviderView`는 기존 `athena:cli-list` 계약 그대로 `{id:string, name:string, connected:boolean, accounts:Array<{id:string, label:string, active:boolean}>}`다. `list()`는 `{providers: CliProviderView[]}`만 반환하고 active-account shape를 반환하지 않는다. `getActiveAccount()`만 `{accountId, providerId} | null`을 반환한다.

`reconcileCodexRuntimeAccount()`는 module-local async mutex 안에서 호출마다 새 `codex login status` process를 시작하고 5초 timeout까지 await한다. stdout/stderr는 버리고 exit `0`은 `connected`, 정상 nonzero exit은 `disconnected`, spawn error/timeout은 `unavailable`로 분류한다. 세 결과 모두 동일 mutex 안에서 `codex:athena-runtime` row, stale Codex rows, `activeId`를 temp-file+fsync+atomic-rename으로 한 번 저장한 뒤 immutable `CliAccountSnapshot {accounts, activeId, codexStatus, reconciledAtMonotonicMs}`를 반환한다. concurrent 호출은 직전 결과를 cache해 공유하지 않고 mutex 획득 뒤 각각 새 probe를 실행한다. `disconnected|unavailable`은 Codex active 선택을 fail-closed 해제한다.

`list()`와 `getActiveAccount()`는 각각 reconciliation을 한 번 await하고, 반환 snapshot에 대한 서로 다른 pure selector만 호출한다. 전자는 기존 provider-grouped IPC view, 후자는 active account identity를 만든다. supervisor는 매 turn마다 이 API를 호출하지 않는다. boot warmup, account/login/logout/focus reconciliation, active-provider 변경 때 `async resolveProviderDesiredState()`가 `getActiveAccount()`를 한 번 await해 새 desired state를 publish하며, `sendTurn()`은 이미 publish된 immutable desired state만 읽는다. 이로써 외부 auth 상태는 명시적 경계에서 fresh이고 user turn hot path에는 status subprocess가 없다.

source-of-truth 경계는 다음과 같다.

1. 인증은 전용 home을 지정한 공식 `codex login`/`codex logout`으로만 변경한다. global `CODEX_HOME`의 auth 파일, token, cookie, config를 복사하거나 symlink하지 않는다.
2. `cli-accounts.js`의 Codex connected/status 판정은 전용 home의 fresh `codex login status` exit code만 조회한다. global Codex가 로그인돼 있어도 Athena runtime을 connected로 표시하지 않는다.
3. 기존 `codex-config.js`는 UI의 desired model/effort 선택값만 읽고 쓴다. runtime은 allowlisted `model`과 `effort` 값만 `thread/start`/`turn/start` parameter로 전달한다.
4. 전용 `config.toml`에는 Athena gateway와 이 문서에서 승인한 최소 runtime 설정만 기록한다. global MCP, profile, plugin, instruction, approval, sandbox 설정은 병합하지 않는다.
5. 전용 home bootstrap은 temp file 작성, fsync, atomic rename을 사용하며 auth material을 log/metric/report에 포함하지 않는다.
6. runtime home schema/version이 맞지 않거나 directory permission이 안전하지 않으면 migration을 추측하지 않고 `PROVIDER_AUTH_REQUIRED` 또는 `PROVIDER_NOT_READY`로 중단한다.
7. 저장된 Codex account row는 표시 alias일 뿐 연결 증거가 아니다. `async list()`와 `async getActiveAccount()`는 위 reconciliation을 await하고 disconnected/stale row를 active 선택에서 제외한다. 현재 active row가 stale이면 같은 atomic save에서 `activeId`를 null로 만들고 action-needed snapshot을 반환한다. global-home account ID를 private-home row로 자동 이전하지 않는다.
8. v1의 private home은 동시에 한 Codex login만 지원한다. 논리 row ID는 고정값 `codex:athena-runtime`, label은 `Codex`이며 auth file/token에서 account ID를 읽어 UI 식별자로 만들지 않는다. login status 성공 시 이 row 하나를 upsert하고 기존 Codex row는 stale로 제거하며, logout/nonzero/status unavailable 시 connected=false와 active 해제를 같은 reconciliation save에 반영한다.

필수 negative test는 global home에 로그인과 임의 MCP/plugin/config를 넣은 상태에서도 전용 home이 비어 있으면 Athena가 disconnected이고, 전용 runtime의 `mcpServerStatus/list`에는 global 항목이 하나도 나타나지 않음을 증명한다. login test는 공식 command가 전용 home만 바꿨고 global auth/config hash가 전후 동일함을 확인한다.

## 11. MCP·권한·secret 보안 계약

### 11.1 보안 snapshot

`McpRuntimeSnapshot`은 다음을 포함한다.

```js
{
  securityGeneration,
  registryRevision,
  consentRevision,
  secretRevision,
  configHash,
  gatewayEpochRevision,
  claudeServers,
  codexConfigRevision,
  allowedTools,
  disallowedTools
}
```

snapshot에는 secret value를 넣지 않는다. secret은 child env를 만들 때 secret store에서 읽고 즉시 지역 변수 수명을 끝낸다.

각 security generation은 cryptographically random `gatewayCapabilityToken`을 갖는다. token 원문은 provider/gateway child env에만 전달하고 snapshot, log, metric, renderer에는 넣지 않는다. app-owned `mcp-security-epoch.json`에는 current token의 hash와 revision을 atomic replace로 기록한다. gateway는 모든 `tools/call` 직전에 epoch 파일을 읽어 자신의 token hash와 constant-time 비교하며, 파일 누락·parse 실패·revision mismatch를 모두 deny한다.

### 11.2 mutation coordinator

`register, approve, revoke, allow, disallow, remove, secret update`는 모두 아래 한 경로를 사용한다.

persistent mode의 coordinator는 PR-00 decision에서 enabled이고 실제로 instantiated된 provider generation만 회전한다. `CLAUDE_ONLY`에서 Codex process를 만들지 않으며, cold mode의 별도 active-child 종료 경계는 `18.1`을 따른다.

```text
acquire mutation mutex
  -> block new provider turns
  -> bump pending security generation
  -> atomically invalidate old gateway capability token/epoch
  -> interrupt active turn
  -> await terminal + drain
  -> fence/stop old provider + gateway process trees
  -> apply persistent registry/consent/secret mutation atomically
  -> migrate plaintext env
  -> reread and validate snapshot
  -> mint new capability token and atomically publish its epoch hash
  -> start new provider generation
  -> verify provider ready + MCP status
  -> publish generation atomically
  -> unblock turns
  -> return success
```

철회 계열에서 새 generation 시작이 실패하면 fail-closed 상태를 유지한다. 이전 generation을 되살리지 않는다.

event generation check만 통과하지 못하게 하는 것은 UI fence일 뿐 tool security fence가 아니다. old child가 종료 신호를 무시해도 token invalidation 뒤의 새 tool call은 gateway dispatch에서 거부되어야 한다. 다만 이미 upstream에 전달된 side effect는 되돌릴 수 없으므로 coordinator는 in-flight call의 terminal/timeout을 기다리고 audit에 남긴다.

old process tree가 `STOP_GRACE_MS` 뒤에도 생존하면 mutation은 `ok:false, fenced:true, runtimeApplied:false`를 반환하고 새 generation을 publish하지 않는다. test는 kill을 무시하는 child가 old token으로 tool call을 시도해 deny되고, mutation success가 반환되지 않음을 증명한다.

mutation IPC 결과는 disk와 runtime 상태를 분리한다.

```js
{
  ok,
  persisted,
  fenced,
  runtimeApplied,
  securityGeneration,
  error: safeMessageOrNull
}
```

`persisted: true, fenced: true, runtimeApplied: false`는 설정은 저장되고 old runtime은 차단됐지만 새 runtime 준비가 실패한 상태다. 이 경우 `ok`는 false이고 UI는 provider action-needed 상태를 표시한다.

### 11.3 stale permission 방지

- `ServerRegistry`와 `ConsentStore`를 provider session 시작 때 한 번 읽고 끝내지 않는다.
- mutation 성공 뒤 반드시 provider/gateway generation을 교체한다.
- old generation의 MCP tool call은 process tree termination과 generation fence로 차단한다.
- gateway capability token/epoch가 old generation의 call을 process 생존 여부와 무관하게 차단한다.
- UI에 revoke/remove success를 먼저 보내고 background restart하지 않는다.
- provider config에는 Athena gateway만 노출한다. 등록된 upstream MCP 서버를 provider에 직접 노출하지 않는다.
- gateway dispatch는 server approved와 tool allowlist를 call 시점에도 fail-closed 확인한다.

### 11.4 secret migration

- `mcpEnv.migratePlaintextEnv()` 완료 전 provider warmup 금지
- sentinel을 resolve하지 못하면 provider ready 금지
- secret value를 log, metrics, snapshot, event, error message에 포함 금지
- child env snapshot 생성 뒤 secret 변경이 오면 hard security rotation

## 12. 동시성, queue, 출력 상한

### 12.1 queue

- conversation별 active turn 1개
- pending replacement 1개
- 새 replacement가 오면 이전 pending replacement는 `SUPERSEDED_BEFORE_START`로 종료
- provider transport write는 adapter 내부 mutex로 직렬화
- Codex request ID는 process generation 안에서 단조 증가
- JSON-RPC response map은 terminal/timeout/process exit에서 반드시 제거

### 12.2 출력 상한

기본 상수:

```js
MAX_JSONL_LINE_BYTES = 1_000_000
MAX_TURN_OUTPUT_BYTES = 5_000_000
MAX_GENERATION_OUTPUT_BYTES = 256_000_000
MAX_STDERR_RING_BYTES = 256_000
TURN_TIMEOUT_MS = 180_000
STARTUP_TIMEOUT_MS = 60_000
INTERRUPT_GRACE_MS = 5_000
STOP_GRACE_MS = 5_000
```

규칙:

- byte count는 UTF-8 `Buffer.byteLength` 기준이다.
- Codex와 legacy Claude CLI는 raw JSONL chunk/line/carry를 센다.
- Claude SDK는 `generationOwnedSpawn`의 counting stdout으로 generation raw bytes를 세고, SDK가 yield한 structured message를 직렬화해 message/turn bytes를 별도로 센다. SDK 내부 JSONL carry를 Athena가 직접 parse했다고 가정하지 않는다.
- idle, busy, terminal-seen, draining 모든 상태에서 generation total을 센다.
- Codex/legacy CLI carry가 line cap을 넘으면 newline을 기다리지 않고 protocol failure로 종료한다.
- turn cap을 넘으면 해당 turn을 실패시키고 runtime을 fence한다.
- generation cap을 넘으면 즉시 event forwarding을 멈추고 bounded-discard 상태로 들어가 active turn을 interrupt한다. grace 안에 terminal이 없으면 runtime을 fence/terminate한다. terminal 뒤까지 무제한 출력을 계속 받지 않는다.
- stderr는 ring buffer만 유지하고 종료 시 safe tail만 진단에 사용한다.

### 12.3 EOF

child `close` 전에 남은 carry를 반드시 한 번 flush한다.

```text
stdout data -> split complete lines + carry
stdout end/child close -> flush carry as final line
parse final result
re-evaluate terminal state
then resolve close outcome
```

개행 없는 valid result + exit 0은 성공이다. parse 불가능한 non-empty carry는 protocol failure다.

이 EOF/carry 계약은 Athena가 raw JSONL을 소유하는 Codex와 legacy Claude CLI에 적용한다. Claude SDK adapter는 structured `result` message를 canonical terminal로 사용하고, iterator 종료/throw 순서를 별도 테스트한다.

### 12.4 process ownership manifest와 leak orchestrator

leak 검증 command는 scenario가 끝난 뒤 별도 조회만 하는 방식이 아니라 scenario를 감싸는 orchestrator다.

```powershell
node app/scripts/check-provider-process-leaks.js --manifest artifacts/provider-sessions/process-manifest.json --grace-ms 5000 -- node app/verify-provider-sessions.js --scenario all
```

orchestrator는 `--` 뒤 argv를 `shell:false`로 실행하며 다음 순서를 소유한다.

1. scenario spawn 전에 OS process baseline을 PID, parent PID, image, creation time으로 캡처한다.
2. unique `runId`와 append-only temp NDJSON 경로를 `ATHENA_PROVIDER_PROCESS_MANIFEST`로 scenario에 전달한다.
3. `ProviderGenerationContext.spawnContext.registerChild()`는 child spawn 직후 아래 `spawn` record를 append+fsync하고, canonical terminal/termination 뒤 `terminal` record를 쓴다.
4. scenario exit 뒤 recorded root와 descendants를 grace 동안 재조회한다. PID와 creation time이 모두 같을 때만 동일 process다.
5. baseline에 이미 있던 process와 PID-reuse process는 제외한다. recorded root가 하나도 없거나 record schema/runId가 다르면 검증 자체를 실패시킨다.
6. 최종 JSON report를 atomic rename하고 survivor tree 또는 scenario nonzero exit가 있으면 nonzero로 종료한다.

NDJSON 최소 schema는 다음과 같다.

```json
{"schemaVersion":1,"type":"spawn","runId":"...","provider":"claude","runtimeGeneration":3,"rootPid":1234,"parentPid":500,"creationTime":"2026-08-30T00:00:00.000Z","image":"claude.exe"}
{"schemaVersion":1,"type":"terminal","runId":"...","provider":"claude","runtimeGeneration":3,"rootPid":1234,"creationTime":"2026-08-30T00:00:00.000Z","outcome":"interrupted","observedAt":"2026-08-30T00:00:01.000Z"}
```

최종 report는 baseline timestamp, scenario argv/exit code, records, 각 grace observation, survivor tree를 포함하되 prompt, secret, cwd 전문은 포함하지 않는다. 사용자가 원래 실행 중인 Claude/Codex process를 이름만으로 종료하거나 실패로 판정하지 않는다.

## 13. 장애, 재시작, circuit breaker

### 13.1 error code

| code | retryable | 의미 |
|---|---|---|
| `PROVIDER_NOT_READY` | 예 | warmup 진행 또는 일시 실패 |
| `PROVIDER_AUTH_FAILED` | 아니오 | 로그인/조직/인증 실패 |
| `PROVIDER_OVERLOADED` | 예 | Codex -32001 또는 공식 rate-limit 신호 |
| `PROVIDER_PROTOCOL_ERROR` | 조건부 | schema/JSONL/순서 위반 |
| `PROVIDER_PROCESS_EXITED` | 예 | 예상치 못한 child 종료 |
| `PROVIDER_OUTPUT_LIMIT` | 아니오 | line/turn output cap |
| `PROVIDER_TURN_TIMEOUT` | 예 | 180초 상한 |
| `PROVIDER_INTERRUPTED` | 아니오 | 사용자/새 질의 중단 |
| `PROVIDER_ROTATION_FAILED` | 조건부 | 새 generation 준비 실패 |
| `PROVIDER_PERMISSION_DENIED` | 아니오 | tool policy 차단 |
| `PROVIDER_CONTEXT_LOST` | 아니오 | 마지막 성공 checkpoint로 안전하게 복구하지 못함 |
| `PROVIDER_CHECKPOINT_UNAVAILABLE` | 아니오 | Claude 성공 turn의 assistant UUID가 bounded transcript persistence barrier 안에 durable해지지 않음 |

### 13.2 restart policy

```text
base = 250ms
factor = 2
cap = 30s
jitter = uniform(0.5, 1.5)
window = 60s
max attempts in window = 5
circuit open = 60s
healthy reset = ready 상태 120s 유지
```

- desired state는 retry timer보다 먼저 저장한다.
- timer callback은 가장 최신 desired state만 사용한다.
- synchronous spawn failure도 attempt를 소비하고 다음 backoff를 예약한다.
- stop/rotate 시 이전 timer를 취소한다.
- circuit open 중 첫 turn은 safe error와 수동 retry action을 받는다.
- 인증·permission·invalid config는 자동 재시작하지 않는다.

## 14. 관측성과 벤치마크

### 14.1 metrics

timestamp는 다음 지점에서 찍는다.

| 표식 | 위치 |
|---|---|
| `r0` | renderer가 `clientSubmitId`를 만들고 pending map에 `rendererSubmittedAt`을 넣은 뒤 live-query IPC를 보내기 직전 |
| `m0` | main IPC handler 진입 |
| `m1` | supervisor queue enqueue |
| `m2` | adapter가 SDK queue 또는 Codex stdin에 input을 기록한 직후 |
| `m3` | 첫 provider text/tool event를 parse한 직후 |
| `m4` | normalized event를 renderer IPC로 보낸 직후 |
| `r1` | renderer가 첫 event를 받은 시점 |
| `r2` | DOM 반영 후 두 번째 `requestAnimationFrame` callback |

renderer는 `clientSubmitId`로 `r0`를 먼저 저장하고, main은 IPC handler에서 이를 검증해 새 supervisor `turnId`에 bind한다. main→renderer event가 `{clientSubmitId,turnId,sequence}`를 되돌려주면 renderer가 pending record를 authoritative turn과 결합한다. 따라서 모든 표식은 최종적으로 `clientSubmitId + turnId + firstVisibleEventSequence`로 상관한다. renderer end-to-end는 ACK에 함께 든 같은 renderer clock의 `rendererPaintedAt-rendererSubmittedAt`, renderer paint는 `rendererPaintedAt-rendererReceivedAt`, main 내부 구간은 같은 main monotonic clock으로 계산한다. renderer와 main의 서로 다른 `performance.now()` 값을 직접 빼지 않는다. provider TTFT는 `m3-m2`, `main_ipc_to_provider_write_ms`는 `m2-m0`, event dispatch overhead는 `m4-m3`다.

첫 paint ACK 계약은 다음으로 고정한다.

1. renderer submit payload와 main→renderer의 첫 visible normalized event에는 같은 `clientSubmitId`가 있고, event에는 `{clientSubmitId, turnId, sequence}`를 넣는다. `dispatchedAtMain`은 main 내부 sample에만 저장하고 renderer 계산에 보내거나 사용하지 않는다. unknown/duplicate `clientSubmitId`는 submit/ACK를 fail-closed 거절한다.
2. renderer event handler는 진입 즉시 `rendererReceivedAt = performance.now()`를 찍는다. `6.3`의 module이 해당 turn에서 처음 실제로 보이는 DOM을 삽입·변경한 직후 이 값과 `clientSubmitId`를 포함해 `app/provider-first-paint.js`의 shared singleton에 claim한다. shell text/tool은 `chat.js`, shell Canvas card는 `canvas.js`, orb-origin text/tool/card는 `orb.js`가 후보를 제출하지만 singleton의 turn-keyed compare-and-set만 최종 owner/sequence를 정한다. 빈 delta, hidden element, loading placeholder, aria-only 변화는 후보가 아니다.
3. claim 전에는 어느 module도 frame callback을 예약하지 않는다. singleton이 최초 claim token에 대해서만 `requestAnimationFrame`을 두 번 기다린 다음 preload의 `ackProviderFirstPaint({clientSubmitId, turnId, sequence, rendererSubmittedAt, rendererReceivedAt, rendererPaintedAt})`를 정확히 한 번 호출한다.
4. preload는 renderer→main `athena:provider-paint-ack`만 노출하고 key/type/finite-number validation을 적용한다. 다른 channel이나 임의 payload 전송 API를 만들지 않는다.
5. main은 payload가 아니라 IPC event sender의 `webContents.id`로 renderer identity를 정하고, active turn의 `clientSubmitId`, turnId, sequence, origin, expected renderer가 모두 일치하는 최초 ACK만 수락한다. duplicate, stale generation, unknown submit/turn, non-owner renderer ACK는 counter에만 남긴 뒤 버린다.
6. benchmark/E2E는 ACK timeout을 명시하고 timeout, visible mutation 없는 success, duplicate ACK, shell `chat.js`/`canvas.js` 이중 claim에서 ACK가 둘 이상인 경우를 실패로 판정한다. interrupted/failed이며 visible content가 전혀 없었던 turn만 paint sample 제외가 허용된다.

한 turn의 correlated sample record에 이 값들을 함께 저장한 뒤 각 field의 percentile을 계산한다. text보다 tool/Canvas가 먼저 보이면 그 첫 visible event를 paint 대상으로 삼는다. visible content 전에 interrupted/failed된 turn은 paint percentile에서 제외하되 별도 outcome counter에는 포함한다. shell-origin은 visible shell owner, orb-origin은 visible orb owner의 ACK 하나를 정본으로 사용한다. 각 component gate와 end-to-end gate는 독립적으로 모두 통과해야 하며 component p95를 더해 end-to-end p95를 계산하지 않는다.

필수 counter:

- `provider_process_spawn_total{provider}`
- `provider_process_exit_total{provider,reason}`
- `provider_respawn_total{provider}`
- `provider_turn_total{provider,outcome}`
- `provider_interrupt_total{provider,outcome}`
- `provider_rotation_total{reason,outcome}`
- `stale_event_dropped_total{provider}`
- `output_limit_total{scope}`
- `mcp_generation_total{outcome}`
- `fallback_turn_total{reason}`

필수 timing:

- `cold_start_to_ready_ms`
- `main_ipc_to_provider_write_ms`
- `warm_submit_to_first_text_ms`
- `warm_submit_to_first_tool_ms`
- `provider_event_to_main_dispatch_ms`
- `renderer_event_to_first_paint_ms`
- `renderer_submit_to_first_paint_ms`
- `total_turn_ms`
- `interrupt_to_terminal_ms`
- `rotation_to_ready_ms`

prompt, response body, tool input, secret, full cwd는 metric label에 넣지 않는다.

### 14.2 benchmark output

`app/scripts/benchmark-provider-sessions.js`는 JSON report를 만든다.

이 스크립트는 두 lane을 같은 process에서 번갈아 실행한다.

- `native`: official Claude Query 또는 Codex app-server transport를 직접 호출하고 supervisor/IPC/UI를 통과하지 않는다.
- `athena`: supervisor → adapter → event router → benchmark renderer ACK까지 통과한다.

두 lane이 같은 prompt corpus, provider cursor policy, model, effort, cwd, MCP snapshot을 쓰지 않으면 즉시 실패한다.

```json
{
  "provider": "claude",
  "mode": "warm",
  "samples": 30,
  "successes": 30,
  "failures": 0,
  "processSpawns": 1,
  "gatewaySpawns": 1,
  "firstTextMs": {
    "p50": 0,
    "p95": 0,
    "max": 0
  },
  "localOverheadMs": {
    "p50": 0,
    "p95": 0,
    "max": 0
  }
}
```

평균만 출력하지 않는다. sample 30 미만, success 100% 미만, spawn invariant 위반, percentile 미기록은 benchmark 실패다.

### 14.3 비교 방법

1. 같은 machine, cwd, provider account, model, effort, MCP snapshot을 사용한다.
2. 동일한 side-effect-free prompt set을 사용한다.
3. native와 Athena 순서를 A/B/B/A로 교차한다.
4. 각 provider cold 5회, warm 30회를 따로 측정한다.
5. native provider time과 Athena local overhead를 분리한다.
6. 원시 sample JSON과 환경 fingerprint를 `artifacts/provider-session-benchmark/`에 저장하되 secret은 제외한다.

## 15. 파일 단위 변경 설계

### 15.1 신규 파일

| 파일 | 책임 |
|---|---|
| `app/lib/main/provider-session-contract.js` | 공통 type, event, error, invariant validation |
| `app/lib/main/provider-session-supervisor.js` | provider 선택, lifecycle, queue, generation, retry |
| `app/lib/main/provider-event-router.js` | stale event fence와 기존 IPC callback adapter |
| `app/lib/main/async-input-queue.js` | Claude streaming input용 bounded async queue |
| `app/lib/main/claude-agent-session.js` | Agent SDK WarmQuery/Query adapter |
| `app/lib/main/codex-jsonl-rpc-client.js` | bounded JSONL parser, request map, EOF flush |
| `app/lib/main/codex-app-server-session.js` | app-server initialize/thread/turn/interrupt adapter |
| `app/lib/main/codex-runtime-home.js` | Athena 전용 CODEX_HOME, config provenance, thread-scoped MCP exposure 검증 |
| `app/lib/main/mcp-runtime-coordinator.js` | security mutation protocol과 snapshot publication |
| `app/lib/main/provider-runtime-metrics.js` | monotonic timings/counters/summary |
| `app/provider-first-paint.js` | shell chat/Canvas와 orb가 공유하는 turn-keyed first-visible atomic claim, double-rAF, 단일 ACK 소유자 |
| `app/scripts/check-claude-agent-sdk-contract.mjs` | pinned SDK API contract probe |
| `app/scripts/check-codex-app-server-contract.js` | installed Codex schema/version probe |
| `app/scripts/benchmark-provider-sessions.js` | deterministic/live latency benchmark |
| `app/scripts/check-provider-process-leaks.js` | scenario 전 baseline을 잡는 orchestrator, NDJSON owner records, PID/creation-time descendant 검증, survivor 시 nonzero exit |
| 각 모듈의 `*.test.js` | unit/contract/fault-injection tests |
| `app/verify-provider-sessions.js` | Electron IPC→origin-owned first paint, abort, shutdown E2E; orchestrator-provided process manifest recorder 사용 |
| `backend/athena_mcp/security_epoch.py` | generation capability token hash를 call 시점에 fail-closed 검증 |

### 15.2 수정 파일

| 파일 | 변경 |
|---|---|
| `app/main.js` | supervisor 생성, boot readiness, live query delegation, abort/shutdown integration |
| `app/lib/main/cli-accounts.js` | async Codex status reconciliation mutex, async `list()`/`getActiveAccount()`, Athena 전용 login/home과 atomic active-provider snapshot 제공 |
| `app/lib/main/model-prefs.js` | Claude desired state source 유지; mutation 뒤 supervisor rotate 호출은 main이 담당 |
| `app/lib/main/codex-config.js` | Codex desired settings 읽기 유지; write 성공 뒤 rotate |
| `app/lib/main/live-prompt.js` | static system append와 per-turn prompt 분리 |
| `app/lib/main/claude-runner.js` | cold fallback 유지, 공통 tool policy/process terminator 재사용 |
| `app/lib/main/proc-utils.js` | 기존 fire-and-forget `killTree` 호환을 유지하면서 awaitable `terminateTree` 추가 |
| `app/lib/main/query-cache.js` | Claude raw event 의존을 normalized provider event로 교체 |
| `app/lib/main/startup-readiness.js` | provider warmup이 MCP env migration 뒤에만 시작되도록 dependency 고정 |
| `app/lib/main/mcp-cli.js` | mutation을 coordinator로 감싸고 disk-only success 노출 제거 |
| `app/lib/main/mcp-env.js` | migration/read ordering을 명시적 async API로 유지 |
| `app/lib/main/mcp-config.js` | immutable generation snapshot 생성 지원 |
| `app/package.json` | test/contract/verify/benchmark scripts와 SDK dependency |
| `app/package-lock.json` | SDK exact version lock |
| `app/preload.js` | provider runtime 상태 IPC와 renderer→main `athena:provider-paint-ack`를 최소 payload로 allowlist에 추가 |
| `app/shell.html` | `provider-first-paint.js`를 `canvas.js`/`chat.js`보다 먼저 로드 |
| `app/orb.html` | `provider-first-paint.js`를 `orb.js`보다 먼저 로드 |
| `app/chat.js` | shell-origin 첫 text/tool DOM 반영 뒤 shared first-paint singleton에 claim 제출; 직접 ACK 금지 |
| `app/canvas.js` | shell-origin success/fallback Canvas card root가 실제 DOM에 연결된 뒤 같은 singleton에 claim 제출; 직접 ACK 금지 |
| `app/orb.js` | orb-origin 첫 text/tool/Canvas card DOM 반영 뒤 singleton에 owner claim 제출; 직접 ACK 금지 |
| `app/lib/settings-cards.js` | active provider/readiness 표시와 “질의 실행은 Claude뿐” 문구 제거 |
| `backend/athena_mcp/runner.py` | refresh된 consent/registry 적용과 종료 경계 |
| `backend/athena_mcp/server.py` | dispatch 시 approval/tool allowlist fail-closed 재확인 |
| `backend/athena_mcp/registry.py` | atomic revision/fingerprint 제공 |
| `backend/athena_mcp/consent.py` | atomic revision/fingerprint 제공 |
| `backend/tests/mcp/*` | stale permission·mutation·disconnect fault tests |

### 15.3 수정 금지 또는 비소유 영역

- `app/lib/main/claude-selector-worker-pool.js`는 계약 테스트 추가 외에 구조 변경하지 않는다.
- Canvas renderer의 시각·의미·카드 선택 로직, semantic workspace, Kiwoom field registry는 이 계획에서 변경하지 않는다. `app/canvas.js`에는 owner-correlated paint ACK 계측만 추가한다.
- user worktree의 기존 수정 파일을 정리·포맷·되돌리지 않는다.
- prototype branch의 `app/main.js`를 통째로 병합하지 않는다.

## 16. 구현 단계

전체 9단계다. PR-00은 `app/test-fixtures/provider-contract/decision.json`에 `GO | CLAUDE_ONLY | NO_GO`, provider version/hash, failed gate를 기록한다. 이후 모든 script는 이 decision을 읽고 임의로 mode를 재판정하지 않는다.

- `GO`: PR-00~08의 Claude와 Codex 항목을 모두 실행한다.
- `CLAUDE_ONLY`: PR-03은 Codex adapter를 구현하지 않고 private-home isolation, disabled selection, no-spawn guard만 잠그는 fail-closed PR로 수행한다. PR-05~08은 Claude 기준으로 완료할 수 있으며 Codex command/sample은 disabled negative probe로 대체한다.
- `NO_GO`: PR-01 이후 구현을 시작하지 않는다. Decision Log 변경과 reviewer 승인 없이 다른 transport로 우회하지 않는다.

PR-02와 `GO`의 PR-03은 PR-01 이후 병렬 가능하다. PR-04는 provider adapter와 병렬로 backend 부분을 진행할 수 있지만 main integration은 decision에서 enabled인 adapter가 끝난 뒤 한다.

```text
PR-00 Baseline + contract lock
  -> PR-01 Supervisor core
       -> PR-02 Claude adapter ----+
       -> PR-03 Codex adapter/guard+-> PR-05 main integration
       -> PR-04 MCP security ------+        -> PR-06 observability
                                                -> PR-07 hardening
                                                    -> PR-08 rollout
```

### PR-00 — 기준선과 외부 계약 잠금

#### Cold-start context

현재 일반 대화는 Claude cold process만 사용하고 Codex live path는 없다. 이 단계는 동작을 바꾸지 않고 기존 계약과 외부 API version을 잠근다.

#### 작업

1. 별도 worktree/branch를 만들고 현재 사용자 변경을 보존한다.
2. 기존 `runClaudeQuery`, `runLiveQueryInner`, abort, history ID, selector pool의 회귀 테스트를 보강한다.
3. 현재 Claude allowed/disallowed tool policy를 별도 pure helper로 추출하되 값은 바꾸지 않는다.
4. Claude SDK exact dependency 승인 여부를 기록한다.
5. 승인 시 `@anthropic-ai/claude-agent-sdk@0.3.251`를 exact pin하고 lockfile을 갱신한다.
6. `codex-runtime-home.js`의 fixed-path owner, common `shell:false` spawn env helper, private temp-home fixture를 production 미결선 상태로 먼저 구현한다. 이후 모든 Codex probe가 이 helper만 사용하게 한다.
7. Claude SDK contract probe와 Codex app-server generated-schema probe를 추가한다.
8. cold/warm benchmark report schema, deterministic fake-provider fixture, process-manifest NDJSON schema와 leak-orchestrator fake fixture를 추가한다.
9. Codex stable schema가 built-in capability 강제 표면을 제공하는지 기록하고, 제공하지 않으면 Codex live default를 fail-closed로 고정한다.
10. Claude probe는 pinned package의 실제 export/type/runtime에서 `startup`, `WarmQuery.query(AsyncIterable)`, `Query.interrupt/close`, resume cursor, `spawnClaudeCodeProcess`, `getSessionMessages`, `forkSession({dir,upToMessageId})`, `SDKAssistantMessage.uuid`, exact `effort` field를 모두 검증하고 version/hash-bound fixture를 저장한다. persistent Query result 직후 transcript가 늦게 보이는 fixture도 포함해 persistence polling 전제를 잠근다.
11. Codex probe는 fixed private temp home에서 initialize, thread start/resume/fork, turn start/interrupt/completed, config read, paginated thread-scoped MCP inventory의 완전한 request/response/notification fixture와 이 문서의 첫-turn 전체 payload를 저장한다.
12. `check-provider-process-leaks.js`를 scenario orchestrator로 만들고 baseline, owned-root record, PID/creation-time descendant, post-grace survivor의 schema와 nonzero-exit fake test를 잠근다.
13. 두 provider probe의 결과를 `GO | CLAUDE_ONLY | NO_GO` 중 하나로 기록한다. `GO`가 아니면 후속 PR이 자동으로 범위를 넓히거나 다른 transport를 추측해서는 안 된다.
14. Claude permission probe는 pre-approved `allowedTools` 항목도 stale generation의 `PreToolUse` hook에서 deny되고, unmatched interactive 항목만 `canUseTool`에 도달하며, `tools`/`disallowedTools`가 model-visible built-in surface를 제한함을 negative fixture로 잠근다.
15. `install-and-legal` report에 패키지 license/provenance, Anthropic Commercial Terms 적용 여부, Athena 배포 형태, 최종 사용자 소유 API key/cloud credential 직접 인증·과금, Claude.ai credential/session token 비수집·비중개, bundled binary 인증 표면 비변조, 개인정보·usage telemetry 고지를 기록한다. 기술 `decision`과 별도로 `productionRolloutAllowed`를 두며, 승인이 없으면 PR-01~PR-07의 default-off 로컬 구현·검증만 가능하고 PR-08 기본 활성화와 production 완료 선언은 차단한다.

#### 검증

```powershell
npm --prefix app test
node app/scripts/check-codex-app-server-contract.js
node app/scripts/check-claude-agent-sdk-contract.mjs
node --test app/lib/main/codex-runtime-home.test.js app/scripts/check-provider-process-leaks.test.js
```

#### 종료 기준

- 기존 app unit tests가 그대로 통과한다.
- 외부 contract report가 package/binary version과 API 필드를 기록한다.
- tool policy 값이 기존 runner와 byte-for-byte 동등하다.
- 아직 production live path 동작은 바뀌지 않는다.
- Codex GO probe가 global home이 아니라 PR-00의 private temp-home helper를 사용하고, global auth/config hash가 전후 동일하다.
- Claude fork fixture가 assistant UUID까지의 transcript만 포함하고 실패 turn sentinel을 제외하며, delayed transcript fixture가 bounded persistence barrier 없이는 실패함을 증명한다.
- fake survivor/clean-exit/PID-reuse fixture에 대해 leak orchestrator exit code가 각각 nonzero/zero/zero다.
- Claude warm API와 Codex security/inventory API가 모두 증명되면 `GO`다.
- Claude만 증명되면 `CLAUDE_ONLY`로 Codex live path를 fail-closed 유지한 채 PR-01/02/04~08의 Claude 범위와 PR-03의 disabled/no-spawn guard를 진행할 수 있다.
- Claude warm API가 증명되지 않으면 `NO_GO`로 중단한다. 공식 CLI의 장기 `stream-json` multi-turn 계약이 별도로 증명된 경우에만 Decision Log와 전체 fixture를 먼저 갱신하고 별도 reviewer 승인을 받아 Claude adapter를 대체할 수 있다. 턴별 cold spawn을 지속 세션 성공으로 간주하지 않는다.
- Codex thread-scoped inventory 또는 built-in capability gate가 증명되지 않으면 Codex live는 명시적 사용자 보안 승인 전 계속 disabled이며, global 설정 상속이나 Claude 우회로 통과시키지 않는다.
- Claude 기술 계약이 통과해도 `install-and-legal.productionRolloutAllowed !== true`이면 persistent feature 기본값은 계속 off이고 PR-08 production rollout을 통과시키지 않는다.

#### 롤백

신규 contract/fixture 파일과 dependency 변경만 되돌리면 된다.

### PR-01 — 공통 supervisor, queue, generation, process fencing

#### Cold-start context

provider adapter 없이 deterministic fake adapter로 lifecycle을 완성한다. 이 단계의 목적은 provider별 코드가 concurrency와 보안 규칙을 우회할 수 없게 만드는 것이다.

#### 작업

1. provider contract, supervisor, event router, metrics, `proc-utils.js`의 awaitable process-tree terminator를 구현한다.
2. single active turn + one pending replacement 정책을 구현한다.
3. canonical terminal + drain barrier를 구현한다.
4. runtime/config/security generation과 stale event drop을 구현한다.
5. desired state 저장 선행, jittered retry, circuit breaker를 구현한다.
6. line/turn/generation output budget utility를 구현한다.
7. fake adapter로 sync spawn failure, crash, late event, interrupt timeout을 재현한다.
8. non-serializable generation-only `ProviderGenerationContext`, turn-only `ProviderTurnContext`, generation-owned spawn env/child registrar를 구현한다. event는 `sendTurn(turn, turnContext)`의 supervisor-stamped `turnContext.emit` 한 경로로만 나가게 한다.
9. adapter `rotate()`를 만들지 않고 supervisor의 `rotate()`가 old stop → fresh generation context → new adapter start/ready/publish 전체를 소유하게 한다.
10. fake adapter가 stale generation/turn/sequence를 위조하거나 두 context를 stringify하려 해도 internal/renderer delivery와 secret exposure가 0건인 negative test를 추가한다.

#### 검증

```powershell
node --test app/lib/main/provider-session-contract.test.js app/lib/main/provider-session-supervisor.test.js app/lib/main/provider-event-router.test.js app/lib/main/proc-utils.test.js
npm --prefix app test
```

#### 종료 기준

- fake-provider 1,000턴 local latency gate 통과
- active turn max 1
- next turn before drain 0건
- stale event delivery 0건
- sync respawn failure 뒤 backoff 지속
- stop 뒤 timer/process handle 0개
- adapter가 임의 correlation/generation을 주입할 수 없고 event sequence는 supervisor만 증가
- generation context/token/secret가 snapshot, JSON stringify, metric, error에 나타나는 경우 0건

#### 롤백

main에 연결하지 않았으므로 신규 모듈만 제거한다.

### PR-02 — Claude Agent SDK 지속 세션

#### Cold-start context

PR-01 contract에 맞춰 Claude wire만 구현한다. 기존 cold runner는 kill switch와 emergency fallback으로 남긴다.

#### 작업

1. CommonJS dynamic import loader와 injectable SDK factory를 구현한다.
2. bounded AsyncInputQueue를 구현한다.
3. `startup() -> WarmQuery.query(queue) -> single output pump`를 구현한다.
4. static system prompt append와 per-turn prompt를 분리한다.
5. current tool policy를 SDK options로 이식한다.
6. init/result session ID, root assistant UUID, partial text, tool, permission, usage, error event를 정규화한다. Claude `turn_started.providerTurnId`는 null로 내고 Athena turn ID를 사용한다.
7. interrupt, close, resume, fallback allowlist를 구현한다.
8. result-then-throw, late delta, structured output cap, desired model/effort 보존을 테스트한다.
9. `start(desired, generationContext)`와 official `spawnClaudeCodeProcess` hook으로 spawn 직전 `assertCurrent/buildEnv('claude')`, generation-owned ChildProcess/PID `registerChild`, counting stdout, Windows hidden process를 구현한다.
10. Claude SDK structured message cap과 legacy cold runner raw JSONL EOF/carry cap을 분리해 테스트한다.
11. success result를 provisional candidate로 보관하고, `getSessionMessages(...{dir})`가 matching root assistant UUID를 durable하게 보여줄 때까지 bounded persistence barrier를 구현한다. persisted message에서 canonical hash를 계산하기 전에는 terminal/drain/history/queue advance가 모두 0이어야 한다.
12. interrupted/failed turn 뒤 현재 Query를 폐기하고 `forkSession(...{dir,upToMessageId})`으로 마지막 성공 assistant boundary까지만 fork한 뒤 remapped UUID/hash를 검증해 resume한다.
13. 첫 turn 실패 시 새 Query를 만들며, delayed transcript, wrong UUID/hash, fork failure, 다음 prompt의 failed-turn text/tool sentinel을 regression test로 추가한다.
14. barrier 성공은 `turn_completed`, timeout/mismatch는 `PROVIDER_CHECKPOINT_UNAVAILABLE`의 `turn_failed`를 terminal arbiter에 제출하고 compare-and-set으로 정확히 하나만 emit한다. provisional success 뒤 iterator throw도 중복 terminal을 만들지 않는 test를 추가한다.
15. immutable tool snapshot과 capability token을 캡처한 generation-scoped `PreToolUse` hook을 구현한다. pre-approved tool을 포함한 모든 호출에서 stale/unknown generation을 fail-closed deny하고, `canUseTool`은 unmatched interactive approval 경로에만 사용한다.
16. `tools`, `allowedTools`, `disallowedTools`, `PreToolUse`, `canUseTool`의 역할을 각각 unit test하고 stale generation callback이 throw하거나 늦게 resolve해도 tool 실행이 0건임을 검증한다.

#### 검증

```powershell
node --test app/lib/main/async-input-queue.test.js app/lib/main/claude-agent-session.test.js
node app/scripts/check-claude-agent-sdk-contract.mjs
npm --prefix app test
```

#### 종료 기준

- 첫 turn 전 warmup 성공
- 한 conversation 100턴에서 Query 생성 1회
- result success는 provisional이며 transcript persistence barrier 성공 뒤에만 `turn_completed` 1회와 checkpoint/history publish
- interrupt terminal 전 next input write 0건
- SDK import/init 실패 외 normal cold fallback 0건
- 현재 tool allow/disallow 회귀 0건
- pre-approved tool의 stale-generation `PreToolUse` deny 누락 0건, generation fence를 `canUseTool`에 의존하는 경로 0건
- Query close 뒤 generation-owned child/descendant 0개
- interrupted/failed turn 뒤 provider binding은 forked/new Query로 교체되고 logical continuation checkpoint는 마지막 성공 경계 그대로이며 fork의 remapped assistant UUID로 재결합
- 다음 성공 turn의 internal event와 final text에 실패 turn sentinel 0건
- transcript durability timeout/mismatch에서 `turn_completed` 0건, `turn_failed(PROVIDER_CHECKPOINT_UNAVAILABLE)` 1건, 다음 turn write 0건

#### 롤백

main 미결선 상태를 유지하거나 `ATHENA_PERSISTENT_CHAT=0`으로 설정한 뒤 앱을 재시작해 cold runner만 사용한다.

### PR-03 — Codex app-server 지속 세션

#### Cold-start context

`GO`에서는 Codex live path를 처음 추가한다. stable stdio JSONL API만 사용하고 installed binary schema를 검증한다. `CLAUDE_ONLY`에서는 live adapter를 만들지 않고 Codex 선택이 fail-closed/no-spawn임을 구현한다.

#### 작업

`GO`와 `CLAUDE_ONLY` 공통으로 `cli-accounts.js`에 5초 bounded private-home status probe를 소유하는 `async reconcileCodexRuntimeAccount()`, 그리고 이를 매번 await하는 `async list()`/`async getActiveAccount()`를 먼저 구현한다. mutex 획득 뒤 호출별 새 probe → single atomic account save → immutable snapshot 순서를 unit test하며 status stdout/stderr는 parse/보존하지 않는다.

`GO`에서만 1~15를 수행한다.

1. bounded JSONL RPC client를 구현한다.
2. initialize/initialized handshake와 readiness를 구현한다.
3. conversation별 thread start/resume map을 구현한다.
4. turn start, item event, completed event를 정규화한다.
5. interrupt ACK와 completed(interrupted)를 구분한다.
6. -32001 backoff와 request map cleanup을 구현한다.
7. EOF carry flush, malformed line, unknown response ID, process exit를 테스트한다.
8. generated stable schema drift probe를 연결한다.
9. PR-00의 고정 runtime home owner를 production child에 연결한다. `start(desired, generationContext)`의 app-server는 generation-only helper로 `assertCurrent/buildEnv('codex')/registerChild`를 강제하고, `cli-accounts.js`의 login/logout/status는 private-home command helper를 사용하되 모두 같은 `CODEX_HOME`을 사용하게 한다.
10. `config/read` provenance audit와 thread-scoped `mcpServerStatus/list` 전체 pagination exact-match gate를 구현한다.
11. `jsonrpc` 필드가 없는 envelope는 통과하고, 해당 필드를 삽입한 fixture는 contract violation으로 실패하는 테스트를 추가한다.
12. shell/write/web built-in negative execution probe를 추가하고, 강제 불가능한 capability를 허용으로 해석하지 않는다.
13. global auth/config/MCP/plugin을 전용 home으로 복사·상속하지 않는 negative test, global login만 있을 때 Athena가 disconnected인 account-status test, private login/logout이 단일 `codex:athena-runtime` row를 upsert/clear하는 test, concurrent reconciliation이 각 mutex 획득 뒤 fresh probe와 atomic save를 수행하는 test를 추가한다.
14. interrupted/failed turn 뒤 마지막 성공 `turnId`까지 stable `thread/fork`하고 old thread를 retire하는 recovery를 구현한다. 성공 turn이 없으면 새 thread를 시작한다.
15. 다음 prompt가 실패 turn의 text/tool sentinel을 관찰하지 못하고, runtime binding `threadId`와 continuation checkpoint `turnId`가 독립적으로 갱신되는 regression test를 추가한다.

`CLAUDE_ONLY`에서는 `codex-app-server-session.js` production 경로를 만들지 않는다. active Codex selection은 `CODEX_LIVE_DISABLED_BY_CONTRACT` action-needed를 반환하고 app-server spawn count 0, private-home status만 fresh 조회, global/saved stale account active 해제만 구현·검증한다.

#### 검증

`GO`:

```powershell
node --test app/lib/main/cli-accounts.test.js app/lib/main/codex-jsonl-rpc-client.test.js app/lib/main/codex-app-server-session.test.js app/lib/main/codex-runtime-home.test.js
node app/scripts/check-codex-app-server-contract.js
npm --prefix app test
```

`CLAUDE_ONLY`:

```powershell
node --test app/lib/main/cli-accounts.test.js app/lib/main/codex-runtime-home.test.js app/lib/main/codex-live-disabled.test.js
node app/scripts/check-codex-app-server-contract.js --expect-decision CLAUDE_ONLY --assert-no-live-spawn
npm --prefix app test
```

#### 종료 기준

- `GO`: connection당 initialize/initialized 각 1회
- `GO`: 2개 conversation에서 app-server process 1개, thread 2개
- `GO`: turn completed 전 queue advance 0건
- `GO`: interrupt ACK만으로 terminal 방출 0건
- `GO`: EOF-tail result 손실 0건
- `GO`: experimental API 사용 0건
- `GO`: 첫 turn 전 thread-scoped MCP exposure와 readiness가 Athena gateway snapshot과 정확히 일치
- 공통: global Codex login/config/MCP가 Athena runtime connected 상태나 effective inventory에 영향을 주는 경우 0건
- 공통: `list()`/`getActiveAccount()` Promise resolve 전에 reconciliation 완료, timeout/spawn error에서 active Codex row fail-closed 해제, status output 저장·노출 0건
- 공통: `athena:cli-list`의 `{providers:[{id,name,connected,accounts:[{id,label,active}]}]}` 구조와 provider 순서는 기존 fixture와 deep-equal이고, reconciled Codex row/status 값 외 structural diff 0건
- `GO`: 실패·중단 뒤 fork/start recovery 전 next input write 0건, 다음 turn의 failed-turn sentinel 0건
- `CLAUDE_ONLY`: Codex 선택 시 action-needed, app-server spawn/import/turn 0건, Claude로 fallback 0건

#### 롤백

Codex live provider 선택을 비활성화하고 설정 기능만 유지한다.

### PR-04 — MCP security generation과 mutation coordinator

#### Cold-start context

현재 registry/consent mutation은 별도 Python process가 disk를 바꾸지만 persistent runtime이 stale snapshot을 계속 쓸 수 있다. 이 단계는 mutation 성공의 의미를 runtime 교체 완료까지 확장한다.

#### 작업

1. registry/consent/secret revision과 snapshot hash를 구현한다.
2. app main의 모든 MCP mutation handler를 coordinator로 직렬화한다.
3. enabled/instantiated provider에 대해 dispatch 차단, interrupt/drain, old process fence, disk mutation, migration, new ready, atomic publish 순서를 구현한다. disabled Codex를 회전 명목으로 spawn하지 않는다.
4. gateway dispatch 시 approved + allowed tool을 fail-closed 재확인한다.
5. revoke/disallow/remove 뒤 stale process가 call을 시도하는 fault test를 추가한다.
6. migration 전 warmup race test를 추가한다.
7. rotation 실패 때 이전 generation 복귀 금지를 테스트한다.
8. `startup-readiness.js`에서 provider warm task가 MCP env migration promise에 명시적으로 의존하게 한다.
9. random gateway capability token/atomic epoch와 per-call fail-closed 검사를 구현한다.
10. 종료를 무시하는 old child의 tool call deny와 mutation non-success를 fault test로 증명한다.

#### 검증

```powershell
uv run --project backend pytest backend/tests/mcp -q
uv run --project backend ruff check backend/athena_mcp backend/tests/mcp
node --test app/lib/main/mcp-runtime-coordinator.test.js app/lib/main/mcp-env.test.js app/lib/main/mcp-cli.test.js
npm --prefix app test
```

#### 종료 기준

- revoke success 뒤 old generation tool call success 0건
- secret migration 완료 전 provider spawn 0건
- mutation 동시 실행 max 1
- 새 generation ready 전 UI success 0건
- rotation failure 시 provider fail-closed
- old process가 생존해도 invalidated token의 tool call 0건, mutation success 0건
- `CLAUDE_ONLY` mutation에서 Codex app-server spawn/rotation wait 0건

#### 롤백

새 grant는 중단할 수 있지만 revoke/remove를 disk-only old semantics로 되돌리지 않는다. 보안 회귀가 있으면 kill switch를 0으로 설정하고 앱을 재시작해 provider live path 전체를 끄고 설정 mutation만 유지한다.

### PR-05 — 최신 main 통합

#### Cold-start context

REST/selector fast path, history, Canvas, abort, shutdown이 이미 `app/main.js`에 결합돼 있다. 이 단계는 해당 순서를 보존하면서 cold Claude 호출 지점만 supervisor로 교체한다.

#### 작업

1. account API의 async 경계를 `app/main.js` 끝까지 전파한다. `broadcastCliChanged()`와 `handleCliList()`를 async로 바꾸어 `await cliAccounts.list()` 결과만 전송/반환하고, `pollCliChangesAfterLogin()`의 baseline·interval callback도 await하되 `pollInFlight` guard로 status probe 중첩을 막는다. `handleCliSetActive()`는 async로 바꾸고 성공 뒤 `await broadcastCliChanged()`하며, shell focus listener와 `handleCliLogin()`의 background polling은 `void promise.catch(reportSafeCliError)`로 rejection을 소비한다. test hook/IPC consumer는 Promise를 await한다.
2. `async resolveProviderDesiredState()`를 추가해 boot warmup과 account/login/logout/focus/active-provider mutation 경계에서 `await cliAccounts.getActiveAccount()`를 정확히 한 번 호출하고 `accountId + providerId`를 immutable desired state에 넣는다. stale Codex active 해제/action-needed를 반영한 뒤 supervisor rotate/publish를 await한다. `sendTurn()` hot path는 account API를 호출하지 않는다.
3. persistent mode에서만 app boot의 secret migration 뒤 supervisor warmup을 연결한다.
4. `runLiveQueryInner()`의 최종 provider 경로를 resolved mode와 PR-00 decision에 따라 `supervisor.sendTurn({clientSubmitId, conversationId, origin, userText})`, legacy Claude cold runner, 또는 explicit Codex-disabled error 중 하나로 교체한다. main caller는 `turnId`/AbortSignal을 만들지 않는다. provider 간 자동 fallback은 없다.
5. event router가 sanitized text/thinking/tool/Canvas renderer event를 기존 preload allowlist에 연결한다. thinking은 기존 `athena:live-thinking-delta` 경계를 router가 소유하며 `app/main.js`에 raw channel literal이나 provider 원문을 추가하지 않는다.
6. `ReplayTurnCapture`와 tool/subagent 진행 추적은 main-internal normalized event만 소비하고 renderer는 `ProviderRendererEvent`만 받게 한다. tool input/result 원문이 renderer IPC에 도달하지 않는 negative test를 추가한다.
7. `abortConversationWork()`를 supervisor interrupt에 연결한다.
8. model/effort, active provider, MCP mutation 뒤 rotation을 연결한다.
9. app shutdown coordinator에 awaited supervisor stop을 연결한다.
10. history conversation ID와 provider cursor 분리를 회귀 테스트한다.
11. preload/settings card에 사람 친화적인 provider readiness 상태를 연결한다.
12. `ATHENA_PERSISTENT_CHAT=0`의 process-start guard를 가장 바깥 bootstrap에 연결한다. 이 mode에서는 supervisor/Claude SDK/Codex adapter import·construction·warmup·persistent child spawn이 모두 0이고 active Claude만 legacy cold runner를 사용한다.
13. `shell.html`에서 `app/provider-first-paint.js`를 `canvas.js`/`chat.js`보다 먼저, `orb.html`에서 `orb.js`보다 먼저 로드한다. submit 직전 renderer가 `clientSubmitId + rendererSubmittedAt` pending record를 만들고 IPC에 ID를 보내며, main은 이를 supervisor turn에 bind해 첫 visible event의 `clientSubmitId + turnId + sequence + origin`으로 되돌린다. event handler가 즉시 찍은 `rendererReceivedAt`과 함께 shell text/tool=`chat.js`, shell Canvas=`canvas.js`, orb-origin text/tool/Canvas=`orb.js`의 실제 DOM mutation 직후 frozen `window.AthenaProviderFirstPaint` singleton에 claim을 제출한다. 세 module의 직접 preload ACK 호출은 금지하고 singleton만 최초 claim 뒤 double-rAF ACK를 낸다.
14. preload ACK validator, main expected-renderer correlation/dedup/stale/non-owner rejection을 구현하고 `chat.js`와 `canvas.js`가 같은 shell turn에 동시에 후보를 내도 atomic claim 1개/ACK 1개임을 테스트한다. 기존 `main-thinking-boundary` 검증을 유지한다.
15. `6.3`의 ReplayTurnCapture, nudge guard, tool-step, subagent exact adapter를 구현하고 description/elapsed fields와 trusted-payload renderer 차단을 회귀 테스트한다.
16. PR-00 leak orchestrator가 이 PR의 Electron scenario를 감싸도록 package script를 연결한다.

#### 검증

```powershell
npm --prefix app test
npm --prefix app run verify:provider-sessions
npm --prefix app run verify
node app/scripts/check-provider-process-leaks.js --manifest artifacts/provider-sessions/pr05-process-manifest.json --grace-ms 5000 -- node app/verify-provider-sessions.js --scenario integration
```

#### 종료 기준

- REST/selector fast path 결과와 호출 순서가 기존과 동일
- `broadcastCliChanged`, login polling, `handleCliList`, `handleCliSetActive`, desired-state construction의 unhandled Promise 0건; user turn hot path의 `codex login status` spawn 0건
- `handleCliList()`와 `athena:cli-changed` payload는 기존 provider-grouped object fixture와 deep-equal이며 reconciled Codex 값 외 shape 변화 0건
- `GO`: Claude와 Codex가 같은 renderer event 계약을 사용
- `CLAUDE_ONLY`: Claude renderer contract 통과, Codex 선택은 no-spawn action-needed, provider fallback 0건
- `ReplayTurnCapture`와 tool/subagent tracker가 같은 internal event 계약을 사용하고 renderer에 trusted payload가 노출되지 않음
- 새 질의/Esc/창 닫기에서 child leak 0건
- 한 turn의 user/assistant history conversation ID 동일
- 기존 Canvas/realtime/boot 검증 회귀 0건
- visible first-event마다 `clientSubmitId + turnId + sequence` shared atomic claim 1개와 same-renderer-clock paint ACK 정확히 1개, stale/duplicate/unknown-submit ACK 수락 0건
- shell Canvas ACK를 `chat.js` 상태 notification으로 대신한 경우 0건; shell/orb owner가 뒤바뀐 ACK 수락 0건
- mode 0에서 supervisor/SDK/app-server import·warmup·persistent process 0건

#### 롤백

`ATHENA_PERSISTENT_CHAT=0`으로 설정하고 앱을 재시작하면 기존 Claude cold path가 동작한다. hot mode 전환은 지원하지 않는다. main 통합 commit을 revert해도 신규 adapter 파일은 비활성 상태로 남을 수 있다.

### PR-06 — metrics와 cold/warm 비교 벤치마크

#### Cold-start context

기능이 동작해도 “빨라졌다”는 평균 한 줄로 증명하지 않는다. deterministic local overhead와 live provider 시간을 분리한다.

#### 작업

1. monotonic span과 counter를 adapter/supervisor/router/renderer에 연결한다.
2. deterministic benchmark 1,000턴을 구현한다.
3. PR-00 decision에서 enabled인 provider별 cold 5회, warm 30회 live benchmark를 구현한다. disabled Codex는 no-spawn/action-needed negative probe만 실행한다.
4. p50/p95/max, failures, spawn counts, generation counts를 JSON으로 출력한다.
5. native baseline runner와 A/B/B/A 교차 실행을 구현한다.
6. sample 부족, failure, spawn invariant, percentile 누락을 exit code 1로 만든다.
7. renderer submit·event receive·double-rAF paint를 같은 renderer clock으로 기록하고, main span과 `clientSubmitId + turnId + sequence` 전체 key로 join하되 서로 다른 clock 값을 빼지 않는다. missing/mismatched `clientSubmitId` sample은 즉시 실패시킨다.
8. visible text/tool/Canvas ACK timeout, duplicate, hidden-only, no-visible-mutation fixture를 Electron verifier에 추가한다.

#### 검증

항상 실행:

```powershell
npm --prefix app run benchmark:provider-sessions -- --provider claude --mode deterministic --samples 1000
npm --prefix app run benchmark:provider-sessions -- --provider claude --mode paired --warm-samples 30 --cold-samples 5
```

`GO`에서만 실행:

```powershell
npm --prefix app run benchmark:provider-sessions -- --provider codex --mode deterministic --samples 1000
npm --prefix app run benchmark:provider-sessions -- --provider codex --mode paired --warm-samples 30 --cold-samples 5
```

`CLAUDE_ONLY`에서 대신 실행:

```powershell
npm --prefix app run benchmark:provider-sessions -- --provider codex --mode assert-disabled --samples 30
```

#### 종료 기준

- `1.3`의 local gate 전부 통과
- enabled provider마다 live report sample 30/30 성공
- enabled provider warmed turn spawn 0
- `CLAUDE_ONLY` Codex probe 30/30 action-needed, app-server spawn 0, Claude fallback 0
- report에 environment fingerprint와 raw samples 존재
- secret/prompt/tool input 미기록
- component gate와 per-turn end-to-end gate를 각각 raw correlated sample에서 계산하고 p95 합산으로 대체한 경우 0건

#### 롤백

metrics/benchmark는 production behavior와 분리되어 있으므로 instrumentation commit만 revert한다.

### PR-07 — fault injection과 장시간 hardening

#### Cold-start context

정상 왕복 외에 이미 확인된 persistent-session 실패 모드를 전부 자동화한다.

#### 작업

1. 500-turn soak test와 foreground `conversations-new` runtime-boundary test를 추가한다. v1에서 지원하지 않는 과거 대화 restore를 성공 조건으로 꾸미지 않는다.
2. 다음 fault를 fake child/SDK로 주입한다.
   - 개행 없는 마지막 result
   - terminal 뒤 late delta
   - interrupt ACK 뒤 늦은 completed
   - stdout line/turn/generation cap
   - synchronous spawn failure 반복
   - crash loop와 circuit breaker
   - model/effort 변경 중 active turn
   - MCP revoke 중 active tool
   - shutdown 중 backoff timer
   - old process가 exit하지 않는 상태
3. PR-00 leak orchestrator를 Windows descendant enumeration과 real Electron scenario로 확장한다.
4. test fixture가 placeholder, only-mode, 비활성 경로를 쓰지 않는지 검사한다.
5. provider spawn마다 root PID, creation time, descendant snapshot, runtime generation을 manifest에 기록한다.
6. enabled provider 각각 completed, interrupted, failed, rotated, app-shutdown 뒤 leak probe를 실행한다. `CLAUDE_ONLY`에서는 Codex disabled/no-spawn scenario를 실행한다.
7. 실패·중단 turn sentinel 격리, Claude durable-assistant-boundary fork, `GO`의 Codex last-success fork/new-thread recovery를 soak 중 반복 검증한다.

#### 검증

```powershell
npm --prefix app test
uv run --project backend pytest backend/tests/mcp -q
node app/scripts/check-provider-process-leaks.js --manifest artifacts/provider-sessions/process-manifest.json --grace-ms 5000 -- node app/verify-provider-sessions.js --scenario hardening
```

leak script의 baseline, NDJSON producer, PID-reuse, descendant, survivor 판정은 `12.4` 계약을 따른다. standalone post-test process 이름 조회로 대체하지 않는다.

#### 종료 기준

- enabled provider별 500-turn soak 성공률 100%
- stale event delivery 0
- permission leak 0
- process/timer/listener leak 0
- circuit breaker 기대 상태 일치
- full app tests와 backend MCP tests 통과
- failed/interrupted sentinel이 다음 turn의 internal event/final text에 나타난 횟수 0
- `CLAUDE_ONLY`에서 Codex process/turn/fallback 0건

#### 롤백

hardening에서 발견된 실패가 unresolved면 rollout을 진행하지 않는다. 기능 플래그 default는 off 상태를 유지한다.

### PR-08 — 점진 rollout과 기본 전환

#### Cold-start context

모든 기능·보안·성능 gate 통과 뒤에만 default를 바꾼다.

#### 작업

1. 개발자 dogfood에서 지속 세션을 켠다.
2. PR-00 decision에서 enabled인 provider별 live account probe를 실행한다. `CLAUDE_ONLY`의 Codex는 disabled/no-spawn probe를 실행한다.
3. 1주 또는 합의된 관찰 기간 동안 crash, fallback, rotation, latency report를 수집한다.
4. gate를 모두 통과하면 `ATHENA_PERSISTENT_CHAT` 기본값을 on으로 전환한다.
5. kill switch와 cold runner를 최소 한 릴리스 유지한다.
6. settings UI에는 provider 상태를 사람 친화적인 ready/reconnecting/action-needed로만 표시한다.

#### 검증

```powershell
npm --prefix app test
npm --prefix app run verify
npm --prefix app run verify:provider-sessions
uv run --project backend pytest backend/tests/mcp -q
```

#### 종료 기준

- `21` Definition of Done 전부 충족
- `GO`: Claude/Codex 각 live warm 30 sample gate 통과
- `CLAUDE_ONLY`: Claude live warm 30 sample gate 통과, Codex disabled probe 30/30과 app-server spawn 0
- cold fallback rate 0% 또는 사유가 명확한 일시적 probe-only 건
- security mutation E2E 통과
- kill switch 실동작 확인

#### 롤백

`ATHENA_PERSISTENT_CHAT=0`으로 설정하고 앱을 재시작해 cold Claude path를 사용한다. mode 0은 supervisor/SDK/app-server를 만들지 않는다. Codex live query는 action-needed로 비활성화되지만 계정·설정 UI는 유지한다.

## 17. 테스트 매트릭스

| 계층 | 필수 시나리오 |
|---|---|
| Pure unit | queue, state transitions, generation compare, sequence, output budgets, backoff, circuit breaker, percentile |
| Adapter contract | Claude init/result/assistant UUID/durable fork/interrupt/close; `GO`의 Codex initialize/thread/turn/interrupt/-32001, `CLAUDE_ONLY`의 Codex disabled/no-spawn |
| Parser fault | chunk split, CRLF, empty lines, malformed JSON, EOF carry, oversized carry, duplicate terminal |
| Concurrency | replacement during write/stream/drain, provider change during turn, model change during turn |
| Security | stale consent snapshot, revoke/disallow/remove, secret migration race, rotation failure fail-closed |
| Process | sync spawn error, early exit, no close event, grace timeout, forced tree kill, old generation late stdout |
| Integration | main IPC, renderer deltas, Canvas tool result, history IDs, busy state, abort |
| E2E | app boot warmup, Claude turn, decision-conditional Codex turn/disabled, foreground new-conversation boundary, settings rotation, quit |
| Performance | deterministic 1,000 turns, live cold 5, live warm 30, native paired comparison |
| Soak | 500 turns, repeated interrupt, repeated foreground new conversation, idle generation rotation |

필수 negative assertions:

- terminal event 2회 방출되지 않는다.
- interrupted/failed turn이 cursor를 갱신하지 않는다.
- interrupted/failed turn 뒤 provider runtime을 마지막 성공 checkpoint로 재구성하고 다음 prompt가 failed-turn sentinel을 관찰하지 않는다.
- old generation event가 renderer/history/Canvas를 호출하지 않는다.
- permission mutation 성공 전에 UI success가 발생하지 않는다.
- normal warm turn에서 spawn이 발생하지 않는다.
- selector worker가 conversational cursor나 MCP config를 받지 않는다.
- global Codex auth/config/MCP/plugin이 Athena 전용 runtime home에 복사·상속되지 않는다.
- renderer에는 sanitized event만 도달하고 trusted tool input/result 원문은 도달하지 않는다.
- visible first-event paint ACK는 turn/sequence당 하나이며 stale/duplicate/non-owner ACK를 수락하지 않는다. shell Canvas는 `canvas.js`, orb-origin은 `orb.js`가 소유한다.
- cold mode에서 supervisor/SDK/app-server import·warmup·persistent spawn·rotation wait가 발생하지 않는다.
- `CLAUDE_ONLY`에서 Codex benchmark/E2E/rollout을 성공처럼 생략하지 않고 disabled/no-spawn probe로 대체한다.

## 18. rollout, feature flag, 운영 상태

### 18.1 feature flag

코드에는 `PERSISTENT_CHAT_DEFAULT` 상수와 env override를 분리한다.

| 단계 | 미설정 | `0` | `1` |
|---|---|---|---|
| PR-05~PR-07 | cold | cold | persistent |
| PR-08 승인 뒤 | persistent | cold | persistent |

provider/contract matrix:

| contract decision | resolved mode | active Claude | active Codex |
|---|---|---|---|
| `GO` | persistent | Claude Agent SDK adapter | Codex app-server adapter |
| `CLAUDE_ONLY` | persistent | Claude Agent SDK adapter | `CODEX_LIVE_DISABLED_BY_CONTRACT`; app-server spawn 0, Claude 우회 0 |
| `GO` 또는 `CLAUDE_ONLY` | cold | 기존 Claude `runClaudeQuery` | `CODEX_LIVE_DISABLED_BY_KILL_SWITCH`; app-server spawn 0, Claude 우회 0 |
| `NO_GO` | any | 구현/rollout 중단 | 구현/rollout 중단 |

flag는 process 시작 때 한 번 읽는다. 환경변수를 바꾼 뒤 완전한 앱 재시작이 rollback 경계다. 한 turn 도중 값을 바꿔 runtime을 반쯤 교체하는 hot transition은 지원하지 않는다.

resolved cold mode는 단순 turn routing이 아니다. bootstrap에서 supervisor와 provider adapter module을 import/construct하지 않고, Claude SDK dynamic import, Codex app-server, warmup, retry timer, persistent child가 모두 0이어야 한다. MCP mutation은 현재 legacy cold turn이 있으면 그 child를 interrupt하고 awaited terminate한 뒤 disk mutation을 적용하지만 supervisor rotation/ready를 기다리지 않는다. cold mode unit test는 module factory 호출, warmup, process spawn, rotation wait가 모두 0임을 증명한다.

### 18.2 사용자 상태

내부 error code, PID, threadId, sessionId, generation, raw provider message를 UI에 노출하지 않는다.

| 내부 상태 | 사용자 표시 |
|---|---|
| starting/backoff | “연결을 준비하는 중입니다.” |
| ready | 별도 기술 문구 없이 정상 입력 가능 |
| auth failed | “계정 연결을 확인해 주세요.” |
| security rotation | “도구 권한 변경을 적용하는 중입니다.” |
| circuit open | “연결을 복구하지 못했습니다. 다시 시도해 주세요.” |

## 19. 금지 패턴

- 턴마다 `spawn('claude', ['-p', ...])` 또는 `spawn('codex', ...)` 호출
- Codex WebSocket transport를 production 경로에 사용
- Codex experimental `thread/queue/*`에 host ordering 의존
- interrupt RPC/SDK method return만으로 turn 완료 처리
- terminal event 직후 parser/output pump drain 없이 다음 input write
- `resultSeen` 또는 idle 상태에서 stdout byte count 중단
- child close 전에 carry를 버림
- warm 호출이 desired model/effort/security snapshot을 저장하지 않음
- 한 번의 synchronous respawn 실패 뒤 retry loop 종료
- old process exit 확인 없이 새 security generation을 publish
- revoke/remove success를 먼저 반환하고 background에서 restart
- provider cursor를 history conversation ID로 사용
- Claude `continue: true`로 대화 resume
- Claude 전체 system prompt string으로 기본 Claude Code safety 교체
- `bypassPermissions` 또는 범위가 더 넓은 tool policy
- Selector worker와 conversational session 공유
- prototype branch의 `app/main.js` 통째 병합
- 평균 latency만 보고하거나 sample 수·failure를 숨김
- fixture test를 live provider/MCP 연결 증거로 표현

## 20. 계획 변경 프로토콜

구현 중 이 문서와 다른 선택이 필요하면 코드보다 문서를 먼저 바꾼다.

1. 변경하려는 결정 ID를 적는다.
2. 새 evidence를 파일·test·공식 문서 링크로 남긴다.
3. 보안, latency, compatibility, rollback 영향을 적는다.
4. 기존 수용 기준이 약해지면 별도 reviewer 승인을 받는다.
5. dependency, external production, destructive operation은 사용자 권한을 다시 확인한다.
6. 아래 기록표에 append한다.

| 날짜 | 결정 ID | 변경 | 근거 | 검토자 |
|---|---|---|---|---|
| 2026-08-30 | 최초안 | 지속 세션 supervisor, Claude Agent SDK, Codex app-server 구조 고정 | current main 조사 + 공식 provider 계약 | architecture/critic/verifier 검토 반영 완료 |
| 2026-08-30 | D-22 | Claude 권한 fence를 `canUseTool`에서 generation-scoped `PreToolUse`로 교정하고 exact `effort` field를 고정 | SDK 0.3.251 type/runtime probe + 공식 permission evaluation order | contract specialist 검토 |
| 2026-08-30 | D-23 | Codex stable resume를 `{threadId}`만으로 고정하고 notification `emittedAtMs`를 진단 전용으로 제한 | Codex CLI 0.147.0 generated stable schema | contract specialist 검토 |
| 2026-08-30 | D-24 | Claude package license·Commercial Terms·최종 사용자 인증 topology를 production rollout 별도 gate로 추가 | SDK 배포 LICENSE + Anthropic legal/auth contract | production 승인 대기 |
| 2026-08-31 | D-25 | active conversation ID와 마지막 성공 binding/checkpoint를 generation start context에 명시 | PR-02 통합 probe에서 rotation resume handoff 누락 발견 | supervisor/adapter 보정 |

## 21. Definition of Done

PR-00 decision이 `GO`면 모든 항목을 적용한다. `CLAUDE_ONLY`면 `[GO]` 항목은 바로 아래의 `[CLAUDE_ONLY]` 대체 증거로만 면제할 수 있다. `NO_GO`는 구현 완료를 선언할 수 없다.

- [ ] Claude normal live turn은 warmed Query를 재사용한다.
- [ ] `[GO]` Codex live turn은 앱당 하나의 app-server와 대화별 thread를 사용한다.
- [ ] `[CLAUDE_ONLY]` active Codex는 action-needed이고 app-server/turn/Claude fallback이 모두 0이다.
- [ ] active CLI provider 전환이 다음 안전한 generation에서 반영된다.
- [ ] model, effort, system prompt, MCP, permission, secret 변경이 generation rotation을 일으킨다.
- [ ] secret migration이 모든 provider spawn보다 먼저 완료된다.
- [ ] interrupt는 canonical terminal과 drain을 기다린다.
- [ ] EOF-tail valid result를 성공으로 처리한다.
- [ ] stale event, stale permission, process overlap fault tests가 통과한다.
- [ ] line/turn/generation output cap이 모든 상태에서 동작한다.
- [ ] retry/backoff/circuit breaker test가 통과한다.
- [ ] Selector pool 격리가 유지된다.
- [ ] history conversation ID와 provider cursor가 분리된다.
- [ ] Claude 성공 checkpoint는 durable assistant UUID/hash 경계이고 failed/interrupted recovery는 그 경계까지 fork한 transcript만 resume한다.
- [ ] ProviderGenerationContext와 secret/token spawn env가 snapshot/log/metric/renderer에 직렬화되지 않고 correlation stamp는 supervisor만 소유한다.
- [ ] app shutdown 뒤 test-owned child process가 남지 않는다.
- [ ] PID/creation-time/descendant manifest 기반 leak script가 completed/interrupted/failed/rotation/shutdown 전부에서 통과한다.
- [ ] `npm --prefix app test`가 통과한다.
- [ ] `npm --prefix app run verify`가 통과한다.
- [ ] `npm --prefix app run verify:provider-sessions`가 통과한다.
- [ ] `uv run --project backend pytest backend/tests/mcp -q`가 통과한다.
- [ ] backend MCP ruff check가 통과한다.
- [ ] deterministic local latency gate가 통과한다.
- [ ] enabled provider 각각 live warm 30-sample gate가 통과한다.
- [ ] `[GO]` Codex effective MCP 집합이 Athena gateway 하나뿐임을 contract probe가 증명한다.
- [ ] `[CLAUDE_ONLY]` Codex 30회 disabled probe에서 app-server spawn 0, action-needed 30, fallback 0이다.
- [ ] global Codex login/config/MCP/plugin이 전용 runtime home의 auth 상태와 effective config에 영향을 주지 않는다.
- [ ] Codex built-in capability 차단이 Claude 정책과 동등함을 stable contract와 negative live probe가 증명하거나, 별도 사용자 승인 전 Codex live가 fail-closed임을 증명한다.
- [ ] Claude pre-approved tool을 포함한 모든 tool call이 generation-scoped `PreToolUse` fence를 통과하고 `canUseTool` 우회 경로가 없음을 negative probe가 증명한다.
- [ ] Anthropic Commercial Terms 적용, 사용자 소유 credential 직접 인증·과금, Claude.ai credential 비중개, bundled binary 인증 표면 비변조, 개인정보·usage telemetry 고지가 승인되어 `productionRolloutAllowed: true`다.
- [ ] kill switch를 0으로 설정해 앱을 재시작하고 active Claude는 cold runner, active Codex는 action-needed disabled가 되며 provider 간 조용한 우회가 없음을 검증했다.
- [ ] failed/interrupted turn 뒤 Claude assistant-boundary fork 또는 `[GO]` Codex fork/new-thread 복구가 완료되기 전 next turn write 0건이고 sentinel leak 0건이다.
- [ ] renderer first-paint ACK의 origin owner, Canvas owner, correlation, validator, dedup, timeout negative test가 통과한다.
- [ ] cold mode 앱 재시작에서 supervisor/SDK/app-server import·warmup·persistent child·rotation wait가 모두 0이다.
- [ ] 변경 파일에서 placeholder·비활성 test·미구현 branch가 발견되지 않는다.
- [ ] 별도 verifier가 diff, tests, benchmark, process leak evidence를 승인했다.

## 22. 구현 인계 체크리스트

구현 작업을 시작하는 agent는 첫 응답에서 다음을 확인한다.

1. cwd와 worktree/branch
2. `git status --short --branch`
3. 기준 main과 이 문서의 drift
4. Claude SDK dependency 승인
5. installed `claude --version`과 `codex --version`
6. official contract probe 실행 가능 여부
7. 현재 사용자 변경과 소유 파일 충돌 여부
8. PR-00부터 시작할지, 이미 충족된 단계가 있는지의 fresh evidence

단계 건너뛰기는 fresh tests와 동일 계약의 구현 증거가 있을 때만 허용한다. prototype 또는 과거 green report만으로 건너뛰지 않는다.

## 23. 공식 참고자료

### OpenAI Codex

- [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#protocol)
- [lifecycle overview](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#lifecycle-overview)
- [thread resume](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#example-resume-a-thread)
- [turn events](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#turn-events)
- [interrupt](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#example-interrupt-an-active-turn)
- [experimental API and schema generation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#experimental-api-opt-in)
- [unsubscribe and lifecycle](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#example-unsubscribe-from-a-loaded-thread)
- [ThreadStartParams stable schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json)
- [TurnStartParams stable schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json)
- [ConfigReadParams stable schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/json/v2/ConfigReadParams.json)
- [MCP server status list contract](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#api-overview)
- [MCP server status stable implementation/type fields](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/mcp_processor.rs)

### Anthropic Claude Agent SDK

- [npm package metadata for pinned 0.3.251](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.251)
- [TypeScript API reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)
- [Session message read, point-in-time fork, and resume cookbook](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)
- [Persistent-query transcript durability lag reproduction](https://github.com/anthropics/claude-agent-sdk-typescript/issues/387)
- [MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [System prompt modification](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [CLI fallback reference](https://code.claude.com/docs/en/cli-usage)

## 24. 완료 증거 보고 형식

최종 구현 보고는 의도나 계획이 아니라 아래 evidence를 채운다.

```markdown
Implementation:
- changed files:
- provider paths enabled:
- feature flag default:

Fresh verification:
- app tests:
- Electron provider-session verify:
- backend MCP tests:
- ruff:
- Claude contract probe:
- Codex contract probe:
- deterministic benchmark:
- Claude live 30:
- Codex live 30:
- process leak probe:
- kill-switch probe:

Known limits:
- external provider/network variability:
- live account or MCP connectivity not tested:
- remaining rollback window:
```
