# MCP built-ins protocol probe

Status: **READY_FOR INDEPENDENT REVIEW — NOT EXECUTED AGAINST THE REAL STDIO SERVER**

This probe starts Athena MCP only with a newly allocated absolute state directory and a newly allocated explicit registry path under `artifacts/market-session-audit/2026-09-07/mcp-builtins-probe/`. Relative inputs are rejected before resolution. The registry filename `mcp_servers.json` is rejected, all three state/registry/output paths must share one wholly absent run root while remaining distinct and absent, and paths outside the owned audit root are rejected. The user's default registry, consent store, logs, and canvas directory are never selected.

The child command is fixed to the repository backend virtual environment and the exact argument form `python -m athena_mcp --state-dir ABS_OWNED --registry ABS_OWNED_NEW serve`, with the backend directory as cwd. The child receives only standard Windows process-launch variables plus `PYTHONUTF8=1`; credential-shaped environment keys are not forwarded. Thirteen source files covering registry/consent/runner/CLI/server and all built-in definitions must match frozen SHA-256 values before the owned run directory is created or stdio is opened. A missing registry loads as an empty registry and an empty consent store has no approved providers, so this run authorizes zero provider processes.

The MCP SDK interaction is limited to `ClientSession.initialize()` followed by `ClientSession.list_tools()`. There is no `call_tool` branch. The SDK stdio and session async contexts own process shutdown; the report separately records entry and exit of both contexts and passes only when both exit. The probe does not enumerate or kill unrelated processes and does not retry the previously rejected recursive temporary-directory cleanup.

The expected protocol metadata is exactly 12 Athena built-ins, including `athena__render_canvas` and `athena__save_canvas`, with 58 action enum values across the current input schemas. Artifacts retain counts, boolean matches, and SHA-256 fingerprints of the sorted name set and name-plus-input-schema rows. Tool descriptions, schema bodies, registry contents, tool results, credentials, and provider output are not persisted.

`PASS_PROTOCOL_METADATA_ONLY` proves one isolated stdio initialize/list-tools exchange and owned SDK-context cleanup. It does not prove the user's running MCP registry, user consent state, provider connectivity, backend data, or any tool execution. The whole-day application audit remains `PARTIAL`.

After independent review, allocate a unique absent run directory and execute exactly once with absolute paths:

```powershell
& 'C:\Projects\DAOU.Athena\backend\.venv\Scripts\python.exe' 'C:\Projects\DAOU.Athena\scripts\market-session-audit\mcp-builtins-probe.py' --execute --state-dir 'C:\Projects\DAOU.Athena\artifacts\market-session-audit\2026-09-07\mcp-builtins-probe\RUN_ID\state' --registry 'C:\Projects\DAOU.Athena\artifacts\market-session-audit\2026-09-07\mcp-builtins-probe\RUN_ID\registry-new.json' --output 'C:\Projects\DAOU.Athena\artifacts\market-session-audit\2026-09-07\mcp-builtins-probe\RUN_ID\report.json'
```

Unit tests use injected async contexts and sessions. They assert the exact command and paths, initialize/list-only behavior, 12/2/58 fingerprints, fail-closed source and path checks, timeout cleanup, zero tool calls, and absence of descriptions/schema bodies in the report. They do not spawn the real stdio server.
