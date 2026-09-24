# Head rotation on a 2.5-D face

Research and measurement behind the 2026-09-14 head-motion sprint
(the plan and tracker that consumes it are not published).
The owner's report, verbatim: *"The nod is completely wrong. The biomechanics is
just wrong. It is almost as if the head is translating down / The sideways
movement of the neck is wrong."* They also asked to *"learn from Live2D — what is
it that they do? We need limited motion to look natural and believable."*

This page holds what the literature says a head does and what Live2D does to
fake it. A research page may name things the code does not have. Numbers marked
*unverified* are waiting on a second source.

## 1. The short answer

A drawn 2.5-D head reads as **rotating** only when its parts move by different
amounts. The ears and the back of the skull nearly stay put. The outline moves a
little. The features move most, and the nose moves more than the eyes.

Under an orthographic camera, a point's screen motion is its depth in front of
the rotation axis times sin θ. So the *differential* is the rotation cue: if
every part sits at a similar depth, every part moves by a similar amount, and
the eye reads that as **translation**.

tara's features are already near anatomical depth. The **frame is not**:
- Ears, crown, side hair and the cheek and jaw outline sit 0.31–0.46 in front
  of the pivot.
- Anatomically the crown and the ear rim sit at or just behind the ear canal,
  and the cheek and jaw outline 0.12–0.20 in front of it (§ 2.2).

So on a nod, the whole head drops as one block, which is exactly the owner's
*"translating down"*. The neck fails for a related reason: it swings with the
head and shears, where it should twist under it.

## 2. The anatomy

### 2.1 Axes

- **Pitch (the nod).**
  - Flexion concentrates at the craniovertebral junction. C0–C1 contributes
    about 18.6° of flexion–extension (Bogduk & Mercer 2000).
  - The axis sits **behind and below the ear canal**:
    - Moore 2005 (J Vestib Res, PMID 15951621) measured the nod axis of
      seated 1 Hz nods at 6 mm behind and 21 mm below it, and closer to the
      ear canal at 2 Hz.
    - Chancey 2007 (J Biomech, PMID 17466312, cadaver) puts the C0–C1 centre
      of rotation 22.5 mm behind and 22.6 mm below. That joint does 45% of
      flexion and 71% of extension.
    - Medendorp 1998 (PMID 9535966): the axis drops lower as the amplitude
      grows.
    - An earlier draft of this page said "below and slightly in front". That
      was wrong.
  - The head also translates "even in the first degrees" (Ferrario 1997,
    PMID 9183030), so the axis is effective rather than fixed.
  - The per-level share of yaw is still open: Anderst 2015's full text returns
    403, and Anderst 2017 and Guo 2021 cover the same question.
  - Small nods are mostly this joint; Como 2024 (PMID 39084063) gives its
    living range as 17.9°. Big nods add lower-cervical flexion, which also
    carries the head forward.
  - For nods of 10° or less the effective pivot is 0.03–0.12 behind and
    0–0.12 below the ear canal (inferred from the above). The ear canal
    therefore moves about 21 mm × sin θ: roughly 2 mm at 5° and 4 mm at 10°.
  - Consequence: in a small nod the ear barely moves, the crown barely moves,
    and the chin travels down and back.
- **Yaw.**
  - Moore 2005 puts the yaw axis 10 mm behind the ear canal.
  - Within ±20°, C1–C2 turns nearly 1:1 with the head (Anderst 2017, J
    Biomech, PMID 28662932). At a full 73.6° turn it supplies 36.8°, with
    9.8° of coupled bend away from the turn. Guo 2021 (PMID 34038861) splits
    it 71.3% to C0–C2 and 18.6% to C2–T1.
  - So a small turn is nearly all C1–C2, about a vertical axis roughly 0.05
    behind the ear canal.
  - The neck below C2 twists progressively. It does not swing as a rigid
    block.
- **Roll (lateral bend).**
  - Roll is lower-cervical. It is spread down the neck at 1.6–5.7° per level
    (Ishii 2006, PMID 16418633), each level rotating about a point in its
    vertebral body (PMC8905756).
  - The roll centre for a small tilt is therefore 0.3–0.6 below the ear
    canal (inferred; low-to-medium confidence). For a drawn head the chin is
    the practical pivot, and that is where Live2D puts it (§ 3).
  - Coupling with yaw is weak near level. The upper and lower neck bend in
    opposite directions, so the net tilt is about 4.6° at 55° of turn (Guo
    2021). It scales with pitch × yaw (PMC11687854). Use 0–0.08° of tilt per
    degree of turn, away from the turn.

### 2.2 Depth in front of the ear plane

Anatomical targets for motion depth, in tara's face units (1 unit ≈ 190 mm),
measured in front of the ear canal (the tragion).

**Source.** The NIOSH/ISO digital headforms (data.cdc.gov dataset c2hx-eeis),
small, medium and large. They are aligned to the Frankfurt plane with the origin
midway between the tragions. The front-view outline and the landmark depths were
measured off them by the second research agent on 2026-09-14. The scalp is
synthetic and has no hair.

The pivot column adds 0.05, because the nod and yaw axes sit about that far
behind the ear canal (§ 2.1). That column is what tara's `PIVOT` should be
compared against.

| part | in front of the ear canal | in front of the pivot | confidence |
|---|---|---|---|
| crown outline | −0.09 to 0 | ≈ 0 | medium |
| side of skull, side hair | −0.05 to 0 | 0.00–0.05 | medium |
| ear, as the outline (rim) | −0.16 to −0.04 | ≈ −0.03 | medium |
| cheek to jaw-angle outline | +0.12 to +0.20 | ≈ 0.21 | medium |
| jaw edge, side to midline | +0.17 to +0.33 | 0.22–0.38 | medium |
| outer eye corner | 0.40–0.48 | ≈ 0.49 | medium |
| iris | 0.44–0.50 | ≈ 0.52 | medium |
| mouth corners | 0.42–0.50 | ≈ 0.52 | medium |
| brow, glabella | 0.49–0.52 | ≈ 0.56 | high |
| lips | 0.50–0.56 | ≈ 0.59 | medium-high |
| chin underside | 0.34–0.41 | ≈ 0.42 | medium |
| chin front | 0.47–0.53 | ≈ 0.55 | high |
| nose tip | 0.60–0.65 | ≈ 0.67 | high |

- The cheekbones (zygion) never reach the front-view outline.
- The headforms' eye surface is a smoothed, closed lid, so it is an upper bound
  for the cornea.

**Superseded.** The first agent's table put the ear at 0, the crown at 0.03 and
the outline at 0.10 (0.05–0.13). The headforms say the outline is deeper and the
crown and ear rim shallower. An even earlier estimate put the chin at 0.56, the
nose at 0.68 and the mouth at 0.59.

**tara against this table.** Her features are about 10% shallow: the nose is
0.597 in front of the pivot against about 0.67. That is a uniform scale and does
not change the reading, so the features stay. The frame is what is wrong.

### 2.3 Amplitudes

- **Speech.**
  - Busso et al. 2007 give per-sentence standard deviations for neutral
    speech: pitch 3.3°, yaw 0.9°, roll 0.8°. tara already matches these (see
    the rig programme, which is not published).
  - A second Busso figure, a per-sentence range of 9.54° on the α axis,
    cannot be assigned to an axis:
    - Neither Busso 2007 nor Busso 2005 says which of α, β, γ is pitch. Both
      call them Euler angles, and Figure 1's labels are illegible.
    - α is probably pitch, because its neutral range (9.54°) is four times
      the other two (2.31° and 2.27°).
    - It stays *unverified*: neither paper defines the axis labels, so
      [research-biomechanics.md](research-biomechanics.md) § 3.8 carries the
      proportions and treats the range as indicative.
- **Turning to look at something.** Head rotation undershoots target
  eccentricity with a slope of about **0.6**, and in multi-talker listening
  heads settle **10–15° short of the target talker**. The eyes make up the
  difference, so a head that fully faces what it is attending to is wrong
  before any question of amplitude arises — and the head and the eyes must be
  *allowed* to disagree, which a full-gain VOR removes. A tight yaw envelope is
  therefore not fighting the research: it is short of a target the head would
  have undershot anyway.
  ([Frontiers in Psychology 2023, *Head movement and its relation to hearing*](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full))
- **Backchannel nods.**
  - Blomsma 2024 (Language & Cognition): nods at backchannel opportunities
    average **5.95° peak-to-peak**, about 1.9° larger than elsewhere.
    Per-person averages run 3.3–9.7°.
  - Kato 2026 (arXiv 2607.12329): the mean range is 0.0706 rad, about 4.0°.
    - 51% of nods are one cycle, 33% two and 16% three or more.
    - 76% start downward. A continuer is "a single small nod".
    - Upward-first nods are larger and come with new information and at turn
      ends.
  - Mori 2022: upward-first marks a change of state ("oh, I see").
    Downward-first goes with continuers and known information.
  - Mori 2025 (PLOS One, PMC12097566): within one cycle the down and the up
    are "nearly identical in magnitude". In a repeated nod the first cycle is
    the largest and later ones shrink.
  - Bauer 2024 (PMC11139280, German Sign Language as a proxy): agreement nods
    are larger and faster than feedback nods. Single small nods last 0.61 s on
    average, single large ones 0.79 s.
  - Poggi: a continuer is a "brief fast repeated downward movement";
    agreement is "single, ample and stressed".
  - Hadar et al. 1983 find listener nods narrow compared with speaker head
    movement; their frequency bands are in
    [research-biomechanics.md](research-biomechanics.md) § 3.8. Birdwhistell's
    5–15° arcs come from a search snippet only and are *unverified*.
  - The three-type nod corpus (arXiv 2507.23298, summarised in
    [research-biomechanics.md](research-biomechanics.md) § 3.3) separates
    `short`, `long` and `long_p` nods by range and duration.
- **What that means for a nod**, peak-to-peak. This table is a synthesis of the
  rows above rather than any one source's result, and it is what the nod
  sequences and their tests are gated against:

  | nod | amplitude | shape | duration |
  |---|---|---|---|
  | continuer ("mm-hm") | 3–5° | single; starts down; the return equals the stroke | 0.5–0.8 s |
  | repeated acknowledgement | 4–6° first cycle, then about 0.7× each (inferred) | 2–3 cycles; starts down | 0.3–0.5 s per cycle |
  | agreement | 6–10° | single; larger and faster | 0.7–1.0 s |
  | "oh, I see" | 6–10° | starts upward | 0.8–1.0 s |

- **tara's nod is wide.** Its `ACK_NOD` renders a 15.2° chin-down, which is
  outside every row above.
- **A conflict with a standing constraint.** Human repeated nods cycle at about
  2–3.5 Hz. This repository caps gesture oscillation at about 1.5 Hz, because
  above it a nod reads as impatience. That cap is a perceptual choice, not a
  biomechanical one, and it stays. Repeated nods are therefore authored slower
  than people make them.

## 3. What Live2D does

Live2D Cubism is the reference practice for making a flat drawing turn. Its
answer is structural, not a sprite swap.

- **Parameters.**
  - The standard head parameters are `ParamAngleX`, `ParamAngleY` and
    `ParamAngleZ`, conventionally ±30.
  - Each is keyed at −30, 0 and +30 by the artist, who redraws the parts'
    positions and shapes at each extreme. The runtime blends between keys.
  - "30" is a label, not degrees. The rendered turn is whatever the artist
    drew.
- **AngleZ is a rotation deformer pivoted at the chin**, about ±10° of
  on-screen rotation. The head tilts about the jaw and neck junction, not
  about the middle of the face.
- **Parallax is authored per part.**
  - Ears and back hair move less than the face outline, and the outline moves
    less than the features.
  - Side hair and back hair also get physics (a pendulum) driven by head and
    body angle.
- **Cubism 5's "3D Rotation Expression"** automates this.
  - The artist hand-draws one turned keyform (left, right, up or down).
  - "Depth estimation" then infers a Z for every warp-deformer control point
    from that drawing, so the depth is solved from the art, not authored up
    front.
  - The points are rotated in 3-D. A perspective of 0 gives parallel
    projection.
  - The settings are a rotation centre (its Z fixed at 0), a Z offset applied
    before rotation, perspective strength, an angle range and the rotation
    order.
  - In effect it is a *motion-depth field*: every point gets a depth that
    exists only to set how far it moves.
  - That is the mechanism the sprint adopts, in shader form (plan step 2).
  - Source: docs.live2d.com, "apply-3d-rotation-expression" and its settings
    page.
- **The face-tracking SDK sample** maps tracker angles as AngleX 30·x,
  AngleY 30·y, AngleZ −30·x·y and BodyAngleX 10·x.
  - The body carries a third of the head's yaw.
  - That is the same idea as the mixer's trunk follow, and at a similar
    ratio.
- **Rivers, Igarashi & Durand 2010, "2.5D Cartoon Models".**
  - Each stroke is 2-D art tied to one 3-D anchor. The anchor's rotation
    gives the stroke's position and draw order.
  - The stroke's shape interpolates between key views across yaw × pitch.
  - The anchors are *derived from the drawings*: each is the point closest to
    the camera-direction lines through the stroke's centre in each key view.
    Top, front and side views usually suffice.
  - Why it reads as 3-D, in their words: in real turns strokes travel curved
    paths at varying speed, and "Simple 2D interpolation ignores these
    effects, and is unable to produce convincing results."
  - Their known failure case is hair.

### 3.1 Measured on Live2D's own sample models

The 2026-09-14 research agent ran Cubism Core 6.0.1 headless on the eight
official sample models (Haru, Hiyori, Mao, Mark, Natori, Ren, Rice, Wanko).

Method:
- Every parameter starts at its default. One parameter at a time is set to
  its extreme, and the deformed vertices are read back.
- Parts are grouped by the model's own part names.
- H is the face-skin height, chin to skin top.
- Physics was not stepped.
- The ranges below cover the five humanoid rigs.

**AngleX +30 (turn): horizontal motion as a fraction of the nose's.** The nose
moves 0.10–0.25 H, which is equivalent to roughly 10–25° of real turn.

| part | Live2D rigs | anatomy (§ 2.2 depth ÷ nose depth) |
|---|---|---|
| brows | 0.67–0.84 | 0.88 |
| mouth | 0.69–0.79 | 0.83 |
| eyes | 0.55–0.76 | 0.75 |
| chin | 0.64–0.68 | 0.63–0.71 |
| front hair | 0.39–0.79 | ≈ 0.85 |
| face skin, including its outline | 0.41–0.51 | outline ≈ 0.17 |
| ears (leading / trailing) | 0.06–0.45 / 0.00–0.24 | 0 |
| crown | −0.07–0.29 | 0.05 |
| back hair | −0.04–0.13 | ≈ 0 |
| neck and body | 0–0.04 | 0 |

**AngleY +30 (look up): vertical motion as a fraction of the nose's.** The nose
moves 0.06–0.11 H.

| part | range |
|---|---|
| mouth | 0.78–0.86 |
| brows | 0.67–0.91 |
| eyes | 0.69–0.88 |
| chin | 0.27–0.73 |
| front hair | 0.36–0.81 |
| face skin | 0.27–0.61 |
| ears | 0.16–0.52 |
| crown | −0.06–0.27 |
| back hair | −0.18–0.31 |
| neck and body | ≤ 0.08 |

**AngleZ +30 (roll).**
- It is an almost rigid rotation of 5–15° on screen, about 10° typical. "30"
  is not degrees.
- The pivot is on the midline, 0–0.17 H above the chin and 0.3–0.6 H below
  the eyes.
- The hair rotates with the head. The neck moves at most 0.02 H, and the body
  does not move.

**BodyAngleX +10.**
- It carries the head as a rigid block: every head part moves by the same
  amount, 1.00 ± 0.02.
- The body moves 1.2–2.4× as far.
- Body angle adds no differential motion *inside* the head.

**Physics (from each model's `physics3.json`).**
- Front, side and back hair use one template in every model but one: input
  60% from the head's AngleX and AngleZ, and 40% from the body's.
- AngleY feeds only the vertical hair-bounce groups, at the same 60/40 split.
- Pendulum settings: mobility about 0.95, delay 0.8–0.9, acceleration 1–1.5,
  radius 3–18.
- Ren is the one model where the body follows the head through physics.

**VTube Studio.**
- Tracker FaceAngleX, Y and Z (±30) map to ParamAngleX, Y and Z (±30), with
  smoothing 15 on X and Y and 30 on Z.
- The same face angles also drive ParamBodyAngleX, Y and Z, over ±10 with
  smoothing 20. The body carries a third of the head.
- Auto-setup's defaults are not published. These numbers come from three
  public `.vtube.json` files.

**What it says.**
- Live2D practice agrees with anatomy on the features and the chin.
- It puts the *frame* somewhat further forward than anatomy does: ears about
  0.25 of the nose, crown about 0.1, and the outline about 0.5, against 0,
  0.05 and 0.17.
- The likely reason: a flat drawing cannot re-silhouette, so the outline has
  to carry part of the turn, or the face slides inside a still mask.
- tara is far outside both references. Her ears move 0.77 of the nose and her
  crown 0.82 of the mouth.
- The sprint's gates sit between the two references.

Nothing from Cubism Core or the Live2D sample models is copied into this
repository. Measurements taken from them are recorded here as numbers only.

## 5. Implications

1. **Fix the frame, not the features.** Pull the ears, crown, side hair and
   outline back, into the band between anatomy and Live2D practice (§ 3.1).
   Relative to the nose, that is:

   | part | motion ÷ nose motion |
   |---|---|
   | ears | ≤ 0.3 |
   | crown | ≤ 0.2 |
   | outline | 0.3–0.55 |

   Deepening the features instead would exaggerate the nose and misalign the
   eyes and lids.
2. **Move them in the vertex shader, not by moving vertices.**
   - A depth used only for motion cannot also be the real depth, because the
     silhouette, lighting and draw order depend on the real shell.
   - A per-vertex motion-depth offset, applied to screen xy only, is Cubism's
     3D Rotation Expression in shader form.
3. **Pitch about the upper-cervical axis, and nod small.** A believable
   acknowledgement is a short, narrow chin-down with the ears almost still. A
   large, fast head drop reads as a bow or as falling.
4. **The neck twists.** It carries about half of the head's yaw directly under
   the jaw, fading to none at the collar. It must not rotate rigidly with the
   head or shear.
5. **Roll pivots at the chin.** Live2D does this for a drawn face, and it
   matches where the lower cervical spine puts the visible motion.
6. **The body follows yaw by about a third.** The SDK's 10/30 ratio is the
   benchmark. Tune the trunk follow against it, not above it.
7. **Pitch is the scarce axis, and it is the axis that matters.** The speech
   literature wants pitch first by about four to one
   ([research-biomechanics.md](research-biomechanics.md) § 3.8), and pitch is
   the axis this projection gives up first. So the pitch budget is spent rather
   than saved: it goes to phrase poses and nods, and the small continuous
   layers get as little of it as will still read as alive. Yaw and roll have
   slack and must not be given the pitch they cannot substitute for — a head
   that turns instead of nodding is a head on a turntable, which is a failure
   this rig has actually shipped.
8. **Amplitude is the wrong dial for a nod that will not fit.** A wide listener
   nod cannot be scaled down to a tight pitch envelope and stay a nod; at that
   size it disappears. What the nod research offers instead is *cycles* — most
   real nods are one cycle and nearly all are within five, and a cycle costs
   about 0.15 s (§ 2.3). A nod living inside a small envelope buys back its
   salience with repetition and with speed, up to the impatience cap in § 2.3.
   That is a documented alternative to amplitude, not a consolation.
9. **Roll is sufficient, and nothing should depend on it.** The research asks
   for under a degree of standard deviation, which fits inside every measured
   envelope, and recorded calls peak far below it. The roll defect that matters
   is not amplitude: it is that the transition reads as a hinge, which is the
   absence of a body under the head and is fixed by coupling the shoulders and
   trunk to it, not by widening anything.
