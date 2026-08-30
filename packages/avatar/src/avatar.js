/**
 * The mixer — a programmable talking head.
 *
 * Not the public surface: that is `createAvatar({ mount, client })` in
 * `packages/avatar/client/createAvatar.ts`, and this is what it drives. Everything below is
 * addressed by our own runtime, our tooling, and an avatar author who chose to
 * build on the SVG renderer (`@voqalize/avatar/internal`, no semver promise).
 *
 *   const avatar = createAvatar({ mount, face: peep })   // faces.js, or a face module
 *   avatar.setState('LISTENING', { emotion: 'warm' })
 *   avatar.setGaze('SCREEN_LEFT')
 *   avatar.speak({ audio, cues })        // cues are {t, v, i?} in ms
 *   avatar.pushCues(moreCues)            // streaming top-up
 *   avatar.action('ACK_RECEIVE')
 *   avatar.action('GESTURE_GREET')       // a hand at the frame edge + its face
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
import { emotionPose } from './emotions.js';
import { GazeLayer, GAZE_TARGETS, AVERSION } from './gaze.js';
import { IdleLayer, ListeningEngine } from './idle.js';
import { ClipPlayer } from './clips.js';
import { ACTIONS, INTERNAL_CLIPS } from './interjections.js';
import { VisemeTrack, shapeFor, SILENT } from './visemes.js';
import { PerformTrack } from './perform.js';
import { createHand, HAND_GESTURES, HAND_ACTION_TO_FRAME_GESTURE } from './hand.js';
import { avatarFrame, createSvgRig } from './rig.js';

// Each state's `idle` is a profile for the liveness layer (see DEFAULT_PROFILE
// in idle.js). Blink gaps come from docs/research-biomechanics.md §5: the rate
// alone separates listening (~16/min) from thinking (~25/min) from visually
// busy (~9/min), and it is the cheapest state signal the rig has.
export const STATES = {
  // Idle means present but occupied with one's own quiet business. It must not
  // compete with LISTENING's sustained user attention: the default target is
  // away from the user and the wander only visits other non-task targets.
  //
  // Level and sideways, not up-and-away. This state used to sit on
  // AWAY_THINKING, which meant the rig performed "hmm, let me think" during the
  // one stretch when nothing whatever is pending, and then had nothing left to
  // say with when something was — the strongest cue in the vocabulary spent on
  // the state that least needs it. Horizontal is also what an observer reads as
  // attention directed *outward* (§4.4), which is what idle is.
  IDLE:               { gaze: 'AWAY_SIDE', emotion: 'neutral', engagement: false,
                        idle: { sway: 0.72, blinkGap: [4.6, 6.6] },
                        wander: { targets: ['AWAY_SIDE', 'SCREEN_LEFT', 'NOTES'], every: [3.6, 6.8] } },
  // `aversion` is why this state does not stare. Continuous eye contact is not
  // the attentive pose it looks like — it is a demand for more talk (Rossano)
  // and it measures as *tense*, not attentive (Wang & Gratch). See AVERSION in
  // gaze.js for the numbers; the mixer holds it off near a turn boundary.
  LISTENING:          { gaze: 'USER',     emotion: 'neutral',    engagement: true,
                        aversion: 'LISTEN',
                        idle: { sway: 1.0, blinkGap: [3.1, 4.2] },
                        pose: { browRaiseL: 0.06, browRaiseR: 0.06, lidL: -0.04, lidR: -0.04 } },
  // THINKING LOOKS UP, and getting that backwards is why this state read as
  // sullen rather than busy for as long as it did.
  //
  // The confusion is between what a thinker DOES and what a viewer READS, and
  // the two literatures answer different questions. Andrist's production data
  // (§4.2) says cognitive aversion goes down 39% / side 31% / up 29% — a weak
  // plurality, from an over-the-table dyad, pooling every kind of cognitive
  // work there is. Servais et al. (§4.4, n≈160/experiment) asked the *observer*
  // question instead — which direction is attributed to a mind turned inward —
  // and the answer is not close: up, in 58.7% of judgements overall and 79.4%
  // for semantic retrieval, while horizontal is what gets read as attention
  // directed outward. Composing a reply is the retrieval case, and this rig is
  // not thinking — it is *saying* that a reply is outstanding. So it is the
  // observer's reading that decides, and up wins on that question outright.
  //
  // The rendering settles it too. A downcast hold at tile size is
  // indistinguishable from reading, from notes, and from dejection, and here it
  // was compounding: AWAY_DOWN's lid follow put +0.14 on a lid that
  // `thoughtful` had already dropped 0.10, so the state's own signature was
  // half-shut eyes. What makes an up-look work instead of turning into an
  // eye-roll is not spent here — the head takes ~42% of the excursion and the
  // lid follow is asymmetric, both in gaze.js, so this state needs no lid or
  // head channel of its own.
  //
  // Down survives as one excursion in four, which is the honest reading of both
  // datasets: real thinkers do glance down, they just do not *live* there.
  // AWAY_RIGHT is the same up-and-away move mirrored, so the wander is not a
  // metronome between one point and the user.
  //
  // Faster, shallower breath is the measured cognitive-load signature, and the
  // occasional dead-still hold is the strongest "working on it" cue a rig this
  // simple can make — deliberate stillness, not more motion. Dwells run on the
  // ~3.5 s cognitive-aversion cadence (3.54 s, SD 1.26 — §4.2).
  THINKING:           { gaze: 'AWAY_THINKING', emotion: 'thoughtful', engagement: false,
                        idle: { sway: 0.7, blinkGap: [2.1, 2.7], breathRate: 1.18, breathAmp: 0.7,
                                hold: { every: [4.5, 9.0], dur: [0.8, 1.5] } },
                        wander: { targets: ['AWAY_THINKING', 'AWAY_THINKING', 'AWAY_RIGHT', 'AWAY_DOWN'],
                                  every: [2.6, 4.4] },
                        // The return to the user is a GLANCE, not a wander stop.
                        // 'USER' used to be a quarter of the wander set, which
                        // bought a *dwell* — 2.6-4.4 s of holding the user's
                        // eyes wearing a brow-knit, pressed-mouth thinking face,
                        // which does not read as "still with you" so much as
                        // being sized up. Bounded at well under a second it
                        // reads the way WORKING's glance does. Most thinks are
                        // shorter than `every` and never spend one at all, which
                        // is correct: only a long wait earns a check-in.
                        glance: { to: 'USER', every: [3.6, 6.5], hold: [0.5, 0.9] } },
  SPEAKING:           { gaze: 'USER',     emotion: 'neutral',    idle: { sway: 0.55 }, engagement: false },
  REVIEWING_SCREEN:   { gaze: 'SCREEN_CENTER', emotion: 'thoughtful', engagement: false,
                        idle: { sway: 0.8, blinkGap: [4.0, 6.5] },
                        wander: { targets: ['SCREEN_CENTER', 'SCREEN_LEFT', 'SCREEN_RIGHT', 'SCREEN_TOP', 'SCREEN_WORK'],
                                  every: [1.8, 5.0] } },
  // The floor has been handed over and nothing has come back yet. THINKING's
  // opposite number: both are silence, one is the agent's and this one is the
  // user's, and they must not look alike.
  //
  // THE STARE IS THE POINT, AND IT HAS TO EXPIRE. Everywhere else in this rig
  // sustained mutual gaze is the thing to avoid — it measures as tense and
  // rates no better than visible inattention (Wang & Gratch; see AVERSION in
  // gaze.js). Here it is the message: Rossano's finding is that held mutual
  // gaze is a *demand for more talk*, 95% of sequences expanding while both
  // parties keep looking, and demanding more talk is precisely this state's
  // job. So the state asks for the floor by holding the user's eyes — and then
  // stops, because Binetti (N=498) puts comfortable mutual gaze at 3295 ± 706
  // ms and a hold past that stops reading as invitation and starts reading as
  // pressure. AVERSION.WAIT is that clock: the first look-away lands on
  // Binetti's ceiling rather than on LISTEN's much longer gap, so the state
  // softens from "well?" to "take your time" on its own. Before this it carried
  // no aversion profile at all and stared for as long as the wait lasted.
  //
  // WHAT IS HELD IS WHAT CAN BE HELD. This was `encouraging` — a 0.58 smile
  // with a 0.26 brow raise, an expression that is right for a greeting or a
  // received answer and becomes a rictus somewhere around second four. The
  // floor states below make the same argument for themselves: a condition gets
  // a pose that survives being held, and the flash-and-decay of a real
  // expectancy beat belongs to a clip. So: brows up but well short of a flash,
  // lips parted (readiness to speak, the small cousin of TAKING_FLOOR's
  // inbreath), and a smile that is present rather than beaming — with the
  // squint that keeps it from reading as a mask (see `warm`).
  //
  // The head cant is the state's signature cue, and it has to clear the roll
  // multiplier to exist at all: 0.05 here renders as 0.3° of rotation, which
  // is no tilt whatever the number says. 0.30 renders ~1.7° — visible at tile
  // size, still gentle. The chin comes up with it rather than down, for the
  // reason the floor states give below: a lowered head reads as yielding, and
  // this state has already yielded and wants something back.
  WAITING_FOR_USER: { gaze: 'USER',     emotion: 'neutral', engagement: true,
                        aversion: 'WAIT',
                        idle: { sway: 1.0, blinkGap: [3.1, 4.2] },
                        pose: { headRoll: 0.30, headPitch: -0.06,
                                browRaiseL: 0.30, browRaiseR: 0.26,
                                lidL: -0.06, lidR: -0.06,
                                squintL: 0.12, squintR: 0.12,
                                mouthOpen: 0.05, mouthPress: -0.08,
                                mouthCornerL: 0.26, mouthCornerR: 0.22,
                                shoulderL: 0.06, shoulderR: 0.06 } },
  // Straining to hear. The one state where the amplitude constraint yields,
  // because the lean IS the message: torsoLean well past LISTENING's
  // engagement ceiling (+0.16), head cheated aside on USER_EAR so an ear
  // favors the speaker while the eyes hold contact, and a concentration
  // squint with knit brows. Stillness does the rest — straining people
  // freeze — so holds are frequent and there is no engagement lean: you don't
  // nod along to what you can't hear. Server sends it on soft/low-SNR user
  // audio, typically followed by SORRY or a "could you repeat" utterance.
  CANT_HEAR: {
    gaze: 'USER_EAR', emotion: 'neutral', engagement: false,
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
  // The user's microphone is closed, and the agent is the one that closed it.
  // Authored against CANT_HEAR as its exact inverse, because that contrast is
  // the whole read: straining leans *in* to get more of the user, this settles
  // *back* — nothing more is coming through and the avatar knows why. The eyes
  // stay on the user, because a deliberate hold is not inattention; what
  // carries it is the mouth, pressed shut and staying shut, and the slow,
  // unhurried blink of waiting rather than working. No engagement lean: you
  // cannot nod along to a channel you have muted yourself. No filter, ever —
  // DEGRADED and OFFLINE own "something is broken", and this is a decision.
  MUTED: {
    gaze: 'USER', emotion: 'neutral', engagement: false,
    idle: { sway: 0.45, blinkGap: [4.5, 7.0],
            hold: { every: [3.0, 6.0], dur: [0.9, 1.6] } },
    // Line-face scaled (see CANT_HEAR): peep's resting mouth is drawn smiling,
    // so a closed mouth has to be authored clearly past flat to read as closed
    // at all. Corners were -0.20 first, which rendered as a straight line and
    // at 130 px against LISTENING said nothing — the delta a viewer gets is
    // curvature, and flat is the halfway point of it, not the end. -0.34 is as
    // far as it goes before the hold starts reading as sulking. No squint and
    // no lid drop: one is straining, the other was asleep. browInner carries
    // the "one moment" without the worry lift.
    pose: {
      torsoLean: -0.28, headPitch: 0.04,
      browRaiseL: 0.08, browRaiseR: 0.06, browInnerL: 0.28, browInnerR: 0.22,
      mouthPress: 0.78, mouthCornerL: -0.34, mouthCornerR: -0.34,
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
  WORKING: {
    // SCREEN_WORK, not NOTES: on a steep down target the gaze layer's lid
    // follow seals the eyes, and at tile size shut eyes read as asleep, not
    // busy. A mild down-left with the head pitched into it keeps the iris in
    // the opening — eyes down but awake.
    gaze: 'SCREEN_WORK', emotion: 'neutral', engagement: false,
    idle: { sway: 0.6, blinkGap: [6.0, 7.5], breathRate: 1.05,
            rhythm: { amp: 0.05, freq: 2.2 } },
    glance: { to: 'USER', every: [4, 7], hold: [0.7, 1.1] },
    // Line-face scaled (see CANT_HEAR). This state carried no mouth at all,
    // which on a rig whose REST mouth is drawn smiling meant the avatar ran
    // your tool with a grin on. Milder than SEARCHING_SCREEN's -0.25 and
    // TYPING_CHAT's -0.28: busy is neutral, not effortful.
    pose: { headPitch: 0.10, lidL: -0.04, lidR: -0.04,
            shoulderL: 0.06, shoulderR: 0.06,
            mouthPress: 0.30, mouthCornerL: -0.18, mouthCornerR: -0.14 },
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
    gaze: 'SCREEN_WORK', emotion: 'neutral', engagement: false,
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
  // wandering ones, held long (aversion >3s), with no engagement lean — the
  // missing nod is as diagnostic as the look-away. Sway is looser than
  // LISTENING because attention is what was holding the body still. The
  // widget only looks away; deciding when to snap back is the server's call.
  DISTRACTED: {
    gaze: 'AWAY_RIGHT', emotion: 'neutral', engagement: false,
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
    gaze: 'SCREEN_CENTER', emotion: 'neutral', engagement: false,
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
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.6 }, engagement: false,
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
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.45 }, engagement: false,
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
    gaze: 'USER', emotion: 'neutral', idle: { sway: 0.9 }, engagement: false,
    pose: {
      browRaiseL: 0.10, browRaiseR: 0.08,
      torsoLean: -0.18, shoulderL: -0.12, shoulderR: -0.12,
    },
  },

  DEGRADED:           { gaze: 'USER',     emotion: 'neutral',    engagement: false,
                        idle: { sway: 0.4, blinkGap: [4.0, 8.0] },
                        pose: { lidL: 0.3, lidR: 0.3 }, filter: 'grayscale(.55) brightness(.82)' },
  OFFLINE:            { gaze: 'USER',     emotion: 'neutral',    engagement: false,
                        idle: { sway: 0.15, blinkGap: [9, 15] },
                        pose: { lidL: 0.95, lidR: 0.95, mouthCornerL: 0, mouthCornerR: 0 },
                        filter: 'grayscale(1) brightness(.6)' },
};

export const STATE_NAMES = Object.keys(STATES);

export function createAvatar(opts = {}) {
  const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
  if (!mount) throw new Error('createAvatar: mount element required');

  // `opts.face` is a Face record — `{ create, meta }`, one per face module. It
  // is passed in rather than named, because a name would need a table, and a
  // table would need every face imported to answer any lookup: three drawings
  // in every consumer's bundle to render one. `src/faces.js` still has that
  // table, for tooling that genuinely wants all of them.
  const entry = opts.rig ? null : opts.face;
  if (!opts.rig && !entry) {
    throw new Error('createAvatar: a `face` (see src/faces.js) or a `rig` is required');
  }
  const face = entry ? entry.create(mount, opts.theme) : null;
  // A renderer-neutral rig needs no SVG descriptor: `meta` is what SVG hosts
  // and tools frame the drawing with, never a requirement of the rig contract.
  // A face carries its own — a `{ create }` with no META used to be tolerated
  // here and the viewBox re-read off the produced svg, which meant a face could
  // ship half a descriptor and nothing would say so.
  const meta = face ? entry.meta : null;
  const gaze = new GazeLayer();
  const idle = new IdleLayer();
  const speech = new VisemeTrack();

  let gazeOverrideByClip = null;
  const clip = new ClipPlayer({
    onGaze: (g) => { gazeOverrideByClip = g; applyGaze(); },
    onBlink: () => idle.blink(),
  });
  const engagement = new ListeningEngine();
  const performTrack = new PerformTrack();
  // The current SVG hand is a renderer adapter for the first-class `frame.hand`
  // control. `hand: false` only disables its SVG rendering; gesture actions
  // still emit the semantic hand frame for a supplied custom rig.
  const hand = face && opts.hand !== false ? createHand(face.svg, face.theme, meta, { dir: opts.handSide }) : null;
  // The existing SVG face and hand are one migration adapter implementing the
  // renderer-agnostic AvatarRig contract. New renderers never need face SVG
  // coordinates or the hand layer's private geometry.
  const rig = opts.rig ? opts.rig(mount, opts.rigOptions) : createSvgRig(face, hand);

  gaze.onLargeShift = () => idle.blink();

  const listeners = {
    state: [], speakEnd: [], clipEnd: [], performEnd: [], gestureEnd: [],
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
  let handSide = opts.handSide === -1 ? 'left' : 'right';
  let handAction = null;
  const handQueue = [];
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
  let attendUntil = 0;
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
  // compose — so motion had no reproducible render. See apps/authoring/tools/motion.mjs.
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
      if (k === 'lidBias' || k === 'squintBias') continue;
      target[k] = (k.startsWith('head') ? target[k] : 0) + g[k];
    }
    target.lidL += g.lidBias;
    target.lidR += g.lidBias;
    // The lower lid's share of the same follow, which only an up-gaze spends.
    target.squintL += g.squintBias;
    target.squintR += g.squintBias;

    // 2b. the trunk follows the head. Sampled HERE, after gaze and before the
    //     clip layer, on purpose: a sustained turn toward the screen recruits
    //     the trunk, and a nod or a head shake does not — a body that swings
    //     with every gesture reads as a mannequin on a turntable. The lag is
    //     not authored anywhere; torsoTurn simply chases the same target at
    //     nearly 3x the head's time constant (TAU in params.js), so the trunk
    //     leaves late and settles late for free.
    target.torsoTurn += target.headYaw * TRUNK_FOLLOW;

    // 3. state-driven autonomous behaviour
    //
    // `wanderAt` is armed by setState, not merely by the last fire. It used to
    // be global and only ever advanced when a wander fired, so entering a
    // wandering state from a non-wandering one (LISTENING -> THINKING, every
    // turn of every call) found the timestamp already in the past and re-rolled
    // the target on the entry frame — discarding the state's own `gaze` before
    // the eyes had moved. THINKING's look-away therefore failed outright
    // whenever the re-roll happened to land on the target it was leaving.
    //
    // And it yields to a glance in flight: both scheduler and glance write the
    // one gaze target, so a wander firing mid-glance stole the look-up and the
    // glance's return leg then pointed the eyes back at the state target as if
    // nothing had happened.
    if (st.wander && !glanceUntil && elapsed > wanderAt) {
      const w = st.wander;
      wanderAt = elapsed + w.every[0] + Math.random() * (w.every[1] - w.every[0]);
      setGaze(w.targets[(Math.random() * w.targets.length) | 0]);
      // Don't let a glance land on top of the move. The two schedulers are
      // independent, so they collided: a wander at 3.9 s and a glance at 4.0 s
      // put two large gaze shifts, and their two gaze-evoked blinks, inside a
      // tenth of a second, which is a twitch rather than a look. The floor is
      // roughly twice the head's travel time for a typical shift (~0.55 s, see
      // HEAD_ACCEL in gaze.js) — the head has to arrive and be seen to have
      // arrived, because the stop is what says attention landed.
      if (st.glance) glanceAt = Math.max(glanceAt, elapsed + 1.2);
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
        // The return leg is an arrival, so it gets a full dwell before the
        // wander is allowed to move the eyes again.
        if (st.wander) wanderAt = elapsed + st.wander.every[0] + Math.random() * (st.wander.every[1] - st.wander.every[0]);
      } else if (!glanceUntil && elapsed > glanceAt) {
        glanceUntil = elapsed + gl.hold[0] + Math.random() * (gl.hold[1] - gl.hold[0]);
        setGaze(gl.to);
      }
    }
    // Aversion is a property of the state, but it is held off around a turn
    // boundary: the floor is handed over under mutual gaze, and an avatar that
    // looks away exactly as the user finishes has declined it. `attend` is the
    // mixer's one-frame veto — anything that means "the user is checking
    // whether I am with them" sets it (see api.attend).
    gaze.setAversion(st.aversion ? AVERSION[st.aversion] : null);
    gaze.hold = attendUntil > elapsed || clip.playing;

    engagement.enabled = !!st.engagement && !clip.playing;
    engagement.update(dt);
    // Engagement posture: forward lean while the user holds the floor, spent
    // only in the states that are *about* the user holding the floor. The
    // research (docs/research-biomechanics.md §6.3) puts sustained attentive
    // lean at +0.15–0.25; engage glides, and torsoLean's 0.24s tau smooths
    // the state gate, so the lean arrives and leaves like weight shifting.
    if (st.engagement) target.torsoLean += 0.16 * engagement.engage;
    // Straining leans harder while there is actually a faint voice to strain
    // after. engage already tracks "the user is (barely) talking", so this
    // costs nothing; with no user signal the static pose carries the state.
    else if (stateName === 'CANT_HEAR') target.torsoLean += 0.10 * engagement.engage;

    // 4. mouth. The server's viseme track wins; a clip's mouth track fills the
    // gaps. There is deliberately no third leg: with no cues the mouth stays
    // shut, and a still mouth under speech is the *visible* symptom of a
    // backend that could not align.
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

    // 9. First-class hand control. The semantic frame is generated here, above
    // every renderer, so SVG, WebGL, and video rigs receive exactly the same
    // gesture/progress information. A handless rig simply ignores `frame.hand`.
    const handFrame = updateHandAction(elapsed * 1000);
    rig.apply(avatarFrame(cur, handFrame || undefined));
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
    // Arm both gaze schedulers fresh so entering a state doesn't fire a stale
    // timestamp on the entry frame and throw away the target just set.
    glanceUntil = 0;
    glanceAt = elapsed + (st.glance ? st.glance.every[0] + Math.random() * (st.glance.every[1] - st.glance.every[0]) : 0);
    wanderAt = elapsed + (st.wander ? st.wander.every[0] + Math.random() * (st.wander.every[1] - st.wander.every[0]) : 0);
    // SVG's desaturation filter is a legacy renderer detail. A generic rig
    // receives the same state pose and may express degradation its own way.
    if (face) {
      face.svg.style.filter = st.filter || '';
      face.svg.style.transition = 'filter .5s ease';
    }
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
    // Speech owns the mouth in the mixer, but a server action still gets to
    // complete its physical landing on the other channels. Do not cancel it
    // here: a hand or head cannot disappear simply because playout began.
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

  /**
   * "The user may be checking whether I am with them — hold their eyes."
   *
   * This is the widget's half of the **gaze window**. In face-to-face talk a
   * speaker periodically looks at the listener, mutual gaze is established, the
   * listener responds inside that window, and the speaker looks away again
   * (Bavelas, Coates & Johnson 2002) — listener responses cluster inside the
   * window rather than being scattered across the turn.
   *
   * We cannot see the user, so we cannot observe the window opening. What a
   * caller *can* do is name the moments that co-occur with it — a mid-turn
   * pause, a tag question ("...right?", "you know?"), a completed clause with
   * the turn analyzer's completion probability high, the user answering a
   * question the bot asked. `attend(ms)` is how those arrive: for its duration
   * the face stops averting and holds the user, which is the prerequisite for
   * any response to be *seen*. Emitting the response itself stays a separate
   * call — a window that opens and draws nothing is a real and common outcome
   * (with every measured invitation cue present, humans respond to only ~30% of
   * opportunities), and conflating the two would make the avatar answer
   * everything. The explicit response remains a backend/application decision.
   *
   * Deliberately **not on the wire yet**: there is no `attend` command in
   * `packages/avatar/client/types.ts`, so today this is reachable only from JS (the demo and
   * the rig pages). Adding the command is a protocol change and waits for a
   * server that has something real to key it off — see docs/internal-mixer.md.
   *
   * @param {number} [ms=1200] how long to hold. Binetti (N=498) puts preferred
   *        mutual gaze at 3295 ± 706 ms, so this is a fraction of the ceiling.
   */
  function attend(ms = 1200) {
    attendUntil = Math.max(attendUntil, elapsed + ms / 1000);
    return api;
  }

  function pushCues(cues) { speech.push(cues); return api; }

  function stopSpeaking() { speech.stop(); return api; }

  function interject(id) {
    const c = INTERNAL_CLIPS[id];
    if (!c) throw new Error(`unknown interjection: ${id}`);
    clip.play(c, c.audioEl);
    return api;
  }

  /**
   * A hand gesture: the hand at the frame edge, plus the face half that makes it
   * belong to somebody.
   *
   * The face half is not a convenience — a hand rising to the jaw over a head
   * and shoulders sitting perfectly still is a cut-out, not a gesture. Each
   * entry in HAND_GESTURES names the matching semantic face action; firing it here is the
   * library composing two authored things, not the client inventing motion.
   *
   * On an avatar mounted with `hand: false` this internal helper degrades to
   * the face action alone.
   */
  function gesture(id) {
    const def = HAND_GESTURES[id];
    if (!def) throw new Error(`unknown hand gesture: ${id}`);
    if (hand) hand.play(id, elapsed * 1000);
    if (def.face) interject(def.face);
    return api;
  }

  /** One self-completing server action. State continues to resolve underneath;
   * face and hand layers queue their next movement so an in-flight physical
   * gesture always gets to land. */
  function action(id) {
    const handDef = HAND_GESTURES[id];
    if (handDef) {
      startHandAction(id, handDef);
      if (handDef.face) {
        const faceClip = ACTIONS[handDef.face];
        if (faceClip) clip.play(faceClip, faceClip.audioEl, { queue: true });
      }
      return api;
    }
    const faceClip = ACTIONS[id];
    if (!faceClip) throw new Error(`unknown action: ${id}`);
    clip.play(faceClip, faceClip.audioEl, { queue: true });
    return api;
  }

  function startHandAction(id, def) {
    const gesture = HAND_ACTION_TO_FRAME_GESTURE[id];
    if (!gesture) return;
    if (handAction) {
      if (handAction.id !== id && !handQueue.some((item) => item.id === id)) {
        handQueue.push({ id, def, gesture });
      }
      return;
    }
    handAction = { id, def, gesture, start: elapsed * 1000 };
  }

  function updateHandAction(nowMs) {
    if (!handAction) return null;
    const progress = (nowMs - handAction.start) / handAction.def.dur;
    if (progress >= 1) {
      const done = handAction;
      const next = handQueue.shift();
      handAction = next ? { ...next, start: nowMs } : null;
      emit('gestureEnd', done.id);
      return handAction ? { gesture: handAction.gesture, progress: 0, side: handSide } : null;
    }
    return { gesture: handAction.gesture, progress: Math.max(0, progress), side: handSide };
  }

  /**
   * Tell the listening engine whether Pipecat VAD says the user holds the
   * floor. This changes only sustained engagement posture; it can never create
   * a nod or acknowledgement clip.
   */
  function setUserSpeaking(b) { engagement.setUserSpeaking(b); return api; }

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
      else if (a.do === 'action') action(a.id);
    } catch (e) {
      console.warn(`perform: ${a.do} at ${a.t}ms skipped — ${e.message}`);
    }
  }

  let performGen = 0;

  /**
   * Play a timed action track — the composition surface a server assembles
   * turns from. Verbs: state / emotion / gaze / action (see
   * perform.js for hygiene, docs/internal-mixer.md for the schema).
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
    setState, setEmotion, setGaze, speak, pushCues, stopSpeaking, attend,
    action, perform,
    /** Which hand the character gestures with: +1 the viewer's right (its own
     *  left), -1 the other. Both are anatomically real — the thumb splays away
     *  from the body either way — so this is a character choice, not a fix. */
    setHandSide: (d) => { handSide = d === -1 ? 'left' : 'right'; return api; },
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
    /** Semantic hand gesture in flight, independent of renderer capability. */
    get gesturing() { return handAction ? handAction.id : null; },
    get params() { return cur; },
    get userSpeaking() { return engagement.speaking; },
    // Legacy SVG inspection fields. New AvatarRig implementations should not
    // rely on or provide them; the renderer-neutral contract is apply/destroy.
    svg: face?.svg || null,
    meta: meta || null,
    /** The mounted rig's palette, merged with any `opts.theme` overrides. A
     *  host that has to paint anything *around* the widget — a tile margin, a
     *  page behind a transparent mount — needs the same colours the drawing
     *  used, and guessing them per avatar is how the two drift apart. */
    theme: face?.theme,
    destroy() {
      cancelAnimationFrame(raf);
      rig.destroy();
    },
  };

  setState('IDLE');
  if (!manual) raf = requestAnimationFrame(frame);
  return api;
}

export { ACTION_IDS, ACTIONS, attachAudio } from './interjections.js';
export { GAZE_NAMES, GAZE_TARGETS } from './gaze.js';
export { normalizeActions } from './perform.js';
export { checkHandFraming } from './hand.js';
export { EMOTION_NAMES } from './emotions.js';
// The mouth clock travels with the rest of it. Someone has to turn a cue array
// plus a clock into "which letter is on screen right now", every renderer needs
// exactly that, and none of them should write it twice — so it is a plain class
// to construct, not a contract to implement.
export {
  VISEME_LETTERS, VISEME_SHAPES, VisemeTrack, shapeFor, SILENT,
  normalizeCues, textToCues,
  ARPABET_TO_VISEME, AZURE_VISEME_TO_LETTER, LEAD_MS,
} from './visemes.js';
// No THEME re-export: each face module owns its palette, and `api.theme` is
// the mounted avatar's. A single barrel THEME was one rig's palette wearing a
// public name — misleading the moment that rig stopped being the default.
