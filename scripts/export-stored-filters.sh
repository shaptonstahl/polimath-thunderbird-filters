#!/usr/bin/env bash
set -euo pipefail

# ── Usage ──────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]
Export Polimath Filters rules from a Thunderbird profile without running Thunderbird.

Options:
  -o FILE      Output file (default: polimath-filters-YYYY-MM-DD.json)
  -p PROFILE   Thunderbird profile path (default: auto-detect from profiles.ini)
  -l, --list   List filter names only, don't export
  -h, --help   Show this help
EOF
    exit 0
}

# ── Parse args ─────────────────────────────────────────────────────────────

OUTPUT=""
PROFILE=""
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) OUTPUT="$2"; shift 2 ;;
        -p) PROFILE="$2"; shift 2 ;;
        -l|--list) LIST_ONLY=true; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1" >&2; usage ;;
    esac
done

# ── Detect profile ─────────────────────────────────────────────────────────

if [[ -z "$PROFILE" ]]; then
    PROFILES_INI="$HOME/.thunderbird/profiles.ini"
    if [[ ! -f "$PROFILES_INI" ]]; then
        echo "Error: profiles.ini not found at $PROFILES_INI" >&2
        exit 1
    fi

    PROFILE_REL=$(awk -F= '
        BEGIN { in_install = 0; found = 0 }
        /^\[Install/  { in_install = 1; next }
        /^Default=/   { if (in_install && !found) { path = $2; found = 1; exit } }
        /^\[/         { in_install = 0 }
        END {
            if (!found) {
                while (getline < FILENAME) {
                    if (/^Default=1/) { is_default = 1 }
                    if (/^Path=/ && is_default) { print $2; exit }
                }
            } else {
                print path
            }
        }
    ' "$PROFILES_INI")

    if [[ -z "$PROFILE_REL" ]]; then
        PROFILE_REL=$(awk -F= '/^Path=/ { print $2; exit }' "$PROFILES_INI")
    fi

    if [[ -z "$PROFILE_REL" ]]; then
        echo "Error: Could not detect any Thunderbird profile." >&2
        exit 1
    fi

    if [[ "$PROFILE_REL" =~ ^/ ]]; then
        PROFILE="$PROFILE_REL"
    else
        PROFILE="$HOME/.thunderbird/$PROFILE_REL"
    fi
fi

if [[ ! -d "$PROFILE" ]]; then
    echo "Error: Profile directory not found: $PROFILE" >&2
    exit 1
fi

# ── Resolve output path and extension version ──────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/../manifest.json"
if [[ -f "$MANIFEST" ]]; then
    EXT_VERSION=$(grep -o '"version": *"[^"]*"' "$MANIFEST" | head -1 | cut -d'"' -f4)
else
    EXT_VERSION="unknown"
fi

if [[ -z "${OUTPUT:-}" ]]; then
    DATESTR=$(date -u +%Y-%m-%d)
    OUTPUT="$PWD/polimath-filters-$DATESTR.json"
fi

# ── Delegate extraction to python3 ─────────────────────────────────────────

export TB_PROFILE="$PROFILE"
export TB_OUTPUT="$OUTPUT"
export TB_LIST_ONLY="$LIST_ONLY"
export TB_EXT_VERSION="$EXT_VERSION"

python3 << 'PYEOF'
import sqlite3, json, os, sys

profile = os.environ["TB_PROFILE"]
output_file = os.environ["TB_OUTPUT"]
list_only = os.environ["TB_LIST_ONLY"] == "true"
ext_version = os.environ["TB_EXT_VERSION"]

# ── Find the extension storage database ────────────────────────────────────

found_value = None
found_db = None

storage_dir = os.path.join(profile, "storage", "default")
if os.path.isdir(storage_dir):
    for entry in sorted(os.listdir(storage_dir)):
        if not entry.startswith("moz-extension+++"):
            continue
        db_path = os.path.join(storage_dir, entry, "storage.sqlite")
        if not os.path.isfile(db_path):
            continue
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            row = conn.execute("SELECT value FROM data WHERE key = 'filters'").fetchone()
            conn.close()
            if row and row[0]:
                if row[0].strip().startswith("["):
                    found_value = row[0]
                    found_db = db_path
                    break
        except sqlite3.Error:
            continue

if not found_value:
    old_db = os.path.join(profile, "storage.sqlite")
    if os.path.isfile(old_db):
        try:
            conn = sqlite3.connect(f"file:{old_db}?mode=ro", uri=True)
            row = conn.execute("SELECT value FROM webappsstore2 WHERE key = 'filters'").fetchone()
            conn.close()
            if row and row[0] and row[0].strip().startswith("["):
                found_value = row[0]
                found_db = old_db
        except sqlite3.Error:
            pass

if not found_value:
    print("Error: No Polimath Filters data found in this profile.", file=sys.stderr)
    print("Try running Thunderbird and opening the extension Options page first to ensure filters are saved.", file=sys.stderr)
    sys.exit(1)

print(f"Found filters in: {found_db}", file=sys.stderr)

# ── Parse and validate ─────────────────────────────────────────────────────

filters = json.loads(found_value)
if not isinstance(filters, list):
    print("Error: stored value is not a list", file=sys.stderr)
    sys.exit(1)
for f in filters:
    if not all(k in f for k in ("name", "enabled", "condition", "actions")):
        print(f"Error: filter missing required fields: {f.get('name', '(unnamed)')}", file=sys.stderr)
        sys.exit(1)

if not filters:
    print("Warning: No filters found (empty list).", file=sys.stderr)

# ── List mode ──────────────────────────────────────────────────────────────

if list_only:
    if not filters:
        print("No filters stored.")
    else:
        print()
        print("Stored filters:")
        print("===============")
        for f in filters:
            status = "enabled" if f.get("enabled") else "disabled"
            print(f"  [{status}] {f.get('name', '(unnamed)')}")
    sys.exit(0)

# ── Generate export ────────────────────────────────────────────────────────

from datetime import datetime, timezone

exported_at = datetime.now(timezone.utc).isoformat()

envelope = {
    "exportedBy": "Polimath Filters",
    "extensionVersion": ext_version,
    "exportedAt": exported_at,
    "exportMethod": "offline-sqlite-export",
    "filterCount": len(filters),
    "filters": filters,
}

with open(output_file, "w") as f:
    json.dump(envelope, f, indent=2)
    f.write("\n")

print(f"Exported {len(filters)} filters to: {output_file}")
PYEOF
