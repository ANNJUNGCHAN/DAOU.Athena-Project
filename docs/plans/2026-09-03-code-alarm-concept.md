# 코드 알람 — 구상 (2026-09-03, 사용자 결정 "템플릿 금지 · 코드 알람으로 간다")

브랜치 `feat/agent-dual-control`. 이 문서는 **구상**이다. 합의 계획이 아니며, Paper 보드를 먼저 그리고(디자인 우선 규칙) 사용자 확인 뒤 계획으로 넘어간다.

## 0. 한 문장

에이전트 모드의 알람은 **AI가 쓴 파이썬 감시 함수**다. 사용자가 말로 설명하면 AI가 코드를 짜고, 앱이 자동으로 검사하고(지난 N일 동안 몇 번 울렸을지 = 간단 백테스트), 함수 단위 노드로 보여 주고, 사람이 승인하면 루틴 실행기가 주기적으로 돌린다. 코드는 사용자 프로젝트 폴더 안 `.py` 한 장이고 사용자는 코드를 볼 필요가 없다.

## 1. 있는 것을 그대로 쓴다 (실측 근거는 §5)

| 필요 | 이미 있는 것 | 변경 |
|---|---|---|
| 코드 실행 격리 | `backtest/sandbox/host.run_strategy` — 별도 프로세스, 자격증명·DB 미전달, 30초 타임아웃, import 화이트리스트(pandas·numpy·math·statistics·datetime·athena_bt) | 0. 감시 함수도 `signals(df, p)` 계약을 그대로 쓴다. `entry` 열 = 발화, `exit`는 항상 False |
| 지표 25종 | `sandbox/api.py` `bt.sma/ema/rsi/atr/…` | 0 |
| 코드 → 노드·흐름 | `backtest/flow.build_flow` (ast만, 실행 없음) · `mapmodel.build_map` · `POST /backtest/flow`, `/map` | 소 — `entry·exit 두 열만 받습니다` 문구와 `returns_columns` 검사에 감시 분기 |
| 오류 → 진단 → 수정안 | `backtest/diagnose.diagnose` · `visual_repair` · `POST /backtest/diagnose` | 0 |
| AI가 코드를 쓰는 경로 | MCP `athena_backtest` `propose_code / read_code / diagnose / flow / map` — 프로젝트 폴더 안 `.py`만, 폴더 밖 금지 | 0 (툴 설명문에 "감시 함수" 용례 추가) |
| 일봉 데이터·캐시 | `backtest/data.backfill` + sqlite `bt_candle` (키움 REST ka10081, 일/주/월) | 0 |
| 실행·상태·쿨다운·만료·발화 기록 | `routines/` — `RoutineSpec`, `TriggerEngine`(쿨다운·연속·근접), `RoutineScheduler`, ledger, WS 알림 피드, 초안→확정 게이트 | 중 — §2 |
| 승인 카드 | `chat.js renderApprovalCard` — `미리보기 실행` 칩이 **비활성**("dry-run 개념 없음") | 이 칩이 간단 백테스트의 자리다 |

## 2. 새로 만드는 것 — 최소 집합

### 2-1. 감시 함수 계약 (백테스트 계약 재사용)

```python
PARAMS = {"days": 3, "ratio": 1.5}
def signals(df, p):            # df: open high low close volume, 오름차순 일봉 (+ 오늘 미완성 봉)
    ...
    return df.assign(entry=fire, exit=False)[["entry", "exit"]]
```

- 마지막 행의 `entry`가 참이면 발화. 쿨다운·연속 틱·근접 판정은 기존 `TriggerEngine`이 그대로 맡는다(관측값 = bool, 비교 `== True`).
- 첫 버전의 데이터는 **일봉 + 오늘 현재가**다. 실시간 틱(현재가·등락율·체결강도·VI)만으로는 지표를 못 만들고, 백테스트 데이터층이 일봉까지만 있으므로 검사(백테스트)와 실행이 같은 데이터를 보게 하려면 일봉이 맞다. 틱 기반 감시 함수는 2차(롤링 봉 버퍼 필요).

### 2-2. 루틴 모델 확장

- `SOURCES`에 `code.watch` — transport `"code"`, value_type `bool`, ops `("==",)`, label `코드 감시`. `derive_mode` → 새 mode `code-watch`.
- `RoutineSpec`에 `watch` 블록 신설: `{project_id, path, version_hash, params, poll_interval_s, lookback_days}`. `condition`은 건드리지 않는다(`_ALLOWED_CONDITION_KEYS`·리터럴 규칙 유지). 코드 원문은 저장하지 않는다 — 파일이 진실(백테스트 D2와 동일).
- `can_activate`에 `code-watch` 분기: 파일 존재 + 마지막 검사 통과 해시 일치 + 백테스트 모듈 활성일 때만 켜진다.
- **`routines/` 안에는 exec·compile을 두지 않는다**(소스 grep 테스트가 고정). 실행은 새 패키지 `athena_api/watch/`가 맡고 `runtime`이 그것을 주입받는다.

### 2-3. 실행 루프

- `RoutineScheduler`에 `_code_loop` 추가(`_schedule_loop`와 같은 모양, 주기 설정 `routines_code_poll_interval_seconds`, 기본 60초·장중만).
- 한 주기: 활성 `code-watch` 루틴을 종목별로 묶음 → 부모가 일봉 캐시(`bt_candle`) + 현재가(ka10001)로 df 구성(캐시 증분만 받아 레이트리밋 절약) → `run_in_executor`로 샌드박스 실행(실시간 루프를 막지 않는다) → 마지막 행 → `engine.evaluate` → 기존 `_handle_verdict`/`_fire`. 실행 시간은 ledger `duration_ms`에 싣는다(이미 있는 칸).
- ledger에는 코드 원문·stdout을 싣지 않는다(기존 규칙).

### 2-4. 간단 백테스트 = 검사

- `POST /api/v1/routines/watch/check` `{project_id, path, symbol, params, lookback_days}` → 일봉 백필(있으면 캐시) → 샌드박스 1회 → `entry` 열에 **쿨다운을 적용해** 발화 날짜를 센다 → `{ok, fires: [{dt, close}], count, lookback_days, last_fire, code_hash, flow}`.
- 이것이 승인 카드의 `미리보기 실행` 칩과 코드창 옆 명령창(보드 20의 "검사 3/3 통과")의 실체다. 검사 통과 해시가 `watch.version_hash`가 되고, 코드가 바뀌면 다시 검사부터.

### 2-5. 대화 경로

- `athena_routine` `draft`에 `watch` 블록 허용(모델이 코드를 쓰는 건 `athena_backtest.propose_code`, 등록 초안은 `athena_routine.draft`). 확정은 여전히 사람 칩·버튼만.
- 결과 카드: 검사 결과("지난 30일 4번 · 마지막 8/26"), 노드 요약("함수 3개: 거래량비율 · 돌파선 · 발화").

## 3. 화면 (Paper에 먼저 그린다 — A-2 뒤에 09~12 신설)

| 보드 | 내용 | 참고 보드 |
|---|---|---|
| 09 · 에이전트 — 새 알람 · 말로 설명 | 05의 「＋ 새 작업」 → 채팅 질문 카드(한 번에 하나) · AI가 코드를 쓰는 중 · 명령창 자동 검사 로그(코드창은 접힘) | 백테스트 20 |
| 10 · 에이전트 — 알람 노드·검사 결과 | 함수 단위 노드 흐름 + 간단 백테스트 카드(지난 30일 N번, 날짜 점 그래프) + 승인 칩/버튼 | 백테스트 21·23 |
| 11 · 에이전트 — 이상해요 루프 | 노드에서 "이상해요" → AI 고침 → 자동 재검사 → 노드 다시 그림 | 백테스트 22 |
| 12 · 에이전트 — 활성 코드 알람 상세 | 목록의 새 kind `코드 감시`(주기 확인과 구분), 상세 = 노드 요약 + 발화 이력 + 일시중지/취소 + 「코드 고치기」(대화로) | A-2 05·06 |

기존 07(제어 제안 턴)·08(결과 턴)은 그대로 쓴다. 06(설정 편집 폼)은 코드 알람에서는 **쿨다운·만료·설명·모델만** 남고 조건 편집은 "코드 고치기"로 간다(폼 분기 논쟁이 사라진다).

## 4. 순서

1. Paper 09~12 그리기 → 사용자 검수.
2. 백엔드 핵심: 2-1·2-2·2-4(check) + 테스트. 실행 루프(2-3)까지.
3. 대화·MCP: draft에 watch, 승인 카드 미리보기 칩 활성, 결과 카드.
4. 캔버스: 코드 감시 kind, 상세, 노드 재사용, 이상해요 루프.
5. 라이브 시연: 실제 키움 모의서버로 일봉 백필 → 검사 → 승인 → 폴링 발화.

그래프 연계(성향 신호 → 코드 알람 제안)는 사용자가 배치성으로 따로 지시한다 — 이 구상의 범위 밖.

## 5. 실측 근거 (2026-09-03 탐색)

- 샌드박스: `backtest/sandbox/host.py:101 run_strategy`, 경계 4종(env 화이트리스트 :32, DB 미전달, 프로세스, 타임아웃 :71), `guard.py:30 ALLOWED_TOP_LEVEL_IMPORTS`, `__main__.py:110-117` `signals(df,p)`·`entry/exit` 강제, `_coerce_signals :52`.
- 노드: `flow.py:207 build_flow`, `:302 returns_columns != {entry, exit}` 경고, `mapmodel.py:38 BOUNDARY_AFTER_NOTE`, `visual_registry` `output.entry/exit`.
- 데이터: `data.py:39 _SUPPORTED_PERIODS = day/week/month`, `backfill :227`, sqlite `bt_candle/bt_coverage`. 분봉·틱 없음.
- 실행기 재사용: `runner.py:82 _run_code_signals`, `:63 _align_signals`. `deploy.evaluate_latest :113`가 이미 "마지막 봉 한 개 판정" 구조.
- 루틴: `models.py:19 Transport`, `:44 SOURCES`, `:101 derive_mode`; `rules.py:5-6` exec 금지 grep 테스트, `:32 _ALLOWED_CONDITION_KEYS`; `runtime.py:71 can_activate`(미지 mode 거부 :85); `triggers.py:89 evaluate`, `duration_ms :98`; `scheduler.py:257 _realtime_loop`(단일 태스크), `:288 _schedule_loop`; `ledger.py:3-4` 원문 금지; `config.py:109 routines_schedule_poll_interval_seconds`.
- 앱: `chat.js:3014-3018` 미리보기 실행 비활성 사유, `:2935 approvalModeLine` 3분기(새 mode는 '틱 즉시'로 떨어짐); `agent-canvas.js:1282/1296/1310` kind 3종, `:140 statusRowIcon`; `backtest-canvas.js:97 DESIGN_TABS`; `graph-mode/controller.js:329 SURFACE_BY_VIEW`.
- MCP: `backtest_tools.py:41 _ALLOWED_ACTIONS`(propose_code·read_code·diagnose·flow·map 있음, activate·deploy 없음), `routine_tools.py:37`(draft·list·propose, confirm 없음).

## 6. 사용자 확정 (2026-09-03 2차) — 접근성·격리

- **코드는 참고용.** 파이썬은 기본 접힘("코드 · 참고 · 펼치기"), 직접 고치지 않아도 되고 고치는 건 말로 한다.
- **주인공은 노드·흐름.** 노드 = 이 알람의 함수 하나. 제목은 한국어(영어 함수명은 작게 참고 표기), 칸마다 **들어가는 값·나오는 값**을 실값으로 보여 준다(예: 들어감 오늘 거래량 1,890만주 · 평균 1,240만주 · 1.5배 → 나옴 1.52배 · 넘음). 코드를 전혀 모르는 사람이 대상이며 백테스트 모드보다 접근성이 훨씬 좋아야 한다.
- **데이터·자리 확정.** 일봉 + 오늘 현재가(1차), 에이전트 모드 안. 백테스트 부품(샌드박스·flow·diagnose·일봉 캐시)은 빌려 쓰되 **모드는 폴더 하나에서 작업해도 철저히 격리**한다 — 상태·화면·저장 위치가 섞이지 않는다.
- **Paper A-2 09~12 보드 신설**(2026-09-03): 09 새 알람·말로 설명(43WD-1) · 10 노드·흐름·검사 결과·승인(446V-1) · 11 이상해요 루프(44HD-1) · 12 활성 코드 알람 상세(44RV-1). 노드 카드 문법: 제목(한국어) / 영어명 참고(9px mono) / 들어감 행들 / 구분선 / 나옴(굵게). 바뀐 칸은 「방금 바뀜」(warn 테두리), 선택 칸은 진한 2px 테두리 + 「이상해요·물어볼게요」 칩.
