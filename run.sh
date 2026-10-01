#!/usr/bin/env bash
# One command to build and launch the spike on a Mac:  bash run.sh
# Add --dev for hot-reload while tweaking visuals.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Install it with:  brew install node   (or from https://nodejs.org), then rerun." >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "Node $major is too old; need 20 or newer (brew upgrade node)." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "Installing dependencies (first run takes a minute)..."
  npm install --no-audit --no-fund
fi

# Newer npm versions skip install scripts by default, which leaves Electron's
# app binary undownloaded. Fetch it directly if it's missing.
if [ ! -f node_modules/electron/path.txt ]; then
  echo "Downloading the Electron app binary..."
  node node_modules/electron/install.js
fi

if [ "${1:-}" = "--dev" ]; then
  exec npx electron-vite dev
fi

# Production build: this is what the latency numbers should be measured on.
npx electron-vite build
exec npx electron-vite preview --skipBuild
