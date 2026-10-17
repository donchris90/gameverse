# GameVerse demo data (development only). Run with the API running:
#   powershell -ExecutionPolicy Bypass -File .\demo-data.ps1
# Creates 4 demo players and 3 reports so the admin Reports/Users/Audit screens have content.
# Do NOT run against production.

param(
  [string]$Api = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$password = "DemoPass#2026x"

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body = $null, [string]$Token = $null)
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $params = @{
    Method      = $Method
    Uri         = "$Api$Path"
    ContentType = "application/json"
    Headers     = $headers
  }
  if ($null -ne $Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 5) }
  Invoke-RestMethod @params
}

function New-Player {
  param([string]$Name, [string]$Avatar)
  $email = "$Name@demo.gameverse.test"
  try {
    $session = Invoke-Api -Method Post -Path "/v1/auth/register" -Body @{
      email         = $email
      password      = $password
      dateOfBirth   = "1995-05-05"
      acceptedTerms = $true
    }
  }
  catch {
    # Already registered on an earlier run: sign in instead.
    $session = Invoke-Api -Method Post -Path "/v1/auth/login" -Body @{ email = $email; password = $password }
  }
  $token = $session.accessToken
  try {
    Invoke-Api -Method Put -Path "/v1/me/profile" -Token $token -Body @{
      username = $Name
      avatarId = $Avatar
      bio      = "Demo player $Name"
    } | Out-Null
  }
  catch {
    Write-Host "  (profile for $Name not set: $($_.Exception.Message))"
  }
  Write-Host "Player ready: $Name"
  return [pscustomobject]@{ Name = $Name; Token = $token; Id = $session.user.id }
}

Write-Host "Creating demo players..."
$ada = New-Player -Name "demo_ada" -Avatar "avatar-01"
$bayo = New-Player -Name "demo_bayo" -Avatar "avatar-02"
$chi = New-Player -Name "demo_chi" -Avatar "avatar-03"
$dayo = New-Player -Name "demo_dayo" -Avatar "avatar-04"

Write-Host "Filing reports..."
Invoke-Api -Method Post -Path "/v1/reports" -Token $ada.Token -Body @{
  userId  = $bayo.Id
  reason  = "HARASSMENT"
  details = "Demo report: keeps sending unwanted messages."
} | Out-Null
Invoke-Api -Method Post -Path "/v1/reports" -Token $chi.Token -Body @{
  userId  = $bayo.Id
  reason  = "SPAM"
  details = "Demo report: posting the same link repeatedly."
} | Out-Null
Invoke-Api -Method Post -Path "/v1/reports" -Token $bayo.Token -Body @{
  userId  = $dayo.Id
  reason  = "CHEATING"
  details = "Demo report: suspicious behaviour."
} | Out-Null

Write-Host ""
Write-Host "Done. Open the admin app: Reports should show 3 open reports, Users should list the demo players."
Write-Host "Demo player password: $password"
