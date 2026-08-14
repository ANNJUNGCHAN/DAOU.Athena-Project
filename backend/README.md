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
.venv\Scripts\python -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Use exactly one Uvicorn worker. When credentials are configured, startup also acquires a
cross-platform nonblocking process lock, so a second credential-owning backend fails closed.
The in-memory token, WebSocket connection, idempotency state, and strict rolling-window limiter are
process-local. One shared limiter covers REST queries, WebSocket controls, and orders. It permits at
most five starts in any rolling second and at most one start per API ID in that window. Batch
execution may therefore run up to five distinct query TRs concurrently; order TRs are excluded.

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
HTTP 503 until both `ATHENA_KIWOOM_APP_KEY` and `ATHENA_KIWOOM_SECRET_KEY` are configured and a
token is issued successfully.

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
