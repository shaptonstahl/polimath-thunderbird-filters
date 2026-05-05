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
  for (const message of messageList.messages) {
    let fullMessage = null;
    const needsFull = cachedFilters.some(
      f => f.enabled && conditionNeedsFullMessage(f.condition)
    );
    if (needsFull) {
      try {
        fullMessage = await messenger.messages.getFull(message.id);
      } catch (err) {
        console.error("Polimath Filters: getFull failed", err);
      }
    }

    for (const filter of cachedFilters) {
      try {
        const matched = await runFilter(filter, message, fullMessage);
        if (matched) break; // first-match semantics for incoming mail
      } catch (err) {
        console.error("Polimath Filters: filter error", filter.name, err);
      }
    }
  }
});

loadFilters();
