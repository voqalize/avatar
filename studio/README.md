# Avatar Studio

A browser-based IDE for the avatars: see them in their various states, test an
avatar you are building, and connect to a live pipecat call to see how it all
works together. Renderer-neutral — SVG is only the current built-in rig.

```sh
npm install && npm --prefix studio install    # once
npm run studio:dev                            # from the repository root
open http://127.0.0.1:4173/#/rig              # AVATAR_STUDIO_PORT overrides
```

(`pm2 start ecosystem.config.cjs` runs the same thing supervised.)

## The review model

Four workspaces, arranged around who owns the decision under review rather than
around a grab-bag of runtime buttons. Which contract each one validates:
[studio-verification.md](../docs/studio-verification.md).

1. **Rig** — raw controls only. Pose extremes, individual visemes, hand gesture
   clips. No lifecycle, no wire semantics.
2. **Behavior** — durable states and finite actions, assuming the selected rig
   has passed Rig review.
3. **Runtime** — replay a deterministic factual pipecat/server trace from time
   zero. The playhead *reconstructs* the avatar rather than mutating a
   long-lived test surface, which is why there are no compensating reset
   buttons. Quiet idle is therefore observable at any playhead past its
   four-second interval, not only after waiting in real time.
4. **Connect** — attach a real, host-created pipecat client to the same
   production `AvatarClient` binding.

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
