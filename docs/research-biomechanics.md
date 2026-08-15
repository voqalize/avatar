# Research: the biomechanics and craft of a minimal listening face

A citation-backed reference for driving Kiran's ~30-channel parameter rig. Every
section aims at *numbers you can put in a keyframe* — frequencies, amplitudes,
durations, phase offsets — rather than restating that faces are expressive.

Scope note: Kiran is a head-and-shoulders portrait on a small video-call tile,
mostly **listening**, with no arms or hands, driven by a server that supplies a
state enum, a gaze enum, and Rhubarb A–H+X viseme letters. Where the literature
gives a body-scale number, it is converted here to the channel that survives the
crop (head, brows, lids, shoulders, torsoLean) and the rest is discarded.

A caution that applies throughout: our channels are normalized `-1..1`, not
degrees or centimetres, and the mapping from channel to art units differs per
avatar. Every number below that came from the literature is given in its own
units *and* as a suggested channel value. Those suggestions were originally
calibrated against `blue-shirt`, a rig retired on 2026-08-06 — so treat them as
a starting point to be checked by eye on the rig you are actually driving, per
the project's verify-visually rule. That was always the instruction; the
retirement only removes the temptation to trust the second number.

---

## 1. Classical animation principles applied to minimal rigs

### 1.1 The 12 principles, filtered for a face with no body

Only five of Thomas & Johnston's twelve principles have any purchase on a rig
that cannot move through space: **anticipation, staging, slow in / slow out,
secondary action, exaggeration**. Squash-and-stretch, arcs, follow-through,
overlapping action, straight-ahead-vs-pose-to-pose, solid drawing and appeal
either don't apply or are already structural in our mixer.

- **Anticipation** — the small reverse move before the main move, which
  "captivates the viewer for an action that is about to happen, involving a
  short pause before the act."
  ([NYFA](https://www.nyfa.edu/student-resources/12-principles-of-animation/),
  [Animation Mentor](https://www.animationmentor.com/blog/anticipation-the-12-basic-principles-of-animation/))
  For a head-only rig the two anticipations that pay are: (a) **a blink
  immediately before a head turn** — "an eye blink before a head turn is an
  example of anticipation in animation. It makes more sense for the character to
  blink slightly before turning their head"
  ([Animation Mentor](https://www.animationmentor.com/blog/anticipation-the-12-basic-principles-of-animation/));
  and (b) **a brow flick or a small counter-pitch before a nod**, so the nod has
  somewhere to come from.
- **Staging** — one idea at a time. On a 200px tile, two simultaneous
  expressive events cancel. If the brows are doing the work, the mouth should be
  neutral, and vice versa.
- **Slow in / slow out** — "real-life things don't start and stop instantly."
  ([StudioBinder](https://www.studiobinder.com/blog/what-are-the-12-principles-of-animation/))
  Our exponential per-channel chase already supplies this for free; the
  consequence to remember is that it *also* attenuates any target that
  oscillates faster than the channel's `TAU`.
- **Secondary action** — the supporting motion that reinforces the primary one.
  In a face this is the shoulder settle after a nod, the lid drop that
  accompanies a smile, the breath catch before speech.
- **Exaggeration** — non-negotiable at avatar size. See §2.3.

### 1.2 Head-turn and eye-lead timings from animation practice

- "The pupils favor the direction the head is turning to, which is called
  'leading' with the eyes."
  ([Ian Maigua, step-by-step head turn](https://www.tumblr.com/ianmaiguapictures/152620136909/step-by-step-guide-to-animating-a-head-turn))
- "Head turn reads well around 10–14 frames with a touch of lead/lag against
  the eyes" — i.e. **170–230 ms at 60fps** for the head, with the eyes arriving
  first.
  ([Sunstrike, Timing in Animation](https://sunstrikestudios.com/en/blog/timing_in_animation/))
- "People tend to dip their heads and close their eyes as they turn their
  heads." A head turn is therefore *three* channels — `headYaw` plus a
  transient `headPitch` dip plus a blink — not one.

Our `gaze.js` already encodes the eye-lead: pupils at `TAU = 0.032` are
effectively instant, and the head ambles after — since the 2026-08 motion
review, ballistically (`HEAD_ACCEL`/`HEAD_SPEED`: accelerate, cruise, brake to
a stop) rather than exponentially, because an exponential chase peaks at onset
and never arrives, which reads as drift; the *stop* is the cue that attention
has landed. `HEAD_FOLLOW_TAU = 0.34` survives for roll only, whose travels are
too small for the tail to show. The literature supports the direction but
suggests the head's *travel* should be under-rotated rather than merely late,
which `gaze.js` also does via the `hx`/`hy` multipliers (~0.45 of the pupil
excursion).

### 1.3 Blink timing as animators write it

Convergent numbers from several practitioner sources:

| Source | Close | Hold | Open | Total |
|---|---|---|---|---|
| [CLIP STUDIO TIPS](https://tips.clip-studio.com/en-us/articles/6096) | 2 fr | 1 fr | 3 fr | 6 fr ≈ 250 ms @24 |
| [Dark Skies](https://darkskiesfilm.com/how-to-make-blinking-animation/) | 3–5 fr | brief | 2–4 fr | 5–9 fr |
| [Animation Apprentice](https://animationapprentice.blogspot.com/2018/03/why-animators-need-to-blink.html) | — | ~2 fr | — | ~8 fr ≈ 330 ms @24 |

Two invariants across all of them:

1. **Close fast, open slow.** "A basic blinking sequence has the eyes open
   slower than they close."
   ([Bloop Animation](https://www.bloopanimation.com/blinking-animation/))
   Our `idle.js` uses a 35 % close / 65 % open split, which is squarely in the
   practitioner range.
2. **The upper lid does most of the movement, with the lower lid catching up** —
   an argument for keeping `lidL/lidR` as the blink channel and leaving
   `squintL/squintR` out of it entirely.

Note the practitioner blink (250–330 ms) is *slower* than the measured
physiological blink (§5, ~100–150 ms). This is deliberate exaggeration for
readability, and it is the right call at our size — a 110 ms blink at 60fps is
seven frames and, on a 200px tile, may be missed entirely.

### 1.4 Preston Blair's phoneme chart, and what it means for A–H

Preston Blair's chart is the ancestor of Rhubarb's alphabet. "In this series
only 10 visemes are used to map to all possible phonemes. Several sounds could
share the same mouth shape, like a closed mouth could be used during an M, B or
P sound."
([Gary C. Martin, Preston Blair phoneme series](https://www.garycmartin.com/mouth_shapes.html),
[extended series](https://www.garycmartin.com/phoneme_examples.html))

Rhubarb makes the reduction explicit and gives us permission to draw fewer
shapes than we might think:

> "Rhubarb Lip Sync can use between six and nine different mouth positions. The
> first six mouth shapes (Ⓐ–Ⓕ) are the basic mouth shapes and the absolute
> minimum you have to draw for your character. The additional three mouth shapes
> (Ⓖ, Ⓗ, and Ⓧ) are optional."
> ([rhubarb-lip-sync README](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/README.adoc))

Practical consequences for us:
- **A/B/C/D/E/F must be mutually distinguishable at avatar size; G/H/X can be
  softer.** Our discovered G-vs-B collision (noted in CLAUDE.md) is exactly the
  failure mode the chart is designed to prevent — Blair's shapes differ in
  *topology* (open/closed, teeth/no-teeth, round/wide), not in amplitude.
- The Preston Blair working method — "the best trick to getting lip synch
  looking correct is having an easy way to repeatedly preview your sequence
  along with your soundtrack ... fine tuning poses" — is what
  `authoring/lipsync-eval.html` exists to be.

**Open question — a minimum-perceptible hold.** `MIN_CUE_MS = 30` in
`visemes.js` is a *drop* threshold (cues closer than that merge), which is a
different question from whether a shape, once targeted, stays targeted long
enough to be *seen*. sl-web-speech holds consonants 90 ms explicitly so the eye
can register them — but its mouth is a hard bitmap swap with no smoothing.
Ours smooths, so a briefly-targeted shape still bends the trajectory toward
itself and reads as co-articulation; we plausibly need far less than 90 ms,
possibly nothing. No number has been derived, and none should be invented:
if the lipsync eval ever shows fast speech reading as flutter or mush, this is
the first suspect, and the answer belongs here with a citation. (Raised by the
2026-08 motion review, §5.2; measured incidence of sub-30 ms collisions in our
shipped cue tracks is 8 in 1,213 gaps, so the practical stakes today are low.)

### 1.5 Limited animation: UPA, Hanna-Barbera, anime

This is the most directly relevant tradition, because limited animation solved
*exactly* our problem: convey life with very few moving parts and a hard budget.

Techniques, from
[TV Tropes: Limited Animation](https://tvtropes.org/pmwiki/pmwiki.php/Main/LimitedAnimation),
[Grokipedia](https://grokipedia.com/page/Limited_animation), and
[Illustration History on Hanna-Barbera](https://www.illustrationhistory.org/essays/hanna-barbera-the-architects-of-saturday-morning):

- **Character layering.** "Characters are split up into different levels: only
  portions of a character, such as the mouth or an arm, would be animated on top
  of a static cel." Hanna-Barbera's economics ran on this: a held body with an
  animated mouth. *Our rig is already this, structurally.* The lesson is that
  it's a legitimate style, not a compromise — a held torso with a live face
  reads fine, and viewers have been trained on it for seventy years.
- **Static holds on poses.** Limited animation "incorporat[es] static holds on
  poses" — a *complete stillness* is a legitimate beat, not a bug. Our
  perpetually-drifting idle never gives us one. A deliberate hold before an
  answer is a strong THINKING cue.
- **Smear frames.** "Movement in only three frames: the beginning state, the
  ending state, and a 'blur' frame." Not applicable to a smoothed parametric rig
  directly, but the principle — *a fast move needs only start, end, and a hint*
  — argues against over-keying our fast gestures.
- **UPA's contribution** was "a stylized departure from the realism of full
  animation ... emphasizing artistic design, timing, and suggestion over
  detailed naturalism." Timing and suggestion, not fidelity. That is the budget
  argument for spending our effort on *when* things happen rather than on how
  many channels move.

---

## 2. Caricature and cartoon design theory

### 2.1 McCloud: amplification through simplification

Scott McCloud, *Understanding Comics* (1993): "it is by stripping down an image
to its essential meaning that an artist can amplify that meaning in a way that
realistic art can't."
([summary](https://www.mysimpleshow.com/amplification-simplification/),
[chapter notes](https://kate-nepveu.livejournal.com/116874.html))

The operative reading for a rig: every detail we *don't* draw is attention we
redirect to the ones we do. Kiran's `peep` avatar is the purest expression — a
two-value line drawing where the only things that move are the things that
signify.

### 2.2 The masking effect

"McCloud argues that characters with simple but recognizable designs, which he
terms 'iconic' characters, allow readers to project themselves into the story by
using the characters as a 'mask'. ... the more cartoon-looking a human face is,
the more the number of people it appears to describe."
([Masking (comics), Wikipedia](https://en.wikipedia.org/wiki/Masking_(comics)))

For an AI interviewer this is a *functional* argument, not an aesthetic one: a
simplified Kiran is more easily read as attentive-toward-me, because there is
less specific identity to contradict the projection. It also argues against ever
making Kiran more photoreal to "improve" the product.

### 2.3 Caricature: exaggerate the deviation from the norm

Rhodes, Brennan & Carey (1987) and Rhodes et al. (1992) established the
**superportrait effect**: "Although caricatures are often gross distortions of
faces, they frequently appear to be super-portraits capable of eliciting
recognition better than veridical depictions. This may occur because faces are
encoded as distinctive feature deviations from a prototype."
([Rhodes, *Identification and Ratings of Caricatures*, Cognitive Psychology 19](https://www.harvardlds.org/wp-content/uploads/2018/05/Rhodes-Identification-and-ratings-of-caricatures-implications-for-mental-representations-of-faces..pdf),
[Rhodes & Tremewan, *Caricature and face recognition*, Memory & Cognition 20(4)](https://link.springer.com/article/10.3758/BF03210927))

The method matters as much as the finding: caricatures were made by "comparing
the position of facial features ... with the average position for a series of
faces; deviations from the average were then accentuated by a constant fraction
(**16, 32 or 48 %**)." Anticaricatures — deviations *reduced* — were recognized
worse.

**This is directly implementable.** Our REST vector *is* the norm. Any pose
(emotion, viseme, gesture peak) is a deviation from it. Applying a global
exaggeration factor of ~1.2–1.5 to `(pose − REST)` is a numerically exact
analogue of Rhodes's 16–48 % caricature. Two caveats:

- Apply it to *expressive* deviation only, never to the idle layer. Exaggerated
  idle is jitter, which is what we are specifically avoiding on a video tile.
- Our `RANGE` already lets `head`, `mouthCorner*` and `browAngle*` past 1.0 to
  ±1.4 precisely so gesture peaks survive on top of a posed face — that is a
  caricature headroom of 40 %, in the Rhodes band, arrived at independently.

### 2.4 Simplified faces are more legible, not merely cheaper

- "Studies using high-level simplified non-real faces, such as emoticons and
  stick figures, show that **emotions are recognized more quickly with these
  cartoon faces than with real faces**."
  ([*The Influence of Key Facial Features on Recognition of Emotion in Cartoon Faces*, Front. Psychol. / PMC8382696](https://pmc.ncbi.nlm.nih.gov/articles/PMC8382696/))
- The same review notes cartoon faces "maintain low-level metric parameters and
  face proportions but lack high-level information ... such as skin texture,
  skeletal structure, and anatomic structures" — i.e. they remove exactly the
  channels that carry no emotion signal.
- Aneja et al., *Modeling Stylized Character Expressions via Deep Learning*
  (ACCV 2016), found stylized character expressions "yield clearer expressions
  than other approaches."
  ([PDF](https://homes.cs.washington.edu/~shapiro/Deepali1.pdf))

### 2.5 Uncanny valley implications

The uncanny valley literature on agents converges on **mismatch**, not realism
per se: "Subtle mismatches in an agent's appearance and behavior can lead to
perceived uncanniness resulting in a disrupted trust during human-agent
interaction."
([Tilburg, *Effect of a Virtual Agent's Appearance and Voice on Uncanny Valley and Trust*](https://research.tilburguniversity.edu/en/publications/effect-of-a-virtual-agents-appearance-and-voice-on-uncanny-valley/))

The design rule that falls out: **the behavioural fidelity budget should match
the visual fidelity budget.** A flat two-colour line drawing is allowed to blink
in 6 frames, hold perfectly still, and nod in a clean sinusoid. A photoreal head
doing the same things is a corpse. Our low visual fidelity is a *licence* for
stylized timing, and we should spend it rather than chase naturalism.

---

## 3. Conversation and backchannel science

### 3.1 What a backchannel is, and how often

Yngve (1970) coined the term: the speaker owns the front channel while "the
listener makes minimal, non-interruptive responses, forming the backchannel."
([Backchannel (linguistics) overview](https://grokipedia.com/page/Backchannel_(linguistics)))

Rates vary widely and the variance is the finding:

| Study | Language | Rate |
|---|---|---|
| Gardner (2001) | English | up to **3.33 / min** |
| Heinz (2003) | American English | **8.9 / min** |
| Heinz (2003) | German | **6.2 / min** |
| Heldner et al. (2013) | Swedish, vocal only | **8.8 / min** |
| Heldner et al. (2013) | Swedish, multimodal | **13.0 / min** |
| Mowlaei (2017) | Persian | **1.1 / min** |

(compiled in
[Frontiers in Communication, "The speaker's *okay* vs the listener's *okay*"](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2025.1655049/full))

For head nods specifically, one frequently-cited figure is "the average rate of
back-channel nods is about **1 nod every 17 seconds**" (≈3.5/min). A much higher
figure comes from a 2025 motion-capture corpus of attentive listening (§3.3),
where nodding occupied **25.9 % of total listening time** across ~654 minutes,
with 8 681 nod events — **≈13.3 nods/min, one every 4.5 s**.

The gap is real and is about *what counts as a nod*: a professional attentive
listener nods far more than a casual conversant. Kiran is closer to the former.

**Design band for Kiran while LISTENING: one visible backchannel every 4–9 s**
(our `idle.js` `minGap = 3.4`, `maxGap = 8.0` is already inside it, on the busy
end), with the *majority* being the smallest form.

### 3.2 Ward & Tsukahara's low-pitch rule — the one implementable predictor

Ward & Tsukahara (2000), *Prosodic features which cue back-channel responses in
English and Japanese*, Journal of Pragmatics 32(8):1177–1207. The rule, as
stated and widely reimplemented:

> Produce a backchannel upon detection of
> **(a)** a region of pitch less than the **26th percentile** of the speaker's
> pitch range, **(b)** continuing for at least **110 ms**, **(c)** coming after
> at least **700 ms** of speech, **(d)** provided you have not output a
> backchannel within the preceding **800 ms**, **(e)** after a **700 ms**
> delay.

([CiteSeerX PDF](https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=2c3171870effd15a96ca1378409ae3292ced1efa),
[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0378216699001095))

Low-pitch regions "indicate places where back-channel feedback is especially
appropriate," and "often co-occur with completion of a grammatical clause."

This is a *server-side* rule for us — the client never hears the candidate — but
it fixes the shape of the contract: the server should emit a backchannel token
~700 ms after a low-pitch region, and the client should render it fast enough
that the perceptual moment isn't missed. Our 40 ms cue-track lead is well within
budget.

### 3.3 Nod taxonomy: three types, with measurable amplitudes

The 2025 ICMI paper *Real-time Generation of Various Types of Nodding for Avatar
Attentive Listening System* ([arXiv:2507.23298](https://arxiv.org/pdf/2507.23298))
annotated a 90-dialogue motion-capture corpus (~8 min each) into three nod types
and published the distribution. Mean durations below are computed from their
Table 1 (time ÷ count):

| Type | Definition | Share of time | Count | **Mean duration** |
|---|---|---|---|---|
| `short` | small movement range, ± swing-up | 8.9 % | 4 227 | **0.83 s** |
| `long` | large movement range, no swing-up | 12.4 % | 3 446 | **1.42 s** |
| `long_p` | large range **with swing-up** | 4.4 % | 1 008 | **1.75 s** |
| none | — | 74.1 % | — | — |

Their functional gloss, citing prior work: "nodding co-occurring with continuer
backchannel has a smaller average range of movement, whereas that co-occurring
with assessment backchannel and lexical responses has a larger average range";
and "nodding with swinging up is regarded to reflect a **cognitive shift** in the
listener."

**This maps cleanly onto three clips we should have:**
- `NOD_SMALL` ≈ their `short` — the continuer, ~0.8 s, low amplitude. Should be
  ~50 % of all backchannels (their counts: 4227/8681 = 49 %).
- `NOD_ASSESS` ≈ their `long` — agreement/assessment, ~1.4 s, larger amplitude,
  ~40 %.
- `NOD_REALIZE` ≈ their `long_p` — the "ah, I see" nod that *starts with an
  upward swing*, ~1.75 s, ~12 %. This is a distinct authored shape (anticipatory
  up-beat then down), not a bigger `NOD_SMALL`.

### 3.4 Nod internal structure: cycles, declination, final lowering

*Structure of nods in conversation*, PLOS ONE 2025
([PMC12097566](https://pmc.ncbi.nlm.nih.gov/articles/PMC12097566/),
[PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0323448)):

- **Nod duration range observed: 0.94–1.53 s.**
- **Cycle count: single-cycle nods are 42 % of the total; lengths 1–5 cover 95 %
  of the dataset**; max observed 19 cycles. Two-cycle nods were the most frequent
  in prior work.
- **Three structural laws**, all of which our clips currently violate by having
  flat repeated cycles:
  1. **Anticipatory rising** — "the magnitude of the first cycles increases with
     length." A long nod *starts* bigger than a short one, from cycle one. The
     head knows how long the nod will be before it begins.
  2. **Declination** — magnitude decreases with cycle position at a constant
     slope of about **−0.098° per position**.
  3. **Final lowering** — the last cycle is smaller than the trend predicts by a
     further **−0.509°**.

- **Kinematic shape** — "repeated sinusoidal oscillations along the pitch axis
  combined with little movement along yaw and roll axes" (attributed there to
  Moore et al. 2005 and Kunin et al. 2007).
  ([Frontiers, *Head movement and its relation to hearing*](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full))

- **Amplitude in degrees — do not treat as sourced.** The same review states
  verbatim: "Nods naturally occur over a range of −3° (flexion) and +15°
  (extension) on the pitch axis of rotation during active listening (Hendrikse
  et al., 2019)." We quoted that as our amplitude bound. On checking, the full
  text of Hendrikse et al. (2019) does not contain the claim — so the number is
  a secondary-source assertion whose primary attribution we could not verify,
  and it may be a citation slip in the review. Nothing in `src/` depends on it
  (nod amplitude is authored in rig pixels via `headPitch`, which `face-core.js`
  maps as `p.headPitch * spec.pitchPx` — pixels, not degrees, so a degree figure
  was never directly convertible anyway). Keep it as a rough sanity range at
  most; do not cite it as evidence for a constant.

- **Nod frequency band and meaning**: "Slow nods, typically **below 1.5 Hz**,
  convey sustained attention and joint focus ... rapid nods, **exceeding 1.5 Hz**,
  signal heightened engagement or impatience."
  ([Nod (gesture) overview](https://grokipedia.com/page/Nod_(gesture)))
  **1.5 Hz is the line between "I'm with you" and "hurry up."** The avatar
  should almost never cross it.

- **Phase**: "Low-amplitude single nods were indeed found to happen **in phase
  with speakers' stressed syllables**."

Note the interaction with our smoothing: a 1.5 Hz nod against `headPitch`'s
`TAU = 0.16 s` gives ω·τ = 2π·1.5·0.16 = 1.51, so attenuation is
1/√(1+1.51²) = **0.55** and lag is arctan(1.51) = **56°** (≈104 ms). A 1.0 Hz
nod attenuates to 0.71 and lags 45°. Authored amplitudes must be roughly
**1.4–1.8× the intended rendered amplitude** in this band — consistent with the
nod pre-compensation rule in CLAUDE.md § Constraints.

### 3.5 What makes an artificial listener feel attentive vs. creepy

Gratch et al., *Creating Rapport with Virtual Agents* (IVA 2007) — the Rapport
Agent. It generated "backchannel continuers (nods, elicited by speaker prosodic
cues, that signify the communication is working), postural mirroring, and mimicry
of certain head gestures (e.g., gaze shifts and head nods) ... by real-time
analysis of acoustic properties of speech."
([PDF](https://people.ict.usc.edu/~gratch/GratchIVA07-rapport.pdf))

Findings that constrain design:

- **Contingency beats frequency.** The study's secondary question was explicitly
  "Is contingency, not just the frequency of feedback in agents, crucial when it
  comes to creating rapport?" — and contingency mattered. A **non-contingent**
  condition with *identical frequency and dynamics* but no coupling to the
  speaker was constructed as the control, and the responsive agent outperformed
  it. **Randomly-timed nods at the right rate do not buy rapport.**
- **Over-feedback backfires.** The paper notes "the Rapport Agent always
  generates bodily feedback (nods, posture shifts) in response to" speaker cues,
  and this always-on quality shows up in the results as the agent being rated
  **more distracting** and **less trustworthy** than a real human listener, and
  in speakers producing *more disfluencies* with the mediated avatar.
- **Mirroring works, but with a delay.** Bailenson & Yee's "digital chameleon"
  result is cited: participants responded better to characters that "mirrored a
  human listener's head motion with a **four second delay**." Immediate mirroring
  reads as mockery; ~4 s reads as rapport. (Burleson found no effect from a
  similar intervention — the effect is real but not robust.)

Direct implication for Kiran: the former autonomous timer in `idle.js` was
precisely the *non-contingent* condition Gratch used as a negative control. It
has been removed. Pipecat supplies factual listening posture, while the backend
is solely responsible for every explicit acknowledgement.

SimSensei Kiosk (Gratch, DeVault et al., AAMAS 2014) is the closest published
system to Kiran's use case — a virtual human interviewer conducting structured
interviews, tracking "facial expressions, gaze, and fidgeting motions" via
MultiSense.
([ACM](https://dl.acm.org/doi/10.5555/2615731.2617415))

### 3.6 Blinks as backchannels — the single most surprising finding

Hömke, Holler & Levinson, *Eye blinks are perceived as communicative signals in
human face-to-face interaction*, PLOS ONE 2018
([PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0208030),
[PMC6291193](https://pmc.ncbi.nlm.nih.gov/articles/PMC6291193/),
[MPI press release](https://www.mpi.nl/news/longer-eye-blinks-lead-shorter-answers)):

- A VR avatar listener was manipulated to produce **short (208 ms)** vs **long
  (607 ms)** blinks, holding everything else constant.
- **Speakers gave answers ~3 seconds shorter when the avatar responded with a nod
  and a long blink.** They had no conscious awareness of the manipulation.
- Interpretation: "Long blinks with nods function as a 'move on' signal of
  understanding, signaling 'I've received enough information for current
  purposes'."

Also relevant: listener blinks cluster in **feedback slots** — "listeners' blinks
occur more often at the end of a syntactically meaningful unit," at
turn-constructional-unit boundaries.

**This is a free, one-channel expressive control we are currently not using.**
`lidL/lidR` at ~0.6 s closed, co-fired with `NOD_SMALL`, is a semantically loaded
gesture ("got it, move on") that costs nothing in bitrate. Our `idle.js` already
has a `blinkLong()` at 0.34 s; the literature suggests **0.55–0.65 s** for the
"move on" reading, and that we should be careful about firing it accidentally,
because it genuinely shortens what the candidate says.

### 3.7 Blink entrainment between speaker and listener

"Eyeblinks are synchronized between listener and speaker in face-to-face
conversation, with listeners blinking with a **delay of 0.25–0.5 seconds** after
the speaker blinks. This entrainment is selectively triggered by speaker's
eyeblinks occurring at the end and during pauses in speech."
([Nakano & Kitazawa, *Eyeblink entrainment at breakpoints of speech*, Exp Brain Res 2010](https://www.researchgate.net/publication/45604519_Eyeblink_entrainment_at_breakpoints_of_speech))

We cannot see the candidate's blinks, so we cannot entrain. But the *converse*
matters: Kiran should place its own blinks at its own clause boundaries while
SPEAKING, because that is where a human listener expects them and where they
would entrain if they could.

---

## 4. Gaze and cognitive-state signalling

### 4.1 The classic ratios: listening vs speaking

Argyle & Dean (1965) and Argyle's later work:
**~61 % gaze overall, ~41 % while speaking, ~75 % while listening.**
([Argyle & Dean, *Eye-Contact, Distance and Affiliation*, Sociometry 28](https://janetdeanfodor.wordpress.com/wp-content/uploads/2016/06/argyle-and-dean-1965-eye-contact.pdf),
[summary](https://www.scienceofpeople.com/making-eye-contact/))

Kendon (1967) proposed the mechanism: gaze aversion at the *start of a speaking
turn* is a turn-holding cue. Replication is mixed — "only 42 % (Novick et al.,
1996) and 53.8 % (Kendrick and Holler, 2017) of the time speakers averted their
gaze at the start of the turn."
([Frontiers, *The Role of Eye Gaze in Regulating Turn Taking*](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.616471/full))

Distinguish two things that are often conflated:
- **Mutual face gaze**: ~60 % of a 4-minute acquaintance conversation, in bouts
  averaging **2.2 s**.
- **Mutual eye contact** (both looking at the *eyes*): **0–45 %**, in much
  briefer instances.
  ([Rogers et al., *Using dual eye tracking to uncover personal gaze patterns*, Sci Rep 2018](https://www.nature.com/articles/s41598-018-22726-7))
- Preferred mutual-gaze bout length is around **3.3 s**, comfort zone **2–5 s**.

**Kiran should therefore not hold `USER` continuously.** Even in LISTENING, gaze
should break every ~3 s or so — see the next section for the measured numbers.

### 4.2 Andrist's gaze-aversion parameters — the most directly usable table

Andrist, Tan, Gleicher & Mutlu, *Conversational Gaze Aversion for Virtual Agents*
(IVA 2013) coded 24 dyadic conversations and published exactly the timing
distributions a controller needs.
([PDF](https://pages.cs.wisc.edu/~bilge/pubs/2013/IVA13-Andrist.pdf),
[Springer](https://link.springer.com/chapter/10.1007/978-3-642-40415-3_22);
robot version: [HRI 2014](https://dl.acm.org/doi/10.1145/2559636.2559666))

**Table 1 — aversion length and placement** (Gaussian, values are mean (SD) in
seconds):

| Function | Coordinated with | Parameter | Value |
|---|---|---|---|
| **Cognitive** | cognitive event | length | **3.54 (1.26)** |
| | | start | **1.32 before** (0.47) |
| | | end | **2.23 after** (0.63) |
| **Intimacy** | while **speaking** | length | **1.96 (0.32)** |
| | | gap between | **4.75 (1.39)** |
| | while **listening** | length | **1.14 (0.27)** |
| | | gap between | **7.21 (1.88)** |
| **Turn-taking** | utterance start | frequency | **73.1 %** of turns |
| | | length | **2.30 (1.10)** |
| | | start | **1.03 before** (0.39) |
| | | end | **1.27 after** (0.51) |
| | utterance end | end | **2.41 before** (0.56) |

**Table 2 — direction of aversion, by function:**

| Function | Up | Down | Side |
|---|---|---|---|
| Cognitive | 29.4 % | **39.3 %** | 31.3 % |
| Intimacy-modulating | 28.8 % | 13.7 % | **57.5 %** |
| Turn-taking | 29.5 % | 21.3 % | **49.2 %** |

Findings: "virtual agents employing gaze aversion are **perceived as thinking**,
are able to elicit **more disclosure** from human interlocutors, and are able to
**regulate conversational turn-taking**."

Two controller rules worth copying verbatim:
- **Priority order**: cognitive aversions are planned first, then turn-taking,
  then intimacy fills the gaps.
- **Intimacy aversions are prohibited near the end of an utterance**, "so that
  virtual agents can appropriately pass the floor by maintaining mutual gaze."
  Kiran must be looking at the candidate when it stops talking.

Note the direction data contradicts the folk conventions: **thinking is mostly
DOWN (39 %) then side, then up** — not the up-and-left of NLP lore — and
politeness/intimacy aversion is overwhelmingly **sideways (58 %)**.

### 4.3 Gaze aversion under cognitive load

- "We spontaneously and consistently look away from the face of an interlocutor
  during cognitively demanding activity by engaging in gaze aversion." It "occurs
  very little when people are listening ... but predominantly occurs while
  thinking and (albeit to a lesser extent) while speaking."
  ([Doherty-Sneddon & Phelps, *Gaze aversion: A response to cognitive or social difficulty?*, Memory & Cognition 2005](https://www.researchgate.net/publication/7519027_Gaze_aversion_A_response_to_cognitive_or_social_difficulty);
  [Doherty-Sneddon et al., development of gaze aversion](https://dspace.stir.ac.uk/bitstream/1893/361/1/gazeaversionpaper9.pdf))
- Mechanism: "Gaze aversion was assumed to bring the gaze away from
  environmental distractors to optimize internal cognition such as memory
  retrieval."
  ([Salvi et al. / review, *Why and when do you look away when trying to remember?*](https://www.sciencedirect.com/science/article/pii/S0001691823002172))

### 4.4 The NLP eye-direction convention is not supported — use it anyway, carefully

"The Eye-Accessing Cues (EAC) model of NLP conveys the idea that the direction
of non-visual eye movements ... indicates the sensory system involved ... memory
retrieval would be associated with a gaze looking up to the left. However, recent
reviews showed that **the majority of the studies trying to replicate the
postulates of the EAC model did not support it**."
([Ehrlichman & Micic, *Why Do People Move Their Eyes When They Think?*, Curr Dir Psychol Sci 2012](https://journals.sagepub.com/doi/abs/10.1177/0963721412436810);
[review](https://www.sciencedirect.com/science/article/pii/S0001691823002172))

The honest position: there is **no reliable direction** for remembering vs
imagining, but the *cultural convention* (up-and-away = thinking) is legible to
audiences regardless of whether it's true of real people. Our `AWAY_THINKING`
target is up-and-left. Andrist's *measured* data says thinking aversion is more
often **down**. Recommendation: keep an up-away target for a *stylized* "let me
think" beat, but add a **down-and-away** target and use it for the longer,
genuinely-processing THINKING state, where it will read as considering rather
than as performing.

### 4.5 Saccade statistics — Lee, Badler & Badler, "Eyes Alive"

Lee, Badler & Badler, *Eyes Alive*, SIGGRAPH 2002, pp. 637–644 — the canonical
statistical eye model for talking heads.
([Penn repository](https://repository.upenn.edu/hms/51/),
[ACM](https://dl.acm.org/doi/10.1145/566654.566629))

The model "reflect[s] the dynamic characteristics of natural eye movement, which
include **saccade magnitude, duration, velocity, and inter-saccadic interval**,"
with *different distributions for talking mode and listening mode*. Their
evaluation compared stationary eyes, random saccades, and statistically-derived
saccades — statistically-derived won on naturalness.

Supporting physiology: "saccadic jumps ... are sudden and rapid ballistic
movements lasting about **30 to 120 ms** and traversing 15 to 40 degrees."
([Scholarpedia, Human saccadic eye movements](http://www.scholarpedia.org/article/Human_saccadic_eye_movements))

For us: `pupilX/pupilY` at `TAU = 0.032 s` gives a 95 % settle in ~96 ms — right
in the physiological band. The gap is that we don't vary micro-saccade
statistics by state; `idle.js` uses a fixed 0.7–2.3 s micro-jitter interval
regardless of whether Kiran is listening, thinking or speaking. Eyes Alive's
central claim is that this interval *should* differ by mode.

### 4.6 Screen-mediated gaze: the camera-vs-screen problem

This is a hard constraint on any avatar in a video tile, and it cuts in our
favour.

- "If the angle between the line from the camera to the eyes and the line from
  the eyes to the screen is more than **5 degrees**, the loss of eye contact is
  noticeable, and in the case of **15–20 degrees**, the loss of eye contact is
  inevitable." "Socially acceptable eye contact" is under **3–5°**.
  ([*User interface for a better eye contact in videoconferencing*, Displays](https://www.sciencedirect.com/science/article/abs/pii/S0141938216300944))
- Typical desktop geometry puts the human at **15–20°** off-axis — they
  structurally *cannot* make eye contact.
- "In 87 % of cases, observers perceived better eye contact at an eye gaze angle
  of 7° than 15°," and "92 % of observers responded that the difference ... was
  important to them."
  ([*Perception of eye contact in video teleconsultation*, J Telemed Telecare 2007](https://pubmed.ncbi.nlm.nih.gov/17288657/))

**Consequences for Kiran:**
1. Kiran is *rendered*, so Kiran can look straight down the barrel — 0° — and be
   the only participant in the call capable of real eye contact. This is a
   genuine advantage and argues for `USER` being a *precise* dead-centre pose.
2. Because the human never achieves eye contact, Kiran must not interpret the
   candidate's apparent gaze-down as disengagement, and (more relevantly here)
   must not itself over-hold `USER` in compensation — it reads as staring.
3. The 5° threshold gives us a *resolution floor* for gaze channels: gaze
   deviations smaller than ~5° of apparent eye rotation will not be perceived as
   "looking away" at all. Sub-threshold pupil jitter is free — it costs bitrate
   but signals nothing. This is an argument for making our micro-saccades
   slightly *larger* than natural, or dropping them.

### 4.7 What "distracted" looks like in gaze statistics

Less well-quantified, but the working signatures from the videoconferencing
literature:
- "Distraction can be determined based on a direction of gaze with respect to a
  display device, including when the direction of gaze **does not intersect the
  display device for a predetermined period**."
- "Sustained mutual gaze and synchronized gestures indicate higher
  participation," and its absence indicates the opposite.
  ([multitasking during video chats, *Communication Studies* 2025](https://www.tandfonline.com/doi/full/10.1080/10510974.2025.2499161))

The legible distinction for a rig is **duration and return behaviour**, not
direction: an attentive aversion is ~1.1 s and *returns to the user*; a
distracted aversion is >3 s, returns late, and returns *without* a re-engagement
beat (no brow raise, no nod). DISTRACTED should therefore be built as "long
aversions, absent backchannels, delayed return" rather than as any particular
pose.

---

## 5. Blink science

### 5.1 Rates by activity

| Condition | Rate (blinks/min) | Source |
|---|---|---|
| Conversation | **10.5–32.5** (range 11–36) | [Doughty 2001, *Consideration of Three Types of Spontaneous Eyeblink Activity*](https://www.researchgate.net/publication/11653609_Consideration_of_Three_Types_of_Spontaneous_Eyeblink_Activity_in_Normal_Humans_during_Reading_and_Video_Display_Terminal_Use_in_Primary_Gaze_and_while_in_Conversation) |
| Primary gaze, silent | **8.0–21.0** (range 5–26) | ibid. |
| Reading / VDT | **1.4–14.4** (range 4–14) | ibid.; [Ophthalmic Physiol Opt 2023](https://pubmed.ncbi.nlm.nih.gov/36763349/) |
| Nominal healthy adult | **15–20** | [general clinical figure](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.788231/full) |

The three-to-one spread between reading (~8/min) and conversation (~20/min) is
the actionable part: **blink rate is itself a state signal.**

### 5.2 Duration

- Physiological: "spontaneous blinking produces about **110 ms** of visual
  blackout each time"; single blinks range **100–400 ms**.
  ([Medical News Today summary](https://www.medicalnewstoday.com/articles/323963))
- Communicatively manipulated: **208 ms = "short", 607 ms = "long"** (Hömke et
  al., §3.6) — and the difference is behaviourally consequential.
- Animator's blink: **250–330 ms** (§1.3), i.e. deliberately between the two.

### 5.3 Blinks and cognitive events

- Blink rate is dopaminergically modulated and tracks working-memory operations:
  "trials that required working memory updating and trials that required gate
  switching were both associated with **increased eye-blink rate**."
  ([Rac-Lubashevsky et al., *Tracking Real-Time Changes in Working Memory Updating and Gating with the Event-Based Eye-Blink Rate*, PMC5451427](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5451427/))
- But sustained *visual* attention **suppresses** blinking: "increased demand for
  visual attention lowers the spontaneous eye blink rates while engagement of
  working memory is reflected as increased blinking."
  ([Front. Psychol. 2022](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.788231/full))
- Elevated blink rate also **predicts mind-wandering**.
  ([J. Integrative Neuroscience 2025](https://www.imrpress.com/journal/jin/24/3/10.31083/JIN26508))

This gives three cleanly separable state signatures:

| State | Blink rate | Rationale |
|---|---|---|
| LISTENING (attentive) | ~15–18/min, i.e. gap **3.3–4.0 s** | conversation baseline, slightly suppressed by attention |
| THINKING | ~22–28/min, i.e. gap **2.1–2.7 s** | working-memory engagement raises it |
| TYPING/BUSY | ~8–10/min, i.e. gap **6–7.5 s** | visual task suppression, the reading number |
| DISTRACTED | ~20–24/min, irregular | mind-wandering correlate |

Our current `BLINK_MIN = 1.9`, `BLINK_MAX = 5.4` (mean gap 3.65 s ≈ 16.4/min)
is a good LISTENING default and a poor everything-else.

### 5.4 Placement, not just rate

- Listener blinks cluster at **the end of syntactic units**, in feedback slots
  (§3.6).
- Speaker blinks cluster at **breakpoints of speech** — ends of utterances and
  pauses (Nakano & Kitazawa, §3.7).
- Animation practice adds: **blink on the head turn** (§1.2), and blink on any
  large gaze shift. Our `gaze.js` already does the latter, at
  `BLINK_THRESHOLD = 0.45`.

**A blink placed at a clause boundary is worth several blinks placed randomly.**
Since the server already sends us a viseme stream with silences in it, clause
boundaries are inferable client-side at zero protocol cost.

### 5.5 Asymmetry

The animation-practice claim ("blinks are asymmetric" — already in our
`idle.js`) is not something the physiology literature strongly supports for
*spontaneous* blinks, which are highly synchronous. It is nonetheless a
well-established stylization: a 1–2 frame offset between lids reads as organic
rather than mechanical, in the same way a perfectly-symmetric smile reads as
false. Keep it, but understand it as a *drawing* convention (§2.5 — our low
visual fidelity licenses stylized timing), not a biomechanical one.

---

## 6. Posture and micro-movement

### 6.1 Breathing

- **Normal adult resting respiratory rate: 12–20 breaths/min** (0.20–0.33 Hz).
  ([Cleveland Clinic vital signs](https://my.clevelandclinic.org/health/articles/10881-vital-signs),
  [American Lung Association](https://www.lung.org/blog/respiratory-rate-vital-signs))
  Under 12 or over 25 at rest is clinically abnormal — a useful sanity bound.
- Our `idle.js` breath runs at **0.23 Hz = 13.8 breaths/min**, correctly inside
  the resting band and at the calm end of it.
- **Quiet breathing changes chest circumference by ~2–3 %**, and that is a
  swell, not a translation. peep and wren render `breath` as a scale of the
  torso about the shirt hem (`breathSwell: 0.012`, a little over half the
  linear equivalent), so the shoulder line rises ~3 units and the chest widens
  ~4 either side against a hem that stays put; the head's lift is derived from
  the swell at the neck rather than tuned separately. The predecessor — a
  4.2-unit rigid vertical slide of the whole figure — moved *more* pixels and
  measured and read as *less* alive. A body that translates has been nudged; a
  body that swells has been filled with air.
- **Cognitive load makes breathing faster and shallower**: "the breathing rate
  was faster and the amplitude of breathing movement was smaller during
  cognitive tasks," with r = 0.75 between breathing-amplitude change and
  postural-sway change.
  ([*Effects of breathing movement on the reduction of postural sway during postural-cognitive dual tasking*, PLOS ONE 2018](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0197385))
  **THINKING should therefore raise breath frequency ~15–20 % and cut breath
  amplitude ~30 %** — a two-parameter change that is essentially free and reads
  as concentration.
- Speech reorganizes breathing entirely: a quick inbreath, then a long
  controlled outbreath over the phrase. A pre-speech **shoulder rise + breath
  spike** is the most legible "I'm about to talk" signal a head-and-shoulders
  crop can produce, which is why `params.js` already flags shoulders as a
  floor-management channel.

### 6.2 Postural sway

- Quiet standing sway is dominated by a **low-frequency band, 0.01–0.25 Hz**:
  "the largest contributor to the variance in quiet standing is low frequency
  sway (sway at 0.01–0.25 Hz)," which "is dependent on slow cortical loops and
  overall feedforward/anticipatory postural control."
  ([*Idiosyncratic Characteristics of Postural Sway*, PMC8165221](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8165221/))
- Seated trunk sway is analysed over **0.04–0.6 Hz (low) and >0.6 Hz (high)**.
  ([J Neurophysiol, sitting sway referencing](https://journals.physiology.org/doi/full/10.1152/jn.00330.2017))
- Cognitive tasks **reduce** sway (via the breathing-amplitude mechanism above).

Our idle sway frequencies — `headYaw` at 0.094/0.058 Hz, `headPitch` at
0.072/0.046 Hz, `headRoll` at 0.061 Hz, `torsoLean` at 0.085 Hz, `torsoTurn` at
0.047/0.031 Hz — sit *below* the measured band. That remains a deliberate
deviation and it is worth recording as one: we run human sway at roughly **half
speed**, which reads as calm rather than as wrong. (It was ~1/4 speed until
2026-08-06, justified by constraint 8's encoder cost. Stakeholder review said
the body read as static; the frequencies came up about 1.6× and the amplitudes
with them. Constraint 8's premise only binds a host that *re-encodes* the
avatar into a video stream — one rendering the SVG locally pays nothing — so
the trade is now exposed as `setMotionGain()` rather than baked into the
constants.)

- **Sway is not only oscillation.** The literature's low-frequency band is a
  spectrum of a continuous signal, but what a viewer registers over a 30-second
  hold is the *discrete re-settle*: weight goes onto one hip, the shoulders
  reorganise, the head counter-rolls to hold gaze. `idle.js` models this
  separately from the sinusoidal drift (`shift: [9, 22]` seconds between
  events, amplitude riding on the state's `sway` so cognitive suppression
  applies to both). Two implementation findings, both measured:
  - Drawing the new posture *uniformly about zero* measured worse than not
    shifting at all — half the draws land near the posture already held, so
    half the re-settles go nowhere and the mechanism reads as a body that only
    moves sometimes. It needs a magnitude **floor** (we use 0.16–0.42 of
    range) and a side biased away from wherever the trunk currently is.
  - Without the head's counter-roll and counter-yaw the whole figure translates
    in one piece, which reads as a camera move rather than a body. A person
    shifting their weight goes on looking at the person they are listening to.

### 6.3 Lean as an engagement signal

Mehrabian's **immediacy** framework (1971): forward lean is a core immediacy cue,
one of a family of "approach behaviors" that signal warmth and availability;
"people are drawn toward people and things they like."
([overview](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1726842/full),
[immediacy cue summary](https://www.scienceofpeople.com/torso-body-language/))

Trout & Rosenfeld (1980), *Journal of Nonverbal Behavior*, manipulated postural
lean in simulated client–therapist interactions: "forward-leaning postures
produced significantly higher ratings of rapport compared to backward lean,
**independent of what was said**," at p < .001.
([Springer](https://link.springer.com/article/10.1007/BF00986818))

`torsoLean` is therefore the highest-value-per-pixel channel we have for the
LISTENING state, and its comment in `params.js` ("in a webcam frame both are
read almost entirely as a change of scale") is the right rendering model.

### 6.4 What "typing / busy" reads as from shoulders and gaze alone

There is no direct literature on this; the reconstruction from adjacent findings:

- **Gaze**: sustained off-user fixation at a *consistent* target (not a wander),
  gaze down-and-lateral toward where a keyboard or second window would be.
  Distraction is diagnosed by gaze that "does not intersect the display device
  for a predetermined period" — busy is the same signature with a *stable*
  target, which is what distinguishes it from distracted.
- **Blink**: suppressed to the reading/VDT rate, 8–10/min (§5.3). This is
  probably the single most diagnostic cue and it costs one number.
- **Head**: small, *repetitive*, low-amplitude pitch oscillation — the
  scan-line motion of reading — rather than the smooth sway of idle. Higher
  frequency than sway, much lower amplitude than a nod.
- **Shoulders**: slightly raised and asymmetric (the classic hands-on-keyboard
  posture), and *held* — reduced sway, matching the cognitive-task
  sway-suppression finding.
- **Micro-freeze**: limited animation's "static hold" (§1.5) is exactly the
  right idiom. A busy person's idle motion *stops*, punctuated by discrete
  moves.

The trap: without arms, "typing" can only be *implied*. Kiran should read as
"attending to something else, on a stable target, still present" — which is a
credible and honest rendering of a server doing work, and does not require the
viewer to believe in invisible hands.

---

## 7. Practice: virtual agents, VTubers, game NPCs

### 7.1 Idle-animation design in games

From the practitioner literature
([MoCap Online, idle animation guide](https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide),
[MoCap Online, idle loops](https://mocaponline.com/blogs/mocap-news/idle-animation-loop),
[Genius Crate](https://www.geniuscrate.com/the-science-of-idle-animations-and-why-they-matter-in-modern-games),
[Game AI Pro 2, ch. 36, *Realizing NPCs*](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter36_Realizing_NPCs_Animation_and_Behavior_Control_for_Believable_Characters.pdf)):

- The idle is the **most-seen animation in the product**. A player standing
  still briefly, repeatedly, across a 20-hour campaign "sees the idle animation
  for over 50 minutes of total playtime." For Kiran the ratio is far more
  extreme — LISTENING is the majority state of every interview. **The idle loop
  is the product.**
- The canonical recipe: "an idle that loops seamlessly with subtle movement —
  slight breathing, a weight shift, a small head adjustment — signals to the
  player that the character is a living entity."
- **Layered structure**: a *base* idle (breathing + weight shift) plus
  *variation* animations ("look-arounds, posture adjustments, and
  character-specific personality gestures that trigger on a randomized
  schedule"). This is exactly our additive base-idle + `IdleBackchannel` clip
  architecture, independently arrived at.
- "Head turns, weight shifts, arm adjustments, and subtle breathing add
  disproportionate realism for **minimal animation investment**."
- The governing constraint, stated plainly: "balancing enough movement to feel
  alive while keeping it subtle enough not to distract."

### 7.2 VTuber / Live2D practice

([Live2D standard parameter list](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/),
[VTube Studio model settings wiki](https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings),
[physics settings explainer](https://vtubermodelcommissions.com/live2d-vtuber-model-physics-settings-explained/))

- Live2D ships a **standard parameter list** — a fixed named vocabulary
  (`ParamAngleX/Y/Z`, `ParamEyeLOpen`, `ParamBrowLY`, `ParamMouthOpenY`,
  `ParamMouthForm`, `ParamBreath`, `ParamBodyAngleX/Y/Z`) that is
  recognizably the same ~25-channel decomposition our `params.js` reached
  independently. Useful as external validation that the channel set is close to
  a natural minimum.
- **`ParamBreath` is a first-class standard parameter**, driven by an auto-breath
  toggle — breath is treated as infrastructure, not as a gesture.
- The interaction gotcha, which we have an analogue of: "if a parameter is
  overwritten by the Live2D physics system, it will be ignored in the idle
  animation." Their layering conflict is our `MOUTH_LOCK` priority rule.
- Practical advice: "limit physics inputs to what actually matters, as too many
  inputs cause unstable motion" — the same argument as CLAUDE.md's warning
  against adding channels only one avatar can render.

### 7.3 Virtual agent findings on nonverbal behaviour

- Nodding in VR functions as a genuine social signal and improves interaction
  quality.
  ([*Nonverbal communication in virtual reality: Nodding as a social signal*, IJHCS 2022](https://www.sciencedirect.com/science/article/pii/S1071581922000489))
- Backchannel *timing prediction* is the active research problem, not backchannel
  *rendering* — several systems "focused on predicting the appropriate timing for
  a robot's backchannel behavior."
  ([*A Robot That Listens*, arXiv 2509.07873](https://arxiv.org/pdf/2509.07873))
  This is more evidence for our constraint 1: the hard part is server-side, and
  our job is to render whatever it decides, well and on time.
- Survey: [*Examining the Use of Nonverbal Communication in Virtual Agents*,
  IJHCI 2021](https://www.tandfonline.com/doi/full/10.1080/10447318.2021.1898851).

---

## Design implications for our rig

Twenty-two recommendations, each tagged with the state it serves and the channels
it touches. Ordered roughly by expected value per unit of work.

1. **Split `NOD_SMALL` into three nod clips with the corpus's proportions.**
   `short` ~0.83 s / low amplitude (50 % of firings), `long` ~1.42 s / larger
   (40 %), `long_p` ~1.75 s *starting with an upward swing* (12 %). — *LISTENING*
   — `headPitch`. (§3.3)

2. **Give every multi-cycle nod declination and final lowering.** Cycle
   magnitude should decay ~10 % per cycle with an extra drop on the last, and a
   long nod should *start* bigger than a short one. Currently our repeated cycles
   are flat, which is the tell. — *LISTENING* — `headPitch`. (§3.4)

3. **Keep all nod fundamentals below 1.5 Hz.** Above that line the gesture flips
   meaning from "I'm with you" to "hurry up." Target 0.9–1.3 Hz, and remember
   the mixer attenuates a 1.5 Hz `headPitch` target to 0.55 of its authored
   amplitude — author at ~1.6× intended. — *LISTENING* — `headPitch`. (§3.4)

4. **Add a long "move-on" blink (≈0.6 s) co-fired with a nod, and treat it as a
   loaded gesture.** Hömke et al. showed it shortens speaker answers by ~3 s.
   Use it deliberately when Kiran wants to move to the next question; *never* let
   the idle layer fire it at random. Our current `blinkLong()` at 0.34 s is
   between the two studied values and probably reads as neither. — *LISTENING /
   floor management* — `lidL`, `lidR` + `headPitch`. (§3.6)

5. **Make blink rate state-dependent.** LISTENING gap 3.3–4.0 s (~16/min),
   THINKING 2.1–2.7 s (~25/min), TYPING/BUSY 6.0–7.5 s (~9/min), DISTRACTED
   ~2.5–3.0 s but with high variance. One constant per state, and it is probably
   the cheapest state differentiation available to us. — *all states* — `lidL`,
   `lidR`. (§5.1, §5.3)

6. **Place blinks at clause boundaries, not on a free-running timer.** While
   SPEAKING, blink at viseme-stream silences; while LISTENING, blink on the
   server's backchannel opportunities. A boundary-placed blink is worth several
   random ones. — *SPEAKING, LISTENING* — `lidL`, `lidR`. (§5.4, §3.7)

7. **Blink on every head turn, slightly ahead of it.** Fire the blink ~60–80 ms
   before `headYaw` starts moving, and add a transient `headPitch` dip during the
   turn. This is the one anticipation that a head-only rig can always afford. —
   *all states* — `lidL/R`, `headYaw`, `headPitch`. (§1.2)

8. **Implement Andrist's gaze-aversion controller with his measured numbers.**
   Cognitive aversion: 3.54 s long, starting 1.32 s *before* the thinking event.
   Intimacy aversion while listening: 1.14 s long, every 7.21 s. While speaking:
   1.96 s every 4.75 s. Turn-taking aversion at 73 % of utterance starts, 2.30 s
   long, beginning 1.03 s before the utterance. — *LISTENING, THINKING,
   SPEAKING* — `pupilX/Y`, `headYaw/Pitch`. (§4.2)

9. **Never look away in the last ~2.4 s before Kiran stops talking.** Andrist's
   controller explicitly prohibits intimacy aversion near an utterance end so the
   agent can pass the floor with mutual gaze. This is a floor-management rule
   with a number on it. — *SPEAKING → LISTENING transition* — `pupilX/Y`. (§4.2)

10. **Add a `AWAY_THINKING_DOWN` gaze target and use it for genuine processing.**
    Measured cognitive aversion is 39 % down, 31 % side, 29 % up — the opposite
    of the NLP convention our current up-left `AWAY_THINKING` encodes. Keep the
    up-away target for a short stylized "let me think" beat; use down-away for
    anything over ~2 s. — *THINKING* — `pupilY`, `headPitch`. (§4.2, §4.4)

11. **Make intimacy-modulating aversions sideways.** 57.5 % of them are lateral.
    A brief 1.1 s side-glance every ~7 s while listening is what stops Kiran
    reading as a stare — and it is the cheapest anti-creepy measure available. —
    *LISTENING* — `pupilX`. (§4.2, §4.1)

12. **Hold `USER` dead-centre and exact.** Kiran is the only participant in the
    call who can achieve true 0° eye contact; the human is structurally stuck at
    15–20° off-axis. Precision here is a real product advantage, and any residual
    offset in the `USER` pose is throwing it away. — *LISTENING, SPEAKING* —
    `pupilX`, `pupilY`. (§4.6)

13. **Reconsider sub-5° micro-saccades.** Gaze deviations under ~5° of apparent
    eye rotation are not perceived as looking away at all, so our 0.7–2.3 s
    micro-jitter may be paying video-encoder cost for zero signal. Either enlarge
    it past the threshold or cut it and rely on the aversion controller. —
    *LISTENING* — `pupilX`, `pupilY`. (§4.6, constraint 8)

14. **Use server-contingent backchannels; no autonomous timer.**
    Gratch's negative control was *exactly* our `IdleBackchannel`: correct
    frequency, no contingency — and it did not create rapport, while an
    always-on responsive agent was rated more distracting and less trustworthy
    than a human. Pipecat VAD may drive posture, but clip firing stays explicit
    backend/application policy. — *LISTENING* — clip firing policy. (§3.5)

15. **Adopt a caricature gain on expressive deviation from REST, ~1.2–1.5×.**
    This is Rhodes's 16–48 % exaggeration applied to our parameter space, where
    REST *is* the norm. Apply it to emotion and gesture layers only — never to
    idle, which would just become jitter. Our existing ±1.4 `RANGE` headroom on
    head, mouth corners and brow angle is already this idea. — *emotions,
    SPEAKING* — all expressive channels. (§2.3)

16. **`torsoLean` is the highest-value channel for LISTENING and is currently
    under-used.** Forward lean raised rapport ratings at p < .001 independent of
    content. A sustained +0.15–0.25 lean during attentive listening, relaxing
    toward 0 during THINKING and slightly negative during TYPING/BUSY, is a
    three-state signal in one number. — *LISTENING / THINKING / BUSY* —
    `torsoLean`. (§6.3)

17. **Modulate breath by state.** Resting 12–20 breaths/min bounds our 0.23 Hz
    (13.8/min) as correct for LISTENING. THINKING: raise ~15–20 % (to ~0.27 Hz)
    and cut amplitude ~30 %, which is the measured cognitive-load signature.
    SPEAKING: a fast inbreath then a long decay across the phrase. — *all
    states* — `breath`. (§6.1)

18. **Use a shoulder rise + breath spike as the pre-speech / floor-claim beat.**
    In a head-and-shoulders crop it is the most legible "I'd like to come in"
    signal available, and `params.js` already identifies it as such. Fire it
    ~250–400 ms before the first viseme. — *SPEAKING onset* — `shoulderL`,
    `shoulderR`, `breath`. (§6.1)

19. **Build TYPING/BUSY from four cheap cues, not from implied hands.**
    (a) blink suppressed to ~9/min; (b) gaze parked on a *stable* off-user target
    (`SCREEN_WORK`); (c) small high-frequency low-amplitude `headPitch`
    scan motion replacing the slow sway; (d) shoulders slightly raised, held,
    with sway amplitude cut ~40 %. Stability of target is what separates BUSY
    from DISTRACTED. — *TYPING/BUSY* — `lidL/R`, `pupilX/Y`, `headPitch`,
    `shoulderL/R`. (§6.4, §5.3)

20. **Build DISTRACTED as aversion *statistics*, not as a pose.** Long aversions
    (>3 s), wandering rather than stable targets, absent backchannels, and a
    *late* return to `USER` with no re-engagement beat. The absence of the nod
    is as diagnostic as the presence of the look-away. — *DISTRACTED* —
    `pupilX/Y`, clip suppression. (§4.7)

21. **Use deliberate stillness as a THINKING cue.** Limited animation's static
    hold is a legitimate beat and we currently never take one: our idle drifts
    forever. Freezing sway to near-zero for 0.8–1.5 s before an answer, then
    releasing, is both a strong cognitive signal and a bitrate *saving*. —
    *THINKING* — global idle amplitude. (§1.5, §6.2)

22. **Ensure A–F visemes differ in topology, not amplitude; G/H/X may be
    softer.** Rhubarb explicitly treats A–F as the mandatory set and G/H/X as
    optional, and Preston Blair's chart differentiates by open/closed,
    teeth/no-teeth, round/wide. Our discovered G-vs-B collision was an amplitude
    difference where a shape difference was needed — check the remaining pairs on
    the contact sheet's mouth crop at avatar size, which is the only place the
    failure is visible. — *SPEAKING* — mouth group. (§1.4, constraint 2)

### Two cross-cutting rules

- **Behavioural fidelity should match visual fidelity.** A flat two-value line
  drawing has a licence to blink in six frames, hold perfectly still, and nod in
  a clean sinusoid. Uncanniness comes from *mismatch* between appearance and
  behaviour, not from stylization. Spend the licence. (§2.5)
- **The idle loop is the product.** Kiran is LISTENING for the overwhelming
  majority of every interview. Effort spent on the listening loop compounds
  across every second of every call in a way that effort spent on any single
  gesture cannot. (§7.1)

---

## Sources

- Argyle, M. & Dean, J. (1965). *Eye-Contact, Distance and Affiliation*. Sociometry 28(3). https://janetdeanfodor.wordpress.com/wp-content/uploads/2016/06/argyle-and-dean-1965-eye-contact.pdf
- Andrist, S., Tan, X.Z., Gleicher, M. & Mutlu, B. (2013). *Conversational Gaze Aversion for Virtual Agents*. IVA 2013. https://pages.cs.wisc.edu/~bilge/pubs/2013/IVA13-Andrist.pdf
- Andrist, S. et al. (2014). *Conversational Gaze Aversion for Humanlike Robots*. HRI 2014. https://dl.acm.org/doi/10.1145/2559636.2559666
- Aneja, D. et al. (2016). *Modeling Stylized Character Expressions via Deep Learning*. ACCV. https://homes.cs.washington.edu/~shapiro/Deepali1.pdf
- Blair, P. — phoneme series, via Gary C. Martin. https://www.garycmartin.com/mouth_shapes.html and https://www.garycmartin.com/phoneme_examples.html
- Doherty-Sneddon, G. & Phelps, F. (2005). *Gaze aversion: A response to cognitive or social difficulty?* Memory & Cognition. https://www.researchgate.net/publication/7519027_Gaze_aversion_A_response_to_cognitive_or_social_difficulty
- Doughty, M.J. (2001). *Consideration of Three Types of Spontaneous Eyeblink Activity in Normal Humans*. Optom Vis Sci. https://www.researchgate.net/publication/11653609_Consideration_of_Three_Types_of_Spontaneous_Eyeblink_Activity_in_Normal_Humans_during_Reading_and_Video_Display_Terminal_Use_in_Primary_Gaze_and_while_in_Conversation
- Ehrlichman, H. & Micic, D. (2012). *Why Do People Move Their Eyes When They Think?* Curr Dir Psychol Sci. https://journals.sagepub.com/doi/abs/10.1177/0963721412436810
- Eibl-Eibesfeldt, I. — the eyebrow flash (~1/6 s), via Grammer et al., *Patterns on the Face: The Eyebrow Flash in Crosscultural Comparison*, Ethology 77. https://ui.adsabs.harvard.edu/abs/1988Ethol..77..279G/abstract
- Frontiers (2021). *The Role of Eye Gaze in Regulating Turn Taking in Conversations*. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.616471/full
- Frontiers (2023). *Head movement and its relation to hearing*. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full
- Frontiers (2025). *The speaker's "okay" vs. the listener's "okay"* (backchannel rate compilation). https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2025.1655049/full
- Game AI Pro 2, ch. 36. *Realizing NPCs: Animation and Behavior Control for Believable Characters*. https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter36_Realizing_NPCs_Animation_and_Behavior_Control_for_Believable_Characters.pdf
- Gratch, J. et al. (2007). *Creating Rapport with Virtual Agents*. IVA 2007. https://people.ict.usc.edu/~gratch/GratchIVA07-rapport.pdf
- Gratch, J., DeVault, D. et al. (2014). *SimSensei Kiosk: A Virtual Human Interviewer for Healthcare Decision Support*. AAMAS. https://dl.acm.org/doi/10.5555/2615731.2617415
- Hömke, P., Holler, J. & Levinson, S.C. (2018). *Eye blinks are perceived as communicative signals in human face-to-face interaction*. PLOS ONE. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0208030
- Ito, K. et al. (2025). *Real-time Generation of Various Types of Nodding for Avatar Attentive Listening System*. ICMI 2025. https://arxiv.org/pdf/2507.23298
- Lee, S.P., Badler, J.B. & Badler, N.I. (2002). *Eyes Alive*. SIGGRAPH 2002. https://repository.upenn.edu/hms/51/
- Live2D Cubism — Standard Parameter List. https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/
- McCloud, S. (1993). *Understanding Comics: The Invisible Art* — amplification through simplification, the masking effect. https://en.wikipedia.org/wiki/Masking_(comics)
- Mehrabian, A. (1971). *Silent Messages* — immediacy. Summarized: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1726842/full
- MoCap Online. *Idle Animation for Games: Design Guide*. https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide
- Munhall, K.G. et al. (2004). *Visual Prosody and Speech Intelligibility: Head Movement Improves Auditory Speech Perception*. Psychological Science 15(2). https://www.queensu.ca/psychology/sites/psycwww/files/uploaded_files/Faculty/Kevin%20Munhall/Munhall_Psyc_Sci.pdf
- Nakano, T. & Kitazawa, S. (2010). *Eyeblink entrainment at breakpoints of speech*. Exp Brain Res. https://www.researchgate.net/publication/45604519_Eyeblink_entrainment_at_breakpoints_of_speech
- PLOS ONE (2018). *Effects of breathing movement on the reduction of postural sway during postural-cognitive dual tasking*. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0197385
- PLOS ONE (2025). *Structure of nods in conversation*. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0323448
- Rac-Lubashevsky, R. et al. (2017). *Tracking Real-Time Changes in Working Memory Updating and Gating with the Event-Based Eye-Blink Rate*. Sci Rep. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5451427/
- Rhodes, G., Brennan, S. & Carey, S. (1987). *Identification and ratings of caricatures: implications for mental representations of faces*. Cognitive Psychology 19. https://www.harvardlds.org/wp-content/uploads/2018/05/Rhodes-Identification-and-ratings-of-caricatures-implications-for-mental-representations-of-faces..pdf
- Rhodes, G. & Tremewan, T. (1992). *Caricature and face recognition*. Memory & Cognition 20(4). https://link.springer.com/article/10.3758/BF03210927
- Rogers, S.L. et al. (2018). *Using dual eye tracking to uncover personal gaze patterns during social interaction*. Sci Rep. https://www.nature.com/articles/s41598-018-22726-7
- Thomas, F. & Johnston, O. — the 12 principles. Summaries: https://www.nyfa.edu/student-resources/12-principles-of-animation/ and https://www.studiobinder.com/blog/what-are-the-12-principles-of-animation/
- Trout, D.L. & Rosenfeld, H.M. (1980). *The effect of postural lean and body congruence on the judgment of psychotherapeutic rapport*. J Nonverbal Behav. https://link.springer.com/article/10.1007/BF00986818
- TV Tropes / Grokipedia — Limited Animation. https://tvtropes.org/pmwiki/pmwiki.php/Main/LimitedAnimation , https://grokipedia.com/page/Limited_animation
- Ward, N. & Tsukahara, W. (2000). *Prosodic features which cue back-channel responses in English and Japanese*. Journal of Pragmatics 32(8). https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=2c3171870effd15a96ca1378409ae3292ced1efa
- Wolf, D. — *Rhubarb Lip Sync* README (A–H+X mouth shapes). https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/README.adoc
- Zhang, Y. et al. (2021). *The Influence of Key Facial Features on Recognition of Emotion in Cartoon Faces*. Front. Psychol. https://pmc.ncbi.nlm.nih.gov/articles/PMC8382696/
- *Perception of eye contact in video teleconsultation* (2007). J Telemed Telecare. https://pubmed.ncbi.nlm.nih.gov/17288657/
- *User interface for a better eye contact in videoconferencing* (2016). Displays. https://www.sciencedirect.com/science/article/abs/pii/S0141938216300944
