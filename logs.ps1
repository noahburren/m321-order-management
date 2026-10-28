[CmdletBinding()]
param(
    [ValidateSet('all','postgres','rabbitmq','keycloak','order-service','processing','order-ui','prometheus','jaeger')]
    [string] $Service = 'all',
    [int] $Tail = 200,
    [switch] $Follow
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
$arguments = @('compose', 'logs', '--tail', $Tail.ToString())
if ($Follow) { $arguments += '--follow' }
if ($Service -ne 'all') { $arguments += $Service }
& docker @arguments
exit $LASTEXITCODE
