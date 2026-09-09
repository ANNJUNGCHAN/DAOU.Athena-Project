# 이 브랜치의 Grok 시작 안내

현재 작업은 Athena 도구·화면·카드 탐색 지연 개선의 인수인계다.

1. 저장소의 `AGENTS.md`와 관련 하위 지침을 읽는다.
2. `docs/handoff/tool-discovery-latency/README.md`에서 전달 범위·완료/미완료 상태·코드 위치를 확인한다.
3. `docs/handoff/tool-discovery-latency/PLAN.md`의 검토된 계획과 `GROK-START.md`의 다음 행동으로 이어간다.

이 파일이 사용하는 Grok 도구에서 자동 로딩된다고 가정하지 않는다. 새 대화에는 `docs/handoff/tool-discovery-latency/GROK-START.md` 내용을 직접 전달하면 된다. 개인 Codex 메모리나 `.omx` 상태는 필요하지 않다. 성능 개선 구현과 실험은 아직 미착수이며, 기존 코드·검증 경계를 재사용하는 0~2단계부터 시작한다.
