# 장중 실연결 검증 — 2026-09-01 (KST)

이 문서는 2026-09-01 **정규장 중**에 수행한 §4-B(장중에만 가능한 검증)의 결과다.
`docs/handoff/README.md`가 단일 진입점이고, 이 문서는 거기서 "실 키움 연결은 검증된 적이
없다"고 적어둔 항목에 대한 **최초의 실측 기록**이다.

측정 창: 09:25 ~ 15:30 KST. `probe-krx-live.js`가 보고한 `market_session`은 `정규장`.

---

## 1. 가장 중요한 정정 — "실 키움 연결"의 정의

이 저장소에서 **프로덕션 브로커 연결은 설계상 불가능하다.** 자격증명 문제도, 미설정도
아니다. 코드가 막는다.

| 위치 | 내용 |
|---|---|
| `backend/athena_api/config.py:14` | `KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"` |
| `backend/athena_api/config.py:311` | `kiwoom_base_url`이 그 값이 아니면 **ValueError로 기동 거부** |
| `backend/tests/unit/test_client.py:274` | `test_live_domain_is_rejected` — `api.kiwoom.com`을 주면 거부됨을 **테스트가 고정** |
| `backend/athena_api/kiwoom/ws_client.py:16` | WebSocket도 `wss://mockapi.kiwoom.com:10000` 고정 |
| `app/lib/main/accounts.js:24` | Electron 쪽도 `KIWOOM_HOST = 'mockapi.kiwoom.com'` |

즉 backend·Electron **양 계층 모두** 키움 모의투자 도메인에 하드락이 걸려 있다.
이것은 결함이 아니라 의도된 안전장치다. 사용자 확인 결과 **모의계좌만 진행하는 것이 맞다.**

따라서 `live_kiwoom_connectivity_verified: false`는 "아직 못 했다"가 아니라
**"이 코드베이스에서는 프로덕션 브로커를 향해 참이 될 수 없다"**로 읽어야 한다.
락을 제거하면 실주문 경로가 열리므로 건드리지 않았다.

### 그럼 오늘 무엇이 검증됐나 — provenance 분류

키움 **모의투자 서버는 장중에 실제 시장 시세를 준다.** 그래서 브로커와 시세를 갈라 적는다.

| 축 | 판정 | 근거 |
|---|---|---|
| 브로커(주문·계좌·체결) | **mock** | `mockapi.kiwoom.com` 하드락. 주문 API는 한 번도 호출하지 않음 |
| 시장 데이터(시세·호가·틱) | **live** | 응답에 장중 시각이 찍힘(아래 §3). 합성·fixture 아님 |

`live` / `mock` / `cache` / `fixture` / `UI draft` / `unknown` 중 이 세션이 새로 얻은 것은
**시장 데이터 축의 `live`** 하나다. 나머지 런타임 근거는 종전대로 fixture다.

---

## 2. 8/31 "조용한 실패"의 원인 — 규명됨

`beta-test-3day`가 "국내 시세 조회가 반복 실패했고 원인이 미규명"이라고 남긴 항목의
원인을 찾았다.

**`backend/.env`가 없으면 백엔드에 키움 계정이 0개다.** 그런데 앱 UI는 정상으로 보인다.

측정된 모순 상태(스크린샷으로 확인):

- 앱 좌하단: `81313844` · **초록 점** · "토큰 13시간 34분 남음"
- 같은 순간 백엔드: `/health` **200**, `/ready` **503 "Kiwoom data service is not ready"`**

원인은 저장소가 두 곳에 자격증명을 두고 **서로 잇지 않기** 때문이다.

| 저장소 | 위치 | 쓰는 곳 |
|---|---|---|
| Electron safeStorage | `%APPDATA%/athena-shell/athena-secrets.json` | `accounts.js`의 OAuth 검증·토큰 표시 |
| 백엔드 | `backend/.env` | **모든 시장 데이터** |

- `buildBackendEnv()`(`app/lib/main/backend-launcher.js:28`)는 키움 값을 **넘기지 않는다.**
- 백엔드는 `lifespan.py:470`에서 **기동 시점에** `Settings.kiwoom_accounts`로만 풀을 만든다.
  런타임 주입 경로가 없다.
- 앱을 띄워도 `.env`는 생기지 않는다(실측).

즉 **앱 UI에서 계좌를 등록해도 백엔드는 그 사실을 모른다.** 사용자에게는 초록불만 보인다.
`/health` 200이 `/ready`를 보장하지 않는다는 §5의 경고가 그대로 재현된 사례다.

> 이 갭 자체는 이번 세션에서 **고치지 않았다.** 설계 판단이 필요하고
> (`oauth_status.py`는 "configured=false"를 UI가 구분할 수 있게 만든 상태이기도 하다),
> 보안 영향이 있어 별도 승인이 필요하다. 다음 행동은 §6에 적었다.

해소: `backend/.env`를 사용자가 직접 작성(모의투자 app_key/secret_key 2계정 + 로컬 bearer).
`.env`는 `backend/.gitignore:1`이 잡으므로 git에 올라가지 않는다 —
**다른 컴퓨터로 넘어가지 않는다. 새 PC에서는 이 파일이 없는 게 정상이고, 없으면 시세가 전부 실패한다.**

---

## 3. §4-B 실측 결과

### (1) KRX 실 API 프로브 — 미설정

```
market_session      정규장
encryption_available true
secrets_store_exists true
key_resolved        false      ← KRX_API_KEY 없음
verdict             판정 불가 — 원문 확인 필요
```

`~/.athena/mcp_servers.json`이 없어 `korea-stock-mcp` 등록 자체가 없다.
**결함이 아니라 미설정이다.** 가짜 키는 `Unauthorized Key`를 받았으므로 엔드포인트는 살아 있다.

### (2) 실 키움 WebSocket 스윕 — 통과

`artifacts/live-websocket-sweep/sweep-20260901-114600.json` 외 2건.

| 항목 | 결과 |
|---|---|
| readiness | `{"status":"ready"}` 200 |
| REG | **19 / 19** 전부 `return_code 0` |
| 첫 REAL 프레임 수신 | **9** operation (0B·0D·0F·0G·0I·0J·0U·0w·1h) |
| 정확한 group REMOVE | **19 / 19** 전부 `return_code 0` |
| baseline(등록 전) | `{}` — 깨끗한 시작 |

**REMOVE 후 잔여 프레임 판정.** 3초 복원창에서는 `{0B:13, 0D:11, 0G:2, 0I:5}`가 남아
"REMOVE가 안 먹은 것"처럼 보였다. 관찰창을 30초로 늘려 판별했다:

- 30초 창 잔여: `{0B:8, 0D:11, 0G:2, 0I:5}` — **3초 창보다 늘지 않는다.**
- 0B 단독 진단: REMOVE 전 10초에 **68 프레임**(초당 ~7), REMOVE 후 **30초 내내 0**.

0B가 누수 중이라면 30초에 200개가 넘어야 한다. 따라서 잔여는 **in-flight 소진분**이고
**REMOVE는 정상 동작한다.** `REG → 첫 REAL → 정확한 group REMOVE → 새 프레임 없음`
한 세트가 완결된다.

> 하네스 한계로 기록: `live_websocket_sweep.py`의 3초 복원창은 고빈도 타입(0B·0D)에서
> in-flight와 실제 누수를 구분하지 못한다. 판정하려면 창을 늘려야 한다.

### (3) 국내 시세 조회 — 성공 (live market data)

`ka10003` 체결정보, 삼성전자 005930:

```
tm            115624        ← 11:56:24, 조회 시점의 실시간
cur_prc       -259500       259,500원
pred_pre      -500          전일 대비
pre_rt        -0.19         등락률 %
acc_trde_qty  6537984       누적 거래량
stex_tp       KRX
cntr_infr     30건
return_code   0
```

응답에 장중 시각이 찍혀 있으므로 **합성 프레임이나 fixture가 아니다.**

### (4) 백테스트 P2 실서버 실측 — 완료

설계서 `backtest-mode-plan.md` §5.2의 "600행/페이지"는 **가정**이었고 §10-2는
"최대 과거 시점 미실측"을 리스크로 적어뒀다. 둘 다 닫았다.

`ka10081` 일봉, 삼성전자, `base_dt`를 거슬러 올리며 19페이지:

| 실측 항목 | 결과 |
|---|---|
| 페이지 크기 | **정확히 600행** — 18페이지 연속 동일 |
| 마지막 페이지 | 19페이지 138행 → 20페이지 1행 |
| **조회 하한** | **1985-01-04** |
| 총 조회 가능량 | 약 10,938 거래일 (41년) |

설계서 §11의 해법 ⓑ("첫 백필 응답의 가장 오래된 봉을 그 종목의 조회 하한으로 기록")가
**실현 가능함이 확인됐다** — 하한이 실재하고, 마지막 페이지가 600 미만으로 끝나므로 감지된다.

**P1.5는 남았다.** numpy/pandas의 *패키징된 앱* 실측이라 장중과 무관하고 배포 빌드가 필요하다.

### (5) 주문 안전 경계

**주문 실행 0회 / broker mutation 0건.** 주문 API는 조회조차 하지 않았다.

> 주의: 사용자가 제공한 `.env`에 `ATHENA_ENABLE_ORDER_API=true`가 있고 `order_scopes`가
> 생략되어 **주문 라우트가 무제한으로 열려 있다.** 값을 임의로 바꾸지 않았다.
> 조회만 필요하다면 `order_scopes: []`로 좁히는 편이 안전하다.

---

## 4. §4-A 결과 (장 무관)

| 항목 | 기준선 | 실측 | 판정 |
|---|---|---|---|
| 게이트 4종 | 4/4 PASS | 4/4 PASS | ✅ |
| app 단위 | 1,946 / 0 fail | **1,946 / 0 fail** | ✅ |
| backend 전수 | 2,638 / 5 skipped / 0 | **2,638 / 5 skipped / 0** (19분 47초) | ✅ |
| verify:plugins | 116 단언 / 0 | **116 / 0** | ✅ |
| verify:kiumi | 19 / 0 | **19 / 0** | ✅ |
| verify:integrated-cards | 6카드 / 299op / missing 0 / unresolved 0 | **동일** (3,705 field) | ✅ |
| verify:semantic-workspaces | 12 recipe / exit 0 | **12 / exit 0** | ✅ |
| verify:hoga-live | rows 20 / card true | exit 0 (합성 프레임) | ✅ |
| verify:agent-paper-parity | 실패 0 | **실패 0 / 판정 true** | ✅ |
| verify:settings · settings-cards · life003 | — | 전부 exit 0 (life003 `pass:true`) | ✅ |
| probe-backtest-mode | 5 / 5 | **5 / 5** | ✅ |
| verify-brain-ready | 리포트 `failures` | **실패 2건** — §5 | ⚠ |
| 오브 프로브 배치 | §4.3 (9/20 중단) | §5 | — |

**probe-backtest-mode와 verify-brain-ready는 백엔드를 내린 상태에서 돌려야 한다.**
`probe-backtest-mode`의 04는 "백엔드 미기동 시 손쓸 수 있는 에러 문구"를 검사하므로
백엔드가 떠 있으면 반드시 실패한다. `verify-brain-ready`는 8010 점유를 시드 오염으로 보고 거부한다.

---

## 5. 이번에 찾은 함정과 결함

### 5.1 맨 `python` 호출 — 세 곳에서 같은 증상

백엔드 의존성은 `backend/.venv`에만 있는데 여러 하네스가 PATH의 맨 `python`을 부른다.
venv를 활성화하지 않은 셸에서는 전부 죽는다. **증상이 제각각이라 원인이 같아 보이지 않는다.**

| 하네스 | 증상 | 조치 |
|---|---|---|
| `app/lib/semantic-workspace.test.js` | app 단위 1,945/1,946 (`No module named 'fastapi'`) → **pre-push가 막힘** | `40c2e64` |
| `app/verify-integrated-cards.js` | `No module named 'pydantic'` | `dec17bc` |
| `app/verify-semantic-workspaces.js` | `No module named 'fastapi'` | `dec17bc` |

셋 다 `backend/.venv/Scripts/python.exe`를 기본값으로 쓰게 고쳤다(`ATHENA_FIXTURE_PYTHON` 우선,
venv 없으면 종전대로 `python`). 저장소 계약과도 맞다 —
`provider-runtime-bootstrap.test.js`는 맨 `python`을 게이트웨이 명령으로 **거부**한다.

### 5.2 맨 `node` 호출 — backend 32건

`backend/scripts/evaluate_selector_ablations.py:235`가 `subprocess.run(["node", ...])`를 쓴다.
node가 PATH에 없으면 `tests/unit/test_selector_autonomous_eval.py` **32건이 한꺼번에 실패**하고,
에러는 `FileNotFoundError [WinError 2]`뿐이라 원인이 드러나지 않는다.

**코드는 고치지 않았다** — README §2가 이미 fnm PATH를 요구한다. 대신 여기 적는다:
**backend 전수를 돌리기 전 `node --version`이 되는지 먼저 확인할 것.**

### 5.3 오브 프로브 배치가 매달린다 — 실측 1시간 30분

`probe-orb-mini-cards`가 배치에서 멈춰 진행을 막았다(KIUMI §2.1이 "배치에서 실패"라고
적어둔 바로 그 프로브다). 단순 실패가 아니라 **무한 정지**라 배치가 끝나지 않는다.

**KIUMI §2.1의 판정을 정정한다.** 상한을 걸고 다시 재보니 결과가 이랬다:

```
probe-orb-mini-cards    exit=TIMEOUT   ok=22   fail=0   181s
```

**단언 22건이 전부 통과한다.** "25초 안에 카드 7장이 안 나왔다"는 실패가 아니었다.
로그 끝은 이렇다:

```
[probe-orb-mini-cards] OK — 21-보드 09 규칙 5: ... innerHTML 주입 흔적이 없다
[probe-orb-mini-cards] 예외: [Error: UnknownVizError]
```

즉 **검증을 다 끝낸 뒤 예외가 나고, `app.exit(1)`(`probe-orb-mini-cards.js:366`)이
프로세스를 죽이지 못한다.** `UnknownVizError`는 이 저장소에 없는 식별자로 Chromium의
viz(GPU compositor) 계열이며, 프로브 말미의 캡처 단계에서 나는 것으로 보인다.

→ **앱 결함이 아니라 프로브의 뒷정리 결함이다.** 미니 카드 10종 자체는 배치에서도 정상이다.

배치 20개 중 **4개가 같은 증상**이다 — 전부 `fail=0`이다:

```
probe-orb-mini-cards        exit=TIMEOUT  ok=22  fail=0
probe-orb-mini-chart-card   exit=TIMEOUT  ok=15  fail=0
probe-orb-order-ticket      exit=TIMEOUT  ok=7   fail=0
probe-orb-table-fold-card   exit=TIMEOUT  ok=6   fail=0
```

**부분 수정했고, 종료는 아직 못 고쳤다.** `capturePage()`를 try/catch로 감싸 캡처 실패가
판정을 삼키지 않게 했다(리포트에 `capture_error`로 남는다). 그 결과 예외는 잡히지만
**프로세스는 여전히 종료되지 않는다** — 재측정 결과가 `exit=124 ok=22 fail=0`이다.

가설 하나는 반증됐다: GPU 가속 차이가 아니다. `probe-orb-chat.js`는 `capturePage()`를
세 번 부르고 `disableHardwareAcceleration()`도 안 부르는데 **정상 종료한다**(19초).
즉 "캡처를 부르면 안 죽는다"가 아니라 **캡처가 실패하는 상황에서만** 안 죽는다.

→ 남은 일: `UnknownVizError`가 나는 조건을 좁히고, `app.exit()`이 그 뒤 왜 무력한지
확인한다. 당장은 배치 상한이 완주를 보장하므로 진행을 막지는 않는다.

`scripts/run-orb-probes.sh`에 프로브별 상한을 넣었다(`ORB_PROBE_TIMEOUT_S`, 기본 180초).
초과분은 요약에 `TIMEOUT`으로 찍혀 성공/실패와 섞이지 않는다.

> `TaskStop`으로 배치를 멈춰도 자식 `bash`가 살아남아 계속 `taskkill electron.exe`를 돈다.
> 그 사이 켜져 있던 Athena 창도 함께 죽는다. 반드시 스크립트 프로세스를 직접 죽일 것.

### 5.4 `glad 02b` 미판정 — 원인 규명 (워크트리에서 회수)

KIUMI §2.2가 "확정 못 한 것"으로 남긴 건이다. 삭제 직전의 워크트리
`.claude/worktrees/kiummi-full-audit-f99978`에 **커밋되지 않은 조사 결과**가 있었다.

원인은 앱 결함이 아니라 **프로브의 측정 타이밍**이다. `orb.css`의 `.orb-eye`는
width/height/border-radius를 **220ms에 걸쳐** 전이하는데, 프로브는 `routine-event` 후
**200ms**에 잰다. 기계가 바쁘면 그 시점에 전이가 아직 시작조차 안 해서
**배경·테두리는 이미 아치인데 width/height는 직전 얼굴 값**이 나온다.
KIUMI §2.2가 기록한 `5.5 × 13.5 / radius 999px`(기본 눈 모양)이 정확히 그 상태다.

회수한 수정은 목표 모양이 될 때까지 최대 3초 폴링하되, 못 만나면 마지막 실측값을 그대로
돌려준다 — **기다림이 판정을 대신하지 않는다.**

### 5.5 verify-brain-ready 실패 2건 — 미판정

```
graph-mode: 그려진 버블 수가 배치 군집 수와 일치한다
agent-canvas-11: 스트립 부제가 신호 건수다
```

둘 다 프론트엔드 렌더링 단언이고, 이번 세션이 바꾼 backend registry와는 표면이 다르다.
다만 **사전 결함인지 확정하지 못했다** — 되돌리기 전 상태에서 같은 2건이 실패하는지
대조하지 않았다. 다음 행동은 §6.

> 참고: KIUMI §3.2가 적어둔 "`npm run verify`가 검증3c(플러그인)에서 중단"은
> **더 이상 재현되지 않는다.** 플러그인 단계를 지나 검증22·BOOT-001까지 진행한다.

---

## 6. 남은 일 — 이유와 다음 행동

| # | 항목 | 왜 못 닫았나 | 다음 행동 |
|---|---|---|---|
| 1 | 앱↔백엔드 자격증명 갭 | 설계·보안 판단 필요. 임의로 고칠 범위가 아니다 | 방안 제시 후 승인받아 구현. 최소한 UI가 `oauth_status.configured=false`를 초록불로 표시하지 않게 |
| 2 | `verify-brain-ready` 2건 | 사전 결함 여부 미대조 | `bc82e52^`에서 같은 하네스를 돌려 ok/fail 집합 비교 |
| 3 | 백테스트 P1.5 | 패키징된 앱 실측이라 배포 빌드 필요 | 배포 스크립트로 앱을 싸고 numpy/pandas import 실측 |
| 4 | Paper 캡처 검수 | `export`가 `No DOM element found`. 헤드리스로 못 푼다 | Paper 창을 포그라운드로 올려 `카드` 페이지를 띄운 뒤 재시도 |
| 5 | Paper 페이지 7→3장 | `delete_page` 도구가 없다 | **사용자가 UI에서 직접** 삭제 |
| 6 | 3일 베타테스트 | 72시간 중 실질 1세션. 완료 게이트 미충족 | `beta-test-3day/PROTOCOL.md` 절차 |
| 7 | KRX API 키 | 미설정 | 키를 발급해 `korea-stock-mcp`로 등록하면 §3(1) 재실행 가능 |
| 8 | 실앱 UI 실사용 | 컴퓨터 제어 권한이 거부됨 | 사용자가 직접 조작하거나 권한 승인 |

---

## 7. 이 세션이 바꾼 것

| 커밋 | 내용 |
|---|---|
| `40c2e64` | 백엔드 대조 테스트가 venv 인터프리터를 쓰게 한다 (app 단위 1,946/0 복구, pre-push 해제) |
| `dec17bc` | 검증 스크립트 2종이 venv 인터프리터로 fixture를 만들게 한다 |
| `bc82e52` | **unresolved 필드를 다시 제품 표면에서 숨긴다** — `b308ac7`이 노출로 뒤집은 것을 사용자 확인 후 되돌림 |

`bc82e52`에 대해: `b308ac7`은 성격이 다른 두 변경을 한 커밋에 담고 있었다.
(A) unresolved 노출 전환과 (B) 키움 공식 스펙 감사(hidden occurrence authority)다.
**되돌린 것은 A뿐이다.** B의 구조와 수치(transport 92 · internal 79 · semantic 3,531)는
그대로 살아 있다. 되돌리면서 노출을 고정하던 테스트 3건도 이전 계약으로 함께 되돌렸다.
