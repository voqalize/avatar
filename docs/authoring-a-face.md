# Authoring an SVG avatar

How to build a face for this project. The binding seam is
[internal-rig.md](internal-rig.md) — `apply(frame)`, `destroy()`, and the 30
pose channels every rig renders. This document is the layer beneath it: what an
SVG face module supplies, what `face-core.js` gives it for free, and the staged
process for adding a new character. A non-SVG renderer needs only the rig
contract and can ignore everything here.

*Living document. Describes the code as of `src/face*.js` on `main`; the
[Direction](#direction) section flags what is about to change.*

An avatar is a module exporting exactly this, and nothing more:

```js
createFace(mount, theme, options?) -> { svg, apply(params), theme, destroy() }
META = { viewBox: {x, y, w, h}, mouthCrop: {x, y, w, h} }
```

- `mount` — element to render into. `destroy()` empties it.
- `options` — authoring escape hatches only, never a host surface. The one that
  exists is `{ pitchRig: false }` on peep, for the comparison lab (see The pitch
  rig). A face may ignore the argument entirely; wren and myna do.
- `theme` — optional per-key colour overrides merged over the rig's palette;
  the merged object is returned as `theme`. Theme *keys* are per-avatar
  (peep and wren carry 8 each; the retired rigs shared a ~25-key palette).
  Hosts that paint *around* the widget read them off `api.theme` — see
  Palettes below.
- `svg` — the live `<svg>` element.
- `apply(params)` — write one full parameter vector into the DOM. Called every
  animation frame.
- `META` — the **avatar descriptor**: what a host or tool may know about the
  face without opening it. `viewBox` is the framing (hosts derive aspect from
  it; `createAvatar` exposes it as `api.meta`); `mouthCrop` frames the mouth
  for close inspection (the contact sheet's viseme-detail row). Deliberately
  minimal — a landmark joins META when a second consumer needs it, not before.

**A face must be callable standalone.** Three rig-tooling pages call
`FACES[name].create(mount)` directly with no mixer and drive `apply()` from
a raw vector; a face that only works under `createAvatar` is broken.

Nothing above the face knows what a face looks like; nothing in the face knows
what a call is. If a visual change needs `params.js` touched, reconsider; if
it needs anything outside `src/face*.js`, it's a bug.

## Obligations of `apply(params)`

- **Consume, don't smooth.** Values arrive already clamped to `RANGE` and
  already smoothed through per-channel time constants. Add no easing of your
  own.
- **Idempotent and cheap.** Same vector in, same DOM out; memoize attribute
  writes (every rig shares a `prev`-map `set(node, attr, val)` helper) so
  an unchanged channel costs nothing. ~60 calls/s is the budget.
- **Never write `viewBox`.** Every pose channel is a transform or a path,
  never the camera. Tooling relies on this to crop safely after `apply()`.
- **Honour the channel's semantic, not its plumbing** — the standing
  `mouthOpen` example is in
  [internal-rig.md § The pose channels](internal-rig.md), with the full
  channel table, rest values, ranges and sign conventions. A face consumes all
  30 and eases none of them.

## Invariant vs per-avatar

Three rigs were built independently and their `apply()` implementations
converged on the same eight blocks in the same order — torso lean → shoulders
→ parallax layer loop → eyes → brows → mouth → teeth → tongue — with the same
memoizer and the same return shape. That convergence now lives in
**`src/face-core.js`**, which owns:

- the shell: mount, id-scoped selector, the memoized `set(node, attr, val)`;
- `poseTransforms(p, set, el, POSE)` — lean, shoulders, parallax, driven by a
  per-rig `POSE` spec of named scalars (below);
- the shared feature fragments a rig opts into where its model matches:
  `pairedTeeth` (peep, wren). Two more — `irisLidEyes` and `browPair` — were
  removed with the rigs that used them; a future rig with sclera and
  endpoint-pair brows should recover them from git history rather than
  re-derive them;
- the shared constants: lean scale `0.055`, head-roll multipliers ×5.5
  features / ×1.5 torso, shrug/tilt derivation `shrug=(L+R)/2`, `tilt=(R−L)/2`,
  lower-teeth reveal ramp `(open − 0.45) / 0.4`, tongue gate `> 0.02`;
- `faceApi` — the return shape.

What legitimately varies per avatar, and stays in the face module:

- **The `POSE` spec values**: `yawPx`/`pitchPx` (parallax travel), `pivot`, lean
  travel and pivot, shrug lift and tilt degrees, `turnPx` (lateral trunk travel
  at `torsoTurn = 1`), the breath model, plus a `units` factor (see Art units).
  Pupil travel and `lidFollow` strength (0.22 on both current rigs) are literals
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

## The pitch rig — optional, and what makes a nod a nod

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

**It is optional.** A face with no `pitch` block keeps the legacy translate, and
`createFace(mount, theme, { pitchRig: false })` forces that path for A/B review
(`demo/rig/pitch-rig-lab.html`). `peep` is calibrated; `wren` and `myna` are not.

Accept it when the jaw meets the neck at every sampled `headPitch` with no
background gap or collar leak, and when at production tile size `NOD_SMALL`
reads as an acknowledgement and `NOD_SLOW` as a deliberate receipt without the
face looking squashed. **The helper cannot produce real out-of-plane rotation.**
If a group-level correction still reads as squash, the next escalation is two
authored correction shapes (`pitchDown`, `pitchUp`) for skull, lower face and
neck — not more keyframe tuning.

## Art units

Units are per-rig (peep 760×950 cropped to `92 76 576 800`; wren and myna the
same window at `92 50`; the retired rigs were 320×400 and a native 1024² cropped to
`179 42 666 832` — note how little the aspect agreed). **Copying a magnitude
between rigs is silent breakage**: one retired rig's travels were the other's
numbers with `units: S` (S = 2.67) in its `POSE` spec; peep's torso channels
were once ported without conversion and the shoulders stopped reading, while
nothing threw and `sweep()` passed. The trap inside the
trap: **translations convert, degrees don't** — a rotation is already
unit-independent, which is why `shrugTiltDeg` never takes the `units` factor.

`viewBox` is not a rig constant. Hosts derive aspect from `META.viewBox` (or
`api.meta.viewBox`); the demos do.

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

`src/faces.js` is the all-three table (`FACES`, `FACE_NAMES`, `DEFAULT_FACE`)
and costs all three drawings, which is the right trade for `rig-check`, the
contact sheet, `sweep` and Studio — tools whose whole job is comparing faces
against each other. It is deliberately not on the package export map.

Both halves are required. `create` without `meta` used to be tolerated, with
`viewBox` re-read off the produced svg — a face could ship half a descriptor
and nothing would say so ([removed.md](removed.md)).

Palettes: there is no barrel `THEME` export — each face module owns its
palette, and `api.theme` returns the mounted avatar's. A host needs it
whenever it paints anything *around* the widget: every rig is drawn portrait,
so a 16:9 call tile leaves a margin either side of the drawing, and the host
chooses that surrounding surface. `demo/call.html` does exactly that — tile
transparent around its artwork, plus a mask feathering the drawing's two
vertical edges, because peep's white shirt is drawn to run off its own frame
and otherwise stops in mid-air. Reshaping the art to fit a host's box is the
wrong fix; the widget does not control the box. peep has
no dark palette **by decision** (inverting two-value line art recolours the
hair and ages the character; that is geometry wearing a palette's clothes) —
its theme keys stay overridable, but do not add a `dark` selector.

## The hand — a layer no face draws

`src/hand.js` puts a hand into the bottom of the frame for `GESTURE_*` actions
(protocol side: [internal-mixer.md](internal-mixer.md) § Hand gestures).
It is deliberately **not** part of this contract's parameter space: it writes a
transform on its own `<g>` appended over the face's svg, it has no channel in
`params.js`, and a face that never plays a gesture renders byte-for-byte what
it rendered before. That is the whole reason it could be added at all — a hand
channel only one avatar could draw is precisely the mistake CLAUDE.md
constraint 9 names.

**What a face owes it: a `META.viewBox`, and `theme.ink` / `theme.paper`.**
Nothing else, and no new META field. Placement derives four numbers from the
window itself — centre `x + w/2`, floor `y + h`, a reach scaled off `w`, and an
outboard limit of `w/2 − 8` — and every gesture timeline is authored in wrist
depth *below the floor* rather than absolute `y`, so the same drawing lands
correctly on windows of different heights. peep's bottom is 876 and wren's and
myna's is 850; all three place identically.

Two framing rules are asserted, not assumed. `checkHandFraming(meta)` throws if
any keyframe would let the wrist rise into the window (the hand must always be
*cut* by the bottom edge, never end in a floating stump) or let the hand's
rotated width cross the window's side (a portrait window pillarboxed in a 16:9
tile slices anything outboard with a hard vertical line that reads as a
rendering fault). `sweep()` runs it for every registered avatar, so a new face
with an unusual window fails the gate rather than the eye.

If a character's idiom cannot carry it, mount with `hand: false`; a `GESTURE_*`
then plays the face half alone.

## Checklist for a new avatar

1. Serve with `python3 serve.py 8777` (never `python3 -m http.server` — its
   caching has burned this project three times).
2. `demo/rig/contact-sheet.html?face=NAME` — every viseme, emotion, gaze and
   channel extreme. Check the **mouth-detail crop row**, not just full heads:
   two visemes can be numerically distinct and visually identical (`G` vs `B`
   both read as a white strip until `G` was rebuilt as nearly-all-teeth). At
   avatar size a viseme is ~40 px tall; letter collisions are invisible on the
   full-head row. The crop row frames itself from your `META.mouthCrop`.
3. `demo/rig/torso-check.html?face=NAME` — shoulders × lean × head pose.
   These channels only fail *in combination*; this is where a rig leaks
   background from behind the shirt if it is going to.
4. `demo/rig/clip-strip.html?clip=NOD_SMALL&face=NAME` — phase relationships
   through the mixer's own smoothing, as a filmstrip.
5. `demo/rig/rig-check.html` → `await sweep()` — conformance: params finite,
   `|v| ≤ 2`, svg connected, across every state/emotion/gaze/interjection and
   a viseme track, plus `checkHandFraming` against your window and a pass of
   every hand gesture. Sweep also cannot see *looks*; it reaches shoulders/torso
   only through clips, so drive those with a `setOverrides` loop over
   `[-1, 0, 1]` per channel — and look at one hand gesture at peak extension
   (`demo/rig/body-lab.html?face=NAME&gesture=HI&at=0.4`), because figure/ground
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

## Adding a new avatar

Both halves of the old Direction section landed (`src/face-core.js` and
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
- **Stage 3 — independent review** (checklist item 10), then the stakeholder.
  The author does not review their own likeness; anchoring is real. Expect
  the reviewer to find the class of error the author cannot: authored at
  close-up, judged at close-up.

### What a face module supplies

A new face module supplies:

1. **Static art** — the markup function: layer groups, the element table's
   nodes, theme-keyed fills. Hand-authored or cleaned trace; budget for the
   auto-trace failure modes in the checklist if tracing. For a line-art
   character, build every mark with `src/line-art.js` (`taper`, `taperRing`,
   `region` — filled variable-width marks, width profiles over normalized s);
   the width *profiles* are per-character and stay in the face module.
2. **A `POSE` spec** for `poseTransforms` — the named scalars (travels,
   pivots, bob, tilt degrees), the layer list/parallax table/torso subset, and
   `units`. Start from the rig whose construction is closest and re-derive
   every *travel* in your own units; keep degrees as judgements about your own
   collar/neck geometry, not conversions.
3. **Feature blocks** — use the face-core fragments where your model matches
   (`irisLidEyes`, `browPair`, `pairedTeeth`); write your own where the
   character disagrees. The mouth is always yours: honour the channel
   semantics in *Obligations* above. peep's bean-eye, point-list-brow and
   contour-mouth generators carried into wren as copies with re-derived
   constants — if a third line-art face repeats that, extract them into
   parameterized factories the way the stroke engine was extracted.
4. **`META`** — viewBox and mouthCrop.
5. **A registry entry** — `{ create, meta }` in `src/avatar.js`.

What you get for free: the mixer, visemes, emotions, gaze, idle, clips,
interjections, the frame-edge hand (§ The hand — it needs only your viewBox and
two theme keys), the pose mechanics, the memoizer, and every host page and rig
tool — the demos' avatar pickers, contact sheet, torso check, clip strip and
`sweep()` all enumerate the registry. The wren run measured the split: the
plumbing steps (2, 4, 5) are mechanical; the art (step 1) and the read of
every state at tile size (the checklist) are where the judgement — and the
time — actually goes. Static accessories interact with channels: wren's lens
rings cap pupil travel, the exact channel DISTRACTED needs most — check your
accessory against the gaze extremes early, not last.

Then run the checklist above, and judge by eye — passing `sweep()` is not
evidence a face looks right.
