param(
    [string]$PythonExe = '',
    [switch]$AppOnly
)

$ErrorActionPreference = 'Stop'
$handoffRepo = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js가 필요합니다. HANDOFF.md의 환경 준비 절차를 확인하세요.'
}
if (-not $AppOnly) {
    if (-not $PythonExe) {
        $PythonExe = Join-Path $handoffRepo 'backend/.venv/Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $PythonExe)) {
            $PythonExe = Join-Path $handoffRepo 'backend/.venv/bin/python'
        }
    }
    if (-not (Test-Path -LiteralPath $PythonExe)) {
        throw 'backend 가상환경 Python을 찾을 수 없습니다. -PythonExe로 실행 파일을 지정할 수 있습니다.'
    }
    $PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
}

Push-Location $handoffRepo
try {
    $handoffAppTests = @(
        'app/lib/aits-chart-panel.test.js',
        'app/lib/board-format.test.js',
        'app/lib/main/board-hydrate.test.js',
        'app/lib/main/chart-page.test.js',
        'app/lib/main/chart-reload.test.js',
        'app/lib/canvas-tabs.test.js',
        'app/lib/gold-chart-refresh.test.js',
        'app/lib/main/tool-failure.test.js',
        'app/lib/main/live-prompt.test.js',
        'app/lib/main/gold-order-intent.test.js',
        'app/lib/main/stream-json-parser.test.js',
        'app/lib/order-ticket.test.js'
    )
    & node --test @handoffAppTests
    if ($LASTEXITCODE -ne 0) { throw "앱 회귀 검사 실패: $LASTEXITCODE" }
    if (-not $AppOnly) {
        Push-Location (Join-Path $handoffRepo 'backend')
        try {
            & $PythonExe -m pytest -q tests/api/test_llm_tools_api.py tests/api/test_canvas_push.py tests/api/test_canvas_render_plan.py tests/mcp/test_canvas_data.py
            if ($LASTEXITCODE -ne 0) { throw "백엔드 회귀 검사 실패: $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
    }
    Write-Output $(if ($AppOnly) { '앱 검사만 통과했습니다. 백엔드는 실행하지 않았습니다.' } else { '금현물 인수인계 회귀 검사가 통과했습니다. 실제 화면 검증은 별도입니다.' })
} finally {
    Pop-Location
}
