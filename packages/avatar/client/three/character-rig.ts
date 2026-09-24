
/**
 * The Blender characters' renderer: the `AvatarRig` contract (`apply(frame)` /
 * `destroy()`) over a Blender-authored GLB. One of these drives every compiled
 * character, and `createCharacter.ts` is what hands it one.
 *
 * The whole file is one idea — **the pose channel is the interface, and every
 * mapping here is a translation of one channel into the one control that
 * renders it.** `scripts/morphs.py` authored the shape keys under the library's
 * own channel names precisely so this file never has to interpret a viseme, a
 * state or an emotion; it receives a fully mixed pose and moves geometry.
 */

import { JAW_OF_OPEN, REST, VISEME_SHAPES } from "../internal.js";
import type { AvatarFrame, AvatarRig, RigPose } from "../internal.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HARD_BUDGET, pixelRatioFor } from "./budgets.js";

/**
 * The camera, from `scripts/render_frame.py`. It is orthographic and that is
 * forced by the albedo rather than chosen: the atlas is a front-orthographic
 * projection of the shell, so an atlas texel sits at face-space (u, v) whatever
 * depth the triangle carrying it has. A perspective camera disagrees by
 * (offset from the axis) x (depth / distance) — which put the hair rim 3 px
 * above the hairline it is textured to and opened a black band across the
 * forehead. `build_character.setup_scene` has the measurement.
 */
const FRAME = { bottom: -0.52, top: 1.46 };
const FRAME_HEIGHT = FRAME.top - FRAME.bottom;
const FRAME_CENTRE = (FRAME.top + FRAME.bottom) / 2;

/**
 * Head motion, in degrees at the channel's own clamp, so the envelope is
 * unreachable by construction rather than by a second clamp nobody runs.
 *
 * Yaw is the tight axis: the albedo is a front-orthographic projection of a
 * shallow shell, and a large turn is where that reads as a cardboard cutout
 * rather than a head. A ladder rendered at 9/12/15/18/21/25/30 and read at crop
 * is clean to 21° on tara and to 18° on the tightest of the others, so 15°
 * keeps headroom; pitch and roll opened once `NECK_QUAD` made the neck's follow
 * exact. How far a pose may be *held* is a stricter question, measured per
 * character (`motion-limits.json`, applied through `holds.ts`).
 *
 * The yaw twist's two fields are an expansion in the angle, so their error
 * grows as θ²/6 — 0.85 % at 15°, on a displacement that is itself a fraction of
 * the neck's radius (`morphs.neck_twist`).
 *
 * TARA-SPECIFIC: reach before an artefact; see 3d-avatar-tara-specific.md.
 */
// Exported through `internal.ts` for the instruments that need to put a real
// angle *into* a channel, which is this scaling run backwards. The mocap
// instrument kept its own copy for want of that export and said in a comment
// that the copy would lie the day the envelope moved; it moved.
export const HEAD_CLAMP = 1.4;
export const HEAD_DEG = { yaw: 15, pitch: 24, roll: 8 };

/**
 * Where the head turns about. v 0.36 is the jaw angle and the earlobe, and it
 * sits a fifth of a face height *behind* the face plane — a pivot on the
 * surface spins the face in place, where a real yaw swings the chin across as
 * well as around, which is most of what makes a small turn read.
 *
 * The asset carries this (`stamp_abi`, as `head_pivot`); this is the fallback
 * for a GLB built before the stamp.
 */
export const PIVOT = new THREE.Vector3(0.0, 0.36, -0.22);

/**
 * Where the head *tilts* about, from `morphs.ROLL_PIVOT`: the midline just
 * above the chin. A roll is a bend of the whole neck, so its centre is far
 * below the ear, and a drawn head sells it by holding the chin and swinging
 * the crown — Live2D's sample rigs tilt about this same point. About PIVOT
 * instead, the chin swung 7 px the other way at 8° and the head read as a
 * pendulum hung from the ears.
 *
 * It sits inside the yaw and pitch, so a turned head still tilts about its own
 * chin. The asset carries it (`stamp_abi`, as `roll_pivot`); this is the
 * fallback for a GLB built before the stamp, and `morphs.ROLL_PIVOT` has what
 * sets the height.
 */
export const ROLL_PIVOT = new THREE.Vector3(0.0, 0.05, -0.22);

/**
 * What the head takes with it, from `build_character.HEAD_PARTS`. `Body` stays
 * behind, and so does `Neck` — but the neck is not *static*: it follows the
 * skull through morph targets of its own (`NECK_QUAD` below).
 *
 * Without that follow a turn dragged the skull's jaw rim across a throat that
 * had not moved, and the rim landed mid-neck as a second jawline — invisible at
 * the 400 × 300 tile, obvious at a 3× crop.
 *
 * The asset carries its own list (`stamp_abi`, as `head_parts`); this is the
 * fallback for a GLB built before the stamp.
 */
export const HEAD_PARTS = ["Head", "Ears", "Hair", "Eye_L", "Eye_R", "Cavity",
  "Teeth_Upper", "Teeth_Lower", "Tongue", "HairLayer"];

/** One stamped vector, in glTF's frame already, or the rig's own fallback. */
function stampedVec(extras: Record<string, unknown>, key: string, fallback: THREE.Vector3) {
  const v = extras[key];
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")
    ? new THREE.Vector3(v[0], v[1], v[2]) : fallback.clone();
}

/**
 * The body, in face-space units (glTF y is face-space v) and degrees.
 *
 * Every mechanism is the SVG faces' (`face-core.poseTransforms`), but anatomy
 * is the floor here, not a fraction of a cartoon: at 0.6 of peep's travel a
 * 30-second listening hold moved the shoulders 2 px and read as a still with a
 * tremor — the head moving more than the body carrying it. These put that hold
 * at 4-5 px, still slow, and still well under the 1.5 Hz ceiling.
 *
 * breath  A swell, not a slide (`docs/research-biomechanics.md` §6.1): the
 *         torso scales about a point below the frame, as peep's does about its
 *         hem. The rise is a little more than the widening because what a
 *         breath shows in this crop is the upper ribs and clavicles lifting as
 *         much as the rib cage widening. The neck and head ride the lift at the
 *         collar, derived rather than tuned (peep's `neckLift`), so the neck
 *         cannot telescope — the 2-3 mm a seated head really moves with a
 *         breath.
 * lean    `torsoLean` as a deformation of the trunk, on the shell itself
 *         (`morphs.torso_targets`) — hem pinned at the frame's lower edge, the
 *         shoulders spreading and tipping as they come nearer. Only the head's
 *         *ride* is here: above the collar the field is flat, so the neck and
 *         head take a pure translation of `leanRide` and nothing else. That is
 *         Live2D's measured behaviour rather than a simplification — body angle
 *         moves every head part by 1.00 ± 0.02 and adds no differential motion
 *         inside the head (`docs/research-head-rotation.md` § 3.1).
 * sway    `torsoTurn` as the seated body's inverted pendulum: the whole figure
 *         rolls about the hips, ~45 cm below the collar, so the trunk shifts
 *         sideways and tips by a fraction of a degree together. peep slides
 *         its torso under a head that stays; a photograph cannot, because a
 *         neck joins them, so here the head rides the trunk and is rolled back
 *         level by exactly the trunk's tilt — its roll is `headRoll`'s alone,
 *         as a person shifting their weight goes on holding their eyes level on
 *         the person they are listening to. One degree at full `torsoTurn`: a
 *         weight shift (0.16-0.42) moves the collar 1.1-2.9 px, and following
 *         a full head turn ~7 px — 1.7 cm at the collar, what a seated body
 *         shifting onto one hip really does.
 */
const BODY = {
  swellPivot: FRAME.bottom - 0.35 * FRAME_HEIGHT,
  rise: 0.016,
  widen: 0.012,
  /** `landmarks.SHOULDER.top`: where the neck meets the torso. */
  collar: -0.24,
  /**
   * The head group's rigid drop at a full lean. `morphs.py` parses this and
   * plateaus `torsoLean`'s field at it above the collar, so the body's
   * deformation and the head's transform are one number and meet without a
   * seam — the same arrangement `lift.position.y` already has with the breath.
   * A uniform scale of the whole figure in its place is a zoom and not a lean:
   * the crown travels 4.56× what the eyes do, which is a head being scaled
   * rather than carried.
   */
  leanRide: 0.021,
  hip: -2.9,
  swayDeg: 1.0,
};

/**
 * Gaze, as iris travel in face heights at `pupilX/Y` = 1, converted to a globe
 * rotation on load. Authored as travel, not as an angle, because travel is what
 * anyone can measure off the render and the angle is an artefact of this
 * build's globe radius (0.24, some 4x anatomical — the sphere is a curved
 * backing for a painted iris, not an eyeball).
 *
 * 0.042 across is ~7 mm on a face 165 mm tall, the iris travel of a ~35°
 * version, and 6.4 px at the 400 px tile; the first value (0.026, ~4 px) was
 * under the threshold where a look to the screen edge reads as a look rather
 * than a drift. Vertical is shorter because a person looking up or down
 * carries most of it with the lids and the head.
 */
const GAZE_TRAVEL = { x: 0.042, y: 0.026 };
/** `head_mesh.GLOBE_R`. The arc a rotation moves the iris through is r·θ. */
const GLOBE_RADIUS = 0.24;
/** `face_texture.EYE_EXTENT`'s span: one eye tile covers 0.30 face heights. */
const EYE_TILE = 0.3;

/** Degrees per pose unit: the globe turns `pupil * GAZE_TRAVEL / GLOBE_RADIUS`
 *  radians, and the head reaches `HEAD_DEG` at the clamp.
 *
 *  Exported through `internal.ts` for the same reason as the head envelope. */
export const EYE_DEG = { x: (GAZE_TRAVEL.x / GLOBE_RADIUS) * 180 / Math.PI, y: (GAZE_TRAVEL.y / GLOBE_RADIUS) * 180 / Math.PI };
const HEAD_UNIT_DEG = { x: HEAD_DEG.yaw / HEAD_CLAMP, y: HEAD_DEG.pitch / HEAD_CLAMP };

/**
 * The mixer's per-rig calibration, passed by the character's entry point and by
 * the motion audit so both measure the same face. A pose unit is an angle here
 * and a pixel count on an SVG face, so the speech layer's amplitudes are tuned
 * per rig rather than in the library.
 *
 * The shared look table is drawn for a line face, whose pupils cross most of an
 * eye, so it put every look in the eyes: a thinking look away was the iris
 * parked in the corner of the socket for two thirds of the state, which is
 * side-eye, not thought. Here the head carries about 60 % of a look and the
 * eyes land a third of the way off centre, where a real eye-head shift leaves
 * them (Freedman & Sparks; Pejsa & Andrist). The comment on each target is its
 * world angle, x right and y down.
 *
 *   vor        Real gain in the light is close to 1. A little under leaves the
 *              head some say, so a nod carries the eyes a touch with it rather
 *              than pinning them to the lens. Vertically it is well under:
 *              her pitch is a shell tipping on a photograph and
 *              reads as a fraction of what it is, so the eyes' full answer to
 *              it read as the eyes moving on their own — at 0.8, THINKING's
 *              up-look rolled the iris to the lid with white beneath it, and
 *              the reply that followed dropped it into a downcast look with the
 *              lid riding down, while the head was still coming back. At 0.35
 *              the eyes mostly go where the head takes them.
 *   range      How far the reflex may carry the eye in the socket. Unlimited,
 *              an up-look's onset put the whole 8° in the eye before the neck
 *              moved — the iris pinned under the lid, white beneath it, which
 *              on this photograph reads as an eye-roll. Up 0.45 is 2.8° and
 *              down 0.5 is 3.1°; the head covers the rest, as it does once the
 *              eye nears its effective range. Both were looser (0.55, 0.85)
 *              and a gap between turns hit both ends of them every time.
 *   lidFollow  Down 0.38 keeps the upper lid on the iris: the lid travels
 *              0.068 face units per lid unit and the iris 0.026 per pupil unit.
 *              Up a little less, so an upward look opens the eye a hair instead
 *              of dragging the lid along with it.
 *   avert      A conversational look away keeps under half its size in the
 *              eyes and gives the neck 0.6 of it — on this face the eyes alone
 *              could only make it a glance sideways.
 *   head       The follow's launch and cruise, in head units. A real head
 *              reaches a 7-8° shift in about 0.4 s, its speed scaling with the
 *              size of the shift; the shared amble took a thinking look 1.2 s,
 *              and the reflex, doing its job, held the eyes in the corner of
 *              the socket the whole way.
 *
 * `trunkFollow` is 0.3, under the line faces' 0.45. Live2D's face-tracking
 * sample gives the body a third of the head's yaw (BodyAngleX 10 against
 * AngleX 30; docs/research-head-rotation.md § 5 item 6), and that is the
 * benchmark to sit at, not above. Here it matters for a reason a line face
 * does not have: the neck's outline holds under a twist by construction
 * (`morphs.neck_twist`), so the trunk's sway is what is left moving it — a
 * quarter to a third of it at the yaw peak in the recorded call, read as the
 * neck sliding.
 */
export const CHARACTER_TUNING = {
  prosodyHeadGain: 1.0, prosodyFaceGain: 1, saccadeGain: 2.4, aversionGain: 1.8,
  trunkFollow: 0.3,
  // **The speaking face's upper half, sized for a photograph.** A reviewer read
  // her speech as delivered "with zero emotion or movement in her eyes or
  // forehead", against the same reviewer's praise for `CANT_HEAR`. The two are
  // the same channels at different values, and the gap is measurable in the
  // expression maps: `CANT_HEAR` above is knit 0.14/0.45 plus inner 0.22/0.5,
  // about 0.75 of map weight, where speech averaged 0.19.
  //
  // `floor` is the larger half of the answer. `browRaise` is split by sign into
  // two maps and *both* read as nothing near zero, so the shared [-0.14, 0.18]
  // range spends most phrases in a dead band recruiting no light at all. The
  // band is skipped rather than the range widened, because what carries the
  // read is the sign a phrase commits to, not how far it goes — and the ceiling
  // stays under a beat's 0.34 for the reason `POSE.brow` gives.
  //
  // `forms` moves draws off the plain raise and onto the inner lift, which on
  // this asset is the only brow shape besides the raise that recruits light at
  // all (`EXPRESSION_WEIGHT`: there is no map for `browAngle`, and its 0.026 of
  // travel is the smallest of the three). `prosody.js` makes the inner lift the
  // rarest form deliberately, because a face that keeps lifting its inner brows
  // reads as worried — that rule is written for the line faces, and the face it
  // is being relaxed for holds `browInner` at 0.22 for the whole of `CANT_HEAR`
  // and was praised for it. Still a transient on a 0.55 s envelope, never a
  // held shape: the prohibition is on the hold, not the event.
  brows: {
    range: [-0.28, 0.24],
    floor: 0.11,
    forms: [
      { p: 0.38, inner: 0.00, angle: 0.00 },
      { p: 0.34, inner: 0.26, angle: 0.00 },
      { p: 0.28, inner: 0.00, angle: 0.30 },
    ],
  },
  states: {
    // The shared WORKING pose without its AU4 brows. On peep, brows-down is
    // what makes reading read as effort rather than a blank face; on a
    // photograph, over lids that are already following the eyes down, it
    // closes them to a squint the owner read as straining at the screen, not
    // working. Her reading scan carries the state instead: eyes off the user,
    // stepping along a line, the way a person at their own display looks.
    WORKING: {
      pose: { headPitch: 0.04, lidL: -0.08, lidR: -0.08, shoulderL: 0.06, shoulderR: 0.06 },
    },
    // Straining to hear, without the squint. Its AU7 lifts her lower lid and
    // pushes the cheek up under it: at 0.75 the eyes closed to slits over a
    // dark band, and under brows at -0.45, with the eyes countered into the
    // corner of the socket (`USER_EAR` below), she read as giving the user a
    // suspicious side-eye. The lean in and the ear offered carry the state,
    // which the shared comment already says of them. The brows keep a small
    // knit with the inner ends up: effort that is also asking. The mouth is
    // pressed at a photograph's scale; the shared -0.22 corners clear peep's
    // drawn smile, and a compiled face rests neutral.
    //
    // The lean is attentive-sized, not the shared 0.70: 0.22 sits in the
    // sustained band (+0.15–0.25, research-biomechanics.md §6.3), and the ear
    // and chin carry the rest.
    CANT_HEAR: {
      pose: {
        torsoLean: 0.22, headPitch: 0.10,
        browRaiseL: -0.14, browRaiseR: -0.14, browInnerL: 0.22, browInnerR: 0.18,
        mouthPress: 0.40, mouthCornerL: -0.10, mouthCornerR: -0.10,
      },
    },
    // Hunting for a control, without the squint: the same lower lid and cheek
    // at 0.40 left the eyes half-lidded from below over a dark band. The hunt
    // is the wander and the flick; the face only has to be not smiling, and
    // on a mouth that rests neutral that is a small press, not peep's -0.25
    // corners.
    SEARCHING_SCREEN: {
      pose: { mouthPress: 0.40, mouthCornerL: -0.08, mouthCornerR: -0.08,
              browRaiseL: -0.10, browRaiseR: -0.06 },
    },
  },
  oculomotor: {
    angles: { eye: EYE_DEG, head: HEAD_UNIT_DEG },
    vor: { x: 0.8, y: 0.35 },
    range: { x: 0.8, up: 0.45, down: 0.5 },
    lidFollow: { down: 0.38, up: 0.30 },
    avert: { eye: 0.45, head: 0.6 },
    head: { accel: 16, speed: 3.5 },
    targets: {
      // 2.0° right, 2.5° down: her own display, read level and a little to
      // the side (WORKING, and OFFLINE's wait). The upper lid follows the eye
      // down (`lidFollow`), and a photographed eye 6.8° down — where this
      // sat — hooded to a lid of 0.25-0.43 against listening's 0.14, read as
      // a squint rather than reading. Here it holds 0.12-0.18 through the
      // scan, and being off the user to the side is what says "busy".
      OWN_SCREEN:    { px:  0.14, py:  0.24, hx:  0.10, hy:  0.06 },
      // 2.6° of head turn toward the user's side and 3.1° of roll, the eyes
      // countered 2.0° back onto them: the ear offered, contact held from
      // inside the socket. The shared 0.42 counter held her iris against the
      // corner of the socket with white on one side, which on a photograph is
      // side-eye; the roll is the cue that says "ear", so it keeps its size.
      USER_EAR:      { px: -0.20, py:  0.05, hx:  0.40, hy:  0.02, roll: 0.55 },
      // 2.8° up, nearly all of it the head — the same total the shared target
      // gives on her, redistributed. The shared split puts 1.0° on the eyes,
      // and the middle of a screen is the one place a hunt keeps returning to,
      // so it is the worst place to sit with the iris off-centre.
      SCREEN_CENTER: { px:  0.00, py: -0.06, hx:  0.00, hy: -0.14 },
      // 9.3° to the side, 1.5° up, the head carrying over half. The shared
      // ones put the eyes at the edge of her socket (0.78 of 0.8) — white on
      // one side again, and a hunt that reads as shifty. SEARCHING_SCREEN,
      // REVIEWING_SCREEN and DISTRACTED look here.
      SCREEN_LEFT:   { px: -0.42, py: -0.10, hx: -0.80, hy: -0.05 },
      SCREEN_RIGHT:  { px:  0.42, py: -0.10, hx:  0.80, hy: -0.05 },
      // 6.4° up, three quarters of it the head. The shared target is 9.6° on
      // her — higher than her own AWAY_THINKING, so it read as looking over
      // the monitor rather than at the top of it, and it made the two longest
      // hops in SEARCHING_SCREEN's set (14.6° from SCREEN_WORK, 12.4° from
      // either side) on a face whose looks are all scaled to a head-and-
      // shoulders crop.
      SCREEN_TOP:    { px:  0.00, py: -0.26, hx:  0.00, hy: -0.28 },
      // 7.0° left, 3.2° down, for the same reason, split evenly.
      SCREEN_WORK:   { px: -0.35, py:  0.18, hx: -0.55, hy:  0.12 },
      // 7.8° left, 8.1° up.
      AWAY_THINKING: { px: -0.30, py: -0.40, hx: -0.75, hy: -0.33, roll: 0.08 },
      // 7.6° right, 7.4° up.
      AWAY_RIGHT:    { px:  0.30, py: -0.36, hx:  0.72, hy: -0.30, roll: -0.06 },
      // 6.8° left, 5.5° down: shallower than the up-looks, since down on a
      // face this real is the one read as downcast.
      AWAY_DOWN:     { px: -0.28, py:  0.45, hx: -0.62, hy:  0.16, roll: 0.04 },
      // 7.8° right, level.
      AWAY_SIDE:     { px:  0.32, py:  0.08, hx:  0.72, hy:  0.02, roll: -0.03 },
    },
  },
} as const;

/** How far a closing lid darkens the eye it covers, from where it starts to.
 * The lid's margin and lashes throw the strip of white still showing into
 * shadow; the atlas's socket shade was measured with the eye open and cannot
 * know that, so without this the last frames before a blink closes show a
 * bright line under a dark lash band — what a reviewer called the sclera
 * tearing across the lid. */
const LID_SHADE = 0.55;
const LID_SHADE_FROM = 0.3;

/**
 * The eye material, taught to hold its socket still while the globe turns.
 *
 * The eye atlas is two tiles (`face_texture.write_eye_atlas`): the globe, and
 * a linear multiplier holding what the lids and the socket put on the eye —
 * the shadow under the upper lid, the caruncle, the shading into each corner.
 * A real eye turns under all of that, and when it was baked into the globe a
 * sideways look swung the caruncle into the middle of the white. So the
 * globe's texel is read where the surface point *was* and the socket's where
 * it *is*: the planar UV of the rotated position, which is the unrotated UV
 * plus the rotation's displacement through the UV's own gradient. One extra
 * texture read on two small meshes; no pass, no draw call.
 */
function socketed(base: THREE.MeshStandardMaterial, side: number,
                  gaze: { value: THREE.Matrix3 }, deep: boolean,
                  lid: { value: number }) {
  const material = base.clone();
  // d(u)/dx and d(v)/dy of `head_mesh.eye_uvs`: the globe is half the atlas
  // wide, the right eye reads it mirrored, and glTF flips v.
  const socket = { value: new THREE.Vector2((0.5 * -side) / EYE_TILE, -1 / EYE_TILE) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGaze = gaze;
    shader.uniforms.uSocket = socket;
    shader.uniforms.uLidShade = lid;
    // The globe's hidden skirt turns at the frame's motion depth like the skin
    // that hides it; its visible cap carries a field of exactly zero, so the
    // socket, the iris and gaze below are unaffected by this. It turns at the
    // *frame's* rotation and not its own, which is what `undoGaze` reads back
    // out of `uGaze` — hence this sitting after that uniform is bound.
    if (deep) turnDeep(shader, true);
    shader.vertexShader = shader.vertexShader
      .replace("#include <uv_pars_vertex>",
        "#include <uv_pars_vertex>\nuniform mat3 uGaze;\nuniform vec2 uSocket;\nvarying vec2 vSocketUv;")
      .replace("#include <uv_vertex>",
        "#include <uv_vertex>\nvSocketUv = vMapUv + vec2(0.5, 0.0)"
        + " + uSocket * ((uGaze * position).xy - position.xy);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <uv_pars_fragment>",
        "#include <uv_pars_fragment>\nvarying vec2 vSocketUv;\nuniform float uLidShade;")
      .replace("#include <map_fragment>",
        "vec3 socket = uLidShade * 2.0 * texture2D( map, vSocketUv ).rgb;\n#include <map_fragment>\ndiffuseColor.rgb *= socket;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= socket;");
  };
  material.customProgramCacheKey = () => (deep ? "tara-eye-socket-deep" : "tara-eye-socket");
  return material;
}

/**
 * tess's "ah" photograph, down the midline of her open mouth: the colour at
 * each depth into the lip opening, 0 at the upper lip's inner rim and 1 at the
 * lower's, in sRGB as the photograph has it. Read at MediaPipe's inner-lip
 * points 13 and 14, which is the same rim `build_character.lip_aperture` stamps.
 *
 * The shape is the thing to keep, and every reviewer's "pink and flat" is its
 * absence: dark in the shadow of the upper arch, rising to the tongue's front
 * two-thirds of the way down, and falling again into the floor of the mouth
 * above the lower arch. Where either arch covers a stretch of this, what the
 * photograph measured there is enamel and was left out — the arches draw
 * themselves.
 */
const INTERIOR: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0.15, [60, 22, 26]],
  [0.30, [84, 35, 41]],
  [0.45, [122, 62, 68]],
  [0.60, [159, 87, 93]],
  [0.70, [144, 60, 61]],
  [0.80, [52, 17, 15]],
  [0.90, [40, 12, 12]],
];

/**
 * The photograph's enamel is 158 of 255 and the rendered upper arch's is about
 * 232, so the profile is carried over at the ratio of the two: the interior is
 * as dark *against the teeth* as hers is, which is the only comparison anyone
 * makes looking into a mouth.
 */
const INTERIOR_GAIN = 232 / 158;

/** The same, applied to the photograph in linear light, where its tile is read. */
const INTERIOR_GAIN_LINEAR = INTERIOR_GAIN ** 2.2;

/**
 * How open her mouth is in that photograph: 185 px between the inner rims at the
 * midline over 229 between the inner corners (MediaPipe 13/14 and 78/308). A
 * speaking mouth is rarely a third of that, and the light reaching into it
 * falls with the opening, so the profile is dimmed by the square root of the
 * ratio — between the solid angle's own square law, which turned every
 * conversational viseme into a hole, and none at all, which left each one the
 * lit pink band reviewers called flat.
 */
const INTERIOR_OPEN = 185 / 229;

/** That dimming, in GLSL, over the `uAperture` the mouth's shaders share. */
const OPENNESS = `sqrt(clamp(uAperture.w / (2.0 * uAperture.z * ${INTERIOR_OPEN.toFixed(3)}), 0.0, 1.0))`;

/**
 * Where a raised tongue is read from: `tongue` = 1 paints the surface it lifts
 * into the opening from `from` down to `at` — `at` the photograph's brightest
 * row — rather than in the shadow of the upper arch it has moved into. A span
 * and not a row: read at one row, every height of it took the same texels,
 * and the photograph's tongue drew as vertical streaks down a slab. Squeezed
 * into the span it keeps its crown, rolling off toward the teeth.
 */
const TONGUE_LIFT = { from: 0.25, at: 0.60 };

/** An `INTERIOR` knot as linear light, at `INTERIOR_GAIN`. */
function interiorKnot(rgb: readonly [number, number, number]) {
  return new THREE.Color().setRGB(
    ...(rgb.map((v) => Math.min(1, (v * INTERIOR_GAIN) / 255)) as [number, number, number]), THREE.SRGBColorSpace);
}

const glslColor = (c: THREE.Color) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;

/** GLSL: `vec3 interior`, the profile at depth `mouthA` in the opening. */
function interiorProfile() {
  let profile = `vec3 interior = ${glslColor(interiorKnot(INTERIOR[0][1]))};\n`;
  for (let i = 1; i < INTERIOR.length; i++) {
    const [a0] = INTERIOR[i - 1];
    const [a1, rgb] = INTERIOR[i];
    profile += `interior = mix(interior, ${glslColor(interiorKnot(rgb))}, clamp((mouthA - ${a0.toFixed(3)}) / ${(a1 - a0).toFixed(3)}, 0.0, 1.0));\n`;
  }
  return profile;
}

/**
 * The inside of the mouth — the tongue and the cavity behind it — painted from
 * a photograph of one, at where each point sits in the lip opening the pose
 * has made.
 *
 * The opening, and not the surface, because that is how the photograph's
 * profile arises: the light reaching into a mouth is gated by the lips and
 * shadowed by the upper arch, so the same point of tongue is bright when the
 * jaw drops and dark when it closes. A shade stuck to the surface — what this
 * replaced — reads as a lit object behind a hole, which at viseme D was a flat
 * mauve plate, and at C and H put the tongue's bright crest directly under the
 * upper teeth with dark below it: the order of the photograph, inverted.
 *
 * Emitted rather than lit, and entirely: this is sampled light, like the 75%
 * of the face that is the photograph verbatim, and a key from above lights the
 * dorsum brightest at its back, which is the one thing a mouth never looks
 * like. Both surfaces read the same picture, so her mouth's absence of any
 * tongue-to-cavity edge carries over; only a raised tongue is told apart, by
 * `lift`, because a tongue tip at the teeth is what viseme H is.
 */
function mouthInterior(base: THREE.MeshStandardMaterial,
                       aperture: { value: THREE.Vector4 }, lift: { value: number },
                       extent: readonly number[] | null) {
  const material = base.clone();
  // The photograph itself where the asset carries it (`project_albedo.project_interior`),
  // and its midline where it does not.
  const tiled = material.map !== null && extent !== null;
  let paint: string;
  if (tiled) {
    const [s0, s1, a0, a1] = extent!;
    paint = `vec2 tileAt = clamp(vec2((mouthX - ${s0.toFixed(3)}) / ${(s1 - s0).toFixed(3)},`
      + ` (mouthA - ${a0.toFixed(3)}) / ${(a1 - a0).toFixed(3)}), 0.0, 1.0);\n`
      + `vec3 interior = min(texture2D(map, tileAt).rgb * ${INTERIOR_GAIN_LINEAR.toFixed(4)}, vec3(1.0));\n`;
  } else {
    paint = interiorProfile();
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAperture = aperture;
    shader.uniforms.uMouthLift = lift;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMouthAt;")
      // `transformed` after the morphs, unlike every other shade in this file:
      // where the surface *is* in the opening is the whole question.
      .replace("#include <morphtarget_vertex>",
        "#include <morphtarget_vertex>\nvMouthAt = transformed.xy;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec2 vMouthAt;\nuniform vec4 uAperture;\nuniform float uMouthLift;")
      .replace("#include <map_fragment>", "diffuseColor.rgb = vec3(0.0);")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n"
        + "float mouthA0 = (uAperture.y - vMouthAt.y) / uAperture.w;\n"
        + `float mouthA = mouthA0 < ${TONGUE_LIFT.at.toFixed(2)} ? mix(mouthA0, ${TONGUE_LIFT.from.toFixed(2)}`
        + ` + max(mouthA0, 0.0) * ${((TONGUE_LIFT.at - TONGUE_LIFT.from) / TONGUE_LIFT.at).toFixed(4)}, uMouthLift) : mouthA0;\n`
        + "float mouthX = (vMouthAt.x - uAperture.x) / uAperture.z;\n"
        + paint
        + `totalEmissiveRadiance = interior * ${OPENNESS};`);
  };
  material.customProgramCacheKey = () => (tiled ? "mouth-interior-tile" : "mouth-interior");
  return material;
}

/**
 * The lower arch, lit by the light the tongue beside it is lit by.
 *
 * Its tile is toned against the upper arch on a smile (`project_albedo`), a
 * mouth open wide and pulled back, where the lower teeth take nearly the upper
 * ones' light. Speaking, they are the deepest thing the opening shows, and
 * tess's "ah" — open wider than any viseme — shows no lower crown at all: the
 * row above where they would be is the darkest in the photograph. Left at the
 * smile's tone, the sliver a C or D uncovers was a lit grey rule between that
 * dark and the lip, which reads as a wire and not as teeth.
 *
 * So the arch takes the interior's light where it stands: the profile at its
 * depth in the opening over the profile's brightest row, which is the tongue
 * lit as well as anything in a mouth is, and the same openness dimming. The
 * ratio is in linear light and per channel, so the enamel goes as dark and as
 * warm as the mouth around it, and its top edge — higher in the opening —
 * keeps the most. The upper arch, at the lip and in the light, keeps its own.
 */
function lowerArch(base: THREE.MeshStandardMaterial, aperture: { value: THREE.Vector4 }) {
  const material = base.clone();
  const peak = interiorKnot(INTERIOR.reduce((a, b) => (b[1][0] + b[1][1] + b[1][2] > a[1][0] + a[1][1] + a[1][2] ? b : a))[1]);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAperture = aperture;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMouthAt;")
      .replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\nvMouthAt = transformed.xy;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMouthAt;\nuniform vec4 uAperture;")
      // Both terms: the teeth are three-quarters sampled light (`emissive`
      // in the build's `flat_material`), so dimming the lit part alone does
      // almost nothing.
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n"
        + "float mouthA = (uAperture.y - vMouthAt.y) / uAperture.w;\n"
        + interiorProfile()
        + `vec3 archLight = min(interior / ${glslColor(peak)}, vec3(1.0)) * ${OPENNESS};\n`
        + "diffuseColor.rgb *= archLight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= archLight;");
  };
  material.customProgramCacheKey = () => "lower-arch";
  return material;
}

/**
 * The upper arch, with the gaps between its teeth showing the mouth.
 *
 * `project_albedo.project_teeth` paints everything under the incisal edge
 * that is not a tooth — the notches between the tips — in `notch`, a neutral
 * near-black, because the tile cannot know what the mouth behind it will be.
 * Rendered, that strip came out a hard grey saw along the bottom of the arch:
 * neutral against a warm interior, and at the arch's light rather than the
 * mouth's. A gap in a row of teeth is a window onto the cavity, so it takes
 * the cavity's own light at that height in the opening, and only the gap does
 * — `notch` is darker than any enamel the tile carries, shaded overhang
 * included, so the test is the texel's own brightness, and a filtered texel
 * on a tip's edge takes a share of each.
 */
function upperArch(base: THREE.MeshStandardMaterial, aperture: { value: THREE.Vector4 }) {
  const material = base.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAperture = aperture;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMouthAt;")
      .replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\nvMouthAt = transformed.xy;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMouthAt;\nuniform vec4 uAperture;")
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n"
        + "float archGap = 1.0 - smoothstep(0.01, 0.30, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));\n"
        + "diffuseColor.rgb *= 1.0 - archGap;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n"
        + "float mouthA = (uAperture.y - vMouthAt.y) / uAperture.w;\n"
        + interiorProfile()
        + `totalEmissiveRadiance = mix(totalEmissiveRadiance, interior * ${OPENNESS}, archGap);`);
  };
  material.customProgramCacheKey = () => "upper-arch";
  return material;
}

/** `scripts/head_mesh.MOTION_DEPTH_ATTR`, as GLTFLoader names it: lowercased. */
const MOTION_DEPTH = "_motion_depth";

/**
 * The vertex half of `motionDepth`, which the eye's socket shader needs too.
 *
 * It is a free function rather than inheritance because `Material.copy` does not
 * carry `onBeforeCompile`: cloning a motion-depth material and giving the clone
 * a second injection drops the first one silently, with no error and a rest pose
 * that looks right. The two are composed by hand instead.
 */
function turnDeep(shader: { vertexShader: string }, undoGaze = false) {
  // `undoGaze` is for the globes, and without it the cure draws a worse defect
  // than the one it removes. A globe is *rotated* for gaze, so its own
  // `modelViewMatrix` carries that rotation: building the offset from it tilts
  // (0, 0, Δz) into the screen plane and slides the hidden skirt out past the
  // temple on a look alone, head square on, where the skin it hides behind has
  // not moved at all. The frame's rotation is the one the skirt must follow, and
  // `uGaze` is exactly the extra rotation to take back out — multiplying the
  // vector from the left is its inverse, so this needs no second uniform.
  const depth = `vec3(0.0, 0.0, ${MOTION_DEPTH})`;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nattribute float ${MOTION_DEPTH};`)
    .replace("#include <project_vertex>",
      "#include <project_vertex>\n"
      + `mvPosition.xy += (modelViewMatrix * vec4(${undoGaze ? `${depth} * uGaze` : depth}, 0.0)).xy;\n`
      + "gl_Position = projectionMatrix * mvPosition;");
}

/**
 * The head's frame, taught to turn as if it sat deeper than it does.
 *
 * Rotated at their real depth, the ears, crown, side hair and outline move
 * nearly as far as the nose, and a nod reads as the whole head dropping
 * (docs/research-head-rotation.md § 1). A real head's frame sits near the axis
 * and barely moves, and that differential is what reads as rotation. Each
 * vertex of the skin, hair and ears carries a Δz toward the viewer
 * (`head_mesh.motion_depth`, ≤ 0 and zero across the features), and this moves
 * it on screen by the rotated Δz: the view-space xy of modelView · (0, 0, Δz).
 * Depth, draw order and lighting keep the real position. At rest that xy is
 * exactly zero through the orthographic camera, so the drawing is untouched.
 *
 * The attribute decides, not the mesh name: the neck shares the skin material
 * and has no field, which is why each head shell gets a clone. The same clone
 * wears the expression maps, when the asset has them: the shells textured from
 * the face atlas are exactly the ones those maps are registered to.
 */
function motionDepth(base: THREE.MeshStandardMaterial, expression?: Expression, shut?: Shut) {
  const material = base.clone();
  material.onBeforeCompile = (shader) => {
    turnDeep(shader);
    if (shut) {
      Object.assign(shader.uniforms, shut.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${SHUT_VERTEX_HEAD}`)
        .replace("#include <uv_vertex>", `#include <uv_vertex>\n${SHUT_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${SHUT_UNIFORMS}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${SHUT_FRAGMENT}`)
        .replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\n"
          + "totalEmissiveRadiance = mix(totalEmissiveRadiance, emissive * shutColour, shutWeight);");
    }
    if (!expression) return;
    const n = expression.names.length;
    Object.assign(shader.uniforms, expression.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${EXPRESSION_UNIFORMS(n)}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${EXPRESSION_FRAGMENT(n)}`)
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= expression;");
  };
  material.customProgramCacheKey = () =>
    ["tara-motion-depth", expression && `expression-${expression.names.length}`, shut && "shut"]
      .filter(Boolean).join("-");
  return material;
}

/**
 * Expression maps: the light a smile or a raised brow changes, which the
 * geometry cannot.
 *
 * A pixel of this face is 75% photograph, emitted, so the most a morph can
 * change by moving skin is a quarter of its shading — and that shading is the
 * neutral photograph's, which has no nasolabial fold to deepen and no forehead
 * line to show. A cheek morph measured 0.00% of the tile changed. So an asset
 * can carry, per expression, a grey ratio taken from a photograph of the same
 * face making it (`scripts/expression_maps.py`), read at the texel's *rest*
 * position: the morph that lifts the cheek carries the lifted cheek's light up
 * with its texture, so light and shape arrive together.
 *
 * Per side, because the channels are. The weights cross over at the midline
 * rather than switching there, so a one-sided smile does not cut its fold's
 * light off in a line down the philtrum. An asset with no maps is a face whose
 * light never changes, which is a correct face.
 */
const EXPRESSION_SPLIT = 0.03;
/**
 * Each map's weight, from one side's channels, as a fraction of the channel
 * value at which it is at its photograph's full strength. The smile's is the
 * mixer's broad smile (0.48-0.58 in the happy states) with room above it; a
 * raise at the mixer's highest (0.42) gets most of the lines; a knit at
 * `CANT_HEAR`'s −0.14 gets a third of the crease and the deepest frown the
 * mixer asks for (−0.45) gets all of it; the inner brow's concern is full at
 * its 0.55 and a press at the 0.40-0.55 most states hold gets most of the chin.
 *
 * A map named here that the asset lacks is simply not read, and a map the
 * asset has that is not named here stays at weight 0: an asset newer than its
 * rig loses the light the rig cannot place, not the face.
 */
const EXPRESSION_WEIGHT: Record<string, (at: (channel: string) => number) => number> = {
  smile: (at) => at("mouthCorner") / 0.8,
  raise: (at) => at("browRaise") / 0.6,
  knit: (at) => -at("browRaise") / 0.45,
  inner: (at) => at("browInner") / 0.5,
  press: (at) => at("mouthPress") / 0.7,
};
const EXPRESSION_UNIFORMS = (n: number) => [
  "uniform sampler2D uExpression;", "uniform vec4 uExpressionTile;", "uniform vec2 uExpressionU;",
  "uniform vec4 uExpressionStrip;", "uniform float uExpressionStep;",
  "uniform float uExpressionScale;",
  `uniform float uExpressionL[${n}];`, `uniform float uExpressionR[${n}];`,
].join("\n");
// Every tap is read whatever its weight: a texture read under a branch that
// differs across the midline has no derivatives to choose its mip from.
const EXPRESSION_FRAGMENT = (n: number) => [
  "vec2 expressionAt = clamp(uExpressionTile.xz + uExpressionTile.yw * vMapUv, 0.0, 1.0);",
  "vec2 expressionUv = uExpressionStrip.zw + expressionAt * uExpressionStrip.xy;",
  "float expressionSide = smoothstep(",
  `  -${EXPRESSION_SPLIT}, ${EXPRESSION_SPLIT}, uExpressionU.x + uExpressionU.y * vMapUv.x);`,
  "float expressionLog = 0.0;",
  `for (int i = 0; i < ${n}; i++) {`,
  "  float ratio = texture2D(uExpression, expressionUv + vec2(float(i) * uExpressionStep, 0.0)).r;",
  "  expressionLog += mix(uExpressionL[i], uExpressionR[i], expressionSide)",
  "    * log(max(ratio * uExpressionScale, 0.01));",
  "}",
  "float expression = exp(expressionLog);",
  "diffuseColor.rgb *= expression;",
].join("\n");

interface Expression {
  readonly map: THREE.Texture;
  readonly names: readonly string[];
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly uniforms: Record<string, THREE.IUniform>;
}

/** The maps from their carrier's node, or `null` for an asset whose carrier
 *  does not say what this rig reads — a face with no expression maps is a
 *  correct face, and a map read with the wrong layout is not. */
function expressive(carrier: THREE.Mesh): Expression | null {
  const { expression_tile: tile, expression_u: u, expression_maps: names,
          expression_layout: layout, expression_unity: unity } = carrier.userData;
  const map = (carrier.material as THREE.MeshStandardMaterial).map;
  if (!map || !Array.isArray(tile) || !Array.isArray(u) || !Array.isArray(layout)
      || typeof unity !== "number" || !Array.isArray(names) || !names.length) return null;
  // A ratio, not a colour. The loader tags every base colour sRGB.
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
  const [width, height, pad, stripWidth, stripHeight] = layout as number[];
  const left = new Float32Array(names.length);
  const right = new Float32Array(names.length);
  return {
    map, names: names.map(String), left, right,
    uniforms: {
      uExpression: { value: map },
      uExpressionTile: { value: new THREE.Vector4(tile[0], tile[1], tile[2], tile[3]) },
      uExpressionU: { value: new THREE.Vector2(u[0], u[1]) },
      uExpressionStrip: { value: new THREE.Vector4(width / stripWidth, height / stripHeight,
                                                   pad / stripWidth, pad / stripHeight) },
      uExpressionStep: { value: (width + pad) / stripWidth },
      uExpressionScale: { value: 255 / unity },
      uExpressionL: { value: left },
      uExpressionR: { value: right },
    },
  };
}

/** `scripts/build_character.LID_SHUT_ATTR`'s fields, as GLTFLoader names
 *  them: the displacement's u and v, and the weight. */
const LID_SHUT_ATTRS = ["_lid_shut_u", "_lid_shut_v", "_lid_shut_w"] as const;

/**
 * The shut lids: a closing lid shows the photograph of the eyes closed.
 *
 * A 2.5-D shell has no hidden skin, so the lid that closes is the open eye's
 * lid, stretched: the lash band and the fold drawn down over the eyeball in
 * pale streaks, and a white edge where the stretched margin met the sclera. A
 * reviewer watching a real call called it the eye tearing mid-blink, and at
 * any distance it read as an eye that did not shut at all.
 *
 * So the build carries the neutral edited to close the eyes
 * (`scripts/shut_lids.py`), and each lid vertex says where its texel lands
 * when the lid is shut. A lid fragment reads that photograph *there*: shut,
 * every pixel the lid covers is the closed photograph's own; half-shut, the
 * margin already wears the closed lash line and the band above it closed lid
 * skin, because that is what those texels become. The blend follows the lid's
 * own influence, so a lid held part-way on purpose — a downward glance, a
 * degraded link — changes a little of its content, and a blink all of it.
 *
 * How much each vertex may show is the build's to say (`_lid_shut_w`,
 * `morphs.lid_shut_weight`): all of the upper lid, fading out above the crease
 * with the lid's own pull, so the rest of the face is the photograph to the
 * byte at any lid value, and not at rest at all.
 */
// The lid's influence over which the closed photograph arrives. Not from 0, so
// the lid a glance lowers keeps nearly all of its own texture; full before the
// lid is, so the frames a blink is seen on are the closed photograph's.
const SHUT_FROM = 0.1;
const SHUT_FULL = 0.55;
// ...and over which the lower lid's lash fringe does (`_lid_shut_w` below 0).
// The lower lid hardly moves, so its fringe can only arrive with the upper
// margin: any earlier and a half-open eye wears it as a heavy lower liner.
const SHUT_FRINGE_FROM = 0.7;
const SHUT_FRINGE_FULL = 0.95;
const SHUT_VERTEX_HEAD = [
  ...LID_SHUT_ATTRS.map((name) => `attribute float ${name};`),
  "uniform vec2 uShutScale;", "varying vec2 vLidShut;", "varying float vLidShare;",
].join("\n");
const SHUT_VERTEX = [
  `vLidShut = vec2(${LID_SHUT_ATTRS[0]}, ${LID_SHUT_ATTRS[1]}) * uShutScale;`,
  `vLidShare = ${LID_SHUT_ATTRS[2]};`,
].join("\n");
const SHUT_UNIFORMS = [
  "uniform sampler2D uShut;", "uniform vec4 uShutTile;", "uniform vec2 uShutU;",
  "uniform vec2 uShutLid;", "uniform vec2 uShutFringe;", "varying vec2 vLidShut;", "varying float vLidShare;",
].join("\n");
const SHUT_FRAGMENT = [
  "vec2 shutAt = clamp(uShutTile.xz + uShutTile.yw * (vMapUv + vLidShut), 0.0, 1.0);",
  "vec3 shutColour = texture2D(uShut, shutAt).rgb;",
  `float shutSide = smoothstep(-${EXPRESSION_SPLIT}, ${EXPRESSION_SPLIT}, uShutU.x + uShutU.y * vMapUv.x);`,
  "float shutWeight = max(vLidShare, 0.0) * mix(uShutLid.x, uShutLid.y, shutSide)",
  "  + max(-vLidShare, 0.0) * mix(uShutFringe.x, uShutFringe.y, shutSide);",
  "diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * shutColour, shutWeight);",
].join("\n");

interface Shut {
  readonly map: THREE.Texture;
  readonly lid: THREE.Vector2;
  readonly fringe: THREE.Vector2;
  readonly uniforms: Record<string, THREE.IUniform>;
}

/** The closed photograph from its carrier's node, or `null` for an asset
 *  without one, whose lids shut on their own texels as they always have. */
function shutLids(carrier: THREE.Mesh): Shut | null {
  const { shut_tile: tile, shut_u: u, shut_scale: scale } = carrier.userData;
  const map = (carrier.material as THREE.MeshStandardMaterial).map;
  if (!map || !Array.isArray(tile) || !Array.isArray(u) || !Array.isArray(scale)) return null;
  const lid = new THREE.Vector2();
  const fringe = new THREE.Vector2();
  return {
    map, lid, fringe,
    uniforms: {
      uShut: { value: map },
      uShutTile: { value: new THREE.Vector4(tile[0], tile[1], tile[2], tile[3]) },
      uShutU: { value: new THREE.Vector2(u[0], u[1]) },
      uShutScale: { value: new THREE.Vector2(scale[0], scale[1]) },
      uShutLid: { value: lid },
      uShutFringe: { value: fringe },
    },
  };
}

/**
 * The neck, taught to wear the jaw's shadow where the jaw is.
 *
 * The photograph paints the shadow the chin casts on the throat, and a painted
 * shadow stays where it was painted: under a 9° turn the jaw crossed the top of
 * the neck by 8 px and its shadow did not, which read as the neck sliding out
 * from under the head. So the build lifts it into a ratio tile
 * (`project_albedo.lift_jaw_shadow`) and each neck fragment reads it at the
 * *turned* head's rim, offset by how far the jaw has dropped — a rigid
 * transform does not carry a morph, which was the other half of the same
 * defect: an open mouth left the shadow banded across the throat at the closed
 * rim with nothing casting it.
 *
 * The tile's edges are white and the lookup clamped to it, so a ray landing
 * past it reads "no shadow" rather than the hair or the iris beside it.
 */
function jawShadow(base: THREE.MeshStandardMaterial, uv: number[], extent: number[],
                   rimZ: number, headInverse: { value: THREE.Matrix4 },
                   jawDrop: { value: number }) {
  const material = base.clone();
  const tile = { value: new THREE.Vector4(uv[0], uv[1], uv[2], uv[3]) };
  const bounds = { value: new THREE.Vector4(extent[0], extent[1], extent[2], extent[3]) };
  const rim = { value: rimZ };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadInverse = headInverse;
    shader.uniforms.uJawTile = tile;
    shader.uniforms.uJawBounds = bounds;
    shader.uniforms.uJawRim = rim;
    shader.uniforms.uJawDrop = jawDrop;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vJawView;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvJawView = mvPosition.xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vJawView;\nuniform mat4 uHeadInverse;\n"
        + "uniform vec4 uJawTile;\nuniform vec4 uJawBounds;\nuniform float uJawRim;\n"
        + "uniform float uJawDrop;")
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n"
        + "vec3 jawFrom = (uHeadInverse * vec4(vJawView, 1.0)).xyz;\n"
        + "vec3 jawRay = (uHeadInverse * vec4(0.0, 0.0, 1.0, 0.0)).xyz;\n"
        + "vec2 jawAt = jawFrom.xy + jawRay.xy * ((uJawRim - jawFrom.z) / jawRay.z);\n"
        + "jawAt.y += uJawDrop;\n"
        + "jawAt = clamp(jawAt, uJawBounds.xz, uJawBounds.yw);\n"
        + "vec3 jawShadow = texture2D(map, uJawTile.xz + uJawTile.yw * jawAt).rgb;\n"
        + "diffuseColor.rgb *= jawShadow;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= jawShadow;");
  };
  material.customProgramCacheKey = () => "tara-jaw-shadow";
  return material;
}

/** Lamps, standing in for the four area lights `build_character.setup_scene` uses.
 *
 * The albedo is a photograph and already holds this face's light, so 75% of it
 * is emitted verbatim (`emissiveFactor` in the GLB) and only the remaining 25%
 * is handed to these. They exist for the quarter that makes a yaw read as a
 * head turning rather than a picture sliding; their sum along the face normal
 * is π, which is exactly the irradiance that renders that quarter back at full
 * albedo — so the rest frame is the reference photograph, and only a turned
 * head departs from it.
 */
const AMBIENT = 0.62 * Math.PI;
const KEY = 0.26 * Math.PI;
const WRAP = 0.10 * Math.PI;

/** Frames drawn per second, capped rather than left at the display's rate.
 *
 * Measured on an M1 over four paired reps against `peep`, which is the SVG
 * avatar that already ships: uncapped at 60 the 3-D face cost 13.8 points of
 * one core more than peep; capped at 30 the difference was inside the noise
 * (−0.9 points over three reps). The cap is most of the runtime cost of being
 * 3-D at all.
 *
 * It throttles *drawing* only. The mixer runs its own rAF loop and keeps its
 * own clock, so cue timing is exactly as accurate as it was — what drops is how
 * often that clock is looked at, not how well it is kept.
 */
const RENDER_FPS = 30;
const MIN_FRAME_MS = 1000 / RENDER_FPS;

export interface CharacterRigOptions {
  /** Called once the GLB is in the scene, for a capture tool that must wait. */
  readonly onReady?: () => void;
  /** The character's GLB. Every build fact the rig reads (jaw-shadow tile, rim
   *  depth, morph names) travels in the GLB's own extras, so a character built
   *  by the same scripts needs nothing else.
   *
   *  Required, and deliberately not defaulted: a default would make this module
   *  import one character's URL, and a bundler emits assets per module — so
   *  every consumer of *any* character would ship that one's GLB whether or not
   *  they mounted it. The caller knows which character it is building; this
   *  file must not ([tara-asset.ts](./tara-asset.ts)). */
  readonly url: string;
  /** `false` leaves an asset's expression maps unread, for a capture tool
   *  comparing the face with and without them. */
  readonly expression?: boolean;
  /** Keeps the drawing buffer readable after the browser has composited it, so
   *  a caller can copy the canvas out at any moment rather than only from
   *  inside the frame that drew it.
   *
   *  A pose sheet reuses one context, holding a pose still and copying the
   *  canvas into a tile; copy outside the drawing frame without this and the
   *  buffer has already been cleared, which is a blank tile and not an error.
   *  A consumer must not have it: the buffer can no longer be discarded, which
   *  on some drivers means a second copy of every frame. */
  readonly readback?: boolean;
}

const radians = (deg: number) => (deg * Math.PI) / 180;

/** The renderer, or `null` where the browser will not give a context.
 *
 * Three.js throws out of the constructor rather than returning anything, and it
 * has already written its own line to the console by then; that line is kept
 * because it names the underlying reason, which this one does not. */
function webglRenderer(readback = false): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: readback });
  } catch {
    return null;
  }
}

/**
 * The lower lid follows the eye down. Its retractor is tied to the inferior
 * rectus, so a look down pulls the lower margin down with it by a millimetre
 * or two — the upper lid's half of this is the mixer's `lidBias`, and a face
 * whose upper lid follows while the lower one stays reads as a drowsy droop
 * rather than a glance. Driven through the squint target run backwards,
 * which is the lower lid and nothing else: at the notes gaze (`pupilY` 0.72)
 * the margin drops ~0.006, about 1.7 px at the 400 px tile.
 */
const LOWER_LID_FOLLOW = 0.35;

/**
 * Where a lid channel's influence reaches a shut eye. Not at 1, because the
 * mixer never asks for 1: a blink is a triangle (`idle.BLINK_DUR`), the lid
 * channel's 18 ms smoothing rounds its peak off, and this rig draws at 30 fps.
 * `LID_SHUT` was set when blinks ran 0.11–0.15 s, at the fifth percentile of
 * the peak a viewer actually saw (median 0.74). At the present 0.19–0.23 s
 * that peak is 0.85 median and 0.81 at the fifth percentile — simulated over
 * the same smoothing and frame phase — so every blink still lands shut, with
 * margin. A lid morph that shut only at 1 left every blink a quarter open — the
 * lid came down and the iris was still there.
 *
 * So above `LID_KNEE` the influence is eased up to meet 1 at `LID_SHUT`, and
 * held there: past that point the lid has landed on the lower one. Below the
 * knee it is untouched, and that is every lid held part-way on purpose — the
 * lowered lid of a degraded link, the lid following a downward gaze — so those
 * look exactly as they did. The ease is quadratic from the knee, so both the
 * value and its slope are continuous there.
 *
 * `scripts/morphs.py:influence` parses both numbers out of this file.
 */
const LID_KNEE = 0.35;
const LID_SHUT = 0.66;

/**
 * A squint's influence rises faster than its channel. The mixer's values are
 * set where a line face's lower lid reads — a smile's squint is 0.30 — and a
 * photographic lower lid rising 0.30 of its travel is a pixel or two, so the
 * squint that makes a smile real was not there. The lower-lid follow, which
 * runs this target backwards, is added after the curve and stays linear.
 *
 * The curve needs a ceiling as well as a lift, because the squint stacks and
 * the mouth does not. A *silent* smile takes squint from three layers at once —
 * an approval clip, the encouraging emotion and prosody's warmth — which reach
 * 0.51 together, while the smile map saturates at a mouth corner of 0.8 and no
 * layer drives the jaw, so the last third of a smile arrives as narrowing eyes
 * over lips that cannot part any further. On a line face that reads as warmth.
 * On a photograph it reads as sedation: a reviewer watching a recorded call
 * read those two moments as the avatar falling asleep or heavily medicated, and
 * named the eyes, not the mouth. The ceiling is where the face stops reading
 * drugged, judged at crop. The knee is low enough that an ordinary one-layer
 * smile is untouched (0.22 renders 0.402 against 0.403 with no ceiling), and
 * the approach is exponential rather than a clamp so the slope is continuous
 * where the two meet and the lower lid never visibly sticks.
 */
const SQUINT_CURVE = 0.6;
const SQUINT_KNEE = 0.2;
const SQUINT_CEIL = 0.54;

const squintCurve = (i: number): number => {
  if (i <= 0) return i;
  if (i <= SQUINT_KNEE) return i ** SQUINT_CURVE;
  const knee = SQUINT_KNEE ** SQUINT_CURVE;
  const slope = SQUINT_CURVE * SQUINT_KNEE ** (SQUINT_CURVE - 1);
  const head = SQUINT_CEIL - knee;
  return SQUINT_CEIL - head * Math.exp((-slope * (i - SQUINT_KNEE)) / head);
};

const lidClosure = (i: number): number => {
  if (i <= LID_KNEE) return i;
  if (i >= LID_SHUT) return 1;
  const t = (i - LID_KNEE) / (LID_SHUT - LID_KNEE);
  return i + (1 - LID_SHUT) * t * t;
};

/**
 * The neck's follow targets, and the one place a morph is not driven by
 * `influence`.
 *
 * `scripts/morphs.neck_targets` authors two fields per head axis — `A P` and
 * `A^2 P` for that axis's skew matrix — because a rigid rotation is exactly
 * `sin(th)` of the first plus `1 - cos(th)` of the second. A single field scaled
 * by the pose is the *linear* approximation of that, and it stretches the neck
 * away from the pivot by `radius x (1 - cos th)`: fine at six degrees, five
 * pixels at the envelope a nod that lands actually needs.
 *
 * So under pitch and roll the throat tracks the skull exactly at any angle,
 * and — the part worth having — the asset stops depending on the envelope.
 * These fields carry no angle, so `HEAD_DEG` above is a runtime number that can
 * move without leaving a built GLB stale. Yaw's pair is a partial twist rather
 * than the skull's own rotation, and the build weights its two fields so these
 * same two influences drive it (`morphs.neck_twist`).
 */
const NECK_QUAD = "_q";
const HEAD_AXIS: Record<string, keyof typeof HEAD_DEG> = {
  headYaw: "yaw", headPitch: "pitch", headRoll: "roll",
};

const neckInfluence = (channel: string, pose: RigPose): number | null => {
  const quad = channel.endsWith(NECK_QUAD);
  const axis = HEAD_AXIS[quad ? channel.slice(0, -NECK_QUAD.length) : channel];
  if (!axis) return null;
  const value = pose[quad ? channel.slice(0, -NECK_QUAD.length) : channel] ?? 0;
  const radians = ((value / HEAD_CLAMP) * HEAD_DEG[axis] * Math.PI) / 180;
  return quad ? 1 - Math.cos(radians) : Math.sin(radians);
};

/**
 * The hair's roll, which is the one thing in this rig that is not a function of
 * the pose alone. `hold` is the share of the head's roll the hanging hair
 * declines to take, and `hz`/`damping` are how it gets there.
 *
 * A hank that hangs past the jaw is lying on a shoulder, and a shoulder does
 * not tilt when the head does: rolled rigidly with the skull it lifts off the
 * collar and the page shows through behind it, so the shell gives up `hold` of
 * the roll at its lowest rows and none at the crown (`morphs.hair_hold`).
 *
 * The other half is why roll read as a hinge at all. A rigid rotation about a
 * fixed point *is* a hinge, and what a real tilt has that this lacked is hair
 * that arrives late and settles (`docs/research-head-rotation.md` § 3.1:
 * mobility ~0.95, delay 0.8-0.9, one clear overshoot). At 0.65 that is a single
 * visible overshoot, inside 5% of the hold in 450 ms — faster reads as a flick,
 * slower as wet hair.
 *
 * It is on the hair and not on `headRoll` on purpose: every clip in the library
 * is authored pre-compensated for the mixer's per-channel time constants, so a
 * spring on the channel would silently re-time every nod ever authored.
 */
export const HAIR_ROLL = { hold: 0.85, hz: 1.5, damping: 0.65 };

/**
 * One step of `HAIR_ROLL`'s spring: semi-implicit, the rate taking the frame's
 * acceleration before the angle takes the rate. Explicit Euler rings at this
 * stiffness and 30 fps; this does not, which is the only reason the order of
 * those two lines is worth a sentence.
 *
 * Exported for `test/nods.test.ts`: settle time and overshoot are numbers, not
 * something a still frame can show.
 */
export const hairRollStep = (angle: number, rate: number, target: number, dt: number) => {
  const w = 2 * Math.PI * HAIR_ROLL.hz;
  const next = rate + (w * w * (target - angle) - 2 * HAIR_ROLL.damping * w * rate) * dt;
  return { angle: angle + next * dt, rate: next };
};

/** The hair pair's two influences, from the *extra* angle the shell is turned
 *  by — the same `sin` / `1 - cos` terms the neck's fields are driven with. */
const hairInfluence = (channel: string, extra: number): number | null => {
  if (channel === "headRoll") return Math.sin(extra);
  if (channel === "headRoll" + NECK_QUAD) return 1 - Math.cos(extra);
  return null;
};

/**
 * A channel's morph influence — the same law `scripts/morphs.py:influence`
 * uses, so a Blender preview and the browser pose the face identically.
 *
 * It is allowed to go negative, which is what lets one target serve a
 * bidirectional channel: `mouthCornerL` at −1.4 is the smile target run
 * backwards into a frown, and `lidL` below its rest opens the eye wider than
 * neutral. A rig that clamped this at 0 would silently delete the negative half
 * of every channel that has one.
 */
const influence = (channel: string, value: number): number => {
  const rest = (REST as Record<string, number>)[channel] ?? 0;
  const i = (value - rest) / (1 - rest);
  if (channel === "lidL" || channel === "lidR") return lidClosure(i);
  return channel === "squintL" || channel === "squintR" ? squintCurve(i) : i;
};

/**
 * The jaw a closure lets through. This shell hangs the lower lip from the
 * mandible (`morphs._mandible`), and the jaw is the slower of the two to settle
 * (`JAW_RESPONSE_TAU_S`), so into an [m] the lips have shut while the jaw is
 * still coming up. That pulls the lower lip back off the upper, and the teeth
 * show through the seam. A real lower lip closes over a jaw that is still
 * open. A press is what a seal looks like on these channels, so in proportion
 * to the press past rest the jaw is held to what the lips' own aperture
 * implies. The cost is a chin that arrives with the lips rather than just
 * after them, and that is not what a viewer looks at during an [m].
 */
const SEAL_FROM = VISEME_SHAPES.X.mouthPress ?? REST.mouthPress;
const SEAL_FULL = VISEME_SHAPES.A.mouthPress ?? 1;
function sealed(pose: RigPose): RigPose {
  const { jaw, mouthOpen = 0, mouthPress } = pose;
  if (jaw === undefined || mouthPress === undefined) return pose;
  const seal = Math.min(1, Math.max(0, (mouthPress - SEAL_FROM) / (SEAL_FULL - SEAL_FROM)));
  const excess = jaw - JAW_OF_OPEN * mouthOpen;
  return seal > 0 && excess > 0 ? { ...pose, jaw: jaw - seal * excess } : pose;
}

/** One side's weights for the asset's expression maps, in its order. A
 *  channel with no side (`mouthPress`) weighs the same on both. */
const expressionWeights = (pose: RigPose, side: "L" | "R", expression: Expression,
                           into: Float32Array) => {
  const at = (channel: string) => {
    const name = pose[channel + side] === undefined ? channel : channel + side;
    const value = pose[name];
    return value === undefined ? 0 : influence(name, value);
  };
  expression.names.forEach((map, i) => {
    const weight = EXPRESSION_WEIGHT[map]?.(at) ?? 0;
    into[i] = Math.min(Math.max(weight, 0), 1);
  });
};

export function createCharacterRig(mount: HTMLElement, options?: unknown): AvatarRig {
  const { onReady, url, expression: readExpression = true, readback = false } =
    (options ?? {}) as CharacterRigOptions;
  // A missing `url` is a caller's defect, not a browser condition — the WebGL
  // path below degrades because a driver is nobody's fault, whereas this would
  // otherwise be a 404 on a path spelled `undefined`.
  if (!url) throw new TypeError("createCharacterRig: `url` is required");
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, FRAME_CENTRE, 6);
  camera.lookAt(0, FRAME_CENTRE, 0);

  const renderer = webglRenderer(readback);
  // `createAvatar` is synchronous, so anything thrown here lands in the
  // consumer's window and takes the call page with it over a browser condition
  // that is nobody's defect. The right outcome is a call that still has audio,
  // captions and states, with an empty tile where the head would be.
  //
  // `warn` rather than `error` on purpose: `[avatar]` console errors mean a
  // defect in this package, and the capture tools fail a run on any of them.
  // This one says the environment cannot draw, which is a different sentence.
  if (!renderer) {
    console.warn("[avatar] no WebGL context; this character will not render in this browser");
    return { apply() { /* nothing to pose */ }, destroy() { /* nothing to release */ } };
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // `setSize(…, false)` below leaves CSS alone, so the canvas has to be told to
  // fill the mount. Without this it displays at its backing-store size, which on
  // a 2x screen is a head twice the tile, cropped to its top-left quarter —
  // invisible at devicePixelRatio 1, which is what every capture tool ran at.
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  mount.append(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT));
  const key = new THREE.DirectionalLight(0xffffff, KEY);
  key.position.set(0, 1.0, 3.0);
  scene.add(key);
  for (const x of [-1.9, 1.9]) {
    const wrap = new THREE.DirectionalLight(0xffffff, WRAP);
    wrap.position.set(x, 1.0, 2.5);
    scene.add(wrap);
  }

  // The head swings as a group; the neck and torso do not (see HEAD_PARTS).
  // Parenting to a pivot object rather than rotating each part is not a
  // convenience — the parts have to rotate about a shared point, and a per-mesh
  // rotation about each mesh's own origin would slide them apart.
  //
  // The body's two transforms nest outside it, one group each (see BODY):
  // `trunk` sways everything, and `lift` carries the neck and head on the
  // breath the torso takes inside `trunk` — and on the lean's rigid share,
  // which reaches the head the same way for the same reason.
  const trunk = new THREE.Group();
  const lift = new THREE.Group();
  const head = new THREE.Group();
  // The asset's own, once it has loaded; these hold the shape of the hierarchy
  // until then, and nothing draws before that.
  let pivot = PIVOT.clone();
  let rollPivot = ROLL_PIVOT.clone();
  head.position.copy(pivot);
  // Yaw and pitch turn `head`; roll turns `tilt`, which rides inside them at
  // the chin (`rollPivot`), so the parts hang from `tilt`.
  const tilt = new THREE.Group();
  tilt.position.subVectors(rollPivot, pivot);
  scene.add(trunk);
  trunk.add(lift);
  lift.add(head);
  head.add(tilt);
  let torso: THREE.Object3D | null = null;

  let destroyed = false;
  let pending: RigPose | null = null;
  let loaded = false;
  let warnedAboutRuntimeBudget = false;
  // Every mesh that owns morph targets, paired with the dictionary three.js
  // built from the GLB's `extras.targetNames` — i.e. the pose channel names
  // `scripts/morphs.py` authored them under.
  const morphed: THREE.Mesh[] = [];
  const eyes: THREE.Object3D[] = [];
  // Both globes turn together, so one rotation serves both sockets.
  const gaze = { value: new THREE.Matrix3() };
  const lidShade = { L: { value: 1 }, R: { value: 1 } };
  const turn = new THREE.Matrix4();
  let expression: Expression | null = null;
  let shut: Shut | null = null;
  // The `Hair` shell, on a character whose hair hangs low enough to have the
  // roll pair, and the `HairLayer` over the body, on one whose hair is a layer
  // of its own; empty where the hair stops beside the temple (`HAIR_ROLL`).
  const hairMeshes: THREE.Mesh[] = [];
  // The head's roll in the asset's own frame — what both the neck's follow and
  // the hair's are authored about — and the hair's own, which chases it.
  let headRollRad = 0;
  let hairRollRad = 0;
  let hairRate = 0;
  let hairSeeded = false;
  // How far the jaw's rim travels at jaw = 1 on this asset, and the uniform the
  // neck's shadow reads it through at the pose's influence (`jawShadow`).
  let jawRimTravel = 0;
  const jawDrop = { value: 0 };
  // The lip opening at rest and each channel's move of it, off the shell
  // (`build_character.lip_aperture`), as [top, bottom, left, right]; and what
  // `mouthInterior` reads it through, as (centre, top, half-width, height).
  let aperture: { rest: number[]; deltas: [string, number[]][] } | null = null;
  const mouthOpening = { value: new THREE.Vector4(0, 0, 1, 1) };
  const tongueLift = { value: 0 };

  /** The share of the head's roll the hair settles at. */
  const hairTarget = () => headRollRad * (1 - HAIR_ROLL.hold);

  const writeHair = () => {
    const extra = hairRollRad - headRollRad;
    for (const mesh of hairMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const [channel, index] of Object.entries(dictionary)) {
        const term = hairInfluence(channel, extra);
        if (term !== null) influences[index] = term;
      }
    }
  };

  const stepHair = (dt: number) => {
    if (!hairMeshes.length || !hairSeeded) return;
    ({ angle: hairRollRad, rate: hairRate } =
      hairRollStep(hairRollRad, hairRate, hairTarget(), dt));
  };

  const resize = () => {
    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight || Math.round((width * 3) / 4));
    renderer.setPixelRatio(pixelRatioFor(width, height, window.devicePixelRatio));
    renderer.setSize(width, height, false);
    // The framed *height* is fixed and the width follows the mount, so a tile
    // of the wrong aspect shows more or less background rather than a face of
    // the wrong shape. The atlas cannot be stretched: it is a photograph.
    // Symmetric about the camera, which is *already* at the frame's centre
    // height — offsetting the frustum by that centre as well applies it twice,
    // and the face rendered 0.47 face heights low, at exactly the right size,
    // which reads as a framing choice rather than as the arithmetic error it
    // was.
    const halfHeight = FRAME_HEIGHT / 2;
    const halfWidth = (halfHeight * width) / height;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();

  const applyPose = (given: RigPose) => {
    const pose = sealed(given);
    headRollRad = radians(((pose.headRoll ?? 0) / HEAD_CLAMP) * HEAD_DEG.roll);
    // The first pose is a starting point, not a movement: seed the hair where it
    // would have settled, so a tool that sets one pose and screenshots it gets
    // the hold with no transient, and only a *change* of roll swings the hank.
    if (!hairSeeded) { hairSeeded = true; hairRollRad = hairTarget(); hairRate = 0; }
    for (const mesh of morphed) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      const neck = mesh.name === "Neck";
      const hair = hairMeshes.includes(mesh);
      for (const [channel, index] of Object.entries(dictionary)) {
        // The hair carries the head's roll channel too, and it is neither a
        // channel value nor the head's own angle: it is how much *further* than
        // the skull this shell is turned, which is negative while it holds and
        // swings either side of that while it settles (`HAIR_ROLL`).
        if (hair) {
          const term = hairInfluence(channel, hairRollRad - headRollRad);
          if (term !== null) { influences[index] = term; continue; }
        }
        // The neck's head targets are the rotation's two terms, not a channel
        // scaled by the influence law. Only on the neck and the hair layer's
        // yaw hold (`morphs.hair_layer_targets`), whose field carries the hold
        // and takes the skull's own angle: the same three channel names on the
        // head group are a rigid transform, and nowhere else.
        if (neck || (hair && mesh.name === "HairLayer")) {
          const term = neckInfluence(channel, pose);
          if (term !== null) { influences[index] = term; continue; }
        }
        const value = pose[channel];
        const follow = channel.startsWith("squint") ? LOWER_LID_FOLLOW * Math.max(pose.pupilY ?? 0, 0) : 0;
        if (value === undefined && !follow) continue;
        influences[index] = (value === undefined ? 0 : influence(channel, value)) - follow;
      }
    }
    // The chin's shadow on the throat rides the same channel the chin does.
    jawDrop.value = jawRimTravel
      * (pose.jaw === undefined ? 0 : influence("jaw", pose.jaw));
    if (aperture) {
      const at = aperture.rest.slice();
      for (const [channel, delta] of aperture.deltas) {
        const value = pose[channel];
        if (value === undefined) continue;
        const k = influence(channel, value);
        for (let i = 0; i < 4; i++) at[i] += k * delta[i];
      }
      // A floor on the height so a shut mouth divides by something: the seam
      // it shows is a line, and what colour a line is does not read.
      mouthOpening.value.set((at[2] + at[3]) / 2, at[0], Math.max((at[3] - at[2]) / 2, 1e-3),
                             Math.max(at[0] - at[1], 2e-3));
    }
    tongueLift.value = pose.tongue === undefined ? 0 : influence("tongue", pose.tongue);
    // Blender's Z is face-space v, so its yaw is about Z, its pitch about X and
    // its roll about Y. The export maps Blender (x, y, z) to glTF (x, z, −y),
    // so Blender +Z *is* glTF +Y and Blender +X is glTF +X: yaw and pitch carry
    // across with their sign intact. Only roll changes sign, because Blender +Y
    // is glTF −Z, and that is a statement about two axes and not about the
    // channel.
    //
    // Yaw is not negated, and a negation here survived for a long time because
    // `build_character.pose_head` had the same one: the Blender preview and the
    // browser agreed with each other and only disagreed with the library.
    //
    // YXZ because that is the order a neck composes in — yaw carrying the pitch
    // — rather than the order three.js defaults to.
    // The body first, because the head's roll is stated against it.
    //
    // Positive `torsoTurn` takes the trunk to the viewer's right, which about a
    // pivot below it is a clockwise roll as the camera sees it: negative about
    // glTF +Z, the axis pointing at the camera.
    const sway = -radians((pose.torsoTurn ?? 0) * BODY.swayDeg);
    trunk.rotation.z = sway;
    trunk.position.set(BODY.hip * Math.sin(sway), BODY.hip * (1 - Math.cos(sway)), 0);
    // `torsoLean` itself is not applied here at all — it is two morph targets on
    // the shell, driven by the generic loop above like any other channel that
    // rests at 0. What is left for the rig is the head's ride: above the collar
    // the field is flat, so the neck and head take a pure translation and the
    // head does not deform under a body lean (research § 8 item 4). `morphs.py`
    // parses `leanRide`, so this is the same number the field plateaus at.
    const breath = pose.breath ?? 0;
    if (torso) {
      torso.scale.set(1 + breath * BODY.widen, 1 + breath * BODY.rise, 1);
      torso.position.y = -BODY.swellPivot * breath * BODY.rise;
    }
    lift.position.y = breath * BODY.rise * (BODY.collar - BODY.swellPivot)
      - (pose.torsoLean ?? 0) * BODY.leanRide;

    head.rotation.order = "YXZ";
    head.rotation.set(
      radians(((pose.headPitch ?? 0) / HEAD_CLAMP) * HEAD_DEG.pitch),
      radians(((pose.headYaw ?? 0) / HEAD_CLAMP) * HEAD_DEG.yaw),
      0,
    );
    // Less the trunk's roll, so the head's world roll is `headRoll` and
    // nothing else. Exact about Z alone; with the yaw and pitch it composes
    // with, the error is the product of two sub-degree angles.
    tilt.rotation.z = -headRollRad - sway;
    for (const globe of eyes) {
      globe.rotation.order = "YXZ";
      globe.rotation.set(
        (pose.pupilY ?? 0) * GAZE_TRAVEL.y / GLOBE_RADIUS,
        (pose.pupilX ?? 0) * GAZE_TRAVEL.x / GLOBE_RADIUS,
        0,
      );
    }
    if (eyes.length) gaze.value.setFromMatrix4(turn.makeRotationFromEuler(eyes[0].rotation));
    for (const side of ["L", "R"] as const) {
      const value = pose[`lid${side}`];
      const i = value === undefined ? 0 : influence(`lid${side}`, value);
      lidShade[side].value = 1 - LID_SHADE * THREE.MathUtils.smoothstep(i, LID_SHADE_FROM, 1);
    }
    if (expression) {
      expressionWeights(pose, "L", expression, expression.left);
      expressionWeights(pose, "R", expression, expression.right);
    }
    if (shut) {
      const closure = (channel: "lidL" | "lidR") => {
        const value = pose[channel];
        return value === undefined ? 0 : influence(channel, value);
      };
      const [l, r] = [closure("lidL"), closure("lidR")];
      const { smoothstep } = THREE.MathUtils;
      shut.lid.set(smoothstep(l, SHUT_FROM, SHUT_FULL), smoothstep(r, SHUT_FROM, SHUT_FULL));
      shut.fringe.set(smoothstep(l, SHUT_FRINGE_FROM, SHUT_FRINGE_FULL),
                      smoothstep(r, SHUT_FRINGE_FROM, SHUT_FRINGE_FULL));
    }
  };

  new GLTFLoader().load(url, (gltf) => {
    if (destroyed) return;
    // Where this head turns and tilts, and what rides its skull, are facts
    // about this head — measured by the build, stamped into the scene, and read
    // here before anything is reparented into the frames they define. An asset
    // that predates the stamp keeps the constants above, which are the numbers
    // it was built with.
    const stamp = (gltf.scene.userData ?? {}) as Record<string, unknown>;
    pivot = stampedVec(stamp, "head_pivot", PIVOT);
    rollPivot = stampedVec(stamp, "roll_pivot", ROLL_PIVOT);
    head.position.copy(pivot);
    tilt.position.subVectors(rollPivot, pivot);
    const headParts = Array.isArray(stamp.head_parts)
      && stamp.head_parts.every((n) => typeof n === "string")
      ? stamp.head_parts as string[] : HEAD_PARTS;
    trunk.add(gltf.scene);
    // Collect the morphed meshes *before* reparenting: every one of them is a
    // head part, so a traverse of `gltf.scene` after the move finds only the
    // neck and the torso and the whole face goes rigid — silently, because a
    // rig with nothing to drive still renders a perfectly good rest pose.
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary) morphed.push(mesh);
      // Kept aside as well: its roll pair is driven by a clock and not only by a
      // pose, so the render loop has to reach it between poses (`HAIR_ROLL`).
      if (mesh.isMesh && (mesh.name === "Hair" || mesh.name === "HairLayer")
        && mesh.morphTargetDictionary) hairMeshes.push(mesh);
      // Hair that lies over the body is in front of everything the portrait
      // has, and it turns with the skull where the chest does not: tested
      // against depth, a nod swings the lower hank back through the chest.
      if (mesh.isMesh && mesh.name === "HairLayer") {
        (mesh.material as THREE.Material).depthTest = false;
        mesh.renderOrder = 1;
      }
    });
    // Out of the scene before anything draws it: it carries the maps, and is
    // one triangle behind the body that nothing should pay a draw call for.
    const carrier = gltf.scene.getObjectByName("Expression") as THREE.Mesh | undefined;
    if (carrier) {
      carrier.removeFromParent();
      expression = readExpression ? expressive(carrier) : null;
      if (!expression) (carrier.material as THREE.MeshStandardMaterial).map?.dispose();
      carrier.geometry.dispose();
      (carrier.material as THREE.Material).dispose();
    }
    const shutCarrier = gltf.scene.getObjectByName("Shut") as THREE.Mesh | undefined;
    if (shutCarrier) {
      shutCarrier.removeFromParent();
      shut = shutLids(shutCarrier);
      if (!shut) (shutCarrier.material as THREE.MeshStandardMaterial).map?.dispose();
      shutCarrier.geometry.dispose();
      (shutCarrier.material as THREE.Material).dispose();
    }
    for (const name of headParts) {
      const part = gltf.scene.getObjectByName(name);
      // Reparenting moves the object into the tilt's frame, whose origin is
      // the roll pivot, so subtract that to leave the part where it was
      // authored. `attach()` would do this from the world matrix, which has
      // not been computed yet at load.
      if (part) {
        part.position.sub(rollPivot);
        tilt.add(part);
      }
    }
    // One clone per source material, shared by every shell that carries the
    // field; a mesh without it keeps the material it came with.
    // The shell with the lids is a clone of its own: the ears and the hair
    // share its material and have no lid attributes to read.
    const turned = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const lidded = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    head.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute(MOTION_DEPTH)) return;
      const base = mesh.material as THREE.MeshStandardMaterial;
      const withLids = shut !== null && LID_SHUT_ATTRS.every((name) => mesh.geometry.getAttribute(name) !== undefined);
      const cache = withLids ? lidded : turned;
      const own = cache.get(base)
        ?? motionDepth(base, expression ?? undefined, withLids ? shut ?? undefined : undefined);
      cache.set(base, own);
      mesh.material = own;
    });
    // The neck rides the breath with the head; the torso *is* the breath. Both
    // are authored in world space with identity nodes, and `lift` sits at the
    // origin until a pose arrives, so moving the neck needs no correction.
    const neck = gltf.scene.getObjectByName("Neck") as THREE.Mesh | undefined;
    if (neck) lift.add(neck);
    // The shadow's map comes from the build (`build_character.py`, the neck); an
    // asset without it keeps the shadow painted on, as every build did before.
    const skull = head.getObjectByName("Head");
    const { jaw_shadow_uv: jawUv, jaw_shadow_extent: jawExtent, jaw_shadow_rim_z: jawRim,
            jaw_shadow_drop: jawTravel } = neck?.userData ?? {};
    if (neck && skull && Array.isArray(jawUv) && Array.isArray(jawExtent) && typeof jawRim === "number") {
      const headInverse = { value: new THREE.Matrix4() };
      // A build that predates the travel keeps the shadow rotating but not
      // opening, which is where this started and is still better than no tile.
      jawRimTravel = typeof jawTravel === "number" ? jawTravel : 0;
      neck.material = jawShadow(neck.material as THREE.MeshStandardMaterial, jawUv, jawExtent,
                                jawRim, headInverse, jawDrop);
      neck.onBeforeRender = (_renderer, _scene, camera) => {
        headInverse.value.multiplyMatrices(camera.matrixWorldInverse, skull.matrixWorld).invert();
      };
    }
    torso = gltf.scene.getObjectByName("Body") ?? null;
    for (const name of ["Eye_L", "Eye_R"]) {
      const globe = head.getObjectByName(name);
      if (!globe) continue;
      // The globe's geometry is authored in world space with no node transform,
      // so it has to be rotated about its own centre rather than about the
      // origin. Re-centre the geometry once and put the offset on the node; the
      // catchlight is already a child and rides the globe, which is what a
      // reflection on a wet cornea does.
      const geometry = (globe as THREE.Mesh).geometry;
      geometry.computeBoundingSphere();
      const centre = geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
      geometry.translate(-centre.x, -centre.y, -centre.z);
      globe.position.add(centre);
      for (const child of globe.children) child.position.sub(centre);
      const mesh = globe as THREE.Mesh;
      // Whether the globe turns deep is the attribute's to say, not the name's —
      // the same rule the frame's shells are found by above. An asset built
      // before the globes carried the field keeps the socket shader alone.
      mesh.material = socketed(mesh.material as THREE.MeshStandardMaterial,
                               name === "Eye_L" ? -1 : 1, gaze,
                               mesh.geometry.getAttribute(MOTION_DEPTH) !== undefined,
                               name === "Eye_L" ? lidShade.L : lidShade.R);
      eyes.push(globe);
    }
    // The mouth's inside, painted against the opening the lips make
    // (`mouthInterior`). Found by *mesh* name rather than material name:
    // `flat_material` hard-codes a `tara_` prefix, so tushar's cavity material
    // is called `tara_cavity` as well, and the mesh is what distinguishes it.
    // An asset built before the shell carried its opening keeps the flat fill.
    const opening = skull?.userData?.aperture as
      { rest?: unknown; deltas?: Record<string, unknown> } | undefined;
    if (opening && Array.isArray(opening.rest) && opening.rest.length === 4) {
      aperture = { rest: opening.rest as number[],
                   deltas: Object.entries(opening.deltas ?? {})
                     .filter((e): e is [string, number[]] => Array.isArray(e[1]) && e[1].length === 4) };
      for (const [name, lift] of [["Cavity", { value: 0 }], ["Tongue", tongueLift]] as const) {
        const mesh = head.getObjectByName(name) as THREE.Mesh | undefined;
        if (!mesh) continue;
        const extent = mesh.userData?.interior_extent;
        mesh.material = mouthInterior(mesh.material as THREE.MeshStandardMaterial, mouthOpening, lift,
                                      Array.isArray(extent) && extent.length === 4 ? extent : null);
      }
      const lower = head.getObjectByName("Teeth_Lower") as THREE.Mesh | undefined;
      if (lower) lower.material = lowerArch(lower.material as THREE.MeshStandardMaterial, mouthOpening);
      const upper = head.getObjectByName("Teeth_Upper") as THREE.Mesh | undefined;
      if (upper) upper.material = upperArch(upper.material as THREE.MeshStandardMaterial, mouthOpening);
    }
    // A rig with no morph targets still renders a perfectly good rest pose, so
    // the failure mode of losing them is a face that simply never moves — which
    // a still frame cannot show. Say so, loudly enough that the Gate B capture
    // (which fails on any `[avatar]` console error) catches it.
    if (!morphed.length) console.error("[avatar] this character has no morph targets; the face will not move", url);
    loaded = true;
    if (pending) applyPose(pending);
    onReady?.();
  }, undefined, (error: unknown) => console.error("[avatar] could not load this character", url, error));

  // rAF fires on the panel's own grid, so elapsed lands *near* the frame
  // interval and never on it, and a bare `elapsed < MIN_FRAME_MS` rejects the
  // frame it wants and waits for the next — 20 fps, not 30. The tolerance is
  // under half the interval at 120, 90 and 60 Hz, so it can never admit two
  // frames where one belongs.
  const GRID_TOLERANCE_MS = 4;
  let lastFrameMs = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const elapsed = now - lastFrameMs;
    if (elapsed < MIN_FRAME_MS - GRID_TOLERANCE_MS) return;
    lastFrameMs = now;
    // The hair lags the skull and settles behind it, which is a state and not a
    // function of the pose, so it advances on the clock. Clamped, because a tab
    // that was in the background hands back a gap and not a frame.
    stepHair(Math.min(elapsed / 1000, 0.1));
    writeHair();
    renderer.render(scene, camera);
    if (!warnedAboutRuntimeBudget &&
        (renderer.info.render.calls > HARD_BUDGET.drawCalls ||
         renderer.info.render.triangles > HARD_BUDGET.triangles)) {
      warnedAboutRuntimeBudget = true;
      console.warn("[avatar] runtime budget exceeded", {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
    }
  });

  return {
    apply(frame: AvatarFrame) {
      // The mixer smooths every channel before it gets here (each has its own
      // τ, `docs/internal-rig.md`), so the rig eases nothing itself. Poses that
      // arrive before the GLB does are not queued, only remembered: the newest
      // one is the only one that was ever going to be shown.
      if (!loaded) { pending = frame.pose; return; }
      applyPose(frame.pose);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        for (const item of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const material = item as THREE.MeshStandardMaterial | undefined;
          material?.map?.dispose();
          material?.emissiveMap?.dispose();
          material?.dispose();
        }
      });
      // A uniform, not a material's map, so the traverse above never meets it.
      expression?.map.dispose();
      shut?.map.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
