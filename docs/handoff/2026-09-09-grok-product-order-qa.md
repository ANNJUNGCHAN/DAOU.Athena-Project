# 모의 상품별 주문 QA 원장 — 2026-09-09 Grok 재개

이 문서는 `codex/grok-handoff-20260909`를 **이 PC·이 체크아웃**에서 재개한 검증 원장이다.
이전 PC의 접수 시각·스크린샷·`CARD-API-SWEEP.json`은 여기의 성공 증거가 아니다.
API 키·토큰·계좌 원문·암호화된 자격 블롭은 기록하지 않는다.

기준 HEAD(작업 시작): `b8dbce1a` (`chore(handoff): 현재 작업 전체를 Grok 인수인계 스냅샷으로 보존한다`).
앱 단위 테스트 보강만 이 세션에서 추가했다. 편집기·백테스트·카드 작업 파일은 되돌리지 않았다.

## 1. 이 환경에서 확인한 것 / 확인하지 않은 것

| 범위 | 이 환경 |
|---|---|
| 브랜치 | `codex/grok-handoff-20260909` |
| 이 체크아웃 `backend/.env` | 없음. example은 `ATHENA_ENABLE_ORDER_API=false`, cash-only 예시 |
| 모의 주문 조회·접수·체결 | **불가** (인증 없음). 기존 005930/069500을 재전송하지 않음 |
| 금현물 세 문장 → 차단 티켓 | **확인** (단위 테스트 + Electron 프로브 2회) |
| 금현물 시장가 실행 차단 | **유지**. 빈 단가를 시장가로 보내지 않음. 매매구분 코드를 만들지 않음 |
| 실계좌 주문 | 하지 않음 |
| 금/ELW 접수·체결 | 완료로 주장하지 않음 |
| 카드 전수·실시간 스윕 | 모의 백엔드 없음. 실행하지 않음. 이전 「결측 0」은 철회된 기록 |
| 라이브 채팅 세 문장 | 실행 중인 앱 없음. 금 주문 경로는 모델 호출 0의 로컬 가로채기 |

남은 외부 제한: 이 체크아웃용 모의 `backend/.env`(키·계좌 권한), 금현물 주문 스코프, 공식 시장가 매매구분 계약, 장중 여부, 라이브 Electron 채팅 세션.

## 2. 금현물 티켓 (세 문장)

입력:

1. `금99.99_1kg 1g 매수 주문 티켓을 열어줘.`
2. `단가 시장가`
3. `티켓이 안보여`

| 항목 | 결과 |
|---|---|
| 상품 | `금 99.99_1kg` (1kg, 100g 아님). 코드 `M04020000` |
| 수량 | `1`, 단위 `g` |
| 주문 유형 | 시장가 요청 |
| 모달 | 실제 표시 `visible=true` |
| 실행 | `execution_supported=false`, 구매 버튼 disabled |
| 제한 사유 | 금현물 주문 API에서 시장가 매매구분 코드가 확인되지 않아 실행할 수 없습니다 |
| 주문 본문 | `trde_tp` 없음. 빈 `ord_uv`를 시장가로 전송하지 않음. `buildOrderPayload` 예외 |
| 계좌/수량/실행 호출 | 각 0 |

근거:

- `node --test lib/main/gold-order-intent.test.js lib/order-ticket.test.js` → 49 pass / 0 fail. 세 문장은 `resolveGoldOrderTurn` → `buildSelectorOrderPrefill` → `createTicket` → `buildOrderPayload` 거절까지 같은 초안을 유지한다. `main.js` 금 주문 분기는 `athena:selector-order-draft`만 보내고 계좌·수량·실행 IPC를 부르지 않는다.
- Electron 프로브 2회 (`app/node_modules/electron/dist/electron.exe app/probe-gold-order-ticket.js`), 둘 다 exit 0 · `ok: true`. 타임스탬프(로컬) 2026-09-09 20:51:29, 20:51:42. 상품 행에 `금 99.99_1kg`, qty `1`, unit `g`, 읽기값 `시장가 요청 · 실행 불가`, 차단 문구에 시장가 매매구분, `accountList`/`ticketCapacity`/`orderExecute` = 0.
- `app/main.js`의 라이브 질의는 금 주문 초안을 모델보다 먼저 처리하고 `athena:selector-order-draft`만 보낸다 (`modelCalls: 0`). 계정 조회·주문 실행 IPC를 이 분기에서 부르지 않는다.

차단을 해제하지 않았다. 시장가 매매구분 코드를 추정하지 않았다.

## 3. 상품별 QA

분류 값: 접수 / 체결 / 불명 / 미지원.
원인 값: API 미지원 / 인증 / 휴장 / 공란 / 코드 버그.
HTTP 200이나 모델 완료 문구만으로 접수·체결·화면 표시를 확정하지 않는다.

| 상품 | 이번 환경 | 이전 세션 주장 (재검증 아님) | 원인 |
|---|---|---|---|
| 주식 005930 | 조회 안 함. 재전송 안 함 | 2026-09-09 14:29:53 모의 1주 접수번호. 체결 미확인 | **인증** (이 체크아웃에 모의 키 없음) |
| ETF 069500 | 조회 안 함. 재전송 안 함 | 15:30:55 1주 시도는 접수 미확정·불명. 자동 재시도 금지 | **인증** + 이전 결과 **불명** |
| 금현물 | 티켓 표시·실행 차단 확인. 접수/체결 없음 | 동일 | **API 미지원** (시장가 매매구분 미확정). 장중·공란은 실행을 시도하지 않아 미판정 |
| ELW | 조회 안 함. 주문 안 함 | 종목 식별·조회만 이전 세션. 접수/체결 없음 | **인증**. 모의 주문 지원 여부는 이번 환경에서 미확인 |

주식 접수를 이번 환경의 접수로 승격하지 않는다. ETF 불명을 재전송으로 지우지 않는다.

## 4. API 실패 · 실시간 정책 · 카드 미제공 · 티켓 미표시

이번 세션에서 **새로 재현한 코드 버그는 없다.** 금 티켓 미표시는 이미 브랜치의 `45823f91` 등으로 고쳐져 있었고, 이 환경에서 회귀하지 않았다.

| 증상 | 이번 환경 |
|---|---|
| 주문 티켓 미표시 | 재현되지 않음. 프로브 모달 visible |
| API 실패 | 모의 호출을 하지 않음. 키 부재를 성공으로 바꾸지 않음 |
| 실시간 연결 정책 | 스윕 미실행. 이전 수치를 현재 성공으로 읽지 않음 |
| 카드 미제공 | 스윕 미실행. 공란·모의 미지원을 가짜 값으로 채우지 않음 |

카드/실시간 프로브(`verify:card-api-sweep`, `verify:semantic-workspaces`, `verify:card-buttons`)는 이 체크아웃 백엔드와 모의 인증이 없어 건너뛰었다. 장시간 스윕 생략은 이 목표의 실패 조건이 아니다.

## 5. 코드 변경

- `app/lib/main/gold-order-intent.test.js` — 세 문장이 1kg / 1g / 시장가 / `execution_supported=false` / `trde_tp`·`ord_uv` 없음을 단언. `main.js` 금 분기가 계좌·수량·실행 IPC를 부르지 않음을 소스에서 단언
- `app/lib/order-ticket.test.js` — 같은 세 문장을 티켓 프리필·생성·`buildOrderPayload` 거절까지 연결

동작 코드는 바꾸지 않았다. 금 실행 차단은 그대로다.

## 6. 검증 명령 (재실행)

```powershell
Push-Location app
node --test lib/main/gold-order-intent.test.js lib/order-ticket.test.js
& ./node_modules/electron/dist/electron.exe ./probe-gold-order-ticket.js
Pop-Location
git diff --check
```

`npm ci`만으로는 Electron 바이너리가 빠질 수 있다. 빠지면 `node node_modules/electron/install.js`.

## 7. 다음에 필요한 자원

이 체크아웃에만 넣는 모의 `backend/.env`(주문 API 키는 저장소에 쓰지 말 것). 금 주문 스코프는 example의 cash-only를 임의로 넓히지 말고, 운영자가 의도한 계정만 연결한다.
기존 005930/069500은 **조회만**. 불명 ETF는 재전송하지 않는다.
금 시장가 매매구분은 공식 계약이 이 환경에서 관측되기 전에는 차단을 유지한다.
라이브 채팅 재현은 실행 중인 셸에서 새 대화로 세 문장만 입력하면 된다(모델 설정 변경 불필요, 금 경로는 로컬 가로채기).
