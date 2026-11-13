#!/usr/bin/env bash
#
# Fail when packaged files change on main without a version bump.
#
# CI publishes whatever version package.json carries, and only when that version
# differs from the last release tag. A change to a shipped file that lands
# without a bump is therefore a change users never receive — silently, which is
# exactly how v1.10.0 shipped without confusables-data.js.
#
# This asserts the inverse: since the last release tag, either no packaged file
# has changed, or the version has.
#
# Usage: scripts/check-release-bump.sh
#
# Requires: git with tags available (CI checks out with fetch-depth: 0), jq.
# With no reachable tag — a shallow clone, a fork PR — there is nothing to
# compare against and the check passes.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

if ! latest=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null); then
    echo "no release tag reachable; skipping the packaged-file check"
    exit 0
fi

if ! version=$(jq -r '.version' package.json); then
    echo "error: could not read package.json" >&2
    exit 2
fi

if [[ "$version" != "${latest#v}" ]]; then
    echo "OK: version $version is newer than the last release $latest"
    exit 0
fi

mapfile -t shipped < <(grep -vE '^[[:space:]]*(#|$)' scripts/xpi-files.txt)
if [[ ${#shipped[@]} -eq 0 ]]; then
    echo "error: scripts/xpi-files.txt lists no files" >&2
    exit 2
fi

if git diff --quiet "$latest" -- "${shipped[@]}"; then
    echo "OK: no packaged file changed since $latest"
    exit 0
fi

echo "error: packaged files changed since $latest, but the version is still $version." >&2
echo "Those changes would never reach users. Bump the version:" >&2
echo "  scripts/bump-version.sh patch   # or minor / major" >&2
echo "" >&2
git diff --stat "$latest" -- "${shipped[@]}" >&2
exit 1
