# Diagrams

This file is the single legend and inventory for every Mermaid diagram in this repo. Roles come
from one fixed palette; the same thing is the same color in every figure. Read the layer table
to know which kind of question each diagram answers.

## Layers

| Layer | Question it answers | Diagram types |
|---|---|---|
| UX/UI | What does a person see and do, in what order? | `journey`, `sequenceDiagram`, `stateDiagram-v2` |
| Data | What is stored, how is it shaped, how does a record change state? | `erDiagram`, `stateDiagram-v2`, `flowchart` |
| Infrastructure | What runs where, what talks to what? | `flowchart`, `sequenceDiagram` |
| Security/trust | Who may do what, where is the trust edge? | `flowchart` with `boundary` subgraphs |

One layer per figure. The red `boundary` subgraph appears only in security/trust figures.

## Legend

```mermaid
flowchart LR
  classDef process  fill:#dfebf9,stroke:#2a78d6,color:#0b0b0b
  classDef person   fill:#fce8e1,stroke:#eb6834,color:#0b0b0b
  classDef store    fill:#ddf3eb,stroke:#1baf7a,color:#0b0b0b
  classDef channel  fill:#fcf1d9,stroke:#eda100,color:#0b0b0b
  classDef policy   fill:#e4e1f2,stroke:#4a3aa7,color:#0b0b0b
  classDef external fill:#ededec,stroke:#898781,stroke-dasharray:4 3,color:#0b0b0b
  classDef good     fill:#dff3df,stroke:#0ca30c,color:#0b0b0b
  classDef warning  fill:#fdf0d1,stroke:#fab219,color:#0b0b0b
  classDef critical fill:#f8e2e2,stroke:#d03b3b,color:#0b0b0b
  L1([person - a human]):::person
  L2[process - our code that runs]:::process
  L3[(store - data at rest)]:::store
  L4[/channel - transport or message path/]:::channel
  L5{{policy - rules and configuration}}:::policy
  L6[external - a system we do not control]:::external
  L7[good - terminal success]:::good
  L8[warning - waiting or degraded]:::warning
  L9[critical - rejected or failed]:::critical
  subgraph trust [boundary - trust or network edge]
    L2
    L3
  end
  style trust fill:none,stroke:#e34948,stroke-dasharray:6 4
```

## Inventory

| Figure | File | Layer | Question it answers |
|---|---|---|---|
| New-mail main loop | `docs/architecture.md` | infrastructure | Why does a moved message not loop forever when it re-fires the new-mail event? |
| Stored filter data | `docs/data-model.md` | data | How do filters, folders, and actions relate in storage? |
| Move graph | `docs/data-model.md` | data | Where does a move cycle come from, and what does save-time detection reject? |

Dependency note: validation uses `scripts/check-diagrams.sh` from the `polimath-doc-diagrams`
skill. Rendering needs nothing; validation needs Node >= 18, `npx`, and a Chromium-family browser.
