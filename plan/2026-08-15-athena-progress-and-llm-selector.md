# Athena 국내 키움 FastAPI·LLM 선택기 진행 스냅샷

> 기준일: 2026-08-15
> 성격: 완료 보고서가 아니라, 현재 구현 범위와 남은 차단 이슈를 다음 작업자가 재현할 수 있도록 남기는 진행 기록이다.
> 관련 구현 스냅샷: `e9c8eab` (원격 `main`에 push됨)

## 1. 목표와 범위

Athena의 키움 연동 범위는 **국내 API로 한정**한다. AITS의 키움 REST 호출 구조와 키움 공식 예제를 대조해 FastAPI로 옮기고, 한 화면에 담기 어려운 복합 응답은 의미 단위의 상세 API로 분할한다. 그 위에 LLM이 전체 스키마를 한꺼번에 읽지 않고 질문에 맞는 API를 찾고 검증한 뒤 호출할 수 있는 선택 계층을 둔다.

미국 전용 API는 구현·카탈로그·LLM 검색 대상에서 제외했다. 키움 공식 저장소에서 확인한 미국 전용 작업 129개는 Athena 국내 인벤토리에 포함하지 않는다.

## 2. API 인벤토리와 개수 기준

### 2.1 키움 원본 기준 208개

| 종류 | 개수 | 현재 취급 |
|---|---:|---|
| 국내 조회 TR | 171 | 타입이 있는 FastAPI 기본 경로로 제공 |
| 국내 주문 TR | 12 | 별도 주문 안전장치를 거친 FastAPI 경로로 제공 |
| 국내 WebSocket 작업 | 23 | 연결·등록·해제·실시간 수신 경로로 제공 |
| OAuth 작업 | 2 | 인증 내부 제어로 유지하고 LLM에는 숨김 |
| **기본 API 합계** | **208** | 국내 전용 |

### 2.2 화면 단위 상세 API 115개

전체 응답 필드 수의 단순 이상치만 자르는 방식을 쓰지 않았다. 실제로 한 화면에서 서로 다른 의미의 필드 묶음을 함께 보여주기 어려운지 판단해 22개 TR을 선정하고, 그 응답을 115개 상세 투영 API로 나눴다.

- 사실형 필드 그룹은 한 화면에서 읽을 수 있도록 최대 20개 필드 단위로 묶는다.
- 목록 필드는 임의로 열을 쪼개지 않고 하나의 표로 유지한다.
- 목록 UI는 기본 10행과 더 보기/페이지네이션을 전제로 한다.
- 원본 전체 응답이 필요한 경우를 위해 기본 TR도 그대로 유지한다.

따라서 키움 작업 인벤토리는 다음과 같이 센다.

| 구분 | 계산 | 개수 |
|---|---:|---:|
| 기본 API | 조회 171 + 주문 12 + WSS 23 + OAuth 2 | 208 |
| 상세 API | 22개 TR에서 생성한 의미 단위 투영 | 115 |
| **키움 작업 합계** | 기본 208 + 상세 115 | **323** |

`323`은 **키움 원본/상세 작업의 논리적 개수**다. 다음 서비스 보조 경로는 이 숫자에 더하지 않는다.

- 배치 호출, 카탈로그, 허용된 raw TR 호출
- 실시간 이벤트 전달용 `WS /api/v1/ws/stream`
- LLM manifest와 4개 meta-tool 경로
- `/docs`, `/redoc`, `/openapi.json` 및 상태 확인 경로

LLM의 일반 `resolve`/`call`이 실행할 수 있는 범위는 조회 기본 171개와 상세 115개를 합친 **286개**다. 주문 12개와 WSS 23개는 명시적 의도에서 검색할 수 있지만 기존 보호 흐름을 우회하는 generic call 대상은 아니다. OAuth 2개는 LLM 카탈로그에서 숨긴다.

## 3. FastAPI 이식과 호출 안전성

### 3.1 처리량과 병렬 호출

- 프로세스 전체가 하나의 strict rolling-window limiter를 공유한다.
- 모든 REST 조회, 주문, WebSocket 제어 시작을 합쳐 최근 1초에 최대 5개만 허용한다.
- 같은 API ID는 같은 1초 창에서 한 번만 시작할 수 있다.
- 배치 경로는 서로 다른 조회 TR을 최대 5개까지 동시에 실행한다.
- 주문 TR은 배치 대상에서 제외한다.

이 구조는 키움의 `초당 5회` 제한 안에서 서로 다른 TR을 가능한 한 병렬로 시작하기 위한 것이다. 같은 TR의 반복 호출은 제한 조건 때문에 직렬화될 수 있으므로, 실제 화면 조합에서는 중복 TR을 합치고 멀티코드 TR을 우선 사용하는 추가 최적화가 필요하다.

### 3.2 인증·주문·WebSocket 보호

- 앱 키와 시크릿이 없거나 토큰 발급에 실패하면 데이터 경로는 HTTP 503으로 fail-closed한다.
- 토큰은 프로세스 메모리에만 유지하며, 자격 증명을 보유한 서버의 중복 실행을 프로세스 잠금으로 막는다.
- 주문 API는 기본 비활성화 상태다. 활성화 후에도 로컬 bearer 인증, 명시적 확인, idempotency key 검증을 요구한다.
- 주문 클라이언트는 자동 재시도를 사용하지 않아 응답 유실 뒤 중복 주문이 발생할 가능성을 줄인다.
- WebSocket은 하나의 지속 연결을 사용하고, 성공한 등록만 재연결 후 복원하며, `REAL` 이벤트는 크기가 제한된 구독자 큐로 전달한다.
- OAuth fail-open, 주문 키 재사용, WSS 지연 응답 오상관·재연결 누수, 성공 코드 타입 차이, `ka10173` 복원, 잘못된 HTTP 200 빈 성공 처리 같은 독립 심사 항목은 회귀 테스트 대상으로 고정했다.

### 3.3 I/O 문서와 키움 공식 저장소 대조

- [`backend/docs/KIWOOM_API_IO.md`](../backend/docs/KIWOOM_API_IO.md)는 국내 기본 208개와 22개 TR의 상세 투영 115개에 대해 요청·응답 필드를 생성 방식으로 정리한다.
- [`backend/ref/kiwoom-output-profile.json`](../backend/ref/kiwoom-output-profile.json)은 응답 필드 수, 목록 수, 깊이와 화면 복잡도 분포를 보존한다.
- [`backend/ref/response-projections.json`](../backend/ref/response-projections.json)은 상세 API가 원본 응답 별칭을 빠뜨리거나 중복 소유하지 않는지 확인하는 기준이다.
- 키움 공식 저장소 [`Kiwoom-Securities/Kiwoom-REST-API`](https://github.com/Kiwoom-Securities/Kiwoom-REST-API)의 예제를 AITS 및 Athena 인벤토리와 비교했다. 이 과정에서 확인한 미국 전용 129개 작업은 국내 범위에서 구조적으로 제외했다.

## 4. LLM이 323개 API 중 하나를 고르는 방식

### 4.1 참고한 패턴

두 참고 프로젝트의 공통점은 모든 업무 API 스키마를 LLM 도구로 직접 노출하지 않는다는 점이다.

- [`KIS_MCP_Server`](https://github.com/migusdn/KIS_MCP_Server/tree/595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7)는 작은 카탈로그 도구로 검색하고, 한 작업의 명세만 불러온 뒤, 서버가 검증한 generic caller를 실행한다.
- [`tossinvest-cli`](https://github.com/JungHoonGhae/tossinvest-cli/tree/b4cdcd3b64fc6f1db43753b69cdb510570e9c0a5)는 `list_operations` → `describe_operation` → `call_operation`의 3단계로 스키마를 지연 로드하고, 필수 인자·인증·쓰기 작업을 서버에서 검사한다.

Athena는 여기에 **서명된 실행 계획** 단계를 추가했다.

```text
사용자 질문
  -> search: 작은 카탈로그에서 후보 검색
  -> describe: 후보 하나의 정확한 I/O 계약 조회
  -> resolve: 질문·인자를 재검증하고 만료되는 서명 계획 발급
  -> call: 서명 계획에 묶인 작업과 인자만 실행
```

LLM에는 다음 4개 meta-tool만 노출한다.

| 도구 | FastAPI 경로 | 역할 |
|---|---|---|
| `athena_search` | `POST /api/v1/llm/tools/search` | 자연어 질문으로 후보 순위 생성 |
| `athena_describe` | `POST /api/v1/llm/tools/describe` | 선택 후보의 필수 인자와 응답 계약 로드 |
| `athena_resolve` | `POST /api/v1/llm/tools/resolve` | base/detail 정책과 인자를 검증하고 HMAC 서명 계획 발급 |
| `athena_call` | `POST /api/v1/llm/tools/call` | 서명된 계획만 실행 |

`GET /api/v1/llm/manifest`는 어댑터가 위 4개 도구 스키마와 카탈로그 버전을 얻는 보조 경로다. 다섯 번째 LLM 도구가 아니다. 생성된 323개 경로는 `x-athena-llm-exposed: false`, 위 4개 POST 경로만 `true`로 표시한다.

작업 식별자는 `base:{tr_id}`와 `detail:{tr_id}:{group_id}`로 계층화했다. 호출 계획에는 URL이나 임의 경로를 받지 않으며, 작업 ID·정규화 인자·카탈로그 버전·만료 시각을 HMAC으로 묶는다.

### 4.2 현재 구현 위치

| 영역 | 파일 |
|---|---|
| 카탈로그·정규화·검색 순위 | `backend/athena_api/selector/catalog.py`, `normalization.py`, `lexicon.py`, `ranking.py` |
| base/detail 선택 정책 | `backend/athena_api/selector/policy.py` |
| 서명 계획·서비스·오류·스키마 | `backend/athena_api/selector/plans.py`, `service.py`, `errors.py`, `schemas.py` |
| FastAPI manifest와 4개 도구 | `backend/athena_api/api/llm_tools.py` |
| 115개 상세 레지스트리·라우트 생성 | `backend/scripts/generate_api.py`, `backend/athena_api/generated/registry.py`, `routes.py` |
| 개발자 계약 문서 | [`backend/docs/LLM_API_SELECTION.md`](../backend/docs/LLM_API_SELECTION.md) |
| 회귀·평가 자산 | `backend/tests/unit/test_selector_core.py`, `test_selector_eval.py`, `backend/tests/fixtures/api_selector_golden.jsonl` |

## 5. 검증 근거와 현재 차단 이슈

### 5.1 지금까지 확인한 근거

- 생성기 재실행과 `--check`, Ruff, Python compile 검사는 selector 구현 직후 통과했다.
- FastAPI 통합 시점의 백엔드 전체 스위트는 339개 테스트 통과로 보고됐다.
- 이후 의미 선택 품질을 더 엄격히 보기 위해 72개 범주의 golden fixture와 115개 상세 제목의 한글/영문 매트릭스를 추가했다.
- 검색 단계 측정에서는 호출 가능한 60개 사례의 recall@5가 60/60, 허용 top-1이 59/60, detail/base top-1이 43/44였다.
- 현재 체크아웃에서 `test_selector_core.py`와 `test_selector_eval.py`를 함께 재실행한 결과는 **76 passed, 22 failed**였다(145.90초). 22건은 아래 resolve·모호성·제목 매트릭스 차단 이슈와 일치한다.

위 수치는 **검색 후보 회수율** 근거이지, 최종 `resolve` 정확도 완료 증거가 아니다. 평가를 확장한 현재 상태에서는 selector 평가가 의도적으로 red이며, 전체 완료를 선언할 수 없다.

### 5.2 재현된 차단 이슈

| 차단 이슈 | 현재 관찰 |
|---|---|
| 명확한 상세 질문의 base 오선택 | 명확한 detail 질문 22개 중 19개가 base로 resolve되거나 `preferred_ref` 거부로 끝남 |
| 모호한 계좌 질문의 과도한 확정 | “계좌 정보 알려줘”가 추가 질문 없이 `base:kt50032` 실행 계획을 발급함 |
| 제목 기반 식별 충돌 | 115개 한글 제목 매트릭스에서 11개, 영문 제목 매트릭스에서 12개 top-1 실패 |
| TR 계열 충돌 | `ka10002/ka10040`, `ka10004/ka10087`, `ka20001/ka20009`, `kt00005/kt00010/kt00013` 등 유사 제목·입력 계열에서 정체성 점수가 부족함 |
| 평가 fixture 약화 | 자연어 `TR ID + 전체/full response` 22개 사례가 exact `base:{tr_id}` 참조로 일시 변경됨. 현재 테스트 통과 수치를 높이지만 실제 자연어 선택 능력을 검증하지 못하므로 원문 사례로 복원해야 함 |

따라서 커밋 `e9c8eab`은 선택기 기반과 평가 자산을 원격에 보존한 **진행 스냅샷**이다. selector 품질 게이트를 통과한 최종 릴리스가 아니다.

## 6. 다음 작업

1. 약화된 22개 full-response fixture를 자연어 `TR ID + 전체/원문/full/complete` 문장으로 복원한다.
2. 질의 안의 정확한 TR ID, `base:`/`detail:` 작업 ID와 group ID를 경계 안전하게 인식해 랭킹에 반영한다.
3. 하나의 강한 의미 그룹만 지목하면 detail, 두 그룹 이상 또는 전체 응답 의도면 base가 되도록 `resolve` 정책을 수정한다.
4. “계좌 정보”처럼 여러 TR 계열에 걸치는 질문은 계획을 발급하지 않고 후보와 명확화 요구를 반환한다.
5. 중복·유사 한글/영문 제목에 TR family 정체성 점수를 추가하고, 위 충돌 계열을 개별 회귀 테스트로 고정한다.
6. 72개 golden 평가, 한글 115개, 영문 115개 제목 매트릭스, selector 코어, FastAPI 통합, 전체 백엔드 테스트를 순서대로 다시 실행한다.
7. 자연어 fixture를 약화하지 않은 상태에서 detail/base resolve 정확도와 모호 질의 거부율을 기록하고 나서만 selector 완료를 선언한다.
8. 실계정이 아닌 키움 mock 환경에서 5/sec 공유 제한, 서로 다른 5개 TR의 동시 시작, WSS 재연결·재구독, 주문 idempotency 회귀를 다시 측정한다.

## 7. 재현 명령

```powershell
cd backend
.venv\Scripts\python -m pytest tests/unit/test_selector_core.py tests/unit/test_selector_eval.py -q
.venv\Scripts\python -m pytest tests/api/test_llm_tools_api.py tests/api/test_inventory_api.py tests/test_io_docs.py -q
.venv\Scripts\python -m ruff check athena_api tests scripts
.venv\Scripts\python scripts\generate_api.py --check
```

첫 번째 평가 명령은 현재 차단 이슈가 수정되기 전까지 실패하는 것이 예상 상태다. 실패를 건너뛰거나 fixture를 exact operation ref로 바꾸는 방식으로 녹색을 만들면 안 된다.
