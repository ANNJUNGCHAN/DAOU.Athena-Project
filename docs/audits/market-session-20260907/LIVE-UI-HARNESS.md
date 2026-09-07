# Live UI audit harness

`scripts/market-session-audit/live-ui.cjs` starts Athena through the normal `main.js` boot path against the exact existing profile supplied in `ATHENA_AUDIT_USERDATA`. It does not copy, seed, delete, or restore profile files. The runner must replace the audit-owned Electron process because it cannot attach to an existing Electron main process.

Normal application boot can itself migrate MCP environment data, flush history, project graph data, and schedule refresh/observer work. Those product-owned effects are outside this runner's control and carry `mutation_status: UNKNOWN_NOT_INSTRUMENTED`. The artifact observes their readiness task states; it does not claim that normal boot leaves the profile untouched.

The pass waits up to 120 seconds for the real boot window handoff. It inventories all five mode controls with connected/style/opacity/client-rect/bounds checks and verifies the exact current mode canvas plus hidden state of the other primary canvases.

It does not click the five mode controls. The product control handler calls `startNewConversation()` whenever the mode changes, which invokes `athena:conversations-new` and persists a conversation. Each row therefore records `BLOCKED_NAV_CREATES_HISTORY`. A separate isolated-profile lane is required for actual five-mode button traversal.

The four settings navigation controls are read-only within this audit scope and are clicked. Their known reads are recorded explicitly:

- `screen`: `athena:settings:prefs:get`
- `accounts`: `athena:account-list`
- `model`: `athena:model-get`, `athena:cli-list`
- `history`: `athena:brain-profile-summary`, `athena:brain-conversations-count`

The runner waits for each panel's settled and effectively visible DOM structure. That proves panel rendering only: each row records `BACKEND_READ_NOT_VERIFIED` because the product UI can render a title or fallback section after an IPC failure. It stores only aggregate row counts. Settings visibility and selection are restored in a guaranteed restoration block even when traversal throws.

Persisted evidence contains timestamps, process ID, control IDs, booleans, counts, fixed state values, and aggregate registry/model/token status. Account IDs, aliases, account numbers, model names, MCP aliases/commands, chat data, response bodies, freeform boot details, and screenshots are excluded. Boot failures retain task ID/state and fixed `BOOT_TASK_FAILED` only.

The direct read-only inspection allowlist is:

- `bootReadinessHandlers.get` with the live shell sender
- `settingsHandlers.accountList`, reduced to count, active-present boolean, and token-state counts
- `settingsHandlers.authTokenStatus`, reduced to aggregate token-state counts
- `settingsHandlers.modelGet`, reduced to configured booleans per provider
- `app/lib/main/mcp-cli.js:list`, reduced to aggregate counts

`settingsHandlers.mcpList` is excluded because its wrapper may migrate plaintext MCP environment values before listing. Runner actions do not call OAuth refresh/revoke, account registration/removal/activation, order toggles/calls, preference writes, MCP mutation/probe, graph mutation, fixture loading, or autostart bypass.

The supplied directory must already contain valid `athena-onboarding.json` and `athena-accounts.json` profile markers. A `.athena-verify-profile.json` marker is rejected. This prevents an arbitrary empty directory from being accepted and initialized as if it were the configured live profile.

Result fields are separate: boot readiness can `PASS` only when phase is `ready` and no readiness task is failed; current-mode visibility and settings traversal have their own results; full UI navigation remains false while the five mode clicks are blocked. Overall status is `BLOCKED` only when every observable check and restoration passes. Any observable failure produces `FAIL`. The 90 route, 96 card, and 10 mini-card live matrices remain `BLOCKED_NOT_IN_THIS_RUNNER` for their separate audit lanes.

Run from the repository root after the owner has identity-checked and stopped only the previous audit-owned Electron process:

```powershell
$env:ATHENA_AUDIT_USERDATA = 'C:\Users\ajc22\AppData\Roaming\athena-shell'
$env:ATHENA_ENABLE_ORDER_API = 'false'
$env:ATHENA_ROUTINES_ENABLED = 'false'
Remove-Item Env:ATHENA_NO_AUTOSTART -ErrorAction SilentlyContinue
Remove-Item Env:ATHENA_CANVAS_SOURCE -ErrorAction SilentlyContinue
& .\app\node_modules\.bin\electron.cmd .\scripts\market-session-audit\live-ui.cjs
```

The Electron process remains alive after the pass for continuous observation. Its unique artifact is written under `artifacts/market-session-audit/<KST-date>/live-ui-<UTC-time>-<pid>.json`.

Run the pure and static contract tests with:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test .\scripts\market-session-audit\live-ui-helpers.test.cjs .\scripts\market-session-audit\live-ui-source-contract.test.cjs
```
