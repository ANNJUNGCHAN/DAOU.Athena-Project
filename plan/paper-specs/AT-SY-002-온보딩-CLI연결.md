# 09 · AT-SY-002 온보딩 (CLI 연결)

- Paper node: EV-0 | artboard "09 · AT-SY-002 온보딩"
- Mockup window node: F0-0 "Onboarding Window", 800×690
- Screenshot (전체 아트보드): `C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-EV-0-34248.jpg`
- Screenshot (목업 창만): `C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-F0-0-33584.jpg`

## 무엇을 하는 화면인가

앱을 처음 실행했을 때 1회 나오는 온보딩 3단계 중 2단계(`2 / 3`) 화면으로, 사용자가 Athena가 제어할 CLI(Claude / Gemini / Codex / Grok)를 연결하는 화면이다. Athena는 자체 API 키를 쓰지 않고, 사용자가 브라우저로 로그인한 CLI 계정을 통해서만 명령을 실행한다. 이 화면은 별도의 창이 아니라 앱의 대화 창 자체가 최대 높이로 확장된 상태이며, 온보딩이 끝나면 대화 창이 기본 높이(204px)로 축소되면서 AT-CH-001 화면으로 전환된다. CLI를 하나도 연결하지 않으면 앱이 아무 기능도 하지 못하므로 이 단계는 건너뛸 수 없다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-SY-002
- 화면 명: 온보딩 (CLI 연결)
- 위치: 최초 실행 시 1회

**Description**
1. 온보딩 영역
   : 대화 창을 최대 높이로 확장하여 표시
   – 단계 표기(2 / 3)와 제목 · 설명문으로 구성
2. CLI 목록
   : 지원하는 CLI 4종을 고정 순서로 노출
   – 설치 여부를 탐지하지 않는다. 4종 모두 동일하게 표시
   – 좌측 표시등 : 연결됨(녹색) / 미연결(회색)
3. 계정 목록 · 활성 / 비활성
   : 연결된 CLI 하위에 계정을 나열. 계정은 복수 연결 가능
   – 활성 : 명령을 수신하는 계정. 전체에서 1개만 지정 가능
   – 비활성 : 연결되어 있으나 명령을 받지 않는 계정
   – 비활성 항목 클릭 시 해당 계정이 활성으로 전환
4. 연결 버튼
   : 클릭 시 기본 브라우저에서 해당 서비스 로그인 페이지 실행
   – 로그인 완료 시 앱으로 복귀하며 계정이 목록에 추가된다
   – 최초 연결된 계정은 자동으로 활성 상태가 된다
5. 단계 표시 · 이동
   : 좌측 단계 표시는 무채색. 브랜드 색을 사용하지 않는다
   – [계속] : 다음 단계로 이동. 화면 내 유일한 브랜드 색 요소
   – 건너뛰기 없음. CLI를 연결하지 않으면 앱이 아무 일도 하지 못한다

**각주 (Desc List 하단, 번호 없음)**
- ※ 완료 시 대화 창이 기본 높이(204px)로 축소되며 AT-CH-001로 전환
- ※ 브라우저 로그인 연동 방식(OAuth 리다이렉트 / CLI 로그인 명령 위임) 미정 — 협의 필요 (빨간색 텍스트 `#D40000`, 미해결 이슈로 강조됨)

**Page No**: 9

참고: 목업 영역(Mockup Area) 안, 스펙 패널과 별개로 캔버스 주석 "Note"(GS-0)가 하나 더 있다 — `AT-SY-002` / `온보딩은 별도의 창이 아니라 대화 창이 최대 높이로 확장된 상태다. 완료 시 기본 높이로 축소된다.` 내용은 각주 1과 동일하며, 앱 UI가 아니라 스펙 시트 주석이다.

## 목업 구조

```
Onboarding Window (F0-0, 800×690)                — 대화 창이 최대 높이로 확장된 상태의 온보딩 콘텐츠
├─ Head (F1-0, 799×134)                           — 상단 블록: 단계 표기 + 제목 + 설명
│  ├─ Text "2 / 3"                                — 단계 표기 (font-mono)
│  ├─ Text "사용할 CLI를 연결합니다"                — 화면 제목
│  └─ Text "Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다." — 설명문
├─ CLI List (F5-0, 799×485)                       — CLI 4종 + 안내문, 총 5개 자식 (5번째는 CLI가 아니라 안내 텍스트)
│  ├─ Claude 그룹 (F6-0, "Claude")                 — 연결된 CLI: 헤더 행 + 계정 행 2개를 감싼 카드
│  │  ├─ 헤더 행: 표시등(녹색) + "Claude"(굵게) + "계정 추가"(우측, 흐린 텍스트)
│  │  ├─ 계정 행(활성): "ajc227ung@gmail.com" + "활성" 배지 — 행 배경이 브랜드색으로 옅게 강조됨
│  │  └─ 계정 행(비활성): "work@daou.co.kr" + "비활성" 배지
│  ├─ Gemini 행 (FJ-0, "Gemini")                   — 연결된 CLI, 계정 1개만 있어 카드 없이 단일 행
│  │  └─ 표시등(녹색) + [이름 "Gemini" / 이메일 "ajc227ung@gmail.com" 2줄] + "비활성" 배지
│  ├─ Codex 행 (FQ-0, "Codex")                     — 미연결 CLI
│  │  └─ 표시등(회색) + "Codex" + "연결 ↗" 버튼
│  ├─ Grok 행 (FX-0, "Grok")                       — 미연결 CLI
│  │  └─ 표시등(회색) + "Grok" + "연결 ↗" 버튼
│  └─ 안내 텍스트 (G4-0)                            — "연결을 누르면 브라우저에서 해당 서비스에 로그인합니다. 계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다."
└─ Foot (G6-0, 799×70)                             — 하단 바
   ├─ 진행 점 3개 (pill, 20×3px)                    — 1: 지난 단계, 2: 현재 단계(밝음), 3: 다음 단계
   ├─ (spacer, grow)
   └─ "계속 →" 버튼                                 — 브랜드색 솔리드, 다음 단계로 이동
```

## 레이아웃 · 스타일

**Onboarding Window 컨테이너 (F0-0)**
- 크기: 800×690px (JSX `w-200 h-172.5`, `get_computed_styles`로 실측 확인)
- border-radius: 22px, overflow: clip
- border: 1px solid `#FFFFFF4D` (흰색 30% 알파)
- box-shadow: `inset 0 2px 0 #FFFFFF8F`(56%), `0 0 0 4px #FFFFFF09`(4%), `0 46px 104px #000000C7`(78%) — 3중 그림자로 유리질 하이라이트 + 외곽 확산 그림자
- 배경: `linear-gradient(in oklab 45deg, oklab(22.7% -0.001 -0.025 / 90%) 0%, oklab(20.1% -.0009 -0.021 / 95.7%) 40%, oklab(90.3% -0.005 -0.021 / 20%) 100%)` — 짙은 네이비/차콜 그라디언트, 화면상으로는 거의 균일한 짙은 회남색 카드로 보이고 상단에 미세한 밝은 테두리 하이라이트만 있음

**Head 블록**
- padding: top 40px, left/right 42px (`pt-10 px-10.5`)
- gap: 11px (`gap-2.75`)
- "2 / 3": `font-mono`(토큰 `--font-mono`: Geist Mono) 12px/16px, letter-spacing `0.22em`, color `#F2F4F86B`(백색 42%)
- "사용할 CLI를 연결합니다": `font-title`(토큰 `--font-title`: Daki Title) 28px/34px, letter-spacing `-0.02em`, color `#F2F4F8`
- 설명문: `font-kr`(토큰 `--font-kr`: Daki) 14px(`--text-label`)/22px, color `#F2F4F88A`(54%)

**CLI List 블록**
- padding: top 26px, left/right 42px (`pt-6.5 px-10.5`)
- gap: 9px (`gap-2.25`) — 행/카드 사이 간격

**Claude 그룹 카드**
- border-radius 11px, background `#FFFFFF0D`(5%), border 1px solid `#FFFFFF29`(16%)
- 헤더 행: height 48px, padding-x 15px, gap 13px, border-bottom 1px `#FFFFFF17`(9%)
  - 표시등: 7×7px 원, background `var(--color-ok)` `#5FCE3F`
  - "Claude": `font-kr-bold`(토큰 `--font-kr-bold`: Daki B) 14px/18px(`text-label/4.5`), color `#F2F4F8`, grow
  - "계정 추가": `font-kr` 12px/16px, color `#F2F4F866`(40%)
- 활성 계정 행: height 42px, padding-right 15px / padding-left 35px, gap 11px, background `#EE137B1A`(브랜드색 10%)
  - 이메일: `font-kr` 12px/16px, color `#F2F4F8EB`(92%)
  - "활성" 배지: padding 4px/10px, radius 6px, background `var(--color-brand)` `#EE137B`(솔리드), 라벨 `font-kr-bold` 10px/12px, color `white`
- 비활성 계정 행: height 42px, 동일 padding/gap, 배경 없음(카드 배경 그대로)
  - 이메일: `font-kr` 12px/16px, color `#F2F4F899`(60%)
  - "비활성" 배지: padding 4px/10px, radius 6px, background `#FFFFFF12`(7%), border 1px `#FFFFFF29`(16%), 라벨 `font-kr` 10px/12px, color `#F2F4F894`(58%)

**Gemini / Codex / Grok 독립 행**
- height 52px(`h-13`), padding-x 15px, radius 11px, gap 13px, background `#FFFFFF08`(3%), border 1px `#FFFFFF1A`(10%)
- 표시등: 7×7px 원 — Gemini는 `var(--color-ok)` `#5FCE3F`(연결됨), Codex·Grok은 `#FFFFFF38`(22%, 미연결)
- Gemini: 이름+이메일 세로 배치(gap 2px) — 이름 `font-kr` 14px/18px color `#F2F4F8EB`, 이메일 `font-kr` 10px/12px color `#F2F4F870`(44%); 우측에 "비활성" 배지(Claude 카드와 동일 스타일)
- Codex/Grok: 이름 한 줄 `font-kr` 14px/18px color `#F2F4F8EB`, grow; 우측 "연결" 버튼 — padding 7px/14px, radius 7px, gap 7px, background `#FFFFFF1A`(10%), border 1px `#FFFFFF3D`(24%), 라벨 `font-kr-bold` 11px/14px color `#F2F4F8EB` + 10×10 화살표(↗) SVG 아이콘(stroke `rgb(242 244 248 / 72%)`, width 1.4)

**안내 텍스트 (CLI 목록 하단)**
- padding-top 5px, `font-kr` 11px/18px, color `#F2F4F861`(38%)

**Foot 블록**
- height 70px, padding-x 42px, gap 15px, border-top 1px `#FFFFFF1C`(11%)
- 진행 점 3개: 각 20×3px, radius-full, 점 사이 gap 6px — 좌→우 색 `#FFFFFF4D`(30%, 지난 단계) / `#FFFFFFB3`(70%, 현재 단계) / `#FFFFFF1F`(12%, 다음 단계)
- "계속" 버튼: padding 10px/20px, radius 9px, gap 8px, background `var(--color-brand)` `#EE137B`, 라벨 `font-kr-bold` 13px(`--text-desc`)/16px color `white` + 11×11 화살표(→) SVG 아이콘(stroke `#FFFFFF`, width 1.5)

## 텍스트 · 라벨 전문

읽는 순서대로, 목업(F0-0) 안의 모든 리터럴 문자열:

1. `2 / 3` — 단계 표기
2. `사용할 CLI를 연결합니다` — 제목
3. `Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다.` — 설명문
4. `Claude` — CLI 이름
5. `계정 추가` — Claude 헤더 우측 액션 라벨
6. `ajc227ung@gmail.com` — Claude 활성 계정 이메일
7. `활성` — 배지
8. `work@daou.co.kr` — Claude 비활성 계정 이메일
9. `비활성` — 배지
10. `Gemini` — CLI 이름
11. `ajc227ung@gmail.com` — Gemini 계정 이메일(캡션)
12. `비활성` — 배지
13. `Codex` — CLI 이름
14. `연결` — 버튼 라벨(+ 화살표 아이콘)
15. `Grok` — CLI 이름
16. `연결` — 버튼 라벨(+ 화살표 아이콘)
17. `연결을 누르면 브라우저에서 해당 서비스에 로그인합니다. 계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다.` — 안내 텍스트
18. `계속` — 하단 버튼 라벨(+ 화살표 아이콘)

## 상태 · 인터랙션

이 보드는 하나의 상태 조합만 그림으로 보여준다: Claude 연결됨(계정 2개, 1개 활성), Gemini 연결됨(계정 1개, 비활성), Codex·Grok 미연결. 스펙 패널이 명시하는 상태/인터랙션은 다음과 같다.

- **CLI 연결 상태(표시등)**: 연결됨(녹색, `--color-ok`) / 미연결(회색, `#FFFFFF38`). CLI별로 계정이 1개 이상 있으면 연결됨. 설치 여부는 탐지하지 않으며 4종 모두 항상 동일하게 노출된다(Description 항목 2).
- **계정 상태(배지)**: 활성(브랜드색 솔리드 배지, 명령을 수신) / 비활성(아웃라인 배지, 연결되어 있으나 명령을 받지 않음). 활성 계정은 전체 CLI를 통틀어 항상 1개만 존재한다(Description 항목 3).
- **비활성 계정 클릭**: 해당 계정이 활성으로 전환된다(이전에 활성이던 계정이 비활성으로 바뀐다는 뜻이지만, 디자인에는 전환 애니메이션이나 이전 활성 계정의 표시는 없다).
- **연결 버튼 클릭(Codex/Grok, 미연결 CLI)**: 기본 브라우저로 해당 서비스 로그인 페이지가 열린다. 로그인 완료 후 앱으로 복귀하면 계정이 해당 CLI 하위 목록에 추가된다. 최초로 연결된 계정은 자동으로 활성 상태가 된다(Description 항목 4).
- **"계정 추가"(Claude 헤더 우측)**: 이미 연결된 CLI에 계정을 하나 더 연결하는 액션으로 추정되나, "연결" 버튼과 달리 테두리/배경이 없는 순수 텍스트로 렌더링되어 있어 클릭 가능 여부가 시각적으로 불명확하다(Open questions 참조).
- **단계 표시(진행 점)**: 무채색 고정, 현재 3단계 중 2번째. 이 보드에는 이전 단계로 돌아가는 조작이 보이지 않는다(Description 항목 5).
- **"계속" 버튼**: 다음 단계로 이동. 화면 내 유일한 브랜드색 요소. Description 항목 5는 "CLI를 연결하지 않으면 앱이 아무 일도 하지 못한다"고 명시하지만, 이 보드는 CLI가 이미 2개 연결된 상태만 보여줄 뿐 0개 연결 상태에서 버튼이 비활성화되는 모습은 없다.
- **완료 시**: 대화 창이 기본 높이(204px)로 축소되며 화면 AT-CH-001로 전환된다(각주 1). 이 전환 자체는 이 보드에 그려져 있지 않다.
- 이 보드가 그리지 않는, 그러나 텍스트가 존재를 암시하는 상태: 계정 0개(전체 미연결)에서의 "계속" 버튼 상태, 로그인 실패/취소 시의 에러 상태, 연결 진행 중(브라우저 대기) 로딩 상태.

## 데이터 계약

이 화면이 필요로 하는 데이터와 발생시키는 액션:

- **CLI 공급자 목록**: 고정 순서 4종 `[Claude, Gemini, Codex, Grok]`. 설치 여부 판별 불필요 — 고정 표시.
- **공급자별 연결 상태**: 각 CLI가 연결됨/미연결됨인지(=계정 1개 이상 존재 여부).
- **공급자별 계정 목록**: 이메일(또는 식별자) 문자열, 그리고 전체 앱에서 단 1개인 전역 활성 계정 플래그.
- **액션 — 계정 연결**: "연결"(미연결 CLI) 또는 "계정 추가"(이미 연결된 CLI) 클릭 → 기본 브라우저로 해당 서비스 로그인 페이지 오픈 → 로그인 완료 콜백으로 앱에 계정 추가.
- **액션 — 활성 계정 전환**: 비활성 계정 행 클릭 → 해당 계정을 전역 활성으로 설정(기존 활성 계정은 비활성으로).
- **액션 — 다음 단계**: "계속" 클릭 → 온보딩 단계 진행, 마지막 단계 완료 시 창 축소 + AT-CH-001로 라우팅.

**백엔드 매핑(조사 결과)**: `backend/athena_mcp/__main__.py`의 CLI 서브커맨드(`register/list/show/approve/revoke/probe/allow/rename/remove/doctor/serve`)와 `backend/athena_mcp/onboarding.py`(`stage_registration`, `stage_from_snippet`, `probe_server` 등)는 전부 **임의의 MCP 서버를 게이트웨이에 등록/승인하는 절차**를 다룬다 — "클로드 데스크탑 스니펫"을 파싱해 별칭을 부여하고 승인·probe하는 흐름이며, `backend/athena_mcp/server.py`가 명시하듯 아키텍처는 `Claude Code CLI → Athena Gateway → 등록된 MCP 서버 N개`다. 이는 이 화면이 다루는 "Claude/Gemini/Codex/Grok CLI 계정에 브라우저로 로그인해서 Athena가 그 CLI를 제어한다"는 개념과 **다른 도메인**이다. `backend/athena_api` 및 `backend/athena_mcp` 전체를 `claude|gemini|codex|grok` 키워드로 검색한 결과 이 화면이 요구하는 다음 항목에 대응하는 코드가 전혀 없다:
  1. CLI 공급자별 연결 상태 조회
  2. 공급자당 다중 계정 저장 + 전역 활성 계정 플래그
  3. 브라우저 로그인 트리거/콜백(OAuth 또는 CLI 로그인 명령 위임) 메커니즘

  이 갭은 스펙 패널 각주 2("브라우저 로그인 연동 방식... 미정 — 협의 필요")가 이미 명시적으로 인정하고 있다. 즉 백엔드가 없는 게 아니라, **설계 자체가 아직 결정되지 않았다.**

## Open questions

1. **"5개 항목" 재해석**: 작업 지시에는 "CLI List 프레임이 5개 항목을 담고 있다"고 되어 있었으나, `get_children(F5-0)`으로 확인한 결과 5개 자식 중 CLI는 4개(Claude/Gemini/Codex/Grok)뿐이고 5번째는 안내 텍스트 블록(G4-0, "연결을 누르면...")이다. CLI 종류는 4종이 맞다(스펙 패널 Description 항목 2 "지원하는 CLI 4종"과 일치).
2. **"계정 추가"의 상호작용 성격 불명확**: Claude 헤더 우측의 "계정 추가"는 "연결" 버튼(테두리/배경 있는 칩)과 달리 배경·테두리가 없는 순수 텍스트로 렌더링되어 있다. 클릭 가능한 버튼인지, 아니면 단순 상태 라벨인지 디자인만으로는 판단할 수 없다.
3. **"최초 연결된 계정은 자동으로 활성 상태가 된다"의 범위 불명확**(Description 항목 4): "최초"가 앱 전체 기준(첫 계정 연결 시점)인지, CLI별 기준(그 CLI에 처음 연결된 계정)인지 불분명하다. 예: 이미 Claude 계정이 활성인 상태에서 Codex를 처음 연결하면, Codex 계정이 자동으로 전역 활성이 되어 Claude 활성 계정을 대체하는지, 아니면 비활성으로 추가되는지 스펙에 명시가 없다.
4. **브라우저 로그인 연동 방식 자체가 미정**: 스펙 패널 각주가 빨간색으로 명시적으로 표시한 미해결 이슈(OAuth 리다이렉트 vs CLI 로그인 명령 위임). 구현 착수 전 협의가 필요하다.
5. **"계속" 버튼의 비활성 상태 미표시**: Description 항목 5는 CLI 미연결 시 앱이 기능하지 못한다고 명시하지만, 이 보드는 항상 CLI 2개가 연결된 상태만 보여준다. 0개 연결 상태에서 버튼을 비활성화할지, 클릭 시 경고를 띄울지는 디자인에 없다.
6. **에러/로딩 상태 없음**: 브라우저 로그인 실패·취소·타임아웃에 대한 시각 상태가 이 보드에는 전혀 없다.
7. **온보딩 창과 기본 대화 창의 관계**: 각주 1과 캔버스 주석(GS-0)은 "이 화면은 별도 창이 아니라 대화 창이 최대 높이로 확장된 상태"라고 명시하지만, 이 보드에는 기본(204px) 대화 창 자체가 그려져 있지 않다 — 공유되는 창 크롬(타이틀바 등)이 있는지는 다른 보드와 대조해야 한다.
