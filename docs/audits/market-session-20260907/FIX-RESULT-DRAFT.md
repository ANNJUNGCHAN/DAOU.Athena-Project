# 장후 수정 결과 초안

> **DRAFT — 완료 보고 아님.** 통합 HEAD `eb52e02`까지 고정된 문서·커밋·검증 영수증만 정리했다. 이후 agent 결과와 실제 재실행은 root가 반영해야 한다. 사용자 `main`에는 병합하지 않았고 push도 하지 않았다.

## 현재 통합 상태

- 통합 후보: `C:\Projects\DAOU.Athena-market-fix-integration-20260907`
- 브랜치/HEAD: `codex/market-fix-integration-20260907` / `eb52e02`
- 작업 폴더: 현재 clean
- 기준: `main`의 `53055ac`에서 시작해 독립 승인된 BOOT, AUTH 일부, MINI, CARD, SCREEN 커밋을 순서대로 반영했다.
- 최신 종합 영수증은 `artifacts/integration-verification-20260907/integration-verification-738a57d.json`이다. 이 영수증은 HEAD `738a57d` 시점의 **PARTIAL** 판정이며 이후 `ed65de5`, `f91637e`, `25dc73f`, `b62680b`, `eb52e02`를 포함하지 않는다. 따라서 현재 HEAD 전체 검증 영수증으로 사용하지 않는다.

## 반영된 변경과 증거 범위

| 영역 | feature / 통합 커밋 | 현재 증거 | 아직 증명하지 못한 것 |
|---|---|---|---|
| BOOT-001 종목 identity 병목 | `31a62dd` / `8a9ef03` | identity/API 29, selector 339, 추가 경계 5 통과. 3,525개 합성 입력의 후보 제한 방식 검증 | 제품 전체 cold-start 및 실제 종목 데이터 기반 기동 성공 |
| BOOT-002 중복 backend spawn | `2865721` / `ad12e0d` | 첫 timeout 뒤 기존 backend 재확인, launcher 32/32 통과 | 사용자 8010을 침범하지 않는 제품 self-spawn 실측 |
| BOOT-003 stock-index 회복 전파 | `2af8b70` / `376e836` | callback/broadcast 예외 격리 포함 82/82 통과 | 실제 upstream 502 후 동일 제품 프로세스의 화면 회복 재현 |
| BOOT 결합 fixture | `02acceb`, `b62680b` | helper 6/6, 구문·AST 및 wrapper 독립 승인 | wrapper 첫 호출은 0.414초 exit0이나 결과 JSON이 없어 `NOT_PROVEN`; 승인 wrapper 재실행 대기 |
| AUTH-002 명시 계좌 연결 | `818d022`, `d60e44b`, `26e5d8e` / `738a57d`, `ed65de5`, `f91637e` | 명시 `backendAlias`, `/ready/accounts` 권위 목록, direct REST·selector·chart lineage의 fail-closed 회귀. 기능 branch의 관련/전체 app 및 backend 집중 검사는 각 단계에서 통과 | realtime/control 전 경로의 계좌 계보. 현재 realtime 보완은 미커밋·독립 review 중이며 실제 계좌 설정/전환은 실행하지 않음 |
| MINI harness | `2ef39c9` / `2004ef5` | 격리 fixture 실제 1회 exit0, render 11/11, grammar 10/10, 실패 0, 소유 잔존 프로세스 0. `PAPER-MINI.json` SHA-256 `A9ED21BA6FFFA40C33B191B7E979496D347C93B979041DBADB92693016D341F2` | live provider, 실제 사용자 데이터, screenshot 의미 검토 |
| CARD formatter/fixture | `eb3c0da`, `196aba9` / `fb8e98c`, `25dc73f` | 완성 문구 중복 접사 제거, 2R3M-1 네 폭 PASS. 137X-2 텍스트 오류 0 | 137X-2 상태 보드는 여전히 expected 7 / DOM 6. 한 순위 컨트롤의 두 목적지 선택도 미결정 |
| SCREEN routes | `5208c86`, `696289a` / `25a2e0d`, `eb52e02` | 최초 실제 재측정 102/109. 수정 대상 25Q/3KM/DO/2GZM PASS. G5B/2FR9 후속 65/65 및 독립 38/38 승인 | `696289a` 반영 뒤 실제 Electron 재측정. 3W9B/2I7Z 및 1XA2/2DZE 외부 계약 공백 |

별도 backend 전체 검사는 AUTH 서버 변경 전 고정 worktree `8a9ef03`에서 3,793 passed / 6 skipped / 1 warning으로 종료됐다. 이 수치는 이후 AUTH·UI 통합의 전체 backend 통과 증거가 아니다. `738a57d` 통합 영수증도 app 3,539/3,540에서 글로벌 Python 환경 때문에 1건 실패했고, 올바른 venv로 해당 파일 42/42만 재검증했다. 현재 `eb52e02`에 대한 fresh 전체 app/backend 통합 검증은 남아 있다.

## live 및 fixture 판정 경계

- MINI 11/11·10/10은 private profile과 fake provider를 사용한 fixture 결과다. 장중 live 서비스 정상 판정으로 확대하지 않는다.
- SCREEN 102/109와 CARD 결과도 Paper fixture 실행이다. 실제 금융 데이터의 정확성, freshness, pagination, 실제 사용자 클릭 결과를 증명하지 않는다.
- BOOT wrapper 첫 실행은 exit0만 남고 durable result가 없어 `NOT_PROVEN`이다. 승인된 wrapper로 결과 JSON·단계·종료 경계를 남긴 실제 재실행이 필요하다.
- AUTH 변경은 실제 계좌 값을 자동 연결하지 않았다. alias A/B·누락·미등록·reconnect를 deterministic fixture로 검증하며, live 계좌 전환이나 주문/OAuth는 실행하지 않는다.
- 제품 launcher는 8010을 고정 사용한다. 실행 중인 사용자 backend를 종료하거나 충돌시킬 수 있는 전체 cold self-spawn은 수행하지 않았다.

## 남은 결함과 외부 계약

1. **AUTH realtime 미완료:** HTTP control과 WS stream에서 `backendAlias`와 renderer의 계좌 대상 ID를 분리해야 한다. 계좌 변경 중 pending REG reset, 이전 A 카드의 늦은 release가 새 B 구독을 제거하는 문제, reconnect 늦은 REG의 REMOVE 경계까지 구현했으나 현재 미커밋·review 보완 중이다.
2. **BOOT actual 미증명:** `b62680b` wrapper는 승인됐지만 실제 재실행 결과가 없다. 새 실행에서 durable 단계 기록, 결과 JSON, owned process cleanup을 확인해야 한다.
3. **SCREEN actual 재검증 대기:** 후속 `696289a`가 통합된 `eb52e02`에서 Electron 전수 검사를 다시 실행해야 한다. 기존 102/109를 새 HEAD의 결과로 재사용하지 않는다.
4. **CARD-001 선택 대기:** 2R3M-1은 통과했지만 137X-2는 상태 7/6이다. 순위 컨트롤 하나에 연결된 두 목적지 중 어느 UX가 권위인지 사용자가 선택하기 전 임의로 고치지 않는다.
5. **미구현 화면/계약:** 3W9B(동시 실행 상태), 2I7Z(키우미 얼굴), 1XA2·2DZE(계약 문장)는 제품 내부 구현만으로 확정할 권위가 없다. fixture를 만들어 통과시키지 않고 외부 정본 계약을 기다린다.

## 감사 전체의 지속 한계

- 원천 1,396행은 source reconciliation row이며 고유 제품 기능 수가 아니다. 조회 실제 263/264, custom REST 55, WS stream 1은 실행 수이지 PASS 수가 아니다.
- WS는 0B fresh event 1건만 관찰했다. 나머지 22종, upstream REMOVE ACK, 충돌 없는 subscription ownership은 미검증이다.
- MCP 12도구·58action은 protocol metadata 확인이며 기능 live 실행이 아니다.
- 장중 호스트 재부팅 전후 77분55.708초 관찰 공백은 소급 복구할 수 없다.
- 장후 61개 선택 표본 중 앱 신원 확인 36, 이전 PID 부재 20, process probe 실패 5였고, endpoint 4곳 모두 HTTP200은 57개였다. 15:49·15:50·16:06·16:07에는 실패/timeout이 있었다. 사용자 runtime 교체와 시간적으로 겹쳤지만 정확한 인과관계와 장애 지속시간은 입증하지 않았다.
- 마지막 16:30:00.002 표본의 앱 신원 및 HTTP 4/4=200은 종료 경계 한 표본이다. 모든 기능 정상 판정으로 사용하지 않는다.

## 남은 실행 순서

1. AUTH realtime 수정의 독립 review를 끝내고, 승인된 소유 파일만 feature commit한 뒤 `eb52e02` 위에 반영한다.
2. 승인된 BOOT wrapper를 격리 환경에서 실제 1회 재실행하고, 결과 JSON·단계·소유 프로세스 cleanup이 모두 확인될 때만 판정을 갱신한다.
3. 외부 Electron gate가 없는 것을 확인한 뒤 `eb52e02` 이후 최신 통합 HEAD에서 SCREEN 전수 검사를 실제 1회 실행한다.
4. CARD 137X-2의 권위 있는 목적지 선택을 받은 뒤 해당 상태 보드만 수정·재검증한다. 선택 전에는 7/6 실패를 유지한다.
5. 최신 통합 HEAD에서 올바른 backend venv와 private HOME/USERPROFILE을 사용해 전체 app 검사, 영향 backend 검사, AUTH/BOOT/MINI/CARD/SCREEN 집중 검사를 새로 실행한다.
6. 새 통합 검증 영수증에 정확한 HEAD, 명령, pass/fail/skip, artifact SHA, live/network/process 경계를 기록한다. 실패·미실행·외부 계약 공백이 남으면 최종 판정은 계속 `PARTIAL`이다.

## 근거

- `docs/audits/market-session-20260907/POSTCLOSE-RESULT.md`
- `docs/audits/market-session-20260907/FIX-PROGRESS.md`
- `docs/audits/market-session-20260907/DEFECTS.md`
- `docs/audits/market-session-20260907/COVERAGE.md`
- `C:\Projects\DAOU.Athena-market-fix-integration-20260907\artifacts\integration-verification-20260907\integration-verification-738a57d.json`
- MINI: `C:\Projects\DAOU.Athena-fix-HARNESS-MINI-001\app\captures\paper-gates\PAPER-MINI.json`
- CARD: `C:\Projects\DAOU.Athena-fix-CARD-001\app\captures\paper-gates\PAPER-CARDS.json`
- SCREEN: `C:\Projects\DAOU.Athena-fix-SCREEN-ROUTES\app\captures\paper-gates\PAPER-SCREENS.json`
