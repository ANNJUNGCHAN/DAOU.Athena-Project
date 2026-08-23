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

**백엔드 신규 작업 0건.** 오브는 기존 `RoutineFeed`(WS `/api/v1/ws/routines`)를 그대로 탄다.

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
- **콘솔이 cp949다.** 증거는 `ensure_ascii=False` + `encoding="utf-8"`로 **파일에 쓰고 열어서** 확인한다.

---

## 5. 다음 수

1. 조사 4종(ui 규범 · app 기준선 · plan 이력 · Paper 8보드) 회신 → 소유 경로 확정
2. `1.1.2` 토큰 결선과 `1.2.1` 창 모델 전환을 병렬 디스패치(경로 배타)
3. `1.6.1`은 코드와 무관하므로 언제든 병렬 가능
