# LLM API selection for the domestic Kiwoom catalog

This document explains how an LLM selects one operation from Athena's domestic
Kiwoom catalog without loading every API schema into its context. It is both a
developer guide and the implementation contract for the LLM-facing selector.

The selector does **not** replace the typed FastAPI routes. It is a narrow control
plane above them:

```text
user question
  -> search a compact catalog
  -> describe one candidate
  -> resolve and validate one immutable plan
  -> call that signed plan
```

The four model-controlled selector tools are:

| LLM tool | HTTP endpoint | OpenAPI `operationId` | Purpose |
| --- | --- | --- | --- |
| `athena_search` | `POST /api/v1/llm/tools/search` | `llm_search_operations` | Rank compact candidates for a natural-language question. |
| `athena_describe` | `POST /api/v1/llm/tools/describe` | `llm_describe_operation` | Load the exact argument and response contract for one candidate. |
| `athena_resolve` | `POST /api/v1/llm/tools/resolve` | `llm_resolve_operation` | Re-rank, validate arguments, and issue a short-lived signed plan. |
| `athena_call` | `POST /api/v1/llm/tools/call` | `llm_call_operation` | Execute only the operation and arguments bound into that plan. |

The implemented adapter bootstrap endpoint is
`GET /api/v1/llm/manifest` (`operationId=llm_get_manifest`). It reports the
catalog version, surface counts, workflow, and the four meta-tool schemas. It is
marked `x-athena-llm-exposed: false`, so it is not a fifth model-controlled tool.
An adapter should fetch this endpoint itself instead of feeding Athena's full
`/openapi.json` document to the model.

The four meta-tool operations carry `x-athena-llm-exposed: true` in OpenAPI.
Generated Kiwoom routes carry `x-athena-llm-exposed: false`. This annotation is
for discovery and prompt construction; the signed `resolve`/`call` allowlist is
the actual execution boundary.

The current generated OpenAPI contains 335 paths and 335 GET/POST operations:
323 generated Kiwoom base/detail operations plus 12 service operations. The
service-operation count can change as unrelated endpoints are added; the stable
LLM contract is exactly four exposed POST tools and one non-exposed bootstrap
GET endpoint.

> **Scope:** domestic Korea only. Official-repository-only U.S. operations never
> enter the selector catalog. OAuth controls are also deliberately hidden.

## Why 323 flat tools are the wrong interface

Athena has 323 Kiwoom operations after response splitting:

| Operation class | Count | Selector visibility | Generic `resolve` / `call` |
| --- | ---: | --- | --- |
| Typed query base operations | 171 | Normal | Yes |
| Query detail projections | 115 | Normal | Yes |
| Guarded order operations | 12 | Explicit `intent=order` discovery only | No |
| WebSocket operations | 23 | Explicit `intent=websocket` discovery only | No |
| OAuth controls | 2 | Hidden | No |
| **Total** | **323** |  | **286 callable** |

Registering all 323 operations as independent LLM tools causes three related
problems:

1. Every name, description, and JSON Schema remains in the model context even
   when only one quote field is needed.
2. A base response and its detail projections look like competing peers even
   though they belong to one TR family.
3. Selection errors become execution errors. A model can choose a similar TR,
   invent a path, omit a required field, or accidentally cross into an order,
   OAuth, or streaming control surface.

The selector addresses all three. Only four stable tool schemas are always
visible. The 323-operation registry stays server-side. Base and detail identities
remain hierarchical, and the server validates a choice before any upstream I/O.

## Primary-source findings

This section records evidence from the two requested reference repositories.
The following section separately identifies Athena-specific design decisions.

### KIS_MCP_Server at `595d5d1`

The pinned commit is
[`595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7`](https://github.com/migusdn/KIS_MCP_Server/tree/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7).
At that revision:

- Catalog mode exposes exactly `list-kis-api-specs`, `get-kis-api-spec`, and
  `call-kis-api`; the compact toolset is declared separately from the larger
  convenience toolset
  ([source](https://github.com/migusdn/KIS_MCP_Server/blob/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7/server.py#L34-L62)).
- `list-kis-api-specs` searches group, API type, category, name, path, and
  parameter metadata, then returns compact identity, path, method, TR-ID, and
  required-input information
  ([source](https://github.com/migusdn/KIS_MCP_Server/blob/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7/server.py#L1004-L1060)).
- `get-kis-api-spec` retrieves one full specification only after discovery
  ([source](https://github.com/migusdn/KIS_MCP_Server/blob/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7/server.py#L1063-L1068)).
- `call-kis-api` accepts the catalog identity and parameters, validates and
  prepares the request, selects a TR ID, enforces trading policy, and then
  performs the HTTP call
  ([source](https://github.com/migusdn/KIS_MCP_Server/blob/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7/server.py#L1071-L1109)).
- The repository documentation explicitly recommends search, specification
  lookup, then call when running the three-tool catalog mode
  ([source](https://github.com/migusdn/KIS_MCP_Server/blob/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7/README.md#L183-L197)).

The reusable finding is not a particular KIS group name. It is the separation of
compact discovery, on-demand contract loading, and a server-validated generic
caller.

### tossinvest-cli at `b4cdcd3`

The pinned commit is
[`b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5`](https://github.com/JungHoonGhae/tossinvest-cli/tree/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5).
At that revision:

- Its MCP package states that a one-tool-per-operation design permanently loads
  every schema, so it exposes `list_operations`, `describe_operation`, and
  `call_operation` above a shared registry
  ([source](https://github.com/JungHoonGhae/tossinvest-cli/blob/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5/internal/mcp/catalog.go#L1-L17)).
- MCP initialization instructions tell the model to search first, describe the
  selected operation second, and call last. They also explain backend
  credentials and order gating
  ([source](https://github.com/JungHoonGhae/tossinvest-cli/blob/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5/internal/mcp/server.go#L35-L42)).
- The tool list contains only those three schemas; discovery takes `query` and
  `limit`, description takes an operation ID, and call takes an operation ID and
  parameters
  ([source](https://github.com/JungHoonGhae/tossinvest-cli/blob/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5/internal/mcp/server.go#L202-L235)).
- Calls reject missing or unknown identities, while list results remain compact:
  ID, method, path, category, summary, write/backend flags, and required fields
  ([source](https://github.com/JungHoonGhae/tossinvest-cli/blob/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5/internal/mcp/server.go#L374-L439)).
- The README explains the practical result: the always-loaded context stays at
  three schemas as the operation registry grows
  ([source](https://github.com/JungHoonGhae/tossinvest-cli/blob/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5/README.md#L489-L508)).

The reusable finding is that the model remembers a stable procedure rather than
hundreds of API schemas. Selection remains model-controlled, but identity,
parameters, backend availability, and write safeguards remain server-controlled.

### Evidence versus Athena design

The reference projects establish the value of a compact catalog and delayed
schema loading. They do **not** define Athena's 208-base plus 115-detail hierarchy,
screen-oriented projection policy, deterministic Korean/English ranking, or
signed plan boundary. Those are Athena design decisions described below.

## Athena's four-meta-tool architecture

Athena adds `resolve` between description and execution:

```text
search -> describe -> resolve -> signed plan -> call
```

The extra step matters because a trading-data adapter must not trust a model to
copy a TR ID, detail group, arguments, or continuation token correctly. `resolve`
is the last mutable request. `call` accepts only the immutable signed result.

| Stage | Upstream I/O | Credentials required | May choose an operation | May change arguments |
| --- | --- | --- | --- | --- |
| `search` | No | No | Returns ranked candidates | No |
| `describe` | No | No | Describes one canonical identity | No |
| `resolve` | No | No | Server makes final selection | Yes, then validates and seals them |
| `call` | One query call | Query client must be ready | No | No |

Search, description, and resolution are local registry operations. They do not
consume Kiwoom's request allowance. Only `call` reaches the existing typed query
runtime.

## Canonical operation identities

The selector recognizes exactly two public identity forms:

```text
base:{tr_id}
detail:{tr_id}:{group_id}
```

Examples:

```text
base:ka10001
detail:ka10001:current_trading
detail:kt00018:holdings
```

An identity is an opaque, case-sensitive key. Natural-language search is
normalized, but identity lookup is not. This preserves distinct WebSocket IDs
such as `0G` and `0g` or `0U` and `0u`.

Each detail identity belongs to one base family:

```text
base:ka10001
  |- detail:ka10001:identity_and_capital
  |- detail:ka10001:valuation
  |- detail:ka10001:current_trading
  `- ...
```

The selector first selects a family and then chooses base versus detail. It does
not let sibling details create a false cross-TR ambiguity.

## `athena_search`

### Request

```json
{
  "query": "삼성전자 현재가와 등락률만",
  "intent": "auto",
  "limit": 5
}
```

Contract:

- `query`: 2 to 500 characters.
- `intent`: `auto`, `query`, `order`, or `websocket`; default `auto`.
- `limit`: 1 to 10; default 5.
- Unknown request properties are rejected.

`auto` and `query` search only the 286 query identities. `order` searches only
the 12 guarded order base operations. `websocket` searches only the 23 streaming
base operations. No intent reveals OAuth.

### Response shape

```json
{
  "catalog_version": "sha256:<catalog-hash>",
  "normalized_query": "삼성전자 현재가와 등락률만",
  "results": [
    {
      "operation_ref": "detail:ka10001:current_trading",
      "kind": "query",
      "domain": "stockinfo",
      "name": "주식기본정보요청",
      "group_title": "Current price and trading activity",
      "score": 2550,
      "confidence": "high",
      "contributions": [
        {
          "reason_code": "RESPONSE_FIELD_MATCH",
          "points": 500,
          "matched_terms": ["cur_prc", "flu_rt"],
          "scope": "response_alias"
        }
      ],
      "generic_callable": true,
      "discovery_only": false
    }
  ]
}
```

Scores in examples are illustrative; clients must not hard-code them. The stable
contract is the ordered result, contribution list, reason codes, and catalog
version.

### Deterministic normalization and ranking

Natural-language indexing uses:

1. Unicode NFKC normalization.
2. `casefold` for natural-language terms only.
3. Tokens that preserve ASCII letters, digits, `_`, and Korean text.
4. Two-character Korean bigrams in addition to whole tokens.
5. A small, versioned Korean/English finance synonym lexicon.
6. Exact case-sensitive identity, TR-ID, and group-ID checks before text
   normalization.

The same catalog version and request must produce the same ranking regardless of
registry insertion order or Python hash seed.

### Score contributions

| Match | Points | Reason code |
| --- | ---: | --- |
| Exact canonical operation identity | 10,000 | `EXACT_OPERATION_REF` |
| Exact case-sensitive TR ID | 5,000 | `EXACT_TR_ID` |
| Exact detail group ID | 4,000 | `EXACT_GROUP_ID` |
| Full operation or group-title phrase | 1,400 | `TITLE_PHRASE_MATCH` |
| Group-title token | 150 each, maximum 750 | `TITLE_TOKEN_MATCH` |
| Domain/category/subcategory token | 80 each, maximum 400 | `DOMAIN_MATCH` |
| Request-field alias or description token | 70 each per zone, maximum 350 per zone | `REQUEST_FIELD_MATCH` |
| Response-field alias or description token | 50 each per zone, maximum 500 per zone | `RESPONSE_FIELD_MATCH` |
| Synonym-only match | 75% of the underlying match | `SYNONYM_MATCH` |

Operation names and overviews occupy the same title zone as detail-group titles,
so their tokens use the title-token rule. `SINGLE_GROUP_PREFERRED` is a later
base/detail policy decision, not an extra lexical score.

Ties sort by score descending, generic-callable operations first, query family
first, then Unicode code-point order of `operation_ref`. Every nonzero scoring
component is returned so a caller can explain the ranking.

## `athena_describe`

### Request

```json
{
  "operation_ref": "detail:ka10001:valuation",
  "intent": "query"
}
```

Description is a case-sensitive lookup. It returns:

- catalog version and canonical identity;
- operation kind, domain, name, and optional detail-group metadata;
- required and optional argument schemas using wire aliases;
- projected response-field schemas;
- `facts` or `table` layout and optional UI page-size hint;
- whether generic resolution/call is allowed;
- the execution policy and policy reason codes.

The response deliberately omits the upstream URL and internal FastAPI path. An
LLM does not need either value and cannot use them to bypass the resolver.

Order and WebSocket descriptions require matching explicit discovery intent and
return `generic_callable=false`. OAuth identities and unknown identities both
look absent.

## `athena_resolve`

### Request

```json
{
  "question": "삼성전자 PER, PBR, ROE만 보여줘",
  "candidate_refs": [
    "detail:ka10001:valuation",
    "base:ka10001"
  ],
  "preferred_ref": "detail:ka10001:valuation",
  "arguments": {
    "stk_cd": "005930"
  },
  "response_mode": "compact",
  "continuation": {
    "cont_yn": "N",
    "next_key": null
  }
}
```

Contract:

- `question`: 2 to 2,000 characters.
- `candidate_refs`: zero to eight hints from `search`.
- `preferred_ref`: an optional preference, never an instruction.
- `arguments`: wire-alias arguments for the final typed request model.
- `response_mode`: `auto`, `compact`, or `full`.
- `continuation`: `cont_yn` (`N` or `Y`) and optional `next_key`.
- Unknown request properties are rejected.

The server re-ranks all eligible candidates. It does not accept client-provided
scores and does not blindly accept `preferred_ref`. After selecting an operation,
it validates `arguments` with the generated Pydantic request model. Missing
required arguments, unknown arguments, and invalid values fail before a plan is
issued.

### Resolved response

```json
{
  "status": "resolved",
  "catalog_version": "sha256:<catalog-hash>",
  "operation_ref": "detail:ka10001:valuation",
  "plan_token": "<opaque-signed-plan-token>",
  "expires_at": "2026-08-15T12:00:00Z",
  "selection_reasons": ["SINGLE_GROUP_PREFERRED"],
  "required_arguments_satisfied": true,
  "response_mode": "compact"
}
```

Clients must treat `plan_token` as opaque. They must not decode, edit, merge, or
reuse fields from it to construct another request.

### Ambiguity and no-match behavior

Resolution groups candidates by base TR family before comparing alternatives.
Exact operation identities and exact case-sensitive TR IDs bypass family
ambiguity checks. General natural language uses these thresholds:

- top family score below 240: `NO_CONFIDENT_MATCH`;
- top-to-second margin below 80, or top/second ratio below 1.15:
  `AMBIGUOUS_OPERATION`;
- a preferred identity outside the server's top three or at least 20% below the
  top score: `PREFERRED_REF_NOT_SUPPORTED_BY_QUERY`.

These failures issue no plan token. The error includes at most three candidates
with their scores and reason codes so the LLM can refine the question without
receiving the full catalog.

Missing arguments are not ambiguity. Once the semantic operation is clear, the
resolver returns `INVALID_ARGUMENTS` with the generated request-model validation
details. The LLM should ask for the missing value, then call `resolve` again.

Examples:

| Question | Result |
| --- | --- |
| “삼성전자 PER와 PBR” | Resolve the single `valuation` detail group. |
| “삼성전자 정보” | Ambiguous; ask whether the user wants current price, valuation, fundamentals, or the full response. |
| “내 계좌 평가손익” without required account-query options | The operation can be identified, but argument validation fails. Ask for the missing options. |
| “미국 애플 시세” | No eligible domestic operation; do not substitute a Korean-stock API. |

## Base versus detail selection

The selector does not treat a base operation and its detail projections as
unrelated peers. After choosing the TR family, it applies these rules in order:

1. If the question explicitly asks for `전체`, `전부`, `모든`, `원문`, `raw`,
   `full`, or `complete`, or `response_mode=full`, select the typed base operation
   and record `EXPLICIT_FULL_RESPONSE`.
2. If the response shape is `pure_list`, always select the base operation and
   record `PURE_LIST_BASE_REQUIRED`.
3. If the TR has no detail projections, select the base operation.
4. If exactly one detail group has a meaningful group score of at least 180,
   the second group is below 100, and their margin is at least 80, select that
   detail and record `SINGLE_GROUP_PREFERRED`.
5. If two or more groups score at least 180, or the top-two group margin is below
   80, select the base and record `MULTI_GROUP_BASE_REQUIRED`.
6. If detail confidence remains insufficient, select the typed base operation.

`raw` means the complete **typed base response**. The selector never routes to
Athena's untyped raw endpoint.

### Why pure lists stay at the base identity

A pure list repeats one row schema. Athena's UI can show the first 10 rows and
offer “more” without creating different semantic APIs. Splitting such a list by
columns would make rows incomplete and force the model to join fragments. The
`ui_page_size=10` value is a rendering hint, not proof that the transport
truncated the upstream list.

### Worked family examples

| User request | Selected identity | Reason |
| --- | --- | --- |
| “삼성전자 현재가와 등락률만” | `detail:ka10001:current_trading` | One semantic group is sufficient. |
| “Show Samsung Electronics valuation metrics.” | `detail:ka10001:valuation` | PER/EPS/ROE/PBR belong to one detail group. |
| “삼성전자 기본정보 전체 원문” | `base:ka10001` | Explicit full-response request. |
| “계좌 보유 종목만” | `detail:kt00018:holdings` | One table group; display 10 rows at a time in the UI. |
| “계좌 보유 종목과 전체 평가손익” | `base:kt00018` | Multiple sibling detail groups are required. |
| “관심종목 목록” | `base:ka10095` | The response is a pure list and is never split. |

## Signed plan and call boundary

`resolve` serializes a canonical plan and signs it with HMAC-SHA256. The token
binds at least:

- token format version, issue time, expiry, and nonce;
- current catalog version;
- canonical `operation_ref`;
- validated arguments;
- `cont_yn` and `next_key`;
- request- and response-schema hashes;
- a hash of the original question.

The plan contains no credential, bearer token, upstream base URL, or internal
route path. Integrity is protected; the token should still be handled as
sensitive application data and omitted from normal logs.

Plan lifetime defaults to 120 seconds and must never exceed 600 seconds. A
process-local signing key invalidates outstanding plans after restart. A
multi-worker or multi-host deployment must provide one stable secret through its
secret manager; it must never commit that secret to this repository.

On `call`, the server rechecks:

1. token syntax and HMAC using constant-time comparison;
2. expiry;
3. catalog version and both schema hashes;
4. canonical identity and query-only `generic_callable` policy;
5. the typed request model against the sealed arguments.

Any mismatch fails closed. `call` accepts no operation identity, path, group ID,
or arguments from the client, so the model cannot switch targets after
resolution.

## `athena_call`

### Request

```json
{
  "plan_token": "<opaque-signed-plan-token>"
}
```

### Response

```json
{
  "operation_ref": "detail:ka10001:valuation",
  "data": {
    "per": "12.50",
    "eps": "5400",
    "roe": "8.10",
    "pbr": "1.02",
    "ev": "...",
    "bps": "..."
  },
  "continuation": {
    "cont_yn": "N",
    "next_key": null,
    "next_plan_token": null
  }
}
```

The data example shows shape, not live market values.

When Kiwoom returns another page, `continuation.next_plan_token` seals the same
operation and arguments with the returned `next_key`. The LLM must use that new
token. It must not copy `next_key` into a fresh first-page resolve request.

## Discovery and execution safety

### Orders: explicit discovery only

The 12 order operations appear only under `intent=order`. Description can explain
their required fields and marks them `generic_callable=false` with the direct
guarded-order execution policy. `resolve` and `call` never execute orders.

Order execution must continue through Athena's existing direct order route and
all of its independent safeguards: server opt-in, local bearer authentication,
explicit confirmation, and idempotency key. The selector cannot weaken or
bypass them.

### WebSocket: explicit discovery only

The 23 WebSocket operations appear only under `intent=websocket`. Description
marks them `generic_callable=false` and points callers to the existing direct
WebSocket control/stream lifecycle. A request/response plan token is not a valid
substitute for a long-lived socket registration.

### OAuth: completely hidden

The two OAuth controls never appear in search or manifest operation lists.
Describe, resolve, and call treat their identities like unknown identities.
Credentials and token lifecycle remain service-owned.

### U.S.-only operations: structurally excluded

The selector catalog is built only from Athena's generated domestic allowlists
and response-projection registry. It does not ingest the official repository's
U.S.-only inventory. A U.S. request returns no confident domestic match; the
model must explain the unsupported scope rather than select a superficially
similar Korean operation.

## Error-handling contract

| Failure | Selector code | HTTP status | Required client action |
| --- | --- | ---: | --- |
| Unknown, hidden, or wrong-intent identity | `OPERATION_NOT_FOUND` | 404 | Search again with the correct explicit intent. Do not guess case or path. |
| No family reaches the confidence floor | `NO_CONFIDENT_MATCH` | 404 | Ask a focused clarification or state unsupported scope. |
| Two families remain too close | `AMBIGUOUS_OPERATION` | 409 | Present at most the returned candidates and ask which information is wanted. |
| Client preference conflicts with server ranking | `PREFERRED_REF_NOT_SUPPORTED_BY_QUERY` | 409 | Drop the preference and refine the question. |
| Order/WSS passed to generic execution | `OPERATION_NOT_GENERIC_CALLABLE` | 403 | Use the guarded direct surface; never retry through `call`. |
| Missing, unknown, or invalid request fields | `INVALID_ARGUMENTS` | 422 | Collect or correct arguments, then resolve again. |
| Malformed token or invalid signature | `INVALID_PLAN` | 400 | Resolve again; do not alter the token. |
| Plan expired | `EXPIRED_PLAN` | 410 | Resolve again with current intent and arguments. |
| Catalog/schema changed after resolution | `STALE_PLAN` | 409 | Search/describe/resolve against the current catalog. |

No error may silently fall back to the first search result or a large base
response. No failed resolution returns a plan token.

## Korean and English interaction examples

### Korean: compact stock valuation

```text
사용자: 삼성전자 PER, PBR, ROE만 보여줘.
LLM: athena_search(query="삼성전자 PER PBR ROE", intent="auto")
서버: detail:ka10001:valuation을 1위로 반환
LLM: athena_describe(operation_ref="detail:ka10001:valuation")
서버: 필수 인자 stk_cd와 valuation 응답 필드 반환
LLM: 종목 코드를 알고 있으면 athena_resolve(..., arguments={"stk_cd":"005930"})
서버: 서명된 plan_token 반환
LLM: athena_call(plan_token=...)
```

If the stock code is not available from trusted conversation state, the LLM asks
for the ticker/code before resolution. It does not invent one.

### Korean: ambiguous account request

```text
사용자: 내 계좌 좀 보여줘.
LLM: athena_search(query="계좌", intent="auto")
서버: 잔고, 예수금, 주문 내역 등 가까운 여러 family를 반환
LLM: athena_resolve(question="내 계좌 좀 보여줘", ...)
서버: AMBIGUOUS_OPERATION, 후보 최대 3개
LLM: “보유 종목, 평가손익, 예수금 중 무엇을 볼까요?”라고 질문
```

### English: explicit full response

```text
User: Return the complete typed stock-info response for 005930.
LLM: athena_search(query="complete typed stock info ka10001", intent="query")
LLM: athena_describe(operation_ref="base:ka10001", intent="query")
LLM: athena_resolve(
       question="Return the complete typed stock-info response for 005930",
       preferred_ref="base:ka10001",
       arguments={"stk_cd":"005930"},
       response_mode="full")
Server: base:ka10001 with EXPLICIT_FULL_RESPONSE
```

### English: unsupported market

```text
User: Show Apple's current Nasdaq quote.
LLM: athena_search(query="Apple Nasdaq current quote", intent="auto")
Server: no eligible domestic operation
LLM: Explain that this Athena service is domestic-only. Do not substitute a KRX ticker.
```

## MCP adapter instructions

An MCP adapter should expose exactly four model-controlled tools:

```text
athena_search
athena_describe
athena_resolve
athena_call
```

It must not register 323 Kiwoom operations or mirror every path from
`/openapi.json`. At initialization it may fetch `/api/v1/llm/manifest` to verify
the catalog version, counts, and four JSON Schemas.

Recommended MCP initialization instruction:

```text
Athena exposes domestic Kiwoom data through four catalog tools. Search first,
describe the best candidate, resolve with all required arguments, then call only
the returned plan token. Prefer one detail projection for a focused question;
use a base operation for explicit full responses, pure lists, or multiple detail
groups. Orders and WebSocket operations are discovery-only. OAuth and U.S.-only
operations are unavailable.
```

Adapter requirements:

1. Map each MCP tool to the corresponding HTTP endpoint without changing field
   names or applying its own ranking.
2. Preserve Athena's HTTP status, selector error code, details, and candidate
   order in MCP error results.
3. Never auto-call every search candidate. Search and describe are cheap; an
   upstream `call` is not.
4. Never transform `operation_ref`, particularly case-sensitive WebSocket IDs.
5. Treat plan tokens as opaque and avoid normal logs, telemetry labels, or model
   summaries that reproduce them.
6. Do not retry an expired or stale token. Run resolution again.
7. Do not route `OPERATION_NOT_GENERIC_CALLABLE` to another selector tool.
   Orders and streams require their existing direct safety surfaces.
8. Cache manifest/search/description only by `catalog_version`. Discard cached
   contracts when the version changes.

## Rate limit, concurrency, and continuation

Selector-local operations do not consume the upstream allowance. A successful
`athena_call` performs one typed Kiwoom query, even for a detail projection; the
projection is applied to that single response.

Operational rules:

- Do not spend calls to compare candidates. Compare `search` results and
  `describe` contracts locally.
- Independent query plans may run concurrently, but Athena's shared limiter
  remains authoritative. The service is designed around at most five concurrent
  distinct query calls and Kiwoom's five-calls-per-second constraint.
- Preserve question order when presenting multiple results even if calls finish
  out of order.
- Do not automatically retry orders; the selector cannot execute them anyway.
- Continue a paged query only with `next_plan_token` returned by the previous
  call. This binds the page cursor to the same operation and arguments.
- `ui_page_size=10` is a display recommendation for table projections. It is not
  an upstream rate-limit unit and does not by itself indicate truncation.

The latency objective is one upstream request for one focused user question.
Search, description, and resolution add local CPU work but avoid speculative
network fan-out and oversized base responses.

## Evaluation plan and metrics

The selector requires a bilingual, domestic-only gold set. Each case should
record the question, intent, required arguments, expected TR family, expected
base/detail identity or expected error, and relevant reason codes.

### Dataset coverage

- representative questions for every query family;
- paired focused versus full-response questions for all 22 split TRs;
- all 115 detail groups, including the 10 table groups;
- pure-list cases such as `ka10095`;
- Korean/English synonyms, field aliases, exact TR IDs, and canonical identities;
- ambiguous questions and missing-argument questions;
- all 12 order and 23 WebSocket identities under both correct and incorrect
  intents;
- OAuth and all official U.S.-only identifiers as negative cases;
- mixed-case WebSocket identities;
- continuation, expired-token, tampered-token, and stale-catalog cases.

### Metrics

| Metric | Definition | Release expectation |
| --- | --- | --- |
| Family top-1 accuracy | Correct base TR family ranks first. | Measured on the full gold set; regressions block release. |
| Exact operation accuracy | Correct base/detail identity after family selection. | Report separately from family accuracy. |
| Detail precision | Focused questions resolved to a sufficient single detail group. | No group may omit a required answer field. |
| Base over-fetch rate | Focused questions unnecessarily resolved to a base response. | Track downward; never trade correctness for size. |
| Full-response recall | Explicit full/multi-group questions resolved to base. | 100% for explicit-full fixtures. |
| Pure-list compliance | Pure-list questions remain at base. | 100%. |
| Ambiguity precision | Ambiguous gold cases produce no plan. | 100% for safety fixtures. |
| Argument validation recall | Missing/unknown/invalid fields fail before a plan. | 100%. |
| Policy isolation | Order/WSS never generic-call; OAuth/U.S. never leak. | 100%. |
| Determinism | Same input/catalog produces byte-equivalent ordered candidates. | 100% across randomized registry order and hash seeds. |
| Context footprint | Always-loaded schemas seen by the LLM. | Four meta-tools, independent of catalog size. |
| Upstream efficiency | Kiwoom calls per successful focused question. | One unless the user explicitly requests multiple independent data sets/pages. |

Accuracy must be reported at both family and exact-operation levels. A selector
that finds `ka10001` but chooses its full base for every focused question has high
family accuracy and poor projection quality.

### Current progress

The catalog, four-tool transport contract, signed-plan boundary, and safety
fixtures are implemented. The selector evaluation is not release-green yet:
several focused detail questions still resolve to a base operation or reject the
requested detail as an unsupported preference; a vague account-information
question can resolve instead of requesting clarification; and duplicated titles
within several TR families still cause Korean and English top-1 collisions. Keep
these failures as regression blockers until ranking and base/detail policy fixes
make the full evaluation suite pass without weakening the natural-language gold
questions.

### Regression invariants

The test suite should fail if any of these change without an intentional contract
update:

- 323 canonical operation documents: 171 query bases, 115 details, 12 orders,
  23 WebSocket operations, and 2 hidden OAuth controls;
- exactly 286 generic-callable query identities;
- exactly 35 explicit discovery-only identities;
- no U.S.-only identity in search, describe, resolve, call, or manifest;
- no plan for ambiguity, invalid arguments, order, WebSocket, or OAuth;
- base/detail selection rules and published score thresholds;
- catalog version changes whenever identities, searchable metadata, lexicon, or
  request/response schemas change;
- every successful detail call performs one base TR call and returns only its
  declared response fields;
- continuation can advance only through a server-issued next plan.

## Developer maintenance checklist

When the generated Kiwoom inventory or response projections change:

1. Regenerate the typed registry, detail registry, OpenAPI, I/O reference, and
   selector catalog from the same checked-in sources.
2. Verify the selector counts and domestic-only allowlist.
3. Review new names, field descriptions, and semantic group titles for search
   quality; update the versioned lexicon only through review.
4. Add or update Korean and English gold questions.
5. Run generator determinism, selector unit tests, API integration tests, and
   the tampered/expired/stale-plan security suite.
6. Inspect `/api/v1/llm/manifest`; confirm only four meta-tool schemas are marked
   LLM-facing.
7. Re-run the complete backend suite before committing generated artifacts.

Do not hand-maintain a second list of 323 operations inside an MCP adapter or
prompt. The generated registry is the authority; the catalog version tells every
consumer when that authority changed.
