"""The resident `avatarsync` process, driven from asyncio.

`native/avatarsync/` builds one binary that answers both viseme legs over a
JSON-lines pipe (its README has the protocol and the reasoning). This module is
the only thing in Python that knows the binary exists.

Three properties matter, and they are why this is a class rather than a
`subprocess.run` per request:

**It never blocks the event loop.** Everything goes through
`asyncio.create_subprocess_exec`. A synchronous `subprocess.run` would stall the
pipeline for the whole 15-31 ms of an audio request — on a runtime whose job is
to keep 20 ms audio frames flowing, that is a dropout, not a delay.

**The process outlives requests.** The resident cost is the whole point: an 82 MB
acoustic model behind the phonetic decoder and a 125 k-entry cmudict. Paying it
per request would put ~180 ms on every sentence (measured; see the avatar repo's
`experiments/rhubarb-textsync/README.md`), which is more than the audio leg's
entire budget.

**A crash is survivable and silent.** The binary is C++ over vendored
pocketsphinx; if it ever dies, the call must keep going with degraded visemes
rather than fail. The reader task fails every in-flight request with
`RhubarbError`, and the next request restarts the process. Callers are expected
to treat `RhubarbError` as "no cues this sentence", never as a call-ending
error.

Requests are served **sequentially by the binary** — it reads one line, answers,
reads the next. Concurrency here is therefore about not blocking, not about
parallelism: `id` correlation lets many callers await at once, and they are
served in arrival order. That also means a wedged request blocks everyone, which
is why a timeout restarts the process instead of just failing one future.

## Why the process is shared across sessions (`RhubarbPool`)

It used to be one process per session, which is the obvious thing and the wrong
one: the resident cost is ~86 MB of *acoustic model*, and it is per **decoder**,
not per session. Thirty concurrent calls meant thirty copies of the same
read-only tables — 2.6 GB to answer requests that each take 15-31 ms of CPU.

The arithmetic that settles it: a sentence costs ~25 ms of audio-leg work and
~0.4 ms of fast-leg work, and a session emits roughly one sentence every two
seconds while the agent is talking. At the ~30 sessions/node this is sized for
that is ~0.4 s of rhubarb per second of wall clock — well inside one process,
and two processes leave the same headroom at 60. Memory, not CPU, was the
binding constraint, and sharing removes it: 2 x 86 MB total, flat in the number
of sessions.

Two *independent* processes rather than one, so a wedged or crashed request
takes out half the capacity rather than all of it (`_request` restarts a stuck
process, and everything queued behind it on that pipe fails with it).

**Deliberately not done, and why.** Rhubarb can already thread inside a request
— `pocketSphinxTools.cpp` keeps a process-global, mutex-guarded `ObjectPool` of
decoders — but its `threadCount` is `min(maxThreadCount, n_utterances,
duration/5s)`, so a 2 s sentence is one utterance and threading is a no-op for
this workload. Worse, it does not help memory: each extra decoder allocates its
own means/variances/mdef on the private heap, measured at ~58 MB apiece. The
model *is* immutable after `gauden_dist_precompute` mutates `g->var` once at
init (the only other writer, `gauden_mllr_transform`, is never called), so it
could be shared — either by fork+COW from a parent that has already loaded it,
or by mmap'ing a precomputed image. Both are real wins if this ever needs to
scale past a couple of processes per node; neither is worth the C++ surgery at
the size we run. Recorded here so the next person does not re-derive it.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import platform
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import count
from pathlib import Path
from typing import Protocol

from loguru import logger

# The letters the widget understands: Rhubarb A-H plus X for silence.
# (avatar docs/contract-protocol.md § Speech.)
VISEME_LETTERS = frozenset("ABCDEFGHX")
SILENT = "X"

# How many `avatarsync` processes one worker process keeps resident. Two, sized
# for ~30 concurrent sessions per node with room to double — see the module
# docstring for the arithmetic and for why this is not a thread count.
DEFAULT_POOL_SIZE = 2


@dataclass(frozen=True, slots=True)
class Cue:
    """One mouth shape, `t` ms into whatever timeline the caller is building.

    Mirrors the wire cue `{t, v, i?}`. Intensity is omitted here: Rhubarb emits
    shape, not loudness, and the widget reads a missing `i` as 1.
    """

    t: int
    v: str


class RhubarbError(RuntimeError):
    """A request failed, timed out, or the process died under it."""


class RhubarbUnavailableError(RhubarbError):
    """No binary for this platform. Raised at start, never mid-request."""


def platform_id() -> str:
    """`darwin-arm64`, `linux-x64`, … — matches `native/avatarsync/build.sh`."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(machine)
    if arch is None:
        return f"{system}-{machine}"
    return f"{system}-{arch}"


# Where the wheel unpacks the native payload. A platform wheel carries exactly
# one binary — the wheel tag already says which platform — so there is no
# `bin/<platform>/` level here, unlike the source tree's `native/avatarsync`.
_BUNDLE_DIR = Path(__file__).resolve().parent / "_native"


@dataclass(frozen=True, slots=True)
class RhubarbPaths:
    """Where the binary and its 56 MB model tree live.

    **Nobody outside this package constructs one of these.** The platform wheel
    carries the binary and its model tree, so `locate()` finds them with no
    argument at all and the native half has no configuration surface. That is the
    point: a client developer installs one package and gets lipsync.

    `from_home` and `discover` exist for the one case the bundle cannot cover —
    a source checkout of this repo, where the binary is built rather than
    installed.

    **Nothing here reads the environment.** Two engines in one interpreter could
    not disagree about where the binary is, and the failure mode when a variable
    is absent is silence rather than an error at the call site.
    """

    binary: Path
    res_dir: Path
    weights: Path | None = None

    @classmethod
    def locate(cls) -> RhubarbPaths:
        """Where the aligner is on this machine: the wheel's payload, or, failing
        that, a source checkout of this repo.

        The one entry point `build_viseme_engine` uses, and it takes no argument
        on purpose — a client developer installs one package and gets lipsync.
        The checkout fallback exists so this repo's own tests and demos need no
        configuration either; from site-packages there is no `native/avatarsync`
        above us to find, so it costs an installed application nothing but a
        handful of `is_dir()` calls at pipeline start.

        Returns paths that may not exist — `check()` is what says so, with the
        actual missing path in the message.
        """
        return cls.bundled() or cls.discover() or cls._bundle_layout()

    @classmethod
    def _bundle_layout(cls) -> RhubarbPaths:
        return cls(
            binary=_BUNDLE_DIR / "avatarsync",
            res_dir=_BUNDLE_DIR / "res",
            weights=_BUNDLE_DIR / "phone_weights.json",
        )

    @classmethod
    def bundled(cls) -> RhubarbPaths | None:
        """The payload inside this wheel, or `None` on a platform we have no
        wheel for (or an install from the sdist, which carries no binary)."""
        binary = _BUNDLE_DIR / "avatarsync"
        if not binary.is_file():
            return None
        return cls(
            binary=binary,
            res_dir=_BUNDLE_DIR / "res",
            weights=_BUNDLE_DIR / "phone_weights.json",
        )

    @classmethod
    def from_home(cls, home: Path | str) -> RhubarbPaths:
        """A directory laid out like `native/avatarsync`.

            <home>/bin/<platform>/avatarsync
            <home>/res/sphinx/…
            <home>/data/phone_weights.json

        Which is exactly what `native/avatarsync/build.sh` produces and what a
        deploy unpacks its artifact into.
        """
        root = Path(home)
        return cls(
            binary=root / "bin" / platform_id() / "avatarsync",
            res_dir=root / "res",
            weights=root / "data" / "phone_weights.json",
        )

    @classmethod
    def discover(cls, start: Path | str | None = None) -> RhubarbPaths | None:
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
        if not self.binary.is_file():
            raise RhubarbUnavailableError(
                f"No avatarsync binary at {self.binary} (platform {platform_id()}). "
                "Install the platform wheel for this machine — the sdist carries "
                "no binary, and we publish no wheel for every platform."
            )
        # Some install paths lose the mode bits — a wheel unpacked by hand, a
        # `COPY` into an image, an artifact that went through a tar without
        # `-p`. The binary is ours and its location is inside our own package,
        # so repairing this is not overreach; failing the whole viseme stack
        # over a permission bit we can set would be.
        if not os.access(self.binary, os.X_OK):
            try:
                self.binary.chmod(self.binary.stat().st_mode | 0o111)
            except OSError as exc:
                raise RhubarbUnavailableError(
                    f"{self.binary} is not executable and could not be made so ({exc})."
                ) from exc
        dictionary = self.res_dir / "sphinx" / "cmudict-en-us.dict"
        if not dictionary.is_file():
            raise RhubarbUnavailableError(
                f"No pronunciation dictionary at {dictionary}. A platform wheel "
                "carries one; a source checkout needs "
                "native/avatarsync/build.sh --res-only."
            )


class VisemeRuntime(Protocol):
    """What `VisemeEngine` needs from whatever answers viseme requests.

    Structural, because there are now two implementations that are not related
    by inheritance: a `RhubarbRuntime` (one process, owned by its caller) and a
    `RhubarbPool.lease()` (a share of processes that outlive the session). The
    engine must not be able to tell them apart — in particular `stop()` means
    "I am done with this", not "kill the process".
    """

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]: ...

    async def audio_cues(self, pcm: bytes, sample_rate: int = 24000) -> list[Cue]: ...


class RhubarbRuntime:
    """Owns one `avatarsync` process and the request/response correlation on it.

    Not started in `__init__`: the first request starts it, so constructing the
    engine costs nothing on a call that never speaks.

    `paths` is required and has no default. Any default would have to guess, and
    a guess that misses *fails at construction* — deep inside a session start,
    which is exactly the wrong place. `RhubarbPaths.locate()` + `check()` is the
    front door, and `visemes.build_viseme_engine` walks through it first so a
    missing binary is a clean error before anything is constructed.
    """

    def __init__(
        self,
        paths: RhubarbPaths,
        *,
        request_timeout_s: float = 5.0,
        start_timeout_s: float = 30.0,
    ) -> None:
        self._paths = paths
        self.request_timeout_s = request_timeout_s
        self._start_timeout_s = start_timeout_s
        self._proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[dict[str, object]]] = {}
        self._ids = count(1)
        self._lock = asyncio.Lock()
        self._closed = False
        self.restarts = 0
        self.ready_info: dict[str, object] = {}

    # ---- lifecycle ---------------------------------------------------------

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    @property
    def pid(self) -> int | None:
        """The live process id, or None. Exposed so a supervisor (or a test) can
        kill it without reaching into the internals."""
        return self._proc.pid if self.running and self._proc is not None else None

    @property
    def inflight(self) -> int:
        """Requests written and not yet answered — the binary serves these one at
        a time, so this is queue depth, and it is what `RhubarbPool` balances on."""
        return len(self._pending)

    async def start(self) -> None:
        """Spawn and wait for the ready line. Idempotent."""
        async with self._lock:
            await self._start_locked()

    async def _start_locked(self) -> None:
        if self.running:
            return
        self._paths.check()

        argv = [str(self._paths.binary), "--res", str(self._paths.res_dir)]
        if self._paths.weights and self._paths.weights.is_file():
            argv += ["--weights", str(self._paths.weights)]

        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdout is not None
        try:
            line = await asyncio.wait_for(proc.stdout.readline(), self._start_timeout_s)
        except TimeoutError as exc:
            proc.kill()
            raise RhubarbError("avatarsync did not report ready in time") from exc

        info = json.loads(line) if line else {}
        if not info.get("ready"):
            proc.kill()
            raise RhubarbError(f"avatarsync failed to start: {info.get('error', 'no ready line')}")

        self._proc = proc
        self.ready_info = info
        self._reader_task = asyncio.create_task(self._read_responses(proc))
        self._stderr_task = asyncio.create_task(self._drain_stderr(proc))
        # warmup_ms near zero means the acoustic model never loaded — the first
        # real audio request will pay ~180 ms instead of the usual ~20.
        logger.info(
            "avatarsync ready: dict={} load_ms={} warmup_ms={}",
            info.get("dict_entries"),
            info.get("load_ms"),
            info.get("warmup_ms"),
        )

    async def stop(self) -> None:
        """Shut down for good. Later requests raise rather than respawn."""
        async with self._lock:
            self._closed = True
            await self._teardown(RhubarbError("avatarsync stopped"))

    async def _teardown(self, reason: BaseException) -> None:
        proc, self._proc = self._proc, None
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
        self._reader_task = self._stderr_task = None
        if proc is not None and proc.returncode is None:
            if proc.stdin is not None and not proc.stdin.is_closing():
                proc.stdin.close()
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 2.0)
            except TimeoutError:
                proc.kill()
        self._fail_pending(reason)

    def _fail_pending(self, reason: BaseException) -> None:
        pending, self._pending = self._pending, {}
        for future in pending.values():
            if not future.done():
                future.set_exception(reason)

    # ---- plumbing ----------------------------------------------------------

    async def _read_responses(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            try:
                message = json.loads(line)
            except ValueError:
                logger.warning("avatarsync emitted a non-JSON line: {!r}", line[:200])
                continue
            request_id = message.get("id")
            future = self._pending.pop(int(request_id), None) if request_id is not None else None
            # A response with no waiter is a request that already timed out.
            # Dropping it is correct; the process is still in sync because
            # correlation is by id, not by position.
            if future is not None and not future.done():
                future.set_result(message)

        # EOF: the process exited. Everything in flight is lost.
        logger.warning("avatarsync exited (rc={})", proc.returncode)
        self._proc = None
        self._fail_pending(RhubarbError("avatarsync exited"))

    async def _drain_stderr(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                return
            logger.debug("avatarsync: {}", line.decode(errors="replace").rstrip())

    async def _request(self, payload: dict[str, object]) -> dict[str, object]:
        if self._closed:
            raise RhubarbError("avatarsync runtime is closed")
        if not self.running:
            async with self._lock:
                if not self.running and not self._closed:
                    if self._proc is not None or self.ready_info:
                        self.restarts += 1
                        logger.info("restarting avatarsync (restart #{})", self.restarts)
                    await self._start_locked()
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise RhubarbError("avatarsync is not running")

        request_id = next(self._ids)
        future: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        # One write() call per request: StreamWriter appends to its buffer
        # synchronously, so a whole line lands atomically and concurrent callers
        # cannot interleave halves of two requests.
        proc.stdin.write((json.dumps({"id": request_id, **payload}) + "\n").encode())
        try:
            await proc.stdin.drain()
            message = await asyncio.wait_for(future, self.request_timeout_s)
        except TimeoutError as exc:
            self._pending.pop(request_id, None)
            # The binary serves requests one at a time, so a stuck request stalls
            # every later one. Restart rather than leave the queue wedged.
            async with self._lock:
                await self._teardown(RhubarbError("avatarsync timed out"))
            raise RhubarbError(f"avatarsync timed out after {self.request_timeout_s}s") from exc
        except (BrokenPipeError, ConnectionResetError) as exc:
            self._pending.pop(request_id, None)
            raise RhubarbError("avatarsync pipe broke") from exc

        error = message.get("error")
        if error:
            raise RhubarbError(str(error))
        return message

    # ---- the two legs ------------------------------------------------------

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        """The fast leg: cues for `text` stretched to `duration_ms`, ~0.4 ms.

        Accuracy is dominated by how right `duration_ms` is — a 10% error costs
        roughly 20 points of frame agreement — so the caller's estimate is the
        load-bearing part, not this call.
        """
        if duration_ms <= 0:
            return []
        message = await self._request({"op": "text", "ms": int(duration_ms), "text": text})
        return _cues_from(message)

    async def audio_cues(self, pcm: bytes, sample_rate: int = 24000) -> list[Cue]:
        """The accurate leg: real recognition over s16le mono PCM, ~15-31 ms."""
        if not pcm:
            return []
        message = await self._request(
            {
                "op": "audio",
                "sr": int(sample_rate),
                "pcm": base64.b64encode(pcm).decode("ascii"),
            }
        )
        return _cues_from(message)

    async def ping(self) -> bool:
        message = await self._request({"op": "ping"})
        return bool(message.get("pong"))


class RhubarbPool:
    """A few `avatarsync` processes, shared by every session in this worker.

    One per session was 86 MB per session; this is 86 MB per *process*, flat in
    the number of calls. The module docstring has the sizing and the reasons the
    alternatives (threads, fork, mmap) were left on the shelf.

    Dispatch is least-inflight. Not round-robin: the two legs differ by two
    orders of magnitude in cost (~0.4 ms predicted, ~15-31 ms recognised), so a
    positional rotation would routinely queue a fast-leg request behind an audio
    leg while the other process sat idle — and the fast leg is the one with a
    deadline measured against time-to-first-audio.
    """

    def __init__(
        self,
        paths: RhubarbPaths,
        *,
        size: int = DEFAULT_POOL_SIZE,
        request_timeout_s: float = 5.0,
        start_timeout_s: float = 30.0,
    ) -> None:
        self._runtimes = [
            RhubarbRuntime(
                paths, request_timeout_s=request_timeout_s, start_timeout_s=start_timeout_s
            )
            for _ in range(max(1, size))
        ]

    @property
    def runtimes(self) -> list[RhubarbRuntime]:
        """Introspection for tests and the log line. Not for dispatch."""
        return list(self._runtimes)

    def _pick(self) -> RhubarbRuntime:
        return min(self._runtimes, key=lambda r: r.inflight)

    async def start(self) -> None:
        """Spawn every process. Idempotent, and concurrent — the ~250 ms model
        load is paid once in parallel rather than `size` times in series."""
        await asyncio.gather(*(runtime.start() for runtime in self._runtimes))

    async def stop(self) -> None:
        """Shut the whole pool down. Called at worker shutdown, never by a
        session — see `lease()`."""
        await asyncio.gather(
            *(runtime.stop() for runtime in self._runtimes), return_exceptions=True
        )

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        return await self._pick().text_cues(text, duration_ms)

    async def audio_cues(self, pcm: bytes, sample_rate: int = 24000) -> list[Cue]:
        return await self._pick().audio_cues(pcm, sample_rate)

    def lease(self) -> RhubarbLease:
        """A per-session handle on this pool."""
        return RhubarbLease(self)


class RhubarbLease:
    """One session's view of a shared pool: everything except the right to stop it.

    `VisemeEngine.aclose()` calls `stop()` on whatever runtime it was given, and
    that is correct when the engine owns the process. Here it must not be — the
    next call is already using it. So `stop()` releases the lease and leaves the
    processes running, which is the one place this and `RhubarbRuntime` genuinely
    differ. After it, requests raise rather than silently borrowing the pool
    again: a session that has closed should not still be emitting cues, and a
    quiet success would hide that.
    """

    def __init__(self, pool: RhubarbPool) -> None:
        self._pool: RhubarbPool | None = pool

    def _live(self) -> RhubarbPool:
        if self._pool is None:
            raise RhubarbError("this session's lipsync lease is closed")
        return self._pool

    async def start(self) -> None:
        await self._live().start()

    async def stop(self) -> None:
        self._pool = None

    async def text_cues(self, text: str, duration_ms: int) -> list[Cue]:
        return await self._live().text_cues(text, duration_ms)

    async def audio_cues(self, pcm: bytes, sample_rate: int = 24000) -> list[Cue]:
        return await self._live().audio_cues(pcm, sample_rate)


# The worker-wide pool. A module global rather than something threaded through
# `session.py` because its lifetime is the *process*, not any session or any
# composition root — the whole point is that call 31 finds the model already
# loaded by call 1. `build_viseme_engine` still takes an injected runtime, so
# nothing is forced through here in tests.
#
# Strictly, its lifetime is the *event loop*: a subprocess transport, its reader
# task and every pending future belong to the loop that made them, and on a
# closed loop they are dead weight that still reports `running`. Production has
# one loop per process so the distinction never comes up; a test suite has one
# per test, and a pool held across that boundary answers with a pipe nobody is
# reading. Hence the recorded loop, and `stop_shared_pool` for tests.
_shared_pool: RhubarbPool | None = None
_shared_pool_loop: asyncio.AbstractEventLoop | None = None


def shared_pool(paths: RhubarbPaths, *, size: int = DEFAULT_POOL_SIZE) -> RhubarbPool:
    """The worker's pool, created on first use.

    Only the first caller's `size` counts; later ones get the existing pool,
    because resizing would mean deciding what to do with the requests in flight
    on a process nobody wants any more. That the pool is worker-wide is a
    property of the resource — one 86 MB acoustic model per process — not a
    licence for its size to arrive from the environment.
    """
    global _shared_pool, _shared_pool_loop
    try:
        loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
    except RuntimeError:
        # Constructed outside a loop (a bare unit test). Nothing has spawned
        # yet, so there is no binding to check.
        loop = None
    if _shared_pool is not None and loop is not None and _shared_pool_loop is not loop:
        # Only reachable from a test that forgot `stop_shared_pool`. Rebuilding
        # is the safe answer — the alternative is writing requests into a pipe on
        # a closed loop, which hangs until the request timeout rather than
        # failing — but the old processes are now unreachable, so say so.
        logger.warning("avatar: lipsync pool rebuilt on a new event loop; the old one is orphaned")
        _shared_pool = None
    if _shared_pool is None:
        _shared_pool = RhubarbPool(paths, size=size)
        _shared_pool_loop = loop
        logger.info("avatar: lipsync pool of {} avatarsync process(es)", size)
    return _shared_pool


async def stop_shared_pool() -> None:
    """Tear the worker's pool down. For process shutdown and for tests."""
    global _shared_pool, _shared_pool_loop
    pool, _shared_pool, _shared_pool_loop = _shared_pool, None, None
    if pool is not None:
        await pool.stop()


def _cues_from(message: dict[str, object]) -> list[Cue]:
    raw = message.get("cues")
    if not isinstance(raw, list):
        return []
    cues: list[Cue] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        letter = str(item.get("v", SILENT))
        cues.append(Cue(t=int(item.get("t", 0)), v=letter if letter in VISEME_LETTERS else SILENT))
    return cues


def shift(cues: Iterable[Cue], offset_ms: int) -> list[Cue]:
    """Move a cue track onto the turn's timeline."""
    return [Cue(t=cue.t + offset_ms, v=cue.v) for cue in cues]
