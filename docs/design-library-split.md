# Design — why this is a library

*Written 2026-08-07, when the avatar stopped being one product's animation and
became a component with more than one consumer. The binding vocabulary is
unchanged: [contract-wire.md](contract-wire.md) and
[contract-behavior.md](contract-behavior.md) still govern.*

The avatar began as the talking head for a single voice-agent product, and the
backend half of it — the pipecat processor, the state machine, the wire, the
viseme engine — was built inside that product's repository. Then a second
application wanted the same face. The two applications run different pipecat
versions, different LLM services, different frontends and different deploy
pipelines, and neither could adopt the other's copy. Everything below follows
from that.

The failure mode to avoid was already visible before the split: the second
consumer had a byte-for-byte copy of the widget vendored into its frontend,
kept in step by a sync script, and it was four commits stale — no `myna`, no
body motion, no `line-art.js`. A sync script is a duplication with a cron job
attached. **The standing constraint on this work was: do not duplicate the
backend.**

## Decisions

### 1. This repo is the library. Everything moves here.

This repo already owned the two binding contracts, the three rigs and the whole
visual-verification apparatus. The backend halves came to the contracts, not
the other way round. Each consumer keeps its own deploy plumbing — that is the
application's, not the library's.

### 2. Two published packages, one of them platform-specific

| artifact | registry | contents | deps |
|---|---|---|---|
| `@voqalize/avatar` | npm | `createAvatar` (`.`), `<Avatar>` (`./react`), the mixer (`./internal`), one face each (`./faces/*`) | optional peers: react, `@pipecat-ai/client-js` |
| `voqalize-avatar` | pypi | processor, state machine, wire, viseme engine, `avatarsync` runtime | `pipecat-ai>=1.4,<2` |
| `native/avatarsync` | *inside the pypi wheel* | the C++ fork, its build, the model tree | — |
| — | — | `docs/` contracts, binding for all of them | — |

**One npm package, and the subpaths have to earn their place.** It shipped as
three — the bare widget, the dispatcher, the React binding — and 0.2 collapsed
them to one, because both consumers render a call tile in React and three public
surfaces to keep stable across versions is a cost paid for a host that did not
exist. 0.3 restored the ones a real consumer asked for and no more:
`.` (`createAvatar`), `./react`, `./internal` for the mixer, and one subpath per
face so a host bundles the drawing it uses rather than all three.
[design-avatar-interface.md](design-avatar-interface.md) is the current map;
[removed.md](removed.md) § The `/pipecat` and `/react` subpaths records the
collapse and what came back.

**The entry-point count is the surface count.** `.` is the only one under a
semver promise; `./internal` explicitly is not
([internal-mixer.md](internal-mixer.md)). Adding a subpath is adding something
this project has to keep working, which is why it takes a consumer asking.

*Optional peers have to be optional in fact, not just in the manifest.* One
runtime `import` of a peer makes the whole entry point fail to load without it
installed — even for a host that never calls the function that needs it.
`AvatarClient` imports its pipecat types type-only and spells the one event name
it subscribes to as a local literal for exactly this reason, with a test pinning
it against the real enum. The check that catches the regression is packing the
tarball and importing it from a clean project; CI does it on every push.

**One pypi package, and the library is inside it.** The whole lipsync stack is
stdlib plus a ctypes call into our own shared library, with *zero*
avatar-specific Python dependencies, so a second wheel for the native half would
buy a dependency edge nobody needs and a second version to keep in step. The 2 MB
library and the 56 MB acoustic model therefore ride in the wheel itself, which makes it platform-specific and ~44 MB
and makes `pip install voqalize-avatar` the entire installation procedure.

This was briefly the other way round — the artifact shipped separately and the
application passed its location — on the reasoning that consumers already ship
large artifacts, so a `COPY` into an image was no new burden. That reasoning
looks at the wrong party. It is true of the *first* consumer, who is also the
author and already has the build; it is false of everyone after, for whom it is
an undocumented second install step whose omission produces no error, just an
avatar that never quite moves its mouth right. A library whose headline feature
is off by default until you find the README has misplaced its default. The
constraint that actually settled it: **mouth sync is the headline feature**, and
a distribution choice that leaves it dark in the common case is a regression in
the thing this project is for, whatever it saves elsewhere.

The cost is honest and small — a 44 MB wheel, a build per platform instead of
one ([RELEASING.md](../RELEASING.md) § The PyPI side is four artifacts, which
owns the tags),
and no wheel at all for platforms outside the matrix. The last of those is
survivable precisely because of the property below: an install with no binary is
an ordinary condition, not a failure.

**Bundling does not mean guessing.** The payload lives at a fixed place inside
the package (`voqalize_avatar/_native/`), which is a *known* location, not a
discovered one — no search path, no filesystem walk, no environment. And the
wheel tag is derived from the compiled binary rather than declared beside it, so
the claim "this runs here" is made by the artifact and not by a human editing a
matrix.

**Where an override does exist, it is an argument, never an environment
variable.** The bundle covers the common case; a deploy that unpacks the
artifact itself passes `avatarsync=<dir>`. That was briefly the *only* way in,
and briefly before that it was environment variables (`AVATARSYNC_HOME`,
`AVATARSYNC_BIN`, `AVATARSYNC_RES`, `AVATARSYNC_PROCS`), which was wrong for the
reason all library-level env reading is wrong: it is a hidden input. The caller
cannot see it in the call, two engines in one interpreter cannot disagree about
it, a test cannot set it
without mutating global state the next test inherits, and when it is missing the
failure is silence — a session that quietly runs without lipsync — rather than a
`TypeError` at the seam. Configuration that reaches a library through the
process environment has skipped the API, which is the one place its meaning is
documented and checked. Reading the environment is an *application's* job;
`voqalize-avatar` does none of it.

**The viseme leg stays optional at runtime, and that survived bundling — but
the two APIs disagree about it on purpose.** `build_viseme_engine()` is the
internal API and it behaves like a library: a missing binary raises, naming the
path it looked at, because a caller who asked for a viseme engine and silently
did not get one has been lied to. `AvatarProcessor` is the pipecat wrapper, and
the wrapper catches: a missing aligner is logged loudly once and the session runs
state-channel-only. That path is not dead code — it is what an sdist install
gets, and what a platform outside the wheel matrix gets. The degradation is
bounded and it is exactly one thing: the face still listens, thinks, claims the
floor and yields it; its mouth does not move while it speaks.

### 3. Distribution: public registries, permissive licence

The repo is **public at `voqalize/avatar` under MIT**, and both halves publish
to public registries: `@voqalize/avatar` on npm, `voqalize-avatar` on PyPI.

It opened at AGPL-3.0-only, on the reasoning that Voqalize holds all the
copyright and so relicensing permissively later would be a decision rather than
a project, while the reverse would not. That is what happened. Worth keeping the
asymmetry in view now that it has been spent: **the move was one-way.** A
version already published under MIT stays MIT for whoever fetched it, so a
future tightening would bind only new code, and every consumer this repo picks
up in the meantime is one it cannot un-permit.

Public registries were also the cheapest answer operationally. The alternative
considered was private git dependencies for both halves, and its own strongest
counter-argument was credentials: a Docker build that installs from PyPI needs
no `--mount=type=ssh`, no build token and no private registry. Publishing
removes the whole class.

**Names.** npm has scopes, so the scope *is* the namespace: one package,
`@voqalize/avatar`. PyPI has no scopes, so the
conventional stand-in is a hyphenated prefix — `voqalize-avatar`, importing as
`voqalize_avatar`, which is what the code already said. Both were free.
Rejected: `pipecat-avatar` (reads as an official pipecat package, and pipecat
ships its avatar integrations as extras of `pipecat-ai` itself rather than as
separate distributions, so there is no third-party convention to join) and
`voqalize-avatar-pipecat` (the dependency is already declared in metadata, and
the suffix forecloses a non-pipecat backend).

**One version, one tag, both packages.** They are two ends of one wire format,
so a version pair that can drift is a protocol mismatch waiting to be debugged
in production. `.github/workflows/release.yml` refuses to publish either half
if the tag disagrees with either manifest, and publishes both or neither.
Neither registry holds a long-lived credential — both accept an OIDC token
minted for this repository running this workflow. Setup and the token fallback
are in `RELEASING.md`.

The native aligner is not a package of its own either — it ships inside the
pypi wheel; see the `native/avatarsync` note in decision 2.

### 4. Two tiers of state, and the seam between them

This is the core of the design and the thing the library exists to get right.

**Tier 1 — base presence, from stock pipecat frames, zero backend awareness.**
Drop `AvatarProcessor` into a pipeline between TTS and the output transport and
the face is present: that is the promise, and it is what makes the library
adoptable.

What the backend actually puts on the wire is narrower than "the states",
because the states are not the backend's to send. The processor reads only
frames any pipecat pipeline produces and emits three commands —
`claim` (`THINKING`, `WORKING`, or cleared), `action`, and `cues` off
`TTSAudioRawFrame` ([contract-wire.md](contract-wire.md), the one copy).
Everything else the presence state depends on — is the bot speaking, is the user
speaking, is the transport up — the client already has from `PipecatClient`'s
own events, and reads there rather than being told. Claims are *candidates*
underneath those facts; the precedence ladder that resolves them lives once, in
`client/src/AvatarClient.ts`
([pipecat-lifecycle-protocol.md](pipecat-lifecycle-protocol.md)). The behavior
vocabulary those two inputs resolve to is exactly seven names, and
[contract-behavior.md](contract-behavior.md) owns the list.

The pin is `pipecat-ai >= 1.4, < 2`, and it is an honest one: every frame the
processor reads exists in 1.4.0, including the karaoke path
(`AggregatedTextFrame.will_be_spoken`, `AggregatedTextProgressFrame`) that both
viseme legs are driven from, `UserTurnInferenceCompletedFrame` and
`RTVIServerMessageFrame`. CI runs the suite at the declared floor as well as at
the resolved version, so "we support 1.4" is a claim a test checks.

**Tier 2 — composite intent, which needs to know what the application is
doing.** Is it reading the screen, is it typing into a chat, did it not hear
that, does it want in. No amount of frame-watching infers these correctly, and a
library that guessed would nod at the wrong moment.

Where 0.3 landed is narrower than this section originally promised, and
deliberately: the composite *render* states are no longer wire vocabulary at
all. `AvatarControlFrame` carries an `AvatarMessage`, so a seam can say
`WORKING`, or send one of the seven actions, and that is the whole of it. The
richer poses (`REVIEWING_SCREEN`, `SEARCHING_SCREEN`, `CANT_HEAR`,
`TYPING_CHAT`, `DISTRACTED`, `WANTS_IN`, …) are still real, still authored, and
still reachable — through `avatar.setState` on the mixer, which is `./internal`
and whose state list has exactly one copy, `STATES` in `src/avatar.js`. A host
that wants one drives the mixer for it. That keeps the contract small enough to
be worth calling a contract, and it puts the pass-throughs where their cost is
visible ([removed.md](removed.md) § The behavior-state aliases).

The motivating case is concrete and not hypothetical: an LLM service that runs
its tools *out of process* pushes `LLMFullResponseStartFrame` but never pushes
`FunctionCallsStartedFrame`, because the pipeline never sees the calls. Such an
application gets every base state for free and gets nothing tool-driven until
it says so itself. That is not a gap to paper over — it is what the seams are
for.

**Seam one: a library-defined frame.**

```python
@dataclass
class AvatarControlFrame(DataFrame):
    """An explicit avatar instruction from the application's own pipeline."""
    message: AvatarMessage        # the same builders the state machine uses
```

The convention, per the brief for this work: **write your own FrameProcessor
and push `AvatarControlFrame` for the states you care about.**

**Seam two: subclass the state machine.** Every frame in the pipeline traverses
`AvatarProcessor`, which hands each one to `AvatarStateMachine.on_frame`. An
application whose own frames are simply *its spelling* of something the library
already models can subclass, intercept those frames, and call `super().on_frame`
for everything else. That is one pipeline seat instead of two.

The subclass is named on the processor as a class attribute
(`STATE_MACHINE = MyStateMachine`), not passed in: the front door takes no
arguments and must keep taking none. And the state machine is not exported from
the package barrel — so this seam costs an import from
`voqalize_avatar.state_machine` as well, which is the honest signal that it is
the second-resort door and not the front one.

Use whichever seam fits: a control frame when the signal originates somewhere
else in the pipeline (or in application code that can push a frame), a subclass
when the application's frames are its own spelling of what the state machine
already models.

**Conflicts are deferred, deliberately.** An explicit control frame simply wins
and is applied in arrival order alongside the heuristics; there is no priority
lattice, no TTL, no ownership tracking. That is YAGNI until a third consumer
produces a real collision, and the brief says so.

**Tool calls show `THINKING`, and only that.** A `tool_states` map that pointed
`search_web` at `SEARCHING_SCREEN` was tried and removed ([removed.md](removed.md)
§ `tool_states`): it is a constructor argument on the one class that is supposed
to take none, it only works for an LLM that runs its tools in-process, and an
application that knows its tool is searching can say so in one
`AvatarControlFrame`. What stays is the bookkeeping
nobody should write twice — call ids are deduped and parallel calls are held, so
a turn with three tools shows one settled `THINKING` rather than a flicker.

### 5. The reorganization stops above the waist

Nothing in this work touches the drawings, the pose channels or the mixer's
motion. If a face module or `src/params.js` changes because the packaging
changed, something has gone wrong — the waist is exactly where this should not
reach, and it held: `src/` is still dependency-free ES modules with no build
step.

Above the waist it did change, and the direction was inward. The public seam is
now `createAvatar({mount, client}) -> {destroy()}` — no `setState`, no `action`,
no `speak`, no readback. Those verbs still exist on the mixer, which is
`./internal` and carries no semver promise. The reasoning is decision 4's: an
imperative surface on the public package is an invitation for the client to
decide what the agent is doing, and the client does not get to decide.
[design-avatar-interface.md](design-avatar-interface.md) is the seam;
[removed.md](removed.md) lists each verb that left and how to reach it.

### 6. React is a peer at `>=18`, not a dependency at 19

The two consumers were on different major versions of React, and a binding
pinned to one of them would have been vendored by the other — which is the
problem this whole exercise exists to end. `react`, `react-dom` and
`@pipecat-ai/client-js` are all declared **optional** peers — `react-dom` and
the pipecat client because nothing imports them at runtime, `react` because a
host reaching past the export map for the raw widget genuinely does not need it.

## Layout

`src/` stayed exactly where it was. Moving it would break every rig page and
every headless tool for no gain a consumer can see, and the widget is this
repo's primary artifact — it has earned the short path. Everything else is a
sibling, and each sibling answers one question:

```
src/                    the mixer, the rig, the faces — reached through
                        ./internal and ./faces/*, never by deep path
  *.d.ts                its types, hand-maintained next to the code
client/                 AvatarClient (splice, clock anchor) + React binding
                        -> @voqalize/avatar, whose public export is createAvatar
py/                     voqalize-avatar: pyproject + src/voqalize_avatar/ + tests
native/avatarsync/      the rhubarb fork: patch, capi.cpp, build.sh, libavatarsync.*
docs/                   the contracts, binding for both packages
  removed.md            what 0.2 and 0.3 cut from the surface, and how to undo it
package.json            @voqalize/avatar and its export map
studio/                 Avatar Studio — the IDE for the published options
server/                  one pipecat process, canned services, zero API keys
                        — the only place lipsync is verified
authoring/              the workshop: rig pages, clip fixtures, serve.py
  tools/                headless render / screenshot / diff / motion
experiments/            server-side spikes; ships nowhere near the widget
```

`studio/` is the second compiled tree and the second exception to "no build
step" (`client/` is the first). Nothing in `src/` may depend on either — what
you screenshot in a rig page is what ships.

`py/scripts/measure_durations.py` speaks the duration corpus through vql-speech
and `py/scripts/fit_durations.py` fits the two constants in `durations.py` from
what came back — measure, then fit, then paste. Both live beside the corpus they
read, `py/tests/fixtures/duration_corpus.json`.

`client/` is compiled with plain `tsc` — no bundler, no tsup. The emitted
modules keep their relative import of `../../src/avatar.js`, which from
`client/dist/` resolves to the package's own `src/`, so there is exactly one
copy of the widget in a consumer's graph. A bundler would have inlined a second
one into the React binding, which is how a "widget updated but the React tile
didn't" bug gets built.

`files` lists `client/dist` explicitly rather than relying on the `client`
directory, because `client/dist` is gitignored and npm applies `.gitignore`
*within* a `files` entry — an explicitly named path is the documented way to
win that argument. `npm pack` is the check: all three faces, both contracts.

## What the split cost, and what it left behind

The first cutover moved ~3,570 lines out of the consumer and put 90 back. The
consumer's pipeline file changed by six lines. Its frontend package went from a
vendored widget plus its own dispatcher to a ~30-line preset of one `accept`
predicate. Everything stayed green on both sides.

Two things worth recording because they will recur:

**A `link:`-shaped trap.** While a consumer points at a sibling checkout rather
than a published version, the linked package brings its own `node_modules` —
and this repo's `@pipecat-ai/client-js` shadowed the consumer's, producing a
`PipecatClient` type mismatch. Pinning to the consumer's exact version is the
workaround; a registry install publishes no `node_modules` and the peer
resolves from the consumer, so the pin widens again the moment the dependency
becomes an ordinary version.

**No transport change is needed to adopt this.** The obvious-looking move —
turning on `video_out_enabled` in the transport params — is the integration
path for server-side video avatars, and it is the wrong one here. This avatar
is a JS widget rendering in the browser from data-channel messages; there is no
video track, and that is the entire point of it being cheap. The client seam is
wherever the app renders the bot's tile today.
