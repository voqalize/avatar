# Avatar wire protocol and frontend autonomy

The current operational contract is
[Pipecat lifecycle protocol](pipecat-lifecycle-protocol.md). This note keeps
the concise answer to the two questions that previously caused confusion.

## What crosses the custom avatar wire

Only three `RTVI server-message` commands are avatar traffic:

```text
claim       durable lower-priority server intent
action      explicit acknowledgement, nod, face or hand sequence
cues        correlated viseme chunks
```

The envelope is always `{ "type": "avatar", "cmd": "…" }`. The `user`
command no longer exists.

`action.id` has one compact vocabulary shared by frontend and backend:

```text
ACK_CONTINUE       ACK_RECEIVE       ACK_REALIZE
ACK_EMPATHIZE      ACK_NOD           RESPONSE_INTERRUPTED
GESTURE_GREET      GESTURE_GOODBYE   GESTURE_APPROVE   GESTURE_WAIT
```

The names describe the intended communication, not a rig mechanism. For
example, `ACK_NOD` may have a different physical implementation on a future
avatar without changing the protocol.

## What the frontend decides from Pipecat itself

`AvatarClient.attach(client)` subscribes to the Pipecat JavaScript client for
user and bot voice, connection and error events. It
uses its fixed built-in projection:

```text
user voice             -> listening posture and engagement lean
bot playout            -> speaking safety, cue-clock anchor and cleanup
failure/disconnect     -> degraded/offline
```

This is factual execution presence, not conversational interpretation. The
frontend never autonomously produces a facial acknowledgement. Every nod,
receipt, empathy reaction, head shake or spoken continuer is still a deliberate
backend/application `action` command.

The Pipecat speaking events do not carry a cue-turn `ctx`. The backend uses the
stock base-TTS `context_id` only on `cues`; the client FIFO-binds the next
buffered context when Pipecat reports bot playout. The backend does not mirror
Pipecat lifecycle back as avatar messages, avoiding two competing sources for
the same pose.

There are no lifecycle extension hooks in this release. The default active
function-call behavior is the durable client `WORKING` state; its initial
client-owned program selects typing. Tool-specific and DOM-aware behavior will
be designed after we have production evidence for the right JavaScript seam.
