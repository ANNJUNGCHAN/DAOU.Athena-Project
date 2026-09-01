# Claude Code에 전달할 프롬프트

아래 내용을 Claude Code에 그대로 전달한다.

---

`C:\Projects\DAOU.Athena`의 Athena 3일 실사용 베타테스트를 기존 증거에서 그대로 이어서 수행해.

먼저 다음 handoff 파일을 읽어:

- `C:\Projects\DAOU.Athena\artifacts\claude-code-handoff-2026-08-31\CLAUDE.md`
- `C:\Projects\DAOU.Athena\artifacts\claude-code-handoff-2026-08-31\ORIGINAL_OBJECTIVE.md`
- `C:\Projects\DAOU.Athena\artifacts\claude-code-handoff-2026-08-31\README.md`
- `C:\Projects\DAOU.Athena\artifacts\claude-code-handoff-2026-08-31\HANDOFF_STATE.json`
- `C:\Projects\DAOU.Athena\artifacts\claude-code-handoff-2026-08-31\RUNBOOK.md`

다음 원본 기록을 현재 사실의 기준으로 확인해:

- `C:\Projects\DAOU.Athena\artifacts\beta-test-3day\manifest.json`
- `C:\Projects\DAOU.Athena\artifacts\beta-test-3day\PROTOCOL.md`
- `C:\Projects\DAOU.Athena\artifacts\beta-test-3day\sessions\2026-08-31.md`
- `C:\Projects\DAOU.Athena\artifacts\beta-test-3day\ISSUES.md`
- `C:\Projects\DAOU.Athena\artifacts\beta-test-3day\captures\2026-08-31\manifest.csv`

이 작업은 아직 완료되지 않았다. 지금까지 입증된 범위는 실질 세션 1회, 자연어 질문 4개, 후속 질문 2개, 성공 2개, 조용한 실패 2개, 캡처 14개뿐이다. Kiwoom은 mock API만 확인됐으며 production broker나 live market data는 확인되지 않았다. 기존 PID, 창 ID, 백엔드 상태는 과거 기록이므로 재사용하지 말고 현재 상태를 다시 측정해.

사용자 성향은 다음과 같다:

- 단기 운용 시드 1,000만원
- 약 한 시간 간격 확인
- 월 약 200만원 목표지만 무리한 매매 금지
- 장기 자금 5,000만원~1억원
- 미국 시장은 ETF 중심 장기 적립식
- 한국 시장은 대형주와 ETF 중심 중기 운용
- 필요할 때는 투자 논리에 따라 비중 축소를 검토

매 세션마다 현재 KST 시각과 이전 기록을 먼저 확인하고, Orca computer-use로 실제 Athena 화면을 조작해 최소 한 개의 자연스러운 투자 질문을 입력해. 채팅, 그래프, 알림/루틴 초안, 플러그인 미리보기와 권한 확인 경계를 순환해서 사용해. 최신 접근성 트리를 매번 다시 얻고 실제 화면을 캡처해.

각 결과를 live, mock, cache, fixture, UI draft, unknown으로 구분해. fixture나 과거 결과를 live로 표현하지 마. 로딩, 오류, 빈 상태, 탐색 마찰, 문구 이해도, 응답 정확성, 재시작 후 상태 지속성을 화면 증거로 기록해.

각 세션의 시각, 사용자 목표, 입력 질문, 클릭 경로, 실제 결과, 데이터 출처 분류, 스크린샷 경로와 SHA-256, 심각도, 재현 절차, 기대 결과, 개선 제안을 일자별 로그와 통합 이슈 원장에 누적해.

Athena 소스는 수정하지 마. 기존 dirty worktree를 reset, clean, checkout 또는 덮어쓰기 하지 마. 실제 주문, 모의 주문 API 호출, broker mutation, 계정 변경, 외부 전송, 플러그인 설치 확정, 권한 저장은 수행하지 마. 알림/루틴은 초안과 최종 확인 직전까지만 관찰하고 실제 저장, 활성화, 일시정지, 재개, 삭제는 하지 마.

Codex의 `athena-3` heartbeat 자동화가 Claude Code로 이전됐다고 가정하지 마. Claude가 사용할 수 있는 시간별 continuation 방법을 현재 환경에서 별도로 확인하고, 수행하지 못한 시간 슬롯은 누락 사유로 기록해.

72시간 실제 경과, 72개 시간 슬롯 또는 명시적 누락 사유, `PROTOCOL.md`의 질문·후속 질문·기능 커버리지와 증거 조건이 모두 충족될 때만 최종 통합 보고서를 작성해. 그 전에는 목표를 완료했다고 말하지 말고 계속 미완료로 유지해.

첫 행동은 `preflight.ps1` 실행과 원본 기록 확인이야. 그 다음 현재 런타임을 복구하고 다음 실제 UI 세션 1회를 수행해.

---
