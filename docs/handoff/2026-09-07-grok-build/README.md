# DAOU.Athena → Grok Build 상세 인수인계

작성일: 2026-09-07 (Asia/Seoul). **이 문서는 검수 완료 보고서가 아니라, 작업을 중단한 지점과 남은 일을 넘기는 문서다.**

## 1. 가장 먼저 알아야 할 현재 상태

- 저장소: `C:/Projects/DAOU.Athena`, 원격: `https://github.com/ANNJUNGCHAN/DAOU.Athena.git`.
- 인계 기준 커밋: **`ac4938008690a86e19c22e2c2d612db11aa52b03`**, 브랜치 `main`. 작성 시작 시 로컬·원격이 같았고 열린 PR은 0개였다.
- 마지막 병합은 PR #25, 기본 셸 창 크기를 **2120×1165 DIP**로 확대했다. 작은 작업 영역에서는 `computeLayout()`이 비율 축소한다. 사용자가 현재 올라온 PR을 모두 합치라고 명시했고, 당시 미병합 원격 브랜치도 모두 해소했다.
- **제품·테스트 파일 9개가 미커밋 상태다.** 작성자 검증은 통과했지만 비작성자 리뷰와 최종 통합 검증은 아직이다. 이것을 버리거나 원격 `main`에 이미 있다고 가정하면 안 된다.
- 전체 검수는 미완료다. 342개 역사 항목을 전부 재판정했지만, `open`에는 기능 결함·부분 구현·검증 공백·문구/주석 부채가 함께 들어 있다. 동일 원인을 중복 집계한 항목도 있어 단순히 “결함 342개”라고 부르면 안 된다.
- 이번 인계 요청을 받아 신규 구현을 더 진행하지 않고 작성분을 고정했다. 기존 에이전트는 다음 실행 주체가 아니며 Grok Build가 이어서 소유해야 한다.

## 2. 읽는 순서와 파일 구성

1. 이 `README.md`: 상태, 작업 순서, 검증 한계, 환경 및 복구 방법.
2. `START-HERE.txt`: Grok Build에 그대로 전달할 시작 지시.
3. `WORKING-TREE.json`: 인계 시 9개 파일의 SHA-256, Git 상태 및 기준 커밋.
4. `ALL-FINDINGS.md`: **CODE 81 + PAPER 52 + OBS 209 = 342개 전수 항목**. 원래 문제와 현재 판정·위치·근거·한계를 모두 적었다.
5. `ALL-FINDINGS.json`: 위 내용을 자동 처리하기 위한 원장. 원본 감사 상태와 인계 시의 후속 변경 상태를 분리했다.
6. `evidence/`: `.omc`에만 있던 현재 감사·실행 증거의 휴대 가능한 사본. `EVIDENCE-INDEX.json`에서 원래 경로와 복사된 파일을 확인한다.
7. `wip/`: 현재 미커밋 작성분. `tracked.patch`는 기존 파일 8개, `files/`는 신규 파일을 포함한 **9개 파일 전체 바이트 사본**이다.
8. `MANIFEST.json`: 인계 묶음의 파일별 SHA-256. `DOCUMENT-REVIEW.md`는 문서 자체의 독립 검토 결과이며 제품 코드 승인서가 아니다.
9. `related-market-audit/`: PR24에 포함된 별도 시장 세션 감사 Markdown 원본 전부. 아래 11절의 별도 범위 주의사항과 함께 읽는다.

`evidence/code-audit.json`, `paper-audit-a.json`, `paper-audit-b.json`이 최신 독립 감사 원본이다. 과거 `.omc/artifacts/full-review/closure-ledger.json`은 기준이 `91392a2`인 작업 중간 원장이므로 현재 완료 판정에 사용하지 말 것. 일부 원본 로그와 JSON 안의 절대 경로는 과거 실행 당시 경로이며 현재 패키지의 파일 링크와 별개다.

## 3. 사용자 의도와 이미 받은 권한

원래 작업은 Claude Desktop의 DAOU.Athena **“코드 검수”**가 주간 한도로 멈춘 것을 이어받는 것이다. 사용자는 대화와 이력을 확인한 정확한 인계, 계속 검증, `/ralph 검사가 끝날때까지 계속 진행`, 키우미 브랜치의 `main` 병합 및 성공 후 삭제, 이어서 현재 PR 전체 병합을 요청했다. 최신 요청은 **Grok Build에게 넘길 남은 모든 내용의 상세 문서**다.

이미 승인된 저장소 수정·회귀 검증·병합/푸시는 세션 이력에 있다. 그러나 실제 모델 호출, 브로커 API를 이용한 실제 주문, 배포·활성화의 금융 행위를 검증 핑계로 실행하지 않았다. 다음 담당자도 결정론 fixture/주입 테스트와 실제 거래 동작을 구분해야 한다. 인계 문서 생성은 미검토 작성분을 자동 승인하거나 배포하라는 뜻이 아니다.

새 사용자 선택이 아직 없는 두 갈래:

- 키우미 얼굴/빈 캔버스: 기존 앱 결정(얼굴 1종, 빈 캔버스 문구 회전)을 유지하고 Paper를 정리할지, Paper의 다른 표현을 복구할지.
- 동시 작업: 현재 단일 실행을 유지할지, 세 작업 동시 실행/FIFO/취소 의미까지 새로 구현할지.

앞서 비동기 질문을 보냈지만 답변을 받지 않았다. 시간 경과나 PR 병합 지시를 이 두 설계 선택의 답으로 간주하지 말 것. 기존 코드와 사용자 결정이 충돌하는 Paper 보드를 임의로 맞추지 않는다.

## 4. Git 이력과 보존할 변경

| 커밋 | 의미 |
|---|---|
| `bc4bdc2`, `765d5dc` | 초기 세션 경계 수정과 인수인계 기록 |
| `f2de70d`, `f601f5b`, `91392a2` | 백테스트/출처 경계, 검사 UI, 2차 인계 증거 |
| `97c8b357` | 요청받은 `codex/fix-kiwoomi-conversation` 원본 tip |
| `171dce86` | 키우미 병합 및 창 간 중복 질의 admission 보완 |
| `7efe1c48` | 사용자가 병합한 PR #24 backtest-ui |
| `da5cd98f` | 두 작업을 통합한 main |
| `53055acb` | 사용자가 추가한 병합 이력. `da5cd98f`와 tree 동일 |
| `949eefd5` | clearWorkspace의 잔류 시각 상태 해제 + 미니 프로브 저장소 초기화 |
| `e9f9c5d0` | historical-findings의 계좌 식별자 재노출 마스킹 |
| `ac493800` | PR #25 기본 창 크기 확대, 인계 기준 main |

키우미 원격 브랜치는 이미 삭제했다. 새로운 담당자가 다시 삭제하거나 같은 변경을 재병합할 이유가 없다. PR #25는 GitHub에서 MERGED 확인했다. 이력 변경이나 main 강제 푸시는 하지 않았다.

현재 작업 트리에 남은 파일:

**WIP-A, OBS-077/078 — 7개**

```text
app/chat.js
app/lib/agent-canvas.js
app/lib/agent-canvas.test.js
app/lib/watch-check-card.js
app/lib/watch-check-card.test.js
app/lib/watch-check-card-render.test.js   # 신규 파일, git diff만으로는 전달되지 않음
app/shell.html
```

**WIP-B, CODE-039/075 — 2개**

```text
app/scripts/run-verify-suite.js
app/scripts/run-verify-suite.test.js
```

PR #25 통합 때 초기 RED 테스트 3개를 stash `a550ae6bee851ecb95bb760bda79cbacabde0861`로 보존했다가 바이트 동일하게 복원했다. 그 뒤 구현이 더 진행됐으므로 **그 stash는 현재 9개 파일의 최종 백업이 아니다.** 현재 snapshot은 이 묶음의 `wip/files/`와 `WORKING-TREE.json`이다.

이 저장소에는 다른 작업용 worktree도 있다. `.claude/worktrees/` 두 곳과 `C:/Projects/DAOU.Athena-gates`, `C:/Projects/DAOU.Athena-parity`를 인계 정리 목적으로 삭제하지 말 것. 특히 과거 작업 폴더에는 main의 `node_modules`/`.venv`를 가리키는 junction이 있어 재귀 삭제는 위험하다. 실제 현재 목록은 `git worktree list --porcelain`로 다시 읽는다.

## 5. 인계 직후 해야 할 일 — 실행 순서

### 단계 1: 동일 상태 확인 및 작성분 확보

```powershell
Set-Location C:/Projects/DAOU.Athena
git status --short --branch
git rev-parse HEAD
git fetch origin
git log --oneline HEAD..origin/main
git worktree list --porcelain
```

현 파일 SHA를 `WORKING-TREE.json`과 대조한다. 같은 로컬 작업 공간이라면 patch를 다시 적용하지 않는다. 다른 checkout으로 옮기는 경우 먼저 정확한 기준 커밋을 준비하고 깨끗한 작업 트리에서 `git apply --check .../wip/tracked.patch` 후 적용한다. 신규 `watch-check-card-render.test.js`는 `wip/files/app/lib/`에서 별도로 복사한다. 기준이 달라졌다면 전체 파일 덮어쓰기 대신 diff로 병합한다. `.env`, 계정 프로필, 비밀값, 의존성 폴더는 이 인계에 포함하지 않았다.

### 단계 2: WIP 두 묶음을 각각 독립 검토

작성자 테스트가 초록이라는 이유만으로 승인하지 않는다. 아래 6·7절의 경계를 검토하고 필요한 수정만 한다. WIP-A는 실제 Electron에서 카드/설정 DOM·기하·클릭 경로를 확인해야 하고 WIP-B는 결과 파일 실패·타임아웃·stale artifact를 다시 확인한다. 이후 전체 앱 테스트와 6개 게이트를 실행한다. 성공하면 서로 구분 가능한 커밋으로 저장하고 main 반영 여부를 정한다.

### 단계 3: 현재 재현된 실패 먼저 처리

1. `2FR9-2`: 코드 흐름 지도의 노드/경계가 0개인 현재 실패를 진단.
2. `2R3M-1`, `137X-2`: 단위/레이블 중복 표시와 state-board 누락을 구분해 수정.
3. `4TY-0`: 새 키우미 대화 명칭과 Paper 문구의 불일치. 새 제품 동작을 단순히 되돌려 게이트만 맞추지 말 것.
4. XI-0 전수 검사 흔들림을 고립 반복과 전수 순서 모두에서 확인.
5. live-full 하네스의 false-green/실프로필/캡처 stub를 고친 뒤에만 그 하네스 결과를 믿는다.

### 단계 4: 전수 원장 342개를 근거로 잔여 구현/문서/원본 정합 처리

`ALL-FINDINGS.md`의 open 항목을 실제 제품 결함, 검증 결함, 문구/문서 부채로 나누어 작은 단위로 수정한다. 기존 감사의 모든 open을 같은 우선순위로 처리하거나 파일 전체를 재작성하지 않는다. `source-blocked` 14개는 원본 접근/설계 선택이 선행한다. 이미 fixed인 항목은 근거가 훼손됐거나 현재 회귀를 재현했을 때만 다시 연다.

### 단계 5: 최종 완료 조건

- 미검토 WIP 없음, 발견된 실행 가능한 회귀 미해결 0, 각 항목에 정당한 최종 상태와 증거.
- 테스트 skip/placeholder를 구현 완료로 계산하지 않음.
- 독립 리뷰 및 최소 정리 후 현재 소스에서 필요한 검사 재실행.
- Paper 원본 수정이 불가능하거나 사용자 결정이 없으면 그 항목은 완료 대신 정확한 blocker로 남김.
- 보고서 생성기 경로 및 오래된 “7장만 남았다/전부 적용” 문구를 정정하고 검수 근거를 새로 연결.
- 완료 보고는 실제 파일과 실행 ID·커밋·소스 해시에 결박. 현재 문서는 이 조건을 충족했다고 주장하지 않는다.

## 6. WIP-A: 감시 결과 카드와 설정 데이터 행

문제: 캔버스에는 검사 결과가 있지만 **채팅의 자동검사 결과 카드**에는 날짜 점 띠와 발화 목록이 빠져 있었고, 코드 감시 설정에는 입력 데이터 행이 없었다.

현재 미커밋 구현:

- `watch-check-card.js`가 기존 `WatchNodes`/`WatchFixCycle`을 재사용해 모델을 만든다.
- `chat.js`의 실제 `runWatchCheck` → IPC 응답 → 카드 모델 → DOM 경로에 날짜 점과 울린 날/종가 목록을 넣는다.
- `agent-canvas.js`에 코드 감시의 입력 계약 **“데이터: 일봉 + 오늘 현재가”**를 표시한다. 이것은 현재 데이터 도착/연결 정상 배지가 아니다.
- `shell.html`에서 helper 모듈이 check-card보다 먼저 로드되도록 순서를 바꿨다. Node require만 초록이고 브라우저 UMD가 깨지는 경우를 막는 테스트가 있다.

중요한 데이터 경계:

`backend/athena_api/api/routines.py`의 routine-detail `last_check`에는 `counted_through`/`cooldown_s`가 있지만, `/watch/check`의 `CheckResult.to_dict()` 응답에는 두 값이 없다. `checked_at`을 검사 날짜로 추정하면 자정/휴장 경계가 달라질 수 있다. 현재 프런트 보완은 **성공한 undated 응답에 한해서** 기존 routine-detail을 한 번 읽고, 성공 여부와 `checked_at`이 정확히 같은 `last_check`에서 날짜를 보충한다. 다른 검사 스냅샷·상세 조회 실패는 원래 응답을 유지한다. 이미 날짜가 있거나 실패한 응답은 추가 조회하지 않는다.

검토할 것:

- 추가 await 동안 세션/카드/검사 식별이 바뀌었을 때 오래된 결과가 들어오지 않는지.
- 검사 시각 비교와 routine id의 출처, 응답 mutation 여부, 상세 실패 처리.
- 성공 0회와 검사 실패의 UI를 혼동하지 않는지, 승인 게이트가 유지되는지.
- 실제 close 값만 종가로 표시하는지. Paper의 수익률 견본 숫자를 만들어 넣지 않는다.
- 옛 응답에 일치하는 저장 스냅샷이 없으면 달력을 만들지 않는 의도적 한계가 사용자에게 이해 가능한지.
- backend producer에 이미 계산된 날짜를 직접 싣는 편이 장기적으로 간단할 수 있으나, 현재 작성분은 backend를 전혀 바꾸지 않았다. 이 대안을 이미 구현한 것으로 오해하지 말 것.

증거: `evidence/obs077-078-execution.json`, `obs077-078-red-final.log`, `obs077-payload-red.log`, `obs077-078-green-final.log`.

**OBS-079/080의 채팅 수정 영수증·재검사·비교/되돌리기 누락은 이 WIP의 범위 밖이다.** 캔버스 쪽 구현이나 OBS077/078 성공으로 함께 닫지 않는다.

초기 표시 누락 RED 10/160, 실제 undated payload RED 1/8; 최종 관련 **195/195 PASS**, 신규 테스트 14개 및 기존 1개 갱신. 두 RED/여러 GREEN은 중복 집합이므로 합산하지 않는다. **Electron 검사와 비작성자 승인 미실행.** 따라서 원장의 OBS-077/078은 `implemented_pending_review` overlay이며 최종 fixed가 아니다.

## 7. WIP-B: 검증 실행기의 실행별 증거 보존

문제 CODE-039/075: stdout 끝에 JSON이 있어도 과거 공유 경로의 캡처/리포트를 이번 실행 산출물로 오독할 수 있었고, 실행 결과 JSON 자체도 영속 파일이 없었다.

현재 작성분은 `app/captures/verify-suite/<timestamp-random>/`에 다음을 저장한다:

- 시작/각 단계 종료/전체 종료 시 원자적으로 갱신하는 `result.json`.
- 각 단계의 전체 stdout/stderr 파일, 기존 tail, exit code, timeout/error, 시작/종료/소요 시간.
- Git commit/dirty 및 ignored 제외 tracked+untracked 작업 사본 내용 해시, 시작·종료 대조.
- 진행 중 `ok:null`; 최종 기존 `ok/results` 계약 유지.

**중요한 한계:** `ok`는 하위 프로세스 성공 의미를 유지하며 UI/Paper 완전성을 보증하지 않는다. 로그 파일 쓰기 실패는 false success를 막는다. 공유 리포트/캡처는 하위 하네스가 실행 ID 계약을 제공하지 않으므로 `unverified`라고 명시했다. 소스 대조는 시작·끝 두 snapshot이며 지속 파일 감시가 아니다. `.env`, node_modules, 프로필 등 ignored 환경은 해시에 포함하지 않는다. Git 읽기 실패 시 출처 확인 성공으로 바뀌면 안 된다.

작성자 검증: 기존 13개 PASS + 새 7개 RED 후 추가 대조군을 포함해 runner/catalog **31/31 PASS**. 실제 CLI `--suite paper --only verify:paper-manifest`는 exit 0, stdout JSON과 디스크 JSON 동일, 실제 단계별 파일 존재, `sourceSnapshotsMatch=true`였다. 실행 ID `2026-09-07T07-58-27-753Z-4VhhQf`.

다음 리뷰는 결과 경로 충돌, persist 실패, spawn throw/error, timeout 뒤 늦은 exit 0, stderr/log 실패, 서로 다른 두 실행의 보존, source 변경 표시를 확인한다. 모든 하위 하네스 artifact의 소유 검증까지 해결했다고 닫지 말 것. 증거는 `evidence/verify-suite-evidence-execution.json`과 함께 복사한 RED/GREEN/CLI 로그에 있다.

## 8. 최신 검증의 정확한 의미

| 검사 | 결과 | 적용 범위/한계 |
|---|---|---|
| PR25 통합 앱 전체 단위 | 3520 PASS, fail/skip/todo 0 | **현재 WIP 9개가 추가되기 전** 통합본 |
| PR25 기본 게이트 | 6종 PASS | 라우트 존재 91/95도 별도 한계로 출력; 전체 Paper 성공 아님 |
| PR25 Electron 키우미 | 23/23 PASS | 실제 Electron fixture, 모델/주문 없음 |
| PR25 독립 창 배치 | 단위 14/14 + 작업 영역 8개 | 2560×1392 → 2120×1165, x220/y113; 작은 화면 경계 포함 |
| backend 전체 | **3792 PASS / 6 SKIP / 1 warning / 0 FAIL** | 1361.01초; backend tracked 2041개 시작·끝 내용 동일 |
| Paper screens 전수 | **101/109 PASS, 8 FAIL** | 4 route missing + 2 contract + 2 문구/구조 실패. 래칫은 후자2개를 regression으로 기록하지만 제품회귀 확정과 다름 |
| Paper cards mount 전수 | **94/96 PASS** | 137X-2 및2R3M-1 실패 |
| Paper mini 실제 템플릿 | **11/11, 문법10/10 PASS** | 전체 mini96장의 source 정합과 다른 검사 |
| WIP-A 관련 | 195/195 PASS | 작성자 offline DOM/IPC 테스트; 독립/Electron 미검증 |
| WIP-B 관련 | 31/31 PASS | 작성자 offline subprocess + manifest CLI; 독립 미검증 |

backend skip은 `tests/unit/test_selector_autonomous_eval.py`의 **v5 봉인 코퍼스 미작성 5개**, Windows 심볼릭 링크 생성 `WinError1314` 1개다. 경고는 Starlette TestClient/httpx deprecation. 미작성 봉인 평가를 통과했다고 할 수 없다. 실제 모델/브로커/주문 검증도 아니다.

Paper 전수 증거 `integrated-PAPER-*.json`과 `paper-integrated.stdout.log`는 **PR25 창 크기 변경 전** 실행이다. 검사 도중 커밋 이동은 같은 내용의 검증/문서 commit에 해당했지만 이후 창 크기 변경 및 WIP가 추가됐으므로 현재 UI의 최종 증거로 사용하지 않는다. 다음 Grok 실행에서 관련 Electron 검사를 다시 해야 한다.

오래된 `paper-suite.*`, `pre-upstream-*`, 최초 중단 backend log는 사용자 PR24가 실행 중 통합되었거나 끝나지 않은 자료다. 현재 성공 증거로 재사용하지 않는다. 모듈별 784/599/491/195/31 같은 집합은 전체 테스트와 겹친다. 수를 더해 “N천개 검증”으로 만들지 말 것.

## 9. 현재 Paper 실패와 직접 재현할 대상

### 화면 8건

- `3KM-0`, `3W9B-1`, `2I7Z-2`, `2GZM-2`: route missing. 모두 같은 구현 난이도/원인이 아니다. 얼굴/빈 상태/동시성/비활성 상태 관련 기존 결정과 원본 주장을 확인한다.
- `1XA2-0`, `2DZE-0`: 계약 문장을 추출할 캡션 누락. 코드 구현 부족과 원본 문서 누락을 구분한다.
- `4TY-0`: `#orbPanel`에 Paper 문구 **“메인 대화”**가 없고 현재 제품은 **“키우미 대화”**다. 키우미 브랜치의 승인된 동작 변경과 함께 판단한다.
- `2FR9-2`: `#backtestCanvas`에서 앱/내 코드 노드와 경계 모두 0개. 기대는 app4/mine4/boundary3이며 “앱이 준비해서 건넵니다”, “봉 데이터를 모읍니다”, “조절할 값을 정합니다”, “가격을 지표로 바꿉니다”, “사고·파는 순간을 찍습니다”, “성과를 냅니다”가 없다.

`2FR9-2`의 출발점은 `app/lib/paper-screen-routes.js` 보드 route(약4633행)다. presets fixture → backtest mode → 대상 설정 → `BACKTEST_CODE_DRAFT` → 첫 하위 탭 클릭 → wait/settle 순서다. 코드 경로의 읽기 전용 지도와 폼 경로의 시각 편집기는 별개다. `backtest-canvas.js`의 `applyCodeAction`, `loadMap`(약1783), `renderFlowTab`(약4581), `snapshotGraph`/`visualActive` 분기를 확인한다. `clearWorkspace` 보완만으로 이 실패가 해결되지는 않았다. 원인을 특정하지 않았으므로 원본 삭제나 단언 완화부터 하지 않는다.

### 카드 2건과 슬롯 지표

- `137X-2`: `state_board_missing_in_dom` 및 `text_multiset_dom_mismatch`. 과거부터 남은 ETF/ELW/신주인수권 state 진입 관계와 새 텍스트 문제를 따로 추적.
- `2R3M-1`: `text_multiset_dom_mismatch`. 예: `150,850원원`, `2.63배배`, `52주 최저 52주 최저 ...`, `현재가 · 현재가 · ... 체결 체결`. raw 값/이미 포맷된 값/정적 접두·접미 hydration 경계를 조사한다. fixture만 억지 수정해 통과시키지 않는다.
- 카드 보고서에는 개별 보드 실패 외 전역 `gate_failures`의 **`registry_stale`**도 있다. 94/96 숫자만 보지 말고 생성 레지스트리의 현재 원본/생성물 신선도를 함께 확인한다.
- 런타임 레지스트리: 가시 occurrence **3532 중3227 도달,305 미도달,격리 제외 보드0**.
- 독립 보드 팩 정적 검사: **97개 팩(검사용 포함),39개 보드에서346문제**. 다른 보드/alt_mappings를 통한 도달을 고려하지 않는 검사이므로305와 같은 수가 아니다.
- `extra_fields`라는 메타데이터가 있어도 실제 loader는 명시적 composite 계약을 읽는다. `proc_brch_nm`, `rsrv_tp` 등을 메타데이터 존재만으로 닫지 않는다.
- `2RJ7-1` 금현물 차트의 renderer 선언/실제 mount 경로는 여전히 별도 미완료다.

### pass-but-gap 15개

```text
43WD-1
FT6-0, 15J-0, 2NW8-2, 2NXS-2, 3ZJD-0, 3ZNO-0
177W-2, 17F8-2, 17IH-2, 17MB-2, 24GS-0, 24GT-0, 2E4E-0, 322V-0
```

이 집합은 “과거 라우트 게이트는 통과했지만 앱에 남은 기능/계약 차이가 있다”는 의미다. 현재 101/109 수치와 합치거나 통과했다는 이유로 폐쇄하지 않는다. `ALL-FINDINGS`의 관련 board 및 원본 `gaps-screens-annotated.json`과 연결한다.

### 미니·XI 및 기타

11 template/10 grammar 성공은 실제 미니 카드 96개 source 일치의 증거가 아니다. 인계된 integrated MINI에는 19/96 일치,77 불일치, 전체 행 관점에서는 **212/432 divergent**가 기록돼 있다. 보드·note·template 등의 분모를 혼용하지 않는다. canonical XI-0의 과거 1/22 실패는 최근 단일 성공만으로 해결되지 않았다. 고립 반복과 full suite 순서, 창 handoff/애니메이션/비동기 ready를 함께 측정한다.

## 10. CODE 원장의 주요 잔여 묶음

아래는 우선 탐색 길잡이다. **전체 항목은 별첨342개가 정본**이며 이 요약에서 빠졌다고 범위 밖이 아니다.

- **live-full 하네스**: CODE021/037는 query/card false-green,023/071 실제 userData 공유,072 `captureOrSkip`가 항상 skip인 stub,022 총시간 예산,033/034/035/036/062 navigation/emptyHistory/indexReady 미검증,044/046 skip 중복,045/069/070 캡처 증거,079 프레임 누락/크기 오류 혼동. 실제 프로필/실모델을 호출하며 현 상태를 그대로 실행하지 않는다.
- **runner**: CODE039/075는 WIP-B. 024/025 수집 완전성(모든 verify/probe의 포함/별도/제외 분류), 기존 테스트/문서 부채는 별도다.
- **질의/렌더 시간 경계**: CODE012 shell 새 기법 제출이 실행 중 UI를 대체하는 경계,063 첫 실패가 다음 항목의 첫 paint 예산을 소진하는 문제. 063의 현재 direct deadline은 **30초**이며 예전3초 사례를 현재 수치로 재인용하지 않는다. fake-clock 예산 대조는 재현했지만 실제30초 네트워크 장애는 유발하지 않았다.
- **차트/데이터**: CODE019 volume 축 단위,028 builder 중복,059/060 재조회 문구와 8초 타이머 이중 소유. 어댑터의 독립 사용을 확인하지 않고 outer guard를 무조건 삭제하지 않는다.
- **UI/문구/레이아웃**: CODE011/017/018/027/040/041/052/054/056/076 및 관련 Paper/OBS. 긴 이름 min-content 위험은 정적 발견이지 최신 Electron overflow 실측이 아니다.
- **검증·주석 부채**: CODE015/016/020/042/049/051/053/055/057/058/061/066/067/068/073/077/078/080 등. 관찰성/중복 테스트/죽은 분기를 실제 제품 결함과 구분한다.
- **식별자**: CODE047은 감사 시 open이었으나 이후 `e9f9c5d0`에서 현재 tracked 노출을 마스킹하고 독립 검증했다. 원본 감사 snapshot을 바꾸지 않고 overlay에 기록했다. Git 과거 이력에는 예전 내용이 남으며 역사 전체 삭제는 하지 않았다. 보고서에 원값을 재복사하지 말 것.

## 11. Paper 원본·보고서·이전 대화의 위치

Paper: `https://app.paper.design/file/01M0VGPX92K1TER4ZV9PWGQJJZ/1-0`.

현재 Codex in-app browser에서 읽기는 가능하지만 Log in/Sign up 및 계정 생성 안내가 보여 **편집 로그인 확인 실패**다. 도구명이 광고된다는 사실은 편집 가능 증거가 아니다. 편집 권한을 확보한 뒤만 원본 변경 결과를 주장한다. Grok 환경은 도구/로그인이 다를 수 있으니 새로 확인한다.

로컬 원본:

```text
backend/ref/paper-ledger/manifest.json
backend/ref/paper-ledger/<page>/<board>.tree.txt
PAPER_APP_PARITY.md
docs/ui/paper-card-surface-charter.md
docs/architecture/
docs/handoff/2026-09-07-codex-resume.md
docs/handoff/2026-09-07-codex-resume/historical-findings.json
docs/handoff/2026-09-07-codex-resume/round2/
docs/handoff/2026-09-07-paper-parity/report/
docs/audits/market-session-20260907/
```

기존 HTML 보고서 생성기 `docs/handoff/2026-09-07-paper-parity/report/build_report.py`는 경로가 깨져 있다. SP가 bundle 상위 디렉터리를 가리키고 `gaps-*-v4.json`을 기대하지만 실제 report 폴더의 파일명과 다르다. 경로만 고치면 **“7장만 남음”, “코드로 고칠 수 없음”, 과거 완료/적용 집계**가 그대로 새 보고서로 재생성된다. 현재 원장을 반영해 문구와 분모부터 수정하고 과거 보고서는 역사본으로 보존한다.

Claude 원문 세션은 이미 전체 검토했다: `C:/Users/USER/.claude/projects/C--Projects-DAOU-Athena/0d4f88d0-d946-436b-bc39-d4e63d8412f6.jsonl`(약32MB/12028기록). 다음 담당자가 전체를 다시 읽을 필요는 없지만 요구/판정 충돌 시 해당 원문을 좁혀 확인할 수 있다. 마지막 성공 Write는 기록11991, 한도 도달은12:42:06 KST로 인계됐다. 외부 복사본에는 원문 대화를 통째로 포함하지 않았다.

새 PR24의 `docs/audits/market-session-20260907/`에는 별도 시장 세션 감사와 미해결 기록이 있다. 본342개 원장과 같은 범위로 가정하지 말고 STATUS/NEXT/DEFECTS 등을 먼저 읽어 중복/독립 항목을 연결한다. 기존 자동화도 이 작업이 새로 만든 것으로 주장하거나 삭제하지 않는다.

별도 감사의 남은 범위는 생략하지 않도록 `related-market-audit/`에 Markdown 원본 전부를 복사했다. 이 문서들에 “현재”라고 적힌 PID·시각·브랜치·카운트는 **13:16 KST 등 해당 작성 시점의 기록**이며 이 인계 시점의 프로세스 상태가 아니다. PID만 보고 프로세스를 종료하거나 오래된 장전/장후 일정을 지금 실행하지 않는다.

- 원천 inventory1396행(제품 고유 기능 수 아님), 조회259/264, 자체API GET41+POST2 등은 당시 loopback/mockapi 검사 범위다. root가 다시 실측한 수가 아니며 root의3792단위테스트와 합산하지 않는다.
- 남은 조회5개 입력 출처/의미, 자체API 최초GET범위밖77개 중 당시 POST2개 외75개, 실제MCP/action, WS 등록·이벤트·정리, 페이지네이션/최신성/의미, 모드별 실제 화면, 장후 구간은 각 대장의 최신 상태를 다시 확인한다. HTTP200/JSON shape만으로 데이터 정확성을 닫지 않는다.
- `OBSERVATION-001`: 재부팅 전후77분55.708초 관찰 간격. 정확한 중단 시간이나 연속 정상을 소급 확정하지 않는다.
- `BOOT-001/002/003`, `AUTH-OBS-001/AUTH-002`: 기동 제한, 정상 backend 지연과 중복 스폰, 인덱스 늦은 회복의 부팅 상태 전파, 계좌/준비 상태 및 direct REST 계좌 선택 문제. 문서의 후보와 확정, 이미 수정된 부분을 현 소스로 재판정해야 한다.
- `QA-EVAL-001`: selector-v5 신규 봉인 코퍼스 부재. 정확히100개 신규 질문/직접 인용 최소10 등 구체 acceptance는 해당 DEFECTS와 실제 테스트를 읽는다. 기존코퍼스를복사하거나skip을제거해초록으로만들지않는다.
- `FIXTURE-001..005`: Windows 알림, 반응형 단언, 계정 연결 fixture, 부팅 timing의 환경/제품 경계를 구분한다. `QA-PERF-001`은 긴 CPU 점유와 정확성 실패를 구분한다.
- `HARNESS-MINI-001`은 이후949eefd5 미니 초기화+실제11/11 증거와 연결해 정정 가능한 역사 항목이다. 별도 감사의 옛CARD/SCREEN 숫자도 현재integrated 보고서와 충돌할 경우 원문을 삭제하지 말고 후속 근거를 연결한다.
- 관련 문서의 source/artifact 파일이 다른 환경에 없으면 해당 실측은 재현 불가/원본미포함으로 표시한다. 이 묶음은 실계정 프로필·live원응답을 새로 가져오거나 외부 시스템에 로그인하지 않았다.

## 12. 실행 환경과 재검증 명령

Windows PowerShell. 이 머신에서 확인된 도구:

```powershell
$env:PATH = 'C:/Users/USER/AppData/Roaming/fnm/node-versions/v22.14.0/installation;' + $env:PATH
$env:PYTHONIOENCODING = 'utf-8'
Set-Location C:/Projects/DAOU.Athena
```

- Node22.14.0: 위 PATH. `gh`는 `C:/Program Files/GitHub CLI/gh.exe`.
- Python: `backend/.venv/Scripts/python.exe`.
- Electron: `app/node_modules/electron/dist/electron.exe`.
- `.gitattributes`가 `* -text`라 CRLF를 보존한다. `git -c core.whitespace=cr-at-eol diff --check`로 실제 공백을 검사하고 대량 개행 변환을 피한다.
- 일반 push는 `scripts/hooks/pre-push`의 6게이트+앱 전체 단위를 실행한다. 실패를 우회하거나 main을 force push하지 않는다.

앱 전체:

```powershell
Set-Location C:/Projects/DAOU.Athena/app
node --test 'lib/*.test.js' 'lib/main/*.test.js' 'lib/graph-mode/*.test.js'
node --test scripts/run-verify-suite.test.js lib/live-full-catalog.test.js
node --test lib/watch-check-card.test.js lib/watch-check-card-render.test.js lib/agent-canvas.test.js lib/watch-nodes.test.js lib/watch-fix-cycle.test.js
```

위 focused 파일 묶음은 재검증 시작점이다. 기록된195/31과 파일 집합이 정확히 같은지 로그의 subtest와 실행 증거를 비교하고 테스트 수를 억지로 맞추지 않는다.

CODE001/002/063의 실제 함수 추출 오프라인 재현 스크립트도 `evidence/verify-code-audit-boundaries.js`로 포함했다. 이 파일은 `__dirname` 기준 `../../..`를 저장소 루트로 계산한다. **다른 checkout에서는 사본을 그 저장소의 `.omc/artifacts/full-review/verify-code-audit-boundaries.js`로 복사한 뒤 `node .omc/artifacts/full-review/verify-code-audit-boundaries.js`로 실행**한다. 인계 `evidence/` 위치에서 직접 실행하면 상대경로가 잘못된다. 현재 소스가 바뀌면 추출 anchor/주입 계약을 검토해야 하며 옛 PASS 로그만 재사용하지 않는다.

게이트6종:

```powershell
Set-Location C:/Projects/DAOU.Athena
node scripts/gates/check-orb.mjs
node scripts/gates/check-glass-ladder.mjs
node scripts/gates/check-window-model.mjs
node scripts/gates/check-harness-freshness.mjs
node scripts/gates/check-paper-routes.mjs
node app/scripts/paper-manifest-check.mjs
```

백엔드 전체(이전22분41초):

```powershell
Set-Location C:/Projects/DAOU.Athena/backend
.venv/Scripts/python.exe -m pytest -q -ra -p no:randomly --durations=15
```

검증 실행기/슬롯:

```powershell
Set-Location C:/Projects/DAOU.Athena/app
node scripts/run-verify-suite.js --suite paper --only verify:paper-manifest
# 전수 Paper는 Electron을 포함하므로 아래 실행 규칙과 프로필 확인을 먼저 따른다.
node scripts/run-verify-suite.js --suite paper
Set-Location C:/Projects/DAOU.Athena
backend/.venv/Scripts/python.exe scripts/validate_board_slots.py
```

Electron은 한 번에 하나의 lane에서 실행한다. `Start-Process -WindowStyle Hidden` 및 stdout/stderr 파일을 사용하고 종료 코드를 확인한다. 일부 하네스는 `.probe-...-profile`을 지우고 새로 만들므로 **정확한 프로필 경로와 junction 여부를 확인한 뒤 실행**한다. 실제 `%APPDATA%/athena-shell`을 지우거나 현재 앱의 프로필을 검증용으로 쓰지 않는다. `verify:live-full`/실설정 변경 하네스를 무심코 전수 실행하지 않는다.

예시(경로 디렉터리를 먼저 준비):

```powershell
Set-Location C:/Projects/DAOU.Athena/app
$env:ATHENA_NO_AUTOSTART = '1'
$probeProcess = Start-Process -FilePath './node_modules/electron/dist/electron.exe' -ArgumentList @('probe-paper-screens.js','--only','2FR9-2') -WindowStyle Hidden -RedirectStandardOutput '../.omc/artifacts/grok-2fr9.stdout.log' -RedirectStandardError '../.omc/artifacts/grok-2fr9.stderr.log' -PassThru
$probeProcess.WaitForExit()
$probeProcess.Refresh()
$probeProcess.ExitCode
```

`--bless`, `--allow-shrink`, 기대 문구 삭제로 실패를 숨기지 않는다. 실제 스펙 폐기가 확인됐을 때만 근거와 별도 리뷰를 남기고 래칫을 수정한다.

## 13. Ralph 상태와 다음 담당자의 종료 판단

세션 상태는 `.omc/state/sessions/01a07a31-b2ff-7a30-9263-4c52f72f7231/`의 `prd.json`, `ralph-state.json`, `progress.txt`에 있다. 이 경로는 로컬 운영 상태이며 이번 묶음에도 사본을 남겼다. 실제 native 지속 실행 hook이 자동으로 돌아간다고 주장한 적은 없고, 발견한 Claude 플러그인 Ralph 지침을 현재 도구로 적용했다.

MERGE만 완료로 표시돼 있으며 나머지는 중간 상태를 담고 있다. backend 검사 실행은 끝났고342개 항목 판정도 끝났지만, 그 사실만으로 전체 acceptance가 완료된 것은 아니다. PRD의 완료값이 최신 증거와 다르면 먼저 근거를 읽고 갱신한다. 과거 `.omc/state/ralplan-state.json`의 Sep3 상태는 이 작업과 무관하므로 재개하지 않는다.

인계 후 Grok Build의 첫 응답은 **기준 커밋,9개 WIP 보존 여부,최우선 검토/재현 계획**을 명시하는 것으로 충분하다. 이미 확인된 병합/원문 전체 읽기를 다시 반복하거나 “모두 검증됨”으로 출발하지 않는다.
