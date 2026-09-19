/**
 * The Blender avatars' own addressable motions, against the two rules that make
 * an open `cmd: "action"` id safe at all (docs/contract-wire.md § Action), and
 * against the research the shapes come from (docs/research-biomechanics.md
 * § 3.3, § 3.4).
 *
 * Amplitudes are deliberately *not* asserted here. What a stroke renders is the
 * mixer's smoothing acting on it, not the keys, so a number in this file would
 * either restate the keys — proving nothing — or hard-code a rendering it
 * cannot see. `nods.test.ts` steps the real mixer and holds the rendered
 * degrees to their research bands.
 */
import { describe, expect, it } from "vitest";
import { ACTION_IDS } from "../../src/avatar.js";
import { CORE_ACTION_IDS } from "../../client/types.js";
import { BLENDER_ACTIONS, BLENDER_SEQUENCES, BLENDER_SUPPORTS } from "../../client/three/sequences.js";

type Key = [number, number];
const keys = (id: keyof typeof BLENDER_SEQUENCES, channel: string): Key[] =>
  ((BLENDER_SEQUENCES[id] as { keys: Record<string, Key[]> }).keys[channel] ?? []);

/** Successive turning points of a channel, as ms on the clip's own clock. */
function peaks(id: keyof typeof BLENDER_SEQUENCES, channel: string): Array<{ t: number; v: number }> {
  const k = keys(id, channel);
  const dur = BLENDER_SEQUENCES[id].duration;
  return k
    .filter((_, i) => i > 0 && i < k.length - 1)
    .filter(([, v], i) => {
      const prev = k[i][1];
      const next = k[i + 2][1];
      return (v - prev) * (next - v) < 0; // a turn, not a waypoint
    })
    .map(([t, v]) => ({ t: t * dur, v }));
}

describe("what these characters declare", () => {
  it("lists the two required ids, the mixer's clips and its own names, once each", () => {
    // `BLENDER_SUPPORTS` is what a driving UI reads, and nothing checks it at
    // runtime: an id in it with nothing behind it is a button that does
    // nothing and says nothing, which is the failure the declaration exists
    // to prevent.
    const own = Object.keys(BLENDER_SEQUENCES);
    for (const id of [...CORE_ACTION_IDS, ...ACTION_IDS, ...own]) {
      expect(BLENDER_SUPPORTS.actions).toContain(id);
    }
    expect(new Set(BLENDER_SUPPORTS.actions).size).toBe(BLENDER_SUPPORTS.actions.length);
    for (const id of BLENDER_SUPPORTS.actions) {
      const known =
        (CORE_ACTION_IDS as readonly string[]).includes(id) ||
        (ACTION_IDS as readonly string[]).includes(id) ||
        own.includes(id);
      expect(known, id).toBe(true);
    }
  });
});

describe("Blender sequences", () => {
  it("can only add to the mixer's own vocabulary, never redefine it", () => {
    // The one property that lets an open wire id be safe: `ACTIONS` wins in
    // the mixer, so a name collision here would be an asset silently changing
    // what `ACK_NOD` means for a server that never asked for this avatar.
    for (const id of Object.keys(BLENDER_SEQUENCES)) {
      expect(ACTION_IDS, `${id} shadows one of the mixer's own`).not.toContain(id);
    }
  });

  it("answers ACK_NOD with the continuer itself rather than a second copy", () => {
    // The portable nod is the continuer on a Blender avatar; restating it
    // would be the same nod written twice with two chances to drift.
    expect(BLENDER_ACTIONS.ACK_NOD.keys).toBe(BLENDER_SEQUENCES.NOD_SMALL.keys);
    expect(BLENDER_ACTIONS.ACK_NOD.duration).toBe(BLENDER_SEQUENCES.NOD_SMALL.duration);
  });

  it("keeps every oscillation under the 1.5 Hz impatience line", () => {
    // research-biomechanics.md § 3.4: below 1.5 Hz reads as sustained attention,
    // above it as "hurry up" — and the head's own 160 ms smoothing eats most of
    // what is authored up there anyway, which is how a nod ends up both too
    // fast and too small at once.
    //
    // Measured between *same-direction* beats, which is what an oscillation is.
    // Counting every turning point instead — the first version of this test —
    // reads a gesture's final settle back to rest as a half-cycle and fails a
    // clip for ending, which is not a rhythm anybody hears.
    for (const id of Object.keys(BLENDER_SEQUENCES) as Array<keyof typeof BLENDER_SEQUENCES>) {
      for (const channel of ["headPitch", "headYaw"]) {
        for (const sign of [1, -1]) {
          const p = peaks(id, channel).filter((x) => Math.sign(x.v) === sign);
          for (let i = 1; i < p.length; i++) {
            const hz = 1000 / (p[i].t - p[i - 1].t);
            expect(hz, `${id}/${channel} cycle ${i}`).toBeLessThanOrEqual(1.5);
          }
        }
      }
    }
  });

  it("declines: every cycle is smaller than the one before it", () => {
    // § 3.4's second structural law, and the one our clips used to violate by
    // having flat repeated cycles.
    //
    // A *cycle* is a same-direction beat, not every turning point: a nod's
    // beats are the downward ones and the returns between them are the other
    // half of the same cycle. Comparing consecutive turning points instead —
    // which the first version of this test did — asserts that a nod's return is
    // smaller than its beat, which is a different and untrue claim.
    for (const [id, channel] of [
      ["NOD_ASSESS", "headPitch"], ["NOD_REALIZE", "headPitch"], ["NOD_NO", "headYaw"],
    ] as const) {
      for (const sign of [1, -1]) {
        const mag = peaks(id, channel)
          .filter((x) => Math.sign(x.v) === sign)
          .map((x) => Math.abs(x.v));
        for (let i = 1; i < mag.length; i++) {
          expect(mag[i], `${id} ${sign > 0 ? "down" : "up"} cycle ${i}`).toBeLessThan(mag[i - 1]);
        }
      }
    }
  });

  it("separates the three nod types the way the corpus does", () => {
    const dur = (id: keyof typeof BLENDER_SEQUENCES) => BLENDER_SEQUENCES[id].duration;
    // Mean durations from the ICMI corpus: short 0.83 s, long 1.42 s,
    // long_p 1.75 s. Ordering is the claim; the exact means are the target.
    expect(dur("NOD_SMALL")).toBeLessThan(dur("NOD_ASSESS"));
    expect(dur("NOD_ASSESS")).toBeLessThan(dur("NOD_REALIZE"));

    // "a smaller average range of movement" for the continuer against the
    // assessment nod is asserted in rendered degrees, in `nods.test.ts`.
    const down = (id: keyof typeof BLENDER_SEQUENCES) =>
      Math.max(...keys(id, "headPitch").map(([, v]) => v));

    // And the one that is a different gesture rather than a bigger one: only
    // `long_p` **opens** by swinging up, which is what marks a cognitive shift.
    //
    // The opening, not the minimum. Every multi-cycle nod passes above neutral
    // on its returns, so a global minimum says nothing about type — it was the
    // first version of this assertion and `NOD_ASSESS` failed it on a *return*.
    const opening = (id: keyof typeof BLENDER_SEQUENCES) => {
      const k = keys(id, "headPitch");
      const firstDown = k.findIndex(([, v]) => v > 0.2);
      return Math.min(...k.slice(0, firstDown < 0 ? k.length : firstDown).map(([, v]) => v));
    };
    // Relative to its own stroke, so the check survives re-sizing the nod.
    expect(opening("NOD_REALIZE"), "the realisation opens upward")
      .toBeLessThan(-0.5 * down("NOD_REALIZE"));
    expect(opening("NOD_SMALL"), "a continuer does not announce itself").toBeGreaterThan(-0.2);
    expect(opening("NOD_ASSESS"), "agreement is not realisation").toBeGreaterThan(-0.2);
  });

  it("says no on the axis, and sets the face so it is not a look around", () => {
    expect(keys("NOD_NO", "headYaw").length).toBeGreaterThan(3);
    expect(keys("NOD_NO", "headPitch"), "a shake is not a nod").toHaveLength(0);
    // A refusal over a resting smile reads as teasing.
    expect(Math.max(...keys("NOD_NO", "mouthPress").map(([, v]) => v))).toBeGreaterThan(0.2);
    expect(Math.min(...keys("NOD_NO", "mouthCornerL").map(([, v]) => v))).toBeLessThan(0);
  });
});
