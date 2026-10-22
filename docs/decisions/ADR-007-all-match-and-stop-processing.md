# ADR-007: All-match semantics and a terminal ending

## Status
Accepted

## Date
2026-10-21

## Supersedes
[ADR-001](ADR-001-first-match-and-consumed-messages.md)

## Context

ADR-001 chose first-match semantics: for each message, filters are evaluated in list
order and evaluation stops at the first match. A user reported that this was a
regression from v1.0.0, whose run-on-folder scan was all-match — every matching filter
fired, and only a move or delete "consumed" a message so later filters skipped it.

Under first-match, there was no way to express "this rule handled the message, stop
processing it" without an action that did something. The user had worked around this by
adding a "move to the same folder" action, which the save-time move-cycle detector
(ADR-006) began rejecting as a self-loop.

## Decision

Restore all-match semantics for both incoming mail and run-on-folder scans, and make
how a rule ends an explicit, single, mutually-exclusive choice:

- For each message, filters are evaluated in list order and **every** matching filter's
  actions run.
- A filter carries an `ending` with exactly one of four values:
  - `{ "type": "continue" }` — the default; later filters still run.
  - `{ "type": "stop" }` — end processing but leave the message in place; later filters
    are skipped.
  - `{ "type": "move", "folderId": "...", "folderName": "..." }` — move the message,
    ending its processing.
  - `{ "type": "delete" }` — delete the message, ending its processing.
- Move and delete are no longer entries in `actions`; they live only in `ending`, so a
  rule cannot have both a move and a delete, nor more than one of either. The editor
  exposes this as an **After this rule matches** selector (continue / do not process
  subsequent rules / move to a folder / delete) with a folder picker that appears only
  for move.
- In dry-run mode no actions execute and nothing is consumed, so every matching filter
  is reported (unchanged from ADR-001's dry-run behavior).

## Consequences

- A message can be acted on by more than one rule, which is what the user expects and
  what v1.0.0's run-on-folder scan did. Ordering still matters, but a non-terminating
  rule no longer hides later rules.
- "Do not process subsequent rules" is a first-class ending (`stop`), distinct from
  move/delete: it ends processing while leaving the message in place. It replaces the
  "move to the same folder" workaround that ADR-006's cycle detector correctly rejected.
- `filterEndsProcessing(filter)` in `filter-engine.js` is true exactly when
  `filter.ending.type` is `stop`, `move`, or `delete`.
- The run-on-folder results still report one row per matched message; its "Rules Applied"
  column lists every rule whose actions ran, in firing order, stopping at the terminating
  rule.
- `migrateFiltersToEnding` upgrades existing filters: a `move` action becomes a move
  ending, a `delete` action a delete ending, and a legacy `stopProcessing` flag without
  a move/delete becomes a `stop` ending.
- This is a breaking change: filter lists that relied on first-match change behavior and
  should be reviewed.
