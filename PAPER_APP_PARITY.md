# Paper → 실앱 적용 대응표

기준 시각: 2026-09-06 KST<br>
Paper 파일: `01M0VGPX92K1TER4ZV9PWGQJJZ` — `Athena — 코드 기반 화면 (chat · canvas · settings · orb)`<br>
현재 범위: **10 페이지 444 보드 전수**

| Paper 페이지 | 보드 | 이 문서의 절 |
| --- | ---: | --- |
| 화면 (`1-0`) | 45 | [화면 페이지](#화면-페이지--45) |
| 그래프 (`D-2`) | 7 | [그래프 페이지](#그래프-페이지--7) |
| 에이전트 (`A-2`) | 12 | [에이전트 페이지](#에이전트-페이지--12) |
| 플러그인 (`B-2`) | 9 | [플러그인 페이지](#플러그인-페이지--9) |
| 키우미 (`C-2`) | 9 | [키우미 페이지](#키우미-페이지--9) |
| 카드 (`5-1`) | 104 | [카드 페이지](#카드-페이지--104) |
| 카드미니 (`H-1`) | 203 | [카드미니 페이지](#카드미니-페이지--203) |
| 증명 (`F-1`) | 12 | [증명 페이지](#증명-페이지--12) |
| 백테스트 (`8-1`) | 26 | [백테스트 페이지](#백테스트-페이지--26) |
| 백테스트 구현 현황 (`G-1`) | 17 | [백테스트 구현 현황 페이지](#백테스트-구현-현황-페이지--17) |

보드 목록의 정본은 저장소 안에 있다 — `backend/ref/paper-ledger/manifest.json` 444행(페이지 귀속과 역할은 이 매니페스트만 정본이고, 원장 JSON의 `page` 필드는 추출기가 상수로 박은 값이라 믿지 않는다). 역할 9종 배정은 `screen` 103 · `card_template` 96 · `mini_card` 192 · `mini_template` 11 · `record` 17 · `contract` 12 · `card_spec` 8 · `reference` 3 · `retired` 2 이며 `card_template` 96은 `backend/ref/card-surface-templates/index.json`과 정확히 상등이다.

## 판정 어휘

| 낱말 | 뜻 |
| --- | --- |
| `적용 · 게이트` | 실앱이 그 보드의 화면에 도달하고 대표 문구가 Paper와 같다는 것을 `verify:paper-screens` 전수 실행이 실제로 쟀다. `app/lib/paper-screens-ratchet.json`의 잠금 집합에 들어 있다(53장과 1:1). **게이트가 재는 것은 도달과 대표 문구뿐이다** — 2026-09-05 전수 대조가 `부분`이라 한 보드 40장과 `불일치`라 한 1장도 이 낱말을 받는다. 미비의 수는 분포표의 「그중 …」이 세고, 개별 사유가 확인된 보드에 한해 판정 칸 뒤에 `· 부분 —` 또는 `· 불일치 —`로 적는다 |
| `적용` | 실앱에 대응 표면이 있고 2026-09-05 전수 대조에서 어긋난 항목이 없다. 괄호 안 해시는 그 발견을 닫은 이 트랙의 커밋이다 |
| `부분` | 대응 표면은 있으나 Paper가 말한 요소·상태 일부가 아직 없다 |
| `불일치` | 표면은 있는데 Paper와 다른 것을 그린다 |
| `미구현` | Paper가 정의한 표면이 앱에 없다 |
| `폐기` | Paper 또는 사용자 결정으로 그 표면을 만들지 않기로 했다 |
| `Paper 낡음` | 앱이 앞서고 보드가 뒤처졌다. 사용자 지시 「카드는 Paper와 동일하게 그린다」의 예외는 아니며, 보드 갱신 대상이다 |
| `대조 대상 아님` | 실앱 렌더 대상이 아닌 검증 장치 보드다 |
| `미판정` | 2026-09-05 전수 대조의 표본 밖이다. 지어낸 판정을 적지 않는다 |

판정의 근거는 두 가지뿐이다 — 2026-09-05 Paper × 실앱 전수 대조(보드별 근거는 이 문서의 각 절에 실앱 파일·줄로 적혀 있다)와, 저장소가 실제로 돌리는 Paper 게이트다.

## 페이지별 판정 요약

| Paper 페이지 | 보드 | 판정 분포 |
| --- | ---: | --- |
| 화면 (`1-0`) | 45 | 적용 · 게이트 27(그중 전수 대조 부분 23) / 부분 11 / 적용 5 / Paper 낡음 1 / 폐기 1 |
| 그래프 (`D-2`) | 7 | 적용 · 게이트 6(그중 전수 대조 부분 4) / 부분 1 |
| 에이전트 (`A-2`) | 12 | 적용 · 게이트 7(그중 전수 대조 부분 6 · 불일치 1) / 부분 2 / 불일치 1 / 미구현 1 / 적용 1 |
| 플러그인 (`B-2`) | 9 | 적용 · 게이트 9(그중 전수 대조 부분 5) |
| 키우미 (`C-2`) | 9 | 적용 · 게이트 4(그중 전수 대조 부분 2) / 적용 3 / 폐기 1 / 부분 1 |
| 카드 (`5-1`) | 104 | 부분 72 / 적용 22 / 불일치 5 / 미판정 4 / 미구현 1 |
| 카드미니 (`H-1`) | 203 | 미판정 180 / Paper 낡음 13 / 부분 7 / 불일치 2 / 적용 1 |
| 증명 (`F-1`) | 12 | 대조 대상 아님 9 / 부분 3 |
| 백테스트 (`8-1`) | 26 | 부분 20 / 폐기 4 / 미구현 1 / Paper 낡음 1 |
| 백테스트 구현 현황 (`G-1`) | 17 | 적용 11 / Paper 낡음 6 |

## Paper 게이트

| 게이트 | 무엇을 재나 |
| --- | --- |
| `npm run verify:paper-manifest` | 원장 444행 불변식 — 페이지 귀속·역할 폐쇄집합·`card_template` 96 상등·해시 재현 |
| `npm run verify:paper-screens` | 화면계 115 보드를 실앱에서 밟아 대표 문구를 잰다. 통과분은 `app/lib/paper-screens-ratchet.json`에 잠근다(현재 **53장**, `--allow-shrink` 없이는 줄어들 수 없다) |
| `npm run verify:paper-cards-all` | 카드 104 — 정적 대조(`paper-cards-static`) + 실앱 마운트(`probe-paper-cards-mount`) |
| `npm run verify:paper-mini` | 카드미니 203 — 실카드 192 정적 대조(`paper-mini-static`) + 견본 11 실렌더러(`probe-paper-mini-template`) |
| `npm run verify:kiumi-cards` | 카드미니 실카드 96장을 실제 오브 대화 경로로 흘려 높이·레이아웃을 잰다 |
| `npm run verify:paper` | 위를 묶은 전수 스위트(기본 스위트와 분리돼 있다) |

`verify:paper-mini`는 지금 **빨간 게이트**다. Paper H-1과 `backend/ref/kiumi/kiumi-ledger.jsonl` 96행이 실제로 어긋나 있고, 게이트는 그것을 초록으로 만들지 않는다 — 어긋난 보드 목록 자체가 산출물이다(`app/captures/paper-gates/PAPER-MINI.json`). 대장을 Paper로 덮는 것은 `paper_cross_board`가 0이 된 뒤의 일이라고 `backend/ref/kiumi/README.md`가 순서를 못박았다.

---

## 화면 페이지 — 45

셸·부팅·온보딩·설정·인증·주문·모드 전환·세션 이력이 사는 페이지다. 실앱의 모드 계약은 대화/이력 셸을 유지하고 중앙 캔버스만 `대화 · 그래프 · 에이전트 · 플러그인 · 백테스트`로 전환한다.

**2026-09-06 정정 세 가지.** ① 이 페이지는 45장이고 이전 판의 「60/60」 표는 Paper에서 사라진 보드 7장(37·38·39 이전 셸 v2 참고 · 51 · 52 · 55 리퀴드 글래스 배경 · 57 굴절 재질)을 계속 세고 있었다. ② 부팅 표면의 소유 파일은 `boot.css`·`boot.js`가 아니다 — 그 두 파일은 저장소에 없고, 실제 소유자는 `app/shell.html:30`의 `#boot`와 `app/chat.css`의 `.boot` 계열, `app/chat.js`의 부팅 생애주기다. ③ 설정 좌측 nav 4종은 `화면 · 계좌 · 모델 · 성향・이력`이다(`app/lib/settings-cards.js`의 `NAV_ITEMS`). 「그래프」가 아니다 — 수집·노출 토글은 2026-09-06에 그래프 모드 「수집·노출」 탭이 단독으로 가져갔다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `164F-2` · 01 · 화면 정본 — 최신 흐름과 상태 지도 | app/shell.html:82-147 (사이드바 모드 네비) · app/lib/main/conversations.js:237 (대화 레코드 mode) | Paper 낡음 |
| `16OD-2` · 02 · 부팅 — READY · 0–240ms | app/shell.html:30-70 · app/chat.css:7-128 · app/chat.js:532-535 | 적용 · 게이트 |
| `16OJ-2` · 03 · 부팅 — TYPE A→AT · 240–560ms | app/chat.css:66-101 · app/chat.js:536-547 | 적용 · 게이트 |
| `16OQ-2` · 04 · 부팅 — TYPE ATH→ATHE · 560–880ms | app/chat.css:66-101 · app/chat.js:536-547 | 적용 · 게이트 |
| `16OX-2` · 05 · 부팅 — COMPLETE · 880–1440ms | app/chat.css:66-125 · app/chat.js:546-554 | 적용 · 게이트 |
| `16P3-2` · 06 · 부팅 — DIRECT SHELL EXPAND · 1440–1920ms | app/chat.css:130-190 · app/chat.js:345-368 · app/shell.css:38-64 · app/styles/ui-kit.css .titlebar | 적용 · 게이트 |
| `1DX-0` · 07 · 온보딩 — CLI 연결 (AT-SY-002) | app/lib/onboarding.js renderCliStep (107-283) · app/lib/main/cli-accounts.js | 적용 · 게이트 |
| `3VHD-1` · 08 · 그래프 — 되물을 것들 카드 · 지난 대화 읽기 전용 | app/lib/graph-mode/brain-questions.js · app/chat.js:1780-1830·2100-2185 · app/lib/graph-mode/controller.js:377-390 | 적용 · 게이트 |
| `1FN-0` · 08 · 온보딩 — 계좌 연결 (AT-SY-003) | app/lib/onboarding.js renderAccountStep (290-455) | 적용 · 게이트 |
| `25Q-0` · 09 · 셸 — 질문 입력 · Task Canvas | app/shell.html · app/shell.css(268/캔버스/400) · app/chat.js(결과물·출처·하위 에이전트 도크, 경과 헤더, 실행 라인, 잠금 힌트) · app/chat.css:326~400 · app/canvas.js(#grid 모자이크 2열) | 적용 · 게이트 |
| `3KM-0` · 10 · 셸 — 답변 중 · Task Canvas | app/chat.css:416~435(.history:empty) · app/canvas.js:360~450(buildEmptyCanvasSkeleton·appendEmptyCanvasExtras) · app/lib/empty-canvas.js | 부분 |
| `1Y3-0` · 11 · 대화 — 모델 팝오버 · 루틴 승인 | app/chat.js:2415~2500(모델 팝오버) · chat.js:940~962(실패 턴) · chat.js:909~938(중단 접힌 헤더) · lib/routine-turn.js:86~91(복원 실패) · chat.js:3313~3420(승인 카드) · chat.css:567·1658~1680·1772~1776 | 적용 · 게이트 |
| `3JL-0` · 12 · 계정 메뉴 — 설정 진입 | app/lib/sidebar.js buildAccountMenu (1359-1403) · app/shell.html:147-155 · app/shell.css:3236-3272 | 적용 · 게이트 |
| `AJ-0` · 13 · 설정 — 셸 오버레이 | app/shell.html:391-399 · app/chat.js openSettings (1674-1698) · app/lib/settings-cards.js renderNav(160-225)·refreshScreenCard(238-388) · app/chat.css:1587-1637 | 적용 · 게이트 (71c262c) |
| `F9-0` · 14 · 설정 — 계좌 (AT-ST-001) | app/lib/settings-cards.js refreshAccountsCard (397-437)·buildAccountRow(451-528)·buildAccountsTable(530-546) | 적용 · 게이트 |
| `XI-0` · 15 · 계좌 등록 — 인증 확인 중 (AT-ST-002) | app/lib/settings-cards.js openAccountRegisterSheet() (615-803)·accountSheetPhase() verifying(576-593) · app/styles/settings-cards.css .uk-status-dot(251-252) · 캡처 app/captures/SETTINGS-04-accounts-register-sheet.png | 적용 (395e537) |
| `FLM-0` · 16 · 계좌 등록 — 인증 실패 (AT-ST-002) | app/lib/settings-cards.js accountErrorMessage()(555-562)·accountSheetState() 실패 전이(603-609)·onVerify()/onSave() 실패 경로(766-798) | 적용 (395e537) |
| `FPE-0` · 17 · 계좌 등록 — 확인 완료 (AT-ST-002) | app/lib/settings-cards.js ACCOUNT_SHEET_SUCCESS(574)·accountSheetPhase() verified/saving successBox(576-593)·accountSheetState() verified(601)·applyState() successNote 렌더(722-738) | 적용 (395e537) |
| `OJ-0` · 18 · 설정 — 모델 · AI 제공업체 계정 | app/lib/settings-cards.js buildModelSection(1112-1260)·refreshModelCard(1274-1387) | 적용 · 게이트 |
| `1I0-0` · 19 · 인증 — OAuth 토큰 ready | app/lib/auth-screen.js renderAuthTokenStatus()/paint() (55-185) · app/chat.js showAuthConfirm() (664-685) · app/chat.css .auth-timer-*(1384-1436) | 적용 · 게이트 |
| `1KK-0` · 20 · 인증 — 토큰 4상태 | app/lib/auth-screen.js STATE_META(13-18)·stateDot(20-25)·paint()(94-185) · app/chat.css .auth-timer-digits(1411-1422) · app/styles/ui-kit.css .uk-dot(21-29) | 적용 · 게이트 |
| `1M3-0` · 21 · 인증 — 계좌 전환 | app/lib/auth-screen.js openSwitch()/paintSwitch()/confirmSwitch() (286-381) · app/lib/sidebar.js buildAccountMenu() 계좌 전환 항목(1382-1391) · app/chat.css 1466-1490 | 적용 · 게이트 (4487e7e·c78e01e·2864d1b) |
| `1OP-0` · 22 · 주문 — 검토·영향·확인 | app/shell.html:402-408 · app/chat.js:4355-4528 · app/lib/order-ticket.js · app/chat.css:1822-1826 | 부분 (60b80e8) |
| `9GJ-0` · 23 · 주문 — 완료·보류·재시도 | app/lib/order-ticket.js:47-110 · app/chat.js:4489-4527 · app/lib/protected-cards.js:66-96 · app/lib/card-kind-주문.js:63-68 | 부분 |
| `11D-0` · 24 · 주문 — 거래 기능 연결 안내 | app/lib/settings-cards.js:699-815 · app/lib/settings-cards.js:389-542 · app/styles/settings-cards.css:236-292 | 부분 (ae75d89) |
| `AMZ-0` · 25 · 모드 전환 — 대화 유지·작업공간 교체 | app/lib/graph-mode/controller.js applyVisibility() · app/lib/sidebar-mode-nav.js · app/shell.html #sidebarModeNav · app/shell.css #chatRegion | 적용 · 게이트 |
| `COS-0` · 26 · 빈 작업공간 — 대화·그래프·백테스트 | app/canvas.js buildEmptyCanvasSkeleton()/applyEmptyCopy()/appendEmptyCanvasExtras() · app/lib/empty-canvas.js · app/canvas.css:1271-1272 · app/lib/backtest-canvas.js | 적용 · 게이트 (ff3c5ba·ec8c701) |
| `9GI-0` · 27 · 접근성 — 투명도·모션 감소 | app/styles/access.css · app/orb.css:1366-1406 · app/lib/settings-cards.js:371-385 | 부분 |
| `G5B-0` · 28 · Windows 반응형 창 · Snap | app/shell.css:3405-3560 · app/main.js:180-182·310-330·396·489-491·557-568 · app/lib/main/windows-native-shortcuts.test.js | 적용 · 게이트 |
| `GCF-0` · 29 · 프로젝트·최근·새 채팅 | app/lib/sidebar.js makeProjectRow()/renderList()/startNewConversation() · app/lib/sidebar-project-menu.js · app/shell.html:80-155 | 적용 · 게이트 |
| `DH2-0` · 30 · 대화 턴 — 복원 실패 | app/lib/routine-turn.js:86~91 · app/chat.js:2815~2912(renderAgentTurn) · app/chat.css:1658~1680 · backend/athena_api/routines/runtime.py:294~299·368~377 · backend/athena_api/routines/scheduler.py:513~523 | 적용 · 게이트 |
| `2USX-1` · 31 · 설정 — 플러그인 (스니펫 등록·감사 로그) | 해당 없음 — app/lib/settings-cards.js NAV_ITEMS(145-153)·app/chat.js SETTINGS_PANELS(1686-1691)에 항목 없음 | 폐기 |
| `2UWT-1` · 32 · 설정 — 성향·이력 | app/lib/settings-cards.js refreshHistoryCard (1532-1667) · NAV_ITEMS history (152) | 적용 (01b24d3·81ecdc7·d960f3d) |
| `2V0K-1` · 33 · 온보딩 — CLI 연결 실패 (AT-SY-002) | app/lib/onboarding.js renderCliStep 오류 경로 (216-234) · app/lib/main/cli-accounts.js login (314-333) | 적용 · 게이트 (17c0307) |
| `2V27-1` · 34 · 사이드바 검색 — 결과·빈 결과 | app/shell.html:88~96(sidebarSearchToggle·sidebarSearchInput) · app/lib/sidebar.js:22~23·639~642·676·994~1003 | 적용 (09f66b4) |
| `3VIQ-1` · 35 · 대화 이력 — 모드 5구역 · 세션 목록 | app/shell.html:104-146 (#sidebarModeNav), app/lib/sidebar.js, app/lib/sidebar-mode-nav.js, app/lib/session-history-view.js, app/lib/main/conversations.js | 적용 · 게이트 (3ad5c20) |
| `3VS6-1` · 36 · 프로젝트 추가 — 폴더 점유 | app/lib/sidebar.js:317-350 (addProjectFolder·makeProjectAddButton), app/main.js:1528-1550 (athena:project-add) | 부분 |
| `3VV8-1` · 37 · 프로젝트 ⋯ — 고정·탐색기·제거 | app/lib/sidebar-project-menu.js:33-52 (menuItemsFor·removeConfirmState), app/lib/sidebar.js:497-548, 388-436 (makeProjectRemovePanel), app/main.js:1552-1585 | 적용 · 게이트 (3ad5c20) |
| `3VV9-1` · 38 · 펜 — 새 대화창 모드 선택 | app/lib/sidebar.js:352-380 (makeModePicker), app/lib/sidebar-project-menu.js:20-27 (MODE_CHOICES), app/styles/sidebar-session.css:122-150 | 적용 · 게이트 |
| `3W9B-1` · 39 · 동시 실행 — 상태 4종 · 스피너 | app/lib/sidebar.js:213-221 (상태 점), 706-729 (renderRunSummary), app/lib/main/session-bridge.js:179-187, app/styles/sidebar-session.css:31-83 | 부분 |
| `3VVU-1` · 40 · 모드 전환 — 조용한 전환 · 새 대화 | app/lib/sidebar.js:59-105 (modeNav onSelect), app/main.js:5011-5019 (athena:conversations-new), app/lib/main/conversations.js:181-224 | 부분 |
| `3WBZ-1` · 41 · 세션 복원 — 다시 누르면 그대로 | app/chat.js:2128-2186 (restoreConversation), 2189-2212 (openConversation), app/main.js:5008 (conversations-set-active), app/probe-session-restore.js | 부분 |
| `3WOP-1` · 42 · 스냅샷 명세 — 모드별 저장 항목 | app/lib/session-snapshot.js, app/lib/main/session-store.js, app/lib/main/session-bridge.js, app/main.js:4907-4966, app/lib/session-workspace.js | 부분 |
| `3WXE-1` · 43 · 세션 저장 모델 — Open WebUI·Orca 참조 | app/lib/session-snapshot.js:8-200, app/lib/main/session-store.js:19-60, app/lib/main/session-bridge.js:10-16, docs/plans/session-persistence-spec.md | 부분 |
| `3ZPB-0` · 55 · 캔버스 탭 스트립 — 카드 1개 뷰포트 · 승인 대기 | app/lib/canvas-tabs.js · app/styles/canvas-tabs.css · app/styles/board-surface.css · app/canvas.js:186~222(ensureCanvasTabDeck·adoptIntoCanvasTab) | 적용 · 게이트 |

`reference` 3장(`164F-2` 화면 정본 · `3WOP-1` 스냅샷 명세 · `3WXE-1` 세션 저장 모델)은 화면 한 장이 아니라 **설명 보드**다. 앱 라우트를 만들지 않고 계약 문서로만 쓴다.

### 부팅 5단계

| Paper 보드 | 실앱 상태 |
| --- | --- |
| `16OD-2` 02 · READY · 0–240ms | 회색 ATHENA(`#9AA2AE`) + 핑크 커서 |
| `16OJ-2` 03 · TYPE A→AT · 240–560ms | 파란 접두사 타이핑 |
| `16OQ-2` 04 · TYPE ATH→ATHE · 560–880ms | 오버레이 타이핑 진행 |
| `16OX-2` 05 · COMPLETE · 880–1440ms | ATHENA 완성 + 유지 |
| `16P3-2` 06 · DIRECT SHELL EXPAND · 1440–1920ms | 중간 가짜 창 없이 실제 셸 확장 |

`prefers-reduced-motion`에서는 같은 단일 완료 경로를 쓰되 완성 정적 프레임으로 축약한다. 비활성 ATHENA의 회색은 Paper `16OG-2`가 정본이며 3767668이 투명 잔재를 그 색으로 되돌렸다.

---

## 그래프 페이지 — 7

화면 페이지에 있던 그래프 표면이 이 페이지로 정리됐다. `06`·`07` 두 보드는 2026-09-01 전수 검증에서 실앱을 보고 Paper에 나중에 그린 것이다.

**2026-09-06 정정.** 이전 판의 `03`·`04` 행이 인용한 `graph-mode/render.js`와 `renderClusterBubbles()`·`renderClusterMap()`은 존재하지 않는다 — 파일도 함수도 없고 주석에만 남아 있었다. 실제 군집 지도 렌더러는 `app/lib/graph-mode/live-map.js`의 `createLiveMap()`이다(`controller.js:288·319`, `app/canvas.js`, `app/shell.html`). 보드 `04`의 이름도 Paper에서 `노드 선택 · 공통 패널`로 바뀌었다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `3NE-0` · 01 · 셸 — 그래프 모드 · 요약 뷰 | app/shell.html:173-224 (#graphSummaryTable) · app/lib/graph-mode/summary-table.js · theme-clusters.js · hidden-links.js · app/canvas.js:3520-3578 | 적용 · 게이트 |
| `4AN-0` · 02 · 셸 — 그래프 요약 · 행 선택 | app/lib/graph-mode/controller.js:806-1040 (renderPanelContent) · app/canvas.css:561-592 | 적용 · 게이트 |
| `4IA-0` · 03 · 그래프 — 기본 군집 지도 | app/lib/graph-mode/live-map.js · controller.js:1100-1155 (draw) · app/shell.html:229-261 | 적용 · 게이트 |
| `31H-0` · 04 · 그래프 — 노드 선택 · 공통 패널 | app/lib/graph-mode/controller.js:911-1040 · graph-edit-proposal.js | 적용 · 게이트 (3ff1fa4) |
| `2FIA-2` · 05 · 그래프 — 수집·노출·브레인 제어 | app/lib/graph-mode/collection-settings.js · app/shell.html:267-278 (#graphSettingsCanvas) · app/canvas.js:3686-3701 | 적용 · 게이트 |
| `2QA3-2` · 06 · 그래프 — 헤더 필터 (기간·정렬·연결 수) | app/lib/graph-mode/graph-filters.js · graph-mode-prefs.js · app/canvas.js renderFilterChips/wireFilterSelect · app/shell.html:198-200, 251-253 | 적용 · 게이트 |
| `2QCN-2` · 07 · 그래프 — 정직성 상태 (이름·인코딩·빈 값) | app/lib/graph-mode/theme-clusters.js:65-73 · controller.js:62-72, 395-402 · live-map.js · cluster-grouping.js | 부분 (ec8c701) |

2026-09-01 전수 검증에서 정정한 실앱 쪽 괴리(전부 Paper 기준으로 맞췄다):

| 항목 | 옛 상태 | 지금 |
| --- | --- | --- |
| 군집 버블 | 무지개 hue 회전 · 중앙 숫자 없음 · 채움 알파 = 응집도(0.74 → 74%) | Paper 실측 회귀: 반지름 `1.4+5.52√n`, 알파 `0.02+0.19·응집도`, 중앙 구성원 수, 흰 라벨 칩 |
| 2단계 | 펼친 군집 하나만 · 1단계 좌표 재사용(이름표 겹침) | 펼친 군집 + 이웃 1홉, 보이는 부분만 재배치(초점 중앙), 이웃 군집 타원 |
| 공통 패널 | 요약 카드 **안**에 있어 지도에서는 화면에 안 나타남 | 세 표면의 형제 — 요약·지도 어느 쪽에서 골라도 옆에 선다 |
| 패널 내용 | 보강 수 한 줄 + 숨은 연관만 | 헤더 부제(군집·연결·유일 노드 / 보강·최근), 관계 목록 전체, 왜 숨은 연관인가, CTA 리드인 |
| 필터 칩 | 정적 `<span>` — "최근 90일"이라 쓰고 아무것도 안 걸었다 | 기간·정렬·연결 수 실적용 + 기본값 아님을 파란 칩으로 표시 |
| 수집·노출 | 설정 오버레이에만 존재 | 그래프 모드 3번째 탭(보드 `05`) + 브레인 상태 카드 |
| 지도 노드 | 투자자 프로필이 차수 39 허브로 지도를 지배 | 분석용 투영에서 제외 — 그 관계는 노드 속성으로 패널에 |
| 성향 신호 표 | 대상 열에 64자 해시, 관계 배지 `prefers` 원문 | 종류 한글 라벨, 관계 한글 배지, "전체 N개" |
| 히어로 % | 상위 5 표본 — 실측에서 "사실 0% · 추론 100%" | 창 전체 `confidence_counts` |

---

## 에이전트 페이지 — 12

**2026-09-06 정정.** 이 페이지는 12장이다. 이전 판은 머리글에 `6 artboards`라 적고 `01~06` 여섯 행과 `09~12` 네 행, 합쳐 열 행만 두어 `07`·`08` 두 보드에 대응이 없었다.

실앱 소유 표면: `app/lib/agent-canvas.js` · `app/lib/agent-sidebar-list.js` · `app/lib/watch-nodes.js` · `app/lib/watch-check-card.js` · `app/lib/routine-control-turn.js` · `app/canvas.js`(배선) · `app/shell.css`

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `56X-0` · 01 · 셸 — 알림 파생 방 | app/shell.html:314-322 (#roomHeadBanner) · app/lib/sidebar.js:808-928 (notifyRooms) · app/lib/routine-turn.js:57-81 · app/chat.js:2872-2881 (감시 조건 패널) · app/chat.js:62/78 (결과물·하위 에이전트·출처 도크) | 적용 · 게이트 (09acd83·d22eccf) |
| `ARM-0` · 02 · 에이전트 — 알람 센터 · 라이브 관제 | app/lib/agent-canvas.js:127-134(VIEWS)·:288-307(머리·모두 읽음으로)·:560-643(알람 컬럼)·:644-730(라이브 컬럼) | 적용 · 게이트 |
| `B57-0` · 03 · 에이전트 — 실행 이력·결과 | app/lib/agent-canvas.js:309-341(브레드크럼·[이력][설정] 세그먼트)·:745-885(최근 30회·산출물·30회 통계)·:1084-1130(setHistoryTab/openHistory) | 적용 · 게이트 |
| `BIM-0` · 04 · 에이전트 — 프로액티브 | app/lib/agent-canvas.js:344-350(그래프 링크)·:1152-1162(성향 스트립)·:1163-1210(말걸기 가드)·:1240-1290(제안 카드·칩) · app/chat.js:3421-3495(가드 변경 확인 카드) | 적용 · 게이트 |
| `BV0-0` · 05 · 에이전트 — 작업 | app/lib/agent-canvas.js:353-397(작업 뷰 머리·필터·검색·CTA)·:200-277(통계 4장)·:425-490(리스트·제안 미니목록)·:533-547(규칙 3줄)·:1820-1870(상세 머리 제어) | 적용 · 게이트 (3767668) · 불일치 — Paper가 2026-09-03에 이중 제어 시트(`42W3-1`)로 갱신됐고 앱 반영은 보류다(아래 05·06 절) |
| `2IJN-2` · 06 · 에이전트 — 작업 설정 | app/lib/agent-canvas.js:327-341(설정 세그먼트)·:1084-1110(setHistoryTab)·:1000-1060(설정 패널) · app/main.js:1296·1302·1322·1328(routine-update/draft/detail/source-catalog IPC) | 불일치 |
| `432Z-1` · 07 · 에이전트 대화 — 제어 제안 턴 A~E | 없음 — app/main.js:2437-2457이 athena:routine-proposed를 보내고 app/preload.js:325가 통로를 열어 두었으나 렌더러 구독자 0건 | 미구현 |
| `4330-1` · 08 · 에이전트 대화 — 결과 턴 | app/lib/routine-control-turn.js CONTROL_RESULT_KINDS(16-21)·failLead(30-40)·buildControlResultTurn(60-77) · app/lib/agent-canvas.js reportControl(1518-1527)·제안 보류(1281-1288) · app/canvas.js onControlResult(3883-3885) · app/chat.js renderControlResultTurn(3753-3808) | 적용 (0db0399) |
| `43WD-1` · 09 · 에이전트 — 새 알람 · 말로 설명하면 AI가 감시 함수를 만든다 | app/lib/agent-canvas.js (toDraftItem 1355-1365 · renderCodeDetail 1599-1811) · app/chat.js 초안 카드 3319-3417 · app/lib/main/live-prompt.js buildAgentModePrefix 656-678 | 부분 |
| `446V-1` · 10 · 에이전트 — 알람 노드·흐름 · 검사 결과 · 승인 | app/lib/watch-check-card.js checkCardModel 51-92 · app/chat.js renderWatchCheckCard 3199-3277 / 초안 카드 3367-3417 · app/lib/agent-canvas.js makeNodeCard 1528-1597 · 초안 검사 요약 1719-1743 | 적용 · 게이트 (cbe8a1b·f2bada5·1c9a3ef·d8633eb) |
| `44HD-1` · 11 · 에이전트 — 노드에서 ‘이상해요’ → AI가 고치고 다시 검사 | app/lib/agent-canvas.js makeNodeCard 1528-1597 (배지·선택·칩) · app/canvas.js onEditInChat 3407-3424 · app/lib/watch-nodes.js 17-22 | 부분 (13b31ea) |
| `44RV-1` · 12 · 에이전트 — 활성 코드 알람 · 상세·발화 이력 | app/lib/agent-canvas.js statusRowIcon 159-173 · toWatchItem 1318-1333 · renderCodeDetail 1599-1811 · app/lib/watch-nodes.js watchSubLabel/versionLabel 52-64 · app/canvas.js 3455-3486 | 적용 · 게이트 (f7419f4·dd31d7a) |

### 07·08 — 에이전트 대화의 두 턴

`432Z-1`(07 · 제어 제안 턴 A~E)은 열 A~E(작업 설정·알람·제안 채택·뷰 이동·실행)와 「두 입구 · 한 게이트」를 정의한다 — 대화 경로는 `제안 턴 → 사람 칩 클릭 → 게이트`, GUI 경로는 `시트·폼·버튼 → 같은 게이트`이며 D(뷰 이동)만 게이트 없이 렌더러가 옮긴다. 앱에는 아직 그 제안 턴 렌더러가 없다 — `chat.js`에는 플러그인용 `renderPluginProposalTurn`만 있고 에이전트 제어 제안 턴 심볼은 0건이다.

`4330-1`(08 · 결과 턴)은 0db0399로 세웠다(위 표의 「없음」은 수정 전 스냅샷이 남긴 것이라 실제 소유 파일로 바꿨다). 판정·칩·서버 상태 변화 여부를 `app/lib/routine-control-turn.js` 한 표로 두고, 캔버스의 일시중지·재개·취소·승인과 제안 「보류」가 그 결과를 채팅에 남긴다. 실패 리드에서 백엔드 코드 번호는 걷어냈고, 1c9a3ef가 실패 결과 턴의 「다시 시도」를 실제로 같은 제어를 다시 부르는 손잡이로 바꿨다.

### 05·06 — Paper가 앞서고 앱이 뒤처진 자리

Paper `05`·`06`은 2026-09-03 이후 이중 제어(시트·폼·확정 버튼)를 그린다. 앱은 아직 보기 전용 드릴인이다. 3767668이 작업 뷰 하단 규칙을 Paper `C6U-0~C6X-0` 「이중 제어 규칙」 원문으로 되돌려(옛 문구는 GUI 입구를 부정했다) 문면은 맞췄지만, 폼·확정 버튼 자체는 남은 작업이다. `PAPER_DESIGN_AUDIT.md`의 2026-09-01 「드릴인 설정 탭은 보기 전용」 결정은 2026-09-03에 뒤집혔다 — 그 문서의 결정 로그를 읽을 때 이 절을 함께 본다.

### 09~12 — 코드 알람 보드 대조

| Paper 근거 | 앱 구현 |
| --- | --- |
| 보드 12 목록 행 `◆ 코드 감시 · 장중 1분마다` | `statusRowIcon()`의 `code-watch` 분기(◆, 일시중지는 흐리게) + `toWatchItem()`의 `WatchNodes.watchSubLabel()`. 「주기 확인」 폴백으로 절대 안 떨어진다 |
| 보드 12 머리 `활성` · 제목 · `코드 감시 · v2` | `agent-status-badge` + `agent-detail-title` + `agent-code-kind`(해시 앞 6글자). 해시가 없으면 갈래 이름만 남기고 버전을 지어내지 않는다 |
| 보드 12 제어 행 `일시중지` `취소` `고치기 — 말로` | `agent-code-controls` — 앞 둘은 `athena:routine-pause/resume`·`athena:routine-cancel`, 셋째는 채팅으로 넘기는 한 경로 |
| 보드 12 `쿨다운` 표기 | f7419f4 — `86400초`를 「1일」로 고쳤다(한국어 단위 규칙). 머리는 「울린 기록 · 최근」이고, 문은 울린 줄에만 단다 — 억제된 줄은 `—`다(dd31d7a) |
| 보드 10·11 노드 카드 4칸 | `agent-node-card` — 한국어 제목 / 영어 함수명 작게 / 「들어감」 행들 / 구분선 / 「나옴」 굵게. 카드 수 = 감시 함수의 최상위 함수 수 |
| 보드 10 승인 게이트 「입구 둘 · 게이트 하나」 | cbe8a1b — 초안 상세에 승인 패널(안내 한 줄 · `[이 알람 승인][취소]` · 게이트 고지). 채팅 초안 카드와 같은 `athena:routine-confirm` 하나만 부른다 |
| 보드 09 자동 검사 진행 5줄 | f2bada5 — `app/lib/watch-progress-card.js`가 마크 세 종류(`✓ ◐ ○`)와 「격리 실행」 고지를 쥔다. 실값이 없는 줄은 아예 만들지 않고, d8633eb 뒤로는 검사가 못 돌았으면 `1/3`을 통과로 적지 않는다 |
| 보드 11 순환·재검사·한 바퀴 영수증·되돌리기 | **아직 없다.** 노드 행만으로 게이트를 잠근 것은 잘못된 잠금이라 b7b7732가 `44HD-1`을 래칫에서 빼 남은 작업으로 되돌렸다 |

**Paper와 다르게 한 것.** 켜진 알람의 「고치기 — 말로」는 바로 채팅으로 넘어가지 않는다 — 먼저 멈춤을 묻는 줄(`일시중지하고 고치기` · `그대로 두기`)이 상세 안에 뜬다. 켜진 알람의 코드 파일은 백엔드가 덮어쓰기를 막기 때문인데, 거절 사유(코드 번호)는 화면에 옮기지 않고 사람이 할 수 있는 다음 행동 둘만 보여준다. 보드 11의 「되돌리기」·「지난 고침 N건」은 채팅 카드가 소유한 고침 이력이라 캔버스에 중복해 만들지 않았다.

---

## 플러그인 페이지 — 9

**모든 변경은 승인 카드 하나를 지난다(2026-09-03).** 화면의 버튼은 아무것도 실행하지 않는다 — GUI 진입 6종과 모델 제안이 같은 봉투를 만들어 `#pluginCanvas` 안의 승인 카드로 합류하고(`app/lib/plugin-canvas.js` · `app/canvas.js`), 사람의 `[승인]` 하나만 실행 경로다(`app/lib/main/plugin-proposal-registry.js`). 그 아래는 등록·승인·probe·도구 허용·승인 철회·삭제가 전부 `backend/athena_mcp` CLI를 실제로 spawn한다(`app/lib/main/mcp-cli.js` → `app/main.js`의 `athena:mcp-*` 핸들러).

**2026-09-06 정정.** 아트보드 치수는 「01~05·07~09가 1680×986」이 아니다. Paper 실측은 `02` 1680×900 · `03` 1680×972 · `04` 1680×983 · `06` 1680×830이다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `FT6-0` · 01 · 플러그인 — 기능 허용 (AT-ST-006) | app/lib/plugin-canvas.js renderPermissionView() (:766-840) · 캡처 app/captures/03h-plugin-permission.png | 적용 · 게이트 |
| `15J-0` · 02 · 플러그인 — 직접 등록·감사 로그 (관리 뷰) | app/lib/plugin-canvas.js renderManage()(:626-671) + renderAudit()(:469-478) + renderAddSheetBody()(:845-868) | 적용 · 게이트 |
| `CU0-0` · 03 · 플러그인 — 허브·설치 | app/lib/plugin-canvas.js renderHub()(:500-542) + pluginCard()(:205-235) | 적용 · 게이트 (ff9da67) |
| `CVY-0` · 04 · 플러그인 — 관리·마켓플레이스 | app/lib/plugin-canvas.js renderManage()(:626-671) + manageRow()(:608-625) + toggleButton()(:554-594) | 적용 · 게이트 (640b65d) |
| `2NW8-2` · 05 · 플러그인 — 설치 승인 (캔버스 카드) | app/lib/plugin-canvas.js proposalCard()(:1064-1097) + renderInstallSheetBody()(:872-918) | 적용 · 게이트 (b1eb4e3) |
| `2NXS-2` · 06 · 플러그인 — 상태 모음 (6상태) | app/lib/plugin-canvas.js renderHubLists()(:479-499) · renderPermissionView 오류 배너(:789-799) · 재시작 안내(:528-533) · proposalCard 상태(:1008-1027) · setRowError(:595-607) | 적용 · 게이트 |
| `3ZJD-0` · 07 · 플러그인 대화 — 제안 턴 5동작 | app/chat.js renderPluginProposalTurn()(:3843-3847) + app/lib/plugin-proposal.js titleFor/linesFor(:104-171) + plugin-canvas.js proposalCard()(:1064-1097) | 적용 · 게이트 |
| `3ZLW-0` · 08 · 플러그인 대화 — 결과 턴 | app/chat.js athena:plugin-result 구독(:3552-3573) + app/lib/plugin-proposal.js resultTurnCopy/resultTurnModel(:204-251) | 적용 · 게이트 |
| `3ZNO-0` · 09 · 플러그인 창 복원 | app/lib/plugin-canvas.js permissionDraft/keepDraft(:181·:314-338) + app/canvas.js setView 래퍼·pluginRestorePending(:2741-2747·:2841-2854) + app/chat.js:2373 | 적용 · 게이트 |

### 내장 카탈로그 5종 (2026-09-01 실측)

| id | 이름 | 실행 명령 | probe로 확인한 도구 |
| --- | --- | --- | ---: |
| `fetch` | 웹 문서 읽기 | `uvx mcp-server-fetch` | 1 |
| `time` | 시간·시간대 | `uvx mcp-server-time` | 2 |
| `sequential-thinking` | 단계적 사고 | `npx -y @modelcontextprotocol/server-sequential-thinking` | 1 |
| `memory` | 지식 그래프 메모리 | `npx -y @modelcontextprotocol/server-memory` | 9 |
| `korea-stock` | 한국 주식 시세 | `npx -y @drfirst/korea-stock-mcp` | 6 |

설정에는 플러그인 표면이 없다(2026-09-03 사용자 결정). 플러그인 모드 하나가 허브·추천 설치·기능 허용·직접 등록·감사 로그를 전부 맡는다 — 같은 레지스트리를 두 화면에서 부르지 않는다. 이 트랙에서 닫은 것은 셋이다: ff9da67(서버 추가 시트의 확정 버튼을 Paper `02`의 `[등록 제안]`으로 — 그 시트는 아무것도 등록하지 않고 승인 카드를 만들 뿐이다), b1eb4e3(승인 카드 본문에 제공·용도·실행 명령·설치 위치 네 필드 — 그 전까지 모델 제안은 무엇이 실행되는지 못 본 채 승인됐다), 640b65d(관리 행 차례와 등록 제안 근거 줄).

---

## 키우미 페이지 — 9

오브 창과 입력 스트립 키우미는 같은 마스코트의 두 표면이라 한 페이지에서 함께 본다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `DO-0` · 01 · 키우미 — 상황별 표현·크기 매핑 | app/orb.js · app/orb.css · app/lib/main/orb-window.js | 적용 · 게이트 |
| `2TJ-0` · 02 · 키우미 — 표정 10종 | app/orb.css [data-face] 규칙 · app/orb.js FACE | 적용 |
| `5H3-0` · 03 · 키우미 — 시선·시간 루프 | app/orb.css [data-face] 치수 · app/orb.js 시선/루프 상수 | 적용 |
| `4TY-0` · 04 · 키우미 — 대화·콘텐츠 전개 | app/orb.html · app/orb.js · app/orb.css | 적용 · 게이트 |
| `5EU-0` · 05 · 키우미 — 셸 숨김·표시 | app/main.js broadcastShellVisibility · app/lib/main/orb-window.js · app/orb.js applyMode | 부분 (597268e) |
| `CLE-0` · 06 · 키우미 메뉴 — 두 진입점과 항목 | app/chat.js renderKiumiMenu()/kiumiItem() · app/chat.css .kiumi-menu | 적용 · 게이트 (f53bb65) |
| `C8G-0` · 07 · 키우미 메뉴 — 셸 오버레이 | app/shell.html #kiumiMenu · app/chat.css .kiumi-menu | 적용 · 게이트 (f53bb65) |
| `2I7Z-2` · 08 · 키우미 — 입력 스트립 모드별 얼굴 | app/shell.html .kiumi-face · app/chat.css .dot/.kiumi-visor · app/lib/kiumi-face.test.js | 폐기 |
| `2LFW-2` · 09 · 키우미 — 미니 카드 10종 | app/lib/orb-mini-card.js · app/orb.js buildOrbCanvasCard | 적용 |

보드 `08`(입력 스트립 모드별 얼굴)은 **잠긴 계약**이다 — 앱은 얼굴 1종을 유지하고 모드별 얼굴 5종을 만들지 않는다. 보드 `05`는 597268e가 Paper대로 되돌렸다: 셸이 보이는 동안 오브는 알림 전용(B)이고 최소화가 모드를 바꾸지 않는다. 보드 `06`·`07`의 메뉴 설명 넷은 f53bb65가 Paper 문구로 되돌렸다(항목 제목은 `verify:kiumi`의 `KIUMI_HEAD`가 잠근 자리라 건드리지 않았다).

### 미니 카드 계약 — 10/10

캔버스 렌더러가 받는 `canvas_type`을 오브 미니 카드 10종이 전부 받는다.

| 미니 카드 | canvas_type | 상한 |
| --- | --- | --- |
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

공통 규칙 5가지(값을 짓지 않는다 · 접었으면 밝힌다 · 실행은 05 하나 · 축소판이 아니다 · `innerHTML` 0건)는 `lib/orb-mini-card.test.js`가 순수 함수로, `probe-orb-mini-cards.js`가 실제 렌더러 DOM으로 각각 고정한다. 이 10종은 **문법**이고, 그 문법으로 그려질 실카드 96장은 카드미니 페이지가 소유한다.

---

## 카드 페이지 — 104

**2026-09-06 — 이전 판의 「카드 페이지 31/31」 표는 폐기했다.** 그 31행(`00 카드 카탈로그 — 299/299` · `01 F1 Facts` ~ `12 A1 Guarded Order` · `13 공통 카드 v3 기준안` · `14 카드 v3 카탈로그` · `15 차트` ~ `30 공매도`)이 부른 보드는 현재 Paper 카드 페이지에 하나도 없다. `get_children(5-1)`은 104장을 세고 이름은 전부 `CC-01`~`CC-06` / `Rnn` / `S00`·`S01` / `C01`–`C07` / `D01` / `A02×A04` / `A04` / `A05` 계열이며, `find_nodes(5-1, '*Facts*')`는 0건이다. 그 31행이 말하던 렌더 패밀리·16개 창은 **보드가 아니라 렌더 계약**이므로 이 절 뒤쪽에 계약으로 남긴다.

104 = `card_template` 96 + `card_spec` 8. 96은 `backend/ref/card-surface-templates/index.json`과 정확히 상등이고, 각 보드의 소유 표면은 `backend/ref/card-surface-templates/<board>/board.html`(Paper `get_jsx` 추출물, 편집 금지)과 `slots.json`(바인딩 표)이다. 봉투는 `_integrated_card_contract`의 `surface_contract`로 실려 오고 `app/lib/board-mount.js`가 그 자리에 값을 꽂는다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `1UO5-1` · A02×A04 · 목록 펼침 검증 — 최근 체결 20건 | `backend/ref/card-surface-templates/1UO5-1/` | 부분 |
| `1JZW-0` · A02×A04 · 호가 주문 정본 — 시장가 매수 | `backend/ref/card-surface-templates/1JZW-0/` | 미구현 |
| `1JPU-0` · A04 · 호가 정본 — 실시간 통합 호가 | `backend/ref/card-surface-templates/1JPU-0/` | 부분 (525e9a3) |
| `3N4O-0` · A04-X · 호가 정본 — 단계별 낱값 | `backend/ref/card-surface-templates/3N4O-0/` | 부분 |
| `1WOB-1` · A05 · 목록 펼침 검증 — 외국인 기간별 매매 상위 | `backend/ref/card-surface-templates/1WOB-1/` | 부분 |
| `15XT-2` · C01 · 좁은 데스크톱 — 차트 | `backend/ref/card-surface-templates/15XT-2/` | 부분 |
| `15Y5-2` · C02 · 좁은 데스크톱 — 실시간 호가 | `backend/ref/card-surface-templates/15Y5-2/` | 부분 (fb25723) |
| `15YH-2` · C03 · 좁은 데스크톱 — 주문 확인 | `backend/ref/card-surface-templates/15YH-2/` | 부분 |
| `1IG2-0` · C04–C07 · 좁은 데스크톱 — 계좌·수급·탐색·상품 | `backend/ref/card-surface-templates/1IG2-0/` | 부분 |
| `133H-2` · CC-01 / R10 · 내 계좌 — 손익·결제·위험 | `backend/ref/card-surface-templates/133H-2/` | 부분 (60e579d) |
| `3ODO-0` · CC-01 / R10-B-X1 · 금현물 잔고·거래내역 | `backend/ref/card-surface-templates/3ODO-0/` | 부분 |
| `3OIM-0` · CC-01 / R10-B-X2 · 금현물 주문·체결 | `backend/ref/card-surface-templates/3OIM-0/` | 부분 |
| `2SCE-1` · CC-01 / R10-T1 · 보유종목 — 종목별 평가·비중 | `backend/ref/card-surface-templates/2SCE-1/` | 부분 |
| `2SKU-1` · CC-01 / R10-T2 · 예수금·결제 — 현금·결제 예정 | `backend/ref/card-surface-templates/2SKU-1/` | 부분 (cdedb5a·f860bb0) |
| `3GRO-0` · CC-01 / R10-T2-X1 · 증거금·보증금 구간별 | `backend/ref/card-surface-templates/3GRO-0/` | 부분 |
| `3IGR-0` · CC-01 / R10-T2-X2 · 증거금 재원·담보 상세 | `backend/ref/card-surface-templates/3IGR-0/` | 부분 |
| `3LGC-0` · CC-01 / R10-T2-X3 · 거래내역 상세 | `backend/ref/card-surface-templates/3LGC-0/` | 부분 |
| `3MTJ-0` · CC-01 / R10-T2-X4 · D+2 정산 후 계좌 | `backend/ref/card-surface-templates/3MTJ-0/` | 부분 |
| `3NVG-0` · CC-01 / R10-T2-X5 · 예수금 통화별·특수예수금 | `backend/ref/card-surface-templates/3NVG-0/` | 부분 |
| `3UTA-0` · CC-01 / R10-T2-X6 · 부채·미수·연체 상세 | `backend/ref/card-surface-templates/3UTA-0/` | 부분 |
| `2SRV-1` · CC-01 / R10-T3 · 손익·성과 — 실현손익·수익률 | `backend/ref/card-surface-templates/2SRV-1/` | 부분 |
| `3K7K-0` · CC-01 / R10-T3-X1 · 이달 기초·기말 구성 | `backend/ref/card-surface-templates/3K7K-0/` | 부분 |
| `2SYW-1` · CC-01 / R10-T4 · 주문·체결 — 오늘 주문 현황 | `backend/ref/card-surface-templates/2SYW-1/` | 부분 |
| `135M-2` · CC-02 / R11 · 삼성전자 10주 시장가 매수 | `backend/ref/card-surface-templates/135M-2/` | 부분 |
| `2T63-1` · CC-02 / R11-T1 · 현금 매도 — 삼성전자 10주 시장가 매도 | `backend/ref/card-surface-templates/2T63-1/` | 부분 |
| `2TAG-1` · CC-02 / R11-T2 · 정정 — 삼성전자 지정가 정정 | `backend/ref/card-surface-templates/2TAG-1/` | 부분 |
| `2TET-1` · CC-02 / R11-T3 · 취소 — 삼성전자 원주문 취소 | `backend/ref/card-surface-templates/2TET-1/` | 부분 |
| `2TJ6-1` · CC-02 / R11-T4 · 신용 매수 — 삼성전자 10주 시장가 신용융자 | `backend/ref/card-surface-templates/2TJ6-1/` | 부분 |
| `2TNJ-1` · CC-02 / R11-T5 · 금현물 매수 — 금 99.99K 10g 시장가 | `backend/ref/card-surface-templates/2TNJ-1/` | 부분 |
| `137X-2` · CC-03 / R01 · 삼성전자 3개월 차트 | `backend/ref/card-surface-templates/137X-2/` | 부분 (c04b442·96a409e·860443f) |
| `2R3M-1` · CC-03 / R01-T1 · 현재시세 — 체결·호가 문맥 | `backend/ref/card-surface-templates/2R3M-1/` | 부분 (860443f·f860bb0) |
| `3FR6-0` · CC-03 / R01-T1-X · 분봉 시세 | `backend/ref/card-surface-templates/3FR6-0/` | 적용 |
| `2RBO-1` · CC-03 / R01-T2 · 기업정보 — 개요·가치·실적 | `backend/ref/card-surface-templates/2RBO-1/` | 적용 (860443f) |
| `2RJ7-1` · CC-03 / R01-T3 · 금현물 — KRX 금시장 차트·시세 | `backend/ref/card-surface-templates/2RJ7-1/` | 부분 |
| `2VDA-0` · CC-03 / R01-T4 · 순위 — 주식 신호·순위 | `backend/ref/card-surface-templates/2VDA-0/` | 부분 |
| `31UD-0` · CC-03 / R01-T4-10 · 순위 — 당일·전일 체결량 | `backend/ref/card-surface-templates/31UD-0/` | 적용 |
| `2YXS-0` · CC-03 / R01-T4-2 · 순위 — 상하한가 | `backend/ref/card-surface-templates/2YXS-0/` | 적용 |
| `2ZHC-0` · CC-03 / R01-T4-3 · 순위 — 고저가근접 | `backend/ref/card-surface-templates/2ZHC-0/` | 적용 |
| `2ZZ7-0` · CC-03 / R01-T4-4 · 순위 — 가격급등락 | `backend/ref/card-surface-templates/2ZZ7-0/` | 적용 |
| `30C1-0` · CC-03 / R01-T4-5 · 순위 — 거래량갱신 | `backend/ref/card-surface-templates/30C1-0/` | 부분 |
| `30O1-0` · CC-03 / R01-T4-6 · 순위 — 매물대집중 | `backend/ref/card-surface-templates/30O1-0/` | 적용 |
| `30ZW-0` · CC-03 / R01-T4-7 · 순위 — 고저 PER | `backend/ref/card-surface-templates/30ZW-0/` | 부분 |
| `316O-0` · CC-03 / R01-T4-8 · 순위 — 시가대비 등락 | `backend/ref/card-surface-templates/316O-0/` | 부분 |
| `31II-0` · CC-03 / R01-T4-9 · 순위 — VI 발동 | `backend/ref/card-surface-templates/31II-0/` | 적용 |
| `3TCO-0` · CC-03 / R01-T4-9-X · VI 발동 전체 12건 | `backend/ref/card-surface-templates/3TCO-0/` | 적용 |
| `2VIN-0` · CC-03 / R01-T5 · 순위 — ETF 전체시세 | `backend/ref/card-surface-templates/2VIN-0/` | 부분 (863d397) |
| `2WZK-0` · CC-03 / R01-T5-2 · 순위 — ETF 기간 수익률 | `backend/ref/card-surface-templates/2WZK-0/` | 부분 (381650d) |
| `2VO0-0` · CC-03 / R01-T6 · 순위 — ELW 순위 | `backend/ref/card-surface-templates/2VO0-0/` | 부분 |
| `2XA5-0` · CC-03 / R01-T6-2 · 순위 — ELW 등락률 | `backend/ref/card-surface-templates/2XA5-0/` | 부분 |
| `2XY6-0` · CC-03 / R01-T6-3 · 순위 — ELW 근접율 | `backend/ref/card-surface-templates/2XY6-0/` | 부분 |
| `2Y47-0` · CC-03 / R01-T6-4 · 순위 — ELW 가격급등락 | `backend/ref/card-surface-templates/2Y47-0/` | 부분 |
| `2Z49-0` · CC-03 / R01-T6-5 · 순위 — ELW 거래원별 순매매 | `backend/ref/card-surface-templates/2Z49-0/` | 적용 |
| `3TOM-0` · CC-03 / R01-T6-5-X · ELW 거래원별 10창구 전체 | `backend/ref/card-surface-templates/3TOM-0/` | 적용 |
| `2ZN9-0` · CC-03 / R01-T6-6 · 순위 — ELW 조건검색 | `backend/ref/card-surface-templates/2ZN9-0/` | 부분 |
| `32S7-0` · CC-03 / R01-T7 · 차트 — 업종 지수 | `backend/ref/card-surface-templates/32S7-0/` | 부분 (94543e4) |
| `32XM-0` · CC-03 / R01-T8 · 순위 — 신주인수권 전체 | `backend/ref/card-surface-templates/32XM-0/` | 부분 |
| `3DI2-0` · CC-03 / R01-X · 투자자 12주체 | `backend/ref/card-surface-templates/3DI2-0/` | 적용 |
| `15N5-2` · CC-03 / R07 · KODEX 200 ETF | `backend/ref/card-surface-templates/15N5-2/` | 부분 |
| `15P5-2` · CC-03 / R08 · ELW 위험·만기 | `backend/ref/card-surface-templates/15P5-2/` | 부분 |
| `3DZ1-0` · CC-03 / R08-X · ELW 바스켓·만기평가 | `backend/ref/card-surface-templates/3DZ1-0/` | 적용 |
| `13BC-2` · CC-04 / R02 · 삼성전자 실시간 호가·체결 | `backend/ref/card-surface-templates/13BC-2/` | 부분 (c04b442·a41b863·6bfc829) |
| `2QRP-1` · CC-04 / R02-T2 · 호가 — 시간외 단일가 | `backend/ref/card-surface-templates/2QRP-1/` | 미판정 |
| `3JT4-0` · CC-04 / R02-T2-X · 호가 — 시간외 단일가 단계별 낱값 | `backend/ref/card-surface-templates/3JT4-0/` | 미판정 |
| `2QX1-1` · CC-04 / R02-T3 · 호가 — KRX 금현물 | `backend/ref/card-surface-templates/2QX1-1/` | 미판정 (863d397) |
| `2TRW-1` · CC-04 / R02-T4 · 호가 — 정규장 5단 | `backend/ref/card-surface-templates/2TRW-1/` | 부분 (863d397) |
| `3JZ3-0` · CC-04 / R02-X · 호가 — 단계별 낱값·거래소별 | `backend/ref/card-surface-templates/3JZ3-0/` | 부분 |
| `2QFO-2` · CC-05 / R03-T1 · 수급 — 투자자별 | `backend/ref/card-surface-templates/2QFO-2/` | 부분 (6f06774) |
| `2QM7-2` · CC-05 / R03-T2 · 수급 — 거래원 | `backend/ref/card-surface-templates/2QM7-2/` | 미판정 |
| `2ROJ-1` · CC-05 / R03-T3 · 수급 — 프로그램 | `backend/ref/card-surface-templates/2ROJ-1/` | 부분 |
| `2RWK-1` · CC-05 / R03-T4 · 수급 — 신용·대차 | `backend/ref/card-surface-templates/2RWK-1/` | 부분 |
| `2S4E-1` · CC-05 / R03-T5 · 수급 — 종목 동향 | `backend/ref/card-surface-templates/2S4E-1/` | 부분 |
| `2V71-0` · CC-05 / R03-T6 · 수급 — 순위 | `backend/ref/card-surface-templates/2V71-0/` | 부분 |
| `2YS8-0` · CC-05 / R03-T6-2 · 순위 — 신용비율 상위 | `backend/ref/card-surface-templates/2YS8-0/` | 적용 |
| `2ZBB-0` · CC-05 / R03-T6-3 · 순위 — 대차 상위 | `backend/ref/card-surface-templates/2ZBB-0/` | 부분 |
| `2ZTA-0` · CC-05 / R03-T6-4 · 순위 — 한도소진율 증가 | `backend/ref/card-surface-templates/2ZTA-0/` | 적용 |
| `3063-0` · CC-05 / R03-T6-5 · 순위 — 장중 투자자 상위 | `backend/ref/card-surface-templates/3063-0/` | 적용 |
| `30HY-0` · CC-05 / R03-T6-6 · 순위 — 외국인·기관 상위 | `backend/ref/card-surface-templates/30HY-0/` | 불일치 (381650d) |
| `30TY-0` · CC-05 / R03-T6-7 · 순위 — 증권사별 상위 | `backend/ref/card-surface-templates/30TY-0/` | 적용 |
| `31CL-0` · CC-05 / R03-T6-8 · 순위 — 동일순매매 | `backend/ref/card-surface-templates/31CL-0/` | 적용 |
| `31OF-0` · CC-05 / R03-T6-9 · 순위 — 신용융자 가능 | `backend/ref/card-surface-templates/31OF-0/` | 부분 |
| `13K0-2` · CC-06 / R04 · 거래대금 상위 저평가 탐색 | `backend/ref/card-surface-templates/13K0-2/` | 적용 (381650d·863d397) |
| `2YNQ-0` · CC-06 / R04-S10 · 종목찾기 — 시간외 등락률 | `backend/ref/card-surface-templates/2YNQ-0/` | 불일치 (863d397) |
| `2X5N-0` · CC-06 / R04-S2 · 종목찾기 — 당일 거래량 | `backend/ref/card-surface-templates/2X5N-0/` | 부분 |
| `2XG6-0` · CC-06 / R04-S3 · 종목찾기 — 전일 거래량 | `backend/ref/card-surface-templates/2XG6-0/` | 부분 |
| `2XKO-0` · CC-06 / R04-S4 · 종목찾기 — 등락률 | `backend/ref/card-surface-templates/2XKO-0/` | 부분 |
| `2XP6-0` · CC-06 / R04-S5 · 종목찾기 — 예상체결 등락률 | `backend/ref/card-surface-templates/2XP6-0/` | 부분 |
| `2XTO-0` · CC-06 / R04-S6 · 종목찾기 — 호가잔량 상위 | `backend/ref/card-surface-templates/2XTO-0/` | 불일치 (863d397) |
| `2YA8-0` · CC-06 / R04-S7 · 종목찾기 — 호가잔량 급증 | `backend/ref/card-surface-templates/2YA8-0/` | 불일치 (863d397) |
| `2YEQ-0` · CC-06 / R04-S8 · 종목찾기 — 잔량률 급증 | `backend/ref/card-surface-templates/2YEQ-0/` | 부분 |
| `2YJ8-0` · CC-06 / R04-S9 · 종목찾기 — 거래량 급증 | `backend/ref/card-surface-templates/2YJ8-0/` | 부분 |
| `2TZN-1` · CC-06 / R04-T1 · 업종 — 업종 지수·등락 탐색 | `backend/ref/card-surface-templates/2TZN-1/` | 부분 |
| `3BQB-0` · CC-06 / R04-T1-X · 업종 — 업종 목록 펼침 | `backend/ref/card-surface-templates/3BQB-0/` | 불일치 |
| `2U5L-1` · CC-06 / R04-T2 · 관심 — 관심종목 시세 보드 | `backend/ref/card-surface-templates/2U5L-1/` | 부분 |
| `3D4I-0` · CC-06 / R04-T2-X · 관심 — 삼성전자 행 펼침 | `backend/ref/card-surface-templates/3D4I-0/` | 부분 |
| `3EWN-0` · CC-06 / R04-T2-X2 · 관심 — ELW 행 펼침 | `backend/ref/card-surface-templates/3EWN-0/` | 부분 |
| `2UBO-1` · CC-06 / R04-T3 · 테마 — 테마 등락·확산 탐색 | `backend/ref/card-surface-templates/2UBO-1/` | 부분 |
| `2UHM-1` · CC-06 / R04-T4 · 시장·VI — 시장 상태와 VI 발동 | `backend/ref/card-surface-templates/2UHM-1/` | 적용 |
| `2UN6-1` · CC-06 / R04-T5 · 조건검색 — 저장 조건식과 결과 | `backend/ref/card-surface-templates/2UN6-1/` | 적용 |
| `15J9-2` · CC-06 / R05 · 반도체 업종·AI 테마 | `backend/ref/card-surface-templates/15J9-2/` | 적용 |
| `15L8-2` · CC-06 / R06 · 관심종목·조건 신호 | `backend/ref/card-surface-templates/15L8-2/` | 부분 |
| `15R0-2` · CC-06 / R09 · 시장 체온·VI | `backend/ref/card-surface-templates/15R0-2/` | 부분 |
| `1745-2` · D01 · 문맥형 상세·이어보기 정본 | `backend/ref/card-surface-templates/1745-2/` | 부분 |
| `161Q-2` · S00 · 공통 상태·재시도 | `backend/ref/card-surface-templates/161Q-2/` | 부분 (ae75d89) |
| `1IG3-0` · S01 · 시간 초과·취소·인증 만료·장 마감 | `backend/ref/card-surface-templates/1IG3-0/` | 부분 (951a275) |

`미판정` 4장(`2QM7-2` · `2QRP-1` · `2QX1-1` · `3JT4-0`)은 2026-09-05 전수 대조의 표본 밖이다. 판정을 지어내지 않고 다음 대조 대상으로 남긴다.

### 이 트랙에서 카드 페이지에 한 것

- **라우팅 축 교체(c04b442).** `preservesAppPrimary`가 recipe 3종을 통째로 보드에서 빼던 판정을 렌더러 축으로 바꿨다. recipe는 제품 화면 종류라 `detail:ka10001:current_trading`처럼 recipe를 빌려 쓰는 op까지 함께 빠졌다.
- **primary 마운트(525e9a3 · 88e0336 · 9e090d7 · 96a409e · a41b863).** `slots.json`의 `primary` 블록이 프론트 청크·색인으로 투사되지 않아 프론트가 `primary`의 존재 자체를 몰랐다. 투사를 세우고 차트(`137X-2` · `32S7-0`)와 호가 사다리(`13BC-2` · `1JPU-0`)가 자기 Paper 보드 안에서 라이브로 뜨게 했다.
- **착지 지점 정정(860443f · 6bfc829 · 94543e4 · 6f06774).** 시세가 `CC-03` 현재시세 보드로, 호가 봉투가 예외를 벗고 자기 보드로 가게 했고, 상태 보드를 갈아타도 남의 보드에 남의 차트를 얹지 않으며 탭 레일이 살아 있게 했다.
- **저작 수정(863d397 · 381650d).** 스트립·정렬 칩이 Paper가 가리키는 잎에 붙게 하고, 순위 본표 두 장이 표로 서게 저작했다.
- **좁은 창(fb25723).** `15Y5-2`(C02)대로 390px에서 사다리를 가격·잔량 2열 3단으로 접는다. 판단 텍스트 12px 하한(카드 표면 헌장 11조)을 지킨다.

### 렌더 패밀리 계약 — 보드가 아니라 계약이다

299 operation이 어느 렌더러로 수렴하는지의 표다. Paper 보드가 아니며, 원장 축은 `PAPER_CARD_COVERAGE.md`와 `CARD_SURFACE_COVERAGE.md`가 CC-보드 단위로 센다.

| 렌더 패밀리 | operation |
| --- | ---: |
| F1 Facts | 93 |
| F2 Dense Facts | 21 |
| T1 Compact Table | 32 |
| T2 Standard Table | 60 |
| T3 Wide Table | 12 |
| T4 Compound Table | 10 |
| C1 Chart | 19 |
| C2 Compound | 17 |
| E1 Realtime Event | 21 |
| E2 Condition Event | 1 |
| E3 Stop Event | 1 |
| A1 Guarded Order | 12 |

합은 299이며 실제 렌더러의 `facts · table · compound · chart · event · action · status` 계열로 수렴한다.

### 고정 카드 제목 16종 — 보드가 아니라 계약이다

| 고정 제목 | operation |
| --- | ---: |
| 차트 | 21 |
| 호가 | 28 |
| 주문 | 9 |
| 시세 | 23 |
| 종목발굴 | 66 |
| 관심종목 | 3 |
| 종목정보 | 25 |
| 거래원 | 17 |
| 계좌 | 50 |
| 보유주식 | 7 |
| 주문내역 | 11 |
| 수급 | 10 |
| 프로그램매매 | 10 |
| 신용거래 | 14 |
| 대차거래 | 4 |
| 공매도 | 1 |

합은 정확히 299다. `backend/athena_api/canvas_transform.py`가 operation의 도메인·화면 접근성 라벨·검증된 예외만으로 고정 제목을 결정하며, 미분류를 허용하지 않는 전수 테스트가 있다.

### 카드 스트립 버튼 상태 전수

카드 우상단 스트립의 버튼을 눌렀을 때의 모든 경우의 수를 보드로 담는다. 탭 상태 보드는 `R0n-T*` 접미사를 쓴다.

| 카드 | 스트립 버튼 | 커버 |
| --- | --- | --- |
| CC-03 차트 | 현재시세 · 차트 · 기업정보 · ETF · ELW · 금현물 · 순위 | 7/7 — T1 현재시세 · T2 기업정보 · T3 금현물, 차트=R01 · ETF=R07 · ELW=R08 · 순위=R01-T4·T5·T6 |
| CC-05 수급 | 투자자별 · 거래원 · 프로그램 · 신용·대차 · 종목 동향 · 순위 | 6/6 — T3 프로그램 · T4 신용·대차 · T5 종목 동향 · 순위=R03-T6 |
| CC-04 호가 | 정규장 · 시간외 · 금현물 ‖ 5단 · 10단 | 5/5 — R02-T4 정규장 5단(10단=R02 · 시간외=T2 · 금현물=T3) |
| CC-01 계좌 | 자산 종합 · 보유종목 · 예수금·결제 · 손익·성과 · 주문·체결 · 증거금·담보 · 금현물 | 7/7 — R10-T1~T4, 증거금·담보·금현물=R10-B |
| CC-02 주문 | 현금 · 신용 · 금현물 ‖ 매수 · 매도 · 정정 · 취소 | 7/7 — R11-T1 현금 매도(kt10001) · T2 정정(kt10002) · T3 취소(kt10003) · T4 신용 매수(kt10006) · T5 금현물 매수(kt50000). 나머지 조합은 동일 골격이라 R11-B 묶음이 커버 |
| CC-06 탐색 | 업종 · 종목찾기 · 관심 · 테마 · 시장·VI · 조건검색 | 6/6 — R04-T1~T5 |

`R05`·`R06`·`R09`와 `A04` 등 정본·질문형 보드에는 스트립이 없다. 좁은 데스크톱 `C01~C07`은 레이아웃 변형으로 보고 탭 상태 전수 대상에서 제외했다.

### 순위 모드

카드 페이지 × 키움 REST API 전수 검수에서 확인된 랭킹·목록형 TR 공백(CC-03 17건 · CC-05 8건)을 원장 귀속 이동 없이 소유 카드 안의 `순위` 모드로 회수했다. capability 배정·operation 수·라우팅 계약은 불변이다.

| 보드 | 활성 축 | 축 카탈로그(커버 TR) |
| --- | --- | --- |
| `2VDA-0` CC-03 / R01-T4 · 순위 — 주식 신호·순위 | 신고저가 ka10016 | ka10016 · 10017 · 10018 · 10019 · 10024 · 10025 · 10026 · 10028 · 10054 · 10055 (10축) |
| `2VIN-0` CC-03 / R01-T5 · 순위 — ETF 전체시세 | 전체시세 ka40004 | ka40004 · ka40001(기간 수익률 정렬) |
| `2VO0-0` CC-03 / R01-T6 · 순위 — ELW 순위 | 잔량 순위 ka30010 | ka30010 · 30009 · 30011 · 30001 · 30002 · 30005 (6축) |
| `2V71-0` CC-05 / R03-T6 · 수급 — 순위 | 프로그램 순매수 상위 50 ka90003 | ka90003 · 10033 · 10069 · 10036 · 10065 · 90009 · 10039 · 10062 · kt20016 (9축, kt20017은 행 선택 시) |

실앱 쪽 코어: `canvas_card_registry.py`의 `OPERATION_PRESENTATION_OVERRIDES`(랭킹 28 operation의 기본 mode/section을 `("ranking", "ranked-results")`로 파생) · `canvas_push.py`의 `_SECTION_TITLES_KO` · `integrated-card-surface.js`의 `panelKeyFor()`(ranking에서 operation_ref를 키에서 제외) · `app/lib/ranking-axis.js`의 27축 스트립(`ranking-axis.test.js`가 백엔드 원문을 읽어 1:1 동기화를 고정한다) · `canvas.js`의 `decorateRankingPanel()`. 실시간은 무변경이며 Paper의 「조회 스냅샷 · 실시간 스트림 아님」 선언과 일치한다.

---

## 카드미니 페이지 — 203

**2026-09-06 신설.** 이전 판에는 이 페이지가 한 줄도 없었다(`카드미니`라는 말이 0회 등장했다). 키우미 절의 「미니 카드 계약 — 10/10」 표는 `canvas_type` 10종, 곧 **문법**만 다루고 실카드 192장과 견본 11장을 세지 않았다.

203 = `mini_template` 11 + `mini_card` 192이고, 192는 `mini/` 96장(카드 자체)과 `note/` 96장(같은 카드의 주석)의 짝이다 — 이름의 접두만 다르고 나머지가 같다(실측 mini-only 0 · note-only 0). 모두 360×420이며 주석 보드만 360×92다.

### 96장 원장과 `verify:kiumi-cards`의 관계

- `backend/ref/kiumi/kiumi-ledger.jsonl` **96행**이 실카드 대장이다. Paper의 `mini/<보드 이름>` 96장과 이름으로 1:1 짝짓는다.
- `npm run verify:kiumi-cards`(`app/probe-orb-kiumi-96.js`)는 그 96행을 실제 오브 대화 경로로 흘려보내 96장이 그려지는지·높이가 상한 안인지를 실렌더러에서 잰다. 대장이 96행이 아니면 그 자리에서 멈춘다. 즉 이 게이트가 재는 것은 **대장 96행**이지 Paper 203장이 아니다.
- `npm run verify:paper-mini-static`이 그 사이를 잇는다 — Paper H-1의 `mini/` 96 · `note/` 96을 대장 96행과 행 단위로 맞대 `paper_cross_board`(Paper가 다른 보드의 값을 들고 있다) · `paper_form_deviation` · `ledger_stale` · `unbacked` 네 부류로 가른다. 어긋난 보드가 하나라도 있으면 exit 1이고, **그 목록이 산출물**이다.
- `npm run verify:paper-mini-template`은 견본 11장이 문법 10종을 실제 오브에서 그리는지 잰다.

**대장을 Paper로 덮는 것은 아직 하지 않는다.** 사용자 지시는 「Paper가 정본」이지만 `paper_cross_board`가 0이 되기 전에 대장을 갈아끼우면 지금 도는 앱이 깨진다 — 순서는 `backend/ref/kiumi/README.md`가 못박았고, 게이트는 그 순서를 지키느라 빨간 채로 남아 있다. 증거 파일 `backend/ref/kiumi/evidence/paper-ledger-divergence-20260904.json`의 수치(84/227/190/2)는 LLM이 렌더된 JSX를 읽어 센 값이라 해시가 아니며, 게이트는 그 수치에 자신을 맞추지 않고 결정론적으로 잰 값(77/212/182/0)을 나란히 적는다.

### 견본 11장

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `45S8-0` · template/table | app/orb.js:1978-1982 (else 분기 .orb-kiumi-list) | 불일치 |
| `45SC-0` · template/chart | app/orb.js:1882-1932 (appendOrbKiumiChart) + app/orb.js:1207-1211 (orbChartDateLabel) | 부분 |
| `45S9-0` · template/facts | app/orb.js:1978-1982 + app/orb.css:917-935 (.orb-kiumi-row/.orb-kiumi-label/.orb-kiumi-value) | 적용 |
| `45S7-0` · template/compound | app/orb.js:1953-1975 (buildOrbKiumiCard compound 분기) + app/orb.css:959-978 (.orb-kiumi-kpis) | 부분 |
| `45SB-0` · template/order_ticket | app/orb.js:1941-1947 (renderOrbTicket 재사용) + app/orb.css:1021-1024 | 부분 |
| `45SA-0` · template/order_confirm | app/orb.js:1978-1982 (else 분기) | 부분 |
| `45SD-0` · template/event | app/orb.js:1704-1732 (buildOrbEventCard, .orb-fold-card 경로) | 부분 |
| `45SE-0` · template/auth | app/orb.js:1759-1775 (buildOrbStatusCard) | 불일치 |
| `45SF-0` · template/reader | app/orb.js:1777-1799 (buildOrbReaderCard) + app/lib/orb-mini-card.js:152-170 (clampReaderBody) | 부분 |
| `45SG-0` · template/stream | app/orb.js:1802-1826 (buildOrbStreamCard) + app/lib/orb-mini-card.js:172-186 | 부분 |
| `45SH-0` · template/2SCE-1 | app/orb.js:1953-1975 (compound 분기) | Paper 낡음 |

`template/2SCE-1`은 11번째 견본으로, 문법이 아니라 `2SCE-1`(보유종목) 카드의 compound 실례다.

### 실카드 192장

2026-09-05 전수 대조는 이 192장 중 **12장만 개별로** 열었고(`mini/` 10 · `note/` 2) 나머지 180장은 두 줄로 묶어 「Paper 낡음」이라 뭉뚱그렸다. 이 문서는 그 뭉뚱그림을 개별 판정으로 옮기지 않고 `미판정`으로 둔다 — 보드 하나하나를 실제로 열어 본 것이 아니기 때문이다. 개별로 연 12장의 결론은 한 방향이었다 — **Paper 낡음**. 카드 자체는 `app/orb.js`의 문법 분기(`buildOrbKiumiCard` compound · `.orb-kiumi-list` · `appendOrbKiumiChart` · `buildOrbEventCard` · `buildOrbStatusCard` · `buildOrbReaderCard` · `buildOrbStreamCard` · `renderOrbTicket`)로 실제로 그려지고 `app/captures/kiumi-96/`에 캡처가 남지만, 보드가 든 값이 대장·다른 보드와 어긋나 있다. 개별 180장의 판정은 `verify:paper-mini-static` 리포트(`app/captures/paper-gates/PAPER-MINI.json`)가 결정론적으로 세는 자리이며, 이 문서는 그 게이트를 가리키고 수치를 옮겨 적지 않는다 — 두 개의 진실을 만들지 않는다.

---

## 증명 페이지 — 12

카드 페이지에서 분리한 검증 장치 보드다. 실앱 렌더 대상이 아니라 **키움 공식 원문과 앱 원장을 맞대는 자리**이므로 대부분 `대조 대상 아님`이다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `17F8-2` · CC-01 / R10-B · 증거금·담보·금현물 잔고 | — | 부분 |
| `17IH-2` · CC-02 / R11-B · 신용·금현물·정정·취소 주문 | — | 대조 대상 아님 |
| `1XA2-0` · CC-03 / R01-B · 차트 전체 항목·행 상세 | — | 대조 대상 아님 |
| `177W-2` · CC-04 / R02-B · 시간외·통합·금현물 호가 | — | 대조 대상 아님 |
| `24GR-0` · CC-04 / R02-X1 · 정규·통합 호가 공식 원문 — ka10004·ka10007 | — | 대조 대상 아님 |
| `24GS-0` · CC-04 / R02-X2 · 실시간 KRX·NXT·LP 공식 원문 — 0C·0D | — | 대조 대상 아님 |
| `24GT-0` · CC-04 / R02-X3 · 시간외·금현물·프로토콜 공식 원문 — 0E·ka10087·ka50101 | — | 부분 |
| `17MB-2` · CC-06 / R06-B · 조건검색·이어보기·실시간 해제 | — | 대조 대상 아님 |
| `1XGW-0` · DV-1 · 종목 탐색 결과 — 공식 128개 필드 | — | 대조 대상 아님 |
| `2DZE-0` · DV-2 · 기업·가치 프로필 — 공식 39개 필드 | — | 대조 대상 아님 |
| `2E4E-0` · DV-3 · 거래·가격 이력 — 공식 189개 필드 | — | 대조 대상 아님 |
| `322V-0` · RX-1 · 순위·정렬 상태 ↔ TR 사양 | — | 부분 |

**2026-09-06 정정.** 이전 판은 이 페이지를 「검증 장치 11장을 새 증명 페이지로 이동」이라는 산문 한 줄로만 적고 표가 없었다. 현재 12장이며 `322V-0`(RX-1 · 순위·정렬 상태 ↔ TR 사양)이 이전 판 이후 늘어난 보드다. 그 보드의 꼬리말 「주식 10 · ETF 2 · ELW 6 · 수급 9 · 종목찾기 10」 중 앞 27축은 `app/lib/ranking-axis.js`의 `RANKING_AXES`와 TR id·순서까지 같다.

`17F8-2`(R10-B)는 앱 렌더 대상이 아니지만 앱 원장이 이 보드를 **필드 귀속처**로 쓴다 — `backend/ref/card-surface-authoring/packs/17F8-2.fields.json`에 105행이 걸려 있고 `slots.json`이 없다. 로더 커버리지 미도달 150건 중 68건이 이 보드에만 귀속된 자리다.

---

## 백테스트 페이지 — 26

**2026-09-06 정정 셋.** ① 이 페이지는 26장이다(이전 판은 「백테스트 보드 23장」이라 못박았다). 늘어난 셋은 그래프 보드 `3Z8U-1`·`3ZAA-1`·`3ZC2-1`으로, Paper 실제 배치가 `8-1`이라 페이지는 그대로 두고 역할만 `screen`으로 준다. ② `15`·`16`은 **폐기**다 — Paper가 보드 이름 자체를 「— 폐기(요약 지도 제거, 보드 19~22 현행)」로 개명했다. 이전 판이 두 행에 적었던 `적용 (4b0df46)` 표기는 지웠다: 그대로 두면 다음 작업자가 요약 지도 표면을 되살리는 회귀를 「정합 복구」로 오인한다. ③ `08`·`09`도 Paper 스스로 「초기 안 · 보드 11–14(12)가 현행」이라 적은 폐기 보드다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `1SW0-0` · 01 · 백테스트 — 설계 (폼) | app/lib/backtest-canvas.js renderDesign()/renderTargetCard()/renderIndicatorCard()/renderConditionCards()/renderRiskCard()/renderAssumptions() (2534·3558·3621·3678·3754·5319) — 설계 하위탭 '폼' | 부분 |
| `1T5K-0` · 02 · 백테스트 — 설계 (코드) | app/lib/backtest-canvas.js renderCodeTab()/renderCodeBounds() (3805·3975), app/lib/backtest-code-editor.js, app/lib/project-ide.js | 부분 |
| `1TGA-1` · 03 · 백테스트 — 결과 | app/lib/backtest-canvas.js renderResult()/renderMetricTiles()/renderEquity()/renderTradesTable()/renderAssumptions() (5215·5232·5246·5285·5319), app/lib/backtest-equity-chart.js | 부분 |
| `1TPF-1` · 04 · 백테스트 — 데이터 수집 승인 | app/lib/backtest-canvas.js renderApproval()/renderRunning() (5129·5170), app/shell.css .backtest-coverage-* (1603-1612) | 부분 (fb31b54·ac7cd32) |
| `1WSI-1` · 05 · 백테스트 — 이력·비교 | app/lib/backtest-canvas.js renderHistory()/renderVersionList()/renderCompare() (5335·5383·5411), app/lib/backtest-equity-chart.js renderOverlayChart | 부분 (5e84d04) |
| `1WZJ-1` · 06 · 백테스트 — 최적화 | app/lib/backtest-canvas.js renderOptimize()/renderOptimizeResult()/renderHeatmap() (5448·5503·5543), backend/athena_api/backtest/optimize.py | 부분 |
| `2FMM-2` · 07 · 백테스트 — 전략 배포 · 실전 적용 | app/lib/backtest-canvas.js renderDeploy()/renderDeployArm()/renderDeployLog()/renderDeployForm() (5563·5614·5653·5695), backend/athena_api/backtest/deploy_orders.py | 부분 (f54abfc·3dff75d·610843d) |
| `2FR9-2` · 08 · 백테스트 — 코드 플로우 지도 | app/lib/backtest-canvas.js renderFlowTab()/renderSummaryMap() (3999·4030), app/lib/backtest-explain.js | 폐기 |
| `3Z8U-1` · 09 · 그래프 — 채팅이 화면을 몬다 (navigate · select · filter) | backend/athena_mcp/graph_view_tools.py (athena_graph_view) · app/main.js:2474 maybeForwardGraphChatAction · app/canvas.js:3744 athena:graph-chat-action 핸들러 · app/lib/graph-mode/controller.js(setSurface/selectNode/focusNode/fitView) · app/lib/graph-mode/graph-filters.js | 부분 |
| `2FY9-2` · 09 · 백테스트 — 오류 진단 · 자동 수정 승인 | app/lib/backtest-canvas.js renderDiagnosisPanel()/diagnosisWithNode() (5195·5204), app/lib/backtest-explain.js renderDiagnosis() | 폐기 |
| `3ZAA-1` · 10 · 그래프 — "이 노드 설명해줘" (관계·근거·이력·대화 원문) | backend/athena_mcp/brain_tools.py action=entity · backend/athena_api/api/brain.py:1362-1450 get_brain_entity_detail · backend/athena_api/brain/store.py:1390 entity_detail + :90 _source_excerpt_from_row · app/lib/main/live-prompt.js:622-634 buildGraphModePrefix · app/lib/graph-mode/controller.js:378 채팅 헤더 | 부분 |
| `2GZM-2` · 10 · 백테스트 — 전략 고르기 · 실패·비활성 상태 | app/lib/backtest-canvas.js renderTechniqueList() (2614) · render()의 error 분기 (2408-2425) · stopPolling/resumePollingIfNeeded (940·1661) | 부분 |
| `3ZC2-1` · 11 · 그래프 — 편집은 제안까지 · 도구 계약 | app/lib/graph-mode/graph-edit-proposal.js · app/chat.js:1878-2095 편집 제안 카드 · backend/athena_mcp/graph_view_tools.py propose_edit · backend/athena_api/api/brain.py:403 /relations/manual · :540 /relations/retractions | Paper 낡음 |
| `3Y38-1` · 11 · 백테스트 — 시각 전략 설계 · 편집 가능 | app/lib/backtest-visual-editor.js (팔레트·캔버스·검사기·요약 바) + app/lib/backtest-canvas.js renderVisualDesign()(5226~5248) · 지도 탭 안 | 부분 |
| `3YFV-1` · 12 · 백테스트 — 시각 전략 검증 · 연결 오류 | app/lib/backtest-visual-editor.js 오류 검사기·오류 요약 바 + app/chat.js visual_question 카드(3717~3781) | 부분 |
| `3YQ0-1` · 13 · 백테스트 — 오류 노드에서 코드로 · 줄 연결 | app/lib/backtest-code-editor.js(리본·파일 메타·미리보기 배너·링크 상태) + app/lib/backtest-canvas.js openCodeAt/openSpan + app/chat.js visual_patch 카드(3782~3811) | 부분 |
| `3Z0X-1` · 14 · 백테스트 — 그래프·코드 동기화 완료 · 실행 전 | app/lib/backtest-visual-editor.js synced 상태 + app/lib/backtest-canvas.js applyVisualPatch/reviewBeforeRun + app/chat.js visual_synced 카드(3813~3831) | 부분 |
| `3X7M-1` · 15 · 백테스트 — 설계 (흐름 지도) · 대화로 고치는 1급 표면 — 폐기(요약 지도 제거, 보드 19~22 현행) | app/lib/backtest-canvas.js renderSummaryMap()(4030~) + app/lib/backtest-explain.js renderFlowMap() | 폐기 |
| `3XE7-1` · 16 · 백테스트 — 지도 실행 → 멈춤 → 대화로 고침 — 폐기(요약 지도 제거, 보드 19~22 현행) | app/lib/backtest-explain.js renderFlowMap(오류 귀속) + app/chat.js spec_draft '지도 반영' 카드 | 폐기 |
| `3XL4-1` · 17 · 백테스트 — 출처에서 지도로 · 만드는 중(로딩) | (없음) — 백엔드 재료만: backend/athena_api/backtest/sources.py · youtube.py, MCP action source_brief(backend/athena_mcp/backtest_tools.py:78, 1082-1085) | 미구현 |
| `3XV1-1` · 18 · 백테스트 — 흐름 지도 강화 명세 · 칸·동사·버전·동기화·로딩 | backend/athena_api/backtest/mapmodel.py(A·B) · app/lib/backtest-explain.js(A·D) · app/lib/backtest-canvas.js(B·C·E·F) · deploy.py/deploy_orders.py(H) | 부분 |
| `40EV-1` · 19 · 백테스트 — 기법 목록 · 새 기법 | — | 부분 (e88ed20·49bfb7d) |
| `43DP-1` · 20 · 백테스트 — 새 기법 만들기 · 폴더·편집기·터미널·단계 카드 | — | 부분 |
| `43O1-1` · 21 · 백테스트 — 노드·흐름 창 · 노드를 누르면 @칩이 입력창에 들어간다 | — | 부분 |
| `452D-1` · 22 · 백테스트 — 고치기 순환 · 단계 카드를 누르면 diff와 터미널이 열린다 | — | 부분 |
| `42FW-1` · 23 · 백테스트 — 승인 → 기법 목록에 추가 → 실매매 적용(키우미가 켜지면 자동 매매) | — | 부분 |

**BT-01·04·05·06을 「적용」에서 내렸다.** 앱의 프로브가 같은 항목들을 미구현 계약으로 잠가 두고 있다 — `probe-backtest-full.js`의 B08(「지표 추가/삭제 버튼은 화면에 없다」) · H06(「이력 비교에는 파라미터·코드 diff가 없다」) · I11(「조합 수를 미리 세지만 렌더러에 배선은 없다」). 항목 단위 감사표는 `docs/architecture/backtest-parity-audit.md` §0·§10.5가 소유한다(2026-09-06에 `60/60`을 `58/60`으로 정정했다 — BT-04의 4-3·4-4·4-10·4-11과 5-7은 아직 재확인하지 않아 그 수가 상한이다). 그중 H06은 5e84d04가 닫았다(`GET /runs/{id}`가 실효 파라미터와 버전·소스를 함께 실어, 비교 패널에 파라미터 diff·코드 diff 두 칸이 선다 — 프로브 단언을 「있다」로 뒤집었다). B08·I11은 남아 있다.

**첫 표면은 보드 19다.** `기법 · 결과 · 이력` 탭이고, 기법을 고르기 전에는 지도·폼·코드가 서지 않는다. e88ed20·49bfb7d가 그 화면에서 대화로 시작하면 새 기법이 열리고 대화가 낸 코드가 폴더 씨앗에 덮이지 않게 했다.

**배포·수집의 안전 계약.** f54abfc가 한도를 비운 배포를 만들지 못하게 막았고(빈 `valid_to`는 만든 순간 만료인 배포를 낳았다 — 사람은 「켰다」고 믿는데 신호가 한 건도 안 나간다), 3dff75d가 사람이 멈춘 `stopped`를 만료 표기가 덮어쓰지 않게 상태와 만료를 분리했다. fb31b54가 수집 진행 카드에 `[중단]`을 세우고(`DELETE /jobs/{id}`), ac7cd32가 중단 뒤 늦게 온 응답이 실행을 열지 않게 막았다. `07`의 `auto` 모드 + 무장(`armed`)은 사람 클릭 없이 주문까지 나가며(2026-09-04 결정), 무장 스위치 자체는 사람 클릭이고 모의서버 하드락 안쪽이다.

---

## 백테스트 구현 현황 페이지 — 17

**2026-09-06 신설.** 이 페이지는 이전 판에 한 줄도 없었다(저장소 `.md` 전체에서 「백테스트 구현 현황」 검색 결과가 0이었다). Paper `G-1`은 `00 · 지금 구현된 것 · 요약과 의도 편차`와 `00b · 의도 대비 구현 상태 표`를 필두로 `01~15`까지 17장이며, 이름 자체가 「의도 대비 구현 상태」를 선언하는 **Paper 쪽 대조 원장**이다.

이 페이지는 방향이 반대다 — 다른 페이지는 Paper가 정본이고 앱이 따라가지만, 여기서는 보드가 2026-09-03 시점의 앱을 찍은 사진이라 **앱이 앞서면 보드가 낡는다**. 그래서 판정에 `Paper 낡음`이 여섯이다.

| Paper 보드 | 실앱 소유 표면 | 판정 |
| --- | --- | --- |
| `402S-1` · 00 · 백테스트 — 지금 구현된 것 · 요약과 의도 편차 | app/lib/backtest-canvas.js · app/lib/backtest-visual-editor.js · app/chat.js | Paper 낡음 |
| `405P-1` · 00b · 백테스트 — 의도 대비 구현 상태 표 | app/lib/backtest-canvas.js · backtest-visual-editor.js · backend/athena_api/backtest/* | Paper 낡음 |
| `40AA-1` · 01 · 백테스트 모드 진입 — 프리셋 10종 | app/lib/backtest-canvas.js renderTechniqueList() | Paper 낡음 |
| `40AL-1` · 02 · 지도 탭 — 요약 지도 ①~④ | app/lib/backtest-canvas.js renderFlowTab()/renderSummaryMap() | Paper 낡음 |
| `40AW-1` · 03 · 지도 탭 — 시각 편집기(팔레트·캔버스·검사기) | app/lib/backtest-visual-editor.js render() | 적용 |
| `40B7-1` · 04 · 노드 검사기 — ma_fast 하향 돌파 | app/lib/backtest-visual-editor.js renderInspector() | 적용 |
| `40BI-1` · 05 · 폼 탭 — 프리셋·대상·지표 | app/lib/backtest-canvas.js renderDesign() 기본 갈래 | Paper 낡음 |
| `40BT-1` · 06 · 코드 탭 — 지도가 만든 파이썬 | app/lib/backtest-canvas.js renderCodeTab() · app/lib/backtest-code-editor.js | 적용 |
| `40C4-1` · 07 · 연결을 끊은 지도 — BTG-PORT-002 | app/lib/backtest-visual-editor.js · backend/athena_api/backtest/visual_schema.py | 적용 |
| `40CF-1` · 08 · 오류 칸 → 코드 미리보기(__MISSING__) | app/lib/backtest-code-editor.js · backend/athena_api/backtest/codegen.py | 적용 |
| `40CQ-1` · 09 · 질문 카드 — 한 가지만 확인할게요 | app/chat.js visual_question 카드 · backend/athena_api/backtest/visual_repair.py | 적용 |
| `40D1-1` · 10 · 수정안 카드 — 그래프 + 코드 패치 | app/chat.js:3782-3812 visual_patch 카드 | 적용 |
| `40DC-1` · 11 · 적용 — 동기화 완료(v1 → v2) | app/lib/backtest-canvas.js:4846 applyVisualPatch · app/chat.js visual_synced 카드 | 적용 |
| `40DN-1` · 12 · 실행 결과 탭 | app/lib/backtest-canvas.js 결과 탭 · METRICS | 적용 |
| `40DY-1` · 13 · 이력 탭 — 저장된 버전 2개·실행 이력 | app/lib/backtest-canvas.js 이력 탭 | 적용 |
| `40E9-1` · 14 · 코드가 지도보다 앞섬 — 두 갈래 | app/lib/backtest-canvas.js:144·150·151 · :4176·4187 | 적용 |
| `40EK-1` · 15 · 창 폭 860px — 지도 탭 | app/lib/backtest-canvas.js:4485-4498 ResizeObserver → editor.setNarrow() | Paper 낡음 |

닫힌 편차 넷(보드가 「의도와 다르다」고 적었으나 지금은 아닌 것): 요약 지도가 편집기 위에 한 번 더 서는 중복(`backtest-canvas.js`의 `renderVisualDesign`이 더 이상 그리지 않는다 — 2026-09-03 사용자 확정) · 좁은 폭 서랍이 런타임에서 안 켜지는 것(`ResizeObserver`가 `visualHost` 폭을 재어 `setNarrow`를 부른다) · 탭 3개 전제(지금 4개) · 단위 테스트 빨강(지금 초록). `01`·`02`·`05`가 낡은 이유도 같다 — 2026-09-04 첫 화면 개편으로 목록이 먼저 서고 하위탭이 나중에 서는 순서로 뒤집혔고, 화면에서 「프리셋」이라는 말을 쓰지 않기로 했다.

---

## 이번 트랙에서 닫은 것 — 보드 ↔ 커밋

2026-09-05 전수 대조 뒤에 그 발견을 실제로 손댄 커밋만 적는다. 게이트·라우트표를 저작하기만 한 커밋(`test(verify)` · `chore(verify)`)은 판정을 바꾸지 않으므로 여기에 넣지 않는다.

| 페이지 | 보드 | 커밋 | 무엇을 닫았나 |
| --- | --- | --- | --- |
| 화면 | `2V0K-1` 33 | `17c0307` | CLI 연결 실패 행이 `[연결]` 그대로였다 → 행이 실패를 지고 클릭이 재시도가 된다 |
| 화면 | `2UWT-1` 32 | `01b24d3` `81ecdc7` `d960f3d` | nav 라벨만 「성향・이력」이고 카드는 보드 22를 그렸다 → 성향·이력 두 구역으로 되돌리고, 세는 것과 지우는 것을 맞추고, 전체 삭제 뒤 다시 읽는다 |
| 화면 | `2V27-1` 34 | `09f66b4` | 검색 결과가 평평한 목록이었다 → 그룹 머리 건수·행 오른쪽 시각·발치 키보드 안내 |
| 화면 | `XI-0` `FLM-0` `FPE-0` 15·16·17 | `395e537` | 계좌 등록이 한 상태였다 → 확인 중·인증 실패·확인 완료 3상태 |
| 화면 | `1M3-0` 21 | `4487e7e` `c78e01e` `2864d1b` | 계좌 전환에 들어갈 입구와 나올 출구가 없었다 |
| 화면 | `AJ-0` 13 | `71c262c` | 설정 오버레이가 반투명이라 뒤 셸이 비쳤다 → 창 전체를 덮고 다크 잔재 색을 Paper 잉크 알파로 |
| 화면 | `COS-0` 26 | `ff3c5ba` `ec8c701` | 빈 캔버스 첫 문구가 열 때마다 달라졌다 · 그래프 요약 탭이 백지로 남았다 |
| 화면 | `3VIQ-1` `3VV8-1` 35·37 | `3ad5c20` | 모드 구역 머리말과 `⋯` 메뉴 결과 줄이 없었다 |
| 화면 | `11D-0` 24 | `ae75d89` | 「열리지 않는 것」 제목이 다크 잔재 색이라 흰 시트에서 대비 1.06:1이었다 |
| 화면 | `1OP-0` 22 | `60b80e8` | 주문 티켓에 가격 행과 총 주문 금액 추정이 없었다(부분) |
| 그래프 | `31H-0` 04 | `3ff1fa4` | 채팅→그래프 제어 구독이 요약 헤더 함수 안에 갇혀 있었다 |
| 그래프 | `2QCN-2` 07 | `ec8c701` | 요약 탭이 백지로 남는 경로(부분) |
| 에이전트 | `4330-1` 08 | `0db0399` | 결과 턴 자체가 없었다 → `routine-control-turn.js` 4상태 |
| 에이전트 | `446V-1` 10 | `cbe8a1b` `f2bada5` `1c9a3ef` `d8633eb` | 승인 패널·자동 검사 5줄·「다시 시도」 재호출·검사 실패 마크 |
| 에이전트 | `44RV-1` 12 | `f7419f4` `dd31d7a` | 쿨다운 `86400초` · 울린 기록 머리 · 억제된 줄에 붙은 문 |
| 에이전트 | `56X-0` 01 | `09acd83` `d22eccf` | 알림 방 머리 문구 · 「관제 창으로 →」가 매번 빈 대화를 새로 만들었다 |
| 에이전트 | `BV0-0` 05 | `3767668` | 작업 뷰 하단 규칙이 GUI 입구를 부정하는 옛 문구였다(문면만 닫혔고 시트·폼·확정 버튼은 남았다) |
| 플러그인 | `CU0-0` 03 | `ff9da67` | 서버 추가 시트의 확정 버튼이 `[승인]`이라 여기서 등록이 끝난 것처럼 읽혔다 |
| 플러그인 | `CVY-0` 04 | `640b65d` | 관리 행 차례와 등록 제안 근거 줄 |
| 플러그인 | `2NW8-2` 05 | `b1eb4e3` | 승인 카드 본문이 「권한 N개 요청」 한 줄뿐이었다 |
| 키우미 | `CLE-0` `C8G-0` 06·07 | `f53bb65` | 메뉴 설명 넷이 Paper와 갈렸다 |
| 키우미 | `5EU-0` 05 | `597268e` | 최소화가 오브를 미니 채팅으로 뒤집었다 → 표시 모드를 창 가시성과 분리 |
| 카드 | `137X-2` `32S7-0` | `c04b442` `525e9a3` `96a409e` `860443f` `94543e4` | 차트가 자기 보드 밖에서 떴다 · 라우팅이 recipe 축이었다 · 상태 보드를 갈아타면 남의 차트가 얹혔다 |
| 카드 | `13BC-2` `1JPU-0` | `c04b442` `525e9a3` `a41b863` `6bfc829` | 호가 사다리가 예외로 보드를 피했다 |
| 카드 | `2R3M-1` `2RBO-1` `2SKU-1` | `860443f` `cdedb5a` `f860bb0` | 시세 착지 지점 · 중간 폭이 Paper 1360에 붙는 것 · 한글 폴백이 최소 폭 게이트를 깨는 것 |
| 카드 | `13K0-2` `2WZK-0` `30HY-0` | `381650d` `863d397` | 순위 본표가 표로 서지 않았다 · 스트립·정렬 칩이 엉뚱한 잎에 붙었다 |
| 카드 | `15Y5-2` C02 | `fb25723` | 좁은 창에서 사다리가 5열 10단 고정이라 418px을 요구했다 |
| 카드 | `161Q-2` `1IG3-0` | `ae75d89` `951a275` | 빈·거부 상태 문구에 내부 용어가 남아 있었다 · 중단과 인증 만료가 이미 받은 값을 지웠다 |
| 백테스트 | `1TPF-1` 04 | `fb31b54` `ac7cd32` | 수집 진행 카드에 `[중단]`이 없었다 · 중단 뒤 늦게 온 응답이 실행을 열었다 |
| 백테스트 | `1WSI-1` 05 | `5e84d04` | 이력 비교에 파라미터·코드 diff가 없었다 |
| 백테스트 | `2FMM-2` 07 | `f54abfc` `3dff75d` `610843d` | 한도를 비운 배포 · 만료가 `stopped`를 덮어쓰는 것 |
| 백테스트 | `40EV-1` 19 | `e88ed20` `49bfb7d` | 목록 화면에서 대화로 시작하면 아무 데도 서지 않았다 |

## 검증 증거

아래 수치는 **각 커밋이 기록한 실행 결과**다. 이 문서를 쓰면서 게이트를 다시 돌리지는 않았다.

| 게이트 | 결과 | 기록한 커밋 |
| --- | --- | --- |
| 앱 단위 전체 | 3,180 / 3,180 | `ac7cd32` |
| `verify:paper-screens` | 래칫 53장 잠금(대상 115, 전수 12초, 줄어든 보드 0) | `db10e28` |
| `verify` (앱 전역 하네스) | 전 단언 통과 | `610843d` |
| `verify:agent-paper-parity` | 단언 실패 0 | `610843d` `1c9a3ef` |
| `verify:plugins` | 154 / 154 | `b1eb4e3` |
| `verify:kiumi` | 22 / 22 | `597268e` `f53bb65` |
| `verify:integrated-cards` | 6보드 × 4단계 overflow 0 · `2SKU-1` M 구간 통과 | `f860bb0` |
| `verify:hoga-live` | 초록(rows 20 유지) | `fb25723` |
| `verify:settings` · `verify:settings-cards` | 통과 | `01b24d3` `81ecdc7` |
| backend `test_backtest_api.py` | 20 / 20 | `5e84d04` |
| `verify:paper-mini` | **빨강 — 의도된 것.** 어긋난 보드 목록이 산출물이다 | `84f5351` |

리포트·캡처는 `app/captures/`(`VERIFY-REPORT.json` · `VERIFY-PLUGINS-REPORT.json` · `paper-gates/PAPER-MINI.json` · `kiumi-96/`)에 남는다.

## 의도적으로 만들지 않은 것

- **키우미 얼굴 5종.** Paper `2I7Z-2`(키우미 08)의 모드별 얼굴은 2026-09-01 사용자 결정으로 폐기했다. `app/lib/kiumi-face.test.js`가 5종의 마크업·CSS 부재를 고정하고 `verify:kiumi`가 5모드 전부 `visibleCount:1`을 잰다.
- **설정 안의 플러그인 표면.** Paper `2USX-1`(화면 31)은 플러그인 모드 관리 뷰(`15J-0`)로 흡수했다. 같은 레지스트리를 두 화면에서 부르지 않는다.
- **캔버스의 「되돌리기」·「지난 고침 N건」.** 채팅 카드가 소유한 고침 이력이라 캔버스에 중복해 그리지 않는다(에이전트 보드 11).
- **에이전트 드릴인의 조건 편집 폼.** 조건은 감시 함수 자체라 「고치기 — 말로」로만 바뀐다.
- **요약 지도 표면.** 백테스트 `15`·`16`이 폐기한 자리다. 되살리면 회귀다.
- **OAuth 인증 2종.** 299 카드 집계에서 제외하고 화면 페이지의 인증 상태 보드에 남겼다.

## 이 개정에서 지운 것

이전 판(2026-08-29 기준, 96 artboards)에서 아래를 지웠다. 지운 이유를 남기는 것은 다음 사람이 같은 표를 되살리지 않게 하기 위해서다.

| 지운 것 | 이유 |
| --- | --- |
| 「화면 페이지 — 60/60」 표의 7행(37·38·39 이전 셸 v2 참고 · 51 · 52 · 55 리퀴드 글래스 배경 · 57 굴절 재질) | Paper 화면 페이지에서 사라졌다(`find_nodes('*리퀴드*')` 0건, `('*이전 셸*')` 0건) |
| 「카드 페이지 — 31/31」 표 31행 | 그 이름의 보드가 Paper 카드 페이지에 하나도 없다. 렌더 계약으로 성격을 바꿔 남겼다 |
| 「부팅 화면 상세 페이지 — 5/5」 별도 절 | 부팅 5장은 화면 페이지(`1-0`) 안의 보드다. 별도 페이지가 아니다 |
| 부팅 소유 파일 `boot.css` · `boot.js` | 저장소에 없는 파일이다 |
| 그래프 03·04의 `graph-mode/render.js` · `renderClusterBubbles()` · `renderClusterMap()` | 파일도 함수도 없다. 실제 렌더러는 `live-map.js`의 `createLiveMap()` |
| 에이전트 절 머리글 「6 artboards」 | 12장이다 |
| 「백테스트 보드 23장」 | 26장이다 |
| BT-15 · BT-16의 `적용 (4b0df46)` | Paper가 두 보드를 폐기로 개명했다 |
| 설정 nav 4종의 「그래프」 | `NAV_ITEMS`는 `화면 · 계좌 · 모델 · 성향・이력`이다 |
| 플러그인 치수 각주 「01~05·07~09가 1680×986」 | 실측은 02 1680×900 · 03 1680×972 · 04 1680×983이다 |
