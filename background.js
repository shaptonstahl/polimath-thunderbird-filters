/**
 * background.js
 * Loads filters and monitored folders from storage, migrates legacy scoping,
 * listens for new mail, runs the filter engine.
 */

let cachedFilters = [];
let cachedMonitoredFolders = [];

async function loadState() {
  const data = await messenger.storage.local.get(["filters", "monitoredFolders"]);
  const originalFilters = data.filters || [];
  const filters = await migrateFiltersToSourceFolders(originalFilters);
  if (filters !== originalFilters) {
    await messenger.storage.local.set({ filters });
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

loadState();
