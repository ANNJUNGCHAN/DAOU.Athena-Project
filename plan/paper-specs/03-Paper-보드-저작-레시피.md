# 03 · Paper 보드 저작 레시피

> 목적: 기존 22개 아트보드(파일 `Athena — 화면설계서`, fileId `01M002A3JJ5SNHH8Z5AVB9KSQQ`,
> 페이지 `1-0`)와 스타일·구조상 구분 불가능한 23번째 보드를 만드는 정확한 도구 호출
> 레시피. 근거는 `get_guide({topic:"paper-mcp-instructions"})` 전문과 `QQ-0`(19 · MCP
> 서버 목록) · `QT-0`(22 · 비밀값 원칙) 두 보드의 `get_jsx`/`get_tree_summary` 실제 결과,
> `get_basic_info`가 반환한 22개 아트보드 좌표다. 이 문서를 쓴 에이전트는 Paper에
> **read-only**로 접근했다 — 아래 시퀀스는 실행되지 않았다.
>
> **2026-08-18 실집행 정정**: 보드 8쪽(1M-0)·40쪽(6RX-0) 편집에서 이 레시피를 실제로
> 집행하며 두 가지가 실측으로 갱신됐다. ① **`write_html`의 `style` 문자열은 반드시
> 케밥케이스 CSS여야 한다** — 초판 예제들의 camelCase는 대부분 조용히 버려진다(함정 11,
> 예제 전부 케밥케이스로 정정 완료). ② `write_html` 반환값에는 `createdNodes` 배열로
> 새 노드 ID가 온다(함정 8 갱신 — get_children 우회가 필요 없다).

---

## 0. 사전 정정 — "23번 중복" 전제는 틀렸다

의뢰에는 "`1K3-0`과 `1FC-0`이 둘 다 23을 자칭한다"는 전제가 있었다. 실제로는 아니다.
`get_basic_info`가 반환한 22개 아트보드 이름을 전부 확인한 결과:

- `1K3-0` = **"10 · AT-SY-003 온보딩 (계좌 연결)"**
- `1FC-0` = **"16 · AT-CH-005 인증 토큰 상태"** (구 표기 AT-CH-003 — ID 개명, 2026-08-17 확인)
- 01~22 번호가 정확히 한 번씩만 쓰였고, 빠지거나 겹치는 번호 없음.

즉 **23은 비어 있고 다음 번호로 그냥 쓰면 된다.** (`1K3-0`/`1FC-0`이라는 노드 ID
문자열에 섞인 숫자를 페이지 번호로 오인한 것으로 보인다 — 노드 ID는 Paper가 자동
채번하는 값이라 페이지 번호와 무관하다.)

---

## 1. 캔버스 그리드 — 다음 보드 좌표

전 22개가 4열 그리드에 정확히 열 index-major(row-major, 왼쪽→오른쪽, 위→아래)로
번호 순서대로 배치돼 있다. 아트보드 크기 1920×1080 고정, 열 간격/행 간격 모두
**200px**.

| | col0 (worldX=0) | col1 (worldX=2120) | col2 (worldX=4240) | col3 (worldX=6360) |
|---|---|---|---|---|
| row0 worldY=0 | 01 표지 (`1-0`) | 02 작업 이력 (`W-0`) | 03 개요 (`4I-0`) | 04 설계 원칙 (`5S-0`) |
| row1 worldY=1280 | 05 화면 구조도 (`75-0`) | 06 화면 목록·ID 체계 (`8N-0`) | 07 메인 구조 (`BZ-0`) | 08 부팅 (`1M-0`) |
| row2 worldY=2560 | 09 온보딩 CLI (`EV-0`) | 10 온보딩 계좌 (`1K3-0`) | 11 대화 창 기본 (`IN-0`) | 12 답변 3상태 (`LY-0`) |
| row3 worldY=3840 | 13 계좌 목록 (`QN-0`) | 14 계좌 등록 (`QO-0`) | 15 주문 API 활성화 (`QP-0`) | 16 인증 토큰 상태 (`1FC-0`) |
| row4 worldY=5120 | 17 토큰 4상태 (`1Q0-0`) | 18 계좌 전환 (`2J8-0`) | 19 MCP 서버 목록 (`QQ-0`) | 20 MCP 등록·승인 (`QR-0`) |
| row5 worldY=6400 | 21 MCP probe·툴 (`QS-0`) | 22 비밀값 원칙 (`QT-0`) | **← 23 여기** | (비어 있음) |

**23번 좌표: `worldX = 4240px`, `worldY = 6400px`** — row5·col2, `QT-0`(22) 바로
오른쪽. 순서상 다음 칸이자 시각적으로도 다음 보드로 읽힌다.

주의: `create_artboard`의 스타일 설명은 "80px 간격"을 예시로 들지만, 이 파일의 실제
관행은 **200px**다. 80px를 따르지 말고 200px 그리드를 맞출 것.

---

## 2. 명명 규칙

- 아트보드 `name` = `"{번호 2자리} · [AT-XX-NNN ]{화면명}"`.
  - 화면 ID가 있는 보드: `"22 · AT-ST-007 비밀값 원칙"`, `"19 · AT-ST-004 MCP 서버 목록"`.
  - 화면 ID가 없는 안내/개요성 보드: `"01 · 표지"`, `"02 · 작업 이력"` (AT-ID 생략).
  - → 23번: `"23 · AT-XX-NNN <화면명>"` (화면을 다루면) 또는 `"23 · <제목>"`.
- Spec Panel 맨 아래 **Page No** 텍스트는 아트보드 번호와 반드시 일치 (`QQ-0`→"19",
  `QT-0`→"22") → 23번 보드는 `"23"`.
- Caption 최상단 모노 텍스트 = 화면 ID 원문 그대로 (`"AT-ST-004"`, `"AT-ST-007"`).
- Spec Panel 메타행 "화면 ID"/"화면 명" 값도 Caption과 동일 문자열 반복.

---

## 3. 골격 구조 (두 보드에서 동일하게 확인됨)

```
Frame "{번호} · {화면명}" (아트보드, 1920×1080, bg #0A0B0E, display:flex, flexDirection:row)
├─ Frame "Mockup Area" (flexGrow:1, flexBasis:0%, height:100%, position:relative, overflow:clip, bg #0A0B0E)
│   ├─ Rectangle "Desktop"   — 배경 그라디언트, 1508×1080, absolute top0/left0
│   ├─ Rectangle "Glow"      — 원형 radial-gradient 후광, 1100×860, absolute, borderRadius:999px
│   ├─ Frame "Caption"       — 1000×~101, absolute left100/top112, flex column gap11
│   │   ├─ Text (화면 ID, mono, 14px, letterSpacing .2em, color #FFFFFF6B)
│   │   ├─ Text (제목, font-title, 30px, letterSpacing -.02em, color #F2F4F8)
│   │   └─ Text (설명, font-kr, 15px/25px, color #FFFFFF8A)
│   ├─ Frame "<화면별 커스텀 카드 이름>"  — 1308폭, absolute left100/top300, 다크 카드
│   │   (bg #171B24F0, radius 20px, border 1px #2C3340 좌우하 / #FFFDF86B 상단만,
│   │    boxShadow 인셋 웜 글로우 + 외부 드롭섀도)
│   │   → 실제 화면 목업 콘텐츠 (표/행/카드 등, 화면마다 다름)
│   ├─ Frame "Badge {n}" / "Badge {n.n}"  × N  — 24×24 또는 34×24, bg #E60012(--color-doc-red),
│   │   absolute 위치, 내부 Text 흰색 bold 14px = 카드 위 번호 마커
│   └─ Frame "Spec Note" / "Spec Strip"  — 1308×64, absolute top(카드 하단+22px 여백),
│       borderTop 1px #FFFFFF24, flex row, 4개의 동일폭 column(flexBasis:0%, flexGrow:1, gap7)
│       각 column = 라벨(11px, letterSpacing .14em, #FFFFFF5C) + 값(15px, #E6E8EE)
└─ Frame "Spec Panel" (412×1080 고정폭, flexShrink:0, bg #FFFFFF, borderLeft 1px #CCCCCC)
    ├─ Frame — Panel Title 바 (44px, bg #111111, 중앙정렬 흰 bold 19px = 화면명)
    ├─ Frame — Meta rows 블록 (padding 14px, borderTop 1px #999999)
    │   ├─ row "화면 ID"  (36px, 라벨칸 104px bg #F2F2F2 bold14, 값칸 padding-left14 14px)
    │   ├─ row "화면 명"  (동일 구조)
    │   └─ row "위치"     (동일 구조, 마지막 행만 borderBottom #999999)
    ├─ Frame — Desc Header (34px, bg #E8E8E8, "Description" bold15)
    ├─ Frame — Desc List (flexGrow:1, padding-inline14, padding-top10)
    │   ├─ row × N: 번호칸(26px, bold14, textAlign right) + 본문칸(flexGrow1, gap3:
    │   │   제목 bold14 #111111, 설명 줄 × 1~3개 regular13 #333333), borderBottom #EAEAEA
    │   │   (마지막 행 보더 없음)
    │   └─ 각주 블록 (gap5, paddingTop10): regular13 #666666, 경고성은 #D40000
    └─ Frame — Page No footer (38px, flex justify-end align-center padding-inline16,
        텍스트 14px #888888 = 아트보드 번호)
```

두 보드의 유일한 구조 차이: `QQ-0`은 화면 캡션 텍스트 레이어에 별도 `layer-name`을
안 줬고(레이어명이 텍스트 원문 그대로), `QT-0`은 `layer-name="화면ID"/"제목"/"설명"`을
명시적으로 붙였다. **`QT-0` 쪽(명시적 layer-name)이 더 최신 관행이므로 23번은 이를
따를 것.** Spec Panel 내부의 Meta/Desc/Page No 래퍼 Frame들은 두 보드 모두 layer-name
없이 기본값 `"Frame"`으로 남아 있다 — 그대로 둬도 무방.

---

## 4. 토큰 매핑 — 실측 hex → 토큰

`get_jsx`는 계산된 값(hex)만 보여주므로 원본이 `var(--token)`인지 raw hex인지 직접
증명되진 않는다. 그러나 가이드가 "토큰이 있으면 반드시 CSS 변수로 쓰라"고 명시하므로,
**정확히 토큰 값과 일치하는 색은 아래처럼 `var(--...)`로 쓰고, 일치하지 않는 색만
raw hex로 남긴다.**

| 실측 hex | 토큰 | 쓰인 곳 |
|---|---|---|
| `#E6E8EE` | `var(--color-k-text)` | 다크 영역 본문 텍스트 |
| `#9AA2B1` | `var(--color-k-dim)` | 다크 영역 보조 텍스트 |
| `#6B7480` | `var(--color-k-faint)` | 라벨, placeholder류 |
| `#2C3340` | `var(--color-k-line)` | 카드/행 보더 |
| `#171B24` (+투명도) | `var(--color-k-panel)` | 카드/서브카드 배경 |
| `#1D222C` (+투명도) | `var(--color-k-panel2)` | 서브 블록 배경 |
| `#EE137B` | `var(--color-brand)` | 유일한 브랜드 액션(버튼) |
| `#5FCE3F` | `var(--color-ok)` | 상태 "연결됨" |
| `#FF9838` | `var(--color-warn)` | 상태 "경고/실패", 로그 포함 표시 |
| `#E60012` | `var(--color-doc-red)` | 번호 배지, 부록 강조 |
| `#111111` | `var(--color-doc-ink)` | Spec Panel 타이틀 바 |
| `#CCCCCC` | `var(--color-doc-line)` | Spec Panel 좌측 보더 |
| `Daki, sans-serif` | `var(--font-kr)` | 본문 한글 |
| `Daki B, sans-serif` | `var(--font-kr-bold)` | 굵은 한글 라벨/제목 |
| `Daki Title, sans-serif` | `var(--font-title)` | Caption 대제목(30px)만 |
| `Geist Mono, monospace` | `var(--font-mono)` | ID·명령어·수치 |
| `13px` | `var(--text-desc)` | Desc List 설명줄 |
| `14px` | `var(--text-label)` | 라벨/배지/메타값 |
| `15px` | `var(--text-body)` | Caption 설명, Note 값 |

**토큰이 없는 값** (그대로 raw hex로 재현): 아트보드/Mockup 배경 `#0A0B0E`(토큰
`--color-k-bg #10131A`와 다른 값이니 혼동 주의), Spec Panel의 라이트 그레이 계열
`#999999/#DDDDDD/#EAEAEA/#F2F2F2/#E8E8E8/#333333/#666666/#888888`, 경고 텍스트
`#D40000`, 카드 라운드 20px·6px, Desktop/Glow의 oklab 그라디언트 값. 새 토큰을
만들지 말고 기존 보드와 동일한 raw hex를 그대로 재사용할 것.

---

## 5. 정확한 호출 시퀀스

아래 `<...>`는 이전 단계 결과에서 얻는 실제 노드 ID로 치환. **주의:** `write_html`
응답이 새 노드 ID를 직접 반환하는지 이 조사에서는 검증 못 했다(read-only라
호출 불가) — 반환값에 ID가 없으면 그 즉시 `get_children`으로 대상 부모를 조회해
방금 만든 자식 ID를 확보한 뒤 다음 단계로 넘어갈 것.

### 5.1 아트보드 생성

```json
create_artboard {
  "name": "23 · AT-XX-NNN <화면명>",
  "styles": {
    "width": "1920px",
    "height": "1080px",
    "display": "flex",
    "flexDirection": "row",
    "backgroundColor": "#0A0B0E",
    "overflow": "clip"
  }
}
```
→ `<ARTBOARD_ID>` 획득. `create_artboard`는 "가장 빈 자리"에 자동 배치하므로 그리드
좌표와 다를 수 있다 — 바로 다음 단계로 강제 이동시킨다.

### 5.2 그리드 좌표로 강제 이동

```json
update_styles {
  "updates": [
    { "nodeIds": ["<ARTBOARD_ID>"], "styles": { "left": "4240px", "top": "6400px" } }
  ]
}
```

### 5.3 Mockup Area 셸

```json
write_html {
  "targetNodeId": "<ARTBOARD_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Mockup Area\" style=\"display:flex;flex-grow:1;flex-basis:0%;height:100%;position:relative;overflow:clip;background-color:#0A0B0E;box-sizing:border-box;\"></div>"
}
```
→ `<MOCKUP_ID>`

### 5.4 Desktop + Glow 배경 (한 그룹으로 같이 넣어도 되는 순수 장식 레이어)

```json
write_html {
  "targetNodeId": "<MOCKUP_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Desktop\" style=\"position:absolute;top:0px;left:0px;width:1508px;height:1080px;box-sizing:border-box;background-image:linear-gradient(158deg,#1a1d24 0%,#171a20 38%,#151a1e 62%,#1a1e24 100%);\"></div><div layer-name=\"Glow\" style=\"position:absolute;top:-300px;left:520px;width:1100px;height:860px;border-radius:999px;box-sizing:border-box;background-image:radial-gradient(circle,rgba(200,205,215,0.13) 0%,rgba(200,205,215,0.04) 52%,rgba(50,55,60,0) 78%);\"></div>"
}
```
(정확한 oklab 그라디언트 값은 두 보드가 동일하니, 필요하면 `get_computed_styles`로
`QT-0`의 `Desktop`/`Glow` 노드를 다시 뽑아 그대로 복붙 — 위 hex/rgba는 근사치다.)

### 5.5 Caption

```json
write_html {
  "targetNodeId": "<MOCKUP_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Caption\" style=\"position:absolute;left:100px;top:112px;width:1000px;display:flex;flex-direction:column;gap:11px;box-sizing:border-box;\"><div layer-name=\"화면ID\" style=\"color:#FFFFFF6B;font-family:var(--font-mono);font-size:14px;letter-spacing:0.2em;line-height:18px;\">AT-XX-NNN</div><div layer-name=\"제목\" style=\"color:#F2F4F8;font-family:var(--font-title);font-size:30px;letter-spacing:-0.02em;line-height:36px;\">화면 제목</div><div layer-name=\"설명\" style=\"color:#FFFFFF8A;font-family:var(--font-kr);font-size:15px;line-height:25px;\">한 문장 설명.</div></div>"
}
```

### 5.6 메인 카드 셸 (콘텐츠는 화면마다 다름 — 행 단위로 쪼개서 계속 write_html)

```json
write_html {
  "targetNodeId": "<MOCKUP_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"<화면별 카드 이름>\" style=\"position:absolute;left:100px;top:300px;width:1308px;display:flex;flex-direction:column;overflow:clip;box-sizing:border-box;background-color:#171B24F0;border-radius:20px;border-top:1px solid #FFFDF86B;border-left:1px solid var(--color-k-line);border-right:1px solid var(--color-k-line);border-bottom:1px solid var(--color-k-line);box-shadow:inset 0 0 80px #FFF0D61A, 0 40px 90px #14100A85;\"></div>"
}
```
→ `<CARD_ID>`. 이후 헤더 행 1개, 컬럼헤더 행 1개, 데이터 행 각각 1콜씩 — 가이드의
"한 콜 = 한 시각 그룹" 규칙을 그대로 따른다(위 §3 골격 참고, 반복 행은 §7 정렬 팁 적용).

### 5.7 번호 배지 — `duplicate_nodes`로 복제 (토큰 절약, 가이드 권장 패턴)

```json
duplicate_nodes {
  "nodes": [ { "id": "QT-0의 Badge 1 노드ID(예: 2OX-0)", "parentId": "<MOCKUP_ID>" } ]
}
```
→ 응답의 `descendantIdMap`으로 복제된 배지의 내부 Text 노드 ID를 바로 알 수 있음.
그다음:
```json
update_styles { "updates": [ { "nodeIds": ["<새 배지ID>"], "styles": { "left": "62px", "top": "340px" } } ] }
set_text_content { "updates": [ { "nodeId": "<새 배지 Text ID>", "textContent": "1" } ] }
```
배지 개수만큼 반복(1, 1.1, 2 …). "n.n" 자릿수 배지(폭 34px)는 `Badge 1.1`을 소스로
복제.

### 5.8 Spec Note/Strip (하단 4열 요약)

```json
write_html {
  "targetNodeId": "<MOCKUP_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Spec Strip\" style=\"position:absolute;left:100px;top:<카드하단+22px>px;width:1308px;display:flex;padding-top:22px;border-top:1px solid #FFFFFF24;box-sizing:border-box;\"><div style=\"display:flex;flex-direction:column;flex-grow:1;flex-basis:0%;gap:7px;\"><div style=\"color:#FFFFFF5C;font-family:var(--font-kr);font-size:11px;letter-spacing:0.14em;line-height:14px;\">라벨1</div><div style=\"color:var(--color-k-text);font-family:var(--font-kr);font-size:15px;line-height:20px;\">값1</div></div></div>"
}
```
나머지 3개 column은 같은 부모(`<STRIP_ID>`)에 별도 `write_html` insert-children으로
추가(또는 첫 column을 `duplicate_nodes`로 3번 복제 후 `set_text_content`).

### 5.9 Spec Panel 셸 + Panel Title

```json
write_html {
  "targetNodeId": "<ARTBOARD_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Spec Panel\" style=\"width:412px;flex-shrink:0;height:100%;display:flex;flex-direction:column;background-color:#FFFFFF;border-left:1px solid var(--color-doc-line);box-sizing:border-box;\"><div style=\"height:44px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background-color:var(--color-doc-ink);box-sizing:border-box;\"><div style=\"color:#FFFFFF;font-family:var(--font-kr-bold);font-size:19px;letter-spacing:-0.005em;line-height:24px;\">화면 제목</div></div></div>"
}
```
→ `<SPEC_PANEL_ID>`.

### 5.10 Meta rows (화면 ID / 화면 명 / 위치)

```json
write_html {
  "targetNodeId": "<SPEC_PANEL_ID>",
  "mode": "insert-children",
  "html": "<div style=\"padding-inline:14px;padding-top:14px;width:100%;flex-shrink:0;box-sizing:border-box;\"><div style=\"border-top:1px solid #999999;box-sizing:border-box;\"><div style=\"height:36px;display:flex;align-items:center;width:100%;border-bottom:1px solid #DDDDDD;box-sizing:border-box;\"><div style=\"width:104px;flex-shrink:0;height:36px;display:flex;align-items:center;padding-left:12px;background-color:#F2F2F2;box-sizing:border-box;\"><div style=\"color:#111111;font-family:var(--font-kr-bold);font-size:14px;line-height:18px;\">화면 ID</div></div><div style=\"flex-grow:1;flex-basis:0%;padding-left:14px;box-sizing:border-box;\"><div style=\"color:#111111;font-family:var(--font-kr);font-size:14px;line-height:18px;\">AT-XX-NNN</div></div></div></div></div>"
}
```
"화면 명"·"위치" 행도 각각 같은 형태로 이어서 추가(마지막 "위치" 행만
`borderBottom:1px solid #999999`).

### 5.11 Desc Header

```json
write_html {
  "targetNodeId": "<SPEC_PANEL_ID>",
  "mode": "insert-children",
  "html": "<div style=\"height:34px;flex-shrink:0;display:flex;align-items:center;padding-inline:14px;width:100%;background-color:#E8E8E8;box-sizing:border-box;\"><div style=\"color:#111111;font-family:var(--font-kr-bold);font-size:15px;line-height:18px;\">Description</div></div>"
}
```

### 5.12 Desc List — 행마다 1콜, 마지막에 각주

```json
write_html {
  "targetNodeId": "<SPEC_PANEL_ID>",
  "mode": "insert-children",
  "html": "<div layer-name=\"Desc List\" style=\"flex-grow:1;flex-basis:0%;display:flex;flex-direction:column;padding-inline:14px;padding-top:10px;width:100%;box-sizing:border-box;\"></div>"
}
```
→ `<DESC_LIST_ID>`, 그다음 행 하나씩:
```json
write_html {
  "targetNodeId": "<DESC_LIST_ID>",
  "mode": "insert-children",
  "html": "<div style=\"display:flex;align-items:flex-start;gap:10px;padding-block:9px;border-bottom:1px solid #EAEAEA;box-sizing:border-box;\"><div style=\"width:26px;flex-shrink:0;text-align:right;font-family:var(--font-kr-bold);font-size:14px;line-height:18px;color:#111111;\">1</div><div style=\"flex-grow:1;flex-basis:0%;display:flex;flex-direction:column;gap:3px;box-sizing:border-box;\"><div style=\"color:#111111;font-family:var(--font-kr-bold);font-size:14px;line-height:18px;\">항목 제목</div><div style=\"color:#333333;font-family:var(--font-kr);font-size:13px;line-height:20px;\">: 설명 1줄</div></div></div>"
}
```
마지막 행만 `borderBottom` 생략. 그 뒤 각주 블록(회색 `#666666` / 경고
`#D40000`, 13px, gap 5px, paddingTop 10px) 1콜.

### 5.13 Page No footer

```json
write_html {
  "targetNodeId": "<SPEC_PANEL_ID>",
  "mode": "insert-children",
  "html": "<div style=\"height:38px;flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;padding-inline:16px;width:100%;box-sizing:border-box;\"><div style=\"color:#888888;font-family:var(--font-kr);font-size:14px;line-height:18px;\">23</div></div>"
}
```

### 5.14 리뷰 + 마감

- 가이드의 Review Checkpoints(간격/타이포/대비/정렬/아트보드 클리핑/반복 리듬)를
  `get_screenshot`으로 §5.6·§5.9 이후 최소 2회 확인.
- 잘리면 `height`를 임의 픽셀로 재추정하지 말고 `update_styles`로
  `height:"fit-content"` 적용(가이드 명시 규칙).
- 끝나면 반드시:
```json
finish_working_on_nodes {}
```

---

## 6. 핵심 함정 (가이드/스키마에서 직접 확인)

1. **한 콜 = 한 시각 그룹.** 15줄 넘는 HTML은 쪼갤 것. 카드 하나를 한 번에 통째로
   쓰지 말 것 — 헤더/행/푸터 각각 별도 `write_html`.
2. **`create_artboard`는 좌표를 못 정한다.** "가장 빈 자리"에 자동 배치되므로,
   그리드에 맞추려면 생성 직후 `update_styles`의 `top`/`left`로 강제 이동해야 한다
   (§5.2). 간격은 이 파일 관행상 200px, 스키마 예시의 80px 아님.
3. **아트보드 기본값은 `flexDirection:column`이다.** 좌우 2열(Mockup Area + Spec
   Panel) 레이아웃을 쓰려면 `create_artboard` 호출 시 `flexDirection:"row"`를 명시
   덮어써야 한다 — 안 그러면 두 영역이 위아래로 쌓인다.
4. **클리핑 시 픽셀 높이를 추측하지 말 것.** `height:"fit-content"`로 전환.
5. **반복 행은 세로 정렬선이 깨지기 쉽다.** 아이콘/상태/트레일링 요소는 고정폭
   `width` + `flexShrink:0` 슬롯으로 만들고, gap만으로 정렬 맞추지 말 것. 3행 이상
   만들면 스크린샷에서 세로선을 그어 검증(가이드 "Vertical lane alignment" 항목).
6. **`update_styles`는 무효한 스타일을 조용히 버린다** — 응답의 `ignoredStyles`를
   반드시 확인. 오타나 컨텍스트에 안 맞는 속성은 에러 없이 사라진다.
7. **`finish_working_on_nodes`는 선택이 아니라 필수.** 인자 없이 호출하면 작업 중이던
   모든 아트보드의 작업 표시가 해제된다.
8. ~~**`write_html`의 반환값에 새 노드 ID가 있는지 이 조사로는 확인 못 했다.**~~
   → **확인됐다(2026-08-18 실집행).** 응답의 `createdNodes` 배열에 생성된 모든
   노드(자손 포함)의 ID·이름·컴포넌트·좌표가 온다. `get_children` 우회는 불필요하다.
9. **폰트는 이미 로드돼 있다** (`Daki`, `Daki B`, `Daki Title`, `Geist Mono` —
   `get_basic_info.fontFamilies`). 새 폰트를 쓰지 않는 한 `get_font_family_info`
   재확인은 생략 가능(가이드 규칙 1 "이미 로드된 폰트 우선").
10. **`x-paper-clone`/`duplicate_nodes`로 토큰 절약.** 배지, Spec Strip 4열, 반복
    행처럼 형태가 같고 텍스트/좌표만 다른 요소는 처음부터 새로 쓰지 말고 기존
    노드(같은 보드 안이든 `QT-0`/`QQ-0`이든)를 복제 → `update_styles`로 위치 조정 →
    `set_text_content`로 텍스트 교체.
11. **`write_html`의 `style` 문자열은 케밥케이스 CSS만 쓴다 — camelCase는 조용히
    버려진다** (실측 2026-08-18, 보드 8쪽 재작업). `style="backgroundColor:#fff;
    borderRadius:4px"`처럼 쓰면 에러 없이 생성되지만 `get_computed_styles`로 확인하면
    width/height/display/gap/position 계열만 살아남고 배경·보더·그림자·패딩·타이포는
    전부 소실돼 있다 — **보이지 않는 유리**가 만들어진다. 반드시
    `style="background-color:#fff;border-radius:4px"`로 쓸 것. **혼동 주의**:
    `update_styles`·`create_artboard`의 `styles` JSON 객체는 반대로 **camelCase가
    정식**이다(React.CSSProperties 문법). 표면마다 문법이 다르다 — html 문자열은
    케밥, JSON 객체는 camel. camelCase로 이미 써버렸다면 `update_styles`로 같은
    스타일을 재적용해 복구할 수 있다(보드 8쪽이 실제로 이 경로로 복구됐다). 쓰고
    나면 `get_computed_styles`로 핵심 속성이 실제로 붙었는지 확인하는 것이 값싸다.

---

## 7. 실행 에이전트에게 남기는 열린 질문

- 23번 보드가 실제로 어떤 화면(AT-ID)을 다룰지는 이 조사 범위 밖 — 콘텐츠는
  `plan/paper-specs/AT-*.md` 스펙 문서 중 아직 Paper에 없는 화면을 골라 채울 것.
- Desktop/Glow의 정확한 oklab 그라디언트 문자열은 §5.4에 근사치만 적었다. 실행
  직전 `get_computed_styles(["QT-0의 Desktop/Glow 노드ID"])`로 원문 그대로
  재확인 권장.
