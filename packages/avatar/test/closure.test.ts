// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("bilabial closure", () => {
  // The case that stopped short: an open vowel, then a [b] no longer than
  // running speech gives one. Aimed at shut, the lips were still apart when the
  // next vowel pulled them open again.
  it("shuts the lips inside a short [b] and never draws them past shut", async () => {
    const { createAvatar } = await import("../src/avatar.js");
    const { FACES, DEFAULT_FACE } = await import("../src/faces.js");
    const { seedRandom } = await import("../src/conformance.js");
    const restore = seedRandom(3);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const avatar = createAvatar({ mount, face: FACES[DEFAULT_FACE], manual: true });
    let now = 0;
    const b = { from: 200, to: 270 };
    avatar.speak({
      cues: [{ t: 0, v: "D", i: 0.5 }, { t: b.from, v: "A", i: 0.5 },
             { t: b.to, v: "D", i: 0.5 }, { t: 500, v: "X" }],
      clock: () => now,
    });
    let shut = Infinity;
    let least = Infinity;
    try {
      for (; now < 700; now += 1000 / 60) {
        avatar.step(1 / 60);
        const open = avatar.params.mouthOpen;
        least = Math.min(least, open);
        if (now >= b.from && now < b.to) shut = Math.min(shut, open);
      }
    } finally {
      avatar.destroy();
      document.body.removeChild(mount);
      restore();
    }
    expect(shut).toBe(0);
    expect(least).toBeGreaterThanOrEqual(0);
  });
});
