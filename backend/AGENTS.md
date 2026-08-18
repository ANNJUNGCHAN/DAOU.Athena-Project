<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# backend

> Terminology: [`GLOSSARY.md`](../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Standalone FastAPI service locked to `https://mockapi.kiwoom.com`. It exposes an allowlisted,
generated Kiwoom query surface (323 operations = 208 base + 115 detail projections), a four-tool LLM
selector, an investment-brain graph projection, and a sibling MCP gateway package. Credentials and
issued tokens stay in process memory; data routes fail closed with HTTP 503 until a token is issued.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Run, security posture, selector contract, verify commands — read before changing behavior |
| `pyproject.toml` | Hatchling build (`athena_api`, `athena_mcp`), deps, pytest (`asyncio_mode=auto`), ruff (line 100, excludes `athena_api/generated`) |
| `uv.lock` | Pinned dependency lock |
| `.env.example` | Tracked template for `ATHENA_*` settings |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `athena_api/` | FastAPI application package (see `athena_api/AGENTS.md`) |
| `athena_mcp/` | Athena-as-MCP client + server gateway (see `athena_mcp/AGENTS.md`) |
| `ref/` | Checked-in Kiwoom inventory and profile JSON — generator input (see `ref/AGENTS.md`) |
| `scripts/` | `generate_api.py`, the deterministic API generator (see below) |
| `docs/` | `KIWOOM_API_IO.md` (exhaustive I/O reference), `LLM_API_SELECTION.md` (selector contract) — both generated/verified |
| `tests/` | Pytest suites (see `tests/AGENTS.md`) |

`scripts/generate_api.py` reads `ref/kiwoom-tr-inventory.json`, classifies all 208 operations into
query / order / WebSocket-path / internal OAuth surfaces, and writes `athena_api/generated/*` plus
`ref/kiwoom-output-profile.json` and `docs/KIWOOM_API_IO.md`. Output is deterministic; `--check`
fails if the tree is stale.

## For AI Agents

### Working In This Directory
- Run with **exactly one uvicorn worker**. Token, WebSocket connection, idempotency cache, and the
  rate limiter are all process-local; a credential-owning second process is refused by `process_lock.py`.
- Never hand-edit `athena_api/generated/` or `docs/KIWOOM_API_IO.md`. Change the generator or `ref/`
  data, then regenerate.
- Order routes stay disabled by default (`ATHENA_ENABLE_ORDER_API` + `ATHENA_LOCAL_BEARER_TOKEN`),
  use a no-retry client, and require explicit confirmation plus idempotency.
- Errors must be secret-safe at the HTTP boundary — raise the domain errors in `athena_api/errors.py`.
- Treat the selector evaluation suite as a release gate.

### Testing Requirements
```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
.venv\Scripts\python scripts\generate_api.py --check
```
Async tests need no marker (`asyncio_mode = "auto"`). HTTP is stubbed with `respx`.

빠른 루프: `pytest -n auto --dist loadgroup` (pytest-xdist, 전체 스위트 약 176s → 약 55~58s, 22코어
실측 2026-08-19). `addopts`에는 넣지 않았다 — 단일 테스트 디버깅(`-x --pdb`) 편의를 지키기 위해서다.
프로세스 전역 상태(고정 가짜 자격증명, 실소켓 바인딩)를 쓰는 테스트는 `pytest.mark.xdist_group(...)`로
같은 워커에 묶여 있다 — `tests/unit/test_accounts.py`(모듈 전체, alias `daeju` 공유),
`test_real_uvicorn_loopback_smoke_uses_os_assigned_port`. 새 테스트가 같은 종류의 전역 상태를 쓰면
그룹에 합류시키거나 새 그룹을 만들어라.

### Common Patterns
- One-line module docstring at the top of every module states its single responsibility.
- Dependency injection through `athena_api/dependencies.py`; no import-time globals for clients.
- Bounded everything: rolling-window rate limits, bounded subscriber queues, bounded batch fan-out.

## Dependencies

### Internal
- `ref/` → `scripts/generate_api.py` → `athena_api/generated/` → `athena_api/selector/catalog.py`

### External
- fastapi, httpx, uvicorn[standard], websockets, pydantic-settings, jsonschema, ladybug 0.19.1, mcp 1.28.*
- dev: pytest, pytest-asyncio, pytest-xdist, respx, ruff

<!-- MANUAL: -->
