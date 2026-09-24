// @vitest-environment jsdom
/**
 * What LISTENING and SPEAKING actually *hold*, in degrees, through the real
 * mixer — against `client/three/motion-limits.json`.
 *
 * This is `nods.test.ts`'s method pointed at the other half of a call, and it
 * is the half that matters more: the two states are almost all of a call's
 * time, and the avatar listens far more than it speaks. A nod is a transient
 * and is forgiven a peak; a listening head *holds* a pose for a phrase at a
 * time, which is exactly the condition the limits were measured under —
 * "static held pose, one axis at a time from rest, judged by eye at the
 * shipping surface". So the limits are a gate here and nowhere else.
 *
 * `PRESENCE_TABLE=1 npx vitest run packages/avatar/test/three/presence.test.ts`
 * prints the whole picture; the assertions below are the parts of it that have
 * a number to be held to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAvatar } from "../../src/avatar.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES } from "../../client/three/sequences.js";
import { headHold } from "../../client/three/holds.js";
import { EYE_DEG, HEAD_CLAMP, HEAD_DEG, CHARACTER_TUNING } from "../../client/three/character-rig.js";
import LIMITS from "../../client/three/motion-limits.json";

const DT = 1 / 60;
const AXES = ["headYaw", "headPitch", "headRoll"] as const;
/** Degrees per pose unit, which is `HEAD_DEG` at the clamp. */
const DEG: Record<(typeof AXES)[number], number> = {
  headYaw: HEAD_DEG.yaw / HEAD_CLAMP,
  headPitch: HEAD_DEG.pitch / HEAD_CLAMP,
  headRoll: HEAD_DEG.roll / HEAD_CLAMP,
};
/** `motion-limits.json`'s key for each channel. */
const LIMIT_AXIS = { headYaw: "yaw", headPitch: "pitch", headRoll: "roll" } as const;

function seeded(seed = 0x7a2a) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixer() {
  return createAvatar({
    mount: document.createElement("div"), manual: true, hand: false,
    rig: () => ({ apply() {}, destroy() {} }),
    sequences: BLENDER_SEQUENCES, actions: BLENDER_ACTIONS, ...CHARACTER_TUNING,
    // The tightest of the three, so one recording answers for all of them: a
    // budget that holds the narrowest face holds the others by construction.
    headHold: tightest(),
  } as any) as any;
}

/** A phrase of alternating consonant/vowel cues, as `prosody.test.ts` builds one. */
function phrase(t0: number, n: number, vowelMs = 110, consMs = 70) {
  const out: Array<{ t: number; v: string; i?: number }> = [];
  let t = t0;
  for (let k = 0; k < n; k++) {
    out.push({ t, v: "B" }); t += consMs;
    out.push({ t, v: "C", i: 0.7 }); t += vowelMs;
  }
  return out;
}

/** A turn of several sentences, with clause pauses between them — what the head
 *  hangs its per-phrase poses on. */
function turn(seconds: number) {
  const cues: Array<{ t: number; v: string; i?: number }> = [];
  let t = 0;
  const rnd = seeded(0x51ed);
  while (t < seconds * 1000) {
    const words = 3 + Math.floor(rnd() * 5);
    cues.push(...phrase(t, words));
    t = cues[cues.length - 1].t + 180;
    cues.push({ t, v: "X" });
    t += 260 + rnd() * 420;                       // a clause pause
  }
  return cues;
}

type Sample = Record<string, number>;

/** Steps the mixer for `seconds`, sampling every frame. */
function record(seconds: number, drive: (a: any, frame: number) => void): Sample[] {
  vi.spyOn(Math, "random").mockImplementation(seeded());
  const avatar = mixer();
  const out: Sample[] = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    drive(avatar, i);
    avatar.step(DT);
    const p = avatar.params;
    out.push({
      headYaw: p.headYaw, headPitch: p.headPitch, headRoll: p.headRoll,
      pupilX: p.pupilX, pupilY: p.pupilY,
      shoulderL: p.shoulderL, shoulderR: p.shoulderR, torsoLean: p.torsoLean,
      browRaiseL: p.browRaiseL, mouthCornerL: p.mouthCornerL,
    });
  }
  avatar.destroy();
  vi.restoreAllMocks();
  return out;
}

/** A listening stretch: the user talks in bursts, the avatar holds and attends. */
const listening = (seconds = 30) => record(seconds, (a, i) => {
  if (i === 0) a.setState("LISTENING");
  // ~4 s of user speech, ~1 s of silence, which is what a turn sounds like.
  const phase = (i * DT) % 5;
  a.setUserSpeaking(phase < 4);
});

/** A speaking stretch: one long turn of real cues. */
const speaking = (seconds = 30) => record(seconds, (a, i) => {
  if (i === 0) a.speak({ cues: turn(seconds), clock: () => i * DT * 1000 });
});

/**
 * The tightest safe angle any character survives on this axis — the driver is
 * shared, so the head may only go where the narrowest face can follow.
 *
 * An axis carrying `remeasure` is skipped: it was read off an asset that has
 * since been fixed, and gating on it would hold the driver to a defect that no
 * longer exists. The entry stays as the owner wrote it; this only declines to
 * believe it. A character the owner has not driven yet carries no entry on the
 * axis at all and is skipped the same way — she is held by what this returns,
 * so she cannot also be a voice in it. If nothing on an axis is live there is
 * nothing left to hold to, and that is a failure rather than a pass.
 */
function safest(axis: (typeof AXES)[number]): number {
  const live = Object.values((LIMITS as any).characters)
    .map((c: any) => c[LIMIT_AXIS[axis]])
    .filter((a: any) => a && !a.remeasure)
    .map((a: any) => a.safe as number);
  if (!live.length) throw new Error(`every ${LIMIT_AXIS[axis]} limit awaits re-measurement`);
  return Math.min(...live);
}

/** Every axis at its narrowest live budget, in pose units. */
const tightest = () => {
  const names = Object.keys((LIMITS as any).characters) as Parameters<typeof headHold>[0][];
  const each = names.map((n) => headHold(n));
  const out: Record<string, number> = {};
  for (const axis of AXES) {
    const live = each.map((h) => h[axis]).filter((v): v is number => v !== undefined);
    if (live.length) out[axis] = Math.min(...live);
  }
  return out;
};

const abs = (s: Sample[], k: string) => s.map((f) => Math.abs(f[k]));
const pct = (xs: number[], p: number) => {
  const v = [...xs].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
};
const span = (s: Sample[], k: string) =>
  Math.max(...s.map((f) => f[k])) - Math.min(...s.map((f) => f[k]));

/** Pearson's r between two channels of one take. */
const corr = (s: Sample[], a: string, b: string) => {
  const xs = s.map((f) => f[a]), ys = s.map((f) => f[b]);
  const mx = xs.reduce((u, v) => u + v, 0) / xs.length;
  const my = ys.reduce((u, v) => u + v, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
};

afterEach(() => vi.restoreAllMocks());

it.runIf(process.env.PRESENCE_TABLE)("prints what the two states hold", () => {
  for (const [name, take] of [["LISTENING", listening()], ["SPEAKING", speaking()]] as const) {
    const rows: Record<string, Record<string, string>> = {};
    for (const axis of AXES) {
      const d = abs(take, axis).map((v) => v * DEG[axis]);
      rows[`${axis} °`] = {
        p50: pct(d, 0.5).toFixed(2), p95: pct(d, 0.95).toFixed(2), max: Math.max(...d).toFixed(2),
        "tara safe": String((LIMITS as any).characters.tara[LIMIT_AXIS[axis]].safe),
        "tanya safe": String((LIMITS as any).characters.tanya[LIMIT_AXIS[axis]].safe),
      };
    }
    for (const [k, scale, unit] of [["pupilX", EYE_DEG.x, "°"], ["pupilY", EYE_DEG.y, "°"],
                                    ["shoulderL", 1, "u"], ["torsoLean", 1, "u"],
                                    ["browRaiseL", 1, "u"], ["mouthCornerL", 1, "u"]] as const) {
      const d = abs(take, k).map((v) => v * (scale as number));
      rows[`${k} ${unit}`] = { p50: pct(d, 0.5).toFixed(2), p95: pct(d, 0.95).toFixed(2),
                               max: Math.max(...d).toFixed(2), "tara safe": "", "tanya safe": "" };
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== ${name} ===  (30 s, tara's envelope)`);
    // eslint-disable-next-line no-console
    console.table(rows);
  }
});

describe("what a listening head holds", () => {
  const take = listening();

  it.each(AXES)("keeps %s inside every character's safe angle", (axis) => {
    expect(Math.max(...abs(take, axis)) * DEG[axis]).toBeLessThanOrEqual(safest(axis));
  });

  it("does not stand still", () => {
    // Deliberate stillness is a cue; thirty seconds of it is a photograph.
    expect(span(take, "headYaw") * DEG.headYaw).toBeGreaterThan(1);
  });
});

describe("what a speaking head holds", () => {
  const take = speaking();

  it.each(AXES)("keeps %s inside every character's safe angle", (axis) => {
    expect(Math.max(...abs(take, axis)) * DEG[axis]).toBeLessThanOrEqual(safest(axis));
  });
});

/**
 * How far off the user the gaze points, in degrees — pupil *and* head, the way
 * the motion audit measures it (`motion-audit/stats.py`).
 *
 * `pupilX` alone cannot answer this. On a rig with a vestibulo-ocular reflex
 * most of the pupil's travel is compensation for a head moving for other
 * reasons, so a locked eye and a wandering one reach similar amplitudes; the
 * audit's own metric once called a locked stare a look away for exactly that.
 * Adding the head back is what turns the pair into a direction.
 */
const offsetDeg = (s: Sample) =>
  // -0.05: the eyes' own resting point on the user is a little below centre.
  Math.hypot(s.pupilX * EYE_DEG.x + s.headYaw * DEG.headYaw,
             (s.pupilY - 0.05) * EYE_DEG.y + s.headPitch * DEG.headPitch);
/**
 * Contact, in degrees of gaze offset — `stats.py`'s `CONTACT_DEG`, one copy of
 * the derivation there. Not delicate: a real look away overshoots it severalfold.
 */
const CONTACT_DEG = 4;

describe("where the eyes are while the mouth is moving", () => {
  /**
   * The eyes hold the user for the whole turn — the owner's call on 2026-09-21,
   * and the reasoning is in `src/gaze.js` where the speaking aversion used to
   * be. A turn's worth of frames, every one of them on the user: there is no
   * percentage to allow, because there is no longer any mechanism that takes
   * the speaking gaze off the user at all.
   */
  it("never leaves the user", () => {
    expect(Math.max(...speaking().map(offsetDeg))).toBeLessThan(CONTACT_DEG);
  });
});

describe("the warmth a listening face carries", () => {
  const take = listening();
  const corner = abs(take, "mouthCornerL");

  // Entering LISTENING is a warmth episode (`prosody.listen`): the floor has
  // come back to the user and the face receives it.
  it("smiles when the floor arrives", () => {
    expect(Math.max(...corner)).toBeGreaterThan(0.25);
  });

  // And the other half of the owner's brief — "always smiling is a problem".
  // The episode fades and nothing re-arms it, so most of a listening stretch is
  // a face that is not smiling. `REST` is the floor the smoothing decays into
  // rather than zero: an exponential never arrives, and a corner this far up is
  // a fraction of a pixel at the shipping surface.
  const REST = 0.005;
  it("is back at neutral for most of the stretch", () => {
    expect(pct(corner, 0.5)).toBeLessThan(REST);
    expect(pct(corner, 0.75)).toBeLessThan(REST);
  });
});

/**
 * A reply that begins while THINKING is still looking away.
 *
 * This is the owner's report of 2026-09-21 — "when the bot starts talking it
 * looks elsewhere, then back at the user" — and it is not the turn-start
 * aversion, which is deleted (gaze.js). It is the handover itself: THINKING
 * aims `AWAY_SIDE`, and the gap before a reply is usually under two seconds,
 * so whether the eyes are away when the first word lands is a coin toss on how
 * long the LLM took.
 *
 * Measured as the angle between where the gaze points and the user, the way
 * the motion audit measures it — pupil *and* head, in degrees. `pupilX` alone
 * cannot answer it: on a rig with a reflex most of the pupil's travel is
 * compensation for a head moving for other reasons.
 */
describe("a reply that starts while the eyes are away", () => {
  // Long enough that THINKING's opening check-in on the user has run out and
  // the look away is under way; short enough to be the gap a real reply leaves.
  const THINK_FRAMES = Math.round(1.8 / DT);
  const take = record(6, (a, i) => {
    if (i === 0) a.setState("LISTENING");
    if (i === Math.round(0.5 / DT)) a.setState("THINKING");
    if (i === THINK_FRAMES) a.speak({ cues: turn(4), clock: () => (i - THINK_FRAMES) * DT * 1000 });
  });

  it("has the eyes away when the turn is handed over", () => {
    expect(offsetDeg(take[THINK_FRAMES - 1])).toBeGreaterThan(CONTACT_DEG);
  });

  it("puts them back on the user inside a saccade", () => {
    const back = take.findIndex((s, i) => i >= THINK_FRAMES && offsetDeg(s) < CONTACT_DEG);
    expect(back).toBeGreaterThan(-1);
    expect((back - THINK_FRAMES) * DT).toBeLessThan(0.3);
  });

  it("keeps them there for the rest of the turn", () => {
    const rest = take.slice(THINK_FRAMES + Math.round(0.5 / DT));
    expect(Math.max(...rest.map(offsetDeg))).toBeLessThan(CONTACT_DEG);
  });
});
