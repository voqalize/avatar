# Avatar — a programmable 2-D talking head

A dependency-free SVG avatar for AI agents on voice calls. The agent can wear
any face and go by any name — the demos call theirs Kiran. The server owns
meaning (what state the agent is in, what it's saying, where it's looking); the
client owns motion (how a face actually moves when it means those things).

No build step, no runtime dependencies, ~200KB of ES modules — about two thirds
of that is the three face rigs, and a host that ships one face pays for one.

The two load-bearing interfaces are specified in
[docs/contract-protocol.md](docs/contract-protocol.md) (server ↔ widget) and
[docs/contract-avatar.md](docs/contract-avatar.md) (mixer ↔ face).

```sh
npm install @voqalize/avatar      # the browser half
pip install voqalize-avatar       # the pipecat half
```

```js
import { createAvatar } from '@voqalize/avatar';

const avatar = createAvatar({ mount: '#avatar' });

avatar.setState('LISTENING', { emotion: 'warm' });
avatar.interject('MM_HMM');
avatar.setGaze('SCREEN_WORK');
avatar.speak({ audio: audioEl, cues });   // cues: [{t: 0, v: 'D'}, ...]
```

## What's in the box

The repo is one system in three pieces, because that is how it gets consumed —
a browser widget alone is not a working avatar, and neither is a lipsync
backend. See [docs/design-library-split.md](docs/design-library-split.md) for
why this is a library rather than a product.

| piece | where | what it is |
|---|---|---|
| the widget | `src/` → `@voqalize/avatar` | the face. Dependency-free ES modules, no build step, mounts anywhere |
| the client | `client/` → `@voqalize/avatar/{pipecat,react}` | the dispatcher: turn clock, cue splice, React mount |
| the backend | `py/` → `voqalize-avatar` (PyPI) | a pipecat `FrameProcessor` that infers state from stock frames and streams visemes |
| the aligner | `native/avatarsync/` | the Rhubarb Lip Sync fork the backend drives — A–H letters from text *and* from audio |

Browser side, three entry points:

```js
import { createAvatar, AVATAR_NAMES } from '@voqalize/avatar';         // no deps
import { AvatarClient } from '@voqalize/avatar/pipecat';               // + pipecat client
import { Avatar, useAvatar } from '@voqalize/avatar/react';            // + React >= 18
```

The root export is the widget itself and pulls in nothing. `/pipecat` adds
`AvatarClient`, which anchors the turn clock and splices cue tracks; it needs
`@pipecat-ai/client-js` only if you call `attach()`. `/react` adds a mount
lifecycle and nothing else:

```jsx
<Avatar client={pipecatClient} className="call-tile" />
```

Server side, the whole integration is one processor between your TTS and your
output transport — see `py/` and `docs/contract-protocol.md`:

```python
from voqalize_avatar import AvatarProcessor, AvatarStateMachine

pipeline = Pipeline([..., tts, AvatarProcessor(state_machine=AvatarStateMachine()), transport.output()])
```

That much is inferred from stock pipecat frames, with no application code.
States that depend on what your application is *doing* — a tool call that
should read as *reviewing the screen* rather than *thinking* — are signalled
explicitly with `AvatarControlFrame`.

## Running the demo

ES modules will not load over `file://`. Serve the directory:

```
python3 serve.py 8777
open http://localhost:8777/demo/call.html
```

Use `serve.py`, not `python3 -m http.server`. The stdlib server sends
`Last-Modified` and no `Cache-Control`, so browsers apply heuristic freshness and
quietly stop revalidating modules you have edited; `serve.py` is the same server
with `Cache-Control: no-store`. Do not work around a stale module with a `?v=`
query string either — that puts two copies of it in the graph and fails worse.

`demo/call.html` is the page to start with: a two-tile call with mic VAD,
turn-taking and a log of every token the server would have sent. Hold `Space` to
be the human side of the call if you have no microphone.

The other one is the control harness:

```
index.html?avatar=NAME           every control maps to a server token; exposes
                                 window.avatar, so the console is a live REPL
```

Those two are the entry points. Everything else is rig tooling — for the
occasions when you are *building or repairing an avatar*, which is a different
job — and it lives behind one index:

```
demo/rig/index.html              rig-check, contact sheet, torso check, clip strip,
                                 expression lab, lipsync eval
```

`?avatar=NAME` (or `?face=NAME` on the rig pages) selects the rig; the call
demo also has a live picker that swaps it without dropping the call.

---

## Design

### 1. The face is a vector, not a set of drawings

Everything the avatar can do is a point in a ~30-dimensional parameter space
(`src/params.js`): `mouthOpen`, `mouthRound`, `lidL`, `browInnerR`, `headYaw`,
and so on. Visemes, emotions, gaze poses and gesture keyframes are all just
named vectors in that space.

This is the decision the rest of the system rests on. Blending a smile into a
mid-sentence "oh" is arithmetic, not SVG path surgery — and a continuous stream
of parameter updates from the server is the *native* input format rather than
something to be adapted to.

### 2. Layers mix in a fixed order

```
base pose (state + emotion)  →  gaze  →  visemes  →  clip deltas  →  idle
```

Earlier layers are overwritten by later ones on the channels they touch. Gesture
clips and the idle layer are **additive**, so they compose instead of fighting:
a nod during speech moves the head while the mouth stays on the server's viseme
track, with no special-casing anywhere.

One hard rule: **while the server viseme track is playing it owns the mouth
outright.** An interjection that fires mid-sentence contributes its head and
brows, and its mouth track is silently dropped. Otherwise the avatar appears to
say two things at once.

### 3. Smoothing is the animation

There is no tweening engine. Every channel chases its target with a
frame-rate-independent exponential approach, at a per-channel time constant:

| channel group | τ | why |
|---|---|---|
| mouth | 42ms | fast enough to hit consonants, slow enough to blur between them |
| lids | 18ms | blinks must be crisp or they read as a glitch |
| pupils | 32ms | saccades are ballistic |
| brows | 80ms | |
| head | 160ms | the head has real mass |
| smile | 130ms | expressions bloom, they don't snap |
| shoulders | 190ms | the torso has more mass than the head and reads wrong when it hasn't |
| lean | 240ms | |

This gives the face weight, and it does **viseme co-articulation for free** — we
never blend shapes explicitly, we just retarget and let the mouth chase.

### 4. Screen-share hygiene

The call runs with screen share on. All idle motion is deliberately
low-amplitude and low-frequency; a jittery avatar in the corner of a shared
screen costs the video encoder real bitrate for no communicative gain.

---

## The viseme protocol

The wire format is the **Rhubarb Lip Sync alphabet** — A–H plus X — a
condensation of the Preston Blair mouth set. Nine shapes is plenty for a
stylized 2-D face, and it means the server has an obvious open-source reference
implementation to target.

| letter | mouth | phonemes |
|---|---|---|
| `A` | closed lips | P B M — also the resting closure |
| `B` | slightly open, teeth together | K S T D, consonantal EE |
| `C` | open | EH AE |
| `D` | wide open | AA |
| `E` | slightly rounded | AO ER R |
| `F` | puckered | UW OW W |
| `G` | lower lip to upper teeth | F V |
| `H` | tongue up, visible | L |
| `X` | idle / silence | — |

A cue is `{ t, v, i? }`:

```js
{ t: 240, v: 'D', i: 0.8 }
//  ^ms into the utterance
//         ^letter
//                  ^optional 0..1 loudness
```

**Send intensity if you can.** It's cheap to derive from TTS energy and it's the
single biggest realism win available — the same viseme shouted and murmured
should not look identical. It scales only the effortful channels, so a quiet `D`
is a small `D`, not a different shape.

### Sync rules (these matter more than the shapes)

- **Schedule against the audio clock, never wall time.** `audioEl.currentTime *
  1000` or `AudioContext.currentTime`. Wall time drifts against playback and you
  will spend the rest of your life chasing it. The client does this for you if
  you pass `audio` to `speak()`.
- **The mouth leads the sound by 40ms** (`LEAD_MS`). Perceptual tolerance is
  asymmetric — roughly −45ms (audio first) to +125ms (video first) — so leading
  is the safe side to err on.
- **Cues below 30ms are dropped** by `normalizeCues()`, which also sorts and
  merges consecutive repeats. When a sub-30ms cue must be dropped, closures
  (`A`/`G`) win over mid-open vowels: they carry more lip-reading information.
- **Streaming is fine.** Start with what you have and `pushCues()` the rest as it
  arrives; the track re-normalizes and re-seeks.

---

## Getting mouth shapes out of speech (server side)

Three tiers. Pick the highest one your TTS supports.

### Tier 1 — native TTS viseme events (best, and nearly free)

Several TTS engines emit viseme events alongside the audio, already aligned.

**Azure Speech** fires `visemeReceived` with an integer ID 0–21 and an audio
offset in 100ns ticks. `src/visemes.js` exports the mapping:

```js
import { AZURE_VISEME_TO_LETTER } from './src/visemes.js';

synth.visemeReceived = (_s, e) => {
  cues.push({
    t: e.audioOffset / 10000,                       // ticks → ms
    v: AZURE_VISEME_TO_LETTER[e.visemeId],
  });
};
```

**AWS Polly** with `SpeechMarkTypes: ['viseme']` returns a JSON-lines stream of
`{time, type: 'viseme', value}` where `value` is a Polly viseme name (`p`, `t`,
`S`, `T`, `f`, `k`, `i`, `r`, `s`, `u`, `@`, `a`, `e`, `E`, `o`, `O`, `sil`).
Map those onto the letters above — `p→A`, `f→G`, `u/o/O→F`, `a→D`, `E/e→C`,
`i→B`, `r/@→E`, `t/s/S/T/k→B`, `sil→X`.

**ElevenLabs / OpenAI TTS** don't emit visemes. Use tier 2.

### Tier 2 — forced alignment (works with any TTS)

Take the audio and the text you already have, get phonemes with timestamps, map
phonemes to letters. Open-source options, cheapest first:

- **[Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/)** —
  the standard. Accurate, ~real-time on CPU, Python.
- **[whisper-timestamped](https://github.com/linto-ai/whisper-timestamped)** or
  **WhisperX** — word-level timings; interpolate phonemes within each word via
  CMUdict. Lower fidelity but you may already be running Whisper.
- **[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)** — a
  single binary that goes straight from WAV (+ optional transcript) to exactly
  this A–H alphabet. `rhubarb -f json -d dialog.txt audio.wav`. This is the
  reference implementation; if you want a one-command answer, it's this.

For phoneme→letter, port `ARPABET_TO_VISEME` from `src/visemes.js` — it's the
complete table and it's already tuned against these nine shapes.

Rough recipe if you're rolling your own:

1. G2P the utterance text (CMUdict for known words, `g2p-en` or `phonemizer`
   for the rest) → ARPAbet phoneme sequence.
2. Force-align against the synthesized audio → per-phoneme start times.
3. Map each phoneme through `ARPABET_TO_VISEME`.
4. Emit `{t, v}` at each phoneme onset. Add `{t: end, v: 'X'}` at utterance end.
5. Don't smooth or interpolate — the client's per-channel smoothing does that,
   and doing it twice makes the mouth mushy.

Latency note: alignment needs the whole audio, so for streaming TTS run it per
sentence chunk and `pushCues()` each chunk as it completes.

### Tier 3 — amplitude fallback (client-side, zero server work)

Already implemented in `src/audio-fallback.js`. Attach any `MediaStream`,
`HTMLMediaElement` or WebAudio node and it derives openness from RMS and a
rough shape family from spectral tilt (sibilant → `B`, low-heavy → `F`/`E`,
otherwise open vowels by level).

```js
avatar.setAudioFallback(audioElement);
```

It is not lip-sync — it's a mouth that moves plausibly with the voice. Use it
when the viseme stream is unavailable or has fallen behind. The mixer engages it
only when nothing better is playing, so you can leave it attached permanently as
a safety net.

---

## API

### States

`setState(name, { emotion, intensity, gaze, keepGaze })`

| state | behaviour |
|---|---|
| `IDLE` | neutral, full idle motion |
| `LISTENING` | slightly widened eyes, brows up a touch, ~16 blinks/min, **backchannel nods fire automatically** — timed off the user's voice when one is supplied |
| `THINKING` | gaze breaks away — mostly *down*, sometimes up-left — faster shallow breath, ~25 blinks/min, occasional dead-still holds |
| `SPEAKING` | eye contact, damped idle so it doesn't fight the mouth |
| `REVIEWING_SCREEN` | gaze wanders across screen regions on its own, leisurely |
| `SEARCHING_SCREEN` | the same regions *hunted* — quick saccades, revisits, tiny "not this one" head flicks. A filler that buys the agent time |
| `WAITING_FOR_USER` | head tilt, brows up, encouraging — the "go ahead" pose |
| `CANT_HEAR` | leans right in, ear cheated toward the speaker, eyes holding contact, concentration squint. Send it when the user's audio is soft |
| `TYPING` | gaze down into the work, task-rate blinks (~9/min), burst-pause shoulder rhythm, a brief glance up every few seconds — busy, not absent |
| `TYPING_CHAT` | `TYPING` turned communicative: longer expectant glance-holds, a touch of apology. For when the audio channel is broken and chat is the workaround |
| `DISTRACTED` | attention visibly elsewhere — lateral away-gaze wander, loosened sway, no backchannels |
| `TAKING_FLOOR` | shoulders up, lips parting, head coming up — about to speak |
| `WANTS_IN` | the same inbreath, held and very still — "I'd like to come in" |
| `YIELDED` | shoulders and lean dropped — interrupted, and giving way |
| `DEGRADED` | desaturated, heavy lids — signals a network problem honestly |
| `OFFLINE` | eyes closed, greyscale |

Setting a state adopts its default emotion and gaze unless you override them.
Every state carries an idle *profile* — blink rate, breath rate and depth, sway,
weight-shift interval, stillness holds — so the liveness itself is a state
signal (the blink-rate spread alone separates listening from thinking from
visually busy; the numbers come from `docs/research-biomechanics.md`).

The body is part of that, not just the face. The trunk breathes as a chest
swell about the hem rather than sliding up and down; it re-settles its weight
every 9–22 s, discretely and aperiodically, with the head counter-rolling so
the gaze stays on you through the shift; and it follows a sustained head turn
at nearly 3× the head's time constant, which is where follow-through comes
from. Amplitude rides on the state's `sway`, so concentration suppresses the
lot and `OFFLINE` is genuinely still. `avatar.setMotionGain(g)` scales all of
it if a host wants a calmer or livelier body; `demo/call.html` exposes it as
the *Body motion* slider, because where "alive" stops and "fidgety" starts is a
judgement that should be argued against a running rig.

The three floor-management states exist because turn-taking is what goes wrong
most often in a voice call — the user either talks over the agent or waits
in silence for a signal that never comes. They are states rather than clips
because the floor is a condition, not an event: `WANTS_IN` has to hold for as
long as it takes the other person to notice it. All three lift the shoulders and
part the lips, because that is what an inbreath looks like from outside, and an
inbreath is the cue humans actually use to predict that someone is about to
speak. The head comes *up*, not down — a lowered head reads as yielding.

### The user's voice

Backchannels only create rapport when they are *contingent* — a nod coupled to
the speaker's pauses reads as understanding; the same nod on a random timer
reads as distracting (the research is unambiguous on this). Give the widget the
user's voice and the listening engine does the rest:

```js
avatar.setUserAudio(micStreamOrElement);   // internal RMS VAD; null to detach
avatar.setUserSpeaking(true / false);      // or run your own VAD; this wins
avatar.on('backchannel', (id) => log(id)); // every autonomous ack, announced
```

While the user holds the floor the avatar leans in a touch; at pause onsets it
acknowledges within ~250–600ms (probability, refractory gap and nod choice all
tuned from listening-corpus numbers — long user utterances earn the bigger
nods). With no signal attached, the old plausible random cadence remains as the
fallback. The server can always `interject()` explicitly; autonomous acks
suppress themselves around it.

### Action timelines

The composable vocabulary: a server assembles behaviour from the enums above,
timed against the utterance's own audio clock —

```js
avatar.perform([
  { t: 0,    do: 'state',     name: 'SPEAKING' },
  { t: 900,  do: 'gaze',      name: 'SCREEN_WORK' },
  { t: 2100, do: 'interject', id: 'NOD_SMALL' },
  { t: 3000, do: 'emotion',   name: 'warm', i: 0.7 },
], { audio: audioEl });                    // clock: explicit fn > audio > elapsed
```

Verbs: `state`, `emotion`, `gaze`, `interject`. `normalizeActions()` applies
the same hygiene philosophy as `normalizeCues()` — sort, warn-and-drop
malformed entries, never throw mid-performance. A new `perform()` replaces the
running one; `stop()` on the returned handle cancels; `performEnd` fires when
the last action has dispatched. The demo's scripted turns
(`demo/perf-clips.json`) run through exactly this call.

### Emotion

`setEmotion(name, intensity)` — `neutral`, `warm`, `thoughtful`, `concerned`,
`encouraging`, `curious`.

### Avatars

The rig can wear more than one face. Pick one at construction:

```js
createAvatar({ mount, avatar: 'wren' })        // by name, from AVATARS
createAvatar({ mount, face: myCreateFace })     // or pass a factory directly
```

`AVATAR_NAMES` lists what is registered. Two ship today, both line art:

| name | module | what it is |
|---|---|---|
| `peep` | `face-peep.js` | the default. Open Peeps–style black-and-white line art, `#f97415` on the collar edge and two buttons. Hand-authored in a 760x950 space, portrait window `92 76 576 800` |
| `wren` | `face-wren.js` | the second line-art character — curls, round glasses, same construction kit, window `92 50 576 800` |

`DEFAULT_AVATAR` is `peep`, and it is the face under active work.

There were two others — `classic`, the original hand-authored rig, and
`blue-shirt`, a cleaned auto-trace. Both were removed on 2026-08-06 after
stakeholder review accepted the line-art pair and rejected them: keeping four
rigs meant maintaining art nobody wanted, and every visual fix had to be
weighed against faces that were never going to ship. What they taught the
abstraction outlived them — `face-core.js` exists because all three of the
first rigs wrote the same `apply()`, and `META` exists because all three needed
the same two rects. Both modules are in git history.

`peep` is worth a paragraph because it is built on a rule the retired rigs did
not follow: **it has no strokes anywhere.** Every line is a filled path, which is
what lets a line swell and taper along its length the way a drawn mark does — a
uniform `stroke-width` is the thing that makes vector line art read as clip art.
Three helpers do all of it: `taper` for an open mark, `taperRing` for a closed
annulus, `region` for an enclosed area. Widths are given as a *profile across the
whole mark* in normalized `s ∈ [0,1]`, not per node, so the same profile survives
re-authoring the points.

An avatar is any module exporting

```js
createFace(mount, theme) -> { svg, apply(params), theme, destroy() }
META = { viewBox, mouthCrop }
```

Nothing above the renderer knows which face it is driving: visemes, emotions,
gaze, idle, clips and the mixer all work in parameter space, so a new avatar
costs no changes anywhere else. `META` is the avatar descriptor — the little a
host or tool may know about a face without opening it: `viewBox` for framing
(exposed as `api.meta`; the demo pages derive tile aspect from it) and
`mouthCrop` for the contact sheet's viseme close-ups.

The registry in `src/avatar.js` maps names to `{ create, meta }` records. It
was factories-only for the first three faces, deliberately — a schema guessed
from two rigs would have been wrong, and building the third supplied the
evidence for what is genuinely shared. That evidence now lives in code rather
than prose: `src/face-core.js` owns the pose mechanics (lean, shoulders,
parallax) driven by per-rig scalar specs, the shared eye/brow/teeth fragments,
and the renderer shell, so a face module supplies art, feature geometry and a
handful of named scalars. The full recipe — what a new avatar must supply and
what it gets for free — is in
[docs/contract-avatar.md](docs/contract-avatar.md). The hard-won rules stand:

- **Art units are per-rig, and copying a magnitude between rigs is silent
  breakage.** `peep`'s `yawPx` is 28 against the original rig's 13 because they
  are art units of different sizes; travels convert through the spec's `units`
  factor, degrees never do.
- **A trace supplies static geometry, not a rig.** Anything the source art does
  not contain has to be authored, and two rigs can honour the same channel and
  mean visibly different things by it. (This is most of why the traced rig was
  the one that read worst, and why new avatars are hand-authored.)
- **Layer sets follow the art, not a standard** — the first rig ran 7 layers;
  the line-art pair fuse to 4.

Verify a new avatar against `demo/rig/rig-check.html` (every registered avatar side
by side through the live mixer, plus `sweep()` — a scripted pass over every
state, emotion, gaze, interjection and a viseme track, asserting the params stay
finite and in range and the SVG stays connected); against
`demo/rig/contact-sheet.html?face=<name>` for static poses, including a mouth
close-up row, since visemes are only judgeable at that magnification; and against
`demo/rig/torso-check.html?face=<name>` for the shoulder, lean and head-pose
*combinations*, which is where a rig leaks background from behind the shirt if it
is going to.

`sweep()` returning `{ok: true}` is not evidence a change looks good — it catches
dead avatars, NaN leaks and detached SVGs, and nothing else. Every defect this
project has found was found by looking at a rendered page.

Emotion is a separate axis from state on purpose. Fold it into the state enum
and you need `SPEAKING_WARM`, `SPEAKING_CONCERNED`, `LISTENING_WARM`… and the
table is unmaintainable within a week.

### Gaze

`setGaze(name)` or `setGaze('CUSTOM', { x, y })` with normalized −1..1.

Named targets: `USER`, `USER_EAR`, `SCREEN_CENTER`, `SCREEN_LEFT`,
`SCREEN_RIGHT`, `SCREEN_TOP`, `SCREEN_BOTTOM`, `SCREEN_WORK`, `NOTES`,
`AWAY_THINKING`, `AWAY_DOWN`, `AWAY_RIGHT`. (`USER_EAR` cheats the head aside
while the eyes hold contact — `CANT_HEAR`'s signature; `AWAY_DOWN` is the
thinking direction, because real cognitive aversion leads down, not up.)

Send the semantic direction and let the client do the oculomotor work. Three
details do the perceptual heavy lifting, and skipping any one reads as a puppet:
the eyes arrive first (ballistic, ~32ms) while the head ambles after at 340ms;
the head deliberately under-rotates and lets the eyes carry the rest; a blink
fires involuntarily on any large shift. The upper lid also rides with vertical
gaze — without that, looking down bares sclera and reads as alarm.

### Speaking

```js
avatar.speak({ audio: audioEl, cues });   // audio element drives the clock
avatar.speak({ cues, clock: () => myPlayer.positionMs });
avatar.pushCues(moreCues);                // streaming top-up
avatar.stopSpeaking();
avatar.on('speakEnd', () => avatar.setState('LISTENING'));
```

`speak()` switches to `SPEAKING` and kills any in-flight spoken interjection
first — barge-in is the normal case, not an error.

For previewing without a TTS round-trip there's `textToCues(text, { wpm })`, a
crude grapheme guesser. It exists for the demo. Do not ship it.

### Interjections

`interject(id)`. These are the real-time feedback channel — they're what makes
the avatar feel like a listener rather than a player, so they're the part most
worth getting right.

Each clip is a gesture timeline (head, brows, lids, smile) plus, where spoken, a
hand-tuned viseme track and a **baked plausible duration**, so every clip plays
convincingly with no audio at all.

**Spoken:** `MM_HMM`, `OKAY`, `YES`, `SURE`, `RIGHT`, `GOT_IT`, `I_SEE`,
`GO_ON`, `ONE_MOMENT`, `TAKE_YOUR_TIME`, `SORRY`, `HMM`
**Wordless:** `NOD_SMALL`, `NOD_SLOW`, `NOD_UP`, `BROW_ACK`, `HEAD_SHAKE`,
`HEAD_SHAKE_SOFT`, `BLINK_LONG`, `WAVE`, `THUMBS_UP`, `SHRUG`, `GO_ON_ARM`
**Floor management:** `CLAIM_FLOOR`, `YIELD_FLOOR`, `RAISE_HAND`

The nod family follows the measured taxonomy of human listening: `NOD_SMALL`
is the single-cycle continuer, `NOD_SLOW` the two-beat assessment (first beat
biggest — long nods start big and decay), `NOD_UP` the realization nod with the
upward swing, for "ah, *I see*" moments. `HEAD_SHAKE` is the firm no,
`HEAD_SHAKE_SOFT` the sympathetic "not quite" with a head tilt — neither ever
fires autonomously, and nor does `BLINK_LONG`, the deliberate ~600ms blink that
tells a speaker "that's noted, move on" (it measurably shortens answers, which
is exactly why only the server may send it).

Notes on a few, because the detail is the point:

- `MM_HMM` — lips stay shut the whole way; the meaning is entirely in the nod.
- `ONE_MOMENT` — breaks eye contact to `AWAY_RIGHT`. That break, not the words,
  is what communicates "hold on".
- `SORRY` — driven by `browInner` (AU1, the inner-brow lift). That single
  channel is the whole apology.
- `WAVE`, `THUMBS_UP`, `SHRUG`, `GO_ON_ARM`, `RAISE_HAND` — these were arm and
  hand gestures. The rig has neither any more, and the IDs stayed because they
  are a wire contract the server targets; each was re-authored to say the same
  thing from the face, shoulders and torso. `WAVE` is now the eyebrow flash,
  which is the greeting display a face makes when an arm is unavailable;
  `THUMBS_UP` is a slow deep approving nod; `SHRUG` runs the shoulders to the
  top of their range with the mouth corners pulled *down*, because raised
  shoulders over a neutral mouth is a flinch rather than an "I don't know".

To use your own TTS clips, attach audio and the baked track re-schedules against
the real file's clock:

```js
import { attachAudio } from './src/avatar.js';
attachAudio('OKAY', '/audio/agent-okay.mp3');
```

Clips ramp in over 70ms and out over 150ms, are interruptible, and a repeat of
the clip already playing collapses rather than stacking.

### Misc

```js
avatar.blink(true);              // true = double blink
avatar.setMouthGain(1.2);        // articulation: scales the viseme shapes as authored
avatar.setGestureGain(0.8);      // scales every clip delta
avatar.setMotionGain(0.8);       // scales the whole idle/body liveness layer
avatar.setAudioFallback(el);     // null to detach
avatar.setOverrides({ ... });    // direct param injection, for tuning UIs
avatar.setOverrides(null);
avatar.params;                   // live smoothed parameter vector (read-only)
avatar.state / .emotion / .gaze / .speaking / .clip / .performing / .audioLevel
avatar.mouthGain / .gestureGain / .motionGain / .svg / .meta
avatar.destroy();
```

Every setter returns the instance, so calls chain. `params`, `svg` and `meta`
are properties, not methods. (`meta` is the mounted avatar's descriptor — the
call demo sizes its tile from `meta.viewBox`.)

Events: `state` (new state name), `speakEnd`, `clipEnd` (clip id),
`backchannel` (autonomous ack id), `performEnd`.

---

## Files

| file | |
|---|---|
| `src/params.js` | the parameter space, smoothing constants, channel groups |
| `src/face-core.js` | what every face shares: the renderer shell, pose mechanics, shared feature fragments |
| `src/face-peep.js` | the `peep` avatar — the default. Open Peeps line art. No strokes anywhere: every line is a filled path, so it swells and tapers |
| `src/face-wren.js` | the `wren` avatar — the second line-art character, same kit |
| `src/face-myna.js` | the `myna` avatar — the first built by the staged process, from a reference asset |
| `src/line-art.js` | the stroke engine every line-art rig shares: `taper`, `taperRing`, `region` |
| `src/avatar.d.ts` | hand-maintained types for the public surface. The widget has no compiler; this is written against the contract |
| `src/visemes.js` | A–H protocol, cue hygiene, audio-clock scheduling, server mapping tables |
| `src/emotions.js` | six affect poses |
| `src/gaze.js` | named targets, saccade + head-follow model, micro-saccades |
| `src/idle.js` | per-state liveness profiles, the `ListeningEngine`, autonomous backchannel |
| `src/clips.js` | keyframe player for gesture timelines |
| `src/interjections.js` | the 26 clips |
| `src/perform.js` | the action-timeline player behind `perform()` |
| `src/audio-fallback.js` | WebAudio amplitude/spectral lipsync |
| `src/avatar.js` | public API, the per-frame mixer, and the `AVATARS` registry |
| `client/src/AvatarClient.ts` | the dispatcher: turn-clock anchoring and the cue splice, framework-free |
| `client/src/useAvatar.ts` `client/src/Avatar.tsx` | the React binding — a mount lifecycle over `AvatarClient` |
| `client/src/types.ts` | the wire vocabulary in TypeScript. Kept in step with `contract-protocol.md` and `messages.py` |
| `py/src/voqalize_avatar/` | the pipecat backend: state machine, processor, viseme engine, `avatarsync` pool |
| `native/avatarsync/` | the Rhubarb Lip Sync fork — text leg and audio leg — plus its patch and build script |
| `docs/contract-protocol.md` `docs/contract-avatar.md` | the two binding interface contracts |
| `docs/design-library-split.md` | why this is a library, and what each published artifact owns |
| `docs/research-biomechanics.md` | the citations behind the motion constants |
| `tools/` | headless render / sweep / pixel-diff CLI (dev-only dependencies) |
| `serve.py` | the dev server — `Cache-Control: no-store`. Use this one |
| `index.html` | the full harness, driving one avatar as a host would |
| `demo/call.html` | the Meet-style call: VAD, turn-taking, token log. The page to show people |
| `demo/floor.js` | turn-taking — barge-in, backchannel acks, floor claim. A stand-in for the server |
| `demo/vad.js` | mic voice activity — silero via CDN, RMS fallback |
| `demo/perf-clips.json` `demo/perf-audio/` | 16 scripted turns the call demo plays: audio, cue tracks, gesture beats |
| `demo/eval-clips.json` `demo/eval-audio/` | 24 clips the lipsync eval scores against |
| `demo/rig/index.html` | the index for the rig tooling below — the way in |
| `demo/rig/rig-check.html` | every registered avatar side by side through the live mixer; `sweep()` |
| `demo/rig/contact-sheet.html` | static poses for one avatar: every viseme, emotion, gaze, extreme |
| `demo/rig/torso-check.html` | shoulder / lean / trunk-turn / head combinations, which only fail together |
| `demo/rig/body-lab.html` | the rig stepped by hand, seeded — the driver `tools/motion.mjs` measures |
| `demo/rig/clip-strip.html` | one gesture clip as a filmstrip, with the mixer's own smoothing |
| `demo/rig/expression-lab.html` | clip and beat authoring against real audio |
| `demo/rig/lipsync-eval.html` | cue tracks A/B, sphinx vs phonetic |
| `experiments/rhubarb-textsync/` | server-side experiment: A–H letters from text, before the audio exists. Ships nowhere near the widget |

`face-peep.js` and `face-wren.js` draw four layers each; the original rig drew
seven. Every layer carries a parallax multiplier (0.1 for the body, up to 1.34
on the rig with a separate front fringe), which fakes a head turn convincingly
without any 3-D. The layer set follows the art rather than a standard — the
line-art rigs fuse pairs that a more detailed drawing keeps separate. If you
restyle the character the parameter contract is unchanged; only the face module
needs to know what a face looks like.

The clip data lives in `demo/` rather than beside the pages that use it, because
`demo/call.html` and both lab pages play the same wavs and one copy of a
hundred of them is the point. The lab pages sit a directory deeper and carry a
`DATA = '../'` constant for the hop back up.

## License

**AGPL-3.0-only.** Open source, and deliberately the restrictive end of it: you
may use, modify and self-host this freely, but a modified version offered to
users over a network has to offer them its source too. That is a starting
position taken while the project is young, not a final one — Voqalize holds the
copyright on all of it, so relicensing to something permissive later is a
decision we can simply make.

Two consequences worth knowing before you build on it:

- Embedding the widget in a closed-source product is not what this license
  permits. If that is what you need, open an issue — a commercial license is a
  conversation we are happy to have.
- The `avatarsync` aligner in `native/avatarsync/` is a fork of
  [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync), which is
  MIT. The prebuilt binaries there statically link pocketsphinx, sphinxbase,
  flite, WebRTC, cppformat, GSL, Boost and the CMU acoustic model; upstream's
  own notice file for all of them is committed beside them as
  `native/avatarsync/UPSTREAM-LICENSE.md`. Those terms are unchanged and travel
  with that directory.

### Third-party material

| what | where | terms |
|---|---|---|
| [Open Peeps](https://www.openpeeps.com/) | the drawing *idiom* `peep` is authored in — no artwork is copied | CC0 |
| Rhubarb Lip Sync 1.14.0 | `native/avatarsync/` (fetched at build time, not vendored) | MIT; see `UPSTREAM-LICENSE.md` |
| [piper](https://github.com/OHF-Voice/piper1-gpl) voices `en_US-ljspeech-high`, `en_US-libritts_r-medium` | spoke every wav in `demo/*-audio/` and the fixtures in `py/tests/fixtures/` | LJSpeech is public domain; LibriTTS-R is CC BY 4.0 |
| [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) + onnxruntime-web (silero-vad) | loaded from jsDelivr by `demo/vad.js`, demo only — nothing in `src/` fetches it | MIT |

The three avatars are original drawings. All demo audio is synthesised from text
written for this repo.

Releasing is documented in [RELEASING.md](RELEASING.md).
