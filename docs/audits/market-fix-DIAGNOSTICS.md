# 2026-09-07 current main Paper diagnostics

- Worktree: `C:\Projects\DAOU.Athena-fix-DIAGNOSTICS`
- Branch: `codex/market-fix-DIAGNOSTICS`
- Revision: `53055acb5504b703a02719efb903689d5a49b490`
- Measured: 2026-09-07 16:39-16:49 KST
- Scope: fixture/static gates only. No production backend, account, OAuth, order, outbound provider, or user-process control was used.

## Card gate

Command: `npm run verify:paper-cards-all`

The static board assertions reported 96/96 boards passing S1-S4 and S6, but the overall static gate failed because S5 (`python scripts/paper_board_extract.py --check`) reported `index.json` drift. The mount layer was therefore run directly with `npm run verify:paper-cards-mount` under its private profile and HTTP-blocking fixture.

Mount result: 96 measured, 94 pass, 2 fail.

| Board | Current failure | Comparison with audit baseline |
|---|---|---|
| `137X-2` | All four widths: state boards expected 7, DOM 6; text multiset mismatches including duplicated units/labels | Still failing; the earlier 95/96 mount result already identified this board |
| `2R3M-1` | All four widths: text multiset mismatches including duplicated units/labels | New current-main failure relative to the earlier 95/96 result |

The duplicated text has a direct current-main source candidate. Commit `1469f40` changed `app/lib/board-format.js::formatSlot()` so a preformatted `raw.text` is passed through `applyAffixes()`. These contracts already carry the complete Paper text while their format also carries prefixes or suffixes, producing values such as `150,850원원`, `21.2배배`, and repeated labels. The existing test still says preformatted text must be used as-is, but it does not cover a preformatted value whose format has affixes. The narrow product fix is to restore the authored-text bypass and add that missing regression case; changing the generated Paper text or weakening the mount comparison would hide the formatter regression.

Evidence: `app/captures/paper-gates/PAPER-CARDS.json`, SHA-256 `72E5F230FC1A5C91DC465B3EEFAC3385710D7778CD64B665BD9A8C3A05121DEC`.

## Screen and contract gate

Command: `npm run verify:paper-screens`

Result: 109 boards, 99 pass, 10 fail; route missing 4; contract failures 2/14. The ratchet reports four regressions.

| Category | Boards | Current result |
|---|---|---|
| Ratchet regressions | `25Q-0`, `G5B-0`, `4TY-0`, `DO-0` | structure/phrase assertions fail |
| Route missing | `3KM-0`, `3W9B-1`, `2I7Z-2`, `2GZM-2` | no executable fixture route |
| Contract sentence missing | `1XA2-0`, `2DZE-0` | unchanged `contract_no_sentence` |
| Earlier failures now passing | `2QCN-2`, `2FR9-2` | current gate passes |

The earlier five route gaps are reduced to four because `2QCN-2` now has a working route. The earlier `2FR9-2` backtest flow assertions also pass. These improvements coexist with four newly observed ratchet regressions, so the current gate is not healthier as a whole.

Evidence: `app/captures/paper-gates/PAPER-SCREENS.json`, SHA-256 `D517BCD26ECF0705D00CBB448FFD94638A3D4F96D4F99062C60E054E0E22EF57`.

## Mini-card gate

Only `npm run verify:paper-mini-static` was executed. Result: 192 boards, 96 ledger rows, 19 matching and 77 divergent; 212 divergent rows and 94 annotation drifts. This matches the earlier aggregate counts and does not prove live rendering failure.

Evidence: `app/captures/paper-gates/PAPER-MINI.json`, SHA-256 `F5611B32416FAB3CED74BB56B57B8C79AE914DB1F28A760C05EB393A9F572445`.

`verify:paper-mini-template` was not executed from current main. Its probe requires `main.js` without setting `ATHENA_NO_AUTOSTART`, waits for the normal boot handoff, and lacks an explicit HTTP/network block. In a shared machine this can contact or spawn the production backend. The gate remains blocked until the fixture-only readiness path is wired and the safety contract is independently reviewed.

After that safety repair was implemented and independently approved in `C:\Projects\DAOU.Athena-fix-HARNESS-MINI-001`, the corrected Electron gate was run once. The private-profile log confirms `ATHENA_NO_AUTOSTART=1`, fixture readiness reached `ready`, and the boot-to-shell handoff completed. The post-handoff probe still failed: 0/11 templates rendered and 0/10 grammars covered, with all 11 rows reported as `mount_failed` after 51,226 ms. No screenshot exists because this probe has no image capture path. The process exited with code 1 and an exact worktree command-line scan found no residual Electron, Node, or fake-Claude process. This narrows `HARNESS-MINI-001` to the orb submit/provider transcript path and remains fixture evidence only.

Corrected-run evidence: `C:\Projects\DAOU.Athena-fix-HARNESS-MINI-001\app\captures\paper-gates\PAPER-MINI.json`, SHA-256 `1DDC361ED28755E98E363FC8A22992B4EC1ABB9E51CC9D77530BCB9F57193808`; private `main-debug.log`, SHA-256 `79505F89BD09E8A6E55648D5329B1B0179B2391CE35060886025FDAB80AD6552`.

## Product-lane disposition

- `CARD-001` remains reproducible on `137X-2`; current main also adds a `2R3M-1` mount mismatch.
- `SCREEN-003` (`2QCN-2`) and `SCREEN-006` (`2FR9-2`) no longer reproduce in this current-main fixture gate.
- `SCREEN-001`, `SCREEN-002`, `SCREEN-004`, and `SCREEN-005` remain route gaps.
- Four current-main screen ratchet regressions require separate source ownership before product edits.
- `CONTRACT-001` and `CONTRACT-002` remain reproducible.
- `MINI-001` remains unchanged at the aggregate level.
- `HARNESS-MINI-001` remains a verification blocker; the unsafe runtime gate was deliberately not launched.
