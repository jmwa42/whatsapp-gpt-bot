#!/bin/sh
set -e

# Puppeteer flags for Railway’s containerized Chromium
export PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer"

# Launch your app
exec node index.js

