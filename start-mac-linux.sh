#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer from nodejs.org, then run this script again."
  exit 1
fi
exec node server.js
