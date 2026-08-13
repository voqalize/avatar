# Removed in 0.2 — what went, why, and how to get it back

0.2 cut the public surface down to what the two live consumers actually use:
**one React component** on the browser side, **one zero-argument
`FrameProcessor`** on the backend, and **six wire commands** between them. The
brief was explicit that the way to do this is deletion rather than flags —
*"Either delete or hide the features that don't meet this brief. Don't pollute
the public interface by adding switches / flags. Deleting things is fine — we
can recover from git."*

It has since become the standing catalogue for anything cut from the public
surface, so one entry below names a later tag; read the entry, not the heading.

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
and interjections, and the timelines that exist are authored in `demo/`, not
sent by a server. It also carried the only piece of *client* logic that had to
guess: `resolveClock` had to decide whether a `perform` naming a ctx we never
saw a `speech start` for should ride that turn's clock or a fresh one, and both
answers are wrong in some deployment.

**Note:** `avatar.perform(actions, {audio, clock})` is **not** removed — it is
still the composition surface, still documented in contract-protocol.md, and
`demo/floor.js` still drives every scripted turn through it. What went away is
a *server* being able to send one over the wire.

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

## The `/pipecat` and `/react` subpaths

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
