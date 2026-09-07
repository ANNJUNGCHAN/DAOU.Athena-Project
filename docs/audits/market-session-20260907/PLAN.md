# 2026-09-07 아테나 장 운영 전수 검사 계획

- 요청: 장 시작 30분 전, 장중, 장 마감 후 1시간의 모든 사용자 기능을 실제로 검사하고, 불량을 상세 기록한 뒤 독립 수정 작업을 병렬 진행한다.
- 작업 브랜치: `codex/market-session-audit-20260907`
- 기준 main: `ac8452f5b62a338d74826ac27cf65da12d99320b`. main 병합/배포는 이 점검의 완료 조건이 아니다.
- 날짜/시간대: 2026-09-07, Asia/Seoul. 현재 첫 관찰 08:22에는 Athena Electron 및 8010 리스너가 없었다. 이는 앱 미실행 상태이며 코드 결함으로 단정하지 않는다.
- 거래소 기준: KRX 정규장 09:00–15:30. 08:30–09:00 장전, 15:30–16:30 장후. 휴장/특별시간 공지 및 실제 시장 상태가 달라지면 기대 상태를 수정하고 근거를 남긴다. NXT/시간외 상태는 별도로 표기한다.
- 공식 시간표: https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T1.jsp

## 완료 조건과 증거

1. 현재 코드의 사용자 기능, 화면/상태, API/MCP operation, 실시간 feed를 원천 목록에서 전부 추출하여 고유 ID를 부여한다. 대표 항목으로 전체를 대체하지 않는다.
2. 각 행에 원천 경로, 시장 단계, 선행조건, 실제 검사 방법, 기대 결과, 관찰 결과, 실행 시각, 코드 revision, 데이터 출처/환경, 증거 파일, 판정, 관련 불량 ID를 기록한다.
3. `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_APPLICABLE`을 구분한다. 인증 부재/외부 도구 미연결/시간대 부적합/승인 필요는 통과가 아니다. 구조/fixture 통과와 live 통과를 별도 필드로 둔다.
4. 전수 목록의 모든 행에 판정 및 증거 또는 구체적 미검증 사유가 있어야 범위 정리가 완료된다. 전체 정상은 필요한 live 검사와 시간 구간이 모두 증명된 경우에만 사용한다.
5. 오늘 시간이 지나기 전에 미래 단계 결과를 작성하지 않는다. 빠진 관찰 구간은 소급 성공 처리하지 않는다.

## 전수 범위

2026-09-07 13:08 원천 대조 보강: 원본 `inventory.json`1394행은 불변으로 보존한다. 현재 기준 `inventory-expanded-20260907.json`은 모든 기존 ID와 MCP `athena__render_canvas`, `athena__save_canvas` 두 누락 표면을 포함한1396행이다. 이 추가는 소스 노출 확인이며 실제 MCP protocol/tools 호출 통과가 아니다.

| 영역 | 원천 및 검사 내용 |
|---|---|
| 시작/종료/복구 | 런처, 부팅→메인 전환, backend 준비, 계정/모델 인증, 중복 실행, 재시작, 세션/채팅/작업공간 복원, 종료 후 자식 프로세스 |
| 전체 화면/상태 | 실제 sidebar/모드/설정 항목, Paper screen/card/mini manifests와 실행 라우트의 차집합. 정상·빈 상태·로딩·오류·차단·만료·승인·반응형 상태 |
| 채팅/에이전트 | 등록된 provider, 도구 선택, 사용자 중단, 도구 진행/오류, 프로젝트/대화 검색·선택·보존, 그래프/지식 근거/불확실성 |
| 금융 조회 | capability assignment와 generated registry의 모든 read operation. 종목/ETF/지수/금/ELW/업종/투자자/프로그램/계좌 등 실제 파라미터와 페이지네이션 |
| 실시간 | 모든 WS operation, 구독→REAL 수신→갱신/중복/순서→구독 해제/재연결. 첫 프레임 지연/갱신 간격/끊김과 source timestamp, 시장 단계별 수신 기대치 |
| Canvas/키우미 | 모든 카드·차트·호가·미니 카드 라우팅/표시/탭/새로고침, 내용과 실제 source/수치/시각 일치, 거래중단/오류/오래된 데이터 표기 |
| 백테스트 | 전략 제안·편집·검증·실행·결과·히스토리·출처 지도·진행/실패/재시도. 테스트용 로컬 데이터/프로젝트를 사용하고 실주문 배포와 분리 |
| 루틴/알림/플러그인 | 목록/제안/설정/실행상태/수정주기/중단/보존, 도구 노출 및 권한. 실서비스 외부 발송은 하지 않고 격리 검증과 live 구독을 구분 |
| 주문/계정/OAuth | 모든 관련 operation 존재 및 UI 입력/검증/승인/취소·정정 화면과 backend 권한 거절을 격리 환경에서 검사. 실계좌 주문·정정·취소 및 토큰 재발급/계정 변경은 전송하지 않음. live 실행 경계는 명시적 미검증 |
| 자원/장시간 안정성 | CPU/메모리/프로세스/HTTP 상태/WS 상태/에러율/응답시간을 주기 관찰. 절대 기준이 없는 성능 수치는 baseline 및 변화량으로 기록 |

초기 문서의 19 capability/299 operation(264 read, 23 WS, 12 order), OAuth 2개는 참고 기대치다. 현재 코드에서 다시 산출해 목록 및 차집합을 고정한다. 기존 WS sweep의 19종만으로 전체 23종 통과를 주장하지 않는다.

## 시간별 실행

| KST | 실행 |
|---|---|
| 지금–08:30 | 브랜치/환경/설치 확인, 앱 기동, /health와 /ready 분리, 원천 인벤토리/자동검사 안전성 확인, 계획 독립 검토 |
| 08:30–09:00 | 장전 상태 baseline, 인증/계정·시세 준비, 모든 기본 화면과 대기·오류 상태, 연결/시장 상태, 전일 데이터 시각 |
| 09:00–09:15 | 개장 전환, 가격/거래량/호가의 실제 갱신, 차트/Canvas/키우미 정합성, WS 첫 프레임 |
| 09:15–15:20 | 전체 operation/화면/상태를 분할해 전수 실행. 안전한 read 호출은 공급자 제한에 맞춰 순차/제한 동시성 사용. 일반 상태는 5분 간격, 전수 결과는 누락 목록을 줄이며 누적 |
| 15:20–15:30 | 종가 단일가 상태/화면 전환/실시간 유지/정규장 종료 경계 |
| 15:30–16:30 | 정규장 마감과 시간외 구분, 종가/일봉/거래량 반영, stale/empty 표기, 구독 해제/재연결, 메모리/보존/종료 정리 |
| 16:30 이후 | 전수 대조표와 상세 불량 보고 확정, 미검증 구간 명시. 확인된 불량을 파일 소유 범위별 병렬 수정→회귀 검사→독립 리뷰. 장중 재검증 필요 건은 다음 실측 전까지 미완료로 유지 |

## 실행 및 안전 경계

- 기존 launcher를 통해 시작하고 기존 사용자 작업/DB/다른 프로세스는 삭제하거나 광범위 종료하지 않는다. 검사 하네스는 가능한 한 고유 profile·port·artifact 경로를 사용한다.
- 실제 연결은 설정된 Kiwoom/provider만 사용하며 임의 데이터 공급자로 바꾸지 않는다. mockapi의 실측은 모의 도메인 실측으로 표기한다.
- 실시간 REG/REMOVE는 검사 소유 구독만 사용한다. 기존 사용자 구독을 지우거나 전체 해제를 호출하지 않는다.
- 실주문/외부 메시지/유료 작업/파괴적 동작은 자동화 허용 목록에 넣지 않는다. 주문·OAuth 구조 검증은 격리된 테스트로 수행한다.
- 자격증명·토큰·계좌번호·민감 원문은 결과에 저장하지 않는다. 인증 실패를 반복 호출로 밀어붙이지 않는다.
- 모델/백테스트가 유발하는 동작은 검사 항목과 부수 효과를 확인한 뒤 테스트용 범위에서만 실행한다.
- 관찰 중 baseline 코드 변경은 하지 않는다. 하네스/문서 변경은 기록한다. 코드 불량 수정은 별도 소유 lane에서 만들고 적용 revision과 재기동 시각을 기록하여 관찰 전후가 섞이지 않게 한다.

## 불량 기록과 병렬 수정

각 불량은 ID/제목/심각도/최초·최종시각/시장단계/기능 ID/환경과 revision/선행조건/재현 절차/기대값/실제값/민감정보 제거한 로그·화면/빈도/사용자 영향/추정 원인과 확인 근거/관련 파일/소유자/회귀 테스트/수정 후 재검증/남은 live 검증을 포함한다.

분류는 코드 결함, 환경·인증 차단, 검증 하네스 결함, 시장 조건, 아직 미검증으로 구분한다. FAIL과 BLOCKED를 동일시하지 않는다. 심각도는 P0(잘못된 금융 동작/데이터 손실), P1(핵심 기능 사용 불가), P2(일부 기능/상태 오류), P3(경미한 표시/사용성)다.

수정 lane은 Electron/화면, backend/조회, 실시간/수명주기, 백테스트/루틴, 검증 하네스로 나누되 실제 파일 충돌 여부에 따라 배정한다. 같은 파일을 두 lane에서 수정하지 않는다. 작성자와 리뷰어를 분리하고 재현 회귀 테스트→수정→관련 테스트→독립 검토→live 재검증 순서를 지킨다.

## 지속 실행

이 작업에 연결한 Codex heartbeat가 점검 시간 동안 상태·증거·누락 목록을 이어간다. 관찰 변화가 없으면 알림을 반복하지 않고, 새로운 불량/차단/복구/완료/사용자 조치 필요만 알린다. PC/앱/연결이 꺼져 생긴 공백은 기록한다. 16:30 이후 결과와 남은 수정 작업을 정리하고 오늘 관찰 자동화를 종료한다. 자동화 실행 사실은 실제 도구 결과로 확인한다.

## 산출물

- 본 계획 `PLAN.md`
- 전체 기능 원천 대조 인벤토리 및 누적 결과
- 시각별 관찰 원본/요약: `artifacts/market-session-audit/2026-09-07/`
- 상세 불량 및 수정 상태: 이 폴더의 `DEFECTS.md`
- 단계별/전체 판정과 미검증 목록: 이 폴더의 `STATUS.md`

## 실행 원천과 대조 게이트

| 집합 | 정본 경로 | 시작 시 기대 수 |
|---|---|---:|
| operation | `backend/ref/kiwoom-screen-definitions.json`, `backend/ref/kiwoom-common-screen-manifest.json` | 301 = read 264 + WS 23 + order 12 + OAuth 2 |
| capability | `backend/ref/kiwoom-capability-assignment.json`, `docs/api/19-capability-api-inventory.md` | 19, non-OAuth operation 299 |
| Paper 화면 라우트 | `app/lib/paper-screen-routes.js` | 90 |
| Paper 카드 | `backend/ref/card-surface-templates/index.json` | 96 |
| Kiumi 카드별 매핑 | `backend/ref/kiumi/kiumi-ledger.jsonl` | 96, runtime 표현과 별도 |
| 미니 런타임 표현 | `app/lib/paper-screen-routes.js`의 mini envelope 집합, `app/orb.js` runtime 분기 | 10 |
| 모드·설정·대표 질의 | `app/lib/live-full-catalog.js` | 5 / 4 / 6 |
| 실제 검사 명령 | `app/package.json`, `app/scripts/run-verify-suite.js` | 명령별 fixture/live 분리 |

`node scripts/market-session-audit/inventory.mjs`로 원천 ID를 추출한다. 원천 집합과 대장 집합의 양방향 차집합이 0이고 ID 중복이 0이어야 대장이 완전하다. 각 집합 기대 수가 달라지면 원천 변화인지 추출 누락인지 조사하여 설명을 붙인다. 결과 대장의 각 기능 ID 역시 원천에 존재해야 한다. 6개 live 질의는 전체 operation 결과를 대체하지 않는다.

Kiumi 카드별 매핑 96행과 미니 런타임 표현 10개는 독립 축이다. 미니 표현은 10/10, 중복 0, 누락 0을 검사한다. Ledger에서 현재 사용하는 grammar 6종은 runtime 표현 10종을 대신하지 않는다. 참고/폐기/계약용 Paper 보드는 실행 기능으로 합산하지 않고 분류·사유를 둔다. Kiwoom 외 아테나 자체 API/MCP(프로젝트, 대화, brain/graph, 백테스트, 루틴, 플러그인, 권한)도 별도 원천 목록으로 대조하며 301개 금융 operation에 포함된 것으로 가정하지 않는다.

자체 HTTP의 최종 정본은 해당 실행 revision의 `/openapi.json`이다. `(method, path, operation_id)`를 고유 ID로 추출하고 301 Kiwoom operation 집합과 구분하여 대장과 양방향 diff 0을 확인한다. backend 준비 전에는 `backend/athena_api/api/*.py`의 AST router decorator 정적 목록(초기 조사 121개/19파일)을 후보로 만들되, runtime 대조는 `BLOCKED_BACKEND`로 둔다. `main.py` 직접 health/ready route와 WebSocket route는 OpenAPI에서 빠지는 항목이 있으므로 별도 정적 source 및 live 관찰로 보충한다.

MCP 최종 정본은 실제 게이트웨이 `tools/list`의 qualified tool ID이다. builtin, 승인된 upstream, 차단된 도구를 분리하고 대장과 양방향 diff 0을 검사한다. 도구 내부 `action` enum도 검사 항목으로 분해한다. 실행 시각/revision 및 registry·consent fingerprint를 기록하여 동적 원천을 고정한다. `backend/athena_mcp/*_tools.py`의 `types.Tool(...)`와 `server.py`의 등록 집계는 기동 전 정적 후보 원천이다. 연결/권한 때문에 runtime 목록을 얻지 못하면 해당 대조는 BLOCKED로 남기며 노출 설정을 임의 변경하지 않는다. IPC는 `app/main.js`, `app/preload.js`, `app/lib/main/*.js`의 handle/on 및 bridge channel 리터럴을 별도 추출하고 동적 채널을 미해결 목록으로 기록한다.

`node scripts/market-session-audit/observer.mjs`는 시각별 one-shot 상태 관찰이다. `node scripts/market-session-audit/read-sweep.mjs`는 dry-run으로 모든 read 항목의 필수 입력과 안전성 분류를 만든다. 실제 읽기는 검토 완료 후 `--execute`로만 실행한다. 준비되지 않은 CLI는 성공으로 가정하지 않고 STATUS에 구현/검증 상태를 기록한다.

각 read 행에는 route/method, source category, 입력 필드와 안전한 값의 근거, pagination 입력/출력 계약, 시간대별 데이터 기대값을 붙인다. 의미 있는 실제 입력이 없는 경우 `BLOCKED_INPUT`과 누락 필드를 남긴다. 응답 한 페이지 확인과 전체 페이지 검증을 분리한다. 실계좌/개인정보가 필요한 항목은 민감 원문을 저장하지 않는다.

주문/OAuth에 대한 테스트 프로세스 요청 목록과 하네스 allowlist 거절 테스트로 금지 route 요청 0건을 입증한다. 실제 OAuth 갱신은 정상 앱 기동의 내부 동작 여부를 별도 기록하고, 검사 코드가 직접 재발급을 요청하지 않는다. WS는 실행별 소유 group/operation/REG/REMOVE 및 잔여 구독을 기록하고, 하드코딩 그룹이 기존 그룹과 충돌하면 새 그룹 또는 격리된 WS 환경에서만 실행한다.

## 예약 실행과 복구

- 등록 완료: heartbeat `automation-2`, 상태 ACTIVE, 5분 간격, 현재 작업으로 복귀.
- 추가 전환 체크포인트: 08:30, 08:40, 09:00, 15:30, 15:40, 16:00, 16:30 KST. 각 시각의 실제 관찰 시각/지연/누락을 기록한다. 예약 등록과 실제 wake는 서로 다른 증거이며 첫 wake 이후 STATUS에 실행을 기록한다.
- 실패 복구는 해당 실패의 원인에만 한정한다. 앱 미기동이나 인증 부재를 먼저 기록한 뒤 로컬에서 복구 가능한 실행환경은 복구한다. 접근 불가능한 계정/외부서비스는 BLOCKED로 유지한다.

## 수정 분기 및 통합

오늘 baseline 관찰 중에는 전용 감사 브랜치에서 하네스/문서만 수정한다. 실제 제품 결함은 ID별로 파일 소유권을 고정하여 `codex/market-fix-<ID>` 브랜치와 `C:/Projects/DAOU.Athena-market-fix-<ID>` worktree를 기준 제품 revision에서 만든다. 제품 파일이 겹치는 결함은 같은 lane에서 순차 처리한다. 하네스 결함은 감사 브랜치의 전담 소유자가 수정한다.

결함별 변경은 원인 재현 및 회귀검사와 독립 리뷰 후 감사 브랜치에 통합한다. 통합 시각/revision을 기록하고 그 이후 관찰은 새 revision으로 분리한다. 공유 dirty 파일을 일괄 stage하거나 사용자 WIP를 포함하지 않는다. main으로의 병합/원격 push는 이번 점검의 자동 단계에 포함하지 않는다.
