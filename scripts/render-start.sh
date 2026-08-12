#!/bin/sh
set -eu

mkdir -p "$HOME/.onchainos" "${DATA_DIR:-/app/storage/data}"

wallet_secret="/etc/secrets/onchainos-wallet.b64"
if [ "${EXECUTION_MODE:-demo}" = "keeperhub" ]; then
  if [ ! -s "$wallet_secret" ]; then
    echo "Missing Render secret file: onchainos-wallet.b64" >&2
    exit 1
  fi
  base64 -d "$wallet_secret" | tar -xz -C "$HOME/.onchainos"
  chmod 600 "$HOME/.onchainos"/*
  wallet_status="$(onchainos wallet status)"
  printf '%s' "$wallet_status" | node -e 'let value=""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => { const data=JSON.parse(value); if (!data.ok || !data.data?.loggedIn) process.exit(1); });'
fi

exec npm start
