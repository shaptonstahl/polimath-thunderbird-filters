# STATUS

Session-end notes (last updated 2026-10-22). Addressed items are marked done; leave the
open items for a future session.

## Open questions

- *(none)*

## Desired features

- Friendlier error messages when a "matches regex" condition has an invalid pattern
  (v3.1.3 added syntax validation, but the 🚨 tooltip / save alert currently show the raw
  JavaScript `RegExp` error text).

## Done this session

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

## External state (Stephen's actions, not this repo)

- Add-on resubmitted to addons.thunderbird.net (review pending) — no repo action needed.
