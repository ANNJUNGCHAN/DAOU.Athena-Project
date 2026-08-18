# 차트 카드 컨트롤 스펙 — 전수 실측

최종 갱신: 2026-08-18 · 브랜치: AITS-화면
출처: AITS 자매 저장소(`C:\Projects\DAOU.AITradingSystem`) 코드 3차 실측. 전 항목 파일:줄 인용.
관계 문서: [`chart-lens-spec.md`](chart-lens-spec.md)(렌즈 계약) · [`chart-lens-aits-survey.md`](chart-lens-aits-survey.md)(1·2차 실측) · [`athena-card-templates.md`](athena-card-templates.md)(템플릿 카탈로그)

차트 카드는 하는 일이 가장 많은 카드다. 이 문서는 **컨트롤 하나하나가 정확히 무엇을 하는지**를
코드 실측 값으로 고정한다. Athena 구현 라운드는 이 문서를 계약 기준으로 쓴다.

> **정정(2026-08-18 3차 실측)**: 이전 실측의 "차트형식 9종 정의·미구현 준비중 배지"는 현재 코드와
> 불일치. `CHART_FORM_DEFS`는 **4종만 노출**하며 전부 구현 상태다(준비중 배지 도달 불가).
> 렌코·카기·P&F·라인브레이크·하이킨아시·투명캔들·베이스라인·역시계는 타입·계산 모듈만 잔존,
> 선택 경로 없음 (`chart-form.ts:58-65` 주석 명시).

---

## 0. 툴바 한눈에

카드 상단 1줄, 좌→우 (`ChartToolbar.svelte:43-148`):

```
[일 | 주 | 월 | 년 | 분 | 틱]  [세분▾(분·틱만)]        [▦ ▾]  [∿ ▾]  │  [수정주가]  [⛶]
 주기 탭                        분/틱 세분              차트모양  보조지표   수정주가    전체화면
```

드로잉 툴바는 여기 없다 — **전체화면 전용, 차트 좌측 세로 아이콘바 42px** (§5).

---

## 1. 주기 탭 · 분/틱 세분

- 탭 6개 고정 순서: **일 · 주 · 월 · 년 · 분 · 틱** (`PERIOD_TABS`, `ChartToolbar.svelte:33-40`)
- 세분 드롭다운은 **분·틱에서만** 나타난다 (`hasInterval`, `chart-interval-vm.ts:25-27`)
  - UI 노출 세분: 분 = `1·3·5·10·30`, 틱 = `1·5·10` (`INTERVAL_OPTIONS`, :42-45)
  - 키움 전체 도메인(검증 기준, UI 밖 포함): 분 `1·3·5·10·15·30·45·60`(ka10080), 틱 `1·3·5·10·30`(ka10079)
  - 기본 세분: 분=1, 틱=1. 라벨 "3분"/"5틱", 세분 1은 명령 토큰 "분"/"틱" 폴백 (:48-75)

## 2. 차트모양 `▦ ▾`

드롭다운 노출 **4종 전부 구현** (`CHART_FORM_DEFS`, `chart-form.ts:58-65`):

| key | 라벨 | title(툴팁 원문) |
|---|---|---|
| bar | 바 | OHLC 바차트 — 시·고·저·종(원본 OHLC) |
| candle | 캔들 | 캔들스틱 — 양봉 빨강·음봉 파랑(원본 OHLC) |
| line | 라인 | 라인 — 종가만 잇는 선 |
| area | 영역 | 영역 — 종가선 아래를 채운 면적 차트 |

- 타입 정의는 12종(`ChartFormKind`, :24-36: candle/bar/line/area/heikin/renko/kagi/pf/lb/hollow/baseline/clock)이나 **선택 경로는 4종뿐**.
- 잔존 코드의 입력 UI(도달 불가): 렝코·P&F "박스 크기(원)"(0/빈값=평균가 0.5% 자동) · 카기 "반전 폭(원)"(자동=1%) · 역시계 "이평기간(일)" 기본 5 (`ChartTypeDropdown.svelte:42-74`, 기본값 `ChartCard.svelte:63-64`).
- Athena 계약: 확장 형식을 되살릴지는 구현 라운드 결정 사항 — 계약 1판은 노출 4종을 따른다.

## 3. 보조지표 `∿ ▾` — 35종 전수 (레거시 13 + 확장 22)

2단 패널: 좌 토글 리스트("상단 지표"/"하단 지표" 섹션) + 우 설정 패널. **맨 아래 별도 행 = 매물대 토글**(§4).
기본 on은 **이평선(ma)·거래량MA(volMa) 둘뿐**, 나머지 33종 전부 기본 off (`DEFAULT_INDICATOR_VISIBLE`, `chart-ind-registry.ts:91-96`).

### 3.1 레거시 13종 (`chart-indicator-rows.ts:11-25`)

상단(가격 오버레이) 5: 이평선(5/10/20/60/120) · 볼린저(20·2σ) · 일목균형표(9/26/52·시프트26, 5선) · 일목 구름(선행스팬1·2 채움, 상승 빨강·하락 파랑) · Parabolic SAR(AF 0.02·0.02·0.2)
하단(별도 패널) 8: 거래량MA(5/20/60/120) · RSI(14) · MACD(12/26/9) · 스토캐스틱 Slow(14/3/3) · CCI(20, ±100 기준선) · Williams %R(14, −20/−80) · DMI/ADX(14, 추세강도 25) · OBV(누적 거래량)

### 3.2 확장 오버레이 7종 (`chart-ind-registry-overlay.ts:28-111`)

| 지표 | 파라미터(기본값) |
|---|---|
| 지수이평선 EMA | 라인별 기간 5/20/60/120 (min 1) |
| 엔벨로프 | period 20 · pct 10% (step 0.1) |
| 프라이스채널 | period 20 |
| 슈퍼트렌드 | ATR period 10 · mult 3 (step 0.1) |
| VWAP | 없음(세션 누적) |
| 고정 VWAP | anchor 인덱스 0 |
| 윌리엄스 프랙탈 | 좌우 봉수 n=2 |

### 3.3 확장 오실레이터 15종 (`chart-ind-registry-osc.ts:18-200`)

| 지표 | 파라미터(기본) · 기준선 |
|---|---|
| ATR | 14 |
| 볼린저 %B | 20 · 2σ · guides 1/0 |
| 볼린저 밴드폭 | 20 · 2σ |
| 스토캐스틱 RSI | rsi14 · stoch14 · K3 · D3 · guides 80/20 |
| 이격도 | 20 · guide 100 |
| 모멘텀 | 12 · guide 0 |
| ROC | 12 · guide 0 |
| 트릭스 | 18 · guide 0 |
| 프라이스 오실레이터 | 10/21 · guide 0 |
| 매스 인덱스 | sum10 · ema9 |
| 볼륨 오실레이터 | 5/10 · guide 0 |
| AD 라인 | 없음 |
| 체이킨 오실레이터 | 3/10 · guide 0 |
| MFI | 14 · guides 80/20 |
| 일중 강도 | 없음 |

## 4. 매물대 (보조지표 패널 맨 아래 토글)

`chart-volume-profile.ts` — **독립 차트가 아니다.**

- 버킷 수 **24** 고정 (`VOLUME_PROFILE_BUCKETS`, :46)
- 구간 = 적재된 캔들 전체의 min low ~ max high (:69-78)
- 배분 = **종가 기준 단순 배분** — 각 봉 거래량 전량을 종가가 속한 버킷에 합산 (고저 균등배분 아님, :81-103)
- POC = 최대 거래량 버킷, 동률이면 최저가 쪽 (:105-116)
- 렌더 = 가격 pane 우측 34% 폭 절대배치 수평 히스토그램, `pointer-events:none`.
  일반 막대 `rgba(138,63,252,0.22)` · **POC만 `rgba(220,0,4,0.34)`** (`ChartStage.svelte:66-77`, :172)
- 경계: 빈 rows→빈 프로파일 · 가격범위 0→단일 버킷 · 종가=최고가→마지막 버킷

## 5. 드로잉 7종 (전체화면 전용)

게이트: `canEnterDrawing(fullscreen) = fullscreen === true` (`chart-trendline.ts:41-43`). 작은 카드엔 진입 경로 자체가 없다.
좌측 세로 아이콘바 42px, 정의 순서 (`ChartStage.svelte:27-35`):

| 도구 | 동작 |
|---|---|
| 십자선(근사) | 1클릭 확정 — 라이브러리 제약으로 수평선만, 수직선 생략 |
| 추세선 | 2클릭(첫 점 후 실시간 미리보기) |
| 광선 | 2클릭(시작→방향), 차트 끝까지 외삽 |
| 수평선 | 1클릭 — 해당 가격 전폭 수평선 |
| 사각형(근사) | 2클릭(대각 모서리) |
| 타원 | 3클릭(장축 양끝 → 단축 반경) |
| 피보 | 2클릭(고/저) → 0 / 23.6 / 38.2 / 50 / 61.8 / 100% |

- **좌표계는 데이터 좌표(time, price)** — 주기 전환·줌과 함께 이동, 화면 px 아님
- 스타일(`DrawStyle`): lineColor · lineWidth(1~4) · lineStyle(solid/dashed/dotted) · fillColor · fillOpacity · lineOpacity. 기본 `#2962ff / 2 / solid / fill 0.2` (`chart-drawing-style.ts:26-45`)
- 저장: 키 `chart.drawings.{symbol}.{period}` (SQLite settings-store, 예: `chart.drawings.005930.D`),
  스냅샷 `{lines, hlines, fibos, crosshairs, rays, rects, ellipses}` JSON 문자열, IPC `CHART_DRAWINGS_GET/SET`
- 전체화면 복귀 시 진행 중 미완성 점은 폐기, 저장된 목록은 보존 (`resetOnFullscreenExit`)

## 6. 수정주가 토글

`chart-adjusted-vm.ts`:
- 라벨: on="수정주가" / off="원주가". **기본 on** (`DEFAULT_ADJUSTED = true`, 증권사 관례)
- 서버 파라미터 `upd_stkpc_tp` 0(원)/1(수정) — 키움 ka10079~83·ka50079~83
- 토글 즉시 재조회: `CHART <종목> <주기토큰> <수정|원>` 명령 재제출 — **클라이언트 보정 계산 없음**, 서버가 보정 시계열을 준다 (`ChartCard.svelte:242-247`)

## 7. 전체화면 `⛶` / 복귀 `✕`

`ChartCard.svelte:192-197, 346-357`:
- 진입: `.chart-body.fullscreen` = `position:fixed; inset:0; z-index:9999` — 화면 전체 점유. 차트 min-height 바닥(400px) 해제
- **전체화면에서만 나타나는 것**: 드로잉 세로 툴바(§5) + 드로잉 스타일 바(`ChartDrawStyleBar`)
- 복귀: 드로잉 모드 강제 종료(미완 점 폐기) + `lwc.resize()` 재측정
- 버튼: `⛶`(title "크게 보기") ↔ `✕`(title "복귀")

## 8. 크로스헤어 수치조회창 (호버)

`chart-datawindow.ts`, `ChartLegendFoot.svelte`:
- 기본 노출 필드는 **시·고·저·종 4개뿐** (`DEFAULT_DATAWINDOW_FIELDS`, :129) — 나머지는 설정에서 추가
- 추가 가능 전체: 대비(부호가격+부호%) · 량 · 거래대금/회전율(일·주·월·년봉만) · 활성 지표 값들(MA{n}·볼상/중/하 · 일목 5선+구름A/B · SAR · OBV · RSI · MACD/SIG/HIST · %K/%D · CCI · W%R · ±DI/ADX · V{n})
- 색: 고=상승색, 저=하락색, 종/대비/HIST=등락색. 시간 포맷: 일봉류 'YYYY-MM-DD', 분 'MM/DD HH:mm', 틱 '틱 N'
- 상시 이평 범례(호버 무관): "종가 단순" + 5/10/20/60/120 색상칩. 하단 풋: "{주기}봉 · {count}봉"

---

## 9. Athena 계약 접점

- 위 전부가 **CompoundCard(charts) 1종 위의 파라미터**다 — 카드 신설 없음 (chart-lens-spec §4).
- 저작 상태 영속: AITS는 **드로잉만** 종목×주기 영속(§5). Athena 계약은 지표 on/off·파라미터,
  차트형식, 매물대 토글까지 **4종 전부** 종목×주기 키로 확장한다 (chart-lens-spec §3 — 신규 결정, AITS 갭 승계 안 함).
- 진입 이중화: 질의 기반("볼린저 얹어줘" → 지표 토글 on) + 수동(툴바) — 같은 상태를 조작한다.
- 수정주가 기본값(on)과 세분 도메인(키움 SSOT)은 Athena도 그대로 따른다.

## 10. 미해결 (구현 라운드 소관)

- 확장 차트형식 8종(렝코·카기 등) 부활 여부 — 계산 모듈은 AITS에 잔존, UI 선택 경로만 없음.
- 크로스헤어 십자선의 수직선 생략(라이브러리 제약)을 Athena 렌더러에서 해소할지.
- 매물대 종가 단순 배분(고저 균등배분 아님)의 정밀도 개선 여부 — AITS 방식 그대로가 1판 기본.
