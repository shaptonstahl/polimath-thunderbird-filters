#!/usr/bin/env bash
#
# Set up the local development hooks for this clone.
#
# Installs the pre-commit hooks and the webext-linter clone they call, so that
# every commit runs the same checks CI does — including ATN's automated review.
# Idempotent: safe to re-run, and it only adds what is missing.
#
# Usage: scripts/setup-dev.sh
#
# Requires: git, Node.js 20 or later (npm ships with it), pre-commit, shellcheck.
# pre-commit and shellcheck are not installed for you — the script names the
# command for your platform's package manager instead of guessing at one.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
LINTER_DIR=${WEBEXT_LINTER_DIR:-$HOME/GitHub/webext-linter}
LINTER_REPO=https://github.com/thunderbird/webext-linter.git

missing=0
if ! command -v pre-commit >/dev/null; then
    echo "error: pre-commit not found — install it first:" >&2
    echo "  pipx install pre-commit        # or: brew install pre-commit" >&2
    echo "  (any Python pip: pip install --user pre-commit)" >&2
    missing=1
fi

if ! command -v node >/dev/null; then
    echo "error: node not found — webext-linter needs Node.js 20 or later" >&2
    missing=1
else
    node_major=$(node -p 'process.versions.node.split(".")[0]')
    if [[ "$node_major" -lt 20 ]]; then
        echo "error: node $node_major is too old — webext-linter needs 20 or later" >&2
        missing=1
    fi
fi

if ((missing)); then
    exit 1
fi

if ! command -v shellcheck >/dev/null; then
    echo "warning: shellcheck not found; the shellcheck hook will fail until you install it" >&2
    echo "  sudo apt install shellcheck   # or: brew install shellcheck" >&2
fi

# ── webext-linter ─────────────────────────────────────────────────────────

if [[ -f "$LINTER_DIR/verify.js" ]]; then
    echo "webext-linter: using the existing clone at $LINTER_DIR"
else
    echo "webext-linter: cloning into $LINTER_DIR"
    mkdir -p "$(dirname "$LINTER_DIR")"
    git clone --depth 1 "$LINTER_REPO" "$LINTER_DIR"
fi

if [[ -d "$LINTER_DIR/node_modules" ]]; then
    echo "webext-linter: dependencies already installed"
elif [[ -f "$LINTER_DIR/package-lock.json" ]]; then
    npm ci --prefix "$LINTER_DIR" --no-audit --no-fund --silent
else
    npm install --prefix "$LINTER_DIR" --no-audit --no-fund --silent
fi

# ── pre-commit hooks ──────────────────────────────────────────────────────

cd "$REPO_ROOT"
pre-commit install --hook-type pre-commit --hook-type pre-push

echo ""
echo "Done. Every commit runs: version sync, shellcheck, the tests, and webext-linter."
echo "Every push runs the packaged-file/version-bump guard."
echo "Check the whole tree at once with: pre-commit run --all-files"
