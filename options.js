/**
 * options.js
 * Filter list management, condition tree editor, actions editor, run-now.
 */

// ── State ─────────────────────────────────────────────────────────────────

let allFilters = [];   // persisted filters
let editingFilter = null;  // deep copy being edited
let editingIndex = -1;     // index in allFilters (-1 = new)
let folderList = [];       // [{id, label, accountId}] populated on load
let accountList = [];      // [{id, name}] populated on load
let tagList = [];          // [{key, tag}] populated on load
let dragSrcIdx = null;     // index of filter being dragged

// ── Storage helpers ───────────────────────────────────────────────────────

async function loadFilters() {
  const data = await messenger.storage.local.get("filters");
  allFilters = data.filters || [];
}

async function saveFilters() {
  await messenger.storage.local.set({ filters: allFilters });
}

// ── Folder enumeration ────────────────────────────────────────────────────

async function buildFolderList() {
  folderList = [];
  accountList = [];
  const accounts = await messenger.accounts.list(true);
  for (const account of accounts) {
    accountList.push({ id: account.id, name: account.name });
    collectFolders(account.folders || [], account.name, account.id, folderList);
  }
}

async function loadTagList() {
  try {
    const tags = await messenger.messages.listTags();
    tagList = tags.map(t => ({ key: t.key, label: t.tag }));
  } catch {
    tagList = [];
  }
}

function collectFolders(folders, prefix, accountId, out) {
  for (const folder of folders) {
    const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
    out.push({ id: folder.id, label, accountId });
    if (folder.subFolders && folder.subFolders.length) {
      collectFolders(folder.subFolders, label, accountId, out);
    }
  }
}

function populateFolderSelect(selectEl, selectedId) {
  selectEl.innerHTML = "";
  for (const f of folderList) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    if (f.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

// ── Filter list rendering ─────────────────────────────────────────────────

function renderFilterList() {
  const list = document.getElementById("filter-list");
  const empty = document.getElementById("filter-list-empty");
  list.innerHTML = "";
  empty.classList.toggle("hidden", allFilters.length > 0);

  allFilters.forEach((filter, idx) => {
    const li = document.createElement("li");
    li.className = "filter-item" + (editingIndex === idx ? " active" : "");
    li.dataset.idx = idx;
    li.draggable = true;

    li.addEventListener("dragstart", e => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      dragSrcIdx = null;
      li.classList.remove("dragging");
      document.querySelectorAll(".filter-item.drag-over").forEach(el => el.classList.remove("drag-over"));
    });

    li.addEventListener("dragover", e => {
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".filter-item.drag-over").forEach(el => el.classList.remove("drag-over"));
      li.classList.add("drag-over");
    });

    li.addEventListener("dragleave", e => {
      if (!li.contains(e.relatedTarget)) li.classList.remove("drag-over");
    });

    li.addEventListener("drop", e => {
      e.preventDefault();
      li.classList.remove("drag-over");
      if (dragSrcIdx === null || dragSrcIdx === idx) return;

      const from = dragSrcIdx;
      const [moved] = allFilters.splice(from, 1);
      const to = from < idx ? idx - 1 : idx;
      allFilters.splice(to, 0, moved);

      if (editingIndex === from) {
        editingIndex = to;
      } else if (from < to && editingIndex > from && editingIndex <= to) {
        editingIndex--;
      } else if (from > to && editingIndex >= to && editingIndex < from) {
        editingIndex++;
      }

      dragSrcIdx = null;
      saveFilters();
      renderFilterList();
    });

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("click", e => e.stopPropagation());

    // Toggle
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    toggle.title = filter.enabled ? "Enabled" : "Disabled";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = filter.enabled;
    chk.addEventListener("change", e => {
      e.stopPropagation();
      allFilters[idx].enabled = chk.checked;
      saveFilters();
      nameSpan.className = "filter-item-name" + (chk.checked ? "" : " disabled");
      toggle.title = chk.checked ? "Enabled" : "Disabled";
    });
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    toggle.appendChild(chk);
    toggle.appendChild(slider);

    const nameSpan = document.createElement("span");
    nameSpan.className = "filter-item-name" + (filter.enabled ? "" : " disabled");
    nameSpan.textContent = filter.name || "(unnamed)";

    const actions = document.createElement("div");
    actions.className = "filter-item-actions";

    const runBtn = document.createElement("button");
    runBtn.className = "btn-icon btn-ghost";
    runBtn.title = "Run on folder…";
    runBtn.textContent = "▶";
    runBtn.addEventListener("click", e => {
      e.stopPropagation();
      openRunModal([filter]);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-icon btn-danger";
    delBtn.title = "Delete filter";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (confirm(`Delete filter "${filter.name || "(unnamed)"}"?`)) {
        allFilters.splice(idx, 1);
        saveFilters();
        if (editingIndex === idx) closeEditor();
        else if (editingIndex > idx) editingIndex--;
        renderFilterList();
      }
    });

    actions.appendChild(runBtn);
    actions.appendChild(delBtn);

    li.appendChild(handle);
    li.appendChild(toggle);
    li.appendChild(nameSpan);
    li.appendChild(actions);

    li.addEventListener("click", () => openEditor(idx));
    list.appendChild(li);
  });
}

// ── Editor open/close ─────────────────────────────────────────────────────

function openEditor(idx) {
  editingIndex = idx;
  editingFilter = JSON.parse(JSON.stringify(allFilters[idx]));
  document.getElementById("editor-title").textContent = "Edit Filter";
  document.getElementById("filter-name").value = editingFilter.name || "";
  document.getElementById("editor-panel").classList.remove("hidden");
  document.getElementById("editor-placeholder").classList.add("hidden");
  renderAccountsSection();
  renderConditionTree();
  renderActionsList();
  renderFilterList();
}

function openNewEditor() {
  editingIndex = -1;
  editingFilter = {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    accountIds: [],
    condition: { type: "and", children: [] },
    actions: []
  };
  document.getElementById("editor-title").textContent = "New Filter";
  document.getElementById("filter-name").value = "";
  document.getElementById("editor-panel").classList.remove("hidden");
  document.getElementById("editor-placeholder").classList.add("hidden");
  renderAccountsSection();
  renderConditionTree();
  renderActionsList();
  renderFilterList();
}

function closeEditor() {
  editingIndex = -1;
  editingFilter = null;
  document.getElementById("editor-panel").classList.add("hidden");
  document.getElementById("editor-placeholder").classList.remove("hidden");
  renderFilterList();
}

function hasLeafCondition(node) {
  if (node.type === "condition") return true;
  if (node.type === "not") return hasLeafCondition(node.child);
  if (node.type === "and" || node.type === "or") return node.children.some(hasLeafCondition);
  return false;
}

function saveEditor() {
  editingFilter.name = document.getElementById("filter-name").value.trim() || "Unnamed";
  if (!hasLeafCondition(editingFilter.condition)) {
    alert("Add at least one condition before saving.");
    return;
  }
  if (editingIndex === -1) {
    allFilters.push(editingFilter);
    editingIndex = allFilters.length - 1;
  } else {
    allFilters[editingIndex] = editingFilter;
  }
  saveFilters();
  renderFilterList();
  document.getElementById("editor-title").textContent = "Edit Filter";
}

// ── Account scope rendering ───────────────────────────────────────────────

function renderAccountsSection() {
  const container = document.getElementById("accounts-list");
  container.innerHTML = "";
  for (const account of accountList) {
    const label = document.createElement("label");
    label.className = "account-checkbox";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = (editingFilter.accountIds || []).includes(account.id);
    chk.addEventListener("change", () => {
      if (!editingFilter.accountIds) editingFilter.accountIds = [];
      if (chk.checked) {
        if (!editingFilter.accountIds.includes(account.id)) {
          editingFilter.accountIds.push(account.id);
        }
      } else {
        editingFilter.accountIds = editingFilter.accountIds.filter(id => id !== account.id);
      }
    });
    label.appendChild(chk);
    label.appendChild(document.createTextNode(" " + account.name));
    container.appendChild(label);
  }
}

// ── Condition tree rendering ──────────────────────────────────────────────

const FIELDS = [
  { value: "subject",    label: "Subject" },
  { value: "from",       label: "From" },
  { value: "to",         label: "To" },
  { value: "cc",         label: "CC" },
  { value: "bcc",        label: "BCC" },
  { value: "body",       label: "Body" },
  { value: "attachment", label: "Has attachment" },
];

const OPERATORS = [
  { value: "contains",     label: "contains" },
  { value: "not-contains", label: "does not contain" },
  { value: "is",           label: "is" },
  { value: "is-not",       label: "is not" },
  { value: "starts-with",  label: "starts with" },
  { value: "ends-with",    label: "ends with" },
  { value: "regex",        label: "matches regex" },
];

function renderConditionTree() {
  const container = document.getElementById("condition-tree");
  container.innerHTML = "";
  container.appendChild(buildNodeEl(editingFilter.condition, null, null));
}

function makeCaseToggle(node) {
  const label = document.createElement("label");
  label.className = "case-toggle";
  label.title = "Case sensitive";

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = node.caseSensitive === true;
  chk.addEventListener("change", () => { node.caseSensitive = chk.checked; });

  const text = document.createElement("span");
  text.textContent = "Aa";

  label.appendChild(chk);
  label.appendChild(text);
  return label;
}

/**
 * Build a DOM element for a ConditionNode.
 * @param {object} node - the node to render
 * @param {function|null} onDelete - called when this node should be removed (null = root)
 * @param {function|null} onReplace - called with a new node to replace this one in parent
 * @param {function|null} onDuplicate - called to insert a copy of this node after itself (null = root or NOT child)
 */
function buildNodeEl(node, onDelete, onReplace, onDuplicate) {
  const wrapper = document.createElement("div");
  wrapper.className = "node";

  if (node.type === "and" || node.type === "or") {
    wrapper.classList.add(node.type === "and" ? "group-and" : "group-or");
    const header = document.createElement("div");
    header.className = "node-header";

    const label = document.createElement("span");
    label.className = "group-label";
    label.textContent = node.type.toUpperCase();

    const toggleTypeBtn = document.createElement("button");
    toggleTypeBtn.className = "btn-secondary";
    toggleTypeBtn.textContent = node.type === "and" ? "Switch to OR" : "Switch to AND";
    toggleTypeBtn.addEventListener("click", () => {
      node.type = node.type === "and" ? "or" : "and";
      renderConditionTree();
    });

    const addCondBtn = document.createElement("button");
    addCondBtn.className = "btn-secondary";
    addCondBtn.textContent = "+ Condition";
    addCondBtn.addEventListener("click", () => {
      node.children.push({ type: "condition", field: "subject", operator: "contains", value: "", caseSensitive: false });
      renderConditionTree();
    });

    const addGroupBtn = document.createElement("button");
    addGroupBtn.className = "btn-secondary";
    addGroupBtn.textContent = "+ Group";
    addGroupBtn.addEventListener("click", () => {
      node.children.push({ type: "and", children: [] });
      renderConditionTree();
    });

    header.appendChild(label);
    header.appendChild(toggleTypeBtn);
    header.appendChild(addCondBtn);
    header.appendChild(addGroupBtn);

    if (onReplace) {
      const wrapBtn = document.createElement("button");
      wrapBtn.className = "btn-ghost";
      wrapBtn.textContent = "Wrap in NOT";
      wrapBtn.addEventListener("click", () => {
        onReplace({ type: "not", child: JSON.parse(JSON.stringify(node)) });
        renderConditionTree();
      });
      header.appendChild(wrapBtn);
    }

    if (onDuplicate) {
      const dupBtn = document.createElement("button");
      dupBtn.className = "btn-ghost";
      dupBtn.title = "Insert a copy of this group after it";
      dupBtn.textContent = "Duplicate";
      dupBtn.addEventListener("click", onDuplicate);
      header.appendChild(dupBtn);
    }

    if (onDelete) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-icon btn-danger";
      delBtn.title = "Remove this group";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", onDelete);
      header.appendChild(delBtn);
    }

    wrapper.appendChild(header);

    const children = document.createElement("div");
    children.className = "node-children";
    node.children.forEach((child, idx) => {
      const childEl = buildNodeEl(
        child,
        () => {
          node.children.splice(idx, 1);
          renderConditionTree();
        },
        (replacement) => {
          node.children[idx] = replacement;
          renderConditionTree();
        },
        (child.type === "condition") ? null : () => {
          node.children.splice(idx + 1, 0, JSON.parse(JSON.stringify(child)));
          renderConditionTree();
        }
      );
      children.appendChild(childEl);
    });
    wrapper.appendChild(children);

  } else if (node.type === "not") {
    wrapper.classList.add("group-not");
    const header = document.createElement("div");
    header.className = "node-header";

    const label = document.createElement("span");
    label.className = "group-label";
    label.textContent = "NOT";

    header.appendChild(label);

    const unwrapBtn = document.createElement("button");
    unwrapBtn.className = "btn-ghost";
    unwrapBtn.textContent = "Unwrap";
    unwrapBtn.addEventListener("click", () => {
      if (onReplace) {
        onReplace(JSON.parse(JSON.stringify(node.child)));
      }
      renderConditionTree();
    });
    header.appendChild(unwrapBtn);

    if (onDuplicate) {
      const dupBtn = document.createElement("button");
      dupBtn.className = "btn-ghost";
      dupBtn.title = "Insert a copy of this group after it";
      dupBtn.textContent = "Duplicate";
      dupBtn.addEventListener("click", onDuplicate);
      header.appendChild(dupBtn);
    }

    if (onDelete) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-icon btn-danger";
      delBtn.title = "Remove NOT";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", onDelete);
      header.appendChild(delBtn);
    }

    wrapper.appendChild(header);

    const childContainer = document.createElement("div");
    childContainer.className = "node-children";
    const childEl = buildNodeEl(
      node.child,
      null,
      (replacement) => {
        node.child = replacement;
        renderConditionTree();
      }
    );
    childContainer.appendChild(childEl);
    wrapper.appendChild(childContainer);

  } else {
    // Leaf condition
    const header = document.createElement("div");
    header.className = "node-header";

    const fieldSel = document.createElement("select");
    for (const f of FIELDS) {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label;
      if (f.value === node.field) opt.selected = true;
      fieldSel.appendChild(opt);
    }
    fieldSel.addEventListener("change", () => {
      node.field = fieldSel.value;
      if (node.field === "attachment") {
        node.operator = "is";
        node.value = "true";
      }
      renderConditionTree();
    });

    if (node.field === "attachment") {
      const valSel = document.createElement("select");
      [["true", "yes"], ["false", "no"]].forEach(([v, l]) => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = l;
        if (v === node.value) opt.selected = true;
        valSel.appendChild(opt);
      });
      valSel.addEventListener("change", () => { node.value = valSel.value; });

      header.appendChild(fieldSel);
      header.appendChild(valSel);
    } else {
      const opSel = document.createElement("select");
      for (const op of OPERATORS) {
        const opt = document.createElement("option");
        opt.value = op.value;
        opt.textContent = op.label;
        if (op.value === node.operator) opt.selected = true;
        opSel.appendChild(opt);
      }
      opSel.addEventListener("change", () => { node.operator = opSel.value; });

      const valInput = document.createElement("input");
      valInput.type = "text";
      valInput.value = node.value || "";
      valInput.placeholder = node.operator === "regex" ? "regular expression" : "value";
      valInput.addEventListener("input", () => { node.value = valInput.value; });
      opSel.addEventListener("change", () => {
        valInput.placeholder = opSel.value === "regex" ? "regular expression" : "value";
      });

      const caseToggle = makeCaseToggle(node);

      header.appendChild(fieldSel);
      header.appendChild(opSel);
      header.appendChild(valInput);
      header.appendChild(caseToggle);
    }

    if (onReplace) {
      const wrapBtn = document.createElement("button");
      wrapBtn.className = "btn-ghost";
      wrapBtn.textContent = "Wrap in NOT";
      wrapBtn.addEventListener("click", () => {
        onReplace({ type: "not", child: JSON.parse(JSON.stringify(node)) });
        renderConditionTree();
      });
      header.appendChild(wrapBtn);
    }

    if (onDelete) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-icon btn-danger";
      delBtn.title = "Remove condition";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", onDelete);
      header.appendChild(delBtn);
    }

    wrapper.appendChild(header);
  }

  return wrapper;
}

// ── Actions list rendering ────────────────────────────────────────────────

const ACTION_TYPES = [
  { value: "move",       label: "Move to folder" },
  { value: "mark-read",  label: "Mark as read" },
  { value: "mark-unread",label: "Mark as unread" },
  { value: "add-tag",    label: "Add tag" },
  { value: "remove-tag", label: "Remove tag" },
  { value: "mark-junk",  label: "Mark as junk" },
  { value: "delete",     label: "Delete (move to trash)" },
];

function renderActionsList() {
  const container = document.getElementById("actions-list");
  container.innerHTML = "";
  editingFilter.actions.forEach((action, idx) => {
    container.appendChild(buildActionRow(action, idx));
  });
}

function buildActionRow(action, idx) {
  const row = document.createElement("div");
  row.className = "action-row";

  const typeSel = document.createElement("select");
  for (const at of ACTION_TYPES) {
    const opt = document.createElement("option");
    opt.value = at.value;
    opt.textContent = at.label;
    if (at.value === action.type) opt.selected = true;
    typeSel.appendChild(opt);
  }

  const detail = document.createElement("div");
  detail.className = "action-detail";
  renderActionDetail(action, detail);

  typeSel.addEventListener("change", () => {
    action.type = typeSel.value;
    delete action.folderId;
    delete action.folderName;
    delete action.tag;
    renderActionDetail(action, detail);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "btn-icon btn-danger";
  delBtn.title = "Remove action";
  delBtn.textContent = "×";
  delBtn.addEventListener("click", () => {
    editingFilter.actions.splice(idx, 1);
    renderActionsList();
  });

  row.appendChild(typeSel);
  row.appendChild(detail);
  row.appendChild(delBtn);
  return row;
}

function renderActionDetail(action, container) {
  container.innerHTML = "";
  if (action.type === "move") {
    const sel = document.createElement("select");
    populateFolderSelect(sel, action.folderId);
    sel.addEventListener("change", () => {
      action.folderId = sel.value;
      const opt = sel.options[sel.selectedIndex];
      action.folderName = opt ? opt.textContent : "";
    });
    if (!action.folderId && folderList.length) {
      action.folderId = folderList[0].id;
      action.folderName = folderList[0].label;
    }
    container.appendChild(sel);
  } else if (action.type === "add-tag" || action.type === "remove-tag") {
    if (tagList.length > 0) {
      const sel = document.createElement("select");
      for (const t of tagList) {
        const opt = document.createElement("option");
        opt.value = t.key;
        opt.textContent = t.label;
        if (t.key === action.tag) opt.selected = true;
        sel.appendChild(opt);
      }
      if (!action.tag) action.tag = tagList[0].key;
      sel.addEventListener("change", () => { action.tag = sel.value; });
      container.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = action.tag || "";
      inp.placeholder = "tag key (e.g. $label1)";
      inp.addEventListener("input", () => { action.tag = inp.value; });
      container.appendChild(inp);
    }
  }
}

// ── Run-now modal ─────────────────────────────────────────────────────────

let runModalFilters = [];
let runModalIsSingle = false;

function openRunModal(filters) {
  runModalFilters = filters;
  runModalIsSingle = filters.length === 1;

  const title = document.getElementById("modal-title");
  const folderSel = document.getElementById("modal-folder-select");
  const progress = document.getElementById("modal-progress");
  const result = document.getElementById("modal-result");
  const dryRunBtn = document.getElementById("modal-dry-run");
  const confirmBtn = document.getElementById("modal-confirm");

  title.textContent = runModalIsSingle
    ? `Run "${filters[0].name}" on folder…`
    : "Run all filters on folder…";

  populateFolderSelect(folderSel);
  progress.classList.add("hidden");
  result.classList.add("hidden");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Run";
  confirmBtn.onclick = null;
  dryRunBtn.classList.toggle("hidden", !runModalIsSingle);

  document.getElementById("modal-overlay").classList.remove("hidden");
}

document.getElementById("modal-cancel").addEventListener("click", () => {
  document.getElementById("modal-overlay").classList.add("hidden");
});

document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-overlay")) {
    document.getElementById("modal-overlay").classList.add("hidden");
  }
});

async function executeModalRun(dryRun) {
  const folderSel = document.getElementById("modal-folder-select");
  const folderId = folderSel.value;
  if (!folderId) return;

  const selectedFolder = folderList.find(f => f.id === folderId);
  const accountId = selectedFolder?.accountId || null;

  const confirmBtn = document.getElementById("modal-confirm");
  const dryRunBtn = document.getElementById("modal-dry-run");
  const progress = document.getElementById("modal-progress");
  const progressFill = document.getElementById("modal-progress-fill");
  const progressText = document.getElementById("modal-progress-text");
  const result = document.getElementById("modal-result");

  confirmBtn.disabled = true;
  dryRunBtn.disabled = true;
  progress.classList.remove("hidden");
  result.classList.add("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "Loading messages…";

  try {
    const outcome = await runFiltersOnFolder(
      runModalFilters,
      folderId,
      ({ stage, done, total }) => {
        if (stage === "fetching") {
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          progressFill.style.width = pct + "%";
          progressText.textContent = `Fetching message content… ${done}/${total}`;
        }
      },
      dryRun,
      accountId
    );

    progressFill.style.width = "100%";
    progressText.textContent = "Done.";
    result.innerHTML = "";
    if (dryRun) {
      const summary = document.createElement("p");
      summary.textContent = `Dry run: ${outcome.matched} of ${outcome.total} messages would be affected.`;
      result.appendChild(summary);
      if (outcome.hits && outcome.hits.length > 0) {
        const ul = document.createElement("ul");
        ul.className = "dry-run-hits";
        for (const h of outcome.hits) {
          const li = document.createElement("li");
          const fromSpan = document.createElement("span");
          fromSpan.className = "hit-from";
          fromSpan.textContent = h.from || "(no sender)";
          const subjSpan = document.createElement("span");
          subjSpan.className = "hit-subject";
          subjSpan.textContent = h.subject || "(no subject)";
          li.appendChild(fromSpan);
          li.appendChild(subjSpan);
          ul.appendChild(li);
        }
        result.appendChild(ul);
      }
    } else {
      result.textContent = `Matched ${outcome.matched} of ${outcome.total} messages.`;
    }
    result.classList.remove("hidden");

    confirmBtn.textContent = "Close";
    confirmBtn.disabled = false;
    dryRunBtn.disabled = false;
    confirmBtn.onclick = () => {
      document.getElementById("modal-overlay").classList.add("hidden");
      confirmBtn.textContent = "Run";
      confirmBtn.onclick = null;
    };
  } catch (err) {
    progressText.textContent = "Error: " + err.message;
    confirmBtn.disabled = false;
    dryRunBtn.disabled = false;
  }
}

document.getElementById("modal-confirm").addEventListener("click", () => executeModalRun(false));
document.getElementById("modal-dry-run").addEventListener("click", () => executeModalRun(true));

// ── Wire up top-level buttons ─────────────────────────────────────────────

document.getElementById("btn-new-filter").addEventListener("click", openNewEditor);

document.getElementById("btn-run-all").addEventListener("click", () => {
  openRunModal(allFilters.filter(f => f.enabled));
});

document.getElementById("btn-save").addEventListener("click", () => {
  saveEditor();
});

document.getElementById("btn-cancel").addEventListener("click", () => {
  closeEditor();
});

document.getElementById("btn-add-action").addEventListener("click", () => {
  editingFilter.actions.push({ type: "mark-read" });
  renderActionsList();
});

// ── Init ──────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all([loadFilters(), buildFolderList(), loadTagList()]);
  renderFilterList();
})();
