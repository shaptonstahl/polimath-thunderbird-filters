# Privacy Policy — Polimath Filters

**Last updated: November 20, 2026**

Polimath Filters collects nothing. There is no server, no account, no analytics,
and no telemetry. The extension itself never sends your email or your filters
anywhere; the one exception you can opt into is described under **Automatic
backups**.

## What the extension reads

To decide whether a message matches a filter, the extension reads that message
inside Thunderbird — subject, sender, recipients, body, attachment status, and
folder. It also reads your address books, but only to answer one question: "is
this sender in my address book?" All of this happens locally, on your machine.

Nothing is uploaded, copied to a remote service, or shared with anyone.

## What is stored, and where

Filters, monitored folders, and a few display preferences (such as column
widths) are saved in Thunderbird's own extension storage
(`storage.local`), inside your Thunderbird profile. That is the same place
Thunderbird keeps your own settings.

The extension makes no network requests. It has no way to send data anywhere.

## Automatic backups (opt-in)

Backups are off until you turn them on. When they are on, the extension saves a
copy of your filters and monitored-folder list as an email message in a folder
named "Polimath Filters Backups" inside the mail account you choose. The
extension writes that message only into your own Thunderbird mail store.

- If you choose **Local Folders**, backups stay on your computer.
- If you choose a mail account that keeps mail on a server (IMAP, Exchange),
  Thunderbird syncs that folder to the server like any other folder, so your
  filter definitions, including any addresses and patterns in them, are
  stored on that server under that provider's terms. The backup settings show
  this before you choose.

Older backups are deleted automatically: the newest of each day is kept for 30
days, then the newest of each month. You can delete the folder at any time.

## Import and export

Filters are only written to a file when you explicitly choose **Export**. The
JSON file is saved wherever you pick, and it stays there until you delete it.
Imports are read from a file you choose and saved into local storage.

## Data sharing

None. No third parties, no advertising, no tracking, no selling of data.

## Deleting your data

Uninstalling the add-on removes its stored filters and settings from your
Thunderbird profile. Backup messages and export files are not removed: they
are ordinary messages and files you control, so delete the "Polimath Filters
Backups" folder or the files yourself if you no longer want them.

## Permissions

The extension asks only for what filtering requires: reading, moving,
deleting, and updating messages; listing accounts and folders; reading address
books; local storage; and, for backups, creating a folder and adding messages
to it. Every permission is used for filtering or for the backups you turn on.

## Changes

If this policy ever changes, the new version will appear here and in the
release notes for that version. Given that the extension collects nothing,
changes are unlikely.

## Contact

Questions? Email **polimath-software@haptonstahl.org**.
