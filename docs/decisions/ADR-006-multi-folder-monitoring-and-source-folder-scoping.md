# ADR-006: Multi-folder monitoring and source-folder scoping

## Status

Accepted (v2.1.0)

## Date

2026-10-20

## Context

Today the extension processes mail automatically only on the Inbox: `background.js` listens to `messages.onNewMailReceived` and runs every enabled filter scoped to the account that owns the folder. A user asked to run filters automatically on additional folders.

The naive extension — also processing every monitored folder, or periodically scanning each folder's contents — is not idempotent. Move actions are the problem: if a filter moves a message from folder A to folder B, and the same or another filter later moves it back, the message bounces A→B→A→… forever. Mark-read, star, tag, and junk actions are already idempotent; move is the only action that can loop.

Three empirical facts, verified with a temporary probe add-on against real Gmail and AOL (non-Gmail IMAP) accounts, determine the shape of the solution:

1. **`messages.onNewMailReceived` fires when messages *appear* in a folder, not only on delivery.** A `messages.move()` into a destination folder re-fires the event in that destination, on Gmail *and* plain IMAP alike. The event is "messages appeared here," so a move is indistinguishable from delivery by event alone.
2. **`message.id` is folder-scoped and changes across a move.** The same message had id `15` in one Gmail folder and `2048` after moving (and `387` → `2047` on AOL). `id` cannot key any cross-folder dedupe.
3. **`message.headerMessageId` (the RFC Message-ID header) is stable across moves**, on both account types, and is the only identity field on `MessageHeader` (there is no `messageId` property).

## Decision

Support automatic processing on multiple folders using **source-folder scoping** as the idempotency mechanism, with **static cycle detection** as the guard for the one case scoping cannot prevent.

### Data model

- A global **monitored folders** list: the folders the extension watches, chosen per account.
- Each filter gains a **source-folder scope**: the subset of the monitored folders the filter applies to. This replaces `accountIds` as the routing field (`accountIds` is either dropped or derived from the source folders' accounts during migration).

### Runtime

`background.js` keeps a single `messages.onNewMailReceived` listener. For each event it looks up the event's `folder` and runs only the enabled filters whose source scope includes that folder. Because the event's folder equals the message's current folder at that moment, the scope check is a pure look-up — no cross-event state, no identity tracking.

### Idempotency

A filter scoped to folder A and "move to B" matches the message while it is in A. After the move, the message is in B, the move re-fires `onNewMailReceived` for B, and the filter is re-evaluated against B — but it is scoped to A, so it no longer matches. The re-fired event is harmless, and the id change (`A:15` → `B:2048`) is irrelevant because nothing is keyed on `id`.

### Cycle detection

Scoping does not stop a genuine cycle between two filters (filter A: A→B scoped to A; filter B: B→A scoped to B), nor a self-loop (a filter whose destination is inside its own source scope). At filter-save time, build the move graph — nodes are folders, edges are source-subset → destination for every enabled move filter — and reject configurations that form a cycle, including self-loops. This is the same "your rules contradict each other" guard the user already needs, and it is a static check with no runtime cost.

## Rationale

**Why source-folder scoping over a process-once marker?** A marker keyed on message identity would need to survive a move and be stamped *before* the move executes (the destination re-fires the event within a few hundred milliseconds). `message.id` cannot key it (fact 2); only `headerMessageId` could (fact 3), and some messages lack a Message-ID header. Scoping needs none of this — it depends only on the message's current folder, which the event provides directly.

**Why not rely on the "move is silent" assumption?** Fact 1 disproves it for every account type. An arrival-event-only design would have to treat a moved message as a new arrival and re-process it, reintroducing the loop.

**Why keep the global monitored list separate from per-filter scopes?** It gives one place to see and manage what the extension watches, and it bounds the work the background listener does. The per-filter subset is then a pure refinement of that list.

**Why reserve `headerMessageId` rather than use it now?** It is the correct stable key if a future feature needs cross-folder dedupe (e.g. a "process each message at most once" mode), but the core design does not require it, so it stays out of the hot path.

## Consequences

- **Migration.** Existing filters carry `accountIds`. On load, a filter with `accountIds` and no `sourceFolderIds` is migrated to the Inbox of each of those accounts — the pre-2.1 default behavior — and `accountIds` is dropped. A filter whose account has no discoverable Inbox (e.g. "Local Folders") loses that account from its scope. Migration is idempotent and persists the result; it runs in both the background page and the options page.
- **Monitored-folders default.** On first run after upgrade, the global monitored list is seeded with every account's Inbox, so existing automatic filtering keeps working without configuration.
- **Manual "run on folder" is affected.** `runFiltersOnFolder` scans a folder's full contents rather than reacting to an event. It must apply the same source-folder scope check (or remain an explicit, user-confirmed tool) so the scan path is idempotent too.
- **First-match semantics are unchanged.** ADR-001's `consumed` set is in-run only and does not span events; scoping now handles the cross-event case that `consumed` never covered.
- **Cycle detection is best-effort.** Folders can be deleted or recreated, so the graph must be re-derived from current folder ids at save time and checked again on load; a broken reference degrades to "skip," not "loop."
- **`headerMessageId` availability is not guaranteed.** Some messages (e.g. some generated or very old mail) lack a Message-ID header, so any future identity-based feature must fall back or degrade, not assume it is present.
