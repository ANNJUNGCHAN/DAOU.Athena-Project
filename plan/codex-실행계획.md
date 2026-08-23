# Codex형 Athena — 실행계획

> 최종 갱신: 2026-08-24 · 브랜치 `main` · 백업 `backup/pre-codex-e852442`
>
> 여기에는 **상태 / 실측 / 다음 수**만 적는다. 설계 근거는 Paper 파일
> "Athena — Codex형 셸 · 알림 오브"(11보드)가 원본이고, 규범은 [`CLAUDE.md`](../CLAUDE.md) §2와
> [`ui/soul.md`](../ui/soul.md)가 원본이다. 중복하지 않는다.
>
> 게이트 원장은 `.unlazy/codex/`에 있다(로컬 조율 상태, 커밋 안 됨). **이 문서가 커밋되는 계획서다.**

---

## 0. 이 작업이 무엇인가

사용자 지시(2026-08-24): Paper의 Codex형 설계를 실제 앱으로 구현하고, 구현하면서 새로 필요해진
UI는 Paper에 먼저 추가한 뒤 진행하며, 결과를 전부 Paper에 저장한다.

Paper 11보드 전부가 스스로 `※ 미구현 — 이 보드는 설계안이다. 구현 착수는 판단서 검토 후
결정한다`를 달고 있었다. **사용자 지시가 그 판단서다.**

---

## 1. 구조 — 무엇이 바뀌고 무엇이 안 바뀌나

| | 옛 구조 (round-1R) | Codex형 |
|---|---|---|
| OS 창 수 | 2 | **2 — 불변** |
| 창의 정체 | 대화 창 + 캔버스 창 | **셸 창 + 알림 오브 창** |
| 입력 지점 | 대화 창 1곳 | 셸 창 우측 채팅 1곳 — **1곳 불변** |
| 출력 지점 | 캔버스 창 | 셸 창 중앙 캔버스 |
| 사이드바 | **즉시 탈락** | 좌측 이력 268px — **접힌다는 조건에서 허용** |
| 설정 | 대화 창 형제 패널 `#settings` | 셸 창 **전체 스왑** |
| 카드 | 12종 고정 | **12종 고정 — 불변** |
| 유리 사다리 | 창 .86 < 카드 .90 < 캔버스 .92 < 창확장 .95 | **동일 — 불변** |
| 액센트 | 화면당 마젠타 1곳 | **동일 — 불변** |

**타협 불가로 남는 것**: 리퀴드 글래스 재료 규범 7개 · "AI 냄새" 금지 목록 · 접근성 3종 ·
12px 하한 · 정보 정직성이 미감보다 위 · `innerHTML` 문자열 삽입 0건 · 주문 자동집행 금지 ·
셀렉터 LLM 노출 툴 정확히 4개 · uvicorn 워커 1개.

**백엔드 신규 작업은 오브에 한해 0건이다.** 오브는 기존 `RoutineFeed`(WS `/api/v1/ws/routines`)를
그대로 탄다 — 본 계획서 §판단서 요지: "기존 능동 턴 데이터 경로를 그대로 태우면 백엔드 신규
작업이 사실상 없다"(`codex형-셸-알림오브-설계-2026-08-22.md:138-139`).

**단, 감시 빌더는 백엔드 신규가 있다.** Paper 보드 10(AT-AG-002)이 빨간 글씨로 적는다:
"소급 시뮬레이션은 계획서에만 있고 백엔드에 없다. 과거 데이터 리플레이 경로를 새로 지어야 한다."
초기 계획에 "백엔드 신규 0건"이라고 적었던 것은 **틀렸다** — 보드 09~11은 원 설계서의 5장 범위
밖에서 나중에 추가된 보드이고, 그중 10이 신규 백엔드를 요구한다. 리프 1.5.2가 이 비용을 진다.

### 이행 중 문서 두 벌이 공존한다

- 옛 구조를 서술하는 문서: [`ui/round-1R/two-windows.md`](../ui/round-1R/two-windows.md)
- 목표 구조: [`CLAUDE.md`](../CLAUDE.md) §2 + Paper 11보드
- **인용할 때 어느 쪽인지 밝혀라.** 이행이 끝나면 `two-windows.md`를 폐기 표시한다.

---

## 2. 실측 상태

**기준선 (2026-08-24, Codex형 착수 직전):**

```
backend  1561 passed, 0 failed, 5 skipped (xdist --dist loadgroup -n auto, 282.05초)
         ruff clean · generate_api.py --check current · fit_dissonance_check exit 0
app      npm test 321 passed, 0 failed
         npm run verify 검증 1~20 전 단언 통과, exit 0
```

**진행분:**

```
leaf-1.1.1 규범 개정 — VERIFIED (2026-08-24)
  G1 runnable: node scripts/gates/check-norms.mjs → exit 0 "norms verification passed"
     개정 전 실행은 exit 1로 12건 누락을 보고했다 — 게이트가 정직하게 실패함을 먼저 확인했다.
     음성 대조군: "창 3개 이상" 탈락 조건과 타협 불가 규범 4종이 살아 있는지 함께 잰다.
  G2 manual: 이행 중 문서 공존 명시 — 이 문서 §1이 증거
```

---

## 3. 트리 — 브랜치 7 · 리프 14

| id | 작업 | 소유 경로 | 상태 |
|---|---|---|---|
| 1.1.1 | 규범 개정 | `CLAUDE.md` `GLOSSARY.md` `ui/soul.md` | **VERIFIED** |
| 1.1.2 | 디자인 토큰 결선 | `app/styles/tokens.css` | READY |
| 1.2.1 | 창 모델 전환 | `app/main.js` `app/lib/main/window-placement.js` `app/preload.js` | READY |
| 1.2.2 | 3영역 레이아웃 | `app/shell.*` | WAITING 1.2.1 |
| 1.2.3 | 카드 12종 이식 | `app/canvas.js` `app/canvas.css` | WAITING 1.2.2 |
| 1.3.1 | 알림 오브 창 | `app/orb.*` `app/lib/main/orb-window.js` | WAITING 1.2.1 |
| 1.4.1 | 설정 모드 스왑 | `app/settings.*` `app/lib/settings-cards.js` | WAITING 1.2.2 |
| 1.4.2 | 불연속 슬라이더 2종 | `app/lib/ui/discrete-slider.js` `app/lib/main/prefs.js` | WAITING 1.4.1 |
| 1.5.1 | 에이전트 모드 스왑 | `app/lib/ui/agent-mode/**` | WAITING 1.2.3 |
| 1.5.2 | 감시 빌더 | `app/lib/ui/agent-mode/**` | WAITING 1.5.1 |
| 1.5.3 | 알림 설정 | `app/lib/ui/agent-mode/**` | WAITING 1.5.1 |
| 1.6.1 | Paper 신규 UI 보드 추가 | Paper 파일(코드 무접촉) | READY |
| 1.6.2 | Paper 실측 반영 정정 | Paper 파일(코드 무접촉) | WAITING 1.2.3 |
| 1.7.1 | verify 검증 갱신 | `app/verify.js` | WAITING 1.3.1, 1.4.2 |
| 1.7.2 | 전 스위트 회귀 | 없음 — 읽기·실행만 | WAITING 1.5.3, 1.6.2, 1.7.1 |

---

## 3-A. 조사가 드러낸 것 (2026-08-24, 에이전트 4종)

**본 계획서는 [`plan/codex형-셸-알림오브-설계-2026-08-22.md`](codex형-셸-알림오브-설계-2026-08-22.md)다**
(Deep Interview Spec, PASSED). 이 문서는 그 계획서의 *구현 단계* 기록이다. 원 계획서의
`Non-Goals`는 "구현은 이번 범위가 아니다. Paper 5장 + 판단서에서 끝난다"였고 —
**사용자 지시(2026-08-24)가 그 범위를 구현까지 연 것이다.**

### 깨지는 것 — 원 계획서가 미리 세어둔 목록 (§Technical Context:120-126)

| 대상 | 근거 |
|---|---|
| `lib/main/window-placement.js` 두 창 짝 배치·`chatOriginX` 중앙 정렬 | 검증11·14 |
| `main.js` `expandCanvasWindow()` / `canvasVisible` | 검증9·9d |
| 대화 창 auto-grow(`chatBaseH`↔`chatMaxH`) · `applyGlassFraction` | — |
| `verify.js` 검증 9·9d·11·14 | 재정의 필요 |
| `npm test` 321건 중 window-placement 계열 | 영향 |

**따라서 리프 1.2.1은 자기가 깨뜨리는 테스트까지 함께 고친다.** 저장소를 빨간 채로 넘기는
리프는 완료가 아니다. `verify.js` 소유권을 1.7.1에서 1.2.1로 옮긴다.

### 확정 필요했던 것 — 드라이버가 정한 것

- **오브 시안**: 보드 06이 6종 중 **D(전환 링·게이지)**를 추천했다(1위, 규범 통과, 76px에서
  형태 유지, 진행률 게이지 겸용). D로 간다. 단 **나머지 5종을 지우지 않는다** — 보드는
  "고르면 나머지를 지운다"고 적었지만, 삭제는 되돌릴 수 없고 랭킹 기록은 YC 프로세스의
  산출물이다(선별이 생성보다 중요하다). D에 확정 표시만 단다.

### 미해결로 남는 문서 모순 2건 (별도 리프로 처리한다)

1. **`ui/palette.md`가 "Athena는 다크 전용"이라고 명문화**하는데 앱은 이미 라이트로 반전됐다
   (`8eb152e`). Paper Codex 파일 토큰도 라이트다(`--color-k-bg #EEF0F4`). palette.md 갱신 필요.
2. **12px 하한이 `ui/` 규범 문서에 없다** — 커밋 메시지에만 존재한다. 명문화 필요.

### 실측 버그 1건 (Paper 보드 08이 보고, 미수정)

`prefs.js`의 `fontSize` 기본값과 렌더러 fallback이 어긋난다(보드 08 빨간 글씨:
"prefs.js는 'xs', 렌더러 fallback은 'md'"). 리프 1.1.2가 확인하고 한 값으로 통일한다.

### 유리 단계 수가 문서마다 다르다

원 계획서 `Constraints:60`은 **3단**(clear/default/opaque), Paper 보드 07은 **5단**
(clear .30 · sheer .58 · default .86 · solid .91 · opaque .96). **보드가 나중이고 더 구체적이므로
5단으로 간다.** 단 보드 07이 빨간 글씨로 경고한다: "새 값 2개는 설계값이다 — .58 · .91은
아직 실측되지 않았다. 구현 후 측정해야 한다." 1.4.2가 구현 후 실측하고 값을 정정한다.

---

## 4. 함정 — 이 작업에서 특히 걸리는 것

- **게이트 `CHECK:`는 `cmd.exe`로 돈다.** Git Bash에서 띄워도 그렇다(2026-08-23 실측).
  bash 문법 금지 — 이식 가능한 단일 Node/Python 호출만 쓴다.
- **`app/canvas.{css,js}`를 건드리면** `backend/ref/kiwoom-screen-render-evidence.json`이
  같이 갱신돼야 한다(`npm run verify` → `capture_screen_render_evidence.py`).
  이걸 빠뜨려 게이트가 빨간 채로 커밋된 전례가 있다(`8eb152e`, 2026-08-24 수정).
- **`npm run verify`는 electron으로 돌린다.** node로 돌리면 안 된다.
- **pytest는 `--dist loadgroup` 필수.** 맨 `-n auto`는 `test_accounts`가 자기충돌한다.
- **`innerHTML` 문자열 삽입 0건을 유지한다** (함정 ⑪ — 저장형 XSS).
- **Paper는 `backdrop-filter`를 렌더하지 않는다.** 목업 프로스트는 사전 블러로 시뮬레이션한다.
- **Paper 그라디언트에 색공간 키워드를 각도와 같이 쓰면 각도가 소실된다.**
  `linear-gradient(158deg in oklab, …)` → 180deg로 뭉개진다. 키워드를 빼고
  `linear-gradient(158deg, …)`로 써야 각도가 산다(2026-08-23 실측,
  `plan/paper-specs/03-Paper-보드-저작-레시피.md`).
- **`write_html`의 style은 케밥케이스다**(원 계획서 Acceptance Criteria:90).
- **콘솔이 cp949다.** 증거는 `ensure_ascii=False` + `encoding="utf-8"`로 **파일에 쓰고 열어서** 확인한다.

---

## 5. 다음 수

1. 조사 4종(ui 규범 · app 기준선 · plan 이력 · Paper 8보드) 회신 → 소유 경로 확정
2. `1.1.2` 토큰 결선과 `1.2.1` 창 모델 전환을 병렬 디스패치(경로 배타)
3. `1.6.1`은 코드와 무관하므로 언제든 병렬 가능
