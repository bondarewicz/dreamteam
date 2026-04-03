/**
 * json-extract.ts — 3-tier JSON extraction from agent output (pure, no I/O)
 *
 * Strategy 1: Direct JSON.parse of the full stripped output
 * Strategy 2: Strip markdown fences (```json ... ``` or ``` ... ```) then parse
 * Strategy 3: Brace-depth scan — find first complete JSON object/array anywhere
 */

/**
 * Extract a JSON value (object or array) from potentially noisy text.
 * Returns the parsed value, or null if all strategies fail.
 */
export function extractJson(output: string): unknown {
  const trimmed = output.trim();

  // Strategy 1: entire output is valid JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Strategy 2: strip markdown code fences
  const fenceMatch = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(output);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Strategy 3: brace-depth scanner — start at every [ or { and walk to matching closer.
  // Tracks string boundaries so braces/brackets inside string values don't desync depth.
  const openers = /[\[{]/g;
  let m: RegExpExecArray | null;
  while ((m = openers.exec(output)) !== null) {
    const start = m.index;
    let depth = 0;
    let inString = false;
    for (let i = start; i < output.length; i++) {
      const ch = output[i];
      if (inString) {
        if (ch === "\\") {
          i++; // skip escaped character
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
      }
      if (depth === 0) {
        try {
          return JSON.parse(output.slice(start, i + 1));
        } catch {
          // this candidate failed, try next opener
        }
        break;
      }
    }
  }

  return null;
}

/**
 * Returns true if any valid JSON object or array exists anywhere in output.
 */
export function hasJson(output: string): boolean {
  return extractJson(output) !== null;
}
