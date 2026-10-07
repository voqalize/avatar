/**
 * The npm shim, against a stand-in runtime loaded the way the real one is — a
 * dynamic `import()` of a URL — so what is tested is the loader's lifecycle
 * and not a mock of it. The stand-in is a `data:` module that records what it
 * was asked to mount on `globalThis`.
 *
 * This file is published with the shim, so it reaches nothing outside it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const pin = vi.hoisted(() => ({ url: "", protocol: 0 }));
vi.mock("../shim/pin.js", () => ({
  get RUNTIME_URL() { return pin.url; },
  get PROTOCOL() { return pin.protocol; },
}));

interface Log { mounted: unknown[]; destroyed: number }
const log = () => (globalThis as unknown as { __shim: Log }).__shim;

let generation = 0;
/** A fresh module URL each time, so no test inherits another's import. */
function standIn() {
  (globalThis as unknown as { __shim: Log }).__shim = { mounted: [], destroyed: 0 };
  return `data:text/javascript,/*${generation++}*/export function mount(r){globalThis.__shim.mounted.push(r);` +
    `return {destroy(){globalThis.__shim.destroyed++}}}` +
    `export function characters(){return [{name:"tara"}]}`;
}

const mount = {} as HTMLElement;
const client = {} as never;
const flush = () => new Promise((r) => setTimeout(r, 20));

async function fresh() {
  vi.resetModules();
  return import("../shim/index.js");
}

afterEach(() => vi.restoreAllMocks());

describe("the shim", () => {
  it("forwards the request, with its protocol, once the runtime arrives", async () => {
    pin.url = standIn();
    pin.protocol = 7;
    const { createAvatar } = await fresh();
    const avatar = createAvatar({ mount, client, character: "tara", mouthGain: 1.5 });
    expect(log().mounted).toEqual([]);
    await flush();
    expect(log().mounted).toEqual([{ mount, client, character: "tara", mouthGain: 1.5, protocol: 7 }]);
    avatar.destroy();
    expect(log().destroyed).toBe(1);
  });

  it("never mounts an avatar destroyed before the runtime arrived", async () => {
    pin.url = standIn();
    const { createAvatar } = await fresh();
    createAvatar({ mount, client, character: "tara" }).destroy();
    await flush();
    expect(log().mounted).toEqual([]);
  });

  it("reports a runtime that will not load, and tries again on the next mount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    pin.url = "data:text/javascript,throw new Error('no')";
    const { createAvatar } = await fresh();
    createAvatar({ mount, client, character: "tara" });
    await flush();
    expect(error).toHaveBeenCalledOnce();

    pin.url = standIn();
    createAvatar({ mount, client, character: "tara" });
    await flush();
    expect(log().mounted).toHaveLength(1);
  });

  it("refuses a missing mount, client or character synchronously", async () => {
    const { createAvatar } = await fresh();
    expect(() => createAvatar({ client, character: "tara" } as never)).toThrow(/mount/);
    expect(() => createAvatar({ mount, character: "tara" } as never)).toThrow(/client/);
    expect(() => createAvatar({ mount, client } as never)).toThrow(/character/);
  });

  it("lists the runtime's characters, and says so when an old runtime cannot", async () => {
    pin.url = standIn();
    const { listCharacters } = await fresh();
    expect(await listCharacters()).toEqual([{ name: "tara" }]);

    pin.url = `data:text/javascript,/*${generation++}*/export function mount(){}`;
    const { listCharacters: old } = await fresh();
    await expect(old()).rejects.toThrow(/does not list its characters/);
  });
});

describe("preloading", () => {
  /** A stand-in that can preload, and records each call in order. */
  function preloading() {
    (globalThis as unknown as { __pre: string[] }).__pre = [];
    // Encoded: a bare `?` in a data: URL starts its query, and Node 20 cuts the module there.
    return "data:text/javascript," + encodeURIComponent(`/*${generation++}*/const c=globalThis.__pre;` +
      `export function mount(r){c.push("mount:"+r.character);return {destroy(){}}}` +
      `export function preload(n){c.push("preload:"+n);return n==="nobody"?Promise.reject(new TypeError("no "+n)):Promise.resolve()}` +
      `export function unload(n){c.push("unload:"+n)}`);
  }
  const calls = () => (globalThis as unknown as { __pre: string[] }).__pre;

  it("builds once, hands the face to the mount, and then holds nothing", async () => {
    pin.url = preloading();
    const { createAvatar, preloadAvatar, unloadAvatar } = await fresh();
    const face = preloadAvatar("tara");
    expect(preloadAvatar("tara")).toBe(face);
    expect(face.character).toBe("tara");
    await face.ready;
    createAvatar({ mount, client, character: "tara" });
    await flush();
    unloadAvatar(face);
    await flush();
    expect(calls()).toEqual(["preload:tara", "mount:tara"]);
    expect(preloadAvatar("tara")).not.toBe(face);
  });

  it("holds one face: another character frees the first", async () => {
    pin.url = preloading();
    const { preloadAvatar, unloadAvatar } = await fresh();
    const tara = preloadAvatar("tara");
    await tara.ready;
    const tess = preloadAvatar("tess");
    await tess.ready;
    unloadAvatar(tara);
    await flush();
    expect(calls()).toEqual(["preload:tara", "unload:tara", "preload:tess"]);
  });

  it("frees the face it holds, and builds nothing for one unloaded before the runtime arrived", async () => {
    pin.url = preloading();
    const { preloadAvatar, unloadAvatar } = await fresh();
    const early = preloadAvatar("tara");
    unloadAvatar(early);
    await early.ready;
    const late = preloadAvatar("tara");
    await late.ready;
    unloadAvatar(late);
    unloadAvatar(late);
    await flush();
    expect(calls()).toEqual(["unload:tara", "preload:tara", "unload:tara"]);
  });

  it("builds nothing for a character a mount asked for first", async () => {
    pin.url = preloading();
    const { createAvatar, preloadAvatar } = await fresh();
    createAvatar({ mount, client, character: "tara" });
    await preloadAvatar("tara").ready;
    expect(calls()).toEqual(["mount:tara"]);
  });

  it("rejects for no character, and lets the next preload try again", async () => {
    pin.url = preloading();
    const { preloadAvatar } = await fresh();
    const face = preloadAvatar("nobody");
    await expect(face.ready).rejects.toThrow(TypeError);
    const again = preloadAvatar("nobody");
    expect(again).not.toBe(face);
    await expect(again.ready).rejects.toThrow(TypeError);
    expect(() => preloadAvatar("")).toThrow(/character/);
  });

  it("resolves against a runtime older than preloading, and one that will not load", async () => {
    pin.url = standIn();
    const { preloadAvatar, createAvatar } = await fresh();
    await expect(preloadAvatar("tara").ready).resolves.toBeUndefined();
    createAvatar({ mount, client, character: "tara" });
    await flush();
    expect(log().mounted).toHaveLength(1);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    pin.url = "data:text/javascript,throw new Error('no')";
    const { preloadAvatar: broken } = await fresh();
    const face = broken("tara");
    await expect(face.ready).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(broken("tara")).not.toBe(face);
  });
});
