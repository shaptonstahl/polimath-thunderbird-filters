#!/usr/bin/env bash
#
# Fail if package.json and manifest.json carry different version numbers.
#
# The version lives in package.json; manifest.json is kept in sync by the npm
# `version` lifecycle hook (scripts/sync-version.js). This is the guard against
# a hand-edit to manifest.json that reintroduces drift without going through
# `npm version` / `npm run sync-version`.
#
# Usage: scripts/check-version.sh
#
# Requires: jq

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

if ! pkg_version=$(jq -r '.version' package.json); then
    echo "error: could not parse package.json" >&2
    exit 2
fi
if ! manifest_version=$(jq -r '.version' manifest.json); then
    echo "error: could not parse manifest.json" >&2
    exit 2
fi

if [[ "$pkg_version" != "$manifest_version" ]]; then
    echo "error: version mismatch — package.json is $pkg_version but manifest.json is $manifest_version" >&2
    echo "run: npm run sync-version" >&2
    exit 1
fi

echo "OK: package.json and manifest.json both at $pkg_version"
