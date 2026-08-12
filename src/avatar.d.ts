/**
 * avatar.d.ts — hand-maintained types for the widget's public surface.
 *
 * The widget is dependency-free ES modules with no build step, so there is no
 * compiler to derive these from; this file is written by hand against
 * `docs/contract-protocol.md` (the binding server ↔ widget contract) and a
 * reading of `avatar.js`. It lives here rather than in a consumer because it
 * is only correct next to the code it describes — the previous copy lived in
 * a vendored tree two repos away and went stale the first time an enum grew.
 *
 * It is deliberately not a conversion of the widget to TypeScript. String-keyed
 * enums (state / gaze / emotion / semantic action ids) are literal unions for
 * editor ergonomics, but every setter also accepts plain `string`, because the
 * widget enforces these enums itself at runtime — unknown state and
 * action ids throw, unknown emotion and gaze fall back silently — and a
 * stale `.d.ts` must never claim to be stricter than the code it describes.
 */

/** `STATE_NAMES` — see docs/contract-protocol.md § States. */
export type AvatarStateName =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "REVIEWING_SCREEN"
  | "WAITING_FOR_USER"
  | "TYPING"
  | "TYPING_CHAT"
  | "DISTRACTED"
  | "SEARCHING_SCREEN"
  | "CANT_HEAR"
  | "TAKING_FLOOR"
  | "WANTS_IN"
  | "YIELDED"
  | "DEGRADED"
  | "OFFLINE";

/** `EMOTION_NAMES` — see docs/contract-protocol.md § Emotion. */
export type AvatarEmotionName =
  | "neutral"
  | "warm"
  | "curious"
  | "concerned"
  | "encouraging"
  | "thoughtful";

/** `GAZE_NAMES` — see docs/contract-protocol.md § Gaze. `"CUSTOM"` is the escape hatch (any name + a `custom` point works). */
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
  | "ACK_CONTINUE"
  | "ACK_RECEIVE"
  | "ACK_REALIZE"
  | "ACK_EMPATHIZE"
  | "ACK_NOD"
  | "RESPONSE_INTERRUPTED"
  | "GESTURE_GREET"
  | "GESTURE_GOODBYE"
  | "GESTURE_APPROVE"
  | "GESTURE_WAIT";

/** Rhubarb Lip Sync letter — see docs/contract-protocol.md § Speech. */
export type VisemeLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

/** One viseme cue: `t` is a ms offset into the utterance, `i` is optional 0..1 loudness. */
export interface Cue {
  t: number;
  v: string;
  i?: number;
}

/** Normalized-screen-coordinate escape hatch for `setGaze('CUSTOM', custom)`. */
export interface GazeCustom {
  x: number;
  y: number;
}

/** A `perform()` timeline action — see docs/contract-protocol.md § Composing behavior. */
export interface AvatarAction {
  t: number;
  do: "state" | "emotion" | "gaze" | "action";
  name?: string;
  id?: string;
  i?: number;
  keepGaze?: boolean;
}

export interface SetStateOptions {
  emotion?: AvatarEmotionName | (string & {});
  intensity?: number;
  gaze?: AvatarGazeName | (string & {});
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
  /** Cancels the *future* of this performance only — see docs/contract-protocol.md. */
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
  setState(name: AvatarStateName | (string & {}), o?: SetStateOptions): AvatarApi;
  setEmotion(name: AvatarEmotionName | (string & {}), intensity?: number): AvatarApi;
  setGaze(name: AvatarGazeName | (string & {}), custom?: GazeCustom): AvatarApi;
  speak(o?: SpeakOptions): AvatarApi;
  pushCues(cues: Cue[]): AvatarApi;
  stopSpeaking(): AvatarApi;
  /** Self-completing action: states resolve underneath while motion lands. */
  action(id: AvatarActionId | (string & {})): AvatarApi;
  /** +1 the viewer's right (the character's own left hand), -1 the other. */
  setHandSide(dir: number): AvatarApi;
  perform(actions: AvatarAction[], o?: PerformOptions): PerformHandle;
  setUserSpeaking(speaking: boolean | null): AvatarApi;
  /** Hold user gaze for a short interaction window; currently JS-level only. */
  attend(ms?: number): AvatarApi;
  setMouthGain(g: number): AvatarApi;
  readonly mouthGain: number;
  setGestureGain(g: number): AvatarApi;
  readonly gestureGain: number;
  setMotionGain(g: number): AvatarApi;
  readonly motionGain: number;
  blink(double?: boolean): AvatarApi;
  /** Advance one frame by hand — only meaningful under `{ manual: true }`. */
  step(dt: number): AvatarApi;
  setOverrides(o: Record<string, number> | null): AvatarApi;
  on(event: "state", fn: (name: AvatarStateName) => void): AvatarApi;
  on(event: "speakEnd" | "performEnd", fn: () => void): AvatarApi;
  on(event: "clipEnd" | "gestureEnd", fn: (id: string) => void): AvatarApi;
  on(event: AvatarEventName, fn: (...args: unknown[]) => void): AvatarApi;
  readonly state: AvatarStateName;
  readonly emotion: AvatarEmotionName;
  readonly gaze: AvatarGazeName;
  readonly speaking: boolean;
  readonly performing: boolean;
  readonly clip: string | null;
  readonly params: Record<string, number>;
  readonly userSpeaking: boolean;
  readonly svg: SVGSVGElement;
  readonly meta: AvatarMeta;
  destroy(): void;
}

/** A face module's factory — `createFace(mount, theme)`. See
 * docs/contract-avatar.md § Adding a new avatar. */
export type FaceFactory = (
  mount: Element,
  theme?: unknown,
) => {
  svg: SVGSVGElement;
  apply: (params: Record<string, number>) => void;
  theme: unknown;
  destroy: () => void;
};

export interface CreateAvatarOptions {
  /** Element, or CSS selector resolved via `document.querySelector`. */
  mount: string | Element;
  /** Name from `AVATAR_NAMES`. Defaults to `DEFAULT_AVATAR`. */
  avatar?: string;
  /** A bare face factory, for an avatar the registry doesn't know about.
   * `meta` then falls back to the svg's own viewBox. */
  face?: FaceFactory;
  theme?: unknown;
  mouthGain?: number;
  gestureGain?: number;
  motionGain?: number;
  /** Withhold the frame-edge hand entirely — for a face drawn in some other
   * idiom, or a tile too small to spend the pixels. A `GESTURE_*` action then degrades
   * to the gesture's face half. Default true. */
  hand?: boolean;
  /** Which hand the character gestures with: +1 the viewer's right. */
  handSide?: number;
  /** Withhold the rAF loop so a tool can drive frames itself via `step(dt)`. */
  manual?: boolean;
}

export function createAvatar(opts: CreateAvatarOptions): AvatarApi;

/** The registry: `{ create, meta }` per avatar. */
export const AVATARS: Record<string, { create: FaceFactory; meta: AvatarMeta }>;
export const AVATAR_NAMES: string[];
export const DEFAULT_AVATAR: string;

/** Per-state base pose + idle profile. Read-only in practice — the mixer owns it. */
export const STATES: Record<string, Record<string, unknown>>;
export const STATE_NAMES: AvatarStateName[];
export const GAZE_NAMES: AvatarGazeName[];
export const GAZE_TARGETS: Record<string, { x: number; y: number }>;
export const EMOTION_NAMES: AvatarEmotionName[];
export const ACTIONS: Record<AvatarActionId, unknown>;
export const ACTION_IDS: AvatarActionId[];
/** Asserts the two framing rules against a face's own window. Throws on
 * violation — `tools/sweep.mjs` runs it for every registered avatar. */
export function checkHandFraming(meta: AvatarMeta): {
  ok: true;
  wristDrop: number;
  outboardLimit: number;
  worst: Record<string, number>;
};
export const VISEME_LETTERS: VisemeLetter[];
export const VISEME_SHAPES: Record<string, Record<string, number>>;
/** Cues lead the audio by this many ms — perceptual tolerance is asymmetric. */
export const LEAD_MS: number;
export const ARPABET_TO_VISEME: Record<string, string>;
export const AZURE_VISEME_TO_LETTER: Record<number, string>;

export function attachAudio(id: string, url: string): void;
export function normalizeActions(actions: AvatarAction[]): AvatarAction[];
export function normalizeCues(cues: Cue[]): Cue[];
export function textToCues(text: string, opts?: { wpm?: number }): Cue[];
