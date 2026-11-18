#!/usr/bin/env sh
set -e
cd "$(dirname "$0")/.."

docker build -t pm .
if [ -n "$(docker ps -aq -f name=^pm$)" ]; then
  docker rm -f pm > /dev/null
fi
docker run -d --name pm -p 8000:8000 --env-file .env -v pm-data:/app/data pm > /dev/null
echo "Running at http://localhost:8000"
