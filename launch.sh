#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export NPM_CONFIG_CACHE="$SCRIPT_DIR/.npm-cache"
mkdir -p "$NPM_CONFIG_CACHE"

install_node_if_missing() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi

  echo "Node.js/npm not found. Attempting to install Node.js LTS..."

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm nodejs npm
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper --non-interactive install nodejs npm
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "ERROR: No supported package manager found to install Node.js/npm automatically."
    echo "Install Node.js LTS manually from https://nodejs.org/ and rerun this script."
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: Node.js/npm installation did not complete successfully."
    exit 1
  fi
}

echo "[1/3] Checking Node.js prerequisites..."
install_node_if_missing

echo "[2/3] Installing project dependencies (including future added packages)..."
if [[ -f package-lock.json ]]; then
  if ! npm ci --include=dev --include=optional; then
    echo "npm ci failed (often lockfile drift). Retrying with npm install..."
    npm install --include=dev --include=optional
  fi
else
  npm install --include=dev --include=optional
fi

echo "Verifying dependency tree health..."
if ! npm ls --depth=0 >/dev/null 2>&1; then
  echo "Dependency tree has issues. Repairing with npm install..."
  npm install --include=dev --include=optional
fi

echo "[3/3] Launching development server..."
npm run dev
