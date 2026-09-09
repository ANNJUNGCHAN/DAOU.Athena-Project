# Athena 실시간 오류 수정 → Grok 인수인계

작성일: 2026-09-09, Asia/Seoul. 이 문서는 완료된 구현과 남은 오류·검증 공백을 함께 넘긴다.

## 1. 가져오기와 기준

- 원격: https://github.com/ANNJUNGCHAN/DAOU.Athena.git
- 인계 브랜치: `codex/grok-realtime-handoff-20260909`
- 스냅샷의 부모: `6352c851` (`test(gold): 금현물 티켓 수량 단위를 g로 검증한다`). 브랜치의 최종 커밋은 `git rev-parse HEAD`로 확인한다.
- 원본 공유 작업 폴더의 main을 전환하지 않고 별도 worktree에 추적 변경 전체와 미추적 코드/문서 12개를 복사했다. 이미 main에 커밋된 금/주문/진단/카드/공급자 변경도 부모 이력으로 포함된다. 원본의 이후 변경까지 자동 동기화되는 브랜치는 아니다.
- 인계는 사용자가 새 브랜치 생성·전체 변경 보존·push를 명시적으로 요청했다. main 병합, 브랜치 삭제, 실제 주문 실행은 이번 요청이 아니다.

새 컴퓨터의 PowerShell에서:

```powershell
git clone --branch codex/grok-realtime-handoff-20260909 --single-branch https://github.com/ANNJUNGCHAN/DAOU.Athena.git
Set-Location DAOU.Athena
git status --short --branch
git rev-parse HEAD
```

그 폴더를 Grok의 코드 작업 도구에서 열고 `START-HERE.txt` 내용을 입력한다. Grok 웹 채팅만으로는 로컬 저장소·터미널을 직접 조작할 수 없으므로 파일/터미널 작업 기능이 있는 환경을 사용해야 한다. 이 인계는 특정 CLI 옵션이나 자동 컨텍스트 로딩을 가정하지 않는다.

## 2. 사용자 요구: 그대로 유지할 것

1. 이 작업은 실시간 오류방이다. 사용자가 오류를 주면 즉시 조사·수정·검증하고 기존 미완료 작업을 잊지 않는다.
2. 종목 찾기: 거래대금 정렬, 모든 필터 전환, 시간외 단일가→정규장 복귀와 클릭 영역을 정상화한다.
3. 플러그인: 강조된 설명 문구, 설치됨 제목, 추천 목록 및 추천 설치 기능 삭제. 사용자가 직접 서버를 추가/설치한다. 기존 설치 항목 관리·권한은 유지한다.
4. 기법: 샘플 10개를 기본 기법처럼 나열하지 않는다. 실제 사용자 기법을 표시한다.
5. 새 기법: 팝업에서 부모 폴더와 기법명을 사용자에게 받는다. 프로젝트 내부에 새 하위 폴더를 만든 뒤 목록에 등록하고 새 대화에서 연다. 프로젝트 밖 경로는 거절한다.
6. 코드 작업공간: 폴더의 모든 파일을 탐색하고 텍스트를 편집한다. 자동 환경 준비, 실제 터미널 결과, 우측 채팅의 코드·터미널 제어를 연결한다. AI 제어 띠/직접 편집 모드, 수동 환경·패키지 영역, 별도 승인·반복 안내 footer는 삭제한다.
7. 부엉이: 채팅 하단에서 커졌다 작아졌다 하는 효과를 제거한다.
8. 금 시세: 실패 원인을 조사하고 고정 gateway/upstream 오류 문구로 원인을 오인하지 않는다.
9. 주문 팝업: 상품·수량을 이미 답했는데도 계속 안 열리는 문제를 해결한다. 팝업 표시와 주문 실행은 별개다.

## 3. 구현되어 있는 것과 코드 지도

| 영역 | 주요 파일 | 구현 상태 |
|---|---|---|
| 종목 찾기 | app/lib/ranking-board-controls.js, app/canvas.js, app/lib/board-mount.js | 정렬/필터/보드 복귀/클릭 owner/하이드레이션 재연결, 보드별 유동성 포함 인자 해석 |
| 플러그인 | app/lib/plugin-canvas.js, app/canvas.js | 추천 UI·설치 경로 제거, 직접 서버 추가/기존 권한 관리 유지 |
| 기법 생성/목록 | app/lib/technique-create-dialog.js, app/lib/backtest-canvas.js | 사용자 경로/이름 → 폴더 생성 → 등록 → 새 대화 → 편집기. 단계 실패 시 중복 생성 없이 재시도 |
| 파일/터미널 | app/lib/project-ide.js, backend/athena_api/api/projects.py, backend/athena_api/projects/store.py | 전체 트리, 텍스트/바이너리 구분, 여러 탭, 자동저장, 실제 argv 터미널, 경로 검증 |
| 채팅 파일 쓰기 | backend/athena_mcp/backtest_tools.py, app/lib/main/backtest-file-written.js, app/lib/main/live-prompt.js | action=write_file, write_file:{project_id,path,root_path,source}. 실제 PUT 완료 후 성공; 일치하는 영수증만 편집기에 반영 |
| Electron 연결 | app/main.js, app/preload.js, app/canvas.js, app/chat.js, app/lib/sidebar.js | 생성/폴더 선택/새 대화/터미널 IPC, 채팅 전 dirty flush, AI 턴 동안 코드·수동 터미널 잠금 |
| 대화 복원 | app/lib/session-restore.js, app/lib/backtest-canvas.js | project/root/path/name/draft/userStrategyId 봉인. 등록부 id/project/path 일치 시 등록 기법 복원 |
| 금 주문 초안 | app/lib/main/gold-order-intent.js, app/lib/order-ticket.js, app/main.js, app/chat.js | 대화별 수집/완성/재열기. 시세/계좌 조회를 기다리지 않고 제한 사유가 있는 티켓 표시 |
| 금 시세 질문 | app/lib/main/gold-quote-intent.js | 일반 금 시세는 1kg/미니금 선택 질문; 선택 후 상품 코드 질의로 진행 |
| 금 표시 오류 | backend/athena_api/api/canvas_push.py | ka50100 return_code/return_msg 등 제외 메타를 사용자 표시 투영에서 제거; 업무 필드 라벨 검증 유지 |
| 진단/부엉이 | app/lib/main/tool-failure.js, app/lib/main/stream-json-parser.js, app/chat.css | 원인별 안전한 진단·fingerprint, 크기 애니메이션 제거 |

주요 API: POST `/api/v1/projects/{id}/techniques` (`parent`, `name`); GET tree의 `path`는 프로젝트 상대 기법 루트; PUT file은 선택적 `root_path` 실경로 검사; POST terminal은 `cwd`, `argv`를 받는다. 트리의 각 파일 경로는 **전체 프로젝트 상대 경로**다. 터미널 cwd 검증은 OS 샌드박스가 아니다.

기법 편집 중 `write_file`은 `propose_file`과 다르다. 전자는 동기 디스크 저장이고 후자는 일반 프로젝트의 적용 대기 diff다. tool payload 키도 `file`이 아니라 `write_file`이다. 저장 실패를 성공으로 표시하거나 AI 완료 이벤트로 다시 PUT하지 않는다.

## 4. 이어서 할 일과 완료 기준

### P0 — 금 수량 단위 불일치: 이번 작업에서 수정

`app/lib/main/gold-order-intent.js`는 이제 명시 `g`/`그램`만 `ord_qty`로 넣는다. `1개`/`1주`/`2개`/`4개`는 그램으로 바꾸지 않고 수집을 유지한 채 `주문 수량을 g 단위로 알려 주세요`를 다시 묻는다. `금 99.99_1kg` / `미니금 99.99_100g` 상품명의 `1kg`/`100g`는 주문 수량이 아니다. 개→g·주→g 환산표는 없다. 완성 초안의 `execution_supported`는 계속 `false`이고 차단 사유가 있다. 실제 금 주문 실행은 하지 않는다.

### P1 — 새 컴퓨터/사용자 앱에서 실행 검증

기존 사용자 Electron 프로세스는 이 작업에서 재시작하지 않았다. 새로운 소스를 읽는 앱을 실행하여 아래 경로를 직접 확인한다. 다른 프로젝트가 사용하는 8010 서비스나 다른 Electron 프로세스를 무조건 종료하지 않는다.

- 종목 찾기 정렬·시장/등락/유동성·시간외 왕복, 갱신 후 재클릭.
- 시가총액은 API가 조건/값을 제공하지 않아 현재 제한 사유가 표시된다. 미지원 필터를 작동한다고 보고하지 않는다. 지원을 추가하려면 실제 데이터 계약부터 확인한다.
- 새 기법 취소/중복 이름/루트 밖 경로/심볼릭 링크/환경 실패/등록 실패/대화 실패.
- 생성된 기법과 기존 등록 기법 각각 A→B→A 복원; 저장 오류 시 이동 중단; 여러 탭 자동저장; AI 작업 중 수동 입력 잠금 및 종료 후 해제.
- `금현물 시세 알려줘` → 상품 선택 → 실제 카드. 명시 1kg 질의는 앞서 실행 중 서비스에서 HTTP 200 rendered로 검증했다.
- 금 주문 수집 → 팝업 → 닫기 → '주문 화면이 안열려'로 재열기. 금 실행은 제한 사유를 표시한다. 실제 주문을 보내지 않는다.

### P2 — 관측 결과와 문서 갱신

새 환경에서 확인한 소스 HEAD, 명령, 테스트 결과, 캡처, 남은 제약을 이 문서에 갱신한다. 과거 3,948개 통과나 HTTP 200을 새 컴퓨터의 라이브 검증으로 재사용하지 않는다. `docs/handoff/2026-09-09-card-api-sweep.md`, `2026-09-09-main-conversation-closure.md`에는 같은 스냅샷에 포함된 다른 작업의 맥락이 있다. 그 내용을 이번 작업의 독립 검증 완료로 간주하지 않는다.

## 5. 새 환경 준비와 실행

Windows PowerShell 기준. Node/npm과 Python 3.11 이상이 필요하다. Python 3.12 환경을 사용하던 저장소이며 의존성 기준은 package-lock.json과 backend/pyproject.toml/uv.lock이다.

```powershell
Set-Location app
npm.cmd ci
Set-Location ../backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[dev]'
Set-Location ..
```

backend/.env.example을 읽어 필요한 로컬 설정을 준비한다. 실제 키·토큰·계좌를 문서에 넣지 않는다. 원본의 `.env`, `.venv`, node_modules, `%APPDATA%/athena-shell` DB/프로필, Grok 로그인 정보는 Git에 포함하지 않았다. 기존 대화·기법 데이터 복제가 아니라 **개발 작업 인계**다. 라이브 인증이 없으면 결정론 테스트까지만 완료로 보고한다.

앱은 `app/lib/main/mcp-config.js`에서 저장소 기준 `backend/.venv/Scripts/python.exe`를 찾고 8010 백엔드를 확인/시작한다. 오래된 `scripts/beta/restart-stack.ps1`에는 원본 절대 경로가 있으므로 새 컴퓨터에서 그대로 실행하지 않는다.

```powershell
Set-Location app
npm.cmd start
```

Grok 로그인과 모델 선택은 새 환경에서 앱의 실제 공급자 설정 경로를 사용한다. 이번 인계의 Grok은 코드를 이어받는 AI를 뜻하며, 앱 공급자를 무조건 변경하라는 지시는 아니다.

## 6. 검증 명령과 증거의 한계

```powershell
# 저장소 루트
git diff --check
Set-Location app
npm.cmd test
node --check main.js
node --check chat.js
Set-Location ../backend
.\.venv\Scripts\python.exe -m pytest tests/mcp/test_backtest_tools.py tests/api/test_projects_api.py tests/api/test_canvas_render_plan.py tests/api/test_task_canvas_envelope.py tests/api/test_selector_dispatch.py -q
Set-Location ../app
.\node_modules\.bin\electron.cmd probe-gold-order-ticket.js
.\node_modules\.bin\electron.cmd probe-project-ide-visual.js
```

프로브는 실제 Electron 렌더러에 제어된 데이터를 주입한 검증이다. 라이브 사용자 대화 전체 E2E 또는 실제 백테스트/주문 성과를 증명하지 않는다. 이번 사본에서 재실행한 캡처는 이 디렉터리의 `evidence/`에 포함했다. 과거 문서의 다른 원본 로컬 이미지까지 원격에 있다고 가정하지 않는다. 금 티켓 프로브는 g 표시·실행 비활성·`orderExecute` 0을 확인한다. `개`/`주`→g 의미는 `gold-order-intent.test.js`와 아래 소비자 실행이 담당한다.

VALIDATION.md의 3,955/3,948 숫자와 인계 직전 HTTP 200은 **역사**다. 이번 머신 결과로 재사용하지 않는다.

## 7. 전달 범위와 보안

소스, 테스트, 문서, 재현 프로브는 커밋에 포함한다. 원본 전체 대화 로그·개인 데이터·비밀값·캐시·가상환경·설치 패키지·실행 중 프로세스는 전달하지 않는다. 사용자 요청과 결정·실패·검증 공백은 이 문서와 START-HERE에 보존했다. 새 컴퓨터에서 과거 Codex 하위 에이전트나 .omc 상태가 필요하지 않다.

## 8. 이번 작업(2026-09-09 Grok)에서 실제로 확인한 것

기준 브랜치: `codex/grok-realtime-handoff-20260909`. 작업 시작 HEAD: `fc1e9023e3023c18182ee4b1525e8c1a321e38ac` (`docs(handoff): Grok 이어받기 지침과 검증 증거를 묶는다`). 최종 HEAD는 `git rev-parse HEAD`로 확인한다. 이 절에 자체 커밋 해시를 순환 기록하지 않는다.

시작 시 `git status --short --branch`는 깨끗한 `codex/grok-realtime-handoff-20260909`였다. 제품 변경은 `gold-order-intent.js`와 그 테스트, 이 README, `evidence/` 캡처뿐이다.

환경: Windows, 이 워크스페이스. `app`에 `npm.cmd ci --no-audit --no-fund`(125 packages). `backend`에 Python 3.12 venv + `pip install -e ".[dev]"`. 라이브 실행 전 형제 worktree의 gitignored `.env`를 복사했다(키 이름만 확인, 값은 문서에 없음). `ATHENA_ENABLE_ORDER_API=false`, Kiwoom base는 mock. TCP 8010은 이미 `API-검수` 백엔드가 Listen 중이어서 **종료하지 않고** 이 앱이 붙었다.

실행한 명령과 이번 결과:

| 검사 | 이번 결과 |
|---|---|
| `node --check app/lib/main/gold-order-intent.js` | 통과 |
| `git diff --check` | 통과 |
| `app`: `node --test lib/main/gold-order-intent.test.js` 연속 2회 | 각 19/19 통과, fail 0. `1개`/`1주`는 quantity 없음·재질문, `1g`/`100g`는 수량 수용, 미니금 `100g` 상품명 무시, 재열기·대화 격리 유지 |
| 새 Node 소비자로 shipped `resolveGoldOrderTurn` 2회 | 두 회 동일. `1개`/`1주` → collecting, `ord_qty` 없음. `1g`/`100g` → ready, `execution_supported: false`, blocker 비어 있지 않음 |
| `electron.cmd probe-gold-order-ticket.js` | `ok: true`. qty `1`, unit `g`, 실행 버튼 disabled, blocker 시장가 매매구분, `orderExecute` 0. 캡처: [금 주문 팝업](evidence/gold-order-ticket.png), [JSON](evidence/gold-order-ticket.json) |
| P1 JS: `ranking-board-controls`, `plugin-canvas`, `technique-create-dialog`, `project-ide`, `session-restore`, `gold-quote-intent`, `backtest-canvas` | 395/395 통과, fail 0 |
| `backend/.venv/Scripts/python.exe -m pytest tests/api/test_projects_api.py -q` | 40 passed. `parent` `../escape` / 절대경로 400, 프로젝트 밖 파일 없음 |
| `electron.cmd probe-project-ide-visual.js` | files 6, tabs 1, 터미널 표시, removed 0. [편집기](evidence/project-ide.png) |
| 전체 `app` `npm test` | 이번 머신에서 실행하지 않음. 과거 3,955 숫자를 재사용하지 않음 |
| 라이브 `app npm start` + Orca computer-use | 실행함. 창 제목 Athena, 이 worktree `shell.html`. 아래 §8.1 |

P1 코드는 처음부터 다시 만들지 않았다. 기존 테스트가 통과해 제품 파일을 고치지 않았다. 종목 찾기 시가총액 필터는 계속 미지원 안내다. 플러그인 추천 UI 문자열은 `plugin-canvas.js`에 없다. 부엉이 크기 펄스는 `chat.css`에서 고정 22px + 눈꺼풀 깜빡임만 남는다.

### 8.1 라이브 앱 (computer-use, 2026-09-10)

`orca computer`로 Athena 창을 조작했다. 실제 금 주문 실행 버튼은 누르지 않았다.

| 화면 | 관측 |
|---|---|
| 에르가네 · 플러그인 | 추천 목록 없음. 「설치한 플러그인이 없습니다 · [+ 서버 추가]에서 직접 등록합니다」. [캡처](evidence/live-plugin.png) |
| 팔라스 · 백테스트 | 「백테스트 기능이 꺼져 있습니다 — 설정에서 백테스트를 켜야 합니다」. 원인: 기존 :8010(`API-검수`)에 붙음. [캡처](evidence/live-backtest.png) |
| 부엉이 | 채팅 입력 우측 고정 크기. 커졌다 작아지는 효과 없음 |
| 금현물 시세 | `금현물 시세 알려줘` → 「어느 금현물 시세를 볼까요? 금 99.99_1kg 또는 미니금 99.99_100g」. 상품 선택 후 실카드는 후속 LLM 턴이 다른 질의로 넘어가 이번 세션에서 못 닫음. [캡처](evidence/live-gold-quote.png) |
| 종목 찾기 | 질의 `종목 찾기`는 순위 보드(13K0-2)를 바로 열지 않고 도구 후보를 물어봄. [캡처](evidence/live-jongmok-find.png) |
| 급등/순위 조회 | 캔버스 알림 「조회 요청 조건을 처리하지 못했습니다. (HTTP 422)」. [캡처](evidence/live-ranking-422.png) |
| 금 주문 수집 | 채팅 입력칸이 제안 문구로 자주 덮여 `금현물 시장가 매수` 제출이 반복 실패. P0 `개`/`주` 재질문은 유닛/소비자/티켓 프로브가 담당. 실행은 차단 유지 |

남은 제약:

- 라이브 백엔드가 이 worktree venv가 아니다. 백테스트 켜기·순위 422 재현은 이 앱이 자기 백엔드를 띄운 세션에서 다시 봐야 한다. 기존 :8010은 종료하지 않았다.
- 금현물 주문 실행 API 계약·실행 권한은 여전히 없다. 초안 팝업 ≠ 주문 전송.
- 전체 JS 스위트는 인계 기록상 worker 동시성 이슈가 있어 이번에는 타깃 테스트만 돌렸다. 재실행 시 `--test-concurrency=4`를 권장한다.
