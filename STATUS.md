# STATUS

Session-end notes (last updated 2026-10-22). Addressed items are marked done; leave the
open items for a future session.

## Open questions

- *(none)*

## Done this session

- Released v3.0.0 (all-match + per-rule `stopProcessing`) and v3.1.0 (terminal `ending`
  model: continue / stop / move / delete). `filter.ending` is the single source of truth for
  how a rule ends; move/delete are no longer `actions`; `migrateFiltersToEnding` upgrades
  legacy filters on load.
- Pinned CI to `ubuntu-26.04` (verified `shellcheck`/`jq`/`zip`/Node 24 present) — pushed and
  green on the new image.
- `detectMoveCycle(filters, focusFilterId)` scopes cycle detection to the edited filter.

## External state (Stephen's actions, not this repo)

- Add-on resubmitted to addons.thunderbird.net — no repo action needed.
