# 마감 전후 실제 관찰

시간은 모두 2026-09-07 KST다. 아래 시장 단계는 KST 시간표에 따른 분류이며 거래소 또는 provider가 보낸 장 상태를 확인한 결과가 아니다. 상태 조회 네 곳의 HTTP 200과 앱 프로세스 신원은 시세·차트·전체 기능 정상과 별도로 판정한다.

| 예정 시각 | 실제 시각 | 단계 | 앱 신원 | 상태 조회 | 증거와 판정 |
|---|---|---|---|---|---|
| 15:20 | 15:20:53.922 | CLOSING_AUCTION | PID30288 found/validated true | 4/4 HTTP200 | `observer-20260907T062053-922Z.json`; 예정 시각 뒤53.922초, 60초 허용 범위 내 관찰 |
| 15:30 | 15:30:53.987 | POSTCLOSE | 이전 PID30288 found/validated false | 4/4 HTTP200 | `observer-20260907T063053-987Z.json`; 예정 뒤53.987초. 다른 앱 인스턴스의 부재를 의미하지 않음 |
| 15:40 | 15:40:54.058 | POSTCLOSE | 이전 PID30288 found/validated false | 4/4 HTTP200 | `observer-20260907T064054-058Z.json`; 예정 뒤54.058초. 새 인스턴스 관찰은 별도 기록 |
| 16:00 | 16:00:52.083 | POSTCLOSE | PID36856 found/validated true | 4/4 HTTP200 | `observer-20260907T070052-083Z.json`; 예정 뒤52.083초, 60초 허용 범위 내 관찰 |
| 16:30 | 16:30:00.002 | AFTER_AUDIT_WINDOW | PID47980 found/validated true | 4/4 HTTP200 | `observer-20260907T073000-002Z.json`; 예정 뒤2ms인 종료 경계 표본. 관찰기는16:30:01.009 예정 종료 |

15:20 영수증은 `artifacts/market-session-audit/2026-09-07/checkpoint-20260907T152000KST.json`에 있다. 원본 observer SHA-256은 `5F726D037C8DC582D905BA9A1EA98794C3751F4D9FC7958FDE88E851BAB757B6`이다. 해당 표본은 health4.4ms, ready4.7ms, accounts5.3ms, OpenAPI25.1ms를 기록했다.

15:30과15:40 영수증은 같은 artifact 폴더의 `checkpoint-20260907T153000KST.json`, `checkpoint-20260907T154000KST.json`에 있다. 사용자 앱34680은15:29:24.312에 생성됐고15:42에 새 감사 watcher46776을 연결했다. 첫15:42:48 표본은 process probe 실패로 신원 필드가 미기록됐고,15:43:48.201 표본에서 found/validated true와 HTTP4/4를 확인했다. 이 뒤15:45:19.261에 감사 소유 이전 watcher44784만 종료했다. 사용자 앱·백엔드 제어는0이다. `runtime-handoff-20260907T154519KST.json`이 실제 시각과 증거를 연결한다.

15:49에 사용자 앱·백엔드가 다시 새 프로세스로 바뀌었다.15:50:48 표본은 health/ready HTTP200, accounts/OpenAPI 약2초 timeout이고15:51:48에는 네 곳 모두 HTTP200으로 회복했다. 새 앱36856은15:51:51.994 표본에서 신원 확인됐고 감사 watcher46644가 관찰을 이어간다. 이전 감사 watcher46776은15:53:21.334에 신원 확인 후 종료했다. 시간적 동시성을 재시작의 확정적 인과관계나 정확한 장애 시간으로 해석하지 않는다. `runtime-handoff-20260907T155321KST.json`에 원본 지문과 실행 신원을 기록했다.

15:53 당시 관찰 기록은 새 감사 worktree의 `watch-20260907T065151-987Z.json`이었다. 이후 관찰기 인계와 최종 종료 기록은 아래에 별도로 연결한다. 이전77분55.708초 관찰 공백, 사용자 재시작 및 `process_probe_failed` 구간은 `WORKTREE-ISOLATION.md`와 `RECOVERY-VERIFICATION.md`의 역사적 증거로 보존한다. 이 표로 이전 공백을 소급 보완하지 않는다.

15:13 순수 계산 API12개, 조회 실제263/264, custom REST55와 WebSocket stream1의 범위는 `COVERAGE.md`에서 추적한다. 14:46의 단일0B fresh event 관찰은 마감 시각의 시세·종가 확인으로 재사용하지 않는다.

16:00 영수증은 `checkpoint-20260907T160000KST.json`이다. 실제16:00:52.083 표본은 앱 신원과 health5.1ms, ready5.4ms, accounts5.6ms, OpenAPI21.5ms의 HTTP200을 기록했다.

16:30 영수증은 `checkpoint-20260907T163000KST.json`이다. 마지막 표본은 app47980 신원 true/true, health4.4ms, ready4.2ms, accounts4.4ms, OpenAPI17.3ms의 HTTP200을 기록했다. 마지막 관찰기34120의 기록은 `watch-20260907T071218-597Z.json`이며16:30:01.009에 `planned_cutoff_reached`로 종료됐다.16:32:55.492 OS 조회에서도 PID34120이 없었다.16:06 요청 실패·16:07 부분 timeout·16:08 응답 회복은 `runtime-handoff-20260907T161258KST.json`에 별도로 보존했다. 예정 관찰 종료를 전수 기능 통과로 해석하지 않는다.
