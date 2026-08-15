# Avatar Studio

The IDE for `createAvatar` — the published options, turned against a live call,
with the wire that drove it decoded beside them.

```sh
pnpm install                                  # once, from the repository root
cd py && uv run --group server python ../server/server.py   # in another terminal
pnpm run studio:dev
open http://127.0.0.1:4173/                   # AVATAR_STUDIO_PORT overrides
```

Both halves are needed. Studio is a page, not a bot: without `server/` running
there is nothing to call, and the Start-call button will say so.
(`pm2 start ecosystem.config.cjs` runs the dev server supervised.)

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

Studio also does not compose wire messages. Every control on the Wire route is
an HTTP request to `server/`, which then sends the message — a page that could
make the avatar nod on its own would be a client deciding what the agent is
doing, which is the one thing CLAUDE.md says the client never does.

## The two routes

| route | who it is for | what it validates |
|---|---|---|
| `#/` | product developer | the option surface — face, the three gains, the hand and its side — against a live `SmallWebRTCTransport` call. **Compare mode** mounts all three faces on one `PipecatClient`, which is the only way to judge separate drawings on identical input, and the proof that an avatar is an embodiment of a client rather than an owner of one |
| `#/wire` | client/backend integrator | [contract-wire.md](../docs/contract-wire.md) — every `claim`, `action` and `cues` chunk the server sends, in order, beside controls that make the server send them. Including the misbehaviours: a claim that contradicts playout, an action storm, a cue burst out of order |

The call is owned above the routes, so switching between them does not hang up.

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
