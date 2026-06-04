# ADR-003: Eager address-book prefetch for the `in-address-book` condition

## Status
Accepted

## Date
2026-06-03

## Context

The `in-address-book` condition checks whether a message's sender email appears in any of the user's Thunderbird address books (including remote/CardDAV sources such as Google Contacts). Evaluating this condition requires data from outside the message itself — a set of known email addresses — which must be obtained via the `messenger.addressBooks` / `messenger.contacts` WebExtensions APIs.

The question is: when and how often should this data be fetched?

### Option A: Per-message lookup (on-demand)

For each message that reaches an `in-address-book` condition, call `messenger.contacts.quickSearch` to check whether the sender is a contact.

- **Pro**: No upfront cost when most messages are eliminated by earlier conditions.
- **Con**: One API round-trip per message that reaches the condition; the result cannot easily be shared across multiple filters in the same run; no way to pre-cancel in the evaluation loop.

### Option B: Eager prefetch (upfront, once per run)

Before the evaluation loop, call `messenger.addressBooks.list` + `messenger.contacts.list` for each book, build a `Set<string>` of lowercase emails, and pass it to every condition evaluation.

- **Pro**: One fetch per filter run regardless of message count; the `Set.has` lookup is O(1) and free; mirrors the proven pattern from ADR-002.
- **Con**: Fetches all contacts even when most messages are eliminated by header conditions before reaching the address-book check.

## Decision

Use eager prefetch (Option B), with two refinements:

1. **Guarded by `anyNeedsAddressBook`** — if no active filter uses `in-address-book`, the fetch is skipped entirely (`Promise.resolve(null)`).

2. **Parallel with full-message prefetch** — the address-book fetch is kicked off immediately (before the full-message batch loop) so the two I/O operations overlap:

   ```js
   const abFetchPromise = anyNeedsAddressBook ? fetchAddressBookEmails() : Promise.resolve(null);
   // ... full-message batch loop (yields on each await) ...
   const addressBookEmails = await abFetchPromise;
   ```

   The address-book call is typically much faster than fetching full message content for a large folder, so it will usually resolve during the first few batches.

## Consequences

- One `addressBooks.list` + N `contacts.list` calls per run (N = number of address books). For a typical user with 1–3 books this is negligible.
- The `Set` is held in memory for the duration of the scan (and GC'd after). For a user with 10,000 contacts this is ~1–2 MB of strings — acceptable.
- `background.js` follows the same pattern for the `onNewMailReceived` path: one prefetch per event, before the message loop.
- If a future condition type requires other external data (e.g., a header allowlist, a mailing-list membership), follow the same pattern: a `conditionNeedsX` function, a `fetchX` function, and a pre-loop kick-off that runs in parallel with any existing prefetches.
