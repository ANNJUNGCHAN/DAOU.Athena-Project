# Grok 프롬프트 — 카드 표면 버튼 트랙 남은 넷 이어받기 (2026-09-08)

아래 블록을 통째로 복사해 Grok 워커에 붙여넣는다. **worktree 안에서** 실행한다
(`claude/card-buttons-functionality-2b13d9`, PR
[#30](https://github.com/ANNJUNGCHAN/DAOU.Athena/pull/30)). 배경·실측 근거는
[../2026-09-07-card-buttons.md](../2026-09-07-card-buttons.md)가 정본이다.

작업 도구 셋은 [tools/](./tools/)에 있다 — 새로 만들지 말고 그것을 쓴다.

---

```
# 목표

카드 표면 버튼 트랙에서 **남은 넷**을 끝낸다. 이미 끝난 것은 다시 하지 않는다.

# 0. 시작 전에 읽을 것 (추측으로 시작하지 않는다)

1. `docs/handoff/2026-09-07-card-buttons.md` — 단일 진입점. §1~§4가 이미 고친 것(뿌리 원인·
   레일 별칭·카드 액션 3종·회귀 게이트), §5가 남은 것이다.
2. `docs/ui/paper-card-surface-charter.md` — 카드 표면 규칙 정본. §12 상태 전개 관례.
3. `docs/handoff/2026-09-07-paper-parity-verdict.md` §3.4 — Paper 원장·매니페스트 규약.

# 1. 지킬 것 (어기면 게이트가 잡는다)

- **이 worktree 밖 파일은 만지지 않는다.** 본체 체크아웃과 다른 워크트리에 남의 미커밋
  작업이 있다. 병합·stash 금지. 커밋은 경로를 명시해서 한다(`git commit -- <경로>`).
- **생성물은 손으로 고치지 않는다.** `board.html`·`slots.json`·`index.json`·
  `board-templates.*.generated.js`는 `scripts/paper_board_extract.py` →
  `scripts/build_board_registry.py`가 만든다. 손편집하면 `--check`가 드리프트로 잡는다.
- **줄바꿈.** 파일마다 CRLF/LF가 다르다. 편집 전 그 파일의 바이트를 재고 같게 쓴다.
  병합은 `git merge -X ignore-cr-at-eol`. 전수 재추출은 관계없는 보드를 EOL만 바꿔 놓기도
  한다 — 그런 파일은 `git checkout --` 로 되돌린다(내용 동일 확인 후).
- **프로브 전에 좀비 정리.** `taskkill /F /IM electron.exe`. 안 하면 보드마다
  `paint ack wall-clock timeout`이 나고 결함으로 오독한다.
- **Paper.** 쓰기 전 `get_guide(topic="paper-mcp-instructions")`. 원문(JSX·트리)은 세션에
  옮겨 적지 말고 `tools/paper-fetch.py`로 파일에 떨군다. 끝나면 `finish_working_on_nodes`.
- **모집단 수는 네 곳에 박혀 있다.** 보드를 늘리면 `app/scripts/paper-manifest-check.mjs`의
  `TOTAL_BOARDS`, `app/lib/paper-cards-static.test.js`(보드 수·상태 링크 대상 수),
  `app/lib/paper-manifest-check.test.js`(card_template), 매니페스트의 `pages[].boards`를
  같이 고친다. 지금 값: 원장 449 · card_template 101 · 상태 링크 대상 88.

# 2. 할 일 — 이 순서로

## A. 전수 감사로 최종 수치 뽑기 (가장 싸다, 먼저 한다)

```
taskkill /F /IM electron.exe
cd app && node_modules/electron/dist/electron.exe probe-card-buttons.js
```

30~40분. 산출물 `app/captures/paper-gates/CARD-BUTTONS.json`. 판정 규칙은
`app/probe-card-buttons.js` 머리 주석에 있다. `findings`가 비어 있어야 초록이다
(state-control은 전부 반응해야 하고, 자기 보드를 가리키는 칩은 면제된다).
`board_audit_failed`가 뜨면 좀비 electron부터 의심하고 그 보드만 다시 돌린다
(`ATHENA_VERIFY_BOARD_IDS=<board>`, 리포트는 `ATHENA_CARD_BUTTONS_REPORT`로 분리).

결과를 `docs/handoff/2026-09-07-card-buttons.md` §4에 수치로 적는다(반응·inert·보드 수).

## B. 2RJ7-1 「호가 열기」 겹침 (작다, 배선이 아니라 레이아웃이다)

증상: 핸들러는 붙었는데(`__athenaStateWired`) 그 자리 hit test가 이웃 블록
`3A46-0`(「예상 체결 시간」)으로 간다 — 실측 rect x≈1222 y≈568 w≈51 h≈16.
즉 사용자가 그 버튼을 누를 수 없다. 노드: 버튼 잎 `2RJH-1`, 감싼 알약 `2RJG-1`.

1. `ATHENA_VERIFY_BOARD_IDS=2RJ7-1`로 프로브를 돌려 `hit.hit_node`를 재확인한다.
2. 원인을 먼저 밝힌다 — 겹침이 (a) Paper 원문의 자리 문제인가, (b) 반응형 훅이
   `left`를 걷어낸 absolute 상자 문제인가(`board-mount.markInsetAbsoluteBox`),
   (c) 고정 높이 상자를 내용이 뚫은 것인가. `app/styles/board-surface.css`의
   되돌리기 규칙과 `regions.json`을 함께 본다.
3. (a)면 Paper를 고치고 재추출(§C의 절차와 같다). (b)·(c)면 CSS·훅을 고치고
   `verify:paper-cards-mount`로 4폭 전부 통과를 확인한다. **z-index로 덮어 가리지 않는다** —
   겹침은 남고 클릭만 통하는 상태가 되면 §8 정보 정직성에 어긋난다.

## C. 비교 바구니 (Paper 보드는 이미 있다 — 배선이 남았다)

Paper 보드 `49Y4-0` 「CC-06 / R04-S11 · 종목찾기 — 비교 바구니」(페이지 `5-1`,
worldX 41800 · worldY 7343). 왼쪽은 지표가 행·담은 종목이 열인 비교 표, 오른쪽은
바구니 목록(빼기 칩)·추천 담기·「전부 비우기」/「추이 같이 보기」.

**막힌 지점이 둘이다. 순서대로 푼다.**

1. **다중 종목 하이드레이션 계약** — 지금 `app/canvas.js`의 `boardHydrateTarget`은
   `stk_cd`를 **하나**만 싣고, 백엔드 `athena:canvas-board-hydrate`도 단일 대상을 받는다.
   바구니는 3~4종목을 한 보드에 채운다. 계약을 넓히는 것이 **백엔드 결정**이므로
   `backend/athena_api/`의 보드 하이드레이트 경로를 먼저 읽고, 대상 목록을 받는 형태를
   제안한 뒤 사람 확인을 받는다(임의로 넓히지 않는다).
2. **담은 목록을 들 자리** — 클라이언트 바구니 상태가 없다. 카드 액션
   (`app/lib/board-card-actions.js`)에 `비교에 추가`를 더할 때, 그 상태가 어디 사는지
   (세션·대화·카드 인스턴스)부터 정한다. 행 액션이라 누른 줄의 종목을 읽어야 하고
   그 판정은 이미 `rowStock`에 있다.

**보드 추출은 기계적이다** — S12~S16을 그렇게 만들었다. 실측으로 배운 다섯:

- 원문은 **표면 노드**에서 뽑는다(`regions.json`의 `root`). 원장 `.tree.txt`는 **아트보드**에서.
  `python docs/handoff/card-buttons/tools/paper-fetch.py jsx <surfaceNode> backend/ref/card-surface-templates/<board>/paper.jsx`
- `meta.json`의 `state`는 `{kind, parent_board, control, control_text}`. `kind: "expand"`는
  `control_text`를 **반드시** 함께 적는다 — 추출기가 ▸ 잎만 후보로 보다 「후보 없음」으로
  떨어진다. 행마다 같은 문구가 여러 번 있으면 `control_node`로 못 박는다.
- 복제 보드는 노드 id가 새로 생겨 저작 바인딩을 못 물려받는다 →
  `node docs/handoff/card-buttons/tools/port-slots.js <도너> <새 보드...>`
- 늘린 표 행은 `display_dup: true`를 켠다(안 켜면 검사기가 「같은 f가 여러 칸」으로 센다).
  병기 짝(`paired_with`)은 **같은 행 안**을 가리켜야 한다.
- 설명 문구는 `kind: "label"`로 고친다(자동 판정이 value로 보면 런타임에 「미제공」이 뜬다).
  숫자를 지어내 채우지 않는다.

원장·매니페스트: `node docs/handoff/card-buttons/tools/build-ledger.js 5-1 카드 <board>`
→ 매니페스트에 `{id, page:"5-1", name, role:"card_template"}` 추가 + `pages[5-1].boards` 증가
+ §1의 모집단 수 넷 갱신.

## D. 주문 확인 (사람 승인 없이는 손대지 않는다)

`주문 확인`(CC-02 135M-2 계열)은 **실제 주문 집행**이다(`athena:order-execute`).
「정정」·「취소」는 이미 상태 보드로 눌린다. 배선하기 전에 사용자에게 묻는다:
① 확인 버튼이 곧 집행인가, 아니면 확인 화면(상태 보드)까지인가,
② 모의/실계좌 구분을 어디서 막는가. 답을 받기 전에는 코드를 넣지 않는다.

# 3. 끝났다고 말하기 전에 (전부 초록이어야 한다)

```
python scripts/paper_board_extract.py --check          # 0
python scripts/build_board_registry.py --check         # 0
cd app
node scripts/paper-manifest-check.mjs                  # card_template 수 일치
node scripts/paper-cards-static.mjs                    # S1~S6 · 전 보드 통과
ATHENA_VERIFY_BOARD_IDS=<손댄 보드> node_modules/electron/dist/electron.exe probe-paper-cards-mount.js
node_modules/electron/dist/electron.exe probe-card-buttons.js   # findings 0
npm run test:unit                                      # fail 0
python scripts/validate_board_slots.py <손댄 보드>      # 경고 0
```

단계마다 커밋하고 즉시 푸시한다. 커밋 본문은 **무엇을 왜**를 2~5줄로 쓰고 실측 수치를
싣는다. 시연하지 않은 행을 통과로 적지 않는다.
```
