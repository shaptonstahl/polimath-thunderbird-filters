# ADR-007: All-match semantics and explicit stop processing

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
"stop processing" an explicit per-rule setting rather than a kludge:

- For each message, filters are evaluated in list order and **every** matching filter's
  actions run.
- A filter ends a message's processing when it moves or deletes the message (the message
  is gone), or when its `stopProcessing` flag is `true`. Later filters skip the message.
- `stopProcessing` is a first-class boolean on each filter, edited via a
  "Continue processing with subsequent rules / Do not process subsequent rules" selector
  in the actions section of the filter editor. It defaults to `false`.
- In dry-run mode no actions execute and nothing is consumed, so every matching filter is
  reported (unchanged from ADR-001's dry-run behavior).

## Consequences

- A message can be acted on by more than one rule, which is what the user expects and what
  v1.0.0's run-on-folder scan did. Ordering still matters, but a non-consuming rule no
  longer hides later rules.
- "Stop processing" is now explicit and visible for every rule, replacing the
  "move to the same folder" workaround that ADR-006's cycle detector correctly rejected.
- `filterEndsProcessing(filter)` in `filter-engine.js` is the single source of truth for
  whether a matching filter ends a message's processing: `stopProcessing` OR a move/delete
  action.
- The run-on-folder results still report one row per matched message; its "Rules Applied"
  column now lists every rule whose actions ran, in firing order, stopping at the
  consuming rule.
- This is a breaking change: filter lists that relied on first-match to suppress later
  rules must set `stopProcessing` on the rule that should terminate processing.
