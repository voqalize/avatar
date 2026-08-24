// ---------------------------------------------------------------------------
// src/live.js — the face, evaluated at runtime instead of blended from poses.
//
// Everything else in src/ plays a rig back: `rig.evaluate(weights)` blends
// baked geometry, and the only opinions in the runtime are how to interpolate
// and when to snap. This file is the one exception, and it exists because of a
// measurement rather than a preference.
//
// WHY. voqalize's mixer hands a renderer 30 continuous channels — a mouth that
// is 0.37 open and 0.62 wide with the left corner up — sixty times a second.
// Our rigs answer that with poses, and a pose set can only reach the points it
// was baked at plus the straight lines between them. The linearity spike
// (scratchpad parts/linearity/report.md) baked the nine Rhubarb letters and
// then asked how close a weighted blend of them gets to the real face at
// in-between channel values. The geometry is close but not identical (worst
// mouth vertex 9.7 px at 1x), and the ALPHA ramps are categorically wrong:
// `seam` off by 0.848, `teeth` by 0.612. Two poses at half weight each show
// half a set of teeth THROUGH the lip — the grey-teeth artefact anyone who has
// scrubbed the intensity slider on this rig has seen. Alpha is where a blend
// of two shapes stops being a shape.
//
// So: re-run the builder. `avatars/round/face.mjs` is the pure half of that
// avatar's generator — parameters, palette, landmarks, shape tables, both
// parts, `buildDraws` — and it is pure precisely so a browser can import it.
// This module calls it once per frame with the channels the mixer sent and
// writes the result over the evaluated display list. 60 us a frame at the time
// of writing, which is under 4% of a 16 ms budget.
//
// WHAT IT DOES NOT DO. It does not replace `rig.evaluate`: it calls it. Poses
// still own everything live geometry does not — the iris hue ladder (paint,
// which no channel of ours moves), the wardrobe's bitmap layers, any track a
// host still has running. Live draws are overwritten AFTER that blend, and
// only their `cmds` and `a`; paint, clip, blend mode and matrix come out of
// the normal path untouched. Nothing in rig.js, render2d.js or drivers.js
// changed to make this work.
//
// THE CONTRACT WITH rig.js, in three lines, because they are subtle:
//   * write into `d._cmds`, never into `d.cmds` — the latter may be pointing
//     at a POSE's array after a topology snap, and writing there corrupts the
//     pose for every future frame.
//   * set `d.gen = rig.frame` or render2d's Path2D cache serves last frame's
//     shape, and `d._geoDirty = true` or `restore` never puts the base back.
//   * `rig.dirty.add(i)` for every draw touched. `evaluate` restores what is
//     in that set and nothing else, so a draw we wrote and did not register
//     accumulates our writes forever.
//
// THE PERSONA RULE. A live face MUST be built from the same persona the rig
// was baked from, or every vertex belongs to a different character — a wider
// brow, a heavier lash, a different iris solve. The persona is not derivable
// from the JSON, so it is baked into `meta.live.persona` by the generator and
// read back here. `opts.persona` overrides it, which is only ever right if you
// are deliberately drawing somebody else.
// ---------------------------------------------------------------------------

import { MORPH_AXES } from './vocab.js';

// The six identity axes as the driver names them, against the control channel
// each one spends. The poses are `morph/<axis>_100` / `_-100` and drivers.js
// sends a weight for one of the pair; live geometry has to read the same dial
// or a morph slider moves the baked half of the face and not the live half.
// The order is MORPH_AXES', so this is a lookup rather than a second list.
const MORPH_CHANNEL = { head: 'headW', lips: 'lipFull', nose: 'noseW', brows: 'browH', eyes: 'eyeSize', distance: 'eyeSpace' };

// A 2x3 affine compose, same convention and same six numbers as render2d's.
// Duplicated rather than exported from there: this file may not modify the
// three runtime modules, and six lines of arithmetic is a cheaper coupling
// than a new export in a file that is under a byte-identity gate.
const mul = (A, B, o) => {
  const a = A[0] * B[0] + A[2] * B[1];
  const b = A[1] * B[0] + A[3] * B[1];
  const c = A[0] * B[2] + A[2] * B[3];
  const d = A[1] * B[2] + A[3] * B[3];
  const e = A[0] * B[4] + A[2] * B[5] + A[4];
  const f = A[1] * B[4] + A[3] * B[5] + A[5];
  o[0] = a; o[1] = b; o[2] = c; o[3] = d; o[4] = e; o[5] = f;
};

const num = (v, d) => (typeof v === 'number' && v === v ? v : d);

// ---------------------------------------------------------------------------
// THE CHANNEL MAP. 30 in, one control vector out. Everything here is a rename
// except the head block, and the renames are 1:1 because both ends were
// written against the same table (author/parts/{mouth,eye}.mjs headers quote
// voqalize's params.js line by line, ranges included). In particular
// `mouthCornerL/R` are NOT rescaled: our channel is the same -1.4..1.4
// expression scalar, spent at MAP.CORNER_PX = 32 px per unit at the corner.
//
// SIDEDNESS. voqalize draws `lidL` at `CX - EYE.dx` (face-peep.js:736), i.e.
// the VIEWER's left. This rig's `side < 0` is the viewer's left, wears the
// `L` slot suffix and reads `c.eyeL` through `eyeSide(c, side)`. So L is L and
// R is R with no flip. `pupilX/Y` are shared and unmirrored on both sides,
// which is what makes a pair of eyes look at one point instead of crossing.
//
// PART-LOCAL CHANNELS STAY AT REST. `tongueUp`, `curveUp` and `outerDroop`
// are this rig's own inventions; no mixer channel means them and inferring
// them (a closed happy eye implies a curve) would be this file quietly
// authoring expression on top of a pose it was handed. The eye STATES bake
// those; the live path leaves them where `face.ctrl()` put them.
//
// …WITH ONE EXCEPTION, AND IT IS NOT INFERENCE. `cheekRaise` is the one
// part-local channel that is not an opinion about what the pose MEANS: it is
// where the mesh has to move for the pose it was already sent to be drawable.
// `squint` is defined as the lower lid raised — and the thing that raises a
// lower lid is a cheek, so a squint whose cheek does not move reads as the lid
// having been trimmed rather than lifted (author/parts/eye.mjs says the same
// thing about `squintShade`). A lifted mouth corner is the same fact from the
// other end: the corner is pulled by zygomaticus, which passes over the cheek.
// So the cheek follows both, at less than either, and nothing here decides
// that a smile is HAPPY or that a lifted corner means anything at all. An
// explicit `controls.cheekRaise` still wins, because `controls` is folded in
// after this runs.
//
// THE TRUNK. `torsoLean`, `shoulderL`, `shoulderR` and `torsoTurn` were
// ignored here until now, on the grounds that this character's body is two
// flat shapes with no arm and no shoulder landmark. That was the wrong reason:
// voqalize's own peep has no arm either, and it spends all four — because none
// of them needs one. A lean is a change of SCALE (a figure that leans toward a
// webcam gets bigger, and that is nearly all of what the viewer sees); a shrug
// is the torso translating up; a one-sided shrug is the same shape rotated a
// degree and a half about the sternum, which is exactly what you get when the
// torso is one filled path. So the four are spent the way `poseTransforms`
// spends them, with each avatar's own travels in `face.mjs BODY_LIVE`, and the
// state that made this visible — STRAINING, which is voqalize's `CANT_HEAR`
// and holds `torsoLean` at 0.70 — leans in instead of standing straight.
//
// AND THE TRUNK'S SHARE OF THE HEAD'S OWN CHANNELS, which is the rest of what
// `poseTransforms` does and was left out the first time round. Three things,
// all peep's and all converted rather than re-tuned:
//
//   * a YAW PARALLAX. peep's body layer sits at `parallax 0.1` against a head
//     at 1.0, so a head turn drags the trunk a tenth as far. That is on top of
//     `torsoTurn`, which the mixer retargets to `headYaw*0.45` on a much
//     slower tau: the parallax is the part of the trunk's answer that is
//     instant, `torsoTurn` is the part that lags.
//   * a ROLL, about the SAME pivot the head rolls about, at peep's
//     `ROLL_TORSO/ROLL_HEAD` = 1.5/5.5 of the head's angle. A head tips and
//     the shoulders under it tip a little, or the neck reads as a hinge.
//   * BREATH AS A SWELL rather than a slide — see the block that builds it.
//
// `breath` IS spent, on the same cycle the `breathing` track drives — a host
// that sends `breath` should stop that track or the two add up.
// ---------------------------------------------------------------------------

function writeChannels(c, pose, HL) {
  const m = c.mouth;
  m.open = num(pose.mouthOpen, m.open);
  m.width = num(pose.mouthWidth, m.width);
  m.round = num(pose.mouthRound, m.round);
  m.press = num(pose.mouthPress, m.press);
  m.tuck = num(pose.mouthTuck, m.tuck);
  m.cornerL = num(pose.mouthCornerL, m.cornerL);
  m.cornerR = num(pose.mouthCornerR, m.cornerR);
  m.teeth = num(pose.teethUpper, m.teeth);
  m.tongue = num(pose.tongue, m.tongue);
  c.jaw = num(pose.jaw, c.jaw);

  // Shared gaze on `eye`, everything else per side on `eyeL`/`eyeR`. The two
  // side blocks are written in full rather than patched, so a channel that
  // goes back to rest actually goes back to rest.
  const e = c.eye;
  e.pupilX = num(pose.pupilX, e.pupilX);
  e.pupilY = num(pose.pupilY, e.pupilY);
  const L = c.eyeL, R = c.eyeR;
  L.lid = num(pose.lidL, e.lid); R.lid = num(pose.lidR, e.lid);
  L.squint = num(pose.squintL, e.squint); R.squint = num(pose.squintR, e.squint);
  L.browRaise = num(pose.browRaiseL, e.browRaise); R.browRaise = num(pose.browRaiseR, e.browRaise);
  L.browAngle = num(pose.browAngleL, e.browAngle); R.browAngle = num(pose.browAngleR, e.browAngle);
  L.browInner = num(pose.browInnerL, e.browInner); R.browInner = num(pose.browInnerR, e.browInner);

  // The cheek. Zero at rest — `face.ctrl()`'s own value — and both terms are
  // one-sided: a NEGATIVE corner (a frown) does not push a cheek up, and a
  // negative squint (a lid pushed down, which the range allows) does not
  // either. Coefficients under 1 because the cheek is downstream of both and
  // moves less than the thing pulling it; the avatars spend it at 13 px
  // (round) and 12 px (ink) of mesh at 1.0.
  c.cheekRaise = Math.max(0, Math.min(1,
    0.55 * ((L.squint + R.squint) / 2) + 0.45 * Math.max(0, (m.cornerL + m.cornerR) / 2)));

  // The head block is not geometry: this rig has no head poses and never had
  // any — head motion has always been six numbers written onto every head
  // draw's matrix (author/rig.mjs, headMatFactory). So the four channels that
  // move the head become exactly that matrix, in the same units the tracks are
  // keyed in. `HEAD_LIVE` in face.mjs is where those units live, because how
  // far a head turns is the character's business and not this file's.
  const yaw = num(pose.headYaw, 0), pitch = num(pose.headPitch, 0);
  const roll = num(pose.headRoll, 0), breath = num(pose.breath, 0);
  //
  // The trunk is four more, and they are NOT geometry either: same story, one
  // matrix down. `shrug` and `tilt` are the mean and the half-difference of
  // the two shoulders, which is voqalize's decomposition (face-core.js) and
  // the only one a single filled torso can draw.
  const shL = num(pose.shoulderL, 0), shR = num(pose.shoulderR, 0);
  return {
    deg: roll * HL.rollDeg,
    tx: yaw * HL.yawPx,
    ty: pitch * HL.pitchPx,
    // The three channels the TRUNK reads raw, because what it does with them
    // is a fraction of what the head does and the fraction is `BODY_LIVE`'s
    // to state: `yaw` is a parallax, `roll` a shallower roll about the same
    // pivot, `breath` a swell about the hem.
    yaw, roll, breath,
    lean: num(pose.torsoLean, 0),
    turn: num(pose.torsoTurn, 0),
    shrug: (shL + shR) / 2,
    tilt: (shR - shL) / 2,
  };
}

// The channel vector at rest, as a plain object — what a host that has no
// mixer yet (the player's live panel) initialises its sliders from, and what
// `apply({})` is equivalent to.
export const REST_POSE = Object.freeze({
  mouthOpen: 0.02, mouthWidth: 0.42, mouthRound: 0.10, mouthPress: 0.15, mouthTuck: 0,
  mouthCornerL: 0, mouthCornerR: 0, teethUpper: 0, tongue: 0, jaw: 0,
  lidL: 0.12, lidR: 0.12, squintL: 0, squintR: 0, pupilX: 0, pupilY: 0.05,
  browRaiseL: 0, browRaiseR: 0, browAngleL: 0, browAngleR: 0, browInnerL: 0, browInnerR: 0,
  headYaw: 0, headPitch: 0, headRoll: 0, breath: 0,
  shoulderL: 0, shoulderR: 0, torsoLean: 0, torsoTurn: 0,
});

export const LIVE_CHANNELS = Object.keys(REST_POSE);

// ---------------------------------------------------------------------------
// createLive(rig, face, opts) -> { apply, destroy, ... }
//
//   rig    a loaded Rig whose `meta.live` says it can do this
//   face   the MODULE `meta.live.face` names, imported by the host (a rig
//          cannot import; only the host knows where it is serving from)
//   opts   { persona } to override the baked one
//
// `apply(pose, weights, controls, hand)` is the whole of the API:
//   pose      the 30 channels, already smoothed and clamped by the mixer
//   weights   the pose weights this frame, exactly as you would have passed
//             them to `rig.evaluate` — live calls it for you, because the
//             order matters and owning it here is one less rule for a host
//   controls  extra control-vector fields (identity morphs, mostly) to fold
//             in. The six `morph/*` weights are picked up automatically, so
//             this is only for a host that drives morphs some other way.
//   hand      voqalize's `HandFrame` — `{ gesture, progress, side }` — or
//             nothing. OPTIONAL at both ends: a rig whose face has no hand
//             ignores it, and a face that has one draws nothing without it.
//             The mixer owns the clock; `progress` is the only thing that
//             crosses this seam, and it is clamped here because a host that
//             overshoots its own duration should get a parked hand rather
//             than a sampled table read off the end.
// ---------------------------------------------------------------------------

export function createLive(rig, face, opts = {}) {
  const meta = rig.meta && rig.meta.live;
  if (!meta) throw new Error('createLive: this rig has no meta.live');
  const persona = opts.persona || meta.persona || {};
  const kit = face.makeKit(persona);
  // THE REST RULE, the persona rule's other half. A face with a `sex` axis is
  // BUILT at a rest vector of its own (face.mjs SEX_GEO / ctrlFor), so live
  // evaluation has to start from the same one or a male rig would animate off
  // a woman's skull and every frame would fight the baked rest. Families that
  // have no sex axis do not export `ctrlFor`, and `face.ctrl` is the answer.
  const mkCtrl = face.ctrlFor ? face.ctrlFor(persona) : face.ctrl;
  // This persona's baseline for the six morph sliders. They are an EXCURSION
  // from it, not an absolute channel value — otherwise a slider at 0 would
  // reset a male rig's browH/headW to the family neutral and rest would stop
  // matching the baked face. author/finish.mjs writes the baked pair the same
  // way. All-zero for a family with no sex axis, so nothing else changes.
  const REST_C = mkCtrl();
  const HL = face.HEAD_LIVE;

  // slot -> draw index, over the FINISHED rig: a dressed variant has bitmap
  // layers inserted into the middle of the list, so every index shifts and
  // nothing but the slot name survives the wardrobe. Which is why this looks
  // the draws up by name rather than baking a table at finish time.
  const idx = new Map();
  rig.data.draws.forEach((d, i) => { if (d.slot != null && !idx.has(d.slot)) idx.set(d.slot, i); });

  // What the face draws at rest, used three ways: to resolve slot -> index
  // once, to check that the runtime's topology matches the baked one, and to
  // spot the draws a wardrobe has hidden.
  const restDraws = face.buildDraws(mkCtrl(), kit);
  const own = [];       // [drawIndex, buildIndex] pairs, in draw order
  const hidden = [];
  restDraws.forEach((s, j) => {
    const i = idx.get(s.slot);
    if (i === undefined) throw new Error(`createLive: the rig has no draw "${s.slot}" — face.mjs and this rig were built from different code`);
    const b = rig.base[i];
    if (!b.cmds || b.cmds.length !== s.cmds.length) {
      throw new Error(`createLive: draw "${s.slot}" has ${b.cmds ? b.cmds.length : 0} opcodes baked and ${s.cmds.length} live`);
    }
    // A draw the sidecar hid is at alpha 0 in the rig and non-zero in the
    // builder, because the builder has never heard of the wardrobe. Anything
    // that is zero at rest in BOTH (teeth, tongue, the squint shadows) is a
    // channel waiting to be spent and is very much ours to write.
    if (b.a === 0 && s.a > 0) { hidden.push(s.slot); return; }
    own.push(i, j);
  });

  // Head and body, for the head matrix. Body is `meta.live.body`, the slots
  // the generator's own head matrix exempts, plus any wardrobe layer riding
  // one of them; everything else in the rig — including the bitmap hair and
  // the glasses, which follow `face` — turns with the head.
  const bodySlots = new Set(meta.body || []);
  // ...and the HAND, which is on neither. `meta.live.hand.slots` is the third
  // group: a secondary-gesture hand (author/parts/hand.mjs) is not on the
  // character at all, it is the nearest object in the FRAME, placed by the
  // camera window's own numbers. A head that turns must not carry it round and
  // a breath must not lift it, so it is excluded from both lists rather than
  // falling into `head` by default. A rig without a hand has an empty set here
  // and the split is the one it always was.
  const handSlots = new Set((meta.hand && meta.hand.slots) || []);
  const head = [], body = [];
  rig.data.draws.forEach((d, i) => {
    if (handSlots.has(d.slot)) return;
    (bodySlots.has(d.slot) ? body : head).push(i);
  });

  // One control vector, mutated in place forever. `mkCtrl()` clones a nested
  // rest object through JSON, which is not something to do 60 times a second,
  // and `buildDraws` never writes to what it is given.
  const c = mkCtrl();
  const M = new Float32Array(6);
  const T = new Float32Array(6);
  const B = new Float32Array(6);
  // Two more scratch matrices for the trunk. They are folded into `T` before
  // anything is written to a draw, so the per-draw cost is still one compose.
  const S = new Float32Array(6);
  const D = new Float32Array(6);
  // The trunk's travels, or nothing. A face that predates `BODY_LIVE` (facet,
  // which has no `meta.live` at all, is the only one in the tree) keeps the
  // behaviour it had: the four body channels arrive and are dropped.
  const BL = face.BODY_LIVE || null;
  let alive = true;

  const touched = new Set();
  for (let k = 0; k < own.length; k += 2) touched.add(own[k]);

  function apply(pose = REST_POSE, weights = {}, controls = null, hand = null) {
    if (!alive) throw new Error('createLive: apply() after destroy()');
    const H = writeChannels(c, pose, HL);

    // The hand block, guarded by the face having one rather than by the rig's
    // meta: `c.hand` exists exactly when this character can gesture. Written
    // in full every frame, so a gesture that ends actually ends, and an
    // unknown name lands as `null` — which the part draws as no hand.
    if (c.hand) {
      c.hand.gesture = hand && typeof hand.gesture === 'string' ? hand.gesture : null;
      c.hand.progress = hand ? Math.min(Math.max(num(hand.progress, 0), 0), 1) : 0;
      c.hand.side = hand && hand.side === 'left' ? 'left' : 'right';
    }

    // Identity morphs off the pose weights, so the player's morph sliders
    // move the live face and the baked one together. drivers.js sends one of
    // each +/-100 pair; taking the difference costs nothing and is right even
    // if some future host sends both.
    for (const axis of MORPH_AXES) {
      const ch = MORPH_CHANNEL[axis];
      c[ch] = (REST_C[ch] || 0)
        + (weights[`morph/${axis}_100`] || 0) - (weights[`morph/${axis}_-100`] || 0);
    }
    if (controls) for (const k of Object.keys(controls)) {
      const v = controls[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(c[k], v);
      else c[k] = v;
    }

    const out = rig.evaluate(weights);

    // ---- the live half of the display list -------------------------------
    const dl = face.buildDraws(c, kit);
    const frame = rig.frame;
    for (let k = 0; k < own.length; k += 2) {
      const d = out[own[k]], s = dl[own[k + 1]];
      d.cmds = d._cmds;
      d._cmds.set(s.cmds);
      d.a = s.a;
      d.gen = frame;
      d._geoDirty = true;
      rig.dirty.add(own[k]);
    }

    // ---- breath ----------------------------------------------------------
    // A SWELL, not a slide. peep's own note is the argument: a rigid vertical
    // bob of the whole shirt "moved the hem — and the hem is the one part of a
    // seated torso that does not move, so the result read as the figure being
    // nudged up and down rather than as breath" (face-core.js). So the torso
    // SCALES about its hem, which raises the shoulder line and widens the
    // chest, and the head then rides the displacement that scale produces AT
    // THE NECK PIVOT. That lift is arithmetic and not a second tuned number:
    // author one swell and the two layers cannot drift apart. A face with no
    // `breathSwell` keeps the flat pair of translates it was keyed with.
    const swell = BL && BL.breathSwell ? H.breath * BL.breathSwell : 0;
    const bodyTy = swell ? 0 : H.breath * HL.breathBodyTy;
    const headTy = H.ty + (swell
      ? -swell * (BL.swellPivot[1] - HL.pivot[1])
      : H.breath * HL.breathTy);

    // ---- and the head it is on -------------------------------------------
    if (H.deg || H.tx || headTy) {
      const r = (H.deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      const p = HL.pivot;
      M[0] = cs; M[1] = sn; M[2] = -sn; M[3] = cs;
      M[4] = p[0] - (cs * p[0] - sn * p[1]) + H.tx;
      M[5] = p[1] - (sn * p[0] + cs * p[1]) + headTy;
      // Composed onto whatever the blend produced rather than replacing it:
      // a bitmap layer's matrix is `head . fit` and a track may already have
      // turned the head, and both have to survive.
      for (let k = 0; k < head.length; k++) {
        const i = head[k];
        mul(M, out[i].m, out[i].m);
        rig.dirty.add(i); touched.add(i);
      }
    }
    if (!BL && bodyTy) {
      for (let k = 0; k < body.length; k++) {
        const i = body[k];
        out[i].m[5] += bodyTy;
        rig.dirty.add(i); touched.add(i);
      }
    }

    // ---- the torso --------------------------------------------------------
    // Torso only, which is `meta.live.body` — peep's `torsoLayers` is `['body']`
    // and nothing above its collar sees any of this. Composed OUTSIDE the head
    // matrix, so a head that has already turned is carried by the torso rather
    // than fighting it. peep writes the same product as a transform list:
    //
    //   torsoT( turn, shrug, tilt, swell ) · translate(parallax) · rotate(roll)
    //
    // and the two halves stay in that order here. The whole product is folded
    // into `T` first, so however many pieces are live a body draw still pays
    // exactly one 2x3 compose.
    const rollT = BL ? H.roll * (BL.rollDeg || 0) : 0;
    const yawT = BL ? H.yaw * (BL.yawPx || 0) : 0;
    if (BL && (H.turn || H.shrug || H.tilt || swell || rollT || yawT || bodyTy)) {
      const r = (-H.tilt * BL.shrugTiltDeg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      const q = BL.shrugPivot;
      T[0] = cs; T[1] = sn; T[2] = -sn; T[3] = cs;
      T[4] = q[0] - (cs * q[0] - sn * q[1]) + H.turn * BL.turnPx;
      T[5] = q[1] - (sn * q[0] + cs * q[1]) - H.shrug * BL.shrugLift + bodyTy;
      if (swell) {
        const g = 1 + swell, h = BL.swellPivot;
        S[0] = g; S[1] = 0; S[2] = 0; S[3] = g;
        S[4] = h[0] - g * h[0]; S[5] = h[1] - g * h[1];
        mul(T, S, T);
      }
      // The trunk's share of the head's own two channels: ~10% of the yaw as
      // parallax, and a roll about the SAME pivot the head rolls about, at a
      // fraction of the angle. Both are peep's, and both are inside the shrug
      // and the swell for the same reason they are in peep — they belong to
      // the trunk's own pose, not to what the shoulders are doing to it.
      if (rollT || yawT) {
        const rr = (rollT * Math.PI) / 180, c2 = Math.cos(rr), s2 = Math.sin(rr);
        const p = HL.pivot;
        D[0] = c2; D[1] = s2; D[2] = -s2; D[3] = c2;
        D[4] = p[0] - (c2 * p[0] - s2 * p[1]) + yawT;
        D[5] = p[1] - (s2 * p[0] + c2 * p[1]);
        mul(T, D, T);
      }
      for (let k = 0; k < body.length; k++) {
        const i = body[k];
        mul(T, out[i].m, out[i].m);
        rig.dirty.add(i); touched.add(i);
      }
    }

    // ---- and the lean, which the whole figure takes ----------------------
    // Head AND body, in that order and outermost of everything, because peep
    // prefixes its lean transform to every layer it draws. The hand is on
    // neither list and stays out of it: a secondary-gesture hand is the
    // nearest object in the FRAME rather than a limb of this character, and
    // voqalize's hand overlay reads no body channel either.
    if (BL && H.lean) {
      const sc = 1 + H.lean * BL.leanScale;
      const q = BL.leanPivot;
      B[0] = sc; B[1] = 0; B[2] = 0; B[3] = sc;
      B[4] = q[0] - sc * q[0];
      B[5] = q[1] - sc * q[1] + H.lean * BL.leanTravel;
      for (let k = 0; k < head.length; k++) {
        const i = head[k];
        mul(B, out[i].m, out[i].m);
        rig.dirty.add(i); touched.add(i);
      }
      for (let k = 0; k < body.length; k++) {
        const i = body[k];
        mul(B, out[i].m, out[i].m);
        rig.dirty.add(i); touched.add(i);
      }
    }
    return out;
  }

  // Hand the rig back. Everything live ever wrote is registered dirty, so the
  // next `rig.evaluate` restores it; a host that stops driving live and keeps
  // playing gets the baked face back on the following frame.
  function destroy() {
    alive = false;
    for (const i of touched) rig.dirty.add(i);
  }

  return {
    apply,
    destroy,
    // Diagnostics, and what the player's live panel reads.
    rest: REST_POSE,
    channels: LIVE_CHANNELS,
    persona,
    // Draw indices this evaluator owns, and the slots a wardrobe took off it.
    draws: own.filter((_, k) => k % 2 === 0),
    hidden,
  };
}
