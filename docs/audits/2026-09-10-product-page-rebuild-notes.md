# Athena 제품 원고 재구성 근거

2026-09-10 · 조사 시작 HEAD `4dcda24dd9073a94ff08e32ca365301612701f47` · 현재 작업 사본의 변경 내용 포함

최종 문구는 [제품 페이지 원고](C:/Projects/DAOU.Athena/docs/audits/2026-09-10-product-page-copy.md)에 있다. 이 문서는 코드와 화면 계획을 다시 읽고 어떤 제품 경험을 골랐는지 기록한다.

## 작성 전제

처음에는 주요·서브 기능의 개수 제약 없이 재구성했다. 이후 사용자 지정에 따라 각 제품의 주요 기능을 3개로 정하고 나머지를 서브로 분류했다. 서브의 홀수 조건이나 주요 기능과 서로 다른 개수 조건은 적용하지 않는다. 기능명은 대부분 1~2단어로 유지하고, 확장 기획도 완성된 기능으로 전제한다.

모드별 화면과 대화 처리, 도구 호출, 기억 저장, 알림 실행, 전략 실험의 연결을 다시 읽어 기능을 골랐다. 아래 표는 기능을 선발한 근거이며, 최종 페이지에서는 제품을 대표하는 3개를 먼저 소개하고 나머지를 서브로 배치한다.

## 새 구성

| 제품 | 소개할 경험 | 편집 판단 |
|---|---|---|
| 아고라 | 화면 호출 → 화면 대화 → 자료 대화 → 대화형 주문 → 대화 설정 | 금융 데이터의 종류보다 질문이 화면과 행동으로 이어지는 경험을 설명한다. 파일과 폴더, 모델과 사고 정도, 목표·계획 모드도 사용자가 지정한 가치로 유지한다. |
| 메티스 | 활동 기억 → 클러스터 → 지식 대화 → 맞춤 추천 → 기억 수정 | 저장·시각화만 강조하지 않고, 내 지식으로 답하고 그 지식을 스스로 바로잡는 경험까지 연결한다. 요약 뷰는 활동 기억 설명에, 원문·변경 이력은 지식 대화에, 숨은 연결은 클러스터에 포함한다. |
| 아이기스 | 맞춤 알람 → 대화형 자동화 → 전방위 감시 | 나에게 중요한 이유, 조건과 일정의 작성 방식, 감시 데이터의 범위를 각각 설명한다. 감시와 루틴을 다시 별도 항목으로 쪼개지 않는다. |
| 에르가네 | 투자정보 연동 → 서비스 연동 → 전 모드 활용 → @ 호출 | 연결 이후의 활용이 중심이다. 모든 모드에서 같은 MCP를 사용하는 강점을 독립 항목으로 유지하고, 앱에서 출처를 직접 지정하는 @ 경험을 구체적으로 설명한다. |
| 팔라스 | 바이브코딩 → 노드 대화 → 백테스트 → 투자 진단 → 실험 비교 → 조건 탐색 | 코드·노드·결과·비교·최적화가 서로 다른 질문에 답하는 화면이므로 하나의 ‘전략 개선’으로 뭉개지 않는다. 조건 탐색은 현재 구현에서 다시 확인한 독립적인 강점이다. |
| 글로우 | 미니 대화 → 화면 질문 → 복귀 브리핑 | 작은 창에서 실제 질문과 결과를 다루는 기반을 먼저 설명하고, 작업 중인 화면과 복귀 시점으로 이어지는 경험을 연결한다. 알림·미니 카드는 대화 설명에 포함하고 별도 서브 영역은 만들지 않는다. |

기능은 총 26개를 유지했다. 최종 편성은 아고라 3+2, 메티스 3+2, 아이기스 3+0, 에르가네 3+1, 팔라스 3+3, 글로우 3+0으로, 주요 18개·서브 8개다. 서브가 없는 아이기스와 글로우에는 빈 서브 영역을 두지 않는다.

주요 기능은 아고라의 화면 호출·화면 대화·대화형 주문, 메티스의 활동 기억·지식 대화·맞춤 추천, 아이기스의 맞춤 알람·대화형 자동화·전방위 감시, 에르가네의 투자정보 연동·서비스 연동·전 모드 활용, 팔라스의 바이브코딩·노드 대화·백테스트, 글로우의 미니 대화·화면 질문·복귀 브리핑이다. 제목과 설명은 바꾸지 않고 순서와 분류만 조정했다.

## 다시 읽어서 달라진 판단

1. **작업을 이어주는 연결이 Athena의 공통 강점이다.** 아고라의 질문이 화면을 만들고, 메티스는 관계의 근거를 대화에 가져오며, 팔라스는 선택한 노드와 코드 변경을 실험 결과로 연결한다. 공통으로 ‘AI가 있다’는 설명을 반복하는 대신 각 모드가 이어주는 대상을 썼다.
2. **메티스는 사용자가 기억을 고칠 수 있는 제품이다.** 읽기 전용 그래프 조회 도구만 보면 이 경험을 놓친다. 별도의 편집 제안과 사람의 적용 경로를 확인해 ‘기억 수정’을 독립 항목으로 복원했다.
3. **팔라스는 실행 뒤의 실험이 중요하다.** 두 실행의 코드·설정·성과를 함께 비교하고, 여러 파라미터 조합과 주변 조합의 결과를 살피는 기능이 있다. 이를 막연한 ‘개선’ 한 항목에 넣지 않았다.
4. **@는 서버를 지정하는 경험으로 쓴다.** 현재 입력창은 승인된 MCP 서버 alias를 선택하고, 해당 서버의 도구를 우선 사용하도록 질의에 포함한다. 특정 개별 도구를 직접 실행하는 버튼처럼 설명하지 않았다.
5. **글로우의 작은 결과 화면은 실제 작업 수단이다.** 표·차트·문서 카드와 독립 대화 처리 경로를 확인했다. 작게 보이거나 움직인다는 설명 대신 작은 창에서 질문과 결과가 완결되는 경험을 앞에 둔다.

## 코드·화면 계획의 근거

아래 링크는 소개를 고르는 데 사용한 현재 코드와 저장된 Paper 원장의 대표 경로다. 이번 작업은 읽기와 원고 작성이며, 앱·계정·외부 서비스의 실행 검증을 수행한 보고서는 아니다.

| 제품 | 확인한 경로 | 원고에 반영한 판단 |
|---|---|---|
| 아고라 | [대화와 화면 문맥](C:/Projects/DAOU.Athena/app/chat.js:1558), [파일·폴더 전달](C:/Projects/DAOU.Athena/app/chat.js:2944), [모델·사고 선택](C:/Projects/DAOU.Athena/app/chat.js:2730), [질의 실행](C:/Projects/DAOU.Athena/app/main.js:4988), [주문 검토](C:/Projects/DAOU.Athena/app/chat.js:5600) | 입력, 선택 화면, 사용자 자료, 모델 설정, 실행할 주문이 같은 대화에 연결된다. 공급자 이름은 고정해 나열하지 않았다. |
| 메티스 | [요약 뷰](C:/Projects/DAOU.Athena/app/lib/graph-mode/summary-table.js:223), [노드 패널](C:/Projects/DAOU.Athena/app/lib/graph-mode/controller.js:596), [관계의 근거](C:/Projects/DAOU.Athena/backend/athena_mcp/brain_tools.py:133), [숨은 연결·확인 질문](C:/Projects/DAOU.Athena/backend/athena_api/brain/analysis.py:134), [편집 제안](C:/Projects/DAOU.Athena/backend/athena_mcp/graph_view_tools.py:285), [편집 적용](C:/Projects/DAOU.Athena/app/chat.js:2168) | 클러스터, 근거 대화, 기억 수정의 역할을 구분했다. 조회 도구가 읽기 전용인 사실과 제품 전체의 편집 가능성을 혼동하지 않았다. |
| 아이기스 | [성향 기반 제안](C:/Projects/DAOU.Athena/app/lib/agent-canvas.js:632), [자연어 감시 제안](C:/Projects/DAOU.Athena/backend/athena_mcp/routine_tools.py:84), [조건 모델](C:/Projects/DAOU.Athena/backend/athena_api/routines/models.py:41), [감시 실행](C:/Projects/DAOU.Athena/backend/athena_api/routines/runtime.py:146), [일정 처리](C:/Projects/DAOU.Athena/backend/athena_api/routines/scheduler.py:80) | 맞춤 제안, 감시 조건, 반복 일정의 실제 기반을 확인했다. 대표 카피에 코드 작성이나 단순 상태 관리 항목을 되넣지 않았다. |
| 에르가네 | [연결과 등록](C:/Projects/DAOU.Athena/app/lib/plugin-canvas.js:207), [실제 도구 조회](C:/Projects/DAOU.Athena/backend/athena_mcp/onboarding.py:255), [도구 허용](C:/Projects/DAOU.Athena/backend/athena_mcp/consent.py:271), [공통 도구 집계](C:/Projects/DAOU.Athena/backend/athena_mcp/aggregator.py:81), [서버 멘션](C:/Projects/DAOU.Athena/app/chat.js:2496), [멘션을 질문에 반영](C:/Projects/DAOU.Athena/app/chat.js:2601) | 설정·승인 절차는 연결 경험에 포함하고, 투자정보·외부 서비스·전 모드 활용을 독립 가치로 썼다. Yahoo Finance·네이버 뉴스·디스코드는 사용자가 지정한 활용 예시다. |
| 팔라스 | [전략 작성 진입](C:/Projects/DAOU.Athena/app/lib/backtest-canvas.js:3330), [노드·코드 참조](C:/Projects/DAOU.Athena/app/lib/backtest-canvas.js:3576), [거래 결과](C:/Projects/DAOU.Athena/backend/athena_api/api/backtest.py:540), [실행 비교](C:/Projects/DAOU.Athena/app/lib/backtest-canvas.js:5111), [조건 탐색](C:/Projects/DAOU.Athena/app/lib/backtest-canvas.js:5173), [최적화 처리](C:/Projects/DAOU.Athena/backend/athena_api/backtest/optimize.py:1) | 바이브코딩과 노드 대화는 만드는 과정, 백테스트와 진단은 결과를 읽는 과정, 비교와 탐색은 다음 실험을 고르는 과정으로 나눴다. |
| 글로우 | [작은 창의 표시 조건](C:/Projects/DAOU.Athena/app/lib/main/orb-window.js:162), [알림 수신](C:/Projects/DAOU.Athena/app/orb.js:949), [미니 카드 렌더링](C:/Projects/DAOU.Athena/app/orb.js:2037), [질문과 결과 전달](C:/Projects/DAOU.Athena/app/orb.js:2152), [독립 대화 실행](C:/Projects/DAOU.Athena/app/main.js:5457) | 단순 알림 배지가 아니라 질문과 결과를 처리하는 작은 작업창으로 설명한다. 화면 질문과 복귀 브리핑은 사용자가 완성 기능으로 전제한 경험을 이어서 배치했다. |

Paper는 [저장 원장](C:/Projects/DAOU.Athena/backend/ref/paper-ledger/manifest.json)의 그래프 D-2, 에이전트 A-2, 플러그인 B-2, 백테스트 8-1, 글로우 C-2를 참고했다. 특히 [글로우 대화·콘텐츠](C:/Projects/DAOU.Athena/backend/ref/paper-ledger/C-2/4TY-0.tree.txt), [미니 카드](C:/Projects/DAOU.Athena/backend/ref/paper-ledger/C-2/2LFW-2.json), [메티스 노드 패널](C:/Projects/DAOU.Athena/backend/ref/paper-ledger/D-2/31H-0.json), [플러그인 제안](C:/Projects/DAOU.Athena/backend/ref/paper-ledger/B-2/3ZJD-0.tree.txt)이 화면별 역할을 구분하는 데 도움이 됐다. 실시간 Paper 편집이나 전체 보드의 시각 검증은 수행하지 않았다.

## 사용자 확정 내용의 반영

확장 기획을 완성된 제품 경험으로 전제하라는 최신 지시는 원고 전체에 적용했다. 따라서 범용 화면 질문, 목표·계획 모드, 모든 앱 활동의 기억, 그래프 기반 맞춤 추천, 지정한 MCP 전반의 조건 감시, 화면 영역 질문, 복귀 브리핑을 소개 문구에서 미구현 항목으로 나누지 않았다. 코드 조사와 사용자 확정 내용을 함께 사용해 제품의 최종 경험을 설명했다.

금융 주문은 기존 요청대로 대화로 준비하고 사용자가 확인해 실행하는 표현을 유지했다. 이름은 ‘클러스터’, ‘전방위 감시’, ‘투자 진단’을 보존했다. 글로우에는 서브 영역과 주문 티켓을 복원하지 않았다.

## 검토 기준

- 기능 수를 맞추려고 비슷한 항목을 추가하지 않았는가.
- 각 제목이 짧은 명사형이고, 설명이 행동과 결과를 보여주는가.
- 메티스의 기억·추천, 아이기스의 감시·알림, 에르가네의 연결·활용이 구분되는가.
- 팔라스의 코드 창을 사람이 직접 코딩하는 제품으로 설명하지 않았는가.
- 사용자 확장 기획을 완성 기능으로 전제하면서도 실제 조사·실행 범위를 허위로 보고하지 않았는가.
