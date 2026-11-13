#!/usr/bin/env bash
#
# Bump the version and commit it, in one step.
#
# `npm version` alone is not enough: .npmrc sets git-tag-version=false so that CI
# stays the only tagger, and npm then skips its commit as well — leaving the two
# version files changed but uncommitted. This does the bump and the commit, so a
# release is one command and one commit.
#
# Usage: scripts/bump-version.sh patch|minor|major|<explicit version>
#
# Then push to main: CI builds the XPI and creates the tag and GitHub release.
#
# Requires: git, npm, jq.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

if [[ $# -ne 1 ]]; then
    echo "usage: $0 patch|minor|major|<explicit version>" >&2
    exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
    echo "error: the working tree has uncommitted changes — commit or stash them first" >&2
    exit 2
fi

npm version "$1" >/dev/null
version=$(jq -r '.version' package.json)

git add package.json manifest.json
git commit -q -m "$version"

echo "Committed $version. Push to main to build and release it:"
echo "  git push origin main"
