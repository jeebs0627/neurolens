param([int]$Port = 8872, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonPath = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } elseif ($pythonCommand) { $pythonCommand.Source } else { throw 'Python 3.10+ is required.' }
$taskStateDir = Join-Path $env:LOCALAPPDATA 'NeuroLens2'
New-Item -ItemType Directory -Force -Path $taskStateDir | Out-Null
$taskStateFile = Join-Path $taskStateDir ('preview-' + [guid]::NewGuid().ToString('N') + '.json')
$taskLogFile = Join-Path $taskStateDir 'preview-error.log'
$taskScript = Join-Path $taskRoot 'tools\neurolens2_preview.py'
$taskArguments = @('-X', 'utf8', ('"' + $taskScript + '"'), '--port', $Port, '--state-file', ('"' + $taskStateFile + '"'))
$process = Start-Process -FilePath $pythonPath -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardError $taskLogFile
for ($i = 0; $i -lt 100 -and -not (Test-Path -LiteralPath $taskStateFile); $i++) { Start-Sleep -Milliseconds 100 }
if (-not (Test-Path -LiteralPath $taskStateFile)) { throw "Preview did not start. See $taskLogFile" }
$preview = Get-Content -LiteralPath $taskStateFile -Raw | ConvertFrom-Json
Write-Output ('IN MIND 2.0 local preview, PID ' + $preview.pid + ', loopback port ' + $preview.port)
Write-Output $preview.url
if (-not $NoBrowser) { Start-Process $preview.url }
