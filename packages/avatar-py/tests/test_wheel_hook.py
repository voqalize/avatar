"""The build hook that decides whether a wheel is platform-specific.

This has no coverage anywhere else, and the gap was not theoretical. The hook
looked for a payload file named `avatarsync` — correct when the aligner was a
subprocess executable, dead the moment it became `libavatarsync.so`/`.dylib`.
Every build after that quietly took the pure branch while `artifacts` still
packed 44 MB of payload in, and the only thing that would ever have noticed is
`wheels.yml`, which refuses a `py3-none-any` wheel — i.e. a tag push, after npm
had already published its half.

So the predicate is tested against a *faked* bundle rather than a real one: the
point is the naming contract between `stage_native.py` and this hook, and that
contract is checkable without a compiler, on any machine, in milliseconds.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

PKG = Path(__file__).resolve().parents[1]


def _hook_class():
    """Load `hatch_build.py` by path — it sits at the package root, outside any
    importable package, because that is where hatchling looks for it."""
    spec = importlib.util.spec_from_file_location("hatch_build", PKG / "hatch_build.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["hatch_build"] = module
    spec.loader.exec_module(module)
    return module.NativeBundleHook


class _Hook:
    """Build the real hook. `root` and `target_name` are read-only properties on
    hatchling's interface, so they are fed through the constructor it declares
    rather than assigned — which also means this test fails if that signature
    changes under us, instead of testing a shape hatchling no longer builds."""

    @staticmethod
    def build(root: Path, target_name: str = "wheel"):
        return _hook_class()(
            str(root),
            {},  # config
            None,  # build_config
            None,  # metadata
            str(root / "dist"),  # directory
            target_name,
            None,  # app
        )


def _bundle(root: Path) -> Path:
    bundle = root / "src" / "voqalize_avatar" / "_native"
    bundle.mkdir(parents=True)
    return bundle


@pytest.mark.parametrize("library", ["libavatarsync.so", "libavatarsync.dylib"])
def test_a_staged_payload_makes_the_wheel_platform_specific(tmp_path: Path, library: str) -> None:
    bundle = _bundle(tmp_path)
    (bundle / library).write_bytes(b"\x7fELF not really")
    (bundle / "WHEEL_TAG").write_text("manylinux_2_28_x86_64\n")

    data: dict = {}
    _Hook.build(tmp_path).initialize("standard", data)

    # The three that together stop hatchling inferring `py3-none-any`.
    assert data["pure_python"] is False
    assert data["infer_tag"] is False
    assert data["tag"] == "py3-none-manylinux_2_28_x86_64"


def test_the_library_name_matches_what_staging_writes() -> None:
    """The regression itself: the hook's glob and `stage_native.library_name()`
    are two spellings of one fact, and they drifted once already."""
    spec = importlib.util.spec_from_file_location(
        "stage_native", PKG / "scripts" / "stage_native.py"
    )
    assert spec and spec.loader
    staging = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(staging)

    staged = staging.library_name()
    assert Path(staged).match("libavatarsync.*"), (
        f"stage_native.py writes {staged!r}, which hatch_build.py's glob will not see"
    )


def test_no_payload_leaves_the_wheel_pure(tmp_path: Path) -> None:
    _bundle(tmp_path)  # the directory exists; nothing is in it

    data: dict = {}
    _Hook.build(tmp_path).initialize("standard", data)

    assert data == {}


def test_a_payload_without_a_tag_is_not_trusted(tmp_path: Path) -> None:
    """`stage_native.py` writes the library and the tag in one pass, so a
    library with no `WHEEL_TAG` beside it is a half-finished stage, not a wheel
    to guess a platform for."""
    bundle = _bundle(tmp_path)
    (bundle / "libavatarsync.so").write_bytes(b"\x7fELF not really")

    data: dict = {}
    _Hook.build(tmp_path).initialize("standard", data)

    assert data == {}


def test_the_sdist_is_never_touched(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)
    (bundle / "libavatarsync.so").write_bytes(b"\x7fELF not really")
    (bundle / "WHEEL_TAG").write_text("macosx_11_0_arm64\n")

    data: dict = {}
    _Hook.build(tmp_path, target_name="sdist").initialize("standard", data)

    assert data == {}
