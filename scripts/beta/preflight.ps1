[CmdletBinding()]
param()

$handoffFolder = $PSScriptRoot
$handoffRepo = (Resolve-Path -LiteralPath (Join-Path $handoffFolder '..\..')).Path
$handoffEvidence = Join-Path $handoffRepo 'artifacts\beta-test-3day'
$handoffManifestPath = Join-Path $handoffEvidence 'manifest.json'
$handoffCaptureManifestPath = Join-Path $handoffEvidence 'captures\2026-08-31\manifest.csv'
$handoffOrca = 'C:\Users\ajc22\AppData\Local\Programs\orca\resources\bin\orca.exe'
$handoffClaude = 'C:\Users\ajc22\.local\bin\claude.exe'

Push-Location -LiteralPath $handoffRepo
try {
  $handoffGitHead = (git rev-parse HEAD).Trim()
  $handoffGitBranch = (git branch --show-current).Trim()
  $handoffGitChanges = @(git status --porcelain=v1)
} finally {
  Pop-Location
}

$handoffManifest = Get-Content -Raw -LiteralPath $handoffManifestPath | ConvertFrom-Json
$handoffElectron = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'electron.exe' -and $_.CommandLine -match 'DAOU\.Athena'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
$handoffBackend = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^python' -and $_.CommandLine -match 'athena_api\.main:app'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
$handoffListener = @(Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess, State)

$handoffCaptureRows = @(Import-Csv -LiteralPath $handoffCaptureManifestPath)
$handoffCaptureChecks = foreach ($handoffRow in $handoffCaptureRows) {
  $handoffCapturePath = Join-Path (Split-Path -Parent $handoffCaptureManifestPath) $handoffRow.filename
  $handoffExists = Test-Path -LiteralPath $handoffCapturePath
  $handoffActualBytes = if ($handoffExists) { (Get-Item -LiteralPath $handoffCapturePath).Length } else { $null }
  $handoffActualHash = if ($handoffExists) { (Get-FileHash -Algorithm SHA256 -LiteralPath $handoffCapturePath).Hash } else { $null }
  [pscustomobject]@{
    filename = $handoffRow.filename
    exists = $handoffExists
    sizeMatches = $handoffExists -and ([int64]$handoffRow.bytes -eq $handoffActualBytes)
    hashMatches = $handoffExists -and ($handoffRow.sha256 -eq $handoffActualHash)
  }
}

$handoffOrcaApps = $null
$handoffOrcaError = $null
if (Test-Path -LiteralPath $handoffOrca) {
  try {
    $handoffOrcaApps = (& $handoffOrca computer list-apps --json | ConvertFrom-Json)
  } catch {
    $handoffOrcaError = $_.Exception.Message
  }
}

$handoffResult = [pscustomobject]@{
  verifiedAtKst = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
  repository = [pscustomobject]@{
    path = $handoffRepo
    branch = $handoffGitBranch
    head = $handoffGitHead
    dirtyEntryCount = $handoffGitChanges.Count
  }
  runtime = [pscustomobject]@{
    athenaElectron = $handoffElectron
    athenaBackend = $handoffBackend
    port8010 = $handoffListener
  }
  tools = [pscustomobject]@{
    orcaExists = Test-Path -LiteralPath $handoffOrca
    orcaApps = $handoffOrcaApps
    orcaError = $handoffOrcaError
    claudeExists = Test-Path -LiteralPath $handoffClaude
  }
  evidence = [pscustomobject]@{
    manifestStatus = $handoffManifest.status
    startedAtKst = $handoffManifest.startedAtKst
    earliestCompletionAtKst = $handoffManifest.earliestCompletionAtKst
    currentCounts = $handoffManifest.currentEvidence
    captureRows = $handoffCaptureRows.Count
    captureFailures = @($handoffCaptureChecks | Where-Object { -not $_.exists -or -not $_.sizeMatches -or -not $_.hashMatches })
  }
  warnings = @(
    'HANDOFF_STATE.json is a snapshot; current runtime and canonical beta artifacts win.',
    'Historical PID/window IDs are not reusable.',
    'Codex automation is not portable to Claude Code.',
    'Do not modify Athena source, orders, accounts, plugin installs, saved permissions, or live alerts.'
  )
}

$handoffResult | ConvertTo-Json -Depth 12
