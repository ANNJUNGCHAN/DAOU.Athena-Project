# 백테스트 시각 설계 ↔ 코드 왕복 구현 평가

- 작성 기준: 2026-09-03
- 범위: Paper의 네 상태(시각 편집 가능, 연결 오류, 오류 노드 더블클릭→코드 줄, 대화 패치 적용 후 그래프·코드 동기화 완료)를 실제 제품 계약으로 옮기는 방법
- 근거: 현재 Athena 백테스트 구현과 [시각 백테스트 전략 저작 오픈소스 벤치마크](./backtest-visual-workflow-open-source-benchmark.md)

## 결론

구현은 가능하다. 단, 성공 조건은 **임의 Python과 그래프의 무손실 양방향 변환을 약속하지 않는 것**이다. Athena가 보장할 왕복 범위는 서버가 검증하고 컴파일할 수 있는 선언형 전략 subset으로 제한한다.

1. `VisualStrategyGraph v1`은 사용자가 편집하는 시각 소스이고, `StrategySpec`은 실행 의미의 정본이다. 둘은 서버 컴파일러가 검증 가능한 일대일 의미 계약을 가진다.
2. Python은 그래프에서 생성된 산출물이거나 별도의 고급 `code-only` 소스다. 임의 Python을 편집 가능한 그래프로 완전 복원하는 기능은 비목표다.
3. 검증을 통과한 그래프에서 생성한 Python에는 stable node ID와 AST/source span을 연결한 authoritative source map을 붙인다. 검증 전·실패 상태에서는 실행 불가능한 diagnostic preview code와 provisional source map만 사용할 수 있으며, 이 preview조차 만들 수 없으면 코드 이동을 비활성화한다.
4. 대화형 수정은 한 번에 질문 하나만 제시하고, 답을 받아도 즉시 저장하거나 실행하지 않는다. 서버가 만든 비활성 patch와 diff를 먼저 보여주고 사용자가 적용한 뒤에만 검증·컴파일·버전 저장한다.
5. 그래프, 정규화 `StrategySpec`, 생성 코드, source map, compiler version, hash는 `origin=visual`인 한 전략 버전으로 원자적으로 저장한다. 지원 밖 코드 분기는 `origin=code_only`다. 두 origin은 서버가 `is_active=false`를 강제하고 기존 `active_version_id`를 바꾸지 않는다. 활성화·백필·백테스트 실행은 별도 사람 승인 경계를 유지한다.

전체 난이도는 **4/5(중상)**이다. 노드 화면 자체보다 그래프와 실행 의미의 동등성, source map 무결성, 동시 수정 충돌, 원자적 버전 저장이 어렵다. 반대로 임의 Python 완전 왕복까지 범위에 넣으면 검증 가능한 제품 계약을 만들기 어려우므로 진행하지 않는다.

## Paper 네 상태를 제품 상태로 옮기는 계약

Paper는 상호작용과 정보 구조를 검증하는 설계 초안이다. 아래 상태가 실제로 동작한다는 런타임 증거는 아니며, 구현 후 테스트와 Electron 검증이 필요하다.

| Paper 상태 | 제품 상태 | 필수 동작 | 금지 동작 |
|---|---|---|---|
| 시각 편집 가능 | `editing.valid` 또는 `editing.unvalidated` | 팔레트에서 허용 노드 추가, typed port 연결, 검사기 편집, 서버 검증 | 브라우저에서 자체 신호 계산, 임의 코드/HTTP/파일 노드 실행 |
| 연결 오류 | `editing.invalid` | 노드·포트·엣지·검사기에 같은 diagnostic 표시, 실행 비활성화 | 누락 값을 임의 기본값으로 채우기, 오류가 있는데 성공 상태 표시 |
| 오류 노드 더블클릭→코드 줄 | `code.focused-from-node` | valid graph는 authoritative map, invalid graph는 현재 revision에 결박된 미실행 preview map으로 범위를 열고 종류를 표시 | preview를 실행 artifact로 표시, 오래된 map으로 비슷한 줄 추정, 매핑 실패를 숨기기 |
| 대화 패치 적용 후 동기화 완료 | `draft.synced` | 비활성 patch 검토→사용자 적용 receipt→서버 재검증/컴파일→`is_active=false`인 새 버전 저장 | `versions` API 호출 자체를 승인으로 간주, 자동 활성화·백필·실행, 기존 버전 덮어쓰기 |

상태 전이는 다음 하나의 경로를 따른다.

```text
visual editing
  -> server validation
  -> invalid: node diagnostic
       -> deterministic diagnostic preview + provisional map, if available
       -> openCodeAt(node_id) in preview-only editor
       -> inspector only, if preview generation fails
  -> valid: executable artifact + authoritative map candidate
  -> one-question diagnosis
  -> inactive patch preview
  -> user applies
  -> server validate + compile
  -> atomic version save
  -> synced inactive draft
  -> separate human review/activate/run
```

어느 단계에서도 “패치 생성”, “저장”, “활성화”, “실행”을 같은 행위로 합치지 않는다.

## 의미 정본과 지원 범위

### 정본 결정

저장과 실행 계약은 다음처럼 나눈다.

| 객체 | 역할 | 정본 여부 |
|---|---|---|
| `VisualStrategyGraph v1` | 노드·엣지·파라미터로 사용자의 시각적 의도를 보존 | 시각 저작 소스의 정본 |
| 정규화 `StrategySpec` | 지표, 진입/청산 조건, 리스크, 비용, 데이터 범위를 검증하고 실행 의미를 고정 | 실행 의미의 정본 |
| diagnostic preview code | invalid graph에서도 오류 위치를 설명하기 위해 결정적으로 생성하는 미실행 코드 | 정본 아님; `executable=false`, `preview_only=true` |
| provisional source map | node ID와 diagnostic preview의 AST/source span 연결 | graph revision/compiler version/preview hash에 종속된 임시 추적 계약 |
| 실행 가능한 생성 Python | 검증을 통과한 그래프 의미를 사람이 읽고 디버깅할 수 있게 표현한 파생 산출물 | 정본 아님 |
| authoritative source map | node ID와 실행 가능한 생성 코드의 AST/source span 연결 | 저장된 artifact version에 종속된 추적 계약 |
| 임의 Python | 고급 사용자가 직접 관리하는 별도 전략 소스 | `code-only` 모드에서만 정본 |

그래프와 `StrategySpec`은 컴파일러가 동등성을 보장하는 범위에서 함께 저장한다. 둘의 hash나 compiler version이 맞지 않으면 `synced`로 표시하지 않는다.

### V1에서 표현할 것

- OHLCV 입력과 현재 서버가 지원하는 데이터 주기·수정주가 설정
- 현재 지표 registry에 등록된 지표와 숫자 파라미터
- `cross_above`, `cross_below`, `greater_than`, `less_than`, `equals` 등 현재 `StrategySpec` 연산자
- 평면적인 `AND`/`OR` 조건 묶음
- 정확히 하나의 진입 출력과 하나의 청산 출력
- 현재 `StrategySpec`이 검증하는 손절·익절, 비용, 데이터 범위

### V1에서 표현하지 않을 것

- 임의 Python/JavaScript 실행
- HTTP, 파일, 데이터베이스, 계정, 실거래 주문 노드
- 임의 import, 임의 표현식, 반복문, 사용자 정의 제어 흐름
- 현재 엔진이 소비하지 않는 `size` 포트
- 다중 자산 포트폴리오, 이벤트/주문형 전략, 사용자 정의 지표 런타임
- 지원 subset 밖의 Python을 편집 가능한 그래프로 자동 변환하는 기능

기존 `backend/athena_api/backtest/flow.py`와 `POST /api/v1/backtest/flow`는 Python AST에서 확인 가능한 범위만 보여주는 읽기 전용 설명으로 유지한다. 기존 `mapmodel.py`와 `POST /api/v1/backtest/map`도 현재의 폼/YAML·Python 지도를 제공할 수 있지만, 그 결과를 곧바로 편집 가능한 `VisualStrategyGraph`라고 간주하지 않는다.

## 데이터 계약

### `VisualStrategyGraph v1`

최소 저장 단위는 다음 필드를 가져야 한다.

```text
VisualStrategyGraph
  graph_version
  nodes[]
    id              stable ID; label, 순서, 캔버스 위치에서 만들지 않는다
    kind            registry가 허용한 영문 식별자
    params          kind별 allowlist 파라미터
    ui?             위치·접힘 상태; 실행 의미와 분리
  edges[]
    id
    from { node_id, port }
    to   { node_id, port }
  scenario          종목·기간·수정주가·비용·리스크
```

stable node ID 규칙은 다음과 같다.

- 노드를 만들 때 UUID/ULID 계열 ID를 한 번 발급하고 이름 변경, 이동, 파라미터 변경에도 유지한다.
- 삭제한 ID를 다시 쓰지 않는다.
- 복제한 노드는 새 ID를 받는다.
- edge도 별도 stable ID를 가진다.
- 서버는 ID 중복, 존재하지 않는 참조, 잘못된 port를 거부한다.
- 한국어 label은 표시 문자열일 뿐 ID나 컴파일 의미에 사용하지 않는다.

### 오류 diagnostic

모든 그래프 검증 오류는 가능한 경우 노드와 포트에 귀속한다. 그래프 전체 오류처럼 위치를 특정할 수 없는 경우에만 `node_id`와 `port`를 `null`로 둔다.

```json
{
  "code": "BTG-PORT-002",
  "severity": "error",
  "node_id": "exit-cross-below-01",
  "port": "slow",
  "json_path": "$.nodes[5].inputs.slow",
  "source_span": {
    "file": "golden_cross.py",
    "start": { "line": 18, "column": 31 },
    "end": { "line": 18, "column": 42 }
  },
  "message_ko": "느린 SMA 입력이 없습니다.",
  "suggested_fix": {
    "kind": "connect_port",
    "from": { "node_id": "sma-slow-01", "port": "value" },
    "to": { "node_id": "exit-cross-below-01", "port": "slow" }
  }
}
```

필드 계약:

| 필드 | 계약 |
|---|---|
| `code` | 번역과 무관한 안정적 오류 코드. 테스트·분석·UI 분기에 사용 |
| `severity` | `error`, `warning`, `info`; `error`가 하나라도 있으면 저장 후 실행 단계로 진행 불가 |
| `node_id` | 오류가 귀속된 stable node ID 또는 `null` |
| `port` | 오류 포트 ID 또는 `null` |
| `json_path` | 원본 graph JSON의 위치. 서버 로그와 검사기 상세에 사용 |
| `source_span` | 같은 응답 bundle의 authoritative artifact 또는 provisional preview에서만 유효한 파일/시작/끝 위치. 안전한 map이 없으면 `null` |
| `message_ko` | 사용자가 이해할 수 있는 한국어 원인·행동 설명 |
| `suggested_fix` | allowlist patch 초안 또는 `null`; 직접 적용 명령이 아님 |

UI는 하나의 diagnostic을 네 곳에 같은 `code`로 표시한다.

- 노드: 오류 테두리와 짧은 배지
- 포트/엣지: 문제 위치 강조
- 검사기: `message_ko`, 입력값, 해결 선택지
- 코드: source map이 있을 때 해당 span 강조

### node ID ↔ AST/source span source map

source map에는 두 등급이 있다.

1. **Provisional map:** draft graph가 invalid여서 `StrategySpec` 컴파일을 끝낼 수 없을 때 diagnostic preview code와 함께 만든다. 이 bundle에는 `executable=false`, `preview_only=true`, `graph_revision`, `graph_hash`, `compiler_version`, `preview_hash`가 필수다. 실행·활성화·성과 계산 입력으로 사용할 수 없다.
2. **Authoritative map:** graph validate와 compile이 모두 성공한 뒤 실행 가능한 생성 artifact와 함께 만든다. 이 bundle만 전략 버전에 원자 저장한다.

검증 실패가 예상되는 누락 포트도 코드 위치를 보여주려면 preview generator가 빠진 입력을 임의 값으로 채우지 않고 명시적 오류 sentinel로 직렬화해야 한다. 같은 graph revision과 compiler version은 같은 preview code와 provisional map을 만들어야 한다. Paper의 오류 코드 화면에서 보인 **17행 강조는 실행 가능한 전략 코드가 아니라 provisional source map이 그 graph revision에 반환한 diagnostic preview의 예시 span**이다. 17행 자체는 고정 계약이 아니며 코드 템플릿이나 compiler version이 바뀌면 달라질 수 있다.

authoritative source map은 컴파일 때 생성하며 다음 정보에 결박한다.

```text
SourceMap
  graph_hash
  spec_hash
  artifact_hash
  compiler_version
  entries[]
    node_id
    ast_path
    source_span { file, start, end }
    role          declaration | expression | entry | exit | risk
```

`source_span`만 저장하면 코드 포맷 변경 때 쉽게 깨진다. 따라서 stable `node_id`, 생성 AST의 구조적 경로인 `ast_path`, 정확한 줄/열 범위, `artifact_hash`를 함께 저장한다. UI가 authoritative map을 쓰기 전 현재 열린 코드의 hash가 `artifact_hash`와 같은지 확인한다. provisional map은 대신 `graph_revision`, `graph_hash`, `compiler_version`, `preview_hash`가 모두 현재 draft와 같은지 확인한다.

invalid graph에서 preview generator가 오류 sentinel을 안전하고 결정적으로 직렬화하지 못하면 `openCodeAt(node_id)`의 exact 코드 이동을 비활성화한다. 이 경우 오류 노드·포트 강조와 inspector 설명만 유지하며, 존재하지 않는 코드 줄을 만들거나 추정하지 않는다. 검증을 통과한 뒤에만 실행 가능한 generated artifact와 authoritative source map을 같은 version transaction으로 저장한다.

시각 draft 저장 시 서버는 먼저 graph revision을 고정하고 validate한다. 실패하면 graph·diagnostics와 함께 가능한 경우에만 결정적 preview bundle을 draft record에 저장한다. 이 record는 전략 version이 아니고 runner 입력으로 선택할 수 없다. preview 생성까지 실패하면 graph·diagnostics만 저장하고 exact 코드 이동 capability를 `false`로 돌려준다. validate가 성공하더라도 실행 가능한 artifact와 authoritative map의 전략 version 저장은 사용자의 patch 적용 receipt 또는 명시적 저장 요청 뒤에만 수행한다.

사용자가 생성 코드를 직접 바꾸면 기존 map은 즉시 `stale`이다. 서버가 수정 코드를 지원 subset으로 다시 증명해 그래프 patch를 만들 수 있을 때만 새 graph/spec/artifact/map을 생성한다. 증명할 수 없으면 비슷한 노드를 추정하지 않고 `code-only` 분기를 제시한다.

## 오류 노드 더블클릭 → 코드 줄

`openCodeAt(node_id)`는 UI 편의 함수가 아니라 source map 검증 절차를 포함해야 한다.

1. 캔버스의 `dblclick` 이벤트에서 stable `node_id`를 얻는다.
2. graph가 valid이면 현재 draft version, `graph_hash`, `artifact_hash`, `compiler_version`에 맞는 authoritative map을 찾는다.
3. graph가 invalid이면 `executable=false`, `preview_only=true`인 diagnostic preview와 provisional map을 찾고, `graph_revision`, `graph_hash`, `compiler_version`, `preview_hash`가 현재 draft와 같은지 확인한다.
4. 해당 `node_id` entry가 없거나 필요한 hash가 다르면 코드를 추정해 열지 않는다. “현재 오류의 정확한 코드 위치를 만들 수 없습니다” diagnostic을 표시하고 노드·포트 inspector에 머문다. stale authoritative map에는 재컴파일 또는 code-only 검토를 제시한다.
5. mapping이 유효하면 `designTab='code'`로 전환한다. preview이면 코드 상단과 편집기 전체에 `미실행 오류 미리보기`를 표시하고 실행·저장 대상으로 선택할 수 없게 한다.
6. `app/lib/backtest-code-editor.js`의 기존 `highlightLines(first, last)`를 재사용하고, 정확한 column selection·스크롤·포커스를 위한 `openSpan(source_span)` 동작을 확장한다.
7. 코드 상단에는 “연결된 노드”, node label, 오류 코드, 파일:줄, `authoritative | preview` 종류를 표시한다. “시각 설계에서 보기”는 같은 `node_id`로 돌아간다.
8. 사용자가 실행 가능한 생성 코드를 수정하면 artifact hash를 다시 계산하고, map이 stale인 동안에는 “그래프·코드 동기화됨” 상태를 표시하지 않는다. diagnostic preview code는 직접 편집하거나 실행하지 못한다.

접근성 때문에 더블클릭만 제공하지 않는다. 노드 컨텍스트 메뉴와 검사기의 `코드에서 열기` 버튼, 키보드 단축 동작이 같은 `openCodeAt(node_id)`를 호출해야 한다.

## 대화형 오류 수정 계약

### 한 번에 질문 하나

대화 진단기는 여러 결정을 한 메시지에 묶지 않는다. 예를 들어 누락된 느린 SMA 입력과 청산 기준 선택이 함께 발견돼도 현재 진행을 막는 첫 결정 하나만 묻는다.

질문 응답에는 다음이 포함된다.

- 질문이 해결할 diagnostic `code`
- 현재 선택과 권장 선택
- 각 선택이 바꾸는 node/edge/parameter
- 실행이나 활성화가 일어나지 않는다는 상태
- 다음 질문이 남아 있는지 여부

사용자가 자연어로 “오류를 고쳐줘”라고 해도 LLM이 graph JSON이나 코드를 직접 저장하지 않는다. LLM은 질문 후보와 구조화된 repair intent만 만든다. 서버가 node registry, graph schema, 현재 base version에 대해 patch 가능성을 검증한다.

### 비활성 patch preview

질문이 해소되면 서버는 다음과 같은 **비활성 수정안**을 반환한다.

- `base_version_id`, `base_graph_hash`, `base_artifact_hash`
- 해결하는 diagnostic codes
- graph JSON Patch 또는 동등한 allowlist patch
- 예상 `StrategySpec` diff
- 생성 코드 diff
- 새 diagnostics 미리보기
- `graph_compatible: true | false`

UI는 `적용`, `차이 보기`, `버리기`를 제공한다. 수정안 생성만으로 화면의 활성 graph, 저장된 버전, 실행 설정을 바꾸지 않는다.

### 사용자 적용 이후 서버 처리

기존 `POST /api/v1/backtest/strategies/{strategy_id}/versions`는 일반 버전 생성 API이지 그 자체가 사람 승인 전용 endpoint가 아니다. 현재 구현에서는 `origin=human|form|llm_draft`만 허용하고 `human`·`form`은 즉시 active가 될 수 있다. 따라서 visual patch의 사용자 승인은 다음 정보가 포함된 별도 UI/서비스 요청과 base-version receipt로 증명해야 한다.

- 사용자가 누른 `apply_visual_patch` action ID와 시각
- `strategy_id`, `base_version_id`, `base_graph_hash`, `base_artifact_hash`
- 사용자가 검토한 `patch_id`와 `patch_hash`
- 아직 활성화·실행하지 않는다는 요청 목적

사용자가 `적용`을 눌러 이 receipt가 만들어졌을 때만 다음 순서로 처리한다.

1. optimistic concurrency 검사: 현재 version/hash가 patch의 base와 같은지 확인한다.
2. graph patch 적용.
3. graph schema, node kind/params, typed ports, 필수 입력, cycle, 진입·청산 출력, alias 충돌 검증.
4. graph→정규화 `StrategySpec` 컴파일.
5. 기존 `backend/athena_api/backtest/compile.py` 계약으로 signals 동등성을 검증할 수 있는 artifact 생성.
6. 생성 Python과 node ID↔AST/source span map 생성.
7. graph/spec/artifact/map/compiler version/hash를 하나의 새 `origin=visual`, `is_active=false` 전략 버전으로 원자 저장.
8. 저장된 값을 다시 읽어 hash, 새 version ID, `is_active=false`, 변경되지 않은 `active_version_id`를 receipt로 응답.

3~7 중 하나라도 실패하면 아무 산출물도 저장하지 않는다. 기존 버전은 불변으로 남긴다. 저장 성공 이후에도 자동으로 다음 작업을 하지 않는다.

- `POST /api/v1/backtest/strategies/{strategy_id}/activate` 호출 금지
- `POST /api/v1/backtest/data/backfill` 호출 금지
- `POST /api/v1/backtest/runs` 호출 금지
- 배포·주문 경로 호출 금지

사용자에게는 `동기화된 비활성 초안`과 별도의 `실행 전 검토` 동작만 제공한다.

### 표현 불가능한 코드 수정

코드에서 한 수정이 `VisualStrategyGraph v1`으로 표현되지 않으면 UI는 자동 왕복을 가장하지 않고 다음 두 선택을 명시한다.

1. **그래프 호환 유지:** 지원 표현으로 수정안을 다시 만들고 graph/spec/generated code를 함께 갱신한다.
2. **코드 전용으로 분기:** 현재 시각 버전을 그대로 보존하고 새 `origin=code_only`, `is_active=false` 버전을 만든다. 이후 그래프 탭은 마지막 호환 snapshot을 읽기 전용으로 보여주며 현재 코드와 동기화됐다고 표시하지 않는다.

두 선택 모두 새 버전이다. 기존 graph 버전을 덮어쓰지 않으며, code-only 전환도 활성화나 실행을 뜻하지 않는다.

## 현재 저장소와의 연결

### 프런트엔드

| 현재 파일 | 구현 역할 |
|---|---|
| `app/lib/backtest-canvas.js` | 기존 설계 탭에 독립 `visual` 탭 추가, 상태 전이와 사람 승인 경계 소유. 현재 `flow` 읽기 전용 지도와 구분 |
| `app/lib/backtest-visual-editor.js` 신규 | 팔레트, 노드/포트/엣지, 검사기, diagnostics, 키보드 대체 조작, `openCodeAt(node_id)` 이벤트를 캔버스에서 분리 |
| `app/lib/backtest-code-editor.js` | 기존 `highlightLines()` 위에 `openSpan()`과 node/source-map receipt 표시 추가. diff 렌더러는 patch preview에 재사용 |
| `app/lib/main/backtest-bridge.js` | 신규 visual validate/compile/patch 요청과 확장된 버전 저장을 기존 REST bridge 패턴으로 노출 |
| `app/canvas.js` | Electron IPC wiring과 백테스트 캔버스 의존성 주입 |
| `app/shell.css` | visual editor layout, diagnostics, focus, narrow-width drawer/overlay 상태 |

현재 `backtest-canvas.js`의 `flow`·`form`·`code`는 이미 서로 다른 저작/설명 역할을 가진다. `visual`은 `flow`를 편집기로 바꾸지 말고 새 탭으로 추가한다. 그래야 임의 Python AST 지도가 편집 가능한 의미 그래프처럼 오해되지 않는다.

좁은 중앙 폭에서는 팔레트·캔버스·검사기를 고정 3열로 유지하지 않는다.

- 넓은 폭: palette / canvas / inspector 3열
- 중간·좁은 폭: canvas를 유지하고 palette와 inspector를 각각 drawer 또는 overlay로 전환
- 선택한 노드와 diagnostic은 drawer를 닫아도 캔버스와 상태 바에 남김
- overlay를 닫으면 포커스가 원래 노드로 돌아감
- 드래그 없이 쓸 수 있는 구조화된 목록/폼 대체 보기를 제공

### 백엔드

| 현재 파일/API | 재사용 또는 확장 |
|---|---|
| `backend/athena_api/backtest/schema.py` | `StrategySpec` 실행 의미 검증을 그대로 사용. 별도 `visual_schema.py`에서 graph/node/edge/diagnostic 계약 추가 |
| `backend/athena_api/backtest/compile.py` | graph compiler의 최종 대상. 새 실행 엔진을 만들지 않고 기존 `entry`/`exit` signals 계약 사용 |
| `backend/athena_api/backtest/flow.py` | 임의 Python AST 읽기 전용 설명 유지 |
| `backend/athena_api/backtest/mapmodel.py` | 폼/코드 지도 모델은 유지. editable graph 모델과 타입을 분리 |
| `backend/athena_api/backtest/codegen.py` | 생성 코드 경로 재사용. stable node marker와 source-map emission 확장 |
| `backend/athena_api/backtest/diagnose.py` | “수정안을 만들지만 적용하지 않음”이라는 기존 경계 재사용. graph-aware repair intent/patch는 별도 검증 계층 추가 |
| `backend/athena_api/backtest/store.py` | origin allowlist에 `visual`·`code_only` 추가, 두 origin의 `active=True`를 저장층에서도 거부, artifact bundle을 한 transaction으로 저장하고 base version 충돌 검사 추가 |
| `backend/athena_api/api/backtest.py` | visual endpoint와 확장 version body 제공. 활성화·실행 endpoint와 물리적으로 분리 |

기존 API는 다음 경계를 이미 제공한다.

- `POST /api/v1/backtest/validate`: YAML/Python 검사, 실행하지 않음
- `POST /api/v1/backtest/flow`: Python AST 읽기 전용 지도, 실행하지 않음
- `POST /api/v1/backtest/map`: 폼/YAML·Python 읽기 전용 지도, 실행하지 않음
- `POST /api/v1/backtest/codegen`: 코드를 반환하지만 저장하지 않음
- `POST /api/v1/backtest/diagnose`: 수정 소스를 제안하지만 적용하지 않음
- `POST /api/v1/backtest/strategies/{strategy_id}/versions`: 일반 버전 생성 API. 현재 `origin=human|form|llm_draft`만 허용하며 `human`·`form`은 즉시 active가 될 수 있으므로 visual 승인 경계로 그대로 간주하면 안 됨
- `POST /api/v1/backtest/strategies/{strategy_id}/activate`: 별도 사람 클릭 경계
- `POST /api/v1/backtest/data/backfill`, `POST /api/v1/backtest/runs`: 별도 데이터·실행 경계

신규 API는 최소 세 개로 제한한다.

| 제안 API | 역할 | 부작용 |
|---|---|---|
| `POST /api/v1/backtest/visual/validate` | graph 검증, diagnostics 반환. invalid이면 가능한 경우 revision-bound diagnostic preview와 provisional map도 반환 | 없음; preview는 `executable=false`, `preview_only=true` |
| `POST /api/v1/backtest/visual/compile` | valid graph만 normalized spec, 실행 가능한 generated source, authoritative source map, hashes로 컴파일 | 없음; invalid graph는 컴파일 거부 |
| `POST /api/v1/backtest/visual/patch` | base version/hash를 받는 비활성 repair patch와 diff 생성 | 없음 |

저장은 새 endpoint를 늘리기보다 기존 version 생성 API의 body를 visual artifact bundle로 확장하는 편이 낫다. 단, 먼저 origin enum에 `visual`과 `code_only`를 추가해야 한다. API 층은 이 두 origin에서 클라이언트가 보낸 active 값을 신뢰하지 않고 `is_active=false`를 강제하며, 저장층도 `active=True` 요청을 fail-closed로 거부해야 한다. 저장 전후 `active_version_id`는 같아야 하고, 활성화는 별도 `/activate` endpoint와 사용자 승인으로만 수행한다.

visual apply 요청은 `base_version_id`·base hashes·검토한 patch hash가 담긴 receipt를 함께 보내야 한다. 서버는 bundle을 신뢰하지 않고 graph에서 spec/source/map을 다시 만들거나 hash를 재검증한 뒤 transaction으로 저장한다. 일반 versions API 호출 사실만으로 사람의 visual patch 승인을 추론하지 않는다.

## 구현 단계와 난이도

| 단계 | 범위 | 난이도 | 완료 기준 |
|---|---|---:|---|
| P0 — 계약과 compiler spike | `VisualStrategyGraph v1`, node registry, diagnostics, provisional/authoritative source map, origin/active 불변식, golden fixtures | 4/5 | invalid graph preview는 결정적·미실행이고, valid graph만 실행 artifact를 만들며, `visual`·`code_only` 저장은 항상 inactive이고 기존 `active_version_id`가 유지됨 |
| P1 — 시각 편집과 오류 점프 | 새 visual 탭, 팔레트/캔버스/검사기, typed connection, 오류 표시, `openCodeAt(node_id)`, 좁은 폭 drawer | 3/5 POC, 5/5 제품급 | valid이면 authoritative span, invalid이면 현재 revision의 preview span을 열고 둘을 구분함. preview 생성 실패 시 exact 코드 이동은 비활성이고 inspector는 유지됨 |
| P2 — 대화형 수리 | 한 질문 상태 머신, repair intent, 비활성 patch/diff, 사용자 apply receipt, 재검증 | 4/5 | 한 번에 질문 하나만 보이고 patch 생성만으로 상태가 바뀌지 않으며, 검토한 patch/base version receipt가 있어야 inactive visual version이 저장됨 |
| P3 — 원자 저장과 왕복 경계 | visual artifact bundle, optimistic concurrency, immutable version, code-only 분기, stale map 처리 | 4/5 | 성공 시 graph/spec/source/map hash가 한 inactive version으로 일치하고 active version은 불변이며, 실패·동시 수정 시 부분 저장이 없음 |
| P4 — 제품 강화와 도구 결정 | undo/redo, 대형 그래프, 자동 배치, 접근성, IME, 정량 성능 측정, renderer graduate gate | 5/5 | 대표 graph 규모와 참조 장비를 고정해 상호작용·서버 latency budget을 통과한 뒤에만 Rete.js + Lit 도입 여부 결정 |

P0/P1 UX spike는 기존 DOM/SVG와 설치된 `vis-network`로 시작한다. 이는 제품급 편집기 선정을 뜻하지 않는다. typed port, history, 자동 배치, 대형 그래프 요구가 실제로 확인되면 Rete.js + Lit을 UI 렌더러 후보로 비교한다. `rete-engine`으로 Athena 실행 엔진을 이중화하지 않는다. React Flow는 React island 또는 앱 표준화가 별도 결정된 경우에만 후보가 된다.

P4 성능 측정은 “느낌이 빠르다”가 아니라 동일한 fixture와 참조 장비에서 반복한다.

| fixture/지표 | 측정 방법 | 제안 release budget |
|---|---|---:|
| 소형 20 nodes / 30 edges | 일반 SMA·RSI 전략 편집 | 회귀 비교의 기본 fixture |
| 대표 50 nodes / 80 edges | pan·drag 중 frame time, node select→inspector paint | pan/drag frame time p95 ≤ 33 ms, select latency p95 ≤ 100 ms |
| stress 100 nodes / 160 edges | 캔버스 열기·자동 배치·메모리·long task 관찰 | 중단/저하 상태를 정직하게 표시; 200 ms 초과 main-thread long task를 기록 |
| 대표 50/80 graph validate | Electron→로컬 API→diagnostics 응답 | p95 ≤ 300 ms |
| 대표 50/80 graph compile | valid graph→spec/source/authoritative map | p95 ≤ 500 ms |
| 대표 50/80 atomic save | apply receipt 검증→transaction→재조회 receipt | p95 ≤ 800 ms |

위 수치는 아직 측정 결과가 아니라 P4의 **제안 초기 budget**이다. 참조 CPU·메모리·OS·Electron build, warm/cold 조건, 반복 횟수를 결과에 함께 기록하고 P0에서 확정한 실제 V1 node/edge 상한에 맞춰 release gate를 조정한다. 평균만 보고하지 않고 p50/p95, 실패율, 취소 가능 여부를 함께 남긴다.

## 테스트 계획

### 서버 단위·속성 테스트

- graph schema: 중복 ID, dangling edge, 잘못된 port/kind/param, cycle, 누락된 entry/exit 거부
- compiler parity: golden fixture 최소 10개에서 graph→`StrategySpec`과 기존 YAML→`StrategySpec` 정규화 결과 동일
- signal parity: 같은 OHLCV fixture와 파라미터에서 `entry`/`exit` Series 동일
- invalid preview determinism: 같은 graph revision/hash와 compiler version은 같은 diagnostic preview code와 provisional map을 만들며 항상 `executable=false`, `preview_only=true`
- preview failure: 안전한 preview를 만들 수 없으면 exact 코드 이동이 비활성화되고 노드·포트 inspector diagnostic은 유지됨
- authoritative source map: validate/compile을 통과한 모든 생성 가능 의미 노드가 현재 executable artifact의 유효한 AST/source span을 가짐
- diagnostic: 오류 code, node, port, JSON path, source span이 같은 원인을 가리킴
- patch validation: allowlist 밖 operation, stale base hash, 이미 삭제된 node 수정 거부
- atomicity: spec/code/map 생성 또는 DB 쓰기 중 실패를 주입해 부분 version이 남지 않음을 검증
- side-effect fence: validate/compile/patch/version-save 테스트에서 runner, backfill, activate, deployment가 호출되지 않음
- origin/activation matrix: 현재 `human|form|llm_draft` 회귀를 보존하면서 `visual|code_only`를 허용하고, 두 신규 origin에 `active=True`를 주면 API와 store가 거부하며 `active_version_id`가 불변
- apply receipt: base version/hash 또는 검토한 patch hash가 없거나 stale이면 visual version 저장을 거부
- code-only: 지원하지 않는 AST 변경을 graph-compatible로 오판하지 않고 `origin=code_only`, `is_active=false`로만 저장

예상 신규 테스트 파일은 `backend/tests/unit/test_backtest_visual_schema.py`, `test_backtest_visual_compile.py`, `test_backtest_source_map.py`, `test_backtest_visual_patch.py`다. REST 계약은 기존 `backend/tests/api/test_backtest_api_extended.py`에 통합한다.

### 프런트엔드·Electron 테스트

- `app/lib/backtest-visual-editor.test.js`: node/port/edge 오류, 선택, keyboard, drawer, focus return
- 기존 `app/lib/backtest-code-editor.test.js`: `openSpan`, scroll/focus, stale source-map receipt
- 기존 `app/lib/backtest-canvas.test.js`: visual↔code 전환, invalid/run-disabled, code-only 분기, 활성화/실행 비자동성
- 기존 `app/lib/main/backtest-bridge.test.js`: 신규 endpoint, apply/base-version receipt, inactive version artifact body 전달
- `app/probe-backtest-full.js`: 네 Paper 상태의 DOM·상태 스모크
- `app/probe-backtest-chat-scenario.js`: 한 질문→patch preview→사용자 적용 순서
- `app/probe-backtest-e2e.js`: 실백엔드에서 저장된 graph/spec/source/map hash와 새 version ID 확인

비개발자 사용성 시나리오도 별도 성공 기준으로 측정한다. Python을 직접 편집하지 않는 참가자가 대표 전략을 시각적으로 생성하고, 연결 오류를 한국어로 이해하고, 대화의 질문 하나에 답하고, patch diff를 검토·적용해 동기화된 **비활성** 버전을 저장할 수 있어야 한다. 완료 화면에서 이를 “백테스트 실행됨” 또는 “활성 전략”으로 오해하지 않는지도 확인한다.

접근성 검증에는 드래그 없는 전체 작업, 보이는 포커스, 스크린리더용 목록/폼, 한국어 오류 읽기 순서, 한글 IME 입력, overlay 닫기 후 포커스 복귀를 포함한다. 좁은 폭에서는 palette/inspector drawer가 캔버스를 가려도 현재 선택·오류·적용 상태를 잃지 않아야 한다.

## 주요 리스크와 방어선

| 리스크 | 영향 | 방어선 |
|---|---|---|
| graph와 `StrategySpec` 의미가 갈림 | 가장 심각. 보이는 전략과 실행 전략이 달라짐 | 서버 단일 compiler, normalized spec/signals golden parity, graph/spec hash receipt |
| source map이 수동 코드 수정 후 오래됨 | 잘못된 줄로 이동해 사용자가 다른 코드를 고침 | artifact hash 일치 검사, stale 상태, 추정 금지, 재컴파일 또는 code-only |
| invalid graph preview를 실행 코드로 오해 | 검증 실패 전략을 실행 가능하다고 믿음 | `executable=false`, `preview_only=true` receipt, preview 전용 배지, runner 입력 거부, valid compile 뒤 authoritative artifact만 저장 |
| 대화 patch가 최신 편집을 덮음 | 사용자의 직접 수정 손실 | base version/hash optimistic concurrency, 충돌 시 재질문·새 diff, 기존 버전 불변 |
| LLM이 임의 patch나 실행을 수행 | 금융 안전·재현성 훼손 | LLM은 repair intent만, 서버 allowlist 검증, 비활성 preview, 사람 적용, 실행 endpoint 분리 |
| 부분 저장 | graph/code/map 중 하나만 새 버전이 됨 | 단일 DB transaction과 실패 주입 테스트, 저장 후 재조회 hash 검증 |
| 일반 versions API의 active 기본 동작을 visual에 재사용 | patch 적용만으로 활성 전략이 바뀜 | 신규 origin allowlist, API/store 이중 inactive 강제, 저장 전후 `active_version_id` 불변 assertion, 별도 `/activate`만 허용 |
| 임의 Python을 그래프와 동기화됐다고 오표시 | 허위 신뢰 | 지원 subset 증명 실패 시 명시적 code-only 분기, 마지막 호환 graph는 읽기 전용 |
| 3열 편집기가 좁은 중앙 영역에서 붕괴 | 노드·오류·검사기 사용 불가 | palette/inspector drawer·overlay, 상태 유지, 목록/폼 대체 보기 |
| POC renderer가 제품급 요구를 감당하지 못함 | undo/redo·접근성·성능 부채 | P4 graduate gate 전까지 의존성 선결정 금지, 실제 사용성·성능 측정 후 Rete.js + Lit 비교 |

## 최종 성공 기준

다음 조건을 모두 만족해야 “시각 설계와 코드를 오가며 최종 퀀트 알고리즘을 작성한다”고 말할 수 있다.

1. graph가 허용 subset 안에서 기존 폼/YAML과 같은 normalized `StrategySpec`과 `entry`/`exit` signals를 만든다.
2. 서버 오류가 같은 diagnostic code로 노드, 포트/엣지, 검사기에 일관되게 표시된다. 안전한 provisional map이 있을 때만 diagnostic preview span에도 표시된다.
3. valid graph의 오류 노드 더블클릭·버튼·키보드는 current artifact hash를 확인한 뒤 authoritative span을 연다. invalid graph는 현재 revision에 결박된 `executable=false`, `preview_only=true` preview span만 열며, preview 실패 시 exact 코드 이동을 비활성화한다.
4. 대화는 한 번에 해결 결정 하나만 묻고, 답변 후에도 비활성 patch preview를 먼저 보여준다.
5. 사용자 `적용` 전에는 graph, 저장된 버전, 활성 버전, 데이터, 실행 상태가 바뀌지 않는다.
6. 적용 성공 시 graph/spec/executable generated source/authoritative source map/compiler version/hash가 하나의 새 `origin=visual`, `is_active=false` version에 원자 저장되고 기존 `active_version_id`는 바뀌지 않는다.
7. patch 적용이나 version 저장이 activate, backfill, run, deploy를 자동 호출하지 않는다.
8. 지원하지 않는 코드 수정은 graph-compatible로 위장하지 않고 `origin=code_only`, `is_active=false` 새 버전으로 명시적으로 분기하며 기존 active version을 유지한다.
9. 넓은 폭의 3열과 좁은 폭의 drawer/overlay 모두에서 선택·오류·포커스·한국어 입력이 유지된다.
10. 저장된 version ID와 snapshot으로 과거 백테스트가 어떤 graph/spec/code에서 나왔는지 재현·설명할 수 있다.
11. Python을 직접 편집하지 않는 사용자가 생성→오류 이해→질문 하나에 응답→patch 검토→동기화된 비활성 버전 저장을 완료하고, 그 상태를 실행 또는 활성화 완료로 오해하지 않는다.

이 기준에서 P0~P3은 기능 구현의 필수 범위이고, P4는 제품급 공개 전 필수 강화 단계다. Paper 네 상태는 구현 순서와 리뷰 대상을 명확히 하지만, 실제 성공 판정은 위 테스트와 저장된 version/hash 증거로 한다.
