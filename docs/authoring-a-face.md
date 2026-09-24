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

Facts about the surrounding code, because they constrain what you can write:

- **There is no build step, and that is deliberate.** `packages/avatar/src/` is dependency-free
  ES modules loaded straight into the browser: edit the file, reload the page,
  look. Your module may import from `packages/avatar/src/` and nothing else — not
  `packages/avatar/client/`, no npm package. A face that needs a bundler has
  broken the shape of the project even if it renders.
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

A face module exports `createFace`, `META`, `THEME` and — the value that *is*
how a face is passed around — a record named after the face,
`{ create: createFace, meta: META }`. There is no registry and no name to
resolve. `packages/avatar/src/face-peep.js` and its `.d.ts` are the definition
of each of those; `META` in particular is deliberately minimal, and a landmark
joins it when a second consumer needs it and not before.
**A face must be callable standalone.** Every instrument whose question is about
the *drawing* — the pose sheet, the filmstrip, mocap — reaches the rig through
`mountRig`, which calls `FACES[name].create(mount)` with no mixer and drives
`apply()` from a raw vector; a face that only works under `createAvatar` is
broken.

## The smallest face that works

**`packages/avatar/src/face-peep.js` is the face to read and the rig to author
against.** Copy its shape rather than a listing in a document: the plumbing is
small and the drawing is not, and a module retyped here would be a second copy
of a file that moves.

Rules are hiding in that file, and each one has cost someone a session:

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

A face got up fast on plain `stroke` will look nothing like the house idiom,
which is that nothing is a stroke — see [Art units](#art-units) and `packages/avatar/src/line-art.js`.

### Driving it without a mixer

`makeParams` (`packages/avatar/src/params.js`) fills every channel from `REST`
and applies your overrides on top, so you can name only the channel you are
looking at, hand the result to `face.apply()` and look. That is the whole
harness the instruments use, and
`packages/avatar/src/face-peep-control-plane.js` is the worked example: peep
with all static art deleted and only the elements `apply()` writes left behind,
so the file is a list of exactly which nodes a frame touches.

### The first findings, every time

A face that drops `mouthTuck`, `teethUpper` or `tongue` has dropped precisely
the channels that separate one viseme from another, so on the mouth-detail row
`B` and `G` come out as the same mark and `H` is indistinguishable from `C`. And
art that stops at the frame edge instead of running past it lifts off the bottom
of the frame at `shoulderL/R = 1` and shows ground behind it. Both are in the
checklist.

## Obligations of `apply(params)`

- **Never write `viewBox`.** Parallax and head motion move *art*, never the
  camera. Tooling relies on that to crop safely after `apply()`.
- **Honour the channel's semantic, not its plumbing** — the standing
  `mouthOpen` example is in
  [internal-rig.md § The pose channels](internal-rig.md), with the full
  channel table, rest values, ranges and sign conventions. A face consumes all
  30 and eases none of them.

## Visemes are vectors, not drawings

The headline feature is lipsync, and the most common wrong mental model is that
a viseme is a shape you draw. It is not. `packages/avatar/src/visemes.js` holds `VISEME_SHAPES`
— the Rhubarb letters `A`–`H` plus `X` for silence — and each one is a set of
values for the mouth channels, scaled by loudness and given a `jaw` from
the same arithmetic. The letter never reaches your module. What reaches it is
`mouthOpen`, `mouthWidth`, `mouthRound`, `mouthPress`, `mouthTuck`, `teethUpper`
and `tongue`, retargeted every cue and chased at a ~42 ms time constant, which
is where co-articulation comes from — nothing blends shapes explicitly.

Consequences for the drawing:

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

Rigs built independently converged on the same blocks in the same order — torso
lean → shoulders → parallax layer loop → eyes → brows → mouth → teeth → tongue
— with the same memoizer and the same return shape. That convergence lives in
**`packages/avatar/src/face-core.js`**: the shell and its memoized
`set(node, attr, val)`, `poseTransforms(p, set, el, POSE)`, the shared feature
fragments a rig opts into where its model matches, the constants they all
agreed on, and `faceApi`, the return shape.

What legitimately varies per avatar, and stays in the face module:

- **The `POSE` spec values**: `yawPx`/`pitchPx` (parallax travel), `pivot`, lean
  travel and pivot, shrug lift and tilt degrees, `turnPx` (lateral trunk travel
  at `torsoTurn = 1`), the breath model, plus a `units` factor (see Art units).
  Pupil travel and `lidFollow` strength (0.22 on every current rig, which is
  convergence rather than a shared constant) are literals in the draw function rather than spec fields — eye geometry is per-drawing
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

Then supply one `pitch` block beside the `POSE` constants — the hinge, the neck
base, the two travels and the two compressions — normally found by putting the
hinge at the base of the jaw and reviewing a `NOD_SLOW` strip at tile size.
`peep`'s is the worked one.

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

Units are per-rig — the line faces happen to share a native 760×950 art
space, and a new renderer need not. **Copying a magnitude
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
own intrinsic camera metadata; do not reproduce the crop in CSS or host code.

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

Both halves of the record are required. `create` without `meta` used to be
tolerated, with `viewBox` re-read off the produced svg — a face could ship half
a descriptor and nothing would say so.

**Authoring a face outside this repo** works for the public interface —
`createAvatar({ mount, client, face })` takes any `{ create, meta }` value, and
that is the documented way to add an avatar
([design-avatar-interface.md](design-avatar-interface.md)).
What you do not get is the kit: `face-core.js`, `line-art.js` and `params.js`
are not on the package export map, so an outside module implements `apply()` on
its own. It must still return a real `svg` and carry `ink`/`paper` in its theme,
or mount with `hand: false`. That limit is the reason the faces we ship live
here.

Palettes: there is no barrel `THEME` export — each face module owns its
palette, and `api.theme` returns the mounted avatar's. A host needs it whenever
it paints anything *around* the 4:3 widget, such as the remaining area of a
16:9 call tile. `apps/server/index.html` does the plain version. Reshaping the art to fit a
host's box is the wrong fix; the widget does not control the box.

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

**The checks below are the review, and each is named by what it shows rather
than by a file.** Ours are Studio's instruments, which are not published; the
harness in [The smallest face that works](#the-smallest-face-that-works) is all
any of them is — mount a face, write a pose vector, look — so an outside author
builds the one they need in an afternoon and loses nothing but our styling. Every
one of ours is also a URL that renders headless
([tools/README.md](../tools/README.md)), which is how you review a face with no
browser open and keep a record of what it looked like yesterday. All of them want
your face registered in `packages/avatar/src/faces.js`, so do that first.

- **The pose sheet**, `/pose/` — every viseme, emotion, gaze and channel
  extreme, plus the composites that only fail *in combination*: shoulders ×
  lean × head pose, which is where a rig leaks background from behind the shirt
  if it is going to. Select your face and one other and the sheet is two
  columns, so any difference on screen is the drawing and never the driving.
  Check the **mouth-detail crop row**, not just full heads: two visemes can be
  numerically distinct and visually identical (`G` vs `B` both read as a white
  strip until `G` was rebuilt as nearly-all-teeth). At avatar size a viseme is
  ~40 px tall; letter collisions are invisible on the full-head row. The crop
  row frames itself from your `META.mouthCrop`.
- **The filmstrip**, `/filmstrip/` — phase relationships through the mixer's own
  smoothing, one row per clip, stepped at 1/60 s. The keys are not what the face
  does; the smoothing between them is.
- **A shape held over a face that is still alive**, `/drive/` — the pose sheet
  freezes everything, and a mouth that reads at rest can disappear once the
  idle sway, the blinks and the breath are under it. Pin the channel and watch.
- **The conformance sweep**, `pnpm test` — params finite, `|v| ≤ 2`, svg
  connected, across every state/emotion/gaze/interjection and a viseme track,
  plus `checkHandFraming` against your window and a pass of every hand gesture.
  It also hashes the pose sheet and every filmstrip, so an unintended change in
  either is a failing test rather than a screenshot you forgot to take. What it
  cannot see is *looks* — and look at one hand gesture held at peak extension,
  because figure/ground between hand and shirt is a judgement the framing check
  cannot make.
- **The auto-trace failure modes**, if you traced: zero-margin abutting contours
  open seams under parallax; the trace stops at the source crop; hard horizontal
  edges invisible in the source appear under motion.
- **The 130 px acceptance pass** — downsample the rest pose, the emotions row
  and the X/A mouth crops to ~130 px and judge *there*. Author at close-up,
  accept at tile size: the mouth must still read as smiling (not merely
  present), the emotions must be tellable apart, and X vs A must differ in
  *shape*. Run the fixation audit on the rest tile: name the first things you
  see, in order — the eye/mouth band places no worse than second. (Why:
  [research-perception.md](research-perception.md) §2, §5, §8.)
- **Levelness by mirror** — render rest, flip it horizontally, and compare the
  pair; tilt and lopsidedness pop instantly. Judge on the glasses line and eye
  line. Rest must be channel-neutral and dead level: the mixer adds roll, sway
  and glances at runtime, and a baked-in tilt compounds with all of them.
  Drawing asymmetry (fringe, chin off midline) is welcome; *pose* asymmetry is
  a defect.
- **Worst-case composites, not rest poses, for clearances** — build the extreme
  combination for every pair of marks that move relative to each other
  (brows-down + squint + pitch against a glasses frame; wide-open mouth against
  any under-lip mark) and verify a hard 3–4 unit gap. Near-tangency shimmers
  under animation. If an accessory and a channel collide, the accessory yields.
  Also render one **mid-blink** frame (lids held ~0.5): anything that must ride
  the lid — a lash line — is caught here, not at open or closed.
- **Independent design review** — before a face is called done, a fresh-eyes
  reviewer (not the author) critiques it against the *product brief* at tile
  size, organized around the questions in
  [research-perception.md](research-perception.md): fixation hierarchy,
  resting trust/warmth, neoteny calibration, caricature economy, animation
  head-room, silhouette, long-session comfort. The output is prescriptions
  ranked by perceptual payoff ÷ stroke cost, plus a **protect-list** of marks
  confirmed right — which then stops future churn on them.

## Adding a new avatar

### The staged process

Identity and production quality are different problems; solving them in
stages, with different acceptance bars, is what kept the myna run converging.

- **Stage 0 — identity source.** A stakeholder-supplied reference image is
  the identity spec. Hard lesson (koel, rejected on sight the same day it
  passed every rig check): character identity is judged against a concrete
  image, not against adjectives — a brief-first avatar optimizes the wrong
  target however well it verifies. If there is no reference, get one agreed
  before authoring.
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
- **Stage 3 — independent review** — the *Independent design review* check
  above, then the stakeholder.
  The author does not review their own likeness; anchoring is real. Expect the
  reviewer to find the class of error the author cannot: authored at
  close-up, judged at close-up.

What a face module supplies is the subject of the sections above: the static
art, a `POSE` spec, its feature blocks, `META` with its camera landmarks, and
the exported record. What it gets for free is everything else — the mixer,
visemes, emotions, gaze, idle motion, clips, interjections, the frame-edge hand,
the pose mechanics, the memoizer, and every instrument whose job is comparing
faces, all of which enumerate `packages/avatar/src/faces.js`.

The wren run measured the split: the plumbing steps are mechanical, and the art
and the read of every state at tile size are where the judgement — and the time
— actually go. Static accessories interact with channels: wren's lens rings cap
pupil travel, the exact channel `DISTRACTED` needs most — check your accessory
against the gaze extremes early, not last.

Then run the checklist above, and judge by eye — a passing conformance sweep is not
evidence a face looks right.
