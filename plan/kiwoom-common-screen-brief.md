# Athena Kiwoom Common Screen System

Build and verify the complete Athena operation-screen system in the actual `C:\Projects\DAOU.Athena` repository, preserving the repository's existing architecture, production assets, interaction patterns, and current UI visual language. Extend the existing Athena UI; do not create a parallel replacement application, alternate design system, or speculative redesign.

## Scope and coverage

- Establish a machine-readable canonical inventory of exactly 301 routable mappings:
  - 186 unsplit base operations.
  - 115 split-derived routes.
- Exclude exactly the 22 split-original query IDs from routable screen coverage. Preserve them in exclusion metadata with an explicit reason and tests proving they cannot re-enter the routable set.
- Classify the 301 mappings into exactly:
  - 264 read/display operations.
  - 23 WebSocket workflow mappings.
  - 12 order workflow mappings.
  - 2 OAuth workflow mappings.
- Treat 264 mappings as read/display screens rendered through the common canvas.
- Treat the 23 WebSocket, 12 order, and 2 OAuth mappings as guarded workflow states. They must have explicit status, event, action, error, and recovery behavior where applicable; they must not be misrepresented as ordinary query-result screens.
- Preserve authentication, authorization, account, and order safety boundaries. Use mocks, fixtures, Paper/simulation paths, or inert draft actions for verification. Never place a live order, weaken an authentication gate, expose credentials, or silently invoke an external side effect.

## Required product result

- Deliver one minimal shared canvas shell, consistent with Athena's actual UI, that supports:
  - facts/summary state,
  - table/list state,
  - event/stream state,
  - status/progress state,
  - guarded action/workflow state,
  - loading, empty, recoverable-error, unavailable, and permission/auth-required states.
- Generate schema and control hints from authoritative operation metadata wherever possible rather than maintaining duplicate handwritten mappings.
- Define and normalize stable `ScreenDefinition` and `ScreenDocument` contracts that describe route identity, operation identity, category, field mappings, layout/state hints, workflow guards, and rendering content without leaking transport-specific details into UI components.
- Integrate the normalized contracts through the existing Electron IPC and backend boundaries. Replace unsafe renderer privileges with a safe preload/context-isolation surface while preserving current interaction behavior.
- Produce a machine-readable coverage manifest that is the source of truth for all 301 routable mappings and the 22 excluded split-original query IDs.
- Add automated tests proving:
  - the inventory totals and category totals are exact,
  - the 22 excluded IDs are excluded and only those intended IDs are excluded,
  - every one of the 301 routable mappings resolves to a normalized screen/workflow definition,
  - every exposed response/data field maps to a documented presentation or workflow destination,
  - every route resolves through the intended Electron IPC/backend path,
  - guarded mappings retain their required workflow/auth/order protections,
  - no duplicate, orphaned, ambiguous, or silently unmapped route or field remains.
- Extend the existing Paper document/artboard set titled "Athena — 화면설계서" with representative and reusable artboards for the common canvas, read/display variants, WebSocket lifecycle, order safety workflow, OAuth lifecycle, and system/loading/empty/error states. Preserve its established visual system and artboard conventions.
- Produce a Markdown screen-planning document that explains the shared canvas, normalized contracts, state model, route/category coverage, control-generation rules, guarded workflows, design references, and verification evidence.
- Perform representative runtime verification in the real Electron application and visual verification against the Paper artboards. Capture evidence for read/display, WebSocket, order, OAuth, loading, empty, error, and guarded-action behavior.

## Architecture invariants

1. The canonical operation inventory and coverage manifest remain the single source of truth for route/category/exclusion accounting.
2. The totals remain exactly 301 routable mappings, composed of 186 unsplit base operations plus 115 split-derived routes; exactly 22 split-original query IDs remain excluded.
3. Classification remains exactly 264 read/display, 23 WebSocket, 12 order, and 2 OAuth mappings.
4. `ScreenDefinition` and `ScreenDocument` are normalized presentation contracts; transport/TR/WebSocket/OAuth implementation details remain behind existing backend and Electron IPC boundaries.
5. The renderer accesses backend capabilities only through a safe preload/IPC surface; no direct privileged renderer access is introduced.
6. One shared canvas and reusable state primitives cover the operation surface; operation-specific duplication is limited to genuinely distinct domain behavior.
7. Generated schema/control hints are deterministic and traceable to authoritative metadata, with explicit reviewed overrides only where generation is insufficient.
8. Authentication, authorization, account selection, order confirmation, and external-side-effect safeguards are preserved or strengthened.
9. Order verification is simulation-, mock-, fixture-, or draft-only. No live order is permitted.
10. Existing Athena visual language and the "Athena — 화면설계서" design artifact are extended rather than replaced.

## Quality gates and completion criteria

- Inventory/manifest validation proves all exact totals, category partitions, exclusions, uniqueness, and route reachability.
- Contract/schema validation proves every mapping and every exposed data field has a deterministic normalized destination.
- Targeted unit, contract, IPC, backend integration, and renderer tests pass.
- Relevant repository lint, typecheck, build, and test commands pass with no skipped/only/stub/TODO-based false evidence.
- Safety tests prove protected order, OAuth, authentication, and WebSocket transitions cannot bypass their guards.
- The development Electron runtime starts successfully and representative routes render through the real integration path.
- Paper artboards and Markdown planning documentation agree with the implemented contracts, state model, route counts, and actual UI.
- Visual review covers representative read/table/event/status/action plus loading, empty, error, auth-required, order-confirmation, and OAuth states.
- A changed-files cleanup pass is followed by fresh verification.
- An architecture-invariant audit supplies implementation, test, and independent-review evidence for every invariant.
- Independent code-reviewer recommendation is APPROVE and independent architect status is CLEAR before the aggregate Codex goal is marked complete.
- Stop only when every durable story is checkpointed complete, all 301 mappings and all exposed fields are proven covered, all 22 exclusions are proven intentional, runtime and visual evidence is recorded, and no safety or review blocker remains.

## Safe transition from the previous Ultragoal

- The previous `.omx/ultragoal` directory belongs to an unrelated unfinished Investment Brain run and must be archived before this plan is initialized.
- Preserve the complete previous directory plus its runtime state under a timestamped `.omx/archives/ultragoal-investment-brain-*` path.
- Verify the archive and its JSON files before running `create-goals --force`.
- Do not delete the archive. Record the transition in the new ledger.
