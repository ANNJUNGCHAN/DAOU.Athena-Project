# 25 · AT-CV-OAUTH 계좌 전환

- Paper node: 2J8-0 | artboard "25 · AT-CV-OAUTH 계좌 전환"
- Mockup window node: 2K5-0 "Switch Window", 800×690
- Screenshot (full artboard): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-2J8-0-34368.jpg
- Screenshot (mockup window only): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-2K5-0-33668.jpg

## 무엇을 하는 화면인가

토큰 상태 화면에서 계좌를 누르면 열리는 확장 패널(별도 창이 아님)로, 등록된 계좌 중 하나로 "전환"하는 화면이다. 이 전환은 목록에서 값을 고르는 단순 선택이 아니라 재인증 행위다 — 208개 Kiwoom operation 중 계좌번호를 요청 인자로 받는 TR이 하나도 없고, 계좌 컨텍스트는 요청이 아니라 자격증명(appkey/secret)에 묶여 있기 때문이다. 그래서 전환은 "현재 토큰 폐기 → 자격증명 교체 → 새 토큰 발급 → 실시간 재등록" 순서의 명시적 재인증 플로우로 그려진다.

## 스펙 패널 전문

### Meta

| 항목 | 값 |
|---|---|
| 화면 ID | AT-CV-OAUTH |
| 화면 명 | 인증 (계좌 전환) |
| 위치 | 토큰 상태 화면에서 계좌 선택 |

### Description

1. 전환 영역
   : 대화 창을 확장해 표시. 별도 창을 만들지 않는다
   – 토큰 상태 화면에서 계좌를 누르면 진입한다

2. 계좌 목록
   : 등록된 계좌를 고정 순서로 나열한다
   – 계좌번호는 마스킹한다. 앞 1자리와 증권사만 보인다
   – 모의 / 실계좌를 배지로 구분한다
   – 사용 중인 계좌는 브랜드 색 점으로 표시한다

3. 영향 고지
   : 전환의 대가를 누르기 전에 말한다
   – 현재 토큰 폐기 → 자격증명 교체 → 새 토큰 발급 순서
   – 실시간 구독은 끊겼다가 새 계좌로 재등록된다

4. 확정
   : 되돌릴 수 없는 행동이므로 명시적으로 누르게 한다
   – [전환하고 다시 인증] : 화면 내 유일한 브랜드 색 요소
   – 전환 중에는 토큰 상태 화면이 발급 중으로 바뀐다
   – 실패하면 직전 계좌로 되돌린다

### 하단 주석 (Description 블록 아래)

**왜 드롭다운이 아닌가**
208개 operation 전수 확인 결과 계좌번호를 요청 인자로 받는 TR이 하나도 없다. 계좌 컨텍스트는 요청이 아니라 자격증명(appkey/secret)에 묶인다.
따라서 전환은 재인증이다. au10002 폐기 → 자격증명 교체 → au10001 발급.

※ 런타임 자격증명 교체 경로 없음 — 현재 lifespan에서 1회만 구성된다. 클라이언트·WebSocket 재구성 필요
※ CredentialProcessLock이 머신당 1개 자격증명만 허용 — 두 계좌 동시 보유 불가
※ 전환은 원자적이지 않다 — 폐기 후 발급 실패 시 무인증 상태로 남는다. 롤백 정책 미정

### 목업 영역 내 주석(Note, 2RB-0 — 앱 UI 아님, 참고용)

AT-CV-OAUTH
계좌 전환은 목록에서 고르는 일이 아니라 인증을 다시 하는 일이다. 어떤 조회 API도 계좌번호를 인자로 받지 않기 때문이다.

## 목업 구조

```
Switch Window (2K5-0) 800×690 — 확장 패널 (별도 창 아님)
├─ Header block (2K6-0) 799×109 — 타이틀 영역
│  ├─ Text (2K7-0) "어느 계좌로 볼까요" — 헤딩
│  └─ Text (2K8-0) "계좌를 바꾸면 인증을 다시 합니다. 실시간 시세는 잠시 끊겼다가 새 계좌로 다시 붙습니다." — 서브텍스트/설명
├─ Body block (2M1-0) 799×492
│  ├─ Text (2M2-0) "등록된 계좌 3" — 섹션 라벨 (개수 포함, 모노스페이스)
│  ├─ Account row 1 — 사용 중 (2M4-0) 715×74 — 활성 상태 스타일
│  │  ├─ Dot (2M5-0) 7×7 — 채워진 원 (사용 중 표시)
│  │  ├─ Name/number block (2M6-0) 539×40
│  │  │  ├─ Text "모의투자 계좌" — 계좌명
│  │  │  └─ Text "8•••••••-•• · 키움증권" — 마스킹된 계좌번호 · 증권사 (모노스페이스, tabular-nums)
│  │  ├─ Badge (2M9-0) 40×22 — "모의" 배지 (파란 계열)
│  │  └─ Text (2MB-0) "사용 중" — 상태 라벨
│  ├─ Account row 2 — 선택 가능 (2MD-0) 715×74 — 비활성 상태 스타일
│  │  ├─ Ring (2ME-0) 7×7 — 빈 원(테두리만, 미채움)
│  │  ├─ Name/number block (2MF-0) 543×40
│  │  │  ├─ Text "위탁종합 계좌" — 계좌명
│  │  │  └─ Text "5•••••••-•• · 키움증권" — 마스킹된 계좌번호 · 증권사
│  │  ├─ Badge (2MI-0) 51×22 — "실계좌" 배지 (주황 계열)
│  │  └─ Text (2MK-0) "선택" — 클릭 가능 라벨
│  ├─ Account row 3 — 선택 가능 (2MM-0) 715×74 — row 2와 동일 스타일
│  │  ├─ Ring (2MN-0) 7×7
│  │  ├─ Name/number block (2MO-0) 543×40
│  │  │  ├─ Text "금현물 계좌" — 계좌명
│  │  │  └─ Text "5•••••••-•• · 키움증권"
│  │  ├─ Badge (2MR-0) 51×22 — "실계좌" 배지
│  │  └─ Text (2MT-0) "선택"
│  ├─ Warning callout (2QN-0) 715×27 — 좌측 세로 accent bar + 텍스트
│  │  ├─ Bar (2QO-0) 3×21 — var(--color-warn) 배경
│  │  └─ Text (2QP-0) "전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다."
│  └─ Step-flow row (2TA-0) 715×32 — 4단계 파이프라인 텍스트
│     "지금 토큰 폐기" ──▶ "자격증명 교체" ──▶ "새 토큰 발급" ──▶ "실시간 재등록"
└─ Footer bar (2QR-0) 799×88 — 상단 구분선 포함
   ├─ Text (2QS-0) "한 번에 한 계좌만 사용할 수 있습니다" — 좌측 안내문
   └─ Button group (2QT-0) 226×40
      ├─ Button (2QU-0) 66×40 — "취소" — secondary/ghost
      └─ Button (2QW-0) 150×40 — "전환하고 다시 인증" — primary (브랜드 색)
```

Mockup Area에는 이 외에 Desktop 배경, Glow, 번호 배지(1~4), Note 주석이 함께 있으나 이들은 스펙 시트 프레젠테이션 요소이며 구현 대상이 아니다.

## 레이아웃 · 스타일

**윈도우 (2K5-0)**
- 크기: 800×690px, `display:flex; flex-direction:column`
- border-radius: 22px, overflow: clip
- border: 1px solid `#FFFFFF4D`
- box-shadow: `#FFFFFF8F 0 2px 0 inset, #FFFFFF09 0 0 0 4px, #000000C7 0 46px 104px`
- 배경: `linear-gradient(in oklab 45deg, oklab(24% -.0008 -0.020 / 90%) 0%, oklab(22.2% -0.001 -0.019 / 95.7%) 40%, oklab(92.9% -0.003 -0.012 / 20%) 100%)` — 짙은 남색 계열 유리질 그라데이션, background-origin: border-box

**헤더 블록 (2K6-0)**
- padding-top 40px, padding-inline 42px, gap 11px, flex-shrink 0
- 헤딩 "어느 계좌로 볼까요" (2K7-0): font-family `DakiB`("Daki B"), 28px/36px, letter-spacing -0.005em, color `var(--color-k-text)` (`#E6E8EE`)
- 서브텍스트 (2K8-0): font-family `DakiL`("Daki"), 14px/22px (`text-label/5.5`), color `#E6E8EE9E`

**본문 블록 (2M1-0)**
- flex-grow 1, padding-top 26px, padding-inline 42px, gap 10px
- 섹션 라벨 "등록된 계좌 3" (2M2-0): font-family `Geist Mono`, 11px/16px, letter-spacing 0.06em, color `#E6E8EE59`

**계좌 행 (2M4-0 / 2MD-0 / 2MM-0)**
- 공통: height 74px, flex-shrink 0, padding-inline 20px, border-radius 10px, gap 16px, `display:flex; align-items:center`
- 사용 중(row 1): background `#FFFFFF0F`, border 1px solid `#FFFFFF38`
- 선택 가능(row 2/3): background 투명, border 1px solid `#FFFFFF1A` (사용 중보다 옅음)
- 상태 점(dot): 7×7px, `border-radius: var(--radius-pill)`(999px) — 사용 중은 채움 `var(--color-ok)`(`#5FCE3F`), 선택 가능은 빈 원 (border 1px solid `#FFFFFF38`, 배경 없음)
- 계좌명: font-family `DakiB`, `text-body`(15px)/20px, color `var(--color-k-text)`
- 계좌번호·증권사: font-family `Geist Mono`, tabular-nums, 12px/17px, color `#E6E8EE73`
- 배지("모의"/"실계좌"): height 22px, padding-inline 9px, border-radius `var(--radius-pill)`(999px)
  - "모의" 배지: background `#7AA0C829`(파란 계열), 텍스트 color `#C8DCF0DB`, 12px/16px
  - "실계좌" 배지: background `#FF983829`(주황 계열), 텍스트 color `var(--color-warn)`(`#FF9838`), 12px/16px
- 우측 상태 라벨: font-family `DakiL`, `text-desc`(13px)/18px
  - "사용 중": color `#E6E8EE9E` (진함)
  - "선택": color `#E6E8EE73` (옅음, row 2/3 공통)

**경고 콜아웃 (2QN-0)**
- padding-top 6px, gap 10px, `display:flex`
- accent bar (2QO-0): width 3px, border-radius `var(--radius-pill)`, background `var(--color-warn)`
- 텍스트 (2QP-0): font-family `DakiL`, 13px/21px, color `#E6E8EE9E`

**단계 흐름 행 (2TA-0)**
- padding-top 14px, padding-left 15px, gap 12px, `display:flex; align-items:center`
- 각 단계 텍스트: font-family `DakiL`, `text-desc`(13px)/18px, color `#E6E8EE9E`
- 구분 화살표 "──▶": 동일 폰트/크기, color `#E6E8EE47` (더 옅음)

**푸터 바 (2QR-0)**
- height 88px, flex-shrink 0, padding-inline 42px, `display:flex; align-items:center; justify-content:space-between`
- 상단 border-top 1px solid `#FFFFFF17`
- 안내 텍스트: font-family `DakiL`, `text-desc`(13px)/18px, color `#E6E8EE73`
- 버튼: height 40px, padding-inline 20px, border-radius 6px(토큰 미매핑, radius-sm 4px과 다른 커스텀 값)
  - "취소": 배경 없음(투명), 텍스트 color `#E6E8EE8C`, font-family `DakiL`, `text-label`(14px)/18px
  - "전환하고 다시 인증": background `var(--color-brand)`(`#EE137B`), 텍스트 color `#FFFFFF`(white), font-family `DakiL`, `text-label`(14px)/18px — 화면 내 유일한 브랜드 색 요소

## 텍스트 · 라벨 전문

읽는 순서대로, 목업 윈도우(2K5-0) 내부 문자열만:

1. "어느 계좌로 볼까요" — 헤딩
2. "계좌를 바꾸면 인증을 다시 합니다. 실시간 시세는 잠시 끊겼다가 새 계좌로 다시 붙습니다." — 서브텍스트
3. "등록된 계좌 3" — 섹션 라벨
4. "모의투자 계좌" — 계좌명 (row 1)
5. "8•••••••-•• · 키움증권" — 마스킹 계좌번호·증권사 (row 1)
6. "모의" — 배지 (row 1)
7. "사용 중" — 상태 라벨 (row 1)
8. "위탁종합 계좌" — 계좌명 (row 2)
9. "5•••••••-•• · 키움증권" — 마스킹 계좌번호·증권사 (row 2)
10. "실계좌" — 배지 (row 2)
11. "선택" — 상태 라벨 (row 2)
12. "금현물 계좌" — 계좌명 (row 3)
13. "5•••••••-•• · 키움증권" — 마스킹 계좌번호·증권사 (row 3)
14. "실계좌" — 배지 (row 3)
15. "선택" — 상태 라벨 (row 3)
16. "전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다." — 경고 콜아웃
17. "지금 토큰 폐기" — 단계 1
18. "──▶" — 구분자
19. "자격증명 교체" — 단계 2
20. "──▶" — 구분자
21. "새 토큰 발급" — 단계 3
22. "──▶" — 구분자
23. "실시간 재등록" — 단계 4
24. "한 번에 한 계좌만 사용할 수 있습니다" — 푸터 안내문
25. "취소" — 버튼
26. "전환하고 다시 인증" — 버튼(primary)

## 상태 · 인터랙션

보드에는 정적으로 **하나의 상태만** 그려져 있다: 계좌 목록이 로드되고 사용 중 계좌(모의투자 계좌)가 강조된, 전환 전 대기 상태. 스펙 패널이 명시적으로 요구하는 상태/인터랙션은 다음과 같다:

- **진입**: 토큰 상태 화면에서 계좌를 누르면 이 패널이 대화 창 내부에서 확장되어 나타난다. 별도 창(윈도우)을 새로 만들지 않는다.
- **목록 상태**: 등록된 계좌를 고정 순서로 나열. 각 행은 마스킹된 계좌번호(앞 1자리 + 증권사만 노출), 모의/실계좌 배지, 사용 중 여부(브랜드색 점 — 단, 보드 실물은 브랜드색이 아니라 `var(--color-ok)` 초록 점을 사용함, "Open questions" 참조)로 구성.
- **행 선택**: "선택" 라벨이 붙은 비활성 행(2/3)을 누르면 해당 계좌가 전환 대상으로 선택되는 것으로 추정된다(보드에는 선택 후 하이라이트 상태가 별도로 그려져 있지 않음).
- **영향 고지**: 확정 버튼을 누르기 전에 경고 콜아웃과 4단계 파이프라인 텍스트("지금 토큰 폐기 → 자격증명 교체 → 새 토큰 발급 → 실시간 재등록")로 결과를 미리 알린다. 이 텍스트는 정적으로 항상 노출되며, 진행 상태를 나타내는 것이 아니다(진행 중 하이라이트 같은 시각적 변화는 이 보드에 없음).
- **확정/취소**: "취소"(고스트 버튼)와 "전환하고 다시 인증"(브랜드색 primary 버튼, 화면 내 유일한 브랜드색 요소) 두 액션.
- **전환 중** (스펙 패널만 언급, 이 보드에는 미표시): 전환이 시작되면 이 패널이 아니라 "토큰 상태 화면"이 "발급 중" 상태로 바뀐다. 이 패널 자체의 로딩/스피너 상태는 이 보드에 없다.
- **실패** (스펙 패널만 언급, 이 보드에는 미표시): 전환 실패 시 직전 계좌로 되돌린다. 실패 UI(에러 메시지, 재시도 버튼 등)는 이 보드에 없다.
- **성공** (미표시): 성공 시 패널이 닫히고 토큰 상태 화면이 새 계좌 기준으로 갱신되는 것으로 추정되나, 보드/스펙 모두 명시하지 않음.

## 데이터 계약

**목록 표시에 필요한 데이터**
- 등록된 계좌 배열: 계좌명(예: "모의투자 계좌"), 마스킹된 계좌번호(앞 1자리 노출 + 마스킹, 예: "8•••••••-••"), 증권사명("키움증권"), 계좌 구분(모의/실계좌), 현재 사용 중 여부.
- **백엔드 갭**: `backend/athena_api`에는 "등록된 계좌 목록"이라는 개념이 전혀 없다. `Settings`(`backend/athena_api/config.py`)는 앱키/시크릿키를 **한 쌍**만 담는 단일 자격증명 모델이다(`kiwoom_app_key`, `kiwoom_secret_key` — 리스트 아님). 여러 계좌를 등록/나열/전환하는 저장소나 API가 없으므로, 이 화면이 그리는 "3개 계좌 목록"은 지금 백엔드로는 채울 수 없다. 새로 설계해야 한다(계좌 레지스트리 + 각 계좌별 자격증명 보관 방식).

**전환 액션이 실제로 호출해야 할 것**
- 폐기: `KiwoomAuth.revoke_token()` → Kiwoom `au10002`(`/oauth2/revoke`) — `backend/athena_api/kiwoom/auth.py:119`
- 발급: `KiwoomAuth.issue_token()` / `TokenManager.issue()` → Kiwoom `au10001`(`/oauth2/token`) — 같은 파일 `:77, :161`
- **백엔드 갭 (핵심)**: `KiwoomAuth`, `KiwoomClient`, `TokenManager`는 모두 `backend/athena_api/lifespan.py`의 `build_lifespan()`에서 **애플리케이션 시작 시 1회만** 단일 자격증명 쌍으로 구성되고 `app.state`에 고정된다. 런타임에 자격증명을 교체하고 `KiwoomAuth`/`KiwoomClient`/`KiwoomWsClient`를 다시 만드는 경로가 존재하지 않는다 — 스펙 패널의 빨간 주석("런타임 자격증명 교체 경로 없음")과 정확히 일치한다. 이 화면을 실제로 동작시키려면 lifespan 리소스를 재구성하는 신규 API/서비스가 필요하다.
- **동시성 제약**: `CredentialProcessLock`(`backend/athena_api/process_lock.py`)이 파일 락으로 "머신당 1개 자격증명 프로세스"를 강제한다. 두 계좌를 동시에 살려둘 수 없다는 스펙 문구와 일치하며, 전환 시 기존 프로세스가 락을 놓고 새 프로세스(또는 재구성된 상태)가 락을 잡는 절차가 필요하다.
- **실시간 재등록**: `KiwoomWsClient`(`app.state.kiwoom_ws_client`)를 폐기 후 새 토큰으로 재시작해야 한다. 현재 `build_lifespan`은 시작 시 한 번만 `ws_client.start()`를 호출하며, 재시작을 트리거하는 API가 없다.
- **HTTP 노출 갭**: `backend/athena_api/main.py`에는 `/health`, `/ready`와 `api_router`(생성된 Kiwoom TR 208개)만 등록되어 있다. `token_manager`(`TokenManager.issue/revoke/status`, `backend/athena_api/dependencies.py:60`)를 사용하는 라우트가 어디에도 없다 — "토큰 상태 화면"과 "계좌 전환" 모두 아직 백엔드 엔드포인트가 없다.
- **실계좌 안전장치**: `Settings.validate_runtime_safety()`(`backend/athena_api/config.py:41`)는 `kiwoom_base_url`이 Kiwoom mock 도메인이 아니면 예외를 던진다. 즉 현재 백엔드는 **실계좌(모의가 아닌) 연결 자체를 하드 차단**하고 있다 — 이 보드가 그리는 "위탁종합 계좌", "금현물 계좌" 같은 실계좌(실계좌 배지) 전환은 이 안전장치가 풀리기 전까지는 구현 대상이 아니다.
- **CLI와의 관계**: `backend/athena_mcp/__main__.py`의 서브커맨드(register/list/show/approve/revoke/probe 등)는 MCP 서버 레지스트리(외부 도구 서버 등록/승인) 도구이며, 이 화면의 "계좌"/"Kiwoom OAuth 토큰" 개념과는 무관하다.

## Open questions

1. **"브랜드 색 점" vs 실제 색**: 스펙 패널 2-④ 항목은 "사용 중인 계좌는 브랜드 색 점으로 표시한다"고 명시하지만, 목업 실물(2M5-0)의 점 색상은 `var(--color-ok)`(`#5FCE3F`, 초록)이며 `var(--color-brand)`(`#EE137B`, 마젠타/핑크)가 아니다. 스펙 텍스트와 실제 디자인 값이 모순된다.
2. **선택 상태 미표시**: "선택" 라벨이 붙은 행(위탁종합/금현물)을 눌렀을 때의 하이라이트/선택됨 상태가 이 보드에 없다. 확정 버튼을 누르기 전에 어떤 계좌가 전환 대상인지 어떻게 시각적으로 표시되는지 불명확하다.
3. **로딩/진행/실패 상태 없음**: 스펙 패널은 "전환 중에는 토큰 상태 화면이 발급 중으로 바뀐다"와 "실패하면 직전 계좌로 되돌린다"를 명시하지만, 이 화면 자체(패널)의 로딩 스피너, 비활성화된 버튼, 에러 메시지 등 중간/실패 상태 UI는 어디에도 그려져 있지 않다. 다른 보드(토큰 상태 화면)에 있을 가능성이 있으나 이 추출 범위 밖이다.
4. **버튼 border-radius 6px**: 다른 곳에서 쓰이는 `--radius-sm`(4px), `--radius-pill`(999px) 토큰 어디에도 맞지 않는 커스텀 6px 값이다. 디자인 시스템에 버튼 전용 radius 토큰이 따로 있는지, 아니면 이 보드만의 임의값인지 확인 필요.
5. **계좌 레지스트리의 소스**: "등록된 계좌"가 어디서 오는가(로컬 설정 파일, 별도 DB, Kiwoom 계정 조회 API 등)가 스펙에 없다. 백엔드에 다중 계좌 개념이 전혀 없으므로(위 데이터 계약 참고) 이 목록의 출처를 신규로 설계해야 한다.
6. **실계좌 정책과의 충돌**: 현재 백엔드는 mock 도메인 강제(`validate_runtime_safety`)로 실계좌 접속을 원천 차단한다. 이 보드가 실계좌 2개를 정상적인 전환 대상으로 그리는 것은 "모의만 허용" 정책이 언제 풀리는지, 혹은 이 화면이 그 정책 해제 이후를 가정한 미래 상태인지 확인이 필요하다.
