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
- **Nothing here asks the avatar anything.** `createAvatar` returns no resolved
  state, deliberately, so an integration cannot come to depend on one. The
  status line under the frame names a state, but it worked that state out
  itself, from the same events and the same `serverMessage` traffic the face
  reads — `studio/src/presence.ts`, written from
  [contract-wire.md](../docs/contract-wire.md) and
  [pipecat-lifecycle-protocol.md § Authority model](../docs/pipecat-lifecycle-protocol.md)
  rather than from `AvatarClient`. That is what makes it worth having: it is a
  second, independent reading of the call, and when the word and the drawing
  disagree, the disagreement is the finding.

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
| disconnected | **Your createAvatar call** — face, the three gains, the hand and its side, then the pipeline and the voice | the option surface of `createAvatar`, which is yours to decide and nobody else's. Every control rewrites a live snippet of the call you would paste, and at the defaults it writes `createAvatar({ mount, client })` and nothing more — which is the argument for the library in one screen |
| in a call | **Drive the server** — the quiet between turns, interjections, misbehaviours | [contract-wire.md](../docs/contract-wire.md), from the sending end. The beats make the server take as long as a real one would and announce nothing, so `THINKING` and `WORKING` are *inferred* from ordinary frames; hold thinking past the reply grace and it becomes `STRAINING`. The interjections are one-shot `action`s. The mute toggle is the one control that puts nothing on the avatar wire at all. The misbehaviours are what the face is supposed to refuse — a claim that contradicts playout, an action storm, a claim that arrives too late |

Every drive button names the wire message it asks the server for. Hovering or
focusing one puts that id and what to watch for in the line under the set; a
click pins the same line for five seconds and flashes the button, so the thing
you pressed and the thing that went out are legible without a wire log — which
was cut deliberately, and stays cut ([removed.md](../docs/removed.md) § Studio's
wire log, compare mode and transcript panel).

Mode is read from the transport, once, in one place — `usePipecatClientTransportState()`
— so the button, the panel and every disabled control cannot disagree about
whether there is a call. Options stay changeable mid-call: the build collapses
to a line with a **Show code** button rather than locking, and **Hide** puts the
drive controls back.

The header carries the orientation, because a developer landing here cold has
two questions — what is this, and what do I do — and a screen of controls
answers neither. Three numbered steps, with the current one marked: build,
connect, drive. The package name is a link to npm, and a quiet nav at the end of
the bar carries GitHub · Docs · npm, so a developer who wants the source does not
have to guess the org.

Each code block carries the install line that makes it run — `npm install` above
the browser snippet, `pip install` above the pipeline — and a **Copy** button
that takes the install and the code as one block, because a snippet you have to
reassemble by hand is a screenshot.

**One avatar at a time.** A compare mode used to mount all three faces side by
side; it made the frame small enough that nothing in it could be judged, which
is the opposite of what a comparison is for. The faces are separate drawings
rather than renderings of one, so a difference between them is usually not the
finding it looks like ([removed.md](../docs/removed.md)).

**Your pipeline** is the one band with nothing to press. The browser half is
complete without it and that is exactly the trap: a reader who stopped at the
`createAvatar` snippet would ship a face that blinks and never speaks, because
the messages it animates from are put on the wire by a pipecat processor, in the
other language, in the other half of the repo. So the card states the other
install and the one import, seats `AvatarProcessor()` between the TTS and the
output transport, and says what you lose without it — lipsync and every state
change ([py/README.md](../py/README.md)).

The **voice** sits in the build panel but in a band of its own, because it is
not a `createAvatar` argument — it is which voice `server/` speaks in, and it
reaches the face only as audio ([server/README.md § Two voices](../server/README.md)).
It is there at all because the two have to agree: a voice that contradicts the
face is read as a mistake long before any animation defect is. It is fixed once
a call is up, since a TTS opens its context with a voice id.

**The voice follows the face by default.** Pick a drawing between calls and
Studio picks the voice with it — `peep` male, `wren` and `myna` female — by
`POST /api/voice`, the same request the buttons make. It also aligns once when
the server's vocabulary first arrives, because the stored voice is whatever the
last session left and the page always opens on `peep`. That pairing is
**Studio's own opinion**, the `READS` map in `Build.tsx`: the package holds no
view about which voice belongs with which drawing, because holding one would be
the library having an opinion about a TTS it deliberately has none of.

It is a default and not a lock. Choose a voice yourself and it stands, and the
one-line mismatch note appears under the buttons — so that line now means *you
meant this*, rather than *Studio has a suggestion*. Hearing what a mismatch
costs is a legitimate reason to be on this page. The other way to reach it is to
change the face mid-call, when the voice cannot follow: `/api/voice` is answered
only between calls, and the line says which voice the new face wanted.

## The call, on the left

The **captions** are video subtitles rather than a transcript, and they are
drawn as ones: no box, no border, no card — centred text straight on the page
under the frame, a little larger than the chrome around it, held off the dark
ground by a text shadow rather than by a plate. They used to sit in a filled
rounded rectangle, which read as a chat bubble, and a chat bubble asks to be
read back instead of watched. At most two sentences, clamped to two lines, the
previous one nearly gone; the two-line height is reserved whether or not there
are words in it, so nothing under the captions moves as a turn starts and ends.
Two lines is a budget, so when the sentence being spoken is long enough to need
both the previous one is dropped rather than clamped away — losing the end of
the live sentence would hide the words the mouth is shaping, which is the only
part of a caption this page is for. They come from
`usePipecatConversation()` and render the kit's karaoke split — the spoken part
of the sentence in full ink, the tail ahead of playout dimmed, the boundary
advancing as it is said. That is a real check on the server, not a decoration:
it only tracks because `CannedTTSService` puts word timings on the wire the way
pipecat's protocol requires (`add_word_timestamps`, `push_text_frames=False`).
The one rule worth knowing is written in `Captions.tsx` — an empty spoken half
means *no karaoke on this TTS*, not *nothing said yet*, and reading it the other
way dims every caption a timestamp-free vendor produces.

The **status** under the frame is the library's own state name — `SPEAKING`,
`LISTENING`, `STRAINING`, `THINKING`, `WORKING`, `MUTED`, `IDLE` — rather than a
friendlier synonym, so the word on screen is the word you can grep for. Most of
them describe the stretch where nobody is making a sound, which is the stretch
worth watching: it used to read `Idle` throughout, and `Idle` is almost always
the wrong answer there
([pipecat-lifecycle-protocol.md § The silence problem](../docs/pipecat-lifecycle-protocol.md)).
`OFFLINE` and `DEGRADED` never appear — before a call the transport says where
it has got to, in its own words, next to the button that acts on it.

The **size** control under the status line is `130 · 240 · 400`, and 130 is the
default and stays it. That is the size the rig is calibrated at and the size a
consumer embeds ([CLAUDE.md § In flight](../CLAUDE.md)) — a page that opened at
400 would be advertising a face nobody ships, and a defect that only shows at
tile size is the defect this page exists to catch. The other two widths are for
when you have found something and want to see what it is. Nothing here reaches
`createAvatar`: the mount element gets wider and the SVG fills it, so changing
size is not a remount and the call keeps running.

**A dial that goes nowhere says what to run.** The message sits under the Connect
button, names the server URL the page is actually pointed at, and gives the
command that starts it; the transport's own text is appended in brackets when
there is any, which usually there is not. It used to be a red banner reading
`undefined`, which is what happens when an error callback's text is the only
thing you show.

The meter over the frame is the kit's `VoiceVisualizer` on the bot track, and it
is drawn only while a call is up — with no track to measure it is a row of flat
dots across the character's collar, which is chrome on top of the one thing the
page is for. The
mic control under the button is its `UserAudioControl`, which is the device
picker and your own level in one thing, usable before you dial. Its two buttons
are the kit's own internals and carry the kit's labels — the only text Studio
supplies there is the dropdown's.

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
