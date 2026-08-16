<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# generated

> Terminology: [`GLOSSARY.md`](../../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Deterministic output of `backend/scripts/generate_api.py`, built from `backend/ref/kiwoom-tr-inventory.json`.
Covers all 208 inventory operations plus 115 detail projections, classified into safe query, order,
WebSocket-path, and internal OAuth surfaces.

## Key Files
| File | Description |
|------|-------------|
| `models.py` | Generated request/response Pydantic models (`# ruff: noqa: E501, I001`) |
| `routes.py` | Generated FastAPI routes for the allowlisted query surface |
| `registry.py` | Operation identity → metadata/allowlist tables consumed by the catalog and selector |
| `runtime.py` | Shared execution boundary for generated routes (hand-maintained, not templated per-op) |

## For AI Agents

### Working In This Directory
- **Do not hand-edit `models.py`, `routes.py`, or `registry.py`.** Change `scripts/generate_api.py`
  or the `ref/` inventory and regenerate. `generate_api.py --check` fails CI on a stale tree.
- `runtime.py` is the one place shared execution behavior belongs; put logic there rather than
  emitting it into every generated route.
- Ruff excludes this package (`extend-exclude` in `pyproject.toml`) — lint cleanliness is the
  generator's responsibility.
- Operation identities are case-sensitive and stable; renaming one is a breaking contract change for
  the selector and any MCP adapter.

### Testing Requirements
```powershell
.venv\Scripts\python scripts\generate_api.py --check
.venv\Scripts\python -m pytest tests/api/test_inventory_api.py tests/test_io_docs.py
```

### Common Patterns
- Generation is fully deterministic (sorted iteration, hashed inputs) so diffs are reviewable.

## Dependencies

### Internal
- `backend/ref/*.json` (input), `athena_api/output_profile.py` (shape classification),
  `athena_api/kiwoom/` (transport used by `runtime.py`)

### External
- fastapi, pydantic

<!-- MANUAL: -->
