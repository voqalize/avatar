# How a face, head and torso move while listening and while talking

The question this page answers was put as an intuition to be checked:

> Intuitively, it seems to me that we move the head, stay there, then move to
> another place. But I need this to be research backed.

It is four claims, not one — the head, the trunk, the face and the eyes each
answer differently — and the measurements grade them differently. This page is
the temporal structure only: **when** a thing moves and for how long it stays.
How far it may move is [research-head-rotation.md](research-head-rotation.md)
(head) and [research-torso-motion.md](research-torso-motion.md) (trunk); why a
nod is shaped the way it is, [research-biomechanics.md](research-biomechanics.md);
when a backchannel is *owed*, [research-active-listening.md](research-active-listening.md).

Research page, so it names things the code does not have.

---

## 1. The short answer

| claim | verdict | the measurement |
|---|---|---|
| the head moves, holds, moves again | **confirmed, and it is the dominant pattern while listening** | 12.8% of frames have any head velocity at all during listening turns and pauses |
| …while talking, too | **confirmed in form, refuted as stillness** | 89.9% of frames have non-zero velocity while speaking. What is *held* is a pose per phrase, not a motionless head |
| the trunk does the same | **confirmed, an order of magnitude slower** | seated postural shifts run 8–19 per hour — one every 3–7 minutes, against the head's every 2–4 seconds |
| the eyes do the same | **refuted** | gaze re-fixates every ~2–3 s and is *off* the partner 25–60% of the time. An eye that holds one target is the thing that reads wrong |

The unit of the hold, while talking, has a name and a number: the **intonation
unit**, one every **1.6 s**, measured across 650 recordings in 48 languages and
27 families (Inbar et al., PNAS 2025). That is the cadence a speaking head
re-positions at, and it is not a stylistic choice — it is the slowest rhythm in
speech and it is universal.

So: hold-and-move is right, and the correct reading of it is **four clocks, not
one**. Eyes at ~2–3 s, head at ~1.6 s (talking) / ~3 s (listening), trunk at
minutes, and the face's own events (blink, brow) on their own budgets. A single
scheduler driving all four is the failure this page exists to prevent, and it is
the failure the repo already made once in the other direction — one summed
envelope driving everything, which a reviewer called a screensaver
([head.js](../packages/avatar/src/head.js) header).

---

## 2. The measurements

### 2.1 The head while talking

Hadar, Steiner, Grant & Rose put a polarized-light goniometer on people in
conversation and recorded head position continuously against the speech signal.
During speaking turns **the head moved almost incessantly: 89.9% of recorded
frames had non-zero velocity.** It is not still, and a rendered speaking head
that is still for a second is not a person thinking, it is a dropped frame.

What is held is the *pose*. Hadar's follow-up separates a **postural shift** —
a wide, linear movement — from the small motion riding on it, and finds the
shifts land:

- toward the **initiation of speech**, beginning *before* voice onset,
- **between turns**,
- at **syntactic boundaries inside a turn**.

None of those is a clock. They are all discourse events, which is why the
1.6 s intonation-unit rhythm is the number that matters: it is how often a
discourse boundary arrives. Graf et al. measured the anticipation directly —
the head moves before the voice at over 70% of phrase onsets — and the repo's
speech layer is already built on that ([prosody.js](../packages/avatar/src/prosody.js),
§ the phrase pose).

Amplitude, from motion capture of 640 sentences (Busso et al. 2007), **per
sentence**, which is the right denominator for a per-phrase pose:

| axis | sd | range |
|---|---|---|
| pitch | 3.3° | 9.5° |
| yaw | 0.9° | 2.3° |
| roll | 0.8° | 2.3° |

Pitch is nearly four times the other two. A speaking head is mostly a nodding
head, and the axis our envelope restricts hardest is the axis the research asks
for most — see § 3.

Frequency bands, from the same corpus of work and restated in the 2023 hearing
review: **slow 0.2–1.8 Hz, ordinary 1.9–3.6 Hz, rapid 3.7–7.0 Hz.** The rapid
class marks stress; juncture is marked by contrasting *ordinary movement with
stillness*. That last clause is the research statement of hold-and-move, and it
is about a boundary, not about a resting head.

### 2.2 The head while listening

The same goniometry: during **pauses and listening turns, 12.8% of frames had
non-zero velocity**. A listening head is still roughly seven eighths of the
time. This is the claim the intuition gets exactly right, and it is the mode a
voice agent spends most of its life in.

What the moving eighth consists of is nods, and almost nothing else. An
unscripted-dyad study that labelled head movement by type in both modes found
**nodding the most frequent head movement**, with shaking, tilting, turning and
up/down motion *rare during listening* and materially more common while
speaking (Mode × Type interaction, p = 0.0011, partial ω² = 0.54). A listener's
repertoire is narrow.

Nod kinematics, from 8,803 nods and 16,843 cycles in 342 minutes of
conversation (PLOS One 2025):

- a single-cycle nod runs about **0.94 s**; a five-cycle nod about **1.53 s** —
  so repetition adds cycles far more cheaply than it adds duration,
- **42% of nods are a single cycle**, and **over 95% are within 1–5 cycles**,
- magnitude is measured in degrees, and the corpus treats anything past 90° as
  an artefact.

Pitch excursion for an active-listening nod sits in the range **−3° (flexion) to
+15° (extension)**. Listeners also nod *faster* than talkers do — the fast band
of 2.6–6.5 Hz is where listener nods concentrate, and listener nods are narrow
in amplitude compared with a speaker's head motion (Hadar et al. 1985).

A listening head therefore has two populations: long holds, and short narrow
fast nods. Nothing in between. The mistake available here is a slow wide nod,
which is a speaker's movement worn by a listener.

### 2.3 The trunk and the shoulders

The trunk holds. Seated postural shifts are measured at **8–19 per hour** in
healthy participants — one every three to seven minutes — and ergonomics work
that *deliberately* raises the rate to 20–30/hour describes that as frequent
shifting. Against a head that re-positions every two to four seconds, the trunk
is stationary.

When it does move, the direction is known: in unscripted dyads **leaning to the
side was the most frequent trunk motion, significantly more than leaning
forward or leaning backward** (main effect of type, p < 0.001, partial
ω² = 0.90). Lateral, not sagittal. And trunk movement is *modulated* by
communicative effort — it rises with background noise — which makes it an
intensity signal rather than a metronome.

There is one more trunk fact and it is a coupling, not a schedule: Hadar's
postural-shift work locates trunk resets at the same phrase boundaries the head
uses. The body is not on its own clock at that scale; it is on the head's, at a
share.

The design consequence is blunt. **The torso should not have an independent
scheduler.** Two things only: a slow re-settle on the order of minutes, and a
lateral share of what the head is already doing. Anything else invents motion
the measurements do not contain, and a jittery torso is expensive on the
encoder for nothing (CLAUDE.md, the idle-motion constraint).

### 2.4 The eyes — where the intuition breaks

Gaze does not hold.

- An individual glance at a partner averages about **3 s**; mutual gaze about
  **1 s**, with a comfortable band of 2–5 s and preference peaking near 3.3 s.
- Total looking time at the partner is about **50%** of a conversation, spread
  30–70% across individuals; the asymmetry is the load-bearing part — roughly
  **75% while listening** and **41% while talking**.
- Mutual gaze is 10–40% of the time, centred near 25%.
- Gaze aversion exists specifically to break prolonged mutual gaze.

So the eyes are off the partner between a quarter and three fifths of the time,
and they re-fixate several times within a single head hold. An avatar whose
eyes stay locked on the camera through every head move is not holding eye
contact, it is staring — and it is doing so *more* than any measured human.

This is the research behind a call already made on 2026-09-19: **the head
instrument's "eyes hold the camera" defaults to off, because on this face every reflex gain
read worse than none.** The reflex being modelled (the vestibulo-ocular reflex,
which counter-rotates the eyes against head rotation to stabilise gaze) is real
physiology, and modelling it at full gain is still wrong here, for two separate
reasons:

1. **Socially.** Full VOR gain means gaze never leaves the camera. The measured
   human leaves it constantly. The reflex holds *a* target; it does not oblige
   you to keep choosing the same one, and a rig that has no re-fixation
   behaviour turns a reflex into a stare.
2. **Optically.** On a 2.5-D face the eyes are painted on a shallow shell. A
   counter-rotation at a held yaw puts the visible iris off-centre in an
   aperture that has not foreshortened, and past a few degrees that reads as
   side-eye rather than as a head that turned
   ([research-head-rotation.md § 2.3](research-head-rotation.md)).

The honest statement is that the shipping `vor.x = 0.8` is a number this page
calls into question, not one it condemns: in a call the head rarely reaches the
angle where the artefact appears. It is flagged, not changed.

### 2.5 Undershoot, which is why the head and the eyes must disagree

Head turns toward a target systematically fall short. The measured relation
between head rotation and target eccentricity has a **slope of about 0.6 — a
consistent undershoot** — and in multi-talker listening, heads settle **10° to
15° short of the target talker**. The eyes make up the difference.

That is a two-line result with three consequences for us:

- a head that fully faces what it is attending to is wrong before any question
  of amplitude arises,
- the remainder is carried by gaze, so the eyes and the head must be *allowed*
  to point in different directions — which is exactly what a full-gain VOR
  removes,
- our envelope's job gets easier: the undershoot is in the same direction as
  our limits. We are not fighting the research by holding yaw to six degrees;
  we are short of a target we would have undershot anyway.

The repo's aversion split is already at this ratio — `avert: { eye: 0.45,
head: 0.6 }` in the tara tuning — and the 0.6 there was not derived from this
number. It agrees by accident, which is worth knowing and not worth
retrofitting a citation to.

### 2.6 The face

The face's own events are not on the head's clock and are documented where they
were measured: blink rate and its state-dependence, brow behaviour, and the
perceptual asymmetries are [research-biomechanics.md § 5](research-biomechanics.md)
and the `STATES` table in [avatar.js](../packages/avatar/src/avatar.js). Two
facts from that body of work belong here because they are *timing* facts and
they interlock with the head:

- **a blink at a boundary is worth several placed at random** — so the face's
  clock should be nudged onto the head's events rather than run beside them,
  which is what `EVOKED_EARLIEST` in [idle.js](../packages/avatar/src/idle.js)
  implements,
- brow level is **held per phrase and signed**, not pulsed per word — the same
  hold-and-move shape, one layer up.

---

## 3. Under our envelope

The limits are measured per character and live in one place,
`packages/avatar/client/three/motion-limits.json`. At the time of writing, the
safe angles are yaw 6°, pitch 5°, roll 6° on tara and tushar; tanya's yaw and
roll are marked for re-measurement and fall back to the tightest live angle.

The rig's own mapping is `HEAD_DEG` over `HEAD_CLAMP`, so one pose unit is
**10.7° of yaw, 17.1° of pitch, 5.7° of roll**. Everything below is that
conversion applied, and no number here is a second copy of a limit — they are
all read from those two files.

| | research asks | our safe limit | fits? |
|---|---|---|---|
| **pitch**, talking | 3.3° sd, 9.5° range per sentence | 5° | **no.** The range is 95% over budget; the sd fits with room |
| **pitch**, a listening nod | −3° to +15° excursion | 5° | **no**, at the top of the range. A nod authored at +15° is off this face |
| **yaw**, talking | 0.9° sd, 2.3° range | 6° | yes, with four times the room we need |
| **roll**, talking | 0.8° sd, 2.3° range | 6° (tara, tushar) | yes |
| **roll** | as above | 1° (tanya, pending re-measure) | **no** — and this is why the budget is shared |
| **head, attending to something** | undershoots by 0.6, lands 10–15° short | 6° | yes — the limit is *inside* the undershoot |
| **trunk** | one re-settle every 3–7 min, lateral | not angle-limited | yes |
| **eyes** | re-fixate every 2–3 s; off-target 25–60% | `range.x` 0.8 u | yes |

Three conclusions follow, and they are the whole of "apply the constraints":

**(a) Pitch is the scarce axis, and it is the axis that matters.** The research
wants pitch first by a factor of four, and pitch is the axis this projection
gives up first. So the pitch budget is spent, not saved: it goes to phrase poses
and nods, and the small continuous layers get as little of it as will still read
as alive. Yaw and roll have slack and must not be given the pitch they cannot
substitute for — a head that turns instead of nodding is a head on a turntable,
which is the failure a previous pass of this rig actually shipped
([idle.js](../packages/avatar/src/idle.js), the settle comment).

**(b) Amplitude is the wrong dial for a nod that will not fit.** A +15° listener
nod cannot be scaled to 5° and stay a nod; at that size it disappears. What the
nod research offers instead is *cycles*: 42% of real nods are one cycle and 95%
are within five, and adding a cycle costs about 0.15 s. So a nod that must live
inside 5° buys back its salience with repetition and with speed — the listener
band is 2.6–6.5 Hz, and the fast end of it is free. This is a real and
documented alternative to amplitude, not a consolation.

**(c) Roll is nearly a spent axis, and nothing should depend on it.** tara and
tushar have 6° and never use it (a recorded call peaks at 2.00° listening and
1.01° speaking); tanya's measured limit was 1°. The research asks for 0.8° sd,
which fits everywhere — so roll is *sufficient* and should stay where it is. The
roll defect that matters is not amplitude: it is that the transition reads as a
hinge, which is the absence of a body under the head and is fixed by coupling
shoulders and trunk to it (`SHOULDER_TILT`), not by widening anything.

---

## 4. What the repo already does, measured against this

The mechanism exists. `HeadPose` in
[head.js](../packages/avatar/src/head.js) is hold-and-move: a **move** is a
minimum-jerk path (Flash & Hogan 1985) that starts and ends at zero velocity, a
**stroke** is a pulse on top, and between them the output does not change at
all. [prosody.js](../packages/avatar/src/prosody.js) drives it per phrase while
speaking; [idle.js](../packages/avatar/src/idle.js) drives it while listening.
So the finding is not that the intuition needs building — it is a check on the
numbers.

| | in the code | research | reading |
|---|---|---|---|
| speaking, gap between poses | per phrase; median 1.26 s on a real cue track | 1.6 s intonation unit | **agrees.** Ours is faster because a TTS phrase is shorter than a human intonation unit, and the layer is driven by the actual boundary rather than a clock |
| speaking, head leads the voice | move booked into the pause before onset | >70% of phrase onsets | agrees |
| speaking, per-sentence sd | pitch 62–65% of Busso, yaw and roll over | pitch 3.3°, yaw 0.9°, roll 0.8° | **off in proportion**: too little pitch, too much yaw. § 3(a) is the fix and it is a re-allocation, not an increase |
| listening, gap between poses | `settle: [1.8, 4.6]` s, mean 3.2 s | still 87% of the time | plausible; see below |
| listening, move duration | `SETTLE.dur` 0.45–0.8 s | a nod cycle is ~0.94 s, so a move is shorter than a nod | agrees |
| listening, amplitude at sway 1 | yaw 1.7–3.6°, pitch −1.9 to +1.4°, roll 0.6–1.6° | narrow relative to a speaker | agrees, and sits inside every limit |
| listening, still fraction | `settle` plus an always-on `LIVE` drift | 12.8% of frames moving | **cannot be matched literally.** A goniometer counts any velocity, including tremor below the visual threshold; a rendered head at zero is *exactly* zero, and that measured as a frozen listener in review. Ours is deliberately above 12.8% |
| trunk | `shift: [9, 22]` s between weight shifts | one every 3–7 minutes | **ours is 15–40× more often.** See below |
| trunk direction | lateral turn plus a small lean, head counter-rolls | lateral dominates, significantly | agrees |
| trunk coupled to the head | `TRUNK_FOLLOW` and `SHOULDER_TILT` off held roll | postural resets share the head's boundaries | agrees |
| eyes | `vor.x = 0.8`, aversion split 0.45/0.6 | re-fixate every 2–3 s, off-target 25–60% | **the gain is questioned** (§ 2.4); the split matches the 0.6 undershoot |

Two rows are worth acting on and one is worth leaving alone.

- **The trunk shift rate is 15–40× the measured human rate, and that is on
  purpose.** The reasoning is already in `idle.js`: an avatar seen for thirty
  seconds that shifts once every five minutes will, with near certainty, not
  shift at all while anyone is looking, and a motion map of the listening state
  measured the torso edge travelling *zero pixels over 24 seconds*. A call is
  not an hour of sitting. But the honest form of this is that we are not
  modelling postural shifts at their rate — we are using their *shape* at a
  rate chosen for a 30-second window, and the number to defend is the visible
  one. This is the one place on this page where the research rate is knowingly
  not followed, and it should stay written down rather than quietly matched.
- **The speech axis proportions are wrong and fixable.** Pitch is under and yaw
  is over, against a measurement that says pitch dominates fourfold. Under our
  envelope the correct move is to shift the allocation, not to raise the total.
- **The listening still-fraction should not be chased to 12.8%.** It is a
  measurement of a real neck, taken with an instrument that sees what an eye
  cannot.

One factual error found while writing this: the `SETTLE` comment in `idle.js`
states a unit of yaw is 6.4° on tara. That was true when `HEAD_DEG.yaw` was 9;
it is 15 now, so a unit is 10.7°, and every degree figure in that comment is
low by 1.67×. The amplitudes are still inside the limits — 3.6° of yaw against
a 6° budget — but the comment is wrong and is fixed with this page.

---

## 5. Implications

1. **Four clocks.** Eyes ~2–3 s, head 1.6 s talking / ~3 s listening, trunk
   minutes, face on its own budgets nudged onto the head's boundaries. Never one
   scheduler.
2. **The hold is the message while listening, the pose is the message while
   talking.** A listening head is still 87% of the time and its moves read as
   decisions because of it. A talking head is never still, and what it holds is
   a position, with motion on top.
3. **A hold ends at a boundary, not on a timer.** Postural shifts land at speech
   onset, turn changes and syntactic boundaries. Where the code has a boundary
   available it should use it in preference to an interval — which is what
   `prosody.js` does and what `idle.js`, having no boundaries to work with,
   cannot.
4. **Spend pitch.** It is the axis the research wants fourfold and the axis this
   projection restricts hardest. Yaw's slack is not a substitute.
5. **Buy nod salience with cycles and speed, not degrees.** 42% one cycle, 95%
   within five, +0.15 s per cycle, listener band to 6.5 Hz — with a standing
   caution that sustained nodding above ~1.5 Hz reads as impatience (CLAUDE.md),
   so the fast band belongs to short nods only.
6. **The torso gets no scheduler of its own.** A slow re-settle and a lateral
   share of the head. Lateral, because forward and backward lean are measurably
   rarer.
7. **The eyes must be allowed to disagree with the head.** Undershoot is 0.6;
   gaze carries the rest, and re-fixation is what makes eye contact read as
   contact rather than as a stare. A full-gain stabilising reflex removes the
   disagreement and with it the behaviour.
8. **Listening has a narrow repertoire.** Nods, and hardly anything else. Tilts,
   turns and shakes are a speaker's vocabulary; putting them in a listener is a
   category error the measurements are clear about.

---

## 6. Open, not verified

- **Whether a 5° nod with more cycles actually reads as a nod on these faces.**
  § 3(b) is a research-backed *alternative*, not a measured result on our rig.
  It is judged by eye at crop, like everything else here.
- **The per-character listening still-fraction.** We know ours is above 12.8%
  and why; we have not measured what it is, and the instrument for it is new.
- **Whether the trunk rate can come down.** If the re-settle were coupled to
  turn boundaries rather than an interval, a call might get a shift where it
  matters and hold still elsewhere — closer to both the rate and the shape.
  Untried.
- **`vor.x = 0.8`.** Flagged in § 2.4, unchanged.
- **Busso's axis labels.** Still unresolved, as
  [research-head-rotation.md § 6](research-head-rotation.md) records. Nothing on
  this page turns on which of α, β, γ is pitch, because the *proportions* are
  what we use and pitch dominating is stated in prose as well as in the table.

---

## References

- Hadar, U., Steiner, T.J., Grant, E.C. & Clifford Rose, F. (1983). *Kinematics
  of head movements accompanying speech during conversation*. Human Movement
  Science 2(1–2), 35–46. https://www.sciencedirect.com/science/article/abs/pii/0167945783900040
  — 89.9% of frames moving while speaking, 12.8% while listening or pausing.
- Hadar, U., Steiner, T.J., Grant, E.C. & Clifford Rose, F. (1983). *Head
  Movement Correlates of Juncture and Stress at Sentence Level*. Language and
  Speech 26(2). https://journals.sagepub.com/doi/10.1177/002383098302600202
  — the slow/ordinary/rapid bands; juncture as ordinary movement against
  stillness.
- Hadar, U., Steiner, T.J. & Clifford Rose, F. (1984). *The timing of shifts of
  head postures during conversation*. Human Movement Science 3(3), 237–245.
  https://www.sciencedirect.com/science/article/abs/pii/0167945784900186
  — postural shifts at speech initiation, between turns, at syntactic
  boundaries, beginning before voice onset.
- Hadar, U., Steiner, T.J. & Clifford Rose, F. (1985). *Head movement during
  listening turns in conversation*. Journal of Nonverbal Behavior 9(4), 214–228.
  https://link.springer.com/article/10.1007/BF00986881
  — listener nods align with the speaker's prosody and stress; narrow amplitude.
- Inbar, M. et al. (2025). *A universal of speech timing: Intonation units form
  low-frequency rhythms*. PNAS. https://doi.org/10.1073/pnas.2425166122
  — one intonation unit every 1.6 s, 650+ recordings, 48 languages, 27 families.
- Busso, C., Deng, Z., Grimm, M., Neumann, U. & Narayanan, S. (2007). *Rigid
  Head Motion in Expressive Speech Animation: Analysis and Synthesis*. IEEE
  TASLP 15(3). https://sail.usc.edu/publications/files/bussotaslp2007.pdf
  — per-sentence sd and range per axis; velocity roughly doubles under emotion.
- *Structure of nods in conversation* (2025). PLOS One.
  https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0323448
  — 8,803 nods, 16,843 cycles, 342 minutes; 0.94 s for one cycle, 1.53 s for
  five; 42% single-cycle, >95% within five.
- *Head movement and its relation to hearing* (2023). Frontiers in Psychology.
  https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full
  — the 0.6 undershoot slope, heads landing 10–15° short of a target talker,
  the −3°/+15° nod range, listeners' fast nods at 2.6–6.5 Hz, the frequency
  bands restated.
- *Head, posture, and full-body gestures in unscripted dyadic conversations in
  noise* (2025). arXiv:2512.03636. https://arxiv.org/abs/2512.03636
  — nodding most frequent in both modes; tilt/turn/shake/up-down rare while
  listening; lateral lean the dominant trunk motion, p < 0.001, ω² = 0.90.
- Postural-shift rate in seated work: 8–19 shifts per hour in healthy
  participants; 20–30/hour described as frequent.
  https://www.jmptonline.org/article/S0161-4754(23)00053-2/fulltext
- Gaze in conversation: ~3 s glances, ~1 s mutual gaze, ~50% looking time
  (30–70%), ~75% listening against ~41% talking, mutual gaze 10–40%.
  https://www.nature.com/articles/s41598-018-22726-7 and
  https://www.bps.org.uk/research-digest/psychologists-have-identified-length-eye-contact-people-find-most-comfortable
- Flash, T. & Hogan, N. (1985). *The coordination of arm movements: an
  experimentally confirmed mathematical model*. J. Neuroscience 5(7) — the
  minimum-jerk profile `head.js` moves along.
