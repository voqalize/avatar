# Research: the perception and psychology of a likable production face

The static-design counterpart of [research-biomechanics.md](research-biomechanics.md).
That document is about how the face *moves*; this one is about how the face is
*read* — at product size, over long sessions, by people deciding fast and
mostly unconsciously whether they like, trust, and believe the thing. Authoring
decisions in face modules, pose calibrations and review checklists cite it the
way motion constants cite the biomechanics doc.

Scope note: same as its sibling. The avatar is a head-and-shoulders portrait on
a video-call tile roughly **120–500 px tall**, **listening most of the time**,
sharing the screen with a live camera feed. Everything below is filtered
through that frame; findings that only matter at poster size are discarded.

Provenance: distilled from the myna build (2026-08-07) — one likeness-driven
authoring run, one independent design-science critique, and the fix rounds
between them. Where a finding was demonstrated on our own rigs, the incident is
named, because the incident is the evidence.

---

## 1. What this face is for (the goals the science serves)

Four jobs, equal rank. A face that nails three and fails one fails the product.

1. **Be likable enough to sit opposite for an hour.** §3–§6.
2. **Communicate what the assistant is doing** — distinct, emotionally legible
   states. §7.
3. **Buy time while feeling responsive.** The "mirrors in lifts" effect:
   the famous operations story is that buildings cut elevator-wait complaints
   not by speeding up the lifts but by installing mirrors — the wait stayed,
   the *experienced* wait shrank. (Folklore-grade citation, but the underlying
   result is solid HCI: users tolerate delay when there is visible, plausible
   activity; feedback is required past ~1 s and attention collapses near ~10 s
   — Nielsen's response-time limits,
   [nngroup.com](https://www.nngroup.com/articles/response-times-3-important-limits/).)
   The avatar **is the mirror**: THINKING / TYPING / SEARCHING motion converts
   dead air into perceived progress. Latency masking is a first-class design
   goal, not a decoration — it is most of why the widget exists instead of a
   spinner.
4. **Show "I am listening and following along."** The psychological load-bearer
   is *contingency*, not frequency: one nod timed to the user's pause-onset is
   worth ten nods on a random timer, and a mistimed backchannel is worse than
   none (it reveals the listener isn't tracking). This is why the codebase's
   rule is *autonomy is contingent, never decorative* — the science and the
   convention agree.

## 2. Where the eye lands: face perception at tile size

- At small visual angles, expression information concentrates in the **eye and
  mouth regions**; the rest of the face contributes identity and framing but
  little affect. (Diagnostic-region findings, e.g. Smith, Cottrell, Gosselin &
  Schyns 2005, *Psychological Science* 16(3).) Consequence: the drawing's
  **contrast budget must be spent around the eyes and mouth**. Hair mass and
  garment may be larger and higher-chroma, but they must not *win fixation*.
- **The incident:** myna v6's resting smile was drawn with the lightest ink on
  the face. At 130 px the tile renderer averaged it into the paper — the mouth
  effectively vanished, and the entire warmth signal was being carried by the
  brows, which happened to arch. The face read faintly smug at exactly the
  size users see. The fix was a ~15–20% floor raise on the mouth's width
  profile — zero new marks.
- **The audit that catches it:** downsample the rest pose to 130 px and name,
  honestly, the first three things you see and in what order. The eye/mouth
  band should place no worse than second. This is now a checklist step
  (authoring-a-face.md).
- **The rule that follows: author at close-up, accept at 130 px.** Anything
  judged only at full resolution is unjudged.

## 3. Trust and warmth live in the resting face

- People form trait judgements from faces in **well under a second** (Willis &
  Todorov 2006, *Psychological Science* 17(7)), and the trustworthiness axis
  loads chiefly on **resting mouth curvature and brow configuration**
  (Oosterhof & Todorov 2008, *PNAS* 105(32)). Since this avatar listens most
  of the time, **the resting/listening face is the product**, and its mouth
  curvature + brow set are the two most consequential constants in a face
  module.
- **The smirk composite.** An arched or kinked brow *over* a smile is the
  canonical knowing/appraising read. Each mark can be fine alone; the
  composite curdles. Myna's v6/v7 resting brow carried an outer-third kink
  that did exactly this. Resolution: the resting brow is a gentle taper-arc;
  the kink survives as a *pose* (browAngle can produce it for curious /
  skeptical beats), never as baked geometry.
- **Fixed smiles are discounted.** A static, never-varying smile reads
  insincere within tens of seconds — viewers discount smiles that lack onset,
  offset and eye involvement. Warmth must be *episodic and motion-linked*:
  a modest resting curve, restored and amplified by interjections (OKAY, SURE
  are supposed to smile), and decayed toward neutral during speech so visemes
  don't inherit a grin (see §8 and the animation backlog).
- Practical resting target: closed-lip smile whose upturn survives 130 px;
  soft brow arcs; lids grazing the pupil (§6); personality delivered through
  poses and glances, not through the geometry the user stares at for minutes.

## 4. The neoteny dial

- Kindchenschema (Lorenz 1943): larger eyes, higher forehead, compact lower
  face and fuller cheeks read as approachable and elicit warmth. But the dial
  keeps turning past the sweet spot: overdone, the face reads childlike, and
  **perceived competence drops faster than perceived warmth rises** — warmth
  and competence are the two axes people actually judge agents on (Fiske,
  Cuddy & Glick 2002/2007, the stereotype-content model), and a professional
  assistant needs both.
- **The one-move rule:** change one neoteny variable per iteration (eye size
  *or* forehead exposure *or* jaw softness *or* nose scale), re-judge at tile
  size, and stop. Two simultaneous moves is how a professional assistant
  becomes a mascot. Myna's allowance was pupils + opened forehead; jaw, eye
  spacing and nose were explicitly frozen.

## 5. Caricature economy: distill before you build

- **Peak shift** (Ramachandran & Hirstein 1999, *Journal of Consciousness
  Studies* 6): a good caricature is *more* recognizable than the photograph,
  because it exaggerates what distinguishes this face from the average and
  deletes the rest. This is the scientific core of "distilling the essence"
  of a reference asset:
  1. the **silhouette** (the identity carrier at a glance and at 130 px),
  2. the **3–5 identity marks** (for myna: the plait, the soft-rect glasses,
     the nose hook, the fringe sweep, the tee-wedge-in-jacket),
  3. the **palette structure** (where the one accent sits and what it
     brackets).
  Everything else in the reference is negotiable and should be simplified
  toward the idiom. Likeness to the reference is a *stage*, not the bar
  (authoring-a-face.md § the staged process).
- **Protect-lists stop churn.** Once a mark is confirmed right — by
  stakeholder or by review — write it down as protected and stop touching it.
  Iteration pressure otherwise erodes exactly the marks that were working
  (myna's protect-list: nose hook, silhouette, flat hair mass, ink frames,
  tee wedge, hoops).
- **Categorical perception meets the minimal face.** Expression perception is
  categorical: a pose ~60% of the way to an extreme reads *as* the extreme; a
  pose ~25% of the way reads as neutral. There is no gradient to be subtle
  along. Combined with this project's own doctrine that *a minimal line face
  swallows small deltas*, the consequence is: **author poses toward the
  extremes and calibrate until *just* distinguishable at 130 px** — which will
  feel slightly theatrical at close-up, and that is correct for this product.
  (The lever is per-rig channel→geometry gain, not the shared pose vectors.)

## 6. Long-session comfort

The failure modes that only appear after minutes of exposure — no still
catches them, so they are authored against by rule:

- **Gaze intensity.** Fully-open, centred, large pupils read as staring within
  a minute. The resting lid should *graze* the pupil top (the mixer's rest lid
  is 0.12; the rig's mapping must make 0.12 visibly graze). Guard on the other
  side: past ~0.15 of graze the face reads sleepy — the documented
  "asleep instead of busy" failure. Verify on a LISTENING-profile frame, not a
  static.
- **High-frequency interior detail flickers.** Small ticks and slivers inside
  a moving mass (hair interior, plait segments) resolve at close-up, vanish at
  tile size, and *shimmer* during nods — the most-played motion in the
  product. They also cost the video encoder real bitrate (constraint 8 in the
  project brief). Calm interiors: few, bold marks; the silhouette does the
  identity work.
- **Static marks inside deformation zones are defects.** Any mark near the
  mouth, brows or lids either rides the deformation or does not exist
  (myna's under-lip crease; the lash line that must track the lid through a
  blink). A mark that holds still while the feature moves reads as a rendering
  fault at exactly the moment the user is paying attention.
- **Near-tangency shimmer.** Two ink marks that move relative to each other
  (brow vs. glasses frame) must keep a hard clearance envelope, verified at
  the *worst-case composite* (brows-down + squint + pitch), not at rest —
  a 1-unit gap pixel-dithers as the channel moves. If the envelope cannot be
  met, the accessory yields (shorten the frame), never the expression channel
  (parking brows high reads permanently surprised).

## 7. State legibility is half the job

Communicating "what is happening with the assistant" ranks equal with
likability. The tests:

- **Distinctness at tile size.** Every state and every emotion must be
  tellable from every other on the 130 px contact-sheet row. The standing
  counterexample: the compound state that read as *asleep* instead of *busy* —
  a state that misreads is worse than no state, because the user acts on it.
- **Motion is the state channel.** A tile has no room for icons or spinners;
  posture, gaze pattern, blink/breath rhythm and holds *are* the status line
  (deliberate stillness is itself a cue — and a bitrate saving). This is why
  each state carries an idle profile rather than a static pose.
- **The latency-masking states earn their keep in the first second.**
  THINKING / TYPING / SEARCHING must read within ~1 s of onset (Nielsen's
  feedback threshold) — their opening beat matters more than their loop.

## 8. Lipsync credibility

- Viewers integrate what they *see* of a mouth with what they hear (the
  McGurk effect is the classic demonstration), and they use **bilabial
  closures** — P/B/M, viseme A — as anchor points to verify sync against the
  audio. If A renders like the idle mouth, lipsync reads mushy *even when the
  timing is perfect*. Since mouth sync is this product's headline feature,
  viseme A must be **shape-distinct** from X: a pressed, straightened band vs.
  a relaxed curve.
- The general doctrine, now demonstrated twice (G vs B on peep; X vs A on
  myna): **two visemes that differ only in amplitude will collapse at product
  size; separations must be authored as shape differences** and verified on
  the mouth-detail crop row, never the full-head row.

---

## Applying this doc

The staged authoring process and the verification checklist that operationalize
everything above live in [authoring-a-face.md](authoring-a-face.md) — likeness
stage, production-calibration stage, independent review stage. The division of
labour: that doc says *what to do and in what order*; this one says *why, and
what to measure when a judgement call is contested*.
