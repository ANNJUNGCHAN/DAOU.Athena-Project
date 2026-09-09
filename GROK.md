# Grok 작업 시작: 공급자 CLI 대화 동등화

이 브랜치의 인수인계 대상은 Claude·Grok·Codex 대화 세션 동등화다.
먼저 `AGENTS.md`, `docs/handoff/provider-cli-parity/README.md`,
`docs/handoff/provider-cli-parity/GROK_PROMPT.md`를 읽고 남은 작업을 이어간다.
루트 `RTK.md`는 인수인계 시점에 없었다. 없는 파일을 읽었다고 주장하지 않는다.

- 브랜치: `codex/provider-cli-parity-grok-handoff`
- 구현 커밋: `38b5466b`, 테스트 보완: `d64d124d`
- 인수인계 기반: `d64d124d` (2026-09-09 공급자 작업 완료 및 전체 pre-push 통과 커밋)
- 우선 과제: 실제 Athena 앱에서 Grok 예열·대화 격리·취소·재사용을 확인하고 지연을 단계별로 측정한다.
- Claude 사용량과 Athena 전용 Codex 인증은 이전 실행의 미충족 조건이다. 새 환경에서 다시 확인한다.
- 전역 인증을 복사하거나 다른 공급자로 몰래 대체하지 않는다. 인증/계정 선택은 Athena의 기존 절차를 사용한다.
- 전체 live 검증은 아직 완료되지 않았다. 코드 존재, 테스트 성공, 실제 인증된 응답을 구분한다.

이 문서는 Grok 실행 프로그램이 자동으로 읽는다고 보장하지 않는다.
자동으로 읽지 않으면 `docs/handoff/provider-cli-parity/GROK_PROMPT.md` 내용을 첫 메시지로 전달한다.
기존 AGENTS.md 및 사용자의 최신 지시를 우선한다. 이 파일은 새 권한이나 작업 범위를 추가하지 않는다.
