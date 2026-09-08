# 장후 수정 진행

예정 관찰 종료 및 상세 집계는 `POSTCLOSE-RESULT.md`에 있다. 이 문서는 수정 진행표이며 아직 제품 전체 완료 보고가 아니다. 사용자 main은 변경하지 않는다.

| 작업 | 작업 폴더 / 기준 | 현재 상태 |
|---|---|---|
| BOOT-001 시작 병목 | `C:\Projects\DAOU.Athena-fix-BOOT-001` / ac8452f | 독립 APPROVE, commit31a62dd. identity/API29·selector339·추가경계5 통과. 합성3525 성능 개선, 실제 데이터 gate는 남음 |
| BOOT-002 중복 spawn | `C:\Projects\DAOU.Athena-fix-BOOT-002` / ac8452f | 새 재현2개 baseline 실패→수정32/32. 독립 APPROVE, commit2865721 |
| BOOT-003 회복 표시 | `C:\Projects\DAOU.Athena-fix-BOOT-003` / ac8452f | callback/broadcast 예외도 격리 후 독립 APPROVE. 확대82/82, commit2af8b70 |
| AUTH-002 계좌 전달 | `C:\Projects\DAOU.Athena-fix-AUTH-002` / baseline ac8452f 조사 후53055ac fast-forward | 명시 backendAlias 연결 UI·저장·권위 목록 재검증 구현. 관련120/120 및 앱3517/3517 통과, 독립 검토 중. 실제 계좌 설정 미변경 |
| 카드·화면 진단 | `C:\Projects\DAOU.Athena-fix-DIAGNOSTICS` / main53055ac | static96개 board 검사는 통과하나 registry stale 실패. mount94/96, 137X-2와2R3M-1 실패. 화면 검사 진행 |
| HARNESS-MINI-001 | `C:\Projects\DAOU.Athena-fix-HARNESS-MINI-001` / main53055ac | 격리 수정3/3 및 독립 승인 후 실제1회 실행: rendered0/11, grammar0/10, mount_failed. boot handoff는 성공했으나 이후 카드 생성 경로가 미작동하여 후속 진단 중. 소유 잔존 프로세스0 |
| CARD-001 공통 문구 | `C:\Projects\DAOU.Athena-fix-CARD-001` / main53055ac | 완성된 text에 접사를 중복 적용하는 재현·수정21/21, 독립 검토 중.137X-2의 한 순위 컨트롤에 두 목적지가 매핑된 모호성은 별도 결함으로 보존 |
| SCREEN-ROUTES | `C:\Projects\DAOU.Athena-fix-SCREEN-ROUTES` / main53055ac | 실제 IPC/state를 이용한 fixture 도달성과 검증 계약 보완. 정본·ratchet을 낮추지 않음 |
| 통합 후보 | `C:\Projects\DAOU.Athena-market-fix-integration-20260907` / main53055ac | BOOT-002→BOOT-001→BOOT-003 순서로 반영, 현재376e836. AUTH/카드/화면은 아직 미반영 |

17:03:34.504부터 고정된 별도 `C:\Projects\DAOU.Athena-market-fix-backend-verify`(8a9ef03)에서 실행한 백엔드 전체 pytest는 17:30:30.810에 exit0으로 종료됐다. 3793 passed, 6 skipped, 1 warning이며 pytest 측정1553.30초, wrapper1616306ms다. import가 그 worktree를 가리킴을 먼저 확인했고, 별도 HOME/USERPROFILE/임시 폴더와 최소 환경으로 기존 사용자 DB·자격증명을 분리했다. 실행 session48750의 최종 출력으로 확인했다. 경고는 Starlette TestClient의 httpx 사용 중단 예정 안내다. 6 skip의 개별 실행 사유는 -q 출력에 없으며 통과 수에 포함하지 않는다. 이 결과는 후속 AUTH 서버 인증 변경을 포함하지 않는다.

`audit_test_timing`은 통합 후보의 `scripts/market-fix-tests/`만 소유하여 실제 Electron+별도 포트의 계좌 없는 backend를 이용하는 BOOT 결합 fixture를 작성한다. 합성3525 입력이며 제품 전체 cold-start와 구분한다. 독립 격리 검토 전 실제 실행하지 않는다. 다른 lane은 이 미추적 폴더를 stage하거나 수정하지 않는다.

## 계좌 연결 결정

사용자는 “기존 계좌 설정에서 사용할 서버 계좌를 직접 연결”을 선택했다. 기존 로컬 UUID나 표시 별칭으로 서버 계좌를 추측하지 않는다. 별도 명시 연결 값을 저장하고 `/ready/accounts`의 권위 있는 목록으로 검증하며, 누락·미등록 상태에서는 selector/render-plan 첫 요청 전에 차단한다. 두 요청은 동일한 검증된 서버 계좌 헤더를 사용한다. 계좌 설정 UI·저장·재로딩·main 배선과 A/B 및 누락·미등록 회귀를 함께 구현한다. 실제 사용자 계좌 연결 값은 자동 설정하지 않는다.

## 검증 제약

17:40 후속 검토: AUTH는 3 HIGH/1 MEDIUM으로 REQUEST CHANGES다. 계좌 목록 bearer 인증 보장, 두 데이터 POST redirect 차단, 오래된 연결 저장의 최신 선택 덮어쓰기 방지, main 배선의 실제 실행 회귀를 보완한다. 구현 완료/단위 통과를 승인으로 간주하지 않는다.

BOOT 결합 fixture의 env allowlist·private cwd·미측정 외부 호출 수 표현 지적은 수정 후 독립 APPROVE를 받았다. helper6/6, JS3개 구문, Python AST 통과이며 실제 실행은 아직 없다. MINI 최초 실패 원인은 private chat history DB 경로 누락으로 provider 전에 차단된 것으로 확인됐다. 경로 격리와 제출 확인 수정58/58, 독립4/4 후 APPROVE이며 실제 재실행은 대기 중이다.

CARD formatter는 독립 APPROVE, feature eb3c0da를 통합 후보에 반영했다. SCREEN은 조건 대기·G5B 계약 보완60/60 및 독립33/33 APPROVE 후 feature5208c86을 반영하여 현재 통합 HEAD25a2e0d다. static93/95의 미라우팅2개는 보존한다. 외부 card-buttons 검사 root49876이18:00에도 활성이라 실제 Electron 검사는 대기 중이다. 미구현 동시 실행 화면·얼굴 계약 충돌·헤더 문구 불일치를 임의 fixture로 덮지 않는다.

AUTH 후속 구현은 관련 app99/99, backend accounts42/42, backend client21/21, 전체 app3523/3523을 보고했고 recovery_probe_review 재검토 중이다. /health와 /ready는 익명 상태 점검을 유지하며 /ready/accounts의 계좌 목록은 bearer 검증한다. 실제 사용자 계좌 연결은 변경하지 않았다.

18:08 재검토에서는 기존 AUTH 지적4개 해소를 확인했지만, 신규 설정 IPC2개가 preload 허용 목록에 없어 실제 화면 버튼이 비활성화되는 HIGH 결함을 추가 발견했다. preload와 실제 bridge 회귀를 보완 중이며 AUTH는 아직 REQUEST CHANGES다. 별도 MINI feature2ef39c9는 승인된 해시 그대로 통합하여 현재 HEAD2004ef5다. 외부 Electron49876는18:08에도 활성이다.

18:16 이후 최신: AUTH preload 지적도 보완 후 최종 독립 APPROVE, feature818d022를 반영했다. 승인 BOOT fixture02acceb까지 포함한 최종 통합 HEAD는738a57d다. AUTH 최종 app3524/3524, 커밋후 관련122/122, backend42/42 및 client21/21은 기능 브랜치 증거이며, recovery_evidence_verify가 통합 HEAD의 전체 앱 검사·영향 backend 집중 검사·main.js 의미 병합을 별도로 검증 중이다. 원본 main에는 병합하지 않았다. 실제 Electron은 외부root49876가18:16에도 활성이라 대기다.

18:31 통합 검증에서 AUTH 범위 누락 발견: selector-fast-path의 dispatch와 cold 재dispatch는 검증된 계좌 헤더를 전달하지 않아 backend 기본 계좌로 내려간다. direct REST 수정만으로 AUTH 전체 완료를 주장할 수 없으며 author가 진입점 전수 확인과 후속 수정을 진행한다. 통합 app3539/3540(글로벌 Python환경 실패1), 올바른 venv 해당파일42/42, mini64/64, backend집중92/92이며 전체앱 PASS로 합치지 않는다.

CARD 실제 검사에서 fixture가 완성 문구를 원시값으로 보내는 추가 원인을 확인했다. board-probe 두 파일을 explicit preformatted 입력으로 보완 후 재측정: 2R3M-1 네 폭 PASS, 137X-2 텍스트 오류0/상태7대6 실패 유지. PAPER-CARDS.json SHA5FD14FEDC2358DCA2E1D950130659B2456ED2291EBF756AE47F39754CBD30E92. 추가 fixture는 독립 검토 중이며 미커밋이다. 순위 버튼 두 목적지 동작은 사용자에게 선택을 요청했고 임의로 결정하지 않았다. 외부 root35236가18:31 새로 시작되어 다른 Electron 검사는 다시 대기한다.

18:40 최신: CARD 추가 fixture 독립 APPROVE 후 커밋 요청. 외부 gate 종료를 확인해 MINI 실제1회 검사를 재개했다. AUTH selector 후속은 orderDraft의 handled:false 응답이 모델로 내려가는 추가 HIGH를 보완 중이다. 이후 chart-page/series-page/legacy realtime/stock-master 및 integrated realtime alias 출처도 전수 범위로 확인·수정한다. 통합 검증 영수증은 artifacts/integration-verification-20260907/integration-verification-738a57d.json이며 PARTIAL을 유지한다.

18:49 정정/최신: MINI는 실행 직전 새 외부 gate 발견으로 실제0회였다. 현재 외부root33108(18:48:37 생성)이 활성이다. CARD fixture196aba953을 통합하여 HEAD25dc73f. AUTH handled:false 후속은 실제 main stage VM 회귀31/31 및 기능브랜치 app3534/3534 후 재리뷰 중이다.

18:56 최신: selector 후속 독립 APPROVE(feature d60e44b)를 통합해 HEADed65de5다. chart-page/series-page/stock-master는 공용 데이터여도 인증된 runtime을 선택하는 전송 경로라 명시 alias가 필요함을 확인했다. author가 이 데이터 조회 slice7파일을 보완한 뒤 realtime을 별도 보완한다. integrated renderer accountId는 실제 계좌 대상값으로 backend alias가 아니며 그대로 재사용하지 않는다. 외부33108은18:56에도 활성이다.

19:11 최신: 승인 MINI feature2ef39c9에서 실제1회 exit0, render11/11·grammar10/10·실패0·소유잔존0을 확인했다. PAPER-MINI.json SHAA9ED21BA6FFFA40C33B191B7E979496D347C93B979041DBADB92693016D341F2. fixture/fake provider 증거이며 live서비스나 screenshot 검증이 아니다. 슬롯을 BOOT 결합 실제검사에 넘겼다. AUTH data slice는 chart lineage 포함9파일84/84 및 기능브랜치 app3546/3546 후 독립 리뷰 중이다.

19:23 최신: AUTH data slice 독립87/87 및70/70 APPROVE 후 feature26e5d8e를 반영하여 통합 HEADf91637e. 다음 realtime6파일에서 HTTP control/WS stream의 backendAlias와 renderer 계좌 대상값을 분리·검증한다. BOOT 실제1회는 호출부0.414초 exit0/stdout없음, private profile 생성 후 결과JSON 없음으로 NOT_PROVEN이다. 소유잔존0이며 PASS가 아니다. author가 durable 단계/종료 증거와 실행 wrapper를 보강하며 새 독립검토 전 재실행하지 않는다. 외부card-buttons48252(19:18:32 생성)가19:23활성이라 SCREEN은 대기한다.

19:52 최신: SCREEN 실제1회102/109,265306ms. 수정25Q/3KM/DO/2GZM은PASS. 미구현3W9B/2I7Z,외부계약공백1XA2/2DZE,문구4TY,실제검사불일치G5B와2FR9가남는다. PAPER-SCREENS.json SHAF83C17B6DC5F6C355669CE267D8C83AE040791AB20F14690D040906744F2A067. G5B는Snap빈history가CSS로숨겨져visible1기대가잘못됐고2FR9는flow내용전체미생성으로후속진단한다. 소유잔존0. profile삭제자동거절후보존,다음probe도기존삭제로우회하지않도록고유privateprofile개선후리뷰한다. BOOTwrapper는최종독립APPROVE를받아커밋요청했으며실제재실행전이다.

20:06 기록: BOOT후속wrapper는b62680b에승인커밋되어통합clean,실제재실행대기. SCREEN G5B/2FR9후속및고유profile5파일64/64후독립리뷰중이었다. AUTHrealtime는계좌변경시pending integrated REG가reset을막는문제와이전A카드의symbol-only release가새B구독을해제하는HIGH2를독립검토에서재현해보완했다. 실제서버/계좌전환을실행한증거는아니다.

20:35 최신: SCREEN후속7파일은실제측정함수VM검사65/65 및독립38/38 APPROVE,feature696289a를통합하여HEADeb52e02. 실측재실행은외부36196지속실행으로대기. AUTHrealtime는reconnect late REG의강제REMOVE경계까지보완하여기능브랜치전체3565/3565후최신리뷰중이며미커밋이다.

제품 backend launcher는8010을 고정 사용한다. 현재 사용자 서버를 침범하는 전체 cold self-spawn은 실행하지 않으며, 격리 가능한 local fixture/컴포넌트 검사와 남은 실제 acceptance를 구분한다. 감사 종료·수정 대상 테스트 통과만으로 전체 장중 기능의 성공을 주장하지 않는다. feature별 독립 리뷰 뒤에만 소유 파일을 로컬 commit하며 main 병합·push는 하지 않는다.
