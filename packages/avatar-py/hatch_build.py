"""Turn the wheel platform-specific exactly when it carries a native payload.

Two artifacts come out of this package and they are not the same shape:

* a **platform wheel**, when `scripts/stage_native.py` has put a
  `libavatarsync` shared library and its model tree in
  `src/voqalize_avatar/_native/`. It is ~44 MB, it
  is tagged for the machines that binary runs on, and `pip install
  voqalize-avatar` on such a machine gives you working lipsync with no further
  steps. This is what CI publishes.

* a **pure wheel plus sdist**, when the payload is absent — a local `uv build`,
  or the sdist we publish so the source is installable anywhere. It is 64 KB and
  the viseme engine reports itself unavailable, which the library treats as an
  ordinary condition: the state channel runs and the widget falls back to its own
  amplitude lipsync.

The tag is not written here. `stage_native.py` derives it from the compiled
binary and leaves it in `_native/WHEEL_TAG`; this hook only reads it. That keeps
one rule in one place — the tag describes the binary, and nothing gets to assert
otherwise.
"""

from __future__ import annotations

from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class NativeBundleHook(BuildHookInterface):
    PLUGIN_NAME = "native-bundle"

    def initialize(self, version: str, build_data: dict) -> None:
        if self.target_name != "wheel":
            return

        bundle = Path(self.root) / "src" / "voqalize_avatar" / "_native"
        tag_file = bundle / "WHEEL_TAG"
        # Glob rather than a literal name, and the reason is a bug this line
        # carried for four commits: the payload used to be a subprocess
        # executable called `avatarsync`, and when it became a shared library
        # (`libavatarsync.so` / `.dylib`) only the staging script was updated.
        # The predicate went permanently false, so every build claimed to be
        # pure while `artifacts` stuffed 44 MB into it — caught by nothing,
        # because no test and no CI job builds a platform wheel. The extension
        # is the part that varies by platform, so it is the part not spelled out.
        if not any(bundle.glob("libavatarsync.*")) or not tag_file.is_file():
            return  # pure wheel; see the module docstring

        build_data["pure_python"] = False
        build_data["infer_tag"] = False
        # `py3-none-<platform>`: the Python is pure and the payload is not, so
        # the wheel is ABI-independent but platform-locked. One wheel serves
        # every supported interpreter on that platform.
        build_data["tag"] = f"py3-none-{tag_file.read_text().strip()}"
