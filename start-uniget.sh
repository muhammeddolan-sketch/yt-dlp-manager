#!/bin/bash
cd "$(dirname "$0")"
# Kill existing port 3000 just in case
fuser -k 3000/tcp 2>/dev/null
./node_modules/.bin/electron . "$@"
