#!/usr/bin/env sh
if [ -n "$(docker ps -aq -f name=^pm$)" ]; then
  docker rm -f pm > /dev/null
fi
echo "Stopped"
