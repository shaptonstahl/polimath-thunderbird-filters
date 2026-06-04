/**
 * background.js
 * Loads filters from storage, listens for new mail, runs the filter engine.
 */

let cachedFilters = [];

async function loadFilters() {
  const data = await messenger.storage.local.get("filters");
  cachedFilters = data.filters || [];
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.filters) {
    cachedFilters = changes.filters.newValue || [];
  }
});

messenger.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  const accountId = folder.accountId;
  const activeFilters = cachedFilters.filter(f =>
    f.enabled && (!f.accountIds?.length || f.accountIds.includes(accountId))
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
        if (matched) break; // first-match semantics for incoming mail
      } catch (err) {
        console.error("Polimath Filters: filter error", filter.name, err);
      }
    }
  }
});

loadFilters();
