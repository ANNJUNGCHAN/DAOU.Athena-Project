# Grok 인수인계: 도구·화면·카드 탐색 지연 개선

## 바로 이어서 시작

이 브랜치를 받은 Grok에게 [GROK-START.md](GROK-START.md)의 내용을 첫 메시지로 전달한다. 원래 Codex 대화, 개인 메모리, `.omx` 폴더, Codex 전용 도구가 없어도 이 폴더와 저장소 소스만으로 이어서 진행하도록 구성했다.

새 폴더로 받는 경우:

```sh
git clone --branch codex/tool-discovery-latency-handoff --single-branch https://github.com/ANNJUNGCHAN/DAOU.Athena.git Athena-tool-discovery
cd Athena-tool-discovery
git status --short --branch
git log -1 --oneline
```

기존 clone에 미완료 작업이 있으면 checkout으로 옮기지 말고 별도 worktree를 만든다:

```sh
git fetch origin
git worktree add -b resume/tool-discovery-latency ../Athena-tool-discovery-resume origin/codex/tool-discovery-latency-handoff
```

이미 같은 로컬 브랜치/폴더가 있으면 내용을 확인한 뒤 다른 이름을 사용한다. 저장소 인증은 수신자 환경에서 준비하며 자격 증명은 이 인수인계에 포함하지 않는다. 특정 Grok CLI 플래그나 자동 지침 로딩에 의존하지 않는다.

## 새 환경 설치와 확인 명령

저장소 루트에는 Node 프로젝트가 없으므로 `app`에서 실행한다. Python 3.11 이상, PATH의 `node`, `npm`, `uv`, Git을 먼저 확인한다. 아래는 기존 저장소 문서와 package scripts에서 확인한 명령이며 이번 인수인계 작성 중 실제 설치/앱 테스트를 수행했다는 뜻은 아니다.

```powershell
Set-Location app
npm install
node node_modules/electron/install.js
Set-Location ../backend
uv sync --extra dev
Set-Location ..
```

설치가 lockfile을 변경하면 그 변경을 기능 수정에 자동 포함하지 말고 이유를 확인한다. `backend/.env.example`은 로컬 환경 설정의 예시다. 실제 인증값은 수신자 환경에서 별도로 설정하고 Git에 추가하지 않는다.

변경 범위에 맞는 테스트를 먼저 선택하고, 필요할 때 다음의 기존 검사 명령으로 넓힌다:

```powershell
Set-Location app
npm run test:unit
Set-Location ../backend
uv run pytest -q -p no:randomly
Set-Location ..
```

Electron의 `npm run verify:paper`, `npm run verify:card-buttons`, `npm run verify:card-api-sweep`는 `app`에 실제 등록된 별도 UI 검사다. 실행 전에 각 스크립트의 대상·부작용·profile 옵션을 확인하고, 임시 프로필로 한 번에 한 lane만 실행한다. 기존 사용자 프로필을 테스트에 재사용하지 않는다. 전체 검사를 무조건 먼저 돌리지 말고 계측·selector·Grok bridge 변경에 맞는 테스트를 좁혀 실행한다.

`app/test-fixtures/grok-acp-mcp-fixture.js`는 실제 공급자 없이 프로토콜 검사를 위한 fixture다. fixture의 빈 표를 금융 데이터나 실제 화면 성공의 증거로 사용하지 않는다. Grok 자체의 로그인과 실행 방법은 설치된 도구 버전의 도움말에서 확인하며 존재하지 않는 명령을 추측하지 않는다.

이 저장소에는 `2026-09-07-grok-build` 등 다른 작업의 과거 인수인계도 있다. 이번 작업의 진입점은 이 폴더다. 과거 문서의 baseline·WIP 복원·실행 지시를 이번 브랜치에 그대로 적용하지 않는다. root `RTK.md`는 이 인수인계에서 존재를 확인하지 못했으므로 누락 시 일반 shell 도구로 진행하고 해당 한계를 기록한다.

## 이 브랜치의 상태와 범위

- 기준 커밋: `6352c851550d4bf1a98f98f6c25d130078bd5b59` (2026-09-09 확인한 origin/main과 일치).
- 이 대화에서 완료한 것: 사용자 요구 정리, 현재 경로 확인, 외부 공개 구현/벤치마크 조사, 단계별 계획 작성, 구조 검토, 별도 비판 검토.
- 아직 하지 않은 것: 이 계획에 따른 애플리케이션 코드 수정, 계측 추가, A/B/C 실험, 최적화 효과 입증, 배포.
- 이 브랜치가 추가하는 것은 인수인계 문서뿐이다. 기준 커밋에 이미 들어 있는 기존 코드와 개선은 그대로 포함된다.
- 원래 작업 폴더에는 다른 작업의 dirty 변경과 별도 브랜치 생성이 동시에 진행됐다. 다른 작업의 미커밋 변경을 임의로 포함하지 않았다. 따라서 이 브랜치가 원래 폴더 전체의 WIP snapshot이라는 뜻은 아니다.
- 원본 계획은 ignored `.omx/plans/2026-09-09-tool-discovery-latency-plan.md`에 있었다. 해당 본문을 [PLAN.md](PLAN.md)로 보존하여 Git만으로 전달되게 했다. 계획 작성 시 HEAD와 이번 이관 기준 HEAD는 다르므로 코드 위치와 동작을 새 기준에서 다시 확인한다.
- 완료된 계획은 [PLAN.md](PLAN.md), 실제 다음 행동은 [GROK-START.md](GROK-START.md)를 따른다. PLAN의 마지막 문장은 계획 작성 시점의 구현 미착수 상태를 기록한 것이며 이번 사용자 요청은 수신 AI가 아래 실행을 이어가는 인수인계를 요구한다.

## 사용자의 요구와 중요한 결정

사용자는 하나의 요청에 검색·스키마 확인·실패 판단이 여러 차례 이어져 오래 걸리는 경험을 줄이려 한다. 첨부 화면에는 '금현물 시장가 매수', '금현물', '금 현물 시세' 등 비슷한 검색과 3회의 실패 판단이 나타났다. 이 예시는 요청 로그 자체가 아니며 실제 최초 입력, 서버 오류, 순차/병렬 여부, 단계별 비용 원인을 확정하지 못했다.

사용자는 처음에 모든 검색이 대화 메모리에 의존하는지 물었고, 파일 검색처럼 빠르게 필요한 도구·화면을 찾는 구조와 RDB 활용을 제안했다. 조사 결과 이미 SQLite 종목 인덱스, 결정적 빠른 경로, 어휘 기반 selector 검색, 서버 카드 계약이 존재했다. 따라서 새 DB를 먼저 만드는 대신 기존 경로가 왜 중복 탐색되는지 측정하기로 했다.

선택한 순서:

1. 기준 코드·환경·정답 요청 세트 고정.
2. 입력부터 실제 데이터 카드가 표시될 때까지 임계 경로 측정.
3. 같은 실패를 재탐색하는 루프와 동일 검색/스키마의 중복 제거.
4. 기존 dispatch/preflight 묶음 응답을 각 공급자 경로가 활용하는지 확인. 부족한 경우에만 기존 계약 확장.
5. 검증된 단일 조회·명시적 UI 액션에 한해 기존 fast path 확대.
6. 권한·schema/catalog·종목 마스터 버전을 반영한 캐시 및 단계적 적용.

첫 구현 범위는 계획의 0~2단계다. 기존 묶음 응답이 이미 사용되고 공급자 세션이나 인식기 순서가 병목이면 불필요한 새 계약을 만들지 않고 측정된 병목의 최소 수정으로 전환한다. 더 큰 구조 변경은 측정 근거와 범위를 먼저 기록한다.

## 외부 조사와 숫자의 의미

| 출처 | 확인한 내용 | 한계 |
|---|---|---|
| [Anthropic Tool Search](https://www.anthropic.com/engineering/advanced-tool-use) | 필요한 도구만 정규식/BM25 등으로 검색. 토큰 85% 감소, 내부 MCP 평가 Opus 4 정확도 49→74%, Opus 4.5 79.5→88.1% 보고 | 업체 내부 평가. Athena 지연이나 카드 성공률의 실측이 아님. 검색 단계 자체는 지연 추가 가능 |
| [Anthropic Code Execution + MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | 도구 파일을 필요할 때 읽고 호출·중간 처리를 코드로 묶음. 예시에서 150,000→2,000 토큰 | 특정 예시의 토큰 수. 98.7%의 시간 단축이나 일반 정확도 보장으로 해석 금지 |
| [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search) | hosted 및 client-executed 검색. 애플리케이션이 필요한 도구 정의를 반환 가능 | API 기능과 현재 Athena의 각 CLI 어댑터 지원은 별개 |
| [MCP Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | 도구 목록·스키마·변경 알림·권한별 가용성 | 캐시가 실행 권한이나 일회성 plan을 대체하지 않음 |
| [Elastic 검색](https://www.elastic.co/docs/solutions/search/ranking) | 후보를 저렴하게 검색한 뒤 작은 후보 집합을 재정렬 | 검색 후보의 정답 누락과 의미상 오선택을 별도 평가해야 함 |

공개 근거에 대한 조사이며 외부 서비스를 대상으로 자체 재현 벤치마크를 수행한 것은 아니다. 링크는 2026-09-09 조사 기준이다. 구현 시 실제 설치 버전이 요구하는 동작만 추가 확인한다.

## 이어서 읽을 코드

줄 번호 대신 함수와 심볼을 검색한다. PLAN의 줄 번호는 조사 당시 위치다.

| 영역 | 우선 파일/심볼 |
|---|---|
| 입력·빠른 경로 진입 | `app/main.js`의 `runLiveQueryInnerBody`, `app/lib/main/selector-fast-path.js`의 `runSelectorFastPath` |
| 모델에게 주는 절차 | `app/lib/main/live-prompt.js`, `search_tool`, `use_tool`, `athena_search/describe/resolve` |
| 기존 시간 측정 | `app/lib/main/provider-runtime-metrics.js` 및 fast path의 `durationMs`, 표시 완료/상관관계 검증 |
| 검색·검증 | `backend/athena_api/selector/service.py`의 `SelectorService.search/describe/resolve`, `selector/ranking.py`의 `search_catalog` |
| 기존 묶음·실행 경계 | `backend/athena_api/api/canvas_push.py`의 selector dispatch/preflight |
| 카드 계약 | `backend/athena_api/card_surface_contract.py`, 원본 routing/card registry와 생성 스크립트 |
| Grok 전송 | `app/lib/main/grok-acp-session.js`와 관련 테스트. `grok-tool-bridge.js`는 이 기준 커밋에 없으므로 해당 파일을 전제로 작업하지 않음 |

생성 파일만 직접 고쳐 원본과 어긋나게 하지 않는다. `backend/ref/selector-routing.json`, `backend/scripts/generate_api.py` 등 실제 생성 원본·명령을 먼저 확인한다. 도구 검색 점수는 선택의 근거이지 실행 허가가 아니다.

## 정확도·검증·작업 경계

- 종목 identity, 요청 의미 호환성, 필수 인자, 권한, 승인, 일회성 plan 검증을 모든 경로에서 유지한다.
- quote/order, 금현물/금 ETF, 비교·부정·복수 대상·대명사·누락 인자에 대해 직접 연결을 억지로 성립시키지 않는다.
- `visiblePaintAt`나 빈 카드 shell만으로 성공하지 않는다. 실제 hydration 및 대상·기간·단위·데이터 출처까지 검증한다.
- 실패/timeout을 실험에서 제외하지 않는다. cold/warm, 공급자/모델/기능별로 p50/p95와 실패율을 분리한다.
- A=현재 기준, B=중복 제거/기존 묶음 활용, C=B+검증된 직접 연결 확장. 기존 fast path는 A에도 존재한다.
- 초기 300건 정답 세트와 별도 holdout은 아직 작성되지 않았다. 사용자 제공 정답인 것처럼 취급하지 않는다. PLAN의 성능 목표도 제안이며 기준 측정 후 후보 결과를 보기 전에 확정한다.
- 새로운 오실행, 권한/승인 우회, 일회성 plan 재사용을 발견하면 해당 경로 적용을 중단한다. shadow 비교에서는 두 번째 실제 조회/렌더/주문을 실행하지 않는다.
- 실제 주문, 자격 증명 복사, 다른 작업의 변경 삭제, main 강제 갱신은 이 작업에 포함되지 않는다. 읽기 전용 라이브 검증이 불가능하면 그 부분은 미검증으로 보고한다.

## 검토 결과와 다음 산출물

계획은 작성 패스 이후 Architect 검토 APPROVE, 그 후 별도 Critic 검토 APPROVE를 받았다. 주요 반영 사항은 기존 preflight 재사용, fingerprint 명확화, hydration 완료 구분, 계측 결과에 따른 계약 확장 생략이다. 이 검토는 계획의 적절성에 대한 것으로 코드/성능 검증을 뜻하지 않는다.

수신 AI의 첫 결과물은 기준 manifest와 짧은 단계별 지연 보고서다. 이후 측정 근거를 바탕으로 작은 코드 변경과 해당 회귀 테스트를 추가하고, 이 폴더의 진행 기록에 실제 명령·결과·커밋·미검증 항목을 남긴다. Codex/OMX 전용 에이전트나 스킬이 없으면 일반 코드 탐색·실행·독립 검토로 진행하며, 존재하지 않는 도구를 반복해서 찾지 않는다.
