/**
 * filter-engine.js
 * Pure filter evaluation and action execution. No UI, no events.
 * Loaded in both background.js and options.js contexts.
 */

// ── Field extraction ────────────────────────────────────────────────────────

function extractBodyText(parts) {
  if (!parts) return "";
  let text = "";
  for (const part of parts) {
    if (part.contentType === "text/plain" && part.body) {
      text += part.body + "\n";
    } else if (part.contentType === "text/html" && part.body) {
      text += part.body.replace(/<[^>]*>/g, " ") + "\n";
    }
    if (part.parts) {
      text += extractBodyText(part.parts);
    }
  }
  return text;
}

function getField(field, message, fullMessage) {
  switch (field) {
    case "subject":
      return message.subject || "";
    case "from":
      return message.author || "";
    case "to":
      return (message.recipients || []).join(", ");
    case "cc":
      return fullMessage ? (fullMessage.headers.cc || []).join(", ") : "";
    case "bcc":
      return fullMessage ? (fullMessage.headers.bcc || []).join(", ") : "";
    case "body":
      return fullMessage ? extractBodyText(fullMessage.parts) : "";
    case "attachment":
      return message.hasAttachment ? "true" : "false";
    default:
      return "";
  }
}

// ── Operator matching ────────────────────────────────────────────────────────

function applyOperator(operator, fieldValue, conditionValue, caseSensitive) {
  const fv = caseSensitive ? fieldValue : fieldValue.toLowerCase();
  const cv = caseSensitive ? conditionValue : conditionValue.toLowerCase();
  switch (operator) {
    case "contains":
      return fv.includes(cv);
    case "not-contains":
      return !fv.includes(cv);
    case "is":
      return fv === cv;
    case "is-not":
      return fv !== cv;
    case "starts-with":
      return fv.startsWith(cv);
    case "ends-with":
      return fv.endsWith(cv);
    case "regex":
      try {
        return new RegExp(conditionValue, caseSensitive ? "" : "i").test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ── Condition needs full message? ────────────────────────────────────────────

function conditionNeedsFullMessage(node) {
  if (node.type === "condition") {
    return node.field === "body" || node.field === "cc" || node.field === "bcc";
  }
  if (node.type === "not") {
    return conditionNeedsFullMessage(node.child);
  }
  if (node.type === "and" || node.type === "or") {
    return node.children.some(conditionNeedsFullMessage);
  }
  return false;
}

// ── Condition tree evaluation ────────────────────────────────────────────────

function evaluateNode(node, message, fullMessage) {
  if (node.type === "and") {
    return node.children.every(child => evaluateNode(child, message, fullMessage));
  }
  if (node.type === "or") {
    return node.children.some(child => evaluateNode(child, message, fullMessage));
  }
  if (node.type === "not") {
    return !evaluateNode(node.child, message, fullMessage);
  }
  if (node.type === "condition") {
    const fieldValue = getField(node.field, message, fullMessage);
    return applyOperator(node.operator, fieldValue, node.value || "", node.caseSensitive === true);
  }
  return false;
}

// ── Action execution ─────────────────────────────────────────────────────────

async function executeAction(action, message) {
  const id = message.id;
  switch (action.type) {
    case "move":
      await messenger.messages.move([id], action.folderId);
      break;
    case "mark-read":
      await messenger.messages.update(id, { read: true });
      break;
    case "mark-unread":
      await messenger.messages.update(id, { read: false });
      break;
    case "add-tag": {
      const current = await messenger.messages.get(id);
      const tags = current.tags || [];
      if (!tags.includes(action.tag)) {
        await messenger.messages.update(id, { tags: [...tags, action.tag] });
      }
      break;
    }
    case "remove-tag": {
      const current = await messenger.messages.get(id);
      const tags = (current.tags || []).filter(t => t !== action.tag);
      await messenger.messages.update(id, { tags });
      break;
    }
    case "mark-junk":
      await messenger.messages.update(id, { junk: true });
      break;
    case "delete":
      await messenger.messages.delete([id], false);
      break;
  }
}

async function executeActions(actions, message) {
  for (const action of actions) {
    try {
      await executeAction(action, message);
    } catch (err) {
      console.error("Polimath Filters: action failed", action.type, err);
    }
  }
}

// ── Top-level filter runner ──────────────────────────────────────────────────

/**
 * Run a single filter against a message. Returns true if the filter matched.
 * fullMessage may be null if you know the filter doesn't need body/cc/bcc.
 * When dryRun is true, evaluates the condition but skips executing actions.
 */
async function runFilter(filter, message, fullMessage, dryRun = false) {
  if (!filter.enabled) return false;
  const matched = evaluateNode(filter.condition, message, fullMessage);
  if (matched && !dryRun) {
    await executeActions(filter.actions, message);
  }
  return matched;
}

/**
 * Collect all message pages from a folder into an array.
 * Returns an array of message header objects.
 */
async function fetchAllMessages(folderId) {
  let page = await messenger.messages.list(folderId);
  const all = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    all.push(...page.messages);
  }
  return all;
}

/**
 * Run a set of filters on all messages in a folder using the optimized
 * rule-centric algorithm:
 *   - Fetch all headers once.
 *   - For each rule, iterate available messages.
 *   - Pre-fetch full content in parallel batches when needed.
 *   - Remove consumed (moved/deleted) messages from subsequent rules.
 *
 * Returns { matched: number, total: number }.
 * When dryRun is true, conditions are evaluated but actions are never executed.
 */
async function runFiltersOnFolder(filters, folderId, onProgress, dryRun = false) {
  const enabledFilters = filters.filter(f => f.enabled);
  if (enabledFilters.length === 0) return { matched: 0, total: 0 };

  const allMessages = await fetchAllMessages(folderId);
  const total = allMessages.length;
  const available = new Map(allMessages.map(m => [m.id, m]));
  const fullCache = new Map();

  let matched = 0;

  for (const filter of enabledFilters) {
    const needsFull = conditionNeedsFullMessage(filter.condition);
    const ids = [...available.keys()];

    if (needsFull) {
      const uncached = ids.filter(id => !fullCache.has(id));
      const BATCH = 10;
      for (let i = 0; i < uncached.length; i += BATCH) {
        const batch = uncached.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(id => messenger.messages.getFull(id).catch(() => null))
        );
        for (let j = 0; j < batch.length; j++) {
          if (results[j]) fullCache.set(batch[j], results[j]);
        }
        if (onProgress) onProgress({ stage: "fetching", done: i + batch.length, total: uncached.length });
      }
    }

    const consumed = [];
    for (const id of ids) {
      const message = available.get(id);
      const fullMessage = needsFull ? (fullCache.get(id) || null) : null;
      const hit = await runFilter(filter, message, fullMessage, dryRun);
      if (hit) {
        matched++;
        const movesOrDeletes = filter.actions.some(
          a => a.type === "move" || a.type === "delete"
        );
        if (movesOrDeletes && !dryRun) consumed.push(id);
      }
    }
    for (const id of consumed) {
      available.delete(id);
      fullCache.delete(id);
    }
  }

  return { matched, total };
}
