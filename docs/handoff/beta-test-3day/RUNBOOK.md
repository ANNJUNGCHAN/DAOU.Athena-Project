# Claude Code continuation runbook

## 1. Preflight

항상 먼저 다음을 실행한다.

```powershell
Set-Location -LiteralPath 'C:\Projects\DAOU.Athena'
& '.\scripts\beta\preflight.ps1'
```

> 경로 이전(2026-09-01): `.ps1`은 `scripts/beta/`, 문서·원장은 `docs/handoff/beta-test-3day/`로
> 옮겼다. 아래 본문의 `artifacts\beta-test-3day\` 는 **증거 기록 경로**로는 그대로 유효하다
> (캡처와 runtime 로그는 계속 거기 쌓는다 — gitignore 대상이라 커밋되지 않는다).
> 반면 `PROTOCOL.md`·`ISSUES.md`·`manifest.json`·`sessions/`를 **읽고 갱신할 때**는
> `docs/handoff/beta-test-3day/` 쪽이 git에 남는 정본이다. 자세한 대응표는 [README.md](./README.md).

확인할 항목:

- 현재 KST
- Git HEAD/branch/dirty entry count
- Athena Electron 프로세스와 창
- `athena_api.main:app` command line을 가진 backend 프로세스
- TCP 8010 listener
- Orca 실행 가능 여부와 현재 앱 목록
- 원본 manifest 카운트
- 기존 14개 screenshot의 크기/SHA-256 일치 여부

인계 시점 PID 40044, 18644, 53300과 창 ID 159058250는 과거 증거다. 현재 프로세스로 가정하지 않는다.

## 2. 런타임 복구

### Backend

8010 listener와 기존 Athena backend command line이 없을 때만 시작한다.

```powershell
$athenaRepo = 'C:\Projects\DAOU.Athena'
$athenaPython = Join-Path $athenaRepo 'backend\.venv\Scripts\python.exe'
$athenaRuntime = Join-Path $athenaRepo 'artifacts\beta-test-3day\runtime'
$athenaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$athenaBackend = Start-Process `
  -FilePath $athenaPython `
  -ArgumentList '-m','uvicorn','athena_api.main:app','--host','127.0.0.1','--port','8010','--workers','1' `
  -WorkingDirectory (Join-Path $athenaRepo 'backend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $athenaRuntime "claude-backend-$athenaStamp-stdout.log") `
  -RedirectStandardError (Join-Path $athenaRuntime "claude-backend-$athenaStamp-stderr.log") `
  -PassThru

$athenaBackend.Id
```

백엔드는 이전 세션에서 준비까지 약 47초가 걸렸다. 최소 120초 범위에서 실제 endpoint를 확인한다. 느리다는 이유만으로 12초에 종료하지 않는다.

```powershell
$athenaReady = $false
for ($athenaAttempt = 1; $athenaAttempt -le 60; $athenaAttempt++) {
  try {
    $athenaResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8010/api/v1/llm/manifest' -TimeoutSec 3
    if ($athenaResponse.StatusCode -eq 200) {
      $athenaReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $athenaReady) {
  throw 'Athena backend did not become ready within 120 seconds.'
}
```

### Athena Electron

현재 Athena 창이 없을 때만 실행한다.

```powershell
$athenaRepo = 'C:\Projects\DAOU.Athena'
$athenaRuntime = Join-Path $athenaRepo 'artifacts\beta-test-3day\runtime'
$athenaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$athenaNpm = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList 'start' `
  -WorkingDirectory (Join-Path $athenaRepo 'app') `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $athenaRuntime "claude-athena-$athenaStamp-stdout.log") `
  -RedirectStandardError (Join-Path $athenaRuntime "claude-athena-$athenaStamp-stderr.log") `
  -PassThru

$athenaNpm.Id
```

기존 프로세스를 종료해야 할 때는 command line과 정확한 PID가 Athena 소유인지 먼저 검증한다. 광범위한 `taskkill /IM electron.exe`는 사용하지 않는다.

## 3. Orca computer-use

```powershell
$athenaOrca = 'C:\Users\ajc22\AppData\Local\Programs\orca\resources\bin\orca.exe'

& $athenaOrca computer permissions --json
& $athenaOrca computer capabilities --json
& $athenaOrca computer list-apps --json
& $athenaOrca computer list-windows --app electron --json
& $athenaOrca computer get-app-state --app electron --json
```

과거에는 `--app Athena`가 Code 창을 잘못 선택했다. 앱 이름 `electron`, 창 제목 `Athena`, 현재 PID를 함께 확인한다.

상호작용 예시:

```powershell
& $athenaOrca computer click --app electron --element-index <fresh-index> --json
& $athenaOrca computer set-value --app electron --element-index <fresh-index> --value '<question>' --json
& $athenaOrca computer press-key --app electron --key Return --json
```

각 동작 전에 `get-app-state`를 다시 실행해 index를 새로 얻는다. 질문 입력 후 Value가 실제 접근성 트리에 반영됐는지 확인하고 제출한다.

## 4. 세션 질문과 기능 회전

한 세션에는 최소 다음이 포함된다.

- 현재 투자 슬리브에 맞는 자연어 질문 1개
- 후속 질문 또는 기능 전환 1개
- 채팅, 그래프, 알림/루틴 초안, 플러그인 미리보기 중 회전 대상 1개
- 화면 캡처 1개 이상
- data provenance 분류
- broker mutation 0 확인

질문은 다음 축을 순환한다.

- 1,000만원 단기 슬리브: 삼성전자, SK하이닉스, KODEX 200, 한 시간 변화, 과매매 방지
- 국장 중기: 대형주/ETF의 투자 논리, 수급, 변동성, 비중 조정
- 미장 장기: S&P 500, 나스닥 100, 배당 ETF, 적립식과 리밸런싱
- 전술적 축소: 투자 논리 훼손 조건, 비중 축소 기준, 재진입 조건

추천이나 주문으로 몰지 말고 관찰 기준, 위험, 데이터 기준 시점, 대안을 묻는다.

## 5. 화면 증거와 기록

Orca screenshot의 임시 경로를 다음 규칙으로 복사한다.

`artifacts\beta-test-3day\captures\YYYY-MM-DD\NN-short-description.png`

```powershell
Copy-Item -LiteralPath '<orca-temp-screenshot>' -Destination '<fixed-evidence-path>'
Get-FileHash -Algorithm SHA256 -LiteralPath '<fixed-evidence-path>'
```

그 뒤 다음을 갱신한다.

1. `captures\YYYY-MM-DD\manifest.csv`
2. `sessions\YYYY-MM-DD.md`
3. `ISSUES.md` — 새 결함 또는 기존 결함 재현 횟수
4. `manifest.json` — 증거로 확인된 카운트만

세션 기록에는 [SESSION_TEMPLATE.md](./SESSION_TEMPLATE.md)의 모든 필드를 사용한다. 성공 응답만 기록하지 말고 로딩, 오류, 빈 상태, 탐색 실패도 보존한다.

## 6. 검증과 종료

- screenshot manifest의 파일 크기와 SHA-256을 다시 계산한다.
- `manifest.json`을 JSON parser로 읽는다.
- 일자별 로그의 세션 수와 manifest 카운트를 대조한다.
- 주문/계정/플러그인/알림 mutation이 0인지 확인한다.
- `PROTOCOL.md` 전체 완료 게이트를 항목별로 감사한다.

게이트가 하나라도 미달이면 최종 완료 보고서를 만들지 않는다. 진행 상황과 coverage gap만 기록한다.
