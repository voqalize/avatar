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
