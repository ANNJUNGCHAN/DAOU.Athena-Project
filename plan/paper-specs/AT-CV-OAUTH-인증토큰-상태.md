# 23 · AT-CV-OAUTH 인증 토큰 상태

- Paper node: 1FC-0 | artboard "16 · AT-CH-005 인증 토큰 상태" (구 "23 · AT-CV-OAUTH 인증 토큰 상태" — 파일 재번호·ID 개명, 2026-08-17 확인)
- Screenshot: C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1FC-0-36344.jpg (full artboard)
  Mockup-only crop: C:\Users\ajc22\orca\workspaces\DAOU.Athena\MCP\spike\paper-bridge\shot-1FI-0-17284.jpg

## 무엇을 하는 화면인가

키움 OAuth 인증 토큰의 상태를 보여주는 화면이다. 별도의 창이 아니라 대화 창이 확장된 상태로 표시되며, 계좌 등록(AT-ST-002) 직후 한 번 자동으로 진입하고, 이후에는 대화 창에서 재진입한다. 화면은 토큰 값 자체를 다루지 않고 설정 여부·준비 여부·만료 시각만 보여주며, 만료가 임박하면 자동으로 재발급받는 것을 전제로 한다.

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-CV-OAUTH
- 화면 명: 인증 (토큰 상태)
- 위치: 계좌 등록 직후 1회 · 이후 재진입

**Description**
1. 인증 영역
   : 대화 창을 확장해 표시. 별도 창을 만들지 않는다
   – 계좌 등록 직후 자동 진입, 이후 대화 창에서 재진입
2. 남은 시간
   : 만료 시각에서 현재 시각을 뺀 값을 1초마다 다시 센다
   – 서버를 부르지 않는다. 로컬 계산이다
   – 등폭 숫자 고정. 자릿수가 바뀌어도 흔들리지 않는다
   – 임박하면 주황, 만료되면 회색
3. 상태 행
   : 계좌 · 자동 재발급 시점 · 확인 주기 3행 고정
   – 모의투자 / 실계좌 구분 표시. 현재는 모의투자만 지원
   – 내부 식별자를 노출하지 않는다
4. 상태 표시 · 액션
   : 좌측 점 — 준비됨(녹색) / 인증 필요(주황) / 만료(회색)
   – [지금 재발급] : 화면 내 유일한 브랜드 색 요소
   – [연결 해제] : 토큰 폐기. 인증 필요 상태로 되돌아간다
   – 발급 중에는 두 버튼 모두 잠긴다

- ※ 화면은 토큰 값을 받지 않는다. 설정 여부 · 준비 여부 · 만료 시각 3개만 받는다
- ※ 읽기 전용 상태 라우트 없음 — 지금 구조로 주기 확인하면 확인할 때마다 토큰이 새로 발급된다 (경고색 #D40000)
- ※ 만료 시각에 타임존 없음 — 렌더러가 UTC로 읽으면 카운트다운이 9시간 어긋난다 (경고색 #D40000)
- ※ 토큰 수명 미실측 — 확인 주기(60초)와 자동 재발급 임계(10분)는 후보값이다 (경고색 #D40000)

캔버스 위에는 스펙 패널 외에 창 왼쪽에 붙은 "Note" 텍스트 블록("AT-CV-OAUTH" + 요약 설명)도 있으나, 이는 스펙 패널 내용을 요약 재진술한 프레젠테이션용 캡션이며 구현 대상 UI가 아니다.

## 목업 구조

```
Auth Window (800×690) — 대화 창이 확장된 형태의 패널. 라운드 22px, 반투명 유리 재질
  Frame (799×136) — 상단 헤더 영역 (pt 40 / px 42, gap 11, shrink-0)
    Text "3 / 3" — 스텝 인디케이터
    Text "키움 인증이 연결되었습니다" — 타이틀
    Text "Athena는 토큰을 저장하지 않습니다. 만료 전에 자동으로 다시 받습니다." — 서브타이틀
  Frame (799×465) — 본문 영역 (pt 28, gap 20, px 42, grow)
    Frame (715×187) — 타이머 카드 (py 26 / px 28, 라운드 14px, 유리 패널)
      Text "재발급까지 남은 시간" — 카드 라벨
      Frame (657×78) — 카운트다운 행 (items-baseline, gap 14)
        Text "05:47:12" — 남은 시간 (등폭 숫자)
        Text "시 분 초" — 단위 라벨
      Text "2026-08-15 18:30:00 만료" — 만료 시각 (등폭 숫자)
    Frame (715×114) — 상태 행 3개 묶음 (shrink-0, 구분선 있음)
      Frame (715×38) — 계좌 행: "계좌" / "모의투자 · 등록됨"
      Frame (715×38) — 자동 재발급 행: "자동 재발급" / "남은 10분에"
      Frame (715×38) — 확인 주기 행: "확인 주기" / "60초마다"
    Frame (715×25) — 안내 문구
      Text "남은 시간이 10분 아래로 내려가면 자동으로 다시 받습니다. 직접 누를 필요는 없습니다."
  Frame (799×88) — 하단 액션 바 (h 88, px 42, 상단 구분선, items-center, justify-between)
    Frame (84×20) — 상태 표시 (items-center, gap 9)
      Rectangle (7×7) — 상태 점, 원형, 녹색(--color-ok)
      Text "토큰 준비됨" — 상태 라벨
    Frame (213×40) — 액션 버튼 그룹 (gap 10)
      Frame (95×40) — "연결 해제" 버튼 (배경 없음, h 40 / px 20, 라운드 6px)
      Frame (108×40) — "지금 재발급" 버튼 (배경 --color-brand, h 40 / px 20, 라운드 6px)
```

## 레이아웃 · 스타일

**창(Auth Window, 1FI-0)**
- 크기: 800×690px, `flex-col`, `overflow: clip`
- 배치: 캔버스 상에서는 Mockup Area(1508×1080) 안에 절대 위치(left 354 / top 196)로 중앙 배치되어 있음 — 이는 스펙 시트 연출이며, 실제 앱에서는 대화 창이 확장된 형태로 나타난다는 스펙 패널 설명을 우선한다
- border-radius: 22px (토큰 아님, 임의값)
- border: 1px solid `#FFFFFF4D` (흰색 30% 불투명도)
- box-shadow: `#FFFFFF8F 0px 2px 0px inset, #FFFFFF09 0px 0px 0px 4px, #000000C7 0px 46px 104px` (인셋 하이라이트 + 아우터 글로우 + 드롭섀도, 유리 재질 표현)
- background: `linear-gradient(in oklab 45deg, oklab(24% -.0008 -0.020 / 90%) 0%, oklab(22.2% -0.001 -0.019 / 95.7%) 40%, oklab(92.9% -0.003 -0.012 / 20%) 100%)` — 짙은 남색 계열에서 밝은 쪽으로 이어지는 대각선 그라데이션, background-origin: border-box
- 폰트: `font-synthesis: none`, antialiased

**상단 헤더 (1FJ-0, 799×136)**
- padding: top 40px, left/right 42px (`pt-10 px-10.5`)
- gap: 11px (`gap-2.75`)
- "3 / 3": font `Daki`(--font-kr), color `#E6E8EE73`(흰텍스트 45%), size 13px(--text-desc) / line-height 16px
- "키움 인증이 연결되었습니다": font `Daki B`(--font-kr-bold), color `--color-k-text`(#E6E8EE), size 28px / line-height 36px, letter-spacing -0.005em (토큰 아닌 임의 크기 — text-head 20px 토큰보다 큼)
- "Athena는 토큰을 저장하지 않습니다…": font `Daki`(--font-kr), color `#E6E8EE9E`(흰텍스트 62%), size 14px(--text-label) / line-height 22px

**본문 영역 (1FZ-0, 799×465)**
- padding: top 28px(`pt-7`), left/right 42px(`px-10.5`)
- gap: 20px(`gap-5`) between 카드/행묶음/안내문구

**타이머 카드 (1G0-0 wrapper, 715×187)**
- padding: 세로 26px(`py-6.5`), 가로 28px(`px-7`)
- border-radius: 14px (임의값)
- background: `#242A368C` (남색 계열 55% 불투명도)
- border: 1px solid `#FFFFFF17` (흰색 9%)
- gap: 10px(`gap-2.5`)
- "재발급까지 남은 시간": font `Daki`, color `#E6E8EE9E`(62%), size 13px(--text-desc) / line-height 18px
- "05:47:12": font `Geist Mono`(--font-mono), `font-feature-settings: 'tnum'`(등폭 숫자), color `--color-k-text`, size 72px / line-height 78px, letter-spacing -1px
- "시 분 초": font `Daki`, color `#E6E8EE73`(45%), size 14px(--text-label) / line-height 20px
- "2026-08-15 18:30:00 만료": font `Geist Mono`, tnum, color `#E6E8EE9E`(62%), size 13px(--text-desc) / line-height 18px

**상태 행 묶음 (1GL-0, 715×114, 행 3개)**
- 각 행: height 38px(`h-9.5`), `flex justify-between items-center`, 하단 구분선 1px solid `#FFFFFF12`(흰색 7%)
- 레이블(좌): font `Daki`, color `#E6E8EE73`(45%), size 13px(--text-desc) / line-height 18px
- 값(우): font `Daki`, color `#E6E8EEC7`(흰텍스트 78%), size 13px(--text-desc) / line-height 18px

**안내 문구 (1OX-0)**
- padding-top: 4px(`pt-1`)
- font `Daki`, color `#E6E8EE73`(45%), size 13px(--text-desc) / line-height 21px

**하단 액션 바 (1IL-0, 799×88)**
- height: 88px(`h-22`), padding 좌우 42px(`px-10.5`), `flex items-center justify-between`
- 상단 구분선: 1px solid `#FFFFFF17`(9%)
- 상태 표시: `flex items-center gap-9px`
  - 점(Rectangle): 7×7px, border-radius pill(`--radius-pill`, 999px), background `--color-ok`(#5FCE3F)
  - "토큰 준비됨": font `Daki`, color `#E6E8EEC7`(78%), size 14px(--text-label) / line-height 20px
- 버튼 그룹: `flex gap-10px`
  - "연결 해제" 버튼: height 40px, padding 좌우 20px, border-radius 6px(임의값), background 없음(투명), 텍스트 `Daki` color `#E6E8EE8C`(흰텍스트 55%), size 14px(--text-label) / line-height 18px
  - "지금 재발급" 버튼: height 40px, padding 좌우 20px, border-radius 6px, background `--color-brand`(#EE137B), 텍스트 `Daki` color white, size 14px(--text-label) / line-height 18px — 화면 내 유일한 브랜드색 요소(스펙 패널 명시)

**참고 토큰 값 (get_tokens 기준)**
- `--color-brand` #EE137B, `--color-ok` #5FCE3F, `--color-warn` #FF9838(주황, 임박 상태에 쓰일 것으로 추정 — 이 아트보드에는 실제 적용된 인스턴스 없음), `--color-k-text` #E6E8EE, `--color-k-faint` #6B7480(만료/회색 상태 후보), `--font-kr` Daki, `--font-kr-bold` Daki B, `--font-mono` Geist Mono, `--text-desc` 13px, `--text-label` 14px, `--radius-pill` 999px
- 이 화면에서 쓰인 라운드값(22px/14px/6px)과 다수의 반투명 흰색/브랜드 텍스트 색(`#E6E8EE73` 등)은 토큰이 아닌 임의(arbitrary) 값이다.

## 텍스트 · 라벨 전문

읽기 순서대로:

1. `3 / 3`
2. `키움 인증이 연결되었습니다`
3. `Athena는 토큰을 저장하지 않습니다. 만료 전에 자동으로 다시 받습니다.`
4. `재발급까지 남은 시간`
5. `05:47:12`
6. `시 분 초`
7. `2026-08-15 18:30:00 만료`
8. `계좌`
9. `모의투자 · 등록됨`
10. `자동 재발급`
11. `남은 10분에`
12. `확인 주기`
13. `60초마다`
14. `남은 시간이 10분 아래로 내려가면 자동으로 다시 받습니다. 직접 누를 필요는 없습니다.`
15. `토큰 준비됨`
16. `연결 해제`
17. `지금 재발급`

## 상태 · 인터랙션

이 아트보드는 **한 가지 상태만** 보여준다: 토큰이 정상 발급되어 있고 만료까지 시간이 충분히 남은 "준비됨" 상태(좌측 점 녹색 · "토큰 준비됨" · 카운트다운 흰색 · "3 / 3" 스텝 완료 시점). 스펙 패널이 명시적으로 언급하지만 이 화면에는 그려지지 않은 상태들:

- **인증 필요 (주황 점)**: 연결 해제 직후 또는 토큰이 없을 때. 상태 점이 주황(`--color-warn` 추정)으로 바뀐다. 시각 스펙 없음.
- **만료 (회색 점)**: 자동 재발급이 실패했거나 시간이 다 지난 경우. 상태 점이 회색으로 바뀐다. 카운트다운 자체도 "만료되면 회색"으로 바뀐다고 명시(스펙 패널 2번 항목). 시각 스펙 없음.
- **임박 (카운트다운 주황)**: 남은 시간이 얼마 남지 않았을 때 "05:47:12" 같은 큰 숫자가 주황으로 바뀐다(정확한 임계값은 스펙 패널에 없음 — "자동 재발급 남은 10분에"와 같은 값일 가능성이 있으나 명시되어 있지 않음).
- **발급 중 (버튼 잠김)**: "지금 재발급"을 누르거나 자동 재발급이 트리거된 동안 "연결 해제"/"지금 재발급" 두 버튼이 모두 비활성화(잠김)된다. 잠긴 상태의 시각(로딩 인디케이터 등) 스펙 없음.

트리거:
- 계좌 등록(AT-ST-002) 완료 직후 자동으로 이 화면(대화 창 확장)으로 진입한다.
- 이후에는 대화 창에서 재진입(트리거 조건 미상 — 예: 사용자가 다시 확인을 요청하거나 인증 오류가 발생했을 때로 추정, 스펙 패널에 명시 없음).
- "남은 시간"은 서버 호출 없이 로컬에서 만료 시각 − 현재 시각을 1초마다 재계산한다.
- 남은 시간이 10분 미만이 되면 자동으로 재발급을 시도한다(사용자가 "지금 재발급"을 직접 누를 필요 없음).
- "지금 재발급" 클릭 → 토큰 재발급 액션 트리거.
- "연결 해제" 클릭 → 토큰 폐기, 화면(또는 상태)이 "인증 필요"로 되돌아간다.
- 확인 주기는 60초마다(구체적으로 무엇을 확인하는지는 스펙 패널이 명시하지 않으며, 아래 데이터 계약에서 다루는 심각한 경고와 직결된다).

## 데이터 계약

이 화면이 받는 데이터는 스펙 패널이 명시한 대로 3개뿐이다: **설정 여부(configured)**, **준비 여부(ready)**, **만료 시각(expires_at)**. 토큰 값 자체는 절대 내려주지 않는다.

백엔드 매핑 (`backend/athena_api/kiwoom/auth.py`):
- `TokenManager.status()` → `{"configured": bool, "ready": bool, "expires_at": str | None}` — 화면이 요구하는 3개 필드와 정확히 일치한다.
- `TokenManager.issue()` (내부적으로 `KiwoomAuth.issue_token()` → 항상 새 토큰을 발급) → "지금 재발급" 버튼 액션. TR `au10001`, `POST /oauth2/token` (`backend/athena_api/generated/registry.py:59`, `routes.py`의 `_oauth_endpoint`/`call_internal_oauth`). 응답 모델 `Au10001Response`는 `configured`/`ready`/`expires_at` 3필드만 가짐 (`backend/athena_api/generated/models.py:1102`) — 화면 스펙과 정확히 일치.
- `TokenManager.revoke()` (`KiwoomAuth.revoke_token()`) → "연결 해제" 버튼 액션. TR `au10002`, `POST /oauth2/revoke`. 응답 모델 `Au10002Response` 역시 동일 3필드.
- 만료 시각 파싱: `parse_kiwoom_datetime()`이 `datetime.strptime(value, "%Y%m%d%H%M%S")`로 **타임존 정보 없이** naive datetime을 만든다 — 스펙 패널의 "만료 시각에 타임존 없음" 경고와 정확히 일치하는 실제 코드 근거.

**갭 (백엔드에 없음)**:
- **읽기 전용 상태 조회 라우트가 없다.** `athena_api/generated/routes.py`가 등록하는 oauth 종류 TR은 `au10001`(발급)과 `au10002`(폐기) 둘뿐이며, 상태만 조회하는 별도 엔드포인트/TR이 없다. `TokenManager.issue()`는 `ensure_token()`이 아니라 무조건 `_issue_token_unlocked()`를 호출하므로, 이미 유효한 토큰이 있어도 호출할 때마다 새 토큰을 발급한다. 화면이 "확인 주기 60초마다"로 상태를 폴링하려면 지금 구조로는 60초마다 새 토큰을 발급하게 된다 — 스펙 패널의 빨간 경고 문구와 정확히 일치하는, 아직 해결되지 않은 실제 갭이다.
- **"계좌: 모의투자 · 등록됨" 필드에 대응하는 백엔드 데이터가 없다.** `Au10001Response`/`Au10002Response`/`TokenManager.status()` 어디에도 계좌 종류나 등록 여부 필드가 없다. `backend/athena_api/` 안에 계좌 등록/계좌 정보를 다루는 모듈도 존재하지 않는다(grep 결과 없음). 이 값은 AT-ST-002(계좌 등록) 화면 쪽 상태에서 가져와야 할 것으로 보이나 그 연결 지점이 아직 없다.
- **"자동 재발급: 남은 10분에", "확인 주기: 60초마다" 값의 출처가 없다.** 백엔드 설정(`config.py`)에 해당 임계값 상수가 없으며, 스펙 패널도 이 값들을 "후보값(미실측)"이라고 명시한다.
- `athena_mcp/__main__.py`의 CLI 서브커맨드(register/list/show/approve/revoke/probe/allow/rename/remove/doctor/serve)는 **외부 MCP 서버 등록/승인**을 다루는 별개 도메인이며, 키움 OAuth 토큰과는 무관하다. 이 화면의 실제 로직은 `athena_api/kiwoom/auth.py` + `athena_api/generated/routes.py`에 있다.

## Open questions

1. **읽기 전용 상태 확인 방법 미정** — 스펙 패널이 빨간 경고로 직접 지적한 문제: 지금 백엔드 구조로 60초마다 상태를 확인하면 그때마다 새 토큰이 발급된다. 화면을 구현하려면 `TokenManager`에 부작용 없는 `status()` 전용 라우트가 먼저 필요하다.
2. **만료 시각 타임존 처리 미정** — `parse_kiwoom_datetime`이 naive datetime을 반환하므로, 프런트가 이를 UTC로 오인하면 카운트다운이 9시간 어긋난다(스펙 패널 경고). 로컬(KST) 고정 파싱인지 여부를 백엔드/프런트 계약으로 명시해야 한다.
3. **"자동 재발급 10분 임계"·"확인 주기 60초" 근거 없음** — 스펙 패널이 "후보값"이라 명시. 실측 후 확정 필요.
4. **"계좌" 행 데이터 출처 불명** — AT-ST-002(계좌 등록) 화면과의 연결 지점이 코드에 없다. 어느 상태 저장소에서 "모의투자 · 등록됨"을 읽어와야 하는지 미정.
5. **재진입 트리거 조건 불명** — 스펙 패널은 "이후에는 대화 창에서 재진입"이라고만 말할 뿐, 무엇이 재진입을 유발하는지(사용자 명령? 인증 오류 감지? 정기 점검?) 명시하지 않는다.
6. **주황/회색 상태의 시각 스펙 없음** — "임박하면 주황, 만료되면 회색"(카운트다운), "인증 필요(주황)/만료(회색)"(상태 점)이 텍스트로만 언급되고 실제 색상값·레이아웃 변화가 다른 아트보드에도 그려져 있지 않다. `--color-warn`(#FF9838)과 `--color-k-faint`(#6B7480)를 후보로 추정했을 뿐, 확정 근거는 없다.
7. **발급 중(버튼 잠김) 상태의 시각 스펙 없음** — 로딩 인디케이터, 버튼 비활성 스타일(투명도/커서 등)이 어떻게 보이는지 이 화면도 다른 화면도 명시하지 않는다.
8. **Note 텍스트("AT-CV-OAUTH" + 요약)와 스펙 패널의 관계** — 이 캡션은 스펙 패널 1번 항목을 축약 재진술한 것으로 보이며 새로운 정보는 없다. 프레젠테이션용으로 간주하고 구현 대상에서 제외했다.
