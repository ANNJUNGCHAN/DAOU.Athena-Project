# WebSocket 23개 catalog 실행 차단 보고

- 기준 HEAD: `ac8452f5b62a338d74826ac27cf65da12d99320b`
- 구현: `scripts/market-session-audit/ws-active-catalog.mjs`
- catalog 작업 중 실제 네트워크·REG·REMOVE: 0

## 결론

23개 ID와 request 입력 후보는 분류할 수 있지만, 공유 account runtime에는 active lease inventory, group reservation, owner token이 없다. 난수 4자리 group은 이번 probe 안의 중복만 막을 뿐, 기존 호출자의 동일 `{type, group, item}` lease와 충돌하지 않는다는 증거가 아니다. 충돌하면 probe REMOVE가 기존 lease를 제거할 수 있다.

따라서 catalog active 실행은 전면 `BLOCKED_OWNERSHIP_DISCOVERY`다. `--execute`도 credential, fetch, socket을 사용하기 전에 23개 차단 결과만 artifact로 쓰며 network request는 0이다. caller가 rows, token, transport를 넘겨도 이 gate를 우회할 수 없다. 기존 passive 검사는 `ws-passive.mjs`가 이미 제공하므로 중복 구현하지 않았다.

## exact 23 분류

- 입력/request 계약상 eligible이나 ownership 차단된 REAL 13: `00`, `04`, `0A`, `0B`, `0C`, `0D`, `0E`, `0F`, `0H`, `0g`, `0s`, `0w`, `1h`.
- fresh 입력 미해결 REAL 6: ETF `0G`, 국제금 `0I`, 업종 `0J`/`0U`, ELW `0m`/`0u`.
- 조건 목록 `ka10171`: persistent lease는 없지만 response shape 구현·검토 전이므로 `BLOCKED_IMPLEMENTATION_REVIEW`.
- 조건 일반 `ka10172`: 유효 condition seq 미해결로 `BLOCKED_INPUT`.
- 조건 lease `ka10173`/`ka10174`: `condition:<seq>` owner namespace가 없어 `BLOCKED_OWNERSHIP_DISCOVERY`.

`0G`와 `0g`는 별도 ID로 대소문자를 유지한다. 과거 sweep의 ETF·금·업종·ELW 상수는 2026-09-07 현재 유효성 증거가 아니므로 사용하지 않는다. `00`/`04`는 주문이나 잔고 변화를 만들지 않으며, eligibility는 request shape에 한정된다.

## 이전 단일 0B 기록과의 관계

14:28과 14:46의 단일 `0B` probe는 best-effort random group으로 이미 수행됐고, 실제 피해 증거는 없다. 그러나 group namespace가 비어 있었다는 증거도 없으며 cleanup API 0은 synthetic 가능성 때문에 upstream ACK가 미검증이다. 해당 역사적 artifact를 삭제하거나 확대 해석하지 않는다. 이 catalog는 그 best-effort 방식을 13개로 확장하지 않는다.

## source/runtime 상태

definitions와 common manifest의 WebSocket 23개 exact set은 실행 없이 재대조한다. 원본 disk의 `generated/runtime.py`는 감사 기준 blob `24a0140b...`에서 `39d6d0bc...`로 변경됐지만 독립 diff에서 `call_websocket_tr` hunk, generated routes/registry, `ws_client`는 동일했다. listener PID 44724가 disk 변경 전 시작됐으므로 loaded module blob은 disk만 보고 단정하지 않는다. ownership gate가 먼저 차단하므로 이 불확실성을 이유로 active 호출을 시도하지 않는다.

## 검증

```powershell
node --check scripts/market-session-audit/ws-active-catalog.mjs
node --test scripts/market-session-audit/ws-active-catalog.test.mjs
```

회귀는 exact 23/case, 13 REAL capability eligibility와 ownership block 분리, 나머지 입력·조건 blocker, forged executable rows와 credential/transport를 주입해도 fetch/socket 0회를 검사한다.
