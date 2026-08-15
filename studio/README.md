# Avatar Studio

A browser-based IDE for the avatars: see them in their various states, test an
avatar you are building, and connect to a live pipecat call to see how it all
works together. Renderer-neutral — SVG is only the current built-in rig.

```sh
pnpm install                                  # once, from the repository root
pnpm run studio:dev
open http://127.0.0.1:4173/#/rig              # AVATAR_STUDIO_PORT overrides
```

(`pm2 start ecosystem.config.cjs` runs the same thing supervised.)

## The review model

Four workspaces, arranged around who owns the decision under review rather than
around a grab-bag of runtime buttons. **Studio validates one layer at a time: a
control at a higher layer must not be mistaken for a requirement of a lower
one.**

| route | who it is for | what it validates |
|---|---|---|
| `#/rig` | avatar author | [internal-rig.md](../docs/internal-rig.md): rest and channel extremes, composites, every viseme at full-frame and close scale, curated transitions, hand gestures, numeric conformance. Raw controls only — no lifecycle, no wire semantics |
| `#/behavior` | behavior-library developer | [contract-behavior.md](../docs/contract-behavior.md): durable states and finite actions, and how they read across rigs. Assumes the selected rig has passed Rig review |
| `#/runtime` | client/backend integrator | [contract-wire.md](../docs/contract-wire.md) + [pipecat-lifecycle-protocol.md](../docs/pipecat-lifecycle-protocol.md): a deterministic trace replayed from time zero, plus the checked-in audio fixtures |
| `#/connection` | product developer | a real, host-created `PipecatClient` end to end |

Runtime's playhead *reconstructs* the avatar rather than mutating a long-lived
test surface, which is why there are no compensating reset buttons. Quiet idle
is therefore observable at any playhead past its four-second interval, not only
after waiting in real time.

Studio always drives the production behavior and wire adapters; it never
maintains a demo-only state machine. Legacy rig pages under `demo/rig/` remain
reference tools until the corresponding Studio route reaches parity.

Every workspace uses the same composition: **library** (pick the thing under
review), **review canvas** (one deliberately sized tile), **inspector**
(ownership, resolved state, test context), **timeline** (the sequence being
judged).

Runtime's stock traces cover a quiet listener, a normal reply, server-owned
working, and a response interruption. Its **audio fixtures** come from the
checked-in WAV/cue pairs in `demo/eval-clips.json`; selecting one builds an
equivalent trace and plays it through the real cue and lifecycle path. That is
the shared articulation evidence for both rig and wire work.

## Real pipecat connections

Studio deliberately does not turn a URL, token or transport config into a
pipecat client. Stock pipecat is transport-neutral; the host owns the client and
its credentials. Construct it yourself, then attach it in the browser:

```js
window.avatarStudio.attachPipecat(pipecatClient)
window.avatarStudio.detachPipecat()
```

Studio binds the client's standard factual lifecycle events plus `serverMessage`
to the production `AvatarClient`, and persists no secrets. The wire envelope is
[contract-wire.md](../docs/contract-wire.md).
