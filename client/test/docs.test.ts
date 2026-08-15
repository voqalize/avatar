/**
 * The docs, checked against the code.
 *
 * Documentation rots because nothing forces it to move. `docs/internal-mixer.md`
 * advertised a `TYPING` state for weeks after `src/avatar.js` renamed it
 * `WORKING`, and listed `WAVE`/`THUMBS_UP` clips that had become
 * `GESTURE_GREET`/`GESTURE_APPROVE`. Both were one grep from provable. This is
 * that grep, run by `npm test`.
 *
 * The rule: every `SCREAMING_CASE` identifier a doc puts in backticks must be
 * defined somewhere in the code. Backticks are the assertion — prose that says
 * "the state we used to call TYPING" is not a claim about the current code, and
 * is not checked.
 *
 * Two kinds of file are exempt, because naming things that are not in the code
 * is their whole job:
 *   - `docs/removed.md`, the graveyard.
 *   - `docs/research-*.md`, which cite outside literature and propose channels
 *     and clips that do not exist yet.
 *
 * Anything else that needs an exception goes in RETIRED below, one line each,
 * with the reason. That list is meant to stay short; if it is growing, the doc
 * is drifting.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Names a doc mentions on purpose that the code deliberately does not have.
 * Each is a decision the doc exists to record, not a stale reference.
 */
const RETIRED = new Set([
  // The renamed state, told as a cautionary tale in five places: a behaviour
  // named after one rendering of it. Removing the name would remove the lesson.
  "TYPING",
  // design-library-split.md § the env-var override that was removed: the four
  // variables are named so the decision can be read without git archaeology.
  "AVATARSYNC_HOME",
  "AVATARSYNC_BIN",
  "AVATARSYNC_RES",
  "AVATARSYNC_PROCS",
  // Same page, the Dockerfile directive — someone else's vocabulary, not ours.
  "COPY",
]);

/** Where the code lives. Anything defined in here counts as existing. */
const CODE_DIRS = ["src", "client/src", "py/src", "tools", "studio/src", "native", "demo"];
const CODE_EXT = /\.(js|mjs|ts|tsx|py|c|h|json|html)$/;

/** Prose that makes claims about this code. */
const DOC_FILES = [
  "README.md",
  "CLAUDE.md",
  "RELEASING.md",
  "studio/README.md",
  "py/README.md",
  "tools/README.md",
];
const DOC_DIR = "docs";
const DOC_EXEMPT = /^(removed|research-.*)\.md$/;

const IDENTIFIER = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const BACKTICKED = /`([A-Z][A-Z0-9_]{2,})`/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // an optional tree (native/, demo/) may be absent in a checkout
  }
  for (const name of entries) {
    // `vendor/` holds bundled third-party code: a hundred thousand identifiers
    // that would make the corpus match almost any word, which is how a check
    // like this passes while proving nothing.
    if (name === "node_modules" || name === "dist" || name === "vendor") continue;
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (CODE_EXT.test(name)) out.push(path);
  }
  return out;
}

/**
 * Comments are prose, and prose is what we are checking. A comment mentioning
 * `TYPING` is exactly as capable of being stale as a doc mentioning it, so the
 * corpus is the code with its commentary removed.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/^\s*#.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function codeIdentifiers(): Set<string> {
  const found = new Set<string>();
  for (const dir of CODE_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const [id] of code.matchAll(IDENTIFIER)) found.add(id);
    }
  }
  return found;
}

function docFiles(): string[] {
  const docs = readdirSync(join(ROOT, DOC_DIR))
    .filter((n) => n.endsWith(".md") && !DOC_EXEMPT.test(n))
    .map((n) => join(ROOT, DOC_DIR, n));
  return [...docs, ...DOC_FILES.map((f) => join(ROOT, f))];
}

describe("the docs", () => {
  it("names no identifier the code does not have", () => {
    const code = codeIdentifiers();
    const stale: string[] = [];

    for (const file of docFiles()) {
      const text = readFileSync(file, "utf8");
      const seen = new Set<string>();
      // `LICENSE` and friends are filenames, not identifiers.
      const isFile = (id: string) =>
        existsSync(join(ROOT, id)) || existsSync(join(dirname(file), id));
      for (const [, id] of text.matchAll(BACKTICKED)) {
        if (code.has(id) || RETIRED.has(id) || seen.has(id) || isFile(id)) continue;
        seen.add(id);
        // Line number, so the failure is one click from the offending prose.
        const line = text.slice(0, text.indexOf("`" + id + "`")).split("\n").length;
        stale.push(`${relative(ROOT, file)}:${line}  \`${id}\``);
      }
    }

    expect(stale, "documented but not in the code").toEqual([]);
  });

  it("has a code corpus to check against", () => {
    // A broken walk() would make the check above pass by finding nothing.
    const code = codeIdentifiers();
    expect(code.size).toBeGreaterThan(200);
    expect(code.has("STATE_NAMES")).toBe(true);
    expect(code.has("GESTURE_GREET")).toBe(true);
  });
});
