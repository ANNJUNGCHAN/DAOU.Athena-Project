# 통합 이슈 원장

## BETA-001 — 시작 실패 알림에서 메인 셸로 갈 수 없음

- 심각도: Major
- 상태: reproduced
- 표면: shell / orb
- 재현: 메인 셸을 숨긴 상태에서 앱 시작 종속 작업을 실패시킨다 → 오브를 펼친다 → 시작 실패 알림을 본다.
- 실제: `접기`만 있고 `셸로 가기`가 없다. 알림 렌더러가 탐색 버튼을 숨기는 경로임을 코드에서 확인했다.
- 기대: 앱을 계속 사용할 수 있다고 안내한다면 같은 표면에서 메인 셸로 이동하거나 재시도할 수 있어야 한다.
- 우회: 트레이 `열기` 또는 같은 프로필에서 `npm start`를 한 번 더 실행한다.
- 증거: `captures/2026-08-31/00-orb-startup-failure.png`

## BETA-002 — 채팅 질의가 조용히 실패함

- 심각도: Critical
- 상태: reproduced twice; full restart after backend readiness recovers
- 표면: chat / canvas
- 재현: 새 대화 → 자연어 투자 질문 입력 → Return → 처리 완료까지 대기.
- 실제: 초기 셸에서 처리 중 표시 후 카드 0개와 빈 캔버스로 돌아간다. 오류, 실패 이유, 재시도 동작이 없다. 백엔드가 뒤늦게 HTTP 200이 된 뒤에도 기존 셸 세션에서는 같은 현상이 재현됐다.
- 기대: 답변 또는 명확한 연결 실패/재시도 안내가 보여야 한다.
- 영향: 핵심 사용자 목표를 완료할 수 없고, 사용자는 질문이 처리됐는지조차 판단하기 어렵다.
- 우회: 백엔드를 먼저 준비한 뒤 Athena 전체를 재시작하면 같은 질문과 후속 질문이 각각 14.5초, 16.8초에 응답했다.
- 증거: `captures/2026-08-31/01-chat-query-processing.png`, `captures/2026-08-31/02-chat-silent-failure.png`, `captures/2026-08-31/07-chat-silent-after-backend-ready.png`, `captures/2026-08-31/10-retry-success-after-restart.png`

## BETA-003 — 그래프 요약과 지도 탭의 빈 상태가 불일치함

- 심각도: Major
- 상태: reproduced
- 표면: graph
- 실제: 요약 탭은 설명 없는 빈 화면이고, 그래프 탭만 브레인 미준비 이유를 설명한다.
- 기대: 두 탭 모두 데이터 없음, 기준 기간, 복구 조건을 일관되게 설명한다.
- 증거: `captures/2026-08-31/03-graph-empty-honest.png`

## BETA-004 — fixture 진행 카드를 `실시간`으로 표시함

- 심각도: Critical
- 상태: reproduced and source-confirmed
- 표면: alerts / agent
- 실제: 초기 실패 상태에서는 헤더가 루틴 0, 감시 0인데 hardcoded `시세 수집 — 삼성전자`, `감시 조건 2/3 · 12초 전`, `실시간`과 07:30 브리핑 타임라인이 함께 보였다. 백엔드/WS 복구 뒤에는 실제 헤더가 루틴 2, 감시 0과 `WS 연결됨`으로 바뀌었지만 같은 fixture와 현재 시각에 맞지 않는 `49분 후`가 그대로 남았다. 사용자 노출 데모 표시는 없다.
- 기대: fixture는 숨기거나 `데모/샘플`로 명확히 표시해야 하며 라이브 카운터와 섞지 않아야 한다.
- 영향: 투자 사용자가 존재하지 않는 감시와 실시간 수집을 실제 상태로 믿을 수 있다.
- 증거: `captures/2026-08-31/06-agent-alerts-live-looking.png`, `captures/2026-08-31/13-alerts-ws-connected-fixture-time.png`, `app/lib/agent-canvas.js:170`, `app/lib/agent-canvas.js:529`, `app/lib/agent-canvas.js:548`

## BETA-005 — 플러그인 초안과 실제 연결 구분은 명확함

- 심각도: Observation / pass
- 상태: observed
- 표면: plugins
- 실제: DART 권한과 텔레그램 설치 미리보기에서 `UI 세션 초안`, `실제 런타임 연결 뒤 활성화`를 명시한다. 승인 없이 취소 가능했다.
- 후속: 3일 동안 검색, 관리, Sheets, 실적 캘린더 경로와 상태 지속성을 추가 검증한다.
- 증거: `captures/2026-08-31/04-plugin-draft-hub.png`, `captures/2026-08-31/05-plugin-telegram-preview.png`

## BETA-006 — 12초 부팅 제한이 정상 백엔드를 준비 전에 종료함

- 심각도: Critical
- 상태: reproduced and source-confirmed
- 표면: startup / backend launcher
- 실제: Electron 런처는 백엔드가 12초 안에 준비되지 않으면 프로세스 트리를 종료한다. 현재 환경의 수동 실행에서는 `/api/v1/llm/manifest`가 HTTP 200이 되기까지 약 47초가 걸렸다. 이 실패가 브레인, 알람/루틴, canvas WebSocket, 종목 인덱스 실패로 연쇄된다.
- 기대: 실제 최악 준비 시간을 수용하거나, 준비 진행을 감시하면서 사용자가 재시도할 수 있어야 한다. 준비가 느린 정상 프로세스를 실패로 오판해 종료하지 않아야 한다.
- 우회: 백엔드를 별도로 실행해 준비를 확인한 뒤 Athena를 재시작한다.
- 증거: `runtime/backend-stdout.log`, `runtime/backend-stderr.log`, `app/lib/main/backend-launcher.js:9`, `app/lib/main/backend-launcher.js:94`, `app/captures/main-debug.log`

## BETA-007 — 채팅 Markdown이 렌더링되지 않고 중앙 캔버스가 비어 있음

- 심각도: Major
- 상태: reproduced twice
- 표면: chat / persistent sidecar
- 실제: 응답의 `##`, `**`, `---`가 그대로 보인다. 답변은 오른쪽 좁은 열에 긴 원문으로 쌓이고 중앙 캔버스에는 카드가 생기지 않아 가독성이 크게 떨어진다. 그래프/에이전트 모드에서도 같은 원문이 계속 공간을 점유한다.
- 기대: Markdown 또는 구조화 카드로 읽기 쉽게 렌더링하고, 답변이 카드가 아닌 경우에도 넓이와 줄바꿈을 제어해야 한다.
- 증거: `captures/2026-08-31/10-retry-success-after-restart.png`, `captures/2026-08-31/11-followup-context-success.png`, `captures/2026-08-31/12-graph-brain-unavailable-after-chat.png`

## BETA-008 — 대화가 성공해도 브레인 프로필 그래프가 503으로 남음

- 심각도: Major
- 상태: reproduced
- 표면: graph / brain profile
- 실제: 두 번의 성공 대화 뒤에도 그래프는 “아직 성향을 읽을 수 없습니다”를 유지했다. 인증된 셸 요청의 `/api/v1/brain/profile-summary?limit=2`가 503이었다.
- 기대: 대화에서 성향을 추출하지 못했다면 이유/동기화 상태/재시도를 보여주고, 정상이라면 요약과 그래프에 반영해야 한다.
- 증거: `captures/2026-08-31/12-graph-brain-unavailable-after-chat.png`, `runtime/backend-stdout.log`

## BETA-009 — canvas/push가 정상 카드 봉투를 100% 422로 거부함 (근본 원인, 수정됨)

- 심각도: Critical
- 상태: root-caused, fixed, verified
- 표면: backend / canvas push → chat canvas
- 재현: 채팅에서 종목 시세를 묻는다 → 백엔드 로그에서 `POST /api/v1/llm/tools/call 200` 뒤 `POST /api/v1/canvas/push 422`를 확인한다.
- 실제: `api/canvas_push.py`의 `_forbidden_generic_task_canvas_aliases`가 봉투 어디든 `field_contract`/`coverage_receipt`가 있으면 `GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN`으로 거부했다. 그런데 두 필드는 `_INTEGRATED_CARD_FIELDS`이기도 해서 바로 아래 통합 카드 블록이 canonical과 대조해 허용하도록 설계돼 있었다. 앞 검사가 먼저 걸려 뒤 경로가 도달 불가였고, `athena_mcp/canvas_data.py`의 `_integrated_card_contract`는 두 필드를 **항상** 싣기 때문에 모든 `render_with_plan` push가 예외 없이 거부됐다.
- 실증: 동일 요청에서 `field_contract` 포함 → 422 `GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN`, 제거 → 200 `{"queued":true}`.
- 영향: 키움 조회는 200으로 성공하는데 카드가 한 장도 그려지지 않는다. BETA-002(조용한 실패)와 BETA-007(빈 중앙 캔버스)의 실제 뿌리다.
- 이 결함이 오래 살아남은 이유: MCP 테스트(`tests/mcp/test_canvas_data.py`)가 push 엔드포인트를 stub으로 대체해 실제 422 규칙을 한 번도 타지 않았다. 두 계약이 서로 만나는 통합 테스트가 없었다.
- 수정: 최상위의 `field_contract`/`coverage_receipt`만 alias 검사에서 제외한다. 그 둘은 통합 카드 블록이 canonical operation_ref로 다시 파생해 값을 대조하고(불일치 → 422) canonical로 덮어쓰므로 위조가 통하지 않는다. 중첩 위치에는 대조 경로가 없어 그대로 금지를 유지한다.
- 회귀: `tests/mcp/test_canvas_data.py`, `tests/api/test_canvas_push.py`, `tests/api/test_task_canvas_envelope.py`, `tests/api/test_canvas_render_plan.py` 139 passed / 0 failed.
- 경계 재확인: 최상위 위조값(`field_contract: []`) → 422 mismatch, 중첩 `field_contract` → 422 FORBIDDEN.
- 증거: `captures/2026-08-31/17-h8-query-processing-after-backend-return.png`, `captures/2026-08-31/18-h8-card-renders-after-push-fix.png`, `captures/2026-08-31/19-h9-two-cards-verified-fix-missing-units.png`, `runtime/claude-backend-20260831-093713-stdout.log`

## BETA-010 — 통합 카드가 현재가를 음수로 표시함

- 심각도: Critical
- 상태: reproduced (BETA-009 수정 후 처음 관찰 가능해짐)
- 표면: chat canvas / 통합 카드 facts grid
- 재현: 채팅에 `지금 삼성전자 얼마야?` 입력 → 통합 카드의 `종목과 현재 시세` 그룹을 본다.
- 실제: `현재가 -251500`, `전일대비 -5500`으로 부호가 붙은 원시 키움 값이 그대로 나온다. SK하이닉스는 `현재가 -1597000`이었다. 키움의 선행 부호는 값의 부호가 아니라 기준가 대비 방향 표기다(`card-primitives.js` `priceMagnitude` 주석).
- 기대: 주가는 음수가 될 수 없다. 카드종 렌더러가 쓰는 `priceMagnitude`를 범용 facts grid도 똑같이 적용해야 한다.
- 영향: 투자 사용자가 가격 자체를 신뢰할 수 없다. 같은 카드 안에서 헤더는 `252,500`, 그리드는 `-251500`으로 서로 다른 현재가를 보여준다.
- 증거: `captures/2026-08-31/18-h8-card-renders-after-push-fix.png`, `captures/2026-08-31/19-h9-two-cards-verified-fix-missing-units.png`

## BETA-011 — 한 카드에 서로 다른 현재가 두 개가 라벨 없이 공존함

- 심각도: Major
- 상태: reproduced
- 표면: chat canvas / 통합 카드
- 실제: 상단 QuoteHeader는 실시간 체결로 갱신되고(09:52 `251,750` → `252,500` → `250,000`), 하단 facts grid는 REST 스냅샷에 고정된다(`-251500`). 어느 쪽이 실시간이고 어느 쪽이 스냅샷인지 표시가 없다.
- 기대: 실시간 값과 조회 시점 스냅샷을 구분해 라벨링하거나 한쪽으로 통일한다.
- 증거: `captures/2026-08-31/18-h8-card-renders-after-push-fix.png`, `captures/2026-08-31/19-h9-two-cards-verified-fix-missing-units.png`

## BETA-012 — 카드 헤더 가격·등락에 단위가 없음

- 심각도: Major
- 상태: reproduced (사용자 지적)
- 표면: chat canvas / `card-primitives.js` QuoteHeader·ChangeBadge
- 실제: 헤더가 `250,000  -2.72`, `1,598,500  -3.3`으로 나온다. `QuoteHeader`는 `formatNumeric(priceMagnitude(price))`만 넣어 `원`이 없고, `ChangeBadge`는 `String(value)`를 그대로 써서 등락률에 `%`가 없다.
- 기대: 가격에는 `원`, 등락률에는 `%`가 붙어야 한다. `-3.3`은 3.3원 하락으로도 읽혀 모호하다.
- 비고: `card-primitives.js`는 여러 카드종이 공유하므로 Paper 목업 확인 후 일괄 적용해야 한다.
- 증거: `captures/2026-08-31/19-h9-two-cards-verified-fix-missing-units.png`

## BETA-013 — 카드에 키움 원시 enum과 API 스펙 문구가 그대로 노출됨

- 심각도: Major
- 상태: reproduced
- 표면: chat canvas / 통합 카드 facts grid
- 실제: `전일 대비 기호: 5`와 범례 `1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락`가 그대로 보인다. 각 필드 설명도 `단위: 원, 부호가 포함된 숫자`, `부호 포함 소수점 둘째 자리까지 포맷된 백분율` 같은 API 스펙 문구다. `거래량 3752424`는 천단위 구분이 없다.
- 기대: `5`가 아니라 `하락`으로 렌더하고, 스펙 설명이 아니라 사용자 문구를 쓴다. 수량에 천단위 구분을 넣는다.
- 증거: `captures/2026-08-31/18-h8-card-renders-after-push-fix.png`

## BETA-014 — 오류 카드가 재시도를 안내하지만 재시도 컨트롤이 없음

- 심각도: Major
- 상태: reproduced
- 표면: chat / 오류 카드
- 재현: 백엔드가 없는 상태에서 질문을 제출한다.
- 실제: `조회 중 오류가 발생했습니다. 다시 시도할 수 있습니다.`와 `툴 실패 / fetch failed`, `카드 REST · 0.0s`가 보인다. 그러나 재시도 버튼이 없어 사용자는 질문을 다시 입력해야 한다. `fetch failed`는 내부 문자열이라 투자 사용자에게 원인을 알려주지 못한다.
- 기대: 문구가 재시도를 약속하면 같은 표면에 재시도 컨트롤이 있어야 하고, 원인은 `백엔드 연결 끊김`처럼 사용자 언어여야 한다.
- 증거: `captures/2026-08-31/16-h8-backend-lost-error-card.png`

## BETA-015 — 연결이 끊겨도 캔버스 빈 상태는 낙관적 문구를 유지함

- 심각도: Minor
- 상태: reproduced
- 표면: chat canvas 빈 상태
- 실제: 백엔드가 죽어 직전 질의가 `fetch failed`로 끝난 상태에서도 중앙 캔버스는 `지금 시장이 움직이고 있습니다 / 궁금한 종목을 물어보면 카드가 바로 쌓입니다`를 그대로 보여준다. 이 문구는 연결 상태와 무관하게 로컬 시각 기준으로만 바뀐다.
- 기대: 빈 상태 문구가 연결 건강도를 반영해야 한다.
- 증거: `captures/2026-08-31/16-h8-backend-lost-error-card.png`

## BETA-016 — MCP가 push 실패 본문을 버려 원인 진단이 불가능함

- 심각도: Major
- 상태: source-confirmed
- 표면: backend / athena_mcp
- 실제: `athena_mcp/canvas_data.py`가 `push_note = f"HTTP {push_response.status_code}"`로 상태 코드만 남기고 422 응답 본문(`code`/`detail`)을 버린다. 그래서 로그에도 UI에도 `GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN`이 전혀 나타나지 않았고, BETA-009를 찾으려면 엔드포인트를 직접 재현해야 했다.
- 기대: 실패 응답의 `code`/`detail`을 로그에 남긴다.
- 증거: `runtime/claude-backend-20260831-093713-stdout.log`

## BETA-017 — 플러그인 허브가 하드코딩 픽스처를 그리고, 실제 설치된 MCP 서버를 숨김

- 심각도: Critical
- 상태: source-confirmed + UI 실측
- 표면: 플러그인 허브 / `app/lib/plugin-canvas.js`, `app/canvas.js`
- 실제: 허브가 보여주는 8종은 전부 `plugin-canvas.js`의 `DEFAULT_INSTALLED`(2) / `DEFAULT_RECOMMENDED`(6) frozen 픽스처다. `canvas.js:2130`이 `createPluginCanvas({ container })`로 데이터도 콜백도 넘기지 않아 항상 이 기본값으로 폴백한다.
- 동시에 이 컴퓨터에는 **실제 MCP 서버 4개가 설치돼 있다**(`~/.athena/mcp_servers.json`): `dart-mcp`, `korea-stock-mcp`, `naver-search-2`, `naver-search`. 앞의 3개는 2026-08-31T00:50에 실제 핸드셰이크가 관측돼 `self_reported_server_info`까지 기록돼 있다.
- 그런데 허브에는 이 4개가 **하나도 나타나지 않고**, 설치된 적 없는 가짜 `DART 전자공시`가 `권한 초안`으로 떠 있다. 실제 설치된 `dart-mcp`를 가짜 DART가 가리는 형태다.
- 픽스처가 지어낸 출처 문자열: `marketplace · athena-official`, `로컬 폴더`, `github.com/daou/athena-plugins · 업그레이드 가능`. 존재를 확인할 수 없는 출처를 사실처럼 표기한다.
- 근본 원인: `canvas.js:2128` 주석이 "실제 플러그인 실행 IPC는 아직 없으므로"라고 적혀 있으나 **이미 낡았다**. `main.js:3408-3414`에 `athena:mcp-list`/`stage-snippet`/`register`/`approve`/`probe`/`allow-tool`/`remove` 7개 핸들러가 살아 있고 `mcpCli`가 `backend/athena_mcp` CLI를 감싸는 완전한 설치 파이프라인을 제공한다.
- 기대: 허브의 "설치됨"은 `athena:mcp-list` 결과여야 하고, 설치는 `stage-snippet → register → approve → probe`, 기능 허용은 `allow-tool`, 삭제는 `remove`로 이어져야 한다. 픽스처는 제거한다.
- 증거: `captures/2026-08-31/20-h11-plugin-hub.png`, `captures/2026-08-31/22-h11-plugin-dart-permission-draft.png`, `~/.athena/mcp_servers.json`

## BETA-018 — 초안 상태 배지가 화면에서 가장 강한 CTA로 보임

- 심각도: Major
- 상태: reproduced (사용자 지적)
- 표면: 플러그인 허브
- 실제: `권한 초안` 배지가 채워진 마젠타 필로 렌더돼, 아직 손대지 않은 항목의 `설치 미리보기`(조용한 외곽선 버튼)보다 훨씬 강하게 보인다. 문구는 "UI 세션 초안 · 실제 런타임은 연결되지 않았습니다"로 정직하지만 시각 위계가 그 정직함을 뒤집어 "설치됨/활성"으로 읽힌다.
- 기대: 초안·미연결 상태는 중립 톤으로, 강조색은 실제 활성 상태에만 쓴다.
- 증거: `captures/2026-08-31/20-h11-plugin-hub.png`

## BETA-019 — 설정의 "MCP 서버" 카드는 제거 대상 잔재

- 심각도: Major
- 상태: 사용자 확인
- 표면: 설정 → MCP 서버 (`app/lib/settings-cards.js:189`)
- 실제: 플러그인 도입 이전의 설치 표면이 설정에 그대로 남아 있어, 실제 설치 경로(설정)와 사용자가 설치할 것이라 기대하는 경로(플러그인)가 갈라져 있다.
- 기대: 플러그인 허브가 MCP 설치를 흡수한 뒤 이 카드를 제거한다.
- 순서 주의: 허브 배선보다 카드 제거가 먼저 오면 동작하는 설치 UI가 하나도 남지 않는다. 반드시 허브 배선 → 카드 제거 순서로 진행한다.

## BETA-020 — 설치 미리보기가 기능별 허용을 제공하지 않음

- 심각도: Minor
- 상태: reproduced
- 표면: 플러그인 설치 미리보기 모달
- 실제: 허브 문구는 "플러그인은 설치 후 기능별로 허용합니다"인데, 설치 미리보기의 요청 기능 3행에 붙은 `요청` 배지는 토글이 아니라 정적 라벨이고 승인은 `세션 반영` 하나로 전부 아니면 전무다. 기능별 토글은 설치 이후 권한 상세 화면에서야 나타난다.
- 기대: 승인 시점에 기능별 선택을 제공하거나, 문구를 실제 동작에 맞춘다.
- 증거: `captures/2026-08-31/21-h11-plugin-install-preview-earnings-calendar.png`

### BETA-017 수정 (2026-08-31 12:32 KST)

- 변경 파일: `app/canvas.js`, `app/lib/plugin-canvas.js`, `app/styles/plugin-canvas.css`
- `canvas.js`: 플러그인 캔버스를 `athena:mcp-list`/`mcp-probe`/`mcp-allow-tool`에 실제로 연결했다. 목록·도구·허용 상태가 전부 `backend/athena_mcp` CLI에서 온다. probe는 upstream 서버를 실제로 spawn하므로 권한 화면을 연 서버 하나만 부르고 결과를 캐시한다.
- `plugin-canvas.js`: 마운트 뒤 목록을 갈아끼우는 `setData()`를 추가했다(기존에는 생성 시 1회 캡처라 등록·승인·삭제 후에도 옛 목록이 남았다). 하드코딩 상수는 `DEFAULT_*` → `SAMPLE_*`로 바꾸고 단위테스트 전용임을 명시했다 — 실제 셸은 언제나 명시적으로 배열을 넘기므로 앱에 샘플이 뜨는 경로가 없다.
- 문구 정정: `UI 세션 초안` → `등록된 서버`, `권한 초안` → `도구 허용`, 허브 설명을 "플러그인은 MCP 서버입니다"로 교체. 카드에 연결·승인 상태 한 줄(`plugin-canvas-card-source`)을 추가했다.
- 실측 결과: 허브가 `dart-mcp`, `korea-stock-mcp`, `naver-search-2`, `naver-search` 4종을 실제 실행 커맨드와 함께 표시한다. 앞의 3종은 `연결 확인됨`, `naver-search`는 `승인 대기 — 도구가 아직 허용되지 않았다`로 정직하게 구분된다.
- 회귀: `node --test lib/plugin-canvas.test.js` 12 passed / 0 failed.
- 남은 작업: 스니펫 붙여넣기 설치 입구가 허브에 아직 없다(설치는 현재 설정 → MCP 서버에서만 가능). 그 입구가 생기기 전에는 BETA-019(설정 카드 제거)를 진행하면 안 된다.
- 증거: `captures/2026-08-31/23-h12-plugin-hub-real-mcp-servers.png`, `captures/2026-08-31/24-h12-plugin-hub-real-status-labels.png`

### BETA-017 후속 — 허브에 MCP 서버 추가(스니펫) 경로 구현 (2026-08-31 12:40 KST)

- 변경 파일: `app/lib/plugin-canvas.js`, `app/canvas.js`, `app/styles/plugin-canvas.css`
- 허브 헤더에 `+ 서버 추가`를 넣고, Claude 커넥터와 같은 순서를 구현했다: 스니펫 붙여넣기 → `분석`(athena:mcp-stage-snippet) → 등록될 서버 확인 → `승인`(mcp-register → mcp-approve → mcp-probe) → 도구별 허용.
- 비밀값 경계: staged 화면은 `envKeys`(키 이름)만 렌더한다. `mcp-cli.js`가 값을 아예 돌려주지 않고, 값은 `__ATHENA_SAFESTORAGE__`로 치환돼 있다. 화면·로그 어디에도 평문이 남지 않는다.
- 취소 되돌리기: `stage-snippet`은 미리보기가 아니라 실제 등록까지 수행한다(파이썬 백엔드에 dry-run 없음, `mcp-cli.js` 주석). 그래서 승인 없이 닫으면 미승인 서버가 남는다 — `onDiscardStaged`가 `athena:mcp-remove`로 되돌리도록 했다.
- 실측 검증 (naver-search-probe, 이미 존재가 확인된 패키지로 왕복):
  - 분석 전 레지스트리 4개 → 분석 후 5개(`naver-search-probe` 추가), `consent.approved = False`로 spawn 차단 확인
  - staged 화면에 `npx -y @isnow890/naver-search-mcp`와 `환경변수 키: NCP_APIGW_API_KEY_ID, NCP_APIGW_API_KEY`만 표시(값 없음)
  - `취소` 후 레지스트리 4개로 복귀, `naver-search-probe` 제거 확인 — 취소가 흔적을 남기지 않는다
- 회귀: `node --test lib/plugin-canvas.test.js` 12 passed / 0 failed.
- 미검증: `승인` 경로는 실제로 upstream 서버를 spawn하므로 이번 왕복에서는 실행하지 않았다(제3자 패키지 실행). 도구 목록 렌더·`allow-tool` 반영은 아직 실측 전이다.
- 증거: `captures/2026-08-31/25-h12-plugin-add-server-staged.png`

### 플러그인 설치 실측 — MCP 서버 10종 설치·도구 허용 (2026-08-31 12:57 KST)

허브의 `+ 서버 추가` 경로로만, npm 레지스트리에서 실재를 확인한 패키지 10종을 5개씩 두 배치로 설치했다. 키움 관련 서버는 사용자 지시로 전부 제외했다(Athena 내장과 중복·실계좌 접촉).

설치 결과 (총 14개, 기존 4 + 신규 10):

| alias | 패키지 | 핸드셰이크 |
|---|---|---|
| korea-stock-analyzer | @mrbaeksang/korea-stock-analyzer-mcp | OK korean-stock-analysis v1.1.1 |
| tradingview-screener | tradingview-mcp-server | OK v0.7.1 |
| sec-edgar | edgar-mcp | OK edgar_mcp v1.29.1 |
| openinsider | openinsider-mcp | OK v0.3.0 |
| fred-economic | fred-mcp-server | OK fred v1.2.0 |
| pairbook-risk | pairbook-mcp | OK pairbook v1.3.1 |
| fx-finance | @easysolutions906/mcp-finance | OK mcp-finance v1.0.0 |
| finance-data | finance-data-mcp | OK finance-mcp v0.1.0 |
| yahoo-finance | yahoo-finance-mcp-server | 실패 — 핸드셰이크 없음 |
| financial-hub | financial-hub-mcp | 실패 — 핸드셰이크 없음 |

- 다중 서버 스니펫: 한 스니펫에 5개를 담아도 staged 목록에 5개가 모두 뜨고 순차 등록·승인된다.
- 도구 목록: `sec-edgar` 권한 화면이 probe로 가져온 실제 도구 6종(`search_company`, `get_recent_filings`, `get_latest_filing`, `get_company_facts`, `get_concept`, `full_text_search`)을 서버가 노출한 설명 그대로 보여준다.
- 도구 허용 영속 확인: 3개를 켜고 저장 → `consent.json`의 `sec-edgar.approved_tools = [get_company_facts, get_recent_filings, search_company]`. 켠 것과 정확히 일치한다.

## BETA-021 — 도구 허용 화면의 허용 수가 토글에 반응하지 않음

- 심각도: Minor
- 상태: reproduced
- 표면: 플러그인 권한 상세 (`app/lib/plugin-canvas.js` `sheetFeatureRow`)
- 실제: 토글 3개를 켰는데 하단 카운트가 `허용 0 / 6` 그대로였다. 헤더의 `허용 N` 배지도 같다. 저장 자체는 정상이라 표시만 어긋난다.
- 기대: 토글 변경 시 카운트를 다시 계산해 렌더한다.

## BETA-022 — 실제 MCP 서버 화면에 "UI 초안" 배지가 그대로 남음

- 심각도: Minor
- 상태: reproduced
- 표면: 플러그인 권한 상세 헤더
- 실제: `sec-edgar`처럼 실제로 등록·승인·핸드셰이크까지 끝난 서버의 권한 화면에도 헤더 배지가 `UI 초안`으로 뜬다. 허브 배선 전의 문구가 이 화면에만 남았다.
- 기대: 실제 연결 상태(연결 확인됨/승인 대기)를 표시한다.

## BETA-023 — 설치한 플러그인이 진행 중인 대화에 즉시 반영되지 않음

- 심각도: Major
- 상태: source-confirmed
- 표면: `app/lib/main/mcp-config.js`, `athena_mcp/runner.py`
- 구조: 채팅 세션은 `--mcp-config .mcp.json --strict-mcp-config`로 뜨고, 그 파일에는 `athena` 게이트웨이 하나만 들어간다. 게이트웨이(`GatewayRunner`)가 "레지스트리에서 읽어 승인된 서버를 붙이고" 상위 도구를 프록시하는 설계라 이 구성 자체는 맞다.
- 문제: 게이트웨이는 기동 시점에 레지스트리를 읽는다. 앱 실행 중에 서버를 설치·승인해도 이미 떠 있는 세션의 게이트웨이는 그 서버를 모른다. 사용자에게는 "설치했는데 대화에서 안 쓰인다"로 보인다.
- 기대: 설치·승인 후 재시작이 필요하면 화면에서 명시하거나, 게이트웨이가 레지스트리 변경을 다시 읽게 한다.
- 미검증: 재시작 후 실제 대화에서 허용 도구가 호출되는지는 아직 확인하지 않았다.

### 플러그인 배관 엔드투엔드 검증 완료 (2026-08-31 13:09 KST)

재시작 후 대화에서 실제 호출을 확인했다.

- 질문: "애플 AAPL이 SEC에 최근에 올린 공시 상위 3개만 알려줘."
- 진행 표시: `21초 동안 작업함` (접힌 도구 작업 고지)
- 응답: Form 4 3건을 **실제 제출일·거래일과 함께** 반환 — 2026-08-27(거래 08-25), 2026-08-20(거래 08-18), 2026-08-13(거래 08-11). 푸터 `claude -p · 7.6s`.
- 판정: 이 날짜들은 모델이 학습으로 알 수 없다. 허용한 `sec-edgar.get_recent_filings`가 게이트웨이를 통해 실제 호출된 증거다.
- 이로써 전체 사슬이 입증됐다: 스니펫 붙여넣기 → 등록 → 승인 → probe → 도구별 허용 → consent 영속 → 게이트웨이 → 대화에서 호출.
- 증거: `captures/2026-08-31/27-h13-mcp-tool-used-in-chat-sec-edgar.png`

### BETA-021·022·023 수정 (2026-08-31 13:05 KST)

- BETA-021 근본 원인: `findAllowedCountLabel`이 `current.children.forEach(...)`를 썼는데 실제 DOM에서 `children`은 HTMLCollection이라 `forEach`가 없다. 단위테스트의 가짜 DOM만 배열이어서 통과했고 앱에서만 예외가 나 카운트가 멈췄다. 인덱스 순회로 고치고, 하단 카운트와 헤더 배지를 함께 갱신하는 `refreshAllowedCounts()`로 묶었다.
- BETA-022: 권한 화면 헤더의 고정 `UI 초안` 배지를 호스트가 넣어준 실제 연결 상태(`연결 확인됨` 등)로 교체했다. 토글 aria-label의 "UI 초안" 문구도 "허용 켜기/끄기"로 바꿨다.
- BETA-023: 이번 세션에서 승인·도구허용·삭제가 있었으면 허브에 "이번에 바꾼 서버는 Athena를 다시 시작한 뒤의 대화부터 적용됩니다"를 표시한다(`restartRequired`). 게이트웨이가 기동 시점에만 레지스트리를 읽는 사실을 숨기지 않는다.
- 회귀: `node --test lib/plugin-canvas.test.js` 12 passed / 0 failed.

## BETA-024 — 플러그인 도구 응답이 캔버스 카드로 그려지지 않음

- 심각도: Major
- 상태: reproduced
- 표면: chat canvas
- 실제: `sec-edgar` 결과가 우측 좁은 대화 열에 텍스트로만 나오고, 중앙 캔버스는 그대로 `무엇이든 물어보세요 / 질문하면 답변 카드가 이 자리에 쌓입니다`로 비어 있다. 캔버스 카드는 Kiwoom·athena 내장 경로에서만 생성된다.
- 영향: 화면의 대부분(중앙 캔버스)이 비어 있는 채로 답이 폭 200px 남짓 열에 몰린다. BETA-007이 플러그인 응답에서도 반복된다.
- 기대: 플러그인 도구 결과도 캔버스 카드로 승격하거나, 카드가 없는 답변일 때 중앙 캔버스 문구가 그 사실을 반영해야 한다.
- 증거: `captures/2026-08-31/27-h13-mcp-tool-used-in-chat-sec-edgar.png`

### 채팅 렌더링·@멘션 구현과 3슬리브 실측 (2026-08-31 13:41~13:46 KST)

사용자 지적 2건(도구 호출이 안 보임 / **마크다운이 기호 그대로 노출 + 본문 블러**)을 고치고, @ 플러그인 멘션을 구현한 뒤 국장·거시·환율 3측을 실측했다.

구현 (app/lib/chat-markdown.js 신규, app/chat.js, app/chat.css, app/shell.html):
- 마크다운 렌더러: 문단·#제목·목록·```코드·**굵게**·`인라인` 지원. innerHTML 미사용(모델 응답은 비신뢰 입력), 스트리밍 조각마다 전체 재렌더.
- 본문 블러 수정: `.turn-a`의 `text-shadow 0 1px 6px rgba(0,0,0,.6)`이 원인("블러된 느낌") → `0 1px 1px rgba(0,0,0,.28)`.
- 도구 호출 칩: `.progress-tool-step`를 테두리 블록으로, 실행 기록 기본 펼침(접기는 클릭).
- @멘션: 입력란에서 @ 입력 시 승인된 MCP 서버 목록 드롭다운(방향키/Tab/Enter/Esc/클릭), 제출 시 실제 등록 서버명일 때만 "이 서버의 도구를 우선 사용하라" 지시를 동봉. 사용자 버블에는 타이핑 원문 유지.

실측 3턴 (전부 @멘션 사용):
1. 국장 `@korea-stock-analyzer` 삼성전자 가치투자 질문 → **ATHENA 로컬 선택기가 가로채** 키움 카드(1.2s, mock)로 응답. 멘션 지시가 로컬 분류기 경로에서는 무시됨 → BETA-025.
2. 거시 `@fred-economic` 기준금리·CPI → claude 경로 진입, **도구 칩 2개(실패)** 표시. FRED_API_KEY 미설정 실패를 숨기지 않고 해결법 안내 후 "학습 기준(2025년 2월), 최신치 아님"을 명시하고 폴백. provenance: cache(model knowledge), 정직 고지.
3. 환율 `@fx-finance` 원달러 → **실제 외부 환율 반환**: 1,374.55(2026-08-28), 1년 전 1,391.54, 6개월 전 최고 1,441.97. 성공 칩 3개(1.4/1.3/2.3s), `claude -p · 56.5s`. 모델 지식 밖 값 — 외부 API 실호출 입증. provenance: **live**(외부 환율 API). 페르소나(매달 적립) 맞춤 평가까지 마크다운으로 완전 렌더.

## BETA-025 — @멘션 지시가 로컬 선택기 경로에서 무시됨

- 심각도: Minor
- 상태: reproduced
- 표면: selector dispatch
- 실제: `@korea-stock-analyzer`를 지정해도 질문이 시세 패턴에 걸리면 로컬 선택기가 키움 REST 카드로 즉답하고 지정 서버는 호출되지 않는다. 빠른 경로 자체는 미덕이지만, 사용자가 명시 지정한 플러그인이 조용히 무시된다.
- 기대: 멘션이 있으면 로컬 가로채기를 건너뛰고 claude 경로로 보내거나, 카드 응답에 "지정 플러그인 대신 내장 시세로 답함"을 밝힌다.
- 증거: `captures/2026-08-31/28-h14-mention-kr-local-selector-card.png`

## BETA-026 — fred-economic 서버에 FRED_API_KEY가 미설정

- 심각도: Observation
- 상태: confirmed
- 실제: `fred-mcp-server`는 키 없이 설치·핸드셰이크까지 되지만 실조회에는 FRED API 키가 필요하다. 설치 시 요구 환경변수를 알 수 없었다(스니펫에 env 없음). 응답이 해결법(무료 키 발급 URL)을 정확히 안내했다.
- 기대: probe 시 도구 실행까지는 못 가더라도, 서버가 요구하는 env 키를 허브 카드에 노출하면 설치 직후 실패를 줄인다.
- 증거: `captures/2026-08-31/29-h14-mention-fred-toolchips-markdown-honest-fail.png`

### 채팅 렌더 후속 수정 3건 (2026-08-31 14:02 KST, 사용자 지적)

- 본문 그림자 전면 제거: 줄인 `text-shadow`(0 1px 1px)도 블러 체감이 남아 `.turn-a`에서 완전히 제거했다(사용자 확정). 실측 또렷함 확인.
- 번호 리셋 수정: 번호 항목 사이에 하위 불릿이 오면 목록이 UL로 끊겼다가 새 OL이 시작돼 번호가 매번 1로 리셋됐다. (1) 들여쓴 항목(공백 2+)은 직전 항목의 하위 목록으로 중첩하고, (2) 원문 번호를 `li.value`로 보존해 목록이 끊겨도 번호가 이어지게 했다. 스모크 테스트: 중첩 케이스 OL 1개·값 1,2,3 / 평탄 케이스 값 1,2 통과. 실앱 실측: `미장 ETF 적립식 체크리스트` 3항목이 1→2→3 연속 + 하위 불릿 2개씩 정상 중첩.
- 서브에이전트 알약 칩: 행 목록(`result-dock-agent-row`)을 Claude 데스크톱형 알약 칩으로 교체 — [아이콘+이름] 칩 가로 배치, 3개 초과 시 "및 다른 서브에이전트 N개 …" 접기, 작업 중/완료 줄 분리, 글리프 5종 색상 로테이션. **시각 실측은 보류**: 이 UI는 모델이 Task 하위 에이전트를 실제로 띄우는 턴에서만 나타나며 이번 검증 턴들에서는 발생하지 않았다.
- 변경 파일: `app/lib/chat-markdown.js`, `app/chat.js`, `app/chat.css`
- 증거: `captures/2026-08-31/31-h15-list-nesting-numbering-no-shadow.png`

### 마크다운 시스템 통합·음영 전면 제거·서브에이전트 기록 줄 (2026-08-31 14:18 KST, 사용자 지적)

- **음영 잔존의 진짜 원인**: `.turn-a`를 고쳤는데도 문단에 음영이 남은 이유는 `canvas.css`의 **전역 `.md-p` 규칙**(6px 각인 그림자)이었다. 앱에 이미 마크다운 렌더러(`lib/markdown.js`, 리더 캔버스용)가 있었는데 그걸 모르고 채팅용을 별도로 만들면서 클래스가 충돌해 캔버스 쪽 음영이 채팅에 새어 들어온 것. 표면별 렌더러를 따로 만들면 안 된다는 사용자 직감("내부 시스템 자체에 들어가야")이 정확했다.
- **통합**: `lib/markdown.js`를 유일한 시스템 마크다운 렌더러로 업그레이드 — 기존 표 지원 유지 + 굵게/인라인코드/1.목록(원문 번호 보존)/들여쓰기 중첩/```코드블록/#~#### 추가. `lib/chat-markdown.js`는 삭제하고 채팅 3개 렌더 지점을 `AthenaLib.Markdown.render`로 교체. 클래스는 양쪽 계약을 겸용(`md-list md-ol` 등).
- **음영 전면 제거**: canvas.css의 각인 text-shadow 5곳(.card-title/.facts-value/.stream-title/.md-p/.fin-table th·td)과 chat.css 큰 숫자 1곳 모두 제거(사용자 확정 "음영 넣지 말라").
- **서브에이전트 기록 줄**: 도크 실시간 알약에 더해, 시작·완료 전이를 500ms 배치로 묶어 실행 기록(toolSteps) 안에 "[알약…] 작업을 시작했습니다 / 완료됨" 줄로 남긴다 — Codex와 같은 형태로 턴이 끝나도 기록이 남는다. **시각 실측은 여전히 보류**(하위 에이전트를 실제로 띄우는 턴 미발생).
- 실측: "한국 대형주 중기 운용 체크리스트" — 제목·1→2→3 연속 번호·하위 불릿 중첩·음영 없음 확인. 스모크: 중첩+표+코드블록 혼합 케이스 통과.
- 변경 파일: `app/lib/markdown.js`, `app/chat.js`, `app/chat.css`, `app/canvas.css`, `app/shell.html` (+ `app/lib/chat-markdown.js` 삭제)
- 증거: `captures/2026-08-31/32-h15-unified-markdown-no-shadow-final.png`

### 답변 서식 자율화 (2026-08-31 14:27 KST, 사용자 지적)

- 문제: "번호 목록으로, 하위 불릿 2개씩" 같은 서식 지시를 사용자가 매번 해야 목록이 나왔다. 서식은 시스템이 알아서 할 일이다.
- 수정: `app/lib/main/live-prompt.js` 시스템 규칙에 답변 서식 절을 추가 — 항목 3개 이상/순서 있는 내용은 스스로 번호 목록, 병렬 나열은 불릿, 세부 근거는 들여쓴 하위 불릿, 제목·핵심 수치는 굵게. 렌더러(lib/markdown.js)가 지원하는 부분집합만 쓰고 링크·이미지·인용블록은 금지(렌더 안 됨). 단답에는 목록 강제 금지.
- 회귀: `node --test lib/main/live-prompt.test.js` 22 passed / 0 failed.
- 실측: 서식 지시 없는 맨 질문 "한국 대형주 중기 운용 체크리스트 3가지 정리해줘" → 제목 + 번호 1·2·3(굵은 항목명) + 각 항목 하위 불릿 3개 + 마무리 문단으로 자발 조직 (`claude -p · 11.0s`).
- 증거: `captures/2026-08-31/33-h15-spontaneous-formatting.png`

### 채팅 하단 UI 재설계 + 턴 정지 결함 수정 (2026-08-31 15:22 KST, 사용자 지적)

**요청 반영**
- 트레이스 푸터 제거: `claude -p · 11.0s` 같은 처리경로·소요시간 표기를 3개 렌더 지점에서 모두 삭제하고 `resultSourceLabel()`도 제거(내부 진단 정보 — 실행 기록이 이미 세부를 갖는다).
- 도구 기록을 코덱스형 알약으로: `.progress-tool-steps`를 세로 전폭 목록 → 가로 flex-wrap 흐름으로, `.progress-tool-step`을 사각 박스 → 알약(border-radius 999px, 원형 색점, 성공 초록/실패 주황)으로 교체.
- 잠금 중 placeholder 숨김: 입력이 min-width:0으로 눌리며 "무엇이든 물어보세요"가 "무엇이"로 잘려 힌트 옆에 남았다 → 답변 중에는 placeholder를 비운다.
- 진행 힌트 재설계: mono 한 문자열 + flex-shrink:0이라 긴 문구가 하드 클리핑됐다 → 상태문구(말줄임 가능)·시간(mono, tabular)·ESC 칩(둥근, 불변)으로 3분할.

**BETA-027 — 대화기록 저장 실패가 턴 전체를 얼림 (Critical, 수정됨)**
- 증상: 질의 후 타이머가 13.4s에 멈추고 잠금이 영구 지속. Esc·클릭 모두 무반응.
- 원인: `ATHENA_CHAT_HISTORY_DB_PATH` 미설정 환경에서 `historySink.saveChatMessage`가 `TypeError: chat history dbPath is required`를 **동기 throw** → `athena__render_canvas` 핸들러 전체가 reject → 렌더러에 `catch`가 없어 `await`가 영원히 미완결.
- 수정 3겹: (1) `history-sink.js` saveChatMessage를 try/catch로 감싸 fire-and-forget 계약 복원(실패는 기존 onSaveFailed 배지로만), (2) `chat.js` invoke에 catch 추가 — 핸들러 reject를 실패 턴으로 정직하게 렌더, (3) 재기동 스크립트가 `ATHENA_CHAT_HISTORY_DB_PATH`(APPDATA\athena-shell\chat-history.sqlite3)를 주입.
- 회귀: `node --test lib/main/history-sink.test.js` 19 passed / 0 failed.
- 실측: 같은 질의가 79초에 완주하고 알약 칩 11개(성공 3·실패 8)와 정직한 실패 설명까지 정상 렌더.

**운영 도구 추가** — `restart-stack.ps1`(backend 조건부 기동 + 앱 재시작 + env 주입), `focus-athena.ps1`(AttachThreadInput으로 지정 PID 창만 전면화). 다른 작업 소유의 Athena 인스턴스가 앞으로 올라와 입력이 그쪽으로 새는 사고가 있어 PID 지정 포커스가 필요해졌다.
- 증거: `captures/2026-08-31/34-h16-codex-style-tool-pills-and-hint.png`
