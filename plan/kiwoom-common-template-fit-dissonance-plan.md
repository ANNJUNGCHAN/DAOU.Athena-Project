# 키움 공통 UI 템플릿 · 이질감 테스트 및 구현 실행계획

> **2026-08-21 후속 계약:** 이 문서의 90개 사람 표본과
> `inter_rater_agreement`는 화면 정의가 없던 G001.5 시기의 디자인 루브릭 검수다.
> `plan/캔버스-우선-응답-지시문.md`가 요구한 301개 완전 ScreenDefinition이 materialize된
> 뒤에는 `fit_dissonance_check.py --check`의 기계 완료 조건을 막지 않고
> `human_review_advisory`로 별도 보고한다. 사람이 실제로 채점하지 않은 값은 생성하지 않는다.
> 현재 기계 게이트는 301개 조인, zero-tolerance/override, 승인된 Paper 13 case 전부의 최신
> Electron DOM·layout·control·state·screenshot provenance를 검증한다. 아래의 표본 설계와 루브릭 자체는 향후 독립 검수용으로
> 보존한다.

> 기준일: 2026-08-16
> 저장소: `C:\Users\ajc22\orca\workspaces\DAOU.Athena\Call`
> 문서 상태: **결정 1·2·3·5 확정(2026-08-16 사용자 승인), 결정 4(용량 목표)만 미정.** 확정 내용 — Paper: 이번 세션 MCP 재연결 시도 / 템플릿: 3캔버스+6프리미티브 유지 / 합격선: **엄격안** / 사람 표본: **90개(약 30%)**. 상세는 §8.
> 계승 문서(대체하지 않고 확장): `plan/kiwoom-optimal-screen-selection-rendering-plan.md`(ScreenDefinition/ScreenDocument 계약, section primitive 6종, state 7종, G001~G007 스토리, DoD), `plan/kiwoom-common-screen-handoff.md`(최소 공통화면 3종 결정: Adaptive Record Canvas / Live Stream Canvas / Schema-driven Request Sheet), `plan/kiwoom-common-screen-brief.md`(아키텍처 불변식 10개, 안전 게이트). `plan/canvas-taxonomy.md`의 캔버스 12종은 선택적 semantic lens로 강등된 상태를 유지한다.
> 신설 지점: **G001과 G002 사이에 G001.5(Paper 선행 디자인 · 이질감 게이트)를 삽입**한다. 기존 G002~G007 번호와 산출물은 그대로 두되, G002는 G001.5의 override/rule/free-canvas 산출물을 입력으로 받고, G003(렌더러 구현)은 Paper 실동기화를 하드 선행조건으로 갖는다(§3).
> 개정 이력: v1(초안) → v2(architect CLEAR-조건부, 7건 반영) → v3(critic ITERATE, BLOCKER 3건+MAJOR 4건+MINOR 2건 반영) → v4(architect 2차 BLOCKED, FIX 1~4 반영 — 자유 캔버스 예산 신설, 죽은 조건 수정, 규칙 3/4 병합, rater_mode 노출) → v5(사용자 결정 반영: 합격선 엄격안·표본 90개, 그리고 주문 12개를 팝업 창으로 분리 — §9 신설, safety/design/contract 3렌즈 적대적 검토 BLOCKER 9 + MAJOR 9 반영) → v6(설정 화면을 대화 창의 확장 상태로 신설 — §10. dot 클릭 진입, 새 창 없음, 자격증명 입력 폼 없이 상태 조회·토큰 발급/폐기만 제공) → **v7(사용자 결정으로 설정을 독립 창으로 재설계 — §10 개정. "창은 둘" 규범 이탈 2건째로 정직하게 기록: §9 주문 팝업에 이어 설정 창도 `ui/soul.md:190`/`ui/DESIGN-SOUL.md:102,157`을 정면 이탈. §10.2.2에 soul.md/DESIGN-SOUL.md 재개정 선결조건 신설)**. → **v8(2026-08-16 정정: `GLOSSARY.md` §1의 상시 창/일시 표면 구분을 뒤늦게 확인 — §9·§10의 "규범 이탈" 판정과 soul.md 개정 선결조건을 철회한다)**. 이 문서는 v8이며 이전 버전을 대체한다.

---

## 0. RALPLAN-DR 요약

### Principles

1. **301개(186 base + 115 detail) 전수는 계약 레이어에서, 사람 눈은 표본에서만.** 사람이 301개를 다 볼 수 없다는 전제를 §14.3(원 rendering-plan) 원칙 그대로 이질감 테스트에도 적용한다.
2. **템플릿 수를 늘리지 않고 결정적 규칙으로 흡수 → 안 되면 reviewed override → 안 되면 자유 캔버스.** 이 순서를 거꾸로 하지 않는다. **v4: 이 세 단계 전부가 이제 수치 상한과 CI 게이트를 갖는다** — 규칙(§5.3.4, ≤10행), override(§5.4, ≤60개), 자유 캔버스(§5.5, ≤15개, 신설). 이전 버전까지는 override만 하드 게이트였다.
3. **TR ID는 어떤 상태에서도 사용자에게 노출하지 않는다.** `ui/DESIGN-SOUL.md:128-133`이 과거 "TR 코드를 그대로 노출한다"(`ui/round-1R/answer.md:52`) 입장을 명시적으로 정정한 최신 결정이다 — 정직한 것은 코드가 아니라 항목명이라는 정정을 최종 기준으로 삼는다.
4. **Paper는 이번 라운드에서 생각을 검증하는 도구이지 완성본을 그리는 도구가 아니다.** 301×7 전체 상태 매트릭스를 그리지 않는다. 단, "먼저 검증"이 "언젠가 검증"으로 흐려지지 않도록 §3에서 G003(렌더러 구현) 착수를 Paper 실동기화에 하드 게이트로 건다.
5. **안전 불변식(live order 금지, credential 비노출, WebSocket lifecycle, 계좌 확정 전 clarification)은 이질감 채점 대상이 아니라 통과 전제조건이다.** fit 점수가 아무리 높아도 안전 불변식 위반이 있으면 무조건 fit=0.
6. **검증 도구의 측정 단위가 구현 아키텍처를 강제해서는 안 된다.** AITS의 감사 스크립트 `judgeSvelteFromText`가 "파일당 첫 `<thead>` = 그 화면의 답"이라는 가정을 강제해, 공유 가능했던 컴포넌트(`Ka10072Fields.svelte`/`Ka10073Fields.svelte` — 둘 다 64줄, `<thead>` 컬럼 14 vs 15와 제목만 다르고 나머지 바이트 동일)를 "측정 불가"로 낙인찍고 파일 복제를 강제했다(`Ka10072Fields.svelte:9-12` 주석이 이 이유를 자백한다). Athena의 field sentinel은 파일/컴포넌트 단위가 아니라 canonical `data-field-id`/`data-section-id` attribute 단위여야 한다(§6.1).

### Decision Drivers 상위 3

1. **301개를 사람이 볼 수 없다** — 표본 설계 근거가 반드시 있어야 한다(§2.4).
2. **이미 확정된 3캔버스+6프리미티브를 재설계하면 안 된다** — AITS의 진짜 실패 원인은 프레임워크가 아니라 검증 도구가 강제한 파일 단위 중복이었다. primitive 수를 늘리는 대신 결정적 규칙 + 올바른 sentinel 설계로 흡수해야 한다.
3. **Paper MCP가 이번 세션에 로드돼 있지 않다** — 재연결 여부가 불확실한 선행조건이므로 폴백 경로가 반드시 있어야 하되, 폴백이 "Paper 선행"이라는 사용자 원 요청을 무력화하지 않도록 구조적 게이트가 필요하다(§3).

### Viable Options

**(a) 템플릿 개수/구성**

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A. 채택 — 3캔버스+6프리미티브 유지, 밀도·구조는 결정적 규칙으로 흡수** | Adaptive Record Canvas / Live Stream Canvas / Schema-driven Request Sheet(불변) + facts/table/event_stream/status/action/order_receipt(불변). 이상치는 facts 그룹 분할·table 컬럼 우선순위·event_stream 사다리 판정 같은 생성 규칙으로 흡수 | 기존 계약과 100% 정합. Athena 실측이 뒷받침: list 보유 150 TR의 컬럼셋 시그니처 136종 중 122개가 TR 고유 배열(최대 재사용 ka20006/07/08/19 폭7, 4개뿐)이라는 것은 "TR별 전용 컴포넌트"가 아니라 "데이터 기반 제네릭 바인딩"이 구조적으로 필요하다는 뜻이지 캔버스 종류를 늘려야 한다는 뜻이 아니다 | 규칙(§5.3)이 계속 늘면 "규칙"이라는 이름의 TR-shape별 분기로 변질될 위험 — invariant 6 위반 방향. §5.3.4 규칙 예산과 §7 위험으로 관리 |
| B. 기각 — 4번째 "Dense Overflow" 캔버스 신설 | 이상치 전용 캔버스 추가 | 이상치 처리가 명시적 | `kiwoom-common-screen-handoff.md`의 결정(3종)·invariant 6("operation-specific duplication은 진짜 다른 도메인 행동에만") 위반. 경계가 계속 늘어나 캔버스타입 재증식으로 회귀 — **v4: 자유 캔버스가 무예산으로 방치되면 이 옵션 B를 TR 단위로 몰래 재도입하는 것과 동형이 된다는 것이 architect 2차 리뷰의 핵심 지적이었다. §5.5에서 자유 캔버스도 예산화해 이 회귀 경로를 차단한다.** |

옵션 B는 기각 유지. 3+6 유지, 규칙·override·자유 캔버스 **세 단계 모두** 수치 상한을 갖는다.

**(b) 이질감 테스트 방법론** — 채택: 2단계(기계 전수 게이트 + 사람 표본). "301/301 자동 통과 = 이질감 없음 증명"이 아님을 명시적으로 분리한다(§2.1). 자동 지표는 정의(definition) 레이어의 채점이고, 실물(렌더링된 실제 크기)의 이질감은 CSS 실측 보정 전까지 provisional이다(§2.6). 사람 채점은 채점자 간 일치(inter-rater) 없이는 수치 게이트로 쓰지 않는다(§2.3).

기각: 사람 눈 전수(301개 불가능, 재현 불가) / 기계 지표 전용(TR ID 노출·사다리 구조 파손 같은 "숫자로 안 보이는" 실패를 못 잡음).

**(c) Paper 선행 디자인 범위** — 채택: 대표 아트보드 ≈20개 + anchor 이상치 명시 포함(§4). 전체 상태 매트릭스(3캔버스×7상태×301)는 비현실적이고 Paper MCP 미연결 상태에서 착수 리스크를 이중화한다.

---

## 1. 완료 처리 — 데이터 훑기 · AITS 조사

새 스토리를 만들지 않는다. 아래는 G001.5의 입력 evidence다. 전부 실측치이며 팀리드·architect·critic이 제공하거나 이번 계획 수립 중 리포지토리에서 직접 확인한 수치다.

### 1.1 Athena Output 형상 (`backend/ref/kiwoom-output-profile.json`)

| 항목 | 수치 |
|---|---|
| kind 분포 | query 171 / websocket 23 / order 12 / oauth 2 |
| query shape | pure_list 111 / compound 39 / scalar_only 21 |
| query list section 수 | 1개 150 TR / 0개 21 TR. **list가 2개 이상인 query TR은 0개.** nesting depth 1~2뿐 |
| query list 열 너비 | n=150, min 2, median 11, p90 20.1, max 63 |
| query scalar leaf | min 1, median 12, p90 30, max 124 |
| screen_complexity > 20 (`kind==query`, `shape!=pure_list`) | 22개 (= detail 후보 22개와 동일) |
| pure_list인데 열 20개 초과 | 12개 |
| 최대 폭 테이블 | ka10095(63), kt00015(51), ka30005(39), ka10075(30), ka10015(30) |
| 최대 스칼라 | ka10007(124), kt00001(83), ka10004(69), ka30012(65) |
| **컬럼셋 시그니처(list 보유 150 TR 기준)** | **136종 — 122개 TR이 고유 배열.** 최대 재사용 = ka20006/07/08/19(폭7) 4개뿐 |
| 생성 모델 leaf 타입 | 208개 생성 모델의 **모든 leaf가 `str\|None`**(네이티브 숫자 타입 0) — raw/display lossless 원칙의 직접 근거 |
| policy | `list_ui_page_size: 10`(`kiwoom-output-profile.json:3587`) |
| WS 봉투 형태 | WS 23종 중 **19종 동일 envelope**, ka10171/72/73/74만 이탈. **ka10173은 list section 2개 + Object 타입 values**(query 모집단의 "list≥2=0"과는 다른 모집단 통계 — kind=websocket 별도 집계이므로 모순 아님) |
| WS 폭 상위/하위 | 0D(170 leaf/167폭, 호가사다리), 0F(64/61), 0B(50/47), 00(42/39), 04(34/31) / 최소 ka10174(4/0), ka10171(5/2) |

### 1.2 필드 어휘 (`backend/ref/kiwoom-tr-inventory.json`, query 171개 응답 필드 3013행)

| 항목 | 수치 |
|---|---|
| 응답 alias distinct | **1343**(스칼라롤 790 + 리스트컬럼롤 656). *구 수치 1588은 "- " 접두 변형을 별도로 센 값이라 정정됨.* |
| 최다 재사용 alias(우선순위 tie-break용) | `cur_prc 89, pred_pre 85, stk_cd 83, stk_nm 80, trde_qty 63, flu_rt 61` |
| 키움 원본 타입 | 전부 String(2862) + LIST(151) — 숫자/날짜 타입 정보가 원천에 없음 |
| 길이 힌트 | 3013행 중 2673행 존재(대부분 20) |
| 이름 규칙 기반 의미 추론 | price 20%, quantity 13%, amount 10%, rate 6%, flag/enum 6%, name 5%, code 4%, date 3%, time 2%, identifier 1%, **unknown 27%** |
| 라벨 충돌 | alias 1343 중 75개는 서로 다른 한국어 라벨(예: 등락율/등락률). 최악 stk_cd 4종 |
| 요청 필드 | 총 573행, distinct 121개, required=Y 503개. TR당 min 0/median 3/max 13. 최다 stk_cd 84, mrkt_tp 47, stex_tp 47, strt_dt 20, end_dt 19 |

### 1.3 detail projection (`backend/ref/response-projections.json`)

| 항목 | 수치 |
|---|---|
| 분해 | 22 TR → 115 group. group 크기 min 1/median 6/p90 15/max 20 |
| layout | facts 96, table 10, **layout 키가 아예 없는 legacy group 9개 — 전부 ka10007**. title_ko/title_en 없음, title이 "ka10007 ten-level bid prices" 형태로 **TR ID가 제목에 노출** |
| ka10007 사다리 구조 | bid_prices/bid_quantities/bid_changes 각 20필드 = 10호가 사다리를 병렬 배열 3개로 찢어놓은 형태 |
| TR별 group 수 최다 | ka30012(10), ka10004(9), ka10007(9), ka10087(9), kt00013(9) |

### 1.4 AITS 실측 (`DAOU.AITradingSystem/rel-a` — Electron + Svelte + Python FastAPI)

| 항목 | 수치 |
|---|---|
| 화면 카탈로그(`its-screen-catalog.json`) | 화면 53개, screenIds 64개, variants 15개 |
| TR→화면 매핑(`its-screen-matrix.json`) | **TR 208개 전부가 54개 screenId로 매핑, 미매핑 0개.** 즉 AITS는 이미 208→64 archetype(**54 TR-bound + 10 non-TR**, 평균 **3.85 TR/archetype** = 208/54)으로 접어놓은 상태다 |
| 화면당 TR 수 분포 | 0개 12화면, 2개 11화면, 3개 7화면, 최다 차트 19/시세표 15/실시간체결 8 |
| **화면 카탈로그 389 엔트리** | **문서 레지스트리이지 컴포넌트 수가 아니다** — 구현 비용과 혼동 금지 |
| `.svelte` 컴포넌트 수(정정) | **155개(slices 87 + screens 51 + shared 16)**, 이 중 **TR 바인딩 카드는 87개** |
| 골든 케이스(`canvas-card-golden.json`) | 116케이스. 카드 kind는 **6종뿐 — market 39, stock 32, ranking 24, account 7, chart 5, sig 1.** intent: scan_market 60, inspect_stock 33, inspect_account 7, not_found 5, order_flow_delegate 4, pick_match 4, clarify 2, ai_answer 1 |
| **근본 원인 증거(핵심)** | `check-pnl/screens/Ka10072Fields.svelte`, `Ka10073Fields.svelte` — **둘 다 64줄, `<thead>` 컬럼(14 vs 15)과 제목만 다르고 나머지 바이트 동일.** `Ka10072Fields.svelte:9-12` 주석이 이유를 자백: 감사 스크립트 `scripts/audit/screen-field-coverage-core.mjs`의 `judgeSvelteFromText`가 **파일당 첫 `<thead>` 하나만 화면의 답으로 읽어서**, 공유 컴포넌트로 묶으면 "측정 불가"로 낙인찍힌다. per-TR 필드 컴포넌트는 총 32개(TR코드가 파일명). **중복은 프레임워크 한계가 아니라 검증 도구의 정적 분석 가정이 강제한 것** — §0 원칙 6, §6.1 sentinel 계약의 직접 근거 |
| 운영 비용 증거 | 화면 감사·생성 메타툴링 **31,807 LOC > 감사 대상 UI 30,031 LOC**(역전). `docs/` 22MB(`live-snapshot.js` 13MB). 화면선택 fixture 6.4MB. 같은 결함(빈 결과 문구 누락)이 화면 3개에 각각 별도 issue(#214/#215/#216)로 분열(공유 컴포넌트였으면 1건) |

**AITS의 핵심 교훈은 "화면 53개"가 아니라 "화면당 손으로 만든 컴포넌트 155개, 그중 32개는 검증 도구가 강제한 순수 복제"다.** Athena의 6 section primitive + 결정적 규칙 접근은 이 실패를 반복하지 않기 위한 것이며, 이번 계획의 목적은 primitive 수를 유지한 채 이상치를 규칙으로 흡수하되 그 규칙·override·자유 캔버스 전부에 수치 상한을 거는 것이다.

추가 조치 없음. 필요시 G001.5 실행 중 그룹별 실제 필드값(Paper 목업 콘텐츠용)만 두 파일에서 추출한다.

---

## 2. 이질감(fit dissonance) 테스트 설계

### 2.0 스코프 선언

이질감 정의(§2.1)는 **화면(캔버스) 1개 단위**에 한정한다. 여러 화면이 한 창에 동시 표시되는 모자이크 상태의 상호작용 이질감(광량 위계 붕괴, 갱신 신선도 표시)은 범위 밖이다 — `ui/round-1R/two-windows.md:123,132`의 미해결 항목("캔버스 3개 이상 동시에 광량 위계가 무너지지 않는지", "캔버스 갱신 신선도 표시")으로 남겨두고 비목표에 명시한다(§7).

> **완료조건에 그대로 노출하는 명시**: 301/301 자동 채점 통과는 **스크린 정의(definition) 레이어의 검증**이지 **실물(실제 렌더링된 화면)의 이질감 없음 증명이 아니다.** 이 둘을 완료 선언에서 동일시하지 않는다. §2.2 임계값은 CSS 실측 전까지 **provisional**이다(§2.6).

### 2.1 조작적 정의

**이질감** = 템플릿(캔버스+섹션 조합)에 실제 API 데이터를 매핑했을 때, 다음 세 범주 중 하나 이상이 발생하는 상태.

1. **정보 손실** — 원본 구조(사다리, 페어링, 순서)가 템플릿 분해 과정에서 사람이 재구성할 수 없게 깨짐
2. **인지 과부하** — 한 섹션·한 화면에 담긴 필드/컬럼/행 수가 1560×800 캔버스에서 스캔 가능한 범위를 넘음
3. **정직성/안전 위반** — TR ID 노출, 라벨 없는 원문 코드 노출, 포맷터 없이 원문 그대로 노출

### 2.2 실패 유형 코드

| 코드 | 조작적 조건 | 근거 증거 | 채점 |
|---|---|---|---|
| `OVERFLOW_WIDTH` | table 섹션 컬럼 수 > 12(경고)/20(실패) **[임계값 provisional, §2.6]** | ka10095(63), kt00015(51), ka30005(39), ka10075(30), ka10015(30); n=150 중 20열 초과 12개 | 자동 |
| `FACTS_DENSITY_EXCEEDED` | facts 섹션 필드 수 > 12(경고)/20(실패) **[provisional]** | ka10007(124), kt00001(83), ka10004(69), ka30012(65) | 자동 |
| `STRUCTURAL_MISMATCH` | **(REST)** 동일 TR 내 형제 detail group이 동일 크기 숫자 접미사 필드군을 공유하는데 분리됨. **(WS 확장)** flat `f_<id>` 필드 집합이 (a) 공통 인덱스(레벨 1~N)를 공유하고 (b) 동일 인덱스 내 역할군(가격/잔량/증감 등, `kiwoom-tr-inventory.json` 라벨/설명 메타데이터로 판정)이 반복되면 "사다리 가족"으로 간주 — response-projections의 명명된 group이 없으므로 형제 group 판정을 **FID 라벨 정규식 매칭 + 인덱스 카운트 일치**로 대체 | ka10007 bid_prices/qty/changes(REST), 0D/0F/0B(WS), ka10173(이형 envelope 반례) | 자동(패턴), 최종 확인 사람. **정규식 패턴·최소 반복 임계값은 [측정 필요] — G001.5 착수 전 0D/0F/0B 실제 FID 라벨 대조로 확정해야 하는 선행조건으로 고정** **(2026-08-18 확정: kor 라벨에서 `\d{1,2}` 추출 → 숫자 제거한 나머지를 base(역할군)로 그룹핑 → base당 idx 집합 ≥3(min_repeat_threshold)이고 동일 idx 시그니처를 공유하는 base가 ≥2개면 사다리 가족. 매치: 0D 120/163 leaf필드(12역할군, 1가족), 0F 50/57(10역할군, 1가족), 0B 0/43(비사다리 — §2.4 anchor의 "WS 최대폭" 표본 전제 재검토 필요), 반례 ka10173도 0/5로 정확히 필터링. 근거 backend/ref/ws-ladder-regex-calibration.json)** |
| `STREAM_FIELD_EXCEEDED` | event_stream 필드 > 20 **이고** 위 `STRUCTURAL_MISMATCH`(WS 사다리)에 해당하지 **않는** 경우만(§5.3.2 병합 규칙의 비사다리 분기가 절삭 대신 방치되면 이 코드) | 비사다리형 WS payload | 자동 |
| `FORMATTER_MISSING` | semanticType=unknown이고 override formatter도 없는 필드 비율 > 30%(섹션 기준) | unknown 27% baseline | 자동 |
| `LABEL_MISSING`/`TR_ID_LEAKAGE` | title/필드 라벨이 TR ID 정규식(`^k[at]\d+`)과 매치되거나 title_ko 없음 | ka10007 legacy 9그룹 전부 title_ko 없음 | 자동, zero-tolerance |
| `PRIORITY_FIELD_HIDDEN` | 고빈도 alias(§5.3.1 참고: cur_prc/pred_pre/stk_cd/stk_nm/trde_qty/flu_rt 등)가 비고정 컬럼인데 fold(1560px 캔버스 내 스크롤 없이 보이는 열 범위) 밖으로 밀림 | data-shapes alias 빈도 실측 | 자동 |

`FORMATTER_MISSING`, `LABEL_MISSING`은 정직성 원칙(`ui/DESIGN-SOUL.md:130`)과 직결되므로 fit=0 강제 트리거로 취급한다.

**연속조회 행(row) 축 판단**: 새 실패 코드를 추가하지 않는다. `output-profile.json`의 policy `list_ui_page_size: 10`(3587행)이 이미 페이지당 행 수를 구조적으로 10으로 고정하고, 추가 행은 opaque `cursorToken` continuation(rendering-plan §9.3, main-owned)으로만 로드되므로, 인지 과부하 카테고리2의 행 축은 기존 continuation 계약 준수 여부로 커버된다 — G005 sentinel에 "렌더링된 row 수 ≤ `list_ui_page_size`" 자동 지표를 추가한다(§6.3).

### 2.3 점수 루브릭 + 채점자 일치

| fit | 의미 | 판정 |
|---|---|---|
| 2 | 이질감 없음 | 자동 지표 전부 통과 + 사람 검토(표본인 경우) 이상 없음 |
| 1 | 이질감 있으나 결정적 규칙 또는 reviewed override로 해소됨 | 지표 실패 → 규칙/override 적용 → **재생성 → 재채점**(§2.5) 통과 |
| 0 | 해소 불가, 탈출 필요 | 규칙·override 적용 후에도 실패 지속, 또는 안전/정직성 위반, 또는 자유 캔버스로 보낸 경우(§5.5, 구조적으로 인정된 fit=0) |

**채점 체계**:

| 표본군 | 채점자 수 | 불일치 해소 |
|---|---|---|
| anchor 26개(ka10173 포함) | **2인 이상 독립 채점 필수** | 1차: 두 채점자 재논의. 2차(미해소): 3인째 채점자가 최종 판정, 근거를 scorecard의 `resolution_note`에 기록 |
| stratified 64개(2축 55 + 3축 9) | 최소 1인 | 무작위 20%(≈13개)는 2인 교차채점으로 agreement 재확인 표본에 포함 |

**일치도 지표**: anchor 26 + stratified 교차채점 13 = 39개 판정쌍에 대해 단순 일치율(또는 Cohen's κ)을 scorecard에 기록한다.

**루브릭 신뢰도 게이트**: 일치도 <0.7이면 §2.5 수치 게이트(fit≥1 95%/fit=2 85%/fit=0 5%) 판정 자체를 보류한다.

```
inter_rater_agreement < 0.7
  → 루브릭 불량으로 판단 → §2.1/§2.2/§2.3 재작성 → anchor 재채점
  → agreement ≥ 0.7 확인 후에만 §2.5 수치 게이트 판정 재개
```

**1인 개발 대안**: 2인 확보가 불가능하면 **동일 채점자가 시점 분리 재채점**(intra-rater, 최소 24시간 간격, anchor 26개 중 최소 50%=13개 부분집합)으로 재현성을 확인하고, 이 한계를 `provenance.rater_mode = "intra_rater_fallback"`로 scorecard에 명시 기록한다. **주의**: intra-rater는 "남이 봐도 같은 판정인가"가 아니라 "같은 사람이 24h 뒤에도 일관적인가"만 증명한다 — 편향된 루브릭도 자기일관성은 높을 수 있다. 따라서:
- `provenance.rater_mode`는 §3 G001.5 완료조건 표에 `gate_complete`, `design_medium`과 **나란히 노출되는 별도 필드**다(하나의 boolean 안에 숨기지 않는다).
- **G007 독립 리뷰 완료조건에 "`rater_mode == intra_rater_fallback`이면 anchor 부분집합(≥13개) 독립 재검증 필수"를 추가한다**(§3, §7).
- 어느 경우든 **"1인 1회 채점으로 95% 선언"은 금지**.

**Blind 채점(1줄)**: 가능 — anchor 채점 시트에서 TR ID·화면명 대신 익명 인덱스(A1~A26)로 제시하고 채점 종료 후에만 TR ID를 공개해 "ka10007이니까 당연히 이상함" 같은 라벨링 편향을 줄인다.

### 2.4 표본 설계

- **자동 채점**: **289개 전수**(264 read + 23 websocket + 2 oauth). `kiwoom-output-profile.json` + `response-projections.json` + `kiwoom-tr-inventory.json`에서 결정 가능하므로 표본이 필요 없다. **order 12개는 `ScreenDefinition`은 그대로 생성되지만(§9.6) 이질감 fit 채점 모수에서 제외되며, §9.7의 order 전용 체크리스트 8항목으로 별도 검증한다.**
- **사람 눈 표본**: **anchor 26 + stratified(2축) 55 + stratified(3축) 9 = 총 90개(301의 약 30%)** — 사용자 결정(§8-5)으로 v4 제안 59개에서 상향
  - anchor 26: 최대폭 테이블 5(ka10095/kt00015/ka30005/ka10075/ka10015), 최대 스칼라 4(ka10007/kt00001/ka10004/ka30012), WS 최대폭 5(0D/0F/0B/00/04), WS 최소폭 2(ka10171/ka10174), ka10007 legacy 9그룹, ka10173(WS 이형 envelope 반례) 1
  - stratified 2축(shape×width bucket, 약 20% 표집, cell당 최소 3): 실제 대상 목록 `[측정 필요]`
  - stratified 3축(">12컬럼, <20", anchor 아님, 최소 9개): 컬럼 우선순위 규칙이 발동하지만 anchor로는 안 잡히는 케이스 대응. 실제 대상 목록 `[측정 필요]`

**detail:base 채점 기준**: 인구비(115:186≈38:62) 비례 표집을 쓰지 않는다. **위험가중(risk-weighted)** 표집이다 — detail projection(median 6/p90 15/max 20 필드의 group 분해)은 `STRUCTURAL_MISMATCH`·`LABEL_MISSING` 위험을 구조적으로 더 많이 안고(legacy 9개 전부 detail), anchor에서 의도적으로 과대표집한다. anchor 26개 내 실제 `detail:`/`base:` 접두 비율은 scorecard 생성 시 mapping_id 접두로 자동 집계해 기록 — `[측정 필요]`.

### 2.5 합격선과 분기

| 지표 | 합격선 | 하드/연성 |
|---|---|---|
| inter_rater_agreement | ≥ 0.7 | **하드 — 미달 시 아래 수치게이트 전부 판정 보류**(§2.3) |
| 표본 fit≥1 비율 | ≥ 95% | 하드 |
| 표본 fit=2 비율 | **≥ 85%** | **하드(엄격안 채택 — v4의 70%/연성에서 승격, exit code 1 대상)** |
| 표본 fit=0 비율 | ≤ 5% | 하드 |
| override 개수 | **≤ 40(301의 약 13%)** | 하드 서킷브레이커(§5.4) |
| 규칙 행 수 | ≤ 10(현재 6행) | 하드 서킷브레이커(§5.3.4) |
| **자유 캔버스 개수** | **≤ 8(301의 약 2.7%)** | **하드 서킷브레이커(§5.5)** |
| **예외 총량 = 규칙 행 수 + override 개수 + 자유 캔버스 개수** | 개별 상한 합 = 10+40+8 = **58(이론상 최대)**. WARN ≥ 46(80%), **FAIL > 52**(≈90%) | **하드(§5.3.4/§5.5). 죽은 조건이 아님을 산수로 확인: 규칙9+override38+자유캔버스6=53 → 개별 상한(10/40/8) 중 어느 것도 위반하지 않은 상태에서 FAIL 트리거된다.** |

분기 트리:

```
fit=0 발견
  → 동일 failure_code가 이미 ≥3건 반복?
      Yes → 결정적 규칙 후보로 격상(§5.3.4 규칙 예산 확인 후) → 재생성 → 재채점.
      No  → 진짜 1회성 구조 이상?
          Yes → reviewed override 추가(§5.4, 예산 이내 확인)
              → 적용 후 재생성 → 재채점 필수 → 재채점 기록(`rescored_fit`) 없으면 fit=0 유지
          No  → 자유 캔버스로 탈출(§5.5, 예산 이내 확인) → 사유·대체표현·재검토시점 기록
                → 예산(8) 초과 시 즉시 아키텍처 리뷰 에스컬레이션(옵션 B 재고 트리거와 동급)
예외 총량 > 52
  → 하드 실패(exit 1) + 아키텍처 리뷰. WARN 구간(46~52)일 때만 조기 신호로 취급하고 진행 가능
개별 상한(규칙10 / override40 / 자유캔버스8) 중 하나라도 초과
  → 즉시 하드 실패. 새 결정적 규칙 논의 또는 §5.3 원칙 재검토. 새 캔버스 유형 추가는 최후 수단(§0 옵션 B 재고 트리거)
```

### 2.6 임계값 provisional 보정

G001.5 내 G002 착수 전 게이트: width anchor 5개(ka10095/kt00015/ka30005/ka10075/ka10015)에 대해 **(라벨 글자수 × 평균 자폭 + padding) 픽셀 추정을 1회 계산**해 count 임계값(12/20)이 1560×800 캔버스에서 유효한 proxy인지 확인한다. 컬럼 개수 15개짜리 좁은 숫자 테이블이 8개짜리 넓은 텍스트 테이블보다 실제로는 덜 넘칠 수 있다는 역전 가능성이 있으므로, count 기반 지표는 조악한 proxy임을 인지하고 보정한다. 재보정하지 않고 진행할 경우 그 사실을 `provenance`에 명시적으로 기록한다(침묵 금지).

**(2026-08-18 보정 완료: proxy 부분 유효 — 5개 anchor 전부 방향(오버플로 여부)은 맞으나 정밀도는 부정확. 픽셀 추정 기준 1560px에서 스크롤 없이 보이는 컬럼은 5개 전부 ~13개인데 FAIL 임계값은 20이라, 13~19컬럼 구간 테이블은 실제로 이미 오버플로 중이어도 WARN에만 걸릴 위험이 있다. 이번 5개 anchor는 라벨이 짧아(2~8자) 대부분 데이터 셀 최소폭 90px 바닥값에 걸려 컬럼폭이 114~120px로 균일했고, 그 결과 §2.6이 우려한 역전(좁은 숫자 다수 vs 넓은 텍스트 소수)은 이번 표본에서 관측되지 않았다 — 텍스트형 라벨이 긴 테이블로 추가 검증 필요. 20 하드 블로커로 삼지 않고 WARN 12 유지·FAIL 14~15 하향을 권고안으로 기록. 근거 backend/ref/width-anchor-pixel-calibration.json)**

### 2.7 자동 지표 ↔ 사람 판단 분리

| 자동(기계) | 사람만 가능 |
|---|---|
| 컬럼/필드 수 임계값, 라벨 존재 여부, TR ID 정규식, 포맷터 존재 여부, 숫자 접미사 패턴 탐지, WS FID 사다리 패턴 탐지 | 사다리 페어링이 실제로 "이해가 되는지"의 최종 판단, 한국어 라벨 품질(같은 의미 다른 라벨 75건 중 어디까지 허용할지), 접근성 실사용 대비, 상태 전이 체감, 자유 캔버스로 보낸 대체 표현의 타당성 |

## 3. 단계 계획

G001.5 완료조건을 **세 개의 독립 플래그**로 분리한다(하나의 boolean에 숨기지 않는다 — FIX4).

- **`gate_complete`**: 자동 **289/289** 채점(order 12는 §9.7 체크리스트로 별도 집계) + 사람 표본 90/90 채점 + `inter_rater_agreement`≥0.7 + fit≥1≥95% + **fit=2≥85%** + fit=0≤5% + 규칙≤10 + override≤40 + 자유캔버스≤8 + 예외총량≤52 + **order 12 전용 체크리스트(§9.7) 8/8 통과**. 설계 매체와 무관하게 판정 가능.
- **`design_medium`**: `paper`(실제 Paper 아트보드 완성) | `fallback`(정적 HTML/Markdown).
- **`rater_mode`**: `dual_rater`(2인 이상 독립 채점 정상 완료) | `intra_rater_fallback`(시점 분리 재채점 대안 사용).

| 스토리 | 상태 | 산출물 | 선행조건 | 완료조건(숫자) | 검증 명령 |
|---|---|---|---|---|---|
| 데이터 훑기 · AITS 조사 | **완료**(§1) | — | — | — | — |
| **G001.5 Paper 선행 디자인 · 이질감 게이트** | 대기 | Paper artboard(또는 폴백) 12~15(+≥20), `kiwoom-fit-dissonance-scorecard.json`, `kiwoom-screen-overrides.json`, `kiwoom-free-canvas-registry.json` | Paper MCP 재연결 1회 시도 기록, WS `STRUCTURAL_MISMATCH` 정규식 확정(§2.2), width anchor 5개 픽셀 보정 1회(§2.6) | `gate_complete=true` + `design_medium`·`rater_mode` 필드 존재(값 무관, 단 §8-1 사용자 답변 전 `fallback`으로 자동 진입 금지) | `python backend/scripts/fit_dissonance_check.py --check`(§6.3) |
| G002 Normalized screen contracts | 대기 | 기존(rendering-plan §13 G002) + override/rule/free-canvas 로드 + 반증 fixture(§6.1) + kt00001 섹션별 occurrence 커버리지 | **G001.5 `gate_complete=true`**(`design_medium`은 `fallback`도 허용) | rendering-plan §13 G002 기준 그대로 + 반증 fixture green | rendering-plan §15 backend 명령 |
| G002.5 Selector hardening | **재검증 완료 (2026-08-18)** — `test_selector_core + test_selector_eval` 재실행 = `127 passed, 0 failed`(36.5s). 구 문서의 "76 passed, 22 failed"와 "98 passed" 완료조건은 둘 다 stale — 22건 실패는 split-detail 라우팅 재설계로 **구조에서 제거**됐고(`plan.md` §3, handoff §7-1과 일치), 테스트 수는 127로 늘었다 | 기존과 동일 | — | `pytest tests/unit/test_selector_core.py tests/unit/test_selector_eval.py -q` = `127 passed, 0 failed` | 위 명령 재실행 (2026-08-18 green 확인됨) |
| **G003 Shared Athena canvas 렌더러 구현** | 대기 | facts/table/event_stream/status/action/order_receipt primitive + 상태 shell | **G002 완료 + `design_medium == paper`(하드 게이트, 신설)** — fallback 상태로는 착수 불가 | rendering-plan §13 G003 기준 그대로 | rendering-plan §15 명령 |
| G004 Electron IPC/backend 통합 | 대기, 변경 없음 | preload/contextBridge, IPC allowlist | G003 | rendering-plan §13 G004 기준 그대로 | rendering-plan §15 명령 |
| G005 전수 검증 | 대기 | 301/301 정의 resolution + `data-field-id`/`data-section-id` sentinel(§6.1) + row-count 지표(§2.2) | G004 | rendering-plan §13 G005 기준 + 반증 fixture 유지 + `fit_dissonance_check.py --check` green | 위 + `--check` |
| G006 Paper 최종 동기화 | 대기 — **역할 축소**: `design_medium`이 이미 G003 이전에 `paper`로 전환되어 있으므로, G006은 구현 완료 후 Paper 아트보드의 잔여 상태 variant(loading/empty/error/auth/order-confirm/OAuth)만 보완하는 순수 대조 단계다 | 기존과 동일 | G005 | rendering-plan §13 G006 기준 그대로 | rendering-plan §15 명령 |
| G007 Closeout | 대기 — **완료조건에 §7 Athena 용량 목표 + rater_mode 재검증 추가**(신설) | 기존과 동일 | G006 | rendering-plan §13 G007 기준 + §7 용량 상한 + (`rater_mode==intra_rater_fallback`이면 anchor 부분집합 ≥13개 독립 재검증 완료) | rendering-plan §15 명령 + 위 추가 항목 수동 확인 |

> **2026-08-18 이관 기록 (사용자 결정)**: `fit_dissonance_check.py` 최초 전수 실행이 zero-tolerance 82건을
> 잡았고 **전부 `FORMATTER_MISSING`**(semanticType unknown + override 부재)이다. LABEL_MISSING/TR_ID_LEAKAGE는
> 0건(ka10007 title_ko 해소 확인). 포맷터·오버라이드 정의는 G002(정규화 화면 계약) 소관이므로 **82건 해소를
> G002 착수 조건으로 이관**한다 — G001.5 `gate_complete`의 fit 비율 게이트는 G002의 포맷터 작업 후 재판정한다.
> 근거: `backend/ref/kiwoom-fit-dissonance-scorecard.json`(2026-08-18), 감사 충실성 라운드 회귀 기록.

수량 불변식(186+115=301, 264/23/12/2, exclusion 22) 불변.

**BLOCKER 구조 요약**: 폴백을 쓰더라도 G002(계약/생성)까지는 진행 가능하지만, 실제 화면을 그리는 **G003은 Paper 실동기화 없이 착수할 수 없다.** "정적 HTML 먼저 → 구현 다 하고 → 맨 마지막 G006에서 Paper" 경로를 구조적으로 차단한다. 폴백 경로는 §8 결정1에서 사용자가 명시적으로 선택하기 전에는 자동으로 진입하지 않는다 — Paper MCP 재연결이 실패해도 G001.5는 사용자 응답을 기다리며 대기한다.

---

## 4. Paper 선행 디자인 구체안

### 4.1 순서

```
12(원칙, 텍스트) → 14(캔버스 초안, anchor 이상치 포함 실데이터 목업)
  → 이질감 테스트 실행(§2)
  → 13(데이터 매핑·검증 — 채점 결과·override·자유캔버스 표 기록)
  → 필요시 14 수정(override/규칙 반영)
  → 15(상태·안전 variant)
  → 대표 runtime 캡처 대조는 G006에서
```

### 4.2 아트보드 채우기(≥20개 목표)

| 보드 | 내용 | 상태 variant |
|---|---|---|
| 12 · 공통 API 화면 원칙 | 3캔버스+6프리미티브 다이어그램, raw/display, TR ID 비노출 규칙, 안전 불변식 10개 요약 | 단일 |
| 14.1 Adaptive Record Canvas — facts | 소규모 스칼라 사례 | ready |
| 14.2 Adaptive Record Canvas — table | 중앙값 사례(~11열) + overflow anchor(ka10095, 63열 컬럼 우선순위 적용) | ready |
| 14.3 Adaptive Record Canvas — mixed/dense | ka10007 124스칼라를 밀도 분할 규칙(§5.3)으로 해소, 사다리 페어링 table로 병합된 결과 | ready |
| 14.4 Live Stream Canvas | ka10171/ka10174(협소) + 0D(167필드, 사다리 판정 규칙으로 레벨=행 table 병합) | connecting/open/reconnecting/dropped |
| 14.5 Schema-driven Request Sheet | 조회 입력, OAuth lifecycle (**주문은 여기서 제거 — §9로 이관**) | auth_required/authorizing/ready/expired |
| **16 · 주문 팝업(신설)** | 3개 구조 템플릿(신규/정정/취소), 창 계약·광량 위계 4단계 | draft/review/confirm/committed/receipt + 거부/타임아웃/in_doubt |
| 13 · 데이터 매핑·검증 | anchor 26 + stratified 64 채점 요약, failure_code별 건수, override/규칙/자유캔버스 표. 13판에서 "REST 사다리(ka10007)와 WS 사다리(0D)가 동일 원칙으로 처리됨"을 명시적으로 대조 | 단일 |
| 15 · 상태·안전 | table-loading, facts-empty, stream-error, sheet-auth_required, sheet-action_required, WS dropped | 6개 상태 조합 |

총 20~24개 아트보드로 3캔버스×핵심상태 교차와 anchor 이상치를 모두 커버한다. 301×7 전체 매트릭스는 만들지 않는다.

### 4.3 Paper MCP 폴백 경로

**2026-08-16 재연결 시도 결과(실측)**: Paper Desktop MCP 서버는 **살아 있다** — `POST http://127.0.0.1:29979/mcp`로 `initialize` 성공, `serverInfo = {name: "paper-desktop", version: "0.5.4"}`, `tools/list` 34개 반환(`create_artboard`, `write_html`, `create_file`, `get_screenshot`, `get_guide`, `finish_working_on_nodes`, `get_tokens`/`create_tokens`/`set_tokens` 등). 그러나 **Claude Code 세션의 MCP 클라이언트가 이 서버에 붙어 있지 않아 네이티브 도구로는 호출할 수 없다** — 세션 시작 시점에 연결이 실패한 것으로 보이며 `/mcp` 재연결 또는 세션 재시작이 필요하다. (GET 404는 서버가 GET을 지원하지 않기 때문이고 장애 신호가 아니다.) 즉 `design_medium = paper` 경로는 **폴백 없이 사용 가능**하며, 남은 것은 클라이언트 연결뿐이다.

- **선결 조건**: G001.5 착수 시 Paper MCP 재연결 결과를 `kiwoom-screen-overrides.json`의 metadata에 기록한다. 현재 기록값: 서버 up(0.5.4, 34 tools), 세션 클라이언트 미연결 — `/mcp` 재연결 필요.
- **Paper 작업 착수 전 필수**: `get_guide`를 먼저 호출한다(서버 instructions가 다른 도구보다 선행 호출을 요구). 기존 파일은 `Athena — 화면설계서`(`app.paper.design/file/01M002A3JJ5SNHH8Z5AVB9KSQQ/1-0`), 아트보드 골격 12~15번을 이어서 채운다.
- **폴백**: 실패 시 `plan/kiwoom-common-screen-artboard-spec.md`(아트보드별 레이아웃 설명 + 필드 바인딩 + 상태 설명, Markdown) + `ui/prototype/`(기존 `app/styles/tokens.css`, `access.css` 재사용, 새 프레임워크 없이 정적 HTML, §4.2 아트보드와 1:1 대응)로 동일한 사람 검토를 수행한다.
- 폴백을 사용한 경우 `design_medium=fallback`으로 명시 기록하고, **G002까지만 진행 가능, G003 착수 전 Paper 실동기화(`design_medium=paper`로 전환)가 하드 선행조건**이다(§3). 이 전환 작업은 **G002.75 `Paper 실동기화`**라는 별도 체크포인트로 명명해 오너·완료조건(아트보드 ≥20, `design_medium=paper` 기록)을 갖게 한다 — G001.5가 이미 완료 처리된 뒤 소속 불명 작업으로 떠다니지 않도록 한다.
- 폴백 진입 자체가 §8 결정1에서 사용자의 명시적 선택 없이 자동으로 일어나지 않는다.

---

## 5. 템플릿 ↔ API 매핑 규칙

### 5.1 캔버스 선택(외곽, 결정적)

```
kind == order      → ScreenDefinition은 그대로 생성(mode='order', 안전 플래그 유지).
                     단 런타임 dispatch는 공통 캔버스가 아니라 **Order Popup Window**(별도 3번째 창) — §9
kind == oauth      → Schema-driven Request Sheet (guarded lifecycle)   ← 불변, 팝업 대상 아님(§9.6)
kind == websocket  → Live Stream Canvas
kind == query      → Adaptive Record Canvas
```

**신규 — 런타임 dispatch 규칙**(`backend/athena_api/screens/resolver.py`, rendering-plan §9.1 `resolver.py` = "selector 결과를 screenId로 연결"):

```
resolve(question, context) → { screenId, dispatch }
  dispatch == 'canvas'  (query / websocket / oauth 289개) → 기존 athena:screen:* IPC 경로
  dispatch == 'popup'   (order 12개만)                     → createOrderPopup(screenId, draftInput), §9.3.0 데이터플로우
```

생성 레이어는 갈라지지 않는다 — G002는 **여전히 301개 definition을 전부 생성**하고 category 264/23/12/2도 그대로다. 팝업은 런타임 dispatch에서만 갈라진다.

### 5.2 섹션 구성(내곽) 우선순위

```
1. response-projections.json 명시 layout
2. 검토된 최소 override
3. manifest presentation.layout
4. shape 기반 fallback (scalar_only→facts, pure_list→table, compound→facts+table, WS→status+event_stream, order→action+status+order_receipt **— 이 조합은 유효하되 Schema-driven Request Sheet가 아니라 팝업 내부 화면 구성 규칙으로 재배치, §9.6**, oauth→status+action)
5. 결정 불가 → generation failure
```

### 5.3 밀도·구조 결정적 규칙 (현재 **6행 / 상한 10행**, §5.3.4)

이 규칙들은 override로 세지 않는다. 조건이 맞으면 항상 적용되는 생성 로직이다.

| # | 규칙 | 조건 | 동작 |
|---|---|---|---|
| 1 | facts 분할 | facts 필드 > 12 | 선언 순서 기준 ≤10개씩 하위 그룹, 접힘/펼침 |
| 2 | table 컬럼 우선순위 | 컬럼 > 12 | §5.3.1 |
| 3 | **event_stream 사다리 판정**(병합) | event_stream 필드 > 20 | §5.3.2 — 사다리형이면 레벨=행 table 병합, 비사다리형이면 top-N+expandable 절삭 |
| 4 | 라벨 결손 fallback | title_ko 없음, override 없음 | 구조적 라벨(snake_case→띄어쓰기) + `diagnostics.fallbackApplied=true`. TR ID 정규식 매치 시 generation failure |
| 5 | 포맷터 결손 | semanticType=unknown, override 없음 | 원문 문자열 + 라벨 있으면 표시 허용, 라벨도 없으면 `LABEL_MISSING`과 중복돼 fit=0 강제 |
| 6 | 연속조회 페이지네이션 | table 섹션이 continuation 대상(잠재 pure_list 111개) | §5.3.3 |

*이전 초안에서 "event_stream 사다리 병합"과 "event_stream 필드 절삭"을 별도 행으로 뒀으나, 후자가 "전자의 조건에 해당하지 않는 경우"로만 정의되어 사실상 else 분기였다 — 하나의 규칙(#3)으로 병합해 규칙 슬롯을 절약했다.*

#### 5.3.1 table 컬럼 우선순위 상세

(a) **식별 컬럼 판정**: semanticType ∈ {종목코드, 종목명, 계좌번호, 주문번호} 우선 고정. 해당 없으면 첫 선언 필드를 식별 컬럼으로 간주. 복수 고정 허용(예: stk_cd + stk_nm 동시 고정).

(b) **비고정 컬럼 노출 순서 tie-break**: 실측 alias 빈도 상위 우선 배치 — `cur_prc 89, pred_pre 85, stk_cd 83, stk_nm 80, trde_qty 63, flu_rt 61` 순으로 fold 안쪽 배치, 이후 선언 순서. 선언 순서를 그대로 tie-break로 쓰지 않는다.

(c) 자동 지표 `PRIORITY_FIELD_HIDDEN`(§2.2)으로 고빈도 alias가 fold 밖으로 밀리는 사례를 자동 채점.

#### 5.3.2 event_stream 사다리 판정 상세 — 0D 예시

0D(170 leaf/167폭, 10레벨 × {가격,잔량,증감} × {매수,매도})는 구 규칙(top-N+expandable 전용)에서 REST 사다리(ka10007)와 상반된 처리를 받아 구조가 파괴됐다 — REST 스냅샷은 비싼 쪽(구조 보존)을, 정작 실시간으로 10호가 전체가 한눈에 보여야 트레이딩 판단이 되는 WS 호가창(0D)은 싼 쪽(절삭)을 받는 것은 **트랜스포트가 다르다는 이유로 우선순위가 뒤바뀐 것**이었다.

**판정 규칙**: event_stream 필드 수 > 20인 WS payload에 대해, 필드가 (레벨×역할) 반복 구조로 분해 가능한지(§2.2 `STRUCTURAL_MISMATCH` WS 확장 조건) 먼저 판정한다.
- **사다리형(0D/0F/0B 등)**: 레벨(1~10)을 행으로, {매수가격, 매수잔량, 매수증감, 매도가격, 매도잔량, 매도증감} 등을 열로 하는 **실시간 갱신 table 1개로 병합**(구조 보존). REST 사다리 페어링(ka10007)과 동일 원칙 — 트랜스포트가 다르다는 이유로 구조 보존 여부가 갈리지 않는다.
- **비사다리형**: 상위 N개 primary 필드 + 나머지 expandable로 절삭(fallback).

#### 5.3.3 연속조회 페이지네이션 상세

- page size는 `backend/ref/kiwoom-output-profile.json`의 policy `list_ui_page_size: 10`(3587행)을 그대로 인용해 고정한다. 신규 값을 만들지 않는다.
- 추가 행은 opaque `cursorToken` continuation으로만 로드한다. renderer는 `cont_yn`/`next_key`를 알지 못한다(rendering-plan §9.3 그대로 — cursor는 main-owned opaque token이라는 기존 계약과 충돌 없음, `ka10172` condition continuation만 body 기반 예외인 것도 동일).
- 인지 과부하 카테고리2의 행(row) 축에 대한 신규 실패 코드는 만들지 않는다(§2.2) — page size 고정으로 구조적으로 통제되기 때문. G005 sentinel에 "렌더링된 row 수 ≤ page size" 자동 지표를 추가해 이 가정이 실제로 지켜지는지 검증한다.

#### 5.3.4 규칙 예산

**규칙 행 수 상한 = 10.** 현재 6행. 초과 시 `fit_dissonance_check.py --check` 실패(exit 1) + 아키텍처 리뷰 에스컬레이션 — override 예산(§5.4)·자유 캔버스 예산(§5.5)과 동일한 강도의 하드 게이트.

**규칙 1개를 세는 기준**: 동일 판정 로직을 공유하거나 한쪽이 다른 쪽의 else 분기이면 **1개로 카운트**한다(#3 사다리 판정이 이 경우). 서로 다른 조건식에서 출발해 서로 다른 섹션 종류를 만들면 별개 규칙이다. 이 기준 없이 병합을 반복하면 규칙 예산(≤10)이 명목상으로만 지켜지고 실제 분기 수가 계속 늘어나는 우회로가 된다.

**규칙 1개당 요구 증거(신규 규칙 추가 시 필수)**:

| 요구 항목 | 기준 |
|---|---|
| 적용 mapping 수 | ≥ 3(1케이스 과적합 금지) |
| 정상 통과 반례 fixture | ≥ 3(규칙이 없어도 정상인 케이스가 규칙 때문에 깨지지 않음을 증명) |
| 미적용 시 발생하는 failure_code | 명시 필수 |

현재 6개 규칙의 증거 상태:

| # | 규칙 | 적용 사례(≥3) | 반례 fixture(≥3) | 미적용 시 코드 |
|---|---|---|---|---|
| 1 | facts 분할 | ka10007/kt00001/ka10004/ka30012(4) ✓ | `[측정 필요]` | FACTS_DENSITY_EXCEEDED |
| 2 | table 컬럼 우선순위 | ka10095/kt00015/ka30005/ka10075/ka10015(5) ✓ | `[측정 필요]` | OVERFLOW_WIDTH, PRIORITY_FIELD_HIDDEN |
| 3 | event_stream 사다리 판정 | 사다리형 0D/0F/0B(3) ∪ 비사다리형 20필드초과 WS(`[측정 필요]`) — **사다리형만으로 ≥3 충족 ✓**(두 분기가 하나의 규칙이므로 합집합으로 요건 충족) | 비사다리형 ka10171/ka10174(2) + `[측정 필요]` 1건 | `STRUCTURAL_MISMATCH`(사다리형 오분류 시), `STREAM_FIELD_EXCEEDED`(비사다리형 미절삭 시) |
| 4 | 라벨 결손 fallback | ka10007 legacy 9(≥3) ✓ | 정상 title_ko 보유 다수(예: ka10001)(≥3) ✓ | LABEL_MISSING/TR_ID_LEAKAGE |
| 5 | 포맷터 결손 | unknown 27%(전체 규모상 ≥3 자명) ✓ | 기지 semanticType 다수 ✓ | FORMATTER_MISSING |
| 6 | 연속조회 페이지네이션 | pure_list 111 잠재 대상(자명) ✓ | 소량 리스트(≥3, `[측정 필요]`) | (§2.2 판단상 신규 코드 없음) |

**예외 총량**: `exception_total = rule_row_count + override_count + free_canvas_count`. 개별 상한 합 = 10+40+8 = 58(이론상 최대). **WARN ≥ 46**(80%), **FAIL > 52**(≈90%). 개별 상한 안에 있어도 합산이 WARN 구간에 들면 규칙·override·자유캔버스 사이에서 풍선효과가 발생 중이라는 조기 신호로 취급하고 아키텍처 리뷰를 트리거한다(WARN은 하드 실패 아님, FAIL은 exit 1).

### 5.4 예외 처리 · override 예산

`backend/ref/kiwoom-screen-overrides.json`에 기록. 필수 필드: `mapping_id`, `failure_code`, `rule_attempted`, `resolution`, `reviewer`, `date`, `rescored_fit`.

**override 예산 40(301의 약 13%)은 품질 목표가 아니라 서킷브레이커다.** 초과 시 즉시 아키텍처 리뷰 에스컬레이션. (사용자 결정 §8-3 엄격안 — v4 제안 60에서 하향.)

**게임 방지 CI 체크**:
1. `rule_attempted`가 비어 있거나 §5.3 규칙 목록에 없는 임의 문자열이면 해당 entry는 자동으로 **fit=0 강제**, override 예산 카운트에서도 "해결됨"으로 인정하지 않는다.
2. `rescored_fit` 필드가 없거나 재생성 이후 값이 채워지지 않았으면 해당 entry도 **fit=0으로 유지**, "해결됨"으로 인정하지 않는다(재채점 누락 방지).

근거: AITS의 근본 원인(감사 도구의 측정 단위가 엔지니어링 선택을 강제)과 동일한 함정이 반대 방향(예산 안에 맞추려고 override를 "규칙 매치"로 재분류하거나, 재채점 없이 "해결됨"으로 자칭)으로 재발하지 않도록 구조적으로 차단한다.

### 5.5 자유 캔버스 예산과 기록 (신설)

탈출 순서의 마지막 단계인 "자유 캔버스"에도 예산을 건다 — 규칙·override 예산을 다 쓴 fit=0 잔여가 전부 자유 캔버스로 새면, 옵션 B(4번째 캔버스)를 TR 단위로 몰래 재도입하는 것과 동형이고 비목표("301개 전용 화면 재도입")를 위반하기 때문이다.

**`free_canvas_count` 상한 = 8**(301의 약 2.7%, 사용자 결정 §8-3 엄격안 — v4 제안 15에서 하향). 근거: `canvas-taxonomy.md`가 스스로 던진 미해결 질문("자유 캔버스가 얼마나 자주 열려야 정상인가. 자주 열린다면 캔버스 체계가 틀린 것이다")에 구체적 숫자를 부여한 것 — 301개 중 3% 이내면 진짜 예외, 그 이상이면 템플릿 체계 실패 신호로 본다.

**기록 스키마**(`backend/ref/kiwoom-free-canvas-registry.json`):

```json
{
  "mapping_id": "...",
  "reason": "규칙 §5.3 #N, override 시도 후에도 fit=0 지속된 사유",
  "rules_and_overrides_attempted": ["rule:table_column_priority", "override:2026-..."],
  "fallback_representation": "facts | table | facts+table (shape 기본값, 미세조정 없음)",
  "fit_score": 0,
  "review_trigger": "실사용 빈도 확보 시 | 다음 계획 개정 시",
  "invalid_escape": false
}
```

`rules_and_overrides_attempted`가 비어 있으면(즉 규칙/override 시도 없이 바로 자유 캔버스로 보낸 경우) `invalid_escape=true`로 표시하고 G007 리뷰에서 별도 검토 대상으로 남긴다 — 이미 fit=0으로 채점되므로 추가 페널티는 없지만, "정당한 예외"와 "게으른 회피"를 구분해 기록한다.

**CI 체크**: `free_canvas_count > 8` → `fit_dissonance_check.py --check` 실패(exit 1) + 아키텍처 리뷰 에스컬레이션(옵션 B 재고 트리거와 동급 — 즉 이 시점에서 "3+6 유지"라는 §0 옵션 A의 전제 자체를 재검토한다).

---

## 6. 구현 계획 (경로: `C:\Users\ajc22\orca\workspaces\DAOU.Athena\Call` 기준, 새 프레임워크 도입 금지, 301개 개별 파일 생성 금지)

### 6.1 G005 field sentinel 계약

측정 단위를 다음 순서로 명시한다(AITS의 "파일 단위 측정이 아키텍처를 강제"한 함정 재발 방지, §0 원칙 6).

1. **1차 단위 = ScreenDocument 계약**: 필드 커버리지는 먼저 contract 레이어(ScreenDefinition→ScreenDocument 매핑)에서 증명한다 — G002 완료조건("모든 노출 필드가 문서화된 목적지로 매핑")이 이미 수행, 재사용.
2. **2차 단위 = fixture-rendered DOM, selector는 canonical `data-field-id`/`data-section-id`**. 파일별 고유 selector·정적 텍스트 매칭 금지. 공유 table 컴포넌트가 TR A/B 데이터를 각각 렌더링해도 `[data-field-id="cur_prc"]` 쿼리는 동일하게 작동해야 한다.
3. **반증 fixture(G002 테스트 요구사항)**: 동일 컴포넌트 패턴을 공유하는 TR 2개 이상(ka20006/07/08/19, 폭7 컬럼셋 공유)이 특수분기 없이 동시 통과함을 증명하는 fixture를 추가한다.
4. **occurrence 단위 커버리지**: kt00001의 `pymn_alow_amt`처럼 동일 필드가 top-level scalar이자 list column으로 동시 존재하는 경우, sentinel은 "필드 X가 DOM 어딘가에 있다"가 아니라 **섹션별 occurrence**로 체크한다(facts의 `pymn_alow_amt`와 table의 `pymn_alow_amt`를 각각 별도 증명).

### 6.2 Electron 보안 전환

최종 설정: `nodeIntegration:false`, `contextIsolation:true`, 가능하면 `sandbox:true`. 현재 `app/main.js`는 `nodeIntegration:true, contextIsolation:false`이고 `app/canvas.js`는 `require('electron')`을 직접 사용 중이다(재확인, 미변경). `chat.js`/`canvas.js`의 직접 `ipcRenderer` 사용을 preload/contextBridge 경계로 대체한다.

권장 파일:

```
backend/athena_api/screens/{models,registry,resolver,normalizer,service,formatters,overrides,errors}.py  — overrides.py는 kiwoom-screen-overrides.json + kiwoom-free-canvas-registry.json을 로드
backend/scripts/generate_api.py  — 위 두 파일 + fit_dissonance_check.py를 입력에 추가
backend/ref/kiwoom-screen-definitions.json, backend/athena_api/generated/registry.py
app/screens/{screen-shell,screen-state,section-renderer,facts-section,table-section,event-stream-section,status-section,action-section,order-receipt-section,format-cell,screen-errors}.js
```

### 6.3 `fit_dissonance_check.py` I/O 계약

**입력 파일**:

```
backend/ref/kiwoom-output-profile.json          (필드/컬럼 개수, shape)
backend/ref/response-projections.json           (detail group layout)
backend/ref/kiwoom-tr-inventory.json            (라벨/semanticType/alias 빈도)
backend/ref/kiwoom-common-screen-manifest.json  (301개 매핑 identity)
backend/ref/kiwoom-screen-definitions.json      (G002 산출물, 있으면 사용 — 없으면 자동채점은 output-profile 기반 provisional 모드로만 수행)
backend/ref/kiwoom-fit-dissonance-scorecard.json (사람 채점 결과, 있으면 병합)
backend/ref/kiwoom-screen-overrides.json        (override 목록, rescored_fit 포함)
backend/ref/kiwoom-free-canvas-registry.json    (자유 캔버스 목록)
backend/ref/kiwoom-order-popup-checklist.json   (order 12 전용 체크리스트 8항목 결과, 신설 — §9.7)
```

**출력 스키마(요지)**:

```json
{
  "generated_at": "...",
  "mappings": [
    {
      "mapping_id": "...",
      "auto_failure_codes": ["OVERFLOW_WIDTH"],
      "auto_fit": 1,
      "human_fit": 1,
      "human_raters": ["r1", "r2"],
      "agreement": "match",
      "rules_applied": ["table_column_priority"],
      "override_id": null,
      "rescored_fit": null,
      "free_canvas_id": null
    },
    {
      "mapping_id": "base:kt10000",
      "kind": "order",
      "auto_fit": null,
      "excluded_from_auto_score": "order_popup",
      "popup_checklist": {"field_whitelist": "pass", "no_tr_id_leak": "pass", "...": "..."},
      "human_fit": null,
      "rescored_fit": null,
      "free_canvas_id": null
    }
  ],
  "aggregate": {
    "auto_scored": 289,
    "order_popup_checklist_scored": 12,
    "human_sample_scored": 90,
    "inter_rater_agreement": 0.0,
    "fit2_ratio": 0.0,
    "fit_ge1_ratio": 0.0,
    "fit0_ratio": 0.0,
    "rule_row_count": 6,
    "override_count": 0,
    "free_canvas_count": 0,
    "exception_total": 6
  }
}
```

**exit code 규칙**:

| code | 의미 |
|---|---|
| 0 | 통과 — 모든 하드 게이트 충족 |
| 1 | 서킷브레이커 위반(override>40, 규칙>10, 자유캔버스>8, 예외총량>52, fit0비율>5%, fit≥1비율<95%, **fit2비율<85%**, **order 체크리스트 8항목 중 1건이라도 fail**) |
| 2 | 입력 stale/누락(필수 파일 없음 또는 manifest 버전 불일치) |
| 3 | 루브릭 신뢰도 미달(`inter_rater_agreement<0.7`) — 서킷브레이커 위반과 구분, 처방이 다르다(override/규칙 추가가 아니라 루브릭 재작성, §2.3) |

**`--check`가 하드 실패로 취급하는 지표**: `fit≥1 비율`, **`fit=2 비율`(엄격안 채택으로 하드 승격)**, `fit=0 비율`, `예외총량`(규칙+override+자유캔버스 3항 및 개별 상한), `inter_rater_agreement`. 연성 지표는 남아 있지 않다 — 모든 집계 지표가 exit 1 대상이다.

---

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| Paper MCP 재연결 실패 지속 | 폴백 고착 | §4.3 폴백 + G003 착수 전 Paper 실동기화 하드 게이트(§3) |
| 사람 표본(90개)이 실제 실패를 놓침 | 구현 후 발견 | anchor 26개(ka10173 포함) + 3축 stratified 9개 포함 64개 층화, G005에서 fit 지표 회귀 유지 |
| §5.3 규칙이 TR-shape별 분기로 변질(invariant 6 위반 방향) | 301개 유지보수 폭발 재발 | §5.3.4 규칙 예산(≤10) 하드 게이트, 규칙 추가마다 반례 fixture 요구 |
| override 예산 게임(진짜 override를 규칙 매치로 재분류) | AITS와 동일 패턴이 반대 방향으로 재발 | §5.4 CI 체크(`rule_attempted`/`rescored_fit` 누락 시 fit=0 강제) |
| **자유 캔버스가 무예산으로 방치(신설)** | 옵션 B(4번째 캔버스)를 TR 단위로 몰래 재도입하는 것과 동형, 비목표 위반 | §5.5 `free_canvas_count`≤15 하드 게이트 + 기록 스키마(사유·대체표현·재검토시점 필수) |
| 임계값(12/20) 미보정 상태로 진행 | count가 실제 픽셀 폭의 조악한 proxy 상태로 완료 선언될 위험 | §2.6 1회 픽셀 보정, 미보정 시 provenance 명시 의무화 |
| 채점자 1인 판단을 계약처럼 취급 | 95%가 재현 불가능한 상태로 완료 선언 | §2.3 2인 채점+3인 타이브레이크, intra-rater 대안 시 provenance 명시 + G007 재검증 |
| AITS식 감사·생성 메타툴링 비대(실측) | 메타툴링 31,807 LOC > 감사대상 UI 30,031 LOC, `docs/` 22MB, fixture 6.4MB, 동일 결함이 issue 3건(#214/#215/#216)으로 분열 | §6.1 sentinel을 계약/occurrence 단위로 설계, §7 Athena 용량 목표(아래)로 역전 자체를 불변식으로 금지 |
| WS 확장 규칙(정규식·임계값)이 0D/0F/0B 실측 전까지 미확정 | G001.5 착수 지연 또는 잘못된 기본값으로 시작 | §2.2/§2.4 선행조건으로 고정, ka10173을 반례 anchor로 조기 검증 |

### Athena 자체 용량 목표(제안값 — §8 결정4)

| 지표 | 상한(제안값) | 근거 |
|---|---|---|
| `backend/athena_api/screens/*.py` + `app/screens/*.js` + `app/order-*.js` + `app/styles/order-popup.css` 총 LOC | ≤ 6,000(팝업 포함 재산정) | 6 primitive + shell/state/dispatcher/format/errors(11파일) + backend registry/normalizer/service 규모 추정. AITS 감사대상 30,031 LOC(155파일, TR별 전용)와 자릿수로 구분 — 추정치, `[측정 필요]`(구현 후 실측 대조) |
| `app/screens/*.js` 파일 수 | ≤ 15 | 현재 11개 열거(§6.2). 소폭 분할 여유만 허용 — 301개도 64개도 아닌 "primitive 수 근방" 유지 |
| `kiwoom-screen-overrides.json` + `kiwoom-free-canvas-registry.json` 합계 파일 크기 | ≤ 200KB | entry ≤40+8 × 평균 상세 레코드(사유/해결 텍스트 포함) 추정. 예산 하향(§8-3 엄격안)에 맞춰 300KB에서 조정 |
| **검증 스크립트 LOC ≤ 검증 대상 UI LOC(불변식)** | `fit_dissonance_check.py` + G005 sentinel 테스트 + order-popup 정적 스캔(§9.9) + `generate_api.py`의 screen 관련 부분 합계 ≤ `app/screens/*.js` + `app/order-*.js` 합계 | **AITS의 역전(감사·생성 메타툴링 31,807 LOC > 감사대상 UI 30,031 LOC) 금지를 명시적 불변식으로 고정.** G007 완료조건에 실측 비교 항목으로 포함 |

## 비목표

- 301개 전용 화면/컴포넌트 재도입
- `canvas-taxonomy.md` 12종 재도입
- 새 frontend framework 도입
- Paper 전체 상태 매트릭스(301×7) 제작
- live order를 이용한 QA
- TR ID 노출을 "정직성"으로 재정당화
- **캔버스 모자이크 동시성(3개 이상 캔버스 동시 표시 시 광량 위계·갱신 신선도 문제) — `ui/round-1R/two-windows.md`의 별도 트랙으로 남긴다(§2.0)**
- **주문(order 12개)을 공통 캔버스 안에서 렌더링하는 것 — §9에서 별도 팝업 창으로 분리했다. 팝업은 6프리미티브의 두 번째 구현이 아니라 두 번째 호스트 창이며, 새 primitive를 만들지 않는다(§9.6)**
- **OAuth 2개를 팝업으로 분리하는 것 — 기계 간 토큰 갱신이지 자금 이동 확정이 아니므로 Schema-driven Request Sheet에 남긴다(§9.6)**

## ADR

- **Decision**: G001과 G002 사이에 G001.5(Paper 선행 디자인 + 2단계 이질감 게이트)를 신설하고, 규칙·override·자유 캔버스 3단 예산 체계를 §5.3.4/§5.4/§5.5에 건다.
- **Drivers**: 사용자 요구 순서(Paper 먼저), 301개 전수 사람 검토 불가능, 기존 계약 재설계 금지, 검증 도구가 아키텍처를 강제하지 않아야 함(AITS 근본 원인).
- **Alternatives considered**: (a) Paper를 G006에만 유지 — 사용자 요청 순서 위반으로 기각. (b) 기계 지표만으로 게이트 — 시각적 실패를 못 잡아 기각. (c) 사람 눈 전수 검토 — 비용 폭발로 기각. (d) override만 예산화하고 규칙·자유캔버스는 연성 약속으로 남김 — architect 2차 리뷰가 지적한 대로, 같은 형태의 위험을 이름만 다르게 비대칭 처리하는 것이므로 기각.
- **Why chosen**: 기존 3캔버스+6프리미티브·G002~G007 산출물을 그대로 둔 채 삽입 가능한 최소 지점이며, 탈출 경로 3단계 전부가 동일 강도의 게이트를 갖도록 대칭성을 확보한다.
- **Consequences**: G002 착수가 G001.5 `gate_complete`(+WS 정규식 확정+픽셀 보정)에 의존. G003 착수가 `design_medium==paper`에 추가로 의존해 Paper 작업이 렌더러 구현 일정의 critical path에 들어간다(의도된 트레이드오프). generator 입력에 override/free-canvas json 2종이 추가. G002 테스트 요구사항에 반증 fixture와 occurrence 커버리지가 추가되어 초기 구현 범위가 소폭 증가.

---

## 8. 결정 기록

2026-08-16 사용자 확정(1·2·3·5). 결정 4만 미정.

| # | 결정 | 확정 내용 | 반영 위치 |
|---|---|---|---|
| 1 | Paper 재연결 방식 | **이번 세션에서 MCP 재연결 시도**. 실패 시 폴백으로 자동 진입하지 않고 사용자에게 재확인한다 | §4.3, §3 |
| 2 | 템플릿 구성 | **3캔버스 + 6프리미티브 유지**(옵션 A). 4번째 캔버스는 §5.5 자유캔버스 예산 초과 시에만 재검토 | §0(a), §5.1~5.3 |
| 3 | 이질감 합격선·예산 | **엄격안 채택** — fit=2 ≥85%를 연성에서 **하드로 승격**, override ≤60→**40**, 자유캔버스 ≤15→**8**, 예외총량 FAIL >76→**52**(최대 58). 규칙 상한 ≤10과 fit≥1 ≥95%, fit=0 ≤5%, agreement ≥0.7은 유지 | §2.5, §5.3.4, §5.4, §5.5, §6.3 |
| 5 | 사람 검토 표본 | **90개(약 30%)** — anchor 26 + 층화 64(2축 55 + 3축 9). 교차채점 표본도 7→13개로 증가, 일치도 판정쌍 39개 | §2.3, §2.4 |

### 미정 — 결정 4. Athena 용량 목표

§7 표의 상한(총 LOC ≤6,000 / `app/screens/*.js` 파일 ≤15 / override+free-canvas json ≤200KB / **검증 스크립트 LOC ≤ 검증 대상 UI LOC 불변식**)은 아직 제안값이다. 선택지: (a) 그대로 채택 (b) 수치 조정 (c) G007에서 실측 후 사후 확정. **불변식(검증 ≤ UI)만은 (c)를 택하더라도 유지한다** — AITS의 역전(31,807 > 30,031)이 이 계획의 근거 증거이기 때문이다.

---

---

## 9. 주문 팝업 창 (Order Popup) — 공통 캔버스에서 분리, 단일 인스턴스로 안전 격리

> **⚠ 폐기 고지 (2026-08-18 삽입)** — 이 절이 설계한 **독립 팝업 창(3번째 창)은 폐기가 정본이다.**
> 2026-08-17 AITS 커버리지 감사 §9 결정 ①이 주문 확인을 **대화 창 모드 단독**으로 확정했다
> (ActionCard는 표시 전용으로 축소). "창은 둘뿐" 원칙은 5개 문서가 일치한다 — `GLOSSARY.md`
> §1·§12("팝업창"은 폐기어), `CLAUDE.md` §2, `plan.md` 병합 판단 1·3, `plan/AGENTS.md` 문서 표,
> `window-api-manual.md` 머리 고지. 아래 본문은 **사료로 보존**한다 — 주문 확인 *모드*를 구현할
> 때 안전 격리 요구사항(확인 게이트 · 멱등성 · confirm 중 강제종료 차단)은 여전히 유효한
> 참고자료이고, `ScreenDefinition` 생성 유지(§9.6)도 그대로 유효하다.

> 반영 지시: "셀렉터에서 order가 있는 건 맞다. 다만 주문 관련 화면은 팝업으로 별도 화면을 만들어라." 12개 order TR(kt10000/1/2/3/6/7/8/9, kt50000/1/2/3)을 공통 캔버스(Adaptive Record Canvas / Live Stream Canvas / Schema-driven Request Sheet) 렌더링 **경로**에서 빼고, 독립 팝업 창(3번째 창)으로 분리한다. **`ScreenDefinition` 생성 자체는 빼지 않는다 — §9.6 참조.**
> 개정 이력: v1(초안) → **v2(safety/design/contract 3렌즈 병렬 검토, BLOCKER 9건 + MAJOR 9건 반영 — 자격증명 데이터플로우 신설, 싱글턴 가드 신설, confirm 중 강제종료 차단, 유리두께 배후-밀도 규칙으로 정정, 규범 문서 4종 동시 개정으로 선결조건 재배치, ScreenDocument.state 매핑 명시, primitive 모듈 재사용 강제, 301/289 리터럴 치환문 제공, resolver.py 인용 정정)**. 이 문서는 v2이며 이전 버전을 대체한다.

### 9.1 결정과 근거

| 근거 축 | 내용 |
|---|---|
| **사용자 지시** | 원문 그대로 채택 — 재해석 없이 12개 order TR 전부를 팝업으로 |
| **안전상 이점 1 — 표면 분리** | 읽기 전용 264+23+2=289개(공통 캔버스)와 부수효과가 있는 12개(팝업)를 물리적으로 다른 창·다른 preload·다른 IPC 채널로 분리하면, 조회 화면 리렌더링·리프레시가 주문 제출 코드 경로에 물리적으로 닿을 수 없다. AITS의 `src/preload/order-preload.ts`(구 초안의 `order-preload.cjs` 표기는 오기 — 정정)가 `its.order.respond/onCard/ready` 3개 채널만 노출하고 공유 preload에는 주문 채널이 아예 없는 구조(§9.8에서 그대로 계승)가 이 이점의 근거다. |
| **안전상 이점 2 — 오발주 방지** | 팝업이 캔버스와 같은 문서 스트림 안에 있으면 "조회 화면 자동 새로고침 → DOM 재구성 → 이전 draft가 다시 그려짐" 같은 경로가 이론상 존재한다. 별도 창·별도 렌더러 프로세스 컨텍스트는 이 경로 자체를 구조적으로 없앤다. |
| **기존 안전 불변식과의 정합** | "화면 open/refresh/retry가 주문을 실행하면 안 된다"(`plan/kiwoom-common-screen-brief.md:18`, `plan/kiwoom-optimal-screen-selection-rendering-plan.md:693`)를 캔버스 재생성 로직과 완전히 분리된 창에서 강제하는 것이 캔버스 재생성 로직 내부에 예외를 심는 것보다 검증하기 쉽다(§9.4). |

---

### 9.2 규범 문서 4종과의 관계 — 선결조건으로 재배치, 정직한 이탈로 기록한다

> ### ⚠ 2026-08-16 정정 — 이 절의 "규범 이탈" 판정은 과장이었다
>
> `GLOSSARY.md` §1(저장소 표준 어휘)이 이미 이 문제를 해결해두었다. 이 절을 쓸 때 `GLOSSARY.md`를 읽지 않아 생긴 오류다.
>
> | GLOSSARY.md §1이 정한 것 | 내용 |
> |---|---|
> | **상시 창**(창 개수에 센다) | 대화 창, 캔버스 창 — 2개 |
> | **일시 표면**(창 개수에 **세지 않는다**) | **설정창, 팝업창(=주문 창)** — 이미 등록된 용어 |
> | 근거 | "`ui/soul.md` §3의 '창은 두 개뿐이다'와 §8 탈락 조건의 '창이 셋 이상이다'는 **상시 창** 기준이다." `ui/soul.md:52`가 이미 "'모델 바꿔줘'라고 치면 모델 창이 뜬다"로 일시 표면의 존재를 전제한다 |
> | 설정창 진입로 | "① **대화 창의 빨간 점멸을 누른다** ② 커맨드바에 자연어로 부른다" — 구현된 것과 일치 |
>
> **따라서 주문 팝업도 설정 창도 규범 이탈이 아니다. 원래 어휘에 등록된 일시 표면이다.**
> 아래 본문의 "의도적 이탈", "1건째/2건째", "즉시 탈락 대상" 서술과 그에 딸린 `soul.md`/`DESIGN-SOUL.md` 개정 선결조건은 **철회한다.** 남는 선결조건은 규범 개정이 아니라 **사실 갱신** 하나뿐이다 — `GLOSSARY.md` §1의 "현재 코드에 일시 표면은 0건이다"가 설정 창 구현으로 stale이 되었으므로 상태표를 갱신한다(2026-08-16 반영 완료).
> 단, `GLOSSARY.md` §1이 요구하는 **"설정은 커맨드바로도 반드시 도달할 수 있어야 한다"**는 실제 미구현 결함이었고 `app/chat.js`의 `SETTINGS_COMMAND`로 해소했다.


**v2 구조 변경**: v1은 개정 작업을 G007(closeout, 파이프라인 최종 단계)에서만 확인 항목으로 넣었다. 이 순서로는 G001.5(Paper 아트보드 제작, 사람 눈 검증)부터 G006까지 전 기간 동안 판정 루브릭이 자기모순 상태로 운영된다(design BLOCKER). **v2는 문서 개정 자체를 G001.5 착수 전 선결조건으로 끌어올린다.**

#### 9.2.1 규범 원문 (얼버무리지 않고 그대로 인용)

| 문서:줄 | 원문 |
|---|---|
| `ui/soul.md:40-41` | "Athena의 전체 UI는 정확히 **두 개의 독립된 창**으로 이루어진다. 한 창 안의 두 영역이 아니다. **OS 레벨에서 분리된 별개의 창이다.**" |
| `ui/soul.md:190`(§8 탈락 조건, 점수 무관 즉시 제외) | "창이 셋 이상이다" |
| `ui/DESIGN-SOUL.md:102`(축2 도출 규칙1) | "창은 둘. **새 창을 만들지 않는다** — 있는 창이 커지고 줄어든다" |
| `ui/DESIGN-SOUL.md:1-5` | "**이 문서가 디자인 결정의 원장(ledger)이다.** 앞으로 사용자가 디자인에 대해 말하는 모든 것은 여기에 기록된다. 발언 → 그 발언이 뜻하는 원리 → 적용된 곳 순으로." |
| `ui/DESIGN-SOUL.md:92-94` | "온보딩은 세 번째 창이 아니다. 대화 창이 커진 것이다 → 이게 '창은 둘'을 깨지 않고 온보딩을 넣는 유일한 방법이다." |
| `ui/DESIGN-SOUL.md:157` | "창을 늘리는 해결 — 이력 보기, 온보딩, 설정 전부 기존 창으로 흡수" (이 소울이 거부하는 것 목록) |
| `plan/kiwoom-common-screen-brief.md:20-27`(Required product result) | "Deliver one minimal shared canvas shell... that supports: ... guarded action/workflow state..." |
| `plan/kiwoom-common-screen-brief.md:52`(invariant 6) | "One shared canvas and reusable state primitives cover the operation surface; operation-specific duplication is limited to genuinely distinct domain behavior." |
| `plan/kiwoom-common-screen-handoff.md:98-99` | "**Schema-driven Request Sheet** — 조회 입력, 구독 시작/중지, **주문 draft/review/confirm**, OAuth lifecycle control" |

**판정**: 이 팝업은 `ui/soul.md:190` §8 탈락 조건을 문언 그대로 적용하면 즉시 탈락 대상이고, `plan/kiwoom-common-screen-brief.md` invariant 6·Required product result와 `plan/kiwoom-common-screen-handoff.md`의 3-canvas 결정(주문을 Schema-driven Request Sheet 안에 둔다)도 정면으로 뒤집는다. 이 세 문서 중 어느 것도 "되돌릴 수 없는 부수효과가 있는 확인 화면은 예외"라는 조항을 갖고 있지 않다. `ui/soul.md:90`의 기존 확인 사례("이 창을 저장하시겠습니까?")도 새 창이 아니라 **캔버스 안 인라인 프롬프트**로 처리됐다 — 팝업은 이 코퍼스의 기존 해법과도 다른 방향이다.

이 코퍼스에는 정확히 이 상황을 처리한 선례가 있다: `ui/round-1R/two-windows.md:29-32`가 "모든 표면이 유리다" 결정을 두고 "Apple 규범 2건에서 **의도적으로 이탈**한다. 근거와 지불 비용은 참조" 형식으로 기록했다. 같은 형식을 여기 적용하되, **fit-dissonance-plan.md와 soul.md만 갱신 대상으로 삼지 않는다** — 동등한 권위를 가진 나머지 두 문서(brief/handoff)도 함께 개정한다(§9.10).

> **기록**: 주문 팝업은 "창은 둘" 규범과 "3-canvas 안에 order를 둔다" 결정을 **의도적으로 이탈한 세 번째 창**이다. "게이트"·"확인 레이어" 같은 재명명은 쓰지 않는다.

#### 9.2.2 선결조건 (G001.5 착수 전 완료 — 하드 게이트, 신설)

v1의 "지불하는 대가" 표에 있던 개정 작업을 **완료 시점이 명시된 선결조건**으로 승격한다. 아래 4건이 모두 완료되기 전에는 Paper 아트보드 작업(G001.5)도, 사람 눈 검증도 착수하지 않는다.

| # | 선결조건 | 완료 형식 | 근거 |
|---|---|---|---|
| 1 | `ui/soul.md:190` §8 탈락 조건에 "되돌릴 수 없는 부수효과를 갖는 확인 표면 1건(주문 팝업)은 예외"를 **명문 개정** | soul.md 파일 수정 diff | `ui/soul.md:174-193` |
| 2 | `ui/DESIGN-SOUL.md`에 사용자 원문("주문 관련 화면은 팝업으로 별도 화면을 만들어라")을 **발언 → 원리** 형식으로 즉시 기록하고, 축2 도출 규칙 1("창은 둘")에 "주문 팝업 1건 한정 예외" 각주를 단다 | DESIGN-SOUL.md 파일 수정 diff, `## 축 2 · 창의 생명` 절 아래 신규 항목 | `ui/DESIGN-SOUL.md:1-5,100-106` |
| 3 | `plan/kiwoom-common-screen-brief.md` invariant 6 / Required product result bullet 1에 ADR 각주 | brief.md 파일 수정 diff, §9.10 텍스트를 그대로 삽입 | §9.10 |
| 4 | `plan/kiwoom-common-screen-handoff.md`의 3-canvas 결정(§4, `:86-104`)에 ADR 각주 | handoff.md 파일 수정 diff, §9.10 텍스트를 그대로 삽입 | §9.10 |

**게이트 문구**: `fit_dissonance_check.py --check`의 사전 조건에 "위 4개 파일의 git blame에 이 개정 커밋이 존재"를 자동 확인 항목으로 추가한다(§9.9).

#### 9.2.3 남아 있는 지불 비용 (구현 중 계속 유효)

v1의 "대가 2"(광량 4단계 미해결)는 **§9.3에서 배후-밀도 규칙을 문자 그대로 적용해 해소**했으므로 더 이상 미해결 항목이 아니다(아래 참조). v1의 "대가 3"(마젠타 억제 로직 필요)은 §9.8에서 구체적인 IPC 메커니즘으로 확정되어 "미해결"에서 "구현 항목"으로 전환됐다.

| # | 남은 대가 | 상태 | 근거 |
|---|---|---|---|
| 1 | 마젠타 "정확히 한 곳" 규칙(`ui/palette.md:67`)을 지키려면 팝업이 열려 있는 동안 대화 창·캔버스 창의 마젠타를 억제하는 IPC 브로드캐스트가 필요 | **해결됨 — §9.8 `athena:order-popup-open/closed` 이벤트로 구현 확정** | `ui/palette.md:67`, §9.8 |
| 2 | 4번째 렌더링 표면(윈도우)이 옵션 B(4번째 캔버스 타입) 기각 논리와 충돌하지 않는지 | **해결됨 — §9.6 하단 논증 참조** | §0(a), §9.6 |

---

### 9.3 팝업 창 계약

#### 9.3.0 자격증명 데이터플로우 (신규 — safety BLOCKER 해소)

이 팝업의 안전 모델 전체가 "confirm 클릭 핸들러 하나만 서버 호출 함수를 가짐"을 전제하는데, v1은 그 HTTP 호출이 실제로 어느 프로세스에서 실행되는지, 토큰을 Electron이 어떻게 얻는지 명시하지 않았다. 실측: `app/AGENTS.md:11` "No backend wiring yet", `app/package.json`에 `dotenv` 등 env 로더 의존성 0건, 백엔드는 `uvicorn athena_api.main:app --host 127.0.0.1 --port 8010 --workers 1`로 완전히 독립된 프로세스로 기동(`backend/README.md:14`), 토큰은 `backend/athena_api/config.py:24-39`(`local_bearer_token: SecretStr`, `env_prefix="ATHENA_"` → 실제 env var명 `ATHENA_LOCAL_BEARER_TOKEN`, `.env.example`에서 확인) + `backend/athena_api/lifespan.py:29-33`(`app.state.local_bearer_token`)에서만 존재하고 `backend/athena_api/generated/runtime.py:53-63`(`_require_bearer`)가 이를 검증한다.

**데이터플로우 (명문 규정)**

```
order-popup.js (renderer, contextIsolation:true, sandbox:true)
  → window.athenaOrder.submitConfirm(editedFields)          ← preload가 노출한 5개 함수 중 1개, 필드값만 담음
  → order-preload.js: contextBridge.exposeInMainWorld(...)  ← ipcRenderer.invoke('order:confirm', editedFields)
  → app/main.js: ipcMain.handle('order:confirm', async (e, editedFields) => { ... })   ← 실제 fetch는 여기서만
       - process.env.ATHENA_LOCAL_BEARER_TOKEN 을 여기서 읽는다 (렌더러에 절대 전달하지 않는다)
       - process.env.ATHENA_BACKEND_BASE_URL (기본값 http://127.0.0.1:8010, backend/README.md:14 실측 포트) 을 여기서 읽는다
       - Idempotency-Key는 main이 createOrderPopup() 시점에 1회 생성해 main 프로세스 로컬 변수에만 보관 (§9.4) — 렌더러는 이 값을 절대 보거나 다루지 않는다
       - fetch(`${base}/api/v1/...`, { headers: { Authorization:`Bearer ${token}`, 'X-Athena-Confirm':'true', 'Idempotency-Key': key }, body: JSON.stringify(editedFields) })
  ← ipcMain.handle 반환값(JSON 응답 body만) → order-preload.js → 렌더러
```

**규정 (§9.9에 정적 스캔 테스트로 그대로 검증)**

| # | 규정 | 검증 방법 |
|---|---|---|
| 1 | `call_order_tr`에 대한 실제 HTTP 요청은 `app/main.js`의 `ipcMain.handle('order:confirm', ...)` 안에서만 실행된다 | 정적 스캔: `fetch(` 문자열이 `app/main.js` 밖(`order-preload.js`/`order-popup.js`/`order-popup.html`)에 없음 |
| 2 | 토큰/베이스 URL은 그 안에서만 읽고, 어떤 IPC payload·`webContents.send`로도 렌더러에 전달하지 않는다 | 정적 스캔: `order-preload.js`/`order-popup.js` 소스에 `ATHENA_LOCAL_BEARER_TOKEN`, `Authorization` 문자열 0건 |
| 3 | Idempotency-Key는 main 프로세스를 벗어나지 않는다(렌더러는 필드값만 주고받는다) | §9.9 IPC payload 스키마 테스트 |
| 4 | 두 프로세스(Electron/uvicorn)가 같은 토큰 값을 갖는 방법 | **이번 라운드 결정 규칙**: 두 프로세스는 반드시 같은 상위 실행 스크립트가 `ATHENA_LOCAL_BEARER_TOKEN`/`ATHENA_BACKEND_BASE_URL`을 동일하게 `export`한 뒤 각각 기동된다(값 주입 방식 자체는 실행 스크립트 책임). **실행 스크립트 파일 자체는 `[측정 필요]`** — 현재 `app/package.json`(`npm start`=`electron .` 단독)과 `backend/README.md:14`(uvicorn 단독)는 서로 독립적으로 기동되므로 이 스크립트가 G004 산출물로 신설돼야 한다(§9.8). |
| 5 | 값이 없을 때의 동작 | `process.env.ATHENA_LOCAL_BEARER_TOKEN` 또는 `ATHENA_BACKEND_BASE_URL`이 비어 있으면 `ipcMain.handle('order:confirm', ...)`을 **등록하지 않는다** — 주문 팝업 기능 자체가 fail-closed로 비활성화된다(§9.9) |

#### 9.3.1 창 계약 표

| 항목 | 값 | 근거 / 상태 |
|---|---|---|
| 크기 | `[측정 필요]` — 12개 TR 필드 수(§9.5, 최대 8필드/TR) 기준 실측 필요 | `app/main.js`의 `DESIGN` 상수(23-26행)에 팝업 선례 없음 |
| 위치 | 화면 workAreaSize 기준 재중앙 정렬(대화창 origin과 독립) — 정확한 px는 `[측정 필요]` | `computeLayout()`(`app/main.js:30-49`) 패턴을 모사하되 재사용하지 않음 |
| **부모 창 표시 순서(신규 — safety MAJOR 해소)** | `createOrderPopup()` 진입 시 `canvasVisible === false`(부팅 직후 기본값, `app/main.js:55,93-95` — `canvasWin`은 `commonWinOpts()`의 `show:false`로 생성되어 `expandCanvasWindow()`를 거치기 전까지 숨어 있다)이면 **먼저 `await expandCanvasWindow()`를 호출해 `canvasWin`을 표시한 뒤에만** `parent: canvasWin`을 지정한다. "숨은 부모 위 모달 자식" 조합을 Windows 11에서 검증 없이 쓰지 않는다 | `app/main.js:55,93-97,157-175`; §9.9에 Windows 11 실측 테스트 추가 |
| **싱글턴 가드(신규 — safety/design BLOCKER 해소)** | 모듈 전역 `orderPopupWin` 참조 1개. `createOrderPopup()` 재호출 시: (a) 참조 없음/`isDestroyed()` → 새로 생성. (b) 참조 존재·미파괴 → **새 창을 만들지 않고** `orderPopupWin.focus()` + `orderPopupWin.moveTop()`만 수행, 기존 draft/상태를 유지하고 아무 것도 다시 push하지 않는다 | §9.4에 "동시 주문 의도" 행 추가, §9.9에 "두 번째 호출이 새 `BrowserWindow`를 만들지 않음" 테스트 추가 |
| 모달성 | Electron 네이티브 `parent: canvasWin, modal: true` 채택 — AITS의 `parent` 미지정 + `alwaysOnTop('screen-saver')` 단독 방식과 **의도적으로 다르게 간다.** 이유: Call의 캔버스·대화 창은 이미 `alwaysOnTop:true`(`app/main.js:63`)라 AITS(캔버스에 `alwaysOnTop` 자체가 없음)와 달리 3중 always-on-top 경합이 생긴다. `parent`+`modal:true`는 OS 레벨에서 항상 부모 위에 렌더링되므로 수동 `moveTop()` 경합을 원천 회피한다 | `app/main.js:63`; AITS `src/preload/order-preload.ts`(z-order 경합 대응 코드가 필요했던 이유, 조사1) |
| 포커스 | 팝업이 열려 있는 동안 `chat.js:32,226`의 자동 `$input.focus()` 호출에 가드 추가(팝업 open 상태 플래그 확인, `athena:order-popup-open` 수신 시 플래그 set) | `app/chat.js:32,226`; §9.8 |
| **닫기(정정 — safety/design BLOCKER 해소)** | Esc/X/타임아웃/영수증 확인 등 닫기 경로에서 `destroy()`하는 정책은 유지하되, **`state === 'confirm'`(요청 전송~응답 수신 사이) 동안은 예외적으로 닫기를 막는다**: (1) 렌더러가 Esc 키다운을 `preventDefault()`, (2) `orderPopupWin.on('close', e => { if (state === 'confirm') e.preventDefault(); })`로 X 버튼·Alt+F4 포함 OS 창닫기 이벤트를 차단, (3) 서버 응답으로 상태가 `committed`/`rejected`/`timeout`/`in_doubt` 중 하나로 확정된 뒤에만 닫기 재활성화. OS 프로세스 강제종료(taskkill 등, `close` 이벤트를 우회)는 막을 수 없으므로 §9.8 pending 로그로 별도 폴백 | AITS 결함 이력(R31/R41/AUDIT-UI-CARD-RESURRECT — "재사용되는 pendingCard 슬롯"). **정책 자체(destroy 후 재생성, AITS 싱글턴+hide() 미이식)는 v1 그대로 유지** — 다음 주문 의도 시 새 창+새 Idempotency-Key로 재생성 |
| 렌더러 ready 핸드셰이크 | R31→R62 교훈 채택: 팝업 렌더러가 리스너를 건 뒤 자체 `ready`를 보고하기 전까지 Main은 draft를 pending 슬롯에만 채운다(`did-finish-load`만 믿지 않는다) | AITS `src/preload/order-preload.ts` R62 주석 |
| **유리 두께 — 광량 위계(정정 — design BLOCKER 해소)** | v1의 "'창' 단계 값 고정 채택"을 **철회**한다. `ui/DESIGN-SOUL.md:58`("유리 두께는 고정값이 아니다 — 뒤의 밀도·밝기에 비례")를 이름표가 아니라 문자 그대로 적용: 팝업의 실제 배후는 항상 `parent: canvasWin`(고밀도 데이터 캔버스)이므로 **"캔버스" 단계 값**을 쓴다. 구체값은 캔버스 자체가 이미 채택한 `rgba(29,34,44,0.92~0.95)`(`--color-k-panel2` 기반, `ui/round-1R/two-windows.md:114`)를 그대로 재사용한다. **이 결정으로 "4번째 광량 단계 신설" 자체가 불필요해진다** — 팝업은 새 단계가 아니라 기존 3단계 규칙(배후 밀도 비례)이 정의대로 적용된 사례일 뿐이다. v1이 재현하려던 실패는 `ui/round-1R/two-windows.md:96-99`("기본 상태 값 0.82를 확장[=배후가 캔버스]에 그대로 쓰니 서리유리가 아니라 깨진 오버레이로 보였다")에 이미 실측 기록돼 있다 | `ui/DESIGN-SOUL.md:58`; `ui/round-1R/two-windows.md:96-99,114`; §9.2.3 대가1 해소 |
| 유리/불투명도 | 위 항목과 동일 값(`rgba(29,34,44,0.92~0.95)`) 채택. `--color-k-panel #171b24`(창 단계, 저밀도 데스크톱 배후 전제) 값은 **쓰지 않는다** — 팝업의 배후가 데스크톱인 적은 없기 때문 | `ui/palette.md:18-19` |
| 마젠타 1곳 규칙 적용 지점 | 팝업의 confirm 버튼/포커스 캐럿 딱 한 곳(`--color-brand #ee137b`). 팝업이 열린 동안 대화 창 입력줄·캔버스 창의 마젠타는 `athena:order-popup-open/closed` 이벤트로 억제(§9.8 — 더 이상 "구현 필요"만 적힌 미해결 항목이 아니라 구체 채널이 정해진 구현 항목) | `ui/palette.md:49,62,67`; §9.8 |
| 오류색 | 주문 실패(레이트리밋·TR 거부·in_doubt 아님)는 `--color-warn #ff9838`. `--color-bad #ff5c5c`는 Athena 전역 사용 금지 토큰이라 팝업도 예외 없음(등락 `--color-up #ff5c5c`와 혼동 방지) | `ui/palette.md:74-88` |
| 등락색 노출 시 | 현재가·호가 노출되면 `--color-up #ff5c5c`/`--color-down #4d9fff` 그대로 | `ui/palette.md:39-41` |
| 접근성 폴백 | `prefers-reduced-transparency`/`contrast`/`motion` 3종 필수, `app/styles/access.css`의 `.glass`/`.glass-sheen`/`.card` class 상속으로 재사용(신규 CSS 작성 최소화) | `ui/liquid-glass.md:77-95`; `app/styles/access.css:1-47` |
| **등장 방식(정정 — design MAJOR 해소)** | 페이드 금지 — 굴절 변조로 등장. 구체 메커니즘: 팝업 `BrowserWindow`도 `show:false`로 생성(캔버스·대화 창과 동일 패턴, `app/main.js:57-71`), 로드 완료 후 `order:prime-clip`/`order:run-animation` IPC(캔버스의 `prime-clip`/`run-animation`, `app/main.js:162-175`와 **동형이지만 별도 채널명**)로 clip-path 확장 애니메이션을 재생한 뒤 `show()`한다. `modal:true`의 OS 네이티브 등장 애니메이션과 커스텀 애니메이션이 이중 재생되는지는 Windows 11에서 **선행 프로토타입 검증 필수**(§9.9) — 검증 실패 시 `modal:true`를 포기하고 포커스 트랩(§9.3 모달성 대안)으로 전환 | `app/main.js:162-175`; `ui/soul.md:167-168`; §9.8, §9.9 |
| TR ID 비노출 | `kt10000` 등 원시 코드 노출 금지, 한국어 라벨만(§9.5) | `ui/DESIGN-SOUL.md:128-133` |
| Idempotency-Key 생성 | `crypto.randomUUID()`를 **main 프로세스에서만** 호출(`createOrderPopup()` 진입 시 1회) — Node 내장 `crypto` 모듈, 신규 의존성 없음. 렌더러/preload는 이 값을 절대 다루지 않는다(§9.3.0, §9.4) | Node.js `crypto.randomUUID()`; `backend/athena_api/generated/runtime.py:154-158`(1~128자 제약, UUID 36자는 충족) |

---

### 9.4 상태 기계 — draft → review → confirm → committed → receipt

**ScreenDocument.state 매핑(신규 — contract MAJOR 해소)**: 이 5+3 상태는 `plan/kiwoom-optimal-screen-selection-rendering-plan.md`가 이미 정의한 7종 `ScreenDocument.state` 밖의 **경쟁 어휘가 아니다.** 같은 문서 `:412`가 `action_required` 상태의 내용으로 이미 "주문 확인 등 명시적 사용자 행동 필요 | draft/review/confirm 단계 표시"를 명시하고 있다 — draft/review/confirm은 **`action_required` 하나의 상태를 세분화한 내부 sub-state**다. `committed`/`receipt`는 새 enum 값을 만들지 않고 같은 `action_required` 문서의 종결 variant(`outcome` 필드로 성공/실패/타임아웃/in_doubt 구분)로 표현한다. 이 매핑 덕분에 팝업 렌더러는 §9.5의 `action`/`status`/`order_receipt` section을 **재사용**할 수 있다(신규 primitive 없음, §9.6).

| 상태 | 화면 구성 | 전이 조건(다음 상태로) | 되돌아가기 | 실행 여부 |
|---|---|---|---|---|
| **draft** | 팝업 오픈. AI가 파싱한 초안 필드값이 편집 가능한 폼(§9.5 템플릿, `action-section.js` 재사용)으로 채워짐. `createOrderPopup()` 시점 main이 Idempotency-Key 1개를 **main 프로세스 로컬 변수에만** 생성(§9.3.1) — 팝업 인스턴스 생명주기 동안 재사용, review 왕복으로 재발급되지 않는다 | 사용자가 필드 확인/수정 완료 | 팝업 닫기(Esc/X) → destroy, 주문 없음 | **`call_order_tr` 미호출** |
| **review** | 수정된 값 재요약 표시(직접 편집 vs 별도 review 화면 분리 여부는 §9.5 폼 설계와 함께 확정 필요, `[측정 필요]`) | 명시적 확인 액션(버튼 클릭. AITS처럼 수량 재입력 대조 방식 채택 여부는 `[측정 필요]`) | draft로 복귀 가능. **Idempotency-Key는 재발급하지 않는다**(위 draft 행과 동일 키) | **미호출** |
| **confirm** | 폼 잠금(입력 비활성화) + **Esc/X/close 이벤트 차단**(§9.3.1 "닫기" 행), 전송 중 표시. main이 자신이 보관한 Idempotency-Key를 첨부해 `Authorization`(로컬 bearer, main-only) + `X-Athena-Confirm: true` + `Idempotency-Key` 헤더로 **단 1회** `call_order_tr` 호출(§9.3.0) | 서버 응답 수신 또는 타임아웃 15초 경과(아래 실패 표) | **불가** — 요청이 나간 뒤에는 review로 되돌아갈 수 없음(중복 제출 방지), **창 닫기도 불가**(위 정정) | **여기서만 호출**, `ipcMain.handle('order:confirm', ...)` 하나만 서버 호출 함수를 가짐 |
| **committed** | 응답 성공(`ord_no` 수신) | 자동으로 receipt 표시 | — | 완료, 재호출 없음 |
| **receipt** | `ord_no` + 한국어 TR 라벨 + 제출 필드 요약(`order-receipt-section.js` 재사용). 닫기 버튼만(재시도/재제출 버튼 없음 — 새 주문은 항상 새 draft로) | 팝업 닫기(destroy) | — | — |

**신규 — 동시성/강제종료 행**

| 상태 | 화면 구성 | 전이 조건 | 되돌아가기 | 실행 여부 |
|---|---|---|---|---|
| **동시 주문 의도**(팝업이 이미 열려 있는 동안 대화 창이 새 주문 의도를 파싱) | `createOrderPopup()`이 싱글턴 가드(§9.3.1)를 타 새 창을 만들지 않고 기존 팝업을 `focus()`. 대화 창은 "이미 열려 있는 주문 확인 창이 있습니다"를 텍스트 응답으로만 표시(팝업 UI 변경 없음) | 기존 팝업이 `destroy()`된 뒤에만 새 주문 의도가 새 `createOrderPopup()`을 만들 수 있음 | — | **미호출**(기존 팝업의 상태를 그대로 유지) |
| **강제 종료**(OS 프로세스 킬, `close` 이벤트 우회) | 재기동 시 §9.8 pending 로그(디스크)에 남은 `tr_id`+`Idempotency-Key`를 확인하도록 안내(조회 TR로 수동 확인) | — | — | 이미 나간 요청은 서버가 독립적으로 완료/거부/in_doubt 처리(`runtime.py:211-229`) |

**실패/거부/타임아웃/중복/in_doubt 표현**

| 케이스 | 근거 | 팝업 표현 |
|---|---|---|
| 서버 거부(4xx/5xx, TR reject) | `backend/athena_api/generated/runtime.py:141-231` — 자동 재시도 없음 | 주황(`#ff9838`) 오류 카드(`status-section.js` 재사용), 사유 표시, "새 draft로 다시 시도" 링크(같은 review 재사용 아님 — 새 키) |
| **타임아웃(응답 없음) — 확정값(신규)** | 클라이언트 측 타임아웃 = **15,000ms**(`backend/athena_api/config.py:29` `request_timeout_seconds` 기본값 10.0s + IPC/큐잉 여유 5s). `.env.example`의 `ATHENA_REQUEST_TIMEOUT_SECONDS=10`과 정합 | **성공도 실패도 아닌 별도 시각 상태**로 표시(주황도 아니고 완료도 아님). 자동 재시도 절대 금지 — 사용자가 별도 조회 화면(query TR)에서 수동 확인하도록 안내. **15초 도달 시에도 confirm의 닫기 차단(§9.3.1)은 서버 응답(또는 in_doubt 확정)까지 유지** |
| `IN_DOUBT`(요청은 나갔는데 응답을 못 받음) | `runtime.py:196,206,226-229`(예외 시 `OrderState.IN_DOUBT`로 남고 재시도하지 않음) | 위 타임아웃과 동일한 "불확실" 상태 — 자동 완료/실패 판정 금지, 조용히 닫지 않는다 |
| 중복 제출(같은 창에서 재클릭) | confirm 진입 시 폼 잠금(§9.3.1 "닫기" 행) | 두 번째 클릭 자체가 UI 레벨에서 불가능 |
| 중복 제출(다른 경로) | `runtime.py:170-172`(같은 key·다른 payload → 409), `189-209`(같은 key·같은 payload → PENDING/COMPLETED 상태 재사용) | 서버가 되돌려주는 상태를 팝업이 그대로 표시(별도 UI 처리 불필요) |

**open/refresh/retry가 주문을 실행하지 않는다는 구조적 보장**

1. 팝업 preload가 노출하는 함수는 draft 수신 / confirm 제출 / 취소 / receipt 수신 / ready 5개뿐이며(§9.8), 그중 서버로 나가는 함수는 confirm 클릭 핸들러 **하나**만 호출한다.
2. 팝업 오픈(draft 렌더) · 렌더러 새로고침 · receipt 이후 재확인은 이 함수를 호출하는 경로가 아니다.
3. `destroy()` 후 재생성 정책(§9.3.1, AITS 싱글턴 미이식)이 "닫았다 다시 연 팝업이 이전 pending 상태를 이어받는" 경로 자체를 없앤다.
4. 싱글턴 가드(§9.3.1)가 "동시에 두 개의 살아있는 팝업이 서로 다른 키로 존재"하는 경로를 없앤다.

---

### 9.5 폼 구성 — 3개 구조 템플릿(신규/정정/취소), TR별 필드 조건부 표시

*(v1 그대로 유지 — 3렌즈 검토에서 이 절에 대한 지적 없음)*

**근거 숫자** (백엔드 조사, `backend/athena_api/generated/registry.py` + `backend/ref/kiwoom-tr-inventory.json` 교차집계)

- distinct 요청 필드: **13개**, distinct 응답 필드: **5개**(전부 scalar, 리스트/중첩 없음)
- 요청 필드 시그니처(정확한 필드 집합)는 **7종**이지만, 신규/정정/취소 **3계열** 내부에서 `dmst_stex_tp`(국내거래소구분, 8/12 TR) 유무로만 갈리고, 신규 계열 안에서 신용매도(kt10007) 1개만 `crd_deal_tp`/`crd_loan_dt` 2필드가 추가된 **상위집합**이다.
- 매수/매도(kt10000·kt10001·kt10006, kt50000·kt50001)는 요청 필드 시그니처가 완전히 동일 — `trde_tp`(매매구분) 값 차이일 뿐 별도 폼 불필요.

**결론**: 3계열(신규/정정/취소) × "필드 존재 여부 기반 조건부 렌더링"으로 TR별 전용 폼을 만들지 않는다. 팝업 오픈 시 해당 TR의 요청 필드 목록(`registry.py`의 `TrSpec`)을 조회해 아래 13개 화이트리스트 중 존재하는 필드만 표시한다.

| element | 한국어 라벨(실측, `kiwoom-tr-inventory.json`) | 등장 TR 수 | 필수 여부 |
|---|---|---|---|
| `stk_cd` | 종목코드 | 12/12 | 필수(전부) |
| `dmst_stex_tp` | 국내거래소구분 | 8/12(금현물 4개 제외) | 필수(등장 시) |
| `trde_tp` | 매매구분 | 6/12(신규 6종) | 필수 |
| `ord_qty` | 주문수량 | 6/12(신규 6종) | 필수 |
| `ord_uv` | 주문단가 | 6/12(신규 6종) | 선택 |
| `cond_uv` | 조건단가 | 4/12(국내주식·신용 신규만, 금현물 신규엔 없음) | 선택 |
| `crd_deal_tp` | 신용거래구분 | 1/12(kt10007만) | 필수(등장 시) |
| `crd_loan_dt` | 대출일(YYYYMMDD, 융자일 경우 필수) | 1/12(kt10007만) | 선택 |
| `orig_ord_no` | 원주문번호 | 6/12(정정+취소 6종) | 필수 |
| `mdfy_qty` | 정정수량 | 3/12(정정 3종) | 필수 |
| `mdfy_uv` | 정정단가 | 3/12(정정 3종) | 필수 |
| `mdfy_cond_uv` | 정정조건단가 | 2/12(kt10002·kt10008만) | 선택 |
| `cncl_qty` | 취소수량 | 3/12(취소 3종) | 필수 |

응답(receipt) 표시 필드: `ord_no`(주문번호, 12/12) / `dmst_stex_tp`(국내거래소구분, 6/12) / `base_orig_ord_no`(모주문번호, 정정·취소 6/12) / `mdfy_qty`(정정 3/12) / `cncl_qty`(취소 3/12) — 전부 scalar, 별도 테이블/리스트 프리미티브 불필요.

계좌번호·비밀번호류 필드는 12개 TR 요청/응답 전체에 **0건**(appkey/secretkey/token이 계좌를 이미 고정) — 팝업에 계좌 선택 UI를 만들지 않는다. `trde_tp`/`dmst_stex_tp`/`crd_deal_tp` enum 값은 원시 코드(`0`,`KRX`,`33` 등)가 아니라 한국어 값(`보통`,`KRX`,`융자` 등)으로 표시한다.

---

### 9.6 매핑 규칙 변경 (§5.1) — 301 불변식 유지, 런타임 분기로만 이탈

**v1의 오류(contract BLOCKER)**: v1은 `resolver.py`를 "§6.2 예정 파일"로 인용했으나 `plan/kiwoom-common-template-fit-dissonance-plan.md` §6.2는 Electron `nodeIntegration`/`contextIsolation` 보안 전환만 다룰 뿐 `resolver.py`를 언급하지 않는다. `resolver.py`는 실제로 `plan/kiwoom-optimal-screen-selection-rendering-plan.md:511`("selector 결과를 screenId로 연결")에 정의된 **런타임 dispatch 모듈**이며, G002가 생성하는 `backend/scripts/generate_api.py`/`build_screen_definitions()` 같은 **생성 시점 모듈이 아니다.**

**정정된 규칙**: G002는 여전히 **301개 `ScreenDefinition`을 전부 생성**한다(order 12개 포함, `mode='order'`, 안전 플래그 유지) — `plan/kiwoom-optimal-screen-selection-rendering-plan.md:742-747`(G002 완료 기준 "definition 정확히 301개", "category 정확히 264/23/12/2")과 `:1078-1082`(§20 DoD)를 그대로 유지한다. 팝업은 **생성 레이어가 아니라 런타임 dispatch 레이어**에서만 갈라진다.

**변경 전** (`plan/kiwoom-common-template-fit-dissonance-plan.md:296-297`)

```
kind == order      → Schema-driven Request Sheet
kind == oauth      → Schema-driven Request Sheet (guarded lifecycle)
```

**변경 후 (§5.1, 생성 규칙 — 불변)**

```
kind == order      → ScreenDefinition은 그대로 생성(mode='order'), Schema-driven Request Sheet용 section shape도 유지
kind == oauth      → Schema-driven Request Sheet (guarded lifecycle)   ← 불변
kind == websocket  → Live Stream Canvas
kind == query      → Adaptive Record Canvas
```

**신규 — 런타임 dispatch 규칙 (`backend/athena_api/screens/resolver.py`, `plan/kiwoom-optimal-screen-selection-rendering-plan.md:511`)**

```
resolver.py: resolve(question, context) → { screenId, dispatch }
  dispatch == 'canvas'  (query/websocket/oauth)  → 기존 athena:screen:* IPC 경로 그대로
  dispatch == 'popup'   (order 12개만)           → createOrderPopup(screenId, draftInput) 호출, athena:screen:* 경로 대신 §9.3.0 데이터플로우로 위임
```

**Schema-driven Request Sheet에 남는 것**: query 171개의 조회 입력 폼 + OAuth 2개의 guarded lifecycle(`auth_required/authorizing/ready/expired`)뿐. 표 `§4.2`의 "14.5 Schema-driven Request Sheet" 항목(`:273`)에서 "주문 draft/review/confirm/receipt" 문구를 제거하고, order 팝업을 위한 별도 Paper 보드(예: "16 · 주문 팝업")를 신설해야 한다(아트보드 목표 ≥20에서 +1 이상, `[측정 필요]`).

**§5.2 fallback shape 표(`:308`)의 `order→action+status+order_receipt` 항목**은 삭제가 아니라 **재배치**한다 — 이 조합은 여전히 유효하다. "Schema-driven Request Sheet의 shape fallback"이 아니라 **팝업 내부 화면 구성 규칙**으로 옮긴다.

**primitive 재사용 강제(신규 — contract MAJOR 해소)**: `app/order-popup.js`는 draft/receipt 렌더링을 새로 구현하지 않는다. `plan/kiwoom-optimal-screen-selection-rendering-plan.md:639-641`이 이미 정의한 `app/screens/action-section.js`(draft/review/confirm — "draft 내용, 영향, 대상 account, confirm 가능 조건 표시", `:666`), `status-section.js`(in_doubt/timeout/rejected — "현재 단계, 최근 변화, 복구 행동 표시", `:665`), `order-receipt-section.js`(receipt — "실행 결과를 수정 불가 기록처럼 표시", `:667`), `format-cell.js`(raw/display 포맷)를 **그대로 import**한다. 팝업은 6프리미티브 렌더러의 **두 번째 구현이 아니라 두 번째 호스트 창**이다 — AITS의 2중 렌더링 시스템 중복(§0 원칙 6이 막으려는 패턴)을 재현하지 않는다.

**옵션 B 기각 논리와의 관계(신규 — contract MINOR 해소)**: §0(a)에서 기각된 옵션 B는 "301개 population 안에서 이상치를 처리하기 위해 4번째 **캔버스 타입**을 신설"하는 것이었고, 위험은 "TR 단위로 계속 늘어나는 재증식"이었다(자유 캔버스 예산 §5.5가 이 위험을 관리하는 이유이기도 하다). 주문 팝업은 이 위험과 구조가 다르다: (1) 새 primitive를 만들지 않고 기존 6개를 재사용(위), (2) 301개 population 전체가 아니라 `kind==order`라는 **단 하나의 kind, 고정 12개**에만 적용되며 TR이 늘어나도 팝업 windows 종류는 1개로 고정된다(자유 캔버스처럼 mapping별로 늘어나는 구조가 아니다), (3) query/websocket/oauth 289개의 이질감 채점 체계(§9.7)에는 전혀 개입하지 않는다. 따라서 4번째 렌더링 표면(창)은 옵션 B가 우려한 "TR-shape별 분기 재증식"과 다른 축의 결정이며 같은 기각 논리가 적용되지 않는다.

**OAuth 2개는 팝업 대상이 아니다.** 판정: OAuth 토큰 발급/갱신은 appkey/secretkey→token의 기계 간(machine-to-machine) 인증 갱신이며, 사용자가 실행을 확정하는 자금 이동 행위가 아니다 — §9.1의 팝업 정당화 근거가 적용되지 않는다. `kind == oauth → Schema-driven Request Sheet(guarded lifecycle)` 매핑을 그대로 유지한다.

---

### 9.7 이질감 테스트 범위 변경 — 301→289 리터럴 치환 (contract MAJOR 해소)

> **적용 완료(2026-08-16)**: 아래 치환 1~4는 이 문서 §2.4 / §3 / §6.3 / §7에 **이미 반영됐다.** 아래 텍스트는 무엇을 왜 바꿨는지 남기는 근거 기록이며, 다시 적용할 대상이 아니다.

v1은 "자동 채점 모수 301→289"를 이 절에서만 선언하고, 같은 문서(`kiwoom-common-template-fit-dissonance-plan.md`) 본문의 §2.4/§3/§6.3에 남아 있는 "301"을 갱신하지 않아 병합 시 자기모순 문서가 된다. 아래는 **그대로 붙여넣을 리터럴 치환 텍스트**다.

**요약 표**

| 구분 | 이전(301 기준) | 변경 후 |
|---|---|---|
| 자동 채점 모수 | 301 = 186 base + 115 detail | **289** = 264 read + 23 WS + 2 OAuth (`264+23=287`, `287+2=289`) |
| order 12 | 301 안에 포함, Schema-driven Request Sheet fit 채점 대상 | **채점 모수에서 제외**, 이질감 fit 채점 대상이 아니다(§9.6 — `ScreenDefinition`은 여전히 301개 생성). 아래 별도 체크리스트로 검증 |
| override 예산 40 | 301의 약 13.3% | **289의 약 13.8%**(절대 상한 40은 불변) |
| 자유 캔버스 예산 8 | 301의 약 2.7% | **289의 약 2.8%**(절대 상한 8은 불변) |
| 사람 표본 anchor 26 | — | **영향 없음** — anchor 26 목록에 order TR(`kt10xxx`/`kt50xxx`) 0건. 재추출 불필요 |

**치환 1 — `kiwoom-common-template-fit-dissonance-plan.md` §2.4 (구 `:177`) 전체 치환**

```
- **자동 채점**: 289개(264 read + 23 websocket + 2 oauth). `kiwoom-output-profile.json` + `response-projections.json`
  + `kiwoom-tr-inventory.json`에서 결정 가능하므로 표본이 필요 없다. order 12개는 ScreenDefinition은
  생성되지만(§9.6) 이질감 fit 채점 모수에서는 제외되며, §9.7 order 전용 체크리스트로 별도 검증한다.
```

**치환 2 — 같은 문서 §3 `gate_complete` 정의(구 `:229`, "자동 301/301 채점 + ...") 치환**

```
- **`gate_complete`**: 자동 289/289 채점(order 12는 §9.7 체크리스트로 별도 집계) + 사람 표본 90/90 채점
  + `inter_rater_agreement`≥0.7 + fit≥1≥95% + fit=2≥85% + fit=0≤5% + 규칙≤10 + override≤40
  + 자유캔버스≤8 + 예외총량≤52 + **order 12 전용 체크리스트(§9.7) 8/8 통과**. 설계 매체와 무관하게 판정 가능.
```

**치환 3 — 같은 문서 §6.3 출력 스키마(구 `:456-485`)에 order 12개 표현 필드 추가**

```json
{
  "mapping_id": "order:kt10000",
  "kind": "order",
  "auto_fit": null,
  "excluded_from_auto_score": "order_popup",
  "popup_checklist": { "field_whitelist": "pass", "no_tr_id_leak": "pass", "..." : "..." },
  "human_fit": null,
  "rescored_fit": null,
  "free_canvas_id": null
}
```

```
"aggregate": {
  "auto_scored": 289,
  "order_popup_checklist_scored": 12,
  ...
}
```

**치환 4 — `kiwoom-common-template-fit-dissonance-plan.md` §7 Athena 용량 목표(구 `:518-521`)에 팝업 파일 포함**

```
| `backend/athena_api/screens/*.py` + `app/screens/*.js` + `app/order-*.js` + `app/styles/order-popup.css` 총 LOC | ≤ 6,000(팝업 포함 재산정) |
| 검증 스크립트 LOC ≤ 검증 대상 UI LOC(불변식) | `fit_dissonance_check.py` + G005 sentinel + order-popup 정적 스캔(§9.9) 합계 ≤ `app/screens/*.js` + `app/order-*.js` 합계 |
```

**order 12 전용 체크리스트** (fit=0/1/2 루브릭 대신, `[측정 필요]`가 아닌 항목은 자동 검증 가능)

| # | 점검 항목 | 방법 | 통과 기준 |
|---|---|---|---|
| 1 | 안전 상태 전이 | §9.4 상태 기계 자동 테스트: draft 렌더/새로고침/재오픈 시 `call_order_tr` 호출 횟수 | **0회**(confirm 클릭 1회만 1회 호출) |
| 2 | 필드 화이트리스트 | 팝업에 렌더링된 필드 집합을 `registry.py`의 TR별 요청/응답 필드와 대조 | 12/12 TR **전수** 일치(§9.5 13개 화이트리스트 밖 필드 0건) |
| 3 | 민감정보 비노출 | 계좌번호·비밀번호류 키워드 스캔(요청/응답 필드) | 0건 |
| 4 | TR ID 비노출 | 렌더링된 DOM에 `kt10000` 등 원시 코드 매칭 | 0건, 한국어 라벨만 |
| 5 | 중복 제출/폼 잠금 | confirm 진입 후 재클릭 시도 | UI 레벨 재호출 불가 |
| 6 | in_doubt/타임아웃 표현 | §9.4 케이스 3종(거부/타임아웃/in_doubt) 각각 시각적으로 구분되는 상태 존재 여부 | 3종 모두 서로 다른 상태로 렌더 |
| 7 | 접근성 3종 폴백 | `prefers-reduced-transparency/contrast/motion` CDP 강제 후 스크린샷 | `verify.js` 기존 방법론과 동일 기준 |
| 8 | 마젠타 배타성 | 팝업 열림 중 대화/캔버스 창 마젠타 노출 여부 | 팝업 열림 동안 다른 두 창 마젠타 0곳 |

사람 눈 검증은 12개가 아니라 **3개 구조 템플릿(신규/정정/취소) 전수**로 충분하다(§9.5 — 모집단이 작아 표집이 아니라 전수).

---

### 9.8 구현 산출물

**Electron(신규, 기존 파일은 최소 수정)**

```
app/main.js                — orderWinOpts() 신규 함수(commonWinOpts()는 건드리지 않음),
                              orderPopupWin 싱글턴 참조(§9.3.1), createOrderPopup()/closeOrderPopup(),
                              ipcMain.handle('order:confirm', ...) ← 실제 fetch 호출은 여기 한 곳뿐(§9.3.0),
                              ipcMain.handle('order:prime-clip'/'order:run-animation', ...) 팝업 전용 등장 애니메이션(§9.3.1),
                              order-popup 열림/닫힘 시 chatWin/canvasWin에 'athena:order-popup-open'/'athena:order-popup-closed' 브로드캐스트(마젠타 억제용, 신규),
                              confirm 요청 직전 { tr_id, idempotency_key, timestamp }를 app/captures/order-pending.log(JSON Lines, append-only)에 기록(강제종료 폴백, §9.4),
                              module.exports에 노출
app/order-preload.js       — 신규. 이 저장소 최초의 preload/contextBridge 사례.
                              노출 표면: onDraft/submitConfirm/cancel/onReceipt/ready 5개뿐.
                              소스에 'ATHENA_LOCAL_BEARER_TOKEN'/'Authorization'/'fetch(' 문자열 없음(§9.3.0, §9.9)
app/order-popup.html       — 신규. canvas.html/chat.html과 동일 3단 <link> 패턴
                              (styles/tokens.css → 로컬 css → styles/access.css) 재사용
app/order-popup.js         — 신규. contextBridge로 노출된 함수만 호출, ipcRenderer 직접 사용 금지.
                              app/screens/action-section.js, status-section.js, order-receipt-section.js,
                              format-cell.js를 import해 draft/review/confirm/receipt를 렌더링(§9.6 — 신규 렌더러 재구현 금지)
app/styles/order-popup.css — 신규. 캔버스 단계 값(rgba(29,34,44,0.92~0.95), --color-k-panel2 기반) 사용(§9.3.1 정정)
app/chat.js                — 수정. 'athena:order-popup-open/closed' 수신 시 마젠타 억제 CSS 클래스 토글 +
                              기존 $input.focus() 가드(32,226행)에 팝업 open 플래그 조건 추가
app/canvas.js               — 수정. 'athena:order-popup-open/closed' 수신 시 마젠타 억제 CSS 클래스 토글
scripts/dev-start.*         — 신규(`[측정 필요]`, 이름/형식 미정). Electron·backend 프로세스를 같은
                              ATHENA_LOCAL_BEARER_TOKEN/ATHENA_BACKEND_BASE_URL 환경변수로 동시 기동(§9.3.0 항목4)
```

`app/main.js`의 기존 `commonWinOpts()`(57-71행, `nodeIntegration:true, contextIsolation:false`)는 **수정하지 않는다** — 캔버스/대화 창과 즉시 분리하기 위해서다.

**주문 팝업은 처음부터 `contextIsolation:true`로 태어난다 — 채택.**

| webPreferences | 캔버스/대화 창(기존, 미변경) | 주문 팝업(신규) |
|---|---|---|
| `nodeIntegration` | `true`(`app/main.js:69`) | `false` |
| `contextIsolation` | `false`(`app/main.js:69`) | `true` |
| `sandbox` | 미지정 | `true` |
| `preload` | 없음 | `app/order-preload.js` |

**백엔드**: 변경 없음. `backend/athena_api/generated/runtime.py`(`call_order_tr`, 141-231행)와 `backend/athena_api/generated/routes.py`가 이미 로컬 bearer(`_require_bearer`, `:53-63`) + `X-Athena-Confirm` + `Idempotency-Key` 계약을 구현하고 있다. 런타임 분기(§9.6)에 따라 `backend/athena_api/screens/resolver.py`(`plan/kiwoom-optimal-screen-selection-rendering-plan.md §9.1` 정의, **§6.2 아님 — 인용 정정**)가 `kind==order`일 때 `dispatch:'popup'`을 반환하도록 분기만 추가한다. `ScreenDefinition` 생성(`generate_api.py`)은 변경하지 않는다(§9.6).

---

### 9.9 검증

| 항목 | 방법 | 금지 사항 |
|---|---|---|
| live order 0건 유지 | 팝업 전용 테스트는 **fixture JSON만** 사용(fixed draft, mock 서버 응답) | 실제 `backend/athena_api` 엔드포인트·실제 Kiwoom 업스트림 호출 절대 금지 — 안전 불변식(live order QA 0건) 유지 |
| confirm 호출 카운트 | draft 렌더/새로고침/재오픈 시나리오 각각에서 stub confirm 핸들러 호출 횟수 assert | `0`이어야 함(§9.4, §9.7-1과 동일 항목) |
| **자격증명 정적 스캔(신규)** | `order-preload.js`/`order-popup.js`/`order-popup.html` 소스에 `ATHENA_LOCAL_BEARER_TOKEN`, `Authorization`, `fetch(` 문자열 존재 여부 grep | 1건이라도 존재 시 실패(§9.3.0) |
| **싱글턴 가드(신규)** | `createOrderPopup()` 2회 연속 호출 시 `BrowserWindow` 생성 횟수 assert | `1`이어야 함(2번째 호출은 `focus()`만, §9.3.1) |
| **confirm 강제종료 차단(신규)** | `state='confirm'`으로 stub 설정 후 `close` 이벤트 발생시켜 `preventDefault()` 호출 여부 assert | 차단 실패 시 실패 |
| **부모 창 표시 순서 실측(신규)** | `canvasVisible=false` 상태에서 `createOrderPopup()` 호출 → `canvasWin.isVisible()===true`가 팝업 `show()` 이전에 성립하는지 Windows 11에서 스크린샷 대조 | 부모 숨김 상태로 모달 자식이 뜨면 실패 |
| **등장 애니메이션 프로토타입(신규)** | `modal:true` + 커스텀 clip-path 애니메이션 동시 적용 시 이중 재생 여부를 프레임 캡처로 확인(`app/verify.js` 프레임 측정 방법론 재사용) | 이중 재생 확인 시 `modal:true` 재검토 필요(§9.3.1) |
| `verify.js` 확장 | 기존 6개 검증(부팅/확장수축/스크린샷/창 독립성/접근성 3종/E2E Enter/수동 리사이즈)에 **order-popup 섹션 추가**: (a) 팝업 `getBounds()`가 캔버스/대화 창과 독립, (b) `parent`/`modal` 옵션이 실제로 설정됐는지, (c) preload 노출 표면이 5개 함수로 제한되는지(정적 스캔, AITS `order-confirm-z-order.test.ts` S-04와 동형) | 백엔드 네트워크 호출 0건 |
| **IPC 채널 화이트리스트(정정)** | `order-preload.js`의 `exposeInMainWorld` 표면(5개)과 `app/main.js`의 order 관련 `ipcMain.handle` 채널 수 대조. **마젠타 억제용 `athena:order-popup-open/closed` 브로드캐스트는 이 5채널 화이트리스트와 별개로 카운트**(chatWin/canvasWin 대상 `webContents.send`이지 order-preload 노출 함수가 아님) | 5개 초과 시(마젠타 이벤트 제외) 실패 |
| 렌더러 ready 핸드셰이크 | draft push 전 렌더러 `ready` 신호 수신 여부를 assert하는 유닛 테스트 | `did-finish-load`만으로 draft를 보내는 코드는 리뷰에서 반려(R31 재발 방지) |
| **Idempotency-Key 개수(신규)** | 팝업 생명주기(창 생성~destroy) 동안 `crypto.randomUUID()` 호출 횟수 assert | `1`이어야 함(§9.4 draft/review 왕복 무관) |
| **pending 로그(신규)** | confirm 요청 직전 `app/captures/order-pending.log`에 `{tr_id, idempotency_key}` 엔트리 존재 여부 assert | 미기록 시 실패 |
| §9.7 체크리스트 8항목 | `backend/scripts/fit_dissonance_check.py`와 별개의 스크립트(`[측정 필요]` — 파일명 미정) 또는 동일 스크립트의 `--order-popup` 서브모드 | order 12는 §6.3 `fit_dissonance_check.py`의 `auto_scored`(289) 집계에서 제외 |
| **규범 문서 4종 개정 확인(신규)** | `ui/soul.md`, `ui/DESIGN-SOUL.md`, `plan/kiwoom-common-screen-brief.md`, `plan/kiwoom-common-screen-handoff.md`의 git 커밋 이력에 §9.2.2 선결조건 커밋이 존재하는지 확인 | G001.5 착수 전 4건 모두 확인되지 않으면 착수 차단 |

---

### 9.10 다른 권위 문서와의 ADR 대가 기록 (신규 — contract BLOCKER 해소)

§9.2에서 예고한 대로, `ui/soul.md` 하나만 개정하고 끝내지 않는다. 이 팝업은 **동등한 권위를 가진 두 문서**를 정면으로 뒤집으므로 같은 형식(원문 인용 → 판정 → 대가)으로 ADR을 남긴다. 아래 텍스트를 그대로 해당 문서에 삽입한다.

**`plan/kiwoom-common-screen-brief.md`에 삽입할 ADR 각주**

> **ADR 각주 — Order Popup 이탈 (2026-08-16)**
> `Required product result` bullet 1("Deliver one minimal shared canvas shell... that supports: ... guarded action/workflow state...", `:20-27`)과 invariant 6("One shared canvas and reusable state primitives cover the operation surface", `:52`)은 order 12개 TR을 공통 캔버스 셸 **안에서** guarded action state로 다룰 것을 요구한다. `plan/kiwoom-common-template-fit-dissonance-plan.md` §9는 이 12개를 공통 캔버스 IPC 경로 밖의 독립 팝업 창으로 뺀다. **지불하는 대가**: (1) "one minimal shared canvas shell"의 "one"이 더 이상 UI 표면 전체를 의미하지 않고 "query/websocket/oauth 289개의 공유 표면"으로 축소 해석된다 — 이 재해석 자체가 다음 invariant 감사에서 재검토 대상이다. (2) `ScreenDefinition`/`ScreenDocument` 계약(§6.1-6.4)은 order 12개에도 그대로 적용되어 데이터 계약 레벨의 "one shared contract"는 유지된다 — 깨지는 것은 렌더링 경로뿐, 계약은 아니다.

**`plan/kiwoom-common-screen-handoff.md`에 삽입할 ADR 각주**

> **ADR 각주 — Order Popup 이탈 (2026-08-16)**
> §4(`:86-104`)의 3-canvas 결정은 "Schema-driven Request Sheet"(`:98-99`)에 "주문 draft/review/confirm"을 명시적으로 포함시켰다. `plan/kiwoom-common-template-fit-dissonance-plan.md` §9는 주문을 이 캔버스에서 빼 별도 팝업 창으로 이전한다. **지불하는 대가**: (1) Schema-driven Request Sheet의 실제 사용 범위가 "조회 입력 171개 + OAuth 2개"로 축소되어, 원래 문서가 이 캔버스에 부여한 3가지 책임(조회 입력/구독 제어/주문·OAuth lifecycle) 중 주문 책임이 이관된다. (2) 팝업이 재사용하는 6프리미티브·`ScreenDocument.state` 계약(§9.4, §9.6)은 이 문서의 최소 공통화면 결정과 여전히 정합한다 — "캔버스가 아닌 창"으로 옮겨간 것은 배치(placement)이지 계약(contract)이 아니다.

이 두 각주는 §9.2.2 선결조건 3·4의 완료 형식이다 — G001.5 착수 전 실제로 두 파일에 삽입돼야 한다.

---

### 9.11 G 스토리 반영

| 스토리 | 추가되는 것 |
|---|---|
| **선결조건(신규, G001.5 이전)** | §9.2.2의 4개 문서 개정(soul.md/DESIGN-SOUL.md/brief.md/handoff.md) 완료. §9.9 "규범 문서 4종 개정 확인" 자동 게이트가 이를 강제 |
| **G001.5** | Paper artboard에 "16 · 주문 팝업" 보드 신설(§9.6) — 3계열(신규/정정/취소) 구조 + draft/review/confirm/committed/receipt 5상태 + in_doubt/timeout/rejected 3종 실패 variant. `§4.2` 아트보드 표의 "14.5" 행에서 주문 관련 문구 제거. 이질감 채점 모수 301→289 반영(§9.7 치환 1), order 12는 이 게이트의 fit 채점에서 제외하고 §9.7 체크리스트로 별도 추적 |
| **G002** | **301개 `ScreenDefinition` 생성은 불변**(order 12 포함, §9.6) — 팝업은 생성 레이어가 아니라 `resolver.py` 런타임 dispatch에서만 갈라진다(§9.6, 인용 정정: `plan/kiwoom-optimal-screen-selection-rendering-plan.md §9.1`, 구 "§6.2" 인용 오류 정정). `§5.2` fallback shape 표의 `order→action+status+order_receipt` 항목을 팝업 내부 구성 규칙으로 재배치 |
| **G003** | 공통 캔버스 6프리미티브 렌더러 구현과 **병행 트랙**으로 주문 팝업 렌더러(`app/order-popup.html/js`)를 구현하되, **신규 렌더러를 만들지 않고** `action-section.js`/`status-section.js`/`order-receipt-section.js`/`format-cell.js`를 import한다(§9.6 — contract MAJOR 해소). 캔버스 primitive 수는 늘지 않음 |
| **G004** | "Electron IPC/backend 통합" 스토리의 실질 내용이 바로 이 절 — `app/order-preload.js`(신규 contextBridge 1호 사례) + IPC allowlist(5개 채널) + 마젠타 억제 브로드캐스트(2채널, 별도 집계) + 자격증명 데이터플로우(§9.3.0) + `scripts/dev-start.*`(신규, 프로세스 간 env 공유)가 이 스토리의 완료조건에 편입 |
| **G005** | 전수 검증(289 기준, §9.7 치환)에서 order 12를 제외하고, §9.7 체크리스트 8항목을 별도 완료조건으로 추가. `data-field-id`/`data-section-id` sentinel(§6.1) 방법론은 order 팝업에도 동일 적용(팝업도 캔버스 컴포넌트를 재사용하므로) |
| **G007** | Closeout 체크리스트에 (a) 규범 문서 4종 개정 완료 여부(§9.2.2, §9.10), (b) 싱글턴/confirm-강제종료차단/자격증명 정적 스캔 3종(§9.9) 통과 여부, (c) §9.7 치환 4건이 실제 문서에 반영됐는지, (d) LOC 예산이 `app/order-*.js`·`app/styles/order-popup.css`를 포함해 재산정됐는지(§9.7 치환4) 확인 항목 추가. live order 0건 유지 재확인(§9.9)이 기존 "비목표" 항목과 함께 재검증 |

---

## 10. 설정 창 (Settings Window) — 독립 창

> **⚠ 폐기 고지 (2026-08-18 삽입)** — 이 절이 설계한 **설정 독립 창(`settingsWin`)은 삭제됐고
> 폐기가 정본이다.** 브랜치 병합(2026-08-17, `plan.md` 병합 판단 1·3)에서 `app/settings.*`
> 4파일을 삭제했고, 설정은 대화 창의 `#settings` 모드로 옮겨졌다. 주의: 아래 §10.2의 v8 정정
> 블록이 근거로 삼은 `GLOSSARY.md` §1 "일시 표면" 구분 **자체도 이후 폐기됐다** — 현행
> `GLOSSARY.md` §12는 "설정창" · "팝업창" · "일시 표면" 셋 다 폐기어로 지정한다. 즉 v8 정정도
> 다시 낡았다. 본문의 IPC · API 매핑은 어느 표면이 어느 엔드포인트를 부르는지에 한해 참고
> 가치가 있다. 정본은 `GLOSSARY.md` §1.

> 반영 지시(v6, 최초): "계좌 설정 같은건 설정 창에서 따로 하게 만들어줘. 채팅창에 동그란 원이있던데 그거 누르면 설정창으로 들어가게 만들어줘"
> 반영 지시(v7, 뒤집음): "설정 창은 대화창의 ●을 누르면 앱 관련 설정이 뜨는 별도의 창이다."
> **개정 기록**: v6은 이 지시를 "설정은 대화 창의 확장 상태"(리사이즈 문법 재사용, 창 2개 유지, 구 §10.2)로 설계했다. **사용자가 이 설계를 뒤집었다** — 설정은 자기 `BrowserWindow`를 갖는 독립 창이다. v7은 이 결정을 그대로 실행한다. 진입점(대화 창 dot)은 v6과 동일하게 유지된다.

### 10.1 결정과 근거

| 근거 축 | 내용 |
|---|---|
| 사용자 지시 | 원문 그대로 채택(v7) — 설정은 대화 창 dot을 누르면 뜨는 **별도의 창** |
| 진입점 | `app/chat.html`의 `#dot`(12px 마젠타 원) 클릭 → `athena:open-settings` IPC → main이 설정 창을 생성하거나(없으면) 포커스한다(있으면). dot의 기존 두 역할 — (1) 상태 표시기 idle/judging/calling, `setDot()`(`app/chat.js:125-128`), (2) 캔버스 확장·수축 원형 클립 애니메이션의 기하 원점, `getDotScreenPoint()`(`app/main.js:138-144`) — 은 그대로 유지되고, 세 번째 역할(설정 창 열기)만 얹는다 |
| 정당화 | `ui/DESIGN-SOUL.md:144` "한 화면에 마젠타는 한 곳. 그 하나가 '지금 여기'" — 마젠타는 dot 하나에만 남는다. 설정 창 안에는 마젠타를 쓰지 않는다(§10.7) |

### 10.2 창 정책 — 규범 이탈 2건째 (정직하게 기록한다)

> ### ⚠ 2026-08-16 정정 — 이 절의 "규범 이탈" 판정은 과장이었다
>
> `GLOSSARY.md` §1(저장소 표준 어휘)이 이미 이 문제를 해결해두었다. 이 절을 쓸 때 `GLOSSARY.md`를 읽지 않아 생긴 오류다.
>
> | GLOSSARY.md §1이 정한 것 | 내용 |
> |---|---|
> | **상시 창**(창 개수에 센다) | 대화 창, 캔버스 창 — 2개 |
> | **일시 표면**(창 개수에 **세지 않는다**) | **설정창, 팝업창(=주문 창)** — 이미 등록된 용어 |
> | 근거 | "`ui/soul.md` §3의 '창은 두 개뿐이다'와 §8 탈락 조건의 '창이 셋 이상이다'는 **상시 창** 기준이다." `ui/soul.md:52`가 이미 "'모델 바꿔줘'라고 치면 모델 창이 뜬다"로 일시 표면의 존재를 전제한다 |
> | 설정창 진입로 | "① **대화 창의 빨간 점멸을 누른다** ② 커맨드바에 자연어로 부른다" — 구현된 것과 일치 |
>
> **따라서 주문 팝업도 설정 창도 규범 이탈이 아니다. 원래 어휘에 등록된 일시 표면이다.**
> 아래 본문의 "의도적 이탈", "1건째/2건째", "즉시 탈락 대상" 서술과 그에 딸린 `soul.md`/`DESIGN-SOUL.md` 개정 선결조건은 **철회한다.** 남는 선결조건은 규범 개정이 아니라 **사실 갱신** 하나뿐이다 — `GLOSSARY.md` §1의 "현재 코드에 일시 표면은 0건이다"가 설정 창 구현으로 stale이 되었으므로 상태표를 갱신한다(2026-08-16 반영 완료).
> 단, `GLOSSARY.md` §1이 요구하는 **"설정은 커맨드바로도 반드시 도달할 수 있어야 한다"**는 실제 미구현 결함이었고 `app/chat.js`의 `SETTINGS_COMMAND`로 해소했다.


**v6 → v7 개정**: v6은 설정을 "대화 창이 커진 상태"로 설계해 4번째 창을 만들지 않는다고 판정했다(`ui/DESIGN-SOUL.md:92-94,104`의 리사이즈 문법 재사용 근거). **사용자가 이 설계를 뒤집었다.** v7은 설정을 독립 `BrowserWindow`로 만든다 — 아래는 이 결정이 어떤 규범을 얼마나 이탈하는지의 정직한 기록이다.

#### 10.2.1 규범 원문과 판정

| 문서:줄 | 원문 |
|---|---|
| `ui/soul.md:190`(§8 탈락 조건, 점수 무관 즉시 제외) | "창이 셋 이상이다" |
| `ui/DESIGN-SOUL.md:102`(축2 도출 규칙 1) | "창은 둘. **새 창을 만들지 않는다** — 있는 창이 커지고 줄어든다" |
| `ui/DESIGN-SOUL.md:92-94` | "온보딩은 세 번째 창이 아니다. 대화 창이 커진 것이다 — 이게 '창은 둘'을 깨지 않고 온보딩을 넣는 유일한 방법이다" |
| `ui/DESIGN-SOUL.md:157`(이 소울이 거부하는 것 목록) | "창을 늘리는 해결 — 이력 보기, 온보딩, **설정** 전부 기존 창으로 흡수" |

**판정**: `ui/DESIGN-SOUL.md:157`은 "설정"을 이름 대서 창으로 늘리는 해법을 이미 거부한 항목이다. 설정 창은 이 항목을 문언 그대로 위반한다. §9(주문 팝업)가 이미 `ui/soul.md:190`·`ui/DESIGN-SOUL.md:102`를 이탈해 세 번째 창을 만든 것이 **1건째 이탈**이었다(§9.2). **설정 창은 2건째 이탈**이다.

**창 총계**: 대화 + 캔버스 + 설정 = **3**(상시 존재). 주문 팝업이 동시에 열리면 **4**.

> **기록**: 설정 창은 "창은 둘"(`ui/soul.md:190`, `ui/DESIGN-SOUL.md:102`) 규범과 "설정은 새 창을 만들지 않는다"(`ui/DESIGN-SOUL.md:92-94,157`) 결정을 **의도적으로 이탈한 두 번째 창**이다(1건째는 §9 주문 팝업). "게이트"·"레이어" 같은 재명명은 쓰지 않는다 — `ui/round-1R/two-windows.md:29`("Apple 규범 2건에서 의도적으로 이탈한다. 근거와 지불 비용은 참조")가 이 코퍼스에서 세운 기록 형식을 그대로 계승한다.

#### 10.2.2 선결조건 추가 — §9.2.2 목록의 5번째 항목 (G001.5 착수 전 완료, 하드 게이트, 신설)

§9.2.2는 이미 "주문 팝업 1건 한정 예외"를 명문화하는 선결조건 4건을 갖고 있다(soul.md §8 탈락조건 개정, DESIGN-SOUL.md 축2 규칙1 각주, brief.md/handoff.md ADR 각주 — §9.2.2 항목1~4). 설정 창이 2건째 이탈이 되면서 이 "1건 한정" 예외 문구가 **2건 한정으로 다시 갱신**돼야 한다. 아래 5번째 항목이 완료되기 전에는 §9.2.2의 4건이 이미 끝나 있어도 G001.5(Paper 아트보드 작업)에 착수하지 않는다.

| # | 선결조건 | 완료 형식 | 근거 |
|---|---|---|---|
| 5(신규) | §9.2.2 항목1(`ui/soul.md:190` §8 탈락 조건의 "되돌릴 수 없는 부수효과를 갖는 확인 표면 **1건**(주문 팝업)은 예외")과 항목2(`ui/DESIGN-SOUL.md:102` 축2 규칙1의 "주문 팝업 **1건** 한정 예외" 각주)를 **"확인/설정 표면 2건(주문 팝업, 설정 창)은 예외"로 재개정**. 동시에 `ui/DESIGN-SOUL.md:157`(거부 목록 "…설정 전부 기존 창으로 흡수")에 이 절(§10.2) 인용 각주를 **신규 삽입**(§9.2.2는 이 줄을 다루지 않았다) | soul.md/DESIGN-SOUL.md 재수정 diff — §9.2.2 항목1·2와 동일 파일의 예외 카운트를 1→2로 갱신 + `DESIGN-SOUL.md:157` 각주 신설 diff | `ui/soul.md:190`, `ui/DESIGN-SOUL.md:102,157` |

**범위 밖 — 손대지 않는 것**: §9.2.2 항목3·4(`plan/kiwoom-common-screen-brief.md`의 invariant 6, `plan/kiwoom-common-screen-handoff.md`의 3-canvas 결정)는 "주문을 공통 캔버스에서 뺀다"는 §9 고유의 이탈에 대한 각주다. 설정 창은 공통 캔버스 계약을 건드리지 않으므로 이 두 문서는 재개정 대상이 아니다.

**게이트 갱신 필요(미해결로 기록)**: `§9.9`의 "규범 문서 4종 개정 확인" 자동 게이트는 아직 이 5번째 항목을 확인 대상에 포함하지 않는다 — §9 쪽 문서를 다루는 별도 작업에서 게이트 스크립트도 같이 갱신해야 한다. 이 문서 §10만으로는 §9.9의 게이트 정의를 바꿀 수 없다(범위 밖, §10.8 미해결 6 참조).

### 10.3 백엔드 현실과 설정 화면 범위 (이게 화면 범위를 결정한다)

| 사실 | 근거 |
|---|---|
| 자격증명은 `.env`/환경변수로 프로세스 시작 시에만 주입 | `backend/athena_api/config.py:24-25`(`kiwoom_app_key`/`kiwoom_secret_key`, `SecretStr`), `:16`(`env_prefix="ATHENA_"`) |
| 런타임에 자격증명을 받는 백엔드 엔드포인트가 **존재하지 않는다** | `backend/athena_api/api/__init__.py:5-20` — 등록된 라우터 6종(batch/catalog/llm_tools/oauth_status/raw/stream, TR 자동생성 `generated_router` 제외) 중 자격증명 입력 경로 없음 |
| 토큰·자격증명은 메모리 전용, 디스크 미기록 | `backend/athena_api/kiwoom/auth.py:1`(모듈 docstring "Memory-only Kiwoom OAuth token handling"), `:72-73`(`self._token`/`self._expires_at`는 인스턴스 속성일 뿐 영속화 없음), `lifespan.py:108`(`auth.clear()`, 종료 시 메모리에서 제거) |
| 자격증명 보유 프로세스 중복 실행은 파일 락으로 차단 | `backend/athena_api/process_lock.py:33-37`(락 충돌 시 "another credential-owning Athena backend is already running"), `lifespan.py:46-48`(`has_credentials`일 때만 lock 획득) |
| 상태 조회 가능 | `GET /api/v1/internal/oauth/status` → `{configured, ready, expires_at}`, 토큰 문자열 절대 미반환(`api/oauth_status.py:26-41` 응답 모델, `:56-64` 핸들러) |
| 토큰 발급/폐기 | `POST /api/v1/internal/oauth/au10001`/`au10002` — `generated/runtime.py:234-244`(`call_internal_oauth`, 로컬 bearer 필요), 자격증명 없으면 503(`dependencies.py:64-68` `require_token_manager`→`errors.py:78-80`) |
| 계좌번호는 앱 설정값이 아니다 | `athena_api/` 어디에도 계좌번호 설정 필드 없음 — 토큰에 암묵 바인딩되고 TR별 요청 필드로만 전달 |
| `kiwoom_base_url`은 사용자 편집 금지 | `config.py:41-44`(`validate_runtime_safety`) — mock 도메인 아니면 기동 자체를 막음 |

**따라서 설정 화면은 자격증명 입력 폼을 제공하지 않는다.** 대신 (a) 자격증명 설정 여부·토큰 준비 상태·만료 시각을 표시하고, (b) 토큰 발급/폐기를 제어하고, (c) 자격증명 주입 방법(`.env`)을 안내한다. 입력 폼을 만들면 저장할 곳이 없어 거짓 UI가 된다.

### 10.4 자격증명 데이터플로우 (§9.3.0과 동일 원칙 — main 프로세스 전용, 설정 창은 처음부터 안전 설정으로 태어난다)

백엔드 호출(status/token)은 여전히 **Electron main 프로세스에서만** 수행한다. `ATHENA_LOCAL_BEARER_TOKEN`과 백엔드 base URL은 main이 `process.env`에서 읽고, 렌더러에는 절대 전달하지 않는다 — 여기까지는 v6과 동일 원칙(§9.3.0 계승)이다. **달라진 것은 렌더러 프로세스 자체의 보안 설정**이다: 설정 창은 기존 대화·캔버스 창과 달리 전용 `settings-preload.js`를 통해서만 좁은 API를 노출한다.

| webPreferences | 대화/캔버스 창(기존, 미변경) | 설정 창(신규) |
|---|---|---|
| `nodeIntegration` | `true`(`app/main.js:69`) | `false` |
| `contextIsolation` | `false`(`app/main.js:69`) | `true` |
| `sandbox` | 미지정 | `true` |
| `preload` | 없음 | `app/settings-preload.js` |

§9(주문 팝업)에 이어 이 저장소에서 **두 번째로** `contextIsolation:true`+`sandbox:true`+전용 preload 조합으로 태어나는 창이다 — G004(§10.9)가 저장소 전체에 목표하는 최종 상태를, 두 표면이 먼저 선취한다.

```
app/settings.js (renderer, contextIsolation:true, sandbox:true)
  → window.athenaSettings.getStatus() / window.athenaSettings.setToken({action})
  → app/settings-preload.js: contextBridge.exposeInMainWorld(...)   ← ipcRenderer.invoke('athena:settings:*', ...)
  → app/main.js: ipcMain.handle('athena:settings:status'/'athena:settings:token', ...)   ← 실제 fetch는 여기서만
       - process.env.ATHENA_LOCAL_BEARER_TOKEN 을 여기서 읽는다 (렌더러에 절대 전달하지 않는다)
       - process.env.ATHENA_BACKEND_BASE_URL 을 여기서 읽는다 (§9.3.0과 동일 변수, 기본값 http://127.0.0.1:8010)
  ← ipcMain.handle 반환값({configured, ready, expiresAt, backendReachable}만) → app/settings-preload.js → 렌더러
```

| 규정 | 근거 |
|---|---|
| 토큰 문자열은 어떤 IPC payload로도 렌더러에 전달하지 않는다 | `oauth_status.py:8-10`(docstring "It never returns the token itself") — 백엔드 자체가 이미 이 불변식을 지킴, 설정 창 IPC도 동일하게 유지 |
| main·backend가 같은 `ATHENA_LOCAL_BEARER_TOKEN`/`ATHENA_BACKEND_BASE_URL`을 공유해야 호출 가능 | §9.3.0 규정4·§9.8 `scripts/dev-start.*`(`[측정 필요]`)와 동일 미해결 — 설정 창도 같은 신설 스크립트에 의존한다 |
| backend가 죽어 있을 때 | `backendReachable:false`로 표시, 토큰 발급/폐기 버튼 비활성화(§9.3.0 규정5의 fail-closed 원칙과 동일) |

### 10.5 IPC 채널 (기존 `athena:` 접두 규칙 계승)

| 채널 | 방식 | payload | 응답 | 비고 |
|---|---|---|---|---|
| `athena:open-settings`(신규) | send/invoke | 없음 | — | dot 클릭 트리거. 설정 창이 없으면 생성, 이미 열려 있으면 **새로 만들지 않고** `focus()`만(싱글턴) |
| `athena:settings:status` | invoke | 없음 | `{backendReachable, configured, ready, expiresAt}` | |
| `athena:settings:token` | invoke | `{action: 'issue'\|'revoke'}` | 갱신된 status(위와 동일 shape) | 부수효과가 있으므로 §10.8 확인 단계를 거친 뒤 호출 |

설정 창은 마젠타를 갖지 않으므로(§10.7) §9.8의 `athena:order-popup-open/closed` 같은 마젠타 억제 브로드캐스트가 필요 없다 — 채널 3개로 끝난다.

### 10.6 창 계약과 섹션 구성

| 항목 | 값 | 근거/상태 |
|---|---|---|
| 창 유형 | 독립 `BrowserWindow`, 단일 인스턴스(이미 열려 있으면 `focus()`, 새로 만들지 않음) | 팀리드 확정 |
| `frame` | `false` | 팀리드 확정 |
| `resizable` | `false` | 팀리드 확정 |
| `alwaysOnTop` | `true` | 팀리드 확정(대화·캔버스 창과 동일 관례, `app/main.js:63`) |
| `backgroundMaterial` | `'acrylic'` | 팀리드 확정 |
| 크기 | 720×560(레이아웃 scale 반영) | 팀리드 확정 |
| 위치 | 캔버스 영역 중앙 | 팀리드 확정 |

| 섹션 | 내용 |
|---|---|
| 계좌·인증 | 백엔드/자격증명/접근토큰/만료 상태 3행 + 토큰 발급·폐기 2단 확인 + `.env` 주입 안내 텍스트 |
| 화면 | 캔버스 자동 열기 · 대화 창 자동 성장 토글 2종 |
| 정보 | 앱 버전 · 백엔드 주소(`backendReachable` 표시) · 설계 치수 |

**설정 값 저장**: 비민감 boolean 화이트리스트(위 "화면" 섹션 토글 2종 등)만 `userData/settings.json`에 기록한다. 자격증명·토큰은 절대 기록하지 않는다 — §10.3의 메모리 전용 불변식과 정합.

### 10.7 시각 규범

| 규범 | 값/규칙 | 근거 |
|---|---|---|
| 유리 두께 | **0.97 고정**(더 이상 전이값이 아니다) — 배후가 항상 캔버스(고밀도)이므로 두껍게 | `ui/round-1R/two-windows.md:96-101` 실측: "기본(뒤=데스크톱) 다크 알파 ~0.82 / 확장(뒤=캔버스) ~0.97" — 유리 두께는 배후 정보 밀도에 **비례**해서 두꺼워진다(원문 :101의 "반비례" 표기는 §9.3.1이 이미 정정한 오기이며, 이 절도 같은 정정을 따른다). 설정 창은 항상 캔버스 영역 중앙에 뜨므로(§10.6) 확장값 0.97을 고정으로 쓴다. v6의 "대화 창 alpha 0.82↔0.97 전이"(`app/chat.js:49-52`)는 더 이상 적용되지 않는다 — 창이 두께를 전이하는 게 아니라 이미 그 값으로 태어난다 |
| 마젠타 | 설정 창 안에는 쓰지 않는다 — 마젠타는 대화 창의 dot 하나(§10.1, §10.5) | `ui/palette.md:67`, `ui/DESIGN-SOUL.md:144` |
| 오류색 | `--color-warn #ff9838` | §9.3.1과 동일 팔레트 어휘 |
| 정상색 | `--color-ok #5fce3f` | 상동 |
| TR ID 비노출 | au10001/au10002를 화면에 쓰지 않는다 — "토큰 발급"/"토큰 폐기"로만 표기 | `ui/DESIGN-SOUL.md:128-133`, §0 원칙 3 |
| 접근성 폴백 | `prefers-reduced-motion`/`transparency`/`contrast` 3종, `app/styles/access.css` 규칙 상속 | 기존 규칙 재사용, §9.3.1과 동일 원칙 |

### 10.8 상태·안전, 지불하는 대가, 미해결

**상태·안전**: 토큰 폐기는 되돌릴 수 없는 부수효과이므로 확인 단계를 둔다(주문이 아니므로 §9의 5단 상태기계까지는 아니다 — **2단 확인**). 설정 창 열기·닫기·재열기가 토큰을 발급하거나 폐기하지 않는다(§9.4 "open/refresh/retry가 주문을 실행하지 않는다"와 동일 불변식을 여기서도 적용).

| 항목 | 규칙 |
|---|---|
| 토큰 폐기 확인 | 클릭 → "정말 폐기하시겠습니까" 확인 단계 → 확정 클릭 → `athena:settings:token`(`revoke`) 호출 |
| 토큰 발급 확인 | 재발급 가능해 폐기보다 위험이 낮음 — 확인 단계 필요 여부 `[측정 필요]` |
| 설정 창 open/close/재열기 | 토큰 발급·폐기를 트리거하지 않는다 |

**지불하는 대가**

| 대가 | 설명 |
|---|---|
| 입력 폼 없음 | 계좌·앱키·시크릿키를 설정 창에서 바꿀 수 없다 — 바꾸려면 `.env` 편집 + 백엔드 재기동. "설정"이라는 이름과 실제 편집 권한이 어긋난다(§10.3) |
| 창 총계 증가(신규) | 대화+캔버스+설정=3, 주문 팝업 동시 시 4(§10.2) — "창은 둘" 규범 2건째 이탈. §10.2.2 선결조건 5건이 완료되기 전에는 G001.5 착수 불가 |
| dot 역할 3중화 | 상태 표시기 + 캔버스 확장 원점 + 설정 진입점(이제 새 창을 여는 트리거) — 클릭 판정 영역과 기존 상태색(idle/judging/calling) 표시를 동시에 유지하는 구체 방법 `[측정 필요]` |
| 보안 모델 이원화(신규) | 대화·캔버스 창(`nodeIntegration:true`, §10.4 표)과 설정 창(`nodeIntegration:false`+전용 preload)이 서로 다른 보안 모델로 공존 — G004 완료 전까지 저장소 안에 두 표준이 동시에 존재 |

**미해결**

| # | 항목 |
|---|---|
| 1 | 런타임 자격증명 주입 경로(백엔드 엔드포인트 신설 여부) — 메모리 전용 불변식(§10.3)과 충돌하므로 별도 설계 논의 필요. `.env` 편집 후 백엔드 재기동이 유일한 현재 경로 |
| 2 | "화면" 섹션(§10.6) 토글 2종(캔버스 자동 열기·대화 창 자동 성장) 외 추가 항목 여부 |
| 3 | 토큰 발급 시 확인 단계 필요 여부(§10.8) |
| 4 | dot 클릭 판정과 기존 상태 표시(idle/judging/calling)의 시각적 공존 방식 |
| 5 | `scripts/dev-start.*`(§9.8, §10.4) 신설 여부·형식 — 설정 창도 이 스크립트에 의존하므로 §9와 공유하는 미해결 항목 |
| 6(신규) | §9.9 "규범 문서 4종 개정 확인" 게이트가 §10.2.2의 5번째 선결조건(soul.md/DESIGN-SOUL.md 예외 1→2건 재개정, `DESIGN-SOUL.md:157` 각주)을 아직 확인 대상에 포함하지 않는다 — §9 문서 개정 작업에서 게이트 스크립트도 같이 갱신해야 한다(§10.2.2) |

### 10.9 G 스토리 반영

| 스토리 | 추가되는 것 |
|---|---|
| **선결조건(신규, G001.5 이전)** | §9.2.2의 4건 + §10.2.2의 5번째 항목(soul.md/DESIGN-SOUL.md 예외 1건→2건 재개정, DESIGN-SOUL.md:157 각주 신설) 완료. 두 목록 전부가 완료돼야 G001.5(Paper 아트보드) 착수 가능 |
| **G001.5** | Paper 아트보드에 설정 창 보드 신설 여부 및 상태 variant — `[측정 필요]`(§4.2 아트보드 목표 개수에 영향. 독립 창이므로 §9의 "16 · 주문 팝업"처럼 별도 보드 번호가 필요할 가능성이 높다) |
| **G003** | 설정 창 렌더러(`app/settings.js`) 구현 — v6의 "대화 창 확장 셸 재사용"은 더 이상 적용되지 않는다(독립 창이므로). 기존 6프리미티브 재사용 여부는 `[측정 필요]` |
| **G004** | `athena:open-settings`/`athena:settings:status`/`athena:settings:token` IPC 채널 3종 + main-only fetch(§10.4). **신규**: 설정 창 preload/contextBridge가 §9(주문 팝업)에 이어 이 저장소에서 두 번째로 안전 설정(`contextIsolation:true`+`sandbox:true`+전용 preload)을 갖고 태어난다 — G004의 목표 상태를 두 표면이 먼저 선취한다 |
| **G007** | Closeout 체크리스트에 설정 창 확인 항목 추가 — (a) 토큰 문자열 IPC 미노출 정적 스캔, (b) `settings-preload.js` 노출 API 화이트리스트(2함수: getStatus/setToken) 스캔, (c) `userData/settings.json`에 자격증명·토큰 미기록 확인, (d) 2단 확인 동작, (e) `backendReachable:false` fail-closed 동작 — `[측정 필요]` |

---

측정하지 않은 수치는 전부 "[측정 필요]"로 표시했다(stratified 64개(2축 55 + 3축 9)의 실제 대상 목록, WS `STRUCTURAL_MISMATCH` 정규식·임계값, 픽셀 보정 실측값, 규칙 3의 비사다리형 적용사례 수, 규칙 1/2/3/6의 반례 fixture 구체 목록, LOC 상한 실측 대조). 나머지는 팀리드·architect·critic이 제공한 수치 또는 리포지토리 실측(파일 읽기: `kiwoom-output-profile.json:3587`, `ui/DESIGN-SOUL.md:128-133`, `ui/round-1R/two-windows.md:123,132` 등)만 사용했다.

**문서 상태: 착수 가능.** §8 결정 1·2·3·5 확정. 결정 4(용량 목표)는 G007 완료조건에만 영향을 주므로 G001.5 착수를 막지 않는다. G001.5의 첫 작업은 (1) Paper MCP 재연결, (2) WS `STRUCTURAL_MISMATCH` 정규식 확정, (3) width anchor 5개 픽셀 보정이다.
