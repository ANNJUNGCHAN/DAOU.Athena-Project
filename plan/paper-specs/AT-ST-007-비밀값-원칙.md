# 22 · AT-ST-007 비밀값 원칙

- Paper node: QT-0 | artboard "22 · AT-ST-007 비밀값 원칙"
- Screenshot (full artboard): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-QT-0-9740.jpg
- Screenshot (mockup area only): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-1YH-0-36164.jpg

**This is a principles sheet, not a screen.** It does not describe a window, its
states, or its interactions. It states rules that constrain how *every other*
screen in the app handles secret values (API keys, app secrets, tool-call
arguments). There is nothing here to "build" as a UI — the artifact to
implement is the rule set itself, enforced across the onboarding/registration
screens, the aggregator, the consent gate, and the audit log.

## 무엇을 하는 화면인가

값(API 키·앱시크릿 등)은 입력 직후 메인 프로세스로 전달되어 OS 자격증명
저장소에 암호화되어 저장된다 — 화면(렌더러)은 비밀값을 어느 시점에도 갖지
않는다. 이 보드는 대상별(키움 앱키/시크릿, MCP env, MCP 실행 명령, 승인
기록, 감사 로그, 캔버스 저장물)로 저장 위치·화면 표시 범위·로그 포함 여부를
표로 못박고, "하지 않는 것" 4가지를 명시한다.

## 스펙 패널 전문

Meta 행:

| 라벨 | 값 |
|---|---|
| 화면 ID | AT-ST-007 |
| 화면 명 | 비밀값 저장 · 표시 원칙 |
| 위치 | 부록 |

Description 항목 (번호 · 제목 · 본문, 원문 그대로):

1. **데이터 흐름**
   : 값은 입력 즉시 메인 프로세스로 가고 OS 저장소에 암호화된다
   – 등록 화면 → 메인 프로세스 → DPAPI → 자식 프로세스 env 순서다

1.1. **렌더러 배제**
   : 화면(렌더러)은 비밀값을 한 번도 갖지 않는다
   – 스크린샷·DOM 덤프로도 새지 않는다

2. **규칙표**
   : 대상별로 저장 위치 / 화면 표시 범위 / 로그 포함 여부를 못박는다

2.1. **실행 명령은 예외**
   : MCP 실행 명령만 평문이고 전문 노출이다
   – 승인 판단의 근거이기 때문이다

3. **자식 프로세스 env**
   : 등록된 MCP 서버에 키를 넘기는 구간은 없앨 수 없다
   – 대신 승인 게이트가 "누구에게 넘길지"를 사람이 정하게 한다

4. **하지 않는 것**
   : 배포물 번들 · 하드코딩 · 렌더러 저장 · 마스킹 표시 모두 금지

각주 (Description 목록 아래, 번호 없이):

- ※ 등록 완료 후 화면 표시는 "등록됨 · 날짜"뿐이다 — 값의 일부도 표시하지 않는다
- ※ 입력 필드는 password 타입 — 붙여넣은 문자 수만 보조 표시한다

## 목업 구조

```
Mockup Area (1508×1080, dark background #0A0B0E, two soft radial glow layers)
├── Caption (absolute, left 25 top 28, width 250)
│   ├── Text "AT-ST-007"                         — kicker/eyebrow
│   ├── Text "비밀값 저장 · 표시 원칙"              — title
│   └── Text "값은 입력 직후 메인 프로세스로 전달되어 OS 자격증명 저장소에
│       암호화된다 — 화면(렌더러)은 비밀값을 한 번도 갖지 않는다."  — subtitle/lede
├── Rule Card (absolute, left 25 top 75, 1308×~676, rounded-20, glass panel)
│   └── Card Body (m-3 inset, rounded-6, bg #1D222CB8, border #262C38)
│       ├── Header row (h-11, border-b)
│       │   ├── Text "비밀값 저장 · 표시 규칙"       — card title (left)
│       │   └── Text "적용 범위 · 전체 화면"          — scope note (right)
│       ├── Section "데이터 흐름" (border-b)
│       │   ├── Label "데이터 흐름"
│       │   └── Flow row (5 nodes + 4 connectors, one dashed-divider before last node)
│       │       ├── Node "등록 화면 / 입력"           — solid box
│       │       ├── "→"
│       │       ├── Node "메인 프로세스"              — solid box
│       │       ├── "→"
│       │       ├── Node "OS 자격증명 저장소 / (DPAPI)" — solid box
│       │       ├── "→"
│       │       ├── Node "자식 프로세스 env / API 호출" — solid box, badge "3" beneath it
│       │       ├── (dashed vertical divider, not an arrow)
│       │       └── Node "렌더러(화면) / 도달 안 함"  — DASHED-border box, "×" pill badge
│       │           overlapping its top-left corner, badge "1.1" beneath it
│       ├── Section "대상별 규칙" (border-b, table)
│       │   ├── Header row: "대상" | "저장" | "화면 표시" | "로그"
│       │   ├── Row "키움 앱키/시크릿"   | DPAPI 암호화 | 등록 여부만        | 제외
│       │   ├── Row "MCP env(API 키)"   | DPAPI 암호화 | 키 이름만          | 제외
│       │   ├── Row "MCP 실행 명령"     | 레지스트리 평문 | 전문 노출        | 포함 (warn color)
│       │   ├── Row "승인 기록"         | 로컬 JSON     | 노출               | 포함 (warn color)
│       │   ├── Row "감사 로그"         | 로컬 JSONL    | 노출               | ts·별칭·툴·성공여부만
│       │   └── Row "캔버스 저장물"     | 로컬 JSON     | 노출               | 비밀값 미포함
│       └── Section "하지 않는 것" (no border-b, last section)
│           ├── Label "하지 않는 것"
│           └── Bullet list (4 items, each with a small dot marker)
│               ├── ".env 배포물에 포함 안 함"
│               ├── "코드에 하드코딩 안 함"
│               ├── "렌더러 localStorage에 안 씀"
│               └── "값 마스킹 표시조차 안 함"
├── Spec Strip (absolute, left 25 top 250, 1308×~64, top border, 4-up columns)
│   ├── Column "저장" (kicker) / "OS 자격증명 저장소" (value)
│   ├── Column "렌더러" (kicker) / "값 없음" (value)
│   ├── Column "로그" (kicker) / "비밀값 제외" (value)
│   └── Column "예외" (kicker) / "실행 명령 전문" (value)
└── Badges 1, 2, 3, 4, 1.1, 2.1 — red annotation markers pointing at the
    sections/cells above; these are spec-sheet callouts, not app UI.
```

Note: "Spec Strip" in the tree summary is realized in the JSX as the bottom
4-column summary row (저장/렌더러/로그/예외) directly below the Rule Card,
separated by a top border.

## 레이아웃 · 스타일

**Overall mockup canvas**: 1508×1080, `bg-[#0A0B0E]` (near-black), two absolutely
positioned decorative gradient/glow layers behind all content (linear gradient
top-left panel wash + a large soft radial glow) — presentational, not
functional chrome to replicate 1:1, but the dark surface + subtle glow is part
of the intended visual language for this "principles" documentation style.

**Caption block** (left 25, top 28, width 250, `gap-2.75` / 11px):
- Kicker "AT-ST-007": `font-mono`, `tracking-[0.2em]`, color `#FFFFFF6B`,
  `text-label` (14px) / line-height 4.5 (18px).
- Title "비밀값 저장 · 표시 원칙": `font-title` (Daki Title), `tracking-[-0.02em]`,
  color `#F2F4F8`, 30px / line-height 9 (36px).
- Subtitle: `font-kr`, color `#FFFFFF8A`, `text-body` (15px) / line-height 6.25
  (25px).

**Rule Card** (left 25, top 75, width 327 in the 8px-token grid → actual
computed `width: 1308px`, height ≈676px):
- `border-radius: 20px`, `overflow: clip`.
- `box-shadow: #FFF0D61A 0px 0px 80px inset, #14100A85 0px 40px 90px` (warm
  inner glow + soft outer drop shadow).
- `background-color: #171B24F0` (translucent panel over the glow backdrop).
- Border: top `1px solid #FFFDF86B` (bright warm hairline top edge — a
  highlight, distinct from the other three sides), left/bottom/right
  `1px solid #2C3340` (= token `--color-k-line`).
- Card Body (inset by `m-3` = 12px on all sides): `border-radius: 6px`,
  `background-color: #1D222CB8`, `border: 1px solid #262C38`.
- Header row: height 44px, `px-6` (24px), `border-b: 1px solid #262C38`,
  flex row space-between.
  - Card title "비밀값 저장 · 표시 규칙": `font-kr-bold` (Daki B), color
    `var(--color-k-text)` (#E6E8EE), `text-label` (14px)/4.5 (18px).
  - Scope note "적용 범위 · 전체 화면": `font-kr`, color `var(--color-k-faint)`
    (#6B7480), 12px/16px.
- "데이터 흐름" section: `pt-5 pb-6 px-6 gap-2` (20/24/24/8px), `border-b
  1px solid #262C38`.
  - Section label: `font-kr`, `tracking-[0.02em]`, color `var(--color-k-dim)`
    (#9AA2B1), `text-desc` (13px)/16px.
  - Flow nodes: fixed-height boxes (`h-16` = 64px), varying widths (180/170/
    230/230/196px), `rounded-[6px]`, `background: var(--color-k-panel2)`
    (#1D222C), `border: 1px solid var(--color-k-line)` (#2C3340), text
    centered, `font-kr`, color `var(--color-k-text)`, `text-desc` (13px)/18px.
  - Connectors "→": `font-mono`, color `var(--color-k-faint)`, 16px/20px,
    centered in a 28px-wide slot.
  - The 5th node ("렌더러(화면) / 도달 안 함") is visually different from the
    other 4: **dashed border** (`border-dashed border-[#3A4152]`, no fill —
    transparent/no `background-color` set, unlike the solid `k-panel2` fill
    of the other nodes), text color `var(--color-k-faint)` (dimmer than the
    other nodes' `k-text`), plus a small "도달 안 함" sub-line at 11px/14px.
    It is preceded by a vertical **dashed divider** (not a "→" arrow) —
    signaling "this path does not connect."
    An "×" pill badge (18×18px circle, `bg-k-panel`, `border 1px solid
    #454C59`) sits overlapping the box's top-left corner.
- "대상별 규칙" section: `py-3 px-6 gap-2` (12/24/8px), `border-b 1px solid
  #262C38`.
  - Header row: height 32px, `gap-4` (16px), `border-b 1px solid
    var(--color-k-line)`; 4 columns of fixed width (280/220/260/420px in the
    8px grid), `font-kr`, `tracking-[0.04em]`, color `var(--color-k-faint)`,
    12px/16px.
  - Data rows: height 32px each, `gap-4`, `border-b 1px solid #23262F`
    (last row has no border). Column 1 (대상 label) is `font-kr-bold`, color
    `var(--color-k-text)`, `text-desc` (13px)/18px. Columns 2–4 are `font-kr`,
    color `var(--color-k-dim)` by default — **except** the "로그" column value
    is `font-kr-bold`, color `var(--color-warn)` (#FF9838) for the "포함" cells
    (MCP 실행 명령 row, 승인 기록 row); all other cells (including "제외") stay
    the dim/default color.
- "하지 않는 것" section: `pt-3 pb-4 px-6 gap-2` (12/16/24/8px), no bottom
  border (last section in the card).
  - Section label same style as the other two section labels.
  - Bullet list, `gap-2` (8px) between items; each item is `flex items-start
    gap-2` with a `size-1` (4px) `rounded-pill` dot (`bg-k-faint`, offset
    `mt-1.75`) + text `font-kr`, color `var(--color-k-dim)`, `text-desc`
    (13px)/19px (`/4.75`).

**Spec Strip** (left 25, top 250 — i.e. directly under the Rule Card, width
1308px, computed `padding-top: 22px`, `border-top: 1px solid #FFFFFF24`):
- 4 equal-grow columns, each `gap-1.75` (7px):
  - Kicker: `font-kr`, `tracking-[0.14em]`, color `#FFFFFF5C`, 11px/14px
    (labels: 저장 / 렌더러 / 로그 / 예외).
  - Value: `font-kr`, color `var(--color-k-text)` (#E6E8EE), `text-body`
    (15px)/20px (values: OS 자격증명 저장소 / 값 없음 / 비밀값 제외 / 실행
    명령 전문).

**Badges** (spec-sheet annotations, not app UI): 24×24px (or 34×24 for
two-digit "1.1"/"2.1") squares, `background-color: var(--color-doc-red)`
(#E60012), white `font-kr-bold` `text-label` (14px)/18px digit, positioned to
point at: 1 = 데이터 흐름 section, 2 = 대상별 규칙 section, 3 = 자식 프로세스
env node, 1.1 = 렌더러(화면) node, 2.1 = MCP 실행 명령 row, 4 = 하지 않는 것
section.

**Tokens referenced** (from `get_tokens`): `--color-k-bg #10131A`,
`--color-k-panel #171B24`, `--color-k-panel2 #1D222C`, `--color-k-line
#2C3340`, `--color-k-text #E6E8EE`, `--color-k-dim #9AA2B1`, `--color-k-faint
#6B7480`, `--color-warn #FF9838`, `--font-kr`, `--font-kr-bold`,
`--font-title`, `--font-mono`, `--text-desc 13px`, `--text-label 14px`,
`--text-body 15px`, `--radius-sm 4px`, `--radius-pill 999px`.

## 텍스트 · 라벨 전문

Reading order, mockup area only (Spec Panel text is already captured verbatim
above under "스펙 패널 전문"):

1. "AT-ST-007" — kicker
2. "비밀값 저장 · 표시 원칙" — title
3. "값은 입력 직후 메인 프로세스로 전달되어 OS 자격증명 저장소에 암호화된다 — 화면(렌더러)은 비밀값을 한 번도 갖지 않는다." — subtitle
4. "비밀값 저장 · 표시 규칙" — rule card title
5. "적용 범위 · 전체 화면" — rule card scope note
6. "데이터 흐름" — section label
7. "등록 화면" / "입력" — flow node 1 (two lines)
8. "→"
9. "메인 프로세스" — flow node 2
10. "→"
11. "OS 자격증명 저장소" / "(DPAPI)" — flow node 3 (two lines)
12. "→"
13. "자식 프로세스 env" / "API 호출" — flow node 4 (two lines)
14. "3" — badge on node 4
15. "렌더러(화면)" / "도달 안 함" — flow node 5 (dashed, two lines)
16. "×" — pill badge on node 5
17. "1.1" — badge under node 5
18. "대상별 규칙" — section label
19. "대상" / "저장" / "화면 표시" / "로그" — table header
20. "키움 앱키/시크릿" / "DPAPI 암호화" / "등록 여부만" / "제외" — row 1
21. "MCP env(API 키)" / "DPAPI 암호화" / "키 이름만" / "제외" — row 2
22. "MCP 실행 명령" / "레지스트리 평문" / "전문 노출" / "포함" — row 3 (로그="포함" is warn-colored)
23. "승인 기록" / "로컬 JSON" / "노출" / "포함" — row 4 (로그="포함" is warn-colored)
24. "감사 로그" / "로컬 JSONL" / "노출" / "ts·별칭·툴·성공여부만" — row 5
25. "캔버스 저장물" / "로컬 JSON" / "노출" / "비밀값 미포함" — row 6
26. "하지 않는 것" — section label
27. ".env 배포물에 포함 안 함"
28. "코드에 하드코딩 안 함"
29. "렌더러 localStorage에 안 씀"
30. "값 마스킹 표시조차 안 함"
31. "저장" / "OS 자격증명 저장소" — spec strip col 1
32. "렌더러" / "값 없음" — spec strip col 2
33. "로그" / "비밀값 제외" — spec strip col 3
34. "예외" / "실행 명령 전문" — spec strip col 4
35. Badge digits "1", "2", "3", "1.1", "2.1", "4" (six markers total, positioned per the tree above)

## 상태 · 인터랙션

This board renders exactly **one state**: the static rule sheet. There is no
loading/empty/error/connected variant shown, and no interaction is depicted —
no hover, no click target, no form control (this is documentation, not a UI
surface with widgets).

The spec panel does, however, imply state-affecting rules for *other* screens
that consume this principle sheet:

- **Post-registration display state** (applies to registration/onboarding
  screens elsewhere): after a secret is registered, the screen must show only
  "등록됨 · <날짜>" — never any part of the value, not even masked
  (`***...`). This directly forbids a "show masked value" UI state that a
  naive implementation might add.
- **Input state** (applies to whatever screen collects the secret): the input
  field must be an HTML `password`-type control; the only permitted auxiliary
  feedback is a character-count indicator of what was pasted/typed — not the
  content.
- **Approval/consent gate state**: MCP 실행 명령 (the full literal command
  the child process will run) must be shown in full, unredacted, at the
  moment of approval — this is the one deliberate exception to "don't display
  secrets," justified because the approver needs the full command to judge
  what they're authorizing (rule 2.1 / 3).

## 데이터 계약

This board is a cross-cutting policy, not a single screen backed by one
endpoint. Below is each rule mapped to the concrete backend mechanism that
must satisfy it, per `backend/athena_mcp/`:

- **등록 화면 → 메인 프로세스 → OS 자격증명 저장소(DPAPI) → 자식 프로세스 env**
  (rule 1, 3): `backend/athena_mcp/registry.py` is the CRUD layer for
  `{command, args, env}` server entries, persisted to
  `~/.athena/mcp_servers.json` (`ATHENA_MCP_REGISTRY_PATH` overridable,
  default resolved in `default_registry_path()`, registry.py:189-192).
  `backend/athena_mcp/client.py:235-238` spawns the upstream MCP server via
  `StdioServerParameters(..., env=dict(self.entry.env) or None)` — confirming
  the "자식 프로세스 env" hop is real and unavoidable, matching Description
  item 3's "없앨 수 없다."
  **Gap**: `registry.py` as currently written persists `env` as **plain JSON**
  (`json.dumps(...)` at registry.py:216) with no DPAPI/OS-keychain encryption
  step. The design's "DPAPI 암호화" column for 키움 앱키/시크릿 and MCP
  env(API 키) is not yet implemented in the backend — this is a real
  discrepancy between design intent and current code, not just an
  unimplemented nice-to-have.
- **화면 표시 = 등록 여부만 / 키 이름만** (rule 대상별 규칙, cols 3): no
  screen code was located that renders secret values; `registry.py`'s
  `ServerEntry`/CRUD returns the full entry including `env` values to
  callers, so the "화면 표시" restriction (show only registration status or
  key *names*, never values) is a UI-layer responsibility that must be
  enforced by whatever screen renders registry data — the backend does not
  currently redact `env` values before returning `ServerEntry` objects.
- **MCP 실행 명령 = 레지스트리 평문 / 전문 노출 / 포함** (rule 2.1):
  `backend/athena_mcp/consent.py` implements the approval gate —
  `scan_risk_patterns(command, args, env)` (consent.py:72) and
  `ConsentStore`/`ConsentRecord` (consent.py:102-154), which is exactly the
  "승인 게이트가 사람이 정하게 한다" mechanism from Description 3. The
  consent flow's docstring (consent.py:12-13) confirms: "등록 시 실행 명령
  전문(자르지 않고) 노출 + 명시 승인 없이는 서버가 spawn되지 않는다."
- **승인 기록 = 로컬 JSON / 노출 / 포함**: `ConsentStore` persists
  `ConsentRecord` objects (`approved`, `approved_at`, `approved_tools`) as
  JSON via `to_dict()`/`from_dict()` (consent.py:106-128), matching "로컬
  JSON."
- **감사 로그 = 로컬 JSONL / 노출 / ts·별칭·툴·성공여부만**: `AuditLog`
  (consent.py:251-278) is an append-only JSON-Lines writer whose `record()`
  method writes exactly `{ts, alias, tool, success}` — verbatim match to the
  Description's "ts·별칭·툴·성공여부만." Its docstring explicitly states
  "인자와 응답 본문은 절대 로그에 남기지 않는다" (consent.py:254-256),
  confirming the no-argument/no-response-body rule.
- **캔버스 저장물 = 로컬 JSON / 노출 / 비밀값 미포함**:
  `backend/athena_mcp/canvas.py` defines canvas persistence/validation; no
  secret-bearing fields were found in its data model, consistent with the
  claim, though no explicit secret-scrubbing step was located either — this
  is "structurally doesn't include secrets" rather than "actively redacts
  them."
- **State-dir root**: `__main__.py:289-290` confirms `~/.athena` as the
  default root for "승인기록·로그·캔버스 저장 위치" and
  `~/.athena/mcp_servers.json` as the registry path — both overridable via
  `--state-dir` / `--registry` CLI flags (or `ATHENA_MCP_REGISTRY_PATH` env
  var per registry.py).
- **하지 않는 것** (rule 4 — no `.env` bundling, no hardcoding, no renderer
  `localStorage`, no masked display): these are prohibitions on the
  yet-to-be-built renderer/UI layer and packaging process; no renderer code
  exists yet in this backend-focused repo slice to verify compliance against,
  so this remains a constraint for the frontend implementer to honor rather
  than something checkable in `backend/athena_mcp/` today.

## Open questions

- **DPAPI encryption is not yet implemented.** The design states 키움
  앱키/시크릿 and MCP env(API 키) are "DPAPI 암호화" at rest, but
  `registry.py` currently writes `env` as plain JSON to
  `~/.athena/mcp_servers.json` with no encryption step. Someone needs to
  decide whether this spec is aspirational (a TODO for a future registry.py
  change) or whether DPAPI wrapping happens at a layer not yet found in this
  codebase slice.
  다시 확인 필요 - 검토 요망.
- **Who redacts `env` values before they reach a screen?** No renderer/UI
  code was found in this repo slice. The backend's `ServerEntry`/`registry`
  API returns full `env` dicts to any caller; the "화면 표시 = 키 이름만"
  rule must be enforced by a UI-layer projection that strips values, and it's
  not specified here whether that redaction should also happen at the API
  boundary (so a compromised renderer can't accidentally request the raw
  values) or is purely a client-side rendering choice. Given rule 1.1's
  "렌더러는 비밀값을 한 번도 갖지 않는다," this reads as an API-boundary
  requirement, not just a UI convention — worth confirming with whoever owns
  the eventual API/IPC layer between main process and renderer.
- **"레지스트리 평문" for MCP 실행 명령 vs. the JSON-file storage model.**
  The table says MCP 실행 명령's storage is "레지스트리 평문" (registry
  plaintext) while 키움 앱키/시크릿 and MCP env are "DPAPI 암호화" — but
  `command`/`args`/`env` are all fields of the same `ServerEntry` object
  persisted to the same `mcp_servers.json` file by the same `registry.py`
  code path. The design implies *field-level* differential encryption within
  one JSON record (encrypt `env`, leave `command`/`args` plaintext) which is
  a more granular scheme than "the whole registry file is encrypted" — this
  should be confirmed explicitly, since it's a real implementation detail
  (partial-record encryption) not spelled out beyond the table cell.
  다시 확인 필요 - 검토 요망.
- **This board's "위치: 부록"** (Meta row) confirms it's explicitly an
  appendix/reference sheet, not a screen in the app's navigation — consistent
  with treating it as a cross-cutting constraint document rather than
  something with its own route/window.
