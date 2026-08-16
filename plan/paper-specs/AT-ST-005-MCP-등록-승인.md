# 20 · AT-ST-005 MCP 등록·승인

- Paper node: QR-0 | artboard "20 · AT-ST-005 MCP 등록·승인"
- Mockup window nodes: "스니펫 붙여넣기 · 별칭 정규화" (218-0, 642×524) + "동의 게이트 · 승인" (22C-0, 642×480), both children of "2단 레이아웃" (217-0, 1308×524) inside "Mockup Area" (1W3-0, 1508×1080)
- Screenshot (full artboard): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-QR-0-11928.jpg
- Screenshot (mockup area only): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1W3-0-36132.jpg

## 무엇을 하는 화면인가

클로드 데스크탑 설정 스니펫을 붙여넣으면 임의의 서버 이름을 MCP 툴 이름 규칙(`A-Za-z0-9_-`, 28자 상한)에 맞게 결정적으로 정규화해 원본과 나란히 보여주고, 실행 명령 전문(자르지 않음)과 환경변수 키 목록을 노출한 뒤에만 사용자가 "MCP 서버 시작"을 명시 승인할 수 있는 화면이다. 승인 전에는 프로세스가 절대 뜨지 않는다 — 승인은 "서버 시작"까지만이고 툴 호출 승인은 AT-ST-006에서 별도로 다룬다. 왼쪽 카드가 입력·정규화, 오른쪽 카드가 동의 게이트다.

## 스펙 패널 전문

Meta 행:
- 화면 ID: AT-ST-005
- 화면 명: MCP 등록 — 스니펫 · 승인
- 위치: MCP 목록 › 등록

Description 항목 (번호 · 제목 · 본문, 원문 그대로):

1. 스니펫 붙여넣기
   : 클로드 데스크탑 설정 블록이 무수정으로 유효하다
   – 등록 UX의 1급 입력 경로다

2. 별칭 정규화
   : 임의 이름을 MCP 툴 이름 규칙(A-Za-z0-9_-, 28자)으로 결정적 변환한다

2.1 변환 사유 표기
   : 조용히 바꾸지 않는다
   – 원본·제안을 나란히 보여주고 확정은 사용자가 한다

2.2 한글 전용 이름
   : 문자집합 필터에서 전멸하면 실행 명령의 패키지명에서 유도한다

3. 실행 명령 전문
   : 자르지 않는다
   – 헤드리스 CLI가 신뢰 확인 없이 서버를 로드하는 구멍을 막는다

3.1 환경변수
   : 키 이름만 노출한다. 값은 위험 스캔에서도 읽지 않는다

4. 위험 경고
   : 키 이름만으로 판별되는 코드 실행 경로를 경고한다
   – 차단이 아니라 판단을 돕는 보조 신호다

5. 승인
   : 승인 전에는 프로세스가 절대 뜨지 않는다
   – 승인은 "서버 시작"까지, 툴 호출은 AT-ST-006에서 별도 확인한다

각주 (Description 리스트 아래, 작은 글씨):
- ※ 접근성: prefers-reduced-transparency 시 유리 불투명도 상승, prefers-contrast 시 테두리 강조
- ※ 위험 환경변수 키 목록(NODE_OPTIONS 등)의 최종 판별 규칙은 미결  (이 각주는 빨간색 `#D40000`으로 강조되어 있다 — 스펙 자체가 "미결"이라고 명시)

페이지 번호: 20

## 목업 구조

`Mockup Area`(1W3-0) 안에는 배경 장식(2개의 `Rectangle` — 그라디언트 배경 + glow), 캡션 텍스트 블록("AT-ST-005" / 타이틀 / 서브타이틀, 1W6-0), 실제 UI인 "2단 레이아웃"(217-0), 빨간 번호 배지(Badge 1~5, 스펙 패널 항목과 목업을 잇는 주석용), "Spec Note" 4열 요약 밴드(2IU-0)가 형제로 나열되어 있다. 이 중 **구현 대상은 "2단 레이아웃" 안의 두 카드뿐**이다 — 나머지는 스펙 시트 주석/캡션이다(아래 "Open questions" 참고).

```
2단 레이아웃 (217-0, 1308×524, flex row, gap 24px = gap-6, items-center)
├── 스니펫 붙여넣기 · 별칭 정규화 (218-0, 642×524) — "윈도우" 카드 1
│   ├── 헤더 바 (h-11=44px, px-4=16px, border-b #262C38, flex justify-between items-center)
│   │   ├── 타이틀 텍스트: "클로드 데스크탑 설정 붙여넣기"
│   │   └── 상태 필 (h-5=20px, px-2=8px, rounded-pill, bg #FFFFFF14)
│   │       └── 텍스트: "감지됨 · 서버 3개"
│   └── 바디 (flex-col, p-4=16px, gap-4=16px)
│       ├── 설정 코드 블록 (flex-col, rounded-6px, bg #1D222CB8, border #262C38)
│       │   ├── 파일명 바 (h-8=32px, px-3=12px, border-b #262C38)
│       │   │   └── 텍스트: "claude_desktop_config.json"
│       │   └── 코드 본문 (py-3=12px px-4=16px, gap-0.5=2px, font-mono, 13px)
│       │       └── 5줄: "{" / '  "mcpServers": {' / '    "@drfirst/korea-stock-mcp": { "command": "npx", "args": ["-y", "@drfirst/korea-stock-mcp"] }' (강조) / "  }" / "}"
│       └── 별칭 정규화 섹션 (flex-col, gap-2=8px)
│           ├── 섹션 헤더 (items-baseline justify-between)
│           │   ├── "별칭 정규화" (강조 텍스트)
│           │   └── "원본 → 제안 · 확정은 사용자가 한다" (보조 텍스트)
│           └── 리스트 박스 (flex-col, rounded-6px, overflow-clip, bg #1D222CB8, border #262C38) — 3개 행, 각 행 사이 border-b #262C38
│               ├── 행 1 (py-2.5=10px px-3.5=14px, gap-1=4px)
│               │   ├── 원본: "@drfirst/korea-stock-mcp"
│               │   ├── "→" + 제안: "drfirst-korea-stock-mcp"
│               │   └── 사유: "@ / 제거"
│               ├── 행 2
│               │   ├── 원본: "네이버 검색"
│               │   ├── "→" + 제안: "isnow890-naver-search-mcp"
│               │   └── 사유: "비ASCII 전멸 → 패키지명에서 유도"
│               └── 행 3
│                   ├── 원본: "user-registered-very-long-server-name-for-korean-market-data"
│                   ├── "→" + 제안: "user-registered-very--1f1e99"
│                   └── 사유: "28자 절단 + 원본 해시"
└── 동의 게이트 · 승인 (22C-0, 642×480) — "윈도우" 카드 2, 카드 1과 동일한 외곽 스타일
    ├── 헤더 바 (h-11=44px, px-4=16px, border-b #262C38, flex justify-between items-center)
    │   ├── 타이틀 텍스트: "MCP 서버 시작 승인"
    │   └── 상태 필 (h-5=20px, px-2=8px, rounded-pill, bg #FFFFFF14)
    │       └── 텍스트: "대기 중"
    ├── 대상 서버 블록 (width 100%, py-3.5=14px px-4=16px, gap-1.5=6px, border-b #262C38)
    │   ├── 라벨: "대상 서버 · 좌측에서 확정된 별칭"
    │   └── 행 (items-center, gap-2.5=10px)
    │       ├── 별칭: "drfirst-korea-stock-mcp"
    │       └── 프로토콜 필 (h-5 px-2 rounded-pill bg #FFFFFF14): "stdio"
    └── 바디 (flex-col, p-4=16px, gap-4=16px)
        ├── 실행 명령 섹션 (flex-col, gap-2=8px)
        │   ├── 라벨: "실행 명령 전문 · 자르지 않는다"
        │   └── 명령 박스 (py-3=12px px-3.5=14px, rounded-6px, bg #1D222CB8, border #262C38)
        │       └── 전문: "npx -y @isnow890/naver-search-mcp --api-key-env NAVER_CLIENT_ID --api-secret-env NAVER_CLIENT_SECRET --workspace /Users/kim/.athena/mcp/naver-search --log-level info"
        ├── 환경변수 섹션 (flex-col, gap-2=8px)
        │   ├── 섹션 헤더 (items-baseline justify-between)
        │   │   ├── "환경변수" (강조 텍스트)
        │   │   └── "키 이름만 · 값은 표시하지 않는다" (보조 텍스트)
        │   └── 필 목록 (flex-wrap, gap-2=8px) — 각 필 h-6=24px px-2.5=10px rounded-pill bg #FFFFFF14
        │       ├── "NAVER_CLIENT_ID"
        │       ├── "NAVER_CLIENT_SECRET"
        │       ├── "DART_API_KEY"
        │       └── "NODE_OPTIONS"
        └── 위험 경고 박스 (items-start, py-3.5=14px px-4=16px, rounded-6px, gap-3=12px, bg #FF98381F, border #FF983852)
            ├── 아이콘 원 (rounded-pill, bg-warn, 20×20px): "!"
            └── 텍스트 열 (gap-0.75=3px)
                ├── 제목: "위험한 환경변수 키 사용 — NODE_OPTIONS"
                └── 본문: "Node.js 실행 옵션을 주입할 수 있는 키다. 차단하지 않는다 — 판단은 사람이 한다."
    └── 푸터 (width 100%, pt-3.5=14px pb-4=16px px-4=16px, gap-3=12px, border-t #262C38)
        ├── 안내문: "승인 전에는 프로세스가 뜨지 않는다. 승인은 서버 시작까지만이고, 툴 호출은 별도로 확인한다."
        └── 버튼 행 (items-center, justify-end, gap-3=12px)
            ├── "거부" 버튼 (h-9.5=38px, px-5=20px, rounded-6px, bg-k-panel2, border-k-line)
            └── "승인" 버튼 (h-9.5=38px, px-5=20px, rounded-6px, bg-brand)
```

## 레이아웃 · 스타일

- 두 카드 공통 외곽 스타일: `width 642px`, `border-radius 20px`, `overflow: clip`, `box-shadow: #FFF0D61A 0px 0px 80px inset, #14100A85 0px 40px 90px`(안쪽 은은한 발광 + 바깥 드롭섀도로 유리 카드 느낌), `background-color #171B24F0`(≈ `--color-k-panel` #171B24 에 알파 94%), 위쪽 테두리만 밝은 하이라이트 `#FFFDF86B`(1px), 좌/우/아래 테두리는 `#2C3340`(= `--color-k-line` 토큰과 정확히 일치, computed style로 확인).
- 카드 내부 구분선·박스 테두리는 `#262C38`(k-line 토큰 #2C3340과 미묘하게 다른 리터럴 — 토큰화되어 있지 않음, 아래 Open questions 참고).
- 카드 배경 안의 코드/명령 박스: `background-color #1D222CB8`(≈ `--color-k-panel2` #1D222C 에 알파 72%), `border 1px solid #262C38`, `border-radius 6px`(토큰 `--radius-sm`은 4px이라 정확히 일치하지 않음).
- 필(pill) 배경: `#FFFFFF14`(흰색 8% 알파), `border-radius: 999px`(= `--radius-pill` 토큰과 일치).
- 위험 경고 박스: `background-color #FF98381F`(`--color-warn` #FF9838 에 알파 ~12%), `border 1px solid #FF983852`(같은 색 알파 ~32%), 아이콘 원 배경은 `bg-warn`(불투명 #FF9838) 토큰 그대로.
- 승인 버튼: `bg-brand`(`--color-brand` #EE137B) 토큰 그대로, 텍스트 흰색. 거부 버튼: `bg-k-panel2`(#1D222C) + `border-k-line`(#2C3340) 토큰 그대로, 텍스트 `k-dim`(#9AA2B1).
- 폰트 토큰:
  - `--font-kr` (Daki, sans-serif): 본문 한글 텍스트 전반 (예: "대상 서버 · 좌측에서 확정된 별칭", 안내문, 상태 필 텍스트).
  - `--font-kr-bold` (Daki B, sans-serif): 굵은 라벨/타이틀 (카드 헤더 타이틀, "별칭 정규화", "환경변수", 위험 경고 제목, 버튼 텍스트).
  - `--font-mono` (Geist Mono, monospace): 코드/명령/별칭/환경변수 키 전부 — 파일명, JSON 코드, 원본·제안 별칭, 실행 명령 전문, 환경변수 필, "stdio".
- 폰트 크기 토큰: `--text-desc`(13px) — 코드 블록·설명 줄(`text-desc/5`, `text-desc/4.25`, `text-desc/4.5` 등 클래스에 사용); `--text-label`(14px) — 카드 타이틀·별칭 값 등(`text-label/4.5`); 그 밖에 11px/12px 같은 더 작은 크기는 토큰화되어 있지 않고 리터럴(`text-[11px]/3.5`, `text-[12px]/4` 등)로 직접 쓰였다.
- 카드 1 내부 리스트 박스 행 간격: `py-2.5(10px) px-3.5(14px) gap-1(4px)`. 카드 2 대상 서버 블록: `py-3.5(14px) px-4(16px) gap-1.5(6px)`. 카드 2 바디 전체 gap: `gap-4(16px)`.
- "2단 레이아웃" 컨테이너: 두 카드 사이 `gap-6`=24px, `align-items: center`(카드 높이가 524px/480px로 달라 세로 중앙 정렬됨).

## 텍스트 · 라벨 전문

읽는 순서대로(캡션/배지/Spec Note 제외, 아래 Open questions 참고):

카드 1 "스니펫 붙여넣기 · 별칭 정규화":
1. "클로드 데스크탑 설정 붙여넣기"
2. "감지됨 · 서버 3개"
3. "claude_desktop_config.json"
4. "{"
5. `  "mcpServers": {`
6. `    "@drfirst/korea-stock-mcp": { "command": "npx", "args": ["-y", "@drfirst/korea-stock-mcp"] }`
7. "  }"
8. "}"
9. "별칭 정규화"
10. "원본 → 제안 · 확정은 사용자가 한다"
11. "@drfirst/korea-stock-mcp"
12. "→"
13. "drfirst-korea-stock-mcp"
14. "@ / 제거"
15. "네이버 검색"
16. "→"
17. "isnow890-naver-search-mcp"
18. "비ASCII 전멸 → 패키지명에서 유도"
19. "user-registered-very-long-server-name-for-korean-market-data"
20. "→"
21. "user-registered-very--1f1e99"
22. "28자 절단 + 원본 해시"

카드 2 "동의 게이트 · 승인":
23. "MCP 서버 시작 승인"
24. "대기 중"
25. "대상 서버 · 좌측에서 확정된 별칭"
26. "drfirst-korea-stock-mcp"
27. "stdio"
28. "실행 명령 전문 · 자르지 않는다"
29. "npx -y @isnow890/naver-search-mcp --api-key-env NAVER_CLIENT_ID --api-secret-env NAVER_CLIENT_SECRET --workspace /Users/kim/.athena/mcp/naver-search --log-level info"
30. "환경변수"
31. "키 이름만 · 값은 표시하지 않는다"
32. "NAVER_CLIENT_ID"
33. "NAVER_CLIENT_SECRET"
34. "DART_API_KEY"
35. "NODE_OPTIONS"
36. "!"
37. "위험한 환경변수 키 사용 — NODE_OPTIONS"
38. "Node.js 실행 옵션을 주입할 수 있는 키다. 차단하지 않는다 — 판단은 사람이 한다."
39. "승인 전에는 프로세스가 뜨지 않는다. 승인은 서버 시작까지만이고, 툴 호출은 별도로 확인한다."
40. "거부"
41. "승인"

(참고 — 구현 범위 밖으로 판단한 캡션/주석 텍스트: 상단 캡션 "AT-ST-005" / "MCP 등록 — 스니펫 · 승인" / "스니펫을 붙이면 별칭을 정하고, 실행 명령을 전부 보여준 뒤에만 서버가 뜬다.", 빨간 배지 "1"~"5"/"2.1"/"2.2"/"3.1", 하단 "Spec Note" 4열 — "입력 경로/스니펫 붙여넣기", "별칭/결정적 정규화", "명령/전문 노출", "승인/spawn 허용까지만".)

## 상태 · 인터랙션

목업은 단일 스냅샷 상태만 보여준다 — 두 카드가 동시에 "파싱 완료 + 정규화 제안 완료 + 위험 경고 발생" 상태로 나란히 표시되어 있다. 실제 흐름에서는 순차적인 여러 상태가 있을 것으로 보이나 이 보드에는 그 전환이 그려져 있지 않다:

- **카드 1 — 감지됨(현재 표시 상태)**: 스니펫이 붙여넣어졌고 파싱되어 "감지됨 · 서버 3개" 필이 표시되고, 원본 JSON이 코드 블록에 그대로 보이며, 별칭 제안 3건이 이미 계산되어 나열되어 있다. 스펙 패널 항목 1("스니펫 붙여넣기")이 암시하는 **빈 상태(붙여넣기 전 placeholder)**는 이 보드에 없다.
- **카드 1 — 별칭 확정 인터랙션**: 스펙 패널 2번 항목이 "확정은 사용자가 한다"고 명시하지만, 목업에는 원본→제안을 나란히 "보여주기"만 있고 승인/수정/되돌리기 같은 조작 UI(체크박스, 편집 필드, 확정 버튼)가 전혀 없다. 사용자가 어떻게 "확정"하는지는 이 화면만으로는 알 수 없다(아래 Open questions).
- **카드 2 — 대기 중(현재 표시 상태)**: 대상 서버·전문 명령·환경변수 키·위험 경고가 모두 노출된 채 "거부"/"승인" 버튼이 둘 다 활성 상태로 나란히 있다.
- **카드 2 — 위험 경고 트리거됨**: `NODE_OPTIONS` 키가 존재해서 경고 박스가 나타난 상태. 스펙 패널 4번 항목이 암시하는 **경고 없음(위험 패턴 미검출) 상태**는 이 보드에 없다 — 경고 박스가 조건부로 사라지는지, 다른 안내가 대신 뜨는지 알 수 없다.
- **카드 2 — 승인/거부 후 상태**: "승인" 클릭 후 상태(스피너, "승인됨" 배지로 전환 등)나 "거부" 클릭 후 상태(카드가 닫히는지, 등록이 삭제되는지)는 그려져 있지 않다.

## 데이터 계약

- **스니펫 파싱** → `athena_mcp/registry.py`의 `parse_claude_desktop_snippet(raw)`가 `{"mcpServers": {...}}` JSON을 `ParsedSnippetServer` 리스트로 변환한다. CLI 진입점은 `athena-mcp register --snippet-file <path|->`(`__main__.py: cmd_register`)이며 내부적으로 `onboarding.py`의 `stage_from_snippet(registry, consent, raw)`를 호출한다. 카드 1의 "감지됨 · 서버 N개" 필은 `len(parsed)`(또는 `len(staged)`)에 대응시킬 수 있다.
- **별칭 정규화** → `onboarding.py`의 `sanitize_alias()` / `derive_alias()` / `unique_alias()`가 결정적 변환을 수행한다. 상한 28자는 `registry.py`의 `MAX_ALIAS_LEN = 64 - len("__") - 34 = 28`(64자 MCP 툴 이름 규칙에서 `별칭__툴명` 구분자와 관측된 최장 툴 이름 34자를 뺀 값)에서 나온다. `PendingRegistration.original_name` / `.alias` / `.alias_was_rewritten`이 "원본 → 제안" 행 데이터에 대응한다.
  - **갭**: 각 행의 "사유" 텍스트("@ / 제거", "비ASCII 전멸 → 패키지명에서 유도", "28자 절단 + 원본 해시")에 대응하는 백엔드 필드가 없다. `PendingRegistration`은 원본·별칭·재작성 여부만 갖고 있고, *왜* 재작성됐는지(문자 제거인지/전멸 폴백인지/길이 절단인지)를 구분해 돌려주는 필드가 없다 — 프런트가 자체적으로 원본/결과 문자열을 diff해서 사유를 추론하거나, 백엔드에 사유 enum을 추가해야 한다.
- **실행 명령 전문** → `registry.py`의 `ServerEntry.full_command_text()` (`command + args`를 공백으로 join, 자르지 않음) 및 `consent.py`의 `ConsentStore.request_consent()`가 만드는 `ConsentRecord.full_command_text`(동일 로직)가 카드 2 명령 박스의 소스다. 보드 노트가 지시한 "FULL command text shown untruncated" 규칙을 그대로 만족한다 — `full_command_text()`는 잘라내는 로직이 전혀 없다.
- **환경변수 키 노출** → `entry.env`의 키만(`sorted(entry.env)`) 노출하고 값은 절대 표시하지 않는다는 규칙은 `cmd_show`/`cmd_register`(`__main__.py`)와 `consent.py`의 `scan_risk_patterns()` 주석("env 값은 스캔하지 않는다")에서 확인된다. 필 목록(NAVER_CLIENT_ID 등)은 이 키 집합에 대응.
  - **갭/불일치**: 명령 전문에는 `--api-key-env NAVER_CLIENT_ID --api-secret-env NAVER_CLIENT_SECRET`만 등장하는데 환경변수 필은 4개(`DART_API_KEY`, `NODE_OPTIONS` 포함)다. `DART_API_KEY`·`NODE_OPTIONS`가 이 서버의 `env` 딕셔너리에 왜 들어있는지 명령 인자만으로는 설명되지 않는다(등록 시 별도로 `--env` 플래그나 스니펫의 `env` 블록으로 추가됐다는 뜻일 텐데, 목업에는 그 입력 경로가 안 보인다).
- **위험 경고** → `consent.py`의 `scan_risk_patterns(command, args, env)`가 `command`/`args`/`env` 키를 스캔해 경고 리스트를 만든다. `NODE_OPTIONS`는 `_DANGEROUS_ENV_KEYS`에 정확히 포함되어 있어 이 예시가 트리거하는 게 맞다. 다만 백엔드가 실제로 반환하는 문자열은 **하나로 합쳐진** `"위험한 환경변수 키 사용 (NODE_OPTIONS) — 값은 표시하지 않지만 인터프리터가 암묵적으로 로드하는 코드 경로일 수 있다"`(리스트 원소 하나)이고, 목업은 이걸 **제목("위험한 환경변수 키 사용 — NODE_OPTIONS") + 별도 설명 문장("Node.js 실행 옵션을 주입할 수 있는 키다. 차단하지 않는다 — 판단은 사람이 한다.")** 두 개로 나눠 보여준다. 문구도 백엔드 원문과 정확히 일치하지 않는다 — 프런트에서 백엔드 문자열을 파싱/재구성하거나, 백엔드가 `(title, body)` 구조화된 경고를 돌려주도록 바뀌어야 한다.
- **"stdio" 프로토콜 필** → 레지스트리/consent 모델 어디에도 transport/protocol을 저장하는 필드가 없다(`ServerEntry`에 `command`/`args`/`env`만 있고, MCP 서버는 전부 stdio spawn이 전제). 즉 "stdio"는 현재 하드코딩된 상수로만 표시 가능하고, 데이터 소스가 없다.
- **승인 액션** → "승인" 버튼은 `athena-mcp approve <alias>`(`__main__.py: cmd_approve` → `consent.py: ConsentStore.approve()`)에 대응한다. `approve()`는 `approved=True`만 세팅하고 툴 allowlist는 비워둔다(§ "서버 등록 = 모든 툴 자동 허용을 피한다") — 이는 안내문 "승인은 서버 시작까지만이고, 툴 호출은 별도로 확인한다"와 정확히 일치한다. spawn 차단은 `ConsentStore.require_server_approved()`(`ConsentNotGrantedError`)가 담당하며 consent.py 주석에 "client.py가 spawn 직전에 호출한다"고 명시되어 있다 — 보드 노트가 요구한 "approval is explicit before any spawn"을 만족한다.
- **"거부" 액션** → CLI에 정확히 대응하는 서브커맨드가 없다. 가장 가까운 후보는 `athena-mcp remove <alias>`(등록 자체를 삭제, `registry.remove` + `consent.revoke`)이거나, 이미 승인된 걸 되돌리는 `athena-mcp revoke <alias>`인데 후자는 "아직 승인 안 한 대기 상태를 거절"하는 의미와 다르다. 이 갭은 아래 Open questions에도 기록.

## Open questions

1. **구현 범위 판정(캡션 vs 실제 UI)**: 이 보드는 예시로 주어진 "Onboarding Window" 패턴과 달리 실제 창이 두 개("2단 레이아웃" 안의 두 카드)이고, 그 바깥에 "AT-ST-005 / 타이틀 / 서브타이틀" 캡션 블록과 "Spec Note" 4열 요약 밴드가 별도 프레임으로 존재한다. 지시문은 Desktop/Glow/번호 배지/스펙 패널만 명시적으로 제외 대상이라 언급했는데, 이 스펙에서는 "AT-ST-005" 캡션(내부 티켓 코드가 실제 앱 UI에 노출될 리 없음)과 레이어명이 문자 그대로 "Spec Note"인 하단 밴드까지 캡션/주석으로 판단해 구현 대상에서 제외했다. 이 판단이 다른 보드들과 일치하는지 확인이 필요하다.
2. **별칭 "확정" 인터랙션 부재**: 스펙 패널 2번 항목이 "확정은 사용자가 한다"고 명시하지만, 카드 1에는 원본→제안을 그냥 보여주기만 할 뿐 사용자가 개별 별칭을 수정하거나 승인하는 조작 요소(체크박스/편집 필드/개별 확정 버튼)가 전혀 없다. 카드 2로 넘어가는 "확정" 액션이 암묵적으로 카드 2의 "승인" 버튼과 합쳐진 것인지, 아니면 별도 UI가 이 보드에 빠진 것인지 불명확하다.
3. **위험 경고 문구가 백엔드 문자열과 다르다**: 위 "데이터 계약" 절에 적었듯 `scan_risk_patterns()`가 실제로 반환하는 문자열과 목업의 제목+본문 2단 문구가 일치하지 않는다. 스펙 패널 각주도 "위험 환경변수 키 목록의 최종 판별 규칙은 미결"이라고 스스로 명시하므로, 이 UI 문구도 확정된 사양이 아니라 예시로 봐야 하는지 확인이 필요하다.
4. **"감지됨 · 서버 3개"인데 코드 블록엔 서버 1개만 보임**: 카드 1 상태 필은 "서버 3개"라고 말하지만 표시된 `claude_desktop_config.json` 예시 JSON에는 `mcpServers`에 서버 1개(`@drfirst/korea-stock-mcp`)만 들어있다. 반면 별칭 정규화 리스트에는 서로 다른 3개 서버(`@drfirst/korea-stock-mcp`, `네이버 검색`, `user-registered-very-long-...`)의 예시가 들어있다 — 즉 "3개"가 이 특정 붙여넣은 스니펫의 서버 수를 말하는 게 아니라, 정규화 예시를 3가지 보여주기 위한 목업용 편집으로 보인다. 실제 화면에서 코드 블록과 상태 필과 정규화 리스트가 동일한 스니펫에서 나온 것인지(그래야 앞뒤가 맞음) 확인이 필요하다.
5. **환경변수 필 4개 중 2개는 명령 인자와 무관**: `DART_API_KEY`, `NODE_OPTIONS`가 표시된 실행 명령(`--api-key-env NAVER_CLIENT_ID --api-secret-env NAVER_CLIENT_SECRET`)에 등장하지 않는다. 이 서버의 `env` 딕셔너리에 왜 4개 키가 들어있는지, 어떤 입력 경로(스니펫의 `env` 블록? `--env` 플래그?)로 추가됐는지 이 보드만으로는 알 수 없다.
6. **"거부" 버튼에 대응하는 백엔드 동작 없음**: `athena-mcp` CLI에는 "대기 중인 승인 요청을 거절"하는 전용 서브커맨드가 없다(`remove`는 등록 자체 삭제, `revoke`는 이미 승인된 것을 철회). "거부"를 누르면 등록이 삭제되는지, 그냥 미승인 상태로 남는지 스펙에 없다.
7. **"stdio" 프로토콜 필의 데이터 소스 없음**: 레지스트리 모델에 transport/protocol 필드가 없다 — 지금은 모든 서버가 stdio spawn이라는 암묵적 전제뿐이다. 여러 transport를 지원하게 되면 이 필드를 어디서 채울지 결정이 필요하다.
