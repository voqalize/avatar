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

/**
 * Manifests make path claims too, and theirs are worse: `pyproject.toml`'s
 * `[project.urls]` becomes a link on the PyPI page, so a rename here is a 404
 * for every person who installs the package.
 */
const MANIFEST_FILES = ["py/pyproject.toml", "package.json", "ecosystem.config.cjs"];

function manifestFiles(): string[] {
  return MANIFEST_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f));
}

/**
 * Top-level directories of this repo. A reference is checked only if it starts
 * with one of these, which is what keeps the check about our own tree.
 * Deliberately a literal list rather than a readdir: a `pipecat/` or `build/`
 * directory appearing in someone's working copy must not silently start
 * validating references to somebody else's source.
 */
/**
 * Paths that are produced rather than committed, so "it is not there" is the
 * normal state rather than a stale reference. Same rule as RETIRED: one line
 * each, with what makes it. Keep it short — a growing list means the docs are
 * describing a tree nobody has.
 */
const GENERATED = new Set([
  // Staged by py/scripts/stage_native.py immediately before a wheel build, and
  // named in pyproject.toml precisely BECAUSE it is gitignored — hatchling has
  // to be told the exclusion is deliberate.
  "py/src/voqalize_avatar/_native",
]);

const OUR_DIRS = [
  "src", "client", "docs", "py", "tools", "studio", "server", "authoring",
  "native", "experiments", "demo", ".github",
];

/** Repo-relative paths a file claims exist: markdown link targets and backticks. */
function referencedPaths(text: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    // Strip a section anchor, a trailing sentence comma, a glob tail: the claim
    // is about the file, not the fragment.
    const path = raw.split("#")[0].replace(/[.,)]+$/, "").replace(/\/?\*\*?$/, "").replace(/\/$/, "");
    if (!path || !path.includes("/")) return;
    if (!OUR_DIRS.includes(path.split("/")[0])) return;
    if (path.includes("*")) return; // a glob is a pattern, not a claim
    out.push(path);
  };
  for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) push(target);
  for (const [, quoted] of text.matchAll(/`([A-Za-z0-9_.\-/]+\/[A-Za-z0-9_.\-/*]+)`/g)) push(quoted);
  for (const [, quoted] of text.matchAll(/"((?:[A-Za-z0-9_.\-]+\/)+[A-Za-z0-9_.\-*]+)"/g)) push(quoted);
  return out;
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

  /**
   * The other half of the same rot, and the half the identifier check cannot
   * see: a path is not SCREAMING_CASE, so every one of these sat green for
   * months. `py/pyproject.toml` shipped `docs/contract-protocol.md` as PyPI
   * project metadata — a live 404 on the package page — for two releases after
   * the file was renamed `contract-wire.md`. `RELEASING.md` advertised a
   * `./pipecat` subpath removed in 0.2. `src/hand.js` cited an
   * `experiments/arm-gesture/` directory that does not exist.
   *
   * Anchored on the top-level directory so it checks OUR paths and stays quiet
   * about everyone else's: `pipecat/services/tts_service.py` in a sentence
   * about pipecat's source tree is not a claim about this repo.
   */
  it("names no path this repo does not have", () => {
    const stale: string[] = [];

    for (const file of [...docFiles(), ...manifestFiles()]) {
      const text = readFileSync(file, "utf8");
      const seen = new Set<string>();
      for (const path of referencedPaths(text)) {
        if (seen.has(path)) continue;
        seen.add(path);
        // Root-relative is how the docs write them; a manifest writes them
        // relative to itself (`py/pyproject.toml` says `src/voqalize_avatar`
        // and means `py/src/…`). Resolve both ways and report the repo-relative
        // form, so the failure names a path you can `ls`.
        const candidates = [path, relative(ROOT, join(dirname(file), path))];
        if (candidates.some((c) => existsSync(join(ROOT, c)) || GENERATED.has(c))) continue;
        const line = text.slice(0, text.indexOf(path)).split("\n").length;
        stale.push(`${relative(ROOT, file)}:${line}  ${path}`);
      }
    }

    expect(stale, "referenced but not in the repo").toEqual([]);
  });

  it("has paths to check against", () => {
    // Same guard as above: a referencedPaths() that matches nothing would make
    // the check pass by looking at no paths at all.
    const found = docFiles().flatMap((f) => [...referencedPaths(readFileSync(f, "utf8"))]);
    expect(found.length).toBeGreaterThan(30);
    expect(found).toContain("src/avatar.js");
  });
});
