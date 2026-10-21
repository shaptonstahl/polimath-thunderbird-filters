# Polimath Filters

A Thunderbird MailExtension that replaces the built-in filter editor with a more powerful one. Conditions can be any boolean combination of AND, OR, and NOT groups, and any condition can match against a regular expression.

## Features

- **Arbitrary boolean logic** — nest AND, OR, and NOT groups to any depth
- **Regular expression matching** — full ECMAScript (JavaScript) regex syntax
- **Case-sensitivity toggle** — per-condition, defaults to case-insensitive
- **Nine condition fields** — Subject, From, From name, To, CC, BCC, Body, Has attachment, Sender in address book
- **Unicode confusable detection** — detect homoglyph/lookalike characters or match strings that are visually similar (e.g. Cyrillic "а" vs Latin "a")
- **Eight actions** — Move, Mark read/unread, Add star, Add/remove tag, Mark as junk, Delete
- **Import / Export** — share filters between Thunderbird profiles or back them up as JSON files
- **Offline export** — extract filters directly from the profile when Thunderbird isn't running (`scripts/export-stored-filters.sh`)
- **Automatic filtering** — runs on new mail in any folder you choose to monitor
- **Folder scoping** — each filter applies to a subset of the monitored folders
- **Manual run** — apply any filter (or all filters) to an existing folder
- **Dry run** — preview how many messages a filter would affect without changing anything
- **Smart folder scan** — messages moved or deleted by an earlier filter are skipped by later ones; full message content is fetched in parallel batches only when needed

## Installation

### From addons.thunderbird.net

The extension is [submitted to addons.thunderbird.net](https://addons.thunderbird.net/en-US/thunderbird/addon/polimath-filters/) and **awaiting review**. Once it is approved this will be the recommended route, since it brings automatic updates. Until then, use a release XPI.

### From a release XPI

1. Download the latest `.xpi` from the [Releases page](https://github.com/shaptonstahl/polimath-thunderbird-filters/releases).
2. Open Thunderbird.
3. Open **Tools → Add-on Manager** (or press `Ctrl+Shift+A`).
4. Click the gear icon and choose **Install Add-on From File…**.
5. Select the downloaded `.xpi`.

This survives a restart. It will not auto-update until the add-on is approved on addons.thunderbird.net, so check the Releases page for new versions.

### As a temporary add-on

For development, or to try a change without packaging it:

1. Clone this repository.
2. Open **Tools → Add-on Manager** (`Ctrl+Shift+A`).
3. Click the gear icon and choose **Debug Add-ons**.
4. Click **Load Temporary Add-on…** and select `manifest.json` from the repository root.

The extension unloads when Thunderbird restarts.

> Don't hand-roll an XPI with `zip -r polimath-filters.xpi .` — that sweeps in `test/`, `docs/`, and `.github/`, and it is easy to omit a file the manifest needs. Releases are built and verified by CI; see [Releases and packaging](#releases-and-packaging).

## Usage

Open the options page via **Tools → Add-on Options → Polimath Filters**, or click the gear icon next to the extension in the Add-on Manager.

### Creating a filter

1. Click **+ New Filter**.
2. Give the filter a name.
3. Optionally restrict the filter to one or more monitored folders (see [Folder scoping](#folder-scoping)).
4. Build a condition tree (see below).
5. Add one or more actions.
6. Click **Save**.

Filters are evaluated in list order. For automatic new-mail filtering, the first matching filter wins and later filters are skipped for that message.

### Building a condition tree

The root node is always an AND or OR group. Inside any group you can:

| Button | What it does |
|---|---|
| **Switch to OR / AND** | Toggle the group type |
| **+ Condition** | Add a leaf condition to this group |
| **+ Group** | Add a nested AND group inside this group |
| **Wrap in NOT** | Surround this node with a NOT |
| **Unwrap** | Remove the NOT wrapper, keeping its child |
| **Duplicate** | Insert an identical copy of this group immediately after it |
| **×** | Delete this node (not available on the root) |

A **NOT** node inverts exactly one child, which can itself be any group or condition.

**Example** — match invoices not from your own domain:

```
AND
├── Subject  contains  "invoice"
└── NOT
    └── From  ends with  "@mycompany.com"
```

### Condition fields and operators

**Fields**

| Field | What is matched |
|---|---|
| Subject | The email subject line |
| From | The full sender field (name and address) |
| From name | The display name only, extracted from `Name <addr>` format; empty if sender is address-only |
| To | All To: recipients joined with `, ` |
| CC | All CC: recipients (requires reading full message) |
| BCC | All BCC: recipients (requires reading full message) |
| Body | Full plain-text body; HTML tags are stripped (requires reading full message) |
| Has attachment | `yes` or `no` |
| Sender in address book | `in address book` or `not in address book` — checks the sender's email against all of your Thunderbird address books, including remote/CardDAV sources like Google Contacts |

> CC, BCC, and Body conditions trigger a full message download. For large folders, place these conditions inside an AND group after cheaper header conditions so short-circuit evaluation can skip the download for non-matching messages.

**Operators** (not available for Has attachment or Sender in address book)

| Operator | Behaviour |
|---|---|
| contains | Substring match |
| does not contain | Substring absent |
| is | Exact equality |
| is not | Exact inequality |
| starts with | Prefix match |
| ends with | Suffix match |
| matches regex | ECMAScript regular expression — see [Regex](#regex) |
| has confusable character | True if the field contains any non-ASCII Unicode character that looks like an ASCII character (e.g. Cyrillic "а" → Latin "a"). No value input needed. |
| confusable with | True if the field, after replacing lookalike characters with their ASCII equivalents (skeletonization), contains the given value. Useful for catching homoglyph-based phishing (e.g. "pаypal" with Cyrillic "а" matches "paypal"). |

**Aa toggle** — Each condition has a small **Aa** button. When grey (default) the match is case-insensitive. When blue it is case-sensitive.

### Actions

| Action | Details |
|---|---|
| Move to folder | Pick any folder from the dropdown |
| Mark as read | Sets the read flag |
| Mark as unread | Clears the read flag |
| Add star | Flags the message with a star |
| Add tag | Select a tag from your Thunderbird tag list |
| Remove tag | Select a tag to remove |
| Mark as junk | Moves to Junk if Thunderbird is configured to do so |
| Delete | Moves to Trash |

Multiple actions can be stacked on a single filter and execute in order.

### Folder scoping and monitored folders

Automatic filtering is no longer limited to the Inbox. There are two levels:

- **Monitored folders** — the global list of folders the extension watches for automatic filtering. Open **Monitored folders…** from the filter-list toolbar to pick them. On first run after upgrading, this is seeded with every account's Inbox, so existing behavior is unchanged.
- **Source folders** — in each filter's editor, the **Folders** section lists the monitored folders and lets you check the subset that filter applies to. Use **Apply to all monitored folders** to check every one.

A filter only runs on mail that appears in one of its checked folders. This is what keeps the "move to folder" action idempotent: once a message is moved out of a folder, it no longer matches filters scoped to that folder, so it cannot be moved back and forth.

> Filters whose move actions would form a loop (e.g. one filter moves Inbox → Bills and another moves Bills → Inbox) are rejected when you save, so a message can never bounce between two folders forever.

### Import and export

The filter list toolbar has **Export…** and **Import…** buttons for sharing filters between Thunderbird profiles or creating backups.

- **Export** opens a modal where you select which filters to include. The selected filters are saved as a `.json` file.
- **Import** reads a previously exported `.json` file and shows each filter with a checkbox. If an imported filter has the same name as an existing one, a **Compare** button lets you view both side-by-side and rename either before importing.

**Offline export** — when Thunderbird isn't running, use the bundled shell script to extract filters directly from the profile:

```sh
scripts/export-stored-filters.sh -l                # list saved filters
scripts/export-stored-filters.sh -p ~/.thunderbird/abc123.default  # export from a specific profile
scripts/export-stored-filters.sh -o my-filters.json # export to a named file
```

The output file can be imported back via the UI's Import button. Requires only Python 3 (standard library; no extra packages needed).

### Running filters manually

Every filter row has a **▶** (run) button. The top of the filter list also has **▶ Run all on folder…**. Both open a folder picker.

- **Run** — evaluates conditions and executes the actions of the first matching rule per message.
- **Dry Run** — evaluates conditions without executing anything, so you can preview what would match.

After running, the window shows the folder you scanned and a table of every message that matched any rule, with columns **Subject**, **From**, **To**, and **Rules Applied**. Drag the column borders to resize them; the widths are remembered between sessions. The table scrolls both vertically and horizontally.

**First-match behaviour** — a message can match more than one rule, and the **Rules Applied** column lists them all. On a real **Run**, only the first matching rule's actions execute, mirroring Thunderbird's built-in filter runner (and incoming-mail processing).

## Regex

Conditions that use **matches regex** accept ECMAScript regular expressions — the same engine as JavaScript's `new RegExp()`. This means:

- Standard character classes: `\d`, `\w`, `\s`, `\b`
- Quantifiers: `*`, `+`, `?`, `{n,m}`
- Groups and alternation: `(a|b)`, `(?:...)`, `(?=...)`, `(?!...)`
- Named capture groups: `(?<name>...)` (ES2018+, works in modern Thunderbird)
- Lookbehind: `(?<=...)`, `(?<!...)` (ES2018+)

The `i` (case-insensitive) flag is added automatically unless the **Aa** toggle is active. Other flags (`g`, `m`, etc.) cannot be set from the UI; use `(?m)` inline mode if you need multiline anchors.

An invalid regex (e.g. an unclosed `[`) evaluates silently to `false` rather than throwing an error.

**Examples**

| Pattern | Matches |
|---|---|
| `\[JIRA-\d+\]` | Subjects like `[JIRA-1234] Fix login` |
| `.*@(gmail\|yahoo)\.com` | Senders on Gmail or Yahoo |
| `(?i)urgent` | The word "urgent" in any case (redundant if Aa is off) |
| `^\s*$` | Empty or whitespace-only body |

## Data format

Filters are stored in `browser.storage.local` under the key `filters` as a JSON array. The global
monitored-folder list is stored under the key `monitoredFolders` as an array of folder ids. Each
filter object:

```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // UUID
  "name": "Archive invoices",
  "enabled": true,
  "sourceFolderIds": [],                           // monitored folder IDs the filter applies to; empty = no folders
  "condition": { /* ConditionNode — see below */ },
  "actions": [ /* Action[] — see below */ ]
}
```

**ConditionNode**

```jsonc
// Group
{ "type": "and" | "or", "children": [ /* ConditionNode[] */ ] }

// Negation
{ "type": "not", "child": /* ConditionNode */ }

// Leaf
{
  "type": "condition",
  "field": "subject" | "from" | "from-name" | "to" | "cc" | "bcc" | "body" | "attachment" | "in-address-book",
  "operator": "contains" | "not-contains" | "is" | "is-not" |
               "starts-with" | "ends-with" | "regex" |
               "has-confusable" | "confusable-with",
  "value": "string",
  "caseSensitive": false   // omit or false = case-insensitive
}
```

**Action**

```jsonc
{ "type": "move",        "folderId": "...", "folderName": "..." }
{ "type": "mark-read"   }
{ "type": "mark-unread" }
{ "type": "add-star"    }
{ "type": "add-tag",    "tag": "$label1" }
{ "type": "remove-tag", "tag": "$label1" }
{ "type": "mark-junk"   }
{ "type": "delete"      }
```

Use the **Export** and **Import** buttons in the options page to transfer filters between profiles. Filters are exported as a JSON array in the same format shown above.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (for running the test suite only — the extension itself has no runtime dependencies)

### Running the tests

The test suite covers the filter engine's pure logic (field extraction, operator matching, condition tree evaluation, action dispatch, folder-scan algorithm) using Node.js's built-in test runner and no third-party packages.

```sh
npm test
# or directly:
node --test test/filter-engine.test.js
```

### Project structure

```
manifest.json            Extension manifest (Manifest V2)
confusables-data.js      Generated — Unicode TR39 confusable character mappings
filter-engine.js         Pure evaluation and action logic; loaded in both contexts
background.js            New-mail event listener
options.html             Options page markup
options.js               Options page: filter list, condition tree editor, run-now
options.css              Styles
icons/icon.svg           Extension icon
scripts/
  build-confusables.js       Fetches confusables.txt and regenerates confusables-data.js
  export-stored-filters.sh   Offline export: extracts filters from a TB profile without Thunderbird running
  verify-xpi.sh              Checks a built .xpi against every file the manifest and options page reference
test/
  filter-engine.test.js  Node.js unit tests for filter-engine.js
docs/
  architecture.md        Runtime architecture + new-mail main loop
  data-model.md          Storage model and move-graph cycle detection
  diagrams.md            Diagram legend and inventory
  decisions/             Architecture Decision Records (ADRs)
```

### Releases and packaging

Releases are built by GitHub Actions, not by hand. Pushing to `main` with a changed `version` in `manifest.json` builds the XPI, verifies it, and publishes a GitHub release tagged `v<version>`.

The packaging step is an explicit list of paths in [`.github/workflows/ci.yml`](.github/workflows/ci.yml), not a glob — **a new runtime file must be added to that list**, or it will be missing from the XPI. `scripts/verify-xpi.sh` is the guard: it collects every path referenced by `manifest.json` and by the HTML pages the manifest points at, then fails the build if any of them is absent from the archive.

```sh
scripts/verify-xpi.sh polimath-filters-1.10.1.xpi
```

CI also runs `shellcheck scripts/*.sh` on every push and pull request.
