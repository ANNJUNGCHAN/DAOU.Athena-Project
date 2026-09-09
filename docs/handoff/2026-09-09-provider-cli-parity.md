# Claude · Grok · Codex 대화 실행 동등화

## 결과와 범위

세 공급자의 기본 대화 경로에 같은 예열 풀과 대화별 세션 배정·재사용·취소·종료 구조를 연결했다. 선택된 연결 계정의 공급자에 빈 예비 세션 2개를 유지하고, 새 대화가 하나를 가져가면 보충한다. 세 공급자 6개를 무조건 동시에 기동하는 방식은 아니다. Claude의 기존 요청 분류용 8개 프로세스 풀은 별도다.

대화에 사용한 세션을 다른 대화의 예비 세션으로 반환하지 않는다. 공급자·계정·모델·보안 설정 변경 시 예비 세션을 교체하며, 진행 중인 다른 대화는 별도로 소유한다. 재개 커서는 공급자·계정 소유권을 저장하고 확인한다. 소유권 정보가 없는 이전 커서는 다른 공급자로 전달하지 않는다.

- Claude: 기존 stream-json 대화 세션을 공통 풀에 연결했다.
- Grok: ACP 초기화만 수행하는 warm을 추가했다. 첫 질문은 빈 예열 세션을 재사용하며 모델·계정·보안 키가 달라지면 재사용하지 않는다.
- Codex: 실제 native app-server를 사용하는 대화 어댑터를 연결했다. 모델·effort 기본값, 빈 thread 준비, 재개, 스트리밍, 도구 결과, 캔버스 결과와 취소를 처리한다. Claude로 대신 실행하지 않는다.

Codex는 Athena 전용 CODEX_HOME을 사용하며 전역 인증·설정을 복사하거나 변경하지 않는다. 프로세스 설정에서 Athena MCP만 연결하고 gateway command/args/env 및 실제 도구 목록·기능 설정을 검사한다. 설치된 native 0.153.4 스키마의 MCP tools 객체 맵을 지원한다. 기존 실험용 단일 supervisor와 과거 0.147.0 계약 자료는 별도 경로로 남겨 두었으며 검증 성공으로 조작하지 않았다.

## 취소와 종료

예열 대기 전부터 취소 핸들을 등록한다. 취소는 해당 대화가 가져간 세션만 종료하고 레지스트리에서 제거하므로 다음 요청이 종료된 객체를 재사용하지 않는다. 풀과 대화 런타임은 비동기 종료를 추적한다. 종료 rejection 또는 exited:false를 보안 설정 변경과 앱 종료 검사에 전달하며, 실패를 성공으로 처리하지 않는다.

## 검증

- 관련 15개 테스트 파일: **151 passed, 0 failed, 0 skipped**.
- 별도 코드 리뷰: 19개 관련 파일 검토, 남은 코드 결함 0건. 인증된 Codex live 검증은 미완료로 구분했다.
- JavaScript syntax 및 git diff whitespace 검사를 수행했다.
- 실측 보고서: `.omc/artifacts/chat-prewarm-live.json`.
- Codex native 설정·스키마 보고서: `.omc/artifacts/codex-runtime-live-probe-report.json`.

실제 CLI 무도구 OK 요청 결과:

| 공급자 | 실제 확인 | 남은 조건 |
| --- | --- | --- |
| Grok | 예열 세션 2개 준비 15.220초. 서로 다른 PID에서 첫 요청 8.209/8.608초, 후속 요청 3.831초. 모두 새 spawn 없이 재사용, OK 응답, 도구 호출 0건 | 실제 금융 질문의 모델·도구 대기시간까지 개선했다고 주장하지 않음 |
| Claude | 미리 띄운 두 PID의 재사용 확인 | CLI가 사용량 소진 오류를 반환해 성공 응답 검증 불가. 입력 전 readiness를 내보내지 않아 예열 상태와 연결 확인을 구분해야 함 |
| Codex | native 0.153.4 stdio 초기화 및 config/read, Athena-only MCP 설정, gateway 설정 일치, 제한 기능 상태와 스키마 확인 | Athena 전용 로그인이 없어 인증된 thread/MCP/모델 응답 검증 미완료 |

실측 이후 Codex 인증 오류가 일반 spawn 오류로 감춰지던 문제를 수정했다. 최신 테스트는 CODEX_PRIVATE_AUTH_REQUIRED, 한국어 로그인 안내, actionNeeded:true, retryable:false가 실제 main 팩토리부터 응답까지 전달되고 인증 누락 시 자동 재시도가 예약되지 않는 것을 검증한다. 이전 실측 JSON의 retryScheduled:true는 이 수정 전 관측값이다.

## 적용과 남은 작업

실행 중인 공유 Athena 앱은 재시작하지 않았다. 변경된 main 코드는 다음 앱 기동 시 적용된다. 커밋·푸시는 하지 않았으며 기존 카드·차트 작업 변경은 보존했다.

실제 세 공급자 응답 검증을 마치려면 Claude 사용량이 사용 가능한 상태여야 하고, Athena 계정 설정에서 Codex 전용 로그인을 완료해야 한다. 그 후 인증된 Codex thread/MCP/응답 및 앱 화면까지 다시 검증해야 한다. 현재 결과를 세 공급자 전체 live 검증 완료로 해석하면 안 된다.

## 임시 파일 정리 제한

자동 승인 검토가 아래 두 임시 폴더의 재귀 삭제를 `blocked by policy`로 거부했다. 상세 사유는 제공되지 않았다. 인증 파일이나 복사된 자격증명은 없으며 Codex가 만든 일시적 상태 파일이 남아 있다.

- `C:\Users\USER\AppData\Local\Temp\athena-codex-runtime-probe-5t7qoP`
- `C:\Users\USER\AppData\Local\Temp\athena-codex-runtime-probe-lq14mt`
