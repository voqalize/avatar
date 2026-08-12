# Pipecat lifecycle protocol

## Authority model

The browser resolves one effective visual state. It is not the last wire
message received. Its precedence is fixed:

1. `SPEAKING` while Pipecat reports bot playout.
2. `LISTENING` while Pipecat reports user speech.
3. `OFFLINE` / `DEGRADED` when no observed speech pre-empts that presentation.
4. Server claim `WORKING`.
5. Server claim `THINKING`.
6. Client `LISTENING`, then client-owned `IDLE` after 12 seconds of quiet.

Connection failure is lower than observed speech. A new user turn and real bot
playout both retire any prior server claim, so it cannot reappear stale after speech.
The browser never uses microphone VAD to interrupt bot speech: if audio is
playing, the avatar is speaking and its mouth is viseme-driven.

The server sends only three kinds of avatar intent:

```json
{ "type": "avatar", "cmd": "claim", "state": "THINKING" }
{ "type": "avatar", "cmd": "claim", "state": null }
{ "type": "avatar", "cmd": "action", "id": "ACK_RECEIVE" }
```

An action is self-completing. It can include face, torso, and hand motion. A
new effective state applies immediately underneath it, while the action's own
channels finish their natural landing. `RESPONSE_INTERRUPTED` is special only in timing:
it is server-confirmed, arms while playout is active, and starts after bot
playout stops so it cannot override an audible viseme.

This is the binding for an avatar mounted with a live
`@pipecat-ai/client-js` client. It replaces the old duplicated `user` avatar
wire command.

## Ownership

Pipecat's browser client is the authority for observable runtime facts. The
avatar server is the authority for correlated visemes and deliberate semantic
actions. The avatar renderer owns only physical polish: blending, blink,
breath, small eye motion and sustained posture.

```text
Pipecat JavaScript events  -> factual speech, connection posture, cue-clock anchor
avatar server-message      -> visemes, server claims, and explicit actions
avatar renderer            -> composition; never an inferred acknowledgement
```

In particular, the renderer must never autonomously emit a nod, brow
acknowledgement, spoken continuer or empathy reaction. Those are always
explicit `action` messages sent by application/backend code.

## Browser subscriptions and default projection

`AvatarClient.attach(pipecatClient)` subscribes to the following standard
Pipecat events. It uses the fixed defaults below; there are deliberately no
application extension hooks in this version.

| Pipecat event | Default projection |
|---|---|
| `UserStartedSpeaking` | `LISTENING`; stop the work loop; `setUserSpeaking(true)` enables only the sustained engagement lean. |
| `UserStoppedSpeaking` | `setUserSpeaking(false)` and hold `LISTENING`; the server may then claim `THINKING`. No acknowledgement is emitted. |
| `BotStartedSpeaking` | `SPEAKING`; it pre-empts and consumes any lower-priority server claim. |
| `BotStoppedSpeaking` | Stop any still-open viseme track immediately, then return to `LISTENING`. |
| `Error` | `DEGRADED`, or `OFFLINE` when `data.fatal` is true. |
| `Disconnected` | `OFFLINE`. |
| `Connected` / `BotReady` | Clear a prior offline presentation and resume normal projection. |

The server owns `THINKING` and `WORKING` because function-event reporting at
the browser is optional. It claims `WORKING` for active calls and clears it
after the last one. The client behavior library owns how `WORKING` is rendered:
today its work program selects typing; future notes/screen activities need no
wire change. Tool-specific behaviour, DOM-aware gaze and custom compound motion
remain deferred until there is evidence for a stable JavaScript extension API.

## Verification lab

Open [the Pipecat lifecycle lab](../demo/rig/pipecat-lifecycle-lab.html)
through the development server. It mounts the real `AvatarClient` against a
Pipecat-shaped local event emitter and exposes six repeatable traces:

- Normal reply
- Streaming reply (bot speech pre-empts a thinking claim)
- Parallel tools
- Interruption
- Failure and reconnect
- Explicit nod

The timeline distinguishes SDK events from custom avatar messages. The primary
visual invariant is that no acknowledgement appears in any scenario except
**Explicit nod**.

The server state machine deduplicates Pipecat function calls by `tool_call_id`,
so repeated Started/InProgress notifications cannot strand `WORKING`.

## Streaming and event order

LLM and audio events overlap in streaming pipelines. `BotStartedSpeaking` can
arrive while a `THINKING` claim is still present; bot playout wins immediately
and consumes the claim.

The Pipecat JavaScript client has no standalone interruption event. The server
observes the actual `InterruptionFrame` and emits `action:RESPONSE_INTERRUPTED` only
when bot speech is active. The browser treats bot playout stop as the mouth
safety boundary, then plays that action.

## Avatar server-message wire

All custom avatar traffic remains an RTVI `server-message` envelope:

```json
{ "type": "avatar", "cmd": "action", "id": "ACK_NOD" }
```

The vocabulary contains three commands:

| `cmd` | Sent by | Purpose |
|---|---|---|
| `claim` | server/application | Durable lower-priority `THINKING`, `WORKING`, or an explicit `null` clear. |
| `action` | server/application | Self-completing acknowledgement, reaction, face action, or hand gesture. |
| `cues` | `AvatarProcessor` | Timed viseme chunks, keyed by `ctx`. |

`action.id` is intentionally compact and semantic:

| Family | IDs |
|---|---|
| Acknowledgement | `ACK_CONTINUE`, `ACK_RECEIVE`, `ACK_REALIZE`, `ACK_EMPATHIZE`, `ACK_NOD` |
| System transition | `RESPONSE_INTERRUPTED` |
| Visible gesture | `GESTURE_GREET`, `GESTURE_GOODBYE`, `GESTURE_APPROVE`, `GESTURE_WAIT` |

There is no `user` command. Pipecat already emits VAD-derived user-speaking
events to the browser, so duplicating that fact over a second channel created
races and obscured ownership.

The backend `AvatarProcessor` deliberately does **not** mirror Pipecat
lifecycle. Its `cues.ctx` is the stock base-TTS `context_id`; it does not make
up a fallback. Because browser speaking events carry no context, the client
FIFO-binds the next buffered `ctx` when `BotStartedSpeaking` arrives, anchors
the cue clock then, and closes it at `BotStoppedSpeaking`. It passes
`AvatarControlFrame` claims/actions through for explicit application intent.

## Composition precedence

The client resolves effective state in this order:

```text
bot speech
  > user speech
  > OFFLINE / DEGRADED
  > server WORKING claim
  > server THINKING claim
  > listening
  > client idle after quiet timeout
```

Actions are layered over that state and finish their natural landing; they
never create a durable state or need an action-end message.

## Compatibility

This is a coordinated frontend/backend change. A newer client ignores unknown
avatar commands as before; deploy matching package versions together.
