# The server

A real voice call — your microphone, WebRTC, a live pipecat pipeline — with the
avatar lipsyncing to the audio the bot is speaking. It runs with no API key, no
account and no model download, because the first run is the one that decides
whether there is a second, and a credential form is a strange thing to put in
front of a talking head.

The point of it is one line of `bot.py`:

```python
avatar = AvatarProcessor()
```

seated between the TTS and the output transport. Nothing else in the pipeline
knows the avatar exists. Delete that line and the call still works, minus the
face.

```
transport.input() → VADProcessor(SileroVADAnalyzer) → UserTurnProcessor → llm → tts → avatar → transport.output()
```

There is no speech recognition in that list, no language model and no context
aggregator. The default `llm` and `tts` are `canned.py`: a fixed corpus of
sentences with a WAV recorded for each. They are not mocks — a real
`LLMService` and a real `TTSService`, pushing the real frames in the real
order, so nothing downstream can tell the difference and neither can the wire.
The avatar is byte-identical whichever vendor spoke.

## Run

```
pnpm install && pnpm -w run build && pnpm -w run server:vendor
cd py && uv run --group server python ../server/server.py
```

Open <http://localhost:7860> and click **Start call**. Grant the microphone when
Chrome asks — the call cannot connect until you do. The bot speaks first.

The right-hand panel is the avatar wire as it arrives: `claim` for state,
`action` for a nod or a receipt, `cues` for lipsync. A turn typically shows one
`claim`, then a run of `cues` messages rewriting the same span from a low
`from_ms` — that is the accurate leg overwriting the predicted one, and it is
supposed to look like that.

Flags: `--tts`, `--port`, `--host`.

## Driving it by hand

Waiting for the round-robin to reach the line you wanted is a bad way to look at
a gesture. The **Drive the call** panel says one line by name, claims a state,
sends any action in the vocabulary, and — the part worth the code — sends the
wrong thing on purpose.

Every button is an HTTP request to the server, never a message the page
composes: `POST /api/say`, `/api/claim`, `/api/action`, `/api/misbehave`, all
acting on the one call in progress, with `GET /api/lines` returning the corpus
and both vocabularies so the buttons cannot drift from the Python enums. A page
that could make the avatar nod on its own would be a client deciding what the
agent is doing, which is the one thing this project does not allow. So what
lands in the wire log is what the *server* sent — which is how you tell a
command the face ignored from one that never arrived.

The five misbehaviours are there because the authority model
([pipecat-lifecycle-protocol.md § Authority model](../docs/pipecat-lifecycle-protocol.md))
is a claim about the *renderer*, and until now nothing exercised it: every
message this server sent was well-formed and sent at the right moment. Each
button names what to watch for.

| kind | what should happen |
|---|---|
| `claim-during-speech` | the face keeps speaking — observed playout outranks server intent |
| `stale-claim` | a claim arriving after its turn ended does not resurface |
| `unknown-action` | ignored, and the face keeps rendering |
| `unknown-claim` | same bar: ignored, not rendered, not fatal |
| `action-storm` | no queue of twelve nods still draining after the burst |

`curl` works too, and the endpoints answer `409` with no call up and `404` for a
name that is not in the vocabulary — including on `/api/action`, so a typo there
does not quietly become a conformance test.

## What it says

Turn-taking here is voice activity plus a timeout, not understanding. The agent
takes its turn when you stop talking; it does not answer what you said. That is
the honest description of a closed corpus, and it is enough to exercise every
avatar state the wire has.

`lines.json` holds that corpus — 20 lines, 33 sentences, cycled round-robin,
each of them about the avatar project rather than about you. Backchannels are
over-represented on purpose: this face listens far more than it speaks, so a
*go on* that lands is worth more here than a paragraph that does not.

This demonstrates the face, not a conversation. Watch what it does while you
are talking, which is most of what it is for.

Sentences, not lines, are the unit. `TTSService` aggregates text to sentence
boundaries before calling `run_tts`, so a two-sentence line arrives as two
separate calls and needs two clips; a corpus keyed by whole line would miss on
the first line containing a full stop, and miss silently, as a sentence with no
audio.

## Which TTS

`bot.py` keeps the TTS behind a small registry because it is the one service
whose output the avatar consumes — a different vendor means different frame
sizes, a different sample rate and different word timing.

| `--tts` | service | shape |
|---|---|---|
| `canned` (default) | `CannedTTSService` | plays the recorded clip, paced at 2× real time. No credential. |
| `google` | `GoogleTTSService` | streaming; many small frames mid-sentence. Chirp 3 HD and Journey voices only. |
| `google-http` | `GoogleHttpTTSService` | batch; the sentence lands at once. Every voice. |
| `vql-speech` | `CartesiaTTSService`, redirected | Voqalize's own; streaming at 24 kHz. |

Every vendor import lives inside its own factory, which is what lets the
default run on a dependency set that has none of them. There are two groups:
`server`, which needs no credential, and `server-vendors`, which is opt-in and
exists for the one job below.

```
cd py && uv run --group server --group server-vendors python ../server/server.py --tts google
```

Google authenticates off `gcloud auth application-default login`. `vql-speech`
speaks Cartesia's protocol, so it is `CartesiaTTSService` with a different host
and a different credential — a self-signed RS256 JWT rather than a static key,
which means vql-speech has to already trust the public half of whatever key you
point at:

```
VQL_SPEECH_WS_URL=wss://speech.<env>.example.com \
VQL_SPEECH_KEY_PEM=/path/to/signing-key.pem \
  uv run --group server --group server-vendors python ../server/server.py --tts vql-speech
```

Neither has a default and neither is in this repo — everything committed here is
public. `VQL_SPEECH_VOICE` overrides the voice. A key vql-speech has not been
told about fails closed at the handshake with a 403.

## Verifying lipsync

This directory is the only place lipsync is ever verified, and within it, only
against a real vendor.

The canned service is not a generator. Its audio already exists in full when
synthesis starts, so its arrival timing is simulated rather than observed — and
arrival timing is precisely what the accurate viseme leg races against. Pacing
it at 2× keeps that race from being a foregone conclusion, but a plausible
number is not a measurement. Everything else about the canned path is real; this
one thing cannot be.

So verifying lipsync means a real microphone and a real generator:

```
cd py && uv run --group server --group server-vendors python ../server/server.py --tts google
```

Two things only ears catch, and no suite in this repo will tell you either:

- the mouth moves the instant audio starts;
- the accurate leg's arrival is not visible as a jump.

Watch more than one vendor. Under `google` the corrections stream in and the
mouth converges while it is still talking; under `google-http` the predicted leg
is replaced in one go. `authoring/lipsync-review.html` plays *baked* cue tracks
— it shows what a leg's cues look like, never how the two legs interleave,
latch or rewrite under a live generator. Studio drives this same server, so the
legs are live there too; what it does not give you is this page's plainness,
which is the point of judging here.

## The audio is committed

`audio/` — 33 WAVs, 2.8 MB — is in git deliberately, which is the opposite call
from the aligner in `native/avatarsync/`, whose library and model tree were taken
out of git in favour of `native/avatarsync/get.sh`.

The distinction is what it costs to get the bytes back. The aligner is one
command away from a published wheel, so storing it bought nothing but a large
diff. The corpus audio can only be reproduced by downloading a ~60 MB speech
model, and a reader who clones this repo should be able to hear the avatar
without that.

`record.py` is the other half of that promise — the checked-in answer to "how do
I add a line?", which used to be "ask whoever made the last one". Edit the text
in `lines.json`, then:

```
cd server && uv run --with piper-tts python record.py
```

It fetches the voice into `.voices/` (gitignored) on first run, re-records every
sentence, and refuses any clip whose rate, channel count or bit depth is not
what `lines.json` declares — the same properties the corpus re-checks when it
loads, alongside the file simply being absent. Every one of those failures looks
identical at runtime: the mouth moves and no sound comes out, which reads as a
lipsync bug and is not one.

The voice is `en_US-ljspeech-high`, and it is chosen for its licence rather than
its sound. LJSpeech is public domain. This repo is public and AGPL, and every
WAV in it is redistributed to everyone who clones it — which rules out the
obvious shortcut of macOS `say`, whose voices produce the exact target format
and are Apple's to license, not ours to ship.

## Editing while it runs

`src/` and `client/dist/` are served straight from the working tree with
`Cache-Control: no-store`, so a rig edit needs only a reload — no build, no
restart, and no stale-module debugging. Only `client/` (`pnpm -w run build`) and the
vendored pipecat bundle (`pnpm run server:vendor`) need rebuilding, and only
when you change them. Nothing of ours is bundled: `src/` is dependency-free ES
modules by constraint and the browser loads it as-is.

`no-store` is not paranoia. `python3 -m http.server` sends `Last-Modified` with
no `Cache-Control`, browsers apply heuristic freshness, and they stop
revalidating modules you have edited — three debugging sessions, one of which
produced a module error that was simply a lie.

## If it doesn't come up

- A `missing …` line at startup — the server checks its three mounts before it
  binds a port, and names the command that produces each one.
- Browser console shows a module resolution error — `pnpm run server:vendor`
  again; `vendor/pipecat.js` is gitignored and does not survive a clean
  checkout.
- Server exits at startup naming a clip — the corpus validates on load, so
  re-run `record.py` after editing `lines.json`.
- With `--tts google`, the call connects but the bot never speaks — check the
  log for an auth or API-not-enabled error. Vendor services fail at first use,
  mid-call, not at startup, and `texttospeech.googleapis.com` has to be enabled
  on whichever project the credential lands on — which is the one ADC chose, not
  the one `gcloud config set project` names.
