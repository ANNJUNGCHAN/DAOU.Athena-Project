# 24 · AT-CV-MCP-001 MCP 호출 봉투 5상태

- Paper node: `324-0` | artboard "24 · AT-CV-MCP-001 MCP 호출 봉투 5상태"
- Screenshot (전체 아트보드): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-324-0-34088.jpg`
- Screenshot (목업 창만): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-325-0-34056.jpg`
- Screenshot (스펙 패널만): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-37H-0-28256.jpg`

## 무엇을 하는 화면인가

**화면이 아니라 봉투(envelope)다.** 임의의 MCP 툴 호출 결과 하나하나를 감싸는 공통 카드의 최소 필드
집합을 정의한다 — 본문(표/리더/프리/스칼라)을 대체하는 새 캔버스가 아니라, 그 네 가지 중 무엇이
착지했는지를 포함해 **모든 호출에 공통으로 존재하는 사실**만 그린다. 대화 창에 MCP 도구 호출 결과가
뜰 때마다 이 봉투가 본문을 감싼다 — 이 보드는 그 봉투를 5가지 실제 상태(정상 / 아테나가 막음 / 서버
오류 / 절단됨 / free 폴백)로 나란히 보여줘 스펙을 한눈에 대조하게 한다. `02 · MCP 응답 형상 전수조사.md`가
실측한 62개 호출 인스턴스 중 4건을 그대로 가져와 State 1~4를 채웠다. State 5는 실측 캡처
(`S2B-jjlabsio-disclosure-SMALL.json`)의 alias·tool·parse_status·절단·인코딩 필드는 그대로 쓰되,
본문 슬롯 판정(`free`)과 `fallback_reason`만은 `canvas.py`의 `validate_canvas_payload()`를 그 캡처
데이터로 실제 실행해 얻은 값이다 — 발명된 필드는 하나도 없지만, 이 한 값만은 "캡처"가 아니라
"캡처 + 코드 실행"이 근거임을 카드 자체에도 명시했다(아래 참고).

## 스펙 패널 전문

**Meta**
- 화면 ID: AT-CV-MCP-001
- 화면 명: MCP 호출 봉투 (공통 카드 envelope)
- 위치: 캔버스 창 › 모든 MCP 툴 카드 (공통 슬롯)

**Description**
1. 봉투 정의
   : 모든 MCP 호출이 공유하는 불변 필드 — 본문은 대체 안 함
   – 근거: 02 · MCP 응답 형상 전수조사 §B
2. 식별
   : 별칭(alias) · 업스트림 툴 이름 — 각각 표시
   – 자가보고 이름은 신뢰 불가 (세 서버 충돌 실측)
2.1 상태
   : 정상 / 아테나가 막음 / 서버 오류
   – 뒤 둘은 결과값만으론 구분 불가 · origin 필드로 구분
3. parse_status
   : structuredContent / JSON / 텍스트 / 빈 응답
   – structuredContent는 예외, text 파싱이 주경로
3.1 절단 · 인코딩 · 소요시간
   : 상태와 무관하게 항상 표시
   – 성공 응답도 절단·손상 가능 (State 1·4)
4. 본문 슬롯
   : 표/리더/프리/스칼라 묶음(미구현)/없음
   – free면 사유(fallback_reason) 필수 표시
5. 담지 못하는 것
   : 중첩 트리(A6, 1MB+)는 표로 못 편다
   – 에러는 표·타임라인·스트림 금지 (result.py)
5.1 미구현 갭
   : 스칼라 카드 묶음은 문서 결정뿐, 코드엔 없음
   – CANVAS_SCHEMAS는 4종(stream/reader/timeline/table)뿐
5.2 미해결
   : 갈래 A(테이블+스칼라) vs 갈래 B(Adaptive Record) 미확정
   – 이 보드는 고르지 않는다 (plan.md §5, 충돌①)

※ 5개 상태는 실측 캡처 그대로 — State 5의 free 폴백만 canvas.py를 실제 실행해 보충 (발명 없음)
※ jjlabsio · korean-dart-mcp는 AT-ST-004 등록 5개 서버 밖 — 별칭을 흐리게 표시해 캡처 전용 소스임을 구분
※ 8N-0 범례: CV=캔버스 창(일반) · ST=설정·제어. 7개 ST 보드는 관리 화면, 이 카드는 일반 표시라 CV

- 페이지 번호: 24

## 목업 구조

```
Frame "Mockup Area" (325-0) 1508×1080
├─ Rectangle "Desktop" (327-0) 1508×1080 — 배경 그라디언트 (QT-0와 동일 값 복사)
├─ Rectangle "Glow" (328-0) 1100×860 — 후광
├─ Frame "Caption" (32A-0) 1000×96, top:74/left:100
│   ├─ Text "화면ID" (32B-0) "AT-CV-MCP-001"
│   ├─ Text "제목" (32C-0) "MCP 호출 봉투 5상태"
│   └─ Text "설명" (32D-0) "형상이 무엇이든 모든 MCP 호출이 공유하는 불변 필드. …"
├─ Frame "State 1 · 정상" (32F-0) 1308×170, top:200/left:100
│   ├─ Frame "Header" — 별칭·툴 + 상태 필("정상")
│   ├─ Frame "Spine" — parse_status/절단/인코딩/소요시간 4열
│   └─ Frame "Body Row" — 본문 슬롯 칩 + 메시지/실측값 박스
├─ Frame "State 2 · 아테나가 막음" (33G-0) 1308×170, top:386/left:100 (구조 동일)
├─ Frame "State 3 · 서버 오류" (34J-0) 1308×170, top:572/left:100 (구조 동일)
├─ Frame "State 4 · 절단됨" (35M-0) 1308×170, top:758/left:100 (구조 동일)
├─ Frame "State 5 · free 폴백" (691-0) 1308×170, top:944/left:100 (구조 동일 — `duplicate_nodes`로
│   State 4를 복제해 만들었다, §"실행 중 발견한 함정" 참고)
├─ Frame "Badge 1"~"Badge 5" (36Q/36S/36U/36W/6A1-0) 24×24 — 각 카드 좌측(left:62), 헤더 높이에 정렬
└─ Frame "Not Held" (36Y-0) 1308×112, top:1134/left:100 — "담지 못하는 것" 콜아웃(제목 1줄 + 2×2 불릿 4개)
```

State 5를 끼워 넣기 위해 **아트보드 자체를 세로로 키웠다**: `324-0`은 1080px가 아니라
**1260px**(width는 1920px 그대로). 카드 4개(State 1~4)는 top 값을 포함해 원래 자리 그대로
**손대지 않았다** — 새 카드를 그 아래(top:944, 기존 16px 간격 그대로)에 추가하고 "담지 못하는 것"
콜아웃만 새 카드 아래(top:1134)로 밀었다. `Mockup Area`(`height:100%`)와 `Spec Panel`
(`height:100%`)은 부모 퍼센트 높이라 아트보드를 키우자 자동으로 따라왔다 — `Spec Panel`의
`Desc List`가 `flexGrow:1`이라 늘어난 공간을 그대로 흡수했고 `Page No` 푸터는 정상 흐름(absolute
아님)이라 자연히 바닥에 재정렬됐다(§"실행 중 발견한 함정" 참고, 카드 4개를 축소하는 대신 이
방법을 고른 이유).

23번(`5T2-0`, 부록 A1) ~ 27번 그리드에서 `324-0` 바로 아래 칸(row6·col3, worldY 7680)은
`3C6-0`("28 · AT-CV-005 TableCard")이 차지한다. `324-0`은 worldY 6400에서 시작해 1260px면
7660에서 끝나므로 20px 여유를 두고 `3C6-0`과 충돌하지 않는다 — 세로로 키우기 전에
`get_basic_info`로 이 좌표를 직접 확인했다.

State 카드 내부 공통 골격(5개 카드 전부 동일):
```
Frame "State N · <라벨>" (1308×170, radius18, border #FFFFFF42, LY-0와 동일한 oklab 그라디언트)
├─ Frame "Header" (row, justify-content:space-between)
│   ├─ (좌) 별칭 bold14(AT-ST-004 미등록 별칭은 `var(--color-k-dim)`로 흐리게) · 구분점 · 업스트림 툴 mono12
│   └─ (우, 에러 상태만) "origin: gateway-blocked" 또는 "origin: 없음 — 상류 에러엔 안 붙는다" + 상태 필
│       (비에러 상태 중 부가 태그가 있는 경우 — State 4 "⚠ 절단", State 5 "⚠ free 폴백" — 는
│       origin 없이 태그 + "정상" 필만)
├─ Frame "Spine" (row, gap28, 4개 고정폭 컬럼 — 모든 카드에서 폭 동일해 세로 정렬선 유지)
│   └─ parse_status(240px) · 절단 여부(140~200px) · 인코딩 손상(140~160px) · 소요 시간(100~120px)
└─ Frame "Body Row" (row)
    ├─ (좌, 고정폭 230px) 본문 슬롯 라벨 + 칩 + 사유 1줄
    └─ (우, flex-grow) 메시지 원문 또는 실측값 박스(테두리+연한 배경)
```

## 레이아웃 · 스타일

**아트보드**: 1920×**1260**(원래 1080이었으나 State 5를 더하며 세로로 키웠다 — 아래 "State 5 ·
free 폴백 추가" 참고), `flexDirection:row`, bg `#0A0B0E`. Desktop/Glow는 `QT-0`의 계산값을
그대로 복사(oklab 그라디언트, 근사치 아님 — `get_computed_styles`로 직접 뽑음).

**Caption**: left100/top74 (LY-0의 다중 상태 보드와 동일하게 좁힌 상단 여백 — 상태 카드들이
들어갈 세로 공간을 확보하려고 표준 top:112보다 좁혔다). 제목 `var(--font-title)` 30px, 설명
`var(--font-kr)` 15px/22px.

**State 카드 5개**: 1308×170 고정, top 200/386/572/758/944 (간격 16px, State 1~4는 원래 값 그대로
두고 State 5만 그 아래 추가), radius 18px, border `1px solid #FFFFFF42`, `box-shadow: inset 0
1.5px 0 #FFFFFF7A, 0 26px 60px #000000A8`, 배경 `linear-gradient(in oklab 45deg, oklab(22.7%
-0.001 -0.025 / 90%) 0%, oklab(20.1% -0.0009 -0.021 / 95.7%) 40%, oklab(90.3% -0.005 -0.021 /
18%) 100%)` — LY-0("12 · 답변 3상태")의 State 카드 스타일을 그대로 재사용했다(이 파일에서 "동일
개념의 여러 상태를 보여준다"는 목적에 이미 쓰인 검증된 패턴이라 새로 발명하지 않음). State 5는 이
스타일을 다시 타이핑하지 않고 State 4를 `duplicate_nodes`로 복제해 만들었다 — 그래서 픽셀 단위로
동일하다.

**State 5 · free 폴백 추가 (아트보드를 키운 이유)**: State 1~4(680px)에 16px 간격 3개(48px)를 더해도
728px인데, State 5(170px)와 그 앞뒤 간격(16px+gap)까지 넣으면 caption(170px)부터 "담지 못하는 것"
콜아웃(112px)까지 다 합쳐 910px 예산으로는 부족했다 — State 카드 4개를 축소해 억지로 끼워 넣는
대신(내부 padding/gap을 줄이면 이미 검토된 카드들의 줄바꿈이 깨질 위험이 있다), 아트보드 자체를
1080→1260으로 키우는 쪽을 골랐다. `get_basic_info`로 그리드 좌표를 먼저 확인했다 — `324-0` 바로
아래 칸(row6·col3, worldY 7680)은 다른 보드(`3C6-0` "28 · TableCard")가 이미 차지하고 있지만,
`324-0`은 worldY 6400에서 시작해 1260px면 7660에서 끝나 20px 여유를 두고 충돌하지 않는다. `Mockup
Area`/`Spec Panel`이 둘 다 `height:100%`라 아트보드만 키우면 자동으로 늘어났고, `Spec Panel`의
`Desc List`(`flexGrow:1`)가 늘어난 여백을 흡수해 `Page No` 푸터도 클리핑 없이 바닥에 재정렬됐다.

**상태 필 색상** (AT-ST-004의 상태 필 규칙을 그대로 재사용):
| 상태 | 배경 | 텍스트 |
|---|---|---|
| 정상 | `#5FCE3F1F` | `var(--color-ok)` |
| 아테나가 막음 | `#9AA2B11A` | `var(--color-k-dim)` |
| 서버 오류 | `#FF98381F` | `var(--color-warn)` |

**본문 슬롯 칩**: `display:flex`(주의: `inline-flex` + `width:fit-content` 조합은 이 Paper
빌드에서 텍스트를 내부적으로 줄바꿈시키는 버그가 있었다 — 아래 "함정" 참고), 고정폭 152px,
`justify-content:center`, radius 999px, border 1px 상태색. State 5의 `free` 칩은 State 1의
"스칼라 카드 묶음" 칩과 같은 `var(--color-warn)` 테두리/텍스트를 재사용했다 — 둘 다 "착지는 했지만
완전한 정답은 아니다"라는 같은 의미축이라 새 색을 만들지 않았다.

**배지**: 처음 4개는 `QT-0`의 "Badge 1" 노드를 `duplicate_nodes`로 복제해 만들었다. Badge 5는 이
보드 안의 Badge 4(`36W-0`)를 다시 `duplicate_nodes`로 복제해 만들었다 — 소스를 매번 QT-0까지
거슬러 올라가지 않고 이미 이 보드에 있는 동일 노드를 복제해도 결과가 같다. 위치(`left:62px`, 카드
헤더 높이에 맞춘 top)와 텍스트만 교체. 새로 그리지 않음.

**콜아웃 "담지 못하는 것"**: 1308×112, `border-top:1px solid #FFFFFF24`, 2행×2열, 각 항목
앞에 `var(--color-doc-red)` 색 도트. State 5 추가로 top만 948→1134로 옮겼다 — 내부 구조는
그대로다.

**Spec Panel**: 412×**1260**(아트보드를 따라 늘어남) 고정, 기존 22개 보드와 동일 골격(Panel Title
44 / Meta 123 / Desc Header 34 / Desc List flex-grow / Page No 38). Desc List 9개 항목 + 각주
3줄은 원래 1080px 기준으로 실측 841.3px에 정확히 맞춰 압축한 문구였는데, 아트보드가 1260으로
커지며 `Desc List`가 흡수하는 여유 공간이 늘어 지금은 여백이 남는다 — 클리핑 방향이 아니라 여유
방향으로 바뀐 것이라 문구를 다시 줄일 필요는 없었다(아래 "함정" 참고).

## 텍스트 · 라벨 전문

Caption:
1. `AT-CV-MCP-001`
2. `MCP 호출 봉투 5상태`
3. `형상이 무엇이든 모든 MCP 호출이 공유하는 불변 필드. 본문(표·리더·프리·스칼라)은 대체하지 않고 슬롯만 표시한다.`

State 1 · 정상 (근거: `S2-drfirst-response.json`의 `get_stock_price_by_code` 호출, survey A2):
- 별칭·툴: `drfirst-korea-stock-mcp` · `get_stock_price_by_code`
- 상태 필: `정상`
- parse_status: `구조화 미러 (A2)` / `structuredContent = text`
- 절단 여부: `아니오`
- 인코딩 손상: `⚠ 있음` / `U+FFFD 검출`
- 소요 시간: `—` / `캡처에 없음`
- 본문 슬롯: `스칼라 카드 묶음` / `(미구현) canvas.py에 없음 · 문서 결정만 존재`
- 실측값 박스: `name 필드 실측값 (인코딩 손상)` / `name: "�궪�꽦�쟾�옄" → 정상값 "삼성전자"`

State 2 · 아테나가 막음 (근거: `GRAFT-verify.json`의 `unapproved_tool_direct` 케이스, survey A1):
- 별칭·툴: `server-everything` · `get-env`
- origin 태그: `origin: gateway-blocked` (`CallToolResult._meta["athena/error_origin"]` 실측값,
  하이픈 포함 — 커밋 `b5e59cb`로 실제 필드가 들어온 뒤 갱신)
- 상태 필: `아테나가 막음`
- parse_status: `에러 (A1)` / `사람이 읽는 문장`
- 절단/인코딩: `해당 없음` / `해당 없음`
- 소요 시간: `—` / `상류에 전달 안 됨`
- 본문 슬롯: `없음` / `에러는 캔버스로 안 감 (result.py L4)`
- 메시지 박스: `메시지 원문 (GRAFT-verify.json)` / `"'server-everything__get-env'은 승인되지 않은 툴이라 호출할 수 없다 (allowlist에 없음)"` / `승인하면 풀린다 → AT-ST-005`

State 3 · 서버 오류 (근거: `S2B-jjlabsio-stock-base-info.json`, survey A1):
- 별칭·툴: `jjlabsio`(별칭 흐림 표시 — AT-ST-004 미등록, 캡처 전용 소스) · `get_stock_base_info`
- origin 태그: `origin: 없음 — 상류 에러엔 안 붙는다` (이 캡처의 `"meta": null` 실측 — 진짜 upstream
  에러는 애초에 마커를 안 단다. `origin: upstream-failed`라고 적으면 이 캡처에 없는 값을 있는 것처럼
  꾸미는 셈이라 실측 그대로 "마커 없음"을 라벨로 썼다 — 아래 Open questions #1 참고)
- 상태 필: `서버 오류`
- parse_status: `에러 (A1)` / `사람이 읽는 문장`
- 절단/인코딩: `해당 없음` / `해당 없음`
- 소요 시간: `—` / `캡처에 없음`
- 본문 슬롯: `없음` / `상류 문제 — 승인 절차와 무관`
- 메시지 박스: `메시지 원문 (S2B-jjlabsio-stock-base-info.json)` / `"KRX request error"` / `재시도는 사용자 판단 — 아테나가 막은 게 아니다`

State 4 · 절단됨 (근거: `DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json`, survey A7b):
- 별칭·툴: `korean-dart-mcp`(별칭 흐림 표시 — AT-ST-004 미등록, DART 키 없어 한 번도 연결 못함) · `download_document`
- 상태 필: `⚠ 절단` 태그 + `정상` 필 (isError:false이지만 절단됨을 별도 표시)
- parse_status: `문서 봉투 (A7b)` / `content가 JSON`
- 절단 여부: `⚠ 예` / `400,000 / 636,059자 (37%)`
- 인코딩 손상: `없음` / `태그 누출 0건`
- 소요 시간: `2.11s`
- 본문 슬롯: `리더` / `전문 대신 미리보기 · 절단 배너 표시`
- 상세 박스: `DARTSURVEY-chrisryugj-download_document-LARGE` / `원본 9,671,754 bytes → 파싱 636,059자 → 400,000자만 전달` / `rcept_no 20260310002820 · format markdown`

State 5 · free 폴백 (근거: `S2B-jjlabsio-disclosure-SMALL.json`의 `get_disclosure` 호출, survey A6 +
`canvas.py`의 `validate_canvas_payload("table", data)`를 이 캡처 데이터로 직접 실행한 결과):
- 별칭·툴: `jjlabsio`(별칭 흐림 표시 — AT-ST-004 미등록, 캡처 전용 소스) · `get_disclosure`
- 상태 필: `⚠ free 폴백` 태그 + `정상` 필 (isError:false — `render_canvas`가 렌더에 실패한 게
  아니라 스키마가 안 맞아 우아하게 free로 떨어진 것뿐이다. `GRAFT-verify.json`의
  `render_canvas_unknown_type`도 같은 이유로 `isError:false`)
- parse_status: `JSON 파싱 (A6)` / `content가 JSON, 중첩 트리`
- 절단 여부: `아니오` / `4,517자 (원문 그대로)`
- 인코딩 손상: `없음` / `U+FFFD 0건`
- 소요 시간: `—` / `캡처에 없음`
- 본문 슬롯: `free` / `table 스키마 불일치 → free 폴백 (canvas.py)`
- 실측값 박스: `table 스키마 대조 실측값 (canvas.py validate_canvas_payload() 직접 실행, 입력:
  S2B-jjlabsio-disclosure-SMALL.json)` / `fallback_reason: "table 스키마 불일치: 'rows' is a
  required property"` / `get_disclosure 결과는 배열이 아니라 트리 — render_canvas(canvas_type=table)로
  넘기면 이렇게 free로 떨어진다`
  - **이 값의 성격을 정확히 적는다**: alias·tool·parse_status·절단·인코딩은 실측 캡처 그대로다.
    `fallback_reason` 문자열만은 이 캡처를 실제로 `render_canvas`에 태운 로그가 아니라, 이 캡처의
    `content[0].text`를 `json.loads()`한 값을 `canvas.py`의 `validate_canvas_payload("table", ...)`
    에 **직접 실행해서** 얻은 실제 반환값이다(지어낸 문자열이 아니라 코드가 실제로 낸 에러 메시지) —
    카드 자체에 "canvas.py ... 직접 실행"이라고 출처를 밝혀 캡처값과 섞이지 않게 했다.
  - **트리거 구분**: 이 카드는 "형상이 스키마와 안 맞다"(shape mismatch)를 보여준다.
    `GRAFT-verify.json`의 `render_canvas_unknown_type`(`canvas_type="streem"` 오타)은 다루지
    않았다 — 그건 "인자 자체가 틀렸다"(bad argument)는 다른 트리거라 섞으면 카드가 무엇을
    증명하는지 흐려진다. 상세는 아래 Open questions #2.

콜아웃 "담지 못하는 것":
1. `A6 중첩 트리(1MB+)는 표로 못 편다 — 리더 또는 프리로만 (State 5가 프리 실사례)`
2. `에러는 표·타임라인·스트림에 못 간다 (result.py 원칙)`
3. `스칼라 카드 묶음 바디는 문서 결정만 있고 canvas.py엔 미구현`
4. `갈래 A(표+스칼라 묶음) vs 갈래 B(Adaptive Record 단일 셸) — 상위 개념 미확정. 이 보드는 고르지 않는다`

## 상태 · 인터랙션

이 보드는 단일 화면의 상태 전환이 아니라 **서로 다른 5번의 MCP 호출**을 나란히 놓은 것이다(LY-0
"답변 3상태"와 달리 시간 순서가 없다 — 어느 카드든 독립적으로 발생할 수 있다).

- **정상**: `isError:false`이고 결과가 카드/캔버스로 안전하게 착지한 경우. 절단·인코딩 손상은
  정상 상태와 **독립적으로** 함께 표시될 수 있다(State 1이 그 증거 — 성공했지만 인코딩은 깨졌다).
- **아테나가 막음**: 게이트웨이 자신이 upstream에 보내지도 않고 거부한 경우. 코드에서 이 상태와
  "서버 오류"는 **응답 형상이 동일**하다(둘 다 `isError:true` + 사람이 읽는 문장) — 구분하는
  `CallToolResult._meta["athena/error_origin"]` 필드가 커밋 `b5e59cb`로 실제 들어왔다(이 카드가
  처음 그려질 때는 아직 코드에 없어 가정으로 그렸었다 — 이번 개정에서 실제 값으로 갱신).
- **서버 오류**: upstream이 반환한 에러. 재시도는 사용자 판단의 영역이지 승인 절차와는 무관하다
  — "아테나가 막음"과 시각적으로 구분되는 지점은 origin 태그(마커 있음 vs 없음)와 CTA 유무(막힘
  상태에만 "승인하면 풀린다 → AT-ST-005" 표시)뿐이다. **중요한 비대칭**: `origin` 마커는 게이트웨이가
  막았을 때만 붙는다 — 진짜 upstream 에러는 마커를 아예 안 달고 오므로, 봉투 입장에서
  "마커 없음 + isError" 자체가 곧 "상류 에러"라는 판정이다(State 3이 그 실측 증거).
- **절단됨**: 상태 필 자체는 "정상"이되 별도 경고 태그(`⚠ 절단`)가 나란히 붙는다 — 상태(성공/실패)와
  절단 여부는 서로 다른 축이라는 걸 보여주려는 의도적 선택.
- **free 폴백**: 상태 필도 "정상"이고 별도 경고 태그(`⚠ free 폴백`)가 붙는다는 점에서 "절단됨"과
  같은 패턴이다 — `render_canvas`가 실패한 게 아니라, 스키마가 안 맞는 데이터를 억지로 표/리더로
  욱여넣는 대신 정직하게 free로 착지시킨 것도 "성공"의 일종이라는 관점.
- 클릭/호버 등 실제 인터랙션은 이 보드에 없다(정적 스펙 비교판). 실제 앱에서 이 봉투가 어떻게
  본문 캔버스와 함께 렌더되는지, 카드를 눌렀을 때 무슨 일이 일어나는지는 이 보드 밖 — Open
  questions 참고.

## 데이터 계약

| 필드 | 근거 | 비고 |
|---|---|---|
| 별칭(alias) | `aggregator.py`의 `QualifiedTool.alias` | 서버 자가보고 이름과 별개, 사용자가 등록 시 부여 |
| 업스트림 툴 이름 | `aggregator.py`의 `QualifiedTool.upstream_name` | 모든 캡처가 `tool` 필드 또는 동등 정보를 남김(예외: 순수 CallToolResult만 담은 파일은 별도 툴명 필드가 없음 — State 카드에 쓴 5건은 전부 실측된 툴명이 있는 캡처를 골랐다) |
| 상태(정상/막음/오류) | `result.py`의 `isError` + `ParsedResult.error_origin`(`CallToolResult._meta["athena/error_origin"]`) | 커밋 `b5e59cb`로 실제 구현 완료. 값은 `gateway-blocked`/`upstream-failed` 두 개뿐이고, 평범한 upstream 에러엔 마커가 안 붙는다(State 3이 그 실측 증거) |
| parse_status | `result.py`의 `ParsedStatus`(error/structured/json/text/empty) | 02번 조사 문서 §B-6 |
| 절단 여부 | `client.py`의 `ResponseTooLargeError`, `quirks.py`의 `truncate_at` | State 4는 `DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json`의 실측값(`outer_char_count:636059`, `content_len:400000`, `outer_truncated:true`) 그대로 |
| 인코딩 손상 | `quirks.py`의 `contains_mojibake`, `registry.py`의 `ServerEntry.encoding_smoke_test_warning` | State 1은 `S2-drfirst-response.json`의 실제 U+FFFD 4문자 그대로 표시 |
| 소요 시간 | 캡처의 `elapsed_s`(있는 경우만) | State 1~3은 소스 캡처에 이 필드가 없어 "—"로 정직하게 비움. State 4만 실측값(2.11s) 존재 |
| 본문 슬롯 라벨 | `canvas.py`의 `CANVAS_SCHEMAS`(4종) + 04번 문서가 지적한 미구현 스칼라 카드 묶음 | "스칼라 카드 묶음"은 이 조사 시점 기준 코드에 없다 — 카드에도 그렇게 명시 |
| fallback_reason | `canvas.py`의 `validate_canvas_payload()` | State 5가 실사례다 — `S2B-jjlabsio-disclosure-SMALL.json`(A6 중첩 트리)을 `validate_canvas_payload("table", data)`에 직접 실행해 `"table 스키마 불일치: 'rows' is a required property"`를 실제로 얻었다(캡처가 아니라 코드 실행 결과, 카드에도 명시) |

## Open questions

1. ~~**`origin` 필드의 실제 스키마가 이 카드 작성 시점엔 아직 없었다.**~~ → **닫혔다
   (2026-08-16, 커밋 `b5e59cb`).** 필드가 실제로 들어갔고, 이 카드가 가정한 이분법이
   그대로 맞았다. 다만 **정확한 위치와 이름은 보드 표기와 다르다** — 보드는
   `origin: gateway|upstream`으로 적었는데 실제는:

   - 위치: `CallToolResult._meta["athena/error_origin"]`.
     `structuredContent`가 아니다 — `result.py`의 2단계 파싱이 `structuredContent`의
     **존재 자체**를 "이건 데이터다"로 취급해서, 거기 넣으면 게이트가 막은 호출이
     구조화 응답(A2)처럼 보인다. 이 카드가 피하려던 바로 그 오분류다.
   - 값: `"gateway-blocked"` / `"upstream-failed"` (하이픈 포함, 두 개뿐).
   - `result.py`의 `ParsedResult.error_origin`으로도 노출된다. `isError` 단계에서만
     채워지고 나머지 3단계는 안 건드린다 — 4단계 우선순위 계약은 그대로다.
   - **상류에서 넘어온 에러엔 안 붙는다.** 붙이면 지금의 모호함보다 나쁘기 때문이다.
     즉 봉투에서 "origin 없음 + isError" = 상류 에러로 읽으면 된다.

   와이어로도 확인됐다 — `GRAFT-verify.json`의 `unapproved_tool_direct`가 표시를
   달고 오고, `S2-jjlabsio-nokey-error.json`(진짜 DART 키 부재 응답)은 안 단다.

   **→ 닫혔다 (이번 개정).** 보드의 State 2 origin 태그를 실제 값 `origin: gateway-blocked`로
   갱신했다. State 3(`S2B-jjlabsio-stock-base-info.json`)은 실제로 `"meta": null`이었다 —
   `origin: upstream-failed`라고 적으면 이 캡처에 없는 값을 있는 척 지어내는 셈이라, 실측 그대로
   `origin: 없음 — 상류 에러엔 안 붙는다`로 라벨을 바꿨다. `upstream-failed` 값 자체는 "크래시했거나
   콘텐츠 블록을 파싱 못 한 upstream 실패"에만 붙는다(`result.py` 독스트링) — 평범한 upstream 에러
   응답(State 3이 그 예)은 애초에 마커가 안 붙는 게 설계 의도다. 즉 카드가 보여주는 진짜 규칙은
   "origin 마커 없음 + isError:true" = 상류 에러라는 것.
2. ~~**`free` 폴백 상태의 실제 예시가 이 보드에 없다.**~~ → **닫혔다 (이번 개정).** State 5로
   추가했다. `GRAFT-verify.json`의 `render_canvas_unknown_type`(`canvas_type='streem'` 오타)
   대신 `S2B-jjlabsio-disclosure-SMALL.json`(A6 중첩 트리)을 골랐다 — 오타는 "인자가 틀렸다"는
   다른 트리거라서다. `canvas.py`의 `validate_canvas_payload("table", data)`를 이 캡처 데이터로
   실제 실행해 `fallback_reason: "table 스키마 불일치: 'rows' is a required property"`를
   얻었다(지어낸 문자열 아님 — 코드가 실제로 반환한 값). alias/tool/parse_status/절단/인코딩은
   캡처 그대로, `본문 슬롯: free`와 그 사유만 이 코드 실행 결과라는 점을 카드 자체에도 밝혔다.
3. ~~**별칭 예시가 실제 등록 대응과 완전히 1:1이 아니다.**~~ → **닫혔다 (이번 개정).**
   `drfirst-korea-stock-mcp`·`server-everything`은 `AT-ST-004`(19 · MCP 서버 목록)에 등록된
   5개 별칭과 정확히 일치해 그대로 뒀다. `jjlabsio`(State 3·5)와 `korean-dart-mcp`(State 4)는
   AT-ST-004 목록에 없는 캡처 전용 소스라는 사실 자체를 **바꾸지 않고**, 별칭 텍스트 색만
   `var(--color-k-dim)`로 흐리게 표시해 구분을 시각화했다(별칭을 실제 등록 별칭으로 바꿔치기하는
   건 출처를 속이는 것이라 하지 않았다). Spec Panel 각주에 흐림 표시의 의미를 명시했다. 어느
   등록 별칭이 실제로 이 툴들을 갖는지 재검증이 필요하다는 지적 자체는 남아 있다 — 이 보드는
   "출처를 속이지 않는다"만 보장하지 "재검증됐다"까지는 보장하지 않는다.
4. **이 봉투가 실제 캔버스 렌더러에서 본문과 어떻게 합성되는지(레이아웃상 봉투가 감싸는지,
   헤더로만 붙는지)는 이 보드에 없다** — 갈래 A/B 미해결과 별개로, 봉투 자체의 배치 방식도
   미정.
5. **소요 시간 필드의 상한 대비 표시 방식(예: 30초 타임아웃 대비 막대/색상)이 없다.**
   `client.py`의 `call_timeout_seconds=30.0`이 설계 의도로 언급됐지만(02번 문서 B-9), 이
   카드는 숫자만 보여주고 상한 대비 위치는 시각화하지 않았다.
6. **본문 슬롯 칩 사유 텍스트의 길이 제한이 없다.** State 1의 사유("(미구현) canvas.py에 없음
   · 문서 결정만 존재")는 이미 칩 폭(230px)에 거의 꽉 찬다 — 실제 데이터에서 더 긴 사유
   문자열(예: 복잡한 fallback_reason 문장)이 들어오면 줄바꿈 규칙이 필요한데 이 보드는
   1줄 기준으로만 그렸다.

## 실행 중 발견한 함정 (레시피 문서가 못 잡은 것)

`03 · Paper 보드 저작 레시피.md`는 read-only 조사라 실제로 실행되지 않았다고 명시했는데, 실행해보니
그 문서의 `write_html` HTML 예시 두 곳이 실제로는 작동하지 않는다:

1. **`write_html`의 `style="..."` 속성은 진짜 CSS다 — camelCase가 아니라 kebab-case.**
   레시피의 모든 예시(`fontFamily`, `letterSpacing`, `backgroundImage` 등)는 camelCase를
   썼는데, `write_html`은 HTML을 실제로 파싱해서 `style` 속성을 표준 CSS로 해석한다.
   camelCase 속성은 **에러 없이 조용히 무시된다** — 폰트가 시스템 기본값(16px
   system-ui)으로 떨어지고, `flexGrow`/`flexBasis` 같은 레이아웃 속성은 아예 무시돼 부모
   `Mockup Area`가 `width:0px`으로 붕괴해 전체 아트보드가 새까맣게 렌더됐다(스크린샷으로
   처음 발견 — 겉보기엔 "빈 화면" 버그였지만 실은 스타일 파싱 실패였다). `update_styles`/
   `create_artboard`의 `styles` 파라미터는 반대로 JSON 객체라 camelCase가 맞다 — 두 도구가
   같은 "styles"라는 이름을 쓰지만 문법이 다르다는 게 핵심 함정.
2. **`display:inline-flex` + `width:fit-content` 조합이 텍스트를 내부적으로 줄바꿈시켰다.**
   칩(pill) 라벨에 이 조합을 썼더니 텍스트 노드의 실제 측정값(`get_node_info`)은 한 줄
   93×16으로 정상인데도 렌더링은 마지막 글자가 pill 밖으로 흘러나오는 2줄로 깨졌다. `display:
   flex`(inline 아님) + 명시적 고정폭(예: 152px)으로 바꾸니 해결됐다 — `inline-flex`와
   `width:fit-content` 각각은 가이드가 명시적으로 금지한 목록(`display:inline`,
   `display:grid`, `margin`, `table`)에 없지만 실제로는 신뢰할 수 없었다.
3. **Desc List 텍스트 줄바꿈량을 과소평가하면 Spec Panel Page No가 조용히 클리핑된다.**
   412px 패널 폭(패딩 제외 383px)에서 13px 한글 본문은 내가 처음 가정한 것보다 훨씬 자주
   줄바꿈됐다(예상 2줄 vs 실측 3~4줄). `get_node_info`로 `Desc List` 실제 높이(1128px)를
   재는 것으로만 발견했다 — 스크린샷에서는 Page No가 그냥 안 보일 뿐이라 "고장"인지
   "잘려서 안 보이는 것"인지 구분이 안 됐다. 문구를 짧게 압축(각 설명 줄 40자 내외로)한
   뒤 실측 841.3px로 가용 공간(841px)에 정확히 맞았다.

이 세 가지는 레시피 문서의 §6 "핵심 함정" 목록에 없던 것들이라 여기 추가 기록한다 — 다음에 이
파일에 보드를 추가하는 에이전트는 §6과 이 절을 같이 참고할 것.

State 5를 추가하며 이 개정에서 새로 걸린 함정 두 가지를 더 남긴다:

4. **`duplicate_nodes`의 `descendantIdMap`은 트리 순서가 아니라 임의 순서로 온다 — 눈으로
   짝을 맞추면 틀린다.** State 4 카드를 복제해 State 5를 만들 때, `get_tree_summary`로 뽑은
   원본 트리(위→아래, 왼→오른 순서)와 `descendantIdMap`에 나열된 키 순서가 **다르다**. 트리를
   훑으며 "N번째로 나온 텍스트 노드 = 맵의 N번째 항목"이라고 눈대중으로 짝지었더니 5쌍이
   틀렸다 — 예를 들어 칩(pill) 안쪽 텍스트와 사유(reason) 텍스트가 뒤바뀌고, 박스 안 3줄(라벨/
   실측값/각주)의 대응이 통째로 한 칸씩 밀렸다. `set_text_content`가 대상이 `Text`가 아니라
   `Frame`이면 에러를 내서 그 한 건은 바로 잡았지만(§5.7 재검토), **텍스트를 텍스트에 잘못
   덮어쓴 나머지는 에러 없이 조용히 성공**했다 — 스크린샷을 찍고서야 "본문 슬롯" 라벨 자리에
   긴 문장이 들어가 있는 걸 발견했다. 원본 old-ID → 신규 new-ID 매핑은 **`descendantIdMap`의
   키를 하나씩 원본 트리 문자열에서 검색해 대조**해야 안전하다(반대로, 트리를 순서대로 읽으며
   맵을 그 순서로 재정렬해도 안 된다 — 이 조사에서 실제로 순서가 어긋났다).
5. **높이가 부족하면 카드를 줄이지 말고 아트보드를 늘리는 게 더 안전할 수 있다.** State 5를
   더하려면 카드 5개+간격+콜아웃이 1080px 안에 안 들어갔다. 카드 4개의 padding/gap을 비례
   축소해 억지로 맞추는 방법도 계산해봤지만, `Body Row`가 `flex-grow`로 남는 공간을 먹는
   구조라 얼마나 줄여도 되는지 텍스트 줄 수에 따라 카드마다 다르고, 잘못 줄이면 이미 리뷰된
   카드 4개가 조용히 클리핑될 위험이 있었다. 대신 카드 4개는 원래 자리 그대로 두고 아트보드
   높이만 1080→1260으로 늘렸다 — `Mockup Area`/`Spec Panel`이 둘 다 `height:100%`라 부모를
   키우면 자동으로 따라오고, `Spec Panel`의 `Desc List`가 `flexGrow:1`이라 남는 공간을 흡수해
   `Page No` 푸터도 밀려나지 않았다. 다만 이 파일의 그리드가 아트보드 1080 고정을 전제로 200px
   행 간격을 두므로, 늘리기 전에 `get_basic_info`로 바로 아래 칸에 다른 보드가 있는지 반드시
   확인할 것 — 이번엔 20px 여유로 충돌을 피했다.
