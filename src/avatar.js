/**
 * The avatar — a programmable talking head.
 *
 * The public surface. Everything the server drives goes through here:
 *
 *   avatar.setState('LISTENING', { emotion: 'warm' })
 *   avatar.setGaze('SCREEN_LEFT')
 *   avatar.speak({ audio, cues })        // cues are {t, v, i?} in ms
 *   avatar.pushCues(moreCues)            // streaming top-up
 *   avatar.interject('OKAY')
 *   avatar.gesture('HI')                 // a hand at the frame edge + its face
 *   avatar.perform(beats, { audio })     // timed {t, do, ...} verbs, same clock
 *   avatar.setUserSpeaking(bool)         // the user has the floor, so listening
 *                                        // is contingent instead of timed
 *
 * Per frame the mixer runs a fixed layer order. Earlier layers are overwritten
 * by later ones on the channels they touch; the gesture and idle layers are
 * additive so they compose rather than fight.
 *
 *   base pose (state + emotion)  ->  gaze  ->  visemes  ->  clip  ->  idle
 *
 * The one hard priority rule: while the server viseme track is playing, it owns
 * the mouth outright. An interjection firing mid-sentence contributes its head
 * and brows and its mouth track is dropped — otherwise the avatar would appear
 * to say two things at once.
 */

import { REST, CHANNELS, TAU, RANGE, GROUPS, clamp, approach } from './params.js';
import { createFace as createPeepFace, META as peepMeta } from './face-peep.js';
import { createFace as createWrenFace, META as wrenMeta } from './face-wren.js';
import { createFace as createMynaFace, META as mynaMeta } from './face-myna.js';
import { emotionPose } from './emotions.js';
import { GazeLayer, GAZE_TARGETS } from './gaze.js';
import { IdleLayer, ListeningEngine } from './idle.js';
import { ClipPlayer } from './clips.js';
import { INTERJECTIONS } from './interjections.js';
import { VisemeTrack, shapeFor, SILENT } from './visemes.js';
import { PerformTrack } from './perform.js';
import { createHand, HAND_GESTURES } from './hand.js';

// Each state's `idle` is a profile for the liveness layer (see DEFAULT_PROFILE
// in idle.js). Blink gaps come from docs/research-biomechanics.md §5: the rate
// alone separates listening (~16/min) from thinking (~25/min) from visually
// busy (~9/min), and it is the cheapest state signal the rig has.
export const STATES = {
  IDLE:               { gaze: 'USER',     emotion: 'neutral',    idle: { sway: 1.0 }, backchannel: false },
  LISTENING:          { gaze: 'USER',     emotion: 'neutral',    backchannel: true,
                        idle: { sway: 1.0, blinkGap: [3.1, 4.2] },
                        pose: { browRaiseL: 0.06, browRaiseR: 0.06, lidL: -0.04, lidR: -0.04 } },
  // Faster, shallower breath is the measured cognitive-load signature, and the
  // occasional dead-still hold is the strongest "working on it" cue a rig this
  // simple can make — deliberate stillness, not more motion. The aversion
  // leads DOWN (39% of measured cognitive aversions, §4.2) and wanders on the
  // ~3.5s cognitive-aversion cadence, coming back to the user roughly one
  // dwell in four — still with you, working.
  THINKING:           { gaze: 'AWAY_DOWN', emotion: 'thoughtful', backchannel: false,
                        idle: { sway: 0.7, blinkGap: [2.1, 2.7], breathRate: 1.18, breathAmp: 0.7,
                                hold: { every: [4.5, 9.0], dur: [0.8, 1.5] } },
                        wander: { targets: ['AWAY_DOWN', 'AWAY_DOWN', 'AWAY_THINKING', 'USER'],
                                  every: [2.6, 4.4] } },
  SPEAKING:           { gaze: 'USER',     emotion: 'neutral',    idle: { sway: 0.55 }, backchannel: false },
  REVIEWING_SCREEN:   { gaze: 'SCREEN_CENTER', emotion: 'thoughtful', backchannel: false,
                        idle: { sway: 0.8, blinkGap: [4.0, 6.5] },
                        wander: { targets: ['SCREEN_CENTER', 'SCREEN_LEFT', 'SCREEN_RIGHT', 'SCREEN_TOP', 'SCREEN_WORK'],
                                  every: [1.8, 5.0] } },
  // The head cant is the state's signature cue, and it has to clear the roll
  // multiplier to exist at all: 0.05 here renders as 0.3° of rotation, which
  // is no tilt whatever the number says. 0.30 renders ~1.7° — visible at tile
  // size, still gentle. Every other channel in this pose read fine on screen.
  WAITING_FOR_USER: { gaze: 'USER',     emotion: 'encouraging', backchannel: true,
                        idle: { sway: 1.0, blinkGap: [3.1, 4.2] },
                        pose: { headRoll: 0.30, browRaiseL: 0.16, browRaiseR: 0.12 } },
  // Straining to hear. The one state where the amplitude constraint yields,
  // because the lean IS the message: torsoLean well past LISTENING's
  // engagement ceiling (+0.16), head cheated aside on USER_EAR so an ear
  // favors the speaker while the eyes hold contact, and a concentration
  // squint with knit brows. Stillness does the rest — straining people
  // freeze — so holds are frequent and there are NO backchannels: you don't
  // nod along to what you can't hear. Server sends it on soft/low-SNR user
  // audio, typically followed by SORRY or a "could you repeat" utterance.
  CANT_HEAR: {
    gaze: 'USER_EAR', emotion: 'neutral', backchannel: false,
    idle: { sway: 0.5, blinkGap: [4.5, 6.5],
            hold: { every: [2.5, 5.5], dur: [1.0, 1.8] } },
    // A minimal line face swallows small deltas — the ink moves whole units
    // or it doesn't move. These values are set from the contact sheet's
    // extremes row, not from what a fleshed rig would need: brows DOWN
    // (corrugator effort, not the browInner worry-lift), a real squint, and
    // the resting smile pressed flat — nobody smiles while straining to hear.
    pose: {
      torsoLean: 0.70, headPitch: 0.10,
      lidL: 0.12, lidR: 0.12, squintL: 0.75, squintR: 0.75,
      browRaiseL: -0.45, browRaiseR: -0.45, browInnerL: 0.15, browInnerR: 0.12,
      mouthPress: 0.45, mouthCornerL: -0.22, mouthCornerR: -0.22,
    },
  },
  // --- application state ---------------------------------------------------
  // "Momentarily busy on the thing you asked for." No hands in frame, so the
  // whole read comes from four cheap cues (docs/research-biomechanics.md §6.4):
  // gaze parked DOWN on a stable target, blinks suppressed to task-focus rate
  // (~9/min), shoulders slightly raised and *working* — the burst/pause rhythm
  // is what says activity rather than rocking — and, the important one, a
  // brief glance back up to the user every few seconds. The glance is the tell
  // that the user has not been forgotten; without it, busy is just absent.
  TYPING: {
    // SCREEN_WORK, not NOTES: on a steep down target the gaze layer's lid
    // follow seals the eyes, and at tile size shut eyes read as asleep, not
    // busy. A mild down-left with the head pitched into it keeps the iris in
    // the opening — eyes down but awake.
    gaze: 'SCREEN_WORK', emotion: 'neutral', backchannel: false,
    idle: { sway: 0.6, blinkGap: [6.0, 7.5], breathRate: 1.05,
            rhythm: { amp: 0.05, freq: 2.2 } },
    glance: { to: 'USER', every: [4, 7], hold: [0.7, 1.1] },
    pose: { headPitch: 0.10, lidL: -0.04, lidR: -0.04,
            shoulderL: 0.06, shoulderR: 0.06 },
  },
  // The audio channel is broken and the agent is typing in the chat window to
  // communicate — TYPING's mechanics turned *communicative*. The glance is
  // the difference: TYPING checks in briefly (~0.8 s) and goes back to work;
  // this looks up and HOLDS 1.2–2 s, expectant, because the chat (and the
  // user's face) is now the only channel there is. A touch of browInner
  // carries the apology. Relation to DEGRADED is by semantics, not merger:
  // DEGRADED says "my feed is broken", TYPING_CHAT says "I'm working around
  // it" — a server will typically sequence DEGRADED → TYPING_CHAT.
  TYPING_CHAT: {
    gaze: 'SCREEN_WORK', emotion: 'neutral', backchannel: false,
    idle: { sway: 0.6, blinkGap: [5.5, 7.0], breathRate: 1.05,
            rhythm: { amp: 0.055, freq: 2.5 } },
    glance: { to: 'USER', every: [3.2, 5.5], hold: [1.2, 2.0] },
    // Line-face scaled (see CANT_HEAR); the apology has to survive the rig's
    // baked resting smile, so the corners go clearly negative.
    pose: { headPitch: 0.10, lidL: -0.04, lidR: -0.04,
            shoulderL: 0.06, shoulderR: 0.06,
            browInnerL: 0.45, browInnerR: 0.38,
            mouthPress: 0.50, mouthCornerL: -0.28, mouthCornerR: -0.28 },
  },
  // Attention genuinely elsewhere. What separates this from TYPING is target
  // *stability* (§6.4): busy is one steady off-user target, distracted is
  // wandering ones, held long (aversion >3s), with no backchannels — the
  // missing nod is as diagnostic as the look-away. Sway is looser than
  // LISTENING because attention is what was holding the body still. The
  // widget only looks away; deciding when to snap back is the server's call.
  DISTRACTED: {
    gaze: 'AWAY_RIGHT', emotion: 'neutral', backchannel: false,
    idle: { sway: 1.15, blinkGap: [1.8, 4.2] },
    // Sideways and up, never steep-down: lateral is where real intimacy/
    // distraction aversions live, and a steep down target seals this rig's
    // eyes (see TYPING).
    wander: { targets: ['AWAY_RIGHT', 'AWAY_THINKING', 'SCREEN_LEFT', 'SCREEN_TOP'],
              every: [2.8, 6.8] },
  },
  // The buying-time move: hunting for a control on screen. Distinct from
  // REVIEWING_SCREEN by *hunt* quality — reading dwells (1.8–5 s) become
  // search saccades (0.8–2 s) with revisits (targets repeat in the wander
  // set), plus the idle layer's flick: the tiny "no, not this one" yaw
  // wiggle nobody makes while merely reading. Server semantics: a filler
  // while an async activity completes; the server exits it when done.
  SEARCHING_SCREEN: {
    gaze: 'SCREEN_CENTER', emotion: 'neutral', backchannel: false,
    idle: { sway: 0.65, blinkGap: [5.0, 6.8], breathRate: 1.05,
            flick: { amp: 0.30, every: [3.5, 7.0] } },
    wander: { targets: ['SCREEN_CENTER', 'SCREEN_LEFT', 'SCREEN_TOP', 'SCREEN_WORK',
                        'SCREEN_RIGHT', 'SCREEN_CENTER', 'SCREEN_LEFT'],
              every: [0.8, 2.0] },
    // Line-face scaled (see CANT_HEAR). Note the corners: peep's REST mouth
    // is drawn smiling, so "not smiling" is a clearly negative net corner,
    // not zero.
    pose: { squintL: 0.40, squintR: 0.40, mouthPress: 0.65,
            mouthCornerL: -0.25, mouthCornerR: -0.25, browRaiseL: -0.26, browRaiseR: -0.20 },
  },
  // --- floor management ----------------------------------------------------
  // Turn-taking is the part of a voice call that goes wrong most often: the
  // user either talks over the agent or sits in silence waiting for a signal
  // that never comes. These are states rather than clips because the floor is a
  // condition and not an event — WANTS_IN in particular has to hold for as long
  // as it takes the other person to notice it.
  //
  // All three lift the shoulders and part the lips, because that is what an
  // inbreath looks like from outside, and an inbreath is the cue humans actually
  // use to predict that someone is about to speak. The head comes *up* rather
  // than down: a lowered head is deferential and reads as yielding.
  TAKING_FLOOR: {
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.6 }, backchannel: false,
    pose: {
      browRaiseL: 0.26, browRaiseR: 0.22, lidL: -0.10, lidR: -0.10,
      headPitch: -0.10, torsoLean: 0.22, shoulderL: 0.30, shoulderR: 0.30,
      mouthOpen: 0.10, mouthPress: -0.10,
    },
  },
  // The one signal the rig had no way to give at all. An agent needs to be
  // able to say "I'd like to come in" without talking over the user, and
  // every part of this pose is doing that job: held still (idle is low on
  // purpose — stillness is what makes it read as intent rather than as fidget),
  // leaning in, lips apart and staying apart.
  WANTS_IN: {
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.45 }, backchannel: false,
    pose: {
      browRaiseL: 0.42, browRaiseR: 0.38, lidL: -0.14, lidR: -0.14,
      headPitch: -0.14, torsoLean: 0.42, shoulderL: 0.45, shoulderR: 0.45,
      mouthOpen: 0.16, mouthWidth: 0.30, mouthPress: -0.14,
    },
  },
  // Interrupted mid-word. The mouth shutting is the whole message, and it has to
  // happen faster than anything else on the face — see YIELD_FLOOR, which is
  // what actually delivers the snap.
  YIELDED: {
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.9 }, backchannel: false,
    pose: {
      browRaiseL: 0.10, browRaiseR: 0.08,
      torsoLean: -0.18, shoulderL: -0.12, shoulderR: -0.12,
    },
  },

  DEGRADED:           { gaze: 'USER',     emotion: 'neutral',    backchannel: false,
                        idle: { sway: 0.4, blinkGap: [4.0, 8.0] },
                        pose: { lidL: 0.3, lidR: 0.3 }, filter: 'grayscale(.55) brightness(.82)' },
  OFFLINE:            { gaze: 'USER',     emotion: 'neutral',    backchannel: false,
                        idle: { sway: 0.15, blinkGap: [9, 15] },
                        pose: { lidL: 0.95, lidR: 0.95, mouthCornerL: 0, mouthCornerR: 0 },
                        filter: 'grayscale(1) brightness(.6)' },
};

export const STATE_NAMES = Object.keys(STATES);

/**
 * The avatars this rig can wear: `{ create, meta }` records.
 *
 * `create` is `createFace(mount, theme) -> { svg, apply, theme, destroy }`,
 * callable standalone — the rig tooling drives faces with no mixer attached.
 * That behavioural contract is still the whole of what the *rig* needs:
 * everything else — visemes, emotions, gaze, idle, clips, the mixer — works
 * in parameter space and never learns which face it is driving.
 *
 * `meta` is the avatar descriptor (viewBox, mouthCrop — see META in any face
 * module): the things a HOST or a TOOL needs to frame a face without opening
 * it. This registry was once factories-only, on the argument that a schema
 * guessed from two faces would be wrong; the third face settled it. Every rig
 * needed exactly a framing rect and a mouth rect to stop the tooling from
 * hard-coding per-avatar tables, and nothing else — so that is all meta
 * carries.
 *
 * The key is the avatar's name, not its rank. It used to be possible to read
 * rank into it — the original rig was keyed `default`, which became a lie the
 * moment it stopped being the one we ship. DEFAULT_AVATAR below is the only
 * place the choice is made.
 *
 * Two earlier rigs, `classic` and `blue-shirt`, were removed on 2026-08-06:
 * stakeholders accepted the line-art pair and rejected both of the others, so
 * carrying them was maintenance against art nobody wanted. What they taught
 * the abstraction survives them — `face-core.js` exists because all three of
 * the first rigs wrote the same apply(), and META exists because all three
 * needed the same two rects. Their code is in git history if a lesson ever
 * needs re-reading.
 */
export const AVATARS = {
  peep: { create: createPeepFace, meta: peepMeta },
  wren: { create: createWrenFace, meta: wrenMeta },
  myna: { create: createMynaFace, meta: mynaMeta },
};

export const AVATAR_NAMES = Object.keys(AVATARS);

/** The avatar a host gets when it does not ask for one. */
export const DEFAULT_AVATAR = 'peep';

export function createAvatar(opts = {}) {
  const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
  if (!mount) throw new Error('createAvatar: mount element required');

  // `opts.avatar` names one from AVATARS; `opts.face` passes a factory directly,
  // so a host can supply an avatar the rig has never heard of. A bare factory
  // has no descriptor, so meta falls back to what the svg itself declares.
  const entry = opts.face ? { create: opts.face } : AVATARS[opts.avatar || DEFAULT_AVATAR];
  if (!entry) {
    throw new Error(`createAvatar: unknown avatar "${opts.avatar}" (have: ${AVATAR_NAMES.join(', ')})`);
  }
  const face = entry.create(mount, opts.theme);
  const meta = entry.meta || (() => {
    const vb = (face.svg.getAttribute('viewBox') || '0 0 1 1').split(/[\s,]+/).map(Number);
    return { viewBox: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } };
  })();
  const gaze = new GazeLayer();
  const idle = new IdleLayer();
  const speech = new VisemeTrack();

  let gazeOverrideByClip = null;
  const clip = new ClipPlayer({
    onGaze: (g) => { gazeOverrideByClip = g; applyGaze(); },
    onBlink: () => idle.blink(),
  });
  const backchannel = new ListeningEngine((id) => { interject(id); emit('backchannel', id); });
  const performTrack = new PerformTrack();
  // The hand is a sibling of the mixer, not a layer inside it: it writes SVG
  // directly rather than parameter channels, because a hand at the frame edge is
  // not part of the rig's body (see hand.js, and CLAUDE.md constraint 9 for the
  // arm chain this replaces). `hand: false` opts out — for a face drawn in some
  // other idiom, or a tile too small to spend the pixels.
  const hand = opts.hand === false ? null : createHand(face.svg, face.theme, meta, { dir: opts.handSide });

  gaze.onLargeShift = () => idle.blink();

  const listeners = {
    state: [], speakEnd: [], clipEnd: [], backchannel: [], performEnd: [], gestureEnd: [],
  };
  const emit = (ev, ...a) => listeners[ev] && listeners[ev].forEach((f) => f(...a));
  clip.onEnd = (c) => { if (c) emit('clipEnd', c.id); };
  speech.onEnd = () => { emit('speakEnd'); };
  performTrack.onEnd = () => { emit('performEnd'); };

  // --- live state -----------------------------------------------------------
  let stateName = 'IDLE';
  let emotion = 'neutral';
  let emotionAmt = 1;
  let gazeName = 'USER';
  let gazeCustom = null;
  let overrides = null; // demo/debug direct param injection
  // Articulation gain. The per-cue `i` only ever attenuates (shapeFor maps it to
  // 0.45..1.0 of the table), so there was no way to ask for a *bigger* mouth than
  // VISEME_SHAPES describes. That table is tuned for a face at conversational
  // size; at avatar size, sharing the screen with live video, the same shapes
  // read as under-articulated. This scales every viseme away from rest, so the
  // shape identities and their relative sizes are preserved and only the
  // excursion changes. Values above ~1.5 saturate the open vowels against the
  // channel clamp, which is the intended ceiling rather than a bug.
  let mouthGain = opts.mouthGain ?? 1;
  // Gesture gain, same idea for the clip layer. A nod is ballistic — NOD_SMALL
  // peaks at 149ms — but the head smooths at a 160ms time constant, so barely
  // 60% of an authored peak is ever rendered. The keyframes were written against
  // the numbers, not against what comes out the other side, which is why small
  // gestures read as nothing at all.
  let gestureGain = opts.gestureGain ?? 1;
  // Body-liveness gain. Constraint 8 (this widget shares the screen with a
  // live video call) argues for the smallest idle motion that still reads, and
  // the amplitudes in idle.js are set where they read. A host that is actually
  // re-encoding the avatar — compositing it into an outgoing stream rather
  // than rendering it locally as SVG, where the motion costs nothing — turns
  // this down instead of the default being a body that does not move.
  idle.gain = opts.motionGain ?? 1;
  let wanderAt = 0;
  let slowBlinkAt = 0;
  let glanceAt = 0;
  let glanceUntil = 0;
  let speakClock = null;
  let speakStart = 0;

  const cur = Object.assign({}, REST);
  const target = Object.assign({}, REST);

  function applyGaze() {
    const g = gazeOverrideByClip || gazeName;
    gaze.set(g, gazeOverrideByClip ? null : gazeCustom);
  }

  // --- the frame ------------------------------------------------------------
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  // `manual` withholds the rAF loop so a tool can drive frames itself. The
  // baseline pages could already step a ClipPlayer by hand, but nothing could
  // step the *mixer* — which is where idle, gaze and engagement actually
  // compose — so motion had no reproducible render. See tools/motion.mjs.
  const manual = !!opts.manual;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    // Cap dt so a backgrounded tab doesn't fast-forward the whole rig on return.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    step(dt, dt * 1000);
  }

  function step(dt, dtMs) {
    // 0. the performance timeline. Sampled before the pose is built so a verb
    //    firing this frame shapes this frame.
    performTrack.update();

    const st = STATES[stateName] || STATES.IDLE;

    // 1. base pose: rest + emotion + state-specific overlay
    for (const c of CHANNELS) target[c] = REST[c];
    const ep = emotionPose(emotion, emotionAmt);
    for (const k in ep) target[k] = REST[k] + ep[k];
    if (st.pose) for (const k in st.pose) target[k] = (target[k] || 0) + st.pose[k];

    // 2. gaze (absolute: pupils + partial head follow, plus the lid that rides
    //    with the eye — looking down without it bares sclera and reads as alarm)
    const g = gaze.update(elapsed, dt);
    for (const k in g) {
      if (k === 'lidBias') continue;
      target[k] = (k.startsWith('head') ? target[k] : 0) + g[k];
    }
    target.lidL += g.lidBias;
    target.lidR += g.lidBias;

    // 2b. the trunk follows the head. Sampled HERE, after gaze and before the
    //     clip layer, on purpose: a sustained turn toward the screen recruits
    //     the trunk, and a nod or a head shake does not — a body that swings
    //     with every gesture reads as a mannequin on a turntable. The lag is
    //     not authored anywhere; torsoTurn simply chases the same target at
    //     nearly 3x the head's time constant (TAU in params.js), so the trunk
    //     leaves late and settles late for free.
    target.torsoTurn += target.headYaw * TRUNK_FOLLOW;

    // 3. state-driven autonomous behaviour
    if (st.wander && elapsed > wanderAt) {
      const w = st.wander;
      wanderAt = elapsed + w.every[0] + Math.random() * (w.every[1] - w.every[0]);
      setGaze(w.targets[(Math.random() * w.targets.length) | 0]);
    }
    if (stateName === 'THINKING' && elapsed > slowBlinkAt) {
      slowBlinkAt = elapsed + 2.4 + Math.random() * 2.5;
      idle.slowBlink();
    }
    // Periodic glance (TYPING's look-up-at-you beat). The return leg goes back
    // to the state's own gaze; the gaze layer's large-shift blink fires on
    // both legs for free, which is exactly the blink a real glance carries.
    if (st.glance) {
      const gl = st.glance;
      if (glanceUntil && elapsed > glanceUntil) {
        glanceUntil = 0;
        glanceAt = elapsed + gl.every[0] + Math.random() * (gl.every[1] - gl.every[0]);
        setGaze(st.gaze);
      } else if (!glanceUntil && elapsed > glanceAt) {
        glanceUntil = elapsed + gl.hold[0] + Math.random() * (gl.hold[1] - gl.hold[0]);
        setGaze(gl.to);
      }
    }
    backchannel.enabled = !!st.backchannel && !clip.playing;
    backchannel.update(dt);
    // Engagement posture: forward lean while the user holds the floor, spent
    // only in the states that are *about* the user holding the floor. The
    // research (docs/research-biomechanics.md §6.3) puts sustained attentive
    // lean at +0.15–0.25; engage glides, and torsoLean's 0.24s tau smooths
    // the state gate, so the lean arrives and leaves like weight shifting.
    if (st.backchannel) target.torsoLean += 0.16 * backchannel.engage;
    // Straining leans harder while there is actually a faint voice to strain
    // after. engage already tracks "the user is (barely) talking", so this
    // costs nothing; with no user signal the static pose carries the state.
    else if (stateName === 'CANT_HEAR') target.torsoLean += 0.10 * backchannel.engage;

    // 4. mouth. The server's viseme track wins; a clip's mouth track fills the
    // gaps. There is deliberately no third leg: with no cues the mouth stays
    // shut, and a still mouth under speech is the *visible* symptom of a
    // backend that could not align — see docs/removed.md § Amplitude lipsync.
    const clipOut = clip.update(dtMs);
    let mouth = speech.sample();
    let mouthOwner = mouth ? 'speech' : null;
    if (!mouth && clipOut.ownsMouth && clipOut.mouth) { mouth = clipOut.mouth; mouthOwner = 'clip'; }
    if (mouth) {
      const shape = mouth.letter !== SILENT
        ? shapeFor(mouth.letter, mouth.intensity)
        : shapeFor(SILENT, 1);
      // Gain pivots on the rest shape, not on zero: scaling absolute values would
      // drag the closed mouth open, which is the one thing lipsync must never do.
      for (const k in shape) {
        target[k] = mouthGain === 1
          ? shape[k]
          : REST_SHAPE[k] + (shape[k] - REST_SHAPE[k]) * mouthGain;
      }
      // A smile held static through a sentence is discounted as insincere, and
      // corners riding every open viseme read as laughing through the words
      // (research-perception.md §3: warmth must be episodic). While the mouth
      // is genuinely speech-driven the BASE smile decays to a fraction of
      // itself; the smile channels' 130ms tau turns the gate into an ease.
      // Clip-owned mouths are exempt — a spoken OKAY *is* the warmth episode —
      // and only the base is scaled, so a gesture clip can still smile over a
      // sentence by authoring corner keys (they add, unscaled, in step 5).
      if (mouthOwner !== 'clip') {
        target.mouthCornerL *= SPEAK_SMILE_RETAIN;
        target.mouthCornerR *= SPEAK_SMILE_RETAIN;
      }
    }

    // 5. gesture deltas (additive, so a nod survives whatever else is happening)
    if (clipOut.delta) {
      for (const k in clipOut.delta) {
        // Never let a clip's mouth keyframes fight the live viseme stream.
        if (mouthOwner === 'speech' && MOUTH_LOCK.has(k)) continue;
        target[k] = (target[k] || 0) + clipOut.delta[k] * gestureGain;
      }
    }

    // 6. idle: sway, breath, blink
    // The torso's share of the liveness follows whether sound is actually being
    // produced, not what state the avatar is nominally in — a SPEAKING state with the
    // track finished should already be settling.
    idle.talk = approach(idle.talk, mouthOwner ? 1 : 0, 0.25, dt);
    idle.setProfile(st.idle);
    const il = idle.update(dt);
    for (const k in il.add) target[k] = (target[k] || 0) + il.add[k];

    // 7. clamp, then blink wins outright over whatever the lids were doing
    for (const c of CHANNELS) {
      const r = RANGE[c];
      target[c] = clamp(target[c], r[0], r[1]);
    }
    if (il.blink > 0) {
      target.lidL = Math.max(target.lidL, il.blink);
      target.lidR = Math.max(target.lidR, il.blink);
    }

    if (overrides) for (const k in overrides) target[k] = overrides[k];

    // 8. smooth toward the target — this is where co-articulation happens
    for (const c of CHANNELS) cur[c] = approach(cur[c], target[c], TAU[c], dt);

    face.apply(cur);

    // 9. the hand, outside all of the above. It writes a transform on its own
    //    group rather than parameter channels, so it neither smooths nor
    //    composes — its timelines are authored as delivered motion, not as
    //    targets to chase. `elapsed` is the mixer's own clock, so a manual
    //    stepper gets a reproducible gesture for free.
    if (hand) {
      const done = hand.update(elapsed * 1000);
      if (done) emit('gestureEnd', done.id);
    }
  }

  const REST_SHAPE = shapeFor(SILENT, 1);

  // How much of a sustained head turn the trunk takes up. Well under 1: people
  // under-rotate the head and then under-rotate the trunk again behind it, and
  // at a head-and-shoulders crop the trunk's share is the part you register
  // without noticing.
  const TRUNK_FOLLOW = 0.45;

  // The channels speech owns outright — exactly the params.js mouth group
  // (mouth corners stay free: a clip may smile over a sentence).
  const MOUTH_LOCK = new Set(GROUPS.mouth);

  // What survives of the resting/emotion smile while speech owns the mouth.
  // ~a third keeps the face warm without the corners fighting the visemes;
  // full warmth returns the moment the track ends, which is exactly the
  // episodic onset/offset a credible smile needs (research-perception.md §3).
  const SPEAK_SMILE_RETAIN = 0.35;

  // --- API ------------------------------------------------------------------

  function setState(name, o = {}) {
    if (!STATES[name]) throw new Error(`unknown state: ${name}`);
    const changed = name !== stateName;
    stateName = name;
    const st = STATES[name];
    if (o.emotion !== undefined) emotion = o.emotion;
    else if (changed) emotion = st.emotion;
    if (o.intensity !== undefined) emotionAmt = o.intensity;

    if (!o.keepGaze) setGaze(o.gaze || st.gaze);
    idle.setProfile(st.idle);
    // Arm the glance scheduler fresh so entering a glancing state doesn't
    // fire a stale timestamp immediately.
    glanceUntil = 0;
    glanceAt = elapsed + (st.glance ? st.glance.every[0] + Math.random() * (st.glance.every[1] - st.glance.every[0]) : 0);
    backchannel.reset(name === 'LISTENING' ? 2.2 : 4);
    face.svg.style.filter = st.filter || '';
    face.svg.style.transition = 'filter .5s ease';
    if (changed) { idle.blink(); emit('state', name); }
    return api;
  }

  function setEmotion(name, intensity = 1) { emotion = name; emotionAmt = intensity; return api; }

  /** @param {string} name  @param {{x:number,y:number}} [custom] normalized -1..1 */
  function setGaze(name, custom) {
    gazeName = GAZE_TARGETS[name] ? name : 'USER';
    gazeCustom = custom || null;
    applyGaze();
    return api;
  }

  /**
   * @param {object} o
   * @param {Array<{t:number,v:string,i?:number}>} o.cues
   * @param {HTMLMediaElement} [o.audio] preferred clock source
   * @param {() => number} [o.clock] custom ms clock, if you drive audio yourself
   */
  function speak(o = {}) {
    // A spoken interjection must die before real speech starts.
    if (clip.playing && clip.clip.mouthCues) clip.stop();
    speakStart = performance.now();
    speakClock = o.clock
      ? o.clock
      : o.audio
        ? () => o.audio.currentTime * 1000
        : () => performance.now() - speakStart;
    speech.start(o.cues || [], speakClock);
    if (stateName !== 'SPEAKING') setState('SPEAKING', { keepGaze: true });
    if (o.audio && o.audio.paused) o.audio.play().catch(() => {});
    return api;
  }

  function pushCues(cues) { speech.push(cues); return api; }

  function stopSpeaking() { speech.stop(); return api; }

  function interject(id) {
    const c = INTERJECTIONS[id];
    if (!c) throw new Error(`unknown interjection: ${id}`);
    clip.play(c, c.audioEl);
    backchannel.reset(3.5);
    return api;
  }

  /**
   * A hand gesture: the hand at the frame edge, plus the face half that makes it
   * belong to somebody.
   *
   * The face half is not a convenience — a hand rising to the jaw over a head
   * and shoulders sitting perfectly still is a cut-out, not a gesture. Each
   * entry in HAND_GESTURES names an interjection that already exists and was
   * already tuned (`WAVE`, `THUMBS_UP`, `ONE_MOMENT`); firing it here is the
   * library composing two authored things, not the client inventing motion.
   *
   * The two halves stay separable in both directions. `interject('WAVE')` is
   * still the face alone and is unchanged by this — a server that upgrades gets
   * no new behaviour until it asks for one — and on an avatar mounted with
   * `hand: false` this call degrades to exactly that interjection, which is the
   * same graceful failure the arm removal already forced every id through.
   */
  function gesture(id) {
    const def = HAND_GESTURES[id];
    if (!def) throw new Error(`unknown hand gesture: ${id}`);
    if (hand) hand.play(id, elapsed * 1000);
    if (def.face) interject(def.face);
    // A hand in frame is a deliberate move; a backchannel landing on top of it
    // is the listening engine talking over the server.
    backchannel.reset(def.dur / 1000 + 0.5);
    return api;
  }

  /**
   * Tell the listening engine whether the USER holds the floor, so backchannels
   * become contingent on their pauses instead of running on a timer. The server
   * owns this — it has the endpointer — and sends it as the `user` command;
   * `null` hands back to the no-signal timer fallback.
   */
  function setUserSpeaking(b) { backchannel.setUserSpeaking(b); return api; }

  // What one action does when its moment comes. Enum validity is checked here,
  // where the enums live: a bad value warns and is skipped, because one stale
  // verb must never take down the performance around it.
  function dispatchAction(a) {
    try {
      // `state` defaults to keepGaze — a timeline that wants the gaze moved
      // says so with a `gaze` verb at the moment it means, which is how every
      // composed turn in the demo already behaves.
      if (a.do === 'state') setState(a.name, { keepGaze: a.keepGaze !== false });
      else if (a.do === 'emotion') setEmotion(a.name, a.i ?? 1);
      else if (a.do === 'gaze') setGaze(a.name);
      else if (a.do === 'interject') interject(a.id);
      else if (a.do === 'gesture') gesture(a.id);
    } catch (e) {
      console.warn(`perform: ${a.do} at ${a.t}ms skipped — ${e.message}`);
    }
  }

  let performGen = 0;

  /**
   * Play a timed action track — the composition surface a server assembles
   * turns from. Verbs: state / emotion / gaze / interject / gesture (see
   * perform.js for hygiene, docs/contract-protocol.md for the schema).
   *
   * Clock resolution mirrors speak(): explicit `clock` fn, else the audio
   * element's own time, else ms elapsed since this call. perform() never
   * starts or stops audio — speak() owns the sound; this owns the choreography
   * that rides it.
   *
   * @param {Array<{t: number, do: string}>} actions
   * @param {{audio?: HTMLMediaElement, clock?: () => number,
   *          onAction?: (a: object) => void}} [o]
   * @returns {{stop: () => void}} stop() cancels the *future* of this
   *   performance only: an in-flight interjection finishes, a live cue track
   *   is untouched, and 'performEnd' does not fire. A handle whose
   *   performance was already replaced by a newer perform() is a no-op.
   */
  function perform(actions, o = {}) {
    const start = performance.now();
    const clock = o.clock
      ? o.clock
      : o.audio
        ? () => o.audio.currentTime * 1000
        : () => performance.now() - start;
    performTrack.onAction = (a) => { dispatchAction(a); if (o.onAction) o.onAction(a); };
    const gen = ++performGen;
    performTrack.start(actions, clock);
    return { stop: () => { if (gen === performGen) performTrack.stop(); } };
  }

  const api = {
    setState, setEmotion, setGaze, speak, pushCues, stopSpeaking, interject,
    gesture, perform,
    /** Which hand the character gestures with: +1 the viewer's right (its own
     *  left), -1 the other. Both are anatomically real — the thumb splays away
     *  from the body either way — so this is a character choice, not a fix. */
    setHandSide: (d) => { if (hand) hand.setDir(d); return api; },
    setUserSpeaking,
    /** Articulation gain: 1 is the VISEME_SHAPES table as authored. */
    setMouthGain: (g) => { mouthGain = g; return api; },
    get mouthGain() { return mouthGain; },
    /** Gesture gain: scales every clip delta. 1 is the timelines as authored. */
    setGestureGain: (g) => { gestureGain = g; return api; },
    get gestureGain() { return gestureGain; },
    /** Idle body-motion gain: 1 is the liveness layer as authored, 0 freezes it. */
    setMotionGain: (g) => { idle.gain = g; return api; },
    get motionGain() { return idle.gain; },
    blink: (dbl) => { idle.blink(dbl); return api; },
    /** Advance one frame by hand. Only meaningful under `{manual: true}`;
     *  fixed-dt stepping is what makes a motion render reproducible. */
    step: (dt) => { elapsed += dt; step(dt, dt * 1000); return api; },
    /** Direct parameter injection — for tuning UIs, not production. */
    setOverrides: (o) => { overrides = o; return api; },
    on: (ev, fn) => { (listeners[ev] || (listeners[ev] = [])).push(fn); return api; },
    get state() { return stateName; },
    get emotion() { return emotion; },
    get gaze() { return gazeName; },
    get speaking() { return speech.playing; },
    get performing() { return performTrack.playing; },
    get clip() { return clip.id; },
    /** The hand gesture in flight, or null. `null` forever if `hand: false`. */
    get gesturing() { return hand ? hand.id : null; },
    get params() { return cur; },
    get userSpeaking() { return backchannel.speaking; },
    svg: face.svg,
    meta,
    /** The mounted rig's palette, merged with any `opts.theme` overrides. A
     *  host that has to paint anything *around* the widget — a tile margin, a
     *  page behind a transparent mount — needs the same colours the drawing
     *  used, and guessing them per avatar is how the two drift apart. */
    theme: face.theme,
    destroy() {
      cancelAnimationFrame(raf);
      if (hand) hand.destroy();
      face.destroy();
    },
  };

  setState('IDLE');
  if (!manual) raf = requestAnimationFrame(frame);
  return api;
}

export { INTERJECTIONS, INTERJECTION_IDS, SPOKEN_IDS, attachAudio } from './interjections.js';
export { GAZE_NAMES, GAZE_TARGETS } from './gaze.js';
export { normalizeActions } from './perform.js';
export { HAND_GESTURES, HAND_GESTURE_IDS, checkHandFraming } from './hand.js';
export { EMOTION_NAMES } from './emotions.js';
export {
  VISEME_LETTERS, VISEME_SHAPES, normalizeCues, textToCues,
  ARPABET_TO_VISEME, AZURE_VISEME_TO_LETTER, LEAD_MS,
} from './visemes.js';
// No THEME re-export: each face module owns its palette, and `api.theme` is
// the mounted avatar's. A single barrel THEME was one rig's palette wearing a
// public name — misleading the moment that rig stopped being the default.
