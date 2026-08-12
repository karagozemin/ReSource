#!/bin/sh
set -eu

source_dir="${ONCHAINOS_HOME:-$HOME/.onchainos}"
output_file="${1:-render-wallet.b64}"
required_files="session.json wallets.json keyring.enc machine-identity binary_identity.json"

for file in $required_files; do
  if [ ! -s "$source_dir/$file" ]; then
    echo "Missing wallet credential file: $source_dir/$file" >&2
    exit 1
  fi
done

COPYFILE_DISABLE=1 tar --no-xattrs -cz -C "$source_dir" $required_files | base64 > "$output_file"
chmod 600 "$output_file"
echo "Created $output_file. Upload it as the Render Secret File named onchainos-wallet.b64; do not commit it."
