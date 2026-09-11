# ATHENA 기술 블로그 3편의 구현 검증

검증일: 2026-09-10 · 브랜치: codex/grok-handoff-20260909 · HEAD: 4dcda24d 및 현재 작업 트리

## 결론

**세 문서가 다루는 분야는 ATHENA의 주요 기능이지만, 제목에 해당하는 ToolRerank·A-MEM·HippoRAG 알고리즘이 ATHENA에 구현되어 있는 것은 아닙니다.**

현재 문서는 ‘논문에서 제시한 접근과 ATHENA의 다른 구현을 비교한 글’입니다. 이를 ‘ATHENA에 도입한 핵심 알고리즘 3개’로 소개하면 부정확합니다. 본문에는 미도입 설명이 있지만, 논문 부제를 번역한 제목과 논문 도식이 먼저 등장해 실제 적용 사례로 읽힐 수 있습니다.

제목을 논문 부제로 바꾸는 과정에서 이 불일치를 충분히 설명하지 못한 것은 작성상의 문제입니다. 구현 검증 결과에 맞춰 제목과 문서의 중심을 다시 잡는 것이 필요합니다. 이번 요청은 검증이므로 기존 블로그 본문·제목은 변경하지 않았습니다.

| 문서 | 제목이 지칭하는 알고리즘 | 현재 코드 판정 | ATHENA의 실제 구현 |
|---|---|---|---|
| 도구 검색을 위한 적응형·계층 인식 재정렬 | ToolRerank | 핵심 구성 미확인 | 어휘 점수화 + 조건 적합성 검증 + 제한된 후보의 병렬 분류 |
| LLM 에이전트를 위한 능동형 메모리 | A-MEM | 노트 검색·연결·진화 파이프라인 미확인 | LLM 구조화 추출 + 결정적 데이터 투영 + 출처 관리 + 규칙 기반 중복 통합 |
| 신경생물학에서 영감을 얻은 대규모 언어 모델의 장기 기억 | HippoRAG | PPR 기반 검색 파이프라인 미확인 | FTS5/BM25 + 엔티티 관계 조회 + 군집화 + 그래프 점수 + LLM 라벨링 |

‘미확인’은 블로그 문서를 제외한 관련 실행 코드의 검색과 호출 경로 검토 결과입니다. 외부 시스템 전체나 실행 중인 서비스 구성을 모두 조사했다는 의미는 아닙니다.

## 1. 도구 선택: 핵심은 ToolRerank가 아닌 제약 조건 기반 선택

**실제 구현되어 있습니다.**

- 어휘 기반 후보 점수화: operation/TR/group ID, 제목·필드·도메인·동의어·부분 일치와 질의 커버리지를 사용합니다.
- 조건 적합성 검증: MATCH / CONTRADICTION / INSUFFICIENT로 후보와 요청의 호환성을 판정합니다.
- 제한된 병렬 분류: preflight 후보 최대 3개를 대상으로 두 분류기를 실행합니다. 전역 동시 슬롯은 4개이며 첫 유효 제안을 선택합니다.
- 제안 검증과 단일 실행: 후보·operation·인자 스키마를 검증하고 채택한 제안을 한 번 dispatch합니다. 이는 다수결이나 self-consistency가 아닙니다.
- 판단 캐시와 manifest 렌더 경로도 구현되어 있습니다. 캐시는 TTL과 최대 항목 수를 관리합니다.

근거: [후보 점수화](C:/Projects/DAOU.Athena/backend/athena_api/selector/ranking.py:224), [조건 호환성](C:/Projects/DAOU.Athena/backend/athena_api/selector/compatibility.py:296), [선택 서비스](C:/Projects/DAOU.Athena/backend/athena_api/selector/service.py:158), [preflight](C:/Projects/DAOU.Athena/backend/athena_api/api/canvas_push.py:1548), [병렬 분류·검증](C:/Projects/DAOU.Athena/app/lib/main/selector-cold-hedge.js:168), [메인 호출 연결](C:/Projects/DAOU.Athena/app/main.js:4830), [판단 캐시](C:/Projects/DAOU.Athena/app/lib/main/query-cache.js:179).

**ToolRerank의 핵심과는 다릅니다.** 학습 이력에 따른 seen/unseen 후보 절단, 학습된 cross-encoder, 논문의 단일·다중 도구별 계층 재정렬은 관련 실행 코드에서 확인되지 않았습니다. API에 계층 정보가 존재하거나 후보 수를 제한한다는 사실만으로 ToolRerank 구현이 되지는 않습니다.

핵심성 판정: 금융 도구 선택 경로의 핵심 제어·판정 로직입니다. 다만 어휘 점수화·호환성 판정은 규칙 기반 알고리즘이고, hedge·캐시는 추론 실행을 최적화하는 엔지니어링입니다. 전부를 학습 기반 AI 알고리즘으로 묶으면 안 됩니다.

## 2. 투자 기억: 핵심은 구조화 추출과 출처를 보존하는 그래프 통합

**실제 구현되어 있습니다.**

- 대화는 LLM이 엔티티·관계·근거를 구조화하고 요청 ID와 source fingerprint를 검증합니다.
- 거래·보유는 정형 데이터의 결정적 투영을 사용합니다.
- 중복 통합은 별칭 일치 → 이름 토큰 Jaccard ≥ 0.6 → 이웃 집합 Jaccard ≥ 0.8 순서입니다. 이웃 비교에는 양쪽 차수 ≥ 2 조건이 있습니다.
- 후보는 Union-Find로 묶고 대표 노드를 선택합니다. 종목과 투자자 프로필은 이 유사도 통합에서 제외합니다.
- 출처 tier와 추출 명시성 confidence를 구분하고, source별 저장을 원자적으로 처리합니다. 기존 결정적·수동 관계에 대한 대화 기반 변경을 제한하고 거부 이벤트를 남깁니다.

근거: [구조화 추출 검증](C:/Projects/DAOU.Athena/backend/athena_api/brain/extraction.py:365), [거래·보유 투영](C:/Projects/DAOU.Athena/backend/athena_api/brain/ingestion.py:206), [중복 통합](C:/Projects/DAOU.Athena/backend/athena_api/brain/dedup.py:89), [명시성과 출처](C:/Projects/DAOU.Athena/backend/athena_api/brain/extraction.py:114), [관계 변경 충돌 처리](C:/Projects/DAOU.Athena/backend/athena_api/brain/store.py:1085).

**A-MEM의 핵심과는 다릅니다.** 노트 임베딩으로 관련 노트를 검색하고, LLM이 링크와 기존 노트의 문맥·키워드·태그를 진화시키는 결합 파이프라인은 확인되지 않았습니다. ATHENA의 중복 통합은 ‘동일한 대상의 병합’이고 A-MEM의 링크 생성은 ‘관련된 기억의 연결’이므로 같은 연산도 아닙니다.

핵심성 판정: Brain의 지식 구축 경로에서 핵심적인 구현입니다. ‘능동형 메모리’라는 넓은 표현보다는 추출·출처·중복 통합의 실제 절차를 제목과 본문 중심에 두는 것이 정확합니다.

## 3. 그래프 검색: 핵심은 BM25와 그래프 분석, PPR은 아님

**실제 구현되어 있습니다.**

- 검색: 엔티티 ID 조회 후 FTS5/BM25로 이름·별칭 후보를 검색합니다. 유일한 정확 이름 일치 또는 단일 후보일 때 해소하고, 모호하면 후보를 반환합니다.
- 근거 조회: 선택된 엔티티의 관계·방향·시각·출처를 조회합니다.
- 군집: NetworkX의 greedy_modularity_communities를 사용합니다.
- 중심 노드: 차수를 기준으로 순위를 정합니다.
- 숨은 연결: 서로 다른 군집을 잇는 간선에 1 / (양쪽 노드 차수의 곱)을 적용하고 후보 집합에서 min-max 정규화합니다.
- 의미 라벨: 차수 상위 최대 12개 멤버의 이름·kind를 LLM에 전달합니다. 멤버 집합과 프롬프트 기반 캐시를 사용합니다.
- 성향 요약: 최근 90일 관계 이벤트 집계입니다. 학습된 사용자 선호 점수나 독립적인 긍정 근거 수가 아닙니다.

근거: [BM25](C:/Projects/DAOU.Athena/backend/athena_api/brain/store.py:1278), [엔티티 해소](C:/Projects/DAOU.Athena/backend/athena_api/api/brain.py:1500), [군집화](C:/Projects/DAOU.Athena/backend/athena_api/brain/projection.py:193), [그래프 점수](C:/Projects/DAOU.Athena/backend/athena_api/brain/analysis.py:134), [라벨 생성과 캐시](C:/Projects/DAOU.Athena/backend/athena_api/brain/labeling.py:35), [성향 집계](C:/Projects/DAOU.Athena/backend/athena_api/brain/store.py:1564).

**HippoRAG의 핵심과는 다릅니다.** HippoRAG 방식의 OpenIE 인덱싱·동의어 임베딩 간선·질문 시드 PPR·노드-문단 행렬을 통한 문단 순위화가 결합된 검색은 확인되지 않았습니다. ATHENA에도 LLM 기반 관계 추출은 있지만, 그것만으로 HippoRAG라고 할 수는 없습니다.

핵심성 판정: 그래프 탐색 기능의 실제 검색·분석 알고리즘입니다. 현재 근거만으로 ‘신경생물학 기반 장기 기억’이나 ‘학습 기반 개인화 추천’이라고 소개하기는 어렵습니다.

## 문서 수정 권고

세 편의 분류는 유지할 수 있습니다. 다만 논문 제목을 서비스 구현의 제목으로 쓰기보다, 실제 알고리즘을 제목에 쓰고 논문은 비교·확장 연구로 배치하는 것이 맞습니다.

| 편 | 구현에 맞는 제목 제안 | 논문의 역할 |
|---|---|---|
| 1 | 제약 조건 기반 금융 도구 선택과 병렬 분류 | ToolRerank와 후보 구성·재정렬 방식을 비교 |
| 2 | 출처를 보존하는 투자 지식 추출과 그래프 통합 | A-MEM의 기억 연결·진화와 차이를 설명 |
| 3 | 그래프 기반 근거 검색과 군집 의미 라벨링 | HippoRAG의 PPR 검색을 향후 비교 대상으로 설명 |

본문에서 ‘이 논문을 서비스에 녹여냈다’고 쓰려면, 실제 채택한 구성 요소와 대응 코드가 있어야 합니다. 지금 확인한 관계는 **같은 문제를 서로 다른 방법으로 다루는 비교**입니다.

## 검증의 한계

- 코드와 호출 연결을 확인했습니다. 앱을 실행해 로그인·플러그인·모델 응답·차트 표시까지 재현하는 E2E 검증은 수행하지 않았습니다.
- Brain의 모델 노출에는 준비 상태와 expose_to_model 설정이 필요합니다. 코드가 있다는 사실이 모든 세션에서 자동 활용된다는 뜻은 아닙니다.
- 정확도, p95 지연, 비용 개선은 측정하지 않았습니다. 구조상 의도와 실제 개선 수치를 분리해야 합니다.
- 이번 검증은 지정된 세 문서와 관련 실행 경로의 대조입니다. 이 세 분야가 ATHENA 전체 AI 기술을 빠짐없이 대표한다고 판정한 것은 아닙니다.
