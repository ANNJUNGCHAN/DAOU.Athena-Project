<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# kiwoom

## Purpose
Transport primitives for the Kiwoom mock API: memory-only OAuth, a bounded read-only HTTP client, a
persistent WebSocket transport, the process-wide rate limiter, and canonical return-code handling.

## Key Files
| File | Description |
|------|-------------|
| `auth.py` | Memory-only token issuance/refresh — tokens are never written to disk |
| `client.py` | Bounded, read-only HTTP client for the Kiwoom mock API |
| `ws_client.py` | Persistent WebSocket transport; restores registrations after reconnect, fans `REAL` events to bounded queues |
| `rate_limiter.py` | Strict rolling-window limits on query starts, shared by REST, WebSocket controls, and orders |
| `return_codes.py` | Canonical return-code normalization shared by all transports |
| `__init__.py` | Package exports (`KiwoomClient`, `KiwoomWsClient`, `TokenManager`, …) |

## For AI Agents

### Working In This Directory
- One limiter instance covers all transports: at most five starts in any rolling second and at most
  one start per API ID in that window. Do not add a per-transport limiter.
- The base URL is pinned in `config.py`; never parameterize it to a non-mock host.
- Tokens stay in memory. No logging, no serialization, no test fixture that writes one to disk.
- Order calls use a separate client with retries disabled so a timeout cannot duplicate an order —
  keep that separation.
- WebSocket state is process-local; reconnect must re-register, not assume server-side persistence.

### Testing Requirements
`tests/unit/test_auth.py`, `test_client.py`, `test_ws_client.py`, `test_rate_limiter.py`,
`test_return_codes.py`, `test_pagination.py`. HTTP stubbed with `respx`.

### Common Patterns
- Every outbound call is timeout-bounded and rate-limited at the start boundary, not at completion.
- Upstream failure is normalized through `return_codes.py` before it becomes a domain error.

## Dependencies

### Internal
- `athena_api/config.py`, `athena_api/errors.py`

### External
- httpx, websockets

<!-- MANUAL: -->
