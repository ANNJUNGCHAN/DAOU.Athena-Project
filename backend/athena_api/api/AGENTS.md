<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# api

> Terminology: [`GLOSSARY.md`](../../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Hand-written routers that sit alongside the generated Kiwoom routes. `__init__.py` composes all of
them (generated first, then batch/catalog/llm_tools/raw/stream) into the single `router` mounted by
`main.create_app()`.

## Key Files
| File | Description |
|------|-------------|
| `__init__.py` | Aggregate `APIRouter`; include order defines route precedence |
| `batch.py` | Bounded batch execution over allowlisted Kiwoom HTTP query operations |
| `catalog.py` | Read-only metadata for every generated inventory operation (`/api/v1/catalog`) |
| `llm_tools.py` | The four exposed LLM tools — `athena_search`, `athena_describe`, `athena_resolve`, `athena_call` — plus the non-tool `llm_get_manifest` |
| `raw.py` | Allowlisted raw HTTP query passthrough |
| `stream.py` | Authenticated downstream fanout of Kiwoom `REAL` WebSocket events (`WS /api/v1/ws/stream`) |

## For AI Agents

### Working In This Directory
- **Exactly four operations carry `x-athena-llm-exposed: true`.** Do not add a fifth model tool and
  do not flatten the 323 operations into individual tools.
- `stream.py` auth rules: non-browser clients may send `Authorization: Bearer <token>`; browser and
  Electron clients send `{"type":"auth","token":"..."}` as the first frame. Never accept a token in
  the query string. Without `ATHENA_LOCAL_BEARER_TOKEN`, loopback peers only.
- Batch fan-out is capped by the shared process-wide limiter (≤5 starts per rolling second, ≤1 per
  API ID); order TRs are excluded from batch entirely.
- Routers stay transport-only: validation and orchestration belong in `selector/service.py` or
  `kiwoom/`.

### Testing Requirements
`backend/tests/api/test_inventory_api.py` and `test_llm_tools_api.py`. Use `respx` to stub upstream
HTTP; never hit the live mock host in tests.

### Common Patterns
- Dependencies injected via `athena_api.dependencies`; no direct client construction in handlers.
- Errors raised as domain errors and translated by the installed handlers, not as ad-hoc `HTTPException`
  carrying upstream text.

## Dependencies

### Internal
- `athena_api/generated/` (routes, registry), `athena_api/selector/` (service, schemas),
  `athena_api/kiwoom/` (client, ws_client, rate limiter), `athena_api/dependencies.py`

### External
- fastapi, starlette

<!-- MANUAL: -->
