# 장 마감 후 관찰 결과와 수정 전환

2026-09-07 KST16:30 예정 관찰을 종료했다. **전체 기능 판정은 PARTIAL**이다. 마지막 상태 조회가 정상이었다는 사실을 모든 장중 기능·화면·데이터 정확성의 통과로 사용하지 않는다.

## 마지막 관찰

- 실제 시각:16:30:00.002. 예정 시각 뒤2ms인 종료 경계 표본이며 원본 시간 분류는 `AFTER_AUDIT_WINDOW`다. 거래소/provider 장 상태를 직접 확인한 분류가 아니다.
- 앱47980: found/validated true, 프로세스 트리21개. health4.4ms, ready4.2ms, accounts4.4ms, OpenAPI17.3ms 모두 HTTP200.
- 원본 `observer-20260907T073000-002Z.json` SHA-256 `C210AE9E9E86D2A10B6933B3A7D29D5FB07384CFCFB8B798A69D61F85D41FCE8`.
- 최종 관찰기 기록 `watch-20260907T071218-597Z.json`은16:30:01.009 `planned_cutoff_reached`로 종료됐다.19개 표본, 관찰·기록 실패 카운터0. SHA-256 `08EE2BD9AA6586351820B4A016DBE6C60F799CE81E29BAC027142E5E156CF2D8`.
- root가16:32:55.492 OS 조회에서 감사 watcher34120의 부재를 확인했다. 이는 tool command-context 증거이며 별도 원본 OS artifact가 있는 것으로 표시하지 않는다.

## 마감 후 표본 집계

15:30부터16:30 종료 표본까지 네 watcher가 참조한 고유 observer artifact67개를 대조했다. 같은 KST 분에 여러 관찰기가 기록한 경우 `started_at`이 가장 최신인 watcher 표본을 선택했다. 이 규칙으로61개 분 구간에서 각1개를 선택했고, 인계 중 중복6개를 제외했다. 분 구간의 존재는 연속적인 서비스 가용성 증명이 아니다.

| 선택된61개 표본의 항목 | 결과 |
|---|---:|
| 앱 root 신원 확인 | 36 |
| 이전 대상 PID의 명시적 부재 | 20 |
| process probe 실패로 신원 미확인 | 5 |
| 서버 조회 네 곳 모두 HTTP200 | 57 |
| 하나 이상 요청 실패 또는 timeout인 분 | 4 |

영향받은 분은15:49,15:50,16:06,16:07이다. endpoint 단위 실패 결과12개 중 request_failed8개, timeout4개다. 이전 PID 부재를 모든 앱의 부재로 확대하지 않는다. 사용자 앱·백엔드 교체와 실패의 시간적 동시성은 확인했지만 확정적 인과관계나 정확한 장애 지속시간은 입증하지 않았다.

선택 표본 간 최대 시각 간격은63.724초(15:50:48.270→15:51:51.994)이고, 중복을 포함한 원본 합집합의 최대 간격은60.022초다. 기존 장중77분55.708초 관찰 공백은 별개로 남아 있으며 이 집계로 소급 보완하지 않는다.

## 전수 기능의 남은 범위

원천1396행은 exact ID로 관리한다. 조회 실제263/264, custom REST55와 별도 WS stream1은 실행 수이며 PASS 수가 아니다. 입력 부재·code20·freshness/pagination 미검증을 유지한다. 단일0B fresh event는 나머지22개 실시간 유형의 실행 증거가 아니고, upstream REMOVE ACK·구독 인과성과 충돌 없는 소유권도 확인되지 않았다. MCP12도구58action은 protocol metadata만 확인했다. API200·fixture·정적 계약과 실제 사용자 기능 통과를 구분한다.

## 수정 전환

현재 main은 다른 작업에 의해53055ac로 전진했다. 재현 기준ac8452f에서 BOOT-001/002/003과 AUTH-002 네 feature worktree를 만들었고, main53055ac에서 DIAGNOSTICS 및 별도 integration 후보를 만들었다. 시작 병목·중복 spawn·인덱스 회복 전파는 재현 후 수정한다. 계좌 전달은 권위 있는 연결 정보가 없어 사용자에게 명시 연결 방식과 별도 조회 계좌 선택 방식 중 선호를 물었으며 답변 전 연결을 추측하지 않는다.

카드·화면은 최신 main에서 기존 수정과 남은 실패를 구분한다. 미니 fixture의 실제 backend autostart 경로는 별도 HARNESS-MINI-001 worktree에서 격리 수정을 검토한다. 제품 launcher의 고정8010 때문에 사용 중인 서버를 침범하는 full cold-start 검사는 실행하지 않는다. 가능한 격리 검증과 남은 acceptance를 구분한다. 사용자 main 병합·push·사용자 프로세스 제어는 하지 않는다.
