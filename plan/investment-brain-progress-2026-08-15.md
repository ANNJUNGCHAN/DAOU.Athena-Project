# 투자의 뇌 구현 진행 현황 (2026-08-15)

## 1. 현재 결론

Athena의 온디바이스 "투자의 뇌"는 아키텍처 결정과 핵심 데이터 계층까지 구현했다.
현재 코드는 채팅과 완료 거래를 SQLite 원본 이력으로 보존하고, LadybugDB에 재생성 가능한
그래프 투영을 만들며, 설정된 로컬 명령형 LLM의 구조화 결과를 엄격히 검증한 뒤 원자적으로
반영한다.

진행 상태는 다음과 같다.

- G001-G003: 구현, 테스트, 독립 리뷰를 마친 상태다.
- G004: 구현과 대상 테스트는 끝났지만, 도구 장애로 독립 코드 리뷰를 완료하지 못했다.
  따라서 기능 구현은 완료됐으나 최종 승인 체크포인트는 아직 닫지 않는다.
- G005-G009: 런타임/API, 설명 가능한 검색, 제품 Electron UI, 패키징/E2E, 최종 품질
  게이트가 남아 있다.

현재 구현은 백엔드 핵심 계층이며 완성된 사용자 기능이 아니다. 시간 배치 스케줄러,
local-only API, production Electron 화면과 Windows 배포 검증은 아직 포함하지 않는다.

### 1.1 현재 달성도 평가

2026-08-15 체크아웃을 기준으로 한 관리용 추정치는 다음과 같다. 이 수치는 단순 파일 수나
goal 개수의 산술 평균이 아니라, 실제 사용자가 기능을 사용할 수 있는 정도와 남은 통합 위험을
함께 반영한 값이다.

| 관점 | 추정 달성도 | 판단 근거 |
|---|---:|---|
| 백엔드 핵심 기반 | 약 65% | 온톨로지, LadybugDB 저장소, SQLite 원본 이력, 단일 writer queue, 재시도·복구·rebuild, 엄격한 LLM 추출까지 구현 |
| 실제 사용자 기능 | 약 25% | 시간 배치, 조회 API, 추천 context, 그래프 시각화와 제품 UI가 아직 없음 |
| 전체 제품 로드맵 | 약 40% | G001-G004 구현 단계이며, 통합 비중이 큰 G005-G009가 남음 |

따라서 현재 상태는 **"기억·그래프·LLM 처리 엔진은 구축됐지만, 사용자가 보고 검색하고
추천받는 제품 표면은 아직 없는 단계"**로 정의한다. `4/9` goal을 구현했다는 이유만으로
단순히 44% 완료라고 판단하지 않는다. Electron UI, Windows 패키징, 개인정보 보호, 재시작
복구와 E2E 검증이 포함된 G007-G008의 작업량과 출시 위험이 상대적으로 크기 때문이다.

단계별 기대 수준은 다음과 같이 관리한다. 아래 백분율은 일정 예측이 아니라 제품 성숙도를
대화할 때 사용하는 대략적인 기준이다.

| 도달 단계 | 예상 전체 달성도 | 사용자 관점에서 가능한 일 |
|---|---:|---|
| 현재 G001-G004 | 약 40% | 원본 이력과 검증된 그래프 투영을 코드·테스트 수준에서 생성 |
| G005 완료 | 약 55% | 한 시간 배치, 수동 갱신, 상태·검색·근거 API 사용 |
| G006 완료 | 약 65% | 그래프 경로와 출처가 있는 설명 가능한 추천 context 사용 |
| G007 완료 | 약 80% | Electron에서 실제 "내 투자의 뇌"를 조회·탐색 |
| G008 완료 | 약 95% | Windows 패키징, 오프라인 실행, 개인정보·복구·시각 E2E 검증 |
| G009 완료 | 100% | 정리, 전체 재검증, 독립 code-reviewer 및 architect 품질 게이트 통과 |

기능적 백엔드 MVP는 G005와 G006이 모두 끝난 시점으로 본다. 이때 UI가 없어도 대화·거래
내역을 배치 처리하고 API에서 관심사, 관계, 변화와 근거를 조회할 수 있어야 한다. 사용자가
직접 체감하는 제품 MVP는 G007까지, 배포 가능한 release candidate는 G008과 G009까지
완료해야 인정한다.

달성도는 다음 조건을 충족할 때만 올린다.

- 해당 goal의 제품 코드와 대상 테스트가 모두 존재한다.
- placeholder, skipped/only 테스트와 미구현 branch가 없다.
- target test, Ruff와 필요한 통합 검증이 통과한다.
- 독립 reviewer가 해당 단계의 종료 조건을 확인한다.
- 알려진 전체-suite 실패가 있으면 관련 여부와 영향 범위를 문서에 남긴다.

## 2. 목표와 고정 비범위

목표는 사용자의 채팅 및 완료 거래 이력을 온디바이스에서 분석해 다음을 제공하는 것이다.

- 관심 종목, 기업, 산업, 테마, 전략과 투자 성향을 엔티티와 관계로 축적
- 관찰된 사실과 추론된 선호를 구분
- 모든 주장에 원본 출처와 시간 정보를 연결
- 과거 관심사와 판단 근거를 그래프 검색과 순회로 다시 찾기
- 그래프를 삭제해도 SQLite 원본 이력에서 동일한 논리 투영을 재생성

다음 항목은 사용자 결정과 ADR에 따라 절대 포함하지 않는다.

- ChromaDB
- 모든 vector database 및 vector index/property
- 로컬 또는 원격 embedding 모델/API
- embedding cache
- LadybugDB `llm` extension

검색 품질 문제를 vector/embedding으로 우회하지 않는다. 허용 범위는 정확/속성 검색,
bounded graph traversal, 그리고 향후 오프라인 패키징까지 검증한 LadybugDB FTS/BM25다.
현재 구현에는 속성 기반 한국어 부분 문자열 검색이 있으며, FTS 확장 번들과 한국어 corpus
검증은 G008에 남아 있다.

## 3. 완료된 구현

### G001. 아키텍처 및 런타임 소유권 결정

`plan/investment-brain-architecture.md`에 다음 결정을 기록했다.

- Python FastAPI 백엔드만 LadybugDB `READ_WRITE` handle을 소유한다.
- Electron main/renderer와 별도 worker는 DB 파일을 직접 열지 않는다.
- SQLite는 권위 있는 원본이고 LadybugDB는 삭제·재생성 가능한 파생 투영이다.
- 모든 그래프 질의는 고정된 query template과 parameter binding을 사용한다.
- 그래프 mutation은 단일 writer 경계를 통과한다.
- reset은 그래프 투영만 제거하며 원본 이력을 삭제하지 않는다.
- `ladybug==0.19.1`을 고정하고 업그레이드는 별도 호환성 검증 뒤 수행한다.

### G002. 버전드 온톨로지와 LadybugDB 그래프 저장소

구현된 기능은 다음과 같다.

- extra field를 거부하고 문자열 길이, UTC 시간, JSON 속성 등을 제한하는 frozen Pydantic 모델
- `Entity`, `SourceRecord`, `Claim`, `Relation`과 각 kind enum
- 스키마 버전 1의 node/relation table 생성 및 버전 검사
- 하나의 `ThreadPoolExecutor(max_workers=1)`를 통한 embedded DB 단일 소유 실행
- source/entity/claim/relation의 트랜잭션 기반 idempotent upsert
- relation ID 재사용 시 기존 endpoint를 교체하고 저장 방향을 보존
- claim 변경 시 provenance set 교체
- 존재하지 않는 target을 참조하는 claim의 전체 rollback
- deterministic 한국어 property substring 검색, graph summary, claim provenance, bounded neighborhood
- projection reset 후 schema metadata 복원
- cancellation 중인 DB 작업도 owner thread에서 종료 순서를 보장
- query injection 입력을 query 구조가 아니라 데이터로 처리

### G003. SQLite 원본 이력과 증분 ingestion

구현된 기능은 다음과 같다.

- 채팅 메시지와 완료 거래의 권위 있는 SQLite 원본 저장
- canonical JSON 기반 SHA-256 fingerprint와 append-only source change revision
- chat/trade adapter별 독립 cursor
- durable ingestion job/attempt와 상태 전이
- 제한된 retry/backoff와 stale `RUNNING` job 복구
- SQLite WAL, foreign key, busy timeout 및 전용 단일 worker thread
- lifecycle이 소유하는 bounded `asyncio.Queue`
- DB에 job을 먼저 영속화한 뒤 enqueue하는 durable-before-enqueue 순서
- backpressure, drain, stop, restart, due-job refill
- 정확히 하나의 graph writer loop
- chat 및 completed-trade adapter의 cursor 이후 증분 fetch
- source graph upsert와 선택적 extraction projection이 모두 성공한 뒤에만 cursor 전진
- 실패 또는 cancellation 시 마지막 성공 cursor에서 idempotent retry
- rebuild 시 cursor를 먼저 0으로 되돌리고 graph를 reset한 뒤 권위 있는 원본 전체 재생
- Pydantic model 생성 뒤 metadata가 변조돼도 영속화 시 다시 검증

### G004. 검증된 LLM 그래프 추출

구현된 기능은 다음과 같다.

- `extra='forbid'` 기반의 크기 제한 `ExtractionEnvelopeV1`
- request ID와 source fingerprint binding 검증
- entity/relation/claim 참조와 교차 참조 검증
- 중복, 초과 크기, 예약 속성, 잘못된 type/identifier의 fail-closed 거부
- 모델 출력의 식별자를 신뢰하지 않고 서버에서 deterministic ID 파생
- observation과 inferred preference의 구분 보존
- `StructuredLlmClient` protocol과 명시적 argv 기반 `LocalCommandStructuredLlm`
- shell을 사용하지 않는 `create_subprocess_exec` 실행
- 기본 외부 provider 또는 네트워크 호출 없음
- stdout 크기 제한, timeout, non-zero exit, spawn 오류의 sanitized failure
- cancellation 시 child process 종료
- 전체 응답 검증이 끝난 뒤에만 그래프 mutation 실행
- source와 fingerprint를 다시 확인한 후 기존 source-scoped claim/relation을 원자적으로 교체
- extraction 실패 시 graph 미변경, ingestion cursor 미전진, durable retry

주의: G004의 대상 테스트와 정적 검사는 통과했지만 독립 코드 리뷰는 code-mode host 협상
장애로 실행하지 못했다. 독립 승인 없이 G004를 최종 완료로 간주하면 안 된다.

## 4. 현재 데이터 흐름

```text
채팅 메시지 / 완료 거래
  -> HistoryStore SQLite 원본 upsert
  -> source fingerprint 및 append-only change 기록
  -> durable ingestion job 생성
  -> bounded queue + single writer가 job claim
  -> adapter가 cursor 이후 변경분 fetch
  -> GraphStore가 SourceRecord upsert
  -> ExtractionService가 최소 source payload를 configured local command LLM에 전달
  -> strict schema, binding, cross-reference, size 검증
  -> GraphStore.apply_extraction() 트랜잭션으로 entity/relation/claim/provenance 교체
  -> 모든 단계 성공 후 adapter cursor commit 및 job 성공 처리
```

어느 단계에서든 실패하면 cursor는 성공 지점 이후로 이동하지 않는다. 재시작한 writer는 durable
job과 cursor를 기준으로 재처리하며, 고정 ID와 upsert 규칙으로 중복 투영을 방지한다.

## 5. 파일 맵

| 파일 | 역할 |
|---|---|
| `plan/investment-brain-architecture.md` | 소유권, 저장 모델, 검색, 보안, 마일스톤의 ADR |
| `backend/pyproject.toml` | `ladybug==0.19.1` 의존성 고정 |
| `backend/uv.lock` | Windows를 포함한 재현 가능한 LadybugDB 잠금 정보 |
| `backend/athena_api/brain/__init__.py` | 투자의 뇌 공개 타입과 서비스 export |
| `backend/athena_api/brain/ontology.py` | versioned strict ontology model과 enum |
| `backend/athena_api/brain/store.py` | 단일 소유 LadybugDB schema, mutation, 검색, provenance, reset |
| `backend/athena_api/brain/history.py` | SQLite 원본 이력, fingerprint, cursor, job, retry/recovery |
| `backend/athena_api/brain/ingestion.py` | source adapter, bounded queue, single writer, rebuild coordinator |
| `backend/athena_api/brain/extraction.py` | strict LLM contract, local command adapter, deterministic projection |
| `backend/tests/unit/test_brain_ontology.py` | ontology validation 테스트 |
| `backend/tests/unit/test_brain_graph_store.py` | graph schema, transaction, concurrency, 검색 테스트 |
| `backend/tests/unit/test_brain_history.py` | SQLite, revision, cursor, job/recovery 테스트 |
| `backend/tests/unit/test_brain_ingestion.py` | 증분 처리, backpressure, retry, rebuild 테스트 |
| `backend/tests/unit/test_brain_extraction.py` | strict extraction, subprocess, atomic replacement 테스트 |

## 6. 검증 근거와 현재 한계

2026-08-15 현재 새로 실행한 검증은 다음과 같다.

| 검증 | 결과 |
|---|---|
| 투자의 뇌 단위 테스트 5개 파일 | `51 passed in 8.77s` |
| 전체 backend 테스트 최신 실행 | `403 passed, 22 failed`; 실패는 모두 `tests/unit/test_selector_eval.py` |
| 투자의 뇌 소스 및 테스트 Ruff | `All checks passed!` |
| `python -m compileall -q athena_api/brain` | exit code 0 |

실행한 명령은 다음과 같다. 작업 디렉터리는 `backend`다.

```powershell
.\.venv\Scripts\python.exe -m pytest tests\unit\test_brain_ontology.py tests\unit\test_brain_graph_store.py tests\unit\test_brain_history.py tests\unit\test_brain_ingestion.py tests\unit\test_brain_extraction.py -q
.\.venv\Scripts\python.exe -m ruff check athena_api\brain tests\unit\test_brain_ontology.py tests\unit\test_brain_graph_store.py tests\unit\test_brain_history.py tests\unit\test_brain_ingestion.py tests\unit\test_brain_extraction.py
.\.venv\Scripts\python.exe -m compileall -q athena_api\brain
```

G004 구현 직후 기록된 전체 단위 테스트 결과는 `149 passed`였다. 이후 동시 작업이 포함된 현재
체크아웃의 최신 전체 backend 실행 결과는 `403 passed, 22 failed`다. 22개 실패는 모두
`tests/unit/test_selector_eval.py`의 별도 selector 평가에서 발생했으며, 투자의 뇌 대상 51개
테스트는 별도로 모두 통과했다. 따라서 과거의 `149 passed`를 현재 전체 스위트 green 증거로
재사용하지 않으며, 현재 전체 backend도 green이라고 표현하지 않는다.

검증되지 않았거나 아직 남은 항목은 다음과 같다.

- G004 독립 code-reviewer 승인
- lifespan과 결합된 실제 시간 배치 동작
- local-only API auth 및 renderer 경계
- bundled offline FTS와 한국어 검색 corpus
- production Electron UI 및 실제 화면 상태
- Windows 설치 패키지, restart/recovery, desktop E2E

## 7. Windows LadybugDB OpenSSL DLL 주의사항

현재 Windows Python wheel은 이 개발 환경에서 LadybugDB가 요구하는 native OpenSSL 런타임
DLL을 자체적으로 모두 제공하지 않았다. `GraphStore`는 임의 경로를 추측하지 않으며, 생성자
`dll_dir` 또는 환경 변수 `ATHENA_LADYBUG_DLL_DIR`로 받은 디렉터리만 `os.add_dll_directory()`에
등록한다. 디렉터리가 없거나 의존성을 불러오지 못하면 sanitized `RuntimeError`로 시작을
중단한다.

현재 graph 관련 테스트 fixture는 설정값이 없을 때 개발 머신의
`C:\Program Files\Git\mingw64\bin`을 검사해 테스트용 런타임으로 사용한다. 이것은 제품 패키징
해결책이 아니다. G008에서 다음을 완료해야 한다.

- LadybugDB 0.19.1과 호환되는 native OpenSSL DLL을 앱 번들에 포함
- 배포 시 명시적 번들 경로를 `ATHENA_LADYBUG_DLL_DIR`로 전달
- 인터넷과 Git 설치에 의존하지 않는 clean Windows machine smoke test
- third-party notice, checksum, architecture/ABI 일치 검증

## 8. 남은 작업과 이어서 진행할 순서

### G005. 시간 배치 런타임과 local-only API

1시간 기본 주기의 non-overlapping scheduler를 FastAPI lifespan에 연결한다. disabled-by-default
설정, startup overdue 처리, manual refresh, job status, summary, search, neighborhood, timeline,
evidence, chat/trade record, confirmed reset/rebuild API를 추가한다.

수용 조건:

- DB, history, queue, scheduler가 startup/shutdown에서 정확히 한 번 열리고 닫힌다.
- 수동 실행과 시간 실행이 겹쳐도 동일 작업을 중복 실행하지 않는다.
- reset은 raw history를 보존하고 별도 확인 없이는 실행되지 않는다.
- scheduler/API가 주문 또는 외부 네트워크를 호출하지 않는다.
- disabled 상태에서도 기존 FastAPI가 그대로 시작한다.

### G006. 설명 가능한 retrieval context

검색 결과를 assistant가 사용할 수 있는 bounded context로 조립하되, 모든 claim에 graph path와
source provenance를 포함한다. observation과 inference를 UI/API에서 구분하고 근거 없는 개인화를
거부한다.

수용 조건:

- deterministic ranking 및 size/token budget이 있다.
- 모든 추천 근거를 source까지 역추적할 수 있다.
- 추론은 관찰 사실처럼 표시되지 않는다.
- 검색 결과가 부족하면 unsupported personalization을 생성하지 않는다.

### G007. production Electron 투자의 뇌 UI

spike가 아닌 production Electron shell/renderer를 확정하고, 관심 그래프, 주요 관심사, 최근 변화,
근거 보기, privacy/reset/rebuild 상태를 실제 API에 연결한다.

수용 조건:

- populated, empty, loading, error, degraded, privacy/reset 상태를 실제 renderer에서 확인한다.
- renderer는 LadybugDB 파일, bearer token, 로컬 원본 파일을 직접 받지 않는다.
- 그래프 탐색이 키보드와 screen reader에서도 사용 가능하다.

### G008. 통합, Windows 패키징, 개인정보 및 시각 QA

offline FTS artifact, 한국어 corpus, local API auth/CORS, restart/recovery, Windows bundle,
Electron E2E와 시각 검증을 수행한다.

수용 조건:

- clean/offline Windows 환경에서 LadybugDB와 FTS가 시작한다.
- vector/embedding/Chroma 의존성과 제품 문자열이 manifest 및 실행 경로에 없다.
- 한국어 검색이 합의한 기준을 충족하거나 UI가 명시적 degraded/fallback을 표시한다.
- backend와 desktop의 주요 상태를 screenshot/E2E 증거로 남긴다.

### G009. 최종 정리와 독립 품질 게이트

변경 파일 cleanup 후 전체 검증을 다시 실행하고 architecture invariant를 감사한다. 독립
code-reviewer의 `APPROVE`와 architect의 `CLEAR`가 모두 있어야 완료한다.

수용 조건:

- placeholder, skipped/only test, 미구현 branch가 없다.
- 투자의 뇌 대상 테스트, 전체 backend 테스트, Ruff, compileall, package/E2E가 통과하거나
  외부 blocker가 정확히 기록된다.
- raw/history와 graph/projection 경계, single owner/writer, no-vector 원칙이 유지된다.

권장 실행 순서는 `G004 독립 리뷰 -> G005 -> G006 -> G007 -> G008 -> G009`다. 각 단계는 대상
테스트와 독립 검토를 마친 뒤 다음 단계로 이동한다.

## 9. 커밋 범위

투자의 뇌 기능 커밋의 논리 범위는 다음으로 제한한다.

- `plan/investment-brain-architecture.md`
- `plan/investment-brain-progress-2026-08-15.md`
- `backend/pyproject.toml`
- `backend/uv.lock`
- `backend/athena_api/brain/`
- 위 파일 맵에 나열한 `backend/tests/unit/test_brain_*.py`

동시 진행 중인 selector, catalog, 일반 UI 또는 다른 ultragoal 작업은 투자의 뇌 커밋에 섞지
않는다. 실제 staging 전에는 `git status`와 `git diff --cached`로 위 논리 범위와 일치하는지 다시
확인한다.
