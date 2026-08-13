# Behavior contract

The behavior library composes a conforming rig into an avatar that appears
present in a conversation. It knows neither the server transport nor a
particular renderer.

## State

A **state** is a durable condition. Exactly one effective state exists at any
instant. It has an authority source, entry and exit conditions, and precedence
against other candidate states. It remains active until those facts change; it
does not complete on a timer.

Core states are `IDLE`, `LISTENING`, `THINKING`, `WORKING`, `SPEAKING`,
`DEGRADED`, and `OFFLINE`. These seven are the whole vocabulary an avatar
implementation receives; a state supplies sustained pose, gaze policy, and an
idle/liveness profile.

**A state names what is happening, never how to draw it.** `WORKING` is the
canonical case: our SVG rig renders it as typing at a screen, another avatar
may render it as anything at all, and the word on the wire stays `WORKING`
either way. It used to arrive at the renderer as `TYPING` — one rendering's
name promoted to a behaviour's — which is the shape of the mistake even when
the picture is right. Choosing among several work activities is a renderer's
business, and lives there ([removed.md](removed.md) § State programs).

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

Examples: `ack.continue`, `ack.receive`, `ack.realize`, `ack.empathy`,
`ack.nod`, `turn.interrupted`, `gesture.greet`, `gesture.farewell`,
`gesture.approve`, and `gesture.wait`. These are library vocabulary and may be
broader than the current server profile.

## Effective-state precedence

```text
SPEAKING       observed Pipecat bot playout
LISTENING      observed Pipecat user speech
OFFLINE        fatal/disconnected presentation when no speech pre-empts it
DEGRADED       recoverable failure presentation when no speech pre-empts it
WORKING        active server claim
THINKING       active server claim
IDLE           client quiet-time fallback
```

Bot playout is the hard invariant: if audio is playing, `SPEAKING` wins and the
mouth must articulate. Server claims are lower-priority candidates, not
effective-state commands.
