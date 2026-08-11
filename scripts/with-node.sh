#!/usr/bin/env bash
#
# Runs an npm script on the Node version pinned in .nvmrc.
#
#   ./scripts/with-node.sh dev:vite
#
# Vite 8 bundles with rolldown, which needs Node >= 20.12 and otherwise fails
# with an opaque "node:util does not provide an export named 'styleText'".
# Editors and tooling often inherit a stale PATH from a shell started before an
# nvm upgrade, so activate the pinned version explicitly when nvm is available
# and fall through to whatever is on PATH when it is not.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-dev:vite}"
shift || true

if [ -z "${NVM_DIR:-}" ] && [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
fi

if [ -s "${NVM_DIR:-}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || echo "nvm: the version in .nvmrc is not installed — run 'nvm install'" >&2
fi

echo "Using $(node -v) / npm $(npm -v)"
exec npm run "$TARGET" -- "$@"
