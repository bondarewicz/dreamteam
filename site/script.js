// --- GitHub star count ---
(async () => {
  const els = document.querySelectorAll("[data-star-count]");
  if (!els.length) return;
  const format = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  try {
    const res = await fetch("https://api.github.com/repos/bondarewicz/dreamteam", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const n = data.stargazers_count ?? 0;
    els.forEach((el) => (el.textContent = format(n)));
  } catch (err) {
    console.warn("star count fetch failed:", err);
    els.forEach((el) => (el.textContent = "★"));
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
