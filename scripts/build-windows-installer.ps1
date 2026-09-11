#Requires -Version 7.0

[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$Version = '0.1.0-beta.1',
  [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-Native {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string[]]$ArgumentList,
    [Parameter(Mandatory)] [string]$WorkingDirectory
  )
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string[]]$ArgumentList,
    [Parameter(Mandatory)] [string]$WorkingDirectory
  )
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $lines = @(& $FilePath @ArgumentList)
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
    return $lines
  } finally {
    Pop-Location
  }
}

function Copy-TrackedFile {
  param(
    [Parameter(Mandatory)] [string]$RelativePath,
    [Parameter(Mandatory)] [string]$DestinationRoot
  )
  $source = Join-Path $script:RepoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Tracked source is missing: $RelativePath"
  }
  $destination = Join-Path $DestinationRoot $RelativePath
  $parent = Split-Path -Parent $destination
  [void](New-Item -ItemType Directory -Path $parent -Force)
  Copy-Item -LiteralPath $source -Destination $destination
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AppSource = Join-Path $RepoRoot 'app'
$BackendSource = Join-Path $RepoRoot 'backend'
$ConfigPath = Join-Path $PSScriptRoot 'windows-installer.config.cjs'

foreach ($command in @('git', 'node', 'npm', 'npx', 'uv')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required command is unavailable: $command"
  }
}

& git -C $RepoRoot diff --quiet --ignore-submodules --
$gitDiffExit = $LASTEXITCODE
if ($gitDiffExit -eq 1) {
  throw 'Tracked files have local changes. Commit them before creating a release installer.'
}
if ($gitDiffExit -ne 0) {
  throw "git diff failed with exit code $gitDiffExit"
}
& git -C $RepoRoot diff --cached --quiet --ignore-submodules --
$gitCachedDiffExit = $LASTEXITCODE
if ($gitCachedDiffExit -eq 1) {
  throw 'The index has staged changes. Commit them before creating a release installer.'
}
if ($gitCachedDiffExit -ne 0) {
  throw "git diff --cached failed with exit code $gitCachedDiffExit"
}

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $RepoRoot '.omc/artifacts/windows-installer'
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot, $RepoRoot)
$BuildRoot = Join-Path $OutputRoot $Version
if (Test-Path -LiteralPath $BuildRoot) {
  throw "Build output already exists and will not be deleted: $BuildRoot"
}

$StageRoot = Join-Path $BuildRoot 'stage'
$StageApp = Join-Path $StageRoot 'app'
$StageBackend = Join-Path $StageRoot 'backend'
$RuntimeRoot = Join-Path $StageBackend '.venv/Scripts'
$DependencyDir = Join-Path $BuildRoot 'dependencies'
$DistDir = Join-Path $BuildRoot 'dist'
[void](New-Item -ItemType Directory -Path $StageApp, $StageBackend, $RuntimeRoot, $DependencyDir, $DistDir)

$tracked = @(Invoke-NativeCapture git @('-C', $RepoRoot, 'ls-files', '--', 'app', 'backend') $RepoRoot)
$runtimeRootFiles = @(
  'app/main.js',
  'app/preload.js',
  'app/shell.html',
  'app/shell.js',
  'app/shell.css',
  'app/canvas.js',
  'app/canvas.css',
  'app/chat.js',
  'app/chat.css',
  'app/orb.html',
  'app/orb.js',
  'app/orb.css',
  'app/provider-first-paint.js',
  'app/package.json',
  'app/package-lock.json'
)
$appFiles = @($tracked | Where-Object {
  $_ -in $runtimeRootFiles -or
  ($_ -match '^app/(lib|data|styles)/' -and $_ -notmatch '(?:^|/)(?:__pycache__|node_modules)/' -and $_ -notmatch '\.test\.js$') -or
  $_ -eq 'app/test-fixtures/provider-contract/decision.json'
})
$backendFiles = @($tracked | Where-Object {
  $_ -in @('backend/pyproject.toml', 'backend/uv.lock') -or
  ($_ -match '^backend/(athena_api|athena_mcp|ref)/' -and $_ -notmatch '(?:^|/)(?:__pycache__|tests?)/' -and $_ -notmatch '\.(?:pyc|pyo)$')
})

foreach ($required in $runtimeRootFiles + @('app/test-fixtures/provider-contract/decision.json', 'backend/pyproject.toml', 'backend/uv.lock')) {
  if ($required -notin $tracked) {
    throw "Required release source is not tracked: $required"
  }
}
foreach ($file in $appFiles + $backendFiles) {
  Copy-TrackedFile $file $StageRoot
}

Invoke-Native npm @('ci', '--omit=dev', '--ignore-scripts') $StageApp

$pythonPath = @(Invoke-NativeCapture uv @('python', 'find', '--managed-python', '3.12.11') $RepoRoot)[-1].Trim()
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
  throw "uv did not return a usable Python executable: $pythonPath"
}
$pythonVersion = (@(Invoke-NativeCapture $pythonPath @('--version') $RepoRoot) -join ' ').Trim()
if ($pythonVersion -ne 'Python 3.12.11') {
  throw "Expected Python 3.12.11, found $pythonVersion"
}
$pythonSourceRoot = Split-Path -Parent $pythonPath
foreach ($entry in Get-ChildItem -LiteralPath $pythonSourceRoot -Force) {
  Copy-Item -LiteralPath $entry.FullName -Destination $RuntimeRoot -Recurse
}
foreach ($requiredRuntimeFile in @('python.exe', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot $requiredRuntimeFile) -PathType Leaf)) {
    throw "Bundled Python runtime is missing $requiredRuntimeFile"
  }
}
foreach ($requiredRuntimeDirectory in @('Lib', 'DLLs')) {
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot $requiredRuntimeDirectory) -PathType Container)) {
    throw "Bundled Python runtime is missing $requiredRuntimeDirectory"
  }
}

$RequirementsPath = Join-Path $DependencyDir 'backend-requirements.txt'
Invoke-Native uv @('export', '--frozen', '--no-dev', '--no-emit-project', '--output-file', $RequirementsPath) $BackendSource
[void](New-Item -ItemType Directory -Path (Join-Path $RuntimeRoot 'Lib/site-packages') -Force)
Invoke-Native uv @(
  'pip', 'install',
  '--target', (Join-Path $RuntimeRoot 'Lib/site-packages'),
  '--python', (Join-Path $RuntimeRoot 'python.exe'),
  '--requirement', $RequirementsPath
) $BackendSource

Copy-Item -LiteralPath (Join-Path $AppSource 'package-lock.json') -Destination (Join-Path $DependencyDir 'app-package-lock.json')
Copy-Item -LiteralPath (Join-Path $BackendSource 'uv.lock') -Destination (Join-Path $DependencyDir 'backend-uv.lock')

$electronDist = ''
$localElectronPackage = Join-Path $AppSource 'node_modules/electron/package.json'
$localElectronDist = Join-Path $AppSource 'node_modules/electron/dist'
if ((Test-Path -LiteralPath $localElectronPackage -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $localElectronDist 'electron.exe') -PathType Leaf)) {
  $localElectronVersion = (Get-Content -LiteralPath $localElectronPackage -Raw | ConvertFrom-Json).version
  if ($localElectronVersion -eq '43.4.0') {
    $electronDist = $localElectronDist
  }
}

$env:ATHENA_INSTALLER_VERSION = $Version
$env:ATHENA_INSTALLER_PROJECT_DIR = $StageApp
$env:ATHENA_INSTALLER_BACKEND_DIR = $StageBackend
$env:ATHENA_INSTALLER_OUTPUT_DIR = $DistDir
$env:ATHENA_ELECTRON_DIST = $electronDist
Invoke-Native npx @(
  '--yes',
  '--package', 'electron-builder@26.15.3',
  'electron-builder',
  '--config', $ConfigPath,
  '--win', 'nsis',
  '--x64',
  '--publish', 'never'
) $RepoRoot

$ArtifactPath = Join-Path $DistDir "Athena-Setup-$Version-x64.exe"
if (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
  throw "electron-builder did not create the expected installer: $ArtifactPath"
}

$buildInfo = [ordered]@{
  productName = 'Athena'
  version = $Version
  commit = (@(Invoke-NativeCapture git @('-C', $RepoRoot, 'rev-parse', 'HEAD') $RepoRoot) -join '').Trim()
  builtAtUtc = [DateTime]::UtcNow.ToString('o')
  target = [ordered]@{ platform = 'windows'; arch = 'x64'; installer = 'nsis-per-user-assisted'; signed = $false }
  runtimes = [ordered]@{
    electron = '43.4.0'
    python = '3.12.11'
    node = (@(Invoke-NativeCapture node @('--version') $RepoRoot) -join '').Trim()
    npm = (@(Invoke-NativeCapture npm @('--version') $RepoRoot) -join '').Trim()
    uv = (@(Invoke-NativeCapture uv @('--version') $RepoRoot) -join '').Trim()
  }
  buildDependencies = [ordered]@{
    electronBuilder = '26.15.3'
    appPackageLock = 'dependencies/app-package-lock.json'
    backendUvLock = 'dependencies/backend-uv.lock'
    backendRequirements = 'dependencies/backend-requirements.txt'
  }
  stagedSourceCounts = [ordered]@{ app = $appFiles.Count; backend = $backendFiles.Count }
  artifact = "dist/Athena-Setup-$Version-x64.exe"
}
$BuildInfoPath = Join-Path $BuildRoot 'build-info.json'
$buildInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $BuildInfoPath -Encoding utf8

$sumFiles = @($ArtifactPath, $BuildInfoPath, (Join-Path $DependencyDir 'backend-requirements.txt'))
$sumLines = foreach ($file in $sumFiles) {
  $relative = [IO.Path]::GetRelativePath($BuildRoot, $file).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
$sumLines | Set-Content -LiteralPath (Join-Path $BuildRoot 'SHA256SUMS') -Encoding ascii

Write-Host "Installer: $ArtifactPath"
Write-Host "Build info: $BuildInfoPath"
Write-Host "Checksums: $(Join-Path $BuildRoot 'SHA256SUMS')"
