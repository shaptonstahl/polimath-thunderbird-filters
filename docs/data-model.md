# Data model

Filters, folders, and the global monitored list are persisted in `storage.local`. A filter is
scoped to a subset of the monitored folders via `sourceFolderIds`; its `ending` (when a move)
points at a destination folder. The background page and the options page each load and
(idempotently) migrate this data on start.

## Stored filter data

```mermaid
---
title: Stored filter data
---
erDiagram
  FILTER ||--o{ ACTION : contains
  FILTER }o--o{ FOLDER : "scoped to (sourceFolderIds)"
  FILTER }o--o{ FOLDER : "moves to (ending.folderId)"
  FILTER { uuid id  string name  bool enabled }
  FOLDER { string id  string label  string accountId }
  ACTION { string type  string tag }
```

**Figure.** A filter owns zero or more actions and one mutually-exclusive `ending`
(continue, move, or delete); a move ending references a destination folder by id.

## Move graph

A move ending draws an edge from each folder in its filter's source scope to its destination.
Save-time validation rejects any configuration whose move graph contains a cycle — that is the
one shape source-folder scoping alone cannot make idempotent.

```mermaid
---
title: Move graph with a cycle
---
flowchart LR
  classDef store  fill:#ddf3eb,stroke:#1baf7a,color:#0b0b0b
  classDef policy fill:#e4e1f2,stroke:#4a3aa7,color:#0b0b0b
  A[(Inbox)]:::store --> F1{{Filter 1 scope Inbox}}:::policy --> B[(Bills)]:::store
  B --> F2{{Filter 2 scope Bills}}:::policy --> A
```

**Figure.** Filter 1 (Inbox→Bills) and Filter 2 (Bills→Inbox) close a cycle; the save-time check
rejects the pair so a message cannot bounce between the two folders forever.
