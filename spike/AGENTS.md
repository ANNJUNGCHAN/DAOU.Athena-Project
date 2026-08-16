<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# spike

## Purpose
Throwaway experiments kept for their **evidence**. Each spike directory holds runnable probe scripts
plus a `RESULT.md` recording what was actually measured; raw responses land in `captures/`. Production
code cites these captures instead of guessing at upstream behavior.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `mcp-client/` | W0 S2 MCP probes: `everything`, drfirst, jjlabsio, pykrx, DART, Naver; structured content, error shapes, namespacing, credentials, streaming. `RESULT.md` + three `CAPTURE-S2B-*.md` |
| `dart-survey/` | Six-step DART MCP survey: tools, calls, attachment extraction, HWP, financials, large markdown |
| `krx-probe/` | KRX auth probe, pykrx coverage, raw endpoint probe |
| `electron-glass/` | Two-window acrylic/glass Electron spikes (`v1`–`v3`), alignment/scale/z-order checks, PowerShell capture script — the source `app/` was ported from |
| `stream-adapter/` | `adapter.py` sanitize prototype (strip_tags → unescape_entities) + tests; defines the rendering contract `app/lib/sanitize.js` ports |
| `cli-pipe/` | Clean-room `.mcp.json` CLI piping experiment |
| `captures/` | Raw JSON/NDJSON/stderr artifacts from every spike run |

## For AI Agents

### Working In This Directory
- **Captures are evidence — do not edit or regenerate them casually.** `app/` and `backend/athena_mcp/`
  read and cite them; a rewritten capture invalidates downstream claims.
- Known capture limitation: `DARTSURVEY-chrisryugj-download_document-SAME-AS-jjlabsio-SMALL-markdown.json`
  stored only a 2000-char preview field (`content0_text_head`), not the full `content_len:2447` body.
  `app/data/reader-mock.md` is the recovered 1,759-char excerpt and is truncated by design.
- Spike code is not production code. Don't import it into `backend/` or `app/`; port it deliberately
  and record what changed (see `app/README.md`).
- `RESULT.md` files record failures and partial passes as well as successes. Keep that.
- This tree measures a shared desktop; frame-timing numbers vary run to run — that variance is
  documented, not a bug to "fix" by rerunning until green.

### Testing Requirements
Probes are standalone scripts run by hand (Python for MCP/KRX/DART, `electron`/`node` for
electron-glass). `stream-adapter/test_adapter.py` is the one pytest module; its recorded output is in
`pytest_output.txt`.

## Dependencies

### Internal
- Consumed by `app/lib/mockdata.js`, `app/lib/sanitize.js`, `backend/athena_mcp/quirks.py` and `result.py`

### External
- mcp (Python), electron, pykrx

<!-- MANUAL: -->
