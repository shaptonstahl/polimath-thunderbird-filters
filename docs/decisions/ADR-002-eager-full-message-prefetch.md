# ADR-002: Eager full-message prefetch for folder scans

## Status
Accepted

## Date
2026-05-05

## Context

Three filter fields — `body`, `cc`, and `bcc` — require the full MIME message, which is a separate API call (`messenger.messages.getFull`) from the header listing (`messenger.messages.list`). For large folders, the strategy for fetching full content has a significant impact on scan time.

Two strategies were considered:

### Lazy (on-demand) fetching

For each message, evaluate header-only conditions first. Call `getFull` only if a body/cc/bcc condition is actually reached during evaluation.

- **Pro**: Never fetches full content for messages eliminated by a cheap header condition.
- **Con**: `getFull` calls are serial per message (or per batch of messages that survived the header pass). The per-message latency of the Thunderbird API makes serial fetching slow for folders where many messages pass the header check.

### Eager (upfront) batched fetching

Before the evaluation loop, fetch full content for every message in parallel batches of 10.

- **Pro**: Maximum parallelism — 10 concurrent `getFull` calls overlap their network/IO latency. The evaluation loop never waits for an individual fetch.
- **Con**: Fetches full content for messages that will be eliminated by header conditions. For a folder of 10,000 messages where only 50 match the subject condition, we still download all 10,000 full messages.

## Decision

Use eager batched prefetching with `BATCH = 10`.

The implementation guards against unnecessary work: if no active filter needs full content (`anyNeedsFull === false`), the entire prefetch phase is skipped. The cost is only paid when at least one body/cc/bcc condition is active.

## Consequences

- Scan time for body-condition filters on large folders is dominated by the prefetch phase (ceil(N/10) batched API calls). This is visible in the progress bar.
- Memory usage scales with folder size when full content is needed: all full messages are held in a `Map` for the duration of the scan.
- The README's performance tip is load-bearing: placing body conditions inside an AND group *after* a cheap subject/from check does not reduce prefetch work — it reduces evaluation work. The prefetch is folder-wide and unconditional once `anyNeedsFull` is true.

## Future consideration

If users report slowness on large folders (> 5,000 messages) with body conditions, revisit with a lazy two-pass approach: evaluate header-only conditions first; call `getFull` in batches only for messages that pass the header pass. This would require per-filter decomposition of condition trees into "header-safe" and "full-required" sub-trees.

Profile before implementing — the benefit depends on the hit rate of header conditions, which varies by user and filter set.
