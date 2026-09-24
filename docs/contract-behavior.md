# Behavior contract

The behavior library composes a conforming rig into an avatar that appears
present in a conversation. It knows neither the server transport nor a
particular renderer.

`BEHAVIOR_STATE_IDS` and `BEHAVIOR_ACTIONS` in
`packages/avatar/src/behavior.js` are the one copy of each vocabulary. Where a
state comes from and what outranks what is
[pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md) — also one copy,
and it is that one.

## State

A **state** is a durable condition. Exactly one effective state exists at any
instant. It has an authority source, entry and exit conditions, and precedence
against other candidate states. It remains active until those facts change; it
does not complete on a timer.

**A state names what is happening, never how to draw it.** `WORKING` is the
canonical case: our SVG rig renders it as typing at a screen, another avatar
may render it as anything at all, and the word on the wire stays `WORKING`
either way. It used to arrive at the renderer as `TYPING` — one rendering's
name promoted to a behaviour's — which is the shape of the mistake even when
the picture is right. Choosing among several work activities is a renderer's
business, and lives there.

## Action

An **action** is a finite physical sequence. It has a start, bounded timeline,
and completes on its own. Actions do not establish durable state and require no
end message.

Actions are physically uninterruptible: a hand does not disappear and a head
does not snap back when an underlying state changes. They queue behind an
already active action where physical parts conflict. State changes continue to
resolve underneath them.

This does not override mouth safety. Pipecat's bot-output interval owns
articulation. An action during bot speech contributes compatible
head/body/hand channels but not a competing mouth shape. `turn.interrupted`
waits for that interval to stop, then its held mouth can communicate the cut.
