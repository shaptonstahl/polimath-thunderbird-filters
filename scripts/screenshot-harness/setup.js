/* Drives the harness into a named state for headless screenshots.
   Usage: options.html?shot=editor&idx=1&scroll=0 */
(() => {
  const q = new URLSearchParams(location.search);
  const shot = q.get("shot") || "list";
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ready = async () => {
    while (document.querySelectorAll("#filter-list li").length === 0) await wait(50);
  };

  window.addEventListener("load", async () => {
    await ready();
    if (shot === "editor") {
      const idx = Number(q.get("idx") || 0);
      document.querySelectorAll("#filter-list li")[idx].click();
      await wait(100);
      const body = document.querySelector(".editor-body");
      body.scrollTop = Number(q.get("scroll") || 0);
    } else if (shot === "help") {
      document.getElementById("btn-help").click();
    } else if (shot === "monitored") {
      document.getElementById("btn-monitored-folders").click();
    } else if (shot === "run") {
      document.getElementById("btn-run-all").click();
      await wait(100);
      document.getElementById("modal-folder-select").value = q.get("folder") || "folder://personal/Inbox";
      await executeModalRun(q.get("dry") !== "0");
    }
    document.documentElement.dataset.shotReady = "1";
  });
})();
