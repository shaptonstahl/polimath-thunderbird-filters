# ADR-004: Unicode confusables operators (`has-confusable` and `confusable-with`)

## Status
Accepted

## Date
2026-06-03

## Context

Phishing and spam emails frequently substitute visually identical Unicode characters for ASCII letters to evade keyword-based filters. Common examples:

- Cyrillic С (U+0421) in place of Latin C
- Greek ο (U+03BF) in place of Latin o
- Digit zero (U+0030) in place of letter O
- Full-width or script variants of common brand names

A user who creates a filter for "costco" would not catch an email containing "С0ЅТС0" (Cyrillic С, digit zero, Cyrillic Ѕ, Cyrillic Т, Cyrillic С, digit zero), even though the two strings look identical in most fonts.

The Unicode Consortium publishes a canonical list of such lookalike characters in [Unicode TR39 confusables.txt](https://www.unicode.org/Public/security/latest/confusables.txt). TR39 defines a *skeleton* function: replace each character with its confusable prototype sequence, then NFD-normalize. Two strings with identical skeletons are considered confusable.

### Design decisions

#### 1. Which subset of confusables.txt to include

**Option A: Non-ASCII sources only** — Keep only entries where the source codepoint is > U+007E.

- Pro: Smaller map; `has-confusable` would not need a separate ASCII guard.
- Con: Misses cases where ASCII characters confuse *with each other* (e.g., digit `0` → letter `O`). A filter for "costco" would not catch "C0STC0" (with an ASCII zero).

**Option B: All entries** — Include every source codepoint, including ASCII ones.

- Pro: `confusable-with "costco"` catches both "С0ЅТС0" (Cyrillic) and "C0STC0" (ASCII zero).
- Con: `has-confusable` must explicitly exclude ASCII sources (cp ≤ U+007E) to avoid flagging ordinary text containing digits or punctuation.

**Decision:** Option B. The `has-confusable` operator guards with `cp > 0x7e` to exclude ASCII sources; `confusable-with` uses the full map so ASCII lookalikes are caught.

#### 2. Case folding order in `confusable-with`

The naive approach — `toLowerCase` then `skeletonize` — fails because Unicode `.toLowerCase()` changes codepoints before the skeleton map is applied. For example, Cyrillic uppercase С (U+0421) lowercases to с (U+0441), which is a different map entry than С.

More importantly, some skeleton targets are uppercase ASCII. Digit zero (U+0030) maps to `"O"` (capital O). Lowercasing first then skeletonizing would produce `"cOstcO"` for `"C0STC0"`, which does not match `"costco"`.

**Decision:** Skeletonize first, then apply `toLowerCase`. This ensures all uppercase targets produced by the skeleton step are folded down uniformly, regardless of where they came from.

#### 3. Single-pass vs. iterative skeleton

The full TR39 skeleton algorithm is transitive: it applies the confusables map repeatedly until no more substitutions are possible. This handles chains like `A → B → C` where intermediate characters are themselves confusable.

In practice, confusables.txt is structured so that targets are already prototypes (no entry maps to another entry's source). A single pass is sufficient for all entries in the current dataset.

**Decision:** Single-pass replacement. If a future Unicode release introduces transitive chains, the pass can be added without changing the operator API.

#### 4. Multi-codepoint source sequences

Some entries in confusables.txt have multi-codepoint sources (e.g., a digraph that as a whole is confusable with a single character). Handling these correctly requires substring matching rather than character-by-character replacement, significantly complicating the implementation.

Multi-codepoint sources are rare and cover mostly archaic scripts. They are skipped by the build script.

**Decision:** Skip multi-codepoint sources. The overwhelming majority of spam-relevant confusables have single-codepoint sources.

#### 5. Data loading strategy

Confusables data (6,565 entries) is generated at build time by `scripts/build-confusables.js`, which fetches `confusables.txt` directly from the Unicode Consortium and emits a static `confusables-data.js` file. This file sets `self.CONFUSABLES_MAP` (a `Map<number, string>`) in the global scope before `filter-engine.js` loads.

**Alternatives considered:**

- *Fetch at extension startup* — Adds network dependency to the runtime path; would fail offline.
- *Bundle confusables.txt raw and parse at startup* — Parsing ~5 MB of text on every extension load is wasteful.
- *Hardcode a curated subset* — Would require manual maintenance and miss entries.

**Decision:** Pre-process at build time, commit the generated JS, regenerate in CI during XPI packaging. The generated file is the authoritative runtime source; CI ensures it stays current with the Unicode release used at build time.

#### 6. Graceful degradation

`filter-engine.js` is loaded in the test suite via `vm.runInContext` without `confusables-data.js`. Both operators guard against a missing map:

- `skeletonize` returns the input string unchanged if `CONFUSABLES_MAP` is not defined.
- `has-confusable` returns `false` if the map is absent.
- `confusable-with` returns `false` (via `skeletonize` returning the original strings unmodified, so a Cyrillic string will not match its ASCII equivalent).

## Decision

Add two new filter operators backed by a pre-processed Unicode TR39 confusables map:

- **`has-confusable`** — true if the field contains any non-ASCII character (cp > U+007E) present in the confusables map. Useful for broad detection of homoglyph abuse without specifying a target word.
- **`confusable-with <value>`** — true if `skeletonize(field).toLowerCase()` contains `skeletonize(value).toLowerCase()` (for case-insensitive mode). Lets a user write `"costco"` to match `"С0ЅТС0"`, `"Ⅽostco"`, etc.

The `NO_VALUE_OPS` set in `options.js` hides the value input and case-sensitivity toggle in the UI when `has-confusable` is selected.

## Consequences

- Adds ~200 KB to the extension (the generated `confusables-data.js`).
- `skeletonize` calls `String.prototype.normalize("NFD")` twice per invocation (input and output). For email bodies this is acceptable; NFD normalization is O(n) and native.
- The Unicode data version is pinned at build time and recorded in the file header. CI regenerates on each XPI build, so the shipped extension always uses the Unicode version current at release time.
- If a future condition type also requires per-character Unicode lookups, it can share `skeletonize` and `CONFUSABLES_MAP` without additional data loading.
