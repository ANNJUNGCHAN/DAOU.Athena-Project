<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# DAOU.Athena

> Terminology: [`GLOSSARY.md`](GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Athena is a local-first Korean-equity research assistant built on the Kiwoom mock REST/WebSocket API.
Four tracks sit on top of that backend: an **MCP gateway** (`backend/athena_mcp`), an **investment
brain** graph projection (`backend/athena_api/brain`), a **deterministic LLM API selector**
(`backend/athena_api/selector`), and a **two-window Electron shell** (`app/`). All secrets live in
process memory or `.env`; nothing credential-bearing is committed.

## Key Files
| File | Description |
|------|-------------|
| `CLAUDE.md` | **Working principles** — mock-account-only rule, `ui/` as the design authority, evidence-over-assumption, security invariants, pitfall list. Read before changing anything |
| `.gitignore` | Blocks `.env*`, `vendor/`, agent runtime state (`.omc/`, `.omx/`), caches, `node_modules/`, `.venv/` |
| `.gitattributes` | Pins the working tree to LF |
| `.env` | Local secrets — untracked, never commit |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `backend/` | FastAPI Kiwoom facade, selector, brain, MCP gateway, tests (see `backend/AGENTS.md`) |
| `app/` | Electron two-window shell prototype (see `app/AGENTS.md`) |
| `plan/` | Living plans, handoffs, progress snapshots (see `plan/AGENTS.md`) |
| `spike/` | Throwaway experiments with recorded evidence (see `spike/AGENTS.md`) |
| `ui/` | Design soul, palette, moodboard, design rounds (see `ui/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **`CLAUDE.md` holds the binding principles.** It wins over convenience: mock account only, `ui/`
  is the design authority, measurements beat documents, unimplemented scope stays visible.
- **Read `plan/plan.md` first.** It carries current state, verified facts, and the next move.
  Design rationale and pitfalls live in `plan/00-인수인계.md`; do not duplicate either.
- Two runtimes, two toolchains: Python 3.11+/`uv`/`pytest` under `backend/`, Node/Electron under `app/`.
  There is no root-level build.
- Never commit secrets. `.env` is ignored; `backend/.env.example` is the tracked template.
- Project docs are largely Korean. Match the language of the file you are editing.
- Honesty convention: READMEs in this repo record known bugs, partial passes, and unimplemented
  scope explicitly. Preserve that — do not quietly delete a "미구현" note when touching a feature.

### Testing Requirements
```powershell
cd backend
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
.venv\Scripts\python scripts\generate_api.py --check
```
```bash
cd app && npm run verify
```

### Common Patterns
- Generated code is checked in and verified by `--check`; edit the generator, never the output.
- Reference data (`backend/ref/*.json`) is the source of truth for the API surface.
- Evidence over assertion: capture artifacts (`app/captures/`, `spike/captures/`) back up claims.

## Dependencies

### External
- FastAPI, httpx, uvicorn, websockets, pydantic-settings, jsonschema, ladybug (embedded graph DB), `mcp` 1.28.x
- Electron 43.x (no React, no bundler)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
