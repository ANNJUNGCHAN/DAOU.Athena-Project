# Task-Adaptive Semantic Canvas 정본

- 상태: **구현·fixture 검증 진행 중 · 외부 live E2E/Paper 정리/사용자 승인 미완료**
- 현행 검증 기준: 2026-08-30 로컬 worktree
- 범위: Kiwoom 비-OAuth operation 299개와 Athena Canvas
- 목표: API·카드 개수에 맞춰 정보를 압축하지 않고, 사용자의 금융 업무를 가장 이해하기 쉬운 화면으로 완성한다.
- 제외: DART와 외부 사업자 API, OAuth 발급·폐기, Athena 자체 API의 UI 전수 설계

## 1. 결정

최종 제품의 설계 단위는 299개 API, 19개 Capability, 6개 통합 카드 중 어느 것도 아니다.

> 사용자 질문 하나가 하나의 금융 업무 워크스페이스를 만들고, 필요한 API가 그 워크스페이스의 의미 있는 섹션을 공급한다.

카드 개수는 목표나 성공 지표로 사용하지 않는다. 한 화면에 필요한 컴포넌트 수는 질문, 대상, 기간, 비교축, 실시간 필요성, 행동 위험도에 따라 결정한다. 백엔드의 19 Capability와 기존 6-card registry는 라우팅·소유권·호환성 경계로 유지할 수 있지만, 사용자가 선택하거나 제품 UI에 노출하는 정보 구조로 사용하지 않는다.

## 2. 사용자 문제와 제품 목표

### 2.1 사용자가 해결하려는 문제

Athena 사용자는 API를 탐색하려는 사람이 아니다. 사용자는 다음과 같은 결정을 빠르고 신뢰할 수 있게 내리려 한다.

- 종목의 가격과 흐름을 확인한다.
- 호가와 체결 강도를 본다.
- 가치·수익성·수급을 비교한다.
- 계좌 손익·현금·결제·위험을 파악한다.
- 조건에 맞는 종목을 찾는다.
- 주문 결과를 예상하고 명시적으로 확인한 뒤 실행 상태를 추적한다.

### 2.2 제품 목표

- 첫 화면에서 질문의 직접 답을 찾을 수 있다.
- 핵심 판단 화면을 먼저 렌더하고 보조 정보는 점진적으로 채운다.
- 모든 사용자 의미 필드는 이름 있는 업무 화면에 도달한다.
- 같은 의미의 값은 API 수만큼 반복하지 않는다.
- 내부 식별자와 전송 메타데이터는 사용자 데이터처럼 노출하지 않는다.
- 조회·분석·주문 실행의 권한 경계를 유지한다.
- 데스크톱 기본 창과 좁은 창에서도 같은 의미 구조를 각 폭에 적합하게 표현한다.

### 2.3 비목표

- 299개 API마다 카드를 만든다.
- 6개 거대 카드에 모든 데이터를 몰아넣는다.
- 19개 Capability를 19개 고정 화면으로 노출한다.
- `전체 필드`, `원본 데이터`, `raw alias`, `FID`, JSON path로 의미 설계를 대체한다.
- LLM이 요청마다 임의의 레이아웃을 새로 생성한다.
- API 응답 JSON 구조를 그대로 UI 정보 구조로 사용한다.
- 정보 개수를 줄이는 것을 사용성 개선으로 간주한다.

## 3. 현재 구현 진단

### 3.1 검증된 사실

| 항목 | 현재 상태 | 근거 |
| --- | --- | --- |
| 비-OAuth operation | 299개 | `canvas_card_registry.py`의 `EXPECTED_OPERATION_COUNT`, Capability assignment 테스트 |
| Capability | 19개 | `canvas_card_registry.py`의 `EXPECTED_CAPABILITY_COUNT` |
| 기존 Canvas root | 6개 | `CC-01`~`CC-06` registry |
| 응답 필드 occurrence | 3,705개 | `canvas_field_registry.py`, field coverage 테스트 |
| 고유 `(mapping_id, json_path)` | 3,703개 | field registry와 fixture 테스트 |
| 중복 occurrence | 2개 | `base:ka10173`의 `$.trnm`, `$.data`; ordinal로 보존 |
| Presentation field class | semantic business raw 3,531 / transport 92 / structural internal 79 / official opaque raw 3 | `semantic_presentation_registry.py` summary |
| 공식 의미가 확정되지 않은 occurrence | 3개 | 현행 REST occurrence `951`, `924`, `1279` |
| View Recipe | 12개 | `view_recipe_registry.py` |
| Section policy | 36개 | 12개 recipe의 `section_policies` 합계 |
| 의미 배치 review gate | 준비됨 | `review_ready=true`, placed business raw 3,534 |
| 의미 렌더 release gate | 미완료 | `release_ready=false`; unresolved 3개 |
| Electron recipe capture | 12개 | fixture-only receipt; 외부 호출 차단 |

현행 Kiwoom REST/WebSocket inventory는 `base:04`의 `951`·`924`와 `base:1h`의 `1279`를 모두 `Extra Item`으로만 제공한다. 레거시 OpenAPI+ OCX 가이드의 `951=예수금` 의미를 현재 REST 계약에 전역 이식하지 않는다. 세 occurrence는 `official_opaque`·`unresolved`로 보존하고, 공식 의미·단위·색상 의미를 만들지 않은 중립 라벨(`명세 추가 항목`)로 이름 있는 상세 영역에서 값에 접근할 수 있게 한다.

Raw/derived 판정은 화면 문구나 값의 모양이 아니라 `(공식 명세 revision, mapping/operation ID, response JSON path 또는 FID, occurrence ordinal)`의 exact source tuple로 한다. 공식 tuple이 있으면 `평균`, `괴리`, `비중`, `누적`, `상환`, `대비`라는 단어를 포함해도 raw다. Athena가 하나 이상의 raw 값을 계산·비교·환산·순위화·해석해 만든 값만 derived다. 쉼표, 날짜, 부호, 공식 단위 표기는 formatter이며 derived가 아니다.

공식 포털의 현재 JSON 명세와 공식 GitHub current spec이 다를 때는 둘의 response field 합집합을 보존한다. 한 공식 원천에만 존재한다는 이유로 raw를 삭제하지 않고 `official-source divergence`로 기록한다. 2026-08-31 감사에서 포털은 347개, GitHub는 337개 API를 제공했다. 현재 Athena 299 범위 안에서 포털에만 추가된 operation/response field는 0개였고, `0D`·`ka10173`은 GitHub 쪽 response field가 더 많아 해당 필드도 그대로 유지한다. 포털에만 있는 신규 operation 10개는 현행 299 범위의 raw 삭제 판단과 분리해 별도 onboarding 대상으로 관리한다.

### 3.2 현재 구조가 증명하는 것

현재 registry와 fixture는 다음을 증명한다.

- 299개 operation의 소유권이 누락·중복 없이 정해져 있다.
- 3,705개 wire occurrence가 보존된다.
- 3,531개 semantic business raw와 3개 official opaque raw에 recipe/section/component 목적지가 존재한다.
- 299개 operation이 12개 recipe 중 하나에 도달하고, workflow-only를 제외한 section이 비어 있지 않다.
- public presentation은 `display_tier`, `display_group`, `display_slot`, `display_order`, `visibility_policy`를 사용해 값의 우선순위와 반복 family를 표현한다.
- 합성 fixture가 299개 response model을 통과한다.
- Task Canvas envelope는 semantic observation과 opaque realtime binding을 별도로 제공한다.

이 증거는 로컬 registry, 합성 fixture, TestClient, Electron fixture capture에 한정된다. Kiwoom REST/WebSocket 및 broker live 연결을 검증한 증거가 아니다.

### 3.3 Legacy `SemanticDetailSheet`와 현재 제품 경계

과거 실제 Canvas 경로는 primary renderer 뒤에 `SemanticDetailSheet`를 항상 붙여 operation reference, alias, JSON path, ordinal, `전체 원본 필드`를 제품 UI에 노출했다. 현재 worktree는 다음 경계로 전환했다.

- Task Canvas는 `semantic-workspace.js`가 이름 있는 section과 semantic observation만 렌더한다.
- production에서는 raw detail sheet를 마운트하지 않는다.
- wire occurrence viewer는 명시적 developer diagnostics flag에서만 사용할 수 있다.
- official opaque raw는 중립 라벨의 이름 있는 상세 영역으로 노출한다.
- transport와 structural internal 값은 wire registry에서 삭제하지 않으며, 오류·pagination·continuation·realtime lifecycle·binding 같은 제품 상태와 동작으로 소비한다. 기술 alias/FID를 사용자 taxonomy처럼 노출하지 않는다.
- AITS 차트와 실시간 호가 전문 renderer는 generic semantic UI로 대체하지 않고 primary renderer로 보존한다.

Legacy detail sheet 파일은 호환·개발 진단 목적으로 남아 있다. 파일이 존재한다는 사실과 production 제품 UI에 노출된다는 사실을 혼동하지 않는다.

### 3.4 최신 안전 BLOCK 상태

| 최종 리뷰 BLOCK | 현재 구현·표적 검증 | 남은 검증 |
| --- | --- | --- |
| 위조 order generic push 차단 | generic `/canvas/push`의 주문 operation을 `GENERIC_ORDER_PUSH_FORBIDDEN`으로 거부하고 event queue가 비어 있음을 TestClient 회귀 테스트로 확인 | 실제 broker live 경계 E2E |
| opaque realtime binding | `rtb_<hash>` binding과 `obs_<hash>` observation으로만 제품 realtime update를 허용하고 raw alias/FID update를 거부하는 backend/frontend 테스트 통과 | 실제 Kiwoom tick live merge E2E |
| WebSocket lifecycle status UI | Task Canvas event가 allowlisted 한국어 lifecycle 상태와 접근 가능한 status UI를 렌더하는 frontend 테스트 통과 | 실제 disconnect/reconnect/resync capture |

세 BLOCK은 로컬 구현과 표적 회귀 테스트 기준으로 해소됐다. 외부 live E2E가 남아 있으므로 제품 전체 완료로 승격하지 않는다.

### 3.5 현재 진단의 결론

현재 상태는 다음처럼 구분한다.

- **Operation coverage:** 완료
- **Wire occurrence preservation:** 완료
- **Presentation classification:** 완료; semantic business raw 3,531 / transport 92 / structural internal 79 / official opaque raw 3
- **Task-oriented semantic placement:** 구조·fixture 검증 완료
- **실제 Canvas fixture 렌더:** 12 recipe 대표 capture 완료
- **실제 Kiwoom/WebSocket/broker live E2E:** 미완료
- **공식 의미 미확정:** `951`, `924`, `1279` 3개
- **Paper live 정리:** 로그인 차단으로 미완료
- **사용자 검수:** 미완료

## 4. 용어와 정보 구조

| 용어 | 정의 | 사용자 노출 |
| --- | --- | --- |
| Operation | Kiwoom REST, Detail projection, WebSocket control, 주문 adapter의 호출 단위 | 아니오 |
| Capability | 299개 operation을 의도·수명주기 기준으로 묶는 백엔드 라우팅 단위 | 원칙적으로 아니오 |
| Root surface | 기존 6-card registry가 관리하는 마운트·소유권·호환성 컨테이너 | 카드 종류로 노출하지 않음 |
| Semantic concept | 현재가, 평가손익, 순매수, 호가잔량처럼 사용자에게 의미가 있는 정규화된 값 | 예 |
| UI module | 차트, depth ladder, 표, 주문 ticket처럼 재사용 가능한 의미 컴포넌트 | 예 |
| View Recipe | 하나의 사용자 업무를 완성하는 결정적 화면 구성 계약 | 이름은 필요할 때만 노출 |
| Workspace | 한 질문과 후속 질문을 이어가는 Canvas 업무 공간 | 예 |
| Diagnostic surface | wire coverage, alias, JSON path, provenance를 확인하는 개발·지원 도구 | 제품 UI에서 제외 |

### 4.1 Canvas 정보 계층

하나의 workspace는 다음 계층으로 구성한다.

1. **Context header**: 대상, 시장, 기준 시각, 실시간·지연 상태
2. **Direct answer**: 질문에 대한 값·상태·짧은 결론
3. **Primary work surface**: 차트, 호가, 표, 주문 ticket 등 핵심 화면
4. **Decision context**: 비교, 수급, 가치, 위험, 구성 정보
5. **Typed drilldown**: 선택한 행·가격·주문·결제 항목의 의미별 상세
6. **Status and provenance**: 최신성, 부분 실패, 데이터 범위, 출처 상태

사용자에게 필요 없는 계층은 렌더하지 않는다. 데이터가 없거나 적용되지 않는 섹션을 빈 상자로 남기지 않는다.

## 5. Semantic Registry 설계

wire registry와 presentation registry를 분리한다. 한 registry가 응답 보존과 UI 의미를 동시에 담당하지 않는다.

### 5.1 Wire Field Registry

현재 occurrence 보존 계약을 유지한다.

필수 속성:

```text
occurrence_id, operation_ref, mapping_id, json_path, ordinal, alias,
wire_type, source_model, provenance, semantic_status
```

책임:

- 3,705개 occurrence의 무손실 보존
- 동일 path의 반복 occurrence를 ordinal로 구분
- response model과 fixture 추적
- 공식 의미가 없는 필드를 `official_opaque`로 보존
- UI 레이아웃을 결정하지 않음

### 5.2 Semantic Concept Layer

API별 alias를 사용자가 이해하는 도메인 개념으로 정규화한다. 현재 구현은 별도 저장소가 아니라 `semantic_presentation_registry.py`의 `concept_id`와 semantic basis로 이 계층을 제공한다.

필수 속성:

```text
concept_id, label_ko, description, entity_type, metric_type,
unit, format, sign_rule, time_semantics, session_semantics,
source_priority, sensitivity, derivation, conflict_policy
```

예:

```text
quote.last_price
account.total_equity
account.unrealized_pnl
orderbook.ask.price
orderbook.ask.quantity
flow.foreign.net_buy_amount
valuation.per
order.status
```

동일 의미의 여러 alias는 하나의 `concept_id`로 수렴한다. 대상·시간·단위·시장 세션이 다르면 같은 이름처럼 보여도 별도 observation으로 유지한다.

### 5.3 Presentation Registry

Semantic concept을 이름 있는 화면 위치에 연결한다.

필수 속성:

```text
concept_id, recipe_id, section_id, component_id, visual_role,
display_tier, display_group, display_slot, display_order,
visibility_policy, source_precedence, product_destination
```

현재 `display_tier`는 다음 기준을 사용한다.

- `answer`: 질문의 직접 답
- `primary`: 핵심 판단 화면
- `support`: 비교·근거·위험
- `detail`: 사용자가 선택한 대상의 의미별 상세

`display_group`은 같은 판단 문맥 또는 반복 family를 묶는다. `display_slot`은 호가 단계, 순위, 기간 bucket처럼 같은 family 안의 ordinal 자리를 표현한다. 사용자 라벨에 `1`, `2`, `3`을 붙여 별도 KPI 카드로 분절하지 않는다. `display_order`는 같은 tier/group 안의 안정된 순서를 고정한다.

### 5.4 필드 분류

| 분류 | 처리 |
| --- | --- |
| `semantic` | 공식 source tuple이 있는 business raw. 반드시 이름 있는 recipe/section/component에 연결 |
| `transport` | 공식 wire raw를 삭제하지 않고 오류, pagination, continuation, realtime lifecycle 동작에 사용. 독립 business 셀로 반복 표시하지 않음 |
| `internal` | 공식 구조 wrapper와 내부 binding/식별 계약을 wire registry에 보존하고 내부 동작에 사용 |
| `unresolved` | 공식 source tuple이 있는 opaque raw. 의미·단위를 만들지 않고 중립 라벨의 이름 있는 상세 영역에 연결 |
| `derived` | Athena가 raw를 계산·비교·환산·순위화·해석해 생성한 값. 공식 raw처럼 위장하지 않으며 명시적 제품 요구 없이는 표시하지 않음 |

현재 분류 결과는 다음과 같다.

```text
semantic  3,531
transport    92
internal     79
unresolved    3  (951, 924, 1279)
derived       0
합계       3,705
```

### 5.5 중복·충돌·결측 규칙

- 같은 대상·concept·시점·단위·세션은 하나의 observation으로 병합한다.
- 실시간 값과 snapshot 값은 source priority와 기준 시각으로 대표값을 선택한다.
- 장중 진행값과 확정값을 같은 값으로 위장하지 않는다.
- 충돌을 조용히 덮어쓰지 않는다. 사용자 판단에 영향을 주면 기준 시각 또는 출처 차이를 표시한다.
- 결측은 `0`으로 바꾸지 않는다. `미제공`, `집계 전`, `해당 없음`을 구분한다.
- API별 반복 데이터를 화면에 반복하지 않는다.

## 6. View Recipe 계약

### 6.1 Selector의 책임

Selector는 operation 또는 카드 디자인을 직접 고르지 않는다. 사용자 발화에서 다음 의도를 구조화한다.

```text
task, target, entity_type, time_range, interval,
comparison, scope, filters, sort, realtime_need, action_intent
```

모호한 기간·호가 깊이·시장 범위가 결과를 크게 바꾸면 투자자 언어로 선택지를 제시한다. 검증된 operation과 파라미터는 별도의 deterministic resolver가 선택한다.

### 6.2 Recipe의 책임

Recipe는 다음을 결정적으로 정의한다.

```text
recipe_id
required_concepts
optional_concepts
required_operations
optional_operations
primary_module
supporting_modules
layout_rules
interaction_rules
realtime_policy
error_policy
action_policy
```

필수 operation은 병렬 호출한다. optional operation은 첫 유용 화면을 막지 않으며 준비되는 대로 해당 섹션만 보강한다.

### 6.3 현재 구현된 Recipe

현재 deterministic registry에는 다음 12개 recipe와 36개 section policy가 있다.

| `recipe_id` | 사용자 업무 | section 수 |
| --- | --- | ---: |
| `instrument-chart` | 종목 차트 | 3 |
| `live-orderbook` | 실시간 호가 | 3 |
| `why-move-flow` | 가격 움직임과 수급 | 3 |
| `discovery-value` | 종목 탐색과 가치 | 3 |
| `sector-theme` | 업종과 테마 | 3 |
| `watchlist-condition` | 관심종목과 조건검색 | 3 |
| `etf-product` | ETF 분석 | 3 |
| `elw-product` | ELW 분석 | 3 |
| `market-vi` | 시장 상태와 VI | 3 |
| `account-risk` | 계좌와 위험 | 3 |
| `order-safe-ticket` | 안전 주문 | 3 |
| `gold-market` | 금시장 | 3 |

Section policy는 `always` 15개, `when-data` 16개, `workflow` 5개다. `workflow` section은 안전한 workflow 값이 실제로 공급될 때만 렌더한다. 12개 recipe는 19개 Capability와 299개 operation을 누락 없이 포괄한다.

### 6.4 대표 사용자 관점

| 사용자 업무 | Primary module | Supporting modules |
| --- | --- | --- |
| 종목 가격 흐름 확인 | 기존 Athena chart workbench | quote band, 거래량, 선택한 보조 지표, 기준 시각 |
| 실시간 호가 확인 | 5단·10단 depth ladder | best quote, 체결 tape, 총잔량·불균형, 연결 상태 |
| 가치·수익성 판단 | metric comparison band | 업종 비교, 기간 추세, 핵심 재무 |
| 수급 분석 | 가격과 동기화된 flow chart | 투자자 matrix, 누적 순매수, 거래원 순위 |
| 종목 탐색 | 정렬·필터·가상화 목록 | 선정 근거, 선택 종목 typed detail, 비교 tray |
| 계좌 손익 확인 | 자산·손익 summary | 보유종목 표, 기여도, 현금·결제, 위험 |
| 주문 실행 | draft/confirmation ticket | 예상 금액·비용, 가능 수량, receipt, 실행 timeline |
| 가격 변동 이유 확인 | 차트·수급·사실 timeline | 확인 사실과 추론 분리, 범위와 기준일 |

현재 구현 수는 12개지만 이를 영구 상한으로 보지 않는다. Recipe 수는 사용자 업무와 검증된 renderer 조합의 결과로 발생한다. 같은 사용자 업무는 항상 같은 recipe와 검증된 모듈 구성을 사용해 예측 가능성을 유지한다.

## 7. 재사용 UI Module

### 7.1 공통 모듈

- **Identity and context header**: 종목·계좌·시장·기간·기준 시각
- **Answer band**: 현재가, 평가손익, 순위, 주문 예상 결과 등 직접 답
- **AITS chart workbench**: 기존 개발 차트 renderer와 내부 TR identity/lifecycle을 보존해 가격·수급·비교 recipe의 기준 차트로 사용
- **Depth ladder**: 매도·매수 호가, 잔량, 누적잔량, 상대잔량을 연속된 판으로 표현
- **Trade tape**: 시간, 체결가, 체결량, 방향
- **Metric band**: PER·PBR·ROE처럼 같은 판단 문맥의 지표를 한 영역에 배치
- **Flow matrix**: 투자자·프로그램·거래원 흐름을 시간·주체 기준으로 비교
- **Comparison table**: 단위·기준일이 정렬된 비교 표
- **Selectable list**: 필터·정렬·pagination/virtualization과 typed row detail
- **Account position panel**: 보유량, 평균단가, 평가액, 손익, 비중, 결제·증거금
- **Order ticket**: 입력, 예상, 확인, 접수·체결 결과를 한 흐름으로 제공
- **Evidence timeline**: 확인 사실, 시각, 범위, 추론 여부를 분리
- **Status band**: 최신성, 지연, 부분 실패, 재연결, 데이터 범위

### 7.2 조합 규칙

- PER, PBR, ROE 같은 단일 KPI를 각각 큰 카드로 분절하지 않는다.
- 매도 1호가와 매수 1호가를 별도 카드로 만들지 않는다.
- 한 질문은 하나의 primary module만 가진다.
- supporting module은 질문의 판단을 돕는 경우에만 추가한다.
- 후속 질문은 가능한 경우 같은 workspace와 시간축·선택 상태를 갱신한다.
- 다른 entity 또는 독립된 업무를 시작할 때만 새 workspace를 만든다.
- 모든 상세는 `결제 예정`, `거래원별 순매수`, `ETF 구성종목`처럼 의미 이름을 가진다.
- AITS 차트와 실시간 호가는 generic 표·facts renderer로 재구현하지 않는다. 전문 renderer를 primary로 유지하고 semantic workspace가 주변 설명·보조 section만 담당한다.

## 8. Runtime 처리 흐름

```text
사용자 발화
  → intent/entity/time/action 추출
  → deterministic recipe resolve
  → operation plan 검증
  → 필수 operation 병렬 호출
  → wire response 보존
  → semantic concept 정규화·병합
  → primary module 우선 렌더
  → optional section 점진 갱신
  → realtime observation merge
  → section 단위 상태·오류·stale 표시
```

### 8.1 첫 렌더 원칙

- 질문과 대상이 확정되면 context header와 안정된 layout을 즉시 표시한다.
- 핵심 데이터가 준비되면 primary module부터 렌더한다.
- 보조 데이터 때문에 첫 화면을 지연하지 않는다.
- 로딩 중에도 데이터가 있는 것처럼 가짜 값을 표시하지 않는다.
- 뒤늦게 도착한 section이 화면 전체를 재배치하지 않도록 영역을 안정적으로 갱신한다.

### 8.2 부분 실패

- section 하나의 오류가 workspace 전체를 오류로 덮지 않는다.
- 성공한 값과 마지막 정상 기준 시각을 유지한다.
- 실패한 영역에만 재시도와 상태 설명을 제공한다.
- `trimmed=true` 같은 범위 축소는 최근 구간임을 사용자 언어로 표시한다.

### 8.3 Workspace identity와 후속 질문

Workspace identity는 최소한 `conversation + task + normalized target`으로 구성한다. 후속 질문은 다음 순서를 따른다.

1. 기존 workspace와 대상·업무가 같은지 판단한다.
2. 같으면 기간, 비교 대상, 필터, section을 갱신한다.
3. selection, scroll, sort, filter 상태를 보존한다.
4. 대상이나 업무가 독립적이면 새 workspace를 생성한다.

## 9. 사용자 표시 규칙

### 9.1 숫자와 단위

- 원, 주, %, 배, 계약 등 단위를 값과 함께 표시한다.
- 부호와 색을 함께 사용한다. 색만으로 상승·하락을 구분하지 않는다.
- `0`, 결측, 미제공, 해당 없음, 집계 전을 구분한다.
- 비교값은 같은 단위와 같은 기준일로 정렬한다.
- 반올림 때문에 판단이 바뀔 수 있는 값은 충분한 정밀도를 제공한다.

### 9.2 시간과 최신성

- 실시간, 지연, 장마감 확정, 전일, 기간 누적을 구분한다.
- 데이터가 stale이면 값을 지우지 않고 마지막 기준 시각을 표시한다.
- 차트·수급·체결을 함께 비교할 때 시간축과 세션을 일치시킨다.

### 9.3 표와 상세

- 표는 업무에 필요한 열만 기본 표시한다.
- 열 선택은 고급 사용자를 위한 보조 기능이며 의미 설계를 대체하지 않는다.
- 행을 선택하면 해당 entity의 typed detail을 연다.
- 큰 목록은 pagination 또는 virtualization을 사용한다.
- 검색·필터·정렬 상태는 후속 질문과 뒤로 가기에서 유지한다.

### 9.4 금지되는 제품 UI

- `전체 원본 필드`
- `원본 데이터 보기`
- `기타`로 모든 미배치 정보를 몰아넣는 섹션
- operation ID, mapping ID, trace ID
- raw alias, FID, JSON path, response envelope
- 내부 WebSocket REG/REMOVE 상태 코드

위 정보는 별도 개발자 진단 surface에서만 접근한다.

## 10. 데스크톱 반응형 창과 접근성

### 10.1 좁은 데스크톱 창

이 프로젝트의 제품 범위는 데스크톱 Athena다. `390×844` 검증은 모바일 제품·모바일 브라우저·네이티브 앱 지원 선언이 아니라, 사용자가 데스크톱 창 폭을 좁혔을 때 UI가 깨지지 않는지 확인하는 **좁은 데스크톱 창 회귀 테스트**다.

- 데스크톱 표를 축소하지 않고 의미 module을 세로로 재배치한다.
- 한 번에 하나의 판단 영역을 우선한다.
- 종목·현재가·시장 상태와 주요 행동은 필요할 때 sticky 처리한다.
- 표는 핵심 열을 우선하고 행 선택으로 typed detail에 진입한다.
- 하단 sheet는 중요한 데이터의 유일한 접근 경로가 되지 않게 한다.
- 뒤로 가기에서 필터·정렬·선택·스크롤을 복원한다.
- 현행 Electron fixture는 `390×844` viewport에서 document/workspace overflow, table 자체 overflow 소유, keyboard focus, reduced motion, contrast를 검사한다.

### 10.2 접근성 기준

- WCAG 2.2 AA를 기준으로 한다.
- 일반 텍스트 명암비는 최소 4.5:1, 큰 텍스트와 UI 경계는 최소 3:1을 지킨다.
- 포인터 대상은 최소 24×24 CSS px, 좁은 창의 주요 조작 대상은 44×44 px 이상을 사용한다.
- 모든 상호작용은 키보드로 가능하고 focus indicator가 보인다.
- heading, table, button, status 등 native semantic을 우선한다.
- 차트는 현재값·변화·기간 요약과 데이터 표 접근 경로를 제공한다.
- 실시간 변화는 `aria-live=polite` 요약을 사용하고 모든 tick을 읽지 않는다.
- 색상, 위치, 애니메이션만으로 의미를 전달하지 않는다.
- `prefers-reduced-motion`에서 강조 애니메이션을 줄인다.

## 11. 실시간 정책

- 실시간이 필요한 recipe는 target과 mode가 확정된 뒤 자동 등록한다.
- 카드 마운트 수와 무관하게 동일 feed는 lease를 공유한다.
- 가시 영역과 활성 대상만 구독하고 화면에서 사라지면 소유권을 정리한다.
- backend는 raw alias/FID 대신 opaque `rtb_<hash>` binding과 `obs_<hash>` observation identity를 발급한다.
- frontend는 server가 제공한 binding table에 있는 update만 동일 semantic observation에 병합한다. raw row value나 임의 alias는 제품 UI update key로 인정하지 않는다.
- 숫자가 변해도 행·열·호가 위치를 안정적으로 유지한다.
- 변화를 짧게 강조하되 계속 깜빡이지 않는다.
- 연결 단절 시 마지막 정상값과 기준 시각을 유지하고 `재연결 중` 상태를 표시한다.
- generation이 다른 stale tick은 버린다.
- snapshot과 delta가 어긋나면 resync 후 사용자 화면을 갱신한다.
- 실시간 등록은 주문 실행 권한을 만들지 않는다.
- WebSocket lifecycle은 `연결 중`, `연결됨`, `재연결 중`, `연결 끊김`처럼 allowlist된 사용자 문구와 `role=status`로 표시한다. 내부 REG/REMOVE command와 raw 상태 코드는 표시하지 않는다.

## 12. 주문 안전 경계

주문은 조회 recipe와 같은 Canvas에 나타날 수 있지만 mutation 경계를 공유하지 않는다.

```text
draft → preview → explicit confirmation → broker request
      → accepted / partial / filled / rejected / in_doubt
```

필수 규칙:

- 자연어 주문 요청만으로 broker mutation을 실행하지 않는다.
- 종목, 방향, 수량, 주문 유형, 예상 금액·비용, 계좌를 확인 화면에 표시한다.
- confirmation 전에는 주문 API를 호출하지 않는다.
- 재시도는 동일 idempotency key를 사용한다.
- timeout이나 응답 손실을 성공으로 추정하지 않는다.
- 결과가 불명확하면 `in_doubt` 상태를 유지하고 request status를 조회한다.
- 수정·취소도 원주문과 변경 내용을 확인한다.
- 실시간 체결·잔고 구독과 주문 실행 권한을 분리한다.
- generic `/api/v1/canvas/push`는 canonical metadata를 함께 보낸 경우에도 주문 operation을 거부한다. 주문 receipt는 전용 draft/confirmation/execution 경계에서만 생성한다.

현재 로컬 TestClient 회귀 테스트는 위조 receipt가 `action` 또는 `facts`로 위장해도 `GENERIC_ORDER_PUSH_FORBIDDEN`으로 거부되고 Canvas event queue가 비어 있음을 확인한다. 이 증거는 실제 broker live 제출 테스트를 대체하지 않는다.

## 13. 대표 사용자 흐름

### 13.1 `삼성전자 차트 보여줘`

1. 삼성전자 identity와 차트 recipe를 결정한다.
2. 종목 header와 기존 Athena chart workbench를 우선 렌더한다.
3. 현재가·등락·거래량·기준 시각을 같은 화면에 연결한다.
4. `외국인 수급도 같이 보여줘` 후속 질문은 같은 시간축 아래 flow track을 추가한다.
5. `3개월로 바꿔줘`는 workspace를 새로 만들지 않고 기간만 갱신한다.

### 13.2 `삼성전자 실시간 호가 보여줘`

1. regular/after-hours와 5단/10단 요구를 결정한다.
2. snapshot을 먼저 표시한다.
3. 지원 feed를 자동 등록한다.
4. 매도·매수 호가를 하나의 연속 depth ladder로 표시한다.
5. 체결 tape와 총잔량·불균형을 같은 판단 문맥에 둔다.

### 13.3 `거래대금 상위 저평가 종목 보여줘`

1. 거래대금 ranking과 가치 filter를 결합한 탐색 recipe를 사용한다.
2. 목록에 거래대금, 등락, 핵심 가치 지표, 기준 시각을 표시한다.
3. 행 선택 시 선정 근거와 종목 상세를 연다.
4. 비교 tray에 추가하면 같은 기준으로 나란히 비교한다.

### 13.4 `삼성전자 10주 시장가로 매수해줘`

1. 주문 draft를 만든다.
2. 예상 주문금액·비용·가능수량과 시장가 위험을 표시한다.
3. 사용자의 명시적 confirmation을 받는다.
4. 주문을 한 번만 제출한다.
5. receipt와 접수·부분체결·체결·거부·결과불명 상태를 갱신한다.

## 14. 마이그레이션 계획

### 단계 0. 기준선 고정

- **현재 상태: 완료(로컬 자동 검증).**
- 현재 299 operation, 3,705 occurrence, 3,703 unique path 검증을 유지한다.
- 기존 fixture와 runtime capture를 기준선으로 보존한다.
- fixture-only 결과와 외부 live 결과를 서로 다른 증거로 기록한다.

### 단계 1. Registry 분리

- **현재 상태: 구조 구현 완료, official opaque raw 3개의 공식 의미 미확정으로 release 미완료.**
- 기존 `CanvasFieldContract`를 wire 보존 계약으로 한정한다.
- Semantic Concept layer와 Presentation Registry를 추가한다.
- 3,531개 semantic business raw와 3개 official opaque raw를 recipe/section/component 및 display tier/group/slot에 배치한다.
- 현행 REST occurrence `951`, `924`, `1279`는 공식 의미 확인 전까지 의미·단위를 발명하지 않고 중립 라벨의 named detail로 값을 보존한다.

### 단계 2. Recipe Resolver

- **현재 상태: operation→recipe deterministic registry 구현 완료; 전체 대화 후속 질문 E2E는 미완료.**
- 12개 recipe와 36개 section policy를 서버 정본으로 유지한다.
- 질문 의도와 entity에서 검증된 operation을 거쳐 recipe를 도출하는 deterministic 계약을 사용한다.
- Selector가 layout 또는 component ID를 임의 선택하지 못하게 한다.
- 필수·선택 operation, 실시간, 오류, 행동 정책을 recipe에 고정한다.

### 단계 3. Canary 전환

1. **로컬 구현·표적 테스트 완료:** AITS 차트 primary 보존과 semantic section 병합
2. **로컬 구현·표적 테스트 완료:** 실시간 호가 primary 보존, 중복 depth section 억제, opaque binding
3. **fixture 검증 완료:** 탐색·목록, 수급, 계좌를 포함한 12 recipe 대표 렌더
4. **로컬 안전 경계 완료:** 주문 draft 경계와 generic forged push 차단
5. **미완료:** 실제 Kiwoom REST/WebSocket/broker live E2E

### 단계 4. Product UI에서 raw surface 제거

- **현재 상태: production 경계와 로컬 회귀 테스트 완료.**
- production은 semantic workspace를 사용하고 raw `SemanticDetailSheet`를 마운트하지 않는다.
- wire coverage viewer는 명시적 developer diagnostics flag에서만 접근한다.
- transport/internal 기술 식별자가 제품 taxonomy로 노출되지 않는지 검사한다.
- official opaque raw는 값이 소실되지 않고 중립 라벨의 named detail에만 노출되는지 검사한다.

### 단계 5. Paper와 Runtime 일치

- **현재 상태: artboard 작성 기록은 있으나 live Paper 정리·재검증은 로그인 차단.**
- Paper에 canonical recipe와 상태 축을 설계한다.
- 실제 frontend component로 구현한다.
- Paper screenshot과 실제 Canvas capture를 비교한다.
- 자동 검증 뒤 사용자가 화면별로 승인한다.

## 15. 테스트 전략

### 15.1 Registry 테스트

- 299/299 operation assigned
- unassigned 0, duplicated 0
- 3,705/3,705 occurrence 보존
- 3,703 unique path와 `ka10173` 중복 ordinal 보존
- 모든 occurrence의 field class 분류
- 모든 semantic concept의 presentation destination 존재
- transport/internal의 독립 business destination 0
- official opaque raw의 named-detail destination 3/3
- 공식 의미 미확정 필드 0일 때만 full semantic gate 통과

### 15.2 Recipe 계약 테스트

- 대표 발화가 예상 recipe와 normalized entity로 결정됨
- 같은 의미의 후속 질문이 같은 workspace를 갱신함
- 독립 업무는 새 workspace를 생성함
- 모호한 기간·시장·호가 깊이를 fail closed 또는 사용자 선택으로 처리함
- LLM 출력이 임의 component/operation destination을 바꿀 수 없음

### 15.3 Renderer 테스트

- concept → recipe → section → component/column의 exact mapping
- scalar, list, compound object, pagination, masking
- 중복 concept 병합과 source conflict
- loading, empty, partial error, stale, reconnect, resync
- optional section 실패가 primary module을 제거하지 않음
- user-visible raw alias/FID/JSON path 0

### 15.4 실시간 테스트

- 자동 등록·공유·해제 lifecycle
- generation mismatch tick 폐기
- snapshot/delta merge와 resync
- viewport 밖 목록 행 구독 해제
- opaque binding 외 raw alias/FID update 거부
- WebSocket lifecycle 상태의 사용자 문구·`role=status` 렌더
- layout 안정성, 변화 강조, reduced motion
- screen reader live summary throttling

### 15.5 주문 테스트

- confirmation 없는 broker mutation 0
- canonical metadata로 위조한 generic order push와 canvas type 위장 거부
- 중복 제출 방지와 idempotency
- timeout, reject, partial fill, cancel, amend, `in_doubt`
- receipt와 계좌·체결 상태의 정합성
- 조회 subscription과 mutation authority 분리

### 15.6 E2E와 시각 검증

- 299개 합성 fixture 전수 렌더
- 대표 사용자 질문과 후속 질문 시나리오
- 실제 Canvas 캡처와 Paper 기준안 비교
- 데스크톱 기본 폭과 `390×844` 좁은 데스크톱 창 회귀
- 키보드, focus, contrast, semantic tree, screen reader
- 실제 외부 연결 검증과 fixture 검증 결과를 별도로 보고

### 15.7 현재 로컬 자동 검증 증거

2026-08-31 현재 문서 갱신 과정에서 다음 표적 검증을 새로 실행했다.

| 검증 | 결과 | 증명 범위 |
| --- | --- | --- |
| backend registry/recipe/envelope/fixture 테스트 | 103 passed | 299/3,705/3,703, 3,531/92/79/3, 12 recipe/36 policy, 공식 code/color raw 보존, official opaque named detail, forged order 차단, opaque binding |
| frontend semantic workspace/raw boundary/integrated surface 테스트 | 66 passed | named section, raw 미노출, AITS·호가 primary 보존, opaque realtime update, lifecycle 상태, 접근성 상태 |
| Electron semantic workspace receipt | 12 recipe capture | fixture-only 렌더, 외부 호출 없음, `390×844` 좁은 데스크톱 창 회귀 |

이 결과는 합성 데이터·TestClient·Node DOM·Electron fixture 증거다. receipt의 `live_kiwoom_connectivity_verified`는 `false`이며 실제 Kiwoom REST/WebSocket/broker 연결을 증명하지 않는다.

## 16. Paper Design 산출물

Paper의 `화면`과 `카드`는 다음 정본을 표현한다.

### 16.0 현재 Paper 작업 상태

| 항목 | 현재 기록 | 판정 |
| --- | --- | --- |
| `화면` artboard | 53개 | 작성 기록 있음; 이번 갱신에서 live tree/screenshot 재검증 못함 |
| `카드` artboard | 19개 | 작성 기록 있음; 이번 갱신에서 live tree/screenshot 재검증 못함 |
| 최종 page | `화면`, `카드` 2개 | 목표 |
| 기존 page 정리 | 5개에서 2개로 축소 | **미완료** |
| blocker | Paper 로그인 필요 | 삭제·최종 구조 확인 차단 |

로그인 차단 상태에서는 53/19 artboard 기록을 현재 Paper live 상태의 완전한 증거로 승격하지 않는다. 추가 page 삭제, artboard 구조 확인, screenshot 비교, 사용자 검수는 로그인 복구 뒤 수행한다.

### 16.1 화면 페이지

- persistent chat/history와 Canvas workspace 관계
- 대표 recipe별 full workspace
- 후속 질문으로 section이 추가·변경되는 상태
- 데스크톱 기본 창·좁은 창 layout
- loading, empty, partial error, stale, reconnect, permission, confirmation, expired 상태
- 실제 frontend renderer와 대응하는 artboard ID
- 작성 대상 합계: 53 artboard

### 16.2 카드 페이지

카드 수를 맞추는 overview가 아니라 실제 재사용 UI module을 제시한다.

- context header
- answer band
- Athena chart workbench
- depth ladder와 trade tape
- metric band
- flow matrix
- comparison table
- selectable list와 typed detail
- account/position panel
- order ticket와 receipt timeline
- evidence timeline
- status band
- 작성 대상 합계: 19 artboard

각 module은 기본·loading·empty·error·live·stale·disabled/confirmation 상태와 데스크톱 기본 창·좁은 창 variant를 가진다.

### 16.3 Paper 완료 증거

- 모든 artboard가 실제 recipe/renderer/state와 연결된다.
- 대표 화면만 그린 것을 전체 coverage로 선언하지 않는다.
- 구조 확인과 screenshot을 모두 수행한다.
- 자동 검증 통과 후 사용자에게 화면별 검수 의견을 요청한다.

## 17. 완료 조건

다음 조건을 모두 만족해야 완료로 선언한다.

### 데이터와 의미

- [x] 299/299 operation assigned, unassigned 0, duplicated 0
- [x] 3,705/3,705 field occurrence와 3,703 unique path 보존
- [x] 모든 occurrence 분류: semantic business raw 3,531 / transport 92 / structural internal 79 / official opaque raw 3
- [ ] 공식 의미 미확정 occurrence 0
- [x] 3,534개 user-accessible official raw에 이름 있는 recipe/section/component destination 존재
- [x] unsafe/diagnostic-only semantic product destination 0
- [x] 12개 recipe, 36개 section policy, 299개 operation reachability 검증
- [ ] 동일 의미 중복 노출 0

### Runtime

- [x] 검증된 operation에서 server-owned deterministic recipe를 도출하고 client-selected recipe를 거부함
- [ ] 자연어 task/entity/time/action부터 후속 대화까지 전체 deterministic resolver E2E
- [ ] primary module이 optional enrichment보다 먼저 렌더됨
- [x] 동일 `view_instance_id`의 성공 section 점진 병합 로컬 회귀 테스트
- [x] section 단위 loading/empty/partial/error/stale/reconnecting 로컬 렌더 테스트
- [x] production 제품 UI의 raw alias/FID/JSON path/API ID 미노출 로컬 회귀 테스트
- [x] opaque realtime binding의 semantic observation 갱신 로컬 회귀 테스트
- [x] Task Canvas WebSocket lifecycle status UI 로컬 회귀 테스트
- [ ] 실시간 자동 등록·공유·해제·resync E2E 통과
- [x] generic forged order push 차단과 confirmation 전 broker 미호출 로컬 회귀 테스트
- [ ] 주문 idempotency와 `in_doubt` E2E 통과

### UI와 검수

- [ ] 대표 업무에서 직접 답이 첫 viewport에 보임
- [ ] 관련 상세는 기본 창과 좁은 창 모두 3회 이내 상호작용으로 접근 가능
- [x] `390×844` 좁은 데스크톱 창 fixture에서 document/workspace overflow 없음, table 자체 overflow·focus·reduced motion 검증
- [ ] WCAG 2.2 AA 기준 통과
- [ ] Paper의 recipe·module·상태 artboard와 실제 Canvas capture가 일치
- [x] 299개 synthetic response model·Task Canvas presentation contract 전수 테스트 통과
- [x] 12개 recipe 대표 Electron fixture capture 생성
- [x] fixture-only 증거와 live 외부 연결 증거의 판정 경계 명시
- [ ] 실제 Kiwoom REST/WebSocket/broker live E2E 통과
- [ ] Paper 5개 page를 `화면`, `카드` 2개로 정리하고 53/19 artboard를 live 재검증
- [ ] 사용자 화면별 검수 승인 완료

## 18. 성공 지표

카드 수가 아니라 다음을 측정한다.

- 질문 입력부터 첫 유용 화면까지의 시간
- 직접 답을 찾는 데 걸린 시간
- 관련 상세까지 필요한 상호작용 수
- 사용자 의미 필드의 named destination coverage
- 공식 business raw의 사용자 접근 가능 coverage와 transport/internal 기술 alias 노출 건수
- 부분 실패가 전체 업무를 막은 비율
- 실시간 stale·재연결 복구율
- 주문 중복 제출과 결과불명 오판 건수
- 대표 사용자 업무 완료율

## 19. 정본 근거

- `backend/athena_api/canvas_card_registry.py`: 6 root, 19 Capability, 299 operation 소유권
- `backend/athena_api/canvas_field_registry.py`: 3,705 occurrence, 3,703 unique path, 현행 REST `951`·`924`·`1279` occurrence의 opaque 상태
- `backend/athena_api/semantic_presentation_registry.py`: 3,531/92/79/3 분류, display tier/group/slot과 official raw 보존 목적지
- `backend/athena_api/view_recipe_registry.py`: 12 Task View Recipe, 36 section policy, 19 Capability, 299 operation reachability
- `backend/athena_api/canvas_field_coverage.py`: registry/review/release gate 분리
- `backend/tests/unit/test_canvas_field_coverage.py`: 현재 field coverage 검증값
- `backend/tests/integration/test_all_kiwoom_render_fixtures.py`: 299 response model과 3,705 destination fixture 검증
- `backend/tests/api/test_task_canvas_envelope.py`: server-owned recipe, opaque binding, raw 격리, forged order generic push 차단
- `backend/tests/integration/test_all_task_canvas_presentations.py`: 299 operation Task Canvas presentation contract 검증
- `app/lib/semantic-workspace.js`: 제품용 named section, display tier/group/slot, opaque realtime update
- `app/lib/semantic-detail-sheet.js`: developer diagnostics용 legacy wire viewer
- `app/lib/integrated-card-surface.js`: 기존 6-root 마운트와 panel session
- `app/canvas.js`: semantic workspace, developer diagnostics gate, AITS 차트·호가 primary, realtime lifecycle 연결 경로
- `artifacts/task-canvas/semantic-workspaces/receipt.json`: 12 recipe fixture capture, 외부 연결 미검증, `390×844` 좁은 데스크톱 창 회귀
- `docs/api/19-capability-api-inventory.md`: 19 Capability API와 field coverage 계약
- [Kiwoom REST API 공식 spec 고정 커밋](https://raw.githubusercontent.com/Kiwoom-Securities/Kiwoom-REST-API/e24843fc82a78fe7b6ec68625b57f267eda95e77/kiwoom/_data/kiwoom_api_spec.json): 2026-08-31 공식 `main` 기준. 이전 검증 커밋과 spec SHA-256이 동일하며, WebSocket `04`의 `951`·`924`, `1h`의 `1279`를 `Extra Item`으로 정의
- [Kiwoom REST API 공식 현재 커밋](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/commit/9180debf7aea0074715dd8f7a15af432afbfc403): 같은 opaque 정의가 유지되는지 재검증한 기준
- [Kiwoom OpenAPI+ 개발가이드 v1.7](https://download.kiwoom.com/web/openapi/kiwoom_openapi_plus_devguide_ver_1.7.pdf): 레거시 OCX 잔고통보에서만 `951=예수금`을 정의하며 현행 REST와의 동치를 보장하지 않음
- `docs/architecture/6-canvas-card-compression-plan.md`: 기존 6-card projection과 미완료 semantic render gate

## 20. 최종 원칙

299개 API는 UI 목록이 아니라 데이터 공급망이다. 19 Capability는 backend routing taxonomy이며, 기존 6개 root는 runtime ownership boundary다. 사용자가 실제로 보는 것은 자신의 질문을 완성하는 하나의 workspace와 그 안의 의미 있는 금융 UI module이다.

무손실 보존과 좋은 표현은 별도 문제다. 모든 값을 보존했다는 이유로 원본 필드를 사용자에게 넘기지 않는다. 모든 사용자 의미 필드가 정확한 맥락, 단위, 시점, 상호작용을 가진 이름 있는 화면에 배치되고 실제 Canvas에서 검증됐을 때만 완료로 선언한다.
