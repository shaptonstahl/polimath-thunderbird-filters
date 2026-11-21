# ADR-009: Automatic backups stored as mail messages

## Status

Accepted (v3.4.0)

## Context

Thunderbird deletes an extension's `storage.local` on removal, and no event fires beforehand. A
MailExtension cannot write files outside the Downloads folder, nor read files without a user pick,
so file backups could neither go where the user wants nor restore themselves. `storage.sync` is not
documented to sync in Thunderbird. The mail store is the one durable place a MailExtension can both
write and read: `messages.import` places a file as a message in any folder, local or IMAP.

## Decision

- Opt-in backups, offered on install and once on upgrade.
- Each backup is a message with header `X-Polimath-Filters-Backup: 1` and the export JSON attached,
  in a folder named `Polimath Filters Backups` under an account the user chooses.
- Debounced after edits, plus a startup check when the newest backup is over 24 h old; unchanged
  content (hash) is skipped.
- Rotation: newest per day for 30 days, then newest per month forever. Only header-marked messages
  in the backup folder are ever deleted.
- Restore: automatic offer when storage is empty and the well-known folder exists; manual restore
  from any folder, rejecting non-backup messages with a stated reason. Restore uses the ADR-008
  import pipeline.

## Alternatives rejected

- **Files in Downloads** via `downloads.download`: fixed location, no automatic restore, rotation
  breaks when download history is cleared, every backup appears in the Downloads panel.
- **Native messaging helper**: writes anywhere, but needs a separate application.
- **`storage.sync`**: no documented sync in Thunderbird; quota limits.

## Consequences

- With an IMAP account, backups survive uninstall, profile loss and machine changes; filter contents
  live on that mail server (shown to the user when choosing).
- New permissions `messagesImport` and `accountsFolders`; existing users see a prompt on update.
- Backups also carry `monitoredFolders`: a fresh install monitors only Inboxes, so restored filters
  scoped to other folders would otherwise never run.
- Rotation deletes through the account's own deletion setting, not permanently, so a rotated backup is
  still recoverable from Trash for a while (confirmed on Gmail: it goes to Trash, not All Mail).
- Rotation identifies its own messages by the `.invalid` From address rather than the custom header,
  because `messages.list` exposes the author but not custom headers before Thunderbird 147.
