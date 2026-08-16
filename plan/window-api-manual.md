# 창별 API 설명서 — 설정 창 · 캔버스 창

> 작성일: 2026-08-16 · 저장소: `C:\Users\ajc22\orca\workspaces\DAOU.Athena\Call` · 브랜치: `ANNJUNGCHAN/Call`
> 상태: **검토 대기.** §7의 판단 항목에 답을 받은 뒤 확정한다.
> 용어는 [`GLOSSARY.md`](../GLOSSARY.md)를 따른다. 깊은 계약 원문은 [`backend/docs/LLM_API_SELECTION.md`](../backend/docs/LLM_API_SELECTION.md)(셀렉터), [`backend/docs/KIWOOM_API_IO.md`](../backend/docs/KIWOOM_API_IO.md)(TR별 I/O).
> 이 문서는 **창 관점의 지도**다 — "어느 창이 무엇을 부르는가". 화면 형태 설계는 [`kiwoom-common-template-fit-dissonance-plan.md`](kiwoom-common-template-fit-dissonance-plan.md).
> 표의 모든 수치·경로는 코드 실측이다. 실측 못 한 것은 `[미측정]`으로 적었다.

---

## 0. 한 장 요약

| 표면 | 쓰는 API | 개수 | 부수효과 | 구현 |
|---|---|---:|---|---|
| **설정 창** | 내부 OAuth 상태·토큰 제어 3개 + Electron IPC 6개 | 3 + 6 | 토큰 발급/폐기만 | **구현·검증됨** |
| **캔버스 창** | 셀렉터 4-tool → 조회 TR 171 + 상세 투영 115 | 4 + 286 | 없음(읽기 전용) | 계약 구현됨 / **Electron 배선 미착수** |
| 캔버스 창(실시간) | WS 등록·해제 라우트 23 + 이벤트 스트림 1 | 24 | 구독 생명주기 | 백엔드만 |
| 주문 팝업 | 주문 라우트 12 | 12 | **주문 집행** | 미착수(설계만) |
| (숨김) | OAuth 발급·폐기 2 | 2 | 토큰 | 설정 창이 대신 부른다 |

핵심 경계 한 줄: **캔버스 창은 읽기만 한다. 부수효과가 있는 것은 전부 다른 표면(설정 창·주문 팝업)에 있다.**

---

## 1. 표면 구분 — 왜 창이 넷인데 "창은 둘"인가

`GLOSSARY.md` §1이 이미 정의한 구분을 그대로 쓴다.

| 분류 | 표면 | 코드 |
|---|---|---|
| **상시 창** (창 개수에 센다) | 대화 창, 캔버스 창 | `chatWin` `app/main.js:99` / `canvasWin` `app/main.js:93` |
| **일시 표면** (창 개수에 세지 않는다) | 설정 창, 주문 팝업 | `settingsWin` `app/main.js` / 미착수 |

> `ui/soul.md` §3 "창은 두 개뿐" 과 §8 탈락 조건 "창이 셋 이상이다"는 **상시 창 기준**이다 (`GLOSSARY.md` §1).

설정 창 진입로는 **둘 다** 있어야 한다(`GLOSSARY.md` §1: "커맨드바가 아닌 경로로**만** 갈 수 있으면 §8 탈락 조건에 걸린다").

| 진입로 | 구현 |
|---|---|
| 대화 창의 점(마젠타 `#ee137b`) 클릭 | `app/chat.html` `#dot` → `athena:open-settings` |
| 커맨드바에 자연어 입력 | `app/chat.js` `SETTINGS_COMMAND` — `설정` / `환경설정` / `settings` / `설정 열어줘` / `모델 바꿔줘` / `계좌 연결` 등 19케이스 실측 통과 |

---

## 2. 설정 창이 쓰는 API

### 2.1 IPC 표면 — 렌더러가 만질 수 있는 전부

설정 창은 `contextIsolation:true` · `nodeIntegration:false` · `sandbox:true`로 태어난다. 렌더러에 노출되는 것은 preload가 심은 **6개 함수뿐**(`app/settings-preload.js`). 실측 확인: `bridgeSurface: ["close","getInfo","getPrefs","getStatus","setPrefs","tokenAction"]`, `typeof require === "undefined"`.

| 함수 | IPC 채널 | 방향 | 반환 |
|---|---|---|---|
| `getStatus()` | `athena:settings:status` | invoke | `{backendReachable, configured, ready, expiresAt}` |
| `tokenAction(action)` | `athena:settings:token` | invoke | 위 + `{ok, error?}` · `action ∈ {issue, revoke}` |
| `getInfo()` | `athena:settings:info` | invoke | `{name, version, electron, backendBaseUrl, layout}` |
| `getPrefs()` | `athena:settings:prefs:get` | invoke | `{autoExpandCanvas, autoGrowChat}` |
| `setPrefs(patch)` | `athena:settings:prefs:set` | invoke | 갱신된 prefs (대화 창에 `athena:prefs-changed` 방송) |
| `close()` | `athena:settings:close` | send | — |

### 2.2 백엔드 엔드포인트 — 정확히 3개

| # | 경로 | 인증 | 응답 | 부수효과 |
|---|---|---|---|---|
| 1 | `GET /api/v1/internal/oauth/status` | 로컬 bearer | `{configured, ready, expires_at}` — **토큰 문자열은 절대 미반환** (`api/oauth_status.py:26-41`) | 없음 |
| 2 | `POST /api/v1/internal/oauth/au10001` | 로컬 bearer | 토큰 상태 dict | **발급** — 업스트림 재발급, 레이트리밋 소모 |
| 3 | `POST /api/v1/internal/oauth/au10002` | 로컬 bearer | 토큰 상태 dict | **폐기** — 성공/실패 무관 로컬 토큰 삭제(`kiwoom/auth.py:160-161`) |

실측 응답(백엔드 기동 + bearer `devtoken`):

| 요청 | 결과 |
|---|---|
| 인증 헤더 없음 | `422` |
| 잘못된 bearer | `401` (`secrets.compare_digest`, `security.py:29`) |
| 정상 조회 | `200 {"configured":false,"ready":false,"expires_at":null}` |
| 자격증명 없이 발급 | `503 {"detail":"Kiwoom data service is not ready"}` (`dependencies.py:64-68`) |

화면에는 TR ID(`au10001`/`au10002`)를 쓰지 않는다 — "토큰 발급"/"토큰 폐기"로만 표기(`ui/DESIGN-SOUL.md:128-133`).

### 2.3 못 하는 일 — 자격증명 입력

**런타임에 자격증명을 받는 백엔드 엔드포인트가 존재하지 않는다.** 라우터는 6개(batch, catalog, llm_tools, oauth_status, raw, stream) + generated뿐이고 설정 저장 경로가 없다(`api/__init__.py`).

| 값 | 유일한 주입 경로 | 근거 |
|---|---|---|
| `ATHENA_KIWOOM_APP_KEY` / `_SECRET_KEY` | `.env` 또는 프로세스 환경변수 → 기동 시 1회 | `config.py:17,24-25`, `@lru_cache get_settings()` `config.py:58-60` |
| `ATHENA_LOCAL_BEARER_TOKEN` | 동일. 백엔드가 내려주지 않으므로 Electron에도 **같은 값을 따로 넣어야 한다** | `config.py:28` |
| `ATHENA_KIWOOM_BASE_URL` | **사용자 편집 금지** — 모의 도메인이 아니면 기동 자체가 죽는다 | `config.py:41-44` |
| 계좌번호 | **앱 설정값이 아니다.** 발급된 토큰에 암묵 바인딩되고 TR별 요청 필드로만 전달 | `athena_api/` 전역에 설정 필드 0건 |

따라서 설정 창은 입력 폼을 만들지 않고 **상태 표시 + 토큰 제어 + 주입 방법 안내**만 한다. 폼을 만들면 저장할 곳이 없어 거짓 UI가 된다.

부수효과 없는 "연결 테스트" 경로도 없다 — 굳이 하려면 `au10001`(실제 발급)뿐이라, 설정 창에는 **읽기 전용 `새로고침`**만 뒀다.

### 2.4 자격증명 데이터플로우

```
설정 창 렌더러  ──(필드값만)──▶  preload  ──▶  Electron main
                                                 │  process.env.ATHENA_LOCAL_BEARER_TOKEN
                                                 │  process.env.ATHENA_BACKEND_BASE_URL (기본 127.0.0.1:8010)
                                                 ▼
                                          fetch(백엔드)  ── Authorization: Bearer …
                                                 │
설정 창 렌더러  ◀──(표시용 상태 4필드만)──────────┘
```
bearer·백엔드 주소는 **main 프로세스를 벗어나지 않는다**. 실측 확인: 화면 텍스트에 bearer·TR ID 0건.

### 2.5 상태 표시 규칙

| 백엔드 | 자격증명 | 접근토큰 | 발급 | 폐기 |
|---|---|---|---|---|
| 연결 안 됨 | 알 수 없음 | 알 수 없음 | 잠김 | 잠김 |
| 연결됨 / `configured:false` | 미설정(주황) | 발급 불가 | 잠김 | 잠김 |
| 연결됨 / `ready:false` | 설정됨(녹색) | 없음 | **가능** | 잠김 |
| 연결됨 / `ready:true` | 설정됨 | 유효(녹색) + 만료 잔여시간 | 가능 | **가능(2단 확인)** |

창 열기·닫기·새로고침은 토큰을 발급하거나 폐기하지 않는다. 폐기만 2단 확인을 거친다.

---

## 3. 캔버스 창이 쓰는 API — 대화를 이해하고 무엇을 부를지 정하는 경로

### 3.1 전체 흐름

```
사용자 자연어 (대화 창)
   │
   ├─ 커맨드바 설정 명령이면 → 설정 창 (§1)  ※ 셀렉터로 가지 않는다
   │
   ▼
① athena_search    질문 → 후보 오퍼레이션 랭킹 (최대 10)
   ▼
② athena_describe  후보 1개의 정확한 요청·응답 계약 + detail 그룹 목록
   ▼
③ athena_resolve   질문+인자 재검증 → 서명된 실행 계획(plan_token, TTL 120초)
   ▼
④ athena_call      plan에 봉인된 오퍼레이션·인자만 실행 → 데이터 + 다음 plan
   ▼
캔버스 창 렌더링
```

LLM에 노출되는 것은 **이 4개 tool의 스키마뿐**이다. 카탈로그 323건은 모델 컨텍스트에 들어가지 않는다(`manifest`에도 없다 — `api/llm_tools.py:57-79`).

### 3.2 4-tool 계약

라우터 prefix `/api/v1/llm` (`api/llm_tools.py:21`). 요청 모델 4개 모두 `extra="forbid"`(`selector/schemas.py:12-13`).

| tool | 경로 | 요청 | 응답 |
|---|---|---|---|
| `athena_search` | `POST /tools/search` | `query`(2~500, 필수) · `intent`=auto\|query\|order\|websocket · `limit`=5(1~10) | `catalog_version, normalized_query, results[]` |
| `athena_describe` | `POST /tools/describe` | `operation_ref`(필수) · `intent` | 필수/선택 인자, 응답 필드, `detail_groups[]`, `execution_policy` |
| `athena_resolve` | `POST /tools/resolve` | `question`(2~2000) · `candidate_refs`(≤8) · `preferred_ref` · **`detail_group`** · `arguments` · `response_mode` · `continuation` | `plan_token, expires_at, operation_ref, selection_reasons[]` |
| `athena_call` | `POST /tools/call` | **`plan_token` 하나뿐** (`schemas.py:177-178`) | `operation_ref, data, continuation{cont_yn, next_key, next_plan_token}` |
| (부트스트랩) | `GET /manifest` | — | 4개 tool 스키마 + `counts`. **다섯 번째 툴이 아니다** |

`SearchHit` 한 건이 담는 것: `operation_ref, kind, domain, name, group_title, score, confidence, contributions[], generic_callable, discovery_only` — 왜 골랐는지를 `contributions`로 되짚을 수 있다.

### 3.3 search — 무엇을 점수로 삼는가

결정론적이다. 임베딩·모델 호출·무작위성 없음(`selector/ranking.py`).

| 존 | 토큰당 | 상한 |
|---|---:|---:|
| 제목 | 150 | 750 |
| 패밀리 투영 제목(detail 흡수분) | 150 | 750 |
| 도메인 | 80 | 400 |
| 요청 필드/설명 | 70 | 350 |
| 응답 필드/설명 | 50 | 500 |

가산: 정확한 `operation_ref` 10000 / TR ID 5000 / group ID 4000 / TR ID 토큰 3000 · 2단어 이상 제목 구절 일치 1400 · 질의 커버리지 최대 600. 동의어는 직접 매치의 3/4.
정렬: `(-점수, generic_callable 우선, kind=query 우선, ref 오름차순)`. 신뢰도: 1000↑ high / 240↑ medium / 그 외 low.

### 3.4 resolve — base와 detail 중 무엇을 고르는가

**이 문단이 이 문서에서 가장 중요하다.**

| 규칙 | 동작 | 근거 |
|---|---|---|
| 기본값 | `detail_group`이 없으면 **항상 base** | `policy.py:105-107` |
| **detail 선택** | **오직 `ResolveRequest.detail_group`을 명시했을 때만.** 랭킹이 투영을 고르는 경로는 **없다** | `policy.py:29-43,100-104` |
| 전체 응답 의도 | `response_mode=full`이거나 질문에 `전체/전부/모든/원문/raw/full/complete`가 있으면 `detail_group`보다 우선해 base 강제 | `policy.py:96-99` |
| `pure_list` 형상 | base 강제 | `policy.py:105-106` |
| `preferred_ref` | 패밀리 단위로만 작동. 랭킹 top-3 밖이거나 top-1의 80% 미만이면 거부(409) | `service.py:181-188` |
| 필수 인자 미충족 | pydantic 오류 그대로 담아 422 | `service.py:203-209` |
| **모호할 때** | 1·2위 점수차 <80 **또는** 비율 <1.15 → **409 에러**(`AMBIGUOUS_OPERATION`), `details.candidates`에 상위 3개 패밀리 | `policy.py:70-88` |
| 확신 부족 | top-1 <240점 → 404 `NO_CONFIDENT_MATCH` | `policy.py:64-65` |

즉 **"어느 상세 화면을 볼지"는 대화만으로 정해지지 않는다.** 모델이 `describe`로 그룹 목록을 본 뒤 `detail_group`을 스스로 지정해야 한다. 이 설계는 "투영은 절대 추측하지 않는다"는 policy 원칙(`GLOSSARY.md` §7)의 결과다.

오류 코드 → HTTP: `OPERATION_NOT_FOUND` 404 · `NO_CONFIDENT_MATCH` 404 · `AMBIGUOUS_OPERATION` 409 · `PREFERRED_REF_NOT_SUPPORTED_BY_QUERY` 409 · `OPERATION_NOT_GENERIC_CALLABLE` 403 · `UNKNOWN_DETAIL_GROUP` 422 · `INVALID_ARGUMENTS` 422 · `INVALID_PLAN` 400 · `EXPIRED_PLAN` 410 · `STALE_PLAN` 409.

### 3.5 plan token — 무엇을 봉인하는가

형식 `v1.<b64url(payload)>.<b64url(sig)>`, HMAC-SHA256 (`selector/plans.py:90-108`).

봉인 필드: `v, iat, exp, nonce, catalog_version, operation_ref, arguments, cont_yn, next_key, request_schema_hash, response_schema_hash, question_hash`. **URL·경로는 담지 않는다.**

| 항목 | 값 |
|---|---|
| 서명 키 | `secrets.token_bytes(32)` — 프로세스 기동 시 1회, 메모리만 (`dependencies.py:15-18`) |
| TTL | 120초 고정(허용 1~600) |
| 프로세스 로컬 | 그렇다. 재시작하면 기존 토큰 전부 무효 |
| 카탈로그 불일치 | `call` 시점에만 검사 → `STALE_PLAN` 409 |
| **재사용 방지** | **없다** — §7-A 참조 |

### 3.6 call — 바꿔치기가 불가능한 이유

`CallRequest`는 `plan_token`만 받는다. 인자를 다시 받지 않으므로 발급 후 인자를 갈아끼울 수 없다. 주문/WS/OAuth 차단은 **3중**이다.

1. `resolve` 단계에서 `generic_callable=False`면 계획 발급 자체를 거부 (`service.py:150-152,201-202`)
2. `PlanSigner.verify()`가 `kind != "query"`면 `INVALID_PLAN` (`plans.py:154-155`)
3. `call()`이 검증 통과 후 다시 확인 (`service.py:238-239`)

OAuth 2개는 `visibility="hidden"`이라 `find_exact`가 `None`을 돌려준다 — 존재하지 않는 것과 구분되지 않는다(`catalog.py:78-81`).

연속조회: 응답의 `cont_yn=="Y"`이고 `next_key`가 있으면 **다음 페이지용 plan_token을 새로 발급**해준다(`service.py:258-265`). 캔버스는 그 토큰만 다시 `call`하면 된다.

### 3.7 실행 계층 — 실제로 나가는 HTTP

| 용도 | 경로 | 비고 |
|---|---|---|
| 조회 TR(타입) | `/api/v1/tr/{domain}/{tr_id}` | 예 `/api/v1/tr/stockinfo/ka00198` |
| 상세 투영 | `/api/v1/tr/{domain}/{tr_id}/detail/{group_id}` | 예 `…/ka10001/detail/identity_and_capital` |
| 검증 없는 패스스루 | `POST /api/v1/raw/tr/{tr_id}` | 조회 TR만, 없으면 404 |
| 여러 TR 한 번에 | `POST /api/v1/batch` | 최대 100건, 동시 5, 조회 TR만 |
| 카탈로그 | `GET /api/v1/catalog`, `/catalog/{tr_id}`, `/catalog/output-profile` | 스키마·형상·투영·상세 라우트 목록 |
| 헬스 | `GET /health` (무조건 ok) · `GET /ready` (자격증명 없으면 503) | 인증 없음 |

헤더 계약: 요청 `cont-yn`(기본 `N`, `N`/`Y` 아니면 400) · `next-key`(선택). 응답에 같은 이름으로 되돌려준다(`generated/runtime.py:39-50`).
`post_paged`는 최대 100페이지(설정 1~1000)까지 모아 `(items, 사용 페이지 수, 마지막 봉투)`를 돌려준다.
batch 부분 실패는 HTTP 상태가 아니라 결과 배열의 `ok`/`error`로 표현된다 — 전체는 200이다.

### 3.8 실시간(WebSocket)

| 항목 | 내용 |
|---|---|
| 구독 등록·해제 | `POST /api/v1/websocket/{tr_id}` — `trnm`=REG\|REMOVE, `data[].type`이 tr_id와 **대소문자까지** 일치해야 함(`0g`≠`0G`) |
| 이벤트 수신 | `WS /api/v1/ws/stream` — **fan-out 전용.** 이 소켓으로는 구독을 걸 수 없다 |
| 인증 | bearer 헤더, 없으면 첫 프레임 `{"type":"auth","token":"…"}`. 둘 다 없고 토큰 미설정이면 루프백만 허용 |
| 큐 | 구독자당 100건, 가득 차면 **가장 오래된 것부터 버린다**(drop-oldest) |
| 재연결 | 지수 백오프 1s→최대 30s, 성공 시 저장된 구독을 REG로 복원 |

### 3.9 카탈로그 노출 범위

| 구분 | 수 | 셀렉터에서 |
|---|---:|---|
| 전체 오퍼레이션 | 323 | base 208 + detail 115 |
| `generic_callable`(일반 호출 가능) | **286** | 조회 171 + 상세 115 |
| `explicit`(검색만 되고 실행 금지) | 35 | 주문 12 + WS 23 |
| `hidden`(없는 것처럼) | 2 | OAuth |

카탈로그 버전은 `sha256:…`로 계산되어 plan에 봉인된다(`catalog.py:176-204`).

---

## 4. 캔버스 창이 쓰지 않는 API

| 대상 | 경로 | 왜 캔버스가 아닌가 | 어디로 가는가 |
|---|---|---|---|
| 주문 12 | `/api/v1/order/{tr_id}` | 되돌릴 수 없는 부수효과. bearer + `X-Athena-Confirm: true` + `Idempotency-Key` 3종 필요 | **주문 팝업**(미착수) |
| OAuth 2 | `/api/v1/internal/oauth/{tr_id}` | 기계 간 인증 갱신 | **설정 창** |

주문 라우트 상태코드: 401(bearer) · 428(확인 헤더) · 400(멱등키 형식) · 409(같은 키 다른 내용, 또는 이전 결과 불확실) · 503(주문 API 비활성·캐시 포화). 주문 클라이언트는 **재시도 0회**다(`lifespan.py:69`).

---

## 5. 두 창에 공통으로 걸리는 제약

| 제약 | 값 |
|---|---|
| 레이트 리밋 | 전역 **초당 5회**, 같은 api-id는 **초당 1회**. 조회·주문·WS 제어가 **같은 리미터를 공유**한다 |
| 재시도 | HTTP 429 또는 return_code `5`/`1700` → `0.2 × 2^(n-1) × jitter(0.75~1.25)`초 후 재시도. 조회 기본 1회, 주문 0회 |
| 자격증명 미설정 | 데이터 경로 전부 503. `/health`·`/docs`·설정 창 상태 조회는 살아 있다 |
| 오류 매핑 | `KiwoomNotReady`/`KiwoomAuth` 503 · `KiwoomApiError` 429 또는 502 · `KiwoomWsError` 502 |

---

## 6. 지금 상태

| 항목 | 상태 |
|---|---|
| 셀렉터 4-tool + 카탈로그 323 | 구현·테스트됨 (`selector+api 161 passed`) |
| 조회·상세·batch·raw·catalog 라우트 | 구현됨 |
| WS 등록·스트림·재연결 복원 | 구현됨 |
| 주문 가드(bearer·확인·멱등) | 구현됨. 라우트는 기본 비활성 |
| 설정 창 | **구현·검증됨** (검증7 19개 단언 통과) |
| **캔버스 창 ↔ 셀렉터 배선** | **미착수.** `app/canvas.js`는 아직 mock 3종(stream/reader/table) |
| `ScreenDefinition`/`ScreenDocument` | 미구현(G002) |
| 주문 팝업 | 미착수(설계만, 계획 §9) |

---

## 7. 검토해줄 것

### A. plan token 재사용 방지가 없다 — 판단 필요

발급된 `plan_token`은 TTL 120초 안에서 **몇 번이든 다시 실행된다.** `nonce`가 payload에 있지만 서버가 사용 이력을 남기지 않는다(`plans.py`, replay cache 없음).

- 대상이 조회뿐이라 데이터가 망가지진 않는다. 위험은 **레이트리밋 소모**와 의도치 않은 반복 호출이다.
- 선택지: ⓐ 그대로 둔다(조회 전용이므로 수용) ⓑ 1회용으로 바꾼다 ⓒ 연속조회 refresh만 예외로 허용하고 나머지는 1회용.
- ⓑ/ⓒ는 프로세스 로컬 사용 이력 저장소가 필요하다.

### B. 모호할 때 되물을 재료가 부족하다

모호하면 **409 에러**만 나온다. 전용 clarification 응답 스키마가 없고, 캔버스가 사용자에게 되물을 재료는 `details.candidates`의 패밀리 ref 3개뿐이다 — 사람이 읽을 제목이 아니다.

- 선택지: ⓐ 캔버스가 candidates로 `describe`를 3번 더 불러 제목을 얻는다(왕복 3회) ⓑ 409 응답에 제목을 함께 싣도록 백엔드를 고친다.

### C. 상세 화면은 대화만으로 선택되지 않는다

`detail_group`을 명시해야만 상세 투영이 선택된다(§3.4). "삼성전자 밸류에이션만 보여줘" 같은 질문이 곧바로 `detail:ka10001:valuation`으로 가지 않는다 — 모델이 `describe`를 거쳐 그룹을 직접 골라야 한다.

- 이게 의도한 설계인지(추측 금지 원칙) 아니면 랭킹이 상세까지 골라야 하는지 확인 필요. 계획 문서의 이질감 테스트 범위와 직결된다.
- `selector/AGENTS.md:30-32`도 "focused detail resolution … recorded regression failures"로 자기 신고해둔 영역이다.

### D. 설정 창에 넣지 않은 것

`GLOSSARY.md` §1은 설정창을 "설정 · **모델 지정** · **주기 설정** · 계좌 연결"이 사는 표면으로 정의한다. 현재 구현은 계좌·인증 / 화면 / 정보 셋뿐이다.

- 모델 지정 = LLM 연결 설정, 주기 설정 = 감시 에이전트 — **둘 다 백엔드가 미착수**라 넣을 것이 없다.
- 착수 시점에 설정 창에 섹션을 더하면 되는지, 아니면 지금 자리만 잡아둘지.

### E. bearer 토큰을 양쪽에 어떻게 넣을 것인가

백엔드는 `ATHENA_LOCAL_BEARER_TOKEN`을 내려주지 않는다. Electron이 같은 값을 별도로 알아야 한다. 지금은 둘 다 `process.env`에서 읽는 전제이고, **두 프로세스를 함께 띄우는 실행 스크립트가 아직 없다** — 지금은 백엔드를 따로 켜야 설정 창이 "연결됨"이 된다.

---

## 8. 참고 문서

| 문서 | 무엇이 있나 |
|---|---|
| [`backend/docs/LLM_API_SELECTION.md`](../backend/docs/LLM_API_SELECTION.md) | 셀렉터 설계 근거, 점수 기여 항목, 한/영 대화 예시, MCP 어댑터 지침 |
| [`backend/docs/KIWOOM_API_IO.md`](../backend/docs/KIWOOM_API_IO.md) | 208개 기본 + 115개 상세의 요청·응답 필드 전수 |
| [`GLOSSARY.md`](../GLOSSARY.md) | 표면·캔버스·셀렉터·백엔드 용어 정본 |
| [`kiwoom-common-template-fit-dissonance-plan.md`](kiwoom-common-template-fit-dissonance-plan.md) | 화면 템플릿·이질감 테스트·주문 팝업(§9)·설정 창(§10) |
| [`plan.md`](plan.md) | 현재 상태와 다음 수 |
