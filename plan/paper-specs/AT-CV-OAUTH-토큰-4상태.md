# 24 · AT-CV-OAUTH 토큰 4상태

- Paper node: 1Q0-0 | artboard "17 · AT-CH-005 토큰 4상태" (구 "24 · AT-CV-OAUTH 토큰 4상태" — 파일 재번호·ID 개명, 2026-08-17 확인)
- Mockup window subtree: "Mockup Area" (1Q1-0), 1508×1080 (dark backdrop panel; no OS-chrome "window" frame exists on this board — content sits directly on the dark section background)
- Screenshot (full artboard, mockup + spec panel): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1Q0-0-14008.jpg
- Screenshot (mockup area only): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1Q1-0-35172.jpg

## 무엇을 하는 화면인가

계좌 등록 이후 OAuth 토큰이 거치는 4가지 상태(인증 필요 → 토큰 준비됨 → 재발급 중 → 만료됨)를 보여주는 화면/컴포넌트 스펙이다. 화면은 계좌 등록 이후 상시 노출되며, 네 상태 모두 동일한 카드 레이아웃(창 높이 불변)을 쓰고 숫자와 색만 바뀐다. 실제 UI는 이 네 상태 중 정확히 하나만 항상 렌더링한다 — 이 보드는 스펙 설명을 위해 넷을 동시에 쌓아 보여줄 뿐이다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-CV-OAUTH
- 화면 명: 인증 (토큰 4상태)
- 위치: 계좌 등록 이후 상시

**Description**
1. 인증 필요
   - : 계좌는 등록됐으나 토큰이 없는 구간
   - – 숫자 자리를 빈 칸으로 지킨다. 0으로 채우지 않는다
   - – 유일한 행동은 발급
2. 토큰 준비됨
   - : 남은 시간을 1초마다 로컬에서 다시 센다
   - – 등폭 숫자 고정. 매초 자릿수가 바뀌어도 흔들리지 않는다
   - – 재발급을 직접 누를 수도 있다
3. 재발급 중
   - : 남은 시간이 임계 아래로 내려간 순간 한 번만 발사된다
   - – 숫자가 주황으로 바뀐다. 계속 줄어든다
   - – 두 버튼 모두 잠긴다. 중복 발사를 막는다
   - – 성공하면 ②로 돌아가고 숫자가 다시 찬다
4. 만료됨
   - : 자동 재발급이 실패했을 때만 도달한다
   - – 채도를 뺀 회색. 빨강을 쓰지 않는다
   - – 직전 만료 시각은 지우지 않는다
   - – 다음 확인에서 ①로 되돌아간다

- ※ 설정 없음(앱키 미설정)은 5번째 상태이나 현재 백엔드가 항상 참을 반환해 도달할 수 없다

**타이머 3종 (구현 요구사항)** (회색 박스로 강조)
- 숫자 갱신 1초 — 렌더러 로컬. 모션 축소 모드에서도 계속 갱신한다
- 상태 확인 60초 — Electron main. 읽기 전용 라우트 필요
- 자동 재발급 임계 10분 — 한 번만 발사. 중복 방지 가드 필수

- ※ 읽기 전용 상태 라우트 없음 — 발급·폐기 둘 다 상태를 바꾼다. 지금 구조로 확인하면 매번 새 토큰이 발급된다 (적색 강조)
- ※ 토큰 수명 미실측 — 60초 · 10분은 후보값이다. 실측 후 확정 필요 (적색 강조)

Page: 24

## 목업 구조

```
Mockup Area (1508×1080, bg #0A0B0E + gradient backdrop + glow — presentation only)
├─ Header block (absolute, left 100 top 76, w 1000)
│  ├─ "AT-CV-OAUTH" — mono kicker
│  ├─ "토큰 4상태" — H1
│  └─ "계좌 등록 이후 토큰이 거치는 상태. 창 높이는 변하지 않고 숫자와 색만 바뀐다." — subhead
├─ 상태 카드 × 4 (동일 레이아웃, absolute, w 1308, h 153, top이 각각 232/424/616/808px — 카드 사이 간격 39px)
│  각 카드:
│  ├─ Header row (h 104, padding-inline 34, gap 28)
│  │  ├─ Status badge group (w 190, gap 9)
│  │  │  ├─ Dot (7×7, pill) — 상태색
│  │  │  └─ Label text — 상태명 ("인증 필요" / "토큰 준비됨" / "재발급 중" / "만료됨")
│  │  ├─ Timer group (grow, gap 2)
│  │  │  ├─ Timer digits (mono, 44px, tabular-nums) — HH:MM:SS 또는 placeholder dashes
│  │  │  └─ Sub-label — 보조 설명 텍스트 (만료 시각 / "토큰이 없다" 등)
│  │  └─ Action button (h 38, padding-inline 18, radius 6) — "발급" / "지금 재발급" / "발급 중"(비활성) / "발급"
│  └─ Footer row (h 48, padding-inline 34, top border) — 카드별 구현 노트 1줄
├─ 번호 배지 × 4 (red squares, 26×26, 카드 왼쪽 바깥 — 스펙 주석용, 실제 UI 아님. 지침에 따라 구현 제외)
└─ Flow strip (하단, w 1308) — "① 인증 필요 ──▶ ② 준비됨 ──▶ ③ 재발급 중 ──▶ ② 준비됨" + 우측 "④ 만료는 자동 재발급이 실패했을 때만 도달한다 · 창 높이 불변"
```

## 레이아웃 · 스타일

**전체 배경 (Mockup Area, 참고용 — 실제 앱 배경은 별도 결정)**
- `bg-[#0A0B0E]`, 위에 대각선 그라디언트 + 라디얼 글로우 오버레이. 이 레이어들은 스펙 시트 프레젠테이션용 배경이며 구현 대상이 아니다.

**Header block**
- Kicker "AT-CV-OAUTH": `font-mono` (var(--font-mono), Geist Mono) · `text-desc`(13px)/line-height 18px · `letter-spacing 0.18em` · color `#FFFFFF66`
- Title "토큰 4상태": `font-kr-bold`(DakiB) · **26px**/line-height 34px — 주의: 26px는 토큰 스케일(desc13/label14/body15/head20)에 없는 임의값
- Subhead: `font-kr`(DakiL/Daki) · `text-label`(14px)/line-height 23px (5.75 스케일) · color `#E6E8EE9E`

**상태 카드 (공통, 4개 동일)**
- Width 1308px, border-radius **18px**, overflow clip
- Border: 1px solid `#FFFFFF38`, `background-origin: border-box`
- Background: `linear-gradient(45deg, oklab(24% -.0008 -0.020 / 90%) 0%, oklab(22.2% -0.001 -0.019 / 95.7%) 40%, oklab(92.9% -0.003 -0.012 / 16%) 100%)` — 다크 유리 카드에 상단 대각선으로 은은한 하이라이트가 스치는 형태
- Box-shadow: `#FFFFFF66 0 2px 0 inset, #0000009E 0 24px 56px` (상단 inset 하이라이트 + 아래로 퍼지는 드롭섀도)
- Header row: height 104px, `padding-inline: 34px`, `gap: 28px`, `align-items: center`
- Footer row: height 48px, `padding-inline: 34px`, top border `1px solid #FFFFFF12`
- 카드 세로 간격(각 카드 top): 232 / 424 / 616 / 808px → 카드 높이 153px 기준 카드 간 여백 39px
- 좌측 인셋: 카드 left 100px (헤더 블록과 동일 좌측 정렬)

**Status badge (dot + label)**
- Group: width 190px, gap 9px
- Dot: 7×7px, `border-radius: 999px` (var(--radius-pill))
  - 인증 필요: `var(--color-warn)` #FF9838
  - 토큰 준비됨: `var(--color-ok)` #5FCE3F
  - 재발급 중: `var(--color-warn)` #FF9838
  - 만료됨: `#E6E8EE4D` (dim, 토큰 없는 회색)
- Label: `font-kr-bold`(DakiB) · `text-body`(15px)/line-height 20px
  - 인증 필요 / 토큰 준비됨 / 재발급 중: color `var(--color-k-text)` #E6E8EE (밝음)
  - 만료됨: color `#E6E8EE8C` (dim)

**Timer group**
- gap 2px, grow to fill
- Timer digits: `font-mono`(Geist Mono) · 44px/line-height 50px · `letter-spacing: -1px` · `font-feature-settings: 'tnum'` (등폭 숫자)
  - 인증 필요: `— — : — — : — —` placeholder, color `#E6E8EE4D`
  - 토큰 준비됨: `05:47:12`, color `var(--color-k-text)` #E6E8EE (밝은 흰색)
  - 재발급 중: `00:09:41`, color `var(--color-warn)` #FF9838 (주황)
  - 만료됨: `00:00:00`, color `#E6E8EE4D` (인증 필요와 동일한 dim 톤 — 둘 다 "죽은" 상태)
- Sub-label: `font-kr`(DakiL) · `text-desc`(13px)/line-height 18px · color `#E6E8EE73` (전 상태 공통)
  - 인증 필요: "토큰이 없다"
  - 토큰 준비됨: "2026-08-15 18:30:00 만료"
  - 재발급 중: "남은 10분을 지나 자동으로 걸렸다"
  - 만료됨: "다음 확인에서 인증 필요로 되돌아간다"

**Action button**
- height 38px, `padding-inline: 18px`, `border-radius: 6px`
- 인증 필요 — "발급": 채워짐, `background: var(--color-brand)` #EE137B, 텍스트 `#FFFFFF`, `text-label`(14px)/18px
- 토큰 준비됨 — "지금 재발급": 아웃라인, `border: 1px solid #FFFFFF29`, 텍스트 `#E6E8EE8C`
- 재발급 중 — "발급 중" (비활성 표시): 아웃라인, `border: 1px solid #FFFFFF14`(더 옅음), 텍스트 `#E6E8EE4D`(더 옅음) — 두 버튼 모두 잠긴 상태를 시각적으로 표현
- 만료됨 — "발급": 아웃라인, `border: 1px solid #FFFFFF29`, 텍스트 `#E6E8EE8C` — **주의**: 인증 필요 상태와 같은 "발급" 액션이지만 채워진 브랜드 핑크가 아니라 준비됨 상태와 같은 옅은 아웃라인 스타일을 쓴다 (아래 Open questions 참조)

**Footer note (카드별 구현 노트)**
- `font-kr`(DakiL) · `text-desc`(13px)/18px · color `#E6E8EE8C` (4개 카드 공통)

**Flow strip (하단 흐름 다이어그램)**
- 활성 상태 라벨: color `#E6E8EE9E`
- 화살표 "──▶": color `#E6E8EE4D`
- 우측 각주(④): color `#E6E8EE73`
- 모두 `font-kr`(DakiL) · `text-desc`(13px)/18px

**색 토큰 참조 (get_tokens 기준)**
| 토큰 | 값 | 이 화면에서의 용도 |
|---|---|---|
| `--color-warn` | #FF9838 | 인증 필요/재발급 중 dot, 재발급 중 타이머 |
| `--color-ok` | #5FCE3F | 토큰 준비됨 dot |
| `--color-brand` | #EE137B | 발급 버튼(1차 CTA) |
| `--color-k-text` | #E6E8EE | 밝은 라벨/타이머 텍스트 베이스 |
| `--color-doc-red` | #E60012 | 번호 배지(구현 제외 대상) |
| `--font-kr` / `--font-kr-bold` | Daki / Daki B | 본문/제목 서체 |
| `--font-mono` | Geist Mono | 카운트다운 숫자, 킥커 |
| `--text-desc` / `--text-label` / `--text-body` | 13 / 14 / 15px | 본문 텍스트 스케일 |
| `--radius-pill` | 999px | 상태 dot |

## 텍스트 · 라벨 전문

읽기 순서대로, 목업 영역만:

1. `AT-CV-OAUTH` (kicker)
2. `토큰 4상태` (H1)
3. `계좌 등록 이후 토큰이 거치는 상태. 창 높이는 변하지 않고 숫자와 색만 바뀐다.` (subhead)
4. 카드 1 — `인증 필요` / `— — : — — : — —` / `토큰이 없다` / `발급` (버튼) / `계좌는 등록됐고 토큰만 없는 상태. 카운트다운을 그리지 않고 자리만 지킨다.` (footer)
5. 카드 2 — `토큰 준비됨` / `05:47:12` / `2026-08-15 18:30:00 만료` / `지금 재발급` (버튼) / `1초마다 로컬에서 다시 센다. 서버를 부르지 않는다.` (footer)
6. 카드 3 — `재발급 중` / `00:09:41` / `남은 10분을 지나 자동으로 걸렸다` / `발급 중` (버튼, 비활성) / `임계에 닿는 순간 한 번만 발사된다. 두 버튼 모두 잠기고 숫자는 계속 줄어든다.` (footer)
7. 카드 4 — `만료됨` / `00:00:00` / `다음 확인에서 인증 필요로 되돌아간다` / `발급` (버튼) / `빨강을 쓰지 않는다 — 그 색은 상승이다. 죽은 상태는 채도를 뺀다.` (footer)
8. Flow strip — `① 인증 필요` `──▶` `② 준비됨` `──▶` `③ 재발급 중` `──▶` `② 준비됨` ... `④ 만료는 자동 재발급이 실패했을 때만 도달한다 · 창 높이 불변`
9. 번호 배지 `1` `2` `3` `4` (구현 제외 — 스펙 주석)

## 상태 · 인터랙션

이 보드는 4개 상태를 동시에 나열해서 보여주지만, 실제 UI는 **정확히 하나의 카드만 항상 렌더링**한다 (창 높이 불변 — Description의 핵심 제약).

1. **인증 필요** (초기/토큰 없음)
   - 트리거: 계좌는 등록됐지만 토큰이 아직 발급되지 않음 (앱 최초 진입, 또는 만료 후 재확인 시점)
   - 표시: dot 주황, 타이머 자리는 빈 칸(placeholder dash, 0으로 채우지 않음), 서브라벨 "토큰이 없다", CTA 버튼 "발급"(브랜드 핑크, 채워짐, 활성)
2. **토큰 준비됨**
   - 트리거: 발급 성공, 또는 재발급 성공
   - 표시: dot 녹색, 타이머는 만료까지 남은 시간을 1초마다 로컬에서 카운트다운(등폭 숫자, 서버 재호출 없음), 서브라벨에 만료 절대 시각, 버튼 "지금 재발급"(아웃라인, 수동 재발급 가능)
3. **재발급 중**
   - 트리거: 남은 시간이 자동 재발급 임계값(10분, 후보값·미확정) 아래로 내려간 순간 **1회만** 자동 발사
   - 표시: dot 주황, 타이머 숫자가 주황색으로 바뀌고 계속 감소, 서브라벨 "남은 10분을 지나 자동으로 걸렸다", 버튼은 "발급 중"으로 라벨이 바뀌고 잠김(비활성, 더 옅은 스타일) — 중복 발사 방지를 위해 수동 재발급 버튼도 함께 잠김
   - 성공 시 → 토큰 준비됨(②)으로 복귀, 숫자 다시 채워짐
4. **만료됨**
   - 트리거: 자동 재발급이 **실패했을 때만** 도달 (정상 흐름에서는 도달하지 않는 예외 경로)
   - 표시: dot·라벨·타이머 모두 채도를 뺀 회색(`#E6E8EE4D`/`#E6E8EE8C`), 빨강 사용 금지, 타이머는 `00:00:00`으로 고정(직전 만료 시각은 지우지 않음 — 단, 이 보드의 서브라벨은 만료 시각 대신 "다음 확인에서 인증 필요로 되돌아간다"를 보여줌 → 아래 Open questions 참조), 버튼 "발급"(아웃라인 스타일, 활성)
   - 다음 상태 확인(60초 폴링) 시점에 자동으로 ①(인증 필요)로 되돌아감

명시된 흐름: `① 인증 필요 → ② 준비됨 → ③ 재발급 중 → ② 준비됨`, 그리고 예외 경로로 `③ 재발급 중(실패) → ④ 만료됨 → (다음 확인) → ① 인증 필요`.

**타이머 3종 (구현 요구사항, 스펙 패널 명시)**
- 숫자 갱신: 1초 주기, 렌더러(프런트) 로컬 카운트. **모션 축소(prefers-reduced-motion) 모드에서도 갱신은 멈추지 않는다** — 애니메이션만 줄이고 카운트다운 로직은 그대로 유지해야 함
- 상태 확인: 60초 주기, Electron **main** 프로세스에서 수행. 읽기 전용 라우트가 필요하다고 명시되어 있으나 **현재 백엔드에 없음** (아래 데이터 계약 참조)
- 자동 재발급 임계: 10분, **한 번만** 발사(중복 방지 가드 필수)

미도달 5번째 상태: "설정 없음(앱키 미설정)" — 백엔드가 `configured`를 항상 `true`로 반환해 현재 UI로는 진입 불가 (버그/제약, 아래 데이터 계약 참조).

## 데이터 계약

백엔드에서 확인한 실제 계약:

- **토큰 발급**: `POST /api/v1/internal/oauth/au10001` (Internal OAuth lifecycle 태그) — 내부적으로 `TokenManager.issue()` → `KiwoomAuth.issue_token()` 호출. Kiwoom mock `/oauth2/token`(api-id `au10001`)을 호출해 `token`/`expires_dt`를 받아 프로세스 메모리에만 보관. 응답 바디는 `{configured, ready, expires_at}` 형태(`TokenManager.status()`와 동일 shape). 소스: `backend/athena_api/kiwoom/auth.py` (`KiwoomAuth`, `TokenManager`), 라우트 등록: `backend/athena_api/generated/routes.py`(`_oauth_endpoint`) + `backend/athena_api/generated/runtime.py`(`call_internal_oauth`, tr_id `au10001`).
- **토큰 폐기/재발급 트리거**: `POST /api/v1/internal/oauth/au10002` — `TokenManager.revoke()` → `KiwoomAuth.revoke_token()`. Kiwoom mock `/oauth2/revoke`(api-id `au10002`) 호출 후 로컬 토큰 클리어. "지금 재발급" 버튼은 이 라우트(폐기) 이후 재발급(au10001)을 다시 호출하는 흐름일 가능성이 높음 — **재발급 전용 엔드포인트는 별도로 없음**, 화면상 "재발급"이 실제로 revoke+issue 두 콜인지 issue 단독 재호출인지는 코드에서 구분되지 않는다.
- **상태 읽기 (폴링)**: 스펙 패널이 요구하는 "상태 확인 60초 — 읽기 전용 라우트 필요"에 해당하는 **GET/읽기 전용 라우트가 존재하지 않는다**. `au10001`/`au10002` 모두 상태를 변경하는 POST이며, 둘 다 매 호출마다 `TokenManager.status()`를 반환할 뿐 순수 조회 라우트는 없다 — 스펙 패널의 적색 경고("읽기 전용 상태 라우트 없음 — 발급·폐기 둘 다 상태를 바꾼다")와 정확히 일치하는 **확인된 갭**.
- **`configured` 필드**: `TokenManager.status()`(`backend/athena_api/kiwoom/auth.py:173-179`)는 `"configured": True`를 하드코딩 반환하며 앱키/시크릿 설정 여부를 실제로 검사하지 않는다 — 스펙 패널의 "현재 백엔드가 항상 참을 반환해 도달할 수 없다" 메모와 정확히 일치하는 **확인된 갭/버그**.
- **`ready` / `expires_at`**: `KiwoomAuth.is_ready`(토큰 존재 + `expires_at > now`)와 `expires_at`(ISO 문자열)이 상태 판단의 근거. 화면의 4상태는 프런트에서 `ready`/`expires_at`/(재발급 진행 여부 로컬 플래그)를 조합해 파생해야 하며, "재발급 중"(③) 상태 자체를 나타내는 백엔드 필드는 없음 — 프런트/Electron main이 임계값(10분) 도달과 재발급 요청 인플라이트 여부를 자체적으로 추적해야 함.
- **인증 헤더**: `_oauth_endpoint`는 issue/revoke 둘 다 `Authorization` 헤더를 필수로 요구한다(`Annotated[str, Header(alias="Authorization")]`) — 어떤 자격증명이 들어가야 하는지는 이 파일 범위 밖(별도 인증 스펙 확인 필요).
- **토큰 수명 값**: 스펙 패널이 명시한 대로 "60초 · 10분은 후보값, 실측 미완료" — `KiwoomAuth`에는 하드코딩된 타이머 상수가 없고 `expires_dt`는 업스트림(Kiwoom mock) 응답에서 그대로 받아온다. 따라서 재발급 임계 10분·상태확인 60초는 **프런트/Electron 쪽에서 정책값으로 정해야 하는 값**이며 백엔드가 강제하지 않는다.
- **"계좌 등록"** 게이팅(이 화면이 노출되는 조건인 "계좌 등록 이후 상시"): `athena_api`/`athena_mcp` 어디에서도 "계좌 등록 상태"를 나타내는 필드나 라우트를 찾지 못했다 — 이 화면의 진입 조건을 판단할 백엔드 근거가 확인되지 않음 (명시적 갭).

## Open questions

1. **만료됨(④) 버튼 스타일 불일치**: "만료됨" 카드의 "발급" 버튼은 "인증 필요"(①) 카드의 동일한 "발급" 액션과 달리 브랜드 핑크 채움이 아니라 옅은 아웃라인(②/③ 카드와 같은 스타일)을 쓴다. 두 상태 모두 "토큰을 새로 발급해야 함"이라는 같은 의도인데 시각적 강조 수준이 다르다 — 의도된 디밈(예: 예외 상태라 CTA를 낮춤)인지, 단순 누락인지 스펙 패널에 설명이 없다.
2. **만료됨 상태의 서브라벨 내용**: Description 항목 4는 "직전 만료 시각은 지우지 않는다"고 명시하지만, 실제 카드의 서브라벨 텍스트는 만료 시각이 아니라 "다음 확인에서 인증 필요로 되돌아간다"로 되어 있다. 만료 시각을 어디에 표시할지(타이머 자리? 서브라벨 교체?) 이 보드만으로는 확정할 수 없다.
3. **"재발급"의 실제 API 시퀀스**: "지금 재발급" 버튼이 `au10002`(revoke) 이후 `au10001`(issue)을 순차 호출하는 것인지, 재발급 자체를 위한 다른 백엔드 흐름이 있는지 코드에 명시가 없다.
4. **읽기 전용 상태 라우트 부재**: 스펙 패널이 "필요"하다고 명시했지만 실제로 없다는 점은 이 화면 구현의 선행 과제(백엔드 라우트 추가)로 남는다. 60초 폴링을 어떤 엔드포인트로 할지 결정 필요.
5. **`configured` 하드코딩**: 5번째 상태(설정 없음)를 구현하려면 백엔드가 앱키/시크릿 존재 여부를 실제로 검사하도록 고쳐야 한다 — 이 화면 스펙 범위 밖일 수 있으나 4상태 중 어디에도 없는 상태이므로 언급.
6. **타이머 정책값 미확정**: 60초 상태확인 · 10분 자동 재발급 임계는 "후보값"이라고 스펙 패널이 명시 — 구현 전 실측/확정 필요.
7. **"계좌 등록" 게이팅 근거 없음**: 이 화면이 "계좌 등록 이후 상시" 노출된다는 조건을 판단할 백엔드 필드/라우트를 찾지 못했다.
8. 이 보드에는 다른 보드에서 언급된 "Onboarding Window" 같은 별도 창(제목바 등)이 없다 — 이 컴포넌트가 독립 창인지, 대시보드 내 섹션인지 스펙 패널에 명시되어 있지 않다.
