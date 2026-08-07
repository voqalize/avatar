# `avatarsync` — the native viseme engine

The avatar widget is driven by a stream of Rhubarb A–H+X mouth-shape letters
(the wire format is `docs/contract-protocol.md` § Speech in the avatar repo).
This directory owns the native code that produces them; `py/src/voqalize_avatar`
owns the Python that drives it.

## Provenance and license

Upstream is [rhubarb-lip-sync](https://github.com/DanielSWolf/rhubarb-lip-sync)
**1.14.0**, MIT-licensed. `UPSTREAM-LICENSE.md` here is upstream's own licence
file, copied out of the tarball by `build.sh` and **committed** — it carries the
third-party notices for pocketsphinx, sphinxbase, flite, webrtc, cppformat, GSL,
Boost and the CMU acoustic model, all of which are statically linked into the
binaries in `bin/`. Those binaries are distributed, so the notices travel with
them. This repo's own code is AGPL-3.0-only (`/LICENSE`); upstream's terms are
upstream's.

**The upstream source is not vendored in git.** The tag tarball is 85 MB, most
of it a 52 MB acoustic model, and a repo-sized copy of it buys nothing a pinned
hash does not. `build.sh` fetches it and verifies

```
sha256  45acd039782c26f563a331f59769a5be7e0f6f337d8ee99f0cfd8a10da40ccdf
```

before it will touch a byte of it. What we own and commit is:

| path | what it is |
|---|---|
| `patches/avatarsync-1.14.0.patch` | three changes to upstream, described in the patch header |
| `src/avatarsync.cpp` | our resident binary — the only new source |
| `data/phone_weights.json` | fitted per-phone duration weights (the fast leg) |
| `bin/<platform>/avatarsync` | prebuilt binaries, so a dev clone runs without a compiler |
| `build.sh` | fetch → verify → patch → compile → install |

`.build/`, `.cache/` and `res/` are generated and gitignored.

## One binary, two legs

The design decision worth stating: **one resident process serves both viseme
legs**, not two binaries.

- **`text`** — the fast leg, ~0.4 ms/sentence. `rhubarbLib.cpp` is two steps and
  only the first needs audio: `recognizePhones()` discovers a phone timeline,
  `animate()` turns it into shapes. Everything Rhubarb knows about *looking
  right* — co-articulation, tweening, pause handling, static-segment cleanup —
  is in `animate()`, which is a pure function. Given a duration we can predict
  the timeline (cmudict + fitted per-phone weights) and skip recognition
  entirely. Accuracy against real recognition, and the sensitivity to duration
  error that makes `voqalize_avatar.durations` load-bearing, are measured in
  `experiments/rhubarb-textsync/README.md`.
- **`audio`** — the accurate leg, ~15 ms for a 0.8 s clip, ~31 ms for longer
  ones. Real `phonetic` recognition over PCM handed in on stdin.

They share the resident cost that actually matters — the process, the 125 k-entry
cmudict, and the 82 MB acoustic model behind the decoder — so splitting them
would mean paying that twice and giving the Python side two liveness stories,
two restart policies and two pipes to correlate on. The legs are ~30 lines each
on top of shared setup; there was never a case for two.

## Protocol

One JSON object per stdin line in, one per stdout line out, correlated by `id`.
Requests are served **sequentially** — the caller multiplexes. The ready line
goes to **stdout** (not stderr, unlike the experiment) so one reader sees
readiness and every response.

```
$ ./bin/darwin-arm64/avatarsync --res res --weights data/phone_weights.json
{"ready":true,"dict_entries":125945,"load_ms":95.3,"warmup_ms":181.8}

{"id":1,"op":"text","ms":2400,"text":"Hello, thanks for joining."}
{"id":1,"ms":2400,"compute_ms":0.42,"cues":[{"t":0,"v":"X"},{"t":30,"v":"C"},…]}

{"id":2,"op":"audio","sr":24000,"pcm":"<base64 s16le mono>"}
{"id":2,"ms":810,"compute_ms":15.2,"cues":[…]}

{"id":3,"op":"ping"}
{"id":3,"pong":true}
```

Errors are per-request and never fatal: `{"id":2,"error":"empty pcm"}`. A
startup failure is `{"ready":false,"error":"…"}` and a non-zero exit.

`warmup_ms` in the ready line is the tell for whether the acoustic model
actually loaded at startup: a value near 180 ms means the first real `audio`
request is warm, a value near 0 means the warm-up clip failed VAD and the first
request will pay ~180 ms. Startup runs one synthetic amplitude-modulated noise
clip for exactly this reason — recognition runs VAD first, so warming up on
silence would initialise nothing.

Flags: `--res`, `--dict`, `--weights`, `--lead`, `--trail`, `--trail-frac`,
`--word-gap`, `--basic-shapes`, `--no-warmup`.

## Building

```sh
./build.sh              # fetch, patch, compile, install
./build.sh --res-only   # just materialise res/ (what a dev clone needs)
./build.sh --clean      # discard .build/ first
```

A full `--clean` build is ~16 s on an M4 (49 translation units — only
`avatarsync`'s dependency subset, not upstream's CLI or GUI), plus a one-time
85 MB fetch. It is also reproducible: rebuilding produces a byte-identical
binary, so a rebuild does not show up as a diff on the committed one.

Build natively. The published upstream macOS binary is x86_64 and costs ~2.6x
under Rosetta; our arm64 build is the whole reason the numbers above are what
they are.

`res/` is 56 MB and identical on every platform, so it is regenerated rather
than committed: cmudict (fast leg), `en-us-phone.lm.bin` and the CMU acoustic
model (accurate leg). Upstream's CMake also stages `en-us.lm.bin` (26 MB word
LM) and a second acoustic model; neither leg reads them, so `build.sh` leaves
them out.

**A dev clone needs `./build.sh --res-only` once.** The binary is committed; the
models are not.

### Rebuilding linux-x64

Both `bin/darwin-arm64/avatarsync` and `bin/linux-x64/avatarsync` are committed,
so every deploy is package-only and nothing compiles in CI. `build.sh` is
platform-agnostic and nothing in the patch or in `avatarsync.cpp` is
macOS-specific — a new linux binary needs a linux/amd64 *builder*, not a code
change.

The build deps are wider than they look, and every one of them was found the
hard way when the mac build turned out to be leaning on Homebrew:

| dep | why |
|---|---|
| `cmake` **≥ 3.30** | upstream's `CMakeLists` sets policy `CMP0167`; older CMake errors out on the unknown policy. Debian bookworm ships 3.25 — too old. **trixie** ships 3.31 |
| `libboost-all-dev` | `find_package(Boost)`; statically linked into the output |
| `git` | upstream `FetchContent`-clones googletest at *configure* time |
| `build-essential`, `curl`, `patch` | compile, fetch the pinned tarball, apply our patch |

On an Apple-silicon mac a linux image runs under qemu emulation, which turns a
~2 minute compile into a very long one. So the linux binaries are built on real
hosts by `.github/workflows/wheels.yml`, which is also what builds the wheels —
one workflow, so the binary a developer refreshes is the binary a user gets:

```sh
gh workflow run wheels.yml
gh run download <id> -n avatarsync-linux-x64 -D bin/linux-x64
```

That workflow builds **inside the `manylinux_2_28` image**, not on the runner.
The runner is Ubuntu 24.04 (glibc 2.39), and a binary built there cannot run on
Ubuntu 22.04, Debian 12 or RHEL 9 — most of production. glibc 2.28 reaches back
to RHEL 8 and Debian 10 and costs nothing. Boost is headers-only and ≥ 1.54, so
AlmaLinux 8's 1.66 satisfies it; CMake comes from pip because the image's is
older than the 3.30 that upstream's `CMP0167` policy requires.

Locally, if you do have an x86_64 linux host:

```sh
docker run --rm -v "$PWD/../..:/w" -w /w/native/avatarsync debian:trixie \
  bash -c 'apt-get update && apt-get install -y build-essential cmake \
    libboost-all-dev curl patch git && ./build.sh'
```

**glibc symbol versioning is forward-incompatible**: a binary built against a
newer glibc will not run on a host with an older one, however little of it the
binary uses. Since the binary now ships inside a wheel, that floor is not just
documentation — it is the wheel's `manylinux_x_y` tag, and
`py/scripts/stage_native.py` derives the tag by reading these very symbols out
of the compiled binary. Build somewhere newer and the tag moves with you; pip
then declines to install it where it would not run, instead of installing it and
failing at the first sentence.

`libstdc++` and `libgcc` are linked **statically** (see the portability block in
`build.sh`), which leaves glibc as the whole dynamic story. That is not an
optimisation: a wheel tag cannot express a libstdc++ floor at all, so a dynamic
one would be invisible to pip. Staging refuses a binary that still has
`GLIBCXX_`/`CXXABI_` symbols rather than shipping the trap. Verify by hand the
same way:

```sh
strings bin/linux-x64/avatarsync | grep -o 'GLIBC_[0-9.]*'   | sort -uV | tail -1
strings bin/linux-x64/avatarsync | grep -o 'GLIBCXX_[0-9.]*' | sort -uV | tail -1
```

**Change `src/` or `patches/` and you MUST rebuild every committed binary.**
Nothing in CI compiles, so a source edit alone changes what the tree *says* and
not what a deployment *runs*: the tree looks new, the binary is the old compile,
and there is no error anywhere. Green build, unchanged behaviour — exactly the
shape of the bug that left visemes dark for weeks.

So each binary is committed with a `bin/<platform>/avatarsync.recipe` beside it
— a hash of `src/` + `patches/` + `build.sh`, written by `build.sh` only after a
real compile. Compare it against `./build.sh --recipe-id` before trusting a
binary, and wire that comparison into whatever packages a deployment. Rebuild on
each platform and commit the binary and its `.recipe` together.

## How this reaches a user

Inside the wheel. `voqalize-avatar` publishes one wheel per platform, each
carrying `bin/<platform>/avatarsync`, `res/` and `data/phone_weights.json`
flattened into `voqalize_avatar/_native/`, so `pip install voqalize-avatar` is
the entire installation procedure and `build_viseme_engine` needs no argument.
A deployment ships nothing extra.

**`.github/workflows/wheels.yml` is canonical**, and it compiles rather than
packaging a committed binary. `build.sh` is the local loop — it is how you
iterate on `src/avatarsync.cpp` on your own machine, and it takes the same
portability flags so a local build is debuggable against the published one, but
nothing it produces is ever distributed. The committed binaries exist so a clone
runs without a compiler; they are a development convenience, not the artifact.

The escape hatch is still there for a deploy that unpacks this directory itself:
pass `build_viseme_engine(..., avatarsync=<that directory>)`. The library reads
no environment variables — where an artifact landed is something the application
knows and states.

`data/phone_weights.json` is the exception, and the reason the recipe hash
deliberately excludes it: the weights are packaged as data and read at runtime,
so editing them ships on its own with no rebuild. Same directory, opposite
rule.

```sh
./build.sh --recipe-id   # what the sources currently hash to; builds nothing
cat bin/linux-x64/avatarsync.recipe   # what that binary was compiled from
```
