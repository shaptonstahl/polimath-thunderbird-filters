# ADR-008: Schema versions and one migration pipeline

## Status

Proposed (target v3.3.0)

## Context

Filter data has changed shape four times (see `docs/plans/2026-11-20-filter-safety.md`). Each change
added an ad-hoc, shape-detecting migration that runs on load. Import ran none of them, so legacy
exports were stored raw and did nothing until a restart. Shape detection also cannot tell schema 1
from schema 2: an empty `accountIds` meant "all accounts" before 2.0.0 and "no accounts" after, so
a v1 export loses its scope when migrated as if it were v2.

## Decision

- Stored data and exports carry an integer `schemaVersion` (current: 4).
- Exports are identified by `schemaVersion`, else by `extensionVersion` (present since 1.8.0); stored
  data without a version is identified by shape.
- A single pure `migrateFilters(filters, fromSchema, env)` chains per-step migrations and returns
  `{ filters, warnings }`. Import, restore, background startup and options-page load all use it.
- Data from a newer schema is never migrated downward: import refuses it and names the version needed.
- Every lossy or judgement-call step emits a warning tied to a filter id.

## Consequences

- One place to add the next migration; each step is unit-tested from synthetic fixtures.
- Warnings become user-visible in the import dialog instead of silent.
- `migrateFiltersToSourceFolders` and `migrateFiltersToEnding` become steps of the pipeline.
