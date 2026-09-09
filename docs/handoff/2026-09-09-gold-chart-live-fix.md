# 금현물 카드 실제 차트·자동 조회 수정

사용자가 보고한 금현물 화면은 시세 숫자를 일부 조회하면서도 차트 영역에는 Paper의 고정 캔들을 남겼다. 금현물 보드 `2RJ7-1`의 primary renderer가 연결되지 않았고, 데이터가 없거나 차트 마운트가 실패한 경우에도 목업을 유지·복원했다. 원격 시세 공급 자체는 정상으로, 기존 앱 백엔드에서 금현물 당일 분봉과 최신 체결 응답을 확인했다.

`ka50092` 금현물 당일 분봉을 기존 인증된 board-hydrate 경로에서 조회하고 검증된 `primary_envelope`로 전달한다. main은 이 차트의 실제 operation/arguments/chart metadata에 맞춰 재조회 권위를 등록한다. 금현물 카드만 15초마다 읽기 전용 조회를 수행하고, 차트와 헤더 현재가·체결 시각·전일 대비를 함께 갱신한다. 선택한 분 간격을 유지하며 비활성·제거된 카드에서는 조회하지 않는다. 실패 시 디자인용 캔들을 복원하지 않고 오류·재시도 상태를 표시한다.

국제 금 환산 `0I` 피드가 국내 금현물 시세를 덮어쓰지 못하도록 차단했다. 전일 대비 금액을 퍼센트로 해석하던 오류, 가격의 Kiwoom 방향 부호, 전일 종가에 현재가를 대체하던 오류를 수정했다. 출처 없는 52주 범위·국내 대비·기준일·기간은 미제공으로 표시한다. 14자리 체결 시각에는 날짜를 보존한다.

## 변경 범위

- 앱: `app/canvas.js`, `app/main.js`, `app/preload.js`, `app/lib/aits-chart-panel.js`, `app/lib/board-format.js`, `app/lib/board-mount.js`, `app/lib/main/board-hydrate.js`, `app/lib/main/chart-reload.js` 및 관련 테스트.
- 백엔드: `backend/athena_api/api/canvas_push.py`, `backend/tests/api/test_canvas_push.py`.
- 카드 계약: `backend/ref/card-surface-templates/2RJ7-1/slots.json`, 재생성된 CC-03/index 파일.
- 검증: `app/lib/gold-chart-refresh.test.js`, `app/probe-gold-chart-live.js`.

## 검증 근거

- Node 관련 회귀 테스트 237/237 통과. 별도 board-format 테스트 22/22 통과.
- Python `test_canvas_push.py`와 `test_canvas_render_plan.py` 116/116 통과. 이 중 root가 추가한 금현물 hydrate 3개 사례를 포함한 `test_canvas_push.py` 63/63 통과.
- 실제 canvas 소스를 실행하고 실제 AITS 어댑터를 사용하는 자동 갱신 테스트 4/4 통과: 연속 두 번 갱신, 5분 간격 보존, 현재가·체결 시각·하락 부호 동기화, 비활성/제거 시 중단, 조회 실패 후 재시도, 비금현물 제외.
- 실제 Electron 검증: 2026-09-09 14:42 KST, 앱 백엔드 8010의 board-hydrate에서 금현물 분봉 240개 수신. 제품의 15초 타이머가 실제 조회 IPC를 실행했고, 갱신된 종가 189560과 헤더 현재가 189560이 일치했다. 이는 검증 시점의 값이며 현재 가격을 보증하는 값이 아니다.
- 화면: AITS canvas 11개, 보이는 목업 자식 0개, 렌더 오류 0개, `primary_error=null`. 마지막 갱신 표시 `15초마다 조회 · 마지막 갱신 14:42:35`.
- 증거: `app/captures/gold-chart-live/GOLD-CHART-LIVE.json`, `app/captures/gold-chart-live/GOLD-CHART-LIVE.png`.
- 구문 검사와 `git diff --check` 통과. 주문 실행 없음.
- 최종 독립 리뷰 APPROVE: 금현물 소유범위에서 지적사항 0건. 리뷰어의 최신 별도 실행 Node 225/225, backend canvas_push 63/63 및 구문·diff 검사 통과. 동시 작업의 provider/backtest/order 변경은 리뷰 범위에서 제외했다.

## 경계와 남은 정리

실제 화면 검증은 별도의 검증용 창/프로필에서 수행했다. 이미 열려 있는 사용자 창의 DOM을 강제로 다시 로드하지 않았다. 기존 카드가 이전 렌더러를 유지한다면 앱을 다시 실행해 새 코드를 로드해야 한다.

시작 전부터 있던 semantic workspace 검사·readiness·기존 handoff 변경은 보존했다. 별도 검증 서버 8011은 모두 종료했다. 검증용 임시 프로필 16개는 Windows 파일 잠금 뒤 재귀 삭제가 자동 정책에 의해 거부되어 남아 있다. 실제 사용자 프로필은 변경하지 않았으며, 정리를 위해 정책을 우회하지 않았다.
