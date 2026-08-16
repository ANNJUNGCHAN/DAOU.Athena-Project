<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# athena_mcp

> Terminology: [`GLOSSARY.md`](../../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
Athena as an MCP **client and server** at once: connects to N user-registered upstream MCP servers
and re-exposes their aggregated tools under `alias__toolname` as a single MCP server, plus Athena's
own canvas tools. Sibling package to `athena_api`. Kiwoom TR exposure is explicitly out of v1 scope.

```
Claude Code CLI  ->  Athena Gateway (athena_mcp)  ->  N registered MCP servers
                          |
                          +-> athena__render_canvas / athena__save_canvas
```

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Module-by-module rationale, W0 spike measurements, scope boundaries |
| `SECURITY.md` | Threat model and the consent-gate contract |
| `registry.py` | Upstream `{command, args, env}` CRUD persisted to `~/.athena/mcp_servers.json`; Claude Desktop snippet parser; alias length rule (64-char limit → 28-char alias cap) |
| `client.py` | stdio upstream client (`mcp==1.28.x`): spawn (only past the consent gate) → initialize → list_tools → call_tool, health check, crash detection, exponential-backoff restart, per-server log file |
| `aggregator.py` | `alias__tool` namespacing; exposed name decoupled from upstream ID so renames don't break in-flight calls; 64-char second defense; keeps prior cache on refresh failure; progress-token/cancel remap hooks |
| `consent.py` | Consent gate — no spawn without approval, risky-pattern warnings, per-tool allowlist, audit log with no argument or response bodies |
| `result.py` | `CallToolResult` parsing, 4-step priority: `isError` → `structuredContent` → `content[0].text` json.loads → plain text; unsupported blocks error explicitly |
| `quirks.py` | Per-server known-defect compensation — measured W0/W0.9 findings only, no guesses |
| `canvas.py` | Canvas contract schemas for `athena__render_canvas` / `athena__save_canvas` |
| `stream.py` | Streaming/notification plumbing |
| `server.py` | Exposes Athena as one MCP server |

## For AI Agents

### Working In This Directory
- **The consent gate is the security core.** A server is never spawned without explicit approval, and
  audit log lines must never contain tool arguments or response bodies.
- `quirks.py` accepts only behavior confirmed by a recorded spike measurement. Speculative
  workarounds are forbidden — cite the capture in `spike/captures/`.
- Keep the exposed tool name separate from the upstream tool ID; in-flight calls must survive a rename.
- Tool names must fit 64 characters end to end — the 28-char alias cap in `registry.py` is derived
  from that, so changing one requires changing the other.
- Result parsing order is fixed by W0 S2 measurements; do not reorder the four steps.
- Docstrings and README here are Korean. Match that when editing.

### Testing Requirements
`backend/tests/mcp/` — `test_registry.py`, `test_mcp_client.py`, `test_result.py`,
`test_aggregator.py`, `test_consent.py`, `test_quirks.py`, `test_canvas.py`, `test_stream.py`,
`test_server.py`, against `tests/mcp/fixtures/fake_server.py`.

### Common Patterns
- Fail closed and fail loud: unknown content blocks raise rather than degrade silently.
- Cache-on-failure: a failed tool-list refresh keeps the previous good cache instead of emptying it.

## Dependencies

### Internal
- `plan/mcp-실행계획.md` (§2 decision B, §8 W0 measurements, §9 canvas rationale, §10 server choice)
- `spike/mcp-client/`, `spike/captures/` — the measurement record this package encodes

### External
- mcp 1.28.*

<!-- MANUAL: -->
