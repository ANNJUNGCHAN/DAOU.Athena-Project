# Athena 전체 작업 인수인계 — Grok 재개

이 문서는 2026-09-09 사용자의 “새 브랜치를 만들어 모두 인수인계하고 push, Grok으로 바로 계속” 요청에 따른 현재 진입점이다. 이전 문서의 `main만 받으면 된다`, `커밋하지 않았다`, 금 주문 수량 `개` 등의 시점별 설명보다 이 문서를 우선한다.

## 받는 방법

- 저장소: https://github.com/ANNJUNGCHAN/DAOU.Athena.git
- 인계 브랜치: `codex/grok-handoff-20260909`
- 기준 main: `6352c851550d4bf1a98f98f6c25d130078bd5b59`
- 작업 폴더는 어느 위치여도 된다. 아래 명령은 저장소 루트 기준이다.

```powershell
git clone --branch codex/grok-handoff-20260909 --single-branch https://github.com/ANNJUNGCHAN/DAOU.Athena.git
Set-Location DAOU.Athena
git status --short --branch
git log -10 --oneline
```

이미 체크아웃이 있으면 변경을 먼저 보존하고 `git fetch origin` 후 이 브랜치를 추적한다. 기존 미커밋 파일을 reset/clean으로 삭제하지 않는다. Grok 코딩 도구에서 이 폴더를 열고 [GROK_RESUME_PROMPT.md](./GROK_RESUME_PROMPT.md)를 첫 메시지로 제공한다. Grok 일반 채팅만 사용하는 경우 저장소 파일·터미널·앱 조작 권한이 자동으로 생기지 않는다. 실행 가능한 코딩 환경을 연결해야 검증을 계속할 수 있다. Codex 전용 도구나 이전 대화 접근은 필수가 아니다.

## 목적과 사용자 승인 범위

Athena에서 지원하는 상품 종류별 모의 매수 절차를 QA하고, API 실패·실시간 정책 불일치·카드 미제공·티켓 미표시를 원인별 기록 후 수정·재검증한다. 사용자는 모의 환경이라고 명시했고 로컬 수정, 검증, 이번 전체 브랜치 커밋·푸시를 승인했다. 실계좌 주문, 실서비스 배포, 임의 계좌 권한 확대 승인이 아니다. HTTP 200이나 모델의 완료 문구만으로 주문 접수/체결/화면 표시를 확정하지 않는다.

## 완료된 주문·카드 수정

| 커밋 | 내용 |
|---|---|
| d4bd937a | fix(card): 실데이터 결측 표시와 실시간 연결 판정을 바로잡는다 |
| 9b74a044 | fix(selector): ETF 주문 초안과 ELW 종목 식별을 검증한다 |
| e6d03662 | fix(order): 브로커 응답과 주문 접수 상태를 구분한다 |
| 45823f91 | fix(gold): 금현물 주문 초안을 차단 티켓으로 복구한다 |
| b30e7dae | fix(api): 주문 확인 경계와 도구 실패 원인을 보존한다 |
| ccf09813 | fix(api): ELW 식별과 카드 공개 필드 계약을 완성한다 |
| 6352c851 | test(gold): 금현물 티켓 수량 단위를 g로 검증한다 |

- 주식 티켓은 종목을 `prefill.symbol`에 보관하지만 payload가 최상위 symbol을 읽던 오류를 수정했다.
- ETF 이름/코드 초안, ELW 영숫자 6자리 코드와 공개 API kind 계약을 보완했다.
- 브로커 오류 응답은 실패, 유효 주문번호는 접수, 주문번호 없는 성공형 응답은 `in_doubt`로 구분한다. 결과 불명 요청을 자동 재전송하지 않는다.
- `needs_confirmation`은 정확한 비실행 결과 형상에만 적용한다. persistent/cold 최종 문구와 이력을 교정해 티켓이 없는 상태를 “열었다”고 안내하지 않는다.
- `base:ka10099` 목록은 코드/이름을 우선 표시하고 실제 공란 열은 상세에 보존한다. snapshot 목록에 실시간 연결을 무조건 적용하지 않는다. 금 시세의 전송 메타데이터를 업무 표시 필드로 잘못 투영하던 422를 수정했다.
- 금현물 `1g` 수량, 1kg 상품과 100g 주문 수량 구분, `단가 시장가` 맥락 유지, `티켓이 안보여` 재열기를 수정했다. 유형 미지정/보통/시장가를 구분한다. 금 주문 실행 차단을 우회하지 않는다.

## 마지막 실제 검증과 중복 주문 방지

2026-09-09 기존 사용자 대화에서 `금99.99_1kg 1g 매수 주문 티켓을 열어줘.` → `단가 시장가` → `티켓이 안보여` 흐름을 재현했다. 수정 후 앱을 재시작하고 같은 대화에서 마지막 문구만 입력해 실제 모달 visible=true, 폭640px, 종목 금99.99_1kg, 수량1, 단위g를 확인했다. 시장가 요청·실행 제한 사유와 disabled 구매 버튼이 표시됐다. 이 후속 검증에서는 주문을 전송하지 않았다.

별도 Electron fixture 프로브도 unit=g, executionDisabled=true, 계좌/수량/주문 호출 각0을 확인했다. fixture 스크린샷은 실제 브로커 접수 증거가 아니다.

| 상품 | 이번 세션의 근거와 남은 일 |
|---|---|
| 주식 005930 | 2026-09-09 14:29:53 모의 1주 주문 접수번호를 확인했다. 체결은 미확인. 다시 매수하기 전에 해당 계좌의 주문/체결 내역 조회로 대조한다. |
| ETF 069500 | 15:30:55 1주 시도는 화면에 접수형 결과가 있었으나 주문번호/원시 결과가 불명확하다. 접수 확정이 아니며 자동 재시도 금지. 이후 이름 기반 티켓 표시만 별도 확인했다. |
| 금현물 | 1g 티켓 표시를 확인했다. 금 시장가 매매구분 코드 미확정으로 실행 차단. 접수/체결 없음. 공식 계약과 모의지원 여부를 확인하고 보통 지정가 경로를 별도 검토한다. 빈 단가를 시장가처럼 보내지 않는다. |
| ELW | 종목 식별과 조회는 확인했다. 매수 접수/체결은 미완료. 모의 지원과 주문 가능 조건을 먼저 확인한다. |

원래 대화 DB·계좌 키·토큰·원시 계좌 응답은 전송하지 않는다. 새 PC에는 과거 대화가 없을 수 있으므로 위 세 문장을 새 대화에서 순서대로 입력해 티켓만 재현한다. 원래 기기의 PID/포트/대화 ID는 이식 가능한 상태가 아니다.

## 함께 보존한 다른 작업

이 브랜치는 기준 main 이후 남아 있던 46개 tracked/untracked 작업 파일도 보존한다. 기능별 상세는 다음 문서와 Git diff를 읽는다. 이 묶음은 주문 QA만의 변경으로 축소 설명하지 않는다.

- [실시간 UI 수정](./2026-09-09-realtime-ui-repairs.md): 종목 찾기 필터/클릭, 플러그인 표시, 부엉이 효과, 기법 생성·편집기·백테스트 연결과 대화 복원.
- [기존 작업 통합 기록](./2026-09-09-main-conversation-closure.md): Paper/백테스트 이력, 실제 표시를 기다리지 않던 검증 결함 및 수정. 최종 결과 섹션이 아직 없는 WIP 문서이므로 완료 보고로 읽지 않는다.
- [카드 API 전수 검사](./2026-09-09-card-api-sweep.md): API/카드 커버리지와 후속 검증 계약.

기존 전수 검사의 결측0 주장은 철회됐다. 실제101장 표시 검사에서15장에 결측228개가 관찰됐으며 표본 제한으로210개만 분류 가능했다. 모의 미지원과 미전달 인자, API 응답 공란을 분리한다. 이 수치는 과거 실행 기록이며 새 PC의 현재 성공 증거가 아니다. 원시 captures와 Paper 연결은 로컬 자원으로 다시 생성/연결해야 한다.

공유 파일의 변경을 한 기능만으로 단정하지 않는다. `app/canvas.js`에는 ranking·plugin·backtest, `app/chat.js`에는 plugin·backtest 저장/잠금, `app/shell.html`에는 ranking·기법 UI, `app/lib/main/live-prompt.js`와 테스트에는 주문 비실행 규율·backtest write_file/terminal 변경이 함께 들어 있다.

새 clone에는 기존 문서가 인용한 `app/captures/probe-gold-order-ticket.png`, `app/captures/probe-gold-order-ticket-report.json`, `app/captures/paper-gates/CARD-BUTTONS-ranking-review.json`, `.omc/artifacts/project-ide-overhaul.png`가 포함되지 않는다. `CARD-API-SWEEP.json`도 현재 인계 파일에 없다. 재생성 전에는 이를 수신 환경의 검증 증거로 사용하지 않는다.

## 설치와 실행

Windows PowerShell, Node/npm, Python3.11 이상이 필요하다. 정확한 의존성은 app/package-lock.json과 backend/pyproject.toml을 따른다. 아래 명령은 새 환경에 적용하며 이미 쓰는 venv/설정을 덮어쓰지 않는다.

```powershell
Push-Location app
npm ci
Pop-Location
py -3 -m venv backend/.venv
& ./backend/.venv/Scripts/python.exe -m pip install -e './backend[dev]'
```

backend/.env.example을 읽고 로컬 backend/.env를 구성한다. 모의 키는 해당 환경의 운영자가 별도 제공한다. 저장소에 비밀을 쓰거나 출력하지 않는다. example은 주문 API 비활성, cash scope 예시이므로 gold 권한이나 주문 허용을 자동으로 확장하지 않는다. 키가 없으면 오프라인 검증을 계속하고 실 API 검증은 차단 사유로 기록한다.

```powershell
Push-Location app
npm start
Pop-Location
```

app/lib/main/backend-launcher.js의 자동 백엔드 시작 경로를 먼저 확인한다. 기존8010 서비스가 있다면 해당 체크아웃/설정인지 확인한다. main/backend 코드 변경 후에는 실제 사용 프로세스가 새 소스를 읽도록 재시작한다. scripts/beta/restart-stack.ps1에는 기존 PC 경로/프로세스 전제가 있을 수 있으므로 그대로 실행하지 말고 먼저 읽는다.

## 검증 명령과 기록 규칙

```powershell
Push-Location app
npm run test:unit
node --test lib/main/gold-order-intent.test.js lib/order-ticket.test.js
& ./node_modules/electron/dist/electron.exe ./probe-gold-order-ticket.js
Pop-Location
Push-Location backend
& ./.venv/Scripts/python.exe -m pytest tests/api/test_projects_api.py tests/mcp/test_backtest_tools.py tests/unit/test_projects_store.py -q
Pop-Location
git diff --check
```

프로브 종료 후 app/captures/probe-gold-order-ticket-report.json의 새 timestamp, ok, unit, disabled, 호출 수를 확인한다. 예전 파일을 새 성공으로 읽지 않는다. 카드 전수 검사기는 app/package.json의 verify:card-api-sweep 및 verify:semantic-workspaces를 참조하되 실제 모의 연결/최종 표시 조건을 확보한 뒤 실행한다. 회귀 테스트 통과가 실제 시장/주문 전체 승인은 아니다.

이전 main 푸시에서 pre-push 네 게이트 및 전체 앱 단위 테스트, 기능별 카드159/159·selector62/62·주문15/15·gold53/53·확인경계63/63·공개API80/80을 통과했다. 이번 인수인계 스냅샷의 새 검증은 아래 인계 검증 기록으로 구분한다.

### 인계 스냅샷에서 새로 실행한 검증

- `npm run test:unit`: 3,955/3,955 통과, 실패·skip·todo 0 (약63초).
- 위 백엔드 세 파일: 170 passed, 1 skipped, 1 warning (약36초). skip은 `test_resolve_in_project_rejects_symlink_pointing_outside`로 Windows에서 심볼릭 링크 생성이 허용되지 않아 발생했다. 링크 탈출 검사가 이 환경에서 실행됐다고 주장하지 않는다. 새 환경에서 생성 권한이 있으면 이 테스트를 다시 실행한다.
- 경고는 Starlette TestClient의 httpx 사용에 관한 기존 deprecation이다.
- `git diff --check` 통과. 새 환경의 브로커 연결·키 설정·시장 시간에 따른 결과는 아직 검증하지 않았다.

### 인계 시점의 미실행 UI 검증

이번 스냅샷에서 ranking/plugin/IDE 전체 표면은 새로 검증하지 않았다. 다음은 수신 환경에서 진행할 pending 작업이며 위 단위 테스트 통과로 대체할 수 없다.

```powershell
npm --prefix app run verify:card-buttons
npm --prefix app run verify:semantic-workspaces
npm --prefix app run verify:card-api-sweep
Push-Location app
& ./node_modules/electron/dist/electron.exe ./probe-project-ide-visual.js
Pop-Location
npm --prefix app run verify
```

카드 검사는 실제 백엔드/모의 API 및 화면 표시를 요구하며 오래 걸릴 수 있다. IDE 프로브는 fixture 레이아웃 검증이다. 전체 `verify`는 기존 인계 기록에 4 failure가 있었고 이번에 재실행하지 않았으므로 green으로 판정하지 않는다. 새 로그로 기존 실패 재현/해결 여부를 구분한다.

새 실패는 날짜·앱/백엔드 HEAD·상품/카드/모드·민감정보 제거한 입력·HTTP/브로커 코드·원인·수정 파일·회귀 테스트·실제 재시도 결과를 docs/handoff 아래에 기록한다. API 키/계좌 원문은 커밋하지 않는다.

## Grok의 다음 순서와 완료 조건

1. 현재 브랜치/HEAD와 변경 파일, 실행 서비스, 모의 환경·인증 상태를 확인한다. 앱의 Grok provider 설정 변경은 이번 요청의 필수 작업이 아니다.
2. 금 티켓 세 문장 재현과 비실행 표시를 새 환경에서 확인한다. 금 시장가 지원을 추측해 차단을 제거하지 않는다.
3. 기존 ETF 주문 결과를 조회로 대조하고 상품별 QA 표의 접수/체결/불명/미지원 상태를 갱신한다. 불명 주문은 재전송하지 않는다.
4. 재현되는 실시간 오류와 카드 결측을 하나씩 원인 추적→최소 수정→회귀→실제 UI 확인으로 처리한다. `미제공` 문구만 숨기거나 가짜 값을 넣지 않는다.
5. 백테스트/IDE 및 카드 전수 검증은 보존된 문서의 미완료 항목을 근거로 계속한다. 외부 자원 부재를 성공으로 처리하지 않는다.

완료 판정은 상품별 결과와 남은 외부 제한이 명시되고, 수정 테스트가 통과하며, 실제 화면/응답을 확인한 범위가 기록됐을 때 한다. 접근 권한이 없으면 수정 가능한 로컬 작업을 마친 뒤 필요한 자원만 구체적으로 요청한다. 별도 worktree나 에이전트가 같은 파일을 수정하면 덮어쓰지 않는다.
