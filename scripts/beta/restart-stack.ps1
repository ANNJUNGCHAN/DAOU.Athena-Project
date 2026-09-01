# Athena 스택 재기동 — backend(8010, 없을 때만) + Electron(항상 재시작, detached).
# 사용: powershell -File restart-stack.ps1 [-KillPid <electron root pid>]
param([int]$KillPid = 0)
$ErrorActionPreference = 'Continue'

$repo = 'C:\Projects\DAOU.Athena'
$rt = Join-Path $repo 'artifacts\beta-test-3day\runtime'
$py = Join-Path $repo 'backend\.venv\Scripts\python.exe'

function Test-Backend {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8010/api/v1/llm/manifest' -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch { return $false }
}

if (-not (Test-Backend)) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $so = Join-Path $rt "claude-backend-$stamp-stdout.log"
  $se = Join-Path $rt "claude-backend-$stamp-stderr.log"
  $cmd = 'cmd.exe /c ""' + $py + '" -m uvicorn athena_api.main:app --host 127.0.0.1 --port 8010 --workers 1 > "' + $so + '" 2> "' + $se + '""'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = (Join-Path $repo 'backend') } | Out-Null
  $ready = $false
  for ($i = 1; $i -le 60; $i++) {
    if (Test-Backend) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  Write-Output "BACKEND_READY=$ready"
} else {
  Write-Output 'BACKEND_READY=already'
}

if ($KillPid -gt 0) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$KillPid" -ErrorAction SilentlyContinue
  if ($p -and $p.CommandLine -like '*DAOU.Athena\app*') {
    Stop-Process -Id $KillPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 4
  } else {
    Write-Output "SKIP_KILL=$KillPid (not Athena)"
  }
}

$stamp2 = Get-Date -Format 'yyyyMMdd-HHmmss'
$so2 = Join-Path $rt "claude-athena-$stamp2-stdout.log"
$se2 = Join-Path $rt "claude-athena-$stamp2-stderr.log"
# 대화 기록 DB — 스토어(chat-history-store.js)가 스키마를 스스로 만든다.
# brain.sqlite3(백엔드 소유)와 파일을 분리해 다른 writer와 충돌하지 않는다.
$chatDb = Join-Path $env:APPDATA 'athena-shell\chat-history.sqlite3'
$cmd2 = 'cmd.exe /c "cd /d "' + (Join-Path $repo 'app') + '" && set ELECTRON_ENABLE_LOGGING=1&& set ATHENA_CHAT_HISTORY_DB_PATH=' + $chatDb + '&& npm.cmd start > "' + $so2 + '" 2> "' + $se2 + '""'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd2; CurrentDirectory = (Join-Path $repo 'app') } | Out-Null
Start-Sleep -Seconds 32

Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*DAOU.Athena\app\node_modules\electron\dist\electron.exe .' } |
  ForEach-Object { Write-Output "ATHENA_PID=$($_.ProcessId)" }
