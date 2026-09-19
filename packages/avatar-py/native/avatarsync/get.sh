#!/usr/bin/env bash
# Fetch a prebuilt aligner for this machine — library, model tree and all — out
# of a published `voqalize-avatar` wheel. No compiler, no Boost, no 85 MB
# upstream tarball.
#
#   ./get.sh                   # the version this checkout releases as
#   ./get.sh --version 0.3.1   # some other published release
#   ./get.sh --check           # say what would be fetched, write nothing
#
# **Why a wheel and not a release asset.** The wheels are the artifact this repo
# already builds, tags, tests and publishes on every release; a second channel
# for the same bytes is a second thing that can be stale. A wheel is also the
# only pinnable form — GitHub Actions artifacts expire after 90 days, so a
# `gh run download` line in a README stops working on a schedule.
#
# **What it writes**, into this directory, matching what `build.sh` produces so
# that `AvatarsyncPaths.discover` finds either the same way:
#
#   bin/<platform>/libavatarsync.<so|dylib>
#   res/sphinx/…
#
# It deliberately does NOT write `bin/<platform>/avatarsync.recipe`. A recipe is
# a claim about a local compile: `build.sh` is the only thing that writes one,
# and only after really compiling. A fetched library has not been through that,
# and inventing a recipe for it would make the one file whose job is to prove
# provenance lie. Absence is the honest answer — no recipe means no local
# compile, which is exactly what happened.
#
# If you are changing `src/*.cpp` or the patch, this script is not for you:
# use `build.sh`, which is the only thing that can compile what you just wrote.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Two up is the Python package: the aligner lives inside the package whose
# wheel ships it.
PKG="$(cd "$HERE/../.." && pwd)"

version=""
asked_for_a_version=0
check_only=0
while [ $# -gt 0 ]; do
	case "$1" in
		--version) version="${2:?--version needs a value}"; asked_for_a_version=1; shift 2 ;;
		--check) check_only=1; shift ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

# Default to the version this checkout *is*, not a hard-coded pin. A pin in this
# file would be a fourth place the version lives (packages/avatar/package.json,
# pyproject.toml,
# the tag) and the one nobody would remember to move.
if [ -z "$version" ]; then
	version=$(grep -m1 '^version = ' "$PKG/pyproject.toml" | cut -d'"' -f2)
fi

case "$(uname -s)" in
	Darwin) platform_os=darwin; libname=libavatarsync.dylib ;;
	Linux)  platform_os=linux;  libname=libavatarsync.so ;;
	*) echo "no wheels are published for $(uname -s); use ./build.sh" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	arm64|aarch64) platform_arch=arm64 ;;
	x86_64|amd64)  platform_arch=x64 ;;
	*) echo "no wheels are published for $(uname -m); use ./build.sh" >&2; exit 1 ;;
esac
PLATFORM="$platform_os-$platform_arch"

echo "voqalize-avatar==$version  ->  $HERE/bin/$PLATFORM/$libname + res/"
[ "$check_only" = 1 ] && exit 0

command -v uv >/dev/null 2>&1 || {
	echo "uv is not installed: https://docs.astral.sh/uv/getting-started/" >&2
	exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# `--no-deps` because we want the payload, not pipecat and its tree. uv picks the
# wheel matching this interpreter and platform, which is the whole point: the
# tag was derived from what the library actually requires
# (packages/avatar-py/scripts/stage_native.py), so an incompatible wheel is never offered.
if ! uv pip install --no-deps --quiet --target "$TMP" "voqalize-avatar==$version" 2>"$TMP/err"; then
	echo "could not download voqalize-avatar==$version:" >&2
	sed 's/^/  /' "$TMP/err" >&2
	echo "" >&2
	# The default version is what this checkout *is*, so between a version bump
	# and its `py-v` tag it is routinely a version PyPI has never seen. That is
	# the ordinary case and it deserves to be named, not left as a resolver
	# error the reader has to interpret.
	if [ "$asked_for_a_version" = 0 ]; then
		echo "$version is the version this checkout releases as (pyproject.toml). It" >&2
		echo "has no wheels on PyPI until the py-v$version tag is pushed, so this is" >&2
		echo "expected on an unreleased working tree." >&2
	fi
	# Best effort, and only to save a browser trip: no failure here changes the
	# advice below.
	latest=$(curl -fsS --max-time 10 https://pypi.org/pypi/voqalize-avatar/json 2>/dev/null |
		python3 -c 'import json,sys; print(json.load(sys.stdin)["info"]["version"])' 2>/dev/null) || latest=""
	if [ -n "$latest" ] && [ "$latest" != "$version" ]; then
		echo "" >&2
		echo "The newest published release is $latest:" >&2
		echo "  ./get.sh --version $latest" >&2
	fi
	echo "" >&2
	echo "Or build the aligner from source, which needs no published wheel:" >&2
	echo "  ./build.sh" >&2
	exit 1
fi

BUNDLE="$TMP/voqalize_avatar/_native"

# A wheel from before the in-process rewrite carries an `avatarsync` executable
# instead of a shared library, and nothing in this repo can load it. Say so in
# those words rather than failing later inside ctypes.
if [ ! -f "$BUNDLE/$libname" ]; then
	echo "the voqalize-avatar==$version wheel carries no $libname." >&2
	if [ -f "$BUNDLE/avatarsync" ]; then
		echo "It predates the in-process library (it ships the old subprocess" >&2
		echo "binary). Pick a newer release, or build from source: ./build.sh" >&2
	else
		echo "This is an sdist install or a platform with no wheel. ./build.sh" >&2
	fi
	exit 1
fi

mkdir -p "$HERE/bin/$PLATFORM"
cp "$BUNDLE/$libname" "$HERE/bin/$PLATFORM/$libname"
chmod +x "$HERE/bin/$PLATFORM/$libname"
rm -f "$HERE/bin/$PLATFORM/avatarsync.recipe"

rm -rf "$HERE/res"
cp -R "$BUNDLE/res" "$HERE/res"

echo "$HERE/bin/$PLATFORM/$libname"
