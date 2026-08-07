"""Fixtures for the avatar viseme tests.

Everything here runs against the **real** `avatarsync` binary over a real pipe.
That is deliberate: the interesting failures in this subsystem — a stuck request
wedging the queue, a crash losing in-flight work, cue tracks that are valid JSON
and nonsense phonetically — are all failures a stubbed subprocess would happily
reproduce as passes.

The binaries are committed (darwin-arm64 and linux-x64), but their 56 MB model
tree is not — `native/avatarsync/build.sh --res-only` regenerates it. So every
binary-dependent test skips with a message naming exactly what is missing
rather than failing, and a checkout that has not run the script yet is still
green. A run with skips in it has not tested this subsystem; regenerate and
re-run before believing it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voqalize_avatar.avatarsync import (
    RhubarbPaths,
    RhubarbRuntime,
    RhubarbUnavailableError,
    stop_shared_pool,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Provenance in fixtures/README.md. audio_ms is bytes/2/24000 exactly; these are
# pure speech, with none of the 250 ms inter-sentence pad the streaming wire
# adds.
CLIPS: dict[str, tuple[str, int]] = {
    "take-your-time": ("Take your time.", 937),
    "that-is-good-to-hear": ("That is good to hear.", 1266),
    "thank-you-for-your-time-today": ("Thank you for your time today.", 1639),
}

VOICE = "reference/a"


def load_clip(name: str) -> tuple[bytes, str, int]:
    """`(pcm, text, ms)` for one fixture clip."""
    text, ms = CLIPS[name]
    return (FIXTURES / f"{name}.pcm").read_bytes(), text, ms


def load_holdout() -> list[dict[str, object]]:
    return json.loads((FIXTURES / "duration_holdout.json").read_text())


@pytest_asyncio.fixture(autouse=True)
async def _no_pool_across_loops() -> AsyncIterator[None]:
    """End the worker-wide `avatarsync` pool with the test that started it.

    In production the pool's lifetime is the process, because the process has one
    event loop. Here every test gets a fresh loop, and a pool carried across that
    boundary owns a subprocess transport and a reader task belonging to a loop
    that has closed — it still reports `running`, and requests written into it
    are never answered. So it is torn down here, inside the loop that built it.
    """
    yield
    await stop_shared_pool()


@pytest.fixture(scope="session")
def rhubarb_paths() -> RhubarbPaths:
    """Resolved binary + model paths, or a skip naming the missing one."""
    try:
        paths = RhubarbPaths.resolve()
        paths.check()
    except RhubarbUnavailableError as exc:
        pytest.skip(str(exc))
    return paths


@pytest_asyncio.fixture
async def rhubarb(rhubarb_paths: RhubarbPaths) -> AsyncIterator[RhubarbRuntime]:
    """A started runtime, torn down after the test.

    Function-scoped: a session-scoped process would have to survive the tests
    that deliberately kill it, and startup is ~0.7 s, which is cheap enough that
    isolation is the better trade.
    """
    runtime = RhubarbRuntime(rhubarb_paths)
    await runtime.start()
    try:
        yield runtime
    finally:
        await runtime.stop()
