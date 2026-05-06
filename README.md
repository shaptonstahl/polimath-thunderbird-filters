# Polimath Filters

A Thunderbird MailExtension that replaces the built-in filter editor with a more powerful one. Conditions can be any boolean combination of AND, OR, and NOT groups, and any condition can match against a regular expression.

## Features

- **Arbitrary boolean logic** — nest AND, OR, and NOT groups to any depth
- **Regular expression matching** — full ECMAScript (JavaScript) regex syntax
- **Case-sensitivity toggle** — per-condition, defaults to case-insensitive
- **Eight condition fields** — Subject, From, From name, To, CC, BCC, Body, Has attachment
- **Seven actions** — Move, Mark read/unread, Add/remove tag, Mark as junk, Delete
- **Automatic filtering** — runs on new incoming mail
- **Manual run** — apply any filter (or all filters) to an existing folder
- **Dry run** — preview how many messages a filter would affect without changing anything
- **Smart folder scan** — messages moved or deleted by an earlier filter are skipped by later ones; full message content is fetched in parallel batches only when needed

## Installation

Thunderbird does not yet distribute this extension through addons.thunderbird.net, so load it as a temporary add-on:

1. Clone or download this repository.
2. Open Thunderbird.
3. Open **Tools → Add-on Manager** (or press `Ctrl+Shift+A`).
4. Click the gear icon and choose **Debug Add-ons**.
5. Click **Load Temporary Add-on…** and select `manifest.json` from the repository root.

The extension stays loaded until Thunderbird is restarted. To make it permanent, package it as an XPI (`zip -r polimath-filters.xpi . -x '*.git*'`) and install from file.

## Usage

Open the options page via **Tools → Add-on Options → Polimath Filters**, or click the gear icon next to the extension in the Add-on Manager.

### Creating a filter

1. Click **+ New Filter**.
2. Give the filter a name.
3. Optionally restrict the filter to one or more accounts (see [Account scoping](#account-scoping)).
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

> CC, BCC, and Body conditions trigger a full message download. For large folders, place these conditions inside an AND group after cheaper header conditions so short-circuit evaluation can skip the download for non-matching messages.

**Operators** (not available for Has attachment)

| Operator | Behaviour |
|---|---|
| contains | Substring match |
| does not contain | Substring absent |
| is | Exact equality |
| is not | Exact inequality |
| starts with | Prefix match |
| ends with | Suffix match |
| matches regex | ECMAScript regular expression — see [Regex](#regex) |

**Aa toggle** — Each condition has a small **Aa** button. When grey (default) the match is case-insensitive. When blue it is case-sensitive.

### Actions

| Action | Details |
|---|---|
| Move to folder | Pick any folder from the dropdown |
| Mark as read | Sets the read flag |
| Mark as unread | Clears the read flag |
| Add tag | Select a tag from your Thunderbird tag list |
| Remove tag | Select a tag to remove |
| Mark as junk | Moves to Junk if Thunderbird is configured to do so |
| Delete | Moves to Trash |

Multiple actions can be stacked on a single filter and execute in order.

### Account scoping

By default a filter runs on mail from any account. To limit a filter to specific accounts, check the accounts you want under the filter name in the editor. When at least one account is checked, the filter only runs on mail arriving in (or being scanned from) a matching account.

This is useful when you have multiple email addresses with different naming conventions or different tagging schemes.

### Running filters manually

Every filter row has a **▶** (run) button. The top of the filter list also has **▶ Run all on folder…**. Both open a folder picker.

- **Run** — evaluates conditions and executes all matched actions.
- **Dry Run** *(single filter only)* — evaluates conditions but does not execute any actions. Reports how many messages would be affected.

**Consumed-message behaviour** — when running all filters on a folder, a message that is moved or deleted by an earlier filter is removed from the pool. Later filters will not see it, which mirrors the behaviour of Thunderbird's built-in filter runner.

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

Filters are stored in `browser.storage.local` under the key `filters` as a JSON array. Each filter object:

```jsonc
{
  "id": "550e8400-e29b-41d4-a716-446655440000",   // UUID
  "name": "Archive invoices",
  "enabled": true,
  "accountIds": [],                                // [] or omitted = all accounts; non-empty = restrict to listed account IDs
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
  "field": "subject" | "from" | "from-name" | "to" | "cc" | "bcc" | "body" | "attachment",
  "operator": "contains" | "not-contains" | "is" | "is-not" |
               "starts-with" | "ends-with" | "regex",
  "value": "string",
  "caseSensitive": false   // omit or false = case-insensitive
}
```

**Action**

```jsonc
{ "type": "move",        "folderId": "...", "folderName": "..." }
{ "type": "mark-read"   }
{ "type": "mark-unread" }
{ "type": "add-tag",    "tag": "$label1" }
{ "type": "remove-tag", "tag": "$label1" }
{ "type": "mark-junk"   }
{ "type": "delete"      }
```

You can export or import filters by opening the browser console (`Ctrl+Shift+J` in Thunderbird's developer tools) and reading/writing `browser.storage.local`.

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
manifest.json        Extension manifest (Manifest V2)
filter-engine.js     Pure evaluation and action logic; loaded in both contexts
background.js        New-mail event listener
options.html         Options page markup
options.js           Options page: filter list, condition tree editor, run-now
options.css          Styles
icons/icon.svg       Extension icon
test/
  filter-engine.test.js   Node.js unit tests for filter-engine.js
```
