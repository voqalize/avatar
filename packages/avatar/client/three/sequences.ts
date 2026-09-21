/**
 * The Blender avatars' own addressable motions, and their own shape for the one
 * shared action whose keys do not fit a head that turns in degrees.
 *
 * These are *shapes*, authored in a rig whose pose unit is a degree, and a
 * server addresses them by name with `cmd: "action"` when it knows which avatar
 * is mounted. The wire's action vocabulary is open, so they need no promotion
 * and are not trying to get one; a face without them ignores the message
 * ([contract-wire.md](../../../docs/contract-wire.md) § Action).
 *
 * **Why nods get three shapes and one intent.** A 2025 ICMI motion-capture
 * corpus of 90 attentive-listening dialogues separates nodding into three types
 * and publishes the distribution (research-biomechanics.md § 3.3):
 *
 * | type | what it co-occurs with | share of nods | mean duration |
 * |---|---|---:|---:|
 * | `short` | continuer backchannel — "mm-hm, go on" | 49% | 0.83 s |
 * | `long` | assessment, lexical response — "yes, that's right" | 40% | 1.42 s |
 * | `long_p` | a cognitive shift — "ah, I see" | 12% | 1.75 s |
 *
 * Their gloss: "nodding co-occurring with continuer backchannel has a smaller
 * average range of movement, whereas that co-occurring with assessment
 * backchannel and lexical responses has a larger average range", and "nodding
 * with swinging up is regarded to reflect a cognitive shift in the listener."
 *
 * That is three different things to say, not three sizes of one thing — which
 * is exactly why they are this avatar's own names and not three spellings of
 * one. `ACKNOWLEDGE` remains the portable "acknowledge the user" that every
 * renderer answers, and resolves to the continuer here; a server that knows it
 * is driving tara can say *which* nod.
 *
 * **How big, in degrees** (research-head-rotation.md § 2.3, peak-to-peak):
 * a continuer 3–5°, one stroke that returns as far as it went; agreement 6–10°,
 * single, ample and stressed; "oh, I see" 6–10°, opening upward. People's nods
 * are narrower than they look — Blomsma 2024 measures 5.95° on average at
 * backchannel opportunities, Kato 2026 about 4° — and a nod past them stops
 * reading as listening and starts reading as the head dropping.
 *
 * **§ 3.4's structural laws hold in every clip here**, because the paper's
 * finding is that flat repeated cycles are what real nods are not:
 *
 *   1. *Anticipatory rising* — a longer nod starts bigger, from the first
 *      cycle. The head knows how long the nod will be before it begins.
 *   2. *Declination* — each cycle is smaller than the one before it, by about
 *      0.7× (Mori 2025).
 *   3. *Under 1.5 Hz* — above it a nod reads as impatience rather than
 *      attention, and the head's own 160 ms smoothing eats most of it anyway.
 *      People repeat nods at 2–3.5 Hz; the cap is a perceptual choice and it
 *      stays, so a repeated nod here is slower than a person's.
 *
 * **Amplitudes are pre-compensated and the numbers are not free.** A stroke is
 * a target the head chases at a 160 ms time constant, so what renders is well
 * under what is written. `test/nods.test.ts` steps the real mixer and holds
 * each clip's rendered degrees to its band; the degrees quoted below are its.
 *
 * TARA-SPECIFIC: the keys are pose units, and a pose unit becomes degrees
 * through the mounted avatar's `HEAD_DEG` — tara's is 24° of pitch at the
 * ±1.4 clamp, 17.1° a unit. A second Blender avatar with another envelope
 * renders these same keys at other angles, and the degrees are recorded per
 * character where they are measured rather than here.
 */
import { ACTION_IDS, ACTIONS, CORE_ACTION_IDS } from "../internal.js";
import type { AvatarSupport } from "../internal.js";

type Keyframes = Record<string, [number, number][]>;
interface Sequence {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly duration: number;
  readonly keys: Keyframes;
}

/**
 * The continuer. "Go on, I'm with you" — half of all nods, and the one the
 * avatar would be doing most if a server drove every backchannel.
 *
 * One stroke down and back, because a continuer is "a single small nod" (Kato
 * 2026) and within a cycle the return is as big as the stroke (Mori 2025): no
 * rebound above neutral, which on a head that really rotates reads as a second,
 * upward nod. The stroke is fast and the return takes its time, which is what
 * makes it a beat rather than a bob. 720 ms, inside the 0.5–0.8 s a single
 * small nod lasts.
 *
 * **No preparatory up-beat, and that is a rate constraint rather than taste.**
 * An earlier draft opened with a dip, which put a turning point 308 ms before
 * the down-peak — 1.63 Hz. The corpus lists the swing-up as optional on `short`
 * and mandatory only on `long_p`, so the one that had to go was the one never
 * carrying meaning.
 *
 * The trunk sets forward a fraction and the shoulders with it — about a fifth
 * and a third of the shared `ACK_NOD`'s — because a head that nods on a body
 * that does not move is a head on a stick, and more than that turns "go on"
 * into leaning in.
 *
 * Renders ~4° of chin-down on tara.
 */
const NOD_SMALL: Sequence = {
  id: "NOD_SMALL", label: "nod: continuer", text: "", duration: 720,
  keys: {
    headPitch: [[0, 0], [0.36, 0.34], [1, 0]],
    // The lid dip is what separates a nod from a bob: eyes stay with the user
    // and close a fraction on the beat.
    lidL: [[0, 0], [0.40, 0.045], [1, 0]],
    lidR: [[0, 0], [0.40, 0.045], [1, 0]],
    torsoLean: [[0, 0], [0.40, 0.026], [1, 0]],
    shoulderL: [[0, 0], [0.46, 0.019], [1, 0]],
    shoulderR: [[0, 0], [0.46, 0.019], [1, 0]],
  },
};

/**
 * The assessment nod — "yes, that's right".
 *
 * Agreement is "single, ample and stressed" (Poggi), larger and faster than
 * feedback (Bauer 2024), so it is one stroke with a hold at the bottom rather
 * than the continuer made bigger: the hold is the stress, and it is what keeps
 * a large nod from reading as a twitch. About twice the continuer's depth.
 *
 * It aliased the shared `ACK_NOD` until 2026-09-14. That clip is two strokes
 * sized for a line face, and on a head that really rotates it rendered 15°,
 * which is past every row of research § 2.3.
 *
 * Renders ~8° of chin-down on tara.
 */
const NOD_ASSESS: Sequence = {
  id: "NOD_ASSESS", label: "nod: assessment", text: "", duration: 1000,
  keys: {
    headPitch: [[0, 0], [0.26, 0.56], [0.50, 0.50], [1, 0]],
    lidL: [[0, 0], [0.28, 0.06], [0.55, 0.04], [1, 0]],
    lidR: [[0, 0], [0.28, 0.06], [0.55, 0.04], [1, 0]],
    torsoLean: [[0, 0], [0.32, 0.04], [0.60, 0.03], [1, 0]],
    shoulderL: [[0, 0], [0.40, 0.025], [1, 0]],
    shoulderR: [[0, 0], [0.40, 0.025], [1, 0]],
  },
};

/**
 * "Ah — I see." The realisation nod, and the only one that *starts by going
 * up*.
 *
 * The swing-up is the whole gesture, not an ornament: it is what the corpus
 * separates `long_p` from `long` by, and what makes this read as a mind
 * changing rather than a head agreeing (Mori 2022: upward-first marks a change
 * of state). Then two declining beats at 1.30 Hz, the second about 0.65 of the
 * first.
 *
 * Longest of the three at 1.75 s, and that is the corpus mean for this type —
 * a realisation takes longer than an agreement because something happened in
 * between.
 *
 * Renders ~3.5° of chin-up, then ~6° of chin-down, on tara.
 */
const NOD_REALIZE: Sequence = {
  id: "NOD_REALIZE", label: "nod: realisation", text: "", duration: 1750,
  keys: {
    // Same as the assessment nod: no trailing flourish. A −0.08 at 0.95 put two
    // return beats 542 ms apart, 1.85 Hz, which is a twitch on the way out of a
    // gesture whose whole point is the deliberate lift at the start.
    headPitch: [[0, 0], [0.14, -0.30], [0.40, 0.48], [0.64, -0.12], [0.84, 0.30], [1, 0]],
    // Brows up with the swing and down as the nod lands: the face arrives at
    // the understanding before the head finishes agreeing with it.
    browRaiseL: [[0, 0], [0.16, 0.42], [0.46, 0.10], [1, 0]],
    browRaiseR: [[0, 0], [0.16, 0.38], [0.46, 0.10], [1, 0]],
    lidL: [[0, 0], [0.14, -0.08], [0.42, 0.06], [1, 0]],
    lidR: [[0, 0], [0.14, -0.08], [0.42, 0.06], [1, 0]],
    // The corners come up late, on the second beat. Warmth that arrives *with*
    // the realisation reads as having known already.
    mouthCornerL: [[0, 0], [0.55, 0.10], [0.84, 0.26], [1, 0.12]],
    mouthCornerR: [[0, 0], [0.55, 0.10], [0.84, 0.26], [1, 0.12]],
  },
};

/**
 * "No." The head shake, and it had to be authored for this rig rather than
 * borrowed.
 *
 * `INTERNAL_CLIPS.HEAD_SHAKE` is written in pose units that mean pixels on a
 * line face. On tara a pose unit is a degree, and that clip's +-0.55 lands at
 * +-3.5 deg authored and about +-2 deg rendered — ambient drift, not a refusal.
 * Two things had to change and only one of them is amplitude.
 *
 * **Yaw is the axis this rig is weakest on**, because the albedo is a front
 * projection of a shallow shell: a turn parallaxes rather than re-silhouettes.
 * Measured against the tile, though, it is not as weak as it looks — 8.7 deg
 * moves 13% of the pixels past a 16/255 delta and carries the silhouette 6 px,
 * which is comparable to what 5.7 deg of roll does. So a shake reads here; it
 * just has to actually reach those angles.
 *
 * **And it has to be slow enough to survive the smoothing.** The borrowed clip
 * swings at 1.42 Hz where the head returns about 0.57 of what it is asked for.
 * At 1.05 Hz it returns ~0.71, which buys a quarter more amplitude for nothing
 * and sits further from the impatience line a *refusal* can least afford to
 * cross.
 *
 * Renders about 11 deg peak-to-peak of yaw. § 3.4's laws again: first swing
 * biggest, every one after it smaller.
 */
const NOD_NO: Sequence = {
  id: "NOD_NO", label: "no (head shake)", text: "", duration: 1900,
  keys: {
    headYaw: [[0, 0], [0.14, -1.35], [0.39, 1.15], [0.64, -0.62], [0.85, 0.24], [1, 0]],
    // A small roll in phase with the turn, because a head that swings on one
    // axis alone is a turret. Kept to a fifth of the yaw: more and the refusal
    // starts reading as a wince.
    headRoll: [[0, 0], [0.14, -0.26], [0.39, 0.22], [0.64, -0.12], [1, 0]],
    // The set of the face is what makes it a "no" rather than a look around.
    // A refusal over a resting smile reads as teasing.
    mouthPress: [[0, 0], [0.18, 0.40], [0.82, 0.34], [1, 0]],
    mouthCornerL: [[0, 0], [0.22, -0.22], [1, 0]],
    mouthCornerR: [[0, 0], [0.22, -0.22], [1, 0]],
    browRaiseL: [[0, 0], [0.18, -0.24], [0.86, -0.12], [1, 0]],
    browRaiseR: [[0, 0], [0.18, -0.24], [0.86, -0.12], [1, 0]],
  },
};

/**
 * What a server may address on a Blender avatar by name, beyond the two every
 * avatar owes it.
 *
 * Shared by every character in this package rather than owned by tara, because
 * they are all driven through the same 30 channels. A character that needs its
 * own shape of one of these overrides that entry; it does not get a second
 * table.
 */
export const BLENDER_SEQUENCES = Object.freeze({
  NOD_SMALL, NOD_ASSESS, NOD_REALIZE, NOD_NO,
});

export type BlenderSequenceId = keyof typeof BLENDER_SEQUENCES;

/**
 * The Blender avatars' own shape for one of the mixer's own actions, passed to
 * it as `actions`. Same ids, same intent; only the rendering is theirs.
 *
 * **`ACK_NOD` is the continuer here.** It is the nod a server sends while the
 * user is still talking — "mm-hm, go on" — and that is half of all nods and
 * most of what this avatar does, because it listens far more than it speaks.
 * The shared clip is two strokes that render 15° on this head, which is past
 * even agreement (6–10°) and is what the owner read as the head dropping. A
 * server that means agreement or realisation, and knows a Blender avatar is
 * mounted, asks for `NOD_ASSESS` or `NOD_REALIZE`.
 *
 * Aliased rather than restated, so the continuer and the portable nod cannot
 * drift apart.
 *
 * The other shared clips with head keys stay shared, because they already
 * land inside their meaning on tara: `GESTURE_APPROVE` renders 8.8° of
 * chin-down (agreement's band), `GESTURE_GREET` 2.9° of chin-up, and
 * `GESTURE_WAIT` 5.2° of yaw.
 */
export const BLENDER_ACTIONS = Object.freeze({
  ACK_NOD: { ...NOD_SMALL, id: "ACK_NOD", label: "acknowledge: nod" },
});

// A shape for an action the mixer already has, never a new one: the mixer
// refuses an id that is not its own, and this keeps the table honest at the type
// level too. A *new* motion goes in the table above, which is the open door.
void (BLENDER_ACTIONS satisfies Partial<Record<keyof typeof ACTIONS, Sequence>>);

/**
 * What every character in this package answers to — each one's `supports`, the
 * optional declaration a driving UI reads (`AvatarSupport`).
 *
 * Derived rather than written down, because every part of it already exists: the
 * ids every avatar owes a server, the mixer's own clip catalogue these
 * characters inherit whole, and this file's own names. A hand-kept copy beside
 * them would only be able to disagree with them. `BLENDER_ACTIONS` adds nothing —
 * it re-shapes an id the mixer already has.
 *
 * It is one list for every 2.5-D character for the same reason the tables are:
 * they are one rig driven through one set of channels. A character that stops
 * being able to do one of these owes its own `supports`, not an edit here.
 */
export const BLENDER_SUPPORTS: AvatarSupport = Object.freeze({
  actions: Object.freeze([
    ...CORE_ACTION_IDS,
    ...ACTION_IDS.filter((id) => !(CORE_ACTION_IDS as readonly string[]).includes(id)),
    ...Object.keys(BLENDER_SEQUENCES),
  ]),
});
