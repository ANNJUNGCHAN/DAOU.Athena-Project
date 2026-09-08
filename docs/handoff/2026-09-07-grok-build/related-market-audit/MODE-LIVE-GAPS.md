# 실제 모드 전환의 남은 검사 경계

현재 live UI 도구는 summary/graph/agent/plugin/backtest의 컨트롤 존재와 현재 화면을 확인했다. 설정 4개 탐색은 실행했지만, 모드 5개 전환은 아직 실행하지 않았다. 독립 source 조사에서 아래 기존 경로를 확인했다.

- 모드 전환은 `app/lib/sidebar.js:1248`의 `startNewConversation`을 통해 대화 생성 IPC를 호출한다. `app/lib/main/provider-main-lifecycle.js:28`은 admission 차단, 기존 provider turn interrupt, provider rotation, 새 conversation 저장 순서로 동작한다. 단순 DOM 전환으로 취급할 수 없다.
- 모드 버튼 자체에서 주문이나 routine mutation 호출은 확인되지 않았다. agent는 루틴 조회, backtest는 refresh, plugin은 hub 전환을 수행한다. 이후 개별 action은 별도 검사 대상이다.
- 기존 `athena:project-add`로 전용 빈 감사 폴더에 project를 만들고 그 반환 ID로 새 대화를 귀속할 수 있다. `athena:conversations-set-active`로 원래 유효한 active conversation을 복원할 수 있다. 원래 active conversation이 없으면 같은 복원 계약을 적용할 수 없다.
- 개별 conversation 삭제 API는 없지만 자기 생성 project 전체를 `athena:project-remove`로 지울 수 있다. 이 호출은 폴더까지 재귀 삭제하므로 생성 당시의 exact ID/name/path, workspace 내부 경로, 기존 project와 불일치, 원래 active conversation 복원을 모두 확인해야 한다. 기존 사용자 project를 정리 대상으로 삼아서는 안 된다.
- 현재 외부 검사 계약에는 전역 provider idle 상태를 확정하는 gate가 없다. conversations runState는 부분 증거이고 mode 전환은 항상 interrupt 경로를 지난다. 기존 사용자 턴을 중단하지 않는다는 실행 전제는 아직 검증되지 않았다.

따라서 현재 `BLOCKED_NAV_CREATES_HISTORY`의 상세 의미는 **감사 전용 project로 기록 소유권은 분리할 수 있으나 provider 실행 상태와 완전한 복원 조건을 확보하지 못해 실제 전환을 미실행한 상태**다. 모든 로컬 쓰기가 금지되어서 차단된 것은 아니다. 제품 기능 불량이나 정상으로도 판정하지 않는다.

다음 실행은 기존 하네스의 독립 fixture 모드·세션 복원 검사를 먼저 수행하고, live 실행에서는 위 idle/복원 전제를 관찰할 수 있는 검사 경로가 확보된 경우에만 진행한다. 새 namespace나 제품 API 추가를 이미 필요하거나 완료된 것으로 가정하지 않는다.

소스 근거: `app/main.js:1573` project-add, `app/main.js:1613` project-remove, `app/main.js:5172` conversations-set-active/new, `app/lib/main/conversations.js:261` project 소유·삭제, `app/lib/main/provider-session-supervisor.js:241` provider interrupt, `app/probe-session-restore.js` fixture 생성·복원.
