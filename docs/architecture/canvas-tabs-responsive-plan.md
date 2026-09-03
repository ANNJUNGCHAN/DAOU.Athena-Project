# 캔버스 탭 · 반응형 카드 계획 (v1, 2026-09-02)

> 사용자 지시(2026-09-02): "모든 카드는 반응형이고 크기가 동일하다. 캔버스에는 카드가 하나만 들어가고, 여러 카드는 브라우저 탭처럼 띄운다. 창을 2분할·4분할·원본·최소로 줄였다 늘렸다 해도 반응형으로 동작한다." 이 문서는 [카드 표면 구현 계획](./card-surface-implementation-plan.md)의 D3(폭)를 대체하고 나머지 결정(D1·D2·D4~D7)은 유지한다.

## 1. 캔버스 = 탭 브라우저

- 캔버스 영역은 **탭 스트립 + 뷰포트 1개**다. 기존 2열 모자이크(`app/canvas.css:63 .grid`)는 키움 보드 카드에 대해 쓰지 않는다.
- 탭 1개 = 카드 인스턴스 1개(`instanceKeyFor`, `app/lib/integrated-card-surface.js:41` 그대로). 같은 인스턴스 키의 후속 봉투는 새 탭을 만들지 않고 그 탭을 갱신한다(기존 "같은 인스턴스 갱신" 계약 유지).
- 탭 제목 = `카드명 · 대상`(예: `시세 · 삼성전자`, `계좌 · ****4721`). 닫기·드래그 정렬·새 카드 자동 활성. 탭 상태(활성·순서)는 대화 세션에 저장.
- 카드 크기 = 뷰포트 크기(폭 100% · 높이 100%). 보드 본문이 뷰포트보다 길면 카드 안에서 세로 스크롤. 따라서 **모든 카드 크기가 동일**하다.
- 탭 스트립은 셸 크롬이다(카드가 아님). 디자인 기록용 Paper 보드 `캔버스 탭 스트립`을 화면 페이지에 추가한다(후속).

## 2. 반응형 규격 — 컨테이너 쿼리 5단

기준은 창이 아니라 **카드 컨테이너 폭**(`container-type: inline-size`). 사용자 스크린샷 4종(최소·4분할·2분할·원본)에 대응한다.

| 단계 | 컨테이너 폭 | 레이아웃 |
|---|---|---|
| **XL** | ≥ 1280 | Paper 1:1. 본문 폭 1440 상한, 중앙 정렬. 표 8열·KPI 6칸·레일 460px 우측. |
| **L** | 960–1279 | 레일 360px 우측 유지. 표 6열(우측 열부터 병기로 접힘). KPI 6칸 유지. |
| **M** (2분할) | 720–959 | 레일이 primary 아래로 내려감(100%). 표 5열. KPI 3칸×2줄. 스트립 칩 가로 스크롤. |
| **S** (4분할) | 480–719 | 표 4열(종목·현재가·정렬지표·거래량). KPI 2칸. 레일 블록 아코디언(제목 행만, 펼침). |
| **XS** (최소) | < 480 | Paper 좁은 데스크톱 C01~C03 규격(390px). 표 3열. KPI 1칸 세로. 호가 사다리 5단. |

규칙:
- **값·문구는 어느 단계에서도 바뀌지 않는다.** 접힌 열은 삭제가 아니라 셀 병기(문법 A) 또는 행 펼침(문법 F)으로 내려간다 → 필드 표현 100% 유지.
- 접히는 열 순서는 `slots.json.column_priority`(표준 열 세트, 헌장 §4)의 역순.
- 호가 사다리·AITS 차트는 전문 렌더러가 자체 반응형(사다리 10단→5단, 차트 폭 100%).
- 글자 크기는 단계와 무관하게 헌장 11조(판단 텍스트 12px 이상)를 지킨다. 축소(zoom)는 쓰지 않는다.

## 3. 추출 파이프라인의 반응형 층

Paper 보드 JSX는 px 고정 플렉스다. 추출기(`scripts/paper_board_extract.py`)는 원문을 보존하되 **영역(region)에 반응형 클래스를 얹는다**:

```
paper.jsx  →  board.html  (인라인 스타일 원문 + region 컨테이너에 class="bs-header|bs-strip|bs-workspace|bs-primary|bs-rail|bs-footer|bs-kpi|bs-table")
regions.json (에이전트가 보드의 최상위 프레임에 역할을 표시: node id → role)
slots.json   (필드 바인딩 + column_priority + 병기/펼침 관계)
```

- XL에서는 `bs-*` 클래스의 CSS가 전부 no-op이라 **픽셀 동일**이 유지된다(P2 구조 해시로 보증).
- L 이하에서만 `@container` 규칙이 `bs-workspace`(flex-wrap), `bs-rail`(폭·순서), `bs-kpi`(grid auto-fit), `bs-table`(열 접기 = `data-col-priority`로 `display:none` + 병기 셀 활성)을 바꾼다.
- 반응형 CSS는 `app/styles/board-surface.css` 한 파일, 토큰만 사용.

## 4. 원문 저장 형식 (Paper → 리포)

`backend/ref/card-surface-templates/<board_id>/`
- `meta.json` — board_id · name · card_id · width · height · state{kind, parent_board, control} · operation_refs(원장에서)
- `paper.jsx` — `get_jsx(inline-styles)` 원문
- `paper.tree.txt` — `get_tree_summary(depth 10)` 원문(노드 이름 앵커 `raw|<tr>|body|<field>` 포함)
- `regions.json` — 최상위 프레임 역할 표시
- (생성) `board.html`, `slots.json`

## 5. 파리티·검증

- P1 텍스트 다중집합 상등(fixture = Paper 샘플) · P2 XL 구조 해시 · P3 스크린샷 **보드 × 5단계**(`verify-integrated-cards` 창 크기 프리셋: 원본 1920·2분할 960·4분할 640·최소 480) · P4 필드 슬롯 커버리지 현황판 · P5 각 단계에서 텍스트 다중집합 상등 유지(접힘은 이동이지 삭제가 아님).

## 6. 웨이브

- **W1(병렬)**: P1~P3 Paper 원문 저장(96장, 카드별) ∥ A 추출기+반응형 변환기 ∥ B 백엔드 로더·`surface_contract`·MCP parity·테스트 ∥ C 캔버스 탭 뷰포트·board-mount/format/registry·반응형 CSS·단위 테스트 ∥ D 현황판.
- **W2**: 슬롯 저작(카드 6레인) → 봉투 배선 → 파리티 P1/P2/P5 → 탭 UX.
- **W3**: 실앱 QA 5단계 스크린샷 · 실키움 · 헌장 게이트 · 검수.
