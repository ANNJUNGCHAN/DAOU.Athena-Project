# 화면 P1 구현 명세 (Paper 보드 ↔ 앱)

- 저장소: `C:\Projects\DAOU.Athena`, `main` HEAD `c33ef0a`
- Paper 파일: `01M0VGPX92K1TER4ZV9PWGQJJZ` (페이지 `화면`/`카드`/`에이전트`/`플러그인`/`카드미니`/`키우미`/`백테스트`)
- 판정 근거: `...\tasks\wjnizi90b.output` → `result.confirmed`
- 이 문서는 **읽기 전용 계획**이다. 아래 줄번호는 전부 HEAD `c33ef0a` 실측이다.

## 전역 불가침 계약 (모든 항목 공통)

| 계약 | 위치 | 뜻 |
| --- | --- | --- |
| 키우미 얼굴 1종 | `app/lib/kiumi-face.test.js` | Paper 08 다섯 얼굴 복원 금지 |
| 에이전트 `#chatModeHead` 숨김 | `app/lib/graph-mode/controller.test.js` | 에이전트 모드엔 헤더가 없다 |
| `body`에 `word-break: keep-all` 금지 | G5a overflow-0 게이트 | 절대 넣지 않는다 |
| 실주문 하드락 | `/api/v1/order/*` 금지, `mockapi.kiwoom.com` 고정 | 모든 주문 관련 항목에 적용 |
| `emptyHistory` 부팅 계약 | `app/verify.js:1208-1218` | `#history` 자식 0 + `:empty::before` "새 대화" + 서브텍스트에 "종목"·"캔버스에 카드로 쌓입니다". **채팅 첫 페인트를 건드리는 항목(10·15·16)은 이 단언을 깨면 안 된다.** |
| 기법 카드 v7/거래 수 지어내기 금지 | `paper-parity-remaining.md` | 백테스트 항목(18)에 적용 |
| 설정 4번째 nav 라벨 `성향・이력` | `paper-parity-remaining.md` "Closed this session" | 항목 1이 nav 라벨을 되돌리면 회귀 |

---

## 1. 2UWT-1 — 설정 4번째 카드가 Paper 22 내용이다

### (1) 바꿀 파일과 줄 (HEAD 실측)
- `app/lib/settings-cards.js:137-144` — `NAV_ITEMS`. 4번째 항목 `{ key: 'history', label: '성향・이력', statusFn: … }`. 위 주석이 `// Paper 보드 22 — 그래프 수집·노출 설정`이라고 스스로 밝힌다.
- `app/lib/settings-cards.js:1304-1358` — `refreshHistoryCard()`. 머리 `그래프 수집과 노출` / `무엇을 읽고 누구에게 보일지`(:1309-1312), 토글 4종(:1319-1337), 위험 안내 + 전체 삭제(:1339-1352).
- `app/chat.js:1590-1594` — `SETTINGS_PANELS.history = settingsCards.renderHistory`.

### (2) Paper가 요구하는 정확한 문구 (2UZO-1 원문)
머리 `성향·이력` (2UZM-1) + `로컬 보관 · 언제든 내보내기 가능` (2UZN-1). 본문 2블록:

**투자 성향**
- 리드 박스: `장기 ETF 적립형` / 우측 `대화에서 학습됨`
- 설명: `지수 ETF 위주로 장기 적립하고, 개별 종목은 반도체 대형주를 관찰합니다. 답변은 차분한 설명을 선호합니다.`
- 행: `위험 성향` ↔ `안정 추구` / `주요 관심` ↔ `지수 ETF · 반도체` / `성향 반영` ↔ `켜짐 · 답변 어조에만 사용`

**대화 이력**
- `보관 중` ↔ `대화 128건 · 42MB`
- `보존 기간` ↔ `90일 · 이후 자동 정리`
- 버튼 2개: `이력 내보내기`(테두리) / `전체 삭제`(bg `#FBF1F1`, border `#E8C9C9`, text `--color-up`)
- 발치: `삭제는 확인 단계를 한 번 더 거치며 되돌릴 수 없습니다`

### (3) 변경 내용
**결정이 먼저 필요하다(사용자 선택).**
- (a) **성향·이력 복원**: `refreshHistoryCard`를 두 섹션 카드로 재구성 — 위에 투자 성향(백엔드 `athena:brain-profile-summary` 실값, 없으면 행 자체를 안 그림 = 지어내기 금지) + 대화 이력(보관 건수·용량·보존 기간), 아래에 기존 수집 토글 4종을 별도 섹션으로 내린다. `이력 내보내기` 액션은 새 IPC(`athena:history-export`)가 필요하다.
- (b) **현행 유지**: nav 라벨은 `성향・이력`으로 두되(잠금 계약), 카드 머리를 라벨과 맞추고 `PAPER_APP_PARITY.md:45-46`의 "21·22 둘 다 적용" 표기를 정정한다.

**둘 중 어느 쪽이든 지어낸 수치(128건·42MB·90일)를 하드코딩하면 안 된다.** 백엔드가 값을 못 주면 그 행을 그리지 않는다.

### (4) 잠글 단위 테스트 — `app/lib/settings-cards.test.js`
- `test('성향·이력 카드는 백엔드가 준 값만 행으로 만든다 — 없는 값은 행이 없다')`
  단언: `buildHistoryCardModel({ profile: null, storage: null })` 의 `rows.length === 0`, `sections`에 지어낸 문구가 없다.
- `test('보관 건수·용량이 오면 Paper 라벨 그대로 나온다')`
  단언: `rows`가 `['보관 중', '대화 128건 · 42MB']`·`['보존 기간', '90일 · 이후 자동 정리']` 쌍을 포함.
- (b)안이면 대신: `test('설정 4번째 카드 머리는 nav 라벨과 같은 말을 한다')` — `NAV_ITEMS[3].label`과 카드 머리 텍스트가 일치.

> 참고: 현재 `settings-cards.test.js`는 `readGraphSettings`/`writeGraphSettings` 순수 로직만 잰다. DOM 검증은 `verify-settings-cards.js`(Electron)가 담당하므로, 새 카드 모델은 **순수 함수(`buildHistoryCardModel`)로 뽑아** node --test로 재는 것이 이 파일의 기존 규율과 맞는다.

### (5) 부작용 위험 / 건드리면 안 되는 계약
- `paper-parity-remaining.md` "Closed this session": **NAV_ITEMS의 history 라벨 `성향・이력`은 되돌리면 회귀다.**
- `updateGraphNavBadge()` / `exposeToModel` 배지(`settings-cards.test.js:65`)는 그대로 살아 있어야 한다.
- `collectChat` 미러링 실패 복원 경로(:126, :140 테스트)는 토글을 어느 섹션으로 옮기든 유지.

### (6) 크기 / 의존
- **M** ((a)안이면 IPC 추가로 L). 선행: 사용자 결정. 독립.

---

## 2. COS-0 — 그래프 모드 빈 작업공간 히어로가 뜰 수 없다

### (1) 바꿀 파일과 줄
- `app/canvas.js:385-397` — `.canvas-empty-graphmode` 상자를 만들어 `gridEmptyEl`에 붙인다(`:397 gridEmptyEl.append(chatBox, graphBox)`).
- `app/canvas.js:394` — `'그동안 나눈 대화와 체결로 성향은 계속 쌓이고 있습니다'` (저장소 전체 유일 출처).
- `app/canvas.js:428-447` — `appendEmptyCanvasExtras()` (엔티티/군집 수, 확인 필요 건수).
- `app/shell.html:160-165` — `#gridEmpty`가 `#mosaic`의 자식.
- `app/lib/graph-mode/controller.js:356` — `elements.summary.hidden = graphView || activeSurface !== 'summary'` (`elements.summary` = `#mosaic`, `app/canvas.js:2500`).
- `app/canvas.css:1271-1272` — `#canvasRegion:not([data-mode="graph"]) .canvas-empty-graphmode { display:none }` → 도달 불가 죽은 규칙.
- 붙일 곳: `app/shell.html:203-222` `#graphSummaryMain` 안, `#graphSummaryTableArea`(:214) 옆. 렌더러는 `app/lib/graph-mode/summary-table.js:295-331` `renderSummaryTable()`.

### (2) Paper 원문 (COS-0 › CRJ-0)
- 캡션: `그래프 모드 — 요약 뷰 히어로`
- 카드 560×340, `bg-k-panel`, radius 16, shadow `#10131A0F 0 6px 18px`, border `#10131A14`
- 삽화: 5노드 4엣지 별자리 SVG 120×72 (노드 `#10131A4D`/`#10131A85`, 엣지 `#10131A47` 1.5px)
- 제목 17px `Daki B` `#10131AEB`: `그동안 나눈 대화와 체결로 성향은 계속 쌓이고 있습니다`
- 2줄 `Daki` `#10131A99` 13px: `엔티티 N · 테마 군집 N` / `확인이 필요한 것 N건이 기다리고 있습니다`

### (3) 변경 내용
1. `.canvas-empty-graphmode` 상자를 `#gridEmpty`에서 떼어 `#graphSummaryMain` 소유로 옮긴다(빌드 함수는 `canvas.js`에 남기고 마운트 대상만 바꾸거나, `lib/empty-canvas.js`로 순수 빌더를 이관).
2. `renderSummaryTable()`이 `entries.length === 0`일 때 표 대신 이 히어로를 그린다(`summary-table.js:295` 진입부에서 분기).
3. `appendEmptyCanvasExtras(stats, hintCount)`가 새 위치에 붙도록 셀렉터 갱신(`canvas.js:434`의 `gridEmptyEl.querySelector`).
4. `canvas.css:1271-1272` 두 규칙 중 그래프 분기를 삭제하고 대화 변형 한쪽만 남긴다.

### (4) 잠글 단위 테스트 — `app/lib/graph-mode/summary-table.test.js`
- `test('요약 표가 0건이면 성향 축적 히어로를 그린다 — 백지로 두지 않는다')`
  단언: `renderSummaryTable(container, [], {})` 뒤 `container.querySelector('.canvas-empty-graphmode')` 존재, 그 안 제목 `textContent === '그동안 나눈 대화와 체결로 성향은 계속 쌓이고 있습니다'`.
- `test('요약 표가 1건 이상이면 히어로 대신 표가 선다')`
  단언: `.summary-table` 존재 && `.canvas-empty-graphmode` 없음.
- `app/lib/empty-canvas.test.js`에 추가: `test('그래프 히어로 수치는 stats가 있을 때만 붙는다')` — `stats=null`이면 `엔티티` 문자열이 없다.

### (5) 부작용 위험 / 계약
- `#mosaic`의 `hidden` 소유자는 **`graph-mode/controller.js` 단독**이다(`canvas.js:3901` 주석 US-007). 히어로를 옮기더라도 `hidden`을 canvas.js에서 만지면 안 된다.
- 대화 모드 빈 화면(`.canvas-empty-chat`, 45초 회전 `applyEmptyCopy`)은 그대로 `#gridEmpty`에 남는다. `empty-canvas.test.js:36`의 `pickEmptyCopy` 결정성 테스트를 건드리지 않는다.
- `#graphSummaryTableArea` 컨테이너를 통째로 비우는 규율(`summary-table.js:67`)이 `#graphPanel`을 지우지 않는 구조적 이유가 있다 — 히어로를 `#graphSummaryMain` **직속**이 아니라 `#graphSummaryTableArea` 안에 넣어야 이 분업이 유지된다.

### (6) 크기 / 의존
- **M**. 항목 8(같은 그래프 모드 표면)과 같은 파일군을 만지므로 **8보다 먼저** 하거나 한 벌로 묶는다.

---

## 3. 2V27-1 — 사이드바 검색이 결과 패널을 만들지 않는다

### (1) 바꿀 파일과 줄
- `app/lib/sidebar.js:638-642` — 현재 검색 = 제목 부분일치 필터 (`c.title.toLowerCase().includes(q)`), 결과를 기존 `프로젝트`/`최근` 섹션에 흘린다.
- `app/lib/sidebar.js:994-1003` — `$searchToggle` / `$searchInput` 배선 (`renderList()`만 호출).
- `app/shell.html:96` — `placeholder="대화 검색"`.

### (2) Paper 원문 (2V27-1 › 2V28-1 `검색 패널`, 440px, `bg-k-panel`, border `#10131A24`, radius 12, padding 14, gap 12)
- 머리 행(38px, border `--color-k-line`, radius 10): 좌 입력값 `삼성전자`, 우 힌트 `대화·카드 검색` (10px mono, `--color-k-hint`)
- 그룹 머리(10px mono, `--color-k-dim`): `대화 2건`
  - 행 38px `bg-k-panel3`: `삼성전자 3개월 차트 보여줘` ↔ `오늘 09:41`
  - 행 38px: `삼성전자 수급 누가 사는지 알려줘` ↔ `어제`
- 그룹 머리: `캔버스 카드 1건`
  - 행 38px: `차트 · 삼성전자 일봉` ↔ `이 대화`
- 발치(상단 border `--color-k-line-soft`, padding-top 6): 좌 `↑↓ 이동 · Enter 열기 · Esc 닫기`, 우 `3건` (둘 다 10px mono, `--color-k-hint`)

### (3) 변경 내용
1. 검색을 목록 필터가 아닌 **별도 오버레이 패널**로 올린다. 새 순수 모듈 `app/lib/sidebar-search.js`에 `buildSearchResults({ conversations, cards, query, now })`를 두고 `{ groups: [{ label:'대화 2건', rows:[{title, when}] }, …], total, hint:'↑↓ 이동 · Enter 열기 · Esc 닫기' }`를 반환.
2. 상대시각 포매터: `오늘 HH:MM` / `어제` / `이 대화`.
3. `shell.html:96`의 placeholder를 `대화·카드 검색`으로. **단, 카드 검색 원천이 없으면** placeholder도 `대화 검색`으로 두고 캔버스 카드 그룹을 그리지 않는다(0건을 지어내지 않는다).
4. 키보드: ↑↓ 행 이동, Enter 열기, Esc 닫기. `sidebar.js:989-991`의 기존 전역 Escape 핸들러(`closeCompactPanel`)와 충돌하지 않게 패널 열림 상태를 먼저 소비한다.

### (4) 잠글 단위 테스트 — 신규 `app/lib/sidebar-search.test.js` (기존 `sidebar-mode-nav.test.js`와 같은 순수 모듈 규율)
- `test('그룹 머리는 Paper 문구와 건수 형식을 지킨다')` — `groups[0].label === '대화 2건'`.
- `test('결과가 없는 그룹은 만들지 않는다 — 0건을 지어내지 않는다')` — 카드 0건이면 `groups`에 `캔버스 카드` 그룹 없음.
- `test('총 건수는 모든 그룹 행 수의 합이다')` — `total === 3`.
- `test('상대시각은 오늘 HH:MM · 어제 · 이 대화 세 형태만 낸다')` — 고정 `now`로 결정적 단언.
- `test('키보드 안내 문구는 Paper 원문 고정이다')` — `hint === '↑↓ 이동 · Enter 열기 · Esc 닫기'`.

### (5) 부작용 위험 / 계약
- 현행 검색은 **현재 모드의 대화만** 거른다(`sidebar.js:634-637`, `SessionSnapshot.viewToMode`). 이 모드 경계는 의도적 규율("목록에 없는 것이 검색으로만 튀어나오면 어느 모드를 보는지 흐려진다", :630-632 주석)이므로 패널로 올려도 유지한다.
- `sidebar-project-menu.test.js`·`agent-sidebar-list.test.js`가 잡고 있는 목록 렌더 경로를 건드리지 않는다.
- Escape 전역 핸들러를 가로채면 compact 패널 닫기가 죽는다.

### (6) 크기 / 의존
- **M**. 독립.

---

## 4. FPE-0 / FLM-0 / XI-0 — 계좌 등록 3상태 (확인 중 · 실패 · 확인 완료)

### (1) 바꿀 파일과 줄 — 전부 `app/lib/settings-cards.js`
| 줄 | 지금 |
| --- | --- |
| `:553` | `function openAccountRegisterSheet(card, onDone)` |
| `:632` | 정적 힌트 1회 append — `'검증에 실패하면 저장하지 않는다 — 인증 실패 / 네트워크 / 레이트리밋을 구분해 표시한다'` (열자마자 항상 떠 있다) |
| `:637-642` | `cancelBtn` → `wipeSecretInputs()` + `detachSheet` |
| `:644` | `const submitBtn = button('primary', '검증 후 저장', { onClick: onSubmit })` — 라벨 고정 |
| `:649-655` | `wipeSecretInputs()` 정의 (별칭·APP KEY·SECRET KEY·힌트 2개 전부 비움) |
| `:657-693` | `onSubmit()` |
| `:666-668` | `statusText = '토큰 발급 확인 중…'` + `submitBtn.disabled = true` (입력 잠금 없음) |
| `:672` | `invoke('athena:account-register', { alias, appKey, secretKey })` — 검증+저장 한 번 |
| `:678` | **`wipeSecretInputs()` — 성공/실패 판정 이전에 무조건 호출** |
| `:687-690` | `res.ok` → `detachSheet` + `onDone()` 즉시 종료 |
| `:692` | 실패 → `errorNote(accountErrorMessage(res.error))` |
| `:544` | `accountErrorMessage(code)` |

### (2) Paper가 요구하는 정확한 문구/상태

**XI-0 (15 · 확인 중)**
- 상태 행 텍스트(노드 `113-0`): `토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다`
- 기본 버튼(노드 `11B-0`): `확인 중…` — 비활성 `bg #ECEEF2` · `text-k-faint`
- 세 입력: `bg-k-panel3` / `border-k-line-soft` / `text-k-faint` (잠긴 표면)

**FLM-0 (16 · 인증 실패, 노드 `FM0-0`)**
- APP KEY 힌트 유지: `붙여넣음 · 36자` / SECRET KEY 힌트 유지: `붙여넣음 · 180자` — **두 마스크 값 모두 남아 있다**
- SECRET KEY 입력 테두리: `border-warn`
- 안내문: `검증에 실패해 저장하지 않았습니다. 키를 수정한 뒤 다시 검증할 수 있습니다`
- 오류 박스: `인증 실패 — APP KEY 또는 SECRET KEY를 확인해 주세요` (bg `#FF983824`, border `#FF98386B`, text `--color-warn`)
- 기본 버튼: `다시 검증` (brand)

**FPE-0 (17 · 확인 완료, 노드 `FPS-0`)**
- 안내문: `확인이 완료되었습니다. 저장하면 OS 자격증명 저장소에 암호화됩니다`
- 성공 박스: `확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다` (bg `#EAF7EF`, border `#B7DEC5`, text `#247A44`)
- 기본 버튼: `계좌 저장` (brand)

세 보드 공통 우측 열 `저장·표시 원칙` 4줄(`OS 자격증명 저장소(Windows DPAPI)에 암호화 저장한다` / `저장 후에는 화면에 다시 표시하지 않는다` / `앱 로그에도 남기지 않는다` / `폐기는 삭제 한 번으로 끝난다`)은 세 상태에서 동일하다 — 지금 앱에도 있으므로 유지.

### (3) 변경 내용
시트를 **4상태 머신**(`idle` → `verifying` → `failed` | `verified` → 저장)으로 만든다.

1. `:632`의 정적 힌트를 상태별로 갈아 끼우는 `hintEl`로 바꾼다.
   - `idle`: `모의투자 계좌의 APP KEY / SECRET KEY로 연결 권한을 확인합니다` (또는 XI-0의 `APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다`를 verifying에만)
   - `verifying`: `토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다`
   - `failed`: `검증에 실패해 저장하지 않았습니다. 키를 수정한 뒤 다시 검증할 수 있습니다`
   - `verified`: `확인이 완료되었습니다. 저장하면 OS 자격증명 저장소에 암호화됩니다`
2. `submitBtn` 라벨을 상태로 계산: `검증 후 저장` → `확인 중…`(disabled) → `다시 검증` / `계좌 저장`.
3. **XI-0 잠금**: `onSubmit` 진입 시 `aliasInput.disabled = appKeyField.input.disabled = secretKeyField.input.disabled = true` + `is-locked` 클래스, 응답 뒤 해제.
4. **FLM-0 재검증**: `:678`의 무조건 `wipeSecretInputs()`를 제거하고 **성공 경로(:687-690)와 취소 경로(:640)에서만** 부른다. 실패 시 값 유지 + 힌트(`붙여넣음 · N자`) 유지 + `res.error === 'auth'`면 SECRET KEY(및 APP KEY) 입력에 `is-error`(border `--color-warn`) 부착.
5. **FPE-0 분리**: `res.ok`에서 시트를 닫지 말고 `verified` 상태로 전환(성공 박스 + `계좌 저장` 버튼). 저장은 별도 확정 동작.
   - IPC가 검증/저장 분리를 지원하지 않으면: `athena:account-register`에 `dryRun` 플래그를 추가하거나, 최소한 저장 완료 확인 상태를 시트 안에서 한 번 보여준 뒤 닫는다(닫기 직전 `wipeSecretInputs()` 유지).

### (4) 잠글 단위 테스트 — `app/lib/settings-cards.test.js` (상태 머신을 순수 함수 `accountSheetState(prev, event)`로 뽑는다)
- `test('확인 중에는 입력 셋이 잠기고 버튼 라벨이 확인 중…이다')`
  단언: `state.inputsDisabled === true && state.submitLabel === '확인 중…' && state.submitDisabled === true && state.hint === '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다'`.
- `test('인증 실패는 입력을 비우지 않는다 — 다시 검증이 가능하다')`
  단언: `state.wipeInputs === false && state.submitLabel === '다시 검증' && state.hint.startsWith('검증에 실패해 저장하지 않았습니다')`.
- `test("실패 코드가 auth면 SECRET KEY에 오류 테두리가 붙는다")`
  단언: `state.errorFields.includes('secretKey')`.
- `test('검증 성공은 시트를 닫지 않고 확인 완료 상태로 간다')`
  단언: `state.closeSheet === false && state.successBox === '확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다' && state.submitLabel === '계좌 저장'`.
- `test('계좌 저장을 눌러야 시트가 닫히고 그때 입력을 비운다')`
  단언: `state.closeSheet === true && state.wipeInputs === true`.

### (5) 부작용 위험 / 계약
- **보안 규칙 불가침**: 시트를 닫을 때(취소·저장 완료)는 반드시 값을 비운다. `onSubmit` 주석(:658-660)이 말하는 "invoke 인자로 넘긴 직후 즉시 비운다"는 규율을 **완화**하는 변경이므로, 실패 상태에서 값이 화면에 남아 있는 시간이 늘어난다 — 시트가 열려 있는 동안만이라는 경계를 주석으로 명시하고, 마스크(`••••`)는 계속 유지한다.
- `res.ok` 뒤 `onDone()`을 호출하던 시점이 바뀐다 → `renderAccounts`의 목록 새로고침(:423 `refresh`)이 저장 시점에 걸리도록 옮겨야 한다.
- `verify-settings-cards.js`(Electron)가 이 시트를 훑는다면 캡처 이름(`SETTINGS-04-accounts-register-sheet.png`)과 단언을 함께 갱신.

### (6) 크기 / 의존
- **L**. 항목 5(계좌 전환 진입로)와 같은 설정·계좌 표면 — 한 트랙으로 묶어도 좋지만 파일은 다르다(5는 `auth-screen.js`/`sidebar.js`). 독립 진행 가능.

---

## 5. 1M3-0 — 계좌 전환 화면이 배포 앱에서 도달 불가

### (1) 바꿀 파일과 줄
- `app/lib/auth-screen.js:290` — `if (embedded || view === 'switch') return;` (`openSwitch` 진입 가드)
- `app/lib/auth-screen.js:136-140` — `if (!embedded) { accRow.classList.add('is-clickable'); … addEventListener('click', openSwitch) }`
- `app/chat.js:614-616` — `authScreen.renderAuthTokenStatus($onboardBody, { accountId, embedded: true, … })` — **유일한 호출자**
- `app/lib/sidebar.js:1043-1052` — 계정 메뉴 `계좌 전환` 항목이 `openSettingsBridge()`를 부른다(:1051)
- `paintSwitch()`는 이미 문구까지 구현돼 있다 — 새로 그릴 것 없음.

### (2) Paper 원문 (1M3-0, kicker `3 / 3`)
- 경고(노드 `1O5-0`, 좌측 3px `bg-warn` 바 + 13px `--color-k-soft`):
  `전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다.`
- 계좌 목록 `1NE-0` → 4단계 흐름 `1O8-0` → 확정 버튼 `1OM-0` `전환하고 다시 인증`
- 진입 근거: `1I0-0 > 1JV-0` 노드명이 `uk-lrow (클릭 → 계좌 전환)`

### (3) 변경 내용
가장 작은 변경: `sidebar.js:1051`의 `계좌 전환` 클릭이 `openSettingsBridge()` 대신 `auth-screen`을 `embedded: false`로 띄우게 한다.
- 새 진입 함수(예: `openAccountSwitchScreen(accountId)`)를 `chat.js`에 두고 `window.AthenaLib` 혹은 브리지로 노출.
- 대안: 설정 계좌 카드의 행 클릭 전환(`settings-cards.js:483-489`)에 Paper 경고문 + 4단계 흐름 + `전환하고 다시 인증`을 붙인다(안전 장치를 그쪽에서 살림).

### (4) 잠글 단위 테스트
- `app/lib/onboarding-flow.test.js`(기존, `embedded: true` 4곳을 잡고 있다)에 추가:
  `test('embedded=false로 열면 계좌 행 클릭이 계좌 전환 뷰로 간다')`
  단언: `renderAuthTokenStatus(host, { embedded: false })` 뒤 `host.querySelector('.auth-status-rows .is-clickable')` 존재, 클릭 후 `host.textContent`가 `전환하면 지금 토큰을 폐기하고`를 포함.
- `test('embedded=true(온보딩)에서는 여전히 계좌 행이 클릭되지 않는다')` — 회귀 방지.

### (5) 부작용 위험 / 계약
- **온보딩 3/3 화면은 `embedded: true`를 유지해야 한다.** `chat.js:616`을 바꾸면 온보딩 흐름이 깨진다 — 새 호출자를 추가하는 것이지 기존 값을 뒤집는 게 아니다.
- 사이드바 계정 메뉴의 다른 항목(`usage`, `settings`)은 `openSettingsBridge()`를 그대로 쓴다.
- 실시간 구독 재등록은 백엔드 계약이다 — 화면만 붙이고 실제 폐기·재발급 IPC가 없으면 경고문이 거짓이 된다. `paintSwitch`가 이미 쓰는 IPC 존재 여부를 먼저 확인할 것.

### (6) 크기 / 의존
- **S**. 독립. (항목 4와 같은 "계좌" 트랙이지만 파일이 다르다.)

---

## 6. AJ-0 — 설정 오버레이가 셸을 가리지 않는다

### (1) 바꿀 파일과 줄
- `app/chat.js:1581-1585` — `openSettings()`: `$app.hidden = true; $settings.hidden = false;` — **`#shell`은 그대로 남는다**
- `app/chat.css:1587-1596`, `1617-1620` — `.settings-nav` 배경 `rgb(255 255 255 / 2%)` · 테두리 `rgb(255 255 255 / 5%)` · 선택 `rgb(255 255 255 / 7%)` (다크 테마 잔재)
- `app/styles/tokens.css:41` — `--color-k-text: #14171d`
- 처방 선례: `app/shell.css:3394-3397` `#shell.is-onboarding-hidden { display: none !important }`

### (2) Paper 원문 (AJ-0)
- `Shell 창 · 설정 모드 (#settings)` = **1520×760 창 전체**. 뒤에 사이드바·대화 열이 없다.
- `settings-nav`(AY-0): `background-color #FFFFFF59`, `border-color #10131A0D` — 보이는 흰 패널
- 선택 항목(B1-0): `background-color #10131A12` — 어두운 틴트

### (3) 변경 내용
1. `openSettings()`/`closeSettings()`에서 `#shell`에 `is-settings-hidden` 클래스를 토글(온보딩과 같은 처방). 또는 `#settings`를 불투명 재질로 올린다.
2. `.settings-nav` 배경을 `rgb(255 255 255 / 35%)`(=`#FFFFFF59`), 테두리를 `rgb(16 19 26 / 5%)`(=`#10131A0D`)로.
3. `.settings-nav-item.is-selected` 틴트를 `rgb(16 19 26 / 7%)`(=`#10131A12`)로.

### (4) 잠글 단위 테스트
DOM/CSS 계약이라 순수 테스트가 얇다. `app/lib/settings-surface-layout.test.js`(기존)에 추가:
- `test('설정 오버레이가 열리면 셸이 숨김 클래스를 받는다')`
  단언: `applySettingsVisibility({ open: true })` 결과 `{ shellHidden: true, appHidden: true }`.
- `test('설정 nav 선택 틴트는 어두운 색이다 — 다크 잔재(흰 7%)가 아니다')`
  단언: `chat.css`를 읽어 `.settings-nav-item.is-selected` 규칙에 `255 255 255`가 없고 `16 19 26`이 있다. (`controller.test.js:229-238`이 CSS 파일을 읽어 단언하는 기존 방식과 같은 문법.)

### (5) 부작용 위험 / 계약
- `#shell`을 숨기면 사이드바가 유지하던 상태(스크롤·검색 열림)가 재표시 때 복원돼야 한다 — `display:none`은 상태를 지우지 않으므로 안전하지만, 사이드바 리사이즈 옵저버가 0폭을 관측할 수 있다.
- 온보딩의 `is-onboarding-hidden`과 **다른 클래스**를 써야 두 경로가 서로 켜고 끄지 않는다.
- 항목 1이 설정 카드 내용을 바꾸므로 캡처(`app/captures/live-full-settings.png`) 재촬영은 두 항목 후에 한 번만.

### (6) 크기 / 의존
- **S**. 독립. 항목 1과 같은 설정 표면이라 캡처 갱신은 묶는다.

---

## 7. 5EU-0 — 셸이 보이면 오브 창을 통째로 숨긴다 / 최소화가 표시 모드를 뒤집는다

### (1) 바꿀 파일과 줄
- `app/lib/main/orb-window.js:157-165` — 주석 「최소화는 Electron에서 isVisible() 결과와 무관하게 명시적으로 키우미 표시 상태다」 + `shouldShowOrbForShell()`: `return shellWin.isMinimized() || !shellWin.isVisible();`
- `app/lib/main/orb-window.js:172-178` — `syncOrbVisibility()`: `shouldShow`가 false면 `orbWin.hide()`
- `app/main.js:302-307` — `broadcastShellVisibility()`가 **같은 값**으로 `athena:shell-visibility` 송신과 창 가시성 동기화를 함께 한다
- `app/main.js:483-485` — `['show','hide','minimize','restore']` 전부 `broadcastShellVisibility`에 배선
- `app/orb.js:852-855` — `hidden`으로 `applyMode`
- `app/main.js:620-626` — 셸이 보이는 중의 루틴 발화는 OS 토스트 + 셸 카드로만
- 게이트: `app/lib/main/orb-window.test.js:185-192`(hide 고정), `:203-211`(최소화→표시 고정), `app/verify-kiumi.js:196-206`(DISPLAY B를 렌더러 DOM으로만 잰다)

### (2) Paper 원문
- `5FX-0`: `셸이 보이는 동안 오브는 알림 전용이다. 입력줄 없이 발화·대표 카드·셸로 가기만 제공한다.`
- `53L-0`(보드 04⑦): `입력줄과 컨트롤 스트립이 통째 사라진다. 오브와 대화 금지 — 진행 경로는 '셸로 가기' 하나다.`
- `5EX-0`: `최소화·가려짐은 표시 모드를 바꾸지 않는다.`
- `5GV-0`: `작업 표시줄에 남아 있으면 아직 셸을 쓰는 중이다. 오브는 알림 전용에 머문다.`
- `24M-0`(보드 01 캡션): `알림 전용(셸 표시)에서는 세 조각까지`

### (3) 변경 내용
**표시 모드 판정과 창 가시성 판정을 서로 다른 술어로 분리한다.**
1. `shouldShowOrbForShell(shellWin)`(창 가시성)와 새 `orbDisplayMode(shellWin)`(A=미니 채팅 / B=알림 전용)를 나눈다.
   - 모드 B 조건: `shellWin.isVisible() || shellWin.isMinimized()` (최소화는 여전히 "셸을 쓰는 중")
   - 모드 A 조건: `!isVisible() && !isMinimized()` (닫기-백그라운드 숨김만)
2. 루틴 발화·복원 실패가 오면 셸이 보이는 동안에도 `orbWin.showInactive()`로 알림 전용 패널(문장 1 · 대표 카드 1 · `셸로 가기`)을 실제로 띄우는 경로를 만든다.
3. `broadcastShellVisibility`가 보내는 `{ hidden }` 페이로드를 `{ hidden, displayMode }`로 넓혀 `orb.js:852-855`가 모드를 별도 값으로 읽게 한다.

**`scripts/gates/check-orb.mjs` 계약 판정:** 이 게이트는 `orb.html`의 **정적 DOM**만 잰다 — 입력창은 `#orbInput` 하나까지(:97-104), `contenteditable` 금지(:107), 익명 input 0개(:102). 판정: **이 계약은 그대로 유지된다.** 알림 전용 패널을 띄우는 것은 입력창을 추가하는 것이 아니라 `#orbInputStack`을 `hidden`으로 두는 것이므로, 게이트가 재는 "살아있는 입력창은 최대 하나"는 깨지지 않는다. 다만 :11-15의 머리말("셸이 보이는 동안은 오브에 입력이 없다")은 이 변경 뒤에도 참이어야 하므로, **모드 B에서 `#orbInputStack.hidden === true`를 새 단위 테스트로 못박아야 한다.**

### (4) 잠글 단위 테스트 — `app/lib/main/orb-window.test.js`
- `test('표시 모드: 최소화된 셸은 여전히 알림 전용(B)이다 — 미니 채팅으로 뒤집히지 않는다')`
  단언: `orbDisplayMode(fakeShellWindow({ visible: false, minimized: true })) === 'B'`.
- `test('표시 모드: 닫기-백그라운드로 숨은 셸에서만 미니 채팅(A)이다')`
  단언: `orbDisplayMode(fakeShellWindow({ visible: false, minimized: false })) === 'A'`.
- `test('알림 전용 패널 요청은 셸이 보이는 동안에도 창을 띄운다')`
  단언: `syncOrbVisibility(visibleShell, orb, { alert: true })` 뒤 `orb.calls` 가 `['showInactive']`.
- `app/verify-kiumi.js:196-206` 갱신: `record(...)` 단언에 `orbWin.isVisible()`을 함께 재는 항목 추가 — 지금은 렌더러 DOM만 봐서 이 구멍을 통과시킨다.
- **기존 테스트 갱신 필요**: `:185-192`(hide 고정)와 `:203-211`(최소화→표시 고정)은 창 가시성 테스트로 남기고, 모드 테스트를 새로 추가한다. `:203-211`의 이름이 "표시한다"라 오해를 부르므로 "native 창은 뜬다(표시 모드는 B 유지)"로 문구를 정정.

### (5) 부작용 위험 / 계약
- `app/docs/handoff/kiumi/deep-interview-spec.md:44`가 「셸이 보이면 키우미는 알림 전용 … Paper 보드 05의 두 모드 규칙은 바뀌지 않는다」라고 적어 두었다 — 앱이 문서를 어기고 있다. 문서를 고칠 게 아니라 코드를 문서/Paper에 맞춘다.
- **결정 필요**: 최소화를 모드 전환에서 제외하지 않기로 한다면 `PAPER_DESIGN_AUDIT.md` 결정 로그에 날짜와 함께 남기고 Paper `5GV-0`을 고쳐야 한다(정본 두 개가 동시에 서면 안 된다).
- `alwaysOnTop` 오브가 셸 위로 튀어나오는 시점이 늘어난다 — `showInactive()`(포커스 뺏지 않음)를 반드시 쓴다.

### (6) 크기 / 의존
- **M** (결정 포함). 선행: 최소화 규칙 사용자 결정. 항목 20(카드미니)과 같은 오브 트랙이지만 파일이 다르다.

---

## 8. 2QCN-2 — 그래프 요약 백지 / 교차 엣지 전량 핑크

### 8-A. 브레인 미기동 시 요약 탭이 백지

#### (1) 바꿀 파일과 줄
- `app/lib/graph-mode/controller.js:395-402` — `renderUnavailable(message)`가 **`elements.graphBody`에만** 그린다
- `app/lib/graph-mode/controller.js:357` — `elements.graph.hidden = !graphView || state.surface !== store.SURFACE_MAP` → 기본 표면이 `summary`라 `#graphCanvas`(→`#graphBody`)는 hidden
- `app/canvas.js:3893-3917` — 브레인 미준비면 `setAvailable(false)`(:3898) 뒤 프리페치(`graphSummaryTable.load()`, :3905-3910)를 **건너뛴다** → 요약 5칸이 전부 빈다
- `app/shell.html:203-222` — `#graphSummaryMain` 안의 5칸(`#graphSummaryHero`·`#graphConfirmBanner`·`#graphSummaryTableArea`·`#graphThemeClusters`·`#graphHiddenLinks`), `:261` `#graphBody`
- 게이트: `app/lib/graph-mode/controller.test.js:229-238` — 「안내는 `#graphBody` 범위만 채운다」를 CSS로 단언

#### (2) Paper 원문 (2QCN-2 › 2QFI-2 행)
- 화면이 하는 말(`2QFK-2`): `"아직 성향을 읽을 수 없습니다 — 브레인이 준비되면 여기 그래프로 보입니다."`
- 이유(`2QFL-2`): `빈 캔버스는 "성향이 없다"로 읽힌다. 없는 것과 아직 못 읽은 것은 다르다. 모드 칩은 계속 눌리고, 요약 탭으로 돌아갈 길도 남는다.`
- 보드 제목(`2QCU-2`): `정직성 상태 — 모르는 것을 아는 척하지 않는 자리`

#### (3) 변경 내용
1. `renderUnavailable(message, surface)`를 표면별로 만든다 — 지금 **보이는** 표면(`#graphSummaryMain` 또는 `#graphSettingsBody`)에도 같은 `.graph-mode-unavailable` 문구를 그린다.
2. `setAvailable(false)` 경로에서 요약 표면에도 호출한다.
3. 문구 2종을 구분: 브레인 미기동 = 위 원문 / 표 로드 실패 = `성향 신호를 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요.`

#### (4) 잠글 단위 테스트 — `app/lib/graph-mode/controller.test.js`
- `test('브레인이 안 됐을 때 요약 탭도 정직한 안내로 채워진다 — 백지가 아니다')`
  단언: `setup({ available: false })` 후 `controller.toggle()` → `elements.summaryMain.textContent`가 `아직 성향을 읽을 수 없습니다`를 포함.
- `test('표 로드 실패와 브레인 미기동은 다른 문구다')` — 두 메시지가 서로 다름.
- **기존 `:229-238` 단언 갱신**: 「안내는 `#graphBody` 범위만 채운다」 → 「안내는 지금 보이는 표면을 채운다」. `.graph-mode-unavailable`의 `position:absolute; inset:0`은 `#graphBody`뿐 아니라 새 컨테이너에도 `position:relative`가 필요하다.

#### (5) 부작용 위험 / 계약
- `#mosaic`/`#graphCanvas`의 `hidden` 소유자는 controller 단독(US-007) — canvas.js에서 만지지 않는다.
- 안내가 절대 배치라 컨테이닝 블록(`position:relative`)이 없으면 헤더 클릭 영역을 덮는다 — `:230-234`가 잡는 바로 그 회귀다.
- 항목 2가 같은 `#graphSummaryMain`에 히어로를 넣는다 → **0건 히어로와 미기동 안내가 동시에 뜨지 않도록** 우선순위를 정한다(미기동 > 0건 히어로).

### 8-B. 군집 넘는 연결 전부 핑크 점선

#### (1) 바꿀 파일과 줄
- `app/lib/graph-mode/live-map.js:207` — `const crossing = clusterOf.get(String(a)) !== clusterOf.get(String(b));`
- `:217` `color: crossing ? HIDDEN_COLOR : conf.color`, `:220` `dashes: crossing ? [6,4] : conf.dashes`, `:221` `width: crossing ? 2 : 1.4`, `:224` `title: …${crossing ? ' · 숨은 연관' : ''}…`
- `app/lib/graph-mode/hidden-links.js:77` — `const limit = Number.isInteger(opts.limit) ? opts.limit : 3;` (보드 06/07 상한 3)
- `app/lib/graph-mode/graph-mode-prefs.js:22` — `highlightCrossings` 사문(라이브 지도가 읽지 않음)
- `app/canvas.js` — `loadHiddenLinks()`가 이미 상위 3쌍을 캐시한다

#### (2) Paper 원문 (2QCN-2 › 2QF6-2 행)
- 화면이 하는 말(`2QF8-2`): `핑크 점선은 상위 3건만. 요약의 "숨은 연관" 카드와 같은 셋이다.`
- 이유(`2QF9-2`): `작은 그래프에서는 군집이 종목↔테마 경계를 따라 갈려 거의 모든 연결이 "경계를 넘는" 연결이 된다. 전부 핑크로 칠하면 예외라는 뜻이 사라진다 — 모두가 예외면 아무도 예외가 아니다.`

#### (3) 변경 내용
1. `live-map.render(payload, { hiddenPairs })`로 상위 3쌍(`canvas.js`의 `loadHiddenLinks` 캐시)을 넘긴다.
2. `:207`의 `crossing`을 `isHidden = hiddenPairSet.has(pairKey(a,b))`로 교체 — `HIDDEN_COLOR`·`[6,4]`·`width 2`·툴팁 `· 숨은 연관`을 **그 셋에만** 준다.
3. 나머지 교차 엣지는 확정성 색(`CONFIDENCE`)으로.
4. `graph-mode-prefs.js:22`의 `highlightCrossings`를 실제로 읽거나(off면 강조 전부 끔) 사문이면 제거.

#### (4) 잠글 단위 테스트 — `app/lib/graph-mode/live-map.test.js`(없으면 신규) 또는 `hidden-links.test.js`
- `test('핑크 점선은 숨은 연관 상위 3쌍에만 붙는다')`
  단언: 교차 엣지 7개 중 `hiddenPairs` 3쌍만 `color.color === '#ee137b' && dashes[0] === 6`.
- `test('군집을 넘어도 상위 3건 밖이면 확정성 색이다')`
  단언: 나머지 4개 `color.color !== '#ee137b'`.
- `test('툴팁의 · 숨은 연관도 같은 셋에만 붙는다')`
  단언: `title.includes('· 숨은 연관')`인 엣지 수 === 3.
- `test('요약의 숨은 연관 카드와 지도가 같은 셋을 쓴다')` — `hidden-links.js`의 `slice(0, 3)` 결과와 지도의 강조 집합이 동일.

#### (5) 부작용 위험 / 계약
- 정적 뷰의 `.graph-edge.is-hidden-link` 규칙(다른 엣지 규칙을 덮는다, `:214-215` 주석)과 같은 셋을 써야 두 뷰가 어긋나지 않는다.
- `hidden-links.js`의 `limit 3`은 **보드 06/07 계약**이다 — 지도 쪽에서 다른 상한을 쓰면 안 된다.

#### (6) 크기 / 의존
- 8-A **M**, 8-B **S**. 8-B는 완전히 독립적이고 위험이 낮아 먼저 해도 좋다. 8-A는 **항목 2 이후**.

---

## 9. 2NW8-2 — 설치·직접등록 승인 카드에 4필드가 없다

### (1) 바꿀 파일과 줄
- `app/lib/plugin-proposal.js:119-130` — `linesFor(action)`: `install` → `['권한 N개 요청']`(:122), `stage_snippet` → `['등록만으로는 실행되지 않습니다']`(:127)
- `app/lib/plugin-proposal.js:117-118` 주석 — 「카드 본문은 제안 안에 실제로 실린 값만 쓴다 — 카탈로그·레지스트리를 조회해 지어내지 않는다」
- `app/lib/plugin-canvas.js:1067-1099` — `proposalCard(entry)`: `copy.lines`를 그대로 `.plugin-canvas-proposal-line`으로 그린다(:1082-1083)
- `app/lib/plugin-canvas.js:872-918` — 4필드가 **모달 설치 시트에만** 있다(허브 [설치] GUI 경로 전용)
- `app/lib/plugin-proposal-registry.js:110` — 승인 게이트가 카탈로그 id만 허용
- 게이트: `app/verify.js:2221-2229` — `JSON.stringify(pluginProposalCard.lines) === JSON.stringify(['권한 1개 요청'])`

### (2) Paper 원문 (보드 05 install-card `3ZHL-0`, 560px)
- 배지: `아테나 제안` / 제목: `웹 문서 읽기 설치`
- 섹션 머리: `플러그인 정보`
- 정보 박스(`bg-k-panel3`): `웹 문서 읽기` / `제공: athena-official · mcp-server-fetch` / `용도: 공시·리서치 웹 페이지를 마크다운으로 읽기`
- 섹션 머리: `요청 기능` + 기능 행 `fetch — 웹 페이지를 마크다운으로 읽습니다` + 배지 `요청`
- mono 박스: `실행 명령: uvx mcp-server-fetch`
- 박스: `설치 위치 · 플러그인 모드 > 웹 문서 읽기`
- 배지 2종: `권한 1개 요청` / `설치형 플러그인`
- 버튼: `거부` / `승인`

보드 07 설치 열(`3ZJS-0`): `제공: athena-official` · `실행 명령: npx -y @drfirst/korea-stock-mcp` · `권한 6개 요청`
보드 07 스니펫 열(`3ZLN-0`): `실행 명령: uvx mcp-server-time` · `등록만으로는 실행되지 않습니다`

### (3) 변경 내용
1. `cardCopy`가 카드 본문에 **실행 대상**을 싣도록 봉투를 넓힌다.
   - `install`: 승인 게이트가 이미 카탈로그 id만 허용하므로(`plugin-proposal-registry.js:110`) 렌더러에서 `plugin-catalog`로 `provider`/`purpose`/`command`/`args`를 되짚어 `제공: …` · `용도: …` · `실행 명령: …` · `설치 위치 · 플러그인 모드 > {이름}` 4줄을 추가.
   - `stage_snippet`: 봉투에 실려 오는 `snippet`에서 `command`·`args`를 뽑아 `실행 명령: …`을 붙이고 기존 `등록만으로는 실행되지 않습니다`를 유지.
2. `:117-118` 주석의 "지어내지 않는다" 규율은 유지 — **카탈로그에 없으면 그 줄을 그리지 않는다.**

### (4) 잠글 단위 테스트 — `app/lib/plugin-proposal.test.js`
- `test('cardCopy: install 카드 본문에 제공·용도·실행 명령·설치 위치가 실린다')`
  단언: `lines`가 `제공: athena-official · mcp-server-fetch`, `용도: 공시·리서치 웹 페이지를 마크다운으로 읽기`, `실행 명령: uvx mcp-server-fetch`, `설치 위치 · 플러그인 모드 > 웹 문서 읽기`를 모두 포함.
- `test('cardCopy: 카탈로그에 없는 id면 그 줄을 지어내지 않는다')`
  단언: 알 수 없는 id → `lines`에 `실행 명령`이 없음(빈 문자열도 아님).
- `test('cardCopy: stage_snippet은 스니펫의 command·args로 실행 명령을 만든다')`
  단언: `실행 명령: uvx mcp-server-time` 포함 + `등록만으로는 실행되지 않습니다` 유지.
- `test('cardCopy: 모델 제안과 GUI 제안이 같은 4필드를 낸다')` — 출처 라벨만 다르다(기존 `:144` 규율 확장).

### (5) 부작용 위험 / 계약
- **`app/verify.js:2229`의 `유지 7` 단언이 깨진다** — `lines`가 `['권한 1개 요청']` 한 줄로 고정돼 있다. 이 단언을 4필드 포함으로 갱신해야 하고, `docs/handoff/plugin-mode-doctrine/plan.md:363(W3-2)`·`:387(W4 05행)`이 요구한 상태와 일치시켜야 한다.
- `verify.js:2231-2233`(GUI 클릭이 채팅 턴 0개), `:2235-2241`(승인·거부 버튼 32px·키보드 도달)은 **그대로 통과해야 한다** — 줄이 늘어 카드가 길어져도 버튼 클릭 영역은 유지.
- `plugin-proposal-boundary.test.js`가 잡는 액션 6종 스키마(`:21`)를 넓히지 않는다 — 렌더 시점 조회이지 봉투 스키마 변경이 아니다.

### (6) 크기 / 의존
- **M**. 독립.

---

## 10. DH2-0 — 복원 실패 턴 본문이 반말이고 이유·복구 안내가 없다

### (1) 바꿀 파일과 줄
- `app/lib/routine-turn.js:85-92` — `restore-failed` 분기:
  `body: event.note || '저장된 루틴을 복원하지 못했다 — 감시가 비어 있다.'` (**`event.reason` 미참조**)
- `app/lib/routine-turn.js:80-83` — 만료 분기: `루틴 '…'이 만료로 종료됐다. 계속 필요하면 다시 등록해 달라.`
- `app/lib/routine-turn.js:93` — `{ kind: 'unknown', body: '해석할 수 없는 알림을 받았다.' }`
- `backend/athena_api/routines/runtime.py:298`, `:374` — `'{spec.note}' 재구독 실패 — 감시가 멈춰 있다.`
- `backend/athena_api/routines/scheduler.py:513-523` — `_fail_code_watch`가 note 없이 `reason: CODE_HASH_MISMATCH_REASON`(`scheduler.py:39` = `감시 코드가 바뀌거나 사라짐 — 다시 검사`)만 보낸다

### (2) Paper 원문
- `DH7-0`: `감시 '검증 루틴'을 복원하지 못했습니다 — 백엔드 재시작 후 다시 시도해 주세요.`
- `DH6-0`: `복원 실패`
- 자매 보드 `1Y3-0 > 6XE-0`: `저장된 능동 턴을 복원하지 못했습니다. 원본 이벤트는 원장에 남아 있으니 감시 상태 카드에서 확인하세요.`

### (3) 변경 내용
1. `buildTurnModel`의 `restore-failed` 분기에서 **`event.reason`을 `event.note`와 같은 우선순위로 읽는다**(둘 다 없을 때만 기본 문구).
2. 세 문장을 존댓말 + 복구 행동 한 문장으로:
   - 복원 실패: `감시 '{이름}'을 복원하지 못했습니다 — {이유}. 백엔드가 다시 뜨면 자동으로 재시도합니다.`
   - 만료: `루틴 '{이름}'이 만료로 종료됐습니다. 계속 필요하면 다시 등록해 주세요.`
   - 미지: `해석할 수 없는 알림을 받았습니다.`
3. 백엔드 note 세 곳(`runtime.py:298`·`:374`, `scheduler`의 reason)도 같은 문체로 맞춘다.

### (4) 잠글 단위 테스트 — `app/lib/routine-turn.test.js`
- `test('buildTurnModel(restore-failed): reason만 와도 사실과 다른 기본 문구로 떨어지지 않는다')`
  단언: `{ type:'routine-restore-failed', reason:'감시 코드가 바뀌거나 사라짐 — 다시 검사' }` → `body`가 `감시가 비어 있다`를 **포함하지 않고** `reason` 문자열을 포함.
- `test('buildTurnModel(restore-failed): note가 있으면 note를 쓴다')` — 기존 우선순위 보존.
- `test('복원 실패·만료·미지 세 문장이 모두 존댓말이다')`
  단언: 세 `body` 모두 `/습니다|주세요/` 매치, `/했다\.|있다\.|받았다\./` 불매치.
- `test('복원 실패 문장에 사람이 할 다음 행동이 들어간다')` — `body`가 `재시도` 또는 `다시` 포함.
- **기존 `:55` 테스트 `buildTurnModel: 만료·복원실패·미지 타입` 갱신 필요** — 지금 반말 문구를 고정하고 있다.

### (5) 부작용 위험 / 계약
- **`app/verify.js:1208-1218` `emptyHistory` 계약**: 부팅 직후 `#history`에 턴이 0개여야 한다. 루틴 턴은 이벤트가 와야 붙으므로 영향 없지만, 문구 변경이 첫 페인트 경로에 새 DOM을 만들지 않도록 주의.
- 백엔드 문구를 바꾸면 `runtime.py`·`scheduler.py`의 파이썬 테스트가 문자열을 고정하고 있을 수 있다 — 함께 갱신.
- 카드미니(`app/lib/orb-mini-card.js`)가 같은 이벤트를 요약하면 그쪽 문구도 어긋난다.

### (6) 크기 / 의존
- **S**(프런트) + **S**(백엔드 문구). 독립.

---

## 11. 11D-0 — 「열리지 않는 것」 3줄 제목이 흰 시트에서 안 보인다

### (1) 바꿀 파일과 줄
- `app/styles/settings-cards.css:249` —
  `.uk-closed-title { font-family: var(--font-strong); color: #F2F4F8; font-size: var(--text-md); }`
  **저장소 전체에서 이 색은 이 한 줄뿐이다.**
- 렌더: `app/lib/settings-cards.js:727-739`
- 배경: `app/styles/ui-kit.css:143` 시트 `rgba(255,255,255,0.62)` / 본문색 토큰 `app/styles/tokens.css:41` `--color-k-text: #14171d`
- 대비 약 **1.06:1** — 사실상 사라진다.

### (2) Paper 원문 (11Q-0 시트 오른쪽 열)
세 제목 `자동 매매 없음` · `AI 단독 실행 없음` · `실거래 계좌 접근 없음` — `font-strong` · `text-md` · `color text-k-text`(진한 본문색). 설명문(`.uk-closed-desc`, `--color-k-dim`)보다 강한 리드다.

### (3) 변경 내용
`color: #F2F4F8` → `color: var(--color-k-text)`. **한 줄.** 라이트 전환 때 놓친 단일 다크 잔재다.

### (4) 잠글 단위 테스트
CSS 잔재라 `controller.test.js:229-238`이 쓰는 "CSS 파일을 읽어 단언" 문법을 쓴다. `app/lib/settings-cards.test.js`에 추가:
- `test('열리지 않는 것 제목은 토큰 색을 쓴다 — 다크 잔재 하드코딩이 없다')`
  단언: `settings-cards.css`의 `.uk-closed-title` 규칙에 `#F2F4F8`가 없고 `var(--color-k-text)`가 있다.
- (선택) `test('settings-cards.css 어디에도 #F2F4F8 하드코딩이 없다')` — 전역 회귀 가드.

### (5) 부작용 위험 / 계약
- 없음에 가깝다. 같은 시트의 `.uk-closed-desc`(`--color-k-dim`)와 대비가 확보돼 리드/설명 위계가 살아난다.
- **실주문 하드락 유지**: 이 시트는 주문 API 게이트 안내다 — 문구·동작은 건드리지 않고 색만 바꾼다.

### (6) 크기 / 의존
- **S** (한 줄). 완전 독립. **가장 먼저 할 것.**

---

## 12. 16OD-2 — 부팅 비활성 ATHENA 자리표시자가 투명

### (1) 바꿀 파일과 줄
- `app/chat.css:75-79` —
  ```
  .boot-base {
    /* 글자 폭을 고정하는 투명한 layout guide다. … */
    color: transparent;
    background: none;
  }
  ```
  (`color: transparent`가 **:78**)
- `app/verify.js:594-596` — `const baseIsTransparent = !!lastState && lastState.baseColor === 'rgba(0, 0, 0, 0)' && lastState.baseBackgroundColor === 'rgba(0, 0, 0, 0)';`
- `app/verify.js:668` — 리포트 필드 / `:707` — `pass = baseWordPresent && baseIsTransparent && …`
- 프로브 수집: `app/verify.js:458` `baseColor: baseStyle ? baseStyle.color : ''`
- 게이트 로그: `scratchpad/gates/verify.log:79 "baseIsTransparent":true`

### (2) Paper 원문
- 보드 02 텍스트 노드 `16OG-2` 이름 `ATHENA · inactive`, computed `color #9AA2AE`, `fontFamily "DakiL"`, `112px`, `-0.04em`
- 보드 03(`16OJ-2`): `AT` `#0E20B2` + 캐럿 `#EE137B` + `HENA` `#9AA2AE`
- 보드 04(`16OT-2`): `inactive · NA` `#9AA2AE`
- `PAPER_DESIGN_AUDIT.md:52`: 「기존 회색 ATHENA 위로 파란 글자를 실제 타이핑 속도로 다시 입력합니다」

### (3) 변경 내용
**결정이 먼저 필요하다.**
- (a) **회색 복원**: `.boot-base { color: #9AA2AE; }`(파란 타이핑 레이어가 위를 덮으므로 접두사는 파랑으로 읽힌다). 캐럿이 미입력 글자를 밀어내는 Paper 배치가 필요하면 타이핑 레이어를 absolute 오버레이 대신 flow 3토막(파랑 접두사 + 캐럿 + 회색 잔여)으로 바꾼다.
  **동시에 `verify.js:594-596`의 `baseIsTransparent` 단언을 `baseColor === 'rgb(154, 162, 174)' && baseBackgroundColor === 'rgba(0, 0, 0, 0)'`로 교체**하고 필드명을 `baseIsInactiveGray`로 개명(`:668`, `:707` 동반 수정).
- (b) **회색 폐지 확정**: `PAPER_DESIGN_AUDIT.md` 결정 로그(255-258행 근처)에 날짜와 함께 남기고 Paper 보드 02·03·04의 회색 노드를 고쳐 정본을 일치시킨다.

### (4) 잠글 단위 테스트
- `app/chat.css` CSS 단언(신규, `app/lib/…` 순수 테스트에 CSS 읽기):
  `test('부팅 자리표시자는 Paper 회색이다 — 투명이 아니다')` 단언: `.boot-base` 규칙에 `transparent`가 없고 `#9AA2AE`가 있다.
- `app/verify.js` 부팅 게이트: `assertOk('boot: 비활성 ATHENA는 #9AA2AE 회색이다', baseIsInactiveGray)` — **`baseIsTransparent`를 남겨두면 게이트가 회색 복원을 실패로 만든다.**
- `test('타이핑된 6글자는 여전히 파랑(#0E20B2)이다')` — 기존 `overlayIsBlue`(:597-598) 보존.
- `test('캐럿은 여전히 핑크(#EE137B)다')` — 기존 `cursorIsPink`(:599) 보존.

### (5) 부작용 위험 / 계약
- **부팅 게이트 `pass` 식(`:707-712`)에 `baseIsTransparent`가 들어 있다 — 코드만 고치면 게이트가 즉시 빨개진다.** 두 변경은 반드시 한 커밋.
- `emptyHistory` 계약(`verify.js:1208-1218`)은 부팅 **이후** 채팅 첫 페인트를 잰다 — 색 변경은 영향 없다.
- 타이핑 레이어를 flow로 바꾸는 (a)-확장안은 `typeScaleMatchesPaper`·`timingMatches`(`:708-709`)를 깨뜨릴 수 있다 — **색만 바꾸는 최소안을 먼저** 하고 배치 변경은 별도 항목으로.

### (6) 크기 / 의존
- **S**(색만) / **M**(flow 배치까지). 선행: 회색 유지/폐지 사용자 결정.

---

## 13. CLE-0 — 「모델 설정」 설명에 내부용어 노출

### (1) 바꿀 파일과 줄
- `app/chat.js:2698` —
  `$kiumiMenu.appendChild(kiumiItem('model', '모델 설정', 'Claude·Grok 모델·사고 강도 — 모델 팝오버(보드 09)', async () => {`
- 렌더 경로: `app/chat.js:2556-2562` (`desc`가 있으면 `.km-desc` span으로 표시)
- 실화면 증거: `app/captures/kiumi-01-menu.png`

### (2) Paper 원문
- `2HDB-2` (CLE-0 › 설정 › 모델 설정 항목 설명): `모델 · 사고 강도`
- 보드 06 설명 `EZ3-0`: 「각 항목은 이름과 설명을 한 줄에서 훑는다」

### (3) 변경 내용
설명을 `모델 · 사고 강도`로 되돌린다. 공급자 이름을 남기려면 `Claude·Grok 모델 · 사고 강도`까지. **`— 모델 팝오버(보드 09)`는 코드 주석으로 옮긴다.**

### (4) 잠글 단위 테스트
`chat.js`는 렌더러 전역이라 순수 테스트가 없다. 문자열 회귀 가드를 `app/lib/kiumi-face.test.js` 옆 또는 신규 `app/lib/kiumi-menu-copy.test.js`에:
- `test('키우미 메뉴 문구에 Paper 보드 번호가 없다')`
  단언: `chat.js` 소스를 읽어 `kiumiItem(` 호출의 desc 인자에 `/보드 \d+/`가 없다.
- `test('내부 컴포넌트 이름(팝오버·시트·캔버스)이 사용자 설명에 없다')`
  단언: 같은 인자들에 `팝오버` 불매치.
- `test('모델 설정 설명은 Paper 문구다')` — `모델 · 사고 강도` 포함.

### (5) 부작용 위험 / 계약
- 「카드 문구 3원칙」(설명문 금지 · 한국어 단위 · **내부용어 금지**)의 정면 위반 수정이라 규율 방향이 일치한다.
- `app/captures/kiumi-01-menu.png` 재촬영 필요.
- 다른 `kiumiItem` desc에도 같은 오염이 있는지 함께 훑는다(위 회귀 가드가 잡아 준다).

### (6) 크기 / 의존
- **S** (한 줄 + 회귀 가드). 완전 독립.

---

## 14. BV0-0 — 작업 뷰 하단 규칙 3줄이 Paper와 정반대

### (1) 바꿀 파일과 줄
- `app/lib/agent-canvas.js:533-546` — 주석 「세 줄은 Paper 원문 그대로다」(:536, **사실이 아니다**) + `ROUTE_RULES` 배열(:538-542) + `routeRulesCaption.textContent = '동선 규칙'`(:545)
- `app/probe-agent-paper-parity.js:213` — `ruleLines: Array.from(c.querySelectorAll('.agent-route-rule')).map((n) => n.textContent)`
- `app/probe-agent-paper-parity.js:229` — `JSON.stringify(tasksProbe.ruleLines) === JSON.stringify([ … ])` (**현재 옛 문구를 고정한다**)

### (2) Paper 원문 (에이전트 보드 05 하단)
- 캡션 `C6T-0`: `이중 제어 규칙`
- `C6V-0`: `① 새 작업 — 채팅 문장으로도, 시트로도.`
- `C6W-0`: `② 편집 — "이거 고쳐줘"로도, 폼으로도.`
- `C6X-0`: `③ 확정 — 채팅 칩으로도, 버튼으로도. 어느 입구든 같은 게이트.`
- 같은 계약: `432Z-1` 게이트 지도 `437L-1` 「두 입구 · 한 게이트」

### (3) 변경 내용
1. `ROUTE_RULES` 3줄을 Paper `C6V-0`~`C6X-0` 원문으로 교체.
2. `routeRulesCaption`을 `이중 제어 규칙`으로.
3. `:533-537` 주석 갱신 — 「세 줄은 Paper 원문 그대로다」가 이제 참이 된다.
4. `probe-agent-paper-parity.js:229`의 `ruleLines` 단언을 새 3줄로 동시 교체.

**단, 앱이 실제로 GUI 입구를 제공하지 않으면 새 문구가 거짓이 된다.** Step 6-B(시트 입구) 재개 전이라면 Paper 쪽에 「앱 반영 보류(날짜)」 주석을 남겨 두 문구가 동시에 정본으로 읽히지 않게 한다.

### (4) 잠글 단위 테스트 — `app/lib/agent-canvas.test.js`
- `test('작업 뷰 하단 캡션은 이중 제어 규칙이다')`
  단언: `.agent-panel-caption` 텍스트 === `이중 제어 규칙`.
- `test('규칙 3줄은 Paper C6V-0~C6X-0 원문 그대로다')`
  단언: `.agent-route-rule` 3개의 `textContent` 배열이 Paper 3문장과 정확히 일치.
- `test('규칙 문구가 GUI 입구를 부정하지 않는다')`
  단언: 3줄에 `시트를 열지 않는다` / `보기 전용` 불매치.
- **`probe-agent-paper-parity.js:229` 동시 갱신 필수** — 안 하면 프로브가 즉시 실패한다.

### (5) 부작용 위험 / 계약
- **에이전트 채팅 헤더 숨김(`#chatModeHead` hidden) 잠금 계약**은 이 변경과 무관하지만 같은 파일군이라 건드리지 않도록 주의.
- 문구가 GUI 입구를 약속하는데 입구가 없으면 **더 나쁜 거짓말**이 된다 — Step 6-B 상태를 먼저 확인.
- `artifacts/qa/jangjung-20260904/captures/mode-agent.png` 재촬영.

### (6) 크기 / 의존
- **S** (3줄 + 캡션 + 프로브 단언). 선행: Step 6-B 상태 확인. 항목 15와 같은 에이전트 트랙.

---

## 15. 4330-1 / 43WD-1 — 제어 결과 턴 4상태 · 자동 검사 진행 5줄

### 15-A. 4330-1 제어 결과 턴 4상태

#### (1) 바꿀 파일과 줄
- `app/chat.js` — 결과 턴을 그리는 코드가 **플러그인 제안(:3497 이하)과 말걸기 가드 확인 카드(:3421-3495, `반영됐습니다`·`그대로 뒀습니다`)뿐이다.** 루틴 제어 결과 턴은 0건.
- 전체 grep: `다시 시도` 칩 · `보류 — 목록 유지` · `작업 › 일시중지` 0건. **제어 결과를 받을 IPC 구독도 없다.**
- 새로 만들 곳: `app/lib/routine-control-turn.js`(순수 모델) + `app/chat.js` 렌더 배선

#### (2) Paper 원문 (4330-1, 4열)
보드 부제(`433B-1`): `칩 클릭 뒤 같은 방에 붙는 4상태 · 성공 · 거부 · 실패·재시도 · 뷰 이동` / 규율 배지(`433D-1`): `상태 표기만 · 설명문 없음`

| 열 | 헤더 | 부제 | 배지(검정) | 배지(테두리) | 리드 | 사실행 | 칩 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 성공 | `성공` | `서버 반영 · 캔버스 갱신` | `작업 설정` | `완료`(ok) | `쿨다운 600초 반영` | `삼성전자 88,000원 감시 · 만료 보존` | — |
| 거부 | `거부` | `보류 · 서버 상태 불변` | `제안 채택` | `보류`(dim) | `보류 — 목록 유지` | `외국인 순매수 3일 연속 · 보류함 1건` | — |
| 실패 | `실패 · 재시도` | `백엔드 거절 · 다시 시도 칩` | `지금 실행` | `실패`(up) | `이미 발화된 예약` | `평일 아침 브리핑 · 오늘 07:30 발화 기록 있음` | `다시 시도` |
| 뷰 이동 | `뷰 이동` | `렌더러 상태만 · 칩 없음` | `뷰 이동` | `완료`(ok) | `작업 › 일시중지 3건` | `캔버스 필터 일시중지 · 검색어 없음` | — |

문구 규칙(`437T-1`):
- `437W-1`: `상태 표기만 · 한국어 단위 · 내부어 없음`
- `437Y-1`: `실패 문구는 백엔드 거절 사유의 사용자 어투 판`
- `4380-1`: `보류·뷰 이동은 서버 상태 불변 — 빈 변경이 정상`

카드 형태: `w-full p-4 rounded-lg gap-7 bg-k-panel3`, 배지 행(검정 `bg-k-text`/`text-k-panel` 10px mono + 테두리 배지), 리드 13px `Daki B`, 사실행 11px `Daki` `--color-k-dim`, 칩 min-h 32px pill.

#### (3) 변경 내용
1. 순수 모델 `buildControlResultTurn(event)` → `{ kind:'success'|'reject'|'fail'|'view', badge, statusBadge, lead, fact, chips }`.
2. 제어 결과 IPC 구독을 만든다(항목 15-B의 07 근거와 한 벌).
3. 실패 문구는 백엔드 거절 사유의 **사용자 어투 판**으로 옮긴다 — 코드 번호는 화면에 올리지 않는 기존 R10 규칙과 같다.

### 15-B. 43WD-1 자동 검사 진행 5줄 · 격리 실행 고지

#### (1) 바꿀 파일과 줄
- `app/chat.js:3319-3417` — 초안 카드
- `app/chat.js:3199-3277` — 검사 결과 카드
- grep `검사 1/3|격리 실행` → `app/**/*.js` **0건**
- 새로 만들 곳: `app/lib/watch-check-card.js` 옆 순수 모델(예: `app/lib/watch-progress-card.js`)

#### (2) Paper 원문 (43WD-1 › 458M-1, 300px 패널, `bg-k-panel`, radius 12, padding 14, gap 8)
- 머리: 좌 `자동 검사`(10px mono, tracking-pill, `--color-k-faint`) / 우 `코드가 바뀔 때마다`
- `✓`(ok) `입력 확인 — 삼성전자 · 최근 60일 일봉 60개 · 오늘 현재가`
- `✓`(ok) `함수 4개 만듦 — 일봉 불러오기 · 3일 거래량 평균 · 배수 비교 · 알림`
- `✓`(ok) `검사 1/3 — 문법 통과 · 금지 명령 없음 · 격리 실행`
- `◐`(warn, `--color-k-dim`) `검사 2/3 — 지난 30일 돌려 보는 중 · 12초`
- `○`(ghost, `--color-k-faint`) `검사 3/3 — 오늘 값으로 1회 실행`
- 발치 안전 고지(10px, `--color-k-faint`): `격리 실행 · 계좌·주문 접근 없음 · 30초 제한`

#### (3) 변경 내용
1. 채팅 초안 흐름에 진행 4~5줄을 순수 모델로 만든다(`{ mark:'✓'|'◐'|'○', text }[]`).
2. 검사 카드 하단에 `격리 실행 · 계좌·주문 접근 없음 · 30초 제한` 한 줄을 **상수로 고정**한다 — 안전 고지는 지어내는 값이 없으므로 백엔드 응답 없이도 낼 수 있다.
3. 앞 두 줄(입력 확인 · 함수 N개 만듦)은 실값이 있을 때만 그린다(없으면 그 줄을 만들지 않는다).

### (4) 잠글 단위 테스트
`app/lib/routine-control-turn.test.js`(신규):
- `test('성공 결과 턴은 배지 · 리드 · 사실행 세 조각이다 — 설명문이 없다')`
  단언: `{ badge:'작업 설정', statusBadge:'완료', lead:'쿨다운 600초 반영', fact:'삼성전자 88,000원 감시 · 만료 보존', chips:[] }`.
- `test('실패 결과 턴에만 다시 시도 칩이 붙는다')` — `chips` 가 `['다시 시도']`, 나머지 3상태는 `[]`.
- `test('보류·뷰 이동은 서버 상태 불변 — 빈 변경이 정상이다')` — `serverChanged === false`.
- `test('실패 문구에 백엔드 코드 번호가 들어가지 않는다')` — `/[A-Z]{2,}_\d|code:/` 불매치.
- `test('단위는 한국어다 — 초 · 건 · 원')` — `/\d+(sec|s)\b/` 불매치.

`app/lib/watch-progress-card.test.js`(신규):
- `test('진행 5줄의 마크는 ✓ ◐ ○ 세 종류뿐이다')`
- `test('격리 실행 고지는 상수라 백엔드 응답 없이도 나온다')` — `buildProgress({})` 결과에도 `격리 실행 · 계좌·주문 접근 없음 · 30초 제한` 존재.
- `test('입력 확인 줄은 실값이 없으면 그리지 않는다 — 지어내지 않는다')`.

### (5) 부작용 위험 / 계약
- **`app/verify.js:1208-1218` `emptyHistory` 계약**: 이 항목이 채팅 히스토리에 턴을 만든다. 부팅 직후에는 **어떤 턴도 붙으면 안 된다** — 새 IPC 구독이 부팅 시 즉시 턴을 그리지 않도록(이벤트 도착 시에만) 배선한다. 이 항목에서 가장 큰 회귀 위험이다.
- 에이전트 채팅 헤더 숨김 계약 유지.
- 「카드 문구 3원칙」(설명문 금지)이 `433D-1` `상태 표기만 · 설명문 없음`과 정확히 같은 규율이다.
- 15-A는 **제어 결과 IPC가 없으면 시작할 수 없다** — 백엔드/메인 계약 확인이 선행.

### (6) 크기 / 의존
- **L**. 15-A와 15-B는 한 벌(같은 에이전트 대화 트랙). 선행: 제어 결과 IPC 존재 확인, 항목 14와 같은 트랙. **마지막 그룹**에 배치.

---

## 16. 1OP-0 — 주문 티켓에 가격 행·총 주문 금액 추정이 없다

### (1) 바꿀 파일과 줄
- `app/chat.js:4417-4460` — `renderOrderTicket(prefill)`. 현재 행 구성: 종목(:4425) / 사유(:4426) / 발화 시점 관측값(:4429-4431) / 방향 버튼(:4435-4443) / 수량 입력(:4445-4456, 라벨 `'수량 · 시장가'` :4450) / 게이트 상태 줄(:4459-4462)
- `app/chat.css:1822-1826` — `.ticket-card` / `.ticket-row` / `.ticket-qty`만 존재
- `app/lib/order-ticket.js:72` — `trde_tp: '3', // 시장가 — P4 1차 범위(지정가는 후속)`
- 저장소 전체 grep: `총 주문 금액` · `시장가 체결` **0건**

### (2) Paper 원문 (1OP-0 › 9F3-0, 440px 카드)
- 머리: `삼성전자 005930` + 우측 `집행 전 재확인` / 부제 `감시 조건 도달 — 종가 88,000 이상 · 발화 관측값 88,100`
- 방향 세그먼트: `구매`(up) / `판매`
- **가격 행**: 라벨 `가격` + 세그먼트 `지정가` | `시장가`(선택) + 읽기값 `시장가 체결`(`--color-k-ghost`, mono)
- **수량 행**: 라벨 `수량` + 값 `10` + 단위 `주` + 비율 칩 `10%` `25%` `50%` `최대`
- **요약 행**(상단 border, padding-top 12): 좌 `총 주문 금액 (시장가 추정)`(11px) ↔ 우 `약 881,000원`(14px mono, `tracking-num`)
- 게이트 박스: `지금은 실행할 수 없음`(warn dot) / `활성 계좌의 주문 API가 OFF입니다 — 설정 › 계좌에서 게이트를 여세요.`
- 버튼: `구매하기` / `닫기 (Esc)` + 발치 `실행하면 확인 게이트와 멱등키가 적용됩니다 — 같은 멱등키로는 두 번 체결되지 않습니다.`

### (3) 변경 내용
1. **총액 추정 행부터** 넣는다(실행 버튼 바로 위). 계산: `수량 × (발화 관측값 또는 최신 시세)`. 라벨에 `(시장가 추정)`을 남긴 채 `약 {n}원` 형식. 관측값이 없으면 **행을 그리지 않는다**(지어내기 금지).
2. **가격 행**: 지정가 지원 전이라도 Paper처럼 세그먼트(`지정가` 비활성 / `시장가` 선택) + 읽기값 `시장가 체결`을 그린다. 그러면 "무엇이 실행되는지"가 텍스트 각주(`수량 · 시장가`)가 아니라 값으로 보인다.
3. 수량 라벨을 `수량`으로 되돌린다(`· 시장가`는 가격 행이 대신 말한다).

### (4) 잠글 단위 테스트 — `app/lib/order-ticket.test.js` (기존 파일)
- `test('총 주문 금액은 수량 × 관측값 추정이고 라벨에 추정을 남긴다')`
  단언: `estimateOrderTotal({ qty: 10, observed: 88100 })` → `{ label: '총 주문 금액 (시장가 추정)', text: '약 881,000원' }`.
- `test('관측값이 없으면 총액 행을 만들지 않는다 — 0원을 지어내지 않는다')`
  단언: `estimateOrderTotal({ qty: 10, observed: null }) === null`.
- `test('수량이 0이면 총액 행이 없다')`.
- `test('가격 행은 시장가 고정을 세그먼트와 읽기값으로 드러낸다')`
  단언: `priceRowModel()` → `{ segments: ['지정가','시장가'], selected: '시장가', readout: '시장가 체결', limitEnabled: false }`.
- `test('실주문 본문은 여전히 trde_tp 3(시장가) 고정이다')` — **하드락 회귀 가드**(`order-ticket.js:72`).

### (5) 부작용 위험 / 계약
- **실주문 하드락 유지**: `/api/v1/order/*` 금지, `mockapi.kiwoom.com` 고정. 가격 행을 그린다고 `지정가`가 **실제로 눌리면 안 된다** — 비활성 세그먼트다.
- `trde_tp: '3'` 고정은 P4 1차 범위 계약이다. UI가 지정가를 약속하면 거짓이 된다.
- **`emptyHistory` 계약**: 티켓은 이벤트로 열리므로 부팅 첫 페인트에 영향 없다.
- 총액이 "약"이라는 것을 라벨과 값 양쪽에 남긴다(발화 관측값은 집행 시점 값이 아니다 — `:4429-4430` 주석의 시점 정직성 규율).

### (6) 크기 / 의존
- **M**. 독립. 항목 11과 같은 주문 트랙(다만 11은 CSS 한 줄).

---

## 17. 161Q-2 / 1IG3-0 — 빈·거부 상태 문구, 취소 시 결과 유지, 인증 만료

### 17-A. 내부 용어 노출 (161Q-2)

#### (1) 바꿀 파일과 줄
- `app/canvas.js:682` — `renderLiveNotice('캔버스 호출이 거부됐다 — --allowedTools 권한이 없다.')`
- `app/canvas.js:688` — `renderLiveNotice(\`캔버스 응답을 해석하지 못했다 — ${result.reason || '원인 미상'}.\`)`
- `app/canvas.js:1919` — `errorNote('빈 스트림 — records가 없다.')`
- `app/canvas.js:2043` — `errorNote('빈 차트 — candles가 없다.')`

#### (2) Paper 원문
- `161U-2`: `모든 상태는 같은 질문·종목·기간을 유지하고, 사용자가 할 수 있는 다음 행동을 직접 보여줍니다.`
- 각 상태 3번째 줄 예: `1SS4-0` `질문과 종목은 그대로 유지됩니다.`

#### (3) 변경 내용
네 문구를 사용자 문장 + 다음 행동으로 바꾸고, 내부 필드명(`candles`·`records`)과 CLI 플래그(`--allowedTools`)는 **로그로 보낸다**.
- 예: `표시할 봉이 없습니다 — 기간을 넓혀 다시 조회할 수 있습니다.`
- 예: `표시할 소식이 없습니다 — 기간이나 종목을 바꿔 다시 조회할 수 있습니다.`
- 거부: `이 조회를 실행할 권한이 없습니다 — 설정에서 권한을 확인해 주세요.`
- 해석 실패: `응답을 읽지 못했습니다 — 같은 질문으로 다시 시도할 수 있습니다.`
각 카드에 재조회·조건 변경 행동을 붙인다.

### 17-B. 취소가 결과를 지운다 (1IG3-0)

#### (1) 바꿀 파일과 줄
- `app/lib/main/rest-dataset-runner.js:584-588` — 주석 `데이터 없는 cancelled state를 그린다`
- `app/lib/main/rest-dataset-runner.js:427-445` — `toCancelledInlineResponse()`
- `app/canvas.js:1284-1289` — `labels.cancelled = ['조회 취소됨', '요청이 취소되었습니다. 데이터 카드는 표시하지 않았습니다.']`
- `app/canvas.js:592` — `REST_RETRY_STATES = new Set(['timeout','cancelled','error'])`

#### (2) Paper 원문
- 보드 부제 `1ISL-0`: `중단돼도 질문과 이미 확인한 값은 사라지지 않습니다`
- 사용자 취소(`1SUJ-0`): 제목 `사용자 취소` / `거래대금 상위 저평가 종목 · 2026-08-31 09:40` / 사실행 `삼성전자 2.14조 · SK하이닉스 0.94조 · 현대차 0.53조 · KOSPI · 거래대금 상위 · PER 20배 이하 · 자동 재실행 안 함` / 행동(`1SUO-0`) `결과 유지 · 다시 검색`

#### (3) 변경 내용
취소 시 **이미 도착한 dataset 부분 결과를 봉투에 실어** 카드를 유지하고, 상태 배지만 `취소됨`으로 낮춘 뒤 `결과 유지 · 다시 검색` 행동을 붙인다. 결과가 **전혀 없을 때만** 현재의 빈 취소 카드를 쓴다.

### 17-C. 인증 만료 상태가 캔버스에 없다 (1IG3-0)

#### (1) 바꿀 파일과 줄
- `app/lib/auth-screen.js:17` — `expired` 라벨(온보딩 화면에만)
- `app/canvas.js:1900-1907` — `renderStatusCard`(oauth_lifecycle + 만료 시각 행)
- `app/canvas.js:592` — `REST_RETRY_STATES`에 인증 상태 없음
- `app/lib/integrated-card-surface.js` — 카드 표면 상태 분류

#### (2) Paper 원문 (1SUQ-0)
제목 `인증 만료` / `내 계좌 · 보유종목 · 2026-08-31 09:33` / 사실행 `평가금액 89,760,240원 · 8종목 · 키움증권 끝 4721 · 이전 값 읽기 전용 유지 · 주문과 새 조회는 재연결 후 가능` / 행동(`1SUV-0`) `계좌 다시 연결`

#### (3) 변경 내용
인증 만료를 봉투 `state`로 추가하고, 해당 계좌 카드에 **읽기 전용 배지 + `계좌 다시 연결` 버튼**(설정 › 계좌 인증으로 이동)을 붙인다. **새 조회·주문 진입점만 비활성화하고 이미 그려진 값은 지우지 않는다.**

### (4) 잠글 단위 테스트
`app/lib/integrated-card-surface.test.js`(기존 — 이미 `order routing and state tokens are localized before reaching product text`(:87) 같은 지역화 단언을 갖고 있다):
- `test('빈 상태 문구에 내부 필드명이 없다 — candles·records가 사용자에게 보이지 않는다')`
  단언: 상태 문구 사전에 `/candles|records|--allowedTools/` 불매치.
- `test('모든 상태 카드가 다음 행동을 하나 이상 갖는다')`
  단언: 각 상태 모델의 `actions.length >= 1`.
- `test('사용자 취소는 이미 받은 결과를 유지한다')`
  단언: `buildCancelledState({ partial: [{…}, {…}] })` → `{ keepResults: true, badge: '취소됨', action: '결과 유지 · 다시 검색' }`.
- `test('부분 결과가 하나도 없을 때만 빈 취소 카드다')`
  단언: `partial: []` → `{ keepResults: false }`.
- `test('인증 만료는 이전 값을 읽기 전용으로 남기고 계좌 다시 연결을 준다')`
  단언: `{ readOnly: true, values: preserved, action: '계좌 다시 연결', blocks: ['order','newQuery'] }`.
- `test('인증 만료가 이미 그려진 값을 지우지 않는다')`.

### (5) 부작용 위험 / 계약
- `REST_RETRY_STATES`(`canvas.js:592`)에 인증 상태를 넣으면 재시도 버튼(`attachRestRetryAction`, `:596`)이 붙는다 — 인증 만료는 **재시도가 아니라 재연결**이므로 별도 상태로 둔다.
- `rest-dataset-runner.js`가 부분 결과를 실어 보내면 봉투 크기가 커진다 — deadline 이후 도착분은 제외한다.
- **실주문 하드락**: 인증 만료 시 주문 진입점을 반드시 막는다.
- `rest-canvas-paint.test.js`가 잡는 페인트 경로를 깨지 않는다.

### (6) 크기 / 의존
- 17-A **S**(문구 4개), 17-B **M**, 17-C **M**. 17-A는 즉시 가능. 17-B/C는 봉투 스키마를 넓히므로 main 프로세스 동반 수정.

---

## 18. 1TPF-1 / 1WSI-1 / 42FW-1 / 405P-1 — 백테스트 4건

### 18-A. 1TPF-1 수집 중 「중단」이 없다

#### (1) 바꿀 파일과 줄
- `app/lib/backtest-canvas.js:5170-5188` — `renderRunning()`. 제목 `진행 중` / 부제 / 진행 막대 / TR 로그 한 줄. **`button()` 호출 0회.**
- `app/lib/backtest-canvas.js:940` — `stopPolling()` (모드 이탈 시 폴링만 멈춤, 백엔드 잡은 계속 돈다)
- `app/shell.css:1630-1641` — `.backtest-progress-*` 에 중단 스타일 없음

#### (2) Paper 원문 (1TPF-1 › 1TQV-1)
- 버튼 `중단` (pill, `border-k-line`, `--color-k-soft`, padding 7/20)
- 옆 문구 `끝나면 바로 백테스트가 이어집니다` (11px, `--color-k-hint`)
- 같은 규율: 보드 10 `2HQI-2` 「막다른 길을 만들지 않습니다」

#### (3) 변경 내용
`renderRunning()`에 `중단` 버튼을 세우고 잡 취소 IPC를 붙인다(없으면 백엔드 `DELETE /jobs/{id}` 한 줄). 취소가 아직 없다면 최소한 `진행은 백그라운드에서 계속됩니다 — 나갔다 오면 이어집니다`를 적어 사람이 지금 무엇을 할 수 있는지 알게 한다. `1TQY-1` 문구도 함께 올린다.

### 18-B. 1WSI-1 비교 패널에 파라미터·코드 diff 두 칸이 없다

#### (1) 바꿀 파일과 줄
- `app/lib/backtest-canvas.js:5411-5443` — `renderCompare(a, b)`. 지표 4행(`총수익률`·`Sharpe`·`MDD`·`승률`, :5416-5421) + 겹쳐보기 곡선만.
- `app/probe-backtest-full.js:2097` — `H06 '이력 비교에는 파라미터·코드 diff가 없다(미구현 계약)'`
- 재사용 가능: `app/lib/backtest-code-editor.js:505` `renderDiff` (보드 02·09가 이미 쓰는 같은 문법)

#### (2) Paper 원문 (1WSI-1 › 1WYY-1, `bg-k-panel`, radius 16, padding 24)
- 제목: `#41 vs #38 — 무엇이 달랐나`
- 두 칸(`bg-k-panel3`, radius 8, padding 12/16):
  - `파라미터 diff`(10px `--color-k-hint`) / `fast 10→20 · slow 40→60`(12px mono)
  - `코드 diff` / `v3→v4 · 12줄 (ATR 손절)`
- 그 아래 겹쳐보기 곡선(brand / navy) + 범례 `#41 · MDD -27.9% · Sharpe 0.87` / `#38 · MDD -34.6% · Sharpe 0.51`
- 보드 머리말 `1WSL-1`: 같은 버전·같은 파라미터·같은 구간이면 같은 결과가 나와야 한다

#### (3) 변경 내용
`renderCompare(a, b)`에서 두 실행의 `spec.params`를 키 단위로 비교해 `fast 10→20 · slow 40→60` 한 줄을 만들고, 두 실행에 묶인 `strategy_version`의 source를 `backtest-code-editor.js renderDiff(:505)`로 그린다. **`probe-backtest-full.js:2097`의 H06 단언을 '있다'로 뒤집는다.**

### 18-C. 42FW-1 유효 종료를 비운 배포가 active로 보인다

#### (1) 바꿀 파일과 줄
- `app/lib/backtest-canvas.js:5719-5736` — `limits` 기본값에 `valid_to: ''`(:5722), 6칸 `textField` 행(:5726-5736)
- `app/lib/backtest-canvas.js:5738-5754` — `이 전략을 실전에 겁니다` → `valid_to: String(limits.valid_to)`(:5751)를 그대로 전송
- `backend/athena_api/backtest/deploy.py:109-110` — `is_expired`가 `today > ''`를 참으로 본다
- `backend/athena_api/backtest/deploy.py:168-170` — `blocked_reason='expired'`, `배포 유효기간이 지났습니다`
- `app/lib/backtest-canvas.js:5580` 부근 — 배포 행 상태는 여전히 `active`

#### (2) Paper 원문 (42FW-1)
- 머리 `42NE-1`: `한도 — 미리 승인하는 범위`
- 경고 `42NF-1`: `비워둘 수 없습니다. 한도 없는 자동 주문은 이 화면이 약속한 것이 아닙니다.`
- 예시 값: 유효 시작 `20260903`(42NT-1) · 유효 종료 `20261231`(42NX-1) — **둘 다 채워져 있다**

#### (3) 변경 내용
`renderDeployForm`에 Paper 두 줄(`한도 — 미리 승인하는 범위` · `비워둘 수 없습니다…`)을 세우고, `valid_to`(및 나머지 5칸)가 비면 `이 전략을 실전에 겁니다`를 **비활성**으로 두고 이유를 그 자리에 적는다. 기본값을 비워 두려면 최소한 만들기 전에 막는다 — 지금은 사람이 '켰다'고 믿는 배포가 조용히 한 건도 내지 않는다.

### 18-D. 405P-1 origin=visual 버전 활성화 UX가 없다

#### (1) 바꿀 파일과 줄
- `app/canvas.js:3181-3187` — `activate: async (strategyId, versionId) => … 'athena:backtest-activate'` (배선 존재)
- `app/lib/backtest-canvas.js` — **`activate` 호출 0건**(grep 매치 없음)
- `app/lib/backtest-canvas.js:4325-4338` — 이력 되열기는 `designTab`만 고르고 읽기 전용으로 연다

#### (2) Paper 원문
- 행 6 의도: `활성화·실행은 별도 승인 UX`
- 구현 상태(`4070-1`/`4071-1`): `활성화 UX가 백테스트 화면에 없다`
- 편차 `402S-1` `4053-1`: `8. 활성화 버튼이 어디에도 없다`, 비용 `작음`

#### (3) 변경 내용
이력 탭 버전 행에 `[이 버전 켜기]`를 붙여 `deps.activate(strategyId, versionId)`로 잇고, 실행 버튼과 구분되는 확인 문구(무엇이 켜지는가 · 현재 활성 버전이 무엇인가)를 함께 세운다.

### (4) 잠글 단위 테스트 — `app/lib/backtest-canvas.test.js` (기존)
- `test('수집 중 화면에 중단 버튼과 이어짐 안내가 있다 — 막다른 길이 아니다')`
  단언: `renderRunning()` DOM에 `button` 1개(`중단`) + 텍스트 `끝나면 바로 백테스트가 이어집니다`.
- `test('중단을 누르면 잡 취소 IPC를 부른다 — 폴링만 멈추지 않는다')` — `deps.cancelJob` 호출 확인.
- `test('비교 패널에 파라미터 diff와 코드 diff 두 칸이 선다')`
  단언: `renderCompare(a, b)` DOM에 `파라미터 diff` · `코드 diff` 라벨 각 1개.
- `test('파라미터 diff는 키 단위로 변한 값만 적는다')` — `fast 10→20 · slow 40→60` 형식.
- `test('유효 종료가 비면 실전 배포 버튼이 비활성이고 이유가 적힌다')`
  단언: 버튼 `disabled === true` + `비워둘 수 없습니다. 한도 없는 자동 주문은 이 화면이 약속한 것이 아닙니다.` 존재.
- `test('한도 6칸이 모두 차야 배포가 만들어진다')` — `createDeployment` 호출 0회.
- `test('이력 탭 버전 행에 이 버전 켜기가 있고 activate를 부른다')`
  단언: `deps.activate`가 `(strategyId, versionId)`로 호출.
- `test('활성화는 실행과 다른 버튼이고 현재 활성 버전을 함께 말한다')`.
- **`app/probe-backtest-full.js:2097` H06 단언 뒤집기 필수.**

### (5) 부작용 위험 / 계약
- **기법 카드에 가짜 v7/거래 수를 만들지 않는다**(`paper-parity-remaining.md` 잠금).
- 백테스트 첫 표면은 Paper 19(`40EV-1`) — 탭 `기법/결과/이력`, 2열 목록, `presets[0]` 자동 선택 금지, 영문 pydantic 배너 금지. **이 항목들이 첫 표면을 건드리면 회귀다.**
- 채팅 머리 문구 `기법에게 묻기` / `고른 기법을 다룹니다` 유지.
- 18-C는 백엔드 `deploy.py`와 한 벌 — 프런트만 막으면 기존 빈 `valid_to` 배포는 여전히 `active`로 보인다. **기존 배포 마이그레이션/표시 정정**도 범위에 넣을지 결정 필요.
- 18-A의 잡 취소 IPC가 없으면 문구만 올리는 축소안으로 내려간다.

### (6) 크기 / 의존
- 18-A **M**, 18-B **M**, 18-C **M**(백엔드 포함 L), 18-D **S**. 묶으면 **L**.
- 18-D는 배선이 이미 있어 가장 싸다 — **먼저**.

---

## 19. 15Y5-2 — 레거시 실시간 호가 사다리가 좁은 창에서 열을 줄이지 않는다

### (1) 바꿀 파일과 줄
- `app/styles/card-kind-hoga.css:102-108` — `.card-kit-hoga-live-columns, .card-kit-hoga-live-row { grid-template-columns: 58px minmax(72px,1fr) 66px 88px minmax(78px,1fr); column-gap: 8px; }` → **최소 ~418px** (5열 + 8px×4 gap + 12px×2 padding)
- `app/styles/card-kind-hoga.css:117-118` — 열 머리 `font-size: 9px`
- `app/styles/card-kind-hoga.css:131-132` — 행 `font-size: 10px`
- 컨테이너 폭 규칙 **0개** (이 파일엔 `prefers-reduced-motion` 미디어 쿼리만)
- `app/lib/card-kind-호가.js:376-378` — 단수가 `state.marketMode`로만 결정(정규장이면 10단 고정)
- `app/shell.html:454`
- `docs/ui/paper-card-surface-charter.md:27` — 헌장 11조(판단 텍스트 12px 이상) **위반**
- `docs/architecture/canvas-tabs-responsive-plan.md §2` — 「호가 사다리·AITS 차트는 전문 렌더러가 자체 반응형(사다리 10단→5단)」 약속

### (2) Paper 원문 (15Y5-2 › 15ZZ-2, 350×355 카드, 390px 창)
- 2열 구조: 열 머리 `매도 호가 ↑` / `잔량` (11px, `--color-k-faint`)
- 매도 3단(`bg #EDF4FF`): `150,880 / 16,224`, `150,870 / 12,841`, `150,860 / 8,402` — 가격 `--color-down`, 잔량 검정, **둘 다 16px mono**
- 구분 바 3px `bg-k-text`
- 매수 3단(`bg #FFF0F0`): `150,850 / 10,773`, `150,840 / 14,602`, `150,830 / 11,381` — 가격 `--color-up`
- 카드 `bg-k-panel`, radius 18, padding 14, gap 6, 행 padding 16 radius 8

### (3) 변경 내용
1. `card-kind-hoga.css`에 **컨테이너 쿼리**를 넣어 XS(예: `@container (max-width: 420px)`)에서 **건수 · 증감 · 상대 잔량** 열을 감추고 `가격` · `잔량` 2열만 남긴다.
2. 렌더러(`card-kind-호가.js`)가 컨테이너 폭에 따라 표시 단수를 10 → 5 → 3으로 줄인다(현재는 `marketMode`로만 결정).
3. **판단 텍스트를 12px 이상으로** 올린다(행 10px → 12px 이상, 열 머리 9px → 11px). 헌장 11조 준수.

### (4) 잠글 단위 테스트 — `app/lib/card-kind-호가.test.js` (기존)
- `test('좁은 폭에서는 표시 단수가 10단에서 줄어든다')`
  단언: `visibleLevels({ marketMode: 'regular', width: 390 }) === 3`, `width: 600` → `10`.
- `test('단수 축소는 marketMode를 바꾸지 않는다')` — 정규장 라벨 유지.
- `test('좁은 폭에서는 가격·잔량 2열만 남는다')`
  단언: `visibleColumns({ width: 390 })` === `['price','qty']`.
- CSS 단언: `test('호가 행 글자는 12px 이상이다 — 헌장 11조')`
  단언: `card-kind-hoga.css`를 읽어 `.card-kit-hoga-live-row`의 `font-size`가 `10px`가 아니다.
- `test('호가 CSS에 컨테이너 폭 규칙이 있다')` — `@container` 매치.

### (5) 부작용 위험 / 계약
- 「카드 트랙은 주 체크아웃에서」 — 자동 워크트리엔 `node_modules`·venv가 없어 카드 게이트를 못 돌린다. 이 항목은 **주 체크아웃**에서 진행.
- 카드 표면 헌장(표현 3층 · 밀도 예산 · 리드→그룹→게이트 계층) 준수 — 열을 줄이는 것이 밀도 예산과 맞는지 확인.
- `card-kind-호가.test.js`의 `detectLadderShape`(`:86-107`) / `buildOrderbookState`(`:117-177`) 계약은 **데이터 모델**이라 건드리지 않는다 — 표시 단수만 바꾼다.
- `supportsLive0D`(`:21`) 구독 허용 규칙 유지.
- AITS 차트와 같은 "전문 렌더러 자체 반응형" 약속을 지키는 방향이라 문서와 일치한다.

### (6) 크기 / 의존
- **M**. 독립. 카드 트랙.

---

## 20. 45S8-0 — 카드미니 table 문법 17장이 라벨→값 2열로 그려진다

### (1) 바꿀 파일과 줄
- `app/orb.js:1976-1982` — `else` 분기: `compound`·`chart`만 전용 배치를 갖고 **나머지 전부** `.orb-kiumi-list`(라벨 좌 / 값 우)로 떨어진다
- `app/orb.css:915-925` — `.orb-kiumi-row { grid-template-columns: minmax(0,1fr) minmax(116px,1.35fr); }` — **2열 고정**
- `backend/ref/kiumi/kiumi-ledger.jsonl` `13BC-2` — `elements`가 라벨/값 쌍 3개, **열 정의가 계약에 없다**
- `app/lib/orb-mini-card.js` — `buildOrbKiumiCard` 표시 계획
- 실측: `app/captures/kiumi-96/table.png` — `매도호가10 150,940 / 매도호가수량10 2,160 / 매도호가9 150,930` (헤더도 순위 열도 없음)

### (2) Paper 원문 (H-1 `45S8-0` template/table, 360×420)
- 카드: `bg-k-panel`, border `--color-k-line`, radius 12, padding 16, gap 12
- 머리: 좌 `표형`(10px 600 `--color-k-dim`) / 우 `기준 09:42`(mono) → 제목 `거래대금 순위`(15px `font-strong`)
- **표 그리드: `grid-template-columns: 34px 118px 118px 64px`**
- 헤더 행(10px `--color-k-faint`): `순위` / `종목` / `현재가`(우측 정렬) / `등락`(우측 정렬)
- 행 예: `01` / `삼성전자` + `005930` / `149,000` / `+1.24%`(up)
- 발치: `외 47건 접힘 · 원본에서 확인`
- 미니 자매 보드: `46IV-0` `순위/종목/현재가/등락`, `46FL-0` `순서/단계/가격/잔량`, `4744-0` `순서/항목/값/비고`

### (3) 변경 내용
**스키마 변경 없이 앱만 고칠 수는 없다.** 원장(`kiumi-ledger.jsonl`)의 `elements`가 라벨/값 쌍이라 열 정보가 계약에 존재하지 않는다.

두 갈래 — **사용자 결정 필요**:
- (a) **열 표 복원**: 원장 스키마에 **열 정의**(band=row인 element들을 한 행으로 묶는 그룹 키 + 열 헤더 배열)를 먼저 넣는다. 그 뒤 `orb-mini-card.js`가 `grammar === 'table'`일 때 `{ columns: ['순위','종목','현재가','등락'], rows: [...] }` 계획을 만들고, `orb.js`에 `table` 전용 분기 + `orb.css`에 `grid-template-columns: 34px 118px 118px 64px`(360px 카드 폭 기준, 코드 카드는 320이므로 비율 조정 필요) 추가.
- (b) **라벨/값 재승인**: 열 표를 포기하고 Paper H-1의 table 템플릿 17장을 라벨/값 형태로 다시 그려 정본을 일치시킨다.

### (4) 잠글 단위 테스트 — `app/lib/orb-mini-card.test.js` (기존)
(a)안 기준:
- `test('table 문법은 열 헤더 4개를 계획에 싣는다')`
  단언: `buildOrbKiumiCard(tableEnvelope).columns` === `['순위','종목','현재가','등락']`.
- `test('table 행은 열 수만큼의 셀을 갖는다 — 라벨/값 2열이 아니다')`
  단언: `plan.rows[0].cells.length === 4`.
- `test('열 정의가 없는 원장 봉투는 table 계획을 만들지 않는다 — 열을 지어내지 않는다')`
  단언: 구 스키마 봉투 → `plan.grammar !== 'table'` 또는 `columns === null`.
- `test('접힌 건수 고지는 Paper 문구를 쓴다')` — `외 N건 접힘 · 원본에서 확인`.
- 기존 `test('승인된 카드미니 프레임은 360×420이다')`(:10) 유지.

### (5) 부작용 위험 / 계약
- **카드미니 360×420의 실제 폭**: 420만 하드핀이다. 360은 오브 창 폭이고 **코드 카드는 320**이다 — Paper의 `34px 118px 118px 64px`(합 334 + gap)는 320 카드에 그대로 들어가지 않는다. 비율 그리드로 옮겨야 한다.
- **키우미 얼굴 1종** 잠금 유지.
- **Paper 카드미니가 원장과 어긋난다**(84/96에 다른 보드 값이 섞였고 Paper를 검사하는 게이트가 없다) — 이 항목을 하기 전에 원장/Paper 정합을 먼저 맞추지 않으면 잘못된 열 정의를 고정하게 된다.
- `check-orb.mjs` 계약(입력창 최대 1, 실행 버튼 0) 무관하지만 같은 오브 트랙.
- 원장 스키마 변경은 **백엔드 + 저작 팩(`backend/ref/card-surface-authoring/packs`) + 앱** 3곳을 동시에 건드린다.

### (6) 크기 / 의존
- **L** (스키마 변경 포함). 선행: (a)/(b) 사용자 결정 + 원장↔Paper 정합. **마지막**.

---

# 추천 실행 순서

작고 독립적인 것부터. 각 줄 끝은 크기와 선행 조건.

## 1군 — 한 줄~세 줄, 위험 거의 없음 (즉시)

| # | 항목 | 파일 | 크기 |
| --- | --- | --- | --- |
| 1 | **11** 「열리지 않는 것」 색 (`#F2F4F8` → `var(--color-k-text)`) | `app/styles/settings-cards.css:249` | S |
| 2 | **13** 「모델 팝오버(보드 09)」 제거 | `app/chat.js:2698` | S |
| 3 | **17-A** 빈·거부 문구 4개 사용자 언어로 | `app/canvas.js:682,688,1919,2043` | S |
| 4 | **10** 복원 실패 턴 존댓말 + `reason` 읽기 | `app/lib/routine-turn.js:85-92` | S |
| 5 | **8-B** 핑크 점선 상위 3건 제한 | `app/lib/graph-mode/live-map.js:207,217-224` | S |

## 2군 — 작지만 게이트/프로브 동반 수정 (한 커밋에 묶어야 함)

| # | 항목 | 동반 수정 | 크기 |
| --- | --- | --- | --- |
| 6 | **14** 이중 제어 규칙 3줄 + 캡션 | `probe-agent-paper-parity.js:229` | S |
| 7 | **12** 부팅 회색 ATHENA | `verify.js:594-596,668,707` **필수** | S (+결정) |
| 8 | **18-D** `[이 버전 켜기]` (배선 이미 존재) | — | S |

## 3군 — 단일 표면 M

| # | 항목 | 크기 |
| --- | --- | --- |
| 9 | **5** 계좌 전환 진입로(`sidebar.js:1051`) | S |
| 10 | **6** 설정 오버레이가 셸을 가린다 + nav 색 | S |
| 11 | **2** 그래프 빈 히어로를 `#graphSummaryMain`으로 이사 | M |
| 12 | **8-A** 미기동 안내를 보이는 표면에 (2 이후) | M |
| 13 | **16** 주문 티켓 총액 추정 + 가격 행 | M |
| 14 | **3** 사이드바 검색 결과 패널 | M |
| 15 | **9** 승인 카드 4필드 (+`verify.js:2229` 갱신) | M |
| 16 | **19** 호가 사다리 컨테이너 쿼리 + 12px | M |

## 4군 — 결정이 선행돼야 하는 것

| # | 항목 | 필요한 결정 | 크기 |
| --- | --- | --- | --- |
| 17 | **7** 오브 표시 모드 / 창 가시성 분리 | 최소화가 모드를 바꾸는가 | M |
| 18 | **1** 설정 4번째 카드 | 성향·이력 복원(a) vs 현행 유지(b) | M~L |

## 5군 — L, 여러 파일·백엔드 동반

| # | 항목 | 크기 |
| --- | --- | --- |
| 19 | **17-B/17-C** 취소 시 결과 유지 · 인증 만료 상태 | M+M |
| 20 | **4** 계좌 등록 3상태 시트 (확인 중 잠금 · 실패 재검증 · 확인 완료) | L |
| 21 | **18-A/B/C** 수집 중단 · 비교 diff · 유효 종료 검사 | L |
| 22 | **15-A/15-B** 제어 결과 4상태 · 자동 검사 5줄 (IPC 선행) | L |
| 23 | **20** 카드미니 table 열 구조 (원장 스키마 선행) | L |

## 순서 근거

- **1군**은 전부 문자열·색·상수 한 곳이라 서로 충돌하지 않고 게이트도 건드리지 않는다. 한 번에 묶어 커밋해도 안전하다.
- **2군**은 코드와 게이트 단언이 **반대 방향으로 고정**돼 있어(12는 `baseIsTransparent`, 14는 `ruleLines`, 9는 `verify.js:2229`) 한쪽만 고치면 즉시 빨개진다. 반드시 한 커밋.
- **11(항목 2) → 12(항목 8-A)** 순서가 중요하다. 둘 다 `#graphSummaryMain`을 채우므로, 히어로를 먼저 옮긴 뒤 미기동 안내의 우선순위(미기동 > 0건 히어로)를 정한다.
- **4군**은 사용자 결정 없이 착수하면 Paper와 앱 중 어느 쪽이 정본인지 모른 채 코드를 고치게 된다. 항목 7·1·12·20이 모두 여기에 걸린다.
- **5군**의 22(제어 결과 턴)는 `emptyHistory` 계약을 깨뜨릴 위험이 가장 크므로 마지막에, 부팅 게이트가 안정된 뒤에.
- **23**(카드미니)은 원장 스키마 + 백엔드 + 저작 팩 + 앱 4곳을 건드리고, 「Paper 카드미니가 원장과 어긋남」이 아직 해소되지 않았다 — 정합 확인이 선행이라 가장 마지막.

## 트랙 분리 권고

| 트랙 | 항목 | 워크트리 |
| --- | --- | --- |
| 셸·설정 | 1, 4, 5, 6, 11, 3 | 주 체크아웃 |
| 그래프 | 2, 8-A, 8-B | 주 체크아웃 |
| 에이전트 | 14, 15 | `feat/agent-dual-control` 워크트리 (에이전트 코드는 origin/main 기반 별도 워크트리에서만) |
| 카드 | 17, 19, 20 | 주 체크아웃 (자동 워크트리엔 `node_modules`·venv가 없어 게이트를 못 돌린다) |
| 백테스트 | 18 | 주 체크아웃 |
| 오브·키우미 | 7, 12, 13, 20 | 주 체크아웃 |

주의: 워크트리 venv 교차오염 — 남의 워크트리 테스트를 내 venv로 돌리면 거짓 실패가 난다.
