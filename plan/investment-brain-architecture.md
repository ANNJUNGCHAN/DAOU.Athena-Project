# ADR-001: Athena 온디바이스 투자의 뇌 아키텍처

- 상태: Accepted for implementation
- 결정일: 2026-08-15
- 범위: Ultragoal G001 및 후속 G002-G009의 아키텍처 기준
- 결정 소유자: Athena application architecture

## 1. 결정 요약

Athena의 투자의 뇌는 **Python FastAPI 백엔드 프로세스가 단독 소유하는 embedded
LadybugDB 그래프 투영(projection)** 으로 구현한다. LadybugDB 파일은 Python 프로세스만
`READ_WRITE`로 열며, Electron main/renderer나 별도 worker는 DB 파일을 직접 열지 않는다.

LadybugDB는 원본 저장소가 아니다. 채팅, 거래, 조사 자료와 해당 처리 작업 기록은 각자의
권위 있는 로컬 원본 저장소에 남고, 그래프는 스키마 버전과 원본 provenance를 가진 채 언제든
삭제 후 재생성할 수 있는 파생 투영이다.

검색은 그래프 순회, 속성 비교와 공식 `fts` 확장의 BM25만 사용한다. ChromaDB, 다른 vector
database, embedding 모델/API, LadybugDB `llm` 확장은 포함하지 않는다.

## 2. 현재 저장소에서 확인한 기준점

현재 체크아웃은 완성된 데스크톱 제품이 아니라 다음의 조합이다.

- `backend/athena_api/main.py`는 FastAPI application factory와 lifespan 연결점을 제공한다.
- `backend/athena_api/lifespan.py`는 프로세스 단위 자원을 startup/shutdown에서 열고 닫는
  기존 수명주기 경계다.
- `backend/athena_api/process_lock.py`와 lifespan의 Kiwoom 자원 관리는 단일 프로세스 소유권을
  강제하는 선례지만, LadybugDB용 lock/queue는 아직 없다.
- `backend/pyproject.toml`에는 FastAPI/Kiwoom facade 의존성만 있고 LadybugDB, 채팅 저장소,
  거래 이력 저장소, LLM client 또는 작업 영속화 의존성이 없다.
- 저장소에 production Electron application/package, production chat runtime, production LLM
  boundary, 범용 application persistence가 없다.
- `spike/electron-glass/`는 HTML/JS 기반 UI 검증 spike다. 이는 디자인 근거이지 현재 production
  Electron shell이 존재한다는 증거가 아니다.
- `ui/`는 디자인 언어와 화면 기획 자료다. 실행 가능한 product renderer로 간주하지 않는다.

따라서 후속 구현은 "기존 Electron/chat/LLM/SQLite에 연결"됐다고 가정하면 안 된다. 먼저 실제
production 경계를 승격하거나 추가하고, 각 단계에서 spike가 아닌 실행 제품 표면을 명시해야 한다.

## 3. LadybugDB 채택과 버전 고정

Python 의존성은 최초 구현과 재현 가능한 패키징에서 다음과 같이 고정한다.

```text
ladybug==0.19.1
```

검증 기준일은 **2026-08-15**다. 이 버전은 해당 날짜에 확인한 PyPI 배포 버전이며, 공식 문서와
GitHub release 표시는 패키지 배포보다 늦게 갱신될 수 있다. 특히 문서 예제나 GitHub의 "latest"
표시가 0.19.0을 가리킬 수 있으므로 구현자는 문서의 latest 문자열이 아니라 lockfile에 고정된
0.19.1 wheel과 실제 runtime `ladybug.__version__`을 검증한다. 업그레이드는 별도 ADR, Windows
wheel/확장 호환성 검사, 마이그레이션 및 rebuild 검증 후에만 허용한다.

LadybugDB는 embedded DB이며 공식 Python API는 sync/async 표면을 제공한다. 이 프로젝트는
현재 Python backend lifecycle이 이미 있으므로 Node native binding을 추가해 소유자를 둘로 나누지
않는다. 라이선스는 MIT이며 배포물의 third-party notices에 포함한다.

## 4. 프로세스와 수명주기 결정

### 4.1 독점 소유권

한 application profile당 정확히 하나의 Python backend 프로세스가 다음을 소유한다.

- LadybugDB `Database`의 유일한 `READ_WRITE` handle
- write connection/transaction 실행권
- projection schema migration/rebuild 실행권
- `fts` 확장 설치·로드 및 index rebuild 실행권
- 시간 배치 scheduler와 manual refresh의 공통 write queue

Electron main/renderer, test helper, CLI, scheduler subprocess는 같은 DB 경로를 `READ_WRITE`로
열 수 없다. 진단용 `READ_ONLY` 직접 접근도 운영 중에는 금지하고 local API를 사용한다. 이는
관찰과 쓰기가 서로 다른 프로세스의 checkpoint 상태를 보게 되는 문제를 피한다.

### 4.2 FastAPI seam

Ladybug runtime은 `build_lifespan()`에 결합되는 별도 application service로 추가한다.

1. startup: profile path 확인 -> process lock 획득 -> DB open -> schema/version 확인 -> `fts`
   로드 -> writer queue/scheduler 시작 -> readiness 공개
2. running: 모든 graph mutation을 bounded `asyncio.Queue`에 enqueue하고 전용 writer task 하나가
   순서대로 transaction 처리
3. shutdown: 신규 enqueue 차단 -> 실행 중 transaction 종료 또는 안전 rollback -> queue checkpoint
   -> scheduler/writer cancel 및 await -> DB close -> lock 해제

Uvicorn은 이 기능을 켠 profile에서 `workers=1`이어야 한다. worker 수가 1이 아니거나 동일 profile
lock을 획득하지 못하면 startup을 즉시 실패시킨다. 기존 lifespan이 수명주기 seam이기는 하지만
현재 one-worker 정책을 보장하지는 않으므로 별도의 구성 검증과 graph process lock이 필요하다.

## 5. 저장 모델: 원본과 투영의 분리

권위 있는 원본 계층은 최소한 다음을 보존해야 한다.

- 원문 chat message/conversation 및 안정적인 source identifier
- 체결 또는 조회된 trade history와 외부/로컬 source identifier
- 사용자가 보존한 조사 자료와 source metadata
- LLM 요청 동의/공급자 정책에 필요한 privacy metadata
- ingestion job, retry, cursor/watermark, source fingerprint

LadybugDB에는 원문을 대체하는 사본이 아니라 검색과 설명을 위한 다음 파생 정보만 둔다.

- versioned ontology node/edge
- normalized searchable property
- observation과 inference의 명시적 구분
- confidence, valid/event time, extracted time
- `source_kind`, `source_id`, source fragment locator/hash
- extractor/schema/projection version

`projection_version`은 semantic ontology version과 physical schema version을 모두 식별해야 한다.
버전 불일치 시 in-place 임의 변환보다 새 경로에 재투영하고 검증 후 원자적으로 active pointer를
전환한다. projection directory는 사용자 profile 아래 전용 경로를 사용하며 소스 트리에 두지 않는다.

reset은 그래프와 파생 index/checkpoint만 삭제한다. 원본 삭제는 별도의 명시적 privacy 작업이며
그래프 reset과 묶지 않는다. rebuild는 원본 cursor 0부터 deterministic/idempotent upsert를 수행한다.

## 6. 쓰기 및 질의 경계

### 6.1 Single-writer async queue

producer는 hourly scheduler, manual refresh, source adapter, retry worker 하나 이상일 수 있지만
writer는 하나다. queue item은 다음의 검증된 command envelope를 가진다.

```text
command_id, source_kind, source_id, source_fingerprint,
projection_version, operation_type, validated_payload, attempt
```

`command_id`와 source fingerprint는 idempotency key다. 성공한 command를 재실행해도 node/edge가
중복되지 않아야 한다. queue는 renderer 요청을 기다리게 하지 않으며 status API로 queued/running/
retryable_failed/terminal_failed/succeeded를 노출한다. 프로세스 재시작 후에는 권위 있는 job
store에서 미완료 command를 복구한다.

### 6.2 고정 query template

모델 또는 API caller가 Cypher 문자열을 제공하지 못하게 한다. application code가 allowlist된
template ID를 선택하고 모든 값은 parameter binding으로 전달한다.

초기 template allowlist는 다음으로 제한한다.

- `graph.upsert_source`
- `graph.upsert_entity`
- `graph.upsert_observation`
- `graph.upsert_inference`
- `graph.upsert_relation`
- `graph.summary`
- `graph.search_fts`
- `graph.neighborhood`
- `graph.timeline`
- `graph.evidence`
- `graph.recommendation_context`
- `graph.delete_projection`

node/relationship table 이름, property 이름, sort expression처럼 parameterize할 수 없는 identifier는
ontology registry의 고정 allowlist에서만 선택한다. free-form string interpolation, multi-statement
model output, caller 제공 `CALL`, DDL은 거부한다.

## 7. 검색 결정

허용하는 검색은 다음뿐이다.

- 정확한 identifier/property match
- parameterized deterministic property filter
- bounded graph traversal
- 공식 `fts` 확장의 node `STRING` property index 및 BM25 점수

LadybugDB의 FTS는 현재 node table의 문자열 property에 index를 만들고 BM25를 사용한다. 한국어
stemmer는 공식 지원 목록에 없으므로 한국어 index는 `stemmer := 'none'`을 기본으로 하고,
제품 고유의 로컬 stopword 파일을 쓸 때도 동일한 패키지에 포함한다.

한국어 품질은 지원된다고 추정하지 않는다. release gate에는 종목명, 기업명, 테마, 띄어쓰기 변형,
한/영 ticker, 조사/접사와 혼합 문장으로 구성한 고정 corpus를 두고 top-k recall과 결과 안정성을
검증한다. 기준을 못 넘으면 UI에 "키워드 검색" 한계를 표시하고 exact/property search를 fallback으로
사용한다. embedding/vector 검색으로 우회하지 않는다.

`fts`는 동적 확장이므로 완전 오프라인 Electron 배포에서 최초 실행 다운로드에 의존하면 안 된다.
0.19.1 및 Windows architecture와 일치하는 공식 extension artifact를 앱 번들에 포함하고 checksum을
검증한 뒤 profile의 로컬 extension directory에서 설치/로드한다. extension ABI가 pin과 다르거나
artifact가 없으면 graph core는 안전하게 시작하되 FTS readiness는 degraded로 표시하고 설치를 위해
인터넷에 접속하지 않는다.

명시적으로 금지한다.

- ChromaDB 및 모든 vector database
- local/remote embedding model과 embedding API
- LadybugDB `llm` extension의 설치 또는 로드
- vector index/property 및 embedding cache

## 8. Local-only API와 Electron 승격 계획

Graph API는 loopback에만 bind하고 기존 local bearer-token 경계를 재사용/강화한다. CORS는 product
origin allowlist만 허용하고 LAN wildcard, unauthenticated graph endpoint, raw query endpoint는 금지한다.
API 응답은 source evidence identifier를 반환하되 원문 전체는 필요한 evidence endpoint에서만 최소화해
반환한다. background extraction은 order API를 호출할 capability를 갖지 않는다.

현재 Electron은 production 경계가 아니므로 다음 순서로 spike를 product로 승격한다.

1. 실제 desktop package와 Electron main/preload/renderer 경계를 만든다.
2. main이 profile별 Python backend 한 개를 loopback의 임의 사용 가능 port와 일회성 bearer token으로
   시작하고 `/ready`를 기다린다.
3. renderer는 preload의 좁은 typed IPC/API만 사용한다. filesystem, LadybugDB, backend token에 직접
   접근하지 않는다.
4. app quit/profile switch 시 main이 backend graceful shutdown을 기다리고, 비정상 종료 후 lock과
   job recovery를 검증한다.
5. `spike/electron-glass`의 시각 결과는 production component로 재구현하고 spike 코드를 runtime으로
   import하지 않는다.

이 ADR은 이 승격 계획을 승인하지만 production Electron/chat/LLM/persistence가 이미 있다고 주장하지
않는다.

## 9. Ultragoal 구현 마일스톤

| Goal | 이 ADR 이후 산출물과 종료 조건 |
|---|---|
| G002 | ontology registry, `ladybug==0.19.1`, schema/version manager, single-owner store, fixed query templates, FTS/offline package, rebuild/reset tests |
| G003 | 실제 authoritative source adapters, durable job/cursor/fingerprint, bounded queue, retry/restart/idempotency tests |
| G004 | 기존 또는 새로 명시한 configured LLM boundary, strict extraction schema, provenance validation, no model-authored query tests |
| G005 | lifespan-owned hourly scheduler, manual refresh/status, local-only summary/search/neighborhood/timeline/evidence/reset APIs |
| G006 | graph path와 evidence를 반환하는 explainable context, observation/inference 분리, unsupported personalization 방지 |
| G007 | production Electron 승격과 실제 투자의 뇌 UI; spike가 아닌 renderer에서 empty/loading/error/privacy 상태 포함 |
| G008 | Windows package, offline FTS, restart/recovery, API auth, Korean corpus, desktop visual/E2E, vector-free manifest 검증 |
| G009 | cleaner 후 재검증, architecture invariant audit, 독립 code-reviewer APPROVE 및 architect CLEAR |

## 10. 주요 위험과 완화

| 위험 | 완화/중단 조건 |
|---|---|
| 0.19.1 package와 문서/release 표기의 drift | exact pin, runtime version assertion, wheel/hash 보관, 업그레이드 ADR |
| Windows wheel 또는 FTS ABI 불일치 | 지원 matrix CI와 packaged artifact smoke; 불일치 시 release 중단 |
| 여러 process의 DB open | profile process lock, Uvicorn one-worker assertion, Python-only owner |
| 긴 graph write가 API/event loop를 막음 | bounded async queue, 전용 writer, request는 job ID만 반환 |
| crash 후 중복 edge/손상 cursor | raw-store job log, fingerprint/idempotent upsert, transaction 후 cursor commit |
| 한국어 FTS 품질 부족 | `stemmer='none'`, 고정 corpus acceptance, exact/property fallback |
| LLM hallucination 또는 query injection | strict typed validation, allowlisted ontology와 query templates, provenance 필수 |
| graph가 원본 역할을 침범 | projection reset/rebuild 시험과 source-to-graph reconciliation |
| local data 노출 | loopback bind, bearer token, strict CORS/IPC, raw query endpoint 금지 |
| spike를 제품으로 오인 | production package/launcher/E2E가 없으면 G007/G008 미완료 처리 |

## 11. 수용 검사

구현 완료 전 다음을 자동 또는 패키지 smoke test로 증명한다.

- dependency/lock/runtime이 정확히 LadybugDB 0.19.1을 사용한다.
- Chroma, vector, embedding, LadybugDB `llm` extension 문자열과 dependency가 제품 경로에 없다.
- 동일 profile의 두 번째 backend 또는 `workers>1` startup이 실패한다.
- DB lifecycle이 lifespan startup/shutdown과 함께 한 번만 open/close된다.
- 모든 mutation이 하나의 writer task를 통하고 concurrent producer에서도 중복 node/edge가 없다.
- source record 수정/재처리/재시작 후 cursor와 projection이 일관되다.
- projection 삭제 후 authoritative raw stores만으로 동일 논리 그래프를 rebuild한다.
- malformed LLM payload, 미허용 type/identifier/query가 DB 실행 전에 거부된다.
- query template 값이 parameterized되며 injection payload가 query 구조를 바꾸지 못한다.
- FTS가 bundled offline artifact로 network 없이 load되고 BM25 검색이 동작한다.
- 한국어 corpus가 합의된 top-k 기준을 충족하거나 명시적 degraded/fallback 동작을 보인다.
- graph API가 loopback/token 없이 접근되지 않고 renderer가 DB/token/filesystem을 직접 받지 않는다.
- recommendation context의 모든 주장에 graph path와 local source provenance가 있고 inference가 표시된다.
- scheduler/manual refresh가 order endpoint를 호출하지 않고 renderer responsiveness를 훼손하지 않는다.
- production Electron surface에서 populated/empty/loading/error/privacy/reset을 시각 검증한다.

## 12. 공식 근거

- LadybugDB 설치, embedded runtime, Python/Node 지원, MIT license:
  <https://docs.ladybugdb.com/installation/>
- LadybugDB Python sync/async API:
  <https://docs.ladybugdb.com/client-apis/python/>
- 공식 extension 목록 (`fts` BM25, `llm` extension의 존재):
  <https://docs.ladybugdb.com/extensions/>
- FTS의 node `STRING` 제한, stemmer 목록, BM25 query:
  <https://docs.ladybugdb.com/extensions/full-text-search/>
- PyPI 고정 배포 0.19.1:
  <https://pypi.org/project/ladybug/0.19.1/>
- 공식 release history 및 binary assets:
  <https://github.com/LadybugDB/ladybug/releases>
- 공식 source와 MIT license:
  <https://github.com/LadybugDB/ladybug>

## 13. 결과

이 결정은 Python backend ownership, rebuildable projection, single writer, parameterized fixed queries,
local-only API, BM25-only retrieval, offline extension packaging을 비가역적 구현 기준으로 삼는다.
Node direct embedding, vector/embedding 도입, graph를 원본으로 사용하는 변경은 이 ADR과 충돌하며
구현 전에 새로운 사용자 결정과 대체 ADR이 필요하다.
