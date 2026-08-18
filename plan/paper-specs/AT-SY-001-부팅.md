# 08 · AT-SY-001 부팅

- Paper node: 1M-0 | artboard "08 · AT-SY-001 부팅"
- Screenshot: C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1M-0-36224.jpg (full artboard)
  Mockup-only crop: C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1N-0-4532.jpg

## 무엇을 하는 화면인가

앱 실행 직후에 뜨는 부팅 화면이다. 별도의 스플래시 화면을 두지 않고, 부팅 과정 자체가 대화 창(메인 윈도우)이 생성되는 과정으로 연출된다. 총 4단계(0ms → +180ms → +420ms → +620ms)를 거치며, 화면 중앙의 발광점 하나가 가로로 확장되고 그 선을 축으로 창이 세로로 펼쳐져 최종적으로 로고와 입력창을 갖춘 대화 창이 확정된다. 생성이 완료되는 시점에 그대로 입력 대기 상태가 되며, 최초 실행이면 이 시점에 AT-SY-002(온보딩)로 자동 전환된다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-SY-001
- 화면 명: 부팅
- 위치: 앱 실행 직후

**Description**
1. 1단계 · 발광점 표시
   : 화면 중앙에 가로 16px 브랜드 색 발광점 1개 표시
   – 창 프레임은 이 시점에 그리지 않는다
2. 2단계 · 가로 확장
   : 발광점이 좌우로 확장되어 창 너비만큼의 선을 형성
   – 선의 양 끝은 투명도 그라데이션 처리
3. 3단계 · 세로 전개
   : 선을 축으로 창이 위아래로 펼쳐짐
   – 이 구간의 유리 불투명도는 72% (최종값보다 낮음)
   – 투명도 페이드 사용 금지 · 굴절 강도 변화로 표현
4. 4단계 · 창 확정
   : 유리 불투명도가 최종값에 도달하며 로고와 입력창 표시
   – 입력 커서는 브랜드 색, 이 시점부터 입력 가능
   – 최초 실행 시 AT-SY-002(온보딩)으로 자동 전환

- ※ 총 소요 620ms · 가속도 곱선 cubic-bezier(.2, 0, 0, 1)
- ※ 저사양 환경에서는 GPU 굴절을 끄고 CPU로 렌더한다. 4단계 시퀀스는 유지하되 굴절 변조
  대신 크기 전이만 쓴다 (2026-08-17 보드에서 확정 — 이전 판의 "미정 — 협의 필요"를 대체)

## 목업 구조

```
Mockup Area (1508×1080, bg #0A0B0E, 다크 배경 + 2개 방사형 Glow — Desktop/Glow는 배경 프레젠테이션용, 구현 대상 아님)
  Caption (900×136) — 좌상단 헤더 텍스트 블록
    "AT-SY-001" — 코드 라벨
    "부팅 시 대화 창이 생성되는 과정" — 타이틀
    "별도의 스플래시 화면을 두지 않는다. …" — 설명 문단
  Stage Labels (1268×34) — 4개 단계 배지+라벨, flex row, 각 항목 grow
    Frame (292×22) × 4
      배지 (22×22, bg-doc-red, 흰 숫자) — "1" / "2" / "3" / "4"
      라벨 텍스트 — "1단계 · 발광점 표시" 등
  Sequence (1268×320) — 4단계 비주얼을 나란히 배치한 4개 컬럼(각 292×320, 중앙 정렬)
    컬럼1: Rectangle 16×3 (발광점/짧은 선) — brand색, 글로우
    컬럼2: Rectangle 292×3 (전체 폭 선, 좌우 페이드 그라데이션) — brand색, 글로우
    컬럼3: Rectangle 292×96 (모서리 둥근 유리 패널, 텍스트/콘텐츠 없음 — 세로 전개 중간 상태)
    컬럼4: Frame 292×196 (완성된 창)
      Frame 290×143 (본문 영역, 중앙 정렬)
        Frame 104×20
          Text "ATHENA" — 로고
      Frame 290×52 (하단 입력 바, 상단 보더 구분선)
        Rectangle 2×17 — 입력 커서 (brand색, 글로우)
        Text "무엇이든 물어보세요" — placeholder
  Timeline (1268×44)
    Rectangle 1268×1 — 상단 구분선
    Frame 1268×16 — 4개 타임스탬프, flex row, 각 grow
      Text "0ms" / "+180ms" / "+420ms" / "+620ms"
```

## 레이아웃 · 스타일

**Mockup Area**: 1508×1080, `bg-[#0A0B0E]`, `flex flex-col`, overflow-clip, position relative. 배경에 선형 그라데이션(158deg, 다크 네이비 톤) 1개 + 방사형 glow 2개(핑크·틸 계열, 저채도 저불투명도) — 이 3개(Desktop/Glow/Glow2)는 스펙시트 프레젠테이션용 배경이며 구현 대상이 아니다.

**Caption 블록** (`left-30 top-42`, 즉 화면 기준 x=120px y=168px, width 225 unit = 900px, `flex flex-col gap-3` → gap 12px):
- 코드 라벨 "AT-SY-001": `font-mono`, `tracking-[0.2em]`, color `#FFFFFF6B`(백색 42% 알파), size `text-body` = 15px, line-height 4.5 unit = 18px.
- 타이틀 "부팅 시 대화 창이 생성되는 과정": `font-title`, `tracking-[-0.02em]`, color `#F2F4F8`, size 34px, line-height 10.5 unit = 42px.
- 설명 문단: `font-kr`, color `#FFFFFF8F`(백색 56% 알파), size 16px, line-height 6.5 unit = 26px.

**Stage Labels** (`left-30 top-110` → x=120 y=440, width 317 unit=1268px, height 8.5 unit=34px, `flex items-center gap-8.5` → gap 34px, 4개 항목 각 `grow basis-0`):
- 배지: `w-5.5 h-5.5`(22×22px), `flex items-center justify-center`, `bg-doc-red`(`--color-doc-red` = #E60012), 내부 숫자 `font-kr-bold`, color white, size `text-desc`=13px, line-height 4 unit=16px.
- 라벨 텍스트: `font-kr`, color `#FFFFFFCC`(백색 80% 알파), size `text-body`=15px, line-height 4.5 unit=18px. 배지와 라벨 사이 `gap-2.25` = 9px.

**Sequence** (`left-30 top-125` → x=120 y=500, width 317 unit=1268px, height 80 unit=320px, `flex items-center gap-8.5` → 4개 컬럼, 각 292px, gap 34px, 각 컬럼 내부 `items-center justify-center` 세로 중앙):
- 컬럼1 (1단계 발광점): `w-4 h-0.75`(16×3px), `rounded-full`, `bg-brand`(`--color-brand`=#EE137B), `box-shadow: #EE137BF2 0 0 22px`(95% 알파 글로우).
- 컬럼2 (2단계 가로 확장): `[width:100%] h-0.75`(292×3px), `rounded-full`, `box-shadow: #EE137BD9 0 0 26px`(85% 알파 글로우), 배경은 선형 그라데이션 90deg — 좌 0% 투명 브랜드색 → 22% 불투명 브랜드색 → 78% 불투명 브랜드색 → 100% 투명 브랜드색 (양끝 페이드).
- 컬럼3 (3단계 세로 전개): `[width:100%] h-24`(292×96px), `rounded-[18px]`, `box-shadow: #FFFFFF66 0 1.5px 0 inset, #00000094 0 20px 50px`(inset 하이라이트 40% + 드롭섀도 58%), `border border-solid border-[#FFFFFF33]`(20% 알파), 배경 45deg 선형 그라데이션(다크 네이비 계열, 알파 70%→80%→16%) — 스펙 텍스트대로 "유리 불투명도 72%"에 대응하는 중간 톤.
- 컬럼4 (4단계 창 확정, 전체 292×196px):
  - 바깥 프레임: `rounded-[20px]`, `overflow-clip`, `box-shadow: #FFFFFF94 0 2px 0 inset, #FFFFFF09 0 0 0 4px, #000000B8 0 40px 90px`(inset 하이라이트 58% + 4px 아웃라인 3.5% + 큰 드롭섀도 72%), `border border-solid border-[#FFFFFF4D]`(30% 알파), 배경 45deg 선형 그라데이션(알파 90%→95.7%→20%) — 3단계보다 더 불투명/진한 유리.
  - 본문(290×143px, `flex items-center justify-center px-5`): "ATHENA" 로고, `font-title`, `tracking-[0.4em]`, color `#F2F4F899`(60% 알파), size 16px, line-height 5 unit=20px, `pl-[0.4em]` 보정.
  - 하단 입력 바(290×52px, `h-13`, `flex items-center px-5 gap-3`, 상단 `border-t border-t-solid border-t-[#FFFFFF21]`(13% 알파)):
    - 커서: `w-0.5 h-4.25`(2×17px), `bg-brand`, `box-shadow: #EE137BE6 0 0 12px`.
    - placeholder 텍스트 "무엇이든 물어보세요": `font-kr`, color `#F2F4F870`(44% 알파), size `text-label`=14px, line-height 4.5 unit=18px.

**Timeline** (`left-30 top-218` → x=120 y=872, width 317 unit=1268px, height 11 unit=44px, `flex flex-col gap-2.75` → gap 11px):
- 상단 구분선: 1268×1px, `bg-[#FFFFFF33]`(20% 알파).
- 타임스탬프 행: `flex items-center gap-8.5`(34px gap), 4개 텍스트 각 `grow basis-0`: "0ms" / "+180ms" / "+420ms" / "+620ms". `font-mono`, color `#FFFFFF70`(44% 알파), size `text-desc`=13px, line-height 4 unit=16px.

**디자인 토큰 매핑**: `--color-brand` #EE137B(핑크, 발광점/선/커서), `--color-doc-red` #E60012(스펙 패널·목업 공통 단계 배지 배경 — 문서 강조색이며 실제 앱 브랜드 컬러는 아닐 수 있음, Open questions 참조), `--font-kr` / `--font-kr-bold` / `--font-title` / `--font-mono`, `--text-desc`(13px) / `--text-label`(14px) / `--text-body`(15px).

**Spec Panel**: 412×1080, `bg-white`, 좌측 보더 `border-l-doc-line`(#CCCCCC). Panel Title 바 44px 높이 `bg-doc-ink`(#111111), 흰 텍스트 19px/24px bold, 중앙 정렬 "부팅 시퀀스". Meta 3행 각 36px 높이, 라벨 컬럼 104px `bg-[#F2F2F2]`, 상하 보더(#999999/#DDDDDD). Desc Header 34px `bg-[#E8E8E8]`. Desc List 항목: 번호(22px 폭 우측정렬) + 제목(bold) + 본문 줄들, 항목 간 `border-b-[#EAEAEA]`. 페이지 번호 "8", 우측 정렬, color #888888.

## 텍스트 · 라벨 전문

Caption:
1. "AT-SY-001"
2. "부팅 시 대화 창이 생성되는 과정"
3. "별도의 스플래시 화면을 두지 않는다. 부팅 과정 자체가 대화 창의 생성 과정이며, 생성이 완료되는 시점에 그대로 입력 대기 상태가 된다."

Stage Labels (배지 숫자 + 라벨):
4. "1" / "1단계 · 발광점 표시"
5. "2" / "2단계 · 가로 확장"
6. "3" / "3단계 · 세로 전개"
7. "4" / "4단계 · 창 확정"

Sequence 컬럼4 (완성된 창):
8. "ATHENA"
9. "무엇이든 물어보세요"

Timeline:
10. "0ms"
11. "+180ms"
12. "+420ms"
13. "+620ms"

## 상태 · 인터랙션

이 아트보드는 4단계를 하나의 정지 화면에 나란히(필름스트립처럼) 배열해 보여준다 — 실제 실행 시에는 순차 애니메이션이며, 목업에는 단일 "동시 표시" 상태만 존재한다. 스펙 패널 Description이 명시하는 4개 시간축 상태는 다음과 같다:

- **0ms (1단계 · 발광점 표시)**: 화면 중앙에 가로 16px 브랜드색 발광점 1개만 표시. 창 프레임은 아직 그리지 않는다.
- **+180ms (2단계 · 가로 확장)**: 발광점이 좌우로 확장되어 최종 창 너비(292px, 컬럼 폭 기준)만큼의 선을 형성. 선 양 끝은 투명도 그라데이션.
- **+420ms (3단계 · 세로 전개)**: 선을 축으로 창이 위아래로 펼쳐진다. 이 구간의 유리 불투명도는 최종값보다 낮은 72%. 페이드 인/아웃 대신 굴절(refraction) 강도 변화로 표현해야 한다(투명도 페이드 금지가 명시적 제약).
- **+620ms (4단계 · 창 확정)**: 유리 불투명도가 최종값(더 진한 톤)에 도달, "ATHENA" 로고와 입력창(placeholder + 브랜드색 커서)이 표시된다. 이 시점부터 입력 가능. 최초 실행이면 이 시점에 AT-SY-002(온보딩)로 자동 전환된다.

전체 시퀀스는 620ms, 이징 함수 `cubic-bezier(.2, 0, 0, 1)`.

추가로 명시된 미정 상태: "저사양 환경 대체 동작 미정 — 협의 필요"(스펙 패널에 경고색 #D40000로 강조) — 즉 저사양/저전력 환경에서 이 애니메이션을 어떻게 대체할지는 이 보드에서 정의되지 않았다.

## 데이터 계약

이 화면은 순수 연출/애니메이션 화면으로, 화면 자체가 요청하는 백엔드 데이터는 없어 보인다. 다만 화면이 트리거하는 전이(transition)는 두 가지다:

- **입력 가능 상태 진입**: 4단계 완료(+620ms) 시점에 메인 대화 입력창이 활성화된다. 이는 이 스파이크 저장소의 `athena_mcp`(MCP 게이트웨이/CLI, `backend/athena_mcp/__main__.py`)나 `athena_api`의 어떤 라우트와도 직접 연결되지 않는다 — 이건 프론트엔드 윈도우/앱 셸의 부팅 애니메이션이지, 백엔드 API 호출이 아니다. 백엔드 쪽에서 대응하는 개념이 없다.
- **최초 실행 판정 → AT-SY-002(온보딩) 자동 전환**: "최초 실행인지" 여부를 판정할 상태 저장소가 필요하다. `backend/athena_mcp/onboarding.py`는 MCP 서버 이식(등록/승인) 온보딩이지 앱의 "첫 실행 여부" 판정과는 무관하다. `backend/athena_api/` 아래에서도 first-run/onboarding 플래그를 찾지 못했다(`grep`으로 `first_run`/`onboard`/`boot` 검색 결과 매치 없음). **갭**: "이 사용자가 앱을 처음 실행했는가"를 판정하는 로컬 상태(설정 파일, 로컬 DB 플래그 등)가 백엔드에 아직 존재하지 않는다 — 온보딩 자동 전환 로직을 구현하려면 이 상태를 어디에 둘지 새로 정의해야 한다.

## Open questions

- **부팅 배지 색상(`--color-doc-red` #E60012)이 실제 앱 브랜드 컬러인가**: Stage Labels의 1~4 배지가 `bg-doc-red`를 쓰는데, 이 토큰은 스펙 패널에서도 쓰이는 "문서용 강조색"이다. Sequence 컬럼의 발광점/선/커서는 전부 `--color-brand`(#EE137B, 핑크)를 쓴다. 배지가 실제 앱 UI 색인지, 아니면 이 스펙시트에서만 쓰는 주석용 색인지 불명확 — 목업 자체(대화 창)에는 배지가 등장하지 않고 Stage Labels 행에만 존재하므로, Stage Labels 행 자체가 스펙시트의 "설명용 라벨"이고 실제 앱 화면에는 없을 가능성이 있다.
- **애니메이션 정확한 보간 방식**: "굴절 강도 변화로 표현" (3단계 유리 불투명도 전환)이 구체적으로 어떤 CSS/렌더링 기법을 의미하는지 스펙 패널에 더 이상의 상세가 없다. backdrop-filter blur/굴절 텍스처 등 실제 구현 기법은 미정.
- ~~**저사양 환경 대체 동작**~~ → **닫혔다(2026-08-17).** 보드 각주가 확정했다: 4단계
  시퀀스는 유지하되 굴절 변조 대신 크기 전이만 쓴다. 구현(`app/chat.js` 부팅 시퀀서)은
  Electron `backgroundMaterial`이 굴절 변조 자체를 노출하지 않아 이 대체 경로를 기본
  구현으로 채택했고, `prefers-reduced-motion`이면 시퀀스를 건너뛰고 즉시 완료 상태로 간다.
- **좌우 확장(2단계) 시 창 너비 기준**: "발광점이 좌우로 확장되어 창 너비만큼의 선을 형성"이라고 되어 있는데, 목업에서 컬럼2의 선 너비는 컬럼 폭(292px) 전체이지 실제 대화 창(컬럼4, 마찬가지로 292px)과 같은 폭이다 — 즉 이 보드 안에서는 우연히 일치하지만, 실제 앱에서 창 너비가 가변이라면 2단계 선의 최종 너비를 실제 창 너비에 동적으로 맞춰야 하는지 여부는 스펙에 명시되어 있지 않다.
- **AT-SY-002 전환 트리거의 판정 위치**: "최초 실행 시"의 판정이 프론트엔드 로컬 저장소 기준인지 백엔드 세션/계정 기준인지 스펙에 없다(위 데이터 계약 섹션 참고).

## 4단계 재정의 (2026-08-18 사용자 지시 — 보드보다 우선)

> "4단계에서 ATHENA가 저렇게 뜨는 게 아니라, 평소 채팅바가 그대로 점점 커지다가
> 그 안에 ATHENA라고 적히고 다시 채팅바로 돌아온다. 부팅창의 최대 크기는 채팅창이다."

- 전개(3단계)의 종착은 이 보드 컬럼4의 "상단 로고 + 하단 입력줄" 2분할 창이 **아니라**,
  평소 채팅바(그립 노브 · 점 · 입력줄)의 1:1 복제다. 부팅은 chatBaseH를 넘지 않는다.
- 확정(+620ms) 직후 입력줄에 ATHENA가 한 자씩 적혔다가(+660ms~) 지워지고 placeholder로
  돌아온 뒤(+1160ms) 실제 창으로 스왑한다(+1360ms). 1~3단계 타이밍·이징은 보드 그대로.
- 구현·검증: `app/chat.js` 부팅 시퀀서, `app/verify.js` 검증1b(`bootBar` DOM 표집),
  `app/README.md` 부팅 절. **컬럼4 목업(1M-0)은 이 재정의와 어긋난 상태다 — Paper 보드
  재작업이 남은 일이다**(plan.md 다음 수).
