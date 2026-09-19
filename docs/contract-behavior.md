# Behavior contract

The behavior library composes a conforming rig into an avatar that appears
present in a conversation. It knows neither the server transport nor a
particular renderer.

## State

A **state** is a durable condition. Exactly one effective state exists at any
instant. It has an authority source, entry and exit conditions, and precedence
against other candidate states. It remains active until those facts change; it
does not complete on a timer.

Core states are `IDLE`, `LISTENING`, `CANT_HEAR`, `THINKING`, `WORKING`,
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

`CANT_HEAR` is the state that tested the rule, and the way it was settled is
worth keeping. It used to be called `STRAINING` — the avatar trying harder to
hear — and this renderer drew that as `CANT_HEAR`, a pose with a specific lean
and squint. Two names for one row, and the wrong one was on the wire: straining
is the *effort the pose depicts*, while not being able to hear is the situation
the caller is actually in. The wire redesign renamed the state to the situation,
which collapsed the row and with it the last non-identity entry in the behaviour
layer's mapping table — the table is a list of nine names now
(`packages/avatar/src/behavior.js`). The separation itself is unchanged and
still load-bearing: a renderer with nothing like a lean-in may draw `CANT_HEAR`
as ordinary listening and be correct. It simply no longer needs a second column
to say so.

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

The vocabulary is two, and `BEHAVIOR_ACTIONS` in `packages/avatar/src/behavior.js` is the one
copy: `ack` and `turn.interrupted`. Each maps to exactly one required wire id
([contract-wire.md](contract-wire.md) § Action) — the two lists are the same two
things spelled twice, once for a reader and once for a protocol, and
`WIRE_ACTION_TO_BEHAVIOR` is where they meet.

`ack` is the whole backchannel family in one id. A receipt, a continuer nod, a
realisation and an empathy beat are four *shapes* of acknowledging, and which
one a face makes is a rendering decision — the caller's job is to know that an
acknowledgement is due, not what it looks like. It used to be seven ids: two
were the receipt and the nod, which are that one intent spelled twice, and four
were `gesture.*`, which are things a particular body does rather than intents a
server may hold every face to.

The SVG renderer's own clip library is larger (`INTERNAL_CLIPS`), and a server
that knows this renderer is mounted may name any of the part of it that is
published (`ACTION_IDS`). What it may not do is expect another avatar to answer
— which is exactly the line between the two required ids and an open name
([internal-mixer.md](internal-mixer.md) § Actions).

**A renderer publishes its own motions, and a server may ask for one by name** —
the same `action` command, whose id is open
([contract-wire.md](contract-wire.md) § Action). Such a name carries no behavior
id, and that asymmetry is the point: `BEHAVIOR_ACTIONS` exists to name an intent
independently of how any one face renders it, while a renderer's own name *is*
the rendering. It can only add, never redefine a required id, and a face that
lacks the name ignores the message. The first table of them is the Blender
avatars' three research-shaped nod types and a head shake, which are three
things to say where `ack` is one.

**A renderer may also re-shape one of the two** — never change what it means.
The shared clips are authored in pose units that mean pixels on a line face, and
the same keys drove tara's head through 15°, three times a continuer. So the
Blender avatars answer `ack` with their own continuer
(`BLENDER_ACTIONS` in `packages/avatar/client/three/sequences.ts`). The intent is the
contract; how big a nod has to be to read as that intent belongs to the body.

## Effective-state precedence

Exactly one state is effective at any instant, and it is not the last message
received. The ladder — which authority wins over which — is
[pipecat-lifecycle-protocol.md § Authority model](pipecat-lifecycle-protocol.md),
and that is the only copy.

The invariant it exists to protect: **if bot audio is playing, `SPEAKING` wins
and the mouth must articulate.** A state the server sends is a lower-priority
candidate, never an effective-state command.
