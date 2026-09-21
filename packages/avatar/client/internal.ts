/**
 * `@voqalize/avatar/internal` — the parts of our own implementation that
 * another avatar can build on.
 *
 * **Nothing here is covered by semver.** Names, signatures and semantics move
 * in any minor release. It is exported because an avatar author who wants the
 * SVG mixer, the behavior catalog or — most usefully — the viseme clock should
 * not have to vendor a copy, not because any of it is an interface. The
 * interface is `createAvatar`, and it is one function.
 *
 * The one thing here worth reaching for on purpose is `VisemeTrack`: someone
 * has to turn a cue array plus a clock into "which mouth shape is on screen
 * right now", every renderer needs exactly that, and it is a solved problem.
 *
 *     const track = new VisemeTrack();
 *     track.start(cues, () => performance.now() - t0);
 *     // per frame:
 *     const s = track.sample();   // { letter: "D", intensity: 1, phone: "OW" } | null
 *
 * `docs/internal-rig.md` describes the pose-channel model the bundled SVG
 * renderer uses internally. It is *not* the seam to implement — see
 * docs/design-avatar-interface.md.
 */

export {
  // The bundled SVG widget. Not the faces: importing one from here would put
  // all three in every bundle that wanted the viseme clock.
  // `@voqalize/avatar/faces/<name>` is where a face comes from.
  createAvatar as createSvgAvatar,
  // The pose space a custom `rig` is handed on every frame, and the rests it is
  // measured against.
  REST,
  CHANNELS,
  RANGE,
  STATES,
  STATE_NAMES,
  ACTIONS,
  ACTION_IDS,
  GAZE_NAMES,
  GAZE_TARGETS,
  EMOTION_NAMES,
  // The viseme clock and its tables.
  VisemeTrack,
  VISEME_LETTERS,
  VISEME_SHAPES,
  SILENT,
  LEAD_MS,
  // The body's share of a held tilt, for a page driving a rig by hand.
  SHOULDER_TILT,
  // Stepping a gesture by hand: the catalogue, the player, and the smoothing
  // law the mixer puts between a clip's keyframes and the face. A filmstrip
  // instrument needs all three, and the one thing it must not do is fork the
  // smoothing — that is the part a keyframe is authored against
  // (docs/internal-mixer.md § Smoothing).
  INTERNAL_CLIPS,
  ClipPlayer,
  TAU,
  clamp,
  approach,
  // Posing a face directly, with no mixer, no clock and no client above it —
  // what a pose sheet or a rig-conformance page does. `makeParams` fills the
  // rests around a handful of overrides, `emotionPose` names a familiar set of
  // them, `avatarFrame` wraps the result and `createSvgRig(face)` draws it.
  makeParams,
  emotionPose,
  avatarFrame,
  createSvgRig,
  shapeFor,
  normalizeCues,
  textToCues,
  ARPABET_TO_VISEME,
  AZURE_VISEME_TO_LETTER,
} from "../src/avatar.js";

export type {
  Clip,
  ClipSample,
  AvatarApi,
  AvatarStateName,
  AvatarActionId,
  AvatarGazeName,
  AvatarEmotionName,
  AvatarAction,
  AvatarMeta,
  VisemeLetter,
  Cue,
  PoseChannel,
  PoseOverrides,
  CreateAvatarOptions as CreateSvgAvatarOptions,
} from "../src/avatar.js";

// The rig contract, for a renderer that implements `apply(frame)` directly
// instead of wearing the SVG adapter. `docs/internal-rig.md` — and note that
// this is the mixer's private seam, not the avatar interface.
export type {
  AvatarFrame,
  AvatarRig,
  AvatarRigFactory,
  HandFrame,
  RigPose,
} from "../src/rig.js";

export {
  BEHAVIOR_STATE_IDS,
  BEHAVIOR_ACTIONS,
  BEHAVIOR_ACTION_IDS,
  WIRE_ACTION_TO_BEHAVIOR,
} from "../src/behavior.js";

export type { BehaviorStateId, BehaviorActionId } from "../src/behavior.js";

export { isAvatarMessage, CORE_ACTION_IDS } from "./types.js";
// The optional driving-UI declaration, as a type only. The bundled avatar's own
// `supports` value lives on the public entry point and importing it here would
// drag `peep`'s drawing in behind it — the same reason the faces are not
// exported from this module. Compose yours from `CORE_ACTION_IDS` and
// `ACTION_IDS` above, which cost nothing.
export type { AvatarSupport } from "./createAvatar.js";
// A renderer may reuse the one lifecycle/precedence ladder without gaining a
// second public avatar interface.
export { AvatarClient } from "./AvatarClient.js";
export type {
  AvatarCommand,
  AvatarCue,
  AvatarCuesCmd,
  CoreActionId,
} from "./types.js";
export type { AvatarClientOptions, AvatarDriver, AvatarPresenceState } from "./AvatarClient.js";
