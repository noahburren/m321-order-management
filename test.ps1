[CmdletBinding()]
param([switch] $SkipImageBuild)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$mavenCache = Join-Path $workspace '.m2-build-cache'

function Run([string] $Name, [scriptblock] $Action) {
    Write-Host "[TEST] $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
    Write-Host "[PASS] $Name" -ForegroundColor Green
}

Set-Location $workspace
Run 'Docker-Compose-Validierung' { docker compose config --quiet }
Run 'Order-Service Unit-/Integrationstests' {
    Set-Location (Join-Path $workspace 'm321-order-service')
    mvn --% -Dmaven.repo.local=C:\m321\.m2-build-cache clean test
}
Run 'Processing-Service Unit-/Integrationstests' {
    Set-Location (Join-Path $workspace 'm321-processing-service')
    mvn --% -Dmaven.repo.local=C:\m321\.m2-build-cache clean test
}
Run 'UI Lint' {
    Set-Location (Join-Path $workspace 'm321-order-ui')
    npm run lint
}
Run 'UI TypeScript und Produktionsbuild' {
    Set-Location (Join-Path $workspace 'm321-order-ui')
    npm run build
}
Run 'REST- und Event-Contract-Konsistenz' {
    Set-Location $workspace
    $openApi = Get-Content 'm321-order-service/openapi.yaml' -Raw
    $orderAsync = Get-Content 'm321-order-service/asyncapi.yaml' -Raw
    $processingAsync = Get-Content 'm321-processing-service/docs/asyncapi.yaml' -Raw
    foreach ($required in @('/api/v1/orders:', '/api/v2/orders:', 'X-Correlation-ID')) {
        if (-not $openApi.Contains($required)) { throw "OpenAPI fehlt: $required" }
    }
    foreach ($required in @('orders.events', 'order.created.v1', 'order.processed.v1', 'orders.processing')) {
        if (-not $orderAsync.Contains($required) -or -not $processingAsync.Contains($required)) {
            throw "AsyncAPI-Verträge stimmen für '$required' nicht überein."
        }
    }
}
if (-not $SkipImageBuild) {
    Run 'Docker Image Builds' {
        Set-Location $workspace
        docker compose build order-service processing order-ui
    }
}
Write-Host '[PASS] Alle automatisierten Prüfungen erfolgreich.' -ForegroundColor Green
