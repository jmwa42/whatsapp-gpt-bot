#!/bin/sh
set -e

cd /app

# If playwright or whatsapp-web.js missing, reinstall
if [ ! -d node_modules/playwright ] || [ ! -d node_modules/whatsapp-web.js ]; then
  echo "🔧 Installing missing node_modules..."
  npm install --omit=dev
  npx playwright install chromium
fi

echo "🚀 Starting app..."
exec node index.js

