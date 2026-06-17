import { esc } from "./html.ts";

/** Shared HTML shell with nav, dark theme, htmx script */
export function Layout(title: string, body: string, activeNav = ""): string {
  const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/scenarios", label: "Scenarios" },
    { href: "/sessions", label: "Sessions" },
    { href: "/admin/models", label: "Admin" },
  ];
  const navLinks = navItems.map(item => {
    const active = activeNav === item.href ? ' style="color:var(--text)"' : "";
    return `<a href="${item.href}"${active}>${item.label}</a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — DreamTeam</title>
<link rel="stylesheet" href="/static/theme.css">
  <script src="/static/htmx.min.js"></script>
</head>
<body>
  <nav>
    ${navLinks}
  </nav>
  <div class="container">
    ${body}
  </div>
  <script>
  // DB stores UTC; render every <time.local-dt> in the viewer's local timezone.
  (function () {
    function pad(n) { return String(n).padStart(2, "0"); }
    function fmt(d) {
      var s = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
              " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      var parts = d.toLocaleTimeString(undefined, { timeZoneName: "short" }).split(" ");
      var tz = parts.length > 1 ? parts[parts.length - 1] : "";
      return tz ? s + " " + tz : s;
    }
    function apply(root) {
      (root || document).querySelectorAll("time.local-dt[datetime]").forEach(function (el) {
        var iso = el.getAttribute("datetime");
        if (!iso) return;
        var d = new Date(iso);
        if (isNaN(d.getTime())) return;
        if (!el.title) el.title = el.textContent.trim();
        el.textContent = fmt(d);
      });
    }
    apply(document);
    document.addEventListener("htmx:afterSwap", function (e) { apply(e.target); });
  })();
  </script>
</body>
</html>`;
}

/** Return HTML with or without Layout wrapper depending on HX-Request header */
export function maybeLayout(req: Request, title: string, body: string, activeNav = ""): string {
  if (req.headers.get("HX-Request")) return body;
  return Layout(title, body, activeNav);
}
