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

function getField(field, message, fullMessage, addressBookEmails = null) {
  switch (field) {
    case "subject":
      return message.subject || "";
    case "from":
      return message.author || "";
    case "from-name": {
      const author = message.author || "";
      const m = author.match(/^(.+?)\s*</);
      return m ? m[1].trim() : "";
    }
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
    case "in-address-book": {
      const author = message.author || "";
      const m = author.match(/<([^>]+)>/) || author.match(/(\S+@\S+)/);
      const email = (m ? m[1] : author).toLowerCase();
      return addressBookEmails?.has(email) ? "true" : "false";
    }
    default:
      return "";
  }
}

// ── Operator matching ────────────────────────────────────────────────────────

const _regexCache = new Map();

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
    case "regex": {
      const key = conditionValue + "\x00" + caseSensitive;
      let re = _regexCache.get(key);
      if (re === undefined) {
        try { re = new RegExp(conditionValue, caseSensitive ? "" : "i"); }
        catch { re = null; }
        _regexCache.set(key, re);
      }
      return re ? re.test(fieldValue) : false;
    }
    default:
      return false;
  }
}

// ── Condition needs full message? ────────────────────────────────────────────

function conditionNeedsProp(node, predicate) {
  if (node.type === "condition") return predicate(node.field);
  if (node.type === "not") return conditionNeedsProp(node.child, predicate);
  if (node.type === "and" || node.type === "or") return node.children.some(c => conditionNeedsProp(c, predicate));
  return false;
}

function conditionNeedsFullMessage(node) {
  return conditionNeedsProp(node, f => f === "body" || f === "cc" || f === "bcc");
}

function conditionNeedsAddressBook(node) {
  return conditionNeedsProp(node, f => f === "in-address-book");
}

// ── Address book helpers ─────────────────────────────────────────────────────

async function fetchAddressBookEmails() {
  const books = await messenger.addressBooks.list({ includeRemote: true });
  const allContacts = await Promise.all(books.map(b => messenger.contacts.list(b.id)));
  const emails = new Set();
  for (const contacts of allContacts) {
    for (const c of contacts) {
      if (c.properties?.PrimaryEmail) emails.add(c.properties.PrimaryEmail.toLowerCase());
      if (c.properties?.SecondEmail) emails.add(c.properties.SecondEmail.toLowerCase());
    }
  }
  return emails;
}

// ── Condition tree evaluation ────────────────────────────────────────────────

function evaluateNode(node, message, fullMessage, addressBookEmails = null) {
  if (node.type === "and") {
    return node.children.every(child => evaluateNode(child, message, fullMessage, addressBookEmails));
  }
  if (node.type === "or") {
    return node.children.some(child => evaluateNode(child, message, fullMessage, addressBookEmails));
  }
  if (node.type === "not") {
    return !evaluateNode(node.child, message, fullMessage, addressBookEmails);
  }
  if (node.type === "condition") {
    const fieldValue = getField(node.field, message, fullMessage, addressBookEmails);
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
async function runFilter(filter, message, fullMessage, dryRun = false, addressBookEmails = null) {
  if (!filter.enabled) return false;
  const matched = evaluateNode(filter.condition, message, fullMessage, addressBookEmails);
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
 * Run a set of filters on all messages in a folder.
 * Uses message-centric first-match semantics (same as incoming-mail processing):
 *   - Fetch all headers once.
 *   - Pre-fetch full content in parallel batches when any filter needs it.
 *   - For each message, apply filters in order and stop at the first match.
 *   - Remove consumed (moved/deleted) messages so later messages don't see them.
 *
 * Returns { matched: number, total: number, hits: array|null }.
 * When dryRun is true, conditions are evaluated but actions are never executed.
 * accountId, when provided, skips filters not scoped to that account.
 */
async function runFiltersOnFolder(filters, folderId, onProgress, dryRun = false, accountId = null) {
  const enabledFilters = filters.filter(f =>
    f.enabled && (!accountId || !f.accountIds?.length || f.accountIds.includes(accountId))
  );
  if (enabledFilters.length === 0) return { matched: 0, total: 0, hits: dryRun ? [] : null };

  const allMessages = await fetchAllMessages(folderId);
  const total = allMessages.length;
  const fullCache = new Map();

  const anyNeedsFull = enabledFilters.some(f => conditionNeedsFullMessage(f.condition));
  const anyNeedsAddressBook = enabledFilters.some(f => conditionNeedsAddressBook(f.condition));

  const abFetchPromise = anyNeedsAddressBook
    ? fetchAddressBookEmails().catch(err => { console.error("Polimath Filters: address book fetch failed", err); return null; })
    : Promise.resolve(null);

  if (anyNeedsFull) {
    const BATCH = 10;
    for (let i = 0; i < allMessages.length; i += BATCH) {
      const batch = allMessages.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(m => messenger.messages.getFull(m.id).catch(() => null))
      );
      for (let j = 0; j < batch.length; j++) {
        if (results[j]) fullCache.set(batch[j].id, results[j]);
      }
      if (onProgress) onProgress({ stage: "fetching", done: Math.min(i + BATCH, total), total });
    }
  }

  const addressBookEmails = await abFetchPromise;

  let matched = 0;
  const consumed = new Set();
  const hits = dryRun ? [] : null;

  for (const message of allMessages) {
    if (consumed.has(message.id)) continue;
    const fullMessage = anyNeedsFull ? (fullCache.get(message.id) || null) : null;

    for (const filter of enabledFilters) {
      const hit = await runFilter(filter, message, fullMessage, dryRun, addressBookEmails);
      if (hit) {
        matched++;
        if (hits) hits.push({ from: message.author || "", subject: message.subject || "" });
        const movesOrDeletes = filter.actions.some(a => a.type === "move" || a.type === "delete");
        if (movesOrDeletes && !dryRun) consumed.add(message.id);
        break; // first-match: stop at the first filter that matches this message
      }
    }
  }

  return { matched, total, hits };
}
