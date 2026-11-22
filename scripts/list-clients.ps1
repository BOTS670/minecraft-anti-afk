# Prints a JSON array of Minecraft Java windows: pid, name, title, startedAt.
# The process command line is used only for matching and is NEVER printed
# (it may contain access tokens). This file must stay ASCII-only (see tests).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cmd = @{}
Get-CimInstance Win32_Process -Filter "Name='javaw.exe' OR Name='java.exe'" | ForEach-Object {
  $cmd[[int]$_.ProcessId] = [string]$_.CommandLine
}

$result = @(
  Get-Process -Name javaw, java -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Where-Object { $_.MainWindowTitle -match 'Minecraft' -or $cmd[[int]$_.Id] -match 'net\.minecraft|--gameDir|minecraft' } |
    ForEach-Object {
      [pscustomobject]@{
        pid       = [int]$_.Id
        name      = $_.ProcessName
        title     = $_.MainWindowTitle
        startedAt = $(try { $_.StartTime.ToString('o') } catch { $null })
      }
    }
)
ConvertTo-Json -InputObject $result -Compress
