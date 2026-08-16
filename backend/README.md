# DAOU Athena backend

Standalone FastAPI access to the Kiwoom mock REST API. The service is locked to
`https://mockapi.kiwoom.com`, keeps credentials and issued access tokens in process memory only,
and leaves its guarded order routes disabled by default.

## Run locally

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
Copy-Item .env.example .env
.venv\Scripts\python -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8010 --workers 1
```

Use exactly one Uvicorn worker. When credentials are configured, startup acquires one
cross-platform nonblocking process lock **per credential pair**, so a second backend owning the
same account fails closed while two backends owning different accounts may coexist.
The in-memory token, WebSocket connection, idempotency state, and strict rolling-window limiter are
process-local. Each account gets its own limiter covering that account's REST queries, WebSocket
controls, and orders, because Kiwoom meters requests per app key. It permits at
most five starts in any rolling second and at most one start per API ID in that window. Batch
execution may therefore run up to five distinct query TRs concurrently; order TRs are excluded.

## Accounts

Kiwoom's REST protocol carries no account-number field: a request is attributed to whichever
account issued its bearer token. One account is therefore exactly one app key / secret key pair,
and the service holds one independent stack (token, limiter, clients, WebSocket) per pair.

Configure every account in the single `ATHENA_KIWOOM_ACCOUNTS` JSON array and name a default with
`ATHENA_KIWOOM_DEFAULT_ACCOUNT`; see [.env.example](.env.example). Repeating
`ATHENA_KIWOOM_APP_KEY` on separate `.env` lines keeps only the last value and silently drops
every earlier account. The legacy single `ATHENA_KIWOOM_APP_KEY`/`ATHENA_KIWOOM_SECRET_KEY` pair
still works and becomes a one-entry pool aliased `default`; setting both forms is an error.

Callers choose an account with the `X-Athena-Account: <alias>` header, or an `?account=<alias>`
query parameter where custom headers are unavailable, such as a browser WebSocket handshake.
Omitting it uses the default account. An unknown alias is a `404`, never a silent fall back to the
default. `GET /ready/accounts` reports each account's token and WebSocket readiness separately, so
a one-of-N authentication failure stays visible; `/ready` continues to answer for the default
account alone.

Order idempotency keys are scoped per account, and a signed selector plan records the account it
was resolved under, so a plan cannot be replayed against a different account inside its TTL.

### Order scopes

`ATHENA_ENABLE_ORDER_API` is the master switch. Beyond it, each account may carry an
`order_scopes` allowlist covering the three order families this API exposes: `cash`
(kt10000–kt10003), `credit` (kt10006–kt10009, `/api/dostk/crdordr`), and `gold`
(kt50000–kt50003). Omitting the key leaves the account unrestricted; `[]` makes it query-only
and every order returns `403` before anything is sent upstream and before the idempotency key
is consumed.

Kiwoom's REST inventory contains **no short-sell order operation**. The only sell TR with a
credit discriminator is kt10007, whose `crd_deal_tp` accepts `33:융자` and `99:융자합` — margin
repayment, not 대주. A short-selling (대주) account therefore has no order family to hold on
this surface and belongs on `order_scopes: []`; `ka10014 공매도추이요청` and the four 대차거래
TRs remain available to it as ordinary queries.

WebSocket controls use one persistent connection to the Kiwoom mock WebSocket endpoint. They
share the same process-wide query limiter as REST queries, restore successful registrations after
reconnect, and fan out `REAL` events through bounded in-memory subscriber queues.

Downstream clients receive those `REAL` events from `WS /api/v1/ws/stream`. Keep the service bound
to `127.0.0.1` and never put a bearer token in the query string. Non-browser clients may send
`Authorization: Bearer <token>`; browser and Electron clients send
`{"type":"auth","token":"<token>"}` as their first WebSocket frame when
`ATHENA_LOCAL_BEARER_TOKEN` is configured. Without that setting, the stream accepts loopback peers
only.

`/docs`, `/redoc`, and `/openapi.json` start without credentials. Data routes fail closed with
HTTP 503 until at least one account is configured with both an app key and a secret key and a
token is issued successfully for it.

The generated [exhaustive Kiwoom I/O reference](docs/KIWOOM_API_IO.md) documents every source
request and response row for all 208 case-sensitive operations and 115 response-detail
projections across all 22 pinned candidates. At runtime, use [Swagger UI](/docs), the [OpenAPI JSON](/openapi.json), or the
[operation catalog](/api/v1/catalog) for machine-readable schemas and route metadata.

The generator also commits a deterministic
[response output profile](ref/kiwoom-output-profile.json). It classifies scalar-only, pure-list,
and compound response shapes, records field/list/depth distributions, and applies the documented
one-screen complexity policy for identifying detail candidates. Type-7 quantiles and Tukey fences
remain descriptive statistics rather than candidate gates. Pure-list responses stay list/pagination
UI concerns and are never selected for arbitrary field-split routes.
The canonical [response projection manifest](ref/response-projections.json) covers every generated
top-level response alias exactly once. Facts groups contain at most 20 fields; LIST fields remain
atomic table groups with a UI page size of 10 rows.

## LLM API selector

Use the [LLM API selection contract](docs/LLM_API_SELECTION.md) when connecting an LLM or MCP
adapter. Athena keeps the 323-operation domestic catalog server-side: 208 base operations plus 115
detail projections. Of these, 299 identities are generic-callable: 264 query identities (149 unsplit bases
plus 115 projections), 12 guarded orders, and 23 websocket control frames. 22 split bases are
searchable but require a `detail_group`, and 2 OAuth identities are hidden. Orders and
websocket controls need an explicit `intent` to be found and cannot be reached by a vague
question. `resolve` and `call` execute both directly once named — a websocket `call` sends one
registration frame over the shared connection and returns its acknowledgement, with the `REAL`
events it turns on still arriving separately on `WS /api/v1/ws/stream`, never through `call` — and
orders additionally keep every guard the typed order route enforces, dispatched through that same
guarded function rather than a second implementation of it.

Expose exactly these four POST tools to the model: `athena_search`, `athena_describe`,
`athena_resolve`, and `athena_call`. Do not register all 323 operations as flat model tools and do
not pass the complete OpenAPI document into the model context. Adapters may bootstrap from
`GET /api/v1/llm/manifest` (`llm_get_manifest`), which is explicitly marked
`x-athena-llm-exposed: false` and is not a fifth model tool. The current OpenAPI build contains
314 GET/POST operations (301 generated Kiwoom operations plus 13 service operations); only the four
selector POST operations carry `x-athena-llm-exposed: true`. The 22 split base routes are not
registered: their projections replaced them, and `/api/v1/raw/tr/{tr_id}` and `/api/v1/batch`
refuse them too so the removal is not merely cosmetic.

Treat the selector evaluation suite as a release gate: it pins retrieval thresholds at family
granularity and asserts that every split family refuses `resolve` with the list of groups that
replaced it.

Order endpoints, when installed, are additionally disabled by default. Enabling them requires
`ATHENA_ENABLE_ORDER_API=true` and `ATHENA_LOCAL_BEARER_TOKEN`; the order router also enforces its
own local bearer authorization, explicit confirmation, and idempotency contract. Order calls use a
separate client with automatic retry disabled so a timeout or rate-limit response cannot duplicate
an order.

## Verify

```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
.venv\Scripts\python scripts\generate_api.py --check
```
