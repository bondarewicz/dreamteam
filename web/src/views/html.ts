/**
 * Safe HTML template utilities.
 * esc() escapes user-controlled content to prevent XSS.
 * html`` is a tagged template that trusts its interpolations (use esc() on user data).
 */

/** Canonical agent color map. Shared between Dashboard and EvalRun views. */
export const AGENT_COLORS: Record<string, string> = {
  bird: "#3fb950", mj: "#58a6ff", shaq: "#bc8cff",
  kobe: "#f85149", pippen: "#39d2c0", magic: "#d29922"
};

/** Fallback color for unknown agents */
export const AGENT_COLOR_FALLBACK = "#7d8590";

/** Resolve agent color, falling back to AGENT_COLOR_FALLBACK for unknowns */
export function agentColor(agent: string): string {
  return AGENT_COLORS[agent.toLowerCase()] ?? AGENT_COLOR_FALLBACK;
}

export function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Render a number as a percentage string */
export function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

/** Format milliseconds to human-readable */
export function ms(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

/** Format cost */
export function cost(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(4)}`;
}

/** Pass rate bar fill class */
export function barClass(rate: number): string {
  if (rate >= 0.7) return "";
  if (rate >= 0.4) return "mid";
  return "low";
}

/** Agent chip HTML */
export function agentChip(agent: string): string {
  const key = agent.toLowerCase();
  const isKnown = key in AGENT_COLORS;
  const style = isKnown ? "" : ` style="color:${AGENT_COLOR_FALLBACK};background:rgba(125,133,144,0.12);border:1px solid rgba(125,133,144,0.3);"`;
  return `<span class="agent-badge ${esc(key)}"${style}>${esc(agent)}</span>`;
}

/** Score badge HTML */
export function scoreBadge(score: string): string {
  return `<span class="badge ${esc(score)}">${esc(score)}</span>`;
}

/** Pass rate bar HTML */
export function passBar(rate: number): string {
  const w = Math.round(rate * 100);
  const cls = barClass(rate);
  return `<div class="passbar"><div class="passbar-fill ${cls}" style="width:${w}%"></div></div>`;
}

/** Truncate a string to max chars */
export function truncate(s: string | null | undefined, max = 120): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Format ISO timestamp to display date */
export function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  } catch {
    return ts;
  }
}
