/**
 * Safe HTML template utilities.
 * esc() escapes user-controlled content to prevent XSS.
 * html`` is a tagged template that trusts its interpolations (use esc() on user data).
 */

/** Canonical agent color map. Shared between Dashboard and EvalRun views. */
export const AGENT_COLORS: Record<string, string> = {
  bird: "#3fb950", mj: "#58a6ff", shaq: "#bc8cff",
  kobe: "#f85149", pippen: "#39d2c0", magic: "#d29922",
  team: "#e8912d", coachk: "#a371f7"
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

/** Pass rate bar HTML — multi-segment (green/yellow/red) proportional to counts */
export function passBar(pass: number | null | undefined, partial: number | null | undefined, fail: number | null | undefined): string {
  const p = Math.max(0, pass ?? 0);
  const pa = Math.max(0, partial ?? 0);
  const f = Math.max(0, fail ?? 0);
  const total = p + pa + f;
  if (total === 0) {
    return `<div class="passbar"></div>`;
  }
  // Build ordered list of non-zero segments; the last one uses flex:1 to absorb rounding slack.
  const nonZero: Array<{ cls: string; count: number }> = [];
  if (p > 0) nonZero.push({ cls: "pass", count: p });
  if (pa > 0) nonZero.push({ cls: "partial", count: pa });
  if (f > 0) nonZero.push({ cls: "fail", count: f });
  const segments = nonZero.map((seg, i) => {
    const isLast = i === nonZero.length - 1;
    const widthStyle = isLast ? "flex:1" : `width:${Math.round((seg.count / total) * 100)}%`;
    return `<div class="passbar-seg ${seg.cls}" style="${widthStyle}"></div>`;
  });
  return `<div class="passbar">${segments.join("")}</div>`;
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
