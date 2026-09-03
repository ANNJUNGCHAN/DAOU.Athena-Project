# Deep Interview Spec: 플러그인 모드 — "모드가 대화의 경계" 기조 정렬 (Paper + 실앱)

## Metadata
- Interview ID: di-athena-doctrine-plugin-20260903
- Rounds: 8 (Round 0 토폴로지 + Round 1~7)
- Final Ambiguity Score: 18%
- Type: brownfield
- Generated: 2026-09-03T01:07 KST
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- State file: `.omc/state/deep-interview-state.athena-doctrine-plugin.json` (공용 `deep-interview-state.json`은 병렬 진행 중인 **에이전트 단** 인터뷰 `di-athena-doctrine-alignment-20260903`이 사용 — 두 인터뷰는 같은 기조 보드 35~43을 공유한다)
- Status: **pending approval** — 실행 경로는 사용자가 별도로 선택한다.

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.298 |
| Constraint Clarity | 0.75 | 0.25 | 0.188 |
| Success Criteria | 0.85 | 0.25 | 0.213 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.818** |
| **Ambiguity** | | | **0.182** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 플러그인 Paper 재설계 (`plugin-paper`) | active | Paper `플러그인` 페이지 6장을 모드 귀속 창 기조로 정정하고 제안→승인 흐름 보드를 신설 | 수락 기준 ①. 사용자 스크린샷 검수로 마감 |
| 플러그인 화면 실앱 적용 (`plugin-ui`) | active | 재설계 보드를 `plugin-canvas.js`·`plugin-canvas.css`·`settings-cards.js`·`chat.js` 플러그인 모드에 반영, 파리티 재통과 | 수락 기준 ② |
| 대화 기반 플러그인 제어 로직 (`plugin-chat-control`) | active | 게이트웨이 built-in 제안 툴 → 승인 카드 → 사람 클릭 전용 IPC 실행 | 수락 기준 ③ + ②의 chat.js/main.js 항목 |
| 기조 정본화 (Athena 전 표면) | deferred | — | 사용자 R0: "플러그인 paper와 플러그인 로직에만 관심" (2026-09-03T00:48) |
| 나머지 Paper 페이지 정렬 (화면·그래프·에이전트·키우미·백테스트·부팅) | deferred | — | 사용자 R0 (2026-09-03T00:48). 에이전트 단은 병렬 인터뷰가 맡는다 |
| 카드 실앱 적용 완주 | deferred | — | 사용자 R0: 별도 진행 트랙 (2026-09-03T00:48) |

## Goal
플러그인 모드를 Paper 화면 35·38·40·42번 보드가 정한 기조 **"모드가 대화의 경계다"**에 맞춘다. 플러그인은 `mode='plugin'`인 대화 창이고, 그 창의 채팅("플러그인 대화")이 **설치 · 기능 허용/철회 · 켜기/끄기 · 삭제 · 스니펫 등록** 다섯 동작을 **제안 턴**으로 내며, 플러그인 캔버스(설치·권한·MCP)가 **승인 카드**로 승인하고 실행한다. 제안은 게이트웨이 built-in 제안 툴을 통해 **모델**이 내고, 실행은 **사람 클릭 전용 IPC**만 한다. 허브·관리의 GUI 변경 버튼은 유지하되 같은 제안→승인 게이트로 합류한다(두 입구, 한 게이트). Paper 플러그인 페이지를 이 흐름으로 재설계하고, 실앱(프론트·메인·게이트웨이)에 동일하게 적용한다.

## Constraints
- **선행 인프라는 범위 밖.** 대화 레코드의 `mode` 필드, 모드별 다중 창, 작업환경 스냅샷 복원(35·38·40·42가 "지금 코드에 없는 것"으로 명시)은 별도 계획(에이전트 단 인터뷰 또는 공통 셸 트랙)이 만든다. 이 계획은 `mode='plugin'` 창 인터페이스(창 생성·복원·스냅샷 계약)를 **전제**한다. 인터페이스가 아직 없으면 플러그인 쪽은 그 계약을 문서로 고정하고 스텁/어댑터 위에서 구현한다.
- **타 모드 불간섭.** 대화·그래프·에이전트·백테스트 모드의 캔버스와 채팅 흐름은 건드리지 않는다.
- **실행은 사람 클릭 전용.** 모델 툴에는 실행 액션이 없다. 승인 카드 클릭만이 기존 `athena:mcp-register / approve / revoke / probe / allow-tool / remove / stage-snippet` IPC를 부른다 (`backend/athena_mcp/backtest_tools.py:36 _ALLOWED_ACTIONS`, `app/main.js:1344` 선례).
- **consent·probe 게이트 불변.** `backend/athena_mcp/consent.py`·`server.py`의 승인 재확인·감사 로그 구조를 바꾸지 않는다. 제안만으로는 `registry.json`·`consent.json`이 변하지 않는다.
- **재기동 경로 재사용.** 레지스트리 변경 후 상주 CLI 세션 재기동은 기존 `mcp_security_mutation` 경로(`app/main.js:2508`)를 쓴다. 06번 보드의 "재시작 안내"는 결과 턴 상태로 표현한다.
- **디자인 기조 상속.** 카드 표면 헌장 §1 신념 중 표면 공통분(정직 · 숫자 규칙 · 금지 UI · 문구 3원칙 · 색 불변 `tokens.css` · 접근성: 색만으로 상태 표현 금지·클릭 영역 32px)과 `PAPER_DESIGN_AUDIT.md` 색 역할(blue=현재 선택, amber=검토 필요, pink=주요 동작 한 곳)을 따른다. 플러그인 페이지의 재질 결정(외곽 `#FFFFFFDB`·16px, 중앙 `#FFFFFFEB`·12px)은 유지한다.
- **정보구조 결정 유지.** Kiwoom 시세·주문·계좌와 brain은 내장 API이며 플러그인으로 표시하지 않는다. 슬래시 명령 진입은 없다. 키우미는 설치 플러그인 빠른 실행 진입점(변경 없음).
- **Paper 보드 형식.** 기존 6장은 삭제하지 않고 정정한다. 신규 보드는 같은 페이지(`B-2`)에 `07~` 번호로 잇는다. 아트보드 높이는 픽셀 고정(fit-content 붕괴 회피).
- **검수 방식.** 전 보드 PDF(`export_combined_pdf`, 필요 시 분할 병합) 발송 → 사용자 검수 승인.
- **설정 02 카드.** 스니펫 직접 등록·감사 로그는 설정 소유 표면으로 남긴다. 채팅의 스니펫 등록 제안은 같은 승인 게이트(`stage-snippet` → 승인)로 합류한다.

## Non-Goals
- Athena 전 표면 기조 정본화 문서.
- 플러그인 외 Paper 페이지(화면·그래프·에이전트·키우미·백테스트·부팅·카드·증명) 수정.
- 카드→실앱 파리티 트랙(웨이브 2-B 슬롯 저작).
- 모드 귀속 대화 창 인프라(mode 필드·다중 창·스냅샷 복원·동시 실행) 구현.
- 플러그인 모드 창 안에서의 **도구 호출(실행)** UX — 기존 `@플러그인 멘션`·키우미 빠른 실행 경로 그대로.
- 외부 마켓플레이스·카탈로그 확장(내장 5종 그대로).

## Acceptance Criteria
### ① Paper 플러그인 페이지
- [ ] `03 · 허브·설치`: "채팅은 유지되고 캔버스만 허브로 바뀝니다" 문구·구조를 제거하고, 사이드바 모드 5구역(35번)에서 열린 **플러그인 모드 창** 셸로 정정 — 채팅 헤더 "아테나 · 플러그인 대화", 캔버스 = 설치·권한·MCP.
- [ ] `05 · 설치 승인`: GUI 설치 버튼이 여는 모달에서 **채팅 제안 턴이 띄운 승인 카드**(플러그인 캔버스 안, 제공·용도·요청 기능·실행 명령·설치 위치·거부/승인)로 정정. GUI 설치 버튼 클릭도 같은 카드로 합류함을 보드에 명시.
- [ ] `01 · 기능 허용`: 도구 체크 목록은 **권한 초안**(42번 스냅샷 R4)이며 승인 카드로 확정됨을 표현. 채팅 "시세 조회만 허용" 제안 경로 병기.
- [ ] `04 · 관리`: 켜기/끄기·삭제가 제안→승인을 경유함을 표현(낙관적 토글 없음, 06 state-3 유지).
- [ ] `02 · 설정 직접 등록`: 유지. 채팅 스니펫 등록 제안이 같은 게이트로 들어온다는 각주.
- [ ] `06 · 상태 모음`: 기존 4상태(빈 허브·probe 실패·토글 실패·재시작) + **제안 대기 · 거부됨** 2상태 추가.
- [ ] 신규 `07 · 플러그인 대화 — 제안 턴 5동작`: 설치·허용/철회·켜기끄기·삭제·스니펫 각각의 제안 턴 + 승인 카드(상태 전개 보드 관례: 동작마다 1장 또는 1장 안 5열).
- [ ] 신규 `08 · 플러그인 대화 — 결과 턴`: 승인 후 결과(등록→probe→도구 N개)·거부·실패/재시도·재시작 반영.
- [ ] 신규 `09 · 플러그인 창 복원`: 권한 초안·미전송 입력·제안 대기 카드가 창 복원 시 그대로(40·41·42 계약).
- [ ] 게이트: 문구 3원칙 위반 0 · 하드코딩 hex 0(허용 알파 틴트 제외) · 상태 색 규칙 준수 · 겹침·잘림 0 · 클릭 영역 32px.
- [ ] 전 보드 PDF 발송 → 사용자 검수 승인.

### ② 실앱
- [ ] `app/lib/plugin-canvas.js`: 승인 카드 컴포넌트(제안 payload 렌더, 승인/거부), 제안 대기·거부됨 상태, 허브 설치·관리 토글/삭제·기능 허용 저장이 **제안 경유**로 바뀜(직접 IPC 호출 제거).
- [ ] `app/styles/plugin-canvas.css`: Paper 신규 보드와 픽셀 동일(토큰 사용).
- [ ] `app/chat.js` 플러그인 모드: 제안 툴 결과 → 제안 턴 렌더(어떤 동작·대상·요청 기능), 승인/거부/실패/재시작 결과 턴 렌더.
- [ ] `app/main.js`: 제안 수신 → 플러그인 캔버스 카드 발행 → 승인 시에만 `athena:mcp-*` 실행, 거부 시 레지스트리·consent 불변, 실행 후 `mcp_security_mutation` 재기동 상태를 결과 턴에 반영.
- [ ] `app/lib/settings-cards.js` 플러그인 카드: 변경 없음 또는 채팅 경로 각주만.
- [ ] `npm run verify:plugins` 재통과 + 신규 assertion: 5동작 제안→승인→실행 성공, 거부 시 불변, GUI 버튼 클릭이 제안 카드로 합류.
- [ ] `cd app && npm run test:unit` 전부 통과(기준 2,015).
- [ ] `PAPER_APP_PARITY.md` 플러그인 섹션: 정정 6장 + 신규 보드 전수 `적용`.

### ③ 백엔드
- [ ] `backend/athena_mcp`에 플러그인 제안 built-in 툴 신설(예: `athena__plugin_propose`) — `action` enum 5종(install · allow_tools/revoke_tools · enable/disable · remove · stage_snippet), 대상 별칭·요청 기능·근거 필드, **실행 없음**.
- [ ] 테스트: enum 외 action 거부, 제안만으로 `registry.json`·`consent.json` 불변, 감사 로그 기록(인자 본문 제외), Kiwoom·brain 별칭 제안 거부.
- [ ] `uv run pytest` 전수 통과(기준 2,714 passed / 5 skipped).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "기조"가 카드 헌장 15조 전체를 뜻한다 | R0 토폴로지 5개 제시 | 아니다 — 범위는 플러그인 Paper·로직뿐이고, 기조는 "모드별 대화 흐름 차이"와 "대화로 플러그인 제어" 두 가지 (R0) |
| "기조를 고친다" = 기조 자체를 바꾼다 | R1 방향 질문 | 아니다 — 화면 35·38번(모드가 대화의 경계)에 플러그인을 맞춘다 (R1) |
| 플러그인 모드는 "채팅 유지·캔버스만 교체"(현 03번 보드) | 35·40번 보드가 25번을 대체함을 확인 | 플러그인은 mode='plugin' 대화 창이다. 03번 문구는 정정 대상 (R1) |
| 채팅이 승인까지 끝낼 수 있다 | R2 완성 장면 질문 | 채팅이 제안, 캔버스가 승인 (R2) |
| 이 계획이 모드 세션 인프라도 구현한다 | R3 선행 구조 질문 | 별도 트랙이 만든다. 인터페이스 전제 (R3) |
| 채팅이 제안하면 GUI 변경 버튼은 불필요 | R4 Contrarian | GUI 버튼 유지, 같은 승인 게이트로 합류 (R4) |
| "모든 플러그인 제어"에 도구 호출도 포함 | R5 범위 체크리스트 | 5동작만. 도구 호출은 비목표 (R5) |
| 제안은 앱 규칙으로 결정적으로 만들 수 있다 | R6 Simplifier | 모델이 게이트웨이 built-in 툴로 제안 — 백테스트·brain `_ALLOWED_ACTIONS` 선례 (R6) |
| 완료 판정이 암묵적 | R7 세 묶음 제시 | Paper 검수 승인 · verify:plugins+assertion · 게이트웨이 툴 테스트로 확정 (R7) |
| 설정 02 카드·키우미 메뉴는 그대로 | 인터뷰 중 명시 질문 없음 | **가정** — 설정 소유 표면 유지, 키우미 무변경. 계획 검토 시 확인 |

## Technical Context
- **기조 정본(Paper 화면 페이지, 전부 "신규 · 승인 대기")**: `35 · 대화 이력 — 모드 5구역 · 세션 목록`(3VIQ-1) "모드가 대화의 경계다 / 대화 레코드는 mode를 가진다 / 25번의 '채팅 유지'는 40번이 대체" · `38 · 펜 — 새 대화창 모드 선택`(3VV9-1) "펜=창 추가, 모드부터 묻는다, 플러그인 = 설치·권한·MCP 캔버스, 같은 모드 창 여러 개" · `40 · 모드 전환 — 조용한 전환`(3VVU-1) "전환 순간 화면만 바뀐다, 남는 것은 작업 환경" · `42 · 스냅샷 명세`(3WOP-1) R4 모드 전용 폼 값에 **권한 초안** 명시. 41 세션 복원 · 43 세션 저장 모델은 인프라 트랙 참조.
- **Paper 플러그인 페이지(`B-2`)**: `01 FT6-0` 기능 허용(1680×986, 사이드바 268 + 상세 + 채팅 400) · `02 15J-0` 설정 등록·승인(설정 오버레이) · `03 CU0-0` 허브·설치(현재 "네 번째 모드 · 캔버스만 교체 · 채팅 상시") · `04 CVY-0` 관리·마켓플레이스 · `05 2NW8-2` 설치 승인 모달(560px 시트) · `06 2NXS-2` 상태 4종.
- **앱 소유 파일**: `app/lib/plugin-canvas.js`(1,028줄; onApproveInstall·onTogglePlugin·onRemovePlugin·onSavePermissions·onStageSnippet 콜백) · `app/styles/plugin-canvas.css`(728줄) · `app/lib/plugin-catalog.js`(내장 5종: fetch·time·sequential-thinking·memory·korea-stock) · `app/lib/settings-cards.js` 플러그인 카드 · `app/chat.js` `@플러그인 멘션`(1596행, 제출 시 지시문 동봉) · 키우미 메뉴 플러그인 구역(2006행) · `app/canvas.js` 2481~2600 플러그인 캔버스 배선 · `app/main.js` 4202~4209 `athena:mcp-*` IPC → `app/lib/main/mcp-cli.js` → `backend/athena_mcp/__main__.py`.
- **게이트웨이**: `backend/athena_mcp/server.py` — Claude Code CLI → Athena Gateway(단일 MCP 서버) → 등록 MCP N개 + `athena__render_canvas`/`athena__save_canvas` + selector 4툴 + sealed plan side-channel. consent 미승인 툴은 `list_tools` 제외, `call_tool`마다 승인 재확인·감사 로그.
- **선례**: `backend/athena_mcp/backtest_tools.py:36`·`brain_tools.py:44` `_ALLOWED_ACTIONS` enum — 모델 툴은 제한 액션만, 활성화·배포는 `app/main.js:1344` "사람 클릭 전용 IPC". 레지스트리 변경 → `mcp_security_mutation` 인터럽트·재기동(`app/main.js:2508~2561`).
- **파리티·검증**: `app/verify-plugins.js`(`npm run verify:plugins`, 116 assertions, `app/captures/VERIFY-PLUGINS-REPORT.json`) · `PAPER_APP_PARITY.md:96-121` 플러그인 6/6 · `PAPER_DESIGN_AUDIT.md:57-67, 184-194` 플러그인 정보구조 결정.
- **코드에 없는 것(보드 명시)**: 대화 레코드는 id·title·createdAt·updatedAt·projectId뿐, mode 없음. 상주 채팅 세션 전역 1개. 과거 대화 열기는 읽기 전용. → 인프라 트랙 소유.
- **동선 규칙 ②** "편집도 채팅으로 — 상세 패널은 보기 전용"(`PAPER_APP_PARITY.md:414`)이 에이전트 드릴인에 적용됨 — 플러그인은 "GUI 버튼 유지 + 같은 게이트 합류"로 변형 적용.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 모드 | core domain | 대화·그래프·에이전트·플러그인·백테스트 | 대화 창의 경계 |
| 모드 귀속 대화 창 | core domain | mode, 메시지, 카드 스택, 스크롤, 모드 전용 폼 값, 실행 로그, 실행 핸들 | 모드 하나에 귀속, 프로젝트 아래 여러 개 |
| 플러그인 | core domain | =MCP 서버, 별칭, 도구 목록, 설치됨/추천, 연결 상태 | 플러그인 캔버스가 보여줌, 플러그인 대화가 제어 |
| 플러그인 캔버스 | core domain | 설치, 권한, MCP | 플러그인 모드 창의 작업공간, 승인 카드를 띄움 |
| 플러그인 대화 | core domain | 플러그인 전용 흐름(제안 턴·결과 턴) | 플러그인 모드 창의 채팅 패널 |
| 설치 제안 턴 | supporting | 채팅 턴, 동작 5종, 대상, 요청 기능 | 플러그인 제안 툴이 만든다, 승인 카드를 띄운다 |
| 승인 카드 | supporting | 제공, 용도, 실행 명령, 설치 위치, 요청 기능, 승인/거부 | 캔버스에 뜬다, 승인 게이트를 통과시킨다, GUI 버튼의 두 번째 입구 |
| 플러그인 제안 툴 | supporting | 게이트웨이 built-in, action enum 5종, 제안만 | 모델이 호출, backtest_tools 선례 |
| 승인 게이트 | supporting | consent, probe, 도구 허용, 감사 로그 | backend athena_mcp 소유, 불변 |
| 권한 초안 | supporting | 모드 전용 폼 값 | 스냅샷에 저장, 승인으로 확정 |
| 내장 카탈로그 | supporting | 5종, athena-official | 추천 목록·설치 제안 원천 |
| 키우미 빠른 실행 | supporting | 설치 플러그인 목록 | 현재 대화에서 플러그인 호출 (무변경) |
| 모드별 스냅샷 | supporting | R1~R9 저장 항목 | 대화 창 복원 |
| 모드 귀속 창 인터페이스 | external system | mode='plugin', 창 생성·복원·스냅샷 계약 | 별도 트랙이 제공, 플러그인 창이 의존 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 10 | 10 | - | - | - |
| 2 | 12 | 2 | 0 | 10 | 83% |
| 3 | 13 | 1 | 0 | 12 | 92% |
| 4 | 13 | 0 | 0 | 13 | 100% |
| 5 | 13 | 0 | 0 | 13 | 100% |
| 6 | 14 | 1 | 0 | 13 | 93% |
| 7 | 14 | 0 | 0 | 14 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (8 rounds)</summary>

### Round 0 (토폴로지)
**Q:** 5개 컴포넌트(기조 정본화·플러그인 Paper·플러그인 실앱·나머지 Paper 67장·카드 실앱 완주) 읽기가 맞는가?
**A:** 우리는 플러그인 paper와 플러그인 로직에만 관심이 있다. 다만 지금 모드별로 대화가 다르게 흘러간다는 기조와 대화로 모든 플러그인들을 제어할 수 있다는 기조를 고친다는 것이다.
**Ambiguity:** 미채점 (토폴로지 확정: 활성 3 · 미룸 3)

### Round 1
**Q:** "기조를 고친다"의 방향 — 플러그인을 기조에 맞추는가, 기조 자체를 바꾸는가?
**A:** 모드별로 대화 흐름이 다르다. 화면 page의 35번, 38번을 보라.
**Ambiguity:** 68% (Goal 0.40, Constraints 0.25, Criteria 0.15, Context 0.55)

### Round 2
**Q:** 완성된 플러그인 모드 창에서 "한국 주식 시세 설치해줘" 이후 무엇이 어떤 순서로 일어나야 하는가?
**A:** 채팅이 제안, 캔버스가 승인
**Ambiguity:** 59% (0.50 / 0.30 / 0.30 / 0.55)

### Round 3
**Q:** 35·38·40번이 "코드에 없다"고 적은 모드 귀속 창 구조를 이 계획이 구현하는가?
**A:** 모드 귀속 대화 창 인프라는 별도 계획(동시 진행 중인 에이전트 단 인터뷰나 공통 셀 트랙)이 만든다. 이 계획은 그 인터페이스(mode='plugin' 창)를 전제로 플러그인 모드까지만이다. 대화 모드 및 타 모드의 캔버스, 채팅 흐름과는 관련이 없다.
**Ambiguity:** 51% (0.55 / 0.55 / 0.30 / 0.60)

### Round 4 (Contrarian)
**Q:** 채팅이 제안하고 캔버스가 승인한다면 허브·관리의 GUI 변경 버튼이 여전히 필요한가?
**A:** GUI 변경 버튼도 유지 (누르면 채팅 제안 턴을 거쳐 같은 승인 카드로 합류)
**Ambiguity:** 43% (0.65 / 0.55 / 0.45 / 0.60)

### Round 5
**Q:** "대화로 모든 플러그인 제어"에 포함되는 동작은? (다중 선택)
**A:** 설치(카탈로그 추천) · 기능 허용·철회(도구 단위) · 켜기/끄기·삭제·스니펫 등록. 도구 호출(실행)은 선택하지 않음.
**Ambiguity:** 37% (0.70 / 0.65 / 0.55 / 0.60)

### Round 6 (Simplifier)
**Q:** 제안 턴은 누가 만드는가 — 모델 built-in 툴 / 앱 규칙 / 계획 단계 결정?
**A:** 모델이 built-in 툴로 제안 (선례 따름)
**Ambiguity:** 30% (0.75 / 0.70 / 0.60 / 0.75)

### Round 7
**Q:** 세 묶음(Paper 정정+신규 보드+검수 승인 / 실앱 반영+verify:plugins+파리티 문서 / 게이트웨이 제안 툴+테스트)이 완료 조건인가?
**A:** 맞다, 이게 완료 조건이다
**Ambiguity:** 18% (0.85 / 0.75 / 0.85 / 0.80)
</details>
