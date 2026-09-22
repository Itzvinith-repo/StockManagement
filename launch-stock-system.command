#!/bin/zsh
set -u

cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ ! -d "node_modules" ]; then
  echo "Installing app dependencies..."
  npm install --no-fund --no-audit
fi

if ! pgrep -f "vite --host 0.0.0.0" >/dev/null 2>&1; then
  echo "Starting stock management app..."
  npm run dev -- --host 0.0.0.0 > /tmp/stockmanagement.log 2>&1 &
fi

for i in {1..60}; do
  if curl -fsS http://localhost:5173 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

open -a Safari http://localhost:5173
