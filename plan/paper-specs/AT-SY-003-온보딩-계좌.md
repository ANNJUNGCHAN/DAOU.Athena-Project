# 23 · AT-SY-003 온보딩 계좌

- Paper node: 1K3-0 | artboard "10 · AT-SY-003 온보딩 (계좌 연결)" (구 "23 · AT-SY-003 온보딩 계좌" — 파일 재번호, 2026-08-17 확인)
- Screenshot (full artboard): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1K3-0-7992.jpg
- Screenshot (mockup window only): C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1M8-0-36048.jpg
- Mockup window node: 1M8-0 "Onboarding Window", 800×687

## 무엇을 하는 화면인가

온보딩의 마지막(3/3) 단계로, 별도 창이 아니라 대화 창을 최대 높이로 확장한 상태에서 표시된다. 키움 모의투자 계좌(별칭·APP KEY·SECRET KEY)를 입력받아 검증한 뒤 저장하는 화면이다. CLI 연결과 계좌 연결 둘 다 끝나야 대화 창이 기본 높이(204px)로 축소되고 앱이 시작된다. 같은 데이터(별칭/APP KEY/SECRET KEY)를 다루는 AT-ST-002(설정 화면의 계좌 등록)와는 진입 경로만 다르다 — 이 화면은 최초 실행 시 온보딩 플로우 안에서 강제로 거치는 3/3 단계이고, AT-ST-002는 설정에서 임의 시점에 여는 동일 폼이다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-SY-003
- 화면 명: 온보딩 (계좌 연결)
- 위치: 최초 실행 시 1회 · 3 / 3

**Description**
1. 온보딩 영역
   : 대화 창을 최대 높이로 확장한 상태. 별도 창이 아니다
   – 3 / 3 — 온보딩의 마지막 필수 단계
2. 별칭
   : 이 컴퓨터에서만 쓰는 이름. 증권사 계좌번호가 아니다
   – 비우면 "모의-1" 로 자동 부여
3. APP KEY / SECRET KEY
   : password 입력. 붙여넣기만 지원하고 자동완성·맞춤법검사를 끈다
   – 값 대신 문자 수만 표시 — 오타는 잡되 값은 노출하지 않는다
   – 입력값은 렌더러를 거치지 않고 메인 프로세스로 직행한다
4. 저장 위치 · 시작
   : Windows 자격증명 저장소(DPAPI) 암호화 저장. 화면·로그·스크린샷에 재표시 없음
   – 검증에 성공한 키만 저장된다. 실패하면 다음으로 넘어가지 않는다
   – 건너뛰기 없음. 계좌 없이는 시세·잔고를 한 줄도 읽을 수 없다
   – 완료 시 대화 창이 204px로 축소되고 AT-CH-001로 전환
   – 최초 등록 계좌는 자동으로 활성이 된다. 활성 계좌는 항상 하나다 (AT-ST-001)

각주(Description 아래, 번호 없이):
- ※ 접근성 3종(투명도·대비·모션 축소)은 온보딩에도 그대로 적용된다

(참고: 목업 영역에 스펙 패널과 별개로 뜬 주석 프레임 "Note"(1LV-0, 앱 UI 아님)도 같은 취지의 문장을 반복한다: "AT-SY-003 / 온보딩의 마지막 단계다. CLI 연결과 계좌 연결 둘 다 끝나야 대화 창이 기본 높이로 축소되고 앱이 시작된다.")

## 목업 구조

```
Onboarding Window (1M8-0) 800×687 — 유리 패널(별도 창 아님, 대화 창의 확장 상태)
├─ Head (1NK-0) 799×156
│  ├─ Text "3 / 3" (1NN-0) 715×16 — 스텝 카운터
│  ├─ Text "증권 계좌를 연결합니다" (1NM-0) 715×34 — 헤딩
│  └─ Text "키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장되고 화면에 다시 나타나지 않습니다." (1NL-0) 715×44 — 서브텍스트
├─ Account Form (1P0-0) 799×459
│  ├─ 별칭 필드 그룹 (1PC-0) 715×91
│  │  ├─ Label "별칭" (1PD-0)
│  │  ├─ Input row (1PE-0) 715×44 — 값 "모의-주력" + 우측 라벨 "선택"
│  │  └─ Helper "이 컴퓨터에서만 쓰는 이름이다. 증권사 계좌번호가 아니다." (1PH-0)
│  ├─ APP KEY 필드 그룹 (1PI-0) 715×91
│  │  ├─ Label "APP KEY" (1PJ-0)
│  │  ├─ Input row (1PK-0) 715×44 — 마스킹 점 24개(고정, 실제 길이 아님) + 우측 라벨 "붙여넣음 · 40자"
│  │  └─ Helper "붙여넣기만 지원한다. 입력한 값은 저장 후 다시 표시되지 않는다." (1PN-0)
│  ├─ SECRET KEY 필드 그룹 (1PO-0) 715×91
│  │  ├─ Label "SECRET KEY" (1PP-0)
│  │  ├─ Input row (1PQ-0) 715×44 — 마스킹 점 24개(고정, 실제 길이 아님) + 우측 라벨 "붙여넣음 · 64자"
│  │  └─ Helper "값이 아니라 문자 수만 보여준다 — 오타는 잡되 값은 노출하지 않는다." (1PT-0)
│  ├─ 저장 위치 안내 박스 (1PU-0) 715×83, 내부 (1PV-0) 608×54
│  │  ├─ Title "저장 위치" (bold)
│  │  ├─ Body "Windows 자격증명 저장소(DPAPI)에 암호화되어 저장됩니다. 앱 화면·로그·스크린샷 어디에도 값이 다시 나타나지 않습니다."
│  │  └─ Body(width 608px 고정) "여기서 등록한 계좌가 활성 계좌가 됩니다. 계좌는 나중에 더 추가할 수 있고, 활성은 항상 하나입니다."
│  └─ Footer helper "검증에 성공한 키만 저장됩니다. 실패하면 다음으로 넘어가지 않습니다." (1PY-0)
└─ Foot (1M9-0) 799×70, 상단 구분선
   ├─ Progress dots (1MF-0) 72×3 — 점 3개, gap 6px
   │  ├─ Rectangle (1MI-0) 20×3 — bg #FFFFFF4D(30% 흰색)
   │  ├─ Rectangle (1MH-0) 20×3 — bg #FFFFFFB3(70% 흰색, 가장 밝음)
   │  └─ Rectangle (1MG-0) 20×3 — bg #FFFFFF1F(12% 흰색, 가장 어두움)
   ├─ Rectangle (1ME-0) 479×0 — flex spacer(그로우), 시각 요소 아님
   └─ Button "검증 후 시작" (1MA-0) 134×36 — bg-brand(#EE137B), 우측에 화살표 SVG(1MB-0)
```

## 레이아웃 · 스타일

**Onboarding Window** (800px, 높이 auto/fit-content ≈687px):
- `border-radius: 22px`, `overflow: clip`, `background-origin: border-box`, `border: 1px solid #FFFFFF4D`(백색 30%).
- `background-image: linear-gradient(in oklab 45deg, oklab(22.7% -0.001 -0.025 / 90%) 0%, oklab(20.1% -0.0009 -0.021 / 95.7%) 40%, oklab(90.3% -0.005 -0.021 / 20%) 100%)` — 어두운 유리 패널. AT-SY-001(부팅) 4단계 "창 확정" 컬럼과 동일한 그라데이션 값을 쓴다 — "완성된 대화 창" 유리 스타일이 두 보드에서 재사용되는 것으로 보인다.
- `box-shadow: #FFFFFF8F 0px 2px 0px inset, #FFFFFF09 0px 0px 0px 4px, #000000C7 0px 46px 104px` (inset 하이라이트 56% + 4px 아웃라인 3.5% + 드롭섀도 78%).

**Head** (`pt-10 px-10.5` = 상단 40px, 좌우 42px, `flex flex-col gap-2.75` = gap 11px):
- 스텝 카운터 "3 / 3": `font-mono`, `tracking-[0.22em]`, color `#F2F4F86B`(42% 알파), `text-[12px]/4` = 12px/16px.
- 헤딩 "증권 계좌를 연결합니다": `font-title`(Daki Title), `tracking-[-0.02em]`, color `#F2F4F8`, `text-[28px]/8.5` = 28px/34px.
- 서브텍스트: `font-kr`, color `#F2F4F88A`(54% 알파), `text-label/5.5` → `--text-label`=14px, line-height 5.5×4=22px.

**Account Form** (`pt-6 px-10.5` = 상단 24px 좌우 42px, `flex flex-col gap-4` = gap 16px, 필드 폭 `w-178.75`=715px):
- 각 필드 그룹(별칭/APP KEY/SECRET KEY): `flex flex-col gap-2` = gap 8px.
  - 필드 라벨: `font-kr`, color `text-k-dim`(`--color-k-dim` #9AA2B1), `text-[12px]/4` = 12px/16px.
  - Input row: `h-11`(44px), `px-3.5`(14px), `rounded-[6px]`, `bg-[#10131A8C]`(`--color-k-bg` #10131A을 55% 알파로), `border border-solid border-k-line`(`--color-k-line` #2C3340), `flex items-center justify-between`.
    - 별칭 값 텍스트("모의-주력"): `font-kr`, color `text-k-faint`(`--color-k-faint` #6B7480), `text-desc/4.25` → `--text-desc`=13px, line-height 17px.
    - 별칭 우측 "선택": `font-mono`, color `text-k-faint`, `text-[11px]/3.5` = 11px/14px.
    - APP KEY/SECRET KEY 마스킹 점("●" 24개 고정): `font-mono`, `tracking-[2px]`, color `text-k-text`(`--color-k-text` #E6E8EE), `text-desc/4.25`.
    - APP KEY/SECRET KEY 우측 카운터("붙여넣음 · 40자" 등): `font-mono`, color `text-k-faint`, `text-[11px]/3.5`.
  - Helper 텍스트(필드 아래): `font-kr`, color `text-k-faint`, `text-[11px]/3.75` = 11px/15px.
- 저장 위치 안내 박스: `flex items-start`, `py-3.5 px-4`(상하 14px 좌우 16px), `rounded-[6px]`, `gap-2.5`(10px), `bg-[#1D222C80]`(`--color-k-panel2` #1D222C을 50% 알파로), `border border-solid border-[#262C38]`(k-line #2C3340과 유사하지만 동일 토큰은 아닌 별도 리터럴 값). 내부 `flex flex-col gap-1`(4px):
  - Title "저장 위치": `font-kr-bold`, color `text-k-text`, `text-[12px]/4` = 12px/16px.
  - Body 1: `font-kr`, color `text-k-faint`, `text-[11px]/3.75`, 폭 제한 없음(박스 폭까지 채움).
  - Body 2: `font-kr`, color `text-k-faint`, `text-[11px]/3.75`, `w-152` = 608px 고정 폭(줄바꿈 제어용으로 보임).
- Footer helper("검증에 성공한 키만 저장됩니다...")도 필드와 동일한 `text-k-faint`/`text-[11px]/3.75`.

**Foot** (`h-17.5`=70px, `px-10.5`=42px, `gap-3.75`=15px, `flex items-center`, 상단 `border-t border-t-solid border-t-[#FFFFFF1C]`(11% 알파)):
- Progress dots: `flex gap-1.5`(6px), 각 점 `w-5 h-0.75 rounded-full`(20×3px). 좌→우 순서 bg `#FFFFFF4D`(30%) → `#FFFFFFB3`(70%, 최고 밝기) → `#FFFFFF1F`(12%, 최저 밝기).
- Spacer: `grow basis-[0%]`(빈 div, 버튼을 우측으로 밀어냄).
- 버튼 "검증 후 시작": `flex items-center py-2.5 px-5`(10px/20px), `rounded-[9px]`, `gap-2`(8px), `bg-brand`(`--color-brand` #EE137B). 라벨 `font-kr-bold`, color white, `text-desc/4` = 13px/16px. 우측에 11×11 화살표 SVG(`stroke: #FFFFFF`, `stroke-width: 1.5`).

**디자인 토큰 요약**: `--color-brand` #EE137B(버튼), `--color-k-bg` #10131A, `--color-k-panel2` #1D222C, `--color-k-line` #2C3340, `--color-k-text` #E6E8EE, `--color-k-dim` #9AA2B1, `--color-k-faint` #6B7480 — 이 6개 `--color-k-*` 토큰이 이 화면 전체(라벨/값/보더)를 구성한다. `--font-kr`(Daki), `--font-kr-bold`(Daki B), `--font-title`(Daki Title), `--font-mono`(Geist Mono). `--text-desc`(13px)/`--text-label`(14px)를 기준으로 그 외 12px/11px/28px 등은 토큰 없이 임의값(`text-[Npx]`)으로 지정되어 있다.

**Spec Panel** (412×1080, 참고용 — 구현 대상 아님): `bg-white`, 좌측 보더 `border-l-doc-line`(#CCCCCC). 타이틀 바 44px `bg-doc-ink`(#111111), 흰 텍스트 19px/24px bold "온보딩 — 계좌 연결". Meta 3행 각 36px, 라벨 컬럼 104px `bg-[#F2F2F2]`. Desc 헤더 34px `bg-[#E8E8E8]`. Desc 항목 4개, 번호(26px 폭 우측정렬)+제목(bold)+본문 줄들, 항목 간 `border-b-[#EAEAEA]`. 페이지 번호 "23", color #888888.

## 텍스트 · 라벨 전문

Head:
1. "3 / 3"
2. "증권 계좌를 연결합니다"
3. "키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장되고 화면에 다시 나타나지 않습니다."

Account Form — 별칭:
4. "별칭"
5. "모의-주력" (입력 필드 값/placeholder)
6. "선택" (입력 필드 우측 라벨)
7. "이 컴퓨터에서만 쓰는 이름이다. 증권사 계좌번호가 아니다."

Account Form — APP KEY:
8. "APP KEY"
9. "●●●●●●●●●●●●●●●●●●●●●●●●" (마스킹 점 24개)
10. "붙여넣음 · 40자"
11. "붙여넣기만 지원한다. 입력한 값은 저장 후 다시 표시되지 않는다."

Account Form — SECRET KEY:
12. "SECRET KEY"
13. "●●●●●●●●●●●●●●●●●●●●●●●●" (마스킹 점 24개)
14. "붙여넣음 · 64자"
15. "값이 아니라 문자 수만 보여준다 — 오타는 잡되 값은 노출하지 않는다."

Account Form — 저장 위치 박스:
16. "저장 위치"
17. "Windows 자격증명 저장소(DPAPI)에 암호화되어 저장됩니다. 앱 화면·로그·스크린샷 어디에도 값이 다시 나타나지 않습니다."
18. "여기서 등록한 계좌가 활성 계좌가 됩니다. 계좌는 나중에 더 추가할 수 있고, 활성은 항상 하나입니다."

Account Form — footer:
19. "검증에 성공한 키만 저장됩니다. 실패하면 다음으로 넘어가지 않습니다."

Foot:
20. "검증 후 시작"

## 상태 · 인터랙션

목업은 **입력 완료(값이 채워진) 단일 상태**만 보여준다 — 별칭에 "모의-주력", APP KEY/SECRET KEY에 각각 40자/64자 붙여넣은 상태의 스크린샷이다. 로딩·에러·빈 입력 상태의 시각 디자인은 이 보드에 없다.

스펙 패널 Description이 명시적으로 말하는(그러나 이 보드에서 그려 보이지는 않는) 상태·규칙:
- **빈 별칭**: 비우면 "모의-1"로 자동 부여(기본값 규칙만 서술, 빈 입력 필드 자체의 시각은 없음).
- **APP KEY/SECRET KEY 입력 제약**: password 타입, 붙여넣기만 허용(타이핑 입력 자체를 막는지, 붙여넣기 외 입력을 막는지는 "붙여넣기만 지원한다"는 문구로만 서술), 자동완성·맞춤법검사 비활성.
- **마스킹 표시**: 값이 아니라 문자 수만 카운터로 표시("붙여넣음 · N자"). 마스킹 점 자체는 24개 고정이며 실제 문자 수(40/64)와 무관하다 — 즉 점 개수는 실제 길이에 비례해 렌더링하면 안 된다.
- **검증(버튼 클릭) → 성공**: 저장 후 다음 단계로 진행. 최초 등록 계좌가 자동으로 활성 계좌가 됨. 대화 창이 204px로 축소되고 AT-CH-001로 전환.
- **검증(버튼 클릭) → 실패**: "다음으로 넘어가지 않는다"고만 서술 — 에러 메시지 문구, 실패 시 필드 초기화 여부, 재시도 UI는 이 보드에 없음(Open questions 참고).
- **접근성**: 투명도·대비·모션 축소 3종 접근성 설정이 온보딩에도 그대로 적용된다(각주). 구체적으로 어떤 요소가 어떻게 바뀌는지는 이 보드에 없음.
- **진행 표시(하단 점 3개)**: 3/3 단계임에도 점 3개 중 밝기가 가장 높은 것은 가운데 점이다(좌 30% · 중 70% · 우 12%). "현재 단계=마지막 점"이라는 통상적인 스텝퍼 해석과 어긋난다 — Open questions 참고.

## 데이터 계약

**필드**
- `alias`(별칭): 문자열, 선택 입력. 비우면 백엔드/클라이언트가 "모의-1" 같은 이름을 자동 부여(정확한 넘버링 규칙은 스펙에 없음).
- `app_key`(APP KEY): 문자열, password 타입, 붙여넣기 전용 입력. 화면은 문자 수만 표시하고 값 자체를 절대 보존/재표시하지 않는다.
- `secret_key`(SECRET KEY): 위와 동일한 제약.

**액션 — "검증 후 시작" 버튼**
1. 입력값(app_key/secret_key)을 렌더러를 거치지 않고 메인 프로세스로 직행시킨다(Description 3의 명시적 제약 — Electron 기준이면 렌더러 IPC로 값을 넘기지 말고, 렌더러는 마스킹/카운터만 다루고 실제 값은 메인 프로세스가 직접 쥐어야 한다).
2. 메인 프로세스가 키움 모의투자 도메인에 대해 검증한다. 백엔드 매핑: `backend/athena_api/kiwoom/auth.py`의 `KiwoomAuth(app_key, secret_key)` → `issue_token()`이 `POST {KIWOOM_MOCK_BASE_URL}/oauth2/token`(`api-id: au10001`)을 `{"grant_type": "client_credentials", "appkey": ..., "secretkey": ...}`로 호출해 토큰을 발급받는다. 실패 시 `KiwoomAuthError`를 던진다 — 이것이 "검증"의 실질적 구현으로 보인다.
3. 검증 성공 시에만 저장(Description 4 "검증에 성공한 키만 저장됩니다")하고, 이 계좌가 자동으로 활성 계좌가 된다.
4. 완료 시 대화 창이 204px로 축소되고 화면이 AT-CH-001로 전환된다(프론트/윈도우 셸 상태 전이 — 백엔드 라우트 대응 없음).

**백엔드 갭 (이 저장소 기준으로 확인된 사실)**
- **다중 계좌·별칭 모델이 코드에 없다**: `backend/athena_api/config.py`의 `Settings`는 `kiwoom_app_key`/`kiwoom_secret_key` 단일 쌍만 환경변수(`.env`, `ATHENA_` 접두사)로 갖는다. 별칭(alias) 필드, 계좌 목록, "활성 계좌 전환" 개념이 `Settings`에 없다. `AT-CV-OAUTH-계좌-전환.md`(같은 세션에서 작성된 companion 스펙) 역시 "런타임 자격증명 교체 경로 없음 — 현재 lifespan에서 1회만 구성된다"고 명시하고, "CredentialProcessLock이 머신당 1개 자격증명만 허용 — 두 계좌 동시 보유 불가"라고 밝힌다. 즉 스펙 패널이 말하는 "계좌는 나중에 더 추가할 수 있고, 활성은 항상 하나입니다"는 UI/문구 차원의 약속이고, 실제로 프로세스 하나가 동시에 쥘 수 있는 자격증명은 정확히 1개뿐이다.
- **DPAPI/Windows 자격증명 저장소 연동 코드가 없다**: `backend`/`athena_api`/`athena_mcp` 전체에서 `DPAPI`, `CredWrite`, `keyring` 등을 검색해도 매치가 없다. `AT-ST-007-비밀값-원칙.md`(companion 스펙)가 "등록 화면 → 메인 프로세스 → DPAPI → 자식 프로세스 env" 순서를 원칙으로 명시하고 있지만, 이 흐름을 구현하는 코드는 이 저장소에 아직 없다.
- **"검증"과 "저장"이 분리된 백엔드 API가 없다**: `KiwoomAuth.issue_token()`은 토큰을 메모리에만 들고 있고(`Memory-only Kiwoom OAuth token handling`), 별칭과 함께 영속 저장하는 로직은 없다. 이 화면을 구현하려면 (a) 검증 전용 호출과 (b) 별칭+자격증명 영속 저장 + 활성 계좌 지정을 하나의 트랜잭션으로 묶는 새 API/IPC 계약이 필요하다.
- **AT-ST-001(활성 계좌 규칙 문서로 스펙 패널이 참조)과 AT-ST-002(설정 화면의 계좌 등록)는 이번 추출 범위 밖**이라 이 파일에서 직접 확인하지 않았다 — Open questions 참고.
- 참고로 계좌번호 자체를 조회하는 TR(`ka00001`, "계좌번호조회 — 현재 토큰의 계좌번호를 조회합니다")은 `athena_api/generated/registry.py`에 존재하지만, 이 화면은 계좌번호를 입력받지도 표시하지도 않는다(별칭만 입력받는다) — 계좌번호는 app_key/secret_key로 발급된 토큰에 종속된 값이라는 것이 `AT-CV-OAUTH` 스펙의 설명과 일치한다.

## Open questions

- **진행 점(하단 3개 dot) 밝기 순서가 "3/3=마지막 단계"와 안 맞는다**: 좌 30% · 중 70%(최고) · 우 12%(최저) 순서다. 만약 이 점들이 온보딩 스텝 1/2/3을 나타낸다면 3번째(우측) 점이 가장 밝아야 "현재 단계=완료 직전"으로 읽히는데, 실제로는 가운데 점이 가장 밝다. 스텝 표시가 아니라 다른 의미(예: 최근 활동/캐러셀 같은 장식 요소)일 가능성도 있다 — 스펙 패널에 이 점들에 대한 설명이 전혀 없어 확정할 수 없다.
- **"별칭" 필드의 실제 입력 방식**: 값 "모의-주력" 옆에 "선택"이라는 라벨이 붙어 있다. 이것이 (a) 자유 텍스트 입력 필드이고 "선택"은 단순 placeholder/보조 텍스트인지, (b) 드롭다운/피커를 여는 트리거 텍스트인지 JSX만으로는 구분되지 않는다. APP KEY/SECRET KEY 필드는 우측에 "붙여넣음 · N자"라는 상태 텍스트가 있는 것과 대비된다.
- **실패 상태의 시각 디자인이 없다**: "실패하면 다음으로 넘어가지 않는다"는 텍스트뿐, 에러 메시지 위치/문구/필드 강조 방식이 이 보드에 없다.
- **AT-ST-002(설정 화면의 계좌 등록)와의 정확한 차이**: 이 작업 지시에 "같은 데이터, 다른 진입점"이라고만 언급되어 있고, AT-ST-002 보드 자체는 이번 추출 범위에 포함되지 않았다. 두 화면이 완전히 동일한 컴포넌트를 재사용하는지, 온보딩 전용으로 (예: "건너뛰기 없음" 같은) 문구/버튼이 다른지는 AT-ST-002를 직접 확인해야 한다.
- **다중 계좌 등록 시점**: 스펙 패널은 "계좌는 나중에 더 추가할 수 있고"라고 하지만, 이 온보딩 화면 자체가 "추가 계좌 등록" 진입점을 제공하는지, 아니면 온보딩에서는 정확히 1개 계좌만 등록하고 이후 계좌 추가는 AT-ST-002/AT-CV-OAUTH 쪽에서만 가능한지 불명확하다.
- **"모의-1" 자동 넘버링 규칙**: 별칭을 비웠을 때 "모의-1"이 부여된다고만 나와 있고, 이미 "모의-1"이 존재할 때(두 번째 계좌를 추가할 때) "모의-2"로 증가하는지, 아니면 항상 "모의-1"만 쓰는지(즉 온보딩에서는 계좌가 정확히 1개뿐이라 넘버링 충돌이 없다는 전제인지)는 스펙에 없다.
