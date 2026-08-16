# Avatar Studio

The IDE for `createAvatar` — the published options, turned against a live call,
with the code you would paste written back to you as you change them.

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
  deliberately, so an integration cannot come to depend on one. The status line
  under the frame reads the *transport* — who is speaking, which is a pipecat
  fact — never the avatar. What the face decided is a thing you judge by
  looking at the face.

Studio also does not compose wire messages. Every control that drives the avatar
is an HTTP request to `server/`, which then sends the message — a page that could
make the avatar nod on its own would be a client deciding what the agent is
doing, which is the one thing CLAUDE.md says the client never does.

## One screen, two modes

There is no navigation. The avatar, its status, its captions and the Connect
button hold the left; the panel on the right changes with the connection,
because that is when the interesting question changes:

| when | the panel | what it validates |
|---|---|---|
| disconnected | **Your createAvatar call** — face, the three gains, the hand and its side, and the voice | the option surface of `createAvatar`, which is yours to decide and nobody else's. Every control rewrites a live snippet of the call you would paste, and at the defaults it writes `createAvatar({ mount, client })` and nothing more — which is the argument for the library in one screen |
| in a call | **Drive the server** — pre-speech beats, interjections, misbehaviours | [contract-wire.md](../docs/contract-wire.md), from the sending end. The beats arm the next turn (`THINKING`, then `WORKING`, then speech); the interjections are one-shot `action`s; the misbehaviours are the ones the face is supposed to refuse — a claim that contradicts playout, an action storm, a claim that arrives too late |

Mode is read from the transport, once, in one place — `usePipecatClientTransportState()`
— so the button, the panel and every disabled control cannot disagree about
whether there is a call. Options stay changeable mid-call: the build collapses
to a line with a **Change** button rather than locking.

The header carries the orientation, because a developer landing here cold has
two questions — what is this, and what do I do — and a screen of controls
answers neither. Three numbered steps, with the current one marked: build,
connect, drive.

**One avatar at a time.** A compare mode used to mount all three faces side by
side; it made the frame small enough that nothing in it could be judged, which
is the opposite of what a comparison is for. The faces are separate drawings
rather than renderings of one, so a difference between them is usually not the
finding it looks like ([removed.md](../docs/removed.md)).

The **voice** sits in the build panel but in a band of its own, because it is
not a `createAvatar` argument — it is which voice `server/` speaks in, and it
reaches the face only as audio ([server/README.md § Two voices](../server/README.md)).
It is there at all because the two have to agree: a voice that contradicts the
face is read as a mistake long before any animation defect is. It is fixed once
a call is up, since a TTS opens its context with a voice id.

## The call, on the left

The **captions** are video subtitles rather than a transcript: at most two
sentences, clamped to two lines, the previous one faded. They come from
`usePipecatConversation()` and render the kit's karaoke split — the spoken part
of the sentence in full ink, the tail ahead of playout dimmed, the boundary
advancing as it is said. That is a real check on the server, not a decoration:
it only tracks because `CannedTTSService` puts word timings on the wire the way
pipecat's protocol requires (`add_word_timestamps`, `push_text_frames=False`).
The one rule worth knowing is written in `Captions.tsx` — an empty spoken half
means *no karaoke on this TTS*, not *nothing said yet*, and reading it the other
way dims every caption a timestamp-free vendor produces.

The **status** under the frame — Talking, Listening, Idle — is derived from
`RTVIEvent` speaking events and the transport state, not from the avatar. The
meter over the frame is the kit's `VoiceVisualizer` on the bot track; the mic
control under the button is its `UserAudioControl`, which is the device picker
and your own level in one thing, usable before you dial.

The chrome comes from [`@pipecat-ai/voice-ui-kit`](https://github.com/pipecat-ai/voice-ui-kit)
— the same components a pipecat developer already has. Studio's own layout is
hand-written CSS on the kit's tokens: the kit ships its Tailwind bundle prebuilt
with only the utilities it uses, so there is no Tailwind build here and no
arbitrary utility classes that would silently do nothing.

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
