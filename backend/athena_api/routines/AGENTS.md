# routines/ — 능동 에이전트 루틴 서브시스템

설계 정본: `plan/능동-에이전트-실행계획-2026-08-19.md` (ralplan 합의 v4+§8) ·
모(母)설계: `plan/감시에이전트-실행계획.md`.

## 원칙 (어기면 안 되는 것)

- **조건은 구조화 dict다.** 문자열 DSL·표현식 파서를 들이지 마라 — eval/exec/compile
  부재를 `test_routines_core.py`가 소스 grep으로 고정한다(프리모템 6).
- **mode는 유도값이다**(§8): 소스 transport가 ws면 `realtime-ws`, 아니면 `periodic`.
  사용자·모델이 고르는 필드로 바꾸지 마라.
- **모델은 draft·list만.** confirm/cancel은 REST에서 사람 클릭(렌더러)만 부른다 —
  게이트웨이 `routine_tools.py`에 상태 변경 액션을 추가하지 마라(델타 blocker).
- **원장 기록에는 reason이 필수다.** 이유 없는 침묵은 디버깅 불가(모문서 §6).
  조건 원문·계좌 정보·upstream 본문을 원장·감사 로그에 싣지 마라(함정 ⑫ 동형).
- **리미터는 하나다.** 폴링은 `headroom()` 관측으로 양보한다 — 루틴용 리미터를
  새로 만들지 마라(CLAUDE.md §7).
- **공시 폴링은 MCP 게이트웨이를 경유할 수 없다** — 게이트웨이는 질의당 1회성
  프로세스다. DART 직접 HTTP(`disclosure_source.py`)가 유일 경로. corp_code는
  숫자로 온다 — zfill(8) (`corp_catalog.py`가 고정).
- **조용한 죽음 금지**: 복원 실패·강등은 이벤트 큐로 강제 알림(`runtime.py`),
  활성화는 `can_activate()` 정직 게이트를 통과할 때만.

## 배선

`routines_enabled=False` 기본(config.py). lifespan이 `open_routines()`/
`teardown_routines()`로 대칭 결선 — 브레인과 같은 best-effort 강등 문법.
알림은 `app.state.routine_events` 큐 → `/api/v1/ws/routines`(ws_auth 배타 2모드) →
앱 `routine-feed.js` → 토스트·능동 턴.
