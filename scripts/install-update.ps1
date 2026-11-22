param(
  [Parameter(Mandatory = $true)][ValidateSet('portable', 'installer')][string]$UpdateType,
  [Parameter(Mandatory = $true)][string]$NewExecutablePath,
  [Parameter(Mandatory = $true)][string]$TargetExecutablePath,
  [Parameter(Mandatory = $true)][int]$ProcessId
)
$ErrorActionPreference = 'Stop'

if ([System.IO.Path]::GetExtension($NewExecutablePath) -ne '.exe') { throw 'Invalid update file' }
if ([System.IO.Path]::GetExtension($TargetExecutablePath) -ne '.exe') { throw 'Invalid target file' }
if (-not (Test-Path -LiteralPath $NewExecutablePath -PathType Leaf)) { throw 'Update file not found' }
if (-not (Test-Path -LiteralPath $TargetExecutablePath -PathType Leaf)) { throw 'Application not found' }

Wait-Process -Id $ProcessId -Timeout 120 -ErrorAction SilentlyContinue
if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { throw 'Application did not close in time' }

$deadline = (Get-Date).AddSeconds(120)
while (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $TargetExecutablePath }) {
  if ((Get-Date) -ge $deadline) { throw 'Application process did not close in time' }
  Start-Sleep -Seconds 1
}

if ($UpdateType -eq 'installer') {
  $installer = Start-Process -FilePath $NewExecutablePath -ArgumentList '/S' -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)" }
  Start-Process -FilePath $TargetExecutablePath
  Remove-Item -LiteralPath $NewExecutablePath -Force
  exit 0
}

$directory = [System.IO.Path]::GetDirectoryName($TargetExecutablePath)
$stagedPath = Join-Path $directory ([System.IO.Path]::GetRandomFileName() + '.exe')
$backupPath = Join-Path $directory ([System.IO.Path]::GetRandomFileName() + '.bak')
Copy-Item -LiteralPath $NewExecutablePath -Destination $stagedPath

try {
  [System.IO.File]::Replace($stagedPath, $TargetExecutablePath, $backupPath)
  try {
    Start-Process -FilePath $TargetExecutablePath
  }
  catch {
    [System.IO.File]::Replace($backupPath, $TargetExecutablePath, $stagedPath)
    throw
  }
  Remove-Item -LiteralPath $backupPath -Force
  Remove-Item -LiteralPath $NewExecutablePath -Force
}
finally {
  if (Test-Path -LiteralPath $stagedPath) { Remove-Item -LiteralPath $stagedPath -Force }
}
