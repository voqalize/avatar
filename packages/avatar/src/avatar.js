/**
 * The mixer — a programmable talking head.
 *
 * Not the public surface: that is `createAvatar({ mount, client })` in
 * `packages/avatar/client/createAvatar.ts`, and this is what it drives. Everything below is
 * addressed by our own runtime, our tooling, and an avatar author who chose to
 * build on the SVG renderer (`@voqalize/avatar/internal`, no semver promise).
 *
 * Per frame the mixer runs a fixed layer order. Earlier layers are overwritten
 * by later ones on the channels they touch; the gesture and idle layers are
 * additive so they compose rather than fight.
 *
 *   base pose (state + emotion)  ->  gaze  ->  visemes  ->  clip  ->  idle
 */

import { REST, CHANNELS, TAU, RANGE, GROUPS, clamp, approach } from './params.js';
import { EMOTIONS, emotionPose } from './emotions.js';
import { GazeLayer, GAZE_TARGETS, AVERSION } from './gaze.js';
import { IdleLayer, ListeningEngine } from './idle.js';
import { ClipPlayer } from './clips.js';
import { ACTIONS, INTERNAL_CLIPS } from './interjections.js';
import { VisemeTrack, shapeFor, SILENT } from './visemes.js';
import { SpeechProsody, UNCALIBRATED_HEAD_GAIN } from './prosody.js';
import { HEAD_AXES, soften } from './head.js';
import { PerformTrack } from './perform.js';
import { createHand, HAND_GESTURES, HAND_ACTION_TO_FRAME_GESTURE } from './hand.js';
import { avatarFrame, createSvgRig } from './rig.js';

const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = (xs) => xs[(Math.random() * xs.length) | 0];

// Each state's `idle` is a profile for the liveness layer (see DEFAULT_PROFILE
// in idle.js). Blink gaps come from docs/research-biomechanics.md §5: the rate
// alone separates listening (~16/min) from thinking (~25/min) from visually
// busy (~9/min), and it is the cheapest state signal the rig has. The gap is
// the budget for every blink, paired ones included (about one in six), so it
// sits a little longer than 60/rate.
export const STATES = {
  // Idle means present and relaxed, not attending. It is also the face before
  // a call connects — the first one anyone sees — so it rests on the user and
  // leaves for soft, unhurried looks (AVERSION.IDLE) rather than parking the
  // eyes somewhere. It used to open on AWAY_THINKING and wander between it,
  // AWAY_RIGHT and NOTES from the first frame: a face that loads looking up
  // and to the left, at nothing, reads as broken rather than idle. What keeps
  // it apart from LISTENING is the longer, lazier looks, the slower scan and
  // the missing engagement lean, not refusing to look at the user.
  IDLE:               { gaze: 'USER', emotion: 'neutral', engagement: false,
                        aversion: 'IDLE', scan: [0.8, 2.0],
                        idle: { sway: 0.72, blinkGap: [3.6, 5.2] } },
  // `aversion` is why this state does not stare. Continuous eye contact is not
  // the attentive pose it looks like — it is a demand for more talk (Rossano)
  // and it measures as *tense*, not attentive (Wang & Gratch). See AVERSION in
  // gaze.js for the numbers; the mixer holds it off near a turn boundary.
  // At 3.2-4.4 s the blink timer measured 20-23/min.
  LISTENING:          { gaze: 'USER',     emotion: 'neutral',    engagement: true,
                        aversion: 'LISTEN',
                        idle: { sway: 1.0, blinkGap: [3.6, 4.8] },
                        pose: { browRaiseL: 0.06, browRaiseR: 0.06, lidL: -0.04, lidR: -0.04 } },
  // Faster, shallower breath is the measured cognitive-load signature, and the
  // occasional dead-still hold is the strongest "working on it" cue a rig this
  // simple can make — deliberate stillness, not more motion. The look away is
  // Andrist's cognitive aversion (§4.2): one look held ~3.5 s (SD 1.26) that
  // drifts a little where it sits, a check-in with the user, then the next.
  //
  // In a call this state mostly lasts under two seconds — the gap between the
  // user finishing and the reply starting — so its opening is what gets seen,
  // and the opening used to be wrong. The eyes left the instant the user
  // stopped, down and to the left, every turn: a listener who drops their
  // eyes the moment you finish reads as ashamed or done with you. Now the
  // eyes hold the user for `opening` first (a person takes in the end of
  // what was said before they go to think), and a fast reply never looks
  // away at all. The look is mostly up-and-aside or level-aside: that is the
  // one audiences read as thinking, whatever the measured split, and down
  // is kept to a fifth of looks because on a face this real it reads as
  // downcast. The pose takes back `thoughtful`'s lid drop: a thinking face is
  // alert, and the two together measured past the 0.15 that reads drowsy.
  THINKING:           { gaze: 'AWAY_SIDE', emotion: 'thoughtful', engagement: false,
                        // Fixational jumps rare and small: a thinker's eyes rest
                        // where they land. At the default gap the look jittered
                        // about its spot every second, and with a drift on top
                        // the eyes never held anything — searching the wall, not
                        // thinking.
                        scan: [1.2, 2.6, 0.35],
                        idle: { sway: 0.7, blinkGap: [2.6, 3.2], slowBlink: 0.3,
                                breathRate: 1.18, breathAmp: 0.7,
                                hold: { every: [4.5, 9.0], dur: [0.8, 1.5] } },
                        // `stick`: people have a side they look to when they
                        // think and keep to it (Day; Kinsbourne's lateral eye
                        // movements) — one who alternates sides on every look is
                        // scanning the room. `dart`: now and then, once in a
                        // look, the eyes move on to a second spot with a flick of
                        // the brows, which is the thought moving; the random
                        // drift this replaces never stopped and read as roving.
                        // `blinkTo`: the look back to the user always blinks —
                        // the re-engagement is the beat to see.
                        glance: { to: 'USER', opening: [0.35, 0.7], every: [2.2, 4.4], hold: [0.8, 1.3],
                                  back: ['AWAY_THINKING', 'AWAY_THINKING', 'AWAY_THINKING',
                                         'AWAY_SIDE', 'AWAY_SIDE', 'AWAY_SIDE',
                                         'AWAY_RIGHT', 'AWAY_RIGHT', 'AWAY_DOWN', 'AWAY_DOWN'],
                                  stick: 0.55, dart: { p: 0.4, mag: 0.08, brow: 0.12 }, blinkTo: true },
                        // **The chin comes up**: thinking is the one stretch of
                        // a call where the avatar owes the user feedback and
                        // has no mouth to give it with, the eyes being off the
                        // user by design. A head tipping back as the gaze
                        // leaves is the swing-up of research-biomechanics.md
                        // § 3.3. It rides the looks that go up, as the head's
                        // *share* of them: held as a pose it lifted the chin on
                        // the level and downward looks too, so the user was
                        // looked at down the nose.
                        pose: { lidL: -0.10, lidR: -0.10 } },
  // Eyes on the user for the whole turn, and no `aversion`: gaze.js has why a
  // speaker's measured looks away are not this rig's to render. What moves
  // while it talks is the head it holds per phrase and the trunk under it
  // (prosody.js), never the eyes leaving the user.
  SPEAKING:           { gaze: 'USER',     emotion: 'neutral',
                        idle: { sway: 0.55 }, engagement: false },
  REVIEWING_SCREEN:   { gaze: 'SCREEN_CENTER', emotion: 'thoughtful', engagement: false,
                        idle: { sway: 0.8, blinkGap: [4.0, 6.5] },
                        wander: { targets: ['SCREEN_CENTER', 'SCREEN_LEFT', 'SCREEN_RIGHT', 'SCREEN_TOP', 'SCREEN_WORK'],
                                  every: [1.8, 5.0] } },
  // The head cant is the state's signature cue, and it has to clear the roll
  // multiplier to exist at all: 0.05 here renders as 0.3° of rotation, which
  // is no tilt whatever the number says. 0.30 renders ~1.7° — visible at tile
  // size, still gentle.
  WAITING_FOR_USER: { gaze: 'USER',     emotion: 'encouraging', engagement: true,
                        idle: { sway: 1.0, blinkGap: [3.1, 4.2] },
                        pose: { headRoll: 0.30, browRaiseL: 0.16, browRaiseR: 0.12 } },
  // Straining to hear. The one state where the amplitude constraint yields,
  // because the lean IS the message: torsoLean well past what the engagement
  // layer ever spends, head cheated aside on USER_EAR so an ear
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
    // The squint is the lower lid's (AU7), with no upper lid dropped on top:
    // the two together narrowed a photographic eye from above and read as
    // drowsy, and a line face's squint is its lower lid already.
    pose: {
      torsoLean: 0.70, headPitch: 0.10,
      squintL: 0.75, squintR: 0.75,
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
  // whole read comes from cheap cues (docs/research-biomechanics.md §6.4,
  // recommendation 19): gaze down on one stable target with a reading scan,
  // blinks suppressed to task-focus rate (~9/min), shoulders slightly raised
  // and *held* with brief micro-freezes, and a glance back up to the user.
  // The glance is the tell that the user has not been forgotten; without it,
  // busy is just absent, and much more often than that it is fidgeting. There
  // is no shoulder rhythm: at 2.2 Hz it ran over the 1.5 Hz ceiling every
  // other motion here keeps, and held is what §6.4 describes. The trunk sits
  // out the glance — checking on someone is a look, not a turn toward them.
  WORKING: {
    // OWN_SCREEN: eyes down at the agent's own display, head nearly level.
    // This was SCREEN_WORK, which turned the head down and to the left and
    // held it there for the whole task, with a random drift too small to see
    // on it — a head turned away from the user, staring at a point. `read` is
    // what makes it busy instead: fixations stepping along a line, a sweep
    // back, the next line, a pause on the result (see readStep). The lids
    // take back most of the down look's follow so the eyes stay awake.
    gaze: 'OWN_SCREEN', emotion: 'neutral', engagement: false,
    scan: [0.9, 2.0, 0.12],
    // §6.4's ~9/min is a count of blinks: at the table's own 6-7.5 s gap it
    // measured 12-13/min, which is not focus.
    idle: { sway: 0.5, blinkGap: [6.8, 8.6], breathRate: 1.05, breathAmp: 0.8,
            hold: { every: [5.0, 9.0], dur: [0.6, 1.1] } },
    // The look up to check is brows-first and blinkless, the lids leading it
    // (their 18 ms against the eye's 32 ms); the blink comes on the way back
    // down, where the eyes re-engage with the work. A blink going up hid the
    // one moment the user is actually looked at.
    glance: { to: 'USER', every: [6, 11], hold: [0.8, 1.2], brow: 0.10,
              blinkTo: false, blinkBack: true },
    // Fewer, longer fixations than a page reader's. At 3-5 steps a quarter
    // second apart the scan measured a shift a second, and over a webcam that
    // is a jiggle, not reading.
    read: { width: 0.20, steps: [2, 3], fix: [0.35, 0.7], lines: [2, 4], line: 0.05,
            pause: [0.9, 1.8] },
    // The brows draw down and together — AU4, the one facial action that
    // reliably marks effortful concentration. Without it the face over a
    // reading scan is blank, and blank over a moving eye reads as bored.
    pose: { headPitch: 0.04, lidL: -0.08, lidR: -0.08,
            shoulderL: 0.06, shoulderR: 0.06,
            browRaiseL: -0.08, browRaiseR: -0.08, browInnerL: -0.10, browInnerR: -0.10 },
  },
  // The audio channel is broken and the agent is typing in the chat window to
  // communicate. The glance looks up and HOLDS 1.2–2 s, expectant, because the
  // chat (and the user's face) is now the only channel there is. A touch of
  // browInner carries the apology. Relation to DEGRADED is by semantics, not merger:
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
  // Attention genuinely elsewhere. What separates this from WORKING is target
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
    // eyes (see WORKING).
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
    // The only screen state that never named its own scan, so it ran the
    // default [0.5, 1.6] at full amplitude: a second full-size jump landing on
    // top of a wander hop, which is most of what reads as snapping. A hunt's
    // refixations are faster and much smaller than a reader's — quick little
    // checks around the thing being looked at — so this is the other end of
    // the dial from WORKING's [0.9, 2.0, 0.12] rather than a copy of it.
    scan: [0.4, 1.1, 0.55],
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
  // Each of these lifts the shoulders and parts the lips, because that is what an
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

  // --- connection ----------------------------------------------------------
  // Neither of these may close the eyes. A lid at 0.3 reads sleepy and one at
  // 0.95 reads asleep (research-perception.md §6), and on a photographic face
  // a disconnected call rendered as someone falling asleep on camera. The SVG
  // faces also desaturate (`filter`); a rig that does not is carried by pose
  // and gaze alone, so those have to say it.
  //
  // Our side of the call is struggling: still with the user, a little worried
  // about it — inner brows up, mouth pressed — and quieter than listening.
  DEGRADED:           { gaze: 'USER',     emotion: 'neutral',    engagement: false,
                        aversion: 'LISTEN',
                        idle: { sway: 0.4, blinkGap: [3.4, 5.0] },
                        pose: { browInnerL: 0.30, browInnerR: 0.26, browRaiseL: -0.04, browRaiseR: -0.04,
                                mouthPress: 0.20, mouthCornerL: -0.10, mouthCornerR: -0.10 },
                        filter: 'grayscale(.55) brightness(.82)' },
  // The call is gone. What a person does when their call drops: eyes on their
  // own screen, waiting, and now and then a look back up to see whether it
  // has come back. Still, with long holds — not in conversation — but awake.
  OFFLINE:            { gaze: 'OWN_SCREEN', emotion: 'neutral', engagement: false,
                        scan: [1.2, 2.6],
                        idle: { sway: 0.3, blinkGap: [4.5, 7.0],
                                hold: { every: [4.0, 8.0], dur: [1.0, 2.0] } },
                        glance: { to: 'USER', every: [7, 12], hold: [0.8, 1.3] },
                        pose: { lidL: -0.08, lidR: -0.08, mouthPress: 0.25 },
                        filter: 'grayscale(1) brightness(.6)' },
};

export const STATE_NAMES = Object.keys(STATES);

/**
 * The shoulder line's share of a held tilt, per unit of `headRoll`.
 *
 * Roll is the one head axis with nothing under it: a turn recruits the trunk
 * and a nod bends the neck, but a tilt on a 2.5-D head is a rotation about a
 * point near the chin and every other pixel stays exactly where it was. That is
 * the read reported as "a hinge". Anatomically a tilt is lower-cervical
 * (docs/research-head-rotation.md §2.1) — spread down the neck, ending at the
 * girdle — so the shoulder line tips a little with it, and that tip is what says
 * the neck bent rather than the head swinging off a pin.
 *
 * Sized to stay an accompaniment: at the roll clamp the line tips about a
 * quarter of the trunk's own share of a turn, which lifts a shoulder ~0.11 of
 * its shrug — inside the band a weight shift already occupies. A third, the
 * figure Live2D gives its body angles, put 6 px of shoulder on an 8 degree tilt
 * and read as a shrug arriving with the head.
 *
 * Exported for the rig instruments.
 */
export const SHOULDER_TILT = 0.08;

export function createAvatar(opts = {}) {
  const mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
  if (!mount) throw new Error('createAvatar: mount element required');

  // `opts.face` is a Face record — `{ create, meta }`. Passed in rather than
  // named: a name needs a table, and a table imports every drawing to answer
  // one lookup (`src/faces.js` has that table, for tooling that wants them).
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
  const prosody = new SpeechProsody({ brows: opts.brows });

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
  const rig = opts.rig ? opts.rig(mount, opts.rigOptions) : createSvgRig(face, hand);

  gaze.onLargeShift = (forced) => idle.blink(true, forced);

  const listeners = {
    state: [], speakEnd: [], clipEnd: [], performEnd: [], gestureEnd: [],
  };
  const emit = (ev, ...a) => listeners[ev] && listeners[ev].forEach((f) => f(...a));
  clip.onEnd = (c) => { if (c) emit('clipEnd', c.id); };
  speech.onEnd = () => { prosody.closeTurn(); emit('speakEnd'); };
  performTrack.onEnd = () => { emit('performEnd'); };

  // --- live state -----------------------------------------------------------
  let stateName = 'IDLE';
  let emotion = 'neutral';
  let emotionAmt = 1;
  let gazeName = 'USER';
  let gazeCustom = null;
  let overrides = null; // demo/debug direct param injection
  // Articulation gain. VISEME_SHAPES is tuned for a face at conversational
  // size; sharing the screen with live video the same shapes read as
  // under-articulated. Scales every viseme away from rest, so shape identities
  // and their relative sizes survive and only the excursion changes. Above
  // ~1.5 the open vowels saturate against the clamp — the intended ceiling.
  let mouthGain = opts.mouthGain ?? 1;
  let handSide = opts.handSide === -1 ? 'left' : 'right';
  /**
   * This avatar's own addressable motions, on top of the core intents.
   *
   * An avatar is a drawing with a body, and some bodies can do things the wire
   * has no portable word for. The nod types the listening research separates —
   * a continuer, an assessment, a realisation — are one
   * `ACKNOWLEDGE` to a server, because that is all a server can ask of every
   * face; the *shapes* are sized in a rig's own units and belong to the rig
   * (`packages/avatar/client/three/sequences.ts` is the first table of them).
   *
   * Deliberately not a registry and not a loader: it is a plain object the
   * avatar module passes in, and it can only add. `ACTIONS` wins on a name
   * collision, so no asset can quietly change what a core action means.
   */
  const sequences = opts.sequences || {};
  /**
   * This avatar's own *rendering* of an id this renderer already has — same id,
   * same intent, a shape sized for its body.
   *
   * These are an intent vocabulary, and `ACK_NOD` is one implementation of
   * "the avatar nodded", not a promise about anatomy (interjections.js). The
   * shared clips are authored in pose units that mean pixels on a line face;
   * on a rig whose unit is a degree the same keys can land outside what the
   * gesture *means* — the shared nod renders 15° on tara, where a continuer is
   * 3-5° — and scaling it would not fix it, because a continuer is one stroke
   * where an agreement is two. So a renderer may re-author the shape.
   *
   * What it may not do is change the vocabulary: every id here must already be
   * one this renderer publishes, so no avatar can add a word through this door
   * or make one mean something else. `sequences` is the door for adding.
   */
  const actionShapes = opts.actions || {};
  for (const id of Object.keys(actionShapes)) {
    if (!ACTIONS[id]) throw new Error(`actions: ${id} is not one of this renderer's own`);
  }
  /**
   * This avatar's own rendering of a state — the same door as `actions`, for
   * the held face instead of the gesture. A rig replaces a state's fields
   * whole (`pose`, say), and only for a state the table already has: it can
   * re-render the vocabulary, never extend it.
   */
  const states = { ...STATES };
  for (const [id, own] of Object.entries(opts.states || {})) {
    if (!STATES[id]) throw new Error(`states: ${id} is not a state`);
    states[id] = { ...STATES[id], ...own };
  }
  let handAction = null;
  const handQueue = [];
  // Gesture gain, same idea for the clip layer: small gestures under-render
  // through the head's τ — see internal-mixer.md § Smoothing.
  let gestureGain = opts.gestureGain ?? 1;
  // Body-liveness gain. Constraint 8 (this widget shares the screen with a
  // live video call) argues for the smallest idle motion that still reads, and
  // the amplitudes in idle.js are set where they read. A host that is actually
  // re-encoding the avatar — compositing it into an outgoing stream rather
  // than rendering it locally as SVG, where the motion costs nothing — turns
  // this down instead of the default being a body that does not move.
  idle.gain = opts.motionGain ?? 1;
  // Speech-rhythm gains. A pose unit is a different angle on every rig — peep's
  // head travels 17 px per unit of pitch, a mesh head turns a few degrees — so
  // the rig's own module sets these once rather than the library guessing.
  // Defaults to the uncalibrated scale; `prosody.js` has what that stands for.
  const prosodyHeadGain = opts.prosodyHeadGain ?? UNCALIBRATED_HEAD_GAIN;
  const prosodyFaceGain = opts.prosodyFaceGain ?? 1;
  // Fixational-saccade gain, the same idea for the eyes: how far a scan
  // step, a drift or a line of reading travels. Sized for a line face's
  // pupils at 1; a photographic eye needs several times that to move at all.
  // Aversions get their own gain: a look-away must read as one from across
  // the call, where a fixation step must not, so one number cannot size both.
  const saccadeGain = opts.saccadeGain ?? 1;
  // How far this face may hold its head off centre, per axis (internal-mixer.md
  // § The held-head budget): the rig supplies it; an axis left out is unbudgeted.
  const headHold = opts.headHold || {};
  // Per-axis gain on the head's *continuous* drive — speech phrasing and idle,
  // both sized in pose units for a line drawing. Measuring a 2.5-D face found
  // the drive spending a third of the pitch a speaking human uses and nearly
  // twice the yaw. In front of 6b deliberately: a gain that skipped the budget
  // would be measuring the face's failure rather than the layer's range.
  const headGain = typeof opts.headGain === 'number'
    ? { headYaw: opts.headGain, headPitch: opts.headGain, headRoll: opts.headGain }
    : { headYaw: 1, headPitch: 1, headRoll: 1, ...(opts.headGain || {}) };
  gaze.scanGain = saccadeGain;
  gaze.avertGain = opts.aversionGain ?? 1;
  // A rig that says what its pose units are in degrees gets the eye-head
  // system sized for it (gaze.js): its own look targets, how an aversion
  // splits between eyes and head, lids that follow the eye both ways, and the
  // reflex in step 8b.
  const ocu = opts.oculomotor || {};
  if (ocu.targets) gaze.targets = { ...GAZE_TARGETS, ...ocu.targets };
  if (ocu.avert) gaze.avertSplit = ocu.avert;
  if (ocu.angles) gaze.angles = ocu.angles;
  if (ocu.lidFollow) gaze.lidFollow = ocu.lidFollow;
  if (ocu.head) { gaze.headAccel = ocu.head.accel; gaze.headSpeed = ocu.head.speed; }
  // Pupil units of counter-rotation per head unit: the reflex's gain times
  // the ratio of what one unit of each is in degrees. The gain may differ by
  // axis ({x, y}): a face whose pitch reads weaker than its yaw wants less
  // of the eyes' answer to it.
  const vorGain = typeof ocu.vor === 'object' ? ocu.vor : { x: ocu.vor, y: ocu.vor };
  const vor = ocu.vor && ocu.angles
    ? { x: vorGain.x * ocu.angles.head.x / ocu.angles.eye.x,
        y: vorGain.y * ocu.angles.head.y / ocu.angles.eye.y }
    : null;
  // How far the reflex may carry the eye in its socket, in pupil units:
  // Guitton & Volle's effective oculomotor range; the rig supplies the reach.
  const reach = ocu.range || { x: 1, up: 1, down: 1 };
  const reflexX = (px) => clamp(px + vor.x * (aim.x - cur.headYaw), -reach.x, reach.x);
  const reflexY = (py) => clamp(py + vor.y * (aim.y - cur.headPitch), -reach.up, reach.down);
  // The head the eyes' target was authored against, smoothed at the eye's
  // own tau so a shift's compensation moves with the saccade, not ahead of it.
  const aim = { x: 0, y: 0 };
  let wanderAt = 0;
  let driftAt = 0;
  let trunkYaw = 0;
  let glanceAt = 0;
  let glanceUntil = 0;
  let lastBack = null;
  // THINKING's second look inside a look away: when it moves, where to, and
  // how long the brows stay up for it.
  let dartAt = 0, dartBrowUntil = 0;
  const dart = { x: 0, y: 0 };
  // The state whose gaze is showing, and when the current state takes it
  // over if that is still pending (GAP_SETTLE). Usually the same state.
  let gazeState = 'IDLE';
  let settleAt = 0;
  // Reading scan: position in the line and the block, see readStep.
  let readCol = 0, readCols = 0, readRow = 0, readRows = 0;
  let attendUntil = 0;
  let speakClock = null;
  let speakStart = 0;

  const cur = Object.assign({}, REST);
  const target = Object.assign({}, REST);
  // The head axes again, carrying only what is held (step 6b).
  const hold = { headYaw: 0, headPitch: 0, headRoll: 0 };
  // What the rig is handed: `cur` with the reflex applied to the eyes. The
  // same object when there is no reflex.
  const shown = vor ? Object.assign({}, REST) : cur;

  function applyGaze(blink) {
    const g = gazeOverrideByClip || gazeName;
    gaze.set(g, gazeOverrideByClip ? null : gazeCustom, blink);
  }

  // --- the frame ------------------------------------------------------------
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  // `manual` withholds the rAF loop so a tool can drive frames itself.
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

    if (settleAt && elapsed >= settleAt) { settleAt = 0; enterGaze(stateName, {}, true); }
    const st = states[stateName] || states.IDLE;
    // What the eyes are doing belongs to the state that has the gaze.
    const gst = states[gazeState] || st;

    // 1. base pose: rest + emotion + state-specific overlay
    for (const c of CHANNELS) target[c] = REST[c];
    const ep = emotionPose(emotion, emotionAmt);
    for (const k in ep) target[k] = REST[k] + ep[k];
    if (st.pose) for (const k in st.pose) target[k] = (target[k] || 0) + st.pose[k];
    // The head the state and emotion hold is an attitude, and the eyes are
    // authored inside it: the reflex (8b) keeps them on their target against
    // everything that moves the head except this.
    const poseYaw = target.headYaw, posePitch = target.headPitch;
    // What the head *holds*, accumulated alongside the pose as each layer that
    // holds one adds to it: the attitude above, the gaze, a phrase's pose and
    // the idle posture. Strokes, beats and clip deltas stay out — see 6b.
    for (const c of HEAD_AXES) hold[c] = target[c];

    // 2. gaze (absolute: pupils + partial head follow, plus the lid that rides
    //    with the eye — looking down without it bares sclera and reads as alarm)
    const g = gaze.update(elapsed, dt);
    for (const k in g) {
      if (k === 'trunkYaw' || k === 'aimYaw' || k === 'aimPitch') continue;
      target[k] = (k.startsWith('head') ? target[k] : 0) + g[k];
    }
    for (const c of HEAD_AXES) hold[c] += g[c];
    // The lid follows the eye as drawn, reflex and all — last frame's reading
    // of it, since the head it corrects for is not smoothed yet.
    const lid = gaze.lidBias(vor ? reflexY(g.pupilY) : g.pupilY);
    target.lidL += lid;
    target.lidR += lid;
    if (vor) {
      aim.x = approach(aim.x, poseYaw + g.aimYaw, TAU.pupilX, dt);
      aim.y = approach(aim.y, posePitch + g.aimPitch, TAU.pupilY, dt);
    }

    // 2b. the trunk follows the head. Sampled HERE, after gaze and before the
    //     clip layer, on purpose: a sustained turn toward the screen recruits
    //     the trunk, and a nod or a head shake does not — a body that swings
    //     with every gesture reads as a mannequin on a turntable. The lag is
    //     not authored anywhere; torsoTurn chases the same target at a slower
    //     TAU than the head (params.js), so the trunk leaves late and settles
    //     late for free, at the share TRUNK_FOLLOW names. It follows where the
    //     head is going and not the looks riding on it, and it holds through a
    //     glance: checking on the user is a look, not a turn toward them.
    if (!glanceUntil) trunkYaw = target.headYaw - g.headYaw + g.trunkYaw;
    target.torsoTurn += trunkYaw * TRUNK_FOLLOW;

    // 3. state-driven autonomous behaviour
    if (gst.wander && elapsed > wanderAt) {
      const w = gst.wander;
      // Dwell first, and sometimes for two periods. A dwell of exactly one
      // period every time is the metronome the eye reads as mechanical. The
      // old code broke that up by accident: a draw landing on the target
      // already held left the eyes still for another period. The freeze was a
      // bug — the schedule counted a hop that moved nothing — but the dwell
      // variety it produced was not, so it is kept deliberately, at the rate
      // it used to happen: 1/n, the odds a uniform draw repeats the target.
      const linger = Math.random() < 1 / w.targets.length ? 2 : 1;
      wanderAt = elapsed + linger * (w.every[0] + Math.random() * (w.every[1] - w.every[0]));
      // Then look somewhere the eyes are not. A wander set names a target more
      // than once deliberately — SEARCHING_SCREEN's repeats are its revisits,
      // the hunt coming back to the middle — but a revisit is arriving
      // somewhere again, not never having left it. Same bounded redraw as
      // pickBack, so a one-target set still terminates.
      let g = pick(w.targets);
      for (let i = 0; i < 4 && g === gazeName; i++) g = pick(w.targets);
      setGaze(g);
    }
    // Periodic glance (WORKING's look-up-at-you beat, THINKING's check-in
    // between two looks away). The return leg goes to the state's own gaze, or
    // to a fresh pick from `back` — a thinker does not look away at the same
    // spot every time. Either leg's gaze-evoked blink is the shift's odds
    // unless the state says (`blinkTo`, `blinkBack`), because which leg blinks
    // is part of what the glance means.
    if (gst.glance) {
      const gl = gst.glance;
      if (glanceUntil && elapsed > glanceUntil) {
        glanceUntil = 0;
        const away = rand(gl.every);
        glanceAt = elapsed + away;
        setGaze(gl.back ? pickBack(gl.back, gl.stick) : gst.gaze, null, gl.blinkBack);
        // At most one second look per look away, somewhere in its middle: a
        // move at the start is the same look landing, and one at the end runs
        // into the glance back.
        dartAt = gl.dart && Math.random() < gl.dart.p ? elapsed + away * (0.35 + Math.random() * 0.3) : 0;
      } else if (!glanceUntil && elapsed > glanceAt) {
        glanceUntil = elapsed + rand(gl.hold);
        setGaze(gl.to, null, gl.blinkTo);
        dartAt = 0;
        dart.x = dart.y = 0;
      }
      if (dartAt && elapsed > dartAt) {
        // On from where the eyes are, not back toward the user or across to
        // the other side: the thought moves, it does not turn round.
        dartAt = 0;
        const t = gaze.target;
        const a = Math.atan2(t.py, t.px) + (Math.random() < 0.5 ? -1 : 1) * DART_TURN;
        const m = gl.dart.mag * saccadeGain;
        dart.x = Math.cos(a) * m;
        dart.y = Math.sin(a) * m;
        dartBrowUntil = elapsed + DART_BROW;
      }
      const brow = (glanceUntil ? gl.brow || 0 : 0)
        + (gl.dart && elapsed < dartBrowUntil ? gl.dart.brow : 0);
      target.browRaiseL += brow;
      target.browRaiseR += brow;
    }
    gaze.scanEvery = gst.scan || null;
    // A state that reads scans a line; one with a dart holds its second look.
    // Neither during a glance: a check-in on the user is steady or it is not
    // one.
    if (gst.read && !glanceUntil) {
      if (elapsed > driftAt) readStep(gst.read);
    } else {
      gaze.drift.x = glanceUntil ? 0 : dart.x;
      gaze.drift.y = glanceUntil ? 0 : dart.y;
    }
    // Aversion is a property of the state, but it is held off around a turn
    // boundary: the floor is handed over under mutual gaze, and an avatar that
    // looks away exactly as the user finishes has declined it. `attend` is the
    // mixer's one-frame veto — anything that means "the user is checking
    // whether I am with them" sets it (see api.attend).
    gaze.setAversion(gst.aversion ? AVERSION[gst.aversion] : null);
    gaze.hold = attendUntil > elapsed || clip.playing;

    engagement.enabled = !!st.engagement && !clip.playing;
    engagement.update(dt);
    // Engagement posture: forward lean while the user holds the floor, spent
    // only in the states that are *about* the user holding the floor. The
    // research (docs/research-biomechanics.md §6.3) puts sustained attentive
    // lean at +0.15–0.25; engage glides, and torsoLean's 0.24s tau smooths
    // the state gate, so the lean arrives and leaves like weight shifting.
    if (st.engagement) {
      target.torsoLean += 0.16 * engagement.engage;
      // The shoulders come with it. A lean is a whole upper body arriving, and
      // in a head-and-shoulders crop the shoulder line is the part of it that
      // is actually on screen — §6.1 calls a shoulder rise the most legible
      // thing this framing can draw. Without this the listening shoulders were
      // the posture shift's ±0.07 and nothing else, so the one channel that
      // could show attention sat still through every turn the user took.
      // It rides `engage`, so it is contingent on the user's voice rather than
      // on the state: quick in, slow out, and gone a few seconds into silence.
      target.shoulderL += ENGAGE_SHOULDER * engagement.engage;
      target.shoulderR += ENGAGE_SHOULDER * engagement.engage;
    }
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
      // Rounding coming up is held against the shape's own (VisemeTrack.sample).
      if (mouth.round > shape.mouthRound) shape.mouthRound = mouth.round;
      // Gain pivots on the rest shape, not on zero: scaling absolute values would
      // drag the closed mouth open, which is the one thing lipsync must never do.
      for (const k in shape) {
        target[k] = mouthGain === 1
          ? shape[k]
          : REST_SHAPE[k] + (shape[k] - REST_SHAPE[k]) * mouthGain;
      }
      // Clip-owned mouths are exempt — a spoken OKAY *is* the warmth episode —
      // and only the base is scaled, so a gesture clip can still smile over a
      // sentence by authoring corner keys (they add, unscaled, in step 5).
      if (mouthOwner !== 'clip') {
        target.mouthCornerL *= SPEAK_SMILE_RETAIN;
        target.mouthCornerR *= SPEAK_SMILE_RETAIN;
      }
    }

    // 4b. speech prosody: pause blinks, inbreaths, a head held per phrase and
    //     moved between them, beats and turn-edge warmth, read off the cue
    //     track (prosody.js has the research, head.js the hold-and-move). Off while a clip is gesturing, since the clip is
    //     already the head's and the brows' story. The warmth is withheld
    //     under an emotion whose corners are down: a smile starting a turn of
    //     concern is the wrong face, whatever the rhythm says.
    const pro = prosody.update(speech, mouthOwner === 'speech' && !clip.playing, dt);
    // The warmth rides over a clip, because an acknowledgement's smile is
    // *with* its nod: behind the clip gate it arrived as the nod finished, a
    // smile at nothing. It is withheld under a clip whose own corners go down
    // (a shake, a sorry) for the same reason as under a concerned emotion.
    const clipFrowns = !!clipOut.delta
      && Math.min(clipOut.delta.mouthCornerL || 0, clipOut.delta.mouthCornerR || 0) < 0;
    const warm = clipFrowns || ((EMOTIONS[emotion] || EMOTIONS.neutral).mouthCornerL || 0) < 0
      ? 0 : prosodyFaceGain;
    target.mouthCornerL += pro.mouthCornerL * warm;
    target.mouthCornerR += pro.mouthCornerR * warm;
    target.squintL += pro.squintL * warm;
    target.squintR += pro.squintR * warm;
    if (!clip.playing) {
      target.headPitch += pro.headPitch * prosodyHeadGain * headGain.headPitch;
      target.headYaw += pro.headYaw * prosodyHeadGain * headGain.headYaw;
      target.headRoll += pro.headRoll * prosodyHeadGain * headGain.headRoll;
      for (const c of HEAD_AXES) hold[c] += pro.hold[c] * prosodyHeadGain * headGain[c];
      // The trunk follows a speech pose the way it follows a gaze turn (2b),
      // and for a second reason on a 2.5-D head: a turn the shoulders take
      // part of is a turn the neck does not have to stretch for, and the
      // stretch is the one thing a video reviewer saw on every pose change.
      // Scaled with the yaw it follows: a trunk that kept its old share of a
      // wider turn would be the neck stretching again, which is the defect
      // this line exists to fix.
      target.torsoTurn += pro.trunkYaw * prosodyHeadGain * headGain.headYaw * TRUNK_FOLLOW;
      target.browRaiseL += pro.browRaiseL * prosodyFaceGain;
      target.browRaiseR += pro.browRaiseR * prosodyFaceGain;
      target.browInnerL += pro.browInnerL * prosodyFaceGain;
      target.browInnerR += pro.browInnerR * prosodyFaceGain;
      target.browAngleL += pro.browAngleL * prosodyFaceGain;
      target.browAngleR += pro.browAngleR * prosodyFaceGain;
      target.lidL += pro.lidL * prosodyFaceGain;
      target.lidR += pro.lidR * prosodyFaceGain;
      target.breath += pro.breath * idle.gain;
      // The trunk's share of speech rhythm. Scaled by `idle.gain` and not by
      // `prosodyHeadGain`, because this is body liveness and that is the knob a
      // host turns down when it is re-encoding the avatar into an outgoing
      // stream — the same factor `idle.js`'s shoulders and lean already take.
      target.shoulderL += pro.shoulderL * idle.gain;
      target.shoulderR += pro.shoulderR * idle.gain;
      target.torsoLean += pro.torsoLean * idle.gain;
    }
    if (pro.blink) idle.phraseBlink();

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
    for (const k in il.add) target[k] = (target[k] || 0) + il.add[k] * (headGain[k] ?? 1);
    for (const c of HEAD_AXES) hold[c] += (il.add[c] || 0) * headGain[c];

    // 6b. the held-head budget (internal-mixer.md § The held-head budget).
    //     Only the excess over `soften` comes off, and only off the hold: a
    //     nod, a beat and a clip keep every degree they were authored with,
    //     which is why this is subtracted here rather than applied to the pose.
    for (const c of HEAD_AXES) {
      if (headHold[c] === undefined) continue;
      target[c] -= hold[c] - soften(hold[c], headHold[c]);
    }

    // 6c. the body answers a held tilt (SHOULDER_TILT). The trunk takes the
    //     same share of it that it takes of a turn in 2b — Live2D gives its
    //     body the same fraction of AngleZ as of AngleX (research-head-rotation
    //     .md §3) — and the shoulder line tips with the head. Both channels
    //     smooth slower than the head (TAU), so the body leaves late and
    //     settles late, and that follow-through is most of what separates a
    //     neck bending from a hinge.
    //     Only the *held* roll, and after the budget: a stroke or a clip's roll
    //     is a gesture riding on the pose, and a body that answers those is 2b's
    //     mannequin on a turntable. The idle layer's own posture is already
    //     coupled the other way round, from the weight shift to the head that
    //     counter-tips on it (idle.js `nextPosture`); this is that arrangement
    //     read from the head's end, and where both are in play they agree in
    //     sign — weight onto a side, head over that side, that shoulder up.
    const heldRoll = headHold.headRoll === undefined
      ? hold.headRoll
      : soften(hold.headRoll, headHold.headRoll);
    target.torsoTurn += heldRoll * TRUNK_FOLLOW;
    target.shoulderR += heldRoll * SHOULDER_TILT;
    target.shoulderL -= heldRoll * SHOULDER_TILT;

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

    // 8b. The vestibulo-ocular reflex. Here and not in the gaze layer because
    //     only here is the head that is actually drawn known: prosody, clips
    //     and idle all land after gaze.
    if (vor) {
      Object.assign(shown, cur);
      if (!overrides || overrides.pupilX === undefined) {
        shown.pupilX = clamp(reflexX(cur.pupilX), RANGE.pupilX[0], RANGE.pupilX[1]);
      }
      if (!overrides || overrides.pupilY === undefined) {
        shown.pupilY = clamp(reflexY(cur.pupilY), RANGE.pupilY[0], RANGE.pupilY[1]);
      }
    }

    // 9. First-class hand control. The semantic frame is generated here, above
    // every renderer, so SVG, WebGL, and video rigs receive exactly the same
    // gesture/progress information. A handless rig simply ignores `frame.hand`.
    const handFrame = updateHandAction(elapsed * 1000);
    rig.apply(avatarFrame(shown, handFrame || undefined));
  }

  const REST_SHAPE = shapeFor(SILENT, 1);

  // How much of a sustained head turn the trunk takes up. Well under 1: people
  // under-rotate the head and then under-rotate the trunk again behind it, and
  // at a head-and-shoulders crop the trunk's share is the part you register
  // without noticing. A rig may pass its own `trunkFollow`: on a mesh head whose
  // neck twists, the trunk's sway is most of what moves the neck's outline, so
  // the share that reads as a body on a line face reads there as the neck
  // sliding.
  const TRUNK_FOLLOW = opts.trunkFollow ?? 0.45;

  // The channels speech owns outright — exactly the params.js mouth group
  // (mouth corners stay free: a clip may smile over a sentence).
  const MOUTH_LOCK = new Set(GROUPS.mouth);

  /** The shoulders' share of the attentive posture: two thirds of the lean the
   *  engagement layer spends — the shoulders come up with it, they do not lead it. */
  const ENGAGE_SHOULDER = 0.10;

  // What survives of the resting/emotion smile while speech owns the mouth.
  // A smile held static through a sentence is discounted as insincere, and
  // corners riding every open viseme read as laughing through the words: warmth
  // must be episodic (research-perception.md §3). Full warmth returns the moment
  // the track ends, which is that onset/offset.
  const SPEAK_SMILE_RETAIN = 0.35;

  // Between the user's turn and the reply the server's claim can change
  // several times a second — THINKING, a tool's WORKING, THINKING again, a
  // grace timer's CANT_HEAR — and every change used to retarget the eyes and
  // restart the state's looks: one fast tool call was away, down at the
  // screen, back to the user and away again inside a second, a blink at each.
  // Among these states the eyes change over only once the new one has held
  // this long, and a claim that returns before then moves nothing. The pose
  // still changes at once — it is the eyes that make a flicker visible.
  // SPEAKING and LISTENING are never held back: those are the floor.
  const GAP_STATES = new Set(['THINKING', 'WORKING', 'CANT_HEAR']);
  const GAP_SETTLE = 0.5;

  // A dart leaves at up to 40° off the line of the look it is inside, and
  // lifts the brows for half a second — a thought arriving, not a stare.
  const DART_TURN = 0.7;
  const DART_BROW = 0.5;

  /** A look away for the return leg of a glance. `stick` of the time it keeps
   *  the side the last one took, spot and all — the side a person thinks
   *  toward is theirs, and it outlasts one thinking pause. Otherwise any look
   *  but the one just taken: a thinker who goes back to the same patch of
   *  wall every time *without* meaning to is a loop. */
  function pickBack(xs, stick = 0) {
    const side = (n) => Math.sign(gaze.targets[n].px);
    let g;
    if (lastBack && Math.random() < stick) {
      const same = xs.filter((n) => side(n) === side(lastBack));
      g = pick(same.length ? same : xs);
    } else {
      g = pick(xs);
      for (let i = 0; i < 4 && g === lastBack; i++) g = pick(xs);
    }
    lastBack = g;
    return g;
  }

  /**
   * One fixation of a reading scan: a step along the line, or at its end a
   * sweep back to the start of the next, or at the end of the block a pause
   * on the result. That is what busy-at-a-screen looks like from the other
   * side of a webcam — an irregular left-to-right march with returns, which
   * a random drift about a point is not. Steps are held, like a reader's
   * fixations, and the head sits out all of it (DRIFT_HEAD in gaze.js).
   */
  function readStep(r) {
    const n = ([a, b]) => a + ((Math.random() * (b - a + 1)) | 0);
    if (readCol < readCols) {
      readCol++;
      driftAt = elapsed + rand(r.fix);
    } else {
      readCol = 0;
      readCols = n(r.steps);
      if (++readRow >= readRows) {
        readRow = 0;
        readRows = n(r.lines);
        driftAt = elapsed + rand(r.pause);
      } else {
        driftAt = elapsed + rand(r.fix) * 1.4;
      }
    }
    gaze.drift.x = (readCol / readCols - 0.5) * r.width * saccadeGain;
    gaze.drift.y = (readRow - (readRows - 1) / 2) * r.line * saccadeGain;
  }

  // --- API ------------------------------------------------------------------

  function setState(name, o = {}) {
    if (!states[name]) throw new Error(`unknown state: ${name}`);
    const changed = name !== stateName;
    stateName = name;
    const st = states[name];
    if (o.emotion !== undefined) emotion = o.emotion;
    else if (changed) emotion = st.emotion;
    if (o.intensity !== undefined) emotionAmt = o.intensity;
    idle.setProfile(st.idle);
    // SVG's desaturation filter is a legacy renderer detail. A generic rig
    // receives the same state pose and may express degradation its own way.
    if (face) {
      face.svg.style.filter = st.filter || '';
      face.svg.style.transition = 'filter .5s ease';
    }
    // The eyes wait out a flicker between gap states (GAP_SETTLE), and a
    // repeat of the state still settling leaves it settling.
    const deferrable = !o.gaze && !o.keepGaze && GAP_STATES.has(gazeState) && GAP_STATES.has(name);
    if (deferrable && changed) settleAt = name === gazeState ? 0 : elapsed + GAP_SETTLE;
    else if (!(deferrable && settleAt)) { settleAt = 0; enterGaze(name, o, changed); }
    // The floor has come back to the user: the face receives it (prosody.js
    // `listen`). It is a state change rather than a VAD event on purpose —
    // what is being welcomed is the turn, and the server is the one that knows
    // a turn has changed hands.
    if (changed && name === 'LISTENING') prosody.listen();
    if (changed) emit('state', name);
    return api;
  }

  // Whether the eyes were last aimed by somebody who meant it — the public
  // `setGaze`, or a performance's `gaze` verb — rather than by the state's own
  // schedule. It is the one thing that outranks a state's `gaze`, and it is
  // why `speak()` can take the eyes back without overriding a caller.
  let gazeExplicit = false;

  /** The state `name` takes the gaze: its target and its schedules. */
  function enterGaze(name, o, blink) {
    gazeState = name;
    const st = states[name];
    const gl = st.glance;
    // A state with an `opening` enters as though its check-in on the user is
    // already under way, and leaves it when that runs out.
    if (!o.keepGaze) { setGaze(o.gaze || (gl && gl.opening ? gl.to : st.gaze)); gazeExplicit = false; }
    // Arm every scheduler fresh, so entering a state never fires a timestamp
    // left over from the last one — the wander in particular, which used to
    // pick a new target on the first frame and override the state's own gaze.
    glanceUntil = gl && gl.opening && !o.gaze && !o.keepGaze ? elapsed + rand(gl.opening) : 0;
    glanceAt = elapsed + (gl ? rand(gl.every) : 0);
    wanderAt = elapsed + (st.wander ? rand(st.wander.every) : 0);
    driftAt = elapsed + (st.read ? rand(st.read.fix) : 0);
    readCol = readCols = readRow = readRows = 0;
    dartAt = dartBrowUntil = 0;
    dart.x = dart.y = 0;
    if (blink) idle.blink(true);
  }

  function setEmotion(name, intensity = 1) { emotion = name; emotionAmt = intensity; return api; }

  /** @param {string} name  @param {{x:number,y:number}} [custom] normalized -1..1
   *  @param {boolean} [blink] the mixer's own say over the evoked blink; see GazeLayer.set */
  function setGaze(name, custom, blink) {
    gazeName = GAZE_TARGETS[name] ? name : 'USER';
    gazeCustom = custom || null;
    applyGaze(blink);
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
    // A new clock is a new turn. The same clock handed back is the accurate
    // leg rewriting this one (AvatarClient re-speaks a splice), and that must
    // not roll the turn-start look a second time.
    const newTurn = !o.clock || o.clock !== speakClock;
    speakStart = performance.now();
    speakClock = o.clock
      ? o.clock
      : o.audio
        ? () => o.audio.currentTime * 1000
        : () => performance.now() - speakStart;
    speech.start(o.cues || [], speakClock);
    prosody.reset(newTurn);
    // The eyes come back to the user when the audio starts: a reply arriving
    // while THINKING was looking away would otherwise spend its whole turn
    // aimed off the user, because nothing in SPEAKING retargets. `keepGaze` is
    // for the one caller that means it — a performance that aimed the eyes with
    // its own `gaze` verb keeps them, an instruction and not a leftover.
    if (stateName !== 'SPEAKING') setState('SPEAKING', { keepGaze: gazeExplicit });
    if (o.audio && o.audio.paused) o.audio.play().catch(() => {});
    return api;
  }

  /**
   * "The user may be checking whether I am with them — hold their eyes."
   *
   * This is the widget's half of the **gaze window**. In face-to-face talk a
   * speaker periodically looks at the listener, mutual gaze is established, the
   * listener responds inside that window, and the speaker looks away again
   * (Bavelas, Coates & Johnson 2002).
   *
   * We cannot see the user, so we cannot observe the window opening. What a
   * caller *can* do is name the moments that co-occur with it — a mid-turn
   * pause, a tag question ("...right?", "you know?"), a completed clause with
   * the turn analyzer's completion probability high, the user answering a
   * question the bot asked. For `ms` the face stops averting and holds the
   * user, which is the prerequisite for any response to be *seen*.
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
  function action(wireId) {
    // `ACKNOWLEDGE` is the whole backchannel family in one word, and which of
    // them a face makes is a rendering decision the server is not holding the
    // drawing for. The floor decides: a nod while the user still has it is a
    // continuer, "go on"; once they have stopped it is a receipt, and a nod
    // there reads as agreement with whatever they just said. Both are only ever
    // this explicit action — nothing here starts one on its own.
    const id = wireId === 'ACKNOWLEDGE'
      ? (engagement.speaking ? 'ACK_NOD' : 'ACK_RECEIVE')
      : wireId;
    const handDef = HAND_GESTURES[id];
    if (handDef) {
      startHandAction(id, handDef);
      if (handDef.face) {
        const faceClip = actionShapes[handDef.face] || ACTIONS[handDef.face];
        if (faceClip) clip.play(faceClip, faceClip.audioEl, { queue: true });
      }
      return api;
    }
    // Own renderings first, always. An avatar may *add* to what a server can
    // ask for and may never redefine a core intent: `ACKNOWLEDGE` has to mean
    // the same thing on every face or it is not a protocol. It may draw that
    // meaning in its own shape (`actionShapes`), which is a rendering, not a
    // redefinition — the id and the intent are fixed before this line.
    //
    // Unknown is a no-op, not a throw. The wire's action vocabulary is open, so
    // a server asking this face for a motion it does not have is the expected
    // case and not somebody's broken build — the same forward-compat rule an
    // unknown `cmd` gets. This is also where a sequence used to arrive by its
    // own method; one open vocabulary means one door.
    const faceClip = actionShapes[id] || ACTIONS[id] || sequences[id];
    if (!faceClip) return api;
    clip.play(faceClip, faceClip.audioEl, { queue: true });
    // The acknowledgements smile. Only these, and only ever because the
    // server sent one: a smile the renderer timed for itself would be an
    // acknowledgement nobody sent.
    if (id === 'ACK_NOD' || id === 'ACK_RECEIVE') prosody.acknowledge();
    // Now that warmth rides over clips, the reply's opening smile would
    // otherwise carry on through the interrupted face.
    if (id === 'RESPONSE_INTERRUPTED') prosody.cool();
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
      else if (a.do === 'gaze') { setGaze(a.name); gazeExplicit = true; }
      else if (a.do === 'action') action(a.id);
    } catch (e) {
      console.warn(`perform: ${a.do} at ${a.t}ms skipped — ${e.message}`);
    }
  }

  let performGen = 0;

  /**
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
    setState, setEmotion, setGaze: (name, custom) => { gazeExplicit = true; return setGaze(name, custom); }, speak, pushCues, stopSpeaking, attend,
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
    blink: () => { idle.blink(); return api; },
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
    get params() { return shown; },
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

// The parameter space itself. A renderer-neutral rig has to answer "what is
// this channel's neutral value" before it can map the channel onto whatever it
// controls — a morph target's influence is `(pose - rest) / (1 - rest)`, and a
// rig that hard-codes those rests has quietly forked `params.js`.
export { REST, CHANNELS, RANGE, TAU, clamp, approach, makeParams } from './params.js';
// The smoothing law itself, for a tool that steps the rig by hand. A
// filmstrip that reimplemented `approach` would be measuring its own copy of
// the thing under test — and the smoothing between keyframes is what the face
// actually does (docs/internal-mixer.md § Smoothing).
// A pose with no mixer above it: `makeParams(overrides)` fills the rests,
// `avatarFrame` wraps it, `createSvgRig(face).apply` draws it. That is the whole
// path an instrument needs to hold a face at one named extreme — no clock, no
// client, no animation — and the reason it is exported is that a pose sheet
// that cannot reach it forks the channel rests instead.
export { avatarFrame, createSvgRig } from './rig.js';
export { ACTION_IDS, ACTIONS, attachAudio } from './interjections.js';
// The full authoring catalogue and the player that steps it. Not a server
// vocabulary — `ACTIONS` is that, and most of these clips are reachable only
// from inside the mixer. They are exported for the filmstrip instrument,
// which lays one clip out as frames and therefore has to drive a real
// `ClipPlayer` rather than re-sample its keys.
export { INTERNAL_CLIPS } from './interjections.js';
export { ClipPlayer } from './clips.js';
export { GAZE_NAMES, GAZE_TARGETS } from './gaze.js';
export { normalizeActions } from './perform.js';
export { checkHandFraming } from './hand.js';
export { EMOTION_NAMES, emotionPose } from './emotions.js';
// The mouth clock travels with the rest of it. Someone has to turn a cue array
// plus a clock into "which letter is on screen right now", every renderer needs
// exactly that, and none of them should write it twice — so it is a plain class
// to construct, not a contract to implement.
export {
  VISEME_LETTERS, VISEME_SHAPES, VisemeTrack, shapeFor, JAW_OF_OPEN, SILENT,
  normalizeCues, textToCues,
  ARPABET_TO_VISEME, AZURE_VISEME_TO_LETTER, LEAD_MS,
} from './visemes.js';
// No THEME re-export: each face module owns its palette, and `api.theme` is
// the mounted avatar's. A single barrel THEME was one rig's palette wearing a
// public name — misleading the moment that rig stopped being the default.
