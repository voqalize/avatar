# Avatar

A renderer-agnostic behavior library that makes a 2-D talking head read as
*present* in an AI voice call. **Pipecat owns facts, the server owns intent, the
rig only renders** — that precedence is the design
([pipecat-lifecycle-protocol.md § Authority model](docs/pipecat-lifecycle-protocol.md)).

Library, not product; two live consumers, both pipecat voice agents. Public at
`voqalize/avatar` under AGPL-3.0-only — **everything committed here is public**.
`@voqalize/avatar` (npm) and `voqalize-avatar` (PyPI) are two ends of one wire
format and publish in lockstep from one `v<semver>` tag ([RELEASING.md](RELEASING.md)).
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
mistake has already been made once ([removed.md § The Rive proof](docs/removed.md)).

| layer | owns | code | reference |
|---|---|---|---|
| **wire** | `claim` / `action` / `cues`, nothing else | `client/src/AvatarClient.ts` | **[contract-wire.md](docs/contract-wire.md)** |
| **avatar** | `createAvatar({mount, client}) -> {destroy()}` — the only public seam | `client/src/createAvatar.ts` | **[design-avatar-interface.md](docs/design-avatar-interface.md)** |
| lifecycle | effective-state precedence, cue-clock anchor, FIFO ctx bind — **the one copy of the precedence ladder** | `client/src/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| behavior | states, actions, wire→library mapping | `src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| backend | state inference from stock frames, the viseme legs | `py/src/voqalize_avatar/` | [py/README.md](py/README.md) |
| mixer | layer order, per-channel smoothing, gaze, idle, clips — **the driving API, `/internal`, no semver promise** | `src/avatar.js` | [internal-mixer.md](docs/internal-mixer.md) |
| rig | `apply({pose, hand})` / `destroy()`, the 30 pose channels — **internal to the SVG renderer, not a seam to implement** | `src/rig.js` | [internal-rig.md](docs/internal-rig.md) |
| SVG faces | the drawings; `createFace` / `META`, exported as a `{create, meta}` value per module — never resolved by name | `src/face-*.js`, `line-art.js`, `src/faces.js` (tooling only) | [authoring-a-face.md](docs/authoring-a-face.md) |

**The state list has exactly one copy: `STATES` in `src/avatar.js`,** with each
entry's perceptual reasoning in the comment above it. A prose table of states in
a doc is the shape that rots — the last one advertised a `TYPING` state for
weeks after it was renamed `WORKING`. `npm test` now fails if a doc puts any
SCREAMING_CASE name in backticks that the code does not define
(`client/test/docs.test.ts`); `docs/removed.md` and the research pages are
exempt, because naming things the code does not have is their job.

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
([design-avatar-interface.md](docs/design-avatar-interface.md)). A new prop,
option or wire command needs a real consumer asking, not a plausible one. The
backend extension seams are `AvatarControlFrame` and subclassing
`AvatarStateMachine`. Everything 0.2 cut, and how to recover it
from `v0.1.0`: [docs/removed.md](docs/removed.md) — **read it before re-adding a
knob**; most entries also say what to do instead.

## Constraints

Non-obvious, and recorded nowhere else.

- **The client never decides what the agent is doing.** No client-side
  intelligence about call content. Server claims are *candidates*; observed
  playout wins. A Live2D-style client clip-priority mechanism was rejected
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
- **Autonomy is contingent, never decorative.** The renderer must never invent
  an acknowledgement — every nod, receipt and empathy beat is an explicit
  `action`.
- **No arms.** A full forearm/hand chain was removed 2026-08-05 on sight
  (*"I would rather not add all the complexity for a 1% use case"*). The door is
  ajar — *"that was just how we implemented it"* — but do not re-add without
  asking. `src/hand.js` clears the constraint by being the other design: no
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
- **`src/` has no build step, and that is a constraint, not a convenience.**
  Dependency-free ES modules — what you screenshot is what ships. `client/`
  (tsc) and `studio/` (vite) are compiled; nothing in `src/` may depend on
  either. A change that makes the widget need a build has broken the shape of
  the project even if it works.
- **Do not duplicate the backend.** When a consumer must signal something the
  library cannot infer: write your own `FrameProcessor`, or subclass
  `AvatarStateMachine` and translate in `on_frame`. YAGNI until a third strong
  use case argues otherwise.
- **Comments explain the perceptual *why*, not the mechanics.** The non-obvious
  reasons (blinks are asymmetric, the head under-rotates, `CANT_HEAR`'s brows go
  *down*) are the actual value in this code and are easy to "clean up" by
  accident.

## Verifying

The rig is judged by eye; the packages are judged by test.

```
pnpm test                 # client/, package boundary, and the rig conformance sweep
                          # (`src/conformance.js`) — run before committing src/
pnpm run studio:dev       # Avatar Studio — the review environment
cd py && uv run pytest     # backend, against the real avatarsync library
cd server && uv run --project ../py --group server --group dev python -m pytest
cd py && uv run --group server python ../server/server.py   # a real call
```

Headless render/screenshot/diff/motion tooling: [authoring/tools/README.md](authoring/tools/README.md).
Which Studio route validates which layer: [studio/README.md](studio/README.md).

Three things no suite will tell you:

- **Lipsync is only ever verified in [`server/`](server/README.md)**
  — a real call, your microphone, live TTS, `AvatarProcessor()` seated between
  the TTS and the transport. `authoring/lipsync-review.html` plays *baked* cue
  tracks, so it shows what a leg's cues look like and not how the two legs
  interleave, latch or rewrite under a real generator. Studio joins the same
  real call, so the legs are live there too — but Studio is an option surface,
  and the two constraints that matter are the ones only ears catch: that the
  mouth moves the instant audio starts, and that the accurate leg's arrival is
  not visible as a jump.

- **Serve with `python3 authoring/serve.py 8777`, never `python3 -m
  http.server`.** The stdlib server sends `Last-Modified` and no `Cache-Control`, so browsers apply
  heuristic freshness and stop revalidating modules you have edited. That has
  cost three debugging sessions, one of which produced a module error that was
  simply a lie. Do not work around it with `?v=` either — that puts two copies
  of the module in the graph and fails differently and worse.
- **The conformance sweep passing is not evidence a change is good.** It
  catches dead avatars, NaN leaks and detached SVGs, nothing about how the face
  *looks*.
  Every defect this project has found was found by looking: a `G`/`B` viseme
  collision invisible without a mouth crop, a compound state that read as
  *asleep* rather than busy, screenshot flukes that were mid-blink frames.
  Param-gate your sampling.

## In flight

- **The rig contract is new; the SVG faces are still behind an adapter.**
  `createSvgRig` (`src/rig.js`) is the migration shim. There is no second
  renderer, deliberately: the one that existed implemented the rig contract
  instead of the wire and is why that page now opens with a warning box
  ([removed.md § The Rive proof](docs/removed.md)).
- **There are exactly three non-published surfaces, and each answers one
  question.** [`server/`](server/README.md) — *does it work in a real call?* One
  pipecat process, canned LLM and TTS behind the real pipecat interfaces, **zero
  API keys**, and the only place lipsync is ever judged.
  [`studio/`](studio/README.md) — *is the published interface enough?* The IDE,
  pointed at that same server. [`authoring/`](authoring/README.md) — *does the
  drawing read?* The workshop: rig pages, clip fixtures, headless tools, no
  build step. A thing that belongs in one of them and lands in another is how
  this repo grew three answers to "show me the avatar"
  ([removed.md § Removed in 0.3 — the demo surfaces](docs/removed.md)).
- **Studio is not a rig workbench, and no longer pretends to be.** It imports
  `@voqalize/avatar` and nothing else from this repo — no `src/`, no
  `/internal` — so a thing it cannot do is a thing a consumer cannot do. Its
  two routes drive a real `SmallWebRTCTransport` call against `server/`; there
  is no fake clock, no trace fixture and no demo-only state machine anywhere in
  it, and it does not compose wire messages — every control on `#/wire` asks
  the *server* to send one.
- **The vocabulary is the seven core states, everywhere above the mixer.** The
  render-state pass-throughs (`TYPING_CHAT`, `CANT_HEAR`, `WANTS_IN`, …) are
  gone from `src/behavior.js`; they are still real states *in* `src/avatar.js`,
  reached with `avatar.setState`, which is whose state it is. Only the `TYPING`
  alias was deleted outright ([removed.md](docs/removed.md) § The
  behavior-state aliases).
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
  right either way, which is why only counting the wire found it. `server/`'s
  canned TTS can now be either shape (`word_timings=`, pipecat's
  `push_text_frames` inverted) and `server/test_canned.py` seats the avatar
  behind both — the branch that regressed is the one with no second signal to
  fall back on, so it is also what every unrelated test there runs against.
- **New avatars follow the staged process** in
  [authoring-a-face.md § Adding a new avatar](docs/authoring-a-face.md) — the
  stakeholder's reference image is the identity spec, then production
  calibration at 130 px retires it as the yardstick. The evidence is one day
  apart: `koel`, authored from a text brief, passed every rig check and was
  rejected on sight; `myna`, authored reference-first, was approved.
