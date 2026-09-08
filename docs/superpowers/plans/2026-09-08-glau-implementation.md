# Glau implementation plan

**Goal:** Apply the approved Paper Glau mascot and five mode identities to the existing Athena UI.

**Design source:** Paper Athena file `01M0VGPX92K1TER4ZV9PWGQJJZ`, Glau page `C-2`; approved brown body, cream face, navy wings, olive leaves, ten expressions. Existing 22px composer and 76px orb footprints remain.

**Architecture:** Share one fixed SVG renderer between composer, deployment indicator and orb. Retain the existing orb state machine, gaze and blink variables, drag regions, badges and visibility policy. Mode icons use the existing navigation SVGs as the source for picker and session history.

**Constraints:** Preserve financial Kiwoom integration names and internal IDs. No changes to trading authorization, scheduling or mode behavior. Keep the ten existing uncommitted mode changes.

- [x] Implement shared Glau renderer and map the orb's existing expression states. Verify expression mapping, reduced motion, gaze, badges and drag/click behavior.
- [x] Mount Glau in composer and deployment indicator; replace user-visible mascot names. Add canonical mode icons to the existing picker and match Paper mode titles. Verify five modes and menu actions.
- [x] Synchronize Paper parity expectations; run relevant unit and Electron checks. Independently review the changes and inspect captured app screenshots before completion.

Validation: 3,929 unit tests passed; final agent-title adjustment rechecked with 145 passing tests. Electron Glau/mode/menu checks: 25 passed. Orb visibility and conversation probes passed. Independent code and screenshot review approved.
