# Athena 진행 상황 및 재개 계획

> 최종 갱신: 2026-08-19 (3차 병합 — `그래프` 채팅→LadybugDB 성향 파이프라인 합류:
> gap 2건 폐쇄·ADR 게이트 G005 완성·Open WebUI 방식 로그 관리. 직전 2차 병합은
> main 7차 능동 에이전트 P0~P4 + 디자인 8~10차 리퀴드 글래스·커맨드 카드·글자 크기.
> §1 첫 블록이 병합 재실측) · 브랜치 `main`
>
> 아래는 그 이전 상태다 — **`디자인` 브랜치 병합 완료.** 두 갈래가 합류했다:
> ① 전 구간 지연 최적화(합의 계획 `.omc/plans/plan-latency-optimization.md`) — 진단 보고서는
> [`plan/latency-audit-2026-08-19.md`](latency-audit-2026-08-19.md), "백엔드가 느리다"는
> 전제가 반증됐다(백엔드 몫 0.2초, 병목은 모델 왕복). ② 디자인 갈래(디자인 비판 →
> 후속 8결정 → 휘도 감지-적응, 디자인 4~7차). 2026-08-18 작업 브랜치 4종 병합 이력은 §1 참조.
>
> **다음 세션은 이 파일부터 읽는다.** 여기에는 *지금 상태 / 검증된 사실 / 다음 수*만 적는다.
> 설계 근거와 함정 목록은 [`plan/00-인수인계.md`](00-인수인계.md)에 있다. 중복하지 않는다.
> 키움 공통화면 Ultragoal만 이어받는다면 [`plan/kiwoom-common-screen-handoff.md`](kiwoom-common-screen-handoff.md)로 바로 간다.

---

## 0. 30초 요약

키움 REST 백엔드 위에 **① MCP 게이트웨이 ② 투자 브레인(그래프) ③ LLM API 셀렉터 ④ Electron 두 창 셸**을 얹는 중이다.
네 갈래 모두 **골격은 동작**한다. 미완은 **셀렉터 정확도(테스트 22건 실패)**, **CLI 연동**, **감시 에이전트**, **브레인의 FastAPI 결선**이다.

---

## 1. 실측 상태

> **현행 수치는 바로 아래 첫 블록(2026-08-19)이다.** 이후 블록들은 날짜가 박힌
> 스냅샷이고 어떻게 여기까지 왔는지를 남기려고 보존한다 — **인용하지 마라.**

> **갈래 주의**: 2026-08-19 `디자인` 브랜치가 `main`에 병합됐다. 아래 스냅샷의 차수
> 번호는 **갈래별로 독립**이다 — `main` 갈래(4차 키움·5차 지연)와 `디자인` 갈래
> (4차 리사이즈~7차 휘도)가 같은 날짜에 병렬로 진행됐다. 병합 직후 재실측이 맨 위다.

**2026-08-19 (창 이동 표준화) · 커서 폴링 드래그 → 네이티브 캡션 전환 후 재실측 — 이 수치가 현행이다:**

```
app: npm test → 220건 통과 · npm run verify → 검증 1~19 전 단언 통과
     검증11 재정의(창 이동 표준화): 옛 채널 거부·크기 불변·캡션/구멍 CSS 계약·
     짝 팔로우(+60,+40 외부 이동을 캔버스가 정확히 추종 후 복귀) 9단언 통과
변경: 본문 드래그 폐기(텍스트 선택 복원) → 손잡이는 **두 창 공통 맨 위 32px
     타이틀바**(-webkit-app-region, 같은 날 사용자 지적으로 컨트롤 스트립 캡션
     제거·보이는 크롬으로 개정 — Codex 상단 띠 참조). 이동은 OS(DWM) 수행 —
     가장자리 끌기 스냅 신설. 드래그 시 창 짝은 한 몸(정착 팔로우, 두 창 헌법 유지).
     휘도 적응 계단화: 사용자 보고 "투명도가 막 바뀐다" → 3계단×3연속(6초) 체류
     스테퍼로 전환(backdrop-luma createBrightnessStepper, 단위 테스트 4건 — 220→224).
     근거: ui/round-1R/two-windows.md 정정 5(개정). backend 무접촉.
```

**2026-08-19 (3차 병합) · `그래프`(채팅→그래프 파이프라인) → `main` 병합 직후 재실측:**

```
backend: 835 passed, 0 failed (loadgroup 60.8초 · 771 + brain·logging 계열 +64) ·
         ruff clean · generate --check current · 오퍼레이션 계약 319 → 325(brain 6라우트,
         LLM 비노출 — 셀렉터 표면은 여전히 4툴)
app:     npm test → 220건 통과, fail 0 (198 + history-sink 9·history-badge 7·리셋 배선 5 외)
         npm run verify → 검증 1~19 전 단언 통과 · exit 0
           검증17 능동 턴·주문 티켓(main) · 검증18 캡처 신뢰성(디자인) ·
           검증19 "기록 안 됨" 배지(그래프 갈래의 검증17을 번호 충돌로 재부여)
충돌 해소 6파일: preload.js(IPC 채널 합집합: 루틴 4+주문 1 ∪ 브레인 3+저장실패 1) ·
         errors.py(핸들러 3계 공존: 루틴 422/409 + 브레인 503) · config.py(루틴 설정 +
         브레인 추출·로깅 설정 병렬) · test_inventory(319+6=325, 근거 주석 병합) ·
         verify.js(검증 번호 재부여) · plan.md(세 갈래 실측 블록 보존).
         나머지는 -X ignore-cr-at-eol로 자동 병합(개행 차이 소거).
```

**2026-08-19 (2차 병합) · `디자인`(8~10차) → `main`(7차) 병합 직후 재실측:**

```
app:  npm test → 198건 통과, fail 0 (main 197 + 디자인 window-placement 추가분 합류)
      npm run verify → 검증 1~18 전 단언 통과 · exit 0
        검증17 = 능동 턴·주문 티켓(main) · 검증18 = 캡처 신뢰성(디자인 갈래의 검증17을
        번호 충돌로 재부여) · 캡처 20장 인접 동일 0건
backend: 병합 diff가 backend를 건드리지 않음(디자인 3커밋은 app·ui·plan 한정) — 직전
        실측 771 passed(loadgroup 59.2s·직렬 197.8s)가 유효
충돌 해소 5파일: chat.html(커맨드 카드 구조 채택 + 루틴 칩을 컨트롤 스트립으로 이주) ·
        chat.js(Esc 우선순위: 팝오버 → 주문 티켓 → 설정) · verify.js(검증17/18 공존) ·
        plan.md(양 갈래 실측 블록 보존) · 캡처류(verify 재실행으로 재생성).
        chat.css·main.js는 개행(CRLF/LF) 차이가 전체 충돌로 보였던 것 —
        `-X ignore-cr-at-eol` 재병합으로 실질 충돌만 남김.
```

**2026-08-19 (7차·main) · 능동 에이전트(루틴·알림·능동 턴·주문 티켓) P0~P4 결선 후 재실측:**

```
backend:  771 passed, 0 failed (병렬 49.6초 · 루틴 계열 +63) · ruff clean · generate --check current
  오퍼레이션 계약 315 → 319 (routines 4라우트 — 의도적 개정, test_inventory_api 주석)
app:      npm test → 197건 통과 (190→197: order-ticket 7) · npm run verify → 검증 1~17 전 단언 통과
루틴 실배선: 백엔드 재기동 후 /api/v1/routines → ready · disclosure_ready true
  (DART 키 배선 — DPAPI 보관분을 backend/.env로 1회 이관, 값 무출력 스크립트 사용 후 삭제)
P0 게이트(-p0gate run): LIV-067~071 5/5 정직 응답 — 기준선 전패 → 지어내기 0건
P3 인수(-p3accept run): LIV-070 통과(athena_routine 초안 + 승인·주기·비집행 3고지 정답 구조) ·
  LIV-066 타임아웃(182s — 기존 꼬리 지연 결함, 다음 수 24의 새 증거. 회귀 아님)
```

**2026-08-19 (7차 보강) · architect 검토 APPROVE(발견 0) → deslop → 재검증:**

```
deslop:   WS 이벤트 펌프 복붙 26줄 → api/ws_pump.py 단일화(stream·routines_ws 공유) ·
          chat.js _btn/_mountTurn 헬퍼(버튼 7벌·턴 부착 꼬리 2벌 접음) ·
          죽은 코드 3건 삭제(app.state 루틴 미러 2줄 · ledger.path property ·
          _notify_factory 불필요 async — 테스트 호출부 await 동반 수정)
재검증:   backend 771 passed(loadgroup 59.2초 · 직렬 197.8초) · ruff clean ·
          generate --check current · app 197 · verify 검증 1~17 전 단언 통과
함정 재확인: 맨 `-n auto`(dist=load)는 test_accounts가 %TEMP% 지문 락에서
  자기충돌한다(5~6건 플레이크 실측 — 실행 중 백엔드 탓이 아니었다).
  기존 규약대로 `--dist loadgroup` 필수(addopts 미기재, 이 문서 §2 실측 참조).
```

**2026-08-19 (7차) 세션 기록 — ralph 루프(사용자 "구현시작"), 실행계획 v4+§8 집행:**

- **백엔드 루틴 서브시스템 신설**(`athena_api/routines/`): 구조화 조건(문자열 DSL
  제거 — 인젝션 표면 원천 제거, 적대 입력 10종+eval/exec 소스 고정 테스트) ·
  mode 결정론 유도(§8: WS만 실시간, 그 외 주기) · 원장(발화/근접/억제+사유 필수) ·
  2트랙 스케줄러(WS 팬아웃 구독 + 주기 폴링·캐치업 1회·리미터 headroom 양보) ·
  DART 직접 폴러+corp 카탈로그(zfill 고정) · lifespan 대칭 결선(기본 비활성·강등 문법)
- **REST 4라우트 + WS 알림 채널**: draft/confirm/cancel/list(confirm·cancel은 사람
  전용, 503 fail-closed, 조건 원문 비노출) · ws_auth 헬퍼 추출(배타 2모드 보존 —
  기존 stream 테스트 전건 + 루프백 무인증 1008 회귀 신설) · /api/v1/ws/routines
- **게이트웨이 툴 `athena_routine`**: draft/list만(상태 변경 액션 부재를 테스트로
  고정 — 델타 blocker), 무재시도, 감사 별칭 'routine'
- **앱**: RoutineFeed(WS 구독·백오프) · 토스트(발화·복원실패만) · **능동 턴**(발화
  배지·방식 표기·소스 라벨·시점 고지, 굴절 변조 등장) · 활성 루틴 칩 · **승인
  카드**(방식 행 필수, 승인은 렌더러 직접 confirm — LLM 재스폰 없음) · **주문 확인
  모드 #order 최초 구현**(형제 패널 문법, kt10000/kt10001 실측 필드, 3중 게이트
  그대로, IN_DOUBT 재전송 금지) — verify **검증17** 신설(쿼터 0)
- **프롬프트 규율 v3a→v3b**: 방식 이분법 고지 → 루틴 출시 후 "draft 제안만·승인 전
  등록 발화 금지"로 갱신. P0 게이트 실측이 "confabulation은 규율로 봉합, P2~P4의
  가치는 실능력"을 확정(실행계획 프리모템 5의 게이트 설계 그대로)
- GLOSSARY 신규 3건(루틴·능동 턴·시점 정직성) · CLAUDE.md §7 셀렉터 스코프 정정 ·
  D-017(LIV-066 judge) 수정(validate exit 0)

**2026-08-19 (6차) · R1 live 전수 100건 실앱 QA + 개선 결선 후 재실측:**

```
backend:  709 passed, 0 failed (병렬 79.5초 · server.py 스키마 힌트 테스트 +1)
  ruff check . → All checks passed | generate_api.py --check → current
app:      npm test → 178건 통과 (175 + live-prompt v2 계약 3)
          npm run verify → 1회차: 검증1b(bootBar) 단언 1건 실패(부팅 표집 타이밍 —
          병합 세션 검증14와 같은 공유 데스크톱 간헐) → 2회차: 전 단언 통과 · exit 0
R1 평가 (datasets/eval-runs/2026-08-19-intraday-ui — 증거 100케이스 전량 커밋):
  판정: pass 35 · fail 54 · dataset-defect 10 · blocked-env 1 (실행분 pass율 39.3%)
  그룹: appmode 100% ↔ adversarial 13.3%(절대 기준 100% 그룹 — 최우선 결함)
  지연(89건): 총 p50 57.9s / p95 142.4s · 첫 카드 p50 46.4s ·
  지배 요인 = 마지막 툴 후 "꼬리"(카드 페이로드·답변 생성, 50~155s) — 백엔드 몫 0.1~0.2s 재확인
  개선 후 fixcheck(실패 9 재실행): 3 pass 전환 · 5 부분 개선 (…-fixcheck/)
```

**2026-08-19 (6차) 세션 기록 — 100건 실앱 QA(사용자 지시: 실행·캡처·채점·개선·지연 분석):**

- **하네스**: `run-cases-ui.js` 계측 확장(첫 카드 시각·전이 타임스탬프·인덱스 병합·캡처
  타임아웃·창 사망 복구) + **앱모드 전용 드라이버 신설**(`run-cases-appmode.js`, Esc 분기·
  온보딩 상태 조작·MCP 시트 12건) + 집계기(`datasets/aggregate_run.py`).
- **실패 지배 패턴은 모델 행동 규율**(셸은 appmode 100%로 견고): ① 명시 출처 조용한 대체
  16건 ② 주문·자동화 정책 오설명 6건(보안 관련 — "매수 진행하겠다"류) ③ 상대 날짜 추측
  ④ 원문 미조회 결론 ⑤ 한계 미고지. 상세 분류·근거는 run의 `summary.md`.
- **개선 결선 2건**: live-prompt v2(조회 규율 4 + 주문·자동화 정책 고지 + timeline 힌트,
  테스트 3건) · render_canvas `data` 형상 안내문(CANVAS_SCHEMAS 생성, 액션 11 — oneOf
  강제가 아니라 안내문인 이유는 폴백 보호, server.py 주석). fixcheck 재실행으로 델타 실측.
- **앱 확정 결함 1건 신규**: LIV-050 — upstream 전부 성공 후 180s 상한에서 답변이 타임아웃
  문구로 대체(응답 생성 자체가 예산 초과). 꼬리 지연과 같은 뿌리 — 아래 다음 수.
- **운영 사고 2건 정직 기록**: 배치 중 월간 지출 한도 도달(7건 blocked → 기준선 프롬프트
  stash 복원 후 재시도 정산) · Electron 1회 사망(LIV-047 캡처 행 → 하네스 가드 후 재발 0).
- **데이터셋 결함 D-007~D-017** (11건): 6건 당일 수정(validate exit 0), 5건 수정 대기.
  공통 유형 = 특정 서버·툴 못박기가 키움 라우팅·동의 게이트 구조와 충돌.

**2026-08-19 (10차·디자인) · 글자 크기 5단계 설정 후 재실측:**

```
app:
  npm test        → 176건 통과, fail 0
  npm run verify  → 검증 1~17 전 단언 통과 · exit 0
```

- **글자 크기 5단계**(사용자 지시 "글자가 너무 큼"): 설정 › 화면 › 글자 크기 —
  매우 작음/작음/보통/큼/매우 큼. SSOT는 `lib/main/prefs.js` `fontSize`(xs~xl,
  화이트리스트 검증·athena-prefs.json 영속), 표현은 `tokens.css`의
  `:root[data-font-size=...]` 토큰 세트 교체(두 창 모두, `prefs-changed` 방송을
  캔버스 창에도 확장). 줌과 달리 텍스트만 바뀐다. 변경 시 auto-grow 재측정.
  "--text-sm 12px 하한"은 기본 스케일(md)의 규칙 — xs/sm은 명시적 사용자 선택.
- **Paper 화면설계서 정비**(같은 날): 검정 시그니처 제거(밝은 유채색 환경 + 밝은
  배경 적응 유리 두께, 00R에 명문화) · 57보드 기능별 11행 정규화 배치(§0~§10
  섹션 라벨) · 유리화 누락 3차 보수. 카드 템플릿 파일도 동일 재질.

**2026-08-19 (9차·디자인) · AT-CH-001R 커맨드 카드 개편 후 재실측:**

```
app:
  npm test        → 176건 통과, fail 0 (window-placement 중앙 정렬 테스트 추가)
  npm run verify  → 검증 1~17 전 단언 통과 · exit 0
```

- **커맨드 카드(사용자 지시, Claude Desktop 입력 카드 참조)**: 대화 창 부팅 기본
  1560×204 → **900×248**, 캔버스 폭 중앙 정렬(`chatOriginX`). 입력 영역 2행화 —
  입력줄 52 + 컨트롤 스트립 48(점·CLI 필·모델 필, **실기능만**). 모델·추론 노력은
  인라인 팝오버(검증15 `athena:model-get/set` 재사용, 창 안 오버레이). 입력 캐럿
  무채색 정합(마젠타는 점 하나). "짝으로 움직인다" 계약을 "x 동일"에서 "캔버스 폭
  중앙"으로 일반화(`window-placement.js`, 검증14 단언 동반 갱신 — 완화 아님).
  근거: `two-windows.md` 정정 4 · Paper 47쪽(AT-CH-001R).

**2026-08-19 (8차·디자인) · 리퀴드 글래스 전면 교체 + UX QA 수정 후 재실측:**

```
app:
  npm test        → fail 0
  npm run verify  → 검증 1~17 전 단언 통과 · exit 0 (검증17 캡처 신뢰성 신설 — 인접 동일 캡처 0건)
```

- **재질 교체**: `ui/glass`(WWDC25 세션 219 전문 + 실물 캡처 5장)에서 유리 7재료(흡수·산란·렌징·
  반사·각인·접지·발광)를 추출 → Paper 화면설계서에 **00R 레시피 보드**(시각 SSOT) 신설 →
  화면설계서 목업 33보드 + 카드 템플릿 18종 + 앱 CSS(chat/canvas/ui-kit)에 동일 레시피 적용.
  유리 사다리 값(`--glass-*` 0.30/0.45/0.50/0.55)은 불변 — 검증16 통과가 증거.
- **실측 2건**: ① Paper 렌더러는 backdrop-filter를 렌더하지 않는다(선명 프로브) — 목업 프로스트는
  사전 블러 환경으로 시뮬레이션. ② verify 캡처 3장(18/19/20)이 MD5 동일했던 원인은 렌더 실패가
  아니라 **capturePage 프레임 스로틀링 + 새 카드가 스크롤 밖에 붙는 실사용 결함** — rAF 2회 대기,
  `backgroundThrottling:false`, `scrollIntoView`로 근본 수정, 검증17이 재발 감지.
- **UX QA 5건 수정**: 고대비 `::placeholder` 예외(치명) · 캡처 신뢰성(치명) · TradingView 로고
  스크림(라이선스 유지) · 평시 placeholder/창 컨트롤 대비 · 카드 하단 글리프 절단 오독
  (주주균등처분→조조규등처부로 보이던 것 — `.is-clipped` 페이드로 잘림을 정직 표시).

**2026-08-19 (그래프) · 채팅→그래프 파이프라인 결선 후 재실측:**

```
backend:  772 passed, 0 failed (직렬 172.8초)
  ruff check . → All checks passed | generate_api.py --check → current (생성물 무접촉)
app:
  npm test        → 197건 통과 (기존 176 + history-sink 9 · history-badge 7 · 리셋 배선 5)
  npm run verify  → 검증 1~17 전 단언 통과 · exit 0 (검증17 "기록 안 됨" 배지 신설)
```

**2026-08-19 (그래프) 세션 기록 — 채팅 이력 → LadybugDB 성향 파이프라인:**

- **닫은 gap은 정확히 2건이었다**(노션 "GraphDB 사용 현황" 실측 문서 + `lifespan.py:80-90` docstring
  근거): ① 채팅→`HistoryStore` **쓰기 경로 자체 부재**(`upsert_chat` 프로덕션 호출 0건)
  ② `_open_brain`이 `IngestionCoordinator`를 `source_projector` 없이 생성 → **추출 0건**.
  두 gap은 독립이고 순서는 ①→②다.
- **배치·요약 API는 신규 발명이 아니라 ADR §9 게이트 G005의 완성**이다. `JobTrigger.HOURLY`는
  `history.py:39-43`에, `GraphStore.summary()`는 `store.py:635`에 **이미 있었다** — 없던 것은
  주기 호출 타이머 하나와 loopback 라우트뿐. 그래서 APScheduler 등 신규 의존성은 0건이다.
- **채팅 삽입 지점은 renderer가 아니라 main 프로세스**(실측): `app/main.js:842` `runLiveQuery`
  진입의 `query`, `:904-906`의 `answerText`. `claude-runner.js`가 stream-json을 이미
  `finalResult`로 조립해줘서 CLI stdout 후킹이 불필요했다. `answerText`는 null일 수 있어 스킵한다.
- **성향은 저장 시점이 아니라 읽기 시점에 계산한다.** Claim은 append-only로 쌓고
  `graph.investor_profile_summary`(신규 고정 템플릿, ADR §6.2 allowlist 등재)가 90일 윈도우
  관측 수 · 최신 관측일 · 평균 confidence를 낸다. 정렬은 **최신 관측일 desc → 카운트 desc → id**로
  완전 결정론이다. 초안의 latest-wins는 기각했다 — 한 번 스친 발언이 누적 관측을 뒤집는다.
  순수 카운트/기간 필터라 ADR §7(벡터·임베딩·모델 호출 금지)을 어기지 않는다.
- **온톨로지는 v1 그대로**다. `investor_profile`/`preference`/`risk_signal` + `PREFERS`/`AVOIDS`/
  `INTERESTED_IN`이 **이미 스키마에 있었고 한 번도 채워진 적이 없었을 뿐**이라 버전 bump가 없다.
- **전체 삭제는 핫스왑이 아니라 프로세스 재시작을 요구한다** — `GraphStore.open()`/`HistoryStore.open()`
  은 `_closed`면 `RuntimeError`(일회용 객체)이고 ADR §11이 "한 번만 open/close"를 못박는다.
  `POST /api/v1/brain/reset-and-restart`는 기존 `_teardown_brain` 로직만 호출하고 파일
  (sqlite3 + **`-wal`·`-shm`** + lbug, `unlink(missing_ok=True)`) 삭제 후 종료 신호를 낸다.
  Electron 재기동은 **리셋 IPC 핸들러 안에서만** `once('exit')` 대기 후 `ensureBackend()`를
  명시적으로 재호출한다 — `backend-launcher.js:137-140`의 전역 exit 훅은 재스폰을 안 하며,
  거기에 자동 재스폰을 붙이는 것은 **크래시 루프 리스크**라 기각했다. 비자가스폰이면 "수동 재시작
  필요"를 정직하게 안내한다.
- **침묵 유실 금지**: 저장 실패 시 `athena:history-save-failed` IPC → 회색 무채색 "기록 안 됨" 배지.
  단 `brain_ready=false`(기본)면 저장 시도도 배지도 없다 — "해당 없음"과 "실패"는 다른 상태다.
- **LLM 노출 툴은 여전히 정확히 4개**다. 브레인 라우트 5개는 전부 `x-athena-llm-exposed: false`이고,
  selector 카탈로그는 `generate_api.py` 생성 레지스트리에서만 빌드돼(`catalog.py:1,14`)
  구조적으로 브레인을 대상 삼을 수 없다 — `HISTORY_COMMAND` 미매치 폴스루가 원천 안전한 이유다.
- **함정 ⑫ 재확인**: `athena_api`에는 요청 바디를 찍는 미들웨어가 0건이다. 즉 현재 안전은
  "마스킹 로직 덕"이 아니라 **"아무도 로깅을 안 하기 때문"**이다. 그래서 신규 핸들러는
  `text`/`query`를 `logger.*`에 넣지 않고 `source_id`/`role`만 남기며, `caplog` 테스트로 강제한다.
- **신규 실측 함정**: 이 워크트리는 한글 경로라 **`pytest -n auto`(xdist)가 워커 부팅에 실패한다**
  (`EOFError: expected 1 bytes, got 0`, execnet bootstrap). 직렬로 돌려야 한다(213초).
  CLAUDE.md §9의 병렬 규약은 ASCII 경로 전제다.
- **교차 대조가 잡은 결함 1건(수정 완료)**: 구현은 배치 주기·수동 실행·실행 시각을 "아직 제공하지
  않는다"로 정직하게 적었는데 **Paper 보드 48은 그것들이 동작하는 것처럼 그리고 있었다**(마지막/다음
  실행 시각, "지금 실행" 버튼, ③ 재기동 게이지). soul.md §7 "없는 기능을 암시하는 장식 UI" 위반이다.
  보드 48에 **"부분 구현" 배지 + 미구현 항목 명시**를 추가해 해소했다. 리뷰어는 US-006(구현)과
  US-007(디자인)을 각각 봤기 때문에 이 불일치를 못 잡았다 — **장표와 구현은 반드시 교차 대조한다.**
- **설정 섹션에서 실제로 동작하는 것은 "전체 삭제" 하나다.** 배치 주기는 표시만 하고
  (`ATHENA_BRAIN_INGEST_INTERVAL_MINUTES`로 관리), 수동 실행 라우트는 백엔드에 없어 버튼을 만들지
  않았다. `BrainStatusResponse`가 4필드(ready/ingestion_ready/extraction_enabled/fts_ready)뿐이라
  실행 시각도 못 준다.
- **실배선 E2E 실행 완료 — 그리고 결함 1건을 잡았다** (`app/probe-brain-chat-e2e.js`,
  증거 `spike/cli-pipe/gateway/PROBE-BRAIN-CHAT-E2E.json`). 임시 브레인 DB + 별도 포트(8011)로
  백엔드를 띄우고 Electron에서 실제 질의 1건을 `claude -p`에 태운 뒤 SQLite를 직접 조회했다.
  - **1차: `pass:false`.** 2행은 들어갔지만 **user와 assistant의 conversation_id가 달랐다**
    (`0a1fe408…` vs `5ff6842e…`). 원인: `claude -p --resume`이 매 성공 왕복마다 세션을 포크해
    `liveSessionId`를 갱신하는데, role:user는 질의 진입 시점에·role:assistant는 반환 시점에
    저장되므로 그 사이에 값이 바뀐다. 계획 §2(a)의 "liveSessionId를 conversation_id로 재사용"
    전제가 **실측으로 뒤집혔다** — liveSessionId는 대화 식별자가 아니라 재개용 커서다.
    조회(`GET /chats?conversation_id=`)가 반쪽 턴만 돌려주고 그래프 대화 묶음도 턴마다 쪼개진다.
  - **수정**: conversation_id를 앱 세션 단위(`historyAppSessionId`)로 고정. `main.js:843` 주석이
    이미 "대화는 앱 수명 단위다"라고 적고 있었으니 원래 이쪽이 맞았다.
  - **2차: `pass:true`** — 2행(user·assistant)·동일 conversation_id·한글 원문 보존·
    실응답("2") 확인. app npm test 197/197 유지.
  - 부수: 1차 증거의 한글이 깨져 있었다 — 파이썬 `print()`가 Windows 콘솔 인코딩(cp949)으로
    나간 것이라 DB가 아니라 **증거 수집 경로의 결함**이었다. `PYTHONIOENCODING=utf-8` 고정으로
    해소(§8 함정). 검증하다 같은 함정에 한 번 더 빠질 뻔했다 — **파일을 열어서 확인해야 한다.**
- **로그 관리 도입 (Open WebUI 조사 반영)** — `athena_api/logging_config.py` 신설.
  조사 대상은 Open WebUI(`backend/open_webui/env.py`, `utils/logger.py`) 실제 소스다.
  - **가져온 것**: 전역 레벨(`ATHENA_LOG_LEVEL`) + **서브시스템별 오버라이드**
    (`ATHENA_SRC_LOG_LEVELS='{"brain":"DEBUG"}'` — api/brain/kiwoom/selector/mcp/uvicorn) +
    `ATHENA_LOG_FORMAT=text|json`(JSON은 줄당 객체 하나, upstream `_json_sink` 형태) + stdout 단일 싱크.
    ※ upstream의 `SRC_LOG_LEVELS`는 현재 빈 dict에 *"Legacy variable, do not remove"* 주석이
    달린 껍데기다 — 개념만 맞고 구현은 우리가 새로 했다.
  - **안 가져온 것과 이유**: ① **Loguru** — 의존성이 늘고, 우리 자체 `getLogger` 호출은 2곳뿐이며
    정작 중요한 uvicorn/FastAPI 레코드는 stdlib로 나온다. ② **본문을 담는 감사 로그** —
    upstream `AUDIT_LOG_LEVEL=REQUEST_RESPONSE`는 `request_object`/`response_object`를
    **무마스킹으로** 로테이션 파일에 쓴다. 시사적인 건 upstream 자신의 기본
    `AUDIT_EXCLUDED_PATHS`가 `/chats,/chat,/folders`라는 점 — 채팅 본문이 민감하다는 걸 알고
    기본 제외한다. 우리는 함정 ⑫가 그걸 기본값이 아니라 **금지**로 못박으므로 아예 만들지 않는다.
    ③ **디스크 싱크·로테이션** — 로컬 단일 사용자 앱이라 스크럽할 운영자가 없고, 그 파일 자체가
    함정 ⑫가 경고하는 산출물이 된다.
  - **`SecretRedactingFilter` — 2계층**. ① **값 매칭**: 이 프로세스가 아는 비밀값(로컬
    베어러·app_key·secret_key)을 포맷된 메시지에서 치환(f-string 호출부도 덮는다).
    ② **형태 매칭**(`Bearer <x>`, `access_token=<x>` 등). ②가 왜 필요한가 —
    **키움 액세스 토큰은 `TokenManager`가 기동 후 발급하고 `Bearer {token}`으로 렌더된다**
    (`kiwoom/auth.py:84`). 즉 `Settings`에 없어서 ①만으로는 원천적으로 못 잡는다.
    이 빈틈은 초판 구현에 실제로 있었고, Open WebUI 조사(정규식 마스킹 제안)가 짚어서 메웠다.
    대가는 무해한 리터럴까지 지울 수 있다는 것인데, 살아 있는 토큰을 흘리는 것보다 낫다.
    **둘 다 채팅 본문은 못 잡는다**(임의 사용자 텍스트라 형태가 없다) — 본문 금지는 코드
    규칙이고 `caplog` 테스트가 강제한다.
  - 회귀 방지: `test_no_audit_body_settings_exist`가 `audit` 이름의 설정이 생기면 실패한다
    (upstream을 베껴 되살리는 것을 막는 장치). 테스트 23건 신설.
- **채팅 로그 → 그래프 이관 단위 재설계 (2026-08-19 · Open WebUI 비교 판단)**.
  "채팅 로그를 어떻게 저장하고 어떻게 그래프로 옮길 것인가"를 다시 따져 **저장은 옳고 옮기는
  단위가 틀렸다**고 판정했다.
  - **Open WebUI 실측**(`models/chats.py`, `internal/db.py`, `env.py`): 대화 1건 = `chat` 테이블 행
    1개이고 대화 전체가 `chat` JSON 컬럼에 통째로 들어간다(`history.messages` 딕셔너리 +
    `currentId`로 분기 트리). 성능 때문에 정규화 `chat_message` 행을 나중에 덧대 이중 쓰기 중이고
    읽기는 정규화 우선·JSON 폴백. 기본 SQLite(`backend/data/webui.db`), SQLAlchemy+Alembic,
    SQLCipher 암호화 옵션. **보존 정책은 없다**(사용자가 지울 때까지 영구).
  - **저장 계층 판정: 우리가 낫다.** 우리는 처음부터 메시지 1건 = 행 1개(`source_records`)에
    fingerprint + append-only `source_changes`까지 있다. 저들이 지금 겪는 "JSON 덩어리 → 정규화"
    마이그레이션이 우리에겐 없다. **바꾸지 않는다.**
  - **이관 계층 판정: 결함이다.** `ingestion.py:318-321`이 변경분을 레코드 하나씩 돌며
    `project_source(change.record)`를 부르고, `extraction.py:376`은 그 레코드의 `text` 하나만
    LLM에 싣는다. 즉 **성향 추출이 문맥 없는 단일 메시지만 본다.** "응 그거 좋아"는 이전 턴 없이
    무의미하고, 목적이 성향 판별인데 구조적으로 품질이 안 나온다. 게다가 "차트 그려줘"처럼 신호 0인
    메시지까지 전부 로컬 CLI spawn 1회를 쓴다.
  - **해결책이 이미 스키마에 있었다**: `SourceKind.CONVERSATION`(`ontology.py:57`)이 정의돼 있는데
    **한 번도 쓰인 적이 없다.** 설계가 대화 단위 소스를 예상해뒀는데 우리가 `chat_message`만 썼다.
  - **채택 설계 — 2단 소스**(온톨로지·스키마 버전 변경 0): `chat_message`는 원본으로 계속 쌓되
    **추출 대상에서 뺀다**(그래프 SourceRecord 노드로는 계속 올라가 Claim의 `SUPPORTED_BY` 근거가
    된다). 대화를 전사(transcript)로 롤업한 `conversation` 소스를 만들고 **그것만 추출 대상**으로
    삼는다. 롤업은 기존 `_upsert_source`를 재사용하므로 `source_changes` → 커서 → 어댑터라는
    **기존 경로를 그대로 탄다** — 별도 파이프라인이 아니다. 여기서 Open WebUI가 참고가 된다:
    **저장은 쪼개는 게 맞고, 의미를 읽을 때는 저들처럼 대화 덩어리가 맞다.**
  - 부수 결함: 대화 목록을 만들 수단이 없었다(`chats_for_conversation`은 id를 이미 알아야 한다).
    DISTINCT 집계 조회를 신설한다 — 이력 카드가 반쪽이던 원인.
  - **구현 중 드러난 시한폭탄 1건(수정 완료)**: 전사에 길이 상한이 없었다. `SourceRecord.text`는
    `LongText`(10,000자, `ontology.py:26`)인데 실제 대화는 수십 턴이면 넘는다. 넘는 순간 그 행이
    `SourceRecord`로 역직렬화될 때 검증 실패 → 롤업 예외 → **롤업 실패는 잡 전체를 실패시키게 설계했으므로
    대화 하나 때문에 모든 대화의 적재가 영구 정지**한다. 구현자가 정직하게 보고해 잡혔다.
    → `MAX_TRANSCRIPT_CHARS`(9,000, 온톨로지 상한 아래) 예산 안에서 **최근 턴부터 채우는 슬라이딩
    윈도우**로 수정. 오래된 턴이 창 밖으로 나가도 잃는 게 없다 — Claim은 그래프에 append-only로
    남아 있고 창은 *다음* 추출이 다시 읽을 문맥만 제한한다. `included_message_count`·`truncated`를
    속성에 기록해 그래프 독자가 "이건 대화의 꼬리만"임을 알 수 있게 했다(추측하게 두지 않는다).
    회귀 테스트 3건으로 고정.
    - 부수 실측: `ChatHistoryRecord.text`도 10,000자 상한이라 **단일 메시지는 그 이상이 될 수 없다.**
      따라서 단일 턴 초과 분기가 실제로 담당하는 구간은 9,000 < len ≤ 10,000이다 — 예산을 온톨로지
      상한과 같게 두지 않고 아래에 둔 이유다.
  - 남은 리스크(미조치): `compact_conversations()`가 매 잡마다 **모든** 대화를 LIMIT 없이 순회한다.
    내용 불변이면 fingerprint 일치로 즉시 no-op이라 비용은 낮지만 0은 아니다 — 대화 수가 크게
    늘면 재검토한다(현재 실측 근거 없음).
- **미완(정직)**: ① **노션 문서화는 하지 않는다** — 사용자 지시로 범위에서 제외(2026-08-19).
  ② 보존기간·세분화 삭제 UI,
  감시 에이전트의 그래프 소비(알림)는 **명시적 범위 밖**. ③ 집계 쿼리 성능 수용 기준 없음(후속 실측).

**2026-08-19 (병합) · `디자인` → `main` 병합 직후 재실측:**

```
backend:  708 passed, 0 failed (병렬 55.9초 · pytest-xdist -n auto --dist loadgroup)
  ruff check . → All checks passed | generate_api.py --check → current
app:
  npm test        → 175건 통과 (main 166 + 디자인 backdrop-luma 9)
  npm run verify  → 1회차: 검증14 짝 배치 단언 2건 실패 → 2회차: 검증 1~16 전 단언 통과 · exit 0
```

**병합 기록 (2026-08-19):**

- 충돌 3부류 해소: ① `app/main.js` — 양쪽 순수 추가(부팅 계측+백엔드 자동 기동 vs
  desktopCapturer+휘도 계산부), 둘 다 채택. ② `plan/plan.md` — 두 갈래 스냅샷을 갈래
  라벨로 병렬 보존(디자인 갈래가 지웠던 main 3차 실측 블록 복원). ③ 캡처 PNG 20장 +
  `VERIFY-REPORT.json` — `npm run verify` 재생성으로 해소.
- 의미 충돌 0건 실측: 백엔드 자동 기동·부팅 계측(main)과 휘도 감지-적응·유리 사다리
  검증16(디자인)이 병합 후 공존 — 위 수치가 증거다.
- verify 1회차 실패 2건은 정직 기록: 검증14 짝 배치(chat이 placeWindows를 안 따라감).
  원인은 병합 결함이 아니라 **공유 데스크톱 실커서 간섭** — 드래그 폴러는
  `screen.getCursorScreenPoint()`(실커서)를 읽는데, 1회차 검증11 positionDelta
  x:157/y:-257이 실행 중 실마우스가 움직인 증거다. 2회차는 검증14가 짝 배치
  chat.x==canvas.x==-300 정확 일치로 통과(전 단언 통과). CLAUDE.md §9 함정 그대로.

**2026-08-19 (5차·main 갈래) · 전 구간 지연 최적화(합의 계획 실행) 후 재실측:**

```
backend:  708 passed, 0 failed (병렬 56.8초 · pytest-xdist -n auto --dist loadgroup · 직렬은 178초)
  ruff check . → All checks passed | generate_api.py --check → current
app:
  npm test        → 166건 통과
  npm run verify  → 전 단언 통과 · exit 0
E2E 최종 N=2 (PROBE-KIWOOM-CHART-run6/7.json):
  총 75.4s/92.9s · 첫 카드 69.9s/86.9s · 키움 4툴 정확 1사이클(재조회 0) · 외부 주식 API 0 · chart 1
부팅: 창 표시 1.115s (≤2s 달성) · 백엔드 스폰→manifest 3.773s (≤5s 달성)
4툴 백엔드 몫: 0.17~0.20s (목표 ≤5s의 25배 여유)
```

**2026-08-19 (5차) 세션 기록:**

- **진단이 전제를 뒤집었다**: "백엔드가 느리다" → 실측 분해로 반증. 게이트웨이+백엔드+키움 몫은
  사이클당 0.2초, 질의 지연의 99%는 모델 판단 대기. 질의 목표 2종(첫 카드 ≤15s·완료 ≤30s)은
  **미달로 정직 판정** — 구조 변경(auto_execute 이중 디스패치 등) 없이는 도달 불가.
  전체 판정·남은 선택지는 [`latency-audit-2026-08-19.md`](latency-audit-2026-08-19.md) §5.
- **`--tools` 표면 축소 실험 전면 철회** (E2E 5회 실측 전패): MCP 툴이 ToolSearch 지연 로딩이라
  빌트인 축소가 로딩을 깨뜨림(최악은 렌더 실패). 재도입 조건(E2E 재실측)을 주석·테스트로 고정.
  낭비 턴 억제는 프롬프트 규율만 채택(재조회 금지·describe 생략 금지·첫 카드 우선).
- **게이트웨이 읽기 캐시**(selector_tools.py SelectorCache): search/describe만, TTL 5분·LRU 256.
  resolve/call은 구조적 캐시 불가(화이트리스트 게이트 + 우회 불가 테스트 3건). 웜 경로 전용.
- **pytest 병렬화**: 직렬 178초 → 54~58초(연속 2회 green). 원인 규명된 그룹 고정 2건
  (test_accounts.py 실제 OS 락 공유 → xdist_group). addopts 미기재, README/AGENTS.md에 규약.
- **밀폐성 수정 1건**: test_inventory_api.py의 `_env_file=None` 누락(파일 내 유일한 이탈) →
  실 .env 로드로 기실행 백엔드와 락 충돌하던 환경 의존 실패 소멸. 708건이 백엔드 기동 무관 green.
- 부팅 lifespan 재구성은 **불발동** — 실측이 목표 기달성이라 발동 조건 불성립(무근거 수술 금지).

**2026-08-18 (4차·main 갈래) · 키움 실배선 라우팅 — "주식은 무조건 키움"(사용자 지시) 결선 후 재실측:**

```
backend:  687 passed, 0 failed (164초)   ← 667 + selector_tools 24 · chart 스키마 6 등 (tests/mcp 258)
  ruff check .                          → All checks passed
app:
  npm test                              → 162건 통과 (3차 151 + live-prompt 8 · backend-launcher 7 등 순증 11)
  npm run verify                        → 전 단언 통과 · exit 0 (검증13b 라이브 chart 봉투 신설)
실배선 E2E (spike/cli-pipe/gateway/probe_kiwoom_chart.js · PROBE-KIWOOM-CHART.json):
  자연어 "삼성전자 최근 일봉 차트 그려줘" → athena_search→describe→resolve→call(ka10081)
  → chart 캔버스 1건(bars 60) · 외부 주식 MCP 호출 0건 · 감사 로그 kiwoom-selector 4건 · 72.7초
```

**2026-08-18 (4차) 세션 기록:**

- **다음 수 10 결선 완료** — 게이트웨이가 셀렉터 4툴(`athena_search/describe/resolve/call`)을
  빌트인으로 노출(`athena_mcp/selector_tools.py`). 실행은 백엔드 `/api/v1/llm/tools/*` HTTP
  루프백 프록시(기본 127.0.0.1:8010, `ATHENA_BACKEND_URL`) — 인프로세스 import는
  CredentialProcessLock(자격증명 단일 프로세스) 위반이라 의도적으로 금지. **재시도 0회**
  (plan_token 1회용), 빌트인 최초로 감사 로그 기록(`kiwoom-selector` 별칭).
- **라우팅 규칙**(사용자 지시): 라이브 프롬프트에 "주식 마켓 데이터(시세·차트·호가·체결·순위·
  잔고)는 반드시 키움 4툴, 외부 MCP는 투자정보 전용, 키움 미기동 시 대체 금지" 명시.
- **chart 캔버스 실배선**: `CHART_SCHEMA`(canvas.py) + `renderLiveChart`(canvas.js) +
  ka10081 필드 매핑 힌트(dt→time 등, 오름차순 정렬). 차트 카드는 더 이상 픽스처 전용이 아니다.
- **백엔드 자동 기동**: 앱 부팅 시 헬스체크(manifest) → 미기동이면 uvicorn 스폰(중복 스폰
  금지 — 수동 인스턴스 존중), 종료 시 자가 스폰분만 정리(`lib/main/backend-launcher.js`).
- 부수 실측: 전체 스위트 1회 실패는 코드가 아니라 **떠 있는 백엔드와의 CredentialProcessLock
  충돌**(환경) — 백엔드 내리고 재실행해 687 전부 초록 확인.

**2026-08-19 (7차·디자인 갈래) · 휘도 감지-적응 구현 + 잔여 전소진 후 재실측:**

```
app:
  npm test       → 160건 통과 (6차 151 + backdrop-luma 9)
  npm run verify → 검증 1~16 전부 통과 · "전 단언 통과" · exit 0
  probe-backdrop-luma → 실배선 확인: 어두운 데스크톱 b=0 판정, 이벤트 왕복,
                        캔버스 0.500 유지 (captures/backdrop-luma-probe.json)
```

**2026-08-19 (7차) 세션 기록 — 디자인 비판 잔여 전소진:**

- **휘도 감지-적응 구현**(보드 45 실측 불통과의 해소): main.js
  `startBackdropSampling()` — desktopCapturer 썸네일에서 자기 창 영역 제외 후
  평균 휘도, 2초 폴링 + EMA + 600ms 전이. 창 0.30→최대 0.72 · 캔버스 창
  0.50→0.72 · 폴백 0.55(3연속 실패). 계산부 `lib/main/backdrop-luma.js`(테스트
  9건). fixture에선 안 돌린다 — 검증16 결정론 보호.
- **창 이동 커서 신호**: .history/.input-row hover grab + 드래그 중 grabbing.
- **캔버스 900px 이하 1열 접힘**(canvas.css @media) + **Paper 보드 46**(모자이크
  재배치 명세 6규칙) 신설. **보드 27 FactsCard "미해결" → 유리로 확정 해소.**
  부록 A2·보드 45 판정문·soul.md·palette.md 동기화.
- 미확인 1건(정직): 보드 46 스크린샷 검수가 Paper 응답 지연(타임아웃 2회)으로
  미완 — 노드 생성은 정상 응답. 다음 세션에서 열어 확인.

**2026-08-19 (6차·디자인 갈래) · 비판 후속 8결정 집행 후 재실측:**

```
app:
  npm test       → 151건 통과
  npm run verify → 검증 1~16 전부 통과 · exit 0 · "전 단언 통과"
  검증16(유리 사다리 신설) → 두 창 토큰 동일 · 순서 성립(0.30<0.45<0.50<0.55) ·
                             표면 렌더 일치(mosaic 0.50 / card 0.45 / chat 0.30)
```

**2026-08-19 (6차) 세션 기록 — 비판 권고 8건을 질의응답으로 확정·집행:**

- **경계 hover 광량**(`lib/edge-glow.js`, 두 창 공용) · **상단 그립 우선**(main.js
  will-resize 'top' 차단) · **□ 마지막 수동 높이 기억**(chat.js lastRestoreHeight +
  setChatHeight 수동 요청 workArea 클램프) · **설정 코치마크 최초 1회**(fixture 제외).
- **유리 사다리 규범 개정**: soul.md §7 완화책 2 개정, tokens.css `--glass-*` 4변수
  SSOT, verify 검증16 신설. two-windows.md 정정 3 표를 공식 사다리로 승격.
- **글자 크기 토큰 9단계**(`--text-2xs~hero`) 전면 치환 120건 + **텍스트 밝기 4단**
  (`--color-k-bright/soft/hint/ghost`) 치환 33건 — 실행: executor 에이전트, 검증 완료.
- **Paper 보드 45 신설(밝은 실배경 검증)** — **판정: 불통과.** 밝은 배경에서
  채팅창(0.30) 위 dim 텍스트 소실 실측 → 휘도 감지-적응(미구현)이 다음 웨이브
  실작업이어야 한다는 근거 확보. 상세: 디자인-비판-2026-08-18.md §4.

**2026-08-18 (5차·디자인 갈래) · 성역 없는 디자인 비판 → 즉시 수정 후 재실측:**

```
app:
  npm test       → 151건 통과
  npm run verify → 검증 1~15 전부 통과 · exit 0 · 실패 단언 0건
```

**2026-08-18 (5차) 세션 기록 — 사용자 지시 "디자인적으로 좋지 않은 부분 강도 높게 지적"**

- 딥 인터뷰로 범위 확정(3표면 · 성역 없음 · 지적 후 즉시 수정) → 렌즈 6종 병렬 비판
  에이전트 29건 수집 → 상위 8건 적대적 검증 → **확정 3 · 반박 5**. 전문은
  [`디자인-비판-2026-08-18.md`](디자인-비판-2026-08-18.md).
- **핵심 확정 결함**: "모든 표면이 유리다"(soul.md §7 타협 불가)가 캔버스 카드 1곳에만
  구현 — 설정·온보딩·인증 카드류는 전부 backdrop-filter 0건 평면. Paper 화면설계서도
  갱신 7보드 외 전부 구식 불투명 레시피("구현됨" 배지 보드 포함).
- **즉시 수정**: 앱 6개 표면 유리화(+access.css 폴백 확장), 금융 판단 텍스트 12px 하한
  (9.5px 배지 포함 5곳), md-h1 위계 역전, placeholder 자간, stale 주석 4곳,
  soul.md 미구현 태그·palette.md 스케일 주의 블록. Paper는 구형 노드 **55개 전수
  일괄 교체**(창급 25·행급 4·솔리드 10·평면 배경 14) — 화면설계서 전체가 부록 A2와 일치.
- **반박 5건의 교훈**: 3건이 capturePage() 캡처 한계(OS 합성 미포함)를 결함으로 오인 —
  CLAUDE.md §8 함정 그대로. 캡처 근거 지적은 OS 합성 캡처(03c류)로 재검증할 것.
- **남은 권고(무승인 실행 안 함)**: 자유 리사이즈 발견 가능성(신호 0개·grip 충돌·□ 토글
  상태 기계), 광량 3단 규칙 vs 실제 4값, 폰트 크기 토큰 부재, 설정 진입 무발견,
  명도 위계 이원화, Paper 실배경 검증 보드 — 비판 문서 §4.

**2026-08-18 (4차·디자인 갈래) · 자유 리사이즈 · 유리 하향 · 타이머 0.1s 후 재실측:**

```
backend:  변동 없음 (667 passed — 2차 블록 참조)
app:
  npm test                              → 151건 통과 (구성 3차와 동일)
  npm run verify                        → 검증 1~15 전부 통과 · exit 0 · 실패 단언 0건
  (3차 수치·Win+방향키 실측은 아래 3차 블록 참조)
```

**2026-08-18 (4차) 세션 기록 — 사용자 지시 3건 (디자인 수정):**

- **진행 타이머 0.1초 단위 표시(29.3s)**: 표기는 이미 `toFixed(1)`였지만 갱신 주기가
  1000ms라 소수 자리가 항상 `.0`으로 보였다 — `chat.js` tick을 100ms로 변경.
- **두 창 가로·세로 자유 리사이즈**: 캔버스 min=max 잠금·채팅창 폭 고정 제거(하한만:
  캔버스 480×320, 채팅 480×160). E3 치수는 부팅 기본값으로 강등(two-windows.md 정정 3).
  `handleForeignArrange`에 반절 스냅 기하 판별(`looksLikeOsSnapHalf`) 신설 — 없으면 모든
  사용자 리사이즈가 OS 스냅으로 오인돼 설계 치수로 되돌아간다. 수용 시
  `athena:manual-resize`로 렌더러 manualOverride를 켠다(자동 성장이 사용자 크기를 안 되감음).
  `setChatHeight`는 현재 폭 유지. verify 검증14의 크기 비교를 near(±2px)로 — 정확 일치는
  계약이 아니라 잠금의 부수 효과였다.
- **리퀴드 글래스 전체 하향("검은 창 같다")**: `--glass-alpha` 0.82↔0.97 → **0.30↔0.55**,
  캔버스 창 0.97 → **0.50**, 카드 0.55 → 0.45, frost-baked 0.86 → 0.78. 가독성 블러는
  acrylic·카드 backdrop-filter가 담당. `.app`에 상단 스펙큘러 인셋 + 테두리 승급(투명해질수록
  윤곽은 광량으로). Paper 화면설계서 반영: 보드 11·12·35·40·23·43·44 목업을 실제 투명
  유리(backdrop-filter)로 교체 + 데스크톱 배경 추가(굴절 대상), 부록 A2 수치 갱신
  (0.30/0.55/0.50, 폴백 0.55), 창 사양 문구 3건(자유 리사이즈) 갱신. 폐기 보드 41은 미변경.
- 부수: app/node_modules에 electron이 없어 5개 테스트 파일이 로드 실패하던 환경 결함
  발견(`npm install`로 해소 — 151건은 그 후 수치다).

**2026-08-18 (3차) · 설정 사이드바 개편 · 모델 설정 · Windows 창 단축키 후 재실측:**

```
backend:  변동 없음 (667 passed — 2차 블록 참조)
app:
  npm test                              → 151건 통과 (2차 110 + 모델 저장소 16 · 창 배치 9 · 러너 5 · codex-config 11)
  npm run verify                        → 검증 1~15 전부 통과 · exit 0 (14 창 배치 · 15 모델 설정+config.toml 신설)
  verify:settings / verify:settings-cards / probe-boot-bounds → 전부 exit 0
  Win+방향키 실측(OS 레벨 SendInput 4회) → ←/→ 짝 정착(경계 규칙 좌표 일치) · ↑ 최대화 토글 왕복 ·
                                          ↓ 최소화 — 원문 app/captures/qa-win-arrow.json
```

**2026-08-18 (3차) 세션 기록 — 사용자 지시 3건 (Paper 디자인 → 코드 → 실앱 QA 순서 준수):**

- **설정 사이드바 개편 + 모델 설정 신설**: 카드 나열 → 좌측 사이드바(화면·계좌·MCP 서버·
  모델) + 우측 패널. 계좌·MCP 패널은 기존 카드 이식(재작성 0), 모델 패널은 **CLI 다계정**
  (활성 전환·계정 추가 — 사용자 지시로 확정) + Claude 모델 칩(기본/fable/opus/sonnet/haiku +
  직접 입력)·사고 강도(low~max) + Codex(저장만, 정직성 노트). 결선: `athena-model.json` →
  `claude -p --model/--effort`(조사로 CLI 표면 확정). Paper 43쪽 신설, 23쪽은 "43쪽으로 대체" 표기.
- **Windows 창 단축키**: 사용자 의도 정정 — 자체 조합이 아니라 **Win+방향키가 그대로 통할 것**.
  실측이 설계를 두 번 뒤집었다: ① before-input-event는 OS 선점으로 도달 0건(1차 설계 폐기) →
  **스냅 대상화 승급**(resizable:true + 크기 잠금, OS가 움직인 결과 이벤트를 expectedBounds
  대조로 감지해 짝 정착) ② unmaximize 비동기 복원이 토글을 덮는 경쟁 → 위임을 unmaximize
  완료 후로 지연. 최종: ←/→ 좌우 절반 짝 배치 · ↑ 최대화 토글(렌더러 모드 가드 경로) ·
  ↓ 복원→최소화. Paper 44쪽 신설(실측 확정 문구 포함). 부수: 검증 스크립트의 직접 setBounds가
  OS 배치로 오인되는 회귀 2건을 `noteAppBounds` 표시로 해소.
- 상세는 `app/README.md` "설정 사이드바 · 모델 설정 · 창 단축키" 절.
- **(추가) Codex 설정 실결선** — "저장만"이던 Codex 모델·사고 강도를
  `$CODEX_HOME/config.toml`(`model` · `model_reasoning_effort`)에 **직접 반영**하는 구조로
  교체(사용자 지시). 알려진 키만 라인 단위 in-place 패치, 주석·미지 키·[섹션] 바이트 보존,
  원자적 쓰기, 무효값은 파일에 손대기 전 거부. `lib/main/codex-config.js` + 테스트 11건,
  verify 검증15 확장 6단언(CODEX_HOME 격리). **앱 밖 codex 사용에도 적용되는 전역
  기본값**임을 UI 정직성 노트에 명시. app 테스트 141 → 151.

**2026-08-18 (2차) · 전수검사 → 결함 수정 → 렌더러 격리 전환 후 재실측:**

```
backend 전체:  667 passed, 0 failed   (145초)   ← 659 − post_paged 테스트 3(데드코드 제거) + 회귀 11(MCP 6·selector 5)
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
  render_screen_injection_map.py --check→ Generated screen injection map is current
  render_screen_card_facts.py --check   → Generated screen card facts are current
app (렌더러 격리 전환 후):
  npm test                              → fail 0 (110건, node --test)
  npm run verify                        → 검증 1~13 전부 통과 · exit 0 (실패 시 exit 1 결선 신설 —
                                          app.quit()은 process.exitCode를 무시함을 실측, app.exit(1) 패턴)
  verify:settings / verify:settings-cards → 둘 다 exit 0
  probe-boot-bounds + 차트 프로브 5종     → 전부 exit 0
실배선:
  probe_live_spawn.js                   → ok:true · exit 0 · 캔버스 1건(table·폴백 없음) · 11.6초
```

**2026-08-18 (2차) 세션 기록 — 전수검사·질의응답·수정:**

- **전수검사 (감사 6기 + 조사 1기)** → 확정 결함 13건 전부 수정. 주요: 캔버스 창 Alt+F4 파괴
  후 미복구(HIGH, `app/main.js` close 가로채기+가드) · 브레인 기동 취소 시 락 누수(HIGH,
  `lifespan.py` BaseException 정리) · MCP rename 후 옛 이름 호출 거부(`aggregator.py` 포워딩) ·
  타임아웃/응답초과의 감사 로그 우회(`server.py`) · ingestion `start()` task 누수+TOCTOU ·
  `_join_task` 취소 삼킴 · 인증 화면 자동진행 타이머 경합(`auth-screen.js`). 상세 표는
  `backend/athena_mcp/README.md`(결함 #17~20)와 각 커밋.
- **질의응답 확정 결정 4건**: ① **plan_token 전면 1회용** — 한 질문의 계획 안에서 동일 API
  중복 호출은 비용 낭비, 재질의는 재-resolve로(`docs/LLM_API_SELECTION.md` Single-use 절,
  PLAN_ALREADY_USED 409) ② **렌더러 격리 전환**(클로드 데스크탑 방식) — contextIsolation +
  sandbox + preload 다리, 채널 allowlist(invoke 24·send 10·on 13), UMD 로딩(빌드 도구 없음),
  `mockdata` main 이관(`app/README.md` 전환 절) ③ MCP 스니펫 textarea 현행 유지 ④ Paper
  구현 배지는 기능 장표에만.
- **데드코드 제거**: `ws_last_error`(3지점) · `post_paged`+`max_pages` 전 연쇄 · no-op innerHTML.
- **Paper 화면설계서 배지 30장**: 기능 장표 우측 최상단에 구현됨 18 · 부분 구현 1(24쪽 —
  봉투 5상태 분기는 결선, 척추 메타 표시 미구현) · 미구현 10(25~34) · 폐기 1(41). 문서 장표
  12장은 표기 안 함(사용자 결정). 제목 실측으로 겹침 0 확인(7장 스크린샷 검증).

**2026-08-18 (1차) · 작업 브랜치 4종 병합 직후 `main`에서 재실측:**

```
backend 전체:  659 passed, 0 failed   (145초)   ← 장중(브레인 코디네이터·fts·cp949)+AITS(fit·매니페스트) 합산
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
  render_screen_injection_map.py --check→ Generated screen injection map is current
  render_screen_card_facts.py --check   → Generated screen card facts are current
app:
  npm test                              → fail 0 (110건, node --test)
  npm run verify                        → 검증 1~13 전부 통과 (1b 부팅바·9d 닫기→백그라운드·
                                          10 카드 배치·11 크기 불변·12 컬럼 fold·13 차트 카드 포함)
                                          확장 p95 33.3ms / max 50.1ms · 수축 p95 16.8ms
```

> **한글 경로 워크트리에서 드러난 cp949 환경 의존 결함 2건은 장중 브랜치에서 닫혔다**
> (§5 부수 기록 참조). 위 수치는 병합된 `main`(ASCII 경로)에서 돌린 결과다.

**2026-08-15 · 재검증:**

```
backend 전체:  494 passed, 0 failed   (138초)
  ruff check                → All checks passed
  tests/mcp                 → 191 passed (126 → 167 이식 절차·러너 → 191 잔여 5건)
```

> 이 워크트리에는 `backend/.venv`가 없었다. `uv sync --extra dev`로 새로 만들어 실행했다.

> 이전 스냅샷의 `403 passed, 22 failed`는 셀렉터 base/detail 라우팅 재설계로 해소됐다. §3 참조.

**2026-08-16 · 브랜치 `ANNJUNGCHAN/REST-API` 작업 트리 기준 재측정:**

```
backend 전체:  517 passed, 0 failed   (113초)
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
  render_screen_injection_map.py --check→ Generated screen injection map is current
  render_screen_card_facts.py --check   → Generated screen card facts are current
```

이 브랜치는 `main`에 없는 미커밋 작업(계좌 모듈, 셀렉터 수정, 화면기획서)을 포함한다. 517은
그 상태의 수치이지 `main`의 수치가 아니다.

**2026-08-17 (2차) · 액션 2·3·4 구현 후:**

```
backend 전체:  614 passed, 0 failed   (121초)   ← 브레인 결선으로 +11
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
app:
  npm test                              → 29 passed, 0 failed (node --test, electron 불필요)
  npm run verify                        → 검증 1~8 전부 통과 (모드 app · grownByPx 47)
  probe_live_spawn.js (수동·쿼터 소모)  → ok:true · exit:0 · 캔버스 1건 · 9,326ms
```

> **실배선은 `npm run verify`가 검증하지 않는다.** 자동 검증은
> `ATHENA_CANVAS_SOURCE=fixture` 고정이다(쿼터·43초·비결정성). 실배선 회귀는
> `node spike/cli-pipe/gateway/probe_live_spawn.js`를 **수동으로** 돌려야 잡힌다.

**2026-08-17 (1차) · 전면 재실측:**

```
backend 전체:  603 passed, 0 failed   (245초)
  tests/mcp                             → 205 passed  (이전 기록 191 — 낡았다)
  test_selector_core + test_selector_eval → 127 passed  (이전 기록 102 — 낡았다)
  공통화면 3종(manifest·card_facts·io_docs) → 25 passed
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
  render_screen_injection_map.py --check→ Generated screen injection map is current
  render_screen_card_facts.py --check   → Generated screen card facts are current
app:
  npm run verify                        → 검증 1~8 전부 통과 (검증 7은 15개 단언 전부 true)
                                          확장 p95 33.4ms / max 33.4ms · 수축 p95 16.8ms
  npm run verify:settings-cards         → 계좌·MCP 카드 상태 11장 캡처
```

> **⚠ 이 실측이 검증 자체의 결함 2건을 잡아냈고, 고친 뒤의 수치다.** 고치기 전
> `npm run verify`는 exit 0에 단언 전부 `true`를 내면서 **아무것도 검증하지 않고
> 있었다** — 계좌 미등록 머신에서 온보딩이 `#app`을 가린 채 검증 5~8이 숨은 DOM에
> 이벤트를 쐈고, 자동 성장 단언은 DPI 반올림 1px(205 > 204)에 통과했다. 원인·수정·
> 대가는 [`app/README.md`](../app/README.md) "검증이 스스로를 속인 결함". 잡은 방법은
> 단언을 읽은 게 아니라 **캡처를 열어본 것**이다(§3 "실측이 문서를 이긴다").

병합된 브랜치: `ANNJUNGCHAN/MCP` · `ANNJUNGCHAN/REST-API` · `ANNJUNGCHAN/Call` ·
`ANNJUNGCHAN/화면기획서-점검`. 각 워크트리의 미커밋 작업은 병합 전에 원자 커밋으로 보존했다
(`Call` 5건 +613줄, `REST-API` 4건 +2335줄). **네 브랜치와 워크트리는 병합 후 삭제했다 —
로컬·원격 모두 `main` 하나다.**

병합에서 내린 판단 3건:

1. **설정 독립 창을 버렸다.** `Call`이 만든 `settingsWin`(720×620 독립 `BrowserWindow`)은
   `MCP` 쪽 구현과 중복이고 "창은 둘" 원칙(`ui/soul.md` §8)에 걸린다. `app/settings.*` 4파일을
   삭제했다. 살아남은 설정은 계좌·MCP 카드다.
2. **오퍼레이션 계약 314 → 315.** `REST-API`의 split-base 라우트 제거(301 생성 라우트)에
   `Call`의 `get_internal_oauth_status` 1건을 더한 값. 서비스 오퍼레이션 13 → 14. 실행으로 확인.
3. **"일시 표면" 폐기가 정본이고, 설정을 대화 창으로 옮겼다.** 병합 직후에는 설정 카드가
   캔버스 창에 그려지고 있었다(`canvas.js`가 `settings-cards`를 import). `ui/DESIGN-SOUL.md:100`에
   기록된 결정 — *"#dot를 건들면 그냥 채팅창이 설정창으로 변하는 것이 좋겠다"* — 과 어긋나서
   대화 창의 `#settings` 패널로 옮겼다. `canvas.css` 383줄 중 설정 카드 스타일 282줄을
   `app/styles/settings-cards.css`로 분리해 대화 창이 싣는다.

> **⚠ 위 표의 "미착수" 표기 일부가 낡았다.** 병합으로 온보딩·인증·설정 모드가 실제 코드에
> 들어왔다. 갱신본은 [`GLOSSARY.md`](../GLOSSARY.md) §1과 [`ui/soul.md`](../ui/soul.md) §3의
> 실측 표를 따른다.

| 영역 | 상태 | 위치 |
|---|---|---|
| 키움 REST 백엔드 (301 라우팅) | **동작** | `backend/athena_api/` |
| MCP 게이트웨이 | **동작 · 실서버 이식 완료 · W1 잔여 5건 결선** · 205 테스트 통과 | `backend/athena_mcp/` |
| 투자 브레인 (그래프 투영) | **결선 완료** (2026-08-17) · 기본 비활성(`brain_enabled=false`) | `backend/athena_api/brain/` · `lifespan.py` |
| LLM API 셀렉터 | **동작** · 127 테스트 통과 (§3) | `backend/athena_api/selector/` |
| Electron 두 창 셸 | **동작 · 실배선 결선 완료** (2026-08-17) — `claude -p` 실호출 종단간 검증됨 | `app/` |
| 스파이크 실측 데이터 | 86건 보존 | `spike/captures/` |
| MCP 이식 절차 (등록→승인→probe→서빙) | **동작** · 외부 서버 3종 실왕복 | `athena_mcp/{onboarding,runner,__main__}.py` |
| CLI (`claude -p`) 연동 | **실왕복 통과** (2026-08-17) — 게이트웨이 툴이 실제 집행됨 | `spike/cli-pipe/gateway/RESULT.md` |
| 파수꾼·조사관 | **미착수** (설계만) | `plan/감시에이전트-실행계획.md` |
| 캔버스 설계 라운드 | **미착수** (초안만) | `plan/canvas-taxonomy.md` |
| 키움 공통화면 화면기획서 | **문서·아트보드 완료, 구현 미착수** | `plan/kiwoom-common-screen-spec.md` · Paper 아트보드 25~34 |

---

## 2. 지금까지 커밋된 것 (`b069106` 이후)

| 커밋 | 내용 |
|---|---|
| `8752378` | `.omc/`·`.omx/`·캐시 gitignore. 에이전트 런타임 상태는 저장소에 안 남긴다 |
| `e9c8eab` | **셀렉터** — catalog/lexicon/normalization/ranking/policy/plans + `/llm-tools` 라우트 + 골든셋 eval |
| `a7cd936` | **브레인** — ontology/extraction/ingestion/history/store (3,805줄 중 브레인 2,952줄) |
| `d877ea2` | **MCP 게이트웨이** — registry/client/result/aggregator/consent/quirks/stream/canvas/server |
| `76c8cbf` | **API 재생성** — `generate_api.py`가 공통화면 매니페스트를 읽어 routes/registry 생성. 에러·의존성 정리 |
| `4e4d885` | **Electron 셸** + `ui/` 디자인 규범 (63파일) |
| `b130485` | `plan/`·`spike/` 계획·실측 자료 (179파일). 빈 `README.md` 삭제 |

---

## 3. 해소됨 — 셀렉터 split-detail 라우팅 (2026-08-15)

**진단**: 검색은 처음부터 맞았다. 19개 실패 케이스 전부 정답이 1위였고 보통 2위의 3~7배였다.
되돌린 건 `policy.py`의 base/detail 게이트다. 같은 TR의 형제 상세는 **TR 제목 토큰을 공유하므로 구조적으로 절대하한(180)을 항상 넘는다.** `kt00018:holdings`는 1위가 2위의 6.8배(2435 vs 359)인데도 `len(meaningful) >= 2`에 걸려 base로 강등됐다.

**결정**: 임계값을 상대비로 손보는 대신 **detail을 검색 후보에서 빼고 인자로 강등**했다.
근거 — `generated/runtime.py:70-89`가 detail도 base와 **동일한 상류 호출 1회**를 하고 응답 필드만 거른다. base 선택은 데이터 손실도 레이트리밋 손해도 아니고 응답이 5.5배 넓어질 뿐이다(22개 TR 826→150 필드, 최악 `ka10007` 9배). **정합성 문제가 아니라 좁히기 문제였다.**

```
search   → base 171개 평면 (family만 판정)
describe → base:ka10004 의 detail_groups 9개 목록 반환
resolve  → detail_group="buy_bid_prices" 를 LLM이 명시, 서버는 소속만 검증
```

형제끼리 점수 경쟁이 사라졌다. 임계값 튜닝이 아니라 구조로 제거했다.
참조원 `migusdn/KIS_MCP_Server`의 `get-kis-api-spec(group, api_type)`가 원래 랭킹이 아니라 2인자 조회다.

**부수적으로 고친 실제 랭킹 결함 3건**:
1. 질의 **안**의 TR ID를 못 읽음 → `TR_ID_TOKEN_MATCH`(3,000). `EXACT_TR_ID`는 질의 전체가 ID일 때만 발동했다
2. 1토큰 제목(`totals`)이 1,400점 구절 보너스로 엉뚱한 family를 이김 → 구절은 2토큰 이상만
3. 질의 용어를 더 많이 덮은 family가, 한 단어로 여러 존에서 점수를 긁은 family에게 짐 → `QUERY_COVERAGE`(최대 600)

**남은 근사 실패 1건 (의도적으로 안 고침)**: `금일 재사용 금액만` → `base:kt00010`(1,449)이 정답 `base:kt00013`(1,379)보다 5% 높다. `resolve`는 `preferred_ref`로 정답에 도달한다. 골든 질문에 맞춰 lexicon을 넣는 건 도메인이 아니라 테스트에 맞추는 것이라 남겼다. detail/base 슬라이스 family top-1 = 43/44 = 0.977.

**변경 파일**: `selector/{catalog,ranking,policy,service,schemas,errors,normalization}.py` · `athena_api/errors.py` · `tests/unit/test_selector_{core,eval}.py` · `tests/fixtures/api_selector_golden.jsonl` · `docs/LLM_API_SELECTION.md`

---

## 4. 갈래별 상세 — 무엇이 되고 무엇이 안 되나

### A. MCP 게이트웨이 `backend/athena_mcp/`

외부 MCP 서버들을 집계해 **단일 MCP 서버로 재노출**한다. 205 테스트 통과 (2026-08-17).

| 모듈 | 역할 | 미완 |
|---|---|---|
| `registry.py` | 서버 등록, Claude Desktop 스니펫 파싱, **별칭=네임스페이스 키** | — |
| `client.py` | upstream stdio 클라이언트, 헬스체크·재시작 | — |
| `result.py` | `CallToolResult` 4단계 파싱 (★핵심) | — |
| `aggregator.py` | 툴 집계·네임스페이스·취소 리맵 | — |
| `consent.py` | 동의 게이트, 위험 패턴, 툴 allowlist | — |
| `quirks.py` | 서버별 결함 보정 (`corp_code` zfill 등) | — |
| `stream.py` | NAVER/DART 스트림 정규화 | — |
| `server.py` | 재노출 + `athena__render_canvas` | — |
| `onboarding.py` | 별칭 정규화·등록/승인 분리·probe | — |
| `runner.py` | `stdio_server()` + `Server.run()`, 실패 격리 | — |
| `__main__.py` | `athena-mcp` CLI 10개 서브커맨드 | — |

**실제 이식을 했다 (2026-08-15).** 클로드 데스크탑 스니펫 4개를 붙여넣어 등록 →
승인 → probe → 서빙까지 전 절차를 밟고, 게이트웨이를 **진짜 MCP 클라이언트로**
물어 28툴 노출·5건 호출을 확인했다. 상세와 실측 원문은
[`backend/athena_mcp/README.md`](../backend/athena_mcp/README.md) "실제 이식" 절.

```
28 tools: {'server-everything': 12, 'drfirst-korea-stock-mcp': 6, 'pykrx': 8, 'athena': 2}
```

이 과정에서 **결함 16건**이 드러나 전부 고쳤다(10건은 이식 중, 6건은 이어 돌린 적대적 리뷰가 잡았다 — 기각 0건)(엔트리포인트 부재, anyio 취소
스코프 위반, 타임아웃 부재, rename이 승인을 잃어버림, 캔버스 free 폴백이 죽은
가지였던 것 등). 목록은 README "이번에 고친 결함".

붙지 않은 서버 2종은 **전부 upstream 문제**였다 — `naver-search-mcp`는 API 키
없음(이 저장소에 `.env`가 없다), `pykrx-mcp`는 상류가 `mcp` 2.x를 끌어와
`mcp.server.fastmcp`가 사라짐(`uvx --with "mcp==1.28.*" pykrx-mcp`로 우회하면 붙는다).

**W1 잔여 5건도 닫았다 (2026-08-16).** "호출자 없는 메서드"와 "문서화된 미해결"로
남아 있던 것들이다 — 응답 크기 상한, 백그라운드 헬스체크 슈퍼바이저, 취소 전파 +
진행 알림 왕복, `truncate_at` 결선, 프롬프트 인젝션 최소 완화. 상세는 README
"W1 잔여 5건을 닫았다" 절.

이 과정에서 **SDK 실측이 전제 하나를 뒤집었다**: `notifications/cancelled`는
lowlevel `Server`에 원천적으로 도달하지 않는다(`mcp/shared/session.py`가
anyio 취소 스코프를 직접 취소한다). 즉 필요한 건 "리맵"이 아니라 "취소를 안
삼키는 것"이었다. 반대로 진행 알림은 SDK가 노출하고 있어서 지금 결선됐다.

보안 2건은 **둘 다 손댔지만 둘 다 안 닫혔다** (`SECURITY.md`):
- **[HIGH] 프롬프트 인젝션 — 부분 완화.** 툴 `description`에 출처 라벨이 붙었다.
  **응답 본문에는 여전히 아무 라벨도 없다.** 라벨은 방어가 아니다.
- **[MEDIUM] 응답 크기 — post-parse 상한만.** SDK `stdout_reader()`가 개행까지
  무제한 버퍼링하는 게 실측 확인됐고, 그 메모리 고갈은 이 상한 아래에서 이미
  일어난다. 전송 계층 방어는 `stdio_client` 포크가 필요하다.

### B. 투자 브레인 `backend/athena_api/brain/`

ADR: [`plan/investment-brain-architecture.md`](investment-brain-architecture.md).
**embedded LadybugDB `0.19.1` 그래프 투영**. `pyproject.toml`에 의존성 고정 완료.

- `ontology.py`(176) 스키마 · `extraction.py`(479) 엔티티/관계 추출 · `ingestion.py`(284) 적재 커서
- `history.py`(921) 시점별 이력 · `store.py`(651) 그래프 저장소
- 검색은 그래프 순회 + `fts` BM25만. **vector DB·embedding 없음** (ADR 결정)

**`GraphStore` 생애주기 결선 완료 (2026-08-17)** — 락 → DB open → 스키마 확인 → `fts` 로드 →
close가 lifespan에 대칭으로 붙었고 `app.state.brain_*`로 readiness가 드러난다.
대부분은 이미 `GraphStore` 안에 있었다(DB open · 스키마 확인). 새로 쓴 건 **프로세스 락**
(`BrainProcessLock` — DB 경로 해시 키. 자격증명 지문 기반 `CredentialProcessLock`을 전용하면
의미가 어긋난다)과 **`fts` 로드**(`GraphStore.load_fts_extension`), 그리고 lifespan 배선이다.

> **⚠ "ADR §4.2가 전부 됐다"는 뜻이 아니다.** 초판 기록이 과장이라 정정한다.
> **`lifespan.py`에 `IngestionCoordinator` 참조가 0건이다.** ADR §4.2 2단계가 말하는
> *"모든 graph mutation을 bounded `asyncio.Queue`에 enqueue하고 전용 writer task 하나가
> 순서대로 처리"* 가 바로 그 모듈인데, 지금 결선된 "writer queue"는
> `GraphStore._owner`(`ThreadPoolExecutor(max_workers=1)`)다. **DB 접근 직렬화라는
> 목적은 만족하지만 ADR이 지정한 큐는 아니다.** 따라서 3단계(shutdown 시 신규 enqueue
> 차단 → checkpoint → writer cancel)도 결선된 적이 없다. 아래 후속 16~17번.

~~**아직 사실이 아닌 것**: "검색은 그래프 순회 + `fts` BM25만"은 현재 코드와 다르다~~ →
**2026-08-18에 사실이 됐다.** `search_entities()`가 `QUERY_FTS_INDEX` BM25 랭킹을 쓰고
(fts 미로드 시 CONTAINS 폴백), 인덱스는 `load_fts_extension()`이 스키마 확인 후 1회 생성한다
(stemmer 'none', 라이브 인덱스 — 삽입분 자동 반영, 재오픈 시 재생성 불필요, 전부 tmp DB 실증).
**⚠ 단 fts는 완전 토큰 매칭이다** — "SK하이닉스"를 "하이닉스"로 못 찾는다(CONTAINS는 찾았다).
ADR §7의 recall 게이트가 후속으로 필요하다 (§5 신규 19번).

**환경 제약**: `ladybug.Database()`는 네이티브 공유 라이브러리를 찾아야 열린다.
못 찾으면 `RuntimeError: Could not find lbug C API shared library`.
프로덕션은 `ATHENA_LADYBUG_DLL_DIR`을 읽고, 테스트는 `C:\Program Files\Git\mingw64\bin`으로
폴백한다. **없어도 앱은 죽지 않는다** — `brain_last_error`에 기록하고 강등한다.

### C. LLM API 셀렉터 `backend/athena_api/selector/`

문서: [`backend/docs/LLM_API_SELECTION.md`](../backend/docs/LLM_API_SELECTION.md).
전체 스키마를 컨텍스트에 넣지 않고 `search → describe → resolve → call` 4단계로 좁힌다.
타입드 FastAPI 라우트를 대체하지 않는 **좁은 컨트롤 플레인**. 노출은 `api/llm_tools.py`.
→ 정확도 문제는 §3.

### D. Electron 셸 `app/`

대화 창(1560×204, 위로만 성장) + 캔버스 창(1560×800, clip-path 확장). Acrylic 기반 OS 합성.
실측 데이터로 렌더되고 접근성 3종(투명도/대비/모션 축소) 캡처 보유.

**알려진 리스크**: 확장 프레임이 실행마다 흔들린다. 2026-08-17 세 실행의 max가
33.4 / 49.9 / 33.4ms였고 이전 기록은 p95 54ms / max 89.5ms였다. → **2026-08-18
스파이크 실측으로 원인이 좁혀졌다**(`spike/glass-separation/RESULT.md`): 이
수치들은 전부 세션당 1회뿐인 확장이었고, 반복 계측(18회)에서 50ms급은 **세션 첫
확장에서만** 재현됐다 — 지배 요인은 굴절 재계산이 아니라 **첫 확장 워밍업**이다.
soul.md §7의 굴절층·데이터층 분리는 실측 결과 개선 없음 — **미채택**(다음 수 7).
실시간 카드(W3)가 생기면 재계측한다.

---

## 5. 다음 액션 (우선순위)

| # | 작업 | 이유 / 시작점 |
|---|---|---|
| 1 | ~~**갈래 A·B 조율**~~ → **의도적으로 둘로 간다** | 통합을 검토하고 기각했다. 전제가 다르다 — `AT-CV-005`는 스키마를 아는 키움 manifest 파생, MCP는 상류 스키마를 모르는 게 전제다. **렌더러가 둘이 되는 대가를 알고 받았다.** 아래 "결정 — MCP 봉투와 AT-CV-005는 별개로 간다" 참조 |
| 2 | **브레인 FastAPI 결선** → **`GraphStore`까지만 완료** (2026-08-17) | `lifespan.py`의 `_open_brain`/`_teardown_brain`. **기본 비활성**(`brain_enabled=false`) — 브레인은 키움과 무관한 선택 기능이고, 켜지 않은 배포·테스트가 DB 파일을 건드리지 않게 했다. 락은 `BrainProcessLock`(DB 경로 해시 키). 락 경합은 **기동을 막고**(ADR §11), 네이티브 런타임 부재는 **강등**한다(`brain_last_error`). ~~**`IngestionCoordinator`는 미결선** — 후속 16번~~ → **2026-08-18 결선 완료** (16·17번 참조) |
| 3 | ~~**CLI 연동 마무리**~~ → **완료** (2026-08-17) | `claude -p` → `athena-mcp serve` → 게이트웨이로 `athena__render_canvas` **실제 집행됨**. 원문 `spike/captures/S4-gateway-cli-roundtrip.ndjson`, 보고서 `spike/cli-pipe/gateway/RESULT.md` |
| 4 | ~~**stream-json 파서**~~ → **완료** (2026-08-17) | `app/lib/main/stream-json-parser.js`. 테스트 29건 전부 실왕복 캡처로 검증(지어낸 픽스처 0건) |
| 5 | **W3 캔버스 어댑터** — upstream 출력 → 캔버스 데이터 | 미착수. `stream.py`가 여기서 첫 프로덕션 호출자를 얻는다. 계약 형상은 이미 일치(`canvas.py` 스트림 스키마 ↔ `stream.py` 레코드) |
| 6 | **타임라인 캔버스** | 계획은 "타임라인부터"인데 `app/canvas.js`에 timeline 분기 자체가 없다(stream/reader/table만). 가격축은 KRX 승인 전까지 pykrx로 잠정 |
| 7 | ~~**프레임 최적화** — 굴절층/데이터층 분리~~ → **실측 완료 — 미채택(현 단계)** (2026-08-18) | 스파이크 ABC×6 인터리브 실측(`spike/glass-separation/RESULT.md`): 세 변형 median max 동일 16.8ms(60fps 상한). 변동의 지배 요인은 분리가 아니라 **세션 첫 확장 워밍업**(50ms급은 첫 사이클에서만, 이후 17회 전부 16.8ms). 실시간 카드(W3)가 생기면 재계측 — 토글·`npm run verify:glass` 존치 |
| 8 | 캔버스 설계 라운드 | 근거 ①②④ 확보됨. soul.md §9 프로세스로 |
| 9 | 파수꾼·조사관 착수 | `plan/감시에이전트-실행계획.md`. 주문 자동집행 없음(결정 3) |
| 10 | MCP 어댑터에 `detail_group` 반영 | 4툴을 MCP로 노출할 때 `describe.detail_groups` → `resolve.detail_group` 경로 필수 (`docs/LLM_API_SELECTION.md`). 현재 `athena_mcp`에 selector 참조 **0건** |

### 2026-08-17 결선에서 새로 열린 것

| # | 작업 | 근거 |
|---|---|---|
| 11 | **`render_canvas`가 캔버스별 `data` 스키마를 모델에 안 알려준다** | `_RENDER_CANVAS_INPUT_SCHEMA`가 `data`를 `{"type":"object"}`로만 선언한다. 실왕복에서 모델이 `table` 형상을 맞추는 데 **3회** 걸렸다(지연·토큰 3배). 실패 메시지는 정확했지만 스키마를 미리 주면 1회다. `canvas_type`별 `oneOf` 스키마가 답 |
| 12 | ~~**`fts` 로드는 됐는데 검색이 안 쓴다**~~ → **결선 완료** (2026-08-18) | `load_fts_extension()`이 인덱스(`CREATE_FTS_INDEX`, stemmer 'none', 라이브 인덱스)까지 만들고 `search_entities()`가 `QUERY_FTS_INDEX` BM25 랭킹을 쓴다. fts 미로드 시 CONTAINS 폴백 유지. **⚠ 실증에서 드러난 의미 변화**: fts는 완전 토큰 매칭이라 "SK하이닉스"를 "하이닉스"로 못 찾는다(CONTAINS는 찾았다) — ADR §7이 예정한 recall 게이트가 후속으로 필요하다(아래 신규 19번) |
| 13 | ~~**스폰된 `claude` 프로세스의 생애주기 관리가 없다**~~ → **닫힘** (2026-08-17 대부분 + 2026-08-18 잔여) | Esc→`killTree()`(트리 전체) · 타임아웃 180초 · 활성 1개 선점(`activeLiveQuery`)은 2026-08-17에, 마지막 잔여였던 **stdout 누적 상한**(5MB, `MAX_STDOUT_BYTES`, 초과 시 killTree + 오류 표면화 + 테스트 2건)은 2026-08-18에 닫혔다. 큐 대신 선점 방식 — `app/README.md` |
| 14 | **실배선을 자동 검증이 안 잡는다** | `npm run verify`는 `ATHENA_CANVAS_SOURCE=fixture` 고정이다(쿼터·43초·비결정성 때문에 의도된 분리). 실배선 회귀는 `probe_live_spawn.js` 수동 실행뿐 |
| 15 | ~~**실배선이 그리는 카드는 2종뿐**~~ → **4종** (2026-08-17 W3-lite, 이 행은 2026-08-18 동기화) | `mcp-table`·`free`·`notice`에 더해 `stream`·`reader`가 실배선에 결선됐다(`app/README.md` "실배선 스트림·리더"). **안 열린 건 `timeline` 하나뿐** — 액션 6과 동일. 단 stream/reader 실배선은 실왕복 캡처 검증이 아직이다(README 명시) |
| 16 | ~~**`IngestionCoordinator`를 lifespan에 결선**~~ → **결선 완료** (2026-08-18) | `_open_brain()`이 ADR §4.2 1단계 순서로 `HistoryStore.open()` + `IngestionCoordinator.start()`를 붙였고 `_teardown_brain()`이 3단계 순서(coordinator.stop → history.close → store.close → lock 해제)로 내린다. ingestion 실패는 fts와 같은 best-effort 강등(`ingestion_last_error`). `brain_history_db_path` 설정 신설. **⚠ 코디네이터는 아직 빈 HistoryStore 위에서 돈다** — `upsert_chat`/`upsert_completed_trade` 호출자가 저장소 전체에 0건. 실데이터 파이프라인은 후속(아래 신규 20번) |
| 17 | ~~**`IngestionCoordinator.enqueue()`가 shutdown을 안 본다**~~ → **닫힘** (2026-08-18, 16번보다 먼저 처리) | `_shutting_down` 별도 플래그 — `_stopping` 재사용 시 drain 중 writer가 조기 이탈하는 결함을 재현으로 확인하고 분리했다. `enqueue()` 이중 체크(진입 시 + `_queue_job` 반환), 내부 재적재(`wait=False`)는 안 막는다. stop() 반환 후 재시작 enqueue 허용(기존 재시작 계약 유지). 테스트 2건 |
| 18 | **프롬프트 인젝션 (HIGH) — 부분 완화 진전, 미해결 유지** (2026-08-18 동기화) | ~~"이번 결선에서 아무 대응도 하지 않았다"~~는 낡았다 — **응답 본문 라벨**(2026-08-17, `_label_upstream_result`)과 **위조 마커 무해화**(2026-08-18, `_defuse_embedded_markers` + 테스트 3건)가 붙었다. 남은 것: `structuredContent` 무라벨 · 내용 기반 탐지 미구현. 라벨은 완화이지 방어가 아니다 — 게이트는 여전히 툴별 allowlist (`SECURITY.md` §3) |

### 2026-08-19 R1 100건 QA에서 새로 열린 것

| # | 작업 | 근거 |
|---|---|---|
| ~~23~~ | ~~adversarial·gate 규율의 구조 레벨 강제~~ → **대부분 해소(2026-08-19 7차)** — 실기능(루틴·티켓)+규율 v3b로 P0 게이트 5/5·LIV-070 인수 통과. 잔여: 출처 지목 라우팅 검증·원문 미조회 결론 보류(챗 품질 축) | -p0gate·-p3accept run |
| 24 | **LIV-050 응답 생성 시간 예산** — upstream 전부 성공 후 180s 상한에서 답변이 타임아웃 문구로 대체. 꼬리 지연과 같은 뿌리. **새 증거(7차): LIV-066 p3accept 재실행도 동일 타임아웃**(차트 카드 173.7s 렌더 후 답변 미완, resolve 4연속 실패 낭비 포함) — 스키마 힌트 효과 재실측 + 부분 결과 보존 설계 | summary.md §3 · -p3accept run |
| 25 | **데이터셋 결함 잔여 4건 수정** — D-008(LIV-077)·D-014(095)·D-015(097)·D-016(023/073). ~~D-017~~은 7차에 수정 완료 | defect-queue.md |
| 26 | **LIV-096 하네스 한계** — 온보딩 3/3 "인증 연결됨" 상태 재현 불가로 blocked-env 잔존. 온보딩 상태 주입 방법 설계 필요 | run-cases-appmode.js caseLIV096 |

### 2026-08-18 실행에서 새로 열린 것

| # | 작업 | 근거 |
|---|---|---|
| 19 | **fts recall 게이트** — 토큰 매칭 전환의 품질 검증 | 액션 12를 닫으면서 검색 의미가 바뀌었다(부분문자열 → 완전 토큰). ADR §7이 예정한 대로 고정 corpus top-k recall을 검증하고, 미달 시 UI에 "키워드 검색" 한계를 표시하는 게이트가 필요하다. `store.py` docstring에 의미 변화 명시됨 |
| 20 | **브레인 실데이터 파이프라인** — HistoryStore 쓰기 호출자 0건 | 액션 16의 코디네이터는 **빈 HistoryStore 위에서 돈다.** `upsert_chat`/`upsert_completed_trade`를 부르는 곳이 brain/tests 밖에 없다 — 채팅·체결 캡처가 히스토리에 쓰는 파이프라인이 없으면 그래프는 영원히 비어 있다. `lifespan.py` `_open_brain` docstring에 명시. **⚠ 2026-08-18 결함 수정 감사에서 두 번째 갭 발견**: 설령 쓰기 파이프라인이 생겨도 `IngestionCoordinator`에 `source_projector`가 프로덕션에서 주입되지 않는다(`lifespan.py`의 `_open_brain`이 `IngestionCoordinator(history, store)`를 인자 없이 생성) — `ExtractionService` 인스턴스화가 저장소 전체에 0건이라 `SourceRecord`만 쌓이고 Entity/Claim/Relation 추출은 안 된다. G004(추출 결선)가 이 액션의 선행 조건 |
| 21 | **Kiwoom teardown 취소 안전 정비 검토** | 2026-08-18 (2차) 전수검사가 잡은 브레인 락 누수(수정됨)와 같은 패턴이 `lifespan.py` `_teardown`(Kiwoom 계정락)에도 있다. 사용자 결정으로 **브레인만 국소 수정**했고 Kiwoom 쪽은 의도적으로 남겼다 — 별도 스코프로 다룰 것 |
| 22 | **CC-102/103 프로브의 verify 게이트 편입 검토** | `chart-toolbar.js`·`chart-indicator-panel.js`는 단위 테스트 짝이 없고(DOM 의존) Electron 프로브(`probe-chart-toolbar/authoring.js`)만 커버한다. 프로브는 수동 실행이라 상시 게이트(`npm run verify`)에 안 물려 있다 |

> 부수 기록: 2026-08-17의 "614 passed"는 **ASCII 경로 워크트리 전제**였다. 한글 경로("장중")
> 워크트리에서 upstream 서브프로세스 stderr의 cp949 바이트가 utf-8 strict 디코드를 죽이는
> 환경 의존 결함 2건이 드러나 격리 워크트리 재현으로 증명 후 닫았다(`client.py`
> `read_log_text()` — errors="replace", 회귀 테스트 포함).

### 2026-08-18 질의응답 결정 — 카드 배치·생애주기

35쪽 장표의 미해결 2건을 질의응답으로 확정했다. 배치 규칙 원본은
[`plan/canvas-taxonomy.md`](canvas-taxonomy.md) "배치·생애주기 규칙 (2026-08-18 확정)",
굴절층 진행 방식은 위 다음 수 7에 반영.

| # | 작업 | 근거 |
|---|---|---|
| 19 | ~~**카드 배치·생애주기 규칙 앱 반영**~~ → **완료** (2026-08-18) | 폭 문법(w-half/w-full)·도착순(타입 고정 order 제거)·layout 힌트·drop_types 큐레이션·높이 예산(뷰포트 2배·최소 3장) 전부 결선. 로직은 `app/lib/canvas-layout.js`(단위 테스트 9건), 계약은 `server.py` `layout`/`drop_types`(pytest 2건), E2E는 verify 검증 10(합성 봉투 — 도착순·폭·승격/폴백·큐레이션·예산 집행 초록). 실배선 실측까지 완료(`spike/cli-pipe/gateway/probe_layout_curation.js` 실왕복 3회) — 배관은 결정적 통과, 자발 사용은 자연어 "치워줘·크게"만으로 `drop_types`·`layout` 사용 확인(N=1 일화 — 보장 아님. 부수로 11번 스키마 미고지 3회 재시도 재재현) |

### 2026-08-18 — 부팅 4단계 재정의 · 창 제어 버튼 (사용자 지시 2건)

- **부팅(AT-SY-001) 4단계 재작업**: 전개의 종착이 "상단 로고 + 하단 입력줄" 2분할이
  아니라 **평소 채팅바의 1:1 복제**가 됐고, 확정된 바의 입력줄에 ATHENA가 적혔다가
  placeholder로 돌아온 뒤 스왑한다(+1360ms). 근거·타임라인은
  `plan/paper-specs/AT-SY-001-부팅.md` "4단계 재정의" · `app/README.md` 부팅 절.
- **창 제어 버튼(AT-CH-001)**: 우상단 − · □ · ×. 최대화는 chatBaseH↔chatMaxH 토글
  (OS maximize 기각), 닫기는 두 창 숨김 + 백그라운드 유지 + 트레이 복귀.
  `plan/paper-specs/AT-CH-001-창-조작-이력.md` "추가" 절.
- **실측 (2026-08-18, orca 워크스페이스)**: `npm run verify` 검증 1~9d 전부 통과 —
  신설 검증 1b(`bootBar` — ATHENA 쓰고 지움을 DOM 표집으로 단언) ·
  9d(`closeToBackground`) 포함. `npm run verify:settings`는 이 워크스페이스에
  `backend/.venv`가 없어 mcp.* 절만 ENOENT로 미실측(환경 문제, 코드 무관) —
  리포트는 커밋본(완전 증거) 유지.

**2차 지시(같은 날): 부팅 전 구간 크기 = 채팅창.** "세로 전개도, 창 확정도 채팅창과 같은
크기여야 한다" — 앱은 실측으로 이미 준수(`app/probe-boot-bounds.js`: 부팅 내내 1560×204,
이후 789px 확장은 온보딩 전환), **보드 8쪽(1M-0)을 재작업했다**: 컬럼3(292×96)·컬럼4
(292×196)를 채팅창 비율 동일 크기 바 2개(각 292×38)로 교체, 스펙 패널 3·4단계·각주 갱신.
→ 다음 수 20 닫힘.

| # | 작업 | 근거 |
|---|---|---|
| ~~20~~ | ~~**Paper 보드 8쪽(1M-0) 컬럼4 재작업**~~ → **완료(2026-08-18)** | 위 2차 지시 블록 참조. (main 병합 시 19→20 재번호 — 19는 카드 배치 규칙이 선점) |
| ~~21~~ | ~~**Paper 보드 40쪽(6RX-0)에 창 제어 버튼 반영**~~ → **완료(2026-08-18)** | 목업 우상단 − · □ · × 크롬 + 배지 ⑥, Desc 5·6 병합으로 "창 제어 버튼" 항목 신설, 스트립·각주 갱신. `AT-CH-001-창-조작-이력.md` "추가" 절 참조. (main 병합 시 20→21 재번호) |

### Paper 화면설계서 정합 (2026-08-17)

Paper 파일(`Athena — 화면설계서`, 40장)과 앱·문서를 양방향으로 맞췄다:

1. **번호 충돌 4쌍 해소.** 24~27번 공통화면 장표가 옛 부록·End of Document와 같은 좌표에
   겹쳐 있었다(이전 문서의 "End를 35로 옮겼다"는 기록만 있고 파일 미반영). 부록 4장 → 36~39,
   End → 40. **공통화면 장표 25~34와 그 문서 참조는 그대로다.**
2. **앱에 있는데 Paper에 없던 것 2건을 신규 장표로 추가.** `23 · AT-CH-004 설정 모드`
   (05·06의 "차기" 표기가 낡아 있었다 — 실제로는 구현 완료), `35 · AT-CV-001 캔버스 창 기본`
   (현행 카드 6슬롯: 픽스처 stream/reader/table + 실배선 mcp-table/free/notice).
   각각 `plan/paper-specs/AT-CH-004-설정-모드.md` · `AT-CV-001-캔버스-창-기본.md`.
3. **05 구조도·06 목록을 실측에 맞춤.** 설정 카드 6종(AT-ST)은 캔버스 창이 아니라 대화 창
   설정 모드 소속으로 정정(병합 판단 1·3). 캔버스 계열은 현행/공통 API/데이터 3그룹.
   06 목록에 23~35 행 추가, ST 범례 정정, 부록 페이지 번호 갱신.
4. **paper-specs 낡은 참조 8건 정정** — AT-CV-OAUTH 3건은 AT-CH-005/006 개명 전 번호를,
   AT-ST-001~003·AT-SY-003은 재번호 전 번호를 인용하고 있었다.
5. **Paper에 있는데 앱에 없는 것 = 25~34(AT-CV-005 계열)** — 이미 G002~G007 로드맵이다.
   이번 감사로 새로 발견된 역방향 갭은 없다.

한계: Paper 데스크톱 렌더러가 세션 내내 캡처에 무응답이라(스크린샷 4회 타임아웃) **시각
검증은 못 했고** 트리·텍스트 구조 검증까지다. 좌표는 문서 모델(x/y)에는 반영됐으나 world
좌표 캐시가 낡아 있다 — 다음에 Paper 앱을 열어 23~40 구간을 훑고 겹침·잘림이 보이면 잡는다.

### AITS 커버리지 감사 (2026-08-17)

원문: [`plan/kiwoom-common-screen-aits-coverage-audit.md`](kiwoom-common-screen-aits-coverage-audit.md).
병렬 조사 3건 + **적대적 반박 2건(검증의 검증)** + 오케스트레이터 재계산으로 수행했다.

- **배정 커버리지 100% — 3중 검증.** in-scope 299(301 − oauth 2) 전부에 카드가 정확히 하나.
  셀렉터 대사 완전(불일치 = 의도된 제외 22 + hidden 2뿐, 역방향 0).
- **최소화 판정: 신규 카드 0종.** in-scope는 5종으로 충분(StatusCard는 oauth 전용 — 제외 기준
  밖), 카드 체계는 6종 유지가 정본. 추가 축소는 명목적이라 기각.
- **AITS(release/v1.0.0, 50bb5e7) 기능 갭 5건 — 전부 이유 확정**: 차트 저작 도구(저작 상태,
  결정 필요) · 정정/취소 diff 표(ActionCard 계약 개정 필요, spec §11-10) · 조건검색 5슬롯
  워크플로(§11-3 실증) · 알림 mutation(파수꾼 소관) · 카드 내 탭(커맨드바 재질의로 대체).
- **반박이 죽인 프레이밍**: "이질감은 이미 흡수 가능" — 흡수 규칙 6행은 코드 0건의 미착수
  계획(G001.5 대기)이었다. 실측 결함 2건 신규 확정: **ka10007 detail 9그룹 title TR ID 노출**
  (zero-tolerance 위반, 1순위 후속) · **ka10173 동명 컨테이너 2개**(규칙 사각지대).
- AITS 실측의 역설적 지지 3건: "시세표" = 단일 종목 스칼라 그리드(FactsCard 동형), "실시간체결"
  = 최신값 히어로(EventCard 동형), "조건검색 빌더"는 AITS에도 없었다(12종 렌즈 목록 재고 근거).
- **감사 직후 사용자 결정 4건 (2026-08-17, 감사 문서 §9)**: ① 주문 확인 = **대화 창 모드 단독**
  (ActionCard는 표시 전용으로 축소) ② 정정/취소 변형은 G001.5 시안 실물 비교 후 판정
  ③ **차트는 질의 기반 + 수동 드로잉 모두 지원, 토스증권 WTS 동등 기능 목표** — 렌즈가 저작
  상태를 갖도록 확장, **차트 렌즈 스펙 라운드 신설**(WTS 기능 실측 → 렌즈 계약 설계)
  ④ 상태 7종 정본 = spec §5 (rendering-plan §7.2는 구판 표시).

### 결정 D1 — 캔버스 페이로드가 UI에 닿는 경로 (2026-08-16 확정)

게이트웨이 프로세스와 Electron 렌더러는 별개 프로세스다. `athena__render_canvas`의
결과가 캔버스 창까지 가는 길을 **stream-json 파싱**으로 정했다:

```
Electron ──spawn──> claude -p ──stdio──> athena-mcp serve ──> upstream N개
   ^                    │
   └── stream-json ─────┘   tool_result에서 캔버스 페이로드를 뽑아 IPC로 렌더
```

게이트웨이는 순수 stdio MCP 서버로 남는다(변경 없음, 새 포트·인증 표면 없음).
대가는 stream-json 파서를 새로 써야 한다는 것 — 액션 4.

~~**지금 `app/`은 아직 목업이다.**~~ → **2026-08-17에 실배선이 깔렸다.**
`app/main.js`의 `athena__render_canvas` 핸들러가 `payload.source`로 갈린다 —
기본은 `claude-runner.runClaudeQuery`가 실제로 `claude -p`를 spawn하고,
`spike/captures/*.json` 목업은 **명시적으로 고른 픽스처 어댑터**로만 남았다
(`ATHENA_CANVAS_SOURCE=fixture`). 종단간 실호출로 검증됨.

**이 결선에서 실측이 추측을 뒤집었다.** 첫 구현이 *"Windows에서 `claude`는 `.cmd`
셸 래퍼"* 라는 추측으로 `shell:true`를 걸었는데, Windows `shell:true`는 **빈 문자열
인자를 삼킨다.** 그래서 `--setting-sources`가 다음 인자인 `--allowedTools`를 값으로
먹고 즉시 죽었다(`exit 1`, 319ms). 이 머신의 `claude`는 실제로는 진짜 `.exe`라
셸이 아예 필요 없었다. `shell:false`로 고쳐 통과.
**파서 단위 테스트 29건은 이 버그 전에도 후에도 전부 통과했다** — 캡처 픽스처로는
spawn 인자 전달을 못 잡는다. 상세는 `app/README.md`.

### MCP 공통 카드 — 봉투만 정의했다 (2026-08-16)

"모든 MCP의 정보를 담는 최소 공통 카드"를 요청받아 설계했다. 근거 조사가 먼저
답을 좁혔다(`paper-specs/02-MCP-응답-형상-전수조사.md`, 캡처 74건 전수·실호출 62건):

**7개 형상 클래스를 하나의 본문으로 정직하게 담을 수 없다.** A6(XML 유래 중첩
트리, 최대 1MB+)는 어떤 테이블로도 못 편다 — `canvas.py`의 자체 규칙이 이런 건
`free`로 보낸다. 그리고 **에러가 최대 클래스다(62건 중 17건)** — 테이블·타임라인·
스트림 어디에도 들어가면 안 되는 것이 가장 흔하다.

그런데 **모든 호출은 형상과 무관하게 자기 자신에 대한 같은 사실을 갖는다**:
어느 별칭의 어느 upstream 툴인가, 에러인가, 어느 파싱 경로로 왔는가
(`structuredContent`인가 텍스트 폴백인가), 잘렸는가, 인코딩이 깨졌는가, 얼마나
걸렸는가. 이 **불변 척추가 지금 아무 데도 없다.**

그래서 공통 카드를 **봉투 + 교체 가능한 본문 슬롯**으로 정의했다. 본문은 기존
4종(stream/reader/timeline/table)이 그대로 들어오고, 봉투는 새로 만든다.

**A/B 선택은 일부러 안 했다.** `paper-specs/04-공통카드-기존결정-대조.md`가
확인한 대로, 이 프로젝트엔 본문 모델이 이미 둘 있다 — 갈래 A(공통 테이블 +
스칼라 카드 묶음, 2개 프리미티브)와 갈래 B(키움 Adaptive Record 단일 셸, 3모드).
**봉투는 양쪽에서 똑같이 필요하므로**, 봉투만 정의하면 액션 1의 충돌을 암묵
선택으로 해결해버리지 않는다. 보드에 미결로 명시했다.

부수 효과로 백엔드에 결함 하나가 닫혔다 — 동의 게이트 거부와 upstream 에러가
형상이 같아 구분이 불가능했다. 이제 게이트웨이가 만든 `isError`에만
`_meta["athena/error_origin"]`이 붙는다(`gateway-blocked` / `upstream-failed`).
사용자가 할 수 있는 행동이 정반대라 이 구분이 실제로 쓸모가 있다.

**아직 없는 것**: 갈래 A가 요구하는 "스칼라 카드 묶음" 본문은 계획서에만 있고
`canvas.py`에 없다(A2/A4가 갈 곳이 없다). 봉투를 실제 렌더러로 구현하는 것도
아직이다 — 이번 작업은 설계와 명세까지다.

### 결정 — MCP 봉투와 AT-CV-005는 별개로 간다 (2026-08-16)

작업 중 Paper에 `25~34번`이 들어왔다. 사용자가 `AT-CV-005` 카드 6종으로 키움 REST
301개를 덮는 체계를 그렸다 — `25 · 공통 API 화면 원칙`의 Invariant 블록이 매핑을
못박는다: **264 read_display → Facts·Table·Compound / 23 websocket → Event /
12 order → Action / 2 oauth → Status**, "manifest 파생 · 하드코딩 없음".

봉투의 본문 슬롯에 이 6종을 넣어 MCP와 키움이 같은 렌더러를 쓰게 하는 안을
검토했고, **별개로 두기로 했다.** 근거는 두 체계의 전제가 다르다는 것이다 —
`AT-CV-005`는 키움 manifest에서 파생됐고 스키마를 아는 상태를 전제하는데,
MCP는 **상류 스키마를 모르는 것이 전제**다(그래서 `result.py`가 4단계로 추측하고,
`structuredContent`가 예외지 규칙이 아니며, A6는 어떤 카드에도 안 앉는다).

**대가를 명시한다: 렌더러가 둘이 된다.** 이건 §5 액션 1과
`00-인수인계.md` 충돌 ①이 경고한 바로 그 상태이고, 이 결정으로 **미해결이 아니라
"의도적으로 둘"로 확정됐다.** 나중에 합치려면 MCP 형상 7종이 6장에 실제로 앉는지
매핑 검증부터 해야 한다 — 이번엔 안 했다.

### ~~미룬 것~~ → 닫힘 — MCP env 암호화 (2026-08-17 커밋 `be9c855`, 이 절은 2026-08-18 동기화)

레지스트리엔 env 키 이름만 남기고, 값은 Electron `safeStorage`(DPAPI)에 넣고,
spawn 시점에 앱이 환경변수로 주입한다. ~~**구현은 안 했다**~~ → **구현됐다** —
`app/lib/main/mcp-env.js`가 safeStorage로 암호화하고, 부팅 시와 `mcp-list` 호출마다
`migratePlaintextEnv()`가 남은 평문을 멱등하게 걷어낸다(`app/README.md` "남은 문제" 절).
이 절이 "미룬 것"으로 남아 있던 건 문서 갱신 누락이었다.

**그때까지 넣는 키는 평문으로 디스크에 남는다**(`~/.athena/mcp_servers.json`).
나중에 암호화를 켜도 그 전에 저장된 값은 자동으로 옮겨가지 않는다 — 재등록하거나
파일을 직접 지워야 한다. 대가도 미리 적어둔다: 이 방식은 `.mcp.json`이
`athena-mcp serve`를 **앱 없이 직접 부르는 경로를 깨뜨린다**(그 경로엔
`safeStorage`가 없다). 상세는 `backend/athena_mcp/SECURITY.md` §6.

---

## 6. 막힌 것 — 코드로 못 푸는 것

| # | 무엇 | 누가 |
|---|---|---|
| 1 | **KRX 활용신청 미승인** — 21 엔드포인트 전부 `Unauthorized API Call` | **사용자**. `openapi.krx.co.kr` 마이페이지 → API별 활용신청. 타임라인 가격축이 여기 걸림 |
| 2 | **DART 키 없음** — §10이 정한 DART 서버 `chrisryugj/korean-dart-mcp`를 **한 번도 안 붙였다** | **사용자**. 리더 캔버스 실데이터 + `truncate_at` 실증 + 당일접수 실패 재확인이 전부 여기 걸림 |
| 3 | **NAVER 키 없음** (`NCP_APIGW_API_KEY_ID` 등) — `doctor`에서 FAIL | **사용자**. 스트림 캔버스 실데이터 |
| 4 | 프롬프트 인젝션 (HIGH) — 응답 본문 쪽 | 부분 완화됨(설명 라벨). 본문 라벨·상위 권한 게이트는 CLI 통합 시점 |
| 5 | `pykrx-mcp` 8툴 중 6 실패 (`400 LOGOUT`) | 상류 라이브러리 버그 |
| 6 | `@drfirst/korea-stock-mcp` 한글 손상 | 해당 서버 하나. 안 쓰면 무관 |

> §10이 정한 v1 서버 4종 중 **실제로 붙은 건 pykrx 하나**다(그것도 6툴 실패).
> `doctor`가 OK 내는 `server-everything`/`drfirst`는 v1 선택 집합이 아니라
> 스파이크 픽스처다 — 게이트웨이 배관이 동작한다는 증거이지 v1 서버가
> 동작한다는 증거가 아니다.

---

## 7. 재개 시 바로 쓰는 커맨드

모든 경로는 **저장소 루트 기준**이다. 루트에서 실행한다.

```bash
# 상태 확인
git status --short --branch
git log --oneline -8

# 백엔드 (병렬 약 1분 · 직렬은 약 3분)
cd backend && .venv/Scripts/python -m pytest -n auto --dist loadgroup -q
cd backend && .venv/Scripts/python -m pytest -q                      # 직렬(디버깅용)
cd backend && .venv/Scripts/python -m pytest tests/mcp -q            # 205 passed
cd backend && .venv/Scripts/python -m pytest tests/unit/test_selector_eval.py -x -q
cd backend && .venv/Scripts/python -m ruff check athena_api athena_mcp tests
cd backend && .venv/Scripts/python scripts/generate_api.py --check   # 생성물 드리프트 확인

# 앱
cd app && npm install && npm start      # 대화 창이 뜬다. 점을 누르면 캔버스가 퍼진다
cd app && npm run verify                # 스크린샷 + 프레임 실측 → app/captures/

# 스파이크 재현
spike/mcp-client/.venv/Scripts/python.exe spike/krx-probe/step1_auth_probe.py
spike/mcp-client/.venv/Scripts/python.exe spike/dart-survey/step2_dartmcp_calls.py

# CLI (쿼터 소모 주의 · --setting-sources 는 반드시 빈 문자열)
cd spike/cli-pipe/clean && claude -p "1+1은?" --output-format stream-json --verbose --setting-sources ""
```

---

## 8. 반드시 지킬 것

1. **`.env` 커밋 금지.** `.gitignore`에 있다. 키 상태는 `00-인수인계.md` §10.
2. **`.omc/`·`.omx/`는 커밋하지 않는다.** 에이전트 런타임 상태다.
3. **`spike/captures/` 86건을 버리지 마라.** 어댑터·캔버스·테스트의 유일한 근거이고, 지어낸 픽스처를 막아준다.
4. **`innerHTML` 문자열 삽입 금지.** `app/`은 전부 `textContent`/DOM 노드. 현재 0건 — 유지하라.
5. **`serverInfo.name`/`version`을 믿지 마라.** 별칭을 네임스페이스 키로 쓴다.
6. **콘솔 리다이렉트로 한글 판정하지 마라.** 이 환경은 cp949다. `encoding="utf-8"`로 파일에 쓰고 파일을 열어 확인.
7. **`app/main.js`의 `ATHENA_NO_AUTOSTART` 경로를 건드리지 마라.** `require.main === module`은 Electron에서 항상 false다.
8. **전체 스위트 실패를 숨기지 마라.** targeted 테스트가 통과해도 22건은 별도 리스크로 보고한다.

---

## 9. 아직 답 없는 질문

- **"공통 캔버스"의 상위 개념은 갈래 A인가 B인가** — 액션 2
- 자유 캔버스가 얼마나 자주 열려야 "정상"인가 (soul.md §5-5)
- 조사관이 틀린 인과를 말했을 때의 원장 피드백 — 설계만, 미구현
- 사후 뉴스 기반 인과 규명의 정량 게이트(선행성·고유성·유의성) 임계값 미정
