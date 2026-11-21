#!/usr/bin/env bash
set -euo pipefail

# ── Usage ──────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]
Export Polimath Filters rules from a Thunderbird profile, even when the add-on
cannot be opened. Works while Thunderbird is running (it reads a copy).

Options:
  -o FILE      Output file (default: polimath-filters-YYYY-MM-DD.json)
  -p PROFILE   Thunderbird profile path (default: auto-detect from profiles.ini in
               ~/.thunderbird, the snap and flatpak locations, macOS and Windows)
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

# ── Resolve output path ────────────────────────────────────────────────────

if [[ -z "${OUTPUT:-}" ]]; then
    OUTPUT="$PWD/polimath-filters-$(date -u +%Y-%m-%d).json"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Delegate extraction to python3 ─────────────────────────────────────────

export TB_PROFILE="$PROFILE"
export TB_OUTPUT="$OUTPUT"
export TB_LIST_ONLY="$LIST_ONLY"
export TB_MANIFEST="$SCRIPT_DIR/../manifest.json"

python3 -I << 'PYEOF'
import configparser, glob, json, os, re, shutil, sqlite3, struct, sys, tempfile
from datetime import datetime, timezone

EXT_ID = "polimath-filters@haptonstahl.org"
home = os.path.expanduser("~")
explicit_profile = os.environ["TB_PROFILE"]
output_file = os.environ["TB_OUTPUT"]
list_only = os.environ["TB_LIST_ONLY"] == "true"

# ── Profile discovery ──────────────────────────────────────────────────────

ROOTS = [
    os.path.join(home, ".thunderbird"),
    os.path.join(home, "snap", "thunderbird", "common", ".thunderbird"),
    os.path.join(home, ".var", "app", "org.mozilla.Thunderbird", ".thunderbird"),
    os.path.join(home, "Library", "Thunderbird"),
    os.path.join(os.environ.get("APPDATA", ""), "Thunderbird"),
]

def profiles_in(root):
    ini = os.path.join(root, "profiles.ini")
    if not os.path.isfile(ini):
        return []
    cp = configparser.RawConfigParser()
    cp.read(ini)
    defaults, others = [], []
    for section in cp.sections():
        s = cp[section]
        if section.startswith("Install") and "Default" in s:
            defaults.append(os.path.join(root, s["Default"]))
        elif section.startswith("Profile") and "Path" in s:
            path = s["Path"] if s.get("IsRelative", "1") == "0" else os.path.join(root, s["Path"])
            (defaults if s.get("Default") == "1" else others).append(path)
    seen, ordered = set(), []
    for p in defaults + others:
        if p not in seen and os.path.isdir(p):
            seen.add(p)
            ordered.append(p)
    return ordered

# ── storage.local decoding (IndexedDB: snappy + SpiderMonkey structured clone) ──

def snappy_decompress(buf):
    pos, length, shift = 0, 0, 0
    while True:
        b = buf[pos]; pos += 1
        length |= (b & 0x7f) << shift
        if b < 0x80:
            break
        shift += 7
    out = bytearray()
    while pos < len(buf):
        tag = buf[pos]; pos += 1
        kind = tag & 3
        if kind == 0:
            n = tag >> 2
            if n >= 60:
                extra = n - 59
                n = int.from_bytes(buf[pos:pos + extra], "little"); pos += extra
            n += 1
            out += buf[pos:pos + n]; pos += n
            continue
        if kind == 1:
            n = ((tag >> 2) & 7) + 4
            off = ((tag >> 5) << 8) | buf[pos]; pos += 1
        elif kind == 2:
            n = (tag >> 2) + 1
            off = int.from_bytes(buf[pos:pos + 2], "little"); pos += 2
        else:
            n = (tag >> 2) + 1
            off = int.from_bytes(buf[pos:pos + 4], "little"); pos += 4
        for _ in range(n):
            out.append(out[-off])
    if len(out) != length:
        raise ValueError("snappy length mismatch")
    return bytes(out)

class StructuredClone:
    NULL, UNDEFINED, BOOLEAN, INT32, STRING = 0xFFFF0000, 0xFFFF0001, 0xFFFF0002, 0xFFFF0003, 0xFFFF0004
    ARRAY, OBJECT, END_OF_KEYS = 0xFFFF0007, 0xFFFF0008, 0xFFFF0013
    HEADER, FLOAT_MAX = 0xFFF10000, 0xFFF00000

    def __init__(self, data):
        self.b, self.p = data, 0

    def _pair(self):
        data, tag = struct.unpack_from("<II", self.b, self.p)
        self.p += 8
        return tag, data

    def _string(self, data):
        n, latin1 = data & 0x7FFFFFFF, bool(data & 0x80000000)
        size = n if latin1 else 2 * n
        raw = self.b[self.p:self.p + size]
        self.p += (size + 7) & ~7
        return raw.decode("latin-1") if latin1 else raw.decode("utf-16-le")

    def read(self):
        tag, data = self._pair()
        if tag == self.HEADER:
            return self.read()
        if tag < self.FLOAT_MAX:
            d = struct.unpack_from("<d", self.b, self.p - 8)[0]
            return int(d) if d.is_integer() else d
        if tag in (self.NULL, self.UNDEFINED):
            return None
        if tag == self.BOOLEAN:
            return bool(data)
        if tag == self.INT32:
            return struct.unpack("<i", struct.pack("<I", data))[0]
        if tag == self.STRING:
            return self._string(data)
        if tag in (self.OBJECT, self.ARRAY):
            obj = [None] * data if tag == self.ARRAY else {}
            while struct.unpack_from("<II", self.b, self.p)[1] != self.END_OF_KEYS:
                key, value = self.read(), self.read()
                if tag == self.ARRAY:
                    obj[int(key)] = value
                else:
                    obj[str(key)] = value
            self._pair()
            return obj
        raise ValueError("unsupported structured-clone tag 0x%08x" % tag)

def idb_key(raw):
    raw = bytes(raw)
    # Gecko encodes string keys as 0x30 followed by each character + 1.
    return "".join(chr(c - 1) for c in raw[1:]) if raw[:1] == b"0" else None

def read_idb(idb_dir):
    dbs = glob.glob(os.path.join(idb_dir, "*.sqlite"))
    if not dbs:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        # Thunderbird may hold the database open; read a copy, WAL included.
        for f in glob.glob(dbs[0] + "*"):
            shutil.copy2(f, tmp)
        conn = sqlite3.connect(os.path.join(tmp, os.path.basename(dbs[0])))
        values = {}
        for key, data, file_ids in conn.execute("SELECT key, data, file_ids FROM object_data"):
            name = idb_key(key)
            if name is None:
                continue
            if file_ids:
                raise ValueError(f"'{name}' is stored outside the database; open Thunderbird and use Export instead")
            values[name] = StructuredClone(snappy_decompress(bytes(data))).read()
        conn.close()
    return values

def extension_uuid(profile):
    prefs = os.path.join(profile, "prefs.js")
    if not os.path.isfile(prefs):
        return None
    with open(prefs, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"extensions.webextensions.uuids"' in line:
                m = re.search(re.escape(EXT_ID) + r'\\?":\\?"([0-9a-f-]{36})', line)
                if m:
                    return m.group(1)
    return None

def installed_version(profile):
    try:
        with open(os.path.join(profile, "extensions.json"), encoding="utf-8") as f:
            for addon in json.load(f).get("addons", []):
                if addon.get("id") == EXT_ID:
                    return addon.get("version")
    except (OSError, ValueError):
        pass
    return None

def load_storage(profile):
    """Return (description, values) for the first storage format that has filters."""
    uuid = extension_uuid(profile)
    if uuid:
        base = os.path.join(profile, "storage", "default", f"moz-extension+++{uuid}")
        for idb_dir in (base + "^userContextId=4294967295/idb", base + "/idb"):
            values = read_idb(idb_dir)
            if values and isinstance(values.get("filters"), list):
                return idb_dir, values
    legacy = os.path.join(profile, "browser-extension-data", EXT_ID, "storage.js")
    if os.path.isfile(legacy):
        with open(legacy, encoding="utf-8") as f:
            values = json.load(f)
        if isinstance(values.get("filters"), list):
            return legacy, values
    return None, None

# ── Find the data ──────────────────────────────────────────────────────────

candidates = [explicit_profile] if explicit_profile else [p for root in ROOTS for p in profiles_in(root)]
if not candidates:
    print("Error: no Thunderbird profile found. Pass one with -p.", file=sys.stderr)
    sys.exit(1)

found_profile = found_source = values = None
errors = []
for profile in candidates:
    if not os.path.isdir(profile):
        errors.append(f"{profile}: not a directory")
        continue
    try:
        source, vals = load_storage(profile)
    except (sqlite3.Error, ValueError, OSError) as err:
        errors.append(f"{profile}: {err}")
        continue
    if vals is not None:
        found_profile, found_source, values = profile, source, vals
        break

if values is None:
    print("Error: no Polimath Filters data found.", file=sys.stderr)
    print("Profiles checked:", file=sys.stderr)
    for p in candidates:
        print(f"  {p}", file=sys.stderr)
    for e in errors:
        print(f"  {e}", file=sys.stderr)
    print("If you removed the add-on, Thunderbird deleted this data; restore from a backup or an export.", file=sys.stderr)
    sys.exit(1)

print(f"Found filters in: {found_source}", file=sys.stderr)
filters = values["filters"]

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

version = installed_version(found_profile)
if not version:
    try:
        with open(os.environ["TB_MANIFEST"], encoding="utf-8") as f:
            version = json.load(f).get("version", "unknown")
    except (OSError, ValueError):
        version = "unknown"

envelope = {
    "exportedBy": "Polimath Filters",
    "extensionVersion": version,
    "exportedAt": datetime.now(timezone.utc).isoformat(),
    "exportMethod": "offline-profile-export",
    "filterCount": len(filters),
    "filters": filters,
}
if isinstance(values.get("schemaVersion"), int):
    envelope["schemaVersion"] = values["schemaVersion"]
if isinstance(values.get("monitoredFolders"), list):
    envelope["monitoredFolders"] = values["monitoredFolders"]

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(envelope, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Exported {len(filters)} filters to: {output_file}")
PYEOF
