# Avatar

A renderer-agnostic behavior library that makes a 2-D talking head read as
*present* in an AI voice call. **Pipecat owns facts, the server owns intent, the
rig only renders** — that precedence is the design
([pipecat-lifecycle-protocol.md § Authority model](docs/pipecat-lifecycle-protocol.md)).

> **This repository holds two things with different rules, and confusing them
> wastes a change (from 0.4.0).** `packages/avatar/` and `docs/` are a
> *published artifact*: they are developed in a private working tree and arrive
> here as one synthesised commit per release, carrying an `Exported-From:`
> trailer that names the private revision. **Editing them here is editing a
> build output** — the next export overwrites it, silently, and no test catches
> that. `packages/avatar-py/`, `apps/server/`, the workflows and the root
> manifests are this repository's own; no export ever writes them, and they take
> pull requests ([CONTRIBUTING.md](CONTRIBUTING.md)). The reason for the split is
> one directory that is not here: the Blender pipeline that compiles a 2.5-D
> character is the part of this project we are not publishing, and the
> characters themselves ship as compiled binaries under CC-BY 4.0.
>
> So: a JavaScript or documentation fix goes to the working tree, and lands here
> with the next release. If you are reading this in a checkout that *has* a
> `packages/avatar-3d/`, you are in the working tree and this note does not apply
> to you.

Library, not product; two live consumers, both pipecat voice agents. Public at
`voqalize/avatar` under MIT, with the character binaries under CC-BY 4.0 — **everything committed here is public**.
`@voqalize/avatar` (npm) and `voqalize-avatar` (PyPI) are two ends of one wire
format and release independently, from `npm-v<semver>` and `py-v<semver>` tags —
the wire keeps them compatible, not a shared version ([RELEASING.md](RELEASING.md)).
Both of those are reframings of a narrower original brief — a talking head for
one AI voice interviewer — and the requester's words are the authority if either
reopens: *"This is an avatar for online AI based calls. The avatar can take
multiple roles, and can be named different things"* (2026-08-05), so the code and
every enum are role-neutral and the human is the *user*, never the candidate;
*"there are now two users for this library and so it is a good time to abstract
things out better"* (2026-08-07), which is why there is a split at all
([design-library-split.md](docs/design-library-split.md)).

## The seams

Each row is a boundary that holds. If a thing is implemented behind one of
these, link to it — do not re-explain it here.

**Only the first two rows are contracts** — a format someone outside this repo
implements or depends on. Everything below the rule is our own internals and is
named `internal-*` so a future renderer does not plug into the wrong one; that
mistake has already been made once.

| layer | owns | code | reference |
|---|---|---|---|
| **wire** | `state` / `action` / `cues`, nothing else | `packages/avatar/client/AvatarClient.ts` | **[contract-wire.md](docs/contract-wire.md)** |
| **avatar** | `createAvatar({mount, client}) -> {destroy()}` — the only public seam | `packages/avatar/client/createAvatar.ts` | **[design-avatar-interface.md](docs/design-avatar-interface.md)** |
| lifecycle | effective-state precedence, cue-clock anchor, FIFO ctx bind — **the one copy of the precedence ladder** | `packages/avatar/client/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions, wire→library mapping | `packages/avatar/src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| backend | state inference from stock frames, the viseme legs | `packages/avatar-py/src/voqalize_avatar/` | [packages/avatar-py/README.md](packages/avatar-py/README.md) |
| mixer | layer order, per-channel smoothing, gaze, idle, clips — **the driving API, `/internal`, no semver promise** | `packages/avatar/src/avatar.js` | [internal-mixer.md](docs/internal-mixer.md) |
| rig | `apply({pose, hand})` / `destroy()`, the 30 pose channels — **internal to the SVG renderer, not a seam to implement** | `packages/avatar/src/rig.js` | [internal-rig.md](docs/internal-rig.md) |
| SVG faces | the drawings; `createFace` / `META`, exported as a `{create, meta}` value per module — never resolved by name | `packages/avatar/src/face-*.js`, `line-art.js`, `packages/avatar/src/faces.js` (tooling only) | [authoring-a-face.md](docs/authoring-a-face.md) |
| 2.5-D characters | `tara`, `tushar`, `tanya` — one `createAvatar` each over one shared rig; `three` is an *optional* peer, so a drawing never pays for a 3-D engine | `packages/avatar/client/three/`, `packages/avatar/assets/*.glb` | [characters.md](docs/characters.md) |
| Canvas2D avatars | the six professional identities, each a complete `createAvatar` module — private renderer, rig JSON and wardrobe webp images kept out of the public surface | `packages/avatar/src/canvas/`, `packages/avatar/client/{arjun,meera,vikram,ishita,kabir,naina}.ts` | [README.md § Professional avatars](README.md#professional-avatars) |

**The state list has exactly one copy: `STATES` in `packages/avatar/src/avatar.js`,** with each
entry's perceptual reasoning in the comment above it. A prose table of states in
a doc is the shape that rots — the last one advertised a `TYPING` state for
weeks after it was renamed `WORKING`. `npm test` now fails if a doc puts any
SCREAMING_CASE name in backticks that the code does not define
(`packages/avatar/test/docs.test.ts`); the research pages are exempt, because naming
things the code does not have is their job.

Repo layout: [design-library-split.md § Layout](docs/design-library-split.md).
Design narrative: [README.md § Design](README.md). Motion constants cite
[research-biomechanics.md](docs/research-biomechanics.md) (how it moves) and
[research-perception.md](docs/research-perception.md) (how it is *read*) in a
comment where they are derived from one.

**The public surface is `createAvatar({mount, client}) -> {destroy()}` and a
zero-argument `AvatarProcessor()`.** The avatar is an embodiment of
`PipecatClient`; there is no avatar state beyond what `PipecatClient` exposes
and the caller does not get to read it. You add an avatar by publishing a module
that exports `createAvatar` — no registry, no loader
([design-avatar-interface.md](docs/design-avatar-interface.md)). One optional
export sits beside it and only because the wire's action id is open: `supports`,
a declaration of what this face answers to, read by a page that *drives* an
avatar and by nothing in the library. A new prop,
option or wire command needs a real consumer asking, not a plausible one. The
backend extension seams are `AvatarControlFrame` and subclassing
`AvatarStateMachine`.

## Constraints

Non-obvious, and recorded nowhere else.

- **The client never decides what the agent is doing.** No client-side
  intelligence about call content. A state the server sends is a *candidate*;
  observed playout wins. A Live2D-style client clip-priority mechanism was rejected
  outright for this reason — it would let the client refuse a server command.
- **Lipsync is the headline feature.** The brief ranked it *"most importantly"*;
  anything that degrades its fidelity or timing is a regression even if it
  improves something else.
- **Backchannels matter more than long-form speech.** Interjections — *okay,
  yes, one moment, sure, sorry, go on* — were called out as *"more important to
  get right, because they give feedback in real time,"* and the avatar listens far
  more than it speaks. Spend effort accordingly. They must also read
  convincingly with no audio at all (baked default timings; real clips attach
  later).
- **The voice is part of the character, and a mismatch outranks every animation
  defect.** The library never chooses a TTS — but anything that *demonstrates*
  the library does, and a face read as one gender speaking in another is the
  first thing anyone notices, before a single nod is judged. So `apps/server/`'s
  corpus is recorded once per voice from vql-speech itself — one `omnivoice/*`
  id per row, covering both the committed WAVs and the live stream, so the run
  everybody makes first is not demonstrating a voice nobody ships — and the
  picker sits before the call because a TTS opens its context with a voice id
  ([apps/server/README.md § Two voices](apps/server/README.md)).
- **Autonomy is contingent, never decorative.** The renderer must never invent
  an acknowledgement — every nod, receipt and empathy beat is an explicit
  `action`.
- **No arms.** A full forearm/hand chain was removed 2026-08-05 on sight
  (*"I would rather not add all the complexity for a 1% use case"*). The door is
  ajar — *"that was just how we implemented it"* — but do not re-add without
  asking. `packages/avatar/src/hand.js` clears the constraint by being the other design: no
  forearm, no parameter channel, no per-face geometry, one drawing placed from
  the rig window. **A channel only one avatar can render is the shape of the
  mistake**, whatever the body part.
- **`peep` is `DEFAULT_FACE` and the rig to author against;** confirm on the
  others, don't chase parity. The avatars are separate drawings, not renderings
  of one drawing — a fix that reads on one often means nothing on another.
  Corollary: **a minimal line face swallows small deltas.** Peep's ink moves
  whole units or not at all, and its resting mouth is drawn smiling — so "not
  smiling" must be authored clearly negative, and concentration must be
  brows-*down*.
- **`peep` has no dark mode, and that was decided** (*"Inverted looks horrible.
  Don't even try to fix it."*). Theme *keys* stay, there is no second palette,
  and it cannot be fixed as a colour change: inverting a two-value line drawing
  turns the black hair white, which ages the character a decade — geometry
  wearing a palette's clothes. No barrel `THEME` export; `api.theme` is the
  mounted one.
- **Idle motion stays low-amplitude and low-frequency.** Screen share and the
  user's camera are both on; a jittery avatar costs the encoder real bitrate for
  no communicative gain, and deliberate stillness is both a cue and a saving.
  Keep gesture oscillation under ~1.5 Hz — above it a nod reads as impatience
  rather than attention. The frame-edge hand is exempt: 2.8–3.0 Hz is the social
  wave band and the bottom of it reads as tired.
- **Clip keyframes are not what the face does — the smoothing between them is.**
  Nod peaks are authored pre-compensated for the head's 160 ms τ, and channels
  with differing τ are already phase-shifted relative to each other for free.
  Author a deliberate lead or lag *on top of* what the mixer already supplies,
  not from zero. The arithmetic and the worked numbers are in
  [internal-mixer.md § Smoothing](docs/internal-mixer.md) — one copy.
- **`packages/avatar/src/` has no build step, and that is a constraint, not a convenience.**
  Dependency-free ES modules — what you screenshot is what ships.
  `packages/avatar/client/` is compiled with plain `tsc` and nothing in
  `packages/avatar/src/` may depend on it. A change that makes the widget need a
  build has broken the shape of the project even if it works.
- **Do not duplicate the backend.** When a consumer must signal something the
  library cannot infer: write your own `FrameProcessor`, or subclass
  `AvatarStateMachine` and translate in `on_frame`. YAGNI until a third strong
  use case argues otherwise.
- **Comments explain the perceptual *why*, not the mechanics.** The non-obvious
  reasons (blinks are asymmetric, the head under-rotates, `CANT_HEAR`'s brows go
  *down*) are the actual value in this code and are easy to "clean up" by
  accident.

## Running the demo call

```sh
pm2 start ecosystem.config.cjs
```

Starts `apps/server/` — the pipecat demo call, and the only surface here. Its
port is declared in that file and passed on the command line; no config names
one. On the maintainer's machine a local nginx fronts it at
`avatar-server.local.voqalize.com`.

It also runs standalone exactly as [its README](apps/server/README.md) describes
— a contributor without pm2 or that nginx loses nothing, which is the point of
it being the surface that stayed public.

## Verifying

The rig is judged by eye; the packages are judged by test.

```
pnpm test                 # the client, the package boundary, and the rig conformance sweep
                          # (`packages/avatar/src/conformance.js`)
cd packages/avatar-py && uv run pytest     # backend, against the real avatarsync library
cd apps/server && uv run --project ../../packages/avatar-py --group server --group dev python -m pytest
cd packages/avatar-py && uv run --group server python ../../apps/server/server.py   # a real call
```

`pnpm test` runs here as well as in the working tree, and is the gate the
export tool proves a release against before its commit exists — so a Python
change that breaks a JavaScript test is caught here, in CI, and nowhere else.

Two things no suite will tell you:

- **Lipsync is only ever verified in [`apps/server/`](apps/server/README.md)**
  — a real call, your microphone, live TTS, `AvatarProcessor()` seated between
  the TTS and the transport. The two constraints that matter are the ones only
  ears catch: that the mouth moves the instant audio starts, and that the
  accurate leg's arrival is not visible as a jump. A backend change that touches
  either viseme leg is not done until someone has held a conversation with it.
- **The conformance sweep passing is not evidence a change is good.** It
  catches dead avatars, NaN leaks and detached SVGs, nothing about how the face
  *looks*.
  Every defect this project has found was found by looking: a `G`/`B` viseme
  collision invisible without a mouth crop, a compound state that read as
  *asleep* rather than busy, screenshot flukes that were mid-blink frames.
  Param-gate your sampling.

## In flight

- **The rig contract is new; the SVG faces are still behind an adapter.**
  `createSvgRig` (`packages/avatar/src/rig.js`) is the migration shim. There is no second
  renderer, deliberately: the one that existed implemented the rig contract
  instead of the wire and is why that page now opens with a warning box.
- **[`apps/server/`](apps/server/README.md) answers one question — *does it work
  in a real call?*** One pipecat process, canned LLM and TTS behind the real
  pipecat interfaces, **zero API keys**, and the only place lipsync is ever
  judged. It is not a product surface and it is not a test harness: a control
  that would only ever be used by us belongs in the working tree's review
  environment, which is where the two surfaces that used to live here went.
- **The vocabulary is the nine core states, everywhere above the mixer.** The
  render-state pass-throughs (`TYPING_CHAT`, `WANTS_IN`, …) are gone from
  `packages/avatar/src/behavior.js`; they are still real states *in* `packages/avatar/src/avatar.js`, reached
  with `avatar.setState`, which is whose state it is. Only the `TYPING` alias
  was deleted outright. **All nine map 1:1 to a render state, and the two-column
  table is gone with the one row that did not.** `STRAINING` drew as `CANT_HEAR`
  until the wire redesign renamed the state to the situation rather than the
  effort a pose depicts; `BEHAVIOR_STATE_IDS` is a flat list now, and a renderer
  that wants to draw one of the nine as something else calls `avatar.setState`.
  The old spelling is still accepted at the client's parse boundary and nowhere
  above it.
- **Everything below `SPEAKING`/`LISTENING` is inference, and the reasoning is
  written down once.** A face that goes blank while a model is mid-inference
  reads as *disconnected*, so `IDLE` is the wrong answer to almost all of the
  silence in a call. Which latch is armed by which frame, why `WORKING` sits
  under `THINKING` without being masked by it, why `CANT_HEAR` needs a clock,
  and the one heuristic that is deliberately unimplemented (the held-open turn —
  the JS client exposes no VAD event, so the candidate could never win):
  [pipecat-lifecycle-protocol.md § The silence problem](docs/pipecat-lifecycle-protocol.md).
  `MUTED` is not the server's to send at all — pipecat's own mute events reach
  the browser, and that is the authority model working as designed.
- **Animation quality is the open avatar work.** `myna` is stakeholder-approved
  as a *static* character (2026-08-07); an animation expert found the motion not
  up to the mark. From the graded 2026-08 review: adopted ballistic head-follow
  braking and smile-corner decay during speech; deferred the turn-morph
  experiment (PR #1) and viseme salience ordering, with reasons on record.
- **A boundary the library reads from pipecat has two spellings, and reading
  only one was a real defect.** A 3.4 s utterance put ~171 `cues` chunks on the
  wire, every one `from_ms: 0` — the accurate leg republishing the whole turn
  ~50×/s instead of splicing at the current sentence. The cause was not the
  splice logic: `AvatarProcessor` counted a sentence complete only from
  `AggregatedTextProgressFrame`, which pipecat emits from the *karaoke* path
  alone. A TTS with no word timestamps — most of them — says the same thing with
  one whole-sentence `TTSTextFrame`, and that went unread, so the splice point
  never left zero. Fixed; the cost is quadratic in the turn and the mouth looks
  right either way, which is why only counting the wire found it. `apps/server/`'s
  canned TTS can now be either shape (`word_timings=`, pipecat's
  `push_text_frames` inverted) and `apps/server/test_canned.py` seats the avatar
  behind both — the branch that regressed is the one with no second signal to
  fall back on, so it is also what every unrelated test there runs against.
- **New avatars follow the staged process** in
  [authoring-a-face.md § Adding a new avatar](docs/authoring-a-face.md) — the
  stakeholder's reference image is the identity spec, then production
  calibration at 130 px retires it as the yardstick. The evidence is one day
  apart: `koel`, authored from a text brief, passed every rig check and was
  rejected on sight; `myna`, authored reference-first, was approved.
- **The three 2.5-D characters are compiled binaries, and that is the whole of
  them here.** `packages/avatar/assets/*.glb` is a build output of a pipeline
  that is not published; the renderer that loads one is
  `packages/avatar/client/three/`, reached as `@voqalize/avatar/avatars/<name>`
  and `@voqalize/avatar/internal/three`. There is no source for the artwork in
  this repository and there is not meant to be — which is also why assets take
  no contributions ([CONTRIBUTING.md](CONTRIBUTING.md)). What a consumer needs:
  [characters.md](docs/characters.md).
- **A character is a photograph on shallow geometry, and one rule of that
  survives into the renderer: the albedo may not carry anything that has to
  appear or disappear.** Sclera, teeth and the lip line are geometry for that
  reason, and a rig channel that tried to fade one of them in would be fighting
  the asset rather than driving it. The characters are driven by the *mixer*,
  not the wire: their morph targets are authored under the 30 pose-channel names
  in `packages/avatar/src/params.js`, so `tara.ts` is
  `createAvatar({ rig: createTaraRig })` and every clip, blink and
  co-articulation rule the SVG faces have works unmodified.
- **Speech head motion holds a pose per phrase and moves between them**
  (`packages/avatar/src/head.js`, [internal-mixer.md](docs/internal-mixer.md)).
  The previous design summed envelopes, which gives the right spread and the
  wrong *shape*: it matched a published per-sentence deviation statistic at 100%
  and was read in a live call as not moving like a human at all. The statistic
  is advisory; watching a recording is the gate.
- **An avatar can publish motions the wire has no portable word for**, under
  the same `cmd: "action"` whose id is open
  ([contract-wire.md](docs/contract-wire.md) § Action). It can only add — a
  required id wins a name collision — and an unknown id is ignored, which is the
  forward-compat rule reached from the other direction: a face that cannot do
  the thing is as expected as a newer server. The first table is the 2.5-D
  characters' three research-shaped nod types and a head shake
  (`packages/avatar/client/three/sequences.ts`), which are three things to say where
  `ACKNOWLEDGE` is one.
