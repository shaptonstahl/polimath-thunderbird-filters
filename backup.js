/**
 * backup.js
 * Automatic filter backups stored as mail messages (ADR-009). No DOM. Loaded
 * after filter-engine.js in both the background page and the options page.
 */

// ── Constants ───────────────────────────────────────────────────────────────

// Fixed so a reinstall, which has lost every setting, can still find backups.
const BACKUP_FOLDER_NAME = "Polimath Filters Backups";
// .invalid (RFC 2606) can never be a real mailbox, so it marks our messages safely.
const BACKUP_FROM_ADDRESS = "backups@polimath-filters.invalid";
const BACKUP_FROM = `Polimath Filters <${BACKUP_FROM_ADDRESS}>`;
const BACKUP_DAILY_DAYS = 30;
const BACKUP_DAY_MS = 24 * 60 * 60 * 1000;
const NOT_A_BACKUP = "Not a Polimath Filters backup";
const UNREADABLE = "Attachment is missing or unreadable";

// ── Pure helpers ────────────────────────────────────────────────────────────

/** cyrb53: change detection only, not security. */
function filtersHash(value) {
  const str = JSON.stringify(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Newest backup of each local day for BACKUP_DAILY_DAYS, then the newest of
 * each month forever. `backups` is [{ id, date }] with `date` in ms.
 */
function backupRetention(backups, now) {
  const cutoff = now - BACKUP_DAILY_DAYS * BACKUP_DAY_MS;
  const sorted = [...backups].sort((a, b) => b.date - a.date);
  const seen = new Set();
  const keep = [];
  const remove = [];
  for (const b of sorted) {
    const d = new Date(b.date);
    const key = b.date >= cutoff
      ? `d${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : `m${d.getFullYear()}-${d.getMonth()}`;
    if (seen.has(key)) {
      remove.push(b.id);
    } else {
      seen.add(key);
      keep.push(b.id);
    }
  }
  return { keep, remove };
}

function localDateStamp(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// TextEncoder and btoa are absent from the Node test VM, so encode by hand.
function utf8Bytes(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function base64Lines(str) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(str);
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    b64 += A[(n >> 18) & 63] + A[(n >> 12) & 63];
    b64 += i + 1 < bytes.length ? A[(n >> 6) & 63] : "=";
    b64 += i + 2 < bytes.length ? A[n & 63] : "=";
  }
  return b64.match(/.{1,76}/g) || [];
}

/** An RFC 822 message carrying `envelope` as a JSON attachment. CRLF throughout. */
function buildBackupMessage(envelope, date, hash) {
  const stamp = localDateStamp(date);
  const count = envelope.filterCount ?? envelope.filters.length;
  const boundary = `pfb-${date.getTime()}-${hash}`;
  const filename = `polimath-filters-backup-${stamp}.json`;
  const lines = [
    `From: ${BACKUP_FROM}`,
    `To: ${BACKUP_FROM}`,
    `Subject: Polimath Filters backup ${stamp} (${count} filter${count === 1 ? "" : "s"})`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <pfb.${date.getTime()}.${hash}@polimath-filters.invalid>`,
    "MIME-Version: 1.0",
    "X-Polimath-Filters-Backup: 1",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    `This is an automatic backup of ${count} Polimath Filters rule${count === 1 ? "" : "s"},`,
    `made on ${stamp} by version ${envelope.extensionVersion}.`,
    "",
    "To restore: open the Polimath Filters settings, choose Backups, then",
    "Restore from mail, and pick this folder. You can also save the attached",
    "file and use Import.",
    "",
    `--${boundary}`,
    `Content-Type: application/json; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    ...base64Lines(JSON.stringify(envelope, null, 2)),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

/** Validate a backup's JSON. Returns { ok: true, envelope } or { ok: false, reason }. */
function parseBackupEnvelope(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch { return { ok: false, reason: NOT_A_BACKUP }; }
  if (!envelope || envelope.exportedBy !== "Polimath Filters" || !Array.isArray(envelope.filters)) {
    return { ok: false, reason: NOT_A_BACKUP };
  }
  if (importSchema(envelope).schema > CURRENT_SCHEMA) {
    return { ok: false, reason: `Made by version ${envelope.extensionVersion ?? "(newer)"}; update this add-on to restore it` };
  }
  return { ok: true, envelope };
}

function isOwnBackup(message) {
  return String(message?.author ?? "").includes(BACKUP_FROM_ADDRESS);
}

// ── Mail-store access ───────────────────────────────────────────────────────

async function listFolderMessages(folderId) {
  let page = await messenger.messages.list(folderId);
  const all = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    all.push(...page.messages);
  }
  return all;
}

async function findBackupFolders() {
  return messenger.folders.query({ name: BACKUP_FOLDER_NAME });
}

async function ensureBackupFolder(accountId) {
  const existing = await messenger.folders.query({ accountId, name: BACKUP_FOLDER_NAME });
  if (existing.length) return existing[0];
  const account = await messenger.accounts.get(accountId, false);
  if (!account) throw new Error(`The backup account (${accountId}) no longer exists. Choose another in Backups.`);
  return messenger.folders.create(account.rootFolder, BACKUP_FOLDER_NAME);
}

async function listOwnBackups(folderId) {
  return (await listFolderMessages(folderId))
    .filter(isOwnBackup)
    .map(m => ({ id: m.id, date: new Date(m.date).getTime() }));
}

/** Read and validate the backup in one message. */
async function readBackup(messageId) {
  const attachments = await messenger.messages.listAttachments(messageId);
  const att = attachments.find(a => /\.json$/i.test(a.name || "") || a.contentType === "application/json");
  if (!att) return { ok: false, reason: NOT_A_BACKUP };
  let text;
  try {
    text = await (await messenger.messages.getAttachmentFile(messageId, att.partName)).text();
  } catch {
    return { ok: false, reason: UNREADABLE };
  }
  return parseBackupEnvelope(text);
}

/** Every message in a folder, newest first, each marked valid or rejected with a reason. */
async function classifyFolderMessages(folderId, limit = 200) {
  const messages = (await listFolderMessages(folderId))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
  const rows = [];
  for (const m of messages) {
    let result;
    try {
      result = await readBackup(m.id);
    } catch {
      result = { ok: false, reason: UNREADABLE };
    }
    rows.push({ id: m.id, date: new Date(m.date).getTime(), subject: m.subject || "", ...result });
  }
  return rows;
}

/**
 * Write a backup of `filters` and `monitoredFolders` to the backup folder of
 * `accountId`, then rotate. Skipped when the content matches the last backup
 * unless `force`. Returns { status: "written" | "unchanged", ... }.
 */
async function runBackup(filters, monitoredFolders, { accountId, extensionVersion, now = Date.now(), force = false }) {
  const { backupState = {} } = await messenger.storage.local.get("backupState");
  const hash = filtersHash({ filters, monitoredFolders });
  if (!force && backupState.lastHash === hash) return { status: "unchanged" };

  const folder = await ensureBackupFolder(accountId);
  const date = new Date(now);
  const envelope = {
    exportedBy: "Polimath Filters",
    extensionVersion,
    schemaVersion: CURRENT_SCHEMA,
    exportedAt: date.toISOString(),
    platform: "backup",
    filterCount: filters.length,
    monitoredFolders,
    filters,
  };
  const raw = buildBackupMessage(envelope, date, hash);
  const file = new File([raw], `polimath-filters-backup-${localDateStamp(date)}.eml`, { type: "message/rfc822" });
  await messenger.messages.import(file, folder.id, { read: true });

  const { remove } = backupRetention(await listOwnBackups(folder.id), now);
  if (remove.length) await messenger.messages.delete(remove);

  await messenger.storage.local.set({ backupState: { lastHash: hash, lastBackupAt: now, lastError: null } });
  return { status: "written", folderId: folder.id, removed: remove.length };
}
