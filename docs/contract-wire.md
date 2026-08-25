# Wire contract

This is the narrow server profile over the broader behavior library. It is the
only custom avatar traffic sent as a Pipecat RTVI `serverMessage`.

```json
{ "type": "avatar", "cmd": "claim", "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACK_NOD" }
{ "type": "avatar", "cmd": "cues", "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

Pipecat JavaScript events are factual client inputs: bot/user speaking,
connection, and failure. The server sends only lower-priority durable claims,
deliberate semantic actions, and TTS-context-correlated Rhubarb cues.

| Command | Values | Meaning |
|---|---|---|
| `claim` | `STRAINING`, `THINKING`, `WORKING`, `null` | Candidate durable state; `null` clears it. |
| `action` | promoted action IDs | Start one self-completing behavior action. |
| `cues` | `ctx`, `from_ms`, `cues`, `final?` | Correlated viseme splice. |

## Cue timeline

`cues` is a patch to an utterance timeline, never a "play this now" command.
Each cue is `{t, v, i?}`: `t` is milliseconds from the turn's first TTS audio
sample, `v` is a Rhubarb A–H/X mouth shape, and optional `i` is intensity.
`from_ms` uses the same coordinate system and means: discard the canonical
track at and after that offset, then append `cues`. That is the whole fast-to-
accurate correction primitive; arrival time has no meaning.

`ctx` is Pipecat's opaque TTS `context_id`. Cue patches commonly arrive before
audio because the text-predicted track exists first. Since Pipecat's browser
speaking events do not carry a context, the client buffers contexts FIFO. At
`BotStartedSpeaking` it claims the next one, maps timeline position zero to
that Pipecat output-lifecycle event, and starts sampling the already-buffered
track. This epoch is not a claim that the browser's audio device has made a
sample audible; the public `PipecatClient` seam exposes no device-playout clock.

`final: true` means no more cue patches will be generated for this context. It
does not mean the audio has finished; `BotStoppedSpeaking` remains the hard
mouth stop. An interrupted context deliberately never claims to be final.

The promoted action IDs stay uppercase for compatibility:

```text
ACK_RECEIVE, ACK_NOD
RESPONSE_INTERRUPTED
GESTURE_GREET, GESTURE_GOODBYE, GESTURE_APPROVE, GESTURE_WAIT
```

The client maps stable wire IDs to behavior-library actions. New behavior
actions are library-only until deliberately promoted here. Claims are retired
by a new user turn, Pipecat bot output, or explicit `null`; they must not return
after a factual boundary.

Only one claim is in flight at a time — a later one replaces the earlier — so
the three names carry no ordering on this wire. Which condition wins when
several hold at once is decided before a message is sent
([pipecat-lifecycle-protocol.md § The silence problem](pipecat-lifecycle-protocol.md)).
There is no claim for a muted microphone: pipecat's own mute events already
reach the browser client, and a claim would be a second, lower-authority
spelling of a fact.
