// --- commit sha (local dev fallback) ---
// Deploy workflow sed-replaces __COMMIT_SHA_SHORT__ / __COMMIT_SHA_FULL__.
// If the placeholder is still present, we're running locally — show "local".
(() => {
  const el = document.querySelector("[data-commit-sha]");
  if (!el) return;
  if (el.textContent.includes("__COMMIT_SHA")) {
    el.textContent = "local";
    el.removeAttribute("href");
    el.removeAttribute("target");
    el.removeAttribute("rel");
  }
})();

// --- copy install command ---
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.getAttribute("data-copy");
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1400);
    } catch {
      btn.textContent = "Press ⌘C";
    }
  });
});
