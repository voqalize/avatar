// @vitest-environment jsdom
/**
 * The rig conformance gate, headless and deterministic.
 *
 * This used to be `node tools/sweep.mjs` — puppeteer, a real Chrome, a static
 * server and ~15 s of wall clock, all to run assertions that never once looked
 * at a pixel. The sweep asserts *numbers*: finite, in-range mixer parameters
 * and a drawing still attached to the document. jsdom has a document, and
 * `{manual: true}` avatars stepped at a fixed dt reach the same states in
 * milliseconds — so the browser was paying for nothing the gate used.
 *
 * What did NOT move here is the part that needed a browser: `apps/authoring/` still
 * renders, screenshots and pixel-diffs the faces, and `apps/authoring/rig-check.html`
 * still runs this exact sweep in real time so you can watch it. The assertions
 * have one copy, in `src/conformance.js` — see that file for why `advance` is
 * a parameter.
 *
 * jsdom gap, stubbed here (not in the widget): jsdom implements neither
 * `requestAnimationFrame` nor `cancelAnimationFrame`, and `destroy()` calls the
 * latter unconditionally. Manual avatars never schedule a frame, so the stub
 * only has to exist, not to fire. See mount.smoke.test.ts for the same note.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let polyfilled = false;

beforeAll(() => {
  if (typeof globalThis.cancelAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof cancelAnimationFrame;
    polyfilled = true;
  }
});

afterAll(() => {
  if (polyfilled) {
    // @ts-expect-error - undo the polyfill so a future jsdom that provides it
    // is not masked.
    delete globalThis.requestAnimationFrame;
    // @ts-expect-error - see above.
    delete globalThis.cancelAnimationFrame;
    polyfilled = false;
  }
});

describe("rig conformance sweep (jsdom)", () => {
  it("keeps every shipped face finite and in range through the whole vocabulary", async () => {
    const { createAvatar } = await import("../src/avatar.js");
    const { FACES, FACE_NAMES } = await import("../src/faces.js");
    const { conformanceSweep, stepper, seedRandom } = await import("../src/conformance.js");

    // Seed before construction: idle, gaze and blink all draw their first
    // phases in the constructor, so seeding afterwards would leave the one
    // thing you most want reproducible — where the sweep started — random.
    const restore = seedRandom(20260816);
    const rigs = FACE_NAMES.map((name: string) => {
      const mount = document.createElement("div");
      document.body.appendChild(mount);
      return { name, mount, avatar: createAvatar({ mount, face: FACES[name], manual: true }) };
    });

    try {
      const { ok, problems, summary } = await conformanceSweep(rigs, {
        advance: stepper(rigs),
      });
      expect(problems.slice(0, 20), summary).toEqual([]);
      expect(ok).toBe(true);
    } finally {
      restore();
      for (const r of rigs) {
        r.avatar.destroy();
        document.body.removeChild(r.mount);
      }
    }
  });

  it("is deterministic — same seed, same parameters", async () => {
    const { createAvatar } = await import("../src/avatar.js");
    const { FACES, DEFAULT_FACE } = await import("../src/faces.js");
    const { stepper, seedRandom } = await import("../src/conformance.js");

    const run = () => {
      const restore = seedRandom(7);
      const mount = document.createElement("div");
      document.body.appendChild(mount);
      const avatar = createAvatar({ mount, face: FACES[DEFAULT_FACE], manual: true });
      const rigs = [{ name: DEFAULT_FACE, avatar }];
      avatar.setState("LISTENING");
      stepper(rigs)(3);
      const params = { ...avatar.params };
      avatar.destroy();
      document.body.removeChild(mount);
      restore();
      return params;
    };

    // Three seconds is long enough for idle drift, a blink and a gaze aversion
    // to have fired — the three things that would make this test flake if the
    // seeding did not actually reach them.
    expect(run()).toEqual(run());
  });
});
