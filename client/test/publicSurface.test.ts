// @vitest-environment jsdom
/**
 * The public surface, tested as a consumer sees it.
 *
 * `createAvatar({ mount, client }) -> { destroy() }` is the entire contract —
 * no methods, no callbacks, no readable state — and this file exists to make
 * that literal rather than aspirational. The two things it actually guards:
 * the returned object has nothing else on it, and a third-party module can
 * satisfy the same signature with no knowledge of anything below it.
 *
 * See the jsdom rAF note in `mount.smoke.test.ts`; same gap, same stub.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAvatar, type AvatarFactory } from "../src/index.js";

let rafPolyfilled = false;

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof cancelAnimationFrame;
    rafPolyfilled = true;
  }
});

afterEach(() => {
  if (rafPolyfilled) {
    // @ts-expect-error - undo the polyfill; see mount.smoke.test.ts.
    delete globalThis.requestAnimationFrame;
    // @ts-expect-error - see above.
    delete globalThis.cancelAnimationFrame;
    rafPolyfilled = false;
  }
});

/** The smallest thing that is a `PipecatClient` as far as an avatar is concerned. */
function fakeClient() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get subscriptions() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    client: {
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off(event: string, fn: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(fn);
      },
    } as never,
  };
}

describe("createAvatar", () => {
  it("returns destroy() and nothing else", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fake = fakeClient();

    const avatar = createAvatar({ mount, client: fake.client });

    expect(Object.keys(avatar)).toEqual(["destroy"]);
    avatar.destroy();
    document.body.removeChild(mount);
  });

  it("subscribes to the client, renders into the mount, and reverses both", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fake = fakeClient();

    const avatar = createAvatar({ mount, client: fake.client });
    expect(fake.subscriptions).toBeGreaterThan(0);
    expect(mount.childElementCount).toBeGreaterThan(0);

    avatar.destroy();

    expect(fake.subscriptions).toBe(0);
    expect(mount.childElementCount).toBe(0);
    document.body.removeChild(mount);
  });

  it("is idempotent on destroy", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const avatar = createAvatar({ mount, client: fakeClient().client });

    avatar.destroy();
    expect(() => avatar.destroy()).not.toThrow();
    document.body.removeChild(mount);
  });

  it("refuses to mount without a client", () => {
    const mount = document.createElement("div");
    // Not nullable by design: an avatar with nothing to embody has no reason
    // to exist yet. React's `<Avatar>` is the forgiving layer, not this.
    expect(() => createAvatar({ mount, client: null as never })).toThrow(/client/);
  });

  it("reacts to a live client with no help from the caller", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fake = fakeClient();
    const avatar = createAvatar({ mount, client: fake.client });

    // The whole point: the host drives pipecat, never the avatar.
    expect(() => {
      fake.emit("botStartedSpeaking");
      fake.emit("serverMessage", { type: "avatar", cmd: "action", id: "ACK_NOD" });
      fake.emit("botStoppedSpeaking");
    }).not.toThrow();

    avatar.destroy();
    document.body.removeChild(mount);
  });
});

describe("a third-party avatar", () => {
  // The extension mechanism is "export a function with this signature". If an
  // implementation that knows nothing about our renderer, our pose channels or
  // our behavior catalog cannot satisfy `AvatarFactory`, the seam is in the
  // wrong place — which is the mistake this design was written to undo.
  it("satisfies the same signature knowing nothing about the SVG rig", () => {
    const seen: string[] = [];
    const mine: AvatarFactory = ({ mount, client }) => {
      const el = document.createElement("b");
      mount.appendChild(el);
      const onSpeak = () => { seen.push("speaking"); el.textContent = "●"; };
      client.on("botStartedSpeaking" as never, onSpeak as never);
      return {
        destroy() {
          client.off("botStartedSpeaking" as never, onSpeak as never);
          el.remove();
        },
      };
    };

    const mount = document.createElement("div");
    const fake = fakeClient();
    const avatar = mine({ mount, client: fake.client });
    fake.emit("botStartedSpeaking");

    expect(seen).toEqual(["speaking"]);
    avatar.destroy();
    expect(fake.subscriptions).toBe(0);
    expect(mount.childElementCount).toBe(0);
  });
});
