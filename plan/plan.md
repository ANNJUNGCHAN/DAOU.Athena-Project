# Athena 진행 상황 및 재개 계획

> 최종 갱신: 2026-08-16 · 브랜치 `main` — **작업 브랜치 4종이 전부 `main`에 병합됐다**
>
> **다음 세션은 이 파일부터 읽는다.** 여기에는 *지금 상태 / 검증된 사실 / 다음 수*만 적는다.
> 설계 근거와 함정 목록은 [`plan/00-인수인계.md`](00-인수인계.md)에 있다. 중복하지 않는다.
> 키움 공통화면 Ultragoal만 이어받는다면 [`plan/kiwoom-common-screen-handoff.md`](kiwoom-common-screen-handoff.md)로 바로 간다.

---

## 0. 30초 요약

키움 REST 백엔드 위에 **① MCP 게이트웨이 ② 투자 브레인(그래프) ③ LLM API 셀렉터 ④ Electron 두 창 셸**을 얹는 중이다.
네 갈래 모두 **골격은 동작**한다. 미완은 **셀렉터 정확도(테스트 22건 실패)**, **CLI 연동**, **감시 에이전트**, **브레인의 FastAPI 결선**이다.

---

## 1. 실측 상태 (2026-08-15 재검증)

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

**2026-08-16 · 브랜치 4종 병합 후 `main`에서 재측정 — 이 수치가 현행이다:**

```
backend 전체:  603 passed, 0 failed   (135초)
  ruff check .                          → All checks passed
  generate_api.py --check               → Generated files are current
```

병합된 브랜치: `ANNJUNGCHAN/MCP` · `ANNJUNGCHAN/REST-API` · `ANNJUNGCHAN/Call` ·
`ANNJUNGCHAN/화면기획서-점검`. 각 워크트리의 미커밋 작업은 병합 전에 원자 커밋으로 보존했다.

병합에서 내린 판단 3건:

1. **설정 독립 창을 버렸다.** `Call`이 만든 `settingsWin`(720×620 독립 `BrowserWindow`)은
   `MCP` 쪽 구현과 중복이고 "창은 둘" 원칙(`ui/soul.md` §8)에 걸린다. `app/settings.*` 4파일을
   삭제했다. 살아남은 설정은 캔버스 창에 그려지는 계좌·MCP 카드다.
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
| MCP 게이트웨이 | **동작 · 실서버 이식 완료 · W1 잔여 5건 결선** · 191 테스트 통과 | `backend/athena_mcp/` |
| 투자 브레인 (그래프 투영) | **모듈 완성, FastAPI 미결선** | `backend/athena_api/brain/` |
| LLM API 셀렉터 | **동작** · 102 테스트 통과 (§3) | `backend/athena_api/selector/` |
| Electron 두 창 셸 | **동작** · 실제 데이터 렌더 | `app/` |
| 스파이크 실측 데이터 | 86건 보존 | `spike/captures/` |
| MCP 이식 절차 (등록→승인→probe→서빙) | **동작** · 외부 서버 3종 실왕복 | `athena_mcp/{onboarding,runner,__main__}.py` |
| CLI (`claude -p`) 연동 | **준비됨, 미실행** — `.mcp.json` 예시 있음 | `spike/gateway-graft/` |
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

외부 MCP 서버들을 집계해 **단일 MCP 서버로 재노출**한다. 191 테스트 통과.

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

**미완**: ADR §4.2가 요구한 **FastAPI lifespan 결선**. `build_lifespan()`에 Ladybug 서비스(프로세스 락 → DB open → 스키마 확인 → `fts` 로드 → writer queue)를 붙이는 작업이 아직이다. 현재는 모듈 + 단위테스트만 존재.

### C. LLM API 셀렉터 `backend/athena_api/selector/`

문서: [`backend/docs/LLM_API_SELECTION.md`](../backend/docs/LLM_API_SELECTION.md).
전체 스키마를 컨텍스트에 넣지 않고 `search → describe → resolve → call` 4단계로 좁힌다.
타입드 FastAPI 라우트를 대체하지 않는 **좁은 컨트롤 플레인**. 노출은 `api/llm_tools.py`.
→ 정확도 문제는 §3.

### D. Electron 셸 `app/`

대화 창(1560×204, 위로만 성장) + 캔버스 창(1560×800, clip-path 확장). Acrylic 기반 OS 합성.
실측 데이터로 렌더되고 접근성 3종(투명도/대비/모션 축소) 캡처 보유.

**알려진 리스크**: 확장 프레임 p95 **54ms** (최악 89.5ms). 스파이크 단계는 33.3ms였다.
완화책은 `ui/soul.md` §7이 이미 적어둠 — **굴절층과 데이터층 분리** (미구현).

---

## 5. 다음 액션 (우선순위)

| # | 작업 | 이유 / 시작점 |
|---|---|---|
| 1 | ~~**갈래 A·B 조율**~~ → **의도적으로 둘로 간다** | 통합을 검토하고 기각했다. 전제가 다르다 — `AT-CV-005`는 스키마를 아는 키움 manifest 파생, MCP는 상류 스키마를 모르는 게 전제다. **렌더러가 둘이 되는 대가를 알고 받았다.** 아래 "결정 — MCP 봉투와 AT-CV-005는 별개로 간다" 참조 |
| 2 | **브레인 FastAPI 결선** | ADR §4.2. 락·writer queue 없이는 다중 프로세스 쓰기 사고 |
| 3 | **CLI 연동 마무리** — `claude -p`로 실왕복 | 게이트웨이는 stdio 서버로 뜨고 MCP 클라이언트 왕복까지 검증됐다. 남은 건 `claude` 자체로 확인하는 것뿐. `--setting-sources ""` 필수 (§7). **`--allowedTools` 없이는 툴 실행이 자동 거부된다** — S3 실측(`spike/cli-pipe/RESULT.md:127-136`) |
| 4 | **stream-json 파서** (결정 D1의 귀결) | 프로덕션 코드에 파서가 **0건**이다. `tool_result.content`가 문자열/블록배열 둘 다 온다(RESULT.md:111-120) |
| 5 | **W3 캔버스 어댑터** — upstream 출력 → 캔버스 데이터 | 미착수. `stream.py`가 여기서 첫 프로덕션 호출자를 얻는다. 계약 형상은 이미 일치(`canvas.py` 스트림 스키마 ↔ `stream.py` 레코드) |
| 6 | **타임라인 캔버스** | 계획은 "타임라인부터"인데 `app/canvas.js`에 timeline 분기 자체가 없다(stream/reader/table만). 가격축은 KRX 승인 전까지 pykrx로 잠정 |
| 7 | **프레임 최적화** — 굴절층/데이터층 분리 | soul.md가 "모션이 곧 재료"라고 한 설계 |
| 8 | 캔버스 설계 라운드 | 근거 ①②④ 확보됨. soul.md §9 프로세스로 |
| 9 | 파수꾼·조사관 착수 | `plan/감시에이전트-실행계획.md`. 주문 자동집행 없음(결정 3) |
| 10 | MCP 어댑터에 `detail_group` 반영 | 4툴을 MCP로 노출할 때 `describe.detail_groups` → `resolve.detail_group` 경로 필수 (`docs/LLM_API_SELECTION.md`). 현재 `athena_mcp`에 selector 참조 **0건** |

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

**지금 `app/`은 아직 목업이다.** `app/main.js`의 `athena__render_canvas`는 같은
이름의 placeholder IPC이고, 데이터는 `spike/captures/*.json`을 파일에서 직접
읽는다. `app/`에 MCP 클라이언트도 HTTP 호출도 없다(의존성은 `electron` 하나뿐).

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

### 미룬 것 — MCP env 암호화 (방향만 확정)

레지스트리엔 env 키 이름만 남기고, 값은 Electron `safeStorage`(DPAPI)에 넣고,
spawn 시점에 앱이 환경변수로 주입한다. **구현은 안 했다** — 사용자가 먼저 앱을
써보기로 했다.

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

# 백엔드 (전체 스위트는 약 4분)
cd backend && .venv/Scripts/python -m pytest -q
cd backend && .venv/Scripts/python -m pytest tests/mcp -q            # 191 passed
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
