# Experiment: hand gestures at the frame edge

**Question.** Do HI / BYE / THUMBS_UP / ONE_MOMENT read better with a hand than
with face-and-shoulders alone — without re-adding the forearm/hand chain that
was removed on 2026-08-05 ("the hands and fingers just looked super weird")?

## Where this cut came from

The first cut built a hand on the end of a sleeve and raised the whole assembly
beside the ear. The second replaced it using the stakeholder's own webcam
observation:

> ONLY the fingers and perhaps the fist/palm showed up. As a right handed, the
> motion started from bottom centre of the screen. For thumbs up — it just came
> up vertically and stopped around my nose. For a wave, it followed an arc from
> bottom to the right, perhaps 1/3rd or a bit higher from the bottom of the
> screen. The arm wasn't ever visible — it felt unnatural to do so.

The **third cut** is a response to the second being rejected on the drawing:

> Hand needs to be better visualized. Thumbs up gives the "middle finger" vibe.
> […] thumbs up / palm needs distinction between front-of-hand (waving) and back
> of hand (thumbs up implies back of hand is camera facing). Go on doesn't work
> for me.

Every rendered frame then went past an independent visual-artist review. Its
three findings are the ones that reshaped `arm.js`, and they are recorded at the
top of that file. What changed here is the drawing and the framing; the webcam
rules from the second cut all survive.

The **fourth and fifth cuts** answer the next note:

> The hand wave motions is trending in the right direction, but needs more
> refinements and improvements. Duration needs to be adjusted, hand shapes needs
> artistic refinement. […] Take a static screenshot at the terminal state where
> the hand is visible at its max. Ask an artist […] Review the speed and
> duration. I feel that it is a bit slower and it lingers for a bit longer than
> I'd think.

Two separable pieces of work, and they are documented separately below: **the
timing** (all four gestures now run 25–30% shorter, and the shape of the curve
changed more than the total did) and **the drawing** (a second artist review, on
peak-extension stills cropped to the hand alone, at full size and at 130 px).

## The four rules

1. **The wrist never enters the frame** (`WRIST_FLOOR = 900`; the visible edge is
   876). Every gesture is posed by wrist position, so the hand is always *cut* by
   the bottom edge and never ends in a stump in mid-air. Each shape carries a
   long tail below the wrist that the crop eats, and the ink outline is an
   **open** `taper` mark rather than a closed ring — a closed ring would draw a
   lid line across the wrist and give the crop away. The paper fill is the closed
   `region` of the same contour, so fill and ink disagree on purpose.
2. **The hand is big, and how big is a depth question.** `REACH = 2.95`. The
   third cut raised it to 3.4 and that unblocked everything else; the fourth
   walked it back — see below.
3. **Only ever a digit passes the mouth.** Mouth sync is the headline feature
   (brief, constraint 2), so nothing parks over the lips.
4. **The only edge that may cut the hand is the bottom one.** peep's viewBox is a
   portrait window pillarboxed inside a 16:9 tile, so ink past x=668 is sliced by
   a hard vertical line that reads as a rendering fault. `checkFraming()` walks
   every timeline in 20 ms steps, rotates the real geometry, ignores whatever is
   below the frame edge, and throws on the true worst case. The page calls it on
   load. This is rule 1's sibling: both were being eyeballed, and both were being
   violated.

## What actually fixed the thumbs-up

Two obvious repairs failed first, and the reason is worth keeping.

Shortening the thumb did not work. Neither did widening it. The fist they sat on
was drawn at **face depth** — a 19 cm hand against a 23 cm head — so only its top
third ever cleared the frame, and a correctly proportioned thumb still looked as
long as the visible mass it grew from. Proportion is read against what is *on
screen*, not against the anatomy.

The hand had to get bigger. A hand raised to a webcam sits roughly 40 cm from the
lens with the face at 60, so it images about 1.5× larger than a hand at face
depth: ~590 art units wrist-to-fingertip, not 440. At that size the fist has
enough mass to read *as* a fist, and only then does a stubby thumb look stubby.

The finished proportion is the emoji's: the part of the thumb clearing the
knuckles is about **as wide as it is tall** (32 units against 42), and its base
is buried across 32 units of the fist. That long-thin vs. short-fat contrast is
the whole difference between ONE_MOMENT and THUMBS_UP at 130 px, which is the
only place it has to survive.

**And the base has to be inside the mass, not beside it.** Three cuts got this
wrong in three different ways, and the diagnosis was the same every time: a thumb
whose base sits outside the fist's silhouette is not a thumb, it is a *neighbour*.
As a long lozenge on the flank it detached into a second object; as an egg
tangent to the knuckles it read as a raised finger and turned the gesture back
into ONE_MOMENT. It now emerges from the *crest*, with shallow notches on both
sides — a stub on top of a mass, which is what the emoji is.

**The visible fist must be wider than it is tall.** Drawn 75 wide against 90
tall above the frame cut it is not a fist, it is a tower — and a crest that
ramps monotonically to a single spike at the index knuckle is its steeple. Both
reads were unmistakable at full size, and neither is fixable by adjusting the
thumb. 82 wide against 78 visible, with the crest arcing 16 units across 60
rather than 30, is what made the thumb legible at all.

**The thumbs-up tops out at the jaw, not the nose** — a deliberate departure from
the stakeholder's report. With the wrist pinned below the frame, nose height is
unreachable without drawing the thumb longer than a middle finger, which is
precisely what the second cut did and precisely why it read as one. Their webcam
framed more than a head and shoulders; this portrait window does not.

## Palmar vs. dorsal

Two hand families, built only from cues that survive the acceptance size:

|          | palmar (palm to camera)      | dorsal (back to camera)       |
|----------|------------------------------|-------------------------------|
| webs     | smooth, shallow U            | bumpy knuckle row             |
| base     | wide soft-cornered heel      | straighter, narrower          |
| thumb    | out and clear of the fingers | rising from the fist's crest  |
| interior | palm crease + finger seps    | one curl line                 |

`HI`/`BYE` are palmar; `THUMBS_UP`/`ONE_MOMENT` are dorsal. Cut on the review's
advice because none of them survive 130 px: finger creases, tendon lines, knuckle
bulges on extended fingers.

The open hand also has **three** finger masses, not four — ring and little are
one shape — and every white gap is at least as wide as the ink beside it. The
second cut's measured gaps of 1 px and 5 px became 0.2 px and 0.9 px at the
acceptance scale and fused into a smear.

**The valleys moved back up, and the information moved inboard.** They were cut
at 40–45% of finger length; at that depth the silhouette is a saw, and a saw of
white prongs above a mass is a crown or a claw, not a hand. They are now ~15% of
finger length and drawn as a **U with a floor**, never a V with a point — and
the separation they used to carry is carried instead by three short interior
tick marks that stop well short of the web. Information belongs in interior
marks; the silhouette's job is to say *hand*. Fingertips are domed for the same
reason: a pointed tip is a claw, and this is a friendly character.

## Why the waves sit low and small

At true near-lens scale an open palm is 65% of the frame's width. It cannot be
moved out of the face's way, because rule 4 forbids that much sideways travel —
so it has to sit **lower and further back** instead. Each gesture carries an
`sc` depth factor multiplying `REACH` about the wrist; the waves render at 0.70,
everything else at 1. You push a thumbs-up toward the lens and throw a wave out
to the side, so this is an observation, not a fudge. Without it the palm covered
the whole face at every height it could legally occupy — a mouth-sync
regression, which is a hard no.

## Why `REACH` came back down to 2.95

The third cut's 3.4 was *optically* honest: a hand near a webcam really does image
larger than the face behind it, and 3.4 put the palm at about 1.05 head-widths.
The fourth cut walked it back anyway, and the argument is not an optical one.

At 130 px the viewer gets **one glance**, and the largest brightest mass in the
tile becomes its subject. When that mass is an information-free white slab, the
composition inverts: the hand becomes the figure and the head becomes ground, and
the tile reads as *broken* before it reads as a gesture. Optically correct,
perceptually wrong. 2.95 puts the palm at about 0.82 head-widths — the top of
the 0.75–0.85 band the review asked for, and short of the 2.4 it suggested,
because 2.4 would have undone the third cut's hard-won finding that a fist at
face depth has no visible mass to read a thumb against.

Note what did **not** come back with the old number: the knuckle row stays high,
because that fix was about the *visible* mass, not the scale.

## The timing, and why the curve mattered more than the total

The note was *"a bit slower, and it lingers a bit longer than I'd think"*, and
that is two complaints. Reading the timelines back found three separable faults,
only one of which is duration:

1. **The rise eased in *and* out**, over 420–470 ms. A limb does not do that. A
   raised hand is ballistic — most of the travel happens in the first third and
   the arrival is a brake. The first key now sits at ~55% of travel in ~150 ms,
   which is the same argument `gaze.js` already makes for head-follow: *the stop
   is the cue that attention landed*.
2. **The hold was ~1 s on all four**, which is where the lingering actually
   lived. It is now roughly half that. A backchannel that outstays the beat it
   answers stops being feedback and becomes a state.
3. **The exit decelerated into the frame edge**, so the hand crawled the last
   quarter of the way out and the gesture had no end. It now covers under 20% of
   its travel in its first third, and it is the shortest phase of the gesture.

Wave rate went 2.4 Hz → 3.0 Hz (`HI`) and 2.0 → 2.8 (`BYE`), still under the
~1.5 Hz ceiling CLAUDE.md sets for *nods* — a wave is a different mark, and a
2 Hz wave reads as tired. `BYE` stays the slower and wider of the two and buys
its extra weight with a **fourth swing** rather than with a longer hold, which is
the difference between a farewell and a stall.

| gesture      | was    | now    |
|--------------|--------|--------|
| `HI`         | 1700   | 1250   |
| `BYE`        | 2100   | 1550   |
| `THUMBS_UP`  | 1800   | 1300   |
| `ONE_MOMENT` | 2200   | 1700   |

## GO_ON was cut, not redrawn

The stakeholder rejected it and the review agreed, for structural reasons rather
than tuning ones: a real "go on" is a **finger curl**, and nothing in this
vocabulary can curl a finger; a splayed open palm at that height reads as *stop*,
which is the opposite instruction; and the face already carries the backchannel
well. The face-only `GO_ON` interjection clip in `src/interjections.js` is
untouched — only the hand version is gone. `arm.js` records the one design that
might work (a fingers-together palm-up scoop) without building it.

## What is here

- `arm.js` — the whole experiment: three hand shapes (`PALM`, `FIST`, `POINT`)
  authored as on-curve point lists through a Catmull-Rom `smooth()`, four gesture
  timelines on three channels plus `sc`, and `createArm(api, {dir, face})`, which
  appends the overlay into a mounted avatar's own SVG and paints with its theme
  keys.
- `index.html` — the real peep via `createAvatar`, plus the overlay, plus a
  second live rig at 231×130 beside it because that is the size the gesture is
  accepted at.

Nothing in `src/`, `demo/`, `docs/` or `tools/` changed, and no parameter channel
was added — a channel only one avatar can render is the documented mistake to
avoid. The body motion is not invented here either: each gesture names an
existing interjection clip in its `face` field and `createArm` plays it through
the public `api.interject`. Those clips already move head, brows, shoulders and
torso; the hand is the missing half of a gesture the rig has always half-played.
`?face=0` plays the hand with the body still, which is the A/B for what that
buys.

## Run it

```
python3 serve.py 8777
open http://localhost:8777/experiments/arm-gesture/
```

Four buttons, plus **Other hand** to flip handedness live. Both tiles play
together, so every gesture is judged at 130 px in the same glance.

Manual mode is the body-lab idiom — seeded RNG installed before module import,
`{manual:true}`, `window.stepTo(t)` in 1/60 s ticks — so filmstrips are
reproducible pixel-for-pixel:

```
experiments/arm-gesture/index.html?manual=1&gesture=HI&at=400&seed=7[&side=-1][&face=0]
node tools/shot.mjs 'experiments/arm-gesture/index.html?manual=1&gesture=HI&at=400' \
  --wait 'window.ready && (window.stepTo(0.88), true)' --selector '#tile' -o hi.png
```

## Other decisions, and the renders that forced them

- **Fingertips need two points each.** With one, the spline corners the tip and
  the hand reads as a claw.
- **Rings are painted UNDER the main outline.** With the thumb on top, its closed
  contour ran unbroken from the frame edge to the tip: the middle-finger
  silhouette, rebuilt out of correct parts.
- **The thumb's base sits well inside the fist** — see above; three cuts and
  three different failure modes, all of them the same mistake.
- **A short crease near the top of a rounded white form beside a face reads as a
  CLOSED EYE.** The third cut's thumbnail plate did exactly that, and the tile
  had two faces in it. Deleting it is the clearest single deletion in this
  experiment: one mark, and it was inventing an expression.
- **Four small knuckle bumps read as a lapel zigzag.** They were drawn at the
  same scale and rhythm as peep's hair spikes, so at 130 px the row continued the
  collar and the fist stopped being a hand and became clothing. Two large soft
  undulations say *knuckled* without colliding with a mark the character already
  owns.
- **The halo is tail-only.** White under-ink wider than the ink *only* at the
  tails, so shirt seams are broken where the hand crosses them without a white
  rim appearing where the hand sits against the background — which would read as
  a cut-out sticker.
- **Line weight is the light direction.** Thin across the fingertips, thick down
  both tails: upper-left light, and it also caps the hand below the face
  contour's weight. Widths are *not* scaled by `REACH` — perspective enlarges the
  hand, not the pen.
- **Every gesture starts at `out = 0`**, from bottom centre, and finds its
  position on the way up. That is the single most recognisable thing the webcam
  observation gave us.
- **Handedness is a mirror, not a second drawing** (`scale(-dir·sc, sc)`), so the
  thumb always splays away from the body.
- **Holds breathe and rises overshoot.** The second cut's holds were
  pixel-identical for four and five frames running, which reads as a frozen
  render rather than as stillness.

## The figure/ground problem, and what is left of it

The review's largest single item was that the hand is a **white form against
another white form** — peep's shirt — with nothing between them but a contour,
and it called moving the hand off the shirt 60% of the fix. That turned out to be
only partly available: the portrait window is 576 art units wide, the only beige
region beside the head is about 138 units wide, and the hand is about 230. There
is nowhere for it to go. So the hand was pushed as far outboard as rule 4
permits (`checkFraming()`'s worst case now runs 217–279 against a limit of 280)
and the rest of the load moved onto the devices that were available:

1. **Weight hierarchy.** The near form's contour is decisively heavier than
   anything behind it and varies along its length — 16/9/17 against the shirt's
   uniform seam.
2. **Knockout.** The halo breaks the shirt seams the hand crosses.
3. Spot black was unavailable (peep's hair is the only spot black in the
   drawing) and hatching is excluded by the no-strokes rule.

What is left: peep's own collar line still stubs out where the fist crosses it,
because the halo is thin at the crest by design. It is a 1–2 px artifact at the
acceptance size. Fixing it properly means knocking the shirt seam out inside the
face module, which this experiment is not allowed to touch.

## Judgement (2026-08-07, fifth cut — peak stills at full size and at 130 px, filmstrips, live click-through clean)

- **ONE_MOMENT** — still the strongest of the four and the reference. One long
  thin digit against one broad mass; unmistakable at 130 px.
- **THUMBS_UP** — reads, after three attempts. A wide knuckled mass with a
  rounded thumb rising from its crest and shallow notches either side. The
  middle-finger read the stakeholder rejected is gone, and so are the fourth
  cut's two new failures (a detached lozenge, then a raised finger).
- **HI / BYE** — read as an open hand: three domed finger masses, the thumb lobe
  at the outboard corner, shallow U webs, three light separator ticks and the
  palm crease. Both now sit far enough outboard to leave the whole face clear.
  Whether they read as a *wave* still depends on the swing, which a still cannot
  show — but the swing is now 3.0/2.8 Hz rather than 2.4/2.0.

## Open questions for the stakeholder

1. Does this clear the bar the 2026-08-05 articulated hands failed?
2. The thumbs-up stops at the **jaw**, not the nose, for the geometric reason
   above. Acceptable, or is the height worth buying by other means?
3. Are the new durations right? 1250–1700 ms end to end, with a ~500 ms hold. The
   next lever if they are still long is the hold, not the rise or the exit.
4. The waves are drawn smaller and lower than the other gestures (`sc = 0.70`)
   so they never cover the face. Right call, or should a wave be as big and as
   high as the thumbs-up even at the cost of the mouth?
5. GO_ON stays cut?
6. If accepted: wire design — server-sent actions only, or an optional "hand"
   variant on the existing interjection IDs (all four already exist as face-only
   clips)?
7. Handedness default: is `dir = +1` right, and is the flip worth exposing at
   all, or is one consistent hand the feature?
