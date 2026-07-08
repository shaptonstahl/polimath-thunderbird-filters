'use strict';
const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ── Test context factory ──────────────────────────────────────────────────────
//
// filter-engine.js is a browser-extension script that declares globals and
// uses `messenger` as an injected global.  We load it into a fresh VM context
// each time we need action-call tracking, and share one static context for
// the pure (no-messenger) tests.

// Mini confusables map for tests — codepoints chosen to cover the "costco" case.
// Cyrillic uppercase: С(0421)→C, Ѕ(0405)→S, Т(0422)→T
// Cyrillic lowercase: с(0441)→c, ѕ(0455)→s, т(0442)→t
// Digit zero: 0(0030)→O  (ASCII source — only triggers confusable-with, not has-confusable)
const TEST_CONFUSABLES_MAP = new Map([
  [0x0421, 'C'], [0x0405, 'S'], [0x0422, 'T'],
  [0x0441, 'c'], [0x0455, 's'], [0x0442, 't'],
  [0x0030, 'O'],
]);

function makeContext(messages = [], fullMessages = {}, contactEmails = [], confusablesMap = null) {
  const calls = [];
  const contactNodes = contactEmails.map((email, i) => ({
    id: String(i),
    properties: { PrimaryEmail: email },
  }));
  const messenger = {
    messages: {
      list:         async ()     => ({ messages, id: null }),
      continueList: async ()     => ({ messages: [], id: null }),
      getFull:      async (id)   => fullMessages[id] ?? { parts: [], headers: {} },
      get:          async (id)   => ({ ...(messages.find(m => m.id === id) ?? { id }), tags: [] }),
      move:         async (ids, folderId)   => calls.push({ type: 'move', ids, folderId }),
      update:       async (id, props)       => calls.push({ type: 'update', id, props }),
      delete:       async (ids, skipTrash)  => calls.push({ type: 'delete', ids, skipTrash }),
    },
    addressBooks: {
      list: async () => [{ id: 'book1' }],
    },
    contacts: {
      list: async () => contactNodes,
    },
  };

  const ctx = { messenger, console, calls };
  // self-reference allows filter-engine.js to access `self.CONFUSABLES_MAP`
  // the same way it does in a browser extension context.
  ctx.self = ctx;
  if (confusablesMap) ctx.CONFUSABLES_MAP = confusablesMap;
  createContext(ctx);
  runInContext(
    readFileSync(path.join(__dirname, '../filter-engine.js'), 'utf8'),
    ctx,
  );
  return ctx;
}

// Shared context for tests that only call pure functions.
const E = makeContext();

// ── extractBodyText ───────────────────────────────────────────────────────────

describe('extractBodyText', () => {
  it('returns empty string for null', () => {
    assert.equal(E.extractBodyText(null), '');
  });

  it('returns empty string for empty array', () => {
    assert.equal(E.extractBodyText([]), '');
  });

  it('returns plain-text body as-is', () => {
    const result = E.extractBodyText([{ contentType: 'text/plain', body: 'Hello world' }]);
    assert.ok(result.includes('Hello world'));
  });

  it('strips HTML tags from text/html parts', () => {
    const result = E.extractBodyText([{ contentType: 'text/html', body: '<b>Bold</b> and <em>italic</em>' }]);
    assert.ok(!result.includes('<b>'));
    assert.ok(result.includes('Bold'));
    assert.ok(result.includes('italic'));
  });

  it('ignores parts that have no body', () => {
    assert.equal(E.extractBodyText([{ contentType: 'text/plain' }]), '');
  });

  it('concatenates text from nested multipart parts', () => {
    const parts = [{
      contentType: 'multipart/alternative',
      parts: [
        { contentType: 'text/plain', body: 'plain text' },
        { contentType: 'text/html',  body: '<p>html text</p>' },
      ],
    }];
    const result = E.extractBodyText(parts);
    assert.ok(result.includes('plain text'));
    assert.ok(result.includes('html text'));
  });

  it('ignores non-text MIME types', () => {
    const result = E.extractBodyText([{ contentType: 'image/png', body: 'binary' }]);
    assert.equal(result, '');
  });
});

// ── getField ──────────────────────────────────────────────────────────────────

describe('getField', () => {
  const msg = {
    subject: 'Hello there',
    author: 'alice@example.com',
    recipients: ['bob@example.com', 'carol@example.com'],
    hasAttachment: true,
  };
  const full = {
    headers: { cc: ['dave@example.com'], bcc: ['eve@example.com'] },
    parts: [{ contentType: 'text/plain', body: 'body content' }],
  };

  it('subject', () => assert.equal(E.getField('subject', msg, null), 'Hello there'));
  it('from',    () => assert.equal(E.getField('from', msg, null), 'alice@example.com'));

  it('from-name extracts display name from "Name <email>" format', () => {
    assert.equal(E.getField('from-name', { author: 'Alice Smith <alice@example.com>' }, null), 'Alice Smith');
  });

  it('from-name returns empty string when author is email-only', () => {
    assert.equal(E.getField('from-name', { author: 'alice@example.com' }, null), '');
  });

  it('from-name returns empty string when author is missing', () => {
    assert.equal(E.getField('from-name', {}, null), '');
  });

  it('from-name handles quoted display name', () => {
    assert.equal(E.getField('from-name', { author: '"Bob Jones" <bob@example.com>' }, null), '"Bob Jones"');
  });

  it('to joins multiple recipients with comma-space', () => {
    assert.equal(E.getField('to', msg, null), 'bob@example.com, carol@example.com');
  });

  it('to is empty string when no recipients', () => {
    assert.equal(E.getField('to', {}, null), '');
  });

  it('cc from fullMessage headers', () => {
    assert.equal(E.getField('cc', msg, full), 'dave@example.com');
  });

  it('bcc from fullMessage headers', () => {
    assert.equal(E.getField('bcc', msg, full), 'eve@example.com');
  });

  it('cc is empty without fullMessage', () => {
    assert.equal(E.getField('cc', msg, null), '');
  });

  it('bcc is empty without fullMessage', () => {
    assert.equal(E.getField('bcc', msg, null), '');
  });

  it('body extracted from fullMessage parts', () => {
    assert.ok(E.getField('body', msg, full).includes('body content'));
  });

  it('body is empty without fullMessage', () => {
    assert.equal(E.getField('body', msg, null), '');
  });

  it('attachment true when hasAttachment is true', () => {
    assert.equal(E.getField('attachment', msg, null), 'true');
  });

  it('attachment false when hasAttachment is false', () => {
    assert.equal(E.getField('attachment', { hasAttachment: false }, null), 'false');
  });

  it('unknown field returns empty string', () => {
    assert.equal(E.getField('x-custom', msg, null), '');
  });
});

// ── applyOperator ─────────────────────────────────────────────────────────────

describe('applyOperator', () => {
  describe('contains', () => {
    it('matches substring (case-insensitive by default)', () =>
      assert.ok(E.applyOperator('contains', 'Hello World', 'world', false)));
    it('misses absent substring', () =>
      assert.ok(!E.applyOperator('contains', 'Hello World', 'xyz', false)));
    it('case-sensitive: uppercase field vs lowercase value → false', () =>
      assert.ok(!E.applyOperator('contains', 'Hello World', 'world', true)));
    it('case-sensitive: exact case → true', () =>
      assert.ok(E.applyOperator('contains', 'Hello World', 'World', true)));
  });

  describe('not-contains', () => {
    it('true when substring is absent', () =>
      assert.ok(E.applyOperator('not-contains', 'Hello', 'xyz', false)));
    it('false when substring is present', () =>
      assert.ok(!E.applyOperator('not-contains', 'Hello', 'hello', false)));
  });

  describe('is / is-not', () => {
    it('is: exact match, case-insensitive', () =>
      assert.ok(E.applyOperator('is', 'HELLO', 'hello', false)));
    it('is: mismatch', () =>
      assert.ok(!E.applyOperator('is', 'hello', 'world', false)));
    it('is: case-sensitive mismatch', () =>
      assert.ok(!E.applyOperator('is', 'Hello', 'hello', true)));
    it('is-not: different values → true', () =>
      assert.ok(E.applyOperator('is-not', 'hello', 'world', false)));
    it('is-not: same value → false', () =>
      assert.ok(!E.applyOperator('is-not', 'hello', 'hello', false)));
  });

  describe('starts-with / ends-with', () => {
    it('starts-with: match', () =>
      assert.ok(E.applyOperator('starts-with', 'Hello World', 'hello', false)));
    it('starts-with: wrong end → false', () =>
      assert.ok(!E.applyOperator('starts-with', 'Hello World', 'world', false)));
    it('ends-with: match', () =>
      assert.ok(E.applyOperator('ends-with', 'Hello World', 'world', false)));
    it('ends-with: wrong end → false', () =>
      assert.ok(!E.applyOperator('ends-with', 'Hello World', 'hello', false)));
  });

  describe('regex', () => {
    it('matches a valid pattern', () =>
      assert.ok(E.applyOperator('regex', 'test@example.com', '.*@example\\.com', false)));
    it('does not match when pattern fails', () =>
      assert.ok(!E.applyOperator('regex', 'test@other.com', '.*@example\\.com', false)));
    it('is case-insensitive by default', () =>
      assert.ok(E.applyOperator('regex', 'HELLO', 'hello', false)));
    it('is case-sensitive when caseSensitive=true', () =>
      assert.ok(!E.applyOperator('regex', 'HELLO', 'hello', true)));
    it('invalid regex returns false without throwing', () =>
      assert.doesNotThrow(() => {
        const result = E.applyOperator('regex', 'hello', '[invalid', false);
        assert.equal(result, false);
      }));
  });

  it('unknown operator returns false', () =>
    assert.ok(!E.applyOperator('bogus', 'hello', 'hello', false)));
});

// ── conditionNeedsFullMessage ─────────────────────────────────────────────────

describe('conditionNeedsFullMessage', () => {
  const cond = (field) => ({ type: 'condition', field, operator: 'contains', value: '' });

  it('subject → false', () => assert.ok(!E.conditionNeedsFullMessage(cond('subject'))));
  it('from → false',    () => assert.ok(!E.conditionNeedsFullMessage(cond('from'))));
  it('to → false',      () => assert.ok(!E.conditionNeedsFullMessage(cond('to'))));
  it('attachment → false', () => assert.ok(!E.conditionNeedsFullMessage(cond('attachment'))));
  it('body → true',     () => assert.ok(E.conditionNeedsFullMessage(cond('body'))));
  it('cc → true',       () => assert.ok(E.conditionNeedsFullMessage(cond('cc'))));
  it('bcc → true',      () => assert.ok(E.conditionNeedsFullMessage(cond('bcc'))));

  it('AND with only header fields → false', () => {
    assert.ok(!E.conditionNeedsFullMessage({
      type: 'and', children: [cond('subject'), cond('from')],
    }));
  });

  it('AND containing a body condition → true', () => {
    assert.ok(E.conditionNeedsFullMessage({
      type: 'and', children: [cond('subject'), cond('body')],
    }));
  });

  it('OR containing a cc condition → true', () => {
    assert.ok(E.conditionNeedsFullMessage({
      type: 'or', children: [cond('from'), cond('cc')],
    }));
  });

  it('NOT wrapping a body condition → true', () => {
    assert.ok(E.conditionNeedsFullMessage({ type: 'not', child: cond('body') }));
  });

  it('NOT wrapping a header-only condition → false', () => {
    assert.ok(!E.conditionNeedsFullMessage({ type: 'not', child: cond('subject') }));
  });
});

// ── evaluateNode ──────────────────────────────────────────────────────────────

describe('evaluateNode', () => {
  const msg = {
    subject: 'Meeting notes',
    author: 'boss@corp.com',
    recipients: ['me@corp.com'],
    hasAttachment: false,
  };

  const cond = (field, operator, value, caseSensitive = false) =>
    ({ type: 'condition', field, operator, value, caseSensitive });

  it('single matching condition → true', () =>
    assert.ok(E.evaluateNode(cond('subject', 'contains', 'meeting'), msg, null)));

  it('single non-matching condition → false', () =>
    assert.ok(!E.evaluateNode(cond('subject', 'contains', 'invoice'), msg, null)));

  describe('AND', () => {
    it('all children true → true', () => {
      const node = { type: 'and', children: [
        cond('subject', 'contains', 'meeting'),
        cond('from', 'contains', 'boss'),
      ]};
      assert.ok(E.evaluateNode(node, msg, null));
    });

    it('one child false → false', () => {
      const node = { type: 'and', children: [
        cond('subject', 'contains', 'meeting'),
        cond('from', 'contains', 'nobody'),
      ]};
      assert.ok(!E.evaluateNode(node, msg, null));
    });

    it('empty children → true (vacuously true)', () =>
      assert.ok(E.evaluateNode({ type: 'and', children: [] }, msg, null)));
  });

  describe('OR', () => {
    it('at least one child true → true', () => {
      const node = { type: 'or', children: [
        cond('subject', 'contains', 'invoice'),
        cond('subject', 'contains', 'meeting'),
      ]};
      assert.ok(E.evaluateNode(node, msg, null));
    });

    it('all children false → false', () => {
      const node = { type: 'or', children: [
        cond('subject', 'contains', 'invoice'),
        cond('subject', 'contains', 'reminder'),
      ]};
      assert.ok(!E.evaluateNode(node, msg, null));
    });

    it('empty children → false (vacuously false)', () =>
      assert.ok(!E.evaluateNode({ type: 'or', children: [] }, msg, null)));
  });

  describe('NOT', () => {
    it('flips true to false', () =>
      assert.ok(!E.evaluateNode(
        { type: 'not', child: cond('subject', 'contains', 'meeting') }, msg, null)));

    it('flips false to true', () =>
      assert.ok(E.evaluateNode(
        { type: 'not', child: cond('subject', 'contains', 'invoice') }, msg, null)));
  });

  describe('nesting', () => {
    it('NOT(AND(true, true)) → false', () => {
      const node = { type: 'not', child: { type: 'and', children: [
        cond('subject', 'contains', 'meeting'),
        cond('from', 'contains', 'boss'),
      ]}};
      assert.ok(!E.evaluateNode(node, msg, null));
    });

    it('OR(AND(true, false), AND(true, true)) → true', () => {
      const node = { type: 'or', children: [
        { type: 'and', children: [cond('subject', 'contains', 'meeting'), cond('from', 'contains', 'nobody')] },
        { type: 'and', children: [cond('subject', 'contains', 'meeting'), cond('from', 'contains', 'boss')] },
      ]};
      assert.ok(E.evaluateNode(node, msg, null));
    });

    it('AND(NOT(false), true) → true', () => {
      const node = { type: 'and', children: [
        { type: 'not', child: cond('subject', 'contains', 'invoice') },
        cond('from', 'contains', 'boss'),
      ]};
      assert.ok(E.evaluateNode(node, msg, null));
    });
  });

  it('uses fullMessage for body conditions', () => {
    const full = { headers: {}, parts: [{ contentType: 'text/plain', body: 'Action required' }] };
    assert.ok(E.evaluateNode(cond('body', 'contains', 'action required'), msg, full));
    assert.ok(!E.evaluateNode(cond('body', 'contains', 'action required'), msg, null));
  });

  it('case-sensitive condition respects exact case', () => {
    assert.ok(!E.evaluateNode(cond('subject', 'contains', 'MEETING', true), msg, null));
    assert.ok(E.evaluateNode(cond('subject', 'contains', 'Meeting', true), msg, null));
  });

  it('unknown node type → false', () =>
    assert.ok(!E.evaluateNode({ type: 'unknown' }, msg, null)));
});

// ── action execution (via runFilter) ─────────────────────────────────────────

describe('action execution', () => {
  const msg = { id: 99, subject: 'Test', author: 'a@b.com', recipients: [], hasAttachment: false };
  const trueCond = { type: 'condition', field: 'subject', operator: 'contains', value: 'test', caseSensitive: false };
  const mkFilter = (actions) => ({ id: '1', name: 'f', enabled: true, condition: trueCond, actions });

  it('mark-read calls update with { read: true }', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'mark-read' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'update');
    assert.equal(ctx.calls[0].id, 99);
    assert.equal(ctx.calls[0].props.read, true);
  });

  it('mark-unread calls update with { read: false }', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'mark-unread' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'update');
    assert.equal(ctx.calls[0].id, 99);
    assert.equal(ctx.calls[0].props.read, false);
  });

  it('add-star calls update with { flagged: true }', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'add-star' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'update');
    assert.equal(ctx.calls[0].id, 99);
    assert.equal(ctx.calls[0].props.flagged, true);
  });

  it('mark-junk calls update with { junk: true }', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'mark-junk' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'update');
    assert.equal(ctx.calls[0].id, 99);
    assert.equal(ctx.calls[0].props.junk, true);
  });

  it('move calls messages.move with the target folder id', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'move', folderId: 'folder-42' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'move');
    assert.equal(ctx.calls[0].folderId, 'folder-42');
    assert.equal(ctx.calls[0].ids.length, 1);
    assert.equal(ctx.calls[0].ids[0], 99);
  });

  it('delete calls messages.delete', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'delete' }]), msg, null);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].type, 'delete');
    assert.equal(ctx.calls[0].ids[0], 99);
    assert.equal(ctx.calls[0].skipTrash, false);
  });

  it('add-tag appends to existing tags', async () => {
    const msgWithTags = { ...msg, tags: ['$label1'] };
    const ctx = makeContext([msgWithTags]);
    // Override get to return existing tags
    ctx.messenger.messages.get = async () => msgWithTags;
    await ctx.runFilter(mkFilter([{ type: 'add-tag', tag: '$label2' }]), msgWithTags, null);
    const updateCall = ctx.calls.find(c => c.type === 'update');
    assert.ok(updateCall.props.tags.includes('$label1'));
    assert.ok(updateCall.props.tags.includes('$label2'));
  });

  it('add-tag is idempotent (does not duplicate an existing tag)', async () => {
    const msgWithTags = { ...msg, tags: ['$label1'] };
    const ctx = makeContext([msgWithTags]);
    ctx.messenger.messages.get = async () => msgWithTags;
    await ctx.runFilter(mkFilter([{ type: 'add-tag', tag: '$label1' }]), msgWithTags, null);
    assert.equal(ctx.calls.length, 0);
  });

  it('remove-tag removes only the specified tag', async () => {
    const msgWithTags = { ...msg, tags: ['$label1', '$label2'] };
    const ctx = makeContext([msgWithTags]);
    ctx.messenger.messages.get = async () => msgWithTags;
    await ctx.runFilter(mkFilter([{ type: 'remove-tag', tag: '$label1' }]), msgWithTags, null);
    const updateCall = ctx.calls.find(c => c.type === 'update');
    assert.ok(!updateCall.props.tags.includes('$label1'));
    assert.ok(updateCall.props.tags.includes('$label2'));
  });

  it('multiple actions execute in order', async () => {
    const ctx = makeContext([msg]);
    await ctx.runFilter(mkFilter([{ type: 'mark-read' }, { type: 'mark-junk' }]), msg, null);
    assert.equal(ctx.calls.length, 2);
    assert.equal(ctx.calls[0].props.read, true);
    assert.equal(ctx.calls[1].props.junk, true);
  });
});

// ── runFilter ─────────────────────────────────────────────────────────────────

describe('runFilter', () => {
  const msg = { id: 1, subject: 'Invoice', author: 'v@biz.com', recipients: [], hasAttachment: false };
  const matchCond = { type: 'condition', field: 'subject', operator: 'contains', value: 'invoice', caseSensitive: false };
  const missCond  = { type: 'condition', field: 'subject', operator: 'contains', value: 'meeting', caseSensitive: false };
  const actions   = [{ type: 'mark-read' }];

  it('disabled filter returns false and executes no actions', async () => {
    const ctx = makeContext([msg]);
    const result = await ctx.runFilter(
      { id: '1', name: 'f', enabled: false, condition: matchCond, actions }, msg, null);
    assert.equal(result, false);
    assert.equal(ctx.calls.length, 0);
  });

  it('non-matching filter returns false and executes no actions', async () => {
    const ctx = makeContext([msg]);
    const result = await ctx.runFilter(
      { id: '1', name: 'f', enabled: true, condition: missCond, actions }, msg, null);
    assert.equal(result, false);
    assert.equal(ctx.calls.length, 0);
  });

  it('matching filter returns true and executes actions', async () => {
    const ctx = makeContext([msg]);
    const result = await ctx.runFilter(
      { id: '1', name: 'f', enabled: true, condition: matchCond, actions }, msg, null);
    assert.equal(result, true);
    assert.equal(ctx.calls.length, 1);
  });

  it('dry run: returns true for match but executes no actions', async () => {
    const ctx = makeContext([msg]);
    const result = await ctx.runFilter(
      { id: '1', name: 'f', enabled: true, condition: matchCond, actions }, msg, null, true);
    assert.equal(result, true);
    assert.equal(ctx.calls.length, 0);
  });
});

// ── runFiltersOnFolder ────────────────────────────────────────────────────────

describe('runFiltersOnFolder', () => {
  const msgs = [
    { id: 1, subject: 'Invoice Q1', author: 'a@biz.com', recipients: [], hasAttachment: false },
    { id: 2, subject: 'Meeting notes', author: 'b@biz.com', recipients: [], hasAttachment: false },
    { id: 3, subject: 'Invoice Q2', author: 'c@biz.com', recipients: [], hasAttachment: false },
  ];

  const invoiceCond = { type: 'condition', field: 'subject', operator: 'contains', value: 'invoice', caseSensitive: false };
  const meetingCond = { type: 'condition', field: 'subject', operator: 'contains', value: 'meeting', caseSensitive: false };
  const allCond     = { type: 'or', children: [invoiceCond, meetingCond] };

  const mkFilter = (id, cond, actions, enabled = true) =>
    ({ id, name: id, enabled, condition: cond, actions });

  it('returns {0,0} when filter list is empty', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder([], 'inbox');
    assert.equal(result.matched, 0);
    assert.equal(result.total, 0);
  });

  it('returns {0,0} when all filters are disabled', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder(
      [mkFilter('f1', invoiceCond, [], false)], 'inbox');
    assert.equal(result.matched, 0);
    assert.equal(result.total, 0);
  });

  it('counts matched and total correctly', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder(
      [mkFilter('f1', invoiceCond, [{ type: 'mark-read' }])], 'inbox');
    assert.equal(result.matched, 2);
    assert.equal(result.total, 3);
  });

  it('dry run counts matches without executing any actions', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder(
      [mkFilter('f1', invoiceCond, [{ type: 'mark-read' }])], 'inbox', null, true);
    assert.equal(result.matched, 2);
    assert.equal(ctx.calls.length, 0);
  });

  it('dry run returns hits array with from and subject for each matched message', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder(
      [mkFilter('f1', invoiceCond, [{ type: 'mark-read' }])], 'inbox', null, true);
    assert.equal(result.hits.length, 2);
    assert.equal(result.hits[0].from, 'a@biz.com');
    assert.equal(result.hits[0].subject, 'Invoice Q1');
    assert.equal(result.hits[1].from, 'c@biz.com');
    assert.equal(result.hits[1].subject, 'Invoice Q2');
  });

  it('non-dry-run returns null hits', async () => {
    const ctx = makeContext(msgs);
    const result = await ctx.runFiltersOnFolder(
      [mkFilter('f1', invoiceCond, [{ type: 'mark-read' }])], 'inbox', null, false);
    assert.equal(result.hits, null);
  });

  it('messages consumed by a move are skipped by later filters', async () => {
    const ctx = makeContext(msgs);
    // Filter 1 moves invoices; filter 2 matches everything remaining.
    const f1 = mkFilter('f1', invoiceCond, [{ type: 'move', folderId: 'archive' }]);
    const f2 = mkFilter('f2', allCond,     [{ type: 'mark-read' }]);
    const result = await ctx.runFiltersOnFolder([f1, f2], 'inbox');

    // f1: 2 matches (consumed); f2: 1 match (only the meeting msg remains)
    assert.equal(result.matched, 3);
    const markReadCalls = ctx.calls.filter(c => c.type === 'update' && c.props.read === true);
    assert.equal(markReadCalls.length, 1);
  });

  it('messages consumed by a delete are skipped by later filters', async () => {
    const ctx = makeContext(msgs);
    const f1 = mkFilter('f1', invoiceCond, [{ type: 'delete' }]);
    const f2 = mkFilter('f2', allCond,     [{ type: 'mark-read' }]);
    await ctx.runFiltersOnFolder([f1, f2], 'inbox');
    const markReadCalls = ctx.calls.filter(c => c.type === 'update');
    assert.equal(markReadCalls.length, 1);
  });

  it('dry run does not consume messages, so later filters see them', async () => {
    const ctx = makeContext(msgs);
    // In dry-run nothing is consumed, but first-match still stops at the first
    // matching filter per message.  f1 (invoice) matches msgs 1 and 3; f2 (all)
    // matches msg 2 (the only one f1 did not claim).  Total: 3.
    const f1 = mkFilter('f1', invoiceCond, [{ type: 'move', folderId: 'archive' }]);
    const f2 = mkFilter('f2', allCond,     [{ type: 'mark-read' }]);
    const result = await ctx.runFiltersOnFolder([f1, f2], 'inbox', null, true);
    assert.equal(result.matched, 3);
    assert.equal(ctx.calls.length, 0);
  });

  it('fires onProgress callback when fetching full content', async () => {
    const bodyMsg = { id: 10, subject: 'x', author: 'a@b.com', recipients: [], hasAttachment: false };
    const ctx = makeContext([bodyMsg], {
      10: { parts: [{ contentType: 'text/plain', body: 'hello' }], headers: {} },
    });
    const bodyCond = { type: 'condition', field: 'body', operator: 'contains', value: 'hello', caseSensitive: false };
    const progressEvents = [];
    await ctx.runFiltersOnFolder(
      [mkFilter('f1', bodyCond, [{ type: 'mark-read' }])],
      'inbox',
      (evt) => progressEvents.push(evt),
    );
    assert.ok(progressEvents.some(e => e.stage === 'fetching'));
  });
});

// ── in-address-book condition ─────────────────────────────────────────────────

describe('conditionNeedsAddressBook', () => {
  it('returns true for in-address-book field', () => {
    const cond = { type: 'condition', field: 'in-address-book', operator: 'is', value: 'true' };
    assert.equal(E.conditionNeedsAddressBook(cond), true);
  });

  it('returns false for other fields', () => {
    const cond = { type: 'condition', field: 'from', operator: 'contains', value: 'x' };
    assert.equal(E.conditionNeedsAddressBook(cond), false);
  });

  it('returns true when nested inside AND', () => {
    const node = { type: 'and', children: [
      { type: 'condition', field: 'subject', operator: 'contains', value: 'hi' },
      { type: 'condition', field: 'in-address-book', operator: 'is', value: 'true' },
    ]};
    assert.equal(E.conditionNeedsAddressBook(node), true);
  });

  it('returns true through NOT wrapper', () => {
    const node = { type: 'not', child: { type: 'condition', field: 'in-address-book', operator: 'is', value: 'false' } };
    assert.equal(E.conditionNeedsAddressBook(node), true);
  });
});

describe('evaluateNode — in-address-book', () => {
  const knownEmail = 'alice@example.com';
  const bookEmails = new Set([knownEmail]);

  const knownMsg   = { id: 1, subject: '', author: 'Alice <alice@example.com>', recipients: [], hasAttachment: false };
  const unknownMsg = { id: 2, subject: '', author: 'Bob <bob@unknown.com>',     recipients: [], hasAttachment: false };
  const bareMsg    = { id: 3, subject: '', author: 'alice@example.com',          recipients: [], hasAttachment: false };

  const inBookCond  = { type: 'condition', field: 'in-address-book', operator: 'is', value: 'true' };
  const notBookCond = { type: 'condition', field: 'in-address-book', operator: 'is', value: 'false' };

  it('matches sender with "Name <email>" format when in address book', () => {
    assert.equal(E.evaluateNode(inBookCond, knownMsg, null, bookEmails), true);
  });

  it('does not match sender not in address book', () => {
    assert.equal(E.evaluateNode(inBookCond, unknownMsg, null, bookEmails), false);
  });

  it('matches bare email format', () => {
    assert.equal(E.evaluateNode(inBookCond, bareMsg, null, bookEmails), true);
  });

  it('matches negated condition for unknown sender', () => {
    assert.equal(E.evaluateNode(notBookCond, unknownMsg, null, bookEmails), true);
  });

  it('returns false when addressBookEmails is null (address book unavailable)', () => {
    assert.equal(E.evaluateNode(inBookCond, knownMsg, null, null), false);
  });

  it('is case-insensitive for email addresses', () => {
    const upperMsg = { id: 4, subject: '', author: 'Alice <ALICE@EXAMPLE.COM>', recipients: [], hasAttachment: false };
    assert.equal(E.evaluateNode(inBookCond, upperMsg, null, bookEmails), true);
  });
});

describe('runFiltersOnFolder — in-address-book', () => {
  const knownMsg   = { id: 1, subject: 'hi', author: 'Alice <alice@example.com>', recipients: [], hasAttachment: false };
  const unknownMsg = { id: 2, subject: 'hi', author: 'Bob <bob@unknown.com>',     recipients: [], hasAttachment: false };

  const inBookCond = { type: 'condition', field: 'in-address-book', operator: 'is', value: 'true' };

  function mkABFilter(id, cond, actions) {
    return { id, name: id, enabled: true, condition: cond, actions };
  }

  it('matches only messages from address book contacts', async () => {
    const ctx = makeContext([knownMsg, unknownMsg], {}, ['alice@example.com']);
    const result = await ctx.runFiltersOnFolder(
      [mkABFilter('f1', inBookCond, [{ type: 'mark-read' }])],
      'inbox',
    );
    assert.equal(result.matched, 1);
    const updateCalls = ctx.calls.filter(c => c.type === 'update');
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].id, 1);
  });

  it('dry run counts address book matches without executing actions', async () => {
    const ctx = makeContext([knownMsg, unknownMsg], {}, ['alice@example.com']);
    const result = await ctx.runFiltersOnFolder(
      [mkABFilter('f1', inBookCond, [{ type: 'mark-read' }])],
      'inbox',
      null,
      true,
    );
    assert.equal(result.matched, 1);
    assert.equal(ctx.calls.length, 0);
  });
});

// ── confusables operators ─────────────────────────────────────────────────────

describe('confusables operators', () => {
  // Context with TEST_CONFUSABLES_MAP injected.
  const EC = makeContext([], {}, [], TEST_CONFUSABLES_MAP);

  // "С0ЅТС0": Cyrillic С(0421) + digit 0(0030) + Cyrillic Ѕ(0405) +
  //           Cyrillic Т(0422) + Cyrillic С(0421) + digit 0(0030)
  // skeletonize → "COSTCO" → toLowerCase → "costco"
  const FAKE_COSTCO = 'С0ЅТС0';

  describe('has-confusable', () => {
    it('ASCII-only string → false', () =>
      assert.ok(!EC.applyOperator('has-confusable', 'costco', '', false)));
    it('string with Cyrillic lookalike → true', () =>
      assert.ok(EC.applyOperator('has-confusable', 'С ostco', '', false)));
    it('digit zero alone → false (ASCII source, not flagged)', () =>
      assert.ok(!EC.applyOperator('has-confusable', 'c0stco', '', false)));
    it('mixed ASCII and Cyrillic → true', () =>
      assert.ok(EC.applyOperator('has-confusable', FAKE_COSTCO, '', false)));
    it('returns false when CONFUSABLES_MAP is not loaded', () => {
      // E context has no map injected
      assert.ok(!E.applyOperator('has-confusable', 'С', '', false));
    });
  });

  describe('confusable-with', () => {
    it('Cyrillic+digit string confusable with "costco" (case-insensitive)', () =>
      assert.ok(EC.applyOperator('confusable-with', FAKE_COSTCO, 'costco', false)));
    it('plain "costco" confusable with "costco"', () =>
      assert.ok(EC.applyOperator('confusable-with', 'costco', 'costco', false)));
    it('unrelated string → false', () =>
      assert.ok(!EC.applyOperator('confusable-with', 'hello world', 'costco', false)));
    it('empty condition value → false', () =>
      assert.ok(!EC.applyOperator('confusable-with', FAKE_COSTCO, '', false)));
    it('confusable match found inside longer subject', () => {
      // "Buy from С0ЅТС0 today!" should match "confusable-with costco"
      assert.ok(EC.applyOperator('confusable-with', 'Buy from ' + FAKE_COSTCO + ' today!', 'costco', false));
    });
    it('returns false when CONFUSABLES_MAP is not loaded', () => {
      assert.ok(!E.applyOperator('confusable-with', FAKE_COSTCO, 'costco', false));
    });
  });

  describe('confusable-with via evaluateNode', () => {
    it('filter on subject field matches confusable subject', () => {
      const msg = { subject: 'Buy from ' + FAKE_COSTCO + ' today!', author: '', recipients: [] };
      const cond = { type: 'condition', field: 'subject', operator: 'confusable-with', value: 'costco', caseSensitive: false };
      assert.ok(EC.evaluateNode(cond, msg, null));
    });
    it('filter on subject field does not match unrelated subject', () => {
      const msg = { subject: 'Meeting notes', author: '', recipients: [] };
      const cond = { type: 'condition', field: 'subject', operator: 'confusable-with', value: 'costco', caseSensitive: false };
      assert.ok(!EC.evaluateNode(cond, msg, null));
    });
  });
});
