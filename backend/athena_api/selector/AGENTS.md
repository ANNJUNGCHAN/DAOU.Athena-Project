<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# selector

> Terminology: [`GLOSSARY.md`](../../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Deterministic, allowlisted operation selection for LLM clients. Keeps the 323-operation catalog
server-side (286 generic-callable query identities, 35 discovery-only order/WebSocket identities,
2 hidden OAuth identities) and backs the four exposed tools — `athena_search`, `athena_describe`,
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
| `policy.py` | Family selection policy (base vs. detail projection routing) |
| `errors.py` | Domain errors for adapters to translate at their own transport boundary |

## For AI Agents

### Working In This Directory
- **Known incomplete.** Focused detail resolution, vague-question clarification, and duplicate-title
  ranking have recorded regression failures. Treat `tests/unit/test_selector_eval.py` as a release gate
  and do not claim the selector is done without that suite green.
- Ranking must stay deterministic and explainable — no embeddings, no model calls, no randomness.
- Plan tokens are short-lived HMACs and must never encode a URL or filesystem path; execution
  resolves the identity server-side.
- The detail projection is an explicit argument, not inferred from ambient state (see recent history:
  "take detail projection as an explicit argument").
- Lexicon changes are versioned; bumping vocabulary requires refreshing the golden fixture.

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
