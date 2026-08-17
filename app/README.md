# Athena W2 — 두 창 Electron 셸

`plan/mcp-실행계획.md` W2 / `ui/round-1R/two-windows.md` E3 확정안의 첫 코드 구현.
캔버스 창(1560×800, 위) + 대화 창(1560×204~788, 아래) — OS 레벨로 분리된 두 개의
독립 창. `spike/electron-glass/v2.js`·`v3.js`·`canvas.html`을 읽고 이식했다(처음부터
새로 안 짬). React·번들러 없음, 순수 HTML/CSS/JS + Electron.

## 실행법

```bash
cd app
npm install          # electron 43.4.0
npm start             # 앱 직접 실행 (electron .)
npm run verify         # 검증 스크립트 — 창 생성, 스크린샷, 프레임 실측, 접근성 캡처까지 자동 수행 후 종료
```

`npm start`로 뜨면: 대화 창 하나만 뜬다(게이지 부팅) → 아무 텍스트나 입력하고
Enter(빈 입력이면 기본 목업 질의 사용) → 점이 캔버스 창으로 확장되며 모자이크가
채워진다 → `Esc`로 캔버스 접기. 대화 창 위쪽 그립을 잡고 위로 끌면 이력이 펼쳐진다.

## 디렉토리

```
app/
  main.js          — 메인 프로세스: 레이아웃 계산, 두 창 생성, 점→캔버스 확장/수축,
                      대화 창 자동/수동 리사이즈, athena__render_canvas 핸들러
  chat.html/css/js  — 대화 창: 부팅 게이지, 3상태 표시, 이력, 그립 리사이즈
  canvas.html/css/js — 캔버스 창: 모자이크, 확장/수축 rAF 애니메이션, 캔버스 3종 렌더
  lib/
    sanitize.js     — adapter.py sanitize (strip_tags → unescape_entities) JS 포팅
    markdown.js      — 최소 마크다운→DOM 렌더러 (innerHTML 미사용)
    mockdata.js      — spike/captures/*.json 목업 데이터 로더
  data/
    reader-mock.md   — DART 마크다운 원문 발췌(아래 "미구현·제약" 참조)
  styles/
    tokens.css       — palette.md 계승 색 토큰 + 다키체 @font-face
    access.css        — 접근성 3종 CSS
  verify.js          — 검증 스크립트 (아래 "검증" 참조)
  captures/           — 스크린샷 + 실측 리포트 (이번 실행 산출물)
```

## 캔버스 3종 — 목업 데이터

W2 지시대로 실제 캡처 파일을 그대로 읽어 렌더한다(`spike/captures/`, 수정하지 않음).

| 캔버스 | 소스 캡처 | 처리 |
|---|---|---|
| ① 스트림 | `S2B-naver-news-date.json` | `lib/sanitize.js`로 `<b>` 태그 스트립 + 엔티티 언이스케이프 후 **텍스트 노드로만** 렌더 (`textContent`, `innerHTML` 미사용 — `spike/stream-adapter/RESULT.md` 렌더링 계약) |
| ② 리더 | DART 마크다운(아래 참조) | `lib/markdown.js`가 직접 DOM 노드를 만들어 붙인다(마크다운 문자열을 innerHTML로 파싱시키지 않음) |
| ④ 공통 테이블 | `S2B-jjlabsio-financial-statement.json` | `재무상태표` 52개 계정을 당기/전기/전전기 3개년 비교 테이블로 |

### 리더 캔버스 데이터의 제약 — 정직하게 기록

지시받은 파일 `DARTSURVEY-chrisryugj-download_document-SAME-AS-jjlabsio-SMALL-markdown.json`은
**완전한 원문을 담고 있지 않다.** 캡처 당시 `content0_text_head`라는 미리보기 필드(첫
2000자, JSON 이스케이프 포함)만 저장됐고 `content_len:2447`이 가리키는 전체 문자열은
남아있지 않다. 이 필드에서 실제 마크다운만 잘라내(JSON 파싱 가능한 지점까지 역으로
잘라가며 복원) `app/data/reader-mock.md`(1,759자)로 저장해뒀다 — DART "자기주식 처분
결정" 공시 원문 중간에서 끊긴다. 리더 캔버스 헤더에 이 사실을 그대로 노출한다
("원문 일부… 캡처 당시 미리보기 필드 한도로 절단됨"). 감추지 않았다.

## 실배선 — `claude -p` ↔ 캔버스 (결정 D1, 2026-08-17)

`plan/plan.md` §5 액션 4 완료. 이 절 전까지의 "캔버스 3종 — 목업 데이터"는 여전히
존재하지만 이제 **명시적으로 선택했을 때만** 쓰이는 픽스처 어댑터다. 기본 경로는
실배선이다:

```
Electron ──spawn──> claude -p ──stdio──> athena-mcp serve ──> upstream N개
   ^                    │
   └── stream-json ─────┘   tool_result에서 캔버스 페이로드를 뽑아 IPC로 렌더
```

### 파서 — `lib/main/stream-json-parser.js`

순수 함수 위주. 유일한 상태는 `StreamJsonSession` 클래스(청크 경계 carry, tool_use
인덱스, 카운터)뿐이고 전체 이벤트 로그는 쌓지 않는다 — 왕복 하나가 43초+ 걸릴 수
있어서다(`spike/cli-pipe/gateway/RESULT.md`). 공개 함수: `splitLines`/`flushCarry`
(청크 경계 라인 분할), `parseLine`/`parseAllLines`(비JSON은 던지지 않고 건너뛰고
센다), `buildToolUseIndex`(tool_use_id → 툴 이름, `athena__`가 두 번 나오는 실측
이름을 접미사로 매칭), `extractToolResultBlocks`(content 문자열/블록배열 정규화),
`extractCanvasEnvelope`(content 문자열을 한 번 더 JSON.parse), `classifyCanvasBlock`
(성공/폴백/거부/에러/해석불가 분류 — **canvas_type은 응답값으로 읽는다, 요청값이
아니다**), `collectCanvasResults`(배치), `StreamJsonSession`(스트리밍).

테스트: `lib/main/stream-json-parser.test.js` — 지어낸 픽스처가 아니라
`spike/captures/S4-gateway-cli-roundtrip.ndjson`(실왕복 42 이벤트, 불변 증거) 하나로
전부 검증한다. `npm test`(`node --test lib/main/*.test.js`)로 돈다 — electron이
필요 없다. 2026-08-17 실행: **29 passed, 0 failed** (`stream-json-parser` 24건 +
`claude-runner`의 `buildArgs` 계약 3건 + `mcp-config` 2건).

### 실배선 경로와 픽스처 경로가 갈리는 지점

`main.js`의 `ipcMain.handle('athena__render_canvas', ...)` 하나가 `payload.source`로
분기한다 — 채널 이름은 그대로 두고 안을 실제 경로로 교체하라는 지시를 그렇게
지켰다:

| `payload.source` | 무엇을 하는가 | 언제 타는가 |
|---|---|---|
| `'fixture'` | 기존 목업 그대로 — `spike/captures/*.json`을 `lib/mockdata.js`가 읽는다 | **명시적으로 선택했을 때만.** `chat.js`가 `athena:init`으로 받은 `canvasSource`가 `'fixture'`일 때(`runQueryFixture`) |
| 그 외(기본) | `lib/main/claude-runner.js`가 `claude -p`를 스폰, `lib/main/mcp-config.js`가 매 실행 `userData/mcp-config/.mcp.json`을 다시 쓴다(클론 위치가 달라도 절대경로가 항상 맞다) | 기본 경로. `chat.js`의 `runQueryLive` |

`canvasSource`는 `main.js`가 `ATHENA_CANVAS_SOURCE` 환경변수로 정해 `athena:init`에
실어 보낸다(`GLOSSARY.md` §11). **`npm start`는 항상 live**다 — `verify.js`만
`ATHENA_CANVAS_SOURCE=fixture`를 명시적으로 세팅해 quota 없이 검증 5(E2E Enter)의
3상태·자동성장 단언을 그대로 재현한다. 두 경로가 갈리는 이유는
`plan/kiwoom-common-screen-handoff.md` §6이 요구한 "HTTP/WebSocket adapter와 명시적
fixture adapter 분리" 그대로다.

### `claude -p` 커맨드 계약 — `lib/main/claude-runner.js`

`spike/cli-pipe/gateway/RESULT.md` §1 실왕복 커맨드와 인자 순서까지 동일하게
고정했다(`buildArgs`, `claude-runner.test.js`로 잠갔다):

```
claude -p "<질의>" --output-format stream-json --verbose
  --mcp-config .mcp.json --strict-mcp-config
  --setting-sources ""
  --allowedTools "mcp__athena__athena__render_canvas"
```

`stdio: ['ignore', 'pipe', 'pipe']`로 stdin을 명시적으로 닫는다(안 닫으면 "no stdin
data received in 3s" 경고로 3초를 버린다 — RESULT.md §1).

#### ★ `shell: true`를 쓰면 실배선이 통째로 깨진다 (2026-08-17 실측)

이 파일의 첫 판은 *"Windows에서 `claude`는 npm 전역 설치 시 `.cmd`/`.ps1` 셸 래퍼로
깔리는 경우가 실측 다수"* 라는 **추측**으로 `shell: process.platform === 'win32'`를
걸었다. 실호출로 검증하니 **즉시 죽었다**:

```
exit 1 · 캔버스 0건 · 319ms
stderr: Error processing --setting-sources: Invalid setting source: --allowedTools.
        Valid options are: user, project, local
```

원인: Windows에서 `shell:true`는 args를 커맨드라인 **문자열로 합치는데 빈 문자열
인자가 그 과정에서 사라진다.** 그래서 `--setting-sources`가 자기 값이 아니라
**다음 인자(`--allowedTools`)를 값으로 먹었다.**

대조 실측(쿼터 없이 `process.argv` 에코로 확인):

| | 결과 |
|---|---|
| `shell:false` | `[..., "--setting-sources", "", "--allowedTools", "TOOL"]` — **빈 문자열이 살아남는다** |
| `shell:true` | 깨진다 (공백 있는 실행 파일 경로도 함께 깨졌다) |

bash에서 손으로 돌렸을 때 통과했던 이유도 같다 — bash는 `""`를 진짜 빈 argv
원소로 넘긴다.

그리고 **추측 자체가 틀렸다.** `where claude` →
`C:\Users\ajc22\.local\bin\claude.exe` — 진짜 `.exe`다. `.exe`는 `CreateProcess`가
PATH에서 찾으므로 셸이 필요 없다. 지금은 `shell: false` 고정이고,
`ENOENT`가 나면 `ATHENA_CLAUDE_BIN`으로 절대경로를 지정하라는 안내를 낸다.

증거: [`spike/cli-pipe/gateway/PROBE-LIVE-SPAWN.json`](../spike/cli-pipe/gateway/PROBE-LIVE-SPAWN.json),
재현 스크립트 [`probe_live_spawn.js`](../spike/cli-pipe/gateway/probe_live_spawn.js).

> **교훈**: 파서 단위 테스트 29건은 이 버그 **전에도 후에도 전부 통과했다.**
> 캡처 픽스처로는 spawn 인자 전달을 못 잡는다. `verify.js`도 못 잡는다 —
> 픽스처 경로만 타기 때문이다. CLAUDE.md §3의 "추측을 코드에 넣지 마라"가
> 정확히 이 사례다.

### 자유 카드 — 최소 구현 (`canvas.js` `renderFreeCanvas`/`renderJsonTree`)

S4 실왕복에서 **3회 중 2회가 `free`로 폴백했다** — 폴백은 예외가 아니라 흔한
경로라서 렌더러가 없으면 실배선의 절반이 화면에 아무것도 못 띄운다. `GLOSSARY.md`
§2의 "자유 카드"(W4, 미착수)를 정식으로 설계하진 않았고, 스키마를 가정하지 않고
`envelope.data`를 재귀적 key/value 트리(`<dl>`/`<ul>`)로 펼치는 최소 구현만 넣었다.
`innerHTML` 미사용(`createElement`+`textContent`만). 성공한 `table` 카드는
`renderMcpTable`이 별도로 그린다 — 실측된 실제 형상(`columns:[{key,label}]`,
`rows:[{key:value}]`)을 그대로 쓴다. 기존 목업 `table` 카드(DART 재무제표 고정
스키마)와는 다른 카드 슬롯(`mcp-table`)이다 — 스키마가 완전히 다르다.

거부(`--allowedTools` 밖)·에러·해석불가는 카드 대신 `notice` 슬롯에
`ui-kit.errorNote`로 안내만 띄운다(조용히 삼키지 않는다). `free`가 아니라 별도
슬롯을 쓴 이유: 같은 세션에서 정상 `free` 카드가 이미 떠 있는데 다음 호출이
실패하면, "재요청 시 같은 타입 카드를 갈아치운다"는 `makeCard` 규칙 때문에 실제
데이터가 에러 배너로 덮이는 걸 막기 위해서다.

### 3상태 표시 — 정직한 진행

목업 시절엔 TR 이름을 미리 알았지만(고정 매핑), 실배선에서는 어떤 MCP 툴이 몇 번
불릴지 claude가 정하므로 사전에 알 수 없다. `chat.js`의 `runQueryLive`는 1초마다
경과 시간을 갱신하고(`setInterval`), 카드가 하나 뜰 때마다(`athena:live-canvas-added`
IPC) "카드 N개 렌더됨"으로 갱신한다 — 43초짜리 왕복 동안 조용히 멈춘 것처럼 보이지
않게 하려는 것이다(S4 실측: `duration_ms: 43865`). 완료 후 답변 텍스트는 더 이상
정형화된 "캔버스 창에 ~ 띄웠습니다" 문장이 아니라 `claude -p`의 마지막 assistant
텍스트(`result` 이벤트의 `result` 필드) 그대로다.

### 미구현 · 단순화 · 검증 못 한 것 (정직하게 기록)

- ~~**`claude -p`를 이 작업에서 실제로 한 번도 부르지 않았다.**~~ → **닫혔다.**
  `spike/cli-pipe/gateway/probe_live_spawn.js`로 `runClaudeQuery`를 실제로 불러
  **종단간 왕복을 검증했다.** 그 검증이 위의 `shell:true` 버그를 잡았다.
  고친 뒤 실측: `ok:true · exit:0 · 캔버스 1건(canvas_type:"table", fell_back:false) · 9,326ms`
  (`PROBE-LIVE-SPAWN.json`). spawn · PATH 해석 · stdin 닫기 · `--mcp-config` 상대경로 ·
  `StreamJsonSession.feed()`의 실시간 청크 처리가 전부 실제로 통했다.
  - **단, `npm run verify`는 이 경로를 타지 않는다.** 자동 검증은
    `ATHENA_CANVAS_SOURCE=fixture`로 고정돼 있다(쿼터·43초·비결정성). 실배선 QA는
    `node spike/cli-pipe/gateway/probe_live_spawn.js`를 **수동으로** 돌려야 한다.
    이건 의도된 분리이지 누락이 아니다 — 다만 **CI가 실배선 회귀를 못 잡는다**는
    뜻이므로 여기 적어둔다.
- ~~**Esc로 중단해도 스폰된 `claude` 프로세스는 안 죽는다.**~~ → **해소됐다
  (2026-08-17).** Esc가 `athena:abort-live-query` IPC를 쏘고, main이
  `claude-runner`의 `killTree()`로 프로세스 **트리 전체**를 끊는다(Windows
  `taskkill /T /F` — claude만 죽이면 `athena-mcp serve`와 upstream이 고아로
  남을 수 있어서다). 실측 검증: 실왕복 중 3초에 kill → 종료 확인, 잔존
  python/claude 프로세스 0건.
  - ~~**다중 세션도 없다.**~~ → **해소됐다(같은 커밋).** 새 실배선 질의가
    이전 프로세스를 먼저 트리째 끊는다 — 활성 프로세스는 항상 정확히 하나다
    (`main.js` `activeLiveQuery` 선점 규칙).
- ~~**응답 크기/시간 상한이 없다.**~~ → **시간 상한은 생겼다(같은 커밋).**
  왕복 기본 타임아웃 180초(`DEFAULT_TIMEOUT_MS` — 실측 최대 43초 + DART 다중
  호출 ~60초의 3배 여유). 넘기면 트리를 죽이고 `timedOut:true`로 실패를
  정직하게 보고한다. **응답 크기 상한은 여전히 없다** — `athena_mcp`의
  post-parse 상한이 1차 방어이고, 앱 쪽 스트림 버퍼 상한은 미구현이다.
- **`.mcp.json`은 매 라이브 질의마다 다시 쓰지 않는다** — `liveMcpConfig`를
  프로세스 생애주기 동안 캐시한다. 백엔드 venv 경로가 앱 실행 중 바뀌는 시나리오는
  없다고 가정했다(재시작하면 다시 생성된다).
- **카드 12종 중 실제로 실배선이 그리는 건 2종뿐이다**(`mcp-table`, `free`/
  `notice`). 나머지(스트림·리더·타임라인 등)는 여전히 픽스처 전용이거나
  미구현이다 — 실배선이 만드는 건 `render_canvas`의 봉투(`table`/`free`)뿐이고,
  다른 카드 종류로 가는 경로(스트림/리더 등)는 이번 작업 범위 밖이다.
- **자유 카드는 W4 정식 설계가 아니라 최소 구현이다** — 위 "자유 카드" 절 참조.
  대용량/깊게 중첩된 `data`가 오면 트리가 카드 높이(`max-height:360px`, 스크롤)를
  넘어 답답하게 보일 수 있다. 접기/펼치기 같은 UX는 넣지 않았다.

## 구현 중 발견·수정한 버그 4건 (정직하게 기록)

포팅하면서 실제로 실행해보니 네 가지가 있었다. "될 것이다"로 안 넘기고 재현→원인
격리→수정→재검증했다.

0. **(W2 검증 중 재발견, 가장 심각) `npm start`가 창을 하나도 안 띄우고 조용히 멈췄다.**
   `main.js` 끝의 `if (require.main === module) { app.whenReady().then(createWindows); }`
   가드가 `electron .`(=`npm start`)로 실행할 때 항상 `false`였다 — Electron이 앱
   진입 스크립트를 로드하는 내부 부트스트랩 방식이 `require.main`을 이 모듈로
   설정해주지 않는다(실측으로 확인, `main-debug.log`에 `module loaded` 한 줄만
   남고 `createWindows start`가 영영 안 찍힘). 그 결과 Electron 프로세스는 3개
   떴지만(`tasklist`로 확인) OS 창은 전혀 생성되지 않았다 — `Get-Process`의
   `MainWindowTitle`이 전부 빈 문자열. `npm run verify`는 `main.js`를 `require`해서
   `createWindows()`를 직접 호출하므로 이 경로를 타지 않아 지금까지 발견되지
   않았었다. `require.main` 체크를 명시적 환경변수(`ATHENA_NO_AUTOSTART`)로
   교체해 고쳤다 — `verify.js`가 `main.js`를 `require`하기 *전에* 이 변수를 설정해
   자동 기동만 끄고, `npm start`(변수 미설정)는 정상적으로 `createWindows()`를
   부른다. 수정 후 `npm start`로 실제 창 제목("Athena — 대화")이 뜨는 것을
   `Get-Process`로 재확인했고, `npm run verify`도 재실행해 전 구간 통과를
   재확인했다.

1. **`window-all-closed`에서 `app.quit()`을 부르면 워밍업 창이 앱 전체를 죽인다.**
   spike v2.js/v3.js의 원래 패턴은 **빈 핸들러**였는데(`app.on('window-all-closed', () => {})`),
   "리스너가 없으면 조용히 quit된다"는 RESULT.md의 경고를 잘못 이해해 안에 `app.quit()`을
   넣었다. 그 결과 워밍업 창(첫 번째 창)이 닫히는 순간 — 그 시점엔 그게 "모든 창"이므로 —
   실제 캔버스/대화 창이 생성되기도 전에 앱이 죽었다. `createWindows()`가 조용히 멈춘
   것처럼 보여서(에러 없음, 로그도 없음) 처음엔 "hang"으로 오인했다. 디버그 로그를
   단계별로 심어 정확한 지점을 찾아 고쳤다 — 지금은 spike와 동일하게 빈 핸들러.
2. **`collapseCanvasWindow()`가 결과를 return하지 않았다.** 애니메이션 완료 데이터를
   버려서 호출부에서 `Cannot read properties of undefined`로 죽었다. `return result;` 추가.
3. **유리 sheen의 `backdrop-filter` 블러가 정지 상태에도 남아 콘텐츠를 영구히 흐렸다.**
   spike `canvas.html`의 확장 애니메이션은 굴절을 30px→**6px**로 끝맺는데, 이 6px가
   애니메이션이 끝난 뒤에도 인라인 스타일로 남아 그 위의 실제 데이터(뉴스 제목, 재무제표
   숫자)가 **영구적으로 블러 처리**됐다. 첫 캡처(`03-mosaic-expanded.png`, 수정 전)에서
   실측으로 발견 — soul.md §8 "정보 정직성: 숫자가 읽히는가?"를 정면으로 위반한다.
   끝값을 0px로 정정하고(`30*(1-et)` / `30*et`), 애니메이션 종료 시 인라인 스타일을
   명시적으로 `blur(0px)`로 정리했다. 대화 창의 sheen도 같은 문제가 있어서(자기 창의
   전경 텍스트를 블러) 아예 블러를 걷어냈다 — 이유는 `chat.css` 주석 참조.
   또한 **`[hidden]` 속성이 `.app`/`.lock-hint` 등의 `display:flex` 규칙에 밀리는
   CSS 캐스케이드 버그**도 같은 검증 과정에서 발견해 `tokens.css`에 `[hidden]{display:none!important}`로 전역 수정했다(부팅 중 `#app`이 실제로는 숨겨지지 않고 있었다).

## 검증 — 실행 결과 원문

`npm run verify` (=`electron verify.js`) 마지막 통과 실행의 stdout 그대로
(**2026-08-17 실행**):

```
[layout] 화면(1920x1152)이 설계 치수를 그대로 수용 — 축소 없음
[verify] 검증1 완료 — 부팅 시 캔버스 창 표시 여부: false | 대화 창 부팅: true | 모드: app | 모드 배타성: true
[verify] 확장 프레임 stats: {"frameCount":30,"p50":16.699999999999818,"p95":33.399999999999864,"max":33.399999999999864,"min":16.40000000000009}
[verify] 수축 프레임 stats: {"frameCount":35,"p50":16.699999999999818,"p95":16.800000000000182,"max":33.399999999999636,"min":8.300000000000182}
[verify] 독립성 체크: true true
[verify] 접근성 3종 캡처 완료
[verify] 검증5(E2E Enter 트리거): {"reachedDoneState":true,"boundsBeforeQuery":{"x":180,"y":874,"width":1561,"height":205},"boundsAfterQuery":{"x":180,"y":827,"width":1561,"height":252},"grewTallerThanBase":true,"grownByPx":47,"finalAnswerText":"캔버스 창에 스트림, 리더, 공통 테이블을 띄웠습니다.","cardChipCount":3}
[verify] 검증6(수동 리사이즈): {"beforeDrag":{"x":180,"y":827,"width":1561,"height":252},"afterDrag":{"x":180,"y":666,"width":1561,"height":413},"grewByDrag":true,"bottomEdgePinned":true}
[verify] 검증7(설정 모드): {"noNewWindowOnOpen":true,"stillTwoWindows":true,"noNewWindowOnSecondClick":true,"renderedInChatWindow":true,"chatModeSteppedAside":true,"accountsCardPresent":true,"mcpCardPresent":true,"singleCardAfterSecondClick":true,"noSettingsCardsOnCanvas":true,"chatGrewToMax":true,"dotIsRealButton":true,"noTrIdLeak":true,"noBearerLeak":true,"escReturnsToChat":true,"gridEmptiedOnClose":true}
[verify] 검증8(커맨드바 진입): {"noNewWindowOnCommand":true,"reachedSettings":true,"inputCleared":true,"notTreatedAsQuery":true,"turnCountBefore":1,"turnCountAfter":1}
[verify] 리포트 저장: C:\Projects\DAOU.Athena\app\captures\VERIFY-REPORT.json
```

(`package.json`의 `verify` 스크립트가 처음에 `node verify.js`로 잘못 적혀 있었다 —
`verify.js`는 `electron` 모듈 API를 쓰므로 일반 Node로 실행하면 동작하지 않는다.
구현 중 발견해 `electron verify.js`로 고쳤다. 프레임 수치는 실행마다 흔들린다 —
공유 데스크톱이라 다른 프로세스 부하를 탄다. 아래 검증2 서술 참조.)

원본 수치 전체: `app/captures/VERIFY-REPORT.json`. 실행 환경: Windows 11 26200,
화면 1920×1152 — 설계 치수(1560×1004)가 그대로 들어가 축소 없음.

### 검증 1 — 부팅 시 대화 창만 뜬다

`canvasVisibleAtBoot:false`, `chatVisibleAtBoot:true`. 스크린샷:
`captures/01-boot-gauge.png`(게이지 차오르는 중), `captures/02-chat-only-idle.png`
(부팅 완료, 캔버스 창은 화면에 없음).

부팅 완료 판정은 `bootMode`로 남긴다 — **`#app`이 보이는 것과 "부팅 성공"은 같은
말이 아니다.** 온보딩이 필요하면 `chat.js`가 `#app`을 숨긴 채 `#onboard`를 띄우고
그게 정상 동작이다. 그래서 판정은 "게이지가 끝났고 대화 창이 **어떤 모드로든**
도달했는가"이고, 어느 모드였는지(`app` / `onboard`)와 **모드 배타성**
(`exactlyOneModeVisible` — 형제 패널 둘이 동시에 보이면 겹쳐 그려진다)을 함께
기록한다. 검증 전용 프로필이 온보딩을 완료로 심으므로 기대값은 `app`이고,
`onboard`가 나오면 프로필 격리가 깨진 것이다(아래 "검증이 스스로를 속인 결함" 참조).

### 검증 2 — 점 → 캔버스 확장/수축, 프레임 실측 (부하 있는 상태)

`requestAnimationFrame` 타임스탬프 기준(뉴스 100건 + 재무제표 52행 + 마크다운을 실제로
렌더한 상태에서 측정). 60fps = 16.7ms 기준.

| | p50 | p95 | max | 프레임 수 |
|---|---|---|---|---|
| 확장 | 16.7ms | 33.4ms | 33.4ms | 30 |
| 수축 | 16.7ms | 16.8ms | 33.4ms | 35 |

(2026-08-17 실행. 이전 기록은 확장 p50 18.0 / p95 54.0 / max 89.5ms였다.)

수축은 거의 완전히 60fps. 확장은 p50이 60fps지만 p95/max에 프레임 드롭이 남는다
(콘텐츠 3종을 순차로 마운트하는 부하 때문으로 보임 — spike S1도 동일 환경에서
확장 쪽에만 드롭을 기록했다). **반복 실행마다 편차가 크다** — 같은 날 세 번
돌린 확장 max가 33.4 / 49.9 / 33.4ms였고, 이전 기록은 89.5ms였다. 이 환경 자체가
공유 데스크톱이라(spike RESULT.md에 이미 기록됨) 다른 프로세스 부하에 흔들린다.
**수치가 좋아진 것을 개선으로 읽으면 안 된다 — `ui/soul.md` §7의 굴절층·데이터층
분리는 여전히 미구현이고, 이 변동은 그 작업의 결과가 아니다.** 정직하게 말해
확장 쪽 프레임 안정성은 spike와 마찬가지로 **"부분통과"**다. 수축은 안정적으로
60fps. 스크린샷: `captures/03-mosaic-expanded.png`
(렌더러 캡처, 주 증거), `captures/03c-mosaic-OS-composited.png`(PowerShell
`CopyFromScreen` 실제 OS 합성 캡처 — 이번 실행에서는 성공. spike RESULT.md가 기록한
간헐 실패가 발생하면 렌더러 캡처만으로 충분하도록 `verify.js`가 실패를 흡수한다),
`captures/04-collapsed-back-to-chat.png`(수축 후 대화 창만 남음).

### 검증 3 — 두 창 독립성

```json
"independence": { "canvasMovedButChatUnchanged": true, "chatResizedButCanvasUnchanged": true }
```

캔버스 창을 +80px 이동해도 대화 창 좌표 불변, 대화 창을 리사이즈해도 캔버스 창 불변
— `getBounds()` 실측으로 확인(`VERIFY-REPORT.json`의 `independence` 참조). ±2px
허용 오차를 뒀다 — Windows `backgroundMaterial:'acrylic'` 적용 창은 `setBounds()`
요청값과 `getBounds()` 실측값 사이에 DPI 반올림으로 1px 안팎 편차가 실측됐다(기능적
결함 아님, spike에서는 안 겪은 값이라 이번에 새로 확인).

### 검증 4 — 접근성 3종 (CDP `Emulation.setEmulatedMedia`로 강제 적용 후 캡처)

OS 설정을 바꿀 수 없는 환경이라 Chrome DevTools Protocol로 각 미디어 피처를 강제
적용했다(`webContents.debugger` → `Emulation.setEmulatedMedia`). 실제 `@media` 쿼리가
그대로 반응하므로 유효한 검증이다.

- `prefers-reduced-transparency: reduce` — `captures/05-a11y-*-canvas.png`/`-chat.png`.
  유리 표면이 전부 `--color-k-panel2`/`--color-k-panel3` 불투명색으로 바뀌고 레이아웃은
  그대로 유지된다.
- `prefers-contrast: more` — `captures/06-a11y-*`. 배경 순검정, 테두리·텍스트 흰색으로
  전환.
- `prefers-reduced-motion: reduce` — `captures/07-a11y-*`. (정지 화면이라 모션 자체는
  스크린샷으로 못 보여준다 — `styles/access.css`의 `animation-duration:0.001ms !important`
  규칙이 실제 CSS로 존재한다는 게 코드 증거다. 레이아웃이 깨지지 않는지는 스크린샷으로 확인됨.)

### 검증 5 — 실제 개발용 트리거(Enter) 종단간 플로우

`mainMod` 함수를 직접 부르는 위 검증들과 별도로, **사용자가 실제로 하는 행동**(입력 후
Enter)을 그대로 시뮬레이션했다. `athena__render_canvas` 인터페이스, 3상태(판단중/
호출중/완료), 자동 성장까지 한 번에 통과.

```json
{
  "reachedDoneState": true,
  "boundsBeforeQuery": { "height": 205 },
  "boundsAfterQuery": { "height": 252 },
  "grewTallerThanBase": true,
  "grownByPx": 47,
  "finalAnswerText": "캔버스 창에 스트림, 리더, 공통 테이블을 띄웠습니다.",
  "cardChipCount": 3
}
```

`grownByPx`는 나중에 붙였다. `grewTallerThanBase`가 원래 `chatBaseH`(204)와만
비교해서 **DPI 반올림 1px(205 > 204)에도 통과했기 때문**이다 — 아래 "검증이
스스로를 속인 결함" 참조. 지금은 질의 전 높이 대비 실제 증가를 본다.

스크린샷: `captures/08-e2e-1-judging.png`(상태 1), `captures/09-e2e-2-calling.png`
(상태 2, TR 코드 누적 표시), `captures/10-e2e-3-done-autogrow.png`(상태 3, 캔버스
칩 3개 + 트레이스), `captures/11-e2e-3-mosaic-from-query.png`(실제 질의로 채워진
모자이크).

### 검증 6 — 대화 창 수동 리사이즈 (그립 드래그)

그립에서 위로 160px 드래그 시뮬레이션 → 높이 252→413(+161, 거의 정확히 일치),
**입력줄이 있는 하단 모서리는 고정**(`bottomEdgePinned:true`) — "위로만 자란다"가
실측으로 확인됨.

### 검증이 스스로를 속인 결함 (2026-08-17 발견·수정)

`plan/plan.md` 수치를 재실측하다가 나왔다. **`npm run verify`가 exit 0에 단언
전부 `true`를 내면서도 실제로는 아무것도 검증하지 않고 있었다.**

발단은 `chatReady: false`였다. 낡은 단언인 줄 알고 캡처를 열었더니
`02-chat-only-idle.png`가 "부팅 완료된 대화 창"이 아니라 **온보딩 3/3 계좌 등록
화면**이었다. 원인 사슬:

1. `lib/main/`의 네 모듈이 전부 `app.getPath('userData')` 아래를 읽는다 —
   `onboarding.js` · `accounts.js` · `cli-accounts.js` · `secrets.js`.
   **검증 결과가 이 머신에 무엇이 등록돼 있느냐에 따라 달라졌다.**
2. 이 머신은 계좌가 미등록이라 `chat.js`가 `#app`을 숨기고 `#onboard`를 띄웠다.
   정상 동작이다.
3. 그런데 `verify.js`는 그걸 모른 채 검증 5~8을 진행했다. `executeJavaScript`로
   쏘는 이벤트는 **숨은 요소에도 도달한다.** 그래서 단언은 전부 통과했다.
4. 같은 실행의 스크린샷은 정반대를 말하고 있었다 —
   `10-e2e-3-done-autogrow.png`("상태 3, 카드 칩 3개 + 트레이스"라고 이 문서가
   설명하던 그 캡처)에 대화 이력이 아니라 온보딩 계좌 화면이 잘려 찍혀 있었다.

같은 뿌리에서 두 번째 결함이 나왔다. **자동 성장이 죽어 있었는데 검증은
통과했다.** `startOnboarding()`이 `manualOverride=true`를 걸고, 숨은 `#history`의
`scrollHeight`는 0이라 `measureNeededHeight()`가 기본 높이만 돌려준다. 결과
높이는 205 — 그런데 옛 단언이 `boundsAfterQuery.height > layout.chatBaseH`(=204)
였다. **acrylic 창의 DPI 반올림 1px에 통과한 것이다.** 이 문서에 기록돼 있던
`boundsAfterQuery: 252`(진짜 성장 +47)는 온보딩 병합 **이전** 실행 값이었고,
그 뒤로 이 단언은 계속 1px로 통과하고 있었다.

수정 3건:

| 무엇 | 어떻게 |
|---|---|
| 시작 상태가 머신에 의존 | `verify.js`가 `app.setPath('userData', app/.verify-profile)`로 **검증 전용 프로필**을 쓰고 온보딩을 완료로 심는다. 매 실행 새로 만들고 개인 프로필은 건드리지 않는다 |
| `chatReady`가 정상 동작을 false로 찍음 | `bootMode`(`app`/`onboard`) + `exactlyOneModeVisible`(모드 배타성)로 교체 |
| `grewTallerThanBase`가 1px에 통과 | 질의 **전** 높이 대비 증가로 바꾸고 DPI 오차(±2px)보다 커야 통과. `grownByPx`를 함께 남긴다 |

수정 후 재실행: `모드: app`, `모드 배타성: true`, `grownByPx: 47`.
`10-e2e-3-done-autogrow.png`에 이제 질문·답변·카드 칩 3개·트레이스가 실제로 찍힌다.

대가를 적는다: 검증 전용 프로필은 계좌·MCP 목록이 **빈 상태**다. 검증 7·8은
카드의 존재와 경계(누수 0건, 창 안 늘어남)를 보는 것이라 유효하지만, **데이터가
찬 상태의 증거는 `npm run verify:settings-cards` 쪽**이다(캡처 11장). 두 검증의
역할이 다르다.

교훈은 CLAUDE.md §3·§9가 이미 적어둔 것이다 — **초록 불은 증거가 아니다.**
이 결함은 단언을 읽어서가 아니라 **캡처를 열어봐서** 잡혔다.

## soul.md·two-windows.md 대비 구현 범위

### 구현됨

- 두 창 독립 생성/이동/리사이즈, `backgroundMaterial:'acrylic'`(단독, `transparent:true`
  기본 미사용 — S1 실측 그대로)
- 부팅 시 대화 창만(캔버스 창은 최종 크기로 존재하되 숨김, `show/hide`만, `setBounds`
  애니메이션 없음)
- 점→캔버스: 실제 DOM `getBoundingClientRect()`로 좌표 계산(하드코딩 없음),
  `clip-path: circle()` + blur 변조, 페이드 미사용
- 대화 창: 위로만 자동 성장(상한 788px 스케일 적용), 수동 리사이즈 시 자동 성장이
  덮어쓰지 않음(새 턴에서 리셋), 3상태 표시(스피너 없이 점 breathe/pulse + 글자),
  TR 코드 노출 + 카운터(`n/N`), 완료 후 캔버스 칩 + 트레이스
- 캔버스 3종(스트림/리더/공통 테이블) 실제 캡처 데이터 렌더, sanitize 렌더링 계약 준수
- 접근성 3종 실제 CSS 구현 + 강제 적용 검증
- `athena__render_canvas`라는 이름의 IPC 핸들러로 미래 MCP 툴 호출과 같은 모양의
  인터페이스를 개발용 트리거(Enter)가 그대로 호출

### 미구현 · 단순화한 것 (숨기지 않고 명시)

- **⚠ 브랜치 병합에서 버린 기능 1건 — "옮기겠다"고 커밋에 써놓고 안 옮겼다.**
  병합 커밋 `c0d874b`(`merge: ANNJUNGCHAN/Call을 병합한다`)의 본문은
  *"버려진 것: 화면 설정(autoExpandCanvas/autoGrowChat), 커맨드바 설정 호출 정규식.
  **둘 다 후속 커밋에서 모드 구현에 옮긴다**"*라고 적었다.
  실제로는 **커맨드바 정규식만 옮겼고**(`chat.js`의 `SETTINGS_COMMAND`)
  **화면 설정은 안 옮겼다.** 지금 코드에 `autoExpandCanvas`/`autoGrowChat`은 0건이다.
  원본 구현은 `git show baa7e0e -- app/main.js`에 있다(약 40줄 + IPC 2채널 + 체크박스 2개).
  되살릴 때는 `PREFS_FILE`을 그때처럼 `settings.json`으로 두지 말고
  **`athena-prefs.json`으로 바꿔라** — `app/lib/main/`의 다른 모듈이 전부
  `athena-*.json` 관례를 쓴다(`accounts.js`, `onboarding.js`, `secrets.js`, `cli-accounts.js`).
- **카드 갱신 신선도**는 카드 헤더에 "HH:MM:SS 기준"으로 표시하지만, 실시간 재갱신
  로직(폴링/WebSocket)은 없다 — 목업 데이터라 시점이 고정.
- **카드 칩 클릭 시 해당 카드 강조**는 구현했지만(`athena:highlight-canvas`),
  스크롤 위치 복원 등 세부 동작은 최소 구현.
- **접기(collapse) 시 모자이크 내용을 초기화한다** — 재확장하면 새로 그린다. 카드별
  상태 보존은 W2 범위 밖으로 남겨뒀다.
- **대화 창 sheen의 "굴절 0.46→0.17" 값은 구현하지 않았다.** two-windows.md는 이 값을
  창 자체의 네이티브 유리 재질 강도로 서술하는데, Electron `backgroundMaterial` API는
  런타임에 블러 반경을 파라미터화하는 수단을 주지 않는다(on/off + 타입만). 실제로 조절
  가능한 값(`--glass-alpha`, 0.82↔0.97)만 구현했다 — 자세한 이유는 `chat.css` 주석.
  이건 "구현 중 발견한 버그" 3번과 같은 뿌리의 문제라 같이 정리했다.
- **밝은 배경화면 적응(`palette.md`의 색조 감지)**은 W2 범위가 아니라(다음 웨이브
  대상) 구현하지 않았다. 유리 알파값은 고정 곡선(뒤가 데스크톱/캔버스인지에 따른
  0.82~0.97)만 쓴다.
- ~~**백엔드 연동 없음**~~ — **더 이상 사실이 아니다.** 설정·온보딩 화면군이 들어오면서
  실제 백엔드에 붙었다. 아래 "설정·온보딩 화면군" 절 참조.
- **리더 캔버스 원문이 중간에 잘린다** — 위 "리더 캔버스 데이터의 제약" 참조. 캡처
  파일 자체의 한계이지 렌더러 버그가 아니다.
- **다키체 tabular figures 미검증** — `palette.md`가 지시한 대로 숫자 정렬이 중요한
  곳(재무제표, TR 코드)은 `--font-mono`(Geist Mono 우선, 없으면 시스템 등폭)로
  분리해뒀지만, 이 머신에 Geist Mono가 설치돼 있는지는 확인하지 않았다 — 폴백은
  `ui-monospace`.

---

## 설정·온보딩 화면군 (2026-08-16)

Paper 화면설계서 `Athena — 화면설계서`의 13개 아트보드를 실제 화면으로 옮겼다.
화면별 명세는 `plan/paper-specs/`에, 배치 근거는 같은 디렉토리의 `00-통합-계획.md`에
있다. 배치는 추측이 아니라 각 아트보드 스펙 패널의 **"위치" 필드**를 그대로 따랐다.

| 화면 | 어디에 | 파일 |
|---|---|---|
| AT-SY-002 온보딩 · CLI 연결 | 대화 창 확장 | `lib/onboarding.js` |
| AT-SY-003 온보딩 · 계좌 | 대화 창 확장 | `lib/onboarding.js` |
| AT-CV-OAUTH 인증 3종 | 대화 창 확장 | `lib/auth-screen.js` |
| AT-ST-001/002/003 계좌 | 캔버스 카드 + 내부 시트 | `lib/settings-cards.js` |
| AT-ST-004/005/006 MCP | 캔버스 카드 + 내부 시트 | `lib/settings-cards.js` |
| AT-ST-007 비밀값 원칙 | 화면 아님 — 정책 | 전 화면이 준수 |

**창은 여전히 둘뿐이다.** `soul.md` §8이 "창이 셋 이상"을 즉시 탈락으로 못박아서다.
`new BrowserWindow` 호출은 워밍업·캔버스·대화 3개 그대로이고 이번에 늘지 않았다.

두 창이 공유하는 프리미티브는 `lib/ui-kit.js` + `styles/ui-kit.css`다. 표시등·배지·
버튼 3종·진행 점·시트 셸·빈 상태·오류. 창마다 각자 그리면 같은 배지가 두 벌로
갈라지기 때문에 하나로 묶었다.

### MCP는 재구현이 아니라 래퍼다

`lib/main/mcp-cli.js`가 `backend/athena_mcp`의 Python CLI를 spawn한다. 스니펫 파싱,
별칭 정규화, 위험 패턴 스캔, 동의 게이트를 JS로 다시 만들지 않았다 — **그게 보안
경계이고, 205개 테스트로 고정돼 있다(2026-08-17 실측).** 두 벌로 만들면 경계가 갈라진다.

검증 중 실제로 확인했다: 승인 전에 `mcp-probe`/`mcp-allow-tool`을 렌더러를 우회해
직접 호출해도 Python 쪽이 `ConsentNotGrantedError`로 거부한다. UI가 만든 게이트가
아니라 백엔드가 강제하는 게이트다.

### 비밀값

계좌 APP KEY/SECRET KEY는 `lib/main/secrets.js`가 Electron `safeStorage`(윈도우에서
DPAPI)로 암호화해 저장한다. 렌더러는 값을 들고 있지 않고 화면에는 문자 수만 뜬다
(`ui-kit.js`의 `secretMask()`는 **값이 아니라 개수를 받는다** — 시그니처만으로 값이
DOM에 닿을 수 없다). `safeStorage.isEncryptionAvailable()`이 false면 평문으로
떨어지지 않고 저장을 거부한다.

실측 확인: 센티넬 값으로 등록한 뒤 디스크의 저장소를 직접 열어 base64 암호문임을,
그리고 IPC 응답·`account-list`·`main-debug.log` 어디에도 값이 안 나타남을 확인했다.

### 설계에 없어서 지어낸 것 (전부 명시한다)

스펙이 답하지 않는 자리가 있었다. 지어내는 건 불가피했지만 조용히 지어내면 안 되므로
전부 여기 적는다 — 각 항목은 소스 주석에도 같은 내용이 달려 있다.

| 지어낸 것 | 무엇을 | 왜 |
|---|---|---|
| 온보딩 "1 / 3" 단계 | **부팅 화면(AT-SY-001)을 1단계로 잡았다** | 22개 아트보드 어디에도 "1 / 3"이 없다. 부팅 게이지는 매 실행 뜨지만 단계 표기는 온보딩이 필요할 때만 붙는다 — 끝난 사용자에게 1/3을 보이면 뒤따르지 않을 2/3→3/3을 약속하는 거짓말이 된다 |
| CLI 0개일 때 [계속] | 비활성 + 이유 툴팁 | "건너뛰기 없음. CLI를 연결하지 않으면 앱이 아무 일도 하지 못한다"(Desc 5). 보드는 0개 상태를 그리지 않는다 |
| `cli-list` 실패 시 | 게이트를 **닫는다**(폴백 전부 미연결) | 조회 실패로 게이트가 열리면 안 된다. fail-closed |
| CLI 로그인 방식 | 터미널 창에서 CLI 자체 로그인 명령 | 스펙 각주가 "미정 — 협의 필요"(빨간 글씨). 사용자 결정으로 위임 방식 채택 |
| CLI 로그인 대기 | 90초 타임아웃 | 로딩·실패 상태가 설계에 없다. 무한 대기보다 낫다 |
| 인증 화면 자동 진행 | 2.4초 타이머 | 상태 전이 트리거가 스펙에 없다 |
| "연결 해제" | 영구 비활성 + 사유 툴팁 | 토큰 폐기 채널이 계약에 없다. 눌리는 척하지 않는다 |
| **노출 CLI 2종** | Claude·Codex만 | 설계 Desc 2는 "4종 고정, 설치 여부 미탐지"다. **이 규칙을 알면서 어겼다** — Gemini·Grok의 로그인 명령과 자격증명 경로가 미검증 추정치라, 아는 척하는 쪽이 더 나쁘다. 복구 조건: 두 CLI가 있는 머신에서 검증 후 목록 3곳에 되돌린다 |
| **브랜드색 배치** | 상태 표시에서 걷어내고 확정 액션에만 | 스펙이 자기모순이다(아래 참조). 그림 대신 규칙을 택했다 |
| 카드 개별 닫기 | 헤더에 조용한 닫기, 마지막 카드를 닫으면 캔버스가 접힌다 | 설계가 여는 법만 정하고 닫는 법을 안 정했다. 빈 유리창을 남기지 않는다 |
| 행 삭제 | 인라인 확인 바 1회 (`window.confirm` 아님) | 설계에 삭제 동선이 없다. 모달은 프레임리스 렌더러를 막는다. 계좌 *전환*의 "확인 대화상자 없음"은 전환 규칙이지 삭제 규칙이 아니다 |
| 화면 문구 "브라우저에서 로그인" | "터미널 창에서 로그인"으로 수정 | 실제로는 콘솔이 뜬다. 화면이 브라우저를 약속하고 콘솔을 띄우면 거짓말이다 |

### 남은 문제 (조용히 넘기지 않는다)

- **[HIGH] MCP `env` 값은 평문으로 저장된다.** 계좌 키는 DPAPI로 암호화하는데,
  MCP 스니펫의 `env`(DART·NAVER 실제 API 키가 들어간다)는 `athena-mcp register`가
  `~/.athena/mcp_servers.json`에 `json.dumps`로 그냥 쓴다
  (`backend/athena_mcp/registry.py`의 `save()`). 렌더러 쪽은 깨끗하다 — UI에는
  `envKeys`(키 이름)만 넘어가고 값은 한 번도 건너오지 않는다. 하지만 **앱 안에서
  비밀값 두 종류가 서로 다른 보호 수준을 받는 상태**이고, 이건 백엔드 레지스트리를
  고쳐야 닫힌다. UI를 붙이면서 드러난 문제이지 UI가 만든 문제가 아니다.
- **CLI 로그인 왕복은 끝까지 검증 못 했다.** 버튼이 실제 로그인 명령을 띄우는
  것까지는 확인했지만, 사람이 그 창에서 로그인을 마치고 앱이 그걸 감지하는
  전체 흐름은 아무도 돌려보지 않았다. Codex는 probe만 해도 기존 세션이
  로그아웃되는 부작용이 조사에서 실측돼 일부러 건드리지 않았다.
- **Gemini·Grok은 이 머신에 설치돼 있지 않다.** 두 CLI의 로그인 명령과 자격증명
  경로가 **미검증 추정치**라, 지금은 화면에서 뺐다(위 "지어낸 것" 참조).
  `plan/paper-specs/01-CLI-로그인-조사.md`에 추정치 그대로 남겨뒀다.
- **키움 실계좌 키가 없어 성공 경로를 못 봤다.** 인증 실패 경로만 실제로 탔다.

### 닫힌 것 (이전 판에 남은 문제로 적혀 있던 것)

- ~~툴 불허가 `consent.json`을 직접 건드린다~~ → **닫혔다.** 백엔드에
  `athena-mcp disallow <alias> <tool>...`을 넣고 JS의 직접 쓰기 경로는 폴백 없이
  삭제했다. 조사 결과 `consent.py`의 `disallow_tool()`은 원래 있었고 테스트도
  있었다 — 없던 건 CLI 서브커맨드뿐이었다. 허용된 적 없는 툴의 불허는 조용히
  성공한다(권한을 주는 데는 전제조건이 필요하지만 뺏는 데는 필요 없다).
- ~~`account-remove`/`mcp-remove`는 UI 호출자가 없다~~ → **닫혔다.** 두 카드의
  행에 삭제를 달았다.
- ~~스펙이 자기모순이다 — 브랜드색~~ → **규칙 쪽으로 정리했다.** AT-SY-002는
  "[계속]이 화면 내 유일한 브랜드색 요소"라고 적어놓고 같은 문서의 픽셀 스펙이
  활성 배지와 활성 행 배경에도 브랜드색을 쓴다. 그림 대신 규칙을 택했다 —
  palette.md/soul.md의 "브랜드색은 인터랙션 지점 하나에만"과 일치하고, MCP 카드
  3종은 이미 그 규칙을 지키고 있어서 온보딩만 예외로 두면 앱 안에서 규칙이
  갈라진다. 지금 화면별 브랜드색 요소는 정확히 하나다: `[계속]` /
  `[검증 후 시작]` / `[발급]` / `[전환하고 다시 인증]`. **Paper 목업과 픽셀이
  다르다** — 설계서를 고치지 않았으므로 이 차이는 여기 기록으로만 존재한다.

### 검증

```powershell
cd app
npm start                 # 최초 실행이면 온보딩이 뜬다
npm run verify:settings   # 설정 화면군 캡처
```

`captures/ONB-*.png`·`captures/SETTINGS-*.png`가 실측 캡처다.
`ONB-01-cli-step-list-load-failed.png`는 **정상 상태가 아니라 `cli-list` 실패
상태**의 캡처다 — 그 상황에서도 [계속]이 잠기는지 보려고 남겼다.
