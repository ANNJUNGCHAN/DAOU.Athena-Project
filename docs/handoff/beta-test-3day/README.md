# Athena 3일 실사용 베타테스트 — Claude Code handoff

> **이 폴더는 2026-09-01에 git으로 옮겨졌다.** 원본은 `artifacts/claude-code-handoff-2026-08-31/`과
> `artifacts/beta-test-3day/`에 있었는데 `/artifacts/`가 `.gitignore` 대상이라 다른 컴퓨터로 넘어가지
> 않았다. 아래 본문에 남아 있는 원본 경로는 다음으로 읽는다.
>
> | 원본 경로 | 지금 위치 |
> |---|---|
> | `artifacts\claude-code-handoff-2026-08-31\*.md` · `*.json` | `docs/handoff/beta-test-3day/` (이 폴더) |
> | `artifacts\claude-code-handoff-2026-08-31\CLAUDE.md` | `docs/handoff/beta-test-3day/EXECUTION_CONTRACT.md`<br>(중첩 `CLAUDE.md`가 일반 개발 세션에 자동 주입돼 "소스 수정 금지"가 걸리는 걸 막으려 이름만 바꿨다) |
> | `artifacts\claude-code-handoff-2026-08-31\*.ps1` | `scripts/beta/` |
> | `artifacts\beta-test-3day\{PROTOCOL,ISSUES}.md` · `manifest.json` · `sessions/` · `captures/*/manifest.csv` | `docs/handoff/beta-test-3day/` (이 폴더) |
>
> **넘어오지 않은 것:** 캡처 PNG 14개(13MB)와 `runtime/*.log`. 원본 PC의
> `artifacts/beta-test-3day/` 에만 있다. `manifest.csv`의 SHA-256은 남아 있으므로 대조는 가능하지만,
> 새 컴퓨터에서는 **파일이 없다**가 정상이다. 없는 것을 통과로 기록하지 않는다.

이 폴더는 Codex에서 시작한 Athena 데스크톱 앱 72시간 실사용 베타테스트를 Claude Code가 같은 목표와 안전 경계로 이어받기 위한 인계 패키지다.

이 폴더의 상태 요약은 생성 시점의 스냅샷이다. 계속 갱신해야 하는 권위 있는 기록은 `C:\Projects\DAOU.Athena\artifacts\beta-test-3day` 아래 원본 파일들이다.

## 시작 방법

1. PowerShell에서 저장소로 이동한다.

   ```powershell
   Set-Location -LiteralPath 'C:\Projects\DAOU.Athena'
   ```

2. 읽기 전용 preflight를 실행한다.

   ```powershell
   & '.\scripts\beta\preflight.ps1'
   ```

3. Claude Code를 저장소 루트에서 실행한다. 이 PC에서는 생성 시점에 `C:\Users\ajc22\.local\bin\claude.exe`가 확인됐다.

   ```powershell
   & 'C:\Users\ajc22\.local\bin\claude.exe'
   ```

4. Claude Code에 [CONTINUATION_PROMPT.md](./CONTINUATION_PROMPT.md)의 내용을 전달한다. Claude가 먼저 이 폴더의 `EXECUTION_CONTRACT.md`, `HANDOFF_STATE.json`, `RUNBOOK.md`와 베타 기록을 읽게 한다.

## 반드시 읽을 파일

- [폴더 전용 실행 계약](./EXECUTION_CONTRACT.md)
- [사용자가 요청한 원래 목표](./ORIGINAL_OBJECTIVE.md)
- [인계 시점 상태](./HANDOFF_STATE.json)
- [런타임 및 시간별 세션 runbook](./RUNBOOK.md)
- [세션 기록 템플릿](./SESSION_TEMPLATE.md)
- [붙여넣기용 계속 실행 프롬프트](./CONTINUATION_PROMPT.md)
- [원본 manifest](./manifest.json)
- [72시간 완료 게이트](./PROTOCOL.md)
- [2026-08-31 실사용 로그](./sessions/2026-08-31.md)
- [통합 이슈 원장](./ISSUES.md)
- [화면 증거 manifest](./captures/2026-08-31/manifest.csv) — CSV만 넘어왔고 PNG는 원본 PC에 있다

## 지금까지 실제로 입증된 범위

- 실질적인 실사용 세션 1회
- 자연어 질문 4개, 후속 질문 2개
- 성공 응답 2개, 조용한 실패 2개
- 그래프 방문 2회, 알람 방문 2회, 플러그인 미리보기 1회
- 스크린샷 14개와 SHA-256 검증
- 주문 실행 0회, broker mutation 0건
- local backend HTTP와 shell WebSocket은 당시 복구 확인
- Kiwoom은 mock API만 확인; production broker와 live market data는 미확인
- BETA-001부터 BETA-008까지 기록

3일 목표는 완료되지 않았다. 생성 시점 현재 Athena Electron, Athena backend, 8010 listener는 실행 중이지 않았다. `manifest.json`의 이전 PID와 창 ID는 재사용할 수 없는 과거 증거다.

## 중요한 경계

- 이 handoff는 Codex heartbeat 스케줄러를 Claude Code로 이전하지 않는다. `athena-3` 자동화가 `ACTIVE`로 남아 있어도 Claude가 사용할 수 있는 실행 보장은 아니다.
- 소스 코드를 수정하지 않는다. 기존 dirty worktree를 reset, clean, checkout하거나 덮어쓰지 않는다.
- 실제/모의 주문 API, 계정 변경, 외부 전송, 플러그인 설치 확정, 권한 저장을 수행하지 않는다.
- 알림과 루틴은 초안과 확인 경계까지만 관찰한다. 실제 활성화·저장·일시정지·재개·삭제는 별도 승인 없이는 하지 않는다.
- fixture, mock, cache, UI draft를 live로 부르지 않는다.

## 종료 조건

`PROTOCOL.md`의 모든 완료 게이트가 실제 증거로 충족되기 전에는 완료로 선언하지 않는다. 누락된 시간 슬롯은 성공한 것처럼 채우지 않고 누락 사유를 기록한다.
