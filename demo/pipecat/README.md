# The pipecat demo

A real voice call — your microphone, Google STT, Gemini on Vertex, Google TTS —
with the avatar lipsyncing to the audio the bot is actually speaking. No canned
clips, no recorded fixtures, no demo-only state machine.

The point of the demo is one line of `bot.py`:

```python
avatar = AvatarProcessor()
```

seated between the TTS and the output transport. Nothing else in the pipeline
knows the avatar exists. Delete that line and the call still works, minus the
face.

## Prerequisites

One Google login covers all three services:

```
gcloud auth application-default login
```

The project comes from `GOOGLE_CLOUD_PROJECT`, else from ADC's own quota
project, else from whatever the login discovered. To point the demo at a
different project, either export `GOOGLE_CLOUD_PROJECT` or run `gcloud auth
application-default set-quota-project <project>` — but not `gcloud config set
project`, which moves the CLI's default without moving the credential the calls
authenticate with.

Three APIs have to be enabled on whichever project it lands on. A missing one
fails at first use, mid-call, not at startup:

```
gcloud services enable \
  aiplatform.googleapis.com \
  speech.googleapis.com \
  texttospeech.googleapis.com
```

Then build the two things that are compiled — the TypeScript client, and a
bundle of pipecat's browser packages (they ship ESM with bare specifiers, which
a browser cannot resolve):

```
npm install && npm run build && npm run demo:vendor
cd py && uv sync --group demo
```

## Run

```
cd py && uv run --group demo python ../demo/pipecat/server.py
```

Open <http://localhost:7860> and click **Start call**. Grant the microphone when
Chrome asks — the call cannot connect until you do. The bot speaks first.

The right-hand panel is the avatar wire as it arrives: `claim` for state,
`action` for a nod or a receipt, `cues` for lipsync. A turn typically shows one
`claim`, then a run of `cues` messages that keep rewriting the same span from a
low `from_ms` — that is the accurate leg overwriting the predicted one, and it is
supposed to look like that.

Flags: `--tts` (`google` streaming by default, `google-http` for batch),
`--port`, `--host`.

## Which TTS

`bot.py` keeps the TTS behind a small registry because it is the one service the
avatar consumes:

| `--tts` | service | shape |
|---|---|---|
| `google` | `GoogleTTSService` | streaming; many small frames mid-sentence. Chirp 3 HD and Journey voices only. |
| `google-http` | `GoogleHttpTTSService` | batch; the sentence lands at once. Every voice. |
| `vql-speech` | `CartesiaTTSService`, redirected | Voqalize's own; streaming at 24 kHz. Needs the two variables below. |

Watch more than one. Under `google` the corrections stream in and the mouth
converges while it is still talking; under `google-http` the predicted leg is
replaced in one go. Adding a vendor is adding a zero-argument factory to
`TTS_SERVICES`.

`vql-speech` speaks Cartesia's protocol, so it is `CartesiaTTSService` with a
different host and a different credential — a self-signed RS256 JWT rather than
a static key, which means vql-speech has to already trust the public half of
whatever key you point at:

```
VQL_SPEECH_WS_URL=wss://speech.<env>.example.com \
VQL_SPEECH_KEY_PEM=/path/to/signing-key.pem \
  uv run --group demo python ../demo/pipecat/server.py --tts vql-speech
```

Neither has a default and neither is in this repo — everything committed here is
public. `VQL_SPEECH_VOICE` overrides the voice (`omnivoice/gaurav`). A key
vql-speech has not been told about fails closed at the handshake with a 403.

## Editing while it runs

`src/` and `client/dist/` are served straight from the working tree with
`Cache-Control: no-store`, so a rig edit needs only a reload — no build, no
restart, and no stale-module debugging. Only `client/` (`npm run build`) and the
vendored pipecat bundle (`npm run demo:vendor`) need rebuilding, and only when
you change them.

## If it doesn't come up

- `missing … — run \`npm run demo:vendor\`` — the server checks its three mounts
  at startup and names the command for each.
- Browser console shows a module resolution error — `npm run demo:vendor` again;
  the bundle is gitignored and does not survive a clean checkout.
- The call connects but the bot never speaks — check the server log for a Google
  auth or API-not-enabled error. Every service fails at first use, not at start.
