# Pipecat lifecycle protocol

## Authority model

The browser resolves one effective visual state. It is not the last wire
message received. Its precedence is fixed:

1. `SPEAKING` while Pipecat reports bot playout.
2. `LISTENING` while Pipecat reports user speech.
3. `OFFLINE` / `DEGRADED` when no observed speech pre-empts that presentation.
4. `MUTED` while Pipecat reports a mute strategy in place.
5. Server claim `STRAINING`.
6. Server claim `THINKING`.
7. Server claim `WORKING`.
8. Client `LISTENING`, then client-owned `IDLE` after 12 seconds of quiet in
   an established Pipecat session. A newly mounted avatar begins available,
   never already "stepped aside".

Connection failure is lower than observed speech. A new user turn and real bot
playout both retire any prior server claim, so it cannot reappear stale after speech.
The browser never uses microphone VAD to interrupt bot speech: if audio is
playing, the avatar is speaking and its mouth is viseme-driven.

Rungs 5–7 are ranked here but not compared here. A claim is a single value and
only one is ever in flight, so the browser reads whichever one arrived; the
ordering is applied where several conditions genuinely hold at once, which is
the server (`AvatarStateMachine._resolve`). Ranking them a second time on the
client would be a duplicate ladder, and the two would drift.

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

## The silence problem

Two of the eight rungs are easy. The bot is speaking, or the user is — Pipecat
reports both, the browser has them first-hand, and nothing here improves on
that. Every hard question is about the stretch when *neither* is speaking, which
in a real call is most of it.

`IDLE` is the wrong answer to nearly all of that stretch. Something is
happening: an endpointer is deciding whether the turn ended, an aggregator is
assembling a context, a model is generating, a tool is running, a TTS is
buffering its first chunk. None of it is audible, and a face that goes blank
across it reads as *disconnected* rather than *busy* — which is exactly the
defect that produced this section. `IDLE` should mean what it says: a
connected, quiet call in which nothing is pending, and the avatar has
legitimately stepped aside.

Nothing announces any of the above. There is no thinking frame. What there is,
is a *flow* of frames whose shape implies a condition, so each state below is a
latch — armed by one observation, retired by another — and the ladder picks one
when several are set. The whole set is small on purpose: a heuristic nobody can
name a failure mode for is a heuristic that will be wrong silently.

| state | the condition | armed by | retired by |
|---|---|---|---|
| `SPEAKING` | bot playout is audible | `BotStartedSpeakingFrame` | `BotStoppedSpeakingFrame` |
| `LISTENING` | the user is speaking | `UserStartedSpeakingFrame` | `UserStoppedSpeakingFrame` |
| `MUTED` | a mute strategy holds the user's microphone | `UserMuteStartedFrame` | `UserMuteStoppedFrame` |
| `STRAINING` | the turn produced nothing to answer | an empty final transcript, or `AvatarProcessor`'s grace timer expiring | the next user turn, or any sign of a response |
| `THINKING` | a reply is outstanding | `UserStoppedSpeakingFrame`, `UserTurnInferenceCompletedFrame`, `LLMFullResponseStartFrame`, a tool's result | `BotStartedSpeakingFrame` |
| `WORKING` | a tool is running | `FunctionCallsStartedFrame` / `FunctionCallInProgressFrame` | the last call's result — or its cancel |
| `IDLE` | none of the above, for 12 s | the client's quiet timer | any of the above |

Four of those need their reasoning stated, because in each case the obvious
implementation is wrong.

**`THINKING` starts at the end of the user's turn, not at the LLM's.** The
frame the heuristic wants is `LLMContextFrame` — input reached the model — and
it never arrives at the avatar's seat, because the LLM service consumes it. The
downstream-visible equivalent is `LLMFullResponseStartFrame`, pushed
immediately *before* the model is asked. But arming only there would leave the
transcription and aggregation latency in front of it uncovered, and that gap is
a second or more. So the wait opens when the user stops talking and closes when
words are audible, and `LLMFullResponseStartFrame` merely confirms it mid-flight
— which is also the fix for a real defect: that frame used to *clear* the claim,
so the single longest silence in a call was the one stretch with nothing to
show.

**`WORKING` is below `THINKING`, and that is what makes it delicate.** Tool
calls happen *inside* an outstanding reply. If the `THINKING` latch stayed
armed across one, the lower rung could never win, and `WORKING` would be a state
no real pipeline ever reached. A tool call therefore suspends the reply latch,
and the tool's result resumes it. That is not a workaround for the ordering: a
model blocked on a tool result is not composing an answer. Read `THINKING` as
"waiting on the model for words" and the two stop overlapping.

**`STRAINING` needs a clock, because there is no negative frame.** Nothing says
"the turn produced nothing". `UserTurnInferenceCompletedFrame` is emitted only
when a producer judges a turn complete, and its own docstring is explicit that
absence means nothing. So the empty case is inferred two ways: instantly from an
empty final `TranscriptionFrame` where transcripts reach this seat, and
otherwise from `AvatarProcessor`'s grace timer — the reply latch has been armed
longer than a response plausibly takes to *begin*. The default is 2 s, which
covers cloud-STT finalisation, aggregation and `LLMFullResponseStartFrame`; no
model latency is inside that budget, because the frame that cancels the timer is
pushed before inference starts.

**`MUTED` is a fact, and costs no wire verb.** `UserMuteStartedFrame` and
`UserMuteStoppedFrame` are stock pipecat, the RTVI observer already forwards
them, and `PipecatClient` already raises `userMuteStarted`/`userMuteStopped`. So
"the agent has muted you" reaches the browser with the same authority as the
speech states above it, and the state machine says nothing about it. A claim
here would be the library inventing a second, lower-authority spelling of
something pipecat states directly.

### What is deliberately not inferred

**"The turn strategy is still holding the turn open."** This is the other half
of straining as originally specified, and it is perfectly visible from the
server's seat: `VADUserStoppedSpeakingFrame` arrives while the turn stays open,
which is the endpointer saying *they are not finished*. It is not implemented,
and the reason is a client limitation rather than a preference —
`@pipecat-ai/client-js` (1.13.0) exposes no VAD event at all, so the browser
reports the user as speaking for the entire hold and a claim raised there would
lose to `LISTENING` on rung 2 every time. A claim that can never win is not a
feature. If the client gains a VAD event, this becomes a two-line change on both
ends.

**Anything about what was said.** No state above reads text, sentiment, intent
or content. Every one of them is a statement about the *flow* of frames, which
is why they can be tested without running a call at all
(`py/tests/test_state_machine.py`), and why none of them can quietly become
client-side conversational inference.

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
| `UserStoppedSpeaking` | `setUserSpeaking(false)` and hold `LISTENING`; the server claims `THINKING` from this point. No acknowledgement is emitted. |
| `BotStartedSpeaking` | `SPEAKING`; it pre-empts and consumes any lower-priority server claim. |
| `BotStoppedSpeaking` | Stop any still-open viseme track immediately, then return to `LISTENING`. |
| `UserMuteStarted` / `UserMuteStopped` | `MUTED`, then back to `LISTENING`. The quiet under a mute never earns `IDLE`: the silence was imposed, and letting the timer run behind it would reveal a stepped-aside face the moment the microphone came back. |
| `Error` | `DEGRADED`, or `OFFLINE` when `data.fatal` is true. |
| `Disconnected` | `OFFLINE`. |
| `Connected` / `BotReady` | Clear a prior offline presentation and resume normal projection. |

## The resolved state does not leave the avatar

There is no presence callback and no `data-avatar-state`. The projection above
is what the avatar acts on, not something the host reads back — an avatar
renders its own state if it wants to, and the caller does not get to read the
avatar's internal state. Publishing that projection would make it a contract:
every implementation would owe these nine names with this precedence, which is
the second public contract [design-avatar-interface.md](design-avatar-interface.md)
exists to avoid.

A host that genuinely wants a status pill has the same `PipecatClient` and can
subscribe to it directly — with its own precedence, for its own chrome.
`RemoteAudioLevel` is not subscribed at all: remote gain may come from another
participant, so it never had state authority, and relaying it would be a
high-frequency subscription serving decoration.

`IDLE` is reached by a quiet timer — `idleDelayMs`, default 12 s
(`client/src/AvatarClient.ts`). It is an `AvatarClient` option, not a
`createAvatar` one: nothing on the public seam sets it, and nothing reads the
resulting state back. Shortening it to *watch* the transition means
constructing `AvatarClient` yourself, which is what the lab below does.

The server owns the three claims because the frames they are inferred from do
not all reach the browser: function-event reporting there is optional, and the
LLM response boundaries are not exposed at all. The client behavior library owns
how each one is *rendered* — `STRAINING` selects the renderer's straining pose,
`WORKING` its work program — and a renderer with no such pose may legitimately
draw either as ordinary listening. Tool-specific behaviour, DOM-aware gaze and
custom compound motion remain deferred until there is evidence for a stable
JavaScript extension API.

## Verification lab

Open [the Pipecat lifecycle lab](../authoring/pipecat-lifecycle-lab.html)
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

## What the backend does and does not send

The three commands and the promoted `action.id` list are
[contract-wire.md](contract-wire.md) — one copy, and it is that one. What
belongs here is the part that is about *lifecycle* rather than vocabulary:

**There is no `user` command.** Pipecat already emits VAD-derived user-speaking
events to the browser, so duplicating that fact over a second channel created
races and obscured ownership.

**`AvatarProcessor` deliberately does not mirror Pipecat lifecycle.** Its
`cues.ctx` is the stock base-TTS `context_id`; it does not make up a fallback.
Because browser speaking events carry no context, the client FIFO-binds the
next buffered `ctx` when `BotStartedSpeaking` arrives, anchors the cue clock
then, and closes it at `BotStoppedSpeaking`. It passes `AvatarControlFrame`
claims/actions through for explicit application intent.

**Actions are layered over the effective state** resolved by the Authority
model above, and finish their natural landing; they never create a durable
state or need an action-end message.

## Compatibility

This is a coordinated frontend/backend change. A newer client ignores unknown
avatar commands as before; deploy matching package versions together.
