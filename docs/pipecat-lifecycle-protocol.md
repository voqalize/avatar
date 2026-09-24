# Pipecat lifecycle protocol

## Authority model

The browser resolves one effective visual state. It is not the last wire
message received. Its precedence is fixed:

1. `SPEAKING` while Pipecat reports an active bot-output interval.
2. `LISTENING` while Pipecat reports user speech.
3. `OFFLINE` / `DEGRADED` when no observed speech pre-empts that presentation.
4. `MUTED` while Pipecat reports a mute strategy in place.
5. Server state `CANT_HEAR`.
6. Server state `THINKING`.
7. Server state `WORKING`.
8. Client `LISTENING`, then client-owned `IDLE` after `idleDelayMs` of quiet in
   an established Pipecat session (`packages/avatar/client/AvatarClient.ts`).
   It is an `AvatarClient` option, not a `createAvatar` one: nothing on the
   public seam sets it, and nothing reads the resulting state back. A newly mounted avatar begins available,
   never already "stepped aside".

Connection failure is lower than observed speech. A new user turn and Pipecat
bot output both retire any prior server state, so it cannot reappear stale
after speech.
The browser never uses microphone VAD to interrupt bot speech: while Pipecat
reports bot output, the avatar is speaking and its mouth is viseme-driven.

Rungs 5–7 are ranked here but not compared here. A server state is a single value and
only one is ever in flight, so the browser reads whichever one arrived; the
ordering is applied where several conditions genuinely hold at once, which is
the server (`AvatarStateMachine._resolve`). Ranking them a second time on the
client would be a duplicate ladder, and the two would drift.

## The silence problem

The speech rungs are easy. The bot is speaking, or the user is — Pipecat reports
both, the browser has them first-hand, and nothing here improves on that. Every
hard question is about the stretch when *neither* is speaking, which
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
| `CANT_HEAR` | the turn produced nothing to answer | an empty final transcript, or `AvatarProcessor`'s grace timer expiring | the next user turn, or any sign of a response |
| `THINKING` | a reply is outstanding | `UserStoppedSpeakingFrame`, `UserTurnInferenceCompletedFrame`, `LLMFullResponseStartFrame`, a tool's result | `BotStartedSpeakingFrame` |
| `WORKING` | a tool is running | `FunctionCallsStartedFrame` / `FunctionCallInProgressFrame` | the last call's result — or its cancel |

Each of those needs its reasoning stated, because in each case the obvious
implementation is wrong.

**`THINKING` starts at the end of the user's turn, not at the LLM's.** The
frame the heuristic wants is `LLMContextFrame` — input reached the model — and
it never arrives at the avatar's seat, because the LLM service consumes it. The
downstream-visible equivalent is `LLMFullResponseStartFrame`, pushed
immediately *before* the model is asked. But arming only there would leave the
transcription and aggregation latency in front of it uncovered, and that gap is
a second or more. So the wait opens when the user stops talking and closes when
Pipecat begins bot output, and `LLMFullResponseStartFrame` merely confirms it mid-flight
— which is also the fix for a real defect: that frame used to *clear* the state,
so the single longest silence in a call was the one stretch with nothing to
show.

**`WORKING` is below `THINKING`, and that is what makes it delicate.** Tool
calls happen *inside* an outstanding reply. If the `THINKING` latch stayed
armed across one, the lower rung could never win, and `WORKING` would be a state
no real pipeline ever reached. A tool call therefore suspends the reply latch,
and the tool's result resumes it. That is not a workaround for the ordering: a
model blocked on a tool result is not composing an answer. Read `THINKING` as
"waiting on the model for words" and the two stop overlapping.

**`CANT_HEAR` needs a clock, because there is no negative frame.** Nothing says
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
speech states above it, and the state machine says nothing about it. A server state
here would be the library inventing a second, lower-authority spelling of
something pipecat states directly.

### What is deliberately not inferred

**"The turn strategy is still holding the turn open."** This is the other half
of straining as originally specified, and it is perfectly visible from the
server's seat: `VADUserStoppedSpeakingFrame` arrives while the turn stays open,
which is the endpointer saying *they are not finished*. It is not implemented,
and the reason is a client limitation rather than a preference —
`@pipecat-ai/client-js` (1.13.0) exposes no VAD event at all, so the browser
reports the user as speaking for the entire hold and a state raised there would
lose to `LISTENING` on rung 2 every time. A candidate that can never win is not a
feature. If the client gains a VAD event, this becomes a two-line change on both
ends.

**Anything about what was said.** No state above reads text, sentiment, intent
or content. Every one of them is a statement about the *flow* of frames, which
is why they can be tested without running a call at all
(`packages/avatar-py/tests/test_state_machine.py`), and why none of them can quietly become
client-side conversational inference.

## Ownership

Pipecat's browser client is the authority for observable runtime facts. The
avatar server is the authority for correlated visemes and deliberate semantic
actions. The avatar renderer owns only physical polish: blending, blink,
breath, small eye motion and sustained posture.

```text
Pipecat JavaScript events  -> factual speech, connection posture, cue-clock anchor
avatar server-message      -> visemes, server states, and explicit actions
avatar renderer            -> composition; never an inferred acknowledgement
```

In particular, the renderer must never autonomously emit a nod, brow
acknowledgement, spoken continuer or empathy reaction. Those are always
explicit `action` messages sent by application/backend code.

## What the server owns, and why

The server owns the states it sends because the frames they are inferred from do
not all reach the browser: function-event reporting there is optional, and the
LLM response boundaries are not exposed at all. The client behavior library owns
how each one is *rendered* — `CANT_HEAR` selects this renderer's lean-in,
`WORKING` its work program — and a renderer with no such pose may legitimately
draw either as ordinary listening. Tool-specific behaviour, DOM-aware gaze and
custom compound motion remain deferred until there is evidence for a stable
JavaScript extension API.

## How the ladder is verified

`packages/avatar/test/AvatarClient.test.ts` drives the real `AvatarClient`
against a Pipecat-shaped fake, one `it` per rung. What a test cannot assert is
that the ladder is *right*, and that is read in the live call — Studio's `/`
against the demo server in the public checkout, where the same resolver runs on
real RTVI events. The invariant to watch there is the negative one: no
acknowledgement appears unless a server sent an `action`.

## What the backend does and does not send

The commands, and which `action.id`s every avatar owes a server, are
[contract-wire.md](contract-wire.md) — one copy, and it is that one. What
belongs here is the part that is about *lifecycle* rather than vocabulary:

**There is no `user` command.** Pipecat already emits VAD-derived user-speaking
events to the browser, so duplicating that fact over a second channel created
races and obscured ownership.

**`AvatarProcessor` deliberately does not mirror Pipecat lifecycle.** Its
`cues.ctx` is the stock base-TTS `context_id`; it does not make up a fallback.
Because browser speaking events carry no context, the client FIFO-binds the next
buffered one and anchors the cue clock itself. That binding and that anchor are
`packages/avatar/client/AvatarClient.ts`, which carries the measurements each
choice was made from; the FIFO holds only because `AvatarProcessor` never sends
a context the browser will not hear.

**Actions are layered over the effective state** resolved by the Authority
model above, and finish their natural landing; they never create a durable
state or need an action-end message.
