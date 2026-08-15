# S1 — Electron 두 창 · 리퀴드 글래스 · 점→캔버스 확장 — 결과

## 판정 : 부분통과

- **검증 1 (transparent ↔ backgroundMaterial:'acrylic' 충돌 여부)**: **통과.** 충돌하지 않는다. 실측 근거 확보.
- **검증 2 (점→캔버스 확장 모션, 프레임 실측)**: **부분통과.** 프레임 실측치는 확보(60Hz 근접, 정상). 다만 실제 데스크톱 화면 합성 스크린샷은 이 실행 환경의 문제로 일부만 확보(아래 "막힌 것" 참조), 렌더러 레벨(`capturePage`) 캡처로 보완.
- **검증 3 (두 창 배치 · 독립 이동/리사이즈)**: **통과.** `getBounds()` 수치로 완전 독립 확인.

---

## 검증 1 — transparent ↔ backgroundMaterial:'acrylic' 충돌 여부 (최우선)

### 4조합 판정표

| 조합 | 설정 | 데스크톱(대체: 컬러 배경 창)이 비치는가 | 블러/굴절이 걸리는가 | 텍스트 읽히는가 | 스크린샷 |
|---|---|---|---|---|---|
| a | `transparent:true`만 | **예** | **아니오** — 완전 투명, 블러 없음. 원본 대각선 줄무늬가 선명하게 그대로 비침 | 예 (라벨 배경이 있어 읽힘) | `captures/S1-a.png` |
| b | `backgroundMaterial:'acrylic'`만 | **예** | **예** — 아크릴 블러가 걸려 원본 패턴이 부드러운 그라디언트로 뭉개짐 | 예 | `captures/S1-b-retest.png` (최초 캡처는 측정 아티팩트로 무효, 아래 설명) |
| c | 둘 다 | **예** | **예** — b와 육안상 동일한 블러 결과 | 예 | `captures/S1-c.png` |
| d | 둘 다 없음, CSS `backdrop-filter: blur()`만 | **아니오** — 창이 OS 레벨로 불투명이라 실제 데스크톱은 전혀 비치지 않음. 페이지 내부에 미리 그려둔 장식용 컬러 블록만 블러됨 | 페이지 내부 콘텐츠에는 걸림(무의미) | 예 | `captures/S1-d-retest.png` |

**데스크톱 대체 검증에 대한 명시**: 실제 바탕화면 대신, 별도의 Electron "backdrop" 창(대각선 무지개 줄무늬 + 격자, `backdrop.html`)을 뒤에 깔고 그 위에 4개 테스트 창을 겹쳐 캡처했다. 판정 기준인 "무언가 뒤에 있고 그것이 비치는가/블러되는가"는 이 방식으로 충분히 검증된다. 스크린샷은 `webContents.capturePage()`가 아니라 **PowerShell `System.Drawing.Graphics.CopyFromScreen`으로 실제 OS 합성 결과를 캡처**했다 — 이게 핵심이다. `capturePage()`는 Chromium이 자체 래스터한 결과만 주므로 transparent 창의 경우 알파만 나오고 실제 DWM 합성(굴절/블러)은 보이지 않는다. `S1-{a,b,c,d}-webcontents.png`도 비교용으로 같이 저장했다.

### 측정 아티팩트 — 정직하게 기록

최초 실행(`v1.js`)에서 combo b와 d의 스크린샷에 `Electron (응답 없음)` 이라는 Windows "정지됨" 고스트 타이틀바가 찍혔다. 처음엔 이걸 "backgroundMaterial이 뭔가를 멈추게 한다"는 신호로 의심했다. 그런데 원인을 격리해보니 **`execFileSync`로 PowerShell 캡처 프로세스를 동기 실행하면서 Electron 메인 프로세스의 메시지 펌프가 잠깐 멎었고, 그 순간을 캡처했을 뿐**이었다(`v1-retest.js`에서 캡처를 비동기 `execFile` + 더 긴 대기 시간으로 바꾸자 고스트바가 사라지고 b/c가 시각적으로 동일한 블러 결과를 보임). **결론: transparent와 acrylic의 충돌이 아니라 내 측정 스크립트의 아티팩트였다.** 재현 스크립트: `v1-retest.js`.

### 핵심 질문에 대한 답

**"유리 뒤 데스크톱 굴절"이 가능한가 / 어떤 설정으로 가능한가?**

- **가능하다.** 그리고 `transparent:true`와 `backgroundMaterial:'acrylic'`는 **Electron 43.4.0 / Win11 26200(이 머신)에서 충돌하지 않는다.** 둘을 같이 써도 크래시나 렌더 깨짐이 없었다.
- 다만 **둘을 같이 쓸 필요가 없다.** `backgroundMaterial:'acrylic'` **단독**으로 이미 "뒤가 비치면서 블러까지 걸리는" 결과를 낸다(combo b). `transparent:true` 단독은 블러 없이 완전 투명만 준다(combo a). `soul.md` §7이 요구하는 "유리 두께가 정보 밀도에 비례해 두꺼워진다"는 요구는 **`backgroundMaterial`의 재질감**(acrylic)이 필요하지, 단순 투명(`transparent`)만으로는 그 "서리유리" 질감이 나오지 않는다.
- `backdrop-filter: blur()`(CSS만, OS 레벨 투명 없음, combo d)는 **실제 데스크톱을 절대 비추지 못한다.** 창이 OS 입장에서 완전 불투명이기 때문에 blur는 페이지 내부 콘텐츠에만 적용된다. 이는 "리퀴드 글래스는 CSS만으로 흉내 낼 수 없다"는 걸 실측으로 확인한 것.

**soul.md §7 재료 규범 중 무엇을 포기해야 하는가?**

→ **아무것도 포기할 필요가 없다.** transparent/acrylic 충돌 가설은 이 환경에서 기각됐다. 다만 실무적으로 권장: **`backgroundMaterial:'acrylic'`을 기본으로 쓰고, `transparent:true`는 완전히 투명한(블러 없는) 하위 레이어가 필요할 때만 추가로 켠다.** 두 옵션은 상호 배타가 아니라 상호 보완이었다.

증거: `spike/captures/S1-a.png`, `S1-b-retest.png`, `S1-c.png`, `S1-d-retest.png`, `S1-v1-log.json`(4조합 모두 `createErr: null` — 예외 없음).

---

## 검증 2 — 점 → 캔버스 확장 모션

### 구현 방식

- 캔버스 창은 **처음부터 최종 크기로 존재**(`show:false`로 생성 후 `show()` 1회만 호출). `setBounds()` 프레임 애니메이션 미사용.
- 대화 창 안의 점(`#dot`)의 실제 DOM `getBoundingClientRect()`를 읽어 화면 좌표로 환산하고, 그 좌표를 캔버스 창 로컬 좌표로 변환해 `clip-path: circle(r at x y)`의 중심으로 사용(`v2.js` — 하드코딩 아님).
- `r`을 0→`rmax`(중심에서 가장 먼 모서리까지 거리)로 애니메이션, 동시에 `.sheen` 레이어의 `backdrop-filter: blur()`를 30px→6px로 변조. **페이드(opacity) 미사용** — `liquid-glass.md` 규범대로 굴절 강도 변조로 등장.
- 캔버스 창 안에는 **SVG 라인차트(300포인트) + 100행 숫자 테이블**을 실제로 렌더링해 부하를 만든 상태에서 측정(`canvas.html`).
- 수축(collapse)도 역방향으로 구현해 같이 측정.

### 프레임 실측 (requestAnimationFrame 타임스탬프, `duration=550ms`)

| | p50 | p95 | 최악(max) | 프레임 수 | 비고 |
|---|---|---|---|---|---|
| **확장(expand)** | 16.7ms | 33.3ms | 33.4ms | 33 | 60Hz 기준 16.7ms. raw_deltas_ms 32개 중 20ms를 넘는 값이 **2개**(33.4ms, 33.3ms — 인덱스 5, 7, 서로 2프레임 간격)로 프레임 드롭이 애니메이션 중 2회 발생 |
| **수축(collapse)** | 16.7ms | 16.8ms | 16.8ms | 35 | 드롭 없음, 완전히 60fps |

60fps = 16.7ms 기준. **확장은 사실상 60fps를 유지하되 550ms 동안 프레임 드롭이 2회 있었고(각 33ms대), 수축은 드롭이 전혀 없었다.** (최초 작성 시 "1회"로 오기재됨 — 검증 과정에서 raw_deltas_ms를 직접 세어보니 20ms 초과 값이 2개였다. 아래 정정.) 100행 테이블 + SVG 300포인트 차트 + `backdrop-filter` blur 변조를 동시에 건 상태에서 나온 수치로, 실사용 부하 조건에서 측정한 것이다. 원본 타임스탬프: `spike/captures/S1-frames.json`.

### 시각 증거

- 점 상태(확장 전): `S1-v2-00-chat-only-webcontents.png` — 대화 창 안의 점과 "무엇이든 물어보세요…" 플레이스홀더가 렌더링됨.
- 확장 완료: `S1-v2-01-expanded-webcontents.png` — 차트+테이블이 실제로 그려진 상태로 원형 마스크가 전체를 덮고, sheen 레이어의 블러가 걸려 있음.
- 실제 데스크톱 위에서의 확장 결과(성공한 캡처 1건): `S1-v2-01-expanded-full.png` — VSCode 데스크톱 배경 위에 캔버스 창의 차트/테이블이 블러된 채로 실제 합성되어 보임(리퀴드 글래스 굴절이 실사용 부하 상태에서도 유지됨을 확인).

### 캔버스+대화창 배치 관련 축소 고지

검증 2의 온스크린 캡처만, 아래 "막힌 것"에서 설명하는 이 실행 환경의 창-합성 문제를 피하기 위해 **세로 크기를 0.7배로 축소**(캔버스 1560×560, 대화 1560×143)해서 캡처했다. 폭(1560)은 문제가 아니었으므로 그대로 유지했고, 세로만 줄였다. **이건 캡처 검증용 임시 축소이지 실제 설계 치수(1560×800 / 1560×204)를 바꾼 게 아니다** — 검증 3에서는 축소 없이 원래 치수 그대로 확인했다(아래).

---

## 검증 3 — 두 창 배치

`v3.js`: 캔버스 창(1560×800, 위) + 대화 창(1560×204, 아래)를 **원래 치수 그대로**, 화면(1920×1200)에 축소 없이 배치했다(`FITS_FULL_SIZE: true`).

### 실측

```
초기:            canvas {x:180,y:0,  w:1560,h:800}   chat {x:180,y:800,w:1560,h:204}
캔버스만 +120px:  canvas {x:300,y:0,  w:1560,h:800}   chat {x:180,y:800,w:1560,h:204}  (대화창 불변)
대화창만 리사이즈: canvas {x:300,y:0,  w:1560,h:800}   chat {x:180,y:800,w:1560,h:150}  (캔버스 불변)
```

`independenceCheck`: `canvasMovedButChatUnchanged: true`, `chatResizedButCanvasUnchanged: true` — **두 창은 완전히 독립적으로 이동·리사이즈된다.** 전체 데이터: `spike/captures/S1-v3-report.json`.

화면 해상도는 1920×1200으로 1560px 폭과 (800+204)=1004px 높이를 축소 없이 그대로 담을 수 있어 **비율 축소가 필요 없었다.**

시각 증거: `S1-v3-01-initial-layout.png`(캔버스 창이 실제 데스크톱 위에 올바른 크기·제목("CANVAS 1560x800")으로 표시됨), `S1-v3-02-after-independent-move-resize.png`.

---

## 실행 방법 (재현 커맨드)

```bash
cd spike/electron-glass
npm install               # electron 43.4.0 설치 (이미 완료됨, node_modules는 .gitignore)

# 검증 1
"./node_modules/.bin/electron" v1.js         # 4조합 최초 실행 (b/d에 측정 아티팩트 있음)
"./node_modules/.bin/electron" v1-retest.js  # b/d 비동기 캡처로 재검증 (아티팩트 해소)

# 검증 2
"./node_modules/.bin/electron" v2.js         # 점→캔버스 확장/수축, 프레임 실측, 스크린샷

# 검증 3
"./node_modules/.bin/electron" v3.js         # 두 창 배치, 독립 이동/리사이즈 실측

# 환경 진단에 쓴 보조 스크립트 (막힌 것 참조)
"./node_modules/.bin/electron" check-zorder.js
"./node_modules/.bin/electron" check-align.js
"./node_modules/.bin/electron" check-scale.js
"./node_modules/.bin/electron" recheck.js
```

산출물: `spike/electron-glass/captures/` (스크린샷 PNG + `S1-v1-log.json` + `S1-frames.json` + `S1-v3-report.json`).

---

## 막힌 것 (정직하게)

### 1. 이 실행 환경에서 실제 데스크톱 화면 캡처가 간헐적으로 실패한다 — 원인 완전 규명 못 함

검증 2/3를 진행하며 재현되는 현상: **프로세스가 생성해 `show()`한 창 중 일부가, Electron 내부적으로는 `isVisible:true / isFocused:true / isAlwaysOnTop:true`를 보고하는데도, 실제 PowerShell `CopyFromScreen` 캡처에는 전혀 나타나지 않는다** — 그 자리에는 이 세션의 다른 창(VS Code, 실시간으로 다른 에이전트가 조작 중인 것으로 보임 — 캡처마다 사이드바 내용이 바뀌어 있었다)이 그대로 찍혔다.

시도한 것:
- `alwaysOnTop: true`, `setAlwaysOnTop(true, 'screen-saver', 1)`(최고 z-band), `setVisibleOnAllWorkspaces`, `focus()`, `moveTop()` — 전부 적용해도 실패 재현됨.
- Y좌표 임계값 가설(창 top-edge가 화면의 특정 y 이상이면 실패) — `check-zorder.js`로 y:80/0/700/800/860을 개별 테스트한 결과 처음엔 "700은 성공, 800은 실패"라는 재현 가능한 경계처럼 보였으나, **나중에 같은 좌표(y:560, y:700 등 이전에 성공했던 값)를 다시 테스트하니 실패로 바뀌었다.** 즉 고정된 y 임계값이 아니었다.
- "프로세스의 첫 번째 show() 창만 실패한다" 가설 — 워밍업 창을 먼저 띄웠다 닫는 우회를 시도했으나, 이 과정에서 **`window-all-closed`에 리스너가 없으면 Electron이 조용히 `app.quit()`해버리는 별개의 버그**를 발견해서 고쳤다(`app.on('window-all-closed', () => {})` 추가). 고친 뒤에도 "첫 창 실패, 나중 창 성공" 패턴이 부분적으로만 재현됐고 완전히 안정적이지 않았다.
- 최종적으로 남은 가장 개연성 있는 설명: **이 세션이 공유된 대화형 데스크톱**이고(스크린샷마다 VSCode 파일 트리·선택 항목이 실시간으로 바뀜 — 다른 에이전트/프로세스가 동시에 그 데스크톱을 사용 중), Windows의 포그라운드 활성화 제한(anti-focus-stealing) 때문에 백그라운드에서 생성된 창이 topmost로 승격되는 게 **그 순간의 다른 프로세스 활동과 경합하는 비결정적 상황**이라는 것. 이걸 코드로 100% 해결하지 못했다.

**대응**: `webContents.capturePage()`(OS 합성에 의존하지 않는 렌더러 레벨 캡처)를 모든 검증에 보조 증거로 병행 저장했다. 검증 1은 초반에 실제 데스크톱 캡처가 안정적으로 성공한 시점에 확보되어 문제없다. 검증 2/3는 일부(예: 대화창 단독 상태)의 실제 데스크톱 캡처가 실패했고, 대신 `capturePage()` 캡처와 `getBounds()`/`requestAnimationFrame` 수치 데이터로 대체 증거를 남겼다. **이 수치 데이터(프레임 타이밍, bounds 좌표)는 OS 화면 합성과 무관하게 Chromium 내부에서 직접 측정된 것이라 이 문제의 영향을 받지 않는다.**

### 2. 확장 애니메이션의 "실제 데스크톱 위에서" 캡처는 1건만 확보

검증 2에서 "확장 완료" 상태의 실제 데스크톱 합성 스크린샷(`S1-v2-01-expanded-full.png`)은 성공했지만, "점 상태"(확장 전)와 "수축 완료" 상태는 위 1번 문제로 계속 실패해 실제 데스크톱 버전을 못 얻었다. `capturePage()` 버전으로 대체했다.

### 3. `backgroundMaterial:'acrylic'`이 실제로 "acrylic" 재질인지, 아니면 다른 material로 폴백된 것인지는 픽셀 비교로만 확인했다

Electron/Windows API가 실제로 요청한 material을 그대로 적용했는지 별도 시스템 API로 검증하지 않았다(Electron이 그런 조회 API를 제공하지 않음). combo b/c의 블러 정도가 서로 육안상 동일하고, combo a(순수 transparent)와는 명확히 다르다는 것으로 "무언가 재질 처리가 적용되고 있다"까지만 확인했다.
