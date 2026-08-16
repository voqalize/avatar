# Removed in 0.2 — what went, why, and how to get it back

0.2 cut the public surface down to what the two live consumers actually use:
**one React component** on the browser side, **one zero-argument
`FrameProcessor`** on the backend, and **six wire commands** between them. The
brief was explicit that the way to do this is deletion rather than flags —
*"Either delete or hide the features that don't meet this brief. Don't pollute
the public interface by adding switches / flags. Deleting things is fine — we
can recover from git."*

It has since become the standing catalogue for anything cut from the public
surface, so several entries below name a later tag; read the entry, not the
heading. The 0.3 cycle made two coherent swaps rather than sets of independent
cuts, so each has its own section at the end, both recovering from **`v0.2.2`**:
[the backend transport](#removed-in-03--the-backend-transport) and
[the demo surfaces](#removed-in-03--the-demo-surfaces).

This file is the recovery map. Nothing below is lost; **`v0.1.0` is the tag
where these still work** unless the entry says otherwise, so the general move
is:

```sh
git show v0.1.0:<path>                 # read it
git checkout v0.1.0 -- <path>          # bring the file back
git log --oneline v0.1.0 -- <path>     # how it got that way
```

The entries are ordered roughly by how likely someone is to want them back.
Each says what it did, why it went, and what to do instead — because in most
cases the answer is not "restore the file".

---

## Amplitude lipsync

**Was:** `src/audio-fallback.js` — a WebAudio energy/spectral guesser that
watched the bot's own `<audio>` element or `MediaStream` and drove the mouth
from it when no cue track was live. Reached through
`avatar.setAudioFallback(elOrStream)`, with `avatar.audioLevel` as its readout,
and it was the third tier of the mouth priority rule.

**Why it went:** it existed for a server that sends no cues, and there is no
longer such a server — `AvatarProcessor` is a `pip install` and a line in the
pipeline, and it always sends cues. What the fallback actually bought in
practice was a *worse* mouth that was hard to tell apart from a broken one:
when lipsync looked wrong, the first question was always "is this the fallback
or the real track?". Mouth sync is the headline feature (CLAUDE.md
§ Constraints), and a second, lower-fidelity mouth path standing behind it is a liability
rather than a safety net.

**Instead:** run the processor. If it cannot start — no aligner for the
platform — the face still listens, thinks, claims the floor and yields it; only
the mouth stays still while it speaks. That degradation is deliberate and
legible, which the fallback's was not.

**Recover:** `git checkout v0.1.0 -- src/audio-fallback.js`, plus the
`setAudioFallback` / `audioLevel` members in `src/avatar.d.ts` and their wiring
in the `src/avatar.js` mixer (`git show v0.1.0:src/avatar.js`, search
`fallback`).

---

## Client-side VAD (`setUserAudio`)

**Was:** `avatar.setUserAudio(streamOrElement)` — the widget ran its own coarse
RMS VAD (80 ms on, 250 ms off) over the *user's* microphone and fed the
listening engine from it, so backchannels could be contingent without the
server saying anything.

**Why it went:** it was a second voice-activity detector racing the one the
pipeline already runs, and the pipeline's wins — it is the same signal the
server endpoints turns with, so the avatar and the agent agree about who has
the floor. Two detectors that disagree produce an avatar that nods into the
user's sentence.

**Instead:** `setUserSpeaking(bool)`, which is what the `user` wire command
already carries, driven from the server's `UserStartedSpeakingFrame` /
`UserStoppedSpeakingFrame`. The listening engine is unchanged behind it. With
no signal at all it still falls back to its loose 3.4–8 s timer.

**Recover:** `git show v0.1.0:src/avatar.js` — `setUserAudio`, the RMS meter it
built, and the `fallback.level` readout it shared with the amplitude tier above
(the two were one WebAudio path, so they come back together or not at all).

---

## The `perform` command

**Was:** a wire command carrying a whole action timeline —
`{cmd:"perform", ctx, actions:[{t, do, name|id}, …]}` — which the client rode
against the named turn's clock.

**Why it went:** no consumer composed one. Both drive the face through states
and interjections, and the timelines that exist are authored in `authoring/`, not
sent by a server. It also carried the only piece of *client* logic that had to
guess: `resolveClock` had to decide whether a `perform` naming a ctx we never
saw a `speech start` for should ride that turn's clock or a fresh one, and both
answers are wrong in some deployment.

**Note:** `avatar.perform(actions, {audio, clock})` is **not** removed — it is
still the composition surface, still documented in internal-mixer.md, and
`authoring/expression-lab.html` still drives every scripted turn through it. What
went away is a *server* being able to send one over the wire.

**Recover:** `git show v0.1.0:client/src/AvatarClient.ts` (`handlePerform`,
`resolveClock`) and the `AvatarPerformCmd` / `AvatarPerformAction` types in
`client/src/types.ts`. The Python constructor is
`git show v0.1.0:py/src/voqalize_avatar/messages.py` (`AvatarMessage.perform`) —
note that nothing in the backend ever called it; it was a way for an application
to build the message, which is the shape of the problem.

---

## The `hint` command

**Was:** `{cmd:"hint", kind:"eager_eot"}` — an advisory that rendered nothing
and was forwarded to an `onHint` callback for the application to act on.

**Why it went:** a wire command that the widget does not render is not part of
this protocol. It was an application's own signal borrowing the avatar's
envelope, and it made the wire vocabulary harder to reason about for exactly
zero motion on screen.

**Instead:** an application with its own out-of-band signal sends its own RTVI
server-message under its own `type`. The avatar envelope is now a closed
question: `{type:"avatar"}` means "this makes the face do something."

**Recover:** `git show v0.1.0:client/src/types.ts` (`AvatarHintCmd`) and the
`case "hint"` in `AvatarClient.ts`. The Python side is `Hint` and
`AvatarMessage.hint` in `git show v0.1.0:py/src/voqalize_avatar/messages.py`,
plus `state_machine.py`'s eager-end-of-turn path.

---

## The `v` field

**Was:** every message carried `"v": 1`, mirrored as `AVATAR_PROTOCOL_VERSION`
in both packages.

**Why it went:** it was our invention, not something RTVI asks for, and nothing
ever read it. Forward compatibility is the ignore-unknown-`cmd` rule, which
works per-command and needs no version; a version number would only have helped
for a change that breaks an *existing* command's shape, and the two packages
ship in lockstep from one tag precisely so that cannot happen quietly.

**Instead:** the npm and PyPI versions, which the release workflow refuses to
let disagree.

**Recover:** it is one key in `messages.py`'s `to_wire()` and one constant in
`client/src/types.ts`. Adding it back is easier than restoring it.

---

## The `accept` predicate

**Was:** `new AvatarClient(avatar, { accept: (msg) => … })` — a per-deployment
predicate deciding which server messages counted as the avatar's, defaulting to
`msg.type === "avatar"`.

**Why it went:** it meant the library could not state what an avatar message
*is*, which is the one thing a wire format has to be able to say. Every
deployment that overrode it was tunnelling avatar commands inside its own
envelope, and the fix for that is to stop doing it.

**Instead:** `{type:"avatar"}`, always, in both directions and from every
source — the pipeline processor and an application driving the face out of band
emit the same shape. `isAvatarMessage` in `client/src/types.ts` is the whole
definition and is three lines.

**Recover:** `git show v0.1.0:client/src/AvatarClient.ts` — the `accept` field,
its constructor default, and its use in `attach()`.

---

## Client callbacks

**Was:** `AvatarClientOptions` carried `onHint`, `onUnknownCmd` and
`onSpeakingDrift` alongside `onError`; the last one drove a second and third
RTVI subscription (`botStartedSpeaking` / `botStoppedSpeaking`) purely to report
the gap between our turn anchor and pipecat's.

**Why they went:** observability, not interface. `onUnknownCmd` reported
something the caller could not act on; `onSpeakingDrift` was a diagnostic from
the period when the anchoring design was still being argued, and that argument
is settled and written down at the top of `AvatarClient.ts`. Keeping them cost
two extra event subscriptions on every mount.

**Instead:** `onError` survives, but is not reachable either — `<Avatar>` takes
`client` and `avatar` and nothing else. A dispatch that throws warns on the
console.

**Recover:** `git show v0.1.0:client/src/AvatarClient.ts` (`reportDrift`, the
three-event `RTVI_EVENTS`, the option fields) and
`git show v0.1.0:client/src/useAvatar.ts`, which forwarded all four.

---

## Presence and audio-level callbacks

**Was:** `onPresenceChange(state)` and `onRemoteAudioLevel(level)` on
`AvatarProps`, `UseAvatarOptions` and `AvatarClientOptions`, plus
`data-avatar-state` / a state-derived `aria-label` on the mount div,
`AvatarClient.presenceState` and `.botAudioLevel` as public getters, and the
`AvatarPresenceState` type export.

**Why they went (0.3):** *"Avatar is an embodiment of PipecatClient, and reacts
to PipecatClient. There is no Avatar state beyond what PipecatClient exposes.
Client does not get to read the Avatars internal state. I don't want to commit
to any such behaviour."* The deeper problem is that **a callback is a
contract**: once `createAvatar` is the seam anyone can implement, an emitted
presence obliges every third-party avatar to produce those seven names with our
precedence rules — silently reintroducing the second public contract the design
exists to avoid ([design-avatar-interface.md](design-avatar-interface.md)).

`onRemoteAudioLevel` was worse than redundant. Nothing internal read it; it was
a pure relay, and it cost an RTVI subscription on a per-frame event so a host
could draw a waveform from a gain that might belong to a different participant.

**Instead:** the host owns the same `PipecatClient`. Subscribe to it directly —
`botStartedSpeaking`, `userStartedSpeaking`, `remoteAudioLevel` — and apply
whatever precedence its chrome wants. If several hosts converge on the same
rules, a standalone `observePresence(client)` helper is the shape to add, not a
callback on the avatar.

`onPresenceChange` survives on the **internal** `AvatarClientOptions` for
Studio's inspector. It is not exported and must not be published.

**Recover:** `git show v0.2.2:client/src/AvatarClient.ts` (the field, getter,
`setRemoteAudioLevel`, `onRemoteAudioLevel`, the `remoteAudioLevel` entry in
`RTVI_EVENTS` and its subscription) and `git show v0.2.2:client/src/Avatar.tsx`.

---

## State programs

**Was:** `STATE_PROGRAMS` and `BEHAVIOR_ACTIVITIES` in `src/behavior.js`, and
the timer in `BehaviorController` that drove them. `WORKING` started a program
that re-selected an activity every 2.2–3.2 s; `work.review_notes` and
`work.secondary_screen` were reserved but never selectable.

**Why they went (0.3):** the table had one activity, so the timer re-issued the
same `setState('TYPING')` forever — and that projection is what carried the
leak: a renderer asked to be `WORKING` was told to be `TYPING`, a behaviour
named after one rendering of it. Closing the leak left a scheduler with one
choice.

**Instead:** `WORKING` is a state in the SVG mixer like any other. Cycling among
work activities is a *renderer's* decision — the same call that a Rive state
machine would make internally — so it belongs in `src/avatar.js`, below the
seam, whenever the notes and secondary-screen timelines are actually authored.

**Recover:** `git show v0.2.2:src/behavior.js` for both tables, `_startProgram`
and `_stopProgram`.

---

## The `/pipecat` and `/react` subpaths

> Partly reversed in 0.3. `./react` is back, and `./internal` is new, because
> `createAvatar` became the public seam and had to be reachable without React.
> The entry stands for what `./pipecat` was and why one entrypoint was right
> while `<Avatar>` was the whole surface.

**Was:** three npm entrypoints — the bare widget at `.` (`createAvatar`,
`AvatarApi`), the framework-free dispatcher at `./pipecat` (`AvatarClient`,
`isAvatarMessage`, the command types), and the binding at `./react`
(`Avatar`, `useAvatar`).

**Why they went:** the brief is *"assume react, make that your only
entrypoint"*. Both consumers render a call tile in React. Three entrypoints
meant three public surfaces to keep stable across versions, and two of them
existed for a host that does not exist.

**Instead:** `import { Avatar } from "@voqalize/avatar"`. `createAvatar`, the
`AvatarApi` interface, `AvatarClient` and the wire types are all still in the
tarball (`src/` and `client/src/` are both published) — they are simply not
`exports`. A host that genuinely needs the raw widget can reach it by deep
path today and ask for a real entrypoint if it turns out to be the third case.

**Recover:** `git show v0.1.0:package.json` for the `exports` map, and
`git checkout v0.1.0 -- client/src/pipecat.ts client/src/react.ts` for the two
barrels.

---

## `<Avatar theme=… mouthGain=… gestureGain=…>`

**Was:** props forwarded into `createAvatar` at mount.

**Why they went:** knobs with no consumer. `theme` in particular is a trap —
the palette keys exist, but a two-value line drawing does not survive a value
swap (see CLAUDE.md, *`peep` has no dark mode*), so a `theme` prop invited a
change that cannot look right. The gains are rig-tuning controls; they belong
to whoever is authoring a face, and that is done from the rig pages.

**Instead:** nothing. If a tile needs the mouth opened up because it renders at
90 px, that is a finding about the *rig*, and the fix is in the rig.

**Recover:** `git show v0.1.0:client/src/useAvatar.ts` and `Avatar.tsx`.

---

## `AvatarProcessor(...)` arguments

**Was:** the processor took a `state_machine=` argument, and there was a
`wiring.py` that reached into the TTS service to discover its voice id so the
fast viseme leg could use per-voice phone durations. `AvatarErrorObserver` was
a separate observer class an application added to the pipeline to route
`ErrorFrame`s into the avatar's `CANT_HEAR`.

**Why they went:** the brief — *"client developers should not have to worry
about binaries or libraries or processes or environment variables. Add the
processor, starts working."* `AvatarProcessor()` now takes nothing:
`StartFrame` carries the sample rate, and `ErrorFrame` is handled in the
processor itself, where every other frame is handled. The voice tuning bought a
refinement to the first ~500 ms of a turn that the requester called not
perceptible, and it cost a reach into another processor's internals.

**Instead:** subclass `AvatarStateMachine` and translate in `on_frame` — the
documented seam, imported from `voqalize_avatar.state_machine` (deliberately
not in the barrel; a seam should cost one extra import). `py/README.md` has the
recipe. The fast leg still improves with a refitted `duration_table.json` —
`py/scripts/fit_durations.py` is unchanged; it just no longer keys on a voice
the library had to go looking for.

**Recover:** `git checkout v0.1.0 -- py/src/voqalize_avatar/wiring.py
py/src/voqalize_avatar/error_observer.py py/tests/test_wiring.py
py/tests/test_error_observer.py`, and `git show v0.1.0:py/src/voqalize_avatar/processor.py`
for the constructor.

---

## `AvatarProcessor.PAD_MS`

**Was:** a class attribute (0.2.1 only — `git show v0.2.1:` for any of it)
declaring the fixed tail of silence a TTS service appends to every sentence.
`INTER_SENTENCE_PAD_MS = 250` in `visemes.py` was the one measured value, and
the engine used the number twice: it trimmed the pad off a chunk's PCM before
recognition, and it added the pad to a sentence's predicted length when placing
the *next* sentence's fast-leg cues.

**Why it went:** neither use survived scrutiny. The trim was tidiness —
rhubarb's VAD skips silence anyway, and what comes back for a pad is `X`, which
is exactly the cue the closing shape would have had to synthesize. And the
estimate only ever places sentence 2 onward, which is the part of the timeline
generation outruns: those cues are overwritten by measurement before playout
reaches them. So a public knob every consumer had to measure was buying an
adjustment to cues nobody sees. The requester's call, and the code agreed with
it: *"The 250ms only ever matters for the fast path lip sync, which is only
500ms… Silence in actual audio isn't a problem - rhubarb handles it just fine."*

**Instead:** nothing. Padded silence is wire time like any other — it counts in
`turn.resolved_wire_ms` byte for byte, and recognition returns `X` for it.
`estimate_duration_ms` predicts *speech* and is used only where measurement has
not arrived yet.

**Recover:** `git show v0.2.1:py/src/voqalize_avatar/visemes.py` and
`git show v0.2.1:py/src/voqalize_avatar/processor.py`; the tests that covered
it are in `git show v0.2.1:py/tests/test_visemes.py`.

---

## `tool_states`

**Was:** `AvatarStateMachine(tool_states={"search_web": AvatarState.SEARCHING_SCREEN})`
— a per-application map from tool name to avatar state, so a function call
could show `SEARCHING_SCREEN` or `TYPING` instead of plain `THINKING`.

**Why it went:** it is application knowledge configured through the library,
which is the shape the design doc says to avoid — the library models what it
can infer from stock frames, and everything else is *"write your own
FrameProcessor"* (or, more cheaply, subclass the state machine). One map was
the thin end of a config surface that would have grown a wedge.

**Instead:** a tool call shows `THINKING`, and only that. What stays in the base
machine is the part that is not application-specific: call-id dedup, and the
hold that keeps the state until the *last* parallel call returns. Override
`on_frame` to say more.

**Recover:** `git show v0.1.0:py/src/voqalize_avatar/state_machine.py`.

---

## The Rive proof (`bob.riv`, `rive-bob.ts`, `rive-proof.md`)

**Was:** `studio/src/rive-bob.ts` — an `AvatarRig` implementation driving a
downloaded `.riv` character through the 30 pose channels, selectable in Studio
as `rive-bob`, with `docs/rive-proof.md` reporting what it found and
`@rive-app/canvas` as a Studio dependency.

**Why it went (0.3): it was plugged into the wrong seam.** It implemented
[internal-rig.md](internal-rig.md), the SVG mixer's internal parameter model,
and so spent its code undoing the wire — thresholding `mouthOpen`/`mouthPress`/
`mouthTuck` back into a Rhubarb letter the `cues` command had already stated,
and reverse-engineering `CANT_HEAR` out of brow floats. A renderer that is not
ours takes `claim` / `action` / `cues` and never sees a pose channel. That
finding is now the standing argument in
[design-avatar-interface.md § Why there is no renderer interface](design-avatar-interface.md)
and the warning box at the top of internal-rig.md — the proof is gone, its
conclusion is load-bearing.

**Instead:** a non-SVG avatar is its own `createAvatar`, published as its own
module, reading the wire. Nothing about it goes through our mixer.

**On the asset.** `demo/rive/bob.riv` was
`28111-53105-bob-lip-sync-character-system-in-rive.riv`, a Rive community file
under **CC BY 4.0**. That licence is not the reason it went — CC BY permits
redistribution and modification, including in a public AGPL-3.0 repository, and
an earlier draft of this entry saying otherwise was wrong. What was missing was
the thing CC BY actually asks for: no author credit, no licence notice, no
source URL, anywhere in the repo. `rive-proof.md` also described the file as
"only a symlink to the Downloads copy" — it was not. It was committed as a real
169,578-byte blob in `79511aa`, which is on `origin/main`, so it remains
downloadable from history and stays that way short of a rewrite.

**Recover:** `git checkout 79511aa -- studio/src/rive-bob.ts docs/rive-proof.md`
and re-add `@rive-app/canvas` to `studio/package.json`. Restoring any `.riv`
means redistributing it again: carry its attribution — author, title, source
URL, licence, and a note of modifications — in the tree beside it.

---

## The `AVATARS` registry and `avatar: 'name'`

**Was:** `AVATARS`, `AVATAR_NAMES` and `DEFAULT_AVATAR` in `src/avatar.js`, and
`createAvatar({ avatar: 'peep' })` — a face resolved by string through a table
the mixer imported all three faces to build.

**Why it went (0.3):** `AVATARS[opts.avatar || DEFAULT_AVATAR]` is a dynamic
index. No bundler can prove which arm is taken, so every consumer shipped three
hand-drawn faces to render one. Lazy `import()` was not an option: it would
make `createAvatar` async and break the synchronous `{ destroy() }` contract.

It was also the last stringly-typed thing on the public surface. Passing a
`Face` **value** fixes both at once — the option gets a real type, and importing
`@voqalize/avatar/faces/wren` costs exactly one drawing. Alongside it,
`theme?: unknown` became `FaceTheme` (`Readonly<Record<string, string>>`).

**Instead:** `import { wren } from '@voqalize/avatar/faces/wren'` and pass
`face: wren`. `src/faces.js` still holds the all-three table for tooling that
compares faces against each other — `authoring/rig-check.html`, the contact
sheet, the conformance sweep. It is deliberately not on the package export map,
and Studio does not use it either: Studio imports the three face subpaths by
name, exactly as a consumer would.

**Recover:** `git show 02b0dad:src/avatar.js`, search `AVATARS`.

---

## The behavior-state aliases

**Was:** `BEHAVIOR_STATES` carried seventeen ids — the seven core states plus
`TYPING`, `CANT_HEAR`, `REVIEWING_SCREEN`, `SEARCHING_SCREEN` and the rest of
the SVG mixer's render states, passed straight through to the renderer. Plus
`STATES.TYPING = STATES.WORKING` in the mixer, and `"TYPING"` in
`AvatarStateName`.

**Why they went (0.3):** *"We shouldn't be adding aliases — make sure everyone
is using the right types."* The pass-throughs made the mixer's private state
list look like part of the behaviour vocabulary, which is exactly the confusion
that produced `TYPING` on the wire in the first place. Only `TYPING` was a true
alias; the other names are still real, distinct render states in `src/avatar.js`
— what went is their duplication one layer up.

**Instead:** the behaviour vocabulary is the seven core states, and nothing
else. Tooling that wants a render state calls `avatar.setState` on the mixer,
which is whose state it is.

**Recover:** `git show 02b0dad:src/behavior.js`.

---

## A `face` without `meta`

**Was:** `createAvatar({ face: createFaceFn })` — a bare factory with no
descriptor. The mixer re-read `viewBox` off the produced `<svg>` and left
`meta.mouthCrop` absent.

**Why it went (0.3):** a face could ship half a descriptor and nothing would say
so — the contact sheet's viseme-detail row would simply have no mouth crop to
frame with. `Face` is `{ create, meta }`, both required, so the fallback was
unreachable from any typed caller and only reachable from a mistake.

**Instead:** export the record: `export const myFace = { create: createFace, meta: META }`.
[authoring-a-face.md](authoring-a-face.md) says what META must contain.

**Recover:** `git show 02b0dad:src/avatar.js`, search `mouthCrop`.

---

# Removed in 0.3 — the backend transport

0.3 replaced how Python reaches the aligner. The five constraints the
replacement had to satisfy are the requester's, verbatim: *some* lip movement
must play along with the audio; higher-quality visemes must catch up as soon as
possible; **no binary executable**, and it must play well with asyncio; CPU and
memory must be bounded; and it must consume the frames pipecat's TTS emits.

Everything below still works at **`v0.2.2`** — so the moves are
`git show v0.2.2:<path>` and `git checkout v0.2.2 -- <path>`.

---

## The `avatarsync` binary and its JSON-lines pipe

**Was:** `native/avatarsync/src/avatarsync.cpp` built one executable per
platform (`bin/<platform>/avatarsync`, committed, ~4 MB each) that answered both
viseme legs over stdin/stdout as JSON lines. `py/src/voqalize_avatar/avatarsync.py`
was the asyncio driver: `asyncio.create_subprocess_exec`, an `id`-correlated
request table, a reader task, per-request timeouts that restarted a wedged
process, and a `RhubarbPool` of two of them so a crash took out half the
capacity rather than all of it.

**Why it went:** *"I don't want binary executable, and I want something that
plays well with asyncio."* The pipe also made streaming impossible in the shape
the mouth needs it — a request/response line protocol answers a whole sentence
or nothing, so the accurate leg could not begin until the sentence had finished
generating. And the pool was tied to an event loop: a subprocess belongs to the
loop that spawned it, which made the shared-across-sessions engine awkward in
exactly the deployment it existed for.

**Instead:** `libavatarsync.{dylib,so}` through `ctypes`
(`py/src/voqalize_avatar/_native.py`). ctypes releases the GIL for the duration
of a foreign call, so `run_in_executor` genuinely parallelises a decode rather
than merely deferring it — the property the subprocess was bought for, without
the process. A library handle is not loop-bound, so `shared_engine()` is a plain
process global. The C++ front end went with the binary: `voqalize-avatar` (the
`cli.py` in this package) is the by-hand tool now, and it drives the same
library through the same code path a live pipeline takes, so its timings are
timings about the shipped thing.

**Recover:** `git checkout v0.2.2 -- native/avatarsync/src/avatarsync.cpp` and
`git show v0.2.2:py/src/voqalize_avatar/avatarsync.py`. The committed binaries
are at `git show v0.2.2:native/avatarsync/bin/darwin-arm64/avatarsync`, and
`build.sh` at that tag builds them.

---

## Batch decode of a finished sentence (`sentence_audio.py`)

**Was:** `py/src/voqalize_avatar/sentence_audio.py` — a per-context buffer that
accumulated `TTSAudioRawFrame` bytes and cut them at each sentence boundary, so
the accurate leg could be handed *a sentence's* PCM in one piece. It carried the
keepalive filter, an `EARLY_SPLICE_MS` prefix heuristic for the first sentence
of a turn, and the cumulative-count arithmetic that kept the cut exact. Sessions
reached the batch decoder through `AvatarsyncLease.audio_cues`.

**Why it went:** it waited. A sentence's cues could not exist until the
sentence's last byte did, which put the accurate leg a whole sentence behind the
mouth and made the fast leg carry far more of the turn than it was ever meant
to. `EARLY_SPLICE_MS` was the patch on that, and a heuristic about when a prefix
is worth recognising is the shape of a design that wants to be streaming.

**Instead:** live streaming decode. The engine opens one `NativeStream` per turn
and feeds it each audio frame as it arrives, reading cues back to
`HOLD_BACK_MS = 100` behind the fed edge. Sentence boundaries still matter —
they are where a rewrite is anchored — but they no longer gate recognition.
`AvatarsyncEngine.audio_cues` survives for whole-file callers (the CLI, the
measurement scripts); a *session* has no finished audio and so has no use for
it, which is why the lease does not expose it.

**Recover:** `git checkout v0.2.2 -- py/src/voqalize_avatar/sentence_audio.py
py/tests/test_sentence_audio.py`, plus the `_emit_sentence` / `_emit_chunk` path
in `git show v0.2.2:py/src/voqalize_avatar/visemes.py`.

---

## Small surfaces that had one caller

**Was:** four of them, all removed for the same reason — the only thing reaching
them was a test, a script, or nothing.

- `visemes.join_audio_chunks` — concatenated a sentence's chunks with the
  keepalives dropped. Its consumer was `sentence_audio.py`; production now drops
  keepalives inline in `on_audio`, one frame at a time.
- `AvatarsyncEngine.running` — a boolean property, asserted only by its own test.
- `NativeStream.edge_ms` (and the `avs_stream_edge_ms` binding behind it) — the
  decoder's view of how much audio it holds. The engine takes the edge from what
  it has *fed*, so that both halves of an emission agree on one number; a second,
  slightly different edge is an invitation to mix them.
- `NativeEngine(max_streams=…)` — the pool ceiling as a constructor argument. The
  library's default has never been overridden. It is still *read* back, and
  `voqalize-avatar info` now prints it, because a hard memory bound that nothing
  displays is a bound nobody checks.

**Why they went:** CLAUDE.md's rule, applied to the backend — a knob needs a real
consumer asking, not a plausible one. A parameter with no caller is a promise the
library has not been asked to keep and cannot be tested for.

**Instead:** nothing, in every case. If a ceiling ever needs configuring, add the
argument then, with the caller that wants it.

**Recover:** `git show v0.2.2:py/src/voqalize_avatar/visemes.py` for
`join_audio_chunks`; the rest were added and removed inside the 0.3 cycle and
live only in this file's history.

---

# Removed in 0.3 — the demo surfaces

0.3 also cut the browser pages that *pretended* to be a call. The repo had
grown three answers to "show me the avatar" — a fake call, a control harness
and an IDE built on hand-written traces — and only one of them ever exercised
the wire. What replaced them is one real pipecat process in `server/` and one
IDE in `studio/` that speaks to it through the published `createAvatar` seam.

Everything below still works at **`v0.2.2`**: `git show v0.2.2:<path>`,
`git checkout v0.2.2 -- <path>`.

---

## The fake call (`demo/call.html`, `demo/floor.js`, `demo/vad.js`)

**Was:** a Meet-style call page, the one to show people. `demo/call.html` drew
the tile and the controls; `demo/floor.js` was a turn-taking floor manager that
played `demo/perf-clips.json` — baked audio, cues and `perform` beats — as
scripted agent turns; `demo/vad.js` loaded `@ricky0123/vad-web` and
onnxruntime-web from jsDelivr so the user's microphone could take the floor
back.

**Why it went:** none of it was the library. The floor manager decided when the
agent spoke, which is the one decision CLAUDE.md says the client never makes —
so the page demonstrated an architecture the shipped code does not have, and
demonstrated it convincingly enough to be believed. The wire was never
involved: no `claim`, no `action`, no `cues` message crossed anything, because
there was no server. And it was the repo's only runtime fetch from a CDN, in a
project whose `src/` is dependency-free on purpose.

**Instead:** `server/` — a real pipecat pipeline with canned LLM and TTS
services, so it needs no API key, and a real `SmallWebRTCTransport`. Turn-taking
is pipecat's, the wire is the wire, and the microphone is the browser's.
`server/index.html` is the 30-second look; `studio/` is the same call with the
`createAvatar` options exposed and the wire decoded beside it.

**Worth recovering on purpose:** the tile treatment. `call.html` painted the
surround transparent and feathered the drawing's two vertical edges with a
mask, because peep's white shirt is drawn to run off its own frame and
otherwise stops in mid-air. Nothing in the repo does that now — `server/` and
`studio/` both letterbox the drawing in a flat tile. A host that wants the
edges to dissolve should read the original.

**Recover:** `git checkout v0.2.2 -- demo/call.html demo/floor.js demo/vad.js`.
The clips it played are still checked in at `authoring/perf-clips.json`,
because `authoring/expression-lab.html` plays them too.

---

## Studio's four workspaces and their traces

**Was:** `#/rig` (pose extremes, the viseme alphabet and hand gestures as
inspection targets), `#/behavior` (a base state plus a finite action, driven
through `BehaviorController` with `random: () => 0`), `#/runtime` (replay a
hand-written `Trace` — an array of `{at, kind, value}` events plus an optional
wav — from an arbitrary cursor position, with a timeline scrubber), and
`#/connection` (attach a `PipecatClient` you had built yourself). Plus
`studio/src/rive-bob.ts`, a fifth avatar behind a rig adapter, and
`docs/studio-verification.md` describing which route proved what.

**Why they went:** three of the four reached past the published seam to do
their job. `#/rig` drove `avatar.setOverrides` and the pose channels — the
mixer's internals, which `createAvatar` deliberately does not expose. `#/behavior`
instantiated `BehaviorController` directly. `#/runtime` was the load-bearing
mistake: a trace is a **fixture**, written by us, so the thing it proved was
that our reader could read our own writing. Every subtle wire question — does a
claim lose to observed playout, does a cue burst arriving out of order latch or
jump, what the ~170 cue chunks of one real utterance actually look like — is
invisible to a fixture, because a fixture only contains what its author already
knew to put in it. `#/connection` was honest and empty: it asked the developer
to bring a client from somewhere the repo did not provide.

**Instead:** `server/` provides the somewhere. Studio drives a real
`SmallWebRTCTransport` call against a real pipecat pipeline, and every control
that moves the face is an HTTP request asking the *server* to send the message —
including the misbehaviours, which are now real messages from a real server
rather than a fixture describing one ([studio/README.md](../studio/README.md)).

**Recover:** these never shipped in a tagged release — Studio was added to
`main` after `v0.2.2`. `git show 79511aa:studio/src/App.tsx` has all four
workspaces and the trace type; `git show 79511aa:studio/src/rive-bob.ts` and
`git show 79511aa:docs/studio-verification.md` for the rest.

---

## The puppeteer conformance gate (`tools/sweep.mjs`)

**Was:** `node tools/sweep.mjs` — launch Chrome, serve the repo, load
`rig-check.html`, call `window.sweep()`, exit non-zero on failure. It was the
documented pre-commit gate for anything touching `src/`, and a CI job of its
own with `PUPPETEER_ARGS: --no-sandbox`.

**Why it went:** the sweep asserts *numbers* — finite, in-range mixer
parameters and a drawing still attached to the document — and never once looked
at a pixel. A real browser was ~15 s of wall clock and a headless-Chrome
dependency in CI, bought for a DOM and a clock that jsdom already has.

**Instead:** the assertions live in `src/conformance.js` with an `advance` seam,
and run two ways from one copy. `client/test/conformance.test.ts` steps
`{manual: true}` avatars at a fixed dt under a seeded RNG and finishes in
~230 ms, inside `pnpm test`. `authoring/rig-check.html`'s **run sweep** button
runs the same function in real time, on faces you can watch it happen to —
which is the half a browser was ever needed for.

**Recover:** `git checkout v0.2.2 -- tools/sweep.mjs`. It calls
`window.sweep()`, which `authoring/rig-check.html` still defines.
