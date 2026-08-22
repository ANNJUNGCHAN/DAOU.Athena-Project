<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# selector

> Terminology: [`GLOSSARY.md`](../../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Deterministic, allowlisted operation selection for LLM clients. Keeps the 323-operation catalog
server-side (264 generic-callable query identities, 35 explicit guarded order/WebSocket identities,
22 searchable split bases, and 2 hidden OAuth identities) and backs the four exposed tools — `athena_search`, `athena_describe`,
`athena_resolve`, `athena_call` — so the model never sees the full OpenAPI document.

## Key Files
| File | Description |
|------|-------------|
| `catalog.py` | Canonical 323-operation catalog built from the generated allowlists |
| `service.py` | Transport-neutral orchestration for search, resolve, and execution |
| `schemas.py` | Strict public contracts for the four selector tools |
| `ranking.py` | Deterministic, explainable lexical ranking over the catalog |
| `lexicon.py` | Versioned, controlled Korean/English finance vocabulary for lexical retrieval |
| `normalization.py` | Unicode-safe natural-language normalization with exact operation identities |
| `plans.py` | Short-lived HMAC execution plans — tokens carry no URLs or paths |
| `policy.py` | Legacy exact/detail facade; semantic selection delegates only to shared typed compatibility |
| `errors.py` | Domain errors for adapters to translate at their own transport boundary |

## For AI Agents

### Working In This Directory
- Treat `tests/unit/test_selector_eval.py` plus both autonomous evaluator partitions as release gates;
  do not claim the selector is done without fresh green evidence.
- Ranking must stay deterministic and explainable — no embeddings, no model calls, no randomness.
- Plan tokens are short-lived HMACs and must never encode a URL or filesystem path; execution
  resolves the identity server-side.
- Detail selection is family-local: auto-select only a uniquely supported typed/canonical child;
  otherwise require the explicit `detail_group`. Never infer it from ambient state or argument values.
- Lexicon changes are versioned; bumping vocabulary requires refreshing the golden fixture.
- `ref/selector-entity-markers.json` is a versioned, hash-bound reviewed asset-class marker source,
  not an instrument master. Validate it through the generator and never add issuer-specific ranking boosts.
- Public production routing is the typed/canonical path. `QueryFrame`, evidence atoms, and
  compatibility proofs are shadow/advisory analysis unless the public contract explicitly says
  otherwise; lexical title, synonym, alias, and threshold scores are not execution authority.
- Keep strata separate in reports: public production, expansion, v2, v3, and v4. The following are
  last-known artifact-bound measurements, not unconditional current claims; refresh them after
  evaluator/source-hash changes. Results are public 72/72 (raw 63/63, quote 9/9, exact 16/16, shadow 39/41, advisory 4),
  expansion 45/45 (exact 33/33, shadow 19/19, advisory 9), v2 60/60 (exact 43/43, shadow
  10/12, advisory 18), v3 74/74 (exact 50/50, shadow 11/11, advisory 15), and v4 73/73
  (exact 51/51, shadow 15/15, advisory 12); safety violations are zero.

### Testing Requirements
```powershell
.venv\Scripts\python -m pytest tests/unit/test_selector_core.py tests/unit/test_selector_eval.py
```
Golden expectations live in `backend/tests/fixtures/api_selector_golden.jsonl`. Regenerate
deliberately — a diff there is a behavior change, not noise.

### Common Patterns
- Identities are exact and case-sensitive; normalization happens on the query side only.
- Every ranking decision carries a reason string usable in `athena_describe` output.

## Dependencies

### Internal
- `athena_api/generated/registry.py` (allowlists), `athena_api/output_profile.py`,
  `backend/ref/response-projections.json`

### External
- pydantic

<!-- MANUAL: -->
