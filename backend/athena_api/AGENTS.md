<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# athena_api

> Terminology: [`GLOSSARY.md`](../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
The FastAPI application package: configuration, lifecycle, security boundary, error translation, and
the composition root that wires generated Kiwoom routes, the LLM selector, and the streaming fanout
into one app.

## Key Files
| File | Description |
|------|-------------|
| `main.py` | `create_app()` factory; `/health`, `/ready`, docs URLs, exception handlers, order idempotency state |
| `config.py` | `Settings` (pydantic-settings) with `KIWOOM_MOCK_BASE_URL` pinned; `get_settings()` is `lru_cache`d |
| `lifespan.py` | Startup/shutdown of the httpx client, token manager, WebSocket client, process lock |
| `dependencies.py` | FastAPI dependencies for Kiwoom data routes and the local selector |
| `errors.py` | Secret-safe domain errors (`KiwoomError` family) + handler installation |
| `logging_config.py` | The only logging setup: one stdout handler, global + per-subsystem levels, credential redaction. No audit/body logging by design |
| `security.py` | Public authentication types used at the application boundary |
| `process_lock.py` | Cross-platform nonblocking ownership lock so a second credential-bearing runtime fails closed |
| `output_profile.py` | Deterministic response-shape profiling (scalar-only / pure-list / compound) for generated contracts |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api/` | Hand-written routers: batch, catalog, LLM tools, raw passthrough, stream (see `api/AGENTS.md`) |
| `generated/` | Generator output — do not edit (see `generated/AGENTS.md`) |
| `kiwoom/` | Auth, HTTP client, WebSocket transport, rate limiter, return codes (see `kiwoom/AGENTS.md`) |
| `selector/` | Deterministic allowlisted operation selection for LLM clients (see `selector/AGENTS.md`) |
| `brain/` | Investment-brain ontology and embedded graph projection (see `brain/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- `create_app()` is the only construction path; keep module import side effects out.
- New settings go on `Settings` with an `ATHENA_` env prefix and a validator, not on ad-hoc `os.environ` reads.
- Anything that can carry a secret (keys, tokens, upstream error bodies) must be scrubbed before it
  reaches an HTTP response or a log line.
- Data routes must remain fail-closed: no credentials → 503, never a silent empty result.
- **Logging.** `logging_config.configure_logging()` is the only setup and `create_app()` calls it
  first. Levels: `ATHENA_LOG_LEVEL` globally, `ATHENA_SRC_LOG_LEVELS` per subsystem
  (`{"brain":"DEBUG"}`; unknown keys fail startup), `ATHENA_LOG_FORMAT=text|json`.
  Never log a request/response body, chat text, or credential — log identifiers
  (`source_id`, `role`, counts) instead. `SecretRedactingFilter` scrubs known credential
  *values* as a backstop, but it cannot recognise chat text, so bodies stay a code rule
  enforced by `tests/unit/test_logging_config.py` and `tests/api/test_brain_api.py`.
  Do not add audit settings that capture bodies — Open WebUI's `AUDIT_LOG_LEVEL=
  REQUEST_RESPONSE` shape is explicitly rejected here (CLAUDE.md §1 trap ⑫); a test asserts
  no `audit`-named setting exists.

### Testing Requirements
`backend/tests/unit/` covers auth, client, rate limiter, return codes, pagination, process lock,
output profile, selector, and brain. `backend/tests/api/` exercises the routed surface.

### Common Patterns
- Async-first; every I/O path is `async` and bounded by timeout plus rate limiter.
- Pydantic models define the public contract; nothing untyped crosses the boundary.

## Dependencies

### Internal
- `generated/` supplies routes/models/registry consumed by `api/` and `selector/`.

### External
- fastapi, pydantic-settings, httpx

<!-- MANUAL: -->
