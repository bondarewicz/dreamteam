/**
 * frontmatter.ts — read + surgically edit the `model:` block in agent .md files.
 *
 * IMPORTANT: agent frontmatter is NOT always strict YAML — the `description:`
 * field is single-quoted prose with embedded apostrophes/newlines that Bun.YAML
 * rejects. So we never YAML-parse the whole frontmatter. Instead we locate the
 * `model:` block textually (the `model:` line + its indented children) and parse
 * ONLY that small, clean block. Writing is likewise surgical: only the model
 * block is replaced; every other line is preserved byte-for-byte.
 */
import { parseModelSpec, type ModelSpec } from "./model-tiers.ts";

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Find the model block within frontmatter lines: the `model:` line + indented children. */
function modelBlockExtent(lines: string[]): { idx: number; end: number } | null {
  const idx = lines.findIndex((l) => /^model:/.test(l));
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end])) end++;
  return { idx, end };
}

/** The agent's model spec (tier + pins), normalized. Robust to non-YAML descriptions. */
export function readModelSpec(content: string): ModelSpec {
  const m = content.match(FM_RE);
  if (!m) return parseModelSpec(undefined);
  const lines = m[1].split("\n");
  const ext = modelBlockExtent(lines);
  if (!ext) return parseModelSpec(undefined);

  const block = lines.slice(ext.idx, ext.end);
  // Flat: `model: <value>` on one line.
  if (block.length === 1) {
    const inline = block[0].replace(/^model:[ \t]*/, "").trim();
    return parseModelSpec(inline || undefined);
  }
  // Nested: YAML-parse just the (clean) model block.
  try {
    const parsed = Bun.YAML.parse(block.join("\n")) as { model?: unknown };
    return parseModelSpec(parsed?.model);
  } catch {
    return parseModelSpec(undefined);
  }
}

/**
 * Replace the `model:` block with `replacement` (raw lines, no trailing newline).
 * The block spans the `model:` line plus any following more-indented lines. If no
 * `model:` exists, the replacement is inserted after `name:` (or at the top).
 * Surgical — only the model block changes; description etc. are untouched.
 */
export function setModelBlock(content: string, replacement: string): string {
  const m = content.match(FM_RE);
  if (!m) return content; // no frontmatter — leave untouched
  const lines = m[1].split("\n");
  const ext = modelBlockExtent(lines);

  if (!ext) {
    const nameIdx = lines.findIndex((l) => /^name:/.test(l));
    const at = nameIdx === -1 ? 0 : nameIdx + 1;
    lines.splice(at, 0, ...replacement.split("\n"));
  } else {
    lines.splice(ext.idx, ext.end - ext.idx, ...replacement.split("\n"));
  }

  const newFm = lines.join("\n");
  // Function replacer so `$`/`$1` in frontmatter aren't treated as backrefs.
  return content.replace(FM_RE, () => `---\n${newFm}\n---\n`);
}
