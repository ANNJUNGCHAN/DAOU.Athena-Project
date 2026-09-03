# 코드 알람 — 실행 계획 (RALPLAN-DR, short · iteration 2)

- Status: `approved for execution — ralph` (사용자 실행 승인 2026-09-03)
- Plan id: `code-alarm-plan`
- 근거 권위: `docs/plans/2026-09-03-code-alarm-concept.md`(§0~§6, 사용자 승인) + Paper A-2 보드 09(43WD-1)·10(446V-1)·11(44HD-1)·12(44RV-1). 두 근거가 갈리면 보드가 이긴다.
- 실측 지도: `docs/research/2026-09-03-code-alarm-reuse-map.md`
- 브랜치/워크트리: `feat/agent-dual-control` @ `.claude/worktrees/agent-dual-control-handoff-6f05c9`
- 앵커 규율: 줄 번호는 참고값, **이름이 계약**. 편집 전 이름으로 grep해 위치를 다시 잡는다.
- 사람 정지점: **딱 하나 — §4 Step 8 라이브 시연**. 앞 7단계는 무인 진행.
- iteration 2 반영: 아키텍트 지적 1~9, 크리틱 지적 1~15. 근거 문서 2건의 사실 오류(`propose_code` 착지점, TR 경로)도 같이 고쳤다.

## 0. 이 계획이 지키는 규칙

R1. `backend/athena_api/routines/` 안에 exec/eval/compile 계열 금지 — 소스 grep 테스트가 고정(`rules.py` docstring). 샌드박스 호출은 **새 패키지 `backend/athena_api/watch/`** 가 맡고 `RoutinesRuntime`이 주입받는다.
R2. 샌드박스 계약 무변경 — `signals(df, p)` → `entry`(=발화)·`exit`(항상 False) 2열, **마지막 행이 판정**. 자식(`backtest/sandbox/__main__.py`)은 스스로 `athena_bt` 별칭을 걸고 `guard.install()` 후 `exec`한다 — **부모가 `bt.*` 래퍼를 끼워 넣을 수 없다**(계측은 §1(c) 방식으로만).
R3. 활성화(확정)는 **사람 클릭만**. MCP는 draft·propose 계열만. ledger에 코드 원문·stdout 금지.
R4. 데이터 v1 = 일봉(`bt_candle` 캐시, `backtest/data.backfill`, ka10081) + 오늘 현재가(ka10001, `generated/registry.py`). **부모가 받아 df로 넘긴다**(자식은 자격증명·DB 없음).
R5. 모드 격리 — 루틴 저장은 JSON(`RoutineStore`), 감시 코드는 **프로젝트 폴더 안 `watch/<이름>.py`**. 알람 때문에 `bt_strategy`·`bt_strategy_version`·`bt_run`·`bt_deployment`·`user-strategies.json`에 행을 만들지 않는다. **허용된 부수효과는 공유 일봉 캐시뿐** — `bt_candle` 행 추가와 `bt_coverage`의 구간 확장(`data.py:326` 단일 연속 구간, 넓어지기만 하고 줄지 않는다).
R6. 한국어 문구 — 새/수정 사용자 노출 문자열에 서술형 종결(습니다/입니다/합니다/됩니다) 금지, 단위는 한국어(초·일·회·배·만주), 내부 용어(IPC/enum/draft/payload/API/REST) 금지. **툴팁·`title` 속성도 포함**.
R7. 노드 카드 문법(보드 10·11·12) — 한국어 제목(`NODE_LABELS`) / 영어 함수명 작게 참고 / 「들어감」 행들(기록된 호출 인자) / 구분선 / 「나옴」 굵게(기록된 반환 마지막 행). 바뀐 칸 「방금 바뀜」, 선택 칸 진한 테두리 + 「이상해요」·「물어볼게요」 칩. 파이썬은 접힘 「코드 · 참고 · 펼치기」.
R8. 확정 문구 — 칩 「이 알람 승인」·「고칠 게 있어」·「이대로 승인」·「아직 이상해」·「되돌리기」, 상태 「검사 통과」·「다시 검사 통과」·「지난 30일 N번」·「오늘이면 울림」·「오늘은 조용」·「코드 감시」.
R10. **활성·일시중지 알람의 코드 파일은 모델이 덮어쓰지 못한다** — `POST /watch/code`가 409로 거절(B-24). 화면 흐름: 활성·일시중지 알람에서 「고치기 — 말로」를 누르면 채팅이 먼저 멈춤을 묻고(칩 「일시중지하고 고치기」·「그대로 두기」), 사람이 멈춘 **뒤에야** 고쳐 쓰기로 넘어간다 — 409 문구는 사용자에게 노출하지 않는다(A-12).
R9. **감시 코드 착지는 에이전트 모드 전용 경로 하나뿐이다.** `athena_backtest.propose_code`는 `POST /backtest/strategies/{id}/versions` → `bt_strategy_version`으로 가고(`backtest_tools.py` `propose_code` 분기), `propose_file`은 백테스트 캔버스 `file_draft`로 간다(`app/main.js:2465` 부근). 둘 다 R5 위반이므로 **쓰지 않는다**.

**용어 정의(이 계획 전역)**
- 「장중」 = KST 평일 09:00–15:30. **휴장일 달력은 저장소에 없다** — 요일 기준만 쓴다.
- **오늘 봉 처리(한 곳에 정한다 — B-7·위험 15가 여기를 참조)**: 캐시에 오늘 일봉이 아직 없으면(장 시작 직후 등) **건너뛰지 않고** ka10001의 시가·고가·저가·현재가·거래량으로 오늘 봉을 합성해 마지막 행으로 붙인다. 건너뛰기는 **마지막 완성 일봉이 직전 평일보다 오래됐을 때만**(휴장일 추정) 적용하고 사유를 기록한다.
- `poll_interval_s` 하한은 **60초** — `MIN_COOLDOWN_S = 60`(`routines/models.py:229`)보다 짧게 확인해 봐야 쿨다운이 삼키므로 하한을 맞춘다. 상한 600초.
- `expires_days` 1~30(`MAX_EXPIRY = timedelta(days=30)`, `models.py:228`)은 코드 알람에도 그대로 적용되고, 상세 화면에 「만료 YYYY-MM-DD」로 보인다(보드 12 「만료 2026-10-03」).

## 1. RALPLAN-DR 요약

### 원칙 (P)
- P1. 빌려 쓰되 섞지 않는다 — 백테스트 부품은 쓰고, 상태·화면·저장 위치는 에이전트 모드 안.
- P2. 코드는 참고, 노드가 주인공 — 코드를 모르는 사람이 실값으로 이해한다.
- P3. 사람만 켠다.
- P4. **검사와 실행은 같은 함수·같은 데이터층을 쓰되 보는 봉이 다르다** — 검사는 **완성된 일봉(어제까지, D-1)** 만 세고, 실행 루프는 **오늘 진행 중 봉**을 마지막 행으로 본다. 이 비대칭을 숨기지 않고 화면에 「어제까지로 세었음 · 오늘은 진행 중」으로 적는다. 같은 D-1 봉을 주면 둘의 판정은 같아야 한다(B-18).
- P5. 변경 표면 최소.

### 결정 동인 (D)
D1 하드 제약 위반 0(exec 금지·Condition 리터럴·모드 격리) · D2 실값 노드 카드 접근성 · D3 운영 비용(프로세스 기동 + REST 호출).

### 선택지 (✅ 채택)

**(a) 감시 루프가 도는 곳**
- A1 ✅ `RoutineScheduler._code_loop` 신설(`_schedule_loop`와 같은 모양, 샌드박스는 `run_in_executor`).
  - 장: 만료·아카이브·ledger·`_handle_verdict`/`_fire` 배선을 그대로 탄다. / 단: 스케줄러 파일이 커진다.
- A2 별도 감시 서비스/워커로 분리.
  - 장: 블로킹 무관, 격리 확실. / 단: **기동·수명·재시작·부팅 재개(`open_routines`) 경로가 두 벌이 된다** — 배포 대상과 실패 모드가 두 배가 되고, 어느 쪽이 죽었는지 사용자에게 설명할 화면이 또 필요하다.
- 근거: D1·D3·P5. `_realtime_loop`가 단일 태스크라 블로킹 금지인 점은 `run_in_executor`로 푼다.

**(b) 코드 위치 저장**
- B1 ✅ `RoutineSpec.watch` 블록 `{project_id, path, version_hash, params, poll_interval_s, lookback_days}`. `condition` 무손상.
  - 장: `_ALLOWED_CONDITION_KEYS`·리터럴 규칙 무접촉, 저장 왕복 1곳. / 단: 스키마·업데이트 허용 필드가 늘어난다.
- B2 간접 테이블 + 루틴은 id만.
  - 장: 루틴 모델 변화 0. / 단: 저장소 하나 더(R5 위험), 원자성·고아 레코드, 상세 조회 2단.

**(c) 보드 10 노드 카드의 들어감/나옴 실값**
- C1 ✅ **opt-in `trace_names` + 최상위 함수 감싸기**. `exec` 뒤의 `strategy_globals`에는 중간값이 없다 — 그 값들은 `signals()` **안의 지역 변수**이고 자식은 `exec(code, strategy_globals)` 다음에 `signals_fn(bars, params)`를 부를 뿐이다(`sandbox/__main__.py`의 `exec` → `signals_fn` 호출 구간). 그러므로 **`signals_fn`을 부르기 직전에**, `trace_names`에 든 이름 중 `strategy_globals`의 최상위 호출가능 객체를 기록 래퍼로 바꿔 끼운다(`strategy_globals[name] = _record(name, fn)`). 래퍼는 호출 인자(Series·DataFrame이면 마지막 행 값, 스칼라는 그대로)와 반환값의 마지막 행을 잡아 `node_io.json`에 쓴다.
  - **`signals`도 감싼다** — 교체를 먼저 하고 **그 뒤에** `signals_fn = strategy_globals.get("signals")`를 집어 바깥 호출까지 기록에 잡히게 한다. 보드의 「알림」 칸 나옴 = 반환된 `entry`의 마지막 행이다.
  - 같은 함수가 여러 번 불리면 **마지막 호출**을 남긴다.
  - 구현 주의 2가지: ① 감싸기 전에 `callable` 검사를 먼저 한다(상수·모듈을 래핑하지 않는다). ② **오류 경로에서도 `node_io.json`을 쓴다** — 거기까지 잡힌 부분값이 `diagnose` 결과와 함께 화면에 붙어야 어디서 어긋났는지 보인다.
  - 크기 상한: 항목 64개, 값은 스칼라 또는 마지막 행으로만, 문자열 200자까지 — stdout 64KB 상한과 같은 취지로 `node_io.json`을 유계로 묶는다.
  - 노드 카드의 「들어감」과 「나옴」은 **둘 다 이 기록**에서 나오고, 한국어 제목만 `NODE_LABELS[함수명]`에서 온다.
  - **키가 없으면 자식 동작은 기존과 바이트 단위로 동일**(래퍼도 안 끼우고 `node_io.json`도 안 만든다) — 테스트로 고정(B-10a).
  - 장: 값이 진짜다(P2·D2), `signals(df,p)` 계약·guard·타임아웃 무손상. / 단: 자식에 래핑 구간과 산출물 1개 추가, 인라인으로만 쓴 계산(함수로 안 뺀 값)은 못 잡는다 — 그래서 노드는 함수 단위다(§1(d)).
- C2 `flow.build_flow` + 마지막 행만으로 정적 유도.
  - 장: 신규 코드 최소. / 단: 중간 칸(평균 거래량 1,240만주, 배수 1.52배)을 못 낸다 — 보드가 요구하는 값이 바로 그것. **탈락**.
- C3 LLM이 한국어로 값 설명 생성.
  - 반박: 화면에 「1.52배 · 넘음」으로 단정해 보여 주는 숫자를 실행하지 않고 지어내면, 틀렸을 때 사용자가 알아챌 방법이 없다. **탈락**.

**(d) 노드 분해와 한국어 제목**
- D1c ✅ **`watch/nodes.py` 자체 분해기 + `NODE_LABELS`**. `flow.build_flow`는 4개 **단계** 노드만 내고 보조 함수 정의는 `prepare`로 뭉친다(`flow.py` `build_flow`의 prepare 수집 로직) — 보드가 원하는 「함수 하나 = 칸 하나」가 안 나온다. 따라서 노드는 **감시 파일의 최상위 `FunctionDef` 하나당 하나**로 만들고, 제목은 AI가 같은 파일에 함께 쓰는 최상위 리터럴 `NODE_LABELS = {함수명: "한국어 제목"}`에서, 영어명은 함수명에서, 들어감은 파라미터·계측값에서, 나옴은 계측된 반환 마지막 행 값에서 온다. `build_flow`는 `unknown[]`과 `returns_columns` 경고 용도로만 쓴다.
  - 장: 코드·제목·해시가 한 파일 한 버전, 렌더 시 호출 0. / 단: 모델이 `NODE_LABELS`를 빠뜨릴 수 있다 → 검사 경고 + 영어 함수명 폴백(B-11).
- D2c 사후 번역표(백엔드 사전).
  - 단: AI가 짓는 임의 함수명을 사전이 못 따라간다. **탈락**.
- D3c 렌더 시 LLM 호출.
  - 반박: 같은 알람의 같은 칸이 볼 때마다 다른 이름으로 보이면 「방금 바뀜」 표시가 거짓말이 된다. **탈락**.

**(e) 검사 엔드포인트**
- E1 ✅ `POST /api/v1/routines/watch/check` 신설 — `fires` 날짜·`count`·쿨다운 반영·`code_hash`·`node_io`·경고를 바로 준다. `bt_run` 미생성(R5).
- E2 `POST /api/v1/backtest/runs` 재사용 — Job·`bt_run`·체결/비용이 붙어 R5가 깨지고 발화 날짜·쿨다운 시뮬레이션이 응답에 없다. **탈락**.

**(f) 감시 코드 착지**
- F1 ✅ `POST /api/v1/routines/watch/code` `{project_id, path, source, labels}` 신설 — `projects/store.resolve_in_project`(`store.py:140`)로 프로젝트 폴더 안 `watch/<이름>.py`에만 쓰고 `code_hash`를 돌려준다. MCP `athena_routine`에 action `propose_watch_code` 추가(또는 draft가 source를 실어 이 경로를 부른다).
  - **덮어쓰기 금지(R10)**: 활성·일시중지 상태의 code-watch가 가리키는 경로는 409로 거절한다. 모델이 쓸 수 있는 것은 새 파일이거나 초안 루틴이 가리키는 파일뿐이다. 409는 **사람에게 그대로 보이지 않는다** — 화면이 먼저 멈춤을 묻는다(R10 문단).
  - **백테스트 규범과 다른 점**: 백테스트에서는 모델이 낸 파일이 사람이 [적용]을 누른 뒤에만 디스크에 쓰인다(`propose_file` → 캔버스). 여기서는 초안 단계에서 바로 쓴다 — 검사를 돌리려면 파일이 있어야 하고, **켜지는 문(사람 클릭 확정)은 그대로**이며 R10이 이미 켜진 알람의 코드를 지키므로 받아들인다.
- F2 기존 `propose_code`/`propose_file` 재사용 — R9대로 백테스트 표·캔버스 착지라 **탈락**.

## 2. 요구 요약 · 범위 밖

**요구(보드)** ① 말로 설명 → AI가 감시 함수 작성(보드 09, 자동 검사 3단계 로그, 코드창 접힘) ② 자동 검사 = 미니 백테스트(보드 10 「지난 30일 4번 · 마지막 8/26」, 날짜 점, 쿨다운 1일 반영) ③ 함수 단위 노드 + 실값(보드 10·11) ④ 사람 승인 후 주기 실행 ⑤ 고침 루프(보드 11 「방금 바뀜」·「4번 → 2번 울림」) ⑥ 활성 상세(보드 12 kind 「코드 감시」, 오늘 확인 노드 요약, 울린 기록, 일시중지/취소/「고치기 — 말로」).

**범위 밖(v1)** 그래프 연계(성향 신호 → 알람 제안) · 틱/분봉 감시(롤링 봉 버퍼) · 코드 직접 편집 UI · 알람용 최적화·배포 · 알람 성과 지표.

## 3. 인수 기준 (AC)

### ① 백엔드 (pytest)
| AC | 내용 | 어디서 |
|---|---|---|
| B-1 | `SOURCES["code.watch"]` transport `code`·value_type `bool`·ops `("==",)`·label 「코드 감시」, `derive_mode` → `code-watch` | `tests/unit/test_routines_core.py` |
| B-2 | `watch` 블록 검증 — `.py` 아님·폴더 밖·`poll_interval_s` 60~600 밖·`lookback_days` 7~90 밖·`expires_days` 30 초과는 거절 | 〃 |
| B-3 | `condition` 규칙 불변 — `_ALLOWED_CONDITION_KEYS` 밖 키 거절, `watch`를 condition에 넣으면 거절 | 〃 |
| B-4 | store 왕복 — `watch` 있는 spec 저장→로드→`to_dict()` 동일, 코드 원문 필드 부재 | 〃 |
| B-5 | `can_activate` 사유 3종: 파일 없음 / `version_hash` 불일치 / **백테스트 실행층 미주입**(= `settings.backtest_enabled` false, `ATHENA_BACKTEST_ENABLED` 미설정 → 런타임에 watch 러너가 주입되지 않은 상태). 셋 다 충족 → `None` | 〃 |
| B-6 | `routines/` 소스에 exec/eval/compile 없음 | 기존 grep 테스트 |
| B-7 | df 조립(§0 「오늘 봉 처리」 규칙): 캐시에 오늘 일봉이 있으면 현재가로 갱신, 없으면 ka10001로 **합성**해 붙인다 → 마지막 행이 오늘, 열 `open high low close volume`, 오름차순. 마지막 완성 봉이 직전 평일보다 오래되면 건너뛰기 신호 | `tests/unit/test_watch_data.py`(신규) |
| B-8 | 실행: `signals` 마지막 행 True → `observed=True`, `duration_ms` 채워짐 | `tests/unit/test_watch_runner.py`(신규) |
| B-9 | 검사: 지난 30일 4회 발화 코드에 쿨다운 1일 적용 → `count`·`fires[].dt` 정확, `code_hash` 안정, **오늘 봉 제외(D-1까지)** | `tests/unit/test_watch_check.py`(신규) |
| B-10 | `trace_names`를 실은 실행에서 최상위 함수(**`signals` 포함**)가 래퍼로 감싸여 `node_io.json`에 **호출 인자(마지막 행)와 반환 마지막 행**이 남는다. 여러 번 호출되면 마지막 호출만, 항목 64개·문자열 200자 상한 준수, **중간에 예외가 나도 부분 기록이 남는다** | 〃 |
| B-10a | **`trace_names` 키가 없으면 자식 산출물이 기존과 동일** — `signals.csv`/`stdout`/`error.json`만, `node_io.json` 미생성 | `tests/unit/test_backtest_sandbox.py` |
| B-11 | `NODE_LABELS` 누락 함수는 경고 목록에 오르고 제목은 영어 함수명으로 대체 | `test_watch_check.py` |
| B-12 | `POST /routines/watch/check` 200 스키마, 문법 오류 코드 → `ok:false` + `diagnose` 결과 동봉(500 아님) | `tests/api/test_routines_watch_api.py`(신규) |
| B-13 | 검사·착지 1회로 `bt_run`·`bt_strategy`·`bt_strategy_version`·`bt_deployment` 행 +0, `user-strategies.json` 항목 +0. `bt_candle`은 증가 가능, **`bt_coverage` 구간은 넓어지기만 하고 줄지 않는다** | 〃 |
| B-14 | `_code_loop` 1주기: 활성 code-watch만, 종목별 데이터 1회, fired→ledger 기록·코드 원문 부재 | `tests/unit/test_routines_scheduler.py` |
| B-15 | `_code_loop`가 실시간 루프를 막지 않는다(샌드박스 스텁 지연 중 다른 태스크 진행) | 〃 |
| B-16 | MCP: `athena_routine`에 `propose_watch_code` 추가·`confirm` 여전히 부재, **`_INPUT_SCHEMA` 산문에 `code.watch`와 `watch` 블록 설명이 들어 있다**(문자열 포함 단언) | `tests/mcp/`(기존 파일 확장) |
| B-17 | `POST /{id}/update`가 code-watch 루틴의 condition 수정을 422로 거절(수정 가능: note·cooldown_s·expires_days·briefing_*·poll_interval_s) | `tests/api/test_routines_update.py` |
| B-18 | **검사↔실행 대칭**: 같은 코드·같은 종목에 D-1까지의 봉을 주면 검사의 D-1 판정과 루프 판정이 같다 | `test_watch_check.py` |
| B-19 | jobdir 정리·동시성: 스텁 100주기 후 임시 디렉터리 잔여 0, 동시 실행이 상한 상수를 넘지 않음 | `test_watch_runner.py` |
| B-20 | 재시작 쿨다운 복원: `watch`에 `last_fired_at`을 저장하고 부팅 시 `TriggerEngine` 상태로 되살린다 → 재시작 직후 쿨다운 안에서는 발화 없음 | `test_routines_core.py` + `test_routines_scheduler.py` |
| B-21 | 실행 시 해시 재확인: 활성 알람의 파일이 바뀌거나 사라지면 그 주기는 **실행하지 않고** 루틴을 `failed`로 옮기며 복구 안내 사건을 낸다(`routine-restore-failed` 계열) | `test_routines_scheduler.py` |
| B-22 | code-watch는 `ensure_realtime_subscription`을 부르지 않는다(확정·재개·부팅 재개 전부) | `tests/api/test_routines_api.py` |
| B-24 | `POST /watch/code`가 활성·일시중지 code-watch가 가리키는 경로를 덮어쓰려 하면 409 + 한국어 사유(「켜져 있는 알람의 코드는 못 바꿈 — 먼저 일시중지하거나 새로 만들기」). 새 파일·초안 참조 파일은 허용 | `tests/api/test_routines_watch_api.py` |
| B-23 | 계측 하한: **이번 실행에서 불린** 최상위 함수 전부에 들어감·나옴이 잡혀야 검사 통과. 불린 함수의 값이 비면 `ok:false` + 한국어 사유(「칸 N개의 값을 못 읽음 — 다시 만들어 볼게」). **한 번도 안 불린 함수는 실패가 아니다** — 그 칸은 「이번엔 안 쓰임」으로 그린다(카드 수는 그대로) | `test_watch_check.py` |

### ② 앱 (npm test / probe)
| AC | 내용 | 어디서 |
|---|---|---|
| A-1 | `toWatchItem`이 `mode==='code-watch'` → sub 「코드 감시」(「주기 확인」 폴백 금지) | `app/lib/agent-canvas.test.js` |
| A-2 | 상세 노드 카드: **개수 == 최상위 함수 수이고 2 이상**, 각 카드에 한국어 제목·영어명·「들어감」 행·「나옴」 값, 값 없으면 「—」 | 〃 |
| A-3 | 「방금 바뀜」이 바뀐 노드에만, 선택 노드에 「이상해요」·「물어볼게요」 칩 | 〃 |
| A-4 | 코드 블록 기본 접힘, 라벨 「코드 · 참고 · 펼치기」 | 〃 |
| A-5 | 상세에 「울린 기록」·「일시중지」·「취소」·「고치기 — 말로」·「만료 …」 존재, 조건 편집 폼 부재. 안 불린 함수 칸은 「이번엔 안 쓰임」 | 〃 |
| A-12 | 활성 알람에서 「고치기 — 말로」를 누르면 **먼저 멈춤을 묻는다** — 칩 「일시중지하고 고치기」·「그대로 두기」가 뜨고 409 문구는 화면에 안 나온다. 일시중지 상태에서는 바로 고치기로 넘어간다 | `app/lib/agent-canvas.test.js` |
| A-6 | `describeMode`는 **`app/lib/routine-turn.js:8`** 에 있고 `app/chat.js:2936`이 `routineTurnLib.describeMode`로 부른다. 여기와 `approvalModeLine` 둘 다 `code-watch` 분기를 가져 「주기 확인」·「틱 즉시」로 안 떨어진다. **3분기 문구를 못박은 `app/lib/routine-turn.test.js:19-22`를 code-watch까지 확장** | `app/lib/routine-turn.test.js` + `app/chat` 계열 테스트 |
| A-7 | 승인 카드의 「미리보기 실행」 자리가 **「검사」**로 활성, `title` 문구도 R6 준수(기존 '미리보기 실행은 아직 지원하지 않습니다' 제거), 누르면 검사 1회 → 「지난 30일 N번」 | 〃 |
| A-8 | 칩 「이 알람 승인」·「고칠 게 있어」, 고침 후 「이대로 승인」·「아직 이상해」·「되돌리기」 | 〃 |
| A-9 | **이번 변경에서 추가·수정한 문자열에 한해** 서술형 종결·내부 용어 없음(툴팁 포함) | 문자열 린트 테스트 |
| A-10 | 검사 결과 카드에 「어제까지로 세었음 · 오늘은 진행 중」 표기 | 〃 |
| A-11 | Paper 09~12 대조 항목 추가 후 parity 프로브 통과 | `app/probe-agent-paper-parity.js` |

### ③ 라이브 시연 (사람 정지점 — Step 8)
| AC | 보드 | 대조 항목(합격선: 전부 일치) | 증거 |
|---|---|---|---|
| L-1 | 09 | 헤더 「새 알람 · 거래량 급증 감시」·「AI가 감시 함수를 만드는 중」·「그만두기」 / 자동 검사 5줄(입력 확인 · 함수 만듦 · 검사 1/3 문법 · 2/3 지난 30일 · 3/3 오늘 값) / 노드 자리 4칸 · 코드 접힘 | 스크린샷 1장 + 보드와 나란히 |
| L-2 | 10 | 노드 카드 「일봉 불러오기 / 3일 거래량 평균 / 배수 비교 / 알림」에 들어감·나옴 실값 / 검사 카드 「N번 울림」·「마지막 8/26」·점 그래프·「쿨다운 1일 반영」 / 「어제까지로 세었음 · 오늘은 진행 중」 | 스크린샷 + 검사 응답 요약 |
| L-3 | 10 | 승인 패널 「이 알람 승인」·「고칠 게 있어」·「취소」, 확인 주기·쿨다운·만료·데이터 행 | 스크린샷 |
| L-4 | 12 | 승인 후 목록에 「코드 감시」, 한 폴링 주기 뒤 ledger 1행(fired 또는 suppressed), `duration_ms` 있음, 코드 원문 없음 | `backend/.../routines-ledger.jsonl`(경로는 `settings.routines_store_path` 옆) 해당 줄 + `grep -n "code.watch" <ledger> \| tail -3` 출력 |
| L-5 | 11 | 활성 알람에서 「고치기 — 말로」 → 멈춤 확인 칩 → 일시중지 후 한 바퀴 → 바뀐 칸에 「방금 바뀜」, 「다시 검사 통과」, 「4번 → 2번 울림」 꼴 비교, 「되돌리기」 노출 | 스크린샷 |

## 4. 구현 순서

### Step 1 — 루틴 계약
- 파일: `routines/models.py`(`Transport`·`SOURCES`·`derive_mode`·`RoutineSpec`·`to_dict`, `watch.last_fired_at`), `rules.py`(`validate_draft`에 watch 검증; `validate_condition` 무손상), `store.py`, `runtime.py`(`can_activate` 분기).
- 검증: `cd backend && uv run pytest tests/unit/test_routines_core.py -q`
- AC: B-1~B-6, B-20(저장 측).

### Step 2 — 샌드박스 계측(opt-in)
- 파일: `backtest/sandbox/host.py`(`spec.json`에 `trace_names` 선택 전달), `backtest/sandbox/__main__.py`(`signals_fn` 호출 **직전**에 최상위 호출가능 객체를 기록 래퍼로 교체, 호출 뒤 `node_io.json` 기록).
- 규칙: 키 부재 시 래핑도 산출물도 없고 기존 동작 바이트 동일. guard·import 허용목록·타임아웃·`signals` 계약 무변경. 기록은 마지막 호출만, 항목 64개·문자열 200자 상한.
- 검증: `cd backend && uv run pytest tests/unit/test_backtest_sandbox.py tests/unit/test_backtest_runner.py tests/unit/test_backtest_codegen.py tests/unit/test_backtest_source_map.py tests/unit/test_backtest_deploy.py -q`
- AC: B-10a(+ 백테스트 회귀 0).

### Step 3 — `backend/athena_api/watch/` 패키지
- 파일(신규): `watch/__init__.py`, `watch/data.py`(캐시 일봉 + 현재가 → df), `watch/runner.py`(`sandbox.host.run_strategy`를 `run_in_executor`로, jobdir는 **스레드 안 try/finally로 삭제**(`backtest/runner.py:107-118`과 같은 이유), 동시 실행 상한 상수), `watch/check.py`(D-1까지 미니 백테스트 + 쿨다운 시뮬레이션 + 발화 날짜), `watch/nodes.py`(최상위 함수 분해 + `NODE_LABELS` + `node_io` 병합 + `build_flow`의 `unknown`/`returns_columns` 경고).
- 검증: `cd backend && uv run pytest tests/unit/test_watch_data.py tests/unit/test_watch_runner.py tests/unit/test_watch_check.py -q`
- AC: B-7~B-11, B-18, B-19, B-23.

### Step 4 — 감시 코드 착지 경로
- 파일: `api/routines.py`(`POST /watch/code`), `watch/store_code.py`(신규 — `projects/store.resolve_in_project` 경유, `<project>/watch/<slug>.py`만 허용, `code_hash` 반환), `athena_mcp/routine_tools.py`(`_ALLOWED_ACTIONS`에 `propose_watch_code`, `_INPUT_SCHEMA` 산문 갱신).
- 규칙: 백테스트 표·등록부 무접촉(R5·R9). 「이상해요」 수리는 `POST /backtest/diagnose`(읽기)와 이 경로의 재작성으로만 돈다 — `propose_code`는 쓰지 않는다.
- 검증: `cd backend && uv run pytest tests/api/test_routines_watch_api.py tests/mcp -q`
- AC: B-13(착지 측), B-16, B-24.

### Step 5 — REST + 실행 루프
- 파일: `api/routines.py`(`POST /watch/check`, `POST /draft`가 watch 수용, `_detail_view`에 노드·검사 요약, `_UPDATABLE_FIELDS`에 `poll_interval_s`, code-watch condition 수정 422), `routines/scheduler.py`(`_code_loop` — 장중 요일 판정, 종목별 묶기, 해시 재확인, 실패 시 `failed` 전이), `routines/runtime.py`(watch 러너 주입, code-watch는 구독 안 잡음), `config.py`(`routines_code_poll_interval_seconds = 60.0`, `routines_code_rest_calls_per_cycle`).
- 검증: `cd backend && uv run pytest tests/api/test_routines_watch_api.py tests/api/test_routines_update.py tests/api/test_routines_detail.py tests/api/test_routines_api.py tests/unit/test_routines_scheduler.py -q`
- AC: B-12~B-15, B-17, B-20(복원), B-21, B-22.

### Step 6 — 대화
- 파일: `app/chat.js`(`describeMode`·`approvalModeLine`에 `code-watch`, 「미리보기 실행」 → 「검사」 활성 + `title` 교체, 검사 결과 카드 + 「어제까지로 세었음 · 오늘은 진행 중」, 승인·고침 칩 R8), `app/main.js`·`app/preload.js`(검사·착지 통로 — 기존 routine-* 핸들러와 같은 모양), `athena_mcp/backtest_tools.py` 설명문에 「감시 함수 진단은 diagnose까지만」 한 줄.
- 검증: `cd app && npm test`
- AC: A-6~A-10.

### Step 7 — 캔버스 + 테스트·프로브·문서
- 파일: `app/lib/agent-canvas.js`(`toWatchItem` code-watch, `statusRowIcon`, `detailFieldsFor`/`renderDetail`에 노드 카드·자동 검사 로그·접힌 코드·「방금 바뀜」·선택 칩·울린 기록 드릴인·만료), `app/canvas.js`, `app/lib/agent-canvas.test.js`, `app/probe-agent-paper-parity.js`(보드 09~12), `PAPER_APP_PARITY.md`.
- 검증: `cd app && npm test && npm run verify:agent-paper-parity`
- AC: A-1~A-5, A-11.

### Step 8 — 🛑 라이브 시연 (사람 정지점)
- 절차: `cd app && npm start`(실제 모의서버) → 005930 60일 일봉 백필 → 대화로 「삼성전자 거래량이 최근 3일 평균의 1.5배 넘으면 알려줘」 → 자동 검사 → 「이 알람 승인」 → 한 폴링 주기 관측 → 「고치기 — 말로」 한 바퀴.
- AC: L-1~L-5.

## 5. 위험과 완화

| # | 위험 | 완화 | 고정 AC |
|---|---|---|---|
| 1 | 주기마다 샌드박스 프로세스 기동 비용 | 종목별 1회, 기본 60초·장중만, 동시 실행 상한 상수, `duration_ms` 감시 | B-19 |
| 2 | 리미터 소진 | **주기당 REST 호출 예산 설정값**(`routines_code_rest_calls_per_cycle`)으로 상한. `RateLimiter.headroom()`은 1초 창이라 예산이 아니라 **순간 폭주 가드**로만 쓴다 | B-14 |
| 3 | 오늘 미완성 봉 — 검사와 실행이 다른 봉을 본다 | P4대로 검사는 D-1까지만 세고 화면에 명시, 같은 봉에서 판정 일치를 테스트 | B-9, B-18, A-10 |
| 4 | 재시작 시 쿨다운 소실 | `watch.last_fired_at`을 store에 남기고 부팅 시 복원 | B-20 |
| 5 | `approvalModeLine`/`describeMode` 폴백으로 「틱 즉시」·「방식 undefined」 | 두 분기 동시 추가 + 테스트 | A-6 |
| 6 | `toWatchItem` else가 「주기 확인」으로 라벨 | 명시 매핑으로 교체 | A-1 |
| 7 | `flow.py`의 `returns_columns` 경고가 감시 함수에 노출 | 감시도 같은 2열이라 원칙적으로 안 뜬다. 뜨면 내부 경고로만 남기고 사용자에게 안 보인다 | B-11 |
| 8 | 모드 격리 누수(백테스트 표·등록부·캔버스 착지) | 착지 경로 F1 하나로 고정, 행 증가 0을 기계 검증, `bt_coverage`는 확장만 | B-13, R9 |
| 9 | 계측 추가가 백테스트 경로를 흔든다 | `trace_names` opt-in, 부재 시 동일 동작 + 백테스트 전 회귀 | B-10a, V2 |
| 10 | LLM이 금지 모듈 import·무한 루프 | `guard.ALLOWED_TOP_LEVEL_IMPORTS` + 타임아웃 kill, 실패는 `diagnose` 한국어 사유, 검사 통과 전 활성화 불가 | B-5, B-12 |
| 11 | `NODE_LABELS` 누락·엉뚱한 제목 | 경고 + 영어명 폴백, 「고치기 — 말로」로 재작성 | B-11 |
| 12 | 계측 매칭 실패로 칸이 다 비어 보임 | 최상위 함수 전부에 나옴 값이 없으면 검사 실패 처리 | B-23 |
| 13 | 활성 중 파일이 바뀌거나 지워짐 | 매 주기 해시 재확인, 불일치면 실행 없이 `failed` 전이 + 복구 안내 | B-21 |
| 14 | 불필요한 WS 구독으로 리미터 소모 | code-watch는 구독 경로를 타지 않는다 | B-22 |
| 15 | 휴장일에 어제 봉으로 헛발화 | §0 「오늘 봉 처리」 — 오늘 봉이 없으면 현재가로 합성하고, **마지막 완성 봉이 직전 평일보다 오래됐을 때만** 건너뛰며 사유 기록 | B-7, B-14 |
| 16 | jobdir 잔여(윈도우 삭제 실패) | 스레드 안 try/finally 삭제, 100주기 잔여 0 | B-19 |

## 6. 검증 게이트

기준선을 **변경 전에** 먼저 기록한다: `.omc/state/code-alarm-baseline.txt`에 backend/app/parity 3줄(passed·failed·assert 수). 판정은 매 게이트 `failed == 0 && passed >= baseline`.

| 게이트 | 명령 | 기준 |
|---|---|---|
| V0 | 위 기준선 기록(현재값: backend 3,169 passed/0 failed · app 2,295/2,295 · parity 프로브 `check()` 35회) | 파일 존재 |
| V1 | `cd backend && uv run pytest tests/unit/test_routines_core.py -q` | 실패 0 (Step 1) |
| V2 | `cd backend && uv run pytest tests/unit/test_backtest_sandbox.py tests/unit/test_backtest_runner.py tests/unit/test_backtest_codegen.py tests/unit/test_backtest_source_map.py tests/unit/test_backtest_deploy.py tests/api/test_backtest_api.py tests/api/test_backtest_api_extended.py -q` | 실패 0 (Step 2 — 계측이 백테스트를 안 흔든다) |
| V3 | `cd backend && uv run pytest tests/unit/test_watch_data.py tests/unit/test_watch_runner.py tests/unit/test_watch_check.py -q` | 실패 0 (Step 3) |
| V4 | `cd backend && uv run pytest tests/api/test_routines_watch_api.py tests/api/test_routines_update.py tests/api/test_routines_detail.py tests/api/test_routines_api.py tests/unit/test_routines_scheduler.py tests/mcp -q` | 실패 0 (Step 4·5) |
| V5 | `cd backend && uv run pytest -q` | `failed == 0 && passed >= 3169` |
| V6 | `cd app && npm test` | `failed == 0 && passed >= 2295` |
| V7 | `cd app && npm run verify:agent-paper-parity` | 실패 0, `check()` 수 >= 35. 프로브는 이미 `.probe-agent-paper-parity-profile`을 매 실행 지우고 새로 만든다 — 삭제가 EPERM으로 실패하면(MCP 자식 잠금) 프로필 폴더를 손으로 지우고 다시 돌린다 |
| V8 | 라이브 시연(Step 8) | L-1~L-5 — **사람 정지점** |

주: `uv run pytest`가 0건 수집되면 `rtk proxy uv run pytest`. `| tail`은 exit 코드를 가리므로 붙이지 않는다.

## 7. ADR

- **결정**: 코드 알람은 (a) `RoutineScheduler._code_loop`에서 돌고, (b) `RoutineSpec.watch` 블록이 코드 위치·해시·마지막 발화를 갖고, (c) 노드 실값은 **opt-in `trace_names` 계측**으로 만들고, (d) 노드는 **`watch/nodes.py`의 자체 분해기**가 최상위 함수 단위로 내고 제목은 코드 파일의 `NODE_LABELS`에서 오고, (e) 검사는 `POST /api/v1/routines/watch/check`, (f) 코드 착지는 `POST /api/v1/routines/watch/code` 전용 경로다. 실행 코드는 `routines/` 밖 `athena_api/watch/`에 둔다.
- **동인**: D1 하드 제약 위반 0 · D2 실값 접근성 · D3 운영 비용.
- **검토한 대안**: 별도 감시 서비스 · 간접 테이블 · 정적 노드 유도 · 렌더 시 LLM · 사후 번역표 · `/backtest/runs` 재사용 · `propose_code`/`propose_file` 재사용.
- **채택 이유**: 채택안만이 exec 금지·Condition 리터럴·모드 격리를 동시에 지키면서 보드 10·11이 요구하는 중간 실값과 함수 단위 칸을 낸다. 탈락안은 각각 수명 경로 이중화(A2), 상태 분산(B2), 값 부재(C2), 비결정성(C3·D3c), 이름 추종 불가(D2c), 격리 위반(E2·F2)에서 걸린다.
- **결과**: 루틴 모델·스케줄러·상세 화면이 커진다. 샌드박스 자식이 조건부 산출물 하나를 더 낸다(부재 시 무변경). 감시 코드 파일이 `NODE_LABELS`라는 추가 계약을 진다. 일봉 캐시는 두 모드가 계속 공유한다.
- **후속**: 틱/분봉 감시 · 휴장일 달력 도입 · 그래프 신호 → 알람 제안 · 알람 발화 후 성과 회고 · 다종목 한 함수 감시.
