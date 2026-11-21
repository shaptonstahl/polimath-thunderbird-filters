# STATUS

Session-end notes (last updated 2026-11-20). Addressed items are marked done; leave the
open items for a future session.

## Open questions

- **Manifest V3: discuss tradeoffs before migrating (not yet).** Thunderbird supports MV3
  add-ons only from 128 on (~80% confident), so migrating raises the floor from 121 to 128
  and drops 121-127 (monthly releases, all out of support). Gains: future-proofing against
  MV2 removal. Main code change: `contacts.list` → `addressBooks.contacts.list`; the
  background page becomes non-persistent, which `background.js`'s in-memory
  `cachedMonitoredFolders` must survive.

- **Options-page test harness?** (2026-11-20) The import, backup and restore dialogs in
  `options.js` were verified only by a manual checklist. Is a lightweight browser test harness
  worth it for future UI changes, or keep testing by hand? See the existing "no automated
  tests" to-do below.
- **Keep filter IDs on restore?** Every import or restore assigns new IDs
  (`doImportSelected`), so a filter can't be tracked across a restore. Keep the original
  ID when it doesn't conflict?
- **Where does the uninstall page open?** `runtime.setUninstallURL` (3.5.0) is untested in
  Thunderbird: a Thunderbird tab or the system browser? Testing needs a removal, so only on
  a throwaway profile.
- **Backup cadence.** Backups check staleness at startup and hourly (24 h threshold) plus 3 min
  after edits. If Thunderbird is rarely open, a day can pass without a backup. Is that right?
- **`contains-word` operator?** Word-boundary matching currently needs a regex
  (`\bw-?2s?\b`). A dedicated operator would make the common case easy.
- **"Recruiter offering W2" filter (Stephen's own):** still substring `contains` with a
  delete ending. Stephen chose 2026-11-20 to keep it and watch for false positives;
  revisit if real mail turns up in Trash.

## To do

- **Test on Thunderbird 140 ESR.** Only 159.0 has been exercised for real.
- **`options.js` has no automated tests** (the whole options page: filter list, condition-tree
  editor, run-now modal). Deferred 2026-11-12 as low stakes — the v3.2.0 rejection was a
  permission gap, which the linter catches, not a logic bug a test would have found. Revisit
  only if something slips past `scripts/check-webext.sh` and CI.

## Desired features

In priority order:

1. **Menu/toolbar button that opens the editor.** Today the only entry point is the
   wrench (Add-on Options) in Tools → Add-ons and Themes.
2. Friendlier error messages when a "matches regex" condition has an invalid pattern
   (v3.1.3 added syntax validation, but the 🚨 tooltip / save alert currently show the raw
   JavaScript `RegExp` error text).

## Done 2026-11-20

- v3.2.2: body matching ignores CSS/`<head>`/`<script>`/comments, HTML tags leaked into
  plain-text parts, and URL paths (reduced to scheme + host).
- v3.3.0: schema versions + one migration pipeline (ADR-008); imports upgrade any earlier
  version with per-filter warnings; schema-1 empty `accountIds` = every account.
- v3.4.0: opt-in backups as mail messages with rotation and restore (ADR-009). Gmail
  rotation sends old backups to Trash (tested).
- v3.5.0: uninstall URL + README "Restoring after removal"; options footer note;
  `export-stored-filters.sh` rewritten to decode IndexedDB storage and find snap/flatpak/
  macOS/Windows profiles.
- ATN listing text and screenshots updated (Stephen pasted them into ATN); screenshot
  harness fixed (multi-key storage mock, `backup.js` copied).
- Plan: `docs/plans/2026-11-20-filter-safety.md`.

## Done 2026-11-12

- Released v3.0.0 (all-match + per-rule `stopProcessing`) and v3.1.0 (terminal `ending`
  model: continue / stop / move / delete). `filter.ending` is the single source of truth for
  how a rule ends; move/delete are no longer `actions`; `migrateFiltersToEnding` upgrades
  legacy filters on load.
- Pinned CI to `ubuntu-26.04` (verified `shellcheck`/`jq`/`zip`/Node 24 present) — pushed and
  green on the new image.
- `detectMoveCycle(filters, focusFilterId)` scopes cycle detection to the edited filter.
- v3.1.1 — manual "Run on folder…" now works on any folder, monitored or not (added an
  `ignoreScope` flag to `runFiltersOnFolder`).
- v3.1.2 — manual runs now execute a rule's terminal `ending` (move/delete); previously the
  ending was skipped, so deletes/moves were reported but never applied.
- Stopped tracking `.codegraph/` (added to `.gitignore`); it remains in the working tree.
- `STATUS.md` added to the repo (no private info).
- regex101 link updated to a saved expression (`flavor=javascript` preselected).
- Added `PRIVACY.md` (plain-language "collects nothing" policy) and a **Privacy** section
  in `README.md`; pushed to `main` as `0805d94`.

- v3.2.0 — addressed the ATN review: `messages.listTags()` → `messages.tags.list()` with
  `strict_min_version` raised to 121.0; listing text with entry-point instructions in
  `docs/atn-listing.md`; seven listing screenshots in `assets/screenshots/` (`01`-`06` regenerated by
  `scripts/screenshot-harness/take-screenshots.sh`; `00-entry-point.png` captured by hand).
- v3.2.1 — fixed the ATN rejection of v3.2.0: `messagesTagsList` was used by
  `options.js` (`messenger.messages.tags.list()`) but never declared in `manifest.json`.
  Added it. Added `scripts/check-webext.sh` + a `pre-commit` hook running Thunderbird's
  `webext-linter` (the same tool ATN's automated review uses) over the packaged file set,
  with `scripts/xpi-files.txt` as the one packaging allowlist shared by CI and the hook.
  CI runs the same review on every push. Pre-commit also runs version sync, shellcheck and
  the tests; `scripts/setup-dev.sh` installs the hooks and the linter clone in one step.
  The linter is deliberately unpinned: we release only when the linter ATN runs today passes.
- Release tagging is CI-only: `.npmrc` sets `git-tag-version=false` (which also stops npm's
  own commit), so `scripts/bump-version.sh patch|minor|major` does the bump and the commit in
  one step. The pre-commit hook repairs `manifest.json` from `package.json` instead of only
  complaining, and `scripts/check-release-bump.sh` fails CI when a packaged file changes
  without a version bump — nothing shipped can sit on `main` unreleased. That guard also
  runs as a pre-push hook, and the release job reviews the built `.xpi` with the linter
  after packaging, so the artifact itself is gated, not just the staged files.

## External state (Stephen's actions, not this repo)

- ATN listing updated with `docs/atn-listing.md` text and the seven screenshots (done
  2026-11-04). v3.2.0 was rejected 2026-11-12 for the undeclared `messagesTagsList`
  permission. v3.2.1 was released by CI the same day and **submitted to ATN on
  2026-11-12** — review pending.

- Add-on resubmitted to addons.thunderbird.net (review pending) — no repo action needed.
- Privacy policy URL added to the addons.thunderbird.net listing (done 2026-11-02):
  `https://github.com/shaptonstahl/polimath-thunderbird-filters/blob/main/PRIVACY.md`.
