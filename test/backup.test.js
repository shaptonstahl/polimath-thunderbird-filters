'use strict';
const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const path = require('node:path');

// ── Test context factory ──────────────────────────────────────────────────────
//
// backup.js depends on filter-engine.js (importSchema, CURRENT_SCHEMA), so both
// load into one VM context with a mock `messenger`. `folder` holds the messages
// of one mock mail folder; imports append to it, deletes remove from it.

function makeBackupContext({ folderMessages = [], attachments = {}, accounts = [], existingFolders = [], storage = {} } = {}) {
  const calls = [];
  const folder = folderMessages.slice();
  const store = { ...storage };
  let nextId = 1000;
  const messenger = {
    messages: {
      list: async () => ({ messages: folder.slice(), id: null }),
      continueList: async () => ({ messages: [], id: null }),
      import: async (file, folderId, props) => {
        const raw = await file.text();
        calls.push({ type: 'import', folderId, props, raw, name: file.name, mime: file.type });
        const id = nextId++;
        folder.push({ id, date: new Date(), author: 'Polimath Filters <backups@polimath-filters.invalid>', subject: 'new' });
        return { id };
      },
      delete: async (ids) => {
        calls.push({ type: 'delete', ids: Array.from(ids) });
        for (const id of ids) {
          const i = folder.findIndex(m => m.id === id);
          if (i >= 0) folder.splice(i, 1);
        }
      },
      listAttachments: async (id) => (attachments[id] || []).map(({ text, ...meta }) => meta),
      getAttachmentFile: async (id, partName) => {
        const att = (attachments[id] || []).find(a => a.partName === partName);
        if (!att || att.text === undefined) throw new Error('unreadable');
        return new File([att.text], att.name, { type: att.contentType });
      },
    },
    folders: {
      query: async (q) => existingFolders.filter(f => (!q.accountId || f.accountId === q.accountId) && (!q.name || f.name === q.name)),
      create: async (parent, name) => {
        calls.push({ type: 'createFolder', parent, name });
        const created = { id: `${parent.accountId}://${name}`, name, accountId: parent.accountId };
        existingFolders.push(created);
        return created;
      },
    },
    accounts: {
      list: async () => accounts,
      get: async (id) => accounts.find(a => a.id === id) || null,
    },
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: store[key] } : { ...store }),
        set: async (obj) => { Object.assign(store, obj); },
      },
    },
  };
  const ctx = { messenger, console, File, calls, folder, store };
  ctx.self = ctx;
  createContext(ctx);
  for (const f of ['../filter-engine.js', '../backup.js']) {
    runInContext(readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  }
  return ctx;
}

const B = makeBackupContext();
const DAY = 24 * 60 * 60 * 1000;

const envelopeText = (over = {}) => JSON.stringify({
  exportedBy: 'Polimath Filters', extensionVersion: '3.4.0', schemaVersion: 4,
  exportedAt: '2026-11-20T12:00:00.000Z', filterCount: 1,
  filters: [{ id: 'f1', name: 'F', enabled: true, condition: { type: 'and', children: [] }, actions: [], ending: { type: 'continue' } }],
  ...over,
});

// ── backupRetention ───────────────────────────────────────────────────────────

describe('backupRetention', () => {
  const now = new Date(2026, 10, 20, 12, 0).getTime();
  const at = (daysAgo, hour = 12) => {
    const d = new Date(now - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  it('keeps the newest backup of each day for 30 days', () => {
    const backups = [
      { id: 'a', date: at(1, 9) }, { id: 'b', date: at(1, 18) },
      { id: 'c', date: at(2, 10) }, { id: 'd', date: at(29, 10) },
    ];
    const r = B.backupRetention(backups, now);
    assert.deepEqual(Array.from(r.keep).sort(), ['b', 'c', 'd']);
    assert.deepEqual(Array.from(r.remove), ['a']);
  });

  it('keeps the newest backup of each month after 30 days', () => {
    const older = new Date(2026, 6, 3, 12).getTime();
    const newer = new Date(2026, 6, 25, 12).getTime();
    const june = new Date(2026, 5, 10, 12).getTime();
    const r = B.backupRetention([{ id: 'jul3', date: older }, { id: 'jul25', date: newer }, { id: 'jun', date: june }], now);
    assert.deepEqual(Array.from(r.keep).sort(), ['jul25', 'jun']);
    assert.deepEqual(Array.from(r.remove), ['jul3']);
  });

  it('keeps monthly backups forever', () => {
    const ancient = new Date(2019, 0, 15, 12).getTime();
    const r = B.backupRetention([{ id: 'old', date: ancient }], now);
    assert.deepEqual(Array.from(r.keep), ['old']);
  });

  it('handles no backups', () => {
    const r = B.backupRetention([], now);
    assert.equal(r.keep.length, 0);
    assert.equal(r.remove.length, 0);
  });
});

// ── filtersHash ───────────────────────────────────────────────────────────────

describe('filtersHash', () => {
  it('is stable for equal content and differs for different content', () => {
    const a = B.filtersHash({ filters: [{ id: 1, name: 'x' }], monitoredFolders: ['i'] });
    const b = B.filtersHash({ filters: [{ id: 1, name: 'x' }], monitoredFolders: ['i'] });
    const c = B.filtersHash({ filters: [{ id: 1, name: 'y' }], monitoredFolders: ['i'] });
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]+$/);
  });
});

// ── buildBackupMessage ────────────────────────────────────────────────────────

describe('buildBackupMessage', () => {
  const date = new Date(2026, 10, 20, 15, 30);
  const envelope = JSON.parse(envelopeText({ filterCount: 13, filters: [{ name: 'Über café ✓', id: 'u' }] }));
  const raw = B.buildBackupMessage(envelope, date, 'abc123');

  it('marks the message as a Polimath Filters backup', () => {
    assert.match(raw, /^From: Polimath Filters <backups@polimath-filters\.invalid>\r$/m);
    assert.match(raw, /^X-Polimath-Filters-Backup: 1\r$/m);
    assert.match(raw, /^Subject: Polimath Filters backup 2026-11-20 \(13 filters\)\r$/m);
  });

  it('gives every backup a unique Message-ID', () => {
    const other = B.buildBackupMessage(envelope, new Date(date.getTime() + 1000), 'abc123');
    const id = s => /^Message-ID: (.+)\r$/m.exec(s)[1];
    assert.notEqual(id(raw), id(other));
  });

  it('uses CRLF line endings and base64 lines of at most 76 characters', () => {
    assert.ok(!/[^\r]\n/.test(raw));
    const b64 = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    for (const line of b64.split('\r\n')) assert.ok(line.length <= 76);
  });

  it('attaches the envelope as JSON that round-trips, including non-ASCII text', () => {
    const b64 = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    assert.equal(decoded.filters[0].name, 'Über café ✓');
    assert.match(raw, /filename="polimath-filters-backup-2026-11-20\.json"/);
  });
});

// ── parseBackupEnvelope ───────────────────────────────────────────────────────

describe('parseBackupEnvelope', () => {
  it('accepts a valid backup', () => {
    const r = B.parseBackupEnvelope(envelopeText());
    assert.equal(r.ok, true);
    assert.equal(r.envelope.filters.length, 1);
  });

  it('rejects text that is not JSON', () => {
    const r = B.parseBackupEnvelope('hello');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Not a Polimath Filters backup');
  });

  it('rejects JSON from something else', () => {
    assert.equal(B.parseBackupEnvelope('{"exportedBy":"Other","filters":[]}').reason, 'Not a Polimath Filters backup');
    assert.equal(B.parseBackupEnvelope('{"exportedBy":"Polimath Filters"}').reason, 'Not a Polimath Filters backup');
  });

  it('rejects a backup made by a newer format, naming the version', () => {
    const r = B.parseBackupEnvelope(envelopeText({ schemaVersion: 99, extensionVersion: '4.1.0' }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Made by version 4.1.0; update this add-on to restore it');
  });
});

// ── readBackup ────────────────────────────────────────────────────────────────

describe('readBackup', () => {
  const json = { partName: '1.2', name: 'polimath-filters-backup-2026-11-20.json', contentType: 'application/json' };

  it('reads a valid backup attachment', async () => {
    const ctx = makeBackupContext({ attachments: { 7: [{ ...json, text: envelopeText() }] } });
    const r = await ctx.readBackup(7);
    assert.equal(r.ok, true);
  });

  it('says a message without a JSON attachment is not a backup', async () => {
    const ctx = makeBackupContext({ attachments: { 7: [{ partName: '1.2', name: 'photo.jpg', contentType: 'image/jpeg', text: 'x' }] } });
    assert.equal((await ctx.readBackup(7)).reason, 'Not a Polimath Filters backup');
  });

  it('says an attachment that cannot be read is unreadable', async () => {
    const ctx = makeBackupContext({ attachments: { 7: [{ ...json }] } });
    assert.equal((await ctx.readBackup(7)).reason, 'Attachment is missing or unreadable');
  });
});

// ── classifyFolderMessages ────────────────────────────────────────────────────

describe('classifyFolderMessages', () => {
  it('lists every message newest first, valid or not, with a reason for each rejection', async () => {
    const json = { partName: '1.2', name: 'b.json', contentType: 'application/json' };
    const ctx = makeBackupContext({
      folderMessages: [
        { id: 1, date: new Date(2026, 10, 1), subject: 'Old backup', author: 'x' },
        { id: 2, date: new Date(2026, 10, 19), subject: 'Lunch?', author: 'friend@example.com' },
        { id: 3, date: new Date(2026, 10, 18), subject: 'Future backup', author: 'x' },
      ],
      attachments: {
        1: [{ ...json, text: envelopeText() }],
        3: [{ ...json, text: envelopeText({ schemaVersion: 99, extensionVersion: '9.0.0' }) }],
      },
    });
    const rows = await ctx.classifyFolderMessages('acct://Polimath Filters Backups');
    assert.deepEqual(Array.from(rows, r => r.id), [2, 3, 1]);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, 'Not a Polimath Filters backup');
    assert.match(rows[1].reason, /9\.0\.0/);
    assert.equal(rows[2].ok, true);
  });
});

// ── runBackup ─────────────────────────────────────────────────────────────────

describe('runBackup', () => {
  const accounts = [{ id: 'acct1', name: 'Mail', rootFolder: { id: 'acct1://', accountId: 'acct1', path: '/' } }];
  const filters = JSON.parse(envelopeText()).filters;

  it('creates the backup folder at the account root when it does not exist', async () => {
    const ctx = makeBackupContext({ accounts });
    await ctx.runBackup(filters, ['acct1://INBOX'], { accountId: 'acct1', extensionVersion: '3.4.0' });
    const create = ctx.calls.find(c => c.type === 'createFolder');
    assert.equal(create.name, 'Polimath Filters Backups');
    assert.equal(create.parent.id, 'acct1://');
  });

  it('imports one backup message into the backup folder, read, with the filters and monitored folders', async () => {
    const ctx = makeBackupContext({ accounts, existingFolders: [{ id: 'acct1://PFB', name: 'Polimath Filters Backups', accountId: 'acct1' }] });
    const r = await ctx.runBackup(filters, ['acct1://INBOX'], { accountId: 'acct1', extensionVersion: '3.4.0' });
    assert.equal(r.status, 'written');
    const imp = ctx.calls.filter(c => c.type === 'import');
    assert.equal(imp.length, 1);
    assert.equal(imp[0].folderId, 'acct1://PFB');
    assert.equal(imp[0].props.read, true);
    assert.equal(imp[0].mime, 'message/rfc822');
    const b64 = imp[0].raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    const env = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    assert.equal(env.schemaVersion, 4);
    assert.deepEqual(env.monitoredFolders, ['acct1://INBOX']);
    assert.equal(env.filters[0].name, 'F');
  });

  it('skips the backup when nothing changed since the last one', async () => {
    const ctx = makeBackupContext({ accounts, existingFolders: [{ id: 'acct1://PFB', name: 'Polimath Filters Backups', accountId: 'acct1' }] });
    await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0' });
    const r = await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0' });
    assert.equal(r.status, 'unchanged');
    assert.equal(ctx.calls.filter(c => c.type === 'import').length, 1);
  });

  it('backs up anyway when forced', async () => {
    const ctx = makeBackupContext({ accounts, existingFolders: [{ id: 'acct1://PFB', name: 'Polimath Filters Backups', accountId: 'acct1' }] });
    await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0' });
    const r = await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0', force: true });
    assert.equal(r.status, 'written');
  });

  it('records when the last backup was made', async () => {
    const ctx = makeBackupContext({ accounts, existingFolders: [{ id: 'acct1://PFB', name: 'Polimath Filters Backups', accountId: 'acct1' }] });
    await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0', now: 12345 });
    assert.equal(ctx.store.backupState.lastBackupAt, 12345);
  });

  it('rotates only its own backups, never other messages in the folder', async () => {
    const now = new Date(2026, 10, 20, 12).getTime();
    const own = 'Polimath Filters <backups@polimath-filters.invalid>';
    const ctx = makeBackupContext({
      accounts,
      existingFolders: [{ id: 'acct1://PFB', name: 'Polimath Filters Backups', accountId: 'acct1' }],
      folderMessages: [
        { id: 1, date: new Date(now - 3 * DAY + 1000), author: own },
        { id: 2, date: new Date(now - 3 * DAY + 2000), author: own },
        { id: 3, date: new Date(now - 3 * DAY + 3000), author: 'someone@example.com' },
      ],
    });
    await ctx.runBackup(filters, [], { accountId: 'acct1', extensionVersion: '3.4.0', now });
    const del = ctx.calls.find(c => c.type === 'delete');
    assert.deepEqual(del.ids, [1]);
  });

  it('fails clearly when the chosen account is gone', async () => {
    const ctx = makeBackupContext({ accounts: [] });
    await assert.rejects(ctx.runBackup(filters, [], { accountId: 'gone', extensionVersion: '3.4.0' }), /account/i);
  });
});

// ── findBackupFolders ─────────────────────────────────────────────────────────

describe('findBackupFolders', () => {
  it('finds backup folders by name in every account', async () => {
    const ctx = makeBackupContext({ existingFolders: [
      { id: 'a://PFB', name: 'Polimath Filters Backups', accountId: 'a' },
      { id: 'b://PFB', name: 'Polimath Filters Backups', accountId: 'b' },
      { id: 'a://Other', name: 'Other', accountId: 'a' },
    ] });
    const found = await ctx.findBackupFolders();
    assert.deepEqual(Array.from(found, f => f.id), ['a://PFB', 'b://PFB']);
  });
});
