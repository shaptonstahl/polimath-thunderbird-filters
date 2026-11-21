# Plan: filter safety (migrations, backups, uninstall)

Status: approved 2026-11-20. Phases ship in order A → B → D, one minor release each.
Background: on 2026-11-20 a reinstall wiped every stored filter. Thunderbird deletes an
extension's `storage.local` when it is removed, and the only recovery was a month-old export
that the importer could not migrate correctly.

## Platform constraints (verified 2026-11-20)

| Constraint | Consequence |
|---|---|
| No event fires before an extension is removed; `runtime.setUninstallURL` opens a page only after removal | Cannot warn or export at uninstall time |
| `storage.local` is deleted on removal (unless both `extensions.webextensions.keepStorageOnUninstall` and `keepUuidOnUninstall` were set beforehand) | Backups must live outside extension storage |
| `downloads.download` writes only inside the Downloads folder; an extension cannot read local files without a user pick | File backups cannot go to any folder and cannot restore automatically: dropped (decision: skip Phase C) |
| `messages.import` (TB 106+, `messagesImport`) imports a file as a message into any folder | Backups can live in the mail store: local or IMAP, the user's choice |

## Phase A — versioned migrations on import (3.3.0)

**Schema versions.** `schemaVersion` is a new integer written to stored data and to exports.

| Schema | Releases | Shape | Notes |
|---|---|---|---|
| 1 | 1.0.0 – 1.10.1 | `accountIds`; move/delete in `actions` | **Empty `accountIds` = all accounts** |
| 2 | 2.0.0 | as 1 | Empty `accountIds` = no accounts (scoping became opt-in) |
| 3 | 2.1.0 – 3.0.x | `sourceFolderIds`; move/delete in `actions`; `stopProcessing` (3.0.0) | |
| 4 | 3.1.0 – | `ending` | Current |

Exports since 1.8.0 carry `extensionVersion`, which identifies the schema exactly. Stored data
without `schemaVersion` is identified by its shape; an empty `accountIds` in unversioned storage
is ambiguous between schemas 1 and 2 (task: check whether 2.0.0 rewrote stored data on upgrade).

**One migration pipeline.** `migrateFilters(filters, fromSchema, env) → { filters, warnings }` in
`filter-engine.js`: pure, with `env` supplying the accounts, folders and tags that exist so the
function runs in Node tests. It chains per-step migrations (1→2→3→4) and is used by import,
background startup and options-page load, replacing today's two ad-hoc migrations.

**Warnings shown per filter in the import dialog** (and logged for storage migrations):

- Schema 1 filter with empty `accountIds`: scoped to every account's Inbox (stated, so it is visible)
- Filter ends up with no source folders: it will not run until one is chosen
- `stopProcessing` without move/delete: dropped (no equivalent)
- Several move/delete actions: which one became the ending
- Move target folder or tag does not exist in this profile
- Invalid regex in a condition
- File from a **newer** schema than this extension: import refused, with the version needed

**Tests.** Synthetic fixtures for every schema, built to match each release's shape. Real
exports never enter the repo: they contain personal addresses.

## Phase B — backups in a mail folder, restore on install (3.4.0)

**Opt-in.** `runtime.onInstalled` opens a welcome panel on install, and once on the upgrade to
3.4.0, offering backups. Dismissal is remembered. Settings live on the options page.

**Destination.** The user chooses the account (Local Folders or any mail account); the folder is
always named `Polimath Filters Backups` so it can be found after a reinstall, when every setting is
gone. Choosing an IMAP account is labelled: the filter definitions (addresses, regexes) are stored
on that mail server.

**Backup message.** RFC 822 message imported with `messages.import`: header
`X-Polimath-Filters-Backup: 1`, subject `Polimath Filters backup 2026-11-20 (13 filters)`, a short
plain-text body saying what it is and how to restore it, and the export JSON attached (same
envelope as a manual export, with `schemaVersion`).

**When.** A few minutes after the last filter change (debounced), and at startup when the newest
backup is over 24 h old. Skipped when a content hash matches the newest backup.

**Rotation.** Keep the newest backup of each day for 30 days, then the newest of each month
forever. Rotation deletes only messages in the backup folder that carry the backup header: never
anything else. On Gmail, IMAP deletion removes the label and the message stays in All Mail.

**Restore.**
- *Automatic offer:* when storage has no filters, look in every account for a folder named
  `Polimath Filters Backups`; if one has valid backups, offer the newest (or a chosen one).
- *Manual:* "Restore from mail…" lets the user pick **any** folder, then lists its messages.
  Valid backups can be selected; everything else is shown greyed with a polite reason: "Not a
  Polimath Filters backup", "Attachment is missing or unreadable", "Made by version 4.1; update
  this add-on to restore it".
- Restoring goes through the Phase A import path, so migrations and warnings apply.

**Permissions added:** `messagesImport`, `accountsFolders` (create the folder). ATN shows existing
users a permission prompt on update; re-run `scripts/check-webext.sh`.

## Phase D — around uninstall (3.5.0)

- Options page: a permanent note: "Removing this add-on deletes your filters. To upgrade, install
  the new .xpi over this one."
- `runtime.setUninstallURL` → a README section, with no query parameters (nothing tracked).
- README section *Restoring after removal*, honest about what can be recovered:
  1. Backups were on: reinstall; the add-on offers to restore from `Polimath Filters Backups`.
  2. You have an export file: reinstall, then Import.
  3. A filesystem backup of the Thunderbird profile from before the removal: restore it to a copy,
     start Thunderbird on that copy (`--profile <dir> --no-remote`), export, import into the real one.
  4. None of these: the filters cannot be recovered.
- Document the two `keepStorageOnUninstall` / `keepUuidOnUninstall` prefs as an advanced safety net.

## Also in scope

- `scripts/export-stored-filters.sh`: detect snap/flatpak profiles; read the IndexedDB-backed
  `storage.local` (`idb/*.sqlite`) rather than the localStorage table it reads today.
- ADR-008 (schema versions and migrations), ADR-009 (mail-folder backups).
