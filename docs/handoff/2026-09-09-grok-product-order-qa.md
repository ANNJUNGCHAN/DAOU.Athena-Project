# 모의 상품별 주문 QA 원장 — 2026-09-09 Grok 재개

이 문서는 `codex/grok-handoff-20260909`를 **이 PC**에서 재개한 검증 원장이다.
이전 PC의 접수 시각·스크린샷·`CARD-API-SWEEP.json`은 여기의 성공 증거가 아니다.
API 키·토큰·계좌 원문·암호화된 자격 블롭은 기록하지 않는다.

앱 단위 테스트·티켓 재표시 수정·라이브 채팅 프로브·이 체크아웃 8010 점유 조회·카드 전수를 이 세션에서 추가했다.
편집기·백테스트·카드 작업 파일은 되돌리지 않았다. `backend/.env`는 gitignore이며 커밋하지 않는다.

## 1. 이 환경에서 확인한 것 / 확인하지 않은 것

| 범위 | 이 환경 |
|---|---|
| 브랜치 | `codex/grok-handoff-20260909` |
| 모의 키 | 로컬 gitignore `.env`. `ATHENA_ENABLE_ORDER_API=false`. 베이스 URL은 mockapi.kiwoom.com |
| 8010 | **이 체크아웃** `backend/` uvicorn. 다른 워크스페이스 Electron/uvicorn을 내려 점유함 |
| 주문 조회 | 이 백엔드로 조회만. 주문 TR은 호출하지 않음 |
| 금현물 세 문장 라이브 채팅 | **확인** (티켓 갱신·재표시 포함) |
| 금현물 시장가 실행 차단 | **유지**. 공식 `kt50000.trde_tp`는 `00` 보통 / `10` IOC / `20` FOK뿐 |
| 실계좌 주문 | 하지 않음 |
| 카드 전수 스윕 | 101장 실행. 결측어 15장 236자리 화면에 `미제공`. 잘림·겹침·마운트 실패·기하 0. 「결측 0」은 철회 |

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
| 주식 005930 | 미체결 0. 체결조회 `ka10076` 행 1: 종목 005930, 주문번호 있음, 상태 체결, 수량 1, 시장가. `kt00007` 당일 현금매수 1행. 재전송 안 함 | **접수·체결** (조회 행으로 확인. HTTP 200만으로 단정하지 않음) |
| ETF 069500 | `kt00007`/`ka10076` 종목 지정 행 0. `모의투자 해당조회내역이 없습니다.` 재전송 안 함 | **공란**. 이전 결과 **불명**은 재시도로 지우지 않음 |
| 금현물 | 라이브 티켓 표시·실행 차단. 접수/체결 없음. 잔고 보드 `3ODO-0` hydrate filled 0, 결측어 39 | **API 미지원** (시장가 매매구분 없음) + 잔고 **공란/미제공** |
| ELW | `ka30012` 기본 경로는 split이라 404. detail `market_snapshot` HTTP 200, 시세 필드 채워짐. 주문 안 함 | 조회 **확인**. 접수 **없음** |

## 5. API 실패 · 실시간 정책 · 카드 미제공 · 티켓 미표시

| 증상 | 이번 환경 |
|---|---|
| 주문 티켓 미표시 | 라이브 후속 초안에서 재현 → §3 수정 후 프로브 통과 |
| API 실패 | 조회는 mock 완료. 주문 API는 OFF |
| 실시간 연결 정책 | 단위 51 pass. 카드 전수에서 잘림·겹침·기하 0 |
| 카드 미제공 | **15장 236자리** 화면에 `미제공`으로 남김. 가짜 값으로 채우지 않음. 게이트는 결측을 실패로 센다 |

전수 시각 `2026-09-09T14:57:37Z`, 경과 121s, `backend_base=http://127.0.0.1:8010`. 결측 보드: `133H-2`(7) `2S4E-1`(1) `2SCE-1`(16) `2SKU-1`(34) `2SRV-1`(13) `2SYW-1`(11) `31OF-0`(1) `3GRO-0`(16) `3IGR-0`(6) `3K7K-0`(37) `3LGC-0`(21) `3MTJ-0`(23) `3NVG-0`(7) `3ODO-0`(39) `3UTA-0`(4). 대부분 CC-01 계좌 상세. `verify:card-buttons`는 이번 실행에 포함하지 않음.

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

- 금 시장가 매매구분은 공식 계약에 없다. 차단 유지.
- ETF 069500 불명은 재전송하지 않는다.
- 계좌 카드 결측 236자리는 화면의 `미제공`으로 남긴다. 모의 공란과 미전달 인자를 값으로 채우지 않는다.
- `verify:card-buttons`·semantic-workspaces는 이번 8010 점유 실행에 넣지 않았다.
- 로컬 `backend/.env`는 커밋하지 않는다. 주문 API는 OFF로 유지한다.
