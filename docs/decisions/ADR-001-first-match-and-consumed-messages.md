# ADR-001: First-match semantics and consumed-message tracking

## Status
Accepted

## Date
2026-05-05

## Context

When running a list of filters against a set of messages, two questions arise:

1. If multiple filters match a single message, should all of them fire or only one?
2. If a filter moves or deletes a message, should subsequent filters in the same run still see it?

Thunderbird's built-in filter runner answers both questions the same way: first match wins, and a moved/deleted message is gone for the purposes of later filters. Users migrating from the built-in runner expect this behavior.

Two alternative models were considered:

**Last-match wins**: every filter runs regardless of earlier matches; the last filter's actions take effect. Predictable for independent filters, but counterintuitive for ordered filter lists where the user expects "if X, do A; otherwise if Y, do B."

**All-match**: every matching filter fires. Additive for actions like tagging, but causes problems for conflicting actions (two filters both try to move the same message to different folders).

## Decision

Use first-match semantics: for each message, evaluate filters in list order and stop at the first match. Track messages moved or deleted during the run in a `consumed` Set; skip consumed messages for all subsequent filters.

## Consequences

- Filter order matters. Users who want a "catch-all" rule must place it last.
- A message moved by filter N is invisible to filters N+1 … N+k in the same folder run. This is intentional and matches Thunderbird's built-in behavior.
- In dry-run mode, no actions execute, so nothing enters `consumed`. All filters see all messages (subject to their own first-match stop). This is correct: dry run shows what *would* happen if each filter ran in isolation against the full folder.
- The `consumed` check is O(1) per message (Set lookup).
