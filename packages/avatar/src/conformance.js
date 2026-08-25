/**
 * The rig conformance sweep — the assertions, with no page around them.
 *
 * Drives every state, emotion, gaze and semantic action through every rig you
 * hand it, then a viseme track, and asserts the mixer keeps producing finite,
 * in-range parameters and a still-attached drawing. A NaN anywhere in the chain
 * shows up as a *frozen face*, which is exactly the defect the eye is worst at
 * catching: a still avatar looks calm, not broken.
 *
 * This is the numeric half of judging a rig, and it is the smaller half —
 * passing here says a change did not break the mixer, never that it looks good
 * (CLAUDE.md § Verifying). It is also what a face author runs against a new
 * drawing before anyone is asked to look at it.
 *
 * `advance` is the seam that lets one copy of the sweep serve both callers:
 * `apps/authoring/rig-check.html` lets real time pass and watches it happen, while
 * `packages/avatar/test/conformance.test.ts` steps `{manual: true}` avatars by a fixed
 * dt and finishes in milliseconds. The sweep's own clock is handed to `speak`
 * so the mouth articulates under both — a stepped avatar reading
 * `performance.now()` would sit on the first cue for the whole track.
 */
import {
  STATE_NAMES,
  EMOTION_NAMES,
  GAZE_NAMES,
  ACTION_IDS,
  checkHandFraming,
} from './avatar.js';
import { textToCues } from './visemes.js';

/** Parameters live in −1..1 by contract; 2 is the slack a gain may legally add. */
const PARAM_LIMIT = 2;

const realTime = (s) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * @param {Array<{name: string, avatar: object}>} rigs one entry per drawing
 * @param {{advance?: (seconds: number) => void|Promise<void>}} [opts]
 * @returns {Promise<{ok: boolean, problems: string[], summary: string}>}
 */
export async function conformanceSweep(rigs, { advance = realTime } = {}) {
  const problems = [];
  let ms = 0;
  const clock = () => ms;
  const tick = async (seconds) => { ms += seconds * 1000; await advance(seconds); };
  const all = (fn) => rigs.forEach((r) => fn(r.avatar, r.name));

  function check(label) {
    for (const r of rigs) {
      const p = r.avatar.params;
      for (const k in p) {
        if (!Number.isFinite(p[k])) problems.push(`${r.name} ${label}: ${k}=${p[k]}`);
        else if (Math.abs(p[k]) > PARAM_LIMIT) {
          problems.push(`${r.name} ${label}: ${k} out of range (${p[k].toFixed(2)})`);
        }
      }
      // A renderer-neutral rig has no svg to detach; the SVG one must stay put.
      if (r.avatar.svg && !r.avatar.svg.isConnected) problems.push(`${r.name} ${label}: svg detached`);
    }
  }

  for (const s of STATE_NAMES)   { all((k) => k.setState(s));      await tick(0.09); check(`state ${s}`); }
  for (const e of EMOTION_NAMES) { all((k) => k.setEmotion(e, 1)); await tick(0.09); check(`emotion ${e}`); }
  for (const g of GAZE_NAMES)    { all((k) => k.setGaze(g));       await tick(0.09); check(`gaze ${g}`); }
  for (const i of ACTION_IDS)    { all((k) => k.action(i));        await tick(0.18); check(`action ${i}`); }

  // The hand. Two things are being proved and only one of them is the mixer's.
  // Playing each gesture above checked the usual invariants — its face half runs
  // through the clip layer like any other interjection. checkHandFraming is the
  // one that matters per AVATAR: the hand places itself off META.viewBox, so a
  // rig with a different window could push ink through the camera edge or lift
  // the wrist into frame, and neither is visible in a resting still.
  for (const r of rigs) {
    if (!r.avatar.meta) continue;
    try { checkHandFraming(r.avatar.meta); } catch (e) { problems.push(`${r.name} ${e.message}`); }
  }
  all((k) => k.setState('LISTENING'));
  await tick(2);   // let the longest gesture leave frame before speech starts

  const cues = textToCues('okay, and what happened next');
  all((k) => k.speak({ cues, clock }));
  for (let i = 0; i < 12; i++) { await tick(0.12); check('speaking'); }
  all((k) => k.stopSpeaking().setState('LISTENING'));
  await tick(0.2); check('after speech');

  return {
    ok: problems.length === 0,
    problems,
    summary: `${rigs.length} rigs x ${STATE_NAMES.length} states, ${EMOTION_NAMES.length} emotions, `
      + `${GAZE_NAMES.length} gazes, ${ACTION_IDS.length} semantic actions `
      + `(framing asserted per avatar), plus a viseme track`,
  };
}

/**
 * A deterministic `advance` for `{manual: true}` avatars: fixed-dt stepping, no
 * wall clock, no rAF. Same rigs and same seed give the same numbers every run,
 * which is what makes a failure here reproducible rather than anecdotal.
 */
export function stepper(rigs, dt = 1 / 60) {
  return (seconds) => {
    for (let t = 0; t < seconds; t += dt) rigs.forEach((r) => r.avatar.step(dt));
  };
}

/**
 * Replace `Math.random` with a seeded LCG and return the undo.
 *
 * The sweep's assertions are invariants — they must hold for any draw — but a
 * failure you cannot reproduce is a failure you cannot fix, and idle, gaze
 * aversion and blink timing are all random. Call this *before* creating the
 * avatars: constructors draw their first phases immediately.
 */
export function seedRandom(seed = 1) {
  const original = Math.random;
  let s = seed >>> 0 || 1;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return () => { Math.random = original; };
}
