# Brief for an SVG artist

What to draw, where to put it, and what to hand over, so a drawing drops into
this project's rig without being redrawn. Pair it with
[authoring-a-face.md](authoring-a-face.md), which is the engineering side of the
same seam — this page is the half an illustrator needs and none of the half they
do not.

**Start from [`assets/face-template.svg`](assets/face-template.svg).** It is
this page as a drawable file: the grid, the camera crop, the zones you may and
may not touch, and the four artwork layers already named and empty. Open it,
draw into the four layers, delete the layer called **GUIDES**, send it back.

*The short version: draw a head-and-shoulders portrait in flat black line art on
a fixed grid, in four named layers, with centre-lines rather than filled
outlines — and do not draw the eyes, the mouth, or anything you expect to move.*

## 1. What happens to your file

Your SVG is a **source, not an asset.** Nothing loads it at runtime: an engineer
converts your paths into coordinate tables inside a JavaScript module, and the
drawing is rebuilt from those numbers every time the avatar mounts. That is why
the constraints below are strict about *construction* and relaxed about
everything else — no file size limit, no node budget, and you may work at any
zoom you like.

Two consequences worth knowing before you start:

- **Anything you can't express as a path with a width will be lost.** No
  gradients, no filters, no blurs, no opacity, no clipping masks, no embedded
  images, no text.
- **The face is not a still.** Roughly sixty times a second the rig writes a new
  pose into it: the head turns and tilts, the shoulders rise, the chest
  breathes, the brows move, the eyes blink and look around, the mouth speaks.
  Your drawing is the *rest* state of a puppet, and Section 5 is about what that
  costs you.

## 2. Draw / deform / don't draw

This is the part that most often goes wrong. Three categories:

**A. Draw it — we ship exactly what you drew.**
The skull silhouette, hair, ears, neck, the torso and its clothing, the nose,
and any accessory (glasses, earrings, a collar, a zip). This is the character.
It is most of the work and all of the identity.

**B. Draw it at rest — we keep your points and bend them.**
The **brows**, and only the brows. Draw each brow as a single centre-line of
5–9 points. The rig moves those points to raise, lower, angle and knit the brow;
it never replaces them, so your drawn arch survives every expression. Draw the
brows you want at rest and let asymmetry stand — the left and right should not
be mirror images.

**C. Do not draw it — but draw it anyway, for reference.**
The **eyes** and the **mouth**. These are generated from numbers, because they
have to hit sixteen mouth shapes and six eye states continuously. Draw them at
rest, clearly, at full size — we will *measure* your drawing to derive the
numbers, and then delete your paths. Tell us in a note what you intended
(almond? round? heavy upper lid? full lower lip?), because that is the thing the
measurement can miss.

The teeth, tongue and the inside of the mouth are entirely ours. Do not draw
them.

## 3. The grid

All of this is drawn for you in
[`assets/face-template.svg`](assets/face-template.svg) — the table below is the
same information in numbers, for when you want to check one.

Work in a **fixed coordinate space shared by every face in this project**, so
your drawing can be compared against the others without rescaling. Units are
arbitrary "art units"; treat them as a 1000-tall canvas.

| | value | note |
|---|---|---|
| vertical midline | **x = 380** | the face's centre |
| eye line | **y = 386** | four of the five existing faces use exactly this |
| chin (lowest point of the jaw) | **y = 572 – 597** | pick one and stay on it |
| visible top of the head, hair included | **y = 76 – 180** | tall hair sits higher |
| draw the body down to | **y = 950** | far below the crop — see §4 |

Everything else is yours, but here is where the five existing faces put things,
as a sanity range rather than a rule:

| | peep | wren | myna | lark | egret |
|---|---|---|---|---|---|
| brow line | 347 | 342 | 340 | 346 | 344 |
| eye centre spacing (from midline) | ±55 | ±55 | ±56 | ±57 | ±68 |
| eye half-width / half-height | 16.5 / 16.5 | 15 / 17.5 | 17 / 16 | 16.5 / 15 | 17 / 15 |
| mouth centre | 488 | 486 | 492 | 496 | 520 |
| chin below the mouth | 109 | 89 | 80 | 88 | 70 |

Two things that table is really telling you:

- **The eye is small.** 33 units wide on a head 420 tall. Illustrators
  reliably draw them larger; larger reads as a mascot at the size this ships at.
- **Leave chin under the mouth.** The mouth opens *downward*, about three times
  as far down as up, and it needs somewhere to go. Under 70 units and a wide
  "ah" reads as a hole in the jaw.

## 4. The camera, and drawing past it

The visible crop is **derived** from three of your landmarks — the midline, the
visible crown and the chin — by a shared rule (`CALL_CAMERA`): 4:3, with **6%
headroom above the crown, 70% head, 24% body**. You do not draw the crop; you
obey the proportion, and it follows.

**Draw well past the bottom edge anyway.** The torso runs to y = 950 and the
neck to y ≈ 790 in every existing face, while the crop bottom sits around
y = 740. The reason is §5: layers slide independently, and a shape that ends at
the crop edge will slide into frame and show its end.

**Framing to design for:** this is a tile in a video call, next to a screen
share. **It is usually about 130 px wide.** Draw close up, but judge at that
size — export a 130 px preview and look at it before you call anything finished.
A mark you cannot see there is a mark that does not exist.

## 5. Four layers, and why the seams must overlap

Deliver the drawing in four named groups, in this order:

1. **head** — skull, ears, neck, and the jaw's under-shadow
2. **body** — torso, clothing, collar, creases
3. **features** — nose and accessories (the eyes, brows and mouth get inserted
   here by us)
4. **hair** — the whole hair mass, drawn *over* the face

These four **move at different speeds.** When the head turns, the features slide
further than the skull and the hair slides further still, which is what gives a
flat drawing depth. Two rules follow, and they are the ones artists are most
surprised by:

- **Overlap every seam generously.** Where hair meets scalp, where neck meets
  collar, where ear meets head — extend the underneath shape well past the join.
  A perfectly abutting edge will open a white gap the moment the head turns. The
  existing faces draw the hair mass *twice*, once in the head layer and once in
  the hair layer, purely as insurance.
- **Nothing may straddle two layers.** One shape belongs to exactly one group.
  A fringe that is half scalp and half hair will tear.

## 6. The idiom: no strokes, and how to give us width

Every mark in this project is a **filled shape whose width varies along its
length** — thick in the middle, tapering to a point at the ends. Nothing is a
uniform stroke, because a constant-width line with round caps reads as rope, and
the variation is most of what makes the drawing look drawn rather than
generated.

**This is the one place your working method matters.** Do not hand us filled
outlines — we cannot recover a centre-line from a blob. Instead, for each mark:

> Draw it as a **single open or closed path — the centre-line** — and vary its
> width along its length. In Illustrator, the **Width Tool** or a tapered art
> brush does exactly this. Leave it as a live stroke; do not expand or outline
> it.

If your tool cannot vary a stroke width, draw the centre-line at uniform width
and add a note: three to five numbers giving the width at the start, the middle
and the end (for a closed contour: at each quarter). That is precisely the form
we store it in.

Typical weights, for calibration: a head silhouette runs 3 → 15 → 3 units; a
brow 4 → 16 → 7; a nose 2 → 8 → 3; a crease 2 → 6 → 2.

## 7. Palette

**Two colours: black ink and white paper.** Plus **at most one accent**, spent
on exactly one small thing — the existing faces put it on a collar trim, a pair
of spectacle frames, a pair of earrings, a zip pull. A face may also use none at
all.

There is no shading, no grey, no tint, no second black. Interiors are white; the
inside of an open mouth is the *same* black as the outline. Do not design a dark
mode — inverting a two-value line drawing turns black hair white and ages the
character a decade.

## 8. Deliverables

1. **One layered SVG**, started from the template, groups named `head`, `body`,
   `features`, `hair`, marks as live centre-lines with variable width (§6) —
   **with the **GUIDES** layer deleted.**
2. **A rest drawing of the eyes and mouth** (category C), in place, so we can
   measure them — plus a sentence on what you intended by each.
3. **A note of your three landmarks**: midline x, visible crown y, chin y.
4. **A 130 px PNG** of the finished face, so we can both check we agree about
   what survives.
5. **Your accent colour**, if you used one, as a hex value.

## 9. The hard don'ts

- No strokes left uniform where they should taper; no expanded outlines.
- No gradients, filters, opacity, masks, embedded images or text.
- No drawn eyes, mouth, teeth or tongue in the shipped layers (§2C).
- No shape crossing a layer boundary; no seam that merely abuts.
- No symmetry: a face mirrored down the midline reads as machine output. Offset
  the chin a few units, set one brow higher than the other.
- No dark mode, no second palette, no grey.

## 10. What "good" is judged on

Not by us, and not at full size. A face is accepted on the **squint test at
130 px**: is this a specific person, and is it the *same* person as the
reference? Then, separately, whether it can act — whether a smile reads as
warmth and a lowered brow reads as concentration rather than anger, at that same
size.

The most common failure is a beautiful close-up that turns to grey mush in the
tile. Draw fewer, heavier marks than feel right.
