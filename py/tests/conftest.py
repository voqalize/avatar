"""Fixtures for the avatar viseme tests.

Everything here runs against the **real** `libavatarsync`, loaded in process.
That is deliberate: the interesting failures in this subsystem — a decode that
returns nothing, cue tracks that are structurally valid and nonsense
phonetically, a phone that does not belong to the shape carrying it — are all
failures a stubbed aligner would happily reproduce as passes.

The library is committed per platform under `native/avatarsync/bin/`, but its
56 MB model tree is not — `native/avatarsync/build.sh --res-only` regenerates it.
So every library-dependent test skips with a message naming exactly what is
missing rather than failing, and a checkout that has not run the script yet is
still green. **A run with skips in it has not tested this subsystem**; that
applies just as much to a platform with no committed library as to a missing
model tree. Regenerate, or build, and re-run before believing it.

That was a docstring asking to be believed, and it was not: CI ran on Linux with
no Linux library committed, so ~40 tests — every one that touches the decoder —
skipped on every run and the job went green anyway. `AVATAR_REQUIRE_ALIGNER=1`
is the enforcement. Set it and the skip becomes a failure that names the missing
path. CI sets it; a laptop without the model tree does not have to.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import NoReturn

import pytest
import pytest_asyncio

from voqalize_avatar.avatarsync import (
    AvatarsyncEngine,
    AvatarsyncPaths,
    AvatarsyncUnavailableError,
    stop_shared_engine,
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
async def _release_shared_engine() -> AsyncIterator[None]:
    """Unload the worker-wide engine with the test that created it.

    Not a correctness fix any more — the engine holds no loop-bound state, so it
    would survive the fresh loop each test gets. It is here so a test that asks
    for `shared_engine` gets a fresh one, and so the suite does not finish
    holding 86 MB of acoustic model. The one thing it must not do is run before
    the loop that queued a decode has drained: `stop()` waits on the executor,
    which is what makes that safe.
    """
    yield
    await stop_shared_engine()


def _missing_aligner(why: str) -> NoReturn:
    """Skip, or fail when the run has declared that it is testing this for real.

    The distinction is the whole point: on a laptop that has not run
    `build.sh --res-only` a skip is correct and a failure is noise, while in CI a
    skip is the subsystem going untested behind a green check.
    """
    if os.environ.get("AVATAR_REQUIRE_ALIGNER"):
        pytest.fail(f"AVATAR_REQUIRE_ALIGNER is set and the aligner is unusable: {why}")
    pytest.skip(why)


@pytest.fixture(scope="session")
def aligner_paths() -> AvatarsyncPaths:
    """Library + model paths for this checkout, or a skip naming the missing one.

    `discover()` explicitly, because that is what a source checkout is: the
    artifact sits beside the Python. Nothing infers it for us, here or in
    production.
    """
    paths = AvatarsyncPaths.discover()
    if paths is None:
        _missing_aligner("no native/avatarsync directory above the package")
    try:
        paths.check()
    except AvatarsyncUnavailableError as exc:
        _missing_aligner(str(exc))
    return paths


@pytest_asyncio.fixture
async def aligner(aligner_paths: AvatarsyncPaths) -> AsyncIterator[AvatarsyncEngine]:
    """A loaded engine, unloaded after the test.

    Function-scoped, which now costs ~250 ms rather than the ~700 ms a process
    spawn did. Still worth it: an engine shared across tests would have to
    survive the ones that close it deliberately.
    """
    engine = AvatarsyncEngine(aligner_paths)
    await engine.start()
    try:
        yield engine
    finally:
        await engine.stop()
