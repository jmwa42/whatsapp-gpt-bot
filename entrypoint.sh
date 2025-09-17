#!/bin/sh
set -e

# Where the Railway volume will be mounted (set in Railway env or default)
WA_PATH=${WA_DATA_PATH:-/app/.wwebjs_auth}

# ensure path exists
mkdir -p "$WA_PATH"

# try to chown - ignore errors if not allowed
chown -R node:node "$WA_PATH" || true

echo "✅ Ensured WA_PATH exists and attempted chown: $WA_PATH"

# start the app (exec so signals pass through)
exec node index.js
