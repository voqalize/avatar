# The mixer's driving API — internal

> **This is not a contract and not a seam to implement.** The public surface is
> `createAvatar({ mount, client })`
> ([design-avatar-interface.md](design-avatar-interface.md)) and a
> zero-argument `AvatarProcessor()`. What the *server* sends is
> [contract-wire.md](contract-wire.md); how the client resolves it is
> [pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md).
>
> What follows is the imperative surface underneath all of that — the one the
> `apps/authoring/` rig pages and the headless tools drive directly, and the one a
> behavior author works against. It ships under `@voqalize/avatar/internal`
> with no semver promise. Studio pointedly does *not* use it: Studio is the
> surface an integrator copies from, so it takes the published `createAvatar`
> and nothing else ([apps/studio/README.md](../apps/studio/README.md)).

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
`mouthGain`, `gestureGain`, `motionGain`, and `manual` (no internal rAF loop —
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
down rather than up, why `WORKING` looks at `SCREEN_WORK` and not `NOTES`. A
table here would be a second copy that nothing forces anyone to update, and the
one that used to be here rotted exactly that way: it documented a `TYPING` state
for weeks after the state was renamed `WORKING`.

The enum is exported as `STATE_NAMES`, and every recipe as `STATES`.

Seven of them cross the wire as behavior vocabulary — `IDLE`, `LISTENING`,
`THINKING`, `WORKING`, `SPEAKING`, `DEGRADED`, `OFFLINE`
([contract-behavior.md](contract-behavior.md)). The rest are render states
reachable only through `setState`, which is whose states they are.

## Emotion — `setEmotion(name, intensity = 1)`

Affect is a separate axis from state, so the enums don't multiply.
Six values (`EMOTION_NAMES`): `neutral`, `warm`, `curious`, `concerned`,
`encouraging`, `thoughtful`. `intensity` scales the pose linearly toward
neutral; it is not clamped, but past ~1.3 poses saturate against channel
clamps. Entering a state *adopts that state's default emotion* unless you pass
one explicitly.

## Gaze — `setGaze(name, custom?)`

Semantic directions; the client does the oculomotor work (ballistic eyes,
lagging under-rotated head, gaze-evoked blink). Twelve names (`GAZE_NAMES`):

| target | meaning |
|---|---|
| `USER` | down the webcam barrel — the conversational default |
| `USER_EAR` | still on the user, head cheated aside so an ear favors the speaker — the "trying to hear you" attitude. Head-follow and pupils point opposite ways, which is what keeps it reading as contact |
| `SCREEN_CENTER` / `SCREEN_LEFT` / `SCREEN_RIGHT` / `SCREEN_TOP` / `SCREEN_BOTTOM` | regions of the shared screen |
| `SCREEN_WORK` | lower-left work area of the shared screen |
| `NOTES` | down-right glance at the agent's own notes |
| `AWAY_THINKING` | up-left "recalling" break of eye contact — the stylized "let me think" beat |
| `AWAY_RIGHT` | up-right variant |
| `AWAY_DOWN` | down-left considering — measured cognitive aversion is mostly downward, so this is the one long THINKING dwells use |

Escape hatch: `setGaze('CUSTOM', { x, y })` with normalized −1..1 screen
coordinates, for when the server knows exactly where something is. (Any name
plus a `custom` object works; the coordinates win.)

**Floor-passing rule (server-side):** do not command a gaze aversion in the
final ~2.4 s of the agent's own utterance. Human speakers return to mutual
gaze before they stop talking; an agent that ends its turn looking away fails
to pass the floor, and the user sits waiting for a signal that never comes.

Gaze is also set implicitly by states; an action may temporarily override it,
then releases it when the action lands.

## Actions — `action(id)`

Finite authored clips with baked plausible timings, so they are convincing with
**no audio attached**. `packages/avatar/src/interjections.js` holds two lists, each clip's
duration and keyframes beside its intent:

- `ACTION_IDS` / `ACTIONS` — the seven a *server* may send, and the only ids
  `action(id)` accepts. Same seven as [contract-wire.md](contract-wire.md);
  anything else throws, and `parseAvatarCommand` drops it before it gets that
  far.
- `INTERNAL_CLIPS` — the full authoring library the seven are drawn from, ~33
  clips. It is a *timeline* library, not a second action vocabulary: nothing on
  the mixer's surface takes one of its ids, and the authoring pages that review
  them (`apps/authoring/clip-strip.html`) drive a bare `ClipPlayer` instead. That
  asymmetry is on purpose — promoting a clip to an action is a decision, and it
  should cost an edit to `ACTION_IDS`.

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

`speak()` auto-enters `SPEAKING` (keeping the current gaze) and kills any
spoken action in flight. `speakEnd` fires when the track completes.

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
`apps/authoring/perf-clips.json` scripts its turns this way and
`apps/authoring/expression-lab.html` plays them:

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
- `blink(double?)`, `step(dt)` (only under `{manual: true}`), `destroy()`.

Types: [`packages/avatar/src/avatar.d.ts`](../packages/avatar/src/avatar.d.ts), hand-maintained beside the code.
