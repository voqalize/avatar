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
  /** Self-completing action: states resolve underneath while motion lands. */
  action(id: AvatarActionId): AvatarApi;
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
  blink(double?: boolean): AvatarApi;
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
  /** Disable only the bundled SVG hand renderer. A custom rig still receives
   * first-class `frame.hand` controls for every gesture action. Default true. */
  hand?: boolean;
  handSide?: HandSide;
  /** Withhold the rAF loop so a tool can drive frames itself via `step(dt)`. */
  manual?: boolean;
}

export function createAvatar(opts: CreateAvatarOptions): AvatarApi;

/** Per-state base pose + idle profile. Read-only in practice — the mixer owns it. */
export const STATES: Readonly<Record<AvatarStateName, Readonly<Record<string, unknown>>>>;
export const STATE_NAMES: readonly AvatarStateName[];
export const GAZE_NAMES: readonly AvatarGazeName[];
export const GAZE_TARGETS: Readonly<Record<AvatarGazeName, { x: number; y: number }>>;
export const EMOTION_NAMES: readonly AvatarEmotionName[];
export const ACTIONS: Readonly<Record<AvatarActionId, unknown>>;
export const ACTION_IDS: readonly AvatarActionId[];
/** Asserts the two framing rules against a face's own window. Throws on
 * violation — `authoring/tools/sweep.mjs` runs it for every registered avatar. */
export function checkHandFraming(meta: AvatarMeta): {
  ok: true;
  wristDrop: number;
  outboardLimit: number;
  worst: Record<string, number>;
};
export const VISEME_LETTERS: readonly VisemeLetter[];
export const VISEME_SHAPES: Readonly<Record<VisemeLetter, PoseOverrides>>;
/** Cues lead the audio by this many ms — perceptual tolerance is asymmetric. */
export const LEAD_MS: number;
export const ARPABET_TO_VISEME: Readonly<Record<string, VisemeLetter>>;
export const AZURE_VISEME_TO_LETTER: Readonly<Record<number, VisemeLetter>>;

/** The silent/rest letter, `"X"`. */
export const SILENT: VisemeLetter;
/** Pose channels for one letter at `intensity` (0..1), ready to merge into a frame. */
export function shapeFor(letter: VisemeLetter, intensity?: number): PoseOverrides;

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

export function attachAudio(id: string, url: string): void;
export function normalizeActions(actions: AvatarAction[]): AvatarAction[];
export function normalizeCues(cues: Cue[]): Cue[];
export function textToCues(text: string, opts?: { wpm?: number }): Cue[];
