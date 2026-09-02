# 세션 전체 저장·복원 명세 — Open WebUI·Orca 참조

작성 2026-09-02. Paper 화면 페이지 35~43번 보드의 저장 규칙을 글로 옮긴 것. 승인 전 초안이며, 구현은 사용자 승인 뒤에 시작한다.

사용자 요구(그대로): 세션 저장은 무조건이다. 일부 저장·복원 안 함은 없다. 백테스트가 도는 동안 다른 창에서 대화하고, 창을 떠났다 돌아오면 진행률까지 이어 본다. ChatGPT·Claude·Codex·Open WebUI·Orca가 이미 하는 것을 그대로 가져온다.

## 1. 원칙 12개

1. 세션 = 레코드 하나. 메시지·캔버스 카드·모드별 워크스페이스·뷰포트·job 참조가 한 레코드 안에 산다. Open WebUI의 `chat(JSON)` 한 컬럼 골격.
2. 저장은 무조건. 임시 세션·저장 안 함 스위치를 만들지 않는다. 지우는 것은 사용자뿐이다.
3. 복원 계약이 없는 필드는 스키마에 넣지 않는다. 현재 `athena:conversations-set-active`가 돌려주는 `restorable:false`는 명세 위반이다.
4. 쓰기 주체는 main 프로세스. 렌더러 DOM은 투영이지 진실이 아니다. 지금은 chat.js·canvas.js가 DOM만 쌓아 직렬화할 모델이 없다.
5. 진행 중 작업은 세션 밖 job 레코드. 세션은 job id만 든다. job 수명은 창·모드·렌더러와 무관하다.
6. 스트리밍 델타는 200ms 메모리 버퍼에 덮어쓰되, **5초 또는 2KB마다 진행 중 메시지 행에 저널 커밋**한다(같은 행 UPDATE). 프로세스가 죽어도 마지막 저널까지 남는다. Open WebUI가 `response_streams`를 Redis(프로세스 밖)에 두는 것과 같은 목적.
7. 중단·취소도 보존. 부분 응답·부분 결과·부분 로그를 커밋하고 `interrupted`로 표시한다. thinking도 최종 1회 원문으로 커밋한다. 표시 여부만 토글이다.
8. 큰 데이터는 참조. 결과 데이터셋·봉·체결·자산곡선은 이미 SSoT(backtest.sqlite3, brain.sqlite3, 프로젝트 폴더)가 있으니 키만 든다.
9. 사용자 코드는 파일이 진실. 세션은 열린 탭·커서·스크롤·미저장 버퍼만 든다. 미저장 버퍼를 몰래 디스크에 쓰지 않는다.
10. 모드 전용 상태는 `workspace.kind` 판별 유니온으로 같은 레코드 안에 둔다.
11. 쓰기는 병합. `revision` 단조 증가, 서브트리 patch, 오래된 writer가 남의 행을 지우지 못한다.
12. 복원은 화해로 끝난다. 저장 상태 + 살아있는 job 조회 = 화면. job이 없는데 `done:false`면 정직하게 `interrupted`로 정리한다.

## 2. 세션 레코드

```json
{
  "schemaVersion": 1,
  "id": "sess_01JC8QB4M2VT",
  "mode": "backtest",
  "projectId": "proj_athena",
  "title": "추세추종 v3", "titleSource": "auto",
  "pinned": false, "archived": false,
  "createdAt": "…", "updatedAt": "…", "revision": 212,
  "messages": [ { "id", "parentId", "role", "text", "thinking", "done",
                  "toolSteps": [], "cardRefs": [], "attachments": [], "usage", "error" } ],
  "currentId": "msg_12",
  "canvasCards": [ { "cardId", "seq", "kind", "channel", "envelope", "dataRef", "live", "protected" } ],
  "workspace": { "kind": "backtest", "form": {}, "openTabs": [], "log": { "logRef", "tail" },
                 "result": { "runId", "metricsRef", "tradesRef", "equityRef" }, "filters": {} },
  "viewport": { "chat": { "anchorMessageId", "atBottom" }, "canvas": { "selectedCardId" },
                "editor": { "path", "scrollTop" } },
  "jobs": [ { "id": "job_bt_9f1a", "kind": "backtest.run", "lastSeen": { "status", "pct", "at" } } ]
}
```

- `titleSource`는 `auto | user | fallback`. 사용자가 고친 제목은 자동 생성이 덮지 않는다.
- `currentId`는 렌더 경로 말단. 편집·재생성은 같은 `parentId` 아래 형제를 만들고 `currentId`만 옮긴다(Open WebUI `history.currentId`).
- `messages`는 행 단위 테이블(`session_messages`)로도 저장한다. 목록·검색은 인덱스 컬럼만 읽고 블롭은 열지 않는다.

## 3. 표 — 무엇을 남기는가 (42번 보드)

어휘는 셋뿐이다. **값**(세션에 복사) / **참조**(원본은 제자리, 세션은 키) / **—**(그 모드에 개념 자체가 없음). "저장 안 함"은 없다.

| 항목 | 대화 | 그래프 | 에이전트 | 플러그인 | 백테스트 |
|---|---|---|---|---|---|
| 대화 메시지 전체 (thinking·toolSteps·중단분 포함) | 값 | 값 | 값 | 값 | 값 |
| 캔버스 카드 스택 (보호 카드는 모드 무관 도착) | 값 | 값 | 값 | 값 | 값 |
| 화면 스크롤·선택 위치 | 값 | 값 | 값 | 값 | 값 |
| 모드 전용 폼 값·입력 초안 | 값 | 값 | 값 | 값 | 값 |
| 사용자 작성 코드 | — | — | — | — | 참조 + 버퍼 값 |
| 실행 로그 (최근 50줄은 값 캐시) | 참조 | 참조 | 참조 | 참조 | 참조 |
| 결과 데이터셋 | 참조 | 참조 | 참조 | 참조 | 참조 |
| 필터·기간·정렬 | 값 | 값 | 값 | 값 | 값 |
| 실행 핸들·진행률 (lastSeen은 캐시, 판정은 job 조회) | 참조 | 참조 | 참조 | 참조 | 참조 |

## 3-1. 모드 전환은 조용하다

모드를 누르면 화면만 바뀐다. 확인 창도 토스트도 "봉인했습니다" 같은 표시도 없다. 저장은 이미 되어 있으니 마지막 변경분만 뒤에서 flush한다. 떠난 창은 사이드바 이력 행에 스피너로 "돌고 있음"만 보인다(대부분의 앱이 그러하듯). 돌아가는 길은 별도 링크가 아니라 그 이력 행이다.

실행 중 표시는 **스피너 하나**로 통일한다(사용자 확정 2026-09-02). 초록 점은 쓰지 않는다. 대기는 주황 점, 완료는 회색 점, 실패는 빨간 점을 유지한다.

## 4. 언제 쓰는가

| 트리거 | 무엇을 | 지연 목표 |
|---|---|---|
| 메시지 제출 | 세션 없으면 생성 + user 행 + assistant 자리표시자(`done:false`) 한 트랜잭션. 모델 호출은 커밋 뒤 | 동기 p95 30ms, 상한 50ms. 실패하면 턴을 시작하지 않고 이유를 보인다 |
| 스트리밍 델타 | 200ms 메모리 버퍼 덮어쓰기 + 5s/2KB마다 진행 중 행 저널 커밋 | 디스크 쓰기는 저널만 |
| 툴 시작·완료·승인 대기·에러 | 해당 행 `toolSteps`/`error` upsert, 승인 대기는 재개 컨텍스트까지 | 100ms |
| 턴 종료·중단 | 최종 텍스트·thinking·`done:true`·usage 1회 upsert, 버퍼 비움 | 150ms |
| 캔버스 카드 변경 | `session_cards` 행 upsert/delete + seq | 200ms 디바운스, 최대 600ms |
| 폼·탭·필터·드릴인 | `workspace` 서브트리 patch, deep-equal이면 스킵 | 300ms 디바운스, 최대 1s |
| 편집기 타이핑 | `openTabs[].dirtyText`·커서·스크롤. 파일은 건드리지 않음 | 유휴 500ms, 최대 2s |
| 스크롤·선택 | `viewport` 서브트리(앵커 우선) | 유휴 400ms, 최대 2s |
| 모드 전환 | 떠나는 모드 dirty flush → `mode` 갱신 → 화면 전환. **전환은 기다리지 않는다** | flush는 백그라운드 |
| 창 blur·최소화·오브로 접힘 | 대기 중인 디바운스 전부 flush | 100ms |
| 창 닫기·before-quit | `flushSync`. 예산을 넘겨도 커밋을 마친다. WAL은 커밋된 것만 복구한다 | 200ms 목표, 초과 허용 |

파일 쓰기 경로는 Orca와 같다. 1초 디바운스, 해시가 같으면 스킵, tmp 작성 → fsync → rename, `.bak.0~4` 회전(직전 백업이 1시간 이상 됐을 때만), 손상 시 백업 순회 복구.

## 5. 실행은 데몬이 소유한다 (39·43번 보드)

- 창(셸·오브)은 보는 자리다. 닫아도 아무 일도 없다.
- **Athena 데몬**이 채팅 세션·백테스트 job·MCP 프로브·루틴 실행을 소유한다. 창은 pid·token으로 다시 붙는다(warm reattach). 데몬이 없을 때만 세션 id로 콜드 재개.
- 이유: 지금 채팅 턴은 main이 띄우는 자식 프로세스라 앱을 끄면 턴이 끝난다. 대화 모드에서도 "창을 떠나도 계속"이 성립하려면 실행 주체가 창 밖에 있어야 한다. Orca가 PTY를 데몬에 두어 앱이 죽어도 에이전트가 계속 도는 구조와 같다.
- job 레코드: `{id, kind, sessionId, projectId, status, progress, logRef, heartbeatAt, startedAt, finishedAt, error}`. 저장소는 `athena-jobs`(데몬 소유). 백엔드 실행(backtest.run 등)은 백엔드 job 테이블에 두고 데몬이 미러링한다. 부팅 시 heartbeat 끊긴 running을 `interrupted`로 확정한다.
- 진행률·로그는 사용자 단위로 브로드캐스트하고 각 창이 세션 id로 거른다(Open WebUI가 user 룸으로 쏘는 이유와 같다).

## 6. 돌아왔을 때 (41번 보드)

1. 세션 로드 → 저장된 화면을 즉시 그린다. 진행률 바는 `lastSeen`으로 먼저 뜬다.
2. `jobs[]` 일괄 조회로 화해. running이면 진행 스트림 재구독 + `logOffset` 이후만 이어 붙임. 끝났으면 결과 참조로 결과 화면. 없으면 `interrupted`.
3. 진행 중이던 assistant 메시지는 저장본 위에 런타임 버퍼를 overlay해 흘러간 텍스트까지 채운 뒤 델타를 이어 받는다.
4. 폼 값은 저장된 그대로 채운다. 검증 실패 값은 지우지 않고 `formErrors`로 표시한다. 사용자가 쓴 값을 시스템이 버리지 않는다.
5. 부분 복원이면 배너로 무엇이 빠졌는지 이름을 댄다(30번 보드 어휘).

## 7. 검색·아카이브·삭제·비밀값

- 본문 검색: `session_messages` FTS5. 삭제·아카이브와 동기화.
- 아카이브: 플래그만. running job은 계속 돈다. 목록·검색 기본 필터에서 빠지고 `archived:` 접두사로 찾는다.
- 삭제: 세션 행 + `session_messages` + `session_cards` + `session_files` 원본 + job 행 + 런타임 버퍼. 결과 데이터셋 원본(bt_run 등)은 남긴다(다른 세션이 참조할 수 있다). 프로젝트 제거는 폴더를 trash 경유로 지운다(37번).
- 상한: 없다. 지우는 주체는 사용자뿐이다. 오래된 로그는 압축만 한다.
- 비밀값: 플러그인 스니펫의 토큰·키는 저장 전에 OS 자격증명 저장소로 빼고 세션에는 참조만 둔다.

## 8. 참조 앱 대조

| 앱 | 저장 단위 | 저장 시점 | 스트리밍 중 | 재접속 | 프로젝트·삭제 |
|---|---|---|---|---|---|
| Open WebUI | chat JSON 한 레코드 + chat_message 이중 기록 | user·placeholder를 스트리밍 전에 커밋, 최종 1회 upsert | Redis response_streams만 | GET /chats/{id}가 스트림 overlay, task 조회로 화해 | folder_id 하나, 핀·아카이브 boolean |
| Orca | orca-data.json 단일 스토어 + 워크트리 meta | 1s 디바운스·해시 스킵·원자 쓰기·백업 5 | 터미널 5s 체크포인트 + append 로그 | 데몬 warm reattach, 없으면 `claude --resume` | 작업마다 worktree, 삭제는 trash 경유 |
| Claude Code · Codex | 세션 JSONL(cwd별 폴더) | 턴마다 append | 부분 응답도 JSONL | `--resume` / `--continue` | cwd가 곧 프로젝트 |
| Athena (이 설계) | 세션 레코드 하나 + 인덱스 컬럼 | 메시지·카드 즉시, 폼·코드·필터 1s 디바운스, 원자 쓰기·백업 5 | 200ms 버퍼 + 5s 저널 | 세션 로드 → jobs 화해 → 버퍼 overlay, 데몬 reattach | projectId = 폴더 하나, 제거는 trash 경유 |

## 9. 지금 코드에 없는 것

- `app/main.js` `athena:conversations-set-active`가 `restorable:false`를 하드코딩한다. `athena:session-load`로 대체.
- `app/lib/main/conversations.js`는 `{id, title, createdAt, updatedAt, projectId}`만 쓴다. `mode`·본문·카드·워크스페이스·job이 없다. `session-store.js`(athena-sessions.sqlite3) 신설.
- `app/lib/main/chat-history-store.js`는 브레인 전송 아웃박스라 `markSynced()`가 본문을 지운다. 복원 원본이 될 수 없다.
- `app/chat.js`·`app/canvas.js`에 직렬화 가능한 메시지·카드 모델이 없다. DOM만 쌓는다.
- `graph-mode-store.js`는 항상 초기값에서 시작하고 필터 취향은 localStorage 전역 1벌이다.
- `backtest-canvas.js`의 폼·runId·jobId·lastError는 전부 클로저 변수라 창을 떠나면 휘발한다.
- 상주 채팅 세션은 프로세스 전역 하나이고 새 턴이 오면 기존 턴을 인터럽트한다. 데몬 분리와 세션별 실행 핸들이 필요하다.
- 백엔드 채팅 적재 스키마는 `conversation_id·role·text·message_id·occurred_at`만 받는다. 백테스트 job 레지스트리는 메모리 dict라 백엔드가 죽으면 사라진다.

## 10. 근거

- Open WebUI main(0.11.x): `backend/open_webui/models/chats.py`, `chat_messages.py`, `folders.py`, `utils/middleware.py`, `main.py`.
- Orca(stablyai/orca, MIT): `src/main/daemon/daemon-pty-runtime-state.ts`(체크포인트 5s·15s·45s), `terminal-history-session-writer.ts`, `src/main/persistence/*`(디바운스·원자 쓰기·백업 회전), `src/main/worktree-trash.ts`, `src/shared/agent-session-resume.ts`. 이 PC의 `%APPDATA%\Orca\profiles\local-default\orca-data.json`·`terminal-history\*` 실측.
- 워크플로 조사 원문: `.omc/session-spec.json`(gitignore).

## 11. 구현 순서 (2026-09-02 착수)

모드 어휘 주의: 코드는 `summary|graph|agent|plugin|backtest`(graph-mode-store.js의 VIEW_*)를 쓰고, 세션 레코드는 `chat|graph|agent|plugin|backtest`를 쓴다. `summary ↔ chat` 매핑은 `app/lib/session-snapshot.js`의 `viewToMode`/`modeToView` 하나에만 둔다.

### Wave 1 — 신규 파일 (다른 세션과 충돌 없음)
- `app/lib/session-snapshot.js` — 스냅샷 순수 계약(정규화·메시지 트리·병합·제목)
- `app/lib/main/session-store.js` — SQLite 저장소(sessions/messages/cards/jobs, 목록은 blob 미열람)
- `app/lib/session-history-view.js` — 사이드바 뷰모델(5모드 머리 + 프로젝트 + 최근)

### Wave 2 — 렌더러·메타데이터 배선
- [x] `app/lib/main/conversations.js` — 레코드에 `mode`·`resumeSessionId`. ff64f93·c51dc10
- [x] `app/lib/sidebar.js` — 모드 머리에 대화 수(ba63bc5). 실행 중 스피너는 job 배선 뒤
- [x] `app/chat.js` — 과거 대화 열기가 복원이 된다(c51dc10): 모드 화면 전환·메시지 재그리기·입력 개방

### Wave 3 — main 프로세스

실앱 프로브 `app/probe-session-restore.js`(백엔드·Claude 없이 main+렌더러만) 13/13 통과.
- [x] `app/main.js` — conversations-new이 mode를 살린다(c51dc10)
- [x] `app/main.js` — set-active가 switchTo 큐를 타는 실제 전환이 됐다. Claude 커서(--resume)를 대화마다 적고 잇는다(c51dc10)
- [x] `app/main.js` — 세션 스토어 배선(42f0045). 정책은 `session-bridge.js`(5e09c2d), 형상은 `session-wiring.test.js`
- [x] `app/preload.js` — 세션 채널 5개(42f0045)

### 파일 소유 (2026-09-02 세션 간 합의)
- daou-athena-5b: main.js, preload.js, canvas.js, shell.css, backtest-*.js, live-prompt.js, project-ide.js, probe-backtest-full.js
- 이 세션(daou-athena-8c): session-*.js 신규 3종, conversations.js, sidebar.js, chat.js의 과거 대화 구역
- 제3 세션: backend brain 계열(brain.py, brain/store.py, brain_tools.py)

편집 규율: main.js·chat.js·preload.js는 CRLF/LF 혼합이라 Edit 도구가 파일을 통째로 정규화한다. 반드시 node로 바이트를 확인하고 바이트 보존 패치로 고친다.

### Wave 4 — 세션 스토어 배선 (적용 완료)
- [x] canvas.js — 카드 스택 보고(추가·닫기·비우기), 재생 카드는 저장된 id를 유지. 스토어는 보고된 배열을 스택의 전부로 본다(빠진 카드는 삭제).
- [x] chat.js — 입력 초안·스크롤 보고(patch), 복원 시 초안(입력이 비었을 때만)·스크롤 적용. main이 patch를 병합하고 kind를 그 대화의 모드로 찍는다.
- 실앱 프로브 21/21.
- `app/lib/main/session-bridge.js`(작성 중) — 저장 타이밍 정책. 메시지 즉시, 스트리밍 5s/2KB 저널, 카드 200ms, 워크스페이스 300ms/1s, 뷰포트 400ms/2s, 종료 flushSync.
- main.js 배선 지점(실측): 사용자 메시지 `runLiveQuery` 진입부(historySink.saveChatMessage 직후), 델타 `sendLiveTextDelta`, 툴 단계 `sendLiveToolStep`, 최종 `persistLocalLiveResult`/turn 종료(3684~), 종료 `before-quit`의 conversations.flushSync 옆.
- 캔버스 카드: 렌더러가 스택을 보고한다. `addLiveCard(result)`가 카드 DOM에 봉투를 매달고(`__athenaSessionEnvelope`), 추가·닫기·비우기 뒤에 `athena:session-cards`로 `[{cardId, kind, channel, envelope, protected}]`를 보낸다. main이 bridge.saveCards로 적는다. 복원은 저장된 봉투를 `athena:add-canvas-live`로 다시 흘려 같은 렌더 경로로 그린다(별도 렌더러 없음). 큰 payload는 dataRef만 남기는 것은 그 다음.
- 워크스페이스: 각 모드 컨트롤러가 `athena:session-workspace` patch를 보낸다. 백테스트는 backtest-canvas.js 소유 세션(daou-athena-5b)과 조율 뒤.
- 복원 진입: `athena:session-load`가 스토어 스냅샷을 돌려주고, chat.js `restoreConversation`이 메시지를 브레인 조회 대신 스냅샷에서 그린다(브레인은 폴백).
- 채널 추가(preload): send `athena:session-cards`·`athena:session-workspace`·`athena:session-viewport`, invoke `athena:session-load`.

### Wave 5 — 프로젝트 = 폴더 (36·37·38번 보드)
- [x] `conversations.js` — 프로젝트 레코드에 `path`·`pinned`. 폴더 하나 = 프로젝트 하나(경로 중복 접기), `addProject({id,path,label})`·`setProjectPinned`·`removeProject`·`projectById`. 사이드바 프로젝트와 백엔드 프로젝트 레지스트리(`athena_api/api/projects.py`)는 같은 것 — id를 공유한다.
- [x] `main.js` — `athena:project-add`(폴더 대화상자 → 백엔드 open 등록 → 사이드바 레코드), `project-pin`, `project-reveal`(shell.openPath), `project-remove`(이름을 그대로 다시 쳐야 하는 영구 삭제, 세션 본문도 함께).
- [x] `sidebar.js` — ⋯ 메뉴 셋(고정·탐색기·제거), 폴더 추가, 펜 = 모드 골라 새 대화창. 순수 규칙은 `sidebar-project-menu.js`
- [x] `styles/sidebar-session.css` — 모드 수·스피너·행 점·폴더 추가·모드 선택·삭제 확인·고정 표시. shell.css는 다른 세션 소유라 별도 파일로 두고 shell.html에서 link.

### Wave 6 — 실행 상태 (39번 보드, 적용 완료)
- [x] `session-store.js` — `runStates()`(세션마다 대표 상태 하나: running > waiting > failed > done), `getJob`, `listJobsByStatus`. 상태 어휘 접기 `jobRunState`: 백엔드 running/done/failed/cancelled + 여기의 interrupted.
- [x] `session-bridge.js` — `attachJob`·`updateJob`·`runStates`·`onRunState`. 답변 턴도 실행이다: `beginAssistant`가 `chat.turn` job을 붙이고 `finishAssistant`가 done(정상·사용자 중단)/failed(오류)로 닫는다.
- [x] `main.js` — `athena:backtest-run`(run_id)·`-backfill`(job_id) 응답을 지금 기록 대상 대화의 실행으로 붙이고, `-result`·`-status` 폴링 응답으로 상태·heartbeat를 갱신한다. 대표 상태가 바뀌면 `athena:session-run-state`로 사이드바에 민다. `athena:conversations-list`가 `runState`를 얹어 준다. 부팅 때 `reconcileSessionJobs`: 지난 프로세스의 답변 턴은 interrupted, 백테스트는 백엔드에 물어 맞춘다(15초 × 3회 뒤 포기).
- [x] `sidebar.js` — 행의 점 하나(실행 중 = 스피너, 대기 주황, 완료 회색, 실패 빨강), 모드 옆 스피너, 머리의 "실행 중 N · 대기 M" 알약. 푸시를 받으면 그 행만 고쳐 다시 그린다.
- 실앱 프로브 27/27 (`ATHENA_PROBE_SHOT=경로`면 사이드바·모드 선택·삭제 확인 PNG를 남긴다).
- 남은 것: 백테스트가 아닌 모드(그래프·에이전트·플러그인)의 실행은 아직 job을 붙이지 않는다 — 그 모드의 컨트롤러가 다른 세션 소유라 `bridge.attachJob` 호출 지점만 합의하면 된다. 워크스페이스 저장도 같은 이유로 그 모드들은 미배선.

### Wave 7 — 모드 워크스페이스 계약 (42번 보드, 적용 완료)
- [x] `lib/session-workspace.js` — 렌더러 전역 `window.AthenaSessionWorkspace`: `register(kind, { restore })`·`report(patch)`·`restore(workspace)`. chat.js `restoreConversation`은 초안·스크롤을 돌린 뒤 `restore(ws)`로 kind의 핸들러에 통째로 넘긴다. 핸들러의 동기·비동기 실패는 경고로만 남는다.
- [x] 그래프(canvas.js) — 서브뷰(요약/지도/설정)·고른 노드를 1초 폴링으로 바뀐 조각만 보고, 복원은 `setSurface`·`selectNode`. 펼친 군집은 공개 API로 못 돌리므로 저장하지 않는다.
- [ ] 백테스트(backtest-canvas.js, daou-athena-5b 소유) — 폼·탭·선택 파일을 `report({ form… })`, `register('backtest', …)`로 되돌린다. 계약은 전달함(2026-09-03).
- [ ] 에이전트·플러그인 — 화면 상태가 생기면 같은 두 줄.
- 실앱 프로브 30/30.
