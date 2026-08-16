<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# plan

> Terminology: [`GLOSSARY.md`](../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
The project's working memory. Current state, verified measurements, and next moves live here — this
is the first thing to read in a new session. Documents are Korean.

## Key Files
| File | Description |
|------|-------------|
| `plan.md` | **Entry point.** Current status, measured test results, per-area state table, next moves. Last updated 2026-08-15 |
| `00-인수인계.md` | Handoff: design rationale and the pitfall list. `plan.md` deliberately does not duplicate it |
| `mcp-실행계획.md` | MCP gateway execution plan — §2 decision B, §8 W0 measurements, §9 canvas rationale, §10 server selection |
| `mcp계획.txt` | Earlier raw MCP notes |
| `investment-brain-architecture.md` | Brain graph design |
| `investment-brain-progress-2026-08-15.md` | Brain progress snapshot |
| `kiwoom-common-screen-brief.md` | Common-screen brief |
| `kiwoom-common-screen-handoff.md` | Standalone entry point for the Kiwoom common-screen Ultragoal |
| `kiwoom-optimal-screen-selection-rendering-plan.md` | Optimal screen selection + rendering plan |
| `감시에이전트-실행계획.md` | Monitoring-agent execution plan (not yet built) |
| `2026-08-15-athena-progress-and-llm-selector.md` | Dated progress + selector snapshot |
| `canvas-taxonomy.md` | Canvas type taxonomy |
| `ultragoal-screen-state.json` | Machine state for the screen-selection Ultragoal |
| `Athena 프로젝트.txt`, `아테나 컨셉 및 추가 아이디어.txt`, `YC가 알려주는…스크립트.txt` | Source concept notes |

## For AI Agents

### Working In This Directory
- Read `plan.md` before touching code; read `00-인수인계.md` before making a design decision.
- `plan.md` records only *state / verified facts / next move*. Do not turn it into a design doc, and
  do not copy rationale into it from the handoff.
- Numbers here are measurements, not estimates (e.g. "429 passed, 0 failed"). If you update one,
  update it from an actual run and say when it was run.
- Update the `최종 갱신` date and branch line when you edit `plan.md`.
- Filenames are Korean and shell-escaped in git output; quote paths.

### Testing Requirements
No tests. The correctness check is whether the claims match a real run of the backend and app suites.

## Dependencies

### Internal
- Describes and is verified against `backend/`, `app/`, `spike/`, `ui/`

<!-- MANUAL: -->
