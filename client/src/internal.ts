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
 *     const s = track.sample();   // { letter: "D", intensity: 1 } | null
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
  shapeFor,
  normalizeCues,
  textToCues,
  ARPABET_TO_VISEME,
  AZURE_VISEME_TO_LETTER,
} from "../../src/avatar.js";

export type {
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
} from "../../src/avatar.js";

export {
  BEHAVIOR_STATES,
  BEHAVIOR_STATE_IDS,
  BEHAVIOR_ACTIONS,
  BEHAVIOR_ACTION_IDS,
  WIRE_ACTION_TO_BEHAVIOR,
} from "../../src/behavior.js";

export type { BehaviorStateId, BehaviorActionId } from "../../src/behavior.js";

export { isAvatarMessage } from "./types.js";
export type {
  AvatarCommand,
  AvatarCue,
  AvatarCuesCmd,
} from "./types.js";
