# 카드 표면 + 카드미니를 최신 main 위로 통합했다 (2026-09-03)

카드 표면 트랙과 키우미 카드미니 트랙이 오래된 공통 기준점에서 갈라져 있었다. 둘 다 최신
`main` 위로 올려 하나의 통합 브랜치로 만들고, 코드 게이트를 전부 다시 재고, Paper 쪽
카드미니 96장을 전수 감사했다. 이 문서는 그 결과와 **아직 남은 것**을 적는다.

## 1. 무엇을 통합했나

| 항목 | 값 |
|---|---|
| 기준 `origin/main` | `266901e6301b3e1c5b4d4a8ddfcd3b0827b6a12a` (fetch 후 재확인) |
| 통합 브랜치 | `codex/kiumi-main-integration` |
| 카드 표면 | `origin/feat/card-surface-paper-to-code` `9c07c1b` — **15커밋 전체 병합** |
| 카드미니 | `origin/codex/kiumi-mini-cards-runtime` `b45f6ca` — **고유 커밋 2개만** cherry-pick |

당시 만든 커밋 3개 — **지금 브랜치에는 없다.** 태그 `kiumi-integration-premove`
아래에만 남아 있고, 같은 내용은 이미 `origin/main`에 다른 경로로 들어가 있다:

```
a9fe065  style(kiumi): remove internal mini-card dividers      (cherry-pick b45f6ca)
4aba359  feat(kiumi): ship approved 360x420 mini cards          (cherry-pick 8a39bc0)
6c52473  Merge branch 'feat/card-surface-paper-to-code'         (--no-ff, 2 부모)
```

`main`에는 직접 커밋하지 않았고 push하지 않았다. 기존 작업 브랜치도 삭제하지 않았다.

> ⚠ **작업 도중 origin/main이 움직였고, 이 문서는 새 main 위로 옮겨졌다.**
> 통합 작업은 시작 시점의 `origin/main` `266901e` 위에서 했다. 그 사이 다른 쪽에서
> `a408bb6`까지 **31커밋**을 올렸고 거기에 카드 표면(`9c07c1b`)·카드미니(`b45f6ca`)
> **양쪽 병합이 이미 들어 있다**(`git merge-base --is-ancestor` 확인). 그래서 §1의
> 통합 커밋 3개는 **더 이상 필요하지 않고**, 이 문서만 `a408bb6` 위로 cherry-pick해
> 옮겼다. 아래 §2~§3의 충돌 해결 근거와 실측 수치는 **`266901e` 기준 기록**이고,
> §4의 Paper 수정은 git과 무관하게 **현재 유효**하다.
>
> 옮기기 전 상태(통합 커밋 3개가 붙어 있던 tip `9745e15`)는 태그
> **`kiumi-integration-premove`**로 보존했다. rebase로 옮기려 하면 `4aba359`가
> main의 병합 커밋과 add/add 충돌을 내므로, **문서 2커밋만 cherry-pick**하는 것이 맞다.
>
> 라우트 수 핀은 양쪽 다 맞다 — 범위가 다르기 때문이다. 이 브랜치는 `405`
> (`main@266901e` + 카드 표면 + 카드미니, routines 12개), `origin/main`은 `408`
> (거기에 agent-dual-control·plugin-mode-doctrine까지, routines 15개 —
> `source-catalog`·`{id}`·`{id}/update` 3개가 더 있다). 각 워크트리의 `backend/`에서
> 각자 돌려 둘 다 통과함을 실측했다.
>
> **함정**: `backend/.venv`가 특정 워크트리 안에 있으면 다른 워크트리의 테스트를
> 그 venv로 돌릴 때 `athena_api`가 **venv 쪽 워크트리 코드로 해석**된다. 처음에 그걸로
> "main이 빨갛다"는 잘못된 판정을 냈다. 반드시 **검사할 워크트리의 `backend/`를
> cwd로** 두고 돌릴 것.

### 왜 이 순서였나

`origin/main`과 두 브랜치의 공통 기준은 `f880d79`이고, main이 그 뒤로 84커밋, 두 브랜치가
각각 15커밋 나아가 있었다. 두 브랜치끼리는 `ebd19b5`에서 갈라져 각자 3커밋이었다.

카드미니 브랜치를 통째로 병합하지 않고 **카드 표면 전체를 먼저 병합한 뒤 카드미니 고유
커밋 2개만 올린** 이유는 `4e4a800`(카드 표면)과 `58cf1af`(카드미니)가 **같은 패치**이기
때문이다. patch-id가 둘 다 `44511d0bed270e122e3b3f8dca6cc054a9a80875`로 동일하고,
`git cherry`도 `58cf1af`를 `-`(이미 반영됨)로 표시한다. 통째로 병합하면 같은 readability
diagnostics 패치가 두 번 들어간다.

```
$ git cherry -v codex/kiumi-main-integration origin/codex/kiumi-mini-cards-runtime
- 58cf1af  feat(card-surface): add readability diagnostics baseline   ← 이미 있음, 적용 안 함
+ 8a39bc0  feat(kiumi): ship approved 360x420 mini cards
+ b45f6ca  style(kiumi): remove internal mini-card dividers
```

통합 결과가 카드미니 브랜치와 다른 파일은 7개(`13K0-2`·`2SKU-1`의 board.html·regions.json·
slots.json + index.json)뿐이고, 그 7개는 **카드미니 브랜치에 없는 카드 표면 후속 커밋 2개**
(`9c11c05` 적응형 그룹, `9c07c1b` 반응형 파리티)가 건드린 파일과 정확히 일치한다. 즉 작업이
빠진 게 아니라 카드 표면의 더 새 데이터가 이겼다.

## 2. 충돌 1건과 해결 근거

충돌은 `backend/tests/api/test_inventory_api.py` **한 건**이었다.

이 테스트는 OpenAPI의 GET/POST operationId 수를 정확한 값으로 못박고, 늘어난 이유를 주석
원장으로 남긴다. 주석이 직접 경고한다 — "무엇이 왜 늘었는지 적지 않고 숫자만 고치면 이
테스트가 하는 일이 없어진다."

양쪽이 공통 기준 **376**에서 각자 라우트를 더했다:

- main → **404** (projects 계열 13, brain entity detail 1, 시각 설계 6, 기법 저작 2, brain relations 수동 편집 3 …)
- 카드 표면 → **377** (`internal_canvas_board_hydrate` 1개)

기계적으로 한쪽을 고르면 다른 쪽 라우트가 핀에서 사라진다. 그래서 **가산으로** 풀었다:
404 + board-hydrate 1 = **405**. 양쪽 원장 주석을 모두 남기고 재번호 근거를 한 줄 덧붙였다.

**405는 추론이 아니라 실측이다** — `test_inventory_partition_and_static_openapi_coverage`가
통과한다. board-hydrate 라우트는 병합 결과에 실제로 존재한다
(`backend/athena_api/api/canvas_push.py:1063`, `operation_id="internal_canvas_board_hydrate"`).

### 유령 충돌 하나는 충돌이 아니었다

`docs/handoff/README.md`도 처음엔 충돌했는데, `-X ignore-cr-at-eol`을 붙이자 사라졌다.
카드 표면 브랜치가 파일을 통째로 CRLF로 바꿔놨기 때문이다(`.gitattributes`가 `* -text`라
git이 줄바꿈을 정규화하지 않는다). 이 저장소의 인계 문서 §5가 이미 경고하는 함정이다.

병합 후 노이즈 검사도 통과했다 — `git diff --shortstat`과 `--ignore-cr-at-eol`이 같은 숫자다:

```
856 files changed, 843088 insertions(+), 62 deletions(-)   ← 두 명령이 동일 → CR 노이즈 0줄
```

## 3. 실행한 검증과 실측 수치

전부 파이프 없이 종료코드를 직접 받았다(인계 문서 §6 경고: `| tail`은 exit code를 가린다).
게이트는 plain node로 돌렸다(`cmd /c` 경유 금지).

| # | 명령 | 결과 |
|---|---|---|
| 1 | `node --test app/lib/{board-glyph-geometry,board-mount,board-parity,canvas-tabs}.test.js` | **106/106 pass**, exit 0 |
| 2a | `pytest scripts/tests -q` (디렉터리 전체) | **264 passed**, exit 0 |
| 2b | `scripts/paper_board_extract.py --check` | exit 0 — **보드 96줄, `드리프트:` 0줄** |
| 2c | `scripts/build_board_registry.py --check` | exit 0 — `최신 — 보드 97장, 청크 6개` |
| 3 | `cd app && node --test lib/orb-kiumi-runtime.test.js` | **7/7 pass**, exit 0 |
| 4 | `npm run test:unit` (= pre-push 대상 글롭, 169파일) | **2,547/2,547 pass**, exit 0 |
| 5 | `electron probe-orb-kiumi-96.js` | **ALL OK** — 아래 참고 |

추가로 돈 것(원래 지시 목록에는 없었지만 카드미니 계약을 지킨다):

| 명령 | 결과 |
|---|---|
| `scripts/build_kiumi_registry.py --check` | exit 0 — `{"boards": 96, "problems": []}` |
| `pytest backend/tests/unit/test_kiumi_surface_contract.py` | **6 passed**, exit 0 |
| `electron verify-kiumi.js` (`npm run verify:kiumi`) | **ALL OK (19)**, exit 0 |
| pre-push 게이트 4종 `check-{orb,glass-ladder,window-model,harness-freshness}.mjs` | **4/4 exit 0** |

pre-push 훅이 요구하는 것(게이트 4종 + app 단위)을 모두 통과하므로 이 브랜치는 push 가능
상태다. 훅을 끄거나 `--no-verify`를 쓰지 않았다.

### 96장 실제 렌더 프로브

```json
{"ok":true,"rendered":96,
 "grammarCounts":{"chart":2,"compound":50,"facts":21,"order_confirm":5,"order_ticket":1,"table":17},
 "badHeight":[],"overflowing":[],"clippedText":[],"captureErrors":[],
 "orderTicket":[{"boardId":"135M-2","grammar":"order_ticket","width":320,"height":420,
                 "clientHeight":418,"scrollHeight":418,"overflowY":"hidden",
                 "clippedText":[],"hasButton":true}]}
```

합격 기준 전부 충족: `rendered=96`, 네 배열 모두 빈 배열, 전 카드 높이 420px, 주문 카드
실행 버튼 유지(`hasButton: true`).

### 통합 후에도 살아 있는 계약(확인함)

- **카드미니는 별도 호출 경로를 만들지 않는다** — `buildOrbKiumiCard(envelope)`가
  `switch (envelope.canvas_type)` 제너릭 폴백 **앞에서** 평가된다. 같은 카드 봉투를 쓴다.
- **`innerHTML` 0건** — `buildOrbKiumiCard`는 `createElement`/`textContent`만 쓴다.
  `lib/orb-mini-card.js`의 `innerHTML` 2건은 **주석**(금지 사실을 적어둔 것)이다.
- **주문 카드 실행 경로 보존** — `order_ticket`(96장 중 1장)은 기존
  `renderOrbTicket(envelope)`에 위임해 계좌 게이트·상태기계·`athena:order-execute` IPC를
  그대로 쓴다. `order_confirm`(5장)에는 버튼이 없다.
- **360×420은 3중으로 강제된다** — `card_surface_templates.py:1028`이
  `kiumi size must be exactly 360x420`으로 거부, `orb-mini-card.js:7`의 `CARD_SIZE`,
  `:66`의 `buildKiumiPlan` 게이트. 원장 96/96 레코드가 `width_px:360, height_px:420, fixed:true`.
- **가로 구분선 0건 / 세로 구분선 유지** — 코드 쪽 kiumi CSS 구간에 남은 border는
  카드 외곽 `border`(orb.css:866)와 `.orb-kiumi-kpi.is-secondary:last-child`의
  `border-left`(orb.css:978)뿐이다. 후자는 **의도된 세로 구분**이라 지우면 안 된다.
  6개 선택자에 대한 회귀 테스트가 `orb-kiumi-runtime.test.js`에 있다.
- **97 vs 96** — 템플릿 보드는 97장이고 원장은 96장이다. 차이는 `fixture-quote` 한 장이며
  거기에는 `kiumi` 키가 **없는 것이 정상**이다(`board_dirs()`가 영구 skip하는 디렉터리).

## 4. Paper 쪽 — 카드미니 96장 전수 감사

Paper Design MCP는 연결돼 있다(`paper`, http 127.0.0.1:29979). 카드미니는 파일 `Athena`의
**페이지 `H-1`(카드미니)**에 있다 — `mini/*` 96장 + `note/*` 96장 + `template/*` 11장 = 203.
(`C-2`(키우미)는 보드 01~09 설계 정본이고, 그중 `09 · 미니 카드 10종`이 문법 10종 스펙이다.
계획 문서가 "C-2"라고 적어도 96장 인스턴스는 H-1에 있다.)

### 이미 정상이던 것 — 손대지 않았다

- **96장 전부 정확히 360×420.** 크기 위반 0건.
- **note 배치가 정상이다.** 규칙은 `note.x == card.x`, `note.y == card.y + 428`.
  12열·8행 전 범위에서 확인, 어긋난 것 0건·겹침 0건. 행 예산이 정확히 닫힌다:
  420(카드) + 8(간격) + 92(note) + 40(간격) = 560 = 행 피치.
  즉 "note가 한곳에 몰린다 / 카드를 덮는다 / 다음 카드와 겹친다"는 **현재 해당 없음**이다.
- note 6장에서 관측된 말줄임은 프레임이 자른 게 아니라 의도된 1줄 클램프
  (`-webkit-line-clamp: 1`)의 가로 생략이다.

### 고친 것

**카드 내부 장식용 가로 구분선을 제거했다.** 코드는 `b45f6ca`에서 이미 지웠는데 Paper에는
그대로 남아 있었다 — `b45f6ca`가 `app/orb.css`만 건드렸기 때문이다. 같은 계약이 두 쪽에서
갈라져 있던 것이고, Paper를 코드에 맞췄다.

제거 대상은 코드에서 지운 것과 **같은 선택자**다: `Header`의 border-bottom, 각 행
(`Fact N`·`Position N`·`Rank N`·`Row N`)의 border-bottom, `KPI band`의 border-bottom,
`Fold note`의 border-top.

실측 제거 수량 — **가로선 629개 / 프레임 107개**(mini 96 + template 11):

| 종류 | 개수 | 색 토큰 |
|---|---|---|
| 행·헤더·KPI 밴드의 border-bottom | 519 | `--color-k-line-soft` |
| `Fold note`의 border-top | 98 | `--color-k-line-soft` |
| `Table header`의 border-bottom | 12 | **`--color-k-line`** (토큰이 달라 1차 수집에서 빠졌다) |

> ⚠ **가로선은 두 토큰에 나뉘어 있다.** `--color-k-line-soft`만 훑으면 `Table header`
> 12개가 남아 화면에 그대로 보인다. 이번에 실제로 그 함정을 밟았고 스크린샷으로 잡았다.
> 앞으로 이 페이지에서 선을 훑을 때는 **두 토큰을 모두** 조회할 것.

**KPI 밴드 고정 높이도 풀었다(50개).** `height: 80px`인데 내용이
`paddingBlock 12×2 + rows 36+36 + rowGap 8 = 104px`라 24px 넘쳤고, 그 결과 밴드
하단선이 값(`비중 5% 초과`·`7종목` 등) 위를 가로질렀다. `height: auto`로 바꿔 내용에
맞췄다. 카드 총높이 420은 그대로다 — 아래쪽에 여백이 충분했다(스크린샷 확인).

유지한 것:

- 카드 **외곽 테두리**(360×420 프레임 자신의 all-sides border)
- **세로 구분선**(border-left) — 의미가 있는 구분이라 보존
- `Line chart` 3개의 border-top/bottom — 차트 **플롯 영역 기준선/그리드선**이라 장식이
  아니다. 스크린샷으로 확인했고 지우면 차트가 기준을 잃는다. 의도적으로 남겼다.
- padding·gap은 전부 그대로 — 코드가 `b45f6ca`에서 padding을 유지한 채 border만 지운 것과
  동일하게 맞췄다. 간격을 새로 발명하지 않았다.

**검증 방법**: 두 토큰으로 다시 조회해 남은 것이 `Line chart` 3개뿐임을 확인했고,
6종 문법 전부(compound·table·facts·chart·order_ticket·order_confirm)를 2배율
스크린샷으로 눈으로 봤다. 표본 8장(격자 양 끝 포함)의 `width`/`height`를 다시 재
**전부 360×420 유지**, 외곽 border·위치 불변을 확인했다. Paper 편집은 저장소를
건드리지 않았다(`git status`에 이 문서만 뜬다).

### 남긴 것 — 고치지 않았다(값·색)

감사에서 나왔지만 **의도적으로 손대지 않은** 결함이다. 값을 바꾸는 작업이라
"값은 원본을 발명하거나 임의로 고치지 않는다" 계약과 부딪히고, 무엇보다 **정본이
`backend/ref/kiumi/kiumi-ledger.jsonl`**이라 Paper만 고치면 정본과 어긋난다.

| 종류 | 장수 | 실제 관측 |
|---|---|---|
| `broken-value` | 15 | 값이 자기 라벨을 되풀이한다 — 라벨 `금융투자` + 값 `금융투자 -842억원`. 라벨이 리터럴 `값`인 행도 있다(값 `상위 50 합계`). |
| `wrong-color` | 16 | 음수가 하락 파랑이 아니라 중립색이다 — 같은 카드에서 형제 `-1,204억원`·`-638억원`은 파랑인데 `-842억원`만 중립. |
| `clipped-text` | 1 | `47N2-0`의 라벨이 `시간외단일가등락율…`로 잘린다(원문 `시간외단일가등락율순위`). `-webkit-line-clamp:1` + `max-width:48%` 때문. |

고치려면 Paper가 아니라 **원장을 고쳐 다시 반영하는 순서**가 맞다 — 고 적었는데,
원장을 열어보니 **원장에는 고칠 것이 없었다.** 그리고 훨씬 큰 문제가 나왔다. §4.1을 볼 것.

## 4.1 원장을 열어보고 알게 된 것 — 값·색은 원장 결함이 아니다

값·색 32장을 원장에서 고치려고 `kiumi-ledger.jsonl` 96레코드(484 element)를 전수 조사했다.
결론은 **원장 쪽에 기계적으로 고칠 것이 없다**는 것이다.

**색 16장** — 원장의 `format`은 자기 `paper_text`와 전부 일관된다:

| 검사 | 결과 |
|---|---|
| 값 앞에 부호가 있는데 `tone`이 change가 아닌 element | **0개** |
| 부호가 앞은 아니지만 숫자에 붙어 있는데 neutral인 element | **2개** — 둘 다 복합 문자열 |
| `tone: change`인데 부호가 아예 없는 element | 46개 (계획서의 AC-9b 갭) |

- 복합 2개는 `금융투자 -842억원`(라벨+값)과 `3,184.52 · +2.84%`(가격+등락률)다. 복합
  문자열을 한 방향 색으로 칠하면 **다른 절반을 잘못 칠한다** — `neutral`이 맞다.
- 나머지는 부호가 없어(`25%`·`8.4%`·`0.6%`·`11.0%`) 방향을 알 수 없다. 부호를 붙이면
  **방향을 발명**하는 것이다.
- Paper는 부호 있는 값에 `text-up`/`text-down`을 **정상 적용한다**(46QP-0의 기관계 파랑,
  차익거래당일 빨강을 JSX로 확인). 색 체계 자체는 작동한다.

**라벨 중복(금융투자 · 거래대금 · 등락율)** — 원본 보드가 맞다. `2QFO-2`의 `s016`
`paper_text`가 `'금융투자 -842억원'`인데, 원본 1440px 보드에서 이건 **기관 KPI 아래의
소계 줄**이다(같은 구조로 `s022` `'비차익 +1,430억원'`이 프로그램 차익 아래 붙는다).
추출기는 부호가 앞에 없으니 `sign:false, tone:neutral`로 **정확히** 추론했다. 즉
원본→추출→원장 전 구간이 충실하고, 미니가 그 복합 소계 줄을 단독 값으로 골라 `kor` 라벨과
짝지은 것이 표시상 중복으로 보이는 것이다. **런타임에는 안 보인다** — 코드는 실시간
`slot_values`를 쓰고 `paper_text`는 승인 증거일 뿐이다. Paper와 프로브에만 보인다
(`probe-orb-kiumi-96.js`가 `element.paper_text`를 값으로 먹인다).

## 4.2 그 대신 나온 것 — Paper 카드미니가 원장과 어긋난다 (84/96)

96장을 원장과 전수 대조했다(문법별 Body의 label→value를 `get_jsx`로 읽어 비교).

| 결과 | 장수 |
|---|---|
| 원장과 일치 | **10** |
| **어긋남** | **84** |
| 대조 불가(내 board_id 매핑 오류) | 2 — `46S1-0`은 `2QRP-1`, `48EL-0`은 `3JT4-0`이 정답 |

합계 **근거 없는 행 227개**, **누락된 원장 element 190개**.

성격은 "약간 다름"이 아니라 **다른 보드의 값이 섞여 들어온 것**이다. 예: `46KI-0`
(내 계좌 = `133H-2`)은 5행 중 **1행만** 자기 보드 값이다.

| Paper 행 | 실제 소속 |
|---|---|
| 유가잔고평가액 / 89,760,240원 | ✅ `133H-2` |
| 총 평가손익 / +4,240,900원 | ❌ `3UTA-0` |
| 매수비중 / 28.0% | ❌ `3MTJ-0`·`3UTA-0` |
| 총 매입가 / 매입 85,519,340원 | ❌ `3UTA-0`(거기서도 라벨은 총수익률) |
| 종목별계좌평가현황 / 8종목 | ❌ `2SCE-1` 등 |

그리고 `133H-2`의 예탁자산평가액·수익률·총재매수가능금액·인출가능금액은 **전부 빠졌다**.
`4724-0`(취소)은 `변화 / 25%`를 그리는데 `"25%"`는 **원장 96레코드 어디에도 없고**
두 템플릿(order_confirm·order_ticket)에도 없다.

**코드는 영향 없다.** 코드는 원장(→`slots.json`의 `kiumi` 키)을 읽으므로 앱은 올바른 값을
그린다. 오염된 것은 **Paper 디자인 페이지뿐**이고, 프로덕션 결함이 아니다.

증거는 저장소에 고정했다 —
[`backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json`](../../backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json)
에 카드별 근거 없는 행·누락 element 목록이 들어 있고, 계약 문서
[`backend/ref/kiumi/README.md`](../../backend/ref/kiumi/README.md)에도 같은 사실을 적었다.
측정 한계도 파일에 남겼다 — 행 추출을 LLM이 JSX를 읽어 했으므로 **해시가 아니라 강한
신호**다. 개별 카드를 손대기 전에 그 카드만 다시 재보라.

### 4.3 재생성을 하지 않기로 한 결정 (2026-09-04)

**84장 재생성을 지금 하지 않는다.** 판단 근거는 세 가지고, 세 번째가 결정적이다.

1. **프로덕션 영향이 없다.** 코드는 대장을 읽어 올바른 값을 그리고 96장 프로브도
   통과한다. Paper 수정으로 얻는 것은 정확성이 아니라 디자인 검수 충실도다.
2. **되돌릴 수 없고 공유된다.** 84장 × 약 5행 ≈ 420개 텍스트 쓰기를 git이 되돌릴 수
   없는 공유 파일에 하는 일이다. 계획서가 W3를 되돌릴 수 없는 작업으로 표시한 단계다
   (D1 · R-5).
3. **커밋된 생성기가 없다.** Paper 아트보드는 임시 `write_html` 절차로 쓰였고 저장소에
   생성기가 없다. 지금 고치면 **84장을 손으로 조립**하는 것이고, 이 저장소 규칙
   ("생성 파일을 손으로 조립하지 말고 정본과 생성 스크립트를 먼저 해결한 후 재생성한다")을
   정면으로 어긴다. 게다가 끝나고 판정할 게이트가 없어 스스로 채점하는 꼴이 된다 —
   `build_kiumi_registry.py --check`는 `slots.json`만 보고 **Paper는 보지 않는다.**

**고치는 올바른 순서** (다음 세션의 작업 항목):

1. 대장 레코드 → 카드미니 마크업을 렌더하는 **생성기를 커밋한다**. 그래야 재생성이
   재현 가능하고 리뷰 가능하다.
2. Paper 스냅샷 ↔ 대장을 비교하는 **`--check`를 붙인다**. 스냅샷 캡처만 Paper MCP가
   필요하고 비교는 결정론적 스크립트로 할 수 있다(계획서의 `$EV/paper-snapshot.json`
   방식). 그러면 어긋남이 사고로 발견되는 대신 게이트에 걸린다.
3. 그 다음에 재생성하고, 2번 게이트로 판정한다. 시범 1장 → 확인 → 배치 순서를 권한다.

먼저 확정할 것: **대장이 정본인가.** `README.md`는 대장을 "사용자가 승인한 96개의 저장소
정본"으로 정의하고 대장 쪽은 자체 일관성이 있다(부호/tone 불일치 0건, 보드별 슬롯 선택도
해당 보드 필드로 일관). 반대로 Paper는 보드 간 값이 섞였다. 그래서 대장이 옳을 가능성이
높지만 **생성 경로를 못 찾았으므로 단정하지 않는다.** 1번을 시작하기 전에 이걸 사람이
한 번 확정해야 한다 — 틀린 방향으로 재생성하면 승인된 디자인을 덮어쓴다.

## 5. 남은 blocker

1. **값·색 결함 32장**(위 표) — 원장 기준으로 고칠지, Paper만 고칠지 결정이 필요하다.
2. ~~KPI 밴드 overflow~~ — **닫혔다.** Paper 50개를 `height: auto`로 고쳤고, 코드는
   애초에 문제가 없었다 — `.orb-kiumi-kpi`가 `min-height: 66px`,
   `.orb-kiumi-kpi.is-primary`가 `min-height: 72px`로 **최소값**만 두고 내용에 따라
   자란다(`.orb-kiumi-kpis`에는 height 규칙이 아예 없다). 그래서 코드 프로브가
   `overflowing: []`로 통과했던 것이고, 고정 높이는 **Paper에만 있던 결함**이었다.
   이번 수정으로 Paper가 코드의 내용 주도 동작에 맞춰졌다. 코드 변경은 필요 없다.
3. **Paper 카드 폭 360 vs 코드 실측 320** — 계약 위반이 아니다. 360은 선언 치수(=Paper
   아트보드=오브 창 폭)이고 코드는 `.orb-kiumi-card { width: 100% }`라 `.orb-panel`의
   좌우 여백(`14px 16px`)이 빠져 320이 된다. 높이만 픽셀로 고정된다. 다만
   `probe-orb-kiumi-96.js`는 **높이만 단언하고 폭은 단언하지 않아** 폭 회귀가 게이트에
   걸리지 않는다. 폭을 계약으로 만들려면 프로브에 폭 단언을 먼저 추가할 것.
4. **`validate_board_slots.py`가 exit 1** — `합계 결손 59 (b15 e44) · 문제 보드 27`.
   이건 게이트가 아니라 저작 완성도 리포트이고(문제가 하나라도 있으면 1), 이번 통합
   이전부터 빨간 상태였다. pre-push 훅에도 포함되지 않는다.
5. **Paper는 git이 못 지킨다** — Paper 파일은 워크트리·세션과 무관하게 공유된다. 이번
   변경은 브랜치로 되돌릴 수 없다. 동시에 다른 세션이 같은 페이지를 만지면 충돌한다.

## 6. 이어받는 사람이 알아야 할 것

- 이 저장소에서 **병합할 때는 반드시 `-X ignore-cr-at-eol`**을 붙인다. 안 붙이면 유령
  충돌이 늘고 커밋에 가짜 변경이 박힌다. 병합 후 `git diff --shortstat`과
  `--ignore-cr-at-eol`이 같은 숫자인지 확인한다.
- **`| tail`로 판정하지 않는다.** exit code가 가려진다.
- 게이트는 **plain node**로 돌린다. `cmd /c` 경유 시 rtk 훅이 명령을 훼손한 실측이 있다.
- 의존성 설치 절차의 정본은 `docs/handoff/README.md` §2다. 루트 README도, `backend/README.md`도
  없다. `npm install` 뒤 **`node node_modules/electron/install.js`는 형식적 단계가 아니다** —
  npm이 electron 바이너리를 조용히 빠뜨리면서 exit 0으로 끝난다.
- `docs/handoff/kiumi/plan.md`의 **`360×640`은 폐기된 값**이다. 문서 머리글(§3-7)이
  360×420으로 확정됐다고 밝히고 rev 6은 역사적 근거로만 보존된다고 적는다. plan.md의 줄
  번호 인용도 현재 코드와 어긋나므로 그것으로 코드를 찾지 말 것.
- Paper 스크린샷이 빈 출력이면 렌더러 오류가 아니라 **페이지가 활성이 아닌 것**이다.
  `open_file({ fileId, pageId })`로 전환하면 된다.
