# Run from repo root: .\scripts\dev.ps1
# Starts API (Bun/Hono, default port 3000) + Next.js (default port 3101) via Turborepo.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not $env:PORT) { $env:PORT = "3000" }
if (-not $env:WEB_PORT) { $env:WEB_PORT = "3101" }
if (-not $env:CORS_ORIGIN) { $env:CORS_ORIGIN = "http://localhost:$($env:WEB_PORT)" }
if (-not $env:NEXT_PUBLIC_SERVER_URL) {
  $env:NEXT_PUBLIC_SERVER_URL = "http://localhost:$($env:PORT)"
}

if (-not $env:BETTER_AUTH_URL) { $env:BETTER_AUTH_URL = "http://localhost:$($env:PORT)" }
if (-not $env:DB_HOST) { $env:DB_HOST = "localhost" }
if (-not $env:DB_PORT) { $env:DB_PORT = "55432" }
if (-not $env:DB_NAME) { $env:DB_NAME = "healosbench" }
if (-not $env:DB_USER) { $env:DB_USER = "postgres" }
if (-not $env:DB_PASSWORD) { $env:DB_PASSWORD = "postgres" }
$dockerDatabaseUrl = "postgres://$($env:DB_USER):$($env:DB_PASSWORD)@$($env:DB_HOST):$($env:DB_PORT)/$($env:DB_NAME)"
$env:DATABASE_URL = $dockerDatabaseUrl

$serverEnvPath = Join-Path (Get-Location) "apps/server/.env"
$serverEnvExamplePath = Join-Path (Get-Location) "apps/server/.env.example"

if (-not (Test-Path $serverEnvPath) -and (Test-Path $serverEnvExamplePath)) {
  Copy-Item $serverEnvExamplePath $serverEnvPath
  $envText = Get-Content $serverEnvPath -Raw
  $envText = $envText -replace '(?m)^CORS_ORIGIN=.*$', "CORS_ORIGIN=$($env:CORS_ORIGIN)"
  $envText = $envText -replace '(?m)^BETTER_AUTH_URL=.*$', "BETTER_AUTH_URL=$($env:BETTER_AUTH_URL)"
  Set-Content $serverEnvPath $envText
  Write-Host "Created apps/server/.env from .env.example"
}

function Upsert-EnvLine([string]$Path, [string]$Key, [string]$Value) {
  $content = ""
  if (Test-Path $Path) {
    $content = Get-Content $Path -Raw
  }
  if ($content -match "(?m)^$Key=") {
    $content = $content -replace "(?m)^$Key=.*$", "$Key=$Value"
  } else {
    if ($content -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$Key=$Value`r`n"
  }
  Set-Content $Path $content
}

Upsert-EnvLine $serverEnvPath "DATABASE_URL" $dockerDatabaseUrl
Upsert-EnvLine $serverEnvPath "CORS_ORIGIN" $env:CORS_ORIGIN
Upsert-EnvLine $serverEnvPath "BETTER_AUTH_URL" $env:BETTER_AUTH_URL

$dockerAvailable = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerAvailable) {
  throw "Docker is required. Install Docker Desktop and make sure `docker` is on PATH."
}

Write-Host "Ensuring Postgres container is running..."
docker compose up -d postgres | Out-Host

$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  $status = docker inspect -f "{{.State.Health.Status}}" test-evals-postgres 2>$null
  if ($status -eq "healthy") {
    $healthy = $true
    break
  }
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
  throw "Postgres container did not become healthy in time. Run `docker compose logs postgres`."
}

# Next can fail if another dev instance is still alive for this workspace.
$staleDev = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "node.exe" -or $_.Name -eq "bun.exe") -and
  $_.CommandLine -like "*test-evals*" -and
  (
    $_.CommandLine -like "*next*dev*" -or
    $_.CommandLine -like "*src/index.ts*" -or
    $_.CommandLine -like "*turbo*dev*"
  )
}
foreach ($p in $staleDev) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped stale dev process PID $($p.ProcessId)"
  } catch {}
}

function Stop-PortListener([int]$Port) {
  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listeners) {
      $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($pid in $pids) {
        if ($pid -and $pid -ne $PID) {
          try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Host "Freed port $Port (killed PID $pid)"
          } catch {}
        }
      }
    }
  } catch {}
}

Stop-PortListener ([int]$env:PORT)
Stop-PortListener ([int]$env:WEB_PORT)
Stop-PortListener 3001

Write-Host ""
Write-Host "Using:"
Write-Host "  PORT (API)               = $($env:PORT)"
Write-Host "  WEB_PORT (Next)          = $($env:WEB_PORT)"
Write-Host "  CORS_ORIGIN              = $($env:CORS_ORIGIN)"
Write-Host "  NEXT_PUBLIC_SERVER_URL   = $($env:NEXT_PUBLIC_SERVER_URL)"
Write-Host "  BETTER_AUTH_URL          = $($env:BETTER_AUTH_URL)"
Write-Host "  DATABASE_URL             = $($env:DATABASE_URL)"
Write-Host ""
Write-Host "Database is Docker-managed via docker-compose (service: postgres)."
Write-Host "Keep in apps/server/.env: BETTER_AUTH_SECRET (32+ chars), BETTER_AUTH_URL, CORS_ORIGIN, ANTHROPIC_API_KEY"
Write-Host "  Tip: CORS_ORIGIN must match Next (default http://localhost:$($env:WEB_PORT)); BETTER_AUTH_URL = API URL"
Write-Host ""

bun run dev
