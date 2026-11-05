#!/usr/bin/env bash
# Regenerates the addons.thunderbird.net listing screenshots in assets/screenshots/.
# Serves options.html with a mock `messenger` (mock.js) and a state driver (setup.js),
# then captures each state with headless Chrome. Requires python3 and google-chrome.
# 00-entry-point.png is a real Thunderbird window, captured by hand; this script leaves it alone.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
here="$repo/scripts/screenshot-harness"
out="$repo/assets/screenshots"
port="${PORT:-8124}"
work="$(mktemp -d)"
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$work"' EXIT

cp "$repo"/{options.js,options.css,filter-engine.js,confusables-data.js} "$here"/{mock.js,setup.js} "$work"/
cp -r "$repo/icons" "$work"/
# mock.js must load before options.js; setup.js after it.
sed -e 's#<script src="confusables-data.js"></script>#<script src="mock.js"></script>\n&#' \
    -e 's#<script src="options.js"></script>#&\n<script src="setup.js"></script>#' \
    "$repo/options.html" > "$work/options.html"

python3 -m http.server "$port" --directory "$work" >/dev/null 2>&1 &
server_pid=$!
sleep 1

shot() {
    local name="$1" query="$2"
    timeout 40 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
        --user-data-dir="$work/profile-$name" --window-size=1280,800 \
        --virtual-time-budget=4000 --screenshot="$out/$name.png" \
        "http://localhost:$port/options.html?$query" >/dev/null 2>&1
    echo "wrote $out/$name.png"
}

mkdir -p "$out"
shot 01-filter-list "shot=list"
shot 02-editor-regex-and-not "shot=editor&idx=1"
shot 03-editor-confusables "shot=editor&idx=0"
shot 04-monitored-folders "shot=monitored"
shot 05-dry-run "shot=run&dry=1"
shot 06-instructions "shot=help"
