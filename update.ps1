# Get the latest SCORM Editor from GitHub and restart it. Saved projects are kept
# (they live in your browser, not in the container).
# Run with:  powershell -ExecutionPolicy Bypass -File .\update.ps1
Set-Location $PSScriptRoot

git pull --ff-only
if ($LASTEXITCODE -ne 0) { Write-Host "Couldn't get the latest code (git pull failed)." -ForegroundColor Red; exit 1 }

# One-time clean-up: before it was renamed, the app ran as "lectora-clone" and
# would still be holding port 8080.
cmd /c "docker compose -p lectora-clone down --remove-orphans >nul 2>&1"

docker compose up -d --build --remove-orphans
if ($LASTEXITCODE -ne 0) { Write-Host "Couldn't rebuild or start the editor (see the errors above)." -ForegroundColor Red; exit 1 }
docker image prune -f | Out-Null

Write-Host "SCORM Editor is up to date: http://localhost:8080" -ForegroundColor Green
