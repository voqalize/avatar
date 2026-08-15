"""`libavatarsync`, in process, driven from asyncio.

`native/avatarsync/` builds one shared library that answers both viseme legs
behind a C ABI (its README has the reasoning). `_native.py` is the ctypes
declaration of that ABI; this module is everything above it — where the library
lives, how many decodes may run at once, and the fact that a failure is never
call-ending.

This used to be a subprocess speaking JSON-lines over a pipe, and the things that
went away with it are the point:

**No IPC.** Base64 of every PCM buffer, a JSON parse per response, a reader task,
per-request `id` correlation, a restart policy, a request timeout, and a
`ping`. All of it existed to move an array of 8-byte structs across a process
boundary. A cue array now comes back as a pointer, measured at 1.4 ms of the old
27 ms round trip and no longer measurable at all.

**No loop binding.** A subprocess transport, its reader task and every pending
future belonged to the loop that created them, so the shared pool had to record
its loop and rebuild when a test brought a new one. A library handle belongs to
the process; `shared_engine()` is a plain global with nothing to invalidate.

**No crash to survive.** There is no process to die under a request. The library
raises, we log, the sentence goes without cues. Callers still treat
`AvatarsyncError` as "no cues this sentence", never as a call-ending error —
that contract is unchanged, only its causes are fewer.

## Why there is still a bound on concurrency (`DEFAULT_WORKERS`)

ctypes releases the GIL for the duration of a foreign call, so `run_in_executor`
genuinely parallelises the decoder — and that is exactly what needs limiting.
Rhubarb's decoder `ObjectPool` allocates a decoder per concurrent caller and each
one carries its own means/variances/mdef, measured at ~58 MB. Handed to
`asyncio.to_thread`, whose default executor is `min(32, cpu + 4)` threads, a burst
of concurrent sentences would quietly allocate a gigabyte and a half of acoustic
model — the same failure the old process pool was sized to avoid, arrived at from
the other direction.

So decodes run on a small dedicated executor. The arithmetic is the one that
sized the old pool: a sentence costs ~25 ms of audio-leg work, a session emits
roughly one sentence every two seconds while the agent is talking, so ~30
sessions/node is ~0.4 s of decode per second of wall clock. Two workers leave
room to double. Memory, not CPU, is the binding constraint, and two decoders is
~116 MB flat in the number of sessions.

**Deliberately not done, and why.** The acoustic model *is* immutable after
`gauden_dist_precompute` mutates `g->var` once at init (the only other writer,
`gauden_mllr_transform`, is never called), so decoders could share it — by mmap
of a precomputed image, or fork+COW from a parent that has already loaded it.
Both are real wins if this ever needs to scale past a couple of workers per node;
neither is worth the C++ surgery at the size we run. Recorded here so the next
person does not re-derive it.
"""

from __future__ import annotations

import asyncio
import platform
import threading
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from loguru import logger

from ._native import NativeEngine, NativeError, NativeStream, library_name

# The letters the widget understands: Rhubarb A-H plus X for silence.
# (avatar docs/internal-mixer.md § Speech.)
VISEME_LETTERS = frozenset("ABCDEFGHX")
SILENT = "X"

# Concurrent decodes per worker process. Two — see the module docstring; this is
# a memory bound wearing a thread count's clothes.
DEFAULT_WORKERS = 2


@dataclass(frozen=True, slots=True)
class Cue:
    """One mouth shape, `t` ms into whatever timeline the caller is building.

    Mirrors the wire cue `{t, v, p?}`. Intensity is omitted: Rhubarb emits shape,
    not loudness, and the widget reads a missing `i` as 1.

    `p` is the Arpabet phone underneath the shape, or `None` during silence. The
    nine shapes are a lossy projection of ~41 phones and the loss is concentrated
    — shape `B` alone absorbs IY, IH, T, D, CH, JH, TH, DH, S, Z, SH, ZH, N and
    Y. A renderer with a mouth for "tongue between the teeth" cannot ask for it
    from `v` and can from `p`. It costs nothing to carry: both legs hold a phone
    timeline and used to throw it away at the boundary.
    """

    t: int
    v: str
    p: str | None = None


class AvatarsyncError(RuntimeError):
    """A request failed. Callers degrade; they do not end the call."""


class AvatarsyncUnavailableError(AvatarsyncError):
    """No library for this platform. Raised at start, never mid-request."""


def platform_id() -> str:
    """`darwin-arm64`, `linux-x64`, … — matches `native/avatarsync/build.sh`."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(machine)
    if arch is None:
        return f"{system}-{machine}"
    return f"{system}-{arch}"


# Where the wheel unpacks the native payload. A platform wheel carries exactly
# one library — the wheel tag already says which platform — so there is no
# `bin/<platform>/` level here, unlike the source tree's `native/avatarsync`.
_BUNDLE_DIR = Path(__file__).resolve().parent / "_native"


@dataclass(frozen=True, slots=True)
class AvatarsyncPaths:
    """Where the library and its 56 MB model tree live.

    **Nobody outside this package constructs one of these.** The platform wheel
    carries the library and its model tree, so `locate()` finds them with no
    argument at all and the native half has no configuration surface. That is the
    point: a client developer installs one package and gets lipsync.

    `from_home` and `discover` exist for the one case the bundle cannot cover —
    a source checkout of this repo, where the library is built rather than
    installed.

    **Nothing here reads the environment.** Two engines in one interpreter could
    not disagree about where the library is, and the failure mode when a variable
    is absent is silence rather than an error at the call site.
    """

    library: Path
    res_dir: Path
    weights: Path | None = None

    @classmethod
    def locate(cls) -> AvatarsyncPaths:
        """Where the aligner is on this machine: the wheel's payload, or, failing
        that, a source checkout of this repo.

        The one entry point `build_viseme_engine` uses, and it takes no argument
        on purpose. The checkout fallback exists so this repo's own tests and
        demos need no configuration either; from site-packages there is no
        `native/avatarsync` above us to find, so it costs an installed
        application nothing but a handful of `is_dir()` calls at pipeline start.

        Returns paths that may not exist — `check()` is what says so, with the
        actual missing path in the message.
        """
        return cls.bundled() or cls.discover() or cls._bundle_layout()

    @classmethod
    def _bundle_layout(cls) -> AvatarsyncPaths:
        return cls(
            library=_BUNDLE_DIR / library_name(),
            res_dir=_BUNDLE_DIR / "res",
            weights=_BUNDLE_DIR / "phone_weights.json",
        )

    @classmethod
    def bundled(cls) -> AvatarsyncPaths | None:
        """The payload inside this wheel, or `None` on a platform we have no
        wheel for (or an install from the sdist, which carries no library)."""
        layout = cls._bundle_layout()
        return layout if layout.library.is_file() else None

    @classmethod
    def from_home(cls, home: Path | str) -> AvatarsyncPaths:
        """A directory laid out like `native/avatarsync`.

            <home>/bin/<platform>/libavatarsync.{so,dylib}
            <home>/res/sphinx/…
            <home>/data/phone_weights.json

        Which is exactly what `native/avatarsync/build.sh` produces and what a
        deploy unpacks its artifact into.
        """
        root = Path(home)
        return cls(
            library=root / "bin" / platform_id() / library_name(),
            res_dir=root / "res",
            weights=root / "data" / "phone_weights.json",
        )

    @classmethod
    def discover(cls, start: Path | str | None = None) -> AvatarsyncPaths | None:
        """Walk up from `start` looking for `native/avatarsync`; `None` if absent.

        For source checkouts — this repo's own tests and demos — where the built
        artifact sits beside the Python rather than at a deployed path. It is a
        method you call, not something the library does behind you: discovery
        that runs on its own is the same hidden input as an environment variable,
        just sourced from the filesystem instead of `os.environ`.
        """
        origin = Path(start).resolve() if start is not None else Path(__file__).resolve()
        for parent in origin.parents:
            for name in ("avatarsync", "rhubarb"):
                candidate = parent / "native" / name
                if candidate.is_dir():
                    return cls.from_home(candidate)
        return None

    def check(self) -> None:
        """Fail with the actual missing path, not a generic 'unavailable'."""
        if not self.library.is_file():
            raise AvatarsyncUnavailableError(
                f"No avatarsync library at {self.library} (platform {platform_id()}). "
                "Install the platform wheel for this machine — the sdist carries "
                "no library, and we publish no wheel for every platform."
            )
        dictionary = self.res_dir / "sphinx" / "cmudict-en-us.dict"
        if not dictionary.is_file():
            raise AvatarsyncUnavailableError(
                f"No pronunciation dictionary at {dictionary}. A platform wheel "
                "carries one; a source checkout needs "
                "native/avatarsync/build.sh --res-only."
            )


class VisemeRuntime(Protocol):
    """What `VisemeEngine` needs from whatever answers viseme requests.

    Structural, because the engine must not be able to tell an owned runtime from
    a share of a process-wide one — in particular `stop()` means "I am done with
    this", not "unload the model".
    """

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]: ...

    async def open_stream(self, sample_rate: int) -> "VisemeStream | None": ...


class VisemeStream(Protocol):
    """One live decode, driven from the event loop.

    Structural for the same reason `VisemeRuntime` is: the engine must not be
    able to tell a real decode from a test double.

    Every method hops to a worker thread, which is the only reason this is usable
    from a frame handler — ctypes drops the GIL for the foreign call, so the loop
    keeps moving audio frames while the decoder works. Nothing here is safe under
    concurrent calls on one stream, and nothing needs to be: a stream belongs to
    one speaking turn, and a turn is driven by one task.
    """

    async def feed(self, pcm: bytes) -> None: ...

    async def cues(self, from_ms: int, hold_back_ms: int) -> list[Cue]: ...

    async def finish(self) -> list[Cue]: ...

    async def close(self) -> None: ...


class AvatarsyncEngine:
    """One loaded `libavatarsync`, and the bound on how much of it runs at once.

    Not opened in `__init__`: the first `start()` loads it, so constructing this
    costs nothing on a call that never speaks.

    `paths` is required and has no default. Any default would have to guess, and
    a guess that misses *fails at construction* — deep inside a session start,
    which is exactly the wrong place. `AvatarsyncPaths.locate()` + `check()` is
    the front door, and `visemes.build_viseme_engine` walks through it first so a
    missing library is a clean error before anything is constructed.
    """

    def __init__(
        self,
        paths: AvatarsyncPaths,
        *,
        workers: int = DEFAULT_WORKERS,
        pause_rest_ms: int | None = None,
    ) -> None:
        self._paths = paths
        self._workers = max(1, workers)
        # How long a silence has to be before the mouth closes. `None` takes the
        # library default; 0 restores Rhubarb's own 350 ms rule. Exposed only so
        # the review page can bake the same clips at several thresholds and be
        # judged by eye — production has no reason to set it, and a consumer
        # asking for it is a signal the default is wrong for everyone.
        self._pause_rest_ms = pause_rest_ms
        self._engine: NativeEngine | None = None
        self._executor: ThreadPoolExecutor | None = None
        # `threading.Lock`, not `asyncio.Lock`, and that is the whole reason this
        # object is loop-agnostic: an asyncio lock binds to the loop that first
        # awaits it and raises ever after on any other, which would put the loop
        # tracking back that removing the subprocess just deleted.
        #
        # Two of them, because they are held for wildly different durations and
        # one of them is taken *on the event loop*. `_lock` guards a few field
        # assignments and is never held for more than microseconds. `_load_lock`
        # is held across the ~250 ms model load and is only ever taken inside a
        # worker thread. Merging them — which is what this was — means a second
        # session calling start() stalls the entire event loop for a quarter of a
        # second on the first one's load.
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()
        self._closed = False

    async def start(self) -> None:
        """Load the library. Idempotent, and safe to call concurrently.

        Opening reads a 125k-entry dictionary and warms the 52 MB acoustic model
        — ~250 ms of blocking work, so it goes to the executor like a decode
        does. Warming here rather than lazily is the whole reason the first live
        sentence costs 31 ms instead of 181.
        """
        if self._engine is not None:
            return
        # Cheap stat calls, and worth doing before an executor exists: a missing
        # library should fail here, naming the path, not as an exception
        # surfacing out of a worker thread.
        self._paths.check()
        executor = self._ensure_executor()
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(executor, self._load)
        except NativeError as exc:
            raise AvatarsyncError(str(exc)) from exc

    def _ensure_executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._closed:
                raise AvatarsyncError("avatarsync engine is closed")
            if self._executor is None:
                self._executor = ThreadPoolExecutor(
                    max_workers=self._workers, thread_name_prefix="avatarsync"
                )
            return self._executor

    def _load(self) -> NativeEngine:
        """Runs in a worker thread. The lock makes concurrent `start()`s load once.

        Held for the whole ~250 ms load, which does block the other worker — the
        alternative is two threads each pulling in their own 52 MB acoustic model
        to throw one away. It is deliberately NOT the lock the event loop takes.
        """
        with self._load_lock:
            if self._engine is None:
                if self._closed:
                    raise AvatarsyncError("avatarsync engine is closed")
                weights = self._paths.weights
                engine = NativeEngine(
                    self._paths.library,
                    res_dir=self._paths.res_dir,
                    weights=weights if weights is not None and weights.is_file() else None,
                    # One warm decoder per worker thread, because a decoder is
                    # built per *concurrent* caller: warming one and running two
                    # means the second live sentence builds the second decoder
                    # itself, ~140 ms, on a call. This is also what makes the
                    # memory figure in the module docstring true at start rather
                    # than on some later burst.
                    warmup_decoders=self._workers,
                    pause_rest_ms=self._pause_rest_ms,
                )
                self._engine = engine
                logger.info(
                    "avatarsync ready: dict={} load_ms={:.1f} warmup_ms={:.1f} workers={}",
                    engine.dict_entries,
                    engine.load_ms,
                    engine.warmup_ms,
                    self._workers,
                )
            return self._engine

    async def stop(self) -> None:
        """Unload for good. Later requests raise rather than reload."""
        with self._lock:
            self._closed = True
            engine, self._engine = self._engine, None
            executor, self._executor = self._executor, None
        if executor is not None:
            # Wait for the workers to drain before the handle is freed, and this
            # is not optional: a decode in flight is inside a foreign call
            # holding a pointer to the engine, and closing it under that thread
            # is a segfault, not an exception. `cancel_futures` drops what has
            # not started, so the wait is bounded by one decode — ~30 ms — and it
            # happens on a thread rather than on the loop.
            await asyncio.to_thread(executor.shutdown, wait=True, cancel_futures=True)
        if engine is not None:
            engine.close()

    async def _run(self, fn, *args) -> list[Cue]:
        if self._closed:
            raise AvatarsyncError("avatarsync engine is closed")
        if self._engine is None:
            await self.start()
        engine, executor = self._engine, self._executor
        if engine is None or executor is None:
            raise AvatarsyncError("avatarsync engine is not running")
        loop = asyncio.get_running_loop()
        try:
            raw = await loop.run_in_executor(executor, fn, engine, *args)
        except NativeError as exc:
            raise AvatarsyncError(str(exc)) from exc
        except RuntimeError as exc:
            # The executor was shut down under us — a session closing mid-request.
            raise AvatarsyncError(f"avatarsync is shutting down ({exc})") from exc
        return _cues_from(raw)

    # ---- the two legs ------------------------------------------------------

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        """The fast leg: cues for `text` stretched to `duration_ms`, ~0.15 ms.

        Runs **on the event loop**, not the executor. At 0.15 ms it is under 1%
        of a 20 ms frame budget, and a hop to a worker thread would cost more in
        dispatch than the work itself — while queueing it behind a 27 ms decode,
        which is the one thing this leg exists to get ahead of.

        Accuracy is dominated by how right `duration_ms` is — a 10% error costs
        roughly 20 points of frame agreement — so the caller's estimate is the
        load-bearing part, not this call.
        """
        if duration_ms <= 0:
            return []
        if self._closed:
            raise AvatarsyncError("avatarsync engine is closed")
        if self._engine is None:
            await self.start()
        engine = self._engine
        if engine is None:
            raise AvatarsyncError("avatarsync engine is not running")
        try:
            return _cues_from(engine.text_cues(text, duration_ms))
        except NativeError as exc:
            raise AvatarsyncError(str(exc)) from exc

    async def audio_cues(self, pcm: bytes, sample_rate: int = 24000) -> list[Cue]:
        """The accurate leg over a finished clip, ~15-31 ms.

        Not what a call uses — a voice agent's audio is never finished when the
        mouth needs to move, which is what `open_stream` is for. This stays
        because the bench, the CLI and the review pages all have whole files, and
        because it is the reference a streamed decode is measured against.
        """
        if not pcm:
            return []
        return await self._run(NativeEngine.audio_cues, pcm, sample_rate)

    async def open_stream(self, sample_rate: int) -> _NativeVisemeStream | None:
        """A live decode, or `None` when every decoder is out.

        `None` is the expected answer under load and not an error: a decoder is
        ~55 MB held for the length of a turn rather than the ~30 ms of a batch
        decode, so the pool has a hard ceiling and refusing is how that ceiling
        is enforced. The caller runs the turn on predicted cues instead, which is
        the leg that is *already* correct for short turns.

        Opening is a pool checkout — microseconds warm, ~150 ms if the pool has
        to build a decoder — so it goes to the executor like everything else.
        """
        if self._closed:
            raise AvatarsyncError("avatarsync engine is closed")
        if self._engine is None:
            await self.start()
        engine, executor = self._engine, self._executor
        if engine is None or executor is None:
            raise AvatarsyncError("avatarsync engine is not running")
        loop = asyncio.get_running_loop()
        try:
            native = await loop.run_in_executor(executor, engine.open_stream, sample_rate)
        except NativeError as exc:
            raise AvatarsyncError(str(exc)) from exc
        except RuntimeError as exc:
            raise AvatarsyncError(f"avatarsync is shutting down ({exc})") from exc
        if native is None:
            return None
        return _NativeVisemeStream(native, executor)

    @property
    def live_streams(self) -> int:
        """Decoders currently checked out. The number the pool ceiling caps.

        Read straight off the engine rather than through the executor — it is an
        atomic int behind a mutex the native side holds for nanoseconds, and a
        gauge that has to queue behind a decode is a gauge that reads late
        exactly when it matters. Zero when nothing is loaded.
        """
        engine = self._engine
        return 0 if engine is None else engine.live_streams

    def lease(self) -> AvatarsyncLease:
        """A per-session handle on this engine."""
        return AvatarsyncLease(self)


class _NativeVisemeStream:
    """`VisemeStream` over a real decoder, every call on the engine's executor.

    Closing is the part that matters. An unclosed stream keeps ~55 MB and one of
    the pool's slots for the life of the process, so `close()` has to survive
    every way a turn can end — including the interesting one, where the task
    driving it is cancelled mid-`feed`. So close does not go through the
    executor: `run_in_executor` is a cancellable await, and a `close()` cancelled
    on its way to a worker thread is a leak that looks like tidy code.

    Which leaves the other half of that same case. Cancelling a
    `run_in_executor` stops the *await*, not the thread — the decode is still
    inside the native stream — and freeing it from under that is not an
    exception, it is a segfault. Hence `_call_lock`: every native call holds it,
    including the free. In the ordinary path it is uncontended (one stream is one
    turn is one caller); in the cancelled one it costs the event loop the tail of
    a single feed, low milliseconds.
    """

    def __init__(self, native: NativeStream, executor: ThreadPoolExecutor) -> None:
        self._native: NativeStream | None = native
        self._executor = executor
        self._call_lock = threading.Lock()

    def _live(self) -> NativeStream:
        if self._native is None:
            raise AvatarsyncError("this viseme stream is closed")
        return self._native

    def _call(self, fn, native, *args):
        with self._call_lock:
            return fn(native, *args)

    async def _run(self, fn, *args):
        native = self._live()
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(self._executor, self._call, fn, native, *args)
        except NativeError as exc:
            raise AvatarsyncError(str(exc)) from exc
        except RuntimeError as exc:
            raise AvatarsyncError(f"avatarsync is shutting down ({exc})") from exc

    async def feed(self, pcm: bytes) -> None:
        if pcm:
            await self._run(NativeStream.feed, pcm)

    async def cues(self, from_ms: int, hold_back_ms: int) -> list[Cue]:
        return _cues_from(await self._run(NativeStream.cues, from_ms, hold_back_ms))

    async def finish(self) -> list[Cue]:
        return _cues_from(await self._run(NativeStream.finish))

    async def close(self) -> None:
        native, self._native = self._native, None
        if native is not None:
            with self._call_lock:
                native.close()


class AvatarsyncLease:
    """One session's view of a shared engine: everything except the right to stop it.

    `VisemeEngine.aclose()` calls `stop()` on whatever runtime it was given, and
    that is correct when the engine is the session's own. Here it must not be —
    the next call is already using the loaded model. So `stop()` releases the
    lease and leaves the engine loaded, which is the one place this and
    `AvatarsyncEngine` genuinely differ. After it, requests raise rather than
    silently borrowing the engine again: a session that has closed should not
    still be emitting cues, and a quiet success would hide that.
    """

    def __init__(self, engine: AvatarsyncEngine) -> None:
        self._engine: AvatarsyncEngine | None = engine

    def _live(self) -> AvatarsyncEngine:
        if self._engine is None:
            raise AvatarsyncError("this session's lipsync lease is closed")
        return self._engine

    async def start(self) -> None:
        await self._live().start()

    async def stop(self) -> None:
        self._engine = None

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        return await self._live().text_cues(text, duration_ms)

    # No `audio_cues`. A lease is what a *session* holds, and a session's audio
    # is never finished when the mouth has to move — it streams, so it uses
    # `open_stream`. The batch call stays on `AvatarsyncEngine`, where the CLI
    # and the measurement scripts reach it with a whole file in hand.

    async def open_stream(self, sample_rate: int) -> _NativeVisemeStream | None:
        return await self._live().open_stream(sample_rate)


# The worker-wide engine. A module global rather than something threaded through
# `session.py` because its lifetime is the *process*, not any session or any
# composition root — the whole point is that call 31 finds the model already
# loaded by call 1. `build_viseme_engine` still takes an injected runtime, so
# nothing is forced through here in tests.
#
# Unlike the process pool this replaced, there is no event loop to record: a
# library handle is not bound to one. It survives a test suite that builds a
# fresh loop per test, and `stop_shared_engine` exists for symmetry and for
# suites that want the model unloaded, not because holding it is unsafe.
_shared_engine: AvatarsyncEngine | None = None


def shared_engine(
    paths: AvatarsyncPaths, *, workers: int = DEFAULT_WORKERS
) -> AvatarsyncEngine:
    """The worker's engine, created on first use.

    Only the first caller's `workers` counts; later ones get the existing engine.
    That the engine is worker-wide is a property of the resource — one 86 MB
    acoustic model per process — not a licence for its size to arrive from the
    environment.
    """
    global _shared_engine
    if _shared_engine is None:
        _shared_engine = AvatarsyncEngine(paths, workers=workers)
        logger.info("avatar: lipsync engine with {} decode worker(s)", workers)
    return _shared_engine


async def stop_shared_engine() -> None:
    """Unload the worker's engine. For process shutdown and for tests."""
    global _shared_engine
    engine, _shared_engine = _shared_engine, None
    if engine is not None:
        await engine.stop()


def _cues_from(raw: Iterable[tuple[int, str, str | None]]) -> list[Cue]:
    return [
        Cue(t=t, v=v if v in VISEME_LETTERS else SILENT, p=p)
        for t, v, p in raw
    ]


def shift(cues: Iterable[Cue], offset_ms: int) -> list[Cue]:
    """Move a cue track onto the turn's timeline."""
    return [Cue(t=cue.t + offset_ms, v=cue.v, p=cue.p) for cue in cues]
