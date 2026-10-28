[CmdletBinding()]
param([int] $TimeoutSeconds = 300)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workspace

function Fail([string] $Message) {
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    try { docker compose ps } catch { }
    try { docker compose logs --tail 80 } catch { }
    exit 1
}

function Wait-Healthy([string] $Service, [int] $Timeout) {
    $deadline = (Get-Date).AddSeconds($Timeout)
    do {
        $ids = @(docker compose ps -q $Service 2>$null)
        if ($LASTEXITCODE -eq 0 -and $ids.Count -gt 0) {
            $states = @($ids | ForEach-Object {
                docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $_
            })
            if ($states.Count -gt 0 -and @($states | Where-Object { $_ -ne 'healthy' -and $_ -ne 'running' }).Count -eq 0) {
                Write-Host (" [OK] {0,-20} READY" -f $Service) -ForegroundColor Green
                return
            }
            if ($states -contains 'unhealthy' -or $states -contains 'exited' -or $states -contains 'dead') {
                Fail "$Service ist fehlgeschlagen (Status: $($states -join ', '))."
            }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    Fail "$Service wurde innerhalb von $Timeout Sekunden nicht bereit."
}

function Wait-Url([string] $Name, [string] $Url, [int] $Timeout) {
    $deadline = (Get-Date).AddSeconds($Timeout)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Host (" [OK] {0,-20} HTTP READY" -f $Name) -ForegroundColor Green
                return
            }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    Fail "$Name ist unter $Url nicht erreichbar."
}

try { docker version *> $null } catch { Fail 'Docker Desktop ist nicht erreichbar.' }
if (-not (Test-Path '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host '[INFO] Lokale Demo-Konfiguration wurde aus .env.example erstellt.' -ForegroundColor Yellow
}

docker compose config --quiet
if ($LASTEXITCODE -ne 0) { Fail 'docker-compose.yml oder .env ist ungültig.' }

Write-Host '[INFO] Images werden gebaut und Container gestartet ...'
docker compose up --build --detach
if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose konnte das System nicht starten.' }

Write-Host '==============================================='
Write-Host ' M321 - DISTRIBUTED SYSTEM'
Write-Host '==============================================='
foreach ($service in @('postgres', 'rabbitmq', 'keycloak', 'jaeger', 'order-service', 'processing', 'order-ui', 'prometheus')) {
    Wait-Healthy $service $TimeoutSeconds
}
Wait-Url 'Keycloak Realm' 'http://localhost:8080/realms/m321/.well-known/openid-configuration' $TimeoutSeconds
Wait-Url 'Order Readiness' 'http://localhost:8081/actuator/health/readiness' $TimeoutSeconds
Wait-Url 'React UI' 'http://localhost:5173/' $TimeoutSeconds
Wait-Url 'Prometheus' 'http://localhost:9090/-/ready' $TimeoutSeconds
Wait-Url 'Jaeger' 'http://localhost:16686/' $TimeoutSeconds

Write-Host @'
-----------------------------------------------
 AVAILABLE SERVICES
-----------------------------------------------
 UI:                    http://localhost:5173
 Swagger / OpenAPI:     http://localhost:8081/swagger-ui.html
 Order API:             http://localhost:8081
 RabbitMQ Management:   http://localhost:15672
 Keycloak:              http://localhost:8080
 Prometheus:            http://localhost:9090
 Jaeger Tracing:        http://localhost:16686

-----------------------------------------------
 DEMO ACCOUNTS
-----------------------------------------------
 User:                  demo-user
 Admin:                 demo-admin
 Passwords:             see local .env / project documentation

-----------------------------------------------
 USEFUL COMMANDS
-----------------------------------------------
 Stop:      .\stop.ps1
 Restart:   .\restart.ps1
 Logs:      .\logs.ps1
 Tests:     .\test.ps1
 Demo:      .\demo.ps1

===============================================
 SYSTEM READY
===============================================
'@
