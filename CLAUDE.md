# Polimath Filters — Agent Context

## What this is

A Thunderbird MailExtension (Manifest V2) that replaces the built-in filter editor. No server, no build step, no external runtime dependencies. Three JS files run directly in Thunderbird's extension context.

## Commands

```sh
npm test          # Run the filter-engine test suite (Node 18+)
```

No lint, no build, no bundle. The extension loads source files directly.

## Architecture

```
filter-engine.js   Pure evaluation logic — no DOM, no Thunderbird API calls (except messenger, injected)
background.js      Listens for new mail, loads filters from storage, calls filter-engine
options.js         Options page UI — filter list, condition tree editor, run-on-folder modal
```

`filter-engine.js` is loaded in both the background page and the options page. It must stay dependency-free and DOM-free so the test suite can run it in Node.js via `vm.runInContext`.

## Testing approach

The test suite (`test/filter-engine.test.js`) uses Node.js built-in `node:test` and `node:vm`. It creates isolated VM contexts to inject a mock `messenger` object, then loads `filter-engine.js` into that context. This allows testing a browser-extension script in Node without a browser.

- Pure-function tests share a single context (`const E = makeContext()`).
- Action-tracking tests create a fresh context per test via `makeContext(messages, fullMessages)` so `calls` arrays don't bleed between tests.

Do not introduce external test dependencies. Do not mock the DOM — options.js is not tested by the automated suite.

## Key design decisions

- **First-match semantics**: for each message, filters are evaluated in list order and evaluation stops at the first match. This mirrors Thunderbird's built-in filter runner. See `docs/decisions/ADR-001-first-match-and-consumed-messages.md`.
- **Eager full-message prefetch**: when any active filter needs body/cc/bcc, `runFiltersOnFolder` fetches full content for all messages up front in parallel batches of 10 before evaluating any conditions. The trade-off is documented in `docs/decisions/ADR-002-eager-full-message-prefetch.md`.
- **Regex caching**: compiled regexes are cached by `pattern\x00caseSensitive` key for the lifetime of the page. The null-byte separator is intentional — it cannot appear in a user-supplied pattern or boolean.
- **`collectFolders` returns a value**: the helper returns an array (not an output-parameter accumulator) to match modern JS conventions.

## Conventions

- No comments that restate the code. Comments only for non-obvious invariants or workarounds.
- Section dividers use `// ── Name ──────────` style.
- `messenger` is the global Thunderbird WebExtensions API — treat it like `browser` in Firefox extensions.
- Async/await throughout. No callbacks, no `.then()` chains.
- `JSON.parse(JSON.stringify(x))` is the intentional deep-clone idiom for filter objects. Do not replace with `structuredClone` without testing that Thunderbird's JS environment supports it.
