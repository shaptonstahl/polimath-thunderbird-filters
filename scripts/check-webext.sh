#!/usr/bin/env bash
#
# Review the add-on with Thunderbird's webext-linter.
#
# ATN runs https://github.com/thunderbird/webext-linter as part of its automated
# review: it is the tool that reports "The following permissions are required at
# the locations listed, but are not declared in manifest.json". Running it before
# a submission turns that rejection into a local failure.
#
# The review target is the packaged file set from scripts/xpi-files.txt, staged
# into a temp folder, not the repository. Two reasons: the linter reports every
# file a folder holds but the manifest does not reference as "possibly unused"
# (which the repo, with docs/, test/ and .git/, always would), and it writes its
# cache and sweep folders into the directory it runs from.
#
# Usage: scripts/check-webext.sh
#
# Requires: Node.js 20 or later, and a clone of the linter with its dependencies
# installed. Set WEBEXT_LINTER_DIR to point at it; the default is
# ~/GitHub/webext-linter.
#
# Exit codes: 0 no error-severity findings · 1 the add-on would be rejected ·
# 2 the linter could not run.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
LINTER_DIR=${WEBEXT_LINTER_DIR:-$HOME/GitHub/webext-linter}
CACHE_DIR=${XDG_CACHE_HOME:-$HOME/.cache}/webext-linter
REPORT=$CACHE_DIR/last-report.txt

if [[ ! -f "$LINTER_DIR/verify.js" ]]; then
    echo "error: webext-linter not found at $LINTER_DIR" >&2
    echo "clone and install it, or point WEBEXT_LINTER_DIR at an existing clone:" >&2
    echo "  git clone https://github.com/thunderbird/webext-linter.git ~/GitHub/webext-linter" >&2
    echo "  npm install --prefix ~/GitHub/webext-linter" >&2
    exit 2
fi
if [[ ! -d "$LINTER_DIR/node_modules" ]]; then
    echo "error: $LINTER_DIR has no node_modules — run: npm install --prefix $LINTER_DIR" >&2
    exit 2
fi
if ! command -v node >/dev/null; then
    echo "error: node not found; webext-linter needs Node.js 20 or later" >&2
    exit 2
fi

# ── Stage the packaged file set ───────────────────────────────────────────

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/webext-linter-stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/xpi"

while IFS= read -r path; do
    [[ -z "$path" || "$path" == "#"* ]] && continue
    if [[ ! -e "$REPO_ROOT/$path" ]]; then
        echo "error: $path is listed in scripts/xpi-files.txt but does not exist" >&2
        exit 2
    fi
    cp -a "$REPO_ROOT/$path" "$STAGE/xpi/"
done < "$SCRIPT_DIR/xpi-files.txt"

# ── Run the review ────────────────────────────────────────────────────────
# The run happens inside the cache dir so the linter's own WEBEXT-LINTER-CACHE
# persists between runs (schemas are re-fetched only when a day old) and never
# lands in the repository.

mkdir -p "$CACHE_DIR"
cd "$CACHE_DIR"

status=0
node "$LINTER_DIR/verify.js" "$STAGE/xpi" > "$REPORT" 2>&1 || status=$?

case "$status" in
    0)
        # Warnings do not fail a review but ATN asks for them to be fixed, so
        # surface them without blocking the commit.
        if grep -q '^We kindly ask you to resolve' "$REPORT"; then
            echo "webext-linter: no errors, but ATN would ask for these fixes:" >&2
            sed -n '/^We kindly ask you to resolve/,/^You can run an automated review/p' "$REPORT" |
                sed '$d' >&2
            echo "full report: $REPORT" >&2
        else
            echo "OK: webext-linter found no issues"
        fi
        ;;
    1)
        echo "webext-linter rejected the add-on — ATN would reject it too:" >&2
        sed -n '/^── Found Issues ──/,/^── Standard Code Review ──/p' "$REPORT" |
            sed '$d' >&2
        echo "full report: $REPORT" >&2
        exit 1
        ;;
    *)
        echo "error: webext-linter did not complete (exit $status); see $REPORT" >&2
        tail -20 "$REPORT" >&2
        exit 2
        ;;
esac
