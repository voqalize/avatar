"""ctypes binding for `libavatarsync`. Blocking, synchronous, no asyncio.

This is the whole of what Python knows about the native half. It is deliberately
dumb: declarations, one class that owns a handle, and the two calls. Everything
about *when* to call it lives in `avatarsync.py`.

**Why ctypes and not an extension module.** An extension has to be built against
a Python ABI, which means either a wheel per interpreter version or the abi3
dance, and it has to be compiled by whoever installs the sdist. ctypes loads a
plain `.so`/`.dylib` that we build once per platform, with no compiler on the
user's machine and no Python version in the matrix.

**Why this is safe to call from a thread.** ctypes releases the GIL around every
foreign call. So `await asyncio.to_thread(engine.audio_cues, pcm)` genuinely runs
the decoder on another core while the event loop keeps moving 20 ms audio frames
— which was the entire justification for the subprocess this replaces, obtained
here for free. The engine itself is safe under concurrent calls: the fast leg
touches only immutable state, and the accurate leg takes a decoder per caller
from a pool whose mutex is held only around the handout. Two decodes measured at
2x the CPU for 1.02x the wall clock, which is what "off the event loop" has to
mean to be worth anything.
"""

from __future__ import annotations

import ctypes
import platform
from ctypes import POINTER, byref, c_char_p, c_double, c_int8, c_int32, c_size_t, c_void_p
from pathlib import Path

# The ABI this module was written against. `avs_abi_version()` returning
# anything else means the library on disk is not the one this file describes,
# which is a mis-staged wheel or a stale build — a crash later, so fail now.
ABI_VERSION = 3

_ERR_LEN = 512


def library_name() -> str:
    return "libavatarsync.dylib" if platform.system() == "Darwin" else "libavatarsync.so"


class _Cue(ctypes.Structure):
    _fields_ = [
        ("t_ms", c_int32),
        ("shape", c_int8),
        ("phone", c_int8),
    ]


class _Config(ctypes.Structure):
    _fields_ = [
        ("res_dir", c_char_p),
        ("dict_path", c_char_p),
        ("weights_path", c_char_p),
        ("lead_ms", c_int32),
        ("trail_ms", c_int32),
        ("trail_frac", c_double),
        ("word_gap_ms", c_int32),
        ("pause_rest_ms", c_int32),
        ("extended_shapes", c_int32),
        ("warmup_decoders", c_int32),
        ("max_streams", c_int32),
    ]


class NativeError(RuntimeError):
    """The library said no. Carries its message verbatim."""


def _bind(lib: ctypes.CDLL) -> None:
    lib.avs_config_defaults.argtypes = [POINTER(_Config)]
    lib.avs_config_defaults.restype = None

    lib.avs_open.argtypes = [POINTER(_Config), c_char_p, c_size_t]
    lib.avs_open.restype = c_void_p

    lib.avs_close.argtypes = [c_void_p]
    lib.avs_close.restype = None

    lib.avs_text_cues.argtypes = [
        c_void_p, c_char_p, c_int32, POINTER(POINTER(_Cue)), POINTER(c_int32), c_char_p, c_size_t
    ]
    lib.avs_text_cues.restype = c_int32

    # `pcm` is declared c_char_p so a Python `bytes` can be handed straight to
    # it with no copy and no intermediate array — ctypes passes a pointer to the
    # object's own buffer. The C side reads it as `const int16_t*` and takes the
    # length separately, so the NUL-termination c_char_p usually implies is
    # irrelevant here; PCM is full of zero bytes and none of them terminate
    # anything.
    lib.avs_audio_cues.argtypes = [
        c_void_p, c_char_p, c_int32, c_int32,
        POINTER(POINTER(_Cue)), POINTER(c_int32), c_char_p, c_size_t,
    ]
    lib.avs_audio_cues.restype = c_int32

    lib.avs_free_cues.argtypes = [POINTER(_Cue)]
    lib.avs_free_cues.restype = None

    lib.avs_stream_open.argtypes = [c_void_p, c_int32, c_char_p, c_size_t]
    lib.avs_stream_open.restype = c_void_p

    lib.avs_stream_feed.argtypes = [c_void_p, c_char_p, c_int32, c_char_p, c_size_t]
    lib.avs_stream_feed.restype = c_int32

    lib.avs_stream_cues.argtypes = [
        c_void_p, c_int32, c_int32,
        POINTER(POINTER(_Cue)), POINTER(c_int32), c_char_p, c_size_t,
    ]
    lib.avs_stream_cues.restype = c_int32

    lib.avs_stream_finish.argtypes = [
        c_void_p, POINTER(POINTER(_Cue)), POINTER(c_int32), c_char_p, c_size_t
    ]
    lib.avs_stream_finish.restype = c_int32

    # `avs_stream_edge_ms` is deliberately not bound. The engine takes the edge
    # from what it has *fed* (visemes.py, "the hold-back") so that both halves of
    # an emission agree on one number; asking the decoder for its own would give
    # a second, slightly different edge and an invitation to mix them.

    lib.avs_stream_close.argtypes = [c_void_p]
    lib.avs_stream_close.restype = None

    lib.avs_dict_entries.argtypes = [c_void_p]
    lib.avs_dict_entries.restype = c_int32
    for name in ("avs_live_streams", "avs_max_streams"):
        fn = getattr(lib, name)
        fn.argtypes = [c_void_p]
        fn.restype = c_int32
    for name in ("avs_load_ms", "avs_warmup_ms"):
        fn = getattr(lib, name)
        fn.argtypes = [c_void_p]
        fn.restype = c_double

    for name in ("avs_shape_name", "avs_phone_name"):
        fn = getattr(lib, name)
        fn.argtypes = [c_int32]
        fn.restype = c_char_p
    for name in ("avs_shape_count", "avs_phone_count", "avs_abi_version"):
        fn = getattr(lib, name)
        fn.argtypes = []
        fn.restype = c_int32


class NativeEngine:
    """A handle on one native engine. Blocking; wrap it, do not await it.

    Opening loads a 125k-entry dictionary and one 52 MB acoustic model per
    `warmup_decoders`, so this is a process-lifetime object, not a per-request
    one.
    """

    def __init__(
        self,
        library: Path,
        *,
        res_dir: Path,
        weights: Path | None = None,
        lead_ms: int | None = None,
        trail_ms: int | None = None,
        trail_frac: float | None = None,
        word_gap_ms: int | None = None,
        pause_rest_ms: int | None = None,
        extended_shapes: bool = True,
        warmup_decoders: int = 1,
    ) -> None:
        # RTLD_LOCAL (ctypes' default) matters more than it looks: the library
        # statically links pocketsphinx, and its C symbols would otherwise join
        # the global namespace of a process that may have its own.
        lib = ctypes.CDLL(str(library))
        _bind(lib)

        found = lib.avs_abi_version()
        if found != ABI_VERSION:
            raise NativeError(
                f"{library} speaks ABI version {found}, this binding speaks {ABI_VERSION}. "
                "The library and the Python package are from different builds."
            )

        config = _Config()
        lib.avs_config_defaults(byref(config))
        # Kept as bytes on self: c_char_p stores a borrowed pointer, so letting
        # the temporary bytes objects die here would leave config pointing into
        # freed memory. The engine reads them during avs_open only, but that is
        # not a difference worth betting a segfault on.
        self._strings = [
            str(res_dir).encode(),
            str(weights).encode() if weights is not None else None,
        ]
        config.res_dir = self._strings[0]
        config.weights_path = self._strings[1]
        if lead_ms is not None:
            config.lead_ms = lead_ms
        if trail_ms is not None:
            config.trail_ms = trail_ms
        if trail_frac is not None:
            config.trail_frac = trail_frac
        if word_gap_ms is not None:
            config.word_gap_ms = word_gap_ms
        if pause_rest_ms is not None:
            config.pause_rest_ms = pause_rest_ms
        config.extended_shapes = 1 if extended_shapes else 0
        # A count, not a flag. The decoder pool builds one decoder per concurrent
        # caller, so opening with fewer than the executor has threads means the
        # first two simultaneous sentences of the process pay ~140 ms of ps_init
        # between them. Pass the worker count and the cost lands at start.
        config.warmup_decoders = max(0, warmup_decoders)
        # `max_streams` keeps the library's own default. It is the pool ceiling
        # — the hard memory bound at ~55 MB a decoder — and nothing above here
        # has ever wanted a different one, so it is read back below rather than
        # configured. Setting it needs a caller with a reason, not a parameter
        # sitting open in case one appears.

        err = ctypes.create_string_buffer(_ERR_LEN)
        handle = lib.avs_open(byref(config), err, _ERR_LEN)
        if not handle:
            raise NativeError(err.value.decode(errors="replace") or "avs_open failed")

        self._lib = lib
        self._handle: int | None = handle
        # Built from the library rather than hard-coded, so the enum order can
        # only ever be wrong in one place.
        self.shape_names: tuple[str, ...] = tuple(
            lib.avs_shape_name(i).decode() for i in range(lib.avs_shape_count())
        )
        self.phone_names: tuple[str, ...] = tuple(
            lib.avs_phone_name(i).decode() for i in range(lib.avs_phone_count())
        )
        self.dict_entries = int(lib.avs_dict_entries(handle))
        self.load_ms = float(lib.avs_load_ms(handle))
        self.warmup_ms = float(lib.avs_warmup_ms(handle))
        self.max_streams = int(lib.avs_max_streams(handle))

    def close(self) -> None:
        handle, self._handle = self._handle, None
        if handle is not None:
            self._lib.avs_close(handle)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:  # pragma: no cover - interpreter teardown
            pass

    def _live(self) -> int:
        if self._handle is None:
            raise NativeError("engine is closed")
        return self._handle

    def _collect(
        self, cues: "POINTER(_Cue)", count: int
    ) -> list[tuple[int, str, str | None]]:
        """Copy the native array out and free it, in one place so no early
        return can leak it."""
        try:
            if count <= 0:
                return []
            array = ctypes.cast(cues, POINTER(_Cue * count)).contents
            shapes = self.shape_names
            phones = self.phone_names
            return [
                (
                    int(cue.t_ms),
                    shapes[cue.shape] if 0 <= cue.shape < len(shapes) else "X",
                    phones[cue.phone] if 0 <= cue.phone < len(phones) else None,
                )
                for cue in array
            ]
        finally:
            self._lib.avs_free_cues(cues)

    def text_cues(self, text: str, duration_ms: int) -> list[tuple[int, str, str | None]]:
        """The fast leg. ~0.15 ms — cheap enough to call on the event loop."""
        out = POINTER(_Cue)()
        count = c_int32(0)
        err = ctypes.create_string_buffer(_ERR_LEN)
        failed = self._lib.avs_text_cues(
            self._live(), text.encode(), int(duration_ms), byref(out), byref(count), err, _ERR_LEN
        )
        if failed:
            raise NativeError(err.value.decode(errors="replace"))
        return self._collect(out, count.value)

    def audio_cues(
        self, pcm: bytes, sample_rate: int = 24000
    ) -> list[tuple[int, str, str | None]]:
        """The accurate leg. ~27 ms of CPU per second of audio — always call this
        through `asyncio.to_thread`, never inline."""
        out = POINTER(_Cue)()
        count = c_int32(0)
        err = ctypes.create_string_buffer(_ERR_LEN)
        failed = self._lib.avs_audio_cues(
            self._live(),
            pcm,
            len(pcm) // 2,
            int(sample_rate),
            byref(out),
            byref(count),
            err,
            _ERR_LEN,
        )
        if failed:
            raise NativeError(err.value.decode(errors="replace"))
        return self._collect(out, count.value)

    @property
    def live_streams(self) -> int:
        return int(self._lib.avs_live_streams(self._live()))

    def open_stream(self, sample_rate: int) -> "NativeStream | None":
        """A live decode, or None when the pool is full.

        None is the documented answer under load, not an error: the caller drops
        to the fast leg for that turn. Raises only for a real failure — a rate
        below 16 kHz, or a closed engine.
        """
        err = ctypes.create_string_buffer(_ERR_LEN)
        handle = self._lib.avs_stream_open(self._live(), int(sample_rate), err, _ERR_LEN)
        if not handle:
            message = err.value.decode(errors="replace")
            if message:
                raise NativeError(message)
            return None
        return NativeStream(self, handle)


class NativeStream:
    """One live decode. Blocking, and NOT thread-safe.

    Everything here belongs on the same executor thread: `feed` and `cues` share
    decoder state that has no lock around it, on purpose — a stream is one
    speaking turn and a turn has one driver. Two turns at once are two streams.

    Always `close()`, including after an error or a barge-in. A leaked stream
    holds ~55 MB and one of the engine's stream slots until the process exits,
    and the pool is exactly the mechanism that is supposed to make that bounded.
    """

    def __init__(self, engine: NativeEngine, handle: int) -> None:
        self._engine = engine
        self._lib = engine._lib
        self._handle: int | None = handle

    def _live(self) -> int:
        if self._handle is None:
            raise NativeError("stream is closed")
        return self._handle

    def feed(self, pcm: bytes) -> None:
        """Append PCM at the stream's rate. Call through `run_in_executor`."""
        err = ctypes.create_string_buffer(_ERR_LEN)
        failed = self._lib.avs_stream_feed(self._live(), pcm, len(pcm) // 2, err, _ERR_LEN)
        if failed:
            raise NativeError(err.value.decode(errors="replace"))

    def cues(
        self, from_ms: int = 0, hold_back_ms: int = 100
    ) -> list[tuple[int, str, str | None]]:
        """The timeline from `from_ms`, ending `hold_back_ms` before the edge.

        Always the whole timeline from that point, never a delta — the wire
        primitive downstream is "discard from `from_ms`, then append", so a cue
        the decoder revises costs only the frames already drawn.
        """
        out = POINTER(_Cue)()
        count = c_int32(0)
        err = ctypes.create_string_buffer(_ERR_LEN)
        failed = self._lib.avs_stream_cues(
            self._live(),
            int(from_ms),
            int(hold_back_ms),
            byref(out),
            byref(count),
            err,
            _ERR_LEN,
        )
        if failed:
            raise NativeError(err.value.decode(errors="replace"))
        return self._engine._collect(out, count.value)

    def finish(self) -> list[tuple[int, str, str | None]]:
        """Everything to the true end, no hold-back. `feed`/`cues` are done."""
        out = POINTER(_Cue)()
        count = c_int32(0)
        err = ctypes.create_string_buffer(_ERR_LEN)
        failed = self._lib.avs_stream_finish(
            self._live(), byref(out), byref(count), err, _ERR_LEN
        )
        if failed:
            raise NativeError(err.value.decode(errors="replace"))
        return self._engine._collect(out, count.value)

    def close(self) -> None:
        handle, self._handle = self._handle, None
        if handle is not None:
            self._lib.avs_stream_close(handle)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:  # pragma: no cover - interpreter teardown
            pass
