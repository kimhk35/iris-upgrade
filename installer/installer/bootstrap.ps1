# IRIS installer bootstrap. ASCII only (see AGENTS.md). Windows PowerShell 5.1
# compatible syntax only (Invoke-WebRequest -UseBasicParsing, Get-FileHash).
#
# Exit codes: 0 ok, 10 bad location (still zipped / missing payload),
# 11 integrity check failed, 12 could not unpack Node, 13 server did not
# answer within 60 s (or stopped right after starting). Every failure also
# prints a Korean reason from bootstrap-ko.json before exiting.
param(
  [Parameter(Mandatory)][string]$ZipRoot,
  [int]$Port = 3460,
  # Automatic update mode: passed through to server.mjs as --auto. Set by the
  # installer .cmd when it is run with --auto, which is how the updater starts
  # this installer for a structural update. The server still refuses to run
  # silently unless the target already has a v2 install receipt (a 1.x receipt
  # answers "reinstall required" and changes nothing).
  [switch]$Auto,
  # Resume mode: passed through to server.mjs as --resume. Set by the installer
  # .cmd when it is run with --resume, which is how the IRIS window's
  # "continue setup" button restarts an install that stopped before the online
  # steps finished. The server re-reads the receipt and reopens at that point.
  [switch]$Resume
)
$ErrorActionPreference = 'Stop'

# Normalize away a trailing slash so downstream Join-Path calls do not end up
# with doubled separators; the installer .cmd launcher already strips
# %~dp0's trailing backslash, but bootstrap.ps1 can also be run directly for
# testing.
if ($ZipRoot.Length -gt 3 -and ($ZipRoot.EndsWith('\') -or $ZipRoot.EndsWith('/'))) {
  $ZipRoot = $ZipRoot.Substring(0, $ZipRoot.Length - 1)
}

$work = Join-Path $env:LOCALAPPDATA 'IRIS-Installer'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$log = Join-Path $work 'bootstrap.log'

# Rotate before writing anything this run: a log that has grown past 512KB
# (many prior runs, or a chatty failure loop) is moved to bootstrap.log.1
# (overwriting any older rotation), so the active log never grows without
# bound while still keeping one previous run's tail around for inspection.
if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 524288)) {
  $rotated = Join-Path $work 'bootstrap.log.1'
  Remove-Item -LiteralPath $rotated -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $log -Destination $rotated -Force
}
"---- run $(Get-Date -Format s) ----" | Add-Content -LiteralPath $log

function Log($m) {
  "$(Get-Date -Format s) $m" | Add-Content -LiteralPath $log
  Write-Host $m
}

# Korean guidance for the person at the screen (P18, 2026-11-18). This file is
# ASCII only, so every Korean sentence lives in bootstrap-ko.json (UTF-8) --
# the same pattern as uninstall.ps1 / uninstall-ko.json. A missing or broken
# strings file must never stop the install: Ko then prints nothing and the
# English Log line stays.
$script:Ko = $null
try {
  $koPath = Join-Path $ZipRoot 'installer\bootstrap-ko.json'
  if (Test-Path -LiteralPath $koPath) {
    $script:Ko = [IO.File]::ReadAllText($koPath, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
  }
} catch { $script:Ko = $null }
function Ko([string]$key) {
  if (-not $script:Ko) { return }
  $p = $script:Ko.PSObject.Properties[$key]
  if (-not $p) { return }
  $text = [string]$p.Value
  if ($args.Count -gt 0) { $text = [string]::Format($text, [object[]]$args) }
  Write-Host ''
  foreach ($line in ($text -split "`n")) { Write-Host "  $line" -ForegroundColor Cyan }
}
# Stop with a Korean reason + where the log is (the .cmd then pauses).
function Fail([int]$code, [string]$key) {
  Ko $key @args
  Ko 'logHint' $log
  exit $code
}

# Opening the browser is a courtesy, not a requirement: the server is already
# up when this is called. Measured 2026-09-17 (VM S03, a standard-user session
# without an interactive desktop): Start-Process on a URL threw, bootstrap
# exited 1, the .cmd printed "Setup could not start" and paused forever while
# the installer was in fact ready on 127.0.0.1:3460. A PC with no URL handler
# would look the same. So: try, and on failure print the address instead.
function Open-Browser($url) {
  try {
    Start-Process $url
  } catch {
    Log "Could not open the browser automatically ($($_.Exception.Message)). Open this address yourself: $url"
    Ko 'noBrowser' $url
    Write-Host ""
    Write-Host "  >>> Open this address in your browser: $url"
    Write-Host ""
  }
}

Log "Starting. ZipRoot=$ZipRoot Port=$Port Auto=$($Auto.IsPresent) Resume=$($Resume.IsPresent)"
Ko 'start'

# --- Stage: location (exit 10) -------------------------------------------
# Two symptoms of "the user did not extract the zip first": Windows Explorer
# opened the installer .cmd file straight out of the zip into a throwaway
# temp folder (path under %TEMP%), or the payload folder that ships beside
# the zip root is simply missing (someone copied only the .cmd file out).
$manifestPath = Join-Path $ZipRoot 'payload\manifest.json'
if ($ZipRoot -like "$env:TEMP*" -or -not (Test-Path -LiteralPath $manifestPath)) {
  Log 'Please extract the zip file first, then run the installer from the extracted folder.'
  Fail 10 'e10'
}
Log 'Location check passed.'

# --- Stage: integrity (exit 11) -------------------------------------------
# Every payload part is hashed at build time into payload/manifest.json; a
# mismatch here means a corrupted or tampered download.
# manifest.json is UTF-8 with no BOM (some payload file names are Korean).
# Get-Content with no -Encoding defaults to the system ANSI code page for a
# BOM-less file on Windows PowerShell 5.1, which mangles those names before
# ConvertFrom-Json ever sees them and causes false integrity failures below
# -- -Encoding UTF8 forces correct decoding regardless of the console code
# page.
$mf = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($part in $mf.parts.PSObject.Properties) {
  $f = Join-Path $ZipRoot ('payload\' + $part.Value.file)
  $hashOk = $false
  if (Test-Path -LiteralPath $f) {
    $actual = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    $hashOk = ($actual -eq $part.Value.sha256)
  }
  if (-not $hashOk) {
    Log "Integrity check failed: $($part.Value.file). Download the zip again."
    Fail 11 'e11'
  }
}
Log 'Integrity check passed.'

# --- Stage: stale server check ---------------------------------------------
# Re-running the installer (or double-clicking it a second time) must be
# idempotent. Two cases matter here:
#   1. A server from an earlier run is still alive and answering -- do not
#      start a second one (it would fail to bind the port anyway, and
#      server.pid would get overwritten with a dead PID). Reuse it.
#   2. server.pid names a process that used to be our server but stopped
#      answering (crashed, hung) -- stop exactly that recorded PID (never a
#      name or port scan) and clear the stale pid file before starting
#      fresh.
# The health probe alone is not enough to prove the thing on the port is
# *our* server (some other program could be bound to 3460) -- Task 10's
# server.mjs contract includes a "name":"iris-installer" field in the
# /api/health JSON body for exactly this reason.
# Bundled Node paths are resolved here (before the stale-server stage) because
# the stale-pid identity check below compares a recorded pid's image path
# against this exact node.exe. The Node *unpack* stage still happens later.
$nodeDir = Join-Path $work 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'

$pidFile = Join-Path $work 'server.pid'
$alreadyRunning = $false
try {
  $probe = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
  if ($probe.StatusCode -eq 200) {
    $probeBody = $null
    try { $probeBody = $probe.Content | ConvertFrom-Json } catch {}
    if ($probeBody -and $probeBody.name -eq 'iris-installer') {
      $alreadyRunning = $true
    }
  }
} catch {}

if ($alreadyRunning) {
  $existingPid = $null
  if (Test-Path -LiteralPath $pidFile) {
    try { $existingPid = (Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8).Trim() } catch {}
  }
  # 2.0.23 (2026-09-19, home-desktop): a leftover server of an OLDER package
  # (e.g. a hidden --auto run that never got its browser click) was reused
  # by every later run, so a 2.0.21 zip kept showing "2.0.19". Reuse only the
  # SAME version; a different version (or any --auto run, which must run its
  # own package) is asked to quit via its own /api/quit, then we start fresh.
  $ours = $null
  try {
    $lockJson = Get-Content -LiteralPath (Join-Path $ZipRoot 'lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $ours = [string]$lockJson.package.version
  } catch {}
  $theirs = [string]$probeBody.version
  $replace = $Auto.IsPresent -or ($ours -and $theirs -and ($ours -ne $theirs))
  if (-not $replace) {
    Log "Setup server already running (pid $existingPid, version $theirs). Reusing it."
    Open-Browser "http://127.0.0.1:$Port/"
    exit 0
  }
  Log "Setup server already running (pid $existingPid) is version '$theirs' but this package is '$ours' (auto=$($Auto.IsPresent)). Asking it to quit."
  # The server's CSRF guard answers 415 unsupported_media_type to any POST
  # without a JSON body (2.0.24, home-desktop 2026-09-19 -- the bare POST in
  # 2.0.23 was refused and the old server stayed up).
  try { Invoke-WebRequest "http://127.0.0.1:$Port/api/quit" -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 5 | Out-Null } catch {}
  $freed = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { $freed = $true; break }
  }
  if ($freed) {
    Log "Old server quit; port $Port is free. Starting this package's server."
    if (Test-Path -LiteralPath $pidFile) { try { Remove-Item -LiteralPath $pidFile -Force } catch {} }
  } else {
    Log "Old server did not quit within 10 s. Falling through to the recorded-pid check."
  }
}

if (Test-Path -LiteralPath $pidFile) {
  $stalePid = $null
  try { $stalePid = [int]((Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8).Trim()) } catch {}
  if ($stalePid) {
    $staleProc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
    if ($staleProc) {
      # A pid is only ours to stop if it still PROVES it is the server we
      # started: pids are recycled, and server.pid can outlive its process by
      # days, so "the file says 3456" is not evidence. Proof needs both:
      #   - the image is node (never a shell, an editor, an agent), AND
      #   - the image path is readable AND equals the bundled node.exe under
      #     %LOCALAPPDATA%\IRIS-Installer\node.
      # An unreadable or absent Path (a process this user may not query, a
      # process exiting right now) is NOT a free pass: identity unknown means
      # not ours, so nothing is stopped -- otherwise an unrelated node.exe
      # (a dev server, a relay, an agent session) would still be killed by
      # name alone. The stale pid file is removed either way and a fresh
      # server is started; the health probe above already handled the case
      # where our own server is alive and answering.
      $stalePath = $null
      try { $stalePath = $staleProc.Path } catch { $stalePath = $null }
      $isOurs = $false
      if (($staleProc.ProcessName -eq 'node') -and $stalePath) {
        $isOurs = ($stalePath -eq $nodeExe)
      }
      if ($isOurs) {
        Log "Stopping stale server process (pid $stalePid)."
        Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
      } elseif (-not $stalePath) {
        Log "stale pid ${stalePid}: identity unknown, not stopping."
      } else {
        Log "server.pid names pid $stalePid, but that process is not our bundled Node server. Leaving it alone."
      }
    } else {
      Log "server.pid names pid $stalePid, which is not running. Nothing to stop."
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} else {
  Log 'No previous server.pid found.'
}

# --- Stage: portable Node (exit 12) ----------------------------------------
# Unpacked once into %LOCALAPPDATA%\IRIS-Installer\node and reused on every
# later run (re-running the installer, or the server relaunching it, must
# not re-extract Node every time).
$nodeZip = Join-Path $ZipRoot ('payload\' + $mf.parts.node.file)
if (Test-Path -LiteralPath $nodeExe) {
  Log 'Node already present, reusing.'
} else {
  Remove-Item -LiteralPath $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
  # node-v24.17.0-win-x64.zip contains one top-level folder; strip it so
  # node.exe lands directly under $nodeDir.
  & "$env:SystemRoot\System32\tar.exe" -xf "$nodeZip" -C "$nodeDir" --strip-components 1
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeExe)) {
    Log 'Could not unpack Node.'
    Fail 12 'e12'
  }
  Log 'Node unpacked.'
}

# --- School / office networks (P18, 2026-11-18) -----------------------------
# Node's fetch ignores the Windows proxy setting and the Windows trusted-root
# store (where a school's TLS-inspection appliance puts its root). Every
# download of the installer (Claude Code, npm, updates) then fails behind such
# a network. The server and every node it starts inherit these variables:
#   NODE_USE_SYSTEM_CA=1  trust the Windows root store as well (Node 24, measured)
#   HTTPS_PROXY + NODE_USE_ENV_PROXY=1  go through the Windows proxy; without
#     NODE_USE_ENV_PROXY fetch ignores HTTPS_PROXY (measured with a fake proxy).
# GetSystemWebProxy also evaluates PAC scripts and WPAD, not just a fixed proxy.
# NO_PROXY keeps this PC's own relay (127.0.0.1) off the proxy.
$env:NODE_USE_SYSTEM_CA = '1'
$proxyUrl = $env:HTTPS_PROXY
if (-not $proxyUrl) { $proxyUrl = $env:https_proxy }
if (-not $proxyUrl) {
  try {
    $probeUri = [Uri]'https://downloads.claude.ai/'
    $sysProxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $viaUri = $sysProxy.GetProxy($probeUri)
    if ($viaUri -and $viaUri.AbsoluteUri -ne $probeUri.AbsoluteUri) { $proxyUrl = "http://$($viaUri.Authority)" }
  } catch {}
}
if ($proxyUrl) {
  $env:HTTPS_PROXY = $proxyUrl
  if (-not $env:HTTP_PROXY -and -not $env:http_proxy) { $env:HTTP_PROXY = $proxyUrl }
  $noProxy = @()
  if ($env:NO_PROXY) { $noProxy += $env:NO_PROXY -split ',' }
  $noProxy += @('localhost', '127.0.0.1', '::1')
  $env:NO_PROXY = (($noProxy | ForEach-Object { $_.Trim() } | Where-Object { $_ }) | Select-Object -Unique) -join ','
  $env:NODE_USE_ENV_PROXY = '1'
  Log "Network: using proxy $proxyUrl."
  Ko 'proxy' $proxyUrl
} else {
  Log 'Network: no proxy.'
}

# --- Stage: server + browser (exit 13) -------------------------------------
$server = Join-Path $ZipRoot 'installer\server.mjs'
$serverOut = Join-Path $work 'server.out.log'
$serverErr = Join-Path $work 'server.err.log'
$serverArgs = @("`"$server`"", '--zip-root', "`"$ZipRoot`"", '--port', $Port, '--node-dir', "`"$nodeDir`"")
if ($Auto) { $serverArgs += '--auto' }
if ($Resume) { $serverArgs += '--resume' }
$proc = Start-Process -FilePath $nodeExe `
  -ArgumentList $serverArgs `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
"$($proc.Id)" | Set-Content -LiteralPath $pidFile
Log "Server process started (pid $($proc.Id))."

# P18 (2026-11-18): wait up to 60 s, not 20 s. The first node run on a new PC
# is scanned by the antivirus and took 75 s once (VM S01, 2.0.12) -- 20 s
# stopped with a bare "code 13". Every 10 s the person sees how long it has
# been, and a server that died on start stops the wait at once with its last
# error line instead of sitting out the full minute.
$WaitSeconds = 60
$ok = $false
$crashed = $false
for ($i = 1; $i -le ($WaitSeconds * 2) -and -not $ok; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
    $ok = ($r.StatusCode -eq 200)
  } catch {}
  if (-not $ok -and $proc.HasExited) { $crashed = $true; break }
  if (-not $ok -and ($i % 20) -eq 0) { Ko 'waiting' ($i / 2) }
}
if (-not $ok) {
  if ($crashed) {
    $lastErr = ''
    try { $lastErr = ((Get-Content -LiteralPath $serverErr -Tail 3 -ErrorAction Stop) -join ' | ') } catch {}
    if (-not $lastErr) { $lastErr = "exit code $($proc.ExitCode)" }
    if ($lastErr.Length -gt 300) { $lastErr = $lastErr.Substring(0, 300) }
    Log "Setup server stopped right after starting: $lastErr"
    Fail 13 'e13crash' $lastErr
  }
  Log "Setup server did not respond within $WaitSeconds seconds."
  Fail 13 'e13'
}

Log 'Server is ready. Open the browser window to continue.'
Ko 'ready'
Open-Browser "http://127.0.0.1:$Port/"
Log "Opened browser (server pid $($proc.Id))."
exit 0
