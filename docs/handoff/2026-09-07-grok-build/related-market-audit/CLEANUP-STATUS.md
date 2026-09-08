# 검사 임시 파일 정리 상태

격리 mode/session 검사 후 임시 디렉터리 14개를 정리하는 PowerShell 명령이 자동 실행 검토에서 거부됐다. 반환 이유는 `blocked by policy`이며 더 구체적인 사유는 제공되지 않았다. 명령은 Temp/app root 내부의 정확한 대상 경로를 검증한 뒤 `Remove-Item -LiteralPath ... -Recurse -Force`를 사용하는 구조였다. 도구 반환의 중간 명령 문자열은 잘려 있어 전체 원문은 보존되지 않았다.

다른 삭제 도구로 우회하지 않고 아래 검사 전용 폴더를 남겨두었다. 10:14:27~10:19:55 KST의 해당 실행 시각 및 mkdtemp/fixture 이름과 일치하고, 조회 당시 모두 일반 Directory이며 reparse point가 아니었다. 실제 사용자 DB·profile을 삭제 대상으로 삼지 않았다.

| 잔여 경로 | 생성 근거 |
|---|---|
| `C:\Users\USER\AppData\Local\Temp\athena-fixture-backtest-20260907-101427-1178` | 이번 backtest 실행의 고유 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-fixture-agent-20260907-101446-5313` | 이번 agent 실행의 고유 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-fixture-session-20260907-101506-9521` | 이번 session 실행의 고유 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-session-probe-WrvUvV` | session probe mkdtemp |
| `C:\Users\USER\AppData\Local\Temp\athena-project-empty-ZCmhy9` | session probe fixture project |
| `C:\Users\USER\AppData\Local\Temp\athena-project-filled-PeMEoS` | session probe fixture project |
| `C:\Users\USER\AppData\Local\Temp\athena-isolated-graph-20260907-101545-8936` | 첫 graph 실행 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-verify-graph-IV5OZP` | 첫 graph 실행 mkdtemp |
| `C:\Users\USER\AppData\Local\Temp\athena-isolated-graph-20260907-101654-4593` | graph 재실행 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-verify-graph-bNwNvz` | graph 재실행 mkdtemp |
| `C:\Users\USER\AppData\Local\Temp\athena-fixture-verify-20260907-101818-8162` | direct verify 실행 stamp |
| `C:\Users\USER\AppData\Local\Temp\athena-verify-DzVywj` | direct verify fresh profile |
| `C:\Users\USER\AppData\Local\Temp\athena-fixture-verify-20260907-101939-3151` | 표준 npm verify 실행 stamp |
| `C:\Projects\DAOU.Athena\app\.probe-agent-paper-parity-profile` | 이번 parity probe의 전용 고정 profile |

검사 실행 래퍼가 과거 foreground PID를 보존하지 않은 제한은 남는다. 검사자는 probe/임시 graph backend command line 일치 프로세스 0개를 확인했다. root는 10:30:24.418 KST에 추가로 정확한 `app/node_modules/electron/dist/electron.exe` 경로의 모든 프로세스를 대조했다. 5개가 모두 현재 live app 49728의 트리 안에 있고 트리 밖 Electron은 0개였다. 이는 현재 해당 Electron 실행 파일의 잔류가 없다는 증거이며, 보존하지 않은 과거 전체 자식 트리의 종료 과정을 재구성한 증거는 아니다.

현재 live app 49728, watcher 44124, backend 32552→25412는 유지한다. 임시 폴더 잔류 때문에 기능 검사 결과를 변경하지 않았으며, 정리 완료라고 보고하지 않는다.
