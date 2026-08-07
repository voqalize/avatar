#!/usr/bin/env bash
# Build the `avatarsync` resident binary from pristine rhubarb-lip-sync 1.14.0
# plus patches/avatarsync-1.14.0.patch, and materialise the model tree it needs.
#
#   ./build.sh                 # fetch (cached), patch, compile, install
#   ./build.sh --res-only      # just materialise res/ from the tarball
#   ./build.sh --recipe-id     # print the compile-input hash, do nothing else
#   ./build.sh --clean         # drop .build/ first
#
# Outputs, both relative to this directory:
#   bin/<platform>/avatarsync           the binary for the host platform (committed)
#   bin/<platform>/avatarsync.recipe    what it was compiled FROM (committed)
#   res/sphinx/…                        cmudict + phonetic LM + acoustic model
#                                       (NOT committed — 56 MB, and identical on
#                                       every platform, so build.sh regenerates it)
#
# The upstream source is 85 MB and is NOT vendored in git. It is fetched from
# GitHub and checked against a pinned sha256; the only upstream bytes we own are
# the patch. See README.md for why.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=1.14.0
URL="https://github.com/DanielSWolf/rhubarb-lip-sync/archive/refs/tags/v${VERSION}.tar.gz"
SHA256=45acd039782c26f563a331f59769a5be7e0f6f337d8ee99f0cfd8a10da40ccdf

CACHE="${RHUBARB_CACHE_DIR:-$HERE/.cache}"
BUILD="$HERE/.build"
TREE="$BUILD/rhubarb-lip-sync-${VERSION}"
TARBALL="$CACHE/rhubarb-lip-sync-${VERSION}-source.tar.gz"

res_only=0
recipe_id=0
for arg in "$@"; do
	case "$arg" in
		--res-only) res_only=1 ;;
		--recipe-id) recipe_id=1 ;;
		--clean) rm -rf "$BUILD" ;;
		*) echo "unknown argument: $arg" >&2; exit 2 ;;
	esac
done

# --- the compile-input hash ---------------------------------------------------
# Everything that gets baked INTO the binary, and nothing else: the sources we
# add, the patch we apply to upstream, and this script (which chooses the
# compile flags). Deliberately NOT data/phone_weights.json — the weights are
# read from disk at runtime, so editing them takes effect without a recompile,
# and folding them in here would demand a pointless rebuild.
#
# It exists so a committed binary can say what it was built from. build.sh
# writes it beside the binary after a real compile; build-rhubarb.sh compares it
# before packaging one, and refuses on a mismatch. Without that, editing
# avatarsync.cpp and forgetting to rebuild ships the OLD binary under a NEW
# artifact id — green build, stale behaviour, no error anywhere.
#
# Defined here rather than in build-rhubarb.sh so there is exactly one
# definition: two copies of a hash that must agree would eventually disagree,
# and the failure mode is a deploy that refuses to run for no real reason.
# Relative to $HERE (shasum echoes the path it is handed) and shasum-only, so
# the value depends on the bytes and nothing about the host.
recipe_hash() {
	(cd "$HERE" && find src patches build.sh -type f -print0 \
		| sort -z | xargs -0 shasum -a 256) | shasum -a 256 | cut -c1-12
}

if [ "$recipe_id" = 1 ]; then
	recipe_hash
	exit 0
fi

# Platform id, matching what rhubarb_runtime.py computes from platform.system()
# and platform.machine(). Kept in exactly two places on purpose; a third would
# start drifting.
case "$(uname -s)" in
	Darwin) os=darwin ;;
	Linux) os=linux ;;
	*) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	arm64 | aarch64) arch=arm64 ;;
	x86_64 | amd64) arch=x64 ;;
	*) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
PLATFORM="$os-$arch"

# --- fetch --------------------------------------------------------------------
mkdir -p "$CACHE"
if [ ! -f "$TARBALL" ]; then
	echo ">> fetching rhubarb-lip-sync $VERSION" >&2
	curl -sSLf -o "$TARBALL.tmp" "$URL"
	mv "$TARBALL.tmp" "$TARBALL"
fi

if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
else
	actual="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
fi
if [ "$actual" != "$SHA256" ]; then
	echo "ERROR: sha256 mismatch for $TARBALL" >&2
	echo "  expected $SHA256" >&2
	echo "  actual   $actual" >&2
	exit 1
fi

# --- extract + patch ----------------------------------------------------------
if [ ! -d "$TREE" ]; then
	echo ">> extracting" >&2
	mkdir -p "$BUILD"
	tar xzf "$TARBALL" -C "$BUILD"
fi

if [ ! -f "$TREE/.avatarsync-patched" ]; then
	echo ">> applying patches/avatarsync-1.14.0.patch" >&2
	patch -p1 -d "$TREE" < "$HERE/patches/avatarsync-1.14.0.patch"
	touch "$TREE/.avatarsync-patched"
fi

mkdir -p "$TREE/rhubarb/src/avatarsync"
cp "$HERE/src/avatarsync.cpp" "$TREE/rhubarb/src/avatarsync/avatarsync.cpp"

# --- res ----------------------------------------------------------------------
# Only what the two legs actually read. Upstream's CMake also copies
# en-us.lm.bin (26 MB word language model, pocketSphinx recognizer only) and a
# second acoustic model under model/en-us/en-us; we use neither.
echo ">> materialising res/sphinx" >&2
mkdir -p "$HERE/res/sphinx/acoustic-model"
cp "$TREE/rhubarb/lib/pocketsphinx-rev13216/model/en-us/cmudict-en-us.dict" "$HERE/res/sphinx/"
cp "$TREE/rhubarb/lib/pocketsphinx-rev13216/model/en-us/en-us-phone.lm.bin" "$HERE/res/sphinx/"
find "$TREE/rhubarb/lib/cmusphinx-en-us-5.2" -maxdepth 1 -type f \
	-exec cp {} "$HERE/res/sphinx/acoustic-model/" \;
# Tracked, not in res/: res/ is gitignored and regenerated, but the binaries
# in bin/ ARE committed, and a distributed binary has to carry the licence
# text of everything statically linked into it.
cp "$TREE/LICENSE.md" "$HERE/UPSTREAM-LICENSE.md"

if [ "$res_only" = 1 ]; then
	echo "$HERE/res"
	exit 0
fi

# --- compile ------------------------------------------------------------------
# CMAKE_POLICY_VERSION_MINIMUM: 1.14.0's vendored libraries declare minimums
# below 3.5, which CMake 4 rejects outright.
#
# -ffile-prefix-map rewrites the build tree's absolute path to `.` everywhere the
# compiler bakes one in — assert strings, __FILE__, debug info. Upstream's
# vendored pocketsphinx uses assertions liberally, so without this a binary
# carries several hundred copies of whatever directory it happened to be built
# in, which is both a reproducibility problem (two machines, two binaries, same
# source) and a small privacy one for anything committed to a public repo.
echo ">> configuring" >&2
cmake -S "$TREE" -B "$TREE/build" \
	-DCMAKE_BUILD_TYPE=Release \
	-DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
	-DCMAKE_C_FLAGS="-ffile-prefix-map=$TREE=." \
	-DCMAKE_CXX_FLAGS="-ffile-prefix-map=$TREE=." >&2

echo ">> building avatarsync ($PLATFORM)" >&2
cmake --build "$TREE/build" --target avatarsync -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" >&2

mkdir -p "$HERE/bin/$PLATFORM"
cp "$TREE/build/rhubarb/avatarsync" "$HERE/bin/$PLATFORM/avatarsync"
strip "$HERE/bin/$PLATFORM/avatarsync" 2>/dev/null || true

# Stamp what it was built from, right next to it. This is the ONLY thing that
# writes a .recipe — so a binary carrying one has, by construction, been through
# this compile. Commit the two together or the guard fires.
recipe_hash > "$HERE/bin/$PLATFORM/avatarsync.recipe"

echo "$HERE/bin/$PLATFORM/avatarsync"
