[CmdletBinding()]
param([int] $TimeoutSeconds = 90)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workspace

function Read-Environment {
    $values = @{}
    Get-Content '.env' | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line.Split('=', 2)
            if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
        }
    }
    return $values
}

function Wait-Until([string] $Description, [scriptblock] $Condition, [int] $Timeout = $TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($Timeout)
    do {
        try { if (& $Condition) { Write-Host "[PASS] $Description" -ForegroundColor Green; return } } catch { }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "Timeout: $Description"
}

$config = Read-Environment
$basicBytes = [Text.Encoding]::ASCII.GetBytes("$($config.RABBITMQ_USERNAME):$($config.RABBITMQ_PASSWORD)")
$rabbitHeaders = @{ Authorization = "Basic $([Convert]::ToBase64String($basicBytes))" }

function Get-Queue([string] $Name) {
    $encoded = [Uri]::EscapeDataString($Name)
    return Invoke-RestMethod -Uri "http://localhost:15672/api/queues/%2F/$encoded" -Headers $rabbitHeaders
}

function New-Order([string] $Version, [string] $Product, [string] $CorrelationId) {
    $body = if ($Version -eq 'v1') {
        @{ product = $Product; quantity = 1 }
    } else {
        @{ productCode = $Product; amount = 1 }
    }
    return Invoke-RestMethod -Method Post -Uri "http://localhost:8081/api/$Version/orders" `
        -Headers @{ Authorization = "Bearer $script:accessToken"; 'X-Correlation-ID' = $CorrelationId } `
        -ContentType 'application/json' -Body ($body | ConvertTo-Json)
}

function Wait-Processed([string] $OrderId) {
    Wait-Until "Order $OrderId ist PROCESSED" {
        $status = Invoke-RestMethod -Uri "http://localhost:8081/api/v1/orders/$OrderId/status" `
            -Headers @{ Authorization = "Bearer $script:accessToken" }
        return $status.status -eq 'PROCESSED'
    }
}

Write-Host '=== M321 AUTOMATED LIVE DEMO ===' -ForegroundColor Cyan
Wait-Until 'Order-Service ist bereit' {
    (Invoke-RestMethod 'http://localhost:8081/actuator/health/readiness').status -eq 'UP'
}

$tokenResponse = Invoke-RestMethod -Method Post `
    -Uri 'http://localhost:8080/realms/m321/protocol/openid-connect/token' `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{
        grant_type = 'client_credentials'
        client_id = $config.DEMO_CLIENT_ID
        client_secret = $config.DEMO_CLIENT_SECRET
    }
$script:accessToken = $tokenResponse.access_token
if (-not $script:accessToken) { throw 'Keycloak lieferte kein Access Token.' }
Write-Host '[PASS] Keycloak Client-Credentials-Token erhalten (Token wird nicht ausgegeben).' -ForegroundColor Green

$v1 = New-Order 'v1' 'DEMO-V1' 'demo-v1-correlation'
Wait-Processed $v1.orderId
$v2 = New-Order 'v2' 'DEMO-V2' 'demo-v2-correlation'
Wait-Processed $v2.orderId
Write-Host '[PASS] REST v1 und v2 laufen parallel.' -ForegroundColor Green

& (Join-Path $workspace 'set-workers.ps1') 0
$buffered = New-Order 'v1' 'BUFFERED-WHILE-OFFLINE' 'demo-buffer-correlation'
Wait-Until 'OrderCreated wartet bei 0 Workern in RabbitMQ' { (Get-Queue 'orders.processing').messages_ready -ge 1 }
& (Join-Path $workspace 'set-workers.ps1') 1
Wait-Processed $buffered.orderId
Write-Host '[PASS] Worker-Ausfall, Pufferung und Recovery nachgewiesen.' -ForegroundColor Green

& (Join-Path $workspace 'set-workers.ps1') 2
Wait-Until 'RabbitMQ sieht mindestens zwei Processing-Consumer' { (Get-Queue 'orders.processing').consumers -ge 2 }
$scaledOrders = 1..6 | ForEach-Object { New-Order 'v1' "SCALE-$_" "demo-scale-$_" }
foreach ($order in $scaledOrders) { Wait-Processed $order.orderId }
Write-Host '[PASS] Competing Consumers mit mindestens zwei Workern verarbeitet.' -ForegroundColor Green

$payload = docker compose exec -T postgres psql -U $config.POSTGRES_ADMIN_USER -d $config.POSTGRES_DB `
    -Atc "SELECT payload FROM order_service.outbox_events WHERE aggregate_id = '$($v1.orderId)'::uuid LIMIT 1"
if ($LASTEXITCODE -ne 0 -or -not $payload) { throw 'Outbox-Payload für Deduplizierungstest nicht gefunden.' }
$publishBody = @{
    properties = @{ content_type = 'application/json'; delivery_mode = 2; correlation_id = 'demo-v1-correlation' }
    routing_key = 'order.created.v1'
    payload = $payload
    payload_encoding = 'string'
} | ConvertTo-Json -Depth 5
$published = Invoke-RestMethod -Method Post `
    -Uri 'http://localhost:15672/api/exchanges/%2F/orders.events/publish' `
    -Headers $rabbitHeaders -ContentType 'application/json' -Body $publishBody
if (-not $published.routed) { throw 'Doppelte Nachricht wurde nicht zur Processing-Queue geroutet.' }
Start-Sleep -Seconds 3
$duplicateLog = docker compose logs --since 20s processing | Select-String 'DUPLICATE_IGNORED'
if (-not $duplicateLog) { throw 'Persistente Idempotenz wurde im Log nicht nachgewiesen.' }
Write-Host '[PASS] Doppelte OrderCreated-Nachricht wurde persistent dedupliziert.' -ForegroundColor Green

$failing = New-Order 'v1' 'FAIL-DEMO' 'demo-dlq-correlation'
Wait-Until 'Fehlerhafte Nachricht erreicht nach begrenzten Retries die DLQ' {
    (Get-Queue 'orders.processing.dlq').messages_ready -ge 1
}
Write-Host "[PASS] Retry/DLQ nachgewiesen; absichtlich fehlerhafte Order: $($failing.orderId)" -ForegroundColor Green

docker compose restart order-service processing | Out-Null
Wait-Until 'Order-Service ist nach Neustart bereit' {
    (Invoke-RestMethod 'http://localhost:8081/actuator/health/readiness').status -eq 'UP'
}
Wait-Until 'Persistierter Orderstatus überlebt Service-Neustart' {
    $status = Invoke-RestMethod -Uri "http://localhost:8081/api/v1/orders/$($v1.orderId)/status" `
        -Headers @{ Authorization = "Bearer $script:accessToken" }
    return $status.status -eq 'PROCESSED'
}

Write-Host @'

=== DEMO SUCCESSFUL ===
UI:          http://localhost:5173
RabbitMQ:    http://localhost:15672
Jaeger:      http://localhost:16686
Prometheus:  http://localhost:9090

Correlation logs:
  .\logs.ps1 -Service all | Select-String 'demo-'
'@ -ForegroundColor Green
