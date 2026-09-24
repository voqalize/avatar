# The mixer's driving API — internal

> **This is not a contract and not a seam to implement.** The public surface is
> `createAvatar({ mount, client })`
> ([design-avatar-interface.md](design-avatar-interface.md)) and a
> zero-argument `AvatarProcessor()`. What the *server* sends is
> [contract-wire.md](contract-wire.md); how the client resolves it is
> [pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md).
>
> What follows is the imperative surface underneath all of that — the one
> Studio's instruments and the headless tools drive directly, and the one a
> behavior author works against. It ships under `@voqalize/avatar/internal`
> with no semver promise. Studio's *app* pointedly does not use it, and that is
> checked by the instruments being separate build entries: it is the surface an
> integrator copies from, so the app takes the published `createAvatar` and
> nothing else ([apps/studio/README.md § The rule](../apps/studio/README.md)).

## States — `setState(name, { emotion?, intensity?, gaze?, keepGaze? })`

A state is a *condition*, not an event: it holds until replaced. Each state
bundles a default gaze, emotion and idle-energy level. Passing `emotion`/`gaze`
overrides the bundle; `keepGaze: true` preserves whatever gaze was already set.

**The state list lives in `STATES` (`packages/avatar/src/avatar.js`), and that is the only
copy.** Each entry carries the perceptual reasoning for its own numbers in a
comment above it — why `THINKING` averts *downward*, why `CANT_HEAR`'s brows go
down rather than up, why `WORKING` looks at `OWN_SCREEN` and not `SCREEN_WORK`. A
table here would be a second copy that nothing forces anyone to update, and the
one that used to be here rotted exactly that way.

The enum is exported as `STATE_NAMES`, and every recipe as `STATES`.

## Emotion — `setEmotion(name, intensity = 1)`

Affect is a separate axis from state, so the enums don't multiply.
The values are `EMOTION_NAMES` in `packages/avatar/src/emotions.js`.
`intensity` scales the pose linearly toward
neutral; it is not clamped, but past ~1.3 poses saturate against channel
clamps. Entering a state *adopts that state's default emotion* unless you pass
one explicitly.

## Gaze — `setGaze(name, custom?)`

Semantic directions; the client does the oculomotor work (ballistic eyes,
lagging under-rotated head, a blink whose odds grow with the size of the shift —
Evinger: small shifts rarely carry one, large ones nearly always do). The
targets, and what each one is for, are `GAZE_TARGETS` in
`packages/avatar/src/gaze.js`; `GAZE_NAMES` is the enum.

**Floor-passing rule (server-side):** do not command a gaze aversion in the
final ~2.4 s of the agent's own utterance. Human speakers return to mutual
gaze before they stop talking; an agent that ends its turn looking away fails
to pass the floor, and the user sits waiting for a signal that never comes.
The mixer holds `SPEAKING`'s own looks away to the same rule, reading the end
of the cue track as far as it has arrived.

Gaze is also set implicitly by states; an action may temporarily override it,
then releases it when the action lands. Between turns the state the server
sends can change several times a second (`THINKING`, `WORKING`, `CANT_HEAR`), so among
those the eyes change over only once the new state has held for half a
second (`GAP_SETTLE` in `packages/avatar/src/avatar.js`); the pose changes at
once. `SPEAKING` and `LISTENING` are never held back.

**The table is drawn for a line face.** A peep pupil crosses most of its eye,
so a look can live in the eyes. On a face whose eye turns a few degrees a
pupil unit, the same numbers park the iris in the corner of the socket —
side-eye, not thought. The `oculomotor` option sizes the system per rig
(tara's is `CHARACTER_TUNING` in `packages/avatar/client/three/character-rig.ts`, with the
reasoning for each number):

- `angles` — degrees per pupil unit and per head unit, so blink odds and the
  reflex work in real angles.
- `targets` — replaces entries in the table; the head carries most of each
  look, the eyes a third of the way off centre.
- `avert` — how a conversational look away splits between eyes and neck.
- `head` — the follow's launch and cruise; a real head lands a 7–8° shift in
  about 0.4 s.
- `vor` — the vestibulo-ocular reflex, applied after every layer so it sees
  the head that is actually drawn: eyes counter-rotate against nods, speech
  pose and sway, and stay on what they look at. It also gives a large shift
  its real shape — the eye leads, the head arrives under it. One gain, or
  `{x, y}` for a face whose pitch reads weaker than its yaw.
- `range` — how far the reflex may carry the eye in the socket. Without it an
  up-look's onset put the whole look in the eye before the neck moved, which
  on a photographic eye reads as an eye-roll.
- `lidFollow` — how far the upper lid follows the eye down and up.

A face that passes none of it keeps the line-face behaviour exactly.

## Actions — `action(id)`

Finite authored clips with baked plausible timings, so they are convincing with
**no audio attached**. `packages/avatar/src/interjections.js` holds the
published ids and the authoring library they are drawn from, each clip's
duration and keyframes beside its intent. Publishing a clip says a server that
knows this renderer is mounted may ask for it, which is why it costs an edit to
`ACTION_IDS` rather than being the default.

The rules that are not visible in the keyframes:

- **The frontend never emits one autonomously.** Every nod, receipt and empathy
  beat is an explicit call. The wordless-acknowledgement family exists so a
  backend can *choose* one, not so the rig can reach for it.
- **Disagreement and dismissal are deliberately not in the action vocabulary.**
  `HEAD_SHAKE`, `HEAD_SHAKE_SOFT` and `BLINK_LONG` are authored, and stayed in
  `INTERNAL_CLIPS`: a server cannot name them and neither can a host. They are
  policy decisions rather than reflexes — `BLINK_LONG` measurably shortens what
  the user says next — and nothing has yet asked to make one.
- **A repeated clip while that clip is already playing collapses to a no-op.**
- **Mouth safety overrides everything here.** An action fired during bot speech
  contributes head, brow and body channels but not a competing mouth shape.

The spoken family (`OKAY`, `MM_HMM`, `SURE`, `SORRY`, `GO_ON`, …) carries text
and a hand-tuned viseme track: silent but plausible until real audio is
attached. Backchannels matter more than long-form speech, so these are tuned
harder than their length suggests.

## Hand gestures

The hand gestures compose a face half and a hand half; a hand rises into the
bottom of the frame and hosts never address the halves separately.

What the widget guarantees, and why it is stated here rather than left to the
drawing: **nothing but a single digit ever passes the mouth.** Mouth sync is
the headline feature, so a gesture is free to fire mid-speech. The hand also
never leaves the frame sideways and never shows a wrist — see
[authoring-a-face.md § The hand](authoring-a-face.md) for the rules and the
per-avatar check.

Degradation is silent, and it stops at the drawing. `hand: false` — a face
drawn in some other idiom, or a tile too small to spend the pixels — turns off
the **SVG hand layer**, not the gesture. The face half plays, the gesture is
still tracked, `api.gesturing` still reads the id in flight, `gestureEnd` still
fires when it lands, and `frame.hand` still reaches the rig — because `hand` is
a first-class pose channel and a custom rig may well render it
([internal-rig.md](internal-rig.md)). What a `hand: false` SVG avatar shows is
the same fallback every id had before the hand existed. An unknown id throws.

`setHandSide(+1 | -1)` picks which side of the frame the hand enters from;
`+1` (the viewer's right) is the default.

## Speech — `speak({ cues, audio?, clock? })`, `pushCues(cues)`, `stopSpeaking()`

The headline feature. A **cue** is:

```js
{ t: 1234,   // ms offset into the utterance
  v: 'D',    // Rhubarb letter A–H, or X for silence
  i: 0.8 }   // optional 0..1 loudness; omit for 1
```

Letters are the Rhubarb Lip Sync alphabet, a condensation of the Preston Blair
set; `VISEME_LETTERS` and `VISEME_SHAPES` are the one copy of what each one is.

**Clock.** Cues are scheduled against an utterance clock. Pass `audio` (an
`HTMLMediaElement`; the widget uses `currentTime` and will call `play()` if
paused) or `clock` (a `() => ms` function, for WebAudio or another supplied
epoch). Wall time is the generic widget's fallback only when neither is given.
The Pipecat adapter instead supplies elapsed time from `BotStartedSpeaking`,
because `PipecatClient` exposes output lifecycle but no browser device-playout
position. The mouth runs directly on whichever clock it is given
(`LEAD_MS = 0`); moving every cue cannot compensate for data-channel/media
skew.

The Voqalize backend's text-predicted leg has a **60 ms end-to-end** lead: it
places its wire cues 60 ms early. Accurate audio-derived cues receive no lead;
the fast leg's prediction cushion is deliberate and explicit rather than a
side-effect of renderer timing.

**Streaming.** `pushCues(cues)` appends mid-utterance — send cues in chunks as
TTS produces them; the merged track is re-normalized each push. Tail
*replacement* is the driver's job, not this API's: `speak()` replaces and
`pushCues()` only appends, so `AvatarClient` keeps the turn's canonical track,
discards queued cues at or after `from_ms`, appends, and re-issues `speak()`
when anything was discarded. That is how the backend's fast text-predicted cues
are overwritten by audio-recognized ones mid-turn without the widget ever
seeing a seam.

**Normalization parity.** The Python wire normalizer and the browser normalizer
share visible-cue conformance cases in
`packages/avatar/test/fixtures/viseme-normalization.json`. Both preserve the
same `(t, v)` sequence; Python additionally retains phones and the browser adds
local intensity defaults. A normalizer change is incomplete until both tests
accept that fixture.

`speak()` auto-enters `SPEAKING` and kills any spoken action in flight. It takes
the state's own gaze — the eyes go to the user with the first word — unless a
performance aimed them with its `gaze` verb, which is kept. It used to keep
whatever gaze it found, which left a reply that began mid-look pointed away for
its whole turn. `speakEnd` fires when the track completes.

**Around the mouth.** The same track drives the speaker's head, brows and
breath, none of which is the mouth (`packages/avatar/src/prosody.js`, which has
the citations; the numbers it is sized against are
[research-biomechanics.md §3.8](research-biomechanics.md)):

- a blink at each pause of 250 ms or more and at the end of the utterance,
  which re-arms the free-running blink timer;
- a head that is **held, and moved**, never drifting (`head.js`). Each phrase
  gets a pose — usually on the other side from the last, yaw and roll together
  — and the head goes there on a minimum-jerk path that starts inside the pause
  before the phrase, so it moves before the voice. Between moves the head
  output does not change at all;
- into a pause of 400 ms or more, an in-breath that peaks at the resumption;
- beats, at most about one a second, on open vowels whose length × `i` stands
  clearly above their neighbours, in phrases long enough to carry one. A beat
  is brows up and, usually, a head stroke: a nod down and back in about 0.4 s,
  sometimes with some yaw, or — after a long hold — a swing to a new pose
  (Graf's one-way movement). Some beats leave the head alone;
- a chin settle on the final vowel of each phrase, held into the pause. That
  vowel is never a beat candidate, since final lengthening marks a boundary
  rather than an accent;
- warmth — corners up, a hint of squint — in episodes, never through the middle
  of a turn. A small one as the turn opens; a real smile, about 2.6 s held,
  as it plays out and the floor passes; and a short one with an explicit
  `ACK_NOD` or `ACK_RECEIVE`, at most one per 4 s so a run of continuers does
  not hold the face up. Overlapping episodes take the larger, not the sum.
  `RESPONSE_INTERRUPTED` drops it at once: a smile that survives being cut off
  has not noticed. It is suppressed while the emotion or the playing clip turns
  the corners down.

A flat phrase gets no beat, because random brow raises do not help. The layer
only reads the track, so it cannot move the mouth. Its head and brows are
silent while an action's clip is playing, since the clip already owns them;
the warmth is not, because an acknowledgement's smile comes with its nod. A
rig whose units are smaller than peep's scales it with `prosodyHeadGain` and
`prosodyFaceGain`; the poses, beats and warmth then stay in proportion.

The shape before this one summed a lead-in, a phrase drift and beat envelopes
into a head that was in motion from the first word to the last. Each part was a
movement the literature measured; on a recorded call the sum read as a
screensaver. Motion is judged from a recorded call now, not from per-sentence
statistics alone.

### The mouth priority rule (invariant)

**Server viseme track > clip mouth track.** While a server track plays, it
owns the mouth outright: an action fired mid-utterance contributes head
and brows only, and its mouth track is dropped. There is deliberately no third
tier: with no cues the mouth stays shut rather than being guessed at from the
bot's audio level. Anything that degrades this ordering is a regression.

## The user's voice — `setUserSpeaking(bool)`

`AvatarClient` calls this from `UserStartedSpeaking` and `UserStoppedSpeaking`.
It changes only the sustained engagement lean: the avatar leans in while the
user holds the floor and relaxes slowly after a pause. It never creates a clip.
In particular it never emits a nod, brow acknowledgement or any other
conversational reaction.

## Composing behavior: `perform(actions, { audio?, clock?, onAction? })`

The composition surface: a list of timed verbs fired against a clock, each
resolving to one of the enums above. **A server cannot send one of these** —
`perform` is not on the wire, and deliberately so; this is a local authoring
surface only. **There is no `speak` verb**: speech defines the clock a
performance rides on, and a timeline that could start new audio would be a
clock inside a clock, which would then have to answer for the cue track too.
The verbs, their arguments and their hygiene rules are in
`packages/avatar/src/avatar.js`.
## Smoothing — what a keyframe actually renders as

Every channel is a first-order chase toward its target with its own time
constant τ ([internal-rig.md § The pose channels](internal-rig.md) has the
table). **A clip's keyframes are not what the face does; the smoothing between
them is**, and the gap is large enough to author against:

- A channel chasing a target oscillating at ω rad/s renders at
  `1/sqrt(1 + (ω·τ)²)` of the authored amplitude, and arrives `arctan(ω·τ)`
  late.
- The head's τ is 160 ms, so a nod at the top of the usable band — ~1.5 Hz,
  ω ≈ 9.4 — renders at ~0.55 of what is written and lags ~56°. **Nod peaks are
  authored pre-compensated**: a rendered 0.30 is written ~0.55.
- Channels with differing τ therefore phase-shift relative to each other for
  free. Brows (80 ms) lead the head (160 ms) which leads the trunk (440 ms)
  with no authored offset at all, which is most of why the body reads as one
  connected thing.

The practical rule: **author a deliberate lead or lag on top of what the mixer
already supplies, not from zero.** A gesture that "feels late" in the keyframes
is usually a channel whose τ you have paid for twice.

## The held-head budget — `headHold`

The layers that hold a head pose — the state's attitude, the gaze (a look's
head share, and its drift), a phrase's pose while speaking, and the idle posture
— do not know about each other. Each stays small; every so often they all point
the same way, and the head arrives somewhere no one layer asked for. On a
drawing that is merely a large turn. On a 2.5-D photograph it is
past where the asset holds together — and since the two conversational states
are almost the whole of a call, it is where the face is judged.

`headHold` is per axis, in pose units, and the rig supplies it, because how far
a face can hold its head off centre is a measurement of *that* drawing or
photograph. The sum of the held layers is folded into it by `soften`
([head.js](../packages/avatar/src/head.js)): identity below 70 % of the
budget — where a recorded minute of either state spends its median — and an
exponential approach above, so the limit is reached only in the limit and the
head never stops dead at a stop. Only the excess is taken off, and only off the
hold: a nod, a beat and a clip delta are transients, they are read as movement
rather than as a pose, and they keep every degree they were authored with.

An axis left out is unbudgeted, which is every face that has never been
measured. `packages/avatar/test/three/presence.test.ts` is where the two states
are measured against it, in degrees.

The events, gains and getters are declared and documented in
[`packages/avatar/src/avatar.d.ts`](../packages/avatar/src/avatar.d.ts),
hand-maintained beside `avatar.js`.
