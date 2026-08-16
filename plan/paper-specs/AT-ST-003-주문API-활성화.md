# 18 · AT-ST-003 주문 API 활성화

- Paper node: QP-0 | artboard "18 · AT-ST-003 주문 API 활성화"
- Screenshot (full artboard): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-QP-0-22696.jpg
- Screenshot (mockup area only): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-19D-0-36216.jpg

## 무엇을 하는 화면인가

계좌별로 AI가 이 계좌의 주문 API(매수·매도·정정·취소)를 호출할 수 있게
허용/해제하는 게이트 화면이다. 기본값은 OFF이고, 대상은 모의 계좌뿐이며,
켜더라도 자동매매나 AI 단독 실행은 열리지 않는다 — 실행은 언제나 대화 창의
명시적 지시가 있어야 한다. 두 조건(주문 API 허용 토글 + 로컬 인증 토큰
설정)이 모두 충족되어야 활성화 버튼으로 최종 확인할 수 있고, 언제든 OFF로
되돌리면 즉시 반영된다.

## 스펙 패널 전문

Meta 행:

| 라벨 | 값 |
|---|---|
| 화면 ID | AT-ST-003 |
| 화면 명 | 계좌 — 주문 API 활성화 |
| 위치 | 계좌 목록 › 주문 API |

Description 항목 (번호 · 제목 · 본문, 원문 그대로):

1. **열리는 것 · 열리지 않는 것**
   : 국내주식·신용·금현물 3계열 12개 TR이 열린다
   – 자동 매매·AI 단독 실행·실거래 계좌 접근은 열리지 않는다

2. **토글**
   : 체크박스나 별칭 재입력이 아니라 단일 토글로 켠다
   – 실수로 눌리는 경로를 없앤다. 최종 확인은 활성화 버튼이 한 번 더 한다

3. **활성화 조건**
   : 주문 API 허용 + 로컬 인증 토큰 모두 충족 시 활성화
   – 토큰은 OS 자격증명 저장소에만 있고 전송되지 않는다

4. **활성화 버튼**
   : 이 화면의 유일한 브랜드색 요소
   – 경고색을 주인공으로 쓰지 않는다. 실제 자산은 움직이지 않는다

5. **되돌리기**
   : 언제든 OFF로 되돌릴 수 있고 즉시 반영된다
   – 이 사실을 화면에 적어 공포를 줄인다

각주 (Description 목록 아래, 번호 없이):

- ※ prefers-reduced-motion 시 토글 전환 애니메이션을 생략한다

## 목업 구조

```
Mockup Area (19D-0, 1508×1080, bg #0A0B0E, two decorative gradient/glow
layers behind everything — presentational backdrop, not app chrome)
├── 헤더 텍스트 블록 (19G-0, absolute left 100 top 112, width 1000×101)
│   ├── Text "AT-ST-003" (19H-0)                         — kicker/eyebrow
│   ├── Text "주문 API 활성화" (19I-0)                    — title
│   └── Text "AI가 이 계좌의 주문 API를 호출할 수 있게
│       한다. 실행은 언제나 대화 창의 명시적 지시가 있어야
│       한다." (19J-0)                                    — subtitle/lede
├── 카드 · 주문 API 활성화 (19L-0, absolute left 100 top 300, 1308×592,
│   rounded-20 glass panel — THIS is the actual UI to implement)
│   ├── 카드 헤더 (19M-0, 1307×44, border-b)
│   │   ├── Frame (19N-0) — title group
│   │   │   ├── Text "주문 API 활성화" (19O-0)             — card title
│   │   │   └── Text "모의-주력" (19P-0)                   — account/alias tag
│   │   └── Frame (19Q-0) — status pill
│   │       └── Text "현재 OFF" (19R-0)                    — current state pill
│   ├── 열리는 것 · 열리지 않는 것 (2PA-0, 1307×244, border-b, 2-col split)
│   │   ├── 열리는 것 컬럼 (2PB-0, 611×179)
│   │   │   ├── Frame (2PC-0) — dot(warn) + label
│   │   │   │   └── Text "열리는 것 · 12건 · 모의 계좌 대상"
│   │   │   └── TR 계열 목록 (3계열x4동작) (2TX-0, 611×104)
│   │   │       ├── row "kt10000~10003" / "국내주식" / "매수 · 매도 · 정정 · 취소"
│   │   │       ├── row "kt10006~10009" / "신용주문" / "매수 · 매도 · 정정 · 취소"  ← visually brighter (see 레이아웃·스타일)
│   │   │       ├── row "kt50000~50003" / "금현물" / "매수 · 매도 · 정정 · 취소"
│   │   │       └── footnote "3계열 × 4동작 = 12건 — 신용주문 포함"
│   │   ├── 구분선 (2PS-0) — 1×179 vertical divider
│   │   └── 열리지 않는 것 컬럼 (2PT-0, 611×179)
│   │       ├── Text "열리지 않는 것" (2PU-0)              — column header
│   │       └── Frame (2PV-0, 611×148) — 3 stacked items:
│   │           ├── "자동 매매 없음" / "모든 주문은 대화 창에서 사용자가 직접 지시해야 실행된다"
│   │           ├── "AI 단독 실행 없음" / "제안은 AI가 하고, 실행 지시는 항상 사용자가 한다"
│   │           └── "실거래 계좌 접근 없음" / "이 API는 모의 계좌 밖으로 나가지 않는다"
│   ├── 토글 행 (2Q6-0, 1307×95, border-b)
│   │   ├── Frame (2Q7-0) — label + sub
│   │   │   ├── Text "AI가 이 계좌의 주문 API를 호출하도록 허용" (2Q8-0)
│   │   │   └── Text "OFF일 때는 어떤 주문 요청도 실행되지 않는다" (2Q9-0)
│   │   └── Frame (2QA-0, 44×24) — pill toggle track
│   │       └── Rectangle (2QB-0, 18×18) — thumb, positioned OFF (left)
│   ├── 활성화 조건 체크리스트 (2UD-0, 1307×76, bg #1D222C59)
│   │   ├── row (2UE-0) — dot(dim) + "주문 API 허용 (토글)"  ⟷ pill "OFF"
│   │   └── row (2UK-0) — dot(dim) + "로컬 인증 토큰 설정"    ⟷ pill "미설정"
│   ├── 버튼 행 (2QF-0, 1307×84, justify-end)
│   │   ├── button "취소" (2QG-0/2QH-0) — secondary/outline
│   │   └── button "활성화" (2QI-0/2QJ-0) — brand/primary, only brand-colored element
│   └── 되돌리기 안내 (2QK-0, 1307×48, border-t)
│       └── Text "언제든 설정에서 OFF로 되돌릴 수 있다. 되돌리면 즉시 반영된다." (2QL-0)
├── 콜아웃 1–5 (1FO-0…1FX-0, 24×24 red squares, digits "1"–"5") — spec-sheet
│   annotation badges pointing at: 1=열리는것·열리지않는것 split, 2=토글 행,
│   3=체크리스트, 4=버튼 행(활성화 버튼), 5=되돌리기 안내. NOT app UI.
└── 하단 스펙 스트립 (1G7-0, absolute left 100 top 900, 1308×64, border-t,
    4-up columns)
    ├── "기본값" / "OFF"
    ├── "대상" / "모의 계좌"
    ├── "자동 매매" / "없음"
    └── "되돌리기" / "즉시"

Spec Panel (1GY-0, 412×1080 — REQUIREMENTS TEXT, already captured verbatim
above, not app UI):
├── Panel title "계좌 — 주문 API 활성화" (1H0-0)
├── Meta rows (1H2-0): 화면 ID / 화면 명 / 위치
├── "Description" label (1HJ-0)
├── Description items 1–5 (1HL-0…1I9-0) + footnote (1IF-0)
└── Page number "18" (1IJ-0)
```

## 레이아웃 · 스타일

**Coordinate system**: all positions below are within Mockup Area (19D-0,
1508×1080, `bg-[#0A0B0E]`). Spacing values use a 4px unit (Tailwind arbitrary
values like `left-25`/`w-327` resolve to `25×4=100px`/`327×4=1308px`);
`get_computed_styles` on the card (19L-0) confirms `left: 100px`,
`top: 300px`, `width: 1308px` directly.

**헤더 텍스트 블록** (left 100, top 112, width 1000, `gap-2.75`/11px):
- Kicker "AT-ST-003": `font-mono`, `tracking-[0.2em]`, color `#FFFFFF6B`,
  `--text-label` (14px)/line-height 4.5 (18px).
- Title "주문 API 활성화": `font-title` (Daki Title), `tracking-[-0.02em]`,
  color `#F2F4F8`, 30px/line-height 9 (36px). (30px is a literal size, not
  the `--text-head` token which is 20px — this title is larger than that
  token.)
- Subtitle: `font-kr`, color `#FFFFFF8A`, `--text-body` (15px)/line-height
  6.25 (25px).

**카드 · 주문 API 활성화** (19L-0, left 100, top 300, width 1308, height 592):
- `border-radius: 20px`, `overflow: clip`.
- `box-shadow: #FFF0D61A 0px 0px 80px inset, #14100A85 0px 40px 90px` (warm
  inner glow + soft outer drop shadow) — computed style confirms this
  verbatim.
- `background-color: #171B24F0` (≈94%-opaque `--color-k-panel` #171B24).
- Border: top `1px solid #FFFDF86B` (bright warm hairline — a highlight,
  distinct from the other three sides), left/bottom/right `1px solid
  #2C3340` (= `--color-k-line`). Computed style confirms all four sides.

- **카드 헤더** (h-11/44px, `px-4.5`/18px, `bg-[#1D222C99]` = `--color-k-panel2`
  at 60% alpha, `border-b 1px solid #262C38`, flex row space-between):
  - Title "주문 API 활성화": `font-kr-bold` (Daki B), color `--color-k-text`
    (#E6E8EE), `--text-label` (14px)/4.5 (18px).
  - Tag "모의-주력": `font-mono`, color `--color-k-faint` (#6B7480), 12px/16px
    — an account/alias label, sitting right next to the card title.
  - Right pill "현재 OFF": h-5/20px, `px-2`/8px, `rounded-pill`,
    `bg-[#9AA2B11A]` (`--color-k-dim` at 10% alpha); text `font-kr`, color
    `--color-k-dim`, 11px/3.5 (14px).

- **열리는 것 · 열리지 않는 것** section (`py-8`/32px, `px-4.5`/18px,
  `gap-6`/24px, `border-b 1px solid #262C38`), two `grow` columns split by a
  1px `#262C38` vertical divider:
  - Left column ("열리는 것", `gap-3.5`/14px):
    - Header: `size-1.5`/6px dot `bg-warn` (`--color-warn` #FF9838) + label
      `font-kr-bold`, `tracking-[0.02em]`, color `--color-k-dim`,
      `--text-desc` (13px)/4.25 (17px): "열리는 것 · 12건 · 모의 계좌 대상".
    - TR list (`gap-2.5`/10px between rows, `items-baseline`, `gap-2.5`/10px
      within a row): TR-code column `font-mono w-24`(96px), color
      `--color-k-dim`, 11px/3.5(14px); series-name column `font-kr-bold
      w-16`(64px), `--text-label` (14px)/4.5(18px); actions column `font-kr`,
      12px/4.25(17px).
      - Row 1 (국내주식) and Row 3 (금현물): name color `--color-k-text`
        (#E6E8EE), actions color `--color-k-dim` (#9AA2B1) — the default,
        dimmer styling.
      - Row 2 (신용주문) is visually brighter than the other two: name color
        is the literal `#F2F4F8` (brighter than the `k-text` token) and
        actions color is `--color-k-text` (brighter than the other rows'
        `k-dim` actions). The spec panel text does not explain this
        emphasis; see Open questions.
    - Footnote (`pt-1`/4px): `font-kr`, color `--color-k-faint`, 11px/3.75
      (15px): "3계열 × 4동작 = 12건 — 신용주문 포함".
  - Right column ("열리지 않는 것", `gap-3.5`/14px):
    - Header: `font-kr-bold`, `tracking-[0.02em]`, color `--color-k-text`,
      `--text-desc` (13px)/17px: "열리지 않는 것" (no leading dot, unlike the
      left column's header).
    - 3 items (`gap-3.5`/14px between items, each `gap-0.75`/3px): title
      `font-kr-bold`, color `#F2F4F8`, `--text-body` (15px)/20px; description
      `font-kr`, color `--color-k-dim`, 12px/4.25(17px).

- **토글 행** (`py-7`/28px, `px-4.5`/18px, `gap-4`/16px, `border-b 1px solid
  #262C38`, flex row space-between):
  - Left (`gap-1`/4px): label `font-kr-bold`, color `--color-k-text`,
    `--text-label` (14px)/4.5(18px); sub `font-kr`, color `--color-k-faint`,
    12px/4(16px).
  - Right: toggle track `w-11 h-6`(44×24px), `p-0.5`(2px), `rounded-pill`,
    `bg-k-panel2` (#1D222C), `border 1px solid k-line` (#2C3340); thumb
    `w-4.5 h-4.5`(18×18px), `rounded-pill`, `bg-k-faint`. Thumb is positioned
    at the left edge of the track = OFF.

- **활성화 조건 체크리스트** (h-19/76px, `px-4.5`/18px, `gap-2`/8px,
  `bg-[#1D222C59]`; two rows, each `flex justify-between`):
  - Left of each row: `size-1.5`/6px dot `bg-k-dim` + label `font-kr`, color
    `--color-k-text`, `--text-desc` (13px)/4.5(18px): "주문 API 허용 (토글)"
    / "로컬 인증 토큰 설정". (Both dots are the same neutral `k-dim` color —
    not differentiated as "met" vs "unmet.")
  - Right of each row: status pill, h-5/20px `px-2`/8px `rounded-pill`
    `bg-[#9AA2B11A]`, text `font-kr` color `--color-k-dim` 11px/3.5(14px):
    "OFF" / "미설정" — same neutral pill style as the card-header "현재 OFF"
    pill, not a warning/error color even though these are blocking
    conditions.

- **버튼 행** (h-21/84px, `px-4.5`/18px, `gap-2.5`/10px, `justify-end`):
  - "취소": h-9.5/38px, `px-6`/24px, `rounded-[6px]`, `bg-k-panel2`, `border
    1px solid k-line`; label `font-kr-bold`, color `--color-k-dim`,
    `--text-desc` (13px)/4.25(17px).
  - "활성화": same box metrics, `bg-brand` (`--color-brand` #EE137B); label
    `font-kr-bold`, color white, `--text-desc` (13px)/4.25(17px). This is the
    only brand-pink element on the screen (per Description item 4). The
    screenshot shows it rendered at full brand-color strength even though
    neither checklist condition is met — no visually distinct
    disabled/inactive button state is shown (see Open questions).

- **되돌리기 안내** (h-12/48px, `px-4.5`/18px, `border-t 1px solid #262C38`):
  text `font-kr`, color `--color-k-dim`, 12px/4(16px).

**하단 스펙 스트립** (left 100, top 900, width 1308, `pt-5.5`/22px,
`border-top 1px solid #FFFFFF24`, 4 equal `grow` columns, `gap-1.75`/7px
each):
- Kicker: `font-kr`, `tracking-[0.14em]`, color `#FFFFFF5C`, 11px/3.5(14px).
- Value: `font-kr`, color `--color-k-text`, `--text-body` (15px)/5(20px).
- Columns: 기본값/OFF, 대상/모의 계좌, 자동 매매/없음, 되돌리기/즉시.

**Badges** (1FO-0…1FX-0, spec-sheet annotations, not app UI): 24×24px
squares, `bg-doc-red` (`--color-doc-red` #E60012), white `font-kr-bold`
`--text-label` (14px)/4.5(18px) digit.

**Tokens referenced** (from `get_tokens`): `--color-k-panel #171B24`,
`--color-k-panel2 #1D222C`, `--color-k-line #2C3340`, `--color-k-text
#E6E8EE`, `--color-k-dim #9AA2B1`, `--color-k-faint #6B7480`, `--color-brand
#EE137B`, `--color-warn #FF9838`, `--color-doc-red #E60012`, `--font-kr`,
`--font-kr-bold`, `--font-title`, `--font-mono`, `--text-desc 13px`,
`--text-label 14px`, `--text-body 15px`, `--radius-pill 999px`. (`--text-head`
20px exists as a token but is not used anywhere on this board — the 30px
title is a literal size.)

## 텍스트 · 라벨 전문

Reading order, mockup area only (Spec Panel text already captured verbatim
above under "스펙 패널 전문"):

1. "AT-ST-003" — kicker
2. "주문 API 활성화" — title
3. "AI가 이 계좌의 주문 API를 호출할 수 있게 한다. 실행은 언제나 대화 창의 명시적 지시가 있어야 한다." — subtitle
4. "주문 API 활성화" — card title
5. "모의-주력" — account/alias tag
6. "현재 OFF" — current-state pill
7. "열리는 것 · 12건 · 모의 계좌 대상" — left column header
8. "kt10000~10003" / "국내주식" / "매수 · 매도 · 정정 · 취소" — TR row 1
9. "kt10006~10009" / "신용주문" / "매수 · 매도 · 정정 · 취소" — TR row 2 (brighter)
10. "kt50000~50003" / "금현물" / "매수 · 매도 · 정정 · 취소" — TR row 3
11. "3계열 × 4동작 = 12건 — 신용주문 포함" — footnote
12. "열리지 않는 것" — right column header
13. "자동 매매 없음" / "모든 주문은 대화 창에서 사용자가 직접 지시해야 실행된다"
14. "AI 단독 실행 없음" / "제안은 AI가 하고, 실행 지시는 항상 사용자가 한다"
15. "실거래 계좌 접근 없음" / "이 API는 모의 계좌 밖으로 나가지 않는다"
16. "AI가 이 계좌의 주문 API를 호출하도록 허용" — toggle label
17. "OFF일 때는 어떤 주문 요청도 실행되지 않는다" — toggle sub-label
18. "주문 API 허용 (토글)" ⟷ "OFF" — checklist row 1
19. "로컬 인증 토큰 설정" ⟷ "미설정" — checklist row 2
20. "취소" — secondary button
21. "활성화" — primary/brand button
22. "언제든 설정에서 OFF로 되돌릴 수 있다. 되돌리면 즉시 반영된다." — footer note
23. "기본값" / "OFF" — spec strip col 1
24. "대상" / "모의 계좌" — spec strip col 2
25. "자동 매매" / "없음" — spec strip col 3
26. "되돌리기" / "즉시" — spec strip col 4
27. Badge digits "1"–"5" (five markers, positioned per the tree above)

## 상태 · 인터랙션

The board renders exactly **one visual state**: toggle OFF, both checklist
conditions unmet ("OFF" / "미설정"), 활성화 button nonetheless shown at full
brand-color strength. No hover/focus/pressed/loading/error/success state is
depicted anywhere on the board.

The spec panel text implies the following states/transitions that an
implementer must build even though only one is drawn:

- **토글 ON**: Description item 2 says a single toggle (not a checkbox or
  re-typed alias) turns the permission on; item 3 implies the "주문 API 허용
  (토글)" checklist row's pill should then read something other than "OFF"
  (design doesn't show the "on" copy/color — see Open questions).
- **로컬 인증 토큰 설정됨**: the second checklist row's "미설정" pill implies
  a "설정됨"-equivalent state once a local auth token exists, though again
  the design doesn't render it.
- **활성화 조건 충족 → 활성화 가능**: Description item 3 — "주문 API 허용 +
  로컬 인증 토큰 모두 충족 시 활성화." This implies the "활성화" button's
  enabled/disabled affordance is gated on both conditions, but the mockup
  shows the button in only one (enabled-looking) appearance regardless.
- **활성화 버튼 클릭 → 확인**: Description item 2's "최종 확인은 활성화
  버튼이 한 번 더 한다" implies clicking 활성화 is the final confirmation
  step (after the toggle already flipped it "logically" on) — no
  confirmation dialog/second step is drawn, so whether "활성화" is itself a
  confirm action or opens another step is not shown.
- **되돌리기(revert to OFF)**: Description item 5 / footer text — reverting
  to OFF applies immediately ("즉시 반영된다"). No screen state for "already
  active, offering to turn off" is drawn; only the OFF/pre-activation state
  exists on this board.
- **prefers-reduced-motion**: footnote under Description says the toggle's
  transition animation must be skipped under this OS/browser preference —
  an accessibility/motion requirement with no visual state to show.

## 데이터 계약

This screen gates AI-initiated order calls for one (mock) brokerage account.
Backend evidence found in `backend/athena_api/`:

- **주문 API 허용 (토글)** maps directly to `Settings.enable_order_api: bool
  = False` (`backend/athena_api/config.py:27`). This is a process-global
  runtime setting today (env var `ATHENA_ENABLE_ORDER_API` via
  `pydantic-settings`, prefix `ATHENA_`), not yet a per-account toggle — see
  Open questions re: the "모의-주력" account tag implying multiple accounts.
- **로컬 인증 토큰 설정** maps directly to `Settings.local_bearer_token:
  SecretStr | None = None` (`config.py:28`), normalized to `None` on blank
  input (`normalize_local_bearer_token`, `config.py:33-39`).
- **활성화 조건 = 두 값 모두 충족**: this is exactly the gate implemented in
  `require_order_kiwoom_client()` (`backend/athena_api/dependencies.py:43-54`):
  it raises `KiwoomNotReadyError` unless `settings.enable_order_api` is
  true **and** `settings.local_bearer_token is not None` **and** a ready
  `kiwoom_order_client` exists on `app.state`. The screen's checklist (both
  rows) and its gated "활성화" affordance are a direct UI mirror of this
  dependency's precondition.
- **열리는 것 · 12건 (kt10000~10003/10006~10009/50000~50003)**: verified
  against `backend/ref/kiwoom-tr-inventory.json` — `kt10000`–`kt10003` are
  "주식 매수/매도/정정/취소주문" (cat 국내주식, subcat 주문), `kt10006`–
  `kt10009` are "신용 매수/매도/정정/취소주문" (subcat 신용주문), `kt50000`–
  `kt50003` are "금현물 매수/매도/정정/취소주문" (subcat 주문). All 12 TR IDs
  and their Korean names match the design's list exactly.
- **실거래 계좌 접근 없음 / 대상 = 모의 계좌**: enforced at the config layer,
  not just copy — `Settings.kiwoom_base_url` defaults to
  `KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"`
  (`config.py:9,26`) and `validate_runtime_safety()` (`config.py:41-44`)
  **raises `ValueError`** if `kiwoom_base_url` is ever anything other than
  that mock domain. `KiwoomAuth.__init__` (`backend/athena_api/kiwoom/auth.py:41-50`)
  independently re-asserts the same check ("`KiwoomAuth only supports the
  mock domain`"). So the repo's mock-account-only rule is a hard backend
  invariant (two independent guard points), and this screen's "대상: 모의
  계좌" / "실거래 계좌 접근 없음" copy is an accurate reflection of that
  invariant — not aspirational UI copy.
- **취소 / 활성화 버튼 actions**: no dedicated "activate order API" endpoint
  or CLI subcommand was found under `backend/athena_mcp/__main__.py` or
  `backend/athena_api/`. The nearest existing mechanism is the
  `enable_order_api` / `local_bearer_token` settings fields themselves,
  which today are populated from environment/`.env` at process start, not
  from a runtime "activate" action a screen could call. **Gap**: there is no
  backend endpoint/CLI command this screen's "활성화" button can call to
  flip `enable_order_api` at runtime — implementing this button requires
  either (a) a new settings-mutation endpoint, or (b) writing to `.env` and
  requiring a restart, neither of which exists yet.
- **"토큰은 OS 자격증명 저장소에만 있고 전송되지 않는다"** (Description item
  3): **gap** — `local_bearer_token` is currently just a `pydantic-settings`
  `SecretStr` sourced from the `ATHENA_` env / `.env` file
  (`config.py:15-28`); no OS credential-store (Windows Credential
  Manager/DPAPI, keyring, etc.) integration was found anywhere in
  `backend/athena_api/`. This is the same category of gap flagged in the
  AT-ST-007 spec for Kiwoom app key/secret storage — the design's "OS
  자격증명 저장소" claim is not yet backed by code for this token either.
- **"모의-주력" account tag / "위치: 계좌 목록 › 주문 API"**: implies a
  multi-account list this screen is nested under, with per-account order-API
  state. No account-list or per-account-settings model was found in
  `backend/athena_api/` — `Settings` holds one global `kiwoom_app_key`/
  `kiwoom_secret_key`/`enable_order_api` triple, not a collection keyed by
  account. This is a structural gap between the design's implied
  information architecture and the current single-account backend model.

## Open questions

- **"활성화" button's disabled state is not drawn.** The board shows the
  button at full brand-pink strength even though neither checklist condition
  is met, and `require_order_kiwoom_client()` would reject the underlying
  action in this exact state. Should "활성화" be visually disabled/dimmed
  until both conditions are met, or does clicking it while unmet show an
  inline validation message instead? Design doesn't say.
- **No "ON" state is shown anywhere** — not for the toggle, not for the two
  checklist pills ("OFF"→? , "미설정"→?), not for the card-header "현재 OFF"
  pill, not for a "toggle already active, offer revert" variant of this
  screen. All copy/color for the "met condition" / "already active" states
  has to be inferred from the OFF-state pattern (same neutral
  `bg-[#9AA2B11A]` pill, presumably swapping only the text) rather than
  observed directly.
- **신용주문 (kt10006~10009) row is visually brighter** than the 국내주식 and
  금현물 rows (literal `#F2F4F8` name color + `k-text` actions color vs.
  `k-text` name + `k-dim` actions for the other two) — the spec panel text
  gives no reason for singling out the credit-order row. Possibly intentional
  (margin/credit trading carries more risk than cash or gold-spot), possibly
  a design inconsistency. Needs confirmation before treating it as an
  intentional per-row style rule vs. copying the same style to all three
  rows.
- **No backend "activate" action exists yet.** `enable_order_api` and
  `local_bearer_token` are process-start settings (env/`.env`-sourced), not
  something a running screen can currently flip via an API call. The
  implementer needs a decision on whether to add a new mutation endpoint,
  write-and-restart via `.env`, or something else — this file only maps the
  screen to the *read* side of the gate (`dependencies.py`), which already
  exists.
- **Single-account backend vs. "계좌 목록" IA.** The screen's "모의-주력" tag
  and "위치: 계좌 목록 › 주문 API" breadcrumb imply multiple named accounts,
  each with its own order-API activation state, but `Settings` in
  `config.py` is a single global object. Confirm whether "계좌 목록" is a
  future multi-account feature this screen anticipates, or whether "모의-주력"
  is just a static label with exactly one account in scope for now.
- **"OS 자격증명 저장소" claim for `local_bearer_token`** is not yet
  implemented (see 데이터 계약) — same open question already on record for
  AT-ST-007 regarding Kiwoom app key/secret; this board repeats the claim
  for a different secret with the same gap.
