[CmdletBinding()]
param([int] $TimeoutSeconds = 300)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $workspace 'stop.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $workspace 'start.ps1') -TimeoutSeconds $TimeoutSeconds
exit $LASTEXITCODE
