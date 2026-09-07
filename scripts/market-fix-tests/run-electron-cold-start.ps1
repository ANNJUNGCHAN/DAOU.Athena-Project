[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ElectronExe,
    [Parameter(Mandatory = $true)]
    [string]$PythonExe
)

$ErrorActionPreference = 'Stop'
$electron = (Resolve-Path -LiteralPath $ElectronExe).Path
$python = (Resolve-Path -LiteralPath $PythonExe).Path
$scriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..')).Path
$runner = Join-Path $scriptRoot 'electron-cold-start.cjs'
$sourceHead = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'source HEAD is unavailable' }

$runRoot = Join-Path ([IO.Path]::GetTempPath()) ('athena-boot-integration-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $runRoot)
$wrapperReceipt = Join-Path $runRoot 'wrapper-receipt.jsonl'
$resultPath = Join-Path $runRoot 'result.json'
foreach ($directory in @('home', 'appdata', 'localappdata', 'temp')) {
    [void](New-Item -ItemType Directory -Path (Join-Path $runRoot $directory))
}

function Write-WrapperReceipt([string]$Stage, [hashtable]$Fields = @{}) {
    $record = [ordered]@{ stage = $Stage; observed_at = [DateTimeOffset]::Now.ToString('o') }
    foreach ($entry in $Fields.GetEnumerator()) { $record[$entry.Key] = $entry.Value }
    Add-Content -LiteralPath $wrapperReceipt -Value ($record | ConvertTo-Json -Compress) -Encoding utf8
}

function Get-TextSha256([string]$Text) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return [Convert]::ToHexString($algorithm.ComputeHash($bytes)).ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
    }
}

function Get-KnownChildPid {
    $runnerReceipt = Join-Path $runRoot 'receipt.jsonl'
    if (-not (Test-Path -LiteralPath $runnerReceipt)) { return $null }
    $known = $null
    foreach ($line in Get-Content -LiteralPath $runnerReceipt -Encoding utf8) {
        try {
            $record = $line | ConvertFrom-Json
            if ($record.stage -eq 'child_spawned' -and [string]$record.child_pid -match '^\d+$') {
                $known = [int]$record.child_pid
            }
        } catch { }
    }
    return $known
}

function Test-PidAbsent($ProcessId) {
    if ($null -eq $ProcessId) { return $false }
    return $null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

Write-WrapperReceipt 'wrapper_start' @{ source_head = $sourceHead }
$reviewedFiles = @(
    'app/lib/main/backend-launcher.js',
    'backend/athena_api/selector/instrument_identity.py',
    'scripts/market-fix-tests/backend_fixture.py',
    'scripts/market-fix-tests/cold-start-fixture.cjs',
    'scripts/market-fix-tests/cold-start-fixture.test.cjs',
    'scripts/market-fix-tests/electron-cold-start.cjs',
    'scripts/market-fix-tests/run-electron-cold-start.ps1'
)
$reviewedDirty = @(& git -C $repoRoot status --porcelain -- $reviewedFiles)
if ($LASTEXITCODE -ne 0 -or $reviewedDirty.Count -ne 0) {
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'REVIEWED_FILES_DIRTY' }
    [Console]::Error.WriteLine("BOOT fixture reviewed files do not match HEAD; profile preserved at $runRoot")
    exit 1
}
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $electron
$startInfo.WorkingDirectory = $runRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment.Clear()
foreach ($name in @(
    'COMSPEC', 'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
    'PROCESSOR_REVISION', 'SYSTEMROOT', 'WINDIR'
)) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $value) { $startInfo.Environment[$name] = $value }
}
$startInfo.Environment['HOME'] = Join-Path $runRoot 'home'
$startInfo.Environment['USERPROFILE'] = Join-Path $runRoot 'home'
$startInfo.Environment['APPDATA'] = Join-Path $runRoot 'appdata'
$startInfo.Environment['LOCALAPPDATA'] = Join-Path $runRoot 'localappdata'
$startInfo.Environment['TEMP'] = Join-Path $runRoot 'temp'
$startInfo.Environment['TMP'] = Join-Path $runRoot 'temp'
foreach ($argument in @($runner, '--execute', '--python', $python, '--private-root', $runRoot, '--source-head', $sourceHead)) {
    [void]$startInfo.ArgumentList.Add($argument)
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) { throw 'Electron bootstrap did not start' }
Write-WrapperReceipt 'bootstrap_started' @{ bootstrap_pid = $process.Id }
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$deadline = [DateTimeOffset]::Now.AddSeconds(100)
while (-not (Test-Path -LiteralPath $resultPath) -and -not $process.HasExited -and [DateTimeOffset]::Now -lt $deadline) {
    Start-Sleep -Milliseconds 200
}

if (-not (Test-Path -LiteralPath $resultPath) -and -not $process.HasExited) {
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'BOOTSTRAP_TIMEOUT'; bootstrap_pid = $process.Id }
    try { $process.Kill($true) } catch { }
    $bootstrapExited = $process.WaitForExit(5000)
    $knownChildPid = Get-KnownChildPid
    Write-WrapperReceipt 'timeout_cleanup' @{
        bootstrap_pid = $process.Id
        bootstrap_process_exited_after_tree_kill = $bootstrapExited
        known_child_pid = $knownChildPid
        known_child_pid_absent_after_kill = Test-PidAbsent $knownChildPid
        descendant_exit_independently_verified = $false
        residual_pid = $(if (-not $bootstrapExited) { $process.Id } elseif (-not (Test-PidAbsent $knownChildPid)) { $knownChildPid } else { $null })
    }
    [Console]::Error.WriteLine("BOOT fixture timeout; profile preserved at $runRoot")
    exit 1
}

if (-not (Test-Path -LiteralPath $resultPath) -and $process.HasExited) {
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    Write-WrapperReceipt 'bootstrap_exit' @{
        bootstrap_exit_code = $process.ExitCode
        stdout_bytes = [Text.Encoding]::UTF8.GetByteCount($stdout)
        stderr_bytes = [Text.Encoding]::UTF8.GetByteCount($stderr)
        stdout_sha256 = Get-TextSha256 $stdout
        stderr_sha256 = Get-TextSha256 $stderr
    }
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'NO_RESULT_AFTER_EXIT'; bootstrap_pid = $process.Id }
    [Console]::Error.WriteLine("BOOT fixture exited without a result; profile preserved at $runRoot")
    exit 1
}

if (-not $process.HasExited -and -not $process.WaitForExit(5000)) {
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'RESULT_WITH_LIVE_BOOTSTRAP'; bootstrap_pid = $process.Id }
    try { $process.Kill($true) } catch { }
    $bootstrapExited = $process.WaitForExit(5000)
    $knownChildPid = Get-KnownChildPid
    Write-WrapperReceipt 'result_cleanup' @{
        bootstrap_pid = $process.Id
        bootstrap_process_exited_after_tree_kill = $bootstrapExited
        known_child_pid = $knownChildPid
        known_child_pid_absent_after_kill = Test-PidAbsent $knownChildPid
        descendant_exit_independently_verified = $false
        residual_pid = $(if (-not $bootstrapExited) { $process.Id } elseif (-not (Test-PidAbsent $knownChildPid)) { $knownChildPid } else { $null })
    }
    [Console]::Error.WriteLine("BOOT fixture left a live bootstrap; profile preserved at $runRoot")
    exit 1
}

$stdout = $stdoutTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()
Write-WrapperReceipt 'bootstrap_exit' @{
    bootstrap_exit_code = $process.ExitCode
    stdout_bytes = [Text.Encoding]::UTF8.GetByteCount($stdout)
    stderr_bytes = [Text.Encoding]::UTF8.GetByteCount($stderr)
    stdout_sha256 = Get-TextSha256 $stdout
    stderr_sha256 = Get-TextSha256 $stderr
}

$knownChildPid = Get-KnownChildPid
$knownChildAbsent = Test-PidAbsent $knownChildPid
try {
    $resultText = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8
    $result = $resultText | ConvertFrom-Json
} catch {
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'RESULT_PARSE_FAILED' }
    [Console]::Error.WriteLine("BOOT fixture result parse failed; profile preserved at $runRoot")
    exit 1
}
Write-WrapperReceipt 'wrapper_result' @{ kind = $result.kind; outcome = $result.outcome }
$health = @($result.scenarios.delayed_existing.health_results)
$finalHead = (& git -C $repoRoot rev-parse HEAD).Trim()
$finalDirty = @(& git -C $repoRoot status --porcelain -- $reviewedFiles)
$valid = $result.kind -eq 'athena_boot_component_integration' `
    -and $result.outcome -eq 'PASS' `
    -and $result.source_head -eq $sourceHead -and $finalHead -eq $sourceHead `
    -and $LASTEXITCODE -eq 0 -and $finalDirty.Count -eq 0 `
    -and $result.scenarios.cold.outcome -eq 'PASS_SYNTHETIC_COMPONENT_COLD_START' `
    -and $result.scenarios.cold.synthetic_identity_count -eq 3525 `
    -and $result.scenarios.cold.account_count -eq 0 `
    -and $result.scenarios.cold.spawn_count -eq 1 `
    -and $result.scenarios.cold.alive_after_60s -eq $true `
    -and $result.scenarios.delayed_existing.outcome -eq 'PASS_OWNED_DELAYED_EXISTING_SERVER' `
    -and $result.scenarios.delayed_existing.spawn_count -eq 0 `
    -and $result.scenarios.delayed_existing.request_count -eq 2 `
    -and $health.Count -eq 2 -and $health[0] -eq $false -and $health[1] -eq $true `
    -and $result.isolation.product_port_8010_touched -eq $false `
    -and $null -ne $knownChildPid -and $knownChildAbsent
if (-not $valid) {
    Write-WrapperReceipt 'wrapper_error' @{ reason = 'RESULT_CONTRACT_FAILED' }
    exit 1
}
[Console]::Out.WriteLine($resultText.Trim())
exit 0
