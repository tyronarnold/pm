if (docker ps -aq -f name=^pm$) {
  docker rm -f pm | Out-Null
}
Write-Output "Stopped"
