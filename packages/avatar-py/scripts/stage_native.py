"""Stage the native aligner into the package, and work out the wheel tag it earns.

`pip install voqalize-avatar` has to give you lipsync. That means the shared
library and its 56 MB model tree ride inside the wheel, and the wheel has to be
*tagged* so that pip installs it only where the library actually loads.

The tag is the interesting part. Declaring it — writing `manylinux_2_28_x86_64`
in a workflow and hoping — is how you ship a wheel that installs cleanly and then
dies at the first sentence with a linker error on somebody's node. So this script
**reads the compiled library** and derives the tag from what it actually requires:
the highest versioned glibc symbol on Linux, the recorded deployment target on
macOS. If the library gets built somewhere newer, the tag moves on its own and
pip stops offering it to machines that cannot run it.

Run from anywhere; paths are resolved against the package:

    python packages/avatar-py/scripts/stage_native.py           # host platform
    python packages/avatar-py/scripts/stage_native.py --check   # report, stage nothing

The output lands in `packages/avatar-py/src/voqalize_avatar/_native/`, which is
gitignored — CI stages it immediately before building the wheel and it never
lives in git.
"""

from __future__ import annotations

import argparse
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

# Everything this script touches is inside the package it stages into: the
# aligner is `native/avatarsync` here, not two trees away, so both ends are one
# `parents[1]` from this file and neither can be reached by counting wrong.
PKG = Path(__file__).resolve().parents[1]
NATIVE = PKG / "native" / "avatarsync"
BUNDLE = PKG / "src" / "voqalize_avatar" / "_native"

# The floor macOS builds are pinned to, in `native/avatarsync/build.sh`. Checked
# rather than assumed: clang silently defaults this to the *host's* OS version,
# which produces a library that loads on the builder's mac and nowhere older.
MACOS_MIN = (11, 0)


def platform_id() -> str:
    """`darwin-arm64`, `linux-x64`, … — must match `avatarsync.platform_id`."""
    import platform as _p

    system = _p.system().lower()
    machine = _p.machine().lower()
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}
    return f"{system}-{arch.get(machine, machine)}"


def library_name() -> str:
    """Must match `_native.library_name` — duplicated rather than imported
    because this script runs before the package is installed anywhere."""
    import platform as _p

    return "libavatarsync.dylib" if _p.system() == "Darwin" else "libavatarsync.so"


# ── deriving the tag from the library ──────────────────────────────────────────


def _elf_arch(data: bytes) -> str:
    """The wheel's arch component, from the ELF header rather than the builder."""
    if data[:4] != b"\x7fELF":
        raise SystemExit("not an ELF object — is this really a Linux build?")
    (e_machine,) = struct.unpack_from("<H", data, 18)
    match e_machine:
        case 0x3E:
            return "x86_64"
        case 0xB7:
            return "aarch64"
        case other:
            raise SystemExit(f"unsupported ELF machine 0x{other:x}")


def _glibc_floor(data: bytes) -> tuple[int, int]:
    """Highest `GLIBC_x.y` this library references — the floor it can run on.

    A plain byte scan, which is what `strings | grep GLIBC_` does, and it needs
    no readelf on the build host. libstdc++ and libgcc are linked statically
    (see build.sh), so glibc is the whole of the dynamic story and a
    `manylinux_x_y` tag can express it exactly.
    """
    versions = {
        (int(major), int(minor))
        for major, minor in re.findall(rb"GLIBC_(\d+)\.(\d+)", data)
    }
    if not versions:
        raise SystemExit("no GLIBC_ symbols found — cannot derive a manylinux tag")
    return max(versions)


def _reject_dynamic_cxx(data: bytes, library: Path) -> None:
    """A wheel tag cannot express a libstdc++ floor, so there must not be one."""
    if re.search(rb"GLIBCXX_\d+\.\d+", data) or re.search(rb"CXXABI_\d+\.\d+", data):
        raise SystemExit(
            f"{library} links libstdc++ dynamically. A wheel tag can only express a\n"
            "glibc floor, so this would install on machines it cannot run on.\n"
            "Build with -static-libstdc++ -static-libgcc (build.sh does this)."
        )


def _macos_target(library: Path) -> tuple[int, int]:
    """The deployment target recorded in the Mach-O load commands."""
    out = subprocess.run(
        ["otool", "-l", str(library)], capture_output=True, text=True, check=True
    ).stdout
    found = re.search(r"^\s*minos\s+(\d+)(?:\.(\d+))?", out, re.MULTILINE)
    if not found:
        raise SystemExit("no LC_BUILD_VERSION minos in the library")
    return int(found.group(1)), int(found.group(2) or 0)


def _macos_arch(library: Path) -> str:
    out = subprocess.run(
        ["lipo", "-archs", str(library)], capture_output=True, text=True, check=True
    ).stdout.split()
    if len(out) != 1:
        raise SystemExit(f"expected a single-arch library, got {out}")
    return {"arm64": "arm64", "x86_64": "x86_64"}[out[0]]


def wheel_platform_tag(library: Path) -> str:
    data = library.read_bytes()
    if data[:4] == b"\x7fELF":
        _reject_dynamic_cxx(data, library)
        major, minor = _glibc_floor(data)
        return f"manylinux_{major}_{minor}_{_elf_arch(data)}"
    target = _macos_target(library)
    if target > MACOS_MIN:
        raise SystemExit(
            f"{library} is built for macOS {target[0]}.{target[1]}, above the "
            f"{MACOS_MIN[0]}.{MACOS_MIN[1]} floor. Clang defaults the deployment "
            "target to the host's OS version; build.sh pins it, so this library "
            "was not built by build.sh."
        )
    return f"macosx_{MACOS_MIN[0]}_{MACOS_MIN[1]}_{_macos_arch(library)}"


# ── staging ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report the tag, stage nothing")
    args = ap.parse_args()

    library = NATIVE / "bin" / platform_id() / library_name()
    res = NATIVE / "res"
    weights = NATIVE / "data" / "phone_weights.json"

    for path in (library, res / "sphinx" / "cmudict-en-us.dict", weights):
        if not path.exists():
            raise SystemExit(
                f"missing {path}\nRun native/avatarsync/build.sh (and --res-only "
                "for the model tree) before staging."
            )

    tag = wheel_platform_tag(library)
    if args.check:
        print(tag)
        return 0

    if BUNDLE.exists():
        shutil.rmtree(BUNDLE)
    BUNDLE.mkdir(parents=True)

    shutil.copy2(library, BUNDLE / library_name())
    shutil.copytree(res, BUNDLE / "res")
    shutil.copy2(weights, BUNDLE / "phone_weights.json")
    # The licences of everything statically linked into that library travel with
    # it, because the wheel is where it is actually distributed.
    shutil.copy2(NATIVE / "UPSTREAM-LICENSE.md", BUNDLE / "UPSTREAM-LICENSE.md")
    (BUNDLE / "WHEEL_TAG").write_text(tag + "\n")

    size = sum(f.stat().st_size for f in BUNDLE.rglob("*") if f.is_file())
    print(f"staged {size / 1048576:.0f} MB into {BUNDLE.relative_to(PKG)} as {tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
