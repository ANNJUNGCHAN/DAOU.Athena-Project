# 프로젝트 조회 404 소스 진단

## 판정

10:53 조회 연쇄의 `tree`와 `env` 404는 현재 증거상 제품의 경로 격리 실패가 아니다. 프로젝트 목록에서 첫 행을 고른 감사 입력 선택이 `exists:false`인 등록 행을 걸러내지 않은 결과와 일치한다.

`GET /api/v1/projects`는 레지스트리에 남아 있는 행을 폴더 존재 여부와 무관하게 모두 반환하고, 각 행에 그 순간의 `exists` 값을 붙인다 (`backend/athena_api/api/projects.py:111`, `:135`). 반면 `tree`와 `env`는 공통으로 ID 등록 여부를 확인한 다음 실제 경로가 디렉터리인지 다시 확인한다. 등록 ID가 없거나 등록된 폴더가 사라졌으면 각각 404다 (`projects.py:78`, `:85`, `:189`, `:329`). 이 fail-closed 동작은 사라진 폴더를 목록에는 `exists:false`로 보이고 후속 tree에는 404를 기대하는 API 테스트로 고정돼 있다 (`backend/tests/api/test_projects_api.py:181`).

현재 백엔드 설정과 같은 `projects_root`의 `registry.json`을 직접 읽어 이름·경로·ID를 버리고 집계했다. 이 읽기는 `ProjectStore.load()`를 호출하지 않아 손상 레지스트리 보존 rename 경로도 실행하지 않았다.

| 메타데이터 | 관측값 |
| --- | ---: |
| 레지스트리 파일 존재 | true |
| JSON 및 `projects` 배열 정상 | true |
| 등록 행 | 2 |
| 실제 경로 존재 | 1 |
| 실제 디렉터리 | 1 |
| 디렉터리가 아닌/사라진 행 | 1 |
| 첫 행 경로 존재 | false |
| 첫 행이 디렉터리 | false |
| ID 비어 있지 않음 | true |
| ID 중복 없음 | true |
| kind가 managed/external 중 하나 | true |
| managed 경로가 관리 루트 내부라는 정책 충족 | true |

실행 기록은 목록의 기존 2건 중 첫 행을 선택했다고 명시한다. API가 레지스트리 순서를 그대로 보존하고 현재 첫 행의 폴더가 없으므로, 이 스냅샷에서는 `_entry()`는 통과하고 `_root()`가 404를 반환하는 경로가 성립한다. 응답 본문을 보존하지 않은 기존 감사 artifact만으로 두 404의 상세 문구까지 역추정하지는 않는다.

## 목록 성공 뒤 404가 가능한 소스 계약

1. 가장 직접적인 경로는 등록 행의 폴더가 디스크에서 이동·삭제된 경우다. 목록은 행을 유지하며 `exists:false`를 반환하고, tree/env는 `_root()`에서 404가 된다. 현재 첫 행이 이 상태다.
2. 목록과 후속 요청 사이에 레지스트리가 등록 해제되거나 바뀌면, 각 요청이 새 `ProjectStore`와 새 `load()`를 사용하므로 후속 `_entry()`에서 404가 가능하다 (`projects.py:56`, `store.py:347`, `:377`, `:437`). 현재 레지스트리는 정상 JSON이고 ID가 유일하므로 이번 실행에서 이 경합이 일어났다는 증거는 없다.
3. 손상 레지스트리는 `load()`가 빈 목록으로 강등하고 notice를 반환한다 (`store.py:347`). 이번 직접 읽기에서는 손상이 없으므로 현재 원인이 아니다.

따라서 현재 결과는 `HARNESS_INPUT_STALE_PROJECT`로 분류할 수 있다. 제품 결함 판정은 보류한다. API가 `exists:false` 행을 정직하게 드러내고 후속 경로에서 404로 막는 동작 자체는 테스트된 계약이다.

## 다음 read-only 실행의 후보 선택

후속 감사는 목록 순서나 첫 행을 사용하지 않고 아래 조건을 모두 만족하는 행만 후보로 삼는다.

1. 목록 HTTP 200, `projects` 배열, `notice === null`이어야 한다. notice가 있으면 레지스트리 상태를 먼저 해소할 때까지 후보 선택을 차단한다.
2. `id`는 비어 있지 않은 문자열이고 같은 응답 안에서 유일하다. ID 원문은 요청 구성 중 메모리에만 두고 artifact에는 저장하지 않는다.
3. `exists === true`인 행만 사용한다. `kind`는 `managed` 또는 `external`이어야 한다.
4. 후보가 하나 이상이면 한 건을 골라 tree와 env를 순차 호출한다. 응답에서는 tree 항목 수·디렉터리 수·Python 파일 수·`truncated`와 env의 `exists`·package 수·`base_ok`만 저장한다. 이름, 상대/절대 경로, Python 실행 경로, package 이름은 저장하지 않는다.
5. tree 404면 같은 ID로 file을 시도하지 않는다. 목록을 한 번 새로 읽고 그 행의 `exists` 변화와 후보 유지 여부만 확인한다. 행이 사라졌으면 `REGISTRY_CHANGED_BETWEEN_READS`, 남아 있으나 `exists:false`면 `PROJECT_ROOT_VANISHED`, 여전히 `exists:true`면 `SOURCE_CONTRACT_MISMATCH`로 분리한다.
6. 사용자 프로젝트의 파일 본문은 읽지 않는다. file GET 검사는 감사 소유 프로젝트에서만 수행한다.

현재 집계에는 실제 디렉터리인 등록 행이 1건 있으므로, 다음 tree/env 메타데이터 검사는 새 프로젝트 생성 없이 그 후보로 수행할 수 있다. 이는 실행 시점의 새 목록에서 `exists:true`가 다시 확인될 때만 유효하다.

## 기존 후보가 없을 때의 감사 소유 프로젝트

실행 시점에 `exists:true` 후보가 없다면 자동으로 임의 사용자 경로를 고르지 않는다. 별도 mutation 승인 범위에서 다음 소유권 절차를 사용한다.

1. workspace의 감사 artifact 하위에 매 실행 고유한 빈 디렉터리를 만든다. 생성 전 부모의 절대 경로가 workspace 감사 디렉터리 내부인지 확인한다.
2. `POST /api/v1/projects/open`으로 그 빈 디렉터리를 external 프로젝트로 등록한다. 서버의 `open_external()`은 기존 디렉터리만 등록하고 내부 파일을 만들지 않는다 (`store.py:409`).
3. 반환 행의 `exists:true`, `kind:external`과 등록 전후 개수 차이 1을 확인한다. ID와 경로는 실행 중에만 유지하고 artifact에는 소유권 booleans만 남긴다.
4. tree/env의 빈 상태를 검사한다. file GET은 먼저 감사 디렉터리 안에 감사 소유 `.py` 파일을 별도 승인된 쓰기 경로로 만든 경우에만 수행한다.
5. 종료 시 `DELETE /api/v1/projects/{id}`로 레지스트리 등록만 해제한다. 이 백엔드 DELETE는 디스크 폴더를 지우지 않는다 (`projects.py`의 unregister 계약, `store.py:437`). 이후 exact audit-owned 디렉터리가 비어 있고 workspace 감사 루트 내부임을 다시 확인한 뒤 그 디렉터리만 정리한다.

관리형 `POST /api/v1/projects`는 빈 프로젝트가 아니라 `strategy.py`를 생성하므로 빈 tree/env 경계 검사에는 사용하지 않는다 (`store.py:383`). 앱의 `athena:project-remove`는 별도의 대화 프로젝트 삭제 의미가 있으므로 이 백엔드 레지스트리 정리와 섞지 않는다.

## 남은 증거 경계

- 이번 진단은 소스와 현재 레지스트리 메타데이터의 read-only 집계다. 후속 tree/env HTTP를 다시 호출하지 않았다.
- 기존 404 응답 본문을 저장하지 않아 `_entry()`와 `_root()` 중 실제 반환 지점은 artifact만으로 확정하지 않는다. 현재 첫 행의 사라진 폴더가 `_root()` 404를 설명하는 강한 일치 증거다.
- 사용자 프로젝트 파일 내용, 환경 변수, package 이름, 프로젝트 이름·경로·ID는 읽기 결과에 기록하지 않았다.
- `MODE-LIVE-GAPS.md`의 live 모드 전환 차단은 provider idle/대화 복원 문제다. 여기서 확인한 백엔드 프로젝트 후보 선택은 그 차단을 단독으로 해제하지 않는다.
