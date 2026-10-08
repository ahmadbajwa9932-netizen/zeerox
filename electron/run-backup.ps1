Add-Type -Name W -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);'
[W.W]::ShowWindow((Get-Process -Id $PID).MainWindowHandle, 0) | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupScript = Join-Path $scriptDir "backup-script.js"
$nodePath = Join-Path $scriptDir "tools\node.exe"

if (-not (Test-Path $nodePath)) {
    $logFile = "$env:APPDATA\ZeeroX\backup.log"
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$timestamp] ERROR: node.exe not found at $nodePath"
    exit 1
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodePath
$psi.Arguments = "`"$backupScript`""
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.CreateNoWindow = $true
$psi.UseShellExecute = $false
[System.Diagnostics.Process]::Start($psi) | Out-Null