# Authoring an SVG avatar

How to build a face for this project, start to finish, assuming an SVG and no
knowledge of the library. The binding seam is
[internal-rig.md](internal-rig.md) — `apply(frame)`, `destroy()`, and the 30
pose channels every rig renders. This document is the layer beneath it: what an
SVG face module supplies, what `face-core.js` gives it for free, and the staged
process for adding a new character. A non-SVG renderer needs only the rig
contract and can ignore everything here.

Shortest path: read [What you are building](#what-you-are-building), copy
[The smallest face that works](#the-smallest-face-that-works), get it on screen,
then come back. Everything from [Art units](#art-units) onward is about making a
face *good*, which is a much longer job than making one *work* — the plumbing
took an afternoon on both of the faces added since this document existed, and
the drawing took days.

*Living document. Describes the code as of `packages/avatar/src/face*.js` on `main`;
[Adding a new avatar](#adding-a-new-avatar) is the staged process, and CLAUDE.md
§ In flight flags what is about to change.*

## What you are building

One `<svg>`, framed as a 4:3 webcam close-up, inside a `<div>` the host sizes.
In its real setting it is a tile in a video call next to a screen share and a webcam, typically around
**130 px wide** — author close up, accept at tile size, and read
[research-perception.md](research-perception.md) before deciding that a mark is
too small to matter.

Four facts about the surrounding code, because they constrain what you can
write:

- **There is no build step, and that is deliberate.** `packages/avatar/src/` is dependency-free
  ES modules loaded straight into the browser: edit the file, reload the page,
  look. Your module may import from `packages/avatar/src/` and nothing else — not `packages/avatar/client/`, not
  `apps/studio/`, no npm package. A face that needs a bundler has broken the shape of
  the project even if it renders.
- **Roughly sixty times a second the mixer hands you one object of ~30 floats
  and you write it into the DOM.** There is no animation in your module: no
  timer, no `requestAnimationFrame`, no easing, no state that survives a frame.
- **Nothing above the face knows what a face looks like; nothing in the face
  knows what a call is.** If a visual change needs `params.js` touched,
  reconsider; if it needs anything outside `packages/avatar/src/face*.js`, it's a bug.
- **The drawing is generated markup, not an asset.** Every face here is a
  template string built at mount time, so geometry can be computed from
  landmarks and the ink can be re-themed per instance. There is no `.svg` file
  to load and no asset pipeline.

### The module surface

A face module exports four things, and the last one is how it is passed around:

```js
createFace(mount, theme?) -> { svg, apply(params), theme, destroy() }
META  = { viewBox: {x, y, w, h}, mouthCrop: {x, y, w, h} }
THEME = { ink: '#1b1b1b', paper: '#ffffff', … }
export const <yourname> = { create: createFace, meta: META };
```

- `mount` — element to render into. `destroy()` empties it.
- `theme` — optional per-key colour overrides merged over `THEME`; the merged
  object is returned as `theme`. Theme *keys* are per-avatar (all three line
  rigs happen to carry the same 6 — `ink`, `paper`, `accent`, `mouthIn`,
  `teeth`, `tongue` — where the retired rigs shared a ~25-key palette; that is
  what the idiom costs, not a rule). Hosts that paint *around* the widget read
  them off `api.theme` — see [Shipping a face](#shipping-a-face).
- `svg` — the live `<svg>` element. The hand layer appends into it, so it has to
  be the real node and not a wrapper.
- `apply(params)` — write one full parameter vector into the DOM. Called every
  animation frame.
- `META` — the **avatar descriptor**: what a host or tool may know about the
  face without opening it. `viewBox` is the intrinsic 4:3 camera
  (`createAvatar` exposes it as `api.meta`); `mouthCrop` frames the mouth
  for close inspection (the contact sheet's viseme-detail row). Deliberately
  minimal — a landmark joins META when a second consumer needs it, not before.
- The **record** — `{ create, meta }`, named after the face. That value *is* how
  a face is passed; there is no registry and no name to resolve
  ([Shipping a face](#shipping-a-face)).

**A face must be callable standalone.** Three rig-tooling pages —
`apps/authoring/contact-sheet.html`, `apps/authoring/torso-check.html` and
`apps/authoring/clip-strip.html` — call `FACES[name].create(mount)` directly with no
mixer and drive `apply()` from a raw vector; a face that only works under
`createAvatar` is broken.

### What you implement, and what you get free

Of the 30 channels ([internal-rig.md § The pose channels](internal-rig.md)):

| | channels | who renders it |
|---|---|---|
| head, breath, shoulders, torso | 8 | **`poseTransforms` in `face-core.js`**, from a `POSE` spec of named numbers. You write no code for these, only constants. |
| mouth (incl. teeth, tongue, jaw) | 10 | you |
| eyes (lids, squint, pupils) | 6 | you |
| brows | 6 | you |

So the work is twenty-two channels landing on three features, and the shared
module does the body. Everything above that — visemes, emotions, gaze, idle
motion, blinks, gesture clips, interjections, the frame-edge hand, and all
smoothing — belongs to the mixer and arrives already mixed, already clamped,
already smoothed.

## The smallest face that works

Complete, runnable, and deliberately ugly. It passes the conformance sweep and
the hand-framing gate; it fails every judgement in the checklist, which is the
point — the plumbing is small and the drawing is not.

```js
// src/face-sparrow.js
import { clamp } from './params.js';
import { f, createFaceShell, faceApi, poseTransforms } from './face-core.js';
import { viewBoxForHead } from './camera.js';

export const THEME = { ink: '#1b1b1b', paper: '#ffffff' };

const CX = 288;
const VB = viewBoxForHead({ centerX: CX, crownY: 124, chinY: 562 });

export const META = {
  viewBox: { x: VB.x, y: VB.y, w: VB.w, h: VB.h },
  mouthCrop: { x: 190, y: 372, w: 196, h: 116 },
};

// Every number poseTransforms needs. All eight body channels come from here.
const POSE = {
  leanTravel: 23, leanPivot: { x: CX, y: 547 },
  shrugLift: 29, shrugTiltDeg: 1.6, shrugPivot: { x: CX, y: 778 },
  yawPx: 26, pitchPx: 16,
  pivot: { x: CX, y: 677 },
  breathSwell: 0.008, swellPivot: { x: CX, y: 800 },
  turnPx: 14,
  layers: ['head', 'body', 'features'],
  parallax: { head: 1.0, body: 0.1, features: 1.2 },
  torsoLayers: ['body'],
  units: 1,
};

function markup(id, t) {
  return `
<svg id="${id}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">
  <g id="${id}-head">
    <path d="M234 430L234 800L342 800L342 430" fill="${t.paper}" stroke="${t.ink}" stroke-width="10"/>
    <ellipse cx="${CX}" cy="343" rx="176" ry="219" fill="${t.paper}" stroke="${t.ink}" stroke-width="10"/>
  </g>
  <g id="${id}-body">
    <path d="M40 800L48 702Q160 648 288 646Q416 648 528 702L536 800Z"
          fill="${t.paper}" stroke="${t.ink}" stroke-width="10"/>
  </g>
  <g id="${id}-features">
    <path id="${id}-browL" fill="none" stroke="${t.ink}" stroke-width="11" stroke-linecap="round"/>
    <path id="${id}-browR" fill="none" stroke="${t.ink}" stroke-width="11" stroke-linecap="round"/>
    <g id="${id}-eyes">
      <ellipse id="${id}-eyeL" cx="${CX - 69}" cy="305" rx="17" fill="${t.ink}"/>
      <ellipse id="${id}-eyeR" cx="${CX + 69}" cy="305" rx="17" fill="${t.ink}"/>
    </g>
    <ellipse id="${id}-mouth" fill="${t.ink}"/>
  </g>
</svg>`;
}

let uid = 0;

export function createFace(mount, theme = {}) {
  const t = Object.assign({}, THEME, theme);
  const id = `sparrow${++uid}`;
  const { svg, $, set } = createFaceShell(mount, id, markup(id, t));

  const el = {
    head: $('head'), body: $('body'), features: $('features'),
    browL: $('browL'), browR: $('browR'),
    eyes: $('eyes'), eyeL: $('eyeL'), eyeR: $('eyeR'), mouth: $('mouth'),
  };

  function apply(p) {
    poseTransforms(p, set, el, POSE);   // the eight body channels, all of them

    // Gaze translates the pair inside the features layer — never the layer.
    set(el.eyes, 'transform', `translate(${f(p.pupilX * 11)} ${f(p.pupilY * 9)})`);

    // A lid closes by flattening the bean. Squint eats the lower half only,
    // which is why it is a separate channel and not just more lid.
    const lidOpen = (lid, squint) =>
      f(Math.max(1, 19 * (1 - clamp(lid)) * (1 - 0.45 * clamp(squint))));
    set(el.eyeL, 'ry', lidOpen(p.lidL, p.squintL));
    set(el.eyeR, 'ry', lidOpen(p.lidR, p.squintR));

    // raise lifts the whole mark, angle lifts the OUTER end, inner the inner.
    const brow = (outerX, innerX, raise, angle, inner) => {
      const y = 242 - raise * 22;
      return `M${f(outerX)} ${f(y - angle * 16)}L${f(innerX)} ${f(y - inner * 16)}`;
    };
    set(el.browL, 'd', brow(CX - 109, CX - 29, p.browRaiseL, p.browAngleL, p.browInnerL));
    set(el.browR, 'd', brow(CX + 109, CX + 29, p.browRaiseR, p.browAngleR, p.browInnerR));

    // mouthOpen is the VISIBLE APERTURE, not a control-point gap. See the
    // channel semantics note in Obligations below — this is where faces cheat.
    const open = clamp(p.mouthOpen);
    const w = (43 + clamp(p.mouthWidth) * 52) * (1 - 0.45 * clamp(p.mouthRound));
    const h = Math.max(2, open * 52 * (1 - 0.3 * clamp(p.mouthPress)));
    const corner = (p.mouthCornerL + p.mouthCornerR) * 0.5;
    set(el.mouth, 'cx', f(CX));
    set(el.mouth, 'cy', f(426 + open * 9 + clamp(p.jaw) * 10 - corner * 7));
    set(el.mouth, 'rx', f(w / 2));
    set(el.mouth, 'ry', f(h / 2));
  }

  return faceApi(mount, svg, apply, t);
}

export const sparrow = { create: createFace, meta: META };
```

Three rules are hiding in that file, and all three have cost someone a session:

- **Every node you `set()` needs an id, and every id is instance-scoped.**
  `createFaceShell(mount, id, markup)` finds your root by `#<id>` and hands back
  `$('name')` for `#<id>-name`. The `uid` counter is not decoration: the contact
  sheet mounts several dozen instances of one face on a single page, and
  duplicate DOM ids cross-wire them. The memoizer keys on `node.id + attr`, so a
  node with no id shares one cache slot with every other id-less node and its
  writes are silently skipped — which presents as a channel that does nothing.
- **`poseTransforms` owns the `transform` attribute of every layer named in
  `POSE.layers`.** Your own transforms go on groups *nested inside* a layer —
  which is why the eyes here are a `<g>` inside `features` and not `features`
  itself. Writing a layer's transform yourself silently deletes the pose.
- **The viewBox is written once, in the markup, and never again**, with
  `preserveAspectRatio="xMidYMid meet"` and `width:100%;height:100%` so the host
  sizes the mount and the drawing follows. Tooling re-frames by rewriting
  `viewBox` *after* `apply()` and relies on you not touching it.

This skeleton uses plain `stroke` to get a shape on screen fast. The house idiom
is that nothing is a stroke — see [Art units](#art-units) and `packages/avatar/src/line-art.js`.

### Driving it without a mixer

```js
import { makeParams } from './params.js';
import { sparrow } from './face-sparrow.js';

const face = sparrow.create(document.getElementById('stage'));
face.apply(makeParams({ mouthOpen: 0.85, headYaw: 0.4 }));
```

`makeParams` fills every channel from `REST` and applies your overrides on top,
so you can name only the channel you are looking at. That is the whole harness
the rig pages use, and `apps/authoring/control-plane.html` is a ready-made one:
`packages/avatar/src/face-peep-control-plane.js` is peep with all static art deleted and only
the elements `apply()` writes left behind, so you can see exactly which nodes a
frame actually touches. `window.pose({ mouthOpen: .7, teethUpper: 1 })` in the
console of that page.

### What the skeleton does not do

It consumes 27 of the 30 channels. The three it drops — `mouthTuck`,
`teethUpper`, `tongue` — are precisely the ones that separate one viseme from
another, so on the mouth-detail row `B` and `G` come out as the same mark and
`H` is indistinguishable from `C`. It also fails the torso check: at
`shoulderL/R = 1` the shirt lifts off the bottom of the frame and shows ground
behind it, because the art stops at the frame edge instead of running past it.
Both are the normal first findings, and both are in the checklist.

## Obligations of `apply(params)`

- **Consume, don't smooth.** Values arrive already clamped to `RANGE` and
  already smoothed through per-channel time constants. Add no easing of your
  own.
- **Idempotent and cheap.** Same vector in, same DOM out; memoize attribute
  writes (`createFaceShell`'s `set(node, attr, val)`) so an unchanged channel
  costs nothing. ~60 calls/s is the budget.
- **Never write `viewBox`.** Every pose channel is a transform or a path,
  never the camera. Tooling relies on this to crop safely after `apply()`.
- **Honour the channel's semantic, not its plumbing** — the standing
  `mouthOpen` example is in
  [internal-rig.md § The pose channels](internal-rig.md), with the full
  channel table, rest values, ranges and sign conventions. A face consumes all
  30 and eases none of them.

## Visemes are vectors, not drawings

The headline feature is lipsync, and the most common wrong mental model is that
a viseme is a shape you draw. It is not. `packages/avatar/src/visemes.js` holds `VISEME_SHAPES`
— the nine Rhubarb letters `A`–`H` plus `X` for silence — and each one is a set
of values for seven mouth channels, scaled by loudness and given a `jaw` from
the same arithmetic. The letter never reaches your module. What reaches it is
`mouthOpen`, `mouthWidth`, `mouthRound`, `mouthPress`, `mouthTuck`, `teethUpper`
and `tongue`, retargeted every cue and chased at a ~42 ms time constant, which
is where co-articulation comes from — nothing blends shapes explicitly.

Two consequences for the drawing:

- **Distinctness is your problem, not the table's.** Two letters can be
  numerically far apart and visually identical. `G` (lip to upper teeth) and `B`
  (teeth together) differ almost entirely in `mouthTuck` and `teethUpper`; a
  face that ignores those renders one mouth for both. This was a real defect,
  invisible on full heads and obvious the moment the mouth was cropped.
- **The fix is shape, not amplitude.** At 130 px a viseme is roughly 40 px tall.
  Making everything bigger does not separate letters; making them differ in
  outline does.

`META.mouthCrop` is how anyone checks this. Choose it in your own art units as a
rectangle around the mouth at its widest and most open, plus a margin — wide
enough to show the corners at full smile, tall enough to hold viseme `D`. The
contact sheet's mouth-detail row writes it straight into the svg's `viewBox`
after `apply()`, so a badly chosen crop is a row of clipped mouths and nothing
else in the library notices.

## Invariant vs per-avatar

Three rigs were built independently and their `apply()` implementations
converged on the same eight blocks in the same order — torso lean → shoulders
→ parallax layer loop → eyes → brows → mouth → teeth → tongue — with the same
memoizer and the same return shape. That convergence now lives in
**`packages/avatar/src/face-core.js`**, which owns:

- the shell: mount, id-scoped selector, the memoized `set(node, attr, val)`;
- `poseTransforms(p, set, el, POSE)` — lean, shoulders, parallax, driven by a
  per-rig `POSE` spec of named scalars (below);
- the teeth, outright: `pairedTeeth(p, set, el, m)` draws both rows from your
  mouth geometry and owns the dental arch itself. Every rig that has drawn
  teeth here wrote that arch identically, so it takes no spec — every length is
  a fraction of the mouth's own `w` or of the aperture it hangs in, and it
  follows a wider or narrower mouth without being told. It asks five fields of
  `m` (`cx`, `w`, `innerTop`, `innerBot`, `tuck`), which your mouth already
  returns because the clip and the tongue need them. Two further fragments —
  `irisLidEyes` and `browPair` — were removed with the rigs that used them; a
  future rig with sclera and endpoint-pair brows should recover them from git
  history rather than re-derive them;
- the shared constants: lean scale `0.055`, head-roll multipliers ×5.5
  features / ×1.5 torso, shrug/tilt derivation `shrug=(L+R)/2`, `tilt=(R−L)/2`,
  lower-teeth reveal ramp `(open − 0.45) / 0.4`, tongue gate `> 0.02`;
- `faceApi` — the return shape.

And **`packages/avatar/src/face-features.js`** owns the other half of the shared
ground: the feature *laws*, with no drawing in them. Three layers, and the
layering is the whole idea —

1. **the solve** (`face-features.js`): channels plus named scalars in, points
   and numbers out. `lidCurve(E)` is the eye silhouette every rig computes
   identically; `lensPath` draws it, or any two-arc lens inset off it;
   `browDeform(G)` is the brow deformation, and `scaleWidths` spends the width
   multiplier it returns; `mouthContour(S)` is the one closed contour the mouth
   is made of — filled for the interior, outlined for the lips, and used as the
   clip for teeth and tongue.
2. **the marks** (your module): width profiles, brow point lists, which
   optional layers exist at all. This is the drawing and it does not
   generalise. The mouth's width profile is the sharpest case: `taperRing`
   samples a profile across the whole mark, so five stops against nine is
   *topology* rather than amplitude, and the stop count also decides which of
   them are the lip centres. So `mouthContour` takes a `lips(t, c)` from you
   returning `{ profile, halfUp, halfLo }` and owns none of those numbers.
3. **the type** (`packages/avatar/src/face-eyes.js`): `beanEye` fills the lid
   curve and stops; `irisEye` cuts a paper almond out of it and hangs a clipped
   iris inside. Two *compositions* of one silhouette, not one eye behind a
   flag, and a third eye is a third function there. Both take the elements they
   write — never element names — so your module keeps its markup, its ids and
   its paint order, and hands down the nodes. Both hand back the lid geometry
   they solved, which is how myna's lash rides the bean's own top control point
   without recomputing anything.

   **Pick your eye type by the drawing, not by which one sounds better:** does
   your face give the eye a fixed reference frame to move against? wren's
   glasses are one, and a solid bean shifting inside a ring that does not move
   beats structure inside the eye — at the 130 px tile, full-left to full-right
   gaze moves 98 pixels on the bean against 45 on an iris, for the same ink.
   peep's beans move against nothing, so peep needs the iris.

What earns a scalar there is a face that already differs in it — `lidPow` and
`squintGain` on the eye, six gains on the brow. What does not is a knob nobody
turns: the teeth take no spec at all. Where two faces disagree, both state
their number; nothing is inherited by accident.

What legitimately varies per avatar, and stays in the face module:

- **The `POSE` spec values**: `yawPx`/`pitchPx` (parallax travel), `pivot`, lean
  travel and pivot, shrug lift and tilt degrees, `turnPx` (lateral trunk travel
  at `torsoTurn = 1`), the breath model, plus a `units` factor (see Art units).
  Pupil travel and `lidFollow` strength (0.22 on all three current rigs, which
  is convergence rather than a shared constant) are literals
  in the draw function rather than spec fields — eye geometry is per-drawing
  enough that naming it bought nothing.
- **The breath model's numbers**. A rig declares `breathSwell` + `swellPivot`
  and breathes as a *scale about the hem*:
  the shoulder line rises and the chest widens while the bottom of the shirt
  stays put, and the head's matching lift is derived arithmetic
  (`swell × (swellPivot.y − pivot.y)`) rather than a second tuned constant, so
  the two layers cannot drift and the neck cannot telescope. `breathSwell` is
  required. It replaced a rigid vertical slide of the whole shirt, which moved
  *more* pixels and read as *less* alive — a figure translating up and down has
  been nudged, not filled with air.
- **Structural choices**: layer set and parallax table (the retired rigs ran 7
  layers and 4; peep and wren fuse to 4 — the art decides, not a standard); eye
  model
  (iris + 4 lid paths vs peep's single translated group + regenerated bean);
  brow input (endpoint pair vs drawn point list); mouth output (path strings
  vs peep's contour point list); which optional elements exist (`jaw` shade,
  `subLip`, `seam`, split lip edges, lower teeth). A rig whose model diverges
  keeps its own block instead of the shared fragment — peep's eyes and brows
  are the standing example.

Do not chase parity between faces: they are separate drawings, not renderings
of one drawing. A visual improvement lands in one face and stops there.

## The pitch rig — what makes a nod a nod

A face with one `head` group can only translate it vertically for `headPitch`,
which reads as a *bob*. A nod needs the neck to stay behind an independently
movable skull. That is the whole reason this exists; it adds grouping and
calibration, never per-expression replacement paths.

Split the old `head` group in two — `neck` (fill and contour marks, running
behind the collar) and `skull` (ears, silhouette, jaw-under mark, head-locked
hair underlay) — alongside the existing `features`, `hair` and `body`. No paths
need redrawing for a first migration: the neck must simply run behind the skull
far enough to stay covered across its pitch range.

Then supply one `pitch` block beside the `POSE` constants — six geometry
numbers, normally found by putting the hinge at the base of the jaw and
reviewing a `NOD_SLOW` strip at tile size:

```js
pitch: {
  headLayers: ['skull', 'features', 'hair'], neckLayer: 'neck',
  hinge: { x: CX, y: 620 }, neckBase: { x: CX, y: 720 },
  headTravel: 1.0, neckTravel: 0.22,
  foreshorten: 0.040, neckCompress: 0.034,
}
```

`face-core.js` does the rest: the head layers move as one surface about the
hinge and take a small vertical foreshortening, so the silhouette and feature
spacing change at the nod's arrival; the neck moves a fraction as far and
compresses toward the collar; the body stays independent, so its existing
shoulder timing acts as secondary motion. Yaw, roll, lipsync and gaze are
untouched.

A face that supplies no `pitch` block gets the plain vertical translate instead.
`peep` is calibrated and is the rig to author a nod against; `wren` and `myna`
are not.

Accept it when the jaw meets the neck at every sampled `headPitch` with no
background gap or collar leak, and when at production tile size `NOD_SMALL`
reads as an acknowledgement and `NOD_SLOW` as a deliberate receipt without the
face looking squashed. **The helper cannot produce real out-of-plane rotation.**
If a group-level correction still reads as squash, the next escalation is two
authored correction shapes (`pitchDown`, `pitchUp`) for skull, lower face and
neck — not more keyframe tuning.

## Art units

Units are per-rig (the three line faces happen to use a native 760×950 art
space; the Canvas face uses a different design space). **Copying a magnitude
between rigs is silent breakage**: one retired rig's travels were the other's
numbers with `units: S` (S = 2.67) in its `POSE` spec; peep's torso channels
were once ported without conversion and the shoulders stopped reading, while
nothing threw and the conformance sweep passed. The trap inside the
trap: **translations convert, degrees don't** — a rotation is already
unit-independent, which is why `shrugTiltDeg` never takes the `units` factor.

### The camera: 4:3, derived from the drawing

Every shipped avatar uses one composition: **6% headroom, 70% visible head,
24% below the chin**, in an exact **4:3** camera. This is a remote-call crop,
not a bust portrait: it spends pixels on lipsync and listening expression while
leaving enough neck and shoulder for posture to read. A host can choose any
width and obtain the height from 4:3; it never needs to branch on avatar or
renderer.

Do not resize or translate the drawing to meet that composition. Mark three
points in the avatar's own art units and let `camera.js` do the arithmetic:

```js
import { viewBoxForHead } from './camera.js';

const FRAME = {
  centerX: 380, // the head's visual axis, not necessarily the artboard midpoint
  crownY: 117,  // top of the visible hair silhouette at rest
  chinY: 597,   // bottom of the resting jaw silhouette
};
const VB = viewBoxForHead(FRAME);
```

Use the outer hair silhouette for `crownY`, not the skull or hairline hidden
under it. Use the resting jaw for `chinY`, ignoring earrings, loose hair and
clothing below it. `centerX` follows the head, not asymmetric hair or the torso.
These are camera landmarks, so keep them beside `VB`; feature landmarks remain
where the feature geometry is authored.

`META.viewBox` and the root SVG both copy `VB`. `META.mouthCrop` stays in native
art units: a camera change does not change a path, a pose travel, stroke weight,
or inspection crop. The shared frame-edge hand likewise derives its scale from
the standardized head height rather than from camera width.

A non-SVG renderer follows the same rule. Derive the visible design-space
rectangle with `viewBoxForHead`, then encode that rectangle in the renderer's
intrinsic camera metadata. The Canvas rig does this with `cameraMeta` in
`packages/avatar/src/canvas/author/rig.mjs`; do not reproduce the crop in CSS or
host code.

The one thing to fix before anything else is that **the art has to run off the
frame**, not stop at it. Every torso channel moves the shirt, and a shirt drawn
to the frame edge shows ground the first time it leans back or shrugs.

Line-art characters build every mark with `packages/avatar/src/line-art.js` — `taper`,
`taperRing`, `region`, filled variable-width outlines rather than strokes,
because a uniform `stroke-width` with round caps is a rope with a blob at each
end and that is the whole difference between "vector illustration" and "someone
drew this". Width *profiles* are per-character and stay in the face module.

## Shipping a face

Each face module exports its own `{ create, meta }` record, named after the
face. That record *is* how a face is passed — there is no registry to join and
no name to resolve:

```js
// src/face-peep.js
export const peep = { create: createFace, meta: META };

// a consumer
import { peep } from '@voqalize/avatar/faces/peep';
createAvatar({ mount, client, face: peep });
```

Adding a face to *this* repo is four edits, and the first one is worth doing on
day one because every review tool enumerates that table:

1. **`packages/avatar/src/faces.js`** — import your module and add a row to `FACES`. That is
   what makes the face visible to `rig-check`, the contact sheet, the torso
   check, the clip strip, `apps/authoring/tools/baseline.mjs` and the conformance
   sweep in `pnpm test`. `FACE_NAMES` and `DEFAULT_FACE` follow from it;
   `DEFAULT_FACE` stays `peep` unless a stakeholder says otherwise.
2. **A `.d.ts` beside the module**, three lines: `createFace`, `META`, `THEME`
   and the record, typed from `./avatar.js` exactly as `packages/avatar/src/face-peep.d.ts`
   does.
3. **A `package.json` `exports` entry** for `./faces/<name>`, pointing at the
   `.js` and the `.d.ts`. Separate entry points are why importing one face costs
   one drawing.
4. **`apps/studio/src/look.ts`**, only if the face should be selectable in Studio —
   which imports the published subpaths, never `packages/avatar/src/`.

Both halves of the record are required. `create` without `meta` used to be
tolerated, with `viewBox` re-read off the produced svg — a face could ship half
a descriptor and nothing would say so.

**Authoring a face outside this repo** works for the public interface —
`createAvatar({ mount, client, face })` takes any `{ create, meta }` value, and
that is the documented way to add an avatar
([design-avatar-interface.md § Adding an avatar](design-avatar-interface.md)).
What you do not get is the kit: `face-core.js`, `line-art.js` and `params.js`
are not on the package export map, so an outside module implements `apply()` on
its own. It must still return a real `svg` and carry `ink`/`paper` in its theme,
or mount with `hand: false`. That limit is the reason the faces we ship live
here.

Palettes: there is no barrel `THEME` export — each face module owns its
palette, and `api.theme` returns the mounted avatar's. A host needs it whenever
it paints anything *around* the 4:3 widget, such as the remaining area of a
16:9 call tile. `apps/server/index.html` and `apps/studio/src/styles.css` do the
plain version. Reshaping the art to fit a host's box is the wrong fix; the
widget does not control the box. peep has
no dark palette **by decision** (inverting two-value line art recolours the
hair and ages the character; that is geometry wearing a palette's clothes) —
its theme keys stay overridable, but do not add a `dark` selector.

## The hand — a layer no face draws

`packages/avatar/src/hand.js` puts a hand into the bottom of the frame for `GESTURE_*` actions
(protocol side: [internal-mixer.md](internal-mixer.md) § Hand gestures).
It is deliberately **not** part of this contract's parameter space: it writes a
transform on its own `<g>` appended over the face's svg, it has no channel in
`params.js`, and a face that never plays a gesture renders byte-for-byte what
it rendered before. That is the whole reason it could be added at all — a hand
channel only one avatar could draw is precisely the mistake CLAUDE.md names
under **No arms**: *a channel only one avatar can render is the shape of the
mistake, whatever the body part.*

**What a face owes it: a `META.viewBox`, and `theme.ink` / `theme.paper`.**
Nothing else, and no new META field. Placement derives the camera centre and
floor from the window, sizes the drawing against the head's standardized 70%
of camera height, and budgets outboard travel against the camera width. Every
gesture timeline is authored in wrist depth *below the floor* rather than
absolute `y`, so the same drawing lands correctly in different native units.

Two framing rules are asserted, not assumed. `checkHandFraming(meta)` throws if
any keyframe would let the wrist rise into the window (the hand must always be
*cut* by the bottom edge, never end in a floating stump) or let the hand's
rotated width cross the window's side (a hard vertical slice reads as a
rendering fault). The conformance sweep runs it for every registered avatar, so
a new face with an unusual window fails the gate rather than the eye.

If a character's idiom cannot carry it, mount with `hand: false`; a `GESTURE_*`
then plays the face half alone.

## Checklist for a new avatar

Setup, once: `pnpm install` at the repository root (for `pnpm test` and the
headless tools), then serve.

```sh
python3 apps/authoring/serve.py   # never python3 -m http.server; open the URL it prints
                                  # index.html describes every page
```

**Use `serve.py`.** The stdlib server sends `Last-Modified` and no
`Cache-Control`, so browsers apply heuristic freshness and stop revalidating
modules you have edited. That has cost this project three debugging sessions,
one of which produced a module error that was simply a lie. Do not work around
it with `?v=` either — that puts two copies of the module in the graph and
fails differently and worse.

The pages below want your face registered in `packages/avatar/src/faces.js`, so do that first.
Anything on a page can also be rendered headlessly to a PNG —
`apps/authoring/tools/shot.mjs` for one page, `baseline.mjs` for the standard set,
`diff.mjs` to prove a refactor changed no pixel, `motion.mjs` to measure how
much actually moves ([apps/authoring/tools/README.md](../apps/authoring/tools/README.md)).
That is how you review a face without a browser open, and how you keep a record
of what it looked like yesterday.

1. `apps/authoring/rig-check.html` — every registered avatar side by side, driven by
   one command, so any difference on screen is the drawing and never the
   driving. First place to open; also carries the **run sweep** button and
   `window.pose({…})` from the console.
2. `apps/authoring/contact-sheet.html?face=NAME` — every viseme, emotion, gaze and
   channel extreme. Check the **mouth-detail crop row**, not just full heads:
   two visemes can be numerically distinct and visually identical (`G` vs `B`
   both read as a white strip until `G` was rebuilt as nearly-all-teeth). At
   avatar size a viseme is ~40 px tall; letter collisions are invisible on the
   full-head row. The crop row frames itself from your `META.mouthCrop`.
3. `apps/authoring/torso-check.html?face=NAME` — shoulders × lean × head pose.
   These channels only fail *in combination*; this is where a rig leaks
   background from behind the shirt if it is going to.
4. `apps/authoring/clip-strip.html?clip=NOD_SMALL&face=NAME` — phase relationships
   through the mixer's own smoothing, as a filmstrip.
5. `pnpm test` — the conformance sweep: params finite,
   `|v| ≤ 2`, svg connected, across every state/emotion/gaze/interjection and
   a viseme track, plus `checkHandFraming` against your window and a pass of
   every hand gesture. (`apps/authoring/rig-check.html`'s **run sweep** button is the
   same sweep in real time, if you want to watch it land.) It also cannot see
   *looks*; it reaches shoulders/torso
   only through clips, so drive those with a `setOverrides` loop over
   `[-1, 0, 1]` per channel — and look at one hand gesture at peak extension
   (`apps/authoring/body-lab.html?face=NAME&gesture=GESTURE_GREET&at=0.4`), because figure/ground
   between hand and shirt is a judgement the framing check cannot make.
6. Auto-traced art has known failure modes to budget for: zero-margin abutting
   contours open seams under parallax; the trace stops at the source crop;
   hard horizontal edges invisible in the source appear under motion.
7. **The 130 px acceptance pass** — downsample the rest pose, the emotions
   row and the X/A mouth crops to ~130 px and judge *there*. Author at
   close-up, accept at tile size: the mouth must still read as smiling (not
   merely present), the six emotions must be tellable apart, and X vs A must
   differ in *shape*. Run the fixation audit on the rest tile: name the first
   three things you see, in order — the eye/mouth band places no worse than
   second. (Why: [research-perception.md](research-perception.md) §2, §5, §8.)
8. **Levelness by mirror** — render rest, flip it horizontally, and compare
   the pair; tilt and lopsidedness pop instantly. Judge on the glasses line
   and eye line. Rest must be channel-neutral and dead level: the mixer adds
   roll, sway and glances at runtime, and a baked-in tilt compounds with all
   of them. Drawing asymmetry (fringe, chin off midline) is welcome; *pose*
   asymmetry is a defect.
9. **Worst-case composites, not rest poses, for clearances** — build the
   extreme combination for every pair of marks that move relative to each
   other (brows-down + squint + pitch against a glasses frame; wide-open
   mouth against any under-lip mark) and verify a hard 3–4 unit gap.
   Near-tangency shimmers under animation. If an accessory and a channel
   collide, the accessory yields. Also render one **mid-blink** frame (lids
   held ~0.5 via rig-check's `pose()`): anything that must ride the lid — a
   lash line — is caught here, not at open or closed.
10. **Independent design review** — before a face is called done, a fresh-eyes
    reviewer (not the author) critiques it against the *product brief* at
    tile size, organized around the questions in
    [research-perception.md](research-perception.md): fixation hierarchy,
    resting trust/warmth, neoteny calibration, caricature economy, animation
    head-room, silhouette, long-session comfort. The output is prescriptions
    ranked by perceptual payoff ÷ stroke cost, plus a **protect-list** of
    marks confirmed right — which then stops future churn on them.

**The sweep passing is not evidence the face is good.** It catches dead
avatars, NaN leaks and detached SVGs, nothing about how the face *looks*. Every
defect this project has found was found by looking. And param-gate your
sampling: a screenshot at an arbitrary moment catches blinks and saccades, and
three of this project's "findings" turned out to be mid-blink frames.

## Adding a new avatar

Both halves of the old Direction section landed (`packages/avatar/src/face-core.js` and
`META`), and the recipe has been run end-to-end twice: `wren` as the plumbing
proof, and `myna` (2026-08-07) as the proof of the *staged* process below —
which is where the time and the judgement actually went.

### The staged process

Identity and production quality are different problems; solving them in
stages, with different acceptance bars, is what kept the myna run converging.

- **Stage 0 — identity source.** A stakeholder-supplied reference image is
  the identity spec. Hard lesson (koel, rejected on sight the same day it
  passed every rig check): character identity is judged against a concrete
  image, not against adjectives — a brief-first avatar optimizes the wrong
  target however well it verifies. If there is no reference, get one agreed
  before authoring. `lark` (2026-09-05) is the second data point and it is
  *only* a kit measurement, not a character: brief-first again, deliberately,
  to find out what the shared feature modules cost a new face. What they cost
  is nothing — it rendered every channel on the first run — and the four
  passes it then took to draw one collar are the actual answer to how much of
  a face the kit can do for you.

  `egret` (2026-09-05) is the same day's controlled comparison, and it is the
  one worth reading: same kit, same author, same afternoon, the only variable
  being a reference image. Brief-first `lark` needed four passes below the
  chin and its face is nobody in particular. Reference-first `egret` took two
  corrections, and both were caught by *measuring against the bitmap* rather
  than by taste — a mouth built at 0.25 of face width when the reference says
  0.325, and one arc too many under the jaw. The reference does not make the
  drawing easier; it makes being wrong **checkable**, which is a different and
  larger thing. Do not read stage 0 as a formality.
- **Stage 1 — distill, then match.** Extract from the reference: the
  silhouette, the 3–5 identity marks, and the palette structure (where the
  one accent sits). That distillate — not the pixels — is what gets matched
  (peak shift: exaggerate the distinctive, simplify the generic —
  research-perception.md §5). *Measure* proportions off the bitmap instead of
  eyeballing (lens w:h, feature heights as fractions of face height — myna's
  glasses only landed when measured). Hand-author in the idiom; never
  auto-trace. The bar for this stage is the squint test at full size and
  130 px: same person?
- **Stage 2 — production calibration.** The reference *stops being the bar*;
  the brief takes over. This is where the science does the work, all of it
  judged on the 130 px surface: mouth ink floor so warmth survives the tile;
  channel→geometry gains raised until shared emotion poses land (categorical
  perception: near-extreme or invisible); resting brow/mouth set for trust,
  not personality (the smirk composite); resting lid graze against stare;
  interiors calmed against nod-flicker; clearance envelopes at worst-case
  composites; shape-not-amplitude viseme separation. Guardrail: **one neoteny
  move per round** (eye size *or* forehead *or* jaw *or* nose), then re-judge
  — two at once is how a professional assistant becomes a mascot. Note where
  production calibration diverges from the reference rather than silently
  splitting the difference.
- **Stage 3 — independent review** (checklist item 10), then the stakeholder.
  The author does not review their own likeness; anchoring is real. Expect
  the reviewer to find the class of error the author cannot: authored at
  close-up, judged at close-up.

### What a face module supplies

A new face module supplies:

1. **Static art** — the markup function: layer groups, the element table's
   nodes, theme-keyed fills. Hand-authored or cleaned trace; budget for the
   auto-trace failure modes in the checklist if tracing. For a line-art
   character, build every mark with `packages/avatar/src/line-art.js` (`taper`, `taperRing`,
   `region` — filled variable-width marks, width profiles over normalized s);
   the width *profiles* are per-character and stay in the face module.
2. **A `POSE` spec** for `poseTransforms` — the named scalars (travels,
   pivots, bob, tilt degrees), the layer list/parallax table/torso subset, and
   `units`. Start from the rig whose construction is closest and re-derive
   every *travel* in your own units; keep degrees as judgements about your own
   collar/neck geometry, not conversions.
3. **Feature blocks** — the teeth are face-core's; call `pairedTeeth` and draw
   no arch of your own. Recover `irisLidEyes` / `browPair` from git if you draw
   sclera or endpoint-pair brows; write your own where the character disagrees.
   The mouth is always yours: honour the channel semantics in *Obligations*
   above. peep's bean-eye, point-list-brow and contour-mouth generators carried
   into wren as copies with re-derived constants, and then into myna the same
   way — so the third line-art face has now repeated it, and extracting those
   generators into parameterized factories, the way the stroke engine was
   extracted, is live work rather than a contingency. Note what the teeth
   showed about the shape that extraction should take: what came out was the
   *arch*, a law with no per-face numbers left in it, while the width profiles
   and landmark tables stayed in the face module. Expect the same split — a
   shared law, per-face drawing — rather than one implementation with a
   settings object.

   **The eye has been measured, and it does not want to be one feature.** A
   spike (2026-08-30) ported peep's lid-line + aperture + iris model into wren,
   inside the lens rings, to see whether wren's simpler bean could be retired.
   Two results, and they point opposite ways:

   * *The lid curve is already one law, written three times.* wren's `eyePath`
     is exactly peep's `lensPath(eyeGeom(...))` composed — identical path
     strings at every sampled lid, squint and tilt. myna's is the same law with
     two changes it can state as numbers: a 0.6-power lid map and a 0.95 squint
     gain against peep and wren's linear map and 0.7. That is extractable, and
     it is the eye's version of what the teeth were.
   * *The iris stack is not a parameter of it, and must not become one.* At the
     130 px tile the two models carry near-identical ink (839 px against 823
     across the eye band), but the gaze signal is halved: 98 changed pixels
     between full-left and full-right gaze on the bean, 45 on the iris. The
     cause is specific to wren and worth keeping: peep's beans move against
     nothing, so peep needs an iris travelling inside an aperture to say where
     it is looking; wren's bean moves 10 units against a *fixed orange ring*,
     and that reference frame is a stronger gaze cue than any amount of detail
     inside the eye. The glasses are not a constraint wren pays for — they are
     why its simpler eye wins.

   So the eye decomposes as a **lid solve every face shares** plus an **iris
   layer two of the three draw**, and not as one eye with an `iris: true` flag.
   Do not re-run this spike; recover it from git if the numbers need auditing.
4. **`META` and camera landmarks** — `centerX`, visible `crownY` and resting
   `chinY` derive the 4:3 `viewBox` through `viewBoxForHead`; `mouthCrop` remains
   a native-art inspection crop (§ The camera: 4:3, derived from the drawing).
5. **The exported record and its four edits** — `export const <name> =
   { create, meta }` at the foot of your module, plus the `packages/avatar/src/faces.js` row,
   the `.d.ts` and the `exports` entry (§ Shipping a face).
   Nothing resolves a face by name at runtime.

What you get for free: the mixer, visemes, emotions, gaze, idle, clips,
interjections, the frame-edge hand (§ The hand — it needs only your viewBox and
two theme keys), the pose mechanics, the memoizer, and every tool whose job is
comparing faces — `apps/authoring/rig-check.html`, the contact sheet, the torso
check, the clip strip and the conformance sweep all enumerate `packages/avatar/src/faces.js`.
The wren run measured the split: the
plumbing steps (2, 4, 5) are mechanical; the art (step 1) and the read of
every state at tile size (the checklist) are where the judgement — and the
time — actually goes. Static accessories interact with channels: wren's lens
rings cap pupil travel, the exact channel `DISTRACTED` needs most — check your
accessory against the gaze extremes early, not last.

Then run the checklist above, and judge by eye — a passing conformance sweep is not
evidence a face looks right.
