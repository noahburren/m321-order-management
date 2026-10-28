param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateRange(0, 20)]
    [int] $Count
)

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeFile = Join-Path $workspace 'docker-compose.yml'

docker compose --file $composeFile up --detach --no-recreate --scale "processing=$Count" processing
if ($LASTEXITCODE -ne 0) {
    throw "Processing Worker konnten nicht auf $Count skaliert werden."
}

Write-Host "Verarbeitungs-Worker: $Count"
Write-Host 'Die Oberfläche aktualisiert Consumers und Warteschlange automatisch.'
