// @vitest-environment jsdom
/**
 * What tara's nods *render*, in degrees, through the real mixer — held to the
 * bands in docs/research-head-rotation.md § 2.3.
 *
 * A stroke is a target the head chases at a 160 ms time constant, so the keys
 * say little about what the face does; this steps the real mixer at tara's
 * tuning and reads the smoothed pose back. The rig is a stub — nothing here
 * draws — because the degrees are fixed by the mixer and `HEAD_DEG`, not by
 * the GLB. Whether the nod *reads* is still judged on a recorded call.
 *
 * Each clip is measured as the difference from the same seeded run with no
 * clip, so idle sway and gaze drift cancel and only the gesture is left.
 *
 * TARA-SPECIFIC: degrees come from `TARA_TUNING`'s head angles, i.e. tara's
 * `HEAD_DEG`. A second avatar with its own envelope needs its own run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_IDS, createAvatar } from "../../src/avatar.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES } from "../../client/three/sequences.js";
import { HAIR_ROLL, TARA_TUNING, hairRollStep } from "../../client/three/tara-rig.js";

const DEG = TARA_TUNING.oculomotor.angles.head;
const DT = 1 / 60;

function seeded() {
  let seed = 0x7a2a;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixer(extra: object = {}) {
  return createAvatar({
    mount: document.createElement("div"), manual: true, hand: false,
    rig: () => ({ apply() {}, destroy() {} }),
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...TARA_TUNING, ...extra,
  } as any) as any;
}

/** headPitch / headYaw in degrees, one sample per frame, for `sec` of time. */
function run(play: ((a: any) => void) | null, sec: number) {
  vi.spyOn(Math, "random").mockImplementation(seeded());
  const avatar = mixer();
  avatar.setState("LISTENING");
  for (let i = 0; i < 60; i++) avatar.step(DT);
  if (play) play(avatar);
  const out: Array<{ pitch: number; yaw: number }> = [];
  for (let i = 0, n = Math.round(sec / DT); i < n; i++) {
    avatar.step(DT);
    out.push({ pitch: avatar.params.headPitch * DEG.y, yaw: avatar.params.headYaw * DEG.x });
  }
  avatar.destroy();
  vi.restoreAllMocks();
  return out;
}

/** The gesture alone: the clip's run minus the same run without it. +pitch is chin-down. */
function rendered(play: (a: any) => void, sec = 2.5) {
  const base = run(null, sec);
  const withClip = run(play, sec);
  const pitch = withClip.map((f, i) => f.pitch - base[i].pitch);
  const yaw = withClip.map((f, i) => f.yaw - base[i].yaw);
  const downAt = pitch.indexOf(Math.max(...pitch));
  const upAt = pitch.indexOf(Math.min(...pitch));
  return {
    down: pitch[downAt], up: -pitch[upAt], upFirst: upAt < downAt && -pitch[upAt] > 0.5,
    yawPP: Math.max(...yaw) - Math.min(...yaw),
  };
}

const seq = (id: string) => rendered((a) => a.action(id));
const act = (id: string) => rendered((a) => a.action(id));

afterEach(() => vi.restoreAllMocks());

// `NODS_TABLE=1 npx vitest run packages/avatar/test/three/nods.test.ts` prints
// every clip's rendered degrees — for tuning, and for the tables in the docs.
it.runIf(process.env.NODS_TABLE)("prints the rendered table", () => {
  const rows: Record<string, Record<string, string>> = {};
  const fmt = (r: ReturnType<typeof rendered>) =>
    ({ down: r.down.toFixed(1), up: r.up.toFixed(1), yawPP: r.yawPP.toFixed(1) });
  for (const id of ["ACK_NOD", "GESTURE_APPROVE", "GESTURE_GREET", "GESTURE_WAIT"]) rows[id] = fmt(act(id));
  for (const id of Object.keys(BLENDER_SEQUENCES)) rows[id] = fmt(seq(id));
  console.table(rows);
});

describe("tara's nods, rendered", () => {
  it("answers ACK_NOD with the continuer: 3-5°, one stroke, no rebound", () => {
    // A continuer's return equals its stroke (Mori 2025). A rebound above
    // neutral on a head that really rotates is a second, upward nod.
    for (const r of [act("ACK_NOD"), seq("NOD_SMALL")]) {
      expect(r.down).toBeGreaterThanOrEqual(3);
      expect(r.down).toBeLessThanOrEqual(5);
      expect(r.up).toBeLessThan(0.5);
    }
  });

  it("makes agreement a single 6-10° stroke", () => {
    const r = seq("NOD_ASSESS");
    expect(r.down).toBeGreaterThanOrEqual(6);
    expect(r.down).toBeLessThanOrEqual(10);
    expect(r.up).toBeLessThan(0.5);
  });

  it("opens the realisation upward, 6-10° peak to peak", () => {
    const r = seq("NOD_REALIZE");
    expect(r.upFirst).toBe(true);
    expect(r.up + r.down).toBeGreaterThanOrEqual(6);
    expect(r.up + r.down).toBeLessThanOrEqual(10);
  });

  it("leaves the shared approve inside agreement's band", () => {
    // Why `BLENDER_ACTIONS` reshapes only the nod: this one already fits.
    const r = act("GESTURE_APPROVE");
    expect(r.down).toBeGreaterThanOrEqual(6);
    expect(r.down).toBeLessThanOrEqual(10);
  });
});

describe("the mixer's `actions` option", () => {
  it("only reshapes, never adds", () => {
    for (const id of Object.keys(BLENDER_ACTIONS)) expect(ACTION_IDS).toContain(id);
    expect(() => mixer({ actions: { NOD_SMALL: BLENDER_SEQUENCES.NOD_SMALL } }))
      .toThrow(/is not one of this renderer's own/);
  });

  it("leaves a face without the option on the shared clip", () => {
    const shared = rendered((a) => a.action("ACK_NOD"));
    const plain = (() => {
      const base = run(null, 2.5);
      vi.spyOn(Math, "random").mockImplementation(seeded());
      const avatar = mixer({ actions: undefined });
      avatar.setState("LISTENING");
      for (let i = 0; i < 60; i++) avatar.step(DT);
      avatar.action("ACK_NOD");
      let down = 0;
      for (let i = 0; i < base.length; i++) {
        avatar.step(DT);
        down = Math.max(down, avatar.params.headPitch * DEG.y - base[i].pitch);
      }
      avatar.destroy();
      return down;
    })();
    expect(plain).toBeGreaterThan(shared.down * 2);
  });
});

describe("the mixer's `states` option", () => {
  it("only re-renders, never adds", () => {
    expect(() => mixer({ states: { READING: { pose: {} } } })).toThrow(/is not a state/);
  });

  it("drops tara's WORKING brows and leaves the rest of the face its own", () => {
    // TARA-SPECIFIC: the knit brows that finished her WORKING squint.
    const held = (extra: object) => {
      const avatar = mixer(extra);
      avatar.setState("WORKING");
      for (let i = 0; i < 180; i++) avatar.step(DT);
      const { browInnerL, shoulderL } = avatar.params;
      avatar.destroy();
      return { browInnerL, shoulderL };
    };
    vi.spyOn(Math, "random").mockImplementation(seeded());
    const shared = held({ states: undefined });
    vi.spyOn(Math, "random").mockImplementation(seeded());
    const tara = held({});
    expect(shared.browInnerL).toBeLessThan(-0.05);
    expect(tara.browInnerL).toBeGreaterThan(shared.browInnerL + 0.05);
    expect(tara.shoulderL).toBeCloseTo(shared.shoulderL, 2);
  });

  it("holds no squint on tara where the shared states squint", () => {
    // TARA-SPECIFIC: her squint morph closes the eye from below over a dark
    // band, which read as a side-eye in CANT_HEAR and half-lidded searching.
    for (const state of ["CANT_HEAR", "SEARCHING_SCREEN"]) {
      const held = (extra: object) => {
        const avatar = mixer(extra);
        avatar.setState(state);
        for (let i = 0; i < 180; i++) avatar.step(DT);
        const squint = avatar.params.squintL;
        avatar.destroy();
        return squint;
      };
      expect(held({ states: undefined })).toBeGreaterThan(0.3);
      expect(held({})).toBeLessThan(0.05);
    }
  });
});

describe("the acknowledgement's smile", () => {
  /** mouthCornerL over the no-action run, per frame, after `play` at 1 s in. */
  const corner = (play: (a: any) => void, sec = 2.5) => {
    const one = (p: ((a: any) => void) | null) => {
      vi.spyOn(Math, "random").mockImplementation(seeded());
      const avatar = mixer();
      avatar.setState("LISTENING");
      for (let i = 0; i < 60; i++) avatar.step(DT);
      if (p) p(avatar);
      const out: number[] = [];
      for (let i = 0; i < Math.round(sec / DT); i++) { avatar.step(DT); out.push(avatar.params.mouthCornerL); }
      avatar.destroy();
      vi.restoreAllMocks();
      return out;
    };
    const base = one(null);
    return one(play).map((c, i) => c - base[i]);
  };

  it("comes with the nod, while the nod is still on, and outlasts it", () => {
    // Behind the clip gate it arrived as the 720 ms continuer ended: a smile
    // at nothing.
    const c = corner((a) => a.action("ACK_NOD"));
    expect(c[Math.round(0.6 / DT)]).toBeGreaterThan(0.2);
    expect(c[Math.round(1.5 / DT)]).toBeGreaterThan(0.05);
  });

  it("is dropped by an interruption", () => {
    const c = corner((a) => { a.action("ACK_NOD"); for (let i = 0; i < 30; i++) a.step(DT); a.action("RESPONSE_INTERRUPTED"); });
    // RESPONSE_INTERRUPTED's own clip has no corner keys: what is left is
    // smoothing, gone well inside a second.
    expect(Math.max(...c.slice(Math.round(1.2 / DT)))).toBeLessThan(0.05);
  });
});

/**
 * The hair's own roll, which is not the mixer's and not a pose channel: a
 * spring chasing a fraction of the head's angle, stepped per rendered frame.
 * A still frame can only show where it settles; what a hinge-free roll needs is
 * that it arrives *late*, goes slightly past, and comes back — so those are
 * numbers, and they are here.
 *
 * TANYA-SPECIFIC in effect. The field the spring drives is authored only on a
 * character whose hair hangs into the held band (`morphs.hair_hangs`), so on
 * tara and tushar this runs and writes nothing.
 */
describe("hair roll", () => {
  const settle = (theta: number, hz: number) => {
    const target = theta * (1 - HAIR_ROLL.hold);
    let s = { angle: 0, rate: 0 };
    const out: number[] = [];
    for (let i = 0; i < Math.round(2 / (1 / hz)); i++) {
      s = hairRollStep(s.angle, s.rate, target, 1 / hz);
      out.push(s.angle);
    }
    return { out, target };
  };

  it("lags the head, overshoots once, and settles to the hold", () => {
    const { out, target } = settle(-0.1, 60);
    expect(out[1]).toBeGreaterThan(target * 0.25);          // still behind at 33 ms
    expect(Math.min(...out)).toBeLessThan(target * 1.02);    // goes past it
    expect(Math.min(...out)).toBeGreaterThan(target * 1.15);  // but not by much
    expect(out[out.length - 1]).toBeCloseTo(target, 3);      // and comes back
  });

  it("is stable at 30 fps", () => {
    // Explicit Euler diverges here; this is the reason the step is semi-implicit.
    const { out, target } = settle(-0.1, 30);
    expect(out[out.length - 1]).toBeCloseTo(target, 3);
    expect(Math.min(...out)).toBeGreaterThan(target * 1.6);
  });

  it("settles inside a phrase", () => {
    // The head holds a pose per phrase; hair still travelling when the next one
    // starts never reads as having arrived anywhere. Phrases run from about
    // 600 ms, so the whole settle has to fit inside half of that.
    const { out, target } = settle(-0.1, 60);
    const done = out.findIndex((_, i) =>
      out.slice(i).every((a) => Math.abs(a - target) < Math.abs(target) * 0.05));
    expect(done / 60).toBeLessThan(0.5);
  });
});
