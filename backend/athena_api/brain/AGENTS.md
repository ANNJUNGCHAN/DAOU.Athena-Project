<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# brain

## Purpose
The investment brain: a bounded ontology plus an embedded graph projection over local chat/trade
history and ingested source records. Design rationale is in `plan/investment-brain-architecture.md`;
status in `plan/investment-brain-progress-2026-08-15.md`.

## Key Files
| File | Description |
|------|-------------|
| `ontology.py` | Strict, bounded contracts for the graph projection |
| `store.py` | Async-safe embedded graph projection backed by a single LadybugDB owner |
| `history.py` | Authoritative local chat/trade history and durable ingestion state |
| `ingestion.py` | Incremental raw-history adapters and the durable source projection coordinator |
| `extraction.py` | Validated, explicitly injected structured extraction for one source record |

## For AI Agents

### Working In This Directory
- **One LadybugDB owner per process.** Concurrent writers are a correctness bug, not a performance
  tuning question; go through `store.py`'s async lock.
- History is authoritative and append-only; the graph is a *projection* that must be rebuildable
  from it. Never mutate the graph as the only record of a fact.
- Extraction takes its dependencies explicitly (no implicit model/client lookup) and validates
  output against the ontology before anything is written.
- Ingestion is incremental and resumable — durable state must be updated in the same step that
  commits the projection.
- **Not yet wired into FastAPI.** There is no route surface for the brain; wiring it is open work
  tracked in `plan/plan.md`.

### Testing Requirements
`tests/unit/test_brain_ontology.py`, `test_brain_graph_store.py`, `test_brain_history.py`,
`test_brain_ingestion.py`, `test_brain_extraction.py`.

### Common Patterns
- Bounded contracts: every node/edge type is enumerated in `ontology.py`; no free-form properties.
- Async-safe access with explicit ownership rather than thread-local or global state.

## Dependencies

### Internal
- `athena_api/config.py`, `athena_api/errors.py`

### External
- ladybug 0.19.1 (embedded graph DB), jsonschema, pydantic

<!-- MANUAL: -->
