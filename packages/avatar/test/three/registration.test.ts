/**
 * A compiled character is registered in several files that do not import each
 * other, and the asset directory is the only one of them a build writes. So
 * the directory is what this test reads, and everything else is checked
 * against it.
 *
 * The failure it exists for is quiet in every direction. A character missing
 * from `ASSETS` still mounts from its own module and is simply absent from the
 * instruments. A character missing its `package.json` subpath is unreachable
 * to a consumer and fully reachable from inside this repo, which is where it
 * is always tried. A character missing from `motion-limits.json` is held to
 * the tightest budget any other is vouched for (`holds.ts`) — deliberately,
 * and indistinguishable from having been measured. Each of those is a thing
 * you find by wondering, which is not a way of finding things.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSETS } from "../../client/three/assets.js";
import LIMITS from "../../client/three/motion-limits.json" with { type: "json" };

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => readFileSync(at(path), "utf8");

/** Every character the forge has actually built, which is the whole point. */
const BUILT = readdirSync(at("../../assets"))
  .filter((file) => file.endsWith(".glb"))
  .map((file) => file.replace(/\.glb$/, ""))
  .sort();

const manifest = JSON.parse(read("../../package.json")) as {
  exports: Record<string, unknown>;
};

describe("every compiled character", () => {
  it("is built at all — the directory is not empty", () => {
    expect(BUILT.length).toBeGreaterThan(0);
  });

  it("is in the table the instruments enumerate", () => {
    expect(Object.keys(ASSETS).sort()).toEqual(BUILT);
  });

  it("has a subpath a consumer can import", () => {
    expect(BUILT.filter((name) => `./avatars/${name}` in manifest.exports)).toEqual(BUILT);
  });

  it("has its own module, and imports its own GLB and no other", () => {
    for (const name of BUILT) {
      const module = read(`../../client/three/${name}.ts`);
      expect(module, `${name}.ts calls createAvatar`).toContain("export const createAvatar");
      expect(module, `${name}.ts imports ${name}-asset`).toContain(`./${name}-asset.js`);
      const others = BUILT.filter((other) => other !== name);
      for (const other of others) {
        expect(module.includes(`./${other}-asset.js`),
          `${name}.ts must not import ${other}'s GLB — a bundler emits per module`).toBe(false);
      }
    }
  });

  // Having a row and having an angle are different things, and the file says
  // which: a character nobody has driven yet is listed with none, on purpose.
  // What may not happen is a character the file has never heard of, because
  // that reads the same as one whose angles were measured and found unlimited.
  it("has a row in the limits file, said or unsaid", () => {
    expect(Object.keys(LIMITS.characters).sort()).toEqual(BUILT);
  });
});
