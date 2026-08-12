// @vitest-environment jsdom
/**
 * Headless mount smoke test: does `createAvatar` actually mount into a real
 * (jsdom) DOM and survive a handful of `setState`/`destroy` calls without
 * throwing? This is the one test in this directory that touches the widget
 * itself rather than `AvatarClient`'s dispatcher logic, and it is deliberately
 * shallow — it proves the *package boundary* works (the subpath resolves, the
 * ES modules load, the SVG lands in the DOM), not that the rig looks right.
 * The rig is judged by eye and by `tools/sweep.mjs`; see CLAUDE.md § Verifying.
 *
 * jsdom gap, stubbed here (not in the widget): jsdom does not implement
 * `requestAnimationFrame`/`cancelAnimationFrame` at all — there is nothing to
 * spy on, the globals are simply absent — and `avatar.js`'s render loop and
 * `destroy()` both call them unconditionally. A `setTimeout`-based polyfill is
 * the standard substitute for this specific, well-known jsdom omission (see
 * https://github.com/jsdom/jsdom/issues/1379). Nothing about the widget's
 * SVG or geometry code is stubbed; only this missing browser API.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    // @ts-expect-error - undo the polyfill so we don't mask a real regression
    // if a future jsdom version starts providing it.
    delete globalThis.requestAnimationFrame;
    // @ts-expect-error - see above.
    delete globalThis.cancelAnimationFrame;
    rafPolyfilled = false;
  }
});

describe("createAvatar mount (jsdom)", () => {
  it("mounts the default avatar, accepts every state, and destroys cleanly", async () => {
    const { createAvatar, STATE_NAMES, DEFAULT_AVATAR } = await import("../../src/avatar.js");

    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const avatar = createAvatar({ mount });

    expect(DEFAULT_AVATAR).toBeTruthy();
    expect(avatar.svg).toBeTruthy();
    expect(avatar.svg.isConnected).toBe(true);
    expect(avatar.state).toBe("IDLE");

    // Every registered state, straight through setState, must not throw.
    for (const name of STATE_NAMES) {
      expect(() => avatar.setState(name)).not.toThrow();
    }
    expect(avatar.state).toBe(STATE_NAMES[STATE_NAMES.length - 1]);

    expect(() => avatar.destroy()).not.toThrow();

    document.body.removeChild(mount);
  });

  it("mounts every registered avatar and tears each one down", async () => {
    // The registry is the thing a consumer picks from by name, so an avatar
    // that cannot be constructed from its own registry key is a broken public
    // surface even if `sweep()` in a real browser is the test that judges it.
    const { createAvatar, AVATAR_NAMES } = await import("../../src/avatar.js");

    expect(AVATAR_NAMES.length).toBeGreaterThan(0);

    for (const name of AVATAR_NAMES) {
      const mount = document.createElement("div");
      document.body.appendChild(mount);

      const avatar = createAvatar({ mount, avatar: name });
      expect(mount.contains(avatar.svg), `${name} did not mount`).toBe(true);
      expect(avatar.meta.viewBox.w, `${name} has no viewBox width`).toBeGreaterThan(0);

      avatar.destroy();
      document.body.removeChild(mount);
    }
  });

  it("adapts a renderer-neutral rig without SVG metadata", async () => {
    const { createAvatar } = await import("../../src/avatar.js");
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const frames: unknown[] = [];
    let destroyed = false;

    const avatar = createAvatar({
      mount,
      manual: true,
      rig: () => ({
        apply(frame) { frames.push(frame); },
        destroy() { destroyed = true; },
      }),
    });
    avatar.step(1 / 60);
    avatar.action("GESTURE_GREET").step(1 / 60);

    expect(frames).toHaveLength(2);
    expect((frames[1] as { hand?: { gesture: string } }).hand?.gesture).toBe("greet");
    expect(avatar.svg).toBeNull();
    expect(avatar.meta).toBeNull();
    avatar.destroy();
    expect(destroyed).toBe(true);
    document.body.removeChild(mount);
  });
});
