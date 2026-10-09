# NeuroLock status check: tests the real services and signs in with every demo account.
# Usage:  powershell -ExecutionPolicy Bypass -File .\check_status.ps1
$api = 'http://localhost:4311/api'

function Show($label, $ok, $detail = '') {
    $mark = if ($ok) { 'OK  ' } else { 'FAIL' }
    $color = if ($ok) { 'Green' } else { 'Red' }
    Write-Host ("  [{0}] {1} {2}" -f $mark, $label, $detail) -ForegroundColor $color
}

Write-Host "`n=== NeuroLock status ===" -ForegroundColor Cyan

Write-Host "`nServices" -ForegroundColor Yellow
$mysql = Test-NetConnection -ComputerName 127.0.0.1 -Port 3307 -WarningAction SilentlyContinue
Show 'MySQL (port 3307)' $mysql.TcpTestSucceeded
try {
    $health = Invoke-RestMethod "$api/health" -TimeoutSec 8
    $ok = $true
} catch {
    $health = try { $_.ErrorDetails.Message | ConvertFrom-Json } catch { $null }
    $ok = $false
}
if ($health) {
    Show 'REST API (port 4311)' $true
    Show '  clinical database' ($health.database -eq 'connected') $health.database
    Show '  AAA server (mutual TLS)' ($health.aaa -eq 'connected') $health.aaa
    Show '  directory (OpenLDAP)' ($health.directory -eq 'connected') $health.directory
    Show '  log server (rsyslog)' ($health.log_server -in 'connected', 'disabled') $health.log_server
} else {
    Show 'REST API (port 4311)' $false 'not reachable - docker compose up -d, or: cd neurolock-staff-backend; npm run dev'
}
$web = Test-NetConnection -ComputerName 127.0.0.1 -Port 443 -WarningAction SilentlyContinue
Show 'Website (https://localhost, docker)' $web.TcpTestSucceeded $(if (-not $web.TcpTestSucceeded) { '(only with docker compose)' })
$expo = Test-NetConnection -ComputerName 127.0.0.1 -Port 8081 -WarningAction SilentlyContinue
Show 'Expo / Metro (port 8081)' $expo.TcpTestSucceeded $(if (-not $expo.TcpTestSucceeded) { 'run: cd frontend; npm start' })

Write-Host "`nDemo logins (username / Demo@1234)" -ForegroundColor Yellow
foreach ($user in 'admin', 'psychiatrist', 'psychologist', 'therapist', 'nurse', 'patient') {
    try {
        $body = @{ identifier = $user; password = 'Demo@1234' } | ConvertTo-Json
        $login = Invoke-RestMethod -Method Post "$api/auth/login" -ContentType 'application/json' -Body $body -TimeoutSec 10
        if ($login.data.mfa_required) {
            Show $user $true '(MFA enabled - code required)'
            continue
        }
        $account = $login.data.user
        $lands = if ($account.can_act_as) { 'role chooser (admin)' } elseif ($account.portal_uid) { 'patient portal' } else { "$($account.role_name) dashboard" }
        Show $user $true ("-> {0}, {1} permissions" -f $lands, $login.data.permissions.Count)
        $headers = @{ Authorization = "Bearer $($login.data.token)" }
        Invoke-RestMethod -Method Post "$api/auth/logout" -Headers $headers | Out-Null
    } catch {
        $message = try { ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { $_.Exception.Message }
        Show $user $false $message
    }
}
Write-Host ''
