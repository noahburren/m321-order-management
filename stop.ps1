[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
docker compose down
if ($LASTEXITCODE -ne 0) { throw 'Das Gesamtsystem konnte nicht sauber gestoppt werden.' }
Write-Host '[OK] System gestoppt; PostgreSQL-, RabbitMQ-, Keycloak- und Prometheus-Daten bleiben erhalten.'
