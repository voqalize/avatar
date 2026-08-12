# Contract B — mixer ↔ face (the avatar contract)

*Living document. Describes the code as of `src/face*.js` on `main`; the
[Direction](#direction) section flags what is about to change. The counterpart
contract — what the server drives — is
[contract-protocol.md](contract-protocol.md).*

An avatar is a module exporting exactly this, and nothing more:

```js
createFace(mount, theme) -> { svg, apply(params), theme, destroy() }
META = { viewBox: {x, y, w, h}, mouthCrop: {x, y, w, h} }
```

- `mount` — element to render into. `destroy()` empties it.
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
`AVATARS[name].create(mount)` directly with no mixer and drive `apply()` from
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
- **Honour the channel's *semantic*, not its plumbing.** The channel value is
  what an author of `visemes.js`/`emotions.js` — who never sees your rig —
  thinks they are asking for. The standing example: `mouthOpen` denotes the
  *visible aperture*. peep initially mapped it to the gap between lip
  centrelines; the drawn lip band was ~11 units thick, so the mouth stayed
  visibly shut until 0.25 and two of the nine visemes live below that. The fix
  was to solve back from aperture to control points, not to re-tune the
  visemes.

## The parameter vector

30 float channels (`src/params.js`). Rest is the neutral face; range is the
post-mix clamp; τ is the smoothing time constant the mixer applies (the face
never does). Sign conventions are from the *viewer's* perspective.

| channel | rest | range | τ (s) | means |
|---|---|---|---|---|
| `mouthOpen` | 0.02 | 0..1 | 0.042 | visible vertical aperture |
| `mouthWidth` | 0.42 | 0..1 | 0.042 | narrow..wide (0.42 neutral) |
| `mouthRound` | 0.10 | 0..1 | 0.042 | pucker / protrusion |
| `mouthPress` | 0.15 | 0..1 | 0.042 | lips thinned & pressed |
| `mouthTuck` | 0 | 0..1 | 0.042 | lower lip under upper teeth (F/V) |
| `mouthCornerL/R` | 0.10 | −1.4..1.4 | 0.13 | −frown..+smile |
| `teethUpper` | 0 | 0..1 | 0.042 | upper-teeth reveal |
| `tongue` | 0 | 0..1 | 0.042 | tongue raised into aperture (L) |
| `jaw` | 0 | 0..1 | 0.07 | extra chin drop, lags the lips |
| `lidL/R` | 0.12 | 0..1 | 0.018 | 0 wide open..1 closed; rest grazes the iris |
| `squintL/R` | 0 | 0..1 | 0.12 | lower lid raised (smile/suspicion) |
| `pupilX/Y` | 0 / 0.05 | −1..1 | 0.032 | gaze offset, +right / +down |
| `browRaiseL/R` | 0 | −1..1 | 0.08 | whole-brow lift |
| `browAngleL/R` | 0 | −1.4..1.4 | 0.08 | outer-end up |
| `browInnerL/R` | 0 | −1..1 | 0.08 | inner-end lift (AU1, "concern") |
| `headYaw` | 0 | −1.4..1.4 | 0.16 | + toward viewer's right |
| `headPitch` | 0 | −1.4..1.4 | 0.16 | + chin down |
| `headRoll` | 0 | −1.4..1.4 | 0.16 | + tilt toward viewer's right |
| `breath` | 0 | 0..1 | 0.25 | idle-driven breathing cycle |
| `shoulderL/R` | 0 | −1..1 | 0.19 | −dropped..+raised |
| `torsoLean` | 0 | −1..1 | 0.24 | −back..+forward; reads as scale change |
| `torsoTurn` | 0 | −1..1 | 0.44 | trunk lateral travel, + toward viewer's right |

Groups (`GROUPS`): `mouth`, `smile`, `eyes`, `gaze`, `brows`, `head`, `body`
(breath + torsoLean + torsoTurn), `shoulders` — clips declare group ownership by
them.

`torsoTurn`'s time constant is nearly 3× the head's, and that ratio is load-
bearing rather than taste: the mixer feeds it the *same* target as `headYaw`
(scaled by `TRUNK_FOLLOW = 0.45` in `avatar.js`), so a sustained head turn is
chased by a trunk that leaves late and settles late. Follow-through falls out of
the smoothing the rig already had; there is no second animation system. Shorten
it toward 0.16 and head and trunk move as one rigid piece, which is the puppet
read.

A face should consume all 30. One sanctioned exception exists: peep ignores
`jaw` (its construction has no drawn jaw line to drop — a documented character
decision, not an oversight).

There are deliberately **no arm or hand channels**; see the note in
`params.js` before considering any.

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

- **The `POSE`/`EYES` spec values**: `yawPx`/`pitchPx` (parallax travel),
  `pivot`, lean travel and pivot, shrug lift and tilt degrees, `turnPx` (lateral
  trunk travel at `torsoTurn = 1`), the breath model, pupil travel, `lidFollow`
  strength (0.22 on both current rigs), plus a `units` factor (see Art units).
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

## Registration

`src/avatar.js` holds the registry — `{ create, meta }` records:

```js
export const AVATARS = {
  peep: { create, meta },
  wren: { create, meta },
  myna: { create, meta },
};
export const DEFAULT_AVATAR = 'peep';
createAvatar({ avatar: 'peep' })      // by name
createAvatar({ face: myCreateFace })  // any factory, never registered
```

A bare `face:` factory has no descriptor; `createAvatar` then derives
`meta.viewBox` from the produced svg and `meta.mouthCrop` is absent — registry
avatars always carry the full META.

Palettes: there is no barrel `THEME` export — each face module owns its
palette, and `api.theme` returns the mounted avatar's. A host needs it
whenever it paints anything *around* the widget: every rig is drawn portrait,
so a 16:9 call tile leaves a margin either side of the drawing, and the margin
has to be filled with the rig's own backdrop or the tile reads as a portrait
picture hung in a landscape frame. `demo/call.html` does exactly that — tile
background from `theme.bg0/bg1`, plus a mask feathering the drawing's two
vertical edges, because peep's white shirt is drawn to run off its own frame
and otherwise stops in mid-air. Reshaping the art to fit a host's box is the
wrong fix; the widget does not control the box. peep has
no dark palette **by decision** (inverting two-value line art recolours the
hair and ages the character; that is geometry wearing a palette's clothes) —
its theme keys stay overridable, but do not add a `dark` selector.

## The hand — a layer no face draws

`src/hand.js` puts a hand into the bottom of the frame for `GESTURE_*` actions
(protocol side: [contract-protocol.md](contract-protocol.md) § Hand gestures).
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
