# 금현물 차트·HTTP 428 작업 인수인계

작성일: 2026-09-09 (KST). 다음 담당 AI: Grok.
브랜치: `codex/gold-chart-order-handoff-20260909`.
기준 커밋: `6352c851550d4bf1a98f98f6c25d130078bd5b59`.

## 1. 먼저 할 일

구현을 처음부터 다시 하지 않는다. 금현물 차트와 주문 계획 차단 코드는 이미
존재한다. 다음 단계는 **수신 환경에 새 코드를 로드하고 회귀 검사 및 실제 화면
검증을 마무리하는 것**이다. 이전 실행 결과를 수신 환경의 현재 결과로 말하지 않는다.

```powershell
git status --short --branch
git log -8 --oneline
git remote -v
```

`AGENTS.md`를 읽는다. 현재 버전이 참조하는 `RTK.md`는 인계 기준 checkout에
없으므로, 그 파일의 내용을 추측하거나 불필요하게 작업을 중단하지 않는다.
`GROK.md`는 이 인수인계의 진입점이고, 같은 디렉터리의
`GROK_START_PROMPT.md`는 새 Grok 세션에 붙여 넣을 프롬프트다.

## 2. 사용자 요청과 범위

1. 금현물 카드가 목업처럼 멈추고 실제 시세·차트가 갱신되지 않는 문제 수정.
2. 이 대화에서 작업한 변경만 커밋·푸시. 다른 작업의 미완료 수정은 보존.
3. 이후 보고된 `조회 도구가 오류를 반환했습니다 ... (HTTP 428)`의 원인 조사 및 수정.
4. 다른 곳의 Grok이 그대로 이어갈 수 있도록 새 브랜치와 인수인계 자료를 푸시.

원본은 여러 작업이 함께 수정하는 Windows checkout이었다. 인계 브랜치는 기준
커밋에서 별도 worktree로 만들었고, 남아 있던 이 대화 소유의 주문 경계 프롬프트와
테스트만 추가했다. 백테스트·프로젝트 IDE 등 다른 작업의 미커밋 변경을 통째로
포함하지 않았다. 기준 커밋에 이미 통합된 provider·selector·카드·주문 수정은 보존한다.
이 브랜치는 전체 저장소 checkout이므로 개별 커밋을 별도로 cherry-pick할 필요가 없다.

## 3. 금현물 차트: 원인과 구현

보드 `2RJ7-1`의 primary renderer 연결이 빠져 실제 데이터가 있어도 Paper 정적
캔들이 남았다. 데이터가 없거나 마운트가 실패한 경우에도 목업을 유지·복원했다.

- `ka50092` 당일 분봉을 board-hydrate로 읽어 `primary_envelope`로 전달한다.
- main에서 실제 operation/arguments/chart metadata에 맞는 재조회 권한을 등록한다.
- 활성 금현물 카드만 15초마다 읽기 전용으로 조회한다. 선택한 분 간격을 유지한다.
- 차트와 헤더 현재가·시각·전일 대비를 함께 갱신하고, 비활성·제거 카드는 멈춘다.
- 실패 시 정적 캔들을 복원하지 않는다. 오류 상태와 재시도를 제공한다.
- 국제 금 환산 `0I`와 국내 주식 피드가 국내 금현물 가격을 덮어쓰지 못하게 한다.
- Kiwoom 가격의 방향 부호를 가격 크기와 구분하고, 출처 없는 수치는 미제공으로 표시한다.

관련 커밋: `5b5256ac` (`fix(gold): 금현물 차트 실데이터 연결 및 자동 갱신 수정`).
상세 이전 보고서: `docs/handoff/2026-09-09-gold-chart-live-fix.md`.

중요 파일:

| 역할 | 파일 |
|---|---|
| 카드 마운트·15초 조회·현재가 반영 | `app/canvas.js` |
| IPC·재조회 권한 | `app/main.js`, `app/preload.js` |
| hydrate·차트 페이지·reload | `app/lib/main/board-hydrate.js`, `chart-reload.js`, `chart-page.js` |
| 실제 AITS 어댑터 | `app/lib/aits-chart-panel.js` |
| 서버 hydrate | `backend/athena_api/api/canvas_push.py` |
| 금현물 보드 계약 | `backend/ref/card-surface-templates/2RJ7-1/slots.json` |
| 회귀·실제 화면 probe | `app/lib/gold-chart-refresh.test.js`, `app/probe-gold-chart-live.js` |

생성된 `app/lib/board-templates.CC-03.generated.js`와 index도 함께 반영되어 있다.

## 4. HTTP 428: 확인된 원인과 수정

2026-09-09 16:13:14 KST의 오류는 금현물 매수 티켓 대화의 카드 생성 단계였다.
`search → describe → resolve`는 성공했지만 `render_canvas_plan`이 주문 종류의
계획을 `/api/v1/llm/tools/call`에 전달했다. 서버의 `call_order_tr()`는
`X-Athena-Confirm: true`가 없어 upstream 주문 호출 전에 428로 차단했다.
이 실패 요청으로 주문은 실행되지 않았다. 감사 로그는 인자를 저장하지 않으므로
해당 실패 계획의 정확한 `operation_ref`까지 로그만으로 단정하지 않는다.

수정된 흐름:

```text
render_canvas_plan
  -> POST /api/v1/llm/tools/call-query
  -> 서명·계좌 검증 -> 서버 catalog의 document.kind 확인
     order: 409 ORDER_TICKET_REQUIRED (nonce 소비 전, 주문 호출 0회)
     other non-query: QUERY_PLAN_REQUIRED
     query: 기존 조회 실행·변환
```

- 새 경로는 내부용이며 LLM 도구로 직접 노출하지 않는다.
- 데이터 client가 없어도 주문 종류 판별이 먼저 된다. 정상 query에 client가 없으면 503이다.
- 기존 `/tools/call`의 사용자 확인 주문 및 WebSocket 기능은 유지한다.
- MCP는 구조화된 `ORDER_TICKET_REQUIRED`와 정확한 기존 confirm-required 428만
  `needs_confirmation`으로 전달한다. 다른 409/428은 오류를 숨기지 않는다.
- 응답의 `order_ticket_created=false`, `order_submitted=false`를 보존한다.
- 앱 오류 안내는 주문 확인 누락을 일반 조회 오류와 구분한다. 모든 428을 주문으로
  간주하지 않는다. 모델 지시도 티켓 미생성 응답을 성공으로 설명하지 못하게 보강했다.

중요 파일:

| 역할 | 파일 |
|---|---|
| 조회 전용 실행 endpoint | `backend/athena_api/api/llm_tools.py` |
| 서명 검증 후 kind guard, nonce 순서 | `backend/athena_api/selector/service.py` |
| 오류 종류와 HTTP mapping | `backend/athena_api/selector/errors.py`, `backend/athena_api/errors.py` |
| MCP endpoint 및 확인 필요 응답 | `backend/athena_mcp/canvas_data.py` |
| 오류·결과 파싱 | `app/lib/main/tool-failure.js`, `stream-json-parser.js` |
| 대화의 사실 기반 종료 답변 | `app/main.js`의 `needs_confirmation` 처리 |
| 모델 경로 지시 | `app/lib/main/live-prompt.js` |

관련 통합 커밋: `b30e7dae` (API·MCP·UI 확인 경계), `9b74a044`에 포함된 selector/error
수정. 실제 포함 여부는 아래처럼 확인한다. 프롬프트 6줄과 테스트는 이 인계 브랜치의
`f855e42b`에 추가 포함했다.

```powershell
git log --oneline -- backend/athena_api/selector/service.py backend/athena_api/selector/errors.py
git show b30e7dae --stat
```

## 5. 인접 주문 작업의 현재 상태

`45823f91`에 금현물 주문 초안과 보호 티켓 경로가 통합되어 있다. 이 대화가 모든
주문 코드를 새로 만든 것은 아니다. `app/lib/main/gold-order-intent.js`,
`app/lib/order-ticket.js`와 테스트를 먼저 읽고 기존 경로를 재사용한다.
`6352c851`은 금현물 티켓 수량 단위를 **g**로 검증한다. 오래된 대화나 문서의
`개`, 상품명 `1kg`를 주문 수량 단위로 혼동하지 말고 현재 코드·계약을 기준으로 한다.
시장가 지원을 추정하거나 미지정 가격을 시장가로 바꾸지 않는다. 코드가 표시하는
실행 제한을 임의로 풀지 않는다.

## 6. 새 환경 준비와 테스트

개발 환경은 Node.js(이 작업은 Node 22 계열 사용)와 Python 3.11 이상, PowerShell을
전제로 한다. Electron/시세 실사용 검증은 Windows에서 수행했다.

```powershell
git clone --branch codex/gold-chart-order-handoff-20260909 --single-branch https://github.com/ANNJUNGCHAN/DAOU.Athena.git
cd DAOU.Athena
node --version
py -3 --version
npm ci --prefix app
py -3 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -e "./backend[dev]"
pwsh -NoProfile -File scripts/verify-gold-handoff.ps1
```

이미 가상환경이 있다면 다시 만들 필요 없다. 다른 Python 경로는
`-PythonExe <실행파일 경로>`로 지정한다. `-AppOnly`는 앱만 검증하며 서버 통과를 뜻하지 않는다.
이 스크립트는 회귀 테스트만 실행하고 앱·서버를 시작하거나 실제 주문을 보내지 않는다.
전체 앱 검사는 `npm test --prefix app`이다. 푸시 훅이 추가 검사를 실행할 수 있으므로
실패 원인을 확인하고 우회하지 않는다.

인증·계좌·Grok 로그인은 각 수신 환경에서 정상 설정한다. `backend/.env.example`은
설정 구조 참고용이다. 기존 컴퓨터의 `.env`, 토큰, `.athena` 저장소나 사용자 프로필을
Git에 넣지 않았다. 앱 내부 Grok 공급자 설정과 개발용 Grok 세션은 별개다.

## 7. 다음 담당자가 완료할 실행 화면 검증

1. 포트 8010과 Electron/backend 프로세스의 소유를 확인한다. 다른 작업 프로세스를
   일괄 종료하지 않는다. 이미 실행 중인 서버가 새 코드를 로드했다고 가정하지 않는다.
2. 수신자가 소유한 개발 환경에서 앱과 backend/MCP를 새 코드로 시작한다.
   backend 수동 시작은 `backend`에서 `.venv/Scripts/python.exe -m uvicorn
   athena_api.main:app --host 127.0.0.1 --port 8010 --workers 1`, 앱은 `app`에서
   `npm start`이다. 한 backend만 사용하며 기존 launcher와 중복 실행하지 않는다.
   `scripts/beta/restart-stack.ps1`은 Electron을 재시작하는 스크립트이므로 공유 환경에서
   무조건 실행하지 않는다. 이미 떠 있는 backend는 그대로 둘 수도 있어 코드 갱신 증거가 아니다.
3. 읽기 전용 금현물 카드를 열어 실제 캔들·헤더 동기화, 15초 조회, 선택 분 간격 유지,
   비활성 카드 정지, 조회 실패 시 목업 미복원을 확인한다.
4. `app/probe-gold-chart-live.js`는 기존 backend를 읽는 검증용 Electron probe다.
   실행 전 파일을 읽고 현재 환경과 프로필 격리를 확인한다. 기존 검증은 격리 창에서
   수행했으므로 사용자 창에서의 수동 확인도 구분해 기록한다.
5. 주문 초안까지만 확인한다. 의도적으로 실제 주문 계획을 승인해 실행하지 않는다.
   주문 호출 0회·nonce 미소비·기존 확인 경로는 mock API 테스트로 확인한다.
6. Grok 대화에서 티켓이 없는데 열었다고 말하지 않는지 확인한다. 가격·단위를 임의
   추정하지 않는지도 확인한다. 연결이 없으면 연결 실패를 보고하고 완료로 표시하지 않는다.

완료 기준: 최신 코드의 회귀 검사 통과 + 실행 화면에 새 코드가 적용된 증거 + 실제
읽기 전용 차트 검증 + 주문 초안/거절 상태의 사실 기반 안내. 실제 주문 접수는 완료 기준이 아니다.

## 8. 이전 검증 결과와 이식 한계

인계 브랜치에서 새로 실행한 검증(2026-09-09, 코드 커밋 `f855e42b`):

- `scripts/verify-gold-handoff.ps1`: exit 0.
- 앱 회귀 **318 passed**, 백엔드 회귀 **174 passed**.
- Node `v22.14.0`. Python 의존성은 기존 개발 가상환경을 `-PythonExe`로 지정해
  재사용했고, `athena_api.__file__`이 인계 worktree 안의 코드임을 확인했다.
- Starlette/httpx 관련 의존성 deprecation warning 1개. 테스트 실패는 없었다.
- 새 컴퓨터에서 의존성 설치부터 검증한 결과나 실제 화면 검증 결과는 아니다.

아래는 인계 브랜치 작성 이전의 검증 이력이다.

- 차트 수정 당시 Node 관련 237개, backend hydrate/render 116개 통과.
- 2026-09-09 14:42 KST 격리 Electron probe: 실제 캔들 240개, 자동 조회 IPC 1회,
  최신 종가와 헤더 189560 일치, 보이는 목업 0개, 렌더 오류 0개.
  이는 과거 검증 값이며 현재 시세가 아니다.
- HTTP 428 수정 당시 앱 200개, 서버 관련 묶음 165개, 최종 핵심 4개 통과.
  Ruff/구문/diff 검사와 독립 코드 검토 APPROVE. 테스트 수는 당시 checkout 기준이며
  이후 통합된 커밋이나 새 테스트에 따라 달라진다.
- 원본 실행 로그: `%USERPROFILE%/.athena/logs/backend-uvicorn.log`,
  `%USERPROFILE%/.athena/audit/kiwoom-selector.jsonl`; 대화는 Electron 사용자 데이터
  아래 `athena-sessions.sqlite3`. 개인 원시 로그·DB는 브랜치에 포함하지 않는다.
- 원본 차트 capture 경로는 `app/captures/gold-chart-live/`였다. 이 무시된 로컬
  capture는 새 checkout에 자동으로 생기지 않으므로 probe로 새 증거를 만든다.
- 이전 probe 임시 프로필 일부는 Windows 잠금/삭제 정책 때문에 남았으나 Git 인계
  대상이 아니다. 원본 사용자 프로필을 정리 대상으로 오해하지 않는다.
- 인계 작업은 공유 앱·서버를 재시작하지 않았다. 새 환경에서의 현재 실행 성공과
  사용자 화면 적용은 아직 별도 검증해야 한다.

## 9. 진행 보고 형식

다음 담당 AI는 한국어로 현재 HEAD, 변경 파일, 실행한 명령과 통과/실패 결과,
실제 화면 검증 여부, 남은 제한을 짧게 보고한다. 데이터가 없는데 정상 시세나
티켓 생성 성공을 주장하지 않는다. 새 수정은 기능 단위로 분리하고 다른 작업의
dirty 파일을 함께 커밋하지 않는다.
