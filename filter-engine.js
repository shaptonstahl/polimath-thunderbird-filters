/**
 * filter-engine.js
 * Pure filter evaluation and action execution. No UI, no events.
 * Loaded in both background.js and options.js contexts.
 */

// ── Field extraction ────────────────────────────────────────────────────────

// Comments go first: Outlook conditional comments wrap whole <style> blocks.
const NON_BODY_HTML = [
  /<!--[\s\S]*?-->/g,
  /<head\b[^>]*>[\s\S]*?<\/head\s*>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
];

// Only known tag names: a generic <[^>]*> would also eat <user@host>, <https://…>
// and "a < b > c", which are legitimate plain text.
const LEAKED_HTML_TAG = /<\/?(?:a|b|i|u|s|p|br|hr|div|span|ul|ol|li|img|strong|em|table|thead|tbody|tfoot|tr|td|th|h[1-6]|font|center|blockquote|pre|code|sup|sub|small)\b[^<>]*>/gi;

// Paths and queries are mostly tracking tokens (SendGrid writes %2F as -2F, so
// every link contains "w-2F"); keeping the host keeps domain matches working.
const URL_PATH = /\b(https?:\/\/[^\s/?#<>"'\[\]()]+)[^\s<>"'\[\]()]*/gi;

function reduceUrls(text) {
  return text.replace(URL_PATH, "$1");
}

function htmlToText(html) {
  let text = html;
  for (const re of NON_BODY_HTML) text = text.replace(re, " ");
  return reduceUrls(text.replace(/<[^>]*>/g, " "));
}

function plainToText(plain) {
  return reduceUrls(plain.replace(LEAKED_HTML_TAG, " "));
}

function extractBodyText(parts) {
  if (!parts) return "";
  let text = "";
  for (const part of parts) {
    if (part.contentType === "text/plain" && part.body) {
      text += plainToText(part.body) + "\n";
    } else if (part.contentType === "text/html" && part.body) {
      text += htmlToText(part.body) + "\n";
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

// Replace each character with its confusables skeleton string (single pass).
// Skeletonize before case-folding so that ASCII-lookalike targets (e.g. "O" from
// digit zero) are lowercased by the caller, not by this function.
function skeletonize(str) {
  const map = typeof CONFUSABLES_MAP !== "undefined" ? CONFUSABLES_MAP : null;
  if (!map) return str;
  let out = "";
  for (const ch of str.normalize("NFD")) {
    const cp = ch.codePointAt(0);
    out += map.get(cp) ?? ch;
  }
  return out.normalize("NFD");
}

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
    case "has-confusable": {
      const map = typeof CONFUSABLES_MAP !== "undefined" ? CONFUSABLES_MAP : null;
      if (!map) return false;
      for (const ch of fieldValue.normalize("NFD")) {
        const cp = ch.codePointAt(0);
        // Only flag non-ASCII characters that have a confusable mapping.
        if (cp > 0x7e && map.has(cp)) return true;
      }
      return false;
    }
    case "confusable-with": {
      if (!conditionValue) return false;
      // Skeletonize first, then case-fold, so that uppercase skeleton targets
      // (e.g. "O" produced by digit zero) are normalised by toLowerCase.
      const normalize = s => {
        const sk = skeletonize(s);
        return caseSensitive ? sk : sk.toLowerCase();
      };
      return normalize(fieldValue).includes(normalize(conditionValue));
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
    case "mark-read":
      await messenger.messages.update(id, { read: true });
      break;
    case "mark-unread":
      await messenger.messages.update(id, { read: false });
      break;
    case "add-star":
      await messenger.messages.update(id, { flagged: true });
      break;
    case "remove-star":
      await messenger.messages.update(id, { flagged: false });
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

/**
 * Execute the filter's terminal disposition — one mutually-exclusive outcome of
 * "continue", "stop", "move", or "delete". "continue" and "stop" mutate nothing;
 * "stop" merely signals the runner to skip later filters.
 */
async function executeEnding(ending, message) {
  if (!ending || ending.type === "continue" || ending.type === "stop") return;
  const id = message.id;
  if (ending.type === "move") {
    await messenger.messages.move([id], ending.folderId);
  } else if (ending.type === "delete") {
    await messenger.messages.delete([id], false);
  }
}

/**
 * True when a matching filter should end this message's processing so later
 * filters skip it: its ending stops, moves, or deletes the message.
 */
function filterEndsProcessing(filter) {
  const t = filter.ending && filter.ending.type;
  return t === "stop" || t === "move" || t === "delete";
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
    await executeEnding(filter.ending, message);
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
 *   - Fetch all headers once.
 *   - Pre-fetch full content in parallel batches when any filter needs it.
 *   - For each message, evaluate filters in list order and execute the actions
 *     of every filter whose condition matches (all-match). A filter that moves
 *     or deletes the message, or is marked to stop processing, ends that
 *     message's processing, so later filters skip it.
 *
 * Returns { matched: number, total: number, hits: array }.
 * `hits` has one entry per matched message: { subject, from, to, rules },
 * where `rules` lists, in firing order, every filter whose actions ran.
 * Only filters that apply to `folderId` run (see `filterAppliesToFolder`);
 * `accountId` is a legacy fallback for `accountIds`-scoped filters.
 * When `ignoreScope` is true (manual run on an explicit folder), every
 * enabled filter runs regardless of its source-folder scoping.
 */
async function runFiltersOnFolder(filters, folderId, onProgress, dryRun = false, accountId = null, ignoreScope = false) {
  const enabledFilters = filters.filter(f =>
    f.enabled && (ignoreScope || filterAppliesToFolder(f, folderId, accountId))
  );
  if (enabledFilters.length === 0) return { matched: 0, total: 0, hits: [] };

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
  const hits = [];

  for (const message of allMessages) {
    const fullMessage = anyNeedsFull ? (fullCache.get(message.id) || null) : null;

    const rules = [];
    for (const filter of enabledFilters) {
      if (!evaluateNode(filter.condition, message, fullMessage, addressBookEmails)) continue;
      rules.push(filter.name);
      if (!dryRun) {
        await executeActions(filter.actions, message);
        await executeEnding(filter.ending, message);
        if (filterEndsProcessing(filter)) break;
      }
    }

    if (rules.length === 0) continue;

    matched++;
    hits.push({
      subject: message.subject || "",
      from: message.author || "",
      to: (message.recipients || []).join(", "),
      rules,
    });
  }

  return { matched, total, hits };
}

// ── Folder scoping, migration & cycle detection ──────────────────────────────

/**
 * True if `filter` should run against a message currently in `folderId`.
 * New filters declare `sourceFolderIds`; legacy filters use `accountIds`
 * (checked only when an accountId is supplied, as in the run-on-folder modal).
 * A filter with no scope declared applies to every folder.
 */
function filterAppliesToFolder(filter, folderId, accountId = null) {
  if (Array.isArray(filter.sourceFolderIds)) {
    return filter.sourceFolderIds.includes(folderId);
  }
  if (accountId != null && Array.isArray(filter.accountIds)) {
    return filter.accountIds.includes(accountId);
  }
  return true;
}

function collectFoldersFlat(folders, out = []) {
  for (const folder of folders || []) {
    out.push(folder);
    if (folder.subFolders?.length) collectFoldersFlat(folder.subFolders, out);
  }
  return out;
}

async function fetchAccountInboxes() {
  const accounts = await messenger.accounts.list(true);
  const inboxByAccount = new Map();
  for (const account of accounts) {
    const inbox = collectFoldersFlat(account.folders).find(f => f.type === "inbox");
    if (inbox) inboxByAccount.set(account.id, inbox.id);
  }
  return inboxByAccount;
}

// ── Schema versions & migration ─────────────────────────────────────────────
//
// Schema 1: 1.0.0–1.10.1  accountIds (empty = every account); move/delete in actions
// Schema 2: 2.0.0         accountIds (empty = no account); move/delete in actions
// Schema 3: 2.1.0–3.0.x   sourceFolderIds; move/delete in actions; stopProcessing
// Schema 4: 3.1.0–        ending
// See docs/decisions/ADR-008-schema-versions-and-migrations.md.

// var, not const: the Node test harness reads it off the vm context's global.
var CURRENT_SCHEMA = 4;

const ENDING_TYPES = new Set(["continue", "stop", "move", "delete"]);

function schemaForExtensionVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  if (!m) return null;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major < 2) return 1;
  if (major === 2 && minor === 0) return 2;
  if (major === 2 || (major === 3 && minor === 0)) return 3;
  return 4;
}

/**
 * Which schema an export envelope was written in. `known: false` means the file
 * carries no version, so the 2.0.0+ meaning of an empty account list is assumed.
 */
function importSchema(envelope) {
  if (Number.isInteger(envelope?.schemaVersion)) return { schema: envelope.schemaVersion, known: true };
  const fromVersion = schemaForExtensionVersion(envelope?.extensionVersion);
  if (fromVersion !== null) return { schema: fromVersion, known: true };
  return { schema: 2, known: false };
}

function regexErrors(node, out = []) {
  if (!node) return out;
  if (node.type === "condition" && node.operator === "regex") {
    try { new RegExp(node.value ?? ""); } catch (err) { out.push({ value: node.value, error: err.message }); }
  }
  for (const child of node.children || []) regexErrors(child, out);
  if (node.child) regexErrors(node.child, out);
  return out;
}

/**
 * Bring filters from `fromSchema` up to CURRENT_SCHEMA. Pure: `env` supplies what
 * exists in this profile. `env.inboxByAccount` (Map accountId → Inbox id) is
 * needed to migrate account scoping; without it that step is skipped. Passing
 * `env.folderIds` / `env.tagKeys` (Sets) also validates references against
 * this profile. Returns { filters, warnings, changed }; `filters` is the input
 * array itself when nothing changed. Each warning names its filter.
 */
function migrateFilters(filters, fromSchema, env = {}) {
  const warnings = [];
  const isSet = s => typeof s?.has === "function";
  const validate = isSet(env.folderIds);
  let changed = false;

  const result = (filters || []).map(f => {
    if (!f) return f;
    let copy = f;
    const warn = message => warnings.push({ filterId: f.id, filterName: f.name, message });
    const mutable = () => { if (copy === f) { copy = { ...f }; changed = true; } return copy; };

    if (Array.isArray(f.accountIds) && !Array.isArray(f.sourceFolderIds) && env.inboxByAccount) {
      const c = mutable();
      if (fromSchema === 1 && f.accountIds.length === 0) {
        c.sourceFolderIds = [...env.inboxByAccount.values()];
        warn("Ran on every account in v1.x; now runs on each account's Inbox.");
      } else {
        c.sourceFolderIds = f.accountIds.map(id => env.inboxByAccount.get(id)).filter(Boolean);
        const missing = f.accountIds.length - c.sourceFolderIds.length;
        if (missing > 0) warn(`${missing} account${missing === 1 ? "" : "s"} it was limited to no longer exist${missing === 1 ? "s" : ""}.`);
      }
      delete c.accountIds;
      if (c.sourceFolderIds.length === 0) warn("Has no source folders, so it will not run until you choose some.");
    } else if (validate && Array.isArray(f.sourceFolderIds) && f.sourceFolderIds.length === 0) {
      warn("Has no source folders, so it will not run until you choose some.");
    }

    if (!(f.ending && ENDING_TYPES.has(f.ending.type))) {
      const c = mutable();
      const actions = Array.isArray(c.actions) ? c.actions : [];
      const terminals = actions.filter(a => a && (a.type === "move" || a.type === "delete"));
      const move = terminals.find(a => a.type === "move");
      const kept = move || terminals[0];
      if (kept?.type === "move") {
        c.ending = { type: "move", folderId: kept.folderId, folderName: kept.folderName };
      } else if (kept?.type === "delete") {
        c.ending = { type: "delete" };
      } else {
        c.ending = { type: f.stopProcessing ? "stop" : "continue" };
      }
      if (terminals.length > 1) {
        const others = terminals.filter(a => a !== kept).map(a => a.type === "move" ? `move to ${a.folderName || a.folderId}` : "delete");
        const keptLabel = kept.type === "move" ? `move to ${kept.folderName || kept.folderId}` : "delete";
        warn(`Had several endings; kept "${keptLabel}" and dropped ${others.map(o => `"${o}"`).join(", ")}.`);
      }
      c.actions = actions.filter(a => a && a.type !== "move" && a.type !== "delete");
      delete c.stopProcessing;
    }

    if (validate) {
      const sources = copy.sourceFolderIds || [];
      const absent = sources.filter(id => !env.folderIds.has(id)).length;
      if (absent > 0) warn(`${absent} source folder${absent === 1 ? "" : "s"} ${absent === 1 ? "does" : "do"} not exist in this profile.`);
      if (copy.ending?.type === "move" && !env.folderIds.has(copy.ending.folderId)) {
        warn(`Move target "${copy.ending.folderName || copy.ending.folderId}" does not exist in this profile.`);
      }
      if (isSet(env.tagKeys)) {
        for (const a of copy.actions || []) {
          if ((a?.type === "add-tag" || a?.type === "remove-tag") && !env.tagKeys.has(a.tag)) {
            warn(`Tag "${a.tag}" does not exist in this profile.`);
          }
        }
      }
      for (const bad of regexErrors(copy.condition)) {
        warn(`Invalid regex /${bad.value}/: ${bad.error}`);
      }
    }
    return copy;
  });

  return { filters: changed ? result : filters, warnings, changed };
}

function needsAccountMigration(filters) {
  return (filters || []).some(f => f && Array.isArray(f.accountIds) && !Array.isArray(f.sourceFolderIds));
}

/**
 * Migrate filters loaded from storage.local. Stored data without a schemaVersion
 * was written by 2.0.0 or later in practice (2.0.0 did not rewrite stored data),
 * so an empty account list keeps its 2.0.0+ meaning. If accounts cannot be
 * enumerated, account scoping is left for the next load.
 */
async function migrateStoredFilters(filters, storedSchema) {
  const fromSchema = Number.isInteger(storedSchema) ? storedSchema : 2;
  const env = {};
  if (needsAccountMigration(filters)) {
    try {
      env.inboxByAccount = await fetchAccountInboxes();
    } catch (err) {
      console.error("Polimath Filters: account enumeration failed during migration", err);
    }
  }
  const { filters: migrated, changed } = migrateFilters(filters, fromSchema, env);
  return { filters: migrated, changed };
}

/**
 * Persist migrated filters. The schemaVersion is stamped only once account
 * scoping is fully migrated, so a failed account enumeration is retried.
 */
async function saveMigratedFilters(filters) {
  const update = { filters };
  if (!needsAccountMigration(filters)) update.schemaVersion = CURRENT_SCHEMA;
  await messenger.storage.local.set(update);
}

/**
 * What a migration needs to know about this profile, for imports and restores:
 * every account's Inbox, every folder id and every tag key. Tags are optional.
 */
async function buildMigrationEnv() {
  const accounts = await messenger.accounts.list(true);
  const inboxByAccount = new Map();
  const folderIds = new Set();
  for (const account of accounts) {
    const flat = collectFoldersFlat(account.folders);
    for (const folder of flat) folderIds.add(folder.id);
    const inbox = flat.find(f => f.type === "inbox");
    if (inbox) inboxByAccount.set(account.id, inbox.id);
  }
  let tagKeys = null;
  try {
    tagKeys = new Set((await messenger.messages.tags.list()).map(t => t.key));
  } catch (err) {
    console.error("Polimath Filters: tag enumeration failed", err);
  }
  return { inboxByAccount, folderIds, tagKeys };
}

/** Legacy entry point, kept for callers and tests: account scoping only, 2.0.0+ meaning. */
async function migrateFiltersToSourceFolders(filters) {
  if (!needsAccountMigration(filters)) return filters;
  let inboxByAccount;
  try {
    inboxByAccount = await fetchAccountInboxes();
  } catch (err) {
    console.error("Polimath Filters: account enumeration failed during migration", err);
    return filters;
  }
  return filters.map(f => {
    if (!(f && Array.isArray(f.accountIds) && !Array.isArray(f.sourceFolderIds))) return f;
    const copy = { ...f, sourceFolderIds: f.accountIds.map(id => inboxByAccount.get(id)).filter(Boolean) };
    delete copy.accountIds;
    return copy;
  });
}

/** Legacy entry point, kept for callers and tests: the ending step only. */
function migrateFiltersToEnding(filters) {
  return migrateFilters(filters, CURRENT_SCHEMA - 1, {}).filters;
}

/**
 * Detect a cycle in the move graph: each enabled filter whose ending is a move
 * adds an edge from every folder in its source scope to the move destination.
 * Returns the cycle as an array of folder ids, or null when the graph is acyclic.
 *
 * When `focusFilterId` is given, only a cycle that the named filter participates
 * in is reported; cycles caused solely by other filters are ignored, so editing
 * or enabling an unrelated filter is not blocked by a pre-existing loop.
 */
function detectMoveCycle(filters, focusFilterId = null) {
  const edges = new Map();       // src -> Set<dst>
  const focusEdges = new Set();  // "src\x00dst" edges contributed by the focus filter

  for (const f of filters || []) {
    if (!f || !f.enabled) continue;
    const sources = Array.isArray(f.sourceFolderIds) ? f.sourceFolderIds : [];
    const dests = (f.ending && f.ending.type === "move" && f.ending.folderId)
      ? [f.ending.folderId]
      : [];
    const isFocus = focusFilterId !== null && f.id === focusFilterId;
    for (const src of sources) {
      for (const dst of dests) {
        if (!edges.has(src)) edges.set(src, new Set());
        edges.get(src).add(dst);
        if (isFocus) focusEdges.add(src + "\x00" + dst);
      }
    }
  }

  // A move edge src→dst lies on a cycle iff dst can reach src. When focused,
  // only the focus filter's own edges are considered.
  function pathFromTo(start, target) {
    if (start === target) return [start];
    const parent = new Map();
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      for (const next of edges.get(node) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        parent.set(next, node);
        if (next === target) {
          const path = [target];
          let cur = target;
          while (cur !== start) {
            cur = parent.get(cur);
            path.unshift(cur);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  }

  for (const [src, dsts] of edges) {
    for (const dst of dsts) {
      if (focusFilterId !== null && !focusEdges.has(src + "\x00" + dst)) continue;
      const path = pathFromTo(dst, src);
      if (path) return [src, ...path];
    }
  }
  return null;
}
