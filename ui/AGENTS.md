<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-16 | Updated: 2026-08-16 -->

# ui

> Terminology: [`GLOSSARY.md`](../GLOSSARY.md) is the standard vocabulary for this repo. Use its definitions; register new terms there before using them in code.

## Purpose
The design contract for Athena's interface: identity, color tokens, glass/effect rules, and the
outcome of design rounds. `app/` implements against these documents; they are specifications, not
inspiration notes.

## Key Files
| File | Description |
|------|-------------|
| `soul.md` | Core design principles. §8 "정보 정직성 — 숫자가 읽히는가?" is the rule that killed the residual-blur bug in `app/` |
| `DESIGN-SOUL.md` | Extended design-soul document |
| `palette.md` | Color tokens (`--color-k-*`), typography including tabular figures / `--font-mono`, light-background adaptation (not yet implemented) |
| `liquid-glass.md` | Liquid-glass surface treatment |
| `effects.md` | Motion and effect rules |
| `brand.md` | Brand definition |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `round-1R/` | **Current decision round.** `two-windows.md` is the E3 confirmed two-window spec `app/` implements; plus `answer.md`, `ranking.md` |
| `round-1/` | Superseded first round (`ranking.md`) |
| `moodboard/` | Reference imagery + `moodboard.md` + `참고url.txt` |
| `brand/` | Brand assets (`its-logo.jpg`) |
| `method/` | `화면기획서_양식.pdf` — screen-spec template |

## For AI Agents

### Working In This Directory
- `round-1R/two-windows.md` is the authoritative window spec; `round-1/` is history — don't cite it.
- **"창" is ambiguous — always say which.** `soul.md` §3 separates 상시 창 (대화 창 · 캔버스 창)
  from 일시 표면 (팝업창). The §8 elimination rule "상시 창이 셋 이상" counts persistent
  windows only. Full definitions live in `GLOSSARY.md` §1.
- **설정 모드 is not a window.** Pressing `#dot` turns the 대화 창 into settings in place — same
  grammar as 부팅 · 온보딩 · 인증. Never call it 설정창.
- **Neither window has a title bar.** `main.js:60` is `frame: false` and `chat.html` has no title-bar
  markup. Window control is `#grip` + OS shortcuts. `round-1R/two-windows.md:122` still lists the
  canvas title bar as unresolved — don't draw one without closing that question first.
- When a spec value cannot be implemented, record why in the implementing code and in `app/README.md`
  rather than silently dropping it (e.g. Electron `backgroundMaterial` exposes no runtime blur radius,
  so the "refraction 0.46→0.17" value is unimplementable as written).
- Palette changes must reach `app/styles/tokens.css`; the CSS custom properties are the shared surface.
- Accessibility is part of the contract, not an add-on: `prefers-reduced-transparency`,
  `prefers-contrast`, and `prefers-reduced-motion` all have implemented rules in `app/styles/access.css`.
- Documents are Korean.

### Testing Requirements
Design compliance is checked visually against `app/captures/*.png` produced by `npm run verify`,
including the three forced-accessibility captures (05–07).

## Dependencies

### Internal
- Implemented by `app/styles/tokens.css`, `app/styles/access.css`, `app/chat.css`, `app/canvas.css`

<!-- MANUAL: -->
