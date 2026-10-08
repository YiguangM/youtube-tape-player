# Tape Deck launcher (Windows).
# Starts the app's server, opens Tape Deck in its own window, and shuts the
# server down again when that window is closed.
#
# Used by the "Tape Deck" desktop / Start menu shortcuts that
# install-shortcut.ps1 creates.

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Tape Deck'

$root = Split-Path -Parent $PSScriptRoot
$port = 3210
$url = "http://localhost:$port"
$profileDir = Join-Path $env:LOCALAPPDATA 'TapeDeck\browser-profile'

function Test-TapeDeck {
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $res.Content -match '<title>Tape Deck</title>'
  } catch {
    return $false
  }
}

function Test-BuildNeeded {
  $buildId = Join-Path $root '.next\BUILD_ID'
  if (-not (Test-Path $buildId)) { return $true }
  $builtAt = (Get-Item $buildId).LastWriteTime

  $inputs = @()
  foreach ($dir in 'src', 'public') {
    $full = Join-Path $root $dir
    if (Test-Path $full) { $inputs += Get-ChildItem $full -Recurse -File }
  }
  foreach ($file in 'package.json', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json') {
    $full = Join-Path $root $file
    if (Test-Path $full) { $inputs += Get-Item $full }
  }
  return [bool]($inputs | Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1)
}

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Test-AppWindowOpen($browser) {
  $name = Split-Path $browser -Leaf
  $procs = Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue
  return [bool]($procs | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } | Select-Object -First 1)
}

function Hide-ConsoleWindow {
  Add-Type -Namespace TapeDeck -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
  [TapeDeck.Console]::ShowWindow([TapeDeck.Console]::GetConsoleWindow(), 0) | Out-Null
}

function Stop-Server($server) {
  if ($server -and -not $server.HasExited) {
    & taskkill.exe /PID $server.Id /T /F 2>$null | Out-Null
  }
}

function Fail($message, $server) {
  Stop-Server $server
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Set-Location $root
$server = $null

if (Test-TapeDeck) {
  Write-Host 'Tape Deck is already running.'
} else {
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail 'Node.js is not installed. Install it from https://nodejs.org and try again.'
  }

  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Installing packages (first run only)...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { Fail 'Installing packages failed. See the messages above.' }
  }

  if (Test-BuildNeeded) {
    Write-Host 'Getting Tape Deck ready (only needed after the code changes)...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { Fail 'Building the app failed. See the messages above.' }
  }

  Write-Host 'Starting Tape Deck...'
  $server = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'start', '--', '--port', $port `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-TapeDeck)) {
    if ($server.HasExited) { Fail "Tape Deck's server stopped unexpectedly. Is another program using port $port?" }
    if ((Get-Date) -gt $deadline) { Fail 'Tape Deck took too long to start.' $server }
    Start-Sleep -Milliseconds 500
  }
}

$browser = Find-Browser
if (-not $browser) {
  # No Chrome or Edge: fall back to a normal browser tab.
  Start-Process $url
  if ($server) {
    Write-Host "Tape Deck is open in your browser at $url"
    Read-Host 'Press Enter here when you are done to stop Tape Deck'
    Stop-Server $server
  }
  exit 0
}

# --app opens a standalone window without tabs or an address bar. The separate
# profile keeps your tape rack, and lets us tell when the window is closed.
Start-Process -FilePath $browser -ArgumentList @(
  "--app=$url",
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1120,1000'
)

# Only the launcher that started the server waits around to stop it.
if (-not $server) { exit 0 }

Hide-ConsoleWindow
Start-Sleep -Seconds 5
while (Test-AppWindowOpen $browser) {
  Start-Sleep -Seconds 2
}
Stop-Server $server
