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
| `claim` | `THINKING`, `WORKING`, `null` | Candidate durable state; `null` clears it. |
| `action` | promoted action IDs | Start one self-completing behavior action. |
| `cues` | `ctx`, `from_ms`, `cues`, `final?` | Correlated viseme splice. |

The promoted action IDs stay uppercase for compatibility:

```text
ACK_RECEIVE, ACK_NOD
RESPONSE_INTERRUPTED
GESTURE_GREET, GESTURE_GOODBYE, GESTURE_APPROVE, GESTURE_WAIT
```

The client maps stable wire IDs to behavior-library actions. New behavior
actions are library-only until deliberately promoted here. Claims are retired
by a new user turn, bot playout, or explicit `null`; they must not return after
a factual boundary.
