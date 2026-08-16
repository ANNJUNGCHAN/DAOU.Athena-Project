# 24 · AT-CV-MCP-001 MCP 호출 봉투 4상태

- Paper node: `324-0` | artboard "24 · AT-CV-MCP-001 MCP 호출 봉투 4상태"
- Screenshot (전체 아트보드): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-324-0-37752.jpg`
- Screenshot (목업 창만): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-325-0-37392.jpg`
- Screenshot (스펙 패널만): `C:/Users/ajc22/orca/workspaces/DAOU.Athena/MCP/spike/paper-bridge/shot-37H-0-8232.jpg`

## 무엇을 하는 화면인가

**화면이 아니라 봉투(envelope)다.** 임의의 MCP 툴 호출 결과 하나하나를 감싸는 공통 카드의 최소 필드
집합을 정의한다 — 본문(표/리더/프리/스칼라)을 대체하는 새 캔버스가 아니라, 그 네 가지 중 무엇이
착지했는지를 포함해 **모든 호출에 공통으로 존재하는 사실**만 그린다. 대화 창에 MCP 도구 호출 결과가
뜰 때마다 이 봉투가 본문을 감싼다 — 이 보드는 그 봉투를 4가지 실제 상태(정상 / 아테나가 막음 / 서버
오류 / 절단됨)로 나란히 보여줘 스펙을 한눈에 대조하게 한다. `02 · MCP 응답 형상 전수조사.md`가 실측한
62개 호출 인스턴스 중 4건을 그대로 가져와 각 카드를 채웠다 — 발명된 필드는 하나도 없다.

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

※ 4개 상태는 실측 캡처 그대로 — 발명 없음
※ jjlabsio는 AT-ST-004 등록 5개 서버에 없음 — 별도 실측 서버
※ 8N-0 범례: CV=캔버스 창(일반) · ST=설정·제어. 7개 ST 보드는 관리 화면, 이 카드는 일반 표시라 CV

- 페이지 번호: 24

## 목업 구조

```
Frame "Mockup Area" (325-0) 1508×1080
├─ Rectangle "Desktop" (327-0) 1508×1080 — 배경 그라디언트 (QT-0와 동일 값 복사)
├─ Rectangle "Glow" (328-0) 1100×860 — 후광
├─ Frame "Caption" (32A-0) 1000×96, top:74/left:100
│   ├─ Text "화면ID" (32B-0) "AT-CV-MCP-001"
│   ├─ Text "제목" (32C-0) "MCP 호출 봉투 4상태"
│   └─ Text "설명" (32D-0) "형상이 무엇이든 모든 MCP 호출이 공유하는 불변 필드. …"
├─ Frame "State 1 · 정상" (32F-0) 1308×170, top:200/left:100
│   ├─ Frame "Header" — 별칭·툴 + 상태 필("정상")
│   ├─ Frame "Spine" — parse_status/절단/인코딩/소요시간 4열
│   └─ Frame "Body Row" — 본문 슬롯 칩 + 메시지/실측값 박스
├─ Frame "State 2 · 아테나가 막음" (33G-0) 1308×170, top:386/left:100 (구조 동일)
├─ Frame "State 3 · 서버 오류" (34J-0) 1308×170, top:572/left:100 (구조 동일)
├─ Frame "State 4 · 절단됨" (35M-0) 1308×170, top:758/left:100 (구조 동일)
├─ Frame "Badge 1"~"Badge 4" (36Q/36S/36U/36W-0) 24×24 — 각 카드 좌측(left:62), 헤더 높이에 정렬
└─ Frame "Not Held" (36Y-0) 1308×112, top:948/left:100 — "담지 못하는 것" 콜아웃(제목 1줄 + 2×2 불릿 4개)
```

State 카드 내부 공통 골격(4개 카드 전부 동일):
```
Frame "State N · <라벨>" (1308×170, radius18, border #FFFFFF42, LY-0와 동일한 oklab 그라디언트)
├─ Frame "Header" (row, justify-content:space-between)
│   ├─ (좌) 별칭 bold14 · 구분점 · 업스트림 툴 mono12
│   └─ (우, 에러 상태만) "origin: gateway|upstream (필드 설계 중)" + 상태 필
├─ Frame "Spine" (row, gap28, 4개 고정폭 컬럼 — 모든 카드에서 폭 동일해 세로 정렬선 유지)
│   └─ parse_status(240px) · 절단 여부(140~200px) · 인코딩 손상(140~160px) · 소요 시간(100~120px)
└─ Frame "Body Row" (row)
    ├─ (좌, 고정폭 230px) 본문 슬롯 라벨 + 칩 + 사유 1줄
    └─ (우, flex-grow) 메시지 원문 또는 실측값 박스(테두리+연한 배경)
```

## 레이아웃 · 스타일

**아트보드**: 1920×1080, `flexDirection:row`, bg `#0A0B0E`. Desktop/Glow는 `QT-0`의 계산값을
그대로 복사(oklab 그라디언트, 근사치 아님 — `get_computed_styles`로 직접 뽑음).

**Caption**: left100/top74 (LY-0의 다중 상태 보드와 동일하게 좁힌 상단 여백 — 상태 카드 4개가
들어갈 세로 공간을 확보하려고 표준 top:112보다 좁혔다). 제목 `var(--font-title)` 30px, 설명
`var(--font-kr)` 15px/22px.

**State 카드 4개**: 1308×170 고정, top 200/386/572/758 (간격 16px), radius 18px, border
`1px solid #FFFFFF42`, `box-shadow: inset 0 1.5px 0 #FFFFFF7A, 0 26px 60px #000000A8`,
배경 `linear-gradient(in oklab 45deg, oklab(22.7% -0.001 -0.025 / 90%) 0%, oklab(20.1% -0.0009
-0.021 / 95.7%) 40%, oklab(90.3% -0.005 -0.021 / 18%) 100%)` — LY-0("12 · 답변 3상태")의
State 카드 스타일을 그대로 재사용했다(이 파일에서 "동일 개념의 여러 상태를 보여준다"는 목적에 이미
쓰인 검증된 패턴이라 새로 발명하지 않음).

**상태 필 색상** (AT-ST-004의 상태 필 규칙을 그대로 재사용):
| 상태 | 배경 | 텍스트 |
|---|---|---|
| 정상 | `#5FCE3F1F` | `var(--color-ok)` |
| 아테나가 막음 | `#9AA2B11A` | `var(--color-k-dim)` |
| 서버 오류 | `#FF98381F` | `var(--color-warn)` |

**본문 슬롯 칩**: `display:flex`(주의: `inline-flex` + `width:fit-content` 조합은 이 Paper
빌드에서 텍스트를 내부적으로 줄바꿈시키는 버그가 있었다 — 아래 "함정" 참고), 고정폭 152px,
`justify-content:center`, radius 999px, border 1px 상태색.

**배지**: `QT-0`의 "Badge 1" 노드를 `duplicate_nodes`로 4번 복제 → 위치(`left:62px`, 각 카드
헤더 높이에 맞춘 top)와 텍스트만 교체. 새로 그리지 않음.

**콜아웃 "담지 못하는 것"**: 1308×112, `border-top:1px solid #FFFFFF24`, 2행×2열, 각 항목
앞에 `var(--color-doc-red)` 색 도트.

**Spec Panel**: 412×1080 고정, 기존 22개 보드와 동일 골격(Panel Title 44 / Meta 123 / Desc
Header 34 / Desc List flex-grow / Page No 38). Desc List 9개 항목 + 각주 3줄을 담고 실측
841.3px로 정확히 flex 공간에 들어맞는다(계산 후 문구를 압축해 넣음 — 아래 "함정" 참고).

## 텍스트 · 라벨 전문

Caption:
1. `AT-CV-MCP-001`
2. `MCP 호출 봉투 4상태`
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
- origin 태그: `origin: gateway (필드 설계 중)`
- 상태 필: `아테나가 막음`
- parse_status: `에러 (A1)` / `사람이 읽는 문장`
- 절단/인코딩: `해당 없음` / `해당 없음`
- 소요 시간: `—` / `상류에 전달 안 됨`
- 본문 슬롯: `없음` / `에러는 캔버스로 안 감 (result.py L4)`
- 메시지 박스: `메시지 원문 (GRAFT-verify.json)` / `"'server-everything__get-env'은 승인되지 않은 툴이라 호출할 수 없다 (allowlist에 없음)"` / `승인하면 풀린다 → AT-ST-005`

State 3 · 서버 오류 (근거: `S2B-jjlabsio-stock-base-info.json`, survey A1):
- 별칭·툴: `jjlabsio` · `get_stock_base_info`
- origin 태그: `origin: upstream (필드 설계 중)`
- 상태 필: `서버 오류`
- parse_status: `에러 (A1)` / `사람이 읽는 문장`
- 절단/인코딩: `해당 없음` / `해당 없음`
- 소요 시간: `—` / `캡처에 없음`
- 본문 슬롯: `없음` / `상류 문제 — 승인 절차와 무관`
- 메시지 박스: `메시지 원문 (S2B-jjlabsio-stock-base-info.json)` / `"KRX request error"` / `재시도는 사용자 판단 — 아테나가 막은 게 아니다`

State 4 · 절단됨 (근거: `DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json`, survey A7b):
- 별칭·툴: `korean-dart-mcp` · `download_document`
- 상태 필: `⚠ 절단` 태그 + `정상` 필 (isError:false이지만 절단됨을 별도 표시)
- parse_status: `문서 봉투 (A7b)` / `content가 JSON`
- 절단 여부: `⚠ 예` / `400,000 / 636,059자 (37%)`
- 인코딩 손상: `없음` / `태그 누출 0건`
- 소요 시간: `2.11s`
- 본문 슬롯: `리더` / `전문 대신 미리보기 · 절단 배너 표시`
- 상세 박스: `DARTSURVEY-chrisryugj-download_document-LARGE` / `원본 9,671,754 bytes → 파싱 636,059자 → 400,000자만 전달` / `rcept_no 20260310002820 · format markdown`

콜아웃 "담지 못하는 것":
1. `A6 중첩 트리(1MB+)는 표로 못 편다 — 리더 또는 프리로만`
2. `에러는 표·타임라인·스트림에 못 간다 (result.py 원칙)`
3. `스칼라 카드 묶음 바디는 문서 결정만 있고 canvas.py엔 미구현`
4. `갈래 A(표+스칼라 묶음) vs 갈래 B(Adaptive Record 단일 셸) — 상위 개념 미확정. 이 보드는 고르지 않는다`

## 상태 · 인터랙션

이 보드는 단일 화면의 상태 전환이 아니라 **서로 다른 4번의 MCP 호출**을 나란히 놓은 것이다(LY-0
"답변 3상태"와 달리 시간 순서가 없다 — 어느 카드든 독립적으로 발생할 수 있다).

- **정상**: `isError:false`이고 결과가 카드/캔버스로 안전하게 착지한 경우. 절단·인코딩 손상은
  정상 상태와 **독립적으로** 함께 표시될 수 있다(State 1이 그 증거 — 성공했지만 인코딩은 깨졌다).
- **아테나가 막음**: 게이트웨이 자신이 upstream에 보내지도 않고 거부한 경우. 현재 코드에서
  이 상태와 "서버 오류"는 **응답 형상이 동일**하다(둘 다 `isError:true` + 사람이 읽는 문장) —
  구분하려면 병렬로 추가되는 `origin` 필드(`gateway`/`upstream`)가 있어야 한다. 이 필드는
  설계 카드 작성 시점에는 아직 코드에 없었고, 이 조사와 같은 세션에서 다른 에이전트가 병렬로
  구현했다(팀 태스크 로그 참고) — 카드는 그 필드가 존재한다는 전제로 그렸다.
- **서버 오류**: upstream이 반환한 에러. 재시도는 사용자 판단의 영역이지 승인 절차와는 무관하다
  — "아테나가 막음"과 시각적으로 구분되는 지점은 origin 태그와 CTA 유무(막힘 상태에만
  "승인하면 풀린다 → AT-ST-005" 표시)뿐이다.
- **절단됨**: 상태 필 자체는 "정상"이되 별도 경고 태그(`⚠ 절단`)가 나란히 붙는다 — 상태(성공/실패)와
  절단 여부는 서로 다른 축이라는 걸 보여주려는 의도적 선택.
- 클릭/호버 등 실제 인터랙션은 이 보드에 없다(정적 스펙 비교판). 실제 앱에서 이 봉투가 어떻게
  본문 캔버스와 함께 렌더되는지, 카드를 눌렀을 때 무슨 일이 일어나는지는 이 보드 밖 — Open
  questions 참고.

## 데이터 계약

| 필드 | 근거 | 비고 |
|---|---|---|
| 별칭(alias) | `aggregator.py`의 `QualifiedTool.alias` | 서버 자가보고 이름과 별개, 사용자가 등록 시 부여 |
| 업스트림 툴 이름 | `aggregator.py`의 `QualifiedTool.upstream_name` | 모든 캡처가 `tool` 필드 또는 동등 정보를 남김(예외: 순수 CallToolResult만 담은 파일은 별도 툴명 필드가 없음 — State 카드에 쓴 4건은 전부 실측된 툴명이 있는 캡처를 골랐다) |
| 상태(정상/막음/오류) | `result.py`의 `isError` + (신규) `origin` 필드 | origin은 이 조사와 병행해 게이트웨이 쪽에 추가되는 중 — 설계 시점엔 코드에 없었음(팀 태스크 "Add an origin marker..." 참고) |
| parse_status | `result.py`의 `ParsedStatus`(error/structured/json/text/empty) | 02번 조사 문서 §B-6 |
| 절단 여부 | `client.py`의 `ResponseTooLargeError`, `quirks.py`의 `truncate_at` | State 4는 `DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json`의 실측값(`outer_char_count:636059`, `content_len:400000`, `outer_truncated:true`) 그대로 |
| 인코딩 손상 | `quirks.py`의 `contains_mojibake`, `registry.py`의 `ServerEntry.encoding_smoke_test_warning` | State 1은 `S2-drfirst-response.json`의 실제 U+FFFD 4문자 그대로 표시 |
| 소요 시간 | 캡처의 `elapsed_s`(있는 경우만) | State 1~3은 소스 캡처에 이 필드가 없어 "—"로 정직하게 비움. State 4만 실측값(2.11s) 존재 |
| 본문 슬롯 라벨 | `canvas.py`의 `CANVAS_SCHEMAS`(4종) + 04번 문서가 지적한 미구현 스칼라 카드 묶음 | "스칼라 카드 묶음"은 이 조사 시점 기준 코드에 없다 — 카드에도 그렇게 명시 |
| fallback_reason | `canvas.py`의 `validate_canvas_payload()` | 이 보드엔 free로 떨어진 상태 예시가 없다 — 4개 상태 전부 표/리더/스칼라/없음으로 착지해서. Open questions 참고 |

## Open questions

1. **`origin` 필드의 실제 스키마가 이 카드 작성 시점엔 아직 없었다.** 코드베이스에 병렬로
   추가되는 중이라는 것만 팀 태스크로 확인했고, 정확한 타입(enum 값 이름, 위치)은 검증하지
   않았다. 구현이 끝나면 이 카드의 `origin: gateway|upstream` 문자열이 실제 필드명과
   일치하는지 재확인 필요.
2. **`free` 폴백 상태의 실제 예시가 이 보드에 없다.** 4개 상태 모두 표/리더/스칼라(미구현)/없음
   중 하나로 착지했다 — `validate_canvas_payload()`가 스키마 불일치 시 `free`로 떨어뜨리는
   경우(예: `canvas_type='streem'` 오타, `GRAFT-verify.json`의 `render_canvas_unknown_type`
   사례)는 다루지 않았다. 다섯 번째 상태로 추가할지는 미정.
3. **별칭 예시가 실제 등록 대응과 완전히 1:1이 아니다.** `drfirst-korea-stock-mcp`·
   `server-everything`은 `AT-ST-004`(19 · MCP 서버 목록)에 등록된 5개 별칭과 정확히
   일치하지만, `jjlabsio`(State 3)와 `korean-dart-mcp`(State 1의 서버명과 State 4의 서버명이
   같은 별칭을 공유)는 조사 캡처의 실제 서버 식별자를 그대로 가져온 것이라 AT-ST-004의 목록에
   없거나(jjlabsio), 같은 별칭 아래 서로 다른 두 호출(성공/절단)을 배정한 것(korean-dart-mcp)이다
   — 실제 시스템에서 각 별칭이 정말 이 툴들을 갖는지는 재검증이 필요하다. 각주로 jjlabsio만
   명시했다.
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
