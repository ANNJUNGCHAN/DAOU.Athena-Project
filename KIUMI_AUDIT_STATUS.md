# 키우미 전수 검사 — 진행 상태와 인계

> 이 문서는 2026-09-01 키우미 전수 검사의 **현재 상태**를 남긴다. 끝난 것, 돌아가는 중인 것,
> 남은 것, 그리고 다음 사람이 바로 이어받는 데 필요한 환경 정보를 담는다.
> 설계 결정 자체는 `PAPER_DESIGN_AUDIT.md`의 결정 로그, 화면 대응은 `PAPER_APP_PARITY.md`가 소유한다.

- 브랜치: ~~`claude/kiummi-full-audit-f99978`~~ → **삭제됨. 전부 `main`에 있다** (2026-09-01)
- 커밋: `16a7b0e` — feat(kiumi): 키우미 전수 검사 — Paper 정합과 미니 카드 10종
- PR: [#2](https://github.com/ANNJUNGCHAN/DAOU.Athena/pull/2) — **MERGED** (2026-08-31 23:25Z, `b414e06` 스윕)
- 배치 실행기: `scripts/run-orb-probes.sh` (본문 §2의 `.../scratchpad/run-orb-probes.sh`는 옛 경로)
- Paper 파일: `Athena` → `키우미` 페이지 (7장 → 9장)

---

## 1. 끝난 것

### 1.1 Paper 자기모순 정정 — Paper를 실앱 실측에 맞춤

| 보드 | 무엇이 어긋났나 | 어떻게 고쳤나 |
|---|---|---|
| 01 | 펼침 `360×340` · "실행 버튼도 미니 입력창도 없다" | 보드 04⑤·05 DISPLAY A와 정면 충돌. `orb-window.js` 실측대로 `360×400`(최대 640), 셸 숨김에서 입력줄·실행 버튼이 산다고 캡션 정정 |
| 01·02·03 | `발화` 눈 모양이 막대(01·02) vs 원(03·실앱) | 03·실앱 기준으로 01의 발화 두 칸을 원형으로, 02의 부제를 이동 |
| 01 | "생각 중" 칸이 실제로는 잠듦 렌더(바이저 34% 개방) | 라벨을 잠듦으로 정정 |
| 02 | 즐거움 스파클 ✦, 시무룩 눈썹 — 앱에 없는 기관 | 제거. "눈 모양 하나로만" 원칙 복원 |
| 02 | 우는·시무룩 눈 모양이 앱 치수와 다름 | 앱 값(22.6%/11.5%)으로 통일 |
| 02 | 생각 중이 별도 눈 모양처럼 그려짐 | 앱은 기본 모양 + 시선 스윕이다. 기본 모양으로 되돌리고 부제에 명시 |
| 04 | `column-fold 400폭` | 실앱 `ORB_FOLD_CARD_WIDTH_PX = 360` |
| 06 | 이름은 `입력 스트립 — 모드별 키우미`, 내용은 07과 같은 메뉴 | 이름을 내용에 맞추고, 약속하던 모드별 얼굴은 신규 보드 08로 분리 |
| 06·07 | 메뉴가 Superpowers·Slack 등을 설치 플러그인으로 표시 | 플러그인 페이지 03 허브(DART·Google Sheets)가 목록의 소유자. 두 개로 정정 |
| 07 | 캔버스 카드 3장·대화 2칸이 빈 흰 박스 | 시세·차트·보유주식 카드와 실제 질문/답변으로 채움 |
| 06·07 | 존재하지 않는 모델 필(검정 원) | 삭제 — 앱은 모델 진입이 키우미 메뉴 하나다 |

### 1.2 Paper 누락 — 앱에만 있던 것을 Paper에 추가

감시 궤도 링(활성 감시 수만큼 위성 점, 0건이면 미표시) · 미확인 배지 · 커서 추적 시선(반경
320px, 기본 표정에서만) · 메뉴 `설정` 섹션 · 파일/폴더 첨부 2행 분리(Windows 파일 대화상자는
파일과 폴더를 한 번에 못 고른다).

### 1.3 앱 누락 — Paper 확정 후 구현

**모드별 얼굴 (신규 보드 08).** 앱은 다섯 모드인데 얼굴은 대화·그래프 둘뿐이라
에이전트·플러그인·백테스트가 전부 대화 얼굴로 떨어졌다 — 화면이 "지금 대화 중"이라고
거짓말하는 상태. 에이전트=감시 궤도 점 셋, 플러그인=소켓, 백테스트=되감기 화살표를 신설.
대화 얼굴은 이제 알 수 없는 값에서만 남는 마지막 그물이고, 네 모드는 선택자에서 명시적으로
제외돼 폴백으로 새지 않는다.

**미니 카드 10종 (신규 보드 09).** 캔버스는 `canvas_type` 9종을 카드로 렌더하는데 키우미는
표·차트·주문 티켓 셋만 받고 나머지는 카드 없이 텍스트로 흘려보냈다(`facts` 일반만 114
operation). 상한표와 공통 규칙 5가지를 Paper에서 먼저 확정한 뒤 일곱을 구현했다.

| 미니 카드 | canvas_type | 상한 |
|---|---|---|
| 01 표 | `table` | 헤더 제외 3행 |
| 02 차트 | `chart` | 가격·등락·선 1개·날짜 2개 |
| 03 사실 | `facts` | 값 있는 필드 5행 |
| 04 복합 | `compound` | 스칼라 3개 + 표 2행 |
| 05 미니 주문 티켓 | `facts` (`card_title=주문 티켓`) | 실행 버튼을 가진 유일한 카드 |
| 06 주문 확인 | `action` | 허용 목록 2필드, 버튼 없음 |
| 07 실시간 이벤트 | `event` | 수신 상태 배지 + 2건 |
| 08 인증 상태 | `status` | 세 행 고정, 토큰 비노출 |
| 09 본문 | `reader` | 첫 문단 140자 |
| 10 스트림 | `stream` | 2건, 제목 + 시각·출처 |

공통 규칙 5가지 — 값을 짓지 않는다 · 접었으면 밝힌다(0개 고지 금지) · 실행은 05 하나 ·
축소판이 아니다(캔버스 16종 렌더러 재사용 금지) · innerHTML 0건. 결정 로직은
`app/lib/orb-mini-card.js`(순수 함수)가 갖고 `orb.js`는 DOM만 짓는다.

**죽은 표정 규칙 제거.** 배선된 적 없는 `data-face="drift"`(옛 딴생각). 장 마감은 `drowsy`가
이미 맡아 같은 신호에 얼굴이 둘이었고, 보드 02의 공식 10종에도 없다.

### 1.4 프로브 결함 하나 수정

`probe-orb-mini-chart-card` 9/15 → **15/15**. 앱 버그가 아니라 프로브 결함이었다 — 상주
프로바이더 세션(`app/lib/main/claude-chat-session.js:117` `this._claudeBin`)이 세션 생성 시점의
실행 파일 경로를 붙들고 있어, 턴 사이에 `ATHENA_CLAUDE_BIN`을 갈아끼우던 옛 기법이 무효가 됐다.
진단 결과 둘째 턴에도 첫 턴 카드가 그대로 그려졌다. 일봉·분봉 두 봉투를 **한 턴에** 보내도록
고쳤고, NDJSON은 Node에서 만들어 base64로 넘긴다.

> ⚠️ **같은 기법을 쓰는 다른 프로브도 같은 이유로 조용히 잘못된 것을 검증하고 있을 수 있다.**
> 턴 사이에 `process.env.ATHENA_CLAUDE_BIN`을 바꾸는 프로브가 있으면 전부 의심 대상이다.

### 1.5 확보한 증거

| 검증 | 결과 |
|---|---|
| 유닛 (`node --test lib/*.test.js lib/main/*.test.js lib/graph-mode/*.test.js`) | 1,715개 중 **1,714 통과** |
| `probe-orb-mini-cards.js` (신규) | **22/22** |
| `probe-orb-mini-chart-card.js` | **15/15** |
| `probe-orb-table-fold-card.js` | **6/6** |
| `npm run verify:kiumi` (신규) | **18/18** |
| `lib/kiumi-face.test.js` (신규) | 6건 |
| `lib/orb-mini-card.test.js` (신규) | 14건 |

`verify:kiumi`가 실측하는 것: 5모드 얼굴 배타(모드마다 보이는 얼굴이 정확히 하나이고 그 하나가
그 모드의 것) · 메뉴 380px/8항목/3구역/이모지 0건 · 셸 숨김 게이트 양방향 · 접힘 원 76px ·
궤도 링과 배지의 "0건이면 안 그린다" 규칙.

---

## 2. 돌아가는 중 — 오브 프로브 20개 전수 실행

여기가 **다음 사람이 이어받을 지점**이다.

`app/probe-orb-*.js` 20개를 순차 실행 중이었다. 실행기:
`.../scratchpad/run-orb-probes.sh`(로그는 `/tmp/orb-probes/`, 요약은 `/tmp/orb-probes/SUMMARY.txt`).

### 2.1 중간 결과 (9/20 완료 시점)

| 프로브 | ok | fail |
|---|---:|---:|
| canvas-origin-retry | 7 | 1 |
| chat | 6 | 1 |
| click | 5 | 1 |
| drag-lift | 5 | 1 |
| **drowsy** | **2** | **6** |
| feed-status | 5 | 0 |
| folded-answer | 7 | 0 |
| frown | 4 | 1 |
| glad | 5 | 2 |

### 2.2 실패 내용과 1차 판독

```
canvas-origin-retry  00-셸 숨김: {"visible":true}
chat                 01-boot-초기상태(셸 표시중이라 alert 모드여야 함)
click                03-40px 드래그 → 창 이동: boundsBefore == boundsAfter (창이 안 움직임)
drag-lift            03a-경합 측정 전 idle 확보: {"face":"frown"}
drowsy               02·03·03b·05a·05b·05c 전부: {"face":"fired"}
frown                03-DONE_HOLD 경과 후 frown에서 벗어남: {"face":"frown","alert":"none"}
glad                 02b-glad 눈이 아치 모양: {"width":5.5,"height":13.5469,"radius":"999px"}  ← 기본 눈 모양
glad                 06-펼쳐 읽음 → glad가 풀린다: {"face":"glad","alert":"fired"}
```

**가설(미확정): 대부분 환경 요인이다.** 근거 —

- `face:"frown"`이 안 풀리는 것은 루틴 피드 `disconnected`가 지속된다는 뜻이다. 이 환경에는
  **백엔드가 안 떠 있다** → `feedDown`이 계속 참 → `settleAmbientFace()`가 FROWN을 깔아 둔다.
  `drag-lift 03a`, `frown 03`이 여기 해당한다.
- `face:"fired"`가 안 풀리는 것은 미확인 알림(시작 알림 등)이 남아 있다는 뜻이다.
  `renderPresence()`가 FIRED를 세우고 앰비언트 사다리를 덮는다. `drowsy` 6건과 `glad 06`이 여기.
- 창 이동·셸 숨김이 안 먹는 것(`click 03`, `canvas-origin-retry 00`)은 이 세션의 창 관리 제약이다.
- ~~`probe-orb-mini-cards`는 단독 실행에서 22/22였는데 배치에서 실패했다.~~
  **→ 정정 (2026-09-01): 배치에서도 22/22 통과한다. 실패가 아니라 무한 정지였다.**
  프로브별 상한을 걸고 재측정한 결과가 `exit=TIMEOUT ok=22 fail=0 181s`이고, 로그 끝은
  `OK — 21-보드 09 규칙 5 …` 다음에 `예외: [Error: UnknownVizError]`다. 즉 **검증을 다 끝낸 뒤**
  예외가 나고 `app.exit(1)`(`probe-orb-mini-cards.js:366`)이 프로세스를 죽이지 못한다.
  `UnknownVizError`는 이 저장소에 없는 식별자로 Chromium viz(GPU compositor) 계열이다.
  → **미니 카드 10종 자체는 정상이다.** 남은 것은 프로브의 종료 경로 수정이다.
  이 정지가 배치를 1시간 30분 막았고, 그래서 `scripts/run-orb-probes.sh`에 프로브별
  상한(`ORB_PROBE_TIMEOUT_S`, 기본 180초)을 넣었다.

**~~아직 확정 못 한 것: `glad 02b`.~~ → 원인 규명됨 (2026-09-01).**

측정값 `5.5 × 13.5 / radius 999px`은 아치가 아니라 기본 눈 모양이 맞다. 다만 **앱 결함이
아니라 프로브의 측정 타이밍 결함**이었다.

`orb.css`의 `.orb-eye`는 width/height/border-radius를 **220ms에 걸쳐** 전이한다. 그런데
프로브는 `routine-event`를 보낸 뒤 **200ms**에 잰다. 기계가 바쁘면 그 시점에 전이가 아직
시작조차 안 해서 **배경·테두리는 이미 아치인데 width/height는 직전 얼굴 값**이 그대로
읽힌다. 위 측정값이 정확히 그 중간 상태다. 그래서 "두 번 연속 같으면 안정"으로 판정하면
전이 시작 전 평탄 구간을 안정으로 오인한다.

수정: `eyeShape()`가 목표 모양이 될 때까지 최대 3초 폴링하되, 못 만나면 마지막 실측값을
그대로 돌려준다 — **기다림이 판정을 대신하지 않는다.** 실패는 실패로 보고된다.
`orb.css`의 표정 규칙은 건드리지 않았다(회귀 아님).

> 이 조사 결과는 워크트리 `.claude/worktrees/kiummi-full-audit-f99978`에 **커밋되지 않은
> 채** 남아 있었고, 워크트리 정리 직전에 회수했다. 미커밋 유실 3번째가 될 뻔했다.

### 2.3 다음 단계 — 기준선 대조 (필수)

지금 필요한 것은 추측이 아니라 **같은 프로브를 부모 커밋에서 돌린 결과**다.

```bash
# 별도 워크트리에 부모 커밋을 꺼내 같은 배치를 돌린다(현재 작업트리를 건드리지 않는다)
git worktree add /tmp/kiumi-baseline b1d1b08
cd /tmp/kiumi-baseline/app && npm install
# run-orb-probes.sh의 APP 경로만 이 워크트리로 바꿔 실행
```

그 뒤 `/tmp/orb-probes/SUMMARY.txt`와 기준선 요약을 **프로브별 ok/fail 집합으로 비교**한다.
같으면 사전 결함, 다르면 이번 커밋의 회귀다. 특히 `glad 02b` 한 건은 반드시 판정해야 한다.

배치가 불안정하므로 판정이 갈리는 프로브는 **단독으로 3회 재실행**해 흔들림을 확인할 것.

---

## 3. 남은 것 / 알려진 한계

1. **오브 프로브 20개 판정 미완** — §2. 기준선 대조가 남았다.
2. **`npm run verify`가 검증3c(플러그인)에서 중단** — `app/verify.js`가
   `.plugin-canvas-card[data-plugin-id="dart"]`를 못 찾아 `.click()`이 던지고
   `executeJavaScript`가 거부되면서 전체 실행이 죽는다. `app/lib/plugin-canvas.js:110`에
   no-op 스텁 분기가 있으니 런타임에 어느 분기를 타는지 확인할 것. 사전 결함이고 이 작업에서
   `plugin-canvas.js`는 손대지 않았다(마지막 수정 `775f2c9`). **그 뒤 단계는 현재 미검증**이며
   키우미 몫만 새 `verify:kiumi`가 대신 덮는다. 겸사겸사 단일 null 셀렉터에 전체 스위트를 잃는
   구조도 손볼 만하다.
3. **유닛 1건 실패** — `production 0B FID 10 binding`. Python `fastapi`로 백엔드를 부르는 대조
   테스트이고 착수 전 기준선에서도 같이 실패한다. 키우미와 무관.
4. **Paper 키우미 페이지에 백테스트 보드 4장이 섞여 있다** — 작업 중 다른 세션이 `07·백테스트 —
   전략 배포`, `08·백테스트 — 코드 플로우 지도`, `09·백테스트 — 오류 진단`, `10·백테스트 — 전략
   고르기`를 키우미 페이지에 만들었다. 백테스트 전용 페이지가 따로 있고 번호가 이쪽 보드와
   겹친다. 진행 중인 남의 작업이라 손대지 않고, 이쪽 보드 이름에 `키우미` 접두사를 붙여
   구분만 해뒀다(`08 · 키우미 — 입력 스트립 모드별 얼굴`, `09 · 키우미 — 미니 카드 10종`).
   그쪽 작업이 끝나면 백테스트 페이지로 옮기는 것이 맞다.

---

## 4. 환경 메모 (재현에 필요)

이 환경에서 실제로 막혔던 것들. 다음 사람이 같은 벽에 시간을 쓰지 않도록 남긴다.

- **node/npm이 PATH에 없다.** fnm으로 깔려 있다:
  `export PATH="$HOME/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"`
- **`app/node_modules`가 비어 있었다.** `npm install` 필요. 게다가 **electron 바이너리
  postinstall이 실패한 채 남는다** — 그 상태로 테스트를 돌리면 9개 파일이 각자 지연 다운로드를
  시도하다 서로 충돌해 45초씩 타임아웃한다. 증상이 보이면:
  `rm -rf node_modules/electron && npm install electron --no-save`
- **Electron 프로브는 프로파일 디렉터리를 잠근다.** 이전 실행이 살아 있으면 다음 실행이
  `EPERM ... .probe-*-profile`로 죽는다. 먼저 `taskkill /F /IM electron.exe /T`.
- **`npm run verify`는 `npm_node_execpath`를 요구한다**(`lib/main/verify-profile.js`).
  `electron verify.js`로 직접 부르면 "절대 Node 실행 경로가 없음"으로 죽는다. npm 스크립트로 부를 것.
- **`csc.exe`는 있다** (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). 가짜 claude
  프로브가 이걸 쓴다.
- **`executeJavaScript`에 async 함수 호출을 그대로 넘기면 안 된다.** 반환된 Promise를 await하므로
  백엔드가 없어 거부되면 검증 자체가 죽는다(`verify.js`가 플러그인 단계에서 죽는 것과 같은 형태).
  `verify-kiumi.js`의 `evalIn()`/`waitForShellReady()` 패턴을 참고할 것.
- **SVG 요소의 `className`은 문자열이 아니라 `SVGAnimatedString`이다.** `.replace()`가 없다 —
  `getAttribute('class')`로 읽을 것.
- **저장소는 LF 고정이다**(`.gitattributes` `* -text`). Python `io.open(p,'w')`는 Windows에서
  CRLF로 쓴다 → 파일 전체가 diff로 뜬다. `newline='\n'`을 주거나 바이너리로 쓸 것.
  `app/chat.css`만 원본이 CRLF·LF 혼재라 바이트 보존이 필요했다.

---

## 5. 이번 작업이 만든 파일

| 파일 | 역할 |
|---|---|
| `app/lib/orb-mini-card.js` | 미니 카드 상한·고지 결정 로직 (순수 함수) |
| `app/lib/orb-mini-card.test.js` | 보드 09 상한표·공통 규칙 고정 (14건) |
| `app/lib/kiumi-face.test.js` | 보드 08 얼굴 마크업·CSS 계약 고정 (6건) |
| `app/probe-orb-mini-cards.js` | 신규 미니 카드 7종 실 렌더러 DOM 검증 (22건) |
| `app/verify-kiumi.js` | 살아 있는 셸·오브 창 실측 (18건), `npm run verify:kiumi` |
