# 등록된 MCP 서버를 probe해 노출 도구를 전부 allow한다.
# UI의 "도구 허용"과 같은 backend CLI(athena_mcp)를 부른다 — 별도 경로를 만들지 않는다.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$backend = 'C:\Projects\DAOU.Athena\backend'
$py = Join-Path $backend '.venv\Scripts\python.exe'
$registry = Join-Path $env:USERPROFILE '.athena\mcp_servers.json'

$reg = Get-Content -Raw -LiteralPath $registry -Encoding UTF8 | ConvertFrom-Json
$aliases = $reg.servers.PSObject.Properties.Name

foreach ($alias in $aliases) {
  $raw = & $py -m athena_mcp probe $alias --json 2>&1 | Out-String
  $start = $raw.IndexOf('{')
  if ($start -lt 0) { Write-Output "$alias -> PROBE_NO_JSON"; continue }

  try { $report = $raw.Substring($start) | ConvertFrom-Json }
  catch { Write-Output "$alias -> PROBE_PARSE_FAIL"; continue }

  if (-not $report.ok) { Write-Output ("$alias -> PROBE_FAIL: " + $report.error); continue }

  $tools = @($report.tools)
  if ($tools.Count -eq 0) { Write-Output "$alias -> NO_TOOLS"; continue }

  $ok = 0
  foreach ($t in $tools) {
    & $py -m athena_mcp allow $alias $t.name 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ok++ }
  }
  Write-Output ("$alias -> ALLOWED $ok / " + $tools.Count)
}
