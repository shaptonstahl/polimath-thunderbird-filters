#!/usr/bin/env bash
#
# Verify that a built .xpi contains every file the extension references.
#
# The packaging step in .github/workflows/ci.yml is a hand-maintained list of
# paths. This script is the check that the list is complete: it collects every
# asset referenced by manifest.json and by any HTML page the manifest points
# at, then asserts each one is present in the archive.
#
# Usage: scripts/verify-xpi.sh path/to/polimath-filters-X.Y.Z.xpi
#
# Requires: jq, unzip

set -euo pipefail

XPI=${1:-}
if [[ -z "$XPI" ]]; then
    echo "usage: $0 <path-to-xpi>" >&2
    exit 2
fi
if [[ ! -f "$XPI" ]]; then
    echo "error: no such file: $XPI" >&2
    exit 2
fi
# Resolve before the cd below, so a relative path still works from any cwd.
XPI="$(cd "$(dirname "$XPI")" && pwd)/$(basename "$XPI")"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

# ── Index the archive contents ────────────────────────────────────────────

if ! packed_list=$(unzip -Z1 "$XPI"); then
    echo "error: could not read archive: $XPI" >&2
    exit 2
fi

declare -A PACKED
while IFS= read -r entry; do
    PACKED["$entry"]=1
done <<< "$packed_list"

# ── Collect referenced paths ──────────────────────────────────────────────

# Assignments are checked separately rather than piped straight into the read
# loops: a jq failure on a malformed manifest would otherwise leave REFS empty
# and the script would report success having verified nothing.

# From manifest.json: background scripts, options page, icons, content scripts.
if ! manifest_refs=$(jq -r '
  [
    (.background.scripts // [])[],
    (.background.page // empty),
    (.options_ui.page // empty),
    (.icons // {} | to_entries[].value),
    ((.content_scripts // [])[] | (.js // [])[], (.css // [])[])
  ] | .[]
' manifest.json); then
    echo "error: could not parse manifest.json" >&2
    exit 2
fi

REFS=()
while IFS= read -r ref; do
    [[ -n "$ref" ]] && REFS+=("$ref")
done <<< "$manifest_refs"

if [[ ${#REFS[@]} -eq 0 ]]; then
    echo "error: manifest.json references no files — refusing to report success." >&2
    exit 2
fi

# From each HTML page the manifest references: src= and href= attributes.
if ! page_list=$(jq -r '[(.options_ui.page // empty), (.background.page // empty)] | .[]' manifest.json); then
    echo "error: could not parse manifest.json" >&2
    exit 2
fi

PAGES=()
while IFS= read -r page; do
    [[ -n "$page" ]] && PAGES+=("$page")
done <<< "$page_list"

for page in ${PAGES+"${PAGES[@]}"}; do
    [[ -f "$page" ]] || continue
    page_dir=$(dirname "$page")
    while IFS= read -r ref; do
        # Skip absolute URLs, protocol-relative URLs, data: URIs, and fragments.
        case "$ref" in
            http://*|https://*|//*|data:*|\#*|"") continue ;;
            *) ;;
        esac
        # Resolve relative to the page's directory.
        if [[ "$page_dir" == "." ]]; then
            REFS+=("$ref")
        else
            REFS+=("$page_dir/$ref")
        fi
    done < <(grep -oE '(src|href)="[^"]*"' "$page" | sed -E 's/^(src|href)="//; s/"$//')
done

# ── Check each reference against the archive ──────────────────────────────

declare -A SEEN
MISSING=0
CHECKED=0

for ref in ${REFS+"${REFS[@]}"}; do
    [[ -n "${SEEN[$ref]:-}" ]] && continue
    SEEN["$ref"]=1
    CHECKED=$((CHECKED + 1))
    if [[ -z "${PACKED[$ref]:-}" ]]; then
        echo "MISSING from xpi: $ref" >&2
        MISSING=$((MISSING + 1))
    fi
done

if [[ "$MISSING" -gt 0 ]]; then
    echo "" >&2
    echo "error: $MISSING of $CHECKED referenced file(s) are not in $XPI." >&2
    echo "Add them to the zip step in .github/workflows/ci.yml." >&2
    exit 1
fi

echo "OK: all $CHECKED referenced file(s) present in $(basename "$XPI")."
