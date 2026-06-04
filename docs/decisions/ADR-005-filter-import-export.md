# ADR-005: Filter Import / Export

## Status

Accepted (v1.8.0)

## Context

Users need a way to back up their filters, migrate them across Thunderbird profiles or machines, and share filter sets with others. Thunderbird's built-in filter editor has no export capability, so this extension must provide its own.

## Decision

Filters are exported as a JSON file with an envelope of metadata. The file may be imported on the same or a different machine. Conflicts (imported filter names that match existing filter names) are surfaced before the import completes.

### Export file format

```json
{
  "exportedBy": "Polimath Filters",
  "extensionVersion": "1.8.0",
  "exportedAt": "2026-06-04T12:00:00.000Z",
  "platform": "Windows",
  "filterCount": 3,
  "filters": [ ...filter objects verbatim from storage... ]
}
```

Filter objects are exported verbatim (including `id`). The envelope carries enough context to diagnose compatibility issues without needing to inspect the filters themselves.

### Import behavior

- On import, each incoming filter receives a new `crypto.randomUUID()` id, so imported filters never collide with existing ones at the storage level.
- Conflict detection compares filter **names** (not ids). If an imported filter's name matches an existing filter's name, the row is highlighted and a "Compare…" button appears.
- The compare view shows both filter definitions (without `id`) side-by-side, each with an editable name field. Renaming either side updates the underlying data in real time. Renaming the existing filter persists to storage immediately; renaming the import candidate updates only the in-memory import state.
- The user selects which imported filters to keep via checkboxes (all checked by default) and confirms before anything is written to storage.

## Rationale

**Why JSON?** Human-readable, lossless round-trip, requires no schema migration for import, and matches the storage format already used by the extension.

**Why name-based conflict detection instead of id-based?** Exported ids are the ids from the source machine. On import, ids are replaced anyway, so id-based collision would never trigger. Name collision is the meaningful semantic conflict from the user's perspective.

**Why rename in the compare view rather than prompting before import?** Side-by-side visibility lets the user make an informed rename decision rather than guessing blindly from a prompt.

## Consequences

- `folderId` values in `move` actions reference folders on the source machine and will not resolve on the target machine. The import modal warns users when any incoming filter contains a `move` action.
- The `enabled` state of each filter is preserved as exported. Users can toggle individual filters after import.
- Deleting a filter and re-importing does not restore its original id (a new UUID is always assigned). This is intentional — ids are internal references, not user-facing identifiers.
