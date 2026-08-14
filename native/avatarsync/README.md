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
libraries in `bin/`. Those libraries are distributed, so the notices travel with
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
| `patches/avatarsync-1.14.0.patch` | changes to upstream, described in the patch header |
| `src/core.h`, `src/core.cpp` | the engine — both legs, the decoder pool, the warm-up |
| `src/avatarsync.h`, `src/capi.cpp` | the `extern "C"` ABI, which is the entire public surface |
| `data/phone_weights.json` | fitted per-phone duration weights (the fast leg) |
| `bin/<platform>/libavatarsync.<so\|dylib>` | prebuilt libraries, so a dev clone runs without a compiler |
| `build.sh` | fetch → verify → patch → compile → install |

`.build/`, `.cache/` and `res/` are generated and gitignored.

**There is no native command-line program here.** The only artifact is the shared
library. The tool you run by hand is `voqalize-avatar` (`py/src/voqalize_avatar/cli.py`),
a console script that loads this same library — same legs, same code path a live
pipeline takes. A second front end built beside the library is a front end that
can disagree with it, and then every timing number below would be a number about
the wrong thing.

## One library, two legs

The design decision worth stating: **one resident engine serves both viseme
legs**, in the caller's process.

- **`avs_text_cues`** — the fast leg, ~0.2 ms/sentence. `rhubarbLib.cpp` is two
  steps and only the first needs audio: `recognizePhones()` discovers a phone
  timeline, `animate()` turns it into shapes. Everything Rhubarb knows about
  *looking right* — co-articulation, tweening, pause handling, static-segment
  cleanup — is in `animate()`, which is a pure function. Given a duration we can
  predict the timeline (cmudict + fitted per-phone weights) and skip recognition
  entirely. Accuracy against real recognition, and the sensitivity to duration
  error that makes `voqalize_avatar.durations` load-bearing, are measured in
  `experiments/rhubarb-textsync/README.md`.
- **`avs_audio_cues`** — the accurate leg over a *finished* clip, ~21 ms for a
  0.94 s clip (~24 ms of CPU per second of audio). Real `phonetic` recognition
  over PCM. This is the by-hand call: the CLI and the measurement scripts have a
  whole file; a live pipeline never does.
- **`avs_stream_*`** — the accurate leg over audio that is still arriving, and
  what production actually uses. `avs_stream_open` takes a decoder from the pool
  for the length of a speaking turn, `avs_stream_feed` appends PCM as TTS emits
  it, `avs_stream_cues(from_ms, hold_back_ms)` returns the timeline so far, and
  `avs_stream_finish` returns it to the true end. Resampling to 16 kHz is
  incremental and exact, so a clip fed in 20 ms pieces decodes to the same
  samples as the same clip fed whole — the streaming leg is not an
  approximation of the batch one.

They share the resident cost that actually matters — the 125 k-entry cmudict and
the 82 MB acoustic model behind the decoder — so splitting them would mean paying
that twice. The legs are ~30 lines each on top of shared setup; there was never a
case for two.

Two things about streams are load-bearing and easy to get wrong. **A stream that
is never closed leaks ~55 MB and one of `max_streams` slots for the life of the
process**, so `avs_stream_close` has to survive every way a turn can end,
including a barge-in mid-feed and without `avs_stream_finish`. And **the pool
refuses rather than queues**: past `max_streams`, `avs_stream_open` returns
`NULL` with no error set, which is why the caller has to check `err[0]` to tell a
refusal from a failure. That refusal is the memory bound doing its job — the
Python side treats it as "latch this turn to the fast leg", not as an error.
`voqalize-avatar info` prints the ceiling.

## The ABI

`src/avatarsync.h` is the whole surface: `avs_open` / `avs_close`, the two batch
cue calls, the six `avs_stream_*` calls, `avs_free_cues`, and a handful of
accessors for what the model loaded.
Cues come back as an array of `{ms, shape, phone}`; `shape` indexes the Rhubarb
A–H+X set and `phone` is the ARPABET phone underneath it, or `-1` for silence.
`avs_abi_version()` is what a caller checks before trusting the struct layout.

Two properties the Python side depends on:

- **Neither cue call takes a global lock.** ctypes drops the GIL for the duration
  of a foreign call, so a decode on a worker thread genuinely runs off the event
  loop rather than blocking it.
- **`avs_audio_cues` takes a decoder from a pool, one per concurrent caller.**
  The pool's mutex is held only around the handout, so two decodes overlap for
  real — measured at 2x the CPU for 1.02x the wall clock. The cost is memory:
  ~58 MB per decoder, which is why `avs_config.warmup_decoders` is a count and
  the Python side sets it to its worker count. Warm one and run two and the
  second live sentence pays ~140 ms of `ps_init` mid-call.

`avs_warmup_ms` is the tell for whether the acoustic model actually loaded at
open: ~158 ms per decoder means the first real request is warm, ~0 means the
warm-up clip failed VAD and the first request will pay it. Open runs one
synthetic amplitude-modulated noise clip for exactly this reason — recognition
runs VAD first, so warming up on silence would initialise nothing.

## Building

```sh
./build.sh              # fetch, patch, compile, install
./build.sh --res-only   # just materialise res/ (what a dev clone needs)
./build.sh --clean      # discard .build/ first
```

A full `--clean` build is ~16 s on an M4 (49 translation units — only our
dependency subset, not upstream's CLI or GUI), plus a one-time 85 MB fetch. It is
also reproducible: rebuilding produces a byte-identical library, so a rebuild
does not show up as a diff on the committed one.

Build natively. The published upstream macOS binary is x86_64 and costs ~2.6x
under Rosetta; our arm64 build is the whole reason the numbers above are what
they are.

`res/` is 56 MB and identical on every platform, so it is regenerated rather
than committed: cmudict (fast leg), `en-us-phone.lm.bin` and the CMU acoustic
model (accurate leg). Upstream's CMake also stages `en-us.lm.bin` (26 MB word
LM) and a second acoustic model; neither leg reads them, so `build.sh` leaves
them out.

**A dev clone needs `./build.sh --res-only` once.** The library is committed; the
models are not.

### Rebuilding the linux libraries

`bin/<platform>/` is committed, so a clone runs without a compiler and nothing
compiles in CI. `build.sh` is platform-agnostic and nothing in the patch or in
`src/` is macOS-specific — a new linux library needs a linux *builder*, not a
code change.

A platform with no committed library is not an error: `AvatarsyncPaths.check()`
names the missing file and the Python tests skip rather than fail. That is a
comfortable failure mode and therefore a dangerous one — a CI leg on a platform
whose library is missing goes green having tested none of this. Check the skip
count, not just the exit code.

The build deps are wider than they look, and every one of them was found the
hard way when the mac build turned out to be leaning on Homebrew:

| dep | why |
|---|---|
| `cmake` **≥ 3.30** | upstream's `CMakeLists` sets policy `CMP0167`; older CMake errors out on the unknown policy. Debian bookworm ships 3.25 — too old. **trixie** ships 3.31 |
| `libboost-all-dev` | `find_package(Boost)`; statically linked into the output |
| `git` | upstream `FetchContent`-clones googletest at *configure* time |
| `build-essential`, `curl`, `patch` | compile, fetch the pinned tarball, apply our patch |

On an Apple-silicon mac a linux image runs under qemu emulation, which turns a
~2 minute compile into a very long one. So the linux libraries are built on real
hosts by `.github/workflows/wheels.yml`, which is also what builds the wheels —
one workflow, so the library a developer refreshes is the library a user gets:

```sh
gh workflow run wheels.yml
for p in linux-x64 linux-arm64 darwin-arm64; do
  rm -f "bin/$p"/libavatarsync.* "bin/$p/avatarsync.recipe"  # gh refuses to overwrite
  gh run download <id> -n "avatarsync-$p" -D "bin/$p"
done
```

That workflow builds **inside the `manylinux_2_28` image**, not on the runner.
The runner is Ubuntu 24.04 (glibc 2.39), and a library built there cannot load on
Ubuntu 22.04, Debian 12 or RHEL 9 — most of production. glibc 2.28 reaches back
to RHEL 8 and Debian 10 and costs nothing. What comes out needs *less* than
that — the highest versioned symbol in the library is `GLIBC_2.25`, which is the
floor the wheel tag then reports. Boost is headers-only and ≥ 1.54, so
AlmaLinux 8's 1.66 satisfies it; CMake comes from pip because the image's is
older than the 3.30 that upstream's `CMP0167` policy requires.

Locally, if you do have an x86_64 linux host:

```sh
docker run --rm -v "$PWD/../..:/w" -w /w/native/avatarsync debian:trixie \
  bash -c 'apt-get update && apt-get install -y build-essential cmake \
    libboost-all-dev curl patch git && ./build.sh'
```

**glibc symbol versioning is forward-incompatible**: a library built against a
newer glibc will not load on a host with an older one, however little of it the
library uses. Since the library now ships inside a wheel, that floor is not just
documentation — it is the wheel's `manylinux_x_y` tag, and
`py/scripts/stage_native.py` derives the tag by reading these very symbols out
of the compiled library. Build somewhere newer and the tag moves with you; pip
then declines to install it where it would not run, instead of installing it and
failing at the first sentence.

`libstdc++` and `libgcc` are linked **statically** (see the portability block in
`build.sh`), which leaves glibc as the whole dynamic story. That is not an
optimisation: a wheel tag cannot express a libstdc++ floor at all, so a dynamic
one would be invisible to pip. Staging refuses a library that still has
`GLIBCXX_`/`CXXABI_` symbols rather than shipping the trap. Verify by hand the
same way:

```sh
strings bin/linux-x64/libavatarsync.so | grep -o 'GLIBC_[0-9.]*'   | sort -uV | tail -1
strings bin/linux-x64/libavatarsync.so | grep -o 'GLIBCXX_[0-9.]*' | sort -uV | tail -1
```

**Change `src/` or `patches/` and you MUST rebuild every committed library.**
Nothing in CI compiles, so a source edit alone changes what the tree *says* and
not what a deployment *runs*: the tree looks new, the library is the old compile,
and there is no error anywhere. Green build, unchanged behaviour — exactly the
shape of the bug that left visemes dark for weeks.

So each library is committed with a `bin/<platform>/avatarsync.recipe` beside it
— a hash of `src/` + `patches/` + `build.sh`, written by `build.sh` only after a
real compile. Compare it against `./build.sh --recipe-id` before trusting a
library, and wire that comparison into whatever packages a deployment. Rebuild on
each platform and commit the library and its `.recipe` together.

## How this reaches a user

Inside the wheel. `voqalize-avatar` publishes one wheel per platform, each
carrying `bin/<platform>/libavatarsync.*`, `res/` and `data/phone_weights.json`
flattened into `voqalize_avatar/_native/`, so `pip install voqalize-avatar` is
the entire installation procedure and `build_viseme_engine` needs no argument.
A deployment ships nothing extra.

**`.github/workflows/wheels.yml` is canonical**, and it compiles rather than
packaging a committed library. `build.sh` is the local loop — it is how you
iterate on `src/` on your own machine, and it takes the same portability flags so
a local build is debuggable against the published one, but nothing it produces is
ever distributed. The committed libraries exist so a clone runs without a
compiler; they are a development convenience, not the artifact.

A source checkout is found by walking up to `native/avatarsync`
(`AvatarsyncPaths.discover`), and a deploy that unpacks this directory itself can
name it with `AvatarsyncPaths.from_home(<that directory>)`. Nothing reads the
environment — where an artifact landed is something the application knows and
states.

`data/phone_weights.json` is the exception, and the reason the recipe hash
deliberately excludes it: the weights are packaged as data and read at runtime,
so editing them ships on its own with no rebuild. Same directory, opposite
rule.

```sh
./build.sh --recipe-id   # what the sources currently hash to; builds nothing
cat bin/linux-x64/avatarsync.recipe   # what that library was compiled from
```
