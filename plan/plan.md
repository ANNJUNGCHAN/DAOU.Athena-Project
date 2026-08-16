# Athena 진행 상황 및 재개 계획

> 최종 갱신: 2026-08-15 · 브랜치 `main` · 작성 시점에 `origin/main`과 동기화됨
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
backend 전체:  470 passed, 0 failed   (87초)
  ruff check                → All checks passed
  tests/mcp                 → 167 passed (126 → +41, 이식 절차·러너)
```

> 이 워크트리에는 `backend/.venv`가 없었다. `uv sync --extra dev`로 새로 만들어 실행했다.

> 이전 스냅샷의 `403 passed, 22 failed`는 셀렉터 base/detail 라우팅 재설계로 해소됐다. §3 참조.

| 영역 | 상태 | 위치 |
|---|---|---|
| 키움 REST 백엔드 (301 라우팅) | **동작** | `backend/athena_api/` |
| MCP 게이트웨이 | **동작 · 실서버 이식 완료** · 167 테스트 통과 | `backend/athena_mcp/` |
| 투자 브레인 (그래프 투영) | **모듈 완성, FastAPI 미결선** | `backend/athena_api/brain/` |
| LLM API 셀렉터 | **동작** · 102 테스트 통과 (§3) | `backend/athena_api/selector/` |
| Electron 두 창 셸 | **동작** · 실제 데이터 렌더 | `app/` |
| 스파이크 실측 데이터 | 86건 보존 | `spike/captures/` |
| MCP 이식 절차 (등록→승인→probe→서빙) | **동작** · 외부 서버 3종 실왕복 | `athena_mcp/{onboarding,runner,__main__}.py` |
| CLI (`claude -p`) 연동 | **준비됨, 미실행** — `.mcp.json` 예시 있음 | `spike/gateway-graft/` |
| 파수꾼·조사관 | **미착수** (설계만) | `plan/감시에이전트-실행계획.md` |
| 캔버스 설계 라운드 | **미착수** (초안만) | `plan/canvas-taxonomy.md` |

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

외부 MCP 서버들을 집계해 **단일 MCP 서버로 재노출**한다. 126 테스트 통과.

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

미해결 보안 2건은 `backend/athena_mcp/SECURITY.md`. 프롬프트 인젝션(HIGH)은 CLI 통합 시점 과제, 응답 크기 상한(MEDIUM)은 게이트웨이에서 처리 가능.
**실서버를 붙이면서 프롬프트 인젝션 공격면이 가설에서 실물이 됐다** — 지금
노출 중인 upstream 툴 26개의 설명이 전부 남이 쓴 텍스트다.

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
| 1 | **갈래 A·B 조율 — "공통 캔버스" 정의 통합** | A는 캔버스 16종, B는 301 라우팅 렌더. 상위 개념을 정하지 않으면 렌더러가 둘로 갈라진다 (`00-인수인계.md` §1 충돌 ①) |
| 2 | **브레인 FastAPI 결선** | ADR §4.2. 락·writer queue 없이는 다중 프로세스 쓰기 사고 |
| 3 | **CLI 연동 마무리** — `claude -p`로 실왕복 | 게이트웨이는 stdio 서버로 뜨고 MCP 클라이언트 왕복까지 검증됐다. 남은 건 `claude` 자체로 확인하는 것뿐. `--setting-sources ""` 필수 (§7) |
| 4 | **프레임 최적화** — 굴절층/데이터층 분리 | soul.md가 "모션이 곧 재료"라고 한 설계 |
| 5 | 캔버스 설계 라운드 | 근거 ①②④ 확보됨. soul.md §9 프로세스로 |
| 6 | 파수꾼·조사관 착수 | `plan/감시에이전트-실행계획.md`. 주문 자동집행 없음(결정 3) |
| 7 | MCP 어댑터에 `detail_group` 반영 | 4툴을 MCP로 노출할 때 `describe.detail_groups` → `resolve.detail_group` 경로 필수 (`docs/LLM_API_SELECTION.md`) |

---

## 6. 막힌 것 — 코드로 못 푸는 것

| # | 무엇 | 누가 |
|---|---|---|
| 1 | **KRX 활용신청 미승인** — 21 엔드포인트 전부 `Unauthorized API Call` | **사용자**. `openapi.krx.co.kr` 마이페이지 → API별 활용신청 |
| 2 | 프롬프트 인젝션 (HIGH) | CLI 통합 시점 |
| 3 | `pykrx-mcp` 8툴 중 6 실패 (`400 LOGOUT`) | 상류 라이브러리 버그 |
| 4 | `@drfirst/korea-stock-mcp` 한글 손상 | 해당 서버 하나. 안 쓰면 무관 |

---

## 7. 재개 시 바로 쓰는 커맨드

모든 경로는 **저장소 루트 기준**이다. 루트에서 실행한다.

```bash
# 상태 확인
git status --short --branch
git log --oneline -8

# 백엔드 (전체 스위트는 약 4분)
cd backend && .venv/Scripts/python -m pytest -q
cd backend && .venv/Scripts/python -m pytest tests/mcp -q            # 126 passed
cd backend && .venv/Scripts/python -m pytest tests/unit/test_selector_eval.py -x -q   # 지금 빨간 것
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
