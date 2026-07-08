# Polimath Filters — Agent Context

## What this is

A Thunderbird MailExtension (Manifest V2) that replaces the built-in filter editor. No server, no build step, no external runtime dependencies. Three JS files run directly in Thunderbird's extension context.

## Commands

```sh
npm test                  # Run the filter-engine test suite (Node 18+)
npm run build:confusables # Re-fetch Unicode confusables.txt and regenerate confusables-data.js
```

`confusables-data.js` is a committed generated file. Regenerate it when updating the Unicode data version. The XPI build step runs `build:confusables` automatically before packaging.

## Architecture

```
confusables-data.js  Generated — sets self.CONFUSABLES_MAP (Unicode TR39 lookalike data)
filter-engine.js     Pure evaluation logic — no DOM, no Thunderbird API calls (except messenger, injected)
background.js        Listens for new mail, loads filters from storage, calls filter-engine
options.js           Options page UI — filter list, condition tree editor, run-on-folder modal
scripts/
  build-confusables.js  Fetches confusables.txt from unicode.org, writes confusables-data.js
```

`confusables-data.js` is loaded before `filter-engine.js` in both the background page and the options page. `filter-engine.js` accesses `CONFUSABLES_MAP` as a direct global; if the file is absent (e.g., in test contexts that don't load it), both confusables operators degrade gracefully.

`filter-engine.js` is loaded in both the background page and the options page. It must stay dependency-free and DOM-free so the test suite can run it in Node.js via `vm.runInContext`.

## Testing approach

The test suite (`test/filter-engine.test.js`) uses Node.js built-in `node:test` and `node:vm`. It creates isolated VM contexts to inject a mock `messenger` object, then loads `filter-engine.js` into that context. This allows testing a browser-extension script in Node without a browser.

- Pure-function tests share a single context (`const E = makeContext()`).
- Action-tracking tests create a fresh context per test via `makeContext(messages, fullMessages, contactEmails)` so `calls` arrays don't bleed between tests. `contactEmails` is an array of address strings used to populate the mock `messenger.addressBooks`/`messenger.contacts`.
- Tests that need confusables operators pass a fourth argument `confusablesMap` to `makeContext()`. Do not load `confusables-data.js` in tests — inject a small hand-crafted `Map` instead. `TEST_CONFUSABLES_MAP` at the top of the test file is the shared fixture.

Do not introduce external test dependencies. Do not mock the DOM — options.js is not tested by the automated suite.

## Key design decisions

- **First-match semantics**: for each message, filters are evaluated in list order and evaluation stops at the first match. This mirrors Thunderbird's built-in filter runner. See `docs/decisions/ADR-001-first-match-and-consumed-messages.md`.
- **Eager full-message prefetch**: when any active filter needs body/cc/bcc, `runFiltersOnFolder` fetches full content for all messages up front in parallel batches of 10 before evaluating any conditions. The trade-off is documented in `docs/decisions/ADR-002-eager-full-message-prefetch.md`.
- **Eager address-book prefetch**: same pattern as full-message prefetch — when any active filter uses `in-address-book`, `fetchAddressBookEmails` is called once before the evaluation loop and kicked off in parallel with full-message prefetching. Documented in `docs/decisions/ADR-003-eager-address-book-prefetch.md`.
- **`conditionNeedsProp(node, predicate)`**: the generic tree-walk helper for detecting whether a condition tree touches any field matching a predicate. Both `conditionNeedsFullMessage` and `conditionNeedsAddressBook` delegate to it. Add new external-data condition checks the same way.
- **`BOOLEAN_FIELDS` Set in `options.js`**: controls which fields render as a yes/no select (no operator, no text input). Add new boolean-style fields here in addition to `getField`.
- **`NO_VALUE_OPS` Set in `options.js`**: controls which operators hide the value input and case-sensitivity toggle in the condition editor. Add operators that take no value here (e.g., `has-confusable`).
- **Regex caching**: compiled regexes are cached by `pattern\x00caseSensitive` key for the lifetime of the page. The null-byte separator is intentional — it cannot appear in a user-supplied pattern or boolean.
- **`CONFUSABLES_MAP` global**: set by `confusables-data.js` before `filter-engine.js` loads. `filter-engine.js` guards all accesses with `typeof CONFUSABLES_MAP !== "undefined"` so the engine degrades gracefully when the data file is absent. See `docs/decisions/ADR-004-unicode-confusables-operators.md` for the full design rationale.
- **`skeletonize` order**: skeletonize before case-folding (`toLowerCase`). Some skeleton targets are uppercase ASCII (e.g., digit `0` → `"O"`); case-folding first would produce wrong codepoints before the map lookup. See ADR-004.
- **`collectFolders` returns a value**: the helper returns an array (not an output-parameter accumulator) to match modern JS conventions.

## Conventions

- No comments that restate the code. Comments only for non-obvious invariants or workarounds.
- Section dividers use `// ── Name ──────────` style.
- `messenger` is the global Thunderbird WebExtensions API — treat it like `browser` in Firefox extensions.
- Async/await throughout. No callbacks, no `.then()` chains.
- `JSON.parse(JSON.stringify(x))` is the intentional deep-clone idiom for filter objects. Do not replace with `structuredClone` without testing that Thunderbird's JS environment supports it.
- Before a git commit suggest a new version number. First digit is a breaking change, second is a standard feature, third is a bug fix.
