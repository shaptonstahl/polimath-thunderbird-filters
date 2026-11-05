/* Screenshot harness: a stand-in for Thunderbird's messenger global.
   Loaded before options.js so the real UI renders with realistic fixture data. */
(() => {
  const F = {
    pInbox: "folder://personal/Inbox",
    pArchive: "folder://personal/Archive",
    pBills: "folder://personal/Bills",
    pNews: "folder://personal/Newsletters",
    pSent: "folder://personal/Sent",
    pTrash: "folder://personal/Trash",
    wInbox: "folder://work/Inbox",
    wProjects: "folder://work/Projects",
  };

  const folders = {
    personal: {
      id: "account://personal",
      name: "Personal",
      folders: [
        { id: F.pInbox, name: "Inbox", type: "inbox" },
        { id: F.pArchive, name: "Archive" },
        { id: F.pBills, name: "Bills" },
        { id: F.pNews, name: "Newsletters" },
        { id: F.pSent, name: "Sent", type: "sent" },
        { id: F.pTrash, name: "Trash", type: "trash" },
      ],
    },
    work: {
      id: "account://work",
      name: "Work",
      folders: [
        { id: F.wInbox, name: "Inbox", type: "inbox" },
        { id: F.wProjects, name: "Projects" },
      ],
    },
  };

  const cond = (field, operator, value) => ({
    type: "condition",
    field,
    operator,
    value: value ?? "",
    caseSensitive: false,
  });

  const filters = [
    {
      id: "f1",
      name: "Phishing lookalikes",
      enabled: true,
      sourceFolderIds: [F.pInbox, F.wInbox],
      condition: {
        type: "or",
        children: [
          cond("from", "has-confusable"),
          cond("subject", "confusable-with", "paypal"),
        ],
      },
      actions: [{ type: "mark-junk" }],
      ending: { type: "stop" },
    },
    {
      id: "f2",
      name: "Invoices → star and file",
      enabled: true,
      sourceFolderIds: [F.pInbox],
      condition: {
        type: "and",
        children: [
          cond("subject", "regex", "\\b(invoice|receipt)\\b"),
          {
            type: "not",
            child: cond("from", "ends-with", "@mycompany.com"),
          },
        ],
      },
      actions: [{ type: "add-star" }, { type: "add-tag", tag: "$label1" }],
      ending: { type: "move", folderId: F.pBills, folderName: "Personal / Bills" },
    },
    {
      id: "f3",
      name: "Newsletters → Archive",
      enabled: true,
      sourceFolderIds: [F.pInbox],
      condition: {
        type: "or",
        children: [
          cond("from", "regex", "no-?reply@"),
          cond("subject", "contains", "newsletter"),
          cond("from", "contains", "substack.com"),
        ],
      },
      actions: [{ type: "mark-read" }, { type: "add-tag", tag: "$label4" }],
      ending: { type: "move", folderId: F.pArchive, folderName: "Personal / Archive" },
    },
    {
      id: "f4",
      name: "JIRA notifications",
      enabled: true,
      sourceFolderIds: [F.wInbox],
      condition: {
        type: "and",
        children: [
          cond("subject", "regex", "^\\[JIRA-\\d+\\]"),
          cond("from-name", "contains", "jira"),
        ],
      },
      actions: [{ type: "mark-read" }, { type: "add-tag", tag: "$label3" }],
      ending: { type: "continue" },
    },
    {
      id: "f5",
      name: "Opt-out sweep",
      enabled: false,
      sourceFolderIds: [F.pInbox],
      condition: cond("body", "regex", "\\b(unsubscribe|opt-?out)\\b"),
      actions: [{ type: "mark-junk" }],
      ending: { type: "stop" },
    },
  ];

  const inbox = [
    { id: 101, subject: "Invoice INV-2043 from Acme Supplies", author: "Acme Billing <billing@acme-supplies.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-04T09:12:00"), read: false, flagged: false, junk: false, tags: [] },
    { id: 102, subject: "\u26a0 Your P\u0430ypal account has been limited", author: "P\u0430ypal Service <service@p\u0430ypal.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-04T08:40:00"), read: false, flagged: false, junk: false, tags: [] },
    { id: 103, subject: "[JIRA-1187] Fix login redirect loop", author: "Jira <jira@mycompany.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-04T08:05:00"), read: true, flagged: false, junk: false, tags: [] },
    { id: 104, subject: "Your weekly newsletter from Substack", author: "Substack <no-reply@substack.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-03T18:22:00"), read: false, flagged: false, junk: false, tags: [] },
    { id: 105, subject: "Receipt for your order #5521", author: "Field Supply <orders@field-supply.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-03T15:10:00"), read: true, flagged: true, junk: false, tags: ["$label1"] },
    { id: 106, subject: "Team lunch on Friday", author: "Dana Whitfield <dana@mycompany.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-03T12:31:00"), read: true, flagged: false, junk: false, tags: [] },
    { id: 107, subject: "Invoice for October retainer", author: "Billing <billing@mycompany.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-02T17:45:00"), read: true, flagged: false, junk: false, tags: [] },
    { id: 108, subject: "[JIRA-1201] Update dependencies", author: "Jira <jira@mycompany.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-02T11:02:00"), read: false, flagged: false, junk: false, tags: [] },
    { id: 109, subject: "Newsletter: October roundup", author: "The Polimath Dispatch <dispatch@polimath.example>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-11-01T07:00:00"), read: false, flagged: false, junk: false, tags: [] },
    { id: 110, subject: "Re: contract draft", author: "Dana Whitfield <dana@mycompany.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-10-31T16:18:00"), read: true, flagged: false, junk: false, tags: [] },
    { id: 111, subject: "Invoice #8821 attached", author: "Northwind Traders <accounts@northwind.example>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-10-31T09:55:00"), read: true, flagged: false, junk: false, tags: [] },
    { id: 112, subject: "Your order has shipped", author: "Field Supply <orders@field-supply.com>", recipients: ["Stephen <stephen@example.org>"], date: new Date("2026-10-30T14:20:00"), read: true, flagged: false, junk: false, tags: [] },
  ];

  const bodies = {
    101: "Invoice INV-2043\n\nAmount due: $482.00\nDue date: 2026-12-04",
    102: "We detected unusual activity. Verify your account within 24 hours.",
    103: "A new issue has been assigned to you.",
    104: "This week: what we shipped, and what we learned.",
    105: "Thanks for your order. Receipt attached.",
    109: "Click unsubscribe to stop receiving these messages.",
  };

  const store = {
    filters,
    monitoredFolders: [F.pInbox, F.wInbox],
  };

  window.messenger = {
    storage: {
      local: {
        get: async key => (key in store ? { [key]: store[key] } : {}),
        set: async obj => Object.assign(store, obj),
      },
    },
    accounts: {
      list: async () => [folders.personal, folders.work],
    },
    messages: {
      tags: {
        list: async () => [
          { key: "$label1", tag: "Important", color: "#e53e3e", ordinal: "1" },
          { key: "$label2", tag: "Work", color: "#dd6b20", ordinal: "2" },
          { key: "$label3", tag: "Later", color: "#38a169", ordinal: "3" },
          { key: "$label4", tag: "Newsletter", color: "#3182ce", ordinal: "4" },
        ],
      },
      list: async () => ({ id: null, messages: inbox }),
      continueList: async () => ({ id: null, messages: [] }),
      getFull: async id => ({
        headers: { cc: [], bcc: [] },
        parts: [{ contentType: "text/plain", body: bodies[id] || "Hello." }],
      }),
      get: async id => inbox.find(m => m.id === id) || { id, tags: [] },
      update: async () => ({}),
      move: async () => ({}),
      delete: async () => ({}),
    },
    addressBooks: { list: async () => [] },
    contacts: { list: async () => [] },
    runtime: { getManifest: () => ({ version: "3.1.4" }) },
  };
})();
