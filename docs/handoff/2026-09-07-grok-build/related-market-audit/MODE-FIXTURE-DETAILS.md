# Mode and session fixture verification details

검사 시각은 2026-09-07 10:14~10:22 KST다. 대상은 `codex/market-session-audit-20260907`의 `ac8452f`이며 제품 코드는 수정하지 않았다. 이 문서는 fixture 및 독립 임시 백엔드 결과다. 현재 장중 앱, 실제 사용자 프로필, 실제 주문·브로커·LLM 동작을 통과시킨 증거로 사용하면 안 된다.

## 격리 계약

| 대상 | source 계약 | 실행 판정 |
| --- | --- | --- |
| `app/verify.js` | `ATHENA_NO_AUTOSTART=1`, `ATHENA_CANVAS_SOURCE=fixture`; `createFreshVerifyProfile()`로 임시 `userData`; 임시 `CODEX_HOME` 및 MCP registry | 안전. `npm run verify`로 실행해야 npm이 cleanup watchdog용 `npm_node_execpath`를 제공한다. 추가로 임시 `HOME`/`USERPROFILE`, 닫힌 `127.0.0.1:9`, `--user-data-dir`를 강제했다. |
| `app/verify-graph-mode.js` | `mkdtemp` 아래 `userData`, `brain.sqlite3`, `chat-outbox.sqlite3`; 무작위 bearer; 동적 loopback 포트의 자체 uvicorn; Claude 추출과 routines 비활성 | 안전. fixture 문자열 대신 독립 seeded graph backend를 실제 호출한다. Electron 시작부터 `--user-data-dir`를 지정해야 현재 환경에서 안정적으로 기동했다. |
| `app/probe-backtest-mode.js` | `resolveHarnessProfile()`만 사용하며 자체적으로 `NO_AUTOSTART`와 backend URL을 고정하지 않음 | 조건부 안전. 실행 환경에서 `NO_AUTOSTART=1`, fixture, 임시 `HOME`/`USERPROFILE`, `127.0.0.1:9`를 강제했다. |
| `app/probe-agent-paper-parity.js` | `NO_AUTOSTART=1`, fixture, probe 전용 profile; routines IPC mock | 안전. backend/provider/order 호출 없이 화면과 IPC mock만 검사했다. |
| `app/probe-session-restore.js` | `mkdtemp` userData/session DB; `NO_AUTOSTART=1`; backend `127.0.0.1:9`; routines 비활성 | 안전. backend와 Claude가 없는 복원 경로만 검사했다. |

모든 실행은 순차 수행했다. 실행 셸에만 임시 `HOME`/`USERPROFILE`을 지정했고 `ATHENA_USERDATA_DIR` 상속을 제거했다. `ATHENA_PERSISTENT_CHAT=0`, routines 비활성, 닫힌 backend URL을 함께 사용했다. 그래프 프로브만 자체 임시 backend를 사용했다.

## 결과

| 검사 | 결과 | 소요 | 근거 |
| --- | --- | ---: | --- |
| Backtest mode | **PASS**, 5/5 | 6.398초 | `fixture-backtest-20260907-101427-1178.log`, `backtest-mode-probe-20260907-101531-1952.json` |
| Agent Paper parity | **PASS**, 실패 0, renderer console error 0 | 6.135초 | `fixture-agent-parity-20260907-101446-5313.log`, `probe-agent-paper-parity-20260907-101531-1952.json` |
| Session restore | **PASS**, 42/42 | 9.824초 | `fixture-session-restore-20260907-101506-9521.log` |
| Graph mode | **PASS**, 140 checks, 실패 0 | 53.989초 | `isolated-graph-mode-userdir-20260907-101654-4593.log`, `verify-graph-mode-20260907-101802-6015.json` |
| Full fixture verify | **FAIL**, 실패 단언 5건 | 98.923초 | `fixture-verify-full-npm-20260907-101939-3151.log`, `VERIFY-REPORT-fixture-20260907-102211-8156.json` |

아티팩트 디렉터리는 `artifacts/market-session-audit/2026-09-07/baseline-tests/`다.

### Full fixture verify 실패 단언

1. `boot readiness: degraded startup opens without retry UI and notifies shell, orb, and OS exactly once`
   - 관측: degraded 진입, shell 1회 표시, orb unread 1, orb 문구와 순서는 모두 정상이다. `delivery.delivered`만 기대값 `['shell','orb','os']` 대신 `['shell','orb']`였다.
   - 분류: **제품/환경 경계 미확정 후보**. 격리 Electron에서 OS 알림 전달이 빠졌으므로 실제 설치 앱의 Windows 알림 경로를 별도 확인해야 한다.

2. `regionContract: chat region never shrinks when the window narrows`
3. `regionContract: canvas region absorbs the shrink`
   - 관측: 1360px에서 canvas/chat은 650/400px, 1120px에서 둘 다 820/820px였다.
   - 분류: **하네스 규범 드리프트 가능성이 높음**. 같은 실행의 현재 Paper 50 반응형 검사에서는 900px 및 500px의 stack/compact 계약이 통과했다. 구형 “chat 고정 + canvas 축소” 단언과 현재 breakpoint stack 규범이 충돌한다.

4. `settingsSurface.modelPanelHasClaudeAccountRow`
   - 관측: 모델 카드와 model chips는 렌더됐지만 `.uk-model-account-row`는 0개였다.
   - 분류: **격리 환경 유발**. `verify.js` 주석은 실제 `~/.claude/.credentials.json` 감지를 전제로 하지만 이번 검사는 실제 사용자 profile 접근을 막기 위해 임시 `HOME`/`USERPROFILE`을 사용했다. 미연결 빈 상태 UI와 연결 계정 fixture를 분리해 검증해야 한다.

5. `boot fast readiness: ready snapshot keeps the 1.92s minimum path`
   - 관측: 총 2056.5ms, readiness wait 0.5ms로 외부 범위(1850~2200ms)는 충족했으나 expand 604.5ms가 내부 상한 580ms를 24.5ms 초과해 `timingMatches=false`가 됐다.
   - 분류: **timing 민감 하네스/부하 후보**. 장중 live latency 불량 증거는 아니다. 동시 실행 중인 live 앱과 검사 부하가 있는 환경에서 단일 샘플만 관측했다.

### 실행 계약 결함

- 그래프 프로브 첫 실행은 seed DB 생성 직후 Electron `STATUS_BREAKPOINT`(`-2147483645`)로 종료했다. assertion과 receipt 전에 끝났고 자체 backend 잔류 프로세스는 없었다. `verify-graph-mode.js`는 비동기 backend readiness 이후 `app.setPath('userData', ...)`를 호출한다. Electron 런처에 고유 `--user-data-dir`를 처음부터 주자 140/140 통과했다. 원본 로그 `isolated-graph-mode-20260907-101545-8936.log`는 crash 전 출력이 없어 2바이트다.
- `verify.js` 직접 Electron 실행은 cleanup watchdog이 요구하는 절대 Node 경로가 없어 load 단계에서 실패했다. 표준 `npm run verify`는 `npm_node_execpath`를 제공해 정상 실행됐다. 직접 실행 로그는 `fixture-verify-full-20260907-101818-8162.log`다.

## 비간섭 확인

검사 후 기존 live 프로세스는 모두 원래 시작 시각으로 존속했다.

- Electron `49728`: 09:48:39 시작, responding
- watcher Node `44124`: 09:48:39 시작, responding
- backend Python `32552` 및 child `25412`: 08:44:14 시작, responding

실제 사용자 저장소 메타데이터도 이전 baseline과 동일했다.

- `C:\Users\USER\.athena\brain.sqlite3`: 729088 bytes, mtime UTC `2026-09-03T19:00:52.6389675Z`
- `C:\Users\USER\.athena\backtest.sqlite3`: 15888384 bytes, mtime UTC `2026-09-03T13:19:51.7401435Z`
- `C:\Users\USER\.athena\routines`: mtime UTC `2026-09-03T18:01:05.0736346Z`
- `C:\Users\USER\.athena\projects`: mtime UTC `2026-09-04T02:44:21.0016552Z`

검사 소유 Electron 및 자체 graph backend 잔류 프로세스는 없었다. 격리용 임시 디렉터리 삭제 명령은 자동 실행 정책에 의해 거부되어 일부 task-owned temp profile이 남아 있다. 실제 사용자 경로와 live 프로세스에는 영향이 없다.

추가 확인과 한계: 과거 foreground PID는 래퍼에 보존되지 않았고, 위 잔류 확인은 source script/임시 backend command line 대조다. root는 10:30:24 KST에 같은 Electron 실행 파일의 전체 5개 프로세스가 현재 live app49728 트리에 속하고 트리 밖에 0개임을 별도 확인했다. 14개 잔여 디렉터리와 정책 거부 상세는 [CLEANUP-STATUS.md](CLEANUP-STATUS.md)에 보존했다.

## 해시

- Backtest log: `0BD3D55B569D6AAC2C6E54E199B509D8C3A82280574CB2BE8E57E401BE893A01`
- Backtest JSON: `7163E5A3EA869266A0F5EDF913D730A20C277A87E64ACC185BC92828DF744BF1`
- Agent log: `ED50E6A5554E9670C3DCF6F98543A44EC4B6C76D49D872C264F9E6687778E2CA`
- Agent JSON: `ECD2DAFC0C9792918C68A27ABD0CA4BFB6832D7FA7818E588A7DA4C503B54063`
- Session log: `BE787D9AD73147D9414686912C4DD30E276C22B9702AA479FD49B681CE53F68C`
- Graph pass log: `6F7DCC63C99222F5752D4CEEA7116962BBDEFA6E361F89C7F684DFE8F6C64D0E`
- Graph receipt: `365093068FA7D604E0D83FE4BC48B89E64084D0117DBA5142E760637A7A117C6`
- Full verify log: `B737A8C9707A41FE187E87890AED4008C1C4BCD756F5A3A90996D4799F9123CE`
- Full verify report: `410B82EC210E8A3A22CB09DBFC9E93FE1776ED5BDD66C0D632C04914E6967B86`
