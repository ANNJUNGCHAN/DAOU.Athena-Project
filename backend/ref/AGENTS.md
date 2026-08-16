<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# ref

> Terminology: [`GLOSSARY.md`](../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Checked-in reference data that is the source of truth for Athena's Kiwoom API surface. The generator
reads these files; several are themselves generated and committed deterministically.

## Key Files
| File | Description |
|------|-------------|
| `kiwoom-tr-inventory.json` (~970 KB) | Master inventory of all 208 Kiwoom operations — primary generator input |
| `kiwoom-common-screen-manifest.json` (~630 KB) | Common-screen manifest for the Kiwoom screen-selection work |
| `kiwoom-output-profile.json` (~87 KB) | Generated response-shape profile: scalar-only / pure-list / compound classification, field/list/depth distributions, one-screen complexity policy |
| `response-projections.json` (~51 KB) | Canonical projection manifest covering every generated top-level response alias exactly once (facts groups ≤20 fields; LIST fields stay atomic table groups, UI page size 10) |
| `kiwoom-io-source-profile.json` | Source-side I/O profile metadata |
| `ka10007-detail-groups.json` | Detail-group definition for the `ka10007` operation |

## For AI Agents

### Working In This Directory
- `kiwoom-output-profile.json` and the generated docs are **outputs** of `scripts/generate_api.py` —
  regenerate them, never hand-patch.
- A change to `kiwoom-tr-inventory.json` changes the public API surface: rerun the generator and the
  full test suite, and expect large reviewable diffs under `athena_api/generated/`.
- Type-7 quantiles and Tukey fences in the output profile are descriptive statistics, **not**
  candidate gates. Pure-list responses are list/pagination UI concerns and are never selected for
  arbitrary field-split routes.
- These files are large; grep or load specific keys rather than reading them whole.

### Testing Requirements
`tests/test_common_screen_manifest.py`, `tests/test_io_docs.py`, and
`scripts/generate_api.py --check`.

## Dependencies

### Internal
- Consumed by `backend/scripts/generate_api.py`, `athena_api/generated/`, `athena_api/selector/catalog.py`

<!-- MANUAL: -->
