// ---------------------------------------------------------------------------
// avatars/round/face.mjs — this character, as a PURE function of a control
// vector. No filesystem, no poses, no serialiser: the parameters, the persona
// and its palette, the landmark solve, the shape tables, the kit and
// `buildDraws(c, K)`, which is the whole of what round LOOKS like.
//
// It split off `build.mjs` for one reason: `src/live.js` evaluates this file in
// the BROWSER, once per frame, to draw the face from voqalize's 30 channels
// directly — the linearity spike's option (d), because the mouth's channel
// coupling is far too strong for baked poses to reconstruct (a 6 px @1x worst
// vertex and seven alpha ramps categorically wrong; see NOTES.md). So nothing
// in this file, or in anything it imports, may touch a `node:` builtin — which
// is why `writeRig` moved out of `author/rig.mjs` into `author/finish.mjs`.
// `build.mjs` imports this and adds everything that is authoring: the pose
// harness, the tracks, the camera's metadata, the wardrobe, the writer.
//
// The split is a MOVE and nothing else. Every one of the five round rigs is
// byte-identical across it.
// ---------------------------------------------------------------------------

import { spline, polygon, sampleRun, inward, circle, band } from '../../author/path.mjs';
import {
  clamp, lerp, hsl,
  paintRegistry, makeCtrl, applyWeights, solveIrisBase, REST_CONTROLS, drawPusher,
} from '../../author/rig.mjs';
import { makeMouth, mouthRestChannels } from '../../author/parts/mouth.mjs';
import { makeEye, eyeChannelRest, eyeSide, BROW_PX, EYE_TABLE } from '../../author/parts/eye.mjs';
import { makeNose } from '../../author/parts/nose.mjs';
import { makeSkinDetail } from '../../author/parts/skin-detail.mjs';
import { makeHand, handRest, handFrameOf } from '../../author/parts/hand.mjs';
import { viewBoxForHead } from '../../../camera.js';

// ===========================================================================
// 1. PARAMETERS — the whole character's proportions live here.
// ===========================================================================

export const P = {
  artboard: { w: 1080, h: 1625 },
  cx: 540,

  // Round/heart head: y 246..890 (644 tall), widest at the cheeks (±296 -> 592
  // across) for a w:h of 0.92, narrowing to a soft chin ~38% of the cheek
  // width. The opposite of facet's square jaw and rounder than the mascot's
  // oval.
  headTop: 246,
  chinY: 890,

  // Adult proportions (2026-08): the eye line sits at half the head, the eye
  // is ~21% of the face width and the lid opening is squarer, per the
  // late-twenties reference bust in parts/ref/portrait. The skull itself
  // (headTop/chinY) is untouched so the fringe and the hair plates still fit.
  browY: 525,       // brow centreline, mean of bwI/bwM/bwO
  eyeY: 578,        // eye centreline, 53% of head height (was 606 / 56%)
  noseBaseY: 694,
  mouthY: 768,

  eyeGapHalf: 74,   // half the inter-canthal gap (1.12 eye-widths apart)
  eyeHalfW: 66,     // 20.7% of the cheek width; the reference reads 21-22%
  eyeTopH: 34,
  eyeBotH: 30,      // opening h:w 0.48 — an adult lid, not a cute circle
  // Iris 0.52 of the eye opening's width — the canon is 0.55-0.65 and a cute
  // style pushes higher still, but the adult eye is narrower, so the iris
  // comes down with it rather than crowding the lids.
  irisR: 34,
  pupilR: 13,      // 0.38 of the iris diameter: mid dilation

  mouthHalfW: 100,
  lipUpTh: 15,
  lipLowTh: 24,
  restLipGap: 2,

  jawDrop: 34,      // how far the chin travels at jaw = 1

  scale: 1.0,               // whole-figure zoom, anchored at the crown
  shadowInset: 9,           // how far the side plane sits inside the silhouette
  neckPivot: [540, 1180],   // head rotates about the base of the neck
};

// Flat-vector shading is planes, not a ramp: five skin values exist and only
// three of them are large areas (face, side plane, neck).
const RAMP = 5;

// ===========================================================================
// 2. COLOUR — THE PERSONA
//
//    A persona is everything this face is made of that is not geometry: a skin
//    tone, an iris, a pair of lips, a brow. It arrives as a plain blob with
//    every key optional, and `makeSpec(persona)` (§10) turns one into a whole
//    spec — so a variant of this character is a PALETTE plus a wardrobe
//    sidecar, and the sidecar carries both: `author/finish.mjs` hands the
//    sidecar's `persona` block straight to the factory without looking inside
//    it. Nothing in the library knows what `skin` means, and nothing here
//    knows what a blazer is.
//
//    The vocabulary is ../ink's, key for key, wherever the two styles mean the
//    same thing — `skin`, `lips.{up,low}`, `iris.{hue,saturation,brightness,
//    sat,light,eye}`, `brow.{weight,colour}`, `lash.{weight}`. `blush` is the
//    one key that is this style's alone, because the rouge is this style's
//    alone. NOTES.md keeps the shared / round-only split, and the argument for
//    not lifting any of it into the library yet.
//
//      skin: [h, s, l]     the LIT plane — the TOP rung of the five-plane
//                          ramp, and the only skin number there is.
//      lips: { up, low }   [h, s, l] each; the seam and the corner pockets are
//                          derived off `up`, the two highlights are white and
//                          are not.
//      iris: { hue, saturation, brightness,  the driver dial this face boots on
//              sat, light,                   the 39-rung ladder's s and l
//              eye }                         [r,g,b] on screen AT that dial
//      brow: { weight, colour }   thickness about the brow's own centre line,
//                                 and the tone the lash is derived from
//      lash: { weight }           the upper lash's mass and the lower ticks
//      eye: { aperture }           vertical opening only; 1 is the family
//                                 geometry, below 1 narrows without changing
//                                 the adult eye-width ratio
//             { refine }            optional brow and upper-lid finishing;
//                                 construction-only, never a driver channel
//      mouth: { philtrum }          optional quiet neutral-mouth plane
//      blush: number              how much of the cheek rouge survives — 1 is
//                                 the generator's own, 0 turns it off
//      sex: 'f' | 'm'             which rest geometry the rig is BUILT at and
//                                 which paint conventions apply (§3, SEX_GEO)
//      geo: { channel: n }        per-channel override of that rest patch
//
//    Every default below is the number this file has always written, so
//    `makeSpec()` — no persona — rebuilds `data/round.rig.json` byte for byte.
// ===========================================================================

export const DEFAULT_PERSONA = {
  // 'f' or 'm' — see SEX_GEO / sexPaint below §3. The default is the look this
  // face has always had, so `makeSpec()` with no persona is unchanged.
  sex: 'f',
  // A light warm peach: the top of the ramp, rgb(224,201,184) — clearly
  // lighter and pinker than the mascot's rgb(208,150,125) and nowhere near
  // facet's olive rgb(178,113,79). It used to be rung 4 of a hard-coded
  // `skin(i)`; the rung is now the parameter and the ramp is derived from it.
  skin: [26, 0.40, 0.80],
  // Upper lip 12% darker in L than the lower: it tilts away from the light and
  // carries more pigment, and the delta is what stops a two-shape mouth reading
  // as one flat sticker.
  // Toned down for the adult read (2026-08): 0.42/0.45 was a made-up mouth on
  // a young face. 0.30/0.32 is still a lip and not a lipstick.
  lips: { up: [358, 0.30, 0.56], low: [2, 0.32, 0.64] },
  // hue/saturation/brightness are the driver's own boot state (src/vocab.js,
  // DRIVER_DEFAULTS) — the dial this face wants to be found at, written to
  // `meta.iris` for a player to start on. sat/light are the LADDER's, i.e.
  // what the eye does as somebody drags that dial: the whole excursion across
  // the 39 rungs is `ladder(h) - ladder(hue)`, so a dark ladder is what keeps
  // a dark eye dark at every hue and a bright one cannot be made to.
  // `eye` is the warm hazel this face has always rested on.
  iris: { hue: 200, saturation: 0.15, brightness: 0.5, sat: 0.45, light: 0.42, eye: [138, 105, 72] },
  brow: { weight: 1, colour: [14, 0.44, 0.27] },
  lash: { weight: 1 },
  // Half the rouge the cute face wore. A professional in her late twenties has
  // cheeks, not a doll's blush spots.
  blush: 0.5,
};

// Auburn bob: three values, back / front / highlight.
const hair = (i) => hsl(lerp(12, 26, i / 2), 0.50 - 0.04 * i, 0.20 + 0.07 * i);
// Muted sage top, two values.
const shirt = (i) => hsl(lerp(148, 154, i), 0.22 - 0.02 * i, 0.33 + 0.07 * i);

// The tone every offset below was authored against. Hue and saturation travel
// as OFFSETS off the persona's skin; lightness travels as a RATIO of it, which
// is this file's whole answer to the ink lesson (../ink/NOTES.md): a step in
// lightness that is a constant is most of the light a deep brown has left, so
// the jaw plane turns into a hole. A ratio scales itself, and — because the
// side plane here is a translucent overlay rather than an opaque tone — it is
// also what keeps `alpha * (shade - face)` proportional to the face, i.e. the
// plane darkens the same FRACTION on every skin instead of vanishing on the
// dark ones.
const L_REF = DEFAULT_PERSONA.skin[2];

// ---------------------------------------------------------------------------
// The palette, from a persona.
//
// DERIVED FROM `skin`:
//   * the five-plane ramp itself — `face` (rung 4, the persona's own tone),
//     `ear` 3.5, `earR` / `neck` 3.0, `nose` 2.9, `earIn` 2.7, `earInR` 2.4.
//     Hue walks 22 degrees redder down the ramp and saturation peaks in the
//     middle of it, both exactly as before; the LIGHTNESS of every rung is a
//     RATIO of the persona's, so rung 3.0 is 89% of the lit plane on a peach
//     and 89% of it on a deep brown, and the neck reads as the same lighting
//     on both instead of as a hole on the second.
//   * `shade` / `neckSh`, the translucent side plane and the chin's cast
//     shadow — a much darker, more saturated version of the same skin
//     (hue -16, sat +0.15, lightness x 0.425), which at the default is exactly
//     the hsl(10, 0.55, 0.34) this file has always written.
//   * `crease` and `water`, both skin marks and therefore both wrong the
//     moment they are constants: a 0.55-lightness crease on a 0.50-lightness
//     skin is a LIGHT line above the eye.
//   * `carun`, the tear duct, and `blush`, the cheek — the same skin pushed
//     pink; `blush`'s alpha is then scaled by `persona.blush`.
// DERIVED FROM `lips.up`: `seam` and `commiss`, the lip line and the corner
//   pockets — the upper lip at 45% / 52% of its lightness. A lip seam is the
//   shadow between the lips, so it has to follow the lips and not the style.
// DERIVED FROM `brow.colour`: `brow`, `browR` (the shadow-side brow, 0.05
//   darker) and `lash` — one hair colour for everything above the eye.
// NOT DERIVED, deliberately:
//   * `sclera`, `scleraShade`, `pupil`, `teeth`, `mouthIn`, `tongue` — an eye
//     white and an enamel are MATERIALS, the same on everybody; what has to be
//     checked on a dark skin is their contrast, not their value.
//   * every translucent overlay whose job is light rather than pigment —
//     `eyeShade`, `limbal`, `irisGlow`, `catch`, `catch2`, `lipHi`, `lipBow`,
//     `toothSep`, `toothSh`, `hairHi`. author/README.md's overlay convention:
//     an overlay is an ink or a white AT AN ALPHA, never a colour derived from
//     what it sits on, because the thing underneath is repainted 39 times by
//     the hue ladder.
//   * `hairBack` / `hairFront` / `shirt` / `collar` — the bald rig's own
//     character, and every persona variant covers all four with a bitmap.
// ---------------------------------------------------------------------------

function makePalette(p) {
  const [H, S, L] = p.skin;

  // Skin: five planes off one tone. Hue walks 22 degrees redder down the ramp
  // and saturation peaks in the middle of it, both exactly as before; the
  // LIGHTNESS is a ratio of the persona's, which is the whole of the ink
  // lesson (../ink/NOTES.md) and is why `lerp(0.46, 0.80, t)` is still written
  // out — those are the five rungs of the tone this ramp was tuned at, and
  // every other skin gets them as a proportion. A flat -0.085 of lightness for
  // the neck is 11% of a pale peach and 16% of a deep brown, and the 5% is
  // exactly the difference between "the light is off it" and "it is a
  // different material". The saturation bump travels with it for the mirror
  // reason: +0.10 keeps a PALE plane from going grey, and a deep brown has no
  // such problem — at l = 0.46 it just makes an orange. At the default skin
  // both scalings are 1.0 and the five rungs are the old numbers to the digit.
  const skin = (i) => {
    const t = clamp(i, 0, RAMP - 1) / (RAMP - 1);
    return hsl(lerp(H - 22, H, t),
      S + 0.10 * (L / L_REF) * Math.sin(Math.PI * t),
      L / L_REF * lerp(0.46, 0.80, t));
  };
  // A tone authored against the default skin, re-expressed as a relationship.
  const off = (dh, ds, l) => hsl(H + dh, S + ds, L / L_REF * l);

  // The side plane and the chin's cast shadow are translucent warm brown rather
  // than opaque skin values. Opaque planes force every shape underneath to know
  // which plane it sits on — the shadow-side eyelid has to be painted in the
  // shadow tone, and it then shows as a patch the moment the plane's boundary
  // moves. A translucent plane painted last tints whatever is under it and that
  // whole class of bug disappears.
  const SHADE = (a) => [...off(-16, 0.15, 0.34).slice(0, 3), a];

  const [uh, us, ul] = p.lips.up;
  const UL_REF = DEFAULT_PERSONA.lips.up[2];
  const lip = (dh, ds, l) => hsl(uh + dh, us + ds, ul / UL_REF * l);
  const [wh, ws, wl] = p.brow.colour;

  return {
    face: skin(4),
    shade: SHADE(0.17),       // the one side plane
    ear: skin(3.5),
    earR: skin(3.0),
    earIn: skin(2.7),
    earInR: skin(2.4),
    neck: skin(3.0),
    neckSh: SHADE(0.15),
    nose: skin(2.9),
    noseBridge: off(-17, 0.08, 0.34),
    noseUnder: off(-19, 0.10, 0.25),
    noseAlar: off(-22, 0.10, 0.18),
    skinFleck: off(-13, 0.13, 0.53),
    skinMole: off(-21, 0.15, 0.31),
    hairBack: hair(0),
    hairFront: hair(1),
    // The fringe highlight was an opaque lozenge; at the webcam crop that read as
    // a decal stuck on the hair. Translucent, it becomes a sheen.
    hairHi: [...hair(1.9).slice(0, 3), 0.50],
    shirt: shirt(1),
    collar: shirt(0),
    // The rouge, at whatever fraction of itself the persona asks for. It is a
    // knob rather than a colour because the thing a persona changes about a
    // blush is almost never its hue: 0.20 alpha on a woman's cheek is the
    // style, and the same 0.20 on a man's reads as make-up at 1x.
    blush: [...off(-20, 0.22, 0.70).slice(0, 3), 0.20 * p.blush],

    // --- the eye stack, back to front ---------------------------------------
    // The two scleras differ by less than they used to: the side shading plane
    // already tints the shadow-side eye, and doubling that up made the pair look
    // asymmetric rather than lit once the camera moved in.
    sclera: [250, 248, 245, 1],
    scleraShade: [240, 236, 233, 1],
    // One shape does both jobs the research asks of the sclera: the upper lid's
    // cast shadow across the top, and the corner darkening — it is the opening's
    // own outline with its lower edge raised most in the middle and not at all
    // at the canthi, so it is deep at the corners and shallow under the lid.
    eyeShade: [...hsl(348, 0.30, 0.30).slice(0, 3), 0.15],
    // Limbal ring and inner glow are NEUTRAL overlays on top of the iris — a
    // translucent black annulus and a translucent white disc — never colours
    // derived from the iris hue. That is what keeps the 39-rung `hue/*` ladder
    // (which only ever swaps the iris paint) correct at every rung.
    limbal: [12, 9, 14, 0.30],
    irisGlow: [255, 255, 255, 0.13],
    pupil: [26, 18, 22, 1],
    catch: [255, 255, 255, 0.95],
    catch2: [255, 255, 255, 0.25],
    // The lower lid's own edge, read as a line rather than a lash.
    water: [...off(-20, -0.04, 0.28).slice(0, 3), 0.22],
    carun: [...off(-22, 0, 0.70).slice(0, 3), 0.42],
    lash: hsl(wh - 6, ws - 0.02, wl - 0.10),
    crease: [...off(-16, -0.06, 0.55).slice(0, 3), 0.42],
    // One warm shade for the two soft folds of skin the eye makes: the
    // thickness of the upper lid above the lash, and the roll of cheek a
    // squint pushes up under the lower one. They are the same material seen
    // from the same light, so they are the same paint — and one paint is what
    // lets `squintSh` fade in on its own alpha without a second registry entry.
    lidFold: [...off(-14, 0.04, 0.62).slice(0, 3), 0.30],
    brow: hsl(wh, ws, wl),
    browR: hsl(wh - 2, ws, wl - 0.05),

    // --- the mouth ------------------------------------------------------------
    lipUp: hsl(...p.lips.up),
    lipLow: hsl(...p.lips.low),
    lipHi: [255, 240, 233, 0.24],
    lipBow: [255, 238, 231, 0.13],
    seam: [...lip(-4, 0.02, 0.26).slice(0, 3), 0.85],
    commiss: [...lip(-6, 0.03, 0.30).slice(0, 3), 0.30],
    philtrum: [...off(-17, 0.06, 0.46).slice(0, 3), 0.22],
    mouthIn: hsl(350, 0.35, 0.25),
    teeth: [250, 246, 242, 1],
    toothSep: [...hsl(28, 0.14, 0.38).slice(0, 3), 0.55],
    // The upper lip's cast shadow doubles as the gum line: it used to be a
    // neutral dark multiply with a separate pink `gum` band under it, and the
    // multiply ate the pink — 2% contrast, invisible at 1x and at 3x. One
    // warmer, pinker shadow says both things in one draw.
    toothSh: [...hsl(350, 0.52, 0.30).slice(0, 3), 0.40],
    tongue: hsl(352, 0.42, 0.56),
  };
}

// The iris ladder. `hue/NNN` swaps to a solid at that hue; the driver always
// holds one (or two neighbouring) hue poses at full weight, and layers
// `iris/eyes-saturation-0` and `iris/eyes-brightness-0` on top of it, all
// blended in RGBA against the *base* iris paint. So the base is not a colour
// anybody picks: it is solved backwards from where the persona's `eye` should
// land at the persona's OWN dial, so `shown(h) = eye + ladder(h) - ladder(hue)`
// and a dark ladder is the only thing that keeps a dark eye dark at all 39
// rungs. This file used to carry the answer pasted in — `base: [72,144,192]`,
// solved by hand — with a comment saying `solveIrisBase` returns exactly that;
// it does, which is the whole reason it can be wired up now without moving a
// byte. The two overlay rungs are the ladder's own lightness, greyed flat and
// lifted — 100% and 158.8% of it, i.e. the [107,107,107] and [170,170,170]
// this file has always written at light 0.42.
function makeIris(p) {
  const IRIS = {
    hue: (h) => hsl(h, p.iris.sat, p.iris.light),
    grey: hsl(0, 0, p.iris.light),
    bright: hsl(0, 0, p.iris.light * 1.588),
    target: [...p.iris.eye, 1],
  };
  IRIS.base = solveIrisBase(IRIS.target, IRIS, {
    hue: p.iris.hue, saturation: p.iris.saturation, brightness: p.iris.brightness,
  });
  return IRIS;
}

// A persona, filled in from the defaults one level down (each block is a small
// flat record, and a half-given `iris` block wants the rest of the driver's
// defaults, not `undefined`).
function fill(persona = {}) {
  const d = DEFAULT_PERSONA;
  return sexPaint({
    sex: persona.sex || d.sex,
    geo: persona.geo || undefined,   // JSON.stringify drops it when unset
    skin: persona.skin || d.skin,
    lips: { ...d.lips, ...(persona.lips || {}) },
    iris: { ...d.iris, ...(persona.iris || {}) },
    brow: { ...d.brow, ...(persona.brow || {}) },
    lash: { ...d.lash, ...(persona.lash || {}) },
    // Omit the optional construction block when it was omitted on input, so
    // personas that do not use it keep byte-identical `meta.live.persona`.
    eye: persona.eye ? { aperture: 1, ...persona.eye } : undefined,
    mouth: persona.mouth ? { ...persona.mouth } : undefined,
    nose: persona.nose ? { ...persona.nose } : undefined,
    skinDetail: persona.skinDetail ? { ...persona.skinDetail } : undefined,
    blush: persona.blush ?? d.blush,
  }, persona);
}

// ---------------------------------------------------------------------------
// SEX. `persona.sex` is 'f' (the default, and the look this family has always
// had) or 'm'. It is one key and it moves two things:
//
//   GEOMETRY — `SEX_GEO` is a patch on the rest control vector, so a man is
//   this same skull built at a different rest. `persona.geo` overrides it
//   channel by channel for a persona that wants, say, a man's jaw at 0.6.
//
//   PAINT — the marks that are conventions of femininity in a flat vector
//   face, not anatomy: the lash mass, the rouge, and a lip that is a different
//   HUE from the skin. Removing them is what stops a male rig reading as a
//   woman with a wide jaw. A persona that states the key itself always wins:
//   `sexPaint` only reaches for a mark the caller left unsaid.
// ---------------------------------------------------------------------------

export const SEX_GEO = {
  f: {},
  m: { jawWidth: 0.85, neckWidth: 1, eyeSize: -0.18, browH: -0.6, headW: 0.12 },
};

export function geoOf(persona = {}) {
  const sex = persona.sex || DEFAULT_PERSONA.sex;
  const g = { ...(SEX_GEO[sex] || {}), ...(persona.geo || {}) };
  // `plateW` is not a knob: it is `headW` frozen at the vector this rig is
  // BUILT at, because the neck's base plate (§5) backs a garment hole that was
  // cut against this rig's rest render. Derived here rather than written into
  // SEX_GEO so a persona that overrides `headW` gets a plate that follows.
  return { ...g, plateW: g.headW || 0 };
}

// The rest vector this persona's rig is BUILT at. `poseHarness` diffs every
// pose against the builder run at this vector, so the sex geometry costs no
// pose and no runtime channel — it is simply where the face rests.
export function restFor(persona) { return ctrl(geoOf(persona)); }

function sexPaint(p, given = {}) {
  if (p.sex !== 'm') return p;
  // A man's lip is not a colour of its own: it is the SKIN PLANE, a few degrees
  // toward red, a shade darker and a touch MORE saturated, with the seam under
  // it doing the work of saying "mouth". The first version of this rule took
  // the woman's lip and desaturated it toward the skin — hue = skin, sat capped
  // at 0.15 — which is a different thing and a wrong one: 30% of the lightness
  // gone and two thirds of the chroma with it lands on a NEUTRAL, and a neutral
  // beside a warm skin does not read as a lip, it reads as grey lipstick. So
  // the lip is derived from `skin` now and the female lip is not consulted at
  // all: -12% and -7% of the skin's lightness for the upper and lower plane,
  // +0.05 and +0.07 of its saturation, 6 and 8 degrees redder. Lightness as a
  // RATIO is what keeps the two planes apart on a deep brown as well as on a
  // peach, and it is why the lower lip lands lighter and rosier than the upper
  // on every skin in the set rather than only on the pale ones.
  const [sh, ss, sl] = p.skin;
  if (!given.lips) p.lips = { up: [sh - 6, ss + 0.05, sl * 0.88], low: [sh - 8, ss + 0.07, sl * 0.93] };
  if (!given.lash) p.lash = { ...p.lash, weight: 0 };
  if (given.blush === undefined) p.blush = 0;
  if (!given.brow) p.brow = { ...p.brow, weight: Math.max(p.brow.weight, 1.35) };
  return p;
}

// ===========================================================================
// 4. LANDMARKS
//    CENTER points sit on the midline; SIDE points are mirrored into a left
//    (viewer-left, lit) and a right (shadow) copy, suffixed L / R; FREE points
//    carry a signed x and are NOT mirrored — they are what makes the fringe
//    sweep to one side and the nose tick sit on the shadow side.
// ===========================================================================

const CENTER = {
  crown:  [0, P.headTop],
  glab:   [0, 520],          // glabella, between the brows
  ntip:   [0, P.noseBaseY],
  philt:  [0, 732],
  mth_c:  [0, P.mouthY],     // centre of the mouth opening
  chin_t: [0, 840],          // crease under the lower lip
  chin:   [0, P.chinY],
  // hair
  hb_t:   [0, 232],
  hb_b:   [0, 1052],
  // neck + throat
  nk_t:   [0, 818],
  nk_b:   [0, 1220],
  nsh_t:  [0, 800],
  // the neck's base plate (§5, `platePts`) — a frozen copy of the neck's own
  // four points, so the plate is the neck's REST outline and stays there.
  pl_t:   [0, 818],
  pl_b:   [0, 1220],
  // shirt
  colc:   [0, 1146],
  colc_t: [0, 1132],
  colc_b: [0, 1182],
  botc:   [0, 1700],
};

const SIDE = {
  // silhouette, crown -> chin. Widest at the cheeks (chk), soft small chin.
  crn:   [162, 262],
  tmpT:  [260, 344],
  tmp:   [292, 468],
  chk:   [302, 600],
  lchk:  [276, 700],
  jaw:   [214, 800],
  // chin 48% of the cheek width — the adult range is 45-50%; it was 37%
  jawm:  [145, 862],
  // brows: soft arch, peak at the outer third. Flatter than the cute original
  // (36px of arch became 22) and closer to the eye: an adult brow-eye gap.
  bwI:   [80, 530],
  bwM:   [166, 512],
  bwO:   [232, 534],
  // nose
  nwing: [60, 694],
  // anchors that drive the smooth inserts, morphed with everything else
  eyeC:  [P.eyeGapHalf + P.eyeHalfW, P.eyeY],
  mcor:  [P.mouthHalfW, 758],       // 10px above mth_c: the resting smile
  // the cheek rouge, as its INNER and OUTER edge rather than a centre: an
  // ellipse whose centre is morphed and whose radius is not is a rouge that
  // keeps its size while the face under it changes size, and at
  // `morph/head_-100` that put 1240 px of it on the page either side of the
  // narrowed jaw. Two landmarks 128 apart go through every morph with the rest
  // of the mesh, so the width is whatever the mesh did to that span — which is
  // more than what it did to the midpoint, because the head-width ramp is
  // steeper at 242 than at 114.
  blushI: [114, 706],
  blushO: [242, 706],
  // ears, sitting in the brow -> nose-base band per the Loomis canon
  earA:  [272, 550],
  earB:  [328, 558],
  earC:  [348, 614],
  earD:  [332, 676],
  earE:  [288, 702],
  earIA: [299, 588],
  earIB: [322, 617],
  earIC: [307, 654],
  earID: [287, 619],
  // the bob
  hbA:   [176, 248],
  hbB:   [292, 338],
  hbC:   [338, 470],
  hbD:   [342, 660],
  hbE:   [326, 862],
  hbF:   [302, 1002],
  hbG:   [176, 1044],
  // neck
  // neck 49% of the cheek width (was 41%) — an adult neck carries the skull
  nk:    [148, 826],
  nkm:   [166, 1020],
  nkb:   [182, 1220],
  // …and the plate's copy of them. Same numbers, different morph exemptions.
  plt:   [148, 826],
  plm:   [166, 1020],
  plb:   [182, 1220],
  // The chin's cast shadow falls ON the neck, so it has to fit INSIDE it. These
  // two used to be 172 / 170 against a neck edge that renders at 148 / 165, and
  // the overhang was invisible only because the vector `shirt` was painted over
  // it. A bitmap garment hides `shirt`, and the 15%-alpha plane then landed on
  // the page itself as two pale wedges either side of the neck base — worst on
  // the men, where `neckWidth` widens the shadow and the neck by the same 22%
  // but the SPILL by 22% as well. The curve bulges ~10 past its own points, so
  // these two render at 150 at the widest against a neck edge of 165 — inside
  // it by 9% of the neck all the way down, with room for the head to turn.
  nshA:  [131, 812],
  nshB:  [137, 892],
  // shirt
  col:   [186, 1044],
  sho:   [452, 1076],
  out:   [528, 1310],
  bot:   [548, 1700],
  colT:  [192, 1036],
  colB:  [196, 1062],
};

// Points with a signed x that must NOT be mirrored: the swept fringe, the
// highlight riding on it, the one-stroke nose and the boundary of the side
// shading plane. Symmetry is the default in a face; the small asymmetries are
// most of what stops a generated character looking generated.
const FREE = {
  // fringe: outer edge over the crown, then the hairline right -> left with
  // the parting left of centre
  fr1: [-312, 480], fr2: [-324, 350], fr3: [-210, 250], fr4: [0, 226],
  fr5: [215, 252], fr6: [324, 356], fr7: [316, 478],
  fr8: [244, 496], fr9: [100, 454], fr10: [-46, 424], fr11: [-192, 462],
  // highlight band on the lit side of the fringe
  hh1: [-256, 330], hh2: [-150, 268], hh3: [-40, 246],
  hh4: [-48, 272], hh5: [-156, 292], hh6: [-248, 352],
  // nose: one L-shaped tick, drawn as a tapered closed stroke
  no1: [24, 654], no2: [36, 686], no3: [56, 704], no4: [84, 710],
  no5: [80, 724], no6: [42, 716], no7: [14, 692], no8: [8, 656],
  // bottom of the chin's cast shadow — pushed a little to the shadow side
  nsh_b: [12, 946],
};

// How strongly each point follows the jaw when the mouth opens.
const JAWW = {
  chin: 1, chin_t: 0.88, jawm: 0.76, jaw: 0.30, lchk: 0.10,
  mcor: 0.40, mth_c: 0.42, philt: 0.16, ntip: 0.04, nwing: 0.05,
  blushI: 0.08, blushO: 0.08,
  no1: 0.02, no2: 0.03, no3: 0.04, no4: 0.04, no5: 0.04, no6: 0.04, no7: 0.03, no8: 0.02,
};
// Cheek raise (a smile pushes the cheek mass up under the eye).
const CHEEKW = { blushI: 1, blushO: 1, lchk: 0.5, chk: 0.28, mcor: 0.45, sh5: 0.5, sh6: 0.35 };


// Landmarks the BODY is made of — the shirt, and the neck's base plate. They
// are exempt from every head morph: nothing in the rig.json format nests a body
// under a head, so "only the head" has to be spelled out as a list of point
// names. The plate is in the list for a second reason as well: the garment's
// neck hole is cut ONCE, against this rig's own rest render, and a head morph
// does not move it — so the thing that backs the hole must not move either.
const SHIRT_PTS = new Set(
  ['col', 'sho', 'out', 'bot', 'colT', 'colB', 'plt', 'plm', 'plb']
    .flatMap((n) => [n, n + 'L', n + 'R'])
    .concat(['colc', 'colc_t', 'colc_b', 'botc', 'pl_t', 'pl_b']));
// The plate's own eight, listed once: exempt from the head morph like the rest
// of the shirt, but widened by `plateW` (§4, `widen`) so it still matches the
// neck this rig was built with.
const PLATE_PTS = ['pl_t', 'pl_b', 'pltL', 'pltR', 'plmL', 'plmR', 'plbL', 'plbR'];

// Sex-axis geometry. `jawWidth` and `neckWidth` are named point sets rather
// than a y-window scale like headW: a band low enough to catch the jaw also
// catches the mouth corners, the blush and the nose tick, and a wider jaw must
// not widen the mouth. The weight is how much of the full push each point takes.
const JAWWIDE = { lchk: 0.20, jaw: 0.62, jawm: 1 };
// The neck carries its own cast shadow (nshA/nshB) so the shadow never spills
// past the silhouette it is cast on.
const NECKWIDE = { nk: 1, nkm: 1, nkb: 1, nshA: 1, nshB: 1, plt: 1, plm: 1, plb: 1 };
// The collar is the one part of the shirt that a wider neck must move: it is
// what the neck comes out of. `sho`/`out`/`bot`/`colc*` stay put, so the
// shoulders and the shirt body keep the size the wardrobe bitmaps were cut for.
const COLLARWIDE = { col: 1, colT: 1, colB: 1 };

export function landmarks(c) {
  const cx = P.cx, pts = {};
  for (const [n, [x, y]] of Object.entries(CENTER)) pts[n] = [cx + x, y];
  for (const [n, [dx, y]] of Object.entries(SIDE)) {
    pts[n + 'L'] = [cx - dx, y];
    pts[n + 'R'] = [cx + dx, y];
  }
  for (const [n, [x, y]] of Object.entries(FREE)) pts[n] = [cx + x, y];

  // --- identity morphs ----------------------------------------------------
  // eye spacing: slide the eye anchor and everything hung off it
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    pts['eyeC' + k][0] += s * 22 * c.eyeSpace;
    for (const n of ['bwI', 'bwM', 'bwO']) pts[n + k][0] += s * 13 * c.eyeSpace;
  }
  // nose width: the wing landmarks and the tick's own eight points
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    pts['nwing' + k][0] = cx + (pts['nwing' + k][0] - cx) * (1 + 0.34 * c.noseW);
  }
  for (const n of ['no1', 'no2', 'no3', 'no4', 'no5', 'no6', 'no7', 'no8']) {
    pts[n][0] = cx + (pts[n][0] - cx) * (1 + 0.30 * c.noseW);
  }
  // brow height: brows carry a little of the forehead mesh with them
  // The three brow channels are per SIDE now (`eyeSide`), and they arrive in
  // the driver's -1..1 rather than in px: `BROW_PX` is the part's own statement
  // of what one unit of each is worth, so the px live next to the geometry they
  // were tuned against and this loop only says WHERE they land.
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const e = eyeSide(c, s);
    for (const [n, g] of [['bwI', 1], ['bwM', 1], ['bwO', 0.85]]) {
      pts[n + k][1] -= (20 * c.browH + e.browRaise * BROW_PX.raise
        + e.browInner * BROW_PX.inner * (n === 'bwI' ? 1 : n === 'bwM' ? 0.4 : 0)
        + e.browAngle * BROW_PX.angle * (n === 'bwO' ? 1 : n === 'bwM' ? 0.4 : 0)) * g * 0.55;
    }
  }

  // --- head width: a global x-scale that fades in away from the midline ----
  // The shirt is deliberately exempt: the head morph must not resize the body,
  // and there is no transform hierarchy in the format to give us that for free.
  // Unlike facet, which widens hardest at the jaw, a round face widens hardest
  // across the cheeks.
  const widen = (names, w) => {
    if (!w) return;
    for (const n of names) {
      const dx = pts[n][0] - cx, a = Math.abs(dx);
      const t = clamp((a - 30) / 240, 0, 1);
      const ramp = 0.14 + 0.86 * (t * t * (3 - 2 * t));
      let g = 0.20 * w * ramp;
      const y = pts[n][1];
      if (y > 540 && y < 760) g += 0.07 * w * ramp;   // the cheeks widen most
      pts[n][0] = cx + dx * (1 + g);
    }
    // a wider head is also a slightly shorter one
    for (const n of names) {
      if (pts[n][1] < 920) pts[n][1] = P.eyeY + (pts[n][1] - P.eyeY) * (1 - 0.045 * w);
    }
  };
  widen(Object.keys(pts).filter((n) => !SHIRT_PTS.has(n)), c.headW);
  // The plate is the one SHIRT_PT that takes this transform anyway — off its
  // own channel. `plateW` is the head width the rig was BUILT at (§3, geoOf)
  // and no pose ever moves it, so the plate lands exactly on the neck's REST
  // outline on a man as well as on a woman, while `morph/head_±100` still
  // slides the neck across a plate that stays where the garment's hole is.
  // Without this the men's plate sat 2.4 px inside their own neck and left a
  // hairline of page open along the neckline: 1205 px at 3x on round-m2.
  widen(PLATE_PTS, c.plateW);

  // --- jaw width: the silhouette from the cheek down, and the gonial angle --
  // A man's mandible is wider at the corner and squarer where it turns; a
  // woman's tapers sooner. This is the strongest single cue at 1x.
  if (c.jawWidth) {
    for (const [n, w] of Object.entries(JAWWIDE)) {
      for (const k of ['L', 'R']) {
        const q = pts[n + k];
        q[0] = cx + (q[0] - cx) * (1 + 0.32 * c.jawWidth * w);
      }
    }
    // squarer corner: the gonial point drops as it widens
    for (const k of ['L', 'R']) pts['jaw' + k][1] += 12 * c.jawWidth;
  }

  // --- neck width: the neck, its cast shadow, and the collar it wears -------
  if (c.neckWidth) {
    for (const [n, w] of Object.entries(NECKWIDE)) {
      for (const k of ['L', 'R']) {
        const q = pts[n + k];
        q[0] = cx + (q[0] - cx) * (1 + 0.22 * c.neckWidth * w);
      }
    }
    for (const n of Object.keys(COLLARWIDE)) {
      for (const k of ['L', 'R']) {
        const q = pts[n + k];
        q[0] = cx + (q[0] - cx) * (1 + 0.16 * c.neckWidth);
      }
    }
  }

  // --- eye-derived points (the lid plate bounds, not the eye itself) -------
  const hw = P.eyeHalfW * (1 + 0.20 * c.eyeSize);
  const bh = P.eyeBotH * (1 + 0.24 * c.eyeSize);
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const e = pts['eyeC' + k];
    pts['eyI' + k] = [e[0] - s * (hw + 20), e[1] + 5];
    pts['eyO' + k] = [e[0] + s * (hw + 26), e[1] - 11];
    pts['eyB' + k] = [e[0] + s * 4, e[1] + bh + 34];
  }

  // --- expression / animation deformation ---------------------------------
  if (c.jaw) {
    const d = c.jaw * P.jawDrop;
    applyWeights(pts, JAWW, (p, w) => {
      p[1] += d * w;
      if (w > 0.6) p[0] = cx + (p[0] - cx) * (1 - 0.030 * c.jaw);
    });
  }
  if (c.cheekRaise) {
    applyWeights(pts, CHEEKW, (p, w) => { p[1] -= c.cheekRaise * 13 * w; });
  }
  if (P.scale !== 1) {
    const K = P.scale, oy = P.headTop;
    for (const n of Object.keys(pts)) {
      pts[n][0] = cx + (pts[n][0] - cx) * K;
      pts[n][1] = oy + (pts[n][1] - oy) * K;
    }
  }
  return pts;
}

// ===========================================================================
// 5. SHAPES
//    [slot, group, [landmark names, in order round a closed loop], tone,
//     tension]. Where facet had a table of triangles over its landmarks, this
//    has a table of closed splines over them. Nothing is mirrored
//    automatically: a loop that crosses the midline has to name both halves.
// ===========================================================================

// Three groups, and the third one is new. `head` turns with the head matrix,
// `body` does not; `hand` is neither, because the hand is not on the character
// at all — it is the nearest object in the FRAME, placed by the camera window's
// own numbers, and a head that turns must not take it along.
export const HEAD = 'head', BODY = 'body', HAND = 'hand';

// ---------------------------------------------------------------------------
// `band`, `bulge`, `contours` and `ring` — the shape idioms the fidelity pass
// needed — are in `author/path.mjs`; two of the three generators had each of
// them. `onRun`, the polyline sampler the lower lashes hang off, went the other
// way: it had one call site, the call site moved into `author/parts/eye.mjs`,
// and so did it.
// ---------------------------------------------------------------------------

const FACE_LOOP = [
  'crown', 'crnL', 'tmpTL', 'tmpL', 'chkL', 'lchkL', 'jawL', 'jawmL',
  'chin', 'jawmR', 'jawR', 'lchkR', 'chkR', 'tmpR', 'tmpTR', 'crnR',
];

export const SHAPES = [
  // the bob, behind everything
  ['hairBack', HEAD, ['hb_t', 'hbAL', 'hbBL', 'hbCL', 'hbDL', 'hbEL', 'hbFL', 'hbGL',
    'hb_b', 'hbGR', 'hbFR', 'hbER', 'hbDR', 'hbCR', 'hbBR', 'hbAR'], 'hairBack', 1],
  // ears, in front of the hair and behind the face
  ['earL', HEAD, ['earAL', 'earBL', 'earCL', 'earDL', 'earEL'], 'ear', 1],
  ['earInL', HEAD, ['earIAL', 'earIBL', 'earICL', 'earIDL'], 'earIn', 1],
  ['earR', HEAD, ['earAR', 'earBR', 'earCR', 'earDR', 'earER'], 'earR', 1],
  ['earInR', HEAD, ['earIAR', 'earIBR', 'earICR', 'earIDR'], 'earInR', 1],
  // neck, and the shadow the chin casts on it
  ['neck', HEAD, ['nk_t', 'nkR', 'nkmR', 'nkbR', 'nk_b', 'nkbL', 'nkmL', 'nkL'], 'neck', 1],
  ['neckSh', HEAD, ['nshAL', 'nsh_t', 'nshAR', 'nshBR', 'nsh_b', 'nshBL'], 'neckSh', 1],
  // shirt (BODY: exempt from the head matrix and every head morph)
  ['shirt', BODY, ['colL', 'shoL', 'outL', 'botL', 'botc', 'botR', 'outR', 'shoR', 'colR', 'colc'], 'shirt', 1],
  ['collar', BODY, ['colTL', 'colc_t', 'colTR', 'colBR', 'colc_b', 'colBL'], 'collar', 1],
  // the face itself
  ['face', HEAD, FACE_LOOP, 'face', 1],
];

// The slots a wardrobe layer follows when it is a GARMENT rather than hair or
// glasses. The build reads it to find where the neck's base plate has to stop
// (§5, `plateTop`); it is stated here because this table is where the names
// are, and a renamed shirt should break the build rather than the picture.
export const GARMENT_SLOTS = ['shirt', 'collar'];

// ---------------------------------------------------------------------------
// THE NECK'S BASE PLATE — one static shape, drawn behind everything.
//
// The neck is a HEAD draw and the garment is a BODY one, so under `headRoll`,
// `headYaw` and `headPitch` the neck swings inside a garment neckline that does
// not move: 9 deg about `neckPivot` is 21 px of lateral travel at the collar and
// a yaw is 40 px flat. The wardrobe matte is cut at the neck's REST outline
// (`wardrobe/extract.py`, `roi &= ~neck`) so the two silhouettes have no overlap
// at all, and the page opened up beside the upper neck — ~1345 px at 3x on
// round-m2. Blending the garment toward the head matrix would swing the
// shoulders with it; a second, collar-height bitmap layer on the head matrix
// only moves the seam down to the collar's own join and does nothing for the
// two bald rigs, which wear a vector shirt.
//
// What actually closes it is that the hole is FIXED and the wedge is therefore
// always a subset of the neck's rest footprint: so back the hole with skin.
// `neckPlate` is that backing — the neck's own rest outline, inset 1 px so it
// is strictly inside the neck's opaque interior (hidden at rest, on every rig,
// at every scale), painted in the BODY group so it stays put while the head
// moves. It is pushed FIRST, behind the bob, because where a rig already has
// hair behind the neck the hair is what should show through, not skin.
//
// It has a hard top edge, and where that edge sits is the whole of the rest of
// the design. THE PLATE STOPS WHERE ITS COVER STARTS. Above the garment's own
// neckline nothing ever covers the plate, so a plate carried higher would show
// beside a neck that had rolled out from under it — a second, static neck edge
// standing in the page, which is a worse picture than the wedge it was cutting.
// `plateTop` is that line, in design y, written by the build (build.mjs, §10)
// as the top edge of the topmost bitmap layer that follows a body slot; a rig
// with no such layer wears the vector shirt and falls back to `colT`, the
// collar's own top landmark. Both are ABOVE the neckline they stand for — a
// crop starts at the garment's shoulders, not at its collar — so the wedge is
// always closed, and what is left over is the few rows between the two. The
// `lift` is slack for a stroke's half-width and for the flat cut's own
// sampling error; it costs those rows and nothing else. A sidecar that has
// measured its own neckline may state it and be believed instead — which is
// what the four open-jacket personas do, their crops starting 70 rows above
// the line they draw beside the neck.
//
// The cut also puts the plate below the `wardrobe/hair-back` bitmaps that sit
// behind the neck's edges from design y 865 to 904 on this face. Skin painted
// over hair is the one thing worse than page, and now the plate cannot reach
// that far up on any rig.
// ---------------------------------------------------------------------------

const PLATE = { inset: 1, lift: 4, per: 32 };
const PLATE_LOOP = ['pl_t', 'pltR', 'plmR', 'plbR', 'pl_b', 'plbL', 'plmL', 'pltL'];

function platePts(L, c) {
  const cx = P.cx, { inset, lift, per } = PLATE;
  const loop = PLATE_LOOP.map((n) => L[n]);
  // `plateTop` is 0 on a rig the build said nothing about, and a rig the build
  // says nothing about is one that wears the vector shirt: the collar's own top
  // landmark is where its cover starts.
  const top = (c.plateTop || L.colTL[1]) - lift;
  const bot = L.pl_b[1] - 2 * inset;
  // Sampled off the plate loop's own curve rather than re-splined through its
  // four points, so the plate follows the neck's contour instead of a second
  // curve that only meets it at the landmarks. Clamped, never filtered: the
  // point count of a draw has to be the same in every pose — which is why the
  // run is sampled deep. Every sample above the cut collapses onto it keeping
  // its own x, so the flat top edge is only as wide as the last sample above
  // it; at 32 the neck's flare costs less than a pixel there.
  const side = (from, to) => sampleRun(loop, 1, from, to, per).map(([x, y]) => {
    const yy = clamp(y, top, bot);
    const half = Math.max(0, Math.abs(x - cx) - inset);
    return [cx + Math.sign(x - cx) * half, yy];
  });
  return [...side(1, 3), ...side(5, 7)];
}

// Drawn after the face: the fringe covers the top of the head, so its outer
// edge deliberately overshoots the silhouette onto the hair behind.
export const SHAPES_TOP = [
  ['fringe', HEAD, ['fr1', 'fr2', 'fr3', 'fr4', 'fr5', 'fr6', 'fr7', 'fr8', 'fr9', 'fr10', 'fr11'], 'hairFront', 1],
  ['hairHi', HEAD, ['hh1', 'hh2', 'hh3', 'hh4', 'hh5', 'hh6'], 'hairHi', 1],
];

// The shading plane is a band that hugs the shadow-side contour: FACE_LOOP
// indices 8 ('chin') up to 14 ('tmpTR', which sits under the fringe). Both of
// its edges are offsets of the same sampled curve, so it is parallel to the
// silhouette by construction and there is no second set of landmarks to keep
// in sync with the first.
const SHADOW_RUN = [8, 14];
const SHADOW_W = 58;          // widest point of the band, at the cheek

// ===========================================================================
// 6. THE KIT — one persona, resolved
//    A palette, an iris ladder and a paint registry of its own. Everything
//    below takes it as an argument, because a second persona is a second
//    display list built by the same builder and it must not share a paint
//    table with the first one.
// ===========================================================================

export function makeKit(persona) {
  const p = fill(persona);
  const PALETTE = makePalette(p), IRIS = makeIris(p), reg = paintRegistry();
  // Eye WIDTH is already an adult 20.7% of the cheek and remains identity
  // geometry. `aperture` only scales the two vertical radii, so a persona can
  // lose the startled/cute opening without becoming narrow-eyed or moving the
  // iris, canthi, brow, wardrobe fit, or head silhouette.
  const EYE_P = {
    ...P,
    eyeTopH: P.eyeTopH * (p.eye?.aperture ?? 1),
    eyeBotH: P.eyeBotH * (p.eye?.aperture ?? 1),
  };
  // The two parts are constructed HERE, not in the draw builder: everything
  // they take is a constant of this persona — the proportions, the resolved
  // palette, this persona's own paint registry, the solved base iris, the lash
  // and brow weights. Construction once, `draws(c, …)` once per control vector.
  return {
    p, PALETTE, IRIS, ...reg,
    mouth: makeMouth({ P, PALETTE, solid: reg.solid, group: HEAD, marks: p.mouth }),
    eye: makeEye({
      P: EYE_P, PALETTE, solid: reg.solid, group: HEAD,
      irisBase: IRIS.base, lashWeight: p.lash.weight, browWeight: p.brow.weight,
      refine: p.eye?.refine,
    }),
    nose: makeNose({ P, PALETTE, solid: reg.solid, group: HEAD, shape: p.nose }),
    skinDetail: makeSkinDetail({
      PALETTE, solid: reg.solid, group: HEAD, profile: p.skinDetail,
    }),
    // The third part takes no persona of its own beyond the skin rungs: a
    // character's hand is the same character's hand, so `PALETTE.face` /
    // `shade` / `crease` are the whole of it, which is also why the paint
    // table does not grow by a single entry.
    hand: makeHand({ P, PALETTE, solid: reg.solid, frame: HAND_FRAME, group: HAND }),
  };
}

// ===========================================================================
// 7. THE CONTROL VECTOR
// ===========================================================================

// The channels the driver's vocabulary needs somebody to implement, at rest —
// six identity morphs, a jaw, a cheek, an eye block and a mouth block. The
// table lives in author/rig.mjs (REST_CONTROLS) because all three styles hold
// it byte-for-byte; a style that grew a channel of its own spreads it here,
// which is exactly what this one now does — twice, because both of its parts
// have moved into channel space.
//
// The mouth block is overridden with `author/parts/mouth.mjs`'s: voqalize's ten
// mouth CHANNELS (`open` 0..1, `width` 0..1, `round`, `press`, `tuck`, per-side
// corners) in place of the nine pre-channel keys REST_CONTROLS still carries.
// The eye block likewise carries `author/parts/eye.mjs`'s: `eye:` in channel
// space (lid / squint / pupilX / pupilY / browRaise / browAngle / browInner),
// plus the two empty per-side override blocks `eyeL:` and `eyeR:` that let a
// patch say `{ eye: { lid: 0.12 }, eyeR: { lid: 1 } }` and get a wink.
//
// `facet` and `ink` still hold both features inline and read the px-and-ratio
// blocks REST_CONTROLS ships, so each is an override rather than a change to
// the shared table — until they are parts too, when the overrides go and
// `REST_CONTROLS` changes once.
//
// `hand:` is the third block and the odd one out: it is not a channel vector
// at all, it is voqalize's `HandFrame` — a gesture NAME, a progress and a
// side. It rides the control vector because the control vector is what
// `buildDraws` is given and because a hand is part of what this character is
// doing this frame; it stays OUT of `REST_CONTROLS` because facet and ink have
// no hand and a shared table that carries one would be lying about them.
export const ctrl = makeCtrl({
  ...REST_CONTROLS, plateW: 0, plateTop: 0, mouth: mouthRestChannels(), ...eyeChannelRest(), ...handRest(),
});

// The same factory, rebased on a persona's rest (§3, restFor). `finishRig`
// builds every pose through `spec.ctrl`, so a male rig must hand it THIS one:
// otherwise each pose would silently reset jawWidth/neckWidth to the family
// neutral and every pose would carry the whole face as a diff.
export function ctrlFor(persona) { return makeCtrl(restFor(persona)); }

// ===========================================================================
// 8. DRAW BUILDER
//    Runs the whole character for one control vector. Called once for the
//    rest pose (which becomes the base display list) and once per pose; the
//    poses are then a straight diff, so topology can never drift.
//    `K` is the kit above: the persona's palette, its iris ladder and its
//    paint registry. It is a second argument rather than a module constant
//    because one process can build several of these characters.
// ===========================================================================

export function buildDraws(c, K) {
  const { PALETTE, solid } = K;
  const L = landmarks(c);
  const out = [];
  // `rule` and `blend` are draw-level fields `toRig` passes through verbatim
  // (author/README.md). 'evenodd' is the only way to say "this contour is a
  // hole", which the limbal ring needs; 'multiply' is what makes the teeth's
  // upper-lip shadow and the mouth-corner pockets darken what is under them
  // rather than paint over it.
  const push = drawPusher(out);

  // Behind everything, including the bob: the neck's base plate (§5).
  push('neckPlate', BODY, polygon(platePts(L, c)), solid(PALETTE.neck));

  const emit = (table) => {
    for (const [slot, group, names, tone, tension] of table) {
      const pts = names.map((n) => {
        if (!L[n]) throw new Error(`shape ${slot}: no landmark "${n}"`);
        return L[n];
      });
      push(slot, group, spline(pts, tension), solid(PALETTE[tone]));
    }
  };

  emit(SHAPES);

  // ---- cheeks --------------------------------------------------------------
  // Seven points and 0.26 alpha read as a flat lozenge once the camera moved
  // in; eleven points and 0.20 read as a soft ellipse. Same one draw.
  //
  // The WIDTH comes off the two cheek landmarks, so the rouge is warped by the
  // same field as the face it sits on (SIDE.blushI/blushO). The HEIGHT does
  // not: the only thing a head morph does vertically is make a wider head 4.5%
  // shorter, and 1.7 px on this blob is not worth a second pair of landmarks —
  // so it keeps the 37.12 px it was authored at, stated as the radius and the
  // squash it used to be written as. At rest the pair is 128 apart and this is
  // the same eleven points it always was, to the bit.
  const RY = 64 * 0.58;
  for (const side of [-1, 1]) {
    const k = side < 0 ? 'L' : 'R';
    const bi = L['blushI' + k], bo = L['blushO' + k];
    const bx = (bi[0] + bo[0]) / 2, by = (bi[1] + bo[1]) / 2;
    const rx = Math.abs(bo[0] - bi[0]) / 2;
    push('blush' + k, HEAD, spline(circle(bx, by, rx, 11, RY / rx), 1), solid(PALETTE.blush));
  }

  // Identity marks sit above the broad blush, below hair and eyes. Their
  // profile uses outer upper-cheek anchors, away from every expressive fold.
  out.push(...K.skinDetail.draws(c, L));

  emit(SHAPES_TOP);

  // ---- eyes ---------------------------------------------------------------
  // Eighteen draws a side, in paint order, from author/parts/eye.mjs. The brow
  // rides with them: its landmarks are solved above (brow height carries a
  // little of the forehead mesh with it, which is the mesh's business), the
  // arch over them is the part's.
  for (const side of [-1, 1]) out.push(...K.eye.draws(c, L, side));

  // ---- nose: persona-selectable planes; legacy tick is exact by default ----
  out.push(...K.nose.draws(c, L));

  // ---- mouth ---------------------------------------------------------------
  // Eleven draws, in paint order, from author/parts/mouth.mjs. It reads `c.jaw`
  // (the lower lip follows the chin) and `c.lipFull` (the identity morph) as
  // well as its own `c.mouth` block, and nothing outside it reads anything it
  // computes — which is what let it move out whole.
  out.push(...K.mouth.draws(c, L));

  // ---- the side shading plane, last ---------------------------------------
  // Painted over the finished face, so it tints the eye and the lip corner on
  // its side too, which is what makes it read as light rather than as a decal.
  // Its outer edge is sampled off the face outline and pulled P.shadowInset px
  // inboard: there is no clip in play, so anything that overshoots the
  // silhouette lands on the background.
  const fc = [P.cx, (P.headTop + P.chinY) / 2 + 40];
  const outline = FACE_LOOP.map((n) => L[n]);
  const contour = sampleRun(outline, 1, SHADOW_RUN[0], SHADOW_RUN[1], 3);
  const nb = contour.length - 1;
  // Widest over the cheek and jaw, tapering to a point at the chin and to
  // nothing up at the temple where the fringe covers the end of it.
  // The tips get pushed further in than the middle. A band that ends *on* the
  // contour looks like a leak: the fill bulges over the chin and onto the neck
  // where the outline curves hardest, and a tapering tip has no width left to
  // hide it. Recessing the ends costs nothing and reads as the shadow dying
  // out.
  const tipIn = (t) => P.shadowInset + 15 * Math.pow(1 - Math.sin(Math.PI * t), 2);
  // Always at least a few px wider than the outer inset, or the two edges
  // cross over and the band ties itself in a knot at the ends.
  const wAt = (t) => tipIn(t) + 4
    + SHADOW_W * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.34 * t);
  push('faceShade', HEAD, band(
    contour.map((q, i) => inward(q, fc, tipIn(i / nb))),
    contour.map((q, i) => inward(q, fc, wAt(i / nb))),
    0.7,
  ), solid(PALETTE.shade));

  // ---- the hand ------------------------------------------------------------
  // LAST, and last for a reason: the hand is the nearest object in the frame,
  // so anything drawn over it is a depth lie. That includes the wardrobe's
  // bitmap hair and glasses, which anchor `front-all` — `finishRig` keeps this
  // group behind nothing (author/finish.mjs, the tail group).
  //
  // At rest `c.hand.gesture` is null and all ten draws come back at alpha 0,
  // parked below the bottom edge. Which is two independent reasons for a hand
  // not to be on screen, and that is the right number for a display list that
  // a pose blend, a wardrobe and a live evaluator all write to.
  out.push(...K.hand.draws(c.hand));

  return out;
}

// ===========================================================================
// 9. PERFORMANCE — the control patches the driver's vocabulary gets filled
//    with. The base build and the pose diffing moved into `makeSpec` (§10):
//    the display list is a function of the persona now, and one process
//    builds several of them.
// ===========================================================================

// ---- visemes --------------------------------------------------------------
// The 16 mascot codes live in `author/parts/mouth-tables.mjs` now, next to the
// channels they are written in — that header carries the translation out of
// this avatar's old pixel units. Imported rather than re-declared: two idioms
// driving the same part should be driving it off the same table.
//
// `RHUBARB_POSES` is the nine-letter Rhubarb set baked straight from voqalize's
// own `VISEME_SHAPES` with no hand-tuning, as `rhubarb/A` … `rhubarb/X`. They
// are OPTIONAL poses (src/vocab.js), so a rig whose mouth is still inline does
// not have them and still validates.

// ---- eyes -----------------------------------------------------------------
// The EYE half of all six states now comes from the PART (author/parts/eye.mjs,
// EYE_TABLE), written in the driver's channel space — lid, squint, curveUp and
// the three brow channels, plus the `cheekRaise` that belongs to a Duchenne
// smile. That table is a statement about what those channels DO and is the same
// statement in any style, so it lives with the code that spends them.
//
// What stays HERE is the MOUTH each state wears, which is not the eye's to say
// and is very much this character's — and it is in the mouth part's channel
// space too, since §7 hands `mouthRestChannels()` to the control vector. A
// smile parts the lips: `open: 0.09` is a couple of millimetres of gap and
// `teeth: 0.45` puts a sliver of the upper band in it, which is what the
// lip-sync convention says a smile shows. Corners are per side now, so a smirk
// would be `cornerL` alone — this face just does not happen to want one yet. A
// sad mouth narrows and turns both corners down. Both closed variants carry the
// same mouth as their open ones, so a blink over a smile does not shut the
// mouth with it.
//
// So `eyes-happy` is ONE line assembled from two halves: the Duchenne eye out
// of EYE_TABLE and the corner lift out of SMILE.
const SMILE = { open: 0.09, width: 0.54, press: 0.15, teeth: 0.45, cornerL: 0.34, cornerR: 0.34 };
const FROWN = { width: 0.25, cornerL: -0.44, cornerR: -0.44 };

const EYE_MOUTH = {
  'eyes-happy': SMILE,
  'eyes-happy_closed': SMILE,
  'eyes-sad': FROWN,
  'eyes-sad_closed': FROWN,
};
export const EYES = Object.fromEntries(Object.entries(EYE_TABLE).map(
  ([n, patch]) => [n, EYE_MOUTH[n] ? { ...patch, mouth: EYE_MOUTH[n] } : patch],
));

// ===========================================================================
// 9.5 CAMERA — where the webcam is, in design space.
//     `meta.artboard` + `meta.align` crop this rectangle and blow it up to
//     fill a 4:3 frame (author/rig.mjs, `cameraMeta`). It is metadata: no
//     point, pose, stroke width or paint anywhere above changes because of it,
//     which is what makes a re-framing free of fidelity risk.
// ===========================================================================

// The wardrobe sidecars put the outer hair edge at y=120 and y=135. Their
// midpoint keeps both identities within 0.7% of the shared headroom while a
// single live face module continues to serve both. The vector fringe at 226 is
// hidden inside that silhouette and is not the crown a viewer sees.
const VISIBLE_CROWN = 127.5;
const SKULL_H = P.chinY - FREE.fr4[1];
export const CAMERA_WINDOW = viewBoxForHead({
  centerX: P.cx,
  crownY: VISIBLE_CROWN,
  chinY: P.chinY,
});

export const CAMERA = {
  frame: { w: 1440, h: 1080 },                      // a 4:3 webcam feed
  window: { cx: P.cx, y: CAMERA_WINDOW.y, h: CAMERA_WINDOW.h },
};

// ...and the same rectangle, spelled out, because the HAND needs it.
//
// Everything else in this file is in design space and does not care where the
// crop is. The hand does: it enters from the frame's BOTTOM EDGE, which is a
// fact about the camera and not about the character, and keeps its size tied
// to the same native head. `author/parts/hand.mjs` turns those measurements
// into its four numbers.
//
// The camera crop may change; the hand-to-head relationship must not.
export const HAND_FRAME = handFrameOf(CAMERA_WINDOW, SKULL_H);

// ===========================================================================
// 11. LIVE — what `src/live.js` needs on top of a control vector.
//
//     The runtime evaluator drives `buildDraws` from voqalize's channels, and
//     two things it cannot get from the channels themselves live here, because
//     both are this character's and not the adapter's:
//
//     REST   the control vector at rest, which the adapter patches. It already
//            agrees with voqalize's own REST channel for channel (mouth open
//            0.02 / width 0.42 / round 0.10 / press 0.15, lid 0.12, pupilY
//            0.05) — that agreement is why a rest pose comes out as the baked
//            base and not as a face that twitches the moment it is switched on.
//
//     HEAD   how far one unit of headYaw / headPitch / headRoll / breath moves
//            this head. The rig's vocabulary has NO head poses (src/vocab.js:
//            visemes, eyes, morphs, hues — head motion only ever existed inside
//            the ambient TRACKS), so the adapter spends those channels the same
//            way `headMatFactory` does: a rotation about the neck pivot written
//            onto every head draw. The numbers are scaled off this avatar's own
//            idle sway (deg 2.4, tx 7) and its breath key ([0, 0, -3.6, -7]),
//            taken out to a full excursion at channel = 1.
// ===========================================================================

export const REST = ctrl();

export const HEAD_LIVE = {
  pivot: P.neckPivot,
  yawPx: 40,        // headYaw 1 slides the head this far toward the +x side
  pitchPx: 26,      // headPitch 1 drops it this far (chin down)
  rollDeg: 9,       // headRoll 1 tilts it this many degrees, + = viewer's right
  // The pre-swell breath: a flat rise of head and body, this avatar's own
  // `breathing` key ([0, 0, -3.6, -7]) taken out to channel 1. `BODY_LIVE`
  // now states a `breathSwell` instead and the head's rise is derived from
  // it, so these two are the fallback for a face that declares no swell.
  breathTy: -3.6,
  breathBodyTy: -7,
};

// BODY — the four channels that move the trunk rather than the head, in the
// same shape voqalize's own faces spend them (face-core.js `poseTransforms`,
// constants from face-peep.js `POSE`). Three facts carried over rather than
// invented:
//
//   * A LEAN IS A CHANGE OF SCALE. "In a webcam frame a lean is read almost
//     entirely as a change of scale, so that is how it is drawn" — a uniform
//     1 + 0.055 about a point in the lower face, plus a small drop, and it is
//     applied to the WHOLE figure. The head is not counter-rotated and does
//     not stay put: peep prefixes the same lean transform to every layer it
//     draws, head and torso alike, and so does this.
//   * SHOULDERS AND THE TRUNK'S TURN ARE TORSO-ONLY. peep's `torsoLayers` is
//     `['body']`; nothing above the collar sees them. Ours is `meta.live.body`,
//     which is the same set for the same reason.
//   * ONE SHOULDER CANNOT RISE WITHOUT THE OTHER, because the torso is one
//     filled shape here as it is there. The mean of the two lifts it and the
//     difference rotates it a degree and a half about the sternum.
//
// The travels are peep's, converted rather than re-tuned. Both cameras now put
// crown-to-chin at 70% of frame height, so native head heights are the whole
// conversion: this face's visible 762.5 units / peep's 480 = 1.5885 design
// units per peep unit. The two PIVOTS are anchored on the chin
// rather than on the neck, because peep's are stated against a head (its
// `leanPivot` is 37 units above its `CHIN_Y`, its `shrugPivot` 203 below) and
// the two characters have different necks.
// The last three are the trunk's share of channels the HEAD also takes, and
// they are what `poseTransforms` does after `torsoT` rather than inside it:
//
//   * `yawPx` — peep's `PARALLAX.body` is 0.1 against a head layer at 1.0, so
//     at `headYaw 1` its trunk slides 0.1 x 28 = 2.8 units. Converted, 4.45
//     design px here. It is NOT 10% of OUR `yawPx`: the travel is what the
//     viewer measures. On top of `turnPx`, which the mixer drives from the
//     same headYaw at 0.45 and a near-3x tau, arriving late.
//   * `rollDeg` — peep's `ROLL_TORSO 1.5` against its `ROLL_HEAD 5.5`. The
//     RATIO converts, not the number: degrees are degrees, but 1.5 deg is
//     peep's answer to a 5.5-deg head and ours is 9, so the trunk takes
//     9 x 1.5/5.5 = 2.45. About `HEAD_LIVE.pivot`, which is the pivot peep
//     rolls both its head and its torso about.
//   * `breathSwell` / `swellPivot` — breath as chest expansion. The torso
//     scales about the HEM, so the shoulder line rises and the chest widens
//     while the bottom of the shirt stays put; the head rides the swell's
//     displacement at the neck pivot, which `src/live.js` derives rather than
//     taking a second constant. 0.008 is peep's own figure, unconverted
//     because a fraction has no units. The hem is this shirt's `bot`/`botc`
//     landmark at y 1700, the same anchor peep uses (its `swellPivot` is the
//     bottom edge of its own torso path, y 950).
export const BODY_LIVE = {
  leanScale: 0.055,             // torsoLean 1 scales the figure by this much...
  leanTravel: 36.54,            // ...and drops it this far (23 peep units)
  leanPivot: [P.cx, P.chinY - 58.78],
  shrugLift: 47.66,              // both shoulders at 1 lift the torso this far
  shrugTiltDeg: 1.6,            // one shoulder at 1 rolls it this many degrees
  shrugPivot: [P.cx, P.chinY + 322.47],
  turnPx: 25.42,                // torsoTurn 1 slides the torso this far in x
  yawPx: 4.45,                  // headYaw 1 drags the torso this far as well
  rollDeg: 2.45,                // headRoll 1 rolls the torso this much, about
                                // HEAD_LIVE.pivot — 1.5/5.5 of the head's 9
  breathSwell: 0.008,           // breath 1 swells the torso by this fraction...
  swellPivot: [P.cx, 1700],     // ...about the shirt's hem (`bot`/`botc`)
};
