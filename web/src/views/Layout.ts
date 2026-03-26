import { esc } from "./html.ts";

/** Shared HTML shell with nav, dark theme, htmx script */
export function Layout(title: string, body: string, activeNav = ""): string {
  const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/evals", label: "Eval Runs" },
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
    <a href="/" class="nav-brand">Dream<span>Team</span></a>
    ${navLinks}
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`;
}

/** Return HTML with or without Layout wrapper depending on HX-Request header */
export function maybeLayout(req: Request, title: string, body: string, activeNav = ""): string {
  if (req.headers.get("HX-Request")) return body;
  return Layout(title, body, activeNav);
}
