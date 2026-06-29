#!/usr/bin/env bun
/**
 * instinct-scrub.ts — deterministic, non-LLM DROP gate for shareable-tier instinct candidates.
 *
 * Decision semantics: DROP, never redact.
 *   - If ANY field (or the cross-field concatenation) fails ANY detector, the ENTIRE candidate
 *     is dropped. No per-field salvage (C-2.4/C-2.5, BR-9, BR-11).
 *   - Not applied to scoped_facts — they are isolated, not scrubbed.
 *
 * C-2 hardening applied:
 *   C-2.1  Decode-and-rescan: base64 / hex / percent-decode → if printable ASCII → rescan + DROP
 *   C-2.2  NFKC normalize + confusable-fold before scanning; case-insensitive rule #4
 *   C-2.3  Cross-field concat scan (all fields, full concat, adjacent-pair joins)
 *   C-2.4  Whole-candidate DROP on any field failure (no evidence pruning)
 *   C-2.5  DROP on evidence failure → entire instinct dropped
 *
 * Mirrors check-unicode-safety.ts in shape: exported RULES, scan/scrub functions,
 * import.meta.main CLI guard.
 *
 * Rule 4 (BR-9.4a′ — Bird ruling 2026-06-26, path C):
 *   No wordlist. A Title-case token drops ONLY on a positive name-signal (naming-context
 *   DR-6 or camelCaps/PascalCase code shape). A bare signal-less name passes Rule 4 and
 *   is backstopped by BR-13. See rule comment below for full decision tree.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstinctCandidate {
  trigger: string;
  behavioral_shape: string;
  evidence: string[];
}

export type ScrubResult =
  | { ok: true }
  | { ok: false; reason: string; matchedRule: string };

/**
 * Scrub mode (Bird ruling 2026-06-26, Round 2).
 *
 * 'analyzer' (default): stricter gate — code-shape (camelCase/PascalCase), proper-nouns,
 *   org/repo, UUIDs, UPPER_SNAKE are all potential drops.  Used by the session analyzer
 *   where human review is not guaranteed before sharing.
 *
 * 'migration': HARD-identifier-only gate — drops only genuine secrets, emails, real URLs,
 *   username-revealing paths, invisible-unicode/homoglyph, and imperative commands.
 *   Code shape, product/roster names, bare acronyms, UUIDs, snake_case, org/repo → KEEP.
 *   Used by the one-time file-memory migration (import-file-memory.ts) where content is
 *   the user's own existing memories and human review is the stated backstop (BR-MIG-11).
 */
export interface ScrubOpts {
  mode?: 'migration' | 'analyzer';
}

export interface Rule {
  name: string;
  /** Returns a truthy reason string if the text fails this rule, or null/undefined if it passes. */
  test: (text: string) => string | null | undefined;
}

// ---------------------------------------------------------------------------
// Generic-tech allowlist (Rule 4 DR-3 — tech terms that aren't dictionary words)
// These are widely shared, not client-identifying.
// ---------------------------------------------------------------------------
const GENERIC_TECH_ALLOWLIST = new Set([
  // Version-control / build
  "git", "github", "gitlab", "bitbucket", "svn", "mercurial",
  // Languages
  "javascript", "typescript", "python", "java", "kotlin", "ruby", "rust",
  "go", "golang", "csharp", "c#", "php", "swift", "scala", "haskell",
  "elixir", "clojure", "erlang", "lua", "perl", "bash", "sh", "zsh",
  "powershell", "html", "css", "json", "yaml", "toml", "xml",
  // Runtimes / infra
  "node", "nodejs", "bun", "deno", "docker", "kubernetes", "k8s",
  "linux", "unix", "macos", "windows", "ubuntu", "debian", "alpine",
  // DB / data
  "sql", "sqlite", "postgres", "postgresql", "mysql", "mongodb", "redis",
  "cassandra", "dynamodb", "elasticsearch", "opensearch",
  // Cloud (generic)
  "aws", "gcp", "azure",
  // Frameworks (common)
  "react", "vue", "angular", "svelte", "nextjs", "nuxt", "remix",
  "django", "flask", "fastapi", "rails", "laravel", "spring", "express",
  "prisma", "drizzle", "sequelize", "typeorm",
  // Testing / CI
  "jest", "vitest", "mocha", "chai", "cypress", "playwright",
  "github actions", "circleci", "jenkins",
  // Protocols / specs
  "http", "https", "rest", "graphql", "grpc", "websocket", "tcp", "udp",
  "oauth", "jwt", "tls", "ssl",
  // Agent names (dream team) + product name (both-paths fix — Bird ruling Round 2)
  "dream", "dreamteam",
  "shaq", "shaquille", "kobe", "pippen", "magic", "bird", "drexler",
  "mj", "michael", "coach", "claude", "anthropic",
  // Generic ops terms
  "api", "sdk", "cli", "ide", "ci", "cd", "devops", "ops",
  // Software engineering jargon not in general English dictionaries (DR-3)
  // These are widely shared technical concepts, not client-identifying.
  "memoize", "memoization", "idempotency", "backpressure", "deduplicate",
  "deduplication", "checkpoint", "upsert", "debounce", "throttle",
  "caching", "microservice", "microservices", "webhook", "webhooks",
  "middleware", "sidecar", "canary", "rollout", "kubectl",
  "monorepo", "polyrepo", "treeshake", "treeshaking", "bundler",
  "transpile", "transpiler", "polyfill", "sourcemap", "sourcemaps",
  // Normalization-related database/CS jargon
  "denormalize", "denormalization", "denormalized",
]);

function inTechAllowlist(token: string): boolean {
  return GENERIC_TECH_ALLOWLIST.has(token.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// C-2.2: NFKC normalization + confusable fold
// Maps common Cyrillic/Greek lookalikes to their ASCII equivalents.
// ---------------------------------------------------------------------------
const CONFUSABLE_MAP: Record<string, string> = {
  // Cyrillic → ASCII (most common lookalikes)
  "А": "A", "а": "a", // А а
  "В": "B", "в": "b", // В в
  "С": "C", "с": "c", // С с
  "Е": "E", "е": "e", // Е е
  "Х": "X", "х": "x", // Х х
  "і": "i",                // і (Ukrainian i)
  "һ": "H",                // Һ
  "М": "M", "м": "m", // М м
  "Н": "H", "н": "h", // Н н
  "О": "O", "о": "o", // О о
  "Р": "P", "р": "p", // Р р
  "Т": "T", "т": "t", // Т т
  "у": "y",                // у
  "ѡ": "W",                // Ѡ
  // Greek → ASCII
  "Β": "B",                // Greek Β
  "Ε": "E",                // Greek Ε
  "Ζ": "Z",                // Greek Ζ
  "Η": "H",                // Greek Η
  "Ι": "I",                // Greek Ι
  "Κ": "K",                // Greek Κ
  "Μ": "M",                // Greek Μ
  "Ν": "N",                // Greek Ν
  "Ο": "O",                // Greek Ο
  "Ρ": "P",                // Greek Ρ
  "Τ": "T",                // Greek Τ
  "Υ": "Y",                // Greek Υ
  "Χ": "X",                // Greek Χ
  "α": "a",                // Greek α
  "β": "b",                // Greek β
  "ε": "e",                // Greek ε
  "ι": "i",                // Greek ι
  "ν": "v",                // Greek ν
  "ο": "o",                // Greek ο
  "ρ": "p",                // Greek ρ
  "υ": "u",                // Greek υ
  "χ": "x",                // Greek χ
};

function confusableFold(text: string): string {
  return [...text].map(ch => CONFUSABLE_MAP[ch] ?? ch).join("");
}

function nfkcFold(text: string): string {
  // NFKC normalize then apply confusable map
  const nfkc = text.normalize("NFKC");
  return confusableFold(nfkc);
}

// ---------------------------------------------------------------------------
// C-2.1: Decode-and-rescan helpers
// ---------------------------------------------------------------------------

/** Returns decoded string if it looks like valid base64 and decodes to printable ASCII. */
function tryBase64Decode(text: string): string | null {
  // Match base64 tokens: ≥8 chars of base64 alphabet (lower threshold to catch short names)
  const tokens = text.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? [];
  for (const tok of tokens) {
    try {
      const decoded = atob(tok);
      if (isPrintableAscii(decoded) && decoded.length >= 4) return decoded;
    } catch {
      // not valid base64
    }
  }
  return null;
}

/** Returns decoded string if a hex run of ≥8 chars decodes to printable ASCII. */
function tryHexDecode(text: string): string | null {
  const tokens = text.match(/(?:0x)?[0-9a-fA-F]{8,}/g) ?? [];
  for (const tok of tokens) {
    const hex = tok.startsWith("0x") || tok.startsWith("0X") ? tok.slice(2) : tok;
    if (hex.length % 2 !== 0) continue;
    try {
      let out = "";
      for (let i = 0; i < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      if (isPrintableAscii(out) && out.length >= 4) return out;
    } catch {
      // ignore
    }
  }
  return null;
}

/** Returns decoded string if it looks like percent-encoded and decodes cleanly. */
function tryPercentDecode(text: string): string | null {
  if (!text.includes("%")) return null;
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text && isPrintableAscii(decoded)) return decoded;
  } catch {
    // malformed percent-encoding
  }
  return null;
}

function isPrintableAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Zero-width / invisible Unicode detector (composition with check-unicode-safety)
// ---------------------------------------------------------------------------
function hasInvisibleUnicode(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Tag-block (ASCII smuggling), zero-width chars, bidi overrides
    if (cp >= 0xe0000 && cp <= 0xe007f) return true;
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060) return true;
    if (cp === 0xfeff || cp === 0x00ad) return true;
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return true;
    if (cp === 0x200e || cp === 0x200f) return true;
  }
  return false;
}

/**
 * Strip invisible/zero-width unicode codepoints from text.
 * Mirrors the codepoint set in hasInvisibleUnicode() but removes chars instead of detecting.
 * Used by maskEvidence() to clean evidence before masking (NOT used by scrub() — scrub DROPs).
 */
function stripInvisibleUnicodeChars(text: string): string {
  return [...text].filter(ch => {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0000 && cp <= 0xe007f) return false; // Tag-block
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060) return false; // ZWSP, ZWJ etc.
    if (cp === 0xfeff || cp === 0x00ad) return false;  // BOM, soft-hyphen
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return false; // Bidi
    if (cp === 0x200e || cp === 0x200f) return false;  // LRM, RLM
    return true;
  }).join("");
}

/** Returns true if text contains non-ASCII letters embedded in an otherwise-Latin token. */
function hasSuspiciousNonAscii(text: string): boolean {
  // Tokenize by whitespace, check each token for mixed-script non-ASCII letters
  const tokens = text.split(/\s+/);
  for (const tok of tokens) {
    if (tok.length === 0) continue;
    const hasAsciiLetter = /[a-zA-Z]/.test(tok);
    const hasNonAsciiLetter = /[^\x00-\x7F]/.test(tok) &&
      [...tok].some(ch => {
        const cp = ch.codePointAt(0)!;
        // non-ASCII letter (not punctuation/space)
        return cp > 0x7f && /\p{L}/u.test(ch);
      });
    if (hasAsciiLetter && hasNonAsciiLetter) return true;
    // Also catch tokens that are PURELY non-ASCII letters (e.g. full Cyrillic word)
    // but look like they spell an English word when folded
    if (!hasAsciiLetter && hasNonAsciiLetter) {
      const folded = nfkcFold(tok).toLowerCase();
      if (/^[a-z]{3,}$/.test(folded)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rule 4 helpers: clause-initial detection (DR-2) + naming-context (DR-6)
// ---------------------------------------------------------------------------

/**
 * DR-2: Clause-initial positions carry no proper-noun signal.
 * Returns a Set of char offsets that are clause-initial in `text`
 * (immediately after: start, `.`, `!`, `?`, `:`, `→`, `\n`).
 *
 * Works on the original text (not NFKC-folded) because offsets must align.
 */
function clauseInitialOffsets(text: string): Set<number> {
  const offsets = new Set<number>();
  // Start of string is always clause-initial
  offsets.add(0);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === ":" || ch === "\n" || ch === "→") {
      // Skip whitespace after the boundary marker
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
      if (j < text.length) offsets.add(j);
    }
  }
  return offsets;
}

/**
 * Naming-context entity words (DR-6).
 * If any of these appear within ±5 tokens of a Title-case word,
 * the Title-case word is treated as a name even if it's in the dictionary.
 */
const ENTITY_CONTEXT_WORDS = new Set([
  "client", "customer", "tenant", "account", "company", "organization", "org",
  "cluster", "instance", "environment", "workspace", "repo", "repository",
  "project", "team", "group", "department", "division", "partner", "vendor",
  "named", "called", "known", "brand", "product", "platform",
]);

/**
 * DR-6: Returns true if the text has naming-context near a Title-case token.
 * Checks for:
 *   (a) possessive `'s` immediately after the token (e.g. "Acme's")
 *   (b) entity words within ±5 words of the token position
 */
function hasNamingContext(text: string, tokenStart: number, tokenEnd: number): boolean {
  // (a) Possessive: token immediately followed by 's
  const after = text.slice(tokenEnd, tokenEnd + 3);
  if (after.startsWith("'s") || after.startsWith("’s")) return true;

  // (b) Entity words within ±5 words
  // Tokenize the whole text, find the index of our token, check neighbours
  const wordPattern = /\b\w+\b/g;
  const allWords: Array<{ word: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = wordPattern.exec(text)) !== null) {
    allWords.push({ word: m[0], start: m.index });
  }

  // Find which word index corresponds to tokenStart
  let tokIdx = -1;
  for (let i = 0; i < allWords.length; i++) {
    if (allWords[i].start === tokenStart) { tokIdx = i; break; }
  }
  if (tokIdx === -1) return false;

  const lo = Math.max(0, tokIdx - 5);
  const hi = Math.min(allWords.length - 1, tokIdx + 5);
  for (let i = lo; i <= hi; i++) {
    if (i !== tokIdx && ENTITY_CONTEXT_WORDS.has(allWords[i].word.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// scanForIdentifyingContent — run on backtick/quoted CONTENTS only.
// Deliberately does NOT reference RULES to avoid circular initialisation.
// Only structural-identifier rules fire here; code-shape alone is NOT a signal.
// ---------------------------------------------------------------------------
function scanForIdentifyingContent(inner: string): string | null {
  const t = nfkcFold(inner);
  // Secrets
  if (/\bsk-[A-Za-z0-9]{10,}/.test(t)) return "secret key (sk-) in quoted content";
  if (/\bghp_[A-Za-z0-9]{10,}/.test(t)) return "GitHub PAT in quoted content";
  if (/\bAKIA[A-Z0-9]{16}\b/.test(t)) return "AWS key in quoted content";
  if (/(?:key|token|password|passwd|secret|auth)\s*[=:]\s*\S{6,}/i.test(t)) return "credential assignment in quoted content";
  if (/\beyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\b/.test(t)) return "JWT in quoted content";
  const b64m = t.match(/[A-Za-z0-9+/]{32,}={0,2}/);
  if (b64m) {
    const tok = b64m[0];
    if (/[A-Z]/.test(tok) && /[a-z]/.test(tok) && /[0-9]/.test(tok)) return "high-entropy token in quoted content";
  }
  if (/\b[0-9a-fA-F]{16,}\b/.test(t)) return "hex token in quoted content";
  // URLs / hostnames
  if (/https?:\/\//.test(t)) return "URL in quoted content";
  if (/\bapi\.[a-z0-9\-]+\.[a-z]{2,}/i.test(t)) return "API hostname in quoted content";
  if (/\b[a-z0-9\-]+\.(?:com|io|net|org|dev|app|cloud)\b/i.test(t)) return "hostname in quoted content";
  // Emails / UUIDs
  if (/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/.test(t)) return "email in quoted content";
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t)) return "UUID in quoted content";
  if (/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]{1,}){1,}\b/.test(t)) return "UPPER_SNAKE env-var in quoted content";
  // Username-revealing paths
  if (/(?:\/Users\/|\/home\/)([a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63})\//.test(t)) return "username path in quoted content";
  // Invisible unicode
  if (hasInvisibleUnicode(t)) return "invisible unicode in quoted content";
  return null;
}

// ---------------------------------------------------------------------------
// Helper: detect whether an org/repo segment is a proper name.
// A segment is "generic/tech" if it is in the expanded generic set, in the
// GENERIC_TECH_ALLOWLIST, OR is an all-lowercase/hyphenated slug (accepted
// residual: e.g. "bondarewicz" all-lowercase is backstopped by BR-13).
// A segment that STARTS with an uppercase letter carries a name-signal and
// causes the org/repo pair to DROP.
// ---------------------------------------------------------------------------
const GENERIC_PATH_SEGMENTS = new Set([
  "opt", "usr", "var", "etc", "tmp", "home", "bin", "lib", "app", "src", "web",
  "api", "docs", "test", "tests", "spec", "specs", "config", "scripts", "dist",
  "build", "packages", "examples", "samples", "demo", "utils", "helpers", "core",
  "main", "index", "common", "shared", "public", "private", "data", "assets",
  "views", "models", "controllers", "services", "routes", "middleware",
  "ui", "ux", "db", "io", "os", "cli", "sdk",
]);

function isGenericOrTechSegment(seg: string): boolean {
  if (GENERIC_PATH_SEGMENTS.has(seg.toLowerCase())) return true;
  if (inTechAllowlist(seg)) return true;
  // All-lowercase/hyphen slug → treat as generic (proper names are capitalised in text)
  if (/^[a-z][a-z0-9\-_]*$/.test(seg)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core detectors (exported as RULES)
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  // -------------------------------------------------------------------------
  // Rule 0: Invisible/zero-width Unicode (unicode-safety composition + C-2.2)
  // -------------------------------------------------------------------------
  {
    name: "invisible-unicode",
    test(text) {
      if (hasInvisibleUnicode(text)) return "invisible or zero-width Unicode codepoint detected";
      if (hasSuspiciousNonAscii(text)) return "non-ASCII letters mixed into Latin token (homoglyph attack)";
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 1: Filesystem paths (NARROWED — Bird ruling 2026-06-26)
  //
  // KEEP: ~/... paths (tilde deliberately elides username — the OPPOSITE of identifying)
  // KEEP: generic absolute system paths (/var/log/..., /etc/..., /usr/...)
  // KEEP: generic dotted config paths (.eslintrc.js, .env.production — secrets caught by Rule 3)
  // KEEP: org/repo when BOTH segments are generic/tech/all-lowercase (accepted residual per BR-9.4b′)
  //
  // DROP: username-revealing absolute paths (/Users/<name>/ or /home/<name>/)
  // DROP: Windows paths (C:\... reveals the OS user context)
  // DROP: org/repo when a segment STARTS WITH UPPERCASE (name-signal — e.g. Bondarewicz/dreamteam)
  // -------------------------------------------------------------------------
  {
    name: "filesystem-path",
    test(text) {
      const t = nfkcFold(text);

      // Username-revealing absolute Unix paths: /Users/<name>/ or /home/<name>/
      // Generic system paths (/var/log/, /etc/, /usr/) are NOT dropped.
      if (/(?:\/Users\/|\/home\/)([a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63})\//.test(t)) {
        return "filesystem path (username-revealing: /Users/ or /home/ path)";
      }

      // Windows paths: C:\...  (retain — reveals user context via C:\Users\)
      if (/[A-Za-z]:\\[A-Za-z0-9_\-\. \\]/.test(t)) return "filesystem path (Windows)";

      // Org/repo shape: DROP only when a segment carries a Title-case proper-name signal.
      // Both-generic / all-lowercase pairs are KEPT (generic tech slugs, accepted residual).
      // ALL-CAPS segments (DORA, METR, API) are NOT treated as proper names — they are
      // acronyms, not organisation names. Only Title-case (Capital + lowercase tail) drops.
      const orgRepoMatch = t.match(/(?:^|\s|["'`])([a-zA-Z][a-zA-Z0-9_\-]{1,39})\/([a-zA-Z][a-zA-Z0-9_\-]{1,39})(?:\s|$|["'`])/);
      if (orgRepoMatch) {
        const [, org, repo] = orgRepoMatch;
        // Title-case: starts with uppercase letter followed by lowercase (e.g. Bondarewicz).
        // All-caps segments (DORA, METR) and all-lowercase slugs are generic → KEEP.
        const isTitleCase = (s: string) => /^[A-Z][a-z]/.test(s);
        const orgProper = isTitleCase(org) && !isGenericOrTechSegment(org);
        const repoProper = isTitleCase(repo) && !isGenericOrTechSegment(repo);
        if (orgProper || repoProper) {
          return "filesystem path (org/repo with proper-name segment)";
        }
      }

      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 2: Code literals / identifiers (NARROWED — Bird ruling 2026-06-26)
  //
  // Governing principle: code SHAPE alone is NOT a drop signal when the shape is
  // ubiquitous in dev guidance (snake_case, generic function calls, known tech names).
  // DROP only when the content also carries an identifying signal.
  //
  // NARROWED:
  //   backtick/quoted wrapper  → re-scan CONTENTS with structural-identifier rules
  //   PascalCase               → GENERIC_TECH_ALLOWLIST is a hard KEEP (parity with Rule 4)
  //   snake_case               → REMOVED (generic_snake_case like run_in_background → KEEP)
  //   function call shape      → REMOVED (camelCase/PascalCase callers already caught above)
  //   SQL object reference     → REMOVED (false-positives on prose; real secrets → Rule 3)
  //
  // KEPT STRICT:
  //   camelCase                → remains (widgetCo, acmeCorp are mixed-case code identifiers)
  //   PascalCase non-allowlist → remains for BlueSkyInc etc. after allowlist check
  //   backtick/quoted contents → dropped only if contents fail a structural rule
  //
  // NOTE: BR-S3 (full-strict re-scrub at Turso/promotion boundary) is deferred.
  // The shareable-tier gate here is the first line of defence; BR-13 (human review)
  // and the promotion-boundary scrub are the backstops for generic-shape residuals.
  // -------------------------------------------------------------------------
  {
    name: "code-literal",
    test(text) {
      const t = nfkcFold(text);

      // Backtick-quoted snippet: re-scan CONTENTS, not just the wrapper.
      // `bun test` → KEEP (contents clean); `sk-abc123...` → DROP (secret in contents).
      const backtickMatch = t.match(/`([^`]{1,200})`/);
      if (backtickMatch) {
        const inner = backtickMatch[1];
        const innerHit = scanForIdentifyingContent(inner);
        if (innerHit) return `backtick-quoted content: ${innerHit}`;
      }

      // Quoted code-ish identifier: re-scan CONTENTS, not just the wrapper.
      // "run_in_background" → KEEP; "sk-abc123..." → DROP.
      const quotedMatch = t.match(/["']([a-zA-Z_][a-zA-Z0-9_\.:\-\/]{4,})["']/);
      if (quotedMatch) {
        const inner = quotedMatch[1];
        const innerHit = scanForIdentifyingContent(inner);
        if (innerHit) return `quoted content: ${innerHit}`;
      }

      // camelCase: lower + Capital + tail (widgetCo, acmeCorp, fooBar, userService).
      // Retained: mixed-case code identifiers carry an identifying signal.
      if (/\b[a-z][a-z0-9]+[A-Z][a-zA-Z0-9]+\b/.test(t)) return "camelCase identifier";

      // PascalCase with ≥2 capitals (e.g. BlueSkyInc, AcmeCorp).
      // GENERIC_TECH_ALLOWLIST is a hard KEEP first (TypeScript, GitHub, JavaScript, …).
      const pascalMatch = t.match(/\b([A-Z][a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/);
      if (pascalMatch) {
        const tok = pascalMatch[1];
        if (!inTechAllowlist(tok)) return "PascalCase identifier";
      }

      // snake_case → REMOVED: generic snake_case (run_in_background, route_fixes,
      // customer_accounts) is ubiquitous in dev guidance and rarely identifying.
      // Accepted residual per BR-9.4b′; backstopped by BR-13 + BR-S3 promotion scrub.

      // function call shape → REMOVED: camelCase/PascalCase callers are already caught
      // above. Bare generic calls like deploy() or validate() are not identifying.

      // SQL object reference → REMOVED: false-positives on prose (FROM clause in
      // natural language). Real secrets in SQL are caught by Rule 3 (secret-token).

      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 3: Secret-shaped tokens
  // -------------------------------------------------------------------------
  {
    name: "secret-token",
    test(text) {
      const t = nfkcFold(text);
      // Known prefixes
      if (/\bsk-[A-Za-z0-9]{10,}/.test(t)) return "OpenAI/Anthropic secret key prefix (sk-)";
      if (/\bghp_[A-Za-z0-9]{10,}/.test(t)) return "GitHub PAT prefix (ghp_)";
      if (/\bAKIA[A-Z0-9]{16}\b/.test(t)) return "AWS access key prefix (AKIA)";
      // Assignment patterns
      if (/(?:key|token|password|passwd|secret|auth)\s*[=:]\s*\S{6,}/i.test(t)) {
        return "key/token/password assignment";
      }
      // JWT three-segment shape
      if (/\beyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\b/.test(t)) {
        return "JWT-shaped token";
      }
      // Long high-entropy base64 run (≥32 chars, mixed case + numbers)
      if (/[A-Za-z0-9+/]{32,}={0,2}/.test(t)) {
        const match = t.match(/[A-Za-z0-9+/]{32,}={0,2}/);
        if (match) {
          const tok = match[0];
          const hasUpper = /[A-Z]/.test(tok);
          const hasLower = /[a-z]/.test(tok);
          const hasDigit = /[0-9]/.test(tok);
          if (hasUpper && hasLower && hasDigit) return "high-entropy base64-shaped token";
        }
      }
      // Long hex run (≥16 hex chars)
      if (/\b[0-9a-fA-F]{16,}\b/.test(t)) return "high-entropy hex token";
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 4: Proper-noun detector — discriminates by REFERENT, not capitalization.
  //         (Bird ruling 2026-06-26, path C — no wordlist; BR-9.4a′/4b′)
  //
  // Title-case tokens (Capital + lowercase tail ≥3 chars):
  //   DR-3 (tech allowlist): token is in GENERIC_TECH_ALLOWLIST → hard KEEP
  //   DR-2 (clause-initial): token is first word after clause boundary → KEEP
  //   DR-6 (naming-context): possessive 's or entity-word proximity → DROP
  //   Default: KEEP — no wordlist, no DR-5. A bare signal-less name passes Rule 4;
  //            the accepted residual is backstopped by BR-13.
  //
  // All-caps tokens (≥2 uppercase letters, no underscores — AC-pos-3):
  //   GENERIC_TECH_ALLOWLIST → hard KEEP (API, SQL, AWS, …)
  //   DR-6 naming-context (possessive or entity-word) → DROP (acronym used as name)
  //   Bare all-caps, no context → KEEP (overwhelmingly a tech acronym)
  //
  // NFKC+confusable fold is applied before scanning so "Аcme" (Cyrillic А)
  // folds to "Acme" and is evaluated by DR-6/DR-2 like plain "Acme".
  // camelCaps/PascalCase shapes are routed via Rule 2 (code-literal), not here.
  // -------------------------------------------------------------------------
  {
    name: "proper-noun",
    test(rawText) {
      // Apply NFKC+confusable fold for the token scan
      const t = nfkcFold(rawText);

      // Find the set of clause-initial offsets in the FOLDED text
      // (offsets align because confusable fold is char-for-char)
      const clauseStarts = clauseInitialOffsets(t);

      // --- Title-case token scan (Capital + lowercase tail ≥3 chars) ---
      // Does NOT match ALL-CAPS (those are handled in the second scan below).
      const titlePattern = /\b[A-Z][a-z]{2,}\b/g;
      let m: RegExpExecArray | null;
      while ((m = titlePattern.exec(t)) !== null) {
        const tok = m[0];
        const start = m.index;
        const end = start + tok.length;
        const lower = tok.toLowerCase();

        // DR-3: tech allowlist is a hard KEEP
        if (inTechAllowlist(lower)) continue;

        // DR-2: clause-initial token — carry no proper-noun penalty (skip)
        if (clauseStarts.has(start)) continue;

        // DR-6: naming-context override — entity words or possessive → DROP
        if (hasNamingContext(t, start, end)) {
          return `proper noun in naming context: "${tok}"`;
        }

        // Default: KEEP — no wordlist, no DR-5. Bare signal-less names pass.
      }

      // --- All-caps token scan (AC-pos-3: acronym-as-name corroboration) ---
      // Matches ≥2 consecutive uppercase letters at a word boundary.
      // UPPER_SNAKE patterns (e.g. DATABASE_URL) are NOT matched here because
      // the underscore is a word char (\w), so no \b exists between caps and _.
      // Those are caught by the domain-identifier rule (Rule 6).
      const allCapsPattern = /\b[A-Z]{2,}\b/g;
      while ((m = allCapsPattern.exec(t)) !== null) {
        const tok = m[0];
        const start = m.index;
        const end = start + tok.length;
        const lower = tok.toLowerCase();

        // GENERIC_TECH_ALLOWLIST: hard KEEP regardless of context (API, SQL, AWS, …)
        if (inTechAllowlist(lower)) continue;

        // DR-6: naming-context corroboration (possessive 's or entity-word) → DROP
        // A bare all-caps token without corroboration is overwhelmingly a tech acronym → KEEP.
        if (hasNamingContext(t, start, end)) {
          return `all-caps acronym used as name (naming context): "${tok}"`;
        }

        // Bare all-caps, no context → KEEP
      }

      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 5: URLs / endpoints
  // -------------------------------------------------------------------------
  {
    name: "url-endpoint",
    test(text) {
      const t = nfkcFold(text);
      if (/https?:\/\//.test(t)) return "URL (http/https)";
      if (/\bapi\.[a-z0-9\-]+\.[a-z]{2,}/i.test(t)) return "API hostname (api.domain)";
      if (/\b[a-z0-9\-]+\.(?:com|io|net|org|dev|app|cloud)\b/i.test(t)) return "domain-like hostname";
      if (/\/v\d+\/[a-zA-Z0-9_\-\/]{3,}/.test(t)) return "versioned API route (/v1/...)";
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 6: Domain identifiers (env vars, emails, UUIDs)
  // -------------------------------------------------------------------------
  {
    name: "domain-identifier",
    test(text) {
      const t = nfkcFold(text);
      // UPPER_SNAKE env var (≥2 segments, ≥6 chars total)
      if (/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]{1,}){1,}\b/.test(t)) {
        return "UPPER_SNAKE env-var shaped identifier";
      }
      // Email address
      if (/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/.test(t)) {
        return "email address";
      }
      // UUID (8-4-4-4-12 hex)
      if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t)) {
        return "UUID-shaped identifier";
      }
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Rule 7: C-1 imperative / command-shape detector
  // Applies to ALL candidates (including human-directive instincts).
  // -------------------------------------------------------------------------
  {
    name: "imperative-command",
    test(text) {
      const t = nfkcFold(text).toLowerCase();
      // Shell commands
      if (/\bcurl\s/.test(t)) return "shell command: curl";
      if (/\bwget\s/.test(t)) return "shell command: wget";
      if (/\|\s*sh\b/.test(t)) return "shell pipe to sh";
      if (/\|\s*bash\b/.test(t)) return "shell pipe to bash";
      if (/\beval\s*\(/.test(t) || /\beval\s+"/.test(t) || /\beval\s+'/.test(t)) {
        return "eval invocation";
      }
      if (/\brm\s+-rf\b/.test(t)) return "destructive rm -rf";
      if (/\bchmod\s+[0-7o+\-]{1,6}\s/.test(t)) return "chmod invocation";
      if (/\bsudo\s+/.test(t)) return "sudo invocation";
      // Package install verbs
      if (/\bnpm\s+install\b/.test(t)) return "npm install command";
      if (/\bpip\s+install\b/.test(t)) return "pip install command";
      if (/\bapt(?:-get)?\s+install\b/.test(t)) return "apt install command";
      if (/\bbrew\s+install\b/.test(t)) return "brew install command";
      if (/\byarn\s+add\b/.test(t)) return "yarn add command";
      if (/\bbun\s+(?:add|install)\b/.test(t)) return "bun install/add command";
      // Output redirection to a path
      if (/>\s*\/[a-zA-Z0-9_\-\.\/]{3,}/.test(t)) return "output redirection to path";
      if (/>\s*~\/[a-zA-Z0-9_\-\.\/]{2,}/.test(t)) return "output redirection to home path";
      // Safety-weakening instructions (allow up to 4 intervening words)
      if (/disable\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to disable safety mechanism";
      }
      if (/skip\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to skip safety mechanism";
      }
      if (/bypass\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to bypass safety mechanism";
      }
      if (/remove\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to remove safety mechanism";
      }
      if (/\bturn\s+off\s+\S/i.test(text)) return "instruction to turn off something";
      if (/\bweaken\s+\S/i.test(text)) return "instruction to weaken something";
      return null;
    },
  },

  // Rule 8 (proprietary-business-rule) DELETED per Bird's domain ruling.
  // Spec §5 residual-risk: "refunds over $500 need dual approval" passes deterministic
  // scrub by construction. BR-13 (human-approval gate) is the documented backstop.
];

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

/**
 * Run all rules on a single prose-safe text string (individual field — full rule set).
 * Also runs C-2.1 decode-and-rescan on the same text.
 */
function scanProseText(text: string): { rule: string; reason: string } | null {
  for (const rule of RULES) {
    const reason = rule.test(text);
    if (reason) return { rule: rule.name, reason };
  }
  // C-2.1: decode-and-rescan on prose text (catches inline encoded tokens)
  const decoded = tryBase64Decode(text) ?? tryHexDecode(text) ?? tryPercentDecode(text);
  if (decoded) {
    return { rule: "decode-and-rescan", reason: `encoded content decodes to printable ASCII: "${decoded.slice(0, 40)}"` };
  }
  return null;
}

/**
 * Run all rules EXCEPT proper-noun on a cross-field joined text string.
 *
 * Why skip proper-noun on cross-field joins?
 *   Rule 4 (proper-noun) uses clauseInitialOffsets() to give DR-2 exemptions.
 *   When we join "trigger + ' ' + behavioral_shape", the first word of behavioral_shape
 *   loses its clause-initial exemption because it is no longer at position 0 in the
 *   joined string.  Individual field scans (scanProseText) already apply Rule 4 with
 *   correct per-field clause-initial detection, so no proper-noun signal is lost by
 *   skipping it on the cross-field joins.
 *
 *   Cross-field identifiers (camelCase, URLs, hex tokens, etc.) are still caught by
 *   all other rules.  DR-6 naming-context detection works within individual fields
 *   (e.g. "Acme client" in a single trigger field) so cross-field DR-6 is not needed.
 */
function scanCrossFieldText(text: string): { rule: string; reason: string } | null {
  for (const rule of RULES) {
    if (rule.name === "proper-noun") continue; // per-field only — see above
    const reason = rule.test(text);
    if (reason) return { rule: rule.name, reason };
  }
  // C-2.1: decode-and-rescan on prose text (catches inline encoded tokens)
  const decoded = tryBase64Decode(text) ?? tryHexDecode(text) ?? tryPercentDecode(text);
  if (decoded) {
    return { rule: "decode-and-rescan", reason: `encoded content decodes to printable ASCII: "${decoded.slice(0, 40)}"` };
  }
  return null;
}

/**
 * Run ONLY the decode-and-rescan step on a token-concatenated string.
 * Used for cross-field encoded-token detection (C-2.3) where prose rules
 * must NOT fire (concatenated token runs are not valid prose).
 */
function scanEncodedTokenText(text: string): { rule: string; reason: string } | null {
  const decoded = tryBase64Decode(text) ?? tryHexDecode(text) ?? tryPercentDecode(text);
  if (decoded) {
    return { rule: "decode-and-rescan", reason: `cross-field encoded token decodes to printable ASCII: "${decoded.slice(0, 40)}"` };
  }
  // Also run the hex/secret-token rule on the raw concatenated run
  const secretHit = RULES.find(r => r.name === "secret-token")?.test(text);
  if (secretHit) return { rule: "secret-token", reason: secretHit };
  return null;
}

// ---------------------------------------------------------------------------
// Cross-field concatenation builder (C-2.3)
// ---------------------------------------------------------------------------

/**
 * Per-field texts — scanned with ALL rules (including proper-noun / DR-2).
 * Each text is a single original field so clauseInitialOffsets() is accurate.
 */
function buildPerFieldTexts(candidate: InstinctCandidate): string[] {
  const { trigger, behavioral_shape, evidence } = candidate;
  const texts: string[] = [trigger, behavioral_shape, ...evidence];
  return [...new Set(texts.filter(t => t.trim().length > 0))];
}

/**
 * Cross-field joined texts — scanned with all rules EXCEPT proper-noun.
 * These joins use a space separator so adjacent prose words cannot falsely merge
 * into camelCase/PascalCase; but because fields are concatenated, the first word
 * of each non-first field loses its clause-initial status, so Rule 4 is excluded
 * (it is already applied per-field in buildPerFieldTexts).
 *
 * These texts are essential for catching identifiers that span field boundaries:
 * a camelCase token whose two halves are in different fields, a URL whose scheme is
 * in trigger and hostname in behavioral_shape, etc.
 */
function buildCrossFieldTexts(candidate: InstinctCandidate): string[] {
  const { trigger, behavioral_shape, evidence } = candidate;
  const allEvidence = evidence.join(" ");
  const texts: string[] = [
    // Full concat of all fields (spaced) — cross-field identifier detection
    [trigger, behavioral_shape, ...evidence].join(" "),
    // Adjacent-pair joins (spaced)
    trigger + " " + behavioral_shape,
    behavioral_shape + " " + (evidence[0] ?? ""),
    // All evidence joined (spaced)
    allEvidence,
  ];
  return [...new Set(texts.filter(t => t.trim().length > 0))];
}

/**
 * Texts specifically for decode-and-rescan (C-2.1 / C-2.3 cross-field token detection).
 * These extract only contiguous alphanumeric/base64 runs and concatenate them to
 * surface tokens that are split across field boundaries (e.g. a hex string whose
 * first half is in trigger and second half in behavioral_shape).
 *
 * IMPORTANT: These are ONLY used for the decode-and-rescan step, NOT run through
 * the prose-aware rules (camelCase, PascalCase, proper-noun), because concatenating
 * prose tokens without spaces produces artificial identifiers.
 *
 * UUID-safe: hyphenated UUIDs (8-4-4-4-12) are stripped before extracting alphanumeric
 * runs. Without this, a UUID like df7b97e6-5be4-45f8-be64-09e34a5fd7ce concatenated with
 * adjacent alphanumeric words (e.g. "originSessionId") creates a false 47-char high-entropy
 * run that trips the secret-token rule. UUIDs are NOT secrets; they are caught separately
 * by the domain-identifier rule (in analyzer mode) and kept in migration mode. (BR Round 2)
 */
function stripHyphenatedUuids(text: string): string {
  return text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ");
}

function buildEncodedTokenTexts(candidate: InstinctCandidate): string[] {
  const { trigger, behavioral_shape, evidence } = candidate;
  const allEvidence = evidence.join(" ");
  // Strip hyphenated UUIDs before extracting alphanumeric runs.
  // This prevents UUID hex segments from being concatenated into a spurious high-entropy run.
  const trigClean   = stripHyphenatedUuids(trigger);
  const shapeClean  = stripHyphenatedUuids(behavioral_shape);
  const evidClean   = stripHyphenatedUuids(allEvidence);
  // Extract ≥4-char alphanumeric tokens (strips spaces — suited for encoded token detection)
  const trigTokens  = (trigClean.match(/[A-Za-z0-9+/=]{4,}/g) ?? []).join("");
  const shapeTokens = (shapeClean.match(/[A-Za-z0-9+/=]{4,}/g) ?? []).join("");
  const evidTokens  = (evidClean.match(/[A-Za-z0-9+/=]{4,}/g) ?? []).join("");
  const texts: string[] = [
    trigTokens + shapeTokens,          // trigger → behavioral_shape split
    shapeTokens + evidTokens,          // behavioral_shape → evidence split
    trigTokens + shapeTokens + evidTokens, // full all-fields token run
  ];
  return [...new Set(texts.filter(t => t.trim().length > 0))];
}

// ---------------------------------------------------------------------------
// MIGRATION_RULES — HARD-identifier-only gate (Bird ruling Round 2)
//
// Used only when scrub() is called with { mode: 'migration' }.
// Drops: genuine secrets, emails, real URLs, username-revealing paths,
//        invisible-unicode/homoglyph, imperative/command shapes.
// Keeps: bare acronyms, camelCase/PascalCase, Title-case, snake_case,
//        section headers, product/roster names, generic org/repo, UUIDs.
//
// NOTE: BR-S3 (Turso/promotion boundary full-strict re-scrub) is deferred.
// Migration-mode output passes through BR-MIG-11 (human worklist review) and
// will be re-scrubbed at the promotion boundary with analyzer mode.
// ---------------------------------------------------------------------------

export const MIGRATION_RULES: Rule[] = [
  // [0] Invisible/zero-width Unicode — identical to analyzer
  {
    name: "invisible-unicode",
    test(text) {
      if (hasInvisibleUnicode(text)) return "invisible or zero-width Unicode codepoint detected";
      if (hasSuspiciousNonAscii(text)) return "non-ASCII letters mixed into Latin token (homoglyph attack)";
      return null;
    },
  },

  // [1] Username-revealing filesystem paths only — NO org/repo, NO ~/ check
  //     (tilde elides username; org/repo kept since they're code-shape, not hard identifiers)
  {
    name: "filesystem-path",
    test(text) {
      const t = nfkcFold(text);
      if (/(?:\/Users\/|\/home\/)([a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63})\//.test(t)) {
        return "filesystem path (username-revealing: /Users/ or /home/ path)";
      }
      if (/[A-Za-z]:\\[A-Za-z0-9_\-\. \\]/.test(t)) return "filesystem path (Windows)";
      return null;
    },
  },

  // [2] Secrets — same strict checks as analyzer Rule 3
  {
    name: "secret-token",
    test(text) {
      const t = nfkcFold(text);
      if (/\bsk-[A-Za-z0-9]{10,}/.test(t)) return "OpenAI/Anthropic secret key prefix (sk-)";
      if (/\bghp_[A-Za-z0-9]{10,}/.test(t)) return "GitHub PAT prefix (ghp_)";
      if (/\bAKIA[A-Z0-9]{16}\b/.test(t)) return "AWS access key prefix (AKIA)";
      if (/(?:key|token|password|passwd|secret|auth)\s*[=:]\s*\S{6,}/i.test(t)) {
        return "key/token/password assignment";
      }
      if (/\beyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\b/.test(t)) {
        return "JWT-shaped token";
      }
      if (/[A-Za-z0-9+/]{32,}={0,2}/.test(t)) {
        const match = t.match(/[A-Za-z0-9+/]{32,}={0,2}/);
        if (match) {
          const tok = match[0];
          // Skip stripped UUIDs (32 pure-hex chars = hyphenated UUID with dashes removed)
          if (!/^[0-9a-fA-F]{32}$/.test(tok)) {
            const hasUpper = /[A-Z]/.test(tok);
            const hasLower = /[a-z]/.test(tok);
            const hasDigit = /[0-9]/.test(tok);
            if (hasUpper && hasLower && hasDigit) return "high-entropy base64-shaped token";
          }
        }
      }
      if (/\b[0-9a-fA-F]{16,}\b/.test(t)) return "high-entropy hex token";
      return null;
    },
  },

  // [3] URLs / endpoints — identical to analyzer Rule 5
  {
    name: "url-endpoint",
    test(text) {
      const t = nfkcFold(text);
      if (/https?:\/\//.test(t)) return "URL (http/https)";
      if (/\bapi\.[a-z0-9\-]+\.[a-z]{2,}/i.test(t)) return "API hostname (api.domain)";
      if (/\b[a-z0-9\-]+\.(?:com|io|net|org|dev|app|cloud)\b/i.test(t)) return "domain-like hostname";
      if (/\/v\d+\/[a-zA-Z0-9_\-\/]{3,}/.test(t)) return "versioned API route (/v1/...)";
      return null;
    },
  },

  // [4] Email addresses ONLY — UUIDs and UPPER_SNAKE kept in migration mode
  //     (UUIDs = session IDs in user's own memories, not secrets; UPPER_SNAKE = env-var
  //     names, not credentials; credentials are caught by secret-token above)
  {
    name: "domain-identifier",
    test(text) {
      const t = nfkcFold(text);
      if (/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/.test(t)) {
        return "email address";
      }
      return null;
    },
  },

  // [5] Imperative / command shapes — identical to analyzer Rule 7
  {
    name: "imperative-command",
    test(text) {
      const t = nfkcFold(text).toLowerCase();
      if (/\bcurl\s/.test(t)) return "shell command: curl";
      if (/\bwget\s/.test(t)) return "shell command: wget";
      if (/\|\s*sh\b/.test(t)) return "shell pipe to sh";
      if (/\|\s*bash\b/.test(t)) return "shell pipe to bash";
      if (/\beval\s*\(/.test(t) || /\beval\s+"/.test(t) || /\beval\s+'/.test(t)) {
        return "eval invocation";
      }
      if (/\brm\s+-rf\b/.test(t)) return "destructive rm -rf";
      if (/\bchmod\s+[0-7o+\-]{1,6}\s/.test(t)) return "chmod invocation";
      if (/\bsudo\s+/.test(t)) return "sudo invocation";
      if (/\bnpm\s+install\b/.test(t)) return "npm install command";
      if (/\bpip\s+install\b/.test(t)) return "pip install command";
      if (/\bapt(?:-get)?\s+install\b/.test(t)) return "apt install command";
      if (/\bbrew\s+install\b/.test(t)) return "brew install command";
      if (/\byarn\s+add\b/.test(t)) return "yarn add command";
      if (/\bbun\s+(?:add|install)\b/.test(t)) return "bun install/add command";
      if (/>\s*\/[a-zA-Z0-9_\-\.\/]{3,}/.test(t)) return "output redirection to path";
      if (/>\s*~\/[a-zA-Z0-9_\-\.\/]{2,}/.test(t)) return "output redirection to home path";
      if (/disable\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to disable safety mechanism";
      }
      if (/skip\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to skip safety mechanism";
      }
      if (/bypass\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to bypass safety mechanism";
      }
      if (/remove\s+(?:\S+\s+){0,4}(?:hook|check|guard|gate|filter|test|auth|authentication|validation)/i.test(text)) {
        return "instruction to remove safety mechanism";
      }
      if (/\bturn\s+off\s+\S/i.test(text)) return "instruction to turn off something";
      if (/\bweaken\s+\S/i.test(text)) return "instruction to weaken something";
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Primary export: scrub()
// ---------------------------------------------------------------------------

export function scrub(candidate: InstinctCandidate, opts?: ScrubOpts): ScrubResult {
  const mode = opts?.mode ?? 'analyzer';

  if (mode === 'migration') {
    // Migration mode: run MIGRATION_RULES only (HARD-identifier-only gate).
    // No code-shape rules, no proper-noun, no UUID/UPPER_SNAKE detection.
    // Per-field scan (no cross-field prose joins — shape false-positives not relevant).
    for (const text of buildPerFieldTexts(candidate)) {
      for (const rule of MIGRATION_RULES) {
        const reason = rule.test(text);
        if (reason) return { ok: false, reason, matchedRule: rule.name };
      }
      // C-2.1: decode-and-rescan still applies in migration mode (obfuscated secrets)
      const decoded = tryBase64Decode(text) ?? tryHexDecode(text) ?? tryPercentDecode(text);
      if (decoded) {
        return {
          ok: false,
          reason: `encoded content decodes to printable ASCII: "${decoded.slice(0, 40)}"`,
          matchedRule: "decode-and-rescan",
        };
      }
    }
    // Cross-field encoded-token scan (catches secrets split across trigger/behavioral_shape)
    for (const text of buildEncodedTokenTexts(candidate)) {
      const hit = scanEncodedTokenText(text);
      if (hit) return { ok: false, reason: hit.reason, matchedRule: hit.rule };
    }
    return { ok: true };
  }

  // Analyzer mode (default): full scrub pipeline.
  // Step 1a: Run ALL rules (including proper-noun / Rule 4) over individual fields.
  // Each field is scanned independently so clauseInitialOffsets() is accurate per field.
  for (const text of buildPerFieldTexts(candidate)) {
    const hit = scanProseText(text);
    if (hit) {
      return { ok: false, reason: hit.reason, matchedRule: hit.rule };
    }
  }

  // Step 1b: Run all rules EXCEPT proper-noun over cross-field joined texts.
  // Rule 4 is skipped here to avoid false drops caused by field-start words losing
  // their clause-initial status in the joined string (DR-2 per-field bug).
  // All other rules — code-literal, secret-token, url-endpoint, etc. — run normally
  // to catch identifiers that span field boundaries.
  for (const text of buildCrossFieldTexts(candidate)) {
    const hit = scanCrossFieldText(text);
    if (hit) {
      return { ok: false, reason: hit.reason, matchedRule: hit.rule };
    }
  }

  // Step 2: Run decode-and-rescan only over token-concatenated texts (C-2.1/C-2.3)
  // This catches encoded tokens split across field boundaries without producing
  // false camelCase/PascalCase from adjacent prose words.
  for (const text of buildEncodedTokenTexts(candidate)) {
    const hit = scanEncodedTokenText(text);
    if (hit) {
      return { ok: false, reason: hit.reason, matchedRule: hit.rule };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// maskEvidence — deterministic REDACT/mask for stored evidence_scrubbed (BR-SG-4)
//
// Unlike scrub() which DROPs the entire candidate, maskEvidence replaces hard-
// identifier spans with "[redacted]" and returns the sanitised string.
//
// This is a SEPARATE function used only for evidence storage. scrub() itself
// MUST remain DROP-not-redact for the projected fields (trigger/behavioral_shape).
// ---------------------------------------------------------------------------

/**
 * Deterministic mask for the evidence_scrubbed field stored at rest (BR-SG-4).
 *
 * Contract:
 *   - Deterministic: same input → same output (safe for identity_key/dedup/tests).
 *   - NFKC + confusable-fold first; invisible unicode stripped before masking.
 *   - Replaces matched identifier spans with "[redacted]"; does NOT drop.
 *   - AC-SG-8: if the whole string becomes empty/whitespace/all-[redacted] after
 *     masking → returns "[evidence masked]" without throwing.
 *   - scrub() is UNCHANGED — DROP-not-redact for projected trigger/behavioral_shape.
 *
 * Hard identifiers masked (mirrors MIGRATION_RULES hard-identifier categories):
 *   - Secrets: sk-/ghp_/AKIA prefixes, credential assignments, JWTs, high-entropy tokens
 *   - Emails
 *   - Username-revealing filesystem paths (/Users/<name>/ or /home/<name>/)
 *   - Windows paths
 *   - URLs (https?://, api. hostnames, common-TLD domains, versioned routes)
 *   - Org/repo with Title-case proper-name segment (real client/org names)
 *
 * NOT masked per Bird ruling (soft code-shape, local-only evidence):
 *   - PascalCase/camelCase code-shape tokens (e.g. OrderApi — evidence is local-only)
 *   - snake_case identifiers
 *   - UUIDs (not secrets; caught by domain-identifier in the projection gate)
 *   - Imperative commands (not identifiers)
 *
 * Known limitation (shared with scrub()'s DROP gate): unprefixed low-entropy secrets
 * shorter than the base64/hex thresholds (e.g. short PINs, dictionary passwords without
 * a known prefix) are not caught. Acceptable because evidence_scrubbed is local-only and
 * never projected to the memory surface. TODO: revisit if evidence is ever surfaced.
 */
export function maskEvidence(raw: string): string {
  // Step 1: Strip invisible/zero-width unicode codepoints.
  let text = stripInvisibleUnicodeChars(raw);

  // Step 2: NFKC + confusable-fold (normalise homoglyphs to ASCII equivalents).
  text = nfkcFold(text);

  // Step 3: Mask hard identifiers — most-specific patterns first.

  // --- Secrets ---
  // JWT three-segment shape (eyJ...) — before the base64 catch-all below.
  text = text.replace(/\beyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\b/g, "[redacted]");
  // Known-prefix secrets
  text = text.replace(/\bsk-[A-Za-z0-9]{10,}/g, "[redacted]");
  text = text.replace(/\bghp_[A-Za-z0-9]{10,}/g, "[redacted]");
  text = text.replace(/\bAKIA[A-Z0-9]{16}\b/g, "[redacted]");
  // Credential assignments: key/token/password/etc = <value≥6chars>
  text = text.replace(/(?:key|token|password|passwd|secret|auth)\s*[=:]\s*\S{6,}/gi, "[redacted]");
  // High-entropy base64 (≥32 chars, mixed case + digits, NOT a pure-hex stripped UUID)
  text = text.replace(/[A-Za-z0-9+/]{32,}={0,2}/g, (match) => {
    if (/^[0-9a-fA-F]{32}$/.test(match)) return match; // stripped UUID hex — keep
    const hasUpper = /[A-Z]/.test(match);
    const hasLower = /[a-z]/.test(match);
    const hasDigit = /[0-9]/.test(match);
    return (hasUpper && hasLower && hasDigit) ? "[redacted]" : match;
  });
  // High-entropy hex tokens (≥16 consecutive hex chars at a word boundary)
  text = text.replace(/\b[0-9a-fA-F]{16,}\b/g, "[redacted]");

  // --- Emails ---
  text = text.replace(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, "[redacted]");

  // --- Filesystem paths ---
  // Username-revealing Unix paths — mask only the username segment.
  text = text.replace(/\/Users\/[a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63}\//g, "/Users/[redacted]/");
  text = text.replace(/\/home\/[a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63}\//g, "/home/[redacted]/");
  // Windows paths (e.g. C:\Users\...)
  text = text.replace(/[A-Za-z]:\\[A-Za-z0-9_\-\. \\]+/g, "[redacted]");

  // --- URLs ---
  text = text.replace(/https?:\/\/\S+/g, "[redacted]");
  text = text.replace(/\bapi\.[a-z0-9\-]+\.[a-z]{2,}/gi, "[redacted]");
  text = text.replace(/\b[a-z0-9\-]+\.(?:com|io|net|org|dev|app|cloud)\b/gi, "[redacted]");
  text = text.replace(/\/v\d+\/[a-zA-Z0-9_\-\/]{3,}/g, "[redacted]");

  // --- Org/repo with proper-name segment (real client/org names) ---
  // Mirrors the org/repo detection in analyzer-mode filesystem-path Rule 1:
  // DROP only when a segment is Title-case (Capital + lowercase tail) AND not generic/tech.
  // Applied here as a mask: replace the org/repo pair with [redacted].
  // Trailing delimiter is a zero-width lookahead so the delimiter character is not
  // consumed; this prevents the adjacent-pair residue bug where two org/repo pairs
  // separated by a single space would share the space: the first match consumed it as
  // suffix, leaving the second pair without a leading delimiter and unmatched.
  text = text.replace(
    /(^|[\s"'`])([a-zA-Z][a-zA-Z0-9_\-]{1,39})\/([a-zA-Z][a-zA-Z0-9_\-]{1,39})(?=[\s"'`]|$)/g,
    (fullMatch, prefix, org, repo) => {
      const isTitleCase = (s: string) => /^[A-Z][a-z]/.test(s);
      const orgProper = isTitleCase(org) && !isGenericOrTechSegment(org);
      const repoProper = isTitleCase(repo) && !isGenericOrTechSegment(repo);
      if (orgProper || repoProper) {
        return `${prefix}[redacted]`;
      }
      return fullMatch;
    }
  );

  // Step 4: AC-SG-8 — if everything is [redacted]/whitespace/empty → safe placeholder.
  const remnant = text.replace(/\[redacted\]/g, "").trim();
  if (remnant.length === 0) return "[evidence masked]";

  return text.trim();
}

// ---------------------------------------------------------------------------
// CLI entry point (mirrors check-unicode-safety.ts)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const arg = process.argv[2];
  let raw: string;
  if (arg && arg !== "-") {
    raw = await Bun.file(arg).text();
  } else {
    // Read from stdin
    const chunks: Uint8Array[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(chunk as Uint8Array);
    }
    raw = Buffer.concat(chunks).toString("utf-8");
  }

  let candidate: InstinctCandidate;
  try {
    candidate = JSON.parse(raw.trim());
  } catch (e) {
    console.error("instinct-scrub: failed to parse JSON candidate:", e);
    process.exit(2);
  }

  const result = scrub(candidate);
  if (result.ok) {
    console.log(JSON.stringify({ ok: true }));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ ok: false, reason: result.reason, matchedRule: result.matchedRule }));
    process.exit(1);
  }
}
