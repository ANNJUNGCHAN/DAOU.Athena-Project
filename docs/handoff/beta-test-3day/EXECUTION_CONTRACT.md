# Athena beta continuation contract

> 이 파일은 원래 `artifacts/claude-code-handoff-2026-08-31/CLAUDE.md`였다. git으로 옮기면서
> **일반 개발 세션에 자동 주입되지 않도록** 이름을 바꿨다 — 아래 "소스 코드를 수정하지 않는다"는
> **3일 베타테스트 작업에만** 적용되는 계약이지, 이 저장소 전체의 규칙이 아니다.
> 베타테스트를 이어받을 때만 이 계약을 적용한다. 경로 대응표는 [README.md](./README.md).

이 파일은 이 handoff 폴더에서 수행하는 Claude Code 작업의 로컬 계약이다. 저장소 루트의 `CLAUDE.md`와 `AGENTS.md`도 적용한다. 루트 `AGENTS.md`가 참조하는 `RTK.md`는 handoff 생성 시점에 저장소에서 발견되지 않았다.

먼저 `ORIGINAL_OBJECTIVE.md`를 읽고 그 목표를 그대로 보존한다.

## 임무

사용자의 실제 투자 성향을 반영해 Athena 데스크톱 앱을 최소 72시간 동안 한 시간 단위로 실제 사용하고, 채팅·그래프·알림/루틴·플러그인 경로의 유용성, 신뢰성, 복구성, 상태 지속성을 화면 증거로 검증한다.

사용자 성향:

- 단기 운용 시드 1,000만원
- 약 한 시간 간격으로 확인하며 과도한 매매는 피함
- 월 목표수익 약 200만원이지만 무리한 수익 추구 금지
- 장기 운용 5,000만원~1억원
- 미국 시장은 ETF 중심 장기 적립식
- 한국 시장은 대형주와 ETF 중심 중기 운용
- 적립식이라도 투자 논리가 훼손되면 전술적 비중 축소를 검토

## 진실의 우선순위

1. 현재 실행 중인 프로세스, 포트, 창, 최신 Orca 접근성 스냅샷과 화면
2. `C:\Projects\DAOU.Athena\artifacts\beta-test-3day`의 원본 manifest, 일자별 로그, 이슈 원장, 캡처와 runtime 로그
3. 이 폴더의 `HANDOFF_STATE.json` 스냅샷
4. 과거 대화나 기존 PID/창 ID

과거 PID, 창 ID, 테스트 결과, fixture 캡처를 현재 상태로 재사용하지 않는다.

## 인계 시점의 검증된 상태

- Git HEAD: `b4a46c00d334fad6eb1982736f4cc62e38392cd2`
- branch: `main`
- dirty/untracked entry: 56개. 대부분 기존 사용자/다른 작업의 변경이므로 보존한다.
- 실질 세션 1회, 자연어 질문 4개, 성공 2개, 조용한 실패 2개, 화면 캡처 14개
- Athena Electron 실행 안 됨
- Athena backend 실행 안 됨
- TCP 8010 listener 없음
- Kiwoom mock API 확인됨
- Kiwoom production broker/live market data 미확인
- 3일 목표 미완료

Claude는 첫 행동으로 `preflight.ps1`을 실행하고 이 상태를 새 사실로 교체해야 한다.

## 매 시간 세션 절차

1. 현재 KST 시각과 직전 일자별 로그를 확인한다.
2. `git status --short --branch`를 읽고 기존 변경을 보존한다.
3. Athena Electron, backend command line, 8010 listener, Orca runtime을 다시 확인한다.
4. 필요하면 `RUNBOOK.md`에 따라 backend를 먼저 준비하고 Athena를 실행한다.
5. Orca에서 최신 `list-apps`와 `get-app-state`를 받아 실제 Athena 창을 식별한다.
6. 최소 한 개의 자연스러운 투자 질문을 실제 입력란에 입력하고 제출한다.
7. 후속 질문 또는 채팅·그래프·알림/루틴 초안·플러그인 미리보기 중 하나의 기능 전환을 수행한다.
8. 로딩, 성공, 오류, 빈 상태, 탐색 마찰, 문구, 데이터 기준 시점, 상태 지속성을 관찰한다.
9. 실제 화면을 캡처하고 고정 경로로 복사한 뒤 SHA-256을 기록한다.
10. 일자별 로그, screenshot manifest, 통합 이슈 원장, beta manifest의 카운트를 증거와 함께 갱신한다.

매 상호작용 전에 새 접근성 스냅샷을 받는다. 이전 element index를 재사용하지 않는다.

## Computer-use 계약

Orca 실행 파일:

`C:\Users\USER\AppData\Local\Programs\orca\resources\bin\orca.exe`

앱 이름은 과거 세션에서 `electron`, 창 제목은 `Athena`였다. `--app Athena`가 Visual Studio Code 창을 잘못 선택한 적이 있으므로 항상 `list-apps`와 창 제목/PID를 먼저 확인한다.

접근성 트리와 스타일 문자열만으로 시각 결과를 확정하지 않는다. 실제 screenshot을 보존한다.

## 데이터 출처 분류

모든 관찰을 다음 중 하나로 기록한다.

- `live`: 현재 production 연결이 별도 증거로 확인됨
- `mock`: mock API 응답
- `cache`: 저장된 캐시 또는 과거 응답
- `fixture`: 코드에 고정된 샘플/데모
- `UI draft`: 런타임에 저장되지 않은 UI 세션 초안
- `unknown`: 출처를 입증할 수 없음

local HTTP 200이나 WebSocket 연결만으로 production broker/live market data를 입증했다고 말하지 않는다. headline이나 생성형 응답도 가격 움직임의 원인 증거로 취급하지 않는다.

## 안전 hard stop

- Athena 소스 파일을 수정하지 않는다.
- dirty worktree에 `git reset`, `git clean`, `git checkout --`, 광범위 삭제를 실행하지 않는다.
- 실제 주문 또는 모의 주문 API를 호출하지 않는다.
- 주문 실행 버튼을 누르지 않는다.
- 계정, 토큰, 권한, 외부 전송 대상을 변경하지 않는다.
- 플러그인을 설치 확정하거나 권한을 저장하지 않는다.
- 알림/루틴을 실제로 활성화, 저장, 일시정지, 재개, 삭제하지 않는다.

`PROTOCOL.md`의 알림 전체 수명주기 요구와 이 경계가 충돌하면 더 최신이고 안전한 이 계약을 따른다. 초안과 확인 경계만 검증하고 나머지는 coverage gap으로 기록한다.

수정 가능한 범위는 `artifacts\beta-test-3day`의 베타 증거와 이 handoff 폴더뿐이다.

## 완료 게이트

다음을 모두 입증해야 완료다.

- 실제 경과시간 72시간 이상
- checkpoint 또는 명시적인 누락 사유가 있는 72개 시간 슬롯
- 자연어 질문 30개 이상, 후속 질문 15개 이상
- 단타, 국장 중기, 미장 장기, 전술적 축소 각각 5턴 이상
- 그래프 6회 이상, 미장 ETF 세션 6회 이상, 숨김/복원 또는 재시작 6회 이상
- 서로 다른 알림 초안 4개 이상과 승인 직전 경계 검증
- DART, Sheets, 텔레그램 알림, 실적 캘린더 4개 플러그인 경로 검증
- 주문 실행 0회, broker mutation 0건
- Major 이상 모든 결함에 재현 절차와 화면 증거
- live, mock, cache, fixture, UI draft, unknown을 분리한 최종 보고서

72시간만 흘렀거나 자동화 파일이 존재한다는 사실은 완료 증거가 아니다.
