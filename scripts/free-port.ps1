$conn = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  Stop-Process -Id $conn.OwningProcess -Force
  Write-Output ("killed " + $conn.OwningProcess)
} else {
  Write-Output "no listener"
}
Start-Sleep -Seconds 2
Write-Output ("listeners now: " + (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count)
