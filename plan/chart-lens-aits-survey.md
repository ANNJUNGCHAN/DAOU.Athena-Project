# 차트 렌즈 — AITS 차트 기능 실측 부록

> 기준일: 2026-08-18 · 성격: **실측 장표**(설계 아님). 차트 렌즈 계약(`plan/chart-lens-spec.md`)의
> 근거 자료다.
> 범위: 사용자 판정(2026-08-18) — "AITS가 토스증권 WTS를 따라한 것이므로 AITS 차트 기능과 동일하면
> 됨." 차트 작도(드로잉) 포함 **AITS 차트 기능 전부**를 실측한다.

---

## 0. 실측 소스 정정 (선행 경고)

작업 지시는 `docs/화면.html`(이 저장소 `AITS-화면` 안)을 상정했다. **이 파일은 이 저장소에 없다** —
`docs/` 디렉토리 자체가 이 저장소에 없고, 저장소 전체 검색(`화면.html`)도 0건이다(2026-08-18 확인).

실물은 자매 저장소 `C:\Projects\DAOU.AITradingSystem\docs\화면.html`에 있다. 이 경로는
`plan/kiwoom-common-screen-aits-coverage-audit.md` 상단 증거 고정 문구("AITS
`C:\Projects\DAOU.AITradingSystem` `release/v1.0.0` `50bb5e7`")가 가리키는 것과 동일 계열이다.
아래 실측은 전부 이 경로 기준이며, 인용마다 파일:줄을 붙인다.

화면 카탈로그 등록부(감사 §10이 말한 `js/화면-screens/**`)는
`docs/js/화면-screens/차트/차트.js`(729줄)다. 이 파일의 주석(11~13행)이 스스로 밝히듯, 이 mock은
카드 프레임만 그리고 **실제 차트 렌더는 개발 UI 컴포넌트(`ChartCard.svelte`)를 그대로 로드해
마운트한다**(`chart-embed.js` 동적 import). 따라서 "AITS 차트 기능"의 완전한 실측은 mock 카탈로그
(화면 단위·TR·트리거)와 실 컴포넌트 소스(드로잉·지표·저장) 양쪽을 봐야 한다 — 아래 §1~§2는 전자,
§3~§4는 후자다.

---

## 1. 화면 8장 — 등록부 실측

`GROUPS` 4개(주식·업종·금현물·투자자기관) × 각 자산이 [차트 카드]+[봉당 상세 카드] 2장(투자자는
[차트 카드]+[매매 표 카드])으로 등록돼 총 8장. 감사 §10의 "차트 8장" 판정과 일치한다.

| ID | 이름 | 자산 | primary TR(주기별) | 카드 형상 | 근거 |
|---|---|---|---|---|---|
| `HWA-CHT-STK` | 주식 차트 | 삼성전자(005930) | ka10081(일)·ka10082(주)·ka10083(월)·ka10094(년)·ka10080(분)·ka10079(틱) | CompoundCard(chart, 캔들) | 차트.js:478-507 |
| `HWA-CHT-STK-DETAIL` | 주식 봉당 상세 | 상동 | 상동(주기 탭 전환) | TableCard(전 필드) | 차트.js:710-727 |
| `HWA-CHT-INDS` | 업종 차트 | 코스피(지수) | ka20006(일)·ka20007(주)·ka20008(월)·ka20019(년)·ka20005(분)·ka20004(틱) | CompoundCard(chart, 에어리어) | 차트.js:509-535 |
| `HWA-CHT-INDS-DETAIL` | 업종 봉당 상세 | 상동 | 상동 | TableCard | 차트.js:710-727 |
| `HWA-CHT-GLD` | 금현물 차트 | KRX 금현물 | ka50081(일)·ka50082(주)·ka50083(월)·ka50080(분)·ka50092(당일분)·ka50079(틱)·ka50091(당일틱) — **년봉 없음** | CompoundCard(chart, 캔들) | 차트.js:538-567 |
| `HWA-CHT-GLD-DETAIL` | 금현물 봉당 상세 | 상동 | 상동 | TableCard | 차트.js:710-727 |
| `HWA-CHT-INVESTOR` | 투자자·기관 차트 | 삼성전자 | ka10060(일별)·ka10064(장중) | CompoundCard(흐름 막대+순매수 누계) | 차트.js:570-614, 705 |
| `HWA-CHT-INVESTOR-TABLE` | 투자자·기관 매매(일자별) | 삼성전자 | ka10060·ka10064(동일 TR, view로만 구분) | TableCard(2분할: 3대 주체 + 세부 주체) | 차트.js:591-604, 706 |

형상 판정: 카드 12종 초안(`plan/canvas-taxonomy.md` #1 "가격 시계열")과 감사 §5.1(차트 데이터 행)이
CompoundCard(charts)+시계열 렌즈(AT-CV-002, 2차 예약)로 이미 배정해 뒀다. 이 실측은 그 배정을 뒤집지
않는다.

---

## 2. 화면별 기능 서술 — mock 등록부 인용

### 2.1 HWA-CHT-STK / -DETAIL (주식 차트)
- intent(차트.js:489): "삼성전자(주식)의 일·주·월·년·분·틱 캔들과 거래량·거래대금·거래회전율을
  봉당 상세로. 카드 내 주기 탭으로 전환."
- 캔들 타입: `type: 'candle'`(전 주기, 차트.js:493-505).
- 틱 주기는 `live: true`(장중 실시간, 505행) — 봉 카운트 meta("마지막 봉 틱 수 · 조회 범위")도
  가진 유일 주기(504행).
- 거래회전율(`turn: true`)은 일·주·월봉에만 있다(년·분·틱은 없음, 493-502행) — turn 필드는
  자산별로 조건부라는 실측.

### 2.2 HWA-CHT-INDS / -DETAIL (업종 차트)
- intent(519행): "업종(지수)의 일·주·월·년·분·틱 종가 추이와 시고저종·거래량·거래대금을 봉당
  상세로."
- 캔들이 아니라 **에어리어(라인+그라디언트) 타입**(`type: 'area'`, 523-534행) — 주식·금현물과
  형상이 다르다. 업종은 스칼라 지수라 시가/고가/저가가 있어도 캔들 몸통이 아니라 종가선으로
  그린다는 실측(areaSVG, 차트.js:108-133).
- turn(거래회전율) 필드 없음(업종 전 주기 rawFields에 `trde_tern_rt` 부재).

### 2.3 HWA-CHT-GLD / -DETAIL (금현물 차트)
- intent(549행): "KRX 금현물의 일·주·월·분·당일분·틱·당일틱 캔들과 누적 거래량·누적 거래대금을
  봉당 상세로. 당일·틱은 장중 전용."
- 유일하게 **년봉이 없는 자산**(538행 주석 "년봉 없음") — 대신 "당일 분봉"(ka50092)·"당일
  틱"(ka50091)이라는 다른 자산엔 없는 전용 주기 2종을 갖는다(561-566행), 둘 다 `live: true`.
- 틱(ka50079)도 `live: true`(563행) — 금현물은 틱·당일분·당일틱 3주기가 장중 전용.

### 2.4 HWA-CHT-INVESTOR / -INVESTOR-TABLE (투자자·기관)
- intent(583, 601행): "삼성전자의 투자자·기관 순매수(개인·외국인·기관계 및 세부주체)를 일별·장중
  흐름 막대와 순매수 누계 타일로"(차트 카드) / "…전 주체 표로"(표 카드).
- 유일하게 **실 차트 컴포넌트를 쓰지 않는 화면**(차트.js:347-368) — flowSVG(제로 기준 그룹 막대)
  mock을 그대로 쓴다. `hydrateCharts()` 호출이 이 그룹에는 없다(등록부 707행에 `draw:
  mount(investorChartCard)`만 있고 `wrap.__init`에 embed 로드가 없음). 즉 이 실측 범위에서
  ChartCard.svelte의 드로잉·지표·저작 기능은 **주식·업종·금현물 3자산에만 적용되고 투자자·기관에는
  적용되지 않는다** — 계약 설계 시 반영해야 할 경계.
- 일별(ka10060)은 13주체(개인·외국인·기관계+세부 10종, 608행), 장중(ka10064)은 8주체(611행) —
  주체 집합이 주기마다 다르다.
- 13주체 표는 900px 카드 폭에 안 들어가 [3대 주체]+[기관 세부·기타] 2표로 쪼갠다(432-434행 주석,
  실측 근거: "13주체를 한 표에 붙이면 폭 1,176px로 카드(900) 밖으로 4열이 잘려 보이지 않았다").

---

## 3. 실 차트 컴포넌트 — 표시 계층 기능 (소스: `src/common/show-card/show-chart/**`)

§2.4를 제외한 3자산(주식·업종·금현물)의 실제 렌더는 `ChartCard.svelte`와 그 형제 파일들이다. 아래는
전부 이 컴포넌트 소스 실측이며, 화면.html의 서술 범위를 넘는다(화면.html은 "실 차트를 그대로
쓴다"고만 적었지 기능을 나열하지 않는다 — §5의 실측 불가 항목 1).

### 3.1 차트형식(모양) — 정의 12종, 선택 가능 4종
`chart-form.ts:24-36` `ChartFormKind` 12종 정의: candle·bar·line·area·heikin(하이킨아시)·
renko(렝코)·kagi(카기)·pf(P&F)·lb(삼선전환)·hollow(투명캔들)·baseline(베이스라인)·clock(역시계곡선).

드롭다운 노출은 **4종뿐**(`chart-form.ts:58-65` `CHART_FORM_DEFS`): 바·캔들·라인·영역. 주석
(63-64행): "렌코·카기·P&F·라인브레이크·하이킨아시·투명캔들·베이스라인·역시계곡선은 목록에서
제거(타입·렌더 분기·계산 모듈은 잔존 — 선택 경로만 없음)". 감사 §9의 "대안 차트형식 4종" 갭
서술과 정확히 일치 — 4는 "선택 가능한" 형식 수이지 "구현된" 형식 수가 아니다.

### 3.2 주기 — 6탭 + 분/틱 세분
`ChartToolbar.svelte:33-40` `PERIOD_TABS`: 일·주·월·년·분·틱. 분·틱은 세분 단위 드롭다운을 추가로
가진다(59-102행, `INTERVAL_OPTIONS`).

### 3.3 보조지표 — 35종 (레거시 13 + 신규 확장 22)
`chart-indicator-rows.ts:11-25` 레거시 13종: 이평선(MA)·볼린저·RSI·MACD·스토캐스틱·CCI·
Williams %R·DMI/ADX·일목균형표·일목 구름·Parabolic SAR·OBV·거래량MA.

`chart-ind-registry.ts:16-38` 신규 확장 22종(`ExtIndicatorKey`): EMA·엔벨로프·프라이스채널·
슈퍼트렌드·VWAP·AVWAP·프랙탈·ATR·볼린저%B·볼린저폭·스토캐스틱RSI·이격도·모멘텀·ROC·TRIX·
가격오실레이터·매스인덱스·거래량오실레이터·A/D라인·차이킨오실레이터·MFI·인트라데이인텐시티.

기본 표시는 이평선·거래량MA만 on, 나머지 33종은 기본 off(`chart-ind-registry.ts:90-96`
`defaultExtVisible`).

### 3.4 매물대(volume profile) — 지표 목록과 분리된 별도 토글
`ChartIndicatorPanel.svelte:126-136`: "가격대별거래량(매물대) — 가시 OHLCV 가격버킷 집계 + POC
강조", 기본 off. 위 §3.3의 35종 지표 목록과 별개 UI 요소(같은 패널의 마지막 행, ext 아님).

주의: `canvas-taxonomy.md` 카드 12종 #9 "분포"(히스토그램)가 예시 TR로 든 "ka10025 매물대집중"은
**이것과 다른 TR 기반 기능**이다 — 하나는 조회형 TR(서버가 집계해 주는 데이터), 하나는 차트
컴포넌트가 가시 구간 OHLCV를 클라이언트에서 집계하는 표시 기능이다. 계약에서 혼동하지 말 것.

### 3.5 드로잉 도구 — 7종, 큰 창(전체화면) 전용
`chart-card-types.ts:48` `DrawingType`은 `trend`(추세선)·`hline`(수평선)·`vline`(수직선) 3종만
정의하지만, 이건 **구 타입(레거시)**이다. 실제 활성 도구 세트는
`chart-drawing-tools.ts`(배럴)·`ChartDrawStyleBar.svelte:69-83`가 밝히는 **7종**이다: 추세선
(trend)·수평선(hline)·피보나치(fibo)·십자선(crosshair)·광선(ray)·사각형(rect)·타원(ellipse).
vline(수직선)은 신규 7종 목록에 없다 — 구 타입에만 존재하고 UI 진입로가 없다(실측: 코드에 vline
분기가 남아 있으나 도구 버튼 없음, `chart-card-vm.ts:312-327`의 `projectVLine`은 여전히 살아있는
사구(死溝) 코드로 보인다).

핵심 제약(`chart-drawing-tools.ts:15-16`): "**드로잉은 전체화면(큰 창)에서만 가능** — 작은
창에서는 진입 불가·UI 비노출."

개별 도형 편집·삭제는 없다 — 전체 삭제만(`ChartDrawStyleBar.svelte:85` 주석 "개별 도형 목록·편집은
제거").

### 3.6 드로잉 스타일
`ChartDrawStyleBar.svelte:15-90`: 선 색·채움 색(팔레트: 그레이스케일 1행 + 컬러 매트릭스 10열×7행
+ 커스텀 HEX 입력), 선 두께 1~4px, 선 종류(실선/파선/점선), 선 불투명도 0~100%, 채움 불투명도
0~100%. 팔레트 적용 대상은 "선 색"/"채움 색" 토글로 전환.

### 3.7 수정주가 토글
`ChartToolbar.svelte:129-137`: 원주가↔수정주가(`upd_stkpc_tp` 0/1, 서버 보정) — 토글 시 재조회.

### 3.8 줌·팬
`chart-card-vm.ts:158-202`: `zoomIn`/`zoomOut`(최소 가시 봉 `MIN_VISIBLE=5`, 우측 앵커 유지),
`panLeft`/`panRight`, `resetViewport`(더블클릭). 표시 계층 변형만 — 데이터 재조회 없음.

### 3.9 진행봉(실시간 롤오버)
`chart-card-vm.ts:211-248`: `updateLastCandle`(마지막 캔들 인플레이스 갱신, 뷰포트 불변),
`rollOverCandle`(신규 봉 push, 적재 상한 초과 시 가장 오래된 봉 drop + 드로잉 앵커 자동 보정
`_droppedCount`).

---

## 4. 저장·복원(저작 상태 영속) 실측

이 절이 스펙 §3(저작 상태 저장·복원 계약)의 직접 근거다.

| 저작 상태 | 영속 여부 | 키 | 저장소 | 근거 |
|---|---|---|---|---|
| 드로잉(7종 스냅샷) | **영속됨** | `chart.drawings.${symbol}.${period}` | SQLite `settings` 테이블(`its.db`, userData) | `settings-store.ts:37-42`, `card-chart.ts:76-103` |
| 보조지표 on/off·파라미터·색 | **영속 안 됨** — 세션/컴포넌트 상태만, 마운트 시 기본값(이평선·거래량MA만 on)으로 리셋 | 없음 | 없음 | `ChartIndicatorPanel.svelte:26-28`(로컬 `let` 상태), settings-store.ts 전체에 지표 관련 키 0건(grep 확인) |
| 매물대 on/off | **영속 안 됨** | 없음 | 없음 | `volumeProfileOn`이 상위 prop으로만 전달(`ChartIndicatorPanel.svelte:23`), 저장 호출 없음 |
| 차트형식(모양) | **영속 안 됨** — 항상 `candle`로 시작 | 없음 | 없음 | `chart-form.ts:39` `DEFAULT_CHART_FORM = 'candle'`, 저장 로직 없음 |
| 주기(일/주/월/…)·수정주가·줌뷰포트 | 영속 안 됨(의도적 — 조회 파라미터·표시 상태, 저작 아님) | — | — | 카드 재마운트마다 기본값 |

### 4.1 드로잉 영속 상세
- 스냅샷 형태(`chart-drawing-store-io.ts:23-34`): `{ lines, hlines, fibos, crosshairs, rays, rects,
  ellipses }` — §3.5의 7종 도구 각각의 배열.
- 저장 트리거: 도형이 실제로 확정되는 클릭마다 즉시 저장(`chart-drawing-store.ts:181`
  `if (created) persistDrawings(r)`) — 디바운스 없음("카드 탭 순서 영속과 동형 관례", 주석).
- 복원: 카드 마운트·종목/주기 전환 시 `loadDrawings(symbol, period)` → IPC
  `CHART_DRAWINGS_GET` 비동기 조회 → 도착 시 현재 `persistKey`와 요청 키가 일치할 때만 반영
  (레이스 가드, `chart-drawing-store-io.ts:86-97`). 저장값 없음(null)이면 빈 상태로 degrade.
- IPC 채널: `CHART_DRAWINGS_GET`(handle)·`CHART_DRAWINGS_SET`(on), `card-chart.ts:76-101`.
- 스키마 버전 필드 없음(§5 실측 불가 항목).

---

## 5. 실측 불가 항목 — 서술 부재

1. **화면.html 자체의 문서 텍스트만으로는 드로잉·지표·매물대·저장 기능을 확인할 수 없다** —
   mock은 "실 차트를 그대로 쓴다"는 주석 1줄만 남기고 기능을 서술하지 않는다(차트.js:11-13). 이
   부록의 §3~§4는 화면.html이 아니라 실 컴포넌트 소스(`src/common/show-card/show-chart/**`)를
   직접 실측해 메운 것 — 원 지시(§0)가 상정한 단일 소스로는 완결되지 않는다는 뜻이다.
2. **드로잉 저장 스키마의 버전 관리 정책** — `chartDrawingsKey` 값에 스키마 버전 필드가 없다
   (`settings-store.ts:37-42`, `chart-drawings-persist.ts`는 파싱만 하고 버전 필드를 정의하지
   않음). 향후 도구 종류가 늘어날 때(예: vline 부활) 마이그레이션 계획은 코드에 없다 — 실측 불가.
3. **매물대(POC) 계산식의 시각 세부** — "POC 강조"라는 툴팁 문구(`ChartIndicatorPanel.svelte:131`)
   외에 계산 모듈 위치를 이 실측 범위에서 특정하지 못했다(EXT_INDICATORS 22종 레지스트리에
   매물대 항목이 없다 — 별도 렌더 경로로 추정되나 파일을 특정하지 않았음).
4. **투자자·기관 화면(§2.4)에 실 차트 미적용인 이유의 설계 의도** — 코드 사실(hydrateCharts 호출
   없음)은 확인했으나, "왜 이 자산만 mock SVG로 남았는지"의 의사결정 근거 문서를 이 실측 범위에서
   찾지 못했다.

---

## 6. 소스 좌표 정본 (파일:줄)

- `C:\Projects\DAOU.AITradingSystem\docs\화면.html`
- `C:\Projects\DAOU.AITradingSystem\docs\js\화면-screens\차트\차트.js` (729줄, 화면 등록부)
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ChartCard.svelte`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\chart-card-types.ts`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\chart-card-vm.ts`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\chart-card-geometry.ts`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ChartToolbar.svelte`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ChartTypeDropdown.svelte`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ChartIndicatorPanel.svelte`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ChartDrawStyleBar.svelte`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\ma-config.ts`
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\trend.ts` (+ trend-*.ts 5개)
- `C:\Projects\DAOU.AITradingSystem\src\common\show-card\show-chart\oscillators.ts` (+ osc-*.ts 5개)
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-form.ts`
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-indicator-rows.ts`
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-ind-registry.ts` (+ -osc/-overlay)
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-drawing-tools.ts` (배럴)
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-drawing-store.ts`
- `C:\Projects\DAOU.AITradingSystem\src\renderer\shared\vm\chart-drawing-store-io.ts`
- `C:\Projects\DAOU.AITradingSystem\src\infra\storage\settings-store.ts`
- `C:\Projects\DAOU.AITradingSystem\src\main\handlers\card-chart.ts`

교차 참조(이 저장소 `AITS-화면`): `plan/kiwoom-common-screen-aits-coverage-audit.md` §5.1·§5.2
G1·§9(line 182)·§10, `plan/kiwoom-common-screen-spec.md` §9(line 260-267), `plan/canvas-taxonomy.md`
(카드 12종 표).

---

## 부록 C — 2026-08-18 2차 실측 (차트 툴바 크롬 · 호가창 · 매물대 렌더)

카드 템플릿 라운드에서 추가 실측한 사실. 전부 코드 인용, 추측 없음.

### C.1 차트 카드 툴바 (`ChartToolbar.svelte` L43-148, `ChartCard.svelte`, `ChartStage.svelte` L38-61)

상단 1줄(`justify-content:space-between`), 좌→우:
1. **주기 탭** — 일/주/월/년/분/틱 버튼군(`PERIOD_TABS` L33-40, 드롭다운 아님)
2. **분/틱 세분 드롭다운** — 해당 주기일 때만 표시
3. **아이콘 액션 그룹**: 차트모양 `▦ ▾`(타입 12종 정의, **드롭다운 노출 4종 전부 구현** — §2 및 3차 실측 정정, 렝코/카기/P&F 입력 UI는 잔존하나 도달 불가) → 보조지표 `∿ ▾`(2단 패널: 좌 상단/하단 지표 토글 리스트 + 우 설정) → 구분선 → 수정주가 토글 → 전체화면 `⛶`/`✕`
4. **드로잉 툴바는 전체화면에서만** — 차트 캔버스 **좌측 세로 아이콘 바 42px**(`.chart-drawbar`), 7종(십자선·추세선·광선·수평선·사각형·타원·피보나치)

**매물대 토글은 툴바가 아니라 보조지표 패널 안 맨 아래 별도 행**(`ChartIndicatorPanel.svelte` L126-136).
라벨 "매물대", title "가격대별거래량(매물대) — 가시 구간 거래량을 가격대로 집계, POC 강조", 기본 off.

### C.2 매물대 렌더 (`ChartStage.svelte` L65-77·165-188)

가격 pane 우측 오버레이: `top:0; right:0; width:34%; height:100%; pointer-events:none`.
버킷 막대 우측 정렬, 색 `rgba(138,63,252,0.22)`(라벤더 반투명), **POC만 `rgba(220,0,4,0.34)`** 강조.

### C.3 차트 본체 (`chart-core.ts`, `chart-series-setup.ts`)

배경 transparent(카드 위) · 그리드 `rgba(120,128,140,0.12)` · 크로스헤어 `rgba(120,128,140,0.6)` ·
**가격축 우측**(`rightPriceScale`만 설정) · **거래량은 pane 1 하위 패널**(HistogramSeries, 가격 pane 0과 분리) ·
캔들 몸통·테두리·꼬리 전부 PRICE_UP/DOWN(꽉 찬 캔들). 다크 토큰 `--up:#ff5c5c`/`--down:#4d9fff`
(bar alpha .22) — Athena 토큰과 동일.

### C.4 호가창 (`show-orderbook/Orderbook.svelte`)

- **10단, 매도 위·매수 아래**, 중앙 구분 행 없음. 현재가는 히어로 영역(큰 글씨 + ▲▼ 등락률) + 해당 단계 행 `.ob-cur` 테두리 강조(`border:1.5px solid currentColor`)
- 행 grid `1fr 84px 1fr`, 높이 22px:
  매도 행 [잔량막대+잔량(우정렬)]—[가격(중앙, 파랑)]—[델타/빈칸] · 매수 행 [델타/빈칸]—[가격(중앙, 빨강)]—[잔량막대+잔량(좌정렬)]
- **잔량 막대**: 매도 `right:0` 기준 파랑, 매수 `left:0` 기준 빨강 (다크: rgba alpha .22)
- 가격 셀 배경 `--k-panel2`, 총잔량 행("매도 합계/매수 합계") 상단 구분선, 델타 컬럼은 ka10004 정본만
- 컬럼 헤더 행은 컴포넌트에 존재하지 않음(실측 — 헤더 없는 그리드)

### C.5 템플릿 카탈로그 반영 결정 (2026-08-18)

- 매물대는 독립 차트가 아니라 **캔들 템플릿의 보조지표 옵션**으로 표현한다 (사용자 추정 실측 확인).
- 호가 표현은 심도 곡선이 아니라 **AITS 10단 사다리 형식**을 기본으로 한다.
