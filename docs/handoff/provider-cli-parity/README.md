# Claude · Grok · Codex 세션 동등화 인수인계

## 목적과 현재 상태

사용자 요구: "Grok도 예열 풀이 필요함. Codex도 Claude 정도로 승격시켜야 함. 3개 모두 Claude 정도로 구현되어야 함."
구현과 관련 테스트는 완료했고 main에 푸시했다. 남은 일은 실제 앱과 인증된 공급자에서의 검증 및 측정된 결함의 보완이다.
새 작업자는 구현을 다시 만들지 말고 아래 코드와 증거에서 이어간다.

이 브랜치는 공급자 작업 완료 커밋 `d64d124d`를 기준으로 한다. `38b5466b`(구현)와 `d64d124d`(테스트 보완)를 모두 포함한다.
그 시점까지의 main 이력은 포함하지만, 이후 다른 기능의 커밋과 원래 공유 작업 폴더의 미커밋 변경은 포함하지 않았다.
브랜치 목적은 이 대화의 공급자 작업 인수인계이며 저장소 전체 WIP의 이동이 아니다.

처음에는 더 최신인 `6352c851`을 기반으로 검사했으나, 전체 3,915개 테스트 중 다른 기능의 불일치 3건(grok-tool-bridge 모의 require 누락, session-wiring 소스 표식 변경, raw-ui-boundary 계약 불일치)을 확인했다.
해당 기능을 임의로 수정하거나 미커밋 변경을 가져오는 대신, 앞서 전체 pre-push를 통과한 공급자 완료 시점으로 인수인계 기준을 고정했다. 이후 main의 변경을 통합하려면 별도 diff와 검증이 필요하다.

## 다른 PC에서 시작

저장소가 없다면 다음을 실행한다. 기존 저장소가 있으면 새 디렉터리에 clone하거나 깨끗한 worktree를 만들어 같은 원격 브랜치를 체크아웃한다.

```powershell
git clone --branch codex/provider-cli-parity-grok-handoff --single-branch https://github.com/ANNJUNGCHAN/DAOU.Athena.git DAOU.Athena-provider-handoff
Set-Location DAOU.Athena-provider-handoff
git status --short --branch
git log -5 --oneline
npm --prefix app ci
```

Node/npm, Windows용 Electron 및 사용할 공급자의 CLI가 필요하다. 기존 검증은 Windows에서 Node 22.14.0과 실제 native Codex 0.153.4로 수행했다. 설치 버전은 새 환경에서 확인한다. Linux/macOS parity는 증명하지 않았다.

이 디렉터리에서 Grok을 시작한 뒤 `GROK_PROMPT.md` 내용을 첫 메시지로 전달한다. root `GROK.md`도 진입 안내다.
CLI 인증, Athena 계정 설정, MCP 연결, 백엔드와 사용자 데이터는 Git으로 전달되지 않는다. 새 PC의 정상 로그인/설정 흐름으로 준비한다.
기존 Athena 프로세스가 있다면 실행 위치·사용자 데이터 경로를 확인한 후 검증 앱을 시작한다. 공유 작업 중인 앱을 무작정 종료하지 않는다.

```powershell
npm --prefix app start
```

## 구현 구조

선택되어 연결된 공급자의 빈 예비 세션을 2개 유지한다. 공급자 3개를 무조건 6개 프로세스로 동시에 실행하는 구조는 아니다.
새 대화는 예비 세션 하나를 독점하며 풀은 비동기로 보충한다. 사용한 세션을 다른 대화에 돌려주지 않는다.
Claude 요청 분류용 8개 프로세스 풀은 별도이며 대화 풀과 혼동하지 않는다.

| 파일 | 책임 |
| --- | --- |
| `app/lib/main/conversation-session-pool.js` | start/configure/claim/stop/snapshot/drain, 예열 2개, 실패·교체·보충 관리 |
| `app/lib/main/conversation-session-turn.js` | 예열 대기 전 취소 등록, AbortController, 정확한 세션 종료 |
| `app/lib/main/provider-session-shutdown.js` | 중첩 allSettled rejection, ok:false, exited:false를 종료 실패로 전파 |
| `app/lib/main/claude-chat-session.js` | 기존 stream-json 지속 대화 세션; 공통 풀에서 사용 |
| `app/lib/main/grok-acp-session.js` | ACP warm 및 run, 빈 세션 재사용과 모델/계정/보안키 일치 검사 |
| `app/lib/main/codex-chat-runtime.js` | native 실행파일, private CODEX_HOME, Athena-only MCP 구성과 감사 |
| `app/lib/main/codex-chat-session.js` | 빈 thread 예열, 재개, 이벤트 변환, 오류와 상태 전달 |
| `app/lib/main/codex-app-server-session.js` | app-server stdio 통신, thread/turn, 실제 MCP/config 검증 |
| `app/lib/main/conversation-runtimes.js` | 대화별 세션 소유, 정확한 stop, resume 소유권 검사 |
| `app/lib/main/conversations.js` | resumeSessionId와 resumeOwnerKey 저장 |
| `app/main.js` | 공급자 선택, 풀 시작/교체, 실제 Codex 분기, 취소·종료·계정 전환 배선 |

main의 주요 진입점: `prepareLiveChatPool`, `createLiveProviderChatSession`, `runLiveProviderChatTurn`, `liveProviderWarmOptions`, `liveResumeCursor`, `terminateColdLegacyRuntime`, `broadcastCliChanged`, `registerLiveBootRunners`.

resumeOwnerKey는 공급자+계정의 해시다. 모델 변경은 세션 설정을 회전시키되 커서 소유 계정 자체를 바꾸지 않는다.
소유권 없는 과거 커서는 다른 공급자에 넘기지 않고 새 문맥으로 시작한다.
인증 오류는 `CODEX_PRIVATE_AUTH_REQUIRED`, `actionNeeded:true`, `retryable:false`로 드러내고 자동 재시도 폭주를 막는다.

Codex는 `%APPDATA%/athena-shell/codex-runtime`을 기본 private home으로 쓴다(실제 Electron userData로 계산).
전역 ~/.codex 인증·설정을 복사하지 않는다. native 0.153.4의 `app-server --strict-config --listen stdio://` 및 MCP tools 객체 맵/기존 배열을 지원한다.
PowerShell codex.ps1의 버전과 Node/native 실행파일 버전이 달랐으므로 실제 실행 경로를 확인한다.
main의 `GATEWAY_ALLOWED_TOOLS='mcp__athena,Task,Read,Glob'` 문자열은 기존 계약이다. Codex 팩토리가 Athena gateway 정책으로 해석하며 Claude 내장 도구 이름을 Codex 도구로 오인하지 않는다.

`ATHENA_PERSISTENT_CHAT=0`, `ATHENA_GROK_PERSISTENT_CHAT=0`, `ATHENA_CODEX_PERSISTENT_CHAT=0`은 각 경로의 킬 스위치다.
`ATHENA_PROVIDER_RUNTIME=1`의 기존 단일 supervisor와 0.147.0/CLAUDE_ONLY 계약 자료는 별도 실험 경로다. 기본 Codex 대화 경로의 성공 여부와 혼동하거나 옛 자료를 임의로 PASS 처리하지 않는다.

## 검증 이력과 한계

이 기록은 2026-09-09의 이전 실행 결과이며 새 PC의 현재 상태를 뜻하지 않는다.

- 구현 마지막 통합 실행: 관련 15개 테스트 파일 151 passed, 0 failed, 0 skipped. 독립 리뷰 19개 관련 파일, 남은 코드 결함 0건.
- 최종 인수인계 기반 `d64d124d`에서 아래 13개 테스트 파일 재실행: 138 passed, 0 failed, 0 skipped.
- 커밋용 분리 스냅샷: 변경된 테스트 137 passed, main.js 문법 검사 통과.
- 전체 검사 첫 실행: 3,872개 중 3,870개 성공. 계정 전환 테스트의 예열 모의 누락과 별도 그래프 PowerShell timeout 2건 실패.
- `d64d124d`에서 예열 모의와 알림 순서 검증을 보완했다. 해당 테스트와 그래프 테스트 단독 실행 14/14 성공.
- 최종 분리 체크아웃에서 pre-push의 게이트 4종 및 전체 app 단위 검사가 종료 코드 0으로 통과한 뒤 main에 푸시했다. 훅이 상세 출력을 숨기므로 최종 전체 통과 개수는 별도로 기록되지 않았다.

| 공급자 | 실제 관측 | 아직 확인할 것 |
| --- | --- | --- |
| Grok | 예열 2개 15.220초, 서로 다른 PID. 첫 턴 8.209/8.608초, 후속 3.831초. 새 spawn 없이 재사용, OK 응답, 도구 호출 0개 | 실제 앱 화면, 금융 도구 경로 및 지연 분해 |
| Claude | 미리 띄운 두 PID 재사용 | 사용량 소진으로 성공 응답 미확인. 첫 입력 전 ready 신호 없음과 pre-spawn 상태를 구분 |
| Codex | native 0.153.4 initialize/config/read, Athena-only gateway 구성과 제한 기능 확인 | private 로그인 부재로 인증된 thread/MCP inventory/실제 모델 응답 미확인 |

당시 공유 Athena 앱은 재시작하지 않았다. 실제 앱에서 새 main 코드가 적용됐다는 증거는 아직 없다.
원래 `.omc/artifacts`는 Git 제외 경로다. 이동 가능한 요약은 `evidence.json`에 포함했다.
원시 JSON에는 최신 수정 이전의 Codex retryScheduled:true 등 과거 관측이 있으므로 최신 동작으로 해석하지 않는다.
원래 PC의 임시 Codex 폴더 2개 삭제는 자동 정책이 거부했다. 새 PC로 옮길 필요가 없고 인증 파일은 포함하지 않았다.

## 이어서 할 순서와 완료 기준

1. 브랜치·dirty 상태·실행 프로세스·CLI 실제 버전·계정·MCP/백엔드 상태를 확인한다. 코드 탐색만으로 로그인 완료를 가정하지 않는다.
2. 아래 관련 테스트를 실행한다. 실패를 우리 코드 결함, 다른 기능 회귀, 환경/타임아웃으로 구분하고 재현 증거를 남긴다.
3. Grok을 선택한 실제 Athena 앱에서 새 대화 2개, 병렬 요청, 각 후속 요청, 예열 중 취소, 취소 후 재요청, 계정/모델 교체를 검증한다. 계정 교체 테스트는 사용할 계정이 있을 때 수행하고 없으면 그 제한을 기록한다.
4. 요청별로 예열 준비 시간, 큐 대기, 최초 응답까지 시간, 전체 응답 시간, 도구 실행 시간, PID/session 재사용 여부를 구분한다. 간단한 OK 측정만으로 금융 질의 지연 개선을 주장하지 않는다.
5. Claude 사용량과 Codex 전용 로그인이 확보되면 각각 실제 성공 응답과 앱 캔버스/도구 흐름을 확인한다. 인증이 필요하면 사용자에게 한 가지 구체적인 조작을 안내하고 독립적인 검증은 계속한다.
6. 측정된 결함만 최소 변경으로 고치고 회귀 테스트와 독립 리뷰를 수행한다. 인증되지 않은 경로를 우회하거나 금융 데이터/성공 화면을 합성하지 않는다.
7. 세 공급자의 적용된 코드, 실제 성공 응답, 대화 격리, 취소, 종료 후 프로세스 정리, 설정 교체 검증을 각각 증거로 닫는다. 남은 인증 조건이 있다면 전체 완료를 선언하지 않는다.

새 기능 개발이나 주문 실행은 이 인수인계 범위가 아니다. 사용자 최신 지시가 범위를 바꾼 경우 그 지시를 따른다.

## 명령과 실행 주의점

저장소 루트, PowerShell:

```powershell
$providerTests = @(
  'codex-app-server-session', 'codex-chat-runtime', 'codex-chat-session',
  'conversation-runtimes', 'conversation-session-pool', 'conversation-session-turn',
  'conversations', 'grok-acp-session', 'grok-live-wiring',
  'provider-chat-pool-wiring', 'provider-runtime-bootstrap',
  'provider-session-shutdown', 'model-broadcast-order'
) | ForEach-Object { "app/lib/main/$_.test.js" }
node --test $providerTests
node --check app/main.js
git diff --check
npm --prefix app run test:unit
```

실제 인증/CLI 준비 후 실행하는 프로브:

```powershell
node app/scripts/verify-chat-prewarm-live.js
```

이 스크립트는 Claude, Grok, Codex 순서로 모두 검사하며 공급자 선택 플래그는 없다. ready/turn 제한은 각각 90초이고 실제 모델 사용량을 소비한다.
임시 빈 Athena registry로 격리된 무도구 OK 요청을 보내므로 실제 금융 도구 검증은 별도로 해야 한다.
실제 사용자 프로필의 CLI를 사용한다. 결과는 `.omc/artifacts/chat-prewarm-live.json`에 기록되며 일부 공급자가 미준비면 exit 1이 정상적인 실패 보고다.
모든 probe PID 종료를 확인하고, 검증 실패를 단순히 모델 속도 문제로 단정하지 않는다.

커밋 전 변경 소유권을 확인하고 지정 파일/변경 구간만 stage한다. 공유 main에서 전체 `git add .`를 사용하지 않는다.
인수인계 브랜치의 후속 작업은 같은 브랜치로 푸시하되, main 통합은 당시 사용자의 요청 범위에 따라 처리한다.
