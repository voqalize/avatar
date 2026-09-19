# Wire contract

This is the narrow server profile over the broader behavior library. It is the
only custom avatar traffic sent as a Pipecat RTVI `serverMessage`.

```json
{ "type": "avatar", "cmd": "state", "state": "WORKING" }
{ "type": "avatar", "cmd": "action", "id": "ACKNOWLEDGE" }
{ "type": "avatar", "cmd": "action", "id": "NOD_REALIZE" }
{ "type": "avatar", "cmd": "cues", "ctx": "tts-context", "from_ms": 0, "cues": [] }
```

Pipecat JavaScript events are factual client inputs: bot/user speaking,
connection, and failure. The server sends only lower-priority durable states,
deliberate semantic actions, and TTS-context-correlated Rhubarb cues.

**Three commands, and that is the whole protocol.**

| Command | Values | Meaning |
|---|---|---|
| `state` | `CANT_HEAR`, `THINKING`, `WORKING`, `null` | Candidate durable state; `null` clears it. |
| `action` | any uppercase CATEGORY_INTENT name | Start one self-completing motion. Two names are required of every avatar; the rest belong to the mounted one, and an unknown one is ignored. |
| `cues` | `ctx`, `from_ms`, `cues`, `final?` | Correlated viseme splice. |

Two spellings are accepted and translated at the client's parse boundary, for a
server older than the redesign: `cmd: "claim"` for `state`, and `STRAINING` for
`CANT_HEAR`. Neither appears above that boundary, and both come out when the
last server that sends them has shipped.

## State

Nine states exist and the server may send three of them. The other six —
`SPEAKING`, `LISTENING`, `IDLE`, `MUTED`, `OFFLINE`, `DEGRADED` — are facts the
browser already holds from Pipecat's own events and its own clock, and a server
spelling of a fact would be a second, lower-authority copy of it. So the three
here are exactly the ones nothing in the browser can see: the agent is waiting
on a model, running a tool, or has stopped waiting for a reply.

A state is a *candidate*. Observed playout wins, always
([pipecat-lifecycle-protocol.md § Authority model](pipecat-lifecycle-protocol.md)).

## Action

An action is one finite, self-completing motion: physically uninterruptible,
queued behind a conflicting one, and never the owner of the mouth while Pipecat
says bot audio is playing.

**The id is open.** Two names are required of every renderer, because they are
the two things a server can know without knowing what is mounted:

```text
ACKNOWLEDGE           the whole backchannel family in one word
RESPONSE_INTERRUPTED  it was speaking and the user took the turn back
```

Everything else is a name out of the mounted avatar's own catalogue, and **an
unknown id is ignored**. That is the same forward-compatibility rule an unknown
`cmd` gets, reached from the other direction — there a newer server meets an
older widget, here any server meets a face that cannot do the thing. Both are
expected, and neither is worth breaking a call over. There is deliberately no
fallback: an action sits on top of a state, so nothing is missing when one is
dropped. A server that does not know what is mounted sends one of the two and is
never wrong.

**`ACKNOWLEDGE` is one word for four shapes on purpose.** A receipt, a continuer
nod, a realisation and an empathy beat are four ways of acknowledging, and which
one a face makes is a rendering decision the server is not holding the drawing
for. The bundled SVG renderer resolves it on the floor: a nod while the user is
still talking is a continuer, *go on*; once they have stopped it is a receipt.
The server's job is to know that an acknowledgement is due.

This replaced a closed seven-id vocabulary plus a second command, `sequence`,
for a renderer's own motions. The split cost a promotion ritual for every new
portable intent and still could not say what the closed set was for: the
listening research separates a continuer nod from an assessment nod from a
realisation — three different things to say — and all three were the one id
`ACK_NOD` spelled. Now the server says *when* and the avatar owns the variety.

A driving UI has the one problem this costs: a button cannot tell a face that
has no such motion from one that did nothing. So an avatar module may *declare*
what it answers to, in an optional `supports` export that nothing on this wire
reads ([design-avatar-interface.md](design-avatar-interface.md) § The one
optional export).

One rule keeps it safe to leave open: **a name can only add.** A required id
wins a collision, so no avatar can quietly change what `ACKNOWLEDGE` means. A
renderer may re-shape a required action for its own body — tara's is a smaller
nod than a line face's — but that is the same intent rendered, never a new
meaning. The Blender avatars' catalogue is
`packages/avatar/client/three/sequences.ts`: `NOD_SMALL`, `NOD_ASSESS`, `NOD_REALIZE`
and `NOD_NO`, which are three things to say where one id was one. It is a
renderer's catalogue and this document does not enumerate it — that is the point
of the id being open.

## Cue timeline

`cues` is a patch to an utterance timeline, never a "play this now" command.
Each cue is `{t, v, i?, p?}`: `t` is milliseconds from the turn's first TTS
audio sample, `v` is a Rhubarb A–H/X mouth shape, optional `i` is intensity and
optional `p` is the phone under the shape. `from_ms` uses the same coordinate
system and means: discard the canonical track at and after that offset, then
append `cues`. That is the whole fast-to-accurate correction primitive; arrival
time has no meaning.

`i` is 0..1 loudness, measured from the RMS of the audio under the cue, so it is
absent on the predicted leg — which describes audio nobody has generated yet —
and a missing `i` reads as full. It exists because the same shape shouted and
murmured must not look identical.

`p` is what the backend's recogniser was labelling that stretch of speech, and
it is absent wherever nothing is being articulated: during silence, and on the
`X` shape generally. `v` is a nine-way projection of roughly forty such labels
and the loss is not spread evenly — `B` alone absorbs fourteen of them, from a
sibilant to a dental fricative to a nasal — so a face with a mouth for "tongue
between the teeth" cannot ask for it from `v` and can from `p`. It is sent
because both backend legs already hold a phone timeline and used to throw it
away at the boundary; carrying it costs nothing per cue and the client is free
to drop it, which every renderer here does today.

**`p` is not a closed set.** It is the label vocabulary of whatever produced the
cue, which for `voqalize-avatar` is Arpabet without stress digits, plus `Schwa`
for a reduced vowel and four non-speech labels the recogniser reserves for
breath, cough, smack and noise. A client must treat it as an opaque name: match
the ones it has a mouth for, ignore the rest, and never fail on one it has not
seen. Enumerating the set in this contract would make it the thing that has to
be released before a better recogniser could say a new word, which is the same
forward-compatibility rule an unknown `cmd` follows.

`ctx` is Pipecat's opaque TTS `context_id`. Since Pipecat's browser speaking
events do not carry a context, the client buffers contexts FIFO. So the server
sends a context's first patch only once that context's first audio sample has
passed it: the text-predicted track exists sooner, but a context interrupted
before any of its audio plays must never enter the queue, or every later reply
plays the cues of the one before it. Patches still arrive ahead of that audio,
and so ahead of `BotStartedSpeaking`. At
`BotStartedSpeaking` it claims the next one and starts sampling the
already-buffered track. Timeline position zero is the first sample of the TTS
audio — lead-in included — and the client places it where the bot's audio
track, as the browser receives it, leaves digital silence. When that cannot be
heard it falls back to the `BotStartedSpeaking` event itself. Neither is the
audio device's playout clock, which the public `PipecatClient` seam does not
expose.

`final: true` means no more cue patches will be generated for this context. It
does not mean the audio has finished; `BotStoppedSpeaking` remains the hard
mouth stop. An interrupted context deliberately never claims to be final.

## Retirement

A server state is retired by a new user turn, Pipecat bot output, or an explicit
`null`; it must not return after a factual boundary.

Only one is in flight at a time — a later one replaces the earlier — so the
three names carry no ordering on this wire. Which condition wins when several
hold at once is decided before a message is sent
([pipecat-lifecycle-protocol.md § The silence problem](pipecat-lifecycle-protocol.md)).
