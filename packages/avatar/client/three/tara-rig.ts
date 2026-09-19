
/**
 * tara's renderer: the `AvatarRig` contract (`apply(frame)` / `destroy()`)
 * over the Blender-authored GLB.
 *
 * The whole file is one idea — **the pose channel is the interface, and every
 * mapping here is a translation of one channel into the one control that
 * renders it.** `scripts/morphs.py` authored the shape keys under the library's
 * own channel names precisely so this file never has to interpret a viseme, a
 * state or an emotion; it receives a fully mixed pose and moves geometry.
 *
 * Three kinds of control, in the order they appear below:
 *
 *   morph targets  the face itself — lips, jaw, lids, brows, and the mouth
 *                  interior that has to choreograph with them
 *   head group     `headYaw` / `headPitch` / `headRoll`, as a rotation of the
 *                  parts that ride the skull about the jaw-angle pivot
 *   eye globes     `pupilX` / `pupilY`, as a rotation of the eyeball, because
 *                  the iris is painted onto a sphere and cannot slide
 *
 * and a fourth, for the body: `shoulderL/R` are morph targets on the torso
 * shell like any face channel, and `breath`, `torsoLean` and `torsoTurn` are
 * each one transform of a group — a swell, a scale, a sway (see `BODY`).
 *
 * An asset may add a fifth: expression maps, which change the face's *light*
 * where a smile or a raised brow would, because moving the geometry cannot
 * (see `expressive`).
 */

import { REST } from "../internal.js";
import type { AvatarFrame, AvatarRig, RigPose } from "../internal.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ASSETS } from "./assets.js";
import { HARD_BUDGET, pixelRatioFor } from "./budgets.js";

/**
 * The camera, from `scripts/render_frame.py`. It is orthographic and that is
 * forced by the albedo rather than chosen: the atlas is a front-orthographic
 * projection of the shell, so an atlas texel sits at face-space (u, v) whatever
 * depth the triangle carrying it has. A perspective camera disagrees by
 * (offset from the axis) x (depth / distance) — which put the hair rim 3 px
 * above the hairline it is textured to and opened a black band across the
 * forehead. `build_tara.setup_scene` has the measurement.
 */
const FRAME = { bottom: -0.52, top: 1.46 };
const FRAME_HEIGHT = FRAME.top - FRAME.bottom;
const FRAME_CENTRE = (FRAME.top + FRAME.bottom) / 2;

/**
 * Head motion, in degrees at the channel's own clamp of ±1.4.
 *
 * These are the program's *working* envelope, mapped so that a channel pinned to
 * its limit lands exactly on it. That is the point of scaling by the clamp
 * rather than by 1: the mixer cannot ask for more than the envelope allows, and
 * the hard ceiling stays unreachable by construction instead of by a second
 * clamp nobody runs.
 *
 * **It opened on 2026-09-12, from yaw ±6°, pitch ±5°, roll ±3°.** That
 * envelope made Busso's neutral-speech numbers unreachable: his mean
 * per-sentence pitch *range* is 9.5°, which is 95 % of everything ±5° could
 * ever produce, so speaking alone would have swung the channel corner to corner
 * and a deliberate nod on top of it would have had nowhere left to go. What had
 * held it there was the asset, not anatomy — the neck's follow was linear and
 * drew a second jawline past a few degrees — and once that follow became exact
 * (`NECK_QUAD` below) pitch could open to 24 and roll to 8.
 *
 * Yaw is still the smallest because it is the one axis this rig is genuinely
 * constrained on: the albedo is a front-orthographic projection of a 0.34-deep
 * shell, and a large turn is where that reads as a cardboard cutout rather than
 * a head. **It opened from 9° to 15° on 2026-09-18.** The cutout was measured
 * rather than assumed — a ladder rendered at 9/12/15/18/21/25/30 and read at
 * crop on all three characters is clean to 21° on tara and to 18° on tanya and
 * tushar. 9° was therefore set at half of where the artefact actually begins,
 * and the stiffness the owner reported on tanya's turns was that margin, not
 * her asset. 15° keeps 3° of headroom on the tightest of the three.
 *
 * This is not for speech: Busso wants ±1.15° of yaw in neutral conversation and
 * always did. It is for a head that turns to *look* at something, which is what
 * mocap drives and what pegged the channel — a real 25° turn still saturates at
 * 15°, so this widens the envelope without making it generous.
 *
 * And it is not the angle a pose may be *held* at, which is a stricter question
 * with its own measurement per character (`motion-limits.json`, applied through
 * `holds.ts`): a turn that returns is forgiven what a sustained one is not. The
 * two numbers differ by about 3x on yaw and neither is a correction of the
 * other.
 *
 * **Editing these needs no rebuild, but it is not free.** The neck's fields
 * carry no angle, so `tara.glb` cannot go stale against them. What a number
 * here does move:
 *
 * - Every clip is authored in channel units, so a degree here re-sizes every
 *   clip driving that axis. `test/nods.test.ts` bands *pitch* only — `down`,
 *   `up`, `upFirst` — and computes `yawPP` without ever asserting it. A yaw
 *   change moves nothing there; a pitch change moves four tests.
 * - `head_parallax.py` and `validate_morphs.py` quote their gates at this
 *   envelope. `validate_morphs` reads `morphs.head_envelope()`, but
 *   `head_parallax.POSES` hardcoded `yaw 9` until 2026-09-18 and would have
 *   gone on grading 9° while the rig shipped 15° — a gate defending a number
 *   nothing used. It derives both angles from here now.
 * - The yaw twist's two fields are an expansion in the angle, so their error
 *   grows as θ²/6. Against the exact rotation at the maximum ramp
 *   (`NECK_TWIST` = 0.5) that is 0.31 % at 9°, 0.85 % at 15°, 1.23 % at 18°
 *   (`morphs.neck_twist`). The note here used to read as a wall at 9°; it is
 *   not one — 15° costs under a percent of a displacement that is itself a
 *   fraction of the neck's radius.
 *
 * TARA-SPECIFIC: each number is her reach before an artefact shows — yaw by
 * the cutout, pitch by the neck fold that starts to crease at 24° chin-up.
 * Both were measured on the shipping surface, one axis at a time. This is still
 * one shared pair of
 * constants for all three characters, which holds only because 15° is inside
 * every one of them; the first character that wants more than its neighbours
 * forces the envelope onto `TaraRigOptions` as a per-character fact. A second
 * avatar measures its own with the audit.
 */
// Exported through `internal.ts` for the instruments that need to put a real
// angle *into* a channel, which is this scaling run backwards. The mocap
// instrument kept its own copy for want of that export and said in a comment
// that the copy would lie the day the envelope moved; it moved on 2026-09-18.
export const HEAD_CLAMP = 1.4;
export const HEAD_DEG = { yaw: 15, pitch: 24, roll: 8 };

/**
 * Where the head turns about, from `build_tara.PIVOT`, in glTF's Y-up frame:
 * Blender (x, y, z) exports as (x, z, −y). v 0.36 is the jaw angle and the
 * earlobe, and it sits a fifth of a face height *behind* the face plane —
 * a pivot on the surface spins the face in place, where a real yaw swings the
 * chin across as well as around, which is most of what makes a small turn read.
 */
const PIVOT = new THREE.Vector3(0.0, 0.36, -0.22);

/**
 * Where the head *tilts* about, from `morphs.ROLL_PIVOT`: the midline just
 * above the chin. A roll is a bend of the whole neck, so its centre is far
 * below the ear, and a drawn head sells it by holding the chin and swinging
 * the crown — Live2D's sample rigs tilt about this same point. About PIVOT
 * instead, the chin swung 7 px the other way at 8° and the head read as a
 * pendulum hung from the ears.
 *
 * It sits inside the yaw and pitch, so a turned head still tilts about its own
 * chin. TARA-SPECIFIC: see `morphs.ROLL_PIVOT` for what fixed the height and
 * what a second avatar supplies.
 */
const ROLL_PIVOT = new THREE.Vector3(0.0, 0.05, -0.22);

/**
 * What the head takes with it, from `build_tara.HEAD_PARTS`. `Body` stays
 * behind, and so does `Neck` — but the neck is not *static*: it carries
 * `headYaw` / `headPitch` / `headRoll` morph targets of its own, ramped from
 * full under the jaw to nothing at the collar (`morphs.neck_targets`). Pitch and
 * roll are the same rotation this group gets; yaw is a twist about the neck's
 * own axis at half the angle, which keeps the neck's outline where it is
 * (`morphs.neck_twist`). They need no code here at all, which is the
 * whole reason they are morphs: they are named for pose channels that rest at
 * 0, so the loop below drives them like any other channel and the influence law
 * hands them the raw pose value.
 *
 * Without it a turn dragged the skull's jaw rim across a throat that had not
 * moved, and the rim landed mid-neck as a second jawline — invisible at the
 * 400 × 300 tile, obvious at a 3× crop.
 */
const HEAD_PARTS = ["Head", "Ears", "Hair", "Eye_L", "Eye_R", "Cavity",
  "Teeth_Upper", "Teeth_Lower", "Tongue"];

/**
 * The body, in face-space units (glTF y is face-space v) and degrees.
 *
 * Every mechanism is the SVG faces' (`face-core.poseTransforms`); the
 * amplitudes are set from the anatomy, which on this face is ~8.8 px per
 * centimetre at the 400 × 300 tile (crown to chin is 1.39 units of ~24 cm),
 * and land at about peep's travel as a share of the same tile. The first cut
 * was 0.6 of peep, on the theory that a photograph shows a millimetre a line
 * drawing cannot. Measured in a 30-second listening hold it moved the
 * shoulders 2 px, under 1 % of the tile, and read as a still with a tremor:
 * the head was moving more than the body carrying it. Anatomy is the floor,
 * not a fraction of a cartoon — these now put a listening hold at 4-5 px at
 * the shoulders, still slow, and still well under the 1.5 Hz ceiling.
 *
 * breath  A swell, not a slide (`docs/research-biomechanics.md` §6.1): the
 *         torso scales about a point 0.35 of a frame below the frame, as peep's
 *         does about its hem, so the shoulder line comes up 2.4 px at full
 *         inhale against a lower edge that moves two-thirds of that, and the
 *         chest widens 2 px a side. Quiet breathing changes chest
 *         circumference 2-3 %; 1.2 % wide is the calm end of that in linear
 *         scale, and the rise is a little more because in this crop — about
 *         5 cm of chest below the collar — what a breath shows is the upper
 *         ribs and clavicles lifting as much as the rib cage widening. The
 *         neck and head ride the lift at the collar, derived rather than tuned
 *         (peep's `neckLift`), so the neck cannot telescope: ~2.4 px, the
 *         2-3 mm a seated head really moves with a breath.
 * lean    `torsoLean` as a deformation of the trunk, on the shell itself
 *         (`morphs.torso_targets`) — hem pinned at the frame's lower edge, the
 *         shoulders spreading and tipping as they come nearer. Only the head's
 *         *ride* is here: above the collar the field is flat, so the neck and
 *         head take a pure translation of `leanRide` and nothing else. That is
 *         Live2D's measured behaviour rather than a simplification — body angle
 *         moves every head part by 1.00 ± 0.02 and adds no differential motion
 *         inside the head (`docs/research-torso-motion.md` § 8 item 4).
 *
 *         It replaced a uniform `figure.scale.setScalar()`, which was peep's
 *         `LEAN_SCALE` carried onto photographic geometry and, with the
 *         orthographic camera outside the group it scaled, was arithmetically a
 *         zoom: fit the displacement as a linear map and its singular values
 *         came back equal to three decimals with no residual, at every lean the
 *         mixer produces. What it looked like was the owner's report — the
 *         shoulders swelling and dropping in half a second. The crown travelled
 *         4.56× what the eyes did, which is a head being scaled, not carried.
 *         A headless audit of what the crown travels against the eyes is that
 *         measurement, and its gates are what this change had to turn green.
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
 *  Exported through `internal.ts` for the same reason as the head envelope: an
 *  instrument that asks for "eyes on the camera through a head turn" is running
 *  this conversion backwards, and a second copy of it would be a second thing to
 *  update when the eye tile or the globe changes. */
export const EYE_DEG = { x: (GAZE_TRAVEL.x / GLOBE_RADIUS) * 180 / Math.PI, y: (GAZE_TRAVEL.y / GLOBE_RADIUS) * 180 / Math.PI };
const HEAD_UNIT_DEG = { x: HEAD_DEG.yaw / HEAD_CLAMP, y: HEAD_DEG.pitch / HEAD_CLAMP };

/**
 * The mixer's per-rig calibration for tara, passed by `tara.ts` and the motion
 * audit so both measure the same face. A pose unit is an angle here and a
 * pixel count on an SVG face, so the speech layer's amplitudes are tuned per
 * rig rather than in the library: `prosodyHeadGain` sizes speech-rhythm head
 * motion against this face's own motion envelope.
 *
 * `oculomotor` is the eye-head system sized for this face (`gaze.js`). Her eye
 * turns 10° a pupil unit and her head 6.4° of yaw a head unit, and the shared
 * look table — drawn for a line face, whose pupils cross most of an eye — put
 * every look in the eyes: a thinking look away was the iris parked in the
 * corner of the socket for two thirds of the state, which is side-eye, not
 * thought. Here the head carries about 60 % of a look and the eyes land a third
 * of the way off centre, where a real eye-head shift leaves them (Freedman &
 * Sparks; Pejsa & Andrist). The comment on each target is its world angle,
 * x right and y down.
 *
 *   vor        Real gain in the light is close to 1. A little under leaves the
 *              head some say, so a nod carries the eyes a touch with it rather
 *              than pinning them to the lens. Vertically it is well under
 *              (2026-09-15): her pitch is a shell tipping on a photograph and
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
 * neck sliding. TARA-SPECIFIC in its evidence only: a second Blender avatar
 * starts from 0.3 and checks its own outline at crop.
 */
export const TARA_TUNING = {
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
  //
  // TARA-SPECIFIC, and fork debt: on a driver of her own these are three
  // constants beside the research comment, not an option on a shared mixer.
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
    // TARA-SPECIFIC: a photographic face with a deeper lid crease may want
    // some of the knit back; judge it at crop against LISTENING.
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
    // drawn smile, and hers rests neutral. TARA-SPECIFIC: the squint morph's
    // cheek push is what darkens, so a face built without one might keep a
    // little squint — check the band under the eye at crop.
    //
    // The lean is attentive-sized, not the shared 0.70. Until 2026-09-16 her
    // lean scaled the whole figure about mid-face (`BODY`), so 0.70 plus the
    // engage add was a 4.4% zoom arriving on torsoLean's 0.24 s tau: the
    // shoulders swelled and dropped in half a second, read by the owner as a
    // lurch nothing like a lean. 0.22 sits in the research's sustained band
    // (+0.15–0.25, research-biomechanics.md §6.3) and the ear and chin carry
    // the rest.
    //
    // The lean deforms the trunk now, which is exactly the condition the old
    // note here predicted might afford more. It is left at 0.22 on purpose: the
    // cut was made by eye at crop, and putting it back is the same kind of
    // judgement rather than a consequence of the field changing. TARA-SPECIFIC,
    // and the thing to re-judge first if she reads as under-committed.
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
    // corners. TARA-SPECIFIC, the same way as CANT_HEAR.
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
      // TARA-SPECIFIC: the depth that hoods is her lid crease's.
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
                  gaze: { value: THREE.Matrix3 }, deep: boolean) {
  const material = base.clone();
  // d(u)/dx and d(v)/dy of `head_mesh.eye_uvs`: the globe is half the atlas
  // wide, the right eye reads it mirrored, and glTF flips v.
  const socket = { value: new THREE.Vector2((0.5 * -side) / EYE_TILE, -1 / EYE_TILE) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGaze = gaze;
    shader.uniforms.uSocket = socket;
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
      .replace("#include <uv_pars_fragment>", "#include <uv_pars_fragment>\nvarying vec2 vSocketUv;")
      .replace("#include <map_fragment>",
        "vec3 socket = 2.0 * texture2D( map, vSocketUv ).rgb;\n#include <map_fragment>\ndiffuseColor.rgb *= socket;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= socket;");
  };
  material.customProgramCacheKey = () => (deep ? "tara-eye-socket-deep" : "tara-eye-socket");
  return material;
}

/** `cavityShade`'s two measured heights, in the cavity patch's own normalised
 * rest height — 0 at the bottom of its bounding box, 1 at the top, morph deltas
 * included, because `computeBoundingBox` counts them and the shader normalises
 * by that same call.
 *
 * Both were read off a ruler build that painted the normalised height into the
 * emissive term, where the output bypasses the lamps and decodes straight back
 * to the height that produced it. It found two things worth keeping.
 *
 * `seam` is the height a *closed* mouth shows: pixel-weighted 0.805 on tara and
 * 0.808 on tushar, near enough identical to be one constant rather than a
 * per-character tuning. It is deliberately the pivot — see `cavityShade`.
 *
 * `falloff` is sized against the band an *open* mouth exposes, and that band is
 * why this is measured rather than guessed: it is 0.70..0.89, the top fifth of
 * the patch, with nothing below it even at jaw 1 and mouthOpen 1 — the patch
 * runs far past the aperture on purpose, so that its lower edge can chase the
 * lip without ever reaching the chin (`build_tara`, the cavity's lower edge). A
 * ramp laid across the whole patch would put a fifth of its range in the only
 * part anyone sees, which is the mistake the lower arch's `floor` made one
 * commit ago by being sized against its tile instead of its visible band.
 *
 * At 8 the multiplier runs 0.51 at the top of that band to 2.32 at the bottom.
 * Neither clamp engages anywhere the aperture reaches; they are there so that a
 * future morph exposing more of the patch cannot blow the exponential up.
 */
const CAVITY_SHADE = { seam: 0.805, falloff: 8, min: 0.35, max: 2.6 };

/**
 * The inside of the mouth, shaded by how far the light has to reach into it.
 *
 * Both video reviewers called the open mouth "a dark void", and a luminance
 * profile says why in one number: through viseme D's aperture the cavity
 * renders ten consecutive rows inside a single level of 255 — 49.6 down to 48.7
 * on tara, 49.3 to 48.6 on tushar — between an upper arch at 232 and a lower
 * one at 163. Every other band in that column moves tens of levels per row. The
 * complaint is not that the interior is too dark, then. It is that it is the
 * one surface on this face with no variation in it at all, and a
 * constant-valued region reads as a hole cut in the head rather than as a space
 * behind it.
 *
 * It is flat because it is the only mouth surface that is genuinely *lit*.
 * `build_tara.flat_material` gives it no emissive term, where the teeth beside
 * it carry `emissiveFactor` 0.75 and their photograph's own light with it — so
 * all of the cavity comes from the lamps, and those are 0.62π of ambient
 * against a patch whose normal barely turns. Ambient on a constant normal is a
 * constant.
 *
 * This is authored rather than sampled, which is the wrong way round for this
 * repo and worth saying why: the reference is a *smile*, and a smile shows no
 * interior — the same fact that left the lower arch with no enamel to copy.
 * There is no photograph of this mouth's inside to project, so the choice is an
 * authored gradient or the flat colour, and it is kept modest for it.
 *
 * Authored rather than derived, too. The true form factor from a flat backdrop
 * to the aperture in front of it is *brightest at the centre*, which is exactly
 * backwards: a real mouth is darkest in the middle because it is a tunnel
 * there, and this one is a curtain — `build_tara` parks it in front of the
 * teeth so a closed mouth has something dark to show, and walks it back past
 * them as the jaw drops. So this shades the mouth it stands for, not the
 * geometry it is drawn on.
 *
 * The pivot is what makes that safe. `CAVITY_SHADE.seam` is the height the
 * closed mouth shows, so the multiplier is 1.0 there by construction and the
 * rest pose barely moves: measured over the whole mouth region, at most 4
 * levels of 255 on tara and 3 on tushar. Not nothing, and not worth claiming as
 * nothing — but it matters that it is small, because "a closed mouth is a dark
 * line" is this surface's first job, and `landmarks.PALETTE.cavity` is the
 * colour of that line and stays the authority on it.
 *
 * Opening the mouth reveals the rest: darker above the seam, lighter below it.
 * Where those two halves actually land is not symmetric and not the same on the
 * two characters, because what hides the cavity is the upper arch, and the
 * arches differ. Down the middle of tara's mouth the arch reaches to roughly
 * the seam, so the centre gets the lighter half nearly alone — the ten flat
 * rows above become 50 at the top of the aperture rising to 83 at its bottom,
 * which is the floor the aperture faces. The darker half surfaces instead in
 * two lobes flanking the arch, where the aperture runs wider than the teeth do
 * and so exposes cavity above the seam: −4 levels on tara, −5 on tushar. Those
 * lobes are the commissures, and their being the deepest part of the mouth is
 * right for a reason this shader did not plan — it falls out of a vertical ramp
 * meeting a curved arch.
 *
 * tushar gets the darker half down the centre as well, 49.3 to 43.6, because
 * his teeth are narrower — `TEETH.half_width` 0.110 against tara's 0.132 — so
 * his aperture exposes cavity above the seam in the middle too. One constant,
 * two characters, two different-looking mouths, and the difference between them
 * is the arch's width showing through. That is the argument for the constant
 * staying shared rather than being tuned per character: it is already reading a
 * per-character fact, just not one of its own.
 */
function cavityShade(base: THREE.MeshStandardMaterial, lo: number, hi: number) {
  const material = base.clone();
  const span = { value: new THREE.Vector2(lo, (hi - lo) || 1) };
  const shade = {
    value: new THREE.Vector4(CAVITY_SHADE.seam, CAVITY_SHADE.falloff,
                             CAVITY_SHADE.min, CAVITY_SHADE.max),
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCavitySpan = span;
    shader.uniforms.uCavityShade = shade;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        "#include <common>\nvarying float vCavityAt;\nuniform vec2 uCavitySpan;")
      // `position`, not `transformed`: `morphs.cavity_targets` translates this
      // patch back and drops its lower edge as the jaw opens, and this shading
      // is painted *on* the surface — so it has to ride that, not be swept
      // across it. The raw attribute is the rest frame, before the morphs.
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\nvCavityAt = (position.y - uCavitySpan.x) / uCavitySpan.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying float vCavityAt;\nuniform vec4 uCavityShade;")
      // No `emissivemap_fragment` half, unlike `jawShadow` and `socketed`:
      // those modulate surfaces that emit 75% of a photograph verbatim, and
      // this one has no emissive term at all. The diffuse is the whole output.
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n"
        + "float cavityK = exp(uCavityShade.y * (uCavityShade.x - vCavityAt));\n"
        + "diffuseColor.rgb *= clamp(cavityK, uCavityShade.z, uCavityShade.w);");
  };
  material.customProgramCacheKey = () => "tara-cavity-shade";
  return material;
}

/** `scripts/head_mesh.MOTION_DEPTH_ATTR`, as GLTFLoader names it: lowercased. */
const MOTION_DEPTH = "_motion_depth";

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
 * wears the expression maps, when the asset has them: the three shells are
 * exactly the ones textured from the face atlas the maps are registered to.
 */
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
  // `uGaze` is exactly the extra rotation to take back out. A rotation's inverse
  // is its transpose, and a vector multiplied from the left is the transpose
  // multiply, so this needs no second uniform and no `transpose()`.
  const depth = `vec3(0.0, 0.0, ${MOTION_DEPTH})`;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nattribute float ${MOTION_DEPTH};`)
    .replace("#include <project_vertex>",
      "#include <project_vertex>\n"
      + `mvPosition.xy += (modelViewMatrix * vec4(${undoGaze ? `${depth} * uGaze` : depth}, 0.0)).xy;\n`
      + "gl_Position = projectionMatrix * mvPosition;");
}

function motionDepth(base: THREE.MeshStandardMaterial, expression?: Expression) {
  const material = base.clone();
  material.onBeforeCompile = (shader) => {
    turnDeep(shader);
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
    (expression ? `tara-motion-depth-expression-${expression.names.length}` : "tara-motion-depth");
  return material;
}

/**
 * Expression maps: the light a smile or a raised brow changes, which the
 * geometry cannot.
 *
 * A pixel of this face is 75% photograph, emitted, and 25% lit (the lamps,
 * below), so the most a morph can change by moving skin is a quarter of its
 * shading — and the shading it moves is the neutral photograph's, which has no
 * nasolabial fold to deepen and no forehead line to show. A cheek morph
 * measured 0.00% of the tile changed. So an asset can carry, per expression, a
 * grey ratio taken from a photograph of the same face making it
 * (`scripts/expression_maps.py`): the fold's shadow, the cheek's lift into the
 * light, the lines of a raised brow, the two creases of a knit one. Here each
 * is raised to the power of its weight and multiplies the albedo's diffuse and
 * emitted halves alike, as the jaw's shadow does — so at weight 0 it is exactly
 * 1 and the face is the photograph, and at 1 it is the expression's light.
 *
 * Read at the texel's *rest* position, which is where the build registered it:
 * the morph that lifts the cheek carries the lifted cheek's light up with its
 * texture, so light and shape arrive together without the shader knowing
 * where anything went.
 *
 * Per side, because the channels are. The weights cross over at the midline
 * rather than switching there, so a one-sided smile does not cut its fold's
 * light off in a line down the philtrum.
 *
 * The maps are the one thing in the asset nothing draws: they ride on a
 * carrier mesh (`build_tara.py`, "Expression") that exists to get the texture
 * into the GLB, and is taken out of the scene on load. An asset without one is
 * a face whose light never changes, which is every asset built before these.
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
 * TARA-SPECIFIC: judged on tushar's maps at the 400 × 300 tile, the only ones
 * that exist.
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

/**
 * The neck, taught to wear the jaw's shadow where the jaw is.
 *
 * The photograph paints the shadow the chin casts on the throat, and a painted
 * shadow stays where it was painted: under a 9° turn the jaw crossed the top of
 * the neck by 8 px and its shadow did not move, which read as the neck sliding
 * out from under the head. So the
 * build lifts it out of the albedo into a ratio tile
 * (`project_albedo.lift_jaw_shadow`), and this puts it back from the head's
 * frame: each neck fragment finds the point of the *turned* head in front of it
 * — the view ray met with the plane the jaw's rim turns in — and reads the
 * ratio at that point's rest position. At rest that point is the fragment's
 * own, so the drawing is the photograph; under a turn the shadow's edge rides
 * the rim, whatever the neck's own follow is doing.
 *
 * The tile lives in the albedo atlas (`face_texture.JAW_SHADOW_AT`), the way
 * the eye's socket multiplier lives beside its globe, so it is one more read of
 * a texture already bound and no draw call. Its edges are white — no shadow —
 * and the lookup is clamped to it, so a ray that lands past the tile (the
 * throat's far side under a hard turn) reads "no shadow" rather than the hair
 * or the iris the atlas keeps beside it.
 */
function jawShadow(base: THREE.MeshStandardMaterial, uv: number[], extent: number[],
                   rimZ: number, headInverse: { value: THREE.Matrix4 }) {
  const material = base.clone();
  const tile = { value: new THREE.Vector4(uv[0], uv[1], uv[2], uv[3]) };
  const bounds = { value: new THREE.Vector4(extent[0], extent[1], extent[2], extent[3]) };
  const rim = { value: rimZ };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeadInverse = headInverse;
    shader.uniforms.uJawTile = tile;
    shader.uniforms.uJawBounds = bounds;
    shader.uniforms.uJawRim = rim;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vJawView;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvJawView = mvPosition.xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying vec3 vJawView;\nuniform mat4 uHeadInverse;\n"
        + "uniform vec4 uJawTile;\nuniform vec4 uJawBounds;\nuniform float uJawRim;")
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n"
        + "vec3 jawFrom = (uHeadInverse * vec4(vJawView, 1.0)).xyz;\n"
        + "vec3 jawRay = (uHeadInverse * vec4(0.0, 0.0, 1.0, 0.0)).xyz;\n"
        + "vec2 jawAt = jawFrom.xy + jawRay.xy * ((uJawRim - jawFrom.z) / jawRay.z);\n"
        + "jawAt = clamp(jawAt, uJawBounds.xz, uJawBounds.yw);\n"
        + "vec3 jawShadow = texture2D(map, uJawTile.xz + uJawTile.yw * jawAt).rgb;\n"
        + "diffuseColor.rgb *= jawShadow;")
      .replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= jawShadow;");
  };
  material.customProgramCacheKey = () => "tara-jaw-shadow";
  return material;
}

/** Lamps, standing in for the four area lights `build_tara.setup_scene` uses.
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
 * `setAnimationLoop` is `requestAnimationFrame`, so uncapped this face is drawn
 * as fast as the viewer's hardware refreshes — 60 on most panels, 120 on a
 * ProMotion Mac or a current flagship phone. That is the wrong way round: the
 * device most likely to care about the battery is the one that would draw the
 * most, and it buys nothing, because idle motion here is deliberately held
 * under ~1.5 Hz (CLAUDE.md) and the head's travel is a few degrees, slowly, in
 * a 400 × 300 tile. 30 samples that twenty times a cycle. Character animation
 * ships lipsync at 24 for a living.
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

export interface TaraRigOptions {
  /** Called once the GLB is in the scene, for a capture tool that must wait. */
  readonly onReady?: () => void;
  /** The character's GLB, when it is not tara. The second-character seam: every
   *  build fact the rig reads (jaw-shadow tile, rim depth, morph names) travels
   *  in the GLB's own extras, so a character built by the same scripts needs
   *  nothing else. Tara's tuning is still applied, which is the experiment. */
  readonly url?: string;
  /** `false` leaves an asset's expression maps unread, for a capture tool
   *  comparing the face with and without them. */
  readonly expression?: boolean;
}

const radians = (deg: number) => (deg * Math.PI) / 180;

/** The renderer, or `null` where the browser will not give a context.
 *
 * Three.js throws out of the constructor rather than returning anything, and it
 * has already written its own line to the console by then; that line is kept
 * because it names the underlying reason, which this one does not. */
function webglRenderer(): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
}

/**
 * Where a lid channel's influence reaches a shut eye. Not at 1, because the
 * mixer never asks for 1: a blink is a 0.11–0.15 s triangle, the lid channel's
 * 18 ms smoothing rounds its peak off, and this rig draws at 30 fps, so the
 * frame a viewer actually sees peaks at influence 0.74 on the median blink and
 * 0.66 at the fifth percentile. A lid morph that shut only at 1 left every
 * blink a quarter open — the lid came down and the iris was still there.
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

const LID_KNEE = 0.35;
const LID_SHUT = 0.66;

/**
 * A squint's influence rises faster than its channel. The mixer's values are
 * set where a line face's lower lid reads — a smile's squint is 0.30 — and a
 * photographic lower lid rising 0.30 of its travel is a pixel or two, so the
 * squint that makes a smile real was not there. A power curve lifts the small
 * values into sight. The lower-lid follow, which runs this target backwards,
 * is added after it and stays linear.
 *
 * TARA-SPECIFIC. The curve needs a ceiling as well as a lift, because the
 * squint stacks and the mouth does not. A *silent* smile takes squint from
 * three layers at once — an approval clip, the encouraging emotion and
 * prosody's warmth — which reach 0.51 together, while the smile map saturates
 * at a mouth corner of 0.8 and no layer drives the jaw, so the last third of a
 * smile arrives as narrowing eyes over lips that cannot part any further. On a
 * line face that reads as warmth. On a photograph it reads as sedation: a
 * reviewer watching a recorded call read those two moments as the avatar
 * falling asleep or heavily medicated, and named the eyes, not the mouth. The
 * ceiling is where the face stops reading drugged, judged at crop. The knee is
 * low enough that an ordinary one-layer smile is untouched (0.22 renders
 * 0.402, against 0.403 with no ceiling at all), and the approach is
 * exponential rather than a clamp so the slope is continuous where the two
 * meet and the lower lid never visibly sticks.
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
 * A channel's morph influence. One line — and the lid and squint curves above — and the
 * same one `scripts/morphs.py:influence` uses, so a Blender preview and the
 * browser pose the face identically.
 *
 * It is allowed to go negative, which is what lets one target serve a
 * bidirectional channel: `mouthCornerL` at −1.4 is the smile target run
 * backwards into a frown, and `lidL` below its 0.12 rest opens the eye wider
 * than neutral. A rig that clamped this at 0 would silently delete the negative
 * half of six channels.
 */
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
 * These fields carry no angle, so `HEAD_DEG` below is a runtime number that can
 * move without leaving `tara.glb` stale. Yaw's pair is a partial twist rather
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
 * the pose alone.
 *
 * A hank that hangs past the jaw is lying on a shoulder, and a shoulder does not
 * tilt when the head does. Rolled rigidly with the skull it lifts off the collar
 * and the page shows through behind it, so the shell gives up `hold` of the
 * roll at its lowest rows and none at the crown, graded by `morphs.hair_hold`.
 * That is the static half and it is what fixes the gap.
 *
 * The other half is why roll read as a hinge at all. A rigid rotation about a
 * fixed point is a hinge — there is nothing else in it — and what a real head
 * tilt has that this lacked is hair that arrives late and settles. Live2D gives
 * every hank a spring for exactly this (`docs/research-head-rotation.md` § 3.1:
 * mobility ~0.95, delay 0.8-0.9, one clear overshoot), so this is a spring on
 * the hair's own angle chasing the share of the roll it agrees to take.
 *
 * It is on the hair and not on the head's channels on purpose. The mixer's
 * per-channel time constants are shared with the SVG faces and every clip in the
 * library is authored pre-compensated for them, so a spring on `headRoll` would
 * silently re-time every nod ever authored. Secondary motion on a shell that
 * only this renderer has costs nothing outside it.
 *
 * 1.5 Hz is the band the library already keeps gesture under, and a hank of hair
 * on a real head swings near it (a 7 cm pendulum is 1.9 Hz); the damping is a
 * single visible overshoot, settling inside 0.8 s. Faster reads as a flick and
 * slower as wet hair.
 */
/**
 * `hold` is the share of the head's roll the hanging hair declines to take, and
 * `hz`/`damping` are how it gets there. 1.5 Hz is the ceiling the repo's idle
 * constraint sets on *driven* oscillation; a settle is a one-shot and could
 * defensibly go faster, but there is no reason to spend the exemption: what
 * unhinges the roll is the hair arriving late, not the ring. At 0.65 it trails
 * by 93% of its travel a frame in, overshoots 5% and is inside 5% of the hold in
 * 450 ms — well within a phrase's hold.
 */
export const HAIR_ROLL = { hold: 0.85, hz: 1.5, damping: 0.65 };

/**
 * One step of `HAIR_ROLL`'s spring: semi-implicit, the rate taking the frame's
 * acceleration before the angle takes the rate. Explicit Euler rings at this
 * stiffness and 30 fps; this does not, which is the only reason the order of
 * those two lines is worth a sentence.
 *
 * Exported for `test/nods.test.ts`, because settle time and overshoot are
 * numbers and not something a still frame can show. It is not part of the
 * package's surface — `packages/avatar/client/tara.ts` is.
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

const influence = (channel: string, value: number): number => {
  const rest = (REST as Record<string, number>)[channel] ?? 0;
  const i = (value - rest) / (1 - rest);
  if (channel === "lidL" || channel === "lidR") return lidClosure(i);
  return channel === "squintL" || channel === "squintR" ? squintCurve(i) : i;
};

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

// `options` is `unknown` in the contract, and stays `unknown` here: the mixer
// passes `rigOptions` through verbatim and has no way to know any rig's shape.
export function createTaraRig(mount: HTMLElement, options?: unknown): AvatarRig {
  const { onReady, url = ASSETS.tara, expression: readExpression = true } =
    (options ?? {}) as TaraRigOptions;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, FRAME_CENTRE, 6);
  camera.lookAt(0, FRAME_CENTRE, 0);

  const renderer = webglRenderer();
  // No context, no face — and that has to be the whole of it. `createAvatar` is
  // synchronous and returns `{ destroy }`, so a consumer has nothing to catch:
  // anything thrown here lands in *their* window and takes the call page with
  // it, over a browser condition that is nobody's defect. WebGL is unavailable
  // more often than it looks — a driver on a blocklist, a hardened profile, a
  // remote desktop — and the right outcome is a call that still has audio,
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
  //
  // There were three. The outermost was `figure`, and it existed only to scale
  // the whole character for `torsoLean`; with the camera a sibling rather than
  // a child, that was a zoom and not a lean. The trunk deforms on the shell now
  // (`morphs.torso_targets`), so the group has no work left and is gone rather
  // than left behind as an identity transform for someone to wonder about.
  const trunk = new THREE.Group();
  const lift = new THREE.Group();
  const head = new THREE.Group();
  head.position.copy(PIVOT);
  // Yaw and pitch turn `head`; roll turns `tilt`, which rides inside them at
  // the chin (ROLL_PIVOT), so the parts hang from `tilt`.
  const tilt = new THREE.Group();
  tilt.position.subVectors(ROLL_PIVOT, PIVOT);
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
  const turn = new THREE.Matrix4();
  let expression: Expression | null = null;
  // The `Hair` shell, on a character whose hair hangs low enough to have the
  // roll pair; null on one whose hair stops beside the temple (`HAIR_ROLL`).
  let hairMesh: THREE.Mesh | null = null;
  // The head's roll in the asset's own frame — what both the neck's follow and
  // the hair's are authored about — and the hair's own, which chases it.
  let headRollRad = 0;
  let hairRollRad = 0;
  let hairRate = 0;
  let hairSeeded = false;

  /** The share of the head's roll the hair settles at. */
  const hairTarget = () => headRollRad * (1 - HAIR_ROLL.hold);

  const writeHair = () => {
    const dictionary = hairMesh?.morphTargetDictionary;
    const influences = hairMesh?.morphTargetInfluences;
    if (!dictionary || !influences) return;
    const extra = hairRollRad - headRollRad;
    for (const [channel, index] of Object.entries(dictionary)) {
      const term = hairInfluence(channel, extra);
      if (term !== null) influences[index] = term;
    }
  };

  const stepHair = (dt: number) => {
    if (!hairMesh || !hairSeeded) return;
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
    // height. Offsetting the frustum by that centre as well applies it twice:
    // the face rendered 0.47 face heights low, at exactly the right size, which
    // reads as a framing choice rather than as the arithmetic error it was.
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

  const applyPose = (pose: RigPose) => {
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
      const hair = mesh === hairMesh;
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
        // scaled by the influence law. Only on the neck: the same three channel
        // names on the head group are a rigid transform, and nowhere else.
        if (neck) {
          const term = neckInfluence(channel, pose);
          if (term !== null) { influences[index] = term; continue; }
        }
        const value = pose[channel];
        const follow = channel.startsWith("squint") ? LOWER_LID_FOLLOW * Math.max(pose.pupilY ?? 0, 0) : 0;
        if (value === undefined && !follow) continue;
        influences[index] = (value === undefined ? 0 : influence(channel, value)) - follow;
      }
    }
    // Blender's Z is face-space v, so its yaw is about Z, its pitch about X and
    // its roll about Y. The export maps Blender (x, y, z) to glTF (x, z, −y),
    // so Blender +Z *is* glTF +Y and Blender +X is glTF +X: yaw and pitch carry
    // across with their sign intact. Only roll changes sign, because Blender +Y
    // is glTF −Z, and that is a statement about two axes and not about the
    // channel.
    //
    // Yaw was negated here as well until 2026-09-10, on the belief that the
    // export flips the handedness of a turn. It does not — both frames are
    // right-handed — and the cost was a head that turned toward the viewer's
    // *left* on a positive `headYaw`, against `params.js`'s stated sign. It
    // survived because the same negation was in `build_tara.pose_head`, so the
    // Blender preview and the browser agreed with each other and only disagreed
    // with the library. `gaze.js` is what makes it a defect rather than a
    // convention: it hands `pupilX` and `headYaw` the same aversion term, so
    // tara's eyes went one way and her head went the other.
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
    if (expression) {
      expressionWeights(pose, "L", expression, expression.left);
      expressionWeights(pose, "R", expression, expression.right);
    }
  };

  new GLTFLoader().load(url, (gltf) => {
    if (destroyed) return;
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
      if (mesh.isMesh && mesh.name === "Hair" && mesh.morphTargetDictionary) hairMesh = mesh;
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
    for (const name of HEAD_PARTS) {
      const part = gltf.scene.getObjectByName(name);
      // Reparenting moves the object into the tilt's frame, whose origin is
      // ROLL_PIVOT, so subtract that to leave the part where it was authored.
      // `attach()` would do this from the world matrix, which has not been
      // computed yet at load.
      if (part) {
        part.position.sub(ROLL_PIVOT);
        tilt.add(part);
      }
    }
    // One clone per source material, shared by every shell that carries the
    // field; a mesh without it keeps the material it came with.
    const turned = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    head.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute(MOTION_DEPTH)) return;
      const base = mesh.material as THREE.MeshStandardMaterial;
      const own = turned.get(base) ?? motionDepth(base, expression ?? undefined);
      turned.set(base, own);
      mesh.material = own;
    });
    // The neck rides the breath with the head; the torso *is* the breath. Both
    // are authored in world space with identity nodes, and `lift` sits at the
    // origin until a pose arrives, so moving the neck needs no correction.
    const neck = gltf.scene.getObjectByName("Neck") as THREE.Mesh | undefined;
    if (neck) lift.add(neck);
    // The shadow's map comes from the build (`build_tara.py`, the neck); an
    // asset without it keeps the shadow painted on, as every build did before.
    const skull = head.getObjectByName("Head");
    const { jaw_shadow_uv: jawUv, jaw_shadow_extent: jawExtent, jaw_shadow_rim_z: jawRim } =
      neck?.userData ?? {};
    if (neck && skull && Array.isArray(jawUv) && Array.isArray(jawExtent) && typeof jawRim === "number") {
      const headInverse = { value: new THREE.Matrix4() };
      neck.material = jawShadow(neck.material as THREE.MeshStandardMaterial, jawUv, jawExtent,
                                jawRim, headInverse);
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
                               mesh.geometry.getAttribute(MOTION_DEPTH) !== undefined);
      eyes.push(globe);
    }
    // The mouth's inside, which is otherwise the one flat-lit surface on this
    // face. Found by *mesh* name rather than material name: `flat_material`
    // hard-codes a `tara_` prefix, so tushar's cavity material is called
    // `tara_cavity` as well, and the mesh is what distinguishes it.
    const cavity = head.getObjectByName("Cavity") as THREE.Mesh | undefined;
    if (cavity) {
      cavity.geometry.computeBoundingBox();
      const box = cavity.geometry.boundingBox;
      if (box) {
        cavity.material = cavityShade(cavity.material as THREE.MeshStandardMaterial,
                                      box.min.y, box.max.y);
      }
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

  // The tolerance is not a fudge factor, it is the whole of what makes the cap
  // land on 30. rAF fires on the panel's own grid, so the elapsed time is only
  // ever a multiple of the refresh interval and lands *near* 33.3 ms rather than
  // on it: 33.33 on a 60 Hz panel, and either side of it under any timestamp
  // jitter. A bare `elapsed < MIN_FRAME_MS` therefore rejects the frame it wants
  // and waits for the next one — 50 ms, i.e. 20 fps, not 30. Four milliseconds
  // is under half the interval of every rate worth caring about (8.3 at 120,
  // 11.1 at 90, 16.7 at 60), so it can never admit two frames where one belongs,
  // and it puts 60, 90 and 120 Hz all on 30 fps.
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
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
