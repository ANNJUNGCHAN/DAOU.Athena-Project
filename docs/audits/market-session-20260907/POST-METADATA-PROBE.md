# POST metadata probe

Status: **INDEPENDENT REVIEW APPROVED; EXECUTED LIVE AT 13:08:02 KST, 2026-09-07**

The root rechecked branch `codex/market-session-audit-20260907`, revision `ac8452f5b62a338d74826ac27cf65da12d99320b`, owned app16660/backend30112→30248/watch27844 identities, and HTTP200 at `/health` and `/ready`, then executed the reviewed CLI once. `post-metadata-probe-20260907T040802-456Z.json` records `mode=loopback_live`, 2/2 attempted, both HTTP200 with `PASS_HTTP_JSON_SHAPE_ONLY`, metadata1/business2, and three network responses. This observes only these two metadata contracts. It does not execute a quote, render a card, or prove full response-model/data correctness. Script SHA-256 `4BF0DFB5CC1A526BA7AAFEF3C2BE34243B94A2FC49839D4D0D2675591A725FD9`; test SHA-256 `CA35869EC8BC30669E60A5859EA14D73597D5C63001DFD9AD4924A9145E84C54`; independent mock tests13/13 and syntax2/2 passed before execution.

This probe covers exactly two local selector metadata routes:

- `custom-api:POST:/api/v1/llm/tools/search` (`llm_search_operations`)
- `custom-api:POST:/api/v1/llm/tools/describe` (`llm_describe_operation`)

Both handlers delegate to the in-process selector catalog. Repository tests prove that search and describe complete without touching the Kiwoom upstream client. This probe does not call resolve, call, render-plan, orders, OAuth, WebSocket, or any other POST route.

Admission is fail-closed. `--execute` is mandatory; the base must be exactly `http://127.0.0.1:8010`; three source files must match their frozen SHA-256 values; runtime OpenAPI must expose both exact paths, methods, operation IDs, required JSON request `$ref` values, and 200-response JSON `$ref` values. Only after those checks does it send the two business requests. OpenAPI metadata uses the already-established 8 MiB ceiling because the current document is larger than 1 MiB. Each business response is capped at 1,000,000 bytes. Each request is capped at 5 seconds. The 20-second admission/request budget starts at function entry and includes asynchronous artifact reservation, source reads, credential-reader wait, and HTTP work. A synchronous event-loop block cannot be preempted in-process; once control returns, the expired deadline prevents every subsequent request. Redirects are errors.

The search payload is the source- and test-proven Korean query `삼성전자 오늘 주가 얼마야?` with `intent=query` and `limit=5`. The first returned candidate is eligible only when its kind is `query` and its operation ref matches the bounded canonical base/detail syntax. Describe receives that exact ref in memory. If no eligible result exists, describe is `BLOCKED`; no ref is invented.

Artifacts contain exact audit IDs, operation IDs, timestamps, market phase, `PASS_HTTP_JSON_SHAPE_ONLY` verdicts, transport adapter invocation counts, structural response digests, and candidate counts. The verdict means the OpenAPI `$ref` preflight passed, the HTTP body parsed as JSON, search exposed an eligible bounded query ref, and describe returned the same ref with `kind=query`. It is not full response-model validation. Each attempted route separately records whether a response was received and its HTTP status when available. Admission records `transport_responses_received` and `transport_response_received`, including rejected HTTP responses and an OpenAPI response that later fails preflight. Injected fetch executions are labeled `mode: in_memory_fixture`, so those response flags prove only that the adapter returned a response. Only `mode: loopback_live` can set `network_response_received`; adapter attempt counts never set it. Artifacts do not contain raw response bodies, query text, returned operation refs, tokens, or credential values. This evidence is not a claim that all product functions pass.

The independently reviewed command executed once was:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/market-session-audit/post-metadata-probe.mjs --execute
```

Tests cover wrong origin, missing explicit execution, source drift, runtime OpenAPI drift, redirect, authentication rejection, selection of the first eligible read-only result, rejection of untrusted/order results, empty eligibility, timeout, response-size bounds, and artifact redaction. The test command itself uses temporary directories and injected fetch functions, so it makes no live request.

The first version of the wrong-origin test used `http://localhost:8010` without a temporary `outputDir`. The shared observer validator accepted that loopback alias, so the test reached its injected bearer reader and injected fetch function before failing with `TRANSPORT_ERROR`; this created `artifacts/market-session-audit/2026-09-07/post-metadata-probe-20260907T033732-339Z.json`. This legacy marker predates the explicit fixture-mode field and is classified as `in_memory_fixture` by the exact authoring command and reproduced call path. Its `metadata_requests: 1` counts the injected adapter invocation, not a network transmission. No real credential was read, no real backend request occurred, and business requests remained zero. The probe now additionally requires the exact origin `http://127.0.0.1:8010`; every test supplies a unique temporary `outputDir`; and a regression test verifies the default audit artifact directory is unchanged by fixture execution. The marker is retained as investigation evidence. This marker provides no live evidence. The separately reviewed actual 13:08 execution is documented at the top and uses the distinct T040802-456Z artifact.
