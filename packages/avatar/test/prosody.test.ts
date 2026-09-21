import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROSODY_CHANNELS, SpeechProsody } from "../src/prosody.js";

type Cue = { t: number; v: string; i?: number };

// Plays a cue list through the layer at 60 fps, the way the mixer samples it.
type Frame = { now: number; blink: boolean } & Record<string, number>;
function play(cues: Cue[], { active = true, until = cues[cues.length - 1].t + 600 } = {}) {
  const p = new SpeechProsody();
  const frames: Frame[] = [];
  let index = 0;
  for (let now = 0; now <= until; now += 1000 / 60) {
    while (index + 1 < cues.length && cues[index + 1].t <= now) index++;
    const out = p.update({ cues, now, index }, active, 1 / 60);
    frames.push({ now, ...out } as Frame);
  }
  return frames;
}

// A phrase of alternating consonant/vowel cues, every vowel alike.
function phrase(t0: number, n: number, vowelMs = 110, consMs = 70): Cue[] {
  const out: Cue[] = [];
  let t = t0;
  for (let k = 0; k < n; k++) {
    out.push({ t, v: "B" }); t += consMs;
    out.push({ t, v: "C", i: 0.7 }); t += vowelMs;
  }
  return out;
}

const end = (cues: Cue[]) => cues[cues.length - 1].t + 180;

describe("SpeechProsody", () => {
  // The layer draws a beat's form, a diagonal's side and each phrase's aim
  // from Math.random; pinned, every run sees the same head. At 0.5 each phrase
  // turns the other way and beats are plain pitch nods.
  beforeEach(() => { vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("blinks at a pause but not at the gap between two words", () => {
    const a = phrase(0, 4);
    const gap = { t: end(a) - 110, v: "X" }; // 110 ms: a word gap
    const b = phrase(gap.t + 110, 4);
    const pause = { t: end(b) - 110, v: "X" }; // 450 ms: a clause pause
    const c = phrase(pause.t + 450, 8); // long enough to clear the blink rate limit
    const cues = [...a, gap, ...b, pause, ...c, { t: end(c), v: "X" }];
    const blinks = play(cues).filter((f) => f.blink).map((f) => f.now);
    expect(blinks.length).toBe(2); // the clause pause, and the end
    expect(blinks[0]).toBeGreaterThanOrEqual(pause.t);
    expect(blinks[0]).toBeLessThan(pause.t + 150);
  });

  it("moves the head to the next phrase's pose inside the pause, before the voice", () => {
    const a = phrase(0, 3);
    const pause = { t: end(a) - 110, v: "X" };
    const b = phrase(pause.t + 600, 3);
    const frames = play([...a, pause, ...b, { t: end(b), v: "X" }]);
    const resume = b[0].t;
    const at = (ms: number) => frames.reduce((p, f) => (Math.abs(f.now - ms) < Math.abs(p.now - ms) ? f : p));
    const held = at(pause.t + 100).headYaw;
    const landed = at(resume + 250).headYaw;
    expect(Math.abs(held)).toBeGreaterThan(0.1);
    expect(Math.sign(landed)).toBe(-Math.sign(held)); // the other side
    // Under way before the first syllable, not started by it.
    expect(Math.abs(at(resume).headYaw - held)).toBeGreaterThan(0.1);
    expect(at(pause.t + 200).headYaw).toBe(held);
  });

  it("holds the head exactly still between moves", () => {
    const flat = phrase(0, 14); // no vowel stands out: no beats
    const frames = play([...flat, { t: end(flat), v: "X" }]);
    const lastVowel = flat[flat.length - 1].t;
    const mid = frames.filter((f) => f.now > 600 && f.now < lastVowel - 200);
    for (const k of ["headYaw", "headPitch", "headRoll"]) {
      expect(new Set(mid.map((f) => f[k])).size).toBe(1);
    }
    expect(Math.abs(mid[0].headYaw)).toBeGreaterThan(0.1);
  });

  it("nods on a beat and comes back to exactly the pose it left", () => {
    const stressed = phrase(0, 8);
    const peak = stressed[11];
    peak.i = 1;
    for (const c of stressed.slice(12)) c.t += 160;
    const frames = play([...stressed, { t: end(stressed), v: "X" }]);
    const pitch = (lo: number, hi: number) => frames.filter((f) => f.now > lo && f.now < hi).map((f) => f.headPitch);
    const before = pitch(peak.t - 420, peak.t - 380)[0];
    expect(Math.max(...pitch(peak.t - 300, peak.t + 100)) - before).toBeGreaterThan(0.12);
    // Gone by the next syllables, and before the phrase's closing settle.
    expect(pitch(peak.t + 220, peak.t + 380).every((p) => p === before)).toBe(true);
  });

  it("puts one beat on the vowel that stands out, and none on a flat phrase", () => {
    const flat = phrase(0, 8);
    // The brows hold a level per phrase now, so "no beat" is no *excursion*
    // above that level rather than no value at all. With Math.random pinned at
    // 0.5 the held level is POSE.brow's midpoint, 0.02, and a beat is +0.34 on
    // top of it.
    const held = play([...flat, { t: end(flat), v: "X" }]).map((f) => f.browRaiseL);
    expect(Math.max(...held)).toBeLessThan(0.1);

    const stressed = phrase(0, 8);
    const peak = stressed[11]; // the sixth vowel, long and loud
    peak.i = 1;
    for (const c of stressed.slice(12)) c.t += 160;
    const frames = play([...stressed, { t: end(stressed), v: "X" }]);
    const up = frames.filter((f) => f.browRaiseL > 0.2);
    expect(up.length).toBeGreaterThan(0);
    expect(up[0].now).toBeGreaterThan(peak.t - 200);
    expect(up[up.length - 1].now).toBeLessThan(peak.t + 400);
  });

  it("beats about once a second through a long phrase, never closer than the gap", () => {
    // Twelve seconds of one phrase with a stressed vowel every ~0.6 s: the
    // gate, not the phrase, is what limits the rate.
    const cues: Cue[] = [];
    let t = 0;
    for (let k = 0; k < 64; k++) {
      cues.push({ t, v: "B" }); t += 70;
      const long = k % 3 === 1;
      cues.push({ t, v: "C", i: long ? 1 : 0.7 }); t += long ? 170 : 110;
    }
    cues.push({ t, v: "X" });
    const frames = play(cues);
    // A rising crossing of 0.2: clear of the phrase's held level (0.02 under
    // the pinned draw) and well under a beat's 0.36 peak, so each beat counts
    // exactly once.
    const onsets = frames.filter((f, k) => k > 0 && f.browRaiseL > 0.2 && frames[k - 1].browRaiseL <= 0.2).map((f) => f.now);
    const perSecond = onsets.length / (t / 1000);
    expect(perSecond).toBeGreaterThan(0.6);
    expect(perSecond).toBeLessThan(1.2);
    for (let k = 1; k < onsets.length; k++) expect(onsets[k] - onsets[k - 1]).toBeGreaterThan(880);
  });

  it("holds a brow level through each phrase rather than resting at zero, and lets it furrow", () => {
    const run = (draw: number) => {
      vi.restoreAllMocks();
      vi.spyOn(Math, "random").mockReturnValue(draw);
      const parts: Cue[] = [];
      let t0 = 0;
      for (let n = 0; n < 4; n++) {
        const p = phrase(t0, 7);
        parts.push(...p, { t: end(p) - 110, v: "X" });
        t0 = end(p) + 450;
      }
      return play(parts);
    };
    // A low draw furrows, a high one lifts. Either way the brow is somewhere:
    // the deadpan was that it was nowhere, measured at exactly 0.000 for 84%
    // of a speaking turn, and never below zero at all.
    const low = run(0.1).map((f) => f.browRaiseL);
    const high = run(0.9);
    expect(Math.min(...low)).toBeLessThan(-0.05);
    expect(Math.max(...high.map((f) => f.browRaiseL))).toBeGreaterThan(0.1);
    expect(low.filter((v) => v === 0).length / low.length).toBeLessThan(0.1);
    // The right brow follows the left rather than matching it.
    const lead = high.find((f) => f.browRaiseL > 0.1)!;
    expect(Math.abs(lead.browRaiseR)).toBeLessThan(Math.abs(lead.browRaiseL));
  });

  it("moves the head on more than one axis, and changes position each phrase", () => {
    const parts: Cue[] = [];
    let t0 = 0;
    for (let n = 0; n < 6; n++) {
      const p = phrase(t0, 7);
      p[7].i = 1; // one stressed vowel per phrase
      for (const c of p.slice(8)) c.t += 160;
      parts.push(...p, { t: end(p) - 110 + 160, v: "X" });
      t0 = end(p) + 160 + 450;
    }
    const frames = play(parts);
    const range = (k: string) => Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k]));
    expect(range("headPitch")).toBeGreaterThan(0.1);
    expect(range("headYaw")).toBeGreaterThan(0.3);
    expect(range("headRoll")).toBeGreaterThan(0.15);
    // Consecutive phrases sit on different sides rather than about one pose.
    expect(frames.some((f) => f.headYaw > 0.1) && frames.some((f) => f.headYaw < -0.1)).toBe(true);
  });

  it("settles the chin on the last vowel of a phrase and holds it into the pause, and breathes in", () => {
    const a = phrase(0, 6);
    const pause = { t: end(a) - 110, v: "X" };
    const b = phrase(pause.t + 600, 6);
    const frames = play([...a, pause, ...b, { t: end(b), v: "X" }]);
    const lastVowel = a[a.length - 1].t;
    const pitch = (lo: number, hi: number) => frames.filter((f) => f.now > lo && f.now < hi).map((f) => f.headPitch);
    const settled = pitch(pause.t + 240, pause.t + 320);
    expect(settled[0] - pitch(lastVowel - 200, lastVowel - 150)[0]).toBeGreaterThan(0.05);
    expect(new Set(settled).size).toBe(1);
    const resume = b[0].t;
    const inhale = frames.filter((f) => f.now > resume - 250 && f.now < resume);
    expect(Math.max(...inhale.map((f) => f.breath))).toBeGreaterThan(0.4);
  });

  it("smiles as a turn starts and as it closes, and not in between", () => {
    const long = phrase(0, 30);
    const cues = [...long, { t: end(long), v: "X" }];
    const p = new SpeechProsody();
    let corner = 0;
    let index = 0;
    const frames: { now: number; w: number }[] = [];
    for (let now = 0; now <= end(long); now += 1000 / 60) {
      while (index + 1 < cues.length && cues[index + 1].t <= now) index++;
      const out = p.update({ cues, now, index }, true, 1 / 60);
      frames.push({ now, w: out.squintL });
      corner = Math.max(corner, out.mouthCornerL);
    }
    expect(Math.max(...frames.filter((f) => f.now < 1500).map((f) => f.w))).toBeGreaterThan(0.07);
    expect(Math.max(...frames.filter((f) => f.now > 3500).map((f) => f.w))).toBe(0);
    p.closeTurn();
    const tail = [];
    for (let k = 0; k < 60; k++) tail.push(p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60).squintL);
    expect(Math.max(...tail)).toBeGreaterThan(0.07);
    expect(corner).toBeGreaterThan(0.15);
  });

  it("holds its smile as the floor passes, and smiles with an acknowledgement but not every one", () => {
    const p = new SpeechProsody();
    const FRAME = 1000 / 60;
    const run = (ms: number) => {
      const out: Frame[] = [];
      for (let k = 0; k < Math.round(ms / FRAME); k++) out.push(p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60) as Frame);
      return out;
    };
    const at = (frames: Frame[], ms: number) => frames[Math.round(ms / FRAME) - 1].mouthCornerL;
    p.closeTurn();
    const close = run(4000);
    expect(at(close, 2500)).toBeGreaterThan(0.3);
    expect(at(close, 4000)).toBe(0);
    p.acknowledge();
    const ack = run(2100);
    expect(Math.max(...ack.map((f) => f.mouthCornerL))).toBeGreaterThan(0.25);
    // Still up when a 720 ms continuer nod is long over.
    expect(at(ack, 1500)).toBeGreaterThan(0.1);
    expect(at(ack, 2100)).toBe(0);
    // 2.1 s after the last smiling one: a nod without a smile.
    p.acknowledge();
    expect(Math.max(...run(1000).map((f) => f.mouthCornerL))).toBe(0);
    run(1000);
    p.acknowledge();
    expect(Math.max(...run(1000).map((f) => f.mouthCornerL))).toBeGreaterThan(0.25);
  });

  it("smiles as the floor comes back, fades to neutral, and lets a flapping state pass", () => {
    // The owner's shape, 2026-09-21: *"right after you get to listening state
    // and then fade out from the smile slowly to neutral"* — with the rest
    // period that is the answer to the same sentence's "always smiling is a
    // problem". The mixer fires this from the state change; here it is the
    // episode on its own.
    const p = new SpeechProsody();
    const FRAME = 1000 / 60;
    const run = (ms: number) => {
      const out: Frame[] = [];
      for (let k = 0; k < Math.round(ms / FRAME); k++) out.push(p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60) as Frame);
      return out;
    };
    const at = (frames: Frame[], ms: number) => frames[Math.round(ms / FRAME) - 1].mouthCornerL;
    const REST = 0.005; // the floor an exponential decays into, not zero

    p.listen();
    const take = run(6200);
    expect(at(take, 500)).toBeGreaterThan(0.25);      // there before a sentence could be
    expect(at(take, 2200)).toBeGreaterThan(0.29);     // still at full height
    expect(at(take, 4000)).toBeGreaterThan(0.1);      // and then a fade, not a drop
    expect(at(take, 4000)).toBeLessThan(0.29);
    expect(at(take, 6200)).toBeLessThan(REST);

    // A call that goes back through LISTENING inside the rest period — a
    // barge-in and a resume, a trip through THINKING — does not re-arm it.
    p.listen();
    expect(Math.max(...run(1000).map((f) => f.mouthCornerL))).toBeLessThan(REST);

    // Past it, the next handover is a handover again.
    run(1000);
    p.listen();
    expect(Math.max(...run(1000).map((f) => f.mouthCornerL))).toBeGreaterThan(0.25);
  });

  it("keeps the closing smile when the floor passes straight to the user", () => {
    // The ordinary handover: the track ends, `closeTurn` smiles, and LISTENING
    // arrives a few hundred ms later. That is one smile — the one already on —
    // and not a longer one, which is what the shared rest period buys.
    const p = new SpeechProsody();
    const FRAME = 1000 / 60;
    const run = (ms: number) => {
      const out: Frame[] = [];
      for (let k = 0; k < Math.round(ms / FRAME); k++) out.push(p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60) as Frame);
      return out;
    };
    const at = (frames: Frame[], ms: number) => frames[Math.round(ms / FRAME) - 1].mouthCornerL;

    p.closeTurn();
    run(300);
    p.listen();
    const take = run(4500);
    expect(at(take, 2000)).toBeGreaterThan(0.3);   // `close`'s own height
    expect(at(take, 4200)).toBeLessThan(0.005);    // and `close`'s own ending
  });

  it("drops its smile when it is cut off", () => {
    const p = new SpeechProsody();
    p.closeTurn();
    for (let k = 0; k < 30; k++) p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60);
    p.cool();
    expect(p.update({ cues: [], now: 0, index: 0 }, false, 1 / 60).mouthCornerL).toBe(0);
  });

  it("does nothing while a clip owns the gesture, and never writes the mouth's articulation", () => {
    const a = phrase(0, 3);
    const pause = { t: end(a) - 110, v: "X" };
    const b = phrase(pause.t + 600, 3);
    const frames = play([...a, pause, ...b], { active: false });
    expect(frames.every((f) => !f.blink && PROSODY_CHANNELS.every((c) => f[c] === 0))).toBe(true);
    expect(PROSODY_CHANNELS.filter((c) => /^mouth(?!Corner)|jaw|teeth|tongue/.test(c))).toEqual([]);
  });
});
