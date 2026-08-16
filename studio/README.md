# Avatar Studio

The IDE for `createAvatar` — the published options, turned against a live call,
with the wire that drove it decoded beside them.

```sh
pnpm install                                  # once, from the repository root
cd py && uv run --group server python ../server/server.py   # in another terminal
pnpm -w run studio:dev                        # -w: it is a root script
open http://127.0.0.1:4173/                   # AVATAR_STUDIO_PORT overrides
```

Both halves are needed. Studio is a page, not a bot: without `server/` running
there is nothing to call, and the Connect button will say so.
`pm2 start ecosystem.config.cjs` runs both halves supervised, plus the
`authoring/` workshop on 8777 — three surfaces, one command, no terminal to
keep open.

## The rule

**Studio imports `@voqalize/avatar` and nothing else from this repo.** Not
`src/avatar.js`, not `client/src/AvatarClient.ts`, not `@voqalize/avatar/internal`
— it resolves the package through the workspace link and the real `exports`
map, exactly as an installed consumer would.

That is the whole design. If a thing cannot be done here, a consumer cannot do
it either, and the gap is a defect in the package rather than a missing Studio
feature. It is also why `pnpm run studio:build` runs in CI: it is the only job
that consumes the published entrypoint from outside.

Two consequences that read as limitations and are not:

- **There are no setters.** Every option is a remount, because the public
  surface is `createAvatar(options) -> { destroy() }` and has nothing else on
  it ([design-avatar-interface.md](../docs/design-avatar-interface.md)).
- **There is no state readout.** `createAvatar` returns no resolved state,
  deliberately, so an integration cannot come to depend on one. Studio shows
  what the *server sent*; what the face decided is a thing you judge by looking
  at the face.

Studio also does not compose wire messages. Every control that drives the avatar
is an HTTP request to `server/`, which then sends the message — a page that could
make the avatar nod on its own would be a client deciding what the agent is
doing, which is the one thing CLAUDE.md says the client never does.

## One screen, two modes

There is no navigation. The panel on the right changes with the connection,
because that is when the interesting question changes:

| when | the panel | what it validates |
|---|---|---|
| disconnected | **Build the avatar** — face, the three gains, the hand and its side | the option surface of `createAvatar`, which is yours to decide and nobody else's. **Compare mode** mounts all three faces on one `PipecatClient`: the only way to judge separate drawings on identical input, and the proof that an avatar is an embodiment of a client rather than an owner of one |
| in a call | **Drive the server** — pre-speech beats, interjections, misbehaviours | [contract-wire.md](../docs/contract-wire.md), from the sending end. The beats arm the next turn (`THINKING`, then `WORKING`, then speech); the interjections are one-shot `action`s; the misbehaviours are the ones the face is supposed to refuse — a claim that contradicts playout, an action storm, a claim that arrives too late |

Mode is read from the transport, once, in one place — `usePipecatClientTransportState()`
— so the button, the panel and every disabled control cannot disagree about
whether there is a call. Options stay changeable mid-call: Build collapses to a
line with a **Change** button rather than locking.

Two things span both modes. The **avatar wire** log is the evidence for either —
what the server sent, in order, decoded. The **transcript** appears with the call
and renders karaoke-style from the kit's `Conversation`: the spoken part of the
sentence in full ink, the rest muted, the boundary advancing with playout. That
is a real check on the server, not a decoration — it only tracks because
`CannedTTSService` puts word timings on the wire the way pipecat's protocol
requires (`add_word_timestamps`, `push_text_frames=False`).

The chrome comes from [`@pipecat-ai/voice-ui-kit`](https://github.com/pipecat-ai/voice-ui-kit)
— the same components a pipecat developer already has. Studio's own layout is
hand-written CSS on the kit's tokens: the kit ships its Tailwind bundle prebuilt
with only the utilities it uses, so there is no Tailwind build here and no
arbitrary utility classes that would silently do nothing.

`studio/src/wire.ts` is a **second implementation** of the wire reader, written
from [contract-wire.md](../docs/contract-wire.md) rather than imported from
`@voqalize/avatar/internal`. An integrator has the document, not our internals;
if the document is not enough to write the reader, that is a defect in the
document. It is also a reader rather than a validator — it keeps anything it
can name, because a message the face ignored is precisely what you came here to
see.

## What this is not

- **Not the 30-second look.** That is `server/index.html`
  ([server/README.md](../server/README.md)) — same call, same palette, no build
  step, no options.
- **Not a rig workbench.** Channel extremes, viseme close-ups, clip strips and
  the numeric conformance sweep are internals of the SVG renderer and live in
  `authoring/` ([authoring/tools/README.md](../authoring/tools/README.md)). Studio validates the
  contract; those validate the drawing.
- **Not where lipsync is judged.** Only a real call is
  ([CLAUDE.md § Verifying](../CLAUDE.md)), and this is one — but the two
  constraints that matter (the mouth moves the instant audio starts; the
  accurate leg's arrival is not visible as a jump) are caught by ears and eyes,
  not by anything on this page.
