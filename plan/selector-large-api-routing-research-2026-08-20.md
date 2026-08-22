# KIS 외 대규모 API 라우팅 조사와 Athena 적용안

> **Historical research note (2026-08-21):** This document records the investigation and
> recommendations made on 2026-08-20. The proposed `query-frame-v3`/global lexical replacement
> is superseded as a public execution contract by the later typed/canonical routing boundaries.
> Keep the research findings and citations for history; use the current selector docs,
> `selector/AGENTS.md`, and green evaluation artifacts for present behavior. Shadow/advisory
> measurements must not be presented as production accuracy.

> 조사일: 2026-08-20  
> 범위: 323개 Kiwoom API identity의 검색·선택·검증·실행 경로  
> 목적: KIS 사례에 의존하지 않고, 대규모 도구 카탈로그를 안정적으로 호출하는 공식 지침과 1차 연구를 확인한 뒤 Athena selector의 다음 구조와 제거 대상을 정한다.

## 1. 결론

323개 API를 안정적으로 호출하는 방법에 관한 자료는 충분하다. 주요 모델 제공사의 공식 문서와 대규모 tool-use 연구는 세부 구현은 달라도 다음 원칙에 수렴한다.

```text
전체 API 문서를 한 평면에서 경쟁시키지 않는다
  → 질문의 실행 종류·대상·시간성·결과 모양을 먼저 구조화한다
    → 타입과 권한으로 불가능한 후보를 제거한다
      → 같은 capability class의 작은 후보군만 검색·재정렬한다
        → 필요한 정확한 schema만 지연 로드한다
          → 서버가 schema·업무 규칙·권한을 재검증한다
            → 서명된 실행 계획만 호출한다
```

Athena는 후반부 안전 경계가 이미 좋다.

```text
search → describe → resolve → signed one-time plan → call → manifest-derived card
```

문제는 전반부 `search`가 질문의 의미를 타입으로 해석하지 않고, title·detail title·필드 설명·동의어·한국어 2글자 조각을 전역 합산한다는 점이다. 따라서 다음이 이 조사의 직접 결론이다.

1. 기존 signed plan, schema validation, account binding, order confirmation, manifest 기반 카드 결정은 보존한다.
2. 전역 lexical score를 실행 권위에서 내린다.
3. 값이 없는 `QueryFrame → hard eligibility → family-local detail routing`을 새 권위로 둔다. 종목코드·계좌·가격·수량 같은 실제 값은 frame에 넣지 않고 신뢰된 외부 인자로 분리한다.
4. 이미 오분류에 직접 기여한 documentation leakage, raw `family_projection`, synonym-derived bigram, `candidate_refs` hard replacement를 제거하거나 비권위화한다. Title tie-break는 최신 ablation에서 제거 시 악화됐으므로 유지한다.
5. 독립 기여도가 아직 측정되지 않은 coverage·일반 bigram·suppression·corroboration cap은 한 번에 삭제하지 않고 contrast corpus에서 ablation한 뒤 결정한다.

동적 tool search는 context와 비용을 줄이는 방법이다. `삼성전자`가 개별 종목이고 `업종`이 아니라는 의미 정확성이나 금융 실행 안전성을 대신하지는 않는다.

## 2. 근거 등급

이 문서는 서로 다른 종류의 근거를 섞어 결론을 과장하지 않도록 다음 표기를 사용한다.

| 표기 | 의미 |
|---|---|
| **공식 확인** | OpenAI, Anthropic, Google, Microsoft, AWS, MCP의 현재 공식 문서에 명시된 동작·권장사항 |
| **논문 확인** | 논문 또는 공식 논문 프로젝트가 보고한 데이터 규모·방법·평가 결과 |
| **로컬 확인** | 현재 Athena 코드·fixture·실행 trace에서 재현하거나 직접 확인한 사실 |
| **Athena 추론** | 외부 근거와 로컬 증거를 결합한 설계 판단. 외부 자료가 Athena의 성능을 직접 보증하는 것은 아님 |

## 3. 공식 플랫폼 자료

### 3.1 OpenAI: namespace와 지연 schema 로딩

**공식 확인:** [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)는 deferred function, namespace, MCP server에서 필요한 tool schema를 런타임에 찾고 로드하는 방식을 설명한다.

- 시작 시 모든 function schema를 model context에 넣지 않는다.
- 가능한 경우 개별 function보다 명확한 고수준 namespace 또는 MCP server 단위로 묶는다.
- namespace당 function은 10개 미만을 목표로 한다.
- tenant나 프로젝트 상태에 따라 후보가 달라지면 client-executed search를 사용한다.
- tool search는 schema discovery 기능이며, operation의 의미 정확성이나 실행 권한을 자동으로 보장하지 않는다.

**공식 확인:** [Introducing GPT-5.4](https://openai.com/index/introducing-gpt-5-4/)는 36개 MCP server를 활성화한 MCP Atlas 250건 평가에서, 모든 도구를 upfront로 노출한 경우와 같은 정확도를 유지하면서 tool search가 총 token 사용량을 47% 줄였다고 보고한다.

**Athena 추론:** `market.quote`, `market.chart`, `market.sector`, `account`, `order`, `realtime`처럼 먼저 capability namespace를 고르고 그 안의 operation schema만 로드한다. 이 수치는 context 최적화의 근거이며 Athena semantic accuracy의 예상 개선율로 사용하면 안 된다.

### 3.2 Anthropic: 수백~수천 도구에서 3~5개만 로드

**공식 확인:** [Anthropic Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)는 수백~수천 개 도구를 대상으로 tool name, description, argument name과 description을 검색하고 필요한 정의만 로드한다.

- 전체 tool definition을 모두 넣으면 context bloat와 selection accuracy 저하가 함께 발생할 수 있다.
- 대략 30~50개를 넘으면 tool selection accuracy가 떨어질 수 있다고 설명한다.
- 일반적인 multi-server 설정의 definition이 약 55k token에 이를 수 있다.
- 요청당 보통 3~5개 도구만 로드해 definition context를 85% 이상 줄일 수 있다.
- deferred tool은 최대 10,000개까지 지원하며 검색 결과 기본 최대치는 5개다.
- 일관된 namespace와 사용자가 실제로 쓰는 표현이 들어간 설명을 권장한다.

**Athena 추론:** 현재 `search(limit=5)`라는 숫자만 같다고 올바른 설계는 아니다. 그 5개는 종목 현재가·업종 현재가·차트가 섞인 전역 top-5가 아니라, 먼저 동일 capability class로 제한된 3~5개여야 한다.

### 3.3 Google: active function 10~20개와 typed parameter

**공식 확인:** [Google Cloud Function Calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling)은 다음을 권장한다.

- function declaration은 OpenAPI-compatible schema로 정의한다.
- 너무 많은 function을 동시에 제공하면 잘못되거나 차선인 function을 고를 위험이 커진다.
- active set은 이상적으로 10~20개 이하로 유지하고, 전체 toolset이 크면 대화 context에 따른 dynamic tool selection을 고려한다.
- 유한한 값 집합은 description 문장보다 enum으로 표현한다.
- integer는 number가 아닌 integer로 선언한다.
- 주문·database update처럼 결과가 큰 호출은 실행 전에 사용자 확인을 둔다.
- validated mode와 허용 function set으로 schema adherence와 호출 범위를 제한할 수 있다.

**Athena 추론:** `equity | sector | index | account`, `query | order | subscribe`, `facts | table | chart | stream`을 설명문 속 단어가 아니라 enum과 typed metadata로 만들어야 한다. 주문과 민감한 계좌 작업의 confirmation은 유지한다.

### 3.4 OpenAI와 Microsoft: strict output은 형식을 보장할 뿐 의미를 보장하지 않음

**공식 확인:** [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)은 `strict: true`를 권장하며 모든 object에 `additionalProperties: false`를 두고 필요한 property를 required로 선언하도록 설명한다. [Azure OpenAI Structured Outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)도 단순 JSON mode보다 JSON Schema를 따르는 structured output을 권장한다.

Athena의 현재 `QueryFrame`은 다음과 같은 값 없는 canonical object다. 아래 예시는 `삼성전자 오늘 주가 얼마야?`를 현재 `query-frame-v3` extractor에 통과시킨 실제 모양이다.

```json
{
  "version": "query-frame-v3",
  "subject": "instrument",
  "entity_kinds": ["stock"],
  "execution": null,
  "data_intents": ["current_quote"],
  "temporal_scopes": ["current"],
  "measures": ["price"],
  "result_shapes": [],
  "bindings": []
}
```

**로컬 확인:** [`query_frame.py`](../backend/athena_api/selector/query_frame.py)는 `QueryFrame`을 “observed routing concepts only”로 정의하고 argument value를 의도적으로 보존하지 않는다. 따라서 `삼성전자`, `005930`, 주문 가격, 수량, 계좌 값은 canonical frame에 남지 않는다. 명시적 조회 동작이 없는 일반 질문에서는 `execution=null`도 유효하다.

**Athena 추론:** strict schema는 필드 누락과 임의 필드를 줄이지만 enum의 의미가 맞는지는 보장하지 않는다. 현재 Athena는 authored direct evidence를 추출하는 deterministic frame과 서버 eligibility를 사용한다. 실제 `stk_cd`, 계좌, 가격, 수량은 신뢰된 caller가 `ResolveRequest.arguments`로 별도 전달하고, 선택된 operation의 schema와 business rule로 검증한다.

### 3.5 AWS: operation별 confirmation과 OpenAPI 계약

**공식 확인:** [Amazon Bedrock action groups](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-add.html)와 [OpenAPI action schema](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-api-schema.html)는 operation을 OpenAPI schema로 정의하고 `requireConfirmation` 또는 `x-requireConfirmation`을 operation마다 설정할 수 있게 한다. AWS는 사용자 확인이 malicious prompt injection에 의한 action 위험을 완화할 수 있다고 설명한다.

**Athena 추론:** 단순 현재가 조회는 allowlist·schema validation·rate limit·audit 후 자동 실행할 수 있다. 주문과 WebSocket subscribe는 조회와 다른 policy class로 유지하며 필요 시 confirmation을 요구한다.

### 3.6 MCP: discovery 표준은 authorization을 대체하지 않음

**공식 확인:** [MCP Tools specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)은 다음 계약을 제공한다.

- `tools/list` cursor pagination
- tool name, description, JSON Schema input/output
- output schema에 맞는 structured result와 client-side validation
- server-side input validation, access control, rate limit, output sanitization
- 민감 작업의 사용자 확인, timeout, result validation, audit log 권고
- 신뢰하지 않는 server의 tool annotation을 권위로 사용하지 말 것

**Athena 추론:** MCP는 323개 operation을 발견하고 전달하는 transport다. semantic routing, 금융 권한, 주문 안전성을 표준이 대신하지 않는다. signed plan, account binding, one-time nonce, server validation은 MCP 위에 남겨야 한다.

## 4. 1차 연구 자료

### 4.1 연구 규모와 결과 비교

| 연구 | 도구/API 규모 | 논문이 검증한 핵심 | 보고 결과 | Athena에 가져올 것 |
|---|---:|---|---|---|
| [AnyTool](https://arxiv.org/abs/2402.04253) | RapidAPI 16,000+ | 계층적 retriever, 좁은 후보의 solver, self-reflection | ToolBench에서 ToolLLM 대비 평균 pass rate +35.4% | subject·intent·shape 계층으로 후보를 먼저 축소 |
| [Re-Invoke](https://aclanthology.org/2024.findings-emnlp.270/) | ToolBench·ToolE large-tool 설정 | API별 synthetic query와 intent-aware multi-view reranking | ToolE nDCG@5 상대 개선: single-tool 20%, multi-tool 39% | 검수된 capability utterance와 negative constraint |
| [RESTGPT](https://arxiv.org/abs/2306.06624) | 실제 REST API, RestBench | Planner → API Selector → Executor 분리 | 역할 분리 시 호출 수·의존성 오류가 줄었다고 보고 | `QueryFrame`을 planner 산출물로 두고 기존 executor 경계 유지 |
| [Gorilla / APIBench](https://arxiv.org/abs/2305.15334) | 약 1,600개, 본문 1,645 API datapoint | 문서 retrieval, retriever-aware training, AST call 평가 | API 기능 선택과 argument hallucination을 분리 평가 | operation·argument·실행 정확도를 따로 측정 |
| [ToolLLM / ToolBench](https://arxiv.org/abs/2307.16789) | 16,464 API, 49 category | neural retriever, valid call path, ToolEval | unseen API와 APIBench zero-shot 일반화 보고 | top-k retrieval과 실행 평가를 분리 |
| [API-Bank](https://aclanthology.org/2023.emnlp-main.187/) | 평가 API 73개; 학습 pool 2,138개 | planning·retrieval·calling 분리 평가 | Lynx가 Alpaca보다 tool-use에서 26pt 이상 개선 | frame·retrieval·detail·argument·execution을 별도 채점 |
| [BFCL](https://sky.cs.berkeley.edu/project/berkeley-function-calling-leaderboard/) | 공개 설명 기준 2,000 QA pair | executable call, relevance detection, no-function | 단일 aggregate보다 호출 유형별 평가 | `NO_MATCH`, ambiguity, detail-required도 정답으로 평가 |
| [ToolkenGPT](https://papers.nips.cc/paper_files/paper/2023/hash/8fd1a81c882cd45f64958da6284f4a3f-Abstract-Conference.html) | massive tools | tool을 special-token embedding으로 선택 | frozen LM에 tool embedding을 결합 | 현재는 채택하지 않고 장기 선택지로만 유지 |
| [ToolACE](https://openreview.net/pdf?id=8EB8k6DdCU) | API pool 26,507개 | rule-based + model-based dual verification | 8B 모델이 BFCL에서 당시 GPT-4 계열과 경쟁 가능한 결과 보고 | 자체 golden 생성의 rule·model·human 이중 검증 |

표의 결과는 각 논문 설정에서 보고한 값이다. Athena 323개 catalog에서 같은 개선율을 기대한다는 뜻이 아니다.

### 4.2 AnyTool: 전역 평면 검색 대신 계층형 후보 축소

**논문 확인:** AnyTool은 16,000개가 넘는 RapidAPI 도구를 hierarchy로 줄인 뒤 solver가 좁은 후보를 사용한다. 실패 시 self-reflection으로 다시 후보를 검토한다.

**Athena 추론:** 323개는 16,000개보다 작으므로 학습형 거대 retriever가 첫 단계일 필요는 없다. generated manifest에 typed capability metadata를 추가하고 다음 계층을 결정론적으로 적용할 수 있다.

```text
execution: query / order / subscribe
subject: equity / sector / index / account / derivative
intent: quote_snapshot / price_series / chart / fundamentals / ...
shape: facts / table / series / chart / stream
time: current_session / daily / intraday / range / realtime
```

AnyTool의 호출 후 self-reflection을 Athena read API에 그대로 적용하지 않는다. 잘못된 API를 먼저 호출하는 대신 `resolve` 전에 후보를 재검토하고, ambiguity면 실행하지 않는다.

### 4.3 Re-Invoke: 사용자 표현과 API 문서의 어휘 차이

**논문 확인:** Re-Invoke는 색인 시 API별 다양한 synthetic query를 만들고, 추론 시 질문의 underlying intent와 tool-related context를 뽑아 multi-view similarity로 재정렬한다.

**Athena 추론:** raw Kiwoom field description에 동의어를 계속 추가하는 대신 operation마다 검수 가능한 capability record를 둔다.

```json
{
  "operation_ref": "detail:ka10001:current_trading",
  "intent": "quote_snapshot",
  "subject_kind": "equity",
  "time_scope": "current_session",
  "result_shape": "facts",
  "positive_utterances": [
    "삼성전자 지금 주가 얼마야",
    "한 종목의 현재가와 등락률 알려줘",
    "종목 현재 시세와 거래량"
  ],
  "negative_constraints": [
    "sector",
    "index",
    "historical_series",
    "chart"
  ]
}
```

Synthetic utterance는 보조 색인 신호로만 사용하고 rule checker와 human review를 통과시킨다. 생성 예시를 검증 없이 searchable description에 합치면 현재 `ka10081`의 삼성전자 예시 누출을 반복한다.

### 4.4 RESTGPT와 API-Bank: 계획·선택·실행을 한 점수로 합치지 않음

**논문 확인:** RESTGPT는 Planner, API Selector, Executor를 분리한다. API-Bank는 planning, retrieval, calling을 별도 능력으로 평가한다.

**Athena 추론:** 기존 `search → describe → resolve → call`은 유지할 가치가 있다. planner와 selector 사이에는 실제 argument value가 없는 `QueryFrame`을 둔다. 평가도 다음처럼 분리한다.

- value-free frame invariant와 typed eligibility
- 질문에서 disposition, family, final operation/detail을 고르는 autonomous routing
- confidence, abstention, wrong-plan, surface-crossing을 포함한 policy safety
- identity-assisted addressability, argument/schema validation
- signed plan과 upstream execution
- manifest/card contract

### 4.5 Gorilla와 ToolLLM: retrieval은 필요하지만 실행 권위가 아님

**논문 확인:** Gorilla는 API documentation retrieval과 call 구조 평가를 결합한다. 원문은 retrieval이 항상 개선을 보장하지 않고 설정에 따라 성능을 해칠 수 있음을 지적한다. ToolLLM은 16,464개 API에서 retriever와 실행 경로 평가를 분리한다.

**Athena 추론:** lexical ranker를 embedding cosine 하나로 교체하지 않는다. 먼저 typed hard filter를 적용하고, lexical·embedding·hybrid는 작은 eligible set의 후보 생성 또는 tie-break로 shadow 평가한다. 실행은 계속 catalog identity, schema, policy와 signed plan이 결정한다.

### 4.6 BFCL과 ToolACE: 부정 사례와 corpus 검증

**논문·공식 프로젝트 확인:** BFCL은 주어진 function 중 정답이 없는 relevance detection을 포함한다. ToolACE는 대규모 synthetic API corpus에 rule-based와 model-based verification을 결합한다.

**Athena 추론:** `NO_CONFIDENT_MATCH`, `AMBIGUOUS_OPERATION`, `DETAIL_GROUP_REQUIRED`는 실패가 아니라 올바른 정답이 될 수 있다. 새 Korean corpus는 generated paraphrase만 믿지 않고 metadata rule, executable resolver assertion, human review를 모두 통과시킨다.

## 5. 초기 Athena 실패와 현재 보정의 구조적 의미

### 5.1 2026-08-20 초기 재현 질문

**로컬 확인:** 초기 조사 시점의 catalog와 ranker에서 다음 질문은 종목 현재가 family를 선택하지 못했다.

```text
삼성전자 오늘 주가 얼마야?
```

당시 검색 순위는 다음과 같았다.

| 순위 | 후보 | 점수 | 실제 의미 |
|---:|---|---:|---|
| 1 | `base:ka20001` | 959 | 업종현재가 |
| 2 | `base:ka20009` | 959 | 업종현재가일별 |
| 3 | `base:ka10081` | 545 | 주식일봉차트 |
| 4 | `base:ka10007` | 486 | 시세 관련 family |
| 5 | `base:ka10086` | 410 | 일별주가 |
| 7 | `base:ka10001` | 374 | 주식기본정보 family |

기본 `limit=5`에서 정답 family `ka10001`은 모델이 보는 후보에서 제외됐다. resolve는 `ka20001`, `ka20009`, `ka10081`을 ambiguity 후보로 반환하고 실행 계획을 발급하지 않았다.

의미상 필요한 operation은 `detail:ka10001:current_trading`이다. 이 projection은 현재 시세와 거래량을 facts 형태로 제공하며 `cur_prc`, `pre_sig`, `pred_pre`, `flu_rt`, `trde_qty`, `trde_pre`를 갖는다. 현재 정의는 [`backend/ref/response-projections.json`](../backend/ref/response-projections.json)에 있다.

**로컬 확인:** 현재 typed routing 회귀 테스트는 같은 질문에서 `base:ka10001`을 search 1위로 두고 sector·daily chart를 eligibility 단계에서 제외한다. 신뢰된 caller가 `arguments={"stk_cd": "005930"}`를 별도로 전달하면 resolve는 `detail:ka10001:current_trading`을 선택한다. 이 계약은 [`test_selector_typed_routing.py`](../backend/tests/unit/test_selector_typed_routing.py)에 고정돼 있다.

### 5.2 초기 점수 누출과 현재 권위 축소

초기 natural search는 base family만 노출하면서 detail title들을 base의 `family_projection`에 합쳤다. 당시 [`ranking.py`](../backend/athena_api/selector/ranking.py)는 이 projection과 field description·overview·domain·coverage·synonym·bigram을 함께 더했다.

`주가`가 `현재가`, `price`, `current_price`, `cur_prc`로 확장되고 확장어에서 `현재`, `재가` 같은 2글자 조각까지 생기면서 하나의 concept이 여러 독립 증거처럼 누적됐다. 이 경로로 `ka20001`은 약 959점을 얻었다.

현재 `ko-en-finance-v6` lexicon과 ranker는 이 누출을 다음처럼 줄였다.

- request/response description과 raw `family_projection`은 catalog에 설명 자료로 남아 있지만 `_ZONE_RULES`의 authoritative scoring zone에는 없다.
- 분별력 있는 detail title만 `family_capability`로 선별한다.
- synonym은 사용자가 직접 작성한 whole token에서만 생성하며 synonym-generated bigram을 만들지 않는다.
- raw Korean fragment도 전부 사용하지 않고 reviewed query fragment만 허용한다.
- opaque instrument span은 값 자체를 점수화하지 않도록 mask한다.
- `QueryFrame`과 routing contract 버전은 각각 `query-frame-v3`, `selector-routing-v3`다.

`ka10081` request field description에는 삼성전자 액면분할 예시가 있다. 초기 ranker는 사용자가 입력한 종목명을 값 없는 entity-kind evidence로 분리하지 못한 채 searchable documentation 문자열과 맞췄고, 그 결과 차트 family 점수가 올라갔다.

현재 질문에서 실제로 필요한 의미 축은 다음이다.

```text
삼성전자 → subject=instrument, entity_kinds=[stock]
오늘/현재 → temporal_scopes=[current]
주가 → data_intents=[current_quote], measures=[price]
실제 종목 값 → QueryFrame 밖의 trusted arguments
```

초기 조사 당시 search request에는 query, execution intent, limit만 있었고 subject, temporal scope, entity kind가 없었다. 따라서 `업종`이 아니라는 negative evidence와 `차트/일봉/추이`가 아니라는 negative evidence를 표현할 수 없었다. 현재 구현은 값 없는 `QueryFrame`과 eligibility contradiction으로 이 축을 표현하되, 실제 종목 값은 frame에 보존하지 않는다.

### 5.3 기존 테스트가 놓친 이유와 현재 평가 분리

**로컬 확인:** 기존 identity-assisted golden은 84건이고 다음과 같이 구성된다.

```text
detail 22
detail_required 22
missing_args 8
safety 8
forbidden 4
ambiguity 4
adversarial 4
realtime 12
```

초기 84건에는 자연어 `종목명/종목코드 + 오늘/지금 + 주가/현재가/시세` 조합이 없었다. `ka10001` resolve 사례는 정답 `preferred_ref`와 `detail_group`을 fixture가 주입한다. 따라서 이 suite가 증명하는 것은 identity addressability, argument/schema validation, policy와 안전한 resolve이지, 자연어만으로 family와 detail을 찾는 능력이 아니다.

현재는 목적을 분리했다.

- [`api_selector_golden.jsonl`](../backend/tests/fixtures/api_selector_golden.jsonl)과 [`test_selector_eval.py`](../backend/tests/unit/test_selector_eval.py): identity-assisted addressability, argument validation, detail membership, safety policy
- [`api_selector_autonomous.jsonl`](../backend/tests/fixtures/api_selector_autonomous.jsonl): 공개된 117건 question-only autonomous regression corpus
- [`api_selector_autonomous_expansion.jsonl`](../backend/tests/fixtures/api_selector_autonomous_expansion.jsonl): 이미 노출되고 평가된 73건 autonomous expansion corpus
- [`test_selector_autonomous_eval.py`](../backend/tests/unit/test_selector_autonomous_eval.py): disposition, family, final operation/detail, confidence와 safety gate

공개 117건은 [`selector-g005-semantic-metrics-2026-08-20.json`](selector-g005-semantic-metrics-2026-08-20.json)에서 general accuracy와 exact operation accuracy 1.0, wrong plan 0으로 기록돼 있다. 73건 expansion은 [`selector-g006-autonomous-expansion-metrics-2026-08-21.json`](selector-g006-autonomous-expansion-metrics-2026-08-21.json)에서 general accuracy 0.794521, exact operation accuracy 0.745763, gate 실패로 기록돼 있다. 두 corpus는 모두 공개·열람·평가됐으므로 향후 sealed holdout으로 재사용할 수 없다.

## 6. 권장 아키텍처

### 6.1 전체 경로

```text
사용자 질문
  │
  ├─ 1. Value-free QueryFrame
  │      execution: query | order | websocket | null
  │      subject: instrument | sector | account | order | ...
  │      entity_kinds: stock | sector_index | account | ...
  │      data_intents: current_quote | chart | series | fundamentals | ...
  │      temporal_scopes: current | daily | range | realtime | ...
  │      measures: price | change | volume | ...
  │      result_shapes와 binding roles
  │      실제 종목명·코드·계좌·가격·수량은 보존하지 않음
  │
  ├─ 2. Trusted external argument boundary
  │      caller/entity resolver가 실제 값을 별도 보유
  │      예: ResolveRequest.arguments={stk_cd: 005930}
  │      routing frame과 autonomous score에는 값이 들어가지 않음
  │
  ├─ 3. Hard eligibility filter
  │      query evidence → order/websocket 제외
  │      subject=instrument, entity_kind=stock → sector/index/account 제외
  │      current_quote/current → chart/series/range 제외
  │
  ├─ 4. Family candidate generation
  │      canonical capability tag와 value-free binding compatibility
  │      동일 capability class의 3~5개만 반환
  │
  ├─ 5. Family-local detail routing
  │      선택된 family의 detail만 비교
  │      confidence 부족 시 작은 detail 목록을 describe
  │
  ├─ 6. Exact schema 지연 로드
  │      input/output JSON Schema와 business constraint
  │
  ├─ 7. Resolve
  │      선택된 operation에 대해 trusted external arguments 검증
  │      schema, account, authorization, confirmation, catalog hash 검증
  │      signed one-time plan 발급
  │
  └─ 8. Call
         server-side validation 후 실행
         operation manifest가 card를 결정
```

### 6.2 `삼성전자 오늘 주가 얼마야?`의 새 경로

```text
QueryFrame
  version=query-frame-v3
  subject=instrument
  entity_kinds=[stock]
  execution=null
  data_intents=[current_quote]
  temporal_scopes=[current]
  measures=[price]
  result_shapes=[]
  bindings=[]

Trusted external arguments
  {stk_cd: 005930}

Hard filter
  ka20001/ka20009/ka20002: sector → 제외
  ka10081/ka10086: chart 또는 series → 제외

Family route
  ka10001

Family-local detail
  current_trading

Resolve
  detail:ka10001:current_trading
  selected operation이 정해진 뒤 stk_cd schema validation
```

이 구조는 `주가`에 특정 TR boost를 주는 패치가 아니다. `업종 현재가`, `삼성전자 일봉`, `삼성전자 52주 범위`를 서로 다른 type 조합으로 분리한다.

### 6.3 Metadata 계약

각 family와 detail은 raw documentation과 별개로 값 없는 routing contract를 갖는다. 아래에서 `subject`부터 `bindings`까지는 현재 `selector-routing-v3`의 축이고, positive utterance와 negative constraint는 향후 retrieval metadata다.

| 필드 | 역할 |
|---|---|
| `subject` | instrument, sector, market, account, order 등 eligibility |
| `entity_kinds` | stock, ETF, ELW, gold, sector_index, account 등 |
| `execution` | query, order, websocket, OAuth의 정책 경계 |
| `data_intents` | current_quote, price_history, chart, order_action 등 capability |
| `temporal_scopes` | current, realtime, minute, daily, range 등 |
| `measures` | price, change, volume, orderbook, valuation 등 |
| `result_shapes` | record, collection, time_series, stream, compound 등 |
| `bindings` | instrument_code, account_context, date_range, side, price, quantity 등 값 없는 필요 역할 |
| `positive_utterances` | 검수된 사용자 표현 |
| `negative_constraints` | 이 operation을 제외해야 하는 대비 의도 |
| `generic_callable` | family 자체 호출 가능 여부 |
| `risk_class` | read, sensitive-read, order, subscription |

Raw field description은 `describe`에서 사람과 모델이 정확한 schema를 이해하는 자료로 유지하되, operation selection의 authority에서는 분리한다.

## 7. 제거 결과와 최신 ablation

### 7.1 현재 권위에서 제거하거나 격리한 요소

초기 조사에서 직접적인 악영향이 확인된 항목은 다음처럼 처리됐다.

| 초기 요소 | 현재 상태 | 보존되는 용도 |
|---|---|---|
| 문서 속 예시 종목명·예시 문장 | operation selection의 authoritative evidence에서 제외 | `describe`, 개발자 문서 |
| raw request/response description | `_ZONE_RULES`에서 제외 | schema 설명과 디버그 자료 |
| 모든 detail title의 raw `family_projection` | `_ZONE_RULES`에서 제외 | catalog provenance |
| synonym-generated Korean bigram | 생성하지 않음 | authored whole-token synonym만 유지 |
| 모든 raw Korean bigram | reviewed fragment allowlist로 축소 | 한국어 compound recall |
| 질문 속 종목명·코드 값 | opaque instrument span으로 mask하고 `QueryFrame`에 보존하지 않음 | trusted external arguments 경계에서 별도 처리 |
| `candidate_refs` hard replacement | 후보 universe를 좁히는 권위 제거; 유효성만 검사 | caller hint의 계약 검증 |

Detail title 전체를 삭제한 것은 아니다. generic term을 버리고 분별력 있는 title만 `family_capability`에 넣는다. Raw 설명도 catalog에서 삭제하지 않고 selection authority에서만 분리한다.

### 7.2 73건 exposed expansion 최신 측정

2026-08-21 현재 [`selector-g006-autonomous-expansion-2026-08-21.json`](selector-g006-autonomous-expansion-2026-08-21.json)의 question-only 73건 측정은 다음과 같다. 이 corpus는 이미 공개됐으므로 개발용 ablation이지 sealed 성능 추정치가 아니다.

| Variant | 정답/73 | Accuracy | Wrong plan | Severe scope error | 판정 |
|---|---:|---:|---:|---:|---|
| baseline | 58 | 0.794521 | 0 | 1 | 현재 기준 |
| without field descriptions | 58 | 0.794521 | 0 | 1 | 이미 비권위여서 변화 없음 |
| without raw family projection | 58 | 0.794521 | 0 | 1 | 이미 비권위여서 변화 없음 |
| without family capability | 55 | 0.753425 | 0 | 2 | 보존 |
| legacy multiword alias flattening | 58 | 0.794521 | 0 | 2 | 되돌리지 않음 |
| without synonym bigrams | 58 | 0.794521 | 0 | 2 | 현재 기본 경로에서 이미 생성하지 않음 |
| without reviewed raw bigrams | 49 | 0.671233 | 1 | 1 | 보존 |
| without query coverage | 55 | 0.753425 | 0 | 1 | 보존 |
| without title tie-break | 56 | 0.767123 | 0 | 1 | 제거하지 않음 |
| without corroboration cap | 58 | 0.794521 | 0 | 1 | 안전 guard로 유지 |

같은 시점의 metrics는 exact final-operation/detail 44/59, 0.745763, critical failure 16건, wrong plan 0건, surface crossing 0건, severe scope error 1건이며 gate는 실패다. 이 수치는 [`selector-g006-autonomous-expansion-metrics-2026-08-21.json`](selector-g006-autonomous-expansion-metrics-2026-08-21.json)에 기록돼 있다.

따라서 과거 제안과 달리 title tie-break, query coverage, reviewed raw fragment를 지금 제거해서는 안 된다. 현재 exposed expansion에서 모두 성능을 낮췄고, raw fragment 제거는 wrong plan도 1건 만들었다. Field descriptions, raw family projection, synonym bigram 제거 variant의 동률은 해당 신호가 현재 권위 경로에서 이미 빠졌다는 정합성 증거이지, 전체 selector가 충분히 정확하다는 증거가 아니다.

### 7.3 이후 제거 기준

- critical/safety regression 0건
- wrong plan, surface crossing, severe scope error 증가 0건
- 전체 정확도 비열등 허용폭 0.5%p 이내
- 최소 2개 domain/family에서 독립 사례 3건 이상 개선
- 완전 동률이면 실제 production path 복잡성이 감소할 때만 제거
- 기능 하나를 제거할 때마다 그 결과를 새 baseline으로 삼고 나머지 ablation을 다시 측정

비선형 cap·coverage·suppression이 있으므로 contribution 숫자에서 점수만 빼는 방식으로 ablation하면 안 된다. 기능을 실제 pipeline에서 끄고 전체 평가를 다시 실행한다.

## 8. 반드시 보존할 요소

다음은 외부 연구와 공식 운영 지침에 부합하고, 의미 라우팅 오류와 별개로 실행 안정성을 높인다.

- generated catalog와 단일 catalog version
- exact `operation_ref` identity
- `describe`의 정확한 input/output contract
- server-side JSON Schema와 business rule validation
- catalog version·schema hash·question hash가 봉인된 signed plan
- nonce 기반 one-time plan token
- account binding과 authorization
- order confirmation과 idempotency guard
- generic-callability gate
- access control, rate limit, timeout, audit log
- `AMBIGUOUS_OPERATION`, `NO_CONFIDENT_MATCH`, `DETAIL_GROUP_REQUIRED`에서의 중단
- operation manifest가 card layout을 결정하고 모델의 `canvas_type`을 권위로 쓰지 않는 구조

이 항목들은 lexical ranker를 제거할 때 함께 단순화하면 안 된다.

## 9. 평가 설계

**공식 확인:** [OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)는 실제 task 분포를 반영한 평가, 로그 기반 분석, 지속적인 evaluation을 권장한다. Athena는 기존 identity-assisted golden과 실제 자연어 autonomous routing 평가를 분리하고, 모든 후보·frame·abstention·plan 결과를 재현 가능한 로그로 남겨야 한다.

### 9.1 평가군 분리

1. **Identity-assisted policy suite**
   - 323 identity의 addressability
   - schema, required argument validation과 detail membership
   - signed plan, order, WebSocket, OAuth, account guard
   - 기존 golden의 주요 역할

2. **Autonomous routing suite**
   - 자연어 질문만 입력
   - `candidate_refs`, `preferred_ref`, `detail_group`, gold operation 주입 금지
   - 질문에서 disposition, family, final operation/detail, confidence, safety를 채점
   - 실제 종목코드·계좌·가격·수량 값이나 argument correctness는 채점하지 않음

3. **Contrastive/metamorphic suite**
   - 한 단어 또는 한 facet만 바꾼 최소쌍
   - 두 문장이 모두 맞아야 pair 통과

4. **Exposed autonomous expansion suite**
   - 현재 73건은 이미 열람·실행됐고 결과가 공개된 regression partition
   - 실패 사례를 고치고 재실행하는 개발 corpus로 사용할 수 있음
   - 이름이나 최초 의도와 무관하게 더 이상 sealed holdout으로 간주하지 않음

5. **Future sealed held-out suite**
   - 공개 regression과 expansion corpus에 포함되지 않은 새 질문으로 생성
   - 평가 전 corpus hash, selector source hash, catalog·routing·frame version과 gate를 freeze
   - 한 번만 평가하고, 실패하면 corpus를 exposed expansion으로 재분류
   - 알고리즘·lexicon·threshold 튜닝에는 사용하지 않음

### 9.2 최소 contrast set

아래 화살표 오른쪽 표기는 사람이 읽는 semantic 기대값이다. serialized `QueryFrame`이나 argument payload가 아니며, autonomous evaluator는 이를 실제 값 추출 정답으로 채점하지 않는다.

```text
삼성전자 오늘 주가 얼마야?
  → equity / quote_snapshot / current_session / facts

반도체 업종 현재가 알려줘
  → sector / quote_snapshot / current_session / facts

삼성전자 최근 20일 주가 추이 보여줘
  → equity / price_series / range / chart

삼성전자 일봉 차트 보여줘
  → equity / chart / daily / chart

삼성전자 52주 최고가 알려줘
  → equity / price_range / range / facts

삼성전자 체결가 실시간으로 보여줘
  → subscribe / equity / trade_ticks / stream

삼성전자 매수해줘
  → order / equity / confirmation required

오늘 주가 얼마야?
  → missing entity 또는 clarification, 임의 sector/chart plan 금지
```

Metamorphic 계약은 다음과 같다.

- 존댓말·구두점·어순 변경 → 동일 operation
- 종목명↔종목코드 치환 → 동일 disposition/family/final operation. QueryFrame에는 두 값 모두 남지 않음
- 삼성전자↔SK하이닉스 치환 → 동일 operation class
- `오늘↔지금↔현재` → 동일 snapshot intent
- `차트/일봉/추이` 추가 → snapshot에서 chart/series로 전환
- `업종/지수/코스피` 추가 → equity에서 sector/index로 전환
- entity evidence 제거 → reject/ambiguity 등 사전 선언된 disposition. 실제 argument 누락 검증은 identity-assisted suite에서 확인
- 문서 예시 속 종목명 변경 → ranking 불변

### 9.3 측정 축

| 축 | 정답 정의 |
|---|---|
| Frame invariant | typed evidence만 남고 종목명·코드·계좌·가격·수량 값은 남지 않음 |
| Disposition | select, guarded, reject, forbidden 중 기대 정책 결과가 맞음 |
| Eligibility | 불가능한 family가 후보나 최종 선택에 남지 않음 |
| Retrieval | eligible family recall@k, MRR, nDCG |
| Family selection | 최종 family top-1이 맞음 |
| Final operation/detail | 선택된 canonical operation과 family-local detail이 맞음 |
| Confidence | policy confidence bin의 selected precision과 rejection 분포가 맞음 |
| Abstention | no-match, ambiguity, missing-detail이 올바른 상황에만 발생 |
| Safety | wrong plan, surface crossing, severe scope error, order·WebSocket·OAuth 위반이 없음 |
| Identity-assisted arguments | 별도 suite에서 addressability와 required argument/schema validation이 맞음 |
| Execution | identity-assisted 경로에서 올바른 signed plan과 upstream call |
| Presentation | operation manifest와 card layout이 일치 |
| Efficiency | candidate 수, schema token, latency p50/p95, tool round-trip 수 |

Autonomous 평가의 `entity_name`, `entity_code` 같은 tag는 질문 변형의 종류를 표시할 뿐, `삼성전자 → 005930` 값 변환의 정답을 채점한다는 뜻이 아니다. 두 질문이 같은 semantic operation으로 수렴하는지를 채점한다.

### 9.4 Release gate 제안

- identity-assisted 323개 structural/addressability/argument-policy 검증: 100%
- future sealed corpus: 최소 60건, critical 40건, reject/forbidden 10건, answerable 40건
- execution coverage: query, order, WebSocket, OAuth 모두 포함
- domain coverage: stock, sector, account, ETF, ELW, gold 모두 포함
- language coverage: 한국어, 영어, 혼합어 모두 포함
- overall final-policy accuracy: 98% 이상
- exact final-operation/detail accuracy: 95% 이상
- 모든 critical tag member accuracy: 100%
- wrong plan, surface crossing, severe scope error: 각각 0건
- high-confidence selected precision: 100%
- rejected/forbidden precision: 100%
- confidence calibration gate: 통과
- `candidate_refs`, `preferred_ref`, `detail_group` 같은 gold hint 입력: 0건
- latency와 token cost는 baseline과 함께 보고하며 정확도와 안전을 희생한 개선은 불합격

현재 240/80/1.15 threshold나 family retrieval 단일 숫자는 위 계약을 대신하지 못한다. autonomous gate는 최종 disposition과 operation/detail, confidence, wrong plan을 함께 판정한다. argument correctness는 같은 점수에 섞지 않고 identity-assisted suite에서 별도로 검증한다.

## 10. 도입 순서

### 단계 1. 실패를 RED test로 고정 — 현재 반영

- `삼성전자 오늘 주가 얼마야? → ka10001/current_trading`
- stock/sector, snapshot/chart, snapshot/range의 최소쌍
- document example entity 변경 시 ranking 불변
- autonomous path에는 gold ref, detail, actual argument value를 주입하지 않음

### 단계 2. 직접 유해 신호 격리 — 현재 반영

- documentation example과 raw description을 selection corpus에서 분리
- 전역 `family_projection` 제거
- synonym-derived bigram 제거
- `candidate_refs` hard replacement 제거
- title tie-break는 최신 ablation에서 유효하므로 유지

각 제거 뒤 전체 policy와 contrast suite를 실행한다.

### 단계 3. QueryFrame과 typed metadata 추가 — 현재 반영

- 값 없는 canonical frame 생성
- 실제 entity·계좌·가격·수량 값은 trusted external arguments로 분리
- execution, subject, intent, time, shape eligibility
- value-free binding role compatibility
- 선택된 operation에 대해서만 required argument/schema validation

### 단계 4. Family-local detail router 추가 — 현재 반영

- 전역 검색은 family까지만 수행
- detail title과 output facet은 family 선택 후에만 비교
- confidence 부족 시 해당 family의 작은 detail set만 describe

### 단계 5. Tool schema 지연 로드

- provider native tool search가 있으면 namespace 단위로 사용
- provider에 종속되지 않는 경우 Athena gateway가 client-executed search 수행
- 동일 capability class의 정확한 schema 3~5개만 모델에 노출

### 단계 6. Hybrid retrieval은 shadow mode로만 평가

- lexical-only, embedding-only, hybrid를 공개 autonomous/expansion suite에서 반복 비교
- wrong-family rate, abstention, exact detail, p95 latency, token을 모두 보고
- hard metadata filter와 signed execution authority는 유지
- baseline을 통과하기 전 user-visible authority로 승격하지 않음
- 최종 후보를 정한 뒤에만 새 unopened corpus를 future sealed holdout으로 freeze해 한 번 평가

## 11. 채택하지 않을 방향

- title·field description에 synonym을 계속 추가해 현 전역 ranker를 미세 조정하는 것
- 323개 schema를 한 번에 model context에 넣는 것
- 긴 context model이 semantic routing까지 해결한다고 가정하는 것
- embedding cosine score 하나를 executable authority로 쓰는 것
- 잘못된 API를 먼저 호출한 뒤 self-reflection으로 복구하는 것
- 단일 `recall@5` 또는 aggregate top-1만 release 지표로 쓰는 것
- 323개 catalog에 곧바로 model fine-tuning이나 tool-token embedding을 도입하는 것
- provider별 tool-search SDK를 하나의 혼합 contract로 추상화하는 것
- strict JSON output을 semantic correctness의 증거로 간주하는 것

## 12. 한계와 미확정 사항

1. OpenAI, Anthropic, Google, Microsoft, AWS의 수치와 권고는 서로 다른 제품·모델·평가에서 나온다. Athena의 예상 개선율로 환산할 수 없다.
2. OpenAI native tool search는 지원 모델과 API에 종속된다. Athena는 provider-independent client-executed routing을 기준 설계로 두어야 한다.
3. 논문들의 대규모 API는 RapidAPI, benchmark API, 일반 REST 도구가 중심이다. 금융 계좌·주문 안전의 production proof가 아니다.
4. Dynamic tool search는 context 규모를 줄이지만 entity·subject·time·shape의 의미 해석을 보장하지 않는다.
5. Strict structured output은 JSON 형식과 schema adherence를 높이지만 잘못된 enum 값의 의미까지 검증하지 않는다.
6. Synthetic utterance는 한국어 사용자 표현 recall을 높일 가능성이 있지만, 검수 없이 넣으면 documentation leakage를 다시 만든다.
7. 959점 업종 오분류는 2026-08-20 초기 selector trace다. 현재는 회귀 테스트로 보정됐지만 reference metadata나 routing contract가 바뀌면 다시 측정해야 한다.
8. 현재 `QueryFrame`은 deterministic authored-evidence extractor인 `query-frame-v3`다. hosted/local model을 비교하더라도 shadow mode에서 평가하며, argument value를 보존하지 않는 invariant는 바꾸지 않는다.
9. 공개 117건은 green이지만 exposed expansion 73건은 gate가 red다. 이것은 현재 일반화 한계의 직접 증거이며, 새 unopened sealed corpus를 열기 전에 해결해야 한다.

## 13. 최종 권고

Athena가 323개 API를 안정적으로 호출하려면 “모든 설명을 더 잘 점수화하는 검색기”에서 “타입으로 후보를 제거한 뒤 작은 후보만 검색하는 실행 계획기”로 바뀌어야 한다.

```text
typed QueryFrame
  + trusted external arguments kept separate
  + hard eligibility
  + family-local detail routing
  + deferred exact schema
  + server validation
  + signed one-time plan
  + manifest-derived card
```

외부 자료가 가장 강하게 지지하는 것은 계층적 후보 축소, 작은 active tool set, strict schema, 서버 재검증, 고위험 action confirmation이다. 로컬 실패가 가장 강하게 지지하는 것은 raw documentation과 상관된 lexical fragment를 실행 권위에서 제거하고 subject·intent·time·shape라는 negative evidence를 도입하는 것이다.

따라서 다음 목표는 embedding이나 fine-tuning이 아니라 다음 세 가지다.

1. exposed expansion의 16개 critical failure와 1개 severe scope error를 값 없는 routing contract 안에서 해소한다.
2. 공개 regression에서 current baseline과 ablation을 다시 검증한다.
3. source·catalog·corpus hash와 gate를 먼저 freeze한 새 unopened partition에서 future sealed 평가를 한 번 수행한다.
