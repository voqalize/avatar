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

Everything below is reachable from one import:

```js
import { createAvatar } from './src/avatar.js';
import peep from './src/face-peep.js';
const avatar = createAvatar({ mount: '#avatar', face: peep });
```

`mount` and one of `face` / `rig` are required — `createAvatar` throws without
them. A face is the `{ create, meta }` value a face module default-exports, not
a name: a name would need a table, and a table would pull all three drawings
into a consumer's bundle to render one. The rest are optional:
`theme` (palette overrides), `rig` + `rigOptions` (a non-SVG renderer, which
suppresses `face`), `hand: false` and `handSide` (the frame-edge hand),
`sequences` (the renderer's own addressable motions, which can only add to
this renderer's published ones) and `actions` (the renderer's own *shape* for a
published action — same id, same intent, keys sized for its body; an id this
renderer does not publish throws, so it can reshape the catalogue and never grow
it),
`mouthGain`, `gestureGain`, `motionGain`, `prosodyHeadGain`, `prosodyFaceGain`,
`saccadeGain` and `aversionGain` (eye-movement sizes for a face whose pupil
units are small), `trunkFollow` (the trunk's share of a sustained head turn,
0.45 unless a rig sizes it), `oculomotor` (the eye-head calibration, § Gaze),
`states` (a rig's own rendering of a state: each entry replaces that state's
fields whole, and an unknown state throws), and `manual` (no internal rAF loop —
you call `tick` yourself, which is how the headless tools get deterministic
frames).

All setters are chainable. Unknown state, action and gesture ids **throw**;
unknown emotion falls back to `neutral` silently; unknown gaze falls back to
`USER` silently.

## States — `setState(name, { emotion?, intensity?, gaze?, keepGaze? })`

A state is a *condition*, not an event: it holds until replaced. Each state
bundles a default gaze, emotion and idle-energy level. Passing `emotion`/`gaze`
overrides the bundle; `keepGaze: true` preserves whatever gaze was already set.

**The state list lives in `STATES` (`packages/avatar/src/avatar.js`), and that is the only
copy.** Each entry carries the perceptual reasoning for its own numbers in a
comment above it — why `THINKING` averts *downward*, why `CANT_HEAR`'s brows go
down rather than up, why `WORKING` looks at `OWN_SCREEN` and not `SCREEN_WORK`. A
table here would be a second copy that nothing forces anyone to update, and the
one that used to be here rotted exactly that way: it documented a `TYPING` state
for weeks after the state was renamed `WORKING`.

The enum is exported as `STATE_NAMES`, and every recipe as `STATES`.

Nine of them are the behavior vocabulary — `IDLE`, `LISTENING`, `CANT_HEAR`,
`THINKING`, `WORKING`, `MUTED`, `SPEAKING`, `DEGRADED`, `OFFLINE`
([contract-behavior.md](contract-behavior.md)), of which a server may send three.
The rest are render states reachable only through `setState`, which is whose
states they are.

## Emotion — `setEmotion(name, intensity = 1)`

Affect is a separate axis from state, so the enums don't multiply.
Six values (`EMOTION_NAMES`): `neutral`, `warm`, `curious`, `concerned`,
`encouraging`, `thoughtful`. `intensity` scales the pose linearly toward
neutral; it is not clamped, but past ~1.3 poses saturate against channel
clamps. Entering a state *adopts that state's default emotion* unless you pass
one explicitly.

## Gaze — `setGaze(name, custom?)`

Semantic directions; the client does the oculomotor work (ballistic eyes,
lagging under-rotated head, a blink whose odds grow with the size of the shift —
Evinger: small shifts rarely carry one, large ones nearly always do). Fourteen
names (`GAZE_NAMES`):

| target | meaning |
|---|---|
| `USER` | down the webcam barrel — the conversational default |
| `USER_EAR` | still on the user, head cheated aside so an ear favors the speaker — the "trying to hear you" attitude. Head-follow and pupils point opposite ways, which is what keeps it reading as contact |
| `SCREEN_CENTER` / `SCREEN_LEFT` / `SCREEN_RIGHT` / `SCREEN_TOP` / `SCREEN_BOTTOM` | regions of the shared screen |
| `SCREEN_WORK` | lower-left work area of the shared screen |
| `NOTES` | down-right glance at the agent's own notes |
| `OWN_SCREEN` | the agent's own display, just under the camera — eyes a little down, head nearly level. Where `WORKING` reads and `OFFLINE` waits |
| `AWAY_THINKING` | up-left "recalling" break of eye contact — the stylized "let me think" beat |
| `AWAY_RIGHT` | up-right variant |
| `AWAY_DOWN` | down-left considering — measured cognitive aversion is mostly downward, but on a realistic face a down look reads as downcast, so `THINKING` keeps it to a fifth of its looks |
| `AWAY_SIDE` | level, to the right — the sideways third of cognitive aversions |

Escape hatch: `setGaze('CUSTOM', { x, y })` with normalized −1..1 screen
coordinates, for when the server knows exactly where something is. (Any name
plus a `custom` object works; the coordinates win.)

**Floor-passing rule (server-side):** do not command a gaze aversion in the
final ~2.4 s of the agent's own utterance. Human speakers return to mutual
gaze before they stop talking; an agent that ends its turn looking away fails
to pass the floor, and the user sits waiting for a signal that never comes.
The mixer holds `SPEAKING`'s own looks away to the same rule, reading the end
of the cue track as far as it has arrived.

Gaze is also set implicitly by states; an action may temporarily override it,
then releases it when the action lands. Between turns the state the server
sends can change several times a second (`THINKING`, `WORKING`, `CANT_HEAR`), so among
those three the eyes change over only once the new state has held for half a
second (`GAP_SETTLE` in `packages/avatar/src/avatar.js`); the pose changes at
once. `SPEAKING` and `LISTENING` are never held back.

**The table is drawn for a line face.** A peep pupil crosses most of its eye,
so a look can live in the eyes. On a face whose eye turns a few degrees a
pupil unit, the same numbers park the iris in the corner of the socket —
side-eye, not thought. The `oculomotor` option sizes the system per rig
(tara's is `TARA_TUNING` in `packages/avatar/client/three/tara-rig.ts`, with the
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
**no audio attached**. `packages/avatar/src/interjections.js` holds two lists, each clip's
duration and keyframes beside its intent:

- `ACTION_IDS` / `ACTIONS` — the seven *this renderer* publishes, which is not
  the wire's vocabulary: that one is open and requires only `ACKNOWLEDGE` and
  `RESPONSE_INTERRUPTED` ([contract-wire.md](contract-wire.md) § Action).
  `ACKNOWLEDGE` is absent from the list because it is not a clip — `action()`
  resolves it on the floor, to `ACK_NOD` while the user is speaking and
  `ACK_RECEIVE` once they have stopped. An id in neither list and in no
  `sequences`/`actions` an avatar passed is a **no-op**, not a throw, because an
  open vocabulary makes a name this face cannot draw the expected case.
- `INTERNAL_CLIPS` — the full authoring library the seven are drawn from, ~33
  clips. It is a *timeline* library, not a second action vocabulary: nothing on
  the mixer's surface takes one of its ids, and the instrument that reviews them
  — Studio's filmstrip — drives a bare `ClipPlayer` instead. That
  asymmetry is on purpose — publishing a clip says a server that knows this
  renderer is mounted may ask for it, and that should cost an edit to
  `ACTION_IDS`.

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

`GESTURE_GREET`, `GESTURE_GOODBYE`, `GESTURE_APPROVE` and `GESTURE_WAIT`
compose a face half and a hand half. A hand rises into the bottom of the frame;
hosts never address the halves separately.

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

Letters are the Rhubarb Lip Sync alphabet (a condensation of the Preston Blair
set): `A` closed (P/B/M), `B` teeth together (most consonants), `C` open,
`D` wide open, `E` rounded, `F` puckered, `G` lip-to-teeth (F/V), `H` tongue up
(L), `X` silence. Exported: `VISEME_LETTERS`, `VISEME_SHAPES`.

Rules the widget enforces (`normalizeCues`, applied to every track):

- cues are sorted by `t`; consecutive duplicates merge;
- cues shorter than **30 ms** are dropped — except that a closure (`A`/`G`)
  replaces the cue it collapses into, because closures carry the most
  lip-reading information;
- unknown letters become `X`.

So the server may emit noisy tracks; it should still try to end every
utterance with an explicit `X` cue (the track only completes on a trailing
`X`).

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

The composition surface. A **performance** is a list of timed verbs fired
against a clock; each verb resolves to one of the enums above. This is how a
backend assembles a turn locally: it sequences from a constrained vocabulary and
cannot invent motion — every visible move is something that was authored
and tuned on the rig.

```js
{ "t": 4200, "do": "emotion", "name": "warm", "i": 0.8 }
{ "t": 5100, "do": "gaze",    "name": "SCREEN_WORK" }
{ "t": 6300, "do": "action",  "id": "ACK_NOD" }
{ "t": 8000, "do": "state",   "name": "WAITING_FOR_USER" }
```

| verb | args | dispatches to |
|---|---|---|
| `state` | `name`, `keepGaze?` (default **true**) | `setState(name, {keepGaze})` |
| `emotion` | `name`, `i?` 0..1 (default 1) | `setEmotion(name, i)` |
| `gaze` | `name` | `setGaze(name)` |
| `action` | `id` | `action(id)` |

**A server cannot send one of these.** `perform` is not on the wire, and
deliberately so; this is a local authoring surface only.
Studio's scripted take reads a turn as data and plays it through them:

```js
avatar.speak({ cues, audio });          // the utterance
avatar.perform(turn.beats, { audio });  // its choreography, same clock
```

Rules:

- **Clock** resolves like `speak()`: explicit `clock` fn > `audio.currentTime`
  > ms elapsed since the call. Ride the audio element you speak with.
  `perform` never starts or stops audio — `speak` owns the sound.
- **Times fire verbatim** — no `LEAD_MS`. Visemes lead the audio because
  phoneme sync is frame-critical; gestures arrive through their channels'
  smoothing lag, and any deliberate lead is authored into `t` by the composer.
- **There is no `speak` verb.** Speech defines the clock a performance rides
  on; a timeline that could start new audio would be a clock inside a clock,
  and stopping it would have to answer for the cue track too. The utterance
  and its choreography stay sibling calls against the same element.
- **`state` defaults to `keepGaze: true`** inside a performance: a timeline
  that wants the gaze moved says so with a `gaze` verb at the moment it means.
- **Hygiene** (`normalizeActions`, exported): actions are sorted by `t`;
  entries with no finite `t`, an unknown verb, or a missing `name`/`id` are
  dropped with a console warning. Enum values are checked when the verb
  *fires*: a bad one warns and is skipped. A malformed action never breaks the
  performance around it.
- A new `perform()` replaces the running one. The returned handle's `stop()`
  cancels **future actions only** — an in-flight clip finishes, a live
  cue track is untouched — and `performEnd` does not fire. A handle whose
  performance was already replaced is a no-op.
- `on('performEnd')` fires when the last action has *fired*, not when its
  effects finish rendering.
- `onAction(a)` is called after each verb dispatches — the telemetry/log hook.
- Seeking the audio backward does not re-fire earlier actions.

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

Four layers hold a head pose and none of them knows about the others: the
state's attitude, the gaze (a look's head share, and its drift), a phrase's
pose while speaking, and the idle posture. Each stays small; every so often
they all point the same way, and the head arrives somewhere no one layer asked
for. On a drawing that is merely a large turn. On a 2.5-D photograph it is
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

## Events, gains, introspection

- `on('state', fn)` — state changed (fires with the new name)
- `on('speakEnd', fn)` — cue track completed
- `on('clipEnd', fn)` — action finished (fires with its id)
- `on('performEnd', fn)` — a performance's last action has fired
- `on('gestureEnd', fn)` — a hand gesture's timeline has run out (fires with
  its id). Tracked from the semantic gesture, so it fires under `hand: false`
  too — see § Hand gestures
- `setMouthGain(g)` — scales viseme excursion away from rest (1 = as authored;
  useful when the avatar renders small). Never drags a closed mouth open.
- `setGestureGain(g)` — scales clip deltas; small gestures under-render
  through the head's smoothing, and this is the knob that compensates.
- `setMotionGain(g)` — scales the idle liveness layer as a whole: breath,
  sway, postural weight shifts, the body's share of speech emphasis. A host
  rendering the avatar into a small tile, or one that re-encodes it into a
  video stream where motion costs bitrate, can turn it down; 0 freezes the
  body without freezing blinks, gaze or visemes. Where "alive" stops and
  "fidgety" starts moves with tile size and with the audience, so this is
  deliberately a host decision rather than a constant.
- Getters: `state`, `emotion`, `gaze`, `speaking`, `performing`, `clip`,
  `gesturing`, `params` (the live smoothed vector), `svg`, `meta`, `theme`.
- `setOverrides({channel: value})` — direct parameter injection, post-clamp.
  For tuning UIs and tests, not production.
- `blink()`, `step(dt)` (only under `{manual: true}`), `destroy()`.

Types: [`packages/avatar/src/avatar.d.ts`](../packages/avatar/src/avatar.d.ts), hand-maintained beside the code.
