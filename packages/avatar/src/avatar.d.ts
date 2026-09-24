/**
 * avatar.d.ts — hand-maintained types for the widget's public surface.
 *
 * The widget is dependency-free ES modules with no build step, so there is no
 * compiler to derive these from; this file is written by hand against
 * `docs/internal-mixer.md` (the mixer's driving API) and a
 * reading of `avatar.js`. It lives here rather than in a consumer because it
 * is only correct next to the code it describes — the previous copy lived in
 * a vendored tree two repos away and went stale the first time an enum grew.
 *
 * It is deliberately not a conversion of the widget to TypeScript. The
 * string-keyed enums (state / gaze / emotion / semantic action ids) are closed
 * literal unions, and there is no `| string` escape hatch on any setter: the
 * widget enforces the same enums at runtime — unknown state and action ids
 * throw, unknown emotion and gaze fall back silently — so a caller who wants
 * one of these has a name that is in the union or a bug. Keeping the two in
 * step is this file's whole job; a stale `.d.ts` must never claim to be
 * stricter than the code it describes, so widen the runtime first.
 */

/** `STATE_NAMES` — see docs/internal-mixer.md § States. */
export type AvatarStateName =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "WORKING"
  | "REVIEWING_SCREEN"
  | "WAITING_FOR_USER"
  | "TYPING_CHAT"
  | "DISTRACTED"
  | "SEARCHING_SCREEN"
  | "CANT_HEAR"
  | "TAKING_FLOOR"
  | "WANTS_IN"
  | "YIELDED"
  | "DEGRADED"
  | "OFFLINE";

/** `EMOTION_NAMES` — see docs/internal-mixer.md § Emotion. */
export type AvatarEmotionName =
  | "neutral"
  | "warm"
  | "curious"
  | "concerned"
  | "encouraging"
  | "thoughtful";

/** `GAZE_NAMES` — see docs/internal-mixer.md § Gaze. `"CUSTOM"` is the escape hatch (any name + a `custom` point works). */
export type AvatarGazeName =
  | "USER"
  | "USER_EAR"
  | "SCREEN_CENTER"
  | "SCREEN_LEFT"
  | "SCREEN_RIGHT"
  | "SCREEN_TOP"
  | "SCREEN_BOTTOM"
  | "SCREEN_WORK"
  | "NOTES"
  | "AWAY_THINKING"
  | "AWAY_RIGHT"
  | "AWAY_DOWN"
  | "AWAY_SIDE"
  | "CUSTOM";

/** The complete server-addressable action contract. Names are semantic, not
 * anatomical: a future rig may implement `ACK_NOD` without a literal nod. */
export type AvatarActionId =
  | "ACK_RECEIVE"
  | "ACK_NOD"
  | "RESPONSE_INTERRUPTED"
  | "GESTURE_GREET"
  | "GESTURE_GOODBYE"
  | "GESTURE_APPROVE"
  | "GESTURE_WAIT";

/** Rhubarb Lip Sync letter — see docs/internal-mixer.md § Speech. */
export type VisemeLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

/** One viseme cue: `t` is a ms offset into the utterance, `i` is optional 0..1 loudness. */
export interface Cue {
  t: number;
  v: VisemeLetter;
  /** 0..1. Absent means full. */
  i?: number;
}

/** A pose channel from `src/params.js` — see docs/internal-rig.md § The pose channels. */
export type PoseChannel =
  | "mouthOpen" | "mouthWidth" | "mouthRound" | "mouthPress" | "mouthTuck"
  | "mouthCornerL" | "mouthCornerR" | "teethUpper" | "tongue" | "jaw"
  | "lidL" | "lidR" | "squintL" | "squintR" | "pupilX" | "pupilY"
  | "browRaiseL" | "browRaiseR" | "browAngleL" | "browAngleR"
  | "browInnerL" | "browInnerR"
  | "headYaw" | "headPitch" | "headRoll"
  | "breath" | "shoulderL" | "shoulderR" | "torsoLean" | "torsoTurn";

/** A partial pose. Channels are clamped to `RANGE`; absent channels keep the mix. */
export type PoseOverrides = Partial<Record<PoseChannel, number>>;

/** Which hand the character gestures with: `1` the viewer's right (the
 * character's own left), `-1` the other. */
export type HandSide = 1 | -1;

/**
 * A motion scale. `1` is the amplitude the channel was authored at, `0` stills
 * it, and `2` is the documented ceiling — past that the smoothing constants
 * stop holding and clips overshoot their range clamp.
 *
 * TypeScript cannot say "0..2", so this is a named `number` and the check is at
 * the door: the public `createAvatar` throws `RangeError`. The live setters
 * below do not, because they exist for review sliders that already bound
 * themselves and should not throw mid-drag.
 */
export type Gain = number;

/** Normalized-screen-coordinate escape hatch for `setGaze('CUSTOM', custom)`. */
export interface GazeCustom {
  x: number;
  y: number;
}

/**
 * A `perform()` timeline action — see docs/internal-mixer.md § Composing
 * behavior. `t` is a ms offset into the performance. Discriminated on `do`
 * because the verbs do not share their payload: only `action` is addressed by
 * `id`, and only `state` reads `keepGaze`.
 */
export type AvatarAction =
  | { t: number; do: "state"; name: AvatarStateName; keepGaze?: boolean }
  | { t: number; do: "emotion"; name: AvatarEmotionName; i?: number }
  | { t: number; do: "gaze"; name: AvatarGazeName }
  | { t: number; do: "action"; id: AvatarActionId };

export interface SetStateOptions {
  emotion?: AvatarEmotionName;
  /** 0..1 emotion strength. Default 1. */
  intensity?: number;
  gaze?: AvatarGazeName;
  keepGaze?: boolean;
}

export interface SpeakOptions {
  cues?: Cue[];
  audio?: HTMLMediaElement;
  clock?: () => number;
}

export interface PerformOptions {
  audio?: HTMLMediaElement;
  clock?: () => number;
  onAction?: (a: AvatarAction) => void;
}

export interface PerformHandle {
  /** Cancels the *future* of this performance only — see docs/internal-mixer.md. */
  stop: () => void;
}

export type AvatarEventName = "state" | "speakEnd" | "clipEnd" | "performEnd" | "gestureEnd";

/** What a host needs to frame an avatar it has never seen: the drawing's own
 * window, and where the mouth is inside it. See CLAUDE.md § The two
 * abstractions that matter for why it carries nothing else. */
export interface AvatarMeta {
  viewBox: { x: number; y: number; w: number; h: number };
  mouthCrop?: { x: number; y: number; w: number; h: number };
}

/** The object `createAvatar()` returns — the whole server-facing surface. */
export interface AvatarApi {
  setState(name: AvatarStateName, o?: SetStateOptions): AvatarApi;
  setEmotion(name: AvatarEmotionName, intensity?: number): AvatarApi;
  setGaze(name: AvatarGazeName, custom?: GazeCustom): AvatarApi;
  speak(o?: SpeakOptions): AvatarApi;
  pushCues(cues: Cue[]): AvatarApi;
  stopSpeaking(): AvatarApi;
  /**
   * Self-completing action: states resolve underneath while motion lands.
   *
   * One core intent, one of `actions`, or one of `sequences` — the vocabulary
   * is open, so an id this face has no word for is a no-op rather than a
   * throw. `ACKNOWLEDGE` resolves to whichever of this body's acknowledgements
   * the moment calls for.
   */
  action(id: string): AvatarApi;
  setHandSide(dir: HandSide): AvatarApi;
  perform(actions: AvatarAction[], o?: PerformOptions): PerformHandle;
  setUserSpeaking(speaking: boolean | null): AvatarApi;
  /** Hold user gaze for a short interaction window; currently JS-level only. */
  attend(ms?: number): AvatarApi;
  setMouthGain(g: Gain): AvatarApi;
  readonly mouthGain: Gain;
  setGestureGain(g: Gain): AvatarApi;
  readonly gestureGain: Gain;
  setMotionGain(g: Gain): AvatarApi;
  readonly motionGain: Gain;
  blink(): AvatarApi;
  /** Advance one frame by hand — only meaningful under `{ manual: true }`. */
  step(dt: number): AvatarApi;
  /** Pin channels to fixed values, above the whole mix. `null` releases. */
  setOverrides(o: PoseOverrides | null): AvatarApi;
  on(event: "state", fn: (name: AvatarStateName) => void): AvatarApi;
  on(event: "speakEnd" | "performEnd", fn: () => void): AvatarApi;
  on(event: "clipEnd" | "gestureEnd", fn: (id: string) => void): AvatarApi;
  on(event: AvatarEventName, fn: (...args: unknown[]) => void): AvatarApi;
  readonly state: AvatarStateName;
  readonly emotion: AvatarEmotionName;
  readonly gaze: AvatarGazeName;
  readonly speaking: boolean;
  readonly performing: boolean;
  /** Internal clip id in flight. Not a contract — the clip catalog is private
   * to this renderer, which is why this is the one open string here. */
  readonly clip: string | null;
  /** Semantic hand action in flight, including for a non-SVG custom rig. */
  readonly gesturing: AvatarActionId | null;
  readonly params: Readonly<Record<PoseChannel, number>>;
  readonly userSpeaking: boolean;
  /** Legacy SVG inspection fields; null for a renderer-neutral AvatarRig. */
  readonly svg: SVGSVGElement | null;
  readonly meta: AvatarMeta | null;
  destroy(): void;
}

/** A face module's factory — `createFace(mount, theme)`. See
 * docs/authoring-a-face.md § Adding a new avatar. */
export type FaceFactory = (
  mount: Element,
  theme?: FaceTheme,
) => {
  svg: SVGSVGElement;
  apply: (params: Readonly<Record<PoseChannel, number>>) => void;
  theme: FaceTheme;
  destroy: () => void;
};

/** A face's palette: CSS colour strings by role. Keys are the face's own
 * (`THEME` in its module) — a shared key set was tried and each drawing wanted
 * different roles. See CLAUDE.md on why `peep` has no second palette. */
export type FaceTheme = Readonly<Record<string, string>>;

/** One drawn face: what to build, and how to frame it. Import one from
 * `@voqalize/avatar/faces/<name>`; nothing resolves a face by string. */
export interface Face {
  readonly create: FaceFactory;
  readonly meta: AvatarMeta;
}

export interface CreateAvatarOptions {
  /** Element, or CSS selector resolved via `document.querySelector`. */
  mount: string | Element;
  /** The face to wear. Required unless `rig` replaces the renderer outright. */
  face?: Face;
  /** Renderer-neutral rig factory. It replaces the SVG face implementation;
   * no SVG or metadata is required. See docs/internal-rig.md. */
  rig?: import("./rig.js").AvatarRigFactory;
  /** Passed to `rig` verbatim. Opaque here on purpose — it belongs to whoever
   * wrote the rig, and this file has no way to know its shape. */
  rigOptions?: unknown;
  theme?: FaceTheme;
  mouthGain?: Gain;
  gestureGain?: Gain;
  motionGain?: Gain;
  /** Speech-rhythm head motion (beats, phrase drift), 0..2. A per-rig
   * calibration: the same pose unit is a different angle on every rig. */
  prosodyHeadGain?: Gain;
  /** Speech-rhythm face motion (brows, lids, turn-edge warmth), 0..2. */
  prosodyFaceGain?: Gain;
  /** The share of a sustained head turn the trunk takes up, 0..1. Default
   * 0.45; a per-rig calibration, like `prosodyHeadGain`. */
  trunkFollow?: number;
  /**
   * How far this face may *hold* its head off centre, per axis, in pose units.
   * The layers that hold a pose — attitude, gaze, a phrase's pose, the idle
   * posture — are folded into this together; strokes, beats and clip deltas
   * are not, so a nod keeps its peak. An axis left out is unbudgeted.
   *
   * A per-rig fact and a measured one: what a face can hold before its
   * rendering gives it away is a property of that drawing or that photograph,
   * and the library has no way to guess it.
   */
  headHold?: Readonly<Partial<Record<"headYaw" | "headPitch" | "headRoll", number>>>;
  /** Disable only the bundled SVG hand renderer. A custom rig still receives
   * first-class `frame.hand` controls for every gesture action. Default true. */
  hand?: boolean;
  handSide?: HandSide;
  /** Withhold the rAF loop so a tool can drive frames itself via `step(dt)`. */
  manual?: boolean;
  /**
   * This avatar's own addressable motions, on top of the core intents. A
   * server names one with the wire's `action` command, same as a core one; a
   * face that does not have the name ignores it. Keyed by id, each value a clip
   * in the same shape `ACTIONS` uses. Cannot shadow one of this renderer's own
   * — `ACTIONS` wins.
   */
  sequences?: Readonly<Record<string, unknown>>;
  /**
   * This avatar's own shape for one of this renderer's actions, keyed by its
   * id. Same id, same intent, a rendering sized for this body — the shared
   * clips are authored for a line face. An id this renderer does not publish
   * throws: this can reshape the vocabulary, never add to it.
   */
  actions?: Readonly<Record<string, unknown>>;
  /**
   * This avatar's own rendering of a state, keyed by state name. Each value
   * replaces that state's fields whole (`pose`, `idle`, …); the rest are the
   * shared table's. A name that is not a state throws: this can re-render the
   * vocabulary, never add to it.
   */
  states?: Readonly<Partial<Record<AvatarStateName, Readonly<Record<string, unknown>>>>>;
}

export function createAvatar(opts: CreateAvatarOptions): AvatarApi;

/** Per-state base pose + idle profile. Read-only in practice — the mixer owns it. */
export const STATES: Readonly<Record<AvatarStateName, Readonly<Record<string, unknown>>>>;
export const STATE_NAMES: readonly AvatarStateName[];
export const GAZE_NAMES: readonly AvatarGazeName[];
/** Where each named direction puts the eyes and the head: pupil offset
 *  (`px`/`py`), the head's share of it (`hx`/`hy`) and any roll. Pose units, and
 *  the head deliberately carries less than the whole (`src/gaze.js`). */
export const GAZE_TARGETS: Readonly<Record<AvatarGazeName, {
  px: number; py: number; hx: number; hy: number; roll?: number;
}>>;
export const EMOTION_NAMES: readonly AvatarEmotionName[];
export const ACTIONS: Readonly<Record<AvatarActionId, unknown>>;
export const ACTION_IDS: readonly AvatarActionId[];
/** Asserts the two framing rules against a face's own window. Throws on
 * violation — `pnpm test` runs it for every registered avatar. */
export function checkHandFraming(meta: AvatarMeta): {
  ok: true;
  wristDrop: number;
  outboardLimit: number;
  worst: Record<string, number>;
};
/** The neutral pose: every channel's resting value (`src/params.js`). */
export const REST: Readonly<Record<PoseChannel, number>>;
/** Every channel name, in `REST` order. */
export const CHANNELS: readonly PoseChannel[];
/** Post-mix clamp per channel, `[min, max]`. */
export const RANGE: Readonly<Record<PoseChannel, readonly [number, number]>>;
/** Each channel's smoothing time constant, in seconds. */
export const TAU: Readonly<Record<PoseChannel, number>>;
export function clamp(v: number, lo?: number, hi?: number): number;
/** One frame of exponential smoothing: where `cur` lands `dt` seconds into a
 *  chase of `target` with time constant `tau`. */
export function approach(cur: number, target: number, tau: number, dt: number): number;
export const VISEME_LETTERS: readonly VisemeLetter[];
export const VISEME_SHAPES: Readonly<Record<VisemeLetter, PoseOverrides>>;
/** Cues lead the audio by this many ms — perceptual tolerance is asymmetric. */
export const LEAD_MS: number;
/** The shoulder line's share of a held `headRoll`, per pose unit. */
export const SHOULDER_TILT: number;
/** A full pose from a handful of overrides: every unnamed channel takes its
 *  `REST` value. The only correct way to build a frame by hand. */
export function makeParams(overrides?: PoseOverrides): Record<PoseChannel, number>;
/** One named emotion's channel deltas at `intensity` (0..1). */
export function emotionPose(name: AvatarEmotionName, intensity?: number): PoseOverrides;
export { avatarFrame, createSvgRig } from "./rig.js";
export const ARPABET_TO_VISEME: Readonly<Record<string, VisemeLetter>>;
export const AZURE_VISEME_TO_LETTER: Readonly<Record<number, VisemeLetter>>;

/** The silent/rest letter, `"X"`. */
export const SILENT: VisemeLetter;
/** Pose channels for one letter at `intensity` (0..1), ready to merge into a frame. */
export function shapeFor(letter: VisemeLetter, intensity?: number): PoseOverrides;
/** `jaw` per unit of `mouthOpen`, the ratio the mouth's interior is calibrated at. */
export const JAW_OF_OPEN: number;

/**
 * The mouth clock. Someone has to turn a cue array plus a clock into "which
 * letter is on screen right now"; every renderer needs exactly that and none
 * should write it twice, so it is a class to construct rather than a contract
 * to implement. `sample()` returns `null` when the track is done.
 */
export class VisemeTrack {
  /** @param clock elapsed ms of the audio being played. */
  start(cues: Cue[], clock: () => number): void;
  /** Streaming top-up: append cues that arrive mid-utterance. */
  push(cues: Cue[]): void;
  stop(): void;
  sample(): { letter: VisemeLetter; intensity: number } | null;
  onEnd: (() => void) | null;
  readonly playing: boolean;
}

/**
 * One authored gesture: a short multi-channel timeline of additive deltas,
 * optionally with its own mouth track, gaze override and blink beats.
 */
export interface Clip {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** Milliseconds, end to end. */
  readonly duration: number;
  /** Per channel, `[u, delta]` keys against normalized clip time. */
  readonly keys: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
  readonly mouthCues?: readonly Cue[];
  readonly gaze?: AvatarGazeName;
  readonly blinkAt?: readonly number[];
}

/**
 * Every clip this renderer has, keyed by id — the authoring library, not the
 * wire's vocabulary. Most are reachable only from inside the mixer: `ACTIONS`
 * is what a server may name.
 */
export const INTERNAL_CLIPS: Readonly<Record<string, Clip>>;

/** What one tick of a clip contributes: additive channel deltas, the ramp
 *  weight they already carry, and the mouth when the clip owns it. */
export interface ClipSample {
  delta: Record<string, number> | null;
  weight: number;
  mouth: { letter: VisemeLetter; intensity: number } | null;
  ownsMouth: boolean;
}

/** Plays one clip forward in ticks you supply. Fixed-`dt` stepping is what
 *  makes a rendered gesture reproducible. */
export class ClipPlayer {
  constructor(hooks?: { onGaze?: (name: string | null) => void; onBlink?: () => void });
  play(clip: Clip, audio?: HTMLMediaElement | null, opts?: { queue?: boolean }): void;
  /** Advance by `dtMs` and report this frame's contribution. */
  update(dtMs: number): ClipSample;
  stop(immediate?: boolean): void;
  onEnd: ((clip: Clip | null) => void) | null;
  readonly playing: boolean;
  readonly id: string | null;
}

export function attachAudio(id: string, url: string): void;
export function normalizeActions(actions: AvatarAction[]): AvatarAction[];
export function normalizeCues(cues: Cue[]): Cue[];
export function textToCues(text: string, opts?: { wpm?: number }): Cue[];
