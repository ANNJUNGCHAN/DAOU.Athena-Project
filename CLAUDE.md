# Athena — 작업 원칙

이 저장소에서 일할 때 **항상** 지키는 규칙. 근거 문서 링크를 함께 단다.
구조 설명은 각 디렉토리의 `AGENTS.md`에 있다. 여기는 **원칙만** 적는다.

- 항상 작업을 한 후 커밋하고 푸시할 것(커밋메세지 한국어로 작성)
- 디자인 할 때 항상 ui 폴더를 보고 디자인을 할 것 
---

## 0. 읽는 순서 (작업 시작 전)

| 순서 | 문서 | 왜 |
|---|---|---|
| 1 | [`plan/plan.md`](plan/plan.md) | 지금 상태 · 실측 사실 · 다음 수 |
| 2 | [`plan/00-인수인계.md`](plan/00-인수인계.md) | 설계 근거 · **함정 목록** · 확정된 결정 |
| 3 | [`GLOSSARY.md`](GLOSSARY.md) | **용어집.** 이 저장소의 말은 전부 여기 정의를 따른다 |
| 4 | [`ui/soul.md`](ui/soul.md) | 제품 철학. **시각적 결정이 이 문서와 충돌하면 문서가 이긴다** |
| 5 | 해당 영역 `AGENTS.md` | 그 디렉토리의 규칙 |

키움 공통화면 작업만 이어받는다면 [`plan/kiwoom-common-screen-handoff.md`](plan/kiwoom-common-screen-handoff.md)로 바로 간다.

---

## 1. 계좌 — 모의계좌 전용

- **`https://mockapi.kiwoom.com`에 고정한다.** `config.py`에 상수로 박혀 있다. 실계좌 도메인으로
  파라미터화하지 마라.
- **주문 API는 기본 비활성**이다. 켜려면 `ATHENA_ENABLE_ORDER_API=true` + `ATHENA_LOCAL_BEARER_TOKEN`
  둘 다 필요하고, 로컬 베어러 인가 · 명시적 확인 · 멱등성 계약을 추가로 통과해야 한다.
- **주문은 재시도하지 않는 별도 클라이언트**를 쓴다. 타임아웃이나 레이트리밋 응답이 주문을
  복제하면 안 된다. 이 분리를 없애지 마라.
- **감시 에이전트가 주문을 자동 집행하지 않는다.** 알림까지만, 주문은 사람이 낸다
  (확정 결정 3 — 앱이 죽으면 손절이 미발동되고 우회 수단이 없다).
- 자격증명과 발급 토큰은 **프로세스 메모리에만** 있다. 디스크 기록 · 로깅 · 직렬화 금지.
- **감사 로그에 인자·응답 본문을 남기지 마라.** 계좌 정보가 흐른다 (함정 ⑫).

---

## 2. UI — `ui/` 폴더가 규범이다

- **UI 작업 전에 반드시 [`ui/`](ui/AGENTS.md)를 읽는다.** `soul.md`(철학) → `palette.md`(색·타이포)
  → `liquid-glass.md`(재료 규범) → `round-1R/two-windows.md`(현행 창 사양) 순서.
  `round-1/`은 폐기된 이전 라운드다. 인용하지 마라.
- **창은 둘뿐이다. 예외 없다.** 정의는 [`GLOSSARY.md`](GLOSSARY.md) §1.
  - **대화 창**(= 채팅창, 유일한 입력 지점) · **캔버스 창**(유일한 출력 지점).
    OS 레벨로 분리된 독립 창. 두 창 다 `frame: false` — **타이틀바가 없다**(`app/main.js:60`).
  - **그 외의 모든 화면은 대화 창의 모드다** — 온보딩 · 인증 · 설정 · 주문 확인. 새 창을 만들지
    않는다. 설정 진입은 입력 영역의 **점(`#dot`)** 또는 커맨드바다. 대화 모드 외의 모드는
    **전부 미구현이다.**
  - 즉시 탈락 조건: **창 3개 이상**, 상시 사이드바/탭바/툴바, 커맨드바 외 경로로**만** 접근 가능한
    설정(점은 추가 진입로이지 유일 진입로가 아니다).
  - **새 창을 열고 싶어지면 모드로 풀 수 있는지 먼저 본다.**
- **리퀴드 글래스 재료 규범은 타협 불가**: 모든 표면이 유리 / 유리는 무채색(틴트 금지) /
  유리 뒤에는 반드시 굴절할 것이 있다 / 깊이는 값으로 만든다(테두리 굵기 아님) /
  광량 단계는 데스크톱→창→캔버스 3단 고정 / Regular 변형 하나만 / **액센트 색 없음**.
- **"AI 냄새" 금지 목록**(`soul.md` §7)에 걸리면 감점이 아니라 다시 만든다: 보라→분홍 그라디언트,
  균등 3카드 그리드, 이모지 아이콘, 무의미한 글로우/네온, **장식용 유리**(뒤에 굴절할 게 없는
  반투명 회색 사각형), **페이드로 등장하는 유리**(유리는 opacity가 아니라 굴절 변조로 나타난다),
  대칭 강박, 없는 기능을 암시하는 장식 UI.
- **정보 정직성이 미감보다 위다** (§8). 숫자가 안 읽히면 실패다. 실제로 이 규칙 때문에 잔류
  블러 버그를 잡았다 — 애니메이션 `backdrop-filter`는 `0px`로 끝내고 인라인 스타일을 지운다.
- **접근성 3종은 직접 구현한다**: `prefers-reduced-transparency` / `prefers-contrast` /
  `prefers-reduced-motion`. `app/styles/access.css`에 실제 CSS로 존재해야 하고, 검증 캡처로 증명한다.
- 숫자가 정렬돼야 하는 곳(재무제표, TR 코드)은 `--font-mono`.
- 디자인 프로세스는 YC 방식(무드보드 → 시안 N개 → 랭킹 → 델타 주입 → 반복). **핵심은 생성이
  아니라 선별이다.**

---

## 3. 실측이 문서를 이긴다

- **추측을 코드에 넣지 마라.** upstream 동작 보정(`athena_mcp/quirks.py`)은 W0/W0.9 실측으로
  확정된 것만 넣는다.
- 주장에는 증거를 붙인다. 증거는 `spike/captures/`, `app/captures/VERIFY-REPORT.json`,
  실제 테스트 출력이다. **"될 것이다"로 넘기지 않는다** — 재현 → 원인 격리 → 수정 → 재검증.
- `spike/captures/`는 **불변 증거**다. 편집하거나 가볍게 재생성하지 마라.
- 사전 조사·README·통념이 실측에 뒤집힌 사례 11건이 `00-인수인계.md` §4에 있다. 새로 뒤집히면
  거기에 추가한다.

---

## 4. 정직하게 기록한다

- **미구현·단순화·부분통과를 숨기지 않는다.** `app/README.md`가 표준이다 — 구현 중 발견한 버그
  4건, 확장 애니메이션의 "부분통과", 잘린 목업 데이터를 UI 헤더에까지 노출한다.
- 기능을 건드리면서 "미구현" 주석을 조용히 지우지 마라. 해결했으면 해결했다고 쓴다.
- 수치는 추정이 아니라 실행 결과다. 갱신하면 **언제 돌린 결과인지** 같이 적는다.
- TODO 플레이스홀더, `test.skip`, 빈 스텁은 완료 증거가 아니라 **차단 사유**다.

---

## 5. 생성물은 손으로 고치지 않는다

- `backend/athena_api/generated/` (`models.py`, `routes.py`, `registry.py`)와
  `backend/docs/KIWOOM_API_IO.md`, `backend/ref/kiwoom-output-profile.json`은 **생성물**이다.
  `scripts/generate_api.py` 또는 `ref/` 입력을 고치고 재생성한다.
- `generate_api.py --check`가 stale 트리에서 실패한다. 이걸 완화하지 마라.
- `backend/tests/fixtures/api_selector_golden.jsonl`은 행동 계약이다. 재생성은 커밋 메시지에
  근거를 남기는 의도적 행위이지 루틴한 갱신이 아니다.

---

## 6. 보안

- **sanitize한 문자열을 `innerHTML`에 넣지 마라.** 스트림 어댑터가 `<b>`를 스트립하고 엔티티를
  언이스케이프하는데, 그 결과를 `innerHTML`로 재해석하면 **저장형 XSS**다. `app/`은 전부
  `textContent`/DOM 노드로 렌더한다. 현재 `innerHTML` 문자열 삽입 0건 — 유지한다 (함정 ⑪).
- **동의 게이트(`athena_mcp/consent.py`)를 우회하지 마라.** 헤드리스 CLI는 MCP 서버를 트러스트
  확인 없이 시작한다(`npx -y <패키지>` = 무확인 임의 코드 실행). 툴 호출은 권한 게이트가 막지만
  **서버 시작은 안 막힌다.** 이걸 막는 게 `consent.py`다 (함정 ⑩).
- 비밀값은 커밋하지 않는다. `.env`는 ignore, `backend/.env.example`이 추적되는 템플릿이다.
- 에러 · 로그 · HTTP 응답에 upstream 원문이나 키가 새면 안 된다. `athena_api/errors.py`의 도메인
  에러로 번역해서 내보낸다.
- 서비스는 `127.0.0.1`에 묶는다. WebSocket 베어러 토큰을 **쿼리스트링에 넣지 마라**.

---

## 7. 백엔드 운영 규칙

- **uvicorn 워커는 정확히 1개.** 토큰 · WebSocket 연결 · 멱등성 캐시 · 레이트리미터가 전부
  프로세스 로컬이고, 두 번째 자격증명 보유 프로세스는 `process_lock.py`가 거부한다.
- **리미터는 하나**다. REST · WebSocket 제어 · 주문이 공유한다. 롤링 1초에 최대 5건, 같은 API ID는
  1건. 트랜스포트별 리미터를 추가하지 마라.
- 자격증명이 없으면 데이터 라우트는 **503으로 fail-closed**. 조용한 빈 결과 금지.
- LLM에 노출하는 툴은 **정확히 4개**(`athena_search` / `athena_describe` / `athena_resolve` /
  `athena_call`). 323개 오퍼레이션을 평평한 툴로 풀지 말고, OpenAPI 전문을 모델 컨텍스트에
  넣지 마라. `llm_get_manifest`는 다섯 번째 툴이 아니다.
- 셀렉터 랭킹은 **결정적이고 설명 가능해야** 한다. 임베딩 · 모델 호출 · 무작위성 금지.
- 브레인은 LadybugDB **단일 소유자**를 통해서만 쓴다. 히스토리가 원본이고 그래프는 재구축 가능한
  **투영**이다.

---

## 8. 함정 — 같은 곳에 두 번 빠지지 않는다

전체 목록은 [`plan/00-인수인계.md`](plan/00-인수인계.md) §5. 자주 걸리는 것:

- **콘솔이 cp949다.** `print()`를 셸로 리다이렉트하면 한글이 깨진다. 이 함정 때문에 존재하지
  않는 결함을 보고할 뻔했다. → `Path.write_text(json.dumps(..., ensure_ascii=False), encoding="utf-8")`로
  저장하고 **파일을 열어** 확인하라.
- **Electron에서 `require.main === module`은 항상 false다.** `npm start`가 창을 안 띄우고 조용히
  멈춘다. `app/main.js`는 `ATHENA_NO_AUTOSTART` 환경변수로 대체했다. 건드리지 마라.
- **스크린샷 OS 합성 캡처가 간헐 실패한다**(공유 데스크톱). `webContents.capturePage()`가 주 증거,
  OS 캡처는 보조.
- **`serverInfo.name` / `version`을 믿지 마라.** 서로 다른 서버 셋이 같은 이름을 보고했고, 한
  서버는 자기 버전 대신 SDK 버전을 보고한다. 네임스페이스 키는 **사용자 별칭**이다.
- **`structuredContent` 우선은 예외다.** 실제 주경로는 `content[0].text` → `json.loads()`.
  `result.py`의 4단계 순서는 실측으로 고정됐다. 재배열 금지.
- **DART `corp_code`는 숫자로 온다.** `str(x).zfill(8)` 없으면 즉시 실패.
- **`claude -p --setting-sources`는 빈 문자열이어야 한다.** 값을 하나라도 주면 훅이 전부 로드된다.

---

## 9. 검증 — 완료를 주장하기 전에

```powershell
cd backend
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
.venv\Scripts\python scripts\generate_api.py --check
```
```bash
cd app && npm run verify     # electron verify.js — node로 돌리면 안 된다
```

- 셀렉터 평가 스위트(`tests/unit/test_selector_eval.py`)는 **릴리스 게이트**다.
- 프레임 수치는 공유 데스크톱이라 실행마다 흔들린다. 초록 나올 때까지 재실행하는 건 검증이 아니다.
- 실패했으면 실패했다고 출력과 함께 보고한다.

---

## 10. 저장소를 두 갈래가 함께 쓴다

| | **갈래 A — MCP · 셸** | **갈래 B — 뇌 · 화면체계** |
|---|---|---|
| 코드 | `backend/athena_mcp/`, `app/`, `spike/` | `backend/athena_api/brain/`, `selector/`, `llm_tools.py` |
| 계획 | `mcp-실행계획.md`, `감시에이전트-실행계획.md` | `investment-brain-architecture.md`, `kiwoom-common-screen-brief.md` |

**"공통 캔버스"라는 말이 양쪽에 다른 스케일로 존재한다.** 렌더러를 건드리기 전에 어느 쪽이 상위
개념인지 확인하라. `kiwoom-common-screen-brief.md`는 *"do not create a parallel replacement
application"*을 명시한다 — 새 프론트엔드를 만들기 전에 반드시 조율한다.

---

## 11. 문서 · 언어

- `plan/plan.md`에는 **상태 / 실측 사실 / 다음 수**만 적는다. 설계 근거는 `00-인수인계.md`에 있다.
  중복하지 않는다. 편집하면 `최종 갱신` 날짜와 브랜치 줄을 갱신한다.
- 이 저장소 문서는 대부분 한국어다. **편집하는 파일의 언어를 따른다.**
- **용어는 [`GLOSSARY.md`](GLOSSARY.md)를 따른다.** 새 말을 만들면 코드에 쓰기 전에 용어집에 먼저
  등록한다. §12(충돌하는 말)에 걸리는 단어는 문맥을 명시하지 않고 쓰지 마라 — 특히 "공통 캔버스",
  "창", "캔버스", "detail".
- 커밋은 Conventional Commits(`fix(selector): ...`, `docs(plan): ...`) — 기존 히스토리를 따른다.
