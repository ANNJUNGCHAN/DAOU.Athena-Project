# 21 · AT-ST-006 MCP probe·툴

- Paper node: QS-0 | artboard "21 · AT-ST-006 MCP probe·툴"
- Screenshot (full artboard): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-QS-0-7644.jpg
- Screenshot (mockup window only): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-2D5-0-12480.jpg

## 무엇을 하는 화면인가

승인된(approve된) MCP 서버를 1회 연결(probe)해서 알아낸 것 — protocolVersion, 자가보고 name/version, 발견된 툴 목록과 각 툴의 합성 이름 길이/설명 — 을 보여주고, 사용자가 툴을 체크박스로 개별 허용(allow)하는 화면이다. "전체 허용"이 기본값이 아니며, 합성 이름(별칭__툴명)이 64자를 넘는 툴은 노출/허용 자체가 불가능하다. 인코딩 스모크 스캔(수동적, 호출 없음)은 매번 수행되고, 능동 probe(툴을 실제로 한 번 호출하는 검사)는 allowlist에 있거나 명시적으로 강제해야 하며 어느 쪽이든 감사 로그에 남는다는 규칙을 각주로 명시한다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-ST-006
- 화면 명: MCP 등록 — probe · 툴 허용
- 위치: MCP 목록 › probe

**Description**
1. probe 요약
   : 1회 연결로 알아낸 것 — protocolVersion · 자가보고 name/version · 발견 툴 수
   – protocolVersion은 서버마다 다르므로 그대로 기록한다
1.1. 자가보고 경고
   : serverInfo의 name·version은 신뢰하지 않고 표시만 한다
   – 실제 서버 정체와 다른 사례가 실측됐다
2. 툴 목록
   : 발견한 툴을 체크박스로 개별 허용한다
   – "전체 허용"이 기본값이 아니다
2.1. 합성 이름 길이
   : 별칭__툴명 조합이 64자를 넘으면 노출할 수 없다
   – 조용히 자르지 않고 스킵 사유를 표시한다
2.2. 64자 초과
   : 체크 자체가 비활성화된다
   – 별칭을 더 짧게 rename하면 살릴 수 있다
3. 인코딩 스모크
   : 툴 이름·설명의 U+FFFD 수동 스캔은 항상 수행한다
   – 호출 없음, 부작용 없음
3.1. 능동 probe
   : 툴을 실제로 한 번 부르는 검사
   – allowlist에 있거나 명시적으로 강제해야 하며, 감사 로그에 남는다
4. 선택 허용
   : 주 액션 — 허용한 툴만 CLI에 노출된다
   – 화면 내 유일한 브랜드 색 요소

**각주 (번호 없는 하단 노트)**
- ※ 예시 값은 pykrx-mcp 실측(8개 중 5개 발췌). 유리 접근성 3종은 대화 창과 동일하게 적용
- ※ 64자 초과 툴의 rename 자동 제안은 2차 범위 — 1차는 표시만

## 목업 구조

`Mockup Area` (20Z-0, 1508×1080)는 아래 형제 4묶음으로 구성된다. `Desktop`(210-0)/`Glow`(211-0) 배경과 8개 번호 배지(`Badge 1`…`Badge 4`, `2FA-0`~`2FO-0`)는 스펙 시트 주석이므로 구현 대상이 아니다. `Caption`(212-0)과 `Spec Strip`(2FQ-0)도 스펙 패널 내용을 그대로 반복하는 주석 텍스트로 보이며, 실제 앱 UI는 `Probe Result Window`(2D5-0) 하나다 — 자세한 근거·의문은 "Open questions" 참고.

```
Probe Result Window (2D5-0) 1308×467          # 구현 대상 — probe 결과 카드
  Frame (2D6-0) 1275×433                       # 내부 콘텐츠 패널 (m-4=16px 인셋)
    Frame — 헤더 행 (2D7-0) 1273×44
      Frame — 좌측 그룹 (2D8-0) 312×18            # "probe 결과" · protocolVersion · 툴 개수
      Frame — 우측 그룹 (2DC-0) 93×30              # 서버 자가보고 name/version · 신뢰 금지 문구
    Frame — 컬럼 헤더 행 (2DF-0) 1273×32
      Rectangle — 체크박스 스페이서 (2DG-0) 16×0
      Text "툴 이름" (2DH-0) 300×14
      Text "길이" (2DI-0) 56×14
      Text "설명 요약" (2DJ-0) 411×14
      Text "허용" (2DK-0) 411×14 (우측 정렬)
    Frame — 행 1: get_stock_ohlcv, 허용됨 (2DL-0) 1273×44
      Frame — 체크박스(checked) (2DM-0) 16×16
      Frame — 툴 이름 (2DO-0) 300×17
      Text "22자" (2DQ-0) 56×16
      Text 설명 (2DR-0) 411×16
      Frame — 허용 상태 pill (2DS-0) 411×20
    Frame — 행 2: get_market_ticker_name, 허용됨 (2DV-0) 1273×44   # 구조 동일
    Frame — 행 3: get_market_ticker_list, 미허용 (2E5-0) 1273×44
      Rectangle — 체크박스(unchecked) (2E6-0) 16×16
      Frame — 툴 이름 (2E7-0) 300×17
      Text "29자" (2E9-0) 56×16
      Text 설명 (2EA-0) 411×16
      Frame — 미허용 pill (2EB-0) 411×20
    Frame — 행 4: get_market_fundamental_by_date, 미허용 (2EE-0) 1273×44   # 구조 동일 (행3과)
    Frame — 행 5: datalab_shopping_..., 64자 초과/비활성 (2EN-0) 1273×44
      Frame — 체크박스(disabled, "–") (2EO-0) 16×16
      Frame — 툴 이름(디밍) (2EQ-0) 300×17
      Text "86자" (2ES-0) 56×16
      Text 설명(디밍) (2ET-0) 411×16
      Frame — "64자 초과 — 노출 불가" 경고 텍스트 (2EU-0) 411×14   # pill 없음
    Frame — 상태 노트 블록 (2EW-0) 1273×80
      Frame — 노트 A: 인코딩 스모크 통과 (2EX-0) 1241×16
      Frame — 노트 B: 능동 probe 규칙 (2F0-0) 1241×16
    Frame — 푸터 행 (2F3-0) 1273×56
      Text "2개 선택됨 · 8개 중" (2F4-0) 105×16
      Frame — 버튼 그룹 (2F5-0) 187×32              # "전체 허용" + "선택 허용"

[참고, 구현 대상 아님으로 추정 — Open questions 참고]
Caption (212-0) 1000×101                        # AT-ST-006 / 타이틀 / 설명 3줄
Spec Strip (2FQ-0) 1308×64                       # 연결·기본값·64자·능동 probe 4열 요약
Badge 1…4 (2FA-0, 2FC-0, 2FE-0, 2FG-0, 2FI-0, 2FK-0, 2FM-0, 2FO-0)  # 번호 배지, 스펙 패널 항목 연결용
```

## 레이아웃 · 스타일

**Probe Result Window (2D5-0)** — 1308×467, `position: absolute`.
- 배경: `#171B24F0` (--color-k-panel `#171B24` @ ~94% 불투명)
- 테두리: 상단 1px `#FFFDF86B`(웜화이트 @ ~42%, 하이라이트용 논토큰 색), 좌/하/우 1px `#2C3340`(--color-k-line)
- radius: 20px (임의값, --radius-sm/--radius-pill 토큰 아님)
- box-shadow: `#FFF0D61A 0 0 80px inset` (인셋 글로우, 논토큰), `#14100A85 0 40px 90px` (드롭 섀도)
- overflow: clip

**내부 콘텐츠 패널 (2D6-0)** — 1275×433, window 안에서 `margin: 16px` 인셋.
- 배경: `#1D222CB8` (--color-k-panel2 `#1D222C` @ ~72%)
- 테두리: 1px solid `#262C38` (k-line에 가깝지만 별도 값)
- radius: 6px
- display: flex column

**헤더 행 (2D7-0)** — 1273×44, `padding-x: 16px`, `border-bottom: 1px solid #262C38`.
- 좌측 그룹 (`gap: 12px`, flex row):
  - "probe 결과" — font-kr-bold(--font-kr-bold `Daki B, sans-serif`), color `var(--color-k-text)` `#E6E8EE`, `var(--text-label)` 14px / line-height 18px
  - "protocolVersion 2025-11-25" — font-mono(--font-mono `Geist Mono, monospace`), color `var(--color-k-faint)` `#6B7480`, 12px / 16px
  - "툴 8개 발견" — 동일 스타일 (font-mono, k-faint, 12px/16px)
- 우측 그룹 (flex column, items-end, `gap: 2px`):
  - "pykrx-mcp v0.3.1" — font-mono, color `#C9CDD6` (논토큰, k-dim보다 밝음), 12px / 15px
  - "자가보고 · 신뢰 금지" — font-kr(--font-kr `Daki, sans-serif`), color `var(--color-k-faint)`, 10px / 13px

**컬럼 헤더 행 (2DF-0)** — 1273×32, `padding-x: 16px`, `gap: 12px`, `border-bottom: 1px solid #262C38`.
- 체크박스 자리(16px 스페이서, 빈 칸)
- "툴 이름"(w:300px), "길이"(w:56px), "설명 요약"(grow), "허용"(grow, 우측 정렬) — 전부 font-kr, `letter-spacing: 0.08em`, color `var(--color-k-faint)`, 11px / 14px

**데이터 행 (공통, 각 1273×44, `padding-x: 16px`, `gap: 12px`, `border-bottom: 1px solid #21262F`)**
- 체크박스 16×16, `border-radius: 2px`
  - checked: 배경 `var(--color-ok)` `#5FCE3F`, 내부 "✓" font-kr-bold color `#12331A`(짙은 그린, 논토큰) 11px/11px
  - unchecked: 배경 없음, `border: 1px solid #3A4150`
  - disabled(64자 초과): `border: 1px solid #3A415066`(#3A4150 @ 40%), 내부 "–" font-mono color `#3A4150` 11px/11px
- 툴 이름(w:300px, font-mono, `line-clamp: 1`) — 활성 행 color `var(--color-k-text)` `#E6E8EE`, `var(--text-desc)` 13px/17px; disabled 행 color `#4A5566`(논토큰, 더 어둡게 디밍)
- 길이(w:56px, font-mono, 12px/16px) — 활성 행 color `var(--color-k-dim)` `#9AA2B1`; disabled 행 `#4A5566`
- 설명 요약(grow, font-kr, `line-clamp:1`, 12px/16px) — 활성 행 `var(--color-k-dim)`; disabled 행 `#4A5566`
- 허용 칸(grow, 우측 정렬):
  - 허용됨: pill(`height:20px`, `padding-x:8px`, `border-radius: var(--radius-pill)` 999px, 배경 `#5FCE3F1F`(ok @ ~12%)), 텍스트 "허용됨" font-kr color `var(--color-ok)` 11px/14px
  - 미허용: pill 배경 `#9AA2B11F`(k-dim @ ~12%), 텍스트 "미허용" color `var(--color-k-dim)` 11px/14px
  - 64자 초과(행 5 전용): pill 없이 텍스트 "64자 초과 — 노출 불가" font-kr color `var(--color-warn)` `#FF9838` 11px/14px, 우측 정렬. 행 전체 배경에 `#FF98380D`(warn @ ~5%) 워시가 깔린다.

**상태 노트 블록 (2EW-0)** — 1273×80, `padding: 16px`, `gap: 16px`(flex column, justify-center), `border-bottom: 1px solid #262C38`.
- 노트 A (`gap: 8px`): "✓" font-kr-bold color `var(--color-ok)` 12px/14px + "인코딩 스모크 — 툴 이름·설명 U+FFFD 수동 스캔 통과 (호출 없음)" font-kr color `#C9CDD6`(논토큰) 12px/16px
- 노트 B (`gap: 8px`): "●" font-kr-bold color `var(--color-k-faint)` 12px/14px + "능동 probe는 allowlist 툴만 실행 — 어느 쪽이든 감사 로그에 남는다" font-kr color `var(--color-k-dim)` 12px/16px

**푸터 행 (2F3-0)** — 1273×56, `padding-x: 16px`, flex row, justify-between.
- 좌: "2개 선택됨 · 8개 중" font-mono color `var(--color-k-faint)` 12px/16px
- 우 버튼 그룹 (`gap: 8px`):
  - "전체 허용" (보조): `height:32px`, `padding-x:14px`, `border-radius: var(--radius-sm)` 4px, `border: 1px solid var(--color-k-line)`, 텍스트 font-kr-bold color `var(--color-k-dim)` `var(--text-desc)` 13px/16px
  - "선택 허용" (주 액션): `height:32px`, `padding-x:18px`, `border-radius: var(--radius-sm)` 4px, 배경 `var(--color-brand)` `#EE137B`, 텍스트 font-kr-bold color `white` 13px/16px — 화면 내 유일한 브랜드색 사용처(스펙 항목 4와 일치)

**폰트 토큰 정리**
- `--font-kr`: `Daki, sans-serif` (본문 한글)
- `--font-kr-bold`: `Daki B, sans-serif` (라벨/강조)
- `--font-mono`: `Geist Mono, monospace` (수치·식별자)
- `--text-label`: 14px, `--text-desc`: 13px, `--text-body`: 15px (헤드 20px는 이 화면 미사용)
- `--radius-sm`: 4px, `--radius-pill`: 999px

## 텍스트 · 라벨 전문

읽는 순서대로 (Probe Result Window 내부만):

1. `probe 결과`
2. `protocolVersion 2025-11-25`
3. `툴 8개 발견`
4. `pykrx-mcp v0.3.1`
5. `자가보고 · 신뢰 금지`
6. `툴 이름`
7. `길이`
8. `설명 요약`
9. `허용`
10. `get_stock_ohlcv` / `22자` / `일별 시세(OHLCV) 조회` / `허용됨`
11. `get_market_ticker_name` / `29자` / `종목 코드 → 종목명 조회` / `허용됨`
12. `get_market_ticker_list` / `29자` / `시장 전체 종목 코드 목록 조회` / `미허용`
13. `get_market_fundamental_by_date` / `37자` / `일자별 PER·PBR·배당수익률 조회` / `미허용`
14. `datalab_shopping_keyword_by_device_and_gender_breakdown` / `86자` / `네이버 데이터랩 쇼핑 키워드 성별·기기 세분화 조회` / `64자 초과 — 노출 불가`
15. `✓` `인코딩 스모크 — 툴 이름·설명 U+FFFD 수동 스캔 통과 (호출 없음)`
16. `●` `능동 probe는 allowlist 툴만 실행 — 어느 쪽이든 감사 로그에 남는다`
17. `2개 선택됨 · 8개 중`
18. `전체 허용`
19. `선택 허용`

참고(Caption/Spec Strip — 구현 대상 여부 불확실, "Open questions" 참고):
- Caption: `AT-ST-006` / `MCP 등록 — probe · 툴 허용` / `승인된 서버를 1회 연결해 알아낸 것을 보여주고, 툴을 개별 허용하는 화면.`
- Spec Strip: `연결` `1회 후 해제` / `기본값` `전체 허용 아님` / `64자` `스킵 + 사유` / `능동 probe` `감사 로그 필수`

## 상태 · 인터랙션

이 아트보드는 단일 정적 화면(성공적으로 probe를 마친 결과 화면, 일부 툴은 이미 허용됨)만 보여준다. 그 안에서 **행 단위 상태**는 3가지가 동시에 예시로 표현된다:

1. **허용됨(checked)** — 체크박스에 ok색 배경+체크마크, 우측에 "허용됨" 초록 pill.
2. **미허용(unchecked)** — 빈 테두리 체크박스, 우측에 "미허용" 회색 pill. (인터랙션: 클릭하면 허용됨으로 토글되고 푸터 카운터 "N개 선택됨"이 갱신될 것으로 추정 — 실제 토글 애니메이션/카운터 갱신은 화면에 없음, 정적 스냅샷.)
3. **64자 초과(disabled)** — 체크박스 자체가 비활성(테두리 흐림 + "–"), 행 전체가 warn색 워시로 디밍, 우측 pill 대신 "64자 초과 — 노출 불가" 경고 텍스트. 클릭 불가능한 상태로 보인다.

정적으로 항상 켜져 있는 **안내 노트 2종**:
- 인코딩 스모크 결과 — 이 목업은 PASS(✓) 상태만 보여준다. FAIL(U+FFFD 손상 발견) 시의 시각 변형은 이 화면에 없다.
- 능동 probe 규칙 안내 — 정보성 텍스트("●")일 뿐, 이 화면에는 능동 probe를 실행하는 버튼/입력(툴 선택, 인자 JSON, --force-tool 확인)이 없다.

스펙 패널이 암시하지만 이 아트보드에 그림으로 없는 상태들:
- **probe 진행 중(연결 중) 상태** — 서버 spawn~initialize~list_tools 동안의 로딩 UI.
- **probe 실패 상태** — 서버가 뜨지 않거나 timeout됐을 때의 에러 UI (CLI는 `probe 실패: {alias} — {error}`를 출력한다).
- **선택 허용/전체 허용 클릭 후 피드백** — 성공 토스트, pill 상태 갱신, 버튼 disabled 등.
- **0개 선택 시 "선택 허용" 버튼 상태** — 비활성화되는지 여부 불명.
- **능동 probe를 이 화면에서 트리거하는 UI** — 없음 (Open questions 참고).
- **인코딩 손상 FAIL 배지/경고 색상** — 없음.

## 데이터 계약

| 화면 요소 | 백엔드 데이터/소스 |
|---|---|
| "probe 결과" 헤더, protocolVersion, 툴 개수 | `athena_mcp.onboarding.ProbeReport` (`probe_server()` 반환값): `protocol_version`, `tool_count` |
| "pykrx-mcp v0.3.1" (자가보고, 신뢰 금지) | `ProbeReport.reported_name` / `reported_version` — 확정 후 `registry.record_self_reported_info()`로 `ServerEntry.self_reported_server_info`에 영속화 (`registry.py`) |
| 툴 테이블 각 행 (이름/설명/길이) | `ProbeReport.tools` — 각 항목 `{name, description, qualified_name_len}` (`onboarding.py` `probe_server()` 내부에서 `qualified_name_len = len(entry.alias) + 2 + len(t.name)`로 계산) |
| 64자 초과 판정·행 비활성화 | `ProbeReport.oversized_tools` (`qualified_name_len > 64`인 이름 목록); allow 액션에서도 `cmd_probe`의 `--allow-all` 경로가 동일 조건(`<= 64`)으로 걸러낸다 |
| "허용됨"/"미허용" 체크 상태 | `ConsentStore.is_tool_allowed(alias, tool_name)` (`consent.py`), 저장은 `ConsentRecord.approved_tools` |
| 인코딩 스모크 통과/실패 노트 | `ProbeReport.mojibake_in_tool_metadata` (수동 스캔, `quirks.contains_mojibake()`) → 영속화는 `registry.record_encoding_smoke_test()` → `ServerEntry.encoding_smoke_test_warning` |
| 능동 probe 규칙 노트 | `probe_server()`의 `probe_tool`/`force_unallowed_tool` 파라미터, CLI `probe --tool <name> [--tool-args] [--force-tool]`; 실행 시 `ConsentStore.is_tool_allowed()` 미충족이면 `--force-tool` 없이는 거부, 결과는 `AuditLog.record(alias, f"probe:{tool}", success=...)`에 기록 (`onboarding.py` L308-358) |
| "선택 허용" 클릭 | `athena_mcp.consent.ConsentStore.allow_tool(alias, tool_name)` (CLI: `athena-mcp allow <alias> <tool>...`, `cmd_allow` in `__main__.py`) — 체크된 각 툴에 대해 호출 |
| "전체 허용" 클릭 | 정확히 대응하는 CLI 서브커맨드 없음. 가장 가까운 기존 경로는 `cmd_probe`의 `--allow-all` 플래그(64자 이하 전부 allow, `__main__.py` L208-212)인데 이는 probe 재실행에 물려 있다. 이미 probe된 서버에 대해 "지금 보이는 목록 전체를 허용"하려면 UI가 `allow_tool()`을 목록 순회 호출하거나 새 게이트웨이 엔드포인트가 필요 — **갭** |
| 체크박스를 해제(이미 허용된 툴을 미허용으로 되돌리기) | `ConsentStore.disallow_tool()`은 `consent.py`에 존재하지만 CLI에 노출된 서브커맨드가 없다 — **갭** |
| "위치: MCP 목록 › probe" 브레드크럼 | 순수 네비게이션 텍스트, 백엔드 데이터 아님 |

## Open questions

1. **Caption/Spec Strip이 실제 UI인가, 스펙 시트 주석인가.** 과제 노트는 "Ignore Desktop/Glow"만 명시했지만, `Caption`(212-0)은 스펙 패널의 화면명·Description 첫 문단을 그대로 반복하고, `Spec Strip`(2FQ-0)의 4개 값(연결/기본값/64자/능동 probe)도 스펙 패널 Description 항목들의 요약이다. 둘 다 `Probe Result Window`와 별개 프레임으로 Mockup Area에 얹혀 있고, `Probe Result Window`만 이름에 "Window"가 붙는다. 이 스펙은 이 둘을 "스펙 시트용 주석"으로 간주해 구현 대상에서 제외했다 — 만약 실제로 화면 상단 헤더/하단 요약바로 구현돼야 한다면 확인이 필요하다.
2. **"길이" 컬럼 수치가 `qualified_name_len` 공식과 맞지 않는다.** 표시된 값은 22/29/29/37/86자다. 앞의 네 행은 `툴 이름 길이 + 7`로 일관되지만(예: `get_stock_ohlcv` 15자+7=22), 다섯 번째 행(`datalab_shopping_..._breakdown`, 55자)은 55+7=62가 아니라 86으로 표시돼 있어 같은 공식이 아니다. 스펙 패널 각주는 "예시 값은 pykrx-mcp 실측"이라고 명시하므로 조작된 목업 숫자는 아닌 것으로 보이나, `qualified_name_len = len(alias) + 2 + len(tool_name)` 공식과 정확히 어떻게 대응하는지 목업만으로는 검증 불가능하다. 구현 시 실제 백엔드 계산값을 신뢰하고 이 목업 숫자를 그대로 베끼지 않아야 한다.
3. **능동 probe를 이 화면에서 어떻게 트리거하는지 명시가 없다.** 스펙 3.1/노트 B는 능동 probe의 규칙(allowlist 또는 강제, 감사 로그 필수)만 설명할 뿐, 이 화면에 툴 선택·인자 입력·`--force-tool` 확인 같은 트리거 UI가 없다. 능동 probe는 별도 화면/CLI 플로우(`probe --tool ...`)로 남는지, 아니면 이 화면에 (숨겨진) 인터랙션이 추가돼야 하는지 불명확하다.
4. **"전체 허용" 버튼의 백엔드 액션이 비어 있다.** 이미 probe된 서버에 대해 목록 전체를 일괄 허용하는 CLI/게이트웨이 API가 없다 (데이터 계약 표 참고). `probe --allow-all`은 probe 실행과 결합돼 있어, 이미 표시된 결과 화면에서 재사용하려면 재probe를 트리거하거나 새 엔드포인트가 필요하다.
5. **체크 해제(미허용으로 되돌리기) 인터랙션의 존재 여부.** `consent.disallow_tool()`은 백엔드에 있지만 CLI 서브커맨드가 없고, 이 화면이 체크박스를 다시 풀 수 있는 토글인지 단순 표시 전용인지 목업만으로는 알 수 없다.
6. **인코딩 스모크 FAIL, probe 실패, 로딩 중 상태의 시각 디자인이 없다.** 이 화면은 성공 경로 스냅샷 1개만 제공한다 (상태 섹션 참고).
7. **브레드크럼 "MCP 목록 › probe"의 "probe"가 서버 별칭인지 플로우 단계 이름인지 불명확.** 헤더에는 구체적 서버 예시로 `pykrx-mcp`가 쓰이는데 브레드크럼은 일반명 "probe"를 쓴다 — 내비게이션 라벨링 규칙 확인 필요.
