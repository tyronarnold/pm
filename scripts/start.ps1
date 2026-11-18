Set-Location (Join-Path $PSScriptRoot "..")

docker build -t pm .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (docker ps -aq -f name=^pm$) {
  docker rm -f pm | Out-Null
}
docker run -d --name pm -p 8000:8000 --env-file .env -v pm-data:/app/data pm | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "Running at http://localhost:8000"
