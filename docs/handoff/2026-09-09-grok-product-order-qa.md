# 모의 상품별 주문 QA 원장 — 2026-09-09 Grok 재개

이 문서는 `codex/grok-handoff-20260909`를 **이 PC**에서 재개한 검증 원장이다.
이전 PC의 접수 시각·스크린샷·`CARD-API-SWEEP.json`은 여기의 성공 증거가 아니다.
API 키·토큰·계좌 원문·암호화된 자격 블롭은 기록하지 않는다.

앱 단위 테스트·티켓 재표시 수정·라이브 채팅 프로브를 이 세션에서 추가했다.
편집기·백테스트·카드 작업 파일은 되돌리지 않았다. `backend/.env`는 gitignore이며 커밋하지 않는다.

## 1. 이 환경에서 확인한 것 / 확인하지 않은 것

| 범위 | 이 환경 |
|---|---|
| 브랜치 | `codex/grok-handoff-20260909` |
| 모의 키 | 로컬 gitignore `.env`로 조회만. `ATHENA_ENABLE_ORDER_API=false`. 베이스 URL은 mockapi.kiwoom.com |
| 이 체크아웃 백엔드 8011 | 자격 잠금 충돌로 기동 실패. 다른 로컬 Athena 백엔드가 같은 모의 계정을 점유 |
| 주문 조회 | 점유 중인 8010으로 조회만. 주문 TR은 호출하지 않음 |
| 금현물 세 문장 라이브 채팅 | **확인** (첫 문장 티켓 → 단가 시장가 갱신 → 숨긴 뒤 `티켓이 안보여` 재표시) |
| 금현물 시장가 실행 차단 | **유지**. 공식 `kt50000.trde_tp`는 `00` 보통 / `10` IOC / `20` FOK뿐. 시장가 코드 없음 |
| 실계좌 주문 | 하지 않음 |
| 금/ELW 접수·체결 | 완료로 주장하지 않음 |
| 카드 전수 스윕 | 이 체크아웃 소스가 8010을 못 잡음. 이전 「결측 0」은 철회된 기록 |

## 2. 금현물 티켓 (세 문장, 라이브 채팅)

입력:

1. `금99.99_1kg 1g 매수 주문 티켓을 열어줘.`
2. `단가 시장가`
3. `티켓이 안보여`

| 항목 | 결과 |
|---|---|
| 1문장 | 모달 visible. 상품 `금 99.99_1kg`, qty `1`, unit `g`. 유형 미지정 · 실행 불가 |
| 2문장 | 같은 모달이 시장가 요청 · 실행 불가로 갱신. 차단 사유는 시장가 매매구분 코드 미확인 |
| 3문장 | 모달을 숨긴 뒤 같은 차단 초안으로 다시 표시 |
| 실행 | 구매 버튼 disabled. 계좌/수량/실행 호출 0 |
| 주문 본문 | `trde_tp` 없음. 빈 `ord_uv`를 시장가로 전송하지 않음 |

근거: `app/probe-gold-chat-ticket.js` Electron 실행 exit 0 · `ok: true`. 단위 테스트 52 pass. 공식 계약은 `backend/athena_api/generated/models.py` `Kt50000Request.trde_tp`.

차단을 해제하지 않았다. 시장가 매매구분 코드를 만들지 않았다.

## 3. 재현한 코드 버그 — 후속 초안이 열린 티켓을 갱신하지 않음

증상: 라이브 채팅 1문장에서 티켓이 열린 뒤 `단가 시장가`와 `티켓이 안보여`는 대화 답변만 나오고 모달이 그대로이거나 숨긴 채 다시 안 떴다. IPC 단발 프로브는 닫힌 상태에서 초안을 한 번만 보내 이 경로를 놓쳤다.

원인: `openOrderTicket`이 `orderOpen`이면 즉시 return.

수정: `orderTicket.canPresentOrderTicket`은 이미 열린 티켓을 막지 않는다. 후속 초안은 다시 그리고 `hidden=false`로 표시한다.

회귀: `app/lib/order-ticket.test.js`, `app/probe-gold-chat-ticket.js`.

## 4. 상품별 QA

분류 값: 접수 / 체결 / 불명 / 미지원.
원인 값: API 미지원 / 인증 / 휴장 / 공란 / 코드 버그.
HTTP 200이나 모델 완료 문구만으로 접수·체결·화면 표시를 확정하지 않는다. 빈 목록은 접수가 아니다.

| 상품 | 이번 환경 | 원인 |
|---|---|---|
| 주식 005930 | 미체결·체결·당일 주문내역 조회 HTTP 200 / `return_code` 0. 행 0. `kt00007` 메시지 `모의투자 해당조회내역이 없습니다.` 재전송 안 함. 이전 PC 접수번호는 재확인되지 않음 | **공란** |
| ETF 069500 | 동일. 종목 지정 조회도 행 0. 재전송 안 함 | **공란**. 이전 결과 **불명**은 그대로 두고 재시도하지 않음 |
| 금현물 | 라이브 티켓 표시·실행 차단 확인. 접수/체결 없음. 공식 매매구분은 보통/IOC/FOK | **API 미지원** (시장가 매매구분 없음) |
| ELW | 식별 단위 테스트는 기존. 점유 8010에서 `ka30012` HTTP 404 (이 체크아웃 라우트가 아님). 주문 안 함 | **미지원/미확인** (점유 백엔드 경로). 접수 없음 |

## 5. API 실패 · 실시간 정책 · 카드 미제공 · 티켓 미표시

| 증상 | 이번 환경 |
|---|---|
| 주문 티켓 미표시 | 라이브 후속 초안에서 재현 → §3 수정 후 프로브 통과 |
| API 실패 | 조회는 mock 완료 메시지. 주문 API는 OFF. 값을 채워 넣지 않음 |
| 실시간 연결 정책 | `integrated-card-realtime` / `realtime-account-boundary` 단위 51 pass. 전수 스윕 미실행 |
| 카드 미제공 | 전수 스윕 미실행. 이 체크아웃이 8010을 점유하지 못함 |

## 6. 코드 변경

- `app/chat.js` — 이미 열린 주문 티켓도 후속 초안을 다시 연다
- `app/lib/order-ticket.js` — `canPresentOrderTicket` (`orderOpen`은 거절 사유가 아님)
- `app/lib/order-ticket.test.js` · `app/lib/main/gold-order-intent.test.js` — 세 문장·공식 계약·재표시 회귀
- `app/probe-gold-chat-ticket.js` — 라이브 채팅 세 문장 프로브

금 실행 차단은 그대로다.

## 7. 검증 명령

```powershell
Push-Location app
node --test lib/main/gold-order-intent.test.js lib/order-ticket.test.js
& ./node_modules/electron/dist/electron.exe ./probe-gold-chat-ticket.js
& ./node_modules/electron/dist/electron.exe ./probe-gold-order-ticket.js
Pop-Location
git diff --check
```

## 8. 남은 외부 제한

- 이 체크아웃 백엔드는 같은 모의 자격의 프로세스 잠금 때문에 8010/8011을 못 잡는다. 조회는 이미 떠 있던 다른 체크아웃 8010으로만 했다.
- 카드 전수·semantic-workspaces·card-buttons는 현재 소스+모의 백엔드가 같은 8010을 쓸 때 다시 실행한다.
- 금 시장가 매매구분은 공식 계약에 없다. 차단 유지.
- 기존 005930/069500은 조회만. 빈 내역을 재전송으로 채우지 않는다.
