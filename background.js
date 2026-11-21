/**
 * background.js
 * Loads filters and monitored folders from storage, migrates legacy scoping,
 * listens for new mail, runs the filter engine.
 */

let cachedFilters = [];
let cachedMonitoredFolders = [];

async function loadState() {
  const data = await messenger.storage.local.get(["filters", "monitoredFolders", "schemaVersion"]);
  const { filters, changed } = await migrateStoredFilters(data.filters || [], data.schemaVersion);
  if (changed || data.schemaVersion !== CURRENT_SCHEMA) {
    await saveMigratedFilters(filters);
  }

  let monitored = Array.isArray(data.monitoredFolders) ? data.monitoredFolders : null;
  if (monitored === null) {
    try {
      const inboxes = await fetchAccountInboxes();
      monitored = [...inboxes.values()];
    } catch (err) {
      console.error("Polimath Filters: inbox enumeration failed", err);
      monitored = [];
    }
    await messenger.storage.local.set({ monitoredFolders: monitored });
  }

  cachedFilters = filters;
  cachedMonitoredFolders = monitored;
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.filters) cachedFilters = changes.filters.newValue || [];
  if (changes.monitoredFolders) cachedMonitoredFolders = changes.monitoredFolders.newValue || [];
  if (changes.filters || changes.monitoredFolders) scheduleBackup();
  if (changes.backupSettings?.newValue?.enabled && !changes.backupSettings.oldValue?.enabled) scheduleBackup(0);
});

messenger.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  if (!cachedMonitoredFolders.includes(folder.id)) return;

  const activeFilters = cachedFilters.filter(f =>
    f.enabled && (f.sourceFolderIds || []).includes(folder.id)
  );

  const needsFull = activeFilters.some(f => conditionNeedsFullMessage(f.condition));
  const needsAddressBook = activeFilters.some(f => conditionNeedsAddressBook(f.condition));

  let addressBookEmails = null;
  if (needsAddressBook) {
    try {
      addressBookEmails = await fetchAddressBookEmails();
    } catch (err) {
      console.error("Polimath Filters: address book fetch failed", err);
    }
  }

  for (const message of messageList.messages) {
    let fullMessage = null;
    if (needsFull) {
      try {
        fullMessage = await messenger.messages.getFull(message.id);
      } catch (err) {
        console.error("Polimath Filters: getFull failed", err);
      }
    }

    for (const filter of activeFilters) {
      try {
        const matched = await runFilter(filter, message, fullMessage, false, addressBookEmails);
        if (matched && filterEndsProcessing(filter)) break;
      } catch (err) {
        console.error("Polimath Filters: filter error", filter.name, err);
      }
    }
  }
});

// ── Backups ───────────────────────────────────────────────────────────────

const BACKUP_DEBOUNCE_MS = 3 * 60 * 1000;
const BACKUP_STALE_MS = 24 * 60 * 60 * 1000;
const BACKUP_CHECK_MS = 60 * 60 * 1000;
let backupTimer = null;

function scheduleBackup(delay = BACKUP_DEBOUNCE_MS) {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => backupIfEnabled(), delay);
}

async function backupIfEnabled({ onlyIfStale = false } = {}) {
  const data = await messenger.storage.local.get(["backupSettings", "backupState", "filters", "monitoredFolders"]);
  const settings = data.backupSettings || {};
  const state = data.backupState || {};
  if (!settings.enabled || !settings.accountId) return;
  if (onlyIfStale && Date.now() - (state.lastBackupAt || 0) < BACKUP_STALE_MS) return;
  // An empty list would become the day's newest backup and rotate out the real ones.
  if (!(data.filters || []).length) return;
  try {
    await runBackup(data.filters, data.monitoredFolders || [], {
      accountId: settings.accountId,
      extensionVersion: messenger.runtime.getManifest().version,
    });
  } catch (err) {
    console.error("Polimath Filters: backup failed", err);
    await messenger.storage.local.set({ backupState: { ...state, lastError: String(err?.message || err), lastErrorAt: Date.now() } });
  }
}

function versionBefore(version, target) {
  const a = String(version || "0").split(".").map(Number);
  const b = target.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
  }
  return false;
}

// Opening the options page shows the backup offer, or the restore offer when a
// reinstall left no filters but backups exist.
messenger.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === "install" || (reason === "update" && versionBefore(previousVersion, "3.4.0"))) {
    messenger.runtime.openOptionsPage();
  }
});

loadState().then(() => backupIfEnabled({ onlyIfStale: true }));
setInterval(() => backupIfEnabled({ onlyIfStale: true }), BACKUP_CHECK_MS);
