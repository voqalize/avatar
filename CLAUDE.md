# Avatar

A renderer-agnostic behavior library that makes a 2-D talking head read as
*present* in an AI voice call. **Pipecat owns facts, the server owns intent, the
rig only renders** — that precedence is the design
([pipecat-lifecycle-protocol.md § Authority model](docs/pipecat-lifecycle-protocol.md)).
What it is and how a consumer uses it: [README.md](README.md).

> **This is the release path, and only part of it is editable here.**
> `packages/avatar/` and `docs/` are a **build output**: they are developed in a
> private working tree and arrive as one synthesised commit per release,
> carrying an `Exported-From:` trailer naming the private revision. Editing them
> here is editing a build output — the next export overwrites it, silently, and
> no test catches that. A JavaScript or documentation fix is made in the working
> tree and lands with the next release.
>
> `packages/avatar-py/`, `apps/server/`, `.github/`, the root manifests and
> `CONTRIBUTING.md` are this repository's own; no export writes them, and
> `scope.yml` fails a pull request that reaches outside that set. **That is the
> whole of what a change here can be.** Why the fork exists at all —
> the Blender pipeline that compiles a 2.5-D character is the part we are not
> publishing — is [CONTRIBUTING.md](CONTRIBUTING.md); how a release is cut is
> [RELEASING.md](RELEASING.md). If your checkout has a `packages/avatar-3d/`,
> you are in the working tree and none of this applies to you.

Library, not product; two live consumers, both pipecat voice agents. MIT, with
the character binaries under CC-BY 4.0 — **everything committed here is
public**. `@voqalize/avatar` (npm) and `voqalize-avatar` (PyPI) are two ends of
one wire format and release independently: the wire keeps them compatible, not a
shared version.

Both are reframings of a narrower original brief — a talking head for one AI
voice interviewer — and the requester's words are the authority if either
reopens: *"This is an avatar for online AI based calls. The avatar can take
multiple roles, and can be named different things"* (2026-08-05), so the code and
every enum are role-neutral and the human is the *user*, never the candidate;
*"there are now two users for this library and so it is a good time to abstract
things out better"* (2026-08-07), which is why there is a split at all
([design-library-split.md](docs/design-library-split.md)).

## The seams

Each row is a boundary that holds. If a thing is implemented behind one of
these, link to it — do not re-explain it here. **Only the first two rows are
contracts** — a format someone outside this repo implements or depends on.
Everything below the rule is our own internals and is named `internal-*` so a
future renderer does not plug into the wrong one; that mistake has already been
made once. And every row but `backend` is exported: read it, do not edit it.

| layer | owns | code | reference |
|---|---|---|---|
| **wire** | `state` / `action` / `cues`, nothing else | `packages/avatar/client/AvatarClient.ts` | **[contract-wire.md](docs/contract-wire.md)** |
| **avatar** | `createAvatar({mount, client}) -> {destroy()}` — the only public seam | `packages/avatar/client/createAvatar.ts` | **[design-avatar-interface.md](docs/design-avatar-interface.md)** |
| lifecycle | effective-state precedence, cue-clock anchor, FIFO ctx bind — **the one copy of the precedence ladder** | `packages/avatar/client/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions, wire→library mapping | `packages/avatar/src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| backend | state inference from stock frames, the viseme legs | `packages/avatar-py/src/voqalize_avatar/` | [packages/avatar-py/README.md](packages/avatar-py/README.md) |
| mixer | layer order, per-channel smoothing, gaze, idle, clips — **the driving API, `/internal`, no semver promise** | `packages/avatar/src/avatar.js` | [internal-mixer.md](docs/internal-mixer.md) |
| rig | `apply({pose, hand})` / `destroy()`, the 30 pose channels — **internal to the SVG renderer, not a seam to implement** | `packages/avatar/src/rig.js` | [internal-rig.md](docs/internal-rig.md) |
| SVG faces | the drawings; `createFace` / `META`, exported as a `{create, meta}` value per module — never resolved by name | `packages/avatar/src/face-*.js`, `line-art.js` | [authoring-a-face.md](docs/authoring-a-face.md) |
| Canvas2D avatars | the six professional identities, each a complete `createAvatar` module — an internal renderer; its rig JSON and wardrobe images ship but are not a seam | `packages/avatar/src/canvas/`, `packages/avatar/client/{arjun,meera,vikram,ishita,kabir,naina}.ts` | [README.md § Professional avatars](README.md#professional-avatars) |
| 2.5-D characters | `tara`, `tushar`, `tanya` — one `createAvatar` each over one shared rig; `three` is an *optional* peer, so a drawing never pays for a 3-D engine | `packages/avatar/client/three/`, `packages/avatar/assets/*.glb` | [characters.md](docs/characters.md) |

**The state list has exactly one copy: `STATES` in
`packages/avatar/src/avatar.js`,** with each entry's perceptual reasoning in the
comment above it. A prose table of states in a doc is the shape that rots — the
last one advertised a `TYPING` state for weeks after it was renamed `WORKING`,
so `pnpm test` now fails if a doc puts any SCREAMING_CASE name in backticks that
the code does not define (`packages/avatar/test/docs.test.ts`); the research
pages are exempt, because naming things the code does not have is their job.
Above the mixer the vocabulary is the nine core states — `STRAINING` is accepted
at the client's parse boundary and nowhere above it.

**The public surface is `createAvatar({mount, client}) -> {destroy()}` and a
zero-argument `AvatarProcessor()`.** The avatar is an embodiment of
`PipecatClient`; there is no avatar state beyond what `PipecatClient` exposes
and the caller does not get to read it. You add an avatar by publishing a module
that exports `createAvatar` — no registry, no loader
([design-avatar-interface.md](docs/design-avatar-interface.md)). A new option or
wire command needs a real consumer asking, not a plausible one. The backend
extension seams are `AvatarControlFrame` and subclassing `AvatarStateMachine`.

**The three 2.5-D characters are compiled binaries, and that is the whole of
them here.** `packages/avatar/assets/*.glb` is the output of the pipeline that
is not published; the renderer that loads one is
`packages/avatar/client/three/`. There is no source for the artwork in this
repository and there is not meant to be — which is also why assets take no
contributions. They are driven by the *mixer*, not the wire: their morph targets
are authored under the 30 pose-channel names in
`packages/avatar/src/params.js`, so every clip, blink and co-articulation rule
the SVG faces have works on them unmodified.

## Constraints

Non-obvious, and recorded nowhere else. These bind the work that happens *here*
— the behaviour rules the drawings are held to live with the drawings, in the
working tree.

- **The client never decides what the agent is doing.** No client-side
  intelligence about call content. A state the server sends is a *candidate*;
  observed playout wins. A Live2D-style client clip-priority mechanism was
  rejected outright for this reason — it would let the client refuse a server
  command.
- **Lipsync is the headline feature.** The brief ranked it *"most importantly"*;
  anything that degrades its fidelity or timing is a regression even if it
  improves something else.
- **Backchannels matter more than long-form speech.** Interjections — *okay,
  yes, one moment, sure, sorry, go on* — were called out as *"more important to
  get right, because they give feedback in real time,"* and the avatar listens
  far more than it speaks. Spend effort accordingly.
- **Autonomy is contingent, never decorative.** The renderer must never invent
  an acknowledgement — every nod, receipt and empathy beat is an explicit
  `action`, and an avatar may answer to ids the wire has no portable word for
  ([contract-wire.md § Action](docs/contract-wire.md)): an unknown id is ignored,
  so a face that cannot do the thing is as expected as a newer server.
- **Everything below `SPEAKING`/`LISTENING` is inference.** A face that goes
  blank while a model is mid-inference reads as *disconnected*, so `IDLE` is the
  wrong answer to almost all of the silence in a call. Which latch is armed by
  which frame, why `WORKING` sits under `THINKING` without being masked by it,
  why `CANT_HEAR` needs a clock, and the one heuristic that is deliberately
  unimplemented (the held-open turn — the JS client exposes no VAD event, so the
  candidate could never win):
  [pipecat-lifecycle-protocol.md § The silence problem](docs/pipecat-lifecycle-protocol.md).
  `MUTED` is not the server's to send at all — pipecat's own mute events reach
  the browser, and that is the authority model working as designed.
- **The voice is part of the character, and a mismatch outranks every animation
  defect.** The library never chooses a TTS — but anything that *demonstrates*
  the library does, and a face read as one gender speaking in another is the
  first thing anyone notices, before a single nod is judged. So `apps/server/`'s
  corpus is recorded once per voice from vql-speech itself, and the picker sits
  before the call because a TTS opens its context with a voice id
  ([apps/server/README.md § Two voices](apps/server/README.md)).
- **Do not duplicate the backend.** When a consumer must signal something the
  library cannot infer: write your own `FrameProcessor`, or subclass
  `AvatarStateMachine` and translate in `on_frame`. YAGNI until a third strong
  use case argues otherwise.
- **Comments explain the perceptual *why*, not the mechanics.** The non-obvious
  reasons (blinks are asymmetric, the head under-rotates, `CANT_HEAR`'s brows go
  *down*, why a sentence boundary has two spellings) are the actual value in this
  code and are easy to "clean up" by accident.

## Running and verifying

```sh
pm2 start ecosystem.config.cjs     # apps/server/, the one local surface here
```

`apps/server/` is the pipecat demo call and answers one question — *does it work
in a real call?* One pipecat process, canned LLM and TTS behind the real pipecat
interfaces, **zero API keys**. It is here rather than in the working tree
because a demo call with no keys in it is the first thing a consumer runs. It
also runs standalone exactly as [its README](apps/server/README.md) describes;
its port is declared in `ecosystem.config.cjs` and nowhere else.

```sh
pnpm test                                                    # client, package boundary, conformance sweep
cd packages/avatar-py && uv run pytest                       # backend, against the real avatarsync library
cd apps/server && uv run --project ../../packages/avatar-py --group server --group dev python -m pytest
cd packages/avatar-py && uv run --group server python ../../apps/server/server.py   # a real call
```

`pnpm test` runs here as well as in the working tree, and is the gate the export
tool proves a release against before its commit exists — so a Python change that
breaks a JavaScript test is caught here and nowhere else.

Two things no suite will tell you:

- **Lipsync is only ever verified in [`apps/server/`](apps/server/README.md)** —
  a real call, your microphone, live TTS, `AvatarProcessor()` seated between the
  TTS and the transport. The two constraints that matter are the ones only ears
  catch: that the mouth moves the instant audio starts, and that the accurate
  leg's arrival is not visible as a jump. A backend change that touches either
  viseme leg is not done until someone has held a conversation with it.
- **The conformance sweep passing is not evidence a change is good.** It catches
  dead avatars, NaN leaks and detached SVGs, nothing about how the face *looks*.
  Every defect this project has found was found by looking: a `G`/`B` viseme
  collision invisible without a mouth crop, a compound state that read as
  *asleep* rather than busy, screenshot flukes that were mid-blink frames. The
  tooling for that is in the working tree, which is also where a fix to what it
  finds has to go.
