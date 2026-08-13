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

| layer | owns | code | contract |
|---|---|---|---|
| wire | `claim` / `action` / `cues`, nothing else | `client/src/AvatarClient.ts` | [contract-wire.md](docs/contract-wire.md) |
| lifecycle | effective-state precedence, cue-clock anchor, FIFO ctx bind | `client/src/AvatarClient.ts` | [pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md) |
| avatar | `createAvatar({mount, client}) -> {destroy()}` — the only public seam | `client/src/createAvatar.ts` | [design-avatar-interface.md](docs/design-avatar-interface.md) |
| behavior | states, actions, wire→library mapping | `src/behavior.js` | [contract-behavior.md](docs/contract-behavior.md) |
| rig | `apply({pose, hand})` / `destroy()`, the 30 pose channels — **internal to the SVG renderer, not a seam to implement** | `src/rig.js` | [contract-rig.md](docs/contract-rig.md) |
| mixer | layer order, per-channel smoothing, gaze, idle, clips | `src/avatar.js` | [contract-protocol.md](docs/contract-protocol.md) |
| SVG faces | the drawings; `createFace` / `META`, exported as a `{create, meta}` value per module — never resolved by name | `src/face-*.js`, `line-art.js`, `src/faces.js` (tooling only) | [contract-avatar.md](docs/contract-avatar.md) |
| backend | state inference from stock frames, the viseme legs | `py/src/voqalize_avatar/` | [contract-protocol.md](docs/contract-protocol.md) |

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
  A channel chasing an oscillating target attenuates by `1/sqrt(1+(ω·τ)²)` and
  lags by `arctan(ω·τ)`. Nod peaks are authored pre-compensated for the head's
  160 ms τ (a rendered 0.30 is written ~0.55), and channels with differing τ are
  already phase-shifted relative to each other for free. Author a deliberate
  lead or lag *on top of* what the mixer already supplies, not from zero.
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
node tools/sweep.mjs      # rig conformance gate — run before committing src/
npm test                  # client/: dispatcher + jsdom package boundary
npm run studio:dev        # Avatar Studio — the review environment
cd py && uv run pytest     # backend, against the real avatarsync binary
```

Headless render/screenshot/diff/motion tooling: [tools/README.md](tools/README.md).
Which Studio route validates which contract:
[studio-verification.md](docs/studio-verification.md), [studio/README.md](studio/README.md).

Two things no suite will tell you:

- **Serve with `python3 serve.py 8777`, never `python3 -m http.server`.** The
  stdlib server sends `Last-Modified` and no `Cache-Control`, so browsers apply
  heuristic freshness and stop revalidating modules you have edited. That has
  cost three debugging sessions, one of which produced a module error that was
  simply a lie. Do not work around it with `?v=` either — that puts two copies
  of the module in the graph and fails differently and worse.
- **`sweep()` passing is not evidence a change is good.** It catches dead
  avatars, NaN leaks and detached SVGs, nothing about how the face *looks*.
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
- **Studio is absorbing the static rig pages.** `demo/rig/*` and `index.html`
  stay as reference tools until the matching Studio route reaches parity.
  Studio always drives production behavior and wire adapters — never a
  demo-only state machine.
- **The vocabulary is the seven core states, everywhere above the mixer.** The
  render-state pass-throughs (`TYPING`, `CANT_HEAR`, `WANTS_IN`, …) are gone
  from `src/behavior.js`; `CANT_HEAR` and friends are still real states *in*
  `src/avatar.js`, reached with `avatar.setState`, which is whose state it is.
- **Animation quality is the open avatar work.** `myna` is stakeholder-approved
  as a *static* character (2026-08-07); an animation expert found the motion not
  up to the mark. From the graded 2026-08 review: adopted ballistic head-follow
  braking and smile-corner decay during speech; deferred the turn-morph
  experiment (PR #1) and viseme salience ordering, with reasons on record.
- **New avatars follow the staged process** in
  [contract-avatar.md § Adding a new avatar](docs/contract-avatar.md) — the
  stakeholder's reference image is the identity spec, then production
  calibration at 130 px retires it as the yardstick. The evidence is one day
  apart: `koel`, authored from a text brief, passed every rig check and was
  rejected on sight; `myna`, authored reference-first, was approved.
