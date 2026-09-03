# Deep Interview Spec: 에이전트 모드 — "모드가 대화의 경계" + "대화·GUI 이중 완전 제어" 기조 정렬 (Paper + 실앱)

## Metadata
- Interview ID: di-athena-doctrine-alignment-20260903
- Rounds: 7 (Round 0 토폴로지 + Round 1~6)
- Final Ambiguity Score: 17% (0.165)
- Type: brownfield
- Generated: 2026-09-03T01:25 KST
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- Status: **pending approval** — 실행 경로는 사용자가 별도로 선택한다.
- State file: `.omc/state/deep-interview-state.json`. 같은 날 병렬로 진행된 플러그인 인터뷰 스펙 `.omc/specs/deep-interview-athena-plugin-doctrine.md`와 기조 보드(화면 35·38·40·42)를 공유한다.
- 이전 미완 인터뷰(키우미 미니 카드, 모호도 71%)는 `.omc/state/deep-interview-state.kiumi-mini-cards-20260903.json`으로 보관.

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.75 | 0.25 | 0.1875 |
| Success Criteria | 0.85 | 0.25 | 0.2125 |
| Context Clarity | 0.80 | 0.15 | 0.12 |
| **Total Clarity** | | | **0.835** |
| **Ambiguity** | | | **0.165** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 에이전트 Paper 페이지 재설계 (`agent-paper`) | active | Paper `에이전트` 페이지(A-2) 6장을 관제 대화 창 + 이중 제어 흐름으로 정정하고 제안·결과 턴 보드를 신설 | 수락 기준 ①. 전 보드 PDF 발송 후 사용자 검수 승인으로 마감 |
| 에이전트 로직 정합 (`agent-logic`) | active | `agent-canvas.js`·`chat.js`·`main.js`·`backend/athena_mcp/routine_tools.py`·`api/routines.py`가 제어 인벤토리 A~E를 대화·GUI 두 경로로 실행하고 Paper와 파리티 | 수락 기준 ②·③ |
| 기조 정본화 (Athena 전 표면) | deferred | — | 사용자 R0 (2026-09-03T00:48): "에이전트 paper와 에이전트 로직에만 관심" |
| 나머지 Paper 페이지 정렬 (화면·그래프·카드·증명·플러그인·키우미·백테스트) | deferred | — | 사용자 R0. 플러그인은 병렬 인터뷰가 맡음 |
| 카드 파이프라인 실앱 적용 (슬롯 바인딩 15/3,532 등) | deferred | — | 사용자 R0. 별도 트랙 |
| 공통 세션 기반 (mode 필드·다중 창·펜 시트·스냅샷 복원 = 화면 35·38·40·41·42) | deferred (external) | — | 사용자 R4 (2026-09-03): "다른 곳에서 진행하고 있다. 에이전트 쪽에만 집중" |

## Goal
에이전트 모드를 두 기조에 맞춘다.

- **D1 "모드가 대화의 경계다"(화면 35·38).** 에이전트는 `mode='agent'`인 대화 창이다. **관제 창 하나 = 대화 하나**: 루틴(작업·감시)·알람·제안·실행이 전부 그 한 방으로 흐른다. 01번 "알림 파생 방"은 오브에서 넘어올 때만 생기는 **예외 창**이며 관제 창과 별개다. 사이드바 "에이전트 N"은 관제 창 수다.
- **D2 "대화로 에이전트의 모든 요소를 제어한다" → 이중 완전 제어.** 제어 인벤토리 A~E의 **모든 동작이 대화로도, GUI로도** 된다. 동선 규칙 ①②③(새 작업은 채팅·편집도 채팅·확정은 칩)은 폐기가 아니라 "채팅 경로"로 존속하고, 같은 동작의 GUI 경로(시트·폼·버튼)가 나란히 추가된다. 상세·설정 "보기 전용"은 폐기한다.

**제어 인벤토리 (전부 이중 제어)**
- A 작업 생명주기 — 생성, 설정 편집(조건·모드·소스·쿨다운·브리핑 모델), 확정(미리보기 실행·바로 활성화), 일시중지·재개, 취소
- B 알람 — 개별 읽음(ack), 모두 읽음, 알람에서 대화 이어가기
- C 제안 — 루틴으로 채택, 보류, 말걸기 가드 조정(하루 최대·조용 시간·근거 표시·거절 학습)
- D 뷰 상태 — 탭(작업·알람·라이브·제안), 필터(모두·활성·일시중지), 검색, 드릴인(이력·설정), 캔버스에서 열기·채팅으로, 그래프에서 근거 보기
- E 실행 — 지금 실행(밀린 발화 catchup-fire), 브리핑 결과 열기

Paper 에이전트 페이지를 이 흐름으로 재설계하고, 실앱(렌더러·메인·게이트웨이·루틴 백엔드)에 동일하게 적용하며, 실제 백엔드를 띄운 라이브 종단 시연으로 마감한다.

## Constraints
- **공통 세션 기반은 외부 의존.** 대화 레코드 `mode` 필드, 모드별 다중 상주 세션, 펜 모드 선택 시트, 스냅샷 복원(화면 35·38·40·41·42의 "지금 코드에 없는 것")은 다른 작업줄이 만든다. 이 계획은 `mode='agent'` 관제 창 인터페이스(창 식별자·세션 mode·복원 계약)를 **전제**하고, 아직 없으면 에이전트 쪽 어댑터/스텁 위에서 구현한다(플러그인 스펙과 같은 원칙). ⚠ 플러그인 스펙도 같은 기반을 외부로 넘겼다 — **기반 소유 트랙이 실제로 존재하는지 계획 단계에서 확인**한다.
- **타 모드 불간섭.** 대화·그래프·플러그인·백테스트 모드의 캔버스·채팅 흐름은 건드리지 않는다. 그래프 "근거 보기"는 링크 이동만.
- **상태 변경 게이트 = "두 입구, 한 게이트".** 대화 경로는 **제안 턴 → 채팅 카드 칩(사람 클릭) → 기존 `athena:routine-*` IPC 실행**. MCP `athena_routine` 도구는 `draft·list`에서 **제안 액션 enum**(confirm·pause·resume·cancel·ack·adopt·hold·guard·fire·view)으로 넓히되 **실행은 없다**(`backtest_tools._ALLOWED_ACTIONS` 선례, `routine_tools.py:6-9` "상태 변경은 사람 클릭 전용" 원칙 유지). GUI 경로 버튼·폼도 같은 IPC를 부른다.
  - *가정(계획 단계 확인)*: 되돌릴 수 있는 뷰 상태(D)는 칩 없이 즉시 적용, 상태를 바꾸는 A·B·C·E는 칩 확인. 사용자가 "모든 제어"를 문자 그대로 요구했으므로 칩 확인이 D2를 훼손하지 않는지 계획에서 명시한다.
- **GUI 경로 추가 규칙.** 05 "+ 새 작업"은 시트(폼)를 열어도 된다. 06 설정은 편집 폼 + 저장(같은 확정 게이트). "채팅에서 고치기 ↗"는 병존. 동선 규칙 원문 3줄은 **이중 제어 규칙**으로 재작성한다 — "① 새 작업은 채팅 문장으로도, 시트로도 ② 편집은 '이거 고쳐줘'로도, 폼으로도 ③ 확정은 채팅 칩으로도, 버튼으로도 — 어느 입구든 같은 게이트".
- **디자인 기조 상속.** 카드 표면 헌장 §1 표면 공통분(정직·숫자 규칙·금지 UI·문구 3원칙·토큰 색·접근성: 색만으로 상태 표현 금지, 클릭 영역 32px), `PAPER_DESIGN_AUDIT.md` 색 역할(blue=현재 선택, amber=검토 필요, pink=주요 동작 한 곳). 오브 "눈 모양 하나" 원칙 무변경.
- **Paper 보드 형식.** 기존 6장은 삭제하지 않고 정정한다. 신규 보드는 같은 페이지(A-2)에 `07~` 번호로 잇는다. 아트보드 높이는 픽셀 고정(fit-content 붕괴 회피). Paper 작업 후 활성 페이지 원위치.
- **검수 방식.** 전 보드 PDF(`export_combined_pdf`) 발송 → 사용자 검수 승인.
- **라이브 시연 범위.** 루틴 REST/WS 백엔드(`api/routines.py`, `routines_ws.py`, `nudge_guard.py`)를 실제 프로세스로 띄운다. 키움 실연결은 범위 밖(fixture 시세).
- **플러그인 스펙과 정합.** "두 입구, 한 게이트" 어휘와 제안 툴 패턴을 공유한다. 차이: 에이전트는 GUI 완전 제어(설정 편집 폼 허용)까지 요구한다.

## Non-Goals
- Athena 전 표면 기조 정본화 문서.
- 에이전트 외 Paper 페이지 수정. 화면 35·38·40·41·42의 "승인 대기" 해소.
- 공통 세션 인프라(mode 필드·다중 창·펜 시트·스냅샷 복원·동시 실행) 구현.
- 카드→실앱 파리티 트랙(슬롯 바인딩·보드 저작).
- 키움 실연결 E2E. 오브(키우미) 미니 카드·얼굴·메뉴 변경.
- 루틴 엔진 자체(스케줄러·발화 로직) 기능 추가. 라이브 컬럼 진행바·"다음 24시간" 타임라인의 실데이터 배선(현재 fixture, `PAPER_DESIGN_AUDIT.md:357`).

## Acceptance Criteria
### ① Paper 에이전트 페이지 (A-2)
- [ ] `01 · 셸 — 알림 파생 방`: "메인 대화와 섞이지 않습니다"를 "오브에서 넘어온 예외 창 — 관제 창과 별개"로 정정하고, 관제 창으로 합류하는 경로(버튼/문장)를 표기.
- [ ] `02~06` 대화 영역: `mode='agent'` 관제 창 헤더("아테나 · 에이전트 대화"), 루틴·알람·제안 턴이 한 방으로 흐르는 히스토리로 통일(현재 3장의 동일 fixture 대화 교체).
- [ ] `02 · 알람 센터`: "모두 읽음" GUI 유지 + 대화 경로(제안 턴→칩) 병기. 개별 읽음·알람에서 이어가기 두 경로 표기.
- [ ] `03 · 실행 이력·결과`: "지금 실행"(E) GUI 버튼 신설 + 대화 경로. 캔버스에서 열기·채팅으로 유지.
- [ ] `04 · 프로액티브`: 루틴으로/보류 GUI 유지 + 대화 채택·보류 턴. 말걸기 가드는 GUI 편집 폼 + 대화 가드 조정 카드.
- [ ] `05 · 작업`: "+ 새 작업" 시트(폼) 신설. 동선 규칙 3줄을 이중 제어 규칙 3줄로 교체. 상세 패널에 일시중지·재개·취소 GUI + 대화 경로.
- [ ] `06 · 설정`: 보기 전용 폐기 → 편집 폼(조건·모드·소스·쿨다운·모델) + 저장(확정 게이트). "채팅에서 고치기 ↗" 병존.
- [ ] 신규 `07 · 에이전트 대화 — 제어 제안 턴 A~E`: 동작 묶음별 제안 턴 + 칩(확정/거부) 정본.
- [ ] 신규 `08 · 에이전트 대화 — 결과 턴`: 성공·거부·실패/재시도·뷰 이동 결과 턴.
- [ ] 게이트: 문구 3원칙 위반 0 · 하드코딩 hex 0(허용 알파 틴트 제외) · 상태 색 규칙 · 겹침·잘림 0 · 클릭 영역 32px · 토큰만 사용.
- [ ] 전 보드 PDF 발송 → 사용자 검수 승인.

### ② 실앱
- [ ] `app/lib/agent-canvas.js`: 설정 편집 폼, 새 작업 시트, 일시중지·재개·취소·지금 실행·읽음·모두 읽음·채택·보류·가드 편집 GUI — 전부 같은 확정 IPC 경유. 보기 전용 렌더·"data-source 없음" 단언 대상 원문 교체.
- [ ] `app/chat.js` 에이전트 모드: 제안 턴 렌더(동작·대상·근거·칩), 결과 턴 렌더, 뷰 상태 명령(D) 처리 → `agent-canvas` 뷰 전환.
- [ ] `app/main.js`: 제안 수신 → 채팅 카드 발행 → 칩 확정 시에만 `athena:routine-pause/resume/cancel/confirm/ack/catchup-fire`·`nudge-guard` IPC 실행. 관제 창 `mode='agent'` 계약 어댑터(외부 기반 부재 시 스텁).
- [ ] `backend/athena_mcp/routine_tools.py`: 제안 액션 enum 확장(실행 없음). `backend/tests/mcp/test_routine_tools.py`의 "draft·list만 허용" 단언을 "제안 enum만 허용·상태 변경 gateway-blocked" 단언으로 교체. `nudge_guard_tools` propose 유지.
- [ ] `app/probe-agent-paper-parity.js`(`npm run verify:agent-paper-parity`): 정정 보드 기준으로 단언 갱신(현 34) → 전건 통과.
- [ ] `app/lib/agent-canvas.test.js`: 이중 경로 단언 — A~E 각 동작에 GUI 경로 1건 + 대화 경로 1건.
- [ ] `cd app && npm test` 전부 통과, `uv run pytest` 전부 통과.
- [ ] `PAPER_APP_PARITY.md` 에이전트 섹션: 정정 6장 + 신규 07·08 전수 `적용`.

### ③ 라이브 종단 시연
- [ ] 실제 백엔드(uvicorn) + Electron을 띄우고 A~E 각 동작을 **대화 경로 1회 + GUI 경로 1회** 실행, 실행 전후 `GET /api/v1/routines`·runs·guard 상태 변화를 캡처.
- [ ] 결과를 `docs/handoff/<날짜>-agent-dual-control-live.md`로 남긴다(캡처 경로·상태 diff·미통과 항목).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "기조"가 카드 헌장·정본 20원칙 전체를 뜻하고, 4개 컴포넌트(정본화·Paper 전체·실앱·에이전트 단)를 다룬다 | R0 토폴로지 제시 | 아니다 — 에이전트 Paper와 에이전트 로직만. 기조는 D1·D2 두 가지 (R0) |
| "기조를 고친다" = 기조 자체를 뒤집는다 | R1 방향 질문 | 아니다 — 화면 35·38(모드가 대화의 경계)에 에이전트를 맞춘다 (R1) |
| 에이전트 대화의 단위는 작업(루틴)마다 방 하나 | R2 온톨로지 질문 | 관제 창 = 대화 하나. 01 알림 파생 방은 오브 진입 예외 (R2) |
| D2는 "채팅 전용"(보기 전용 유지)이거나 "채팅 전부"다 | R3 수준 질문 | 이중 완전 제어 — 대화로도 GUI로도 모든 제어 (R3) |
| 이 계획이 5모드 공통 세션 기반도 구현한다 | R4 Contrarian | 다른 곳에서 진행 중. 에이전트만 집중, 외부 의존 (R4) |
| 완료 판정이 암묵적 | R5 세 묶음 제시 | Paper 검수 + 이중 경로 자동 테스트 + 프로브 + 실제 백엔드 라이브 시연 (R5) |
| 뷰 상태(탭·필터·검색·드릴인)는 GUI만으로 충분 | R6 Simplifier | A~E 전부 이중 제어 (R6) |
| 대화 경로의 상태 변경도 칩(사람 클릭) 확인을 거친다 | 인터뷰 중 명시 질문 없음 | **가정** — 게이트웨이 "사람 전용" 원칙과 동선 규칙 ③을 잇는 해석. 계획 단계 확인 |
| 외부 기반이 늦어도 에이전트 쪽은 스텁으로 진행 | 명시 질문 없음 | **가정** — 플러그인 스펙과 동일 원칙 |

## Technical Context
- **기조 정본(Paper 화면 페이지, 전부 "신규 · 승인 대기")**: `35 · 대화 이력 — 모드 5구역`(3VIQ-1) "모드가 대화의 경계다 · 대화 레코드는 mode를 가진다 · 모드를 넘으면 새 대화 · 25번 '채팅 유지'는 40번이 대체 · 지금 코드에 없는 것: 대화 레코드에 mode 필드 없음, 사이드바가 보내는 모드를 메인이 버림, 상주 세션 하나" · `38 · 펜`(3VV9-1) "펜=창 추가 · 모드부터 묻는다 · 에이전트 = 감시·예약 작업을 관제 · 같은 모드 창 여러 개" · `40 · 조용한 전환`(3VVU-1) · `42 · 스냅샷`(3WOP-1) 에이전트 열: 메시지·카드 스택·스크롤 값, 로그·데이터셋·실행 핸들 참조; 백엔드 적재 스키마는 conversation_id·role·text·message_id뿐.
- **Paper 에이전트 페이지(A-2, 1680×900 6장)**: `01 56X-0` 알림 파생 방(뉴스·재무 카드, "메인 대화와 섞이지 않습니다") · `02 ARM-0` 알람 센터·라이브(탭 작업/알람 3/라이브/제안 2, "모두 읽음으로") · `03 B57-0` 실행 이력·결과(최근 30회, 산출물, 30회 통계, 이력/설정 탭) · `04 BIM-0` 프로액티브(제안 "루틴으로/보류", 말걸기 가드, 채팅 칩 "지금 볼게/9시에 다시/이런 말 줄여줘", 가드 조정 카드) · `05 BV0-0` 작업(통계 4장, 예약·감시 리스트, 상세 "일시중지", "+ 새 작업 · 채팅에서", 동선 규칙 ①②③, 작업 요약 카드 칩 "미리보기 실행/바로 활성화/고칠 게 있어") · `06 2IJN-2` 설정 보기 전용("이 화면에서는 값을 바꾸지 않습니다", "채팅에서 고치기 ↗"). 02·03·06의 대화 영역은 같은 fixture(완료 턴·진행 중 턴·능동 턴 조건 패널).
- **앱 소유 파일**: `app/lib/agent-canvas.js`(동선 규칙 원문 :506-509, 뷰 4탭, 드릴인) · `app/lib/agent-sidebar-list.js` · `app/canvas.js:2968-3075` 배선(`athena:routines-list / routine-pause / routine-resume / brain-profile-summary / routine-runs / nudge-guard-get`, `seedChatInput`으로 새 작업·제안 추가·설정 수정) · `app/chat.js:2595-2600` 승인 칩 → `athena:routine-confirm`, `:1271-1274` 전송 payload에 mode 없음, `:1578-1581` 보드 44 "채팅은 절대 접히지 않는다, 모드는 캔버스만 바꾼다" · `app/lib/graph-mode/controller.js:282-302` activeSurface 전환 · `app/lib/main/live-prompt.js` 모드 분기 없음 · `shell.html:273 #agentCanvas`.
- **백엔드**: `backend/athena_api/api/routines.py` `GET /api/v1/routines`, `POST /{id}/confirm|pause|resume|cancel|catchup-fire|briefing-result|engagement|ack`, `GET /{id}/runs` · `routines_ws.py` `/api/v1/ws/routines` · `nudge_guard.py` · `backend/athena_mcp/routine_tools.py` `athena_routine` draft·list만("상태 변경은 사람 클릭 전용") · `server.py:748-761` 등록.
- **UI 전용 vs 대화 전용(현재)**: 대화 전용 — 새 작업·제안 추가·설정 수정(`seedChatInput`), 확정 칩. UI 전용 — 일시중지/재개, 모두 읽음, 그래프 근거 보기, 필터·검색·탭, 설정 탭(입력 없음). MCP 레벨 confirm/cancel 자연어 불가.
- **검증**: `app/probe-agent-paper-parity.js`(34 단언, `PAPER_APP_PARITY.md:429-432`) · `app/lib/agent-canvas.test.js`(:554 시트 안 열기, :1340 동선 규칙 원문, :1644 설정 입력 없음) · `backend/tests/mcp/test_routine_tools.py`(:17 draft·list만, :40 상태 변경 gateway-blocked) · `test_nudge_guard_tools.py` · `PAPER_APP_PARITY.md:363-370` 에이전트 6/6 적용 · `PAPER_DESIGN_AUDIT.md:351,357-358` 결정·잔여.
- **선례**: `backend/athena_mcp/backtest_tools.py:36`·`brain_tools.py:44` `_ALLOWED_ACTIONS`(모델 툴은 제한 액션만, 실행은 사람 클릭 IPC).
- **명령**: `cd app && npm test`(node --test) · `npm run verify:agent-paper-parity` · `uv run pytest backend/tests`. Git Bash에서 node는 fnm multishell 경로 필요.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 모드 | core domain | 대화·그래프·에이전트·플러그인·백테스트 | 대화 세션의 경계 |
| 대화 세션(창) | core domain | mode, 메시지, 스냅샷, 실행 핸들 | 모드에 속함, 프로젝트에 여러 개 |
| 관제 창 | core domain | 에이전트 세션 유형, 루틴 전체 | 대화 세션의 에이전트 형태, 사이드바 "에이전트 N"의 단위 |
| 알림 파생 방 | core domain | 시작 알림, 감시 건 | 오브 진입 시 예외 창, 관제 창과 별개 |
| 에이전트 캔버스 | core domain | 작업·알람·라이브·제안 탭, 드릴인 이력·설정 | 관제 창의 작업공간, GUI 경로의 표면 |
| 루틴(작업·감시) | core domain | 조건, 모드(예약/감시), 소스, 쿨다운, 모델, 상태 | 알람 발화, A 생명주기의 대상 |
| 제어 동작 인벤토리(A~E) | core domain | 작업 생명주기, 알람, 제안·가드, 뷰 상태, 실행 | 각 동작은 대화·GUI 두 경로, 완료 게이트의 테스트 단위 |
| 대화 제어 경로(제안 턴+칩) | supporting | 제안 턴, 확정 칩, 결과 턴 | MCP 제안 enum이 만들고 사람 클릭이 실행 |
| GUI 제어 경로 | supporting | 시트·폼·버튼 | 대화 경로와 동등, 같은 IPC 게이트 |
| 이중 제어 규칙 ①②③′ | supporting | 새 작업·편집·확정 각각 두 입구 | 동선 규칙 ①②③의 후속 |
| 이력 사이드바 | supporting | 모드 5구역, 프로젝트 트리, 최근 | 관제 창 수를 셈 |
| 완료 게이트 | supporting | Paper 검수, 이중 경로 테스트, 파리티 프로브, 라이브 시연 | 두 컴포넌트의 완료 판정 |
| 공통 세션 기반(외부 작업줄) | external system | mode 필드, 다중 창, 펜 시트, 스냅샷 복원 | 관제 창이 의존, 부재 시 스텁 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 8 | 8 | - | - | - |
| 2 | 9 | 1 | 0 | 8 | 89% |
| 3 | 10 | 1 | 0 | 9 | 90% |
| 4 | 11 | 1 | 0 | 10 | 91% |
| 5 | 12 | 1 | 0 | 11 | 92% |
| 6 | 13 | 1 | 0 | 12 | 92% |

핵심 엔티티(모드·세션·관제 창·루틴·인벤토리)는 R2 이후 이름 변경 없이 유지됐고, 이후 라운드의 신규 엔티티는 모두 보조·외부 계층이다.

## Interview Transcript
<details>
<summary>Full Q&A (7 rounds)</summary>

### Round 0 — 토폴로지
**Q:** 4개 컴포넌트(기조 정본화·Paper 재설계·실앱 적용·에이전트 단 정합)가 맞는가, "에이전트 단"의 뜻은?
**A:** 우리는 에이전트 paper와 에이전트 로직에만 관심이 있다. 다만 지금 모드별로 대화가 다르게 흘러간다는 기조와 대화로 모든 에이전트에 있는 요소들을 제어할 수 있다는 기조를 고친다는 것이다.
**Ambiguity:** 미채점

### Round 1 — Goal (공통)
**Q:** D1·D2를 각각 실현하는가 뒤집는가?
**A:** 모드별로 대화 흐름이 다르다. 화면 page의 35번, 38번을 보고 다시 질문해라.
**Ambiguity:** 64% (Goal 0.40, Constraints 0.30, Criteria 0.15, Context 0.70)

### Round 2 — Goal (에이전트 로직)
**Q:** 에이전트 모드에서 대화 창 하나는 무엇과 1:1인가?
**A:** 관제 창 = 대화 하나 (루틴 전체를 한 방에서).
**Ambiguity:** 56% (0.55 / 0.35 / 0.20 / 0.75)

### Round 3 — Goal (에이전트 Paper)
**Q:** D2는 어느 수준까지인가?
**A:** 대화로도 제어가 가능하고 GUI로도 제어가 가능하다. 즉 대화로 모든 제어가 되면서 GUI도 모든 제어가 가능해야 한다.
**Ambiguity:** 46% (0.75 / 0.40 / 0.25 / 0.80)

### Round 4 — Constraints, Contrarian (에이전트 로직)
**Q:** 공통 세션 기반(35·38·40·41·42)을 어느 범위로 넣는가?
**A:** 다중창, 펜시트, 스냅샷 복원은 다른곳에서 진행하고 있다. 우리는 에이전트 쪽에만 집중한다.
**Ambiguity:** 38% (0.78 / 0.65 / 0.25 / 0.80)

### Round 5 — Success Criteria (에이전트 Paper)
**Q:** 완료 판정은?
**A:** Paper 검수 승인 + 프로브·테스트 전건 통과 + 실제 백엔드 라이브 종단 시연.
**Ambiguity:** 26% (0.80 / 0.68 / 0.70 / 0.80)

### Round 6 — Goal, Simplifier (에이전트 로직)
**Q:** 제어 인벤토리 A~E 중 이중 제어가 꼭 필요한 범위는?
**A:** A~E 전부 이중 제어.
**Ambiguity:** 17% (0.90 / 0.75 / 0.85 / 0.80)
</details>
