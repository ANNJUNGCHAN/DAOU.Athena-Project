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

`npm run verify` (=`electron verify.js`) 마지막 통과 실행의 stdout 그대로:

```
[layout] 화면(1920x1152)이 설계 치수를 그대로 수용 — 축소 없음
[verify] 검증1 완료 — 부팅 시 캔버스 창 표시 여부: false chatReady: true
[verify] 확장 프레임 stats: {"frameCount":25,"p50":18,"p95":54,"max":89.5,"min":17.5}
[verify] 수축 프레임 stats: {"frameCount":32,"p50":18,"p95":18.5,"max":20.300000000000182,"min":17.5}
[verify] 독립성 체크: true true
[verify] 접근성 3종 캡처 완료
[verify] 검증5(E2E Enter 트리거): {"reachedDoneState":true,"boundsBeforeQuery":{"x":180,"y":874,"width":1561,"height":205},"boundsAfterQuery":{"x":180,"y":827,"width":1561,"height":252},"grewTallerThanBase":true,"finalAnswerText":"캔버스 창에 스트림, 리더, 공통 테이블을 띄웠습니다.","canvasChipCount":3}
[verify] 검증6(수동 리사이즈): {"beforeDrag":{"x":180,"y":827,"width":1561,"height":252},"afterDrag":{"x":180,"y":666,"width":1561,"height":413},"grewByDrag":true,"bottomEdgePinned":true}
[verify] 리포트 저장: C:\Projects\DAOU.Athena\app\captures\VERIFY-REPORT.json
```

(W2 검증(외부 검토) 단계에서 `npm start`가 창을 안 띄우는 버그(위 버그 0번)를 고친 뒤
`npm run verify`를 다시 실행해 재현한 결과 — 수치가 이전 기록과 미세하게 다른 것은
공유 데스크톱 환경의 프레임 편차 때문이다(같은 이유가 아래 검증2 서술에도 그대로
적용된다). `package.json`의 `verify` 스크립트가 처음에 `node verify.js`로 잘못
적혀 있었다 — `verify.js`는 `electron` 모듈 API를 쓰므로 일반 Node로 실행하면
동작하지 않는다. 이것도 구현 중 발견해 `electron verify.js`로 고쳤다.)

원본 수치 전체: `app/captures/VERIFY-REPORT.json`. 실행 환경: Windows 11 26200,
화면 1920×1152 — 설계 치수(1560×1004)가 그대로 들어가 축소 없음.

### 검증 1 — 부팅 시 대화 창만 뜬다

`canvasVisibleAtBoot:false`, `chatVisibleAtBoot:true`. 스크린샷:
`captures/01-boot-gauge.png`(게이지 차오르는 중), `captures/02-chat-only-idle.png`
(부팅 완료, 캔버스 창은 화면에 없음).

### 검증 2 — 점 → 캔버스 확장/수축, 프레임 실측 (부하 있는 상태)

`requestAnimationFrame` 타임스탬프 기준(뉴스 100건 + 재무제표 52행 + 마크다운을 실제로
렌더한 상태에서 측정). 60fps = 16.7ms 기준.

| | p50 | p95 | max | 프레임 수 |
|---|---|---|---|---|
| 확장 | 18.0ms | 54.0ms | 89.5ms | 25 |
| 수축 | 18.0ms | 18.5ms | 20.3ms | 32 |

수축은 거의 완전히 60fps. 확장은 p50이 60fps 근처지만 p95/max에 눈에 띄는 프레임
드롭이 있다(콘텐츠 3종을 순차로 마운트하는 부하 때문으로 보임 — spike S1도 동일
환경에서 확장 쪽에만 드롭을 기록했다). 반복 실행마다 편차가 컸다(다른 실행에서는
p95 35.6ms/max 54ms) — 이 환경 자체가 공유 데스크톱이라(spike RESULT.md에 이미
기록됨) 다른 프로세스 부하에 흔들린다. **정직하게 말해 확장 쪽 프레임 안정성은
spike와 마찬가지로 "부분통과"다.** 수축은 안정적으로 60fps. 스크린샷: `captures/03-mosaic-expanded.png`
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
  "finalAnswerText": "캔버스 창에 스트림, 리더, 공통 테이블을 띄웠습니다.",
  "canvasChipCount": 3
}
```

스크린샷: `captures/08-e2e-1-judging.png`(상태 1), `captures/09-e2e-2-calling.png`
(상태 2, TR 코드 누적 표시), `captures/10-e2e-3-done-autogrow.png`(상태 3, 캔버스
칩 3개 + 트레이스), `captures/11-e2e-3-mosaic-from-query.png`(실제 질의로 채워진
모자이크).

### 검증 6 — 대화 창 수동 리사이즈 (그립 드래그)

그립에서 위로 160px 드래그 시뮬레이션 → 높이 252→413(+161, 거의 정확히 일치),
**입력줄이 있는 하단 모서리는 고정**(`bottomEdgePinned:true`) — "위로만 자란다"가
실측으로 확인됨.

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

- **캔버스 갱신 신선도**는 카드 헤더에 "HH:MM:SS 기준"으로 표시하지만, 실시간 재갱신
  로직(폴링/WebSocket)은 없다 — 목업 데이터라 시점이 고정.
- **캔버스 칩 클릭 시 해당 캔버스 강조**는 구현했지만(`athena:highlight-canvas`),
  스크롤 위치 복원 등 세부 동작은 최소 구현.
- **접기(collapse) 시 모자이크 내용을 초기화한다** — 재확장하면 새로 그린다. 캔버스별
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
경계이고, 191개 테스트로 고정돼 있다.** 두 벌로 만들면 경계가 갈라진다.

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
| 온보딩 "1 / 3" 단계 | 존재하지 않는다 | 22개 아트보드 전수 확인. 2/3·3/3만 있다. 부팅(AT-SY-001)이 1/3인지 스펙이 말하지 않는다 |
| CLI 0개일 때 [계속] | 비활성 + 이유 툴팁 | "건너뛰기 없음. CLI를 연결하지 않으면 앱이 아무 일도 하지 못한다"(Desc 5). 보드는 0개 상태를 그리지 않는다 |
| `cli-list` 실패 시 | 게이트를 **닫는다**(폴백 4종 미연결) | 조회 실패로 게이트가 열리면 안 된다. fail-closed |
| CLI 로그인 방식 | 터미널 창에서 CLI 자체 로그인 명령 | 스펙 각주가 "미정 — 협의 필요"(빨간 글씨). 사용자 결정으로 위임 방식 채택 |
| CLI 로그인 대기 | 90초 타임아웃 | 로딩·실패 상태가 설계에 없다. 무한 대기보다 낫다 |
| 인증 화면 자동 진행 | 2.4초 타이머 | 상태 전이 트리거가 스펙에 없다 |
| "연결 해제" | 영구 비활성 + 사유 툴팁 | 토큰 폐기 채널이 계약에 없다. 눌리는 척하지 않는다 |
| 툴 개별 **불허** | `consent.json` 직접 수정 | Python CLI에 `allow` 취소 서브커맨드가 없다. **가장 지저분한 우회다** — 아래 참조 |
| 카드 개별 닫기 | 없음 | 설계가 여는 법만 정하고 닫는 법을 안 정했다. 전역 Esc가 유일한 퇴장로 |
| 화면 문구 "브라우저에서 로그인" | "터미널 창에서 로그인"으로 수정 | 실제로는 콘솔이 뜬다. 화면이 브라우저를 약속하고 콘솔을 띄우면 거짓말이다 |

### 남은 문제 (조용히 넘기지 않는다)

- **[HIGH] MCP `env` 값은 평문으로 저장된다.** 계좌 키는 DPAPI로 암호화하는데,
  MCP 스니펫의 `env`(DART·NAVER 실제 API 키가 들어간다)는 `athena-mcp register`가
  `~/.athena/mcp_servers.json`에 `json.dumps`로 그냥 쓴다
  (`backend/athena_mcp/registry.py`의 `save()`). 렌더러 쪽은 깨끗하다 — UI에는
  `envKeys`(키 이름)만 넘어가고 값은 한 번도 건너오지 않는다. 하지만 **앱 안에서
  비밀값 두 종류가 서로 다른 보호 수준을 받는 상태**이고, 이건 백엔드 레지스트리를
  고쳐야 닫힌다. UI를 붙이면서 드러난 문제이지 UI가 만든 문제가 아니다.
- **툴 불허가 `consent.json`을 직접 건드린다.** Python CLI가 `allow`의 반대를
  제공하지 않아서다. 파일 형식이 바뀌면 조용히 깨진다 — 제대로 된 해법은 백엔드에
  `disallow` 서브커맨드를 넣는 것이다.
- **`account-remove`/`mcp-remove`는 UI 호출자가 없다.** 메인 쪽 구현과 검증은
  끝났는데 부르는 버튼이 없다. 잘못 등록한 서버·계좌를 화면에서 지울 수 없다.
  설계도 삭제 동선을 안 그렸다.
- **CLI 로그인 왕복은 끝까지 검증 못 했다.** 버튼이 실제 로그인 명령을 띄우는
  것까지는 확인했지만, 사람이 그 창에서 로그인을 마치고 앱이 그걸 감지하는
  전체 흐름은 아무도 돌려보지 않았다. Codex는 probe만 해도 기존 세션이
  로그아웃되는 부작용이 조사에서 실측돼 일부러 건드리지 않았다.
- **Gemini·Grok은 이 머신에 설치돼 있지 않다.** 두 CLI의 로그인 명령과 자격증명
  경로는 **미검증 추정치**다(`plan/paper-specs/01-CLI-로그인-조사.md`).
- **키움 실계좌 키가 없어 성공 경로를 못 봤다.** 인증 실패 경로만 실제로 탔다.
- **스펙 자체가 모순이다 — 브랜드색.** AT-SY-002는 "[계속]이 화면 내 유일한
  브랜드색 요소"라고 적어놓고, 같은 문서의 픽셀 스펙이 활성 배지와 활성 행 배경에도
  브랜드색을 쓴다. 목업 픽셀을 따랐다(산문보다 그림이 우선). 화면에는 브랜드색
  요소가 3개다.

### 검증

```powershell
cd app
npm start                 # 최초 실행이면 온보딩이 뜬다
npm run verify:settings   # 설정 화면군 캡처
```

`captures/ONB-*.png`·`captures/SETTINGS-*.png`가 실측 캡처다.
`ONB-01-cli-step-list-load-failed.png`는 **정상 상태가 아니라 `cli-list` 실패
상태**의 캡처다 — 그 상황에서도 [계속]이 잠기는지 보려고 남겼다.
