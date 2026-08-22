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

### Current routing authority (2026-08-21)

Execution authority is the typed, allowlisted operation contract and its exact
`operation_ref`. `QueryFrame`, evidence atoms, compatibility proofs, lexical title
matches, aliases, synonym expansion, and numeric score thresholds are diagnostic or
advisory signals; none authorizes an operation by itself. Instrument names, stock codes,
account aliases, prices, and quantities are values bound through typed arguments, not
operation identities. Hidden or unsupported identities remain indistinguishable from
unknown identities.

The production quote fast path is deliberately narrow: it handles a current domestic
equity quote only when the routing contract identifies an equity quote snapshot and a
required instrument binding is available. It does not reinterpret foreign-market,
chart/history, sector, or arbitrary-text questions as quotes. The Electron app normally consumes
the signed plan and manifest-derived card metadata. Its only direct-selection exception is a
closed standalone domestic-equity quote grammar, which selects the exact case-sensitive
`detail:ka10001:current_trading` identity; every other operation goes through the backend
selector/plan path.
AITS DTOs describe render payloads, not selector identity or market-data authority.

Evaluation strata are reported independently. The figures below are last-known, artifact-bound
measurements captured before the current quote-source/hash rerun; they are not unconditional
current accuracy claims. A result is valid only together with the evaluator artifact and source
hash that produced it. Upcoming seam/evaluator source changes invalidate the corresponding hash.

| Stratum | Result |
| --- | --- |
| Public production | 72/72; raw 63/63, quote 9/9, exact 16/16, shadow 39/41, advisory 4 |
| Expansion | 45/45; exact 33/33, shadow 19/19, advisory 9 |
| v2 | 60/60; exact 43/43, shadow 10/12, advisory 18 |
| v3 | 74/74; exact 50/50, shadow 11/11, advisory 15 |
| v4 | 73/73; exact 51/51, shadow 15/15, advisory 12 |

Safety violations are zero in every stratum. These rows are not additive accuracy claims.
The current Electron `npm test` result is 321 passing tests; direct MCP chart checks use
the AITS DTO contract and are separate from selector routing accuracy.

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

The current generated OpenAPI contains 315 paths and 315 GET/POST operations:
301 generated Kiwoom routes (149 unsplit query bases, 115 detail projections,
23 websocket controls, 12 orders, and 2 OAuth) plus 14 service operations. The
22 split query bases are documented and searchable but are not registered as
routes — their projections replaced them, so there is nothing left to route to.
The service-operation count can change as unrelated endpoints are added; the
stable LLM contract is exactly four exposed POST tools and one non-exposed
bootstrap GET endpoint.

> **Scope:** domestic Korea only. Official-repository-only U.S. operations never
> enter the selector catalog. OAuth controls are also deliberately hidden.

## Why 323 flat tools are the wrong interface

Athena has 323 Kiwoom operations after response splitting:

| Operation class | Count | Selector visibility | Generic `resolve` / `call` |
| --- | ---: | --- | --- |
| Unsplit query base operations | 149 | Normal | Yes |
| Split query base operations | 22 | Normal | Base plan no; uniquely supported owned detail or explicit `detail_group` required |
| Query detail projections | 115 | Normal | Yes |
| Guarded order operations | 12 | Explicit `intent=order` | Yes, with the order guards |
| WebSocket operations | 23 | Explicit `intent=websocket` | Yes, control frame only |
| OAuth controls | 2 | Hidden | No |
| **Total** | **323** |  | **299 callable** |

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
| `call` | One typed request: a query, a guarded order, or a websocket registration frame | The matching client (query/order/websocket) must be ready for the plan's kind | No | No |

Search, description, and resolution are local registry operations. They do not
consume Kiwoom's request allowance. Only `call` reaches the existing typed
runtimes: `call_typed_tr` for a query, `call_order_tr` for a guarded order —
the same function the direct order route calls — and `call_websocket_tr` for a
subscription control frame.

### Typed routing metadata and QueryFrame

Every one of the 208 base operations and 115 detail projections carries an
immutable `OperationRouting` contract. Its closed enum axes are subject, entity
kind, execution kind, data intent, temporal scope, measure, result shape, and
binding role. There is no `other` bucket: an unmapped taxonomy value or incomplete
coverage fails generation instead of silently weakening eligibility.

The generator builds those 323 contracts in a fixed order:

1. derive each base from canonical inventory category, subcategory, operation
   name, field aliases, and generated output shape;
2. refine a detail from its projection title, declared fields, and layout while
   inheriting the base identity, execution kind, and binding roles;
3. replace each split base's semantic axes with the ordered union of its detail
   children;
4. apply only exact-reference overrides from
   `ref/selector-routing.json`. Overrides cannot change subject, entity kind,
   execution kind, or result shape.

Raw overview prose, field descriptions, examples, and sample values are not
derivation inputs. The routing source version, routing contract version,
QueryFrame version, and every canonical routing value are sealed into the
catalog hash.

`QueryFrame` is the question-side counterpart. It performs one-way, authored
phrase-to-enum extraction only. It does not run synonym expansion, generate
bigrams, or retain argument values such as account numbers, instrument codes,
prices, or quantities. Unsupported or unobserved axes remain empty rather than
being guessed. Search first applies visibility, then rejects direct contradictions
on subject, entity, data intent, temporal scope, and result shape. Measures and
binding roles are soft corroboration only: they are explained but cannot raise a
candidate into a stronger eligibility tier. Empty facets and generic/unspecified
operation facets remain neutral. Exact visible operation/TR identities retain
their identity behavior after the visibility and safety gates.

An opaque instrument span contributes only value-free entity evidence and is
masked before both QueryFrame extraction and lexical ranking. Control words and
reviewed asset-class markers remain visible. A comparison across multiple
independent instruments is not collapsed into a single-instrument operation:
when no request schema accepts all identities, resolve rejects the request so the
caller can issue independently validated calls and compose their results.

Routing v2 keeps distinctions that were previously lost inside broad axes:
tick and minute charts have separate temporal scopes; chart requests carry a
chart intent in addition to history; price history, price range, and market
scale are explicit intents; ranking combines its direct measure and mode
specializations; and existing-order amend/cancel actions are distinct. These
values are derived from canonical operation/group names and direct question
phrases. They do not contain company names, instrument codes, or operation-ID
exceptions. When otherwise tied families expose a strict capability subset,
the subset is the canonical generic family unless the question directly names
the broader specialization.

Only typed-eligible candidates enter lexical ranking. Raw request/response field
descriptions and legacy `family_projection` titles remain available to `describe`
but are completely absent from ranking. A base family instead exposes a bounded
`family_capability` surface made only from canonical detail titles; generic
subject/entity tokens do not score there, and detail siblings never become global
candidates. `preferred_ref` only asserts the independently selected canonical
family; an owned `detail_group` is then validated inside that family, never against
global detail competition. The public Search/Describe/Resolve/Call field shape and signed
plan payload remain version 1; typed reason codes are additive.

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

`auto` and `query` search only the 171 query families. For the 22 split families,
`resolve` evaluates only owned details and either selects one uniquely supported by
typed compatibility plus authoritative canonical evidence or answers
`DETAIL_GROUP_REQUIRED` with the group list. `order` searches only
the 12 guarded order base operations. `websocket` searches only the 23 streaming
base operations. No intent reveals OAuth.

### Response shape

```json
{
  "catalog_version": "sha256:<catalog-hash>",
  "normalized_query": "삼성전자 현재가와 등락률만",
  "results": [
    {
      "operation_ref": "base:ka10001",
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
      "discovery_only": false,
      "suggested_detail_group": "current_trading",
      "suggested_operation_ref": "detail:ka10001:current_trading"
    }
  ]
}
```

Scores in examples are illustrative; clients must not hard-code them. The stable
contract is the ordered result, contribution list, reason codes, and catalog
version. Ranking is display-only and never authorizes a plan. `confidence` is
derived from the shared typed compatibility decision: `high` means one exact
profile matched directly, `medium` means typed dominance or a reviewed
equivalence collapse produced the unique profile, and `low` means the decision
abstained or the hit is not the selected canonical result. It is explanatory
metadata, not plan authority; only `resolve` can revalidate the request and issue
a signed plan.
Only the top canonical family hit may carry the two additive suggestion
fields. They are absent when family/detail selection is ambiguous, the question
asks for a full response, or no uniquely supported family-local detail exists.
`resolve` always recomputes and validates the suggestion on the full intent surface.

### Deterministic normalization and ranking

Natural-language indexing uses:

1. Unicode NFKC normalization.
2. `casefold` for natural-language terms only.
3. Tokens that preserve ASCII letters, digits, `_`, and Korean text.
4. Two-character Korean bigrams in addition to whole tokens. A bigram scores at
   half the weight of the whole token it stands in for, and is reported under
   the matched zone's own reason code rather than a separate one — it is the
   same evidence, only weaker, because it reaches inside a compound rather than
   naming it. A bigram is also a fragment of a *different* word: `실시간`
   (from `실시간항목`) tokenizes to the bigram `시간`, which matches
   `주식시간외호가` as directly as `호가` does. Full weight there would tie an
   unrelated after-hours-quote operation with the operation the question named.
5. A small, versioned Korean/English finance synonym lexicon
   (`LEXICON_VERSION = "ko-en-finance-v7"`). Single authored tokens expand one
   hop; a multiword alias expands only when its complete normalized token sequence
   occurs. Entity tokens such as `ELW` or `ETF` therefore cannot manufacture
   capability terms from `ELW indicator` or `ETF NAV`, and emitted synonyms never
   activate another concept transitively. Reviewed Korean compound fragments remain
   a separate half-weight lexical signal.
6. A value-free transient entity-span pass masks six-digit codes and opaque proper
   names before typed/lexical matching. Reviewed asset-class prefixes come from the
   versioned, schema-validated `ref/selector-entity-markers.json`; its version and
   SHA-256 are included in the catalog hash. This is not a full instrument master
   and cannot establish `TargetPresence.PRESENT` or plan authority.
7. Exact case-sensitive identity, TR-ID, and group-ID checks before text
   normalization.
8. Per-surface uninformative-token suppression (below) over the ranked
   candidate set, before zone scoring.

The same catalog version and request must produce the same ranking regardless of
registry insertion order or Python hash seed.

### Score contributions

| Match | Points | Reason code |
| --- | ---: | --- |
| Exact canonical operation identity | 10,000 | `EXACT_OPERATION_REF` |
| Exact case-sensitive TR ID | 5,000 | `EXACT_TR_ID` |
| Exact detail group ID | 4,000 | `EXACT_GROUP_ID` |
| TR ID cited inside a longer question | 3,000 | `TR_ID_TOKEN_MATCH` |
| Operation title phrase (two or more tokens) | 1,400 | `TITLE_PHRASE_MATCH` |
| Operation title token | 150 each, maximum 750 | `TITLE_TOKEN_MATCH` |
| Absorbed projection-title token | 150 each, maximum 750 | `PROJECTION_TITLE_MATCH` |
| Fraction of distinct question tokens matched | up to 600 | `QUERY_COVERAGE` |
| Operation overview-note token | 60 each, maximum 300, corroboration-capped | `OVERVIEW_MATCH` |
| Realtime FID-name token | 90 each, maximum 600, corroboration-capped | `REALTIME_FIELD_MATCH` |
| Domain/category/subcategory token | 80 each, maximum 400, corroboration-capped | `DOMAIN_MATCH` |
| Request-field alias or description token | 70 each per zone, maximum 350 per zone, corroboration-capped | `REQUEST_FIELD_MATCH` |
| Response-field alias or description token | 50 each per zone, maximum 500 per zone, corroboration-capped | `RESPONSE_FIELD_MATCH` |
| Synonym-only match | 75% of the underlying match | `SYNONYM_MATCH` |

Several rules deserve their reasons stated, because each exists to stop a
reproducible misranking:

- **`TR_ID_TOKEN_MATCH`** — `EXACT_TR_ID` only fires when the whole query *is*
  the id. A question that merely cites one (`ka10001 가치평가 지표만`) was losing
  to lexical noise. Matching is case-sensitive on identity boundaries, so `0G`
  and `0g` stay distinct and `ka100010` never matches `ka10001`.
- **`PROJECTION_TITLE_MATCH`** — a base document stands for its whole family, so
  it absorbs its projections' titles; without this, English questions could not
  reach Korean-named TRs at all. The zone is separate from `title` and carries no
  phrase bonus: slice titles such as `계좌 정보` / `Account information` are
  boilerplate that unrelated families reuse, and a 1,400 point phrase bonus there
  decided family selection on a naming coincidence.
- **`TITLE_PHRASE_MATCH` needs two or more tokens** — a one-word title such as
  `totals` appears inside unrelated questions, and the phrase bonus let it
  outrank the correct family. Single-token titles still earn token matches.
- **`title` holds only the operation's name; `OVERVIEW_MATCH` is its own,
  lower-weighted zone.** `title` used to be `(name, overview)` together. A TR's
  overview is prose about how to use it, and for the 23 websocket types that
  prose is about the *subscription mechanism* — near-identical boilerplate
  across all 23. Scored at title weight, it ranked realtime candidates by how
  verbose their registration note happened to be: "실시간 체결" put `04 잔고`
  and `0A 주식기세` above `0B 주식체결`, whose note is one line.
- **`REALTIME_FIELD_MATCH`** indexes the FID names a websocket type actually
  emits (`_realtime_field_terms`, `catalog.py`). It is the only content-bearing
  vocabulary a realtime type owns: its request/response envelope is the same
  four fields on all 23 types, so `request_alias`/`response_alias` carry no
  signal on this surface and only the FIDs inside `data[*]` can rank one
  realtime type against another.
- **Uninformative-zone-token suppression** (`uninformative_zone_tokens`,
  `ranking.py`) drops a `(zone, token)` pair that at least 90% of the ranked
  candidate set shares, computed fresh per search over that candidate set —
  because what a token can discriminate depends on what it is discriminating
  between. On the websocket surface every type repeats 실시간 in its domain,
  its overview, and both envelope field descriptions; scored, it hands all 23
  candidates the same ~600 points and the same coverage credit, so the words a
  question actually contributed — 호가, 예상체결, NAV — decide nothing. The
  judgement is per zone, not per document: every realtime type carries a
  체결시간 FID, so 체결 says nothing in `realtime_field`, but only three types
  are *named* 체결, so in `title` it is nearly the whole answer. A token is
  never suppressed in every zone at once — "주문 체결" is ubiquitous across the
  entire realtime surface, and suppressing it everywhere returned an empty
  result for that question — so each token keeps its single highest-weighted
  zone even past the 90% threshold.
- **Corroboration cap (750 points).** What an operation is *called* is the
  claim; `overview`, `domain`, the request/response field zones, and
  `realtime_field` are corroboration, and their combined contribution is capped
  at 750 — the same ceiling a title match has — by scaling every corroboration
  contribution down proportionally, not truncating it, so the response still
  shows which zones supported the match and in what proportion. Uncapped,
  corroboration outvoted the claim: `ka10171 조건검색 목록조회` alone matches
  `목록` in its title, yet lost to `ka10173`, because `ka10171` takes no
  request arguments and so could not collect the points its sibling earned by
  restating the family's vocabulary across four field-description zones. An
  operation must not out-rank a correctly-named sibling for being verbose.

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

Order and WebSocket descriptions require matching explicit discovery intent, and
both are `generic_callable=true`: `resolve` and `call` execute them directly (see
[Discovery and execution safety](#discovery-and-execution-safety)). OAuth
identities and unknown identities both look absent.

### `response_fields` on a websocket operation is the realtime FID contract, not the envelope

All 23 websocket operations share one four-field acknowledgement envelope —
`return_code`, `return_msg`, `trnm`, `data` — because that is what `call` returns
for a REG/REMOVE control frame. Describing the envelope would tell a screen
builder nothing about what the subscription actually delivers: the renderable
fields, keyed by FID (`"10"` 현재가, `"20"` 체결시간, and so on), live one level
down in `data[*]`. So `describe` substitutes the per-event model for
`response_fields` whenever one is present, and falls back to the envelope only
if a generator regression drops the `data` list — a generator defect, not a
caller error that should look like an absent operation. This is the model a
screen is actually built from: describe `base:0B` and the FIDs returned are the
same fields a `WS /api/v1/ws/stream` event carries once `call` has registered it.

## `athena_resolve`

### Request

```json
{
  "question": "삼성전자 PER, PBR, ROE만 보여줘",
  "intent": "query",
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
- `intent`: `auto`, `query`, `order`, or `websocket`; default `auto`. The same
  gate `athena_search` applies, restated here because `resolve` ranks the
  question a second time rather than trusting the caller's earlier search. It
  is not the query surface by default plus an override; `auto` and `query` rank
  `visible_for(query)` only, so a vague question cannot land on an order or a
  subscription no matter how it scores. Exact operation refs/TR IDs,
  `candidate_refs`, and `preferred_ref` are filtered against this same intent — a
  caller cannot smuggle an order or websocket ref past a `query` intent by naming
  it in the question or either hint field.
  A caller that searched under `intent=websocket` passes `intent=websocket` here
  too; passing `query` instead makes every websocket candidate disappear from
  ranking and from the `candidate_refs`/`preferred_ref` checks.
- `candidate_refs`: zero to eight validated soft hints from `search`. They never
  restrict, reorder, or replace the canonical intent surface, so omission, order,
  and duplication cannot change selection. Unknown, hidden, or wrong-intent refs
  fail closed. A non-callable split base is allowed as a family hint, but can never
  produce a base plan.
- `preferred_ref`: an optional canonical family assertion, not a preference or
  override. The independently selected family must match or resolution fails with
  409. Naming a projection also implies its group; an explicit conflicting
  `detail_group` fails with 409. A matching detail assertion may determine only that
  owned family-local projection; it can never alter or escape the canonical family.
- `detail_group`: an optional projection of the selected family, taken from
  `athena_describe.detail_groups` or the top search suggestion. It cannot bypass
  canonical family authority; omission permits only a uniquely typed local detail.
- `arguments`: wire-alias arguments for the final typed request model.
- `response_mode`: `auto`, `compact`, or `full`.
- `continuation`: `cont_yn` (`N` or `Y`) and optional `next_key`.
- Unknown request properties are rejected.

The server re-ranks the complete intent surface regardless of `candidate_refs`.
Search and resolve therefore share the same family/detail decision. It does not
accept client-provided scores or let `preferred_ref` alter that decision. After
selecting an operation, it validates `arguments` with the generated Pydantic request model. Missing
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
  "selection_reasons": ["EXPLICIT_DETAIL_GROUP"],
  "required_arguments_satisfied": true,
  "response_mode": "compact"
}
```

Clients must treat `plan_token` as opaque. They must not decode, edit, merge, or
reuse fields from it to construct another request. It is also single-use: `call`
accepts it exactly once, including on a failed attempt (see
[Single-use enforcement](#single-use-enforcement)).

### Ambiguity and no-match behavior

Resolution proves candidates against exact routing profiles and groups compatible
profiles by base TR family before comparing alternatives.
Exact operation identities and exact case-sensitive TR IDs bypass family
ambiguity checks only after they pass the requested intent's visibility surface.
An exact order, WebSocket, or query identity under the wrong intent is
`OPERATION_NOT_FOUND` and cannot issue a plan. General natural language has no
score threshold, score margin, title tie-break, company boost, or lexical fallback.
Every explicit query axis must be compatible with an exact profile. Family
authority is established first; query-evidenced active-axis Pareto dominance may
remove broader profiles, and only reviewed routing-equivalence groups may collapse
otherwise equal profiles. More than one surviving family is
`AMBIGUOUS_OPERATION`; no surviving profile is `NO_CONFIDENT_MATCH`. A preferred
identity whose family differs from this independent decision is
`PREFERRED_REF_NOT_SUPPORTED_BY_QUERY` (HTTP 409).

These failures issue no plan token. The error includes at most three candidates
with their scores and reason codes so the LLM can refine the question without
receiving the full catalog.

A natural-language question also abstains before argument validation when it
provides no target scope, or an instrument-bound profile requires an authoritative
target anchor and the question has only an unresolved name. This prevents a generic
request such as a bare price question or an arbitrary noun plus market syntax from
turning into a stock plan. Authoritative anchors are an exact six-digit code, a
validated deictic binding, a reviewed concrete gold contract, or the trusted
application resolver boundary backed by the stock master. Caller-supplied argument
roles and asset-class markers alone do not establish target identity.

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

**The server selects a TR family, then evaluates projections only inside it.**

A detail projection is not a cheaper call. `call_typed_tr` issues the same single
upstream request the base operation issues, then filters the response by the
projection's field aliases. Base is therefore always a correct and complete
answer; a projection only narrows it — by 5.5x on average across the 22 split
TRs, and by 9x for the widest (`ka10007`: 124 fields to 13.8).

Sibling projections are never allowed into global family competition.
`detail:ka10004:buy_bid_prices`
and `detail:ka10004:buy_bid_quantities` differ by one token inside titles that
are otherwise identical. After choosing the family, the selector evaluates only
`catalog.details_for(tr_id)` and auto-selects a child only when typed compatibility
and authoritative family-local canonical-title evidence identify one unique local
winner. Otherwise it asks for an explicit group. The rules
are applied in this order:

1. If the question explicitly asks for `전체`, `전부`, `모든`, `원문`, `raw`,
   `full`, or `complete`, or `response_mode=full`, select the typed base operation
   and record `EXPLICIT_FULL_RESPONSE`. An explicit full-response request outranks
   `detail_group`: the caller asked for everything, so narrowing would drop fields
   they named.
2. If `resolve` supplied `detail_group`, select `detail:{tr_id}:{detail_group}`
   and record `EXPLICIT_DETAIL_GROUP`. A group that does not belong to the
   selected family fails with `UNKNOWN_DETAIL_GROUP` and the family's real group
   list; it never silently falls back to base.
3. If the response shape is `pure_list`, select the base operation and record
   `PURE_LIST_BASE_REQUIRED`.
4. For a split family, auto-select a uniquely supported family-local detail and
   record `TYPED_DETAIL_MATCH`; otherwise return `DETAIL_GROUP_REQUIRED` with the
   valid groups.
5. Otherwise select the typed base operation and record `BASE_DEFAULT`.

`raw` means the complete **typed base response**. The selector never routes to
Athena's untyped raw endpoint.

### How the model learns which groups exist

`athena_describe` on a base query operation returns `detail_groups`: every
projection of that family with its `group_id`, canonical `operation_ref`,
Korean and English titles, `layout`, `ui_page_size`, and `response_field_count`.
That listing is the authoritative inventory for `detail_group`; a top search
suggestion may carry one owned canonical group from the same inventory. The policy
may also select that group automatically only when typed plus canonical family-local
evidence makes it unique. Otherwise the caller must use the inventory explicitly.

```text
athena_search("매수 10단계 호가 가격")      -> base:ka10004
athena_describe("base:ka10004")           -> detail_groups: 9 entries
athena_resolve(..., detail_group="buy_bid_prices")
athena_call(plan_token)                   -> 7 fields, one upstream call
```

Omitting `detail_group` is safe: it either selects a uniquely supported local
detail, returns an unsplit typed base, or fails with `DETAIL_GROUP_REQUIRED`.

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
4. canonical identity and `generic_callable` policy — true for a query, a
   guarded order, or a websocket control frame; false only for a hidden OAuth
   identity or a stale plan pointing at a since-removed document;
5. the typed request model against the sealed arguments.

Any mismatch fails closed. `call` accepts no operation identity, path, group ID,
or arguments from the client, so the model cannot switch targets after
resolution.

### Single-use enforcement

**Decision (2026-08-18):** a `plan_token` may be spent by `call` exactly once.
Two calls to `athena_call` with the same `plan_token` - sequential or
concurrent - resolve the first and reject the second with `PLAN_ALREADY_USED`
(HTTP 409). The rationale is cost: nothing legitimate calls the same resolved
operation twice inside the answer to one question, and every call this
selector dispatches spends Kiwoom's shared upstream allowance for no new
information the first call didn't already return. Asking the same question
again in a new turn is not blocked - it goes through `resolve` again, gets a
new signed plan with a new nonce, and calls cleanly.

The server marks the plan's nonce spent immediately after signature
verification succeeds and **before** any upstream dispatch, not after a
successful response. This means a token is consumed even when the call then
fails upstream - timeout, rate limit, connection reset. That trade is
accepted deliberately: letting an ambiguous failure re-arm the same token
would reopen the exact double-spend this policy exists to close. Recovery
from that failure is the same as recovery from `EXPIRED_PLAN` or
`STALE_PLAN` - call `athena_resolve` again for a fresh `plan_token` - never a
retry of the same one. This applies uniformly to query, order, and websocket
plans; an order plan already carries its own `Idempotency-Key` contract, and
this enforcement sits in front of it rather than replacing it.

Nonces are tracked in a process-local, size-capped cache keyed by the plan's
nonce (`SelectorService._consumed_nonces`). An entry is evicted once its own
`exp` has passed - a token past its expiry is already rejected by signature
verification before this cache is ever consulted, so pruning it here opens no
replay window. If the cache is full and every entry is still live, the server
does **not** evict an unexpired nonce: it rejects the new call with
`REPLAY_STATE_CAPACITY_EXCEEDED` (HTTP 503) before upstream dispatch. This keeps
memory bounded without reopening the oldest plan for replay; capacity returns
as entries expire. Restarting the process, which already invalidates every outstanding plan through the
process-local signing key, clears this cache along with it; a multi-worker
deployment would need this cache made as shared as the signing secret, which
is why CLAUDE.md SS7 keeps this service to one worker.

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
`continuation` only advances for a query plan; an order plan is never refreshed
into one, and a websocket registration has nothing to page through.

### Response for a websocket plan

```json
{
  "operation_ref": "base:0B",
  "data": {
    "return_code": 0,
    "return_msg": "",
    "trnm": "REG",
    "data": [{"item": "005930", "type": "0B"}]
  },
  "continuation": {
    "cont_yn": "N",
    "next_key": null,
    "next_plan_token": null
  }
}
```

`call` returns the registration acknowledgement, not a market event. The FIDs a
subscription actually delivers — the same fields `athena_describe` reports for
that operation — arrive afterward, out of band, as `REAL` events on
`WS /api/v1/ws/stream`; they never pass through `call` or a plan.

## Discovery and execution safety

### Orders: explicit discovery, then callable, still guarded

The 12 order operations appear only under `intent=order` — `discovery_only=true`
on the `search` hit means exactly that gate, not that `call` refuses them.
`resolve`/`call` execute orders directly now: `generic_callable=true`,
`execution_policy=selector_guarded_order`, and `call` dispatches to the same
`call_order_tr` function the typed direct order route calls, so it is one guard
implementation, not two. Signing a plan settles *which* operation was agreed
on; it does not authorise placing it. `call` still demands the same
`Authorization`, `X-Athena-Confirm`, and `Idempotency-Key` headers as the typed
order route, and the account's `order_scopes` allowlist still applies. Order
execution keeps every independent safeguard it always had — server opt-in,
local bearer authentication, explicit confirmation, and idempotency key — the
selector adds a resolution step in front of them, it does not replace or weaken
any of them. Two further properties hold by construction: default/`query`
`resolve` ranks only the query surface, so no vague question can land on an
order — the model must search under `intent=order`, then name the operation it
found — and an order plan is never refreshed into a continuation token, because
that token would place the order a second time.

### WebSocket: control frames, never the stream

The 23 WebSocket operations appear only under `intent=websocket`, and `call`
dispatches them to the socket (`call_websocket_tr`) rather than the HTTP
client — `generic_callable=true`, `execution_policy=selector_websocket_control`.
A REG or REMOVE frame is a one-shot call that returns an ack, which is what
`call` returns; the events it turns on are delivered out of band through
`WS /api/v1/ws/stream` and never through a plan. A subscription has nothing to
continue, so no follow-up plan token is minted.

### Missed intent: `suggested_intent`

An `auto` or `query` search for "실시간 체결 구독" used to return unrelated read
operations scoring in the hundreds, with nothing to signal the miss. `SearchResponse`
now carries `suggested_intent` when the question reads as an action rather than a
read. A read marker such as 조회, 내역, or 현황 always wins, so "미체결 주문 조회"
stays a query.

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
| Client family assertion conflicts with canonical selection | `PREFERRED_REF_NOT_SUPPORTED_BY_QUERY` | 409 | Drop the assertion and refine the question. |
| Hidden OAuth identity named directly | `OPERATION_NOT_FOUND` | 404 | Hidden identities are indistinguishable from unknown or unsupported identities; do not retry through `call`. |
| Split family named without `detail_group` | `DETAIL_GROUP_REQUIRED` | 422 | Read `details.available_groups` and resolve again with one of them. |
| `detail_group` not in the selected family | `UNKNOWN_DETAIL_GROUP` | 422 | Read `details.available_groups`, or drop `detail_group` for the base response. |
| Missing, unknown, or invalid request fields | `INVALID_ARGUMENTS` | 422 | Collect or correct arguments, then resolve again. |
| Malformed token or invalid signature | `INVALID_PLAN` | 400 | Resolve again; do not alter the token. |
| Plan expired | `EXPIRED_PLAN` | 410 | Resolve again with current intent and arguments. |
| Catalog/schema changed after resolution | `STALE_PLAN` | 409 | Search/describe/resolve against the current catalog. |
| `plan_token` already spent by a prior `call`, including one that failed upstream | `PLAN_ALREADY_USED` | 409 | Resolve again; never resend the same token. |
| Replay-state capacity contains only unexpired nonces | `REPLAY_STATE_CAPACITY_EXCEEDED` | 503 | Wait for outstanding plans to expire, then resolve again; no upstream call occurred. |

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
the returned plan token. Search returns one operation per TR family. For a
focused question, use the top search suggestion or read detail_groups from
describe; resolve may auto-select one uniquely supported typed/canonical local
detail, otherwise pass the matching detail_group after DETAIL_GROUP_REQUIRED.
Use response_mode=full for the full typed base response. Orders and
WebSocket subscriptions need an explicit intent="order" or intent="websocket" on
both search and resolve; a vague question never reaches them. A WebSocket call
sends one registration frame and returns its acknowledgement, not the stream -
subscribe the caller to WS /api/v1/ws/stream separately for the events it turns
on. OAuth and U.S.-only operations are unavailable. Each plan_token may be
called exactly once, even if that call fails - never retry the same token;
resolve again for a new one.
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
6. Do not retry an expired, stale, or already-used token, including one whose call
   just failed upstream. Run resolution again for a new `plan_token` in every case.
7. Order and WebSocket plans go through the same `resolve`/`call` pair as a
   read; only the intent argument, the order confirmation/idempotency headers,
   and (for orders) the `Authorization` header differ. Do not build a second,
   parallel call path for them. `OPERATION_NOT_GENERIC_CALLABLE` is an internal
   callable-gate failure, not a hint to probe hidden identities. A hidden OAuth
   identity is deliberately indistinguishable from an unknown identity and returns
   `OPERATION_NOT_FOUND`.
8. Cache manifest/search/description only by `catalog_version`. Discard cached
   contracts when the version changes.

## Rate limit, concurrency, and continuation

Selector-local operations do not consume the upstream allowance. A successful
`athena_call` performs exactly one typed Kiwoom request — a query, a guarded
order, or a websocket registration frame — even for a detail projection; the
projection is applied to that single query response.

Operational rules:

- Do not spend calls to compare candidates. Compare `search` results and
  `describe` contracts locally.
- A resolved `plan_token` is single-use (see
  [Single-use enforcement](#single-use-enforcement)). Never call it twice,
  including as a retry after a failure; resolve again for a new one.
- Independent query plans may run concurrently, but Athena's shared limiter
  remains authoritative. The service is designed around at most five concurrent
  distinct query calls and Kiwoom's five-calls-per-second constraint.
- Preserve question order when presenting multiple results even if calls finish
  out of order.
- Do not automatically retry an order call. `call` now executes orders, guarded
  by the same `Idempotency-Key` contract the direct order route enforces, but a
  blind client-side retry after an ambiguous response (timeout, connection
  reset) is still the caller's risk to avoid, not the selector's to absorb.
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
  intents, including a dedicated 12-question realtime slice that exercises
  `resolve` end to end (not just retrieval) against the FID vocabulary;
- OAuth and all official U.S.-only identifiers as negative cases;
- mixed-case WebSocket identities;
- continuation, expired-token, tampered-token, and stale-catalog cases.

### Metrics

Retrieval is scored at **family** granularity. Projection choice is a separate,
family-local decision: it is either a uniquely supported typed/canonical result or
an explicit `detail_group`, and its correctness is asserted per case by
`test_resolve_selects_the_gold_base_or_detail`.

| Metric | Definition | Release expectation |
| --- | --- | --- |
| Family recall@5 | Correct base TR family appears in the top five. | 100% across every golden slice; regressions block release. |
| Family top-1 accuracy | Correct base TR family ranks first. | 100% across every golden slice. |
| Realtime family top-1 | Correct websocket family ranks first, retrieval only. | 12/12. |
| Realtime resolve accuracy | `resolve` returns the gold `operation_ref` for a realtime question. | 12/12. |
| Projection fidelity | `detail_group` resolves to that group or fails loudly. | 100%; an unknown group must never fall back to base. |
| Base over-fetch rate | Focused questions answered without the correct family-local detail. | Auto-detail must have unique typed/canonical support; otherwise `DETAIL_GROUP_REQUIRED`. |
| Full-response recall | Explicit full/multi-group questions resolved to base. | 100% for explicit-full fixtures. |
| Pure-list compliance | Pure-list questions remain at base. | 100%. |
| Ambiguity precision | Ambiguous gold cases produce no plan. | 100% for safety fixtures. |
| Argument validation recall | Missing/unknown/invalid fields fail before a plan. | 100%. |
| Policy isolation | Order/WSS never reachable by a vague `auto`/`query` question, wrong-intent exact identity, or mismatched `candidate_refs`/`preferred_ref`; OAuth/U.S. never leak. | 100%. |
| Determinism | Same input/catalog produces byte-equivalent ordered candidates. | 100% across randomized registry order and hash seeds. |
| Context footprint | Always-loaded schemas seen by the LLM. | Four meta-tools, independent of catalog size. |
| Upstream efficiency | Kiwoom calls per successful focused question. | One unless the user explicitly requests multiple independent data sets/pages. |

Accuracy must be reported at both family and exact-operation levels. A selector
that finds `ka10001` but chooses its full base for every focused question has high
family accuracy and poor projection quality.

### Current progress

The catalog, four-tool transport contract, signed-plan boundary, explicit
projection selection, realtime discovery and execution, and safety fixtures are
implemented. The 84-case golden corpus below is the historical identity-assisted
baseline. Current autonomous and typed-routing evidence is reported by independent
strata in the routing-authority table at the start of this document; it supersedes
the old combined retrieval summary.

- Historical baseline only: over the 72 cases carrying an accepted family, recall@5
  was 72/72 and top-1 was 70/72. Do not present this as current autonomous accuracy.
- `detail` and `detail_required` are each 22/22 = 100%, so the combined
  detail-and-base slice is 44/44 = 100%. The long-standing near-miss here —
  `금일 재사용 금액만` ranking `base:kt00010` above the gold `base:kt00013` — is
  resolved, not tuned around: it was a Korean-bigram false match (a two-syllable
  slice of one word matching as a whole word of another), and half-weighting
  bigrams fixed it along with the class of mismatches it belonged to. The
  earlier failure mode this slice also used to show — focused questions
  resolving to a base operation because sibling projections were ranked against
  each other — remains gone by construction: siblings are still never ranked.
- `realtime` retrieval is 12/12 top-1 and 12/12 recall@5. Autonomous realtime
  resolve is also 12/12, measured separately by `test_realtime_resolve_is_exact`.
  Typed subject/entity eligibility closes the former `realtime-0B-ko` miss by
  separating an instrument-scoped stock fill from the account-scoped order-fill
  stream before lexical ranking.

Those 117/117 and 73/73 figures belong to an earlier autonomous evaluation report and
are superseded; they must not be combined with the current strata. The last-known
artifact-bound strata are listed in the routing-authority table above. Historical ablation findings
remain useful for diagnosis, but display descriptions, family projections, aliases,
bigrams, coverage, and score thresholds are not execution authority.

`scripts/evaluate_selector_ablations.py --check` validates the current release
report at `plan/selector-g003-autonomous-2026-08-20.json`. The original
`plan/selector-ablation-baseline-2026-08-20.json` is an immutable historical G001
measurement and is read or compared only when passed explicitly with `--output`;
the default check never rewrites or treats it as current.

### Regression invariants

The test suite should fail if any of these change without an intentional contract
update:

- 323 canonical operation documents: 171 query bases, 115 details, 12 orders,
  23 WebSocket operations, and 2 hidden OAuth controls;
- exactly 299 generic-callable identities: 149 unsplit query bases, 115 projections,
  12 orders, and 23 websocket controls. The 264 query identities match the
  common-screen manifest's `read_display` count; the 22 split bases stay searchable
  and describable but are not callable;
- a searchable query surface of exactly 171 documents, one per TR family, with
  no projection among them;
- every one of the 115 projections advertised by `describe` on its base; one may
  be auto-selected only when typed compatibility plus authoritative canonical
  evidence uniquely supports it, otherwise it is reachable by naming its
  `group_id` and omission returns `DETAIL_GROUP_REQUIRED`;
- exactly 35 explicit guarded order/WebSocket identities;
- no U.S.-only identity in search, describe, resolve, call, or manifest;
- no plan for ambiguity, invalid arguments, or a hidden OAuth identity; a plan
  for a named order or websocket operation is expected and, on `call`, is
  guarded exactly as the direct order/websocket surfaces guard it;
- an order plan never refreshes into a continuation token, and a websocket
  registration mints no plan to continue in the first place;
- a plan is bound to the account that resolved it and fails `INVALID_PLAN` if
  replayed under another;
- a plan_token is single-use: a second `call` with the same token fails
  `PLAN_ALREADY_USED` regardless of whether the first attempt succeeded,
  failed upstream, or is still in flight, for query, order, and websocket
  plans alike;
- base/detail selection rules, family-first compatibility, active-axis Pareto
  dominance, reviewed equivalence collapse, and fail-closed target evidence;
- catalog version changes whenever identities, searchable metadata, lexicon, or
  request/response schemas change;
- every successful detail call performs one base TR call and returns only its
  declared response fields;
- `describe` on a websocket operation reports the per-event FID model, not the
  shared four-field envelope, whenever the response model carries one;
- continuation can advance only through a server-issued next plan, and only for
  a query plan.

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
