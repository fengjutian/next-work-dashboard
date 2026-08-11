# Smoke test for nwd-voice-engine.
# Spawns the daemon, sends two requests, captures stdout events, waits for
# exit, lists the WAV that should have been written.
$ErrorActionPreference = 'Stop'

$exe = Join-Path $PSScriptRoot '..\native\voice-engine\target\release\nwd-voice-engine.exe'
$exe = (Resolve-Path $exe).Path
if (-not (Test-Path $exe)) { throw "binary not found: $exe" }

$tmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("voice-smoke-" + [guid]::NewGuid())) -Force
$env:NWD_VOICE_STORAGE_DIR = $tmpDir.FullName
Write-Host "storage_dir = $($tmpDir.FullName)"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = 'daemon'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)

# Fire `state` first, then a 2-second recording, then close stdin.
$proc.StandardInput.WriteLine('{"id":1,"type":"state"}')
Start-Sleep -Milliseconds 200
$proc.StandardInput.WriteLine('{"id":2,"type":"recording.start","duration_secs":2}')
$proc.StandardInput.Close()

# Drain stdout while the daemon runs; collect it for inspection.
$stdoutTask = $proc.StandardOutput.ReadToEndAsync()
$stderrTask = $proc.StandardError.ReadToEndAsync()

$exited = $proc.WaitForExit(8000)
if (-not $exited) {
  $proc.Kill()
  throw "daemon did not exit within 8s"
}

$proc.WaitForExit()
$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result

Write-Host "exit=$($proc.ExitCode)"
Write-Host "--- stdout ---"
$stdout
Write-Host "--- stderr ---"
$stderr
Write-Host "--- wavs ---"
Get-ChildItem -Path $tmpDir.FullName | Select-Object Name, Length | Format-Table | Out-String
