$ErrorActionPreference = 'Stop'

$pnpmCommand = (Get-Command pnpm.cmd -ErrorAction Stop).Source
& $pnpmCommand @args
exit $LASTEXITCODE
