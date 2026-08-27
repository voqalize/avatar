"""Temporary CI-only repro for the Linux avs_open segfault. Not shipped.

Mirrors AvatarsyncEngine._load() exactly: NativeEngine() constructed from a
ThreadPoolExecutor worker thread, single warm decoder. Run under gdb to get a
native backtrace, since the Python faulthandler trace stops at the ctypes
call boundary.
"""

from concurrent.futures import ThreadPoolExecutor

from voqalize_avatar._native import NativeEngine
from voqalize_avatar.avatarsync import AvatarsyncPaths

paths = AvatarsyncPaths.discover()
assert paths is not None, "no native/avatarsync above this file"
paths.check()

weights = paths.weights


def load() -> None:
    NativeEngine(
        paths.library,
        res_dir=paths.res_dir,
        weights=weights if weights is not None and weights.is_file() else None,
        warmup_decoders=1,
    )


with ThreadPoolExecutor(max_workers=1) as ex:
    ex.submit(load).result()

print("OK: no crash")
