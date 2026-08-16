<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# tests

## Purpose
Pytest suites for the whole backend. `pyproject.toml` sets `testpaths = ["tests"]` and
`asyncio_mode = "auto"`, so async tests need no marker.

## Key Files
| File | Description |
|------|-------------|
| `test_io_docs.py` | Verifies `docs/KIWOOM_API_IO.md` matches the generated inventory — fails on stale docs |
| `test_common_screen_manifest.py` | Validates `ref/kiwoom-common-screen-manifest.json` structure |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `unit/` | Auth, HTTP client, WebSocket client, rate limiter, return codes, pagination, process lock, output profile, selector core/eval, brain (ontology, store, history, ingestion, extraction) |
| `api/` | Routed surface: `test_inventory_api.py` (generated routes), `test_llm_tools_api.py` (four selector tools) |
| `mcp/` | `athena_mcp` gateway suites plus `fixtures/fake_server.py`, a controllable upstream MCP server |
| `fixtures/` | `api_selector_golden.jsonl` — golden selector expectations |

## For AI Agents

### Working In This Directory
- Never hit `mockapi.kiwoom.com` from a test. Stub HTTP with `respx`; stub MCP with `fixtures/fake_server.py`.
- `fixtures/api_selector_golden.jsonl` is a behavioral contract. Regenerating it is a deliberate act
  that must be justified in the commit message, not a routine refresh.
- `test_io_docs.py` and `test_common_screen_manifest.py` fail when generated artifacts drift — fix
  by regenerating, not by loosening the assertion.
- No credentials in fixtures or env files used by tests.

### Testing Requirements
```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m pytest tests/unit/test_selector_eval.py   # release gate
```
Selector evaluation currently has known failures; treat any new failure elsewhere as a regression.

### Common Patterns
- One test module per source module, named `test_<module>.py`.
- Async tests declared with plain `async def` (auto asyncio mode).

## Dependencies

### External
- pytest, pytest-asyncio, respx

<!-- MANUAL: -->
