# Active listening — experiment log

The design-research log behind the listening behaviours that shipped — the
`AVERSION` gaze profiles in `src/gaze.js`, the transcript-free `Boundary` tick,
and the backchannel decision function a consumer runs on top of it. It was
written as a spike under `experiments/` and moved here when that tree went; the
hypotheses below are numbered as they were proposed, and several of them lost.

**Status:** open. Started 2026-08-09.

**Question.** Within the academic research on listener behaviour, the realities of
this rig, the signals a pipecat pipeline already produces, and the computation we
already do (plus cheap CPU-only processing — no GPU, no heavy models): can we
build a *far* better listener? What works, what doesn't, and what should be
implemented properly afterwards.

**Rules for this experiment, set by the stakeholder on 2026-08-09.**

> Don't worry about the boundaries and public interface for avatar. Treat pygato
> and the brains as all part. Disregard boundaries between software systems, and
> hack your way to get the signals you want to build a responsive avatar. For this
> scope, also emit backchannel audio if you think and literature supports.

So for the duration of this spike: the library/consumer split is suspended, the
minimal-public-surface directive is suspended, and audible backchannels — banned
in the prior synthesis — are back on the table as a testable arm. Nothing here is
a proposal for what ships. The deliverable is **findings**, and a path forward.

What is *not* suspended: no GPU, no expensive CPU, nothing that degrades lipsync,
and no customer data or internal identifiers in this (public) repository.

---

## 0. The defect being attacked

The avatar currently signals "I am listening" three ways, and the literature says
all three are wrong:

| what it does now | why it is wrong |
|---|---|
| holds gaze on the user continuously in `LISTENING` | Wang & Gratch (CHI 2010, n=133): a *staring* virtual listener rated no better than one that visibly ignored the user — rapport 3.49 vs 3.34, n.s. — and was rated the most tense of three conditions. It also raised the speaker's own disfluency rate (36.75/min vs 22.44). All three conditions were rated equally natural, so this is not an animation-quality artefact. |
| fires acknowledgements at pause onsets | Truong et al. (Interspeech 2011, 3,283 backchannels): **84% of visual backchannels overlap the speaker's speech**, and they fall in pauses *less* often than chance (16% vs 28.4%, p<0.001). Pause-onset is the *vocal* channel's model, ported to the wrong modality. |
| smiles at a constant amount | Three smiles stack to a fixed corner target in `IDLE`/`LISTENING` (drawn-in art + `REST` + the `neutral` emotion pose). A signal that never varies is not a signal. |

And the whole vocabulary is nods and blinks, which is Clark & Brennan level-1/2
evidence — non-objection, not comprehension. Bavelas (JPSP 2000, 24 dyads,
Exp. 2) measured what inattention actually costs: generic responses fall only to
80% of normal (8.91 → 7.44/min) while *specific* ones collapse to under 5%
(2.21 → 0.08, η² = .62), and the narrator's story falls apart at the climax
(negative ending features 0.40 → 2.25, p<.0001). **A nod-and-smile-only avatar
emits exactly the response class that survives inattention.**

---

## 1. The signals actually available

Everything below is already computed by the pipeline, or is a few microseconds of
arithmetic on something that is. Nothing here needs a GPU or a new model.

| signal | where it comes from | what it can support |
|---|---|---|
| interim transcripts | streaming ASR | mid-turn pause structure, live text, speech-rate |
| final transcript + end-of-turn reason | turn detector | turn end, and *why* it ended |
| user speech onset/offset | VAD / ASR onset | coarse floor state (what we use today, alone) |
| turn-completion probability | turn analyzer | how much to commit to a cue |
| the bot's own last utterance | assistant aggregator | what the user is responding *to* |
| user input PCM | already reaches the avatar seat, full rate | optional prosody arm (see H7) |

The one thing the widget gets today is a coarse `speaking: bool`. That is the
entire contingency budget, and it is why the listening engine has to fall back on
`Math.random() < 0.5`.

---

## 2. Hypotheses

Each is falsifiable, has a named prediction, and says what would make me abandon
it. Ordered by expected value, not by build order.

### H1 — Breaking the gaze hold is the single biggest win
Scheduled aversion (~1.1 s every ~7 s while listening, mostly sideways; Andrist's
listening figures) beats continuous eye contact. **Prediction:** the face stops
reading as "demanding" and starts reading as "considering". **Falsified if** the
avatar reads as distracted or shifty at tile size — the aversion is legible as
inattention rather than as thought.

Note the trap on both sides: sustained gaze is a *demand for more talk*, not
attention (Rossano: sequence expanded 95% of the time when both parties keep
looking, not expanded 84% when both withdraw; Bailenson 2005: eight minutes of
unwavering gaze scored *lowest* social presence), but sustained aversion is an
ostracism cue with η²ₚ = .52–.56 and d = 1.09–2.69 (Chotpitayasunondh & Douglas,
whose stimulus was also an animated character). There is a narrow correct band and
this hypothesis is that it is Andrist's.

### H2 — Visual backchannels belong *during* speech, not at pauses
Invert the listening engine: the mid-speech nod becomes the primary path, the
pause nod the rarer emphatic one. **Prediction:** overlap fraction moves from
~0 to ~0.8, and the avatar stops looking like it is taking turns with the user.
**Falsified if** nodding over speech reads as interrupting or as impatience.

### H3 — Vocal and visual backchannels need *different* schedulers
**This is the headline hypothesis and the most novel thing here.** The same
Truong analysis that puts visual backchannels at 84% overlap puts *vocal* ones in
pauses **above** chance (37%). ALICO replicates the shape: head gestures
distribute uniformly across the turn, verbal feedback clusters at turn-end. So the
correct design is not one scheduler with two output modalities — it is **nod
during speech, vocalize in the gaps.**

Nobody in our stack has this, and it costs nothing to try. **Prediction:** the
combination reads as more attentive than either alone, because it is the first
time the avatar answers Kato's two separate questions — *am I being listened to*
(nods, which win it) and *should I keep going* (voice, which wins that one).
**Falsified if** the voice reads as interruption at any rate we can tune to.

Supporting numbers, and the reason to gate voice harder than nods: silent nodding
scores 4.76/7 on attentiveness (second best of four conditions) but **3.60 on
facilitation, the worst of all four** (Kato 2025, n=45) — a silent nod says "I am
listening" and fails to say "keep going". Against that, Poppe priced the error:
a spurious nod costs 0.36 "yucks", a spurious vocalization **1.02**, and 57.6% of
nods drew no complaint at all vs 32.6% of vocalizations. High reward, ~3× the
downside. Gate it on confidence, keep it quiet, keep it short.

The known failure mode is documented: TANDE (N=36) found 15 of 36 participants
mixed-or-negative on its "mhm", one reporting *"it felt like I was constantly
getting cut off"*. That is a level-and-timing failure, not a modality failure,
and it is exactly what H3 predicts you get if you fire voice on the visual
channel's schedule.

### H4 — Suppression is worth more than emission
The highest-value thing cheap text processing can do is not choosing a nod — it is
knowing when to do **nothing**:

- the user is mid-hesitation ("um", "and then, uh...") → hold still, and above
  all do not take the floor;
- the user has reached a story completion → a nod here claims stance access
  without taking a stance and reads as *disaffiliative* (Stivers 2008: nods at
  story completion are close to unattested in her corpus; the human repair is to
  upgrade to a fuller affective display);
- the user asked the bot a question → stop acknowledging, prepare to answer.

**Prediction:** adding only the suppression rules, with no new positive
behaviours, measurably improves the read. **Falsified if** the avatar goes flat.

### H5 — Cheap lexical affect can buy level-3 evidence
A wince, a brow-flash, a concentration frown are Clark level-3 — evidence of
*understanding*, which nods cannot supply. These cannot be selected from prosody
(Kawahara: 53.1% form accuracy against a 53.5% weighted-random baseline; Inoue:
expressives F 0.324) so they need text. **Prediction:** a lexicon-grade valence
signal is enough to avoid the catastrophic error — smiling and nodding at bad
news. **Falsified if** flatly-stated bad news ("they let me go last month") is
missed often enough that the failure mode survives; then this needs the brain,
not a lexicon.

### H6 — Nod form should be randomized, never predicted
Kato 2026 (n=60) priced each step: no nodding 1.94/7 attentiveness → stochastic
timing 4.34 → good timing 4.98 → **+ form diversity 5.66** → + *correctly
predicted* kinematics 5.69 (**null on all seven measures**, p = 1.00 on four of
them). So build a library and sample it; do not build an amplitude model.
Corpus targets: mean range **0.0706 rad ≈ 4°**, mean speed 0.1081 rad/s,
**51% single-cycle**, 33% two-cycle. Our inventory is longer and larger than that.

### H8 — The gaze window has text-side proxies, and they beat the pause alone
Raised by the stakeholder on 2026-08-09:

> Literature talks about "gaze window" — where the speaker and listener create a
> brief period of mutual gaze. We can't find that out without camera access. See
> if you have other signals that tell you about the gaze window — maybe pause (my
> theory) or presence of words like "..., right?" indicating seeking affirmation
> or similar. If we can identify this pattern — then that's where we provide the
> appropriate response.

The construct is Bavelas, Coates & Johnson, *Listener Responses as a Collaborative
Process: The Role of Gaze*, Journal of Communication 52, 566–580 (2002). Read in
full from the PDF; every number below is from the text, not a summary.

**Method.** 24 first-year psychology students, 12 dyads of strangers, one telling
the other a close-call story. Three dyads excluded for atypical speaker gaze,
leaving **9 dyads / 18 participants and 154 listener responses** (mean 17 per
dyad). First and last minute of each story analysed; mean story length 2 min 44 s.
Interanalyst agreement: >90% on packaging responses, >95% on generic-vs-specific,
83.9%/86.75% on gaze onset/offset within 0.1–0.2 s.

**The model.** The gaze pattern is *asymmetrical*: the listener looks at the
speaker for long stretches, the speaker looks back "for frequent but much shorter
periods" — measured **speaker total gaze 31%** (range 15–62%, SD 14%). Because of
that asymmetry, **the speaker's glances are what determine whether mutual gaze
happens at all.** A glance opens a brief window; the listener responds inside it;
**the response terminates the window** and the speaker looks away and keeps
talking. The termination-without-role-exchange is what distinguishes a gaze window
from a turn exchange.

**The results.**

| finding | figure |
|---|---|
| listener responses falling inside a gaze window | **128 of 154 = 83%** |
| proportion of time a window was even available | **p = 0.45** |
| omnibus | z = 9.43, **p < .01 × 10⁻¹⁰**; and significant *in each of the 9 dyads separately* |
| where in the window the response lands | **0.69 through it** — t(58) = 6.16, p < .001 against a midpoint of .5 |
| generic vs specific responses differ in placement? | **no** — χ²(4, N = 173) = .30, p > .05 |

The window is defined as direct mutual gaze **+ 0.5 s**, because the speaker can
still see a response while starting to look away. (Argyle 1967, cited there:
ordinary visual scanning fixates for 0.25–0.35 s, but gaze in dialogue runs 1–7 s.)

**Why this reframes the question.** It moves it from "when should the avatar nod"
to "when is the user *checking*" — and the second question has cheaper answers.
Three consequences fall straight out of the numbers:

1. **A window is open less than half the time (45%), and 83% of responses land in
   one.** Acknowledging outside a window is the rare case, not the default.
2. **The response belongs in the *back* of the window (0.69), not the front.** A
   backchannel fired at the instant a cue is detected is early by construction.
   Our transport's own lateness — the interim arriving after decode — is
   therefore working *with* this, not against it.
3. **The response's job includes *releasing* the speaker.** It ends the window.
   That is a second, independent argument for H3's asymmetry: a nod that
   terminates a check and hands the floor straight back is doing the whole job,
   where a vocalisation risks reading as a bid.

**And the paper hands us the substitution we need.** We cannot see the window
open — but the authors say plainly that the opening glance is *redundant with
signals we can hear* (p. 578, on the integrated-message criteria):

> "our initial inductive analysis showed that the speaker's gaze was often
> redundant with his or her concomitant pauses, intonation contours (e.g., rising
> pitch), interactive gestures, or facial displays (e.g., raised eyebrows)."

That is primary-source support for the stakeholder's pause theory, from the
gaze-window paper itself. It also names the two cues we cannot have (gesture,
facial display) and the one we cannot afford (intonation) — leaving **the pause**
as the member of that list we can actually observe. I ranked the pause below the
lexical cue on precision grounds and I stand by that ranking; but the pause is no
longer merely a plausible proxy, it is the one Bavelas measured co-occurring.

Note the honest limit: "often redundant" is qualitative — an inductive
observation reported in the discussion, with no proportion attached. It licenses
the pause as a cue. It does not tell us the hit rate.

We cannot observe the window opening. But the window is not a private event: the
speaker *does something* that opens it, and that something is what
Gravano & Hirschberg call backchannel-inviting cues. Their result is that the
cues stack — P(backchannel) rises monotonically with how many are present, and
tops out near 30% with all six. So the design is a **cue stack with a threshold**,
not a trigger.

Of their six, we can afford four and a half. Mapping against what the two
measurement runs below actually found:

| cue | our source | status |
|---|---|---|
| lexical invitation — "right?", "you know?", "yeah?", "does that make sense" | tail of the cumulative transcript, regex | **strongest and cheapest.** p95 0.078 ms; direct forms near-exact |
| a pause happened | an interim `Update` *arriving* | **real but coarse** — see the cadence measurement |
| long run of speech before that pause | inverting `frame.result["confidence"]` | **free and network-immune** — see §5 of the cadence measurement |
| syntactic completeness | tail-word blacklist | **negative half only** — "clearly incomplete" is reliable, "complete" is not |
| turn-completion probability | Flux, already computed | already on the wire |
| rising intonation / final low pitch / intensity | prosody | **not available** — and out of scope by instruction |

**Prediction:** the stack outperforms any single member, and the *lexical* member
outperforms the pause — which is the part of the stakeholder's theory I expect to
come out backwards. A pause is the noisiest cue we have (it is late, it is
suppressed 19% of the time, and most turns contain one); "right?" is unambiguous,
early, and costs 40 lines of regex.

**Falsified if** the tag-question rate in real transcripts is so low that the
lexical cue almost never fires, leaving the pause carrying the stack alone.
*That is a measurement, and it is the next one to run.*

**The design consequence is already built.** The avatar's response to a detected
window is *first* to hold the user's eyes — `api.attend(ms)`, which suppresses
aversion — and only *then*, separately, to emit anything. Two reasons to keep
them separate: a window can open and draw no response, and a response that lands
while the face is mid-look-away was never seen, so holding gaze is the
precondition rather than the reply.

**One thing `attend()` gets wrong as built, now that the paper is read.** It holds
gaze for a flat duration from the moment it is called. Bavelas puts the response
at **0.69 through** the window, and has the response *end* it. So the correct
shape is not "hold for N ms" but "hold, emit late in the hold, then release" — the
release being the avatar's own return to its aversion schedule, which is the
visible half of terminating the window. Left as-is for now because the emission
side does not exist yet; noted so it is not mistaken for a considered choice.

### H7 — Prosody is optional and probably not worth it
The stakeholder's instruction is that we do not need to process audio. The
literature agrees more than it looks: Ward & Tsukahara's famous low-pitch rule
was benchmarked by Poppe et al. (IVA 2010) at **37.69, significantly *below*
random at 43.39**, against copied human timing at 57.67, and independently
replicated by Truong et al. (2010) at **2.8% recall / 4.0% precision** on unseen
data. Both W&T corpora were non-face-to-face. **Prediction:** interim-transcript
pause structure alone matches or beats a prosodic trigger. Kept as an arm only
because the PCM is already at the seat; dropped without ceremony if H2/H3 land.

---

## 3. What "better" means — how this gets judged

Three instruments, in increasing cost:

1. **Distribution conformance (offline, objective).** Replay a recorded signal
   trace through the scheduler and compute: acknowledgements per minute, fraction
   of *visual* acks overlapping speech, fraction of *vocal* acks in pauses,
   refractory gap distribution, fraction of opportunities taken. Compare against
   the corpus targets below. This catches "we built the wrong distribution"
   without a single human judgement, and it is the only way to iterate on
   placement without making a hundred calls.

2. **The stakeholder's eye**, on the live demo. The rig has always been judged by
   looking, and every defect this project has found was found that way.

3. **User backchannel rate** as behavioural telemetry — users backchannel more at
   a listener that is working (0.42 vs 0.34/s, p<0.001; Elmers 2024). Deferred,
   but it is the measure that does not lie the way survey answers do.

**Corpus targets for instrument 1:**

| quantity | target | source |
|---|---|---|
| acknowledgements/min | 6–12 | Poppe acceptability band; de Kok 7.7 / 6.8 |
| opportunities taken | ~42% | multiple corpora; and Gravano's 6-cue stack tops out at 30% P(backchannel) |
| visual acks overlapping speech | ~0.84 | Truong 2011 |
| vocal acks inside pauses | ~0.37 | Truong 2011 |
| refractory gap | 800–1400 ms | Lala SIGDIAL 2017 |
| visual lead over the vocal equivalent | 175–202 ms | Dittmann & Llewellyn 1968; Wlodarczak 2012 |

**The honest ceiling, stated up front so success is not overclaimed.** Best
published backchannel timing F1 is 42.85; best nod-timing F1 55.93; a human
eavesdropping judge reaches 61% precision. Even with all six backchannel-inviting
cues present, only 30% of opportunities draw a response. **A good system declines
most opportunities and is wrong about half the time it acts.** The design
consequence is not to chase accuracy — it is to make being wrong cheap: small
default nods, retractable cues, voice only when confident.

And the expected null: TANDE held LLM content identical and found **no effect** on
rapport, empathy or engagement (CCR F(2,70)=0.586, p=.559), with 12 of 36
participants preferring a completely static control. Motion moves *"is it
attending"*. It does not move *"do I feel understood"*. If this experiment
succeeds, the survey still will not move; the disfluency rate and the
attentiveness read should.

---

## 4. Running notes

Newest last. Each entry: what changed, what I expected, what I saw.

### 2026-08-09 — design fixed, two unknowns sent for measurement

Before building the signal path, two things decide the shape of it, and neither
was known:

- **Interim cadence.** Deriving pause structure from interim transcripts only
  works if they arrive often enough and carry a usable clock. If they arrive
  every ~300 ms, H2/H3/H4 are all live. If they arrive every 1.5 s, pause
  detection from text is dead and H7 (prosody) is promoted from optional to
  necessary. Sent for measurement against real logged sessions.
- **Cheap-NLP latency and quality.** H4 and H5 both rest on sub-millisecond text
  analysis. The specific quality question that decides H5 is whether a lexicon
  catches *flatly-stated* bad news — "they let me go last month" carries no
  negative-valence token. I expect it does not, and if so H5 shrinks to "avoid
  smiling at obviously bad news" rather than "select an affective display".

Widget-side work (H1, H2, H6) needs neither answer and starts now.

### 2026-08-09 — measurement 1: interim cadence. **Mostly a negative result.**

Method: read the emitting code in both the ASR service and the STT server, then
measured 1,191 interim log lines over 2026-07-28 → 2026-08-05 — 241 complete user
turns containing 781 interims. (Transcripts were reduced to word counts inside the
analysis; no identifiers or utterance text left it.)

**Interims are pause-triggered, not periodic.** While the user is actually
talking, *zero* updates are produced; an `Update` is emitted when a silence run of
≥128 ms closes a segment and that segment's ASR finishes. So an interim arriving
**is** a pause event. That much of the stakeholder's theory is confirmed and free.

Everything else about it is worse than hoped:

| quantity | measured |
|---|---|
| gap between interims that carry **new words** | p50 **2518 ms** (p10 1074, p90 4656) |
| words delivered per change | median **4** — phrase batches, never word-by-word |
| turns yielding exactly **one** text change | **140 of 241 = 58%** |
| turns with ≥2 | 85 = 35% |
| text-bearing interims that are byte-identical re-deliveries | **154 of 300 = 51%** |
| interims carrying empty text (barge-in tick) | 256 of 781 = 33% |
| word-level timestamps, audio cursor, segment offsets | **all absent from the wire** |

The cadence tracks a deployed `vad_combine_min_ms = 2000` segment-combining floor
rather than the user's pauses — only 34% of gaps fall under 2 s, and the server's
own notes put the deferral rate at 19% of updates.

There is **no audio clock anywhere on the wire**: the only timestamp is
`datetime.now()` at frame construction, so every derived duration is arrival
wall-clock, and the lag includes a decode term that scales with segment length.
Measured against a server-side interval fixed at exactly 384 ms: p50 384 (a
bullseye), **p90 +844 ms late**, sd 149 ms excluding the >1 s tail.

**Consequences.**

- **H4 and the fine-grained half of H8 are dead as specified.** You cannot
  reconstruct mid-turn pause *structure* — when, and how long — from interims.
  For most turns there is nothing to reconstruct.
- **The coarse signal survives and is worth having.** "The user paused somewhere
  in the last second or two" is real, free, and correct by construction.
- **That signal is fit for the visual channel and unfit for the vocal one.** A
  nod arriving a few hundred ms after a pause onset probably lands *over* resumed
  speech, which is exactly where Truong puts 84% of visual backchannels. A
  vocalisation arriving at the same offset is late, and lateness is the failure
  mode TANDE's participants described as being cut off. H3's asymmetry gets a
  second, independent argument from the transport.
- **One genuine find: `frame.result["confidence"]` inverts exactly to cumulative
  voiced-audio milliseconds.** It is a closed-form monotone function of voiced
  frames only — no wall time, no silence — so the difference between two
  consecutive values is *exactly* how much speech sat between two detected
  pauses, quantized to 32 ms and immune to network jitter. 55 distinct values seen
  in production, so it is well-resolved. This is the only audio-domain timing we
  have, and it directly supplies H8's "long run of speech" cue.
- **The honest fix is upstream and small.** The segment window indices exist
  server-side and are discarded before serialization; adding them to the event is
  additive and backward-compatible. Logged as the path forward, not done here.

### 2026-08-09 — measurement 2: cheap NLP. **spaCy is out; VADER is worse than out.**

250 fragments × 20 reps, on the real pygato venv. Budget was 2 ms.

| candidate | load | p95 per fragment | new install |
|---|---|---|---|
| hand-rolled regex + lexicon | 1.5 ms | **0.075 ms** | 0 |
| vaderSentiment | 11 ms | 0.011 ms | 588 KB (or 0 — nltk is already a pipecat dep) |
| spaCy `en_core_web_sm`, tagger only | 392 ms | 1.01 ms | 60.8 MB |
| spaCy full pipeline | **943 ms** | **2.48 ms** (3.85 ms at 22 words) | 60.8 MB |

**spaCy is rejected.** It blows the budget from six words onward, costs 60.8 MB
and ~1 s of startup, and — the decisive part — the parser bought **zero**
additional correctness over a tail-word blacklist on syntactic completeness
(23/28 both ways), did question detection *worse* than regex, and `en_core_web_sm`
ships no sentiment component at all, so it cannot answer the affect question in
any form. One hypothesis of mine was wrong and is worth recording: I expected
spaCy to degrade on lowercase unpunctuated ASR text; it did not — 28/28 fragments
gave identical POS sequences cased vs uncased. Its errors are just errors.

**H5 is falsified in its strong form, on its own stated criterion.** The test was
whether a lexicon catches flatly-stated bad news. VADER returned **exactly 0.000
on five of five** such fragments — "they let me go last month", "the round didn't
close", "my dad's been in and out of the hospital since january". `hospital`,
`laid`, `offer`, `nightmare` are simply not in its lexicon.

And it fails in the expensive direction, not the cheap one:

- **"honestly it's been a nightmare" → compound +0.459, POSITIVE.** `nightmare`
  is absent; `honestly` scores +2.0. An avatar driven by raw VADER **smiles at
  that sentence.**
- **33% of ordinary narrative fragments (82/250) got a non-neutral label**, driven
  by conversational filler the lexicon scores as affect: `yeah` +1.2, `like`
  +1.5, `honestly` +2.0. "so yeah" → positive.

For a face, a false expression costs more than a flat one, so a 33% false-signal
rate is disqualifying by itself. Marker-stripping first and consulting VADER only
where our own lexicon is silent recovers it to 24/28 at 22% false-signal — better,
still not good enough to *drive* an expression.

**So H5 survives only in its weak form**, which is the form H4 already wanted:
an enumerated event lexicon reliably catches the handful of phrasings that must
never be smiled at, and everything beyond that is the brain's job. Sarcasm
("that went great obviously") is unrecoverable from text at any price — every
candidate called it positive.

Corollary for H4, from the same run: **the negative half of syntactic
completeness is the reliable half.** "Clearly incomplete" — a dangling
conjunction, preposition, determiner or infinitival *to* — is cheap and
high-precision. "Complete right now" is not: two-word fragments are undecidable,
and a tail-word blacklist cannot tell complementizer *that* from demonstrative
*that*. Suppression is the cheap direction. Emission is not.

### 2026-08-09 — H1 built and measured on peep

`AVERSION` profiles + scheduler in `gaze.js`; `aversion` on `IDLE`/`LISTENING`;
`api.attend(ms)` as the hold. The aversion is deliberately **additive on top of**
the ballistic head-follow — it never writes `head`, so it cannot disturb the
braking model or trip the large-shift blink — and the head takes only 0.22 of what
the eyes take. `attend()` cancels an aversion already running rather than merely
postponing the next, because a turn can end mid-look.

Deterministic trace, `body-lab?face=peep&state=LISTENING&seed=7`, 40 s: three
episodes at 7.4 s, 17.0 s, 35.4 s (plus one below the detection floor), peak
`pupilX` ±0.45 with `headYaw` ±0.10. Cadence and duration match Andrist.
`sweep()` passes.

**Open risk, and it is peep's known one.** At peak, the still frame is subtle —
CLAUDE.md's "a minimal line face swallows small deltas" applies exactly here. A
side-by-side of rest / this aversion / double head-share / a full `AWAY_*` target
shows this sitting closer to rest than to a look-away. My argument for shipping it
as authored: the excursion arrives in 55 ms, and a saccade reads as motion in a
way a still does not — a still frame is the wrong instrument for it. But this is
the first thing to raise the amplitude on if it does not read, and the head share
is the knob, not the pupil.

### 2026-08-09 — the pause tick shipped end to end, and the loop closed

The blocker all along was that **every event on the Flux wire is about
transcription**, so nothing could exist until the recognizer had run — fatal for
a listener, because an acknowledgement is due within a couple of hundred ms of a
pause *starting*. The detector already knew about the pause at the 32 ms window
and we were throwing that away for want of a transcript to hang it on.

So vql-speech now emits a **transcript-free `Boundary` tick** at every pause
(`c3be43c`), carrying the pause and speech durations plus a 300 ms prosodic read
of the tail: YIN F0 against a per-session pitch-range tracker, a 6-way terminal
classifier, `invites_response`. Measured at **1.010 ms per boundary**, numpy
only, no GPU. It is a `TurnInfo` **sub-event**, not a new top-level type, because
pipecat's `FluxEventType(event)` raises on an unknown string and returns before
its own dispatch — which also means pygato's `_handle_turn_info` override is the
*only* seat that can see it.

Deployed to speech.dev and verified serving; local pygato repointed at it.

Consumption is `_backchannel.py` — a pure decision function, clock and RNG both
the caller's. Gate order is load-bearing (kind → refractory → substance → coin)
so a seeded sequence maps one-to-one onto candidates. `eager` boundaries are
ignored outright: that pause speculatively *ends* the turn and what follows is a
content-related ack from the brain, so nodding there doubles the beat.

**Two things I changed after reading the first cut**, both against the stated
goal of not reading as canned:

- It played `NOD_SMALL` every time. The same mark every five seconds *is* the
  canned failure — a byte-identical acknowledgement stops reading as a listener
  and starts reading as a mechanism. Now a weighted draw across `NOD_SMALL` /
  `BROW_ACK` / `NOD_SLOW`, split by the acoustic reading (the continuer nod leads
  when the terminal invites a response; the brow flash leads when it does not,
  because a brow flash placed wrongly costs far less than a nod placed wrongly),
  with the previous mark suppressed. `NOD_UP` is excluded by construction: it is
  the *realization* nod, a claim about content, and a boundary carries none.
- `AVERSION.THINK` was dead — THINKING already renders the long cognitive
  look-away through `wander`. Deleted rather than left as a second mechanism
  producing the same look.

Every constant on both sides is a named starting point, commented as unfitted.
The one number with a stakeholder prior behind it is the coin: roughly half of
genuine segment boundaries get acknowledged.

**Nothing here is verified on a live call.** Whether the rate feels right, and
whether a mark at a 128 ms pause reads as listening or as a twitch, is not a
question fakes can answer. That is the next thing, and it is a human's call.

Also corrected upstream of all this: `research-biomechanics.md` §3.4 quoted
−3°/+15° as a sourced nod amplitude. The Frontiers review does say it, but
attributes it to Hendrikse et al. (2019), whose full text does not contain the
claim. Marked unverified. Nothing in `src/` depended on it — `headPitch` is
pixels, not degrees.
