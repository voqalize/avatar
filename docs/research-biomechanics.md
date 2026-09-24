# Research: the biomechanics and craft of a minimal listening face

A citation-backed reference for driving the pose channels in
[params.js](../packages/avatar/src/params.js). Every section aims at *numbers you
can put in a keyframe* — frequencies, amplitudes, durations, phase offsets —
rather than restating that faces are expressive.

Scope note: the subject is a head-and-shoulders portrait on a small video-call
tile, **listening** most of the time, with no arms or hands. Where the
literature gives a body-scale number it is converted here to the channel that
survives the crop — head, brows, lids, shoulders, torso — and the rest is
discarded.

A caution that applies throughout: our channels are normalized `-1..1`, not
degrees or centimetres, and the mapping from channel to art units differs per
avatar. Every number below is given in its own units, and what it becomes on the
rig you are actually driving is a thing to check by eye, per the project's
verify-visually rule.

---

## 1. Classical animation principles applied to minimal rigs

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

---

## 3. Conversation and backchannel science

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
  and it may be a citation slip in the review. Nothing in `packages/avatar/src/` depends on it
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

### 3.5 The two backchannel modalities want different clocks

Truong et al. (Interspeech 2011) coded 3,283 backchannels and found that the
visual and the vocal channel are not two outputs of one decision. **84 % of
visual backchannels overlap the speaker's speech**, and they land in pauses
*less* often than chance (16 % against 28.4 %, p < 0.001) — while *vocal*
backchannels fall in pauses **above** chance, at 37 %. ALICO replicates the
shape: head gestures spread uniformly across a turn, verbal feedback clusters at
turn end. So the design is **nod during speech, vocalize in the gaps**, and one
scheduler with two output modalities gets one of them wrong by construction.

The two also have to be priced differently:

- A silent nod scores 4.76/7 on attentiveness but **3.60 on facilitation, the
  worst of the conditions tested** (Kato 2025, n = 45). It says *I am listening*
  and fails to say *keep going*.
- Poppe priced the error. A spurious nod costs 0.36 "yucks", a spurious
  vocalization **1.02**, and 57.6 % of nods drew no complaint at all against
  32.6 % of vocalizations. Voice is roughly three times the downside for the
  larger reward, so it is gated harder, kept quiet and kept short.
- The failure mode is documented rather than hypothetical: TANDE (N = 36) had
  15 of 36 participants mixed or negative on its *"mhm"*, one of them reporting
  *"it felt like I was constantly getting cut off"*. That is a level-and-timing
  failure, not a modality one — and it is what firing voice on the visual
  channel's schedule produces.

**Nothing here implements the asymmetry.** It needs no signal we do not already
have.

**What a scheduler would be aiming at**, if one is built — the only acceptance
criterion this cluster has for backchannel placement:

| quantity | target | source |
|---|---|---|
| acknowledgements/min | 6–12 | Poppe acceptability band; de Kok 7.7 / 6.8 |
| opportunities taken | ~42 % | multiple corpora; Gravano's cue stack tops out at 30 % P(backchannel) |
| visual acks overlapping speech | ~0.84 | Truong 2011 |
| vocal acks inside pauses | ~0.37 | Truong 2011 |
| refractory gap | 800–1400 ms | Lala, SIGDIAL 2017 |
| visual lead over the vocal equivalent | 175–202 ms | Dittmann & Llewellyn 1968; Wlodarczak 2012 |

**The honest ceiling**, stated up front so success is not overclaimed. The best
published backchannel-timing F1 is 42.85 and the best nod-timing F1 55.93; a
human eavesdropping judge reaches 61 % precision; and even with every
backchannel-inviting cue present, only 30 % of opportunities draw a response.
**A good system declines most opportunities and is wrong about half the time it
acts.** The consequence is not to chase accuracy — it is to make being wrong
cheap: small default nods, retractable cues, voice only when confident.

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
because it genuinely shortens what the user says.

### 3.7 Blink entrainment between speaker and listener

"Eyeblinks are synchronized between listener and speaker in face-to-face
conversation, with listeners blinking with a **delay of 0.25–0.5 seconds** after
the speaker blinks. This entrainment is selectively triggered by speaker's
eyeblinks occurring at the end and during pauses in speech."
([Nakano & Kitazawa, *Eyeblink entrainment at breakpoints of speech*, Exp Brain Res 2010](https://www.researchgate.net/publication/45604519_Eyeblink_entrainment_at_breakpoints_of_speech))

We cannot see the user's blinks, so we cannot entrain. But the *converse*
matters: the avatar should place its own blinks at its own clause boundaries while
SPEAKING, because that is where a human listener expects them and where they
would entrain if they could.

### 3.8 The speaker's head: how much it moves, and on what

A listener's head is §3.3–3.4. A *speaker's* head is a different motion, and
for most of the project we had no number for it, so the speech layer was sized
by eye and came out too still. These are the numbers `packages/avatar/src/prosody.js`
is now sized against.

- **Head motion carries the voice's prosody.** Head movement alone accounted for
  **over 63 % of the variance in F0** for their talkers, and animating a talking
  head with the speaker's own natural head motion **improved intelligibility**
  of speech in noise over the same head held still. Doubling that head motion
  did **not** help: it scored no better than no motion at all.
  ([Munhall et al. 2004](https://www.queensu.ca/psychology/sites/psycwww/files/uploaded_files/Faculty/Kevin%20Munhall/Munhall_Psyc_Sci.pdf))
  **The target is natural amplitude, not maximum** — more is not safer.
- **How much, in degrees.** Busso et al. 2007 motion-captured an actor reading
  sentences and report, for **neutral speech**, the standard deviation of head
  rotation around its per-sentence mean — **pitch (nod) 3.3°, yaw 0.9°,
  roll 0.8°** — and mean per-sentence ranges of **9.5°, 2.3° and 2.3°**. Which
  physical axis his α carries is unconfirmed against the paper
  ([research-head-rotation.md](research-head-rotation.md) § 2.3), so the
  proportions are the usable part and the ranges are indicative.
  Head motion in emotional speech is "much higher" on every axis, and its
  velocity in happy and angry speech about twice neutral's. The first
  canonical correlation between head motion and prosodic features was about
  **0.7** in every emotion.
  ([Busso et al., *Rigid head motion in expressive speech animation*, IEEE TASLP 2007](https://sail.usc.edu/publications/files/bussotaslp2007.pdf))
  **Pitch is the dominant axis by about 4:1 in neutral speech.** A speaking
  head that turns side to side more than it nods has the proportions wrong.
- **Where the beats go, and what shape they are.** Graf et al. 2002 tracked a
  speaker's head against labelled prosody. Nods are **synchronised with pitch
  accents** and span 2–4 phones. Of the pitch accents, **42 % carried a nod,
  18 % a nod with an overshoot, and 20 % an abrupt swing in one direction**.
  Pitch was the strongest axis, **yaw was common and often combined with pitch
  into a diagonal, and roll was rare**. The head moved *before* the voice at
  phrase onsets in **over 70 %** of phrases. And one speaker **repeated the same
  motions**: variety between speakers, habit within one. Brow raises also fell
  on prosodic events, sometimes together with a nod.
  ([Graf, Cosatto, Strom & Huang, *Visual prosody: facial movements accompanying speech*, IEEE FG 2002](https://ieeexplore.ieee.org/document/1004186))
- **Stress and juncture.** Hadar et al. 1983 split a speaker's head motion
  into classes by frequency — **slow 0.2–1.8 Hz, ordinary 1.9–3.6 Hz, rapid
  3.7–7.0 Hz** — and found the rapid class tied to **stress** and the pattern of
  ordinary movement against *stillness* tied to **juncture**, the boundary
  between phrases. That last clause is the research statement of hold-and-move,
  and it is about a boundary rather than a resting head.
  ([Hadar, Steiner, Grant & Rose, *Head movement correlates of juncture and stress at sentence level*, Language and Speech 1983](https://journals.sagepub.com/doi/10.1177/002383098302600202))
- **How much of the time it moves at all.** The same group's polarized-light
  goniometry, recorded continuously against the speech signal, puts non-zero
  head velocity in **89.9 % of frames during speaking turns** and **12.8 % of
  frames during pauses and listening turns**. A speaking head is barely ever
  still; a listening head is still roughly seven eighths of the time. What is
  held while speaking is the *pose*, not the head — and Hadar's follow-up
  locates the postural shifts that change it at speech initiation (beginning
  *before* voice onset), between turns, and at syntactic boundaries inside one.
  None of those is a clock; they are discourse events.
  ([Hadar, Steiner, Grant & Rose, *Kinematics of head movements accompanying speech during conversation*, Human Movement Science 1983](https://www.sciencedirect.com/science/article/abs/pii/0167945783900040);
  [Hadar, Steiner & Rose, *The timing of shifts of head postures during conversation*, Human Movement Science 1984](https://www.sciencedirect.com/science/article/abs/pii/0167945784900186))
- **How often a boundary arrives.** Speech across **650 recordings in 48
  languages and 27 families** segments into intonation units at a rate of one
  every **1.6 s**, near-invariant across the sample. That is the cadence a
  speaking head's pose changes on, and the reason a phrase-driven layer needs no
  timer of its own.
  ([Inbar et al., *A universal of speech timing: Intonation units form low-frequency rhythm*, PNAS 2025](https://www.pnas.org/doi/10.1073/pnas.2425166122))

**What this means for the rig.** Hadar's rapid class is off the table for us — above
1.5 Hz a head reads as impatient (§3.4), and it costs the user's encoder — so
stress is carried by a stroke that is slow in frequency but placed on the
accent, and the phrase-scale motion does the rest: a pose held through a
phrase and changed at the boundary. A small face on a call cannot use
Busso's full ranges, so we keep his *proportions* (pitch first) inside each
rig's envelope rather than his amplitudes. Munhall's doubling result says that
is not a loss worth chasing.

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

**So the avatar must not hold `USER` continuously.** Even in LISTENING, gaze
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
  The avatar must be looking at the user when it stops talking.

Note the direction data contradicts the folk conventions: **thinking is mostly
DOWN (39 %) then side, then up** — not the up-and-left of NLP lore — and
politeness/intimacy aversion is overwhelmingly **sideways (58 %)**.

### 4.3 The gaze window, and where in it a response belongs

Bavelas, Coates & Johnson, *Listener Responses as a Collaborative Process: The
Role of Gaze*, Journal of Communication 52, 566–580 (2002). Nine dyads of
strangers telling a close-call story, 154 listener responses.

The gaze pattern is *asymmetrical*: the listener looks at the speaker for long
stretches while the speaker looks back "for frequent but much shorter periods" —
**speaker total gaze 31 %**, range 15–62 %. Because of that asymmetry the
speaker's glances are what decide whether mutual gaze happens at all. A glance
opens a brief window, the listener responds inside it, and **the response
terminates the window**: the speaker looks away and keeps talking. Terminating
without a role exchange is what distinguishes a gaze window from a turn
exchange.

| finding | figure |
|---|---|
| listener responses falling inside a gaze window | **128 of 154 = 83 %** |
| proportion of time a window was even available | **p = 0.45** |
| omnibus | z = 9.43, **p < .01 × 10⁻¹⁰**, and significant in each dyad separately |
| where in the window the response lands | **0.69 through it** — t(58) = 6.16, p < .001 against a midpoint of .5 |
| generic against specific responses differ in placement | **no** — χ²(4, N = 173) = .30, p > .05 |

The window is direct mutual gaze **plus 0.5 s**, because the speaker can still
see a response while starting to look away.

We cannot see a window open. The authors report that the opening glance is
"often redundant" with signals that can be heard — *"the speaker's gaze was
often redundant with his or her concomitant pauses, intonation contours (e.g.,
rising pitch), interactive gestures, or facial displays"* — which licenses a
pause as a proxy for it without attaching a hit rate to it.

**An open defect against this finding.** `api.attend(ms)` in
[gaze.js](../packages/avatar/src/gaze.js) is the avatar's response to a detected
window: hold the user's eyes and suppress aversion. It holds for a *flat*
duration from the moment it is called. Bavelas puts the response 0.69 through
the window and has the response end it, so the correct shape is hold, emit late
in the hold, then release — the release being the return to the aversion
schedule, which is the visible half of terminating the window. The emission side
does not exist yet, which is why this is recorded rather than fixed.

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
regardless of whether the avatar is listening, thinking or speaking. Eyes Alive's
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

**Consequences:**

- The avatar is *rendered*, so it can look straight down the barrel — 0° — and
  be the only participant in the call capable of real eye contact. This is a
  genuine advantage and argues for `USER` being a *precise* dead-centre pose.
- Because the human never achieves eye contact, the avatar must not read their
  apparent gaze-down as disengagement, and (more relevantly here) must not
  itself over-hold `USER` in compensation — it reads as staring.
- The 5° threshold gives us a *resolution floor* for gaze channels: gaze
  deviations smaller than ~5° of apparent eye rotation will not be perceived as
  "looking away" at all. Sub-threshold pupil jitter is free — it costs bitrate
  but signals nothing. This is an argument for making our micro-saccades
  slightly *larger* than natural, or dropping them.

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
  large gaze shift. Our `gaze.js` does the latter on a ramp — `BLINK_RAMP_DEG`
  on a rig that states its angles, `BLINK_RAMP_UNITS` on one that does not — so
  the odds grow with the size of the shift instead of tripping at a threshold.
  `idle.js` then holds the result to the state's own rate: an evoked blink may
  move the next blink *onto* the shift but not add one. Without that gate a
  state that shifts its gaze oftener than it blinks ends up blinking at its
  gaze's rate rather than the rate §5.1 set — `SEARCHING_SCREEN`, at 42 hops a
  minute, measured 2.12× its own authorised rate.

**A blink placed at a clause boundary is worth several blinks placed randomly.**
Since the server already sends us a viseme stream with silences in it, clause
boundaries are inferable client-side at zero protocol cost.

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
- **Micro-freeze**: a *complete stillness* is a legitimate beat rather than a
  bug, which is limited animation's oldest trick and the one our perpetually
  drifting idle never takes. A busy person's idle motion *stops*, punctuated by
  discrete moves.

The trap: without arms, "typing" can only be *implied*. The avatar should read as
"attending to something else, on a stable target, still present" — which is a
credible and honest rendering of a server doing work, and does not require the
viewer to believe in invisible hands.

---

## Sources

- Andrist, S., Tan, X.Z., Gleicher, M. & Mutlu, B. (2013). *Conversational Gaze Aversion for Virtual Agents*. IVA 2013. https://pages.cs.wisc.edu/~bilge/pubs/2013/IVA13-Andrist.pdf
- Andrist, S. et al. (2014). *Conversational Gaze Aversion for Humanlike Robots*. HRI 2014. https://dl.acm.org/doi/10.1145/2559636.2559666
- Argyle, M. & Dean, J. (1965). *Eye-Contact, Distance and Affiliation*. Sociometry 28(3). https://janetdeanfodor.wordpress.com/wp-content/uploads/2016/06/argyle-and-dean-1965-eye-contact.pdf
- Bavelas, J.B., Coates, L. & Johnson, T. (2002). *Listener Responses as a Collaborative Process: The Role of Gaze*. Journal of Communication 52(3), 566–580.
- Busso, C., Deng, Z., Grimm, M., Neumann, U. & Narayanan, S. (2007). *Rigid Head Motion in Expressive Speech Animation: Analysis and Synthesis*. IEEE TASLP 15(3). https://sail.usc.edu/publications/files/bussotaslp2007.pdf
- Doughty, M.J. (2001). *Consideration of Three Types of Spontaneous Eyeblink Activity in Normal Humans*. Optom Vis Sci. https://www.researchgate.net/publication/11653609_Consideration_of_Three_Types_of_Spontaneous_Eyeblink_Activity_in_Normal_Humans_during_Reading_and_Video_Display_Terminal_Use_in_Primary_Gaze_and_while_in_Conversation
- Frontiers (2021). *The Role of Eye Gaze in Regulating Turn Taking in Conversations*. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.616471/full
- Frontiers (2023). *Head movement and its relation to hearing*. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full
- Graf, H.P., Cosatto, E., Strom, V. & Huang, F.J. (2002). *Visual Prosody: Facial Movements Accompanying Speech*. Proc. IEEE Automatic Face and Gesture Recognition. https://ieeexplore.ieee.org/document/1004186
- Hadar, U., Steiner, T.J., Grant, E.C. & Clifford Rose, F. (1983). *Kinematics of head movements accompanying speech during conversation*. Human Movement Science 2(1–2), 35–46. https://www.sciencedirect.com/science/article/abs/pii/0167945783900040
- Hadar, U., Steiner, T.J., Grant, E.C. & Rose, F.C. (1983). *Head Movement Correlates of Juncture and Stress at Sentence Level*. Language and Speech 26(2). https://journals.sagepub.com/doi/10.1177/002383098302600202
- Hadar, U., Steiner, T.J. & Rose, F.C. (1984). *The timing of shifts of head postures during conversation*. Human Movement Science 3(3), 237–245. https://www.sciencedirect.com/science/article/abs/pii/0167945784900186
- Hömke, P., Holler, J. & Levinson, S.C. (2018). *Eye blinks are perceived as communicative signals in human face-to-face interaction*. PLOS ONE. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0208030
- Inbar, M. et al. (2025). *A universal of speech timing: Intonation units form low-frequency rhythms*. PNAS. https://doi.org/10.1073/pnas.2425166122
- Ito, K. et al. (2025). *Real-time Generation of Various Types of Nodding for Avatar Attentive Listening System*. ICMI 2025. https://arxiv.org/pdf/2507.23298
- Lee, S.P., Badler, J.B. & Badler, N.I. (2002). *Eyes Alive*. SIGGRAPH 2002. https://repository.upenn.edu/hms/51/
- Mehrabian, A. (1971). *Silent Messages* — immediacy. Summarized: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1726842/full
- Munhall, K.G. et al. (2004). *Visual Prosody and Speech Intelligibility: Head Movement Improves Auditory Speech Perception*. Psychological Science 15(2). https://www.queensu.ca/psychology/sites/psycwww/files/uploaded_files/Faculty/Kevin%20Munhall/Munhall_Psyc_Sci.pdf
- Nakano, T. & Kitazawa, S. (2010). *Eyeblink entrainment at breakpoints of speech*. Exp Brain Res. https://www.researchgate.net/publication/45604519_Eyeblink_entrainment_at_breakpoints_of_speech
- PLOS ONE (2018). *Effects of breathing movement on the reduction of postural sway during postural-cognitive dual tasking*. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0197385
- PLOS ONE (2025). *Structure of nods in conversation*. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0323448
- Rac-Lubashevsky, R. et al. (2017). *Tracking Real-Time Changes in Working Memory Updating and Gating with the Event-Based Eye-Blink Rate*. Sci Rep. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5451427/
- Rogers, S.L. et al. (2018). *Using dual eye tracking to uncover personal gaze patterns during social interaction*. Sci Rep. https://www.nature.com/articles/s41598-018-22726-7
- Trout, D.L. & Rosenfeld, H.M. (1980). *The effect of postural lean and body congruence on the judgment of psychotherapeutic rapport*. J Nonverbal Behav. https://link.springer.com/article/10.1007/BF00986818
- Truong, K.P. et al. (2011). Interspeech — an analysis of 3,283 vocal and visual backchannels: 84 % of visual backchannels overlap speech; vocal ones fall in pauses at 37 %.
- *Perception of eye contact in video teleconsultation* (2007). J Telemed Telecare. https://pubmed.ncbi.nlm.nih.gov/17288657/
- *User interface for a better eye contact in videoconferencing* (2016). Displays. https://www.sciencedirect.com/science/article/abs/pii/S0141938216300944
