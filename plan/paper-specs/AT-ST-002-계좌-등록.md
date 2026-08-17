# 17 · AT-ST-002 계좌 등록

- Paper node: QO-0 | artboard "14 · AT-ST-002 계좌 등록" (구 17 — 파일 재번호, 2026-08-17 확인)
- Screenshot: C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-195-0-34636.jpg (mockup window only)
  Full sheet (with spec panel): C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-QO-0-35536.jpg

## 무엇을 하는 화면인가

모의투자 계좌의 APP KEY / SECRET KEY를 등록하는 화면이다. 사용자가 별칭과 두 키 값을 직접 입력하면, 검증(토큰 발급 확인)에 성공한 키만 OS 자격증명 저장소(Windows DPAPI)에 암호화 저장한다. 값은 저장 즉시 화면에서 사라지고 다시 표시되지 않으며, 앱 로그에도 남기지 않는다.

## 스펙 패널 전문

### Meta

| 항목 | 값 |
|---|---|
| 화면 ID | AT-ST-002 |
| 화면 명 | 계좌 등록 — 키 입력·검증 |
| 위치 | 계좌 목록 › 등록 시트 |

### Description

1. 별칭
   : 로컬 식별자다 — 이 컴퓨터에서만 통한다
   – 증권사 계좌번호가 아니다
2. APP KEY / SECRET KEY
   : password 입력 — 붙여넣기만 허용한다
   – 자동완성 · 맞춤법 검사는 끈다
   2.1 문자 수 표시
       : 붙여넣기 오류만 잡는 용도다
       – 값 자체는 렌더러에 전달되지 않는다
3. 저장·표시 원칙
   : OS 자격증명 저장소(DPAPI)에 암호화 저장한다
   – 저장 후에는 화면·로그에 다시 나타나지 않는다
4. 검증 후 저장
   : 검증에 성공한 키만 저장한다
   – 실패 시 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다

※ env 값은 어느 화면에도 표시하지 않는다 — 키 이름만 노출한다

(하단 페이지 번호: 17)

## 목업 구조

Mockup Area(1508×1080)의 배경(Rectangle "Rectangle" 1508×1080)과 글로우(Rectangle "Rectangle" 1100×860)는 스펙시트 프레젠테이션용 배경이며 구현 대상이 아니다. 아래는 실제로 구현해야 할 서브트리다.

```
Mockup Area (195-0) 1508×1080                          — 구현 대상 아님(컨테이너)
├─ Frame "Frame" (198-0) 1000×101                       — 페이지 헤더(화면 밖 상단 컨텍스트, 스펙 문서 장식용 타이틀)
│  ├─ Text "AT-ST-002"                                  — 화면 ID 라벨
│  ├─ Text "계좌 등록 — 키 입력·검증"                    — 화면 타이틀
│  └─ Text "모의투자 계좌의 APP KEY / SECRET KEY를…"     — 화면 설명
├─ Frame "계좌 등록 카드" (1B2-0) 1308×438                — ★ 구현해야 할 모달/카드(윈도우) 본체
│  ├─ Frame (1B3-0) 1307×44                              — 카드 헤더
│  │  ├─ Text "계좌 등록"                                 — 카드 타이틀
│  │  └─ Text "×"                                        — 닫기 버튼(글리프)
│  ├─ Frame (1B6-0) 1307×320                             — 카드 바디 (가로 2분할)
│  │  ├─ Frame (1B7-0) 832×264                           — 좌측: 입력 폼
│  │  │  ├─ Frame (1B8-0) 832×88                         — 별칭 필드 그룹
│  │  │  │  ├─ Text "별칭"                                — 라벨
│  │  │  │  ├─ Frame (1BA-0) 832×44                      — 입력 박스
│  │  │  │  │  └─ Text "모의-주력"                        — placeholder(예시) 텍스트, k-faint 색상
│  │  │  │  └─ Text "이 컴퓨터에서만 쓰는 이름이다"        — 도움말
│  │  │  ├─ Frame (1BP-0) 832×90                         — APP KEY 필드 그룹
│  │  │  │  ├─ Frame (1BQ-0) 832×16                      — 라벨 행
│  │  │  │  │  ├─ Text "APP KEY"
│  │  │  │  │  └─ Text "붙여넣음 · 40자"                  — 문자 수 힌트
│  │  │  │  └─ Frame (1BT-0) 832×44                      — 입력 박스(마스킹)
│  │  │  │     └─ Text "●●●…"(40자 상당 dot)              — 마스킹된 값
│  │  │  └─ Frame (1BV-0) 832×86                         — SECRET KEY 필드 그룹
│  │  │     ├─ Frame (1BW-0) 832×16                      — 라벨 행
│  │  │     │  ├─ Text "SECRET KEY"
│  │  │     │  └─ Text "붙여넣음 · 64자"                  — 문자 수 힌트
│  │  │     └─ Frame (1BZ-0) 832×44                      — 입력 박스(마스킹)
│  │  │        └─ Text "●●●…"(64자 상당 dot)              — 마스킹된 값
│  │  └─ Frame (1C1-0) 379×198                           — 우측: 저장·표시 원칙 안내 카드
│  │     ├─ Text "저장·표시 원칙"                          — 소제목
│  │     └─ Frame (1C3-0) 337×125                        — 불릿 리스트(4개)
│  │        ├─ "OS 자격증명 저장소(Windows DPAPI)에 암호화 저장한다"
│  │        ├─ "저장 후에는 화면에 다시 표시하지 않는다"
│  │        ├─ "앱 로그에도 남기지 않는다"
│  │        └─ "폐기는 삭제 한 번으로 끝난다"
│  └─ Frame (1CG-0) 1307×73                              — 카드 푸터
│     ├─ Frame (1CH-0) 493×40                            — 좌측: 상태 표시
│     │  ├─ Frame (1CI-0) 493×18                         — 상태 dot + 텍스트
│     │  │  ├─ Rectangle(1CJ-0) 6×6 dot — 색 k-dim(중립 회색)
│     │  │  └─ Text "토큰 발급 확인 중…"
│     │  └─ Text "검증에 실패하면 저장하지 않는다 — 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다"
│     └─ Frame (1CM-0) 203×40                            — 우측: 버튼 그룹
│        ├─ Frame (1CN-0) 69×40  — "취소" 버튼(아웃라인)
│        └─ Frame (1CP-0) 124×40 — "검증 후 저장" 버튼(브랜드 색 채움)
└─ Frame "하단 스펙 스트립" (1D5-0) 1308×64                — ★ 카드 하단, 요약 메타 4열(구현 대상)
   ├─ "입력 방식" : "사용자 직접 입력"
   ├─ "저장" : "DPAPI 암호화"
   ├─ "재표시" : "없음"
   └─ "저장 조건" : "검증 성공 시에만"
```

번호 배지(1, 2, 2.1, 3, 4 — 빨간 사각형)는 스펙시트 주석 마커이며 구현 대상이 아니다. 위치로 매핑하면: 1=별칭 필드, 2=APP KEY 필드, 2.1=SECRET KEY 필드(문자 수 표시 항목과 연결), 3=저장·표시 원칙 카드, 4=카드 푸터(상태 표시).

## 레이아웃 · 스타일

**카드(윈도우) 본체** (`계좌 등록 카드`, 노드 1B2-0)
- 크기: 1308×438px (px는 Paper 4px 스케일 그리드 값, 실화면 구현 시 상대 비율로 스케일해도 무방)
- `border-radius: 20px`
- 배경: `bg-[#171B24F0]` (거의 불투명 `--color-k-panel` #171B24 + 알파)
- 그림자: `box-shadow: #FFF0D61A 0px 0px 80px inset, #14100A85 0px 40px 90px` (안쪽 은은한 warm glow + 바깥 드롭섀도)
- 테두리: 위쪽만 `#FFFDF86B`(밝은 하이라이트), 좌/우/아래는 `--color-k-line` (#2C3340), 모두 1px solid

**카드 헤더** (1B3-0, 1307×44)
- `display:flex; justify-content:space-between; align-items:center; height:44px; padding-inline:18px`
- 배경 `#1D222C99` (`--color-k-panel2` #1D222C + 알파), 아래 테두리 1px `#262C38`
- 타이틀 "계좌 등록": `font-kr-bold`, `--text-label` 14px / line-height 18px, 색 `--color-k-text` (#E6E8EE)
- 닫기 "×": `font-kr`, 16px / line-height 18px, 색 `--color-k-faint` (#6B7480)

**카드 바디** (1B6-0, 1307×320): `display:flex; width:100%; padding:28px; gap:40px`
- 좌측 입력 컬럼 (1B7-0, 832×264, `flex-shrink:0`)
  - 필드 그룹 간 세로 여백: 별칭→APP KEY `padding-top:24px`, APP KEY→SECRET KEY `padding-top:20px`
  - 필드 라벨 (예: "별칭", "APP KEY", "SECRET KEY"): `font-kr`, `--text-desc` 13px / line-height 16px, `letter-spacing:0.02em`, 색 `--color-k-dim` (#9AA2B1)
  - 입력 박스: `height:44px; padding-inline:14px; border-radius:8px`, 배경 `--color-k-panel2` (#1D222C), 테두리 1px `--color-k-line` (#2C3340)
  - 별칭 입력값(placeholder) "모의-주력": `font-kr`, 14px/18px, 색 `--color-k-faint` (#6B7480) — 흐린 색으로 실제 입력이 아니라 예시/placeholder임을 시사
  - 별칭 도움말 "이 컴퓨터에서만 쓰는 이름이다": `font-kr`, 12px/16px, 색 `--color-k-faint` (#6B7480)
  - APP KEY / SECRET KEY 마스킹 값: `font-mono`, `--text-desc` 13px/18px, `letter-spacing:3px`, 색 `--color-k-text` (#E6E8EE) — 굵은 점(●) 문자열로 마스킹, 40자/64자 상당 길이
  - 문자 수 힌트 ("붙여넣음 · 40자" / "붙여넣음 · 64자"): `font-mono`, 12px/16px, `letter-spacing:0.02em`, 색 `--color-k-faint` (#6B7480); 라벨과 같은 행에 `justify-content:space-between`으로 우측 정렬
- 우측 안내 카드 (1C1-0, 379×198, `flex-grow:1`, `align-self:flex-start`)
  - `padding:20px; border-radius:10px; gap:14px`, 배경 `--color-k-panel` (#171B24), 테두리 1px `#262C38`
  - 소제목 "저장·표시 원칙": `font-kr-bold`, 14px/18px, 색 `--color-k-text` (#E6E8EE)
  - 불릿 리스트: 각 항목 `display:flex; align-items:flex-start; gap:8px`; 불릿 dot `4×4px`, `border-radius:pill`, 색 `--color-k-faint`(#6B7480), `margin-top:7px`; 텍스트 `font-kr`, 13px/19px, 색 `--color-k-dim` (#9AA2B1)

**카드 푸터** (1CG-0, 1307×73): `display:flex; align-items:center; justify-content:space-between; padding:16px 28px`, 위 테두리 1px `#262C38`
- 상태 영역 (좌): dot(6×6, `border-radius:pill`, 색 `--color-k-dim` #9AA2B1) + "토큰 발급 확인 중…" (`font-kr`, 13px/18px, 색 `--color-k-dim` #9AA2B1) — 세로 아래에 보조 설명 "검증에 실패하면 저장하지 않는다 — 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다" (`font-kr`, 12px/16px, 색 `--color-k-faint` #6B7480)
- 버튼 영역 (우, `gap:10px`):
  - "취소": `height:40px; padding-inline:20px; border-radius:8px`, 테두리 1px `#3A4152`, 배경 없음(투명); 텍스트 `font-kr`, 14px/18px, 색 `--color-k-dim` (#9AA2B1)
  - "검증 후 저장": `height:40px; padding-inline:22px; border-radius:8px`, 배경 `--color-brand` (#EE137B); 텍스트 `font-kr-bold`, 14px/18px, 색 흰색(#FFFFFF)

**하단 스펙 스트립** (1D5-0, 1308×64, 카드 바로 아래, 카드와 같은 1308px 너비)
- `display:flex; padding-top:22px`, 위 테두리 1px `#FFFFFF24`
- 4개 칼럼, 각 `flex-grow:1; flex-basis:0; flex-direction:column; gap:7px`
  - 칼럼 라벨 (예: "입력 방식"): `font-kr`, 11px/14px, `letter-spacing:0.14em`, 색 `#FFFFFF5C`
  - 칼럼 값 (예: "사용자 직접 입력"): `font-kr`, `--text-body` 15px/20px, 색 `--color-k-text` (#E6E8EE)

**페이지 헤더 텍스트(화면 밖 컨텍스트, 참고용)**
- "AT-ST-002": `font-mono`, 14px/18px, `letter-spacing:0.2em`, 색 `#FFFFFF6B`
- "계좌 등록 — 키 입력·검증": `font-title`, 30px/36px, `letter-spacing:-0.02em`, 색 `#F2F4F8`
- 설명문: `font-kr`, `--text-body` 15px/25px, 색 `#FFFFFF8A`

**폰트 패밀리 토큰**: `--font-kr` = Daki, sans-serif / `--font-kr-bold` = Daki B, sans-serif / `--font-title` = Daki Title, sans-serif / `--font-mono` = Geist Mono, monospace

## 텍스트 · 라벨 전문

카드(모달) 내부, 읽는 순서대로:

1. "계좌 등록" — 카드 헤더 타이틀
2. "×" — 닫기 버튼
3. "별칭" — 필드 라벨
4. "모의-주력" — 별칭 입력란 placeholder(예시) 텍스트
5. "이 컴퓨터에서만 쓰는 이름이다" — 별칭 도움말
6. "APP KEY" — 필드 라벨
7. "붙여넣음 · 40자" — APP KEY 문자 수 힌트
8. "●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●" — APP KEY 마스킹 값(40개 dot)
9. "SECRET KEY" — 필드 라벨
10. "붙여넣음 · 64자" — SECRET KEY 문자 수 힌트
11. "●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●" — SECRET KEY 마스킹 값(64개 dot)
12. "저장·표시 원칙" — 우측 안내 카드 소제목
13. "OS 자격증명 저장소(Windows DPAPI)에 암호화 저장한다" — 불릿 1
14. "저장 후에는 화면에 다시 표시하지 않는다" — 불릿 2
15. "앱 로그에도 남기지 않는다" — 불릿 3
16. "폐기는 삭제 한 번으로 끝난다" — 불릿 4
17. "토큰 발급 확인 중…" — 푸터 상태 텍스트
18. "검증에 실패하면 저장하지 않는다 — 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다" — 푸터 보조 설명
19. "취소" — 버튼
20. "검증 후 저장" — 버튼

카드 바로 아래 하단 스펙 스트립(4열):
21. "입력 방식" / "사용자 직접 입력"
22. "저장" / "DPAPI 암호화"
23. "재표시" / "없음"
24. "저장 조건" / "검증 성공 시에만"

(참고: 화면 밖 페이지 헤더 텍스트 — "AT-ST-002" / "계좌 등록 — 키 입력·검증" / "모의투자 계좌의 APP KEY / SECRET KEY를 등록한다. 값은 저장 즉시 화면에서 사라지고 다시 표시되지 않는다." — 이는 스펙시트 장식이며 화면 자체의 UI 텍스트인지는 불명확함, Open questions 참고)

## 상태 · 인터랙션

목업이 보여주는 화면은 **단 하나의 상태**뿐이다: 두 키 필드가 모두 채워진 채 **"토큰 발급 확인 중…"**(검증 진행 중, 중립 회색 dot) 상태. 이 상태에서:
- 별칭/APP KEY/SECRET KEY 입력란은 채워져 있고(별칭은 placeholder로 보이는 흐린 텍스트, 키 필드는 실입력을 의미하는 밝은 색 마스킹 dot)
- 푸터에 중립 상태 dot + "토큰 발급 확인 중…" 텍스트가 표시됨
- "검증 후 저장" 버튼은 브랜드 핑크(#EE137B)로 활성으로 보임(비활성/로딩 스타일 변화는 목업에 없음)

스펙 패널(Description)이 명시적으로 언급하지만 목업에는 그려지지 않은 상태들:
- **입력 전(빈 상태)**: 별칭/키 필드가 비어 있는 초기 상태 (placeholder만 노출) — 목업 미표시
- **붙여넣기 전용 입력**: "password 입력 — 붙여넣기만 허용한다", "자동완성 · 맞춤법 검사는 끈다" — 타이핑 입력을 막고 클립보드 붙여넣기만 허용해야 함(인터랙션 제약, 시각 상태는 아님) — 목업 미표시
- **검증 성공**: 성공 후 저장까지 이어지는 상태(색/아이콘 불명, 목업 미표시)
- **검증 실패 — 3종 구분**: "인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다"는 문구만 있고 실제 에러 상태의 색상·문구·아이콘은 목업에 없음
- **저장 완료 후**: "저장 즉시 화면에서 사라지고 다시 표시되지 않는다" — 저장 성공 시 카드가 닫히거나 필드가 즉시 비워지는 것으로 추정되나 그 전환의 시각적 모습은 목업에 없음

## 데이터 계약

이 화면이 필요로 하는 데이터/액션:

- **입력**: `별칭`(alias, 로컬 전용 문자열, 증권사 계좌번호 아님), `APP KEY`(문자열, 예시 40자), `SECRET KEY`(문자열, 예시 64자). 붙여넣기만 허용 — 클라이언트 측 입력 제약이며 백엔드 계약은 아님.
- **액션 1 — 검증(토큰 발급)**: "검증 후 저장" 클릭 시 APP KEY/SECRET KEY로 토큰 발급을 시도. 백엔드 매핑: `backend/athena_api/kiwoom/auth.py`의 `KiwoomAuth.issue_token()` / `_issue_token_unlocked()`가 `POST {KIWOOM_MOCK_BASE_URL}/oauth2/token` (api-id `au10001`, body `{grant_type, appkey, secretkey}`)을 호출하고 `return_code`/`token`/`expires_dt`를 검사한다. 실패 시 `KiwoomAuthError`를 던진다 — 다만 현재 구현은 실패를 "인증 실패 / 네트워크 / 레이트리밋"으로 세분화하지 않고 단일 예외로 처리한다(**갭**, 아래 참고).
- **액션 2 — 저장(DPAPI 암호화)**: 검증 성공 시에만 별칭+키 쌍을 OS 자격증명 저장소(Windows DPAPI)에 암호화 저장. **백엔드에 해당 기능이 없다(갭)** — 현재 `backend/athena_api/config.py`의 `kiwoom_app_key`/`kiwoom_secret_key`(`SecretStr`)는 프로세스 시작 시 환경설정(pydantic settings, 단일 전역 값)에서 읽어 `backend/athena_api/lifespan.py`가 `KiwoomAuth`에 주입하는 구조이며, 별칭 기반 다중 계정, 런타임 UI 등록, DPAPI 암호화 저장, "재표시 없음" 정책을 구현하는 저장소·API가 코드베이스에 존재하지 않는다. `backend/athena_mcp/__main__.py`의 `alias`/`register`는 무관한 개념(MCP 서버 등록용 별칭)이며 이 화면의 계좌 별칭과 혼동하면 안 된다.
- **취소**: 카드를 닫고 입력을 폐기(로컬 UI 동작, 백엔드 호출 없음으로 추정).

## Open questions

1. **DPAPI/별칭 저장소 백엔드 부재**: 이 화면이 요구하는 "별칭 기반 다중 계좌 + DPAPI 암호화 저장 + 재표시 없음" 기능이 백엔드에 전혀 없다. 현재는 `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY` 환경변수 하나만 지원하는 단일 계정 구조다(`backend/athena_api/config.py`, `lifespan.py`). 이 화면을 실제로 구현하려면 자격증명 저장 API(생성/조회 목록/삭제)를 새로 설계해야 한다 — 이번 화면 하나만으로는 범위를 정할 수 없다.
2. **검증 실패의 3분류 표시 방식 불명**: 스펙 패널은 "인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다"고 명시하지만 목업에는 성공/실패 상태가 전혀 그려져 있지 않다. 색상, 아이콘, 문구, 배치(현재 상태 dot+텍스트 자리에 표시되는지 별도 배너인지)가 불명확하다.
3. **별칭 입력란의 실제 상태**: "모의-주력"이 `k-faint`(흐린) 색으로 렌더링되어 placeholder로 보이지만, 목업 자체는 정적 이미지라 실제 placeholder인지 이미 입력된(그러나 스타일만 흐리게 디자인된) 값인지 100% 확정할 수 없다. 다른 예시 필드(APP KEY/SECRET KEY 마스킹 값)는 밝은 `k-text` 색이라 "채워진 값"과 "placeholder"의 색 구분 규칙이 있다는 근거는 있으나, 별칭 필드가 진짜로 비어있는 초기 상태를 보여주는 것인지 명시 확인이 필요하다.
4. **뱃지 2.1의 의미**: Description 항목에서 "2 APP KEY / SECRET KEY"의 하위 항목으로 "2.1 문자 수 표시"가 붙어있는데, 뱃지 2.1은 목업에서 SECRET KEY 입력 행 근처에 배치되어 있다. 문자 수 표시(예: "붙여넣음 · 40자/64자")가 APP KEY와 SECRET KEY 두 필드 모두에 있는데도 배지가 SECRET KEY 쪽에만 찍혀 있어, 이 요구사항이 SECRET KEY에 국한되는지 두 필드 공통인지 배지 위치만으로는 확정하기 어렵다(본 스펙에서는 두 필드 공통으로 해석함).
5. **"검증 후 저장" 버튼의 비활성/로딩 스타일**: 목업은 "토큰 발급 확인 중…" 상태에서도 버튼이 평소와 동일한 활성 브랜드 색으로 보인다. 검증 진행 중에 버튼을 비활성화하거나 로딩 스피너로 바꾸는지는 목업/스펙 어디에도 명시되지 않는다.
6. **페이지 헤더 텍스트("AT-ST-002", 타이틀, 설명문)가 실제 화면 UI인지**: 이 텍스트가 카드 위쪽 페이지 헤더처럼 배치되어 있는데, 이것이 실제 앱 화면(예: 계좌 등록 시트를 여는 상위 페이지)의 UI 텍스트인지, 아니면 스펙시트 프레젠테이션 전용 장식(다른 보드들과 마찬가지로 "Frame" 안에 있고 Desktop/Glow와 나란히 위치)인지 애매하다. 카드(모달) 자체는 명확히 구현 대상이지만 이 헤더 텍스트 블록의 소속이 불명확하여 위 텍스트/레이아웃 섹션에 별도 표기했다.
