# Torso motion on a 2.5-D bust-up

Research behind the 2026-09-16 body-motion work. The companion to
[research-head-rotation.md](research-head-rotation.md), which covers everything
above the collar; this page covers everything below it.

The owner's report, verbatim: *"the body movements come across as stiff and
broken"*, and their steer on how to fix it: *"We are not 3d, we are 2.5D. This
means that perhaps there are different ways to achieve the same thing, just like
we did for facial movements. As always, I believe Live2D would have answers to
this. What specific tricks do they suggest?"* The goal they set is not anatomical
correctness: *"we need body movements that enhance [the] point of view [that the
avatar is] understanding them, reacting appropriately, and performing work on
their behalf… We need them warm and friendly."*

Sources are marked **[OFFICIAL]** (docs.live2d.com, live2d.com, the Live2D GitHub
org), **[COMMUNITY]** (rigger tutorials and blogs), or **[INFERENCE]** (ours).
A research page may name things the code does not have. Numbers marked
*unverified* are waiting on a second source.

## 1. The short answer

**A flat torso reads as leaning or turning only when its parts change size and
position *relative to each other*. Scaling the whole thing preserves every
relationship and reads as a camera zoom.**

That is the defect. tara renders `torsoLean` as `figure.scale.setScalar()` on the
outermost group, with the orthographic camera outside it, which is arithmetically
a zoom. Live2D's equivalent is never a scale of the scene: the chest scales most,
the collar less, the neck least, and the shoulders spread and tip — **[OFFICIAL]**
*"deform the deformer with an awareness of perspective so that it is slightly
thinner in the back and wider in the front"*
([tutorial 5](https://docs.live2d.com/en/cubism-editor-tutorials/xy/)).

Three further findings shape the fix:

- **An armature is not Live2D's answer.** They ship a skinning feature and scope
  it to *"long hair, swaying strings, and other long, thin ArtMeshes"*, with full
  3-D skinning *"supported in the future"*. A torso is nested deformers plus
  hand-authored keyforms.
- **The body carries the head rigidly.** Measured on their own sample models
  (§ 3.1 of the head-rotation page): body angle moves every head part by the same
  amount, 1.00 ± 0.02, and *"adds no differential motion inside the head."* So the
  head does not deform under a lean — it rides.
- **Stiffness is partly a timing defect.** **[OFFICIAL]** *"turning only the face
  looks robotic"*; body X and Z must accompany every head turn, offset in time,
  with braking, because *"humans cannot stop a movement instantly"*
  ([motion hints](https://docs.live2d.com/en/cubism-editor-tutorials/motion-hint/)).

## 2. The standard parameter set

**[OFFICIAL]** [Standard Parameter List](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/).

| Parameter | ID | Range | Documented behaviour |
|---|---|---|---|
| Angle X / Y / Z | `ParamAngleX/Y/Z` | ±30 | head yaw / pitch / roll |
| Body rotation X | `ParamBodyAngleX` | **±10** | + turns to screen-right |
| Body rotation Y | `ParamBodyAngleY` | ±10 | + moves upward |
| Body rotation Z | `ParamBodyAngleZ` | ±10 | + tilts to screen-right |
| Breath | `ParamBreath` | 0–1 | + = inhale |
| Shrug\* | `ParamShoulderY` | ±10 | + shrugs shoulders |
| Bust\* | `ParamBustX` / `ParamBustY` | ±1 | chest sway |

Three structural facts matter more than the rows:

- **The body is ±10 where the head is ±30 — a 3:1 convention baked into the
  standard list.** There is no shoulder-turn or chest parameter in the core set
  at all; `ParamShoulderY` is a vertical *shrug*.
- **Starred parameters are "to be set up only when necessary."** Arms, hands,
  shrug and bust are starred. Body rotation X/Y/Z and Breath are **not** — they
  are the unconditional core of any rig.
- **There is no forward/back lean parameter.** No Z-translation, no "lean in", no
  distance-to-camera, anywhere in the standard list. That absence is itself a
  finding — see § 4.

**The 3:1 ratio is confirmed in the SDK's own sample code.** `setupLook()` drives
pointer tracking as `ParamAngleX 30, ParamAngleY 30, ParamAngleZ −30,
ParamBodyAngleX 10` — body X at exactly one third of head X, and **body Y and Z
are not tracked at all**
([lappmodel.ts](https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/TypeScript/Demo/src/lappmodel.ts)).
**[OFFICIAL]** This is the same benchmark § 5 item 6 of the head-rotation page
already set for the trunk follow, reached independently.

**[OFFICIAL data, our tabulation]** Every one of the eight shipped sample rigs
carries `ParamBodyAngleX/Y/Z` and a breath parameter, at parameter counts from 22
(Mark) to 181 (Mao). Newer models add `ParamLeftShoulderUp`/`ParamRightShoulderUp`
in place of `ParamShoulderY`, and `ParamWaistAngleZ` for a separate waist.

## 3. How a flat torso is made to read in depth

This is the crux, so official and community practice are kept apart.

### 3.1 The one official statement

**[OFFICIAL]** [Tutorial 5](https://docs.live2d.com/en/cubism-editor-tutorials/xy/):
*"deform the deformer with an awareness of perspective so that it is slightly
thinner in the back and wider in the front."* Applied to both X and Y.

**[OFFICIAL]** There is also a dedicated feature:
[Apply 3D rotation expression](https://docs.live2d.com/en/cubism-editor-manual/apply-3d-rotation-expression/)
— *"assists in the generation of 3D-like motion shapes"*, inferring a depth for
every control point so the art can be rotated in 3-D, with *"a perspective of 0"*
giving parallel projection. Crucially it applies **to warp and rotation deformers,
not only ArtMeshes**, so it is usable on a torso. This is the same mechanism the
head-rotation page § 3 calls *a motion-depth field*, and which tara already
adopted in shader form — **for the head only**.

### 3.2 Differential scaling — the actual technique

**[COMMUNITY]** [CGbox, 体の回転XYZ](https://cgbox.jp/2020/05/12/live2d-body-xyz/):

- **Body X (turn):** one warp deformer over the whole upper body. Turning left,
  the parts on the body's left compress slightly and those on the right expand
  slightly — 「体の中心を軸に回転」, rotating about the body's centre as the axis.
- **Body Y (up/down):** 「肩の位置を意識すること」 — **shoulder position is the
  tell.** Moving down, the shoulders **spread outward**; looking up, they
  **narrow inward.** This is stated explicitly as how the body's front-to-back
  movement is expressed.
- **Body Z (tilt):** a single warp over everything, with the face and hair first
  quarantined inside a rotation deformer or they compress under the tilt.
- Design principle: 「体の動きは少なめに作った方がいい」 — keep body motion
  restrained; the viewer is watching the face anyway.

**[COMMUNITY]** [itodaneko](https://note.com/itodaneko/n/ndbaa6da2927f) gives the
authoring order — chest → chest-body → collar → sleeves → neck, front-most first,
*"since the chest is furthest forward it deforms the most and everything else
aligns to it"* — and quotes scale differentials of **~1% (legs)** and **~3%
(arms)** between near and far side. Those are one author's examples, explicitly
labelled as such, and are *unverified* as norms.

Both sources describe the same mechanism: **the illusion is carried by parts
sliding and scaling relative to one another inside the trunk. Nothing is scaled
as a unit.**

### 3.3 Pivots

- **Torso tilt (Body Z):** pivot at the **waist** — 「体の横振りは腰あたりを支点に
  して上半身が大きく傾く」, the sideways swing pivots at the waist with the upper
  body tilting significantly. Riggers place a Bézier line at shoulder height so
  the shoulders are the handle ([Palkaloid](https://palkaloid.com/590/set-z-body/)).
  **[COMMUNITY]**
- **Torso turn (Body X):** no pivot as such — a warp rotating about the body's
  centre axis with differential scaling either side. **[COMMUNITY]**
- **Head roll:** pivot at the **chin**. **[OFFICIAL]**

## 4. The forward lean, specifically

**Live2D documents nothing about a forward/back lean.** No standard parameter, no
manual page, no tutorial step. This is the largest gap in the research, and it
means the lean is the one part of this work with no official pattern to copy.

What exists:

- **[COMMUNITY]** [CGbox](https://cgbox.jp/2020/05/12/live2d-body-xyz/) treats
  body forward/back as an optional extra and builds it as **scale** — rotation
  deformers around face and hair, expanded leaning forward and compressed leaning
  back — but authored 「肩を前に倒す意識で作ると」, *with the feeling of tipping the
  shoulders forward*. So even the community answer is scale **plus** a shoulder
  tip, not scale alone.
- **[OFFICIAL]** The nearest official analogue is Body rotation Y: a warp
  deformer **stretches the trunk upward at +1 and compresses it downward at −1
  while the feet stay planted**
  ([tutorial 4](https://docs.live2d.com/en/cubism-editor-tutorials/deformer/)).
  The trunk changes length; **the frame does not move.**

**[INFERENCE]** That last clause is the whole lesson, and it is the difference
between Live2D's lean and ours. Their scale is internal and differential — chest
most, collar less, neck least, shoulders tipping and spreading — so the parts
change their relationships and the eye reads depth. A uniform scale preserves
every relationship and therefore reads as focal length. The repo's own comment in
`params.js` (*"in a webcam frame both are read almost entirely as a change of
scale"*) and `research-biomechanics.md` § 6.3's endorsement of it are **right**:
scale is the correct rendering model. The defect is that **uniform** scale is not.

## 5. Timing and follow

**[OFFICIAL]** Live2D's guidance for body-follows-head is in the *animation*
pages, not the physics system
([motion hints](https://docs.live2d.com/en/cubism-editor-tutorials/motion-hint/)):

- 「顔の動きを単体でつけるのではなく、体のX・Zも顔の動きに合わせてつける」 — do not
  animate the face alone; add the body's X and Z to match, because 「顔だけ振り向く
  とロボットのように見えてしまいます」, turning only the face looks robotic.
- 「顔XYZと体XYZを慣性を意識してタイミングをずらす」 — offset the timing of face and
  body with inertia in mind. Moving them at exactly the same time *also* looks
  like a robot.
- 反動、ブレーキ — recoil and braking; humans cannot stop a movement instantly.

**That page contains no numbers.**

**[OFFICIAL]** A finding that bears directly on whether we need a physics system:
**not one of the 102 distinct physics output destinations across the six shipped
sample models is a body or head angle.** Physics drives hair, ribbons, skirts,
scarves, chains and bust — never the torso pose. Body-follows-head-with-lag is
community practice, not Live2D's shipped default. (Ren is the single exception
noted in the head-rotation page § 3.1.)

**[INFERENCE]** tara already satisfies all three rules without new machinery. The
mixer feeds `torsoTurn` the same target as `headYaw` at `trunkFollow`, and the
trunk's τ (0.44) is nearly 3× the head's (0.16), so the body leaves late and
settles late for free. **No driving-layer change is needed.**

## 6. Breathing

**[OFFICIAL]** The numbers are in the SDK, verified at
[cubismbreath.ts](https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/effect/cubismbreath.ts):
`value = offset + peak · sin(2π t / cycle)`, added at a weight.

| parameter | offset | peak | cycle |
|---|---|---|---|
| `ParamAngleX` | 0.0 | 15.0 | 6.5345 s |
| `ParamAngleY` | 0.0 | 8.0 | 3.5345 s |
| `ParamAngleZ` | 0.0 | 10.0 | 5.5345 s |
| `ParamBodyAngleX` | 0.0 | 4.0 | 15.5345 s |
| `ParamBreath` | 0.5 | 0.5 | 3.2345 s |

Breath period 3.2345 s ≈ **18.6 breaths/min**. Body X sways on a **15.5345 s**
cycle at 40% of its range. **The periods are mutually non-commensurate, so the
idle pose never exactly repeats** — the cheapest possible defence against a
visible loop.

**[COMMUNITY]** What moves: the breath deformer is centred on the chest with
handles sized to reach the shoulders; the chest expands **vertically and
laterally** because 「肺が横にも膨らむ」, the lungs also expand sideways; arms must
be quarantined in rotation deformers or they distort; and the motion should be
「控えめなくらいがちょうどいい」 — understated. **No source, official or community,
publishes a displacement magnitude.**

## 7. What does not transfer

**[INFERENCE]** throughout.

- **Draw-order keying and Draw Order Groups.** Live2D re-layers parts at a turn's
  extreme as a first-class parameter-driven feature. Our geometry is
  depth-tested, so overlap resolves itself. Ignore this entire class.
- **Glue.** Vertex-binding across separate ArtMeshes is a seam fix for layered
  art; their own example is a torso glued at *"neck, right shoulder and left
  shoulder"*. We get seam continuity instead from authoring displacement as a
  function of position in face space, so two meshes sharing a formula agree by
  construction.
- **Warp-deformer Bézier lattices** and their division-count guidance. We deform
  by morph targets; there is no analogue.
- **Skinning.** Scoped to hair strands, with 3-D deferred. Not their torso answer.
- **Redrawn artwork at the extremes.** Live2D freely redraws forms at ±30. Our
  albedo rule forbids anything that must appear or disappear, so the only legal
  equivalent is corrective *geometry* over a limited range.

**The one that inverts under an orthographic camera:** Live2D's *"thinner in the
back, wider in the front"* is a **manually authored perspective divide**. A
perspective camera supplies it for free; an orthographic camera never does.
Rotating shallow geometry under ortho yields cosine foreshortening — the far side
narrows — but **no near-side enlargement**, which is precisely the half of the cue
that says *toward you*. So a lean or a turn under ortho must have its near-side
widening **authored**, or it will read as a part disappearing rather than a body
arriving.

## 8. Implications

1. **Make the lean differential and internal, not a scale of the scene.** Hem
   pinned at the frame's lower edge, chest leading, collar less, neck least. This
   is the defect and the fix.
2. **Author the near-side widening.** Ortho cannot produce it by rotation. For a
   turn, the near side widens as the far side foreshortens.
3. **Spread the shoulders.** Live2D's tell for body depth is a **width** change,
   and it is the cheapest single addition that makes a flat torso read as
   three-dimensional. `BODY.widen` already exists for the breath swell.
4. **Let the head ride rigidly.** Body angle moves every head part alike
   (1.00 ± 0.02) and adds no differential motion inside the head. The head needs
   no morph of its own under a lean — a transform is correct and cheaper.
5. **Keep the trunk follow at a third.** Confirmed twice over: the ±10/±30
   standard-list convention, and `setupLook()`'s 10-against-30. This extends
   § 5 item 6 of the head-rotation page rather than replacing it; that page set
   the ceiling from the SDK sample, and the standard parameter list now gives the
   same number from a second direction.
6. **Restraint is the house style.** 「体の動きは少なめに作った方がいい」 agrees with
   this repo's own low-amplitude idle constraint and with
   `research-perception.md` § 4 — perceived competence drops faster than
   perceived warmth rises, so more motion is not automatically warmer.
7. **Nothing here needs an armature, a physics system, or new runtime
   machinery.**

## 9. Open, not verified

- **Live2D documents no forward/back lean at all** (§ 4). The scale-plus-tip
  construction rests on a single community source, and the explanation of why
  uniform scale reads as zoom is ours, not sourced.
- **Whether `ParamBodyAngle*` values are degrees is documented nowhere.** ±10 is
  a parameter range. Treat 3:1 as a convention, not a unit conversion.
- **The editor-label → `physics3.json`-field mapping is inference.** The
  Mobility link is strong (the documented 0.7–0.99 guideline matches the observed
  0.79–1.0 span); the Delay/Acceleration split is reasoned from the runtime
  source and is not stated by Live2D anywhere.
- **No official `physics3.json` schema page exists**; the field set comes from
  the framework parser and real sample files.
- **No official editor-side breathing magnitudes exist** — no chest or shoulder
  displacement, no recommended cycle. Only the SDK's 3.2345 s.
- **No official bust-up guidance exists.** バストアップ appears nowhere on
  docs.live2d.com; the auto-deformer has one fixed whole-body configuration with
  no upper-body variant. Haru — 45 parameters, a torso group, no leg parameters —
  is the nearest thing to a bust-up reference rig, but no Live2D page says so.
  **[INFERENCE]** Their implicit position is that the crop changes only which
  parameters you bother to author, not the method.
- **All community magnitudes are one author's examples**, explicitly labelled as
  such by their authors. Do not treat ~1%/~3% as norms.
- **Video-only sources were not transcribed**, and if official numeric guidance
  on torso rigging exists it is most likely inside them: the JUKU lesson
  ⑥体の角度XYZと肩, the Natori making-of (体の動き付け at 11:01), and the Japanese
  tutorial 4.

Nothing from Cubism Core or the Live2D sample models is copied into this
repository. Measurements taken from them are recorded here as numbers only.
