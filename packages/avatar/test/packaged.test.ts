/**
 * The published manifest against the tree it describes.
 *
 * Nothing else here reads `package.json`. The suite imports this package by
 * relative path — `../src/avatar.js`, `../client/types.js` — which is the right
 * thing for testing behaviour and is blind to the one file a consumer actually
 * goes through. Every failure this file can catch is invisible until a real
 * install: a subpath missing from `exports`, an export naming a file the build
 * does not emit, an asset the renderer fetches at runtime that `files` leaves out
 * of the tarball.
 *
 * It was written when the 2.5-D characters moved in here from a package of their
 * own. They are the first thing this package ships that is not JavaScript, and
 * `files` had never had to be right about anything but source.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
  files: string[];
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

/**
 * The 2.5-D characters, read off the built assets rather than listed here — a
 * list written down in a test is a list that goes quietly stale, and the point
 * of these checks is to catch a character the manifest forgot, which a hand-kept
 * roll call cannot do for the one just added.
 */
const CHARACTERS = readdirSync(join(ROOT, "assets"))
  .filter((f) => f.endsWith(".glb"))
  .map((f) => f.replace(/\.glb$/, ""))
  .sort();

/** Every `(subpath, target)` pair in the export map, conditions flattened. */
const targets = Object.entries(manifest.exports).flatMap(([sub, t]) =>
  (typeof t === "string" ? [t] : Object.values(t)).map((rel) => ({ sub, rel })));

describe("the export map", () => {
  it.each(targets)("$sub → $rel exists", ({ rel }) => {
    expect(existsSync(join(ROOT, rel))).toBe(true);
  });

  // The 2.5-D characters and the Canvas2D identities are one shape on
  // purpose: a consumer reads `./avatars/<name>` and does not learn which
  // renderer is behind it until they read the install line. A missing row here
  // is the single way a shipped character becomes unreachable.
  it.each(CHARACTERS)("publishes ./avatars/%s", (name) => {
    expect(Object.keys(manifest.exports)).toContain(`./avatars/${name}`);
  });

  it("publishes the rig door the lab pages drive", () => {
    expect(Object.keys(manifest.exports)).toContain("./internal/three");
  });
});

describe("what the tarball carries", () => {
  it.each(manifest.files)("%s is a real path", (entry) => {
    expect(existsSync(join(ROOT, entry))).toBe(true);
  });

  // These are fetched at runtime by URL, not imported, so no bundler and no
  // compiler can report them missing. A `files` list that forgets them installs
  // a character whose GLB 404s in the consumer's app and nowhere else.
  it.each(CHARACTERS)("carries %s's compiled asset", (name) => {
    const asset = `assets/${name}.glb`;
    expect(existsSync(join(ROOT, asset))).toBe(true);
    expect(manifest.files.some((f) => asset === f || asset.startsWith(`${f}/`))).toBe(true);
  });

  // `assets/` is the airlock: the one directory the private forge that builds
  // the characters writes into a published one. Whatever is in it
  // ships, so the list is closed rather than checked — until 0.4.0 two of
  // tara's reference photographs were sitting in here, which is the exact
  // failure this holds shut. A new character adds a row; anything else in the
  // directory is a build writing somewhere it should not.
  // npm adds `LICENSE` to a tarball whether or not `files` mentions it, and it
  // does that for that spelling only: the first 0.4.0 pack left CC-BY 4.0 behind
  // while shipping the artwork it covers, and `assets/README.md` pointed the
  // consumer at a file that was not there.
  it("carries both licence texts", () => {
    for (const text of ["LICENSE", "LICENSE-CC-BY-4.0"]) {
      expect(existsSync(join(ROOT, text)), text).toBe(true);
      expect(text === "LICENSE" || manifest.files.includes(text), `${text} in files`).toBe(true);
    }
  });

  it("holds the characters and its own licence note, and nothing else", () => {
    expect(readdirSync(join(ROOT, "assets")).sort())
      .toEqual(["README.md", "tanya.glb", "tara.glb", "tess.glb", "tushar.glb"]);
  });
});

describe("the three-dimensional engine", () => {
  // Optional, because the six drawings and the six Canvas2D identities are the
  // reason most consumers are here and none of them should download a 3-D
  // engine. Declared, because the 2.5-D characters cannot run without one and a
  // silent `undefined` at import time is a worse failure than a resolution
  // error.
  it("is an optional peer", () => {
    expect(manifest.peerDependencies.three).toBeTruthy();
    expect(manifest.peerDependenciesMeta.three?.optional).toBe(true);
  });

  // three publishes breaking changes as minors, so the range is a measurement
  // and not a guess: its floor is the version this workspace installs and tests
  // against, and widening it means running the suite at the new floor first.
  // A floor the suite has never seen is a promise nobody checked.
  it("declares a floor this workspace actually tests", () => {
    const installed = JSON.parse(
      readFileSync(join(ROOT, "node_modules/three/package.json"), "utf8")) as { version: string };
    const floor = /^>=\s*([\d.]+)/.exec(manifest.peerDependencies.three)?.[1];
    expect(floor, manifest.peerDependencies.three).toBeTruthy();
    expect(installed.version.startsWith(floor!)).toBe(true);
  });
});

/**
 * A consumer who imports one character downloads one character.
 *
 * This is a bundling fact and nothing else in the suite can see it: the URLs are
 * `new URL(…, import.meta.url)` literals, so Vite, webpack and Rollup emit the
 * file each one names — and they decide that per *module*. While all three URLs
 * sat in one frozen object, every build of every consumer carried all three GLBs
 * (~1.3 MB unasked for; measured in two real apps at 0.4.0). The fix was one
 * module per character, which only holds if nothing a character module reaches
 * mentions another character — including the rig, which used to default its
 * `url` to tara's.
 *
 * So this walks the real relative import graph from each character's entry point
 * and counts asset literals. It fails the day someone reintroduces a convenience
 * that pulls the table back in.
 */
describe("one character costs one character", () => {
  /** The transitive relative-import closure of a module, as paths under ROOT. */
  const closure = (entry: string): string[] => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length) {
      const rel = queue.shift()!;
      if (seen.has(rel)) continue;
      // `.js` in a specifier is the runtime spelling; the file on disk beside a
      // compiled entry point is `.ts`. Either can be the real one here.
      const onDisk = [rel, rel.replace(/\.js$/, ".ts")].find((p) => existsSync(join(ROOT, p)));
      if (!onDisk) continue;
      seen.add(onDisk);
      const src = readFileSync(join(ROOT, onDisk), "utf8");
      for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
        queue.push(join(onDisk, "..", m[1]));
      }
    }
    return [...seen];
  };

  it.each(CHARACTERS)("%s's module graph names only her own GLB", (name) => {
    // Only a real `new URL("…/assets/<name>.glb", …)` literal counts — that is
    // the one shape a bundler follows. Prose naming a file does not emit it, and
    // two comments in the rig discuss `tara.glb` for reasons of their own.
    const naming = closure(`client/three/${name}.ts`)
      .flatMap((f) => [...readFileSync(join(ROOT, f), "utf8").matchAll(/assets\/(\w+)\.glb/g)]
        .map((m) => ({ file: f, glb: m[1] })));
    expect(naming.length, `asset literals reached from ${name}.ts`).toBeGreaterThan(0);
    for (const { file, glb } of naming) expect(glb, `${file} names ${glb}.glb`).toBe(name);
  });

  // The table itself is not a defect — it is what a rig instrument switching
  // between characters wants. It may only be reachable from `/internal/three`,
  // which is a separate entry point that ships no call page.
  it("keeps the every-character table out of the character modules", () => {
    for (const name of CHARACTERS) {
      expect(closure(`client/three/${name}.ts`), name).not.toContain("client/three/assets.ts");
    }
    expect(closure("client/three/internal.ts")).toContain("client/three/assets.ts");
  });
});
