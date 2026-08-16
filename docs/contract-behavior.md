# Behavior contract

The behavior library composes a conforming rig into an avatar that appears
present in a conversation. It knows neither the server transport nor a
particular renderer.

## State

A **state** is a durable condition. Exactly one effective state exists at any
instant. It has an authority source, entry and exit conditions, and precedence
against other candidate states. It remains active until those facts change; it
does not complete on a timer.

Core states are `IDLE`, `LISTENING`, `STRAINING`, `THINKING`, `WORKING`,
`MUTED`, `SPEAKING`, `DEGRADED`, and `OFFLINE`. These nine are the whole
vocabulary an avatar implementation receives; a state supplies sustained pose,
gaze policy, and an idle/liveness profile. Where each one comes from and what
outranks what is
[pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md) — one copy, and
it is that one.

**A state names what is happening, never how to draw it.** `WORKING` is the
canonical case: our SVG rig renders it as typing at a screen, another avatar
may render it as anything at all, and the word on the wire stays `WORKING`
either way. It used to arrive at the renderer as `TYPING` — one rendering's
name promoted to a behaviour's — which is the shape of the mistake even when
the picture is right. Choosing among several work activities is a renderer's
business, and lives there.

`STRAINING` is the first state where that separation does real work rather than
being merely respected: it says the avatar is trying harder to hear, and this
renderer draws that as `CANT_HEAR`, a pose with a specific lean and squint. A
renderer with nothing of the sort may point it at ordinary listening and be
correct.

## Action

An **action** is a finite physical sequence. It has a start, bounded timeline,
and completes on its own. Actions do not establish durable state and require no
end message.

Actions are physically uninterruptible: a hand does not disappear and a head
does not snap back when an underlying state changes. They queue behind an
already active action where physical parts conflict. State changes continue to
resolve underneath them.

This does not override mouth safety. Observed bot playout owns articulation.
An action during bot speech contributes compatible head/body/hand channels but
not a competing mouth shape. `turn.interrupted` waits for bot playout to stop,
then its held mouth can communicate the cut.

The vocabulary is seven, and `BEHAVIOR_ACTIONS` in `packages/avatar/src/behavior.js` is the one
copy: `ack.receive`, `ack.nod`, `turn.interrupted`, `gesture.greet`,
`gesture.farewell`, `gesture.approve`, `gesture.wait`. Each maps to exactly one
promoted wire id ([contract-wire.md](contract-wire.md)) — the two lists are the
same seven things spelled twice, once for a reader and once for a protocol, and
`WIRE_ACTION_TO_BEHAVIOR` is where they meet.

The SVG renderer's own clip library is larger (`INTERNAL_CLIPS`), and that is
not a broader profile waiting to be exposed: promoting a clip to an action is a
decision about what a *server* may ask for, and it costs an edit in three
places on purpose ([internal-mixer.md](internal-mixer.md) § Actions).

## Effective-state precedence

Exactly one state is effective at any instant, and it is not the last message
received. The ladder — which authority wins over which — is
[pipecat-lifecycle-protocol.md § Authority model](pipecat-lifecycle-protocol.md),
and that is the only copy.

The invariant it exists to protect: **if bot audio is playing, `SPEAKING` wins
and the mouth must articulate.** Server claims are lower-priority candidates,
never effective-state commands.
