# 19 · AT-ST-004 MCP 서버 목록

- Paper node: QQ-0 | artboard "19 · AT-ST-004 MCP 서버 목록"
- Screenshot (전체 아트보드): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-QQ-0-33656.jpg
- Screenshot (목업 창만): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-R2-0-34080.jpg

## 무엇을 하는 화면인가

캔버스 창에 뜨는 제어 캔버스다. 대화 창에 "MCP 서버 보여줘"라고 입력하면 열리며, 별도의 설정 창은 없다. 등록된 MCP 서버들의 별칭·연결 상태·허용 툴 수·protocol 버전·실행 명령 전문을 표로 보여주는 것이 유일한 목적이며, 행을 누르면 상세(툴 목록·감사 로그)로 들어간다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-ST-004
- 화면 명: MCP 서버 — 목록
- 위치: 캔버스 창 › 제어 캔버스

**Description**
1. 캔버스 헤더
   : 등록 수 · 연결 수 · 노출 툴 수 요약
   – 캔버스 창 안의 카드다. 설정 창을 따로 띄우지 않는다
1.1 스니펫 붙여넣기
   : 클로드 데스크탑 설정 블록을 그대로 붙여넣는다
   – 붙여넣기만으로는 승인되지 않는다 → AT-ST-005
1.2 서버 등록
   : 화면 내 유일한 브랜드 색 요소
2. 서버 행
   : 별칭 · 상태 · 허용 툴 · protocolVersion · 실행 명령
   – 별칭은 사용자가 부여한다. serverInfo.name 은 서버 간 충돌 실측
   – 허용 툴은 허용/전체 — 전체 허용이 기본값이 아님을 드러낸다
2.1 상태 · 경고
   : 연결됨 / 승인 대기 / 연결 실패 3종. 색은 상태에만 쓴다
   – 인코딩 경고는 U+FFFD 왕복 검사 결과. 탐지만 하고 복구하지 않는다
3. 실행 명령 전문
   : 자르지 않는다. 승인 판단의 유일한 근거다
   – env 는 키 이름만 노출. 값은 어느 화면에도 표시하지 않는다

※ 목록·상태는 athena-mcp doctor 실측값 (부록 B1)
※ 원격(HTTP+OAuth) 서버는 2차 범위 — 1차는 stdio 전용

- 페이지 번호: 19

## 목업 구조

(Mockup Area 안의 "MCP List Window" (R2-0) 1308×347 서브트리만. Desktop/Glow/Caption/Badge/Spec Note 는 스펙 시트 주석이라 제외했다 — 근거는 아래 "레이아웃 · 스타일" 절 끝의 주석 참고.)

```
Frame "MCP List Window" (R2-0) 1308×347 — 창 컨테이너 (다크 카드, 라운드 20px)
├─ Frame (R3-0) 1307×44 — 헤더 행
│  ├─ Frame (R4-0) 273×18 — 타이틀+요약 그룹
│  │  ├─ Text "MCP 서버" (R5-0) — 창 타이틀
│  │  └─ Text "5개 등록 · 3개 연결됨 · 26개 툴 노출" (R6-0) — 요약 카운터
│  └─ Frame (R7-0) 194×26 — 액션 그룹
│     ├─ Text "스니펫 붙여넣기" (R8-0) — 보조 텍스트 액션
│     └─ Frame (R9-0) 89×26 — 버튼 "+ 서버 등록" (브랜드 색, 화면 내 유일)
├─ Frame (RB-0) 1307×32 — 컬럼 헤더 행
│  ├─ Text "별칭" (RC-0) — w-62.5(250px)
│  ├─ Text "상태" (RD-0) — w-32.5(130px)
│  ├─ Text "허용 툴" (RE-0) — w-22.5(90px)
│  ├─ Text "protocol" (RF-0) — w-32.5(130px)
│  └─ Text "실행 명령" (RG-0) — grow
├─ Frame (RI-0) 1307×46 — 데이터 행 1: server-everything (상태 = 연결됨)
│  ├─ Frame (RJ-0) 250×17 → Text "server-everything" (RK-0)
│  ├─ Frame (RL-0) 130×20 → Frame(pill) (RM-0) 49×20 → Text "연결됨"
│  ├─ Text "12 / 13" (RO-0) — 허용 툴
│  ├─ Text "2025-11-25" (RP-0) — protocol
│  └─ Text "npx -y @modelcontextprotocol/server-everything" (RQ-0) — 실행 명령
├─ Frame (RR-0) 1307×46 — 데이터 행 2: drfirst-korea-stock-mcp (상태 = 연결됨, 인코딩 경고 있음)
│  ├─ Frame (RS-0) 250×33 → Text alias "drfirst-korea-stock-mcp" (RT-0) + Text 경고 "⚠ 인코딩 손상" (RU-0)
│  ├─ Frame (RV-0) 130×20 → Frame(pill) (RW-0) 49×20 → Text "연결됨"
│  ├─ Text "6 / 6" (RY-0)
│  ├─ Text "2025-11-25" (RZ-0)
│  └─ Text "npx -y @drfirst/korea-stock-mcp" (S0-0)
├─ Frame (S1-0) 1307×46 — 데이터 행 3: pykrx (상태 = 연결됨)
│  ├─ Frame (S2-0) 250×17 → Text "pykrx" (S3-0)
│  ├─ Frame (S4-0) 130×20 → Frame(pill) (S5-0) 49×20 → Text "연결됨"
│  ├─ Text "8 / 8" (S7-0)
│  ├─ Text "2025-11-25" (S8-0)
│  └─ Text "uvx --with mcp==1.28.* pykrx-mcp" (S9-0)
├─ Frame (SA-0) 1307×46 — 데이터 행 4: korean-dart-mcp (상태 = 승인 대기, 미연결이라 허용툴/protocol 공란)
│  ├─ Frame (SB-0) 250×17 → Text "korean-dart-mcp" (SC-0)
│  ├─ Frame (SD-0) 130×20 → Frame(pill) (SE-0) 64×20 → Text "승인 대기"
│  ├─ Text "—" (SG-0)
│  ├─ Text "—" (SH-0)
│  └─ Text "npx -y korean-dart-mcp" (SI-0)
├─ Frame (SJ-0) 1307×46 — 데이터 행 5: isnow890-naver-search-mcp (상태 = 연결 실패)
│  ├─ Frame (SK-0) 250×17 → Text "isnow890-naver-search-mcp" (SL-0)
│  ├─ Frame (SM-0) 130×20 → Frame(pill) (SN-0) 64×20 → Text "연결 실패"
│  ├─ Text "—" (SP-0)
│  ├─ Text "—" (SQ-0)
│  └─ Text "npx -y @isnow890/naver-search-mcp" (SR-0)
└─ Frame (SS-0) 1307×40 — 하단 도움말 바 (은은한 배경)
   └─ Text "행을 누르면 상세 · 툴 목록 · 감사 로그가 열린다. 실행 명령은 자르지 않고 전문을 표시한다." (ST-0)
```

Mockup Area 안에는 이 창 외에 "Caption" (QX-0, 화면 좌상단의 AT-ST-004 / 타이틀 / 설명 3줄), 숫자 배지("Badge 1"~"Badge 3" 등), "Spec Note" (XL-0, 창 아래의 4열 캡션: 호출 방식 / 비밀값 / 승인 단계 / 실패 격리) 가 있는데, 이들은 어두운 배경 위에 떠 있는 스펙 시트 주석(타이틀·화살표 배지·풋노트)이지 창 크롬의 일부가 아니다. "MCP List Window" (R2-0) 는 라운드 코너와 자체 테두리로 완결된 카드이고 "행을 누르면…" 행에서 시각적으로 끝난다 — Spec Note 는 그 아래 별도 구획으로, 창 테두리 밖에 있다. 자세한 내용/불확실성은 "Open questions" 참고.

## 레이아웃 · 스타일

**창 컨테이너 (R2-0)**
- 크기: 1308×347px (아트보드 내 위치: left 100px, top 300px — 절대 배치는 스펙 시트 좌표이니 무시)
- border-radius: 20px
- overflow: clip
- background: `#171B24F0` (= `--color-k-panel` #171B24 에 알파 ~94%)
- border: top 1px solid `#FFFDF86B` (하이라이트 엣지), left/right/bottom 1px solid `#2C3340` (= `--color-k-line`)
- box-shadow: `#FFF0D61A 0px 0px 80px inset, #14100A85 0px 40px 90px`

**헤더 행 (R3-0)**: height 44px, padding-x 16px, background `#1D222C99` (= `--color-k-panel2` #1D222C 알파 ~60%), border-bottom 1px solid `#262C38`
- 왼쪽 그룹 gap 12px: "MCP 서버" — font-kr-bold(Daki B), `var(--text-label)` 14px, line-height 18px, color `var(--color-k-text)` #E6E8EE / "5개 등록 · 3개 연결됨 · 26개 툴 노출" — font-mono(Geist Mono), 12px, line-height 16px, color `var(--color-k-faint)` #6B7480
- 오른쪽 그룹 gap 16px: "스니펫 붙여넣기" — font-kr(Daki), 12px, line-height 16px, color `var(--color-k-dim)` #9AA2B1 / 버튼 "+ 서버 등록" — height 26px, padding-x 12px, `var(--radius-sm)` 4px, background `var(--color-brand)` #EE137B, 내부 텍스트 font-kr-bold, 12px/16px, color white

**컬럼 헤더 행 (RB-0)**: height 32px, padding-x 16px, border-bottom 1px solid `#262C38`. 5개 컬럼 모두 font-kr, letter-spacing 0.08em, 11px, line-height 14px, color `var(--color-k-faint)`. 컬럼 폭: 별칭 250px / 상태 130px / 허용 툴 90px / protocol 130px / 실행 명령 grow(나머지 채움)

**데이터 행 (예: RI-0)**: height 46px(승인대기·연결실패 행은 alias 셀에 부제목이 없어도 동일 46px), padding-x 16px, border-bottom 1px solid `#21262F`
- 별칭 셀 (250px, flex-col gap 2px): 별칭 텍스트 — font-kr, `var(--text-desc)` 13px, line-height 17px, color `var(--color-k-text)`. 경고가 있으면 그 아래 줄에 "⚠ 인코딩 손상" — font-kr, 11px, line-height 14px, color `var(--color-warn)` #FF9838
- 상태 셀 (130px): 필(pill) — height 20px, padding-x 8px, `var(--radius-pill)` 999px. 3가지 상태별 배경/텍스트 색은 아래 "상태 · 인터랙션" 참고
- 허용 툴 셀 (90px): font-mono, 12px, line-height 16px, color `var(--color-k-dim)` (값 없을 때 "—" 도 동일 스타일)
- protocol 셀 (130px): font-mono, 11px, line-height 16px, color `var(--color-k-faint)`
- 실행 명령 셀 (grow): font-mono, 11px, line-height 16px, color `var(--color-k-faint)` — 잘라내지 않고 전문 표시(스펙 3번 항목)

**하단 도움말 바 (SS-0)**: height 40px, padding-x 16px, background `#1D222C59` (= k-panel2 알파 ~35%). 텍스트 font-kr, 12px, line-height 16px, color `var(--color-k-faint)`

**토큰 참고표 (get_tokens 결과)**
| 토큰 | 값 | 이 화면에서 쓰인 곳 |
|---|---|---|
| `--color-k-panel` | #171B24 | 창 배경(알파 적용) |
| `--color-k-panel2` | #1D222C | 헤더/도움말 바 배경(알파 적용) |
| `--color-k-line` | #2C3340 | 창 좌/우/하단 테두리 |
| `--color-k-text` | #E6E8EE | 창 타이틀, 별칭 텍스트 |
| `--color-k-dim` | #9AA2B1 | 보조 텍스트, 허용 툴 수, 승인대기 필 텍스트 |
| `--color-k-faint` | #6B7480 | 요약 카운터, 컬럼 헤더, protocol/실행명령 텍스트 |
| `--color-brand` | #EE137B | "+ 서버 등록" 버튼 (화면 내 유일 브랜드색) |
| `--color-ok` | #5FCE3F | "연결됨" 필 |
| `--color-warn` | #FF9838 | "연결 실패" 필, 인코딩 경고 텍스트 |
| `--font-kr` | Daki, sans-serif | 대부분의 한글 라벨 |
| `--font-kr-bold` | Daki B, sans-serif | 타이틀, 버튼 텍스트 |
| `--font-mono` | Geist Mono, monospace | 카운터, protocol, 실행 명령, 허용 툴 수 |
| `--text-desc` | 13px | 별칭 텍스트 |
| `--text-label` | 14px | 창 타이틀 |
| `--radius-sm` | 4px | 버튼 |
| `--radius-pill` | 999px | 상태 필 |

## 텍스트 · 라벨 전문

읽는 순서대로 (MCP List Window 서브트리만):
1. `MCP 서버` — 창 타이틀
2. `5개 등록 · 3개 연결됨 · 26개 툴 노출` — 요약 카운터
3. `스니펫 붙여넣기` — 보조 액션 텍스트
4. `+ 서버 등록` — 버튼 라벨
5. `별칭` — 컬럼 헤더
6. `상태` — 컬럼 헤더
7. `허용 툴` — 컬럼 헤더
8. `protocol` — 컬럼 헤더
9. `실행 명령` — 컬럼 헤더
10. `server-everything` — 별칭
11. `연결됨` — 상태 필
12. `12 / 13` — 허용 툴
13. `2025-11-25` — protocol
14. `npx -y @modelcontextprotocol/server-everything` — 실행 명령
15. `drfirst-korea-stock-mcp` — 별칭
16. `⚠ 인코딩 손상` — 인코딩 경고
17. `연결됨` — 상태 필
18. `6 / 6` — 허용 툴
19. `2025-11-25` — protocol
20. `npx -y @drfirst/korea-stock-mcp` — 실행 명령
21. `pykrx` — 별칭
22. `연결됨` — 상태 필
23. `8 / 8` — 허용 툴
24. `2025-11-25` — protocol
25. `uvx --with mcp==1.28.* pykrx-mcp` — 실행 명령
26. `korean-dart-mcp` — 별칭
27. `승인 대기` — 상태 필
28. `—` — 허용 툴 (미연결)
29. `—` — protocol (미연결)
30. `npx -y korean-dart-mcp` — 실행 명령
31. `isnow890-naver-search-mcp` — 별칭
32. `연결 실패` — 상태 필
33. `—` — 허용 툴 (연결 실패)
34. `—` — protocol (연결 실패)
35. `npx -y @isnow890/naver-search-mcp` — 실행 명령
36. `행을 누르면 상세 · 툴 목록 · 감사 로그가 열린다. 실행 명령은 자르지 않고 전문을 표시한다.` — 하단 도움말

(참고: 창 밖 주석 텍스트도 있으나 목업 UI가 아니므로 여기서 제외 — "Open questions" 참고. 필요하면: Caption = "AT-ST-004" / "MCP 서버 — 목록" / "캔버스 창에 뜨는 제어 캔버스다. 대화 창에 "MCP 서버 보여줘"라고 입력하면 열린다. 별도 설정 창은 없다." Spec Note 4열 = "호출 방식: 대화 창 자연어" / "비밀값: 이 화면에 없음" / "승인 단계: 서버 승인 → 툴 허용" / "실패 격리: 서버 단위")

## 상태 · 인터랙션

스크린샷은 단일 화면 안에 5개 행을 통해 3가지 상태를 동시에 보여준다(별도 상태 전환 애니메이션이나 로딩 화면은 이 보드에 없음):

- **연결됨** (server-everything, drfirst-korea-stock-mcp, pykrx): 필 배경 `#5FCE3F1F`(ok 12% 알파), 텍스트 `var(--color-ok)` #5FCE3F. 허용 툴/protocol 컬럼에 실측값 표시.
- **승인 대기** (korean-dart-mcp): 필 배경 `#9AA2B11A`(k-dim 10% 알파), 텍스트 `var(--color-k-dim)` #9AA2B1. 허용 툴/protocol 은 "—"(아직 연결한 적이 없어 값이 없음).
- **연결 실패** (isnow890-naver-search-mcp): 필 배경 `#FF98381F`(warn 12% 알파), 텍스트 `var(--color-warn)` #FF9838. 허용 툴/protocol 은 "—".
- **인코딩 손상 경고** (drfirst-korea-stock-mcp): 상태와 독립적인 부가 표시 — 별칭 셀 두 번째 줄에 "⚠ 인코딩 손상" (warn 색). 스펙 2.1: "인코딩 경고는 U+FFFD 왕복 검사 결과. 탐지만 하고 복구하지 않는다" — 자동 수정 없음, 표시만.
- **행 클릭**: 스펙/도움말 텍스트에 의해 상세 · 툴 목록 · 감사 로그 화면으로 이동 (이 보드에는 그 화면이 없음).
- **"스니펫 붙여넣기" 클릭**: 클로드 데스크탑 설정 블록 붙여넣기 진입점. 스펙 1.1: "붙여넣기만으로는 승인되지 않는다 → AT-ST-005" (별도 승인 화면으로 이어짐, 이 보드 밖).
- **"+ 서버 등록" 클릭**: 화면 내 유일한 브랜드색 CTA(스펙 1.2). 서버 수동 등록 진입점으로 추정되나 이 보드에는 그 후속 화면이 없음.
- **암묵적으로 존재해야 하는 상태(이 보드에 없음)**: 등록된 서버 0개(empty state) — CLI `athena-mcp list` 는 이때 "등록된 서버가 없다"를 출력한다. 로딩/새로고침 중 상태도 보드에 없음.

## 데이터 계약

이 화면은 스펙 하단 각주("※ 목록·상태는 athena-mcp doctor 실측값")대로 `athena-mcp list` (레지스트리+승인 상태)와 `athena-mcp doctor` (연결 실측)를 합성한 뷰다.

| 화면 요소 | 백엔드 소스 | 비고 |
|---|---|---|
| 별칭 (alias) | `ServerRegistry.list()` → `ServerEntry.alias` (`backend/athena_mcp/registry.py:151`) | `cmd_list` 가 그대로 사용 |
| 등록 수 ("5개 등록") | `len(registry.list())` | `cmd_list` 의 entries 길이 |
| 실행 명령 전문 | `ServerEntry.full_command_text()` (`registry.py:182`) | "자르지 않는다" 요구사항과 정확히 일치 |
| protocol | `ServerEntry.self_reported_server_info.protocol_version` (`registry.py:146`) | `cmd_list` 의 `protocol={proto}` 와 동일. 자가보고값 — "신뢰 금지" 주석이 코드에 있음 |
| 인코딩 손상 경고 | `ServerEntry.encoding_smoke_test_warning` (`registry.py:159`) | `cmd_list` 의 `[인코딩 손상 경고]` 플래그와 동일. 문자 리터럴만 다름("⚠ 인코딩 손상" vs "[인코딩 손상 경고]") |
| 승인 대기 상태 | `ConsentStore.get(alias)` 가 `None` 이거나 `ConsentRecord.approved == False` (`backend/athena_mcp/consent.py:106`) | `cmd_list` 는 "승인됨/미승인" 2단만 출력 — 화면의 "승인 대기" 라벨과 문구가 다름(동일 개념으로 추정) |
| 연결됨 / 연결 실패 상태 | `GatewayRunner.connect_approved()` → `ConnectOutcome.ok` / `.error` (`backend/athena_mcp/runner.py:113`, `cmd_doctor` 가 소비) | doctor 는 **승인된 서버만** 접속을 시도한다 — 그래서 승인 대기 행은 doctor 대상이 아니라 값이 항상 "—" 인 것으로 추정 |
| 허용 툴 "12 / 13" 형식 | 분자: `ConsentRecord.approved_tools` 길이(`consent.py:108`). 분모: `ConnectOutcome.tool_count` 또는 `ProbeReport.tool_count`(`runner.py:116`, `onboarding.py`) | **갭**: 현재 어떤 CLI 서브커맨드도 "허용 개수/전체 발견 개수"를 한 번에 함께 출력하지 않는다 (`cmd_list` 는 승인된 툴 개수만, `cmd_doctor`/`cmd_probe` 는 tool_count 만). 화면을 구현하려면 두 소스를 조합하는 새 조회가 필요 |
| "26개 툴 노출" | `sum(허용 툴 분자)` = 12+6+8 = 26 (계산 확인됨) | 화면 자체 합산으로 추정 — 전용 백엔드 필드 없음 |
| "+ 서버 등록" 액션 | `athena_mcp.__main__.cmd_register` (`--command`/`--arg`/`--env`) | 후속 화면 없음(이 보드 밖) |
| "스니펫 붙여넣기" 액션 | `athena_mcp.onboarding.stage_from_snippet` / `cmd_register --snippet-file` | 스펙 1.1: 승인은 별도 화면(AT-ST-005) |
| 행 클릭 → 상세/툴목록/감사로그 | `cmd_show`(상세), `ProbeReport.tools`(툴 목록), `AuditLog`(`consent.py`, `runner.py` 의 probe 경로) | 대상 화면 없음(이 보드 밖) |
| env 값 비노출 규칙(스펙 3번) | `cmd_show` 는 `환경변수 키: ... (값은 표시하지 않는다)` 만 출력 | 이 목록 화면 자체는 env 를 전혀 표시하지 않음 — 규칙은 상세 화면에 적용되는 것으로 추정 |

## Open questions

1. **Spec Note(창 아래 4열 캡션: 호출 방식 / 비밀값 / 승인 단계 / 실패 격리)가 실제 앱 UI인지, 스펙 시트 주석인지 불명확.** "MCP List Window" 는 자체 라운드 테두리로 닫힌 카드이고 이 4열 캡션은 그 테두리 밖, 다른 시각 스타일(라벨 위/값 아래 세로 배치, 어두운 배경 위 직접 렌더)로 놓여 있어 Caption/Badge 와 같은 주석류로 판단했다. 하지만 이 내용(특히 "비밀값: 이 화면에 없음", "실패 격리: 서버 단위")은 스펙 패널 Description 에 정확히 대응하는 항목이 없는 **새로운 정보**라서, 실제로는 창의 일부(예: 접히는 하단 정보 바)일 가능성을 배제할 수 없다.
2. **"허용 툴" 컬럼의 "n / m" 형식을 만드는 백엔드 조회가 없다.** `cmd_list`(승인된 툴 개수)와 `cmd_doctor`/`cmd_probe`(발견된 전체 툴 개수, tool_count)를 조합해야 하는데 이 둘을 한 번에 묶어 반환하는 함수가 현재 코드베이스에 없다. 구현 시 새 조합 로직(또는 새 CLI/API)이 필요하다.
3. **"승인 대기"/"연결 실패" 상태에서 허용 툴·protocol 컬럼이 "—"인 것이 "값이 없다"인지 "doctor 를 아직/다시 안 돌렸다"인지 구분 불가.** 승인 대기 서버는 doctor 대상이 아니므로 "—"가 항상 맞겠지만, 연결 실패 서버는 한 번은 접속을 시도했다는 뜻이라 protocol_version 이 과거에 관측됐을 수도 있다(자가보고 값이 registry 에 캐시돼 있다면). 화면이 "마지막 성공 관측값"을 보여줄지 "이번 doctor 결과만" 보여줄지 스펙에 명시가 없다.
4. **상태 갱신 트리거가 불명확.** 이 화면은 "캔버스" 라서 대화창에서 열릴 때마다 뜨는데, 그때마다 `athena-mcp doctor` 를 재실행해서 연결 상태를 갱신하는지, 아니면 마지막 캐시된 상태를 보여주는지 스펙에 언급이 없다(doctor 는 실제로 서버에 접속했다가 내리는 부수효과가 있는 커맨드라 매번 자동 실행하기엔 부담일 수 있음).
5. **"별칭" 컬럼 부제("⚠ 인코딩 손상")과 "상태" 필이 독립 채널이라는 것은 스펙 2.1에 명시("색은 상태에만 쓴다")되어 있지만, 인코딩 경고가 있는 서버가 "연결 실패" 상태일 때 두 경고(상태 필의 warn 색 + 별칭 아래 warn 텍스트)가 시각적으로 어떻게 구분되는지는 이 보드에 예시가 없다** (drfirst 행은 "연결됨" 상태와만 조합된 예시뿐).
6. AT-ST-005(승인 화면), 행 클릭 시 이동하는 상세 화면은 이 보드에 없어 인터랙션의 종착점을 확인할 수 없다.
