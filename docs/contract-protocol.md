# Contract A — server ↔ widget (the driving protocol)

*Living document. Describes the code as of `src/avatar.js` on `main`; the
[Direction](#direction) section flags what is about to change. The counterpart
contract — what a face module owes the mixer — is
[contract-avatar.md](contract-avatar.md).*

The server is the source of truth. It decides what the agent is doing, feeling,
saying and looking at, and tells the widget; the widget's only job is to look
right while rendering that. Nothing in this contract lets the client decide
call content, and nothing in it requires the server to know what a face looks
like. The whole protocol is: **a state enum, an emotion enum, a gaze enum, an
interjection id, a hand-gesture id, and a stream of timed viseme letters.**

Everything below is reachable from one import:

```js
import { createAvatar } from './src/avatar.js';
const avatar = createAvatar({ mount: '#avatar' });   // also: avatar, face, theme, mouthGain, gestureGain
```

All setters are chainable. Unknown state, interjection and gesture ids
**throw**;
unknown emotion falls back to `neutral` silently; unknown gaze falls back to
`USER` silently.

## States — `setState(name, { emotion?, intensity?, gaze?, keepGaze? })`

A state is a *condition*, not an event: it holds until replaced. Each state
bundles a default gaze, emotion, idle-energy level and whether autonomous
backchannel nods run. Passing `emotion`/`gaze` overrides the bundle;
`keepGaze: true` preserves whatever gaze was already set.

| state | send when | behaviour highlights |
|---|---|---|
| `IDLE` | nothing is happening | full idle motion, gaze on user |
| `LISTENING` | the user is speaking | slight brow lift + eye widen; blink ~16/min; contingent backchannels + engagement lean when the user's voice is supplied (see below) |
| `THINKING` | the agent is working out what to say | gaze breaks away **downward** (`AWAY_DOWN` — where measured cognitive aversion actually goes), wandering on the ~3.5 s aversion cadence with a return to the user about one dwell in four; thoughtful affect, slow blinks, faster/shallower breath, occasional dead-still holds |
| `SPEAKING` | agent audio is playing | reduced idle sway so the head is stable while talking. `speak()` enters it automatically |
| `REVIEWING_SCREEN` | the agent is reading the shared screen | gaze wanders across screen targets every 1.8–5 s |
| `WAITING_FOR_USER` | the agent asked something and the floor is the user's | encouraging affect, raised brows, head tilt; backchannel on |
| `TYPING` | the agent is busy doing something the user asked for | head pitched into work, gaze parked down-left on `SCREEN_WORK`, task-rate blinks (~9/min), shoulders raised and working in bursts; glances back up to the user every 4–7 s — the cue that they aren't forgotten |
| `TYPING_CHAT` | the audio channel is broken and the agent is typing in chat to communicate | `TYPING`'s mechanics turned communicative: after each typing burst it looks up and **holds** on the user 1.2–2 s, expectant (chat is now the channel), vs `TYPING`'s brief ~0.8 s check-in; mouth pressed flat with a touch of browInner apology. Sequence it after `DEGRADED` — DEGRADED says "my feed is broken", this says "I'm working around it". They stay separate states |
| `DISTRACTED` | the agent's attention is genuinely elsewhere | gaze wanders sideways/up targets, held long (2.8–6.8 s each), looser sway, **no backchannels** — the missing nod is as diagnostic as the look-away. The widget only looks away; deciding when to snap back is the server's call |
| `SEARCHING_SCREEN` | filler while an async activity completes — "finding the right control". Server exits it when the activity is done | the hunt: search saccades every 0.8–2 s across screen targets with revisits (vs `REVIEWING_SCREEN`'s 1.8–5 s reading dwells), an occasional tiny "not this one" yaw flick, lowered brows, mouth pressed flat. Buys time while *visibly working on it* |
| `CANT_HEAR` | the user's audio is soft / low-SNR and the agent is trying | the strongest lean the widget makes (the lean *is* the message), head cheated aside on `USER_EAR` so an ear favors the speaker while the eyes hold contact, concentration squint + lowered brows, frequent dead-still holds, **no backchannels** — you don't nod along to what you can't hear. Typically followed by `SORRY` or a "could you repeat" utterance. If the user's voice is supplied, the lean intensifies slightly while a faint voice is actually present |
| `TAKING_FLOOR` | ~350 ms before agent audio starts | inbreath pose: shoulders rise, lips part, lean in |
| `WANTS_IN` | the agent wants the floor but won't barge in | stronger, *stiller* version of the same bid — holds until the user notices |
| `YIELDED` | the user barged in and the agent stopped | recoil: lean back, shoulders drop; pair with the `YIELD_FLOOR` interjection which delivers the fast mouth-shut |
| `DEGRADED` | the connection/pipeline is impaired | drowsy lids + desaturating CSS filter |
| `OFFLINE` | the agent is gone | lids nearly shut, grayscale |

The `state` enum is exported as `STATE_NAMES`, and every state's full recipe as
`STATES`.

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

Gaze is also set implicitly by states (table above) and temporarily by a few
interjections (`HMM`, `ONE_MOMENT`); a clip's gaze wins for the clip's
duration, then releases.

## Interjections — `interject(id)`

One-shot gesture clips with baked plausible timings, so they are convincing
with **no audio attached**. `attachAudio(id, url)` upgrades any of them with a
real TTS clip later; the clip then clocks itself off that audio. Durations
below are the baked defaults, in ms. Full list: `INTERJECTION_IDS`; the 12 with
spoken text: `SPOKEN_IDS`.

**Wordless backchannel** — fire while the user talks; these are also fired
autonomously in `LISTENING`/`WAITING_FOR_USER` by the listening engine (see
[The user's voice](#the-users-voice--setuseraudiosource-setuserspeakingbool)):
contingently on the user's pauses when the host supplies a voice signal, on a
loose 3.4–8 s timer when it never does. The picker answers what the user just
did: mid-speech stays minimal (70% `NOD_SMALL` / 30% `BROW_ACK`); a pause
after a *short* utterance draws from continuer country (55% `NOD_SMALL`, 25%
`BROW_ACK`, 20% `NOD_SLOW`); a pause after a **long** utterance (≥4 s) earns
the assessment class (45% `NOD_SLOW`, 20% `NOD_UP`, 20% `NOD_SMALL`, 15%
`BROW_ACK`). The three nods are the mocap taxonomy — continuer / assessment /
realization — with authored cycle decay, and all sit under the 1.5 Hz line
where a nod flips from attention to impatience.

| id | dur | intent |
|---|---|---|
| `NOD_SMALL` | 800 | single-cycle continuer — "go on" |
| `NOD_SLOW` | 1420 | two-beat assessment — first beat deepest, second decayed; "I agree" |
| `NOD_UP` | 1750 | realization — rises *before* it commits, brows leading; "ah, I see" |
| `BROW_ACK` | 720 | eyebrow acknowledgement, no head commitment |
| `HEAD_SHAKE` | 1350 | firm "no" — two decaying yaw cycles (~1.5 Hz), lowered brows, mouth firmed flat. **Server-sent only**: disagreement is never autonomous |
| `HEAD_SHAKE_SOFT` | 1700 | polite "hmm, not quite" — slower cycle-and-a-half at smaller amplitude, sympathetic head tilt, knit brows: sorry to be disagreeing. **Server-sent only**, same rule |
| `BLINK_LONG` | 850 | deliberate ~600 ms blink + barely-there nod: "that's noted — move on". **Server-sent only, never autonomous** — it measurably shortens what the user says next, so send it as a policy decision, not a reflex |

**Floor management** — pair with the floor states.

| id | dur | intent |
|---|---|---|
| `CLAIM_FLOOR` | 480 | visible inhale; fire ~350 ms before audio starts. Ends *held*, not resolved |
| `YIELD_FLOOR` | 420 | interrupted: lips shut within ~50 ms, recoil |
| `RAISE_HAND` | 1600 | "may I come in" — long held plateau is the message |

**Re-authored gestures** — these ids predate the arm removal and keep their
wire meaning, now performed by face, shoulders and torso.

| id | dur | intent |
|---|---|---|
| `WAVE` | 1300 | greeting (eyebrow flash) |
| `THUMBS_UP` | 1500 | approval (deep slow nod + broad smile) |
| `SHRUG` | 1250 | don't-know (shoulders to maximum, held) |
| `GO_ON_ARM` | 1400 | emphatic "go on" |

**Spoken** — carry text and a hand-tuned viseme track; silent but plausible
until `attachAudio` gives them a voice.

| id | dur | | id | dur |
|---|---|---|---|---|
| `MM_HMM` | 820 | | `GO_ON` | 820 |
| `OKAY` | 860 | | `ONE_MOMENT` | 1350 |
| `YES` | 740 | | `SORRY` | 1050 |
| `SURE` | 860 | | `HMM` | 1250 |
| `I_SEE` | 1050 | | `GOT_IT` | 820 |
| `RIGHT` | 740 | | `TAKE_YOUR_TIME` | 1500 |

A repeated `interject(id)` while that clip is already playing is collapsed to a
no-op; a *different* id replaces the running clip immediately.

## Hand gestures — `gesture(id)`

A hand rising into the bottom of the frame, plus the face half that makes it
belong to somebody. **This is a separate verb from `interject` on purpose.**
The four ids below are disjoint from `INTERJECTION_IDS`, and `interject('WAVE')`
still means exactly what it always meant — the face alone. A server that
upgrades the widget gets no hand until it asks for one.

| id | dur | what it does |
|---|---|---|
| `HI` | 1250 | open palm rises and waves — greeting. Face half: `WAVE` |
| `BYE` | 1550 | the same wave, one swing longer and a touch slower — parting. Face half: `WAVE` |
| `THUMBS_UP` | 1300 | fist, back of hand to camera, thumb up — approval. Face half: `THUMBS_UP` |
| `ONE_MOMENT` | 1700 | a single raised index finger, held — "one moment". Face half: `ONE_MOMENT`, which speaks |

Calling `gesture(id)` fires the face half as an `interject()` on the caller's
behalf — do **not** send both; the second one replaces the first mid-clip. It
also suppresses autonomous backchannels for the gesture's duration plus 500 ms,
because a nod landing on top of a deliberate hand is the listening engine
talking over the server.

What the widget guarantees, and why it is stated here rather than left to the
drawing: **nothing but a single digit ever passes the mouth.** Mouth sync is
the headline feature, so a gesture is free to fire mid-speech. The hand also
never leaves the frame sideways and never shows a wrist — see
`docs/contract-avatar.md` § The hand for the rules and the per-avatar check.

Degradation is total and silent. An avatar mounted with `hand: false` — a face
drawn in some other idiom, or a tile too small to spend the pixels — plays the
face half and nothing else, which is the same fallback every id already had
before the hand existed. `api.gesturing` is the id in flight, or `null` — which
is what it always reads under `hand: false`, and `gestureEnd` correspondingly
never fires there: both describe the *hand*, and there is no hand. An unknown
id throws, as `interject` does.

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

**Clock.** Cues are scheduled against the *audio clock*, never wall time.
Pass `audio` (an `HTMLMediaElement`; the widget uses `currentTime` and will
call `play()` if paused) or `clock` (a `() => ms` function, for WebAudio or
server-driven time). Wall time is the fallback only when neither is given.
The mouth runs **40 ms ahead** of the clock (`LEAD_MS`): perceptual tolerance
is asymmetric (about −45 ms audio-first to +125 ms video-first), so leading is
the safe side.

**Streaming.** `pushCues(cues)` appends mid-utterance — send cues in chunks as
TTS produces them; the merged track is re-normalized each push.

`speak()` auto-enters `SPEAKING` (keeping the current gaze) and kills any
spoken interjection in flight. `speakEnd` fires when the track completes.

## The user's voice — `setUserAudio(source?)`, `setUserSpeaking(bool)`

Backchannels only create rapport when they are *contingent* on the speaker —
identical nods on a timer measurably read as distracting
(docs/research-biomechanics.md §3.5). Give the widget the user's voice and the
listening engine does the rest:

- `setUserAudio(streamOrElement)` — the widget runs its own coarse VAD on the
  signal (RMS hysteresis: 80 ms on, 250 ms off). This audio never drives the
  mouth; it is the *input* side.
- `setUserSpeaking(bool)` — the host's (or server endpointer's) own turn
  signal. Wins over the level VAD when both are driven; pass `null` to hand
  back.

While `LISTENING`/`WAITING_FOR_USER` with a signal supplied: an
acknowledgement fires 250–600 ms after a user pause onset, on about half of
pauses, never more often than every 2.5 s; long unbroken user speech earns a
rare minimal mid-speech nod; and the avatar leans in (`torsoLean` up to
+0.16) while the user holds the floor, relaxing after ~8 s of silence. Every
autonomous fire is announced via `on('backchannel', id)`, so a server can log
exactly what the widget did on its own.

If neither method is ever called, the engine falls back to the loose 3.4–8 s
timer — a worse listener, never a dead one. Server-driven `interject()` calls
push the autonomous scheduler out (min 2.5 s), so the two sources never pile
up.

### The mouth priority rule (invariant)

**Server viseme track > clip mouth track > amplitude fallback.** While a
server track plays, it owns the mouth outright: an interjection fired
mid-utterance contributes head and brows only, and its mouth track is dropped.
The amplitude fallback (`setAudioFallback(mediaElementOrStream)`) is the
zero-server-work tier: an energy/spectral guesser that runs only when no cue
track is live. Anything that degrades this ordering is a regression.

## Events, gains, introspection

- `on('state', fn)` — state changed (fires with the new name)
- `on('speakEnd', fn)` — cue track completed
- `on('clipEnd', fn)` — interjection finished (fires with its id)
- `on('backchannel', fn)` — the listening engine fired an acknowledgement on
  its own (fires with the interjection id)
- `on('performEnd', fn)` — a performance's last action has fired (see
  *Composing behavior*)
- `on('gestureEnd', fn)` — the hand has left the frame (fires with the gesture
  id). Only where a hand is mounted — see *Hand gestures*
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
  `gesturing`, `params` (the live smoothed vector), `audioLevel`, `svg`.
- `setOverrides({channel: value})` — direct parameter injection, post-clamp.
  For tuning UIs and tests, not production.
- `blink(double?)`, `destroy()`.

## Producing cues server-side

Three tiers, best first — full recipes with code are in
[README.md § Getting mouth shapes out of speech](../README.md):

1. **Native TTS viseme events** (Azure et al.): map integer viseme ids through
   `AZURE_VISEME_TO_LETTER`, ship `{t, v}` as they stream. Nearly free.
2. **Forced alignment** (any TTS): phonemize + align (MFA, gentle, or
   `rhubarb-lip-sync` directly — our letters *are* Rhubarb's), then map ARPAbet
   through `ARPABET_TO_VISEME`.
3. **No server work**: the client amplitude fallback, or `textToCues(text)` —
   a crude grapheme guesser fit for previews only.

`experiments/rhubarb-textsync/` derived letters from *text* before audio
exists, to keep model-init cost off the time-to-first-audio path. It graduated:
the production form is `native/avatarsync/`, one resident binary serving both a
~0.2 ms text leg and a ~15–35 ms warm audio-recognition leg, driven by
`voqalize-avatar` (see *The reference backend*).

## Composing behavior: `perform(actions, { audio?, clock?, onAction? })`

The composition surface. A **performance** is a list of timed verbs fired
against a clock; each verb resolves to one of the enums above. This is how a
backend assembles a turn: it sequences from a constrained vocabulary and
cannot invent motion — every wire-visible move is something that was authored
and tuned on the rig. A backend wanting a new move asks for a new enum entry
(a state, an interjection), never for a channel-level escape hatch.

```js
{ "t": 4200, "do": "emotion",   "name": "warm", "i": 0.8 }
{ "t": 5100, "do": "gaze",      "name": "SCREEN_WORK" }
{ "t": 6300, "do": "interject", "id": "NOD_SMALL" }
{ "t": 8000, "do": "state",     "name": "WAITING_FOR_USER" }
```

| verb | args | dispatches to |
|---|---|---|
| `state` | `name`, `keepGaze?` (default **true**) | `setState(name, {keepGaze})` |
| `emotion` | `name`, `i?` 0..1 (default 1) | `setEmotion(name, i)` |
| `gaze` | `name` | `setGaze(name)` |
| `interject` | `id` | `interject(id)` |
| `gesture` | `id` | `gesture(id)` — the hand *and* its face half |

The natural unit a server assembles is audio + cue track + action track on
**one clock** (`demo/perf-clips.json` scripts every demo turn this way, and
`demo/floor.js` plays them through this API):

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
  smoothing lag, and a deliberate lead (`CLAIM_FLOOR` ~350 ms before the first
  sample) is authored into `t` by the composer.
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
  cancels **future actions only** — an in-flight interjection finishes, a live
  cue track is untouched — and `performEnd` does not fire. A handle whose
  performance was already replaced is a no-op.
- `on('performEnd')` fires when the last action has *fired*, not when its
  effects (a still-playing interjection, say) finish rendering.
- `onAction(a)` is called after each verb dispatches — the telemetry/log hook;
  the demo's token stream uses it.
- Seeking the audio backward does not re-fire earlier actions.

## The reference backend — `voqalize-avatar`

This contract has a living server implementation in this repo: the `py/`
package (`pip install voqalize-avatar`), a pipecat `FrameProcessor` that infers
the base states from stock frames and emits the envelope below as RTVI
server-messages. Design and rationale:
[design-library-split.md](design-library-split.md). A host driving the widget
through that stack never calls the API above directly; it mounts
`@voqalize/avatar/pipecat`, whose `AvatarClient` dispatches those messages:

```json
{ "type": "avatar", "v": 1, "cmd": "state", "name": "THINKING" }
```

| `cmd` | payload → widget call |
|---|---|
| `state` | `name`, `emotion?`, `gaze?` → `setState` |
| `interject` | `id` → `interject` |
| `gesture` | `id` → `gesture` (a hand gesture id, not an interjection id) |
| `perform` | `actions`, `ctx` → `perform` |
| `cues` | `ctx`, `from_ms`, `cues`, `final?` → splice, then `speak`/`pushCues` |
| `speech` | `event: start\|stop`, `ctx` → anchor / release the turn clock |
| `user` | `speaking` → `setUserSpeaking` |
| `hint` | `kind: eager_eot` → app hook (listening engine may ack now) |

Semantics the envelope adds on top of this contract:

- **The splice.** `speak()` replaces and `pushCues()` only appends, so tail
  replacement is the *driver's* job: the client wrapper keeps the turn's
  canonical track, discards queued cues with `t >= from_ms`, appends, and
  re-issues `speak()` on the turn's original clock when anything was
  discarded. This is how the server's fast text-predicted cues are overwritten
  by audio-recognized ones mid-turn without the widget ever seeing a seam.
- **The anchor.** `speech start` (sent on the server's playout-true
  bot-started-speaking signal) sets the turn's t=0; the cue clock is
  `performance.now() - t0`. The data channel beats jitter-buffered audio, so
  residual error lands video-first — the +125 ms side of the asymmetric
  tolerance window, not the −45 ms one.
- **Explicit instructions override heuristics.** An application that knows
  something the pipeline cannot infer pushes the same `{cmd, ...}` payload from
  its own code; it dispatches into the same handler. The backend's state
  heuristics are the default layer underneath, not a competing one.
- Unknown `cmd`s are ignored — the server may grow vocabulary ahead of
  deployed clients.

## Direction

Agreed direction, not yet landed; backend work can anticipate it:

- More compound application states in the `TYPING`/`DISTRACTED` mould as
  applications need them — same `setState` surface, one STATES entry each.
- Backend heuristics for the states still unmapped server-side: `CANT_HEAR`
  from the STT's own confidence signal plus user volume; `DISTRACTED`,
  `SEARCHING_SCREEN` and `TYPING` from tool-call names, which today only the
  opt-in `tool_states` map reaches.

For servers written against a pre-2026-08 version of this contract, the
renames were: `createKiran`→`createAvatar`, gaze `CANDIDATE`→`USER` and
`CODE_AREA`→`SCREEN_WORK`, state `WAITING_FOR_ANSWER`→`WAITING_FOR_USER`.
Everything else in this document — the descriptor (`api.meta`), `perform()`,
the listening engine, the compound states, the disagree family and the hand
gestures — landed 2026-08 and is current. `gesture` is the newest verb
(2026-08-07); a widget older than it ignores the `cmd` and drops the
`perform()` verb with a warning, which is the forward-compat rule working as
intended, so a backend may send it unconditionally.
