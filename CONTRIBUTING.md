# Contributing

**Code contributions are Python: `packages/avatar-py/` and `apps/server/`.** For
everything else — the browser library, the documents, the characters — a bug
report with a reproduction is the contribution we can act on, and we do act on
them.

That is a narrower door than most repositories have, and it is narrow for a
reason that is worth stating plainly rather than leaving you to infer from a
closed pull request.

## Why

This repository is the release path for a library that is developed elsewhere.

From 0.4.0, `packages/avatar/` and `docs/` arrive here as **one synthesised
commit per release**, cut from a private working tree by a tool that copies an
explicit list of paths; the commit carries an `Exported-From:` trailer naming the
revision it came from ([RELEASING.md](RELEASING.md)). They are a build output. A
change made to them here is not merged into anything — the next release
overwrites it, no test notices, and the person who wrote it finds out months
later. Refusing that change is kinder than accepting it.

The private tree exists because of one directory that is not in it: the Blender
pipeline that compiles a 2.5-D character — the geometry, the projection of a
reference image onto it, the expression maps — is the part of this project we are
not publishing. What it produces *is* published, as `packages/avatar/assets/*.glb`
under CC-BY 4.0, and as the Three.js renderer that draws them. So the characters
are yours to use and to attribute; the machine that made them is not open. We
would rather say that than ship a repository that looks complete and is not.

The Python half has no such hole. `voqalize-avatar` is the whole of the pipecat
backend — state inference from stock frames, both viseme legs, the `avatarsync`
aligner — and it is developed here, in the open, with its own tests and its own
release tag. `apps/server/` is likewise the whole demo call: one pipecat process,
canned LLM and TTS behind the real interfaces, **zero API keys**. Those are the
two trees where a pull request changes what ships.

## The wire is the seam you can build against without us

Neither half is a dependency of the other. They are two ends of one wire format
([docs/contract-wire.md](docs/contract-wire.md)) — `state`, `action` and
`cues`, no version field — so you can replace either end entirely and keep the other:

- **Your own backend.** Any server that emits `state`, `action` and `cues` drives
  every avatar in the package, including the 2.5-D characters. The ways to
  produce cues, best first, are in the README under *Not using our backend?*.
- **Your own avatar.** `createAvatar({mount, client}) -> {destroy()}` is the only
  public seam ([docs/design-avatar-interface.md](docs/design-avatar-interface.md)).
  Publish a module that exports it and it is a first-class avatar — there is no
  registry to be added to and nothing to ask us for. This is the supported way to
  ship a face we did not draw, and it is deliberately not a fork.

A change to the wire itself is a design conversation before it is a patch. Open
an issue; the contract document is the thing being edited, and it binds both
packages and every consumer.

## Working on the Python

```sh
cd packages/avatar-py
uv run pytest                    # against the real aligner, not a stub
```

The aligner is a native library and is compiled, not committed:
`packages/avatar-py/native/avatarsync/build.sh` is the local loop, and the README
beside it explains what it is a fork of, and why the binaries in a released wheel
come from a workflow instead of from that script.

The demo call, which is where lipsync is actually judged:

```sh
cd apps/server && uv run --project ../../packages/avatar-py --group server --group dev python -m pytest
cd packages/avatar-py && uv run --group server python ../../apps/server/server.py
```

`pnpm test` also runs here, and CI runs it on your pull request. It is the
JavaScript side's gate, and a Python change can break it — the documentation
checks read the whole tree, so a path or a state name you rename in prose is
caught there rather than in review.

Two expectations that are not about tooling:

- **Comments explain the perceptual *why*, not the mechanics.** Why a latch is
  armed by that frame, why `CANT_HEAR` needs a clock. The mechanics are readable
  from the code; the reasoning is not, and it is the part that gets deleted by
  accident.
- **The client never decides what the agent is doing.** No inference about call
  content on the browser side, and no state the backend asserts that pipecat's
  own frames could have observed. The precedence is the design
  ([docs/pipecat-lifecycle-protocol.md](docs/pipecat-lifecycle-protocol.md)).

## Scope is checked, not asked for

`.github/workflows/scope.yml` fails a pull request that changes anything outside
`packages/avatar-py/`, `apps/server/`, `.github/` and this file. It exists so the
first thing you learn about the boundary is a job in your own run, not a comment
three days later.

## Licence

Code contributions are under [MIT](LICENSE), the licence on the code in this
repository. The character binaries are separately CC-BY 4.0
([LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0)) and **take no contributions** — there is
no source for them here, so there is nothing to patch. By opening a pull request
you confirm you wrote the change, or are entitled to submit it, and that it may
be released under MIT.
