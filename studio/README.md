# Avatar Studio

Avatar Studio is the local review environment for avatar authors and library
developers. It is renderer-neutral: SVG is only the current built-in rig
implementation.

```sh
npm install
npm run dev
# or from the repository root
pm2 start ecosystem.config.cjs
```

Open <http://127.0.0.1:4173/#/rig>.

## The review model

Studio is arranged around the ownership boundary of each decision, not around
a grab-bag of runtime buttons:

1. **Rig** — raw controls only. Review pose extremes, individual visemes, and
   hand gesture clips without lifecycle or wire semantics.
2. **Behavior** — compose durable client states and finite actions, assuming
   the selected rig has passed review. An action is short and self-completing;
   a state remains until explicitly replaced.
3. **Runtime** — replay a deterministic factual Pipecat/server trace from
   time zero. The playhead reconstructs the avatar instead of mutating a
   long-lived test surface, so there are no compensating reset buttons.
4. **Connect** — attach a real, host-created Pipecat client to the same
   production `AvatarClient` binding.

Every workspace uses the same stable composition:

- **Library**: choose the thing under review.
- **Review canvas**: one deliberately sized avatar tile.
- **Inspector**: ownership, resolved state, and test context.
- **Timeline**: the output or input sequence being judged.

## Runtime traces and fixtures

Runtime’s stock traces cover a quiet listener, a normal reply, server-owned
working, and a response interruption. Selecting a trace or moving its
playhead reconstructs it from time zero. Quiet idle is therefore observable at
any playhead after its four-second quiet interval, not only after waiting in
real time.

The **Audio fixtures** collection is drawn from the checked-in WAV/cue pairs
in `demo/eval-clips.json`. Selecting a fixture creates an equivalent trace;
playing it drives the real cue/lifecycle path and plays its audio. This is the
shared articulation evidence for both rig and wire work.

## Real Pipecat connections

Studio intentionally does not turn a URL, token, or transport-specific
configuration into a Pipecat client. Stock Pipecat is transport-neutral; the
host/deployment creates the client and owns its credentials. Once constructed,
attach it in the browser:

```js
window.avatarStudio.attachPipecat(pipecatClient)
```

Studio binds the client’s standard factual lifecycle events plus `serverMessage`
to the production `AvatarClient`. To detach it:

```js
window.avatarStudio.detachPipecat()
```

Studio does not persist secrets. The narrow avatar wire envelope remains
documented in `../docs/contract-protocol.md`.
