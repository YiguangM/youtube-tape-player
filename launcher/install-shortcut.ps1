# Adds "Tape Deck" shortcuts (with the cassette icon) to the Desktop and Start menu.
# Run it again if you move the project folder.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-tape-deck.ps1'
$icon = Join-Path $PSScriptRoot 'tape-deck.ico'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $path = Join-Path $folder 'Tape Deck.lnk'
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = 'Open Tape Deck, the YouTube cassette player'
  $shortcut.Save()
  Write-Host "Created $path"
}
